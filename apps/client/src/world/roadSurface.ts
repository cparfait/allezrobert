import * as THREE from 'three/webgpu';
import { Fn, If, abs, clamp, dot, float, floor, fract, fwidth, hash, max, min, mix, mod, mx_noise_float, mx_worley_noise_vec2, normalView, positionViewDirection, positionWorld, pow, smoothstep, step, time, vec2, vec3, vec4 } from 'three/tsl';
import { asphaltGrain } from './asphalt.ts';
import { tune } from '../dev/tuning.ts';

type F = THREE.Node<'float'>;
type V3 = THREE.Node<'vec3'>;

/**
 * Surface de la chaussée : enrobé à son albédo réel (0,05 à 0,09, contre 0,24 à 0,31 avant), usure en couches
 * filtrées selon la taille du pixel, sol mouillé d'après la porosité (S. Lagarde, « Physically based wet
 * surfaces ») avec flaques et anneaux de pluie, flaque de lumière des lampadaires. ?routefx=0 : route d'origine.
 */
export const ROAD_FX = typeof location === 'undefined' || new URLSearchParams(location.search).get('routefx') !== '0';

/** Pas des lampadaires le long d'une voie (m). */
export const LAMP_SPACING = 30;
/** Distance du lampadaire à la bordure, sur le trottoir (m). */
export const LAMP_FROM_CURB = 0.6;
/** Attribut `lamp` de la voirie : 0 aucun ; 1 en quinconce (grande rue) ; 2 ou 3 d'un seul côté, gauche ou droite (rue étroite). */
export const LAMP_STAGGERED = 1;
export const LAMP_LEFT = 2;
export const LAMP_RIGHT = 3;
/** Côté du lampadaire de rang `k` (en phase avec `lampPool`). */
export const lampIsLeft = (mode: number, k: number): boolean => (mode === LAMP_STAGGERED ? ((k % 2) + 2) % 2 === 0 : mode === LAMP_LEFT);

/** Réglages (?reglages) : reflet du ciel, chaleur de l'ambiance, flaques de lumière des lampadaires. */
export const SKY_REFLECT = tune('route.ciel', 'Reflet du ciel', 1, 0, 3, 0.05);
export const WARMTH = tune('route.chaleur', "Chaleur de l'ambiance", 1, 0, 1.5, 0.02);
export const LAMP_STRENGTH = tune('nuit.lampadaires', 'Lumière des lampadaires', 1, 0, 3, 0.05);
export const LAMP_REACH = tune('nuit.portee', 'Portée des lampadaires', 1, 0.5, 2, 0.02);

/**
 * Reflet du ciel atténué (`skySpec`) : en vue rasante, la rue reflète surtout les façades d'en face, pas le ciel
 * que donne la carte d'environnement, et une chaussée sèche virait au bleu. La pluie le rend (film d'eau).
 */
export class RoadLightingModel extends THREE.PhysicalLightingModel {
  constructor(private readonly skySpec: F) {
    super();
  }

  override indirectSpecular(builder: Parameters<THREE.PhysicalLightingModel['indirectSpecular']>[0]): void {
    super.indirectSpecular(builder);
    (builder.context as unknown as { reflectedLight: { indirectSpecular: { mulAssign(n: F): void } } }).reflectedLight.indirectSpecular.mulAssign(this.skySpec.mul(SKY_REFLECT));
  }

  /** Ambiance réchauffée : le ciel seul bleuit le sol, alors que les façades et le sol lui renvoient une lumière chaude. */
  override indirectDiffuse(builder: Parameters<THREE.PhysicalLightingModel['indirectDiffuse']>[0]): void {
    super.indirectDiffuse(builder);
    (builder.context as unknown as { reflectedLight: { indirectDiffuse: { mulAssign(n: V3): void } } }).reflectedLight.indirectDiffuse.mulAssign(mix(vec3(1, 1, 1), vec3(1.0, 0.8, 0.58), WARMTH) as unknown as V3);
  }
}

/**
 * Enrobé : teinte de base (noire si neuf, grise si usé), grain, puis usure dans un vrai branchement (pixel de
 * moins de 12 cm) : rapiéçages, joints de bitume, faïençage, taches d'huile dans l'axe de la voie.
 * `across` : mètres depuis l'axe ; `along` : mètres le long de la voie.
 */
/** Grain de la photo d'enrobé, adouci : ses points clairs, pris tels quels, faisaient des mouchetures blanches en vue rasante. */
export const asphaltGrainSoft = (): F => mix(float(1), asphaltGrain().x.clamp(0.75, 1.3), 0.55) as F;

