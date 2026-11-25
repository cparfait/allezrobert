import { getLang } from '../i18n/index.ts';
import { cartesiaUrl } from '../onboarding/voice.ts';
import { applySink } from './devices.ts';
import { music } from './music.ts';
import type { DsLine } from '../game/directeur.ts';

/**
 * Voix Piper (synthèse neuronale libre, MIT, https://github.com/rhasspy/piper) qui tourne dans le jeu même
 * (@mintplex-labs/piper-tts-web : ONNX en WebAssembly). Tout est servi par notre serveur, sous /piper/ (moteur ONNX,
 * phonétiseur, voix ; tools/piper/fetch-piper.mjs) : ni CDN ni Hugging Face. Le modèle de voix est ensuite gardé dans
 * le stockage du navigateur. Secours de Cartesia (voir DirectorVoice).
 * Voix : ?dsvoice=… pour en essayer une autre, à condition de l'ajouter d'abord à fetch-piper.mjs.
 */
const PIPER_BASE = `${import.meta.env.BASE_URL ?? '/'}piper/`;
// onnxWasm : seulement le binaire .wasm (objet { wasm }) ; le module .mjs qui le charge est déjà dans le paquet
// d'onnxruntime embarqué par le jeu (Vite refuse d'importer un module JavaScript depuis public/).
const PIPER_WASM = {
  onnxWasm: { wasm: `${PIPER_BASE}ort/ort-wasm-simd-threaded.wasm` } as unknown as string,
  piperData: `${PIPER_BASE}piper_phonemize.data`,
  piperWasm: `${PIPER_BASE}piper_phonemize.wasm`,
};
/** Le paquet va chercher les voix sur Hugging Face (adresse codée en dur) : ces requêtes-là sont servies par /piper/voices/. */
const HF_VOICES = 'https://huggingface.co/diffusionstudio/piper-voices/resolve/main/';
let hfRedirect = false;
function redirectVoicesToOurServer(): void {
  if (hfRedirect) return;
  hfRedirect = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return url.startsWith(HF_VOICES) ? original(`${PIPER_BASE}voices/${url.slice(HF_VOICES.length)}`, init) : original(input, init);
  };
}
const PIPER_VOICE = { fr: 'fr_FR-tom-medium', en: 'en_GB-northern_english_male-medium' } as const;
type PiperSession = { predict(text: string): Promise<Blob> };
const piperSessions = new Map<string, Promise<PiperSession | null>>();
function piperSession(lang: 'fr' | 'en'): Promise<PiperSession | null> {
  const voice = new URLSearchParams(location.search).get('dsvoice') ?? PIPER_VOICE[lang];
  let p = piperSessions.get(voice);
  if (!p) {
    redirectVoicesToOurServer();
    p = import('@mintplex-labs/piper-tts-web')
      .then((m) => m.TtsSession.create({ voiceId: voice as Parameters<typeof m.TtsSession.create>[0]['voiceId'], wasmPaths: PIPER_WASM }) as Promise<PiperSession>)
      .catch((e: unknown) => {
        console.warn('[DS] Piper indisponible, repli sur Cartesia / voix du système', e);
        return null;
      });
    piperSessions.set(voice, p);
  }
  return p;
}
/** Piper désactivable (?piper=0) : repli direct sur Cartesia puis la voix du système. */
const PIPER_ON = new URLSearchParams(location.search).get('piper') !== '0';

/**
 * Voix du directeur sportif (game/directeur.ts) : Cartesia en priorité (synthèse par le serveur, mise en cache par
 * phrase), sinon Piper (voix neuronale locale, chargée seulement après un premier échec de Cartesia : hors ligne, serveur
 * sans clé), sinon la voix du système. ?piper=0 coupe Piper. Une phrase à la fois ; une
 * phrase urgente vide la file ; une phrase qui attend depuis plus de 6 s est abandonnée (elle ne veut plus rien dire).
 */
export class DirectorVoice {
  /** Coupée par le joueur (son du jeu coupé, bus « voix » coupé). */
  muted = false;
  /** Volume (0–1). */
  volume = 1;
  private queue: Array<{ line: DsLine; at: number }> = [];
  private busy = false;
  private current: HTMLAudioElement | null = null;

  /** Piper prêt à servir (chargé après un échec de Cartesia) : la phrase suivante l'attend, les autres non. */
  private piperReady = false;

  /** Rien à précharger : Cartesia répond phrase par phrase, Piper n'est chargé qu'en secours. */
  warm(): void {}

  say(line: DsLine): void {
    if (this.muted) return;
    if (line.urgent) {
      this.queue = [];
      this.current?.pause();
      if ('speechSynthesis' in window) speechSynthesis.cancel();
      this.busy = false;
    }
    this.queue.push({ line, at: performance.now() });
    void this.pump();
  }

  stop(): void {
    this.queue = [];
    this.current?.pause();
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    this.busy = false;
    music.talkOver(false);
  }

  private async pump(): Promise<void> {
    if (this.busy) return;
    const next = this.queue.shift();
    if (!next) return;
    if (performance.now() - next.at > 6000) return this.pump();
    this.busy = true;
    const fr = getLang() === 'fr';
    const text = fr ? next.line.fr : next.line.en;
    music.talkOver(true);
    let url = await cartesiaUrl(text, fr ? 'fr' : 'en');
    if (!url && PIPER_ON) {
      // Cartesia indisponible : Piper se charge en arrière-plan (une soixantaine de Mo la première fois) ; tant qu'il
      // n'est pas prêt, la voix du système dit la phrase plutôt que de la faire attendre.
      const pending = piperSession(fr ? 'fr' : 'en');
      void pending.then((p) => (this.piperReady = !!p));
      if (this.piperReady) {
        const session = await pending;
        if (session) url = await session.predict(text).then((b) => URL.createObjectURL(b)).catch(() => null);
      }
    }
    await new Promise<void>((done) => {
      if (url) {
        const a = new Audio(url);
        a.volume = Math.max(0, Math.min(1, this.volume));
        applySink(a);
        this.current = a;
        a.onended = a.onerror = () => done();
        void a.play().catch(() => done());
        return;
      }
      if (!('speechSynthesis' in window)) return done();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = fr ? 'fr-FR' : 'en-GB';
      u.rate = 1.08;
      u.volume = Math.max(0, Math.min(1, this.volume));
      u.onend = u.onerror = () => done();
      speechSynthesis.speak(u);
    });
    this.current = null;
    music.talkOver(false);
    this.busy = false;
    void this.pump();
  }
}
