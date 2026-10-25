import { withLikeness } from '../ui/faceEditorLogic.ts';
import { enhanceSelects } from '../ui/dropdown.ts';
import { DEFAULT_LOOK, lookSex, withSex, type AvatarLook } from '@allezrobert/shared';
import { getLang, setLang, t } from '../i18n/index.ts';
import type { DevicePanel } from '../ui/menu.ts';
import { saveSettings, type Settings } from '../ui/settings.ts';
import { VoiceOver } from './voice.ts';
import { renderCompanionSettings } from '../ui/companionQr.ts';

// Premier lancement : accueil, équipement (capteurs, vitesses), profil, avatar, puis la page finale
// (test FTP si demandé, sinon le mot de la fin).
const STEPS = ['welcome', 'devices', 'gears', 'companion', 'profile', 'avatar', 'final'] as const;
type Step = (typeof STEPS)[number];

const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#5c3a21'];
const HAIRS = ['#1f1a17', '#3b2a1e', '#6a4e35', '#b88a52', '#d9c08a', '#9a9a9a'];
/** Quelques couleurs de départ : le reste se débloque en roulant (garage). */
const JERSEYS = ['#1f6feb', '#d62828', '#ffffff', '#2a9d8f', '#f4a261', '#111111'];
const ACCENTS = ['#ffd23f', '#ffffff', '#111111', '#d62828', '#1f6feb', '#2a9d8f'];
const SHOES = ['#f2f2f2', '#111418', '#1e5bd8', '#c0392b', '#d7f205', '#ff7a1a'];
const HELMETS = ['#f4f4f4', '#111111', '#1f6feb', '#d62828', '#ffd23f'];
const BIKES = ['#c0392b', '#111111', '#e8ecf0', '#1f6feb', '#2e7d32'];
const CASSETTE_SPEEDS = [8, 9, 10, 11, 12, 13];
const DI2_MODELS: Array<[string, string, string]> = [
  ['dura-ace', 'Dura-Ace Di2', 'Dura-Ace Di2'],
  ['ultegra', 'Ultegra Di2', 'Ultegra Di2'],
  ['105', '105 Di2', '105 Di2'],
  ['grx', 'GRX Di2', 'GRX Di2'],
  ['other', 'Autre / je ne sais pas', 'Other / not sure'],
];

