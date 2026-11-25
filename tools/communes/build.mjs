/**
 * Communes françaises pour la ville du joueur (profil) : nom, codes postaux, centre. Une ligne par commune, les plus
 * peuplées d'abord : `nom;codes postaux séparés par des virgules;latitude;longitude`.
 *
 *   node tools/communes/build.mjs [communes.json]
 *
 * Source : API Découpage administratif (geo.api.gouv.fr), données INSEE et IGN, Licence Ouverte 2.0 (Etalab).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const URL_API = 'https://geo.api.gouv.fr/communes?fields=nom,code,codesPostaux,centre,population&format=json';
const OUT = resolve(import.meta.dirname, '../../apps/client/public/geo/communes-fr.txt');

const file = process.argv[2];
const list = file ? JSON.parse(readFileSync(file, 'utf8')) : await (await fetch(URL_API)).json();
const rows = list
  .filter((c) => c.nom && c.centre?.coordinates?.length === 2)
  .sort((a, b) => (b.population ?? 0) - (a.population ?? 0) || a.nom.localeCompare(b.nom, 'fr'))
  .map((c) => {
    const [lon, lat] = c.centre.coordinates;
    const codes = [...new Set(c.codesPostaux ?? [])].sort();
    return `${c.nom.replace(/[;\n]/g, ' ')};${(codes.length ? codes : [c.code]).join(',')};${lat.toFixed(3)};${lon.toFixed(3)}`;
  });
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${rows.join('\n')}\n`);
console.log(`${rows.length} communes → ${OUT}`);
