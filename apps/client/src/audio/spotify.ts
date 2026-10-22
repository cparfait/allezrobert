/**
 * Spotify : connexion au compte du coureur (OAuth « Authorization Code + PKCE », sans secret
 * côté serveur) puis télécommande de son appli Spotify (Spotify Connect) : titre en cours,
 * lecture / pause, titre suivant / précédent. La musique sort de l'appli Spotify (ordinateur,
 * téléphone, enceinte), pas du jeu. Les commandes de lecture exigent un compte Premium.
 *
 * Configuration : identifiant d'une application créée sur developer.spotify.com, saisi une fois
 * dans le jeu (bouton « Connecter Spotify », gardé dans le navigateur) ou fourni au build par
 * VITE_SPOTIFY_CLIENT_ID. Adresse de retour : VITE_SPOTIFY_REDIRECT_URI, sinon l'origine du
 * jeu + « / », à déclarer à l'identique dans l'application Spotify (Spotify refuse « localhost »).
 */

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const clientId = () => env.VITE_SPOTIFY_CLIENT_ID ?? localStorage.getItem('ar.spotify.clientId') ?? '';
const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing';
const KEY = 'ar.spotify';

interface Tokens {
  access: string;
  refresh: string;
  expiresAt: number;
}

export interface NowPlaying {
  title: string;
  artist: string;
  isPlaying: boolean;
  image?: string;
}

export const redirectUri = () => env.VITE_SPOTIFY_REDIRECT_URI ?? `${location.origin}/`;

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function randomString(n: number): string {
  return b64url(crypto.getRandomValues(new Uint8Array(n))).slice(0, n);
}

function load(): Tokens | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null') as Tokens | null;
  } catch {
    return null;
  }
}

function save(t: Tokens | null): void {
  if (t) localStorage.setItem(KEY, JSON.stringify(t));
  else localStorage.removeItem(KEY);
}

async function tokenRequest(body: Record<string, string>): Promise<Tokens | null> {
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId(), ...body }),
  }).catch(() => null);
  if (!r?.ok) return null;
  const j = (await r.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  const prev = load();
  const t = { access: j.access_token, refresh: j.refresh_token ?? prev?.refresh ?? '', expiresAt: Date.now() + (j.expires_in - 60) * 1000 };
  save(t);
  return t;
}

class SpotifyRemote {
  /** Le jeu a un identifiant d'application Spotify configuré. */
  get available(): boolean {
    return clientId() !== '';
  }

  /** Identifiant saisi dans le jeu (32 caractères hexadécimaux). */
  setClientId(id: string): boolean {
    const v = id.trim();
    if (!/^[0-9a-f]{32}$/i.test(v)) return false;
    localStorage.setItem('ar.spotify.clientId', v);
    return true;
  }

  get connected(): boolean {
    return this.available && load() !== null;
  }

  /** Redirige vers la page d'autorisation Spotify. */
  async login(): Promise<void> {
    const verifier = randomString(64);
    const state = randomString(16);
    sessionStorage.setItem('ar.spotify.verifier', verifier);
    sessionStorage.setItem('ar.spotify.state', state);
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const q = new URLSearchParams({
      client_id: clientId(),
      response_type: 'code',
      redirect_uri: redirectUri(),
      scope: SCOPES,
      code_challenge_method: 'S256',
      code_challenge: challenge,
      state,
    });
    location.href = `https://accounts.spotify.com/authorize?${q}`;
  }

  /** Au chargement : termine la connexion si l'on revient de Spotify (?code&state), puis nettoie l'URL. */
  async handleRedirect(): Promise<void> {
    const url = new URL(location.href);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const expected = sessionStorage.getItem('ar.spotify.state');
    if (!state || state !== expected) return;
    const verifier = sessionStorage.getItem('ar.spotify.verifier') ?? '';
    sessionStorage.removeItem('ar.spotify.state');
    sessionStorage.removeItem('ar.spotify.verifier');
    for (const k of ['code', 'state', 'error']) url.searchParams.delete(k);
    history.replaceState(null, '', url.toString());
    if (code) await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: verifier });
  }

  logout(): void {
    save(null);
  }

  private async token(): Promise<string | null> {
    const t = load();
    if (!t) return null;
    if (Date.now() < t.expiresAt) return t.access;
    const n = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh });
    if (!n) save(null);
    return n?.access ?? null;
  }

  private async api(path: string, method = 'GET'): Promise<Response | null> {
    const tok = await this.token();
    if (!tok) return null;
    return fetch(`https://api.spotify.com/v1${path}`, { method, headers: { Authorization: `Bearer ${tok}` } }).catch(() => null);
  }

  async nowPlaying(): Promise<NowPlaying | null> {
    const r = await this.api('/me/player/currently-playing');
    if (!r || r.status !== 200) return null;
    const j = (await r.json()) as { is_playing: boolean; item?: { name: string; artists?: Array<{ name: string }>; album?: { images?: Array<{ url: string }> }; show?: { name: string } } };
    if (!j.item) return null;
    const image = j.item.album?.images?.at(-1)?.url;
    return { title: j.item.name, artist: j.item.artists?.map((a) => a.name).join(', ') ?? j.item.show?.name ?? '', isPlaying: j.is_playing, ...(image ? { image } : {}) };
  }

  async play(): Promise<void> {
    await this.api('/me/player/play', 'PUT');
  }

  async pause(): Promise<void> {
    await this.api('/me/player/pause', 'PUT');
  }

  async next(): Promise<void> {
    await this.api('/me/player/next', 'POST');
  }

  async previous(): Promise<void> {
    await this.api('/me/player/previous', 'POST');
  }

  async togglePlay(): Promise<boolean> {
    const np = await this.nowPlaying();
    if (np?.isPlaying) await this.pause();
    else await this.play();
    return !np?.isPlaying;
  }
}

export const spotify = new SpotifyRemote();
