import { getLang } from '../i18n/index.ts';
import { CoachVoice } from './coachVoice.ts';
import { music } from './music.ts';
import type { DsLine } from '../game/directeur.ts';

type Out = { ctx: BaseAudioContext; dest: AudioNode };

/**
 * Voix du directeur sportif (game/directeur.ts) : morceaux enregistrés une fois pour toutes et livrés avec le jeu
 * (public/voice/ds et public/voice/coach, voir audio/dsLines.ts), enchaînés par le lecteur du coach sur le bus « voix ».
 * Rien n'est synthétisé pendant la course : ni appel à Cartesia, ni voix Piper locale (ONNX en WebAssembly, ≈ 8 % du
 * processeur à chaque phrase hors ligne, mesuré à 40 coureurs le 26/11/2026). Une phrase sans morceaux enregistrés
 * (cas imprévu) est dite par la voix du système.
 *
 * Une phrase à la fois ; une phrase urgente passe devant ; une phrase qui attend depuis plus de 6 s est abandonnée
 * (elle ne veut plus rien dire).
 */
export class DirectorVoice {
  /** Coupée par le joueur (son du jeu coupé, bus « voix » coupé). */
  muted = false;
  private readonly players = new Map<'fr' | 'en', CoachVoice>();

  constructor(private readonly out: () => Out | null) {}

  private player(lang: 'fr' | 'en'): CoachVoice {
    let p = this.players.get(lang);
    if (!p) this.players.set(lang, (p = new CoachVoice(this.out, lang, ['ds', 'coach'])));
    return p;
  }

  /** Charge la table des morceaux avant la première phrase. */
  warm(): void {
    this.player(getLang() === 'fr' ? 'fr' : 'en');
  }

  say(line: DsLine): void {
    if (this.muted) return;
    const lang = getLang() === 'fr' ? 'fr' : 'en';
    const keys = line.keys?.[lang];
    const p = this.player(lang);
    void (keys?.length ? p.has(keys) : Promise.resolve(false)).then((ok) => {
      if (this.muted) return;
      if (ok && keys) p.say([{ keys, urgent: !!line.urgent, ttlS: 6 }]);
      else this.system(lang === 'fr' ? line.fr : line.en, lang, !!line.urgent);
    });
  }

  stop(): void {
    for (const p of this.players.values()) p.stop();
    this.players.clear();
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    music.talkOver(false);
  }

  /** Secours : voix du système (rien à calculer dans le jeu). */
  private system(text: string, lang: 'fr' | 'en', urgent: boolean): void {
    if (!('speechSynthesis' in window)) return;
    if (urgent) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === 'fr' ? 'fr-FR' : 'en-GB';
    u.rate = 1.08;
    music.talkOver(true);
    u.onend = u.onerror = () => music.talkOver(false);
    speechSynthesis.speak(u);
  }
}
