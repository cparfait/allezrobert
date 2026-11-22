/**
 * Envois d'une sortie gardée sur le compte : état de Strava et d'intervals.icu tel que le serveur le note, et nouvel
 * essai d'un envoi échoué (`POST /activities/:id/upload`). Sert au bilan de fin de sortie, juste après l'envoi du
 * FIT, et à la page d'une sortie passée de l'historique.
 */
import { apiBase } from './account.ts';
import { exportView } from './rideOutcome.ts';

const api = (p: string, init?: RequestInit) => fetch(`${apiBase()}${p}`, { credentials: 'include', ...init });

export interface UploadParams {
  name: string;
  routeId?: string | null;
  skipStrava: boolean;
  clientRideId?: string;
  kind?: string;
  ftp?: number;
  workoutId?: string | null;
  workoutName?: string | null;
}

export interface UploadedRide {
  activityId: string | null;
  xpGained: number;
  level: number;
  duplicate: boolean;
}

/** Envoie le FIT sur le compte ; `null` si le serveur refuse ou ne répond pas. */
export async function uploadRideFit(fit: Uint8Array, p: UploadParams): Promise<UploadedRide | null> {
  const q = new URLSearchParams({ name: p.name.slice(0, 100), skipStrava: p.skipStrava ? '1' : '0' });
  if (p.routeId) q.set('routeId', p.routeId);
  if (p.clientRideId) q.set('clientRideId', p.clientRideId);
  if (p.kind) q.set('kind', p.kind);
  if (p.ftp) q.set('ftp', String(Math.round(p.ftp)));
  if (p.workoutId) q.set('workoutId', p.workoutId.slice(0, 80));
  if (p.workoutName) q.set('workoutName', p.workoutName.slice(0, 100));
  const r = await api(`/activities?${q}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: fit as BlobPart }).catch(() => null);
  if (!r?.ok) return null;
  const j = (await r.json().catch(() => null)) as { xpGained?: number; progression?: { level?: number }; activity?: { id?: string }; duplicate?: boolean } | null;
  return { activityId: j?.activity?.id ?? null, xpGained: j?.xpGained ?? 0, level: j?.progression?.level ?? 0, duplicate: !!j?.duplicate };
}

interface Integrations {
  strava: { available: boolean; connected: boolean };
  intervals: { connected: boolean };
}
interface ActivityExports {
  stravaStatus: string | null;
  intervalsStatus: string | null;
  hasFit?: boolean;
}

const TARGETS = [
  ['strava', 'Strava'],
  ['intervals', 'intervals.icu'],
] as const;

/**
 * Remplit `box` avec une ligne par service : nom, état en un mot, bouton de nouvel essai quand il a un sens.
 * `settle` : l'envoi vient de partir en arrière-plan, on relit l'état quelques fois avant de proposer un essai.
 * Renvoie `false` si l'activité est introuvable (hors ligne, supprimée).
 */
export async function renderRideExports(box: HTMLElement, activityId: string, fr: boolean, o: { settle?: boolean } = {}): Promise<boolean> {
  let tries = o.settle ? 5 : 0;
  const load = async (): Promise<boolean> => {
    const [integ, act] = await Promise.all([
      api('/integrations').then((r) => (r.ok ? (r.json() as Promise<Integrations>) : null)).catch(() => null),
      api(`/activities/${encodeURIComponent(activityId)}`).then((r) => (r.ok ? (r.json() as Promise<ActivityExports>) : null)).catch(() => null),
    ]);
    if (!act || !box.isConnected) return false;
    const linked = { strava: !!integ?.strava.connected, intervals: !!integ?.intervals.connected };
    const status = { strava: act.stravaStatus, intervals: act.intervalsStatus };
    const pending = TARGETS.some(([t]) => linked[t] && !status[t]);
    const settling = pending && tries > 0;
    box.innerHTML = TARGETS.map(([t, label]) => {
      const v = exportView(status[t], linked[t], fr);
      const waiting = settling && linked[t] && !status[t];
      const word = waiting ? (fr ? 'Envoi…' : 'Sending…') : v.word;
      return `<div class="rx-row"><b>${label}</b><span class="ab-state is-${waiting ? 'info' : v.tone}"><i></i>${word}${v.detail ? ` · ${v.detail}` : ''}</span>${v.retry && !waiting ? `<button type="button" class="ab-btn ab-chip" data-rx="${t}">${v.retryLabel}</button>` : ''}</div>`;
    }).join('');
    box.querySelectorAll<HTMLButtonElement>('[data-rx]').forEach((b) =>
      b.addEventListener('click', async () => {
        b.disabled = true;
        b.textContent = fr ? 'Envoi…' : 'Sending…';
        // 200 : envoyée ; 409 : service non relié ; 502 : le service a refusé. Dans tous les cas l'état relu fait foi.
        await api(`/activities/${encodeURIComponent(activityId)}/upload`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: b.dataset.rx }) }).catch(() => null);
        tries = 0;
        if (!(await load())) {
          b.disabled = false;
          b.textContent = fr ? 'Réessayer' : 'Try again';
        }
      }),
    );
    if (settling) {
      tries--;
      setTimeout(() => void load(), 4000);
    }
    return true;
  };
  return load();
}
