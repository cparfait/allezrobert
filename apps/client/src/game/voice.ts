import { Room, RoomEvent, Track, type RemoteTrack, type Participant } from 'livekit-client';
import { apiBase } from '../ui/account.ts';

/**
 * Chat vocal de la sortie (LiveKit auto-hébergé, WebRTC). Micro coupé à l'arrivée ; V bascule
 * le micro. Les voix des autres coureurs sont jouées automatiquement. Repli : bouton Discord.
 */
export class VoiceChat {
  private room: Room | null = null;
  private readonly audioEls = new Map<string, HTMLMediaElement>();
  micOn = false;
  /** Noms affichés des coureurs qui parlent en ce moment. */
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
      const room = new Room({ adaptiveStream: true, dynacast: true });
      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, participant: Participant) => {
        if (track.kind !== Track.Kind.Audio) return;
        const el = track.attach();
        el.style.display = 'none';
        document.body.appendChild(el);
        this.audioEls.set(`${participant.identity}:${track.sid}`, el);
      });
      room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _pub, participant: Participant) => {
        const key = `${participant.identity}:${track.sid}`;
        track.detach().forEach((e) => e.remove());
        this.audioEls.get(key)?.remove();
        this.audioEls.delete(key);
      });
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        this.speaking = new Set(speakers.map((p) => p.name || p.identity));
      });
      room.on(RoomEvent.Disconnected, () => this.onState?.('disconnected'));
      await room.connect(url, token);
      this.room = room;
      this.onState?.('connected');
      return true;
    } catch (e) {
      this.onState?.('unavailable', String((e as Error).message ?? e));
      return false;
    }
  }

  /** Bascule le micro (demande l'autorisation du navigateur la première fois). */
  async toggleMic(): Promise<boolean> {
    if (!this.room) return false;
    this.micOn = !this.micOn;
    await this.room.localParticipant.setMicrophoneEnabled(this.micOn).catch(() => (this.micOn = false));
    return this.micOn;
  }

  async disconnect(): Promise<void> {
    for (const el of this.audioEls.values()) el.remove();
    this.audioEls.clear();
    await this.room?.disconnect();
    this.room = null;
  }
}
