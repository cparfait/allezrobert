import type { RouteHairpin } from '@allezrobert/shared';

/*
 * Montées : textes des plaques de lacets, annonce du passage de chaque virage et bilan au sommet
 * des itinéraires aller simple (sans dépendance au rendu, testé dans test/climb.test.ts).
 */

/** Nom du virage sans « Virage de la / du / des » (« Virage de la Savoyâte » → « La Savoyâte »). */
export function hairpinShortName(h: RouteHairpin): string {
  const m = /^virage\s+(?:(de\s+la|du|des|de\s+l['’]|de)\s+)?(.*)$/i.exec((h.name ?? '').trim());
  if (!m) return (h.name ?? '').trim();
  const art = (m[1] ?? '').toLowerCase().replace(/\s+/g, ' ');
  const prefix = art === 'de la' ? 'La ' : art === 'du' ? 'Le ' : art === 'des' ? 'Les ' : art.startsWith('de l') ? 'L’' : '';
  return `${prefix}${m[2] as string}`.trim();
}

/** Vainqueurs inscrits sur la plaque (« 1952 Fausto Coppi (Italie) - 2001 … » → une ligne chacun). */
export function plaqueLines(inscription: string | undefined): string[] {
  if (!inscription) return [];
  return inscription
    .split(/\s+-\s+(?=\d{4})/)
    .map((l) => l.replace(/^(\d{4})\s*-\s*/, '$1 ').trim())
    .filter(Boolean);
}

/** Altitude affichée d'un virage (panneau OSM, sinon altitude de la route), arrondie au mètre. */
export function hairpinAltitude(h: RouteHairpin): number {
  return Math.round(h.signAltitudeM ?? h.altitudeM);
}

/** Entier avec séparateur de milliers (espace fine insécable en français : « 1 155 » ; « 1,155 » en anglais). */
export function thousands(v: number, fr: boolean): string {
  return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, fr ? ' ' : ',');
}

/** Annonce du HUD au passage d'un lacet numéroté : « Virage 7 · 1 390 m ». */
export function hairpinToast(h: RouteHairpin, fr: boolean): string {
  return `${fr ? 'Virage' : 'Hairpin'} ${h.number ?? ''} · ${thousands(hairpinAltitude(h), fr)} m`;
}

/**
 * Passage des lacets numérotés : renvoie le virage dont le sommet vient d'être franchi en montant
 * (de `prevD` exclu à `d` inclus), un seul par appel, jamais deux fois le même.
 */
export class HairpinWatcher {
  private readonly hairpins: RouteHairpin[];
  private readonly seen = new Set<number>();

  constructor(hairpins: RouteHairpin[] | undefined) {
    this.hairpins = (hairpins ?? []).filter((h) => h.number !== undefined).sort((a, b) => a.d - b.d);
  }

  update(prevD: number, d: number): RouteHairpin | null {
    if (d <= prevD) return null;
    for (const h of this.hairpins) {
      if (h.d > d) break;
      if (h.d > prevD && !this.seen.has(h.d)) {
        this.seen.add(h.d);
        return h;
      }
    }
    return null;
  }
}

export interface SummitInput {
  /** Temps de la sortie (s), distance parcourue (m), dénivelé positif cumulé (m). */
  elapsedS: number;
  distanceM: number;
  elevationGainM: number;
  avgWatts: number;
  massKg: number;
  /** Montée chronométrée (KOM) bouclée pendant la sortie : temps, puissance, dénivelé du pied au sommet. */
  kom?: { name: string; timeS: number; avgWatts: number; climbM: number; recordS: number | null };
}

export interface SummitStats {
  timeS: number;
  distanceM: number;
  elevationGainM: number;
  avgWatts: number;
  wkg: number;
  /** Vitesse ascensionnelle moyenne (m/h). */
  vam: number;
  kom?: { name: string; timeS: number; avgWatts: number; wkg: number; vam: number; recordS: number | null };
}

/** VAM (m/h) : dénivelé gagné rapporté au temps. */
export function vam(climbM: number, timeS: number): number {
  return timeS > 0 ? (Math.max(0, climbM) * 3600) / timeS : 0;
}

/** Bilan de l'arrivée au sommet d'un itinéraire aller simple. */
export function summitStats(i: SummitInput): SummitStats {
  const mass = Math.max(i.massKg, 1);
  return {
    timeS: i.elapsedS,
    distanceM: i.distanceM,
    elevationGainM: i.elevationGainM,
    avgWatts: i.avgWatts,
    wkg: i.avgWatts / mass,
    vam: vam(i.elevationGainM, i.elapsedS),
    ...(i.kom ? { kom: { name: i.kom.name, timeS: i.kom.timeS, avgWatts: i.kom.avgWatts, wkg: i.kom.avgWatts / mass, vam: vam(i.kom.climbM, i.kom.timeS), recordS: i.kom.recordS } } : {}),
  };
}

/** Arrivée d'un itinéraire aller simple : le coureur, dans le sens de marche, atteint le bout. */
export function reachedFinish(loop: boolean, dir: number, distM: number, lengthM: number): boolean {
  return !loop && dir > 0 && distM >= lengthM - 0.5;
}
