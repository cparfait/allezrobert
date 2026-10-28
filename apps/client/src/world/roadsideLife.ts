import * as THREE from 'three/webgpu';
import { attribute, float, hash, instanceIndex, instancedBufferAttribute, mix, positionLocal, sin, time, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RouteTrack, TrackSample } from '@allezrobert/shared';
import { rng } from '../engine/noise.ts';
import { SPLAT_CHANNELS, type LoadedTile } from './types.ts';
import { splatAt } from './splat.ts';

/**
 * Abords de la route façon jeu vidéo (style low poly, voir engine/style.ts) : clôtures blanches ou en bois,
 * poteaux électriques et leurs câbles, fleurs et cailloux sur les bas-côtés, troupeaux de vaches, de
 * moutons et de chevaux qui broutent dans les prés. Tout est fait de primitives à facettes (quelques
 * dizaines de triangles), une seule instanciation par sorte d'objet pour tout le parcours : 8 appels
 * de dessin et une ligne pour les câbles, quel que soit le nombre d'objets.
 *
 * Le parcours est découpé en tronçons de CHUNK_M ; un tronçon est peuplé quand le coureur en approche
 * et que le terrain y est chargé (altitudes, occupation du sol), et oublié une fois loin derrière.
 */

const CHUNK_M = 120;
/** Tronçons peuplés jusqu'à cette distance du coureur (m), oubliés au-delà de FORGET_M. */
const BUILD_M = 650;
const FORGET_M = 900;

const CH = Object.fromEntries(SPLAT_CHANNELS.map((c, i) => [c, i])) as Record<(typeof SPLAT_CHANNELS)[number], number>;

type Kind = 'post' | 'rail' | 'pole' | 'flower' | 'rock' | 'cow' | 'sheep' | 'horse';
const KINDS: Kind[] = ['post', 'rail', 'pole', 'flower', 'rock', 'cow', 'sheep', 'horse'];
/** Instances au plus par sorte (tous tronçons peuplés confondus). */
const CAPACITY: Record<Kind, number> = { post: 6000, rail: 12000, pole: 400, flower: 8000, rock: 800, cow: 400, sheep: 600, horse: 200 };

const WHITE = new THREE.Color('#f2f0ea');
const WOOD = new THREE.Color('#7a5434');
const FLOWERS = ['#e0413a', '#f07aa8', '#f7f4ee', '#f4cf3a', '#9a6bd8', '#ff8a3d'].map((c) => new THREE.Color(c));
const COWS = ['#f4f1ea', '#8a5a36', '#3a2c24', '#c98a4f'].map((c) => new THREE.Color(c));
const HORSES = ['#6b4128', '#3d2a1e', '#a9733f', '#d9cfc0'].map((c) => new THREE.Color(c));

interface Instance {
  m: THREE.Matrix4;
  c: THREE.Color;
}

interface Chunk {
  k: number;
  items: Record<Kind, Instance[]>;
  /** Câbles électriques : segments (x0,y0,z0,x1,y1,z1)… */
  wires: number[];
}

/**
 * Géométrie à facettes avec deux attributs : `tint` (1 = prend la couleur de l'instance, 0 = couleur
 * propre du sommet, p. ex. sabots ou museau) et `head` (1 = tête, qui s'abaisse pour brouter).
 */
function part(g: THREE.BufferGeometry, col: THREE.ColorRepresentation, tint: number, head = 0): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  ng.deleteAttribute('uv');
  const n = ng.getAttribute('position').count;
  const c = new THREE.Color(col);
  const cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(cols, i * 3);
  ng.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  ng.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(n).fill(tint), 1));
  ng.setAttribute('head', new THREE.BufferAttribute(new Float32Array(n).fill(head), 1));
  return ng;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const merge = (parts: THREE.BufferGeometry[]) => mergeGeometries(parts, false) as THREE.BufferGeometry;

