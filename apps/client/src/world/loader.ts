import { createProceduralWorld } from './procedural.ts';
import type { WorldMeta } from '@allezrobert/shared';
import type { WorldSource } from './types.ts';

/**
 * Charge un monde généré par tools/terrain (public/worlds/<id>/world.json) ;
 * à défaut (tuiles non générées dans ce clone), bascule sur le monde procédural.
 */
export async function loadWorldSource(id: string): Promise<WorldSource> {
  if (id === 'dev') return createProceduralWorld();
  // zones voisines réunies : « principale+voisine+… » (voir composite.ts)
  if (id.includes('+')) {
    const ids = id.split('+').filter(Boolean);
    const sources = (await Promise.all(ids.map((z) => loadWorldSource(z)))).filter((s, i) => s.id === ids[i]);
    if (sources[0]?.id !== ids[0]) return loadWorldSource(ids[0] ?? 'chevreuse');
    if (sources.length === 1) return sources[0]!;
    const { createCompositeWorld } = await import('./composite.ts');
    return createCompositeWorld(sources);
  }
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
