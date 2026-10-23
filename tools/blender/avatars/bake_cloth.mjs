/**
 * Plis de la tenue et grain de la peau (docs/AVATARS.md § 6) : cartes de normales en espace
 * tangent, faites maison (CC0), lues par rider/cloth.ts et rider/skin.ts.
 *
 *  - cloth_normal.webp : plis du maillot et du cuissard dans l'espace UV du corps MPFB, calculés
 *    en 3D sur la pose de conduite (pose de repos de rider.glb) à partir du squelette : ventre
 *    tassé, plis d'aisselle et de manche, pli de l'aine, tension du dos, poches, fermeture
 *    éclair, ourlets (bandes élastiques aux manches et aux cuisses) et coutures de la bande ;
 *  - knit_normal.webp : maille du tissu (mosaïque 256 px) ;
 *  - skin_detail.webp : pores et micro-ridules de la peau (mosaïque 512 px).
 *
 * Les plis sont une hauteur h(p) définie en 3D (pas de couture visible entre îlots UV) ; la
 * normale perturbée est exprimée dans le repère (∇u, ∇v) que three.js reconstruit à partir des
 * dérivées écran (perturbNormal2Arb), sans attribut de tangente. Ourlets et coutures : hauteur
 * calculée dans l'espace UV (distance à la frontière de zone), dérivée par différences finies.
 *
 * Usage (depuis tools/blender) : node avatars/bake_cloth.mjs [rider.glb] [dossier de sortie]
 * La conversion PNG → WebP passe par Python + Pillow (déjà requis par build_avatar.py).
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { deflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [input = '../../apps/client/public/models/avatar/rider.glb', outDir = '../../apps/client/public/models/avatar/'] = process.argv.slice(2);
const N = 2048;

// ---------------------------------------------------------------------------------------------
// Petits outils vectoriels et bruit
// ---------------------------------------------------------------------------------------------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => mul(a, 1 / (len(a) || 1));
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const sstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Fenêtre douce : 1 entre b et c, 0 avant a et après d. */
const win = (a, b, c, d, x) => sstep(a, b, x) * (1 - sstep(c, d, x));

function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
/** Bruit de valeur 3D lissé, ~[0, 1]. */
function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (i, j, k) => hash3(xi + i, yi + j, zi + k);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v), l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
const fbm = (p, f) => noise3(p[0] * f, p[1] * f, p[2] * f) * 0.65 + noise3(p[0] * f * 2.1 + 7, p[1] * f * 2.1, p[2] * f * 2.1) * 0.35;
/** Cloche de Gauss de demi-largeur w. */
const gauss = (x, w) => Math.exp(-(x / w) * (x / w));
/** Crête de pli : creux larges, crêtes plus marquées (tissu tassé). */
const ridge = (phase) => Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * phase), 1.6);

// ---------------------------------------------------------------------------------------------
// Lecture de l'avatar : corps (positions de repos en repère monde), squelette
// ---------------------------------------------------------------------------------------------
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(input);
const joint = {};
for (const n of doc.getRoot().listNodes()) {
  const m = n.getWorldMatrix();
  joint[n.getName()] = [m[12], m[13], m[14]];
}
const bodyNode = doc.getRoot().listNodes().find((n) => n.getMesh()?.getName().startsWith('rider_body'));
if (!bodyNode) throw new Error('corps introuvable');
// Maillage skinné quantifié : la quantification est reportée dans les matrices inverses de liaison.
// Au repos, joint·IBM est la même pour tous les os : on l'applique aux positions.
const skin = bodyNode.getSkin();
const j0 = skin.listJoints()[0];
const ibm = skin.getInverseBindMatrices().getElement(0, []);
const toWorld = mat4mul(j0.getWorldMatrix(), ibm);
function mat4mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
const xf = (p, w) => [0, 1, 2].map((r) => toWorld[r] * p[0] + toWorld[4 + r] * p[1] + toWorld[8 + r] * p[2] + toWorld[12 + r] * w);