/** Pattes : quatre pavés sous le corps, couleur propre (sabots compris). */
function legs(len: number, halfX: number, halfZ: number, w: number, col: string): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(part(box(w, len, w, sx * halfX, len / 2, sz * halfZ), col, 0));
  return out;
}

/** Vache (tête vers +x), ≈ 130 triangles. Robe = couleur de l'instance, taches sombres sur les vaches claires. */
function cowGeometry(): THREE.BufferGeometry {
  return merge([
    part(box(1.7, 0.8, 0.75, 0, 1.1, 0), '#ffffff', 1),
    part(box(0.7, 0.42, 0.77, -0.25, 1.25, 0), '#2b2420', 0),
    part(box(0.3, 0.3, 0.77, 0.45, 0.98, 0), '#2b2420', 0),
    part(box(0.25, 0.5, 0.35, 0.95, 1.2, 0), '#ffffff', 1, 1),
    part(box(0.42, 0.38, 0.4, 1.2, 1.15, 0), '#ffffff', 1, 1),
    part(box(0.12, 0.2, 0.36, 1.43, 1.05, 0), '#e7a9a0', 0, 1),
    part(box(0.06, 0.16, 0.06, 1.15, 1.42, 0.16), '#e8e2d2', 0, 1),
    part(box(0.06, 0.16, 0.06, 1.15, 1.42, -0.16), '#e8e2d2', 0, 1),
    part(box(0.05, 0.6, 0.05, -0.88, 1.05, 0), '#2b2420', 0),
    ...legs(0.72, 0.6, 0.24, 0.17, '#3a302a'),
  ]);
}

/** Mouton : toison en icosaèdre, tête et pattes sombres, ≈ 120 triangles. */
function sheepGeometry(): THREE.BufferGeometry {
  return merge([
    part(new THREE.IcosahedronGeometry(0.55, 0).scale(1.35, 0.95, 1).translate(0, 0.78, 0), '#ffffff', 1),
    part(box(0.3, 0.3, 0.26, 0.7, 0.82, 0), '#2a2522', 0, 1),
    part(box(0.1, 0.06, 0.4, 0.66, 0.92, 0), '#2a2522', 0, 1),
    ...legs(0.45, 0.32, 0.18, 0.09, '#2a2522'),
  ]);
}

/** Cheval : corps, encolure et tête inclinées, crinière et queue, ≈ 150 triangles. */
function horseGeometry(): THREE.BufferGeometry {
  const neck = new THREE.BoxGeometry(0.32, 0.85, 0.3).rotateZ(-0.6).translate(0.95, 1.85, 0);
  const headG = new THREE.BoxGeometry(0.62, 0.26, 0.26).rotateZ(-0.5).translate(1.38, 2.05, 0);
  const mane = new THREE.BoxGeometry(0.08, 0.8, 0.12).rotateZ(-0.6).translate(0.85, 1.98, 0);
  const tail = new THREE.BoxGeometry(0.1, 0.75, 0.1).rotateZ(0.35).translate(-1.0, 1.25, 0);
  return merge([
    part(box(1.65, 0.62, 0.55, 0, 1.45, 0), '#ffffff', 1),
    part(neck, '#ffffff', 1, 1),
    part(headG, '#ffffff', 1, 1),
    part(mane, '#2a1d15', 0, 1),
    part(tail, '#2a1d15', 0),
    ...legs(1.15, 0.62, 0.18, 0.13, '#2a1d15'),
  ]);
}

/** Poteau électrique en bois avec sa traverse et trois isolateurs (8,5 m). */
function poleGeometry(): THREE.BufferGeometry {
  return merge([
    part(new THREE.CylinderGeometry(0.1, 0.14, 8.6, 6).translate(0, 4.3, 0), '#ffffff', 1),
    part(box(0.12, 0.14, 1.7, 0, 8.05, 0), '#5a3e28', 0),
    part(box(0.08, 0.16, 0.08, 0, 8.2, -0.7), '#d8d8d0', 0),
    part(box(0.08, 0.16, 0.08, 0, 8.2, 0), '#d8d8d0', 0),
    part(box(0.08, 0.16, 0.08, 0, 8.2, 0.7), '#d8d8d0', 0),
  ]);
}

