import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Fusion des pièces des coureurs (inspirée des maillages fusionnés de MyWhoosh, `SM_MERGED_*`, et des LOD de
 * Zwift) : un coureur V3 envoie ~27 appels de dessin (cadre en 3 morceaux, fourche, dérailleurs, 9 morceaux de
 * corps…), et chaque appel coûte ~29 µs de processeur dans three.js (WebGPU), qui est la limite de l'image (mesure
 * du 17/11/2026). Ici, les pièces qui partagent le même matériau et ne bougent pas les unes par rapport aux autres
 * sont dessinées en une seule :
 *  - pièces rigides (cadre, fourche, dérailleurs…) : géométries ramenées dans le repère de leur ancêtre commun ;
 *  - pièces du corps (même squelette) : géométries ramenées dans l'espace de liaison, un seul maillage animé.
 * Rien n'est touché dans les fichiers du style V3 : les originaux sont seulement retirés du rendu (calque 0) et
 * remplacés par la pièce fusionnée. Dès qu'un original change (garde-robe, niveau de détail, pièce qui se met à
 * bouger), la fusion est défaite, puis refaite plus tard. Les géométries fusionnées sont partagées entre coureurs
 * (même vélo, même tenue) : peu de mémoire en plus.
 */

/**
 * Actif par défaut depuis le 18/11/2026 (?ridermerge=0 pour comparer). Mesure du 17/11 en V3 medium : appels de
 * dessin 378–431 → 308–325 par image ; cadence trop bruitée sur la machine de mesure pour être chiffrée.
 */
export const RIDER_MERGE = typeof location !== 'undefined' && new URLSearchParams(location.search).get('ridermerge') !== '0';

interface Member {
  mesh: THREE.Mesh;
  /** Masque de calques d'origine (rétabli à la défusion). */
  mask: number;
  /** Matrice du membre dans le repère de l'ancre au moment de la fusion (pièces rigides). */
  rel?: THREE.Matrix4;
}

interface Merge {
  proxy: THREE.Mesh;
  anchor: THREE.Object3D;
  members: Member[];
  skinned: boolean;
}

interface RiderState {
  merges: Merge[];
  /** Repérage : position de chaque pièce rigide candidate dans le repère du coureur, relevée une première fois. */
  probe: Map<THREE.Mesh, THREE.Matrix4> | null;
  probeAt: number;
  /** Image (compteur de l'appelant) avant laquelle on ne retente pas de fusion. */
  retryAt: number;
  /** Signature des pièces visibles au moment de la fusion. */
  signature: string;
}

const states = new WeakMap<THREE.Object3D, RiderState>();
/** Compteurs (mesures) : fusions créées, défaites, géométries construites (hors cache). */
export const riderMergeCounters = { built: 0, dissolved: 0, geometries: 0, reasons: {} as Record<string, number> };
const geometryCache = new Map<string, { geometry: THREE.BufferGeometry; users: number }>();
const _inv = new THREE.Matrix4();
const _rel = new THREE.Matrix4();

function drawableMeshes(root: THREE.Object3D, skip: Set<THREE.Object3D>): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !skip.has(m)) out.push(m);
  });
  return out;
}

function attrSignature(g: THREE.BufferGeometry): string {
  return `${Object.keys(g.attributes).sort().join(',')}|${g.index ? 'i' : 'n'}|${Object.keys(g.morphAttributes).length}`;
}

/** Pièce candidate : un seul matériau, pas de morphes, pas transparente (l'ordre de tri compterait). */
function mergeable(m: THREE.Mesh): boolean {
  if (m.name.startsWith('shadow-')) return false;
  if (Array.isArray(m.material)) return false;
  if (Object.keys(m.geometry.morphAttributes).length) return false;
  if (m.material.transparent) return false;
  if ((m as THREE.InstancedMesh).isInstancedMesh) return false;
  return m.layers.mask !== 0;
}

