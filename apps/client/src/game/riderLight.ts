import * as THREE from 'three/webgpu';
import { LOW_POLY } from '../engine/style.ts';

/**
 * Coureurs lointains en version légère (inspirée des bots « _Lw » de MyWhoosh) : au-delà de `LIGHT_FROM_M`, un
 * coureur V3 (17 à 27 appels de dessin : cadre, roues, pédalier, corps en 9 morceaux…) devient un seul maillage
 * figé, une couleur moyenne par pièce. Le pédalage et les textures ne se distinguent plus à cette distance ; le
 * maillage léger projette aussi l'ombre (un appel par cascade au lieu d'une vingtaine).
 *
 * Construction : les sommets de chaque pièce visible sont ramenés dans le repère du coureur (corps animé : pose du
 * moment, calculée sur le processeur), la couleur moyenne de la texture × la couleur du matériau devient la couleur
 * des sommets, et le tout est fusionné. Le résultat est partagé entre coureurs de même tenue et même vélo.
 */

/** ?riderlight=0 : coureurs détaillés à toute distance (comparaison). */
export const RIDER_LIGHT = typeof location !== 'undefined' && new URLSearchParams(location.search).get('riderlight') !== '0';
/** Distance de bascule (m), avec une marge de retour pour ne pas basculer en boucle. */
export const LIGHT_FROM_M = 60;
const LIGHT_BACK_M = 52;

const SHARED_MATERIAL = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0.05 });
// Style poly : facettes, comme les pièces du coureur détaillé.
SHARED_MATERIAL.flatShading = LOW_POLY;

/**
 * Couleur d'une pièce quand le matériau ne la porte pas lui-même (teinte calculée par nœuds sur une base blanche :
 * peau et cadre des coureurs réalistes) ; null = couleur du matériau. Voir riderDetail.ts.
 */
export type LightColor = (mesh: THREE.Mesh, material: THREE.Material) => THREE.ColorRepresentation | null | undefined;
const averageColors = new WeakMap<object, THREE.Color>();
const geometryCache = new Map<string, THREE.BufferGeometry>();
/** Une seule construction par image, pour éviter les à-coups. */
let lastBuildFrame = -1;

interface LightState {
  mesh: THREE.Mesh | null;
  on: boolean;
}
const states = new WeakMap<THREE.Object3D, LightState>();

/** Texture sans couleur moyenne exploitable (canevas, lecture impossible) : mémorisée pour ne pas réessayer. */
const NO_AVERAGE = new THREE.Color();

/**
 * Couleur moyenne d'une texture lisible (image ou ImageBitmap), réduite à 8 × 8. Pas de canevas dessiné en jeu (écran du
 * compteur, casquette, plaque…) : sa relecture (getImageData d'un canevas accéléré) attendait la carte graphique,
 * ~300 ms par coureur passé en version légère (mesure du 26/11/2026, Réel, 40 IA : 13 relectures, 4,1 s figées).
 */
function textureAverage(tex: THREE.Texture | null | undefined): THREE.Color | null {
  if (!tex?.image) return null;
  const hit = averageColors.get(tex.image as object);
  if (hit) return hit === NO_AVERAGE ? null : hit;
  if (typeof (tex.image as { getContext?: unknown }).getContext === 'function') {
    averageColors.set(tex.image as object, NO_AVERAGE);
    return null;
  }
  try {
    const img = tex.image as CanvasImageSource;
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, 8, 8);
    const d = ctx.getImageData(0, 0, 8, 8).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if ((d[i + 3] as number) < 16) continue;
      r += d[i] as number;
      g += d[i + 1] as number;
      b += d[i + 2] as number;
      n++;
    }
    if (!n) return null;
    // Moyenne en sRGB, puis passage en linéaire (couleurs de sommets).
    const col = new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
    averageColors.set(tex.image as object, col);
    return col;
  } catch {
    return null;
  }
}

