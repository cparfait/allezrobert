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

/** Geste d'un coureur pendant [a, b] (s, dans la boucle), avec des transitions de `ramp` s. */
export interface Act {
  a: number;
  b: number;
  /** Mains en bas du cintre ou en haut (buste relevé) ; danseuse ; roue libre ; regard. */
  kind: 'drops' | 'tops' | 'stand' | 'coast' | 'look';
  /** Regard (rad) : lacet > 0 vers la gauche du coureur, tangage > 0 tête baissée. */
  yaw?: number;
  pitch?: number;
}

export interface Slot {
  /** Recul par rapport à la tête (m). */
  back: number;
  /** Décalage latéral (m, positif à droite). */
  lat: number;
  /** Cadence (tr/min, entière : le pédalier revient à la même position après LOOP_S). */
  cadence: number;
  /** Effort de base (fraction de la FTP : expressions du visage). */
  effort: number;
  acts: readonly Act[];
}

/**
 * Groupe de 10 en sortie du dimanche : deux par deux mais sans alignement au cordeau (Robert en
 * tête côté accotement, son voisin un demi-vélo derrière, rangs en quinconce), et chacun vit sa
 * sortie. Les gestes sont calés sur les plans (front 0-10, côté 10-20,5, grue 20,5-30,5, passage
 * 30,5-40, gros plan 40-50, retour 50-61,5) et aucun ne touche le raccord (avant 2 s, après 54 s) :
 *  - Robert et son voisin discutent (front, retour), Robert lâche les cocottes pour le haut du
 *    cintre (côté) ;
 *  - le 9 remonte par la gauche en danseuse, discute avec le 5 puis se laisse glisser ;
 *  - le 5 se fait décrocher d'un mètre et revient en danseuse ; le 6 se dégourdit les jambes ;
 *  - roues libres, mains en bas ou en haut du cintre, coups d'œil derrière, au compteur.
 */
export const SLOTS: readonly Slot[] = [
  {
    back: 0, lat: 1.78, cadence: 90, effort: 0.6,
    acts: [
      { a: 3, b: 6.8, kind: 'look', yaw: 0.72, pitch: 0.04 },
      { a: 12.5, b: 17.5, kind: 'tops' },
      { a: 51.6, b: 53.8, kind: 'look', yaw: 0.55 },
    ],
  },
  {
    back: 0.55, lat: 0.8, cadence: 88, effort: 0.62,
    acts: [
      { a: 3.6, b: 7.2, kind: 'look', yaw: -0.65 },
      { a: 21.5, b: 30, kind: 'drops' },
      { a: 43, b: 44.4, kind: 'coast' },
      { a: 52.2, b: 54, kind: 'look', yaw: -0.5 },
    ],
  },
  {
    back: 2.45, lat: 1.7, cadence: 86, effort: 0.55,
    acts: [
      { a: 2.5, b: 8.8, kind: 'tops' },
      { a: 25.2, b: 26.8, kind: 'coast' },
      { a: 44, b: 45.2, kind: 'look', yaw: 0.1, pitch: 0.38 },
    ],
  },
  {
    back: 2.85, lat: 0.6, cadence: 92, effort: 0.68,
    acts: [
      { a: 6, b: 19, kind: 'drops' },
      { a: 33.2, b: 34.6, kind: 'look', yaw: -0.95, pitch: -0.05 },
      { a: 47, b: 48.8, kind: 'stand' },
    ],
  },
  {
    back: 4.85, lat: 1.96, cadence: 87, effort: 0.6,
    acts: [
      { a: 5.2, b: 6.6, kind: 'look', yaw: -0.08, pitch: 0.35 },
      { a: 31, b: 39, kind: 'tops' },
      { a: 45, b: 46.4, kind: 'coast' },
    ],
  },
  {
    back: 5.2, lat: 0.95, cadence: 89, effort: 0.64,
    acts: [
      { a: 15, b: 17.4, kind: 'stand' },
      { a: 27.4, b: 33.4, kind: 'look', yaw: 0.6 },
      { a: 44, b: 50, kind: 'tops' },
    ],
  },
  {
    back: 7.45, lat: 1.52, cadence: 91, effort: 0.58,
    acts: [
      { a: 22.5, b: 27.5, kind: 'look', yaw: 0.65 },
      { a: 35, b: 37.6, kind: 'stand' },
    ],
  },
  {
    back: 7.95, lat: 0.48, cadence: 85, effort: 0.6,
    acts: [
      { a: 11.6, b: 13.2, kind: 'coast' },
      { a: 23, b: 27.8, kind: 'look', yaw: -0.6 },
      { a: 41, b: 48, kind: 'tops' },
    ],
  },
  {
    back: 10, lat: 1.42, cadence: 90, effort: 0.62,
    acts: [
      { a: 15.2, b: 16.6, kind: 'look', yaw: 1.0, pitch: -0.08 },
      { a: 29.5, b: 40, kind: 'drops' },
    ],
  },
  {
    back: 12.25, lat: 0.7, cadence: 84, effort: 0.6,
    acts: [
      { a: 12.8, b: 15.2, kind: 'stand' },
      { a: 27, b: 33.5, kind: 'look', yaw: -0.7 },
    ],
  },
];

