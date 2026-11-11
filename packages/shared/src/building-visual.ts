/** Contrat visuel séparé des tuiles et manifestes physiques. */
/** Version la plus récente des compléments de tuile. Le producteur écrit la plus basse qui suffit. */
export const BUILDING_VISUAL_SCHEMA = 3;
export const BUILDING_VISUAL_INDEX = 'buildings-visual.json';
/** L'index garde le format de la v1. */
export const BUILDING_VISUAL_INDEX_SCHEMA = 1;

export interface BuildingSourceTile {
  worldId: string;
  tileId: string;
}

export interface VisualProvenance { dataset: string; reference: string; observedOn: string; method: string }

/** v1 : toit symétrique du générateur, pente et cotes recalées. */
export interface RoofVisualCorrection {
  buildingId: string;
  kind: 'roof';
  /** Altitudes absolues IGN69 en mètres, pente en degrés. */
  eaveM: number;
  ridgeM: number;
  pitchDeg: number;
  confidence: 'medium' | 'high';
  provenance: VisualProvenance;
}

/**
 * v2 : deux pans plans de part et d'autre d'une ligne de faîtage libre (faîtage décentré, pentes inégales).
 * `ridge` = [x1, z1, x2, z2] en mètres, relatif au premier sommet de l'emprise (`pts[0]`, `pts[1]`) :
 * la correction suit le bâtiment quand un monde composite translate la tuile. Pan gauche : côté où
 * (x2 − x1)(z − z1) − (z2 − z1)(x − x1) < 0, c'est-à-dire à gauche en allant du point 1 au point 2 sur
 * une carte nord en haut (x vers l'est, z vers le sud). Faîtage horizontal à `ridgeM` (IGN69) ; l'égout
 * de chaque mur se déduit de sa distance à la ligne et de la pente du pan.
 */
export interface GableVisualCorrection {
  buildingId: string;
  kind: 'gable';
  ridgeM: number;
  ridge: [number, number, number, number];
  pitchLeftDeg: number;
  pitchRightDeg: number;
  confidence: 'medium' | 'high';
  provenance: VisualProvenance;
}

/** Toit d'un volume v3 : deux pans à faîtage libre (mêmes règles que la v2) ou toit plat. */
/**
 * Toit d'un volume v3 : deux pans à faîtage libre (mêmes règles que la v2), monopente ou plat.
 * Monopente : plan passant par `through` (relatif au premier sommet de l'emprise) à l'altitude `topM`,
 * descendant de `pitchDeg` dans la direction unitaire `down` (repère tuile, x vers l'est, z vers le sud).
 */
export type VolumeRoof =
  | { type: 'gable'; ridgeM: number; ridge: [number, number, number, number]; pitchLeftDeg: number; pitchRightDeg: number }
  | { type: 'shed'; topM: number; through: [number, number]; down: [number, number]; pitchDeg: number }
  | { type: 'flat'; topM: number };

/** Sous-emprise d'un volume : `pts` et `ridge` relatifs au premier sommet de l'emprise du bâtiment. */
export interface VolumePart {
  pts: number[];
  roof: VolumeRoof;
}

/**
 * v3 : bâtiment fait de plusieurs volumes de hauteurs et de toits différents. Les sous-emprises partagent
 * l'emprise du bâtiment : chacune est simple, d'au moins 1 m², dans la boîte de l'emprise élargie de 0,5 m,
 * avec son centre dans l'emprise ; la somme de leurs aires vaut celle de l'emprise à 3 % près. L'emprise de
 * base (et donc la collision) ne change pas : seule la géométrie visuelle est découpée.
 */
export interface VolumesVisualCorrection {
  buildingId: string;
  kind: 'volumes';
  parts: VolumePart[];
  confidence: 'medium' | 'high';
  provenance: VisualProvenance;
}

export type BuildingVisualCorrection = RoofVisualCorrection | GableVisualCorrection | VolumesVisualCorrection;

export interface BuildingVisualTile extends BuildingSourceTile {
  schemaVersion: 1 | 2 | 3;
  /** SHA-256 des octets UTF-8 du JSON de la tuile de base. */
  sourceTileSha256: string;
  corrections: BuildingVisualCorrection[];
}

