import * as THREE from 'three/webgpu';
import { rng } from '../engine/noise.ts';
import type { Season } from './environment.ts';
import { box, MeshBuilder, part, prism, template, type LandProbe, type Template } from './lowPolyKit.ts';
import { buildHarbour, harbourCorners, harbourTemplates, type HarbourSite, type HarbourTemplates } from './polyHarbour.ts';
import { meshOf, strollPath, type Site, type SiteContext } from './polySites.ts';
import type { LifeChunk } from './roadsideLife.ts';
import { ROBERT_LAND } from './worlds.ts';

/**
 * Lieux phares du Pays de Robert (mode Poly, second monde, tools/massif) : ports de Port-Azur, de la Calanque et de
 * l'Aber, tribunes du Circuit de la Plaine, téléphérique de Pralong, parapentes au-dessus du Pic de l'Aigle, dôme de
 * l'observatoire, flamants roses et tas de sel de l'Étang du Sel, champs de lavande du plateau. Même mécanique que
 * les lieux de l'île (polySites.ts) : chaque lieu est construit par pas quand le coureur approche, puis oublié.
 */
const WHITE = new THREE.Color(0xffffff);

// Cotes du générateur (tools/massif/src/design.ts, places.json).
const PORT_AZUR: HarbourSite = {
  x: 375.8, z: 9206.3, dir: 1.53, halfLen: 230, halfWid: 95, side: -1, lines: [-160, -100, -40, 20, 80], officeW: 30, officeU: -110, sail: 0.6, fishing: false,
  hulls: ['#e46b4f', '#f3c85a', '#3fa7b5', '#3d6fb0', '#ffffff'],
};
const CALANQUE: HarbourSite = {
  x: 10424.3, z: 9518.3, dir: 0.74, halfLen: 140, halfWid: 60, side: 1, lines: [-90, -40, 10], officeW: 26, officeU: -95, sail: 0.35, fishing: true,
  hulls: ['#2f8fb5', '#e2593f', '#f2f0e8', '#2f5f8a', '#e7b23c'],
};
const ABER: HarbourSite = {
  x: -499.2, z: -10138, dir: -1.62, halfLen: 150, halfWid: 70, side: 1, lines: [-100, -45, 10], officeW: 28, officeU: -110, sail: 0.25, fishing: true,
  hulls: ['#2d5d8f', '#b8432f', '#3c7f58', '#253f66', '#d79a33'],
};
const RING = { x: -6900, z: 3700, half: 560, radius: 215 };
const PEAK: readonly [number, number] = [1600, -6900];
const GRANDE_TETE: readonly [number, number] = [4700, -6000];
/** Téléphérique : de Pralong à la gare d'altitude (bâtiment du générateur). */
const CABLE_FROM: readonly [number, number] = [-8480, -5470];
const CABLE_TO: readonly [number, number] = [-9300, -6300];
/** Étang du Sel : ellipse (tools/massif, LAKES[0]) et saline. */
const SALT_POND = { x: -12560, z: 7218, rx: 1300, rz: 480, rot: 2.62 + Math.PI / 2, level: 0.35 };
const SALINE: readonly [number, number] = [-12800, 4600];
const LAVENDER: ReadonlyArray<readonly [number, number, number]> = [
  [10400, 1500, 0.3],
  [12600, 1600, -0.2],
  [11200, -1900, 0.6],
  [13300, -300, 0.1],
];

