import * as THREE from 'three/webgpu';
import { instancedBufferAttribute, float, vec3, uniform, smoothstep, uv, mix, hash, instanceIndex, atan, sin } from 'three/tsl';
import { LOW_POLY } from '../engine/style.ts';
import type { QualitySettings } from '../engine/quality.ts';
import type { LoadedTile } from './types.ts';

/** Revêtements OSM non goudronnés (poussière, roulement plus rugueux). */
export const UNPAVED_SURFACES = new Set(['unpaved', 'gravel', 'fine_gravel', 'dirt', 'ground', 'compacted', 'earth', 'sand', 'grass', 'pebblestone', 'mud']);
/** Seuls la terre, le sable et le gravier soulèvent de la poussière (pas l'herbe, les chemins verts ou la boue). */
export const DUSTY_SURFACES = new Set(['dirt', 'earth', 'sand', 'gravel', 'fine_gravel', 'pebblestone']);
const LIFE = 2.6;
/** Style Poly : panache plus clair, plus dense et plus large (les aplats du chemin avalaient la poussière). */
const ALPHA = LOW_POLY ? 0.42 : 0.1;
const PER_M = LOW_POLY ? 5 : 3.5;
const GROW = LOW_POLY ? 1.5 : 1;
const LIFT = LOW_POLY ? 0.2 : 0.05;
const RISE = LOW_POLY ? 0.55 : 0.35;

/** Revêtement d'une route OSM : `unpaved` si le tag l'indique ou si c'est une piste sans revêtement. */
export function isUnpaved(kind: string, surface: string | undefined): boolean {
  if (surface) return UNPAVED_SURFACES.has(surface);
  return kind === 'track' || kind === 'path' || kind === 'bridleway';
}

