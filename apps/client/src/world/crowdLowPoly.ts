import * as THREE from 'three/webgpu';
import { attribute, positionLocal, time, sin, cos, vec2, vec3, float, mix, instanceIndex, hash, varying, uv, texture, frontFacing, smoothstep, instancedBufferAttribute } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Public en style jeu vidéo (low poly) : spectateurs en prismes à facettes (tronc hexagonal, tête
 * cubique, casquette pour certains), pancartes en planches de couleur. Calmes quand le coureur est loin,
 * ils s'animent à son approche (sauts, bras levés agités, pancartes brandies) puis se calment après son
 * passage : activation par instance tirée de la distance au coureur (un uniforme mis à jour par image).
 *
 * Repère d'un spectateur : y = 0 aux pieds, le visage vers −z (la rotation d'instance tourne +z vers
 * l'extérieur de la route, voir crowd.ts). Attributs : `part` (couleur : 0 maillot, 1 peau, 2 manche,
 * 3 pantalon, 4 casquette, 5 cheveux) et `limb` (−1 bras gauche, +1 bras droit, 0 sinon).
 */

/** Distance (m) en deçà de laquelle le public est pleinement animé, et au-delà de laquelle il est calme. */
const ACTIVE_NEAR = 60;
const ACTIVE_FAR = 100;
/** Épaule (repère du spectateur) : pivot des bras. */
const SHOULDER_X = 0.25;
const SHOULDER_Y = 1.4;

function tagged(g: THREE.BufferGeometry, part: number, limb = 0): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  ng.deleteAttribute('uv');
  const n = ng.getAttribute('position').count;
  ng.setAttribute('part', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1));
  ng.setAttribute('limb', new THREE.BufferAttribute(new Float32Array(n).fill(limb), 1));
  return ng;
}

/** Spectateur à facettes : ≈ 144 triangles (contre ≈ 370 pour les capsules du style réaliste). */
export function lowPolyPersonGeometry(): THREE.BufferGeometry {
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  const parts: THREE.BufferGeometry[] = [
    // jambes (pantalon), tronc hexagonal plus large aux épaules (maillot)
    tagged(box(0.13, 0.82, 0.16, 0.09, 0.41, 0), 3),
    tagged(box(0.13, 0.82, 0.16, -0.09, 0.41, 0), 3),
    tagged(new THREE.CylinderGeometry(0.23, 0.18, 0.62, 6, 1).rotateY(Math.PI / 6).translate(0, 1.11, 0), 0),
    // tête cubique, cheveux en dalle, casquette (calotte + visière vers l'avant, −z)
    tagged(box(0.24, 0.26, 0.24, 0, 1.58, 0), 1),
    tagged(box(0.26, 0.08, 0.26, 0, 1.7, 0.005), 5),
    tagged(box(0.27, 0.1, 0.27, 0, 1.72, 0), 4),
    tagged(box(0.22, 0.03, 0.13, 0, 1.685, -0.195), 4),
    // cheveux longs (part 6, spectatrices) : nappe dans le dos (+z, l'avant est −z) et mèches sur les joues
    tagged(box(0.27, 0.34, 0.07, 0, 1.5, 0.135), 6),
    tagged(box(0.04, 0.22, 0.14, 0.13, 1.56, 0.05), 6),
    tagged(box(0.04, 0.22, 0.14, -0.13, 1.56, 0.05), 6),
  ];
  // Bras pendants (repos) : manche et main, pivot à l'épaule ; levés dans le shader.
  for (const s of [1, -1]) {
    parts.push(tagged(box(0.085, 0.46, 0.1, s * SHOULDER_X, SHOULDER_Y - 0.25, 0), 2, s));
    parts.push(tagged(box(0.08, 0.1, 0.09, s * SHOULDER_X, SHOULDER_Y - 0.54, 0), 1, s));
  }
  return mergeGeometries(parts) as THREE.BufferGeometry;
}

/** Choix dans une palette par paliers d'un tirage ∈ [0, 1). */
function pick(h: THREE.Node<'float'>, cols: string[]): THREE.Node<'vec3'> {
  let c: THREE.Node<'vec3'> = rgb(cols[0] as string);
  for (let i = 1; i < cols.length; i++) c = h.greaterThan(i / cols.length).select(rgb(cols[i] as string), c);
  return c;
}

