// Noyau du déploiement (sans interface) : réglages de connexion, état local (git, zones), état du serveur par SSH,
// mise à jour de l'application (git pull + deploy.sh), envoi des zones et des vidéos du menu. Utilisé par :
//   - l'outil graphique autonome   deploy/deploy-gui.mjs                       (pnpm deploy:gui)
//   - le constructeur de zone      tools/terrain/src/zone-builder.ts            (panneau « Serveur »)
//   - la ligne de commande         node deploy/deploy-core.mjs run <demande.json>
// Sécurité : commandes lancées sans shell (arguments séparés), noms de zones et de branches validés, SSH en
// mode non interactif (clé requise). Essai à blanc : DEPLOY_GUI_DRY=1 affiche les commandes sans les exécuter.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const worlds = join(root, 'apps/client/public/worlds');
const menuDir = join(root, 'apps/client/public/menu');
export const configFile = join(import.meta.dirname, '.deploy-gui.json');
export const DRY = process.env.DEPLOY_GUI_DRY === '1';

const DEFAULTS = {
  host: 'debian@allezrobert.cparfait.ovh',
  port: 22222,
  key: join(homedir(), '.ssh', 'id_ed25519_openssh'),
  repo: '/home/debian/docker/allezrobert',
  url: 'https://allezrobert.cparfait.ovh',
};

