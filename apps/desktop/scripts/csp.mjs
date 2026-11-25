#!/usr/bin/env node
/**
 * Politique de sécurité du contenu (CSP) de l'application de bureau.
 *
 * Elle n'est PAS active par défaut (`tauri.conf.json` garde `"csp": null`) : une origine oubliée casse une
 * fonction en silence, et la politique ne se vérifie vraiment que dans l'application construite. Elle s'active
 * à la construction par `AR_CSP=1 deploy/publish-desktop.sh` (voir docs/BUILD_EXE.md), qui passe à Tauri une
 * configuration de surcharge écrite par ce script.
 *
 *   node apps/desktop/scripts/csp.mjs                 affiche la politique
 *   node apps/desktop/scripts/csp.mjs --write         réécrit src-tauri/tauri.csp.conf.json (domaine par défaut)
 *   node apps/desktop/scripts/csp.mjs --out <fichier> [--domain <hôte>]   surcharge pour un build
 *   node apps/desktop/scripts/csp.mjs --check         contrôle : fichier à jour, origines du code toutes déclarées
 *
 * Chaque source autorisée est déclarée ci-dessous avec ce qui l'utilise. Ajouter une origine au jeu sans
 * l'inscrire ici fait échouer `--check` (et le test apps/desktop/test/csp.test.ts).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '../../..');
export const CONF_FILE = resolve(HERE, '../src-tauri/tauri.csp.conf.json');
export const DEFAULT_DOMAIN = 'allezrobert.cparfait.ovh';

/**
 * Sources par directive. `{domain}` = domaine du serveur du jeu (DOMAIN de publish-desktop.sh).
 * `why` : ce qui en a besoin, avec le fichier qui le prouve.
 */