/**
 * `procedural` : rapiéçages, joint d'axe et taches d'huile tirés dans le shader (ruban de l'itinéraire) ; la
 * voirie les pose en décalques (roadDecals.ts) et ne garde ici que la teinte, le grain et le faïençage.
 * `ageBias` décale l'usure (réglage), `bright` multiplie la teinte.
 */
export function asphaltColor(across: F, along: F, half: F, mask: F, procedural = true, ageBias: F = float(0) as F, bright: F = float(1) as F): V3 {
  const wp = positionWorld.xz;
  const ax = abs(across);
  const age = mx_noise_float(wp.mul(0.035).add(17)).mul(0.5).add(0.5).add(ageBias);
  const broad = mx_noise_float(wp.mul(0.11)).mul(0.5).add(0.5);
  const grain = asphaltGrainSoft();
  const base = mix(vec3(0.046, 0.045, 0.044), vec3(0.094, 0.09, 0.085), smoothstep(0.3, 0.8, age)).mul(broad.mul(0.2).add(0.9)).mul(grain).mul(bright);
  // Traces de roues plus claires et polies, au milieu de chaque voie.
  const track = smoothstep(0.55, 0.0, abs(ax.sub(half.mul(0.5)))).mul(0.018);
  const pix = max(fwidth(along), fwidth(across));
  return Fn(() => {
    const out = base.add(track).toVar();
    const a = across.toVar();
    const v = along.toVar();
    const h = half.toVar();
    const p = pix.toVar();
    const edgeNear = float(1).sub(smoothstep(0.05, 0.12, p));
    If(mask.mul(edgeNear).greaterThan(0), () => {
      const w = wp.toVar();
      if (procedural) {
      // Rapiéçages : un sur deux environ par tranche de 11 m, sur une voie ou en tranchée le long de la rive.
      const cell = floor(v.div(11)).add(4096);
      const hp = hash(cell.mul(13));
      const start = cell.sub(4096).mul(11).add(hash(cell.mul(17)).mul(4));
      const end = start.add(hash(cell.mul(19)).mul(6).add(1.5));
      const right = step(0.5, hash(cell.mul(23)));
      const u0 = mix(h.negate().add(0.2), float(0.15), right);
      const u1 = mix(float(-0.15), h.sub(0.2), right);
      const inPatch = step(0.8, hp).mul(step(start, v)).mul(step(v, end)).mul(step(u0, a)).mul(step(a, u1));
      const patchCol = mix(vec3(0.036, 0.037, 0.04), vec3(0.08, 0.079, 0.077), step(0.6, hash(cell.mul(29)))).mul(grain);
      out.assign(mix(out, patchCol, inPatch));
      // Bord du rapiéçage : joint de bitume, plus large à distance pour rester lisible sans scintiller.
      const jw = max(float(0.03), p.mul(0.75));
      const seamPatch = inPatch.mul(max(max(float(1).sub(smoothstep(0, jw, a.sub(u0))), float(1).sub(smoothstep(0, jw, u1.sub(a)))), max(float(1).sub(smoothstep(0, jw, v.sub(start))), float(1).sub(smoothstep(0, jw, end.sub(v))))));
      // Joint d'axe ondulant, interrompu.
      const wob = mx_noise_float(vec2(v.mul(0.06), 2)).mul(0.2);
      const axis = float(1).sub(smoothstep(0.008, 0.024, abs(a.add(wob)))).mul(step(0.62, mx_noise_float(vec2(v.mul(0.05), 11)).mul(0.5).add(0.5)));
      const tar = max(seamPatch, axis);
      out.assign(mix(out, vec3(0.018, 0.018, 0.02), tar.mul(0.7).mul(float(1).sub(smoothstep(0.06, 0.12, p)))));
      }
      // Faïençage dans l'enrobé usé et près des rives, seulement de près.
      If(p.lessThan(0.04), () => {
        // Polygones (« peau de crocodile ») de 15 à 20 cm, fins et peu contrastés, par plaques rares et le long des rives.
        const cells = mx_worley_noise_vec2(w.mul(5.5).add(mx_noise_float(w.mul(9)).mul(0.1)));
        const crack = float(1).sub(smoothstep(0.0, 0.035, cells.y.sub(cells.x)));
        const zone = max(smoothstep(h.sub(0.6), h.sub(0.1), abs(a)).mul(0.4), smoothstep(0.78, 0.92, mx_noise_float(w.mul(0.05).add(3)).mul(0.5).add(0.5)));
        out.assign(mix(out, out.mul(0.72), crack.mul(zone).mul(float(1).sub(smoothstep(0.012, 0.03, p)))));
      });
      if (procedural) {
      // Taches d'huile : au milieu de la voie, une case de 7 m sur trois.
      const oc = floor(v.div(7)).add(4096);
      const has = step(0.66, hash(oc.mul(37)));
      const ov = oc.sub(4096).add(hash(oc.mul(41))).mul(7);
      const ou = h.mul(0.5).mul(step(0.5, hash(oc.mul(43))).mul(2).sub(1));
      const oRad = hash(oc.mul(47)).mul(0.28).add(0.1);
      const od = vec2(a.sub(ou), v.sub(ov)).length().add(mx_noise_float(w.mul(5)).mul(0.08));
      out.assign(mix(out, out.mul(0.55), has.mul(float(1).sub(smoothstep(oRad.mul(0.5), oRad, od)))));
      }
    });
    return out;
  })() as unknown as V3;
}

