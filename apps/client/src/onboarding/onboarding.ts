import { withLikeness } from '../ui/faceEditorLogic.ts';
import { enhanceSelects } from '../ui/dropdown.ts';
import { COUNTRIES, DEFAULT_LOOK, lookSex, withSex, type AvatarLook } from '@allezrobert/shared';
import '../ui/blocks.css';
import './onboarding.css';
import { getLang, setLang, strings, t } from '../i18n/index.ts';
import type { DevicePanel } from '../ui/menu.ts';
import { saveSettings, type Settings } from '../ui/settings.ts';
import { VoiceOver } from './voice.ts';
import { renderCompanionSettings } from '../ui/companionQr.ts';
import { GRAPHIC_STYLE, STYLE_KEY, setGraphicStyle, type GraphicStyle } from '../engine/style.ts';

// Premier lancement : accueil, style graphique, équipement (capteurs, vitesses), profil, avatar, puis la page
// finale (test FTP si demandé, sinon le mot de la fin).
const STEPS = ['welcome', 'style', 'devices', 'gears', 'companion', 'profile', 'avatar', 'final'] as const;
type Step = (typeof STEPS)[number];

/** Étape où reprendre le tutoriel après le rechargement qu'impose un changement de style graphique. */
const RESUME_KEY = 'ar.onboarding.resume';
const S = strings(
  {
    tagline: 'Rouler ensemble, chacun chez soi.',
    step: 'Étape {i} / {n}',
    skip: 'Passer le tutoriel',
    back: 'Retour',
    later: 'Plus tard',
    startFtp: 'Lancer le test FTP',
    finish: 'Terminer',
    next: 'Suivant',
    // Accueil
    tutorial: 'Tutoriel',
    welcomeSub: 'Quelques minutes pour régler ton matériel, ton profil et ton avatar.',
    language: 'Langue',
    voiceOn: 'Voix off activée',
    voiceOff: 'Voix off coupée',
    voiceOnState: 'Activée',
    voiceOffState: 'Coupée',
    voice: 'Voix off',
    voiceDetail: 'Robert lit chaque étape à voix haute.',
    // Style
    styleTitle: 'Style graphique',
    styleSub: 'Comment veux-tu voir la route ?',
    styleReal: 'Réaliste',
    styleRealDetail: 'Une vue plus réaliste, au plus près des vraies routes : relief, lumière et matières.',
    styleLowpoly: 'Jeu vidéo',
    styleLowpolyDetail: 'Un mode plus ludique : formes simples, plus léger, un monde plus animé.',
    chosen: 'Choisi',
    styleHint: 'Tu pourras en changer quand tu veux dans Réglages.',
    // Profil
    profileSub: 'Poids et taille servent à la physique ; la FTP règle tes zones.',
    iAm: 'Je suis',
    man: 'Un homme',
    woman: 'Une femme',
    nationality: 'Nationalité',
    chooseCountry: 'Choisir mon pays',
    unknownFtp: 'Je ne connais pas ma FTP',
    ftpPlanned: 'Test FTP prévu à la fin ✓',
    doFtp: 'Faire le test FTP',
    // Avatar
    avatarSub: 'Teint, coiffure et couleurs ; le reste se débloque en roulant.',
    skin: 'Peau',
    hair: 'Cheveux',
    bald: 'Chauve',
    hairstyle: 'Coiffure',
    build: 'Morphologie',
    jersey: 'Maillot',
    jersey2: 'Seconde couleur du maillot',
    helmet: 'Casque',
    shoes: 'Chaussures',
    bike: 'Vélo',
    unlockHint: 'Maillots, casques et vélos se débloquent en roulant : retrouve-les au garage.',
    likeness: 'Ressemblance à partir d’une photo',
    likenessDetail: 'Visage, teint et cheveux estimés sur ton appareil ; la photo n’est ni envoyée ni conservée, seuls les réglages obtenus sont gardés (modifiables ou effaçables au garage). Uniquement une photo de toi.',
    consent: 'J’accepte ce traitement local de ma photo',
    choosePhoto: 'Choisir une photo',
    hShort: 'Courts',
    hFade: 'Dégradé',
    hCurly: 'Bouclés',
    hQuiff: 'Coiffé',
    hBob: 'Carré',
    hLong: 'Longs',
    hBun: 'Chignon',
    hPony: 'Queue',
    hBraids: 'Deux tresses',
    hBraidPony: 'Queue tressée',
    // Capteurs
    devicesSub: 'Réveille ton matériel en pédalant un peu, puis appaire-le.',
    powerRole: 'Pédales ou capteur de puissance',
    cadenceRole: 'Capteur de cadence',
    shifterRole: 'Commandes de vitesses',
    notPaired: 'Non appairé',
    paired: 'Appairé',
    noHardware: 'Pas de matériel sous la main ? Le simulateur prend le relais automatiquement.',
    // Vitesses
    gearsSub: 'Vitesses gérées par le jeu, ou ta vraie cassette.',
    onTrainer: 'Sur le home trainer',
    virtualGears: 'vitesses virtuelles gérées par le jeu',
    realCassette: 'Cassette réelle (dérailleur)',
    controls: 'Commandes',
    gamepad: 'manette',
    keyboard: 'clavier ↑ ↓',
    companionApp: 'appli compagnon',
    cassetteSpeeds: 'Nombre de vitesses de la cassette',
    di2Detected: 'Commandes Di2 détectées : ton modèle',
    choose: 'Choisir…',
    di2Other: 'Autre / je ne sais pas',
    // Compagnon
    companionTitle: 'Appli compagnon',
    companionSub: 'Ton téléphone devient ta télécommande.',
    companionHint: 'Tu pourras le retrouver plus tard dans Réglages.',
    // Fin
    ftpTitle: 'Le test FTP',
    ftpSub: 'Une rampe d’une vingtaine de minutes pour mesurer ta FTP.',
    warmup: 'Échauffement',
    warmupText: '5 min à 100 W, en mode ERG : le home trainer impose la puissance.',
    steps: 'Paliers',
    stepsText: '+20 W chaque minute, cadence régulière entre 70 et 100 tr/min.',
    toTheEnd: 'Jusqu’au bout',
    toTheEndText: 'Arrête-toi quand tu ne tiens plus le palier (souvent 15 à 25 min).',
    result: 'Résultat',
    resultText: 'FTP = 75 % de ta meilleure minute ; elle règle tes zones et tes séances.',
    ftpPrep: 'Bien reposé, ventilateur allumé, bidon à portée de main.',
    allSet: 'Tout est prêt !',
    allSetSub: 'Amuse-toi bien, seul ou entre amis.',
  },
  {
    tagline: 'Ride together, each from home.',
    step: 'Step {i} / {n}',
    skip: 'Skip tutorial',
    back: 'Back',
    later: 'Later',
    startFtp: 'Start the FTP test',
    finish: 'Finish',
    next: 'Next',
    tutorial: 'Tutorial',
    welcomeSub: 'A few minutes to set up your gear, profile and avatar.',
    language: 'Language',
    voiceOn: 'Voice-over on',
    voiceOff: 'Voice-over off',
    voiceOnState: 'On',
    voiceOffState: 'Off',
    voice: 'Voice-over',
    voiceDetail: 'Robert reads each step aloud.',
    styleTitle: 'Graphic style',
    styleSub: 'How do you want to see the road?',
    styleReal: 'Realistic',
    styleRealDetail: 'A more realistic view, close to the real roads: terrain, light and materials.',
    styleLowpoly: 'Video game',
    styleLowpolyDetail: 'A more playful mode: simple shapes, lighter, a livelier world.',
    chosen: 'Selected',
    styleHint: 'You can change it any time in Settings.',
    profileSub: 'Weight and height drive the physics; FTP sets your zones.',
    iAm: 'I am',
    man: 'A man',
    woman: 'A woman',
    nationality: 'Nationality',
    chooseCountry: 'Choose my country',
    unknownFtp: "I don't know my FTP",
    ftpPlanned: 'FTP test planned at the end ✓',
    doFtp: 'Do the FTP test',
    avatarSub: 'Skin, hair and colours; the rest unlocks as you ride.',
    skin: 'Skin',
    hair: 'Hair',
    bald: 'Bald',
    hairstyle: 'Hairstyle',
    build: 'Build',
    jersey: 'Jersey',
    jersey2: 'Jersey second colour',
    helmet: 'Helmet',
    shoes: 'Shoes',
    bike: 'Bike',
    unlockHint: 'Jerseys, helmets and bikes unlock as you ride: find them in the garage.',
    likeness: 'Likeness from a photo',
    likenessDetail: 'Face, skin and hair estimated on your device; the photo is never uploaded nor stored, only the resulting settings are kept (editable or erasable in the garage). Only a photo of yourself.',
    consent: 'I agree to this local processing of my photo',
    choosePhoto: 'Choose a photo',
    hShort: 'Short',
    hFade: 'Fade',
    hCurly: 'Curly',
    hQuiff: 'Quiff',
    hBob: 'Bob',
    hLong: 'Long',
    hBun: 'Bun',
    hPony: 'Ponytail',
    hBraids: 'Two braids',
    hBraidPony: 'Braided ponytail',
    devicesSub: 'Wake your gear by pedalling a little, then pair it.',
    powerRole: 'Pedals or power meter',
    cadenceRole: 'Cadence sensor',
    shifterRole: 'Shifters',
    notPaired: 'Not paired',
    paired: 'Paired',
    noHardware: 'No hardware at hand? The simulator takes over automatically.',
    gearsSub: 'Gears handled by the game, or your real cassette.',
    onTrainer: 'On the trainer',
    virtualGears: 'virtual gears handled by the game',
    realCassette: 'Real cassette',
    controls: 'Controls',
    gamepad: 'gamepad',
    keyboard: 'keyboard ↑ ↓',
    companionApp: 'companion app',
    cassetteSpeeds: 'Cassette speeds',
    di2Detected: 'Di2 detected: your model',
    choose: 'Choose…',
    di2Other: 'Other / not sure',
    companionTitle: 'Companion app',
    companionSub: 'Your phone becomes your remote.',
    companionHint: 'You can find it later in Settings.',
    ftpTitle: 'The FTP test',
    ftpSub: 'A ramp of about twenty minutes to measure your FTP.',
    warmup: 'Warm-up',
    warmupText: '5 min at 100 W in ERG mode: the trainer sets the power.',
    steps: 'Steps',
    stepsText: '+20 W every minute, steady cadence between 70 and 100 rpm.',
    toTheEnd: 'To the end',
    toTheEndText: 'Stop when you can no longer hold the step (often 15–25 min).',
    result: 'Result',
    resultText: 'FTP = 75% of your best minute; it sets your zones and workouts.',
    ftpPrep: 'Be rested, fan on, bottle within reach.',
    allSet: 'All set!',
    allSetSub: 'Have fun, on your own or with friends.',
  },
);
type Key = Parameters<typeof S>[0];
const fill = (tpl: string, v: Record<string, string | number>): string => tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));