const REGION = { skin: 1, jersey: 2, jersey_accent: 3, shorts: 4, sock: 5 };
const CLOTH = new Set([2, 3, 4]);

// ---------------------------------------------------------------------------------------------
// Rastérisation dans l'espace UV : zone, position, normale, gradients de u et v
// ---------------------------------------------------------------------------------------------
const region = new Uint8Array(N * N);
const P = new Float32Array(N * N * 3);
const Nn = new Float32Array(N * N * 3);
const GU = new Float32Array(N * N * 3);
const GV = new Float32Array(N * N * 3);
/** Taille d'un texel en mètres (ourlets). */
const TS = new Float32Array(N * N);

for (const prim of bodyNode.getMesh().listPrimitives()) {
  const reg = REGION[prim.getMaterial()?.getName() ?? ''] ?? 6;
  const pos = prim.getAttribute('POSITION');
  const nor = prim.getAttribute('NORMAL');
  const uvA = prim.getAttribute('TEXCOORD_0');
  const idx = prim.getIndices();
  const V = [], Nv = [], UV = [];
  for (let i = 0; i < pos.getCount(); i++) {
    V.push(xf(pos.getElement(i, []), 1));
    Nv.push(norm(xf(nor.getElement(i, []), 0)));
    UV.push(uvA.getElement(i, []));
  }
  for (let t = 0; t < idx.getCount(); t += 3) {
    const ia = idx.getScalar(t), ib = idx.getScalar(t + 1), ic = idx.getScalar(t + 2);
    const [p0, p1, p2] = [V[ia], V[ib], V[ic]];
    const [t0, t1, t2] = [UV[ia], UV[ib], UV[ic]];
    // Gradients de u et v sur le plan du triangle (base duale de dp/du, dp/dv).
    const e1 = sub(p1, p0), e2 = sub(p2, p0);
    const du1 = t1[0] - t0[0], du2 = t2[0] - t0[0], dv1 = t1[1] - t0[1], dv2 = t2[1] - t0[1];
    const g11 = dot(e1, e1), g12 = dot(e1, e2), g22 = dot(e2, e2);
    const det = g11 * g22 - g12 * g12;
    if (Math.abs(det) < 1e-14) continue;
    // ∇f = α e1 + β e2 avec ∇f·e1 = df1, ∇f·e2 = df2.
    const grad = (d1, d2) => {
      const a = (d1 * g22 - d2 * g12) / det, b = (d2 * g11 - d1 * g12) / det;
      return add(mul(e1, a), mul(e2, b));
    };
    const gu = grad(du1, du2), gv = grad(dv1, dv2);
    const uvArea = Math.abs(du1 * dv2 - du2 * dv1);
    const ts = Math.sqrt(len(cross(e1, e2)) / Math.max(uvArea, 1e-12)) / N;
    const A = [t0[0] * N, t0[1] * N], B = [t1[0] * N, t1[1] * N], C = [t2[0] * N, t2[1] * N];
    const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0]))), x1 = Math.min(N - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
    const y0 = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1]))), y1 = Math.min(N - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
    const d = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
    if (Math.abs(d) < 1e-9) continue;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const l1 = ((B[1] - C[1]) * (px - C[0]) + (C[0] - B[0]) * (py - C[1])) / d;
        const l2 = ((C[1] - A[1]) * (px - C[0]) + (A[0] - C[0]) * (py - C[1])) / d;
        const l3 = 1 - l1 - l2;
        if (l1 < -0.01 || l2 < -0.01 || l3 < -0.01) continue;
        const k = y * N + x;
        region[k] = reg;
        TS[k] = ts;
        const n = norm(add(add(mul(Nv[ia], l1), mul(Nv[ib], l2)), mul(Nv[ic], l3)));
        for (let c = 0; c < 3; c++) {
          P[k * 3 + c] = p0[c] * l1 + p1[c] * l2 + p2[c] * l3;
          Nn[k * 3 + c] = n[c];
          GU[k * 3 + c] = gu[c];
          GV[k * 3 + c] = gv[c];
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Plis en 3D (repère client : +x gauche, +y haut, +z avant ; pose de conduite)
// ---------------------------------------------------------------------------------------------
const J = (name) => joint[name] ?? (() => { throw new Error(`os ${name} absent`); })();
const pelvis = J('pelvis'), neck = J('neck_01'), spine3 = J('spine_03');
const spineAxis = norm(sub(neck, pelvis));
const X = [1, 0, 0];
/** Ventre : perpendiculaire à la colonne, vers l'avant et le bas. */
const belly = norm(cross(X, spineAxis));
const back = mul(belly, -1);

function torsoFolds(p, reg) {
  const r = sub(p, pelvis);
  const s = dot(r, spineAxis);
  const radial = sub(r, mul(spineAxis, s));
  const lat = p[0];
  const rn = norm(radial);
  const front = dot(rn, belly);
  let h = 0;
  // Ventre tassé par la flexion du buste : plis horizontaux en « sourire », irréguliers.
  {
    const mask = sstep(0.05, 0.55, front) * win(-0.02, 0.04, 0.2, 0.27, s);
    if (mask > 0) {
      const warp = 0.9 * (lat / 0.13) ** 2 + 0.55 * (fbm(p, 9) - 0.5);
      const amp = 0.0034 * (0.55 + 0.9 * fbm([p[0] + 3, p[1], p[2]], 14));
      h += mask * amp * ridge(s / 0.034 + warp);
    }
  }
  // Flancs : plis obliques qui montent vers le dos.
  {
    const side = Math.abs(lat);
    const mask = sstep(0.06, 0.12, side) * win(-0.4, 0, 0.5, 0.85, front) * win(0, 0.05, 0.22, 0.3, s);
    if (mask > 0) h += mask * 0.0022 * ridge((s + 0.35 * (front + 0.2) * 0.12) / 0.03 + 0.4 * fbm(p, 11));
  }
  // Dos tendu : deux longues lignes de tension en V depuis les omoplates (jersey seul).
  if (reg !== 4) {
    const mask = sstep(0.2, 0.6, dot(rn, back)) * win(0.12, 0.2, 0.36, 0.42, s);
    if (mask > 0) {
      const v = Math.abs(lat) - (s - 0.12) * 0.55;
      h += mask * 0.0012 * gauss(v - 0.02, 0.012);
    }
  }
  // Poches arrière : bord supérieur ourlé, trois poches légèrement gonflées, coutures verticales.
  if (reg !== 4) {
    const bk = dot(rn, back);
    const mask = sstep(0.35, 0.7, bk) * sstep(0.17, 0.12, Math.abs(lat));
    if (mask > 0) {
      const top = 0.15;
      const bulge = win(0.015, 0.05, top - 0.03, top - 0.004, s) * 0.0022 * (0.6 + 0.4 * Math.cos(Math.PI * (lat / 0.055)) ** 2);
      const edge = 0.0016 * gauss(s - top, 0.0035) - 0.0008 * gauss(s - top + 0.007, 0.0025);
      const seams = s < top ? -0.0012 * (gauss(Math.abs(lat) - 0.055, 0.0025)) * sstep(0.01, 0.03, s) : 0;
      h += mask * (bulge + edge + seams);
    }
  }
  // Fermeture éclair : bourrelet central, du col au bas du maillot.
  if (reg !== 4) {
    const mask = sstep(0.4, 0.7, front) * win(0.02, 0.04, 0.5, 0.55, s);
    if (mask > 0) h += mask * (0.0011 * gauss(lat, 0.0035) - 0.0006 * gauss(Math.abs(lat) - 0.006, 0.002));
  }
  return h;
}

/** Plis d'aisselle (bras tendus vers le guidon) et de manche. */
function armFolds(p, reg) {
  if (reg === 4) return 0;
  let h = 0;
  for (const side of ['l', 'r']) {
    const sh = J(`upperarm_${side}`), el = J(`lowerarm_${side}`);
    const ax = norm(sub(el, sh));
    const r = sub(p, sh);
    const s = dot(r, ax);
    const rad = sub(r, mul(ax, s));
    const dist = len(rad);
    if (dist > 0.12) continue;
    // Manche : plis en anneaux tassés côté intérieur et dessous du bras, près de l'aisselle.
    const inner = norm([-sh[0], -0.6, 0]);
    const innerness = dot(norm(rad), inner);
    {
      const mask = win(-0.02, 0.02, 0.1, 0.16, s) * sstep(-0.3, 0.5, innerness);
      if (mask > 0) h += mask * 0.0026 * ridge(s / 0.024 + 0.3 * (fbm(p, 16) - 0.5) + 0.25 * innerness);
    }
    // Aisselle avant : plis rayonnants vers le sternum.
    {
      const pit = add(sh, [-Math.sign(sh[0]) * 0.03, -0.05, 0.02]);
      const d = sub(p, pit);
      const rr = len(d);
      const mask = win(0.015, 0.035, 0.09, 0.14, rr) * sstep(0.1, 0.5, dot(norm(sub(p, pelvis)), belly) + 0.3) * (s < 0.02 ? 1 : sstep(0.06, 0.02, s));
      if (mask > 0) {
        const ang = Math.atan2(d[1], d[2] * Math.sign(sh[0]));
        h += mask * 0.0024 * ridge(ang * 2.1 + 0.4 * fbm(p, 12)) * sstep(0.14, 0.04, rr);
      }
    }
  }
  return h;
}

/** Cuissard : pli de l'aine (buste penché sur les cuisses) et léger froissé le long de la cuisse. */
function hipFolds(p, reg) {
  if (reg !== 4 && reg !== 2) return 0;
  let h = 0;
  for (const side of ['l', 'r']) {
    const hip = J(`thigh_${side}`), knee = J(`calf_${side}`);
    const thighAx = norm(sub(knee, hip));
    // Bissectrice avant entre la cuisse et le buste : là où le tissu se tasse.
    const bis = norm(add(thighAx, spineAxis));
    const r = sub(p, hip);
    const lat = Math.abs(p[0] - hip[0]);
    const rr = Math.hypot(r[1], r[2]);
    const frontness = dot(norm([0, r[1], r[2]]), bis);
    const ang = Math.atan2(r[1], r[2]);
    {
      const mask = sstep(0.55, 0.9, frontness) * win(0.05, 0.08, 0.16, 0.2, rr) * sstep(0.11, 0.05, lat) * (reg === 4 ? 1 : 0.6);
      if (mask > 0) h += mask * 0.0032 * ridge((ang * rr) / 0.026 + 0.5 * (fbm(p, 10) - 0.5) + 2.2 * (p[0] - hip[0]) ** 2 / 0.01);
    }
    // Cuisse : petites ondulations transverses (tissu tenu par la bande élastique).
    if (reg === 4) {
      const s = dot(r, thighAx);
      const mask = win(0.08, 0.14, 0.26, 0.3, s) * sstep(0.12, 0.06, Math.hypot(...sub(r, mul(thighAx, s))));
      if (mask > 0) h += mask * 0.0009 * ridge(s / 0.03 + 0.6 * fbm(p, 15));
    }
  }
  return h;
}

/** Ondulations lâches du tissu (le maillot n'est pas peint sur la peau). */
const drape = (p, reg) => (reg === 4 ? 0.00035 : 0.0007) * (fbm(p, 22) - 0.5);

const heightAt = (p, reg) => torsoFolds(p, reg) + armFolds(p, reg) + hipFolds(p, reg) + drape(p, reg);

// ---------------------------------------------------------------------------------------------
// Ourlets et coutures (espace UV) : distance en mètres à la frontière d'une autre zone
// ---------------------------------------------------------------------------------------------
/** Distance (texels) à un texel couvert d'une autre zone : peau (ourlet) ou bande (couture). */
function borderDistance(isOther) {
  const D = new Float32Array(N * N).fill(1e9);
  const queue = new Int32Array(N * N);
  let qh = 0, qt = 0;
  for (let k = 0; k < N * N; k++) {
    if (!CLOTH.has(region[k])) continue;
    const x = k % N, y = (k / N) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
      if (isOther(region[k], region[yy * N + xx])) {
        D[k] = 0.5;
        queue[qt++] = k;
        break;
      }
    }
  }
  // Chamfer 3-4 approché : BFS avec pas 1 (bords) et √2 (diagonales), assez précis sur 30 texels.
  while (qh < qt) {
    const k = queue[qh++];
    const x = k % N, y = (k / N) | 0;
    if (D[k] > 40) continue;
    for (const [dx, dy, w] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [-1, 1, 1.414], [1, -1, 1.414], [-1, -1, 1.414]]) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
      const kk = yy * N + xx;
      if (region[kk] !== region[k]) continue;
      if (D[k] + w < D[kk]) {
        D[kk] = D[k] + w;
        queue[qt++] = kk;
        if (qt >= queue.length) qt = queue.length - 1;
      }
    }
  }
  return D;
}
const toSkin = borderDistance((a, b) => b === REGION.skin || b === REGION.sock);
const toBand = borderDistance((a, b) => CLOTH.has(b) && b !== a && (a === REGION.jersey_accent || b === REGION.jersey_accent));
const toShorts = borderDistance((a, b) => (a === REGION.jersey && b === REGION.shorts) || (a === REGION.shorts && b === REGION.jersey));
const H2 = new Float32Array(N * N);
for (let k = 0; k < N * N; k++) {
  if (!CLOTH.has(region[k])) continue;
  const ts = TS[k];
  // Ourlet élastique : bande de 12 mm (cuissard 22 mm) légèrement surélevée, bord arrondi.
  const m = toSkin[k] * ts;
  const band = region[k] === REGION.shorts ? 0.022 : 0.012;
  let h = 0.0009 * sstep(0, 0.0025, m) * (1 - sstep(band - 0.002, band + 0.001, m)) - 0.0005 * gauss(m - band - 0.002, 0.0015);
  // Couture de la bande de couleur : petit sillon.
  h -= 0.0006 * gauss(toBand[k] * ts, 0.0012);
  // Taille du maillot sur le cuissard : léger bourrelet.
  h += 0.0007 * gauss(toShorts[k] * ts - 0.003, 0.003);
  H2[k] = h;
}

