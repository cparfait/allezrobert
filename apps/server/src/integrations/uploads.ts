/**
 * Envoi des sorties vers Strava (OAuth, scope activity:write) et intervals.icu (clé API).
 * Option « ne pas envoyer à Strava » (le Garmin Edge enregistre déjà la sortie) : réglage du
 * profil `skipStrava`, ou par sortie (paramètre de téléversement).
 * Les secrets sont stockés chiffrés (table integrations) ; jamais renvoyés au client.
 */
import type { Repos } from '../db/repos.ts';
import { PROVIDERS, type OAuthClient } from '../auth/oauth.ts';

export interface StravaSecret {
  accessToken: string;
  refreshToken: string;
  /** Epoch s. */
  expiresAt: number;
}

export interface IntervalsSecret {
  apiKey: string;
  athleteId: string;
}

export interface UploadResult {
  status: 'uploaded' | 'skipped' | 'failed' | 'not_linked';
  ref?: string;
  error?: string;
}

export class UploadService {
  constructor(
    private readonly repos: Repos,
    private readonly strava: OAuthClient | null,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  get stravaEnabled(): boolean {
    return this.strava !== null;
  }

  /** Jeton Strava valide (rafraîchi si expiré dans moins de 5 min). */
  private async stravaToken(userId: string): Promise<string | null> {
    if (!this.strava) return null;
    const integ = await this.repos.getIntegration<StravaSecret>(userId, 'strava');
    if (!integ) return null;
    const s = integ.secret;
    if (s.expiresAt * 1000 > Date.now() + 5 * 60_000) return s.accessToken;
    const res = await this.fetchFn(PROVIDERS.strava.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.strava.clientId,
        client_secret: this.strava.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: s.refreshToken,
      }),
    });
    if (!res.ok) throw new Error(`Rafraîchissement Strava refusé (${res.status})`);
    const j = (await res.json()) as Record<string, any>;
    const next: StravaSecret = { accessToken: j.access_token, refreshToken: j.refresh_token ?? s.refreshToken, expiresAt: Number(j.expires_at) };
    await this.repos.setIntegration(userId, 'strava', next, integ.meta);
    return next.accessToken;
  }

  async linkStrava(userId: string, tokenResponse: Record<string, any>): Promise<void> {
    const secret: StravaSecret = {
      accessToken: String(tokenResponse.access_token),
      refreshToken: String(tokenResponse.refresh_token),
      expiresAt: Number(tokenResponse.expires_at),
    };
    const athlete = tokenResponse.athlete ?? {};
    // Métadonnées minimales : prénom affiché dans l'interface, aucune autre donnée Strava.
    await this.repos.setIntegration(userId, 'strava', secret, { athleteName: athlete.firstname ?? null });
  }

  async unlinkStrava(userId: string): Promise<void> {
    try {
      const token = await this.stravaToken(userId);
      if (token) {
        await this.fetchFn('https://www.strava.com/oauth/deauthorize', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
      }
    } catch {
      /* révocation au mieux : on supprime quand même localement */
    }
    await this.repos.deleteIntegration(userId, 'strava');
  }

  async linkIntervals(userId: string, apiKey: string, athleteId = '0'): Promise<void> {
    const res = await this.fetchFn(`https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}`, {
      headers: { authorization: basic(apiKey) },
    });
    if (!res.ok) throw new Error(`Clé intervals.icu refusée (${res.status})`);
    await this.repos.setIntegration(userId, 'intervals', { apiKey, athleteId } satisfies IntervalsSecret, {});
  }

  async uploadStrava(userId: string, activityId: string, fit: Uint8Array, name: string): Promise<UploadResult> {
    let token: string | null;
    try {
      token = await this.stravaToken(userId);
    } catch (e) {
      return { status: 'failed', error: (e as Error).message };
    }
    if (!token) return { status: 'not_linked' };
    const form = new FormData();
    form.set('file', new Blob([Buffer.from(fit)], { type: 'application/octet-stream' }), `${activityId}.fit`);
    form.set('data_type', 'fit');
    form.set('name', name);
    form.set('trainer', '1');
    form.set('external_id', `allezrobert-${activityId}`);
    form.set('description', 'Allez Robert !');
    const res = await this.fetchFn('https://www.strava.com/api/v3/uploads', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
    if (!res.ok) return { status: 'failed', error: `Strava ${res.status}` };
    const j = (await res.json()) as Record<string, any>;
    return { status: 'uploaded', ref: String(j.id_str ?? j.id ?? '') };
  }

  async uploadIntervals(userId: string, activityId: string, fit: Uint8Array, name: string): Promise<UploadResult> {
    const integ = await this.repos.getIntegration<IntervalsSecret>(userId, 'intervals');
    if (!integ) return { status: 'not_linked' };
    const form = new FormData();
    form.set('file', new Blob([Buffer.from(fit)], { type: 'application/octet-stream' }), `${activityId}.fit`);
    const url = new URL(`https://intervals.icu/api/v1/athlete/${encodeURIComponent(integ.secret.athleteId)}/activities`);
    url.searchParams.set('name', name);
    url.searchParams.set('external_id', `allezrobert-${activityId}`);
    const res = await this.fetchFn(url, { method: 'POST', headers: { authorization: basic(integ.secret.apiKey) }, body: form });
    if (!res.ok) return { status: 'failed', error: `intervals.icu ${res.status}` };
    const j = (await res.json().catch(() => ({}))) as Record<string, any>;
    return { status: 'uploaded', ref: String(j.id ?? '') };
  }

  /** Envoi automatique après téléversement : intervals.icu toujours, Strava sauf option. */
  async autoUpload(userId: string, activityId: string, fit: Uint8Array, name: string, skipStrava: boolean): Promise<{ strava: UploadResult; intervals: UploadResult }> {
    const strava: UploadResult = skipStrava ? { status: 'skipped' } : await this.uploadStrava(userId, activityId, fit, name).catch((e) => ({ status: 'failed' as const, error: String(e) }));
    const intervals: UploadResult = await this.uploadIntervals(userId, activityId, fit, name).catch((e) => ({ status: 'failed' as const, error: String(e) }));
    if (strava.status !== 'not_linked') await this.repos.setUploadStatus(activityId, 'strava', strava.status, strava.ref);
    if (intervals.status !== 'not_linked') await this.repos.setUploadStatus(activityId, 'intervals', intervals.status, intervals.ref);
    return { strava, intervals };
  }
}

function basic(apiKey: string): string {
  return `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}`;
}
