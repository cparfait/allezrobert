/** Mise en forme des chiffres. */
import { lang, S, type FieldId, type Metrics } from './state.ts';

export const nf = (v: number, d = 0): string => v.toLocaleString(lang, { minimumFractionDigits: d, maximumFractionDigits: d });

export function fmtTime(s: number): string {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Distance lisible : « 350 m », « 2,35 km ». */
export function fmtDist(m: number, d = 2): string {
  m = Math.max(0, m);
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${nf(m / 1000, d)} km`;
}

/** Zone de puissance (Coggan, 7 zones) : numéro et couleur. */
export function zoneOf(watts: number, ftp: number): { n: number; color: string } {
  const r = watts / Math.max(ftp, 1);
  const zones: Array<[number, string]> = [
    [0.55, '#b6c0cd'],
    [0.75, '#60a5fa'],
    [0.9, '#22c55e'],
    [1.05, '#eab308'],
    [1.2, '#f97316'],
    [1.5, '#f05252'],
    [Infinity, '#c084fc'],
  ];
  const i = zones.findIndex(([max]) => r < max);
  return { n: i + 1, color: zones[i]![1] };
}

/** Valeur, unité et couleur éventuelle d'un champ du compteur. */
export function field(id: FieldId, m: Metrics): { v: string; u: string; color?: string } {
  switch (id) {
    case 'power3s': {
      const z = zoneOf(m.watts3s, m.ftp);
      return { v: nf(m.watts3s), u: `W · Z${z.n}`, color: z.color };
    }
    case 'power':
      return { v: nf(m.watts), u: 'W', color: zoneOf(m.watts, m.ftp).color };
    case 'avgPower':
      return { v: nf(m.avgWatts), u: 'W' };
    case 'np':
      return { v: nf(m.np), u: 'W' };
    case 'wkg':
      return { v: nf(m.wkg, 1), u: 'W/kg' };
    case 'ftpPct':
      return { v: nf((m.watts3s / Math.max(m.ftp, 1)) * 100), u: '%', color: zoneOf(m.watts3s, m.ftp).color };
    case 'zone': {
      const z = zoneOf(m.watts3s, m.ftp);
      return { v: `Z${z.n}`, u: '', color: z.color };
    }
    case 'speed':
      return { v: nf(m.speedKmh, 1), u: 'km/h' };
    case 'cadence':
      return { v: nf(m.cadence), u: lang === 'fr' ? 'tr/min' : 'rpm' };
    case 'hr':
      return { v: m.hr !== undefined ? nf(m.hr) : '–', u: 'bpm' };
    case 'distance':
      return { v: nf(m.distM / 1000, m.distM < 99_950 ? 1 : 0), u: 'km' };
    case 'time':
      return { v: fmtTime(m.elapsedS), u: '' };
    case 'grade':
      return { v: nf(m.gradePercent, 1), u: '%', ...(m.gradePercent > 8 ? { color: '#f05252' } : m.gradePercent > 4 ? { color: '#f97316' } : {}) };
    case 'elevGain':
      return { v: nf(m.elevationGainM), u: 'm' };
    case 'altitude':
      return { v: nf(m.altitudeM), u: 'm' };
    case 'lap':
      return { v: String(m.lap), u: '' };
    case 'gear':
      // Rapport : seulement avec des manettes de vitesses appairées.
      if (!S.st?.shifter) return { v: '–', u: '' };
      return { v: m.gearLabel || String(m.gearIndex + 1), u: `${m.gearIndex + 1}/${m.gearCount}` };
    case 'draft':
      return { v: nf(m.draftPct), u: '%' };
    case 'kcal':
      return { v: nf(m.kcal), u: 'kcal' };
    case 'balance':
      return { v: m.balanceLeft !== undefined ? `${nf(m.balanceLeft)}/${nf(100 - m.balanceLeft)}` : '–', u: '%' };
  }
}
