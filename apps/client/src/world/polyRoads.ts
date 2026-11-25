import * as THREE from 'three/webgpu';
import type { RoadGraphData } from '@allezrobert/shared';
import { MeshBuilder, box, flatVertexMaterial, part, prism, template, type LandProbe, type Template } from './lowPolyKit.ts';
import { NAME_H, NAME_W, glyphRect, nameRect, roadAtlas, signRect, type Glyph, type RoadAtlas, type UvRect } from './polyRoadAtlas.ts';
import { CELL_M, planRoads, type PlanPlace, type PlannedPanel, type PlannedSign, type PlannedTown, type RoadCell, type RoadPlan, type SignKind } from './polyRoadPlan.ts';
import { NETWORK_ROAD_LIFT } from './roadHeight.ts';

/**
 * Dessin de la signalisation du mode Poly (plan : polyRoadPlan.ts) autour du coureur : par case de CELL_M, un maillage
 * de peinture, un de poteaux et un de faces de panneaux (atlas partagé). Les cases arrivent une par mise à jour et
 * attendent que le terrain soit là.
 */
const BUILD_M = 340;
const FORGET_M = 430;
const SHADOW_M = 90;
/** Peinture au-dessus du ruban des routes (polylignes du graphe, voir roadHeight.ts). */
const PAINT_LIFT = NETWORK_ROAD_LIFT + 0.012;
/** Temps de calcul du plan par image (ms), pendant les premières secondes de la sortie. */
const PLAN_BUDGET_MS = 4;
const PAINT = new THREE.Color(0.86, 0.86, 0.82);
const WHITE = new THREE.Color(0xffffff);
const RED = new THREE.Color('#c8102e');
const BACK = new THREE.Color('#9aa0a4');
const RIM = new THREE.Color('#2c4a63');
const SQUARE = new Set<SignKind>(['zone30', 'pedestrians', 'chevronLeft', 'chevronRight']);

interface FaceSink {
  pos: number[];
  uv: number[];
  nor: number[];
}

interface Frame {
  x: number;
  y: number;
  z: number;
  /** Droite du lecteur, et normale de la face (vers lui). */
  rx: number;
  rz: number;
  nx: number;
  nz: number;
}

function frameOf(p: { x: number; z: number; dx: number; dz: number }, y: number): Frame {
  const L = Math.hypot(p.dx, p.dz) || 1;
  const dx = p.dx / L;
  const dz = p.dz / L;
  return { x: p.x, y, z: p.z, rx: -dz, rz: dx, nx: -dx, nz: -dz };
}

/** Face rectangulaire (a : à droite, h : hauteur, front : avancée vers le lecteur, depuis le pied du panneau). */
function face(out: FaceSink, f: Frame, a0: number, h0: number, a1: number, h1: number, front: number, uv: UvRect): void {
  const X = (a: number) => f.x + f.rx * a + f.nx * front;
  const Z = (a: number) => f.z + f.rz * a + f.nz * front;
  const [u0, v0, u1, v1] = uv;
  out.pos.push(X(a0), f.y + h0, Z(a0), X(a1), f.y + h0, Z(a1), X(a1), f.y + h1, Z(a1), X(a0), f.y + h0, Z(a0), X(a1), f.y + h1, Z(a1), X(a0), f.y + h1, Z(a0));
  out.uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
  for (let i = 0; i < 6; i++) out.nor.push(f.nx, 0, f.nz);
}

/** Pièces : pied en y = 0, face vers +z (le lecteur). */
function parts() {
  const tri = (down: boolean) => {
    const g = new THREE.CylinderGeometry(0.55, 0.55, 0.03, 3, 1).rotateX(Math.PI / 2);
    return template([part(g.rotateZ(down ? 0 : Math.PI).translate(0, 0, -0.03), '#9aa0a4')]);
  };
  return {
    post: template([part(prism(0.045, 0.045, -0.3, 1, 6), '#8f9699')]),
    plate: template([part(box(1, 1, 0.03, 0, 0, -0.03), '#9aa0a4')]),
    disc: template([part(new THREE.CylinderGeometry(0.44, 0.44, 0.03, 12, 1).rotateX(Math.PI / 2).translate(0, 0, -0.03), '#9aa0a4')]),
    triangle: tri(false),
    triangleDown: tri(true),
    delineator: template([part(box(0.14, 1.2, 0.1, 0, 0.3), '#f2f1ea'), part(box(0.15, 0.2, 0.11, 0, 0.68), '#2b2f33'), part(box(0.06, 0.12, 0.13, 0, 0.68), '#e2553f')]),
    board: template([part(box(1, 1, 0.05, 0, 0, -0.04), '#ffffff', 1)]),
  };
}
type Parts = ReturnType<typeof parts>;

