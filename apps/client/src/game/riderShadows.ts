import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Ombres des coureurs V3 selon le budget d'ombres du jeu (shadowBudget.ts), inspiré du `ShadowBodyMesh` de
 * MyWhoosh : seules des formes simples projettent l'ombre. Mesures :
 *  - 17/11/2026 : le budget ne s'appliquait qu'aux anciens modèles ; 254 pièces V3 (chaussures, cheveux, casques,
 *    lunettes, vélos entiers) projetaient une ombre sur 23 coureurs, de nuit comme de jour ;
 *  - 18/11/2026 : un coureur dans le budget dessinait encore 15 à 17 pièces dans chaque zone d'ombre.
 *
 * Coureur dans le budget : deux formes d'ombre, invisibles à l'écran (calque réservé aux caméras d'ombre) :
 *  - le corps : toutes ses pièces animées fusionnées, sur le même squelette (l'ombre pédale) ;
 *  - le vélo et les pièces rigides : un bloc figé dans le repère du coureur (une roue qui tourne a la même ombre).
 * Les pièces détaillées ne projettent plus rien. Une ombre n'a pas besoin de textures : matériau unique.
 * Coureur hors budget (loin, trop nombreux, nuit) : aucune ombre. Coureur en version légère (riderLight.ts) : son
 * maillage unique.
 */

/** ?shadowproxy=0 : pièces détaillées dans les ombres (comparaison). */
export const SHADOW_PROXY = typeof location !== 'undefined' && new URLSearchParams(location.search).get('shadowproxy') !== '0';
/** Calque vu seulement par les caméras d'ombre. */
export const SHADOW_LAYER = 5;
const MIN_RADIUS_M = 0.2;
const SHADOW_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x000000 });
const _s = new THREE.Vector3();
const _inv = new THREE.Matrix4();
const _m = new THREE.Matrix4();

function bigRigid(m: THREE.Mesh): boolean {
  const cached = m.userData.shadowBig as boolean | undefined;
  if (cached !== undefined) return cached;
  if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
  m.getWorldScale(_s);
  const big = (m.geometry.boundingSphere?.radius ?? 0) * Math.max(_s.x, _s.y, _s.z) >= MIN_RADIUS_M;
  m.userData.shadowBig = big;
  return big;
}

interface ShadowState {
  body: THREE.SkinnedMesh | null;
  bike: THREE.Mesh | null;
  /** Pièces visibles au moment de la construction (identifiants) : la garde-robe ou le LOD change → reconstruction. */
  signature: string;
  checkAt: number;
}
const states = new WeakMap<THREE.Object3D, ShadowState>();
const cache = new Map<string, THREE.BufferGeometry>();
let tick = 0;
/**
 * Dernière répartition des ombres de chaque coureur (projeteur, formes d'ombre, version légère) : le parcours de
 * ses ~800 nœuds n'est refait que si elle change, ou toutes les 30 images pour les pièces apparues entre-temps
 * (fusion, LOD). Avant, il l'était à chaque image pour chaque coureur (profil du 18/11/2026).
 */
const applied = new WeakMap<THREE.Object3D, { key: string; left: number }>();

/** Positions seulement (plus les poids des os pour le corps) : l'ombre n'a besoin que de la forme. */
function positionsOnly(g: THREE.BufferGeometry, skinned: boolean): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', g.getAttribute('position').clone());
  if (skinned) {
    out.setAttribute('skinIndex', g.getAttribute('skinIndex').clone());
    out.setAttribute('skinWeight', g.getAttribute('skinWeight').clone());
  }
  const idx = g.index ?? null;
  if (idx) out.setIndex(idx.clone());
  else {
    const n = g.getAttribute('position').count;
    const a = new Uint32Array(n);
    for (let i = 0; i < n; i++) a[i] = i;
    out.setIndex(new THREE.BufferAttribute(a, 1));
  }
  return out;
}

function partsOf(group: THREE.Object3D): { skins: THREE.SkinnedMesh[]; rigid: THREE.Mesh[] } {
  const skins: THREE.SkinnedMesh[] = [];
  const rigid: THREE.Mesh[] = [];
  group.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || /^merged-|^rider-light$|^shadow-/.test(m.name)) return;
    const sk = m as THREE.SkinnedMesh;
    if (sk.isSkinnedMesh) {
      if (sk.bindMode === 'attached' && sk.geometry.getAttribute('skinIndex')) skins.push(sk);
    } else if (bigRigid(m)) rigid.push(m);
  });
  return { skins, rigid };
}

/** Corps d'ombre : pièces animées ramenées dans l'espace de liaison (même squelette, matrice de liaison identité). */
export function buildShadowBody(skins: THREE.SkinnedMesh[]): THREE.BufferGeometry | null {
  if (!skins.length) return null;
  const skeleton = skins[0]!.skeleton;
  const same = skins.filter((s) => s.skeleton === skeleton);
  const key = 'b|' + same.map((s) => `${s.geometry.uuid}`).join(';');
  let g = cache.get(key);
  if (!g) {
    const parts = same.map((s) => positionsOnly(s.geometry, true).applyMatrix4(s.bindMatrix));
    g = mergeGeometries(parts, false) ?? undefined;
    parts.forEach((p) => p.dispose());
    if (!g) return null;
    cache.set(key, g);
  }
  return g;
}

