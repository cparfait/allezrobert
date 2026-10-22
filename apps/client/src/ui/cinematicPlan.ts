/**
 * Plan du film d'accueil (mode « cinématique », développement) : découpage des plans,
 * formation du groupe et réglages par saison. Fonctions pures du temps t (s), sans Three.js,
 * pour que chaque image soit reproductible et que la boucle se referme exactement.
 *
 * Boucle : on rend LOOP_S + XFADE_S secondes ; l'outil de capture (tools/menu-loop) fond les
 * XFADE_S dernières secondes dans les premières. La formation et le pédalage sont périodiques
 * de période LOOP_S (cadences entières, variations en sinus de période LOOP_S / k), et le
 * dernier plan reprend le cadrage du premier : au raccord, seul le paysage change.
 */

export type CineSeason = 'spring' | 'summer' | 'autumn' | 'winter';

/** Durée de la boucle (s) et du fondu de raccord ajouté à la fin. */
export const LOOP_S = 60;
export const XFADE_S = 1.5;
/** Vitesse du groupe : 34 km/h. */
export const GROUP_SPEED = 34 / 3.6;

export type ShotKind = 'front' | 'side' | 'crane' | 'pass' | 'close' | 'frontEnd';

export interface Shot {
  kind: ShotKind;
  start: number;
  end: number;
}

/** Plans de 9 à 11,5 s : avant bas, travelling latéral au téléobjectif, grue, passage, gros plan, retour avant. */
export const SHOTS: readonly Shot[] = [
  { kind: 'front', start: 0, end: 10 },
  { kind: 'side', start: 10, end: 20.5 },
  { kind: 'crane', start: 20.5, end: 30.5 },
  { kind: 'pass', start: 30.5, end: 40 },
  { kind: 'close', start: 40, end: 50 },
  { kind: 'frontEnd', start: 50, end: LOOP_S + XFADE_S },
];

/** Plan courant, son indice et le temps écoulé dans le plan. */
export function shotAt(t: number): { shot: Shot; index: number; local: number; u: number } {
  let index = SHOTS.findIndex((s) => t < s.end);
  if (index < 0) index = SHOTS.length - 1;
  const shot = SHOTS[index] as Shot;
  const local = t - shot.start;
  return { shot, index, local, u: Math.min(1, Math.max(0, local / (shot.end - shot.start))) };
}

export function smooth(x: number): number {
  const u = Math.min(1, Math.max(0, x));
  return u * u * (3 - 2 * u);
}

/**
 * Cadrage du plan avant (caméra devant le groupe, regard vers l'arrière) : recul et décalage
 * latéral de la caméra. Le plan d'ouverture est fixe pendant XFADE_S puis s'approche ; le
 * dernier plan recule et finit sur ce même cadrage fixe (raccord de boucle).
 */
export function frontFraming(kind: 'front' | 'frontEnd', local: number): { ahead: number; lat: number; height: number } {
  // Caméra à droite du groupe (côté accotement) : vu de face, le groupe se place à droite du
  // cadre, à l'écart du panneau du menu.
  const OPEN = { ahead: 7.5, lat: 2.9, height: 1.0 };
  const CLOSE = { ahead: 5.4, lat: 2.6, height: 0.85 };
  let k: number;
  if (kind === 'front') k = smooth((local - XFADE_S) / (10 - XFADE_S));
  else k = 1 - smooth(local / (LOOP_S - 50));
  return {
    ahead: OPEN.ahead + (CLOSE.ahead - OPEN.ahead) * k,
    lat: OPEN.lat + (CLOSE.lat - OPEN.lat) * k,
    height: OPEN.height + (CLOSE.height - OPEN.height) * k,
  };
}

export interface Slot {
  /** Recul par rapport à la tête (m). */
  back: number;
  /** Décalage latéral (m, positif à droite). */
  lat: number;
  /** Cadence (tr/min, entière : le pédalier revient à la même position après LOOP_S). */
  cadence: number;
}

/** Groupe de 10 : paires de front, la tête à droite (côté accotement), puis deux en file. */
export const SLOTS: readonly Slot[] = [
  { back: 0, lat: 1.85, cadence: 90 },
  { back: 0.35, lat: 0.8, cadence: 88 },
  { back: 2.3, lat: 1.75, cadence: 86 },
  { back: 2.6, lat: 0.72, cadence: 92 },
  { back: 4.6, lat: 1.8, cadence: 87 },
  { back: 4.95, lat: 0.85, cadence: 89 },
  { back: 6.9, lat: 1.7, cadence: 91 },
  { back: 7.25, lat: 0.75, cadence: 85 },
  { back: 9.4, lat: 1.35, cadence: 90 },
  { back: 11.8, lat: 1.15, cadence: 88 },
];

const TAU = Math.PI * 2;

/**
 * Position du coureur i à l'instant t : petites respirations du groupe (écarts de ±0,3 m,
 * louvoiement de ±0,12 m), et le dernier qui remonte par la gauche jusqu'à la 3e paire puis
 * se laisse glisser. Toutes les variations ont une période qui divise LOOP_S.
 */
export function formation(i: number, t: number): { back: number; lat: number } {
  const s = SLOTS[i] as Slot;
  if (i === 0) {
    // La tête bouge à peine (gros plan sur ses jambes).
    return { back: 0, lat: s.lat + 0.05 * Math.sin((TAU * 2 * t) / LOOP_S) };
  }
  const k = 2 + (i % 4);
  const m = 3 + ((i * 3) % 5);
  const phi = i * 1.7;
  const psi = i * 2.3;
  let back = s.back + 0.3 * Math.sin((TAU * k * t) / LOOP_S + phi);
  let lat = s.lat + 0.12 * Math.sin((TAU * m * t) / LOOP_S + psi);
  if (i === SLOTS.length - 1) {
    // Remontée : déboîte à gauche, gagne ~6 m, puis se replace en queue (période LOOP_S).
    const w = (1 - Math.cos((TAU * t) / LOOP_S)) / 2;
    const move = smooth(w * 1.15);
    back -= 6.2 * move;
    lat -= 1.35 * smooth(w * 2.2);
  }
  return { back, lat };
}

/** Lumière du film par saison : soleil bas du matin (≈ 11 à 15° au-dessus de l'horizon). */
export const CINE_ENV: Record<CineSeason, { hour: number; clouds: number; fog: number; windMs: number }> = {
  spring: { hour: 8.5, clouds: 0.2, fog: 0.06, windMs: 2 },
  summer: { hour: 7.6, clouds: 0.12, fog: 0.05, windMs: 1.5 },
  autumn: { hour: 9.2, clouds: 0.25, fog: 0.12, windMs: 2.5 },
  winter: { hour: 10.6, clouds: 0.3, fog: 0.18, windMs: 3 },
};

export function isCineSeason(s: string | null): s is CineSeason {
  return s === 'spring' || s === 'summer' || s === 'autumn' || s === 'winter';
}

/** Nombre d'images capturées (boucle + fondu de raccord). */
export function frameCount(fps: number): number {
  return Math.round((LOOP_S + XFADE_S) * fps);
}
