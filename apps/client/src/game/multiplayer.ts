import * as THREE from 'three/webgpu';
import type { CompanionCommand, PublicPick, RideMode, RideWeather, RouteTrack, WelcomeMsg } from '@allezrobert/shared';
import { RideNetClient, type InterpolatedRider } from '../net/index.ts';
import { frameAfterTurn, gapAlongRoute, toRouteFrame } from '../net/frame.ts';
import { createAvatar, type RiderAvatarLike } from '../rider/gltfAvatar.ts';

/** Adresse du serveur : VITE_SERVER_URL (prod : https://allezrobert.cparfait.ovh/colyseus), sinon local. */
export function serverEndpoint(): string {
  const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
  // En local (localhost ou 127.0.0.1, adresse exigée par Spotify) : même nom d'hôte que la page, pour les cookies.
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  return env.VITE_SERVER_URL ?? (local ? `http://${location.hostname}:2567` : `${location.origin}/colyseus`);
}

/**
 * Jeton de jeu : session existante (cookie), sinon connexion de développement (refusée en production).
 * `onSession` : appelé une fois la session établie, juste avant d'entrer dans la salle.
 */
function tokenProvider(apiBase: string, name: string, onSession?: () => Promise<unknown>): () => Promise<string | undefined> {
  return async () => {
    const get = () => fetch(`${apiBase}/auth/game-token`, { credentials: 'include' });
    let r = await get();
    if (r.status === 401) {
      await fetch(`${apiBase}/auth/dev`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }).catch(() => undefined);
      r = await get();
    }
    if (!r.ok) return undefined;
    const token = ((await r.json()) as { token?: string }).token;
    await onSession?.().catch(() => undefined);
    return token;
  };
}

interface Remote {
  avatar: RiderAvatarLike;
  /** Repère d'ami (nom doré et flèche au-dessus de la tête), visible de loin et à travers le décor. */
  label: THREE.Sprite | null;
}

/** Au-delà, le repère d'un ami n'est plus montré (m) ; en deçà de `FRIEND_MARKER_NEAR_M`, il gênerait la vue. */
const FRIEND_MARKER_FAR_M = 5000;
const FRIEND_MARKER_NEAR_M = 6;