function lowestCommonAncestor(meshes: THREE.Object3D[], stop: THREE.Object3D): THREE.Object3D {
  const chain = (o: THREE.Object3D) => {
    const c: THREE.Object3D[] = [];
    for (let p: THREE.Object3D | null = o.parent; p; p = p.parent) {
      c.push(p);
      if (p === stop) break;
    }
    return c;
  };
  let common = chain(meshes[0] as THREE.Object3D);
  for (const m of meshes.slice(1)) {
    const set = new Set(chain(m));
    common = common.filter((p) => set.has(p));
  }
  return common[0] ?? stop;
}

/**
 * Empreinte du contenu d'une géométrie : chaque coureur charge sa propre copie des modèles (identifiants
 * différents), mais deux copies du même modèle ont le même contenu. Sommets, index et un échantillon des positions.
 */
const contentKeys = new WeakMap<THREE.BufferGeometry, string>();
function contentKey(g: THREE.BufferGeometry): string {
  let k = contentKeys.get(g);
  if (k) return k;
  const pos = g.getAttribute('position');
  const arr = pos.array as ArrayLike<number>;
  let h = 0;
  const step = Math.max(1, Math.floor(arr.length / 97));
  for (let i = 0; i < arr.length; i += step) h = (h * 31 + Math.round((arr[i] as number) * 1e4)) | 0;
  k = `${g.name}|${pos.count}|${g.index?.count ?? 0}|${h}`;
  contentKeys.set(g, k);
  return k;
}

function roundedKey(m: THREE.Matrix4): string {
  return m.elements.map((x) => Math.round(x * 1e4)).join(',');
}

function cachedGeometry(key: string, build: () => THREE.BufferGeometry | null): THREE.BufferGeometry | null {
  const hit = geometryCache.get(key);
  if (hit) {
    hit.users++;
    return hit.geometry;
  }
  const geometry = build();
  riderMergeCounters.geometries++;
  if (!geometry) return null;
  geometryCache.set(key, { geometry, users: 1 });
  return geometry;
}

function releaseGeometry(g: THREE.BufferGeometry): void {
  for (const [k, v] of geometryCache) {
    if (v.geometry !== g) continue;
    if (--v.users <= 0) {
      v.geometry.dispose();
      geometryCache.delete(k);
    }
    return;
  }
}

/** Fusion rigide : géométries dans le repère de `anchor`. */
export function buildRigidGeometry(members: THREE.Mesh[], anchor: THREE.Object3D): { geometry: THREE.BufferGeometry; rels: THREE.Matrix4[] } | null {
  _inv.copy(anchor.matrixWorld).invert();
  const rels = members.map((m) => new THREE.Matrix4().multiplyMatrices(_inv, m.matrixWorld));
  const key = 'r|' + members.map((m, i) => `${contentKey(m.geometry)}@${roundedKey(rels[i] as THREE.Matrix4)}`).join(';');
  const geometry = cachedGeometry(key, () => {
    const parts = members.map((m, i) => m.geometry.clone().applyMatrix4(rels[i] as THREE.Matrix4));
    const merged = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    merged?.computeBoundingSphere();
    return merged;
  });
  return geometry ? { geometry, rels } : null;
}

/** Fusion animée : géométries dans l'espace de liaison (bindMatrix), même squelette. */
export function buildSkinnedGeometry(members: THREE.SkinnedMesh[]): THREE.BufferGeometry | null {
  const key = 's|' + members.map((m) => `${contentKey(m.geometry)}@${roundedKey(m.bindMatrix)}`).join(';');
  return cachedGeometry(key, () => {
    const parts = members.map((m) => {
      const g = m.geometry.clone();
      // applyMatrix4 transforme position, normale et tangente ; skinIndex / skinWeight restent valables (même squelette).
      g.applyMatrix4(m.bindMatrix);
      return g;
    });
    const merged = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    merged?.computeBoundingSphere();
    return merged;
  });
}

function hide(member: Member): void {
  member.mesh.layers.mask = 0;
}

function dissolve(state: RiderState): void {
  if (state.merges.length) riderMergeCounters.dissolved++;
  for (const mg of state.merges) {
    mg.anchor.remove(mg.proxy);
    releaseGeometry(mg.proxy.geometry);
    for (const m of mg.members) if (m.mesh.layers.mask === 0) m.mesh.layers.mask = m.mask;
  }
  state.merges = [];
  state.signature = '';
}