/** Fleur : tige verte et corolle colorée (instance). */
function flowerGeometry(): THREE.BufferGeometry {
  return merge([part(box(0.025, 0.36, 0.025, 0, 0.18, 0), '#4f8a2c', 0), part(new THREE.OctahedronGeometry(0.075, 0).scale(1, 0.6, 1).translate(0, 0.38, 0), '#ffffff', 1)]);
}

/** Matériau commun : aplats à facettes, broutage (la tête descend et remonte, phase par instance). */
function lifeMaterial(icol: THREE.InstancedBufferAttribute, graze: boolean): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 });
  m.flatShading = true;
  const own = attribute<'vec3'>('color');
  const tint = attribute<'float'>('tint');
  const inst = instancedBufferAttribute(icol) as unknown as THREE.Node<'vec3'>;
  m.colorNode = mix(own, own.mul(inst), tint);
  if (graze) {
    const h = hash(instanceIndex);
    const head = attribute<'float'>('head');
    // Tête baissée la plupart du temps, relevée de temps en temps (lent, décalé d'un animal à l'autre).
    const cycle = sin(time.mul(float(0.35).add(h.mul(0.2))).add(h.mul(40))).mul(0.5).add(0.5);
    m.positionNode = positionLocal.add(vec3(0, head.mul(cycle.mul(0.55).sub(0.45)), 0));
  }
  return m;
}

export class RoadsideLife {
  readonly group = new THREE.Group();
  private readonly track: RouteTrack;
  private readonly heightAt: (x: number, z: number) => number;
  private readonly tileAt: (x: number, z: number) => LoadedTile | undefined;
  private readonly chunks = new Map<number, Chunk>();
  private readonly meshes = {} as Record<Kind, { mesh: THREE.InstancedMesh; icol: THREE.InstancedBufferAttribute }>;
  private readonly wires: THREE.LineSegments;
  private readonly wirePos: THREE.BufferAttribute;
  private readonly halfRoad: number;
  private dirty = false;
  private pending = true;
  private readonly last = new THREE.Vector3(Infinity, 0, 0);
  private readonly s = { x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, grade: 0, d: 0 } as TrackSample;

  constructor(track: RouteTrack, heightAt: (x: number, z: number) => number, tileAt: (x: number, z: number) => LoadedTile | undefined) {
    this.track = track;
    this.heightAt = heightAt;
    this.tileAt = tileAt;
    this.halfRoad = track.route.roadWidthM / 2;
    this.group.name = 'roadside-life';
    const geos: Record<Kind, THREE.BufferGeometry> = {
      post: part(box(0.13, 1.15, 0.13, 0, 0.575, 0), '#ffffff', 1),
      rail: part(box(1, 0.09, 0.05, 0.5, 0, 0), '#ffffff', 1),
      pole: poleGeometry(),
      flower: flowerGeometry(),
      rock: part(new THREE.DodecahedronGeometry(1, 0), '#ffffff', 1),
      cow: cowGeometry(),
      sheep: sheepGeometry(),
      horse: horseGeometry(),
    };
    for (const kind of KINDS) {
      const n = CAPACITY[kind];
      const icol = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
      icol.setUsage(THREE.DynamicDrawUsage);
      const mesh = new THREE.InstancedMesh(geos[kind], lifeMaterial(icol, kind === 'cow' || kind === 'sheep' || kind === 'horse'), n);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = kind !== 'flower' && kind !== 'rail';
      mesh.receiveShadow = true;
      mesh.name = `life-${kind}`;
      this.meshes[kind] = { mesh, icol };
      this.group.add(mesh);
    }
    this.wirePos = new THREE.BufferAttribute(new Float32Array(60000 * 3), 3);
    this.wirePos.setUsage(THREE.DynamicDrawUsage);
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', this.wirePos);
    wg.setDrawRange(0, 0);
    this.wires = new THREE.LineSegments(wg, new THREE.LineBasicNodeMaterial({ color: '#2a2a2a' }));
    this.wires.frustumCulled = false;
    this.wires.name = 'life-wires';
    this.group.add(this.wires);
  }

