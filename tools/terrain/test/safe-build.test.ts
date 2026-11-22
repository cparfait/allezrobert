import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cachedBlockState } from '../src/dem.ts';
import { parseMeshArgs } from '../src/mesh-args.ts';
import { loadPackIndex, savePackIndex, writePackManifest, type PackIndex, type PackIndexStats } from '../src/packs.ts';
import { DEFAULT_MIN_FREE_GB, minFreeGbFrom } from '../src/preflight.ts';
import {
  BACKUP_NAME,
  BUILD_OK,
  acquireLock,
  checkFreeSpace,
  hasPendingTransactions,
  readBuildMarker,
  recoverInterrupted,
  settleTransactions,
  spaceMessage,
  txCopyDir,
  txFile,
  txMoveDir,
  worldBuiltState,
  writeAtomic,
  writeBuildMarker,
} from '../src/safe-fs.ts';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-terrain-'));
});
afterEach(() => {
  settleTransactions(true);
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

const put = (rel: string, text: string): string => {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
  return f;
};
const get = (rel: string): string => fs.readFileSync(path.join(dir, rel), 'utf8');
const has = (rel: string): boolean => fs.existsSync(path.join(dir, rel));

describe('place libre', () => {
  const targets = (cache: string, out: string) => [
    { label: 'cache', path: cache },
    { label: 'sortie', path: out },
  ];

  it('refuse quand le disque du cache manque de place, même si celui de la sortie en a', () => {
    const cache = path.join(dir, 'cache');
    const out = path.join(dir, 'out');
    fs.mkdirSync(cache);
    fs.mkdirSync(out);
    const realCache = fs.realpathSync(cache);
    const check = checkFreeSpace(targets(cache, out), 30, (p) => (p === realCache ? 4 : 200));
    expect(check.ok).toBe(false);
    expect(check.lacking.map((l) => l.label)).toEqual(['cache']);
    expect(spaceMessage(check, 30)).toContain('cache');
    expect(spaceMessage(check, 30)).toContain('4 Go libres, il en faut 30');
  });

  it('refuse quand c’est le disque de la sortie qui manque de place', () => {
    const cache = path.join(dir, 'cache');
    const out = path.join(dir, 'out');
    fs.mkdirSync(cache);
    fs.mkdirSync(out);
    const realOut = fs.realpathSync(out);
    const check = checkFreeSpace(targets(cache, out), 30, (p) => (p === realOut ? 12 : 300));
    expect(check.ok).toBe(false);
    expect(check.lacking.map((l) => l.label)).toEqual(['sortie']);
  });

  it('accepte quand les deux ont la place, et mesure un dossier pas encore créé par son parent', () => {
    const seen: string[] = [];
    const check = checkFreeSpace(targets(path.join(dir, 'pas', 'encore'), dir), 30, (p) => {
      seen.push(p);
      return 100;
    });
    expect(check.ok).toBe(true);
    expect(seen[0]).toBe(fs.realpathSync(dir));
  });

  it('seuil à 0 : contrôle coupé', () => {
    expect(checkFreeSpace(targets(dir, dir), 0, () => 0).ok).toBe(true);
  });

  it('seuil lu dans l’option, puis l’environnement, puis la valeur par défaut', () => {
    expect(minFreeGbFrom(['--world', 'x', '--min-free-gb', '25'], { TERRAIN_MIN_FREE_GB: '5' })).toBe(25);
    expect(minFreeGbFrom(['--world', 'x'], { TERRAIN_MIN_FREE_GB: '5' })).toBe(5);
    expect(minFreeGbFrom(['--world', 'x'], {})).toBe(DEFAULT_MIN_FREE_GB);
    expect(minFreeGbFrom(['--min-free-gb', 'abc'], {})).toBe(DEFAULT_MIN_FREE_GB);
    expect(minFreeGbFrom(['--min-free-gb', '0'], {})).toBe(0);
  });
});

describe('écriture atomique', () => {
  it('remplace le fichier et ne laisse pas de fichier temporaire', () => {
    const f = put('a.json', 'ancien');
    writeAtomic(f, 'nouveau');
    expect(get('a.json')).toBe('nouveau');
    expect(fs.readdirSync(dir)).toEqual(['a.json']);
  });

  it('interrompue avant le renommage : l’ancien fichier reste intact', () => {
    const f = put('a.json', 'ancien');
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
    });
    expect(() => writeAtomic(f, 'nouveau, coupé en route')).toThrow(/ENOSPC/);
    expect(get('a.json')).toBe('ancien');
    expect(fs.readdirSync(dir)).toEqual(['a.json']);
  });

  it('interrompue pendant l’écriture : l’ancien fichier reste intact', () => {
    const f = put('a.json', 'ancien');
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
    });
    expect(() => writeAtomic(f, 'nouveau')).toThrow(/ENOSPC/);
    vi.restoreAllMocks();
    expect(get('a.json')).toBe('ancien');
  });
});

