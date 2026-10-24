/**
 * Outil « constructeur de zone » : calculs purs (cadre, estimations, JSON de zone, lignes de menu).
 * Aucune entrée-sortie ici, pour pouvoir les tester ; le serveur local est dans zone-builder.ts.
 */
import { fromL93, toL93 } from './lambert93.ts';

export interface Rect {
  minE: number;
  minN: number;
  maxE: number;
  maxN: number;
}

export interface Frame {
  originL93: { x: number; y: number };
  corridorTiles: { txMin: number; txMax: number; tzMin: number; tzMax: number };
  /** Emprise réelle (alignée sur les tuiles de 1 km), Lambert-93. */
  bounds: Rect;
  tiles: number;
  widthKm: number;
  heightKm: number;
  /** Centre pour la carte de France (arrondi à 500 m). */
  center: { x: number; y: number };
}

export interface Estimate {
  tiles: number;
  minutes: number;
  cacheMo: number;
  warnings: string[];
}

export type Pt = { lon: number; lat: number } | string;

export interface TourDraft {
  routeId: string;
  nameFr: string;
  nameEn: string;
  /** Départ puis points de passage, dans l'ordre ; une chaîne est un nom de lieu OSM (non placé sur la carte). */
  points: Pt[];
  /** Champs du tour non gérés par l'outil (koms, climbNames, allowTracks), conservés tels quels. */
  extra?: Record<string, unknown>;
}

export interface ZoneDraft {
  id: string;
  nameFr: string;
  nameEn: string;
  /** Région affichée dans le menu (fr), ex. « Var · Estérel ». */
  regionFr: string;
  regionEn: string;
  /** Accroche du menu. */
  hintFr: string;
  hintEn: string;
  sea: boolean;
  orthoPx: number;
  rect: Rect;
  tours: TourDraft[];
}

const TILE_M = 1000;
/** Mesures du guide : ≈ 12 s et 35 Mo de cache par tuile enrichie. */
const SEC_PER_TILE = 12;
const MO_PER_TILE = 35;
export const MAX_TILES = 150;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Rectangle libre → origine au km, tuiles couvrantes. Le repère monde a z vers le sud (z = origine.y - N). */
export function frameFromRect(r: Rect): Frame {
  const ox = Math.round((r.minE + r.maxE) / 2 / TILE_M) * TILE_M;
  const oy = Math.round((r.minN + r.maxN) / 2 / TILE_M) * TILE_M;
  const txMin = Math.floor((r.minE - ox) / TILE_M);
  const txMax = Math.max(txMin, Math.ceil((r.maxE - ox) / TILE_M) - 1);
  const tzMin = Math.floor((oy - r.maxN) / TILE_M);
  const tzMax = Math.max(tzMin, Math.ceil((oy - r.minN) / TILE_M) - 1);
  const w = txMax - txMin + 1;
  const h = tzMax - tzMin + 1;
  const bounds = { minE: ox + txMin * TILE_M, maxE: ox + (txMax + 1) * TILE_M, maxN: oy - tzMin * TILE_M, minN: oy - (tzMax + 1) * TILE_M };
  return {
    originL93: { x: ox, y: oy },
    corridorTiles: { txMin, txMax, tzMin, tzMax },
    bounds,
    tiles: w * h,
    widthKm: w,
    heightKm: h,
    center: { x: Math.round((bounds.minE + bounds.maxE) / 2 / 500) * 500, y: Math.round((bounds.minN + bounds.maxN) / 2 / 500) * 500 },
  };
}

/** Emprise (Lambert-93) d'un monde déjà déclaré : origine + tuiles. */
export function rectFromWorld(originL93: { x: number; y: number }, t: Frame['corridorTiles']): Rect {
  return { minE: originL93.x + t.txMin * TILE_M, maxE: originL93.x + (t.txMax + 1) * TILE_M, maxN: originL93.y - t.tzMin * TILE_M, minN: originL93.y - (t.tzMax + 1) * TILE_M };
}

