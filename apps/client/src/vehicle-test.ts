import * as THREE from 'three/webgpu';
import { createEngine } from './engine/renderer.ts';
import { QUALITY_PRESETS } from './engine/quality.ts';
import { loadVehicleModels, vehicleShowcase } from './world/traffic.ts';

/**
 * Banc d'essai (développement) : /vehicle-test.html range côte à côte un exemplaire de chaque véhicule du
 * trafic, avec son occupant. ?style=real|lowpoly, ?only=nom (un seul véhicule, plan serré),
 * ?view=34|side|front|back|top, ?seat=x,y,z (point de hanche d'essai), ?dist=… (recul de la caméra).
 */
const log = document.getElementById('log') as HTMLElement;
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const params = new URLSearchParams(location.search);

async function main(): Promise<void> {
  const engine = await createEngine(canvas, { ...QUALITY_PRESETS.high, ao: false, taa: false, pixelRatio: 1 });
  const { scene, camera, renderer } = engine;
  renderer.setPixelRatio(1);
  renderer.setSize(1280, 720, false);
  camera.aspect = 1280 / 720;
  camera.far = 400;
  scene.background = new THREE.Color('#9fb8d6');
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x5a5f50, 1.1));
  const sun = new THREE.DirectionalLight(0xfff1dc, 3.0);
  sun.position.set(20, 40, 30);
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardNodeMaterial({ color: '#6a6c70', roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  await loadVehicleModels();
  const seat = params.get('seat')?.split(',').map(Number) as [number, number, number] | undefined;
  const only = params.get('only');
  const list = vehicleShowcase(seat).filter((v) => !only || v.name === only);
  const gap = 3.2;
  list.forEach((v, k) => {
    v.group.position.set((k - (list.length - 1) / 2) * gap, 0, 0);
    scene.add(v.group);
  });
  log.textContent = list.map((v) => v.name).join(' · ');

  // Avant des véhicules vers +z ; la gauche du conducteur est en +x.
  const span = Math.max(list.length * gap, 6);
  const dist = Number(params.get('dist') ?? (only ? 7 : span * 0.75));
  const eye: Record<string, [number, number, number]> = {
    '34': [dist * 0.55, dist * 0.28, dist * 0.8],
    side: [dist, 1.2, 0],
    front: [0, 1.4, dist],
    back: [0, 1.6, -dist],
    top: [0, dist, 0.01],
  };
  camera.fov = Number(params.get('fov') ?? 40);
  camera.position.set(...(eye[params.get('view') ?? '34'] ?? (eye['34'] as [number, number, number])));
  camera.lookAt(0, 1.0, 0);
  camera.updateProjectionMatrix();

  const frame = (): void => {
    engine.renderManual();
    if (document.hidden) setTimeout(frame, 16);
    else requestAnimationFrame(frame);
  };
  frame();
}

void main();
