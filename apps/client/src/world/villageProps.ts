import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { baseRouteId, type RouteTrack, type TrackSample } from '@allezrobert/shared';
import { rng } from '../engine/noise.ts';
import { sharedKtx2Loader } from '../engine/textures.ts';
import type { LoadedTile } from './types.ts';
import { LandProbe, dist2Seg, segmentsIn } from './lowPolyKit.ts';

/**
 * Décor des villages et des campagnes du style réaliste : modèles générés (TRELLIS, tools/blender/props/make_props.py)
 * posés le long du parcours, en trois familles :
 *  - place (fontaine, monument aux morts, puits) : une par village au plus, dans le bourg dense, en retrait de la route ;
 *  - rue (pompe à bras, banc) : plus fréquents, au bord de la chaussée des bourgs ;
 *  - campagne (calvaire, abreuvoir) : rares, hors des bourgs.
 * Toujours loin des bâtiments, des autres voies, de l'eau et des arbres. Un modèle absent (pas encore généré) est
 * simplement ignoré.
 *
 * Le parcours est découpé en tronçons de CHUNK_M, peuplés à l'approche du coureur (terrain chargé) et oubliés loin
 * derrière. Chaque objet est un LOD (modèle proche, modèle lointain au-delà de FAR_M) qui partage géométrie et
 * matériau avec les autres du même modèle ; ombres portées seulement près du coureur. ?decors=0 les retire,
 * ?decors=dense en met dans chaque tronçon (contrôle visuel).
 */

const CHUNK_M = 120;
const BUILD_M = 650;
const FORGET_M = 900;
/** Au-delà : modèle lointain. */
const FAR_M = 70;
const SHADOW_M = 90;
const STEP_M = 10;
const BASE = '/models/props/';

type Family = 'place' | 'rue' | 'campagne';

interface Kind {
  name: string;
  family: Family;
  /** Rayon d'emprise au sol (m) : distance gardée aux bâtiments et aux autres voies. */
  radius: number;
  /** Retrait depuis le bord de la chaussée (m) : [min, max]. */
  offset: [number, number];
  /** Poids du tirage dans sa famille. */
  weight: number;
}

const KINDS: Kind[] = [
  { name: 'fontaine', family: 'place', radius: 1.0, offset: [4.5, 7.5], weight: 3 },
  { name: 'monument', family: 'place', radius: 1.8, offset: [5, 8], weight: 2 },
  { name: 'puits', family: 'place', radius: 1.1, offset: [4, 7], weight: 2 },
  { name: 'pompe', family: 'rue', radius: 0.5, offset: [2.2, 3.5], weight: 1 },
  { name: 'banc', family: 'rue', radius: 1.0, offset: [2.4, 3.6], weight: 2 },
  { name: 'calvaire', family: 'campagne', radius: 1.0, offset: [2.5, 4.5], weight: 3 },
  { name: 'abreuvoir', family: 'campagne', radius: 1.3, offset: [5, 9], weight: 1 },
];

/** Par famille : bourg requis (urbain max du tronçon), chance par tronçon, distance minimale entre deux objets. */
const FAMILIES: Record<Family, { test: (urban: number) => boolean; chance: number; spacing: number }> = {
  place: { test: (u) => u > 0.45, chance: 0.12, spacing: 800 },
  rue: { test: (u) => u > 0.3, chance: 0.18, spacing: 180 },
  campagne: { test: (u) => u < 0.12, chance: 0.05, spacing: 1500 },
};

const flag = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('decors');
const ENABLED = flag !== '0';
const DENSE = flag === 'dense';

interface Model {
  near: THREE.Object3D;
  far: THREE.Object3D;
}

const loading = new Map<string, Promise<Model | null>>();

/**
 * Modèle chargé une fois. Couleurs par sommet (linéaires) sans matériau dans le .glb : le matériau par défaut du
 * glTF est métallique, on le remplace par une matière mate commune.
 */
function loadModel(name: string): Promise<Model | null> {
  let p = loading.get(name);
  if (p) return p;
  p = (async () => {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    // Couleurs TRELLIS cuites en texture (stylize_prop.py), compressées en KTX2 par optimize.mjs.
    const ktx2 = await sharedKtx2Loader();
    if (ktx2) loader.setKTX2Loader(ktx2);
    const prepare = (root: THREE.Object3D, near: boolean) =>
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        if (mesh.geometry.getAttribute('color')) mesh.material = material;
        mesh.castShadow = near;
        mesh.receiveShadow = near;
      });
    try {
      const [near, far] = await Promise.all([loader.loadAsync(`${BASE}${name}.glb`), loader.loadAsync(`${BASE}${name}.far.glb`)]);
      prepare(near.scene, true);
      prepare(far.scene, false);
      return { near: near.scene, far: far.scene };
    } catch {
      // modèle pas encore généré : ce décor n'apparaît pas
      return null;
    }
  })();
  loading.set(name, p);
  return p;
}

