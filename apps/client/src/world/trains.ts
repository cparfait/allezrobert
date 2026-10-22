import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RouteTrack } from '@allezrobert/shared';
import { mergeRailPieces, planTriggers, railAt, type Rail, type TrainTrigger } from '../game/trainplan.ts';
import type { LoadedTile } from './types.ts';

const CAR_LENGTH = 24;
const CAR_GAP = 1.2;

interface ActiveTrain {
  rail: Rail;
  s: number;
  /** +1 : vers les abscisses croissantes de la voie. */
  sens: 1 | -1;
  speed: number;
  cars: THREE.Group[];
}

/** Voiture de train en primitives : caisse, bande de fenêtres, toit, bogies. */
function carGeometry(): { body: THREE.BufferGeometry; glass: THREE.BufferGeometry; dark: THREE.BufferGeometry } {
  const L = CAR_LENGTH;
  const body = new THREE.BoxGeometry(2.9, 2.9, L).translate(0, 2.35, 0);
  const roof = new THREE.CylinderGeometry(1.45, 1.45, L, 12, 1, false, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2).scale(1, 0.25, 1).translate(0, 3.8, 0);
  const glass = new THREE.BoxGeometry(2.94, 0.85, L - 2.5).translate(0, 2.75, 0);
  const bogie = (z: number) => new THREE.BoxGeometry(2.4, 0.8, 3).translate(0, 0.5, z);
  return {
    body: mergeGeometries([body, roof]) as THREE.BufferGeometry,
    glass,
    dark: mergeGeometries([bogie(-L / 2 + 3), bogie(L / 2 - 3)]) as THREE.BufferGeometry,
  };
}

/**
 * Trains (idée NCT Ride) : les voies ferrées OSM des tuiles chargées sont dessinées (ballast et
 * rails) ; quand le coureur approche de l'endroit où l'itinéraire longe ou croise une voie, un train
 * part, réglé pour passer à ce point à peu près en même temps que lui.
 */
export class Trains {
  readonly group = new THREE.Group();
  private rails: Rail[] = [];
  private triggers: TrainTrigger[] = [];
  private readonly extra: Array<{ id: number; pts: number[] }> = [];
  private tilesKey = '';
  private acc = Infinity;
  private active: ActiveTrain | null = null;
  private readonly fired = new Set<number>();
  private readonly railMeshes = new THREE.Group();
  private readonly mats = {
    ter: new THREE.MeshStandardNodeMaterial({ color: '#d7dde4', roughness: 0.45, metalness: 0.3 }),
    accent: new THREE.MeshStandardNodeMaterial({ color: '#1f4fa3', roughness: 0.5, metalness: 0.2 }),
    glass: new THREE.MeshStandardNodeMaterial({ color: '#1b2430', roughness: 0.1, metalness: 0.4 }),
    dark: new THREE.MeshStandardNodeMaterial({ color: '#202226', roughness: 0.8 }),
    ballast: new THREE.MeshStandardNodeMaterial({ color: '#7d756b', roughness: 1, side: THREE.DoubleSide }),
    rail: new THREE.MeshStandardNodeMaterial({ color: '#5b5e63', roughness: 0.35, metalness: 0.8, side: THREE.DoubleSide }),
  };
  private readonly geo = carGeometry();

  constructor(
    private readonly track: RouteTrack,
    private readonly groundAt: (x: number, z: number) => number,
    private readonly tiles: () => LoadedTile[],
  ) {
    this.group.name = 'trains';
    this.group.add(this.railMeshes);
  }

  /** Voie ajoutée à la main (développement : `?fakerail`). */
  addRail(pts: number[]): void {
    this.extra.push({ id: -1 - this.extra.length, pts });
    this.tilesKey = '';
  }

  /**
   * @param riderD distance du coureur sur l'itinéraire ; @param dirSign sens de marche ;
   * @param speedMs vitesse du coureur
   */
  update(dt: number, riderD: number, dirSign: number, speedMs: number): void {
    this.acc += dt;
    if (this.acc > 3) {
      this.acc = 0;
      this.refreshRails();
    }
    // Déclenchement : entre 300 et 220 m avant le point de passage, dans le sens de marche.
    if (!this.active) {
      for (const t of this.triggers) {
        const ahead = (t.d - riderD) * dirSign;
        const key = Math.round(t.d) * 1000 + t.rail;
        if (ahead < 220 || ahead > 300 || this.fired.has(key)) continue;
        this.fired.add(key);
        this.launch(t, ahead, speedMs);
        break;
      }
    }
    const a = this.active;
    if (!a) return;
    a.s += a.sens * a.speed * dt;
    const tail = a.s - a.sens * (a.cars.length * (CAR_LENGTH + CAR_GAP));
    if ((a.sens > 0 && tail > a.rail.length) || (a.sens < 0 && tail < 0)) {
      for (const c of a.cars) this.group.remove(c);
      this.active = null;
      return;
    }
    a.cars.forEach((car, i) => {
      const s = a.s - a.sens * (i * (CAR_LENGTH + CAR_GAP) + CAR_LENGTH / 2);
      const inside = s >= 0 && s <= a.rail.length;
      car.visible = inside;
      if (!inside) return;
      const p = railAt(a.rail, s);
      const y = this.groundAt(p.x, p.z);
      car.position.set(p.x, (Number.isFinite(y) ? y : 0) + 0.45, p.z);
      car.rotation.set(0, Math.atan2(p.dx * a.sens, p.dz * a.sens), 0);
    });
  }

