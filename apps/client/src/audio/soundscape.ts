/**
 * Logique du paysage sonore, sans WebAudio ni DOM (testée sous Node, voir test/soundscape.test.ts) :
 * revêtement → roulement, vent relatif, roue libre, souffle selon l'effort, ambiances selon le lieu,
 * l'heure, la saison et la météo, public près des sommets, voitures spatialisées.
 *
 * Toutes les grandeurs « gain » sont des amplitudes linéaires avant le bus de leur catégorie ; leur
 * somme reste bornée (voir le test « budget ») et le limiteur du bus général garde une marge.
 */
import type { RouteSegment } from '@allezrobert/shared';
import type { TileRoad } from '../world/types.ts';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Number.isFinite(x) ? x : lo));

// ————————————————————————————————————————————— Revêtement

/** Revêtement entendu sous les roues. */
export type Surface = 'smooth' | 'rough' | 'cobbles' | 'gravel' | 'dirt';
export const SURFACES: readonly Surface[] = ['smooth', 'rough', 'cobbles', 'gravel', 'dirt'];

const COBBLES = new Set(['sett', 'cobblestone', 'unhewn_cobblestone', 'cobblestone:flattened', 'paving_stones:sett']);
const ROUGH = new Set(['paving_stones', 'concrete:plates', 'concrete:lanes', 'chipseal', 'metal', 'wood', 'grass_paver', 'bricks']);
const GRAVEL = new Set(['compacted', 'fine_gravel', 'gravel', 'pebblestone', 'unpaved', 'rock', 'shells']);
const DIRT = new Set(['dirt', 'ground', 'earth', 'grass', 'sand', 'mud', 'woodchips']);
/** Grandes routes : enrobé récent, lisse. */
const SMOOTH_KINDS = /^(motorway|trunk|primary|secondary|tertiary)(_link)?$|^(residential|living_street)$/;

/**
 * Revêtement d'après les tags OSM (`surface`, `highway`). Le pipeline écrit « asphalt » quand une
 * voie revêtue n'a pas de tag : l'enrobé est alors lisse sur les grandes routes et les rues, plus
 * rugueux sur les petites routes de campagne, les dessertes et les chemins revêtus.
 */
export function surfaceFromOsm(surface: string | undefined, kind?: string): Surface {
  const s = (surface ?? '').toLowerCase().trim();
  if (COBBLES.has(s)) return 'cobbles';
  if (ROUGH.has(s)) return 'rough';
  if (GRAVEL.has(s)) return 'gravel';
  if (DIRT.has(s)) return 'dirt';
  const k = kind ?? '';
  if (!s && /^(track|path|bridleway|footway)$/.test(k)) return 'gravel';
  if (s === 'concrete') return 'smooth';
  return SMOOTH_KINDS.test(k) ? 'smooth' : 'rough';
}

/** Distance au carré d'un point au segment [a, b]. */
function dist2ToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const L = dx * dx + dz * dz;
  const t = L > 0 ? clamp(((px - ax) * dx + (pz - az) * dz) / L, 0, 1) : 0;
  const ex = ax + t * dx - px;
  const ez = az + t * dz - pz;
  return ex * ex + ez * ez;
}

/**
 * Revêtement sous le coureur : voie la plus proche parmi celles de la tuile (le morceau de
 * l'itinéraire actif est préféré à distance égale), dans la largeur de chaussée + 3 m. `null`
 * si aucune voie n'est assez proche (on garde alors le revêtement précédent).
 */
