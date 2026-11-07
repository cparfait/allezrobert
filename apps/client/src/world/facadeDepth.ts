import * as THREE from 'three/webgpu';
import { abs, cameraPosition, clamp, cross, dot, float, floor, fract, hash, max, min, mix, normalWorldGeometry, positionWorld, step, vec3 } from 'three/tsl';
import { sunlight } from './sunlight.ts';

type F = THREE.Node<'float'>;
type V3 = THREE.Node<'vec3'>;

/**
 * Profondeur des façades sans géométrie : baies en retrait vues en parallaxe, pièces derrière les vitres
 * (« interior mapping », une boîte par travée et par étage, lancer de rayon analytique) et ombres de la
 * modénature calculées d'après le soleil. ?facade=0 : façades peintes d'origine (comparaison).
 */
export const FACADE_DEPTH = typeof location === 'undefined' || new URLSearchParams(location.search).get('facade') !== '0';

/**
 * Repère du mur au pixel : `vx`, `vy` = déplacement le long du mur (m) par mètre d'enfoncement du rayon de
 * vue ; `sunU`, `sunV` = idem vers le soleil par mètre de saillie. Le mur est bâti avec u le long de `t`,
 * v vers le haut et sa normale vers l'extérieur (voir `walls`, buildings.ts).
 */
export function facadeFrame(): { vx: F; vy: F; sunU: F; sunV: F; sunN: F } {
  const n = normalWorldGeometry;
  const t = cross(n, vec3(0, 1, 0));
  const view = positionWorld.sub(cameraPosition);
  const dz = max(abs(dot(view, n)), float(0.01));
  const L = sunlight.castDir;
  const sunN = dot(L, n);
  const sn = max(sunN, float(0.04));
  return {
    vx: clamp(dot(view, t).div(dz), -6, 6) as F,
    vy: clamp(view.y.div(dz), -6, 6) as F,
    sunU: clamp(dot(L, t).div(sn), -6, 6) as F,
    // Plafonné : soleil presque parallèle au mur, les saillies porteraient des ombres de plusieurs mètres.
    sunV: clamp(L.y.div(sn), 0, 2.5) as F,
    sunN: sunN as F,
  };
}

/** Lumière directe atténuée par `mask` (ombres de façade) : l'ambiance et les ombres portées restent justes. */
export class FacadeLightingModel extends THREE.PhysicalLightingModel {
  constructor(private readonly mask: F) {
    super();
  }

  override direct(params: Parameters<THREE.PhysicalLightingModel['direct']>[0], builder: Parameters<THREE.PhysicalLightingModel['direct']>[1]): void {
    super.direct({ ...params, lightColor: (params.lightColor as V3).mul(this.mask) }, builder);
  }
}

/** Tirage d'après une graine dans [0, 1[. `hash` de three.js tronque son entrée en entier : on l'étale d'abord. */
const rnd = (seed: F, k: number): F => hash(seed.mul(65521).add(k)) as F;

interface Hit {
  x: F;
  y: F;
  t: F;
  side: F;
  ceiling: F;
  floor: F;
  back: F;
}

/**
 * Rayon dans une boîte : largeur `w` centrée sur x = 0, hauteur `h` depuis y = 0, profondeur `d` ; (x, y)
 * est le point d'entrée dans le plan de la vitre et le rayon avance de (vx, vy) par mètre de profondeur.
 */
function traceBox(x: F, y: F, w: F, h: F, d: F, vx: F, vy: F): Hit {
  const sx = step(float(0), vx).mul(2).sub(1);
  const dx = sx.mul(max(abs(vx), float(0.001)));
  const up = step(float(0), vy);
  const dy = up.mul(2).sub(1).mul(max(abs(vy), float(0.001)));
  const tx = max(sx.mul(w).mul(0.5).sub(x).div(dx), float(0));
  const ty = max(up.mul(h).sub(y).div(dy), float(0));
  const t = min(min(tx, ty), d);
  const side = step(tx, min(ty, d));
  const flat = step(ty, min(tx, d)).mul(float(1).sub(side));
  return { x: x.add(dx.mul(t)), y: y.add(dy.mul(t)), t, side, ceiling: flat.mul(up), floor: flat.mul(float(1).sub(up)), back: float(1).sub(side).sub(flat) };
}

/** `albedo` : vu de jour (reçoit la lumière de la façade) ; `glow` : pièce allumée, à multiplier par l'allumage. */
export interface Interior {
  albedo: V3;
  glow: V3;
}

/** Tirage de teinte parmi quatre papiers peints ou peintures (par pièce). */
function roomPaint(a: F, b: F): V3 {
  const cream = vec3(0.66, 0.59, 0.47);
  const sage = vec3(0.47, 0.53, 0.45);
  const blue = vec3(0.42, 0.5, 0.58);
  const rose = vec3(0.65, 0.48, 0.44);
  return mix(mix(cream, sage, step(float(0.45), a)), mix(blue, rose, step(float(0.5), b)), step(float(0.75), a)) as unknown as V3;
}

