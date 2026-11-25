import * as THREE from 'three/webgpu';
import { attribute, positionLocal, time, sin, cos, vec2, vec3, float, mix, instanceIndex, hash, varying, uv, texture, frontFacing, smoothstep, instancedBufferAttribute } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Season } from './environment.ts';

/**
 * Public en style jeu vidéo (low poly) : silhouettes à facettes, vêtements de saison et pancartes.
 * Calmes quand le coureur est loin, ils s'animent à son approche, puis se calment après son
 * passage : activation par instance tirée de la distance au coureur (un uniforme mis à jour par image).
 *
 * Repère d'un spectateur : y = 0 aux pieds, le visage vers −z (la rotation d'instance tourne +z vers
 * l'extérieur de la route, voir crowd.ts). Attributs : `part` (couleur : 0 maillot, 1 peau, 2 manche,
 * 3 cuisse, 4 couvre-chef, 5 cheveux, 6 cheveux longs, 7 chaise, 8 tibia, 9 avant-bras, 10 chaussures)
 * et `limb` (−1 bras gauche, +1 bras droit, 0 sinon).
 */

/** Distance (m) en deçà de laquelle le public est pleinement animé, et au-delà de laquelle il est calme. */
const ACTIVE_NEAR = 12;
const ACTIVE_FAR = 40;
/** Épaule (repère du spectateur) : pivot des bras. */
const SHOULDER_X = 0.25;
const SHOULDER_Y = 1.4;
const ELBOW_Y = SHOULDER_Y - 0.224;

function tagged(g: THREE.BufferGeometry, part: number, limb = 0): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  ng.deleteAttribute('uv');
  const n = ng.getAttribute('position').count;
  ng.setAttribute('part', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1));
  ng.setAttribute('limb', new THREE.BufferAttribute(new Float32Array(n).fill(limb), 1));
  return ng;
}

