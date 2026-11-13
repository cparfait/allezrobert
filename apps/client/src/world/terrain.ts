import * as THREE from 'three/webgpu';
import { texture, uv, normalWorld, positionWorld, mix, smoothstep, vec2, vec3, float, uniform, mx_noise_float, clamp, cameraPosition, mx_worley_noise_float, positionView, normalView, faceDirection, Fn, If, vec4, dot } from 'three/tsl';
import type { QualitySettings } from '../engine/quality.ts';
import { colorUniform } from '../engine/tsl.ts';
import { cloudShade } from './clouds.ts';
import { SPLAT_CHANNELS, type LoadedTile, type WorldSource } from './types.ts';
import { rasterizeSplat } from './splat.ts';
import { WorkQueue } from './workQueue.ts';
import type { RouteFootprint } from './ribbon.ts';
import type { Season } from './environment.ts';
import { ALPINE_GROUND_M, ALPINE_MEADOW, SNOW_LINE_M, alpineProfile } from './alpine.ts';
import { LOW_POLY } from '../engine/style.ts';
import { frameStats } from '../engine/frameStats.ts';
import { ROAD_FX } from './roadSurface.ts';
import { SIDEWALK_MAX_M, builtCells, isBuiltUp } from './sidewalks.ts';
import { EDGE_FIELD_RES, EDGE_MAX_M, EDGE_MIN_M, edgeFieldUv, edgeRoads, roadEdgeField } from './roadEdgeField.ts';

/** Orthophotos (prises en été) selon la saison : teinte et saturation. Partagé avec le relief lointain. */
export const ORTHO_SEASON: Record<Season, [string, number]> = { spring: ['#f4fff0', 1.05], summer: ['#fffbf2', 1], autumn: ['#fbead2', 0.9], winter: ['#dde2e6', 0.5] };
/** Part de l'orthophoto dans la couleur du sol (le détail procédural reste visible de près). */
export const ORTHO_WEIGHT = 0.72;

/** Couleurs du sol par saison (voir ART_DIRECTION.md). */
const SEASON_GROUND: Record<Season, { forest: string; field: string; field2: string; meadow: string; urban: string; dirt: string }> = {
  spring: { forest: '#4d5a2c', field: '#8a9a4b', field2: '#d9c93a', meadow: '#7fa448', urban: '#8f8c78', dirt: '#7a6a4c' },
  summer: { forest: '#45512a', field: '#d8b86a', field2: '#c79d4f', meadow: '#7d9245', urban: '#938d78', dirt: '#86704c' },
  autumn: { forest: '#6b4f2a', field: '#7b6a4a', field2: '#9a8a5a', meadow: '#7c8a44', urban: '#8a8270', dirt: '#6f5a3e' },
  winter: { forest: '#4a463a', field: '#8f8a6e', field2: '#a7a38c', meadow: '#7d7f62', urban: '#8a8a82', dirt: '#6a6052' },
};

/**
 * Style jeu vidéo : aplats plus vifs et plus clairs (prés vert pomme, champs dorés, bourgs clairs). En automne
 * et en hiver, campagne de dessin animé ensoleillée plutôt que labours bruns : blés d'hiver verts, chaumes
 * dorés, prés encore verts.
 */
const LOWPOLY_GROUND: typeof SEASON_GROUND = {
  spring: { forest: '#3f7a2e', field: '#a7c957', field2: '#e9d65a', meadow: '#7cbf4a', urban: '#cfc8b6', dirt: '#a88a5c' },
  summer: { forest: '#3d6f2a', field: '#e2c46a', field2: '#cfa955', meadow: '#86c04e', urban: '#d0c8b2', dirt: '#b08e5e' },
  autumn: { forest: '#5a8a30', field: '#9cc85a', field2: '#e3bc5c', meadow: '#86c24e', urban: '#d0c7b1', dirt: '#b48a58' },
  winter: { forest: '#4f7a3c', field: '#a0c46a', field2: '#d9c47c', meadow: '#92c063', urban: '#cfcabe', dirt: '#a68a64' },
};

interface TileEntry {
  tile: LoadedTile;
  mesh: THREE.Mesh;
  lod: number;
  textures: THREE.DataTexture[];
}

/**
 * Terrain streamé par tuiles autour du coureur. Les altitudes viennent de la source
 * (IGN ou procédurale), déjà « creusées » le long des routes ; le matériau mélange
 * forêt / champs / prairies / urbain / routes selon le raster d'occupation du sol.
 */
/**
 * Détail fin près du coureur : maille d'environ 4 m sur les tuiles à moins de 350 m (hors qualité basse). À 7,8 m
 * (qualité moyenne), deux rues de niveaux différents à moins d'une maille l'une de l'autre (rue qui longe en
 * contrebas, au départ de Donnemarie) ne pouvaient pas avoir chacune leur sol : l'une flottait ou l'autre était
 * recouverte. Le reste de l'anneau proche garde la maille du réglage de qualité.
 */
const FINE_LOD = -1;
const FINE_CELL_M = 4;
const FINE_REACH_M = 350;

/**
 * Détail procédural du sol proche (P2.1b, expérimental) : grain, mottes, litière et microrelief tirés de
 * bruits, fondus avec la distance. Actif par défaut ; `?grounddetail=0` le coupe. Il ne vaut qu'en style réaliste et pour
 * les mondes de GROUND_DETAIL_WORLDS. Coupé, le matériau du terrain est exactement celui d'avant
 * (aucun nœud de shader ajouté).
 */
const GROUND_DETAIL_REQUESTED = (() => {
  try {
    return typeof location !== 'undefined' && new URLSearchParams(location.search).get('grounddetail') !== '0';
  } catch {
    return false;
  }
})();
const GROUND_DETAIL_WORLDS = new Set(['billom']);

/**
 * Accotements (P2.2b, expérimental) : bande de terre tassée et fondu vers le sol le long des routes dessinées, tirés
 * d'un champ de distance au bord de chaussée par tuile (roadEdgeField.ts). Actif par défaut ; `?roadedge=0`
 * le coupe. Il ne vaut qu'en style réaliste et pour les mondes de ROAD_EDGE_WORLDS. Coupé, rien n'est calculé ni créé.
 */
const ROAD_EDGE_REQUESTED = (() => {
  try {
    return typeof location !== 'undefined' && new URLSearchParams(location.search).get('roadedge') !== '0';
  } catch {
    return false;
  }
})();
const ROAD_EDGE_WORLDS = GROUND_DETAIL_WORLDS;

/** Durée de vie d'une tuile décodée en cache : l'URL de son orthophoto est libérée 2 min après le téléchargement. */
const CACHE_MS = 90_000;
/** Nombre maximal de tuiles décodées gardées en cache. */
const CACHE_MAX = 48;

export class TerrainManager {
  readonly group = new THREE.Group();
  private readonly tiles = new Map<string, TileEntry>();
  private readonly loading = new Set<string>();
  /**
   * Construction étalée sur plusieurs images (tuiles reçues, changements de niveau de détail, entités
   * des tuiles côté World) : World la fait avancer à chaque image dans un budget de temps.
   */
  readonly work = new WorkQueue();
  /**
   * Tuiles décodées gardées un moment : préchargées en avant du coureur, ou retrouvées après un
   * demi-tour, elles ne sont ni retéléchargées ni redécodées au moment où on en a besoin.
   */
  private readonly cache = new Map<string, { p: Promise<LoadedTile | null>; t: number }>();
  private readonly focus = new THREE.Vector3();
  private wanted = new Set<string>();
  private readonly source: WorldSource;
  private q: QualitySettings;
  private readonly seasonColors = {
    forest: colorUniform(),
    field: colorUniform(),
    field2: colorUniform(),
    meadow: colorUniform(),
    urban: colorUniform(),
    dirt: colorUniform(),
  };
  /** Humidité du sol (pluie) : assombrit et rend plus brillant. */
  readonly wetness = uniform(0);
  /** Neige / givre (hiver). */
  readonly frost = uniform(0);
  /** Montagne : limite d'enneigement de la saison (m), alpage, roche du massif, limite des arbres. */
  private readonly snowLine = uniform(SNOW_LINE_M.summer);
  private readonly alpineMeadow = colorUniform(ALPINE_MEADOW.summer);
  private readonly rockColor = colorUniform('#6d6860');
  private readonly treeline = uniform(2150);
  /** Teinte appliquée à l'orthophoto (prise en été) selon la saison, et sa saturation. */
  private readonly orthoTint = colorUniform('#ffffff');
  private readonly orthoSat = uniform(1);
  /**
   * Emprise de l'itinéraire actif : les sommets du maillage sous le ruban et sur une maille autour
   * sont abaissés juste sous la chaussée (aucune facette ne la traverse, quelle que soit la finesse
   * du maillage ou la largeur creusée par le générateur).
   */
  footprint: RouteFootprint | null = null;
  /** Itinéraire actif : sa chaussée est dessinée par le ruban, pas teintée dans le terrain. */
  activeRoute: string | null = null;
  /** `alive()` : faux dès que la tuile est déchargée (ou rechargée), pour les constructions différées. */
  onTileLoaded?: (tile: LoadedTile, alive: () => boolean) => void;
  onTileUnloaded?: (tile: LoadedTile) => void;
  /** Détail procédural du sol proche actif (voir GROUND_DETAIL_REQUESTED). */
  private readonly groundDetail: boolean;
  /** Accotements actifs (voir ROAD_EDGE_REQUESTED). */
  private readonly roadEdge: boolean;
  /** Accotements : tuiles traitées, temps de calcul des champs (ms, total et pire) et octets alloués (mesures). */
  readonly roadEdgeStats = { tiles: 0, ms: 0, maxMs: 0, bytes: 0 };

