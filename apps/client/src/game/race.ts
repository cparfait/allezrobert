/**
 * Calculs purs des modes groupe et course côté jeu (sans DOM, testés dans apps/client/test) :
 * classement en direct à partir des positions interpolées et des arrivées annoncées par le
 * serveur, informations de course du coureur, mise en forme des écarts et des états.
 */
import type { RaceStatus, RideResult } from '@allezrobert/shared';

export interface LiveRider {
  id: string;
  name: string;
  /** Distance dépliée (tour × longueur + distance), m. */
  distM: number;
  speedMs: number;
  isAI: boolean;
  isGuest: boolean;
}

export interface StandingRow {
  /** Place (1 = premier) ; 0 = hors classement. */
  pos: number;
  id: string;
  name: string;
  status: RaceStatus;
  isAI: boolean;
  /** Arrivés : temps (ms) et écart au vainqueur (ms). */
  timeMs?: number;
  gapMs?: number;
  /** En course : retard sur le premier en course (m) et estimation en secondes. */
  behindM?: number;
  behindS?: number;
  komPts: number;
  sprintPts: number;
}

/**
 * Classement en direct : les arrivés d'abord (rang serveur), puis les coureurs en course par
 * distance, enfin les hors délai, abandons, mises hors course et hors classement.
 * `known` = derniers résultats connus (événements `finish` / `results` / accueil).
 */
export function liveStandings(riders: readonly LiveRider[], known: ReadonlyMap<string, RideResult>, unranked: ReadonlySet<string> = new Set()): StandingRow[] {
  const rows: StandingRow[] = [];
  const seen = new Set<string>();
  for (const r of riders) {
    seen.add(r.id);
    const k = known.get(r.id);
    const status: RaceStatus = k?.status && k.status !== 'racing' ? k.status : r.isGuest || unranked.has(r.id) ? 'unranked' : 'racing';
    const row: StandingRow = { pos: 0, id: r.id, name: r.name, status, isAI: r.isAI, komPts: k?.komPts ?? 0, sprintPts: k?.sprintPts ?? 0 };
    if (status === 'finished' && k) {
      row.timeMs = k.timeMs;
      if (k.gapMs !== undefined) row.gapMs = k.gapMs;
    }
    rows.push(row);
  }
  // Coureurs partis (abandons) : seulement connus par les résultats.
  for (const k of known.values()) {
    if (seen.has(k.riderId)) continue;
    rows.push({ pos: 0, id: k.riderId, name: k.name, status: k.status ?? 'dnf', isAI: k.isAI, komPts: k.komPts ?? 0, sprintPts: k.sprintPts ?? 0 });
  }
  const order: Record<RaceStatus, number> = { finished: 0, racing: 1, otl: 2, dnf: 3, dq: 4, unranked: 5 };
  const dist = new Map(riders.map((r) => [r.id, r]));
  rows.sort(
    (a, b) =>
      order[a.status] - order[b.status] ||
      (known.get(a.id)?.rank || 1e9) - (known.get(b.id)?.rank || 1e9) ||
      (dist.get(b.id)?.distM ?? 0) - (dist.get(a.id)?.distM ?? 0),
  );
  let pos = 0;
  const firstRacing = rows.find((r) => r.status === 'racing');
  const lead = firstRacing ? dist.get(firstRacing.id) : undefined;
  for (const row of rows) {
    if (row.status === 'finished' || row.status === 'racing') row.pos = ++pos;
    if (row.status === 'racing' && lead) {
      const me = dist.get(row.id)!;
      row.behindM = Math.max(0, lead.distM - me.distM);
      row.behindS = row.behindM / Math.max(lead.speedMs, me.speedMs, 3);
    }
  }
  return rows;
}

export interface SelfRaceInfo {
  pos: number;
  /** Coureurs classables (arrivés + en course). */
  total: number;
  remainingM: number;
  /** Tour courant (1-based) et nombre de tours (1 sur un parcours ouvert). */
  lap: number;
  laps: number;
  /** Écart au coureur devant / derrière (m), s'il y en a un en course. */
  aheadM?: number;
  behindM?: number;
}

export function selfRaceInfo(rows: readonly StandingRow[], riders: readonly LiveRider[], selfId: string, targetM: number, lapLengthM: number, laps: number): SelfRaceInfo | null {
  const me = riders.find((r) => r.id === selfId);
  const row = rows.find((r) => r.id === selfId);
  if (!me || !row) return null;
  const ranked = rows.filter((r) => r.status === 'finished' || r.status === 'racing');
  const info: SelfRaceInfo = {
    pos: row.pos,
    total: ranked.length,
    remainingM: Math.max(0, targetM - me.distM),
    lap: Math.min(laps, Math.max(1, Math.floor(Math.max(me.distM, 0) / Math.max(lapLengthM, 1)) + 1)),
    laps,
  };
  const racing = ranked.filter((r) => r.status === 'racing').map((r) => riders.find((x) => x.id === r.id)!);
  const i = racing.findIndex((r) => r.id === selfId);
  if (i > 0) info.aheadM = racing[i - 1]!.distM - me.distM;
  if (i >= 0 && i < racing.length - 1) info.behindM = me.distM - racing[i + 1]!.distM;
  return info;
}

/** Temps de course : « 1:02:03 » ou « 12:34 ». */
export function formatRaceTime(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

/** Écart : « + 12 s », « + 1:05 », « m.t. » (même temps, < 1 s). */
export function formatGap(ms: number): string {
  if (ms < 1000) return 'm.t.';
  const s = Math.round(ms / 1000);
  return s < 60 ? `+ ${s} s` : `+ ${formatRaceTime(ms)}`;
}

/** Libellé court d'un état (FR / EN). */
export function statusLabel(status: RaceStatus, lang: 'fr' | 'en'): string {
  const fr: Record<RaceStatus, string> = { finished: 'arrivé', racing: 'en course', otl: 'hors délai', dnf: 'abandon', dq: 'hors course', unranked: 'non classé' };
  const en: Record<RaceStatus, string> = { finished: 'finished', racing: 'racing', otl: 'outside time', dnf: 'DNF', dq: 'DSQ', unranked: 'unranked' };
  return (lang === 'fr' ? fr : en)[status];
}

/** Compte à rebours : « 10 » … « 1 », puis « Partez ! » pendant 1,5 s, puis rien. */
export function countdownLabel(msLeft: number, lang: 'fr' | 'en'): string | null {
  if (msLeft > 0) return String(Math.ceil(msLeft / 1000));
  if (msLeft > -1500) return lang === 'fr' ? 'Partez !' : 'Go!';
  return null;
}

/** Couleur de l'écart à l'allure annoncée : dans la bande (±8 %), au-dessus, en dessous. */
export function paceBand(wkg: number, announced: number): 'ok' | 'high' | 'low' {
  const r = wkg / Math.max(announced, 0.1);
  return r > 1.08 ? 'high' : r < 0.92 ? 'low' : 'ok';
}
