/**
 * Constructeur de zone (outil local de développement, jamais déployé) :
 *
 *   pnpm zone-builder            # puis http://127.0.0.1:5199
 *
 * Lit les zones réelles (config.ts, zones JSON, worlds.ts, zoneMap.ts, worlds/index.json), permet
 * d'en créer ou d'en modifier une sur le fond Plan IGN, écrit `tools/terrain/zones/<id>.json` (avec
 * sauvegarde) et la ligne de menu des fichiers client, puis lance build:world, verify-world et packs
 * avec journal en direct, annulation et reprise. Écoute 127.0.0.1 uniquement.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { ZONES_DIR, REPO_ROOT, allWorlds, type OpenWorld, type WorldConfig } from './config.ts';
import { fromL93, toL93 } from './lambert93.ts';
import { configFile as deployConfigFile, loadConfig as deployConfig, localGit, localZones as deployLocalZones, remoteState, saveConfig as deploySaveConfig } from '../../../deploy/deploy-core.mjs';
import { estimate, frameFromRect, readWorldLine, rectFromWorld, upsertSpotLine, upsertWorldLine, validate, zoneJson, type Pt, type ZoneDraft } from './zone-builder-lib.ts';

const PORT = Number(process.env.ZONE_BUILDER_PORT ?? 5199);
const HOST = '127.0.0.1';
const PAGE = path.join(REPO_ROOT, 'tools', 'terrain', 'zone-builder', 'index.html');
const WORLDS_TS = path.join(REPO_ROOT, 'apps', 'client', 'src', 'world', 'worlds.ts');
const ZONEMAP_TS = path.join(REPO_ROOT, 'apps', 'client', 'src', 'world', 'zoneMap.ts');
const PUBLIC_WORLDS = path.join(REPO_ROOT, 'apps', 'client', 'public', 'worlds');
const STATE_DIR = path.join(REPO_ROOT, 'data', 'cache', 'zone-builder');
const BACKUP_DIR = path.join(STATE_DIR, 'backups');
const JOB_FILE = path.join(STATE_DIR, 'job.json');
const LOG_FILE = path.join(STATE_DIR, 'job.log');
/** État de la dernière reconstruction de tous les mondes (gardé quand un autre travail remplace job.json). */
const REBUILD_FILE = path.join(STATE_DIR, 'rebuild-all.json');

const read = (f: string) => fs.readFileSync(f, 'utf8');

/**
 * Le panneau « Serveur » (envoi des zones, mise à jour du VPS) est réservé au propriétaire du serveur : le
 * constructeur de zone sert aussi aux joueurs (Réglages › mode expert, sur leur machine), qui n'ont aucun
 * serveur à mettre à jour. Actif seulement si deploy/.deploy-gui.json existe (réglages enregistrés par le
 * propriétaire, ignorés par git) ou avec ZONE_BUILDER_DEPLOY=1 (premier réglage).
 */
const deployEnabled = (): boolean => process.env.ZONE_BUILDER_DEPLOY === '1' || fs.existsSync(deployConfigFile);
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

function backup(file: string): void {
  if (!fs.existsSync(file)) return;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.copyFileSync(file, path.join(BACKUP_DIR, `${stamp()}-${path.basename(file)}`));
}

