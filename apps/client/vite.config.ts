import { defineConfig, type Plugin } from 'vite';
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// AR_HMR=0 coupe le rechargement à chaud (utile quand d'autres processus modifient les paquets partagés).
const hmr = process.env.AR_HMR !== '0';

/**
 * Développement uniquement : POST /__shot?name=xxx (corps = data URL PNG/JPEG) enregistre une
 * capture du canvas dans docs/screenshots/, pour examiner le rendu à chaque jalon.
 */
function screenshots(): Plugin {
  const dir = resolve(import.meta.dirname, '../../docs/screenshots');
  const checkDir = resolve(import.meta.dirname, '../../out/worldcheck');
  return {
    name: 'ar-screenshots',
    apply: 'serve',
    configureServer(server) {
      // POST /__save?name=fichier.ext (corps brut) : enregistre un fichier binaire dans out/ (exports de test).
      server.middlewares.use('/__save', (req, res) => {
        const url = new URL(req.url ?? '', 'http://x');
        const name = (url.searchParams.get('name') ?? 'file.bin').replace(/[^a-z0-9_.-]/gi, '_');
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const outDir = resolve(import.meta.dirname, '../../out');
          mkdirSync(outDir, { recursive: true });
          const file = resolve(outDir, name);
          writeFileSync(file, Buffer.concat(chunks));
          res.end(file);
        });
      });
      server.middlewares.use('/__shot', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const url = new URL(req.url ?? '', 'http://x');
        const name = (url.searchParams.get('name') ?? 'shot').replace(/[^a-z0-9_-]/gi, '_');
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString();
          const m = /^data:image\/(png|jpeg);base64,(.*)$/s.exec(body);
          if (!m) {
            res.statusCode = 400;
            res.end('data URL attendue');
            return;
          }
          // Les captures du contrôle visuel vont dans out/ (non versionné).
          const target = name.startsWith('worldcheck-') ? checkDir : dir;
          mkdirSync(target, { recursive: true });
          const file = resolve(target, `${name}.${m[1] === 'jpeg' ? 'jpg' : 'png'}`);
          writeFileSync(file, Buffer.from(m[2] as string, 'base64'));
          res.end(file);
        });
      });
    },
  };
}

/**
 * Build : les tuiles du monde (≈ 150 Mo) ne sont pas embarquées dans le bundle web — Caddy les
 * sert depuis un volume (docs/DEPLOY.md). AR_BUNDLE_TILES=1 les garde (app Windows hors ligne).
 */
function excludeWorldTiles(): Plugin {
  return {
    name: 'ar-exclude-world-tiles',
    apply: 'build',
    closeBundle() {
      if (process.env.AR_BUNDLE_TILES === '1') return;
      const worlds = resolve(import.meta.dirname, 'dist/worlds');
      if (!existsSync(worlds)) return;
      for (const w of readdirSync(worlds)) rmSync(resolve(worlds, w, 'tiles'), { recursive: true, force: true });
    },
  };
}

export default defineConfig({
  plugins: [screenshots(), excludeWorldTiles()],
  server: { port: 5173, strictPort: true, host: true, hmr },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 2500 },
  clearScreen: false,
});
