/**
 * Accès PostgreSQL (pg). `DATABASE_URL=memory` utilise pg-mem (développement et tests,
 * dépendance de développement chargée dynamiquement) : même API `pg.Pool`.
 */
import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export interface Queryable {
  query<R extends pg.QueryResultRow = any>(text: string, params?: unknown[]): Promise<pg.QueryResult<R>>;
}

export interface Db extends Queryable {
  /** Exécute `fn` dans une transaction (BEGIN / COMMIT, ROLLBACK sur erreur). */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly kind: 'postgres' | 'memory';
}

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

function wrapPool(pool: pg.Pool, kind: Db['kind']): Db {
  return {
    kind,
    query: (text, params) => pool.query(text, params as any[]),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const res = await fn({ query: (text, params) => client.query(text, params as any[]) });
        await client.query('COMMIT');
        return res;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

export async function createDb(databaseUrl: string, ssl = false): Promise<Db> {
  if (databaseUrl === 'memory') {
    const { newDb } = await import('pg-mem');
    const mem = newDb({ autoCreateForeignKeyIndices: true });
    const adapter = mem.adapters.createPg();
    const pool = new adapter.Pool() as pg.Pool;
    return wrapPool(pool, 'memory');
  }
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
  });
  pool.on('error', (err) => console.error('[db] erreur de connexion inactive', err.message));
  return wrapPool(pool, 'postgres');
}

/**
 * Applique les fichiers `migrations/NNN_*.sql` non encore passés, dans l'ordre, chacun dans
 * une transaction. Idempotent : lancé à chaque démarrage du serveur.
 */
export async function migrate(db: Db, dir = MIGRATIONS_DIR, log: (msg: string) => void = () => undefined): Promise<string[]> {
  let rows: Array<{ name: string }>;
  try {
    rows = (await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows;
  } catch {
    await db.query('CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    rows = [];
  }
  const done = new Set(rows.map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(path.join(dir, file), 'utf8');
    await db.tx(async (q) => {
      for (const stmt of splitSql(sql)) await q.query(stmt);
      await q.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    log(`migration appliquée : ${file}`);
    applied.push(file);
  }
  return applied;
}

/** Découpe un script SQL simple (sans fonctions plpgsql) en instructions. */
export function splitSql(sql: string): string[] {
  return sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}
