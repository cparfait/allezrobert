/**
 * Auto-profilage du bâti d'un monde : histogrammes des attributs réels des bâtiments déjà dans les
 * tuiles (BD TOPO, OSM : nature, matériau des murs et du toit, niveaux, hauteur) et profil de style
 * suggéré (règles → archétypes de `packages/shared/src/styles/archetypes.json`).
 *
 * Le profil suggéré est un point de départ : il est relu, ajusté à la main (connaissance du lieu),
 * puis versionné dans `packages/shared/src/styles/worlds/<monde>.json`.
 *
 *   pnpm --filter @allezrobert/terrain style-profile --world montmartre [--out fichier.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimatedLevels, validateStyle, type StyleRule, type WorldStyle } from '@allezrobert/shared';

export interface ProfiledBuilding {
  kind: string;
  height: number;
  levels?: number;
  material?: string;
  roofMaterial?: string;
  source?: string;
}

export interface BuildingProfile {
  count: number;
  /** Bâtiments d'habitation ou d'activité (hors annexes et édifices) : ceux qui reçoivent un archétype. */
  housing: number;
  kind: Record<string, number>;
  material: Record<string, number>;
  roofMaterial: Record<string, number>;
  source: Record<string, number>;
  /** Niveaux (estimés depuis la hauteur si absents), par classe : 1–2, 3–4, 5–9, 10+. */
  levels: Record<string, number>;
  /** Croisement matériau des murs × classe de niveaux (bâtiments d'habitation). */
  materialByLevels: Record<string, Record<string, number>>;
  /** Médiane des niveaux des bâtiments d'habitation. */
  medianLevels: number;
}

/** Natures laissées au rendu historique (annexes, édifices religieux, ouvrages). */
export const SKIP_KINDS = ['shed', 'garage', 'garages', 'barn', 'greenhouse', 'roof', 'industrial', 'ruins', 'church', 'chapel', 'tower', 'castle'];

const levelClass = (l: number) => (l >= 10 ? '10+' : l >= 5 ? '5-9' : l >= 3 ? '3-4' : '1-2');

const inc = (h: Record<string, number>, k: string) => {
  h[k] = (h[k] ?? 0) + 1;
};

export function profileBuildings(buildings: ProfiledBuilding[]): BuildingProfile {
  const p: BuildingProfile = { count: 0, housing: 0, kind: {}, material: {}, roofMaterial: {}, source: {}, levels: {}, materialByLevels: {}, medianLevels: 0 };
  const housingLevels: number[] = [];
  for (const b of buildings) {
    p.count++;
    inc(p.kind, b.kind);
    inc(p.material, b.material ?? 'unknown');
    inc(p.roofMaterial, b.roofMaterial ?? 'unknown');
    inc(p.source, b.source ?? 'osm');
    const lv = estimatedLevels(b);
    const lc = levelClass(lv);
    inc(p.levels, lc);
    if (SKIP_KINDS.includes(b.kind)) continue;
    p.housing++;
    housingLevels.push(lv);
    inc((p.materialByLevels[b.material ?? 'unknown'] ??= {}), lc);
  }
  housingLevels.sort((a, b) => a - b);
  p.medianLevels = housingLevels.length ? housingLevels[Math.floor(housingLevels.length / 2)]! : 0;
  return p;
}

const share = (h: Record<string, number> | undefined, k: string, total: number) => (total ? (h?.[k] ?? 0) / total : 0);
const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Profil suggéré. Bâti urbain dense (médiane ≥ 4 niveaux) : moderne (béton, 10 niveaux et plus),
 * brique, pierre de taille haute → haussmannien, plâtre → faubourien, petites maisons de faubourg.
 * Bâti rural : meulière là où la pierre domine (Île-de-France), enduit sinon.
 */
