import * as THREE from 'three/webgpu';
import { texture, uv, float, vec2, vec3, vec4, mix, mx_noise_float, smoothstep, step, fract, dot, attribute, cameraPosition, cameraViewMatrix, positionLocal, atan, floor, mod, screenCoordinate } from 'three/tsl';
import { Tree } from './eztree/tree.js';
import { rng } from '../engine/noise.ts';
import { cullAfterWarmup } from './cullWarmup.ts';

/**
 * Vrais arbres autour du coureur (P2.5, actifs par défaut ; `?eztree=0` pour couper) : branches et bouquets de feuilles générés par EZ-Tree (copie MIT,
 * voir eztree/README.md) à la place des feuillus LiDAR :
 * - à moins de EZ_NEAR_M : l'arbre en 3D (≈ 7 000 à 20 000 triangles), ombres comprises ;
 * - de EZ_NEAR_M à EZ_IMPOSTOR_M : un imposteur, carte tournée vers la caméra qui montre l'arbre pré-rendu sous
 *   IMPOSTOR_VIEWS angles (atlas refait à chaque saison) ; tournée vers le soleil dans la passe d'ombre, elle porte
 *   une ombre d'arbre ;
 * - au-delà : les arbres du jeu (vegetation.ts), qui masque dans son shader ceux remplacés ici.
 * Aux deux limites, fondu sur une bande (NEAR_BAND, FAR_BAND) calculé à chaque image d'après la position réelle du
 * coureur, en tramage complémentaire (`ezDither`) que l'anticrénelage temporel lisse : pas de bascule d'un groupe
 * d'arbres quand les listes sont refaites (tous les 5 m). Teinte de chaque arbre tirée de sa position (stable).
 * Les textures d'EZ-Tree ne sont pas reprises : bouquets de feuilles dessinés ici (`leafSpray`), écorce par le shader.
 */

type Kind = 'oak' | 'ash' | 'aspen';

/** Essences : préréglage EZ-Tree, dessin des feuilles, teinte d'écorce, densité de feuillage (× le préréglage). */
const SPECIES: Array<{ preset: string; leaf: Kind; bark: [string, string]; leafMul: number; seed: number }> = [
  { preset: 'Oak Medium', leaf: 'oak', bark: ['#3d342c', '#6b5e50'], leafMul: 1.5, seed: 11 },
  { preset: 'Ash Medium', leaf: 'ash', bark: ['#4a463f', '#7a756b'], leafMul: 1.35, seed: 18 },
  { preset: 'Oak Large', leaf: 'oak', bark: ['#352d26', '#64574a'], leafMul: 1.6, seed: 25 },
  { preset: 'Aspen Medium', leaf: 'aspen', bark: ['#8d8b84', '#c9c6bc'], leafMul: 1.8, seed: 32 },
];

/** Rayon des arbres en 3D autour du coureur (m) : valeur des préréglages haut et ultra (`ezNearM` de quality.ts). */
export const EZ_NEAR_M = 60;
/** Réglages par préréglage graphique : rayon des arbres en 3D (0 = imposteurs seuls) et ombres portées par ces arbres. */
export interface EzTreeOptions {
  nearM: number;
  nearShadows: boolean;
  /**
   * Rayon de houppier (m) de l'arbre du jeu à l'échelle 1 : l'échelle horizontale d'une instance fois ce rayon
   * donne la place que le placement lui a laissée (houppier rétréci près d'une route). Absent : pas de limite.
   */
  crownRefM?: number;
}
/** Le houppier d'un vrai arbre peut dépasser de 10 % la place laissée par le placement, pas plus (routes dégagées). */
const CROWN_ROOM_SLACK = 1.1;
/** Plancher de l'amincissement : en dessous, l'arbre deviendrait un fuseau. */
const MIN_CROWN_RATIO = 0.4;
/** Rayon des imposteurs (m) : au-delà, les arbres du jeu. */
export const EZ_IMPOSTOR_M = 200;
/** Demi-largeur des bandes de fondu 3D / imposteur et imposteur / arbres du jeu (m). */
export const NEAR_BAND = 5;
export const FAR_BAND = 10;
/** Marge des listes (m) : le coureur avance d'au plus 5 m entre deux échanges. */
const LIST_MARGIN = 6;