/** Écriture sûre : sauvegarde, fichier temporaire, renommage. */
function safeWrite(file: string, text: string): void {
  backup(file);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

// ---- zones ---------------------------------------------------------------------------------

function zoneSource(id: string): 'json' | 'config' | 'private' {
  if (fs.existsSync(path.join(ZONES_DIR, `${id}.json`))) return 'json';
  return allWorlds()[id]?.private ? 'private' : 'config';
}

function listZones() {
  const worlds = read(WORLDS_TS);
  const spots = read(ZONEMAP_TS);
  let index: { zones?: Array<{ id: string }> } = {};
  try {
    index = JSON.parse(read(path.join(PUBLIC_WORLDS, 'index.json')));
  } catch {
    /* pas encore de catalogue */
  }
  const inIndex = new Set((index.zones ?? []).map((z) => z.id));
  return Object.values(allWorlds()).map((w) => ({
    id: w.id,
    name: w.name,
    region: w.region ?? '',
    kind: w.kind,
    editable: w.kind === 'open' && !w.private,
    source: zoneSource(w.id),
    built: fs.existsSync(path.join(PUBLIC_WORLDS, w.id, 'world.json')),
    inCatalogue: inIndex.has(w.id),
    inMenu: worlds.includes(`id: '${w.id}'`),
    onMap: spots.includes(`id: '${w.id}'`),
  }));
}

const asPt = (p: unknown): Pt => (typeof p === 'string' ? p : { lon: (p as { lon: number }).lon, lat: (p as { lat: number }).lat });

function draftOf(w: OpenWorld): ZoneDraft {
  const worlds = read(WORLDS_TS);
  const spots = read(ZONEMAP_TS);
  const wl = readWorldLine(worlds, w.id);
  const sl = new RegExp(`\\{ id: '${w.id}',[^\\n]*region: \\{ fr: '((?:[^'\\\\]|\\\\.)*)', en: '((?:[^'\\\\]|\\\\.)*)'`).exec(spots);
  return {
    id: w.id,
    nameFr: w.name,
    nameEn: wl.nameEn ?? w.name,
    regionFr: w.region ?? '',
    regionEn: sl?.[2] ?? w.region ?? '',
    hintFr: wl.hintFr ?? '',
    hintEn: wl.hintEn ?? '',
    sea: !!w.sea,
    orthoPx: w.orthoPx,
    rect: rectFromWorld(w.originL93, w.corridorTiles),
    tours: w.tours.map((t) => {
      const { routeId, routeName, routeNameEn, start, via, ...extra } = t;
      return { routeId, nameFr: routeName, nameEn: routeNameEn, points: [start, ...via].map(asPt), extra: extra as Record<string, unknown> };
    }),
  };
}

function parseDraft(body: unknown): ZoneDraft {
  const d = body as ZoneDraft;
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    id: s(d.id),
    nameFr: s(d.nameFr),
    nameEn: s(d.nameEn),
    regionFr: s(d.regionFr),
    regionEn: s(d.regionEn),
    hintFr: s(d.hintFr),
    hintEn: s(d.hintEn),
    sea: !!d.sea,
    orthoPx: [512, 1024, 2048].includes(n(d.orthoPx)) ? n(d.orthoPx) : 1024,
    rect: { minE: n(d.rect?.minE), minN: n(d.rect?.minN), maxE: n(d.rect?.maxE), maxN: n(d.rect?.maxN) },
    tours: (Array.isArray(d.tours) ? d.tours : []).map((t) => ({
      routeId: s(t.routeId),
      nameFr: s(t.nameFr),
      nameEn: s(t.nameEn),
      points: (Array.isArray(t.points) ? t.points : []).map((p) => (typeof p === 'string' ? p : { lon: n((p as { lon: number }).lon), lat: n((p as { lat: number }).lat) })),
      ...(t.extra && typeof t.extra === 'object' ? { extra: t.extra } : {}),
    })),
  };
}

function preview(draft: ZoneDraft, noOrtho: boolean) {
  const frame = frameFromRect(draft.rect);
  const errors = validate(draft, frame);
  const est = estimate(frame, !noOrtho);
  const existing = allWorlds()[draft.id];
  if (existing && (existing.kind !== 'open' || existing.private)) errors.push(`« ${draft.id} » est un monde ${existing.private ? 'privé' : existing.kind} : non modifiable ici`);
  return { frame, errors, estimate: est };
}

function saveZone(draft: ZoneDraft) {
  if (jobRunning()) throw new Error('une construction est en cours : attendre sa fin ou l’annuler avant d’enregistrer');
  const { frame, errors } = preview(draft, false);
  if (errors.length) throw new Error(errors.join(' ; '));
  const file = path.join(ZONES_DIR, `${draft.id}.json`);
  const existing = allWorlds()[draft.id] as WorldConfig | undefined;
  const raw = existing ? (JSON.parse(JSON.stringify(existing)) as Record<string, unknown>) : undefined;
  const json = zoneJson(draft, frame, raw);
  fs.mkdirSync(ZONES_DIR, { recursive: true });
  // les trois fichiers sont calculés avant la première écriture : tout ou rien
  const worlds = upsertWorldLine(read(WORLDS_TS), draft);
  const spots = upsertSpotLine(read(ZONEMAP_TS), draft, frame);
  safeWrite(file, `${JSON.stringify(json, null, 2)}\n`);
  if (worlds) safeWrite(WORLDS_TS, worlds);
  if (spots) safeWrite(ZONEMAP_TS, spots);
  return { file: path.relative(REPO_ROOT, file), worlds: !!worlds, zoneMap: !!spots, backups: path.relative(REPO_ROOT, BACKUP_DIR) };
}

// ---- construction --------------------------------------------------------------------------

