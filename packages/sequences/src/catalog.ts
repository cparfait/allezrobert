/**
 * Catalogue des séquences HyperFrames : variables typées, durées, repères et zones utilisées.
 * Module pur (aucune dépendance navigateur ni Vite) : utilisable par le client, le serveur et
 * les scripts Node.
 */
import type { Lang } from './strings.ts';

export type Season = 'printemps' | 'ete' | 'automne' | 'hiver';
export type RideType = 'free' | 'group' | 'race' | 'workout' | 'ftpTest' | 'open';

/** Variables communes : langue et habillages de prévisualisation (désactivés en jeu). */
export interface CommonVariables {
  lang?: Lang;
  /** Faux décor 3D derrière l'overlay (rendus MP4 de contrôle uniquement). */
  preview_backdrop?: boolean;
  /** Contours des zones vitales du HUD (contrôle visuel). */
  show_safe_zones?: boolean;
}

export interface IntroVariables extends CommonVariables {
  route_name: string;
  ride_type?: RideType;
  season?: Season;
  distance_km: number;
  elevation_m: number;
  riders?: number;
  start_label?: string;
  finish_label?: string;
  /** Altitudes (m) régulièrement espacées ; un tableau est sérialisé en JSON automatiquement. */
  profile: number[] | string;
  accent?: string;
}

export interface SegmentVariables extends CommonVariables {
  kind?: 'kom' | 'sprint';
  segment_name: string;
  rider_name?: string;
  time_s: number;
  rank: number;
  rank_total?: number;
  /** Écart au meilleur temps du segment (s), 0 si meilleur temps. */
  gap_s?: number;
  pr?: boolean;
  /** Gain sur l'ancien record personnel (s). */
  pr_delta_s?: number;
}

export interface PodiumEntry {
  name: string;
  time_s: number;
  team?: string;
  team_color?: string;
}

export interface PodiumVariables extends CommonVariables {
  route_name: string;
  /** Du 1er au 3e (1 à 3 entrées). */
  podium: PodiumEntry[] | string;
  /** Graine des confettis (déterministe). */
  seed?: number;
}

export interface TvGroup {
  /** Clé connue (« tv.breakaway », « tv.peloton », « tv.chasers », « tv.gruppetto », « tv.leader ») ou texte libre. */
  label: string;
  riders?: number;
  /** Écart à la tête de course (s). */
  gap_s: number;
  color?: string;
}

export interface TvVariables extends CommonVariables {
  show_banner?: boolean;
  rider_name: string;
  team?: string;
  team_color?: string;
  position?: number;
  wkg?: number;
  watts?: number;
  show_gaps?: boolean;
  groups?: TvGroup[] | string;
  /** Index du groupe du coureur suivi (-1 = aucun). */
  focus_group?: number;
}

/** Données « en direct » de l'habillage TV (SequencePlayer.update), sans rechargement. */
export interface TvLiveData {
  position?: number;
  wkg?: number;
  watts?: number;
  groups?: TvGroup[];
  focus_group?: number;
}

export interface LeaderboardEntry {
  name: string;
  time_s: number;
  team_color?: string;
  me?: boolean;
}

export interface SegmentHighlight {
  kind: 'kom' | 'sprint';
  name: string;
  time_s: number;
  rank: number;
  rank_total?: number;
  pr?: boolean;
  pr_delta_s?: number;
}

export interface SummaryVariables extends Omit<CommonVariables, 'preview_backdrop' | 'show_safe_zones'> {
  ride_title: string;
  date_label?: string;
  route_name: string;
  season?: Season;
  rider_name?: string;
  /** [[lat, lon], …] (projection « latlon ») ou [[x, y], …] (« xy »). */
  trace: [number, number][] | string;
  trace_projection?: 'latlon' | 'xy';
  elevation: number[] | string;
  distance_km: number;
  duration_s: number;
  avg_power_w: number;
  np_w: number;
  elevation_m: number;
  calories_kcal: number;
  leaderboard?: LeaderboardEntry[] | string;
  segments?: SegmentHighlight[] | string;
  accent?: string;
}

export interface SequenceVariablesMap {
  intro: IntroVariables;
  kom: SegmentVariables;
  sprint: SegmentVariables;
  podium: PodiumVariables;
  tv: TvVariables;
  summary: SummaryVariables;
}

export type SequenceName = keyof SequenceVariablesMap;

