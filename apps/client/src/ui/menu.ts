import type { AvatarLook, CosmeticItem, RouteData } from '@allezrobert/shared';
import { COSMETICS, DEFAULT_BIKE, bikeSetupFor, levelProgress, type CosmeticSlot } from '@allezrobert/shared';
import { WORKOUT_LIBRARY } from '@allezrobert/physics';
import { t, setLang, getLang, type I18nKey } from '../i18n/index.ts';
import type { Settings } from './settings.ts';
import { saveSettings } from './settings.ts';
import { music } from '../audio/music.ts';
import { spotify, redirectUri } from '../audio/spotify.ts';
import { loadProgress, equipItem, SLOT_LABEL } from './garage.ts';
import { WORLD_LIST } from '../world/worlds.ts';
import type { GarageView } from './poster.ts';
import './menu.css';

/** Ce que l'écran d'appairage sait faire, quel que soit le transport (implémenté avec @allezrobert/devices). */
export interface DevicePanel {
  /** Appareils connus avec leur état lisible. */
  list(): Array<{ id: string; name: string; role: string; roleIds?: string[]; kinds?: string[]; simulated?: boolean; state: string; detail?: string; ok: boolean }>;
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

type Tab = 'ride' | 'garage' | 'devices' | 'profile' | 'settings';
type Role = Parameters<DevicePanel['pair']>[0];

const fr = () => getLang() === 'fr';

/** Pictogrammes (traits, couleur héritée). */
const svg = (d: string, size = 22) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  free: svg('<path d="M4 20 10 4M20 20 14 4M12 6v2M12 11v2M12 16v2"/>'),
  group: svg('<circle cx="8" cy="8" r="3"/><circle cx="16" cy="9" r="2.5"/><path d="M2.5 20c.6-3.4 2.8-5 5.5-5s4.9 1.6 5.5 5M13.5 15.2c.8-.5 1.6-.7 2.5-.7 2.4 0 4.3 1.4 4.8 4.5"/>'),
  race: svg('<path d="M5 21V4M5 4h12l-2 4 2 4H5"/>'),
  workout: svg('<path d="M4 20v-6M9 20V8M14 20v-9M19 20V5"/>'),
  ftpTest: svg('<path d="M4 16a8 8 0 1 1 16 0"/><path d="m12 16 4-6"/><circle cx="12" cy="16" r="1.2"/>'),
  open: svg('<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>'),
  trainer: svg('<circle cx="7" cy="15" r="4"/><path d="M7 15h7l3-7h2M13 8l1 7M3 21h18"/>'),
  power: svg('<path d="M13 2 5 14h6l-1 8 8-12h-6z"/>'),
  heartRate: svg('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/><path d="M7 12h3l1-2 2 4 1-2h3"/>'),
  shifter: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 4v3M12 17v3M4 12h3M17 12h3"/>'),
  fan: svg('<circle cx="12" cy="12" r="1.5"/><path d="M12 10.5C11 6 13 3 16 4s1 5-2.5 7M13.5 12.5c4.4 1 6.5 3.5 5 6s-5 .5-6.5-3M10.5 12c-4.5.2-7.3-1.7-6.6-4.5s4.6-1.6 6.4 1.9"/>'),
  music: svg('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>', 16),
  next: svg('<path d="m5 4 10 8-10 8zM19 5v14"/>', 14),
  prev: svg('<path d="M19 20 9 12l10-8zM5 19V5"/>', 14),
  play: svg('<path d="m7 4 13 8-13 8z"/>', 14),
  pause: svg('<path d="M7 4v16M17 4v16"/>', 14),
  list: svg('<path d="M4 6h12M4 12h12M4 18h8M18 15v6l4-3z"/>', 16),
  rotate: svg('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>', 16),
  explore: svg('<circle cx="12" cy="12" r="9"/><path d="m15.8 8.2-2.3 5.3-5.3 2.3 2.3-5.3z"/>', 20),
};

/** Gros plan du garage selon la catégorie choisie. */
const SLOT_VIEW: Record<CosmeticSlot, GarageView> = { jersey: '3q', helmet: 'front', bike: 'side', wheels: 'bike', socks: 'bike', glasses: 'front' };

/**
 * Menu principal façon jeu : barre d'onglets en haut (Rouler, Garage, Capteurs, Profil,
 * Réglages), lecteur de musique et compte à droite ; panneaux posés sur la scène 3D fixe.
 * Onglet Rouler : modes en tuiles, carte et profil de l'itinéraire, départ. Garage : aperçu 3D
 * du coureur (vues prédéfinies, rotation à la souris) piloté par onScene.
 */
export class MainMenu {
  private readonly root: HTMLElement;
  private readonly s: Settings;
  private readonly routes: RouteData[];
  private readonly devices: DevicePanel;
  private readonly cb: MenuCallbacks;
  private workoutFile: { name: string; content: string } | undefined;
  private tab: Tab = 'ride';
  private garageSlot: CosmeticSlot | 'colors' = 'jersey';
  private view: GarageView = '3q';
  private yaw = 0;
  private readonly onKey = (e: KeyboardEvent) => {
    if (!this.root.querySelector('.mm') || this.root.querySelector('.mm-modal')) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT') return;
    if (e.key === 'Escape' && this.tab !== 'ride') this.go('ride');
  };
  onSettingsChange?: (s: Settings) => void;
  /** Relance le tutoriel (onboarding) depuis le menu. */
  onTutorial?: () => void;
  /** « Explorer la carte » : survol libre du monde chargé, sans rouler (Échap pour revenir). */
  onExplore?: () => void;
  /** Cadrage 3D demandé par le menu : photo du groupe ou vue du garage (rotation en radians). */
  onScene?: (view: 'poster' | GarageView, yaw: number) => void;
  /** Aperçu d'un équipement (même verrouillé) sur le coureur du garage ; null : tenue équipée. */
  onPreviewLook?: (look: AvatarLook | null) => void;
  private previewId: string | null = null;
  /** Compte connecté (affiché dans le menu), connexion / déconnexion, synchro du profil. */
  account: { name: string; level: number } | null = null;
  onLogin?: () => void;
  onLogout?: () => void;
  /** Monde affiché et changement de monde (rechargement de la page). */
  worldId = 'chevreuse';
  openWorld = false;
  onWorld?: (id: string) => void;
  onSettingsSaved?: (s: Settings) => void;

  constructor(root: HTMLElement, settings: Settings, routes: RouteData[], devices: DevicePanel, cb: MenuCallbacks) {
    this.root = root;
    this.s = settings;
    this.routes = routes;
    this.devices = devices;
    this.cb = cb;
    if (!this.s.routeId || !routes.some((r) => r.id === this.s.routeId)) this.s.routeId = routes[0]?.id ?? '';
    devices.onChange(() => {
      if (this.tab === 'devices') this.renderDevices();
      this.renderStatus();
    });
  }

  show(tab: Tab = 'ride'): void {
    document.addEventListener('keydown', this.onKey);
    this.go(tab);
  }