  constructor(source: WorldSource, q: QualitySettings, season: Season) {
    this.source = source;
    this.groundDetail = GROUND_DETAIL_REQUESTED && !LOW_POLY && GROUND_DETAIL_WORLDS.has(source.id);
    this.roadEdge = ROAD_EDGE_REQUESTED && !LOW_POLY && ROAD_EDGE_WORLDS.has(source.id);
    this.q = q;
    this.group.name = 'terrain';
    const alp = alpineProfile(source.id);
    this.rockColor.set(alp.rock);
    this.treeline.value = alp.treelineM;
    this.setSeason(season);
  }

  setSeason(season: Season): void {
    const c = (LOW_POLY ? LOWPOLY_GROUND : SEASON_GROUND)[season];
    for (const k of Object.keys(c) as Array<keyof typeof c>) this.seasonColors[k].set(c[k]);
    this.frost.value = season === 'winter' ? 0.25 : 0;
    this.snowLine.value = SNOW_LINE_M[season];
    this.alpineMeadow.set(ALPINE_MEADOW[season]);
    this.orthoTint.set(ORTHO_SEASON[season][0]);
    this.orthoSat.value = ORTHO_SEASON[season][1];
  }

  setQuality(q: QualitySettings): void {
    this.q = q;
    for (const e of this.tiles.values()) e.lod = Number.NaN; // forcer la reconstruction à la prochaine mise à jour
  }

  /** Tuile contenant un point monde. */
  /** Côté d'une tuile (m). */
  get tileSizeM(): number {
    return this.source.tileSize;
  }

  tileCoord(x: number, z: number): [number, number] {
    return [Math.floor(x / this.source.tileSize), Math.floor(z / this.source.tileSize)];
  }

  /** Altitude du sol (bilinéaire) ; NaN si la tuile n'est pas chargée. */
  /**
   * Carrefour : une autre voie carrossable (pas l'itinéraire `routeId`, ni sentier ni piste cyclable) passe à
   * moins de `r` m du point (tuiles chargées). Sert à n'annoncer les virages qu'aux bifurcations.
   */
  junctionNear(x: number, z: number, routeId: string, r = 14): boolean {
    // Ni chemins, ni allées privées (service) ; ni l'itinéraire, ni ses copies au nom d'un autre itinéraire
    // (« route:<autre>:<osm> », deux boucles sur la même route : prises pour une route qui part).
    const SKIP = new Set(['footway', 'path', 'steps', 'cycleway', 'bridleway', 'pedestrian', 'corridor', 'platform', 'track', 'service']);
    const osmOf = (id: string | undefined) => (id ?? '').slice((id ?? '').lastIndexOf(':') + 1);
    for (const e of this.tiles.values()) {
      const t = e.tile;
      if (x < t.x0 - r || x > t.x0 + t.size + r || z < t.z0 - r || z > t.z0 + t.size + r) continue;
      const mine = new Set(t.features.roads.filter((rd) => rd.route === routeId).map((rd) => osmOf(rd.id)));
      for (const road of t.features.roads) {
        const p = road.pts3;
        if (!p || road.route === routeId || (road.route && mine.has(osmOf(road.id))) || SKIP.has(road.kind) || road.tunnel) continue;
        for (let k = 0; k + 5 < p.length; k += 3) {
          const ax = p[k] as number, az = p[k + 2] as number;
          const dx = (p[k + 3] as number) - ax, dz = (p[k + 5] as number) - az;
          const l2 = dx * dx + dz * dz || 1;
          const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
          if ((ax + dx * u - x) ** 2 + (az + dz * u - z) ** 2 < r * r) return true;
        }
      }
    }
    return false;
  }

  heightAt(x: number, z: number): number {
    const [tx, tz] = this.tileCoord(x, z);
    const e = this.tiles.get(`${tx}_${tz}`);
    if (!e) return Number.NaN;
    const t = e.tile;
    // Le sol affiché est abaissé sous les routes (clampUnderRoads, les deux styles) ; herbe, fleurs,
    // clôtures et animaux se posent sur ce sol-là, pas sur le relief brut (ils flottaient à côté des routes).
    {
      const h = meshHeight(e.mesh.geometry, t, x, z);
      if (Number.isFinite(h)) return h;
    }
    const fx = ((x - t.x0) / t.size) * t.n;
    const fz = ((z - t.z0) / t.size) * t.n;
    const i = Math.min(Math.max(Math.floor(fx), 0), t.n - 1);
    const j = Math.min(Math.max(Math.floor(fz), 0), t.n - 1);
    const u = fx - i;
    const v = fz - j;
    const w = t.n + 1;
    const h00 = t.heights[j * w + i] as number;
    const h10 = t.heights[j * w + i + 1] as number;
    const h01 = t.heights[(j + 1) * w + i] as number;
    const h11 = t.heights[(j + 1) * w + i + 1] as number;
    return h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h01 * (1 - u) * v + h11 * u * v;
  }

  loadedTiles(): LoadedTile[] {
    return [...this.tiles.values()].map((e) => e.tile);
  }

  getTile(tx: number, tz: number): LoadedTile | undefined {
    return this.tiles.get(`${tx}_${tz}`)?.tile;
  }

