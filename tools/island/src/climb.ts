/**
 * Routes de montagne en lacets : on monte en écharpe à pente constante (≈ 7 %), et l'on fait demi-tour en
 * épingle quand la route s'est trop écartée de l'axe de la montée. Le tracé suit le relief au pas de 5 m.
 */
import { terrain, type Vec2 } from './design.ts';

export interface ClimbOptions {
  /** Pente visée le long des lacets (fraction). */
  grade: number;
  /** Écart latéral maximal à l'axe départ → arrivée (m) avant une épingle. */
  halfWidth: number;
  /** Longueur du raccord d'épingle (m) : deux virages à 90°, environ 2 × le rayon. */
  turn: number;
  step?: number;
  /** Côté du premier lacet (+1 / −1) ; par défaut, le côté où le terrain monte le moins vite. */
  firstSide?: number;
}

/** Tracé en lacets de `from` (bas) à `to` (haut). */
export function switchbacks(from: Vec2, to: Vec2, o: ClimbOptions): Vec2[] {
  const step = o.step ?? 5;
  const ax = to[0] - from[0];
  const az = to[1] - from[1];
  const al = Math.hypot(ax, az);
  const A0: Vec2 = [ax / al, az / al];
  const P0: Vec2 = [-A0[1], A0[0]];
  const pts: Vec2[] = [from];
  let p: Vec2 = from;
  // Premier lacet du côté où le terrain monte le moins vite (plus de place).
  let prevHead: number | null = null;
  let side = o.firstSide ?? (terrain(from[0] + P0[0] * 60, from[1] + P0[1] * 60) < terrain(from[0] - P0[0] * 60, from[1] - P0[1] * 60) ? 1 : -1);
  for (let it = 0; it < 6000; it++) {
    const dx = to[0] - p[0];
    const dz = to[1] - p[1];
    const d = Math.hypot(dx, dz);
    if (d < 70) {
      pts.push(to);
      break;
    }
    const A: Vec2 = [dx / d, dz / d];
    const Ap: Vec2 = [-A[1], A[0]];
    const h0 = terrain(p[0], p[1]);
    // Direction : entre « en travers » (β = 0) et « droit vers le haut » (β = 90°), la pente la plus proche de la cible.
    let best: Vec2 = A;
    let bestErr = Infinity;
    for (let b = 0; b <= 90; b += 3) {
      const r = (b * Math.PI) / 180;
      const u: Vec2 = [Math.cos(r) * Ap[0] * side + Math.sin(r) * A[0], Math.cos(r) * Ap[1] * side + Math.sin(r) * A[1]];
      const g = (terrain(p[0] + u[0] * step, p[1] + u[1] * step) - h0) / step;
      // Jamais en descente ; au-delà de la cible, pénalisé plus fort qu'en deçà.
      const err = g < 0 ? 1 + -g : g > o.grade ? (g - o.grade) * 3 : (o.grade - g) * (b === 90 ? 0.5 : 1);
      if (err < bestErr) {
        bestErr = err;
        best = u;
      }
    }
    // Virages doux le long des lacets : cap qui tourne d'au plus 8° tous les 5 m (rayon ≥ ≈ 36 m).
    if (prevHead !== null) {
      let a = Math.atan2(best[1], best[0]);
      let dlt = a - prevHead;
      while (dlt > Math.PI) dlt -= 2 * Math.PI;
      while (dlt < -Math.PI) dlt += 2 * Math.PI;
      const lim = (8 * Math.PI) / 180;
      if (Math.abs(dlt) > lim) a = prevHead + Math.sign(dlt) * lim;
      best = [Math.cos(a), Math.sin(a)];
    }
    prevHead = Math.atan2(best[1], best[0]);
    p = [p[0] + best[0] * step, p[1] + best[1] * step];
    pts.push(p);
    // Épingle : trop loin de l'axe → on monte droit sur `turn` mètres, puis lacet suivant dans l'autre sens.
    const lateral = (p[0] - from[0]) * P0[0] + (p[1] - from[1]) * P0[1];
    if (lateral * side > o.halfWidth) {
      side = -side;
      for (let s = step; s <= o.turn; s += step) {
        p = [p[0] + A[0] * step, p[1] + A[1] * step];
        pts.push(p);
      }
      // Épingle : nouveau départ, cap libre (les deux virages à 90° sont arrondis ensuite).
      prevHead = null;
    }
  }
  return pts;
}