describe('mise de côté d’une construction', () => {
  it('échec : l’ancien dossier de tuiles revient entier, les tuiles partielles disparaissent', () => {
    put('tiles/0_0.json', 'ancienne tuile');
    put('tiles/pack.json', 'ancien pack');
    txMoveDir(dir, path.join(dir, 'tiles'));
    expect(fs.readdirSync(path.join(dir, 'tiles'))).toEqual([]);
    put('tiles/0_0.json', 'nouvelle tuile, construction coupée ensuite');
    expect(hasPendingTransactions()).toBe(true);
    settleTransactions(false);
    expect(get('tiles/0_0.json')).toBe('ancienne tuile');
    expect(get('tiles/pack.json')).toBe('ancien pack');
    expect(has(BACKUP_NAME)).toBe(false);
  });

  it('succès : les nouvelles tuiles restent, la copie de secours est supprimée', () => {
    put('tiles/0_0.json', 'ancienne tuile');
    txMoveDir(dir, path.join(dir, 'tiles'));
    put('tiles/1_1.json', 'nouvelle tuile');
    settleTransactions(true);
    expect(fs.readdirSync(path.join(dir, 'tiles'))).toEqual(['1_1.json']);
    expect(has(BACKUP_NAME)).toBe(false);
  });

  it('itinéraires et world.json : remis tels quels après un échec', () => {
    put('routes/a.json', 'itinéraire a');
    put('world.json', 'monde ancien');
    txCopyDir(dir, path.join(dir, 'routes'));
    txFile(dir, path.join(dir, 'world.json'));
    put('routes/b.json', 'itinéraire b, nouveau');
    fs.rmSync(path.join(dir, 'routes', 'a.json'));
    put('world.json', 'monde nouveau');
    settleTransactions(false);
    expect(fs.readdirSync(path.join(dir, 'routes'))).toEqual(['a.json']);
    expect(get('world.json')).toBe('monde ancien');
  });

  it('première construction ratée : rien à remettre, les fichiers partiels restent, sans copie de secours', () => {
    txMoveDir(dir, path.join(dir, 'tiles'));
    txFile(dir, path.join(dir, 'world.json'));
    put('tiles/0_0.json', 'partiel');
    settleTransactions(false);
    expect(get('tiles/0_0.json')).toBe('partiel');
    expect(has(BACKUP_NAME)).toBe(false);
  });

  it('arrêt brutal : au lancement suivant, l’ancienne zone est remise en place', () => {
    // état laissé par un processus tué : tuiles partielles, anciennes tuiles et ancien world.json mis de côté
    put('tiles/0_0.json', 'partiel');
    put(`${BACKUP_NAME}/tiles/0_0.json`, 'ancienne tuile');
    put(`${BACKUP_NAME}/tiles/0_1.json`, 'ancienne tuile 2');
    put(`${BACKUP_NAME}/world.json`, 'monde ancien');
    put('world.json', 'monde à moitié écrit');
    expect(recoverInterrupted(dir).sort()).toEqual(['tiles', 'world.json']);
    expect(fs.readdirSync(path.join(dir, 'tiles')).sort()).toEqual(['0_0.json', '0_1.json']);
    expect(get('tiles/0_0.json')).toBe('ancienne tuile');
    expect(get('world.json')).toBe('monde ancien');
    expect(has(BACKUP_NAME)).toBe(false);
    expect(recoverInterrupted(dir)).toEqual([]);
  });
});

