import { describe, expect, it } from 'vitest';
import { RefCache } from '../src/v3/assetCache.ts';

/** Cache instrumenté : compte les chargements et note les destructions. */
function setup() {
  const disposed: string[] = [];
  let loads = 0;
  const cache = new RefCache<{ id: string }>((value) => disposed.push(value.id));
  const load = (id: string) => async () => {
    loads++;
    return { id };
  };
  return { cache, disposed, load, loads: () => loads };
}

describe('RefCache (ressources V3 partagées entre coureurs)', () => {
  it('charge une seule fois une ressource demandée par plusieurs coureurs', async () => {
    const { cache, load, loads } = setup();
    const [a, b, c] = await Promise.all([cache.acquire('velo', load('velo')), cache.acquire('velo', load('velo')), cache.acquire('velo', load('velo'))]);
    expect(loads()).toBe(1);
    expect(a.value).toBe(b.value);
    expect(b.value).toBe(c.value);
    expect(cache.refs('velo')).toBe(3);
    expect(cache.size).toBe(1);
  });

  it('ne détruit la ressource qu’au départ du dernier utilisateur', async () => {
    const { cache, disposed, load } = setup();
    const a = await cache.acquire('corps', load('corps'));
    const b = await cache.acquire('corps', load('corps'));
    a.release();
    expect(disposed).toEqual([]);
    expect(cache.refs('corps')).toBe(1);
    b.release();
    expect(disposed).toEqual(['corps']);
    expect(cache.refs('corps')).toBe(0);
    expect(cache.size).toBe(0);
  });

  it('ignore une double libération : la part d’un autre coureur n’est pas rendue à sa place', async () => {
    const { cache, disposed, load } = setup();
    const a = await cache.acquire('roue', load('roue'));
    const b = await cache.acquire('roue', load('roue'));
    a.release();
    a.release();
    a.release();
    expect(cache.refs('roue')).toBe(1);
    expect(disposed).toEqual([]);
    b.release();
    b.release();
    expect(disposed).toEqual(['roue']);
  });

  it('recharge une ressource redemandée après sa destruction', async () => {
    const { cache, disposed, load, loads } = setup();
    (await cache.acquire('casque', load('casque'))).release();
    const again = await cache.acquire('casque', load('casque'));
    expect(loads()).toBe(2);
    expect(disposed).toEqual(['casque']);
    expect(cache.refs('casque')).toBe(1);
    again.release();
    expect(disposed).toEqual(['casque', 'casque']);
  });

  it('ne garde pas un chargement en échec : la demande suivante recommence', async () => {
    const { cache, disposed, load } = setup();
    const fail = async (): Promise<{ id: string }> => {
      throw new Error('404');
    };
    await expect(Promise.all([cache.acquire('tenue', fail), cache.acquire('tenue', fail)])).rejects.toThrow('404');
    expect(cache.size).toBe(0);
    expect(cache.refs('tenue')).toBe(0);
    const ok = await cache.acquire('tenue', load('tenue'));
    expect(ok.value.id).toBe('tenue');
    ok.release();
    expect(disposed).toEqual(['tenue']);
  });

  it('tient des ressources distinctes séparément', async () => {
    const { cache, disposed, load } = setup();
    const a = await cache.acquire('a', load('a'));
    const b = await cache.acquire('b', load('b'));
    a.release();
    expect(disposed).toEqual(['a']);
    expect(cache.refs('b')).toBe(1);
    b.release();
    expect(disposed).toEqual(['a', 'b']);
  });
});
