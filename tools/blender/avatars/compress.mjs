/**
 * Compression de l'avatar (build_avatar.py) : quantification des attributs de base et
 * compression meshopt (EXT_meshopt_compression, décodée par three.js).
 *
 *
 * Usage : pnpm --filter @allezrobert/blender-tools compress:avatar <entrée.glb> <sortie.glb>
 */
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, quantize, reorder } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage : compress.mjs <entrée.glb> <sortie.glb>');
  process.exit(1);
}
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(input);
// Cibles sans normales : le client recalcule les normales des curseurs de forme, et les
// expressions gardent celles du visage au repos (écart invisible, fichier 3 fois plus léger).
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) for (const t of prim.listTargets()) t.setAttribute('NORMAL', null);
}
await doc.transform(
  // Matériaux exclus : tous identiques à l'export, ils seraient fusionnés.
  dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.TEXTURE] }),
  prune({ keepAttributes: true }),
  reorder({ encoder: MeshoptEncoder }),
  // Le client remet positions, normales et cibles en flottants au chargement (gltfAvatar.ts,
  // plainAttributes) : three.js r186 applique mal les cibles animées sur des attributs quantifiés.
  quantize(),
);
// Compression à l'écriture (meshopt() quantifierait aussi les cibles).
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
await io.write(output, doc);