function kit() {
  return {
    /** Gradin de 12 m : six rangs face à −z, dossiers colorés. */
    stand: template([
      ...Array.from({ length: 6 }, (_, i) => part(box(12, 0.45 * (i + 1), 0.95, 0, 0.225 * (i + 1), -2.8 + i * 0.95), i % 2 ? '#c9c4b8' : '#d6d1c4')),
      ...Array.from({ length: 6 }, (_, i) => part(box(11.6, 0.36, 0.1, 0, 0.45 * (i + 1) + 0.2, -2.8 + i * 0.95 + 0.4), '#ffffff', 1)),
      part(box(12.4, 0.22, 7.6, 0, 5.4, -0.4).rotateX(-0.06), '#f2efe6'),
      ...[-5.8, 5.8].map((x) => part(prism(0.12, 0.1, 0, 5.4, 6, x, 2.8), '#8f9699')),
    ]),
    arch: template([
      ...[-6, 6].map((x) => part(box(0.7, 6, 0.7, x, 3), '#2b2f33')),
      part(box(13, 1.4, 0.5, 0, 6.2), '#ffffff', 1),
      ...Array.from({ length: 8 }, (_, i) => part(box(1.5, 0.7, 0.52, -5.25 + i * 1.5, 6.2 + (i % 2 ? 0.35 : -0.35)), i % 2 ? '#1b1b1b' : '#f5f5f5')),
    ]),
    flag: template([part(prism(0.05, 0.04, 0, 6, 5), '#e9e6dc'), part(box(0.03, 1, 1.6, 0, 5.4, 0.85), '#ffffff', 1)]),
    pylon: template([
      part(prism(0.45, 0.25, 0, 14, 4), '#6f7a80'),
      part(box(5.6, 0.35, 0.5, 0, 14, 0), '#59636a'),
      ...[-2.5, 2.5].map((x) => part(box(0.5, 0.5, 1.2, x, 14.3, 0), '#2b2f33')),
    ]),
    cabin: template([
      part(box(0.08, 3, 0.08, 0, -1.5), '#3a3f44'),
      part(box(2.4, 1.9, 2.2, 0, -4), '#ffffff', 1),
      part(box(2.42, 0.8, 2.22, 0, -3.6), '#3e5a66'),
      part(box(2.5, 0.18, 2.3, 0, -5), '#c23b2e'),
    ]),
    station: template([part(box(9, 5, 7, 0, 2.5), '#e9e6dc'), part(box(10, 0.5, 8, 0, 5.2), '#c23b2e'), part(box(3, 3, 0.2, 0, 1.5, 3.55), '#3e5a66')]),
    dome: template([
      part(new THREE.SphereGeometry(5.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#f4f4f0'),
      part(box(1.2, 4.6, 0.12, 0, 2.6, 4.6).rotateX(-0.5), '#2b2f33'),
      part(prism(5.4, 5.4, -0.6, 0.2, 12), '#d9d6cc'),
    ]),
    cross: template([part(box(0.35, 6, 0.35, 0, 3), '#5d4630'), part(box(2.4, 0.35, 0.35, 0, 4.4), '#5d4630')]),
    flamingo: template([
      ...[-0.08, 0.08].map((x) => part(box(0.04, 0.85, 0.04, x, 0.42), '#d9708a')),
      part(new THREE.IcosahedronGeometry(0.32, 0).scale(1.4, 0.8, 0.9).translate(0, 1.05, 0), '#f29bb0'),
      part(box(0.07, 0.7, 0.07, 0.36, 1.45, 0).rotateZ(-0.2), '#f29bb0'),
      part(new THREE.IcosahedronGeometry(0.1, 0).translate(0.52, 1.82, 0), '#f29bb0'),
      part(box(0.16, 0.06, 0.06, 0.66, 1.78, 0), '#2b2f33'),
    ]),
    saltHeap: template([part(new THREE.ConeGeometry(3.2, 3, 8).translate(0, 1.5, 0), '#fbfaf5')]),
    lavender: template([part(new THREE.IcosahedronGeometry(0.42, 0).scale(1, 0.75, 1).translate(0, 0.32, 0), '#ffffff', 1)]),
  };
}
type Kit = ReturnType<typeof kit>;

/** Teinte de la lavande selon la saison. */
const LAVENDER_TINT: Record<Season, THREE.Color> = {
  spring: new THREE.Color('#7d8fb4'),
  summer: new THREE.Color('#8a5fc2'),
  autumn: new THREE.Color('#8a8576'),
  winter: new THREE.Color('#9a9a8f'),
};

const harbourSite = (id: string, h: HarbourSite, reach: number, templates: () => HarbourTemplates): Site => ({
  id,
  x: h.x,
  z: h.z,
  reach,
  needs: harbourCorners(h),
  *build(c) {
    yield* buildHarbour(c.mesh, c.probe, templates(), h);
    // Promeneurs sur le quai.
    const ux = Math.cos(h.dir);
    const uz = Math.sin(h.dir);
    const w = -h.side * (h.halfWid + 6);
    const at = (u: number): [number, number] => [h.x + ux * u - uz * w, h.z + uz * u + ux * w];
    strollPath(c, [at(-h.halfLen * 0.8), at(h.halfLen * 0.6), at(-h.halfLen * 0.8)], 31 + Math.round(h.x));
  },
});

/** Tribunes, portique d'arrivée et drapeaux du Circuit de la Plaine (ligne droite sud). */
function circuit(k: () => Kit): Site {
  const zS = RING.z + RING.radius;
  return {
    id: 'circuit',
    x: RING.x,
    z: RING.z,
    reach: 900,
    needs: [[RING.x - RING.half, zS], [RING.x + RING.half, zS], [RING.x, RING.z - RING.radius]],
    *build(c) {
      const K = k();
      const flags = [new THREE.Color('#e2604f'), new THREE.Color('#f4d35e'), new THREE.Color('#2f9c95'), new THREE.Color('#5c6bc0')];
      for (let i = -2; i <= 2; i++) {
        const x = RING.x + i * 13;
        const z = zS + 26;
        const y = c.probe.heightAt(x, z);
        if (Number.isFinite(y)) c.mesh.put(K.stand, x, y, z, Math.PI, 1, 1, 1, WHITE);
        for (let s = 0; s < 8; s++) c.spots.push({ kind: 'villager', x: x - 5 + s * 1.4, y: y + 1.6, z: z - 1.2, yaw: Math.PI, seed: ((i + 2) * 0.137 + s * 0.071) % 1 });
      }
      yield;
      const ay = c.probe.heightAt(RING.x + 120, zS);
      if (Number.isFinite(ay)) c.mesh.put(K.arch, RING.x + 120, ay, zS, Math.PI / 2, 1, 1, 1, WHITE);
      for (let i = 0; i < 24; i++) {
        const x = RING.x - RING.half + (i * 2 * RING.half) / 23;
        for (const z of [zS + 9, RING.z - RING.radius - 9]) {
          const y = c.probe.heightAt(x, z);
          if (Number.isFinite(y)) c.mesh.put(K.flag, x, y, z, 0, 1, 1, 1, flags[i % flags.length]!);
        }
      }
      yield;
      // Joggeurs sur la pelouse centrale.
      strollPath(c, [[RING.x - 300, RING.z], [RING.x + 300, RING.z - 60], [RING.x + 300, RING.z + 60], [RING.x - 300, RING.z]], 404, 'jogger');
    },
  };
}

/** Téléphérique de Pralong : pylônes, deux câbles, gares, six cabines qui montent et descendent. */
function cableCar(k: () => Kit): Site {
  const [ax, az] = CABLE_FROM;
  const [bx, bz] = CABLE_TO;
  const len = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / len;
  const uz = (bz - az) / len;
  const yaw = Math.atan2(ux, uz);
  return {
    id: 'telepherique',
    x: (ax + bx) / 2,
    z: (az + bz) / 2,
    reach: 1600,
    needs: [CABLE_FROM, CABLE_TO, [(ax + bx) / 2, (az + bz) / 2]],
    *build(c) {
      const K = k();
      const n = Math.max(2, Math.round(len / 160));
      const tops: Array<[number, number, number]> = [];
      for (let i = 0; i <= n; i++) {
        const x = ax + (bx - ax) * (i / n);
        const z = az + (bz - az) * (i / n);
        const y = c.probe.heightAt(x, z);
        if (!Number.isFinite(y)) continue;
        if (i === 0 || i === n) c.mesh.put(K.station, x, y, z, yaw, 1, 1, 1, WHITE);
        else c.mesh.put(K.pylon, x, y, z, yaw, 1, 1, 1, WHITE);
        tops.push([x, y + (i === 0 || i === n ? 6 : 14.3), z]);
      }
      yield;
      if (tops.length < 2) return;
      // Câbles : deux fils tendus entre les pylônes (±2,5 m en travers).
      const px = uz;
      const pz = -ux;
      const wire = template([part(box(0.07, 0.07, 1, 0, 0, 0.5), '#2b2f33')]);
      for (const side of [-2.5, 2.5])
        for (let i = 0; i + 1 < tops.length; i++) {
          const [x0, y0, z0] = tops[i]!;
          const [x1, y1, z1] = tops[i + 1]!;
          const dx = x1 - x0;
          const dy = y1 - y0;
          const dz = z1 - z0;
          const L = Math.hypot(dx, dy, dz);
          // Base : z local le long du câble, y vers le haut, x en travers.
          const zx = dx / L;
          const zy = dy / L;
          const zz = dz / L;
          c.mesh.putBasis(wire, x0 + px * side, y0, z0 + pz * side, px, 0, pz, -zy * zx / Math.hypot(zx, zz), Math.hypot(zx, zz), -zy * zz / Math.hypot(zx, zz), zx * L, zy * L, zz * L, 0.17, 0.18, 0.2);
        }
      // Cabines : montée sur un câble, descente sur l'autre, au rythme d'un tour en 3 min.
      const along = (s: number): [number, number, number] => {
        const f = s * (tops.length - 1);
        const i = Math.min(tops.length - 2, Math.floor(f));
        const t = f - i;
        const [x0, y0, z0] = tops[i]!;
        const [x1, y1, z1] = tops[i + 1]!;
        return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t - Math.sin(t * Math.PI) * 2.5, z0 + (z1 - z0) * t];
      };
      for (let k2 = 0; k2 < 6; k2++) {
        const m = meshOf([{ t: K.cabin, x: 0, y: 0, z: 0 }], c.mat);
        m.name = 'pays-cabine';
        c.moving.push({
          object: m,
          step: (t) => {
            const q = (t / 180 + k2 / 6) % 1;
            const up = q < 0.5;
            const s = up ? q * 2 : 2 - q * 2;
            const side = up ? 2.5 : -2.5;
            const [x, y, z] = along(s);
            m.position.set(x + px * side, y, z + pz * side);
            m.rotation.y = yaw;
          },
        });
      }
    },
  };
}

/** Parapentes qui tournent au-dessus du versant sud du Pic de l'Aigle, dôme de l'observatoire, croix de la Grande Tête. */
function summits(k: () => Kit): Site {
  return {
    id: 'sommets',
    x: PEAK[0] + 600,
    z: PEAK[1] + 900,
    reach: 2600,
    needs: [PEAK, GRANDE_TETE],
    *build(c) {
      const K = k();
      const py = c.probe.heightAt(PEAK[0], PEAK[1]);
      // Dôme posé sur l'observatoire (tour de 14 m du générateur).
      if (Number.isFinite(py)) c.mesh.put(K.dome, PEAK[0], py + 14, PEAK[1], 0.4, 1, 1, 1, WHITE);
      const gy = c.probe.heightAt(GRANDE_TETE[0], GRANDE_TETE[1]);
      if (Number.isFinite(gy)) c.mesh.put(K.cross, GRANDE_TETE[0] + 18, gy, GRANDE_TETE[1] - 10, 0.3, 1, 1, 1, WHITE);
      yield;
      const colours: Array<[string, string]> = [['#e2604f', '#f4d35e'], ['#2f9c95', '#ffffff'], ['#5c6bc0', '#ef8fb0'], ['#ff8a3d', '#4fa3d9'], ['#7fb069', '#f4d35e']];
      colours.forEach(([a, b], i) => {
        const pieces: THREE.BufferGeometry[] = [];
        for (let s = -3; s <= 3; s++) pieces.push(part(box(1.25, 0.12, 2.2, s * 1.2, -(Math.abs(s) ** 1.6) * 0.18, 0).rotateZ(-s * 0.13), s % 2 ? a : b));
        pieces.push(part(box(0.45, 0.8, 0.45, 0, -6.2, 0.2), '#3a3f44'));
        for (const s of [-3, 3]) pieces.push(part(box(0.03, 6, 0.03, s * 0.9, -3.2, 0).rotateZ(s * 0.11), '#d9d6cc'));
        const m = meshOf([{ t: template(pieces), x: 0, y: 0, z: 0 }], c.mat);
        m.name = 'pays-parapente';
        const cx = PEAK[0] + 500 + i * 160;
        const cz = PEAK[1] + 1200 + (i % 2) * 300;
        const base = (Number.isFinite(py) ? py : 1200) - 60 - i * 70;
        const r = 160 + i * 40;
        c.moving.push({
          object: m,
          step: (t) => {
            const a = t * (0.05 + i * 0.006) + i * 1.3;
            m.position.set(cx + Math.cos(a) * r, base + Math.sin(t * 0.03 + i) * 25, cz + Math.sin(a) * r);
            m.rotation.y = -a;
            m.rotation.z = 0.25;
          },
        });
      });
    },
  };
}

/** Flamants roses dans l'eau peu profonde de l'Étang du Sel, tas de sel près de la saline. */
function saltPond(k: () => Kit): Site {
  const P = SALT_POND;
  const at = (e: number, a: number): [number, number] => {
    const ex = Math.cos(a) * P.rx * e;
    const ez = Math.sin(a) * P.rz * e;
    return [P.x + ex * Math.cos(P.rot) - ez * Math.sin(P.rot), P.z + ex * Math.sin(P.rot) + ez * Math.cos(P.rot)];
  };
  return {
    id: 'etang-du-sel',
    x: P.x,
    z: P.z,
    reach: 2200,
    needs: [at(0.9, 0), at(0.9, Math.PI), SALINE],
    *build(c) {
      const K = k();
      const r = rng(5150);
      const pink = new THREE.Color('#ffffff');
      // Trois groupes au bord de l'eau.
      for (const g of [0.4, 2.2, 4.1]) {
        for (let i = 0; i < 14; i++) {
          const [x, z] = at(0.72 + r() * 0.2, g + (r() - 0.5) * 0.35);
          c.mesh.put(K.flamingo, x, P.level - 0.25, z, r() * 6.28, 1, 0.9 + r() * 0.2, 1, pink);
        }
        yield;
      }
      for (let i = 0; i < 9; i++) {
        const x = SALINE[0] + 40 + (i % 3) * 9;
        const z = SALINE[1] - 20 + Math.floor(i / 3) * 9;
        const y = c.probe.heightAt(x, z);
        if (Number.isFinite(y) && !c.probe.buildingNear(x, z, 3)) c.mesh.put(K.saltHeap, x, y, z, i, 1, 0.8 + (i % 3) * 0.15, 1, WHITE);
      }
    },
  };
}

/** Champs de lavande du plateau : rangs de touffes, couleur selon la saison. */
function lavender(k: () => Kit, i: number): Site {
  const [x0, z0, ang] = LAVENDER[i]!;
  return {
    id: `lavande-${i}`,
    x: x0,
    z: z0,
    reach: 1100,
    needs: [[x0 - 120, z0 - 120], [x0 + 120, z0 + 120]],
    *build(c) {
      const K = k();
      const tint = LAVENDER_TINT[c.season];
      const co = Math.cos(ang);
      const si = Math.sin(ang);
      const r = rng(880 + i);
      for (let row = -14; row <= 14; row++) {
        for (let s = -26; s <= 26; s++) {
          const u = s * 3.4;
          const w = row * 2.6;
          const x = x0 + u * co - w * si;
          const z = z0 + u * si + w * co;
          const pr = c.probe;
          if (!pr.read(x, z) || pr.road > 0.05 || pr.water > 0.1 || pr.urban > 0.2 || pr.forest > 0.3 || pr.buildingNear(x, z, 4)) continue;
          const y = pr.heightAt(x, z);
          if (!Number.isFinite(y)) continue;
          const sc = 0.85 + r() * 0.3;
          c.mesh.put(K.lavender, x, y, z, r() * 6.28, sc, sc, sc, tint);
        }
        if (row % 4 === 0) yield;
      }
    },
  };
}

// ───────────────────────────── Construction par pas, oubli au loin (comme IslandSites)

interface Moving {
  object: THREE.Object3D;
  step: (t: number, dt: number) => void;
}

interface Built {
  meshes: THREE.Mesh[];
  moving: Moving[];
  chunk: LifeChunk;
}

interface Job {
  site: Site;
  steps: Generator<void>;
  context: SiteContext;
  meshes: THREE.Mesh[];
}

const FORGET_EXTRA_M = 150;
const SHADOW_M = 70;
const ANIMATE_M = 2500;
const BUILD_MS = 2;

export class PaysSites {
  readonly group = new THREE.Group();
  /** Change à chaque lieu construit ou oublié. */
  version = 0;
  private readonly sites: Site[];
  private readonly built = new Map<string, Built>();
  private job: Job | null = null;
  private templates?: Kit;
  private harbours?: HarbourTemplates;
  private t = 0;

  constructor(private readonly probe: LandProbe, private readonly mat: THREE.Material, private season: Season = 'summer') {
    this.group.name = 'pays-lieux';
    const k = () => (this.templates ??= kit());
    const h = () => (this.harbours ??= harbourTemplates());
    this.sites = [
      harbourSite('port-azur', PORT_AZUR, 750, h),
      harbourSite('port-calanque', CALANQUE, 700, h),
      harbourSite('port-aber', ABER, 700, h),
      circuit(k),
      cableCar(k),
      summits(k),
      saltPond(k),
      ...LAVENDER.map((_, i) => lavender(k, i)),
    ];
  }

  get chunks(): LifeChunk[] {
    return [...this.built.values()].map((b) => b.chunk);
  }

  setSeason(season: Season): void {
    if (season === this.season) return;
    this.season = season;
    this.cancel();
    for (const id of [...this.built.keys()]) this.drop(id);
  }

  update(dt: number, x: number, z: number, density: number): void {
    this.t += dt;
    for (const site of this.sites) {
      const d = Math.hypot(x - site.x, z - site.z);
      const b = this.built.get(site.id);
      if (b) {
        if (d > site.reach + FORGET_EXTRA_M || density <= 0) {
          this.drop(site.id);
          continue;
        }
        for (const m of b.meshes) {
          const s = m.geometry.boundingSphere;
          m.castShadow = !!s && Math.hypot(s.center.x - x, s.center.z - z) - s.radius < SHADOW_M;
        }
        for (const m of b.moving) {
          m.object.visible = d < ANIMATE_M;
          if (m.object.visible) m.step(this.t, dt);
        }
      } else if (!this.job && d < site.reach && density > 0 && this.ready(site)) this.start(site, density);
    }
    this.advance();
  }

  private ready(site: Site): boolean {
    this.probe.forget();
    return site.needs.every(([x, z]) => this.probe.tileAt(x, z)?.buildingSource?.worldId === ROBERT_LAND && Number.isFinite(this.probe.heightAt(x, z)));
  }

  private start(site: Site, density: number): void {
    const meshes: THREE.Mesh[] = [];
    const mesh = new MeshBuilder(8192);
    const flush = () => {
      const g = mesh.geometry();
      mesh.reset();
      if (!g) return;
      const m = new THREE.Mesh(g, this.mat);
      m.name = `pays-${site.id}-${meshes.length}`;
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      meshes.push(m);
    };
    const context: SiteContext = { mesh, probe: this.probe, season: this.season, density, spots: [], perches: [], flowers: [], moving: [], mat: this.mat, flush };
    this.job = { site, steps: site.build(context), context, meshes };
  }

  private advance(): void {
    const job = this.job;
    if (!job) return;
    this.probe.forget();
    const end = performance.now() + BUILD_MS;
    do {
      if (!job.steps.next().done) continue;
      const c = job.context;
      c.flush();
      for (const m of c.moving) {
        m.step(this.t, 0);
        this.group.add(m.object);
      }
      for (const m of job.meshes) this.group.add(m);
      this.built.set(job.site.id, { meshes: job.meshes, moving: c.moving, chunk: { spots: c.spots, flowers: new Float32Array(c.flowers), perches: c.perches } });
      this.job = null;
      this.version++;
      return;
    } while (performance.now() < end);
  }

  private cancel(): void {
    for (const m of this.job?.meshes ?? []) m.geometry.dispose();
    this.job = null;
  }

  private drop(id: string): void {
    const b = this.built.get(id);
    if (!b) return;
    for (const o of [...b.meshes, ...b.moving.map((m) => m.object)]) {
      this.group.remove(o);
      o.traverse((q) => (q as THREE.Mesh).geometry?.dispose());
    }
    this.built.delete(id);
    this.version++;
  }

  dispose(): void {
    this.cancel();
    for (const id of [...this.built.keys()]) this.drop(id);
  }
}

export type { Template };
