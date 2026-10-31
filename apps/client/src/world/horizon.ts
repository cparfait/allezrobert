import * as THREE from 'three/webgpu';
import { LOW_POLY } from '../engine/style.ts';
import { Fn, positionLocal, normalWorld, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, vec2, vec3, vec4, float, mix, smoothstep, uniform, mx_noise_float, exp, clamp, output, texture } from 'three/tsl';
import { colorUniform } from '../engine/tsl.ts';
import type { QualitySettings } from '../engine/quality.ts';
import type { Season } from './environment.ts';
import type { HorizonGrid, WorldSource } from './types.ts';
import { ALPINE_GROUND_M, ALPINE_MEADOW, SNOW_LINE_M, type AlpineProfile } from './alpine.ts';
import { ORTHO_SEASON, ORTHO_WEIGHT } from './terrain.ts';

/** Rayon terrestre apparent (réfraction comprise, k ≈ 0,13) : le relief lointain s'abaisse sous l'horizon. */
const EARTH_R = 6371000 / (1 - 0.13);
/**
 * Profondeur écrite par le relief lointain : juste devant le ciel (z = w), derrière tout le reste
 * dans la distance de vue. Le maillage n'est jamais découpé par le plan lointain de la caméra.
 */
const FAR_DEPTH = 1 - 1e-6;
/** Couleurs du relief lointain (forêts et prés vus de loin) par saison. */
const LOWLAND: Record<Season, [string, string]> = {
  spring: ['#34462a', '#5f7a3c'],
  summer: ['#30422a', '#5c703a'],
  autumn: ['#4b4a2c', '#6e6e3e'],
  winter: ['#3d3d34', '#66675a'],
};
/** Style jeu vidéo : forêts et prés lointains plus clairs et plus verts. */
const LOWLAND_LOWPOLY: Record<Season, [string, string]> = {
  spring: ['#3c6e2c', '#78b04a'],
  summer: ['#3a6a2a', '#80b04c'],
  autumn: ['#4f7a30', '#8cb84e'],
  winter: ['#4a6a40', '#94b46e'],
};

/**
 * Relief lointain (ligne d'horizon des montagnes, world.json `horizon`) : un maillage grossier
 * (100 m) de ±30 km autour du monde, éclairé par le soleil, noyé dans une brume plus légère que
 * celle du premier plan (perspective aérienne bleutée). Il est dessiné au-delà du plan lointain de
 * la caméra et masqué là où les tuiles détaillées sont chargées.
 */
export class FarTerrain {
  readonly mesh: THREE.Mesh;
  /** Brume (couleur et densité de la scène) et teinte du ciel, recopiées à chaque image. */
  readonly fogColor = colorUniform('#dfe8ef');
  readonly fogDensity = uniform(0.00012);
  readonly skyColor = colorUniform('#9cc3ec');
  /** Teinte de la brume vers le soleil et direction du soleil, comme la brume de la scène (fog.ts). */
  readonly fogSunColor = colorUniform('#dfe8ef');
  readonly sunDir = uniform(new THREE.Vector3(0, 1, 0));
  private readonly snowLine = uniform(SNOW_LINE_M.summer);
  private readonly treeline = uniform(2150);
  private readonly forest = colorUniform();
  private readonly meadow = colorUniform();
  private readonly alpineMeadow = colorUniform();
  private readonly rock = colorUniform();
  /** Disques des tuiles détaillées (x, z, rayon) : demandé (B) et dernier chargement terminé (A). */
  private readonly diskA = uniform(new THREE.Vector3(0, 0, -1));
  private readonly diskB = uniform(new THREE.Vector3(0, 0, -1));
  private readonly maskTex: THREE.DataTexture;
  /** Orthophoto grossière du carré (world.json `horizon.ortho`), prise en compte dès son décodage. */
  private readonly orthoTex = new THREE.Texture();
  private readonly photoOn = uniform(0);
  private readonly orthoTint = colorUniform('#ffffff');
  private readonly orthoSat = uniform(1);
  private disposed = false;
  private radius: number;
  private readonly tileSize: number;

