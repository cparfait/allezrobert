import * as THREE from 'three/webgpu';
import { texture, uv, normalWorld, positionWorld, mix, smoothstep, vec2, vec3, float, uniform, mx_noise_float, clamp } from 'three/tsl';
import type { QualitySettings } from '../engine/quality.ts';
import { colorUniform } from '../engine/tsl.ts';
import { SPLAT_CHANNELS, type LoadedTile, type WorldSource } from './types.ts';
import { rasterizeSplat } from './splat.ts';
import { WorkQueue } from './workQueue.ts';
import type { RouteFootprint } from './ribbon.ts';
import type { Season } from './environment.ts';
import { ALPINE_GROUND_M, ALPINE_MEADOW, SNOW_LINE_M, alpineProfile } from './alpine.ts';

/** Couleurs du sol par saison (voir ART_DIRECTION.md). */
const SEASON_GROUND: Record<Season, { forest: string; field: string; field2: string; meadow: string; urban: string; dirt: string }> = {
  spring: { forest: '#4d5a2c', field: '#8a9a4b', field2: '#d9c93a', meadow: '#7fa448', urban: '#8f8c78', dirt: '#7a6a4c' },
  summer: { forest: '#45512a', field: '#d8b86a', field2: '#c79d4f', meadow: '#7d9245', urban: '#938d78', dirt: '#86704c' },
  autumn: { forest: '#6b4f2a', field: '#7b6a4a', field2: '#9a8a5a', meadow: '#7c8a44', urban: '#8a8270', dirt: '#6f5a3e' },
  winter: { forest: '#4a463a', field: '#8f8a6e', field2: '#a7a38c', meadow: '#7d7f62', urban: '#8a8a82', dirt: '#6a6052' },
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
  private readonly loader = new THREE.TextureLoader();
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
    const c = SEASON_GROUND[season];
    for (const k of Object.keys(c) as Array<keyof typeof c>) this.seasonColors[k].set(c[k]);
    this.frost.value = season === 'winter' ? 0.25 : 0;
    this.snowLine.value = SNOW_LINE_M[season];
    this.alpineMeadow.set(ALPINE_MEADOW[season]);
    const tint: Record<Season, [string, number]> = { spring: ['#f4fff0', 1.05], summer: ['#fffbf2', 1], autumn: ['#fbead2', 0.9], winter: ['#dde2e6', 0.5] };
    this.orthoTint.set(tint[season][0]);
    this.orthoSat.value = tint[season][1];
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
  heightAt(x: number, z: number): number {
    const [tx, tz] = this.tileCoord(x, z);
    const e = this.tiles.get(`${tx}_${tz}`);
    if (!e) return Number.NaN;
    const t = e.tile;
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
  async update(focus: THREE.Vector3): Promise<void> {
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
            }, this.distTo(tx, tz));
        } else if (!this.loading.has(key)) {
          this.loading.add(key);
          jobs.push(
            this.fetchTile(tx, tz)
              .then((tile) => {
                // Construction différée : la tuile n'est plus voulue (coureur rapide) ou déjà là, on passe.
                if (tile)
                  this.work.defer(() => {
                    if (!this.tiles.has(key) && this.wanted.has(key)) this.add(tile, this.lodAt(tx, tz));
                  }, this.distTo(tx, tz));
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
    if (tile.orthoUrl) {
      // Orthophoto IGN : chargée en arrière-plan, le matériau la prend en compte dès réception.
      ortho = this.loader.load(tile.orthoUrl, undefined, undefined, () => undefined);
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
    const index: number[] = [];
    for (let j = 0; j < seg; j++)
      for (let i = 0; i < seg; i++) {
        const a = j * vertsPerRow + i;
        const b = a + 1;
        const c = a + vertsPerRow;
        const d = c + 1;
        index.push(a, c, b, b, c, d);
      }
    // Jupe : contour de la grille parcouru dans le sens horaire, dupliqué 6 m plus bas.
    const border: number[] = [];
    for (let i = 0; i < seg; i++) border.push(i);
    for (let j = 0; j < seg; j++) border.push(j * vertsPerRow + seg);
    for (let i = seg; i > 0; i--) border.push(seg * vertsPerRow + i);
    for (let j = seg; j > 0; j--) border.push(j * vertsPerRow);
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
      index.push(a, b, a2, b, b2, a2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }

  private splatTextures(tile: LoadedTile): THREE.DataTexture[] {
    const { res, data } = tile.splat as { res: number; data: Uint8Array };
    const a = new Uint8Array(res * res * 4);
    const b = new Uint8Array(res * res * 4);
    const C = SPLAT_CHANNELS.length;
    for (let i = 0; i < res * res; i++) {
      a[i * 4] = data[i * C] as number;
      a[i * 4 + 1] = data[i * C + 1] as number;
      a[i * 4 + 2] = data[i * C + 2] as number;
      a[i * 4 + 3] = data[i * C + 3] as number;
      b[i * 4] = data[i * C + 4] as number;
      b[i * 4 + 1] = data[i * C + 5] as number;
      b[i * 4 + 2] = data[i * C + 6] as number;
      b[i * 4 + 3] = data[i * C + 7] as number;
    }
    return [a, b].map((buf) => {
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
      col = mix(col, seasonal, float(0.72).mul(float(1).sub(roadMask)).mul(float(1).sub(verge.mul(0.8))));
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
    m.colorNode = col;
    const rough = mix(float(0.95), float(0.55), roadMask);
    m.roughnessNode = clamp(rough.sub(this.wetness.mul(0.45)).sub(s0.a.mul(0.6)).sub(ice.mul(0.4)).sub(snow.mul(0.25)), 0.08, 1);
    m.metalnessNode = float(0);
    return m;
  }
}
