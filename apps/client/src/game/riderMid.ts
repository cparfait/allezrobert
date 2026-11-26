import * as THREE from 'three/webgpu';
import { partColor, type LightColor } from './riderLight.ts';
import { disposeRiderMerge } from './riderMerge.ts';

/**
 * Niveau de détail intermédiaire des coureurs IA réalistes (chantier « FPS à 40 coureurs », 26/11/2026). De près, un
 * coureur réaliste envoie 55 à 73 appels de dessin (47 matériaux : corps en 7 morceaux, chaussures en 7, cadre, cintre,
 * roues en 7 à 8 pièces…) ; à 40 en course, c'est la limite de l'image (processeur, ~40 µs par appel dans three.js).
 * Au-delà de MID_FROM_M, les pièces sont redessinées en quelques maillages à couleurs de sommets (couleur moyenne de
 * chaque pièce, comme la version légère au-delà de 60 m, riderLight.ts) :
 *  - toutes les pièces animées par les mêmes os en un seul maillage animé (espace de liaison, morphes figés) : il pédale ;
 *  - les pièces rigides immobiles les unes par rapport aux autres (cadre, cintre, selle…) en un seul maillage ;
 *  - celles qui bougent (roues, pédalier, pédales) regroupées par parent, qui les fait tourner.
 * Pièces laissées telles quelles : transparentes ou à découpe (cheveux). Les originaux sont retirés du rendu par leur
 * calque (comme riderMerge.ts), dont la fusion par matériau est défaite tant que ce niveau est en place.
 * `?ridermid=0` pour comparer.
 */
export const RIDER_MID = typeof location !== 'undefined' && new URLSearchParams(location.search).get('ridermid') !== '0';
/** Distance de bascule (m) et marge de retour. Coureur à 20 m : ~65 px de haut en 1080p, imprimés du maillot illisibles. */
export const MID_FROM_M = 20;
const MID_BACK_M = 17;
/** Contrôle des pièces remplacées, une image sur N par coureur. */
const CHECK_EVERY = 10;
/** Repérage des pièces rigides : positions relevées puis comparées N images plus tard (une roue tourne entre-temps). */
const PROBE_FRAMES = 8;

const MATERIAL = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.05 });
MATERIAL.name = 'rider-mid';

interface Member {
  mesh: THREE.Mesh;
  mask: number;
  /** Pièce rigide : repère auquel elle est fusionnée, et sa matrice dans ce repère au moment de la fusion. */
  anchor?: THREE.Object3D;
  rel?: THREE.Matrix4;
}

/** Maillages fusionnés d'un état du coureur (un par niveau de détail de son modèle, gardés d'une bascule à l'autre). */
interface Build {
  proxies: THREE.Mesh[];
  members: Member[];
}

interface MidState {
  /** Fusion correspondant à ce qui est affiché, ou null ; `on` : elle remplace les originaux. */
  cur: Build | null;
  on: boolean;
  /** Fusions construites (au plus MAX_BUILDS) : la bascule à 30 m du modèle réaliste n'en refait pas une à chaque fois. */
  builds: Build[];
  /** Pièces vues bouger dans le bloc immobile : regroupées avec leur seul parent aux constructions suivantes. */
  moving: WeakSet<THREE.Object3D>;
  /** Pièces vues bouger par rapport à leur parent (elles tournent elles-mêmes) : laissées telles quelles. */
  spinning: WeakSet<THREE.Object3D>;
  /** Repérage en cours : matrice de chaque pièce rigide dans le repère du coureur. */
  probe: Map<THREE.Mesh, THREE.Matrix4> | null;
  probeAt: number;
}

/** Fusions gardées par coureur (niveaux 1 et 2 du modèle réaliste, plus une marge). */
const MAX_BUILDS = 3;

