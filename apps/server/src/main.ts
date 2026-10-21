/** Point d'entrée : `pnpm --filter @allezrobert/server dev` (tsx watch) ou `start`. */
import { startServer } from './server.ts';

startServer().catch((e) => {
  console.error(`Démarrage impossible : ${(e as Error).message}`);
  process.exit(1);
});