export const SOURCES = [
  // ── Application elle-même ──────────────────────────────────────────────────────────────────────────────
  { src: "'self'", in: ['default-src', 'script-src', 'style-src', 'img-src', 'media-src', 'font-src', 'connect-src', 'worker-src', 'frame-src', 'manifest-src', 'base-uri', 'form-action'], why: "fichiers de l'exe et ressources synchronisées, servis sur l'origine du jeu (apps/desktop/src-tauri/src/assets.rs)" },
  { src: 'ipc:', in: ['connect-src'], why: 'commandes Tauri, macOS (tauri 2 : src/ipc/protocol.rs)' },
  { src: 'http://ipc.localhost', in: ['connect-src'], why: 'commandes Tauri, Windows (tauri 2 : src/ipc/protocol.rs) ; Tauri ne les ajoute pas lui-même' },
  { src: 'http://worlds.localhost', in: ['connect-src', 'img-src', 'media-src'], why: 'zones installées, Windows (apps/client/src/world/packs.ts:23, protocole « worlds » de src-tauri/src/lib.rs)' },
  { src: 'worlds:', in: ['connect-src', 'img-src', 'media-src'], why: 'zones installées, macOS (apps/client/src/world/packs.ts:23)' },
  { src: 'http://arv3.localhost', in: ['connect-src', 'img-src', 'media-src'], why: 'ressources du style Bêta, Windows (apps/client/src/engine/v3Access.ts:4, protocole « arv3 »)' },
  { src: 'arv3:', in: ['connect-src', 'img-src', 'media-src'], why: 'ressources du style Bêta, macOS (apps/client/src/engine/v3Access.ts:4)' },
  // ── Ce que le code construit sur place ─────────────────────────────────────────────────────────────────
  { src: "'unsafe-inline'", in: ['script-src'], why: "scripts en ligne des séquences, assemblées dans un srcdoc qui hérite de cette politique (packages/sequences/src/assemble.ts:57) ; à retirer le jour où ces scripts sortent en fichiers" },
  { src: "'unsafe-inline'", in: ['style-src'], why: "@font-face en ligne de index.html (apps/client/index.html:17), attributs style du HUD et des menus, feuilles en ligne des séquences" },
  { src: "'wasm-unsafe-eval'", in: ['script-src'], why: 'WebAssembly : MediaPipe (apps/client/src/onboarding/likeness.ts:59), transcodeur KTX2/Basis (apps/client/src/engine/textures.ts:27), décodeur meshopt (apps/client/src/rider/gltfAvatar.ts)' },
  { src: 'blob:', in: ['script-src', 'worker-src', 'connect-src', 'img-src', 'media-src', 'frame-src'], why: 'worker du transcodeur KTX2 créé depuis un blob (three KTX2Loader), images et sons créés par URL.createObjectURL (apps/client/src/v3/thumbnails.ts:111, onboarding/voice.ts:32), textures intégrées aux GLB' },
  { src: 'data:', in: ['connect-src', 'img-src', 'media-src', 'font-src', 'frame-src'], why: 'images, polices et tampons intégrés en data: (GLB, séquences, QR code du compagnon)' },
  // ── Serveur du jeu ─────────────────────────────────────────────────────────────────────────────────────
  { src: 'https://{domain}', in: ['connect-src', 'img-src', 'media-src'], why: "API, salles (matchmaking Colyseus), tuiles, ressources et boucles vidéo non encore sur le disque (VITE_SERVER_URL et VITE_WORLDS_URL de deploy/publish-desktop.sh, apps/client/src/platform/desktop.ts:11)" },
  { src: 'wss://{domain}', in: ['connect-src'], why: 'salles Colyseus en WebSocket (apps/client/src/net/RideNetClient.ts:55)' },
  { src: 'https://*.{domain}', in: ['connect-src'], why: "LiveKit auto-hébergé : son URL vient du serveur à l'exécution, sous-domaine du jeu par défaut (deploy/.env.example : LIVEKIT_DOMAIN=livekit.<domaine> ; apps/client/src/game/voice.ts:81)" },
  { src: 'wss://*.{domain}', in: ['connect-src'], why: 'LiveKit, signalisation en WebSocket (deploy/docker-compose.yml:25)' },
  // ── Services tiers ─────────────────────────────────────────────────────────────────────────────────────
  { src: 'https://data.geopf.fr', in: ['connect-src', 'img-src'], why: 'Plan IGN de la mini-carte et des cartes (packages/shared/src/basemap.ts:5), recherche de ville (apps/client/src/ui/franceMap.ts:265)' },
  { src: 'https://api.open-meteo.com', in: ['connect-src'], why: 'météo réelle (apps/client/src/game/realWeather.ts:82)' },
  { src: 'https://api.spotify.com', in: ['connect-src'], why: 'commande de la lecture Spotify (apps/client/src/audio/spotify.ts:187)' },
  { src: 'https://accounts.spotify.com', in: ['connect-src'], why: 'jeton Spotify (apps/client/src/audio/spotify.ts:88)' },
  { src: 'https://sdk.scdn.co', in: ['script-src', 'frame-src'], why: 'lecteur Spotify dans le jeu : script et cadre du SDK (apps/client/src/audio/spotify.ts:171)' },
];

/** Directives sans source à lister. */
const FIXED = { 'object-src': ["'none'"], 'frame-ancestors': ["'none'"] };
const ORDER = ['default-src', 'script-src', 'style-src', 'img-src', 'media-src', 'font-src', 'connect-src', 'worker-src', 'frame-src', 'manifest-src', 'object-src', 'base-uri', 'form-action', 'frame-ancestors'];

/**
 * Origines citées dans le code mais que la page ne contacte pas : espaces de noms XML, liens ouverts dans le
 * navigateur du système (commande `open_external`), exemples dans des commentaires.
 */