  /** Charge les tuiles proches, décharge les lointaines, ajuste les niveaux de détail. */
  /** `onTile(fait, total)` : suivi du téléchargement des tuiles manquantes (écran d'attente). */
  async update(focus: THREE.Vector3, onTile?: (done: number, total: number) => void): Promise<void> {
    this.focus.copy(focus);
    const [cx, cz] = this.tileCoord(focus.x, focus.z);
    const r = this.q.tileRadius;
    const wanted = new Set<string>();
    this.wanted = wanted;
    const jobs: Array<Promise<void>> = [];
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > (r + 0.5) * (r + 0.5)) continue;
        const tx = cx + dx;
        const tz = cz + dz;
        if (!this.source.hasTile(tx, tz)) continue;
        const key = `${tx}_${tz}`;
        wanted.add(key);
        const existing = this.tiles.get(key);
        if (existing) {
          // Niveau de détail : maillage refait plus tard, dans le budget de l'image (plusieurs tuiles changent d'un coup).
          if (existing.lod !== this.lodAt(tx, tz))
            this.work.defer(() => {
              const lod = this.lodAt(tx, tz);
              if (this.tiles.get(key) === existing && existing.lod !== lod) this.rebuild(existing, lod);
            }, this.distTo(tx, tz), 'terrain (détail)');
        } else if (!this.loading.has(key)) {
          this.loading.add(key);
          jobs.push(
            this.fetchTile(tx, tz)
              .then((tile) => {
                // Construction différée : la tuile n'est plus voulue (coureur rapide) ou déjà là, on passe.
                if (tile)
                  this.work.defer(() => {
                    if (!this.tiles.has(key) && this.wanted.has(key)) this.add(tile, this.lodAt(tx, tz));
                  }, this.distTo(tx, tz), 'terrain');
              })
              .catch((err) => console.warn(`Tuile ${key} indisponible`, err))
              .finally(() => this.loading.delete(key)),
          );
        }
      }
    for (const [key, e] of this.tiles) {
      if (!wanted.has(key)) {
        this.group.remove(e.mesh);
        e.mesh.geometry.dispose();
        (e.mesh.material as THREE.Material).dispose();
        e.textures.forEach((t) => t.dispose());
        this.tiles.delete(key);
        this.onTileUnloaded?.(e.tile);
      }
    }
    if (onTile) {
      let done = 0;
      onTile(0, jobs.length);
      for (const j of jobs) void j.finally(() => onTile(++done, jobs.length));
    }
    await Promise.all(jobs);
  }

  /** Niveau de détail d'une tuile selon son anneau autour du coureur (0 au centre). */
  private lodAt(tx: number, tz: number): number {
    const [cx, cz] = this.tileCoord(this.focus.x, this.focus.z);
    const ring = Math.max(Math.abs(tx - cx), Math.abs(tz - cz));
    if (ring <= 1 && this.q.level !== 'low') {
      // Détail fin (FINE_LOD) sur les tuiles à moins de FINE_REACH_M du coureur : bord de la tuile le plus proche.
      const T = this.source.tileSize;
      const ex = Math.max(tx * T - this.focus.x, 0, this.focus.x - (tx + 1) * T);
      const ez = Math.max(tz * T - this.focus.z, 0, this.focus.z - (tz + 1) * T);
      if (ex * ex + ez * ez <= FINE_REACH_M * FINE_REACH_M) return FINE_LOD;
    }
    return ring <= 1 ? 0 : ring <= 2 ? 1 : 2;
  }

  /** Distance (m) du coureur au centre de la tuile : priorité de construction (la plus proche d'abord). */
  distTo(tx: number, tz: number): number {
    const T = this.source.tileSize;
    return Math.hypot((tx + 0.5) * T - this.focus.x, (tz + 0.5) * T - this.focus.z);
  }

  /** Tuile décodée, depuis le cache si elle y est encore (voir CACHE_MS). */
  private fetchTile(tx: number, tz: number): Promise<LoadedTile | null> {
    const key = `${tx}_${tz}`;
    const now = performance.now();
    for (const [k, c] of this.cache) if (now - c.t > CACHE_MS) this.cache.delete(k);
    const hit = this.cache.get(key);
    if (hit) return hit.p;
    const p = this.source.loadTile(tx, tz);
    this.cache.set(key, { p, t: now });
    p.catch(() => this.cache.delete(key));
    if (this.cache.size > CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    return p;
  }

  /**
   * Préchargement : télécharge et décode dès maintenant les tuiles qui seront voulues autour de
   * `point` (devant le coureur), sans les construire ; elles seront prêtes en arrivant.
   */
  prefetch(point: THREE.Vector3): void {
    const [cx, cz] = this.tileCoord(point.x, point.z);
    const r = this.q.tileRadius;
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > (r + 0.5) * (r + 0.5)) continue;
        const tx = cx + dx;
        const tz = cz + dz;
        const key = `${tx}_${tz}`;
        if (this.tiles.has(key) || this.loading.has(key) || !this.source.hasTile(tx, tz)) continue;
        void this.fetchTile(tx, tz).catch(() => undefined);
      }
  }

  private disposed = false;

  /** Libère toutes les tuiles (changement d'itinéraire sans recharger la page). */
  disposeAll(): void {
    this.disposed = true;
    this.work.clear();
    this.cache.clear();
    for (const [key, e] of this.tiles) {
      this.group.remove(e.mesh);
      e.mesh.geometry.dispose();
      (e.mesh.material as THREE.Material).dispose();
      e.textures.forEach((t) => t.dispose());
      this.tiles.delete(key);
      this.onTileUnloaded?.(e.tile);
    }
  }

  private add(tile: LoadedTile, lod: number): void {
    if (this.disposed) return;
    if (!tile.splat) tile.splat = rasterizeSplat(tile, this.activeRoute);
    const textures = this.splatTextures(tile);
    let ortho: THREE.Texture | null = null;
    if (tile.orthoBlob) {
      // Orthophoto IGN : décodée hors du fil principal (createImageBitmap) ; le matériau la prend en
      // compte dès réception. Une image décodée par le navigateur au moment de l'envoi au GPU
      // coûtait 5 à 13 ms à l'image où la tuile apparaissait.
      const tex = new THREE.Texture();
      ortho = tex;
      void createImageBitmap(tile.orthoBlob)
        .then((bmp) => {
          if (tex.userData.disposed) return bmp.close();
          tex.image = bmp;
          tex.needsUpdate = true;
        })
        .catch(() => undefined);
      tex.addEventListener('dispose', () => {
        tex.userData.disposed = true;
        (tex.image as ImageBitmap | undefined)?.close?.();
      });
      ortho.colorSpace = THREE.SRGBColorSpace;
      ortho.flipY = false;
      ortho.anisotropy = 8;
      ortho.wrapS = ortho.wrapT = THREE.ClampToEdgeWrapping;
      textures.push(ortho as THREE.DataTexture);
    }
    // Accotements : champ de distance au bord des routes dessinées (libéré avec les autres textures de la tuile).
    const edge = this.roadEdge ? this.roadEdgeTexture(tile) : null;
    if (edge) textures.push(edge);
    const material = this.createMaterial(textures, ortho, edge);
    const mesh = new THREE.Mesh(this.buildGeometry(tile, lod), material);
    mesh.position.set(tile.x0 + tile.size / 2, 0, tile.z0 + tile.size / 2);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.name = `tile_${tile.id}`;
    this.group.add(mesh);
    const key = `${tile.tx}_${tile.tz}`;
    const entry: TileEntry = { tile, mesh, lod, textures };
    this.tiles.set(key, entry);
    this.onTileLoaded?.(tile, () => this.tiles.get(key) === entry);
  }

  private rebuild(e: TileEntry, lod: number): void {
    e.mesh.geometry.dispose();
    e.mesh.geometry = this.buildGeometry(e.tile, lod);
    e.lod = lod;
  }

  /** Grille régulière centrée + jupe de 6 m sur les bords pour masquer les fissures entre LOD. */
  private buildGeometry(tile: LoadedTile, lod: number): THREE.BufferGeometry {
    const seg = lod === FINE_LOD ? Math.max(this.q.terrainSegmentsPerTile, Math.min(Math.ceil(tile.size / FINE_CELL_M), tile.n * 2)) : Math.max(16, Math.min(this.q.terrainSegmentsPerTile >> lod, tile.n * 2));
    const s = tile.size;
    const vertsPerRow = seg + 1;
    const mainCount = vertsPerRow * vertsPerRow;
    const skirtCount = seg * 4;
    const pos = new Float32Array((mainCount + skirtCount) * 3);
    const uvs = new Float32Array((mainCount + skirtCount) * 2);
    const sampleH = (u: number, v: number) => {
      const fx = u * tile.n;
      const fz = v * tile.n;
      const i = Math.min(Math.floor(fx), tile.n - 1);
      const j = Math.min(Math.floor(fz), tile.n - 1);
      const a = fx - i;
      const b = fz - j;
      const w = tile.n + 1;
      const h = tile.heights;
      return (
        (h[j * w + i] as number) * (1 - a) * (1 - b) +
        (h[j * w + i + 1] as number) * a * (1 - b) +
        (h[(j + 1) * w + i] as number) * (1 - a) * b +
        (h[(j + 1) * w + i + 1] as number) * a * b
      );
    };
    // Une maille en diagonale : portée au-delà de l'emprise des sommets dont les triangles la couvrent.
    const fp = this.footprint && this.footprint.near(tile.x0 + s / 2, tile.z0 + s / 2, s * 0.75 + 20) ? this.footprint : null;
    const reach = (s / seg) * Math.SQRT2 + 0.1;
    // Sol sur l'axe de l'itinéraire (grille de la tuile), pour reconnaître les tunnels.
    const axisGround = (x: number, z: number) => {
      const u = (x - tile.x0) / s;
      const v = (z - tile.z0) / s;
      return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? sampleH(u, v) : Number.NaN;
    };
    for (let j = 0; j <= seg; j++)
      for (let i = 0; i <= seg; i++) {
        const k = j * vertsPerRow + i;
        const u = i / seg;
        const v = j / seg;
        pos[k * 3] = (u - 0.5) * s;
        const h = sampleH(u, v);
        pos[k * 3 + 1] = fp ? fp.clampTerrain(tile.x0 + u * s, tile.z0 + v * s, h, reach, axisGround) : h;
        pos[k * 3 + 2] = (v - 0.5) * s;
        uvs[k * 2] = u;
        uvs[k * 2 + 1] = v;
      }
    // Style jeu vidéo : sol abaissé sous toutes les routes de la tuile (réseau OSM, itinéraire des mondes
    // ouverts), comme sous le ruban de l'itinéraire. Sans orthophoto pour peindre la route, les facettes du
    // maillage (plus grossier que la tranchée creusée par le générateur) se voyaient en vert sur la chaussée.
    clampUnderRoads(pos, tile, seg, reach, axisGround);
    // Tableaux typés et normales tirées des hauteurs voisines (grille régulière) : `computeVertexNormals`
    // de three.js, générique, prenait ≈ 75 ms par tuile en qualité haute (saccade au changement de détail).
    const border: number[] = [];
    for (let i = 0; i < seg; i++) border.push(i);
    for (let j = 0; j < seg; j++) border.push(j * vertsPerRow + seg);
    for (let i = seg; i > 0; i--) border.push(seg * vertsPerRow + i);
    for (let j = seg; j > 0; j--) border.push(j * vertsPerRow);
    const index = new Uint32Array(seg * seg * 6 + border.length * 6);
    let w = 0;
    for (let j = 0; j < seg; j++)
      for (let i = 0; i < seg; i++) {
        const a = j * vertsPerRow + i;
        const b = a + 1;
        const c = a + vertsPerRow;
        const d = c + 1;
        index[w++] = a;
        index[w++] = c;
        index[w++] = b;
        index[w++] = b;
        index[w++] = c;
        index[w++] = d;
      }
    // Jupe : contour de la grille parcouru dans le sens horaire, dupliqué 6 m plus bas.
    border.forEach((src, n) => {
      const k = mainCount + n;
      pos[k * 3] = pos[src * 3] as number;
      pos[k * 3 + 1] = (pos[src * 3 + 1] as number) - 6;
      pos[k * 3 + 2] = pos[src * 3 + 2] as number;
      uvs[k * 2] = uvs[src * 2] as number;
      uvs[k * 2 + 1] = uvs[src * 2 + 1] as number;
    });
    for (let n = 0; n < border.length; n++) {
      const a = border[n] as number;
      const b = border[(n + 1) % border.length] as number;
      const a2 = mainCount + n;
      const b2 = mainCount + ((n + 1) % border.length);
      index[w++] = a;
      index[w++] = b;
      index[w++] = a2;
      index[w++] = b;
      index[w++] = b2;
      index[w++] = a2;
    }
    // Normale (−∂h/∂x, 1, −∂h/∂z) par différences centrées (décentrées au bord) ; la jupe prend celle de son sommet.
    const normals = new Float32Array((mainCount + skirtCount) * 3);
    const step = s / seg;
    const hAt = (i: number, j: number) => pos[(j * vertsPerRow + i) * 3 + 1] as number;
    for (let j = 0; j <= seg; j++)
      for (let i = 0; i <= seg; i++) {
        const i0 = Math.max(i - 1, 0);
        const i1 = Math.min(i + 1, seg);
        const j0 = Math.max(j - 1, 0);
        const j1 = Math.min(j + 1, seg);
        const dx = (hAt(i1, j) - hAt(i0, j)) / ((i1 - i0) * step);
        const dz = (hAt(i, j1) - hAt(i, j0)) / ((j1 - j0) * step);
        const inv = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
        const k = (j * vertsPerRow + i) * 3;
        normals[k] = -dx * inv;
        normals[k + 1] = inv;
        normals[k + 2] = -dz * inv;
      }
    border.forEach((src, n) => normals.copyWithin((mainCount + n) * 3, src * 3, src * 3 + 3));
    const geo = new THREE.BufferGeometry();
    geo.userData.seg = seg;
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.computeBoundingSphere();
    return geo;
  }

  private splatTextures(tile: LoadedTile): THREE.DataTexture[] {
    const { res, data } = tile.splat as { res: number; data: Uint8Array };
    const a = new Uint8Array(res * res * 4);
    const b = new Uint8Array(res * res * 4);
    // Troisième texture : sable (canal 9) en rouge.
    const c = new Uint8Array(res * res * 4);
    const C = SPLAT_CHANNELS.length;
    for (let i = 0; i < res * res; i++) {
      c[i * 4] = data[i * C + 9] as number;
      a[i * 4] = data[i * C] as number;
      a[i * 4 + 1] = data[i * C + 1] as number;
      a[i * 4 + 2] = data[i * C + 2] as number;
      a[i * 4 + 3] = data[i * C + 3] as number;
      b[i * 4] = data[i * C + 4] as number;
      b[i * 4 + 1] = data[i * C + 5] as number;
      b[i * 4 + 2] = data[i * C + 6] as number;
      b[i * 4 + 3] = data[i * C + 7] as number;
    }
    return [a, b, c].map((buf) => {
      const t = new THREE.DataTexture(buf, res, res, THREE.RGBAFormat);
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = true;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.needsUpdate = true;
      return t;
    });
  }

  /** Champ de distance au bord de chaussée de la tuile (R8, 512², niveaux réduits), voir roadEdgeField.ts. */
  private roadEdgeTexture(tile: LoadedTile): THREE.DataTexture {
    const t0 = performance.now();
    const data = roadEdgeField(tile.x0, tile.z0, tile.size, edgeRoads(tile.features.roads ?? []), EDGE_FIELD_RES);
    const ms = performance.now() - t0;
    const s = this.roadEdgeStats;
    s.tiles++;
    s.ms += ms;
    s.maxMs = Math.max(s.maxMs, ms);
    s.bytes += data.byteLength;
    if (frameStats.enabled) frameStats.add('terrain (accotements)', ms);
    const t = new THREE.DataTexture(data, EDGE_FIELD_RES, EDGE_FIELD_RES, THREE.RedFormat, THREE.UnsignedByteType);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    return t;
  }

  private createMaterial(textures: THREE.DataTexture[], ortho: THREE.Texture | null, edge: THREE.Texture | null = null): THREE.MeshStandardNodeMaterial {
    if (LOW_POLY) return this.createLowPolyMaterial(textures);
    const m = new THREE.MeshStandardNodeMaterial();
    const s0 = texture(textures[0] as THREE.Texture, uv());
    const s1 = texture(textures[1] as THREE.Texture, uv());
    const c = this.seasonColors;
    const wp = positionWorld.xz;
    // Variations à plusieurs échelles pour casser les aplats (taches de cultures, herbe).
    const n1 = mx_noise_float(wp.mul(0.004)).mul(0.5).add(0.5);
    // Les bruits fins s'effacent avec la distance : au-delà de leur taille de pixel ils grésillent dès que la caméra
    // bouge (versants enneigés la nuit surtout). Au loin, la valeur moyenne les remplace.
    const camDist = positionWorld.sub(cameraPosition).length();
    const n2 = mix(float(0.5), mx_noise_float(wp.mul(0.035)).mul(0.5).add(0.5), float(1).sub(smoothstep(250, 1200, camDist)));
    const n3 = mix(float(0.5), mx_noise_float(wp.mul(0.4)).mul(0.5).add(0.5), float(1).sub(smoothstep(40, 220, camDist)));
    const detail = n2.mul(0.18).add(n3.mul(0.12)).add(0.82);
    // Accotements (?roadedge=1) : distance signée au bord des routes dessinées (m, négative sur la chaussée) et masque
    // routier précis près d'elles. Le masque du raster (≈ 4 m) retirait orthophoto et détail sur 3 à 4 m de part et
    // d'autre ; à moins de 4,5 m d'une route dessinée, seul son vrai bord compte (le raster garde les chemins non
    // dessinés ailleurs). Au loin (150 à 300 m), retour au raster : rendu lointain inchangé.
    const edgeD = edge ? edgeDistance(edge) : null;
    const edgeRoadMask = edgeD ? edgeTerrainRoadMask(edgeD, smoothstep(0.35, 0.75, s1.g), camDist) : null;

    // Altitude : alpages au-dessus de ~1 500 m (pelouse rase, plus claire et plus sèche).
    const alt = positionWorld.y;
    const alpine = smoothstep(ALPINE_GROUND_M - 200, ALPINE_GROUND_M + 200, alt);
    const meadow = mix(c.meadow.node, this.alpineMeadow.node, alpine).mul(n1.mul(0.25).add(0.85));
    const field = mix(c.field.node, c.field2.node, smoothstep(0.45, 0.6, n1));
    // Sillons des champs : bandes fines selon une orientation pseudo-aléatoire par parcelle.
    const furrow = mx_noise_float(wp.mul(vec2(0.9, 0.05))).mul(0.06).add(1);
    // Sous-bois : aiguilles sombres des pessières en altitude.
    const forestFloor = mix(c.forest.node, vec3(0.2, 0.22, 0.13), alpine.mul(0.6)).mul(n2.mul(0.3).add(0.75));
    const water = vec3(0.18, 0.26, 0.27);
    const urban = c.urban.node.mul(n3.mul(0.2).add(0.85));
    // Trame des chaussées OSM (≈ 4 m), plus large que le ruban : teinte de trottoir et mate, sinon bande claire qui reflète le ciel.
    const asphalt = ROAD_FX ? vec3(0.1, 0.095, 0.088) : vec3(0.16, 0.165, 0.175);

    let col = meadow;
    col = mix(col, field.mul(furrow), s0.g);
    col = mix(col, meadow, s0.b);
    col = mix(col, forestFloor, s0.r);
    // zones bâties : jardins et cours, l'orthophoto en donne le détail (teinte modérée)
    col = mix(col, urban, s1.r.mul(0.55));
    // abords de l'itinéraire : herbe des bas-côtés
    col = mix(col, meadow, smoothstep(0.2, 0.8, s1.b).mul(0.85));
    col = mix(col, water, s0.a);
    col = mix(col, asphalt, edgeRoadMask ?? smoothstep(0.35, 0.75, s1.g));
    // Pentes fortes : terre et pierre apparentes.
    const slope = float(1).sub(normalWorld.y);
    col = mix(col, c.dirt.node, smoothstep(0.3, 0.55, slope).mul(0.6));
    if (ortho) {
      // Orthophoto : vrais motifs de parcelles, haies, villages ; teinte saisonnière ; le détail
      // procédural reste visible de près. La chaussée garde le rendu asphalte.
      const photo = texture(ortho, uv()).rgb;
      const lum = photo.dot(vec3(0.299, 0.587, 0.114));
      const seasonal = mix(vec3(lum, lum, lum), photo, this.orthoSat).mul(this.orthoTint.node).mul(1.08);
      const roadMask = edgeRoadMask ?? smoothstep(0.35, 0.75, s1.g);
      // abords de l'itinéraire : la chaussée floue de la photo ne déborde pas sur les bas-côtés
      const verge = smoothstep(0.2, 0.8, s1.b);
      col = mix(col, seasonal, float(ORTHO_WEIGHT).mul(float(1).sub(roadMask)).mul(float(1).sub(verge.mul(0.8))));
    }
    // Montagne : roche grise sur les fortes pentes (plus tôt en altitude), au-dessus de la limite
    // des arbres et sur les éboulis OSM ; glace sur les glaciers ; neige selon la saison. Appliqué
    // après l'orthophoto (prise en été), atténué quand elle montre déjà la roche.
    const ice = smoothstep(0.7, 0.9, s1.a);
    const scree = smoothstep(0.15, 0.4, s1.a).mul(float(1).sub(ice));
    const roadMask = edgeRoadMask ?? smoothstep(0.35, 0.75, s1.g);
    // (pas en plaine : talus des routes creusées et berges y restent en terre ; talus de
    // l'itinéraire surtout herbeux)
    const steep = smoothstep(mix(float(0.4), float(0.24), alpine), mix(float(0.6), float(0.44), alpine), slope)
      .mul(smoothstep(250, 600, alt))
      .mul(float(1).sub(smoothstep(0.2, 0.8, s1.b).mul(0.7)));
    const highRock = smoothstep(this.treeline.add(100), this.treeline.add(700), alt).mul(0.6).mul(n1.mul(0.6).add(0.6));
    const rockMask = clamp(steep.max(highRock).max(scree), 0, 1).mul(float(1).sub(roadMask));
    // Roche : strates et taches (bruit étiré), éboulis plus clairs et grenus.
    const strata = mix(float(1), mx_noise_float(vec3(wp.x.mul(0.05), alt.mul(0.35), wp.y.mul(0.05))).mul(0.12).add(1), float(1).sub(smoothstep(300, 1500, camDist)));
    const rock = this.rockColor.node.mul(n3.mul(0.25).add(0.82)).mul(strata).mul(scree.mul(0.12).add(1));
    col = mix(col, rock, rockMask.mul(ortho ? 0.5 : 0.9));
    const glacier = mix(vec3(0.78, 0.85, 0.9), vec3(0.62, 0.72, 0.8), smoothstep(0.55, 0.8, n3));
    col = mix(col, glacier, ice.mul(ortho ? 0.7 : 0.9));
    // Neige : limite de saison ± 150 m de bruit, 200 m plus bas sur les versants nord (normale vers −z) ;
    // elle ne tient pas sur les parois raides et les routes sont déneigées.
    const north = smoothstep(0.0, 0.5, normalWorld.z.negate());
    const line = this.snowLine.sub(north.mul(200)).add(n1.sub(0.5).mul(300));
    const snow = smoothstep(line.sub(120), line.add(180), alt)
      .mul(float(1).sub(smoothstep(0.38, 0.62, slope)))
      .mul(float(1).sub(roadMask))
      .max(ice.mul(smoothstep(line.sub(400), line, alt)));
    col = col.mul(detail);
    // Détail du sol proche (?grounddetail=1, Billom) : rien n'est construit quand il est coupé.
    const gd = this.groundDetail
      ? groundDetail({ forest: s0.r, field: s0.g, meadow: s0.b, water: s0.a, urban: s1.r, road: roadMask, slope, rock: rockMask, snow, ice, camDist })
      : null;
    if (gd) col = col.mul(gd.tint);
    // Accotements (?roadedge=1, Billom) : terre tassée et gravillons au bord des routes dessinées.
    const shoulder = edgeD ? roadShoulder(col as unknown as GV3, edgeD, { water: s0.a, urban: s1.r, snow, ice, camDist }) : null;
    if (shoulder) col = shoulder.col as unknown as typeof col;
    // Pluie : sol plus sombre ; givre : voile clair sur les surfaces planes.
    col = col.mul(float(1).sub(this.wetness.mul(0.35)));
    col = mix(col, vec3(0.86, 0.9, 0.93), this.frost.mul(smoothstep(0.85, 0.98, normalWorld.y)).mul(n2));
    col = mix(col, vec3(0.9, 0.93, 0.96).mul(n3.mul(0.06).add(0.96)), snow.mul(0.95));
    // Ombres des nuages qui passent (clouds.ts).
    m.colorNode = col.mul(cloudShade());
    const rough = mix(float(0.95), float(ROAD_FX ? 0.92 : 0.55), roadMask);
    const roughness = clamp(rough.sub(this.wetness.mul(0.45)).sub(s0.a.mul(0.6)).sub(ice.mul(0.4)).sub(snow.mul(0.25)), 0.08, 1);
    const roughGd = gd ? clamp(roughness.add(gd.rough), 0.08, 1) : roughness;
    m.roughnessNode = shoulder ? clamp(roughGd.add(shoulder.rough), 0.08, 1) : roughGd;
    if (gd) m.normalNode = gd.normal;
    m.metalnessNode = float(0);
    return m;
  }
  /**
   * Style jeu vidéo : aplats francs par occupation du sol (limites nettes, pas d'orthophoto ni de grain),
   * grandes taches de teinte en 3 paliers pour casser les aplats, facettes du maillage visibles.
   */
  private createLowPolyMaterial(textures: THREE.DataTexture[]): THREE.MeshStandardNodeMaterial {
    const m = new THREE.MeshStandardNodeMaterial();
    m.flatShading = true;
    const s0 = texture(textures[0] as THREE.Texture, uv());
    const s1 = texture(textures[1] as THREE.Texture, uv());
    const s2 = texture(textures[2] as THREE.Texture, uv());
    const c = this.seasonColors;
    const wp = positionWorld.xz;
    // Taches de teinte (parcelles, prés plus ou moins verts) : 3 paliers, pas de dégradé.
    const n1 = mx_noise_float(wp.mul(0.006)).mul(0.5).add(0.5);
    const patch = n1.mul(3).floor().div(3).mul(0.14).add(0.9);
    const alt = positionWorld.y;
    const alpine = smoothstep(ALPINE_GROUND_M - 200, ALPINE_GROUND_M + 200, alt);
    const meadow = mix(c.meadow.node, this.alpineMeadow.node, alpine);
    const field = mix(c.field.node, c.field2.node, smoothstep(0.48, 0.52, mx_noise_float(wp.mul(0.0025)).mul(0.5).add(0.5)));
    const sharp = (v: THREE.Node<'float'>) => smoothstep(0.42, 0.58, v);
    let col = meadow;
    col = mix(col, field, sharp(s0.g));
    col = mix(col, meadow, sharp(s0.b));
    col = mix(col, c.forest.node, sharp(s0.r));
    // Bourgs : couleur claire, sauf dans les parcs et bois des villes (pré ou forêt aussi marqués, comme le
    // bois de Boulogne à Longchamp, entièrement « urbain ») où le vert l'emporte.
    const park = sharp(s0.b).max(sharp(s0.r));
    col = mix(col, c.urban.node, sharp(s1.r).mul(float(1).sub(park)).mul(0.8));
    col = mix(col, meadow, sharp(s1.b));
    col = col.mul(patch);
    // Plages : sable clair, plus foncé et mouillé au bord de l'eau (sous 0,6 m).
    const sand = mix(vec3(0.56, 0.43, 0.26), vec3(0.8, 0.62, 0.34), smoothstep(0.2, 0.9, alt));
    col = mix(col, sand, sharp(s2.r));
    col = mix(col, vec3(0.2, 0.42, 0.62), sharp(s0.a));
    // Chaussées OSM : le sol n'en prend plus la couleur (les rubans et le réseau dessinent les routes) ; peint
    // au pas du raster (≈ 4 m), il débordait en bande grise qui plongeait sous le bord de la route. Le masque
    // sert encore à ôter roche et neige sous les routes.
    const roadMask = smoothstep(0.45, 0.6, s1.g);
    const slope = float(1).sub(normalWorld.y);
    col = mix(col, c.dirt.node, smoothstep(0.42, 0.5, slope).mul(0.7));
    // Montagne : roche et neige en aplats.
    const rockMask = clamp(smoothstep(0.5, 0.58, slope).mul(smoothstep(250, 600, alt)).max(smoothstep(this.treeline.add(200), this.treeline.add(260), alt)).max(sharp(s1.a)), 0, 1).mul(float(1).sub(roadMask));
    col = mix(col, this.rockColor.node, rockMask);
    const north = smoothstep(0.0, 0.5, normalWorld.z.negate());
    const line = this.snowLine.sub(north.mul(200));
    const snow = smoothstep(line.sub(10), line.add(10), alt).mul(float(1).sub(smoothstep(0.5, 0.55, slope))).mul(float(1).sub(roadMask));
    col = mix(col, vec3(0.93, 0.95, 0.98), snow);
    col = col.mul(float(1).sub(this.wetness.mul(0.2)));
    col = mix(col, vec3(0.9, 0.93, 0.96), this.frost.mul(0.5).mul(smoothstep(0.9, 0.98, normalWorld.y)));
    m.colorNode = col;
    m.roughnessNode = float(0.95);
    m.metalnessNode = float(0);
    return m;
  }
}

