/**
 * OAuth 2.0 « authorization code » avec PKCE (S256) et état signé, pour Google, Discord
 * (connexion) et Strava (liaison d'un compte pour l'envoi des sorties).
 * Aucune bibliothèque tierce : `fetch` natif de Node.
 */
import { createHash } from 'node:crypto';
import { randomId } from '../crypto.ts';

export type LoginProvider = 'google' | 'discord';

export interface ProviderEndpoints {
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  pkce: boolean;
  extraAuthParams?: Record<string, string>;
}

export const PROVIDERS: Record<LoginProvider | 'strava', ProviderEndpoints> = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    pkce: true,
    extraAuthParams: { prompt: 'select_account' },
  },
  discord: {
    authorizeUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    scope: 'identify email',
    pkce: true,
  },
  strava: {
    authorizeUrl: 'https://www.strava.com/oauth/authorize',
    tokenUrl: 'https://www.strava.com/oauth/token',
    scope: 'activity:write,read',
    pkce: false,
    extraAuthParams: { approval_prompt: 'auto' },
  },
};

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface PkcePair {
  state: string;
  verifier: string;
  challenge: string;
}

export function newPkce(): PkcePair {
  const verifier = randomId(32);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { state: randomId(16), verifier, challenge };
}

export function authorizeUrl(provider: keyof typeof PROVIDERS, client: OAuthClient, pkce: PkcePair): string {
  const p = PROVIDERS[provider];
  const url = new URL(p.authorizeUrl);
  url.searchParams.set('client_id', client.clientId);
  url.searchParams.set('redirect_uri', client.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', p.scope);
  url.searchParams.set('state', pkce.state);
  if (p.pkce) {
    url.searchParams.set('code_challenge', pkce.challenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  for (const [k, v] of Object.entries(p.extraAuthParams ?? {})) url.searchParams.set(k, v);
  return url.toString();
}

export async function exchangeCode(provider: keyof typeof PROVIDERS, client: OAuthClient, code: string, verifier: string, fetchFn: typeof fetch = fetch): Promise<Record<string, any>> {
  const p = PROVIDERS[provider];
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    redirect_uri: client.redirectUri,
  });
  if (p.pkce) body.set('code_verifier', verifier);
  const res = await fetchFn(p.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
  });
  if (!res.ok) throw new Error(`Échange du code OAuth ${provider} refusé (${res.status})`);
  return (await res.json()) as Record<string, any>;
}

export interface OAuthIdentity {
  subject: string;
  displayName: string;
  /** E-mail vérifié par le fournisseur (sert uniquement au calcul de l'empreinte). */
  verifiedEmail?: string;
}

export async function fetchIdentity(provider: LoginProvider, accessToken: string, fetchFn: typeof fetch = fetch): Promise<OAuthIdentity> {
  const url = provider === 'google' ? 'https://openidconnect.googleapis.com/v1/userinfo' : 'https://discord.com/api/users/@me';
  const res = await fetchFn(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Profil ${provider} indisponible (${res.status})`);
  const j = (await res.json()) as Record<string, any>;
  if (provider === 'google') {
    const id: OAuthIdentity = { subject: String(j.sub), displayName: String(j.given_name ?? j.name ?? 'Coureur') };
    if (j.email && j.email_verified) id.verifiedEmail = String(j.email);
    return id;
  }
  const id: OAuthIdentity = { subject: String(j.id), displayName: String(j.global_name ?? j.username ?? 'Coureur') };
  if (j.email && j.verified) id.verifiedEmail = String(j.email);
  return id;
}

/** N'accepte que des redirections relatives au site (anti « open redirect »). */
export function safeRedirect(r: unknown): string {
  if (typeof r !== 'string' || !r.startsWith('/') || r.startsWith('//') || r.includes('\\')) return '/';
  return r.slice(0, 512);
}
