/**
 * Heure et météo d'une sortie, partagées par tout le groupe (choisies par l'hôte) et, en
 * option, qui évoluent avec le temps de façon déterministe : chaque client calcule la même
 * météo à partir de la graine et du temps écoulé depuis le départ, sans message réseau.
 */
export interface RideWeather {
  /** Heure de départ (0–24, fraction = minutes). */
  hour: number;
  /** Couverture nuageuse, pluie, brouillard (0–1) ; vent météo (m/s). */
  clouds: number;
  rain: number;
  fog: number;
  windMs: number;
  /** La météo change pendant la sortie (sinon : fixe, seule l'heure avance). */
  evolving: boolean;
  /** Graine de l'évolution (identique pour tous les coureurs d'une sortie). */
  seed: number;
}

export interface WeatherNow {
  hour: number;
  clouds: number;
  rain: number;
  fog: number;
  windMs: number;
  /** Direction d'où vient le vent (radians, cap compté depuis le nord dans le sens horaire). */
  windFrom: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Bruit 1D lisse (valeurs pseudo-aléatoires aux entiers, interpolation cosinus), dans [−1, 1]. */
function noise1(x: number, seed: number): number {
  const h = (i: number) => {
    let n = (i * 374761393 + seed * 668265263) | 0;
    n = (n ^ (n >>> 13)) * 1274126177;
    n = n ^ (n >>> 16);
    return ((n >>> 0) / 4294967295) * 2 - 1;
  };
  const i = Math.floor(x);
  const f = x - i;
  const t = (1 - Math.cos(f * Math.PI)) / 2;
  return h(i) * (1 - t) + h(i + 1) * t;
}

/** Valeur pseudo-aléatoire stable dans [0, 1[ tirée de la graine. */
function hash01(seed: number, k: number): number {
  let n = (seed * 2654435761 + k * 40503) | 0;
  n = (n ^ (n >>> 15)) * 2246822519;
  n = (n ^ (n >>> 13)) * 3266489917;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

const DEG = Math.PI / 180;

/**
 * Direction moyenne du vent d'une sortie, tirée de la graine selon les vents dominants en France :
 * secteur ouest à sud-ouest le plus souvent (perturbations atlantiques), nord-est par temps
 * anticyclonique (bise), parfois n'importe quel secteur.
 */
export function windDirection(seed: number): number {
  const u = hash01(seed, 1);
  const v = hash01(seed, 2) * 2 - 1;
  if (u < 0.55) return (250 + 35 * v) * DEG;
  if (u < 0.75) return (40 + 30 * v) * DEG;
  return hash01(seed, 3) * 2 * Math.PI;
}

/**
 * Vent réel autour de la force choisie : rafales de quelques secondes (±25 %, quelques pointes plus
 * fortes) et direction qui tourne lentement (±25° sur un quart d'heure). Toujours actif, même
 * météo fixe : un vent parfaitement constant n'existe pas.
 */
function liveWind(baseMs: number, seed: number, elapsedS: number): { windMs: number; windFrom: number } {
  const gust = 0.18 * noise1(elapsedS / 7, seed + 41) + 0.07 * noise1(elapsedS / 2.3, seed + 43);
  const peak = Math.max(0, noise1(elapsedS / 23, seed + 47) - 0.55) * 0.9;
  const windMs = Math.max(0, baseMs * (1 + gust + peak));
  const windFrom = windDirection(seed) + 25 * DEG * noise1(elapsedS / 900, seed + 53) + 6 * DEG * noise1(elapsedS / 40, seed + 59);
  return { windMs, windFrom };
}

/**
 * Météo au bout de `elapsedS` secondes de sortie. L'heure avance au rythme réel. En mode
 * évolutif : les nuages varient d'environ ±0,45 autour de la valeur choisie (fronts de ~20 min),
 * la pluie arrive quand le ciel se couvre au-delà de 75 %, le brouillard se lève dans la matinée,
 * le vent varie de ±40 %.
 */
export function weatherAt(w: RideWeather, elapsedS: number): WeatherNow {
  const hour = (((w.hour + elapsedS / 3600) % 24) + 24) % 24;
  if (!w.evolving) return { hour, clouds: w.clouds, rain: w.rain, fog: w.fog, ...liveWind(w.windMs, w.seed, elapsedS) };
  const t = elapsedS / 1200;
  const clouds = clamp01(w.clouds + 0.45 * noise1(t, w.seed) + 0.15 * noise1(t * 3.1, w.seed + 7));
  const shower = clamp01((clouds - 0.75) / 0.25) * clamp01(0.6 + 0.6 * noise1(t * 2.3, w.seed + 13));
  const rain = clamp01(Math.max(w.rain * (0.5 + 0.5 * clouds), shower));
  // Brouillard du matin qui se dissipe vers 11 h.
  const morning = hour < 11 ? 1 : clamp01(1 - (hour - 11) / 1.5);
  const fog = clamp01(w.fog * morning + 0.08 * Math.max(0, noise1(t * 0.7, w.seed + 21)));
  // Force moyenne qui varie de ±40 % au fil des fronts, puis rafales et direction.
  const base = Math.max(0, w.windMs * (1 + 0.4 * noise1(t * 1.7, w.seed + 31)));
  return { hour, clouds, rain, fog, ...liveWind(base, w.seed, elapsedS) };
}

/** Graine stable tirée d'un texte (identifiant de salle, date). */
export function weatherSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 100000;
}