/** Repère d'un ami : étiquette dorée à son nom, flèche vers le coureur ; taille constante à l'écran. */
function friendMarker(name: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 104;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.font = '700 30px Inter, Segoe UI, sans-serif';
  const label = `★ ${name}`.slice(0, 22);
  const w = Math.min(Math.ceil(ctx.measureText(label).width) + 40, 312);
  const x0 = (320 - w) / 2;
  ctx.fillStyle = '#ffd23f';
  ctx.strokeStyle = 'rgba(10,14,22,0.85)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(x0, 6, w, 56, 26);
  ctx.moveTo(146, 62);
  ctx.lineTo(160, 96);
  ctx.lineTo(174, 62);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
  ctx.fillStyle = '#0a0e16';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 160, 35);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Taille constante à l'écran et dessiné par-dessus le décor : on le repère de loin, même derrière une maison.
  const mat = new THREE.SpriteMaterial({ map: tex, depthWrite: false, depthTest: false, transparent: true, sizeAttenuation: false });
  const s = new THREE.Sprite(mat);
  s.center.set(0.5, 0);
  s.scale.set(0.12, 0.039, 1);
  s.renderOrder = 20;
  return s;
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

  /**
   * `syncProfile` : envoie le profil local au compte avant l'entrée — le serveur montre aux autres
   * l'avatar du compte, qui doit être celui que le coureur voit chez lui.
   */
  constructor(scene: THREE.Scene, track: RouteTrack, riderName: string, syncProfile?: () => Promise<unknown>) {
    this.scene = scene;
    this.track = track;
    const endpoint = serverEndpoint();
    const apiBase = `${endpoint.replace(/\/colyseus$/, '')}/api`;
    this.net = new RideNetClient({ endpoint, apiBase, token: tokenProvider(apiBase, riderName, syncProfile) });
  }

  /** Rejoint par code d'invitation, ou crée une sortie privée sur l'itinéraire courant. */
  /** Heure et météo de la sortie (choix de l'hôte), connues après l'entrée dans la salle. */
  weather: RideWeather | null = null;

  /** Équipement égalisé dans cette salle (même vélo pour tous), connu après l'entrée. */
  equalized = false;

  /** Salle du monde ouvert (sans hôte) et portées du chat / de la voix, connues après l'entrée. */
  isPublic = false;
  proximity: WelcomeMsg['proximity'] | undefined;
  /** Amis déjà présents dans la salle rejointe (monde ouvert). */
  friendsHere: string[] = [];

  /** Repère de la prédiction locale par rapport à celui du serveur : serveur = sens × distance locale + décalage. */
  private frameSign: 1 | -1 = 1;
  private frameOffset = 0;
  /** Distance (m, le long de la route) à chaque coureur distant, mise à jour à chaque image. */
  private readonly gaps = new Map<string, number>();

  /**
   * Monde ouvert : rejoint la salle conseillée par le serveur (celle des amis d'abord), sinon la première
   * salle non pleine de la zone, sinon en ouvre une. Compte requis.
   */
  async connectPublic(routeId: string, name: string, friendId?: string, weather?: RideWeather): Promise<void> {
    // Rejoindre un ami : si le serveur refuse (il est parti, salle pleine), on le dit au lieu de rouler ailleurs.
    const pick: PublicPick = await this.net.pickPublicRoom(routeId, friendId).catch((e: Error) => {
      if (friendId || /Connexion requise/.test(e.message)) throw e;
      return { friends: [] };
    });
    const welcome = await this.net.joinPublic(routeId, { displayName: name, ...(pick.near ? { near: pick.near } : {}) }, pick.roomId, weather);
    this.isPublic = true;
    this.friendsHere = pick.roomId && pick.roomId === welcome.roomId ? pick.friends : [];
    this.proximity = welcome.proximity;
    this.weather = welcome.options.weather ?? null;
  }

  /**
   * Jeu chargé : à envoyer une fois (monde ouvert : à la première image où le coureur roule vraiment). Le serveur annonce
   * alors l'arrivée aux autres ; avant, le coureur n'apparaît ni dans « À proximité » ni (monde ouvert) sur la route.
   */
  private readySent = false;
  notifyReady(): void {
    if (this.readySent) return;
    this.readySent = true;
    this.net.ready();
  }

  /** Sens de marche de son coureur selon le serveur (null : pas encore d'instantané). */
  selfDir(): 1 | -1 | null {
    const s = this.net.getSelfSnapshot();
    return s ? (s.dir ?? 1) : null;
  }

  /** Distance (m) le long de la route à un coureur distant, quel que soit son sens ; null s'il n'est pas affiché. */
  distanceTo(riderId: string): number | null {
    return this.gaps.get(riderId) ?? null;
  }

  async connect(opts: { inviteCode?: string; mode: RideMode; guest: boolean; aiRiders: number; aiLevel?: number; targetKmh?: number; laps?: number; trainerDifficulty: number; name: string; weather: RideWeather; equalEquipment?: boolean }): Promise<string> {
    const role = opts.guest ? 'guest' : 'rider';
    const welcome = opts.inviteCode
      ? await this.net.joinByCode(opts.inviteCode, { role, displayName: opts.name })
      : await this.net.create(
          {
            routeId: this.track.route.id,
            mode: opts.mode,
            stickyGroup: opts.mode === 'group',
            allowGuests: true,
            draftingStrength: 1,
            trainerDifficulty: opts.trainerDifficulty,
            aiRiders: opts.aiRiders,
            weather: opts.weather,
            ...(opts.aiLevel ? { aiLevel: opts.aiLevel } : {}),
            ...(opts.mode === 'group' && opts.targetKmh ? { targetKmh: opts.targetKmh } : {}),
            ...(opts.mode === 'race' && opts.laps ? { laps: opts.laps } : {}),
            equalEquipment: opts.equalEquipment ?? opts.mode === 'race',
          },
          { role, displayName: opts.name },
        );
    this.weather = welcome.options.weather ?? null;
    this.equalized = welcome.options.equalEquipment ?? welcome.options.mode === 'race';
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

  /**
   * Réconciliation qui tient compte du demi-tour : `dir` et `distM` sont ceux du jeu (repère de l'itinéraire).
   * Après un demi-tour le serveur mesure la distance sur l'itinéraire inversé ; le décalage entre les deux
   * repères (tours compris) est recalculé sur le premier instantané du nouveau sens. Renvoie la correction à
   * ajouter à `distM`.
   */
  reconcileLocal(dir: 1 | -1, distM: number, dt: number): number {
    if (dir !== this.frameSign) {
      const self = this.net.getSelfSnapshot();
      if (!self) return 0;
      const L = this.track.length;
      const snapU = this.track.route.loop ? self.lap * L + self.distM : self.distM;
      const f = frameAfterTurn(dir, snapU, distM);
      this.frameSign = f.sign;
      this.frameOffset = f.offset;
      this.net.resetReconciliation();
    }
    return this.frameSign * this.net.reconcileSelf(this.frameSign * distM + this.frameOffset, dt);
  }

  onCompanion(cb: (c: CompanionCommand) => void): void {
    this.net.on('companion', cb);
  }

  /** Avatars des autres coureurs, à leur position interpolée. */
  render(dt: number, camera: THREE.Camera, refM = 0): InterpolatedRider[] {
    // Coureurs dont le jeu charge encore : ni montrés, ni comptés à proximité.
    const riders = this.net
      .getAllInterpolated()
      .filter((r) => r.id !== this.net.selfId && !this.net.roster.get(r.id)?.loading)
      .map((r) => toRouteFrame(r, this.track.length, !!this.track.route.loop, refM));
    const seen = new Set<string>();
    const L = this.track.length;
    for (const r of riders) {
      seen.add(r.id);
      this.gaps.set(r.id, gapAlongRoute(r.unwrappedM, refM, L, !!this.track.route.loop));
      let rem = this.remotes.get(r.id);
      if (!rem) {
        rem = { avatar: createAvatar(r.avatar), label: null };
        this.scene.add(rem.avatar.root);
        this.remotes.set(r.id, rem);
      }
      const p = this.track.positionAt(r.unwrappedM, r.lateralM, this.sample);
      const root = rem.avatar.root;
      root.position.set(p.x, p.y + 0.06, p.z);
      root.rotation.set(0, 0, 0);
      // À contresens (demi-tour) : cap retourné, pente inversée.
      root.rotateY(Math.atan2(p.dirX, p.dirZ) + (r.dir === -1 ? Math.PI : 0));
      root.rotateX(-Math.atan(p.grade / 100) * r.dir);
      const dist = camera.position.distanceTo(root.position);
      root.visible = dist < 600;
      if (dist < 250) {
        // FTP des autres coureurs inconnue ici : 250 W de référence.
        rem.avatar.setEffort?.(r.watts / 250, r.hr !== undefined ? r.hr / 190 : undefined);
        rem.avatar.update(dt, r.cadence, r.speedMs, r.pose);
      }
      rem.avatar.setShadows(dist < 40);
      this.updateMarker(rem, r.id, r.name, root.position, dist);
    }
    for (const [id, rem] of this.remotes) {
      if (seen.has(id)) continue;
      this.dropMarker(rem);
      this.scene.remove(rem.avatar.root);
      this.remotes.delete(id);
      this.gaps.delete(id);
    }
    return riders;
  }

  /** Ami de la salle : repère au-dessus de sa tête (créé ou retiré si l'amitié change en cours de route). */
  private updateMarker(rem: Remote, id: string, name: string, at: THREE.Vector3, dist: number): void {
    const friend = this.net.friendIds.has(id);
    if (!friend) return this.dropMarker(rem);
    if (!rem.label) {
      rem.label = friendMarker(name);
      this.scene.add(rem.label);
    }
    rem.label.position.set(at.x, at.y + 2.1, at.z);
    rem.label.visible = dist > FRIEND_MARKER_NEAR_M && dist < FRIEND_MARKER_FAR_M;
  }

  private dropMarker(rem: Remote): void {
    if (!rem.label) return;
    this.scene.remove(rem.label);
    rem.label.material.map?.dispose();
    rem.label.material.dispose();
    rem.label = null;
  }

  async dispose(): Promise<void> {
    for (const rem of this.remotes.values()) {
      this.dropMarker(rem);
      this.scene.remove(rem.avatar.root);
    }
    this.remotes.clear();
    await this.net.leave().catch(() => undefined);
  }
}