export interface BuildingVisualIndex {
  schemaVersion: typeof BUILDING_VISUAL_INDEX_SCHEMA;
  worldId: string;
  /** ID de tuile → SHA-256 des octets du complément. */
  tiles: Record<string, string>;
}

const tileIdPattern = /^-?\d+_-?\d+$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
/** Longueur minimale du faîtage et marge autour de la boîte de l'emprise (m). */
const RIDGE_MIN_M = 1;
const RIDGE_MARGIN_M = 1;
const GABLE_PITCH_MAX = 60;
const PARTS_MAX = 12;
const PART_MIN_AREA = 1;
const PART_MARGIN_M = 0.5;
const PARTS_AREA_TOLERANCE = 0.03;

export function buildingVisualTileFile(tileId: string): string {
  if (!tileIdPattern.test(tileId)) throw new Error('Identifiant de tuile visuelle invalide');
  return `${tileId}.buildings-visual.json`;
}

export function isBuildingVisualFile(file: string): boolean {
  return file === BUILDING_VISUAL_INDEX || /^-?\d+_-?\d+\.buildings-visual\.json$/.test(file);
}

/** Version minimale d'un complément : 1 tant qu'il ne contient que des corrections v1, lisibles par les anciens clients. */
export function buildingVisualTileSchema(corrections: readonly BuildingVisualCorrection[]): 1 | 2 | 3 {
  return corrections.some((c) => c.kind === 'volumes') ? 3 : corrections.some((c) => c.kind === 'gable') ? 2 : 1;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && sha256Pattern.test(value);
}

function date(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function provenance(p: unknown): VisualProvenance | undefined {
  if (!record(p) || !text(p.dataset) || !text(p.reference) || !text(p.observedOn) || !date(p.observedOn) || !text(p.method)) return;
  return { dataset: p.dataset, reference: p.reference, observedOn: p.observedOn, method: p.method };
}

/**
 * Les extrémités du faîtage, ramenées au repère de l'emprise (origine : premier sommet de `origin`, par
 * défaut celui de `pts`), tombent dans la boîte de `pts` élargie de 1 m.
 */
function ridgeFits(ridge: readonly number[], pts: readonly number[] | undefined, origin: readonly number[] | undefined = pts): boolean {
  if (!pts || pts.length < 6 || pts.length % 2 || !pts.every(finite) || !origin) return false;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]!); x1 = Math.max(x1, pts[i]!);
    z0 = Math.min(z0, pts[i + 1]!); z1 = Math.max(z1, pts[i + 1]!);
  }
  for (let i = 0; i < 4; i += 2) {
    const x = origin[0]! + ridge[i]!, z = origin[1]! + ridge[i + 1]!;
    if (x < x0 - RIDGE_MARGIN_M || x > x1 + RIDGE_MARGIN_M || z < z0 - RIDGE_MARGIN_M || z > z1 + RIDGE_MARGIN_M) return false;
  }
  return Math.hypot(ridge[2]! - ridge[0]!, ridge[3]! - ridge[1]!) >= RIDGE_MIN_M;
}

function pitch(value: unknown): value is number {
  return finite(value) && value > 0 && value <= GABLE_PITCH_MAX;
}

function polyArea(p: readonly number[]): number {
  let a = 0;
  for (let i = 0, n = p.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    a += p[i * 2]! * p[j * 2 + 1]! - p[j * 2]! * p[i * 2 + 1]!;
  }
  return Math.abs(a) / 2;
}

function insidePoly(x: number, z: number, p: readonly number[]): boolean {
  let c = false;
  for (let i = 0, n = p.length / 2, j = n - 1; i < n; j = i++) {
    const xi = p[i * 2]!, zi = p[i * 2 + 1]!, xj = p[j * 2]!, zj = p[j * 2 + 1]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** Polygone simple : deux arêtes non voisines ne se coupent pas. */
function simple(p: readonly number[]): boolean {
  const n = p.length / 2;
  const cross = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) => (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const [a, b, c, d] = [i, (i + 1) % n, j, (j + 1) % n].map((k) => [p[k * 2]!, p[k * 2 + 1]!] as const);
      const d1 = cross(...a!, ...b!, ...c!), d2 = cross(...a!, ...b!, ...d!);
      const d3 = cross(...c!, ...d!, ...a!), d4 = cross(...c!, ...d!, ...b!);
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return false;
    }
  }
  return true;
}

