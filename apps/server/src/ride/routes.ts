/**
 * Itinéraires disponibles côté serveur : fichiers RouteData produits par tools/terrain
 * (ROUTES_DIR, un ou plusieurs dossiers séparés par des virgules, ex. apps/client/public/worlds/chevreuse/routes), avec repli sur une boucle
 * procédurale de ~10 km si le dossier est absent ou vide (développement, tests).
 */
import { open, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { forwardRouteId, parseStartedRouteId, reverseRoute, rotateRoute, RouteTrack, type RouteData, type RoutePoint, type RouteSummary } from '@allezrobert/shared';

export const FALLBACK_ROUTE_ID = 'dev-boucle';
/** Parcours construits à la demande (sens inverse, départ choisi) gardés en mémoire. */
const MAX_BUILT = 256;
/**
 * Itinéraires des zones indexées (entrée de ROUTES_DIR où une étoile tient la place de la zone) gardés en mémoire après lecture :
 * les moins récemment demandés partent. Un tracé de 76 km pèse de l'ordre de 10 Mo une fois analysé ;
 * une salle ouverte garde le sien par référence, même sorti de ce cache.
 */
export const MAX_LAZY = 8;

export type RouteEntry = { data: RouteData; track: RouteTrack; summary: RouteSummary };
/** Fichier d'itinéraire connu sans avoir été lu en entier. */
interface LazyFile {
  world: string;
  file: string;
}

export class RouteStore {
  private readonly routes = new Map<string, { data: RouteData; track: RouteTrack; summary: RouteSummary }>();
  /**
   * Parcours roulés dans l'autre sens (« <id>-inverse ») ou depuis un autre départ de la boucle
   * (« <id>[-inverse]-depart-<m> »), construits à la demande, hors liste.
   */
  private readonly reversed = new Map<string, { data: RouteData; track: RouteTrack; summary: RouteSummary }>();

  /** Identifiant d'itinéraire → fichiers des zones indexées (plusieurs zones portent le même identifiant). */
  private readonly lazy = new Map<string, LazyFile[]>();
  /** Itinéraires lus à la demande (clé « zone/identifiant », parcours dérivés compris), du plus ancien au plus récent. */
  private readonly loaded = new Map<string, RouteEntry>();
  private readonly loading = new Map<string, Promise<RouteEntry | undefined>>();
  /** Fichiers déjà chargés au démarrage (chemins absolus), exclus de l'index. */
  readonly eagerFiles = new Set<string>();
  /** Lecture d'un fichier d'itinéraire (remplaçable dans les tests). */
  readFileImpl: (file: string) => Promise<string> = (file) => readFile(file, 'utf8');

  get size(): number {
    return this.routes.size;
  }

  /** Nombre de fichiers d'itinéraire indexés pour un chargement à la demande. */
  get indexed(): number {
    let n = 0;
    for (const l of this.lazy.values()) n += l.length;
    return n;
  }

  /** Vrai si un index des zones est en place : un identifiant inconnu est alors refusé au lieu du repli historique. */
  get strict(): boolean {
    return this.lazy.size > 0;
  }

  /** Itinéraires à la demande en mémoire (pour les tests et la supervision). */
  get lazyLoaded(): number {
    return this.loaded.size;
  }

  /** L'identifiant existe dans plusieurs zones indexées et aucune n'est précisée. */
  isAmbiguous(id: string, world?: string): boolean {
    if (world || this.get(id)) return false;
    return (this.lazy.get(baseRouteId(id))?.length ?? 0) > 1;
  }

  /**
   * Itinéraire `id`, lu à la demande s'il n'est pas chargé au démarrage. `world` (identifiant de zone)
   * désigne la zone quand plusieurs portent le même identifiant ; sans lui, seul un identifiant unique
   * est résolu. Renvoie undefined si l'itinéraire est inconnu ou ambigu.
   */
  async ensure(id: string, world?: string): Promise<RouteEntry | undefined> {
    if (!id) return undefined;
    const base = baseRouteId(id);
    const files = this.lazy.get(base) ?? [];
    const pick = world ? files.find((f) => f.world === world) : undefined;
    if (!pick) {
      // Zone non précisée, ou sans fichier indexé pour elle : itinéraires du démarrage d'abord.
      const eager = this.get(id);
      if (eager) return eager;
      if (world || files.length !== 1) return undefined;
    }
    const f = pick ?? (files[0] as LazyFile);
    const key = `${f.world}/${id}`;
    const hit = this.loaded.get(key);
    if (hit) {
      this.loaded.delete(key);
      this.loaded.set(key, hit);
      return hit;
    }
    const pending = this.loading.get(key);
    if (pending) return pending;
    const p = this.loadLazy(f, base, id, key).finally(() => this.loading.delete(key));
    this.loading.set(key, p);
    return p;
  }

  private async loadLazy(f: LazyFile, base: string, id: string, key: string): Promise<RouteEntry | undefined> {
    const baseKey = `${f.world}/${base}`;
    let b = this.loaded.get(baseKey);
    if (!b) {
      let data: unknown;
      try {
        data = JSON.parse(await this.readFileImpl(f.file));
      } catch {
        return undefined;
      }
      if (!isRouteData(data) || data.id !== base) return undefined;
      const track = new RouteTrack(data);
      b = { data, track, summary: summarize(data, track) };
      this.remember(baseKey, b);
    }
    if (id === base) return b;
    const r = derive(b, id);
    if (r) this.remember(key, r);
    return r;
  }

  private remember(key: string, r: RouteEntry): void {
    this.loaded.delete(key);
    this.loaded.set(key, r);
    while (this.loaded.size > MAX_LAZY) this.loaded.delete(this.loaded.keys().next().value as string);
  }

  /**
   * Indexe les fichiers `<racine>/<zone>/routes/*.json` sans analyser les points : l'identifiant est lu
   * dans les premiers octets (il ouvre le fichier), à défaut c'est le nom du fichier.
   */
  async indexWorlds(root: string, log: (m: string) => void = () => undefined): Promise<number> {
    let worlds: string[];
    try {
      worlds = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    } catch {
      log(`dossier des zones introuvable : ${root}`);
      return 0;
    }
    let n = 0;
    for (const world of worlds) {
      const dir = path.join(root, world, 'routes');
      let files: string[];
      try {
        files = (await readdir(dir)).filter((x) => x.endsWith('.json')).sort();
      } catch {
        continue;
      }
      for (const name of files) {
        const file = path.join(dir, name);
        // déjà chargé au démarrage par un dossier ordinaire : pas de seconde copie en mémoire
        if (this.eagerFiles.has(path.resolve(file))) continue;
        const id = (await headId(file)) ?? name.slice(0, -'.json'.length);
        const list = this.lazy.get(id);
        if (list) list.push({ world, file });
        else this.lazy.set(id, [{ world, file }]);
        n++;
      }
    }
    return n;
  }

  add(data: RouteData): void {
    const track = new RouteTrack(data);
    this.routes.set(data.id, { data, track, summary: summarize(data, track) });
  }

  has(id: string): boolean {
    return !!this.get(id);
  }

  get(id: string): RouteEntry | undefined {
    const hit = this.routes.get(id) ?? this.reversed.get(id);
    if (hit) return hit;
    const started = parseStartedRouteId(id);
    const fwd = started ? null : forwardRouteId(id);
    const base = started ? this.get(started.id) : fwd ? this.routes.get(fwd) : undefined;
    if (!base) return undefined;
    const r = buildDerived(base, id, started);
    if (!r) return undefined;
    this.reversed.set(id, r);
    // départs au choix : autant d'identifiants que de points du tracé, on n'en garde que les derniers
    if (this.reversed.size > MAX_BUILT) this.reversed.delete(this.reversed.keys().next().value as string);
    return r;
  }

  /** Itinéraire demandé, sinon le premier disponible (jamais indéfini). */
  resolve(id: string | undefined): { data: RouteData; track: RouteTrack; summary: RouteSummary } {
    const r = (id && this.get(id)) || this.routes.values().next().value;
    if (!r) throw new Error('Aucun itinéraire chargé');
    return r;
  }

  list(): Array<{ id: string; name: string; lengthM: number; elevationGainM: number; loop: boolean; segments: number }> {
    return [...this.routes.values()].map(({ data }) => ({
      id: data.id,
      name: data.name,
      lengthM: data.lengthM,
      elevationGainM: data.elevationGainM,
      loop: data.loop,
      segments: data.segments.length,
    }));
  }

  /**
   * Charge les *.json d'un ou plusieurs dossiers (`dir` : chemins séparés par des virgules, comme
   * ROUTES_DIR) ; ajoute la boucle procédurale si rien n'est chargé. Un identifiant déjà chargé
   * n'est pas remplacé par un fichier d'un dossier suivant.
   */
  static async load(dir: string | undefined, log: (m: string) => void = () => undefined): Promise<RouteStore> {
    const store = new RouteStore();
    const entries = (dir ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    for (const d of entries) {
      // Entrée « <racine>/*/routes » : indexée plus bas, une fois les dossiers ordinaires chargés.
      if (worldsRoot(d) !== undefined) continue;
      try {
        const files = (await readdir(d)).filter((f) => f.endsWith('.json')).sort();
        for (const f of files) {
          try {
            const data = JSON.parse(await readFile(path.join(d, f), 'utf8')) as RouteData;
            if (!isRouteData(data)) {
              log(`itinéraire ignoré (format) : ${f}`);
              continue;
            }
            if (store.routes.has(data.id)) {
              log(`itinéraire déjà chargé, ignoré : ${data.id} (${path.join(d, f)})`);
              continue;
            }
            store.add(data);
            store.eagerFiles.add(path.resolve(d, f));
          } catch (e) {
            log(`itinéraire illisible ${f} : ${(e as Error).message}`);
          }
        }
      } catch {
        log(`dossier d'itinéraires introuvable : ${d}`);
      }
    }
    // Entrées « <racine>/*/routes » : toutes les zones, indexées et lues à la demande (jamais toutes en mémoire).
    for (const d of entries) {
      const root = worldsRoot(d);
      if (root === undefined) continue;
      const n = await store.indexWorlds(root, log);
      log(`${n} itinéraire(s) indexé(s) pour un chargement à la demande : ${d}`);
    }
    if (store.size === 0) {
      log('aucun itinéraire : boucle procédurale de développement');
      store.add(proceduralLoop());
    } else {
      log(`${store.size} itinéraire(s) chargé(s) : ${[...store.routes.keys()].join(', ')}`);
    }
    return store;
  }
}

/** Racine des zones d'une entrée « racine / étoile / routes » de ROUTES_DIR ; undefined pour un dossier ordinaire. */
function worldsRoot(entry: string): string | undefined {
  const parts = entry.split(/[\\/]/).filter((x, i, a) => x !== '' || i === 0 || i < a.length - 1);
  const n = parts.length;
  if (n < 3 || parts[n - 1] !== 'routes' || parts[n - 2] !== '*') return undefined;
  return parts.slice(0, n - 2).join('/') || '/';
}

/** Identifiant de l'itinéraire d'origine d'un parcours inversé ou à départ choisi (l'identifiant lui-même sinon). */
function baseRouteId(id: string): string {
  const started = parseStartedRouteId(id);
  const from = started ? started.id : id;
  return forwardRouteId(from) ?? from;
}

/** Un pas de dérivation : `base` roulé dans l'autre sens, ou depuis un autre départ (`started`). */
function buildDerived(base: RouteEntry, id: string, started: ReturnType<typeof parseStartedRouteId>): RouteEntry | undefined {
  const data = started ? rotateRoute(base.data, started.startM) : reverseRoute(base.data);
  // départ invalide (aller simple, départ d'origine, distance qui ne tombe pas sur un point) : inconnu
  if (data.id !== id) return undefined;
  const track = new RouteTrack(data);
  return { data, track, summary: summarize(data, track) };
}

/** Parcours inversé ou à départ choisi `id`, construit depuis son itinéraire d'origine `base`. */
function derive(base: RouteEntry, id: string): RouteEntry | undefined {
  const started = parseStartedRouteId(id);
  if (!started) return buildDerived(base, id, null);
  // départ choisi sur le parcours inversé : on inverse d'abord
  const from = started.id === base.data.id ? base : buildDerived(base, started.id, null);
  return from ? buildDerived(from, id, started) : undefined;
}

/** Identifiant lu dans les premiers octets d'un fichier d'itinéraire (`{"id":"…"` ouvre le fichier), sans tout lire. */
async function headId(file: string): Promise<string | undefined> {
  let fh: Awaited<ReturnType<typeof open>> | undefined;
  try {
    fh = await open(file, 'r');
    const buf = Buffer.alloc(256);
    const { bytesRead } = await fh.read(buf, 0, 256, 0);
    const head = buf.toString('utf8', 0, bytesRead);
    const m = /^\s*\{\s*"id"\s*:\s*"([^"\\]{1,120})"/.exec(head);
    return m?.[1];
  } catch {
    return undefined;
  } finally {
    await fh?.close();
  }
}

function isRouteData(d: unknown): d is RouteData {
  const r = d as RouteData;
  return (
    !!r &&
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    typeof r.lengthM === 'number' &&
    Array.isArray(r.points) &&
    r.points.length >= 2 &&
    Array.isArray(r.segments)
  );
}

/** Résumé pour la carte : polyligne décimée tous les ~25 m (x, z, y à plat). */
export function summarize(data: RouteData, track: RouteTrack, stepM = 25): RouteSummary {
  const polyline: number[] = [];
  const n = Math.max(2, Math.ceil(track.length / stepM));
  for (let i = 0; i <= n; i++) {
    const d = Math.min((i / n) * track.length, track.length - 0.01);
    const s = track.sample(d);
    polyline.push(Math.round(s.x * 10) / 10, Math.round(s.z * 10) / 10, Math.round(s.y * 10) / 10);
  }
  return {
    id: data.id,
    name: data.name,
    loop: data.loop,
    lengthM: track.length,
    elevationGainM: data.elevationGainM,
    roadWidthM: data.roadWidthM || 6,
    segments: data.segments.map((s) => ({ id: s.id, kind: s.kind, name: s.name, startM: s.startM, endM: s.endM, avgGrade: s.avgGrade })),
    polyline,
  };
}

/**
 * Boucle procédurale déterministe (~10 km) : une côte de ~1,2 km à 5 % (KOM), un faux plat,
 * une descente et un sprint sur le plat. Sert quand aucun itinéraire n'est disponible.
 */
export function proceduralLoop(): RouteData {
  const points: RoutePoint[] = [];
  const steps = 2500;
  const raw: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < steps; i++) {
    const th = (i / steps) * Math.PI * 2;
    const r = 1550 + 220 * Math.sin(3 * th + 1) + 110 * Math.sin(5 * th + 0.4);
    raw.push({ x: Math.cos(th) * r, z: Math.sin(th) * r * 0.85 });
  }
  let d = 0;
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i]!;
    if (i > 0) d += Math.hypot(p.x - raw[i - 1]!.x, p.z - raw[i - 1]!.z);
    points.push({ x: p.x, y: 0, z: p.z, d });
  }
  const length = d + Math.hypot(raw[0]!.x - raw.at(-1)!.x, raw[0]!.z - raw.at(-1)!.z);
  // Profil : montée 3,0–4,2 km (5 %), redescente 6,0–7,5 km, reste vallonné doux.
  const profile = (x: number): number => {
    const climb = smooth((x - 3000) / 1200) * 60;
    const descent = smooth((x - 6000) / 1500) * 60;
    return 120 + climb - descent + 4 * Math.sin((x / length) * Math.PI * 8);
  };
  let gain = 0;
  for (let i = 0; i < points.length; i++) {
    points[i]!.y = profile(points[i]!.d);
    if (i > 0) gain += Math.max(0, points[i]!.y - points[i - 1]!.y);
  }
  return {
    id: FALLBACK_ROUTE_ID,
    name: 'Boucle de développement',
    nameEn: 'Development loop',
    loop: true,
    lengthM: length,
    elevationGainM: Math.round(gain),
    points,
    segments: [
      { id: 'dev-kom', kind: 'kom', name: 'Côte de développement', startM: 3000, endM: 4200, avgGrade: 5 },
      { id: 'dev-sprint', kind: 'sprint', name: 'Sprint de développement', startM: 8500, endM: 8800, avgGrade: 0 },
    ],
    roadWidthM: 6,
    attribution: ['Itinéraire procédural (aucune donnée géographique)'],
  };
}

function smooth(t: number): number {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
}