/**
 * Pièce d'habitation derrière une fenêtre : plafond, parquet, armoire et tableau au fond, plafonnier, puis
 * dans le plan de la vitre rideaux, voilage ou store. (x, y) : point dans le plan de la vitre, y depuis le
 * plancher ; `winY` : hauteur au-dessus de l'allège ; `halfW`, `winH` : la baie.
 */
export function roomInterior(o: { x: F; y: F; winY: F; w: F; h: F; halfW: F; winH: F; seed: F; vx: F; vy: F }): Interior {
  const s1 = o.seed;
  const s2 = rnd(o.seed, 17);
  const s3 = rnd(o.seed, 31);
  const s4 = rnd(o.seed, 53);
  const depth = s2.mul(2).add(3.2);
  const hit = traceBox(o.x, o.y, o.w, o.h, depth, o.vx, o.vy);
  const paint = roomPaint(s1, s3).mul(s4.mul(0.25).add(0.75));
  // Parquet : lames de 12 cm, bandes le long de la profondeur.
  const lames = fract(hit.x.div(0.12)).mul(0.25).add(0.75);
  const floorCol = vec3(0.3, 0.19, 0.11).mul(lames);
  const ceilCol = vec3(0.74, 0.72, 0.66);
  let col: V3 = paint.mul(float(1).sub(hit.side.mul(0.16)));
  col = mix(col, floorCol, hit.floor) as unknown as V3;
  col = mix(col, ceilCol, hit.ceiling) as unknown as V3;
  // Au fond : une armoire ou une bibliothèque contre le mur, un tableau de l'autre côté.
  const cx = s2.sub(0.5).mul(o.w.sub(1.4));
  const fw = s3.mul(0.55).add(0.45);
  const fh = s4.mul(1.1).add(0.85);
  const furn = hit.back.mul(step(abs(hit.x.sub(cx)), fw)).mul(step(hit.y, fh));
  const shelf = fract(hit.y.div(0.42)).mul(0.5).add(0.5);
  const wood = mix(vec3(0.17, 0.1, 0.06), vec3(0.3, 0.2, 0.12).mul(shelf), step(float(0.5), s3));
  col = mix(col, wood, furn) as unknown as V3;
  const px = cx.negate().mul(0.8);
  const pic = hit.back.mul(step(abs(hit.x.sub(px)), float(0.38))).mul(step(abs(hit.y.sub(1.6)), float(0.28)));
  col = mix(col, mix(vec3(0.16, 0.24, 0.32), vec3(0.5, 0.26, 0.14), s1), pic) as unknown as V3;
  // Plafonnier : décroissance depuis un point sous le plafond. Le jour, la lumière vient de la fenêtre.
  const lx = s3.sub(0.5).mul(o.w.sub(1));
  const lz = depth.mul(0.55);
  const dl = vec3(hit.x.sub(lx), hit.y.sub(o.h.sub(0.3)), hit.t.sub(lz));
  const lamp = float(1).div(dl.dot(dl).mul(0.34).add(1));
  const fall = float(1).sub(hit.t.div(depth).mul(0.68));
  let albedo: V3 = col.mul(fall).mul(0.5);
  // Lampe chaude le plus souvent, parfois plus neutre, parfois le bleu d'un écran.
  const tint = mix(mix(vec3(1, 0.72, 0.44), vec3(1, 0.86, 0.68), step(float(0.62), s4)), vec3(0.42, 0.56, 0.95), step(float(0.92), s2));
  let glow: V3 = col.mul(tint).mul(lamp.mul(1.5).add(0.22));
  // Dans le plan de la vitre : rideaux sur les côtés (plis), voilage sur toute la baie ou store baissé.
  const folds = fract(o.x.div(0.17)).mul(0.28).add(0.72);
  const curtainCol = mix(vec3(0.74, 0.7, 0.62), mix(vec3(0.5, 0.17, 0.14), vec3(0.2, 0.3, 0.42), s4), step(float(0.72), s3)).mul(folds);
  const cw = s4.mul(0.28).add(0.14).mul(o.halfW);
  const curtain = step(o.halfW.sub(cw), abs(o.x)).mul(step(float(0.22), s2));
  const blind = step(s1, float(0.16)).mul(step(o.winH.mul(float(1).sub(s3.mul(0.7))), o.winY));
  const veil = step(float(0.56), s3).mul(float(1).sub(curtain)).mul(float(1).sub(blind)).mul(0.62);
  const blindCol = vec3(0.68, 0.66, 0.6).mul(fract(o.winY.div(0.05)).mul(0.2).add(0.8));
  albedo = mix(albedo, vec3(0.62, 0.61, 0.57), veil) as unknown as V3;
  albedo = mix(albedo, curtainCol, curtain) as unknown as V3;
  albedo = mix(albedo, blindCol, blind) as unknown as V3;
  // La nuit, le tissu laisse passer la lumière de la pièce.
  const lit = tint.mul(lamp.mul(0.5).add(0.3));
  glow = mix(glow, lit.mul(vec3(0.9)), veil) as unknown as V3;
  glow = mix(glow, curtainCol.mul(lit).mul(1.1), curtain) as unknown as V3;
  glow = mix(glow, blindCol.mul(lit).mul(0.8), blind) as unknown as V3;
  return { albedo, glow };
}

