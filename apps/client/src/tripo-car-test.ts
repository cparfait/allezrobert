import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createEngine } from './engine/renderer.ts';
import { QUALITY_PRESETS } from './engine/quality.ts';
import { sharedKtx2Loader } from './engine/textures.ts';
import { loadVehicleModels, vehicleShowcase } from './world/traffic.ts';

/**
 * Banc d'essai PROVISOIRE (essai Tripo du 12/11/2026, non intégré au jeu) : /tripo-car-test.html pose la Porsche
 * du trafic (à gauche, telle que le jeu l'affiche) à côté de la voiture générée par Tripo (à droite,
 * models/vehicles-essai/tripo-930.glb). ?view=34|side|front|back|top, ?dist=…, ?flip=0 (annule le demi-tour du modèle Tripo),
 * ?far=1 (modèle lointain), ?len=4.29 (longueur en mètres).
 */
const log = document.getElementById('log') as HTMLElement;
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const params = new URLSearchParams(location.search);

async function loadTripo(): Promise<THREE.Object3D> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const ktx2 = await sharedKtx2Loader();
  if (ktx2) loader.setKTX2Loader(ktx2);
  const file = params.get('far') ? 'tripo-930.far.glb' : 'tripo-930.glb';
  const model = (await loader.loadAsync(`/models/vehicles-essai/${file}`)).scene;
  // Sortie Tripo : taille normalisée, orientation quelconque → longueur selon z, taille réelle, posée au sol.
  const pivot = new THREE.Group();
  pivot.add(model);
  let size = new THREE.Box3().setFromObject(pivot).getSize(new THREE.Vector3());
  if (size.x > size.z) model.rotation.y = Math.PI / 2;
  // Le modèle Tripo sort l'avant vers −z : demi-tour par défaut (?flip=0 pour l'annuler).
  if (params.get('flip') !== '0') model.rotation.y += Math.PI;
  pivot.updateMatrixWorld(true);
  size = new THREE.Box3().setFromObject(pivot).getSize(new THREE.Vector3());
  pivot.scale.setScalar(Number(params.get('len') ?? 4.29) / size.z);
  pivot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(pivot);
  const center = box.getCenter(new THREE.Vector3());
  pivot.position.set(-center.x, -box.min.y, -center.z);
  pivot.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.castShadow = mesh.receiveShadow = true;
  });
  const group = new THREE.Group();
  group.add(pivot);
  return group;
}

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
  const current = vehicleShowcase().find((v) => v.name === 'porsche-911');
  if (current) {
    current.group.position.set(-1.6, 0, 0);
    scene.add(current.group);
  }
  const tripo = await loadTripo();
  tripo.position.set(1.6, 0, 0);
  scene.add(tripo);
  log.textContent = `${current ? 'porsche-911 (jeu)' : 'porsche-911 absente'} · tripo-930 (essai)`;

  // Avant des véhicules vers +z.
  const dist = Number(params.get('dist') ?? 8);
  const eye: Record<string, [number, number, number]> = {
    '34': [dist * 0.55, dist * 0.28, dist * 0.8],
    side: [dist, 1.2, 0],
    front: [0, 1.4, dist],
    back: [0, 1.6, -dist],
    top: [0, dist, 0.01],
  };
  camera.fov = Number(params.get('fov') ?? 40);
  camera.position.set(...(eye[params.get('view') ?? '34'] ?? (eye['34'] as [number, number, number])));
  camera.lookAt(0, 0.7, 0);
  camera.updateProjectionMatrix();

  const frame = (): void => {
    engine.renderManual();
    if (document.hidden) setTimeout(frame, 16);
    else requestAnimationFrame(frame);
  };
  frame();
}

void main();
