/**
 * Musique de fond : playlist de morceaux originaux (public/music, voir ASSETS_LICENSES.md) jouée
 * dans un ordre aléatoire, enchaînée automatiquement, avec fondus. Activée par défaut, coupable
 * (ar.music = off), volume propre (ar.music.volume), atténuée en sortie, sous la voix du tutoriel,
 * et cédée à Spotify : dès que l'utilisateur lance Spotify, la musique du jeu reste coupée (même si
 * Spotify est mis en pause ou si on change d'écran) jusqu'à ce qu'il la rallume lui-même. Le navigateur n'autorise le son qu'après un geste de l'utilisateur : voir unlockOnGesture().
 */
import { followSink } from './devices.ts';

export interface Track {
  file: string;
  title: string;
}

export const PLAYLIST: Track[] = [
  { file: 'tempo.mp3', title: 'Tempo' },
  { file: 'a-bloc.mp3', title: 'À bloc' },
  { file: 'echappee.mp3', title: 'Échappée' },
];

const BASE = '/music/';
const EXTERNAL_KEY = 'ar.music.spotify';
/** Morceau joué en premier à l'ouverture. */
const FIRST_TRACK = 'echappee.mp3';
const FADE_S = 1.2;
/** Niveau de la musique sous la voix du tutoriel, et durées de la baisse et de la remontée. */
const VOICE_DUCK = 0.25;
const VOICE_DOWN_S = 0.3;
const VOICE_UP_S = 1;
/** Délai avant la remontée : la musique reste basse entre deux répliques qui s'enchaînent. */
const VOICE_RELEASE_MS = 700;

function shuffled<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j] as T, r[i] as T];
  }
  return r;
}

export class BackgroundMusic {
  private readonly el = (() => {
    const a = new Audio();
    followSink(a);
    return a;
  })();
  private order: Track[] = [];
  private index = -1;
  private duck = 1;
  /** Atténuation sous la voix du tutoriel (indépendante de setDuck, que Spotify réécrit). */
  private voice = 1;
  private voiceTimer: ReturnType<typeof setInterval> | null = null;
  private voiceRelease: ReturnType<typeof setTimeout> | null = null;
  /** Niveau du fondu en cours (0 → 1). */
  private fade = 0;
  private fadeTarget = 0;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  private unlocked = false;
  enabled = localStorage.getItem('ar.music') !== 'off';
  /** Spotify a la main (lancé par l'utilisateur) : la musique du jeu ne redémarre pas toute seule. */
  private external = localStorage.getItem(EXTERNAL_KEY) === '1';
  volume = Number(localStorage.getItem('ar.music.volume') ?? 0.5);
  /** Prévenu au changement de morceau (menu, HUD). */
  onTrack?: (t: Track) => void;

  constructor() {
    this.el.preload = 'auto';
    this.el.addEventListener('ended', () => this.next());
    // Fichier illisible : on passe au suivant plutôt que de rester muet.
    this.el.addEventListener('error', () => {
      if (this.playing) setTimeout(() => this.next(), 500);
    });
  }

  get playing(): boolean {
    return this.enabled && !this.external && this.unlocked && !this.el.paused;
  }

  /** Spotify a la main : la musique du jeu se tait en fondu et ne revient pas d'elle-même ; faux : elle peut repartir. */
  yieldToExternal(on: boolean): void {
    if (on === this.external) return;
    this.external = on;
    localStorage.setItem(EXTERNAL_KEY, on ? '1' : '0');
    if (on) this.fadeTo(0, () => this.el.pause());
    else if (this.enabled && this.unlocked) this.start();
  }

  get yielded(): boolean {
    return this.external;
  }

  get current(): Track | null {
    return this.order[this.index] ?? null;
  }

  /** Démarre au premier clic ou à la première touche (politique d'autoplay des navigateurs). */
  unlockOnGesture(): void {
    const hint = document.getElementById('music-hint');
    const go = () => {
      if (hint) hint.hidden = true;
      window.removeEventListener('pointerdown', go);
      window.removeEventListener('keydown', go);
      this.unlocked = true;
      if (this.enabled && !this.external) this.start();
    };
    window.addEventListener('pointerdown', go);
    window.addEventListener('keydown', go);
    if (!this.enabled || this.external) return;
    // Musique dès l'ouverture quand le navigateur l'autorise (site déjà écouté, appli de bureau) ;
    // sinon petite invitation jusqu'au premier clic ou à la première touche.
    this.start();
    void this.el
      .play()
      .then(() => {
        window.removeEventListener('pointerdown', go);
        window.removeEventListener('keydown', go);
      })
      .catch(() => {
        if (hint) hint.hidden = false;
      });
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    localStorage.setItem('ar.music', on ? 'on' : 'off');
    // Rallumer la musique du jeu à la main reprend la main à Spotify.
    if (on) this.external = false;
    localStorage.setItem(EXTERNAL_KEY, this.external ? '1' : '0');
    if (on) this.start();
    else this.fadeTo(0, () => this.el.pause());
  }

