/** Enregistrement d'une sortie, source de l'export FIT, Strava et intervals.icu. */
export interface ActivityRecord {
  /** Epoch ms. */
  t: number;
  /** Distance depuis le départ de la sortie (m). */
  distanceM: number;
  speedMs: number;
  altitudeM: number;
  /** Position géographique (WGS84), reconstruite depuis le repère monde. */
  lat?: number;
  lon?: number;
  watts?: number;
  cadence?: number;
  hr?: number;
  /** Part de la jambe gauche en %. */
  balanceLeft?: number;
  teLeft?: number;
  teRight?: number;
  psLeft?: number;
  psRight?: number;
  gradePercent?: number;
  temperatureC?: number;
}

export interface ActivityLap {
  startT: number;
  endT: number;
  /** Indices dans `records`, bornes incluses. */
  startIndex: number;
  endIndex: number;
  trigger: 'manual' | 'distance' | 'segment' | 'workoutStep' | 'sessionEnd';
}

export interface Activity {
  id: string;
  name: string;
  sport: 'cycling';
  subSport: 'virtualActivity' | 'indoorCycling';
  startT: number;
  records: ActivityRecord[];
  laps: ActivityLap[];
  riderMassKg: number;
  ftpWatts?: number;
  /** Ne pas envoyer à Strava (le compteur Garmin enregistre déjà la sortie). */
  skipStrava?: boolean;
  deviceName: string;
}