// ---------------------------------------------------------------------------------------------
// Normales en espace tangent
// ---------------------------------------------------------------------------------------------
const out = new Uint8Array(N * N * 3);
const EPS = 0.0008;
for (let k = 0; k < N * N; k++) {
  out[k * 3] = 128;
  out[k * 3 + 1] = 128;
  out[k * 3 + 2] = 255;
}
let covered = 0;
for (let k = 0; k < N * N; k++) {
  const reg = region[k];
  if (!CLOTH.has(reg)) continue;
  covered++;
  const p = [P[k * 3], P[k * 3 + 1], P[k * 3 + 2]];
  const n = [Nn[k * 3], Nn[k * 3 + 1], Nn[k * 3 + 2]];
  const gu = [GU[k * 3], GU[k * 3 + 1], GU[k * 3 + 2]];
  const gv = [GV[k * 3], GV[k * 3 + 1], GV[k * 3 + 2]];
  // Gradient 3D de la hauteur des plis (différences centrées), projeté sur la surface.
  const h0 = (dx, dy, dz) => heightAt([p[0] + dx, p[1] + dy, p[2] + dz], reg);
  let g = [(h0(EPS, 0, 0) - h0(-EPS, 0, 0)) / (2 * EPS), (h0(0, EPS, 0) - h0(0, -EPS, 0)) / (2 * EPS), (h0(0, 0, EPS) - h0(0, 0, -EPS)) / (2 * EPS)];
  // Ourlets : gradient UV (différences finies dans l'îlot) → ∇h = h_u ∇u + h_v ∇v.
  const x = k % N, y = (k / N) | 0;
  const at = (xx, yy) => {
    if (xx < 0 || yy < 0 || xx >= N || yy >= N) return null;
    const kk = yy * N + xx;
    return region[kk] === reg ? H2[kk] : null;
  };
  const hc = H2[k];
  const hx1 = at(x + 1, y), hx0 = at(x - 1, y), hy1 = at(x, y + 1), hy0 = at(x, y - 1);
  const hu = hx1 !== null && hx0 !== null ? (hx1 - hx0) / 2 : hx1 !== null ? hx1 - hc : hx0 !== null ? hc - hx0 : 0;
  const hv = hy1 !== null && hy0 !== null ? (hy1 - hy0) / 2 : hy1 !== null ? hy1 - hc : hy0 !== null ? hc - hy0 : 0;
  g = add(g, add(mul(gu, hu * N), mul(gv, hv * N)));
  const gs = sub(g, mul(n, dot(g, n)));
  const np = norm(sub(n, gs));
  // np = a·∇u + b·∇v + c·n ; three.js : normalize(T·x·s + B·y·s + N·z), T ∝ ∇u, B ∝ ∇v, s = 1/max(|T|,|B|).
  const t = sub(np, mul(n, dot(np, n)));
  const g11 = dot(gu, gu), g12 = dot(gu, gv), g22 = dot(gv, gv);
  const det = g11 * g22 - g12 * g12;
  if (det <= 0) continue;
  const r1 = dot(t, gu), r2 = dot(t, gv);
  const a = (r1 * g22 - r2 * g12) / det, b = (r2 * g11 - r1 * g12) / det;
  const m = Math.sqrt(Math.max(g11, g22));
  let tx = a * m, ty = b * m, tz = dot(np, n);
  const l = Math.hypot(tx, ty, tz);
  tx /= l; ty /= l; tz /= l;
  out[k * 3] = Math.round((tx * 0.5 + 0.5) * 255);
  out[k * 3 + 1] = Math.round((ty * 0.5 + 0.5) * 255);
  out[k * 3 + 2] = Math.round((tz * 0.5 + 0.5) * 255);
}
// Débord de 4 texels hors des îlots (mipmaps sans liseré).
for (let it = 0; it < 4; it++) {
  const done = new Uint8Array(N * N);
  for (let k = 0; k < N * N; k++) done[k] = CLOTH.has(region[k]) || region[k] === 255 ? 1 : 0;
  for (let k = 0; k < N * N; k++) {
    if (done[k]) continue;
    const x = k % N, y = (k / N) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
      const kk = yy * N + xx;
      if (!done[kk] || region[kk] === 0 || region[kk] === REGION.skin) continue;
      out[k * 3] = out[kk * 3];
      out[k * 3 + 1] = out[kk * 3 + 1];
      out[k * 3 + 2] = out[kk * 3 + 2];
      region[k] = 255;
      break;
    }
  }
}
console.log(`tenue : ${covered} texels (${((100 * covered) / (N * N)).toFixed(1)} % de l'atlas)`);