/**
 * Sol à 4 cm sous la chaussée. Tunnel : sol à plus de 2,5 m au-dessus de la route sur l'axe même (le
 * générateur ne creuse pas les tunnels, il creuse les tranchées), ou à défaut plus de 5 m au sommet.
 */
type GF = THREE.Node<'float'>;
type GV3 = THREE.Node<'vec3'>;

/** Masques du matériau du terrain utiles au détail du sol proche (0–1, sauf `camDist` en m). */
interface GroundMasks {
  forest: GF;
  field: GF;
  meadow: GF;
  water: GF;
  urban: GF;
  road: GF;
  slope: GF;
  rock: GF;
  snow: GF;
  ice: GF;
  camDist: GF;
}

/**
 * Détail procédural du sol proche (P2.1b) : teinte multiplicative de moyenne ≈ 1 (la couleur de saison et
 * l'orthophoto gardent la main), décalage de rugosité et normale perturbée par un microrelief (mottes,
 * litière, cailloux). Quatre bruits par pixel : trois de Perlin (≈ 2,2 m, 60 cm, 12 cm) et un de Worley
 * (≈ 31 cm). Chaque échelle s'efface avant de grésiller : 12 cm de 10 à 32 m, 31 et 60 cm de 22 à 70 m,
 * l'ensemble de 40 à 110 m. Les motifs non linéaires s'effacent vers leur valeur moyenne (pas de bande plus
 * claire ou plus sombre au fondu). Au-delà de 110 m, la teinte vaut exactement 1 et la normale celle du
 * maillage. Rien sur la chaussée, l'eau, la neige ni la glace. Les bruits ne sont évalués que dans un bloc
 * conditionnel (moins de 110 m, hors chaussée, eau et neige) : le terrain lointain ne paie que les masques.
 */