export function loadConfig() {
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(configFile, 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

const SAFE = {
  host: /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/,
  repo: /^\/[A-Za-z0-9._/-]+$/,
  zone: /^[a-z0-9-]+$/,
  branch: /^[A-Za-z0-9._/-]+$/,
  url: /^https:\/\/[A-Za-z0-9.-]+$/,
};

export function validConfig(c) {
  return SAFE.host.test(c.host) && Number.isInteger(c.port) && c.port > 0 && c.port < 65536 && SAFE.repo.test(c.repo) && SAFE.url.test(c.url) && typeof c.key === 'string' && /^[A-Za-z0-9_ :\\/.()-]+$/.test(c.key);
}

/* ───────────── État local ───────────── */

function run(cmd, args, opts = {}) {
  return new Promise((res) => {
    const p = spawn(cmd, args, { cwd: root, windowsHide: true, ...opts });
    let out = '';
    p.stdout?.on('data', (d) => (out += d));
    p.stderr?.on('data', (d) => (out += d));
    p.on('error', (e) => res({ code: -1, out: String(e.message) }));
    p.on('close', (code) => res({ code, out: out.trim() }));
  });
}

function dirSize(dir) {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    n += e.isDirectory() ? dirSize(p) : statSync(p).size;
  }
  return n;
}

export function localZones() {
  if (!existsSync(worlds)) return [];
  const out = [];
  for (const id of readdirSync(worlds)) {
    const pack = join(worlds, id, 'tiles', 'pack.json');
    if (!SAFE.zone.test(id) || !existsSync(pack)) continue;
    let version = '';
    try {
      version = JSON.parse(readFileSync(pack, 'utf8')).version ?? '';
    } catch {
      /* pack illisible : version inconnue */
    }
    out.push({ id, version, bytes: dirSize(join(worlds, id, 'tiles')) });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export async function localGit() {
  const branch = (await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'])).out;
  const last = (await run('git', ['log', '-1', '--format=%h %s'])).out;
  const dirty = (await run('git', ['status', '--short', '--', '.', ':!apps/client/public/worlds'])).out.split('\n').filter(Boolean).length;
  const worldsDirty = (await run('git', ['status', '--short', '--', 'apps/client/public/worlds'])).out.split('\n').filter(Boolean).length;
  const ahead = (await run('git', ['rev-list', '--count', '@{u}..HEAD'])).out;
  return { branch, last, dirty, worldsDirty, ahead: /^\d+$/.test(ahead) ? Number(ahead) : null };
}

/* ───────────── SSH ───────────── */

function sshArgs(c, { tty = false } = {}) {
  return ['-i', c.key, '-p', String(c.port), '-o', 'BatchMode=yes', '-o', 'ServerAliveInterval=30', '-o', 'StrictHostKeyChecking=accept-new', ...(tty ? ['-tt'] : []), c.host];
}

const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

export async function remoteState(c) {
  if (DRY) return { ok: true, branch: '(essai à blanc)', head: '', zones: {}, menu: 0 };
  const script = [
    `cd ${q(c.repo)} 2>/dev/null || { echo NOREPO; exit 0; }`,
    'echo "branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"',
    'echo "head=$(git log -1 --format="%h %s" 2>/dev/null)"',
    'for p in deploy/data/worlds/*/tiles/pack.json; do [ -f "$p" ] || continue; id=$(basename $(dirname $(dirname "$p"))); v=$(grep -o "\\"version\\": *\\"[^\\"]*\\"" "$p" | head -1 | sed "s/.*: *\\"//; s/\\"$//"); echo "zone $id $v"; done',
    'echo "menu=$(ls deploy/data/menu/loop-* 2>/dev/null | wc -l)"',
  ].join('; ');
  const r = await run('ssh', [...sshArgs(c), script]);
  if (r.code !== 0) {
    const hint = /Permission denied|publickey|password/i.test(r.out) ? '\nLa clé SSH n’est pas acceptée par le serveur : utilise « Installer ma clé SSH sur le serveur » (le mot de passe du serveur est demandé une seule fois, dans une fenêtre noire).' : '';
    return { ok: false, error: (r.out || `ssh a échoué (code ${r.code})`) + hint };
  }
  if (r.out.includes('NOREPO')) return { ok: false, error: `Le dossier ${c.repo} n'existe pas sur le serveur.` };
  const zones = {};
  let branch = '';
  let head = '';
  let menu = 0;
  for (const line of r.out.split('\n')) {
    const m = /^zone (\S+) ?(.*)$/.exec(line.trim());
    if (m) zones[m[1]] = m[2];
    else if (line.startsWith('branch=')) branch = line.slice(7).trim();
    else if (line.startsWith('head=')) head = line.slice(5).trim();
    else if (line.startsWith('menu=')) menu = Number(line.slice(5)) || 0;
  }
  return { ok: true, branch, head, zones, menu };
}

/* ───────────── Tâches (journal en direct) ───────────── */

/** Lance une commande, relaie sa sortie ligne à ligne ; renvoie le code de sortie. */
function step(emit, label, cmd, args, { stdin } = {}) {
  emit(`\n▶ ${label}`);
  if (DRY) {
    emit(`  [essai à blanc] ${cmd} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
    return Promise.resolve(0);
  }
  return new Promise((res) => {
    const p = spawn(cmd, args, { cwd: root, windowsHide: true, stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    // Le serveur répond avec un terminal (ssh -tt) : docker compose colore et redessine sa progression ; on retire ces codes.
    // eslint-disable-next-line no-control-regex
    const ansi = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[()][A-Z0-9]|\x1b[=>]/g;
    const feed = (d) => String(d).replace(ansi, '').split(/\r?\n|\r/).forEach((l) => l.trim() && emit(`  ${l}`));
    p.stdout.on('data', feed);
    p.stderr.on('data', feed);
    p.on('error', (e) => {
      emit(`  ✗ ${e.message}`);
      res(-1);
    });
    p.on('close', (code) => res(code ?? -1));
    if (stdin) stdin(p);
  });
}

/** tar local (compressé) → ssh → tar distant : une zone entière dans un dossier temporaire, puis échange. */
async function sendZone(emit, c, id) {
  const src = join(worlds, id, 'tiles');
  const dir = `${c.repo}/deploy/data/worlds/${id}`;
  const ssh = (cmd) => ['ssh', [...sshArgs(c), cmd]];
  emit(`\n══ Zone « ${id} »`);
  if (!existsSync(join(src, 'pack.json'))) return emit(`  ✗ ${src}/pack.json introuvable`), false;
  if ((await step(emit, 'Préparation sur le serveur', ...ssh(`rm -rf ${q(`${dir}/tiles.new`)} && mkdir -p ${q(`${dir}/tiles.new`)}`))) !== 0) return false;
  emit('▶ Envoi des tuiles (compressées)…');
  let sent = 0;
  let code;
  if (DRY) {
    emit(`  [essai à blanc] tar -czf - -C ${src} . | ssh … "tar -xzf - -C ${dir}/tiles.new"`);
    code = 0;
  } else {
    code = await new Promise((res) => {
      const tar = spawn('tar', ['-czf', '-', '-C', src, '.'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const sh = spawn('ssh', [...sshArgs(c), `tar -xzf - -C ${q(`${dir}/tiles.new`)}`], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let last = Date.now();
      tar.stdout.on('data', (d) => {
        sent += d.length;
        if (Date.now() - last > 3000) {
          last = Date.now();
          emit(`  … ${(sent / 1e6).toFixed(0)} Mo envoyés`);
        }
      });
      tar.stdout.pipe(sh.stdin);
      tar.stderr.on('data', (d) => emit(`  tar : ${String(d).trim()}`));
      sh.stderr.on('data', (d) => emit(`  ssh : ${String(d).trim()}`));
      tar.on('error', (e) => (emit(`  ✗ tar : ${e.message}`), res(-1)));
      sh.on('error', (e) => (emit(`  ✗ ssh : ${e.message}`), res(-1)));
      sh.on('close', (cd) => res(cd ?? -1));
    });
  }
  if (code !== 0) return emit(`  ✗ envoi interrompu (code ${code}) : la version précédente du serveur n'a pas été touchée`), false;
  emit(`  ✓ ${(sent / 1e6).toFixed(0)} Mo envoyés`);
  if ((await step(emit, 'Mise en place (échange atomique)', ...ssh(`cd ${q(dir)} && rm -rf tiles.old && if [ -d tiles ]; then mv tiles tiles.old; fi && mv tiles.new tiles && rm -rf tiles.old`))) !== 0) return false;
  if (!DRY) {
    const ok = await fetch(`${c.url}/worlds/${id}/tiles/pack.json`, { method: 'HEAD' }).then((r) => r.ok).catch(() => false);
    emit(ok ? `  ✓ ${c.url}/worlds/${id}/tiles/pack.json répond` : `  ⚠ ${c.url}/worlds/${id}/tiles/pack.json ne répond pas encore (cache ou proxy ?)`);
  }
  return true;
}

export async function job(action, body, emit) {
  const c = loadConfig();
  if (!validConfig(c)) return emit('✗ Réglages de connexion invalides.'), 1;
  const ssh = (cmd, opts) => ['ssh', [...sshArgs(c, opts), cmd]];
  let fail = 0;

  if (action === 'install-key') {
    // Une fenêtre de commande s'ouvre : SSH y demande lui-même le mot de passe du serveur (jamais saisi ici ni journalisé).
    const bat = join(tmpdir(), 'allezrobert-install-cle-ssh.cmd');
    const remote = 'mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys';
    const lines = [
      '@echo off',
      `echo Installation de ta cle SSH sur ${c.host} (port ${c.port}).`,
      'echo Le mot de passe du serveur va etre demande, une seule fois.',
      'echo.',
      `ssh-keygen -y -f "${c.key}" | ssh -p ${c.port} -o StrictHostKeyChecking=accept-new ${c.host} "${remote}"`,
      'if errorlevel 1 (echo. & echo ECHEC : verifie le mot de passe, le port et la cle.) else (echo. & echo Cle installee : l outil se connecte maintenant sans mot de passe.)',
      'echo.',
      'pause',
    ];
    emit('\n▶ Installation de la clé SSH sur le serveur');
    if (DRY) return emit(`  [essai à blanc] fenêtre de commande avec :\n${lines.join('\n')}`), 0;
    if (process.platform !== 'win32') {
      emit(`  Dans un terminal : ssh-keygen -y -f ${c.key} | ssh -p ${c.port} ${c.host} "${remote}"`);
      return 0;
    }
    writeFileSync(bat, lines.join('\r\n') + '\r\n');
    spawn('cmd.exe', ['/c', 'start', '""', 'cmd.exe', '/k', `"${bat}"`], { detached: true, stdio: 'ignore', windowsHide: false, windowsVerbatimArguments: true }).unref();
    emit('  Une fenêtre noire vient de s’ouvrir : tape le mot de passe du serveur dedans (rien ne s’affiche pendant la saisie), puis Entrée.');
    emit('  Quand elle indique « Cle installee », reviens ici : « Actualiser » doit montrer le serveur.');
    return 0;
  }

  if (action === 'update-app') {
    const branch = String(body.branch || '').trim();
    if (branch && !SAFE.branch.test(branch)) return emit('✗ Nom de branche invalide.'), 1;
    const mode = body.mode === 'build' ? 'build' : 'pull';
    if (body.push && (await step(emit, 'Envoi des commits locaux vers GitHub (git push)', 'git', ['push'])) !== 0) return 1;
    const checkout = branch ? `git fetch origin && git checkout ${q(branch)} && ` : '';
    const cmd = `cd ${q(c.repo)} && ${checkout}git pull --ff-only && cd deploy && ./deploy.sh ${mode}`;
    fail = await step(emit, `Serveur : git pull puis déploiement Docker (${mode === 'build' ? 'images construites sur le serveur' : 'images publiées par la CI'})`, ...ssh(cmd, { tty: true }));
    emit(fail === 0 ? '\n✓ Application mise à jour.' : '\n✗ La mise à jour a échoué : lis le journal ci-dessus.');
    return fail === 0 ? 0 : 1;
  }

  if (action === 'send-zones') {
    const ids = Array.isArray(body.ids) ? body.ids.filter((i) => SAFE.zone.test(i)) : [];
    if (!ids.length) return emit('✗ Aucune zone choisie.'), 1;
    let done = 0;
    for (const id of ids) if (await sendZone(emit, c, id)) done++;
    emit(`\n${done === ids.length ? '✓' : '⚠'} ${done} zone(s) sur ${ids.length} envoyée(s).`);
    if (done) emit('Si une zone a changé de contenu : commiter son world.json / index.json, puis « Mettre à jour l’application » pour que le catalogue annonce la nouvelle version.');
    return done === ids.length ? 0 : 1;
  }

  if (action === 'send-menu') {
    const files = existsSync(menuDir) ? readdirSync(menuDir).filter((f) => /^loop-.*\.(mp4|webm)$/.test(f)) : [];
    if (!files.length) return emit('✗ Aucune vidéo loop-* dans apps/client/public/menu.'), 1;
    fail = await step(emit, 'Dossier du serveur', ...ssh(`mkdir -p ${q(`${c.repo}/deploy/data/menu`)}`));
    if (fail === 0)
      fail = await step(emit, `Envoi de ${files.length} vidéos (scp)`, 'scp', ['-i', c.key, '-P', String(c.port), '-o', 'BatchMode=yes', ...files.map((f) => join(menuDir, f)), `${c.host}:${c.repo}/deploy/data/menu/`]);
    if (fail === 0 && !DRY) {
      const ok = await fetch(`${c.url}/menu/loop-spring.mp4`, { method: 'HEAD' }).then((r) => r.ok).catch(() => false);
      emit(ok ? '  ✓ loop-spring.mp4 répond sur le site' : '  ⚠ loop-spring.mp4 ne répond pas encore');
    }
    return fail === 0 ? 0 : 1;
  }

  emit('✗ Action inconnue.');
  return 1;
}


/** Enregistre les réglages de connexion (validés) ; renvoie { ok, error? }. */
export function saveConfig(b) {
  const c = { ...loadConfig(), host: String(b.host ?? ''), port: Number(b.port), key: String(b.key ?? ''), repo: String(b.repo ?? ''), url: String(b.url ?? '') };
  if (!validConfig(c)) return { ok: false, error: 'Valeurs invalides (hôte utilisateur@domaine, port, dossier absolu, https://…).' };
  writeFileSync(configFile, JSON.stringify(c, null, 2));
  return { ok: true };
}

/* ───────────── Ligne de commande : node deploy/deploy-core.mjs run <demande.json> ───────────── */
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href && process.argv[2] === 'run') {
  const req = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  const code = await job(String(req.action), req, (l) => console.log(l));
  process.exit(code);
}
