/**
 * Contrôles faits au tout début d'une construction de zone (build-world, build-open, build-climb, build-tiles) :
 * 1. ce qu'une construction interrompue brutalement avait mis de côté est remis en place (safe-fs.ts) ;
 * 2. la place libre est mesurée sur le disque réel du cache ET sur celui du dossier de sortie (le cache est
 *    souvent une jonction vers un autre disque, et `TERRAIN_OUT_DIR` aussi) : sous le seuil, on ne démarre pas.
 *
 * Seuil : `--min-free-gb N` ou `TERRAIN_MIN_FREE_GB=N` (défaut 10 Go ; 0 coupe le contrôle).
 */
import { CACHE_DIR, OUT_DIR } from './config.ts';
import { checkFreeSpace, recoverInterrupted, spaceMessage, spaceSummary } from './safe-fs.ts';

export const DEFAULT_MIN_FREE_GB = 10;
/** Code de sortie quand la place manque (distinct d'un échec de construction). */
export const EXIT_NO_SPACE = 3;

/** Seuil demandé : l'option l'emporte sur la variable d'environnement, puis la valeur par défaut. */
export function minFreeGbFrom(argv: readonly string[], env: Record<string, string | undefined>, fallback = DEFAULT_MIN_FREE_GB): number {
  const i = argv.indexOf('--min-free-gb');
  const raw = i >= 0 ? argv[i + 1] : env.TERRAIN_MIN_FREE_GB;
  const v = raw === undefined || raw === '' ? NaN : Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

let done = false;

export function preflight(log: (s: string) => void = console.log): void {
  if (done) return;
  done = true;
  const restored = recoverInterrupted(OUT_DIR);
  if (restored.length) log(`Construction précédente interrompue : ${restored.join(', ')} remis en place.`);
  const minGb = minFreeGbFrom(process.argv.slice(2), process.env);
  const check = checkFreeSpace(
    [
      { label: 'cache', path: CACHE_DIR },
      { label: 'sortie', path: OUT_DIR },
    ],
    minGb,
  );
  if (!check.ok) {
    console.error(`Arrêt avant de commencer : place insuffisante. ${spaceMessage(check, minGb)}.`);
    console.error('Libérer de la place, ou changer le seuil : --min-free-gb N (ou TERRAIN_MIN_FREE_GB=N ; 0 coupe le contrôle).');
    process.exit(EXIT_NO_SPACE);
  }
  log(`Place libre : ${spaceSummary(check)} (seuil ${minGb} Go)`);
}