interface Step {
  name: string;
  cmd: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  /** Sortie du pas (vérifications seulement : sert au tableau de résultats). */
  out?: string;
  startedAt?: string;
  endedAt?: string;
  /** Monde reconstruit par ce pas (reconstruction de tous les mondes). */
  zone?: string;
  /** Ne tourne que si tous les pas précédents ont réussi (sinon il est ignoré, sans arrêter le travail). */
  needsAllOk?: boolean;
}
interface Job {
  id: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  startedAt: string;
  endedAt?: string;
  pid?: number;
  steps: Step[];
  /** Vérification de zones : un pas en échec n'arrête pas les suivants. */
  keepGoing?: boolean;
  /** Reconstruction de tous les mondes publiés (état gardé dans REBUILD_FILE). */
  rebuildAll?: boolean;
}

let job: Job | null = null;
let child: ChildProcess | null = null;
let cancelled = false;

try {
  job = JSON.parse(read(JOB_FILE)) as Job;
  // reprise du serveur : un travail « en cours » dont le processus n'existe plus est interrompu
  if (job.status === 'running' && !(job.pid && alive(job.pid))) {
    job.status = 'failed';
    for (const s of job.steps) if (s.status === 'running' || s.status === 'pending') s.status = 'failed';
  }
} catch {
  job = null;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const jobRunning = () => job?.status === 'running';

function persist(): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(JOB_FILE, JSON.stringify(job, null, 1));
  if (job?.rebuildAll) fs.writeFileSync(REBUILD_FILE, JSON.stringify(job, null, 1));
}

/** Dernière reconstruction de tous les mondes (en cours ou terminée), null si jamais lancée. */
function rebuildState(): Job | null {
  if (job?.rebuildAll) return job;
  try {
    const j = JSON.parse(read(REBUILD_FILE)) as Job;
    if (j.status === 'running') {
      // serveur relancé pendant la reconstruction : elle s'est arrêtée
      j.status = 'failed';
      for (const st of j.steps) if (st.status === 'running' || st.status === 'pending') st.status = 'cancelled';
    }
    return j;
  } catch {
    return null;
  }
}

/** Mondes publiés (catalogue index.json) que l'outil sait reconstruire (hors mondes privés). */
function publishedZoneIds(): string[] {
  const all = allWorlds();
  const cat = JSON.parse(read(path.join(PUBLIC_WORLDS, 'index.json'))) as { zones: Array<{ id: string }> };
  return cat.zones.map((z) => z.id).filter((id) => all[id] && !all[id]!.private);
}

/**
 * Reconstruit tous les mondes publiés, l'un après l'autre (un échec n'arrête pas la suite), puis les
 * packs. `resume` : reprend la dernière reconstruction en gardant les mondes déjà faits.
 */
async function startRebuildAll(opts: { noOrtho: boolean; offline: boolean; resume: boolean; exclude?: string[] }): Promise<Job> {
  if (jobRunning()) throw new Error('un travail de l’outil est déjà en cours');
  const others = await otherBuilds();
  if (others.length) throw new Error(`une construction tourne déjà ailleurs, rien lancé :\n${others.join('\n')}`);
  const prev = opts.resume ? rebuildState() : null;
  const doneBefore = new Map((prev?.steps ?? []).filter((st) => st.zone && st.status === 'done').map((st) => [st.zone as string, st]));
  const flags = [opts.noOrtho && '--no-ortho', opts.offline && '--offline'].filter(Boolean).join(' ');
  // « Sauf » : zones laissées telles quelles (les identifiants inconnus sont refusés, pour éviter une faute de frappe silencieuse).
  const published = publishedZoneIds();
  const exclude = (opts.exclude ?? []).filter(Boolean);
  const unknown = exclude.filter((id) => !published.includes(id));
  if (unknown.length) throw new Error(`zone(s) inconnue(s) dans « Sauf » : ${unknown.join(', ')}`);
  const todo = published.filter((id) => !exclude.includes(id));
  if (!todo.length) throw new Error('toutes les zones sont exclues : rien à reconstruire');
  const steps: Step[] = todo.map((id) => doneBefore.get(id) ?? { name: `build ${id}`, zone: id, cmd: `pnpm --filter @allezrobert/terrain build:world -- --world ${id}${flags ? ` ${flags}` : ''}`, status: 'pending' });
  steps.push({ name: 'packs', cmd: 'pnpm --filter @allezrobert/terrain packs', status: 'pending' });
  job = { id: 'tous-les-mondes', status: 'running', startedAt: prev && opts.resume ? prev.startedAt : new Date().toISOString(), steps, keepGoing: true, rebuildAll: true };
  cancelled = false;
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(LOG_FILE, `# ${new Date().toISOString()} — reconstruction de ${steps.length - 1} monde(s)${doneBefore.size ? `, ${doneBefore.size} déjà faits gardés` : ''}\n`);
  persist();
  void runSteps();
  return job;
}

