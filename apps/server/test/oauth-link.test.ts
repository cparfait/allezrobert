/**
 * OAuth Discord / Google : PKCE, identité renvoyée par le fournisseur, et liaison de compte
 * (identifiant fournisseur d'abord ; fusion par e-mail seulement si l'e-mail est vérifié).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createDb, migrate, type Db } from '../src/db/db.ts';
import { Repos } from '../src/db/repos.ts';
import { DataCipher } from '../src/crypto.ts';
import { authorizeUrl, exchangeCode, fetchIdentity, newPkce } from '../src/auth/oauth.ts';
import { loginClient } from '../src/http/auth-routes.ts';
import { testConfig } from '../src/config.ts';
import { createContext } from '../src/context.ts';
import { RouteStore } from '../src/ride/routes.ts';

const client = { clientId: 'cid', clientSecret: 'placeholder', redirectUri: 'https://a.test/api/auth/discord/callback' };
const jsonRes = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

describe('PKCE et URL d’autorisation', () => {
  it('le challenge est le SHA-256 base64url du verifier ; state et verifier uniques', () => {
    const a = newPkce();
    const b = newPkce();
    expect(a.challenge).toBe(createHash('sha256').update(a.verifier).digest('base64url'));
    expect(a.state).not.toBe(b.state);
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.verifier.length).toBeGreaterThanOrEqual(43);
  });

  it('Discord : redirect_uri, scope et PKCE S256 dans l’URL', () => {
    const p = newPkce();
    const u = new URL(authorizeUrl('discord', client, p));
    expect(u.origin + u.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(u.searchParams.get('redirect_uri')).toBe(client.redirectUri);
    expect(u.searchParams.get('scope')).toBe('identify email');
    expect(u.searchParams.get('code_challenge')).toBe(p.challenge);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('l’échange du code envoie le code_verifier', async () => {
    let sent: URLSearchParams | undefined;
    const f: typeof fetch = async (_u, init) => {
      sent = init!.body as URLSearchParams;
      return jsonRes({ access_token: 't' });
    };
    await exchangeCode('discord', client, 'le-code', 'le-verifier', f);
    expect(sent!.get('code_verifier')).toBe('le-verifier');
    expect(sent!.get('code')).toBe('le-code');
    const refuse: typeof fetch = async () => jsonRes({}, 400);
    await expect(exchangeCode('google', client, 'c', 'v', refuse)).rejects.toThrow(/refusé/);
  });
});

describe('identité fournisseur', () => {
  it('Discord : e-mail retenu seulement s’il est vérifié', async () => {
    const mk = (verified: boolean): typeof fetch => async () => jsonRes({ id: '42', global_name: 'Rob', email: 'r@example.fr', verified });
    expect(await fetchIdentity('discord', 't', mk(true))).toEqual({ subject: '42', displayName: 'Rob', verifiedEmail: 'r@example.fr' });
    expect((await fetchIdentity('discord', 't', mk(false))).verifiedEmail).toBeUndefined();
  });
  it('Google : email_verified requis', async () => {
    const mk = (v: boolean): typeof fetch => async () => jsonRes({ sub: 'g1', given_name: 'Gé', email: 'g@example.fr', email_verified: v });
    expect((await fetchIdentity('google', 't', mk(true))).verifiedEmail).toBe('g@example.fr');
    expect((await fetchIdentity('google', 't', mk(false))).verifiedEmail).toBeUndefined();
  });
});

describe('configuration : bouton masqué sans identifiants', () => {
  it('loginClient renvoie null sans id/secret, et l’URL de callback sinon', async () => {
    const db = await createDb('memory');
    const mk = (o: Record<string, string>) => createContext(testConfig(o), db, null as unknown as RouteStore, {});
    expect(loginClient(mk({}), 'discord')).toBeNull();
    expect(loginClient(mk({ DISCORD_CLIENT_ID: 'x' }), 'discord')).toBeNull();
    expect(loginClient(mk({ DISCORD_CLIENT_ID: 'x', DISCORD_CLIENT_SECRET: 'y' }), 'discord')!.redirectUri).toBe('http://localhost:2567/api/auth/discord/callback');
    await db.close();
  });
});

describe('liaison de compte', () => {
  let db: Db;
  let repos: Repos;
  const cipher = new DataCipher(Buffer.alloc(32, 7).toString('base64'));
  beforeAll(async () => {
    db = await createDb('memory');
    await migrate(db);
    repos = new Repos(db, cipher);
  });
  afterAll(async () => db.close());

  it('même identifiant fournisseur = même compte', async () => {
    const a = await repos.upsertIdentity('discord', 'd-1', 'Alice');
    const b = await repos.upsertIdentity('discord', 'd-1', 'Autre nom');
    expect(b.id).toBe(a.id);
  });

  it('e-mail vérifié : rattaché au compte existant (lien magique puis Discord)', async () => {
    const h = cipher.emailHash('bob@example.fr');
    const magic = await repos.upsertIdentity('email', h, 'Bob', h);
    const viaDiscord = await repos.upsertIdentity('discord', 'd-2', 'Bobby', h);
    expect(viaDiscord.id).toBe(magic.id);
    // La même personne revient ensuite par Google avec le même e-mail vérifié.
    expect((await repos.upsertIdentity('google', 'g-2', 'Bob', h)).id).toBe(magic.id);
  });

  it('e-mail non vérifié (pas d’empreinte) : jamais de fusion, compte distinct', async () => {
    const h = cipher.emailHash('carl@example.fr');
    const existing = await repos.upsertIdentity('email', h, 'Carl', h);
    const intrus = await repos.upsertIdentity('discord', 'd-3', 'Carl');
    expect(intrus.id).not.toBe(existing.id);
  });
});
