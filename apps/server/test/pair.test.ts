/**
 * Salle « pair » (appli compagnon appairée par QR code) de bout en bout : vrai serveur
 * Colyseus, SDK client des deux côtés, sans compte. Appairage par jeton, relais des commandes
 * et de l'état, cache pour un téléphone qui arrive, remplacement du jeu, présence.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { PAIR_MSG, PAIR_ROOM, decimateRoute, type PairPresence, type PairState, type PhoneCommand } from '@allezrobert/shared';
import { startServer, type RunningServer } from '../src/server.ts';
import { testConfig } from '../src/config.ts';

let srv: RunningServer;
let endpoint: string;

beforeAll(async () => {
  srv = await startServer({ config: testConfig({ LOG_LEVEL: 'warn' }), port: 0, noSignals: true });
  endpoint = `http://127.0.0.1:${srv.port}`;
});

afterAll(async () => {
  await srv.stop();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function next<T>(room: Room, type: string, pred: (m: T) => boolean = () => true, ms = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`délai dépassé (${type})`)), ms);
    const off = room.onMessage(type, (m: T) => {
      if (!pred(m)) return;
      clearTimeout(timer);
      off();
      resolve(m);
    });
  });
}

const join = (pair: string, role: 'game' | 'phone') => new Client(endpoint).joinOrCreate(PAIR_ROOM, { pair, role });

describe('salle pair', () => {
  it('relie jeu et téléphone par le jeton, sans compte', async () => {
    const pair = 'AbCdEfGhIjKlMnOpQrStUv';
    const game = await join(pair, 'game');
    const presence = next<PairPresence>(game, PAIR_MSG.presence, (p) => p.phones === 1);
    const phone = await join(pair, 'phone');
    expect(phone.roomId).toBe(game.roomId);
    expect(await presence).toEqual({ game: true, phones: 1 });

    // Téléphone → jeu : commande validée et relayée ; commande invalide ignorée.
    const cmd = next<PhoneCommand>(game, PAIR_MSG.cmd);
    phone.send(PAIR_MSG.cmd, { kind: 'bogus' });
    phone.send(PAIR_MSG.cmd, { kind: 'turn', delta: -1 });
    expect(await cmd).toEqual({ kind: 'turn', delta: -1 });
    const fan = next<PhoneCommand>(game, PAIR_MSG.cmd);
    phone.send(PAIR_MSG.cmd, { kind: 'fan', percent: 180 });
    expect(await fan).toEqual({ kind: 'fan', percent: 100 });

    // Recherche Spotify : relayée au jeu ; URI de lecture invalide refusée, résultats renvoyés au téléphone.
    const search = next<PhoneCommand>(game, PAIR_MSG.cmd);
    phone.send(PAIR_MSG.cmd, { kind: 'musicPlay', uri: 'https://evil.example/x' });
    phone.send(PAIR_MSG.cmd, { kind: 'musicSearch', query: '  daft punk ' });
    expect(await search).toEqual({ kind: 'musicSearch', query: 'daft punk' });
    const play = next<PhoneCommand>(game, PAIR_MSG.cmd);
    phone.send(PAIR_MSG.cmd, { kind: 'musicPlay', uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC' });
    expect(await play).toEqual({ kind: 'musicPlay', uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC' });
    const results = next<{ kind: string; items: unknown[] }>(phone, PAIR_MSG.event);
    game.send(PAIR_MSG.event, { kind: 'musicResults', query: 'daft punk', items: [{ uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC', type: 'track', name: 'One More Time', sub: 'Daft Punk' }] });
    expect((await results).items).toHaveLength(1);

    // Jeu → téléphone : état relayé.
    const st = next<PairState>(phone, PAIR_MSG.state);
    game.send(PAIR_MSG.state, { phase: 'ride', routeName: 'Billom' } satisfies PairState);
    expect((await st).routeName).toBe('Billom');

    // Un téléphone qui arrive reçoit tout de suite la route et le dernier état.
    game.send(PAIR_MSG.route, { name: 'Billom', loop: true, lengthM: 1000, points: decimateRoute([{ x: 0, z: 0, y: 0, d: 0 }, { x: 10.4, z: 0, y: 1, d: 10 }]) });
    await sleep(100);
    const c2 = new Client(endpoint);
    const late = await c2.joinOrCreate(PAIR_ROOM, { pair, role: 'phone' });
    const got = await Promise.all([next<{ points: number[] }>(late, PAIR_MSG.route), next<PairState>(late, PAIR_MSG.state)]);
    expect(got[0].points).toEqual([0, 0, 0, 0, 10, 0, 1, 10]);
    expect(got[1].phase).toBe('ride');

    // Le jeu se recharge : la nouvelle connexion remplace l'ancienne, les téléphones restent.
    const left = new Promise<void>((r) => game.onLeave(() => r()));
    const game2 = await join(pair, 'game');
    await left;
    expect(game2.roomId).toBe(phone.roomId);
    const cmd2 = next<PhoneCommand>(game2, PAIR_MSG.cmd);
    phone.send(PAIR_MSG.cmd, { kind: 'shift', action: 'up' });
    expect(await cmd2).toEqual({ kind: 'shift', action: 'up' });

    // Un autre jeton : une autre salle.
    const other = await join('ZzZzZzZzZzZzZzZzZzZzZz', 'phone');
    expect(other.roomId).not.toBe(phone.roomId);

    // Le jeu part : les téléphones le savent.
    const gone = next<PairPresence>(phone, PAIR_MSG.presence, (p) => !p.game);
    await game2.leave(true);
    expect(await gone).toEqual({ game: false, phones: 2 });
    await Promise.all([phone.leave(true), late.leave(true), other.leave(true)]);
  });

  it('compte une seule fois le même téléphone qui se reconnecte', async () => {
    const pair = 'DeViCeDeViCeDeViCeDeViCe';
    const game = await join(pair, 'game');
    const device = 'tel-12345678-abcd';
    const first = await new Client(endpoint).joinOrCreate(PAIR_ROOM, { pair, role: 'phone', device });
    await next<PairPresence>(game, PAIR_MSG.presence, (p) => p.phones === 1);
    // Même appareil, nouvelle connexion (page rechargée) : l'ancienne est fermée, toujours un seul téléphone.
    const closed = new Promise<void>((r) => first.onLeave(() => r()));
    const second = await new Client(endpoint).joinOrCreate(PAIR_ROOM, { pair, role: 'phone', device });
    await closed;
    expect(await next<PairPresence>(game, PAIR_MSG.presence, (p) => p.game && p.phones === 1)).toEqual({ game: true, phones: 1 });
    // Un autre appareil compte, lui.
    const other = await new Client(endpoint).joinOrCreate(PAIR_ROOM, { pair, role: 'phone', device: 'autre-87654321-dcba' });
    expect(await next<PairPresence>(game, PAIR_MSG.presence, (p) => p.phones === 2)).toEqual({ game: true, phones: 2 });
    await Promise.all([second.leave(true), other.leave(true), game.leave(true)]);
  });

  it('refuse un jeton mal formé', async () => {
    await expect(join('court', 'phone')).rejects.toThrow();
    await expect(join('pas un jeton avec espaces !!', 'phone')).rejects.toThrow();
  });
});