/** Bloc d'ombre rigide : pièces rigides dans le repère de `frame` (pose actuelle, roues et pédalier figés). */
export function buildShadowBike(rigid: THREE.Mesh[], frame: THREE.Object3D): THREE.BufferGeometry | null {
  if (!rigid.length) return null;
  _inv.copy(frame.matrixWorld).invert();
  const parts = rigid.map((m) => positionsOnly(m.geometry, false).applyMatrix4(_m.multiplyMatrices(_inv, m.matrixWorld)));
  const g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return g;
}

/** Les caméras d'ombre (soleil / lune et zones d'ombre en cascade) voient le calque des formes d'ombre. */
function enableShadowLayer(scene: THREE.Object3D | null): void {
  if (!scene) return;
  scene.traverse((o) => {
    const l = o as THREE.DirectionalLight;
    if (!l.isDirectionalLight || !l.castShadow) return;
    l.shadow.camera.layers.enable(SHADOW_LAYER);
    const node = (l.shadow as unknown as { shadowNode?: { lights?: THREE.DirectionalLight[] } }).shadowNode;
    for (const c of node?.lights ?? []) c.shadow?.camera.layers.enable(SHADOW_LAYER);
  });
}

function sceneOf(o: THREE.Object3D): THREE.Object3D | null {
  let p: THREE.Object3D | null = o;
  while (p?.parent) p = p.parent;
  return (p as THREE.Scene)?.isScene ? p : null;
}

function signature(group: THREE.Object3D): string {
  const ids: number[] = [];
  group.traverseVisible((o) => {
    if ((o as THREE.Mesh).isMesh && !/^merged-|^rider-light$|^shadow-/.test(o.name)) ids.push(o.id);
  });
  return ids.join(',');
}

function dropProxies(st: ShadowState): void {
  st.body?.parent?.remove(st.body);
  st.bike?.parent?.remove(st.bike);
  st.bike?.geometry.dispose();
  st.body = null;
  st.bike = null;
}

/**
 * Applique le budget d'ombre à un coureur V3. `root` : racine du coureur ; `group` : rendu détaillé V3 (pour les
 * formes d'ombre) ; `caster` : le coureur projette-t-il une ombre (budget du jeu).
 */
export function applyRiderShadows(root: THREE.Object3D, caster: boolean, group?: THREE.Object3D, enabled = SHADOW_PROXY): void {
  tick++;
  const light = !!group && !group.visible; // version légère : le rendu détaillé est masqué
  let st = states.get(root);
  if (enabled && group && caster && !light) {
    if (!st) states.set(root, (st = { body: null, bike: null, signature: '', checkAt: 0 }));
    if (tick >= st.checkAt) {
      st.checkAt = tick + 30;
      const sig = signature(group);
      if (sig !== st.signature) {
        dropProxies(st);
        st.signature = sig;
        // Formes d'ombre refaites : répartition à revoir tout de suite.
        applied.delete(root);
        group.updateWorldMatrix(true, true);
        const { skins, rigid } = partsOf(group);
        const bodyGeo = buildShadowBody(skins);
        if (bodyGeo) {
          const body = new THREE.SkinnedMesh(bodyGeo, SHADOW_MATERIAL);
          body.name = 'shadow-body';
          body.frustumCulled = false;
          body.layers.set(SHADOW_LAYER);
          (skins[0]!.parent as THREE.Object3D).add(body);
          body.bind(skins[0]!.skeleton, new THREE.Matrix4());
          st.body = body;
        }
        const bikeGeo = buildShadowBike(rigid, group);
        if (bikeGeo) {
          const bike = new THREE.Mesh(bikeGeo, SHADOW_MATERIAL);
          bike.name = 'shadow-bike';
          bike.layers.set(SHADOW_LAYER);
          group.add(bike);
          st.bike = bike;
        }
        enableShadowLayer(sceneOf(root));
      }
    }
  }
  const proxies = !!st && (!!st.body || !!st.bike) && enabled && caster && !light;
  const key = `${caster ? 1 : 0}${proxies ? 1 : 0}${light ? 1 : 0}`;
  const last = applied.get(root);
  if (last && last.key === key && --last.left > 0) return;
  applied.set(root, { key, left: 30 });
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    let cast: boolean;
    if (!caster) cast = false;
    else if (m.name === 'rider-light') cast = true;
    else if (m.name === 'shadow-body' || m.name === 'shadow-bike') cast = proxies;
    else if (proxies) cast = false;
    else cast = (m as THREE.SkinnedMesh).isSkinnedMesh || bigRigid(m);
    if (m.castShadow !== cast) m.castShadow = cast;
  });
}

/** Formes d'ombre retirées (coureur supprimé). */
export function disposeRiderShadows(root: THREE.Object3D): void {
  const st = states.get(root);
  if (st) dropProxies(st);
  states.delete(root);
  applied.delete(root);
}