  constructor(grid: HorizonGrid, source: WorldSource, q: QualitySettings, season: Season, profile: AlpineProfile) {
    this.tileSize = source.tileSize;
    this.radius = (q.tileRadius - 0.5) * source.tileSize;
    this.rock.set(profile.rock);
    this.treeline.value = profile.treelineM;
    this.setSeason(season);

    // Tuiles existantes de l'emprise : le relief lointain n'est masqué que là où elles se chargent.
    const T = source.tileSize;
    const b = source.bounds;
    const tx0 = Math.floor(b.minX / T);
    const tz0 = Math.floor(b.minZ / T);
    const nx = Math.max(1, Math.ceil(b.maxX / T) - tx0);
    const nz = Math.max(1, Math.ceil(b.maxZ / T) - tz0);
    const mask = new Uint8Array(nx * nz * 4);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) mask[(j * nx + i) * 4] = source.hasTile(tx0 + i, tz0 + j) ? 255 : 0;
    this.maskTex = new THREE.DataTexture(mask, nx, nz, THREE.RGBAFormat);
    this.maskTex.magFilter = this.maskTex.minFilter = THREE.NearestFilter;
    this.maskTex.needsUpdate = true;

    if (grid.orthoBlob && !LOW_POLY) {
      // Décodée hors du fil principal, comme les orthophotos des tuiles (terrain.ts).
      const tex = this.orthoTex;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = false;
      tex.anisotropy = 4;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      void createImageBitmap(grid.orthoBlob)
        .then((bmp) => {
          if (this.disposed) return bmp.close();
          tex.image = bmp;
          tex.needsUpdate = true;
          this.photoOn.value = 1;
        })
        .catch(() => undefined);
    }