const TAU = Math.PI * 2;
/** Transitions des gestes (s) : regard et danseuse, roue libre (on cesse de pédaler d'un coup). */
const RAMP = 0.6;
const COAST_RAMP = 0.35;
/** Cadence perdue en danseuse (tr/min). */
const STAND_CADENCE = -14;

/** Temps ramené dans la boucle [0, LOOP_S) (préroulage négatif et fondu de raccord compris). */
function wrap(t: number): number {
  return ((t % LOOP_S) + LOOP_S) % LOOP_S;
}

/** Créneau [a, b] à bords adoucis sur `r` s (b − a ≥ 2r). */
function win(t: number, a: number, b: number, r: number): number {
  return smooth((t - a) / r) * smooth((b - t) / r);
}

/** Intégrale de win de 0 à t (t ≥ 0 ; primitive de smooth : x³ − x⁴/2). */
function winInt(t: number, a: number, b: number, r: number): number {
  const U = (x: number) => x * x * x - (x * x * x * x) / 2;
  if (t <= a) return 0;
  if (t < a + r) return r * U((t - a) / r);
  if (t <= b - r) return r / 2 + (t - a - r);
  if (t < b) return b - a - r - r * U((b - t) / r);
  return b - a - r;
}

/** Montée douce de 0 à 1 sur [a, p], descente sur [p, b]. */
function pulse(t: number, a: number, p: number, b: number): number {
  return t < p ? smooth((t - a) / (p - a)) : 1 - smooth((t - p) / (b - p));
}

/**
 * Position du coureur i à l'instant t : effet d'accordéon du groupe (la vague de vitesse descend
 * les rangs avec un léger retard, ±0,4 m en queue), petites dérives de chacun (±0,12 m d'avant en
 * arrière, ±0,1 m de côté), et les mouvements des gestes : le 9 remonte par la gauche jusqu'au 5
 * puis se laisse glisser, le 5 décroche d'un mètre et revient, les roues libres font perdre un peu
 * de terrain. Robert ne bouge pas (gros plan sur ses jambes). Toutes les variations sont
 * périodiques de période LOOP_S.
 */
export function formation(i: number, t: number): { back: number; lat: number } {
  const s = SLOTS[i] as Slot;
  const tl = wrap(t);
  if (i === 0) return { back: 0, lat: s.lat + 0.04 * Math.sin((TAU * 2 * tl) / LOOP_S) };
  const w = (TAU * 3) / LOOP_S;
  const delay = (s.back / 2.3) * 0.35;
  let back = s.back + 0.45 * (Math.sin(w * (tl - delay)) - Math.sin(w * tl));
  back += 0.12 * Math.sin((TAU * (2 + (i % 3)) * tl) / LOOP_S + i * 1.7);
  let lat = s.lat + 0.07 * Math.sin((TAU * (3 + ((i * 3) % 5)) * tl) / LOOP_S + i * 2.3) + 0.04 * Math.sin((TAU * (7 + (i % 4)) * tl) / LOOP_S + i);
  // Roue libre : on perd 30 à 40 cm, repris dans la foulée.
  for (const c of s.acts) if (c.kind === 'coast') back += 0.35 * pulse(tl, c.a, c.b + 0.4, c.b + 3);
  // Le 5 laisse filer un mètre (ceux qui sont dans sa roue avec lui) puis revient en danseuse.
  if (i >= 5 && i <= 8) back += 0.9 * pulse(tl, 10, 14.8, 17.6);
  if (i === 9) {
    // Déboîte à gauche (au-delà de l'axe), gagne 6 m jusqu'à la hauteur du 5, puis redescend.
    back -= 6 * pulse(tl, 12.5, 24, 46);
    lat -= 1.2 * win(tl, 10.5, 49.5, 2.5);
  }
  return { back, lat };
}

