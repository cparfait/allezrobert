import * as THREE from 'three/webgpu';
import { instancedBufferAttribute, float, vec3, uniform, smoothstep, uv, mix, hash, instanceIndex } from 'three/tsl';
import type { QualitySettings } from '../engine/quality.ts';
import type { LoadedTile } from './types.ts';

/** Revêtements OSM non goudronnés (poussière, roulement plus rugueux). */
export const UNPAVED_SURFACES = new Set(['unpaved', 'gravel', 'fine_gravel', 'dirt', 'ground', 'compacted', 'earth', 'sand', 'grass', 'pebblestone', 'mud']);
const LIFE = 2.6;

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
export function surfaceUnder(tile: LoadedTile | undefined, x: number, z: number): { unpaved: boolean; kind: string } | null {
  if (!tile) return null;
  let best: { unpaved: boolean; kind: string } | null = null;
  let bd = Infinity;
  for (const r of tile.features.roads) {
    const d = distToPolyline(x, z, r.pts) - r.width / 2;
    if (d < 1.5 && d < bd) {
      bd = d;
      best = { unpaved: isUnpaved(r.kind, r.surface), kind: r.kind };
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
  readonly tint = uniform(new THREE.Color('#b9a17c'));
  private readonly max: number;
  private readonly p0: THREE.InstancedBufferAttribute;
  private readonly v0: THREE.InstancedBufferAttribute;
  private next = 0;
  private clock = 0;
  private readonly acc = new Map<string, number>();
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
    const rise = vec3(0, age.mul(0.35).add(k.mul(0.3)), 0);
    m.positionNode = P.xyz.add(V.xyz.mul(drag)).add(drift).add(rise);
    m.scaleNode = float(0.25).add(k.mul(V.w)).mul(age.lessThan(LIFE).select(float(1), float(0)));
    // Disque doux, opacité qui monte vite puis s'éteint.
    const r = uv().sub(0.5).length();
    // smoothstep(a, b, x) exige a < b en WGSL : bords inversés = résultat indéfini (carrés en mosaïque).
    const soft = float(1).sub(smoothstep(0.15, 0.5, r));
    const fade = smoothstep(0, 0.12, age).mul(float(1).sub(smoothstep(0.35, 1, k)));
    const h = hash(instanceIndex);
    m.colorNode = mix(this.tint, this.tint.mul(0.8), h);
    m.opacityNode = soft.mul(fade).mul(0.28);
    this.sprite = new THREE.Sprite(m);
    this.sprite.count = q.dustParticles > 0 ? this.max : 0;
    this.sprite.frustumCulled = false;
    this.sprite.renderOrder = 2;
    this.sprite.name = 'dust';
  }

  /**
   * Émet de la poussière derrière une roue qui roule à `speed` m/s (direction dx, dz), environ
   * 12 particules par seconde à 30 km/h. `id` identifie l'émetteur (cumul des fractions).
   */
  emit(id: string, x: number, y: number, z: number, dx: number, dz: number, speed: number, dt: number): void {
    if (this.sprite.count === 0 || speed < 1.5) return;
    let a = (this.acc.get(id) ?? 0) + dt * speed * 1.4;
    while (a >= 1) {
      a -= 1;
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      const j = Math.random;
      // Lancée vers l'arrière et un peu sur les côtés, avec une fraction de la vitesse.
      const back = -speed * (0.15 + j() * 0.2);
      const side = (j() - 0.5) * 1.2;
      this.p0.setXYZW(i, x + (j() - 0.5) * 0.3, y + 0.05, z + (j() - 0.5) * 0.3, this.clock);
      this.v0.setXYZW(i, dx * back - dz * side, 0.3 + j() * 0.5, dz * back + dx * side, 1.2 + j() * 1.4);
      this.emitted++;
    }
    this.acc.set(id, a);
    this.p0.needsUpdate = true;
    this.v0.needsUpdate = true;
  }

  update(dt: number): void {
    this.clock += dt;
    this.now.value = this.clock;
  }
}