/** Couleur moyenne d'une pièce (couleur du matériau × moyenne de sa texture, ou teinte donnée par `colorOf`). */
export function partColor(m: THREE.Mesh, colorOf?: LightColor): THREE.Color {
  const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
  const hint = colorOf?.(m, mat);
  if (hint !== null && hint !== undefined) return new THREE.Color(hint);
  const base = mat.color ? mat.color.clone() : new THREE.Color(0.6, 0.6, 0.6);
  const avg = textureAverage(mat.map);
  return avg ? base.multiply(avg) : base;
}

const _v = new THREE.Vector3();
const _inv = new THREE.Matrix4();
const _m = new THREE.Matrix4();

/** Couleurs de sommets à reprendre (matériau à couleurs de sommets : corps en tubes du coureur poly). */
function vertexColors(m: THREE.Mesh): THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null {
  const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material;
  const attr = m.geometry.getAttribute('color');
  return mat.vertexColors && attr && attr.itemSize >= 3 ? attr : null;
}

/** Maillage léger d'un coureur, dans le repère de `root` (pose actuelle). */
export function bakeLightGeometry(parts: THREE.Mesh[], root: THREE.Object3D, colorOf?: LightColor): THREE.BufferGeometry {
  _inv.copy(root.matrixWorld).invert();
  let total = 0;
  let totalIdx = 0;
  for (const p of parts) {
    total += p.geometry.getAttribute('position').count;
    totalIdx += p.geometry.index ? p.geometry.index.count : p.geometry.getAttribute('position').count;
  }
  const pos = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  const idx = total > 65535 ? new Uint32Array(totalIdx) : new Uint16Array(totalIdx);
  let vo = 0;
  let io = 0;
  for (const p of parts) {
    const g = p.geometry;
    const src = g.getAttribute('position');
    const skin = p as THREE.SkinnedMesh;
    const c = partColor(p, colorOf);
    const vc = vertexColors(p);
    _m.multiplyMatrices(_inv, p.matrixWorld);
    // Maillage à squelette : sa matrice de liaison inverse n'est remise à jour qu'au rendu (updateMatrixWorld). Pour
    // une pièce jamais dessinée, ou masquée pendant que le coureur roulait, elle datait d'une ancienne position : le
    // corps partait à des dizaines de mètres du vélo. Recalculée ici, comme le fait le rendu.
    if (skin.isSkinnedMesh && skin.bindMode !== THREE.DetachedBindMode) skin.bindMatrixInverse.copy(skin.matrixWorld).invert();
    for (let i = 0; i < src.count; i++) {
      _v.fromBufferAttribute(src, i);
      if (skin.isSkinnedMesh) skin.applyBoneTransform(i, _v);
      _v.applyMatrix4(_m);
      pos[(vo + i) * 3] = _v.x;
      pos[(vo + i) * 3 + 1] = _v.y;
      pos[(vo + i) * 3 + 2] = _v.z;
      col[(vo + i) * 3] = vc ? c.r * vc.getX(i) : c.r;
      col[(vo + i) * 3 + 1] = vc ? c.g * vc.getY(i) : c.g;
      col[(vo + i) * 3 + 2] = vc ? c.b * vc.getZ(i) : c.b;
    }
    if (g.index) for (let k = 0; k < g.index.count; k++) idx[io + k] = (g.index.getX(k) as number) + vo;
    else for (let k = 0; k < src.count; k++) idx[io + k] = k + vo;
    io += g.index ? g.index.count : src.count;
    vo += src.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeVertexNormals();
  out.computeBoundingSphere();
  return out;
}

/** Pièces visibles du rendu détaillé (originaux compris s'ils sont remplacés par une fusion ou retirés car petits). */
function detailParts(group: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  group.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || /^merged-|^rider-light$|^shadow-/.test(m.name)) return;
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    if (mat?.transparent) return;
    out.push(m);
  });
  return out;
}