const material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });

interface Chunk {
  k: number;
  d0: number;
  d1: number;
  /** Positions du parcours au début, au milieu et à la fin (pour voir s'il a changé). */
  sig: number[];
  objects: THREE.LOD[];
  near: boolean;
}

export class VillageProps {
  readonly group = new THREE.Group();
  private track: RouteTrack;
  private readonly probe: LandProbe;
  private readonly chunks = new Map<number, Chunk>();
  private readonly models = new Map<string, Model>();
  private ready = false;
  private pending = true;
  private disposed = false;
  private readonly last = new THREE.Vector3(Infinity, 0, 0);
  private readonly s: TrackSample = { x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, grade: 0, d: 0 };
  private centres = new Float64Array(0);
  private centresLength = -1;

  /** `props` : densité du décor (réglage qualité) ; `treesIn` : arbres plantés (x, z, rayon) dans un rectangle. */
  constructor(
    track: RouteTrack,
    private readonly heightAt: (x: number, z: number) => number,
    tileAt: (x: number, z: number) => LoadedTile | undefined,
    private props: number,
    private readonly treesIn?: (minX: number, minZ: number, maxX: number, maxZ: number) => number[],
  ) {
    this.track = track;
    this.probe = new LandProbe(tileAt, heightAt);
    this.group.name = 'village-props';
    if (!ENABLED) return;
    // Tous les modèles avant le premier tronçon : la pose ne dépend pas de l'ordre d'arrivée des fichiers.
    void Promise.all(KINDS.map((k) => loadModel(k.name).then((m) => m && this.models.set(k.name, m)))).then(() => {
      if (this.disposed) return;
      this.ready = this.models.size > 0;
      this.pending = true;
    });
  }

  /** Monde ouvert : nouvel itinéraire, tout est repeuplé. */
  setTrack(track: RouteTrack): void {
    if (track === this.track) return;
    for (const k of [...this.chunks.keys()]) this.drop(k);
    this.track = track;
    this.centresLength = -1;
    this.pending = true;
  }

  setDensity(props: number): void {
    this.props = props;
  }

  /** Peuple les tronçons proches de `focus`, oublie les lointains, ombres près du coureur. */
  update(focus: THREE.Vector3): void {
    if (!this.ready) return;
    const lengthChanged = this.centresLength !== this.track.length;
    if (!this.pending && !lengthChanged && this.last.distanceToSquared(focus) < 225) return;
    this.last.copy(focus);
    this.pending = false;
    if (lengthChanged) this.revalidate();
    const n = this.centres.length / 2;
    let built = false;
    for (let k = 0; k < n; k++) {
      const dist = Math.hypot((this.centres[k * 2] as number) - focus.x, (this.centres[k * 2 + 1] as number) - focus.z);
      const has = this.chunks.has(k);
      if (has && dist > FORGET_M) this.drop(k);
      else if (!has && dist < BUILD_M) {
        // un tronçon par image ; les suivants (ou ceux dont le terrain manque) aux images d'après
        const c = built ? null : this.build(k);
        if (!c) {
          this.pending = true;
          continue;
        }
        this.chunks.set(k, c);
        for (const o of c.objects) this.group.add(o);
        built = true;
      }
    }
    for (const c of this.chunks.values()) {
      const near = c.objects.some((o) => o.position.distanceToSquared(focus) < SHADOW_M * SHADOW_M);
      if (near === c.near) continue;
      c.near = near;
      for (const o of c.objects) o.levels[0]?.object.traverse((m) => ((m as THREE.Mesh).castShadow = near));
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const k of [...this.chunks.keys()]) this.drop(k);
  }