  toggle(): boolean {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  setVolume(v: number): void {
    this.volume = v;
    localStorage.setItem('ar.music.volume', String(v));
    this.apply();
  }

  /** Atténuation contextuelle : plus bas en sortie, silence quand Spotify joue. */
  setDuck(f: number): void {
    if (f === this.duck) return;
    this.duck = f;
    this.apply();
  }

  /** Voix du tutoriel en cours : musique baissée en douceur, puis remontée après la dernière réplique. */
  talkOver(on: boolean): void {
    if (this.voiceRelease) clearTimeout(this.voiceRelease);
    this.voiceRelease = null;
    if (on) this.rampVoice(VOICE_DUCK, VOICE_DOWN_S);
    else this.voiceRelease = setTimeout(() => this.rampVoice(1, VOICE_UP_S), VOICE_RELEASE_MS);
  }

  private rampVoice(target: number, seconds: number): void {
    if (this.voiceTimer) clearInterval(this.voiceTimer);
    const step = (0.05 * (1 - VOICE_DUCK)) / seconds;
    this.voiceTimer = setInterval(() => {
      const d = target - this.voice;
      this.voice = Math.abs(d) <= step ? target : this.voice + Math.sign(d) * step;
      this.apply();
      if (this.voice === target) {
        clearInterval(this.voiceTimer as ReturnType<typeof setInterval>);
        this.voiceTimer = null;
      }
    }, 50);
  }

  /** Morceau suivant (fondu enchaîné). */
  next(): void {
    if (!this.enabled || this.external) return;
    this.fadeTo(0, () => this.load(this.index + 1));
  }

  /** Morceau précédent (le premier de la liste repart du début). */
  previous(): void {
    if (!this.enabled || this.external) return;
    this.fadeTo(0, () => this.load(Math.max(this.index - 1, 0)));
  }

  private start(): void {
    this.unlocked = true;
    if (this.index < 0) this.load(0);
    else {
      void this.el.play().catch(() => undefined);
      this.fadeTo(1);
    }
  }

  private load(i: number): void {
    if (i >= this.order.length || this.order.length === 0) {
      const last = this.current;
      this.order = shuffled(PLAYLIST);
      // Premier morceau de la session : toujours « Échappée », la suite au hasard.
      if (!last) {
        const first = PLAYLIST.find((t) => t.file === FIRST_TRACK);
        if (first) this.order = [first, ...this.order.filter((t) => t !== first)];
      }
      // Pas deux fois le même morceau d'affilée au changement de tour.
      if (last && this.order[0] === last && this.order.length > 1) this.order.push(this.order.shift() as Track);
      i = 0;
    }
    this.index = i;
    const t = this.order[i] as Track;
    this.el.src = BASE + t.file;
    this.fade = 0;
    this.apply();
    void this.el.play().catch(() => undefined);
    this.fadeTo(1);
    this.onTrack?.(t);
  }

  private apply(): void {
    this.el.volume = Math.max(0, Math.min(1, this.volume * this.duck * this.voice * this.fade));
  }

  private fadeTo(target: number, done?: () => void): void {
    this.fadeTarget = target;
    if (this.fadeTimer) clearInterval(this.fadeTimer);
    const stepPerTick = 0.05 / FADE_S;
    this.fadeTimer = setInterval(() => {
      const d = this.fadeTarget - this.fade;
      this.fade = Math.abs(d) <= stepPerTick ? this.fadeTarget : this.fade + Math.sign(d) * stepPerTick;
      this.apply();
      if (this.fade === this.fadeTarget) {
        clearInterval(this.fadeTimer as ReturnType<typeof setInterval>);
        this.fadeTimer = null;
        done?.();
      }
    }, 50);
  }
}

/** Instance unique partagée par le menu et la sortie. */
export const music = new BackgroundMusic();
