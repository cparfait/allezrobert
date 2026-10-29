/**
 * Chaussures de l'avatar MPFB (docs/AVATARS.md) : remplace les chaussures de rider*.glb par celles
 * de cyclist.glb (build_cyclist.py, build_shoes), posées sur les pédales (pédales inclinées de
 * REST_PITCH ; cyclist.glb est au repos à la manivelle 0, l'avatar a ses deux pieds à BIND_PHASE de
 * build_avatar.py : chaque chaussure suit le déplacement de sa pédale), et retire les faces du pied
 * cachées dans la chaussure (le pied MPFB ne traverse plus la tige, et le maillage s'allège).
 *
 *   - niveau 0 : chaussures de cyclist.glb ; niveaux 1 et 2 : celles de cyclist_lod1.glb ;
 *   - liées aux os foot_l / foot_r (rigides, comme sur cyclist.glb) ;
 *   - cibles d'identité (curseurs de corps) reportées depuis les 24 sommets du corps les plus
 *     proches, comme transfer_keys dans build_avatar.py ;
 *   - quantification et compression meshopt comme compress.mjs.
 *
 * Usage : pnpm --filter @allezrobert/blender-tools reshoe:avatar <dossier avatar> <dossier cyclist.glb>
 * (fichiers modifiés sur place ; plusieurs passages donnent le même résultat).
 */
import path from 'node:path';
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, quantize, reorder } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const [avatarDir, cyclistDir] = process.argv.slice(2);
if (!avatarDir || !cyclistDir) {
  console.error('usage : reshoe.mjs <dossier avatar> <dossier cyclist.glb>');
  process.exit(1);
}

// Cotes (repère client) — identiques à build_cyclist.py.
const BB_Y = 0.27;
const CRANK = 0.1725;
const PEDAL_X = 0.105;
const REST_PITCH = 0.35;
const ANKLE_FLAT = [0, 0.095, -0.13]; // cheville / axe de pédale, pied à plat (build_avatar.py)

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