    this.mesh = new THREE.Mesh(buildGeometry(grid, q.level === 'low' || q.level === 'medium' ? 2 : 1), this.material(tx0 * T, tz0 * T, nx * T, nz * T, grid));
    this.mesh.name = 'horizon';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.matrixAutoUpdate = false;
    // Juste après le ciel (renderOrder −2, voir environment.ts) et avant tout le reste : le ciel ne
    // peut pas le recouvrir même si sa profondeur s'arrondit à 1.
    this.mesh.renderOrder = -1;
  }

  private orderCell = -1;

  /**
   * Ordre de dessin « du plus loin au plus près » vu de la caméra (algorithme du peintre sur la grille). Toute la
   * montagne est dessinée à la même profondeur (collée au ciel) : sans tri, deux versants qui se recouvrent se
   * disputent chaque pixel selon l'ordre des triangles, et la neige comme la roche « scintillent » quand on avance.
   * Réécrit seulement quand la caméra change de maille.
   */
  orderFor(x: number, z: number): void {
    const geo = this.mesh.geometry;
    const gr = geo.userData.grid as { x0: number; z0: number; res: number; m: number } | undefined;
    const index = geo.getIndex();
    if (!gr || !index) return;
    const { m } = gr;
    const ci = Math.min(m - 1, Math.max(0, Math.floor((x - gr.x0) / gr.res)));
    const cj = Math.min(m - 1, Math.max(0, Math.floor((z - gr.z0) / gr.res)));
    const key = cj * m + ci;
    if (key === this.orderCell) return;
    this.orderCell = key;
    const seq = (c: number): number[] => {
      const a: number[] = [];
      for (let k = 0; k < c; k++) a.push(k);
      for (let k = m - 1; k >= c; k--) a.push(k);
      return a;
    };
    const I = seq(ci);
    const J = seq(cj);
    const arr = index.array as Uint32Array;
    const w = m + 1;
    let n = 0;
    for (const j of J)
      for (const i of I) {
        const a = j * w + i;
        const b = a + 1;
        const c = a + w;
        const d = c + 1;
        arr[n++] = a;
        arr[n++] = c;
        arr[n++] = b;
        arr[n++] = b;
        arr[n++] = c;
        arr[n++] = d;
      }
    index.needsUpdate = true;
  }

  setSeason(season: Season): void {
    this.snowLine.value = SNOW_LINE_M[season];
    const low = LOW_POLY ? LOWLAND_LOWPOLY : LOWLAND;
    this.forest.set(low[season][0]);
    this.meadow.set(low[season][1]);
    this.alpineMeadow.set(ALPINE_MEADOW[season]);
    this.orthoTint.set(ORTHO_SEASON[season][0]);
    this.orthoSat.value = ORTHO_SEASON[season][1];
  }

  setQuality(q: QualitySettings): void {
    this.radius = (q.tileRadius - 0.5) * this.tileSize;
    (this.diskA.value as THREE.Vector3).z = Math.min((this.diskA.value as THREE.Vector3).z, this.radius);
    (this.diskB.value as THREE.Vector3).z = this.radius;
  }

  /** Nouveau voisinage demandé autour de (x, z) : masqué seulement où l'ancien et le nouveau se recouvrent. */
  requestFocus(x: number, z: number): void {
    const T = this.tileSize;
    (this.diskB.value as THREE.Vector3).set((Math.floor(x / T) + 0.5) * T, (Math.floor(z / T) + 0.5) * T, this.radius);
  }

  /** Les tuiles du voisinage demandé sont chargées. */
  commitFocus(): void {
    (this.diskA.value as THREE.Vector3).copy(this.diskB.value as THREE.Vector3);
  }

  private material(mx: number, mz: number, mw: number, mh: number, grid: HorizonGrid): THREE.MeshStandardNodeMaterial {
    const m = new THREE.MeshStandardNodeMaterial({ fog: false });
    // Pas de facettes au lointain, même en style jeu vidéo : maille de 100 m vue à 10 km, chaque petit triangle
    // prenait sa propre teinte (grain gris sur les montagnes du fond).
    m.flatShading = false;
    // Sommet : courbure terrestre (abaissement d²/2R autour de la caméra), profondeur collée au ciel.
    m.vertexNode = Fn(() => {
      const p = positionLocal;
      const d = p.xz.sub(cameraPosition.xz);
      const drop = d.dot(d).div(2 * EARTH_R);
      const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(p.x, p.y.sub(drop), p.z, 1)).toVar();
      clip.z.assign(clip.w.mul(FAR_DEPTH));
      return clip;
    })();
    const P = positionLocal;
    const xz = P.xz;
    // Masque : tuile détaillée existante et chargée (dans les deux disques) → on ne dessine pas.
    const uvm = xz.sub(vec2(mx, mz)).div(vec2(mw, mh));
    const inside = uvm.x.greaterThan(0).and(uvm.x.lessThan(1)).and(uvm.y.greaterThan(0)).and(uvm.y.lessThan(1));
    const exists = texture(this.maskTex, uvm).r.greaterThan(0.5);
    const inA = xz.sub(this.diskA.xy).length().lessThan(this.diskA.z);
    const inB = xz.sub(this.diskB.xy).length().lessThan(this.diskB.z);
    m.maskNode = inside.and(exists).and(inA).and(inB).not();

    // Sol vu de loin : forêts et prés mêlés, alpages, roche au-dessus de la limite des arbres et
    // sur les pentes fortes (adoucies à 100 m de maille), neige selon la saison et l'exposition.
    const alt = P.y;
    const slope = float(1).sub(normalWorld.y);
    // Style jeu vidéo : aplats francs, sans bruit (ni marbrure de la roche ni limite de neige frangée).
    // Le bruit s'efface avec la distance : à 10 km et plus, ses détails font moins d'un pixel et grésillent au moindre
    // mouvement (surtout la nuit, où l'exposition les amplifie) ; une valeur moyenne fixe les remplace.
    const farK = float(1).sub(smoothstep(3000, 9000, P.sub(cameraPosition).length()));
    const n1 = LOW_POLY ? float(0.5) : mix(float(0.5), mx_noise_float(xz.mul(0.0011)).mul(0.5).add(0.5), farK);
    const n2 = LOW_POLY ? float(0.5) : mix(float(0.5), mx_noise_float(xz.mul(0.007)).mul(0.5).add(0.5), farK);
    // versants boisés, fonds de vallée en prés ; au-dessus de la forêt, alpages
    const forestK = smoothstep(0.06, 0.2, slope).mul(n1.mul(0.5).add(0.6)).mul(float(1).sub(smoothstep(this.treeline.sub(300), this.treeline, alt)));
    let col = mix(this.meadow.node, this.forest.node, clamp(forestK, 0, 1));
    col = mix(col, this.alpineMeadow.node, smoothstep(ALPINE_GROUND_M - 200, ALPINE_GROUND_M + 400, alt).mul(float(1).sub(forestK.mul(0.8))));
    // roche : au-dessus de la limite des arbres, et sur les pentes fortes hors de la forêt
    const steepRock = smoothstep(0.22, 0.42, slope).mul(smoothstep(this.treeline.sub(800), this.treeline.sub(200), alt));
    const rockK = clamp(smoothstep(this.treeline.add(50), this.treeline.add(650), alt).mul(0.85).max(steepRock), 0, 1);
    col = mix(col, this.rock.node.mul(n2.mul(0.3).add(0.65)), rockK);
    // Vue aérienne : vraies couleurs des champs, forêts et villes au loin, avec la même teinte de saison
    // et la même part que sur les tuiles détaillées (pas de rupture à leur limite).
    const size = grid.n * grid.resolutionM;
    const photo = texture(this.orthoTex, xz.sub(vec2(grid.x0, grid.z0)).div(size)).rgb;
    const lum = photo.dot(vec3(0.299, 0.587, 0.114));
    const seasonal = mix(vec3(lum, lum, lum), photo, this.orthoSat).mul(this.orthoTint.node).mul(1.08);
    col = mix(col, seasonal, this.photoOn.mul(ORTHO_WEIGHT));
    const north = smoothstep(0.0, 0.4, normalWorld.z.negate());
    const line = this.snowLine.sub(north.mul(200)).add(n2.sub(0.5).mul(300));
    const snow = smoothstep(line.sub(150), line.add(200), alt).mul(float(1).sub(smoothstep(0.42, 0.7, slope)));
    col = mix(col, vec3(0.9, 0.93, 0.96), snow);
    m.colorNode = col;
    m.roughnessNode = float(0.95);
    m.metalnessNode = float(0);

    // Brume du lointain : exponentielle simple (la scène est en exp², trop opaque à 20 km),
    // bleutée vers le ciel avec la distance (perspective aérienne).
    const dist = P.sub(cameraPosition).length();
    const fogF = clamp(float(1).sub(exp(this.fogDensity.mul(-0.4).mul(dist))), 0, 1);
    // voile bleuté, un peu plus sombre que l'horizon du ciel : les chaînes lointaines se lisent en
    // plans successifs (et non comme des névés)
    const toward = P.sub(cameraPosition).div(dist).dot(this.sunDir).max(0).pow(6);
    const fogTint = mix(this.fogColor.node, this.fogSunColor.node, toward);
    const haze = mix(fogTint.mul(0.85), this.skyColor.node.mul(0.6), smoothstep(5000, 30000, dist));
    m.outputNode = vec4(mix(output.rgb, haze, fogF), output.a);
    return m;
  }

  dispose(): void {
    this.disposed = true;
    this.orthoTex.dispose();
    (this.orthoTex.image as ImageBitmap | undefined)?.close?.();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.maskTex.dispose();
  }
}

/** Grille de la ligne d'horizon en coordonnées monde (un sommet sur `step`). */
function buildGeometry(g: HorizonGrid, step: number): THREE.BufferGeometry {
  const m = Math.floor(g.n / step);
  const w = g.n + 1;
  const pos = new Float32Array((m + 1) * (m + 1) * 3);
  for (let j = 0; j <= m; j++)
    for (let i = 0; i <= m; i++) {
      const k = (j * (m + 1) + i) * 3;
      pos[k] = g.x0 + i * step * g.resolutionM;
      pos[k + 1] = g.heights[j * step * w + i * step] as number;
      pos[k + 2] = g.z0 + j * step * g.resolutionM;
    }
  const index = new Uint32Array(m * m * 6);
  let n = 0;
  for (let j = 0; j < m; j++)
    for (let i = 0; i < m; i++) {
      const a = j * (m + 1) + i;
      const b = a + 1;
      const c = a + m + 1;
      const d = c + 1;
      index[n++] = a;
      index[n++] = c;
      index[n++] = b;
      index[n++] = b;
      index[n++] = c;
      index[n++] = d;
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geo.userData.grid = { x0: g.x0, z0: g.z0, res: step * g.resolutionM, m };
  return geo;
}
