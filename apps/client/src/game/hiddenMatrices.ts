import * as THREE from 'three/webgpu';

/**
 * Les coureurs (style V3 surtout) portent des centaines de nœuds masqués : variantes de maillots, casques,
 * chaussures… (793 nœuds par coureur, dont 131 visibles, mesuré le 17/11/2026). Three.js recalcule pourtant la
 * matrice de chacun à chaque image. Ici, une branche masquée n'est plus parcourue, sauf si elle contient des os
 * (un squelette peut servir à un maillage visible ailleurs). Une branche qui redevient visible est recalculée à
 * l'image suivante : la racine d'un coureur bouge à chaque image, la mise à jour est donc toujours forcée.
 * Mesure (dev, 24 coureurs) : 2,46 → 0,88 ms par image pour la mise à jour des matrices de la scène.
 */
/** ?hiddenmatrices=0 : mise à jour de toutes les matrices (comparaison). */
export const HIDDEN_MATRICES = typeof location !== 'undefined' && new URLSearchParams(location.search).get('hiddenmatrices') !== '0';

/**
 * Horloge d'images du moteur (renderer.info.frame) : three.js remet à jour les matrices de toute la scène à chaque
 * passe de rendu (vue principale, chaque zone d'ombre). Rien ne bouge entre ces passes ; pour un coureur, la
 * seconde mise à jour de la même image est sautée (≈ 2 mises à jour par image mesurées à Boulogne, 18/11/2026).
 */
let frameClock: (() => number) | null = null;
export function setMatrixFrameClock(clock: (() => number) | null): void {
  frameClock = clock;
}

export function skipHiddenMatrixUpdates(root: THREE.Object3D, enabled = HIDDEN_MATRICES): void {
  if (!enabled) return;
  const used = new Set<THREE.Object3D>();
  let lastFrame = -1;
  const lastPos = new THREE.Vector3(Infinity, 0, 0);
  const lastQuat = new THREE.Quaternion();
  root.updateMatrixWorld = function (this: THREE.Object3D, force?: boolean) {
    const frame = frameClock ? frameClock() : -1;
    // Même image, coureur immobile depuis : déjà à jour (les os ne bougent que pendant la logique, avant le rendu).
    // `force` est ignoré ici : la scène (fixe) le transmet à chaque passe parce qu'elle recalcule sa propre matrice.
    if (frame >= 0 && frame === lastFrame && this.position.equals(lastPos) && this.quaternion.equals(lastQuat)) return;
    lastFrame = frame;
    lastPos.copy(this.position);
    lastQuat.copy(this.quaternion);
    // Os réellement utilisés : ceux des maillages animés visibles (relevé à chaque image : un corps qui apparaît
    // n'est jamais en retard). Une branche masquée n'est parcourue que si elle porte l'un de ces os ; le squelette
    // de l'ancien modèle, masqué en style V3, n'est plus recalculé (3,65 ms par image à Boulogne, 18/11/2026).
    used.clear();
    this.traverseVisible((o) => {
      const sk = (o as THREE.SkinnedMesh).isSkinnedMesh ? (o as THREE.SkinnedMesh).skeleton : null;
      if (sk) for (const b of sk.bones) used.add(b);
    });
    activeUsed = used;
    try {
      updateVisible(this, force ?? false, used);
    } finally {
      activeUsed = null;
    }
  };
}

/** Os utilisés du coureur en cours de mise à jour (pendant `updateVisible` seulement), sinon null. */
let activeUsed: Set<THREE.Object3D> | null = null;

/**
 * Pour un objet à mise à jour propre (niveaux de détail de l'avatar, gltfAvatar.ts) appelé pendant la mise à jour d'un
 * coureur : met à jour `o` sans descendre dans ses branches masquées inutiles. Renvoie false hors de cette mise à jour
 * (l'appelant fait alors la mise à jour complète). Sans cela, le niveau 0 de l'avatar, toujours tenu à jour pour ses os,
 * recalculait tout l'ancien modèle masqué par le coureur V3 (style Bêta) : ≈ 8 % du processeur à 40 coureurs (26/11/2026).
 */
export function updateVisibleBranch(o: THREE.Object3D, force: boolean): boolean {
  if (!activeUsed) return false;
  updateVisible(o, force, activeUsed);
  return true;
}

const BASE_UPDATE = THREE.Object3D.prototype.updateMatrixWorld;
/** Os portés par chaque branche (structure stable ; relu de temps en temps si la garde-robe change). */
const bonesUnder = new WeakMap<THREE.Object3D, { bones: THREE.Object3D[]; at: number }>();
let tick = 0;

function bonesOf(o: THREE.Object3D): THREE.Object3D[] {
  const hit = bonesUnder.get(o);
  if (hit && tick - hit.at < 600) return hit.bones;
  const bones: THREE.Object3D[] = [];
  o.traverse((x) => {
    if ((x as THREE.Bone).isBone) bones.push(x);
  });
  bonesUnder.set(o, { bones, at: tick });
  return bones;
}

function needed(c: THREE.Object3D, used: Set<THREE.Object3D>): boolean {
  if (c.visible) return true;
  if (!used.size) return false;
  for (const b of bonesOf(c)) if (used.has(b)) return true;
  return false;
}

/** Même calcul que Object3D.updateMatrixWorld (three r186), sans descendre dans les branches masquées inutiles. */
function updateVisible(o: THREE.Object3D, force: boolean, used: Set<THREE.Object3D>): void {
  tick++;
  if (o.matrixAutoUpdate) o.updateMatrix();
  if (o.matrixWorldNeedsUpdate || force) {
    if (o.matrixWorldAutoUpdate === true) {
      if (o.parent === null) o.matrixWorld.copy(o.matrix);
      else o.matrixWorld.multiplyMatrices(o.parent.matrixWorld, o.matrix);
    }
    o.matrixWorldNeedsUpdate = false;
    force = true;
  }
  for (const c of o.children) {
    if (!needed(c, used)) continue;
    // Objet à mise à jour propre (SkinnedMesh : bindMatrixInverse recalculée à chaque image ; LOD…) : sa méthode
    // à lui. Sans elle, le corps des coureurs était dessiné avec une matrice de liaison périmée (jusqu'à 11 m),
    // décalé par rapport au casque et aux pièces rigides, qui semblaient flotter et scintiller (17/11/2026).
    if (c.updateMatrixWorld !== BASE_UPDATE) c.updateMatrixWorld(force);
    else updateVisible(c, force, used);
  }
}
