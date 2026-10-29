/**
 * Trophées : gagnés une seule fois, ils rapportent de l'XP en plus de celle de la sortie
 * (idée NCT Ride). Stockés localement (`ar.trophies`), avec les cumuls de distance.
 */
export interface Trophy {
  id: string;
  name: { fr: string; en: string };
  description: { fr: string; en: string };
  xp: number;
}

/** Ce qu'une sortie terminée permet de vérifier. */
export interface TrophyContext {
  distanceM: number;
  elevationGainM: number;
  komsDone: number;
  recordsBeaten: number;
  rainSeen: boolean;
  nightSeen: boolean;
  openWorld: boolean;
  draftS: number;
  pulls: number;
  workoutFinished: boolean;
  guest: boolean;
}

export const TROPHIES: Trophy[] = [
  { id: 'first-ride', name: { fr: 'Premier coup de pédale', en: 'First pedal stroke' }, description: { fr: 'Terminer une première sortie', en: 'Finish a first ride' }, xp: 100 },
  { id: 'ten-km', name: { fr: 'Dix bornes', en: 'Ten clicks' }, description: { fr: '10 km d’un coup', en: '10 km in one ride' }, xp: 100 },
  { id: 'fifty-km', name: { fr: 'Demi-centaine', en: 'Half century' }, description: { fr: '50 km d’un coup', en: '50 km in one ride' }, xp: 300 },
  { id: 'hundred-km', name: { fr: 'Centaine', en: 'Century' }, description: { fr: '100 km d’un coup', en: '100 km in one ride' }, xp: 600 },
  { id: 'climber-500', name: { fr: 'Grimpeur', en: 'Climber' }, description: { fr: '500 m de dénivelé en une sortie', en: '500 m of climbing in one ride' }, xp: 300 },
  { id: 'first-kom', name: { fr: 'Roi de la côte', en: 'King of the hill' }, description: { fr: 'Boucler une montée chronométrée', en: 'Complete a timed climb' }, xp: 150 },
  { id: 'record', name: { fr: 'Plus fort qu’avant', en: 'Stronger than before' }, description: { fr: 'Battre un de ses records de puissance', en: 'Beat one of your power records' }, xp: 150 },
  { id: 'rain', name: { fr: 'Même pas mouillé', en: 'Not even wet' }, description: { fr: 'Rouler sous la pluie', en: 'Ride in the rain' }, xp: 100 },
  { id: 'night', name: { fr: 'Oiseau de nuit', en: 'Night owl' }, description: { fr: 'Rouler de nuit', en: 'Ride at night' }, xp: 100 },
  { id: 'explorer', name: { fr: 'Explorateur', en: 'Explorer' }, description: { fr: '20 km en monde ouvert', en: '20 km in the open world' }, xp: 200 },
  { id: 'wheel-sucker', name: { fr: 'Bien abrité', en: 'Well sheltered' }, description: { fr: '10 min dans les roues', en: '10 min on a wheel' }, xp: 100 },
  { id: 'team-player', name: { fr: 'Équipier modèle', en: 'Team player' }, description: { fr: '5 relais en une sortie', en: '5 pulls in one ride' }, xp: 150 },
  { id: 'workout', name: { fr: 'Studieux', en: 'Diligent' }, description: { fr: 'Terminer une séance structurée', en: 'Finish a structured workout' }, xp: 150 },
  { id: 'total-500', name: { fr: 'Gros rouleur', en: 'Big miler' }, description: { fr: '500 km au total', en: '500 km in total' }, xp: 500 },
];

const KEY = 'ar.trophies';

interface TrophyStore {
  earned: string[];
  /** Kilomètres cumulés par sortie terminée (identifiée par son départ). */
  rides: Record<string, number>;
}

function load(): TrophyStore {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { earned: [], rides: {}, ...(JSON.parse(raw) as Partial<TrophyStore>) };
  } catch {
    // Stockage illisible : on repart de zéro.
  }
  return { earned: [], rides: {} };
}

/** Trophées déjà gagnés. */
export function earnedTrophies(): string[] {
  return load().earned;
}

/** Kilomètres cumulés des sorties terminées (trophée « Gros rouleur »). */
export function trophyTotalKm(): number {
  return Object.values(load().rides).reduce((a, b) => a + b, 0);
}

/**
 * Trophées gagnés par cette sortie (jamais deux fois). `rideKey` identifie la sortie pour le
 * cumul de distance (une sortie reprise puis terminée à nouveau n'est comptée qu'une fois).
 */
export function awardTrophies(ctx: TrophyContext, rideKey: string): Trophy[] {
  if (ctx.guest) return [];
  const st = load();
  st.rides[rideKey] = ctx.distanceM / 1000;
  const totalKm = Object.values(st.rides).reduce((a, b) => a + b, 0);
  const ok: Record<string, boolean> = {
    'first-ride': ctx.distanceM > 500,
    'ten-km': ctx.distanceM >= 10000,
    'fifty-km': ctx.distanceM >= 50000,
    'hundred-km': ctx.distanceM >= 100000,
    'climber-500': ctx.elevationGainM >= 500,
    'first-kom': ctx.komsDone > 0,
    record: ctx.recordsBeaten > 0,
    rain: ctx.rainSeen && ctx.distanceM > 1000,
    night: ctx.nightSeen && ctx.distanceM > 1000,
    explorer: ctx.openWorld && ctx.distanceM >= 20000,
    'wheel-sucker': ctx.draftS >= 600,
    'team-player': ctx.pulls >= 5,
    workout: ctx.workoutFinished,
    'total-500': totalKm >= 500,
  };
  const won = TROPHIES.filter((t) => ok[t.id] && !st.earned.includes(t.id));
  st.earned.push(...won.map((t) => t.id));
  try {
    localStorage.setItem(KEY, JSON.stringify(st));
  } catch {
    // Stockage indisponible : trophées non mémorisés.
  }
  return won;
}
