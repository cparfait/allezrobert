/**
 * Musique de fond : playlist de morceaux originaux (public/music, voir ASSETS_LICENSES.md) jouée
 * dans un ordre aléatoire, enchaînée automatiquement, avec fondus. Activée par défaut, coupable
 * (ar.music = off), volume propre (ar.music.volume), atténuée en sortie et coupée quand Spotify
 * joue. Le navigateur n'autorise le son qu'après un geste de l'utilisateur : voir unlockOnGesture().
 */

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
/** Morceau joué en premier à l'ouverture. */
const FIRST_TRACK = 'echappee.mp3';
const FADE_S = 1.2;

function shuffled<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j] as T, r[i] as T];
  }
  return r;
}

export class BackgroundMusic {
  private readonly el = new Audio();
  private order: Track[] = [];
  private index = -1;
  private duck = 1;
  /** Niveau du fondu en cours (0 → 1). */
  private fade = 0;
  private fadeTarget = 0;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  private unlocked = false;
  enabled = localStorage.getItem('ar.music') !== 'off';
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
    return this.enabled && this.unlocked && !this.el.paused;
  }

  get current(): Track | null {
    return this.order[this.index] ?? null;
  }

  /** Démarre au premier clic ou à la première touche (politique d'autoplay des navigateurs). */
  unlockOnGesture(): void {
    const go = () => {
      window.removeEventListener('pointerdown', go);
      window.removeEventListener('keydown', go);
      this.unlocked = true;
      if (this.enabled) this.start();
    };
    window.addEventListener('pointerdown', go);
    window.addEventListener('keydown', go);
    if (!this.enabled) return;
    // Musique dès l'ouverture quand le navigateur l'autorise (site déjà écouté, appli de bureau) ;
    // sinon elle démarre au premier clic ou à la première touche, sans rien afficher.
    this.start();
    void this.el
      .play()
      .then(() => {
        window.removeEventListener('pointerdown', go);
        window.removeEventListener('keydown', go);
      })
      .catch(() => undefined);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    localStorage.setItem('ar.music', on ? 'on' : 'off');
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

  /** Morceau suivant (fondu enchaîné). */
  next(): void {
    if (!this.enabled) return;
    this.fadeTo(0, () => this.load(this.index + 1));
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
    this.el.volume = Math.max(0, Math.min(1, this.volume * this.duck * this.fade));
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
