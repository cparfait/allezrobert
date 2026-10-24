import * as THREE from 'three/webgpu';
import type { RouteTrack } from '@allezrobert/shared';
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

/** Avatar translucide et sans ombre, pour distinguer un fantôme des vrais coureurs. */
export function ghostAvatar(scene: THREE.Scene): RiderAvatarLike {
  const avatar = createAvatar({ skin: '#cfe8ff', hair: '#cfe8ff', hairStyle: 0, jersey: '#9ad7ff', jerseyAccent: '#ffffff', helmet: '#e6f6ff', bike: '#9ad7ff', build: 0.4 });
  avatar.root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | undefined;
    if (m) {
      m.transparent = true;
      m.opacity = 0.42;
      m.depthWrite = false;
    }
    o.castShadow = false;
  });
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

  constructor(scene: THREE.Scene, track: RouteTrack, routeId: string, startD: number) {
    this.track = track;
    this.routeId = routeId;
    this.lapStartD = startD;
    const raw = localStorage.getItem(KEY(routeId));
    this.best = raw ? (JSON.parse(raw) as GhostLap) : null;
    this.avatar = ghostAvatar(scene);
    this.avatar.root.visible = !!this.best;
  }

  get bestLapS(): number | null {
    return this.best?.lapTimeS ?? null;
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
  }

  /** Fin de tour : enregistre le record si battu, et relance le fantôme. */
  lap(elapsedS: number, distM: number): void {
    const lapTimeS = elapsedS - this.lapStartT;
    if (this.current.length > 30 && (!this.best || lapTimeS < this.best.lapTimeS)) {
      const previous = this.best?.lapTimeS ?? null;
      this.best = { lapTimeS, dist: this.current, date: new Date().toISOString() };
      localStorage.setItem(KEY(this.routeId), JSON.stringify(this.best));
      this.onNewRecord?.(lapTimeS, previous);
    }
    this.current = [];
    this.lapStartT = elapsedS;
    this.lapStartD = distM;
    this.avatar.root.visible = !!this.best;
  }
}