/**
 * Boutique derrière une vitrine : rayonnages de marchandises au fond et sur les côtés, sol carrelé, plafond
 * clair, et une rangée d'articles posés sur un présentoir contre la vitre (ils se décalent en parallaxe).
 */
export function shopInterior(o: { x: F; y: F; w: F; h: F; seed: F; vx: F; vy: F }): Interior {
  const s2 = rnd(o.seed, 23);
  const s3 = rnd(o.seed, 49);
  const s4 = rnd(o.seed, 71);
  const depth = s2.mul(3).add(4);
  // Hors archétype, pas de rez-de-chaussée (h = 0) : hauteur bornée, le calcul tourne sur tous les pixels.
  const h = max(o.h, float(2));
  const hit = traceBox(o.x, o.y, o.w, h, depth, o.vx, o.vy);
  const wallCol = mix(vec3(0.55, 0.5, 0.4), vec3(0.24, 0.17, 0.11), step(float(0.5), s3));
  // Marchandises : cases de 18 × 32 cm sur les murs jusqu'à 2,3 m (le long du mur, profondeur sur les côtés).
  const along = mix(hit.x, hit.t, hit.side);
  const row = floor(hit.y.div(0.32));
  const cellC = floor(along.div(0.18));
  const cellH = hash(cellC.add(512).mul(61).add(row.mul(251)).add(o.seed.mul(60000))) as F;
  // Teinte dominante par boutique, plus quelques articles d'une couleur voisine.
  const hue = mix(mix(vec3(0.46, 0.2, 0.14), vec3(0.56, 0.44, 0.2), step(float(0.35), s4)), mix(vec3(0.2, 0.32, 0.25), vec3(0.24, 0.3, 0.42), step(float(0.8), s4)), step(float(0.55), s4));
  const goods = mix(hue, vec3(0.62, 0.59, 0.52), step(float(0.72), cellH)).mul(cellH.mul(0.5).add(0.6));
  const inCell = step(float(0.1), fract(along.div(0.18))).mul(step(fract(hit.y.div(0.32)), float(0.74)));
  const shelves = hit.back.add(hit.side).min(1).mul(step(float(0.32), hit.y)).mul(step(hit.y, float(2.3)));
  let col: V3 = wallCol.mul(mix(float(1), float(0.3), shelves.mul(float(1).sub(inCell))));
  col = mix(col, goods, shelves.mul(inCell).mul(step(float(0.15), cellH))) as unknown as V3;
  const checker = fract(floor(hit.x.div(0.4)).add(floor(hit.t.div(0.4))).mul(0.5)).mul(2);
  col = mix(col, mix(vec3(0.42, 0.4, 0.37), vec3(0.17, 0.16, 0.15), checker), hit.floor) as unknown as V3;
  col = mix(col, vec3(0.62, 0.6, 0.55), hit.ceiling) as unknown as V3;
  // Présentoir contre la vitre : à 55 cm derrière, table sombre de 85 cm portant des articles arrondis (parallaxe).
  const dx = o.x.add(o.vx.mul(0.55));
  const dy = o.y.add(o.vy.mul(0.55));
  const hasTable = step(float(0.3), s2);
  const table = step(dy, float(0.85)).mul(hasTable);
  const cx = floor(dx.div(0.5));
  const itemH = hash(cx.add(512).mul(53).add(o.seed.mul(60000))) as F;
  const lx = fract(dx.div(0.5)).sub(0.5).mul(0.5);
  const ly = dy.sub(0.85);
  const r = itemH.mul(0.09).add(0.11);
  const item = step(lx.mul(lx).add(ly.mul(ly)), r.mul(r)).mul(step(float(0), ly)).mul(step(float(0.3), itemH)).mul(hasTable);
  const itemCol = mix(hue.mul(1.5), vec3(0.66, 0.62, 0.54), step(float(0.65), itemH));
  let front: V3 = mix(col, vec3(0.1, 0.07, 0.05), table) as unknown as V3;
  front = mix(front, itemCol, item) as unknown as V3;
  const fall = float(1).sub(hit.t.div(depth).mul(0.55));
  // De jour, une boutique reste sombre vue de la rue : la vitre garde surtout le reflet du ciel.
  const albedo: V3 = mix(col.mul(fall), front, table.max(item)).mul(0.42) as unknown as V3;
  // Plafonniers : plus clair en haut et près de la vitrine.
  const ceilGlow = hit.y.div(h).mul(0.45).add(0.6).mul(fall.mul(0.5).add(0.5));
  const warm = mix(vec3(1, 0.8, 0.55), vec3(1, 0.9, 0.76), s3);
  const glow: V3 = mix(col.mul(ceilGlow), front.mul(0.9), table.max(item)).mul(warm) as unknown as V3;
  return { albedo, glow };
}