export function lowPolyPersonGeometry(season: Season = 'summer'): THREE.BufferGeometry {
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  const bundled = season === 'winter';
  const torsoWidth = bundled ? 1.09 : 1;
  const parts: THREE.BufferGeometry[] = [
    // jambes (pantalon), tronc hexagonal plus large aux épaules (maillot)
    // jambes en deux (cuisse part 3, tibia part 8) : les spectateurs assis plient le genou
    tagged(box(0.13, 0.41, 0.16, 0.09, 0.615, 0), 3),
    tagged(box(0.13, 0.41, 0.16, -0.09, 0.615, 0), 3),
    tagged(box(0.13, 0.41, 0.16, 0.09, 0.205, 0), 8),
    tagged(box(0.13, 0.41, 0.16, -0.09, 0.205, 0), 8),
    tagged(new THREE.CylinderGeometry(0.23, 0.18, 0.6, 6, 1).rotateY(Math.PI / 6).scale(torsoWidth, 1, 0.73 * torsoWidth).translate(0, 1.11, 0), 0),
    tagged(new THREE.CylinderGeometry(0.065, 0.073, 0.13, 6).translate(0, 1.432, 0), 1),
    tagged(new THREE.SphereGeometry(1, 8, 4).scale(0.117, 0.147, 0.109).translate(0, 1.575, 0), 1),
    tagged(new THREE.SphereGeometry(1, 8, 3, 0, Math.PI * 2, 0, 1.54).scale(0.124, 0.151, 0.116).translate(0, 1.58, 0.012), 5),
    tagged(new THREE.SphereGeometry(1, 8, 3, 0, Math.PI * 2, 0, 1.55).scale(0.136, bundled ? 0.133 : 0.093, 0.126).translate(0, bundled ? 1.61 : 1.65, 0), 4),
    tagged(box(0.15, 0.022, bundled ? 0.13 : 0.1, 0, bundled ? 1.61 : 1.645, bundled ? -0.038 : -0.13), 4),
    // cheveux longs (part 6, spectatrices) : nappe dans le dos (+z, l'avant est −z) et mèches sur les joues
    tagged(box(0.27, 0.34, 0.07, 0, 1.5, 0.135), 6),
    tagged(box(0.04, 0.22, 0.14, 0.13, 1.56, 0.05), 6),
    tagged(box(0.04, 0.22, 0.14, -0.13, 1.56, 0.05), 6),
    // chaise pliante (part 7, seulement pour les spectateurs assis) : assise, dossier derrière (+z), pieds
    tagged(box(0.46, 0.04, 0.42, 0, 0.44, 0.04), 7),
    tagged(box(0.46, 0.4, 0.04, 0, 0.66, 0.25), 7),
    tagged(box(0.03, 0.44, 0.03, 0.21, 0.22, -0.15), 7),
    tagged(box(0.03, 0.44, 0.03, -0.21, 0.22, -0.15), 7),
    tagged(box(0.03, 0.86, 0.03, 0.21, 0.43, 0.25), 7),
    tagged(box(0.03, 0.86, 0.03, -0.21, 0.43, 0.25), 7),
  ];
  // Des manches et des avant-bras séparés permettent d'habiller le même geste selon la saison.
  for (const s of [1, -1]) {
    parts.push(tagged(box(0.138, 0.088, 0.245, s * 0.09, 0.045, -0.028), 10));
    parts.push(tagged(new THREE.CylinderGeometry(0.054 * torsoWidth, 0.042 * torsoWidth, 0.225, 6).translate(s * SHOULDER_X, SHOULDER_Y - 0.112, 0), 2, s));
    parts.push(tagged(new THREE.CylinderGeometry(0.042 * torsoWidth, 0.033 * torsoWidth, 0.225, 6).translate(s * SHOULDER_X, ELBOW_Y - 0.112, 0), 9, s));
    parts.push(tagged(new THREE.DodecahedronGeometry(1, 0).scale(0.044, 0.055, 0.041).translate(s * SHOULDER_X, SHOULDER_Y - 0.492, 0), 1, s));
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

const TOPS: Record<Season, string[]> = {
  spring: ['#29ad78', '#d85db5', '#3b70dc', '#f0d84c', '#ee7259', '#36b6c6', '#a4c64f', '#853d67'],
  summer: ['#f2dc42', '#18a9da', '#3057d6', '#f9a356', '#ed4163', '#ed752f', '#37c3ad', '#c44b9d'],
  autumn: ['#dd6f32', '#efb43b', '#36895b', '#977347', '#405ad1', '#c74b62', '#9856be', '#d98154'],
  winter: ['#4a69b9', '#159f93', '#8047b4', '#efca48', '#284487', '#ce425c', '#4b91da', '#477b57'],
};
const TROUSERS = ['#2c4a7a', '#2a2a30', '#8a7a5a', '#3d5a3a', '#e8e4da'];
const SKIN = ['#f3cfa8', '#e8b48a', '#c98b5e', '#8d5a3a'];
const HAIR = ['#2a1d14', '#5a3a22', '#a8743c', '#d9c08a', '#8a8a8a'];
const CHAIRS = ['#2a6fdb', '#e63946', '#3d8b3d', '#f2f2f2', '#2a2a2a'];
const CAPS = ['#e63946', '#ffffff', '#1f6feb', '#ffd23f', '#2a9d8f', '#111111'];
const BEANIES = ['#e36547', '#f0ca53', '#427bd0', '#31a689', '#9957bc'];
const SHOES = ['#282e34', '#4a423e', '#b4aaa0', '#e5e0d6'];

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
export function lowPolyCrowdMaterial(spot: Float32Array, still: Float32Array, rider: THREE.UniformNode<'vec2', THREE.Vector2>, season: Season = 'summer'): THREE.MeshStandardNodeMaterial {
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
  const mood = hash(instanceIndex.add(101));
  const act = activation(sp.xy, rider);
  // Une partie regarde la course, les autres saluent d'un bras ou lèvent les deux.
  const greeting = mood.greaterThan(0.31).and(limb.mul(h3.greaterThan(0.5).select(float(1), float(-1))).greaterThan(0));
  const gesture = mood.greaterThan(0.77).or(greeting).select(float(1), float(0));
  const wave = sin(time.mul(float(4.2).add(h.mul(3))).add(h.mul(18)).add(limb.mul(0.5)));
  const cheer = mix(float(1.75), float(2.48), mood).add(wave.mul(0.17));
  const alpha = mix(mix(float(0.13), cheer, act.mul(gesture)), mix(float(2.3), float(2.7), act), holder).mul(limb.abs());
  const ang = alpha.mul(limb);
  const rx = raw.x.sub(limb.mul(SHOULDER_X));
  const lowerArm = limb.abs().greaterThan(0).and(part.equal(9).or(part.equal(1)));
  const bend = lowerArm.select(float(0.08).add(act.mul(gesture).mul(0.32)).add(holder.mul(0.1)), float(0));
  const fromElbow = raw.y.sub(ELBOW_Y);
  const bentY = fromElbow.mul(cos(bend)).sub(raw.z.mul(sin(bend))).add(ELBOW_Y);
  const bentZ = fromElbow.mul(sin(bend)).add(raw.z.mul(cos(bend)));
  const ry = bentY.sub(SHOULDER_Y);
  const ca = cos(ang);
  const sa = sin(ang);
  const armDelta = vec3(rx.mul(ca).sub(ry.mul(sa)).sub(rx), rx.mul(sa).add(ry.mul(ca)).add(SHOULDER_Y).sub(raw.y), bentZ.sub(raw.z));
  // Les bonnets sont plus courants en hiver que les casquettes en été.
  const hatChance = season === 'winter' ? 0.82 : season === 'autumn' ? 0.55 : 0.38;
  const isCap = part.equal(4).select(float(1), float(0));
  const noCap = h3.greaterThan(hatChance).select(float(1), float(0)).mul(isCap);
  // Cheveux longs pour ≈ 45 % des spectateurs sans casquette (femmes, pour l'instant) ; sinon repliés.
  const longHair = hash(instanceIndex.add(43)).lessThan(0.37).select(float(1), float(0));
  const noHair = part.equal(6).select(float(1), float(0)).mul(float(1).sub(longHair));
  // Assis sur une chaise pliante (1 sur 4, pas les porteurs de pancarte) : cuisses à l'horizontale vers
  // l'avant (−z), tibias verticaux, corps abaissé de 0,37 m ; enfants (1 sur 5, debout) à 62 % de la taille.
  const seated = hash(instanceIndex.add(59)).lessThan(0.25).select(float(1), float(0)).mul(float(1).sub(holder));
  const kid = hash(instanceIndex.add(71)).lessThan(0.16).select(float(1), float(0)).mul(float(1).sub(seated)).mul(float(1).sub(holder));
  const isThigh = part.equal(3).select(float(1), float(0));
  const isShin = part.equal(8).or(part.equal(10)).select(float(1), float(0));
  const isChair = part.equal(7).select(float(1), float(0));
  const thigh = vec3(raw.x, float(0.82).sub(raw.z), raw.y.sub(0.82)).sub(raw);
  const shin = vec3(0, 0.41, -0.41);
  const sit = thigh.mul(isThigh).add(shin.mul(isShin)).add(vec3(0, -0.37, 0).mul(float(1).sub(isChair)));
  const hideChair = vec3(0, 0.3, 0).sub(raw).mul(isChair).mul(float(1).sub(seated));
  let dObj = armDelta.add(vec3(0, 1.6, 0).sub(raw).mul(noCap.add(noHair))).add(sit.mul(seated)).add(hideChair);
  // enfant : tout le corps réduit depuis les pieds
  dObj = dObj.add(raw.add(dObj).mul(-0.38).mul(kid));
  // Repère du spectateur → repère d'instance (rotation autour de y).
  const c = sp.z;
  const s = sp.w;
  const dInst = vec3(dObj.x.mul(c).add(dObj.z.mul(s)), dObj.y, dObj.z.mul(c).sub(dObj.x.mul(s)));
  // Pas de saut (le public ne monte ni ne descend) : léger balancement d'un pied sur l'autre, sur le côté.
  const sway = sin(time.mul(1.3).add(h.mul(20))).mul(0.012);
  mat.positionNode = positionLocal.add(dInst).add(vec3(sway.mul(c), 0, sway.mul(s).negate()));
  const shirt = pick(h, TOPS[season]);
  const skin = pick(h2, SKIN);
  const hair = pick(hash(instanceIndex.add(17)), HAIR);
  const trousers = pick(hash(instanceIndex.add(5)), TROUSERS);
  const sleeve = season === 'winter' || season === 'autumn' ? shirt.mul(0.91) : skin;
  const hat = pick(hash(instanceIndex.add(11)), season === 'winter' ? BEANIES : CAPS);
  const cols: THREE.Node<'vec3'>[] = [shirt, skin, shirt.mul(0.85), trousers, hat, hair, hair, pick(hash(instanceIndex.add(23)), CHAIRS), trousers, sleeve, pick(h3, SHOES)];
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
  // `part` interpolé comparé à des seuils (égal à 2, il basculait sur certains pixels) : 0 recto, 1 manche, 2 planche
  smat.colorNode = spart.lessThan(0.5).select(front, spart.greaterThan(1.5).select(boardCol, rgb('#8a5a32')));
  smat.roughnessNode = float(0.85);
  const sp = instancedBufferAttribute(new THREE.InstancedBufferAttribute(spot, 2)) as unknown as THREE.Node<'vec2'>;
  const act = activation(sp, rider);
  // brandies sur le côté seulement, sans va-et-vient vertical
  const sway = sin(time.mul(2.5).add(sh.mul(9))).mul(0.035).mul(act);
  smat.positionNode = positionLocal.add(vec3(sway, 0, 0));
  return smat;
}