  hide(): void {
    document.removeEventListener('keydown', this.onKey);
    this.root.innerHTML = '';
  }

  private go(tab: Tab): void {
    if (tab !== 'garage' && this.previewId) {
      this.previewId = null;
      this.onPreviewLook?.(null);
    }
    this.tab = tab;
    this.render();
    this.onScene?.(tab === 'garage' ? this.view : 'poster', tab === 'garage' ? this.yaw : 0);
  }

  /** Croix de fermeture d'un panneau (retour à l'onglet Rouler, comme Échap). */
  private closeBtn(): string {
    return `<button class="mm-close" data-tab="ride" aria-label="${fr() ? 'Fermer' : 'Close'}" title="${fr() ? 'Fermer (Échap)' : 'Close (Esc)'}">×</button>`;
  }

  /** Choix en boutons segmentés (remplace les listes déroulantes du système). */
  private seg(id: string, current: string, opts: Array<[string, string]>): string {
    return `<div class="mm-seg" id="${id}" data-value="${esc(current)}" role="radiogroup">${opts
      .map(([v, label]) => `<button type="button" role="radio" aria-checked="${v === current}" class="${v === current ? 'on' : ''}" data-v="${esc(v)}">${esc(label)}</button>`)
      .join('')}</div>`;
  }

  /** Branche les boutons segmentés : valeur lue comme un <select> (propriété value + événement change). */
  private bindSegs(scope: ParentNode): void {
    scope.querySelectorAll<HTMLElement>('.mm-seg').forEach((box) => {
      Object.defineProperty(box, 'value', { configurable: true, get: () => box.dataset.value ?? '' });
      box.querySelectorAll<HTMLButtonElement>('[data-v]').forEach((b) =>
        b.addEventListener('click', () => {
          box.dataset.value = b.dataset.v ?? '';
          box.querySelectorAll('[data-v]').forEach((x) => {
            x.classList.toggle('on', x === b);
            x.setAttribute('aria-checked', String(x === b));
          });
          box.dispatchEvent(new Event('change'));
        }),
      );
    });
  }

  /** Tenue du coureur avec un équipement à couleur appliqué (aperçu). */
  private lookWith(item: CosmeticItem): AvatarLook {
    const look = { ...this.s.look };
    if (item.color) {
      if (item.slot === 'jersey') look.jersey = item.color;
      if (item.slot === 'helmet') look.helmet = item.color;
      if (item.slot === 'bike') look.bike = item.color;
    }
    return look;
  }

  private opt<T extends string>(value: T, current: string, label: string): string {
    return `<option value="${value}" ${value === current ? 'selected' : ''}>${esc(label)}</option>`;
  }

  private routeName(r: RouteData): string {
    return getLang() === 'en' && r.nameEn ? r.nameEn : r.name;
  }

  private km(m: number): string {
    return (m / 1000).toFixed(1).replace('.', fr() ? ',' : '.');
  }

  /** Durée indicative à allure d'endurance (≈ 26 km/h à plat, plus 1 h par 700 m de D+). */
  private eta(r: RouteData): string {
    const h = r.lengthM / 26000 + r.elevationGainM / 700;
    const hh = Math.floor(h);
    const mm = Math.round((h - hh) * 60);
    return hh ? `${hh} h ${String(mm).padStart(2, '0')}` : `${mm} min`;
  }

  private modes(): Array<[Settings['mode'], I18nKey, string]> {
    return fr()
      ? [
          ['free', 'free', 'Rouler à son rythme, avec ou sans coureurs IA.'],
          ['group', 'group', 'Rouler à plusieurs : le groupe reste ensemble.'],
          ['race', 'race', 'Course en ligne, classement à l’arrivée.'],
          ['workout', 'workout', 'Séance structurée en mode ERG : séances intégrées ou fichier .zwo, .erg, .mrc.'],
          ['ftpTest', 'ftpTest', 'Test de 20 minutes pour estimer ta FTP.'],
          ...(this.openWorld ? ([['open', 'open', 'Toutes les routes du monde : ← / → pour choisir ta direction à chaque carrefour, U pour faire demi-tour.']] as Array<[Settings['mode'], I18nKey, string]>) : []),
        ]
      : [
          ['free', 'free', 'Ride at your own pace, with or without AI riders.'],
          ['group', 'group', 'Ride together: the group stays as one.'],
          ['race', 'race', 'Online race, results at the finish.'],
          ['workout', 'workout', 'Structured session in ERG mode: built-in workouts or a .zwo, .erg, .mrc file.'],
          ['ftpTest', 'ftpTest', '20-minute test to estimate your FTP.'],
          ...(this.openWorld ? ([['open', 'open', 'Every road of the world: ← / → to pick your way at each junction, U to turn around.']] as Array<[Settings['mode'], I18nKey, string]>) : []),
        ];
  }

  // ————————————————————————————————————————————— Cadre commun

