/**
 * Itinéraires lus à la demande (entrée « racine / étoile / routes » de ROUTES_DIR) : index sans analyse
 * des points, zone qui départage un identifiant commun, cache borné, lecture unique pour deux demandes
 * simultanées ; puis de bout en bout, une sortie privée sur une autre zone et un identifiant inconnu refusé.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RouteData } from '@allezrobert/shared';
import { RideNetClient } from '../../client/src/net/index.ts';
import { testConfig } from '../src/config.ts';
import { FALLBACK_ROUTE_ID, MAX_LAZY, RouteStore, proceduralLoop } from '../src/ride/routes.ts';
import { startServer, type RunningServer } from '../src/server.ts';

let root: string;
let eagerDir: string;

/** Boucle de développement renommée et décalée : chaque zone a un tracé reconnaissable. */
function route(id: string, name: string, shiftX: number): RouteData {
  const r = proceduralLoop();
  return { ...r, id, name, points: r.points.map((p) => ({ ...p, x: p.x + shiftX })) };
}

async function put(world: string, r: RouteData): Promise<string> {
  const dir = path.join(root, world, 'routes');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${r.id}.json`);
  await writeFile(file, JSON.stringify(r));
  return file;
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'ar-routes-'));
  await put('zone-a', route('boucle-20-km', 'Boucle de A', 10_000));
  await put('zone-b', route('boucle-20-km', 'Boucle de B', 20_000));
  await put('zone-b', route('tour-de-b', 'Tour de B', 30_000));
  for (let i = 0; i < MAX_LAZY + 3; i++) await put('zone-c', route(`circuit-${i}`, `Circuit ${i}`, 40_000 + i));
  // un dossier « routes » qui n'en est pas un, et un fichier illisible : ignorés sans casser l'index
  await mkdir(path.join(root, 'zone-vide'), { recursive: true });
  await mkdir(path.join(root, 'zone-d', 'routes'), { recursive: true });
  await writeFile(path.join(root, 'zone-d', 'routes', 'casse.json'), '{"id":"casse","name":');
  eagerDir = path.join(root, 'zone-b', 'routes');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const glob = (): string => `${root}/*/routes`;

describe('RouteStore : itinéraires à la demande', () => {
  it('indexe toutes les zones sans rien charger en mémoire', async () => {
    const logs: string[] = [];
    const store = await RouteStore.load(glob(), (m) => logs.push(m));
    expect(store.indexed).toBe(3 + MAX_LAZY + 3 + 1);
    expect(store.lazyLoaded).toBe(0);
    expect(store.strict).toBe(true);
    // aucun dossier ordinaire : la boucle de développement reste le seul itinéraire chargé
    expect(store.list().map((r) => r.id)).toEqual([FALLBACK_ROUTE_ID]);
    expect(logs.some((m) => m.includes('indexé'))).toBe(true);
  });

  it('résout l’itinéraire d’une autre zone, et la zone départage un identifiant commun', async () => {
    const store = await RouteStore.load(glob());
    expect((await store.ensure('tour-de-b'))?.data.name).toBe('Tour de B');
    expect((await store.ensure('boucle-20-km', 'zone-a'))?.data.name).toBe('Boucle de A');
    expect((await store.ensure('boucle-20-km', 'zone-b'))?.data.name).toBe('Boucle de B');
    // identifiant commun à deux zones, zone non précisée : ambigu, jamais un tracé au hasard
    expect(await store.ensure('boucle-20-km')).toBeUndefined();
    expect(store.isAmbiguous('boucle-20-km')).toBe(true);
    expect(store.isAmbiguous('boucle-20-km', 'zone-a')).toBe(false);
    expect(store.isAmbiguous('tour-de-b')).toBe(false);
  });

  it('refuse un identifiant inconnu, une zone inconnue et un fichier illisible', async () => {
    const store = await RouteStore.load(glob());
    expect(await store.ensure('nulle-part')).toBeUndefined();
    expect(await store.ensure('tour-de-b', 'zone-a')).toBeUndefined();
    expect(await store.ensure('casse')).toBeUndefined();
    expect(await store.ensure('')).toBeUndefined();
    expect(store.isAmbiguous('nulle-part')).toBe(false);
  });

  it('construit le sens inverse et un départ choisi d’un itinéraire à la demande', async () => {
    const store = await RouteStore.load(glob());
    const base = (await store.ensure('tour-de-b'))!;
    const rev = await store.ensure('tour-de-b-inverse');
    expect(rev?.data.id).toBe('tour-de-b-inverse');
    expect(rev?.track.length).toBeCloseTo(base.track.length, 6);
    const p = base.data.points[400]!;
    const started = await store.ensure(`tour-de-b-depart-${Math.round(p.d)}`);
    expect(started?.data.points[0]).toMatchObject({ x: p.x, z: p.z, d: 0 });
    const q = rev!.data.points[300]!;
    expect((await store.ensure(`tour-de-b-inverse-depart-${Math.round(q.d)}`))?.data.points[0]).toMatchObject({ x: q.x, z: q.z });
    expect(await store.ensure('tour-de-b-depart-0')).toBeUndefined();
  });

  it('borne le cache : les moins récemment demandés partent, un itinéraire déjà rendu reste utilisable', async () => {
    const store = await RouteStore.load(glob());
    const first = (await store.ensure('circuit-0'))!;
    for (let i = 1; i < MAX_LAZY + 3; i++) await store.ensure(`circuit-${i}`);
    expect(store.lazyLoaded).toBe(MAX_LAZY);
    // sorti du cache, mais la référence gardée par une salle ouverte reste entière
    expect(first.track.length).toBeGreaterThan(1000);
    expect(first.data.points.length).toBeGreaterThan(100);
    // redemandé : relu, sans dépasser la borne
    const again = (await store.ensure('circuit-0'))!;
    expect(again).not.toBe(first);
    expect(again.data.name).toBe('Circuit 0');
    expect(store.lazyLoaded).toBe(MAX_LAZY);
  });

  it('ne lit le fichier qu’une fois pour deux demandes simultanées, puis sert le cache', async () => {
    const store = await RouteStore.load(glob());
    const read = store.readFileImpl;
    let reads = 0;
    store.readFileImpl = async (file) => {
      reads++;
      await new Promise((r) => setTimeout(r, 20));
      return read(file);
    };
    const [a, b] = await Promise.all([store.ensure('tour-de-b'), store.ensure('tour-de-b')]);
    expect(a).toBeDefined();
    expect(a).toBe(b);
    expect(reads).toBe(1);
    expect(await store.ensure('tour-de-b')).toBe(a);
    expect(reads).toBe(1);
  });

  it('garde le chargement au démarrage des dossiers ordinaires, sans seconde copie par l’index', async () => {
    // l'ordre des entrées ne compte pas : l'index passe après les dossiers ordinaires
    const store = await RouteStore.load(`${glob()},${eagerDir}`);
    expect(store.list().map((r) => r.id).sort()).toEqual(['boucle-20-km', 'tour-de-b']);
    expect(store.indexed).toBe(1 + MAX_LAZY + 3 + 1);
    const eager = store.get('tour-de-b');
    expect(await store.ensure('tour-de-b')).toBe(eager);
    expect(await store.ensure('tour-de-b', 'zone-b')).toBe(eager);
    expect(store.lazyLoaded).toBe(0);
    // la zone précisée l'emporte sur l'itinéraire du démarrage de même identifiant
    expect((await store.ensure('boucle-20-km', 'zone-a'))?.data.name).toBe('Boucle de A');
    expect((await store.ensure('boucle-20-km'))?.data.name).toBe('Boucle de B');
  });

  it('sans entrée à étoile, rien ne change : pas d’index, repli historique permis', async () => {
    const store = await RouteStore.load(eagerDir);
    expect(store.indexed).toBe(0);
    expect(store.strict).toBe(false);
    expect(await store.ensure('nulle-part')).toBeUndefined();
    expect(store.resolve('nulle-part').data.id).toBe('boucle-20-km');
  });
});

describe('salle ride : itinéraire lu à la demande', () => {
  let srv: RunningServer;
  let endpoint: string;

  async function client(name: string): Promise<RideNetClient> {
    const res = await fetch(`${endpoint}/api/auth/dev`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    const token = ((await res.json()) as { sessionToken: string }).sessionToken;
    return new RideNetClient({ endpoint, token, autoRejoin: false });
  }

  beforeAll(async () => {
    srv = await startServer({ config: testConfig({ DEV_LOGIN: 'true', RECONNECT_GRACE_S: '1', LOG_LEVEL: 'error', ROUTES_DIR: `${eagerDir},${glob()}` }), port: 0, noSignals: true });
    endpoint = `http://127.0.0.1:${srv.port}`;
  });

  afterAll(async () => {
    await srv.stop();
  });

  it('sortie privée sur une autre zone : le tracé de cette zone, pas le premier chargé', async () => {
    const a = await client('Alice');
    const w = await a.create({ mode: 'free', routeId: 'boucle-20-km', worldId: 'zone-a' } as never);
    expect(w.route.id).toBe('boucle-20-km');
    expect(w.route.name).toBe('Boucle de A');
    await a.leave();
    const b = await client('Bob');
    const w2 = await b.create({ mode: 'free', routeId: 'circuit-3' });
    expect(w2.route.name).toBe('Circuit 3');
    await b.leave();
  });

  it('identifiant inconnu : refusé au lieu de retomber sur un autre tracé', async () => {
    const a = await client('Carla');
    await expect(a.create({ mode: 'free', routeId: 'nulle-part' })).rejects.toThrow(/Itinéraire inconnu/);
    await expect(a.create({ mode: 'free', routeId: 'tour-de-b', worldId: 'zone-inexistante' } as never)).resolves.toMatchObject({ route: { name: 'Tour de B' } });
    await a.leave();
  });

  it('sans itinéraire demandé, la sortie part sur l’itinéraire par défaut', async () => {
    const a = await client('Dan');
    const w = await a.create({ mode: 'free' });
    expect(w.route.id).toBe('boucle-20-km');
    expect(w.route.name).toBe('Boucle de B');
    await a.leave();
  });
});
