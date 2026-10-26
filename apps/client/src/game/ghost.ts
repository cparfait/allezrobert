import * as THREE from 'three/webgpu';
import type { AvatarLook, FriendGhostLap, RouteTrack } from '@allezrobert/shared';
import { createAvatar, type RiderAvatarLike } from '../rider/gltfAvatar.ts';

interface GhostLap {
  lapTimeS: number;
  /** Distance parcourue depuis le début du tour, échantillonnée chaque seconde. */
  dist: number[];
  date: string;
}

const KEY = (routeId: string) => `ar.ghost.${routeId}`;

/** Meilleur tour enregistré sur cet itinéraire (fiche du parcours dans le menu), ou null. */
export function readGhostBest(routeId: string): { lapTimeS: number; date: string } | null {
  try {
    const raw = localStorage.getItem(KEY(routeId));
    const g = raw ? (JSON.parse(raw) as GhostLap) : null;
    return g ? { lapTimeS: g.lapTimeS, date: g.date } : null;
  } catch {
    return null;
  }
}

/** Rend un avatar translucide et sans ombre (à refaire si son vélo est remonté : nouveaux matériaux). */
export function ghostify(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    for (const mm of Array.isArray(m) ? m : m ? [m] : []) {
      if (mm.transparent && mm.opacity === 0.42) continue;
      mm.transparent = true;
      mm.opacity = 0.42;
      mm.depthWrite = false;
    }
    o.castShadow = false;
  });
}

/**
 * Fantôme : le coureur lui-même (mêmes tenue, vélo et visage), translucide et sans ombre, pour qu'on
 * reconnaisse son propre record parmi les vrais coureurs.
 */
export function ghostAvatar(scene: THREE.Scene, look: AvatarLook): RiderAvatarLike {
  const avatar = createAvatar(look);
  ghostify(avatar.root);
  scene.add(avatar.root);
  return avatar;
}

/**
 * Fantôme de son record : le meilleur tour de la boucle est rejoué en parallèle, avatar
 * translucide. Chaque tour terminé plus vite remplace le record (stockage local).
 */
export class Ghost {
  readonly avatar: RiderAvatarLike;
  private best: GhostLap | null;
  private readonly track: RouteTrack;
  private readonly routeId: string;
  private current: number[] = [];
  private lapStartT = 0;
  private lapStartD: number;
  private acc = 0;
  private readonly sample = { x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, grade: 0, d: 0 };
  onNewRecord?: (lapTimeS: number, previous: number | null) => void;
  /** Nouveau record enregistré (envoi au serveur pour les amis). */
  onSaved?: (lap: { lapTimeS: number; dist: number[] }) => void;

  private reGhost = 0;

  constructor(scene: THREE.Scene, track: RouteTrack, routeId: string, startD: number, look: AvatarLook) {
    this.track = track;
    this.routeId = routeId;
    this.lapStartD = startD;
    const raw = localStorage.getItem(KEY(routeId));
    this.best = raw ? (JSON.parse(raw) as GhostLap) : null;
    this.avatar = ghostAvatar(scene, look);
    this.avatar.root.visible = !!this.best;
  }

  get bestLapS(): number | null {
    return this.best?.lapTimeS ?? null;
  }

  /** Meilleur tour (temps et distance par seconde), à envoyer aux amis. */
  bestLap(): { lapTimeS: number; dist: number[] } | null {
    return this.best ? { lapTimeS: this.best.lapTimeS, dist: this.best.dist } : null;
  }

  /** @param elapsedS temps de sortie ; @param distM distance absolue du joueur */
  update(dt: number, elapsedS: number, distM: number): void {
    this.acc += dt;
    if (this.acc >= 1) {
      this.acc -= 1;
      this.current.push(distM - this.lapStartD);
    }
    if (!this.best || !this.avatar.root.visible) return;
    const t = elapsedS - this.lapStartT;
    const i = Math.min(Math.floor(t), this.best.dist.length - 1);
    const f = Math.min(t - i, 1);
    const a = this.best.dist[i] ?? 0;
    const b = this.best.dist[i + 1] ?? a;
    const d = this.lapStartD + a + (b - a) * f;
    const p = this.track.positionAt(d, 0.2, this.sample);
    this.avatar.root.position.set(p.x, p.y + 0.06, p.z);
    this.avatar.root.rotation.set(0, Math.atan2(p.dirX, p.dirZ), 0);
    this.avatar.root.rotateX(-Math.atan(p.grade / 100));
    const speed = (b - a) || 0;
    this.avatar.update(dt, speed > 0.5 ? 88 : 0, speed, 'seated');
    // Vélo remonté entre-temps (famille de vélo chargée après coup) : ses matériaux redeviennent translucides.
    this.reGhost += dt;
    if (this.reGhost > 2) {
      this.reGhost = 0;
      ghostify(this.avatar.root);
    }
  }

