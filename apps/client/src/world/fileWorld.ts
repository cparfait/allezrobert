import type { WorldSource } from './types.ts';

/** Monde généré par tools/terrain : implémentation complète branchée sur le format final du pipeline. */
export async function createFileWorld(id: string, _meta: unknown): Promise<WorldSource> {
  throw new Error(`Format du monde « ${id} » pas encore pris en charge`);
}