interface Built {
  paint?: THREE.Mesh;
  posts?: THREE.Mesh;
  faces?: THREE.Mesh;
  cx: number;
  cz: number;
}

export class PolyRoads {
  readonly group = new THREE.Group();
  private plan: RoadPlan | null = null;
  private planning: Generator<void, RoadPlan> | null = null;
  private planned: RoadGraphData | null = null;
  private atlas: RoadAtlas | null = null;
  private kit: Parts | null = null;
  private readonly built = new Map<string, Built>();
  private readonly builder = new MeshBuilder();
  private readonly paintMat = flatVertexMaterial(0.85);
  private readonly postMat = flatVertexMaterial(0.8);
  private faceMat: THREE.MeshStandardNodeMaterial | null = null;
  private readonly last = new THREE.Vector3(Infinity, 0, 0);
  private waiting = true;
  /** Panneaux d'entrée déjà posés par l'itinéraire (signs.ts), à ne pas doubler. */
  private taken: ReadonlyArray<{ x: number; z: number }> = [];

  constructor(
    private readonly probe: LandProbe,
    private readonly graph: () => RoadGraphData | undefined,
    private readonly places: () => readonly PlanPlace[],
  ) {
    this.group.name = 'poly-signalisation';
    this.paintMat.flatShading = false;
    this.paintMat.polygonOffset = true;
    this.paintMat.polygonOffsetFactor = -4;
    this.paintMat.polygonOffsetUnits = -4;
  }

  setTaken(spots: ReadonlyArray<{ x: number; z: number }>): void {
    this.taken = spots;
    for (const k of [...this.built.keys()]) this.drop(k);
    this.waiting = true;
  }

  update(focus: THREE.Vector3): void {
    this.advancePlan();
    if (!this.plan) return;
    for (const b of this.built.values()) if (b.posts) b.posts.castShadow = Math.hypot(b.cx - focus.x, b.cz - focus.z) < SHADOW_M + CELL_M / 2;
    if (!this.waiting && this.last.distanceToSquared(focus) < 225) return;
    this.last.copy(focus);
    this.probe.forget();
    for (const [k, b] of this.built) if (Math.hypot(b.cx - focus.x, b.cz - focus.z) > FORGET_M) this.drop(k);
    this.waiting = false;
    const r = Math.ceil(BUILD_M / CELL_M);
    const ox = Math.floor(focus.x / CELL_M);
    const oz = Math.floor(focus.z / CELL_M);
    const found: Array<{ k: string; cx: number; cz: number; d: number; cell: RoadCell }> = [];
    for (let gx = ox - r; gx <= ox + r; gx++)
      for (let gz = oz - r; gz <= oz + r; gz++) {
        const k = `${gx}_${gz}`;
        const cell = this.plan.cells.get(k);
        if (!cell || this.built.has(k)) continue;
        const cx = (gx + 0.5) * CELL_M;
        const cz = (gz + 0.5) * CELL_M;
        const d = Math.hypot(cx - focus.x, cz - focus.z);
        if (d > BUILD_M) continue;
        this.waiting = true;
        found.push({ k, cx, cz, d, cell });
      }
    found.sort((a, b) => a.d - b.d);
    const next = found.find((f) => this.ready(f.cell, f.cx, f.cz));
    if (next) this.built.set(next.k, this.build(next.cell, next.cx, next.cz));
  }

  /** Le graphe arrive après le monde (chargé à la demande) : plan calculé par tranches dès qu'il est là. */
  private advancePlan(): void {
    const graph = this.graph();
    if (!graph?.edges.length) return;
    if (this.planned !== graph) {
      this.planned = graph;
      this.plan = null;
      this.planning = planRoads(graph, this.places());
    }
    if (!this.planning) return;
    const end = performance.now() + PLAN_BUDGET_MS;
    do {
      const step = this.planning.next();
      if (step.done) {
        this.plan = step.value;
        this.planning = null;
        this.waiting = true;
        return;
      }
    } while (performance.now() < end);
  }

  private ready(cell: RoadCell, cx: number, cz: number): boolean {
    for (const list of [cell.signs, cell.panels, cell.towns, cell.posts]) for (const p of list) if (!this.probe.tileAt(p.x, p.z) || !Number.isFinite(this.probe.heightAt(p.x, p.z))) return false;
    return !!this.probe.tileAt(cx, cz);
  }