/** Seuil de tramage par pixel (0–1), commun aux trois sortes d'arbres : leurs parts se complètent exactement. */
export function ezDither(): THREE.Node<'float'> {
  return fract(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715))).mul(52.9829189)) as unknown as THREE.Node<'float'>;
}
/** Part des arbres en 3D à la distance `d` du coureur (1 près, 0 au-delà de la bande) ; rayon nul : aucune. */
export function ezNearWeight(d: THREE.Node<'float'>, nearM = EZ_NEAR_M): THREE.Node<'float'> {
  if (nearM <= 0) return float(0) as unknown as THREE.Node<'float'>;
  return float(1).sub(smoothstep(nearM - NEAR_BAND, nearM + NEAR_BAND, d)) as unknown as THREE.Node<'float'>;
}
/** Part des arbres du jeu à la distance `d` (0 près, 1 au-delà de la bande lointaine). */
export function ezFarWeight(d: THREE.Node<'float'>): THREE.Node<'float'> {
  return smoothstep(EZ_IMPOSTOR_M - FAR_BAND, EZ_IMPOSTOR_M + FAR_BAND, d) as unknown as THREE.Node<'float'>;
}

/** Angles pré-rendus par essence (atlas). */
const IMPOSTOR_VIEWS = 8;
const FRAME_W = 128;
const FRAME_H = 256;
/** Arbres en 3D et imposteurs au plus par essence. */
const CAP_NEAR = 260;
const CAP_IMPOSTOR = 5000;

/**
 * Bouquet de feuilles d'une essence, en niveaux de gris (la teinte de saison vient du shader) avec alpha : rameaux et
 * feuilles dessinés au canevas (aucune image extérieure).
 */
function leafSpray(kind: Kind, seed: number): THREE.Texture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const r = rng(seed);
  const twigs = kind === 'ash' ? 3 : 4;
  for (let t = 0; t < twigs; t++) {
    const x0 = S * (0.3 + r() * 0.4);
    const bend = (r() - 0.5) * S * 0.5;
    g.strokeStyle = 'rgb(70,60,50)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x0, S);
    g.quadraticCurveTo(x0 + bend * 0.5, S * 0.5, x0 + bend, S * 0.08);
    g.stroke();
    const n = kind === 'ash' ? 13 : kind === 'aspen' ? 9 : 10;
    for (let k = 0; k < n; k++) {
      const u = 0.12 + (k / n) * 0.85;
      const px = (1 - u) * (1 - u) * x0 + 2 * (1 - u) * u * (x0 + bend * 0.5) + u * u * (x0 + bend);
      const py = (1 - u) * (1 - u) * S + 2 * (1 - u) * u * (S * 0.5) + u * u * S * 0.08;
      const side = k % 2 ? 1 : -1;
      const ang = -Math.PI / 2 + side * (0.6 + r() * 0.5);
      const len = kind === 'ash' ? 20 + r() * 8 : kind === 'aspen' ? 17 + r() * 6 : 26 + r() * 10;
      const l = Math.round(150 + r() * 60);
      g.save();
      g.translate(px, py);
      g.rotate(ang + Math.PI / 2);
      g.fillStyle = `rgb(${l},${l},${l})`;
      g.beginPath();
      if (kind === 'oak') {
        // feuille lobée : contour ondulé (5 lobes de chaque côté)
        const W = len * 0.42;
        for (let i = 0; i <= 40; i++) {
          const v = i / 40;
          const w = W * Math.sin(Math.PI * Math.min(1, v * 1.08)) * (0.72 + 0.28 * Math.abs(Math.sin(v * Math.PI * 5)));
          if (i === 0) g.moveTo(w, -v * len);
          else g.lineTo(w, -v * len);
        }
        for (let i = 40; i >= 0; i--) {
          const v = i / 40;
          const w = W * Math.sin(Math.PI * Math.min(1, v * 1.08)) * (0.72 + 0.28 * Math.abs(Math.sin(v * Math.PI * 5 + 0.6)));
          g.lineTo(-w, -v * len);
        }
      } else if (kind === 'aspen') {
        g.ellipse(0, -len * 0.5, len * 0.48, len * 0.5, 0, 0, Math.PI * 2);
      } else {
        // foliole de frêne : lancéolée
        g.ellipse(0, -len * 0.5, len * 0.2, len * 0.5, 0, 0, Math.PI * 2);
      }
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.22)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(0, -len * 0.9);
      g.stroke();
      g.restore();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

interface Species {
  h0: number;
  /** Largeur de l'arbre généré (m, avant mise à l'échelle). */
  w0: number;
  branches: THREE.InstancedMesh;
  leaves: THREE.InstancedMesh;
  nearCount: number;
  /** Arbre seul pour le pré-rendu de l'atlas (matériaux sans éclairage). */
  bake: THREE.Group;
  atlas: THREE.RenderTarget;
  impostor: THREE.Mesh;
  iPos: THREE.InstancedBufferAttribute;
  iSize: THREE.InstancedBufferAttribute;
  iYaw: THREE.InstancedBufferAttribute;
  /** Pied (x, z) et teinte des arbres en 3D (attribut d'instance des deux maillages). */
  iFoot: THREE.InstancedBufferAttribute;
  impCount: number;
  /** Emprise des arbres en 3D et des imposteurs de la liste en cours (sphères englobantes des lots). */
  nearBox: Bounds;
  impBox: Bounds;
}

/** Emprise d'un lot d'arbres : pieds (x, y, z) et plus grande dimension d'un arbre. */
interface Bounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  reach: number;
}

