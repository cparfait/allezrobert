import { getLang } from '../i18n/index.ts';
import { ONBOARDING_SCRIPT } from './script.ts';

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
    return new Promise((res) => {
      const u = new SpeechSynthesisUtterance(text);
      const v = this.voice();
      if (v) u.voice = v;
      u.lang = getLang() === 'fr' ? 'fr-FR' : 'en-GB';
      u.rate = 1.02;
      u.onend = () => (hide(), res());
      u.onerror = () => (hide(), res());
      speechSynthesis.speak(u);
    });
  }

  stop(): void {
    this.gen++;
    this.queue = Promise.resolve();
    speechSynthesis.cancel();
    this.subtitle.classList.add('hidden');
  }
}