function log(text: string): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.appendFileSync(LOG_FILE, text);
}

function killTree(pid: number): void {
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => undefined);
  else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* déjà terminé */
      }
    }
  }
}

/** Constructions lancées ailleurs (autre terminal, autre agent) : on ne démarre pas par-dessus. */
function otherBuilds(): Promise<string[]> {
  const pat = /build-world|build-open|build-tiles|build-climb|build-packs|verify-world/;
  return new Promise((resolve) => {
    const done = (out: string) => resolve(out.split(/\r?\n/).filter((l) => pat.test(l) && !/zone-builder/.test(l)).map((l) => l.trim().slice(0, 200)));
    if (process.platform === 'win32') {
      execFile('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }'], { maxBuffer: 16e6 }, (_e, out) => done(String(out ?? '')));
    } else execFile('ps', ['-eo', 'pid,args'], { maxBuffer: 16e6 }, (_e, out) => done(String(out ?? '')));
  });
}

async function startBuild(opts: { id: string; noOrtho: boolean; offline: boolean; graphOnly: boolean; verify: boolean; packs: boolean; send?: boolean }): Promise<Job> {
  if (jobRunning()) throw new Error('une construction de l’outil est déjà en cours');
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(opts.id)) throw new Error('identifiant invalide');
  const w = allWorlds()[opts.id];
  if (!w) throw new Error(`zone « ${opts.id} » inconnue : l’enregistrer d’abord`);
  if (w.private) throw new Error('monde privé : hors de cet outil');
  const others = await otherBuilds();
  if (others.length) throw new Error(`une construction tourne déjà ailleurs, rien lancé :\n${others.join('\n')}`);
  const flags = [opts.noOrtho && '--no-ortho', opts.offline && '--offline', opts.graphOnly && '--graph-only'].filter(Boolean).join(' ');
  const steps: Step[] = [{ name: 'build:world', cmd: `pnpm --filter @allezrobert/terrain build:world -- --world ${opts.id}${flags ? ` ${flags}` : ''}`, status: 'pending' }];
  if (opts.verify && !opts.graphOnly) steps.push({ name: 'verify-world', cmd: `pnpm --filter @allezrobert/terrain exec tsx src/verify-world.ts --world ${opts.id}`, status: 'pending' });
  if (opts.packs) steps.push({ name: 'packs', cmd: 'pnpm --filter @allezrobert/terrain packs', status: 'pending' });
  if (opts.send && deployEnabled() && !opts.graphOnly) steps.push(deployStep(`envoi ${opts.id} au serveur`, { action: 'send-zones', ids: [opts.id] }));
  job = { id: opts.id, status: 'running', startedAt: new Date().toISOString(), steps };
  cancelled = false;
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(LOG_FILE, `# ${job.startedAt} — zone ${opts.id}\n`);
  persist();
  void runSteps();
  return job;
}

/**
 * Pas de déploiement : lance deploy/deploy-core.mjs (même noyau que l'outil autonome) avec la demande écrite dans
 * un fichier, ce qui évite tout problème de guillemets dans la commande du shell.
 */
function deployStep(name: string, req: Record<string, unknown>): Step {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const file = path.join(STATE_DIR, `deploy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`);
  fs.writeFileSync(file, JSON.stringify(req));
  return { name, cmd: `node deploy/deploy-core.mjs run ${JSON.stringify(file)}`, status: 'pending' };
}

