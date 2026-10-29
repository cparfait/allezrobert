import * as THREE from 'three/webgpu';
import { texture, uv, normalWorld, positionWorld, mix, smoothstep, vec2, vec3, float, uniform, mx_noise_float, clamp } from 'three/tsl';
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

  constructor(source: WorldSource, q: QualitySettings, season: Season) {
    this.source = source;
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
    for (const e of this.tiles.values()) e.lod = -1; // forcer la reconstruction à la prochaine mise à jour
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
    const material = this.createMaterial(textures, ortho);
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
    const seg = Math.max(16, Math.min(this.q.terrainSegmentsPerTile >> lod, tile.n * 2));
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

  private createMaterial(textures: THREE.DataTexture[], ortho: THREE.Texture | null): THREE.MeshStandardNodeMaterial {
    if (LOW_POLY) return this.createLowPolyMaterial(textures);
    const m = new THREE.MeshStandardNodeMaterial();
    const s0 = texture(textures[0] as THREE.Texture, uv());
    const s1 = texture(textures[1] as THREE.Texture, uv());
    const c = this.seasonColors;
    const wp = positionWorld.xz;
    // Variations à plusieurs échelles pour casser les aplats (taches de cultures, herbe).
    const n1 = mx_noise_float(wp.mul(0.004)).mul(0.5).add(0.5);
    const n2 = mx_noise_float(wp.mul(0.035)).mul(0.5).add(0.5);
    const n3 = mx_noise_float(wp.mul(0.4)).mul(0.5).add(0.5);
    const detail = n2.mul(0.18).add(n3.mul(0.12)).add(0.82);

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
    const asphalt = vec3(0.16, 0.165, 0.175);

    let col = meadow;
    col = mix(col, field.mul(furrow), s0.g);
    col = mix(col, meadow, s0.b);
    col = mix(col, forestFloor, s0.r);
    // zones bâties : jardins et cours, l'orthophoto en donne le détail (teinte modérée)
    col = mix(col, urban, s1.r.mul(0.55));
    // abords de l'itinéraire : herbe des bas-côtés
    col = mix(col, meadow, smoothstep(0.2, 0.8, s1.b).mul(0.85));
    col = mix(col, water, s0.a);
    col = mix(col, asphalt, smoothstep(0.35, 0.75, s1.g));
    // Pentes fortes : terre et pierre apparentes.
    const slope = float(1).sub(normalWorld.y);
    col = mix(col, c.dirt.node, smoothstep(0.3, 0.55, slope).mul(0.6));
    if (ortho) {
      // Orthophoto : vrais motifs de parcelles, haies, villages ; teinte saisonnière ; le détail
      // procédural reste visible de près. La chaussée garde le rendu asphalte.
      const photo = texture(ortho, uv()).rgb;
      const lum = photo.dot(vec3(0.299, 0.587, 0.114));
      const seasonal = mix(vec3(lum, lum, lum), photo, this.orthoSat).mul(this.orthoTint.node).mul(1.08);
      const roadMask = smoothstep(0.35, 0.75, s1.g);
      // abords de l'itinéraire : la chaussée floue de la photo ne déborde pas sur les bas-côtés
      const verge = smoothstep(0.2, 0.8, s1.b);
      col = mix(col, seasonal, float(ORTHO_WEIGHT).mul(float(1).sub(roadMask)).mul(float(1).sub(verge.mul(0.8))));
    }
    // Montagne : roche grise sur les fortes pentes (plus tôt en altitude), au-dessus de la limite
    // des arbres et sur les éboulis OSM ; glace sur les glaciers ; neige selon la saison. Appliqué
    // après l'orthophoto (prise en été), atténué quand elle montre déjà la roche.
    const ice = smoothstep(0.7, 0.9, s1.a);
    const scree = smoothstep(0.15, 0.4, s1.a).mul(float(1).sub(ice));
    const roadMask = smoothstep(0.35, 0.75, s1.g);
    // (pas en plaine : talus des routes creusées et berges y restent en terre ; talus de
    // l'itinéraire surtout herbeux)
    const steep = smoothstep(mix(float(0.4), float(0.24), alpine), mix(float(0.6), float(0.44), alpine), slope)
      .mul(smoothstep(250, 600, alt))
      .mul(float(1).sub(smoothstep(0.2, 0.8, s1.b).mul(0.7)));
    const highRock = smoothstep(this.treeline.add(100), this.treeline.add(700), alt).mul(0.6).mul(n1.mul(0.6).add(0.6));
    const rockMask = clamp(steep.max(highRock).max(scree), 0, 1).mul(float(1).sub(roadMask));
    // Roche : strates et taches (bruit étiré), éboulis plus clairs et grenus.
    const strata = mx_noise_float(vec3(wp.x.mul(0.05), alt.mul(0.35), wp.y.mul(0.05))).mul(0.12).add(1);
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
    // Pluie : sol plus sombre ; givre : voile clair sur les surfaces planes.
    col = col.mul(float(1).sub(this.wetness.mul(0.35)));
    col = mix(col, vec3(0.86, 0.9, 0.93), this.frost.mul(smoothstep(0.85, 0.98, normalWorld.y)).mul(n2));
    col = mix(col, vec3(0.9, 0.93, 0.96).mul(n3.mul(0.06).add(0.96)), snow.mul(0.95));
    // Ombres des nuages qui passent (clouds.ts).
    m.colorNode = col.mul(cloudShade());
    const rough = mix(float(0.95), float(0.55), roadMask);
    m.roughnessNode = clamp(rough.sub(this.wetness.mul(0.45)).sub(s0.a.mul(0.6)).sub(ice.mul(0.4)).sub(snow.mul(0.25)), 0.08, 1);
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
const ROAD_TERRAIN_BELOW = 0.04;
const ROAD_TUNNEL_AXIS = 2.5;
const ROAD_TUNNEL_COVER = 5;

/**
 * Abaisse les sommets de la grille (positions locales, centrées sur la tuile) qui portent un triangle
 * sous une route de la tuile : à moins de demi-largeur + bas-côté (0,6 m, voir network.ts) + `reach`
 * de son axe, le sol passe juste sous la route à cet endroit. Seuls les sommets du rectangle englobant
 * de chaque tronçon sont visités.
 */
function clampUnderRoads(pos: Float32Array, tile: LoadedTile, seg: number, reach: number, axisGround: (x: number, z: number) => number): void {
  const s = tile.size;
  const step = s / seg;
  const row = seg + 1;
  /** Parcourt les sommets de grille à moins de `radius` m de chaque segment de la route. */
  const around = (p: number[], radius: number, visit: (kk: number, d: number, y: number, axX: number, axZ: number) => void) => {
    for (let k = 0; k + 5 < p.length; k += 3) {
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
          const t = Math.min(1, Math.max(0, tRaw));
          const ex = ax + dx * t - x, ez = az + dz * t - z;
          const d2 = ex * ex + ez * ez;
          if (d2 > radius * radius) continue;
          visit((j * row + i) * 3 + 1, Math.sqrt(d2), ay + (by - ay) * t, ax + dx * t, az + dz * t);
        }
    }
  };
  const roads = tile.features.roads.filter((r) => r.pts3 && !r.tunnel && (r.pts3 as number[]).length >= 6);
  // 1. Remblai : sous la chaussée et son accotement, un sol trop bas est remonté au niveau de la route, puis
  //    descend en talus à 45° (6 m au plus) : plus de marche au bord d'une route à flanc de pente ou sur une
  //    digue, ni de route qui flotte entre deux sommets de la grille grossière (8 m) au loin. Ni ponts, ni
  //    dénivelé de plus de 6 m (viaduc).
  for (const r of roads) {
    if (r.bridge) continue;
    const shoulder = Math.max(Math.max(r.width, 2.5) / 2 + 0.8, step * 0.6);
    around(r.pts3 as number[], shoulder + 6, (kk, d, y) => {
      const h = pos[kk] as number;
      const top = y - ROAD_TERRAIN_BELOW - 0.02;
      if (h >= top || top - h > 6) return;
      const target = d <= shoulder ? top : top - (d - shoulder);
      if (target > h) pos[kk] = target;
    });
  }
  // 2. Sous la chaussée : sol abaissé juste sous la route (après le remblai, il l'emporte toujours ; le talus
  //    d'une route voisine, dans les lacets, ne peut pas recouvrir une chaussée).
  for (const r of roads) {
    const R = Math.max(r.width, 2.5) / 2 + 0.6 + reach;
    around(r.pts3 as number[], R, (kk, _d, y, axX, axZ) => {
      const h = pos[kk] as number;
      // Talus d'une tranchée : abaissé même s'il monte vite (sinon il recouvre le bord de la route).
      const g = axisGround(axX, axZ);
      // Itinéraire roulé : jamais pris pour un tunnel (seule l'étiquette OSM compte) ; une tranchée profonde
      // (côte en lacets) laissait le sol au-dessus de la chaussée et le vélo enterré.
      if (!r.route && (Number.isFinite(g) ? g - y > ROAD_TUNNEL_AXIS : h - y > ROAD_TUNNEL_COVER)) return;
      pos[kk] = Math.min(h, y - ROAD_TERRAIN_BELOW);
    });
  }
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
