/**
 * Véhicules du trafic : à partir du .glb exporté par export_vehicle.py, produit le modèle proche
 * (`<nom>.glb`) et le modèle lointain simplifié (`<nom>.far.glb`) dans apps/client/public/models/vehicles :
 * géométrie simplifiée (meshoptimizer), textures réduites et converties en KTX2 (KHR_texture_basisu,
 * ETC1S pour les couleurs, UASTC pour les normales et masques), quantification et compression Meshopt.
 *
 * Usage : pnpm --filter @allezrobert/blender-tools vehicles:optimize <entrée.glb> <nom> [--near 40000] [--far 6000]
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRTextureBasisu } from '@gltf-transform/extensions';
import { dedup, prune, quantize, reorder, simplify, weld, getSceneVertexCount, VertexCountMethod } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { encodeToKTX2 } from 'ktx2-encoder';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../apps/client/public/models/vehicles');
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? Number(args[i + 1]) : d;
};
const [input, name] = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!input || !name) {
  console.error('usage : optimize.mjs <entrée.glb> <nom> [--near 40000] [--far 6000]');
  process.exit(1);
}
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const COLOR = { isUASTC: false, qualityLevel: 160, compressionLevel: 2, isPerceptual: true, isSetKTX2SRGBTransferFunc: true, generateMipmap: true };
const LINEAR = { isUASTC: true, needSupercompression: true, isPerceptual: false, isSetKTX2SRGBTransferFunc: false, generateMipmap: true };

const imageDecoder = async (buffer) => {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
};

/** Nombre de triangles de la scène. */
function triangles(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const p of mesh.listPrimitives()) n += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  return Math.round(n);
}

/** Textures → KTX2, côté maximal `size` pour les couleurs, moitié pour normales et masques (puissance de deux). */
async function toKtx2(doc, size) {
  const basisu = doc.createExtension(KHRTextureBasisu).setRequired(true);
  const srgb = new Set();
  for (const m of doc.getRoot().listMaterials()) {
    for (const t of [m.getBaseColorTexture(), m.getEmissiveTexture()]) if (t) srgb.add(t);
  }
  for (const tex of doc.getRoot().listTextures()) {
    const img = tex.getImage();
    if (!img) continue;
    const meta = await sharp(img).metadata();
    const side = Math.min(srgb.has(tex) ? size : size / 2, 2 ** Math.round(Math.log2(Math.max(meta.width, meta.height))));
    const png = await sharp(img).resize(side, side, { fit: 'fill' }).png().toBuffer();
    const ktx = await encodeToKTX2(new Uint8Array(png), { ...(srgb.has(tex) ? COLOR : LINEAR), imageDecoder });
    tex.setImage(ktx).setMimeType('image/ktx2');
    if (tex.getURI()) tex.setURI(tex.getURI().replace(/\.\w+$/, '.ktx2'));
  }
  return basisu;
}

async function build(target, texSize, file, far) {
  const doc = await io.read(input);
  // Modèle lointain : couleurs seules (normales, rugosité et occlusion invisibles à cette distance).
  if (far)
    for (const m of doc.getRoot().listMaterials()) m.setNormalTexture(null).setMetallicRoughnessTexture(null).setOcclusionTexture(null);
  await doc.transform(weld(), dedup());
  const before = triangles(doc);
  if (before > target) {
    // Plusieurs passes : simplify respecte l'erreur maximale avant le ratio demandé.
    for (const error of [0.0005, 0.002, 0.008, 0.03, 0.1]) {
      const now = triangles(doc);
      if (now <= target * 1.05) break;
      await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: target / now, error, lockBorder: false }));
    }
  }
  await toKtx2(doc, texSize);
  await doc.transform(prune(), reorder({ encoder: MeshoptEncoder }), quantize());
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  const out = join(OUT, file);
  await io.write(out, doc);
  const verts = getSceneVertexCount(doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0], VertexCountMethod.UPLOAD);
  console.log(`${file} : ${before} → ${triangles(doc)} triangles, ${verts} sommets, ${(statSync(out).size / 1024).toFixed(0)} Ko`);
}

mkdirSync(OUT, { recursive: true });
await build(opt('--near', 40000), 1024, `${name}.glb`, false);
await build(opt('--far', 6000), 256, `${name}.far.glb`, true);
