/** Profil physique et matériel d'un coureur, utilisé par la physique et le FIT. */
export interface RiderProfile {
  id: string;
  displayName: string;
  /** Masse du coureur en kg. */
  massKg: number;
  heightCm: number;
  ftpWatts: number;
  maxHr?: number;
  restHr?: number;
  sex?: 'female' | 'male' | 'other';
  birthYear?: number;
  bike: BikeSetup;
  /** Invité sans matériel : hors classements, segments et export FIT. */
  guest?: boolean;
}

export interface BikeSetup {
  name: string;
  massKg: number;
  /** Coefficient de résistance au roulement. */
  crr: number;
  /** Surface frontale × coefficient de traînée, en m². */
  cda: number;
  /** Rendement de transmission (0–1). */
  drivetrainEfficiency: number;
  /** Moment d'inertie des deux roues, kg·m². */
  wheelInertia: number;
  wheelRadiusM: number;
  /** Pneus : route (défaut), gravel (crantés légers, meilleurs hors enrobé). */
  tyre?: 'road' | 'gravel';
}

export const DEFAULT_BIKE: BikeSetup = {
  name: 'Route aluminium',
  massKg: 8.5,
  crr: 0.0045,
  cda: 0.32,
  drivetrainEfficiency: 0.976,
  wheelInertia: 0.14,
  wheelRadiusM: 0.335,
};

/** Configuration des vitesses virtuelles (plateaux et cassette virtuels). */
export interface VirtualGearing {
  chainrings: number[]; // nombre de dents, du petit au grand
  cassette: number[]; // nombre de dents, du plus grand au plus petit pignon
  /** Pignon réel monté sur le trainer (ex. Zwift Cog = 14) ; sert de référence neutre. */
  referenceRatio: number;
}

/** 2 plateaux × 12 pignons = 24 rapports, référence ≈ 34×14 du Cog (rapport 2,43). */
export const DEFAULT_GEARING: VirtualGearing = {
  chainrings: [34, 50],
  cassette: [34, 30, 27, 24, 21, 19, 17, 15, 14, 13, 12, 11],
  referenceRatio: 34 / 14,
};
