import * as THREE from 'three/webgpu';
import { attribute, vec3 } from 'three/tsl';

/** Pied d'un lampadaire (monde). */
export interface LampSpot {
  x: number;
  y: number;
  z: number;
}

const POST_H = 4.2;

/** Modèle d'un lampadaire de ville (fût, socle, lanterne, chapeau), attribut `glow` à 1 sur la vitre de la lanterne. */
function template(): { pos: number[]; nor: number[]; glow: number[] } {
  const parts: Array<[THREE.BufferGeometry, number]> = [
    [new THREE.CylinderGeometry(0.05, 0.09, POST_H, 6, 1, true).translate(0, POST_H / 2, 0), 0],
    [new THREE.CylinderGeometry(0.1, 0.14, 0.35, 6, 1, true).translate(0, 0.17, 0), 0],
    [new THREE.CylinderGeometry(0.22, 0.13, 0.48, 6, 1, true).translate(0, POST_H + 0.24, 0), 1],
    [new THREE.ConeGeometry(0.27, 0.18, 6).translate(0, POST_H + 0.57, 0), 0],
  ];
  const pos: number[] = [];
  const nor: number[] = [];
  const glow: number[] = [];
  for (const [g, on] of parts) {
    const ni = g.index ? g.toNonIndexed() : g;
    const p = ni.getAttribute('position');
    const n = ni.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      glow.push(on);
    }
  }
  return { pos, nor, glow };
}
const TEMPLATE = template();

/** Lampadaires d'une tuile en un seul maillage (un appel de dessin), sans ombre portée. */
export function buildLampGeometry(spots: readonly LampSpot[]): THREE.BufferGeometry {
  const n = TEMPLATE.glow.length;
  const pos = new Float32Array(n * spots.length * 3);
  const nor = new Float32Array(n * spots.length * 3);
  const glow = new Float32Array(n * spots.length);
  spots.forEach((s, k) => {
    const o = k * n;
    for (let i = 0; i < n; i++) {
      pos[(o + i) * 3] = (TEMPLATE.pos[i * 3] as number) + s.x;
      pos[(o + i) * 3 + 1] = (TEMPLATE.pos[i * 3 + 1] as number) + s.y;
      pos[(o + i) * 3 + 2] = (TEMPLATE.pos[i * 3 + 2] as number) + s.z;
      nor[(o + i) * 3] = TEMPLATE.nor[i * 3] as number;
      nor[(o + i) * 3 + 1] = TEMPLATE.nor[i * 3 + 1] as number;
      nor[(o + i) * 3 + 2] = TEMPLATE.nor[i * 3 + 2] as number;
      glow[o + i] = TEMPLATE.glow[i] as number;
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('glow', new THREE.BufferAttribute(glow, 1));
  g.computeBoundingSphere();
  return g;
}

/**
 * Tous les lampadaires du monde en un seul maillage instancié (un appel de dessin, au lieu d'un par tuile) :
 * les tuiles ajoutent ou retirent leurs pieds, les matrices sont réécrites (quelques centaines, négligeable).
 */
export class LampField {
  readonly group = new THREE.Group();
  private readonly byTile = new Map<string, readonly LampSpot[]>();
  private mesh: THREE.InstancedMesh | null = null;
  private capacity = 0;

  /** `geometry` : modèle d'un pied (lampadaire par défaut ; aussi les potelets, streetProps.ts). */
  constructor(
    private readonly material: THREE.Material,
    private readonly geometry: THREE.BufferGeometry = buildLampGeometry([{ x: 0, y: 0, z: 0 }]),
    private readonly label = 'lamps',
  ) {
    this.group.name = label;
  }

  get count(): number {
    return this.mesh?.count ?? 0;
  }

  /** Tous les pieds posés. */
  *spots(): Generator<LampSpot> {
    for (const s of this.byTile.values()) yield* s;
  }

  set(tileId: string, spots: readonly LampSpot[]): void {
    if (spots.length) this.byTile.set(tileId, spots);
    else this.byTile.delete(tileId);
    this.rebuild();
  }

  remove(tileId: string): void {
    if (this.byTile.delete(tileId)) this.rebuild();
  }

  private rebuild(): void {
    let total = 0;
    for (const s of this.byTile.values()) total += s.length;
    if (total > this.capacity) {
      if (this.mesh) {
        this.group.remove(this.mesh);
        this.mesh.dispose();
      }
      this.capacity = Math.max(256, 2 ** Math.ceil(Math.log2(total)));
      this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.capacity);
      this.mesh.name = this.label;
      this.group.add(this.mesh);
    }
    if (!this.mesh) return;
    const m = new THREE.Matrix4();
    let i = 0;
    for (const spots of this.byTile.values()) for (const s of spots) this.mesh.setMatrixAt(i++, m.makeTranslation(s.x, s.y, s.z));
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (i) this.mesh.computeBoundingSphere();
  }
}

/**
 * La nuit, les lampadaires les plus proches du coureur deviennent de vraies lumières : elles éclairent les façades,
 * le trottoir, les vélos (la flaque peinte au sol ne touchait que la voirie). Nombre fixe de lumières (allumées ou
 * éteintes par l'intensité, jamais ajoutées ni retirées : pas de recompilation des matériaux), choisies 4 fois par
 * seconde.
 */
export class NearLampLights {
  readonly group = new THREE.Group();
  private readonly lights: THREE.PointLight[] = [];
  private wait = 0;

  constructor(count: number) {
    this.group.name = 'lamp-lights';
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xffc488, 0, 24, 2);
      l.castShadow = false;
      this.lights.push(l);
      this.group.add(l);
    }
  }

  update(dt: number, focus: THREE.Vector3, night: number, strength: number, spots: Iterable<LampSpot>): void {
    if (!this.lights.length) return;
    this.wait -= dt;
    if (this.wait > 0) {
      for (const l of this.lights) l.intensity = l.userData.on ? night * strength * LAMP_CANDELA : 0;
      return;
    }
    this.wait = 0.25;
    // Les plus proches (horizontalement), dans un rayon de 80 m.
    const best: Array<{ d: number; s: LampSpot }> = [];
    for (const s of spots) {
      const d = (s.x - focus.x) ** 2 + (s.z - focus.z) ** 2;
      if (d > 80 * 80) continue;
      if (best.length < this.lights.length) best.push({ d, s });
      else {
        let w = 0;
        for (let k = 1; k < best.length; k++) if ((best[k] as { d: number }).d > (best[w] as { d: number }).d) w = k;
        if (d < (best[w] as { d: number }).d) best[w] = { d, s };
      }
    }
    this.lights.forEach((l, i) => {
      const b = best[i];
      l.userData.on = !!b;
      if (b) l.position.set(b.s.x, b.s.y + POST_H + 0.25, b.s.z);
      l.intensity = b ? night * strength * LAMP_CANDELA : 0;
    });
  }
}

/** Intensité d'une lanterne (unités de la scène : le soleil vaut 3 à 4). */
const LAMP_CANDELA = 9;

/** Fonte sombre ; la vitre de la lanterne rayonne la nuit (bloom : halo dans la brume, reflet dans les flaques). */
export function createLampMaterial(night: THREE.Node<'float'>): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  const glow = attribute<'float'>('glow');
  m.colorNode = vec3(0.025, 0.028, 0.03).add(vec3(0.5, 0.47, 0.38).mul(glow));
  m.roughnessNode = glow.mul(-0.35).add(0.55);
  m.metalnessNode = glow.mul(-0.4).add(0.4);
  m.emissiveNode = vec3(1.0, 0.74, 0.42).mul(glow).mul(night).mul(2.4);
  return m;
}
