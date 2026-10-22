import type { RouteData } from '@allezrobert/shared';
import { t, setLang, getLang, type I18nKey } from '../i18n/index.ts';
import type { Settings } from './settings.ts';
import { saveSettings } from './settings.ts';
import { music } from '../audio/music.ts';
import { spotify } from '../audio/spotify.ts';

/** Ce que l'écran d'appairage sait faire, quel que soit le transport (implémenté avec @allezrobert/devices). */
export interface DevicePanel {
  /** Appareils connus avec leur état lisible. */
  list(): Array<{ id: string; name: string; role: string; state: string; detail?: string; ok: boolean }>;
  /** Transports disponibles sur cette plateforme. */
  transports(): Array<{ id: string; label: string }>;
  /** Lance l'appairage d'un rôle (Web Bluetooth ouvre le sélecteur du navigateur). */
  pair(role: 'trainer' | 'power' | 'heartRate' | 'cadence' | 'shifter' | 'fan', transport: string): Promise<void>;
  forget(id: string): void;
  useSimulator(on: boolean): void;
  simulatorOn(): boolean;
  warnings(): string[];
  /** Adaptateurs Bluetooth (app Windows) : intégré ou dongle. */
  adapters?(): Promise<Array<{ id: string; name: string; isDefault: boolean }>>;
  selectAdapter?(id: string): Promise<void>;
  onChange(cb: () => void): void;
}

