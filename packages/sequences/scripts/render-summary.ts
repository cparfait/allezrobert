/**
 * Rendu MP4 de la vidéo résumé d'une sortie (composition « summary », 1920×1080, 28 s).
 *
 * Usage :
 *   pnpm --filter @allezrobert/sequences render:summary <ride.json> <sortie.mp4>
 *        [--lang fr|en] [--quality draft|looks|delivery] [--fps 24|30|60] [--workers N] [--keep-vars]
 *   (ou : tsx packages/sequences/scripts/render-summary.ts <ride.json> <sortie.mp4> …)
 *
 * <ride.json> : soit un RideSummaryInput (voir src/summary-data.ts : titre, parcours, stats et/ou
 * records bruts, classement, segments), soit directement les variables de la composition
 * (objet contenant « ride_title »).
 *
 * Dépendances système (conteneur du renderer, voir docker/Dockerfile.renderer) :
 *   - Node ≥ 22, FFmpeg + FFprobe dans le PATH (ou HYPERFRAMES_FFMPEG_PATH / HYPERFRAMES_FFPROBE_PATH) ;
 *   - Chromium : chrome-headless-shell épinglé (PRODUCER_HEADLESS_SHELL_PATH) ou
 *     `npx hyperframes browser ensure` (téléchargement en cache), + bibliothèques Chromium.
 *
 * Code de sortie : 0 si le MP4 est produit, 1 sinon. Utilisable aussi en import :
 * `renderSummary(input, output, options)`.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializeVariables, SEQUENCES } from '../src/catalog.ts';
import type { Lang } from '../src/strings.ts';
import { summaryVariablesFromRide, type RideSummaryInput } from '../src/summary-data.ts';
import { syncAssets } from './sync-assets.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface RenderSummaryOptions {
  lang?: Lang;
  quality?: 'draft' | 'looks' | 'delivery';
  fps?: 24 | 30 | 60;
  workers?: number | 'auto';
  /** Conserve le fichier de variables à côté du MP4 (débogage). */
  keepVariables?: boolean;
  /** Sortie de la CLI (défaut : héritée). */
  stdio?: 'inherit' | 'pipe' | 'ignore';
}

export interface RenderSummaryResult {
  output: string;
  bytes: number;
  durationS: number | null;
}

/** Chemin du binaire de la CLI HyperFrames installée dans ce paquet (devDependency). */
export function hyperframesBin(): string {
  const require = createRequire(join(ROOT, 'package.json'));
  const pkgPath = require.resolve('hyperframes/package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { bin: Record<string, string> };
  return join(dirname(pkgPath), pkg.bin.hyperframes!);
}

function run(cmd: string, args: string[], stdio: RenderSummaryOptions['stdio'], cwd = ROOT): Promise<number> {
  return new Promise((ok, ko) => {
    const child = spawn(cmd, args, { cwd, stdio: stdio ?? 'inherit', env: process.env });
    child.on('error', ko);
    child.on('exit', (code) => ok(code ?? 1));
  });
}

function probeDuration(file: string): Promise<number | null> {
  const bin = process.env.HYPERFRAMES_FFPROBE_PATH || 'ffprobe';
  return new Promise((ok) => {
    const child = spawn(bin, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.on('error', () => ok(null));
    child.on('exit', () => {
      const n = Number.parseFloat(out.trim());
      ok(Number.isFinite(n) ? n : null);
    });
  });
}

export async function renderSummary(
  input: RideSummaryInput | Record<string, unknown>,
  output: string,
  options: RenderSummaryOptions = {}
): Promise<RenderSummaryResult> {
  const out = resolve(output);
  mkdirSync(dirname(out), { recursive: true });

  const isVariables = typeof (input as Record<string, unknown>).ride_title === 'string';
  const vars = isVariables
    ? (input as Record<string, unknown>)
    : summaryVariablesFromRide({ ...(input as RideSummaryInput), lang: options.lang ?? (input as RideSummaryInput).lang });
  const serialized = serializeVariables('summary', vars, options.lang);
  const varsFile = `${out}.variables.json`;
  writeFileSync(varsFile, JSON.stringify(serialized, null, 2));

  syncAssets(false);
  const project = join(ROOT, 'compositions', SEQUENCES.summary.file);
  const args = [
    hyperframesBin(),
    'render',
    project,
    '--variables-file',
    varsFile,
    '--strict-variables',
    '--output',
    out,
    '--quality',
    options.quality ?? 'looks',
    '--fps',
    String(options.fps ?? 30),
  ];
  if (options.workers !== undefined) args.push('--workers', String(options.workers));

  try {
    const code = await run(process.execPath, args, options.stdio);
    if (code !== 0) throw new Error(`hyperframes render a échoué (code ${code})`);
  } finally {
    if (!options.keepVariables) rmSync(varsFile, { force: true });
  }
  if (!existsSync(out) || statSync(out).size === 0) throw new Error(`MP4 absent ou vide : ${out}`);
  return { output: out, bytes: statSync(out).size, durationS: await probeDuration(out) };
}

function parseArgs(argv: string[]) {
  const pos: string[] = [];
  const opts: RenderSummaryOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => argv[++i] ?? '';
    if (a === '--lang') opts.lang = next() === 'en' ? 'en' : 'fr';
    else if (a === '--quality') opts.quality = next() as RenderSummaryOptions['quality'];
    else if (a === '--fps') opts.fps = Number(next()) as RenderSummaryOptions['fps'];
    else if (a === '--workers') {
      const w = next();
      opts.workers = w === 'auto' ? 'auto' : Number(w);
    } else if (a === '--keep-vars') opts.keepVariables = true;
    else pos.push(a);
  }
  return { pos, opts };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { pos, opts } = parseArgs(process.argv.slice(2));
  if (pos.length < 2) {
    console.error('Usage : render-summary <ride.json> <sortie.mp4> [--lang fr|en] [--quality draft|looks|delivery] [--fps 30]');
    process.exit(2);
  }
  const input = JSON.parse(readFileSync(resolve(pos[0]!), 'utf8')) as RideSummaryInput;
  const t0 = Date.now();
  renderSummary(input, pos[1]!, opts).then(
    (r) => {
      const mb = (r.bytes / 1024 / 1024).toFixed(2);
      console.log(`OK ${r.output} — ${mb} Mo, ${r.durationS?.toFixed(2) ?? '?'} s, rendu en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    },
    (err: unknown) => {
      console.error(String(err));
      process.exit(1);
    }
  );
}