/** Couleur CSS (sRGB) en constante linéaire vec3. */
function rgb(hex: string): THREE.Node<'vec3'> {
  const k = new THREE.Color(hex);
  return vec3(k.r, k.g, k.b);
}

const SHIRTS = ['#e63946', '#ffd23f', '#2a9d8f', '#f4f4f4', '#1f6feb', '#ff7f11', '#8ac926', '#c04cd0', '#00b4d8', '#ff5d8f'];
const TROUSERS = ['#2c4a7a', '#2a2a30', '#8a7a5a', '#3d5a3a', '#e8e4da'];
const SKIN = ['#f3cfa8', '#e8b48a', '#c98b5e', '#8d5a3a'];
const HAIR = ['#2a1d14', '#5a3a22', '#a8743c', '#d9c08a', '#8a8a8a'];
const CAPS = ['#e63946', '#ffffff', '#1f6feb', '#ffd23f', '#2a9d8f', '#111111'];

/**
 * Activation d'une instance (0 calme, 1 en liesse) d'après la distance horizontale de son point
 * `spot` (x, z) au coureur.
 */
function activation(spot: THREE.Node<'vec2'>, rider: THREE.UniformNode<'vec2', THREE.Vector2>): THREE.Node<'float'> {
  return float(1).sub(smoothstep(ACTIVE_NEAR, ACTIVE_FAR, rider.sub(spot).length()));
}

/**
 * Matériau des spectateurs. `spot` (par instance) = (x, z, cos, sin) de la rotation d'instance autour de y
 * (les déplacements calculés dans le repère du spectateur y sont tournés : `positionLocal` inclut déjà la
 * transformation d'instance) ; `still` = 1 pour les porteurs de pancarte (bras levés, sans saut).
 */
export function lowPolyCrowdMaterial(spot: Float32Array, still: Float32Array, rider: THREE.UniformNode<'vec2', THREE.Vector2>): THREE.MeshStandardNodeMaterial {
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.flatShading = true;
  const part = attribute<'float'>('part');
  const limb = attribute<'float'>('limb');
  const raw = attribute<'vec3'>('position');
  const sp = instancedBufferAttribute(new THREE.InstancedBufferAttribute(spot, 4)) as unknown as THREE.Node<'vec4'>;
  const holder = instancedBufferAttribute(new THREE.InstancedBufferAttribute(still, 1)) as unknown as THREE.Node<'float'>;
  const h = hash(instanceIndex);
  const h2 = hash(instanceIndex.add(31));
  const h3 = hash(instanceIndex.add(77));
  const act = activation(sp.xy, rider);
  const move = act.mul(float(1).sub(holder));
  // Bras : angle depuis la verticale basse. Calme : le long du corps ; en liesse : levés en V et agités
  // (déphasés par spectateur) ; porteurs de pancarte : levés, immobiles.
  const wave = sin(time.mul(float(8).add(h.mul(3))).add(h.mul(10)));
  const cheer = float(2.45).add(wave.mul(0.3));
  const alpha = mix(mix(float(0.12), cheer, move), float(2.75), holder).mul(limb.abs());
  const ang = alpha.mul(limb);
  const rx = raw.x.sub(limb.mul(SHOULDER_X));
  const ry = raw.y.sub(SHOULDER_Y);
  const ca = cos(ang);
  const sa = sin(ang);
  const armDelta = vec2(rx.mul(ca).sub(ry.mul(sa)).sub(rx), rx.mul(sa).add(ry.mul(ca)).sub(ry));
  // Casquette pour 4 spectateurs sur 10 : sinon ramenée au centre de la tête (triangles dégénérés).
  const isCap = part.equal(4).select(float(1), float(0));
  const noCap = h3.greaterThan(0.4).select(float(1), float(0)).mul(isCap);
  // Cheveux longs pour ≈ 45 % des spectateurs sans casquette (femmes, pour l'instant) ; sinon repliés.
  const longHair = h3.greaterThan(0.4).and(hash(instanceIndex.add(43)).lessThan(0.45)).select(float(1), float(0));
  const noHair = part.equal(6).select(float(1), float(0)).mul(float(1).sub(longHair));
  const dObj = vec3(armDelta.x, armDelta.y, 0).add(vec3(0, 1.6, 0).sub(raw).mul(noCap.add(noHair)));
  // Repère du spectateur → repère d'instance (rotation autour de y).
  const c = sp.z;
  const s = sp.w;
  const dInst = vec3(dObj.x.mul(c).add(dObj.z.mul(s)), dObj.y, dObj.z.mul(c).sub(dObj.x.mul(s)));
  // Sauts déphasés (un sur deux saute franchement) ; au calme, léger balancement d'un pied sur l'autre.
  const jump = sin(time.mul(float(5).add(h.mul(3))).add(h.mul(20))).max(0).mul(0.14).mul(h2.greaterThan(0.5).select(float(1), float(0.35))).mul(move);
  const sway = sin(time.mul(1.3).add(h.mul(20))).mul(0.012).mul(float(1).sub(act));
  mat.positionNode = positionLocal.add(dInst).add(vec3(sway.mul(c), jump, sway.mul(s).negate()));
  const shirt = pick(h, SHIRTS);
  const skin = pick(h2, SKIN);
  const hair = pick(hash(instanceIndex.add(17)), HAIR);
  const cols: THREE.Node<'vec3'>[] = [shirt, skin, shirt.mul(0.85), pick(hash(instanceIndex.add(5)), TROUSERS), pick(hash(instanceIndex.add(11)), CAPS), hair, hair];
  let col = cols[0] as THREE.Node<'vec3'>;
  for (let i = 1; i < cols.length; i++) col = part.equal(i).select(cols[i] as THREE.Node<'vec3'>, col);
  mat.colorNode = varying(col);
  mat.roughnessNode = float(0.85);
  return mat;
}