/** Les deux styles, avec une vue du garage dans chacun. */
const STYLES: Array<[GraphicStyle, Key, Key]> = [
  ['real', 'styleReal', 'styleRealDetail'],
  ['lowpoly', 'styleLowpoly', 'styleLowpolyDetail'],
];

const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#5c3a21'];
const HAIRS = ['#1f1a17', '#3b2a1e', '#6a4e35', '#b88a52', '#d9c08a', '#9a9a9a'];
/** Quelques couleurs de départ : le reste se débloque en roulant (garage). */
const JERSEYS = ['#1f6feb', '#d62828', '#ffffff', '#2a9d8f', '#f4a261', '#111111'];
const ACCENTS = ['#ffd23f', '#ffffff', '#111111', '#d62828', '#1f6feb', '#2a9d8f'];
const SHOES = ['#f2f2f2', '#111418', '#1e5bd8', '#c0392b', '#d7f205', '#ff7a1a'];
/** Coiffures proposées au tutoriel (les autres sont dans l'éditeur de visage du garage). */
const HAIR_CHOICES: Array<[number, Key]> = [[0, 'hShort'], [4, 'hFade'], [5, 'hCurly'], [8, 'hQuiff'], [6, 'hBob'], [9, 'hLong'], [7, 'hBun'], [1, 'hPony'], [10, 'hBraids'], [11, 'hBraidPony']];
const HELMETS = ['#f4f4f4', '#111111', '#1f6feb', '#d62828', '#ffd23f'];
const BIKES = ['#c0392b', '#111111', '#e8ecf0', '#1f6feb', '#2e7d32'];
const CASSETTE_SPEEDS = [8, 9, 10, 11, 12, 13];
/** Modèles Di2 : noms de marque (non traduits), sauf « autre ». */
const DI2_MODELS: Array<[string, string | null]> = [
  ['dura-ace', 'Dura-Ace Di2'],
  ['ultegra', 'Ultegra Di2'],
  ['105', '105 Di2'],
  ['grx', 'GRX Di2'],
  ['other', null],
];

