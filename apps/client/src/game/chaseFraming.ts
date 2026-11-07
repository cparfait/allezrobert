import * as THREE from 'three/webgpu';

/**
 * Caméra de poursuite : garder le coureur visible en permanence, même dans les virages serrés des rues
 * étroites (Montmartre, villages). Deux garde-fous indépendants du tracé, valables dans toutes les zones :
 *  - le recadrage (`keepInFrame`) : le regard ne s'écarte jamais du coureur de plus d'une fraction du champ ;
 *  - le bras de caméra (`CameraBoom`) : la caméra reste du côté du coureur de tout bâtiment.
 */

/** Obstacles entre deux points : fraction du segment a → b au premier obstacle, null si dégagé. */
export type Occlusion = (a: THREE.Vector3, b: THREE.Vector3) => number | null;

/**
 * Butée douce : identité jusqu'à `knee` × `limit`, puis rapprochement progressif de `limit` sans jamais
 * l'atteindre (tangente hyperbolique, pente continue : pas d'à-coup quand la butée entre en jeu).
 */
export function softLimit(x: number, limit: number, knee = 0.5): number {
  const a = Math.abs(x);
  const k = knee * limit;
  if (a <= k) return x;
  const span = limit - k;
  return Math.sign(x) * (k + span * Math.tanh((a - k) / span));
}

/** Centre du coureur à l'écran : abscisse et ordonnée maximales (−1…1) visées pour son centre, marge pour son gabarit. */
export const FRAME_X = 0.5;
export const FRAME_Y = 0.42;

/**
 * Recadrage : ramène le point visé `look` (modifié) pour que `subject` reste dans le cadre, à
 * `FRAME_X` / `FRAME_Y` du centre au plus (butée douce en lacet et en tangage). Le point visé
 * anticipe le virage (point devant le coureur) : dans une épingle il part loin sur le côté, voire
 * derrière la caméra, et le coureur sortait de l'image.
 * `hint.side` garde le côté du coureur d'une image à l'autre : quand le point visé passe derrière la
 * caméra (écart proche de 180°), le recadrage ne bascule pas d'un bord de l'image à l'autre.
 */
export function keepInFrame(camPos: THREE.Vector3, look: THREE.Vector3, subject: THREE.Vector3, vfovDeg: number, aspect: number, hint?: { side: number }): THREE.Vector3 {
  const fx = look.x - camPos.x;
  const fy = look.y - camPos.y;
  const fz = look.z - camPos.z;
  const dist = Math.hypot(fx, fy, fz);
  const rx = subject.x - camPos.x;
  const ry = subject.y - camPos.y;
  const rz = subject.z - camPos.z;
  const rh = Math.hypot(rx, rz);
  if (dist < 1e-3 || rh < 0.2) return look;
  const tanV = Math.tan(THREE.MathUtils.degToRad(vfovDeg) / 2);
  const limH = Math.atan(FRAME_X * tanV * aspect);
  const limV = Math.atan(FRAME_Y * tanV);
  const yawR = Math.atan2(rx, rz);
  const pitchR = Math.atan2(ry, rh);
  let dyaw = Math.atan2(fx, fz) - yawR;
  dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
  if (hint) {
    if (Math.abs(dyaw) > Math.PI / 2 && hint.side !== 0 && Math.sign(dyaw) !== hint.side) dyaw += 2 * Math.PI * hint.side;
    if (Math.abs(dyaw) > 0.02) hint.side = Math.sign(dyaw);
  }
  const yaw = yawR + softLimit(dyaw, limH, 0.65);
  // (en tangage, la butée n'entre en jeu qu'au-delà du cadrage habituel : coureur un peu sous le centre)
  const pitch = pitchR + softLimit(Math.atan2(fy, Math.hypot(fx, fz)) - pitchR, limV, 0.75);
  // Point visé jamais plus près que le coureur (4 m au moins) : tiré vers un point derrière la caméra (demi-tour),
  // il se rapprochait d'elle d'image en image et sa direction devenait hypersensible (le décor sautait).
  const d = Math.max(dist, Math.hypot(rh, ry), 4);
  const c = Math.cos(pitch);
  return look.set(camPos.x + Math.sin(yaw) * c * d, camPos.y + Math.sin(pitch) * d, camPos.z + Math.cos(yaw) * c * d);
}

/** Hauteur de la tête et du vélo au-dessus du point du coureur (m) : les deux doivent rester visibles. */
const HEAD_Y = 1.3;
const BIKE_Y = 0.6;
/** Demi-largeur de l'objectif (m) : un mur frôlé de côté ne doit pas couper le plan proche. */
const LENS_HALF = 0.35;
/** Distance gardée devant un mur (m) ; le bras sonde aussi d'autant derrière la caméra (rapprochement anticipé). */
const MARGIN = 0.6;
/** Bras le plus court (m) : plus près, le coureur ne tient plus dans le cadre (la caméra le voit de dessus). */
const MIN_LEN = 1;
/** Bras raccourci : la caméra monte d'autant (m, bras au plus court) et regarde le coureur par-dessus. */
const LIFT = 0.9;