/**
 * Masques d'humidité : x = film (toute la chaussée mouillée), y = humide (taches sombres qui précèdent les
 * flaques), z = flaque. L'eau se loge le long des rives et dans les traces de roues. Calculé seulement s'il pleut.
 */
export function wetMasks(wetness: F, across: F, half: F, pixel: F, bias: F = float(0) as F): V3 {
  const wet = Fn(() => {
    const out = vec3(0).toVar();
    // Entrées évaluées avant le bloc : une dérivée (`pixel`) n'est pas permise dans un branchement.
    const a = across.toVar();
    const h = half.toVar();
    const px = pixel.toVar();
    const bi = bias.toVar();
    If(wetness.greaterThan(0.01), () => {
      const wp = positionWorld.xz;
      const ax = abs(a);
      const big = mx_noise_float(wp.mul(0.085).add(3)).mul(0.5).add(0.5);
      const mid = mx_noise_float(wp.mul(0.31).add(13)).mul(0.5).add(0.5);
      const small = mx_noise_float(wp.mul(1.15).add(23)).mul(0.5).add(0.5);
      const gutter = smoothstep(h.sub(1.3), h.sub(0.2), ax).mul(0.16);
      const ruts = float(1).sub(smoothstep(0.0, 0.55, abs(ax.sub(h.mul(0.5))))).mul(0.08);
      // `bi` : creux d'un décalque (tranchée tassée, caniveau, avaloir) où l'eau s'accumule.
      const field = big.mul(0.52).add(mid.mul(0.34)).add(small.mul(0.14)).add(gutter).add(ruts).add(bi);
      const level = mix(float(0.86), float(0.6), clamp(wetness.sub(0.1).div(0.55), 0, 1)).sub(PUDDLES);
      const damp = smoothstep(level.sub(0.14), level.sub(0.015), field);
      // Bord de flaque élargi à distance : plus net qu'un pixel, il scintillerait.
      const edge = max(float(0.02), px.mul(0.6));
      const puddle = smoothstep(level, level.add(edge), field).mul(smoothstep(0.1, 0.22, wetness));
      out.assign(vec3(smoothstep(0.1, 0.6, wetness), damp, puddle));
    });
    return out;
  })() as unknown as V3;
  return wet.add(vec3(0)) as unknown as V3;
}

/** Réglage : niveau des flaques (positif : plus de flaques). */
const PUDDLES = tune('pluie.flaques', 'Niveau des flaques', 0, -0.2, 0.25, 0.005);

/** Aspect d'un décalque de chaussée (roadDecals.ts) : rgb et couverture, matière (rugosité, porosité, métal, creux). */
export interface DecalShade {
  look: THREE.Node<'vec4'>;
  mat: THREE.Node<'vec4'>;
}

/**
 * Décalques : `dk` = (type, u 0..1 en travers, v 0..1 en long, graine), `size` = (largeur, longueur) en mètres.
 * `base` : la chaussée recalculée sous le décalque (taches d'huile, pourtour des plaques). Hors décalque : couverture 0.
 * Aspect et matière dans deux fonctions : un nœud créé dans une branche ne doit pas resservir ailleurs.
 */
