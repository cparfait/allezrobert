/** Point d'entrée : `pnpm --filter @allezrobert/server dev` (tsx watch) ou `start`. */
import { startServer } from './server.ts';

// Une promesse rejetée sans `catch` (tâche de fond, appel sortant) ne doit pas arrêter toutes les sorties
// en cours : on journalise et on continue. Node, par défaut, arrête le processus.
process.on('unhandledRejection', (reason) => {
  console.error(`[serveur] promesse rejetée non rattrapée : ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`);
});
// Une exception synchrone non rattrapée laisse le processus dans un état inconnu : on journalise la pile
// puis on sort avec un code d'erreur (Docker relance le service). Les erreurs des salles n'arrivent pas
// ici : elles sont prises par `onUncaughtException` de chaque salle.
process.on('uncaughtException', (err) => {
  console.error(`[serveur] exception non rattrapée, arrêt : ${err.stack ?? err.message}`);
  process.exit(1);
});

startServer().catch((e) => {
  console.error(`Démarrage impossible : ${(e as Error).message}`);
  process.exit(1);
});