/** Mise à jour du serveur : application (git pull + Docker), zones, vidéos du menu. */
async function startDeploy(b: { action: string; ids?: unknown; branch?: unknown; mode?: unknown; push?: unknown; thenUpdate?: unknown }): Promise<Job> {
  if (jobRunning()) throw new Error('un travail de l’outil est déjà en cours');
  const steps: Step[] = [];
  if (b.action === 'send-zones') {
    const ids = (Array.isArray(b.ids) ? b.ids.map(String) : []).filter((i) => /^[a-z0-9-]+$/.test(i));
    if (!ids.length) throw new Error('aucune zone choisie');
    for (const id of ids) steps.push(deployStep(`envoi ${id}`, { action: 'send-zones', ids: [id] }));
    // Le catalogue (index.json) n'annonce les zones qu'une fois l'image web redéployée : à faire après les tuiles, et seulement si tout est parti.
    if (b.thenUpdate) steps.push({ ...deployStep('mise à jour de l’application', { action: 'update-app', branch: String(b.branch ?? ''), mode: b.mode === 'pull' ? 'pull' : 'build', push: !!b.push }), needsAllOk: true });
  } else if (b.action === 'update-app') {
    steps.push(deployStep('mise à jour de l’application', { action: 'update-app', branch: String(b.branch ?? ''), mode: b.mode === 'pull' ? 'pull' : 'build', push: !!b.push }));
  } else if (b.action === 'install-key') {
    steps.push(deployStep('installation de la clé SSH', { action: 'install-key' }));
  } else if (b.action === 'send-menu') {
    steps.push(deployStep('vidéos du menu', { action: 'send-menu' }));
  } else throw new Error('action inconnue');
  job = { id: 'serveur', status: 'running', startedAt: new Date().toISOString(), steps, keepGoing: true };
  cancelled = false;
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(LOG_FILE, `# ${job.startedAt} — serveur : ${b.action}\n`);
  persist();
  void runSteps();
  return job;
}

/** Zones construites (dossier avec world.json), prêtes à être vérifiées. */
function builtZoneIds(): string[] {
  try {
    return fs
      .readdirSync(PUBLIC_WORLDS, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(PUBLIC_WORLDS, d.name, 'world.json')))
      .map((d) => d.name)
      .filter((id) => !!allWorlds()[id]);
  } catch {
    return [];
  }
}

/** Vérification seule (verify-world) d'une ou de toutes les zones construites, sans rien reconstruire. */
async function startVerify(ids: string[] | 'all'): Promise<Job> {
  if (jobRunning()) throw new Error('un travail de l’outil est déjà en cours');
  const built = builtZoneIds();
  const list = ids === 'all' ? built : ids;
  if (!list.length) throw new Error('aucune zone construite à vérifier');
  for (const id of list) if (!built.includes(id)) throw new Error(`zone « ${id} » inconnue ou non construite`);
  const others = await otherBuilds();
  if (others.length) throw new Error(`une construction tourne déjà ailleurs, rien lancé :\n${others.join('\n')}`);
  const steps: Step[] = list.map((id) => ({ name: `verify ${id}`, cmd: `pnpm --filter @allezrobert/terrain exec tsx src/verify-world.ts --world ${id}`, status: 'pending' as const }));
  job = { id: list.length === 1 ? (list[0] as string) : 'toutes-les-zones', status: 'running', startedAt: new Date().toISOString(), steps, keepGoing: true };
  cancelled = false;
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(LOG_FILE, `# ${job.startedAt} — vérification de ${list.length} zone(s)\n`);
  persist();
  void runSteps();
  return job;
}

interface VerifyRoute {
  route: string;
  km: number;
  meanCm: number;
  maxCm: number;
  dyCm: number;
  /** Alertes lisibles : route décalée du terrain en moyenne, ou grand écart ponctuel (pont, tunnel, erreur). */
  warn: string[];
}
interface VerifyRow {
  zone: string;
  status: Step['status'];
  routes: VerifyRoute[];
  edgeMaxCm: number | null;
  /** Départ du roulage libre (route où le jeu pose le coureur) ; `ok` faux : piste, ruelle, à côté de la route. */
  start?: { ok: boolean; text: string };
  error?: string;
}