export function estimate(f: Frame, withOrtho: boolean): Estimate {
  const warnings: string[] = [];
  if (f.tiles > MAX_TILES) warnings.push(`${f.tiles} tuiles : au-delà de ${MAX_TILES}, la construction devient très longue`);
  if (f.tiles < 20) warnings.push('emprise très petite (moins de 20 tuiles)');
  const k = withOrtho ? 1 : 0.4;
  return { tiles: f.tiles, minutes: Math.round((f.tiles * SEC_PER_TILE * k) / 60), cacheMo: Math.round(f.tiles * MO_PER_TILE * (withOrtho ? 1 : 0.6)), warnings };
}

const r5 = (v: number) => Math.round(v * 1e5) / 1e5;
const rp = (p: Pt): Pt => (typeof p === 'string' ? p : { lon: r5(p.lon), lat: r5(p.lat) });
const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

export function validate(z: ZoneDraft, f?: Frame): string[] {
  const e: string[] = [];
  if (!SLUG.test(z.id)) e.push('identifiant : minuscules, chiffres et tirets (ex. ma-zone)');
  if (!z.nameFr.trim() || !z.nameEn.trim()) e.push('noms français et anglais requis');
  if (!z.regionFr.trim()) e.push('région requise');
  if (!(z.rect.maxE > z.rect.minE) || !(z.rect.maxN > z.rect.minN)) e.push('emprise non dessinée');
  if (!z.tours.length) e.push('au moins un tour');
  const ids = new Set<string>();
  for (const t of z.tours) {
    if (!SLUG.test(t.routeId)) e.push(`tour « ${t.routeId} » : identifiant invalide`);
    if (ids.has(t.routeId)) e.push(`tour « ${t.routeId} » en double`);
    ids.add(t.routeId);
    if (t.points.length < 2) e.push(`tour « ${t.routeId} » : départ et au moins un point de passage`);
    if (!t.nameFr.trim() || !t.nameEn.trim()) e.push(`tour « ${t.routeId} » : noms requis`);
    if (f) {
      for (const p of t.points) {
        if (typeof p === 'string') continue;
        const m = toL93(p.lon, p.lat);
        if (m.x < f.bounds.minE || m.x > f.bounds.maxE || m.y < f.bounds.minN || m.y > f.bounds.maxN) {
          e.push(`tour « ${t.routeId} » : un point est hors de l'emprise`);
          break;
        }
      }
    }
  }
  return e;
}

/**
 * Zone au format de `WORLDS` (JSON de `tools/terrain/zones/<id>.json`). `raw` : définition existante
 * dont on garde les champs que l'outil ne gère pas (horizon, enrich, champs des tours).
 */
export function zoneJson(z: ZoneDraft, f: Frame, raw?: Record<string, unknown>): Record<string, unknown> {
  const first = z.tours[0]?.points[0];
  const start = first && typeof first !== 'string' ? rp(first) : fromL93(f.center.x, f.center.y);
  const oldTours = new Map<string, Record<string, unknown>>();
  for (const t of (raw?.tours as Array<Record<string, unknown>> | undefined) ?? []) oldTours.set(String(t.routeId), t);
  const out: Record<string, unknown> = {
    ...(raw ?? {}),
    kind: 'open',
    id: z.id,
    name: z.nameFr,
    region: z.regionFr,
    originL93: f.originL93,
    corridorTiles: f.corridorTiles,
    start,
    orthoPx: z.orthoPx,
    horizon: raw?.horizon ?? { halfSizeM: 30000, resM: 100 },
  };
  if (z.sea) out.sea = true;
  else delete out.sea;
  out.tours = z.tours.map((t) => {
    const [s, ...via] = t.points;
    return { ...(oldTours.get(t.routeId) ?? {}), ...(t.extra ?? {}), routeId: t.routeId, routeName: t.nameFr, routeNameEn: t.nameEn, start: rp(s!), via: via.map(rp) };
  });
  return out;
}

/** Ligne de `WORLD_LIST` (apps/client/src/world/worlds.ts). */
export function genWorldLine(z: ZoneDraft): string {
  return `  { id: ${q(z.id)}, name: { fr: ${q(z.nameFr)}, en: ${q(z.nameEn)} }, hint: { fr: ${q(z.hintFr || z.regionFr)}, en: ${q(z.hintEn || z.regionEn || z.regionFr)} } },`;
}

