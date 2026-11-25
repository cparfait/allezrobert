import * as THREE from 'three/webgpu';

/**
 * Fondu des coureurs proches (idée vue dans NCT Ride) : un coureur collé à la caméra, ou qui passe entre la caméra
 * et mon coureur, s'estompe pour dégager la vue, puis revient quand il s'éloigne.
 *
 * Vraie transparence (fondu lisse), pas de tramé (`alphaHash` donnait un flou par points, moins agréable) : les
 * copies sont `transparent` mais gardent l'écriture de profondeur et un seul passage par pièce (`forceSinglePass` :
 * sans lui, three.js dessine les pièces double face deux fois, dos puis face, avec deux shaders de plus). La fusion des pièces (riderMerge.ts,
 * qui refuse les matériaux transparents) a lieu avant et n'est pas touchée : les copies ne vivent que pendant le fondu.
 *
 * Les trois styles (Bêta, réaliste, poly) partagent des matériaux entre coureurs (cache des modèles, pièces `shared`
 * du vélo poly) : pendant le fondu, chaque pièce du coureur reçoit une copie de son matériau (« jumeau ») transparente,
 * propre à ce coureur ; revenu à pleine opacité, il retrouve ses matériaux et les copies sont détruites.
 *
 * Coupé par `?nearfade=0`.
 */

/** Opacité la plus basse : presque effacé, juste un voile pour deviner qui est là (0,25 au départ, trop présent). */
export const FADE_MIN = 0.1;
/** Distance caméra–coureur (m) : en deçà de NEAR_FULL, fondu complet ; au-delà de NEAR_NONE, aucun. */
const NEAR_FULL = 1.3;
const NEAR_NONE = 3.2;
/** Écart (m) entre le coureur et la ligne caméra → mon coureur : en deçà de LINE_FULL, fondu complet ; au-delà de LINE_NONE, aucun. */
const LINE_FULL = 0.45;
const LINE_NONE = 0.95;
/** Au-delà de cette distance de la caméra (m), un coureur n'est jamais estompé (rien à calculer). */
const RANGE_M = 14;
/** Constante de temps du fondu (s) : ≈ 0,35 s pour aller au bout. */
const TAU_S = 0.08;
/** Hauteur du centre d'un coureur au-dessus de son origine (sol), et de la cible de la caméra au-dessus de mon coureur. */
const BODY_Y = 0.95;
const SUBJECT_Y = 1.1;
/** Au-delà de cette distance derrière le plan de la caméra (m), un coureur est hors de l'image. */
const BEHIND_M = 0.4;
/** Superposition à mon coureur : demi-axes de l'ellipse (m, le long de la route et de côté) et part estompée à fond. */
const OVERLAP_LONG_M = 1.7;
const OVERLAP_SIDE_M = 0.6;
const OVERLAP_FULL = 0.55;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Opacité voulue d'un coureur (1 = normal, FADE_MIN = le plus estompé). `cam` : position de la caméra, `subject` :
 * mon coureur (point visé), `rider` : centre du coureur, en mètres. `forward` : direction de visée (unitaire) ; un
 * coureur derrière la caméra n'est pas dans l'image : pas de fondu (ni de copies de matériaux pour rien, par exemple
 * pour tout le groupe calé dans ma roue). Calcul pur (testé).
 */
