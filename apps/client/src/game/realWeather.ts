/**
 * Météo réelle du jour au lieu de la sortie, d'après Open-Meteo (https://open-meteo.com) : gratuit,
 * sans clé ni compte, données sous licence CC BY 4.0. Seule la position du départ (arrondie à
 * 0,01°, ≈ 1 km) quitte le navigateur. La conversion vers les curseurs du jeu est pure et testée.
 */

/** Ce que la météo réelle remplace dans les réglages de la sortie. */
export interface RealWeather {
  clouds: number;
  rain: number;
  fog: number;
  windMs: number;
  /** Direction d'où vient le vent (degrés depuis le nord, sens horaire). */
  windFromDeg: number;
}

/** Sous-ensemble de la réponse `hourly` d'Open-Meteo utilisé par le jeu. */
export interface OpenMeteoHourly {
  hourly?: {
    time?: string[];
    cloud_cover?: Array<number | null>;
    precipitation?: Array<number | null>;
    weather_code?: Array<number | null>;
    visibility?: Array<number | null>;
    wind_speed_10m?: Array<number | null>;
    wind_direction_10m?: Array<number | null>;
  };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Codes WMO : brouillard (45, 48), orage (95–99). */
const FOG_CODES = new Set([45, 48]);
const isStorm = (code: number) => code >= 95;

/**
 * Valeurs d'Open-Meteo à l'heure de départ (0–24, heure locale) → curseurs du jeu.
 * - nuages : couverture en % ;
 * - pluie : intensité perçue, √(mm/h ÷ 5) (0,2 mm/h ≈ 0,2 ; 1 mm/h ≈ 0,45 ; 5 mm/h et plus = 1), forte en cas d'orage ;
 * - brouillard : visibilité (0 au-delà de 10 km, 0,8 sous 1 km), au moins 0,7 si le code WMO l'annonce ;
 * - vent : à 10 m, en m/s (borné à 25 comme le serveur).
 * Renvoie null si l'heure demandée manque dans la réponse.
 */
export function realWeatherFromOpenMeteo(data: OpenMeteoHourly, hour: number): RealWeather | null {
  const h = data.hourly;
  if (!h?.time?.length) return null;
  const i = Math.min(Math.max(Math.floor(hour), 0), h.time.length - 1);
  const at = (a: Array<number | null> | undefined) => {
    const v = a?.[i];
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  };
  const cover = at(h.cloud_cover);
  const wind = at(h.wind_speed_10m);
  if (cover === undefined || wind === undefined) return null;
  const code = at(h.weather_code) ?? 0;
  const precip = Math.max(0, at(h.precipitation) ?? 0);
  const visibility = at(h.visibility);
  let rain = clamp01(Math.sqrt(precip / 5));
  if (isStorm(code)) rain = Math.max(rain, 0.8);
  let fog = visibility === undefined ? 0 : clamp01((10000 - visibility) / 9000) * 0.8;
  if (FOG_CODES.has(code)) fog = Math.max(fog, 0.7);
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    clouds: round(clamp01(cover / 100)),
    rain: round(rain),
    fog: round(fog),
    windMs: round(Math.min(Math.max(wind, 0), 25)),
    windFromDeg: Math.round((((at(h.wind_direction_10m) ?? 0) % 360) + 360) % 360),
  };
}

/** Adresse de la prévision horaire du jour (heure de Paris : le jeu ne roule qu'en France). */
export function openMeteoUrl(lat: number, lon: number): string {
  const q = new URLSearchParams({
    latitude: lat.toFixed(2),
    longitude: lon.toFixed(2),
    hourly: 'cloud_cover,precipitation,weather_code,visibility,wind_speed_10m,wind_direction_10m',
    wind_speed_unit: 'ms',
    timezone: 'Europe/Paris',
    forecast_days: '1',
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

/** Réponses gardées 30 min : relancer une sortie ne refait pas l'appel. */
const CACHE_MS = 30 * 60 * 1000;
const cache = new Map<string, { at: number; data: OpenMeteoHourly }>();

/**
 * Météo réelle au départ, à l'heure choisie. null si le réseau, le service ou la réponse fait défaut :
 * la sortie garde alors la météo réglée à la main.
 */
export async function fetchRealWeather(
  lat: number,
  lon: number,
  hour: number,
  opts: { fetch?: typeof fetch; timeoutMs?: number; now?: () => number } = {},
): Promise<RealWeather | null> {
  const url = openMeteoUrl(lat, lon);
  const now = (opts.now ?? Date.now)();
  let data = cache.get(url);
  if (!data || now - data.at > CACHE_MS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 4000);
    try {
      const res = await (opts.fetch ?? fetch)(url, { signal: ctrl.signal });
      if (!res.ok) return null;
      data = { at: now, data: (await res.json()) as OpenMeteoHourly };
      cache.set(url, data);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return realWeatherFromOpenMeteo(data.data, hour);
}

/** Vide le cache (tests). */
export function clearRealWeatherCache(): void {
  cache.clear();
}