export function decalShade(dk: THREE.Node<'vec4'>, size: THREE.Node<'vec2'>, pix: F, base: V3, grain: F, along: F): DecalShade {
  const v4 = (n: unknown) => n as THREE.Node<'vec4'>;
  const inputs = () => ({
    k: (dk as unknown as { x: F }).x.toVar(),
    W: (size as unknown as { x: F }).x.toVar(),
    L: (size as unknown as { y: F }).y.toVar(),
    x: (dk as unknown as { y: F }).y.mul((size as unknown as { x: F }).x).toVar(),
    y: (dk as unknown as { z: F }).z.mul((size as unknown as { y: F }).y).toVar(),
    sd: (dk as unknown as { w: F }).w.toVar(),
    p: pix.toVar(),
  });
  const edgeDist = (x: F, y: F, W: F, L: F) => min(min(x, W.sub(x)), min(y, L.sub(y)));
  // Joint de bitume autour d'un rapiéçage : fin, et estompé au loin. (Élargi avec la distance, il couvrait tout le
  // rapiéçage dès quelques dizaines de mètres : des rectangles noirs sur la chaussée.)
  const seamOf = (e: F, p: F) => float(1).sub(smoothstep(0, 0.035, e)).mul(float(1).sub(smoothstep(0.012, 0.04, p)));
  /** Couverture d'une plaque ronde, cadre, et relief en losanges (fondu au loin). */
  const manhole = (x: F, y: F, W: F, L: F, p: F) => {
    const R = W.mul(0.5);
    const rr = vec2(x.sub(R), y.sub(L.mul(0.5))).length();
    const cover = float(1).sub(smoothstep(R.sub(max(float(0.01), p)), R, rr));
    const near = float(1).sub(smoothstep(0.008, 0.022, p));
    const q = fract(vec2(x.add(y), x.sub(y)).div(0.085)).sub(0.5).abs();
    const raised = mix(float(0.45), step(max(q.x, q.y), float(0.3)), near);
    const frame = smoothstep(R.sub(0.075), R.sub(0.06), rr);
    const groove = smoothstep(R.sub(0.21), R.sub(0.2), rr).mul(float(1).sub(smoothstep(R.sub(0.18), R.sub(0.17), rr))).mul(near);
    return { cover, raised: raised.mul(float(1).sub(frame)).mul(float(1).sub(groove)), frame };
  };
  /** Pavés du caniveau : 21 cm le long de la voie, trois rangs de 14 cm, joints sombres ; teinte moyenne au loin. */
  const setts = (x: F, a: F, p: F) => {
    const rowF = x.div(0.14);
    const row = floor(rowF);
    const uu = a.div(0.21).add(fract(row.mul(0.5)));
    const fu = fract(uu);
    const fv = fract(rowF);
    const joint = min(min(fu, float(1).sub(fu)).mul(0.21), min(fv, float(1).sub(fv)).mul(0.14));
    const far = smoothstep(0.012, 0.035, p);
    const inStone = mix(smoothstep(0.008, 0.02, joint), float(0.85), far);
    const sh = hash(floor(uu).add(65536).mul(7).add(row.add(16).mul(131)));
    return { inStone, sh: mix(sh, float(0.5), far) };
  };
  const look = Fn(() => {
    const out = vec4(0).toVar();
    const { k, W, L, x, y, sd, p } = inputs();
    const b = base.toVar();
    const g = grain.toVar();
    const a = along.toVar();
    If(k.greaterThan(0.5), () => {
      const wp = positionWorld.xz;
      If(k.lessThan(1.5), () => {
        // Rapiéçage : enrobé neuf noir ou ancien gris, joint de bitume tout autour.
        const fresh = step(0.45, sd);
        const col = mix(vec3(0.088, 0.085, 0.08), vec3(0.045, 0.045, 0.047), fresh).mul(g).mul(mx_noise_float(wp.mul(0.9)).mul(0.08).add(1));
        out.assign(vec4(mix(col, vec3(0.016, 0.016, 0.018), seamOf(edgeDist(x, y, W, L), p).mul(0.85)), 1));
      })
        .ElseIf(k.lessThan(2.5), () => {
          // Tranchée : enrobé plus clair, plus grossier, joint marqué.
          const col = vec3(0.1, 0.096, 0.09).mul(g).mul(mx_noise_float(wp.mul(2.3)).mul(0.12).add(1));
          out.assign(vec4(mix(col, vec3(0.02, 0.02, 0.021), seamOf(edgeDist(x, y, W, L), p).mul(0.8)), 1));
        })
        .ElseIf(k.lessThan(3.5), () => {
          // Plaque d'égout en fonte : cadre, gorge, relief poli par les pneus.
          const m = manhole(x, y, W, L, p);
          const iron = mix(vec3(0.04, 0.038, 0.036), vec3(0.09, 0.085, 0.078), m.raised);
          out.assign(vec4(mix(iron, vec3(0.055, 0.053, 0.05), m.frame), m.cover));
        })
        .ElseIf(k.lessThan(4.5), () => {
          // Avaloir : grille en fonte sur le caniveau, fentes noires (moyennées au loin).
          const frame = step(edgeDist(x, y, W, L), float(0.045));
          const slot = step(fract(y.div(0.075)), float(0.45)).mul(float(1).sub(frame));
          const near = float(1).sub(smoothstep(0.01, 0.03, p));
          out.assign(vec4(mix(vec3(0.07, 0.066, 0.062), vec3(0.008, 0.008, 0.008), mix(float(0.4).mul(float(1).sub(frame)), slot, near)), 1));
        })
        .ElseIf(k.lessThan(5.5), () => {
          // Tache d'huile : assombrit la chaussée, bord irrégulier.
          const c = vec2(x.sub(W.mul(0.5)), y.sub(L.mul(0.5))).div(W.mul(0.5));
          const d = c.length().add(mx_noise_float(wp.mul(4)).mul(0.25));
          out.assign(vec4(b.mul(0.42), float(1).sub(smoothstep(0.35, 1, d)).mul(sd.mul(0.4).add(0.35))));
        })
        .ElseIf(k.lessThan(6.5), () => {
          // Passage piéton : bandes de 50 cm parallèles à l'axe, tous les mètres, peinture écaillée.
          const aa = max(p, float(0.004)).mul(1.2);
          const stripe = float(1).sub(smoothstep(float(0.25).sub(aa), float(0.25).add(aa), fract(x.add(0.5)).sub(0.5).abs()));
          const ends = smoothstep(0, aa, min(y, L.sub(y)));
          const chipped = smoothstep(0.2, 0.55, mx_noise_float(wp.mul(1.3)).mul(0.5).add(0.5)).mul(0.45).add(0.55);
          const col = vec3(0.6, 0.6, 0.56).mul(mx_noise_float(wp.mul(0.7)).mul(0.08).add(0.92));
          out.assign(vec4(col, stripe.mul(ends).mul(chipped)));
        })
        .Else(() => {
          // Caniveau pavé en granit.
          const s = setts(x, a, p);
          out.assign(vec4(mix(vec3(0.05, 0.048, 0.045), vec3(0.15, 0.145, 0.135).mul(s.sh.mul(0.35).add(0.75)), s.inStone), 1));
        });
    });
    return out;
  })();
  const mat = Fn(() => {
    // Rugosité, porosité, métal, creux (eau qui s'y accumule).
    const out = vec4(0.88, 0.75, 0, 0).toVar();
    const { k, W, L, x, y, sd, p } = inputs();
    const a = along.toVar();
    If(k.greaterThan(0.5), () => {
      If(k.lessThan(1.5), () => {
        const seam = seamOf(edgeDist(x, y, W, L), p);
        out.assign(vec4(mix(mix(float(0.88), float(0.78), step(0.45, sd)), float(0.45), seam), mix(float(0.75), float(0.1), seam), 0, 0.04));
      })
        .ElseIf(k.lessThan(2.5), () => {
          out.assign(vec4(0.92, 0.85, 0, 0.12));
        })
        .ElseIf(k.lessThan(3.5), () => {
          const m = manhole(x, y, W, L, p);
          out.assign(vec4(mix(float(0.78), float(0.42), m.raised), 0.05, m.raised.mul(0.5), 0));
        })
        .ElseIf(k.lessThan(4.5), () => {
          out.assign(vec4(0.6, 0.05, 0.3, 0.1));
        })
        .ElseIf(k.lessThan(5.5), () => {
          out.assign(vec4(0.55, 0.4, 0, 0));
        })
        .ElseIf(k.lessThan(6.5), () => {
          out.assign(vec4(0.6, 0.15, 0, 0));
        })
        .Else(() => {
          const s = setts(x, a, p);
          out.assign(vec4(mix(float(0.95), float(0.72), s.inStone), 0.45, 0, 0.22));
        });
    });
    return out;
  })();
  return { look: v4(look), mat: v4(mat) };
}