  private launch(t: TrainTrigger, aheadM: number, riderSpeed: number): void {
    const rail = this.rails[t.rail];
    if (!rail) return;
    // Départ à ~700 m sur la voie, du côté où il y a le plus de place ; vitesse réglée pour passer
    // au point de rencontre quand le coureur y arrive (bornée entre 54 et 140 km/h).
    const room = { plus: rail.length - t.railS, minus: t.railS };
    const sens: 1 | -1 = room.minus >= room.plus ? 1 : -1;
    const dist = Math.min(700, sens > 0 ? room.minus : room.plus);
    if (dist < 150) return;
    const eta = aheadM / Math.max(riderSpeed, 4);
    const speed = Math.min(39, Math.max(15, dist / eta));
    const cars: THREE.Group[] = [];
    const n = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(this.geo.body, i % 2 ? this.mats.ter : this.mats.accent);
      body.castShadow = true;
      g.add(body, new THREE.Mesh(this.geo.glass, this.mats.glass), new THREE.Mesh(this.geo.dark, this.mats.dark));
      this.group.add(g);
      cars.push(g);
    }
    this.active = { rail, s: t.railS - sens * dist, sens, speed, cars };
  }

  /** Voies des tuiles chargées (raccordées) et points de déclenchement, quand les tuiles changent. */
  private refreshRails(): void {
    const tiles = this.tiles();
    const key = `${tiles.map((t) => t.id).sort().join(',')}|${this.extra.length}`;
    if (key === this.tilesKey) return;
    this.tilesKey = key;
    const pieces = [...tiles.flatMap((t) => (t.features.railways ?? []).filter((r) => !r.tunnel).map((r) => ({ id: r.id, pts: r.pts }))), ...this.extra];
    // On ne remplace pas la voie sous un train en marche, mais les rails sont reposés sur le relief
    // des tuiles qui viennent d'arriver.
    if (!this.active) {
      this.rails = mergeRailPieces(pieces);
      this.triggers = planTriggers(this.track, this.rails);
    }
    this.buildRailMeshes();
  }

  /** Ballast et deux rails posés sur le terrain, tous les 4 m. */
  private buildRailMeshes(): void {
    for (const c of [...this.railMeshes.children]) {
      this.railMeshes.remove(c);
      (c as THREE.Mesh).geometry.dispose();
    }
    const ballast: THREE.BufferGeometry[] = [];
    const rails: THREE.BufferGeometry[] = [];
    for (const rail of this.rails) {
      const n = Math.max(2, Math.ceil(rail.length / 4));
      const pos: number[] = [];
      const rpos: number[] = [];
      for (let k = 0; k <= n; k++) {
        const p = railAt(rail, (k / n) * rail.length);
        const nx = -p.dz;
        const nz = p.dx;
        const y = this.groundAt(p.x, p.z);
        const h = Number.isFinite(y) ? y : 0;
        pos.push(p.x + nx * 1.9, h + 0.12, p.z + nz * 1.9, p.x - nx * 1.9, h + 0.12, p.z - nz * 1.9);
        for (const off of [0.72, -0.72]) rpos.push(p.x + nx * (off + 0.04), h + 0.3, p.z + nz * (off + 0.04), p.x + nx * (off - 0.04), h + 0.3, p.z + nz * (off - 0.04));
      }
      ballast.push(strip(pos, 2));
      rails.push(strip(rpos, 4));
    }
    if (ballast.length) {
      const b = new THREE.Mesh(mergeGeometries(ballast) as THREE.BufferGeometry, this.mats.ballast);
      b.receiveShadow = true;
      const r = new THREE.Mesh(mergeGeometries(rails) as THREE.BufferGeometry, this.mats.rail);
      this.railMeshes.add(b, r);
    }
  }
}

/**
 * Bandes de triangles : `per` sommets par rangée (2 = une bande, 4 = deux bandes côte à côte),
 * rangées successives le long de la voie.
 */
function strip(pos: number[], per: number): THREE.BufferGeometry {
  const rows = pos.length / 3 / per;
  const idx: number[] = [];
  for (let r = 0; r + 1 < rows; r++) {
    for (let b = 0; b < per; b += 2) {
      const a0 = r * per + b;
      const a1 = a0 + 1;
      const c0 = a0 + per;
      const c1 = a1 + per;
      idx.push(a0, c0, a1, a1, c0, c1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
