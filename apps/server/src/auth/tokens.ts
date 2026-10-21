/**
 * Jetons signés (jose, HS256) : session (cookie HTTP-only), jeton de jeu (connexion WebSocket),
 * lien magique, état OAuth (anti-CSRF + PKCE). Chaque usage a son audience : un jeton ne
 * peut pas servir à autre chose que ce pour quoi il a été émis.
 */
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { randomId } from '../crypto.ts';

const ISSUER = 'allezrobert';

export const AUD = {
  session: 'ar-session',
  game: 'ar-game',
  magic: 'ar-magic',
  oauth: 'ar-oauth',
} as const;

export interface SessionClaims {
  userId: string;
  sessionId: string;
  name: string;
}

export interface GameClaims {
  userId: string;
  name: string;
}

export interface MagicClaims {
  emailHash: string;
  name: string;
  redirect: string;
  jti: string;
  exp: number;
}

export interface OAuthStateClaims {
  provider: string;
  state: string;
  verifier: string;
  redirect: string;
  /** Liaison d'un service (Strava) à un compte existant. */
  userId?: string;
}

export class TokenService {
  private readonly key: Uint8Array;

  constructor(secret: string) {
    this.key = new TextEncoder().encode(secret);
  }

  private sign(payload: JWTPayload, audience: string, ttlS: number, subject?: string): Promise<string> {
    const jwt = new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).setIssuer(ISSUER).setAudience(audience).setIssuedAt().setExpirationTime(`${Math.round(ttlS)}s`);
    if (subject) jwt.setSubject(subject);
    return jwt.sign(this.key);
  }

  private async verify(token: string, audience: string): Promise<JWTPayload | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, audience, algorithms: ['HS256'] });
      return payload;
    } catch {
      return null;
    }
  }

  signSession(c: SessionClaims, ttlS: number): Promise<string> {
    return this.sign({ sid: c.sessionId, name: c.name }, AUD.session, ttlS, c.userId);
  }

  async verifySession(token: string): Promise<SessionClaims | null> {
    const p = await this.verify(token, AUD.session);
    if (!p || typeof p.sub !== 'string' || typeof p.sid !== 'string') return null;
    return { userId: p.sub, sessionId: p.sid, name: typeof p.name === 'string' ? p.name : '' };
  }

  signGame(c: GameClaims, ttlS = 4 * 3600): Promise<string> {
    return this.sign({ name: c.name }, AUD.game, ttlS, c.userId);
  }

  async verifyGame(token: string): Promise<GameClaims | null> {
    const p = await this.verify(token, AUD.game);
    if (!p || typeof p.sub !== 'string') return null;
    return { userId: p.sub, name: typeof p.name === 'string' ? p.name : '' };
  }

  signMagic(emailHash: string, name: string, redirect: string, ttlS = 15 * 60): Promise<string> {
    return this.sign({ em: emailHash, nm: name, rd: redirect, jti: randomId() }, AUD.magic, ttlS);
  }

  async verifyMagic(token: string): Promise<MagicClaims | null> {
    const p = await this.verify(token, AUD.magic);
    if (!p || typeof p.em !== 'string' || typeof p.jti !== 'string' || typeof p.exp !== 'number') return null;
    return {
      emailHash: p.em,
      name: typeof p.nm === 'string' ? p.nm : '',
      redirect: typeof p.rd === 'string' ? p.rd : '/',
      jti: p.jti,
      exp: p.exp,
    };
  }

  signOAuthState(c: OAuthStateClaims, ttlS = 600): Promise<string> {
    return this.sign({ p: c.provider, st: c.state, pv: c.verifier, rd: c.redirect, ...(c.userId ? { uid: c.userId } : {}) }, AUD.oauth, ttlS);
  }

  async verifyOAuthState(token: string): Promise<OAuthStateClaims | null> {
    const p = await this.verify(token, AUD.oauth);
    if (!p || typeof p.p !== 'string' || typeof p.st !== 'string' || typeof p.pv !== 'string') return null;
    const c: OAuthStateClaims = { provider: p.p, state: p.st, verifier: p.pv, redirect: typeof p.rd === 'string' ? p.rd : '/' };
    if (typeof p.uid === 'string') c.userId = p.uid;
    return c;
  }
}
