/**
 * Variante Réel du gravel Allez Robert, à partir de ses GLB existants
 * (Road Bike de Tanya Andreeva, CC BY 4.0, adapté avec build_gravel.py).
 * Usage : node tools/blender/refine_gravel.mjs <dossier des vélos> <dossier de sortie>
 */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';

const [source, destination] = process.argv.slice(2);
if (!source || !destination || resolve(source) === resolve(destination)) {
  throw new Error('Indiquer deux dossiers distincts : les GLB source et la sortie.');
}

function widen(primitive, profile) {
  const position = primitive.getAttribute('POSITION');
  const normal = primitive.getAttribute('NORMAL');
  const points = position.getArray();
  const normals = normal.getArray();
  for (let i = 0; i < points.length; i += 3) {
    const [scale, slope] = profile(points[i + 1]);
    const nx = normals[i] / scale;
    const ny = normals[i + 1] - nx * points[i] * slope;
    const nz = normals[i + 2];
    const length = Math.hypot(nx, ny, nz);
    points[i] *= scale;
    normals[i] = nx / length;
    normals[i + 1] = ny / length;
    normals[i + 2] = nz / length;
  }
}

function dropFlare(height) {
  // Les cocottes et le haut du cintre conservent leur largeur. On ouvre
  // progressivement le bas du cintre, hors de la zone de prise route.
  const span = 0.12;
  const t = Math.min(1, Math.max(0, (0.85 - height) / span));
  return [1 + 0.08 * t * t * (3 - 2 * t), -0.08 * 6 * t * (1 - t) / span];
}

const io = new NodeIO();
await mkdir(destination, { recursive: true });
for (const name of ['gravel.glb', 'gravel_lod1.glb']) {
  const document = await io.read(resolve(source, name));
  const nodes = document.getRoot().listNodes();
  const cockpit = nodes.find(node => node.getName() === 'cockpit').getMesh();
  for (const primitive of cockpit.listPrimitives()) widen(primitive, dropFlare);
  for (const name of ['wheel_front', 'wheel_rear']) {
    const wheel = nodes.find(node => node.getName() === name).getMesh();
    for (const primitive of wheel.listPrimitives()) {
      if (['tire', 'tire_wall'].includes(primitive.getMaterial().getName())) widen(primitive, () => [1.08, 0]);
    }
  }
  await io.write(resolve(destination, name), document);
}
