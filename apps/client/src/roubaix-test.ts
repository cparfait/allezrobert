import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { bikeOfLook } from '@allezrobert/shared';
import { ROUBAIX_MODEL_ID } from '../../../packages/shared/src/roubaixMetric.ts';
import { createEngine } from './engine/renderer.ts';
import { QUALITY_PRESETS } from './engine/quality.ts';
import { dressRoubaix, fitRoubaixWheels, loadRoubaix, roubaixAnchor, setSaddleDrop } from './rider/roubaix.ts';
import { DEFAULT_LOOK } from '@allezrobert/shared';
import { GltfRiderAvatar, type RiderPose } from './rider/gltfAvatar.ts';
import type { Engine } from './engine/renderer.ts';

/**
 * Banc de développement du Roubaix dédié par taille (étape I-3, non branché dans le jeu) : /roubaix-test.html.
 * Vélo seul, à l'échelle 1, avec les roues du jeu (wheels.glb) et les disques propres à la taille, habillé de la livrée du
 * catalogue (Specialized Roubaix Sport 2020). Paramètres : ?size=44, ?lod=0|1|2, ?drop=<mm> (selle abaissée), ?wheels=box|c35,
 * ?view=side|right|34|front|back|top, ?dist=…, ?target=x,y,z (point visé, m), ?nolivery=1, ?spin=1. Curseur et boutons dans la page.
 * Mode coureur (I-4b) : ?rider=1&roubaix=1&taille=150 (ou &roubaix=44 pour forcer la taille), &pose=seated|standing|coasting,
 * &cadence=80, &manivelle=<degrés> (pédalier figé à cet angle) ; ?avatar=tripo pour le coureur Tripo.
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
  camera.far = 200;
  scene.background = new THREE.Color('#b9c6d6');
  scene.add(new THREE.HemisphereLight(0xe6eeff, 0x5a5f50, 1.2));
  const sun = new THREE.DirectionalLight(0xfff1dc, 3.0);
  sun.position.set(6, 10, 4);
  sun.castShadow = true;
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardNodeMaterial({ color: '#7a7c80', roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  if (params.has('rider')) return riderBench(engine);

  const size = params.get('size') ?? '44';
  const bike = await loadRoubaix(size);
  if (!bike) {
    log.textContent = `Roubaix ${size} : taille non modélisée ou fichiers absents`;
    return;
  }
  const build = bikeOfLook({ bike: '#121315', bikeModel: ROUBAIX_MODEL_ID, tune: [] });
  const wheelLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const wheels = (await wheelLoader.loadAsync('/models/bikes/wheels.glb')).scene;
  const wheelType = params.get('wheels') ?? 'box';
  const fitted: string[] = [];
  const tris: number[] = [];
  bike.lods.forEach((lod, i) => {
    let n = 0;
    lod.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) n += (m.geometry.index?.count ?? m.geometry.attributes.position?.count ?? 0) / 3; });
    tris.push(n);
    if (params.get('nolivery') !== '1') dressRoubaix(lod, bike.spec, build);
    const f = wheels.getObjectByName(`wheel_${wheelType}_F`)?.clone(true), r = wheels.getObjectByName(`wheel_${wheelType}_R`)?.clone(true);
    const af = roubaixAnchor(lod, 'axle_front'), ar = roubaixAnchor(lod, 'axle_rear');
    if (f && r && af && ar) {
      f.position.copy(af);
      r.position.copy(ar);
      if (fitRoubaixWheels(f, r, bike)) fitted.push(String(i));
      f.name = 'roue_avant';
      r.name = 'roue_arriere';
      lod.add(f, r);
    }
    lod.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true; });
    lod.visible = false;
    scene.add(lod);
  });

  let lodIdx = THREE.MathUtils.clamp(Number(params.get('lod') ?? 0) | 0, 0, 2);
  let drop = Number(params.get('drop') ?? 0);
  const apply = (): void => {
    bike.lods.forEach((l, i) => { l.visible = i === lodIdx; drop = setSaddleDrop(l, bike.spec, drop); });
    log.textContent = `Roubaix ${size} · LOD ${lodIdx} (${Math.round(tris[lodIdx] ?? 0)} triangles du vélo, roues non comprises) · selle −${drop.toFixed(0)} mm · roues ${wheelType}, disques de la taille sur LOD ${fitted.join('/') || 'aucun'} · échelle 1`;
  };
  // Commandes de la page.
  const slider = document.getElementById('drop') as HTMLInputElement | null;
  if (slider) {
    slider.max = String(bike.spec.seatpost.maxDropMm);
    slider.value = String(drop);
    slider.oninput = () => { drop = Number(slider.value); apply(); };
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-lod]')) b.onclick = () => { lodIdx = Number(b.dataset.lod); apply(); };
  apply();

  const dist = Number(params.get('dist') ?? 2.6);
  const eye: Record<string, [number, number, number]> = {
    side: [dist, 0.75, 0.08],
    right: [-dist, 0.75, 0.08],
    '34': [dist * 0.7, dist * 0.35, dist * 0.7],
    front: [0, 0.9, dist],
    back: [0, 0.9, -dist],
    top: [0, dist, 0.01],
  };
  camera.fov = Number(params.get('fov') ?? 35);
  camera.position.set(...(eye[params.get('view') ?? 'side'] ?? (eye.side as [number, number, number])));
  const target = (params.get('target') ?? '0,0.5,0.08').split(',').map(Number) as [number, number, number];
  camera.position.add(new THREE.Vector3(...target).sub(new THREE.Vector3(0, 0.5, 0.08)));
  camera.lookAt(...target);
  camera.updateProjectionMatrix();

  const spin = params.get('spin') === '1';
  const frame = (): void => {
    if (spin) for (const l of bike.lods) for (const n of ['roue_avant', 'roue_arriere']) { const w = l.getObjectByName(n); if (w) w.rotation.x += 0.08; }
    engine.renderManual();
    if (document.hidden) setTimeout(frame, 16);
    else requestAnimationFrame(frame);
  };
  frame();
}


/**
 * Coureur sur le Roubaix dédié (I-4b) : le look choisit le Roubaix du catalogue et la taille du coureur ; l'avatar monte le
 * Roubaix si l'option ?roubaix est là (sinon le vélo de la famille, pour comparaison). Mesures affichées : taille montée,
 * abaissement de selle, échelle du coureur, distances paume–cocotte et pied–pédale.
 */