function cacheKey(parts: THREE.Mesh[], colorOf?: LightColor): string {
  return parts
    .map((p) => {
      const g = p.geometry;
      const mat = (Array.isArray(p.material) ? p.material[0] : p.material) as THREE.MeshStandardMaterial;
      return `${g.name}:${g.getAttribute('position').count}:${mat.map?.image ? (mat.map.image as { width?: number }).width : 0}:${mat.color?.getHexString() ?? ''}:${partColor(p, colorOf).getHexString()}${vertexColors(p) ? `:vc${g.id}` : ''}`;
    })
    .join('|');
}

/**
 * Bascule détaillé ↔ léger pour un coureur. `group` : rendu détaillé (V3Visual.group, ou branche du coureur réaliste
 * ou poly, voir riderDetail.ts) ; `root` : racine du coureur. `frame` : compteur d'images de l'appelant (une
 * construction au plus par image). `colorOf` : couleurs des pièces teintées par nœuds (riderDetail.ts). `ready` :
 * le rendu détaillé est complet et en posture (coureur Bêta : `V3Visual.posed`) ; sinon rien n'est construit.
 */
export function updateRiderLight(root: THREE.Object3D, group: THREE.Object3D, distM: number, frame: number, castShadow: boolean, enabled = RIDER_LIGHT, colorOf?: LightColor, ready = true): void {
  if (!enabled) return;
  let st = states.get(root);
  if (!st) states.set(root, (st = { mesh: null, on: false }));
  const want = st.on ? distM > LIGHT_BACK_M : distM > LIGHT_FROM_M;
  if (want && !st.mesh) {
    // Rendu détaillé pas encore complet ni en posture (coureur Bêta en cours de chargement) : on attend, la version
    // légère fige ce qu'elle voit et n'est jamais refaite.
    if (!ready) return;
    if (lastBuildFrame === frame) return;
    root.updateWorldMatrix(true, true);
    const parts = detailParts(group);
    if (parts.length < 3) return;
    // Taille du coureur (échelle de son rendu dans le repère de la racine) : deux coureurs de même tenue mais de
    // tailles différentes n'ont pas le même maillage.
    _m.copy(root.matrixWorld).invert().multiply(group.matrixWorld);
    const key = `${_m.getMaxScaleOnAxis().toFixed(3)}|${cacheKey(parts, colorOf)}`;
    let geometry = geometryCache.get(key);
    if (!geometry) {
      lastBuildFrame = frame;
      geometry = bakeLightGeometry(parts, root, colorOf);
      geometryCache.set(key, geometry);
    }
    const mesh = new THREE.Mesh(geometry, SHARED_MATERIAL);
    mesh.name = 'rider-light';
    mesh.visible = false;
    root.add(mesh);
    st.mesh = mesh;
  }
  if (!st.mesh) return;
  st.on = want;
  st.mesh.visible = want;
  st.mesh.castShadow = want && castShadow;
  group.visible = !want;
}

/**
 * Maillage témoin de la version légère (un triangle, mêmes attributs et même matériau) : posé le temps de la
 * précompilation du départ. Sans lui, le premier coureur passé au-delà de 60 m compilait son shader en direct.
 */
export function riderLightWarmup(): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0.1, 0, 0, 0, 0.1, 0]), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9).fill(1), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2]), 1));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, SHARED_MATERIAL);
  mesh.castShadow = true;
  return mesh;
}

/** Le coureur n'a pas encore de version légère (il faut que son rendu V3 soit chargé une fois, même de loin). */
export function needsLightBuild(root: THREE.Object3D): boolean {
  return !states.get(root)?.mesh;
}

export function disposeRiderLight(root: THREE.Object3D): void {
  const st = states.get(root);
  if (st?.mesh) root.remove(st.mesh);
  states.delete(root);
}

/** Coureurs actuellement en version légère (mesures). */
export function riderLightCount(roots: Iterable<THREE.Object3D>): number {
  let n = 0;
  for (const r of roots) if (states.get(r)?.on) n++;
  return n;
}