const emptyBounds = (): Bounds => ({ minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity, reach: 0 });

function resetBounds(b: Bounds): void {
  b.minX = b.minY = b.minZ = Infinity;
  b.maxX = b.maxY = b.maxZ = -Infinity;
  b.reach = 0;
}

function growBounds(b: Bounds, x: number, y: number, z: number, reach: number): void {
  if (x < b.minX) b.minX = x;
  if (x > b.maxX) b.maxX = x;
  if (y < b.minY) b.minY = y;
  if (y > b.maxY) b.maxY = y;
  if (z < b.minZ) b.minZ = z;
  if (z > b.maxZ) b.maxZ = z;
  if (reach > b.reach) b.reach = reach;
}

/** Sphère qui contient tous les arbres du lot (pieds, plus la hauteur et l'envergure du plus grand, avec marge). */
export function boundsSphere(b: Bounds, out: THREE.Sphere): THREE.Sphere {
  if (b.minX > b.maxX) {
    out.center.set(0, 0, 0);
    out.radius = 0;
    return out;
  }
  out.center.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
  out.radius = Math.hypot(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) / 2 + b.reach * 1.2 + 2;
  return out;
}

/** Feuillus LiDAR d'un bloc : matrices d'instances et paramètres (`instanceColor`, voir vegetation.ts). */
export interface NearSource {
  mesh: THREE.InstancedMesh;
}

export class EzTreeNear {
  readonly group = new THREE.Group();
  private readonly species: Species[] = [];
  private readonly last = new THREE.Vector3(1e9, 0, 1e9);
  private frames = 0;
  private renderer: THREE.WebGPURenderer | null = null;
  private atlasDirty = true;
  private readonly bakeScene = new THREE.Scene();
  private readonly bakeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  private readonly bakeRT = new THREE.RenderTarget(FRAME_W, FRAME_H, { depthBuffer: true });
  private readonly m = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();