async function riderBench(engine: Engine): Promise<void> {
  const { scene, camera } = engine;
  const ok = await GltfRiderAvatar.load();
  if (!ok) {
    log.textContent = 'modèles du coureur indisponibles';
    return;
  }
  const taille = Number(params.get('taille') ?? 150);
  const avatar = new GltfRiderAvatar({ ...DEFAULT_LOOK, bikeModel: ROUBAIX_MODEL_ID, heightCm: taille });
  scene.add(avatar.root);
  const pose = (params.get('pose') ?? 'seated') as RiderPose;
  const cadence = Number(params.get('cadence') ?? 80);
  const crank = params.get('manivelle');
  const dist = Number(params.get('dist') ?? 3.2);
  const eye: Record<string, [number, number, number]> = {
    side: [dist, 1.0, 0.1], right: [-dist, 1.0, 0.1], '34': [dist * 0.7, dist * 0.45, dist * 0.7], front: [0, 1.2, dist], back: [0, 1.3, -dist], top: [0, dist, 0.01],
  };
  camera.fov = Number(params.get('fov') ?? 30);
  camera.position.set(...(eye[params.get('view') ?? 'side'] ?? (eye.side as [number, number, number])));
  const target = (params.get('target') ?? '0,0.8,0.05').split(',').map(Number) as [number, number, number];
  camera.lookAt(...target);
  camera.updateProjectionMatrix();
  let last = performance.now();
  const frame = (): void => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (crank !== null) {
      (avatar as unknown as { setGesture?(g: { crank: number }): void }).setGesture?.({ crank: (Number(crank) * Math.PI) / 180 });
      avatar.update(1 / 60, 0, 0, pose);
    } else avatar.update(dt, cadence, 8, pose);
    const fit = avatar.roubaixFit();
    log.textContent = fit
      ? `Roubaix ${fit.size} dédié · coureur ${taille} cm (échelle ${fit.k.toFixed(3)}) · selle abaissée de ${fit.dropMm.toFixed(0)} mm · ${pose}`
      : `vélo de la famille (option ?roubaix absente, autre taille ou fichiers en chargement) · coureur ${taille} cm · ${pose}`;
    engine.renderManual();
    if (document.hidden) setTimeout(frame, 16);
    else requestAnimationFrame(frame);
  };
  frame();
}

void main();