function gableRoofOf(r: Record<string, unknown>, part: readonly number[], origin: readonly number[]): VolumeRoof | undefined {
  const raw = r.ridge;
  if (!finite(r.ridgeM) || !Array.isArray(raw) || raw.length !== 4 || !raw.every(finite)) return;
  const ridge = raw as number[];
  if (!pitch(r.pitchLeftDeg) || !pitch(r.pitchRightDeg) || !ridgeFits(ridge, part, origin)) return;
  return { type: 'gable', ridgeM: r.ridgeM, ridge: [ridge[0]!, ridge[1]!, ridge[2]!, ridge[3]!], pitchLeftDeg: r.pitchLeftDeg, pitchRightDeg: r.pitchRightDeg };
}

/** Monopente : point d'appui dans la boîte du volume élargie de 1 m, direction unitaire à 1 % près. */
function shedRoofOf(r: Record<string, unknown>, part: readonly number[], origin: readonly number[]): VolumeRoof | undefined {
  const t = r.through, d = r.down;
  if (!finite(r.topM) || !pitch(r.pitchDeg) || !Array.isArray(t) || t.length !== 2 || !t.every(finite) || !Array.isArray(d) || d.length !== 2 || !d.every(finite)) return;
  const [tx, tz] = t as number[], [dx, dz] = d as number[];
  if (Math.abs(Math.hypot(dx!, dz!) - 1) > 0.01) return;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < part.length; i += 2) {
    x0 = Math.min(x0, part[i]!); x1 = Math.max(x1, part[i]!);
    z0 = Math.min(z0, part[i + 1]!); z1 = Math.max(z1, part[i + 1]!);
  }
  const x = origin[0]! + tx!, z = origin[1]! + tz!;
  if (x < x0 - RIDGE_MARGIN_M || x > x1 + RIDGE_MARGIN_M || z < z0 - RIDGE_MARGIN_M || z > z1 + RIDGE_MARGIN_M) return;
  return { type: 'shed', topM: r.topM, through: [tx!, tz!], down: [dx!, dz!], pitchDeg: r.pitchDeg };
}

/** Volumes v3 : sous-emprises (relatives au premier sommet de `pts`) qui partagent l'emprise du bâtiment. */
function volumeParts(raw: unknown, pts: readonly number[] | undefined): VolumePart[] | undefined {
  if (!pts || pts.length < 6 || pts.length % 2 || !pts.every(finite) || !Array.isArray(raw) || raw.length < 1 || raw.length > PARTS_MAX) return;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]!); x1 = Math.max(x1, pts[i]!);
    z0 = Math.min(z0, pts[i + 1]!); z1 = Math.max(z1, pts[i + 1]!);
  }
  const origin = [pts[0]!, pts[1]!];
  const parts: VolumePart[] = [];
  let sum = 0;
  for (const item of raw as unknown[]) {
    if (!record(item) || !Array.isArray(item.pts) || item.pts.length < 6 || item.pts.length % 2 || !item.pts.every(finite) || !record(item.roof)) return;
    const rel = item.pts as number[];
    const abs = rel.map((v, i) => v + origin[i % 2]!);
    for (let i = 0; i < abs.length; i += 2) {
      if (abs[i]! < x0 - PART_MARGIN_M || abs[i]! > x1 + PART_MARGIN_M || abs[i + 1]! < z0 - PART_MARGIN_M || abs[i + 1]! > z1 + PART_MARGIN_M) return;
    }
    const a = polyArea(abs);
    if (a < PART_MIN_AREA || !simple(abs)) return;
    let cx = 0, cz = 0;
    for (let i = 0; i < abs.length; i += 2) { cx += abs[i]!; cz += abs[i + 1]!; }
    if (!insidePoly(cx / (abs.length / 2), cz / (abs.length / 2), pts)) return;
    const r = item.roof;
    const roof = r.type === 'gable' ? gableRoofOf(r, abs, origin) : r.type === 'shed' ? shedRoofOf(r, abs, origin)
      : r.type === 'flat' && finite(r.topM) ? { type: 'flat' as const, topM: r.topM } : undefined;
    if (!roof) return;
    parts.push({ pts: [...rel], roof });
    sum += a;
  }
  const total = polyArea(pts);
  if (Math.abs(sum - total) > PARTS_AREA_TOLERANCE * total) return;
  return parts;
}

