import { withLikeness } from '../ui/faceEditorLogic.ts';
import { DEFAULT_LOOK } from '@allezrobert/shared';
import { getLang, setLang, t } from '../i18n/index.ts';
import type { DevicePanel } from '../ui/menu.ts';
import { saveSettings, type Settings } from '../ui/settings.ts';
import { VoiceOver } from './voice.ts';

// Premier lancement : tutoriel d'accueil, puis équipement (capteurs, vitesses), puis profil et avatar.
const STEPS = ['welcome', 'devices', 'gears', 'profile', 'avatar'] as const;
type Step = (typeof STEPS)[number];

const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#5c3a21'];
const HAIRS = ['#1f1a17', '#3b2a1e', '#6a4e35', '#b88a52', '#d9c08a', '#9a9a9a'];

/**
 * Premier lancement guidé (rejouable depuis le menu) : langue, profil, avatar, capteurs
 * pas à pas avec diagnostic, vitesses virtuelles ; voix off FR/EN et sous-titres.
 */
export class Onboarding {
  private readonly root: HTMLElement;
  private readonly s: Settings;
  private readonly devices: DevicePanel;
  private readonly voice: VoiceOver;
  private step: Step = 'welcome';
  private readonly done: (s: Settings, skipped: boolean) => void;

  constructor(root: HTMLElement, settings: Settings, devices: DevicePanel, done: (s: Settings, skipped: boolean) => void) {
    this.root = root;
    this.s = settings;
    this.devices = devices;
    this.done = done;
    this.voice = new VoiceOver(document.getElementById('app') as HTMLElement);
    devices.onChange(() => {
      if (this.step === 'devices') this.render();
    });
  }

  static needed(): boolean {
    return !localStorage.getItem('ar.onboarded');
  }

  start(): void {
    this.go('welcome');
  }

  private go(step: Step): void {
    this.step = step;
    this.voice.stop();
    this.render();
    void this.voice.say(step);
  }

  private next(): void {
    saveSettings(this.s);
    const i = STEPS.indexOf(this.step);
    if (i < STEPS.length - 1) this.go(STEPS[i + 1] as Step);
    else {
      this.voice.stop();
      localStorage.setItem('ar.onboarded', new Date().toISOString());
      void this.voice.say('finish');
      this.done(this.s, false);
    }
  }