export const NOT_CONTACTED = {
  'http://www.w3.org': 'espaces de noms SVG / XML',
  'http://www.topografix.com': 'espace de noms GPX',
  'http://www.garmin.com': 'espace de noms des extensions GPX / TCX',
  'https://open-meteo.com': "lien d'attribution, ouvert dans le navigateur",
  'https://developer.spotify.com': 'lien de documentation, ouvert dans le navigateur',
  'https://github.com': 'projet cité dans un commentaire (Piper)',
  'https://huggingface.co': 'adresse des voix Piper, redirigée vers /piper/voices/ (directorVoice.ts)',
  'https://www.specialized.com': 'source citée dans un commentaire ou une fiche',
  'https://www.matosvelo.fr': 'source citée dans un commentaire ou une fiche',
};

/** Origines supplémentaires données par l'environnement du build (serveur ou cartes sur un autre hôte). */
function envOrigins(env) {
  const out = [];
  for (const key of ['VITE_SERVER_URL', 'VITE_WORLDS_URL']) {
    const raw = env[key];
    if (!raw) continue;
    try {
      const u = new URL(raw);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
      out.push({ http: u.origin, ws: u.origin.replace(/^http/, 'ws') });
    } catch {
      // adresse illisible : ignorée, la politique garde le domaine
    }
  }
  return out;
}

/** Directives de la politique pour un domaine donné : { directive: [sources…] }. */
export function directives(domain = DEFAULT_DOMAIN, env = {}) {
  const map = new Map(ORDER.map((d) => [d, []]));
  const add = (dir, src) => {
    const list = map.get(dir);
    if (list && !list.includes(src)) list.push(src);
  };
  for (const s of SOURCES) for (const dir of s.in) add(dir, s.src.replaceAll('{domain}', domain));
  for (const o of envOrigins(env)) {
    for (const dir of ['connect-src', 'img-src', 'media-src']) add(dir, o.http);
    add('connect-src', o.ws);
  }
  for (const [dir, list] of Object.entries(FIXED)) map.set(dir, [...list]);
  return Object.fromEntries([...map].filter(([, l]) => l.length));
}

export function policy(domain = DEFAULT_DOMAIN, env = {}) {
  return Object.entries(directives(domain, env))
    .map(([dir, list]) => `${dir} ${list.join(' ')}`)
    .join('; ');
}

/**
 * Surcharge de configuration Tauri. `dangerousDisableAssetCspModification` : sans lui, Tauri ajoute un nonce à
 * `script-src` et `style-src` (tauri 2 : src/manager/mod.rs, `set_csp`) ; or dès qu'un nonce est présent, les
 * navigateurs ignorent 'unsafe-inline', et les scripts des séquences seraient refusés.
 */
export function tauriOverride(domain = DEFAULT_DOMAIN, env = {}) {
  return { app: { security: { csp: policy(domain, env), dangerousDisableAssetCspModification: ['script-src', 'style-src'] } } };
}

const serialize = (o) => `${JSON.stringify(o, null, 2)}\n`;

/** Une source de la politique couvre-t-elle cette origine (schéma://hôte) ? */
export function covers(sources, origin) {
  const u = new URL(origin);
  return sources.some((s) => {
    const m = /^(https?|wss?):\/\/(\*\.)?([^/:]+)$/.exec(s);
    if (!m) return false;
    if (`${m[1]}:` !== u.protocol) return false;
    return m[2] ? u.hostname.endsWith(`.${m[3]}`) : u.hostname === m[3];
  });
}

