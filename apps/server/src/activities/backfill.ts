/**
 * Rattrapage des mesures d'entraînement (NP, IF, TSS, courbe, zones) des sorties enregistrées
 * avant la migration 006 : leur FIT est relu en tâche de fond, par petits paquets, avec la FTP
 * actuelle du profil (la FTP du jour n'était pas gardée).
 */
import type { AppContext } from '../context.ts';
import { decodeFit, trainingFromFit } from './fit-import.ts';

export async function backfillTraining(ctx: AppContext, batch = 20): Promise<number> {
  let done = 0;
  for (;;) {
    const pending = await ctx.training.pendingAggregates(batch);
    if (pending.length === 0) return done;
    for (const p of pending) {
      try {
        const fit = await ctx.repos.getActivityFit(p.userId, p.id);
        if (!fit) {
          await ctx.training.markAggregated(p.id);
          continue;
        }
        const imported = decodeFit(new Uint8Array(fit));
        await ctx.db.tx((q) => ctx.training.setTraining(q, p.userId, p.id, trainingFromFit(imported, p.ftpWatts), p.startedAt));
      } catch (e) {
        ctx.log('warn', `rattrapage des mesures de ${p.id} : ${(e as Error).message}`);
        await ctx.training.markAggregated(p.id);
      }
      done++;
    }
  }
}
