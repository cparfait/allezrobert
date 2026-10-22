import { vec2, vec3, float, floor, hash, mix, smoothstep, mx_noise_float, select } from 'three/tsl';
import type * as THREE from 'three/webgpu';

type F = THREE.Node<'float'>;
type V2 = THREE.Node<'vec2'>;
type V3 = THREE.Node<'vec3'>;

/** Teintes de la meulière d'Île-de-France : ocres, bruns, rouille, quelques pierres grisées. */
const STONES: Array<[number, number, number]> = [
  [0.72, 0.56, 0.36],
  [0.6, 0.4, 0.23],
  [0.78, 0.64, 0.45],
  [0.49, 0.35, 0.22],
  [0.66, 0.5, 0.3],
  [0.58, 0.55, 0.48],
];

/**
 * Meulière procédurale (TSL) : moellons irréguliers (Voronoï 3 × 3, 9 cellules déroulées),
 * teinte par pierre, alvéoles sombres, joints de mortier clair légèrement en creux.
 * `uvM` = coordonnées de façade en mètres (le long du mur, hauteur). Renvoie la couleur, une
 * normale en espace tangent (pierres bombées, joints en creux) et le masque des joints.
 */
export function meuliere(uvM: V2): { color: V3; normalTS: V3; joint: F } {
  // Pierres de 25 à 35 cm, un peu plus larges que hautes.
  const p = uvM.mul(vec2(3.1, 3.9));
  const cell = floor(p);
  let f1: F = float(9);
  let f2: F = float(9);
  let id: F = float(0);
  let dx: F = float(0);
  let dy: F = float(0);
  for (const ox of [-1, 0, 1])
    for (const oy of [-1, 0, 1]) {
      const c = cell.add(vec2(ox, oy));
      const seed = c.x.add(500).mul(1000).add(c.y.add(500));
      const hx = hash(seed);
      const hy = hash(seed.add(0.5).mul(1.37).add(17));
      const pt = c.add(vec2(hx.mul(0.7).add(0.15), hy.mul(0.7).add(0.15)));
      const d = p.sub(pt);
      const dist = d.length();
      const closer = dist.lessThan(f1);
      // f2 = deuxième plus proche : min(ancien f1 si on le remplace, sinon min(f2, dist)).
      f2 = select(closer, f1, f2.min(dist));
      id = select(closer, hx, id);
      dx = select(closer, d.x, dx);
      dy = select(closer, d.y, dy);
      f1 = select(closer, dist, f1);
    }
  // Joint : là où les deux cellules les plus proches sont presque à égale distance.
  const edge = f2.sub(f1);
  const stoneMask = smoothstep(0.035, 0.11, edge.add(mx_noise_float(p.mul(4.3)).mul(0.025)));
  // Teinte par pierre (6 teintes, mélange doux) et variations internes.
  const k = id.mul(STONES.length);
  let stone: V3 = vec3(...STONES[0]!);
  for (let i = 1; i < STONES.length; i++) stone = mix(stone, vec3(...STONES[i]!), smoothstep(i - 0.6, i - 0.4, k));
  const grain = mx_noise_float(p.mul(2.7).add(id.mul(31))).mul(0.12).add(0.94);
  // Alvéoles : petites cavités sombres caractéristiques de la meulière.
  const pores = smoothstep(0.42, 0.62, mx_noise_float(vec3(p.mul(7.5), id.mul(9)))).mul(0.32);
  const dome = float(1).sub(f1.mul(0.35));
  stone = stone.mul(grain).mul(float(1).sub(pores)).mul(dome);
  const mortar = vec3(0.79, 0.74, 0.64).mul(mx_noise_float(p.mul(1.9)).mul(0.08).add(0.95));
  const color = mix(mortar, stone, stoneMask);
  // Normale : pierre bombée (pente vers le bord), joints en creux.
  const bulge = stoneMask.mul(0.55);
  const normalTS = vec3(dx.mul(bulge), dy.mul(bulge), 1).normalize();
  return { color, normalTS, joint: float(1).sub(stoneMask) };
}
