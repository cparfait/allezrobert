/**
 * Règles pures de l'interface (sans DOM, testées dans test/logic.test.ts) : pages proposées, balayage du doigt,
 * bandeau de chiffres, pas des réglages. Tout est pensé pour un doigt humide, à bout de bras, en pédalant.
 */
import { ROAD_FEEL, type PairState } from '@allezrobert/shared';

export type Tab = 'dash' | 'map' | 'act' | 'grp' | 'music';
export type Density = 3 | 5 | 7;

/** Pages de la barre du bas : à l'accueil du jeu, l'attente et la musique ; en sortie, Groupe seulement s'il y a quelqu'un. */
export function tabsFor(st: Pick<PairState, 'phase' | 'team' | 'multiplayer'> | null): Tab[] {
  if (!st || st.phase === 'menu') return ['dash', 'music'];
  return ['dash', 'map', 'act', ...(st.team || st.multiplayer ? (['grp'] as const) : []), 'music'];
}

/** Page enregistrée par une version précédente de l'appli (« ctrl », « chat ») ramenée aux pages actuelles. */
export function readTab(saved: string | null): Tab {
  if (saved === 'ctrl') return 'act';
  if (saved === 'chat') return 'grp';
  return saved === 'map' || saved === 'act' || saved === 'grp' || saved === 'music' ? saved : 'dash';
}

/** Balayage horizontal franc : +1 page suivante, −1 page précédente, 0 rien (doigt qui tremble, geste vertical, trop lent). */
export function swipeDir(dx: number, dy: number, ms: number): -1 | 0 | 1 {
  if (Math.abs(dx) < 60 || Math.abs(dx) < 1.8 * Math.abs(dy) || ms > 900) return 0;
  return dx < 0 ? 1 : -1;
}

export function neighbour(tabs: Tab[], tab: Tab, dir: -1 | 1): Tab {
  const i = tabs.indexOf(tab);
  return tabs[Math.min(Math.max(i + dir, 0), tabs.length - 1)] ?? 'dash';
}

/** Ce que montre le bandeau des pages sans compteur : la séance d'abord, puis la montée, sinon l'essentiel. */
export function bandKind(st: Pick<PairState, 'workout'>, inClimb: boolean): 'workout' | 'climb' | 'base' {
  if (st.workout && st.workout.targetWatts !== null) return 'workout';
  return inClimb ? 'climb' : 'base';
}

/** Puissance par rapport à la cible de la séance : dans la cible à ±5 % (5 W au moins). */
export function targetTone(watts: number, target: number): 'ok' | 'low' | 'high' {
  const tol = Math.max(5, target * 0.05);
  return watts < target - tol ? 'low' : watts > target + tol ? 'high' : 'ok';
}

/** Couleur de la puissance pendant une séance : bleu trop bas, vert dans la cible, rouge trop haut (pas les zones). */
export const TONE_COLORS = { ok: '#22c55e', low: '#60a5fa', high: '#f05252' } as const;

/** Appui sur − ou + d'un réglage en pour cent : calé sur le pas, borné. */
export function stepValue(v: number, dir: -1 | 1, step: number, max = 100): number {
  const n = dir > 0 ? Math.floor(v / step + 1e-6) + 1 : Math.ceil(v / step - 1e-6) - 1;
  return Math.min(Math.max(n * step, 0), max);
}

/** Ressenti route : passer en « très fort » demande un second appui. */
export function roadStep(v: number, dir: -1 | 1, armed: boolean): { value: number; needsConfirm: boolean } {
  const value = stepValue(v, dir, 5, ROAD_FEEL.maxPercent);
  if (dir > 0 && v < ROAD_FEEL.extremePercent && value >= ROAD_FEEL.extremePercent && !armed) return { value: v, needsConfirm: true };
  return { value, needsConfirm: false };
}