function groundDetail(p: GroundMasks): { tint: GV3; rough: GF; normal: GV3 } {
  const wp = positionWorld.xz;
  const one = float(1);
  // Fondus par échelle : plus le motif est fin, plus tôt il s'efface (au-delà, il grésillerait).
  const fineK = one.sub(smoothstep(5, 14, p.camDist));
  const cellK = one.sub(smoothstep(12, 40, p.camDist));
  const midK = one.sub(smoothstep(20, 60, p.camDist));
  const nearK = one.sub(smoothstep(40, 110, p.camDist));
  // Poids des matières (la chaussée, l'eau, la neige et la glace n'en reçoivent pas).
  const keep = one.sub(p.road).mul(one.sub(p.water)).mul(one.sub(p.snow.max(p.ice)));
  const strength = nearK.mul(keep);
  const wForest = p.forest;
  // Bruits calculés seulement là où le détail se voit (moins de 110 m, hors chaussée, eau et neige) : le reste du
  // terrain (lointain compris) ne paie que les masques ci-dessus. Résultat : teinte (rgb) et hauteur (w).
  const packed = Fn(() => {
    const out = vec4(1, 1, 1, 0).toVar();
    If(strength.greaterThan(0.001), () => {
      out.assign(groundDetailCore(p, wp, fineK, cellK, midK, nearK, keep, strength));
    });
    return out;
  })();
  const tint = packed.xyz as unknown as GV3;
  const h = packed.w;
  // Rugosité : creux sombres un peu plus rugueux, paille claire un peu moins, litière légèrement plus lisse.
  const lum = dot(tint, vec3(0.299, 0.587, 0.114));
  const rough = clamp(one.sub(lum).mul(0.35), -0.05, 0.06).sub(wForest.mul(0.03).mul(strength)) as unknown as GF;

  // Normale par les dérivées écran de la hauteur (Mikkelsen, « surface gradient » non normalisé : la pente suit
  // la hauteur en mètres, quelle que soit la distance). Hors du bloc conditionnel (dérivées en flot uniforme).
  const sx = positionView.dFdx();
  const sy = positionView.dFdy();
  const r1 = sy.cross(normalView);
  const r2 = normalView.cross(sx);
  const det = sx.dot(r1).mul(faceDirection);
  const grad = det.sign().mul(r1.mul(h.dFdx()).add(r2.mul(h.dFdy())));
  const normal = det.abs().mul(normalView).sub(grad).normalize() as unknown as GV3;
  return { tint, rough, normal };
}