/** Résultats de verify-world rangés par zone, à partir de la sortie des pas de vérification. */
function verifySummary(j: Job | null): VerifyRow[] | null {
  if (!j || !j.steps.some((s) => s.name.startsWith('verify'))) return null;
  const rows: VerifyRow[] = [];
  for (const s of j.steps) {
    if (!s.name.startsWith('verify')) continue;
    const out = s.out ?? '';
    const routes: VerifyRoute[] = [];
    for (const line of out.split(/\r?\n/)) {
      const m = /^(\S+) : ([\d.]+) km.*écart terrain hi\/route : moyen ([\d.]+) cm, max ([\d.]+) cm sur \d+ points ; Δy max entre points ([\d.]+) cm/.exec(line);
      if (!m) continue;
      const meanCm = Number(m[3]);
      const maxCm = Number(m[4]);
      const dyCm = Number(m[5]);
      const warn: string[] = [];
      if (meanCm > 5) warn.push(`route décalée du terrain en moyenne (${meanCm} cm) : coureurs enfoncés ou en l'air`);
      if (maxCm > 300) warn.push(`écart ponctuel de ${(maxCm / 100).toFixed(1)} m : pont, tunnel ou route mal posée`);
      if (dyCm > 100) warn.push(`marche de ${dyCm} cm entre deux points : saut de hauteur`);
      routes.push({ route: m[1] as string, km: Number(m[2]), meanCm, maxCm, dyCm, warn });
    }
    const edges = [...out.matchAll(/raccord des bords \S+ : écart max ([\d.]+) cm/g)].map((e) => Number(e[1]));
    const err = /Error:[^\n]*/.exec(out)?.[0];
    const st = /^départ libre : (ok|à revoir) — (.*?)\r?$/m.exec(out);
    rows.push({ zone: s.name.startsWith('verify ') ? s.name.slice(7) : j.id, status: s.status, routes, edgeMaxCm: edges.length ? Math.max(...edges) : null, ...(st ? { start: { ok: st[1] === 'ok', text: st[2] as string } } : {}), ...(err ? { error: err.slice(0, 200) } : {}) });
  }
  return rows;
}

async function runSteps(): Promise<void> {
  const j = job!;
  for (const step of j.steps) {
    if (cancelled) break;
    if (step.status === 'done') continue; // déjà fait (reprise)
    if (step.needsAllOk && j.steps.some((o) => o !== step && o.status !== 'done')) {
      step.status = 'cancelled';
      log(`
# ${step.name} : ignoré, un pas précédent a échoué
`);
      continue;
    }
    step.status = 'running';
    step.startedAt = new Date().toISOString();
    step.endedAt = undefined;
    log(`\n$ ${step.cmd}\n`);
    const ok = await new Promise<boolean>((resolve) => {
      child = spawn(step.cmd, { shell: true, cwd: REPO_ROOT, detached: process.platform !== 'win32', env: { ...process.env, FORCE_COLOR: '0' } });
      j.pid = child.pid;
      persist();
      const keep = (b: Buffer) => {
        log(b.toString());
        if (step.name.startsWith('verify') && (step.out?.length ?? 0) < 20000) step.out = (step.out ?? '') + b.toString();
      };
      child.stdout?.on('data', keep);
      child.stderr?.on('data', keep);
      child.on('error', (e) => {
        log(`erreur : ${e.message}\n`);
        resolve(false);
      });
      child.on('close', (code) => {
        log(`-- ${step.name} : code ${code}\n`);
        resolve(code === 0);
      });
    });
    step.status = cancelled ? 'cancelled' : ok ? 'done' : 'failed';
    step.endedAt = new Date().toISOString();
    persist();
    if (!ok && !j.keepGoing) break;
  }
  j.status = cancelled ? 'cancelled' : j.steps.every((s) => s.status === 'done') ? 'done' : 'failed';
  for (const s of j.steps) if (s.status === 'pending') s.status = 'cancelled';
  j.endedAt = new Date().toISOString();
  j.pid = undefined;
  child = null;
  persist();
  log(`\n# ${j.status}\n`);
}

function cancelBuild(): boolean {
  if (!jobRunning()) return false;
  cancelled = true;
  const pid = job?.pid;
  if (pid) killTree(pid);
  return true;
}

function readLog(from: number): { text: string; size: number } {
  try {
    const size = fs.statSync(LOG_FILE).size;
    const start = Math.min(from, size);
    const fd = fs.openSync(LOG_FILE, 'r');
    const buf = Buffer.alloc(Math.min(size - start, 2e6));
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return { text: buf.toString('utf8'), size: start + buf.length };
  } catch {
    return { text: '', size: 0 };
  }
}

// ---- tours automatiques et infos de zone (processus zone-plan.ts) ------------------------------

interface Plan {
  status: 'running' | 'done' | 'error' | 'cancelled';
  lines: string[];
  result?: unknown;
  error?: string;
  pid?: number;
}
let plan: Plan | null = null;