  private render(): void {
    const fr = getLang() === 'fr';
    const i = STEPS.indexOf(this.step);
    const dots = STEPS.map((_, k) => `<span style="display:inline-block;width:${k === i ? 26 : 8}px;height:8px;border-radius:4px;background:${k <= i ? 'var(--ar-accent)' : 'rgba(255,255,255,.2)'};margin-right:6px;transition:width .3s"></span>`).join('');
    let body = '';
    switch (this.step) {
      case 'welcome':
        body = `<h1>Allez <em>Robert</em> !</h1>
          <p class="tagline">${fr ? 'Rouler ensemble, chacun chez soi.' : 'Ride together, each from home.'}</p>
          <div class="row"><button class="btn ${fr ? 'primary' : ''}" data-lang="fr">Français</button><button class="btn ${fr ? '' : 'primary'}" data-lang="en">English</button>
          <label class="row" style="margin-left:auto;font-size:13px;color:var(--ar-muted)"><input type="checkbox" id="o-voice" ${this.voice.enabled ? 'checked' : ''}/> ${fr ? 'Voix off' : 'Voice-over'}</label></div>
          <div class="warning" style="margin-top:16px;background:rgba(59,130,246,.12);border-color:rgba(59,130,246,.35);color:#bfdbfe">${fr ? 'Compte : la connexion Google, Discord ou lien magique sera proposée pour rouler en groupe. Pour une sortie seul, aucun compte n’est nécessaire.' : 'Account: Google, Discord or magic-link sign-in is offered for group rides. Riding solo needs no account.'}</div>`;
        break;
      case 'profile':
        body = `<h2>${t('profile')}</h2><div class="grid3">
          <label class="field">${t('name')}<input id="o-name" value="${this.s.name.replace(/"/g, '&quot;')}"/></label>
          <label class="field">${t('weight')}<input id="o-mass" type="number" min="30" max="200" step="0.5" value="${this.s.massKg}"/></label>
          <label class="field">${t('height')}<input id="o-height" type="number" min="120" max="220" value="${this.s.heightCm}"/></label>
          <label class="field">${t('ftp')}<input id="o-ftp" type="number" min="50" max="600" value="${this.s.ftpWatts}"/></label>
          <label class="field">${fr ? 'Je ne connais pas ma FTP' : "I don't know my FTP"}<button class="btn small" id="o-ftptest">${fr ? 'Faire le test FTP ensuite' : 'Do the FTP test next'}</button></label></div>`;
        break;
      case 'avatar':
        body = `<h2>Avatar</h2><div class="grid3">
          <label class="field">${fr ? 'Peau' : 'Skin'}<div class="row">${SKINS.map((c) => `<button class="btn small" data-skin="${c}" style="background:${c};width:30px;height:30px;padding:0;border:${this.s.look.skin === c ? '3px solid #ffd23f' : '0'}"></button>`).join('')}</div></label>
          <label class="field">${fr ? 'Cheveux' : 'Hair'}<div class="row">${HAIRS.map((c) => `<button class="btn small" data-hair="${c}" style="background:${c};width:30px;height:30px;padding:0;border:${this.s.look.hair === c ? '3px solid #ffd23f' : '0'}"></button>`).join('')}</div></label>
          <label class="field">${fr ? 'Morphologie' : 'Build'}<input id="o-build" type="range" min="0" max="1" step="0.05" value="${this.s.look.build}"/></label>
          <label class="field">Maillot<input id="o-jersey" type="color" value="${this.s.look.jersey}"/></label>
          <label class="field">${fr ? 'Bande du maillot' : 'Jersey stripe'}<input id="o-accent" type="color" value="${this.s.look.jerseyAccent}"/></label>
          <label class="field">${fr ? 'Casque' : 'Helmet'}<input id="o-helmet" type="color" value="${this.s.look.helmet}"/></label>
          <label class="field">Vélo<input id="o-bike" type="color" value="${this.s.look.bike}"/></label></div>
          <div class="device" style="margin-top:12px"><div><b>${fr ? 'Ressemblance à partir d’une photo' : 'Likeness from a photo'}</b>
            <div class="meta">${fr ? 'Visage, teint et cheveux estimés sur ton appareil ; la photo n’est ni envoyée ni conservée, seuls les réglages obtenus sont gardés (modifiables ou effaçables au garage). Uniquement une photo de toi.' : 'Face, skin and hair estimated on your device; the photo is never uploaded nor stored, only the resulting settings are kept (editable or erasable in the garage). Only a photo of yourself.'}</div>
            <label class="row" style="font-size:13px;margin-top:6px"><input type="checkbox" id="o-consent"/> ${fr ? 'J’accepte ce traitement local de ma photo' : 'I agree to this local processing of my photo'}</label></div>
            <label class="btn small" id="o-photo-label" style="opacity:.5">${fr ? 'Choisir une photo' : 'Choose a photo'}<input id="o-photo" type="file" accept="image/*" hidden disabled/></label></div>`;
        break;
      case 'devices': {
        const list = this.devices.list();
        const transports = this.devices.transports();
        const roles: Array<[Parameters<DevicePanel['pair']>[0], string]> = [
          ['trainer', `1. ${t('trainer')} (KICKR CORE…)`],
          ['power', `2. ${t('powerMeter')} (Assioma…)`],
          ['heartRate', `3. ${t('hrm')} (TICKR…)`],
          ['shifter', `4. ${t('shifter')} (Di2, Click…)`],
        ];
        body = `<h2>${t('devices')}</h2>
          ${transports.length ? '' : `<div class="warning">${t('noWebBluetooth')}</div>`}
          <div class="device-list">${roles
            .map(([role, label]) => {
              const d = list.find((x) => x.role.toLowerCase().includes((role === 'power' ? t('powerMeter') : role === 'heartRate' ? t('hrm') : role === 'trainer' ? t('trainer') : t('shifter')).toLowerCase()));
              return `<div class="device"><div><b>${label}</b><div class="meta">${d ? `${d.name} · ${d.state}` : fr ? 'non appairé' : 'not paired'}</div></div>${transports.length ? `<button class="btn small" data-pair="${role}">${t('pair')}</button>` : ''}</div>`;
            })
            .join('')}</div>
          ${this.devices
            .warnings()
            .map((w) => `<div class="warning">${w}</div>`)
            .join('')}
          <div class="warning" style="margin-top:10px;background:rgba(59,130,246,.12);border-color:rgba(59,130,246,.35);color:#bfdbfe">${t('oneAppAtATime')}<br/>${t('assiomaWarn')}<br/>${t('edgeWarn')}</div>
          <p style="font-size:13px;color:var(--ar-muted)">${fr ? 'Pas de matériel sous la main ? Le simulateur prend le relais automatiquement.' : 'No hardware at hand? The simulator takes over automatically.'}</p>`;
        break;
      }
      case 'gears':
        body = `<h2>${t('gear')}</h2>
          <div class="grid2">
            <label class="field">${fr ? 'Sur le home trainer' : 'On the trainer'}<select id="o-drive">
              <option value="cog" ${this.s.drivetrain === 'cog' ? 'selected' : ''}>Zwift Cog — ${fr ? 'vitesses virtuelles (24 rapports)' : 'virtual gears (24)'}</option>
              <option value="cassette" ${this.s.drivetrain === 'cassette' ? 'selected' : ''}>${fr ? 'Cassette réelle (dérailleur)' : 'Real cassette'}</option></select></label>
            <div class="field">${fr ? 'Commandes' : 'Controls'}<div style="color:var(--ar-fg);font-size:14px;line-height:1.6">Shimano 105 Di2 · Zwift Click / Play / Ride · ${fr ? 'manette' : 'gamepad'} · ${fr ? 'clavier ↑ ↓' : 'keyboard ↑ ↓'} · ${fr ? 'appli compagnon' : 'companion app'}</div></div>
          </div>`;
        break;
    }
    this.root.innerHTML = `<div class="menu"><div class="card panel" style="max-width:860px">
      <div style="margin-bottom:14px">${dots}</div>${body}
      <div class="row" style="justify-content:space-between;margin-top:22px">
        <button class="btn" id="o-skip">${fr ? 'Passer le tutoriel' : 'Skip tutorial'}</button>
        <div class="row">${i > 0 ? `<button class="btn" id="o-back">←</button>` : ''}<button class="btn primary" id="o-next">${i === STEPS.length - 1 ? (fr ? 'Terminer ✓' : 'Finish ✓') : fr ? 'Suivant →' : 'Next →'}</button></div>
      </div></div></div>`;
    this.bind();
  }

