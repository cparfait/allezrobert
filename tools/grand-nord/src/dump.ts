/** Mise au point : cotes du générateur reprises par le client (lands/grand-nord.ts et grand-nordSites.ts). */
import { ANNEAU, CAP, GLACIER, HARBOURS, LAKES, MASSIF, SPOTS, TOWNS, coastPoint } from './design.ts';

const r1 = (v: number) => Math.round(v * 10) / 10;
console.log('ANNEAU', JSON.stringify(ANNEAU));
console.log('CAP', JSON.stringify(CAP), 'GLACIER', JSON.stringify(GLACIER), 'MASSIF', JSON.stringify(MASSIF));
console.log('SPOTS', JSON.stringify(SPOTS));
console.log('phare', coastPoint(0.08, 120).map(Math.round));
for (const h of HARBOURS) console.log('port', h.id, r1(h.x), r1(h.z), 'dir', Math.round(h.dir * 1000) / 1000, h.halfLen, h.halfWid);
for (const t of TOWNS) console.log('ville', t.id, r1(t.x), r1(t.z), 'r', t.r, 'cap du large', Math.round(Math.atan2(t.z, t.x) * 100) / 100);
for (const l of LAKES) if (l.name) console.log('lac', l.id, l.name, l.x, l.z, l.rx, l.rz, l.rot);
