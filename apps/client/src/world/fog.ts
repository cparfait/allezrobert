import * as THREE from 'three/webgpu';
import { abs, cameraPosition, clamp, dot, exp, float, fog, length, max, mix, positionView, positionWorld, pow, select, uniform } from 'three/tsl';
import { colorUniform, type Vec3Node } from '../engine/tsl.ts';

/** Hauteur d'échelle de la brume de vallée (m) : sa densité est divisée par e tous les MIST_H mètres. */
const MIST_H = 45;

/**
 * Brume de la scène (`scene.fogNode`) :
 * - brume de fond, la même qu'avant (exponentielle au carré de la profondeur, `density`) ;
 * - brume de vallée : densité exponentielle en altitude au-dessus de `mistBase` (fond de vallée de
 *   l'itinéraire), intégrée exactement le long du regard. Le matin, les vallées sont noyées et les
 *   plateaux dégagés ; en plein jour il en reste un voile qui donne la profondeur ;
 * - diffusion vers le soleil : la brume prend la teinte du soleil quand on regarde vers lui (contre-jour
 *   doré), la teinte du ciel à l'opposé.
 * Coût : quelques instructions par pixel, aucun objet ni passe de plus.
 */
export class SceneFog {
  /** Couleur de la brume dos au soleil, et vers le soleil (déjà pondérée par sa hauteur). */
  readonly color = colorUniform('#dfe8ef');
  readonly sunColor = colorUniform('#dfe8ef');
  readonly sunDir = uniform(new THREE.Vector3(0, 1, 0));
  /** Brume de fond (comme FogExp2.density). */
  readonly density = uniform(0.00012);
  /** Densité de la brume de vallée à l'altitude `mistBase` (1/m) et cette altitude (m). */
  readonly mist = uniform(0);
  readonly mistBase = uniform(0);
  readonly node: THREE.Node;

  constructor() {
    const toFrag = positionWorld.sub(cameraPosition);
    const dist = length(toFrag).max(1e-3);
    const dir = toFrag.div(dist);
    const depth = positionView.z.negate();
    const back = this.density.mul(this.density).mul(depth).mul(depth).negate().exp().oneMinus();
    // ∫ mist·exp(−(h − base)/H) ds le long du segment caméra → point, forme fermée.
    const h0 = cameraPosition.y.sub(this.mistBase).max(-100);
    const k = clamp(toFrag.y.div(MIST_H), -60, 60);
    const ratio = select(abs(k).greaterThan(1e-3), float(1).sub(exp(k.negate())).div(k), float(1));
    const optical = this.mist.mul(dist).mul(exp(h0.div(-MIST_H))).mul(ratio);
    const valley = optical.negate().exp().oneMinus();
    const amount = float(1).sub(float(1).sub(back).mul(float(1).sub(valley)));
    this.node = fog(this.tint(dir as unknown as Vec3Node), amount) as unknown as THREE.Node;
  }

  /** Couleur de la brume dans la direction de regard `dir` (unitaire) : plus chaude vers le soleil. */
  tint(dir: Vec3Node): Vec3Node {
    const toward = pow(max(dot(dir, this.sunDir), 0), 6);
    return mix(this.color.node, this.sunColor.node, toward) as unknown as Vec3Node;
  }
}
