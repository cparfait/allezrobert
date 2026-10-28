import * as THREE from 'three/webgpu';
import { abs, attribute, cos, float, floor, length, mix, mod, positionLocal, sin, smoothstep, step, time, uniform, uniformArray, vec2, vec3 } from 'three/tsl';
import { baseRouteId, type RouteTrack, type TrackSample } from '@allezrobert/shared';
import { polygonArea, rng } from '../engine/noise.ts';
import type { SoundSource } from '../audio/spatial.ts';
import type { LoadedTile } from './types.ts';
import { LandProbe, MeshBuilder, dist2Seg, flatVertexMaterial, segmentsIn } from './lowPolyKit.ts';
import { lifeTemplates, type LifeTemplates } from './lowPolyProps.ts';
import { FarmAnimals, farmAnimalsReady, loadFarmAnimals, type AnimalSpec } from './farmAnimals.ts';

/**
 * Abords de la route façon jeu vidéo (style low poly, voir engine/style.ts) : clôtures blanches ou en
 * bois (ouvertes devant les chemins et les entrées, arrêtées devant les maisons), haies et buissons,
 * poteaux électriques et leurs câbles, fleurs et cailloux, troupeaux de vaches, de moutons et de
 * chevaux avec leur abreuvoir, mares et roseaux, ponts et buses des ruisseaux, et dans les villages
 * boîtes aux lettres, poubelles, fontaines, bornes et terrains de foot.
 *
 * Le parcours est découpé en tronçons de CHUNK_M, peuplés quand le coureur approche (terrain chargé)
 * et oubliés loin derrière. Chaque tronçon fusionne tout son décor fixe en un seul maillage (plus un
 * pour les animaux, un pour l'eau et des lignes pour les câbles et les filets) : 2 à 4 appels de dessin
 * par tronçon, éliminés hors du champ par leur sphère englobante, ombres portées seulement à moins de
 * SHADOW_M du coureur. Les animaux ne s'animent qu'à l'approche du coureur (tête qui se relève, chevaux
 * qui trottent), tout dans le shader sauf l'angle des manèges de chevaux.
 *
 * Chaque tronçon expose aussi ce qui anime le décor : places des personnages (roadsidePeople.ts),
 * touffes de fleurs (papillons) et perchoirs (oiseaux, skyLife.ts), sources sonores des troupeaux.
 */

const CHUNK_M = 120;
/** Tronçons peuplés jusqu'à cette distance du coureur (m), oubliés au-delà de FORGET_M. */
const BUILD_M = 650;
const FORGET_M = 900;
/** Ombres portées du décor à moins de cette distance (m) du tronçon. */
const SHADOW_M = 60;
/** Manèges de chevaux animés en même temps (tableau d'uniformes). */
const TROT_SLOTS = 16;

export type HerdKind = 'cow' | 'sheep' | 'horse';

/** Place d'un personnage (voir roadsidePeople.ts). */
export interface PersonSpot {
  kind: 'fisher' | 'child' | 'villager' | 'jogger' | 'walker' | 'pitch';
  x: number;
  y: number;
  z: number;
  /** Cap : l'avant (+z local) regarde (sin yaw, cos yaw). */
  yaw: number;
  /** Joggeurs et promeneurs : trajet le long de l'accotement, (x, y, z) tous les 4 m. */
  path?: Float32Array;
  /** Terrain de foot : axe long (ux, uz), demi-longueur et demi-largeur jouables. */
  pitch?: { ux: number; uz: number; hl: number; hw: number };
  seed: number;
}

/** Oiseaux posés (fil électrique ou champ) : positions (x, y, z) et cap. */
export interface BirdPerch {
  pts: Float32Array;
  yaw: number;
  ground: boolean;
  x: number;
  z: number;
}

/** Ce qu'un tronçon expose aux autres systèmes. */
export interface LifeChunk {
  readonly spots: readonly PersonSpot[];
  /** Touffes de fleurs (x, y, z). */
  readonly flowers: Float32Array;
  readonly perches: readonly BirdPerch[];
}

/** Densités : décor (QualitySettings.propDensity) et personnages (trafic et public). */
export interface LifeDensity {
  props: number;
  people: number;
}

interface Herd {
  kind: HerdKind;
  x: number;
  z: number;
  /** Manège de chevaux : case du tableau d'uniformes (−1 sans manège), rayon, vitesse lissée, angle. */
  slot: number;
  radius: number;
  speed: number;
  angle: number;
}

interface Chunk extends LifeChunk {
  k: number;
  d0: number;
  d1: number;
  /** Points de contrôle (x, z à d0, milieu, d1) : un itinéraire ouvert modifié invalide le tronçon. */
  sig: number[];
  /** Ligne médiane échantillonnée (x, z tous les 10 m) pour les distances au coureur. */
  line: Float32Array;
  objects: THREE.Object3D[];
  casters: THREE.Mesh[];
  near: boolean;
  herd: Herd | null;
  sources: SoundSource[];
  /** Animaux animés (modèles Quaternius, farmAnimals.ts) ; vide : troupeau en blocs dans `objects`. */
  animals: AnimalSpec[];
}

/** Portion de route au-dessus de l'eau : ruisseau busé (`small`) ou pont. */
interface Span {
  a: number;
  b: number;
  small: boolean;
}

type LineFn = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, c: THREE.Color) => void;

const WHITE = new THREE.Color('#f2f0ea');
const WOOD = new THREE.Color('#7a5434');
const STONE = new THREE.Color('#c9bfa8');
const FLOWERS = ['#e0413a', '#f07aa8', '#f7f4ee', '#f4cf3a', '#9a6bd8', '#ff8a3d'].map((c) => new THREE.Color(c));
const COWS = ['#f4f1ea', '#8a5a36', '#3a2c24', '#c98a4f'].map((c) => new THREE.Color(c));
const HORSES = ['#6b4128', '#3d2a1e', '#a9733f', '#d9cfc0'].map((c) => new THREE.Color(c));
const BUSH = ['#4f8a34', '#5f9a3a', '#3f7a32', '#6aa444', '#557f2e'].map((c) => new THREE.Color(c));
const MAILBOX = ['#2f5b3a', '#6b6f72', '#ece8de', '#1f2124', '#b9a77a', '#8a2a24'].map((c) => new THREE.Color(c));
const PITCH = [new THREE.Color('#5fae3e'), new THREE.Color('#52a037')];
const LINE = new THREE.Color('#f6f6f2');
const MUD = new THREE.Color('#7a6a45');
const POND_DEEP = new THREE.Color().setRGB(0.07, 0.27, 0.5);
const POND_SHALLOW = new THREE.Color().setRGB(0.16, 0.42, 0.62);
const TROUGH_WATER = new THREE.Color().setRGB(0.12, 0.3, 0.42);
const WIRE = new THREE.Color('#2a2a2a');
const NET = new THREE.Color('#d8d8d4');
const ONE = new THREE.Color(1, 1, 1);
const UTILITY = new Set(['shed', 'garage', 'garages', 'barn', 'greenhouse', 'roof', 'industrial', 'ruins', 'church', 'chapel', 'farm_auxiliary', 'warehouse', 'commercial', 'retail', 'transformer_tower', 'hut', 'carport']);

/** Position du coureur (animaux qui se réveillent à son approche) et angles des manèges. */
const focusU = uniform(new THREE.Vector3());
const trotVals = Array.from({ length: TROT_SLOTS }, () => new THREE.Vector4());
const trotU = uniformArray(trotVals, 'vec4');

/** Matériau des animaux : broute loin du coureur, tête relevée de près, manèges de chevaux. */
function animalMaterial(): THREE.MeshStandardNodeMaterial {
  const m = flatVertexMaterial(0.9);
  // anim = (tête + 2 × (case + 1), phase, centre x, centre z) ; centre = l'animal ou son manège
  const a = attribute<'vec4'>('anim');
  const head = mod(a.x, 2);
  const slotP1 = floor(a.x.div(2));
  const phase = a.y;
  const c = vec2(a.z, a.w);
  const dist = length(c.sub(vec2(focusU.x, focusU.z)));
  // réveil échelonné d'un animal à l'autre, entre 40 et 85 m
  const near = float(1).sub(smoothstep(float(55).sub(phase.mul(15)), float(85).sub(phase.mul(15)), dist));
  // loin : tête baissée, immobile (broute) ; près : relevée, avec de rares coups de nez dans l'herbe
  const dip = sin(time.mul(0.5).add(phase.mul(40))).mul(0.5).add(0.5).pow(8);
  const headY = mix(float(-0.45), dip.mul(-0.42), near);
  const p = positionLocal.add(vec3(0, head.mul(headY), 0));
  const trotting = step(0.5, slotP1);
  const tv = trotU.element(slotP1.sub(1).max(0).toInt()) as unknown as THREE.Node<'vec4'>;
  const ang = tv.x.mul(trotting);
  const spd = tv.y.mul(trotting);
  const rx = p.x.sub(c.x);
  const rz = p.z.sub(c.y);
  const co = cos(ang);
  const si = sin(ang);
  m.positionNode = vec3(c.x.add(rx.mul(co)).add(rz.mul(si)), p.y.add(abs(sin(time.mul(7.5).add(phase.mul(6)))).mul(0.14).mul(spd)), c.y.sub(rx.mul(si)).add(rz.mul(co)));
  return m;
}

