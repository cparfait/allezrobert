import * as THREE from 'three/webgpu';
import type { RouteTrack } from '@allezrobert/shared';
import { createEngine } from './engine/renderer.ts';
import { QUALITY_PRESETS, type QualityLevel } from './engine/quality.ts';
import { Crowd } from './world/crowd.ts';
import { loadSpectators, spectatorMaterial } from './world/crowdRealistic.ts';

/**
 * Banc d'essai (développement) : /crowd-test.html montre le public d'un sommet de KOM sur une route droite,
 * sans serveur ni zone. ?d=… distance de la caméra sur la route (le KOM finit à 400 m), ?lat=… décalage
 * latéral, ?h=… hauteur, ?n=… nombre de mesures du temps d'image, ?quality=low|medium|high|ultra, ?capsules
 * (ancien public, pour comparer), ?finish (foule et barrières d'arrivée de course, ligne à 600 m), ?perf=1 (temps GPU).
 */
const log = document.getElementById('log') as HTMLElement;
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const params = new URLSearchParams(location.search);

/** Route droite le long de -Z, KOM de 0 à 400 m. */
const ROAD_W = 6;
const track = {
  length: 600,
  route: { roadWidthM: ROAD_W, loop: true, segments: [{ kind: 'kom', startM: 0, endM: 400, name: 'Essai' }] },
  positionAt: (d: number, lateral: number) => ({ x: lateral, y: 0, z: -d, dirX: 0, dirZ: -1, grade: 0, d }),
} as unknown as RouteTrack;

async function main(): Promise<void> {
  const preset = QUALITY_PRESETS[(params.get('quality') ?? 'high') as QualityLevel] ?? QUALITY_PRESETS.high;
  const engine = await createEngine(canvas, { ...preset, ao: false, taa: false, pixelRatio: 1 });
  const { scene, camera, renderer } = engine;
  renderer.setPixelRatio(1);
  renderer.setSize(1280, 720, false);
  camera.aspect = 1280 / 720;
  camera.fov = 50;
  camera.far = 800;
  camera.updateProjectionMatrix();
  scene.background = new THREE.Color('#9fb8d6');
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x5a5f50, 1.1));
  const sun = new THREE.DirectionalLight(0xfff1dc, 3.0);
  sun.position.set(30, 50, 10);
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 1200), new THREE.MeshStandardNodeMaterial({ color: '#5f7a45', roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.z = -300;
  scene.add(ground);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, 1200), new THREE.MeshStandardNodeMaterial({ color: '#3c3d40', roughness: 0.9 }));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.01, -300);
  scene.add(road);

  const crowd = new Crowd(track, () => 0, { riderName: 'Robert', density: Number(params.get('density') ?? 0.75), realPeople: !params.has('capsules'), finish: params.has('finish') });
  const assets = params.has('capsules') ? [] : await loadSpectators();
  // ?lineup : tous les personnages en rang face à la caméra (?lineup=3 : trois rangées de couleurs différentes).
  if (params.has('lineup')) {
    const rows = Math.max(1, Number(params.get('lineup')) || 1);
    const dl = Number(params.get('d') ?? 360);
    assets.forEach((a, k) => {
      const mesh = new THREE.InstancedMesh(a.geometry, spectatorMaterial(a, new Float32Array(Array.from({ length: rows }, () => [-1, 0, 1]).flat()), new Float32Array(rows), k * 1009 + Number(params.get('seed') ?? 0)), rows);
      for (let r = 0; r < rows; r++)
        mesh.setMatrixAt(r, new THREE.Matrix4().compose(new THREE.Vector3((k - (assets.length - 1) / 2) * 1.1, 0, -dl - 7 - r * 2.5), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI), new THREE.Vector3(1, 1, 1)));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      scene.add(mesh);
    });
  } else scene.add(crowd.group);
  // Le remplacement des capsules se fait juste après la promesse partagée.
  await new Promise((r) => setTimeout(r, 50));
  log.textContent = `${assets.length ? `${assets.length} personnages (${assets.map((a) => a.name).join(', ')})` : 'capsules'} · ${crowd.mesh.count} spectateurs`;

  const d = Number(params.get('d') ?? 360);
  camera.position.set(Number(params.get('lat') ?? 0.5), Number(params.get('h') ?? 1.6), -d);
  // ?look=x,y,dz : point visé (x, hauteur, distance devant la caméra) ; ?fov=… pour un plan serré.
  const [lx, ly, lz] = (params.get('look') ?? '0,1.2,25').split(',').map(Number) as [number, number, number];
  camera.lookAt(lx, ly, -d - lz);
  if (params.has('fov')) {
    camera.fov = Number(params.get('fov'));
    camera.updateProjectionMatrix();
  }
  // Animation : rendu en continu ; mesure du temps d'image moyen sur ?n images.
  const n = Number(params.get('n') ?? 120);
  let k = 0;
  let t0 = 0;
  // ?perf=1 : temps GPU du rendu (requêtes d'horodatage), moyenne des relevés pris toutes les 10 images.
  const gpu: number[] = [];
  const frame = (): void => {
    engine.renderManual();
    if (params.get('perf') === '1' && k % 10 === 0)
      void renderer.resolveTimestampsAsync('render').then(() => {
        const ts = renderer.info.render.timestamp;
        if (ts > 0 && k > 20) gpu.push(ts);
      });
    if (k === 10) t0 = performance.now();
    if (k === 10 + n) {
      const g = gpu.length ? ` · GPU ${(gpu.reduce((a, b) => a + b, 0) / gpu.length).toFixed(2)} ms (${gpu.length} relevés)` : '';
      log.textContent += ` · ${((performance.now() - t0) / n).toFixed(2)} ms/image${g}`;
    }
    // ?shot=nom : capture pleine résolution dans out/crowd/ (POST /__shot du serveur de développement).
    if (k === 90 && params.has('shot')) void fetch(`/__shot?name=${params.get('shot')}&dir=crowd`, { method: 'POST', body: canvas.toDataURL('image/jpeg', 0.92) });
    k++;
    // Fenêtre masquée : requestAnimationFrame est suspendu, une minuterie prend le relais.
    if (document.hidden) setTimeout(frame, 16);
    else requestAnimationFrame(frame);
  };
  frame();
}

void main();