  /** Fin de tour : enregistre le record si battu, et relance le fantôme. */
  lap(elapsedS: number, distM: number): void {
    const lapTimeS = elapsedS - this.lapStartT;
    if (this.current.length > 30 && (!this.best || lapTimeS < this.best.lapTimeS)) {
      const previous = this.best?.lapTimeS ?? null;
      this.best = { lapTimeS, dist: this.current, date: new Date().toISOString() };
      localStorage.setItem(KEY(this.routeId), JSON.stringify(this.best));
      this.onNewRecord?.(lapTimeS, previous);
      this.onSaved?.(this.best);
    }
    this.current = [];
    this.lapStartT = elapsedS;
    this.lapStartD = distM;
    this.avatar.root.visible = !!this.best;
  }
}

/** Envoie son meilleur tour au serveur (visible de ses amis seulement). Silencieux hors ligne ou sans compte. */
export async function uploadGhost(routeId: string, lap: { lapTimeS: number; dist: number[] }): Promise<boolean> {
  try {
    const { apiBase } = await import('../ui/account.ts');
    const res = await fetch(`${apiBase()}/ghost/${encodeURIComponent(routeId)}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lapTimeS: Math.round(lap.lapTimeS * 10) / 10, dist: lap.dist.map((d) => Math.round(d * 10) / 10) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Meilleur tour parmi les amis sur cet itinéraire, ou null (pas d'amis, pas de tour, hors ligne). */
export async function fetchFriendGhost(routeId: string): Promise<FriendGhostLap | null> {
  try {
    const { apiBase } = await import('../ui/account.ts');
    const res = await fetch(`${apiBase()}/friends/ghost?routeId=${encodeURIComponent(routeId)}`, { credentials: 'include' });
    return res.ok ? ((await res.json()) as FriendGhostLap) : null;
  } catch {
    return null;
  }
}

/**
 * Fantôme d'un ami : rejoue son meilleur tour (avatar translucide à son apparence), en parallèle de
 * celui du joueur. Il repart au début du tour à chaque tour du joueur.
 */
export class FriendGhost {
  readonly avatar: RiderAvatarLike;
  readonly name: string;
  readonly lapTimeS: number;
  private readonly dist: number[];
  private readonly track: RouteTrack;
  private lapStartT = 0;
  private reGhost = 0;
  private readonly sample = { x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, grade: 0, d: 0 };

  constructor(scene: THREE.Scene, track: RouteTrack, lap: FriendGhostLap, look: AvatarLook) {
    this.track = track;
    this.name = lap.name;
    this.lapTimeS = lap.lapTimeS;
    this.dist = lap.dist;
    this.avatar = ghostAvatar(scene, look);
  }

  /** Avance de dt ; l'ami est placé à la distance qu'il avait atteinte à ce moment de son tour. */
  update(dt: number, elapsedS: number): void {
    const t = elapsedS - this.lapStartT;
    const i = Math.min(Math.floor(t), this.dist.length - 1);
    const f = Math.min(t - i, 1);
    const a = this.dist[i] ?? 0;
    const b = this.dist[i + 1] ?? a;
    // Tour terminé : il attend la ligne (le joueur finit son tour puis tout repart).
    const d = a + (b - a) * f;
    const p = this.track.positionAt(d, -0.4, this.sample);
    this.avatar.root.position.set(p.x, p.y + 0.06, p.z);
    this.avatar.root.rotation.set(0, Math.atan2(p.dirX, p.dirZ), 0);
    this.avatar.root.rotateX(-Math.atan(p.grade / 100));
    const speed = b - a || 0;
    this.avatar.update(dt, speed > 0.5 ? 88 : 0, speed, 'seated');
    this.reGhost += dt;
    if (this.reGhost > 2) {
      this.reGhost = 0;
      ghostify(this.avatar.root);
    }
  }

  /** Écart (m) entre le joueur et l'ami : positif si l'ami est devant. */
  gapM(elapsedS: number, playerDistM: number): number {
    const t = elapsedS - this.lapStartT;
    const i = Math.min(Math.max(Math.floor(t), 0), this.dist.length - 1);
    return (this.dist[i] ?? 0) - playerDistM;
  }

  /** Nouveau tour du joueur : l'ami repart de la ligne. */
  lap(elapsedS: number): void {
    this.lapStartT = elapsedS;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.avatar.root);
  }
}