  /**
   * `live` : position du coureur, mise à jour à chaque image (uniforme partagé avec le shader des arbres du jeu,
   * vegetation.ts) ; les fondus en dépendent.
   */
  constructor(
    leafA: THREE.Node<'vec3'>,
    leafB: THREE.Node<'vec3'>,
    leafAmount: THREE.Node<'float'>,
    private readonly live: THREE.Node<'vec3'> & { value: THREE.Vector3 },
    private readonly opts: EzTreeOptions = { nearM: EZ_NEAR_M, nearShadows: true },
  ) {
    const n = ezDither();
    const nearM = Math.max(0, opts.nearM);
    const nearWeight = (d: unknown) => ezNearWeight(d as THREE.Node<'float'>, nearM);
    this.group.name = 'ez-tree-near';
    // Le moteur de rendu (pour pré-rendre les atlas entre deux images) : récupéré par un objet invisible.
    const probe = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3)), new THREE.MeshBasicNodeMaterial({ colorWrite: false, depthWrite: false }));
    probe.frustumCulled = false;
    probe.onBeforeRender = (renderer) => {
      this.renderer = renderer as unknown as THREE.WebGPURenderer;
    };
    this.group.add(probe);
    for (const sp of SPECIES) {
      const t = new Tree();
      t.loadPreset(sp.preset);
      t.options.seed = sp.seed;
      t.options.leaves.count = Math.round(t.options.leaves.count * sp.leafMul);
      t.generate();
      const box = new THREE.Box3().setFromObject(t);
      const h0 = box.max.y - box.min.y;
      const w0 = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
      // Normales des feuilles : depuis le centre du houppier (aplati), comme les arbres du jeu.
      const lg = t.leavesMesh.geometry;
      const lp = lg.getAttribute('position');
      const cc = new THREE.Box3().setFromBufferAttribute(lp as THREE.BufferAttribute).getCenter(new THREE.Vector3());
      const nrm = new Float32Array(lp.count * 3);
      const v = new THREE.Vector3();
      for (let i = 0; i < lp.count; i++) {
        v.set(lp.getX(i) - cc.x, (lp.getY(i) - cc.y) * 0.8, lp.getZ(i) - cc.z).normalize();
        nrm[i * 3] = v.x;
        nrm[i * 3 + 1] = v.y;
        nrm[i * 3 + 2] = v.z;
      }
      lg.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      // Écorce : deux teintes mêlées par un bruit étiré le long des branches.
      const bn = mx_noise_float(vec2(uv().x.mul(6), uv().y.mul(1.5))).mul(0.5).add(0.5);
      const barkCol = mix(vec3(...new THREE.Color(sp.bark[0]).toArray()), vec3(...new THREE.Color(sp.bark[1]).toArray()), bn);
      // Feuilles : bouquet dessiné, teinte de saison du jeu, nuancée par arbre (teinte stable, tirée de sa position),
      // absent en hiver.
      const tex = texture(leafSpray(sp.leaf, sp.seed), uv());
      const leafColOf = (tone: THREE.Node<'float'>) => mix(leafA, leafB, tone.mul(0.4).add(0.3)).mul(tex.r.mul(1.15).add(0.45)).mul(tone.mul(0.12).add(0.94));
      const leafAlpha = tex.a.mul(leafAmount);
      // Arbres en 3D : pied et teinte par instance, part du fondu tramé.
      const iFoot = new THREE.InstancedBufferAttribute(new Float32Array(CAP_NEAR * 3), 3);
      iFoot.setUsage(THREE.DynamicDrawUsage);
      t.branchesMesh.geometry.setAttribute('iFoot', iFoot);
      lg.setAttribute('iFoot', iFoot);
      const foot = attribute<'vec3'>('iFoot');
      const nearVisible = step(n, nearWeight(vec2(foot.x, foot.y).sub(this.live.xz).length()).sub(1e-4));
      const bMat = new THREE.MeshStandardNodeMaterial();
      bMat.colorNode = barkCol;
      bMat.roughnessNode = float(0.95);
      bMat.opacityNode = nearVisible;
      bMat.alphaTest = 0.5;
      const lMat = new THREE.MeshStandardNodeMaterial();
      lMat.side = THREE.DoubleSide;
      lMat.alphaTest = 0.5;
      lMat.colorNode = leafColOf(foot.z);
      lMat.opacityNode = leafAlpha.mul(nearVisible);
      lMat.roughnessNode = float(0.75);
      const branches = new THREE.InstancedMesh(t.branchesMesh.geometry, bMat, CAP_NEAR);
      const leaves = new THREE.InstancedMesh(lg, lMat, CAP_NEAR);
      for (const im of [branches, leaves]) {
        im.count = 0;
        im.castShadow = opts.nearShadows;
        im.receiveShadow = true;
        // Écarté hors champ par la sphère du lot, refaite avec la liste (`rebuild`) : un lot vide (ville, champs) n'est
        // plus préparé à chaque passe. Jamais masqué par `visible` (la précompilation du départ saute les objets
        // masqués), et culling seulement après les premières images (voir cullAfterWarmup).
        im.boundingSphere = new THREE.Sphere();
        cullAfterWarmup(im);
        // Rayon nul (préréglage bas) : pas d'arbres en 3D, ces géométries ne servent qu'au pré-rendu des atlas.
        if (nearM > 0) this.group.add(im);
      }
      // Pré-rendu : mêmes géométries, couleurs sans éclairage (l'imposteur est éclairé par la scène).
      const bake = new THREE.Group();
      const bBasic = new THREE.MeshBasicNodeMaterial();
      bBasic.colorNode = barkCol;
      const lBasic = new THREE.MeshBasicNodeMaterial();
      lBasic.side = THREE.DoubleSide;
      lBasic.alphaTest = 0.5;
      lBasic.colorNode = leafColOf(float(0.5));
      lBasic.opacityNode = leafAlpha;
      bake.add(new THREE.Mesh(t.branchesMesh.geometry, bBasic), new THREE.Mesh(lg, lBasic));
      bake.visible = false;
      this.bakeScene.add(bake);
      const atlas = new THREE.RenderTarget(FRAME_W * IMPOSTOR_VIEWS, FRAME_H, { depthBuffer: false });
      // (couleurs écrites linéaires par le rendu : pas de décodage sRGB à la lecture)
      // Imposteur : carte (pied au sol) tournée vers la caméra autour de la verticale ; image de l'angle le plus proche.
      const plane = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = plane.index;
      geo.setAttribute('position', plane.getAttribute('position'));
      geo.setAttribute('uv', plane.getAttribute('uv'));
      const iPos = new THREE.InstancedBufferAttribute(new Float32Array(CAP_IMPOSTOR * 3), 3);
      const iSize = new THREE.InstancedBufferAttribute(new Float32Array(CAP_IMPOSTOR * 2), 2);
      // (cap autour de la verticale, teinte de l'arbre)
      const iYaw = new THREE.InstancedBufferAttribute(new Float32Array(CAP_IMPOSTOR * 2), 2);
      for (const a of [iPos, iSize, iYaw]) a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('iPos', iPos);
      geo.setAttribute('iSize', iSize);
      geo.setAttribute('iYaw', iYaw);
      geo.instanceCount = 0;
      const center = attribute<'vec3'>('iPos');
      const size = attribute<'vec2'>('iSize');
      const yawTone = attribute<'vec2'>('iYaw');
      const yaw = yawTone.x;
      const toCam = cameraPosition.xz.sub(center.xz);
      const dir = toCam.normalize();
      const right = vec3(dir.y, 0, dir.x.negate());
      const imat = new THREE.MeshStandardNodeMaterial();
      imat.positionNode = center.add(right.mul(positionLocal.x.mul(size.x))).add(vec3(0, positionLocal.y.mul(size.y), 0));
      const local = atan(toCam.x, toCam.y).sub(yaw).div(Math.PI * 2).mul(IMPOSTOR_VIEWS);
      const frame = mod(floor(local.add(0.5)), IMPOSTOR_VIEWS);
      // (texture rendue sous WebGPU : axe vertical inversé)
      const tile = texture(atlas.texture, vec2(frame.add(uv().x).div(IMPOSTOR_VIEWS), float(1).sub(uv().y)));
      imat.colorNode = tile.rgb.mul(yawTone.y.mul(0.12).add(0.94));
      // part de l'imposteur : ni celle des arbres en 3D, ni celle des arbres du jeu (tramage complémentaire)
      const dImp = center.xz.sub(this.live.xz).length();
      imat.opacityNode = tile.a.mul(step(nearWeight(dImp), n)).mul(step(n, float(1).sub(ezFarWeight(dImp)).sub(1e-4)));
      imat.alphaTest = 0.5;
      imat.side = THREE.DoubleSide;
      // normale : vers la caméra, relevée (houppier éclairé d'en haut)
      imat.normalNode = cameraViewMatrix.mul(vec4(vec3(dir.x, 0.8, dir.y).normalize(), 0)).xyz.normalize();
      imat.roughnessNode = float(0.85);
      const impostor = new THREE.Mesh(geo, imat);
      // Les cartes sont placées par le shader : sphère du lot posée à la main (refaite avec la liste).
      geo.boundingSphere = new THREE.Sphere();
      cullAfterWarmup(impostor);
      impostor.castShadow = true;
      impostor.receiveShadow = true;
      this.group.add(impostor);
      this.species.push({ h0, w0, branches, leaves, nearCount: 0, bake, atlas, impostor, iPos, iSize, iYaw, iFoot, impCount: 0, nearBox: emptyBounds(), impBox: emptyBounds() });
    }
    this.bakeScene.add(new THREE.AmbientLight(0xffffff, 1));
  }

  /** Saison changée : atlas à refaire. */
  markDirty(): void {
    this.atlasDirty = true;
  }

  /** Pré-rend chaque essence sous IMPOSTOR_VIEWS angles dans son atlas (entre deux images, une fois par saison). */
  private bakeAtlases(): void {
    const r = this.renderer;
    if (!r) return;
    const prevTarget = r.getRenderTarget();
    const prevColor = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    for (const sp of this.species) {
      sp.bake.visible = true;
      const hw = sp.w0 * 0.55;
      Object.assign(this.bakeCam, { left: -hw, right: hw, top: sp.h0 * 1.02, bottom: 0 });
      this.bakeCam.updateProjectionMatrix();
      for (let k = 0; k < IMPOSTOR_VIEWS; k++) {
        const a = (k / IMPOSTOR_VIEWS) * Math.PI * 2;
        this.bakeCam.position.set(Math.sin(a) * 150, 0, Math.cos(a) * 150);
        this.bakeCam.lookAt(0, 0, 0);
        r.setRenderTarget(this.bakeRT);
        r.clear();
        r.render(this.bakeScene, this.bakeCam);
        r.copyTextureToTexture(this.bakeRT.texture, sp.atlas.texture, null, new THREE.Vector2(k * FRAME_W, 0));
      }
      sp.bake.visible = false;
    }
    r.setRenderTarget(prevTarget);
    r.setClearColor(prevColor, prevAlpha);
    this.atlasDirty = false;
  }

  /**
   * Échange tous les 5 m parcourus (et au moins toutes les 90 images) : feuillus LiDAR à moins de EZ_NEAR_M en 3D, à
   * moins de EZ_IMPOSTOR_M en imposteurs. `meshes` : feuillus des blocs LiDAR proches ; `topOf` : hauteur (m).
   */
  update(focus: THREE.Vector3, meshes: Iterable<THREE.InstancedMesh>, isConifer: (mesh: THREE.InstancedMesh, i: number) => boolean, topOf: (mesh: THREE.InstancedMesh, i: number) => number): void {
    if (this.tick(focus)) this.rebuild(focus, meshes, isConifer, topOf);
  }

  /**
   * À chaque image : atlas à refaire, position réelle du coureur pour les fondus. Vrai quand les listes sont à
   * refaire (`rebuild`) : l'appelant ne rassemble les blocs proches que dans ce cas.
   */
  tick(focus: THREE.Vector3): boolean {
    if (this.atlasDirty && this.renderer) this.bakeAtlases();
    // fondus : position réelle, à chaque image
    this.live.value.copy(focus);
    this.frames++;
    return !(Math.hypot(focus.x - this.last.x, focus.z - this.last.z) < 5 && this.frames < 90);
  }

  /** Refait les listes d'arbres en 3D et d'imposteurs (après un `tick` vrai). */
  rebuild(focus: THREE.Vector3, meshes: Iterable<THREE.InstancedMesh>, isConifer: (mesh: THREE.InstancedMesh, i: number) => boolean, topOf: (mesh: THREE.InstancedMesh, i: number) => number): void {
    this.frames = 0;
    this.last.copy(focus);
    for (const sp of this.species) {
      sp.nearCount = 0;
      sp.impCount = 0;
      resetBounds(sp.nearBox);
      resetBounds(sp.impBox);
    }
    // listes élargies aux bandes de fondu (et au chemin parcouru d'ici le prochain échange)
    const nearM = Math.max(0, this.opts.nearM);
    const rn2 = nearM > 0 ? (nearM + NEAR_BAND + LIST_MARGIN) ** 2 : -1;
    const ri0 = nearM > 0 ? Math.max(0, nearM - NEAR_BAND - LIST_MARGIN) ** 2 : 0;
    const ri2 = (EZ_IMPOSTOR_M + FAR_BAND + LIST_MARGIN) ** 2;
    for (const mesh of meshes) {
      const a = mesh.instanceMatrix.array as Float32Array;
      for (let i = 0; i < mesh.count; i++) {
        const x = a[i * 16 + 12] as number;
        const z = a[i * 16 + 14] as number;
        const d2 = (x - focus.x) ** 2 + (z - focus.z) ** 2;
        if (d2 > ri2 || isConifer(mesh, i)) continue;
        const k = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
        const sp = this.species[Math.floor(k * this.species.length) % this.species.length] as Species;
        const tone = (k * 7.31) % 1;
        const sc = topOf(mesh, i) / sp.h0;
        // Largeur bornée par la place du houppier d'origine : mis à l'échelle sur la seule hauteur, les vrais arbres
        // plantés au bord d'une route laissaient pendre leurs branches basses sur la chaussée.
        let scW = sc;
        if (this.opts.crownRefM) {
          const room = Math.hypot(a[i * 16] as number, a[i * 16 + 1] as number, a[i * 16 + 2] as number) * this.opts.crownRefM;
          scW = Math.min(sc, Math.max(sc * MIN_CROWN_RATIO, (room * CROWN_ROOM_SLACK) / (sp.w0 / 2)));
        }
        if (d2 <= rn2 && sp.nearCount < CAP_NEAR) {
          sp.iFoot.setXYZ(sp.nearCount, x, z, tone);
          this.m.fromArray(a, i * 16);
          this.m.decompose(this.p, this.q, this.s);
          this.s.set(scW, sc, scW);
          this.m.compose(this.p, this.q, this.s);
          sp.branches.setMatrixAt(sp.nearCount, this.m);
          sp.leaves.setMatrixAt(sp.nearCount, this.m);
          sp.nearCount++;
          growBounds(sp.nearBox, x, this.p.y, z, Math.max(sp.h0, sp.w0) * sc);
        }
        if (d2 >= ri0) {
          if (sp.impCount >= CAP_IMPOSTOR) continue;
          const j = sp.impCount++;
          sp.iPos.setXYZ(j, x, a[i * 16 + 13] as number, z);
          sp.iSize.setXY(j, sp.w0 * 1.1 * scW, sp.h0 * 1.02 * sc);
          // rotation autour de la verticale : (sin, cos) dans la 3e colonne
          sp.iYaw.setXY(j, Math.atan2(a[i * 16 + 8] as number, a[i * 16 + 10] as number), tone);
          growBounds(sp.impBox, x, a[i * 16 + 13] as number, z, Math.max(sp.h0, sp.w0) * 1.1 * sc);
        }
      }
    }
    for (const sp of this.species) {
      sp.branches.count = sp.nearCount;
      sp.leaves.count = sp.nearCount;
      // Lot vide : rien à envoyer au GPU.
      if (sp.nearCount > 0) {
        sp.branches.instanceMatrix.needsUpdate = true;
        sp.leaves.instanceMatrix.needsUpdate = true;
        sp.iFoot.needsUpdate = true;
      }
      boundsSphere(sp.nearBox, sp.branches.boundingSphere as THREE.Sphere);
      (sp.leaves.boundingSphere as THREE.Sphere).copy(sp.branches.boundingSphere as THREE.Sphere);
      const geo = sp.impostor.geometry as THREE.InstancedBufferGeometry;
      geo.instanceCount = sp.impCount;
      if (sp.impCount > 0) {
        sp.iPos.needsUpdate = true;
        sp.iSize.needsUpdate = true;
        sp.iYaw.needsUpdate = true;
      }
      boundsSphere(sp.impBox, geo.boundingSphere as THREE.Sphere);
    }
  }

  /** Arbres en 3D et imposteurs. */
  get totals(): { near: number; impostors: number } {
    return { near: this.species.reduce((t, s) => t + s.nearCount, 0), impostors: this.species.reduce((t, s) => t + s.impCount, 0) };
  }
}
