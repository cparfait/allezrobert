import fs from 'fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
const f = process.argv[2];
const buf = fs.readFileSync(f);
const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
await MeshoptDecoder.ready;
const g = await new Promise((res, rej) => loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
let body; g.scene.traverse(o => { if (o.isSkinnedMesh && /body/i.test(o.name) && !body) body = o; });
if (!body) g.scene.traverse(o => { if (o.isSkinnedMesh) console.log('mesh', o.name, o.geometry.attributes.position.count); });
const names = body.skeleton.bones.map(b => b.name);
const P = body.geometry.attributes.position, J = body.geometry.attributes.skinIndex, W = body.geometry.attributes.skinWeight;
// zones (repère modèle, avant +z) : sous la mâchoire / gorge, menton, front
g.scene.updateMatrixWorld(true);
const v = new THREE.Vector3();
const zones = { menton: [], gorge: [], front: [], nuque: [] };
const head = g.scene.getObjectByName('head'); g.scene.updateMatrixWorld(true);
const hp = new THREE.Vector3().setFromMatrixPosition(head.matrixWorld);
console.log(f, body.name, 'tête', hp.toArray().map(x=>+x.toFixed(3)));
for (let i = 0; i < P.count; i++) {
  v.fromBufferAttribute(P, i); body.applyBoneTransform(i, v);
  const dy = v.y - hp.y, dz = v.z - hp.z;
  if (Math.abs(v.x) > 0.03) continue;
  const w = {}; for (let k = 0; k < 4; k++) { const ww = W.getComponent(i, k); if (ww > 0.01) w[names[J.getComponent(i, k)]] = +ww.toFixed(2); }
  const rec = [dy.toFixed(3), dz.toFixed(3), JSON.stringify(w)].join(' ');
  if (dz > 0.06 && dy < -0.02 && dy > -0.09) zones.menton.push(rec);
  else if (dz > -0.01 && dz < 0.07 && dy < -0.05 && dy > -0.14) zones.gorge.push(rec);
  else if (dz > 0.07 && dy > 0.08) zones.front.push(rec);
}
for (const [k, l] of Object.entries(zones)) { console.log('--', k, l.length); l.sort().slice(0, 14).forEach(r => console.log('  ', r)); }
body.geometry.computeBoundingBox(); console.log('bbox local', body.geometry.boundingBox.min.toArray().map(x=>+x.toFixed(3)), body.geometry.boundingBox.max.toArray().map(x=>+x.toFixed(3)));
console.log('matrixWorld', body.matrixWorld.elements.map(x=>+x.toFixed(3)).join(','));
console.log('bindMatrix', body.bindMatrix.elements.map(x=>+x.toFixed(3)).join(','));
