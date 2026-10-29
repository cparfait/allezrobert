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
  /** Heure de départ = heure actuelle de l'ordinateur (sinon `hour`, réglée à la main). */
  realTime: boolean;
  clouds: number;
  rain: number;
  fog: number;
  windMs: number;
  lang: Lang;
  trainerDifficulty: number;
  routeId: string;
  /** Parcours roulé dans l'autre sens (classements et records à part). */
  reverse: boolean;
  /**
   * Départ choisi sur une boucle : distance (m) du point de départ sur le tracé d'origine, dans le
   * sens choisi ; 0 = départ d'origine.
   */
  startM: number;
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
  /** Sortie de groupe avec IA : vitesse moyenne visée (km/h) ; 0 = libre (allure des coureurs). */
  groupTargetKmh: number;
  /** Source de puissance de référence quand pédales et trainer sont présents. */
  powerSource: 'pedals' | 'trainer';
  smoothing3s: boolean;
  /** Danseuse au-delà de cette puissance (W) ; 0 : automatique (sprint, côte, force). */
  standWatts: number;
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
  /** Météo réelle du jour au départ (Open-Meteo), à l'heure choisie, au lieu du ciel et du vent réglés. */
  realWeather: boolean;
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
  realTime: true,
  clouds: 0.35,
  rain: 0,
  fog: 0,
  windMs: 3,
  lang: 'fr',
  trainerDifficulty: 0.5,
  routeId: '',
  reverse: false,
  startM: 0,
  mode: 'free',
  volume: 0.7,
  drivetrain: 'cog',
  cassetteSpeeds: 12,
  di2Model: '',
  skipStrava: true,
  aiRiders: 4,
  aiLevel: 1,
  groupTargetKmh: 0,
  powerSource: 'pedals',
  smoothing3s: false,
  standWatts: 0,
  guest: false,
  inertia: 1,
  world: 'longchamp',
  workoutPreset: 'sweet-spot-3x12',
  challengeSeg: '',
  weatherEvolves: false,
  realWeather: true,
  raceLaps: 1,
  hudHidden: [],
};

const KEY = 'ar.settings';

/** Heure actuelle de l'ordinateur, en heures décimales (14,5 = 14 h 30). */
export function nowHour(): number {
  const d = new Date();
  return Math.round((d.getHours() + d.getMinutes() / 60) * 4) / 4;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
      // Une seule fois : la météo du jour devient le choix par défaut (le joueur peut revenir aux conditions réglées).
      if (!localStorage.getItem('ar.hourRealDefault')) {
        saved.realTime = true;
        localStorage.setItem('ar.hourRealDefault', '1');
      }
      if (saved.realTime) saved.hour = nowHour();
      if (!localStorage.getItem('ar.wxRealDefault')) {
        saved.realWeather = true;
        localStorage.setItem('ar.wxRealDefault', '1');
      }
      return migrateBike(saved);
    }
  } catch {
    // Réglages corrompus : on repart des valeurs par défaut.
  }
  return migrateBike({ ...DEFAULT_SETTINGS, hour: nowHour() });
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
