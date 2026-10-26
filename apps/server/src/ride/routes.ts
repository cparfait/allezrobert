/**
 * Itinéraires disponibles côté serveur : fichiers RouteData produits par tools/terrain
 * (ROUTES_DIR, un ou plusieurs dossiers séparés par des virgules, ex. apps/client/public/worlds/chevreuse/routes), avec repli sur une boucle
 * procédurale de ~10 km si le dossier est absent ou vide (développement, tests).
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { forwardRouteId, parseStartedRouteId, reverseRoute, rotateRoute, RouteTrack, type RouteData, type RoutePoint, type RouteSummary } from '@allezrobert/shared';

export const FALLBACK_ROUTE_ID = 'dev-boucle';
/** Parcours construits à la demande (sens inverse, départ choisi) gardés en mémoire. */
const MAX_BUILT = 256;

export class RouteStore {
  private readonly routes = new Map<string, { data: RouteData; track: RouteTrack; summary: RouteSummary }>();
  /**
   * Parcours roulés dans l'autre sens (« <id>-inverse ») ou depuis un autre départ de la boucle
   * (« <id>[-inverse]-depart-<m> »), construits à la demande, hors liste.
   */
  private readonly reversed = new Map<string, { data: RouteData; track: RouteTrack; summary: RouteSummary }>();

  get size(): number {
    return this.routes.size;
  }

  add(data: RouteData): void {
    const track = new RouteTrack(data);
    this.routes.set(data.id, { data, track, summary: summarize(data, track) });
  }

  has(id: string): boolean {
    return !!this.get(id);
  }

  get(id: string): { data: RouteData; track: RouteTrack; summary: RouteSummary } | undefined {
    const hit = this.routes.get(id) ?? this.reversed.get(id);
    if (hit) return hit;
    const started = parseStartedRouteId(id);
    const fwd = started ? null : forwardRouteId(id);
    const base = started ? this.get(started.id) : fwd ? this.routes.get(fwd) : undefined;
    if (!base) return undefined;
    const data = started ? rotateRoute(base.data, started.startM) : reverseRoute(base.data);
    // départ invalide (aller simple, départ d'origine, distance qui ne tombe pas sur un point) : inconnu
    if (data.id !== id) return undefined;
    const track = new RouteTrack(data);
    const r = { data, track, summary: summarize(data, track) };
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
    for (const d of (dir ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
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
          } catch (e) {
            log(`itinéraire illisible ${f} : ${(e as Error).message}`);
          }
        }
      } catch {
        log(`dossier d'itinéraires introuvable : ${d}`);
      }
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
