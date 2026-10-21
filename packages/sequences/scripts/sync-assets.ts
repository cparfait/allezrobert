/**
 * Copie les ressources partagées dans chaque projet HyperFrames (compositions/<nom>/assets/).
 *
 * La CLI HyperFrames ne sert que les fichiers du dossier projet : chaque composition reçoit donc
 * sa copie de tokens.css, lib/ar-seq.{css,js}, gsap.min.js, des textes FR/EN et des polices.
 * Ces copies sont générées (gitignore) ; les sources restent uniques.
 *
 * Usage : pnpm --filter @allezrobert/sequences sync-assets
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STRINGS } from '../src/strings.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'package.json'));

export const FONT_FILES = {
  'inter-latin-wght-normal.woff2': '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
  'jetbrains-mono-latin-wght-normal.woff2':
    '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2',
} as const;

function resolvePkgFile(spec: string): string {
  return require.resolve(spec);
}

export function compositionNames(): string[] {
  const dir = join(ROOT, 'compositions');
  return readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory() && !n.startsWith('_'));
}

export function syncAssets(log = true): void {
  // 1. Polices dans packages/sequences/assets/fonts (référencées par tokens.css, versionnées).
  const sharedFonts = join(ROOT, 'assets', 'fonts');
  mkdirSync(sharedFonts, { recursive: true });
  for (const [name, spec] of Object.entries(FONT_FILES)) {
    copyFileSync(resolvePkgFile(spec), join(sharedFonts, name));
  }

  const gsapPath = resolvePkgFile('gsap/dist/gsap.min.js');
  const tokens = readFileSync(join(ROOT, 'tokens.css'), 'utf8').replaceAll('./assets/fonts/', './fonts/');
  const stringsJs =
    '/* Généré par scripts/sync-assets.ts depuis src/strings.ts — ne pas modifier. */\n' +
    `window.__AR_STRINGS = ${JSON.stringify(STRINGS)};\n`;

  // 2. Une copie par projet de composition.
  for (const name of compositionNames()) {
    const assets = join(ROOT, 'compositions', name, 'assets');
    mkdirSync(join(assets, 'fonts'), { recursive: true });
    writeFileSync(join(assets, 'tokens.css'), tokens);
    copyFileSync(join(ROOT, 'lib', 'ar-seq.css'), join(assets, 'ar-seq.css'));
    copyFileSync(join(ROOT, 'lib', 'ar-seq.js'), join(assets, 'ar-seq.js'));
    copyFileSync(gsapPath, join(assets, 'gsap.min.js'));
    writeFileSync(join(assets, 'strings.js'), stringsJs);
    for (const font of Object.keys(FONT_FILES)) {
      copyFileSync(join(sharedFonts, font), join(assets, 'fonts', font));
    }
    if (log) console.log(`assets → compositions/${name}/assets`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  syncAssets();
}
