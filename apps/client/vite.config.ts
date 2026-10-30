import { defineConfig, type Plugin } from 'vite';
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import { extractMedia, pruneDist } from './scripts/installerDiet.ts';

// AR_HMR=0 coupe le rechargement à chaud (utile quand d'autres processus modifient les paquets partagés).
const hmr = process.env.AR_HMR !== '0';

/**
 * Développement uniquement : POST /__shot?name=xxx (corps = data URL PNG/JPEG) enregistre une
 * capture du canvas dans docs/screenshots/, pour examiner le rendu à chaque jalon.
 * &dir=a/b : dossier sous out/ (non versionné), p. ex. les images du film d'accueil (menu-loop/<saison>).
 */
function screenshots(): Plugin {
  const dir = resolve(import.meta.dirname, '../../docs/screenshots');
  const outRoot = resolve(import.meta.dirname, '../../out');
  const checkDir = resolve(outRoot, 'worldcheck');
  /** Sous-dossier de out/ demandé par ?dir= (segments assainis, jamais hors de out/) ; null sinon. */
  const outSubdir = (url: URL): string | null => {
    const raw = url.searchParams.get('dir');
    if (!raw) return null;
    const parts = raw.split('/').map((p) => p.replace(/[^a-z0-9_-]/gi, '_')).filter(Boolean);
    return parts.length ? resolve(outRoot, ...parts) : null;
  };
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
          const outDir = outSubdir(url) ?? outRoot;
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
          const target = outSubdir(url) ?? (name.startsWith('worldcheck-') ? checkDir : dir);
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
      // dossiers seulement : worlds/index.json est un fichier (ENOTDIR sous Linux)
      for (const w of readdirSync(worlds, { withFileTypes: true })) if (w.isDirectory()) rmSync(resolve(worlds, w.name, 'tiles'), { recursive: true, force: true });
    },
  };
}

/**
 * Build : retire de dist/ ce qui ne se livre pas (photos de pose de dev) et, pour l'installateur Windows
 * (AR_DESKTOP=1, posé par deploy/publish-desktop.sh), les boucles vidéo VP9 en double, puis les ressources lourdes,
 * sorties vers dist-media/ (téléchargées à part par l'application). Voir scripts/installerDiet.ts.
 */
function installerDiet(): Plugin {
  return {
    name: 'ar-installer-diet',
    apply: 'build',
    closeBundle() {
      const desktop = process.env.AR_DESKTOP === '1';
      const dist = resolve(import.meta.dirname, 'dist');
      const removed = pruneDist(dist, desktop);
      if (removed.length) console.info(`[ar-installer-diet] retiré de dist/ : ${removed.map((p) => p.split(/[\\/]/).slice(-2).join('/')).join(', ')}`);
      if (desktop) {
        const m = extractMedia(dist, resolve(import.meta.dirname, 'dist-media'));
        console.info(`[ar-installer-diet] ressources hors de l'exe : ${m.files.length} fichiers, ${(m.bytes / 1e6).toFixed(0)} Mo → dist-media/ (version ${m.version})`);
      }
    },
  };
}

/**
 * Développement uniquement : GET /__lan donne l'adresse IPv4 du poste sur le réseau local, pour
 * le QR code de l'appli compagnon (le téléphone ne joint pas « localhost »).
 */
function lanAddress(): Plugin {
  return {
    name: 'ar-lan-address',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__lan', (_req, res) => {
        const all = Object.values(networkInterfaces())
          .flat()
          .filter((a) => !!a && a.family === 'IPv4' && !a.internal)
          .map((a) => a!.address);
        // Réseaux domestiques d'abord (192.168, 10, 172.16–31), pas les adaptateurs virtuels en 169.254.
        const score = (ip: string) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : ip.startsWith('169.254.') ? 9 : 5);
        const ip = all.sort((a, b) => score(a) - score(b))[0];
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ip: ip ?? null, all }));
      });
    },
  };
}

export default defineConfig({
  plugins: [screenshots(), excludeWorldTiles(), installerDiet(), lanAddress()],
  server: { port: 5173, strictPort: true, host: true, hmr },
  // Deux pages : le jeu et l'administration (admin.html, autonome).
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 2500, rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html'), admin: resolve(import.meta.dirname, 'admin.html') } } },
  clearScreen: false,
});