/** Facteur d'albédo mouillé d'une surface poreuse (Lagarde : jusqu'à ×0,2 pour une porosité de 1). */
export function wetAlbedo(porosity: F, masks: V3): F {
  const factor = mix(float(1), float(0.2), porosity);
  const level = max(masks.x.mul(0.65), masks.y);
  return mix(float(1), factor, level).mul(mix(float(1), float(0.8), masks.z)) as F;
}

/** Rugosité mouillée (Lagarde) : lissage limité par la porosité, surface miroir dans les flaques. */
export function wetRoughness(rough: F, porosity: F, masks: V3): F {
  const factor = mix(float(1), float(0.2), porosity);
  const level = max(masks.x.mul(0.65), masks.y);
  const gloss = mix(float(1), float(1).sub(rough), mix(float(1), factor, level.mul(0.5)));
  const film = mix(rough, float(1).sub(gloss), level);
  return mix(film, float(0.045), masks.z) as F;
}

/** Normale en espace tangent (x en travers, y le long) : anneaux des gouttes dans les flaques, deux grilles décalées. */
export function rippleNormal(across: F, along: F, masks: V3, wetness: F, pixel: F): V3 {
  return Fn(() => {
    const out = vec3(0, 0, 1).toVar();
    const a = across.toVar();
    const v = along.toVar();
    const near = float(1).sub(smoothstep(0.02, 0.06, pixel)).toVar();
    If(masks.z.mul(near).greaterThan(0), () => {
      const layer = (offset: number, speed: number) => {
        const p = vec2(a, v).add(offset).div(0.42);
        const id = floor(p);
        const seed = hash(id.x.add(4096).mul(127).add(id.y.add(4096).mul(311)).add(offset * 100));
        const phase = fract(time.mul(speed).add(seed.mul(7)));
        const c = fract(p).sub(0.5).add(vec2(seed, hash(seed.mul(65521))).sub(0.5).mul(0.3));
        const d = c.length();
        const radius = phase.mul(0.34);
        const ring = float(1).sub(smoothstep(0.0, 0.035, abs(d.sub(radius)))).mul(float(1).sub(phase));
        return c.div(max(d, float(0.001))).mul(ring).mul(mod(id.x.add(id.y), 3).greaterThan(0).select(float(1), float(0)));
      };
      const n = layer(0, 1.3).add(layer(0.31, 1.7)).mul(wetness.mul(0.16));
      out.assign(vec3(n, 1));
    });
    return out;
  })() as unknown as V3;
}