export function fadeTarget(cam: THREE.Vector3Like, subject: THREE.Vector3Like | null, rider: THREE.Vector3Like, forward?: THREE.Vector3Like): number {
  const rx = rider.x - cam.x, ry = rider.y - cam.y, rz = rider.z - cam.z;
  const dCam = Math.hypot(rx, ry, rz);
  if (dCam > RANGE_M) return 1;
  // Marge : un coureur à côté de la caméra, centre juste derrière elle, déborde encore dans le coin de l'image.
  if (forward && rx * forward.x + ry * forward.y + rz * forward.z < -BEHIND_M) return 1;
  let k = smooth(NEAR_FULL, NEAR_NONE, dCam);
  if (subject) {
    const sx = subject.x - cam.x, sy = subject.y - cam.y, sz = subject.z - cam.z;
    const len2 = sx * sx + sy * sy + sz * sz;
    if (len2 > 1e-4) {
      // Position du coureur le long de la ligne : seulement entre la caméra et un peu avant mon coureur
      // (un coureur juste à côté ou devant moi ne cache rien).
      const t = (rx * sx + ry * sy + rz * sz) / len2;
      const len = Math.sqrt(len2);
      if (t > 0 && t * len < len - 0.6) {
        const px = rx - sx * t, py = ry - sy * t, pz = rz - sz * t;
        k = Math.min(k, smooth(LINE_FULL, LINE_NONE, Math.hypot(px, py, pz)));
      }
    }
  }
  // Coureur superposé au mien (je le traverse en le dépassant, collision.ts `passThrough`) : estompé. Ellipse au sol
  // autour de mon coureur, longue d'un vélo devant et derrière, étroite de côté (un voisin côte à côte reste net).
  if (subject && forward) {
    const fl = Math.hypot(forward.x, forward.z);
    if (fl > 1e-3) {
      const fx = forward.x / fl, fz = forward.z / fl;
      const dx = rider.x - subject.x, dz = rider.z - subject.z;
      const along = dx * fx + dz * fz;
      const side = dx * fz - dz * fx;
      k = Math.min(k, smooth(OVERLAP_FULL, 1, Math.hypot(along / OVERLAP_LONG_M, side / OVERLAP_SIDE_M)));
    }
  }
  return FADE_MIN + (1 - FADE_MIN) * k;
}

/** Pas du fondu, indépendant de la cadence. */
export function fadeStep(current: number, target: number, dt: number): number {
  const next = current + (target - current) * (1 - Math.exp(-Math.max(0, dt) / TAU_S));
  // Accroché aux bornes : sans quoi un coureur resterait des secondes « presque opaque » avec ses copies.
  return Math.abs(next - target) < 0.02 ? target : next;
}

interface Twins {
  /** Jumeau → matériau d'origine. */
  twins: Map<THREE.Material, THREE.Material>;
  /** Matériau d'origine → jumeau. */
  byOrig: Map<THREE.Material, THREE.Material>;
}

interface Faded extends Twins {
  opacity: number;
  /** Copies préparées au chargement (prewarmNearFade) : gardées d'un fondu à l'autre, jamais détruites en route. */
  kept: boolean;
}

const state = new WeakMap<THREE.Object3D, Faded>();
/** Coureurs en cours de fondu (pour les rendre s'ils ne sont plus passés à update). */
const active = new Set<THREE.Object3D>();
/**
 * Copies préparées au chargement, par coureur. three.js libère le pipeline d'un shader dès que plus aucun matériau ne
 * s'en sert : détruire les copies à la fin de chaque fondu faisait recompiler en direct la variante transparente au fondu
 * suivant (jusqu'à 2 s d'image figée au départ, quand le peloton se met en place autour de la caméra). Tant que ces
 * copies vivent, toute autre copie de même shader (cyclistes d'ambiance, autres coureurs) retrouve son pipeline.
 */
const kept = new Map<THREE.Object3D, Twins>();
const enabled = typeof location === 'undefined' || new URLSearchParams(location.search).get('nearfade') !== '0';

const _cam = new THREE.Vector3();
const _center = new THREE.Vector3();
const _subject = new THREE.Vector3();
const _forward = new THREE.Vector3();

function twinOf(f: Faded, m: THREE.Material): THREE.Material {
  if (f.twins.has(m)) return m;
  let t = f.byOrig.get(m);
  if (!t) {
    t = m.clone();
    t.transparent = true;
    t.depthWrite = true;
    t.forceSinglePass = true;
    t.userData = { ...m.userData, nearFadeBase: m.opacity, nearFadeAlphaTest: m.alphaTest };
    f.byOrig.set(m, t);
    f.twins.set(t, m);
  }
  return t;
}