// ---------------------------------------------------------------------------------------------
// Mosaïques : maille du tissu, pores de la peau
// ---------------------------------------------------------------------------------------------
/** Hauteur périodique (taille S) → normales, différences centrées avec bouclage. */
function tileNormals(S, hAt, strength) {
  const H = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) H[y * S + x] = hAt(x, y);
  const o = new Uint8Array(S * S * 3);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const hx = (H[y * S + ((x + 1) % S)] - H[y * S + ((x - 1 + S) % S)]) * strength;
      const hy = (H[((y + 1) % S) * S + x] - H[((y - 1 + S) % S) * S + x]) * strength;
      const l = Math.hypot(hx, hy, 1);
      const k = (y * S + x) * 3;
      o[k] = Math.round((-hx / l * 0.5 + 0.5) * 255);
      o[k + 1] = Math.round((-hy / l * 0.5 + 0.5) * 255);
      o[k + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
    }
  }
  return o;
}

// Maille jersey : colonnes de « V » (deux boucles inclinées par maille), 16 × 20 mailles.
const KS = 256;
const knit = tileNormals(KS, (x, y) => {
  const cols = 16, rows = 20;
  const u = (x / KS) * cols, v = (y / KS) * rows;
  const fu = u - Math.floor(u), fv = v - Math.floor(v);
  const loop = (cx, tilt) => {
    const dx = fu - cx, dy = fv - 0.5;
    const rx = dx * Math.cos(tilt) - dy * Math.sin(tilt), ry = dx * Math.sin(tilt) + dy * Math.cos(tilt);
    return Math.max(0, 1 - (rx / 0.2) ** 2 - (ry / 0.55) ** 2);
  };
  const h = Math.max(loop(0.27, 0.45), loop(0.73, -0.45));
  return Math.sqrt(h) + 0.15 * hash3(Math.floor(u), Math.floor(v), 3);
}, 1.6);