/** Eau des mares, fontaines et abreuvoirs : aplats brillants, facettes qui frémissent. */
function wetMaterial(): THREE.MeshStandardNodeMaterial {
  const m = flatVertexMaterial(0.12);
  const p = positionLocal;
  m.positionNode = p.add(vec3(0, sin(time.mul(1.3).add(p.x.mul(0.9)).add(p.z.mul(1.1))).mul(0.015), 0));
  return m;
}

export class RoadsideLife {
  readonly group = new THREE.Group();
  /** Sources sonores des troupeaux proches (mêmes objets d'une mise à jour à l'autre). */
  sources: SoundSource[] = [];
  /** Incrémenté à chaque tronçon ajouté ou oublié. */
  version = 0;
  private track: RouteTrack;
  private readonly probe: LandProbe;
  private density: LifeDensity;
  private tpl: LifeTemplates | null = null;
  private readonly chunks = new Map<number, Chunk>();
  private readonly list: Chunk[] = [];
  private readonly staticMat = flatVertexMaterial(0.9);
  private readonly wetMat = wetMaterial();
  private readonly wireMat = new THREE.LineBasicNodeMaterial({ vertexColors: true });
  private readonly animalMat = animalMaterial();
  private readonly trotOwner: Array<Herd | null> = new Array<Herd | null>(TROT_SLOTS).fill(null);
  private readonly sb = new MeshBuilder(16384);
  private readonly ab = new MeshBuilder(4096, 4);
  private readonly wb = new MeshBuilder(512);
  private readonly lines: number[] = [];
  private readonly lineCols: number[] = [];
  private pending = true;
  private readonly last = new THREE.Vector3(Infinity, 0, 0);
  private readonly s: TrackSample = { x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, grade: 0, d: 0 };
  private readonly s2: TrackSample = { x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, grade: 0, d: 0 };
  /** Centres des tronçons (x, z), recalculés quand la longueur de l'itinéraire change. */
  private centres = new Float64Array(0);
  private centresLength = -1;
  private disposed = false;
  /** Vaches, chevaux et moutons animés (Quaternius). */
  private readonly farm = new FarmAnimals();

  /**
   * `treesIn` : arbres déjà plantés par la végétation dans un rectangle, (x, z, rayon) à la suite ;
   * les animaux, cailloux, mares et terrains de foot les évitent.
   */
  constructor(
    track: RouteTrack,
    heightAt: (x: number, z: number) => number,
    tileAt: (x: number, z: number) => LoadedTile | undefined,
    density: LifeDensity,
    private readonly treesIn?: (minX: number, minZ: number, maxX: number, maxZ: number) => number[],
  ) {
    this.track = track;
    this.probe = new LandProbe(tileAt, heightAt);
    this.density = density;
    this.group.add(this.farm.group);
    // Animaux animés : dès que les modèles sont chargés, les tronçons déjà peuplés (avec des troupeaux en
    // blocs) sont refaits, pour que les premiers troupeaux soient animés eux aussi.
    void loadFarmAnimals().then((ok) => {
      if (!ok || this.disposed) return;
      for (const k of [...this.chunks.keys()]) this.drop(k);
      this.pending = true;
      this.afterChange();
    });
    this.group.name = 'roadside-life';
    for (const v of trotVals) v.set(0, 0, 0, 0);
  }

  /** Tronçons peuplés (lecture seule). */
  get chunkList(): readonly LifeChunk[] {
    return this.list;
  }

  /** Change d'itinéraire (monde ouvert : celui du navigateur) : tout est repeuplé. */
  setTrack(track: RouteTrack): void {
    if (track === this.track) return;
    for (const k of [...this.chunks.keys()]) this.drop(k);
    this.track = track;
    this.centresLength = -1;
    this.pending = true;
    this.afterChange();
  }

  /** Nouvelles densités : appliquées aux tronçons peuplés ensuite. */
  setDensity(d: LifeDensity): void {
    this.density = d;
  }

  /** Peuple les tronçons proches de `focus` (terrain chargé), oublie les lointains, anime les manèges. */
  update(dt: number, focus: THREE.Vector3): void {
    (focusU.value as THREE.Vector3).copy(focus);
    this.animateHerds(dt, focus);
    this.farm.update(dt, focus);
    const lengthChanged = this.centresLength !== this.track.length;
    // Revu tous les 15 m parcourus, ou à chaque image tant qu'un tronçon proche attend son terrain.
    if (!this.pending && !lengthChanged && this.last.distanceToSquared(focus) < 225) return;
    this.last.copy(focus);
    this.pending = false;
    if (lengthChanged) this.revalidate();
    const n = this.centres.length / 2;
    let nearest = Infinity;
    for (let k = 0; k < n; k++) nearest = Math.min(nearest, Math.hypot((this.centres[k * 2] as number) - focus.x, (this.centres[k * 2 + 1] as number) - focus.z));
    // Coureur loin de cet itinéraire (monde ouvert avant le choix du chemin, caméra libre) : rien de neuf.
    const onTrack = nearest < 150;
    let changed = false;
    let built = false;
    for (let k = 0; k < n; k++) {
      const dist = Math.hypot((this.centres[k * 2] as number) - focus.x, (this.centres[k * 2 + 1] as number) - focus.z);
      const has = this.chunks.has(k);
      if (has && dist > FORGET_M) {
        this.drop(k);
        changed = true;
      } else if (!has && dist < BUILD_M && onTrack) {
        // Un tronçon par image (quelques millisecondes) ; les suivants aux images d'après.
        if (built) {
          this.pending = true;
          continue;
        }
        const c = this.build(k);
        if (!c) {
          this.pending = true;
          continue;
        }
        this.chunks.set(k, c);
        for (const o of c.objects) this.group.add(o);
        this.farm.add(k, c.animals);
        built = true;
        changed = true;
      }
    }
    for (const c of this.chunks.values()) {
      const near = lineDistance(c.line, focus.x, focus.z) < SHADOW_M;
      if (near === c.near) continue;
      c.near = near;
      for (const m of c.casters) m.castShadow = near;
    }
    if (changed) this.afterChange();
  }

  /** Après un ajout ou un oubli : listes exposées, sources sonores. */
  private afterChange(): void {
    this.list.length = 0;
    const sources: SoundSource[] = [];
    for (const c of this.chunks.values()) {
      this.list.push(c);
      sources.push(...c.sources);
    }
    this.sources = sources;
    this.version++;
  }

  /** Centres des tronçons ; si l'itinéraire a été prolongé ou modifié (monde ouvert), tronçons périmés oubliés. */
  private revalidate(): void {
    const len = this.track.length;
    const n = Math.max(0, Math.ceil(len / CHUNK_M));
    this.centres = new Float64Array(n * 2);
    for (let k = 0; k < n; k++) {
      const p = this.track.positionAt(Math.min((k + 0.5) * CHUNK_M, len), 0, this.s);
      this.centres[k * 2] = p.x;
      this.centres[k * 2 + 1] = p.z;
    }
    if (this.centresLength >= 0) {
      for (const c of [...this.chunks.values()]) {
        const partial = c.d1 < c.d0 + CHUNK_M - 1e-6 && len > c.d1 + 1;
        if (partial || c.k >= n || !this.sameSig(c)) this.drop(c.k);
      }
      this.afterChange();
    }
    this.centresLength = len;
  }

  private sameSig(c: Chunk): boolean {
    const ds = [c.d0, (c.d0 + c.d1) / 2, c.d1];
    for (let i = 0; i < 3; i++) {
      const p = this.track.positionAt(ds[i] as number, 0, this.s);
      if (Math.abs(p.x - (c.sig[i * 2] as number)) > 0.5 || Math.abs(p.z - (c.sig[i * 2 + 1] as number)) > 0.5) return false;
    }
    return true;
  }

  private drop(k: number): void {
    const c = this.chunks.get(k);
    if (!c) return;
    this.chunks.delete(k);
    this.farm.remove(k);
    for (const o of c.objects) {
      this.group.remove(o);
      (o as THREE.Mesh).geometry.dispose();
    }
    if (c.herd && c.herd.slot >= 0) {
      this.trotOwner[c.herd.slot] = null;
      (trotVals[c.herd.slot] as THREE.Vector4).set(0, 0, 0, 0);
    }
  }