/** Copies transparentes posées sur toutes les pièces du coureur (originaux et pièces fusionnées), opacité appliquée. */
function apply(root: THREE.Object3D, f: Faded): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    // Une pièce changée pendant le fondu (garde-robe, niveau de détail) reçoit aussi sa copie.
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => twinOf(f, m)) : twinOf(f, mesh.material);
  });
  for (const t of f.twins.keys()) {
    t.opacity = (t.userData.nearFadeBase as number) * f.opacity;
    // Le seuil de découpe (cheveux, rayons) se compare à l'alpha déjà estompé : il baisse avec lui, sinon la pièce
    // disparaît d'un coup au milieu du fondu. Jamais à 0 (même shader).
    const cut = t.userData.nearFadeAlphaTest as number;
    if (cut > 0) t.alphaTest = cut * f.opacity;
  }
}

/** Matériaux d'origine rendus, copies détruites. */
function restore(root: THREE.Object3D, f: Faded): void {
  const back = (m: THREE.Material) => f.twins.get(m) ?? m;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(back) : back(mesh.material);
  });
  if (!f.kept) for (const t of f.twins.keys()) t.dispose();
  state.delete(root);
  active.delete(root);
}

/**
 * Au chargement de la sortie : doubles des pièces de `roots` (mêmes géométries et squelettes, à leur place) portant
 * leurs copies transparentes, tous niveaux de détail compris. Posés dans la scène pendant la précompilation, ils font compiler
 * les variantes transparentes en même temps que le reste (sur les fils de Dawn), au lieu d'une seconde passe de près de 3 s.
 * Les copies restent gardées (voir `kept`) jusqu'à `releaseNearFade` ; le groupe se retire ensuite de la scène.
 */
export function nearFadeProxies(roots: Iterable<THREE.Object3D>): THREE.Group {
  const g = new THREE.Group();
  g.name = 'near-fade-proxies';
  if (!enabled) return g;
  for (const root of roots) {
    const t = kept.get(root) ?? { twins: new Map(), byOrig: new Map() };
    kept.set(root, t);
    const f: Faded = { opacity: 1, kept: true, ...t };
    root.updateWorldMatrix(true, true);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const c = mesh.clone(false) as THREE.Mesh;
      c.material = Array.isArray(mesh.material) ? mesh.material.map((m) => twinOf(f, m)) : twinOf(f, mesh.material);
      c.matrixAutoUpdate = false;
      c.matrix.copy(mesh.matrixWorld);
      c.visible = true;
      g.add(c);
    });
  }
  return g;
}

/** Fin de la sortie : copies gardées détruites (les coureurs en plein fondu retrouvent d'abord leurs matériaux). */
export function releaseNearFade(): void {
  for (const root of [...active]) restore(root, state.get(root)!);
  for (const t of kept.values()) for (const m of t.twins.keys()) m.dispose();
  kept.clear();
}

/**
 * À appeler une fois par image, après la mise à jour de la caméra. `roots` : racines des autres coureurs (IA, autres
 * joueurs, cyclistes d'ambiance), jamais la mienne. `subject` : position de mon coureur (au sol), ou null.
 */
export function updateNearFade(dt: number, camera: THREE.Camera, subject: THREE.Vector3 | null, roots: Iterable<THREE.Object3D>): void {
  if (!enabled) return;
  camera.getWorldPosition(_cam);
  camera.getWorldDirection(_forward);
  const target = subject && Number.isFinite(subject.x) ? _subject.set(subject.x, subject.y + SUBJECT_Y, subject.z) : null;
  const seen = new Set<THREE.Object3D>();
  for (const root of roots) {
    seen.add(root);
    let f = state.get(root);
    // Masqué (trop loin, hors de la zone) : rien à estomper.
    const want = root.visible ? fadeTarget(_cam, target, _center.copy(root.position).setY(root.position.y + BODY_Y), _forward) : 1;
    if (!f) {
      if (want >= 1) continue;
      const t = kept.get(root);
      f = { opacity: 1, kept: !!t, ...(t ?? { twins: new Map(), byOrig: new Map() }) };
      state.set(root, f);
      active.add(root);
    }
    f.opacity = fadeStep(f.opacity, want, dt);
    if (f.opacity >= 1) restore(root, f);
    else apply(root, f);
  }
  // Coureur retiré de la liste (parti, sortie terminée) en plein fondu : matériaux rendus.
  for (const root of [...active]) if (!seen.has(root)) restore(root, state.get(root)!);
}