/** Ligne de `ZONE_SPOTS` (apps/client/src/world/zoneMap.ts). */
export function genSpotLine(z: ZoneDraft, f: Frame): string {
  return `  { id: ${q(z.id)}, x: ${f.center.x}, y: ${f.center.y}, open: true, region: { fr: ${q(z.regionFr.split(' · ')[0]!)}, en: ${q((z.regionEn || z.regionFr).split(' · ')[0]!)} }, name: { fr: ${q(z.nameFr)}, en: ${q(z.nameEn)} } },`;
}

const hasId = (src: string, id: string) => src.includes(`{ id: '${id}',`) || src.includes(`{ id: "${id}",`);

/** Insère `text` avant la première ligne qui satisfait `anchor` après `from` ; null si introuvable. */
export function insertBefore(src: string, from: RegExp, anchor: RegExp, text: string): string | null {
  const m = from.exec(src);
  if (!m) return null;
  let offset = m.index;
  for (const line of src.slice(m.index).split('\n')) {
    if (anchor.test(line)) return src.slice(0, offset) + text + '\n' + src.slice(offset);
    offset += line.length + 1;
  }
  return null;
}

/**
 * `worlds.ts` : ajoute la ligne d'une zone nouvelle (avant les montées, sinon en fin de liste).
 * Une zone déjà listée est laissée telle quelle. Retourne null si rien à changer.
 */
export function upsertWorldLine(src: string, z: ZoneDraft): string | null {
  const nl = src.includes('\r\n') ? '\r\n' : '\n';
  const lf = src.replace(/\r\n/g, '\n');
  if (hasId(lf, z.id)) return null;
  const out = insertBefore(lf, /export const WORLD_LIST/, /^\s*\{ id: 'alpe-dhuez'|^\];/, genWorldLine(z));
  if (!out) throw new Error('worlds.ts : fin de WORLD_LIST introuvable');
  return nl === '\r\n' ? out.replace(/\n/g, '\r\n') : out;
}

/**
 * `zoneMap.ts` : ajoute la ligne d'une zone nouvelle ; pour une zone existante, ne met à jour que
 * le centre (x, y). Retourne null si rien à changer.
 */
export function upsertSpotLine(src: string, z: ZoneDraft, f: Frame): string | null {
  const nl = src.includes('\r\n') ? '\r\n' : '\n';
  const lf = src.replace(/\r\n/g, '\n');
  let out: string | null;
  if (hasId(lf, z.id)) {
    const re = new RegExp(`(\\{ id: '${z.id}', x: )\\d+(, y: )\\d+`);
    if (!re.test(lf)) throw new Error('zoneMap.ts : ligne de la zone illisible');
    out = lf.replace(re, `$1${f.center.x}$2${f.center.y}`);
    if (out === lf) return null;
  } else {
    out = insertBefore(lf, /export const ZONE_SPOTS/, /^\s*\{ id: 'alpe-dhuez'|^\];/, genSpotLine(z, f));
    if (!out) throw new Error('zoneMap.ts : fin de ZONE_SPOTS introuvable');
  }
  return nl === '\r\n' ? out.replace(/\n/g, '\r\n') : out;
}

/** Nom anglais et accroche déjà présents dans `worlds.ts` pour une zone existante. */
export function readWorldLine(src: string, id: string): { nameEn?: string; hintFr?: string; hintEn?: string } {
  const line = src.split(/\r?\n/).find((l) => l.includes(`{ id: '${id}',`));
  if (!line) return {};
  const nameEn = /name: \{ fr: (?:'(?:[^'\\]|\\.)*'|"[^"]*"), en: (?:'((?:[^'\\]|\\.)*)'|"([^"]*)")/.exec(line);
  const hint = /hint: \{ fr: (?:'((?:[^'\\]|\\.)*)'|"([^"]*)"), en: (?:'((?:[^'\\]|\\.)*)'|"([^"]*)")/.exec(line);
  const un = (a?: string, b?: string) => (a ?? b)?.replace(/\\'/g, "'");
  return { nameEn: un(nameEn?.[1], nameEn?.[2]), hintFr: un(hint?.[1], hint?.[2]), hintEn: un(hint?.[3], hint?.[4]) };
}