/** Les originaux sont-ils toujours là, visibles, et immobiles les uns par rapport aux autres ? */
const why = (r: string): false => {
  riderMergeCounters.reasons[r] = (riderMergeCounters.reasons[r] ?? 0) + 1;
  return false;
};

function stillValid(mg: Merge, root: THREE.Object3D): boolean {
  for (const m of mg.members) {
    if (!m.mesh.visible) return why('masqué');
    // Toujours rattaché au coureur et visible le long de la branche.
    for (let p: THREE.Object3D | null = m.mesh.parent; p && p !== root; p = p.parent) if (!p.visible) return why('branche masquée');
    if (!m.mesh.parent) return why('détaché');
    if (m.rel) {
      _inv.copy(mg.anchor.matrixWorld).invert();
      _rel.multiplyMatrices(_inv, m.mesh.matrixWorld);
      const a = _rel.elements;
      const b = m.rel.elements;
      for (let i = 0; i < 16; i++) if (Math.abs((a[i] as number) - (b[i] as number)) > 1e-3) return why('a bougé');
    }
  }
  return true;
}

/** Position d'une pièce dans le repère du coureur. */
function relToRoot(m: THREE.Object3D, root: THREE.Object3D): THREE.Matrix4 {
  return new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(m.matrixWorld);
}

function sameMatrix(a: THREE.Matrix4, b: THREE.Matrix4): boolean {
  for (let i = 0; i < 16; i++) if (Math.abs((a.elements[i] as number) - (b.elements[i] as number)) > 1e-3) return false;
  return true;
}

/** Plus grand ensemble de pièces restées immobiles les unes par rapport aux autres depuis le repérage. */
function stableSubset(list: THREE.Mesh[], probe: Map<THREE.Mesh, THREE.Matrix4>, root: THREE.Object3D): THREE.Mesh[] {
  const now = list.map((m) => relToRoot(m, root));
  const then = list.map((m) => probe.get(m) as THREE.Matrix4);
  const pair = (a: number, b: number, mats: THREE.Matrix4[]) => new THREE.Matrix4().copy(mats[a] as THREE.Matrix4).invert().multiply(mats[b] as THREE.Matrix4);
  let best: THREE.Mesh[] = [];
  for (let i = 0; i < list.length; i++) {
    const keep = list.filter((_, j) => j === i || sameMatrix(pair(i, j, then), pair(i, j, now)));
    if (keep.length > best.length) best = keep;
  }
  return best;
}

