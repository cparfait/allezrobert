/**
 * Écritures et garde-fous qui protègent une construction de zone : une panne (disque plein, réseau, arrêt de
 * la machine) ne doit ni laisser un fichier tronqué pris pour valide, ni détruire la zone précédente.
 *
 * - `writeAtomic` : fichier temporaire dans le même dossier, puis renommage.
 * - `checkFreeSpace` : place libre sur le disque réel de chaque dossier (les jonctions sont suivies).
 * - transactions (`txMoveDir`, `txCopyDir`, `txFile`) : ce qu'une construction remplace est mis de côté dans
 *   `<monde>/.build-backup/` ; à la fin du processus, tout est gardé si la construction a réussi, tout est
 *   remis en place si elle a échoué. Après un arrêt brutal, la remise en place se fait au lancement suivant.
 * - témoin de fin `tiles/build.ok`, et verrou contre deux constructions simultanées.
 */
import fs from 'node:fs';
import path from 'node:path';

// ---- écriture atomique -----------------------------------------------------------------------------------

/** Écrit `file` d'un coup : un échec en cours d'écriture laisse le fichier précédent intact. */
export function writeAtomic(file: string, data: string | Uint8Array): void {
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

// ---- place libre -----------------------------------------------------------------------------------------

/** Dossier existant le plus proche de `p`, liens et jonctions résolus (un cache en jonction vit sur un autre disque). */
export function realExisting(p: string): string {
  let cur = path.resolve(p);
  for (;;) {
    if (fs.existsSync(cur)) return fs.realpathSync(cur);
    const up = path.dirname(cur);
    if (up === cur) return cur;
    cur = up;
  }
}

/** Place libre (Go) sur le disque qui porte réellement `p`. */
export function freeGbAt(p: string): number {
  const s = fs.statfsSync(realExisting(p));
  return (Number(s.bavail) * Number(s.bsize)) / 1024 ** 3;
}

export interface SpaceTarget {
  /** Nom lisible dans le message (« cache », « sortie »). */
  label: string;
  path: string;
}
export interface SpaceReading extends SpaceTarget {
  /** Chemin réel mesuré. */
  real: string;
  /** Disque (racine du chemin réel : `D:\`, `/`). */
  disk: string;
  freeGb: number;
}
export interface SpaceCheck {
  ok: boolean;
  readings: SpaceReading[];
  /** Mesures sous le seuil, un seul par disque. */
  lacking: SpaceReading[];
}

/** Mesure chaque dossier sur son disque réel et compare au seuil (`minGb` ≤ 0 : contrôle coupé). */
export function checkFreeSpace(targets: SpaceTarget[], minGb: number, measure: (realPath: string) => number = freeGbAt): SpaceCheck {
  const readings = targets.map((t) => {
    const real = realExisting(t.path);
    return { ...t, real, disk: path.parse(real).root || real, freeGb: measure(real) };
  });
  const lacking: SpaceReading[] = [];
  if (minGb > 0) for (const r of readings) if (r.freeGb < minGb && !lacking.some((l) => l.disk === r.disk)) lacking.push(r);
  return { ok: lacking.length === 0, readings, lacking };
}

/** « disque D:\ (cache) : 4 Go libres, il en faut 30 ». */
export function spaceMessage(check: SpaceCheck, minGb: number): string {
  return check.lacking.map((r) => `disque ${r.disk} (${r.label}, ${r.real}) : ${r.freeGb.toFixed(0)} Go libres, il en faut ${minGb}`).join(' ; ');
}

/** Résumé d'une ligne pour les journaux : « cache D:\ 291 Go · sortie C:\ 138 Go ». */
export function spaceSummary(check: SpaceCheck): string {
  return check.readings.map((r) => `${r.label} ${r.disk} ${r.freeGb.toFixed(0)} Go`).join(' · ');
}

// ---- transactions d'une construction ---------------------------------------------------------------------

/** Dossier des copies de secours, dans le dossier du monde (même disque : les renommages sont immédiats). */
export const BACKUP_NAME = '.build-backup';

interface Tx {
  /** Chemin remplacé par la construction. */
  target: string;
  /** Copie de secours ; absente si la cible n'existait pas. */
  backup: string;
  hadPrevious: boolean;
}
const pending: Tx[] = [];
let hooked = false;

function backupPath(worldDir: string, target: string): string {
  return path.join(worldDir, BACKUP_NAME, path.basename(target));
}

/** Remet en place ce qu'une construction interrompue brutalement avait mis de côté. Renvoie les noms restaurés. */
export function recoverInterrupted(worldDir: string): string[] {
  const dir = path.join(worldDir, BACKUP_NAME);
  if (!fs.existsSync(dir)) return [];
  const restored: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    const target = path.join(worldDir, name);
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(path.join(dir, name), target);
    restored.push(name);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return restored;
}

function begin(worldDir: string, target: string): Tx {
  if (!hooked) {
    hooked = true;
    // Fin du processus : code 0 = construction réussie, on garde le neuf ; sinon on remet l'ancien.
    process.on('exit', (code) => settleTransactions(code === 0));
    // Ctrl+C : sortie ordinaire en échec, pour que l'ancien contenu revienne tout de suite.
    process.once('SIGINT', () => process.exit(130));
  }
  const tx: Tx = { target, backup: backupPath(worldDir, target), hadPrevious: fs.existsSync(target) };
  if (pending.some((p) => p.target === target)) throw new Error(`déjà mis de côté : ${target}`);
  fs.mkdirSync(path.dirname(tx.backup), { recursive: true });
  fs.rmSync(tx.backup, { recursive: true, force: true });
  pending.push(tx);
  return tx;
}

/**
 * Met de côté le dossier `dir` (renommage, sans copie) et le recrée vide : la construction écrit dans un dossier
 * neuf, l'ancien revient si elle échoue. Pour les gros dossiers (tuiles).
 */
export function txMoveDir(worldDir: string, dir: string): void {
  const tx = begin(worldDir, dir);
  if (tx.hadPrevious) fs.renameSync(dir, tx.backup);
  fs.mkdirSync(dir, { recursive: true });
}

/** Copie de secours du dossier `dir`, qui reste en place et modifiable. Pour les petits dossiers (itinéraires). */
export function txCopyDir(worldDir: string, dir: string): void {
  const tx = begin(worldDir, dir);
  if (tx.hadPrevious) fs.cpSync(dir, tx.backup, { recursive: true });
}

/** Copie de secours du fichier `file` avant qu'il soit remplacé. */
export function txFile(worldDir: string, file: string): void {
  if (pending.some((p) => p.target === file)) return;
  const tx = begin(worldDir, file);
  if (tx.hadPrevious) fs.copyFileSync(file, tx.backup);
}

/** Construction en cours dans ce processus : quelque chose est mis de côté. */
export function hasPendingTransactions(): boolean {
  return pending.length > 0;
}

/**
 * Clôt les mises de côté : `ok` garde ce que la construction a écrit et supprime les copies ; sinon l'ancien
 * contenu revient. Ce qui n'existait pas avant est laissé tel quel (une première construction ratée garde ses
 * fichiers partiels, sans témoin de fin). Appelé à la fin du processus ; sans effet la seconde fois.
 */
export function settleTransactions(ok: boolean): void {
  const dirs = new Set<string>();
  for (const tx of pending.splice(0).reverse()) {
    dirs.add(path.dirname(tx.backup));
    try {
      if (ok || !tx.hadPrevious) {
        fs.rmSync(tx.backup, { recursive: true, force: true });
      } else {
        fs.rmSync(tx.target, { recursive: true, force: true });
        fs.renameSync(tx.backup, tx.target);
      }
    } catch (err) {
      // Dernier recours : la copie reste dans .build-backup, `recoverInterrupted` la reprendra au lancement suivant.
      console.error(`mise de côté non close (${tx.target}) : ${(err as Error).message}`);
    }
  }
  for (const d of dirs) {
    try {
      if (fs.existsSync(d) && !fs.readdirSync(d).length) fs.rmdirSync(d);
    } catch {
      // dossier encore utilisé : sans conséquence
    }
  }
}

// ---- témoin de fin ---------------------------------------------------------------------------------------

/** Dans `tiles/` (non versionné, comme les tuiles) ; exclu du pack de cartes (packs.ts). */
export const BUILD_OK = 'build.ok';

export interface BuildMarker {
  formatVersion: 1;
  world: string;
  /** Date de fin (ISO). */
  builtAt: string;
  tiles: number;
}

/** À écrire à la toute fin d'une construction réussie. */
export function writeBuildMarker(worldDir: string, world: string, tiles: number, now: Date = new Date()): void {
  const dir = path.join(worldDir, 'tiles');
  fs.mkdirSync(dir, { recursive: true });
  const marker: BuildMarker = { formatVersion: 1, world, builtAt: now.toISOString(), tiles };
  writeAtomic(path.join(dir, BUILD_OK), `${JSON.stringify(marker)}\n`);
}

export function readBuildMarker(worldDir: string): BuildMarker | null {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(worldDir, 'tiles', BUILD_OK), 'utf8')) as BuildMarker;
    return m.formatVersion === 1 ? m : null;
  } catch {
    return null;
  }
}

