// Aperçu local du site de présentation, avec le même plan d'adresses que le Caddyfile :
//   /  → deploy/site/index.html     /site/* → deploy/site/*
//   /telechargement/* → out/release/ (sortie de deploy/publish-desktop.sh)
//   /worlds/index.json → catalogue des zones du jeu
// Lancer depuis la racine du dépôt : node deploy/site-preview.mjs  (http://localhost:8090)
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const port = Number(process.env.PORT ?? 8090);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.exe': 'application/octet-stream', '.msi': 'application/octet-stream' };

/** Fichier sous `dir` (jamais au-dessus), ou null. */
async function file(dir, rel) {
  const p = normalize(join(dir, rel));
  if (!p.startsWith(dir)) return null;
  return readFile(p).catch(() => null);
}

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  let body = null;
  let type = types[extname(path)] ?? 'application/octet-stream';
  if (path === '/' || path === '/index.html') {
    body = await file(join(root, 'deploy/site'), 'index.html');
    type = types['.html'];
  } else if (path.startsWith('/site/')) body = await file(join(root, 'deploy/site'), path.slice(6));
  else if (path === '/telechargement/') {
    const names = await readdir(join(root, 'out/release')).catch(() => []);
    body = Buffer.from(`<ul>${names.map((n) => `<li><a href="${n}">${n}</a></li>`).join('')}</ul>`);
    type = types['.html'];
  } else if (path.startsWith('/telechargement/')) body = await file(join(root, 'out/release'), path.slice(16));
  else if (path === '/worlds/index.json') body = await file(join(root, 'apps/client/public/worlds'), 'index.json');
  if (!body) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end(`404 ${path}`);
    return;
  }
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' }).end(body);
}).listen(port, () => console.log(`Site de présentation : http://localhost:${port}`));