// Peau : pores (petits creux), fines ridules croisées, grain.
const SS = 512;
const poreH = new Float32Array(SS * SS);
{
  let seed = 11;
  const rnd = () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 4294967295;
  for (let i = 0; i < 5200; i++) {
    const cx = rnd() * SS, cy = rnd() * SS, r = 0.9 + rnd() * 1.6, dpt = 0.5 + rnd() * 0.5;
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = ((Math.floor(cx) + dx) % SS + SS) % SS, y = ((Math.floor(cy) + dy) % SS + SS) % SS;
        const d2 = ((Math.floor(cx) + dx + 0.5 - cx) ** 2 + (Math.floor(cy) + dy + 0.5 - cy) ** 2) / (r * r);
        poreH[y * SS + x] -= dpt * Math.exp(-d2 * 2);
      }
    }
  }
}
const skinTile = tileNormals(SS, (x, y) => {
  const u = (x / SS) * 2 * Math.PI, v = (y / SS) * 2 * Math.PI;
  // Ridules : deux familles de sillons fins et périodiques, modulées par un bruit périodique.
  const mod = 0.5 + 0.5 * Math.sin(3 * u + 2 * Math.sin(2 * v)) * Math.cos(2 * v + Math.sin(3 * u));
  const lines = -Math.pow(Math.abs(Math.sin(23 * u + 17 * v + 1.3 * Math.sin(5 * v))), 14) - Math.pow(Math.abs(Math.sin(19 * u - 21 * v + 1.1 * Math.sin(4 * u))), 14);
  return poreH[y * SS + x] * 0.55 + lines * 0.35 * mod + 0.12 * hash3(x, y, 9);
}, 0.9);

// ---------------------------------------------------------------------------------------------
// Écriture : PNG (zlib) puis WebP (Pillow)
// ---------------------------------------------------------------------------------------------
function png(w, h, rgb) {
  const crcTable = new Int32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  const crc = (buf) => {
    let c = -1;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (type, data) => {
    const t = Buffer.from(type, 'ascii');
    const l = Buffer.alloc(4);
    l.writeUInt32BE(data.length);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(Buffer.concat([t, data])));
    return Buffer.concat([l, t, data, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const tmp = mkdtempSync(join(tmpdir(), 'bake-cloth-'));
const files = [
  ['cloth_normal', N, out, 90],
  ['knit_normal', KS, knit, 92],
  ['skin_detail', SS, skinTile, 92],
];
for (const [name, size, data, q] of files) {
  const src = join(tmp, `${name}.png`);
  writeFileSync(src, png(size, size, data));
  const dst = resolve(outDir, `${name}.webp`);
  const r = spawnSync('python', ['-c', `from PIL import Image; Image.open(r'${src}').save(r'${dst}', quality=${q}, method=6)`], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`conversion WebP de ${name} impossible (Python + Pillow requis)`);
  console.log(`${name}.webp`);
}
rmSync(tmp, { recursive: true, force: true });
