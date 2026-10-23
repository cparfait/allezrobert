import * as THREE from 'three/webgpu';
import { attribute, uv, vec3, float, uniform, mix, smoothstep, step, fract, abs, mx_noise_float, positionWorld, max, varying } from 'three/tsl';
import type { QualitySettings } from '../engine/quality.ts';
import type { LoadedTile } from './types.ts';
import { assembleLines, pointAt, RER, trainsAt, type RailLine, type RailPiece } from './railgeom.ts';

/** Écartement des rails (m, entre axes des files de rails). */
const GAUGE = 1.505;
const CAR_LEN = 25.6;
const CAR_PITCH = 26;
const CARS = 8;
const MAX_TRAINS = 6;

/** Ajoute une boîte (non indexée) à un tampon position / uv / kind. */
function pushBox(pos: number[], uvs: number[], kinds: number[], kind: number, c: THREE.Vector3, ux: THREE.Vector3, uy: THREE.Vector3, uz: THREE.Vector3, hx: number, hy: number, hz: number): void {
  const corner = (sx: number, sy: number, sz: number) => c.clone().addScaledVector(ux, sx * hx).addScaledVector(uy, sy * hy).addScaledVector(uz, sz * hz);
  const faces: Array<[number, number, number][]> = [
    [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]],
    [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]],
    [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]],
    [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
    [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]],
  ];
  for (const f of faces) {
    const v = f.map(([a, b, d]) => corner(a, b, d));
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const p = v[k] as THREE.Vector3;
      pos.push(p.x, p.y, p.z);
      uvs.push(k === 1 || k === 2 ? 1 : 0, k >= 2 ? 1 : 0);
      kinds.push(kind);
    }
  }
}

/**
 * Voiture de RER générique (sans logo ni livrée d'exploitant) : caisse extrudée à toit bombé,
 * bogies, équipements de toiture. Repère : +z vers l'avant, y = 0 au niveau du rail.
 * Attribut `part` : 0 caisse, 1 bogie / châssis, 2 toiture.
 */
function carGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const w = 1.45;
  shape.moveTo(-w, 1.1);
  shape.lineTo(w, 1.1);
  shape.lineTo(w, 3.55);
  shape.quadraticCurveTo(w, 4.05, w - 0.6, 4.1);
  shape.lineTo(-w + 0.6, 4.1);
  shape.quadraticCurveTo(-w, 4.05, -w, 3.55);
  shape.lineTo(-w, 1.1);
  const body = new THREE.ExtrudeGeometry(shape, { depth: CAR_LEN, bevelEnabled: false, curveSegments: 3 }).translate(0, 0, -CAR_LEN / 2).toNonIndexed();
  body.deleteAttribute('uv');
  const n = body.getAttribute('position').count;
  body.setAttribute('part', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
  const pos: number[] = [];
  const uvs: number[] = [];
  const kinds: number[] = [];
  const X = new THREE.Vector3(1, 0, 0);
  const Y = new THREE.Vector3(0, 1, 0);
  const Z = new THREE.Vector3(0, 0, 1);
  for (const z of [-9.4, 9.4]) pushBox(pos, uvs, kinds, 1, new THREE.Vector3(0, 0.62, z), X, Y, Z, 1.25, 0.45, 1.5);
  pushBox(pos, uvs, kinds, 1, new THREE.Vector3(0, 1.0, 0), X, Y, Z, 1.3, 0.14, CAR_LEN / 2 - 0.4);
  pushBox(pos, uvs, kinds, 2, new THREE.Vector3(0, 4.25, 3), X, Y, Z, 0.7, 0.18, 2.2);
  const extra = new THREE.BufferGeometry();
  extra.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  extra.setAttribute('part', new THREE.Float32BufferAttribute(kinds, 1));
  extra.computeVertexNormals();
  body.computeVertexNormals();
  const merged = new THREE.BufferGeometry();
  const p1 = body.getAttribute('position').array as Float32Array;
  const n1 = body.getAttribute('normal').array as Float32Array;
  const k1 = body.getAttribute('part').array as Float32Array;
  merged.setAttribute('position', new THREE.Float32BufferAttribute([...p1, ...pos], 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute([...n1, ...(extra.getAttribute('normal').array as Float32Array)], 3));
  merged.setAttribute('part', new THREE.Float32BufferAttribute([...k1, ...kinds], 1));
  return merged;
}

interface TileRails {
  mesh: THREE.Mesh | null;
  pieces: RailPiece[];
}

/**
 * Voies ferrées OSM (ballast, traverses, rails, caténaire) et trains de banlieue cadencés.
 * Les voies sont posées sur un profil lissé du terrain (ponts : interpolés entre culées) ; les
 * lignes continues sont reconstituées à travers les tuiles chargées, et des rames de 8 voitures
 * y circulent selon un horaire plausible (railgeom.ts) : terminus avec arrêt à quai et
 * rebroussement, ou passage à 90 km/h. Un appel de dessin par tuile pour les voies, un seul
 * (instancié) pour toutes les voitures.
 */
export class Railways {
  readonly group = new THREE.Group();
  /** 1 la nuit : fenêtres éclairées. */
  readonly night = uniform(0);
  private readonly trackMat: THREE.MeshStandardNodeMaterial;
  private readonly cars: THREE.InstancedMesh;
  private readonly carEnds: THREE.InstancedBufferAttribute;
  private readonly tiles = new Map<string, TileRails>();
  private lines: RailLine[] = [];
  private anchors: Array<{ x: number; z: number }> = [];
  private dirty = false;
  private readonly groundAt: (x: number, z: number) => number;
  private props: number;
  /** Horloge du jeu (s depuis minuit). */
  clock = 10 * 3600;

  constructor(q: QualitySettings, groundAt: (x: number, z: number) => number) {
    this.groundAt = groundAt;
    this.props = q.propDensity;
    this.group.name = 'railways';
    this.trackMat = this.createTrackMaterial();
    const geo = carGeometry();
    this.carEnds = new THREE.InstancedBufferAttribute(new Float32Array(MAX_TRAINS * CARS * 2), 2);
    geo.setAttribute('ends', this.carEnds);
    this.cars = new THREE.InstancedMesh(geo, this.createCarMaterial(), MAX_TRAINS * CARS);
    this.cars.count = 0;
    this.cars.frustumCulled = false;
    this.cars.castShadow = true;
    this.cars.receiveShadow = true;
    this.cars.name = 'trains';
    this.group.add(this.cars);
  }

  private createTrackMaterial(): THREE.MeshStandardNodeMaterial {
    const m = new THREE.MeshStandardNodeMaterial();
    const kind = attribute<'float'>('rk'); // 0 ballast, 1 rail, 2 caténaire / poteau
    const across = uv().x;
    const along = uv().y;
    const n = mx_noise_float(positionWorld.mul(3.1)).mul(0.5).add(0.5);
    const n2 = mx_noise_float(positionWorld.mul(0.4)).mul(0.5).add(0.5);
    const ballast = mix(vec3(0.42, 0.4, 0.37), vec3(0.33, 0.27, 0.22), n2.mul(0.6)).mul(n.mul(0.35).add(0.75));
    // Traverses béton tous les 60 cm sous les rails.
    const sleeper = step(fract(along.div(0.6)), float(0.38)).mul(step(abs(across), float(1.25)));
    const concrete = vec3(0.55, 0.54, 0.5).mul(n.mul(0.15).add(0.9));
    let col = mix(ballast, concrete, sleeper);
    const isRail = step(float(0.5), kind).mul(step(kind, float(1.5)));
    const isMetal = step(float(1.5), kind);
    col = mix(col, vec3(0.36, 0.3, 0.26), isRail);
    col = mix(col, vec3(0.32, 0.33, 0.34), isMetal);
    m.colorNode = col;
    // Dessus de rail poli (brillant), côtés rouillés.
    const railTop = isRail.mul(smoothstep(0.6, 0.9, attribute<'vec3'>('normal').y));
    m.roughnessNode = mix(mix(float(0.95), float(0.55), isRail), float(0.25), railTop).sub(isMetal.mul(0.3));
    m.metalnessNode = max(railTop.mul(0.9), isMetal.mul(0.6));
    return m;
  }

  private createCarMaterial(): THREE.MeshStandardNodeMaterial {
    const m = new THREE.MeshStandardNodeMaterial();
    const part = attribute<'float'>('part');
    const raw = attribute<'vec3'>('position');
    const ends = attribute<'vec2'>('ends');
    const y = raw.y;
    const z = raw.z;
    const side = smoothstep(1.3, 1.44, abs(raw.x)); // faces latérales
    const half = CAR_LEN / 2;
    // Portes : 3 par face (2 baies de 1,3 m), fenêtres en bandeau entre 2,0 et 3,0 m, montants tous les 1,6 m.
    const dz = abs(z);
    const door = max(step(abs(z.sub(6.5)), float(0.7)), max(step(abs(z), float(0.7)), step(abs(z.add(6.5)), float(0.7)))).mul(side).mul(step(y, float(3.3)));
    const winBand = step(float(2.0), y).mul(step(y, float(3.0))).mul(side);
    const pillar = step(fract(z.div(1.6)), float(0.12));
    const window = winBand.mul(float(1).sub(pillar)).mul(step(dz, float(half - 1.2)));
    const lower = step(y, float(1.55)).mul(step(float(1.12), y)); // bandeau bas bleu
    const white = vec3(0.86, 0.87, 0.85);
    const blue = vec3(0.12, 0.23, 0.5);
    const glass = vec3(0.05, 0.07, 0.09);
    const doorCol = vec3(0.62, 0.64, 0.66);
    let col: THREE.Node<'vec3'> = white;
    col = mix(col, blue, lower);
    col = mix(col, doorCol, door);
    col = mix(col, glass, max(window, door.mul(step(float(1.7), y)).mul(step(y, float(2.9)))));
    // Faces d'extrémité : cabine (grand pare-brise sombre) si l'extrémité est une tête ou une queue.
    const atEnd = smoothstep(half - 0.05, half, dz);
    const endKind = mix(ends.x, ends.y, step(float(0), z)); // 0 intercirculation, 1 tête, 2 queue
    const cab = atEnd.mul(step(float(0.5), endKind));
    col = mix(col, glass, cab.mul(step(float(2.3), y)).mul(step(y, float(3.4))).mul(step(abs(raw.x), float(1.2))));
    col = mix(col, vec3(0.12, 0.12, 0.13), step(float(0.5), part).mul(step(part, float(1.5))));
    col = mix(col, vec3(0.45, 0.46, 0.48), step(float(1.5), part));
    m.colorNode = varying(col);
    // Feux : deux phares blancs en tête, deux feux rouges en queue.
    const lamp = cab.mul(step(abs(abs(raw.x).sub(0.95)), float(0.17))).mul(step(abs(y.sub(1.55)), float(0.13)));
    const head = step(abs(endKind.sub(1)), float(0.5));
    const lampCol = mix(vec3(3.0, 0.15, 0.1), vec3(4.0, 3.8, 3.4), head);
    const lit = window.mul(this.night).mul(float(1).sub(part.min(1)));
    m.emissiveNode = lampCol.mul(lamp).add(vec3(1.0, 0.92, 0.75).mul(lit.mul(0.9)));
    m.roughnessNode = mix(float(0.45), float(0.12), window);
    m.metalnessNode = mix(float(0.1), float(0.5), step(float(0.5), part));
    return m;
  }

  /** Hauteur du haut du rail : sol moyen sur un disque de 10 m (gomme les talus du MNT) + ballast. */
  private railY(x: number, z: number): number {
    let sum = 0;
    let n = 0;
    for (const [ox, oz] of [
      [0, 0],
      [10, 0],
      [-10, 0],
      [0, 10],
      [0, -10],
      [7, 7],
      [-7, 7],
      [7, -7],
      [-7, -7],
    ] as const) {
      const g = this.groundAt(x + ox, z + oz);
      if (Number.isFinite(g)) {
        sum += g;
        n++;
      }
    }
    return n ? sum / n + 0.55 : Number.NaN;
  }

  addTile(tile: LoadedTile): void {
    if (this.tiles.has(tile.id)) return;
    const pieces: RailPiece[] = [];
    const pos: number[] = [];
    const uvs: number[] = [];
    const kinds: number[] = [];
    const up = new THREE.Vector3(0, 1, 0);
    for (const r of tile.features.railways ?? []) {
      if (r.tunnel || r.pts.length < 4) continue;
      // Rééchantillonnage tous les 4 m, altitude lissée (ponts : droite entre les culées).
      const src = r.pts;
      const pts: number[] = [];
      for (let i = 0; i < src.length / 2 - 1; i++) {
        const ax = src[i * 2] as number;
        const az = src[i * 2 + 1] as number;
        const bx = src[i * 2 + 2] as number;
        const bz = src[i * 2 + 3] as number;
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 4));
        for (let k = 0; k < steps; k++) pts.push(ax + ((bx - ax) * k) / steps, 0, az + ((bz - az) * k) / steps);
      }
      pts.push(src[src.length - 2] as number, 0, src[src.length - 1] as number);
      const np = pts.length / 3;
      if (r.bridge) {
        const y0 = this.railY(pts[0] as number, pts[2] as number);
        const y1 = this.railY(pts[(np - 1) * 3] as number, pts[(np - 1) * 3 + 2] as number);
        for (let i = 0; i < np; i++) pts[i * 3 + 1] = y0 + ((y1 - y0) * i) / Math.max(np - 1, 1);
      } else for (let i = 0; i < np; i++) pts[i * 3 + 1] = this.railY(pts[i * 3] as number, pts[i * 3 + 2] as number);
      if (pts.some((v) => !Number.isFinite(v))) continue;
      pieces.push({ pts, ...(r.name ? { name: r.name } : {}) });
      this.buildTrack(pts, r.bridge === true, (r.name ?? '') !== '' && np * 4 > 120, pos, uvs, kinds, up);
    }
    let mesh: THREE.Mesh | null = null;
    if (pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.setAttribute('rk', new THREE.Float32BufferAttribute(kinds, 1));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      mesh = new THREE.Mesh(g, this.trackMat);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      mesh.name = `rails_${tile.id}`;
      this.group.add(mesh);
    }
    this.tiles.set(tile.id, { mesh, pieces });
    if (pieces.length) this.dirty = true;
  }

  /** Ballast trapézoïdal, deux files de rails, et (lignes principales) poteaux et fil de contact. */
  private buildTrack(pts: number[], bridge: boolean, catenary: boolean, pos: number[], uvs: number[], kinds: number[], up: THREE.Vector3): void {
    const n = pts.length / 3;
    const P = (i: number) => new THREE.Vector3(pts[i * 3] as number, pts[i * 3 + 1] as number, pts[i * 3 + 2] as number);
    const tan = (i: number) => P(Math.min(i + 1, n - 1)).sub(P(Math.max(i - 1, 0))).setY(0).normalize();
    // Profil en travers (décalage latéral, décalage vertical, kind) : ballast puis rails.
    const ballast: Array<[number, number | 'ground']> = [
      [-2.7, 'ground'],
      [-1.7, -0.32],
      [1.7, -0.32],
      [2.7, 'ground'],
    ];
    let along = 0;
    const rows: THREE.Vector3[][] = [];
    const alongs: number[] = [];
    for (let i = 0; i < n; i++) {
      const p = P(i);
      if (i > 0) along += p.distanceTo(P(i - 1));
      const side = new THREE.Vector3().crossVectors(up, tan(i)).normalize(); // vers la gauche
      rows.push(
        ballast.map(([o, h]) => {
          const q = p.clone().addScaledVector(side, o);
          const g = this.groundAt(q.x, q.z);
          q.y = h === 'ground' ? (bridge || !Number.isFinite(g) ? p.y - 1.2 : Math.min(g, p.y - 0.32) - 0.25) : p.y + h;
          return q;
        }),
      );
      alongs.push(along);
    }
    const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, ua: [number, number], ub: [number, number], uc: [number, number], ud: [number, number], kind: number) => {
      for (const [v, u] of [
        [a, ua],
        [b, ub],
        [c, uc],
        [a, ua],
        [c, uc],
        [d, ud],
      ] as Array<[THREE.Vector3, [number, number]]>) {
        pos.push(v.x, v.y, v.z);
        uvs.push(u[0], u[1]);
        kinds.push(kind);
      }
    };
    const offs = [-2.7, -1.7, 1.7, 2.7];
    for (let i = 1; i < n; i++) {
      const r0 = rows[i - 1] as THREE.Vector3[];
      const r1 = rows[i] as THREE.Vector3[];
      for (let k = 0; k < 3; k++) {
        // Face vers le haut : de la gauche (+side) vers la droite, le long de la voie.
        quad(r0[k + 1] as THREE.Vector3, r1[k + 1] as THREE.Vector3, r1[k] as THREE.Vector3, r0[k] as THREE.Vector3, [-(offs[k + 1] as number), alongs[i - 1] as number], [-(offs[k + 1] as number), alongs[i] as number], [-(offs[k] as number), alongs[i] as number], [-(offs[k] as number), alongs[i - 1] as number], 0);
      }
      // Rails : dessus (7 cm) et deux flancs (17 cm).
      const a = P(i - 1);
      const b = P(i);
      const s0 = new THREE.Vector3().crossVectors(up, tan(i - 1)).normalize();
      const s1 = new THREE.Vector3().crossVectors(up, tan(i)).normalize();
      for (const rs of [-GAUGE / 2, GAUGE / 2]) {
        const at = (p: THREE.Vector3, s: THREE.Vector3, lat: number, dy: number) => p.clone().addScaledVector(s, rs + lat).add(new THREE.Vector3(0, dy, 0));
        const u0: [number, number] = [0, 0];
        quad(at(a, s0, 0.035, 0), at(b, s1, 0.035, 0), at(b, s1, -0.035, 0), at(a, s0, -0.035, 0), u0, u0, u0, u0, 1);
        quad(at(a, s0, 0.035, -0.17), at(b, s1, 0.035, -0.17), at(b, s1, 0.035, 0), at(a, s0, 0.035, 0), u0, u0, u0, u0, 1);
        quad(at(a, s0, -0.035, 0), at(b, s1, -0.035, 0), at(b, s1, -0.035, -0.17), at(a, s0, -0.035, -0.17), u0, u0, u0, u0, 1);
      }
      if (catenary && this.props > 0.5) {
        // Fil de contact (bande verticale de 4 cm) à 5,3 m au-dessus du rail.
        const w0 = a.clone().add(new THREE.Vector3(0, 5.3, 0));
        const w1 = b.clone().add(new THREE.Vector3(0, 5.3, 0));
        const zero: [number, number] = [0, 0];
        quad(w0, w1, w1.clone().setY(w1.y + 0.04), w0.clone().setY(w0.y + 0.04), zero, zero, zero, zero, 2);
        quad(w0.clone().setY(w0.y + 0.04), w1.clone().setY(w1.y + 0.04), w1, w0, zero, zero, zero, zero, 2);
      }
    }
    if (catenary && this.props > 0.5) {
      // Poteaux tous les ~56 m, à 3,2 m de l'axe, avec console au-dessus de la voie.
      const kinds2: number[] = [];
      const p2: number[] = [];
      const u2: number[] = [];
      for (let i = 0; i < n; i += 14) {
        const p = P(i);
        const t = tan(i);
        const s = new THREE.Vector3().crossVectors(up, t).normalize();
        const base = p.clone().addScaledVector(s, 3.2);
        pushBox(p2, u2, kinds2, 2, base.clone().add(new THREE.Vector3(0, 3.0, 0)), s, up, t, 0.12, 3.6, 0.12);
        pushBox(p2, u2, kinds2, 2, p.clone().addScaledVector(s, 1.6).add(new THREE.Vector3(0, 5.75, 0)), s, up, t, 1.7, 0.05, 0.05);
      }
      pos.push(...p2);
      uvs.push(...u2);
      kinds.push(...kinds2);
    }
  }

  removeTile(tile: LoadedTile): void {
    const t = this.tiles.get(tile.id);
    if (!t) return;
    if (t.mesh) {
      this.group.remove(t.mesh);
      t.mesh.geometry.dispose();
    }
    this.tiles.delete(tile.id);
    if (t.pieces.length) this.dirty = true;
  }

  /** Lignes ferroviaires assemblées (pour le contrôle du monde et les statistiques). */
  get railLines(): readonly RailLine[] {
    return this.lines;
  }

  private rebuildLines(): void {
    this.dirty = false;
    const all: RailPiece[] = [];
    for (const t of this.tiles.values()) all.push(...t.pieces);
    const near = (v: number) => Math.abs(v - Math.round(v / 1000) * 1000) < 0.6;
    const loaded = (x: number, z: number) => this.tiles.has(`${Math.floor(x / 1000)}_${Math.floor(z / 1000)}`);
    // Bord de tuile dont la voisine n'est pas chargée : la ligne continue au-delà.
    const onBoundary = (x: number, z: number) => (near(x) && !(loaded(x + 1, z) && loaded(x - 1, z))) || (near(z) && !(loaded(x, z + 1) && loaded(x, z - 1)));
    this.lines = assembleLines(all, onBoundary, 800);
    // Ancres : un point fixe du monde par ligne (le premier calcul), pour des horaires stables.
    this.anchors = this.lines.map((l) => {
      const prev = this.anchors.find((a) => nearestS(l, a.x, a.z).d < 30);
      return prev ?? { x: l.pts[Math.floor(l.pts.length / 6) * 3] as number, z: l.pts[Math.floor(l.pts.length / 6) * 3 + 2] as number };
    });
  }

  update(dt: number): void {
    this.clock += dt;
    if (this.dirty) this.rebuildLines();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const pa = { x: 0, y: 0, z: 0, dx: 0, dz: 0 };
    const pb = { x: 0, y: 0, z: 0, dx: 0, dz: 0 };
    const fwd = new THREE.Vector3();
    const look = new THREE.Matrix4();
    const zero = new THREE.Vector3();
    const upV = new THREE.Vector3(0, 1, 0);
    let count = 0;
    this.lines.forEach((line, li) => {
      const anchor = this.anchors[li];
      const s = anchor ? nearestS(line, anchor.x, anchor.z).s : 0;
      for (const tr of trainsAt(line, this.clock, RER, (li % 2) * 450 + 120, li % 2 === 0 ? 1 : -1, s)) {
        if (count + CARS > MAX_TRAINS * CARS) break;
        for (let c = 0; c < CARS; c++) {
          const s0 = tr.s0 + c * CAR_PITCH;
          pointAt(line, s0 + 3.4, pa);
          pointAt(line, s0 + CAR_LEN - 3.4, pb);
          fwd.set(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z);
          if (fwd.lengthSq() < 1e-6) fwd.set(pa.dx, 0, pa.dz);
          look.lookAt(zero, fwd, upV);
          q.setFromRotationMatrix(look);
          // lookAt oriente −z vers la cible : demi-tour pour que +z (avant de la voiture) suive la voie.
          q.multiply(new THREE.Quaternion().setFromAxisAngle(upV, Math.PI));
          m.compose(new THREE.Vector3((pa.x + pb.x) / 2, (pa.y + pb.y) / 2, (pa.z + pb.z) / 2), q, one);
          this.cars.setMatrixAt(count, m);
          // Extrémités : tête (1) dans le sens de marche, queue (2) à l'autre bout de la rame.
          const headHigh = tr.dir !== -1;
          const lowEnd = c === 0 ? (headHigh ? 2 : 1) : 0;
          const highEnd = c === CARS - 1 ? (headHigh ? 1 : 2) : 0;
          this.carEnds.setXY(count, lowEnd, highEnd);
          count++;
        }
      }
    });
    this.cars.count = count;
    this.cars.instanceMatrix.needsUpdate = true;
    this.carEnds.needsUpdate = true;
  }

  /** Nombre de voitures visibles (statistiques). */
  get visibleCars(): number {
    return this.cars.count;
  }
}

/** Abscisse du point d'une ligne le plus proche de (x, z). */
function nearestS(line: RailLine, x: number, z: number): { s: number; d: number } {
  let best = { s: 0, d: Infinity };
  for (let i = 0; i < line.pts.length / 3; i++) {
    const d = Math.hypot((line.pts[i * 3] as number) - x, (line.pts[i * 3 + 2] as number) - z);
    if (d < best.d) best = { s: line.s[i] as number, d };
  }
  return best;
}