describe('zone déjà construite', () => {
  const world = (ids: string[]) => put('world.json', JSON.stringify({ tiles: ids.map((id) => ({ id })) }));
  const tile = (id: string) => {
    put(`tiles/${id}.json`, '{}');
    put(`tiles/${id}.lo.u16`, 'x');
  };

  it('témoin de fin présent : construite', () => {
    world(['0_0']);
    writeBuildMarker(dir, 'zone-test', 1, new Date('2026-11-22T10:00:00Z'));
    expect(readBuildMarker(dir)).toEqual({ formatVersion: 1, world: 'zone-test', builtAt: '2026-11-22T10:00:00.000Z', tiles: 1 });
    expect(worldBuiltState(dir).built).toBe(true);
  });

  it('zone ancienne sans témoin mais complète : construite, pas reconstruite de force', () => {
    world(['0_0', '0_1']);
    tile('0_0');
    tile('0_1');
    expect(worldBuiltState(dir)).toMatchObject({ built: true });
  });

  it('zone ancienne dont les tuiles ne sont pas sur cette machine : tenue pour construite, comme avant', () => {
    world(['0_0']);
    expect(worldBuiltState(dir).built).toBe(true);
    // dossier de tuiles présent mais sans aucune tuile (seulement le catalogue du pack) : même jugement
    put('tiles/pack.json', '{}');
    expect(worldBuiltState(dir)).toMatchObject({ built: true });
  });

  it('world.json présent mais des tuiles manquent : à reconstruire', () => {
    world(['0_0', '0_1', '0_2']);
    tile('0_0');
    const s = worldBuiltState(dir);
    expect(s.built).toBe(false);
    expect(s.reason).toContain('2 tuile(s) manquante(s)');
  });

  it('construction interrompue (copie de secours restée) : à reconstruire, même avec un témoin', () => {
    world(['0_0']);
    tile('0_0');
    writeBuildMarker(dir, 'zone-test', 1);
    fs.mkdirSync(path.join(dir, BACKUP_NAME));
    expect(worldBuiltState(dir).built).toBe(false);
  });

  it('sans world.json : pas construite', () => {
    expect(worldBuiltState(dir).built).toBe(false);
  });
});

describe('bloc du cache MNT', () => {
  it('reconnaît un bloc entier, un bloc tronqué et un bloc absent', () => {
    const n = 5;
    const ok = put('ok.f32', '');
    fs.writeFileSync(ok, Buffer.alloc(n * n * 4));
    const cut = put('cut.f32', '');
    fs.writeFileSync(cut, Buffer.alloc(n * n * 4 - 7));
    expect(cachedBlockState(ok, n)).toBe('ok');
    expect(cachedBlockState(cut, n)).toBe('truncated');
    expect(cachedBlockState(path.join(dir, 'absent.f32'), n)).toBe('missing');
    // un bloc valide n'est jamais touché par le contrôle
    expect(fs.statSync(ok).size).toBe(n * n * 4);
  });
});

describe('options de mesh-build', () => {
  it('aucune purge du cache par défaut', () => {
    expect(parseMeshArgs([]).purgeCache).toBe(false);
    expect(parseMeshArgs(['--only', 'a,b', '--limit', '2'])).toMatchObject({ purgeCache: false, only: ['a', 'b'], limit: 2, minFreeGb: 30 });
  });

  it('--keep-cache reste accepté et ne change rien ; --purge-cache la demande', () => {
    expect(parseMeshArgs(['--keep-cache']).purgeCache).toBe(false);
    expect(parseMeshArgs(['--purge-cache', '--min-free-gb', '50'])).toMatchObject({ purgeCache: true, minFreeGb: 50 });
  });
});