  /** Manèges : les chevaux se mettent au trot quand le coureur approche (< 80 m), s'arrêtent ensuite. */
  private animateHerds(dt: number, focus: THREE.Vector3): void {
    for (let i = 0; i < TROT_SLOTS; i++) {
      const h = this.trotOwner[i];
      if (!h) continue;
      const d = Math.hypot(h.x - focus.x, h.z - focus.z);
      const target = d < 80 ? 1 : 0;
      h.speed += (target - h.speed) * Math.min(1, dt * (target ? 0.9 : 0.4));
      // trot ≈ 3,5 m/s sur le cercle
      h.angle = (h.angle + ((3.5 * h.speed) / h.radius) * dt) % (Math.PI * 2);
      (trotVals[i] as THREE.Vector4).set(h.angle, h.speed, 0, 0);
    }
  }

  private build(k: number): Chunk | null {
    const track = this.track;
    const probe = this.probe;
    const d0 = k * CHUNK_M;
    const d1 = Math.min(d0 + CHUNK_M, track.length);
    if (d1 - d0 < 1) return null;
    probe.forget();
    const ground = (x: number, z: number) => probe.heightAt(x, z);
    // Terrain chargé aux deux bouts et au milieu (sinon on réessaiera).
    const sig: number[] = [];
    for (const d of [d0, (d0 + d1) / 2, d1]) {
      const p = track.positionAt(d, 0, this.s);
      if (!Number.isFinite(ground(p.x, p.z)) || !probe.read(p.x, p.z)) return null;
      sig.push(p.x, p.z);
    }
    const tpl = (this.tpl ??= lifeTemplates());
    const props = Math.max(0, this.density.props);
    const people = Math.max(0, this.density.people);
    const sb = this.sb;
    const ab = this.ab;
    const wb = this.wb;
    sb.reset();
    ab.reset();
    wb.reset();
    const lines = this.lines;
    const lineCols = this.lineCols;
    lines.length = 0;
    lineCols.length = 0;
    const spots: PersonSpot[] = [];
    const flowers: number[] = [];
    const perches: BirdPerch[] = [];
    const sources: SoundSource[] = [];
    const animals: AnimalSpec[] = [];
    const useFarm = farmAnimalsReady();
    const r = rng(k * 7919 + 13);
    const s = this.s;
    const halfAt = (d: number) => track.widthAt(d) / 2;
    const tmpC = new THREE.Color();
    const line: LineFn = (ax, ay, az, bx, by, bz, c) => {
      lines.push(ax, ay, az, bx, by, bz);
      lineCols.push(c.r, c.g, c.b, c.r, c.g, c.b);
    };

    // ── Ligne médiane tous les 4 m : x, z, y (profil de la route), dirX, dirZ, urbain ──
    const STEP = 4;
    const nS = Math.floor((d1 - d0) / STEP) + 1;
    const cl = new Float32Array(nS * 6);
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    let urbanMax = 0;
    for (let i = 0; i < nS; i++) {
      const p = track.positionAt(Math.min(d0 + i * STEP, d1), 0, s);
      const u = probe.read(p.x, p.z) ? probe.urban : 0;
      cl.set([p.x, p.z, p.y, p.dirX, p.dirZ, u], i * 6);
      urbanMax = Math.max(urbanMax, u);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const lineXZ: number[] = [];
    for (let i = 0; i < nS; i += 3) lineXZ.push(cl[i * 6] as number, cl[i * 6 + 1] as number);
    lineXZ.push(cl[(nS - 1) * 6] as number, cl[(nS - 1) * 6 + 1] as number);
    const M = 70;
    probe.setTrees(this.treesIn?.(minX - M, minZ - M, maxX + M, maxZ + M) ?? []);
    const routeId = baseRouteId(track.route.id);
    const allRoads = segmentsIn(probe, minX - M, minZ - M, maxX + M, maxZ + M, 'roads', (rd) => !!rd.route && (rd.route === routeId || rd.route === track.route.id));
    // La voie OSM suivie elle-même (monde ouvert, doublons d'itinéraire) : parallèle et centrée sur la ligne médiane.
    const roads: number[] = [];
    for (let i = 0; i < allRoads.length; i += 5) {
      const ax = allRoads[i] as number;
      const az = allRoads[i + 1] as number;
      const bx = allRoads[i + 2] as number;
      const bz = allRoads[i + 3] as number;
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      const L = Math.hypot(bx - ax, bz - az) || 1;
      let own = false;
      for (let j = 0; j < nS && !own; j++) {
        const dx = (cl[j * 6] as number) - mx;
        const dz = (cl[j * 6 + 1] as number) - mz;
        if (dx * dx + dz * dz > 9 + (L * L) / 4) continue;
        const along = Math.abs(((bx - ax) * (cl[j * 6 + 3] as number) + (bz - az) * (cl[j * 6 + 4] as number)) / L);
        own = along > 0.9 && dist2Seg(cl[j * 6] as number, cl[j * 6 + 1] as number, ax, az, bx, bz) < 6.25;
      }
      if (!own) for (let q = 0; q < 5; q++) roads.push(allRoads[i + q] as number);
    }
    const waterways = segmentsIn(probe, minX - 10, minZ - 10, maxX + 10, maxZ + 10, 'waterways');

    /** Une voie OSM (chemin, desserte, entrée) qui croise la ligne de clôture en (x, z) ; la route suivie, parallèle, ne compte pas. */
    const sideRoad = (x: number, z: number, dirX: number, dirZ: number, margin: number) => {
      for (let i = 0; i < roads.length; i += 5) {
        const ax = roads[i] as number;
        const az = roads[i + 1] as number;
        const bx = roads[i + 2] as number;
        const bz = roads[i + 3] as number;
        const rr = (roads[i + 4] as number) + margin;
        if (dist2Seg(x, z, ax, az, bx, bz) > rr * rr) continue;
        const L = Math.hypot(bx - ax, bz - az) || 1;
        if (Math.abs(((bx - ax) * dirX + (bz - az) * dirZ) / L) > 0.82) continue;
        return true;
      }
      return false;
    };
    /** Une voie OSM (quelle qu'elle soit, sauf l'itinéraire) à moins de `margin` m de son bord. */
    const onAnyRoad = (x: number, z: number, margin: number) => {
      for (let i = 0; i < roads.length; i += 5) {
        const rr = (roads[i + 4] as number) + margin;
        if (dist2Seg(x, z, roads[i] as number, roads[i + 1] as number, roads[i + 2] as number, roads[i + 3] as number) < rr * rr) return true;
      }
      return false;
    };

    // ── Ponts et buses : cours d'eau OSM qui croisent la ligne médiane, eau du raster sous la route ──
    const spans: Span[] = [];
    for (let w = 0; w < waterways.length; w += 5) {
      const ax = waterways[w] as number;
      const az = waterways[w + 1] as number;
      const bx = waterways[w + 2] as number;
      const bz = waterways[w + 3] as number;
      // demi-largeur négative : ruisseau busé sous la route (OSM tunnel=culvert)
      const culvert = (waterways[w + 4] as number) < 0;
      const hw = Math.abs(waterways[w + 4] as number);
      for (let i = 0; i + 1 < nS; i++) {
        const t = segCross(cl[i * 6] as number, cl[i * 6 + 1] as number, cl[(i + 1) * 6] as number, cl[(i + 1) * 6 + 1] as number, ax, az, bx, bz);
        if (t < 0) continue;
        const d = d0 + (i + t) * STEP;
        // un sommet de la polyligne pile sur la route donne deux croisements : un seul suffit
        if (spans.some((sp) => Math.abs((sp.a + sp.b) / 2 - d) < 3)) continue;
        spans.push({ a: d - hw - 3, b: d + hw + 3, small: culvert || hw * 2 < 2.6 });
      }
    }
    {
      let runA = -1;
      for (let i = 0; i < nS; i++) {
        const x = cl[i * 6] as number;
        const z = cl[i * 6 + 1] as number;
        const dx = cl[i * 6 + 3] as number;
        const dz = cl[i * 6 + 4] as number;
        const h = halfAt(d0 + i * STEP) + 1.5;
        const wet = probe.read(x, z) && probe.water > 0.45 && probe.read(x - dz * h, z + dx * h) && probe.water > 0.45 && probe.read(x + dz * h, z - dx * h) && probe.water > 0.45;
        if (wet && runA < 0) runA = d0 + i * STEP;
        if ((!wet || i === nS - 1) && runA >= 0) {
          // eau du raster sous la route : pont, sauf si c'est le ruisseau déjà croisé (trait d'un pixel)
          const a = runA - 4;
          const b = d0 + i * STEP + 4;
          if (!spans.some((sp) => sp.b > a && sp.a < b)) spans.push({ a, b, small: false });
          runA = -1;
        }
      }
    }
    const inSpan = (d: number, m = 0) => spans.some((sp) => d > sp.a - m && d < sp.b + m);

    // ── Clôtures : même type sur de longues portions (par tranches de 360 m et par côté), haies ──
    for (const side of [-1, 1]) {
      const pr = rng(Math.floor(d0 / 360) * 31 + (side > 0 ? 7 : 3));
      const pick = pr();
      const type = pick < 0.4 ? 0 : pick < 0.72 ? 1 : 2;
      // haie : seule (sans clôture) ou doublant une clôture en bois
      const hedge = pr() < (type === 0 ? 0.45 : type === 2 ? 0.25 : 0.08) * Math.min(1, 0.4 + props);
      const hr = rng(k * 131 + (side > 0 ? 17 : 5));
      if (type) {
        const col = type === 1 ? WHITE : WOOD;
        let px = 0;
        let py = 0;
        let pz = 0;
        let has = false;
        for (let d = d0; d <= d1; d += 2.4) {
          track.positionAt(d, side * (halfAt(d) + 2.3), s);
          const y = ground(s.x, s.z);
          // portail devant chaque voie latérale, arrêt devant les maisons et sur les ponts
          if (!Number.isFinite(y) || inSpan(d, 2) || !probe.open(s.x, s.z) || sideRoad(s.x, s.z, s.dirX, s.dirZ, 2.2) || probe.buildingNear(s.x, s.z, 5)) {
            has = false;
            continue;
          }
          sb.put(tpl.post, s.x, y, s.z, Math.atan2(-s.dirZ, s.dirX), 1, 1, 1, col);
          if (has && Math.hypot(s.x - px, s.z - pz) < 4) {
            const vx = s.x - px;
            const vy = y - py;
            const vz = s.z - pz;
            const hl = Math.hypot(vx, vz) || 1;
            for (const h of type === 1 ? [0.55, 0.95] : [0.4, 0.75, 1.05]) sb.putBasis(tpl.rail, px, py + h, pz, vx, vy, vz, 0, 1, 0, -vz / hl, 0, vx / hl, col.r, col.g, col.b);
          }
          px = s.x;
          py = y;
          pz = s.z;
          has = true;
        }
      }
      if (hedge) {
        for (let d = d0; d < d1; d += 1.7) {
          track.positionAt(d, side * (halfAt(d) + (type ? 3.4 : 2.7) + hr() * 0.3), s);
          const y = ground(s.x, s.z);
          if (!Number.isFinite(y) || inSpan(d, 2) || !probe.open(s.x, s.z) || sideRoad(s.x, s.z, s.dirX, s.dirZ, 2.2) || probe.buildingNear(s.x, s.z, 3)) continue;
          const sc = 0.75 + hr() * 0.4;
          const c = BUSH[Math.floor(hr() * BUSH.length)] as THREE.Color;
          sb.put(hr() < 0.1 ? tpl.bushBlossom : tpl.bush, s.x, y - 0.15, s.z, hr() * 6.28, sc * 1.1, sc * (0.9 + hr() * 0.4), sc, c);
        }
      }
    }

    // ── Poteaux électriques : un côté par tranche de 600 m, tous les 45 m, câbles entre deux poteaux ──
    const poleSide = rng(Math.floor(d0 / 600) * 17 + 5)() < 0.5 ? -1 : 1;
    const poleOn = rng(Math.floor(d0 / 600) * 23 + 9)() < 0.75;
    if (poleOn) {
      const first = Math.ceil(d0 / 45) * 45;
      for (let d = first; d < d1; d += 45) {
        if (inSpan(d, 4)) continue;
        const a = this.polePoint(d, poleSide);
        if (!a) continue;
        sb.put(tpl.pole, a[0], a[1], a[2], Math.atan2(-a[4], a[3]), 1, 1, 1, WOOD);
        const b = this.polePoint(d + 45, poleSide);
        if (!b) continue;
        // Trois câbles (bouts de la traverse et milieu), flèche de 0,7 m au milieu de la portée.
        for (const off of [-0.7, 0, 0.7]) {
          // traverse perpendiculaire à la route : décalage selon la normale (−dirZ, dirX)
          const ax = a[0] - a[4] * off;
          const ay = a[1] + 8.3;
          const az = a[2] + a[3] * off;
          const bx = b[0] - b[4] * off;
          const by = b[1] + 8.3;
          const bz = b[2] + b[3] * off;
          const SEG = 8;
          for (let i = 0; i < SEG; i++) {
            const t0 = i / SEG;
            const t1 = (i + 1) / SEG;
            line(ax + (bx - ax) * t0, ay + (by - ay) * t0 - 2.8 * t0 * (1 - t0), az + (bz - az) * t0, ax + (bx - ax) * t1, ay + (by - ay) * t1 - 2.8 * t1 * (1 - t1), az + (bz - az) * t1, WIRE);
          }
          // Oiseaux posés sur le câble du milieu d'une portée sur trois.
          if (off === 0 && r() < 0.33) {
            const nb = 4 + Math.floor(r() * 5);
            const pts = new Float32Array(nb * 3);
            for (let i = 0; i < nb; i++) {
              const t = 0.3 + i * 0.045 + r() * 0.02;
              pts.set([ax + (bx - ax) * t, ay + (by - ay) * t - 2.8 * t * (1 - t) + 0.02, az + (bz - az) * t], i * 3);
            }
            perches.push({ pts, yaw: Math.atan2(-a[4], a[3]) + (r() < 0.5 ? Math.PI / 2 : -Math.PI / 2), ground: false, x: (ax + bx) / 2, z: (az + bz) / 2 });
          }
        }
      }
    }

    // ── Fleurs en touffes, cailloux et buissons sur les bas-côtés ──
    for (let d = d0; d < d1; d += 3) {
      const half = halfAt(d);
      const span = inSpan(d, 2);
      for (const side of [-1, 1]) {
        if (r() > 0.42) continue;
        track.positionAt(d + r() * 3, side * (half + 0.9 + r() * 5), s);
        if (span || !probe.open(s.x, s.z) || sideRoad(s.x, s.z, s.dirX, s.dirZ, 0.5)) continue;
        const col = FLOWERS[Math.floor(r() * FLOWERS.length)] as THREE.Color;
        const n = 2 + Math.floor(r() * 5);
        let fy = Number.NaN;
        for (let i = 0; i < n; i++) {
          const x = s.x + (r() - 0.5) * 1.4;
          const z = s.z + (r() - 0.5) * 1.4;
          const y = ground(x, z);
          if (!Number.isFinite(y)) continue;
          const sc = 0.8 + r() * 0.6;
          sb.put(tpl.flower, x, y, z, r() * 6.28, sc, sc, sc, col);
          fy = y;
        }
        if (Number.isFinite(fy)) flowers.push(s.x, fy + 0.4, s.z);
      }
      if (r() < 0.06) {
        const side = r() < 0.5 ? -1 : 1;
        track.positionAt(d, side * (half + 1.5 + r() * 7), s);
        const y = ground(s.x, s.z);
        // pas dans une lisière, sous un arbre, contre une maison ni sur un chemin
        if (Number.isFinite(y) && !span && probe.clear(s.x, s.z, 1.5) && !onAnyRoad(s.x, s.z, 0.8)) {
          const sc = 0.2 + r() * 0.45;
          const grey = tmpC.setHSL(0.08, 0.06, 0.45 + r() * 0.15);
          sb.put(tpl.rock, s.x, y - sc * 0.35, s.z, r() * 6.28, sc * 1.2, sc * 0.8, sc, grey);
        }
      }
      if (r() < 0.07 * props) {
        const side = r() < 0.5 ? -1 : 1;
        track.positionAt(d, side * (half + 2 + r() * 6), s);
        const y = ground(s.x, s.z);
        if (Number.isFinite(y) && !span && probe.open(s.x, s.z) && !onAnyRoad(s.x, s.z, 1) && !probe.buildingNear(s.x, s.z, 2)) {
          const pick = r();
          const t = pick < 0.7 ? tpl.bush : pick < 0.8 ? tpl.bushBerries : pick < 0.9 ? tpl.bushBlossom : tpl.bushPink;
          const sc = 0.55 + r() * 0.75;
          sb.put(t, s.x, y - 0.1, s.z, r() * 6.28, sc * (0.9 + r() * 0.3), sc * (0.8 + r() * 0.4), sc, BUSH[Math.floor(r() * BUSH.length)] as THREE.Color);
        }
      }
    }

    // ── Ponts (parapets en pierre ou garde-corps en bois) et têtes de buse des ruisseaux ──
    for (const sp of spans) {
      if (sp.small) {
        const dc = (sp.a + sp.b) / 2;
        if (dc < d0 || dc >= d1) continue;
        for (const side of [-1, 1]) {
          track.positionAt(dc, side * (halfAt(dc) + 1.5), s);
          const gy = ground(s.x, s.z);
          const y = Math.min(Number.isFinite(gy) ? gy : s.y, s.y - 1.2);
          // face avant (+z) vers l'extérieur de la route
          sb.put(tpl.headwall, s.x, y, s.z, Math.atan2(-s.dirZ * side, s.dirX * side), 1, 1, 1, ONE);
        }
        continue;
      }
      const a = Math.max(sp.a, d0);
      const b = Math.min(sp.b, d1);
      if (b - a < 0.5) continue;
      const wood = sp.b - sp.a < 14 && urbanMax < 0.3 && rng(Math.round(sp.a))() < 0.5;
      for (const side of [-1, 1]) {
        for (let d = a; d < b - 0.1; d += 2) {
          const e = Math.min(d + 2, b);
          const lat = side * (halfAt(d) + 0.35);
          track.positionAt(d, lat, s);
          track.positionAt(e, lat, this.s2);
          const vx = this.s2.x - s.x;
          const vy = this.s2.y - s.y;
          const vz = this.s2.z - s.z;
          const hl = Math.hypot(vx, vz) || 1;
          if (wood) {
            sb.put(tpl.post, s.x, s.y, s.z, Math.atan2(-s.dirZ, s.dirX), 1.1, 0.95, 1.1, WOOD);
            for (const h of [0.5, 0.95]) sb.putBasis(tpl.rail, s.x, s.y + h, s.z, vx, vy, vz, 0, 1, 0, -vz / hl, 0, vx / hl, WOOD.r, WOOD.g, WOOD.b);
            if (e >= b) sb.put(tpl.post, this.s2.x, this.s2.y, this.s2.z, Math.atan2(-s.dirZ, s.dirX), 1.1, 0.95, 1.1, WOOD);
          } else {
            const c = tmpC.copy(STONE).multiplyScalar(0.92 + rng(Math.round(d * 7))() * 0.12);
            sb.putBasis(tpl.parapet, s.x, s.y, s.z, vx, vy, vz, 0, 1, 0, -vz / hl, 0, vx / hl, c.r, c.g, c.b);
            // tranche du tablier sous le parapet
            sb.putBasis(tpl.parapet, s.x, s.y - 1.3, s.z, vx, vy, vz, 0, 1.7, 0, (-vz / hl) * 0.9, 0, (vx / hl) * 0.9, c.r * 0.8, c.g * 0.8, c.b * 0.8);
          }
        }
      }
    }

    // ── Troupeaux dans les prés, derrière les clôtures ; abreuvoir ; manège de chevaux ──
    let herd: Herd | null = null;
    if (r() < 0.55) {
      const side = r() < 0.5 ? -1 : 1;
      const kind: HerdKind = r() < 0.45 ? 'cow' : r() < 0.7 ? 'sheep' : 'horse';
      const dh = d0 + r() * (d1 - d0);
      track.positionAt(dh, side * (halfAt(dh) + 16 + r() * 40), s);
      const cx = s.x;
      const cz = s.z;
      const cy = ground(cx, cz);
      if (Number.isFinite(cy) && probe.clear(cx, cz, 10) && !onAnyRoad(cx, cz, 6)) {
        const count = kind === 'cow' ? 3 + Math.floor(r() * 5) : kind === 'sheep' ? 5 + Math.floor(r() * 9) : 2 + Math.floor(r() * 3);
        const spread = kind === 'sheep' ? 9 : 13;
        const herdCol = kind === 'cow' ? (COWS[Math.floor(r() * COWS.length)] as THREE.Color) : null;
        // Manège : chevaux en cercle autour du centre, terrain plat et dégagé sur tout le tour.
        let radius = 0;
        if (kind === 'horse' && r() < 0.65) {
          const R = 6 + r() * 4;
          let lo = Infinity;
          let hi = -Infinity;
          let ok = true;
          for (let i = 0; i < 8 && ok; i++) {
            const x = cx + Math.cos((i / 8) * Math.PI * 2) * R;
            const z = cz - Math.sin((i / 8) * Math.PI * 2) * R;
            const y = ground(x, z);
            ok = Number.isFinite(y) && probe.clear(x, z, 3) && !onAnyRoad(x, z, 3);
            lo = Math.min(lo, y);
            hi = Math.max(hi, y);
          }
          if (ok && hi - lo < 0.6) radius = R;
        }
        // Animaux animés : leur manège est mené par farmAnimals.ts (pas de case d'uniforme à réserver).
        const h: Herd = { kind, x: cx, z: cz, slot: radius && !useFarm ? this.trotOwner.indexOf(null) : -1, radius, speed: 0, angle: 0 };
        const ring = radius > 0 && (useFarm || h.slot >= 0);
        let placed = 0;
        for (let i = 0; i < count; i++) {
          let x: number;
          let z: number;
          let yaw: number;
          let phi = 0;
          if (ring) {
            phi = (i / count) * Math.PI * 2 + r() * 0.3;
            x = cx + Math.cos(phi) * radius;
            z = cz - Math.sin(phi) * radius;
            yaw = phi + Math.PI / 2;
          } else {
            x = cx + (r() - 0.5) * 2 * spread;
            z = cz + (r() - 0.5) * 2 * spread;
            yaw = r() * 6.28;
            // ni dans une lisière ni sous un arbre ni contre un bâtiment, ni sur un chemin
            if (!probe.clear(x, z, 3.5) || onAnyRoad(x, z, 2)) continue;
          }
          const y = ground(x, z);
          if (!Number.isFinite(y)) continue;
          const col =
            kind === 'cow'
              ? r() < 0.75
                ? (herdCol as THREE.Color)
                : (COWS[Math.floor(r() * COWS.length)] as THREE.Color)
              : kind === 'horse'
                ? (HORSES[Math.floor(r() * HORSES.length)] as THREE.Color)
                : tmpC.setHSL(0.11, 0.15, 0.88 + r() * 0.08);
          const ph = r();
          const sc = 0.9 + r() * 0.2;
          if (useFarm) animals.push({ kind, x, y, z, yaw, scale: sc, color: col.clone(), ring: ring ? { cx, cz, r: radius, phi } : undefined, ground });
          else ab.put(tpl[kind], x, y, z, yaw, sc, sc, sc, col, h.slot >= 0 ? [2 * (h.slot + 1), ph, cx, cz] : [0, ph, x, z]);
          placed++;
        }
        if (placed) {
          herd = h;
          if (h.slot >= 0) this.trotOwner[h.slot] = h;
          sources.push({ kind: kind === 'cow' ? 'cows' : kind === 'sheep' ? 'sheep' : 'horses', x: cx, z: cz, range: kind === 'sheep' ? 130 : 170, herd: true });
          // Abreuvoir au bord du pré (vaches et chevaux).
          if (kind !== 'sheep' && r() < 0.65) {
            const ta = r() * 6.28;
            const tx = cx + Math.cos(ta) * (radius ? radius + 4 : 5);
            const tz = cz + Math.sin(ta) * (radius ? radius + 4 : 5);
            const ty = ground(tx, tz);
            if (Number.isFinite(ty) && probe.clear(tx, tz, 1.6)) this.trough(tx, ty, tz, r() * 6.28);
          }
        }
      }
    }

    // ── Oiseaux posés dans un champ (s'envolent à l'approche du coureur) ──
    if (r() < 0.3) {
      const side = r() < 0.5 ? -1 : 1;
      const dd = d0 + r() * (d1 - d0);
      track.positionAt(dd, side * (halfAt(dd) + 15 + r() * 30), s);
      const gx = s.x;
      const gz = s.z;
      if (probe.read(gx, gz) && probe.field + probe.meadow > 0.4 && probe.clear(gx, gz, 4)) {
        const nb = 6 + Math.floor(r() * 7);
        const pts = new Float32Array(nb * 3);
        let ok = 0;
        for (let i = 0; i < nb; i++) {
          const x = gx + (r() - 0.5) * 9;
          const z = gz + (r() - 0.5) * 9;
          const y = ground(x, z);
          if (!Number.isFinite(y)) continue;
          pts.set([x, y + 0.06, z], ok * 3);
          ok++;
        }
        if (ok > 2) perches.push({ pts: pts.slice(0, ok * 3), yaw: r() * 6.28, ground: true, x: gx, z: gz });
      }
    }

    // ── Mare dans un pré : eau, berge, roseaux ; parfois un pêcheur ──
    if (r() < 0.18 * props) {
      const side = r() < 0.5 ? -1 : 1;
      const dp = d0 + r() * (d1 - d0);
      track.positionAt(dp, side * (halfAt(dp) + 14 + r() * 30), s);
      const px = s.x;
      const pz = s.z;
      const R = 3.5 + r() * 3.5;
      if (probe.read(px, pz) && probe.field < 0.5 && probe.clear(px, pz, R + 3) && !onAnyRoad(px, pz, R + 3)) this.pond(px, pz, R, r, spots, people);
    }

    // ── Village : boîtes aux lettres et poubelles devant les maisons, enfants, habitants ──
    if (urbanMax > 0.15) {
      const found: Array<{ tile: LoadedTile; i: number }> = [];
      probe.buildingsIn(minX - 35, minZ - 35, maxX + 35, maxZ + 35, found);
      const used: Record<number, number[]> = { [-1]: [], [1]: [] };
      const free = (side: number, d: number, gap: number) => (used[side] as number[]).every((u) => Math.abs(u - d) > gap);
      for (const { tile, i } of found.slice(0, 160)) {
        const bld = tile.features.buildings[i];
        if (!bld || UTILITY.has(bld.kind)) continue;
        const area = Math.abs(polygonArea(bld.pts));
        if (area < 25 || area > 600) continue;
        let bx = 0;
        let bz = 0;
        const np = bld.pts.length >> 1;
        for (let j = 0; j < np; j++) {
          bx += bld.pts[j * 2] as number;
          bz += bld.pts[j * 2 + 1] as number;
        }
        bx /= np;
        bz /= np;
        // échantillon le plus proche de la ligne médiane
        let best = -1;
        let bestD = Infinity;
        for (let j = 0; j < nS; j++) {
          const dd = ((cl[j * 6] as number) - bx) ** 2 + ((cl[j * 6 + 1] as number) - bz) ** 2;
          if (dd < bestD) {
            bestD = dd;
            best = j;
          }
        }
        if (best < 0) continue;
        const ox = bx - (cl[best * 6] as number);
        const oz = bz - (cl[best * 6 + 1] as number);
        const dx = cl[best * 6 + 3] as number;
        const dz = cl[best * 6 + 4] as number;
        const d = d0 + best * STEP + ox * dx + oz * dz;
        if (d < d0 || d >= d1 || inSpan(d, 3)) continue;
        const lat = ox * -dz + oz * dx;
        const side = lat < 0 ? -1 : 1;
        const half = halfAt(d);
        const off = Math.abs(lat) - half;
        if (off < 4 || off > 30) continue;
        const hr = rng(Math.round(bx * 13 + bz * 7));
        const dm = d + (hr() - 0.5) * 4;
        track.positionAt(dm, side * (half + 1.1), s);
        const y = ground(s.x, s.z);
        if (!Number.isFinite(y) || probe.buildingNear(s.x, s.z, 0.6) || onAnyRoad(s.x, s.z, 0.6)) continue;
        // face avant (+z) vers la route
        const yaw = Math.atan2(s.dirZ * side, -s.dirX * side);
        if (hr() < 0.5 * props && free(side, dm, 4)) {
          sb.put(tpl.mailbox, s.x, y, s.z, yaw, 1, 1, 1, MAILBOX[Math.floor(hr() * MAILBOX.length)] as THREE.Color);
          (used[side] as number[]).push(dm);
        }
        // Poubelles : seules ou par deux, au bord de la rue (≈ une maison sur quatre).
        if (hr() < 0.28 * Math.min(1, props + 0.2)) {
          const db = dm + (hr() < 0.5 ? -1 : 1) * (2 + hr() * 1.5);
          if (free(side, db, 1.6) && !inSpan(db, 3)) {
            const pair = hr() < 0.55 ? 2 : 1;
            for (let b = 0; b < pair; b++) {
              const dbi = db + b * 0.78;
              track.positionAt(dbi, side * (half + 0.95), s);
              const by = ground(s.x, s.z);
              if (!Number.isFinite(by) || probe.buildingNear(s.x, s.z, 0.5) || onAnyRoad(s.x, s.z, 0.4)) continue;
              const pick = hr();
              const t = b === 1 ? tpl.binYellow : pick < 0.45 ? tpl.binGrey : pick < 0.75 ? tpl.binYellow : pick < 0.88 ? tpl.binGreen : pick < 0.96 ? tpl.binBrown : tpl.binBlue;
              sb.put(t, s.x, by, s.z, Math.atan2(s.dirZ * side, -s.dirX * side) + (hr() - 0.5) * 0.3, 1, 1, 1, ONE);
              (used[side] as number[]).push(dbi);
            }
          }
        }
        if (hr() < 0.07 * people) {
          track.positionAt(dm + 1.5, side * (half + 1.9), s);
          const cy = ground(s.x, s.z);
          if (Number.isFinite(cy)) spots.push({ kind: 'child', x: s.x, y: cy, z: s.z, yaw: Math.atan2(s.dirZ * side, -s.dirX * side), seed: hr() });
        } else if (hr() < 0.05 * people) {
          track.positionAt(dm - 1.5, side * (half + 2.2), s);
          const vy = ground(s.x, s.z);
          if (Number.isFinite(vy)) spots.push({ kind: 'villager', x: s.x, y: vy, z: s.z, yaw: Math.atan2(s.dirZ * side, -s.dirX * side) + (hr() - 0.5), seed: hr() });
        }
      }

      // Boîte de La Poste à l'entrée du village (passage des champs aux maisons).
      for (let i = 0; i + 5 < nS; i++) {
        const u0 = cl[i * 6 + 5] as number;
        const u1 = cl[(i + 5) * 6 + 5] as number;
        if (!((u0 < 0.2 && u1 > 0.45) || (u0 > 0.45 && u1 < 0.2))) continue;
        if (r() < 0.6 * Math.min(1, props + 0.3)) {
          const d = d0 + (u1 > u0 ? i + 5 : i) * STEP;
          const side = r() < 0.5 ? -1 : 1;
          track.positionAt(d, side * (halfAt(d) + 1.3), s);
          const y = ground(s.x, s.z);
          if (Number.isFinite(y) && !inSpan(d, 3) && !probe.buildingNear(s.x, s.z, 0.8) && !onAnyRoad(s.x, s.z, 0.8)) sb.put(tpl.poste, s.x, y, s.z, Math.atan2(s.dirZ * side, -s.dirX * side), 1, 1, 1, ONE);
        }
        break;
      }

      // Fontaine sur une placette et borne fontaine au bord de la rue.
      if (urbanMax > 0.45 && r() < 0.25 * props) {
        for (let tryN = 0; tryN < 6; tryN++) {
          const d = d0 + r() * (d1 - d0);
          const side = r() < 0.5 ? -1 : 1;
          track.positionAt(d, side * (halfAt(d) + 4.5 + r() * 3), s);
          const y = ground(s.x, s.z);
          if (!Number.isFinite(y) || inSpan(d, 4) || probe.buildingNear(s.x, s.z, 2.6) || onAnyRoad(s.x, s.z, 2.2) || !probe.read(s.x, s.z) || probe.water > 0.1) continue;
          sb.put(tpl.fountain, s.x, y - 0.05, s.z, r() * 6.28, 1, 1, 1, ONE);
          octagon(wb, s.x, y + 0.48, s.z, 1.25, POND_SHALLOW);
          if (r() < 0.6 * people) {
            const a = r() * 6.28;
            const vx = s.x + Math.cos(a) * 2.6;
            const vz = s.z + Math.sin(a) * 2.6;
            const vy = ground(vx, vz);
            if (Number.isFinite(vy)) spots.push({ kind: 'villager', x: vx, y: vy, z: vz, yaw: Math.atan2(s.x - vx, s.z - vz), seed: r() });
          }
          break;
        }
      }
      if (urbanMax > 0.35 && r() < 0.22 * props) {
        const d = d0 + r() * (d1 - d0);
        const side = r() < 0.5 ? -1 : 1;
        track.positionAt(d, side * (halfAt(d) + 1.2), s);
        const y = ground(s.x, s.z);
        if (Number.isFinite(y) && !inSpan(d, 3) && !probe.buildingNear(s.x, s.z, 0.8) && !onAnyRoad(s.x, s.z, 0.8)) sb.put(tpl.borne, s.x, y, s.z, Math.atan2(s.dirZ * side, -s.dirX * side), 1, 1, 1, ONE);
      }

      // Terrain de foot près du village (pré plat et dégagé).
      if (urbanMax > 0.3 && rng(k * 977 + 3)() < 0.4 * Math.min(1, props + 0.3)) this.tryPitch(d0, d1, roads, spots, people, line, r);
    }

    // ── Joggeurs et promeneurs (avec leur chien) sur l'accotement ──
    for (const [kind, p] of [
      ['jogger', 0.28],
      ['walker', 0.2],
    ] as const) {
      if (r() > p * people) continue;
      const side = r() < 0.5 ? -1 : 1;
      const start = d0 + r() * (d1 - d0);
      const dir = r() < 0.5 ? -1 : 1;
      const len = 140 + r() * 160;
      const pts: number[] = [];
      for (let t = 0; t <= len; t += 4) {
        let d = start + dir * t;
        if (!track.route.loop && (d < 0 || d > track.length)) break;
        d = track.wrap(d);
        if (inSpan(d)) {
          if (pts.length) break;
          continue;
        }
        track.positionAt(d, side * (halfAt(d) + (kind === 'walker' ? 1.3 : 0.9)), s);
        const y = ground(s.x, s.z);
        if (!Number.isFinite(y)) break;
        pts.push(s.x, y, s.z);
      }
      if (pts.length < 30) continue;
      spots.push({ kind, x: pts[0] as number, y: pts[1] as number, z: pts[2] as number, yaw: 0, path: new Float32Array(pts), seed: r() });
    }

    // ── Pêcheur assis au bord de l'eau (rivière, étang) ──
    if (r() < 0.35 * people) {
      search: for (let d = d0 + 6; d < d1; d += 12) {
        if (inSpan(d, 6)) continue;
        for (const side of [-1, 1]) {
          const half = halfAt(d);
          for (const l of [9, 15, 22, 30, 38]) {
            track.positionAt(d, side * (half + l), s);
            if (!probe.read(s.x, s.z) || probe.water < 0.5) continue;
            // de l'eau vers la route, mètre par mètre, jusqu'à la berge
            for (let b = l - 1; b > 3; b--) {
              track.positionAt(d, side * (half + b), s);
              if (!probe.read(s.x, s.z) || probe.water > 0.15) continue;
              const y = ground(s.x, s.z);
              if (!Number.isFinite(y) || probe.buildingNear(s.x, s.z, 1.5) || onAnyRoad(s.x, s.z, 1.5)) break;
              // regarde l'eau : vers l'extérieur de la route
              spots.push({ kind: 'fisher', x: s.x, y, z: s.z, yaw: Math.atan2(-s.dirZ * side, s.dirX * side), seed: r() });
              break search;
            }
            break;
          }
        }
      }
    }

    // ── Maillages du tronçon ──
    const objects: THREE.Object3D[] = [];
    const casters: THREE.Mesh[] = [];
    const sg = sb.geometry();
    if (sg) {
      const m = new THREE.Mesh(sg, this.staticMat);
      m.receiveShadow = true;
      m.name = `life-static-${k}`;
      objects.push(m);
      casters.push(m);
    }
    const ag = ab.geometry('anim');
    if (ag) {
      // marge de la sphère englobante : têtes qui bougent, manèges
      if (ag.boundingSphere) ag.boundingSphere.radius += 3;
      const m = new THREE.Mesh(ag, this.animalMat);
      m.receiveShadow = true;
      m.name = `life-animals-${k}`;
      objects.push(m);
      casters.push(m);
    }
    const wg = wb.geometry();
    if (wg) {
      const m = new THREE.Mesh(wg, this.wetMat);
      m.receiveShadow = true;
      m.name = `life-water-${k}`;
      objects.push(m);
    }
    if (lines.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lines), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(lineCols), 3));
      g.computeBoundingSphere();
      const l = new THREE.LineSegments(g, this.wireMat);
      l.name = `life-wires-${k}`;
      objects.push(l);
    }
    for (const o of objects) {
      o.matrixAutoUpdate = false;
      o.updateMatrix();
    }
    return { k, d0, d1, sig, line: new Float32Array(lineXZ), objects, casters, near: false, herd, sources, animals, spots, flowers: new Float32Array(flowers), perches };
  }

  /** Abreuvoir : bac galvanisé et son eau. */
  private trough(x: number, y: number, z: number, yaw: number): void {
    this.sb.put((this.tpl as LifeTemplates).trough, x, y, z, yaw, 1, 1, 1, ONE);
    const co = Math.cos(yaw);
    const si = Math.sin(yaw);
    // rectangle 2,3 × 0,55 m tourné comme le bac (axe x local : (cos, −sin))
    const cx = (u: number, v: number) => x + u * co + v * si;
    const cz = (u: number, v: number) => z - u * si + v * co;
    const h = y + 0.5;
    this.wb.triUp(cx(-1.15, -0.27), h, cz(-1.15, -0.27), cx(1.15, -0.27), h, cz(1.15, -0.27), cx(1.15, 0.27), h, cz(1.15, 0.27), TROUGH_WATER);
    this.wb.triUp(cx(-1.15, -0.27), h, cz(-1.15, -0.27), cx(1.15, 0.27), h, cz(1.15, 0.27), cx(-1.15, 0.27), h, cz(-1.15, 0.27), TROUGH_WATER);
  }

  /** Mare : plan d'eau irrégulier à facettes, berge boueuse jusqu'au sol, roseaux, pêcheur éventuel. */
  private pond(px: number, pz: number, R: number, r: () => number, spots: PersonSpot[], people: number): void {
    const ground = (x: number, z: number) => this.probe.heightAt(x, z);
    const N = 10;
    // par point du bord : x, z, rayon, altitude du pied de berge, angle
    const rim: number[] = [];
    let hi = -Infinity;
    let lo = Infinity;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const rr = R * (0.85 + r() * 0.3);
      const x = px + Math.cos(a) * rr;
      const z = pz + Math.sin(a) * rr;
      const y = ground(x, z);
      const yo = ground(px + Math.cos(a) * rr * 1.4, pz + Math.sin(a) * rr * 1.4);
      if (!Number.isFinite(y) || !Number.isFinite(yo)) return;
      hi = Math.max(hi, y);
      lo = Math.min(lo, y, yo);
      rim.push(x, z, rr, yo, a);
    }
    const yc = ground(px, pz);
    if (!Number.isFinite(yc) || hi - lo > 0.6) return;
    const level = Math.max(hi, yc) + 0.05;
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const ax = rim[i * 5] as number;
      const az = rim[i * 5 + 1] as number;
      const bx = rim[j * 5] as number;
      const bz = rim[j * 5 + 1] as number;
      this.wb.triUp(px, level, pz, ax, level, az, bx, level, bz, i % 2 ? POND_DEEP : POND_SHALLOW);
      // berge : du bord de l'eau jusqu'au sol, 40 % plus loin
      const aa = rim[i * 5 + 4] as number;
      const ba = rim[j * 5 + 4] as number;
      const ar = (rim[i * 5 + 2] as number) * 1.4;
      const br = (rim[j * 5 + 2] as number) * 1.4;
      const aox = px + Math.cos(aa) * ar;
      const aoz = pz + Math.sin(aa) * ar;
      const box = px + Math.cos(ba) * br;
      const boz = pz + Math.sin(ba) * br;
      const ay = (rim[i * 5 + 3] as number) - 0.05;
      const by = (rim[j * 5 + 3] as number) - 0.05;
      this.sb.triUp(ax, level + 0.02, az, aox, ay, aoz, bx, level + 0.02, bz, MUD);
      this.sb.triUp(bx, level + 0.02, bz, aox, ay, aoz, box, by, boz, MUD);
    }
    // roseaux groupés d'un côté de la mare
    const t = (this.tpl as LifeTemplates).reeds;
    const a0 = r() * 6.28;
    const nr = 4 + Math.floor(r() * 5);
    for (let i = 0; i < nr; i++) {
      const a = a0 + (r() - 0.5) * 2.4;
      const rr = R * (0.9 + r() * 0.25);
      const sc = 0.8 + r() * 0.5;
      this.sb.put(t, px + Math.cos(a) * rr, level - 0.15, pz + Math.sin(a) * rr, r() * 6.28, sc, sc, sc, ONE);
    }
    if (r() < 0.35 * people) {
      const a = a0 + Math.PI + (r() - 0.5);
      const x = px + Math.cos(a) * R * 1.2;
      const z = pz + Math.sin(a) * R * 1.2;
      const y = ground(x, z);
      if (Number.isFinite(y)) spots.push({ kind: 'fisher', x, y, z, yaw: Math.atan2(px - x, pz - z), seed: r() });
    }
  }

  /** Terrain de foot (56 × 34 m) parallèle à la route, si un pré plat et dégagé le permet. */
  private tryPitch(d0: number, d1: number, roads: number[], spots: PersonSpot[], people: number, line: LineFn, r: () => number): void {
    const probe = this.probe;
    const ground = (x: number, z: number) => probe.heightAt(x, z);
    const HL = 28;
    const HW = 17;
    const dm = (d0 + d1) / 2;
    for (const side of r() < 0.5 ? [-1, 1] : [1, -1]) {
      const p = this.track.positionAt(dm, side * (this.track.widthAt(dm) / 2 + 9 + HW), this.s);
      const ux = p.dirX;
      const uz = p.dirZ;
      const cx = p.x;
      const cz = p.z;
      // v : de la route vers le fond du terrain
      const vx = -uz * side;
      const vz = ux * side;
      let lo = Infinity;
      let hi = -Infinity;
      let ok = true;
      for (let i = -2; i <= 2 && ok; i++)
        for (let j = -1; j <= 1 && ok; j++) {
          const x = cx + ux * i * (HL / 2) + vx * j * HW;
          const z = cz + uz * i * (HL / 2) + vz * j * HW;
          const y = ground(x, z);
          ok = Number.isFinite(y) && probe.read(x, z) && probe.forest < 0.15 && probe.water < 0.05 && probe.road < 0.3 && !probe.buildingNear(x, z, 10) && !probe.treeNear(x, z, 4);
          for (let q = 0; ok && q < roads.length; q += 5) {
            const rr = (roads[q + 4] as number) + 4;
            if (dist2Seg(x, z, roads[q] as number, roads[q + 1] as number, roads[q + 2] as number, roads[q + 3] as number) < rr * rr) ok = false;
          }
          lo = Math.min(lo, y);
          hi = Math.max(hi, y);
        }
      if (!ok || hi - lo > 1.5) continue;
      this.pitch(cx, cz, ux, uz, vx, vz, HL, HW, line);
      if (r() < Math.min(1, 0.4 + people)) spots.push({ kind: 'pitch', x: cx, y: ground(cx, cz), z: cz, yaw: Math.atan2(ux, uz), pitch: { ux, uz, hl: HL - 4, hw: HW - 4 }, seed: r() });
      return;
    }
  }

  /** Pelouse rayée qui suit le terrain, lignes blanches, buts et filets, bancs et tribune. */
  private pitch(cx: number, cz: number, ux: number, uz: number, vx: number, vz: number, HL: number, HW: number, line: LineFn): void {
    const sb = this.sb;
    const tpl = this.tpl as LifeTemplates;
    const y0 = this.probe.heightAt(cx, cz);
    const ground = (x: number, z: number) => {
      const y = this.probe.heightAt(x, z);
      return Number.isFinite(y) ? y : y0;
    };
    const atX = (u: number, v: number) => cx + ux * u + vx * v;
    const atZ = (u: number, v: number) => cz + uz * u + vz * v;
    const NX = 12;
    const NZ = 6;
    const hs: number[] = [];
    for (let i = 0; i <= NX; i++)
      for (let j = 0; j <= NZ; j++) {
        const u = (i / NX) * 2 * HL - HL;
        const v = (j / NZ) * 2 * HW - HW;
        hs.push(ground(atX(u, v), atZ(u, v)) + 0.07);
      }
    const h = (i: number, j: number) => hs[i * (NZ + 1) + j] as number;
    for (let i = 0; i < NX; i++)
      for (let j = 0; j < NZ; j++) {
        const u0 = (i / NX) * 2 * HL - HL;
        const u1 = ((i + 1) / NX) * 2 * HL - HL;
        const v0 = (j / NZ) * 2 * HW - HW;
        const v1 = ((j + 1) / NZ) * 2 * HW - HW;
        const c = PITCH[i % 2] as THREE.Color;
        sb.triUp(atX(u0, v0), h(i, j), atZ(u0, v0), atX(u1, v0), h(i + 1, j), atZ(u1, v0), atX(u1, v1), h(i + 1, j + 1), atZ(u1, v1), c);
        sb.triUp(atX(u0, v0), h(i, j), atZ(u0, v0), atX(u1, v1), h(i + 1, j + 1), atZ(u1, v1), atX(u0, v1), h(i, j + 1), atZ(u0, v1), c);
      }
    // lignes : bandes de 12 cm posées 3 cm au-dessus de la pelouse
    const stripe = (ua: number, va: number, ub: number, vb: number) => {
      const ax = atX(ua, va);
      const az = atZ(ua, va);
      const bx = atX(ub, vb);
      const bz = atZ(ub, vb);
      const L = Math.hypot(bx - ax, bz - az) || 1;
      const nx = (-(bz - az) / L) * 0.06;
      const nz = ((bx - ax) / L) * 0.06;
      const ay = ground(ax, az) + 0.1;
      const by = ground(bx, bz) + 0.1;
      sb.triUp(ax + nx, ay, az + nz, bx + nx, by, bz + nz, bx - nx, by, bz - nz, LINE);
      sb.triUp(ax + nx, ay, az + nz, bx - nx, by, bz - nz, ax - nx, ay, az - nz, LINE);
    };
    const L = HL - 1.5;
    const W = HW - 1.5;
    stripe(-L, -W, L, -W);
    stripe(-L, W, L, W);
    stripe(-L, -W, -L, W);
    stripe(L, -W, L, W);
    stripe(0, -W, 0, W);
    for (let i = 0; i < 16; i++) {
      const a0 = (i / 16) * Math.PI * 2;
      const a1 = ((i + 1) / 16) * Math.PI * 2;
      stripe(Math.cos(a0) * 5, Math.sin(a0) * 5, Math.cos(a1) * 5, Math.sin(a1) * 5);
    }
    for (const e of [-1, 1]) {
      const gx = e * L;
      // surface de réparation et surface de but
      stripe(gx, -10, gx - e * 8, -10);
      stripe(gx - e * 8, -10, gx - e * 8, 10);
      stripe(gx - e * 8, 10, gx, 10);
      stripe(gx, -4.5, gx - e * 2.5, -4.5);
      stripe(gx - e * 2.5, -4.5, gx - e * 2.5, 4.5);
      stripe(gx - e * 2.5, 4.5, gx, 4.5);
      // but : ouverture (+z local) vers le centre du terrain
      const x = atX(gx, 0);
      const z = atZ(gx, 0);
      const yaw = Math.atan2(-ux * e, -uz * e);
      const y = ground(x, z);
      sb.put(tpl.goal, x, y, z, yaw, 1, 1, 1, ONE);
      // filet : lignes claires entre la barre, les montants et le cadre arrière
      const co = Math.cos(yaw);
      const si = Math.sin(yaw);
      const P = (lx: number, ly: number, lz: number) => [x + lx * co + lz * si, y + ly, z - lx * si + lz * co] as const;
      for (let q = -3; q <= 3.01; q += 0.75) {
        const a = P(q, 2.0, 0);
        const b = P(q, 0.03, -1.45);
        line(a[0], a[1], a[2], b[0], b[1], b[2], NET);
      }
      for (let t = 0.25; t < 1; t += 0.25) {
        const a = P(-3, 2.0 * (1 - t) + 0.03 * t, -1.45 * t);
        const b = P(3, 2.0 * (1 - t) + 0.03 * t, -1.45 * t);
        line(a[0], a[1], a[2], b[0], b[1], b[2], NET);
      }
    }
    // bancs côté route, tribune au fond
    for (const u of [-6, 6]) {
      const x = atX(u, -HW - 1.2);
      const z = atZ(u, -HW - 1.2);
      sb.put(tpl.bench, x, ground(x, z), z, Math.atan2(vx, vz), 1, 1, 1, ONE);
    }
    const tx = atX(0, HW + 2.8);
    const tz = atZ(0, HW + 2.8);
    sb.put(tpl.stand, tx, ground(tx, tz) - 0.1, tz, Math.atan2(-vx, -vz), 1, 1, 1, ONE);
  }

  /** Pied d'un poteau à la distance `d` ([x, y, z, dirX, dirZ]), null hors des terres ouvertes. */
  private polePoint(d: number, side: number): [number, number, number, number, number] | null {
    if (d > this.track.length) return null;
    const p = this.track.positionAt(d, side * (this.track.widthAt(d) / 2 + 5.5), this.s2);
    const y = this.probe.heightAt(p.x, p.z);
    const pr = this.probe;
    if (!Number.isFinite(y) || !pr.read(p.x, p.z) || pr.forest > 0.5 || pr.water > 0.2 || pr.road > 0.25 || pr.urban > 0.6 || pr.buildingNear(p.x, p.z, 3)) return null;
    return [p.x, y, p.z, p.dirX, p.dirZ];
  }

  dispose(): void {
    this.disposed = true;
    for (const k of [...this.chunks.keys()]) this.drop(k);
    this.farm.dispose();
    this.staticMat.dispose();
    this.animalMat.dispose();
    this.wetMat.dispose();
    this.wireMat.dispose();
  }
}