/**
 * Masque de réflexion lu par le SSR dans le canal alpha des normales : 1 − alpha, pour que tous les autres
 * matériaux (alpha 1) ne reflètent rien sans ajouter de cible de rendu (voir engine/renderer.ts).
 */
export function reflectAlpha(masks: V3): F {
  // Fresnel de l'eau : presque rien à la verticale, un vrai miroir en vue rasante.
  const fresnel = pow(float(1).sub(dot(normalView, positionViewDirection).clamp(0, 1)), 5).mul(0.98).add(0.02);
  const water = max(masks.z, max(masks.y.mul(0.35), masks.x.mul(0.14)));
  return float(1).sub(water.mul(fresnel).mul(1.4).min(1)) as F;
}

/** Flaque de lumière du lampadaire le plus proche ; `lamp` : mode de la voie (voir LAMP_STAGGERED), `offset` : abscisse transverse du pied. */
export function lampPool(across: F, along: F, offset: F, lamp: F): F {
  const k = floor(along.div(LAMP_SPACING).add(0.5));
  const dz = along.sub(k.mul(LAMP_SPACING));
  // Quinconce : k pair à gauche, impair à droite. Sinon, le même côté partout.
  const staggered = mod(k.add(4096), 2).mul(2).sub(1);
  const side = mix(mix(staggered, float(-1), step(1.5, lamp)), float(1), step(2.5, lamp));
  const dx = across.sub(side.mul(offset));
  const d2 = dx.mul(dx).add(dz.mul(dz));
  return float(1).div(d2.mul(0.1).div(LAMP_REACH.mul(LAMP_REACH)).add(1)).sub(0.06).max(0).mul(step(0.5, lamp)).mul(LAMP_STRENGTH) as F;
}

/** Sortie matériau (sans bloom, comme le contre-jour du feuillage) augmentée de la lumière des lampadaires. */
export const withLampLight = (output: THREE.Node, light: V3): THREE.Node => vec4((output as unknown as { rgb: V3 }).rgb.add(light), (output as unknown as { a: F }).a) as unknown as THREE.Node;