  private revalidate(): void {
    const len = this.track.length;
    const n = Math.max(0, Math.ceil(len / CHUNK_M));
    this.centres = new Float64Array(n * 2);
    for (let k = 0; k < n; k++) {
      const p = this.track.positionAt(Math.min((k + 0.5) * CHUNK_M, len), 0, this.s);
      this.centres[k * 2] = p.x;
      this.centres[k * 2 + 1] = p.z;
    }
    for (const c of [...this.chunks.values()]) {
      const partial = c.d1 < c.d0 + CHUNK_M - 1e-6 && len > c.d1 + 1;
      if (partial || c.k >= n || !this.sameSig(c)) this.drop(c.k);
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
    // géométries et matériau partagés : rien à libérer
    for (const o of c.objects) this.group.remove(o);
  }

  /** Un objet de la famille à moins de `m` de (x, z) dans les tronçons peuplés. */
  private familyNear(family: Family, x: number, z: number, m: number, extra: THREE.LOD[]): boolean {
    const hit = (o: THREE.LOD) => o.userData.family === family && Math.hypot(o.position.x - x, o.position.z - z) < m;
    if (extra.some(hit)) return true;
    for (const c of this.chunks.values()) if (c.objects.some(hit)) return true;
    return false;
  }

  private build(k: number): Chunk | null {
    const { track, probe, s } = this;
    const d0 = k * CHUNK_M;
    const d1 = Math.min(d0 + CHUNK_M, track.length);
    probe.forget();
    const sig: number[] = [];
    for (const d of [d0, (d0 + d1) / 2, d1]) {
      const p = track.positionAt(d, 0, s);
      if (!Number.isFinite(this.heightAt(p.x, p.z)) || !probe.read(p.x, p.z)) return null;
      sig.push(p.x, p.z);
    }
    const chunk: Chunk = { k, d0, d1, sig, objects: [], near: false };
    let urbanMax = 0;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let d = d0; d <= d1; d += STEP_M) {
      const p = track.positionAt(d, 0, s);
      if (probe.read(p.x, p.z)) urbanMax = Math.max(urbanMax, probe.urban);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const r = rng(k * 7919 + 17);
    const M = 20;
    let roads: number[] | null = null;
    const onAnyRoad = (x: number, z: number, margin: number) => {
      if (!roads) {
        const routeId = baseRouteId(track.route.id);
        roads = segmentsIn(probe, minX - M, minZ - M, maxX + M, maxZ + M, 'roads', (rd) => !!rd.route && (rd.route === routeId || rd.route === track.route.id));
        probe.setTrees(this.treesIn?.(minX - M, minZ - M, maxX + M, maxZ + M) ?? []);
      }
      for (let i = 0; i < roads.length; i += 5) {
        const rr = (roads[i + 4] as number) + margin;
        if (dist2Seg(x, z, roads[i] as number, roads[i + 1] as number, roads[i + 2] as number, roads[i + 3] as number) < rr * rr) return true;
      }
      return false;
    };
    for (const family of ['place', 'rue', 'campagne'] as const) {
      const fam = FAMILIES[family];
      // tirage fait même sans pose, pour que chaque famille garde son propre tirage d'un tronçon à l'autre
      const roll = r();
      const pick = r();
      if (!fam.test(urbanMax) || (!DENSE && roll >= fam.chance * Math.max(0, this.props))) continue;
      const kinds = KINDS.filter((kd) => kd.family === family && this.models.has(kd.name));
      const total = kinds.reduce((a, kd) => a + kd.weight, 0);
      if (!total) continue;
      let w = pick * total;
      const kind = kinds.find((kd) => (w -= kd.weight) < 0) ?? (kinds[0] as Kind);
      const model = this.models.get(kind.name) as Model;
      for (let tryN = 0; tryN < 6; tryN++) {
        const d = d0 + r() * (d1 - d0);
        const side = r() < 0.5 ? -1 : 1;
        const off = kind.offset[0] + r() * (kind.offset[1] - kind.offset[0]);
        track.positionAt(d, side * (track.widthAt(d) / 2 + off), s);
        const { x, z, dirX, dirZ } = s;
        const y = this.heightAt(x, z);
        if (!Number.isFinite(y) || !probe.read(x, z) || probe.water > 0.1) continue;
        if (family === 'campagne' && probe.forest > 0.3) continue;
        if (probe.buildingNear(x, z, kind.radius + 1.6) || onAnyRoad(x, z, kind.radius + 1.2) || probe.treeNear(x, z, kind.radius + 0.6)) continue;
        if (!DENSE && this.familyNear(family, x, z, fam.spacing, chunk.objects)) break;
        const lod = new THREE.LOD();
        lod.addLevel(model.near.clone(), 0);
        lod.addLevel(model.far.clone(), FAR_M);
        // socle enfoncé de 5 cm (sol en pente douce)
        lod.position.set(x, y - 0.05, z);
        // objets de rue tournés vers la chaussée (face avant +z du modèle ; décalage latéral +1 = (−dirZ, dirX)),
        // les autres au hasard
        lod.rotation.y = family === 'rue' ? Math.atan2(side * dirZ, -side * dirX) : r() * Math.PI * 2;
        lod.name = kind.name;
        lod.userData.family = family;
        chunk.objects.push(lod);
        break;
      }
    }
    return chunk;
  }
}
