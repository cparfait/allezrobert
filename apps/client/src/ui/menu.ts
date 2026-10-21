import type { RouteData } from '@allezrobert/shared';
import { t, setLang, getLang, type I18nKey } from '../i18n/index.ts';
import type { Settings } from './settings.ts';
import { saveSettings } from './settings.ts';

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

/** Écran d'accueil : profil, itinéraire, mode, capteurs, réglages. */
export class MainMenu {
  private readonly root: HTMLElement;
  private readonly s: Settings;
  private readonly routes: RouteData[];
  private readonly devices: DevicePanel;
  private readonly cb: MenuCallbacks;
  private workoutFile: { name: string; content: string } | undefined;
  onSettingsChange?: (s: Settings) => void;

  constructor(root: HTMLElement, settings: Settings, routes: RouteData[], devices: DevicePanel, cb: MenuCallbacks) {
    this.root = root;
    this.s = settings;
    this.routes = routes;
    this.devices = devices;
    this.cb = cb;
    if (!this.s.routeId || !routes.some((r) => r.id === this.s.routeId)) this.s.routeId = routes[0]?.id ?? '';
    devices.onChange(() => this.renderDevices());
  }

  show(): void {
    this.render();
  }

  hide(): void {
    this.root.innerHTML = '';
  }

  private opt<T extends string>(value: T, current: string, label: string): string {
    return `<option value="${value}" ${value === current ? 'selected' : ''}>${esc(label)}</option>`;
  }

