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

/**
 * Météo au bout de `elapsedS` secondes de sortie. L'heure avance au rythme réel. En mode
 * évolutif : les nuages varient d'environ ±0,45 autour de la valeur choisie (fronts de ~20 min),
 * la pluie arrive quand le ciel se couvre au-delà de 75 %, le brouillard se lève dans la matinée,
 * le vent varie de ±40 %.
 */
export function weatherAt(w: RideWeather, elapsedS: number): WeatherNow {
  const hour = (((w.hour + elapsedS / 3600) % 24) + 24) % 24;
  if (!w.evolving) return { hour, clouds: w.clouds, rain: w.rain, fog: w.fog, windMs: w.windMs };
  const t = elapsedS / 1200;
  const clouds = clamp01(w.clouds + 0.45 * noise1(t, w.seed) + 0.15 * noise1(t * 3.1, w.seed + 7));
  const shower = clamp01((clouds - 0.75) / 0.25) * clamp01(0.6 + 0.6 * noise1(t * 2.3, w.seed + 13));
  const rain = clamp01(Math.max(w.rain * (0.5 + 0.5 * clouds), shower));
  // Brouillard du matin qui se dissipe vers 11 h.
  const morning = hour < 11 ? 1 : clamp01(1 - (hour - 11) / 1.5);
  const fog = clamp01(w.fog * morning + 0.08 * Math.max(0, noise1(t * 0.7, w.seed + 21)));
  const windMs = Math.max(0, w.windMs * (1 + 0.4 * noise1(t * 1.7, w.seed + 31)));
  return { hour, clouds, rain, fog, windMs };
}

/** Graine stable tirée d'un texte (identifiant de salle, date). */
export function weatherSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 100000;
}