export interface MenuCallbacks {
  onStart(settings: Settings, extras: { workoutFile?: { name: string; content: string }; inviteCode?: string }): void;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

type Page = 'home' | 'ride' | 'devices' | 'profile' | 'settings';

const fr = () => getLang() === 'fr';

/**
 * Menu principal en pages : un accueil avec les grandes entrées (Rouler, Capteurs, Profil,
 * Réglages, Garage, Tutoriel), chacune ouvrant sa propre page avec un retour (bouton ou Échap).
 */
export class MainMenu {
  private readonly root: HTMLElement;
  private readonly s: Settings;
  private readonly routes: RouteData[];
  private readonly devices: DevicePanel;
  private readonly cb: MenuCallbacks;
  private workoutFile: { name: string; content: string } | undefined;
  private page: Page = 'home';
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.page !== 'home' && this.root.querySelector('.menu')) this.go('home');
  };
  onSettingsChange?: (s: Settings) => void;
  /** Relance le tutoriel (onboarding) depuis le menu. */
  onTutorial?: () => void;
  /** Ouvre le garage (progression, cosmétiques). */
  onGarage?: () => void;
  /** Compte connecté (affiché dans le menu), connexion / déconnexion, synchro du profil. */
  account: { name: string; level: number } | null = null;
  onLogin?: () => void;
  onLogout?: () => void;
  onSettingsSaved?: (s: Settings) => void;

  constructor(root: HTMLElement, settings: Settings, routes: RouteData[], devices: DevicePanel, cb: MenuCallbacks) {
    this.root = root;
    this.s = settings;
    this.routes = routes;
    this.devices = devices;
    this.cb = cb;
    if (!this.s.routeId || !routes.some((r) => r.id === this.s.routeId)) this.s.routeId = routes[0]?.id ?? '';
    devices.onChange(() => {
      if (this.page === 'devices') this.renderDevices();
      else if (this.page === 'home') this.renderSummary();
    });
  }

  show(page: Page = 'home'): void {
    document.addEventListener('keydown', this.onKey);
    this.go(page);
  }

  hide(): void {
    document.removeEventListener('keydown', this.onKey);
    this.root.innerHTML = '';
  }

  private go(page: Page): void {
    this.page = page;
    this.render();
  }

  private opt<T extends string>(value: T, current: string, label: string): string {
    return `<option value="${value}" ${value === current ? 'selected' : ''}>${esc(label)}</option>`;
  }

  private routeName(r: RouteData): string {
    return getLang() === 'en' && r.nameEn ? r.nameEn : r.name;
  }

  private routeMeta(r: RouteData): string {
    return `${(r.lengthM / 1000).toFixed(1).replace('.', ',')} km · ${Math.round(r.elevationGainM)} m D+ · ${r.segments.length} segments${r.loop ? (fr() ? ' · boucle' : ' · loop') : ''}`;
  }

  private modes(): Array<[Settings['mode'], I18nKey, string]> {
    return fr()
      ? [
          ['free', 'free', 'Rouler à son rythme, avec ou sans coureurs IA.'],
          ['group', 'group', 'Rouler à plusieurs, le groupe reste ensemble.'],
          ['race', 'race', 'Course en ligne avec classement à l’arrivée.'],
          ['workout', 'workout', 'Séance structurée (.zwo, .erg, .mrc) en mode ERG.'],
          ['ftpTest', 'ftpTest', 'Test de 20 minutes pour estimer ta FTP.'],
        ]
      : [
          ['free', 'free', 'Ride at your own pace, with or without AI riders.'],
          ['group', 'group', 'Ride together, the group stays as one.'],
          ['race', 'race', 'Online race with results at the finish.'],
          ['workout', 'workout', 'Structured session (.zwo, .erg, .mrc) in ERG mode.'],
          ['ftpTest', 'ftpTest', '20-minute test to estimate your FTP.'],
        ];
  }

  private accountBox(): string {
    return this.account
      ? `<div class="account-chip">● ${esc(this.account.name)} · ${fr() ? 'niveau' : 'level'} ${this.account.level} <button class="btn small" id="m-logout">${fr() ? 'Se déconnecter' : 'Sign out'}</button></div>`
      : `<button class="btn small" id="m-login">${fr() ? 'Se connecter' : 'Sign in'}</button>`;
  }

  private head(title: string): string {
    return `<div class="page-head"><button class="btn small" id="m-back">← ${fr() ? 'Accueil' : 'Home'}</button><h1>${title}</h1></div>`;
  }

  private render(): void {
    const html: Record<Page, () => string> = {
      home: () => this.homeHtml(),
      ride: () => this.rideHtml(),
      devices: () => `<div class="menu"><div class="card panel page">${this.head(t('devices'))}<div id="m-devices"></div></div></div>`,
      profile: () => this.profileHtml(),
      settings: () => this.settingsHtml(),
    };
    this.root.innerHTML = html[this.page]();
    if (this.page === 'devices') this.renderDevices();
    if (this.page === 'home') this.renderSummary();
    this.renderMusic();
    this.bind();
    (this.root.querySelector('.nav-item, #m-back') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  private homeHtml(): string {
    const nav: Array<[string, string, string]> = [
      ['ride', t('ride'), fr() ? 'Choisir le mode et l’itinéraire' : 'Pick a mode and a route'],
      ['devices', t('devices'), fr() ? 'Home trainer, puissance, cardio, vitesses' : 'Trainer, power, heart rate, shifters'],
      ['profile', t('profile'), fr() ? 'Nom, poids, FTP, maillot et vélo' : 'Name, weight, FTP, jersey and bike'],
      ['settings', t('settings'), fr() ? 'Graphismes, météo, home trainer, langue' : 'Graphics, weather, trainer, language'],
      ['garage', 'Garage', fr() ? 'Progression et équipements' : 'Progress and gear'],
      ['tuto', fr() ? 'Tutoriel' : 'Tutorial', fr() ? 'Découvrir les commandes' : 'Learn the controls'],
    ];
    return `<div class="menu"><div class="card panel home">
      <div class="home-top"><div><h1>Allez <em>Robert</em> !</h1>
        <p class="tagline">${fr() ? 'De Saclay à Rambouillet, entre amis.' : 'From Saclay to Rambouillet, with friends.'}</p></div>${this.accountBox()}</div>
      <div class="home-grid">
        <nav class="nav">${nav
          .map(([id, label, sub], i) => `<button class="nav-item ${i === 0 ? 'primary' : ''}" data-nav="${id}"><span><b>${esc(label)}</b><span class="meta">${esc(sub)}</span></span></button>`)
          .join('')}</nav>
        <div class="summary" id="m-summary"></div>
      </div>
      <div id="m-music" class="music-bar"></div>
      <p class="shortcuts">${t('shortcuts')}</p>
    </div></div>`;
  }

  /** Résumé de la prochaine sortie sur l'accueil, avec le départ direct. */
  private renderSummary(): void {
    const box = this.root.querySelector('#m-summary');
    if (!box) return;
    const r = this.routes.find((x) => x.id === this.s.routeId);
    const mode = this.modes().find(([m]) => m === this.s.mode);
    const connected = this.devices.list().filter((d) => d.ok);
    const sim = this.devices.simulatorOn();
    const devText = connected.length
      ? connected.map((d) => esc(d.name)).join(', ')
      : sim
        ? fr()
          ? 'Simulateur (sans matériel)'
          : 'Simulator (no hardware)'
        : fr()
          ? 'Aucun capteur connecté'
          : 'No sensor connected';
    box.innerHTML = `
      <h2>${fr() ? 'Prochaine sortie' : 'Next ride'}</h2>
      <div class="sum-route"><b>${r ? esc(this.routeName(r)) : '—'}</b><div class="meta">${r ? this.routeMeta(r) : ''}</div></div>
      <div class="sum-line"><span>${t('mode')}</span><b>${mode ? esc(t(mode[1])) : ''}</b></div>
      <div class="sum-line"><span>${t('devices')}</span><b class="${connected.length || sim ? '' : 'warn-text'}">${devText}</b></div>
      <div class="sum-line"><span>${fr() ? 'Coureur' : 'Rider'}</span><b>${esc(this.s.name)} · ${this.s.massKg} kg · ${Math.round(this.s.ftpWatts)} W</b></div>
      <button id="m-start" class="btn primary big">${t('ride')} →</button>`;
    box.querySelector('#m-start')?.addEventListener('click', () => this.start());
  }

  private rideHtml(): string {
    const s = this.s;
    const routeCards = this.routes
      .map((r) => `<div class="route-card ${r.id === s.routeId ? 'selected' : ''}" data-route="${esc(r.id)}" tabindex="0"><b>${esc(this.routeName(r))}</b><div class="meta">${this.routeMeta(r)}</div></div>`)
      .join('');
    const modeCards = this.modes()
      .map(([v, k, d]) => `<div class="route-card ${v === s.mode ? 'selected' : ''}" data-mode="${v}" tabindex="0"><b>${esc(t(k))}</b><div class="meta">${esc(d)}</div></div>`)
      .join('');
    return `<div class="menu"><div class="card panel page">
      ${this.head(t('ride'))}
      <h2>${t('mode')}</h2>
      <div class="mode-grid">${modeCards}</div>
      <div class="row" style="margin-top:10px">
        <input id="m-invite" class="btn small ${s.mode === 'group' || s.mode === 'race' ? '' : 'hidden'}" placeholder="${fr() ? 'Code d’invitation (facultatif)' : 'Invite code (optional)'}" style="width:240px" />
        <label class="btn small ${s.mode === 'workout' ? '' : 'hidden'}">${fr() ? 'Choisir une séance' : 'Choose a workout'} (.zwo / .erg / .mrc)<input id="m-workout" type="file" accept=".zwo,.erg,.mrc" hidden /></label>
        <span id="m-wname" class="meta">${this.workoutFile ? esc(this.workoutFile.name) : ''}</span>
      </div>
      <h2>${t('route')}</h2>
      <div class="route-grid">${routeCards}</div>
      <div class="page-foot"><button id="m-start" class="btn primary big">${t('ride')} →</button></div>
    </div></div>`;
  }

  private profileHtml(): string {
    const s = this.s;
    return `<div class="menu"><div class="card panel page narrow">
      ${this.head(t('profile'))}
      <div class="grid3" style="margin-top:18px">
        <label class="field">${t('name')}<input id="m-name" value="${esc(s.name)}" /></label>
        <label class="field">${t('weight')}<input id="m-mass" type="number" min="30" max="200" step="0.5" value="${s.massKg}" /></label>
        <label class="field">${t('height')}<input id="m-height" type="number" min="120" max="220" value="${s.heightCm}" /></label>
        <label class="field">${t('ftp')}<input id="m-ftp" type="number" min="50" max="600" value="${s.ftpWatts}" /></label>
        <label class="field">${fr() ? 'Maillot' : 'Jersey'}<input id="m-jersey" type="color" value="${s.look.jersey}" /></label>
        <label class="field">${fr() ? 'Vélo' : 'Bike'}<input id="m-bike" type="color" value="${s.look.bike}" /></label>
      </div>
      <p class="meta" style="margin-top:16px">${fr() ? 'Le poids et la taille servent à la physique (vitesse en montée, prise au vent) ; la FTP règle les séances et les zones.' : 'Weight and height drive the physics (climbing speed, drag); FTP sets workouts and zones.'}</p>
    </div></div>`;
  }

  private settingsHtml(): string {
    const s = this.s;
    const L = fr();
    return `<div class="menu"><div class="card panel page">
      ${this.head(t('settings'))}
      <h2>${L ? 'Graphismes et monde' : 'Graphics and world'}</h2>
      <div class="grid3">
        <label class="field">${t('quality')}<select id="m-quality">${(['low', 'medium', 'high', 'ultra'] as const).map((q) => this.opt(q, s.quality, t(q))).join('')}</select></label>
        <label class="field">${t('season')}<select id="m-season">${(['spring', 'summer', 'autumn', 'winter'] as const).map((q) => this.opt(q, s.season, t(q))).join('')}</select></label>
        <label class="field">${t('hour')} <span id="m-hourv">${s.hour.toFixed(1)} h</span><input id="m-hour" type="range" min="5" max="22" step="0.25" value="${s.hour}" /></label>
        <label class="field">${L ? 'Nuages' : 'Clouds'}<input id="m-clouds" type="range" min="0" max="1" step="0.05" value="${s.clouds}" /></label>
        <label class="field">${L ? 'Pluie' : 'Rain'}<input id="m-rain" type="range" min="0" max="1" step="0.05" value="${s.rain}" /></label>
        <label class="field">${L ? 'Brouillard' : 'Fog'}<input id="m-fog" type="range" min="0" max="1" step="0.05" value="${s.fog}" /></label>
      </div>
      <h2>${L ? 'Home trainer' : 'Smart trainer'}</h2>
      <div class="grid3">
        <label class="field">${t('difficulty')} <span id="m-diffv">${Math.round(s.trainerDifficulty * 100)} %</span><input id="m-diff" type="range" min="0" max="1" step="0.05" value="${s.trainerDifficulty}" /></label>
        <label class="field">Transmission<select id="m-drive">${this.opt('cog', s.drivetrain, L ? 'Zwift Cog (vitesses virtuelles)' : 'Zwift Cog (virtual shifting)')}${this.opt('cassette', s.drivetrain, L ? 'Cassette réelle' : 'Real cassette')}</select></label>
        <label class="field">${L ? 'Lissage puissance' : 'Power smoothing'}<select id="m-smooth">${this.opt('0', s.smoothing3s ? '1' : '0', L ? 'Non' : 'Off')}${this.opt('1', s.smoothing3s ? '1' : '0', '3 s')}</select></label>
      </div>
      <h2>${L ? 'Coureurs IA' : 'AI riders'}</h2>
      <div class="grid3">
        <label class="field">${L ? 'Nombre' : 'Count'}<input id="m-ai" type="number" min="0" max="19" value="${s.aiRiders}" /></label>
        <label class="field">${L ? 'Niveau' : 'Level'}<select id="m-ailevel">${this.opt('0.8', String(s.aiLevel), '80 % FTP')}${this.opt('1', String(s.aiLevel), '100 % FTP')}${this.opt('1.15', String(s.aiLevel), '115 % FTP')}</select></label>
      </div>
      <h2>${L ? 'Musique' : 'Music'}</h2>
      <div id="m-music" class="music-bar"></div>
      <h2>${L ? 'Langue et envoi des sorties' : 'Language and ride upload'}</h2>
      <div class="grid3">
        <label class="field">${t('language')}<select id="m-lang">${this.opt('fr', s.lang, 'Français')}${this.opt('en', s.lang, 'English')}</select></label>
        <label class="field">Strava<select id="m-strava">${this.opt('skip', s.skipStrava ? 'skip' : 'send', L ? 'Ne pas envoyer (Garmin)' : 'Don’t upload (Garmin)')}${this.opt('send', s.skipStrava ? 'skip' : 'send', L ? 'Envoyer' : 'Upload')}</select></label>
      </div>
    </div></div>`;
  }

  /** Barre musique : musique du jeu (marche / arrêt, volume) et télécommande Spotify. */
  renderMusic(): void {
    const box = this.root.querySelector('#m-music');
    if (!box) return;
    const L = fr();
    const sp = !spotify.available
      ? this.page === 'settings'
        ? `<span class="meta">${L ? 'Spotify : renseigner VITE_SPOTIFY_CLIENT_ID (voir le README) pour pouvoir connecter son compte.' : 'Spotify: set VITE_SPOTIFY_CLIENT_ID (see README) to link an account.'}</span>`
        : ''
      : spotify.connected
        ? `<span class="spotify"><span class="sp-dot">●</span> <span id="sp-now" class="meta">Spotify</span>
            <button class="btn small" id="sp-prev" title="${L ? 'Précédent' : 'Previous'}">⏮</button><button class="btn small" id="sp-play" title="${L ? 'Lecture / pause' : 'Play / pause'}">⏯</button><button class="btn small" id="sp-next" title="${L ? 'Suivant' : 'Next'}">⏭</button>
            ${this.page === 'settings' ? `<button class="btn small" id="sp-logout">${L ? 'Déconnecter Spotify' : 'Disconnect Spotify'}</button>` : ''}</span>`
        : `<button class="btn small spotify-btn" id="sp-login">${L ? 'Connecter Spotify' : 'Connect Spotify'}</button>`;
    box.innerHTML = `
      <button class="btn small ${music.enabled ? 'on' : ''}" id="mu-toggle">♪ ${L ? 'Musique' : 'Music'} : ${music.enabled ? (L ? 'activée' : 'on') : L ? 'coupée' : 'off'}</button>
      <input id="mu-vol" type="range" min="0" max="1" step="0.05" value="${music.volume}" title="${L ? 'Volume de la musique' : 'Music volume'}" ${music.enabled ? '' : 'disabled'} />
      ${music.enabled && music.current ? `<span class="meta">♪ ${esc(music.current.title)}</span><button class="btn small" id="mu-next" title="${L ? 'Morceau suivant' : 'Next track'}">⏭</button>` : ''}
      ${sp}`;
    box.querySelector('#mu-toggle')?.addEventListener('click', () => {
      music.toggle();
      this.renderMusic();
    });
    box.querySelector('#mu-next')?.addEventListener('click', () => music.next());
    box.querySelector('#mu-vol')?.addEventListener('input', (e) => music.setVolume(Number((e.target as HTMLInputElement).value)));
    box.querySelector('#sp-login')?.addEventListener('click', () => void spotify.login());
    box.querySelector('#sp-logout')?.addEventListener('click', () => {
      spotify.logout();
      this.renderMusic();
    });
    const refresh = () => setTimeout(() => void this.refreshNowPlaying(), 600);
    box.querySelector('#sp-play')?.addEventListener('click', () => void spotify.togglePlay().then(refresh));
    box.querySelector('#sp-next')?.addEventListener('click', () => void spotify.next().then(refresh));
    box.querySelector('#sp-prev')?.addEventListener('click', () => void spotify.previous().then(refresh));
    if (spotify.connected) void this.refreshNowPlaying();
  }

  /** Met à jour le titre Spotify affiché (appelé aussi par le suivi périodique). */
  async refreshNowPlaying(): Promise<void> {
    const el = this.root.querySelector('#sp-now');
    if (!el) return;
    const np = await spotify.nowPlaying();
    el.textContent = np ? `${np.isPlaying ? '' : '⏸ '}${np.title} — ${np.artist}` : fr() ? 'Rien en lecture (lance Spotify sur un appareil)' : 'Nothing playing (start Spotify on a device)';
  }

  private start(): void {
    const invite = (this.root.querySelector('#m-invite') as HTMLInputElement | null)?.value.trim();
    this.cb.onStart(this.s, { ...(this.workoutFile ? { workoutFile: this.workoutFile } : {}), ...(invite ? { inviteCode: invite } : {}) });
  }

  private renderDevices(): void {
    const box = this.root.querySelector('#m-devices');
    if (!box) return;
    const list = this.devices.list();
    const transports = this.devices.transports();
    const roles: Array<[Parameters<DevicePanel['pair']>[0], I18nKey]> = [
      ['trainer', 'trainer'],
      ['power', 'powerMeter'],
      ['heartRate', 'hrm'],
      ['shifter', 'shifter'],
      ['fan', 'fan'],
    ];
    box.innerHTML = `
      <div class="device-list" style="margin-top:18px">
        ${list
          .map(
            (d) => `<div class="device"><div><b>${esc(d.name)}</b> <span class="meta">· ${esc(d.role)}</span><div class="meta">${esc(d.state)}${d.detail ? ` · ${esc(d.detail)}` : ''}</div></div>
            <button class="btn small" data-forget="${esc(d.id)}">✕</button></div>`,
          )
          .join('')}
        <div class="row">
          <select id="m-transport" class="btn small">${transports.map((tr) => `<option value="${esc(tr.id)}">${esc(tr.label)}</option>`).join('')}</select>
          ${roles.map(([role, k]) => `<button class="btn small" data-pair="${role}">+ ${t(k)}</button>`).join('')}
        </div>
        <label class="row" style="font-size:13px;color:var(--ar-muted)"><input type="checkbox" id="m-guest" ${this.s.guest ? 'checked' : ''}/> ${fr() ? 'Invité sans matériel (clavier / manette, hors classements)' : 'Guest without hardware (keyboard / gamepad, unranked)'}</label>
        <label class="row" style="font-size:13px;color:var(--ar-muted)"><input type="checkbox" id="m-sim" ${this.devices.simulatorOn() ? 'checked' : ''}/> ${t('simulator')} (${fr() ? 'rouler sans matériel' : 'ride without hardware'})</label>
        <div id="m-adapters"></div>
        ${this.devices
          .warnings()
          .map((w) => `<div class="warning">${esc(w)}</div>`)
          .join('')}
        <div class="warning" style="background:rgba(59,130,246,.12);border-color:rgba(59,130,246,.35);color:#bfdbfe">${t('oneAppAtATime')}<br/>${t('edgeWarn')}</div>
      </div>`;
    box.querySelectorAll<HTMLButtonElement>('[data-pair]').forEach((b) =>
      b.addEventListener('click', async () => {
        const transport = (box.querySelector('#m-transport') as HTMLSelectElement).value;
        b.disabled = true;
        try {
          await this.devices.pair(b.dataset.pair as Parameters<DevicePanel['pair']>[0], transport);
        } catch (e) {
          alert(String((e as Error).message ?? e));
        } finally {
          b.disabled = false;
          this.renderDevices();
        }
      }),
    );
    box.querySelectorAll<HTMLButtonElement>('[data-forget]').forEach((b) => b.addEventListener('click', () => this.devices.forget(b.dataset.forget as string)));
    (box.querySelector('#m-guest') as HTMLInputElement).addEventListener('change', (e) => {
      this.s.guest = (e.target as HTMLInputElement).checked;
      saveSettings(this.s);
    });
    (box.querySelector('#m-sim') as HTMLInputElement).addEventListener('change', (e) => {
      this.devices.useSimulator((e.target as HTMLInputElement).checked);
      this.renderDevices();
    });
    if (this.devices.adapters) {
      void this.devices.adapters().then((ads) => {
        const el = box.querySelector('#m-adapters');
        if (!el || ads.length < 2) return;
        el.innerHTML = `<label class="field">Adaptateur Bluetooth<select id="m-adapter">${ads.map((a) => `<option value="${esc(a.id)}" ${a.isDefault ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>`;
        el.querySelector('select')?.addEventListener('change', (e) => void this.devices.selectAdapter?.((e.target as HTMLSelectElement).value));
      });
    }
  }

  private bind(): void {
    const s = this.s;
    const on = <T extends HTMLElement>(id: string, ev: string, fn: (el: T) => void) => {
      const el = this.root.querySelector(`#${id}`) as T | null;
      el?.addEventListener(ev, () => fn(el));
    };
    const changed = () => {
      saveSettings(s);
      this.onSettingsChange?.(s);
      this.onSettingsSaved?.(s);
    };
    // Navigation.
    this.root.querySelectorAll<HTMLElement>('[data-nav]').forEach((el) =>
      el.addEventListener('click', () => {
        const id = el.dataset.nav as string;
        if (id === 'garage') this.onGarage?.();
        else if (id === 'tuto') this.onTutorial?.();
        else this.go(id as Page);
      }),
    );
    on('m-back', 'click', () => this.go('home'));
    on('m-login', 'click', () => this.onLogin?.());
    on('m-logout', 'click', () => this.onLogout?.());
    if (this.page === 'ride') on('m-start', 'click', () => this.start());
    // Choix par cartes (souris, Entrée ou Espace).
    const cards = (attr: 'route' | 'mode', apply: (v: string) => void) =>
      this.root.querySelectorAll<HTMLElement>(`[data-${attr}]`).forEach((el) => {
        const pick = () => {
          apply(el.dataset[attr] as string);
          changed();
          this.render();
        };
        el.addEventListener('click', pick);
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            pick();
          }
        });
      });
    cards('route', (v) => (s.routeId = v));
    cards('mode', (v) => (s.mode = v as Settings['mode']));
    on<HTMLInputElement>('m-workout', 'change', async (el) => {
      const f = el.files?.[0];
      if (!f) return;
      this.workoutFile = { name: f.name, content: await f.text() };
      const n = this.root.querySelector('#m-wname');
      if (n) n.textContent = f.name;
    });
    // Profil.
    const num = (id: string, key: 'massKg' | 'ftpWatts' | 'heightCm' | 'aiRiders') =>
      on<HTMLInputElement>(id, 'change', (el) => {
        s[key] = Number(el.value);
        changed();
      });
    num('m-mass', 'massKg');
    num('m-ftp', 'ftpWatts');
    num('m-height', 'heightCm');
    num('m-ai', 'aiRiders');
    on<HTMLInputElement>('m-name', 'change', (el) => {
      s.name = el.value.trim().slice(0, 24) || 'Robert';
      changed();
    });
    on<HTMLInputElement>('m-jersey', 'input', (el) => {
      s.look = { ...s.look, jersey: el.value };
      changed();
    });
    on<HTMLInputElement>('m-bike', 'input', (el) => {
      s.look = { ...s.look, bike: el.value };
      changed();
    });
    // Réglages.
    on<HTMLSelectElement>('m-quality', 'change', (el) => {
      s.quality = el.value as Settings['quality'];
      localStorage.setItem('ar.quality', s.quality);
      changed();
    });
    on<HTMLSelectElement>('m-season', 'change', (el) => {
      s.season = el.value as Settings['season'];
      changed();
    });
    const range = (id: string, key: 'hour' | 'clouds' | 'rain' | 'fog' | 'trainerDifficulty', label?: string, fmt?: (v: number) => string) =>
      on<HTMLInputElement>(id, 'input', (el) => {
        s[key] = Number(el.value);
        const l = label ? this.root.querySelector(`#${label}`) : null;
        if (l && fmt) l.textContent = fmt(s[key]);
        changed();
      });
    range('m-hour', 'hour', 'm-hourv', (v) => `${v.toFixed(1)} h`);
    range('m-clouds', 'clouds');
    range('m-rain', 'rain');
    range('m-fog', 'fog');
    range('m-diff', 'trainerDifficulty', 'm-diffv', (v) => `${Math.round(v * 100)} %`);
    on<HTMLSelectElement>('m-lang', 'change', (el) => {
      s.lang = el.value as Settings['lang'];
      setLang(s.lang);
      changed();
      this.render();
    });
    on<HTMLSelectElement>('m-drive', 'change', (el) => {
      s.drivetrain = el.value as Settings['drivetrain'];
      changed();
    });
    on<HTMLSelectElement>('m-strava', 'change', (el) => {
      s.skipStrava = el.value === 'skip';
      changed();
    });
    on<HTMLSelectElement>('m-ailevel', 'change', (el) => {
      s.aiLevel = Number(el.value);
      changed();
    });
    on<HTMLSelectElement>('m-smooth', 'change', (el) => {
      s.smoothing3s = el.value === '1';
      changed();
    });
  }
}
