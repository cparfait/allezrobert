import { DEFAULT_LOOK, migrateBikeId, type AvatarLook, type RideMode } from '@allezrobert/shared';
import type { QualityLevel } from '../engine/quality.ts';
import type { Season } from '../world/environment.ts';
import type { Lang } from '../i18n/index.ts';

/** Réglages persistés localement (le profil est aussi synchronisé avec le serveur une fois connecté). */
export interface Settings {
  name: string;
  massKg: number;
  heightCm: number;
  ftpWatts: number;
  look: AvatarLook;
  quality: QualityLevel;
  season: Season;
  hour: number;
  clouds: number;
  rain: number;
  fog: number;
  windMs: number;
  lang: Lang;
  trainerDifficulty: number;
  routeId: string;
  mode: RideMode;
  volume: number;
  /** Rapport réel monté sur le trainer : Zwift Cog (14 dents) ou cassette réelle. */
  drivetrain: 'cog' | 'cassette';
  /** Ne pas envoyer à Strava : le compteur Garmin enregistre déjà la sortie. */
  skipStrava: boolean;
  aiRiders: number;
  /** Niveau des coureurs IA en fraction de la FTP du joueur (0,8 / 1 / 1,15). */
  aiLevel: number;
  /** Source de puissance de référence quand pédales et trainer sont présents. */
  powerSource: 'pedals' | 'trainer';
  smoothing3s: boolean;
  /** Invité sans matériel : puissance virtuelle au clavier / à la manette. */
  guest: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  name: 'Robert',
  massKg: 75,
  heightCm: 178,
  ftpWatts: 250,
  look: DEFAULT_LOOK,
  quality: 'high',
  season: 'autumn',
  hour: 10.5,
  clouds: 0.35,
  rain: 0,
  fog: 0,
  windMs: 3,
  lang: 'fr',
  trainerDifficulty: 0.5,
  routeId: '',
  mode: 'free',
  volume: 0.7,
  drivetrain: 'cog',
  skipStrava: true,
  aiRiders: 4,
  aiLevel: 1,
  powerSource: 'pedals',
  smoothing3s: false,
  guest: false,
};

const KEY = 'ar.settings';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return migrateBike({ ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) });
  } catch {
    // Réglages corrompus : on repart des valeurs par défaut.
  }
  return migrateBike({ ...DEFAULT_SETTINGS });
}

/**
 * Vélo équipé avant le catalogue (bike-alu…, dans la progression) : une seule fois, le modèle
 * correspondant devient celui de la tenue et l'équipement est réécrit avec son nouvel identifiant.
 */
function migrateBike(s: Settings): Settings {
  try {
    const raw = localStorage.getItem('ar.progress');
    const p = raw ? (JSON.parse(raw) as { equipped?: Record<string, string> }) : null;
    const old = p?.equipped?.bike;
    if (!p?.equipped || !old || migrateBikeId(old) === old) return s;
    p.equipped.bike = migrateBikeId(old);
    localStorage.setItem('ar.progress', JSON.stringify(p));
    if (!s.look.bikeModel) s.look = { ...s.look, bikeModel: p.equipped.bike };
    saveSettings(s);
  } catch {
    // Progression illisible : rien à migrer.
  }
  return s;
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}