export function suggestStyle(worldId: string, p: BuildingProfile): WorldStyle {
  const rules: StyleRule[] = [];
  const stone59 = p.materialByLevels.stone?.['5-9'] ?? 0;
  const unknown59 = p.materialByLevels.unknown?.['5-9'] ?? 0;
  if (p.medianLevels >= 4) {
    rules.push({ when: { material: ['concrete'] }, pick: { moderne: 1 } });
    rules.push({ when: { minLevels: 10 }, pick: { moderne: 1 } });
    rules.push({ when: { material: ['brick'] }, pick: { brique: 1 } });
    // Pierre et 5 niveaux ou plus : haussmannien, avec une part de faubourien (pierre enduite).
    rules.push({ when: { material: ['stone'], minLevels: 5 }, pick: { haussmann: 0.85, faubourien: 0.15 } });
    rules.push({ when: { material: ['stone'], minLevels: 3 }, pick: { faubourien: 0.7, haussmann: 0.3 } });
    // Matériau inconnu : même répartition que la pierre connue à hauteur égale, bornée.
    const hShare = Math.min(0.7, Math.max(0.3, stone59 / Math.max(1, stone59 + unknown59)));
    rules.push({ when: { minLevels: 5 }, pick: { haussmann: round2(hShare), faubourien: round2(1 - hShare) } });
    rules.push({ when: { minLevels: 3 }, pick: { faubourien: 1 } });
    rules.push({ when: {}, pick: { maison_faubourg: 1 } });
  } else {
    const stone = share(p.material, 'stone', p.count);
    rules.push({ when: { material: ['brick'] }, pick: { brique: 1 } });
    rules.push({ when: { material: ['concrete'] }, pick: { moderne: 1 } });
    rules.push({ when: { material: ['stone'] }, pick: { meuliere: 1 } });
    rules.push({ when: {}, pick: { enduit_idf: round2(1 - stone * 0.5), meuliere: round2(stone * 0.5) } });
  }
  return { world: worldId, skipKinds: SKIP_KINDS, rules };
}

/** Bâtiments des tuiles d'un monde construit (`apps/client/public/worlds/<id>/tiles/*.json`). */
export function readWorldBuildings(worldDir: string): ProfiledBuilding[] {
  const dir = path.join(worldDir, 'tiles');
  const out: ProfiledBuilding[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const tile = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as {
      buildings?: Array<{ kind: string; height: number; levels?: number; material?: string; roof?: { material?: string }; source?: string }>;
    };
    for (const b of tile.buildings ?? [])
      out.push({
        kind: b.kind,
        height: b.height,
        ...(b.levels !== undefined ? { levels: b.levels } : {}),
        ...(b.material ? { material: b.material } : {}),
        ...(b.roof?.material ? { roofMaterial: b.roof.material } : {}),
        ...(b.source ? { source: b.source } : {}),
      });
  }
  return out;
}

const pct = (h: Record<string, number>, total: number) =>
  Object.entries(h)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${((v / total) * 100).toFixed(1)} %`)
    .join(' · ');

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k: string) => {
    const i = process.argv.indexOf(k);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const id = arg('--world');
  if (!id) throw new Error('--world <id> attendu');
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../apps/client/public/worlds', id);
  const p = profileBuildings(readWorldBuildings(dir));
  console.log(`${id} : ${p.count} bâtiments, ${p.housing} hors annexes et édifices, médiane ${p.medianLevels} niveaux`);
  console.log(`  source      ${pct(p.source, p.count)}`);
  console.log(`  nature      ${pct(p.kind, p.count)}`);
  console.log(`  murs        ${pct(p.material, p.count)}`);
  console.log(`  toits       ${pct(p.roofMaterial, p.count)}`);
  console.log(`  niveaux     ${pct(p.levels, p.count)}`);
  for (const [m, h] of Object.entries(p.materialByLevels)) console.log(`  ${m.padEnd(10)}  ${pct(h, Object.values(h).reduce((s, v) => s + v, 0))}`);
  const style = suggestStyle(id, p);
  const errors = validateStyle(style);
  if (errors.length) throw new Error(errors.join('\n'));
  const json = JSON.stringify(style, null, 2);
  const out = arg('--out');
  if (out) {
    fs.writeFileSync(out, json + '\n');
    console.log(`profil suggéré → ${out}`);
  } else console.log(json);
}