  private render(): void {
    const L = fr();
    const tabs: Array<[Tab, string]> = [
      ['ride', t('ride')],
      ['garage', 'Garage'],
      ['devices', t('devices')],
      ['profile', t('profile')],
      ['settings', t('settings')],
    ];
    const p = loadProgress();
    const lp = levelProgress(p.xp);
    const level = this.account?.level ?? lp.level;
    const name = this.account?.name ?? this.s.name;
    const initials = name
      .split(/\s+/)
      .map((w) => w[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase();
    const body: Record<Tab, () => string> = {
      ride: () => this.rideHtml(),
      garage: () => this.garageHtml(),
      devices: () =>
        `<section class="mm-panel mm-center mm-wide">${this.closeBtn()}<header class="mm-head"><h2>${t('devices')}</h2><p>${L ? 'Associe ton home trainer et tes capteurs. Une seule appli à la fois par capteur Bluetooth.' : 'Pair your trainer and sensors. One app at a time per Bluetooth sensor.'}</p></header><div id="m-devices"></div></section>`,
      profile: () => this.profileHtml(),
      settings: () => this.settingsHtml(),
    };
    this.root.innerHTML = `<div class="mm mm-tab-${this.tab}">
      <header class="mm-top">
        <div class="mm-brand">Allez <em>Robert</em> !</div>
        <nav class="mm-tabs">${tabs.map(([id, label]) => `<button class="mm-tab ${id === this.tab ? 'on' : ''}" data-tab="${id}">${esc(label)}</button>`).join('')}
          <button class="mm-tab subtle" id="m-tuto">${L ? 'Tutoriel' : 'Tutorial'}</button></nav>
        <div class="mm-right">
          <div class="mm-music" id="m-music"></div>
          <div class="mm-account">
            <div class="mm-avatar" style="background:${this.s.look.jersey}">${esc(initials || 'R')}</div>
            <div class="mm-who"><b>${esc(name)}</b>
              <span>${L ? 'Niveau' : 'Level'} ${level}<i class="mm-xp"><i style="width:${(lp.progress * 100).toFixed(0)}%"></i></i></span></div>
            ${this.account ? `<button class="mm-link" id="m-logout">${L ? 'Déconnexion' : 'Sign out'}</button>` : `<button class="mm-link" id="m-login">${L ? 'Se connecter' : 'Sign in'}</button>`}
          </div>
        </div>
      </header>
      ${body[this.tab]()}
      <footer class="mm-foot">
        <div class="mm-status" id="m-status"></div>
        ${this.tab === 'ride' ? `<button id="m-start" class="mm-go">${t('ride')} <span>→</span></button>` : `<button class="mm-go ghost" data-tab="ride">← ${t('ride')}</button>`}
      </footer>
    </div>`;
    if (this.tab === 'devices') this.renderDevices();
    this.renderStatus();
    this.renderMusic();
    this.bind();
  }

  /** Pied de page : état des capteurs (cliquable vers l'onglet Capteurs) et raccourcis. */
  private renderStatus(): void {
    const box = this.root.querySelector('#m-status');
    if (!box) return;
    const real = this.devices.list().filter((d) => d.ok && !d.simulated);
    const sim = this.devices.simulatorOn() && !real.length;
    const chips = real.length
      ? real.map((d) => `<span class="mm-chip ok">${esc(d.name)}</span>`).join('')
      : sim
        ? `<span class="mm-chip sim">${fr() ? 'Simulateur (sans matériel)' : 'Simulator (no hardware)'}</span>`
        : `<span class="mm-chip warn">${fr() ? 'Aucun capteur' : 'No sensor'}</span>`;
    box.innerHTML = `<button class="mm-chips" title="${t('devices')}">${chips}</button><span class="mm-keys">${t('shortcuts')}</span>`;
    box.querySelector('.mm-chips')?.addEventListener('click', () => this.go('devices'));
  }

  // ————————————————————————————————————————————— Rouler

  private rideHtml(): string {
    const s = this.s;
    const L = fr();
    const r = this.routes.find((x) => x.id === s.routeId) ?? this.routes[0];
    const mode = this.modes().find(([m]) => m === s.mode);
    return `<section class="mm-panel mm-left">
      <header class="mm-head"><h2>${L ? 'Que veux-tu faire ?' : 'What do you want to do?'}</h2></header>
      <div class="mm-modes">${this.modes()
        .map(([v, k]) => `<button class="mm-mode ${v === s.mode ? 'on' : ''}" data-mode="${v}">${ICON[v]}<span>${esc(t(k))}</span></button>`)
        .join('')}</div>
      <p class="mm-hint">${mode ? esc(mode[2]) : ''}</p>
      ${
        s.mode === 'group' || s.mode === 'race'
          ? `<input id="m-invite" class="mm-input" placeholder="${L ? 'Code d’invitation (facultatif)' : 'Invite code (optional)'}" />`
          : s.mode === 'workout'
            ? `<div class="mm-routes mm-presets">${WORKOUT_LIBRARY.map(
                (w) =>
                  `<button class="mm-route ${!this.workoutFile && w.id === s.workoutPreset ? 'on' : ''}" data-preset="${w.id}"><b>${esc(w.name[getLang()])}</b><span>${esc(w.description[getLang()])}</span></button>`,
              ).join('')}</div>
              <label class="mm-file">${L ? 'Ou importer une séance' : 'Or import a workout'} (.zwo / .erg / .mrc)<input id="m-workout" type="file" accept=".zwo,.erg,.mrc" hidden /><span id="m-wname">${this.workoutFile ? esc(this.workoutFile.name) : ''}</span></label>`
            : ''
      }
      ${r ? this.routeCard(r) : ''}
      ${this.onExplore ? `<button id="m-explore" class="mm-explore">${ICON.explore}<span><b>${L ? 'Explorer la carte' : 'Explore the map'}</b><small>${L ? 'Caméra libre, sans rouler · Échap pour revenir' : 'Free camera, no riding · Esc to come back'}</small></span></button>` : ''}
      <h3>${L ? 'Monde' : 'World'}</h3>
      <div class="mm-routes mm-worlds">${WORLD_LIST.map(
        (w) => `<button class="mm-route ${w.id === this.worldId ? 'on' : ''}" data-world="${esc(w.id)}"><b>${esc(w.name[getLang()])}</b><span>${esc(w.hint[getLang()])}</span></button>`,
      ).join('')}</div>
      <h3>${L ? 'Itinéraires' : 'Routes'}</h3>
      <div class="mm-routes">${this.routes
        .map(
          (x) => `<button class="mm-route ${x.id === s.routeId ? 'on' : ''}" data-route="${esc(x.id)}">
            <b>${esc(this.routeName(x))}</b><span>${this.km(x.lengthM)} km · ${Math.round(x.elevationGainM)} m D+</span></button>`,
        )
        .join('')}</div>
      <div class="mm-conds"><span>${t(s.season)} · ${s.hour.toFixed(1).replace('.', L ? ',' : '.')} h · ${L ? 'nuages' : 'clouds'} ${Math.round(s.clouds * 100)} %${s.rain > 0.05 ? ` · ${L ? 'pluie' : 'rain'}` : ''}</span><button class="mm-link" data-tab="settings">${L ? 'Modifier' : 'Change'}</button></div>
    </section>
    <div class="mm-hero"><h1>Allez <em>Robert</em> !</h1><p>${L ? 'Rouler ensemble, chacun chez soi.' : 'Ride together, each from home.'}</p></div>`;
  }

  /** Carte de l'itinéraire (tracé coloré selon la pente) et profil d'altitude. */
  private routeCard(r: RouteData): string {
    const step = Math.max(1, Math.floor(r.points.length / 260));
    const sel = r.points.filter((_, i) => i % step === 0);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of sel) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const W = 360;
    const H = 170;
    const k = Math.min((W - 24) / (maxX - minX || 1), (H - 24) / (maxZ - minZ || 1));
    const ox = (W - (maxX - minX) * k) / 2;
    const oz = (H - (maxZ - minZ) * k) / 2;
    const X = (x: number) => (ox + (x - minX) * k).toFixed(1);
    const Z = (z: number) => (oz + (z - minZ) * k).toFixed(1);
    const gradeColor = (g: number) => (g > 6 ? '#ef4444' : g > 3 ? '#f97316' : g > 1 ? '#facc15' : g < -2 ? '#60a5fa' : '#e5e7eb');
    let lines = '';
    for (let i = 1; i < sel.length; i++) {
      const a = sel[i - 1] as (typeof sel)[number];
      const b = sel[i] as (typeof sel)[number];
      const g = ((b.y - a.y) / Math.max(1, b.d - a.d)) * 100;
      lines += `<line x1="${X(a.x)}" y1="${Z(a.z)}" x2="${X(b.x)}" y2="${Z(b.z)}" stroke="${gradeColor(g)}"/>`;
    }
    const first = sel[0];
    const PW = 360;
    const PH = 56;
    const ys = sel.map((p) => p.y);
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    const len = r.lengthM || 1;
    const px = (d: number) => (d / len) * PW;
    const py = (y: number) => (PH - 4 - ((y - lo) / (hi - lo || 1)) * (PH - 10)).toFixed(1);
    const area = `M0,${PH} ${sel.map((p) => `L${px(p.d).toFixed(1)},${py(p.y)}`).join(' ')} L${PW},${PH} Z`;
    return `<div class="mm-routecard">
      <div class="mm-rc-title">${esc(this.routeName(r))}</div>
      <svg class="mm-map" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <g stroke-width="3.2" stroke-linecap="round">${lines}</g>
        ${first ? `<circle cx="${X(first.x)}" cy="${Z(first.z)}" r="6" fill="var(--ar-accent)" stroke="#0a0e16" stroke-width="2.5"/>` : ''}
      </svg>
      <div class="mm-stats">
        <div><b>${this.km(r.lengthM)}</b><span>km</span></div>
        <div><b>${Math.round(r.elevationGainM)}</b><span>m D+</span></div>
        <div><b>${r.maxGradePct !== undefined ? Math.round(r.maxGradePct) : '—'}</b><span>% max</span></div>
        <div><b>${this.eta(r)}</b><span>${fr() ? 'durée env.' : 'est. time'}</span></div>
      </div>
      <svg class="mm-profile" viewBox="0 0 ${PW} ${PH}" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="mm-prof" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd23f" stop-opacity=".55"/><stop offset="1" stop-color="#ffd23f" stop-opacity=".04"/></linearGradient></defs>
        ${r.segments.map((g) => `<rect x="${px(g.startM).toFixed(1)}" y="0" width="${Math.max(1, px(g.endM) - px(g.startM)).toFixed(1)}" height="${PH}" fill="${g.kind === 'kom' ? '#ef4444' : '#22c55e'}" opacity=".14"/>`).join('')}
        <path d="${area}" fill="url(#mm-prof)" stroke="#ffd23f" stroke-width="1.2" vector-effect="non-scaling-stroke"/>
      </svg>
    </div>`;
  }

  // ————————————————————————————————————————————— Garage

  private garageHtml(): string {
    const L = fr();
    const lang = getLang();
    const p = loadProgress();
    const lp = levelProgress(p.xp);
    const slots = [...new Set(COSMETICS.map((c) => c.slot))];
    const views: Array<[GarageView, string]> = [
      ['3q', '3/4'],
      ['side', L ? 'Profil' : 'Side'],
      ['front', L ? 'Face' : 'Front'],
      ['back', L ? 'Dos' : 'Back'],
      ['bike', L ? 'Vélo' : 'Bike'],
      ['cockpit', 'Cockpit'],
    ];
    const items =
      this.garageSlot === 'colors'
        ? `<div class="mm-colors">
            <label class="field">${L ? 'Maillot' : 'Jersey'}<input id="m-jersey" type="color" value="${this.s.look.jersey}" /></label>
            <label class="field">${L ? 'Bande du maillot' : 'Jersey stripe'}<input id="m-accent" type="color" value="${this.s.look.jerseyAccent}" /></label>
            <label class="field">${L ? 'Casque' : 'Helmet'}<input id="m-helmet" type="color" value="${this.s.look.helmet}" /></label>
            <label class="field">${L ? 'Vélo' : 'Bike'}<input id="m-bike" type="color" value="${this.s.look.bike}" /></label>
            <label class="field">${L ? 'Peau' : 'Skin'}<input id="m-skin" type="color" value="${this.s.look.skin}" /></label>
            <label class="field">${L ? 'Cheveux' : 'Hair'}<input id="m-hair" type="color" value="${this.s.look.hair}" /></label>
          </div>`
        : `<div class="mm-items">${COSMETICS.filter((c) => c.slot === this.garageSlot)
            .map((c) => {
              const locked = c.level > lp.level;
              const on = p.equipped[c.slot] === c.id;
              const prev = this.previewId === c.id;
              return `<button class="mm-item ${on ? 'on' : ''} ${locked ? 'locked' : ''} ${prev ? 'preview' : ''}" data-item="${c.id}" title="${locked ? (L ? 'Cliquer pour l’essayer' : 'Click to try it on') : ''}">
                <i style="background:${c.color ?? '#7a8594'}"></i><b>${esc(c.name[lang])}</b>
                ${c.effect ? `<em class="mm-effect">${esc(c.effect[lang])}</em>` : ''}
                <span>${prev ? `👁 ${L ? 'Aperçu' : 'Preview'} · 🔒 ${L ? 'niveau' : 'level'} ${c.level}` : locked ? `🔒 ${L ? 'niveau' : 'level'} ${c.level}` : on ? (L ? 'Équipé' : 'Equipped') : L ? 'Disponible' : 'Available'}</span></button>`;
            })
            .join('')}</div>`;
    return `<div class="mm-dragzone" id="m-dragzone"></div>
      <div class="mm-views">${views.map(([v, label]) => `<button class="mm-view ${v === this.view ? 'on' : ''}" data-view="${v}">${label}</button>`).join('')}
        <span class="mm-drag">${ICON.rotate} ${L ? 'Glisser pour tourner' : 'Drag to rotate'}</span></div>
      <section class="mm-panel mm-side">${this.closeBtn()}
        <header class="mm-head"><h2>${L ? 'Ton coureur' : 'Your rider'}</h2>
          <div class="mm-level"><b>${L ? 'Niveau' : 'Level'} ${lp.level}</b><span>${p.xp} XP${lp.nextLevelXp ? ` / ${lp.nextLevelXp}` : ''}</span><i class="mm-xp big"><i style="width:${(lp.progress * 100).toFixed(1)}%"></i></i></div></header>
        <div class="mm-slots">${slots.map((sl) => `<button class="mm-slot ${sl === this.garageSlot ? 'on' : ''}" data-slot="${sl}">${SLOT_LABEL[sl][lang]}</button>`).join('')}
          <button class="mm-slot ${this.garageSlot === 'colors' ? 'on' : ''}" data-slot="colors">${L ? 'Couleurs' : 'Colours'}</button></div>
        ${items}
        ${this.bikeSummary()}
        <p class="mm-hint">${L ? 'Les équipements se débloquent en roulant (XP par kilomètre et par mètre de dénivelé). Clique un équipement verrouillé pour l’essayer.' : 'Gear unlocks as you ride (XP per kilometre and metre climbed). Click locked gear to try it on.'}</p>
      </section>`;
  }

  /** Vélo réellement roulé avec l'équipement porté : masse, traînée, pneus. */
  private bikeSummary(): string {
    const L = fr();
    const b = bikeSetupFor(loadProgress().equipped);
    const drag = Math.round((b.cda / DEFAULT_BIKE.cda - 1) * 1000) / 10;
    const num = (v: number, d = 1) => v.toFixed(d).replace('.', L ? ',' : '.');
    return `<p class="mm-hint mm-bikephys">${L ? 'En selle' : 'Riding'} : <b>${num(b.massKg)} kg</b> · ${L ? 'traînée' : 'drag'} <b>${drag > 0 ? '+' : ''}${num(drag)} %</b> · ${
      b.tyre === 'gravel' ? (L ? 'pneus gravel' : 'gravel tyres') : b.tyre === 'mtb' ? (L ? 'pneus VTT' : 'MTB tyres') : L ? 'pneus route' : 'road tyres'
    }</p>`;
  }

  // ————————————————————————————————————————————— Profil et réglages

  private profileHtml(): string {
    const s = this.s;
    const L = fr();
    const wkg = s.ftpWatts / s.massKg;
    return `<section class="mm-panel mm-center">${this.closeBtn()}
      <header class="mm-head"><h2>${t('profile')}</h2><p>${L ? 'Le poids et la taille servent à la physique (montées, prise au vent) ; la FTP règle les séances et les zones.' : 'Weight and height drive the physics (climbs, drag); FTP sets workouts and zones.'}</p></header>
      <div class="mm-bigstats"><div><b>${wkg.toFixed(1).replace('.', L ? ',' : '.')}</b><span>W/kg</span></div><div><b>${Math.round(s.ftpWatts)}</b><span>W FTP</span></div><div><b>${s.massKg}</b><span>kg</span></div></div>
      <div class="grid2b">
        <label class="field">${t('name')}<input id="m-name" value="${esc(s.name)}" /></label>
        <label class="field">${t('weight')}<input id="m-mass" type="number" min="30" max="200" step="0.5" value="${s.massKg}" /></label>
        <label class="field">${t('height')}<input id="m-height" type="number" min="120" max="220" value="${s.heightCm}" /></label>
        <label class="field">${t('ftp')}<input id="m-ftp" type="number" min="50" max="600" value="${s.ftpWatts}" /></label>
      </div>
    </section>`;
  }

  private settingsHtml(): string {
    const s = this.s;
    const L = fr();
    return `<section class="mm-panel mm-center mm-wide">${this.closeBtn()}
      <header class="mm-head"><h2>${t('settings')}</h2></header>
      <h3>${L ? 'Graphismes et conditions de la sortie' : 'Graphics and ride conditions'}</h3>
      <div class="grid3">
        <div class="field">${t('quality')}${this.seg('m-quality', s.quality, (['low', 'medium', 'high', 'ultra'] as const).map((q) => [q, t(q)]))}</div>
        <div class="field">${t('season')}${this.seg('m-season', s.season, (['spring', 'summer', 'autumn', 'winter'] as const).map((q) => [q, t(q)]))}</div>
        <label class="field">${t('hour')} <span id="m-hourv">${s.hour.toFixed(1)} h</span><input id="m-hour" type="range" min="5" max="22" step="0.25" value="${s.hour}" /></label>
        <label class="field">${L ? 'Nuages' : 'Clouds'}<input id="m-clouds" type="range" min="0" max="1" step="0.05" value="${s.clouds}" /></label>
        <label class="field">${L ? 'Pluie' : 'Rain'}<input id="m-rain" type="range" min="0" max="1" step="0.05" value="${s.rain}" /></label>
        <label class="field">${L ? 'Brouillard' : 'Fog'}<input id="m-fog" type="range" min="0" max="1" step="0.05" value="${s.fog}" /></label>
      </div>
      <h3>${L ? 'Home trainer' : 'Smart trainer'}</h3>
      <div class="grid3">
        <label class="field">${t('difficulty')} <span id="m-diffv">${Math.round(s.trainerDifficulty * 100)} %</span><input id="m-diff" type="range" min="0" max="1" step="0.05" value="${s.trainerDifficulty}" /></label>
        <label class="field" title="${L ? '100 % : masse et roues réelles. Plus bas, la vitesse suit plus vite les relances (volant du home trainer).' : '100%: real mass and wheels. Lower: speed follows accelerations faster (trainer flywheel).'}">${L ? 'Inertie' : 'Inertia'} <span id="m-inertiav">${Math.round(s.inertia * 100)} %</span><input id="m-inertia" type="range" min="0.6" max="1" step="0.05" value="${s.inertia}" /></label>
        <div class="field">Transmission${this.seg('m-drive', s.drivetrain, [
          ['cog', L ? 'Vitesses virtuelles' : 'Virtual shifting'],
          ['cassette', L ? 'Cassette réelle' : 'Real cassette'],
        ])}</div>
        <div class="field">${L ? 'Lissage puissance' : 'Power smoothing'}${this.seg('m-smooth', s.smoothing3s ? '1' : '0', [
          ['0', L ? 'Non' : 'Off'],
          ['1', '3 s'],
        ])}</div>
      </div>
      <h3>${L ? 'Coureurs IA' : 'AI riders'}</h3>
      <div class="grid3">
        <label class="field">${L ? 'Nombre' : 'Count'}<input id="m-ai" type="number" min="0" max="19" value="${s.aiRiders}" /></label>
        <div class="field">${L ? 'Niveau' : 'Level'}${this.seg('m-ailevel', String(s.aiLevel), [
          ['0.8', '80 % FTP'],
          ['1', '100 % FTP'],
          ['1.15', '115 % FTP'],
        ])}</div>
      </div>
      <h3>${L ? 'Musique' : 'Music'}</h3>
      <div id="m-music-settings" class="mm-musicset"></div>
      <h3>${L ? 'Langue et envoi des sorties' : 'Language and ride upload'}</h3>
      <div class="grid3">
        <div class="field">${t('language')}${this.seg('m-lang', s.lang, [
          ['fr', 'Français'],
          ['en', 'English'],
        ])}</div>
        <div class="field">Strava${this.seg('m-strava', s.skipStrava ? 'skip' : 'send', [
          ['skip', L ? 'Ne pas envoyer' : 'Don’t upload'],
          ['send', L ? 'Envoyer' : 'Upload'],
        ])}</div>
      </div>
    </section>`;
  }

  // ————————————————————————————————————————————— Musique et Spotify

  /** Lecteur compact de la barre du haut, et section complète dans les réglages. */
  renderMusic(): void {
    const L = fr();
    const top = this.root.querySelector('#m-music');
    if (top && spotify.connected) {
      // Spotify piloté depuis le jeu : lecture ici, titre, commandes, playlists, volume.
      top.innerHTML = `<img class="mm-cover" id="sp-cover" alt="" hidden />
        <span class="mm-now" id="mu-now"><i class="sp">●</i> Spotify</span>
        <button class="mm-ico" id="sp-prev" title="${L ? 'Précédent' : 'Previous'}">${ICON.prev}</button>
        <button class="mm-ico on" id="sp-play" title="${L ? 'Lecture / pause (B)' : 'Play / pause (B)'}">${ICON.play}</button>
        <button class="mm-ico" id="sp-next" title="${L ? 'Suivant (N)' : 'Next (N)'}">${ICON.next}</button>
        <button class="mm-ico" id="sp-lists" title="${L ? 'Mes playlists' : 'My playlists'}">${ICON.list}</button>
        ${
          spotify.canPlayHere
            ? `<button class="mm-spotify" id="sp-here" title="${L ? 'Faire jouer Spotify par le jeu' : 'Play Spotify in the game'}">${L ? 'Écouter ici' : 'Play here'}</button>`
            : `<button class="mm-spotify" id="sp-relog" title="${L ? 'Une reconnexion autorise la lecture dans le jeu' : 'Reconnect once to allow in-game playback'}">${L ? 'Jouer ici' : 'Play here'}</button>`
        }
        <div class="mm-pop" id="sp-pop" hidden></div>`;
      const later = () => setTimeout(() => void this.refreshNowPlaying(), 700);
      top.querySelector('#sp-prev')?.addEventListener('click', () => void spotify.previous().then(later));
      // Lecture : dans le jeu dès que c'est autorisé (sinon l'appareil actif, ex. le téléphone).
      top.querySelector('#sp-play')?.addEventListener('click', () => {
        void spotify.toggleSmart().then(later);
      });
      top.querySelector('#sp-next')?.addEventListener('click', () => void spotify.next().then(later));
      top.querySelector('#sp-relog')?.addEventListener('click', () => void spotify.login());
      top.querySelector('#sp-here')?.addEventListener('click', () => {
        void spotify.playHere().then((ok) => {
          if (!ok) this.spotifyError();
          later();
        });
      });
      top.querySelector('#sp-lists')?.addEventListener('click', () => void this.spotifyPlaylists());
      void this.refreshNowPlaying();
    } else if (top) {
      const cur = music.enabled && music.current ? esc(music.current.title) : L ? 'Musique coupée' : 'Music off';
      top.innerHTML = `<button class="mm-ico ${music.enabled ? 'on' : ''}" id="mu-toggle" title="${L ? 'Musique marche / arrêt (B)' : 'Music on / off (B)'}">${ICON.music}</button>
        <span class="mm-now" id="mu-now">${cur}</span>
        <button class="mm-ico" id="mu-next" title="${L ? 'Morceau suivant (N)' : 'Next track (N)'}">${ICON.next}</button>
        <button class="mm-spotify" id="sp-login" title="${L ? 'Connecter ton compte Spotify' : 'Connect your Spotify account'}"><i class="sp">●</i> Spotify</button>`;
      top.querySelector('#mu-toggle')?.addEventListener('click', () => {
        music.toggle();
        this.renderMusic();
      });
      top.querySelector('#mu-next')?.addEventListener('click', () => music.next());
      top.querySelector('#sp-login')?.addEventListener('click', () => this.spotifyConnect());
    }
    const set = this.root.querySelector('#m-music-settings');
    if (set) {
      set.innerHTML = `<button class="btn small ${music.enabled ? 'on' : ''}" id="mu-toggle2">♪ ${L ? 'Musique du jeu' : 'Game music'} : ${music.enabled ? (L ? 'activée' : 'on') : L ? 'coupée' : 'off'}</button>
        <label class="mm-vol">Volume<input id="mu-vol" type="range" min="0" max="1" step="0.05" value="${music.volume}" /></label>
        ${spotify.connected ? `<button class="btn small" id="sp-logout">${L ? 'Déconnecter Spotify' : 'Disconnect Spotify'}</button>` : `<button class="btn small mm-spotify" id="sp-login2"><i class="sp">●</i> ${L ? 'Connecter Spotify' : 'Connect Spotify'}</button>`}`;
      set.querySelector('#mu-toggle2')?.addEventListener('click', () => {
        music.toggle();
        this.renderMusic();
      });
      set.querySelector('#mu-vol')?.addEventListener('input', (e) => music.setVolume(Number((e.target as HTMLInputElement).value)));
      set.querySelector('#sp-login2')?.addEventListener('click', () => this.spotifyConnect());
      set.querySelector('#sp-logout')?.addEventListener('click', () => {
        spotify.logout();
        this.renderMusic();
      });
    }
  }

  /** Titre Spotify affiché (appelé aussi par le suivi périodique). */
  async refreshNowPlaying(): Promise<void> {
    if (!spotify.connected) return;
    const el = this.root.querySelector('#mu-now');
    if (!el) return;
    const np = await spotify.nowPlaying();
    el.innerHTML = np ? `${esc(np.title)} <span>— ${esc(np.artist)}</span>` : `<i class="sp">●</i> ${fr() ? 'Spotify : rien en lecture' : 'Spotify: nothing playing'}`;
    el.setAttribute('title', np ? `${np.title} — ${np.artist}` : '');
    const cover = this.root.querySelector<HTMLImageElement>('#sp-cover');
    if (cover) {
      cover.hidden = !np?.image;
      if (np?.image) cover.src = np.image;
    }
    const play = this.root.querySelector('#sp-play');
    if (play) play.innerHTML = np?.isPlaying ? ICON.pause : ICON.play;
    const here = this.root.querySelector<HTMLElement>('#sp-here');
    if (here) {
      const on = np?.isPlaying ? await spotify.playingHere() : false;
      here.classList.toggle('on', on);
      here.textContent = on ? (fr() ? '♪ Dans le jeu' : '♪ In game') : fr() ? 'Écouter ici' : 'Play here';
    }
  }

  private spotifyError(): void {
    const msg = spotify.playerError || (fr() ? 'Lecture impossible dans le jeu.' : 'Cannot play in the game.');
    const el = this.root.querySelector('#mu-now');
    if (el) el.innerHTML = `<span class="warn-text">${esc(msg)}</span>`;
  }

  /** Liste des playlists du compte : un clic la lance dans le jeu. */
  private async spotifyPlaylists(): Promise<void> {
    const pop = this.root.querySelector<HTMLElement>('#sp-pop');
    if (!pop) return;
    if (!pop.hidden) {
      pop.hidden = true;
      return;
    }
    const L = fr();
    pop.hidden = false;
    pop.innerHTML = `<div class="mm-pop-head">${L ? 'Mes playlists' : 'My playlists'}</div><div class="mm-hint">${L ? 'Chargement…' : 'Loading…'}</div>`;
    const lists = await spotify.playlists();
    pop.innerHTML = `<div class="mm-pop-head">${L ? 'Mes playlists' : 'My playlists'}
        <label class="mm-vol">Volume<input id="sp-vol" type="range" min="0" max="1" step="0.05" value="0.7" /></label></div>
      <div class="mm-pop-list">${
        lists.length
          ? lists.map((p) => `<button class="mm-pl" data-uri="${esc(p.uri)}">${p.image ? `<img src="${esc(p.image)}" alt="" />` : '<i></i>'}<b>${esc(p.name)}</b><span>${p.tracks}</span></button>`).join('')
          : `<p class="mm-hint">${spotify.canPlayHere ? (L ? 'Aucune playlist.' : 'No playlists.') : L ? 'Clique « Jouer ici » (reconnexion) pour voir tes playlists.' : 'Click “Play here” (reconnect) to see your playlists.'}</p>`
      }</div>`;
    pop.querySelector('#sp-vol')?.addEventListener('input', (e) => spotify.setHereVolume(Number((e.target as HTMLInputElement).value)));
    pop.querySelectorAll<HTMLElement>('[data-uri]').forEach((b) =>
      b.addEventListener('click', () => {
        pop.hidden = true;
        void spotify.playContext(b.dataset.uri as string).then((ok) => {
          if (!ok) this.spotifyError();
          setTimeout(() => void this.refreshNowPlaying(), 900);
        });
      }),
    );
  }

  /** Connexion Spotify ; la première fois, assistant pour déclarer l'application (identifiant client). */
  private spotifyConnect(): void {
    if (spotify.available) {
      void spotify.login();
      return;
    }
    const L = fr();
    const uri = redirectUri();
    const local = location.hostname === 'localhost';
    const dlg = document.createElement('div');
    dlg.className = 'mm-modal';
    dlg.innerHTML = `<div class="mm-dialog">
      <h2><i class="sp">●</i> ${L ? 'Connecter Spotify' : 'Connect Spotify'}</h2>
      <p>${L ? 'Une seule fois : Spotify demande que le jeu soit déclaré comme « application » sur ton compte développeur (gratuit, 2 minutes).' : 'One time only: Spotify needs the game declared as an “app” on your developer account (free, 2 minutes).'}</p>
      <ol>
        <li>${L ? 'Ouvre' : 'Open'} <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">developer.spotify.com/dashboard</a> ${L ? 'et clique « Create app ».' : 'and click “Create app”.'}</li>
        <li>${L ? 'Nom : « Allez Robert » ; API : coche « Web API ».' : 'Name: “Allez Robert”; API: tick “Web API”.'}</li>
        <li>${L ? 'Redirect URI, à copier exactement (avec le « / » final) :' : 'Redirect URI, copy exactly (with the trailing “/”):'} <code>${esc(uri)}</code> <button class="mm-link" id="sp-copy">${L ? 'Copier' : 'Copy'}</button></li>
        <li>${L ? 'Enregistre, puis colle ici le « Client ID » :' : 'Save, then paste the “Client ID” here:'}</li>
      </ol>
      <input id="sp-id" class="mm-input" placeholder="Client ID" autocomplete="off" spellcheck="false" />
      ${local ? `<p class="mm-hint">${L ? 'Spotify refuse « localhost » : à la connexion, le jeu passe tout seul à l’adresse 127.0.0.1 (garde-la ensuite).' : 'Spotify rejects “localhost”: on sign-in the game switches to 127.0.0.1 by itself (keep using it afterwards).'}</p>` : ''}
      <p class="mm-hint">${L ? 'La musique sort de ton appli Spotify (ordinateur ou téléphone) ; lecture / pause et morceau suivant demandent un compte Premium.' : 'Music plays from your Spotify app (computer or phone); play / pause and next need Premium.'}</p>
      <div class="mm-dialog-foot"><button class="btn" id="sp-cancel">${L ? 'Annuler' : 'Cancel'}</button><button class="btn primary" id="sp-ok">${L ? 'Se connecter à Spotify' : 'Sign in to Spotify'}</button></div>
    </div>`;
    this.root.appendChild(dlg);
    const close = () => dlg.remove();
    dlg.querySelector('#sp-cancel')?.addEventListener('click', close);
    dlg.addEventListener('click', (e) => e.target === dlg && close());
    dlg.addEventListener('keydown', (e) => e.key === 'Escape' && close());
    dlg.querySelector('#sp-copy')?.addEventListener('click', () => void navigator.clipboard?.writeText(uri));
    dlg.querySelector('#sp-ok')?.addEventListener('click', () => {
      const input = dlg.querySelector('#sp-id') as HTMLInputElement;
      if (!spotify.setClientId(input.value)) {
        input.classList.add('bad');
        input.focus();
        return;
      }
      void spotify.login();
    });
    (dlg.querySelector('#sp-id') as HTMLInputElement).focus();
  }

  // ————————————————————————————————————————————— Capteurs

  private renderDevices(): void {
    const box = this.root.querySelector('#m-devices');
    if (!box) return;
    const L = fr();
    const list = this.devices.list();
    const transports = this.devices.transports();
    const roles: Array<[Role, I18nKey, string]> = [
      ['trainer', 'trainer', L ? 'Résistance pilotée (FTMS, FE-C)' : 'Controlled resistance (FTMS, FE-C)'],
      ['power', 'powerMeter', L ? 'Pédales ou manivelle (Assioma…)' : 'Pedals or crank (Assioma…)'],
      ['heartRate', 'hrm', L ? 'Ceinture ou montre (TICKR…)' : 'Strap or watch (TICKR…)'],
      ['shifter', 'shifter', L ? 'Manettes (Click, AXS, D-Fly)' : 'Controllers (Click, AXS, D-Fly)'],
      ['fan', 'fan', L ? 'Ventilateur connecté' : 'Smart fan'],
    ];
    const tile = ([role, k, sub]: [Role, I18nKey, string]) => {
      const ds = list.filter((d) => d.roleIds?.includes(role));
      const ok = ds.some((d) => d.ok);
      return `<div class="mm-dev ${ok ? 'ok' : ds.length ? 'pending' : ''}">
        <div class="mm-dev-ico">${ICON[role as keyof typeof ICON] ?? ''}</div>
        <div class="mm-dev-body"><b>${esc(t(k))}</b>
          ${ds.length ? ds.map((d) => `<span class="mm-dev-name">${esc(d.name)} · ${esc(d.state)}${d.detail ? ` · ${esc(d.detail)}` : ''} <button class="mm-link" data-forget="${esc(d.id)}">${L ? 'oublier' : 'forget'}</button></span>`).join('') : `<span>${esc(sub)}</span>`}
        </div>
        <button class="btn small ${ok ? '' : 'primary'}" data-pair="${role}">${ok ? (L ? 'Changer' : 'Change') : L ? 'Associer' : 'Pair'}</button>
      </div>`;
    };
    box.innerHTML = `
      <div class="mm-devgrid">${roles.map(tile).join('')}</div>
      <div class="mm-devopts">
        <div class="field">${L ? 'Connexion' : 'Connection'}${this.seg('m-transport', transports[0]?.id ?? '', transports.map((tr) => [tr.id, tr.label]))}</div>
        <div id="m-adapters"></div>
        <label class="mm-check"><input type="checkbox" id="m-sim" ${this.devices.simulatorOn() ? 'checked' : ''}/> ${t('simulator')} (${L ? 'rouler sans matériel' : 'ride without hardware'})</label>
        <label class="mm-check"><input type="checkbox" id="m-guest" ${this.s.guest ? 'checked' : ''}/> ${L ? 'Invité sans matériel (clavier / manette, hors classements)' : 'Guest without hardware (keyboard / gamepad, unranked)'}</label>
      </div>
      ${this.devices
        .warnings()
        .map((w) => `<div class="warning">${esc(w)}</div>`)
        .join('')}
      <div class="mm-note">${t('oneAppAtATime')}<br/>${t('edgeWarn')}</div>`;
    this.bindSegs(box);
    box.querySelectorAll<HTMLButtonElement>('[data-pair]').forEach((b) =>
      b.addEventListener('click', async () => {
        const transport = (box.querySelector('#m-transport') as HTMLElement).dataset.value ?? '';
        b.disabled = true;
        try {
          await this.devices.pair(b.dataset.pair as Role, transport);
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
      this.renderStatus();
    });
    if (this.devices.adapters) {
      void this.devices.adapters().then((ads) => {
        const el = box.querySelector('#m-adapters');
        if (!el || ads.length < 2) return;
        el.innerHTML = `<label class="field">${L ? 'Adaptateur Bluetooth' : 'Bluetooth adapter'}<select id="m-adapter">${ads.map((a) => `<option value="${esc(a.id)}" ${a.isDefault ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>`;
        el.querySelector('select')?.addEventListener('change', (e) => void this.devices.selectAdapter?.((e.target as HTMLSelectElement).value));
      });
    }
  }

  private start(): void {
    const invite = (this.root.querySelector('#m-invite') as HTMLInputElement | null)?.value.trim();
    this.cb.onStart(this.s, { ...(this.workoutFile ? { workoutFile: this.workoutFile } : {}), ...(invite ? { inviteCode: invite } : {}) });
  }

  // ————————————————————————————————————————————— Événements

  private bind(): void {
    const s = this.s;
    this.bindSegs(this.root.querySelector('.mm-panel') ?? this.root);
    const on = <T extends HTMLElement>(id: string, ev: string, fn: (el: T) => void) => {
      const el = this.root.querySelector(`#${id}`) as T | null;
      el?.addEventListener(ev, () => fn(el));
    };
    const changed = () => {
      saveSettings(s);
      this.onSettingsChange?.(s);
      this.onSettingsSaved?.(s);
    };
    this.root.querySelectorAll<HTMLElement>('[data-tab]').forEach((el) => el.addEventListener('click', () => this.go(el.dataset.tab as Tab)));
    on('m-tuto', 'click', () => this.onTutorial?.());
    on('m-login', 'click', () => this.onLogin?.());
    on('m-logout', 'click', () => this.onLogout?.());
    on('m-start', 'click', () => this.start());
    on('m-explore', 'click', () => this.onExplore?.());
    // Rouler : modes et itinéraires.
    this.root.querySelectorAll<HTMLElement>('[data-mode]').forEach((el) =>
      el.addEventListener('click', () => {
        s.mode = el.dataset.mode as Settings['mode'];
        changed();
        this.render();
      }),
    );
    this.root.querySelectorAll<HTMLElement>('[data-preset]').forEach((el) =>
      el.addEventListener('click', () => {
        s.workoutPreset = el.dataset.preset as string;
        this.workoutFile = undefined;
        changed();
        this.render();
      }),
    );
    this.root.querySelectorAll<HTMLElement>('[data-world]').forEach((el) =>
      el.addEventListener('click', () => {
        const id = el.dataset.world as string;
        if (id !== this.worldId) this.onWorld?.(id);
      }),
    );
    this.root.querySelectorAll<HTMLElement>('[data-route]').forEach((el) =>
      el.addEventListener('click', () => {
        s.routeId = el.dataset.route as string;
        changed();
        this.render();
      }),
    );
    on<HTMLInputElement>('m-workout', 'change', async (el) => {
      const f = el.files?.[0];
      if (!f) return;
      this.workoutFile = { name: f.name, content: await f.text() };
      const n = this.root.querySelector('#m-wname');
      if (n) n.textContent = f.name;
    });
    // Garage : catégories, objets, vues et rotation de l'aperçu.
    this.root.querySelectorAll<HTMLElement>('[data-slot]').forEach((el) =>
      el.addEventListener('click', () => {
        this.garageSlot = el.dataset.slot as CosmeticSlot | 'colors';
        if (this.garageSlot !== 'colors') {
          this.view = SLOT_VIEW[this.garageSlot];
          this.yaw = 0;
        }
        this.render();
        this.onScene?.(this.view, this.yaw);
      }),
    );
    this.root.querySelectorAll<HTMLElement>('[data-item]').forEach((el) =>
      el.addEventListener('click', () => {
        const item = COSMETICS.find((c) => c.id === el.dataset.item);
        if (!item) return;
        const locked = item.level > levelProgress(loadProgress().xp).level;
        if (locked) {
          // Verrouillé : simple aperçu sur le coureur, rien n'est équipé ni enregistré.
          this.previewId = this.previewId === item.id ? null : item.id;
          this.onPreviewLook?.(this.previewId ? this.lookWith(item) : null);
          this.render();
          return;
        }
        this.previewId = null;
        this.onPreviewLook?.(null);
        equipItem(item, s);
        changed();
        this.render();
      }),
    );
    this.root.querySelectorAll<HTMLElement>('[data-view]').forEach((el) =>
      el.addEventListener('click', () => {
        this.view = el.dataset.view as GarageView;
        this.yaw = 0;
        this.root.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b === el));
        this.onScene?.(this.view, this.yaw);
      }),
    );
    const zone = this.root.querySelector<HTMLElement>('#m-dragzone');
    if (zone) {
      let lastX: number | null = null;
      zone.addEventListener('pointerdown', (e) => {
        lastX = e.clientX;
        zone.setPointerCapture(e.pointerId);
      });
      zone.addEventListener('pointermove', (e) => {
        if (lastX === null) return;
        this.yaw -= (e.clientX - lastX) * 0.008;
        lastX = e.clientX;
        this.onScene?.(this.view, this.yaw);
      });
      const up = () => (lastX = null);
      zone.addEventListener('pointerup', up);
      zone.addEventListener('pointercancel', up);
    }
    const color = (id: string, key: 'jersey' | 'jerseyAccent' | 'helmet' | 'bike' | 'skin' | 'hair') =>
      on<HTMLInputElement>(id, 'input', (el) => {
        s.look = { ...s.look, [key]: el.value };
        changed();
      });
    color('m-jersey', 'jersey');
    color('m-accent', 'jerseyAccent');
    color('m-helmet', 'helmet');
    color('m-bike', 'bike');
    color('m-skin', 'skin');
    color('m-hair', 'hair');
    // Profil.
    const num = (id: string, key: 'massKg' | 'ftpWatts' | 'heightCm' | 'aiRiders') =>
      on<HTMLInputElement>(id, 'change', (el) => {
        s[key] = Number(el.value);
        changed();
        if (this.tab === 'profile') this.render();
      });
    num('m-mass', 'massKg');
    num('m-ftp', 'ftpWatts');
    num('m-height', 'heightCm');
    num('m-ai', 'aiRiders');
    on<HTMLInputElement>('m-name', 'change', (el) => {
      s.name = el.value.trim().slice(0, 24) || 'Robert';
      changed();
      this.render();
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
    const range = (id: string, key: 'hour' | 'clouds' | 'rain' | 'fog' | 'trainerDifficulty' | 'inertia', label?: string, fmt?: (v: number) => string) =>
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
    range('m-inertia', 'inertia', 'm-inertiav', (v) => `${Math.round(v * 100)} %`);
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
