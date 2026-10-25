/**
 * Spotify : connexion au compte du coureur (OAuth « Authorization Code + PKCE », sans secret
 * côté serveur), télécommande Spotify Connect (titre en cours, lecture / pause, suivant /
 * précédent) et lecteur intégré (Web Playback SDK) : le jeu devient un appareil Spotify
 * « Allez Robert ! » vers lequel on transfère la lecture. Lecture et commandes : compte Premium.
 *
 * Configuration : identifiant d'une application créée sur developer.spotify.com, saisi une fois
 * dans le jeu (bouton « Connecter Spotify », gardé dans le navigateur) ou fourni au build par
 * VITE_SPOTIFY_CLIENT_ID. Adresse de retour : VITE_SPOTIFY_REDIRECT_URI, sinon l'origine du
 * jeu + « / », à déclarer à l'identique dans l'application Spotify (Spotify refuse « localhost »).
 */

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const clientId = () => env.VITE_SPOTIFY_CLIENT_ID ?? localStorage.getItem('ar.spotify.clientId') ?? '';
const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing streaming user-read-email user-read-private playlist-read-private playlist-read-collaborative';
const PLAYER_NAME = 'Allez Robert !';

/** Sous-ensemble du Web Playback SDK utilisé ici. */
interface SdkPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  activateElement(): Promise<void>;
  setVolume(v: number): Promise<void>;
  addListener(ev: string, cb: (arg: { device_id?: string; message?: string }) => void): void;
}
type SdkWindow = Window & {
  Spotify?: { Player: new (o: { name: string; getOAuthToken: (cb: (t: string) => void) => void; volume: number }) => SdkPlayer };
  onSpotifyWebPlaybackSDKReady?: () => void;
};
const KEY = 'ar.spotify';

interface Tokens {
  access: string;
  refresh: string;
  expiresAt: number;
  /** Permissions accordées (pour savoir s'il faut se reconnecter après l'ajout du lecteur intégré). */
  scope?: string;
}

export interface NowPlaying {
  title: string;
  artist: string;
  isPlaying: boolean;
  image?: string;
}

