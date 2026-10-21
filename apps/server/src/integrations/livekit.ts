/**
 * Jeton d'accès LiveKit (voix) : JWT HS256 signé avec la clé API LiveKit, au format attendu
 * par LiveKit (`iss` = clé API, `sub` = identité, claim `video` = droits sur la salle).
 * Signé avec jose pour éviter la dépendance livekit-server-sdk (protobuf) : le format est
 * documenté sur https://docs.livekit.io/home/get-started/authentication/.
 * Une salle LiveKit par sortie : `ride-<roomId>`.
 */
import { SignJWT } from 'jose';

export interface LiveKitConfig {
  url: string;
  apiKey: string;
  apiSecret: string;
}

export interface VoiceGrant {
  url: string;
  room: string;
  token: string;
  expiresAt: number;
}

export function voiceRoomName(rideRoomId: string): string {
  return `ride-${rideRoomId}`;
}

export async function createLiveKitToken(
  cfg: LiveKitConfig,
  opts: { identity: string; name: string; room: string; canPublish?: boolean; ttlS?: number },
): Promise<VoiceGrant> {
  const ttl = opts.ttlS ?? 4 * 3600;
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    name: opts.name,
    video: {
      room: opts.room,
      roomJoin: true,
      canPublish: opts.canPublish ?? true,
      canSubscribe: true,
      canPublishData: true,
    },
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(cfg.apiKey)
    .setSubject(opts.identity)
    .setJti(opts.identity)
    .setNotBefore(now)
    .setExpirationTime(now + ttl)
    .sign(new TextEncoder().encode(cfg.apiSecret));
  return { url: cfg.url, room: opts.room, token, expiresAt: (now + ttl) * 1000 };
}