export interface BuiltState {
  built: boolean;
  /** Pourquoi : pour les journaux. */
  reason: string;
}

/**
 * Une zone est-elle construite ? Dans l'ordre :
 * 1. une mise de côté traîne (`.build-backup`) : construction interrompue, non ;
 * 2. pas de `world.json` lisible avec au moins une tuile : non ;
 * 3. témoin de fin présent : oui ;
 * 4. zone d'avant le témoin : oui si aucune de ses tuiles n'est sur cette machine (dossier absent ou sans
 *    tuile : elles sont gardées ailleurs, on ne peut pas juger, comme avant) ou si chaque tuile de `world.json`
 *    a son `.json` et son `.lo.u16` ; non si une partie seulement est là (construction restée en route).
 */
export function worldBuiltState(worldDir: string): BuiltState {
  if (fs.existsSync(path.join(worldDir, BACKUP_NAME))) return { built: false, reason: 'construction interrompue (.build-backup présent)' };
  let tiles: Array<{ id: string }>;
  try {
    tiles = (JSON.parse(fs.readFileSync(path.join(worldDir, 'world.json'), 'utf8')) as { tiles?: Array<{ id: string }> }).tiles ?? [];
  } catch {
    return { built: false, reason: 'pas de world.json lisible' };
  }
  if (!tiles.length) return { built: false, reason: 'world.json sans tuile' };
  if (readBuildMarker(worldDir)) return { built: true, reason: 'témoin de fin présent' };
  const tilesDir = path.join(worldDir, 'tiles');
  const present = new Set(fs.existsSync(tilesDir) ? fs.readdirSync(tilesDir) : []);
  const missing = tiles.filter((t) => !present.has(`${t.id}.json`) || !present.has(`${t.id}.lo.u16`)).length;
  if (missing === tiles.length) return { built: true, reason: 'world.json présent, tuiles hors de cette machine' };
  return missing ? { built: false, reason: `${missing} tuile(s) manquante(s) sur ${tiles.length}` } : { built: true, reason: `zone d'avant le témoin, ${tiles.length} tuiles complètes` };
}