export interface Gesture {
  pose: 'seated' | 'standing' | 'coasting';
  hands: 'hoods' | 'drops' | 'tops';
  yaw: number;
  pitch: number;
  /** Cadence (tr/min) et angle du pédalier (rad), fonctions du temps. */
  cadence: number;
  crank: number;
  effort: number;
}

/**
 * Cadence du coureur : de base, moins vite en danseuse, nulle en roue libre ; la moyenne sur la
 * boucle reste la cadence de base (entière) pour que le pédalier se retrouve au raccord.
 */
function pedalling(s: Slot): { c0: number; revs: (t: number) => number; cadence: (t: number) => number } {
  const coast = s.acts.filter((c) => c.kind === 'coast');
  const stand = s.acts.filter((c) => c.kind === 'stand');
  const coastIn = coast.reduce((n, c) => n + c.b - c.a - COAST_RAMP, 0);
  const standIn = stand.reduce((n, c) => n + c.b - c.a - RAMP, 0);
  // Cadence hors roue libre : compense le temps passé en roue libre et en danseuse.
  const c0 = (s.cadence * LOOP_S - STAND_CADENCE * standIn) / (LOOP_S - coastIn);
  const coastW = (t: number) => coast.reduce((n, c) => n + win(t, c.a, c.b, COAST_RAMP), 0);
  const standW = (t: number) => stand.reduce((n, c) => n + win(t, c.a, c.b, RAMP), 0);
  return {
    c0,
    cadence: (t) => c0 * (1 - coastW(t)) + STAND_CADENCE * standW(t),
    /** Tours de pédalier de 0 à t. */
    revs: (t) => (c0 * (t - coast.reduce((n, c) => n + winInt(t, c.a, c.b, COAST_RAMP), 0)) + STAND_CADENCE * stand.reduce((n, c) => n + winInt(t, c.a, c.b, RAMP), 0)) / 60,
  };
}

/** Phase du pédalier : en roue libre, les manivelles s'arrêtent à l'horizontale. */
const PEDALLING = SLOTS.map((s, i) => {
  const p = pedalling(s);
  const coast = s.acts.find((c) => c.kind === 'coast');
  const phase = coast ? Math.PI / 2 - TAU * p.revs(coast.a + COAST_RAMP) : i * 2.1;
  return { ...p, phase };
});

/** Geste du coureur i à l'instant t (fonction pure, périodique de période LOOP_S). */
export function gesture(i: number, t: number): Gesture {
  const s = SLOTS[i] as Slot;
  const p = PEDALLING[i] as (typeof PEDALLING)[number];
  const tl = wrap(t);
  let yaw = 0;
  let pitch = 0;
  let hands: Gesture['hands'] = 'hoods';
  let pose: Gesture['pose'] = 'seated';
  let effort = s.effort;
  for (const c of s.acts) {
    const inside = tl >= c.a && tl <= c.b;
    if (c.kind === 'look') {
      const k = win(tl, c.a, c.b, RAMP);
      yaw += (c.yaw ?? 0) * k;
      pitch += (c.pitch ?? 0) * k;
    } else if (c.kind === 'drops' || c.kind === 'tops') {
      if (inside) hands = c.kind;
    } else if (c.kind === 'stand') {
      if (inside) pose = 'standing';
      effort += 0.35 * win(tl, c.a, c.b, RAMP);
    } else if (win(tl, c.a, c.b, COAST_RAMP) > 0.5) {
      pose = 'coasting';
      effort -= 0.2;
    }
  }
  // Le 9 force pendant sa remontée.
  if (i === 9) effort += 0.2 * win(tl, 12, 24, 2);
  return { pose, hands, yaw, pitch, cadence: p.cadence(tl), crank: p.phase + TAU * p.revs(tl), effort };
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
