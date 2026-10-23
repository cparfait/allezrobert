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
  routeTimeMs?: number;
}

/** Parcours entier : du départ (à 0 m) jusqu'à l'arrivée, ou meilleur tour complet d'une boucle. */
export class RouteTimer {
  private lapStartS: number | null;
  private best: number | null = null;

  constructor(startedAtStart: boolean) {
    this.lapStartS = startedAtStart ? 0 : null;
  }

  /** Arrivée d'un aller simple (sortie arrêtée là). */
  finish(elapsedS: number): void {
    if (this.lapStartS !== null) this.keep(elapsedS - this.lapStartS);
    this.lapStartS = null;
  }

  /** Tour bouclé : le tour compte s'il a été fait en entier, le suivant commence. */
  lap(elapsedS: number): void {
    if (this.lapStartS !== null) this.keep(elapsedS - this.lapStartS);
    this.lapStartS = elapsedS;
  }

  get bestS(): number | null {
    return this.best;
  }

  private keep(s: number): void {
    if (s > 0 && (this.best === null || s < this.best)) this.best = s;
  }
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