export function parseBuildingVisualIndex(value: unknown, worldId: string): BuildingVisualIndex | undefined {
  if (!text(worldId) || !record(value) || value.schemaVersion !== BUILDING_VISUAL_INDEX_SCHEMA || value.worldId !== worldId || !record(value.tiles)) return;
  const tiles: Record<string, string> = {};
  for (const [id, digest] of Object.entries(value.tiles)) {
    if (!tileIdPattern.test(id) || !isSha256(digest)) return;
    tiles[id] = digest;
  }
  return { schemaVersion: BUILDING_VISUAL_INDEX_SCHEMA, worldId, tiles };
}

/** Un ID absent ou ambigu dans la tuile ne permet pas une correction. Un complément invalide est ignoré en entier. */
export function parseBuildingVisualTile(
  value: unknown,
  source: BuildingSourceTile,
  sourceTileSha256: string,
  buildings: readonly { id?: string; pts?: readonly number[] }[],
): BuildingVisualTile | undefined {
  if (!text(source.worldId) || !record(value) || (value.schemaVersion !== 1 && value.schemaVersion !== 2 && value.schemaVersion !== 3) || value.worldId !== source.worldId ||
      value.tileId !== source.tileId || !tileIdPattern.test(source.tileId) ||
      !isSha256(value.sourceTileSha256) || value.sourceTileSha256 !== sourceTileSha256 || !Array.isArray(value.corrections)) return;
  const schemaVersion = value.schemaVersion;
  const counts = new Map<string, number>();
  const footprints = new Map<string, readonly number[] | undefined>();
  for (const { id, pts } of buildings) {
    if (id === undefined) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
    footprints.set(id, pts);
  }
  const seen = new Set<string>();
  const corrections: BuildingVisualCorrection[] = [];
  for (const entry of value.corrections as unknown[]) {
    if (!record(entry) || !text(entry.buildingId) || counts.get(entry.buildingId) !== 1 || seen.has(entry.buildingId) ||
        (entry.confidence !== 'medium' && entry.confidence !== 'high')) return;
    const p = provenance(entry.provenance);
    if (!p) return;
    if (entry.kind === 'roof') {
      if (!finite(entry.eaveM) || !finite(entry.ridgeM) || entry.ridgeM < entry.eaveM ||
          !finite(entry.pitchDeg) || entry.pitchDeg < 0 || entry.pitchDeg >= 90) return;
      corrections.push({
        buildingId: entry.buildingId, kind: 'roof', eaveM: entry.eaveM, ridgeM: entry.ridgeM, pitchDeg: entry.pitchDeg,
        confidence: entry.confidence, provenance: p,
      });
    } else if (entry.kind === 'volumes' && schemaVersion === 3) {
      const parts = volumeParts(entry.parts, footprints.get(entry.buildingId));
      if (!parts) return;
      corrections.push({ buildingId: entry.buildingId, kind: 'volumes', parts, confidence: entry.confidence, provenance: p });
    } else if (entry.kind === 'gable' && schemaVersion >= 2) {
      const raw = entry.ridge;
      if (!finite(entry.ridgeM) || !Array.isArray(raw) || raw.length !== 4 || !raw.every(finite)) return;
      const r = raw as number[];
      if (!pitch(entry.pitchLeftDeg) || !pitch(entry.pitchRightDeg) || !ridgeFits(r, footprints.get(entry.buildingId))) return;
      corrections.push({
        buildingId: entry.buildingId, kind: 'gable', ridgeM: entry.ridgeM, ridge: [r[0]!, r[1]!, r[2]!, r[3]!],
        pitchLeftDeg: entry.pitchLeftDeg, pitchRightDeg: entry.pitchRightDeg, confidence: entry.confidence, provenance: p,
      });
    } else return;
    seen.add(entry.buildingId);
  }
  // Un complément v2 sans pignon aurait dû être écrit en v1, lisible par les anciens clients.
  if (schemaVersion !== buildingVisualTileSchema(corrections)) return;
  return { schemaVersion, ...source, sourceTileSha256, corrections };
}
