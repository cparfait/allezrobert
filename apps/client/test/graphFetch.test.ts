import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const page = () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });

describe('graphFetch', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('web : le graphe du site suffit, le serveur des mondes n\'est pas sollicité', async () => {
    const fetchMock = vi.fn(async () => json({ ok: 'local' }));
    vi.stubGlobal('fetch', fetchMock);
    const { graphFetch } = await import('../src/world/packs.ts');
    expect(await (await graphFetch('/worlds/z/graph.json')).json()).toEqual({ ok: 'local' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('application Windows : fichier absent de l\'installateur (page d\'accueil servie) → serveur des mondes', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    const fetchMock = vi.fn(async (url: string) => (url.startsWith('https://allezrobert.cparfait.ovh') ? json({ ok: 'serveur' }) : page()));
    vi.stubGlobal('fetch', fetchMock);
    const { graphFetch } = await import('../src/world/packs.ts');
    expect(await (await graphFetch('/worlds/z/graph.json')).json()).toEqual({ ok: 'serveur' });
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/worlds/z/graph.json', 'https://allezrobert.cparfait.ovh/worlds/z/graph.json']);
  });

  it('introuvable partout : renvoie la réponse locale, sans lever', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    const { graphFetch } = await import('../src/world/packs.ts');
    expect((await graphFetch('/worlds/z/graph.json')).ok).toBe(false);
  });

  it('hors ligne (fetch qui échoue) : 404 plutôt qu\'une exception', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('network'))));
    const { graphFetch } = await import('../src/world/packs.ts');
    expect((await graphFetch('/worlds/z/graph.json')).status).toBe(404);
  });
});
