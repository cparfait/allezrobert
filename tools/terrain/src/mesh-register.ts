/**
 * Inscrit au menu et sur la carte de France les zones du maillage d'Île-de-France qui ont leurs tours
 * (`zones/idf-*.json`) : une ligne dans `WORLD_LIST` (worlds.ts) et dans `ZONE_SPOTS` (zoneMap.ts).
 * Idempotent : une zone déjà inscrite est laissée telle quelle. Les zones non construites s'affichent
 * « à venir » tant qu'elles ne sont pas dans le catalogue (`worlds/index.json`).
 *
 *   npx tsx src/mesh-register.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { frameFromRect, rectFromWorld, upsertSpotLine, upsertWorldLine, type ZoneDraft } from './zone-builder-lib.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ZONES = path.join(REPO_ROOT, 'tools', 'terrain', 'zones');
const WORLDS_TS = path.join(REPO_ROOT, 'apps', 'client', 'src', 'world', 'worlds.ts');
const SPOTS_TS = path.join(REPO_ROOT, 'apps', 'client', 'src', 'world', 'zoneMap.ts');

let worlds = fs.readFileSync(WORLDS_TS, 'utf8');
let spots = fs.readFileSync(SPOTS_TS, 'utf8');
let n = 0;
for (const f of fs.readdirSync(ZONES).filter((x) => /^idf-.*\.json$/.test(x)).sort()) {
  const z = JSON.parse(fs.readFileSync(path.join(ZONES, f), 'utf8')) as { id: string; name: string; region: string; originL93: { x: number; y: number }; corridorTiles: { txMin: number; txMax: number; tzMin: number; tzMax: number }; tours: Array<{ routeName: string }> };
  const km = z.tours.map((t) => /(\d+) km/.exec(t.routeName)?.[1]).filter(Boolean).join(', ');
  const dept = z.region.split(' · ')[0]!;
  const draft: ZoneDraft = {
    id: z.id,
    nameFr: z.name,
    nameEn: z.name,
    regionFr: z.region,
    regionEn: z.region,
    hintFr: `Boucles de ${km} km · ${dept}`,
    hintEn: `${km} km loops · ${dept}`,
    sea: false,
    orthoPx: 1024,
    rect: rectFromWorld(z.originL93, z.corridorTiles),
    tours: [],
  };
  const w = upsertWorldLine(worlds, draft);
  if (w) { worlds = w; n++; }
  const s = upsertSpotLine(spots, draft, frameFromRect(draft.rect));
  if (s) spots = s;
}
fs.writeFileSync(WORLDS_TS, worlds);
fs.writeFileSync(SPOTS_TS, spots);
console.log(`${n} zone(s) inscrite(s) au menu et sur la carte`);