export function surfaceAt(roads: readonly TileRoad[], x: number, z: number, routeId?: string): Surface | null {
  let best: TileRoad | null = null;
  let bestScore = Infinity;
  for (const r of roads) {
    if (r.tunnel && !r.route) continue;
    const p = r.pts;
    const reach = Math.max(r.width, 3) / 2 + 3;
    let d2 = Infinity;
    for (let i = 0; i + 3 < p.length; i += 2) {
      d2 = Math.min(d2, dist2ToSegment(x, z, p[i] as number, p[i + 1] as number, p[i + 2] as number, p[i + 3] as number));
    }
    if (d2 > reach * reach) continue;
    // Bonus de 2 m pour l'itinéraire actif (les voies qui le croisent ne volent pas le revêtement).
    const score = Math.sqrt(d2) - (routeId && r.route === routeId ? 2 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best ? surfaceFromOsm(best.surface, best.kind) : null;
}

// ————————————————————————————————————————————— Roulement et vent

export interface TireMix {
  /** Bourdonnement du pneu (bruit rose filtré passe-bande). */
  roar: { gain: number; freq: number; q: number };
  /** Grain fin de la chaussée (bruit blanc passe-haut). */
  hiss: { gain: number; freq: number };
  /** Gravillons qui crépitent : vitesse de lecture du tampon de crépitement (1 = ~400 grains/s). */
  crunch: { gain: number; rate: number };
  /** Pavés : impacts par seconde (un pavé tous les 16 cm environ). */
  cobble: { gain: number; rate: number };
  /** Projection d'eau sur route mouillée. */
  spray: number;
}

interface TireProfile {
  roar: number;
  roarHz: number;
  q: number;
  hiss: number;
  hissHz: number;
  crunch: number;
  cobble: number;
}

/** Signature de chaque revêtement (facteurs relatifs à l'enrobé lisse). */
export const TIRE_PROFILES: Record<Surface, TireProfile> = {
  smooth: { roar: 1, roarHz: 0, q: 1.1, hiss: 0.15, hissHz: 4200, crunch: 0, cobble: 0 },
  rough: { roar: 1.45, roarHz: 70, q: 0.8, hiss: 0.8, hissHz: 3400, crunch: 0.15, cobble: 0 },
  cobbles: { roar: 1.3, roarHz: 30, q: 0.6, hiss: 0.4, hissHz: 3000, crunch: 0.08, cobble: 1 },
  gravel: { roar: 0.8, roarHz: 60, q: 0.6, hiss: 0.25, hissHz: 1700, crunch: 0, cobble: 0 },
  dirt: { roar: 0.6, roarHz: -40, q: 0.6, hiss: 0.15, hissHz: 1500, crunch: 0, cobble: 0 },
};

/** Espacement moyen des pavés (m). */
export const COBBLE_SPACING_M = 0.16;

/** Roulement selon le revêtement, la vitesse (m/s) et l'humidité de la chaussée (0–1). */
export function tireMix(surface: Surface, speedMs: number, wet = 0): TireMix {
  const v = Math.max(0, Number.isFinite(speedMs) ? speedMs : 0);
  const p = TIRE_PROFILES[surface];
  // Rien à l'arrêt, montée douce entre 0,3 et 2 m/s (pas de clic au démarrage).
  const roll = smoothstep(0.3, 2, v);
  const sp = Math.min(v / 12, 1.6);
  const paved = surface === 'smooth' || surface === 'rough' || surface === 'cobbles';
  return {
    roar: { gain: 0.09 * p.roar * roll * sp ** 0.8, freq: Math.max(60, 110 + v * 22 + p.roarHz), q: p.q },
    hiss: { gain: 0.05 * p.hiss * roll * Math.min(1.4, v / 10), freq: p.hissHz },
    crunch: { gain: 0.4 * p.crunch * roll * Math.min(1.2, Math.sqrt(v / 8)), rate: clamp(0.35 + v / 12, 0.35, 1.3) },
    cobble: { gain: 0.16 * p.cobble * roll * Math.min(1, v / 5), rate: v / COBBLE_SPACING_M },
    spray: 0.05 * clamp(wet, 0, 1) * roll * Math.min(1.3, v / 10) * (paved ? 1 : 0.5),
  };
}

/**
 * Vitesse de l'air vue par le coureur (m/s) : vitesse propre, plus le vent météo (d'où il vient,
 * radians, 0 = nord, sens horaire) projeté sur le cap (atan2(dirX, dirZ), repère x est / z sud).
 */
export function apparentWind(speedMs: number, windMs: number, windFrom: number, heading: number): number {
  // Vent qui souffle vers (−sin f, +cos f) ; direction du coureur (sin h, cos h).
  const along = windMs * Math.cos(windFrom + heading);
  const across = windMs * Math.sin(windFrom + heading);
  return Math.hypot(speedMs - along, across);
}

/** Souffle de l'air aux oreilles : volume et brillance croissent avec la vitesse de l'air. */
export function windMix(airMs: number): { gain: number; freq: number } {
  const a = Math.max(0, Number.isFinite(airMs) ? airMs : 0);
  return { gain: Math.min(0.2, 0.004 + 0.14 * (a / 15) ** 2), freq: Math.min(2400, 220 + a * 70) };
}

// ————————————————————————————————————————————— Roue libre et transmission

/** Circonférence d'une roue de 700 × 25C (m) et cliquets du moyeu (36 dents, type DT Swiss). */
export const WHEEL_CIRCUMFERENCE_M = 2.105;
export const HUB_ENGAGEMENTS = 36;

/** Le moyeu cliquette quand la roue tourne plus vite que les pédales ne l'entraînent. */
export function isCoasting(cadence: number, watts: number, speedMs: number): boolean {
  return speedMs > 0.8 && (cadence < 8 || watts < 5);
}

/** Cliquets par seconde selon la vitesse de la roue. */
export function freewheelRate(speedMs: number): number {
  return (Math.max(0, speedMs) / WHEEL_CIRCUMFERENCE_M) * HUB_ENGAGEMENTS;
}

/**
 * Gain d'un cliquet : puissance moyenne constante au-delà de 40 cliquets/s (le crépitement devient
 * bourdonnement sans monter en volume), un peu plus fort qu'à l'arrêt quand la roue lance.
 */
export function freewheelClickGain(rate: number): number {
  if (rate <= 0) return 0;
  return 0.15 / Math.sqrt(Math.max(1, rate / 40));
}

// ————————————————————————————————————————————— Souffle du coureur

export interface BreathParams {
  /** Cycles par minute. */
  rate: number;
  /** Amplitude de l'expiration (0 = inaudible). */
  gain: number;
  /** Ouverture de la bouche : 0 = nez / bouche fermée, 1 = halètement. */
  open: number;
  /** Effort lissé (puissance / FTP). */
  effort: number;
  /** FC rapportée à la FC max, mesurée ou déduite. */
  hr: number;
}

/**
 * Respiration selon l'effort, même logique que le visage animé (rider/face.ts) : effort =
 * puissance / FTP lissée sur ~2 s ; FC mesurée sinon déduite (0,55 + 0,4 × effort) ; rythme de 12 à
 * 50 cycles par minute selon la FC. Audible seulement au-delà de ~60 % de la FTP, discrète.
 */
export class BreathModel {
  private effort = 0;

  update(dt: number, ftpFrac: number, hrFrac?: number, coasting = false): BreathParams {
    const f = Math.max(0, Number.isFinite(ftpFrac) ? ftpFrac : 0);
    this.effort += (f - this.effort) * (1 - Math.exp(-Math.max(0, dt) / 2));
    const e = this.effort;
    const hr = hrFrac !== undefined && Number.isFinite(hrFrac) && hrFrac > 0 ? Math.min(1, hrFrac) : Math.min(1, 0.55 + 0.4 * e);
    const rate = 12 + 38 * smoothstep(0.5, 1, hr);
    // Après un gros effort, la FC reste haute : on souffle encore en roue libre (un peu moins fort).
    const level = Math.max(smoothstep(0.6, 1.2, e), 0.7 * smoothstep(0.82, 0.97, hr));
    return { rate, gain: 0.25 * level * (coasting ? 0.7 : 1), open: smoothstep(0.85, 1.3, e), effort: e, hr };
  }
}

/**
 * Enveloppe d'un cycle (inspiration puis expiration) : points [temps relatif (s), amplitude] à
 * appliquer en rampes linéaires sur le gain du souffle. L'expiration est plus forte et plus longue.
 */
export function breathEnvelope(rate: number, gain: number): Array<[number, number]> {
  const period = 60 / Math.max(6, rate);
  const inhale = period * 0.38;
  const exhale = period * 0.5;
  const g = Math.max(0, gain);
  return [
    [0, 0],
    [inhale * 0.35, g * 0.45],
    [inhale, 0.0],
    [inhale + 0.02, 0],
    [inhale + exhale * 0.18, g],
    [inhale + exhale, 0],
  ];
}

// ————————————————————————————————————————————— Public

/** Zone du public : 350 derniers mètres d'une côte (comme world/crowd.ts), ligne de sprint. */
export function crowdZone(seg: RouteSegment): { from: number; to: number; weight: number } | null {
  if (seg.kind === 'kom') return { from: Math.max(seg.startM, seg.endM - 350), to: seg.endM, weight: 1 };
  if (seg.kind === 'sprint') return { from: Math.max(seg.startM, seg.endM - 120), to: seg.endM + 20, weight: 0.45 };
  return null;
}

/**
 * Présence du public (0–1) à la distance `d` de l'itinéraire : pleine dans la zone, entendue de
 * loin en approche (250 m), vite éteinte après le sommet (120 m). Boucle : distances repliées.
 */
export function crowdLevel(d: number, segments: readonly RouteSegment[], lengthM: number, loop: boolean): number {
  let best = 0;
  for (const seg of segments) {
    const z = crowdZone(seg);
    if (!z) continue;
    const shifts = loop && lengthM > 0 ? [-lengthM, 0, lengthM] : [0];
    for (const s of shifts) {
      const x = d + s;
      let lvl: number;
      if (x < z.from) lvl = (1 - Math.min(1, (z.from - x) / 250)) ** 2;
      else if (x > z.to) lvl = (1 - Math.min(1, (x - z.to) / 120)) ** 2;
      else lvl = 1;
      best = Math.max(best, lvl * z.weight);
    }
  }
  return best;
}

export interface CrowdActivity {
  /** Rumeur continue. */
  bed: number;
  /** Événements par seconde. */
  claps: number;
  shouts: number;
  whistles: number;
  cowbells: number;
}

/** Ce que fait le public : plus il est proche et plus le coureur souffre, plus il pousse. */
export function crowdActivity(level: number, ftpFrac: number, mountain = false): CrowdActivity {
  const l = clamp(level, 0, 1);
  const excite = 0.55 + 0.65 * smoothstep(0.8, 1.3, ftpFrac);
  return {
    bed: 0.16 * l * (0.7 + 0.3 * excite),
    claps: 14 * l * excite,
    shouts: 2.6 * l * l * excite,
    whistles: 0.5 * l * excite,
    cowbells: mountain ? 0.8 * l * excite : 0,
  };
}

// ————————————————————————————————————————————— Trafic

export interface VehicleSound {
  id: number;
  kind: 'car' | 'van' | 'tractor';
  x: number;
  z: number;
  /** Vitesse (m/s) dans le repère monde. */
  vx: number;
  vz: number;
}

export interface Listener {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Cap (atan2(dirX, dirZ)). */
  heading: number;
}

export interface VehicleVoice {
  gain: number;
  pan: number;
  /** Rapport de fréquence de l'effet Doppler. */
  doppler: number;
  /** Absorption de l'air (passe-bas, Hz). */
  lowpass: number;
  dist: number;
}

export const VEHICLE_RANGE_M = 260;
const SOUND_SPEED = 343;

/** Panoramique d'une source : −1 gauche, +1 droite, selon le cap de l'auditeur. */
export function panFor(dx: number, dz: number, heading: number): number {
  const d = Math.hypot(dx, dz);
  if (d < 1) return 0;
  // Droite du coureur = avant × haut = (−dirZ, dirX) = (−cos h, sin h) dans le repère x est / y haut /
  // z sud (direct) : en roulant vers le sud, l'ouest est à droite.
  const right = (dx * -Math.cos(heading) + dz * Math.sin(heading)) / d;
  return clamp(right, -1, 1);
}

/** Voix d'un véhicule : atténuation (1/d), panoramique, Doppler, air qui filtre les aigus au loin. */
export function vehicleVoice(v: VehicleSound, l: Listener): VehicleVoice {
  const dx = v.x - l.x;
  const dz = v.z - l.z;
  const d = Math.hypot(dx, dz);
  const kindGain = v.kind === 'tractor' ? 1.25 : v.kind === 'van' ? 1.1 : 1;
  const gain = d >= VEHICLE_RANGE_M ? 0 : Math.min(1, 8 / Math.max(d, 3)) * (1 - d / VEHICLE_RANGE_M) * kindGain;
  // Vers l'auditeur : u = (l − v) / d.
  const ux = d > 0.01 ? -dx / d : 0;
  const uz = d > 0.01 ? -dz / d : 0;
  const vs = v.vx * ux + v.vz * uz; // source qui s'approche
  const vl = -(l.vx * ux + l.vz * uz); // auditeur qui s'approche
  const doppler = clamp((SOUND_SPEED + vl) / (SOUND_SPEED - vs), 0.8, 1.25);
  return { gain, pan: panFor(dx, dz, l.heading), doppler, lowpass: Math.max(500, 9000 / (1 + d / 50)), dist: d };
}

// ————————————————————————————————————————————— Ambiances

export interface AmbienceInput {
  hour: number;
  season: Season;
  /** 0 = plein jour, 1 = nuit noire (World.nightFactor). */
  night: number;
  rain: number;
  windMs: number;
  /** Occupation du sol autour du coureur (0–1). */
  forest: number;
  urban: number;
  /** Champs et prés. */
  open: number;
}

export interface AmbienceMix {
  /** Événements par minute. */
  songbirds: number;
  calls: number;
  skylark: number;
  cuckoo: number;
  woodpecker: number;
  pigeon: number;
  crows: number;
  owl: number;
  dogs: number;
  /** Gains des couches continues. */
  birdGain: number;
  crickets: number;
  foliage: number;
  wind: number;
  village: number;
  rainHiss: number;
  rainDrops: number;
  rainLeaves: number;
  /** Cloches des églises : pas la nuit. Vaches : au pré hors hiver, le jour. */
  bells: boolean;
  cows: boolean;
}

/** Heure du lever du soleil (heure légale, Île-de-France) par saison. */
export const SUNRISE: Record<Season, number> = { spring: 6.9, summer: 6.0, autumn: 7.9, winter: 8.6 };
/** Chant des passereaux : printemps plein, été plus calme, automne rare, hiver muet. */
const SONG: Record<Season, number> = { spring: 1, summer: 0.55, autumn: 0.15, winter: 0 };
/** Grillons et sauterelles : été surtout, fin d'été / début d'automne, jamais l'hiver. */
const INSECTS: Record<Season, number> = { spring: 0.25, summer: 1, autumn: 0.45, winter: 0 };
/** Feuillage (bruissement) : arbres nus l'hiver. */
const LEAVES: Record<Season, number> = { spring: 0.85, summer: 1, autumn: 0.8, winter: 0.3 };

/** Couches et événements d'ambiance selon le lieu, l'heure, la saison et la météo. */
export function ambienceMix(a: AmbienceInput): AmbienceMix {
  const night = clamp(a.night, 0, 1);
  const day = 1 - night;
  const rain = clamp(a.rain, 0, 1);
  const forest = clamp(a.forest, 0, 1);
  const urban = clamp(a.urban, 0, 1);
  const open = clamp(a.open, 0, 1);
  const wind = Math.max(0, a.windMs);
  const s = a.season;
  const hour = Number.isFinite(a.hour) ? a.hour : 12;
  // Chœur de l'aube : pic une demi-heure après le lever du soleil.
  const dawn = Math.exp(-(((hour - SUNRISE[s] - 0.5) / 1.2) ** 2));
  const weather = clamp(1 - rain * 1.6, 0, 1) * clamp(1 - Math.max(0, wind - 8) / 10, 0.3, 1);
  const habitat = clamp(0.35 + 0.65 * forest + 0.25 * urban, 0, 1);
  const dayBirds = day * weather;
  const dusk = smoothstep(0.15, 0.7, night);
  return {
    songbirds: 14 * SONG[s] * dayBirds * (1 + 1.5 * dawn) * habitat,
    calls: 4 * dayBirds * habitat * (s === 'winter' ? 1 : 0.6),
    skylark: s === 'spring' || s === 'summer' ? 1.2 * dayBirds * open * (1 - forest) : 0,
    cuckoo: s === 'spring' ? 0.8 * dayBirds * clamp(forest + 0.3 * open, 0, 1) : 0,
    woodpecker: 0.6 * dayBirds * forest * { spring: 1, summer: 0.3, autumn: 0.2, winter: 0.5 }[s],
    pigeon: 0.7 * dayBirds * clamp(forest + 0.5 * urban, 0, 1) * { spring: 1, summer: 1, autumn: 0.4, winter: 0.2 }[s],
    crows: 1.2 * day * open * (1 - 0.5 * rain) * { spring: 0.4, summer: 0.4, autumn: 0.8, winter: 1 }[s],
    owl: 0.5 * night * clamp(forest + 0.3 * urban, 0, 1) * (1 - rain) * { spring: 0.6, summer: 0.4, autumn: 1, winter: 1 }[s],
    dogs: 0.6 * urban * (0.5 + 0.5 * day),
    birdGain: 0.5 + 0.5 * dawn,
    crickets: 0.11 * INSECTS[s] * (0.15 * day * open + dusk) * clamp(0.3 + 0.7 * (open + 0.5 * urban), 0, 1) * (1 - rain),
    foliage: 0.045 * forest * LEAVES[s] * smoothstep(0.5, 8, wind),
    wind: 0.05 * smoothstep(1, 12, wind) * (0.6 + 0.4 * open),
    village: 0.055 * urban * (0.4 + 0.6 * day),
    rainHiss: 0.08 * rain,
    rainDrops: 0.065 * rain ** 0.7,
    rainLeaves: 0.06 * rain * forest,
    bells: hour >= 7 && hour <= 21.5,
    cows: s !== 'winter' && day > 0.3,
  };
}

/** Probabilité qu'un événement de `perMin` par minute survienne pendant `dt` (processus de Poisson). */
export function eventChance(perMin: number, dt: number): number {
  return perMin > 0 && dt > 0 ? 1 - Math.exp((-perMin * dt) / 60) : 0;
}

/** Part de réverbération (0–0,35) : forte entre les façades d'un village, douce en forêt, nulle en plaine. */
export function reverbWet(land: { forest: number; urban: number }): number {
  return Math.min(0.35, 0.32 * Math.max(0, land.urban) + 0.14 * Math.max(0, land.forest));
}