describe('verrou', () => {
  it('pris une fois, refusé à un second processus vivant, rendu à la fin', () => {
    const file = path.join(dir, 'work', 'mesh-build.lock');
    const a = acquireLock(file, { pid: 111, isAlive: () => true });
    expect(a.ok).toBe(true);
    const b = acquireLock(file, { pid: 222, isAlive: () => true });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.holder.pid).toBe(111);
    if (a.ok) a.release();
    expect(fs.existsSync(file)).toBe(false);
    expect(acquireLock(file, { pid: 222, isAlive: () => true }).ok).toBe(true);
  });

  it('verrou périmé (trop vieux, ou processus disparu) : ignoré et repris', () => {
    const file = path.join(dir, 'mesh-build.lock');
    const t0 = Date.parse('2026-11-01T00:00:00Z');
    expect(acquireLock(file, { pid: 111, now: () => t0, isAlive: () => true }).ok).toBe(true);
    // encore frais et processus vivant : refusé
    expect(acquireLock(file, { pid: 222, now: () => t0 + 3600_000, staleMs: 86_400_000, isAlive: () => true }).ok).toBe(false);
    // trop vieux : repris
    const old = acquireLock(file, { pid: 222, now: () => t0 + 2 * 86_400_000, staleMs: 86_400_000, isAlive: () => true });
    expect(old.ok).toBe(true);
    // processus disparu : repris tout de suite
    expect(acquireLock(file, { pid: 333, now: () => t0 + 2 * 86_400_000 + 1000, staleMs: 86_400_000, isAlive: () => false }).ok).toBe(true);
    expect((JSON.parse(fs.readFileSync(file, 'utf8')) as { pid: number }).pid).toBe(333);
  });

  it('rendre un verrou repris par un autre ne supprime pas le sien', () => {
    const file = path.join(dir, 'mesh-build.lock');
    const a = acquireLock(file, { pid: 111, isAlive: () => false });
    const b = acquireLock(file, { pid: 222, isAlive: () => false });
    expect(b.ok).toBe(true);
    if (a.ok) a.release();
    expect(fs.existsSync(file)).toBe(true);
  });

  it('fichier de verrou illisible : repris', () => {
    const file = put('mesh-build.lock', 'pas du json');
    expect(acquireLock(file, { pid: 111, isAlive: () => true }).ok).toBe(true);
  });
});

describe('index des packs', () => {
  const makeWorld = () => {
    put('tiles/0_0.json', JSON.stringify({ a: 1, texte: 'x'.repeat(400) }));
    put('tiles/0_0.lo.u16', 'abcdefgh'.repeat(60));
    put('tiles/0_0.ortho.jpg', 'pas une vraie image, jamais recompressée');
  };

  it('second passage : rien n’est relu, le manifeste est identique', () => {
    makeWorld();
    const index: PackIndex = {};
    const first: PackIndexStats = { reused: 0, read: 0 };
    const m1 = writePackManifest(dir, 'zone-test', index, first);
    expect(first).toEqual({ reused: 0, read: 3 });
    const second: PackIndexStats = { reused: 0, read: 0 };
    const m2 = writePackManifest(dir, 'zone-test', index, second);
    expect(second).toEqual({ reused: 3, read: 0 });
    expect(m2).toEqual(m1);
    // même résultat que sans index
    expect(writePackManifest(dir, 'zone-test')).toEqual(m1);
  });

  it('un fichier modifié est relu, les autres repris', () => {
    makeWorld();
    const index: PackIndex = {};
    const m1 = writePackManifest(dir, 'zone-test', index);
    const f = path.join(dir, 'tiles', '0_0.json');
    fs.writeFileSync(f, JSON.stringify({ a: 2, texte: 'y'.repeat(900) }));
    fs.utimesSync(f, new Date(), new Date(Date.now() + 5000));
    const stats: PackIndexStats = { reused: 0, read: 0 };
    const m2 = writePackManifest(dir, 'zone-test', index, stats);
    expect(stats).toEqual({ reused: 2, read: 1 });
    expect(m2?.version).not.toBe(m1?.version);
    expect(m2?.files.find((x) => x.p === 'tiles/0_0.json')?.h).not.toBe(m1?.files.find((x) => x.p === 'tiles/0_0.json')?.h);
  });

  it('le témoin de fin et pack.json ne sont pas dans le pack, et ne changent pas sa version', () => {
    makeWorld();
    const before = writePackManifest(dir, 'zone-test');
    writeBuildMarker(dir, 'zone-test', 1);
    const after = writePackManifest(dir, 'zone-test');
    expect(after?.files.map((f) => f.p)).toEqual(['tiles/0_0.json', 'tiles/0_0.lo.u16', 'tiles/0_0.ortho.jpg']);
    expect(after?.version).toBe(before?.version);
    expect(fs.existsSync(path.join(dir, 'tiles', BUILD_OK))).toBe(true);
  });

  it('l’index s’enregistre et se relit ; un index illisible repart de zéro', () => {
    makeWorld();
    const index: PackIndex = {};
    writePackManifest(dir, 'zone-test', index);
    const file = path.join(dir, 'work', 'pack-index.json');
    savePackIndex(index, file);
    expect(loadPackIndex(file)).toEqual(index);
    fs.writeFileSync(file, 'cassé');
    expect(loadPackIndex(file)).toEqual({});
  });
});
