import { DEFAULT_BIKE, type BikeSetup } from '@allezrobert/shared';
import { REFERENCE_CLIMB, REFERENCE_HEADWIND_KMH, bikeStats, surfaceCrr, type BikeStats } from '@allezrobert/physics';
import { getLang } from '../i18n/index.ts';

/**
 * Panneau « Effet sur la route » du garage : profil du vélo roulé (vélo équipé et pièces de l'atelier)
 * en trois barres, puis ce qu'il change à mêmes watts par rapport au vélo de départ (route aluminium,
 * sans pièce), avec les chiffres de l'atelier (bikeStats, vraie physique).
 */

/** Bornes des barres (0 → 1) ; le trait marque le vélo de départ. */
const AERO_CDA: [number, number] = [0.37, 0.28];
const LIGHT_KG: [number, number] = [12.5, 6];
const DIRT_CRR: [number, number] = [0.0135, 0.0075];

const unit = (v: number, [lo, hi]: [number, number]) => Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
const dirtCrr = (b: BikeSetup) => surfaceCrr('dirt', b.crr, b.tyre);

export function roadEffectHtml(bike: BikeSetup, riderKg: number, ftpWatts: number): string {
  const L = getLang() === 'fr';
  const base = bikeStats(DEFAULT_BIKE, riderKg, ftpWatts);
  const cur = bikeStats(bike, riderKg, ftpWatts);
  const num = (v: number, d: number) => {
    const s = Math.abs(v).toFixed(d);
    return L ? s.replace('.', ',') : s;
  };
  /** Écart signé ; `better` : sens favorable (+1 plus grand vaut mieux, −1 plus petit). */
  const delta = (d: number, digits: number, u: string, better: 1 | -1) => {
    const shown = Number(d.toFixed(digits));
    const cls = shown === 0 ? 'eq' : shown * better > 0 ? 'up' : 'down';
    return `<td class="${cls}">${shown === 0 ? '=' : `${shown > 0 ? '+' : '−'}${num(shown, digits)} ${u}`}</td>`;
  };
  const kmh = (f: (s: BikeStats) => number) => delta(f(cur) - f(base), 2, 'km/h', 1);
  const perKm = REFERENCE_CLIMB.lengthM / 1000;
  const bars: Array<[string, number, number]> = [
    [L ? 'Aéro' : 'Aero', unit(bike.cda, AERO_CDA), unit(DEFAULT_BIKE.cda, AERO_CDA)],
    [L ? 'Légèreté' : 'Lightness', unit(bike.massKg, LIGHT_KG), unit(DEFAULT_BIKE.massKg, LIGHT_KG)],
    [L ? 'Chemins' : 'Dirt roads', unit(dirtCrr(bike), DIRT_CRR), unit(dirtCrr(DEFAULT_BIKE), DIRT_CRR)],
  ];
  const w75 = Math.round(ftpWatts * 0.75);
  return `<aside class="gr-road" aria-label="${L ? 'Effet sur la route' : 'Effect on the road'}">
      <h3>${L ? 'Effet sur la route' : 'Effect on the road'}</h3>
      <ul class="gr-road-bars">${bars
        .map(([label, v, ref]) => `<li><span>${label}</span><i><b style="width:${(v * 100).toFixed(1)}%"></b><em style="left:${(ref * 100).toFixed(1)}%"></em></i></li>`)
        .join('')}</ul>
      <table>
        <tr><th>${L ? `Plat à ${w75} W` : `Flat at ${w75} W`}</th>${kmh((s) => s.flat75Kmh)}</tr>
        <tr><th>${L ? `Vent de face ${REFERENCE_HEADWIND_KMH} km/h` : `Headwind ${REFERENCE_HEADWIND_KMH} km/h`}</th>${kmh((s) => s.headwind75Kmh)}</tr>
        <tr><th>${L ? `Côte à ${REFERENCE_CLIMB.grade} % (par km)` : `${REFERENCE_CLIMB.grade}% climb (per km)`}</th>${delta((cur.climbS - base.climbS) / perKm, 1, 's', -1)}</tr>
        <tr><th>${L ? 'Chemin de terre' : 'Dirt road'}</th>${kmh((s) => s.dirt75Kmh)}</tr>
      </table>
      <p>${L ? 'Mêmes watts : seule la vitesse change, de très peu.' : 'Same watts: only the speed changes, ever so slightly.'}</p>
      <small>${L ? `Par rapport au vélo de départ · ${Math.round(riderKg)} kg, ${Math.round(ftpWatts)} W FTP` : `Versus the starter bike · ${Math.round(riderKg)} kg, ${Math.round(ftpWatts)} W FTP`}</small>
    </aside>`;
}