async function startPlan(b: { draft: ZoneDraft; start?: { lon: number; lat: number }; targetKm: number; variants: number; seed: number; meta?: boolean }): Promise<Plan> {
  if (jobRunning()) throw new Error('une construction est en cours : attendre sa fin avant de calculer des tours');
  if (plan?.status === 'running') throw new Error('un calcul est déjà en cours (infos de zone ou tours)');
  const others = process.env.ZONE_BUILDER_FORCE === '1' ? [] : await otherBuilds();
  if (others.length) throw new Error(`une construction tourne ailleurs (le calcul partage le cache OSM), rien lancé :\n${others.join('\n')}`);
  if (!(b.draft.rect.maxE > b.draft.rect.minE)) throw new Error('dessiner d’abord l’emprise');
  const frame = frameFromRect(b.draft.rect);
  if (frame.tiles > 400) throw new Error(`emprise de ${frame.tiles} tuiles : trop grande pour télécharger OSM ici (réduire)`);
  const targetKm = Math.min(120, Math.max(5, Number(b.targetKm) || 25));
  const variants = Math.min(6, Math.max(1, Math.round(Number(b.variants) || 3)));
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const world = { kind: 'open', id: '__plan__', name: 'plan', originL93: frame.originL93, corridorTiles: frame.corridorTiles, start: fromL93(frame.center.x, frame.center.y), orthoPx: 512, horizon: { halfSizeM: 30000, resM: 100 }, ...(b.draft.sea ? { sea: true } : {}), tours: [] };
  const worldFile = path.join(STATE_DIR, 'plan-world.json');
  const reqFile = path.join(STATE_DIR, 'plan-request.json');
  fs.writeFileSync(worldFile, JSON.stringify(world));
  fs.writeFileSync(reqFile, JSON.stringify({ targetKm, variants, seed: Math.floor(Number(b.seed) || 1), ...(b.meta ? { meta: true, detectSea: true } : {}), ...(b.start ? { start: { lon: Number(b.start.lon), lat: Number(b.start.lat) } } : {}) }));
  const p: Plan = { status: 'running', lines: [] };
  plan = p;
  const proc = spawn(`npx tsx src/zone-plan.ts ${JSON.stringify(reqFile)}`, { shell: true, cwd: path.join(REPO_ROOT, 'tools', 'terrain'), detached: process.platform !== 'win32', env: { ...process.env, TERRAIN_WORLD_JSON: worldFile, FORCE_COLOR: '0' } });
  p.pid = proc.pid;
  let buf = '';
  const onData = (d: Buffer) => {
    buf += d.toString();
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (line.startsWith('@@result ')) p.result = JSON.parse(line.slice(9));
      else if (line.startsWith('@@error ')) p.error = line.slice(8);
      else if (line.startsWith('@@progress ')) p.lines.push(line.slice(11));
      else if (line.trim()) p.lines.push(line.trim().slice(0, 200));
    }
  };
  proc.stdout?.on('data', onData);
  proc.stderr?.on('data', onData);
  proc.on('close', (code) => {
    if (p.status === 'cancelled') return;
    p.status = p.result ? 'done' : 'error';
    if (!p.result && !p.error) p.error = `calcul interrompu (code ${code})`;
    p.pid = undefined;
  });
  return p;
}

function cancelPlan(): boolean {
  if (plan?.status !== 'running') return false;
  plan.status = 'cancelled';
  if (plan.pid) killTree(plan.pid);
  return true;
}

// ---- HTTP ----------------------------------------------------------------------------------

