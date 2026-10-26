/**
 * État de la construction du maillage d'Île-de-France (docs/MAILLAGE_ILE_DE_FRANCE.md).
 *
 *   pnpm --filter @allezrobert/terrain mesh:status        (ou : npx tsx src/mesh-status.ts)
 *
 * Lit le plan, `apps/client/public/worlds/<id>/world.json` (zone construite), `data/cache/mesh/build-report.json`
 * (durée, échec) et le journal de la zone en cours (tuiles faites sur le total).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const WORK = path.join(ROOT, 'data', 'cache', 'mesh');
const WORLDS = path.join(ROOT, 'apps', 'client', 'public', 'worlds');

const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'terrain', 'mesh', 'ile-de-france.json'), 'utf8')) as { zones: Array<{ id: string; tiles: number }> };
const report: Record<string, { code: number; minutes: number }> = fs.existsSync(path.join(WORK, 'build-report.json')) ? JSON.parse(fs.readFileSync(path.join(WORK, 'build-report.json'), 'utf8')) : {};

const built: string[] = [];
const failed: string[] = [];
const running: string[] = [];
const todo: string[] = [];
for (const z of plan.zones) {
  const r = report[z.id];
  if (fs.existsSync(path.join(WORLDS, z.id, 'world.json'))) built.push(z.id);
  else if (fs.existsSync(path.join(WORK, `build-${z.id}.log`)) && Date.now() - fs.statSync(path.join(WORK, `build-${z.id}.log`)).mtimeMs < 15 * 60_000) running.push(z.id);
  else if (r && r.code !== 0) failed.push(z.id);
  else todo.push(z.id);
}

const mins = Object.values(report).filter((r) => r.code === 0).map((r) => r.minutes);
const avg = mins.length ? mins.reduce((a, b) => a + b, 0) / mins.length : 0;
const left = running.length + todo.length + failed.length;
const s = fs.statfsSync(ROOT);
const total = plan.zones.length;
const bar = '█'.repeat(Math.round((built.length / total) * 30)).padEnd(30, '░');

console.log(`Île-de-France : ${built.length}/${total} zones construites  ${bar}`);
console.log(`  en cours ${running.length} · à faire ${todo.length} · en échec ${failed.length} · disque libre ${((s.bavail * s.bsize) / 1024 ** 3).toFixed(0)} Go`);
if (avg) console.log(`  durée moyenne ${Math.round(avg)} min par zone → reste ≈ ${Math.round((avg * left) / 60)} h`);
for (const id of running) {
  const log = fs.readFileSync(path.join(WORK, `build-${id}.log`), 'utf8');
  const tiles = new Set([...log.matchAll(/^\s+(-?\d+_-?\d+) : /gm)].map((m) => m[1]));
  const zone = plan.zones.find((z) => z.id === id)!;
  console.log(`  ▶ ${id} : ${tiles.size} tuiles enrichies sur ${zone.tiles} (journal build-${id}.log)`);
}
for (const id of failed) console.log(`  ✗ ${id} : échec (code ${report[id]!.code}), voir data/cache/mesh/build-${id}.log`);
if (todo.length) console.log(`  suivantes : ${todo.slice(0, 5).join(', ')}${todo.length > 5 ? '…' : ''}`);
