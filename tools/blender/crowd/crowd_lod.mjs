// Version allégée des spectateurs (public réaliste, apps/client/public/models/crowd) : une seconde liste de triangles
// (≈ RATIO des triangles) qui ne référence que des sommets d'origine. Elle partage donc positions, UV, texture
// d'animation (VAT, indexée par numéro de sommet), masque et matériau avec le personnage complet : seul l'index
// change, sans nuanceur de plus. Lue par crowdRealistic.ts (`lodIndex`), affichée par crowd.ts au loin.
//
// À relancer après chaque cuisson (bake_mpfb_spectators.py réécrit le .bin sans cette liste) :
//   node tools/blender/crowd/crowd_lod.mjs [--ratio 0.25] mpfb_homme mpfb_femme …   (sans nom : ceux de index.json)
//
// Poses : la simplification se fait sur la pose de repos, mais avec en attributs les positions animées de quelques
// images (acclamation, applaudissements, pose tenue) ; sans elles, des triangles fusionnés au repos s'étiraient
// entre le bras levé et le buste (« ailes » sous les bras).
//
// Coutures : les sommets dédoublés aux coutures d'UV sont soudés par position avant la simplification (sinon les
// coutures, vues comme des bords, se déchiraient), puis chaque coin de triangle reprend celui de ses doublons dont
// les UV vont le mieux avec les deux autres coins.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MeshoptSimplifier } from 'meshoptimizer';

const DIR = resolve(import.meta.dirname, '../../../apps/client/public/models/crowd');
const argv = process.argv.slice(2);
const ri = argv.indexOf('--ratio');
const RATIO = ri >= 0 ? Number(argv.splice(ri, 2)[1]) : 0.25;
const names = argv.length ? argv : JSON.parse(readFileSync(resolve(DIR, 'index.json'), 'utf8')).models;

await MeshoptSimplifier.ready;
MeshoptSimplifier.useExperimentalFeatures = true;
/** Poids des positions animées face à la position de repos. */
const POSE_WEIGHT = 1.5;

/** Demi-flottant (IEEE 754 binary16) → nombre. */
function half(h) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

for (const name of names) {
  const metaPath = resolve(DIR, `${name}.json`);
  const binPath = resolve(DIR, `${name}.bin`);
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  let buf = readFileSync(binPath);
  // Liste déjà présente (relance) : on la retire, elle est toujours en fin de fichier.
  if (meta.offsets.lodIndex !== undefined) buf = buf.subarray(0, meta.offsets.lodIndex);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const V = meta.vertexCount;
  const pos = new Float32Array(ab, meta.offsets.position, V * 3);
  const uv = new Float32Array(ab, meta.offsets.uv, V * 2);
  const index = new Uint32Array(ab, meta.offsets.index, meta.indexCount);
  // Images de la VAT retenues (lignes de positions) : quatre de chaque clip, plus la pose tenue.
  const vat = new Uint16Array(ab, meta.offsets.vat, V * meta.vatRows * 4);
  const rows = new Set([meta.hold]);
  for (const c of meta.clips) for (let k = 0; k < 4; k++) rows.add(c.row + Math.floor((k * c.frames) / 4));
  const poseRows = [...rows];
  const attrs = new Float32Array(V * poseRows.length * 3);
  poseRows.forEach((row, j) => {
    for (let v = 0; v < V; v++) for (let c = 0; c < 3; c++) attrs[(v * poseRows.length + j) * 3 + c] = half(vat[(row * V + v) * 4 + c]);
  });
  const weights = new Array(poseRows.length * 3).fill(POSE_WEIGHT);

  // Soudure par position (1/10 mm).
  const canon = new Uint32Array(V);
  const dups = new Map();
  const byKey = new Map();
  for (let v = 0; v < V; v++) {
    const key = `${Math.round(pos[v * 3] * 1e4)},${Math.round(pos[v * 3 + 1] * 1e4)},${Math.round(pos[v * 3 + 2] * 1e4)}`;
    let c = byKey.get(key);
    if (c === undefined) { byKey.set(key, (c = v)); dups.set(c, []); }
    canon[v] = c;
    dups.get(c).push(v);
  }
  const welded = Uint32Array.from(index, (v) => canon[v]);
  const target = Math.floor((meta.indexCount * RATIO) / 3) * 3;
  const [out, err] = MeshoptSimplifier.simplifyWithAttributes(welded, pos, 3, attrs, poseRows.length * 3, weights, null, target, 0.2, []);

  // Retour aux sommets d'origine : pour chaque triangle, combinaison de doublons aux UV les plus proches.
  const d2 = (a, b) => (uv[a * 2] - uv[b * 2]) ** 2 + (uv[a * 2 + 1] - uv[b * 2 + 1]) ** 2;
  const lod = new Uint32Array(out.length);
  let seams = 0;
  for (let t = 0; t < out.length; t += 3) {
    const A = dups.get(out[t]), B = dups.get(out[t + 1]), C = dups.get(out[t + 2]);
    let best = [A[0], B[0], C[0]];
    if (A.length > 1 || B.length > 1 || C.length > 1) {
      seams++;
      let bestS = Infinity;
      for (const a of A) for (const b of B) for (const c of C) {
        const s = d2(a, b) + d2(b, c) + d2(c, a);
        if (s < bestS) { bestS = s; best = [a, b, c]; }
      }
    }
    lod.set(best, t);
  }

  const offset = Math.ceil(buf.byteLength / 4) * 4;
  const outBuf = Buffer.alloc(offset + lod.byteLength);
  buf.copy(outBuf, 0);
  Buffer.from(lod.buffer).copy(outBuf, offset);
  writeFileSync(binPath, outBuf);
  meta.offsets.lodIndex = offset;
  meta.lodIndexCount = lod.length;
  meta.lodTris = lod.length / 3;
  meta.bytes = outBuf.byteLength;
  // Même mise en forme que la cuisson (json.dump, retrait d'une espace, fins de ligne Windows).
  writeFileSync(metaPath, JSON.stringify(meta, null, 1).replace(/\n/g, '\r\n'));
  console.log(`${name} : ${meta.tris} → ${meta.lodTris} triangles (erreur ${(err * 100).toFixed(2)} %, ${poseRows.length} poses, ${seams} triangles sur couture), ${outBuf.byteLength} octets`);
}