const _head = new THREE.Vector3();
const _bike = new THREE.Vector3();
const _vec = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _side = new THREE.Vector3();
const _a = new THREE.Vector3();

/**
 * Bras de caméra : entre la tête du coureur et la caméra voulue (`end`, déjà lissée), la caméra
 * s'arrête avant le premier bâtiment. Testé à chaque image depuis la position réelle de la caméra
 * (avant : depuis la position visée, une image sur trois, puis lissée : en virage la caméra en retard
 * passait derrière l'angle du bâtiment). Rayons depuis la tête et depuis le vélo, plus deux rayons aux
 * bords de l'objectif ; sondage prolongé de `MARGIN` derrière la caméra pour rapprocher avant le contact.
 * Rapprochement rapide, recul lent (pas de va-et-vient) ; un mur surgi plus près que la caméra est rattrapé en
 * quelques images.
 */
export class CameraBoom {
  /** Longueur du bras appliquée (fraction de la longueur voulue), lissée. */
  scale = 1;

  reset(): void {
    this.scale = 1;
  }

  /** Position de la caméra (`out`) pour le coureur `subject` (au sol) et la caméra voulue `end`. */
  update(subject: THREE.Vector3, end: THREE.Vector3, dt: number, occlusion: Occlusion | null, out: THREE.Vector3): THREE.Vector3 {
    out.copy(end);
    _head.set(subject.x, subject.y + HEAD_Y, subject.z);
    _vec.subVectors(end, _head);
    const len = _vec.length();
    if (!occlusion || len < 0.5) {
      this.scale = 1;
      return out;
    }
    const reach = len + MARGIN;
    _probe.copy(_head).addScaledVector(_vec, reach / len);
    _side.set(_vec.z, 0, -_vec.x);
    if (_side.lengthSq() > 1e-8) _side.normalize().multiplyScalar(LENS_HALF);
    _bike.set(subject.x, subject.y + BIKE_Y, subject.z);
    // Coureur dans une emprise (itinéraire qui traverse un bâtiment, porche, passage) : les rayons partent de
    // l'intérieur et ne disent rien du chemin vers la caméra (le bras se repliait sur la tête et filmait le sol).
    const inside = (p: THREE.Vector3) => occlusion(p, _a.set(p.x + 0.02, p.y, p.z)) === 0;
    if (inside(_head)) {
      this.scale += (1 - this.scale) * (1 - Math.exp(-dt * 1.5));
      if (this.scale > 0.999) return out;
      out.copy(_head).addScaledVector(_vec, this.scale);
      out.y += LIFT * (1 - this.scale);
      return out;
    }
    // Distance libre le long du bras depuis la tête (approchée par la distance au point d'impact pour les rayons obliques).
    let free = reach;
    const ray = (from: THREE.Vector3, to: THREE.Vector3) => {
      const h = occlusion(from, to);
      if (h !== null) free = Math.min(free, h * from.distanceTo(to));
    };
    ray(_head, _probe);
    if (!inside(_bike)) ray(_bike, _probe);
    ray(_head, _a.copy(_probe).add(_side));
    ray(_head, _a.copy(_probe).sub(_side));
    const minScale = Math.min(1, MIN_LEN / len);
    const hard = Math.max(minScale, (free - 0.15) / len);
    const target = Math.min(1, Math.max(minScale, (free - MARGIN) / len));
    this.scale += (target - this.scale) * (1 - Math.exp(-dt * (target < this.scale ? 12 : 1.5)));
    // Mur plus près que la caméra (sortie d'un porche, angle surgi) : rattrapage très rapide (≈ 0,03 s) plutôt
    // qu'un saut d'une image à l'autre.
    if (this.scale > hard) this.scale += (hard - this.scale) * (1 - Math.exp(-dt * 30));
    this.scale = Math.min(this.scale, 1);
    if (this.scale > 0.999) return out;
    out.copy(_head).addScaledVector(_vec, this.scale);
    out.y += LIFT * (1 - this.scale);
    // La montée ne doit pas faire entrer la caméra dans un bâtiment (avant-toit, étage en encorbellement).
    const h = occlusion(_head, out);
    if (h !== null) {
      const l = _head.distanceTo(out);
      out.sub(_head).multiplyScalar(Math.max(Math.min(MIN_LEN, l), h * l - 0.15) / l).add(_head);
    }
    return out;
  }
}