/** Pancarte en planche : recto (part 0, uv de l'atlas), planche de couleur derrière (2), manche hexagonal (1). */
export function lowPolySignGeometry(w: number, h: number): THREE.BufferGeometry {
  const tag = (g: THREE.BufferGeometry, part: number, keepUv: boolean) => {
    const ng = g.index ? g.toNonIndexed() : g;
    if (!keepUv) ng.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(ng.getAttribute('position').count * 2), 2));
    ng.setAttribute('part', new THREE.BufferAttribute(new Float32Array(ng.getAttribute('position').count).fill(part), 1));
    return ng;
  };
  const face = tag(new THREE.PlaneGeometry(w, h).translate(0, 2.0, 0.002), 0, true);
  const board = tag(new THREE.BoxGeometry(w + 0.08, h + 0.08, 0.05).translate(0, 2.0, -0.026), 2, false);
  const stick = tag(new THREE.CylinderGeometry(0.025, 0.025, 0.9, 6, 1).translate(0, 1.4, -0.075), 1, false);
  return mergeGeometries([face, board, stick]) as THREE.BufferGeometry;
}

const BOARDS = ['#ffd23f', '#e63946', '#1f6feb', '#2a9d8f', '#ff7f11', '#f4f4f4'];

/**
 * Matériau des pancartes : texte de l'atlas au recto, planche de couleur vive, manche bois ; brandies
 * à l'approche du coureur (`spot` par instance = x, z), immobiles sinon.
 */
export function lowPolySignMaterial(atlas: THREE.Texture, cell: THREE.Node<'vec2'>, cols: number, rows: number, spot: Float32Array, rider: THREE.UniformNode<'vec2', THREE.Vector2>): THREE.MeshStandardNodeMaterial {
  const smat = new THREE.MeshStandardNodeMaterial();
  smat.flatShading = true;
  const spart = attribute<'float'>('part');
  const atlasUv = uv().mul(vec2(1 / cols, 1 / rows)).add(cell);
  const sh = hash(instanceIndex.add(7));
  const boardCol = pick(sh, BOARDS);
  const front = frontFacing.select(texture(atlas, atlasUv).rgb, boardCol);
  smat.colorNode = spart.equal(0).select(front, spart.equal(2).select(boardCol, rgb('#8a5a32')));
  smat.roughnessNode = float(0.85);
  const sp = instancedBufferAttribute(new THREE.InstancedBufferAttribute(spot, 2)) as unknown as THREE.Node<'vec2'>;
  const act = activation(sp, rider);
  const lift = sin(time.mul(float(4.5).add(sh)).add(sh.mul(12))).mul(0.1).mul(act);
  const sway = sin(time.mul(3.2).add(sh.mul(9))).mul(0.08).mul(act);
  smat.positionNode = positionLocal.add(vec3(sway, lift, 0));
  return smat;
}
