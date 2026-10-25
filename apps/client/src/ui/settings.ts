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
  /** Parcours roulé dans l'autre sens (classements et records à part). */
  reverse: boolean;
  mode: RideMode;
  volume: number;
  /** Rapport réel monté sur le trainer : Zwift Cog (14 dents) ou cassette réelle. */
  drivetrain: 'cog' | 'cassette';
  /** Nombre de pignons de la cassette réelle (affichage du rapport en jeu). */
  cassetteSpeeds: number;
  /** Modèle de commandes Di2 (tutoriel) : « dura-ace », « ultegra », « 105 », « grx », « other » ; vide : aucun. */
  di2Model: string;
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
  /**
   * Inertie du vélo virtuel (0,6–1) : 1 = masse et roues réelles ; plus bas, la vitesse suit plus
   * vite les relances, comme le volant d'un home trainer.
   */
  inertia: number;
  /** Monde choisi (dossier public/worlds/<id>) ; `?world=` dans l'adresse a priorité. */
  world: string;
  /** Séance intégrée choisie (mode entraînement), si aucun fichier n'est importé. */
  workoutPreset: string;
  /** Mode défi : montée choisie (identifiant de segment KOM de l'itinéraire). */
  challengeSeg: string;
  /** Météo qui évolue pendant la sortie (en groupe : choix de l'hôte, partagé). */
  weatherEvolves: boolean;
  /** Course sur une boucle : nombre de tours. */
  raceLaps: number;
  /** Sortie créée : même vélo pour tous (absent : oui en course, non en groupe). */
  equalEquipment?: boolean;
  /** Blocs du HUD masqués en sortie (identifiants de HUD_BLOCKS) : selon le matériel du coureur. */
  hudHidden: string[];
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
  reverse: false,
  mode: 'free',
  volume: 0.7,
  drivetrain: 'cog',
  cassetteSpeeds: 12,
  di2Model: '',
  skipStrava: true,
  aiRiders: 4,
  aiLevel: 1,
  powerSource: 'pedals',
  smoothing3s: false,
  guest: false,
  inertia: 1,
  world: 'chevreuse',
  workoutPreset: 'sweet-spot-3x12',
  challengeSeg: '',
  weatherEvolves: false,
  raceLaps: 1,
  hudHidden: [],
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