/** Teinte (rgb) et hauteur du microrelief en mètres (w) du sol proche, voir groundDetail. */
function groundDetailCore(p: GroundMasks, wp: THREE.Node<'vec2'>, fineK: GF, cellK: GF, midK: GF, nearK: GF, keep: GF, strength: GF): THREE.Node<'vec4'> {
  const one = float(1);
  // Bruits bruts, centrés sur 0 (≈ ±0,5), et distance au germe de Worley le plus proche.
  const nA = mx_noise_float(wp.mul(0.45));
  const nB = mx_noise_float(wp.mul(1.7));
  const nC = mx_noise_float(wp.mul(20));
  const cell = mx_worley_noise_float(wp.mul(3.2));
  // Termes linéaires fondus vers 0, motifs seuillés fondus vers leur moyenne.
  const fA = nA.mul(nearK);
  const fB = nB.mul(midK);
  const fC = nC.mul(fineK);
  // Bosse au germe (motte, touffe de feuilles, caillou), creux entre deux germes, brins de chaume.
  const clod = one.sub(smoothstep(0.05, 0.55, cell)).sub(0.4).mul(cellK);
  const gap = mix(float(0.3), smoothstep(0.45, 0.8, cell), cellK);
  const speck = mix(float(0.5), smoothstep(-0.2, 0.2, nC.add(nB.mul(0.3))), fineK);

  const wForest = p.forest;
  const wField = p.field.mul(one.sub(p.meadow)).mul(one.sub(p.forest));
  const wMineral = smoothstep(0.3, 0.55, p.slope).mul(0.6).max(p.rock).mul(one.sub(p.forest));
  const wMeadow = clamp(one.sub(wForest).sub(wField).sub(wMineral), 0, 1);
  const wSum = wForest.add(wField).add(wMineral).add(wMeadow).max(1e-3);

  // Champs : brins de chaume clairs sur terre brune, creux sombres entre les mottes, nuances de 60 cm et 2 m
  // (moyenne ≈ 0,93 : un peu plus de terre que de paille, ce qui ôte l'aspect de sable uni).
  const field = mix(vec3(0.86, 0.83, 0.8), vec3(1.1, 1.1, 1.08), speck)
    .mul(one.sub(gap.mul(0.16)))
    .mul(fB.mul(0.14).add(1))
    .mul(fA.mul(0.08).add(1));
  // Prés et bas-côtés : taches vert tendre et herbe sèche de 2 m, grain fin.
  const meadow = mix(vec3(0.93, 1.05, 0.92), vec3(1.07, 0.99, 0.88), mix(float(0.5), smoothstep(-0.3, 0.3, nA), nearK))
    .mul(fB.mul(0.1).add(fC.mul(0.08)).add(1))
    .mul(one.sub(gap.mul(0.08)));
  // Sous-bois : litière brune (feuilles, brindilles) sur l'humus, plutôt qu'un aplat gris-vert.
  const litter = mix(float(0.5), smoothstep(-0.25, 0.25, nB.add(clod.mul(0.8))), midK);
  const forest = mix(vec3(0.8, 0.8, 0.78), vec3(1.2, 1.08, 0.92), litter)
    .mul(fC.mul(0.1).add(1))
    .mul(one.sub(gap.mul(0.1)));
  // Terre et pierre des pentes : cailloux clairs, grain fin.
  const mineral = vec3(1, 1, 1).mul(clod.mul(0.25).add(fC.mul(0.12)).add(1)).mul(one.sub(gap.mul(0.1)));
  let t = forest.mul(wForest).add(field.mul(wField)).add(mineral.mul(wMineral)).add(meadow.mul(wMeadow)).div(wSum);
  // Jardins et cours des zones bâties : grain discret seulement.
  t = mix(t, vec3(1, 1, 1).mul(fB.mul(0.06).add(1)), p.urban.mul(0.55));
  const tint = vec3(1, 1, 1).add(t.sub(1).mul(strength));

  // Microrelief (m) : hauteurs par matière.
  const h = wField
    .mul(clod.mul(0.03).sub(gap.mul(0.012)).add(fB.mul(0.01)).add(fC.mul(0.006)))
    .add(wMeadow.mul(fA.mul(0.012).add(fB.mul(0.008)).add(fC.mul(0.006))))
    .add(wForest.mul(clod.mul(0.022).add(fB.mul(0.01)).add(fC.mul(0.007))))
    .add(wMineral.mul(clod.mul(0.035).sub(gap.mul(0.01)).add(fB.mul(0.012)).add(fC.mul(0.008))))
    .div(wSum)
    .mul(keep);
  return vec4(tint, h) as unknown as THREE.Node<'vec4'>;
}

/** Distance signée au bord de chaussée (m) lue dans le champ de la tuile (filtre linéaire, nœuds aux centres des texels). */
function edgeDistance(edge: THREE.Texture): GF {
  const { k, c } = edgeFieldUv(EDGE_FIELD_RES);
  return texture(edge, uv().mul(k).add(c)).r.mul(EDGE_MAX_M - EDGE_MIN_M).add(EDGE_MIN_M) as unknown as GF;
}

/**
 * Masque routier du terrain près des routes dessinées : leur vrai bord (fondu de 30 cm vers l'intérieur) à moins de
 * 3 à 4,5 m d'une route dessinée, le raster (`raster`, ≈ 4 m) ailleurs (chemins non dessinés) ; raster seul au loin.
 */
function edgeTerrainRoadMask(d: GF, raster: GF, camDist: GF): GF {
  const one = float(1);
  const drawn = one.sub(smoothstep(-0.3, 0.05, d));
  const nearDrawn = one.sub(smoothstep(3, 4.5, d));
  const precise = drawn.max(raster.mul(one.sub(nearDrawn)));
  return mix(raster, precise, one.sub(smoothstep(150, 300, camDist))) as unknown as GF;
}

/**
 * Accotement (P2.2b) : de 0 à environ 0,8 m du bord, terre tassée (teinte du sol locale désaturée et brunie) avec
 * gravillons très fins ; fondu léger jusqu'à environ 2,5 m ; contour irrégulier (bruits de 1,7 m et 50 cm, ±35 cm).
 * Moins marqué en zone bâtie, rien sur l'eau, la neige et la glace, effacé de 80 à 160 m. Bruits calculés seulement
 * à moins de 3,2 m d'un bord et de 160 m de la caméra. Teinte moyenne plus sombre que le sol : pas de liseré clair.
 */
function roadShoulder(col: GV3, d: GF, p: { water: GF; urban: GF; snow: GF; ice: GF; camDist: GF }): { col: GV3; rough: GF } {
  const one = float(1);
  const nearK = one.sub(smoothstep(80, 160, p.camDist));
  const keep = one.sub(p.water).mul(one.sub(p.snow.max(p.ice))).mul(one.sub(p.urban.mul(0.6)));
  const gate = nearK.mul(keep).mul(one.sub(smoothstep(3, 3.2, d))).mul(smoothstep(-0.6, -0.3, d));
  const out = Fn(() => {
    const o = vec4(col, 0).toVar();
    If(gate.greaterThan(0.001), () => {
      const wp = positionWorld.xz;
      const wobble = mx_noise_float(wp.mul(0.6)).mul(0.5).add(mx_noise_float(wp.mul(2.1)).mul(0.25));
      const de = d.add(wobble.mul(0.9));
      const core = one.sub(smoothstep(0.5, 1.3, de));
      const fade = one.sub(smoothstep(1.1, 2.6, de));
      const lum = dot(col, vec3(0.299, 0.587, 0.114));
      // terre tassée : teinte locale désaturée et brunie ; frange de gravillons gris fins contre l'enrobé (0 à 0,4 m)
      const earth = mix(vec3(lum, lum, lum), col, 0.4).mul(vec3(0.84, 0.78, 0.7));
      const gravel = vec3(lum, lum, lum).mul(vec3(0.93, 0.89, 0.83));
      const nearAsphalt = one.sub(smoothstep(0.05, 0.45, de));
      const fadeTone = col.mul(vec3(0.96, 0.93, 0.88));
      // grains clairs et sombres de 3 à 6 cm (gravillons), seulement de près, plus serrés dans la frange
      const g = mx_noise_float(wp.mul(16));
      const fineK = one.sub(smoothstep(6, 20, p.camDist));
      const gritAmp = mix(float(1), float(1.6), nearAsphalt);
      const grit = smoothstep(0.25, 0.42, g).mul(0.2).sub(smoothstep(-0.42, -0.25, g).mul(0.18)).mul(gritAmp).mul(fineK).add(1);
      // gravillons par plaques (là où l'accotement s'élargit), pas en liseré continu
      const gravelAmt = nearAsphalt.mul(smoothstep(0.2, -0.15, wobble)).mul(0.55);
      const shoulderCol = mix(earth, gravel, gravelAmt).mul(grit);
      const w = core.mul(0.9).mul(gate);
      const withFade = mix(col, fadeTone, fade.mul(0.6).mul(gate));
      o.assign(vec4(mix(withFade, shoulderCol, w), w.max(fade.mul(0.3).mul(gate))));
    });
    return o;
  })();
  return { col: out.xyz as unknown as GV3, rough: out.w.mul(0.03) as unknown as GF };
}

