import * as THREE from 'three/webgpu';
import type { CompanionCommand, RideMode, RouteTrack } from '@allezrobert/shared';
import { RideNetClient, type InterpolatedRider } from '../net/index.ts';
import { RiderAvatar } from '../rider/avatar.ts';

/** Adresse du serveur : VITE_SERVER_URL (prod : https://allezrobert.cparfait.ovh/colyseus), sinon local. */
export function serverEndpoint(): string {
  const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
  return env.VITE_SERVER_URL ?? (location.hostname === 'localhost' ? 'http://localhost:2567' : `${location.origin}/colyseus`);
}

/** Jeton de jeu : session existante (cookie), sinon connexion de développement (refusée en production). */
function tokenProvider(apiBase: string, name: string): () => Promise<string | undefined> {
  return async () => {
    const get = () => fetch(`${apiBase}/auth/game-token`, { credentials: 'include' });
    let r = await get();
    if (r.status === 401) {
      await fetch(`${apiBase}/auth/dev`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }).catch(() => undefined);
      r = await get();
    }
    if (!r.ok) return undefined;
    return ((await r.json()) as { token?: string }).token;
  };
}

interface Remote {
  avatar: RiderAvatar;
  label: THREE.Sprite | null;
}

/**
 * Sortie de groupe / course : connexion à la salle, télémétrie à 10 Hz, avatars des autres
 * coureurs interpolés (150 ms), réconciliation douce de sa propre position, commandes du compagnon.
 */
export class Multiplayer {
  readonly net: RideNetClient;
  private readonly scene: THREE.Scene;
  private readonly track: RouteTrack;
  private readonly remotes = new Map<string, Remote>();
  private readonly sample = { x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, grade: 0, d: 0 };

  constructor(scene: THREE.Scene, track: RouteTrack, riderName: string) {
    this.scene = scene;
    this.track = track;
    const endpoint = serverEndpoint();
    const apiBase = `${endpoint.replace(/\/colyseus$/, '')}/api`;
    this.net = new RideNetClient({ endpoint, apiBase, token: tokenProvider(apiBase, riderName) });
  }

  /** Rejoint par code d'invitation, ou crée une sortie privée sur l'itinéraire courant. */
  async connect(opts: { inviteCode?: string; mode: RideMode; guest: boolean; aiRiders: number; trainerDifficulty: number; name: string }): Promise<string> {
    const role = opts.guest ? 'guest' : 'rider';
    const welcome = opts.inviteCode
      ? await this.net.joinByCode(opts.inviteCode, { role, displayName: opts.name })
      : await this.net.create(
          { routeId: this.track.route.id, mode: opts.mode, stickyGroup: opts.mode === 'group', allowGuests: true, draftingStrength: 1, trainerDifficulty: opts.trainerDifficulty, aiRiders: opts.aiRiders },
          { role, displayName: opts.name },
        );
    return welcome.inviteCode;
  }

  /** Position autoritaire de soi : aspiration fournie par le serveur et correction de distance. */
  selfDraft(): number {
    const s = this.net.getSelfSnapshot();
    return s ? s.draftPct / 100 : 0;
  }

  reconcile(localUnwrappedM: number, dt: number): number {
    return this.net.reconcileSelf(localUnwrappedM, dt);
  }

  onCompanion(cb: (c: CompanionCommand) => void): void {
    this.net.on('companion', cb);
  }

  /** Avatars des autres coureurs, à leur position interpolée. */
  render(dt: number, camera: THREE.Camera): InterpolatedRider[] {
    const riders = this.net.getAllInterpolated().filter((r) => r.id !== this.net.selfId);
    const seen = new Set<string>();
    for (const r of riders) {
      seen.add(r.id);
      let rem = this.remotes.get(r.id);
      if (!rem) {
        rem = { avatar: new RiderAvatar(r.avatar), label: null };
        this.scene.add(rem.avatar.root);
        this.remotes.set(r.id, rem);
      }
      const p = this.track.positionAt(r.unwrappedM, r.lateralM, this.sample);
      const root = rem.avatar.root;
      root.position.set(p.x, p.y + 0.06, p.z);
      root.rotation.set(0, 0, 0);
      root.rotateY(Math.atan2(p.dirX, p.dirZ));
      root.rotateX(-Math.atan(p.grade / 100));
      const dist = camera.position.distanceTo(root.position);
      root.visible = dist < 600;
      if (dist < 250) rem.avatar.update(dt, r.cadence, r.speedMs, r.pose);
      rem.avatar.setShadows(dist < 40);
    }
    for (const [id, rem] of this.remotes) {
      if (seen.has(id)) continue;
      this.scene.remove(rem.avatar.root);
      this.remotes.delete(id);
    }
    return riders;
  }

  async dispose(): Promise<void> {
    for (const rem of this.remotes.values()) this.scene.remove(rem.avatar.root);
    this.remotes.clear();
    await this.net.leave().catch(() => undefined);
  }
}