  private build(cell: RoadCell, cx: number, cz: number): Built {
    const out: Built = { cx, cz };
    const m = cell.marks;
    if (m.length) {
      this.builder.reset();
      for (let i = 0; i + 8 < m.length; i += 9)
        this.builder.triUp(m[i]!, m[i + 1]! + PAINT_LIFT, m[i + 2]!, m[i + 3]!, m[i + 4]! + PAINT_LIFT, m[i + 5]!, m[i + 6]!, m[i + 7]! + PAINT_LIFT, m[i + 8]!, PAINT);
      const g = this.builder.geometry();
      if (g) {
        g.computeVertexNormals();
        out.paint = this.add(g, this.paintMat, 'marquages');
      }
    }
    const kit = (this.kit ??= parts());
    const faces: FaceSink = { pos: [], uv: [], nor: [] };
    const atlas = (this.atlas ??= roadAtlas(this.plan!.places));
    this.builder.reset();
    for (const p of cell.posts) if (!this.blocked(p.x, p.z)) this.builder.put(kit.delineator, p.x, this.probe.heightAt(p.x, p.z), p.z, 0, 1, 1, 1, WHITE);
    for (const s of cell.signs) this.sign(s, kit, faces);
    for (const p of cell.panels) this.panel(p, kit, faces, atlas);
    for (const t of cell.towns) this.town(t, kit, faces, atlas);
    const posts = this.builder.geometry();
    if (posts) out.posts = this.add(posts, this.postMat, 'panneaux');
    if (faces.pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(faces.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(faces.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(faces.uv, 2));
      g.computeBoundingSphere();
      this.faceMat ??= new THREE.MeshStandardNodeMaterial({ map: atlas.texture, roughness: 0.75, alphaTest: 0.5 });
      out.faces = this.add(g, this.faceMat, 'faces');
    }
    return out;
  }

  private add(g: THREE.BufferGeometry, m: THREE.Material, name: string): THREE.Mesh {
    const mesh = new THREE.Mesh(g, m);
    mesh.name = `poly-${name}`;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    return mesh;
  }

  /** Pose un gabarit face au lecteur : `a` à droite, `h` en hauteur, étiré de sx et sy. */
  private put(t: Template, f: Frame, a: number, h: number, front: number, sx: number, sy: number, colour = WHITE): void {
    this.builder.putBasis(t, f.x + f.rx * a + f.nx * front, f.y + h, f.z + f.rz * a + f.nz * front, f.rx * sx, 0, f.rz * sx, 0, sy, 0, f.nx, 0, f.nz, colour.r, colour.g, colour.b);
  }

  /** Panneau d'entrée posé par l'itinéraire à moins de `m` mètres (position de l'axe de la route). */
  private nearTaken(x: number, z: number, m: number): boolean {
    return this.taken.some((s) => Math.hypot(s.x - x, s.z - z) < m);
  }

  private blocked(x: number, z: number): boolean {
    return this.probe.buildingNear(x, z, 0.5);
  }

  private sign(s: PlannedSign, kit: Parts, faces: FaceSink): void {
    if (this.blocked(s.x, s.z) || this.nearTaken(s.x, s.z, 11)) return;
    const f = frameOf(s, this.probe.heightAt(s.x, s.z));
    const chevron = s.kind === 'chevronLeft' || s.kind === 'chevronRight';
    const h = chevron ? 1.0 : 2.05;
    const half = chevron ? 0.42 : 0.5;
    // Chevrons dos à dos : un seul poteau, entre les deux faces (chacune avancée de 10 cm vers son lecteur).
    const front = chevron ? 0.1 : 0;
    this.put(kit.post, f, 0, 0, chevron ? 0 : -0.09, 1, h + (chevron ? 0.3 : 0.2));
    if (SQUARE.has(s.kind)) this.put(kit.plate, f, 0, h, front, half * 1.9, half * 1.9);
    else if (s.kind === 'cycleway' || s.kind === 'stop') this.put(kit.disc, f, 0, h, 0, 1, 1);
    else this.put(s.kind === 'yield' ? kit.triangleDown : kit.triangle, f, 0, h + (s.kind === 'yield' ? 0.1 : -0.1), 0, 0.95, 0.9);
    face(faces, f, -half, h - half, half, h + half, front + 0.012, signRect(s.kind));
    if (s.value === undefined) return;
    // Panonceau sous le triangle : pente en %.
    const digits = [...String(s.value), '%'] as Glyph[];
    const w = 0.27;
    this.put(kit.board, f, 0, h - 0.74, 0, w * digits.length + 0.14, 0.36);
    digits.forEach((g, i) => face(faces, f, (i - digits.length / 2) * w, h - 0.88, (i + 1 - digits.length / 2) * w, h - 0.6, 0.012, glyphRect(g)));
  }

  private panel(p: PlannedPanel, kit: Parts, faces: FaceSink, atlas: RoadAtlas): void {
    if (this.blocked(p.x, p.z) || this.nearTaken(p.x, p.z, 26)) return;
    const f = frameOf(p, this.probe.heightAt(p.x, p.z));
    const row = 0.46;
    const nameH = 0.33;
    const widths = p.lines.map((l) => (atlas.nameWidth[l.place] ?? 1) * (NAME_W / NAME_H) * nameH);
    const W = Math.max(...widths) + 1.15;
    const H = row * p.lines.length;
    const base = 1.55;
    // Le panneau s'étend vers l'extérieur : son bord gauche reste à l'aplomb de l'emplacement.
    const left = -0.15;
    for (const a of [left + 0.35, left + W - 0.35]) this.put(kit.post, f, a, 0, -0.13, 1, base + H);
    this.put(kit.board, f, left + W / 2, base + H / 2, -0.02, W + 0.12, H + 0.12, RIM);
    this.put(kit.board, f, left + W / 2, base + H / 2, -0.04, W + 0.12, H + 0.12, BACK);
    this.put(kit.board, f, left + W / 2, base + H / 2, 0, W, H);
    p.lines.forEach((l, i) => {
      const y1 = base + H - i * row - (row - nameH) / 2;
      const y0 = y1 - nameH;
      const right = l.arrow === 'right';
      const a0 = left + (right ? 0.08 : 0.45);
      const arrowAt = right ? left + W - 0.4 : left + 0.07;
      face(faces, f, arrowAt, y0, arrowAt + nameH, y1, 0.012, glyphRect(l.arrow));
      face(faces, f, a0, y0, a0 + (widths[i] as number), y1, 0.012, nameRect(l.place, atlas.nameWidth[l.place] ?? 1));
      const digits = [...String(l.km)] as Glyph[];
      const dw = nameH * 0.6;
      const end = left + W - (right ? 0.45 : 0.1);
      digits.forEach((g, k) => face(faces, f, end - (digits.length - k) * dw, y0, end - (digits.length - k - 1) * dw, y1, 0.013, glyphRect(g)));
    });
  }

  private town(t: PlannedTown, kit: Parts, faces: FaceSink, atlas: RoadAtlas): void {
    if (this.blocked(t.x, t.z)) return;
    if (this.nearTaken(t.x, t.z, t.exit ? 12 : 260)) return;
    const f = frameOf(t, this.probe.heightAt(t.x, t.z));
    const nw = atlas.nameWidth[t.place] ?? 1;
    const hh = 0.36;
    const w = nw * (NAME_W / NAME_H) * hh;
    const h = 1.95;
    for (const a of [-w / 2 + 0.25, w / 2 - 0.25]) this.put(kit.post, f, a, 0, -0.12, 1, h + 0.2);
    this.put(kit.board, f, 0, h, -0.035, w + 0.24, hh + 0.24, BACK);
    this.put(kit.board, f, 0, h, -0.015, w + 0.24, hh + 0.24, RED);
    this.put(kit.board, f, 0, h, 0, w + 0.1, hh + 0.1);
    face(faces, f, -w / 2, h - hh / 2, w / 2, h + hh / 2, 0.012, nameRect(t.place, nw));
    if (!t.exit) return;
    // Sortie : barre rouge en travers du nom.
    const P = (a: number, y: number): [number, number, number] => [f.x + f.rx * a + f.nx * 0.03, f.y + y, f.z + f.rz * a + f.nz * 0.03];
    this.builder.quad2(...P(-w / 2, h - hh / 2), ...P(-w / 2 + 0.12, h - hh / 2 - 0.04), ...P(w / 2, h + hh / 2), ...P(w / 2 - 0.12, h + hh / 2 + 0.04), RED);
  }

  private drop(k: string): void {
    const b = this.built.get(k);
    if (!b) return;
    for (const m of [b.paint, b.posts, b.faces]) {
      if (!m) continue;
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.built.delete(k);
  }

  dispose(): void {
    for (const k of [...this.built.keys()]) this.drop(k);
    this.paintMat.dispose();
    this.postMat.dispose();
    this.faceMat?.dispose();
  }
}
