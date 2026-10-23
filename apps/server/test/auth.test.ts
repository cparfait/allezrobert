import { describe, expect, it } from 'vitest';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import { TokenService } from '../src/auth/tokens.ts';
import { DataCipher } from '../src/crypto.ts';
import { authorizeUrl, newPkce, safeRedirect } from '../src/auth/oauth.ts';
import { createLiveKitToken } from '../src/integrations/livekit.ts';
import { levelForXp, levelInfo, validateEquipped, xpForLevel, xpForRide } from '../src/progression/xp.ts';
import { loadConfig } from '../src/config.ts';

const SECRET = 'test-secret-test-secret-test-secret-0123456789';

describe('jetons (jose)', () => {
  const tokens = new TokenService(SECRET);

  it('session : aller-retour et rejet des jetons altérés', async () => {
    const t = await tokens.signSession({ userId: 'u-1', sessionId: 's-1', name: 'Robert' }, 3600);
    expect(await tokens.verifySession(t)).toEqual({ userId: 'u-1', sessionId: 's-1', name: 'Robert' });
    const [h, p, s] = t.split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify({ ...decodeJwt(t), sub: 'admin' })).toString('base64url')}.${s}`;
    expect(await tokens.verifySession(forged)).toBeNull();
    expect(await tokens.verifySession(`${h}.${p}.${s!.slice(0, -2)}xx`)).toBeNull();
    expect(await new TokenService(`${SECRET}-autre`).verifySession(t)).toBeNull();
    expect(decodeProtectedHeader(t).alg).toBe('HS256');
  });

  it('audiences cloisonnées : un jeton de jeu ne vaut pas session', async () => {
    const game = await tokens.signGame({ userId: 'u-1', name: 'Robert' });
    expect(await tokens.verifyGame(game)).toEqual({ userId: 'u-1', name: 'Robert' });
    expect(await tokens.verifySession(game)).toBeNull();
    const session = await tokens.signSession({ userId: 'u-1', sessionId: 's', name: 'R' }, 60);
    expect(await tokens.verifyGame(session)).toBeNull();
    expect(await tokens.verifyMagic(session)).toBeNull();
  });

  it('expiration', async () => {
    const t = await tokens.signGame({ userId: 'u', name: 'n' }, -10);
    expect(await tokens.verifyGame(t)).toBeNull();
  });

  it('lien magique et état OAuth', async () => {
    const m = await tokens.signMagic('hash', 'Christophe', '/garage');
    const c = await tokens.verifyMagic(m);
    expect(c).toMatchObject({ emailHash: 'hash', name: 'Christophe', redirect: '/garage' });
    expect(c!.jti.length).toBeGreaterThan(10);
    const st = await tokens.signOAuthState({ provider: 'strava', state: 'abc', verifier: 'v', redirect: '/', userId: 'u-9' });
    expect(await tokens.verifyOAuthState(st)).toEqual({ provider: 'strava', state: 'abc', verifier: 'v', redirect: '/', userId: 'u-9' });
  });
});

describe('chiffrement des données sensibles (AES-256-GCM)', () => {
  const cipher = new DataCipher(Buffer.alloc(32, 3).toString('base64'));

  it('aller-retour, IV aléatoire, AAD liée à la ligne', () => {
    const a = cipher.encryptJson({ avg: 142, max: 181 }, 'act-hr:1');
    const b = cipher.encryptJson({ avg: 142, max: 181 }, 'act-hr:1');
    expect(a.equals(b)).toBe(false);
    expect(cipher.decryptJson(a, 'act-hr:1')).toEqual({ avg: 142, max: 181 });
    // Bloc recopié sur une autre ligne : refusé.
    expect(() => cipher.decrypt(a, 'act-hr:2')).toThrow();
    const tampered = Buffer.from(a);
    tampered[tampered.length - 1]! ^= 1;
    expect(() => cipher.decrypt(tampered, 'act-hr:1')).toThrow();
    expect(() => new DataCipher(Buffer.alloc(32, 4).toString('base64')).decrypt(a, 'act-hr:1')).toThrow();
  });

  it("empreinte d'e-mail normalisée, sans e-mail en clair", () => {
    const h = cipher.emailHash('  Christophe.Parfait@Example.FR ');
    expect(h).toBe(cipher.emailHash('christophe.parfait@example.fr'));
    expect(h).not.toContain('christophe');
    expect(h).not.toBe(new DataCipher(Buffer.alloc(32, 9).toString('base64')).emailHash('christophe.parfait@example.fr'));
  });
});

describe('OAuth, LiveKit, configuration', () => {
  it('URL d’autorisation avec PKCE S256', () => {
    const p = newPkce();
    const url = new URL(authorizeUrl('google', { clientId: 'cid', clientSecret: 'x', redirectUri: 'https://a/cb' }, p));
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe(p.state);
    expect(url.searchParams.get('code_challenge')).not.toBe(p.verifier);
    expect(safeRedirect('//evil.com')).toBe('/');
    expect(safeRedirect('https://evil.com')).toBe('/');
    expect(safeRedirect('/garage?x=1')).toBe('/garage?x=1');
  });

  it('jeton LiveKit : claims attendus', async () => {
    const g = await createLiveKitToken({ url: 'wss://lk', apiKey: 'APIkey', apiSecret: 'secret-secret-secret-secret' }, { identity: 'u-1', name: 'Robert', room: 'ride-abc' });
    const c = decodeJwt(g.token) as Record<string, any>;
    expect(c.iss).toBe('APIkey');
    expect(c.sub).toBe('u-1');
    expect(c.video).toMatchObject({ room: 'ride-abc', roomJoin: true, canPublish: true, canSubscribe: true });
    expect(g.url).toBe('wss://lk');
  });

  it('configuration : secrets obligatoires, garde-fous de production', () => {
    expect(() => loadConfig({})).toThrow(/SESSION_SECRET/);
    const base = { SESSION_SECRET: SECRET, DATA_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64') };
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', DATABASE_URL: 'memory' })).toThrow(/memory/);
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', DATABASE_URL: 'postgres://x', DEV_LOGIN: 'true' })).toThrow(/DEV_LOGIN/);
    const c = loadConfig({ ...base, PUBLIC_URL: 'https://allezrobert.cparfait.ovh', DATABASE_URL: 'postgres://x' });
    expect(c.cookieSecure).toBe(true);
    expect(c.corsOrigins).toContain('https://allezrobert.cparfait.ovh');
    expect(c.apiPublicUrl).toBe('https://allezrobert.cparfait.ovh');
  });
});

describe('progression', () => {
  it('formule d’XP et niveaux', () => {
    expect(xpForRide({ distanceM: 30_000, elevationM: 300, movingS: 3600 })).toBe(1020);
    expect(xpForRide({ distanceM: 1e7, elevationM: 1e5, movingS: 1e6 })).toBe(4000);
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(500);
    expect(xpForLevel(10)).toBe(22_500);
    for (const xp of [0, 499, 500, 1499, 1500, 22_499, 22_500, 1e9]) {
      const l = levelForXp(xp);
      expect(xpForLevel(l)).toBeLessThanOrEqual(xp);
      if (l < 50) expect(xpForLevel(l + 1)).toBeGreaterThan(xp);
    }
    expect(levelInfo(1000)).toMatchObject({ level: 2, nextLevelXp: 1500, progress: 0.5 });
    expect(validateEquipped({ jersey: 'jersey-club-bleu' }, 1)).toBeNull();
    expect(validateEquipped({ jersey: 'jersey-pois' }, 3)).toMatch(/niveau 10/);
    expect(validateEquipped({ helmet: 'jersey-pois' }, 50)).toMatch(/emplacement/);
    // Vélos du catalogue ; anciens identifiants du garage acceptés (migrés).
    expect(validateEquipped({ bike: 'bike-alu' }, 1)).toBeNull();
    expect(validateEquipped({ bike: 's26-01-uae-y1rs' }, 1)).toMatch(/niveau 30/);
    expect(validateEquipped({ bike: 'bike-inconnu' }, 50)).toMatch(/inconnu/);
  });
});
