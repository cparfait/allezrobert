import { LOW_POLY } from '../engine/style.ts';
import type { PlayerCity } from './communes.ts';

/**
 * L'île de Robert et le Pays de Robert n'existent pas : repères Lambert-93 fictifs, au large du Finistère
 * (tools/island/src/build.ts) et en Méditerranée à l'est de la Corse (tools/massif/src/build.ts). Leurs sorties sont
 * annoncées comme virtuelles à l'export, et leur météo « du jour » est celle de la ville du joueur (Paris sinon).
 */
const FICTIONAL_ORIGINS = [
  { x: 95000, y: 6815000 },
  { x: 1330000, y: 6000000 },
];
const PARIS = { lat: 48.8566, lon: 2.3522 };

interface Origin {
  x: number;
  y: number;
}

export function isFictionalOrigin(origin: Origin | undefined): boolean {
  return !!origin && FICTIONAL_ORIGINS.some((o) => o.x === origin.x && o.y === origin.y);
}

/** Titre d'une activité exportée ou envoyée. Sans repère connu : le mode Poly ne propose que des mondes fictifs. */
export function activityTitle(name: string, origin?: Origin, island = origin ? isFictionalOrigin(origin) : LOW_POLY): string {
  return `${name.startsWith('Allez Robert') ? name : `Allez Robert ! — ${name}`}${island && !name.includes('sortie virtuelle') ? ' (sortie virtuelle)' : ''}`;
}

/** Point dont on demande la météo : le départ ou, pour un monde fictif, la ville du joueur (Paris sans ville). */
export function weatherPoint(origin: Origin, start: () => { lat: number; lon: number }, home?: PlayerCity): { lat: number; lon: number; city?: string } {
  if (!isFictionalOrigin(origin)) return start();
  return home && Number.isFinite(home.lat) && Number.isFinite(home.lon) ? { lat: home.lat, lon: home.lon, city: home.name } : { ...PARIS, city: 'Paris' };
}
