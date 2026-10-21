/**
 * Outils de développement des séquences (CLI HyperFrames + variables d'exemple).
 *
 *   tsx scripts/hf.ts check [nom…]                 lint + audits navigateur (hyperframes check)
 *   tsx scripts/hf.ts render <séquence> [vars.json] [--out f.mp4] [--format mp4|webm|mov] [--quality q]
 *   tsx scripts/hf.ts snapshot <séquence> [vars.json] [--at 1,2.5] [--out dossier]
 *   tsx scripts/hf.ts preview <composition>        Studio HyperFrames (édition visuelle)
 *
 * <séquence> : intro | kom | sprint | podium | tv | summary ; [vars.json] : objet de variables
 * (tableaux acceptés, sérialisés comme le fait SequencePlayer).
 *
 * `snapshot` ne connaît pas --variables : on copie le projet dans out/variants/<…>/ en
 * remplaçant les valeurs par défaut déclarées, puis on capture.
 */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEQUENCES, serializeVariables, type CompositionFile, type SequenceName } from '../src/catalog.ts';
import { hyperframesBin } from './render-summary.ts';
import { compositionNames, syncAssets } from './sync-assets.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function hf(args: string[], cwd = ROOT): Promise<number> {
  return new Promise((ok, ko) => {
    const child = spawn(process.execPath, [hyperframesBin(), ...args], { cwd, stdio: 'inherit' });
    child.on('error', ko);
    child.on('exit', (code) => ok(code ?? 1));
  });
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function positional(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i]!.startsWith('--')) i++;
    else out.push(argv[i]!);
  }
  return out;
}

function loadVars(name: SequenceName, file?: string): Record<string, string | number | boolean> {
  const raw = file ? (JSON.parse(readFileSync(resolve(file), 'utf8')) as Record<string, unknown>) : {};
  return serializeVariables(name, raw);
}

/** Copie du projet avec les valeurs par défaut remplacées (pour snapshot / check). */
export function makeVariant(name: SequenceName, values: Record<string, string | number | boolean>, dir: string): string {
  const src = join(ROOT, 'compositions', SEQUENCES[name].file);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(join(src, 'assets'), join(dir, 'assets'), { recursive: true });
  let html = readFileSync(join(src, 'index.html'), 'utf8');
  html = html.replace(/data-composition-variables='([^']*)'/, (_m, json: string) => {
    const decls = JSON.parse(json) as Array<{ id: string; default: unknown }>;
    for (const d of decls) if (d.id in values) d.default = values[d.id];
    return `data-composition-variables='${JSON.stringify(decls).replace(/'/g, '&#39;')}'`;
  });
  writeFileSync(join(dir, 'index.html'), html);
  return dir;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  syncAssets(false);
  const pos = positional(rest);

  if (cmd === 'check') {
    const names = pos.length ? pos : compositionNames();
    let failed = 0;
    for (const n of names) {
      console.log(`\n=== check ${n}`);
      if ((await hf(['check', join(ROOT, 'compositions', n)])) !== 0) failed++;
    }
    process.exit(failed ? 1 : 0);
  }

  if (cmd === 'render') {
    const name = pos[0] as SequenceName;
    if (!SEQUENCES[name]) throw new Error(`Séquence inconnue : ${pos[0]}`);
    const format = flag(rest, '--format') ?? 'mp4';
    const out = resolve(flag(rest, '--out') ?? join(ROOT, 'out', `${name}${pos[1] ? '-' + basename(pos[1], '.json') : ''}.${format}`));
    mkdirSync(dirname(out), { recursive: true });
    const varsFile = `${out}.variables.json`;
    writeFileSync(varsFile, JSON.stringify(loadVars(name, pos[1]), null, 2));
    const code = await hf([
      'render',
      join(ROOT, 'compositions', SEQUENCES[name].file),
      '--variables-file',
      varsFile,
      '--strict-variables',
      '--output',
      out,
      '--format',
      format,
      '--quality',
      flag(rest, '--quality') ?? 'looks',
    ]);
    rmSync(varsFile, { force: true });
    process.exit(code);
  }

  if (cmd === 'snapshot') {
    const name = pos[0] as SequenceName;
    if (!SEQUENCES[name]) throw new Error(`Séquence inconnue : ${pos[0]}`);
    const tag = pos[1] ? basename(pos[1], '.json') : 'defaults';
    const dir = makeVariant(name, loadVars(name, pos[1]), join(ROOT, 'out', 'variants', `${name}-${tag}`));
    const out = resolve(flag(rest, '--out') ?? join(ROOT, 'out', 'snapshots', `${name}-${tag}`));
    const args = ['snapshot', dir, '--output', out];
    const at = flag(rest, '--at');
    if (at) args.push('--at', at, '--no-end');
    else args.push('--frames', flag(rest, '--frames') ?? '6');
    process.exit(await hf(args));
  }

  if (cmd === 'preview') {
    const file = (pos[0] ?? 'intro') as CompositionFile;
    const dir = join(ROOT, 'compositions', file);
    if (!existsSync(dir)) throw new Error(`Composition inconnue : ${file}`);
    process.exit(await hf(['preview', dir]));
  }

  console.error('Usage : hf.ts check|render|snapshot|preview …');
  process.exit(2);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
