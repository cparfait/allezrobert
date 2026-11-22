/**
 * Commandes d'une sortie, sorties de `startRide` (main.ts) pour être lisibles et testées à part : touches du
 * clavier, boutons du cintre et de la manette, messages du groupe, surveillance des capteurs, horloge d'arrière-plan.
 * Ces fonctions décident ; main.ts exécute (caméra, HUD, pause…).
 */

import type { NavDir } from '../ui/focusNav.ts';

// --- Clavier ----------------------------------------------------------------------------------------------------

export type CameraMode = 'chase' | 'cockpit' | 'action' | 'gopro' | 'drone' | 'tv' | 'photo' | 'free';
const CAMERA_KEYS: readonly CameraMode[] = ['chase', 'cockpit', 'action', 'gopro', 'drone', 'tv', 'photo', 'free'];

export type RideKeyAction =
  | { kind: 'uturn' | 'lookBack' | 'cycleCamera' | 'toggleHud' | 'mute' | 'music' | 'nextTrack' | 'chat' | 'mic' | 'slowDown' | 'waitMe' | 'formation' | 'photo' | 'pause' | 'ghost' }
  | { kind: 'camera'; mode: CameraMode }
  | { kind: 'pace'; delta: 1 | -1 };

export interface KeyLike {
  key: string;
  code: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

const LETTERS: Record<string, RideKeyAction['kind']> = {
  u: 'uturn',
  x: 'lookBack',
  c: 'cycleCamera',
  h: 'toggleHud',
  m: 'mute',
  b: 'music',
  n: 'nextTrack',
  t: 'chat',
  v: 'mic',
  r: 'slowDown',
  k: 'waitMe',
  f: 'formation',
  p: 'photo',
  g: 'ghost',
};

/** Action d'une touche pendant la sortie (sans les flèches, qui passent par KeyboardControls), ou null. */
export function rideKeyAction(e: KeyLike): RideKeyAction | null {
  // Touches 1 à 8 (rangée du haut ou pavé numérique) : caméra choisie directement. Alt+1 à 3 reste au panneau F3.
  const cam = /^(?:Digit|Numpad)([1-8])$/.exec(e.code);
  if (cam && !e.altKey && !e.ctrlKey && !e.metaKey) return { kind: 'camera', mode: CAMERA_KEYS[Number(cam[1]) - 1]! };
  if (e.key === ' ' || e.key === 'Escape') return { kind: 'pause' };
  // Allure du groupe : [ et ] (ou + et − du pavé numérique, qui ne demandent pas AltGr sur un clavier AZERTY).
  if (e.key === ']' || e.code === 'NumpadAdd') return { kind: 'pace', delta: 1 };
  if (e.key === '[' || e.code === 'NumpadSubtract') return { kind: 'pace', delta: -1 };
  const k = LETTERS[e.key.toLowerCase()];
  return k ? ({ kind: k } as RideKeyAction) : null;
}

// --- Boutons du cintre, manette, télécommande -------------------------------------------------------------------

export type HardwareCommand = { kind: 'togglePause' } | { kind: 'focus'; dir: NavDir } | { kind: 'activate' } | { kind: 'shift'; action: string } | null;

/**
 * En roulant, les vitesses ; « menu » met en pause ; en pause et sur le bilan, la croix et les boutons naviguent
 * (haut/bas/gauche/droite, valider, retour). `pauseOpen` : le menu pause est ouvert (pas le bilan).
 */
export function hardwareCommand(action: string, st: { paused: boolean; pauseOpen: boolean }): HardwareCommand {
  if (action === 'menu') return !st.paused || st.pauseOpen ? { kind: 'togglePause' } : null;
  if (!st.paused) return { kind: 'shift', action };
  switch (action) {
    case 'up':
    case 'frontUp':
      return { kind: 'focus', dir: 'up' };
    case 'down':
    case 'frontDown':
      return { kind: 'focus', dir: 'down' };
    case 'steerLeft':
      return { kind: 'focus', dir: 'left' };
    case 'steerRight':
      return { kind: 'focus', dir: 'right' };
    case 'confirm':
      return { kind: 'activate' };
    case 'back':
      return st.pauseOpen ? { kind: 'togglePause' } : null;
    default:
      return null;
  }
}

// --- Messages du groupe -----------------------------------------------------------------------------------------

export interface TalkLine {
  fr: string;
  en: string;
}

/**
 * Messages du groupe (façon NCT) : « À toi le relais » quand on passe en tête, « Le groupe reprend la tête » quand
 * un équipier repasse devant, « Ils s'organisent, ils reviennent sur toi ! » quand l'échappée fond. Un message au
 * plus toutes les 6 s.
 */
export class GroupTalk {
  private leading = false;
  private since = 0;
  private away = false;
  private bestGap = 0;
  private quiet = 0;