  /** Peuple les tronçons proches de `focus` (terrain chargé) et oublie les lointains. */
  update(focus: THREE.Vector3): void {
    // Revu tous les 15 m parcourus, ou à chaque image tant qu'un tronçon proche attend son terrain.
    if (!this.pending && this.last.distanceToSquared(focus) < 225) return;
    this.last.copy(focus);
    this.pending = false;
    const n = Math.ceil(this.track.length / CHUNK_M);
    let built = 0;
    for (let k = 0; k < n; k++) {
      const p = this.track.positionAt((k + 0.5) * CHUNK_M, 0, this.s);
      const dist = Math.hypot(p.x - focus.x, p.z - focus.z);
      const has = this.chunks.has(k);
      if (has && dist > FORGET_M) {
        this.chunks.delete(k);
        this.dirty = true;
      } else if (!has && dist < BUILD_M) {
        if (built >= 2) {
          this.pending = true;
          continue;
        }
        const c = this.build(k);
        if (!c) this.pending = true;
        if (c) {
          this.chunks.set(k, c);
          this.dirty = true;
          built++;
        }
      }
    }
    if (this.dirty) this.flush();
  }

  /** Occupation du sol (0–1) d'un canal à une position monde ; -1 si la tuile n'est pas chargée. */
  private land(ch: number, x: number, z: number): number {
    const t = this.tileAt(x, z);
    return t ? splatAt(t, ch, x, z) : -1;
  }

  /**
   * Terre ouverte : ni bourg, ni bois, ni eau, ni route. Les terres sans occupation renseignée (aucun
   * canal) comptent comme prés : le terrain les peint ainsi.
   */
  private openLand(x: number, z: number): boolean {
    const t = this.tileAt(x, z);
    if (!t) return false;
    const at = (ch: number) => splatAt(t, ch, x, z);
    return at(CH.urban) < 0.3 && at(CH.forest) < 0.4 && at(CH.water) < 0.2 && at(CH.road) < 0.25;
  }

  private build(k: number): Chunk | null {
    const d0 = k * CHUNK_M;
    const d1 = Math.min(d0 + CHUNK_M, this.track.length);
    // Terrain chargé aux deux bouts et au milieu (sinon on réessaiera).
    for (const d of [d0, (d0 + d1) / 2, d1]) {
      const p = this.track.positionAt(d, 0, this.s);
      if (!Number.isFinite(this.heightAt(p.x, p.z)) || !this.tileAt(p.x, p.z)) return null;
    }
    const items = Object.fromEntries(KINDS.map((kd) => [kd, [] as Instance[]])) as Record<Kind, Instance[]>;
    const wires: number[] = [];
    const r = rng(k * 7919 + 13);
    const half = this.halfRoad;
    const s = this.s;
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const xAxis = new THREE.Vector3(1, 0, 0);
    const v = new THREE.Vector3();
    const put = (kind: Kind, x: number, y: number, z: number, yaw: number, scale: THREE.Vector3 | number, c: THREE.Color) => {
      q.setFromAxisAngle(up, yaw);
      const sc = typeof scale === 'number' ? new THREE.Vector3(scale, scale, scale) : scale;
      items[kind].push({ m: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q.clone(), sc), c });
    };
    const ground = (x: number, z: number) => this.heightAt(x, z);