const states = new WeakMap<THREE.Object3D, MidState>();
const geometryCache = new Map<string, { geometry: THREE.BufferGeometry; users: number }>();
/** Une seule construction par image (à-coups). */
let lastBuildFrame = -1;
/** Compteurs (mesures). */
export const riderMidCounters = { built: 0, dissolved: 0, geometries: 0, reasons: {} as Record<string, number> };
const why = (r: string): false => {
  riderMidCounters.reasons[r] = (riderMidCounters.reasons[r] ?? 0) + 1;
  return false;
};

const _m = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const _n = new THREE.Matrix3();
const _v = new THREE.Vector3();
const _d = new THREE.Vector3();

/** Pièce que ce niveau peut remplacer. */
function replaceable(m: THREE.Mesh): boolean {
  if (/^merged-|^rider-light$|^shadow-/.test(m.name)) return false;
  if (Array.isArray(m.material)) return false;
  const mat = m.material as THREE.Material;
  if (mat.transparent || mat.alphaTest > 0 || mat.userData.nearFadeBase !== undefined) return false;
  if ((m as THREE.InstancedMesh).isInstancedMesh) return false;
  return m.layers.mask !== 0 && !!m.geometry.getAttribute('position');
}

function visibleParts(group: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  group.traverseVisible((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
}

const contentIds = new WeakMap<THREE.BufferGeometry, string>();
function contentKey(g: THREE.BufferGeometry): string {
  let k = contentIds.get(g);
  if (k) return k;
  const pos = g.getAttribute('position');
  let h = 0;
  const step = Math.max(1, Math.floor(pos.count / 97));
  for (let i = 0; i < pos.count; i += step) h = (h * 31 + Math.round(pos.getX(i) * 1e4) + Math.round(pos.getY(i) * 1e3)) | 0;
  k = `${g.name}|${pos.count}|${g.index?.count ?? 0}|${h}`;
  contentIds.set(g, k);
  return k;
}

const round = (m: THREE.Matrix4) => m.elements.map((x) => Math.round(x * 1e4)).join(',');
const morphKey = (m: THREE.Mesh) => (m.morphTargetInfluences?.some((w) => w !== 0) ? m.morphTargetInfluences.map((w) => w.toFixed(2)).join(',') : '');

/** Position d'un sommet, morphes appliqués avec leurs poids actuels. */
function morphedPosition(m: THREE.Mesh, i: number, out: THREE.Vector3): THREE.Vector3 {
  const g = m.geometry;
  out.fromBufferAttribute(g.getAttribute('position'), i);
  const morphs = g.morphAttributes.position;
  const w = m.morphTargetInfluences;
  if (!morphs || !w) return out;
  const base = g.morphTargetsRelative ? null : out.clone();
  for (let k = 0; k < morphs.length; k++) {
    const wk = w[k] ?? 0;
    if (wk === 0) continue;
    _d.fromBufferAttribute(morphs[k] as THREE.BufferAttribute, i);
    if (base) _d.sub(base);
    out.addScaledVector(_d, wk);
  }
  return out;
}

/**
 * Géométrie fusionnée à couleurs de sommets : chaque pièce passée par sa matrice (`mats`), sa couleur moyenne en couleur
 * de sommets ; `skinned` : indices et poids d'os repris (mêmes os). Exportée pour les tests.
 */
export function buildMidGeometry(parts: readonly THREE.Mesh[], mats: readonly THREE.Matrix4[], colors: readonly THREE.Color[], skinned: boolean): THREE.BufferGeometry {
  let vtx = 0;
  let idx = 0;
  for (const p of parts) {
    const n = p.geometry.getAttribute('position').count;
    vtx += n;
    idx += p.geometry.index ? p.geometry.index.count : n;
  }
  const pos = new Float32Array(vtx * 3);
  const nor = new Float32Array(vtx * 3);
  const col = new Float32Array(vtx * 3);
  const si = skinned ? new Uint16Array(vtx * 4) : null;
  const sw = skinned ? new Float32Array(vtx * 4) : null;
  const index = vtx > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
  let vo = 0;
  let io = 0;
  parts.forEach((p, k) => {
    const g = p.geometry;
    const count = g.getAttribute('position').count;
    const nrm = g.getAttribute('normal');
    const skI = g.getAttribute('skinIndex');
    const skW = g.getAttribute('skinWeight');
    const m = mats[k] as THREE.Matrix4;
    _n.getNormalMatrix(m);
    const c = colors[k] as THREE.Color;
    for (let i = 0; i < count; i++) {
      const o = (vo + i) * 3;
      morphedPosition(p, i, _v).applyMatrix4(m);
      pos[o] = _v.x;
      pos[o + 1] = _v.y;
      pos[o + 2] = _v.z;
      if (nrm) {
        _v.fromBufferAttribute(nrm, i).applyMatrix3(_n).normalize();
        nor[o] = _v.x;
        nor[o + 1] = _v.y;
        nor[o + 2] = _v.z;
      }
      col[o] = c.r;
      col[o + 1] = c.g;
      col[o + 2] = c.b;
      if (si && sw && skI && skW) {
        for (let j = 0; j < 4; j++) {
          si[(vo + i) * 4 + j] = skI.getComponent(i, j);
          sw[(vo + i) * 4 + j] = skW.getComponent(i, j);
        }
      }
    }
    if (g.index) for (let j = 0; j < g.index.count; j++) index[io + j] = g.index.getX(j) + vo;
    else for (let j = 0; j < count; j++) index[io + j] = j + vo;
    io += g.index ? g.index.count : count;
    vo += count;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (si && sw) {
    out.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    out.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  }
  out.setIndex(new THREE.BufferAttribute(index, 1));
  if (parts.some((p) => !p.geometry.getAttribute('normal'))) out.computeVertexNormals();
  out.computeBoundingSphere();
  return out;
}

function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  const hit = geometryCache.get(key);
  if (hit) {
    hit.users++;
    return hit.geometry;
  }
  const geometry = make();
  riderMidCounters.geometries++;
  geometryCache.set(key, { geometry, users: 1 });
  return geometry;
}

function release(g: THREE.BufferGeometry): void {
  for (const [k, v] of geometryCache) {
    if (v.geometry !== g) continue;
    if (--v.users <= 0) {
      v.geometry.dispose();
      geometryCache.delete(k);
    }
    return;
  }
}

/** Deux squelettes aux mêmes os et mêmes poses de liaison (chaque pièce du corps a son propre objet Skeleton). */
function sameSkeleton(a: THREE.Skeleton, b: THREE.Skeleton): boolean {
  if (a === b) return true;
  if (a.bones.length !== b.bones.length) return false;
  for (let i = 0; i < a.bones.length; i++) {
    if (a.bones[i] !== b.bones[i]) return false;
    const x = (a.boneInverses[i] as THREE.Matrix4).elements;
    const y = (b.boneInverses[i] as THREE.Matrix4).elements;
    for (let j = 0; j < 16; j++) if (Math.abs((x[j] as number) - (y[j] as number)) > 1e-5) return false;
  }
  return true;
}

function relTo(anchor: THREE.Object3D, m: THREE.Object3D): THREE.Matrix4 {
  return new THREE.Matrix4().copy(anchor.matrixWorld).invert().multiply(m.matrixWorld);
}

function sameMatrix(a: THREE.Matrix4, b: THREE.Matrix4, eps = 1e-3): boolean {
  for (let i = 0; i < 16; i++) if (Math.abs((a.elements[i] as number) - (b.elements[i] as number)) > eps) return false;
  return true;
}

/** Plus grand ensemble de pièces restées immobiles les unes par rapport aux autres entre le repérage et maintenant. */
function stableSubset(list: THREE.Mesh[], probe: Map<THREE.Mesh, THREE.Matrix4>, root: THREE.Object3D): THREE.Mesh[] {
  const now = list.map((m) => relTo(root, m));
  const then = list.map((m) => probe.get(m) as THREE.Matrix4);
  const pair = (a: number, b: number, mats: THREE.Matrix4[]) => _m.copy(mats[a] as THREE.Matrix4).invert().multiply(mats[b] as THREE.Matrix4).clone();
  let best: THREE.Mesh[] = [];
  for (let i = 0; i < list.length; i++) {
    const keep = list.filter((_, j) => j === i || sameMatrix(pair(i, j, then), pair(i, j, now)));
    if (keep.length > best.length) best = keep;
    if (best.length > list.length / 2) break;
  }
  return best;
}

function lowestCommonAncestor(meshes: THREE.Object3D[], stop: THREE.Object3D): THREE.Object3D {
  const chain = (o: THREE.Object3D) => {
    const c: THREE.Object3D[] = [];
    for (let p = o.parent; p; p = p.parent) {
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

function addRigid(b: Build, list: THREE.Mesh[], anchor: THREE.Object3D, colorOf?: LightColor): void {
  const rels = list.map((m) => relTo(anchor, m));
  const colors = list.map((m) => partColor(m, colorOf));
  const key = 'r|' + list.map((m, i) => `${contentKey(m.geometry)}@${round(rels[i] as THREE.Matrix4)}#${(colors[i] as THREE.Color).getHexString()}${morphKey(m)}`).join(';');
  const geometry = cached(key, () => buildMidGeometry(list, rels, colors, false));
  const proxy = new THREE.Mesh(geometry, MATERIAL);
  proxy.name = 'merged-mid';
  proxy.castShadow = list.some((m) => m.castShadow);
  proxy.receiveShadow = (list[0] as THREE.Mesh).receiveShadow;
  proxy.visible = false;
  anchor.add(proxy);
  b.proxies.push(proxy);
  list.forEach((mesh, i) => b.members.push({ mesh, mask: mesh.layers.mask, anchor, rel: rels[i] as THREE.Matrix4 }));
}

/** Construit les maillages fusionnés du coureur tel qu'il est affiché (sans les montrer). */
function build(root: THREE.Object3D, group: THREE.Object3D, st: MidState, colorOf?: LightColor): Build {
  const b: Build = { proxies: [], members: [] };
  disposeRiderMerge(root);
  root.updateWorldMatrix(true, true);
  const parts = visibleParts(group).filter(replaceable);
  // Pièces animées : par jeu d'os (mêmes os, même pose de liaison, même parent).
  const skinGroups: THREE.SkinnedMesh[][] = [];
  const rigid: THREE.Mesh[] = [];
  for (const m of parts) {
    const skin = m as THREE.SkinnedMesh;
    if (!skin.isSkinnedMesh) {
      rigid.push(m);
      continue;
    }
    if (skin.bindMode !== THREE.AttachedBindMode || !skin.skeleton) continue;
    const list = skinGroups.find((l) => (l[0] as THREE.SkinnedMesh).parent === skin.parent && sameSkeleton((l[0] as THREE.SkinnedMesh).skeleton, skin.skeleton));
    if (list) list.push(skin);
    else skinGroups.push([skin]);
  }
  for (const list of skinGroups) {
    if (list.length < 2) continue;
    const colors = list.map((m) => partColor(m, colorOf));
    // Espace de liaison, comme riderMerge.ts (pièces sans décalage propre par rapport à leur parent).
    const mats = list.map((m) => m.bindMatrix);
    const key = 's|' + list.map((m, i) => `${contentKey(m.geometry)}@${round(mats[i] as THREE.Matrix4)}#${(colors[i] as THREE.Color).getHexString()}${morphKey(m)}`).join(';');
    const geometry = cached(key, () => buildMidGeometry(list, mats, colors, true));
    const first = list[0] as THREE.SkinnedMesh;
    const proxy = new THREE.SkinnedMesh(geometry, MATERIAL);
    proxy.name = 'merged-mid';
    proxy.castShadow = list.some((m) => m.castShadow);
    proxy.receiveShadow = first.receiveShadow;
    // Comme les pièces animées fusionnées de riderMerge.ts : jamais écartée hors champ.
    proxy.frustumCulled = false;
    proxy.visible = false;
    (first.parent as THREE.Object3D).add(proxy);
    proxy.bind(first.skeleton, new THREE.Matrix4());
    b.proxies.push(proxy);
    for (const mesh of list) b.members.push({ mesh, mask: mesh.layers.mask });
  }
  // Pièces rigides : le plus grand ensemble immobile (cadre, cintre, selle…) d'un bloc, rattaché à leur ancêtre commun.
  const probe = st.probe ?? new Map();
  const candidates = rigid.filter((m) => probe.has(m) && !st.moving.has(m));
  const still = candidates.length >= 2 ? stableSubset(candidates, probe, root) : [];
  if (still.length >= 2) addRigid(b, still, lowestCommonAncestor(still, root), colorOf);
  // Les autres (roues, pédalier, pédales) : avec leur parent, qui les fait tourner ; une pièce qui tourne elle-même
  // par rapport à son parent reste telle quelle.
  const stillSet = new Set(still);
  const byParent = new Map<THREE.Object3D, THREE.Mesh[]>();
  for (const m of rigid) {
    if (stillSet.has(m) || !m.parent || st.spinning.has(m)) continue;
    const list = byParent.get(m.parent);
    if (list) list.push(m);
    else byParent.set(m.parent, [m]);
  }
  for (const [parent, list] of byParent) if (list.length >= 2) addRigid(b, list, parent, colorOf);
  riderMidCounters.built++;
  return b;
}

function show(b: Build, on: boolean): void {
  for (const p of b.proxies) p.visible = on;
  for (const m of b.members) {
    if (on) {
      m.mask = m.mesh.layers.mask;
      m.mesh.layers.mask = 0;
      m.mesh.userData.midHidden = true;
    } else {
      m.mesh.layers.mask = m.mask;
      delete m.mesh.userData.midHidden;
    }
  }
}

/** Fusion détruite (originaux rendus si elle était affichée). */
function dissolve(st: MidState, b: Build): void {
  if (st.cur === b) {
    if (st.on) show(b, false);
    st.cur = null;
    st.on = false;
  }
  for (const p of b.proxies) {
    p.parent?.remove(p);
    release(p.geometry);
  }
  riderMidCounters.dissolved++;
  st.builds = st.builds.filter((x) => x !== b);
}

/** Toutes les pièces de la fusion sont-elles affichées (même niveau de détail du modèle qu'à sa construction) ? */
function shown(b: Build, root: THREE.Object3D): boolean {
  for (const m of b.members) {
    const mesh = m.mesh;
    if (!mesh.parent) return why('détachée');
    if (!mesh.visible) return why('masquée');
    for (let p: THREE.Object3D | null = mesh.parent; p && p !== root; p = p.parent) if (!p.visible) return why('branche masquée');
  }
  return true;
}

/**
 * Les pièces rigides sont-elles immobiles dans leur maillage fusionné ? Une pièce qui a bougé est notée : à la
 * reconstruction, elle rejoint le maillage de son parent (ou reste telle quelle si c'est elle-même qui tourne).
 */
function still(st: MidState, b: Build): boolean {
  let ok = true;
  for (const m of b.members) {
    if (!m.anchor || !m.rel) continue;
    _m.multiplyMatrices(_inv.copy(m.anchor.matrixWorld).invert(), m.mesh.matrixWorld);
    if (!sameMatrix(_m, m.rel)) {
      (m.anchor === m.mesh.parent ? st.spinning : st.moving).add(m.mesh);
      ok = why(m.anchor === m.mesh.parent ? 'tourne seule' : 'a bougé');
    }
  }
  return ok;
}

/**
 * À appeler pour chaque coureur IA réaliste, à chaque image (après son animation). `group` : rendu détaillé
 * (riderDetail.ts) ; `frame` : compteur de l'appelant ; `phase` : décalage du contrôle (indice du coureur).
 * Renvoie true quand ce niveau est en place (l'appelant ne relance pas riderMerge.ts).
 */
export function updateRiderMid(root: THREE.Object3D, group: THREE.Object3D, distM: number, frame: number, phase = 0, colorOf?: LightColor, enabled = RIDER_MID): boolean {
  if (!enabled) return false;
  let st = states.get(root);
  const want = st?.on ? distM > MID_BACK_M : distM > MID_FROM_M;
  if (!want && !st?.on) return false;
  if (!st) states.set(root, (st = { cur: null, on: false, builds: [], moving: new WeakSet(), spinning: new WeakSet(), probe: null, probeAt: 0 }));
  if (!want || !group.visible) {
    if (st.cur && st.on) show(st.cur, false);
    st.on = false;
    return false;
  }
  // Contrôle de la fusion en place : pièce qui a bougé (toutes refaites), ou niveau de détail du modèle changé (gardée).
  if (st.cur && (frame + phase) % CHECK_EVERY === 0) {
    if (!still(st, st.cur)) for (const b of [...st.builds]) dissolve(st, b);
    else if (!shown(st.cur, root)) {
      if (st.on) show(st.cur, false);
      st.cur = null;
      st.on = false;
    }
  }
  if (!st.cur) {
    // Fusion déjà construite pour ce qui est affiché (retour au niveau de détail précédent du modèle) ?
    const again = st.builds.find((b) => shown(b, root));
    if (again) st.cur = again;
    else {
      if (!st.probe) {
        // Repérage : position de chaque pièce rigide visible dans le repère du coureur.
        root.updateWorldMatrix(true, true);
        st.probe = new Map(visibleParts(group).filter((m) => replaceable(m) && !(m as THREE.SkinnedMesh).isSkinnedMesh).map((m) => [m, relTo(root, m)]));
        st.probeAt = frame + PROBE_FRAMES;
        return false;
      }
      if (frame < st.probeAt || lastBuildFrame === frame) return false;
      lastBuildFrame = frame;
      const b = build(root, group, st, colorOf);
      st.probe = null;
      if (!b.proxies.length) return false;
      st.builds.push(b);
      if (st.builds.length > MAX_BUILDS) dissolve(st, st.builds[0] as Build);
      st.cur = b;
    }
  }
  if (!st.on) {
    // Fusion par matériau refaite entre-temps (coureur revenu près) : défaite, sinon ses pièces s'ajouteraient aux nôtres.
    disposeRiderMerge(root);
    show(st.cur, true);
    st.on = true;
  }
  return true;
}

/** Coureur retiré : maillages fusionnés détruits, originaux rendus. */
export function disposeRiderMid(root: THREE.Object3D): void {
  const st = states.get(root);
  if (st) for (const b of [...st.builds]) dissolve(st, b);
  states.delete(root);
}

/** Coureurs dont ce niveau est en place (mesures). */
export function riderMidCount(roots: Iterable<THREE.Object3D>): number {
  let n = 0;
  for (const r of roots) if (states.get(r)?.on) n++;
  return n;
}

/**
 * Maillages témoins (rigide et animé, même matériau) posés le temps de la précompilation du départ : sans eux, le premier
 * coureur passé au-delà de 20 m compilait ses deux shaders en direct.
 */
export function riderMidWarmup(): THREE.Group {
  const g = new THREE.Group();
  const tri = () => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0.1, 0, 0, 0, 0.1, 0]), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9).fill(1), 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2]), 1));
    return geo;
  };
  g.add(new THREE.Mesh(tri(), MATERIAL));
  const sg = tri();
  sg.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(12), 4));
  sg.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 4));
  const skin = new THREE.SkinnedMesh(sg, MATERIAL);
  skin.frustumCulled = false;
  const bone = new THREE.Bone();
  skin.add(bone);
  skin.bind(new THREE.Skeleton([bone]), new THREE.Matrix4());
  g.add(skin);
  return g;
}