const ROAD_TERRAIN_BELOW = 0.04;
const ROAD_TUNNEL_AXIS = 2.5;
const ROAD_TUNNEL_COVER = 5;
/** Sous un trottoir (bordure de 12 cm, voir sidewalks.ts), le sol peut monter jusqu'à ceci au-dessus de la chaussée. */
const SIDEWALK_GROUND_M = 0.06;

/**
 * Abaisse les sommets de la grille (positions locales, centrées sur la tuile) qui portent un triangle
 * sous une route de la tuile : à moins de demi-largeur + bas-côté (0,6 m, voir network.ts) + `reach`
 * de son axe, le sol passe juste sous la route à cet endroit. Seuls les sommets du rectangle englobant
 * de chaque tronçon sont visités.
 */
export function clampUnderRoads(pos: Float32Array, tile: LoadedTile, seg: number, reach: number, axisGround: (x: number, z: number) => number): void {
  const s = tile.size;
  const step = s / seg;
  const row = seg + 1;
  /** Projection (non bornée) de (x, z) sur le segment du point `a` au point `b` de la polyligne (indices ×3). */
  const proj = (p: number[], a: number, b: number, x: number, z: number) => {
    const dx = (p[b] as number) - (p[a] as number);
    const dz = (p[b + 2] as number) - (p[a + 2] as number);
    return ((x - (p[a] as number)) * dx + (z - (p[a + 2] as number)) * dz) / (dx * dx + dz * dz || 1);
  };
  /**
   * Parcourt les sommets de grille à moins de `radius` m de la route, au point de la route qui leur fait face :
   * projection à l'intérieur du segment, ou angle extérieur d'un virage (au-delà de la fin d'un segment et avant
   * le début du suivant), ou bout de la polyligne. Le bout d'un segment voisin ne compte pas : sur une rue en
   * pente (13 % dans le village de Donnemarie), il donnait au sol le niveau de la route 10 à 14 m plus bas, et
   * le sol affiché passait 1,5 m sous la chaussée. Un lacet qui repasse à portée fait face au sommet : il compte.
   */
  const around = (p: number[], radiusOf: (k: number) => number, visit: (kk: number, d: number, y: number, k: number) => void) => {
    const last = p.length - 6;
    for (let k = 0; k + 5 < p.length; k += 3) {
      const radius = radiusOf(k);
      const ax = p[k] as number, ay = p[k + 1] as number, az = p[k + 2] as number;
      const bx = p[k + 3] as number, by = p[k + 4] as number, bz = p[k + 5] as number;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - radius - tile.x0) / step));
      const i1 = Math.min(seg, Math.ceil((Math.max(ax, bx) + radius - tile.x0) / step));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - radius - tile.z0) / step));
      const j1 = Math.min(seg, Math.ceil((Math.max(az, bz) + radius - tile.z0) / step));
      if (i0 > i1 || j0 > j1) continue;
      const dx = bx - ax, dz = bz - az;
      const len2 = dx * dx + dz * dz || 1;
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const x = tile.x0 + i * step, z = tile.z0 + j * step;
          const tRaw = ((x - ax) * dx + (z - az) * dz) / len2;
          if (tRaw < 0 && k > 0 && proj(p, k - 3, k, x, z) < 1) continue;
          if (tRaw > 1 && k < last && proj(p, k + 3, k + 6, x, z) > 0) continue;
          const t = Math.min(1, Math.max(0, tRaw));
          const ex = ax + dx * t - x, ez = az + dz * t - z;
          const d2 = ex * ex + ez * ez;
          if (d2 > radius * radius) continue;
          visit((j * row + i) * 3 + 1, Math.sqrt(d2), ay + (by - ay) * t, k);
        }
    }
  };
  /** Point de la route en face d'un sommet de grille. `road` : un de ses triangles passe sous la chaussée même. */
  interface Cover {
    kk: number;
    y: number;
    axX: number;
    axZ: number;
    d: number;
    road: boolean;
  }
  /**
   * Sommets des triangles de la grille qui touchent la route (demi-largeur `wRoad`) ou ses trottoirs (`wWide`), avec
   * le niveau de la route en face de chacun (le plus bas des passages qui lui font face, voir `around`). Un sommet ne
   * porte la route que si l'un de ses triangles passe sous elle : le rayon « demi-largeur + une maille en diagonale »
   * d'avant prenait aussi les sommets voisins, et entre deux rues parallèles à des niveaux différents, la plus basse
   * tirait sous elle le sol de l'autre sur toute une maille.
   */
  // Par sommet : premier et dernier segment qui l'ont atteint, s'il porte la chaussée, et la route qui l'a vu en
  // dernier (`stamp`) ; tableaux partagés par toutes les routes de la tuile.
  const nVert = row * row;
  const hitK0 = new Int32Array(nVert);
  const hitK1 = new Int32Array(nVert);
  const hitRoad = new Uint8Array(nVert);
  const stamp = new Int32Array(nVert).fill(-1);
  let pass = 0;
  const covering = (p: number[], wRoad: number, wWide: (k: number) => number): Cover[] => {
    const id = pass++;
    const touched: number[] = [];
    const tx = [0, 0, 0];
    const tz = [0, 0, 0];
    const corner = [0, 0, 0, 0];
    const R = (step * Math.SQRT2) / 2;
    let reachMax = wRoad;
    for (let k = 0; k + 5 < p.length; k += 3) {
      const ax = p[k] as number, az = p[k + 2] as number;
      const bx = p[k + 3] as number, bz = p[k + 5] as number;
      const w = Math.max(wRoad, wWide(k));
      reachMax = Math.max(reachMax, w);
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - w - tile.x0) / step) - 1);
      const i1 = Math.min(seg - 1, Math.floor((Math.max(ax, bx) + w - tile.x0) / step) + 1);
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - w - tile.z0) / step) - 1);
      const j1 = Math.min(seg - 1, Math.floor((Math.max(az, bz) + w - tile.z0) / step) + 1);
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const x0 = tile.x0 + i * step, z0 = tile.z0 + j * step;
          // Tri rapide : distance du segment au centre de la maille (cercle circonscrit de rayon R).
          const dc = pointToSegment(x0 + step / 2, z0 + step / 2, ax, az, bx, bz);
          if (dc > w + R) continue;
          // Distance de chaque coin de la maille au segment : un triangle dont un coin est dans la bande la touche.
          for (let c = 0; c < 4; c++) corner[c] = pointToSegment(x0 + (c & 1) * step, z0 + (c >> 1) * step, ax, az, bx, bz);
          // Maille (i, j) : triangles (a, c, b) et (b, c, d), comme l'index de la grille.
          for (const tri of CELL_TRIANGLES) {
            let near = Infinity;
            for (let v = 0; v < 3; v++) {
              tx[v] = x0 + (tri[v * 2] as number) * step;
              tz[v] = z0 + (tri[v * 2 + 1] as number) * step;
              near = Math.min(near, corner[(tri[v * 2] as number) + (tri[v * 2 + 1] as number) * 2] as number);
            }
            if (near > w && !triangleNearSegment(tx, tz, ax, az, bx, bz, w)) continue;
            const road = w === wRoad || near <= wRoad || (dc <= wRoad + R && triangleNearSegment(tx, tz, ax, az, bx, bz, wRoad));
            for (let v = 0; v < 3; v++) {
              const idx = (j + (tri[v * 2 + 1] as number)) * row + i + (tri[v * 2] as number);
              if (stamp[idx] !== id) {
                stamp[idx] = id;
                hitK0[idx] = k;
                hitK1[idx] = k;
                hitRoad[idx] = road ? 1 : 0;
                touched.push(idx);
              } else {
                hitK1[idx] = k;
                if (road) hitRoad[idx] = 1;
              }
            }
          }
        }
    }
    const last = p.length - 6;
    const radius = reachMax + step * Math.SQRT2 + 0.1;
    const out: Cover[] = [];
    for (const idx of touched) {
      const x = tile.x0 + (idx % row) * step, z = tile.z0 + Math.floor(idx / row) * step;
      let best: Cover | null = null;
      for (let k = Math.max(0, (hitK0[idx] as number) - 6); k <= Math.min(last, (hitK1[idx] as number) + 6); k += 3) {
        const tRaw = proj(p, k, k + 3, x, z);
        if (tRaw < 0 && k > 0 && proj(p, k - 3, k, x, z) < 1) continue;
        if (tRaw > 1 && k < last && proj(p, k + 3, k + 6, x, z) > 0) continue;
        const t = Math.min(1, Math.max(0, tRaw));
        const px = (p[k] as number) + ((p[k + 3] as number) - (p[k] as number)) * t;
        const pz = (p[k + 2] as number) + ((p[k + 5] as number) - (p[k + 2] as number)) * t;
        const d = Math.sqrt((px - x) * (px - x) + (pz - z) * (pz - z));
        if (d > radius) continue;
        const y = (p[k + 1] as number) + ((p[k + 4] as number) - (p[k + 1] as number)) * t;
        if (!best || y < best.y) best = { kk: idx * 3 + 1, y, axX: px, axZ: pz, d, road: hitRoad[idx] === 1 };
      }
      if (best) out.push(best);
    }
    return out;
  };
  const roads = tile.features.roads.filter((r) => r.pts3 && !r.tunnel && (r.pts3 as number[]).length >= 6);
  const built = builtCells(tile.features.buildings);
  const halfOf = (r: (typeof roads)[number]) => Math.max(r.width, 2.5) / 2 + 0.6;
  // En ville (bâtiment à moins de 16 à 32 m du milieu du segment, indice k / 3) : place pour des trottoirs.
  const town = roads.map((r) => {
    const p = r.pts3 as number[];
    const out: boolean[] = [];
    for (let k = 0; k + 5 < p.length; k += 3) out.push(isBuiltUp(built, ((p[k] as number) + (p[k + 3] as number)) / 2, ((p[k + 2] as number) + (p[k + 5] as number)) / 2));
    return out;
  });
  // Sommets portés par chaque route : sous sa chaussée et son bas-côté, plus ses trottoirs en ville.
  const covers = roads.map((r, ri) => {
    const half = halfOf(r);
    return covering(r.pts3 as number[], half, (k) => half + ((town[ri] as boolean[])[k / 3] ? SIDEWALK_MAX_M : 0));
  });
  // 1. Remblai : un sol trop bas est remonté au niveau de la route sous la chaussée, son bas-côté et, en ville,
  //    ses trottoirs, puis descend en talus. La grille est grossière (4,5 à 10 m) : remblayée sur 4 à 5 m de l'axe
  //    seulement, comme avant, la pente d'un village à flanc de coteau (sol 1 à 3 m plus bas à 10 m) tirait le sol
  //    affiché 1 à 2 m sous la route : chaussée, bas-côtés et trottoirs flottaient, avec une marche à leur bord.
  //    Ni ponts, ni dénivelé de plus de 8 m (viaduc).
  roads.forEach((r, ri) => {
    if (r.bridge) return;
    const half = halfOf(r);
    // Talus en pente douce (≈ 1 pour 2,5) sur 14 m, au lieu d'un mur à 45° : la route se raccorde au terrain par une
    // pente, sans marche ni vide sous son bord (elle ne semble plus voler au-dessus du sol).
    const seg3 = town[ri] as boolean[];
    around(r.pts3 as number[], (k) => half + (seg3[k / 3] ? SIDEWALK_MAX_M : 0) + 14, (kk, d, y, k) => {
      const h = pos[kk] as number;
      const top = y - ROAD_TERRAIN_BELOW - 0.02;
      if (h >= top || top - h > 8) return;
      const flat = half + (seg3[k / 3] ? SIDEWALK_MAX_M : 0);
      const target = top - Math.max(0, d - flat) * 0.4;
      if (target > h) pos[kk] = target;
    });
    for (const c of covers[ri] as Cover[]) {
      const h = pos[c.kk] as number;
      const top = c.y - ROAD_TERRAIN_BELOW - 0.02;
      if (h < top && top - h <= 8) pos[c.kk] = top;
    }
  });
  // 2. Sous la chaussée : sol abaissé juste sous la route (après le remblai, il l'emporte toujours ; le talus
  //    d'une route voisine, dans les lacets, ne peut pas recouvrir une chaussée). Seuls les sommets dont un triangle
  //    passe sous la route (ou sous ses trottoirs, en ville : juste sous la dalle) sont abaissés, au niveau de la
  //    route en face d'eux. Entre deux rues de niveaux différents (rue qui longe en contrebas, au départ de
  //    Donnemarie), un sommet sous la chaussée d'une rue garde le niveau de celle-ci : le plus bas toujours, comme
  //    avant, faisait flotter toute la rue du haut (jusqu'à 2 m avec la maille de 7,8 m).
  /** Par sommet : niveau exigé par chaque route qui le porte, distance à sa chaussée (m, ≤ 0 dessous). */
  const claims = new Map<number, Array<{ y: number; e: number }>>();
  roads.forEach((r, ri) => {
    const half = halfOf(r);
    for (const c of covers[ri] as Cover[]) {
      const h = pos[c.kk] as number;
      // Talus d'une tranchée : abaissé même s'il monte vite (sinon il recouvre le bord de la route).
      const g = axisGround(c.axX, c.axZ);
      // Itinéraire roulé : jamais pris pour un tunnel (seule l'étiquette OSM compte) ; une tranchée profonde
      // (côte en lacets) laissait le sol au-dessus de la chaussée et le vélo enterré.
      if (!r.route && (Number.isFinite(g) ? g - c.y > ROAD_TUNNEL_AXIS : h - c.y > ROAD_TUNNEL_COVER)) continue;
      const claim = { y: c.road ? c.y : c.y + SIDEWALK_GROUND_M, e: c.d - (half - 0.6) };
      const list = claims.get(c.kk);
      if (list) list.push(claim);
      else claims.set(c.kk, [claim]);
    }
  });
  for (const [kk, list] of claims) {
    // Sous la chaussée ou le bas-côté d'une ou plusieurs routes : la plus basse d'entre elles. Ailleurs (talus entre
    // deux rues de niveaux différents) : la plus basse de toutes, pour ne jamais recouvrir une chaussée.
    let under = Infinity;
    let any = Infinity;
    for (const c of list) {
      any = Math.min(any, c.y);
      if (c.e <= 0.6) under = Math.min(under, c.y);
    }
    pos[kk] = Math.min(pos[kk] as number, (Number.isFinite(under) ? under : any) - ROAD_TERRAIN_BELOW);
  }
}