// --- Petite algèbre (matrices 4 × 4 en colonnes, comme glTF).
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const xf = (m, v) => [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r]);
const xfDir = (m, v) => [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2]);
function invert(m) {
  // Inverse générale (cofacteurs).
  const inv = new Array(16);
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  const det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  return inv.map((x) => x / det);
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Repère de la pédale au repos (phase `a`, 0 : en bas) : centre, axes x, y (normal au plateau), z. */
function pedalFrame(side, a) {
  const c = Math.cos(REST_PITCH);
  const s = Math.sin(REST_PITCH);
  return { o: [PEDAL_X * side, BB_Y - Math.cos(a) * CRANK, -Math.sin(a) * CRANK], x: [1, 0, 0], y: [0, c, s], z: [0, -s, c] };
}

/** Phase de la pédale sous un pied au repos (position monde de l'os foot_*, cheville sur la pédale). */
function pedalPhase(skin, bone) {
  const j = skin.listJoints().find((n) => n.getName().toLowerCase() === bone); // foot_l (MPFB), foot_L (cyclist.glb)
  const m = j.getWorldMatrix();
  const c = Math.cos(REST_PITCH);
  const s = Math.sin(REST_PITCH);
  const py = m[13] - (ANKLE_FLAT[1] * c - ANKLE_FLAT[2] * s) - BB_Y;
  const pz = m[14] - (ANKLE_FLAT[1] * s + ANKLE_FLAT[2] * c);
  return Math.atan2(-pz, -py);
}

/** Sommets d'un nœud skinné en pose de repos (positions et normales monde, tous attributs lus). */
function restVertices(node) {
  const skin = node.getSkin();
  const joints = skin.listJoints();
  const ibm = skin.getInverseBindMatrices();
  const B = joints.map((j, i) => mul(j.getWorldMatrix(), ibm ? ibm.getElement(i, []) : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
  return node.getMesh().listPrimitives().map((prim) => {
    const P = prim.getAttribute('POSITION');
    const N = prim.getAttribute('NORMAL');
    const J = prim.getAttribute('JOINTS_0');
    const W = prim.getAttribute('WEIGHTS_0');
    const pos = [];
    const nrm = [];
    const bone = [];
    const v = [0, 0, 0];
    const j = [0, 0, 0, 0];
    const w = [0, 0, 0, 0];
    for (let i = 0; i < P.getCount(); i++) {
      J.getElement(i, j);
      W.getElement(i, w);
      const m = B[j[0]];
      pos.push(xf(m, P.getElement(i, v)));
      nrm.push(N ? norm(xfDir(m, N.getElement(i, v))) : [0, 1, 0]);
      bone.push(joints[j[w.indexOf(Math.max(...w))]].getName());
    }
    return { prim, pos, nrm, bone, B: B[0] };
  });
}

/** Triangles d'une primitive (indices). */
function triangles(prim) {
  const idx = prim.getIndices();
  const n = idx ? idx.getCount() : prim.getAttribute('POSITION').getCount();
  const out = [];
  for (let i = 0; i < n; i += 3) out.push(idx ? [idx.getScalar(i), idx.getScalar(i + 1), idx.getScalar(i + 2)] : [i, i + 1, i + 2]);
  return out;
}

/** Premier impact d'un rayon (Möller–Trumbore) : { t, n } ou null. */
function raycast(o, d, tris) {
  let best = null;
  for (const t of tris) {
    const e1 = sub(t[1], t[0]);
    const e2 = sub(t[2], t[0]);
    const p = cross(d, e2);
    const det = dot(e1, p);
    if (Math.abs(det) < 1e-12) continue;
    const s = sub(o, t[0]);
    const u = dot(s, p) / det;
    if (u < 0 || u > 1) continue;
    const q = cross(s, e1);
    const w = dot(d, q) / det;
    if (w < 0 || u + w > 1) continue;
    const dist = dot(e2, q) / det;
    if (dist > 1e-6 && (!best || dist < best.t)) best = { t: dist, n: cross(e1, e2) };
  }
  return best;
}

async function reshoe(file, shoeFile) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  const src = await io.read(shoeFile);
  const srcNode = src.getRoot().listNodes().find((n) => n.getName().startsWith('rider_shoes') && n.getMesh());
  const body = root.listNodes().find((n) => n.getName().startsWith('rider_body') && n.getMesh());
  if (!srcNode || !body) throw new Error(`${file} : corps ou chaussures de ${shoeFile} introuvables`);
  // Chaussures déjà posées (passage précédent) : remplacées ; sinon nouveau nœud à côté du corps.
  let node = root.listNodes().find((n) => n.getName().startsWith('rider_shoes') && n.getMesh());
  if (!node) {
    node = doc.createNode(srcNode.getName()).setMesh(doc.createMesh(srcNode.getName())).setSkin(body.getSkin());
    const parent = root.listNodes().find((n) => n.listChildren().includes(body));
    if (parent) parent.addChild(node);
    else root.listScenes()[0].addChild(node);
  }

  // --- Chaussures source (repère client, pose de repos), déplacées avec leur pédale jusqu'au pied
  // de l'avatar, et triangles de la tige et de la semelle.
  const phase = {};
  const shift = {};
  for (const [side, b] of [[1, 'foot_l'], [-1, 'foot_r']]) {
    phase[side] = pedalPhase(body.getSkin(), b);
    const from = pedalFrame(side, pedalPhase(srcNode.getSkin(), b)).o;
    shift[side] = sub(pedalFrame(side, phase[side]).o, from);
  }
  console.log(`${path.basename(file)} : pédales au repos à ${(phase[1] * 180 / Math.PI).toFixed(1)}° (gauche), ${(phase[-1] * 180 / Math.PI).toFixed(1)}° (droite)`);
  const parts = restVertices(srcNode);
  for (const { pos } of parts) pos.forEach((p, i) => (pos[i] = add(p, shift[p[0] > 0 ? 1 : -1])));
  const hull = { 1: [], [-1]: [] };
  for (const { prim, pos } of parts) {
    const mat = prim.getMaterial()?.getName();
    if (mat !== 'shoe' && mat !== 'shoe_sole') continue;
    for (const [a, b, c] of triangles(prim)) {
      const t = [pos[a], pos[b], pos[c]];
      hull[t[0][0] > 0 ? 1 : -1].push(t);
    }
  }

  // --- Corps : sommets au repos, cibles d'identité (écarts monde).
  const bodyParts = restVertices(body);
  const names = body.getMesh().getExtras().targetNames ?? [];
  const ident = names.map((n, i) => [n, i]).filter(([n]) => /[+-]$/.test(n));
  const bv = [];
  for (const { prim, pos, B } of bodyParts) {
    const targets = prim.listTargets();
    const d = [0, 0, 0];
    pos.forEach((p, i) => {
      if (Math.abs(p[1]) > 0.5 || Math.abs(p[0]) > 0.25) return; // pieds et bas des jambes seulement
      const deltas = ident.map(([, k]) => {
        const a = targets[k]?.getAttribute('POSITION');
        return a ? xfDir(B, a.getElement(i, d)) : [0, 0, 0];
      });
      bv.push({ p, deltas });
    });
  }

  // --- Faces du pied cachées dans la chaussure : sommet entouré par la tige (au moins 3 des
  // 4 rayons horizontaux du repère de la pédale touchent la face intérieure de la tige) ; devant
  // l'ouverture et au bas du pied, tout le pied (orteils MPFB plus larges que la chaussure).
  const hidden = (p, bone) => {
    const side = p[0] > 0 ? 1 : -1;
    const f = pedalFrame(side, phase[side]);
    const l = sub(p, f.o);
    const lx = dot(l, f.x) * side;
    const ly = dot(l, f.y);
    const lz = dot(l, f.z);
    if (/^(foot|ball)_/.test(bone) && (lz > -0.085 || ly < 0.07)) return true;
    if (ly > 0.13 || ly < 0 || lz < -0.22 || lz > 0.1 || Math.abs(lx) > 0.07) return false;
    let inside = 0;
    for (const d of [f.x, f.z, f.x.map((x) => -x), f.z.map((x) => -x)]) {
      const h = raycast(p, d, hull[side]);
      if (h && dot(h.n, d) > 0) inside++;
    }
    return inside >= 3;
  };
  let removed = 0;
  for (const { prim, pos, bone } of bodyParts) {
    const idx = prim.getIndices();
    const tris = triangles(prim);
    const hid = new Map();
    const isHidden = (i) => {
      if (!hid.has(i)) hid.set(i, hidden(pos[i], bone[i]));
      return hid.get(i);
    };
    const keep = tris.filter((t) => !(isHidden(t[0]) && isHidden(t[1]) && isHidden(t[2])));
    if (keep.length === tris.length) continue;
    removed += tris.length - keep.length;
    const arr = new (idx.getArray().constructor)(keep.length * 3);
    keep.forEach((t, k) => arr.set(t, k * 3));
    idx.setArray(arr);
  }

  // --- Nouvelles primitives : positions monde (os au repos ⇒ matrices inverses = inverse du monde).
  const oldSkin = node.getSkin();
  const joints = oldSkin.listJoints();
  const jl = joints.findIndex((j) => j.getName() === 'foot_l');
  const jr = joints.findIndex((j) => j.getName() === 'foot_r');
  const skin = doc.createSkin(oldSkin.getName()).setSkeleton(oldSkin.getSkeleton());
  const ibm = doc.createAccessor().setType('MAT4').setArray(new Float32Array(joints.flatMap((j) => invert(j.getWorldMatrix()))));
  for (const j of joints) skin.addJoint(j);
  skin.setInverseBindMatrices(ibm);
  const buffer = root.listBuffers()[0];
  const mesh = doc.createMesh(node.getMesh().getName());
  const mats = new Map(root.listMaterials().map((m) => [m.getName(), m]));
  // Cibles : écart moyen des 24 sommets du corps les plus proches.
  const K = 24;
  const allPos = parts.flatMap((p) => p.pos);
  const near = allPos.map((p) => {
    const best = [];
    for (const v of bv) {
      const d = (v.p[0] - p[0]) ** 2 + (v.p[1] - p[1]) ** 2 + (v.p[2] - p[2]) ** 2;
      if (best.length < K) best.push([d, v]);
      else if (d < best[K - 1][0]) best[K - 1] = [d, v];
      else continue;
      best.sort((a, b) => a[0] - b[0]);
    }
    return best.map(([, v]) => v);
  });
  const deltas = ident.map((_, t) => near.map((nb) => [0, 1, 2].map((c) => nb.reduce((s, v) => s + v.deltas[t][c], 0) / nb.length)));
  const keepT = ident.map((_, t) => deltas[t].some((d) => Math.abs(d[0]) + Math.abs(d[1]) + Math.abs(d[2]) > 1e-5));
  let base = 0;
  for (const { prim, pos, nrm } of parts) {
    const n = pos.length;
    const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
    const out = doc.createPrimitive();
    out.setAttribute('POSITION', acc('VEC3', new Float32Array(pos.flat())));
    out.setAttribute('NORMAL', acc('VEC3', new Float32Array(nrm.flat())));
    for (const uv of ['TEXCOORD_0', 'TEXCOORD_1']) {
      const a = prim.getAttribute(uv);
      if (a) out.setAttribute(uv, acc('VEC2', new Float32Array(a.getArray())));
    }
    const J = new Uint8Array(n * 4);
    const W = new Float32Array(n * 4);
    pos.forEach((p, i) => {
      J[i * 4] = p[0] > 0 ? jl : jr;
      W[i * 4] = 1;
    });
    out.setAttribute('JOINTS_0', acc('VEC4', J));
    out.setAttribute('WEIGHTS_0', acc('VEC4', W));
    out.setIndices(acc('SCALAR', new Uint32Array(triangles(prim).flat())));
    ident.forEach((_, t) => {
      if (!keepT[t]) return;
      const tg = doc.createPrimitiveTarget();
      tg.setAttribute('POSITION', acc('VEC3', new Float32Array(deltas[t].slice(base, base + n).flat())));
      out.addTarget(tg);
    });
    const sm = prim.getMaterial();
    let m = mats.get(sm.getName());
    if (!m) {
      m = doc.createMaterial(sm.getName()).setBaseColorFactor(sm.getBaseColorFactor()).setRoughnessFactor(sm.getRoughnessFactor()).setMetallicFactor(sm.getMetallicFactor());
      mats.set(sm.getName(), m);
    }
    out.setMaterial(m);
    mesh.addPrimitive(out);
    base += n;
  }
  mesh.setExtras({ ...node.getMesh().getExtras(), targetNames: ident.filter((_, t) => keepT[t]).map(([n]) => n) });
  mesh.setWeights(ident.filter((_, t) => keepT[t]).map(() => 0));
  const old = node.getMesh();
  node.setMesh(mesh).setSkin(skin);
  old.dispose();
  if (oldSkin !== body.getSkin()) oldSkin.dispose();

  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) for (const t of p.listTargets()) t.setAttribute('NORMAL', null);
  await doc.transform(
    dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.TEXTURE] }),
    prune({ keepAttributes: true }),
    reorder({ encoder: MeshoptEncoder }),
    quantize(),
  );
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  await io.write(file, doc);
  const tris = mesh.listPrimitives().reduce((s, p) => s + p.getIndices().getCount() / 3, 0);
  console.log(`${path.basename(file)} : chaussures ${tris} triangles, ${keepT.filter(Boolean).length} cibles ; ${removed} triangles du pied retirés`);
}

for (const [name, shoes] of [['rider.glb', 'cyclist.glb'], ['rider_lod1.glb', 'cyclist_lod1.glb'], ['rider_lod2.glb', 'cyclist_lod1.glb']]) {
  await reshoe(path.join(avatarDir, name), path.join(cyclistDir, shoes));
}