    // ── Clôtures : même type sur de longues portions (par tranches de 360 m et par côté) ──
    for (const side of [-1, 1]) {
      const pick = rng(Math.floor(d0 / 360) * 31 + (side > 0 ? 7 : 3))();
      const type = pick < 0.4 ? 0 : pick < 0.72 ? 1 : 2;
      if (!type) continue;
      const col = type === 1 ? WHITE : WOOD;
      const lat = side * (half + 2.3);
      let prev: THREE.Vector3 | null = null;
      for (let d = d0; d <= d1; d += 2.4) {
        this.track.positionAt(d, lat, s);
        const y = ground(s.x, s.z);
        if (!Number.isFinite(y) || !this.openLand(s.x, s.z)) {
          prev = null;
          continue;
        }
        put('post', s.x, y, s.z, Math.atan2(-s.dirZ, s.dirX), 1, col);
        const cur = new THREE.Vector3(s.x, y, s.z);
        if (prev && prev.distanceTo(cur) < 4) {
          v.subVectors(cur, prev);
          const len = v.length();
          q.setFromUnitVectors(xAxis, v.normalize());
          for (const h of type === 1 ? [0.55, 0.95] : [0.4, 0.75, 1.05]) {
            items.rail.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(prev.x, prev.y + h, prev.z), q.clone(), new THREE.Vector3(len, 1, 1)), c: col });
          }
        }
        prev = cur;
      }
    }

    // ── Poteaux électriques : un côté par tranche de 600 m, tous les 45 m, câbles entre deux poteaux ──
    const poleSide = rng(Math.floor(d0 / 600) * 17 + 5)() < 0.5 ? -1 : 1;
    const poleOn = rng(Math.floor(d0 / 600) * 23 + 9)() < 0.75;
    if (poleOn) {
      const lat = poleSide * (half + 5.5);
      const first = Math.ceil(d0 / 45) * 45;
      for (let d = first; d < d1; d += 45) {
        const a = this.polePoint(d, lat);
        if (!a) continue;
        put('pole', a.x, a.y, a.z, Math.atan2(-a.dirZ, a.dirX), 1, WOOD);
        const b = this.polePoint(d + 45, lat);
        if (!b) continue;
        // Trois câbles (bouts de la traverse et milieu), flèche de 0,7 m au milieu de la portée.
        for (const off of [-0.7, 0, 0.7]) {
          // traverse perpendiculaire à la route : décalage selon la normale (−dirZ, dirX)
          const pa = new THREE.Vector3(a.x - a.dirZ * off, a.y + 8.3, a.z + a.dirX * off);
          const pb = new THREE.Vector3(b.x - b.dirZ * off, b.y + 8.3, b.z + b.dirX * off);
          const SEG = 8;
          for (let i = 0; i < SEG; i++) {
            for (const t of [i / SEG, (i + 1) / SEG]) {
              const sag = 4 * 0.7 * t * (1 - t);
              wires.push(pa.x + (pb.x - pa.x) * t, pa.y + (pb.y - pa.y) * t - sag, pa.z + (pb.z - pa.z) * t);
            }
          }
        }
      }
    }

    // ── Fleurs en touffes et cailloux sur les bas-côtés ──
    for (let d = d0; d < d1; d += 3) {
      for (const side of [-1, 1]) {
        if (r() > 0.42) continue;
        const lat = side * (half + 0.9 + r() * 5);
        this.track.positionAt(d + r() * 3, lat, s);
        if (!this.openLand(s.x, s.z)) continue;
        const col = FLOWERS[Math.floor(r() * FLOWERS.length)] as THREE.Color;
        const n = 2 + Math.floor(r() * 5);
        for (let i = 0; i < n; i++) {
          const x = s.x + (r() - 0.5) * 1.4;
          const z = s.z + (r() - 0.5) * 1.4;
          const y = ground(x, z);
          if (Number.isFinite(y)) put('flower', x, y, z, r() * 6.28, 0.8 + r() * 0.6, col);
        }
      }
      if (r() < 0.06) {
        const side = r() < 0.5 ? -1 : 1;
        this.track.positionAt(d, side * (half + 1.5 + r() * 7), s);
        const y = ground(s.x, s.z);
        if (Number.isFinite(y) && this.openLand(s.x, s.z)) {
          const sc = 0.2 + r() * 0.45;
          const grey = new THREE.Color().setHSL(0.08, 0.06, 0.45 + r() * 0.15);
          put('rock', s.x, y - sc * 0.35, s.z, r() * 6.28, new THREE.Vector3(sc * 1.2, sc * 0.8, sc), grey);
        }
      }
    }

    // ── Troupeaux dans les prés, derrière les clôtures ──
    if (r() < 0.55) {
      const side = r() < 0.5 ? -1 : 1;
      const kind: Kind = r() < 0.45 ? 'cow' : r() < 0.7 ? 'sheep' : 'horse';
      const lat = side * (half + 16 + r() * 40);
      this.track.positionAt(d0 + r() * (d1 - d0), lat, s);
      const cx = s.x;
      const cz = s.z;
      if (this.openLand(cx, cz)) {
        const count = kind === 'cow' ? 3 + Math.floor(r() * 5) : kind === 'sheep' ? 5 + Math.floor(r() * 9) : 2 + Math.floor(r() * 3);
        const spread = kind === 'sheep' ? 9 : 13;
        const herdCol = kind === 'cow' ? (COWS[Math.floor(r() * COWS.length)] as THREE.Color) : null;
        for (let i = 0; i < count; i++) {
          const x = cx + (r() - 0.5) * 2 * spread;
          const z = cz + (r() - 0.5) * 2 * spread;
          const y = ground(x, z);
          if (!Number.isFinite(y) || !this.openLand(x, z)) continue;
          const col =
            kind === 'cow'
              ? r() < 0.75
                ? (herdCol as THREE.Color)
                : (COWS[Math.floor(r() * COWS.length)] as THREE.Color)
              : kind === 'horse'
                ? (HORSES[Math.floor(r() * HORSES.length)] as THREE.Color)
                : new THREE.Color().setHSL(0.11, 0.15, 0.88 + r() * 0.08);
          put(kind, x, y, z, r() * 6.28, 0.9 + r() * 0.2, col);
        }
      }
    }
    return { k, items, wires };
  }

  /** Pied d'un poteau à la distance `d` (null hors des terres ouvertes ou sur terrain non chargé). */
  private polePoint(d: number, lat: number): { x: number; y: number; z: number; dirX: number; dirZ: number } | null {
    if (d > this.track.length) return null;
    const p = this.track.positionAt(d, lat, { x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, grade: 0, d: 0 });
    const y = this.heightAt(p.x, p.z);
    if (!Number.isFinite(y) || this.land(CH.forest, p.x, p.z) > 0.5 || this.land(CH.water, p.x, p.z) > 0.2 || this.land(CH.road, p.x, p.z) > 0.25 || this.land(CH.urban, p.x, p.z) > 0.6) return null;
    return { x: p.x, y, z: p.z, dirX: p.dirX, dirZ: p.dirZ };
  }

  /** Recopie les instances des tronçons peuplés dans les tampons de dessin. */
  private flush(): void {
    this.dirty = false;
    for (const kind of KINDS) {
      const { mesh, icol } = this.meshes[kind];
      let i = 0;
      for (const c of this.chunks.values())
        for (const it of c.items[kind]) {
          if (i >= CAPACITY[kind]) break;
          mesh.setMatrixAt(i, it.m);
          icol.setXYZ(i, it.c.r, it.c.g, it.c.b);
          i++;
        }
      mesh.count = i;
      mesh.instanceMatrix.needsUpdate = true;
      icol.needsUpdate = true;
    }
    const arr = this.wirePos.array as Float32Array;
    let n = 0;
    for (const c of this.chunks.values()) {
      if (n + c.wires.length > arr.length) break;
      arr.set(c.wires, n);
      n += c.wires.length;
    }
    this.wirePos.needsUpdate = true;
    this.wires.geometry.setDrawRange(0, n / 3);
  }

  dispose(): void {
    for (const kind of KINDS) {
      this.meshes[kind].mesh.geometry.dispose();
      (this.meshes[kind].mesh.material as THREE.Material).dispose();
    }
    this.wires.geometry.dispose();
    (this.wires.material as THREE.Material).dispose();
  }
}