  /** `lead` : avance sur l'équipier le plus en tête (m, négatif derrière). */
  update(dt: number, lead: number): TalkLine | null {
    this.quiet -= dt;
    this.since += dt;
    let line: TalkLine | null = null;
    const say = (fr: string, en: string) => {
      if (this.quiet > 0 || line) return;
      line = { fr, en };
      this.quiet = 6;
    };
    if (!this.leading && lead > 1.5 && this.since > 8) {
      this.leading = true;
      this.since = 0;
      say('À toi le relais 💪', 'Your turn on the front 💪');
    } else if (this.leading && lead < -2) {
      this.leading = false;
      this.since = 0;
      if (!this.away) say('Le groupe reprend la tête 👋', 'The group takes over 👋');
    }
    // Échappée : plus de 25 m d'avance ; quand l'écart fond de 8 m, le groupe chasse.
    if (lead > 25) {
      if (!this.away) {
        this.away = true;
        this.bestGap = lead;
      }
      this.bestGap = Math.max(this.bestGap, lead);
      if (this.bestGap - lead > 8) {
        say('Ils s’organisent, ils reviennent sur toi !', 'They’re organising, they’re coming back to you!');
        this.bestGap = lead;
      }
    } else if (lead < 5) this.away = false;
    return line;
  }
}

// --- Capteurs perdus --------------------------------------------------------------------------------------------

/**
 * Home trainer ou capteur de puissance perdu : bandeau tant qu'il ne répond pas ; seul sur la route, pause
 * automatique au bout de `pauseAfterS` secondes, une seule fois par coupure. `tick` est appelé chaque seconde.
 */
export class SensorLossWatch {
  private lostS = 0;
  private autoPaused = false;
  constructor(private readonly pauseAfterS = 5) {}

  tick(lost: readonly string[], canPause: boolean): { alert: TalkLine | null; pause: boolean } {
    if (!lost.length) {
      this.lostS = 0;
      this.autoPaused = false;
      return { alert: null, pause: false };
    }
    this.lostS++;
    const names = lost.join(', ');
    const alert = { fr: `${names} : signal perdu, reconnexion…`, en: `${names}: signal lost, reconnecting…` };
    if (this.lostS >= this.pauseAfterS && !this.autoPaused && canPause) {
      this.autoPaused = true;
      return { alert, pause: true };
    }
    return { alert, pause: false };
  }
}

// --- Horloge d'arrière-plan -------------------------------------------------------------------------------------

/** Page masquée (onglet en arrière-plan, fenêtre réduite). */
function pageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/** Pas de simulation pour rattraper `gapS` secondes : pas de `step` au plus, `maxS` au total. */
export function catchUpSteps(gapS: number, step = 0.1, maxS = 120): number[] {
  const out: number[] = [];
  let gap = Math.min(Math.max(gapS, 0), maxS);
  while (gap > 1e-3) {
    const s = Math.min(gap, step);
    out.push(s);
    gap -= s;
  }
  return out;
}

/**
 * Onglet masqué ou fenêtre réduite : le navigateur n'appelle plus la boucle d'affichage. Une horloge tenue par un
 * Worker (peu ralentie en arrière-plan) fait alors avancer la sortie sans la dessiner : distance, chrono et
 * enregistrement continuent, et restent d'accord avec le serveur en groupe. `drawn()` est appelé par la boucle
 * d'affichage à chaque image ; au retour, elle reprend la main (THREE.Timer ignore le temps passé caché).
 */
export class BackgroundClock {
  private worker: Worker | null = null;
  private lastDrawn = performance.now();
  private last = 0;

  constructor(private readonly step: (dt: number) => void) {}

  start(): void {
    try {
      this.worker = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 250);'], { type: 'text/javascript' })));
    } catch {
      this.worker = null;
      return;
    }
    this.worker.onmessage = () => {
      const now = performance.now();
      // Seulement page réellement cachée : une image longue (compilation au départ, tuile lourde) ne doit pas faire
      // croire à un onglet masqué, sinon la sortie avance deux fois (horloge + boucle) et la vue tremble.
      if (!pageHidden() || now - this.lastDrawn < 400) {
        this.last = 0;
        return;
      }
      const gap = (now - (this.last || this.lastDrawn)) / 1000;
      this.last = now;
      for (const dt of catchUpSteps(gap)) this.step(dt);
    };
  }

  drawn(): void {
    this.lastDrawn = performance.now();
  }

  stop(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