function send(res: http.ServerResponse, code: number, body: unknown, type = 'application/json; charset=utf-8'): void {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function bodyOf(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let n = 0;
    req.on('data', (c: Buffer) => {
      n += c.length;
      if (n > 2e6) reject(new Error('corps trop gros'));
      else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  try {
    // local seulement : mauvais Host (rebinding DNS) ou origine étrangère refusés
    const host = String(req.headers.host ?? '');
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return send(res, 403, { error: 'hôte refusé' });
    const url = new URL(req.url ?? '/', 'http://x');
    if (req.method === 'POST') {
      const origin = req.headers.origin;
      if (req.headers['x-zone-builder'] !== '1' || (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin))) return send(res, 403, { error: 'requête refusée' });
    }
    if (req.method === 'GET' && url.pathname === '/') return send(res, 200, read(PAGE), 'text/html; charset=utf-8');
    if (req.method === 'GET' && url.pathname === '/api/zones') return send(res, 200, { zones: listZones(), job, deploy: deployEnabled() });
    if (req.method === 'GET' && url.pathname === '/api/zone') {
      const id = url.searchParams.get('id') ?? '';
      const w = allWorlds()[id];
      if (!w) return send(res, 404, { error: 'zone inconnue' });
      if (w.kind !== 'open') return send(res, 400, { error: `zone de type « ${w.kind} » : non modifiable ici` });
      return send(res, 200, { draft: draftOf(w), source: zoneSource(id), private: !!w.private });
    }
    if (req.method === 'GET' && url.pathname === '/api/job') {
      const { text, size } = readLog(Number(url.searchParams.get('from') ?? 0));
      return send(res, 200, { job, text, size, verify: verifySummary(job), rebuild: rebuildState() });
    }
    if (req.method === 'GET' && url.pathname === '/api/geo') {
      // conversions Lambert-93 ↔ WGS84 pour la page (une seule implémentation de la projection)
      const e = Number(url.searchParams.get('e'));
      const n = Number(url.searchParams.get('n'));
      const lon = Number(url.searchParams.get('lon'));
      const lat = Number(url.searchParams.get('lat'));
      return send(res, 200, url.searchParams.has('e') ? fromL93(e, n) : toL93(lon, lat));
    }
    if (req.method === 'POST' && url.pathname === '/api/preview') {
      const b = (await bodyOf(req)) as { draft: unknown; noOrtho?: boolean };
      return send(res, 200, preview(parseDraft(b.draft), !!b.noOrtho));
    }
    if (req.method === 'POST' && url.pathname === '/api/save') {
      const b = (await bodyOf(req)) as { draft: unknown };
      return send(res, 200, saveZone(parseDraft(b.draft)));
    }
    if (req.method === 'POST' && url.pathname === '/api/build') {
      const b = (await bodyOf(req)) as Record<string, unknown>;
      const j = await startBuild({ id: String(b.id ?? ''), noOrtho: !!b.noOrtho, offline: !!b.offline, graphOnly: !!b.graphOnly, verify: b.verify !== false, packs: b.packs !== false, send: !!b.send });
      return send(res, 200, { job: j });
    }
    if (req.method === 'POST' && url.pathname === '/api/rebuild-all') {
      const b = (await bodyOf(req)) as Record<string, unknown>;
      const exclude = Array.isArray(b.exclude) ? b.exclude.map(String).filter((i) => /^[a-z0-9-]+$/.test(i)) : [];
      const j = await startRebuildAll({ noOrtho: !!b.noOrtho, offline: !!b.offline, resume: !!b.resume, exclude });
      return send(res, 200, { job: j });
    }
    if (req.method === 'POST' && url.pathname === '/api/verify') {
      const b = (await bodyOf(req)) as { ids?: unknown };
      const ids = Array.isArray(b.ids) ? b.ids.map(String) : 'all';
      const j = await startVerify(ids);
      return send(res, 200, { job: j });
    }
    if (req.method === 'GET' && url.pathname === '/api/plan') {
      const from = Number(url.searchParams.get('from') ?? 0);
      return send(res, 200, plan ? { status: plan.status, lines: plan.lines.slice(from), next: plan.lines.length, result: plan.result, error: plan.error } : { status: 'idle', lines: [], next: 0 });
    }
    if (req.method === 'POST' && url.pathname === '/api/plan') {
      const b = (await bodyOf(req)) as { draft: unknown; start?: { lon: number; lat: number }; targetKm: number; variants: number; seed: number; meta?: boolean };
      await startPlan({ ...b, draft: parseDraft(b.draft) });
      return send(res, 200, { status: 'running' });
    }
    if (req.method === 'POST' && url.pathname === '/api/plan/cancel') return send(res, 200, { cancelled: cancelPlan() });
    if (url.pathname.startsWith('/api/deploy/') && !deployEnabled()) return send(res, 403, { error: 'déploiement non activé sur cette machine (réservé au propriétaire du serveur)' });
    if (req.method === 'GET' && url.pathname === '/api/deploy/state') {
      const config = deployConfig();
      return send(res, 200, { config, git: await localGit(), local: deployLocalZones(), remote: await remoteState(config) });
    }
    if (req.method === 'POST' && url.pathname === '/api/deploy/config') return send(res, 200, deploySaveConfig((await bodyOf(req)) as Record<string, unknown>));
    if (req.method === 'POST' && url.pathname === '/api/deploy/run') {
      const j = await startDeploy((await bodyOf(req)) as { action: string });
      return send(res, 200, { job: j });
    }
    if (req.method === 'POST' && url.pathname === '/api/cancel') return send(res, 200, { cancelled: cancelBuild() });
    send(res, 404, { error: 'introuvable' });
  } catch (e) {
    send(res, 400, { error: e instanceof Error ? e.message : String(e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Constructeur de zone : http://${HOST}:${PORT}  (Ctrl+C pour arrêter ; une construction en cours est arrêtée aussi)`);
});

process.on('SIGINT', () => {
  cancelBuild();
  cancelPlan();
  process.exit(0);
});