/** Fraction t ∈ [0, 1] du segment p → q où il coupe le segment a → b, ou −1. */
function segCross(px: number, pz: number, qx: number, qz: number, ax: number, az: number, bx: number, bz: number): number {
  const rx = qx - px;
  const rz = qz - pz;
  const sx = bx - ax;
  const sz = bz - az;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return -1;
  const t = ((ax - px) * sz - (az - pz) * sx) / den;
  const u = ((ax - px) * rz - (az - pz) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
}

/** Distance (m) d'un point à une polyligne plate (x, z). */
function lineDistance(pts: Float32Array, x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i + 3 < pts.length; i += 2) best = Math.min(best, dist2Seg(x, z, pts[i] as number, pts[i + 1] as number, pts[i + 2] as number, pts[i + 3] as number));
  return Math.sqrt(best);
}

/** Disque d'eau octogonal (fontaine). */
function octagon(b: MeshBuilder, x: number, y: number, z: number, r: number, c: THREE.Color): void {
  for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const a1 = ((i + 1) / 8) * Math.PI * 2 + Math.PI / 8;
    b.triUp(x, y, z, x + Math.cos(a0) * r, y, z + Math.sin(a0) * r, x + Math.cos(a1) * r, y, z + Math.sin(a1) * r, c);
  }
}
