/**
 * Micro du téléphone pour le chat vocal de la sortie (LiveKit) : le téléphone, souvent posé sur le
 * cintre, est plus près de la bouche que l'ordinateur.
 *
 * Le téléphone n'a pas de compte : il demande un jeton au jeu (commande « phoneMic » avec `req`), qui
 * l'obtient du serveur (identité « …:phone », publication seule) et le renvoie par la salle d'appairage
 * (événement « voiceToken »). Le téléphone rejoint alors la salle vocale sans rien écouter (le jeu
 * joue déjà les voix) et publie son micro. Il dit au jeu quand son micro s'ouvre ou se coupe ; le jeu
 * coupe alors le micro de l'ordinateur et peut piloter celui du téléphone (touche V).
 */
import type { Room } from 'livekit-client';
import type { PairEvent, PhoneCommand } from '@allezrobert/shared';

export type PhoneMicState = 'off' | 'connecting' | 'on' | 'muted';
export type PhoneMicError = 'insecure' | 'denied' | 'none' | 'failed';

const TOKEN_TIMEOUT_MS = 10_000;

export class PhoneMic {
  state: PhoneMicState = 'off';
  /** Appelé à chaque changement d'état ; `error` quand le micro n'a pas pu démarrer. */
  onChange?: (error?: PhoneMicError, detail?: string) => void;
  private room: Room | null = null;
  private track: MediaStreamTrack | null = null;
  private pending: { req: string; done: (ev: Extract<PairEvent, { kind: 'voiceToken' }>) => void } | null = null;
  private lastResync = 0;

  constructor(private readonly send: (cmd: PhoneCommand) => void) {}

  /** Relié à la salle vocale (micro ouvert ou coupé). */
  get linked(): boolean {
    return !!this.room;
  }

  /** Bouton du micro : relie le téléphone à la voix au premier appui, puis ouvre ou coupe le micro. */
  async toggle(): Promise<void> {
    if (this.state === 'connecting') return;
    if (this.room) await this.setOn(this.state !== 'on');
    else await this.start();
  }

  /** Le jeu ouvre ou coupe le micro (touche V). */
  async setOn(on: boolean): Promise<void> {
    if (!this.room) return;
    await this.room.localParticipant.setMicrophoneEnabled(on).catch(() => undefined);
    this.set(on ? 'on' : 'muted');
    this.report();
  }

  /** Réponse du jeu à la demande de jeton. */
  onToken(ev: Extract<PairEvent, { kind: 'voiceToken' }>): void {
    if (this.pending?.req === ev.req) this.pending.done(ev);
  }

  /**
   * État reçu du jeu : voix finie (fin de sortie) → on quitte la salle vocale ; état du micro que le jeu
   * a perdu (jeu ou salle d'appairage reconnectés) → on le lui redit, au plus toutes les 2 s.
   */
  sync(voice: { available: boolean; phoneMic: boolean } | undefined): void {
    if (!this.room) return;
    if (!voice?.available) {
      void this.stop(false);
      return;
    }
    if (voice.phoneMic !== (this.state === 'on') && performance.now() - this.lastResync > 2000) {
      this.lastResync = performance.now();
      this.report();
    }
  }

  /** Quitte la salle vocale ; `tell` : prévient le jeu (le micro de l'ordinateur reprend la main). */
  async stop(tell = true): Promise<void> {
    const room = this.room;
    this.room = null;
    this.track?.stop();
    this.track = null;
    if (room) {
      room.removeAllListeners();
      await room.disconnect().catch(() => undefined);
    }
    if (tell) this.send({ kind: 'phoneMic', on: false, linked: false });
    this.set('off');
  }

  private async start(): Promise<void> {
    // getUserMedia n'existe qu'en contexte sécurisé (https, ou localhost).
    if (!navigator.mediaDevices?.getUserMedia) return this.fail('insecure');
    this.set('connecting');
    // Autorisation du micro d'abord, pendant l'appui (exigé par iOS) ; la piste obtenue est publiée telle quelle.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      this.track = stream.getAudioTracks()[0] ?? null;
      if (!this.track) return this.fail('none');
    } catch (e) {
      const name = (e as DOMException)?.name ?? '';
      return this.fail(name === 'NotFoundError' ? 'none' : name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'failed', name);
    }
    const grant = await this.requestToken();
    if (!grant.url || !grant.token) return this.fail('failed', grant.error);
    let room: Room | null = null;
    try {
      // LiveKit chargé seulement quand on prête le micro.
      const { Room, RoomEvent, Track } = await import('livekit-client');
      const r = new Room();
      room = r;
      r.on(RoomEvent.Disconnected, () => {
        if (this.room === r) void this.stop();
      });
      await r.connect(grant.url, grant.token, { autoSubscribe: false });
      await r.localParticipant.publishTrack(this.track, { source: Track.Source.Microphone, name: 'phone-mic' });
      this.room = r;
      this.set('on');
      this.report();
    } catch (e) {
      room?.removeAllListeners();
      void room?.disconnect().catch(() => undefined);
      this.fail('failed', String((e as Error)?.message ?? e).slice(0, 80));
    }
  }

  /** Demande un jeton au jeu et attend sa réponse (10 s au plus). */
  private requestToken(): Promise<Extract<PairEvent, { kind: 'voiceToken' }>> {
    const req = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending = null;
        resolve({ kind: 'voiceToken', req, error: 'timeout' });
      }, TOKEN_TIMEOUT_MS);
      this.pending = {
        req,
        done: (ev) => {
          clearTimeout(timer);
          this.pending = null;
          resolve(ev);
        },
      };
      this.send({ kind: 'phoneMic', on: true, req });
    });
  }

  private report(): void {
    this.send({ kind: 'phoneMic', on: this.state === 'on', linked: true });
  }

  private fail(error: PhoneMicError, detail?: string): void {
    this.track?.stop();
    this.track = null;
    this.state = 'off';
    this.onChange?.(error, detail);
  }

  private set(state: PhoneMicState): void {
    this.state = state;
    this.onChange?.();
  }
}