// ---- verrou ----------------------------------------------------------------------------------------------

export interface LockInfo {
  pid: number;
  startedAt: string;
  what: string;
}
export interface LockOptions {
  what?: string;
  /** Au-delà, un verrou est tenu pour abandonné (défaut : 3 jours). */
  staleMs?: number;
  pid?: number;
  now?: () => number;
  /** Le processus qui tient le verrou vit-il encore ? */
  isAlive?: (pid: number) => boolean;
}
export type LockResult = { ok: true; release: () => void } | { ok: false; holder: LockInfo };

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM : le processus existe mais appartient à un autre compte
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Prend le verrou `file` (créé de façon exclusive). Un verrou dont le processus n'existe plus, ou plus vieux que
 * `staleMs`, est ignoré et remplacé. `release` ne supprime le fichier que s'il est encore le nôtre.
 */
export function acquireLock(file: string, o: LockOptions = {}): LockResult {
  const pid = o.pid ?? process.pid;
  const now = o.now ?? Date.now;
  const isAlive = o.isAlive ?? alive;
  const staleMs = o.staleMs ?? 3 * 24 * 3600_000;
  const mine: LockInfo = { pid, startedAt: new Date(now()).toISOString(), what: o.what ?? 'construction' };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, `${JSON.stringify(mine)}\n`, { flag: 'wx' });
      return {
        ok: true,
        release: () => {
          try {
            if ((JSON.parse(fs.readFileSync(file, 'utf8')) as LockInfo).pid === pid) fs.rmSync(file, { force: true });
          } catch {
            // déjà parti
          }
        },
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    let holder: LockInfo | null = null;
    try {
      holder = JSON.parse(fs.readFileSync(file, 'utf8')) as LockInfo;
    } catch {
      holder = null;
    }
    const age = holder ? now() - Date.parse(holder.startedAt) : Infinity;
    const stale = !holder || !Number.isFinite(age) || age > staleMs || holder.pid === pid || !isAlive(holder.pid);
    if (!stale) return { ok: false, holder: holder as LockInfo };
    fs.rmSync(file, { force: true });
  }
  throw new Error(`verrou impossible à prendre : ${file}`);
}