/** Adresse de retour à déclarer chez Spotify ; « localhost » y est refusé, d'où 127.0.0.1 en local. */
export const redirectUri = () => env.VITE_SPOTIFY_REDIRECT_URI ?? `${location.origin.replace('//localhost', '//127.0.0.1')}${location.pathname}`;

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
  const j = (await r.json()) as { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
  const prev = load();
  const scope = j.scope ?? prev?.scope;
  const t: Tokens = { access: j.access_token, refresh: j.refresh_token ?? prev?.refresh ?? '', expiresAt: Date.now() + (j.expires_in - 60) * 1000, ...(scope ? { scope } : {}) };
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

  /** La connexion autorise la lecture dans le jeu (sinon : se reconnecter une fois). */
  get canPlayHere(): boolean {
    const sc = load()?.scope ?? '';
    return sc.includes('streaming') && sc.includes('playlist-read-private');
  }

  /** Prévenu dès que la lecture démarre ou s'arrête (la musique du jeu se coupe aussitôt). */
  onPlayState?: (playing: boolean) => void;

  private player: SdkPlayer | null = null;
  private deviceId: string | null = null;
  private playerReady: Promise<string> | null = null;
  /** Dernière erreur du lecteur intégré (compte non Premium, navigateur sans DRM…). */
  playerError = '';

  /** Identifiant d'appareil du lecteur intégré, s'il est prêt. */
  get hereDeviceId(): string | null {
    return this.deviceId;
  }

  /** Charge le Web Playback SDK et crée l'appareil « Allez Robert ! ». */
  private startPlayer(): Promise<string> {
    if (this.playerReady) return this.playerReady;
    this.playerReady = new Promise<string>((resolve, reject) => {
      const w = window as SdkWindow;
      const create = () => {
        const Player = w.Spotify?.Player;
        if (!Player) return reject(new Error('SDK Spotify indisponible'));
        const p = new Player({ name: PLAYER_NAME, volume: 0.7, getOAuthToken: (cb) => void this.token().then((t) => t && cb(t)) });
        // Lecteur intégré : état réel (lecture / pause) dès qu'il change.
        p.addListener('player_state_changed', (st) => {
          const state = st as unknown as { paused?: boolean } | null;
          if (state) this.onPlayState?.(!state.paused);
        });
        p.addListener('ready', ({ device_id }) => {
          this.deviceId = device_id ?? null;
          if (device_id) resolve(device_id);
        });
        p.addListener('not_ready', () => (this.deviceId = null));
        for (const ev of ['initialization_error', 'authentication_error', 'account_error']) {
          p.addListener(ev, ({ message }) => {
            this.playerError = ev === 'account_error' ? 'Compte Spotify Premium nécessaire' : (message ?? ev);
            reject(new Error(this.playerError));
          });
        }
        void p.connect();
        this.player = p;
      };
      if (w.Spotify) return create();
      w.onSpotifyWebPlaybackSDKReady = create;
      const sc = document.createElement('script');
      sc.src = 'https://sdk.scdn.co/spotify-player.js';
      sc.onerror = () => reject(new Error('SDK Spotify injoignable'));
      document.head.appendChild(sc);
    });
    this.playerReady.catch(() => (this.playerReady = null));
    return this.playerReady;
  }

  /** Transfère la lecture vers le jeu (à appeler depuis un clic : le navigateur exige un geste). */
  async playHere(): Promise<boolean> {
    this.onPlayState?.(true);
    try {
      const id = await this.startPlayer();
      await this.player?.activateElement();
      const tok = await this.token();
      if (!tok) return false;
      const r = await fetch('https://api.spotify.com/v1/me/player', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
        body: JSON.stringify({ device_ids: [id], play: true }),
      });
      if (r.status === 403) this.playerError = 'Compte Spotify Premium nécessaire';
      return r.ok;
    } catch {
      return false;
    }
  }

  /** Playlists du compte (les 50 premières). */
  async playlists(): Promise<Array<{ name: string; uri: string; image?: string; tracks: number }>> {
    const r = await this.api('/me/playlists?limit=50');
    if (!r || r.status !== 200) return [];
    const j = (await r.json()) as { items: Array<{ name: string; uri: string; images?: Array<{ url: string }> | null; tracks?: { total: number } }> };
    return j.items.map((p) => {
      const image = p.images?.at(-1)?.url;
      return { name: p.name, uri: p.uri, tracks: p.tracks?.total ?? 0, ...(image ? { image } : {}) };
    });
  }

  /** Recherche de morceaux et de playlists (10 de chaque au plus) ; texte vide : les playlists du compte. */
  async search(query: string): Promise<Array<{ uri: string; type: 'track' | 'playlist'; name: string; sub: string; image?: string }>> {
    const q = query.trim();
    if (!q) return (await this.playlists()).map((p) => ({ uri: p.uri, type: 'playlist' as const, name: p.name, sub: `${p.tracks}`, ...(p.image ? { image: p.image } : {}) }));
    const r = await this.api(`/search?${new URLSearchParams({ q, type: 'track,playlist', limit: '10' })}`);
    if (!r || r.status !== 200) throw new Error(r ? `Spotify ${r.status}` : 'Spotify injoignable');
    const j = (await r.json()) as {
      tracks?: { items: Array<{ uri: string; name: string; artists?: Array<{ name: string }>; album?: { images?: Array<{ url: string }> } } | null> };
      playlists?: { items: Array<{ uri: string; name: string; owner?: { display_name?: string }; images?: Array<{ url: string }> | null; tracks?: { total: number } } | null> };
    };
    const out: Array<{ uri: string; type: 'track' | 'playlist'; name: string; sub: string; image?: string }> = [];
    for (const t of j.tracks?.items ?? []) {
      if (!t) continue;
      const image = t.album?.images?.at(-1)?.url;
      out.push({ uri: t.uri, type: 'track', name: t.name, sub: t.artists?.map((a) => a.name).join(', ') ?? '', ...(image ? { image } : {}) });
    }
    for (const p of j.playlists?.items ?? []) {
      if (!p) continue;
      const image = p.images?.at(-1)?.url;
      out.push({ uri: p.uri, type: 'playlist', name: p.name, sub: p.owner?.display_name ?? '', ...(image ? { image } : {}) });
    }
    return out;
  }

  /** Lance un morceau (ou un album, une playlist, un artiste) : dans le jeu si le lecteur est prêt. */
  async playUri(uri: string): Promise<boolean> {
    if (!uri.startsWith('spotify:track:')) return this.playContext(uri);
    this.onPlayState?.(true);
    let id: string | null = null;
    try {
      id = await this.startPlayer();
    } catch {
      id = null;
    }
    const tok = await this.token();
    if (!tok) return false;
    const r = await fetch(`https://api.spotify.com/v1/me/player/play${id ? `?device_id=${id}` : ''}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
      body: JSON.stringify({ uris: [uri] }),
    });
    if (r.status === 403) this.playerError = 'Compte Spotify Premium nécessaire';
    return r.ok;
  }

  /** Lance une playlist dans le jeu (lecteur intégré, à défaut l'appareil actif). */
  async playContext(uri: string): Promise<boolean> {
    this.onPlayState?.(true);
    let id: string | null = null;
    try {
      id = await this.startPlayer();
      await this.player?.activateElement();
    } catch {
      id = null;
    }
    const tok = await this.token();
    if (!tok) return false;
    const r = await fetch(`https://api.spotify.com/v1/me/player/play${id ? `?device_id=${id}` : ''}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
      body: JSON.stringify({ context_uri: uri }),
    });
    if (r.status === 403) this.playerError = 'Compte Spotify Premium nécessaire';
    return r.ok;
  }

  /** Lecture / pause ; la reprise se fait dans le jeu quand c'est autorisé. Renvoie l'état « en lecture ». */
  async toggleSmart(): Promise<boolean> {
    const np = await this.nowPlaying();
    if (this.canPlayHere && !(np?.isPlaying && (await this.playingHere()))) return this.playHere();
    return this.togglePlay();
  }

  /** Volume du lecteur intégré (0–1). */
  setHereVolume(v: number): void {
    void this.player?.setVolume(v);
  }

  /** L'appareil actif est-il le jeu ? */
  async playingHere(): Promise<boolean> {
    if (!this.deviceId) return false;
    const r = await this.api('/me/player');
    if (!r || r.status !== 200) return false;
    const j = (await r.json()) as { device?: { id?: string } };
    return j.device?.id === this.deviceId;
  }

  /** Redirige vers la page d'autorisation Spotify. */
  async login(): Promise<void> {
    // Ouvert via « localhost » : on bascule d'abord sur l'adresse de retour (127.0.0.1) en emportant
    // l'identifiant (public), la connexion reprend là-bas — le stockage du navigateur dépend de l'adresse.
    const back = new URL(redirectUri());
    if (back.origin !== location.origin) {
      location.href = `${back.origin}${location.pathname}#spotify-connect=${encodeURIComponent(clientId())}`;
      return;
    }
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
    // Suite d'une bascule depuis « localhost » : identifiant repris, connexion lancée.
    const m = /^#spotify-connect=([0-9a-f]{32})$/i.exec(location.hash);
    if (m) {
      history.replaceState(null, '', location.pathname + location.search);
      if (this.setClientId(m[1] as string)) await this.login();
      return;
    }
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
    this.player?.disconnect();
    this.player = null;
    this.playerReady = null;
    this.deviceId = null;
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
    this.onPlayState?.(true);
    await this.api('/me/player/play', 'PUT');
  }

  async pause(): Promise<void> {
    this.onPlayState?.(false);
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