/** Distance (plan x, z) du point (px, pz) au segment (a, b). */
function pointToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const t = Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  const ex = ax + dx * t - px, ez = az + dz * t - pz;
  return Math.sqrt(ex * ex + ez * ez);
}

/** Triangles d'une maille de la grille, en décalages (i, j) de ses trois sommets : (a, c, b) et (b, c, d). */
const CELL_TRIANGLES = [
  [0, 0, 0, 1, 1, 0],
  [1, 0, 0, 1, 1, 1],
] as const;

/** Produit vectoriel (plan x, z) de (2 − 1) par (3 − 1). */
function cross2(x1: number, z1: number, x2: number, z2: number, x3: number, z3: number): number {
  return (x2 - x1) * (z3 - z1) - (z2 - z1) * (x3 - x1);
}

/** (x, z) est dans le triangle (tx, tz), bords compris. */
function insideTriangle(tx: readonly number[], tz: readonly number[], x: number, z: number): boolean {
  const c0 = cross2(tx[0] as number, tz[0] as number, tx[1] as number, tz[1] as number, x, z);
  const c1 = cross2(tx[1] as number, tz[1] as number, tx[2] as number, tz[2] as number, x, z);
  const c2 = cross2(tx[2] as number, tz[2] as number, tx[0] as number, tz[0] as number, x, z);
  return !((c0 > 0 || c1 > 0 || c2 > 0) && (c0 < 0 || c1 < 0 || c2 < 0));
}

/** Le triangle (tx, tz) passe à moins de `w` du segment (a, b), dans le plan x, z (intersection comprise). */
export function triangleNearSegment(tx: readonly number[], tz: readonly number[], ax: number, az: number, bx: number, bz: number, w: number): boolean {
  if (insideTriangle(tx, tz, ax, az) || insideTriangle(tx, tz, bx, bz)) return true;
  for (let e = 0; e < 3; e++) {
    const x1 = tx[e] as number, z1 = tz[e] as number, x2 = tx[(e + 1) % 3] as number, z2 = tz[(e + 1) % 3] as number;
    // Arête coupée par le segment, ou à moins de `w`.
    if (cross2(ax, az, bx, bz, x1, z1) * cross2(ax, az, bx, bz, x2, z2) < 0 && cross2(x1, z1, x2, z2, ax, az) * cross2(x1, z1, x2, z2, bx, bz) < 0) return true;
    if (pointToSegment(ax, az, x1, z1, x2, z2) <= w || pointToSegment(bx, bz, x1, z1, x2, z2) <= w || pointToSegment(x1, z1, ax, az, bx, bz) <= w) return true;
  }
  return false;
}

/**
 * Altitude de la surface affichée d'une tuile (triangles de la grille, même diagonale que l'index de
 * buildGeometry) ; NaN si la géométrie n'est pas une grille de tuile.
 */
function meshHeight(geo: THREE.BufferGeometry, tile: LoadedTile, x: number, z: number): number {
  const seg = geo.userData.seg as number | undefined;
  const pos = geo.getAttribute('position')?.array as Float32Array | undefined;
  if (!seg || !pos) return Number.NaN;
  const u = Math.min(Math.max(((x - tile.x0) / tile.size) * seg, 0), seg - 1e-6);
  const v = Math.min(Math.max(((z - tile.z0) / tile.size) * seg, 0), seg - 1e-6);
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fu = u - i;
  const fv = v - j;
  const row = seg + 1;
  const H = (ii: number, jj: number) => pos[(jj * row + ii) * 3 + 1] as number;
  const ha = H(i, j);
  const hb = H(i + 1, j);
  const hc = H(i, j + 1);
  const hd = H(i + 1, j + 1);
  return fu + fv <= 1 ? ha + (hb - ha) * fu + (hc - ha) * fv : hd + (hc - hd) * (1 - fu) + (hb - hd) * (1 - fv);
}
