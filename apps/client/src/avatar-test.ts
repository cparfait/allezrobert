import * as THREE from 'three/webgpu';
import { BIKES, DEFAULT_LOOK, type AvatarLook, type BikeModel } from '@allezrobert/shared';
import { createEngine } from './engine/renderer.ts';
import { QUALITY_PRESETS } from './engine/quality.ts';
import { GltfRiderAvatar, type RiderPose } from './rider/gltfAvatar.ts';

/**
 * Banc d'essai (développement) : /avatar-test.html rend l'avatar glTF qui pédale sur un sol uni
 * et envoie des captures à POST /__shot (docs/screenshots/). ?noshot pour juste regarder.
 * Rendu manuel (engine.renderManual) : fonctionne aussi quand l'onglet est masqué.
 */

const log = document.getElementById('log') as HTMLElement;
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const params = new URLSearchParams(location.search);

async function main(): Promise<void> {
  const q = { ...QUALITY_PRESETS.high, ao: false, taa: false, bloom: false, pixelRatio: 1 };
  const engine = await createEngine(canvas, q);
  const { scene, camera, renderer } = engine;
  renderer.setPixelRatio(1);
  renderer.setSize(1280, 720, false);
  camera.aspect = 1280 / 720;
  camera.fov = 40;
  camera.far = 400;
  camera.updateProjectionMatrix();
  scene.background = new THREE.Color('#9fb8d6');
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x5a5f50, 1.2));
  const sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
  sun.position.set(6, 10, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = sc.bottom = -8;
  sc.right = sc.top = 8;
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardNodeMaterial({ color: '#6c6f68', roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const ok = await GltfRiderAvatar.load();
  log.textContent = ok ? 'modèles chargés' : 'ÉCHEC du chargement';
  if (!ok) return;
  if (params.has('bikes')) return bikeSheet(engine, params.get('bikes') ?? '');

  const looks: AvatarLook[] = [
    DEFAULT_LOOK,
    { ...DEFAULT_LOOK, jersey: '#e63946', jerseyAccent: '#f1faee', skin: '#8d5a3b', hair: '#111111', helmet: '#222222', bike: '#2a9d8f', build: 1 },
    { ...DEFAULT_LOOK, jersey: '#ffd23f', jerseyAccent: '#1d3557', skin: '#f2c9a5', hair: '#c49a4a', helmet: '#e63946', bike: '#f4f4f4', build: 0 },
  ];
  type Rig = { a: GltfRiderAvatar; pose: RiderPose; cadence: number };
  const riders: Rig[] = [
    { a: new GltfRiderAvatar(looks[0] as AvatarLook), pose: 'seated', cadence: 90 },
    { a: new GltfRiderAvatar(looks[1] as AvatarLook), pose: 'standing', cadence: 70 },
    { a: new GltfRiderAvatar(looks[2] as AvatarLook), pose: 'coasting', cadence: 0 },
  ];
  riders.forEach((r, i) => {
    r.a.root.position.set((i - 1) * 1.6, 0, i === 1 ? 0.8 : 0);
    scene.add(r.a.root);
  });
  // Coureur lointain (LOD1).
  const far = new GltfRiderAvatar(looks[0] as AvatarLook);
  far.root.position.set(0, 0, -60);
  scene.add(far.root);

  const step = (time: number, dt = 1 / 60): void => {
    for (let t = 0; t < time; t += dt) {
      for (const r of riders) r.a.update(dt, r.cadence, r.cadence > 0 ? 9 : 7, r.pose, 0);
      far.update(dt, 90, 9, 'seated');
    }
  };
  const view = (pos: [number, number, number], target: [number, number, number], fov = 40): void => {
    camera.position.set(...pos);
    camera.fov = fov;
    camera.updateProjectionMatrix();
    camera.lookAt(...target);
  };
  const grab = (): string => {
    engine.renderManual();
    return canvas.toDataURL('image/jpeg', 0.9);
  };
  const shots: Array<[string, string]> = [];

  step(2);
  view([3.6, 1.7, 4.2], [0, 0.85, 0.2]);
  shots.push(['avatar-gltf-3q', grab()]);
  view([-3.2, 1.4, -3.6], [0, 0.9, 0.2]);
  shots.push(['avatar-gltf-back', grab()]);

  // Pédalage vu de côté : quatre phases du coureur assis (planche contact).
  const seated = riders[0] as Rig;
  for (const r of riders) r.a.root.visible = r === seated;
  far.root.visible = false;
  // Planche 3 × 2 : on copie le canvas WebGPU juste après le rendu (même tâche).
  const sheet = document.createElement('canvas');
  sheet.width = 1920;
  sheet.height = 720;
  const g = sheet.getContext('2d') as CanvasRenderingContext2D;
  let cell = 0;
  const toSheet = (): void => {
    engine.renderManual();
    g.drawImage(canvas, (cell % 3) * 640, Math.floor(cell / 3) * 360, 640, 360);
    cell++;
  };
  const priv = seated.a as unknown as { crankAngle: number };
  for (let i = 0; i < 4; i++) {
    priv.crankAngle = (i * Math.PI) / 2;
    seated.a.update(0, 0.0001, 9, 'seated');
    priv.crankAngle = (i * Math.PI) / 2;
    seated.a.update(1e-4, 90, 9, 'seated');
    view([seated.a.root.position.x + 3.0, 0.95, 0.12], [seated.a.root.position.x, 0.72, 0.12], 34);
    toSheet();
  }
  // Danseuse vue de face et de côté.
  const standing = riders[1] as Rig;
  for (const r of riders) r.a.root.visible = r === standing;
  step(0.31);
  view([standing.a.root.position.x + 0.8, 1.3, 4.5], [standing.a.root.position.x, 0.9, 0.8], 34);
  toSheet();
  view([standing.a.root.position.x + 3.0, 0.95, 0.92], [standing.a.root.position.x, 0.72, 0.92], 34);
  toSheet();
  // LOD1 à 60 m (téléobjectif).
  for (const r of riders) r.a.root.visible = false;
  far.root.visible = true;
  view([3, 1.6, 0], [0, 0.9, -60], 3.2);
  shots.push(['avatar-gltf-lod1', grab()]);

  shots.push(['avatar-gltf-sheet', sheet.toDataURL('image/jpeg', 0.9)]);

  if (!params.has('noshot')) {
    for (const [name, data] of shots) {
      const res = await fetch(`/__shot?name=${name}`, { method: 'POST', body: data });
      log.textContent += `\n${name}: ${res.status}`;
    }
  }
  log.textContent += '\nterminé';
  (window as unknown as { __avatarTestDone: boolean }).__avatarTestDone = true;
  // Ensuite : animation libre.
  view([3.6, 1.7, 4.2], [0, 0.85, 0.2]);
  for (const r of riders) r.a.root.visible = true;
  let last = performance.now();
  const loop = (): void => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    for (const r of riders) r.a.update(dt, r.cadence, 9, r.pose, 0);
    engine.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/**
 * Planche des vélos du catalogue vus de profil, côté transmission (?bikes=id1,id2… par préfixes,
 * vide : la planche des livrées des aperçus Blender ; &rider : avec le coureur ; &side=left :
 * côté gauche ; &view=3q : de trois quarts avant ; &view=face : visage ; &view=cockpit : poste de pilotage). Enregistrée comme bikes-client-<nom>.jpg (&name=…), sauf avec ?noshot.
 */
const LIVERY_SHEET = ['s26-04-', 's26-01-', 's26-14-', 'myth-bianchi-specialissima-acier', 'myth-peugeot-px10', 'myth-lotus-110',
  's26-06-', 'myth-look-kg86', 'myth-specialized-tarmac-sl7', 'myth-pinarello-espada', 'myth-giant-tcr-compact', 'myth-colnago-c40-mapei'];

async function bikeSheet(engine: Awaited<ReturnType<typeof createEngine>>, list: string): Promise<void> {
  const { scene, camera } = engine;
  const keys = list ? list.split(',') : LIVERY_SHEET;
  const models = keys.map((k) => BIKES.find((b) => b.id.startsWith(k))).filter((b): b is BikeModel => !!b);
  await GltfRiderAvatar.load([...new Set(models.map((b) => b.family))]);
  const { loadBikeFamily } = await import('./rider/bikes.ts');
  await Promise.all(models.map((b) => loadBikeFamily(b.family)));
  const cols = Math.min(4, models.length);
  const rows = Math.ceil(models.length / cols);
  // Taille d'une case (&cell=960 pour un gros plan).
  const cw = Number(params.get('cell') ?? 480);
  const ch = Math.round((cw * 300) / 480);
  const sheet = document.createElement('canvas');
  sheet.width = cols * cw;
  sheet.height = rows * ch;
  const g = sheet.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#eceeef';
  g.fillRect(0, 0, sheet.width, sheet.height);
  g.font = '600 15px system-ui, sans-serif';
  g.textAlign = 'center';
  const left = params.get('side') === 'left';
  for (const [i, b] of models.entries()) {
    const a = new GltfRiderAvatar({ ...DEFAULT_LOOK, bikeModel: b.id });
    a.update(0, 0, 0, 'seated');
    a.update(1 / 60, 0.0001, 0, 'seated');
    const riderOn = params.has('rider');
    a.root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) o.visible = riderOn;
    });
    scene.add(a.root);
    camera.fov = 30;
    const sx = left ? 1 : -1;
    if (params.get('view') === 'face') {
      // Gros plan du visage : yeux du coureur (pose courante, position chrono comprise).
      const eye = a.eyeWorld(new THREE.Vector3());
      camera.position.set(eye.x + sx * 0.45, eye.y + 0.05, eye.z + 0.75);
      camera.updateProjectionMatrix();
      camera.lookAt(eye.x, eye.y - 0.06, eye.z);
    } else if (params.get('view') === 'cockpit') {
      camera.position.set(sx * 0.75, 1.15, 1.05);
      camera.updateProjectionMatrix();
      camera.lookAt(0, 0.88, 0.5);
    } else if (params.get('view') === '3q') camera.position.set(sx * 2.2, 1.5, 2.6);
    else camera.position.set(sx * (riderOn ? 4.4 : 3.4) * Number(params.get('zoom') ?? 1), riderOn ? 0.95 : 0.62, 0.09);
    if (params.get('view') !== 'face' && params.get('view') !== 'cockpit') {
      camera.updateProjectionMatrix();
      camera.lookAt(0, riderOn ? 0.85 : 0.56, 0.09);
    }
    engine.renderManual();
    const x = (i % cols) * cw;
    const y = Math.floor(i / cols) * ch;
    g.drawImage(canvas, 160, 60, 960, 600, x, y, cw, ch);
    g.fillStyle = '#16181c';
    g.fillText(`${b.name} · ${b.family}`, x + cw / 2, y + 24);
    scene.remove(a.root);
  }
  document.body.replaceChildren(sheet);
  sheet.style.cssText = 'display:block;width:100%;height:auto';
  if (!params.has('noshot')) await fetch(`/__shot?name=bikes-client-${params.get('name') ?? 'liveries'}`, { method: 'POST', body: sheet.toDataURL('image/jpeg', 0.9) });
  (window as unknown as { __avatarTestDone: boolean }).__avatarTestDone = true;
}

main().catch((e) => {
  log.textContent = String(e);
  console.error(e);
});