  private render(): void {
    const s = this.s;
    const routeCards = this.routes
      .map(
        (r) => `<div class="route-card ${r.id === s.routeId ? 'selected' : ''}" data-route="${esc(r.id)}">
          <b>${esc(getLang() === 'en' && r.nameEn ? r.nameEn : r.name)}</b>
          <div class="meta">${(r.lengthM / 1000).toFixed(1).replace('.', ',')} km · ${Math.round(r.elevationGainM)} m D+ · ${r.segments.length} segments${r.loop ? ' · boucle' : ''}</div>
        </div>`,
      )
      .join('');
    const modes: Array<[string, I18nKey]> = [
      ['free', 'free'],
      ['group', 'group'],
      ['race', 'race'],
      ['workout', 'workout'],
      ['ftpTest', 'ftpTest'],
    ];
    this.root.innerHTML = `
      <div class="menu"><div class="card panel">
        <h1>Allez <em>Robert</em> !</h1>
        <p class="tagline">${getLang() === 'fr' ? 'De Saclay à Rambouillet, entre amis.' : 'From Saclay to Rambouillet, with friends.'} <span style="opacity:.6">${t('shortcuts')}</span></p>
        <div class="grid2">
          <div>
            <h2>${t('route')}</h2>
            <div class="device-list">${routeCards}</div>
            <h2>${t('mode')}</h2>
            <div class="row">
              <select id="m-mode" class="btn small">${modes.map(([v, k]) => this.opt(v, s.mode, t(k))).join('')}</select>
              <input id="m-invite" class="btn small ${s.mode === 'group' || s.mode === 'race' ? '' : 'hidden'}" placeholder="${getLang() === 'fr' ? 'Code d’invitation' : 'Invite code'}" style="width:160px" />
              <label class="btn small ${s.mode === 'workout' ? '' : 'hidden'}" id="m-wlabel">.zwo / .erg / .mrc<input id="m-workout" type="file" accept=".zwo,.erg,.mrc" hidden /></label>
              <span id="m-wname" class="meta"></span>
            </div>
            <h2>${t('profile')}</h2>
            <div class="grid3">
              <label class="field">${t('name')}<input id="m-name" value="${esc(s.name)}" /></label>
              <label class="field">${t('weight')}<input id="m-mass" type="number" min="30" max="200" step="0.5" value="${s.massKg}" /></label>
              <label class="field">${t('ftp')}<input id="m-ftp" type="number" min="50" max="600" value="${s.ftpWatts}" /></label>
              <label class="field">${t('height')}<input id="m-height" type="number" min="120" max="220" value="${s.heightCm}" /></label>
              <label class="field">Maillot<input id="m-jersey" type="color" value="${s.look.jersey}" /></label>
              <label class="field">Vélo<input id="m-bike" type="color" value="${s.look.bike}" /></label>
            </div>
          </div>
          <div>
            <h2>${t('devices')}</h2>
            <div id="m-devices"></div>
            <h2>${t('settings')}</h2>
            <div class="grid3">
              <label class="field">${t('quality')}<select id="m-quality">${(['low', 'medium', 'high', 'ultra'] as const).map((q) => this.opt(q, s.quality, t(q))).join('')}</select></label>
              <label class="field">${t('season')}<select id="m-season">${(['spring', 'summer', 'autumn', 'winter'] as const).map((q) => this.opt(q, s.season, t(q))).join('')}</select></label>
              <label class="field">${t('hour')} <span id="m-hourv">${s.hour.toFixed(1)} h</span><input id="m-hour" type="range" min="5" max="22" step="0.25" value="${s.hour}" /></label>
              <label class="field">Nuages<input id="m-clouds" type="range" min="0" max="1" step="0.05" value="${s.clouds}" /></label>
              <label class="field">Pluie<input id="m-rain" type="range" min="0" max="1" step="0.05" value="${s.rain}" /></label>
              <label class="field">Brouillard<input id="m-fog" type="range" min="0" max="1" step="0.05" value="${s.fog}" /></label>
              <label class="field">${t('difficulty')} <span id="m-diffv">${Math.round(s.trainerDifficulty * 100)} %</span><input id="m-diff" type="range" min="0" max="1" step="0.05" value="${s.trainerDifficulty}" /></label>
              <label class="field">Coureurs IA<input id="m-ai" type="number" min="0" max="19" value="${s.aiRiders}" /></label>
              <label class="field">${t('language')}<select id="m-lang">${this.opt('fr', s.lang, 'Français')}${this.opt('en', s.lang, 'English')}</select></label>
              <label class="field">Transmission<select id="m-drive">${this.opt('cog', s.drivetrain, 'Zwift Cog (vitesses virtuelles)')}${this.opt('cassette', s.drivetrain, 'Cassette réelle')}</select></label>
              <label class="field">Strava<select id="m-strava">${this.opt('skip', s.skipStrava ? 'skip' : 'send', 'Ne pas envoyer (Garmin)')}${this.opt('send', s.skipStrava ? 'skip' : 'send', 'Envoyer')}</select></label>
              <label class="field">Lissage puissance<select id="m-smooth">${this.opt('0', s.smoothing3s ? '1' : '0', 'Non')}${this.opt('1', s.smoothing3s ? '1' : '0', '3 s')}</select></label>
            </div>
          </div>
        </div>
        <div class="row" style="justify-content:flex-end;margin-top:22px">
          <button id="m-start" class="btn primary" style="font-size:18px;padding:14px 34px">${t('ride')} →</button>
        </div>
      </div></div>`;
    this.renderDevices();
    this.bind();
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
      <div class="device-list">
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
        <label class="row" style="font-size:13px;color:var(--ar-muted)"><input type="checkbox" id="m-sim" ${this.devices.simulatorOn() ? 'checked' : ''}/> ${t('simulator')} (${getLang() === 'fr' ? 'rouler sans matériel' : 'ride without hardware'})</label>
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
    const $ = <T extends HTMLElement>(id: string) => this.root.querySelector(`#${id}`) as T;
    const changed = () => {
      saveSettings(s);
      this.onSettingsChange?.(s);
    };
    this.root.querySelectorAll<HTMLElement>('[data-route]').forEach((el) =>
      el.addEventListener('click', () => {
        s.routeId = el.dataset.route as string;
        changed();
        this.render();
      }),
    );
    const num = (id: string, key: 'massKg' | 'ftpWatts' | 'heightCm' | 'aiRiders') =>
      $<HTMLInputElement>(id).addEventListener('change', (e) => {
        s[key] = Number((e.target as HTMLInputElement).value);
        changed();
      });
    num('m-mass', 'massKg');
    num('m-ftp', 'ftpWatts');
    num('m-height', 'heightCm');
    num('m-ai', 'aiRiders');
    $<HTMLInputElement>('m-name').addEventListener('change', (e) => {
      s.name = (e.target as HTMLInputElement).value.trim().slice(0, 24) || 'Robert';
      changed();
    });
    $<HTMLInputElement>('m-jersey').addEventListener('input', (e) => {
      s.look = { ...s.look, jersey: (e.target as HTMLInputElement).value };
      changed();
    });
    $<HTMLInputElement>('m-bike').addEventListener('input', (e) => {
      s.look = { ...s.look, bike: (e.target as HTMLInputElement).value };
      changed();
    });
    $<HTMLSelectElement>('m-mode').addEventListener('change', (e) => {
      s.mode = (e.target as HTMLSelectElement).value as Settings['mode'];
      changed();
      this.render();
    });
    $<HTMLSelectElement>('m-quality').addEventListener('change', (e) => {
      s.quality = (e.target as HTMLSelectElement).value as Settings['quality'];
      localStorage.setItem('ar.quality', s.quality);
      changed();
    });
    $<HTMLSelectElement>('m-season').addEventListener('change', (e) => {
      s.season = (e.target as HTMLSelectElement).value as Settings['season'];
      changed();
    });
    const range = (id: string, key: 'hour' | 'clouds' | 'rain' | 'fog' | 'trainerDifficulty', label?: string, fmt?: (v: number) => string) =>
      $<HTMLInputElement>(id).addEventListener('input', (e) => {
        s[key] = Number((e.target as HTMLInputElement).value);
        if (label && fmt) $<HTMLElement>(label).textContent = fmt(s[key]);
        changed();
      });
    range('m-hour', 'hour', 'm-hourv', (v) => `${v.toFixed(1)} h`);
    range('m-clouds', 'clouds');
    range('m-rain', 'rain');
    range('m-fog', 'fog');
    range('m-diff', 'trainerDifficulty', 'm-diffv', (v) => `${Math.round(v * 100)} %`);
    $<HTMLSelectElement>('m-lang').addEventListener('change', (e) => {
      s.lang = (e.target as HTMLSelectElement).value as Settings['lang'];
      setLang(s.lang);
      changed();
      this.render();
    });
    $<HTMLSelectElement>('m-drive').addEventListener('change', (e) => {
      s.drivetrain = (e.target as HTMLSelectElement).value as Settings['drivetrain'];
      changed();
    });
    $<HTMLSelectElement>('m-strava').addEventListener('change', (e) => {
      s.skipStrava = (e.target as HTMLSelectElement).value === 'skip';
      changed();
    });
    $<HTMLSelectElement>('m-smooth').addEventListener('change', (e) => {
      s.smoothing3s = (e.target as HTMLSelectElement).value === '1';
      changed();
    });
    $<HTMLInputElement>('m-workout').addEventListener('change', async (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (!f) return;
      this.workoutFile = { name: f.name, content: await f.text() };
      $<HTMLElement>('m-wname').textContent = f.name;
    });
    $<HTMLButtonElement>('m-start').addEventListener('click', () => {
      const invite = $<HTMLInputElement>('m-invite').value.trim();
      this.cb.onStart(s, { ...(this.workoutFile ? { workoutFile: this.workoutFile } : {}), ...(invite ? { inviteCode: invite } : {}) });
    });
  }
}