function tryMerge(root: THREE.Object3D, state: RiderState): void {
  const proxies = new Set<THREE.Object3D>();
  const probe = state.probe;
  // Pièces rigides : seulement celles déjà repérées (le mouvement est jugé plus bas, pièce par pièce).
  const meshes = drawableMeshes(root, proxies)
    .filter(mergeable)
    .filter((m) => (m as THREE.SkinnedMesh).isSkinnedMesh || probe?.has(m));
  // Groupes : même matériau, même nature (rigide / animé, même squelette), mêmes attributs.
  const groups = new Map<string, THREE.Mesh[]>();
  for (const m of meshes) {
    const skin = m as THREE.SkinnedMesh;
    const k = `${(m.material as THREE.Material).uuid}|${skin.isSkinnedMesh ? 's' + skin.skeleton.uuid : 'r'}|${attrSignature(m.geometry)}|${m.castShadow ? 1 : 0}`;
    const list = groups.get(k);
    if (list) list.push(m);
    else groups.set(k, [m]);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const first = list[0] as THREE.Mesh;
    const material = first.material as THREE.Material;
    if ((first as THREE.SkinnedMesh).isSkinnedMesh) {
      const skins = list as THREE.SkinnedMesh[];
      if (skins.some((s) => s.bindMode !== 'attached')) continue;
      const geometry = buildSkinnedGeometry(skins);
      if (!geometry) continue;
      const proxy = new THREE.SkinnedMesh(geometry, material);
      proxy.name = 'merged-skin';
      proxy.frustumCulled = false;
      proxy.castShadow = first.castShadow;
      proxy.receiveShadow = first.receiveShadow;
      const anchor = first.parent as THREE.Object3D;
      anchor.add(proxy);
      proxy.bind((first as THREE.SkinnedMesh).skeleton, new THREE.Matrix4());
      const members = skins.map((mesh) => ({ mesh, mask: mesh.layers.mask }));
      members.forEach(hide);
      state.merges.push({ proxy, anchor, members, skinned: true });
    } else {
      // Pièces immobiles les unes par rapport aux autres entre le repérage et maintenant : le balancement du vélo
      // les déplace toutes ensemble, mais un pédalier ou une roue tourne par rapport aux autres.
      const still = stableSubset(list, probe as Map<THREE.Mesh, THREE.Matrix4>, root);
      if (still.length < 2) continue;
      list.length = 0;
      list.push(...still);
      const anchor = lowestCommonAncestor(list, root);
      anchor.updateWorldMatrix(true, true);
      const built = buildRigidGeometry(list, anchor);
      if (!built) continue;
      const proxy = new THREE.Mesh(built.geometry, material);
      proxy.name = 'merged-rigid';
      proxy.castShadow = first.castShadow;
      proxy.receiveShadow = first.receiveShadow;
      anchor.add(proxy);
      const members = list.map((mesh, i) => ({ mesh, mask: mesh.layers.mask, rel: built.rels[i] as THREE.Matrix4 }));
      members.forEach(hide);
      state.merges.push({ proxy, anchor, members, skinned: false });
    }
  }
  riderMergeCounters.built += state.merges.length;
  state.signature = signatureOf(root, state);
}

function signatureOf(root: THREE.Object3D, state: RiderState): string {
  const proxies = new Set<THREE.Object3D>(state.merges.map((m) => m.proxy));
  return drawableMeshes(root, proxies).map((m) => m.id).join(',');
}

/**
 * À appeler pour chaque coureur IA (style V3) quelques fois par seconde : vérifie les fusions en place, les défait
 * si un original a changé, et (re)fusionne quand le coureur est stable. `frame` : compteur d'images de l'appelant.
 */
export function updateRiderMerge(root: THREE.Object3D, frame: number, enabled = RIDER_MERGE): void {
  if (!enabled) return;
  let state = states.get(root);
  if (!state) states.set(root, (state = { merges: [], retryAt: frame + 30, signature: '', probe: null, probeAt: 0 }));
  if (state.merges.length) {
    if (state.merges.every((mg) => stillValid(mg, root))) return;
    dissolve(state);
    // Changement en cours (garde-robe, niveau de détail) : on laisse le coureur se stabiliser.
    state.retryAt = frame + 60;
    return;
  }
  if (frame < state.retryAt) return;
  root.updateWorldMatrix(true, true);
  // Premier temps : repérage des pièces rigides ; second temps (≥ 12 images plus tard) : fusion de celles qui n'ont
  // pas bougé (un pédalier ou une roue tourne entre les deux relevés).
  if (!state.probe) {
    state.probe = new Map(drawableMeshes(root, new Set()).filter((m) => mergeable(m) && !(m as THREE.SkinnedMesh).isSkinnedMesh).map((m) => [m, relToRoot(m, root)]));
    state.probeAt = frame + 12;
    return;
  }
  if (frame < state.probeAt) return;
  tryMerge(root, state);
  state.probe = null;
  if (!state.merges.length) state.retryAt = frame + 240;
}

/** Fusion retirée (coureur supprimé). */
export function disposeRiderMerge(root: THREE.Object3D): void {
  const state = states.get(root);
  if (state) dissolve(state);
  states.delete(root);
}

/** Nombre de pièces fusionnées en place (mesures). */
export function riderMergeStats(roots: Iterable<THREE.Object3D>): { merges: number; members: number } {
  let merges = 0;
  let members = 0;
  for (const r of roots) {
    const s = states.get(r);
    if (!s) continue;
    merges += s.merges.length;
    for (const m of s.merges) members += m.members.length;
  }
  return { merges, members };
}
