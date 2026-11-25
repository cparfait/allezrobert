import { createProceduralWorld } from './procedural.ts';
import type { WorldMeta } from '@allezrobert/shared';
import type { WorldSource } from './types.ts';
import { GRAPHIC_STYLE } from '../engine/style.ts';
import { worldIdsForStyle } from './worlds.ts';

/**
 * Charge un monde généré par tools/terrain (public/worlds/<id>/world.json) ;
 * à défaut (tuiles non générées dans ce clone), bascule sur le monde procédural.
 */
export async function loadWorldSource(requested: string): Promise<WorldSource> {
  const [id, ...neighbors] = worldIdsForStyle(requested, GRAPHIC_STYLE);
  // zones voisines réunies : « principale+voisine+… » (voir composite.ts)
  if (neighbors.length) {
    const [main, ...others] = await Promise.all([loadSingleWorld(id), ...neighbors.map(loadSingleWorld)]);
    const joined = others.filter((source, i) => source.id === neighbors[i]);
    if (main.id !== id || !joined.length) return main;
    const { createCompositeWorld } = await import('./composite.ts');
    return createCompositeWorld([main, ...joined]);
  }
  return loadSingleWorld(id);
}

async function loadSingleWorld(id: string): Promise<WorldSource> {
  if (id === 'dev') return createProceduralWorld();
  try {
    const res = await fetch(`/worlds/${id}/world.json`);
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) throw new Error(`HTTP ${res.status}`);
    const meta = (await res.json()) as WorldMeta;
    if (!meta.routes?.length) throw new Error('aucun itinéraire');
    const { createFileWorld } = await import('./fileWorld.ts');
    return await createFileWorld(id, meta);
  } catch (err) {
    console.info(`Monde « ${id} » indisponible (${String(err)}), monde procédural utilisé.`);
    return createProceduralWorld();
  }
}
