import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearRealWeatherCache, fetchRealWeather, openMeteoUrl, realWeatherFromOpenMeteo, type OpenMeteoHourly } from '../src/game/realWeather.ts';

/** Journée type : valeurs différentes à 8 h et à 14 h. */
function day(over: Partial<Record<string, Array<number | null>>> = {}): OpenMeteoHourly {
  const n = 24;
  const fill = (v: number) => Array.from({ length: n }, () => v);
  return {
    hourly: {
      time: Array.from({ length: n }, (_, i) => `2026-10-27T${String(i).padStart(2, '0')}:00`),
      cloud_cover: fill(40),
      precipitation: fill(0),
      weather_code: fill(2),
      visibility: fill(24000),
      wind_speed_10m: fill(3),
      wind_direction_10m: fill(250),
      ...over,
    },
  };
}

describe('Open-Meteo → curseurs du jeu', () => {
  it('beau temps : nuages en part, pas de pluie ni de brouillard, vent et direction tels quels', () => {
    expect(realWeatherFromOpenMeteo(day(), 14.5)).toEqual({ clouds: 0.4, rain: 0, fog: 0, windMs: 3, windFromDeg: 250 });
  });

  it('prend l’heure de départ (heure locale, arrondie à l’heure pleine)', () => {
    const cover = Array.from({ length: 24 }, (_, i) => (i === 8 ? 100 : 0));
    expect(realWeatherFromOpenMeteo(day({ cloud_cover: cover }), 8.75)?.clouds).toBe(1);
    expect(realWeatherFromOpenMeteo(day({ cloud_cover: cover }), 9)?.clouds).toBe(0);
  });

  it('pluie : √(mm/h ÷ 5), forte en cas d’orage', () => {
    const at = (mm: number, code = 61) => realWeatherFromOpenMeteo(day({ precipitation: Array(24).fill(mm), weather_code: Array(24).fill(code) }), 10)!.rain;
    expect(at(0.2)).toBeCloseTo(0.2, 2);
    expect(at(1.25)).toBeCloseTo(0.5, 2);
    expect(at(12)).toBe(1);
    expect(at(0.1, 95)).toBe(0.8);
  });

  it('brouillard : visibilité, ou code WMO 45 / 48', () => {
    const at = (vis: number, code = 3) => realWeatherFromOpenMeteo(day({ visibility: Array(24).fill(vis), weather_code: Array(24).fill(code) }), 7)!.fog;
    expect(at(20000)).toBe(0);
    expect(at(500)).toBe(0.8);
    expect(at(5500)).toBeCloseTo(0.4, 2);
    expect(at(20000, 45)).toBe(0.7);
  });

  it('vent borné à 25 m/s, direction ramenée dans [0, 360[', () => {
    const w = realWeatherFromOpenMeteo(day({ wind_speed_10m: Array(24).fill(40), wind_direction_10m: Array(24).fill(-30) }), 12)!;
    expect(w.windMs).toBe(25);
    expect(w.windFromDeg).toBe(330);
  });

  it('réponse incomplète : null (la sortie garde la météo réglée)', () => {
    expect(realWeatherFromOpenMeteo({}, 10)).toBeNull();
    expect(realWeatherFromOpenMeteo(day({ cloud_cover: Array(24).fill(null) }), 10)).toBeNull();
  });
});

describe('appel Open-Meteo', () => {
  beforeEach(() => clearRealWeatherCache());

  it('adresse : position arrondie à 0,01°, vent en m/s, heure de Paris, sans clé', () => {
    const u = new URL(openMeteoUrl(48.40123, 2.70456));
    expect(u.origin).toBe('https://api.open-meteo.com');
    expect(u.searchParams.get('latitude')).toBe('48.40');
    expect(u.searchParams.get('longitude')).toBe('2.70');
    expect(u.searchParams.get('wind_speed_unit')).toBe('ms');
    expect(u.searchParams.get('timezone')).toBe('Europe/Paris');
    expect(u.searchParams.has('apikey')).toBe(false);
  });

  it('réponse gardée 30 min, puis redemandée', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(day())));
    let now = 0;
    const opts = { fetch: f as unknown as typeof fetch, now: () => now };
    expect(await fetchRealWeather(48.4, 2.7, 10, opts)).toMatchObject({ clouds: 0.4 });
    now = 29 * 60 * 1000;
    await fetchRealWeather(48.4, 2.7, 15, opts);
    expect(f).toHaveBeenCalledTimes(1);
    now = 31 * 60 * 1000;
    await fetchRealWeather(48.4, 2.7, 15, opts);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('réseau coupé, erreur HTTP ou délai dépassé : null', async () => {
    expect(await fetchRealWeather(48.4, 2.7, 10, { fetch: (async () => Promise.reject(new TypeError('offline'))) as unknown as typeof fetch })).toBeNull();
    expect(await fetchRealWeather(48.4, 2.7, 10, { fetch: (async () => new Response('', { status: 503 })) as unknown as typeof fetch })).toBeNull();
    const hang = ((_: string, init?: RequestInit) =>
      new Promise((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as unknown as typeof fetch;
    expect(await fetchRealWeather(48.4, 2.7, 10, { fetch: hang, timeoutMs: 20 })).toBeNull();
  });
});
