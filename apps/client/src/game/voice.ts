import type { Room, RemoteTrack, Participant } from 'livekit-client';
import { apiBase } from '../ui/account.ts';
import { getAudioDevices, onAudioDevices } from '../audio/devices.ts';

/** Configuration publique de la voix (`GET /api/voice`). */
export interface VoiceConfig {
  livekit: boolean;
  /** Lien d'invitation du salon Discord de repli (null si non configuré). */
  discordInvite: string | null;
}

/** Lit la configuration de la voix du serveur (repli : rien de disponible). */
export async function fetchVoiceConfig(): Promise<VoiceConfig> {
  try {
    const r = await fetch(`${apiBase()}/voice`, { credentials: 'include' });
    if (r.ok) return (await r.json()) as VoiceConfig;
  } catch {
    // Serveur injoignable : ni LiveKit ni Discord.
  }
  return { livekit: false, discordInvite: null };
}

/**
 * Volume d'une voix selon la distance (m) : pleine en deçà de `near`, qui s'éteint en douceur jusqu'à
 * `far`, muette au-delà. `null` (coureur inconnu ou hors de la salle) : muet.
 */
export function proximityGain(distanceM: number | null, near: number, far: number): number {
  if (distanceM === null || !Number.isFinite(distanceM)) return 0;
  if (distanceM <= near) return 1;
  if (distanceM >= far) return 0;
  const k = (far - distanceM) / (far - near);
  return k * k * (3 - 2 * k);
}

/** Identifiant de coureur d'une identité vocale de salle publique (« r12 » ou « r12:companion »). */
export function riderOfIdentity(identity: string): string {
  return identity.split(':')[0] ?? identity;
}

export interface VoiceProximity {
  /** Distance (m) à un coureur de la salle, null si inconnu. */
  distanceOf(riderId: string): number | null;
  nearM: number;
  farM: number;
}

/**
 * Chat vocal de la sortie (LiveKit auto-hébergé, WebRTC). Micro coupé à l'arrivée ; V bascule
 * le micro. Les voix des autres coureurs sont jouées automatiquement. Repli : salon Discord
 * (lien configuré côté serveur, `DISCORD_VOICE_INVITE`) proposé quand LiveKit est absent ou échoue.
 *
 * Micro et sortie suivent le choix des réglages (audio/devices.ts), changement en direct. Monde ouvert :
 * `setProximity` règle le volume de chaque voix selon la distance au coureur (muet au-delà de `farM`).
 */
export class VoiceChat {
  private room: Room | null = null;
  private readonly audioEls = new Map<string, { el: HTMLMediaElement; identity: string }>();
  private speakers: Participant[] = [];
  private proximity: VoiceProximity | null = null;
  private proximityTimer: ReturnType<typeof setInterval> | null = null;
  private offDevices: (() => void) | null = null;
  micOn = false;
  /** Noms affichés des coureurs qui parlent en ce moment (et qu'on entend). */
  speaking = new Set<string>();
  onState?: (state: 'connected' | 'disconnected' | 'unavailable', detail?: string) => void;

  async connect(roomId: string): Promise<boolean> {
    try {
      const r = await fetch(`${apiBase()}/rides/${encodeURIComponent(roomId)}/voice-token`, { credentials: 'include' });
      if (!r.ok) {
        this.onState?.('unavailable', r.status === 404 ? 'voix non configurée sur le serveur' : `HTTP ${r.status}`);
        return false;
      }
      const { url, token } = (await r.json()) as { url: string; token: string };
      // LiveKit (≈ 1,4 Mo de code) chargé seulement quand une sortie de groupe ouvre la voix.
      const { Room, RoomEvent, Track } = await import('livekit-client');
      const dev = getAudioDevices();
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(dev.micId ? { deviceId: dev.micId } : {}) },
        ...(dev.speakerId ? { audioOutput: { deviceId: dev.speakerId } } : {}),
      });
      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, participant: Participant) => {
        if (track.kind !== Track.Kind.Audio) return;
        const el = track.attach();
        el.style.display = 'none';
        document.body.appendChild(el);
        this.audioEls.set(`${participant.identity}:${track.sid}`, { el, identity: participant.identity });
        this.applyProximity();
      });
      room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _pub, participant: Participant) => {
        const key = `${participant.identity}:${track.sid}`;
        track.detach().forEach((e) => e.remove());
        this.audioEls.get(key)?.el.remove();
        this.audioEls.delete(key);
      });
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        this.speakers = speakers;
        this.applyProximity();
      });
      room.on(RoomEvent.Disconnected, () => this.onState?.('disconnected'));
      await room.connect(url, token);
      this.room = room;
      // Micro et sortie changés dans les réglages pendant la sortie.
      this.offDevices = onAudioDevices((c) => {
        void room.switchActiveDevice('audioinput', c.micId || 'default').catch(() => undefined);
        void room.switchActiveDevice('audiooutput', c.speakerId || 'default').catch(() => undefined);
      });
      this.onState?.('connected');
      return true;
    } catch (e) {
      this.onState?.('unavailable', String((e as Error).message ?? e));
      return false;
    }
  }

  /**
   * Monde ouvert : on n'entend que les coureurs proches (voix pleine jusqu'à `nearM`, muette à `farM`).
   * `null` : tout le monde s'entend (sortie privée).
   */
  setProximity(p: VoiceProximity | null): void {
    this.proximity = p;
    if (this.proximityTimer) clearInterval(this.proximityTimer);
    this.proximityTimer = p ? setInterval(() => this.applyProximity(), 250) : null;
    this.applyProximity();
  }

  /** Volume de chaque voix selon la distance, et liste de ceux qui parlent parmi ceux qu'on entend. */
  private applyProximity(): void {
    const p = this.proximity;
    const gainOf = (identity: string): number => (p ? proximityGain(p.distanceOf(riderOfIdentity(identity)), p.nearM, p.farM) : 1);
    for (const { el, identity } of this.audioEls.values()) el.volume = gainOf(identity);
    this.speaking = new Set(this.speakers.filter((s) => gainOf(s.identity) > 0).map((s) => s.name || s.identity));
  }

  /** Bascule le micro (demande l'autorisation du navigateur la première fois). */
  async toggleMic(): Promise<boolean> {
    if (!this.room) return false;
    this.micOn = !this.micOn;
    await this.room.localParticipant.setMicrophoneEnabled(this.micOn).catch(() => (this.micOn = false));
    return this.micOn;
  }

  async disconnect(): Promise<void> {
    this.setProximity(null);
    this.offDevices?.();
    this.offDevices = null;
    for (const { el } of this.audioEls.values()) el.remove();
    this.audioEls.clear();
    await this.room?.disconnect();
    this.room = null;
  }
}
