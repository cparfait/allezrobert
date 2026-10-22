import { getLang } from '../i18n/index.ts';
import { ONBOARDING_SCRIPT } from './script.ts';
import { serverEndpoint } from '../game/multiplayer.ts';

/** Audio Cartesia déjà reçu (par texte et langue) : chaque réplique n'est téléchargée qu'une fois. */
const audioCache = new Map<string, Promise<string | null>>();

/** Voix de qualité (Cartesia, via le serveur qui garde la clé) ; null si indisponible. */
function cartesiaUrl(text: string, lang: 'fr' | 'en'): Promise<string | null> {
  const key = `${lang}|${text}`;
  let p = audioCache.get(key);
  if (!p) {
    const api = `${serverEndpoint().replace(/\/colyseus$/, '')}/api`;
    p = fetch(`${api}/tts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, lang }) })
      .then(async (r) => (r.ok ? URL.createObjectURL(await r.blob()) : null))
      .catch(() => null);
    audioCache.set(key, p);
  }
  return p;
}

/**
 * Voix off du tutoriel : synthèse vocale du système (Web Speech API), voix française ou
 * anglaise de meilleure qualité disponible, sous-titres synchronisés. Coupable à tout moment.
 */
export class VoiceOver {
  enabled = localStorage.getItem('ar.voice') !== 'off';
  private readonly subtitle: HTMLElement;
  private queue: Promise<void> = Promise.resolve();
  /** Génération courante : un arrêt invalide toutes les répliques encore en file. */
  private gen = 0;

  constructor(container: HTMLElement) {
    this.subtitle = document.createElement('div');
    this.subtitle.className = 'subtitle hidden';
    container.appendChild(this.subtitle);
  }

  private voice(): SpeechSynthesisVoice | undefined {
    const lang = getLang() === 'fr' ? 'fr' : 'en';
    const voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(lang));
    // Voix « naturelles » / en ligne d'abord (Edge, Chrome), sinon la première de la langue.
    return voices.find((v) => /natural|neural|online|google/i.test(v.name)) ?? voices[0];
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    localStorage.setItem('ar.voice', on ? 'on' : 'off');
    if (!on) speechSynthesis.cancel();
  }

  /** Lit les répliques d'une clé du script, à la suite des précédentes. */
  say(key: keyof typeof ONBOARDING_SCRIPT): Promise<void> {
    const lines = ONBOARDING_SCRIPT[key] ?? [];
    const g = this.gen;
    // Préchargement : toutes les répliques de la clé partent en synthèse tout de suite.
    if (this.enabled) for (const line of lines) void cartesiaUrl(getLang() === 'fr' ? line.fr : line.en, getLang() === 'fr' ? 'fr' : 'en');
    for (const line of lines) {
      const text = getLang() === 'fr' ? line.fr : line.en;
      this.queue = this.queue.then(() => (g === this.gen ? this.speak(text) : undefined));
    }
    return this.queue;
  }

  private speak(text: string): Promise<void> {
    this.subtitle.textContent = text;
    this.subtitle.classList.remove('hidden');
    const hide = () => this.subtitle.classList.add('hidden');
    if (!this.enabled || !('speechSynthesis' in window)) {
      // Sans voix : sous-titre affiché le temps de lecture estimé.
      const g = this.gen;
      return new Promise((res) =>
        setTimeout(() => {
          if (g === this.gen) hide();
          res();
        }, Math.max(2500, text.length * 55)),
      );
    }
    const g = this.gen;
    return cartesiaUrl(text, getLang() === 'fr' ? 'fr' : 'en').then(
      (url) =>
        new Promise<void>((res) => {
          if (g !== this.gen) return res();
          if (url) {
            const audio = new Audio(url);
            this.current = audio;
            audio.onended = () => (hide(), res());
            audio.onerror = () => (hide(), res());
            void audio.play().catch(() => (hide(), res()));
            return;
          }
          this.speakSystem(text, hide, res);
        }),
    );
  }

  private current: HTMLAudioElement | null = null;

  /** Repli : synthèse vocale du système (Web Speech API). */
  private speakSystem(text: string, hide: () => void, res: () => void): void {
    {
      const u = new SpeechSynthesisUtterance(text);
      const v = this.voice();
      if (v) u.voice = v;
      u.lang = getLang() === 'fr' ? 'fr-FR' : 'en-GB';
      u.rate = 1.02;
      u.onend = () => (hide(), res());
      u.onerror = () => (hide(), res());
      speechSynthesis.speak(u);
    }
  }

  stop(): void {
    this.gen++;
    this.queue = Promise.resolve();
    speechSynthesis.cancel();
    this.current?.pause();
    this.current = null;
    this.subtitle.classList.add('hidden');
  }
}