/** Aperçu 3D du coureur derrière le tutoriel (étape avatar). */
export interface AvatarPreview {
  /** `bareHead` : tête nue (teint et cheveux visibles) ; faux pour voir le casque choisi. */
  show(look: AvatarLook, bareHead?: boolean): void;
  hide(): void;
}

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
  private readonly preview: AvatarPreview | undefined;
  private previewOn = false;
  /**
   * Aperçu tête nue : désactivé. Sans coiffures dans le modèle 3D, la tête nue montre un crâne lisse et
   * déformé (TODO.md, rubrique Visage) : le coureur garde son casque pendant tout le tutoriel.
   */
  private readonly bareHead = false;
  /** Test FTP demandé à l'étape profil : proposé sur la page finale. */
  private wantFtp = false;
  private assiomaSaid = false;

  constructor(root: HTMLElement, settings: Settings, devices: DevicePanel, done: (s: Settings, skipped: boolean) => void, preview?: AvatarPreview) {
    this.root = root;
    this.s = settings;
    this.devices = devices;
    this.done = done;
    this.preview = preview;
    this.voice = new VoiceOver(document.getElementById('app') as HTMLElement);
    devices.onChange(() => {
      if (this.step !== 'devices') return;
      this.render();
      if (!this.assiomaSaid && this.hasAssioma()) {
        this.assiomaSaid = true;
        void this.voice.say('assioma');
      }
    });
  }

  private hasAssioma(): boolean {
    return this.devices.list().some((d) => /assioma/i.test(d.name));
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
    void this.voice.say(step === 'final' ? (this.wantFtp ? 'ftp' : 'finish') : step);
  }

  /** Aperçu du coureur pendant l'étape avatar, retiré aux autres étapes. */
  private syncPreview(): void {
    if (this.step === 'avatar') {
      this.previewOn = true;
      this.preview?.show({ ...DEFAULT_LOOK, ...this.s.look }, this.bareHead);
    } else if (this.previewOn) {
      this.previewOn = false;
      this.preview?.hide();
    }
  }

  private finish(ftp: boolean): void {
    this.voice.stop();
    if (this.previewOn) this.preview?.hide();
    this.previewOn = false;
    saveSettings(this.s);
    localStorage.setItem('ar.onboarded', new Date().toISOString());
    if (ftp) this.s.mode = 'ftpTest';
    else if (this.s.mode === 'ftpTest') this.s.mode = 'free';
    saveSettings(this.s);
    this.done(this.s, false);
  }

  private next(): void {
    saveSettings(this.s);
    const i = STEPS.indexOf(this.step);
    if (i < STEPS.length - 1) this.go(STEPS[i + 1] as Step);
    else this.finish(this.wantFtp);
  }

  private render(): void {
    const fr = getLang() === 'fr';
    const i = STEPS.indexOf(this.step);
    const dots = STEPS.map((_, k) => `<span style="display:inline-block;width:${k === i ? 26 : 8}px;height:8px;border-radius:4px;background:${k <= i ? 'var(--ar-accent)' : 'rgba(255,255,255,.2)'};margin-right:6px;transition:width .3s"></span>`).join('');
    let body = '';
    switch (this.step) {
      case 'welcome':
        body = `<h2>${fr ? 'Tutoriel' : 'Tutorial'}</h2>
          <div class="row"><button class="btn ${fr ? 'primary' : ''}" data-lang="fr">Français</button><button class="btn ${fr ? '' : 'primary'}" data-lang="en">English</button>
          <button class="btn small" id="o-voice" style="margin-left:auto;padding:8px 10px;display:flex;${this.voice.enabled ? '' : 'opacity:.55'}" title="${this.voice.enabled ? (fr ? 'Voix off activée' : 'Voice-over on') : fr ? 'Voix off coupée' : 'Voice-over off'}" aria-pressed="${this.voice.enabled}">${this.voice.enabled ? '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>' : '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/></svg>'}</button></div>
          <div class="warning" style="margin-top:16px;background:rgba(59,130,246,.12);border-color:rgba(59,130,246,.35);color:#bfdbfe">${fr ? 'Compte : la connexion Google, Discord ou lien magique sera proposée pour rouler en groupe. Pour une sortie seul, aucun compte n’est nécessaire.' : 'Account: Google, Discord or magic-link sign-in is offered for group rides. Riding solo needs no account.'}</div>`;
        break;
      case 'profile':
        body = `<h2>${t('profile')}</h2><div class="grid3">
          <label class="field">${t('name')}<input id="o-name" value="${this.s.name.replace(/"/g, '&quot;')}"/></label>
          <label class="field">${fr ? 'Je suis' : 'I am'}<div class="row">${(['male', 'female'] as const).map((x) => `<button class="btn small ${lookSex(this.s.look) === x ? 'primary' : ''}" data-sex="${x}">${x === 'male' ? (fr ? 'Un homme' : 'A man') : fr ? 'Une femme' : 'A woman'}</button>`).join('')}</div></label>
          <label class="field">${t('weight')}<input id="o-mass" type="number" min="30" max="200" step="0.5" value="${this.s.massKg}"/></label>
          <label class="field">${t('height')}<input id="o-height" type="number" min="120" max="220" value="${this.s.heightCm}"/></label>
          <label class="field">${t('ftp')}<input id="o-ftp" type="number" min="50" max="600" value="${this.s.ftpWatts}"/></label>
          <label class="field">${fr ? 'Je ne connais pas ma FTP' : "I don't know my FTP"}<button class="btn small ${this.wantFtp ? 'primary' : ''}" id="o-ftptest">${this.wantFtp ? (fr ? 'Test FTP prévu à la fin ✓' : 'FTP test planned at the end ✓') : fr ? 'Faire le test FTP' : 'Do the FTP test'}</button></label></div>`;
        break;
      case 'avatar': {
        const sw = (attr: string, colors: string[], cur: string) => colors.map((c) => `<button class="btn small" data-${attr}="${c}" style="background:${c};width:30px;height:30px;padding:0;border:${cur.toLowerCase() === c ? '3px solid #ffd23f' : '1px solid rgba(255,255,255,.35)'}"></button>`).join('');
        const look = this.s.look;
        const bald = look.hairStyle === 3;
        body = `<h2>Avatar</h2><div class="grid3 ob-avatar-grid">
          <label class="field">${fr ? 'Peau' : 'Skin'}<div class="row">${sw('skin', SKINS, look.skin)}</div></label>
          <label class="field">${fr ? 'Cheveux' : 'Hair'}<div class="row">${sw('hair', HAIRS, bald ? '' : look.hair)}<button class="btn small ${bald ? 'primary' : ''}" data-bald="1">${fr ? 'Chauve' : 'Bald'}</button></div></label>
          <label class="field">${fr ? 'Morphologie' : 'Build'}<input id="o-build" type="range" min="0" max="1" step="0.05" value="${look.build}"/></label>
          <label class="field">${fr ? 'Maillot' : 'Jersey'}<div class="row">${sw('jersey', JERSEYS, look.jersey)}</div></label>
          <label class="field">${fr ? 'Seconde couleur du maillot' : 'Jersey second colour'}<div class="row">${sw('accent', ACCENTS, look.jerseyAccent)}</div></label>
          <label class="field">${fr ? 'Casque' : 'Helmet'}<div class="row">${sw('helmet', HELMETS, look.helmet)}</div></label>
          <label class="field">${fr ? 'Chaussures' : 'Shoes'}<div class="row">${sw('shoes', SHOES, look.shoes ?? '#f2f2f2')}</div></label>
          <label class="field">${fr ? 'Vélo' : 'Bike'}<div class="row">${sw('bike', BIKES, look.bike)}</div></label></div>
          <p class="meta" style="font-size:13px;color:var(--ar-muted)">${fr ? 'Maillots, casques et vélos se débloquent en roulant : retrouve-les au garage.' : 'Jerseys, helmets and bikes unlock as you ride: find them in the garage.'}</p>
          <div class="device" style="margin-top:12px"><div><b>${fr ? 'Ressemblance à partir d’une photo' : 'Likeness from a photo'}</b>
            <div class="meta">${fr ? 'Visage, teint et cheveux estimés sur ton appareil ; la photo n’est ni envoyée ni conservée, seuls les réglages obtenus sont gardés (modifiables ou effaçables au garage). Uniquement une photo de toi.' : 'Face, skin and hair estimated on your device; the photo is never uploaded nor stored, only the resulting settings are kept (editable or erasable in the garage). Only a photo of yourself.'}</div>
            <label class="row" style="font-size:13px;margin-top:6px"><input type="checkbox" id="o-consent"/> ${fr ? 'J’accepte ce traitement local de ma photo' : 'I agree to this local processing of my photo'}</label></div>
            <label class="btn small" id="o-photo-label" style="opacity:.5">${fr ? 'Choisir une photo' : 'Choose a photo'}<input id="o-photo" type="file" accept="image/*" hidden disabled/></label></div>`;
        break;
      }
      case 'devices': {
        const list = this.devices.list();
        const transports = this.devices.transports();
        const roles: Array<[Parameters<DevicePanel['pair']>[0], string]> = [
          ['trainer', `1. ${t('trainer')}`],
          ['power', `2. ${fr ? 'Pédales ou capteur de puissance' : 'Pedals or power meter'}`],
          ['heartRate', `3. ${t('hrm')}`],
          ['cadence', `4. ${fr ? 'Capteur de cadence' : 'Cadence sensor'}`],
          ['shifter', `5. ${fr ? 'Commandes de vitesses' : 'Shifters'}`],
        ];
        body = `<h2>${t('devices')}</h2>
          ${transports.length ? '' : `<div class="warning">${t('noWebBluetooth')}</div>`}
          <div class="device-list">${roles
            .map(([role, label]) => {
              const d = list.find((x) => (x.roleIds ?? []).includes(role));
              return `<div class="device"><div><b>${label}</b><div class="meta">${d ? `${d.name} · ${d.state}` : fr ? 'non appairé' : 'not paired'}</div></div>${transports.length ? `<button class="btn small" data-pair="${role}">${t('pair')}</button>` : ''}</div>`;
            })
            .join('')}</div>
          ${this.devices
            .warnings()
            .map((w) => `<div class="warning">${w}</div>`)
            .join('')}
          ${this.hasAssioma() ? `<div class="warning" style="margin-top:10px;background:rgba(59,130,246,.12);border-color:rgba(59,130,246,.35);color:#bfdbfe">${t('oneAppAtATime')}<br/>${t('assiomaWarn')}<br/>${t('edgeWarn')}</div>` : ''}
          <p style="font-size:13px;color:var(--ar-muted)">${fr ? 'Pas de matériel sous la main ? Le simulateur prend le relais automatiquement.' : 'No hardware at hand? The simulator takes over automatically.'}</p>`;
        break;
      }
      case 'gears': {
        const cassette = this.s.drivetrain === 'cassette';
        const di2 = this.devices.di2Active?.() ?? false;
        body = `<h2>${t('gear')}</h2>
          <div class="grid2">
            <label class="field">${fr ? 'Sur le home trainer' : 'On the trainer'}<select id="o-drive">
              <option value="cog" ${cassette ? '' : 'selected'}>Zwift Cog — ${fr ? 'vitesses virtuelles gérées par le jeu' : 'virtual gears handled by the game'}</option>
              <option value="cassette" ${cassette ? 'selected' : ''}>${fr ? 'Cassette réelle (dérailleur)' : 'Real cassette'}</option></select></label>
            <div class="field">${fr ? 'Commandes' : 'Controls'}<div style="color:var(--ar-fg);font-size:14px;line-height:1.6">Di2 · Zwift Click / Play / Ride · ${fr ? 'manette' : 'gamepad'} · ${fr ? 'clavier ↑ ↓' : 'keyboard ↑ ↓'} · ${fr ? 'appli compagnon' : 'companion app'}</div></div>
            ${cassette ? `<label class="field">${fr ? 'Nombre de vitesses de la cassette' : 'Cassette speeds'}<select id="o-speeds">${CASSETTE_SPEEDS.map((n) => `<option value="${n}" ${this.s.cassetteSpeeds === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>` : ''}
            ${di2 ? `<label class="field">${fr ? 'Commandes Di2 détectées : ton modèle' : 'Di2 detected: your model'}<select id="o-di2"><option value="" ${this.s.di2Model ? '' : 'selected'}>${fr ? 'Choisir…' : 'Choose…'}</option>${DI2_MODELS.map(([v, f, e]) => `<option value="${v}" ${this.s.di2Model === v ? 'selected' : ''}>${fr ? f : e}</option>`).join('')}</select></label>` : ''}
          </div>`;
        break;
      }
      case 'companion':
        // Appli compagnon : son QR code (le même que dans les réglages), pour l'appairer tout de suite.
        body = `<h2>${fr ? 'Appli compagnon' : 'Companion app'}</h2>
          <div id="o-companion"></div>
          <p style="font-size:13px;color:var(--ar-muted);margin:10px 0 0">${fr ? 'Tu pourras le retrouver plus tard dans Réglages.' : 'You can find it later in Settings.'}</p>`;
        break;
      case 'final':
        body = this.wantFtp
          ? `<h2>${fr ? 'Le test FTP' : 'The FTP test'}</h2>
            <ol style="margin:0 0 12px;padding-left:20px;line-height:1.7">
              <li><b>${fr ? 'Échauffement' : 'Warm-up'}</b> — ${fr ? '5 min à 100 W, en mode ERG : le home trainer impose la puissance.' : '5 min at 100 W in ERG mode: the trainer sets the power.'}</li>
              <li><b>${fr ? 'Paliers' : 'Steps'}</b> — ${fr ? '+20 W chaque minute, cadence régulière autour de 85–95 tr/min.' : '+20 W every minute, steady cadence around 85–95 rpm.'}</li>
              <li><b>${fr ? 'Jusqu’au bout' : 'To the end'}</b> — ${fr ? 'arrête-toi quand tu ne tiens plus le palier (souvent 15 à 25 min).' : 'stop when you can no longer hold the step (often 15–25 min).'}</li>
              <li><b>${fr ? 'Résultat' : 'Result'}</b> — ${fr ? 'FTP = 75 % de ta meilleure minute ; elle règle tes zones et tes séances.' : 'FTP = 75% of your best minute; it sets your zones and workouts.'}</li>
            </ol>
            <p style="font-size:13px;color:var(--ar-muted)">${fr ? 'Bien reposé, ventilateur allumé, bidon à portée de main.' : 'Be rested, fan on, bottle within reach.'}</p>`
          : `<h2>${fr ? 'Tout est prêt !' : 'All set!'}</h2>`;
        break;
    }
    const side = this.step === 'avatar' && !!this.preview;
    this.root.innerHTML = `<div class="menu ob-menu ${side ? 'ob-preview' : ''}"><div class="ob-wrap">
      <div class="ob-hero"><h1>Allez <em>Robert</em> !</h1><p class="tagline">${fr ? 'Rouler ensemble, chacun chez soi.' : 'Ride together, each from home.'}</p></div>
      <div class="ob-stage">${side ? '' : '<span class="ob-robert" aria-hidden="true"></span>'}
      <div class="card panel onboarding ${side ? 'ob-side' : ''}">
      <div class="ob-progress">${dots}<span>${fr ? 'Étape' : 'Step'} ${i + 1} / ${STEPS.length}</span></div>${body}
      <div class="row" style="justify-content:space-between;margin-top:22px">
        ${i === STEPS.length - 1 ? '<span></span>' : `<button class="btn" id="o-skip">${fr ? 'Passer le tutoriel' : 'Skip tutorial'}</button>`}
        <div class="row">${i > 0 ? `<button class="btn" id="o-back">←</button>` : ''}${i === STEPS.length - 1 && this.wantFtp ? `<button class="btn" id="o-later">${fr ? 'Plus tard' : 'Later'}</button>` : ''}<button class="btn primary" id="o-next">${i === STEPS.length - 1 ? (this.wantFtp ? (fr ? 'Lancer le test FTP' : 'Start the FTP test') : fr ? 'Terminer ✓' : 'Finish ✓') : fr ? 'Suivant →' : 'Next →'}</button></div>
      </div></div></div></div></div>`;
    this.bind();
    enhanceSelects(this.root);
    this.placeTail();
    if (this.step === 'companion') renderCompanionSettings(this.root.querySelector('#o-companion'), true);
    this.syncPreview();
  }

  private tailObserver: ResizeObserver | null = null;

  /**
   * Queue de la bulle : vers la bouche de Robert (aux deux tiers de sa hauteur), mais jamais au-dessus du haut de
   * la carte (carte courte, comme la dernière étape) : Robert et la carte sont alignés par le bas.
   */
  private placeTail(): void {
    const stage = this.root.querySelector<HTMLElement>('.ob-stage');
    const card = stage?.querySelector<HTMLElement>('.card.onboarding');
    const robert = stage?.querySelector<HTMLElement>('.ob-robert');
    this.tailObserver?.disconnect();
    if (!stage || !card || !robert || typeof ResizeObserver === 'undefined') return;
    const place = () => stage.style.setProperty('--ob-tail', `${Math.max(20, Math.min(robert.offsetHeight * 0.66, card.offsetHeight - 70))}px`);
    this.tailObserver = new ResizeObserver(place);
    this.tailObserver.observe(card);
    this.tailObserver.observe(robert);
    place();
  }

  private bind(): void {
    const $ = <T extends HTMLElement>(id: string) => this.root.querySelector(`#${id}`) as T | null;
    $('o-next')?.addEventListener('click', () => this.next());
    $('o-back')?.addEventListener('click', () => this.go(STEPS[Math.max(0, STEPS.indexOf(this.step) - 1)] as Step));
    $('o-later')?.addEventListener('click', () => this.finish(false));
    $('o-skip')?.addEventListener('click', () => {
      this.voice.stop();
      if (this.previewOn) this.preview?.hide();
      this.previewOn = false;
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
    $('o-voice')?.addEventListener('click', () => {
      this.voice.setEnabled(!this.voice.enabled);
      this.render();
    });
    const num = (id: string, key: 'massKg' | 'heightCm' | 'ftpWatts') => $<HTMLInputElement>(id)?.addEventListener('change', (e) => (this.s[key] = Number((e.target as HTMLInputElement).value)));
    num('o-mass', 'massKg');
    num('o-height', 'heightCm');
    num('o-ftp', 'ftpWatts');
    $<HTMLInputElement>('o-name')?.addEventListener('change', (e) => (this.s.name = (e.target as HTMLInputElement).value.trim().slice(0, 24) || 'Robert'));
    $('o-ftptest')?.addEventListener('click', () => {
      this.wantFtp = !this.wantFtp;
      this.render();
    });
    const setLook = (patch: Partial<AvatarLook>, redraw: boolean) => {
      this.s.look = { ...DEFAULT_LOOK, ...this.s.look, ...patch };
      if (redraw) this.render();
      else this.preview?.show(this.s.look, this.bareHead);
    };
    const pick = (attr: 'skin' | 'hair' | 'jersey' | 'accent' | 'helmet' | 'bike' | 'shoes') =>
      this.root.querySelectorAll<HTMLButtonElement>(`[data-${attr}]`).forEach((b) =>
        b.addEventListener('click', () => {
          const c = b.dataset[attr] as string;
          if (attr === 'hair') return setLook({ hair: c, ...(this.s.look.hairStyle === 3 ? { hairStyle: 0 } : {}) }, true);
          // Couleur de vélo choisie : vélo de base peint de cette couleur (le modèle du garage est retiré).
          if (attr === 'bike') {
            const { bikeModel: _, ...rest } = { ...DEFAULT_LOOK, ...this.s.look };
            this.s.look = { ...rest, bike: c };
            return this.render();
          }
          setLook({ [attr === 'accent' ? 'jerseyAccent' : attr]: c }, true);
        }),
      );
    for (const a of ['skin', 'hair', 'jersey', 'accent', 'helmet', 'bike', 'shoes'] as const) pick(a);
    this.root.querySelectorAll<HTMLButtonElement>('[data-sex]').forEach((b) =>
      b.addEventListener('click', () => {
        this.s.look = withSex({ ...DEFAULT_LOOK, ...this.s.look }, b.dataset.sex as 'male' | 'female');
        this.render();
      }),
    );
    this.root.querySelectorAll<HTMLButtonElement>('[data-bald]').forEach((b) =>
      b.addEventListener('click', () => {
        setLook({ hairStyle: 3 }, true);
      }),
    );
    $<HTMLInputElement>('o-build')?.addEventListener('input', (e) => setLook({ build: Number((e.target as HTMLInputElement).value) }, false));
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
      const { likenessWithEditing } = await import('../ui/landmarkEditor.ts');
      const l = await likenessWithEditing(f);
      if (!l) return;
      this.s.look = withLikeness(this.s.look, l);
      this.render();
    });
    $<HTMLSelectElement>('o-drive')?.addEventListener('change', (e) => {
      this.s.drivetrain = (e.target as HTMLSelectElement).value as Settings['drivetrain'];
      this.render();
    });
    $<HTMLSelectElement>('o-speeds')?.addEventListener('change', (e) => (this.s.cassetteSpeeds = Number((e.target as HTMLSelectElement).value)));
    $<HTMLSelectElement>('o-di2')?.addEventListener('change', (e) => (this.s.di2Model = (e.target as HTMLSelectElement).value));
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