/** Origines externes écrites en dur dans le code du jeu et des paquets : [{ origin, file, line }]. */
export function scanOrigins(roots = ['apps/client/src', 'apps/client/index.html', 'packages']) {
  const found = [];
  const walk = (p) => {
    const st = statSync(p);
    if (st.isDirectory()) {
      const name = p.split(/[\\/]/).pop();
      if (name === 'node_modules' || name === 'dist' || name === 'test' || name === 'public') return;
      for (const e of readdirSync(p)) walk(join(p, e));
      return;
    }
    if (!/\.(ts|tsx|html|css|mjs)$/.test(p)) return;
    const lines = readFileSync(p, 'utf8').split(/\r?\n/);
    lines.forEach((text, i) => {
      for (const m of text.matchAll(/\b(https?|wss?):\/\/([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g)) {
        found.push({ origin: `${m[1]}://${m[2].toLowerCase()}`, file: relative(REPO, p).replaceAll('\\', '/'), line: i + 1 });
      }
    });
  };
  for (const r of roots) {
    const abs = resolve(REPO, r);
    if (existsSync(abs)) walk(abs);
  }
  return found;
}

/** Problèmes relevés : liste vide si tout va bien. */
export function check(domain = DEFAULT_DOMAIN) {
  const problems = [];
  const dirs = directives(domain);
  const expected = serialize(tauriOverride(domain));
  if (!existsSync(CONF_FILE)) problems.push(`fichier absent : ${relative(REPO, CONF_FILE)} (lancer csp.mjs --write)`);
  else if (readFileSync(CONF_FILE, 'utf8').replace(/\r\n/g, '\n') !== expected) problems.push(`${relative(REPO, CONF_FILE)} n'est plus à jour (lancer csp.mjs --write)`);
  // Toute source déclarée a une justification ; garde-fous de la politique.
  for (const s of SOURCES) if (!s.why || s.why.length < 12) problems.push(`source sans justification : ${s.src}`);
  if (dirs['default-src']?.join(' ') !== "'self'") problems.push("default-src doit rester 'self'");
  if (dirs['object-src']?.join(' ') !== "'none'") problems.push("object-src doit rester 'none'");
  if (dirs['frame-ancestors']?.join(' ') !== "'none'") problems.push("frame-ancestors doit rester 'none'");
  for (const [dir, list] of Object.entries(dirs)) {
    if (list.includes('*') || list.includes('https:') || list.includes('http:') || list.includes('wss:')) problems.push(`${dir} : schéma entier ou joker interdit`);
    if (list.includes("'unsafe-eval'")) problems.push(`${dir} : 'unsafe-eval' interdit`);
  }
  // Origines écrites dans le code : chacune doit être autorisée quelque part, ou rangée dans NOT_CONTACTED.
  const allowed = [...new Set(Object.values(dirs).flat())];
  const seen = new Set();
  for (const f of scanOrigins()) {
    if (seen.has(f.origin)) continue;
    seen.add(f.origin);
    const host = new URL(f.origin).hostname;
    if (host === 'localhost' || host.endsWith('.localhost') || host === 'example.com' || host.endsWith('.example.com')) continue;
    if (NOT_CONTACTED[f.origin]) continue;
    if (covers(allowed, f.origin)) continue;
    problems.push(`origine non déclarée : ${f.origin} (${f.file}:${f.line}) : l'ajouter à SOURCES si la page la contacte, sinon à NOT_CONTACTED`);
  }
  return problems;
}

function main(argv) {
  const arg = (k) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const domain = arg('domain') ?? DEFAULT_DOMAIN;
  if (argv.includes('--check')) {
    const problems = check();
    if (problems.length) {
      console.error(problems.map((p) => `✗ ${p}`).join('\n'));
      process.exit(1);
    }
    console.log('CSP du bureau : fichier à jour, toutes les origines du code sont déclarées.');
    return;
  }
  if (argv.includes('--write')) {
    writeFileSync(CONF_FILE, serialize(tauriOverride(DEFAULT_DOMAIN)));
    console.log(`écrit : ${relative(REPO, CONF_FILE)}`);
    return;
  }
  const out = arg('out');
  if (out) {
    const file = resolve(process.cwd(), out);
    mkdirSync(dirname(file), { recursive: true });
    // Serveur ou cartes sur un autre hôte que le domaine : leurs origines s'ajoutent (variables du build).
    writeFileSync(file, serialize(tauriOverride(domain, process.env)));
    console.log(`écrit : ${file}`);
    return;
  }
  console.log(policy(domain, process.env).replaceAll('; ', ';\n'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
