/** `pnpm --filter @allezrobert/server migrate` : applique les migrations puis quitte. */
import { loadConfig } from '../config.ts';
import { createDb, migrate } from './db.ts';

const config = loadConfig();
const db = await createDb(config.DATABASE_URL, config.DATABASE_SSL);
try {
  const applied = await migrate(db, undefined, (m) => console.log(m));
  console.log(applied.length ? `${applied.length} migration(s) appliquée(s)` : 'Base à jour');
} finally {
  await db.close();
}