  private bind(): void {
    const $ = <T extends HTMLElement>(id: string) => this.root.querySelector(`#${id}`) as T | null;
    $('o-next')?.addEventListener('click', () => this.next());
    $('o-back')?.addEventListener('click', () => this.go(STEPS[Math.max(0, STEPS.indexOf(this.step) - 1)] as Step));
    $('o-skip')?.addEventListener('click', () => {
      this.voice.stop();
      localStorage.setItem('ar.onboarded', 'skipped');
      saveSettings(this.s);
      this.done(this.s, true);
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) =>
      b.addEventListener('click', () => {
        this.s.lang = b.dataset.lang as Settings['lang'];
        setLang(this.s.lang);
        this.go('welcome');
      }),
    );
    $<HTMLInputElement>('o-voice')?.addEventListener('change', (e) => this.voice.setEnabled((e.target as HTMLInputElement).checked));
    const num = (id: string, key: 'massKg' | 'heightCm' | 'ftpWatts') => $<HTMLInputElement>(id)?.addEventListener('change', (e) => (this.s[key] = Number((e.target as HTMLInputElement).value)));
    num('o-mass', 'massKg');
    num('o-height', 'heightCm');
    num('o-ftp', 'ftpWatts');
    $<HTMLInputElement>('o-name')?.addEventListener('change', (e) => (this.s.name = (e.target as HTMLInputElement).value.trim().slice(0, 24) || 'Robert'));
    $('o-ftptest')?.addEventListener('click', () => {
      this.s.mode = 'ftpTest';
      this.next();
    });
    const look = (id: string, key: 'jersey' | 'jerseyAccent' | 'helmet') => $<HTMLInputElement>(id)?.addEventListener('input', (e) => (this.s.look = { ...DEFAULT_LOOK, ...this.s.look, [key]: (e.target as HTMLInputElement).value }));
    look('o-jersey', 'jersey');
    look('o-accent', 'jerseyAccent');
    look('o-helmet', 'helmet');
    // Couleur du vélo choisie : vélo de base peint de cette couleur (le modèle du garage est retiré).
    $<HTMLInputElement>('o-bike')?.addEventListener('input', (e) => {
      const { bikeModel: _, ...rest } = { ...DEFAULT_LOOK, ...this.s.look };
      this.s.look = { ...rest, bike: (e.target as HTMLInputElement).value };
    });
    $<HTMLInputElement>('o-build')?.addEventListener('input', (e) => (this.s.look = { ...this.s.look, build: Number((e.target as HTMLInputElement).value) }));
    this.root.querySelectorAll<HTMLButtonElement>('[data-skin]').forEach((b) => b.addEventListener('click', () => ((this.s.look = { ...this.s.look, skin: b.dataset.skin as string }), this.render())));
    this.root.querySelectorAll<HTMLButtonElement>('[data-hair]').forEach((b) => b.addEventListener('click', () => ((this.s.look = { ...this.s.look, hair: b.dataset.hair as string }), this.render())));
    $<HTMLInputElement>('o-consent')?.addEventListener('change', (e) => {
      const ok = (e.target as HTMLInputElement).checked;
      const input = $<HTMLInputElement>('o-photo');
      if (input) input.disabled = !ok;
      const label = $<HTMLElement>('o-photo-label');
      if (label) label.style.opacity = ok ? '1' : '.5';
    });
    $<HTMLInputElement>('o-photo')?.addEventListener('change', async (e) => {
      const input = e.target as HTMLInputElement;
      const f = input.files?.[0];
      input.value = '';
      if (!f || !$<HTMLInputElement>('o-consent')?.checked) return;
      const { likenessFromPhoto } = await import('./likeness.ts');
      const l = await likenessFromPhoto(f);
      this.s.look = withLikeness(this.s.look, l);
      this.render();
    });
    $<HTMLSelectElement>('o-drive')?.addEventListener('change', (e) => (this.s.drivetrain = (e.target as HTMLSelectElement).value as Settings['drivetrain']));
    this.root.querySelectorAll<HTMLButtonElement>('[data-pair]').forEach((b) =>
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          const tr = this.devices.transports()[0]?.id;
          if (tr) await this.devices.pair(b.dataset.pair as Parameters<DevicePanel['pair']>[0], tr);
        } catch (e) {
          alert(String((e as Error).message ?? e));
        }
        b.disabled = false;
        this.render();
      }),
    );
  }
}

/** Indices commentés pendant la première sortie (voix + sous-titres), une seule fois chacun. */
export class RideTutorial {
  private readonly voice: VoiceOver;
  private readonly said = new Set<string>();

  constructor() {
    this.voice = new VoiceOver(document.getElementById('app') as HTMLElement);
    void this.once('ride');
  }

  private once(key: 'ride' | 'firstShift' | 'firstClimb' | 'segment' | 'draft' | 'done'): Promise<void> | undefined {
    if (this.said.has(key)) return undefined;
    this.said.add(key);
    return this.voice.say(key);
  }

  update(state: { shifted: boolean; gradePercent: number; inSegment: boolean; draft: number; distM: number }): void {
    if (state.shifted) void this.once('firstShift');
    if (state.gradePercent > 4) void this.once('firstClimb');
    if (state.inSegment) void this.once('segment');
    if (state.draft > 0.12) void this.once('draft');
    if (state.distM > 3000) void this.once('done');
  }

  stop(): void {
    this.voice.stop();
  }
}