/** Fichier de composition (dossier compositions/<file>/index.html). */
export type CompositionFile = 'intro' | 'segment' | 'podium' | 'tv' | 'summary';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SequenceMeta {
  /** Dossier de la composition. */
  file: CompositionFile;
  /** data-composition-id (= clé window.__timelines). */
  compositionId: string;
  /** Durée fixe (s), = data-duration de la racine. */
  duration: number;
  /** overlay = fond transparent par-dessus le canvas ; fullscreen = plein cadre opaque. */
  kind: 'overlay' | 'fullscreen';
  /** Variables imposées par le nom (ex. sprint → kind=sprint). */
  preset?: Record<string, unknown>;
  /** Repères temporels (s) émis via onCue (ex. « go » : départ réel de la course). */
  cues?: Record<string, number>;
  /** Boucle de maintien (s) pour play(..., { hold: true }) : [start, end[. */
  hold?: { start: number; end: number };
  /** Rectangles occupés (px composition 1920×1080) — doivent éviter SAFE_ZONES. */
  occupies: Rect[];
}

export const COMPOSITION_SIZE = { width: 1920, height: 1080 } as const;

/**
 * Zones vitales du HUD à ne jamais recouvrir (px composition, HUD à l'échelle 1:1 d'une
 * fenêtre 1080p — géométrie de apps/client/src/hud/hud.css).
 */
export const SAFE_ZONES: Record<string, Rect> = {
  powerTopCenter: { x: 560, y: 0, w: 800, h: 260 },
  infoTopLeft: { x: 0, y: 0, w: 260, h: 160 },
  minimapTopRight: { x: 1660, y: 0, w: 260, h: 255 },
  ridersRight: { x: 1660, y: 255, w: 260, h: 450 },
  gearsBottomLeft: { x: 0, y: 720, w: 400, h: 230 },
  profileBottom: { x: 0, y: 950, w: 1920, h: 130 },
};

export const SEQUENCES: Record<SequenceName, SequenceMeta> = {
  intro: {
    file: 'intro',
    compositionId: 'ar-intro',
    duration: 6,
    kind: 'overlay',
    cues: { countdown: 2.85, go: 5.1 },
    // Carte du parcours, puis compte à rebours dans sa propre bande (sans recouvrement).
    occupies: [
      { x: 440, y: 262, w: 1040, h: 430 },
      { x: 660, y: 712, w: 600, h: 230 },
    ],
  },
  kom: {
    file: 'segment',
    compositionId: 'ar-segment',
    duration: 3.5,
    kind: 'overlay',
    preset: { kind: 'kom' },
    occupies: [{ x: 560, y: 282, w: 800, h: 214 }],
  },
  sprint: {
    file: 'segment',
    compositionId: 'ar-segment',
    duration: 3.5,
    kind: 'overlay',
    preset: { kind: 'sprint' },
    occupies: [{ x: 560, y: 282, w: 800, h: 214 }],
  },
  podium: {
    file: 'podium',
    compositionId: 'ar-podium',
    duration: 6,
    kind: 'overlay',
    occupies: [{ x: 460, y: 262, w: 1000, h: 658 }],
  },
  tv: {
    file: 'tv',
    compositionId: 'ar-tv',
    duration: 6,
    kind: 'overlay',
    hold: { start: 1.0, end: 4.6 },
    occupies: [
      { x: 420, y: 770, w: 800, h: 146 },
      { x: 24, y: 276, w: 500, h: 264 },
    ],
  },
  summary: {
    file: 'summary',
    compositionId: 'ar-summary',
    duration: 28,
    kind: 'fullscreen',
    occupies: [{ x: 0, y: 0, w: 1920, h: 1080 }],
  },
};

export const SEQUENCE_NAMES = Object.keys(SEQUENCES) as SequenceName[];

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Liste les recouvrements zones occupées × zones vitales (vide = conforme). */
export function safeZoneViolations(name: SequenceName): string[] {
  const meta = SEQUENCES[name];
  if (meta.kind !== 'overlay') return [];
  const out: string[] = [];
  for (const r of meta.occupies) {
    for (const [zone, z] of Object.entries(SAFE_ZONES)) {
      if (intersects(r, z)) out.push(`${name} ${JSON.stringify(r)} ∩ ${zone}`);
    }
  }
  return out;
}

/**
 * Sérialise les variables pour HyperFrames : les tableaux / objets deviennent des chaînes JSON
 * (les variables HyperFrames sont scalaires), les `undefined` sont retirés, le préréglage du
 * nom (ex. sprint) est appliqué.
 */
export function serializeVariables(
  name: SequenceName,
  variables: Record<string, unknown> | object = {},
  lang?: Lang
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  const merged: Record<string, unknown> = { ...(variables as Record<string, unknown>), ...SEQUENCES[name].preset };
  if (lang) merged.lang = lang;
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else out[k] = JSON.stringify(v);
  }
  return out;
}
