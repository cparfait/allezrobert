/**
 * Temps d'une sortie solo envoyés au serveur à la fin (montées, sprints, parcours entier), pour
 * les classements et les records des amis. Les sorties de groupe sont enregistrées par la salle ;
 * sans compte (ou hors ligne), l'envoi échoue en silence et les records restent sur l'appareil.
 */
export interface RideEfforts {
  routeId: string;
  /** Identifie la sortie : un envoi répété (sortie reprise) n'est compté qu'une fois. */
  rideId: string;
  segments: Array<{ segmentId: string; elapsedMs: number }>;
  /** Un temps du parcours entier : l'aller simple, ou un tour de boucle. */
  routeTimeMs?: number;
}

/**
 * Parcours entier : du départ (à 0 m) jusqu'à l'arrivée, ou chaque tour complet d'une boucle (la
 * ligne est au départ ; un tour commencé en cours de route ne compte pas).
 */
export class RouteTimer {
  private lapStartS: number | null;
  /** Temps complets (s), dans l'ordre. */
  readonly times: number[] = [];

  constructor(startedAtStart: boolean) {
    this.lapStartS = startedAtStart ? 0 : null;
  }

  /** Arrivée d'un aller simple (sortie arrêtée là). */
  finish(elapsedS: number): void {
    if (this.lapStartS !== null) this.keep(elapsedS - this.lapStartS);
    this.lapStartS = null;
  }

  /**
   * Tour bouclé : le tour compte s'il a été fait en entier, le suivant commence. Rend son temps
   * et s'il bat les tours précédents de la sortie, ou null pour un tour incomplet.
   */
  lap(elapsedS: number): { timeS: number; best: boolean } | null {
    const prev = this.bestS;
    const s = this.lapStartS === null ? null : this.keep(elapsedS - this.lapStartS);
    this.lapStartS = elapsedS;
    return s === null ? null : { timeS: s, best: prev !== null && s < prev };
  }

  get bestS(): number | null {
    return this.times.length ? Math.min(...this.times) : null;
  }

  private keep(s: number): number | null {
    if (!(s > 0)) return null;
    this.times.push(s);
    return s;
  }
}

/** Temps d'un tour : m:ss, ou h:mm:ss. */
export function fmtLapTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

/** Envoi (sans attendre la réponse) ; vrai si le serveur a accepté. */
export async function postRideEfforts(e: RideEfforts): Promise<boolean> {
  if (!e.segments.length && e.routeTimeMs === undefined) return false;
  try {
    // Chargé à la demande : le chronométrage reste testable sans le navigateur.
    const { apiBase } = await import('../ui/account.ts');
    const res = await fetch(`${apiBase()}/efforts`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(e),
    });
    return res.ok;
  } catch {
    return false;
  }
}