/** Distance d'un point à une polyligne plate x, z. */
function distToPolyline(x: number, z: number, pts: number[]): number {
  let best = Infinity;
  for (let i = 2; i < pts.length; i += 2) {
    const ax = pts[i - 2] as number;
    const az = pts[i - 1] as number;
    const dx = (pts[i] as number) - ax;
    const dz = (pts[i + 1] as number) - az;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

/**
 * Revêtement sous un point : la route OSM la plus proche (≤ demi-largeur + 1,5 m) de la tuile.
 * `null` hors de toute route.
 */
export function surfaceUnder(tile: LoadedTile | undefined, x: number, z: number): { unpaved: boolean; dusty: boolean; kind: string } | null {
  if (!tile) return null;
  let best: { unpaved: boolean; dusty: boolean; kind: string } | null = null;
  let bd = Infinity;
  for (const r of tile.features.roads) {
    const d = distToPolyline(x, z, r.pts) - r.width / 2;
    if (d < 1.5 && d < bd) {
      bd = d;
      best = { unpaved: isUnpaved(r.kind, r.surface), dusty: !!r.surface && DUSTY_SURFACES.has(r.surface), kind: r.kind };
    }
  }
  return best;
}

/**
 * Poussière soulevée par les roues sur les chemins non revêtus : particules en sprites
 * instanciés (un seul appel de dessin), tampon circulaire écrit par le CPU à l'émission
 * (position, instant, vitesse), animation entièrement sur le GPU (montée, étalement, dérive au
 * vent, fondu). Rien par temps de pluie. Nombre de particules selon le préréglage graphique.
 */
export class Dust {
  readonly sprite: THREE.Sprite;
  readonly windDir = uniform(new THREE.Vector2(0.6, 0.8));
  readonly windMs = uniform(3);
  /** Horloge des particules (s), avancée par update(). */
  private readonly now = uniform(0);
  /** Couleur de la terre (ocre clair), réglée selon la saison. */
  readonly tint = uniform(LOW_POLY ? new THREE.Color('#e9d9b6').multiplyScalar(1.35) : new THREE.Color('#d2c19a'));
  private readonly max: number;
  private readonly p0: THREE.InstancedBufferAttribute;
  private readonly v0: THREE.InstancedBufferAttribute;
  private next = 0;
  private clock = 0;
  private readonly acc = new Map<string, number>();
  /** Poussière permise par le préréglage (`dustParticles` > 0). */
  private readonly enabled: boolean;
  /** Instant (horloge des particules) de la dernière émission. */
  private lastEmit = -Infinity;
  /** Particules émises depuis le début (statistiques, tests visuels). */
  emitted = 0;

  constructor(q: QualitySettings) {
    this.max = Math.max(q.dustParticles, 1);
    // xyz = position d'émission, w = instant (s) ; très loin dans le passé au départ (invisible).
    const p = new Float32Array(this.max * 4);
    for (let i = 0; i < this.max; i++) p[i * 4 + 3] = -1e6;
    this.p0 = new THREE.InstancedBufferAttribute(p, 4);
    this.v0 = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 4), 4);
    const m = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
    const P = instancedBufferAttribute(this.p0) as unknown as THREE.Node<'vec4'>;
    const V = instancedBufferAttribute(this.v0) as unknown as THREE.Node<'vec4'>;
    const age = this.now.sub(P.w).max(0);
    const k = age.div(LIFE).min(1);
    // Freinage de l'air : la vitesse initiale s'éteint, la dérive au vent s'installe.
    const drag = float(1).sub(age.mul(-1.6).exp()).div(1.6);
    const drift = vec3(this.windDir.x, 0, this.windDir.y).mul(this.windMs.mul(0.35)).mul(age);
    const rise = vec3(0, age.mul(RISE).add(k.mul(0.3)), 0);
    m.positionNode = P.xyz.add(V.xyz.mul(drag)).add(drift).add(rise);
    m.scaleNode = float(0.25).add(k.mul(V.w).mul(GROW)).mul(age.lessThan(LIFE).select(float(1), float(0)));
    // Disque doux, opacité qui monte vite puis s'éteint.
    const c = uv().sub(0.5);
    const h = hash(instanceIndex);
    // Contour irrégulier : le rayon varie avec l'angle (lobes différents pour chaque particule).
    const ang = atan(c.y, c.x);
    const lobes = sin(ang.mul(3).add(h.mul(6.28))).mul(0.18).add(sin(ang.mul(5).add(h.mul(17))).mul(0.12)).add(sin(ang.mul(2).sub(h.mul(9))).mul(0.1));
    const r = c.length().mul(float(1).add(lobes));
    // smoothstep(a, b, x) exige a < b en WGSL : bords inversés = résultat indéfini (carrés en mosaïque).
    // Coupé avant le bord du carré : les lobes y laissaient un contour visible quand la poussière est dense.
    const soft = float(1).sub(smoothstep(0, 0.5, r)).mul(float(1).sub(smoothstep(0.36, 0.49, c.length())));
    const fade = smoothstep(0, 0.12, age).mul(float(1).sub(smoothstep(0.35, 1, k)));
    m.colorNode = mix(this.tint, this.tint.mul(0.85), h);
    const alpha = soft.mul(fade).mul(ALPHA);
    m.opacityNode = alpha;
    // Les quads entièrement transparents sont écartés : sinon ils assombrissent le fond en carrés.
    m.maskNode = alpha.greaterThan(0.004);
    this.sprite = new THREE.Sprite(m);
    this.enabled = q.dustParticles > 0;
    // Aucune particule vivante au départ : rien à dessiner (voir update). Le sprite reste visible, donc compilé au départ.
    this.sprite.count = 0;
    this.sprite.frustumCulled = false;
    this.sprite.renderOrder = 2;
    this.sprite.name = 'dust';
  }

  /**
   * Émet de la poussière derrière une roue qui roule à `speed` m/s (direction dx, dz), environ
   * 12 particules par seconde à 30 km/h. `id` identifie l'émetteur (cumul des fractions).
   */
  emit(id: string, x: number, y: number, z: number, dx: number, dz: number, speed: number, dt: number): void {
    if (!this.enabled || speed < 1.5) return;
    let a = (this.acc.get(id) ?? 0) + dt * speed * PER_M;
    while (a >= 1) {
      a -= 1;
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      const j = Math.random;
      // Lancée vers l'arrière et un peu sur les côtés, avec une fraction de la vitesse.
      const back = -speed * (0.15 + j() * 0.2);
      const side = (j() - 0.5) * 1.2;
      this.p0.setXYZW(i, x + (j() - 0.5) * 0.3, y + LIFT, z + (j() - 0.5) * 0.3, this.clock);
      this.v0.setXYZW(i, dx * back - dz * side, 0.3 + j() * 0.5, dz * back + dx * side, 0.7 + j() * 0.9);
      this.emitted++;
      this.lastEmit = this.clock;
    }
    this.acc.set(id, a);
    this.p0.needsUpdate = true;
    this.v0.needsUpdate = true;
  }

  update(dt: number): void {
    this.clock += dt;
    this.now.value = this.clock;
    // Sur l'enrobé, plus aucune particule ne vit après LIFE secondes : le sprite (jusqu'à 1 536 quads) n'est plus dessiné.
    const count = this.enabled && this.clock - this.lastEmit <= LIFE + 0.2 ? this.max : 0;
    if (this.sprite.count !== count) this.sprite.count = count;
  }
}
