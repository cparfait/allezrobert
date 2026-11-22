/** Options de `mesh-build.ts`, lues à part pour être testées sans lancer de construction. */
export interface MeshArgs {
  only: string[] | undefined;
  limit: number;
  /**
   * Purge du cache lourd entre deux zones. Jamais par défaut : il faut la demander par `--purge-cache`.
   * `--keep-cache`, l'ancienne option qui l'empêchait, reste acceptée et ne change plus rien.
   */
  purgeCache: boolean;
  minFreeGb: number;
}

export function parseMeshArgs(argv: readonly string[]): MeshArgs {
  const arg = (k: string): string | undefined => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const min = Number(arg('--min-free-gb') ?? 30);
  return {
    only: arg('--only')?.split(','),
    limit: Number(arg('--limit') ?? Infinity),
    purgeCache: argv.includes('--purge-cache'),
    minFreeGb: Number.isFinite(min) && min >= 0 ? min : 30,
  };
}