/** Icônes au trait des blocs (24 × 24, couleur du texte). */
const ico = (path: string): string => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const ICON_SENSOR = ico('<circle cx="12" cy="12" r="3"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/>');

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
  /** Aperçu tête nue pour choisir teint et coiffure ; le casque revient quand on en choisit la couleur. */
  private bareHead = true;
  /** Test FTP demandé à l'étape profil : proposé sur la page finale. */
  private wantFtp = false;
  private assiomaSaid = false;
  /** Style choisi à l'étape style (appliqué en quittant l'étape : la page se recharge s'il change). */
  private style: GraphicStyle = GRAPHIC_STYLE;

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
    const resume = sessionStorage.getItem(RESUME_KEY) as Step | null;
    sessionStorage.removeItem(RESUME_KEY);
    this.go(resume && STEPS.includes(resume) ? resume : 'welcome');
  }

  private go(step: Step): void {
    this.step = step;
    this.voice.stop();
    this.render();
    void this.voice.say(step === 'final' ? (this.wantFtp ? 'ftp' : 'finish') : step);
  }

  private previewFrame = 0;
  /** Redessin de l'aperçu au plus une fois par image : le curseur émet bien plus d'événements que l'écran n'affiche d'images. */
  private queuePreview(): void {
    if (this.previewFrame) return;
    this.previewFrame = requestAnimationFrame(() => {
      this.previewFrame = 0;
      if (this.previewOn) this.preview?.show({ ...DEFAULT_LOOK, ...this.s.look }, this.bareHead);
    });
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
    // Matériaux construits au chargement : un autre style recharge la page, le tutoriel reprend à l'étape suivante.
    if (this.step === 'style') {
      if (this.style !== GRAPHIC_STYLE) {
        this.voice.stop();
        sessionStorage.setItem(RESUME_KEY, STEPS[i + 1] as Step);
        return setGraphicStyle(this.style);
      }
      localStorage.setItem(STYLE_KEY, this.style);
    }
    if (i < STEPS.length - 1) this.go(STEPS[i + 1] as Step);
    else this.finish(this.wantFtp);
  }

  private render(): void {
    const fr = getLang() === 'fr';
    const i = STEPS.indexOf(this.step);
    const dots = STEPS.map((_, k) => `<span class="ob-dot${k === i ? ' now' : k < i ? ' done' : ''}"></span>`).join('');
    const last = i === STEPS.length - 1;
    let title = '';
    let sub = '';
    let body = '';
    switch (this.step) {
      case 'welcome': {
        title = S('tutorial');
        sub = S('welcomeSub');
        body = `<h3 class="ab-section">${S('language')}</h3>
          <div class="ab-grid ab-grid-2 ob-langs">${(['fr', 'en'] as const)
            .map((l) => `<button type="button" class="ab-tile ab-plain ${fr === (l === 'fr') ? 'is-on' : ''}" data-lang="${l}" aria-pressed="${fr === (l === 'fr')}"><span class="ab-name">${l === 'fr' ? 'Français' : 'English'}</span></button>`)
            .join('')}</div>`;
        break;
      }
      case 'style':
        title = S('styleTitle');
        sub = S('styleSub');
        body = `<div class="ob-styles">${STYLES.map(([v, name, detail]) => `<button type="button" class="ab-tile ab-plain ob-style ${this.style === v ? 'on is-on' : ''}" data-gstyle="${v}" aria-pressed="${this.style === v}">
            <img src="/onboarding/style-${v}.jpg" alt=""/><span class="ab-name">${S(name)}</span><span class="ab-detail">${S(detail)}</span>${this.style === v ? `<span class="ab-state is-ok"><i></i>${S('chosen')}</span>` : ''}</button>`).join('')}</div>
          <p class="ob-note">${S('styleHint')}</p>`;
        break;
      case 'profile':
        title = t('profile');
        sub = S('profileSub');
        body = `<div class="grid3">
          <label class="field">${t('name')}<input id="o-name" value="${this.s.name.replace(/"/g, '&quot;')}"/></label>
          <label class="field">${S('iAm')}<div class="row">${(['male', 'female'] as const).map((x) => `<button type="button" class="ab-btn ob-pick ${lookSex(this.s.look) === x ? 'is-on' : ''}" data-sex="${x}" aria-pressed="${lookSex(this.s.look) === x}">${x === 'male' ? S('man') : S('woman')}</button>`).join('')}</div></label>
          <label class="field">${S('nationality')}<select id="o-nation"><option value="" ${this.s.look.nationality ? '' : 'selected'}>${S('chooseCountry')}</option>${[...COUNTRIES]
            .sort((a, b) => a[fr ? 'fr' : 'en'].localeCompare(b[fr ? 'fr' : 'en'], fr ? 'fr' : 'en'))
            .map((c) => `<option value="${c.code}" data-flag="${c.code}" ${this.s.look.nationality === c.code ? 'selected' : ''}>${c[fr ? 'fr' : 'en']}</option>`)
            .join('')}</select></label>
          <label class="field">${t('weight')}<input id="o-mass" type="number" min="30" max="200" step="0.5" value="${this.s.massKg}"/></label>
          <label class="field">${t('height')}<input id="o-height" type="number" min="120" max="220" value="${this.s.heightCm}"/></label>
          <label class="field">${t('ftp')}<input id="o-ftp" type="number" min="50" max="600" value="${this.s.ftpWatts}"/></label>
          <label class="field">${S('unknownFtp')}<button type="button" class="ab-btn ob-pick ${this.wantFtp ? 'is-on' : ''}" id="o-ftptest" aria-pressed="${this.wantFtp}">${this.wantFtp ? S('ftpPlanned') : S('doFtp')}</button></label></div>`;
        break;
      case 'avatar': {
        const sw = (attr: string, colors: string[], cur: string) => colors.map((c) => `<button type="button" class="ob-sw ${cur.toLowerCase() === c.toLowerCase() ? 'on' : ''}" data-${attr}="${c}" style="--c:${c}" title="${c}" aria-label="${c}" aria-pressed="${cur.toLowerCase() === c.toLowerCase()}"></button>`).join('');
        const look = this.s.look;
        const bald = look.hairStyle === 3;
        const pick = (on: boolean) => `ab-btn ob-pick ${on ? 'is-on' : ''}" aria-pressed="${on}`;
        title = 'Avatar';
        sub = S('avatarSub');
        body = `<div class="grid3 ob-avatar-grid">
          <label class="field wide">${S('iAm')}<div class="row">${(['male', 'female'] as const).map((x) => `<button type="button" class="${pick(lookSex(look) === x)}" data-sex="${x}">${x === 'male' ? S('man') : S('woman')}</button>`).join('')}</div></label>
          <label class="field">${S('skin')}<div class="row">${sw('skin', SKINS, look.skin)}</div></label>
          <label class="field">${S('hair')}<div class="row">${sw('hair', HAIRS, bald ? '' : look.hair)}<button type="button" class="${pick(bald)}" data-bald="1">${S('bald')}</button></div></label>
          <label class="field wide">${S('hairstyle')}<div class="row">${HAIR_CHOICES.map(([v, k]) => `<button type="button" class="${pick(look.hairStyle === v)}" data-hstyle="${v}">${S(k)}</button>`).join('')}</div></label>
          <label class="field">${S('build')}<input id="o-build" type="range" min="0" max="1" step="0.05" value="${look.build}"/></label>
          <label class="field">${S('jersey')}<div class="row">${sw('jersey', JERSEYS, look.jersey)}</div></label>
          <label class="field">${S('jersey2')}<div class="row">${sw('accent', ACCENTS, look.jerseyAccent)}</div></label>
          <label class="field">${S('helmet')}<div class="row">${sw('helmet', HELMETS, look.helmet)}</div></label>
          <label class="field">${S('shoes')}<div class="row">${sw('shoes', SHOES, look.shoes ?? '#f2f2f2')}</div></label>
          <label class="field">${S('bike')}<div class="row">${sw('bike', BIKES, look.bike)}</div></label></div>
          <p class="ob-note">${S('unlockHint')}</p>
          <div class="ab-tile ab-plain ob-likeness"><span class="ab-name">${S('likeness')}</span>
            <p class="ab-detail">${S('likenessDetail')}</p>
            <div class="ob-likeness-row"><label class="ob-consent"><input type="checkbox" id="o-consent"/> ${S('consent')}</label>
            <label class="ab-btn" id="o-photo-label" style="opacity:.5">${S('choosePhoto')}<input id="o-photo" type="file" accept="image/*" hidden disabled/></label></div></div>`;
        break;
      }
      case 'devices': {
        const list = this.devices.list();
        const transports = this.devices.transports();
        const roles: Array<[Parameters<DevicePanel['pair']>[0], string]> = [
          ['trainer', t('trainer')],
          ['power', S('powerRole')],
          ['heartRate', t('hrm')],
          ['cadence', S('cadenceRole')],
          ['shifter', S('shifterRole')],
        ];
        title = t('devices');
        sub = S('devicesSub');
        body = `${transports.length ? '' : `<div class="warning">${t('noWebBluetooth')}</div>`}
          <div class="ob-devices">${roles
            .map(([role, label], k) => {
              const d = list.find((x) => (x.roleIds ?? []).includes(role));
              return `<div class="ab-tile ${d ? 'is-ok' : ''}"><span class="ab-ico sm">${ICON_SENSOR}</span><span class="ab-name">${k + 1}. ${label}</span><span class="ab-detail">${d ? `${d.name} · ${d.state}` : S('notPaired')}</span><span class="ab-state"><i></i>${d ? S('paired') : S('notPaired')}</span>${transports.length ? `<button type="button" class="ab-btn ab-chip" data-pair="${role}">${t('pair')}</button>` : ''}</div>`;
            })
            .join('')}</div>
          ${this.devices
            .warnings()
            .map((w) => `<div class="warning">${w}</div>`)
            .join('')}
          ${this.hasAssioma() ? `<div class="warning ob-info">${t('oneAppAtATime')}<br/>${t('assiomaWarn')}<br/>${t('edgeWarn')}</div>` : ''}
          <p class="ob-note">${S('noHardware')}</p>`;
        break;
      }
      case 'gears': {
        const cassette = this.s.drivetrain === 'cassette';
        const di2 = this.devices.di2Active?.() ?? false;
        title = t('gear');
        sub = S('gearsSub');
        body = `<div class="grid2">
            <label class="field">${S('onTrainer')}<select id="o-drive">
              <option value="cog" ${cassette ? '' : 'selected'}>Zwift Cog — ${S('virtualGears')}</option>
              <option value="cassette" ${cassette ? 'selected' : ''}>${S('realCassette')}</option></select></label>
            <div class="field">${S('controls')}<div class="ob-controls">Di2 · Zwift Click / Play / Ride · ${S('gamepad')} · ${S('keyboard')} · ${S('companionApp')}</div></div>
            ${cassette ? `<label class="field">${S('cassetteSpeeds')}<select id="o-speeds">${CASSETTE_SPEEDS.map((n) => `<option value="${n}" ${this.s.cassetteSpeeds === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>` : ''}
            ${di2 ? `<label class="field">${S('di2Detected')}<select id="o-di2"><option value="" ${this.s.di2Model ? '' : 'selected'}>${S('choose')}</option>${DI2_MODELS.map(([v, name]) => `<option value="${v}" ${this.s.di2Model === v ? 'selected' : ''}>${name ?? S('di2Other')}</option>`).join('')}</select></label>` : ''}
          </div>`;
        break;
      }
      case 'companion':
        // Appli compagnon : son QR code (le même que dans les réglages), pour l'appairer tout de suite.
        title = S('companionTitle');
        sub = S('companionSub');
        body = `<div id="o-companion"></div>
          <p class="ob-note">${S('companionHint')}</p>`;
        break;
      case 'final':
        if (this.wantFtp) {
          title = S('ftpTitle');
          sub = S('ftpSub');
          body = `<div class="ab-grid ab-grid-2 ob-ftp">${(
            [
              ['warmup', 'warmupText'],
              ['steps', 'stepsText'],
              ['toTheEnd', 'toTheEndText'],
              ['result', 'resultText'],
            ] as Array<[Key, Key]>
          )
            .map(([n, d], k) => `<div class="ab-tile ab-plain"><span class="ab-name">${k + 1}. ${S(n)}</span><p class="ab-detail">${S(d)}</p></div>`)
            .join('')}</div>
            <p class="ob-note">${S('ftpPrep')}</p>`;
        } else {
          title = S('allSet');
          sub = S('allSetSub');
        }
        break;
    }
    const side = this.step === 'avatar' && !!this.preview;
    const keepScroll = this.root.querySelector<HTMLElement>('.card.onboarding')?.scrollTop ?? 0;
    const nextLabel = last ? (this.wantFtp ? S('startFtp') : `${S('finish')} ✓`) : `${S('next')} →`;
    this.root.innerHTML = `<div class="menu ob-menu ${side ? 'ob-preview' : ''}"><div class="ob-wrap">
      <div class="ob-hero"><h1>Allez <em>Robert</em> !</h1><p class="tagline">${S('tagline')}</p></div>
      <div class="ob-stage">${side ? '' : '<span class="ob-robert" aria-hidden="true"></span>'}
      <div class="card panel onboarding ob-blocks ${side ? 'ob-side' : ''}">
      <div class="ob-progress" aria-hidden="true">${dots}<span>${fill(S('step'), { i: i + 1, n: STEPS.length })}</span></div>
      <header class="ob-head"><h2 class="ab-title">${title}</h2>${sub ? `<p class="ab-sub">${sub}</p>` : ''}</header>
      ${body}
      <div class="ab-foot ob-foot">
        ${last ? '' : `<button type="button" class="ab-btn ob-skip" id="o-skip">${S('skip')}</button>`}
        <div class="ab-btns">${i > 0 ? `<button type="button" class="ab-btn" id="o-back" aria-label="${S('back')}">← ${S('back')}</button>` : ''}${last && this.wantFtp ? `<button type="button" class="ab-btn" id="o-later">${S('later')}</button>` : ''}<button type="button" class="ab-btn ab-go" id="o-next">${nextLabel}</button></div>
      </div></div></div></div></div>`;
    if (keepScroll) {
      const card = this.root.querySelector<HTMLElement>('.card.onboarding');
      if (card) card.scrollTop = keepScroll;
    }
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
    this.root.querySelectorAll<HTMLButtonElement>('[data-gstyle]').forEach((b) =>
      b.addEventListener('click', () => {
        this.style = b.dataset.gstyle as GraphicStyle;
        this.render();
      }),
    );
    const num = (id: string, key: 'massKg' | 'heightCm' | 'ftpWatts') => $<HTMLInputElement>(id)?.addEventListener('change', (e) => (this.s[key] = Number((e.target as HTMLInputElement).value)));
    num('o-mass', 'massKg');
    num('o-height', 'heightCm');
    num('o-ftp', 'ftpWatts');
    // Nationalité : drapeau montré aux autres coureurs (comme dans l'onglet Profil).
    $<HTMLSelectElement>('o-nation')?.addEventListener('change', (e) => {
      const code = (e.target as HTMLSelectElement).value;
      const { nationality: _old, ...rest } = this.s.look;
      this.s.look = code ? { ...rest, nationality: code } : rest;
    });
    $<HTMLInputElement>('o-name')?.addEventListener('change', (e) => (this.s.name = (e.target as HTMLInputElement).value.trim().slice(0, 24) || 'Robert'));
    $('o-ftptest')?.addEventListener('click', () => {
      this.wantFtp = !this.wantFtp;
      this.render();
    });
    const setLook = (patch: Partial<AvatarLook>, redraw: boolean) => {
      this.s.look = { ...DEFAULT_LOOK, ...this.s.look, ...patch };
      if (redraw) this.render();
      else this.queuePreview();
    };
    const pick = (attr: 'skin' | 'hair' | 'jersey' | 'accent' | 'helmet' | 'bike' | 'shoes') =>
      this.root.querySelectorAll<HTMLButtonElement>(`[data-${attr}]`).forEach((b) =>
        b.addEventListener('click', () => {
          const c = b.dataset[attr] as string;
          this.bareHead = attr !== 'helmet';
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
    this.root.querySelectorAll<HTMLButtonElement>('[data-hstyle]').forEach((b) =>
      b.addEventListener('click', () => {
        this.bareHead = true;
        setLook({ hairStyle: Number(b.dataset.hstyle) }, true);
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
