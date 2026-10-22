import * as THREE from 'three/webgpu';
import { BASE_PROFILES, BIKES, DEFAULT_LOOK, FACE_SLIDERS, encodeFace, profileLook, type AvatarLook, type BikeModel, type FaceShape } from '@allezrobert/shared';
import { createEngine } from './engine/renderer.ts';
import { QUALITY_PRESETS, type QualityLevel } from './engine/quality.ts';
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
  // &bench&quality=low|medium|high|ultra : préréglage complet (post-traitements compris).
  const preset = QUALITY_PRESETS[(params.get('quality') ?? 'high') as QualityLevel] ?? QUALITY_PRESETS.high;
  const q = params.has('bench') ? preset : { ...QUALITY_PRESETS.high, ao: false, taa: false, bloom: false, pixelRatio: 1 };
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
  if (params.has('bench')) return bench(engine);
  if (params.has('sliders')) return sliderSheet(engine);
  if (params.has('random')) return randomSheet(engine);
  if (params.has('profiles')) return profileSheet(engine);
  if (params.has('calib')) return likenessCalibration(engine);

  // ?shoes : chaussures en gros plan (tige, perforations, marquage) pour quatre tenues, pied gauche
  // en bas (manivelle 0) : extérieur, trois quarts avant, dessus ; puis de côté à 3 m.
  if (params.has('shoes')) {
    const variants: Array<Partial<AvatarLook>> = [
      { shoes: '#f2f2f2' },
      { shoes: '#f2f2f2', shoeMark: 'vanrysel', shoeAccent: '#8a9099' },
      { shoes: '#f2f2f2', shoeMark: 'vanrysel', shoeAccent: '#ff5fa2', socks: '#ffffff' },
      { shoes: '#c8102e', shoeMark: 'sphyre', shoeAccent: '#111111' },
    ];
    const avs = variants.map((v) => {
      const a = new GltfRiderAvatar({ ...DEFAULT_LOOK, ...v });
      a.root.visible = false;
      scene.add(a.root);
      const priv = a as unknown as { crankAngle: number };
      priv.crankAngle = 0;
      a.update(0, 0.0001, 0, 'seated');
      priv.crankAngle = 0;
      a.update(1e-4, 0.0001, 0, 'seated');
      return a;
    });
    const sheet = document.createElement('canvas');
    sheet.width = 1920;
    sheet.height = 360 * avs.length;
    const g = sheet.getContext('2d') as CanvasRenderingContext2D;
    // Pied gauche : centre de la chaussure ≈ (0,105 ; 0,15 ; −0,06).
    const foot = new THREE.Vector3(0.105, 0.15, -0.06);
    const views: Array<[THREE.Vector3, number]> = [
      [new THREE.Vector3(0.62, 0.02, 0.0), 30],
      [new THREE.Vector3(0.42, 0.25, 0.42), 30],
      [new THREE.Vector3(0.18, 0.6, 0.05), 30],
    ];
    avs.forEach((a, i) => {
      for (const o of avs) o.root.visible = o === a;
      views.forEach(([off, fov], k) => {
        camera.fov = fov;
        camera.updateProjectionMatrix();
        camera.position.copy(foot).add(off);
        camera.lookAt(foot);
        engine.renderManual();
        g.drawImage(canvas, k * 640, i * 360, 640, 360);
      });
    });
    const far = document.createElement('canvas');
    far.width = 1280;
    far.height = 720;
    const fg = far.getContext('2d') as CanvasRenderingContext2D;
    for (const o of avs) o.root.visible = o === avs[1];
    camera.fov = 40;
    camera.updateProjectionMatrix();
    camera.position.set(3.0, 0.9, 0.1);
    camera.lookAt(0, 0.62, 0.1);
    engine.renderManual();
    fg.drawImage(canvas, 0, 0);
    const shots: Array<[string, string]> = [
      ['shoes-client-sheet', sheet.toDataURL('image/jpeg', 0.9)],
      ['shoes-client-far', far.toDataURL('image/jpeg', 0.9)],
    ];
    if (!params.has('noshot')) for (const [name, data] of shots) await fetch(`/__shot?name=${name}`, { method: 'POST', body: data });
    (window as unknown as { __shoeShots: Array<[string, string]> }).__shoeShots = shots;
    (window as unknown as { __avatarTestDone: boolean }).__avatarTestDone = true;
    log.textContent += '\nterminé';
    return;
  }

  // ?kits : les trois vélos (route, gravel, VTT) côte à côte, de profil et de trois quarts.
  if (params.has('kits')) {
    const types = ['road', 'gravel', 'mtb'] as const;
    const avs = types.map((bikeType, i) => {
      const a = new GltfRiderAvatar({ ...DEFAULT_LOOK, bikeType, bike: ['#c0392b', '#6b7d4f', '#2f6b3a'][i] as string });
      a.root.position.set(0, 0, 0);
      a.root.visible = false;
      scene.add(a.root);
      for (let t = 0; t < 1; t += 1 / 60) a.update(1 / 60, 90, 8, 'seated', 0);
      return a;
    });
    const kitShots: Array<[string, string]> = [];
    const sheet = document.createElement('canvas');
    sheet.width = 1920;
    sheet.height = 720;
    const g = sheet.getContext('2d') as CanvasRenderingContext2D;
    avs.forEach((a, i) => {
      for (const o of avs) o.root.visible = o === a;
      camera.position.set(3.2, 1.0, 0.1);
      camera.fov = 34;
      camera.updateProjectionMatrix();
      camera.lookAt(0, 0.65, 0.1);
      engine.renderManual();
      g.drawImage(canvas, i * 640, 0, 640, 360);
      camera.position.set(2.2, 1.5, 2.6);
      camera.lookAt(0, 0.7, 0.15);
      engine.renderManual();
      g.drawImage(canvas, i * 640, 360, 640, 360);
    });
    kitShots.push(['bikes-kits', sheet.toDataURL('image/jpeg', 0.9)]);
    if (!params.has('noshot')) for (const [name, data] of kitShots) await fetch(`/__shot?name=${name}`, { method: 'POST', body: data });
    (window as unknown as { __kitsShot: string }).__kitsShot = kitShots[0]?.[1] ?? '';
    (window as unknown as { __avatarTestDone: boolean }).__avatarTestDone = true;
    return;
  }

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
 * Ressemblance photo (?calib) : planche de validation (chaque profil de base rendu de face, et
 * le visage retrouvé à partir de ses repères avec l'étalonnage livré) ; &raw : repères bruts de
 * tous les rendus d'étalonnage, pour tools/blender/avatars/likeness_calib.py.
 */
async function likenessCalibration(engine: Awaited<ReturnType<typeof createEngine>>): Promise<void> {
  const { scene, camera } = engine;
  const { faceLandmarks } = await import('./onboarding/likeness.ts');
  const { fitSliders } = await import('./onboarding/likenessFit.ts');
  const a = new GltfRiderAvatar({ ...DEFAULT_LOOK, bikeModel: 's26-04-cervelo-s5' });
  a.update(0, 0, 0, 'seated');
  a.update(1 / 60, 0.0001, 0, 'seated');
  a.setBareHead(true);
  scene.add(a.root);
  a.root.updateMatrixWorld(true);
  const eye = a.eyeWorld(new THREE.Vector3());
  camera.fov = 22;
  camera.position.set(eye.x, eye.y + 0.01, eye.z + 0.7);
  camera.updateProjectionMatrix();
  camera.lookAt(eye.x, eye.y - 0.045, eye.z);
  const crop = document.createElement('canvas');
  crop.width = crop.height = 640;
  const cg = crop.getContext('2d') as CanvasRenderingContext2D;
  const t0 = performance.now();
  a.setFace({});
  engine.renderManual();
  cg.drawImage(canvas, 320, 40, 640, 640, 0, 0, 640, 640);
  const base = await faceLandmarks(crop);
  if (!base) throw new Error('aucun visage détecté sur la tête de base');
  console.log(`détection de la tête de base : ${(performance.now() - t0).toFixed(0)} ms`);
  // &raw : repères bruts de tous les rendus (réglage de la méthode hors ligne).
  if (params.has('raw')) {
    const lmOf = async (shape: Record<string, number>, yaw = 0, pitch = 0): Promise<number[]> => {
      a.setFace(shape);
      camera.position.set(eye.x + Math.sin(yaw) * Math.cos(pitch) * 0.7, eye.y + 0.01 + Math.sin(pitch) * 0.7, eye.z + Math.cos(yaw) * Math.cos(pitch) * 0.7);
      camera.lookAt(eye.x, eye.y - 0.045, eye.z);
      engine.renderManual();
      cg.drawImage(canvas, 320, 40, 640, 640, 0, 0, 640, 640);
      const lm = await faceLandmarks(crop);
      return lm ? lm.flatMap((q) => [+q.x.toFixed(5), +q.y.toFixed(5), +q.z.toFixed(5)]) : [];
    };
    const ids = FACE_SLIDERS.filter((x) => x.group !== 'body').map((x) => x.id);
    const out: Record<string, number[]> = { base: await lmOf({}) };
    for (const id of ids) {
      out[`${id}+`] = await lmOf({ [id]: 0.8 });
      out[`${id}-`] = await lmOf({ [id]: -0.8 });
    }
    // Poses de la tête de base (colonnes de nuisance de l'ajustement).
    for (const [k, yw, pt] of [['yaw+', 0.3, 0], ['yaw-', -0.3, 0], ['pitch+', 0, 0.2], ['pitch-', 0, -0.2]] as const) out[`pose:${k}`] = await lmOf({}, yw, pt);
    const truths: Record<string, Record<string, number>> = {};
    for (const p of BASE_PROFILES) {
      const truth = Object.fromEntries(ids.map((id) => [id, (p.shape as Record<string, number>)[id] ?? 0]));
      truths[p.id] = truth;
      out[`profile:${p.id}`] = await lmOf(truth);
      out[`profileYaw:${p.id}`] = await lmOf(truth, 0.35, 0.08);
    }
    log.textContent = `RAW${JSON.stringify({ lm: out, truths })}RAW`;
    (window as unknown as { __avatarTestDone: boolean }).__avatarTestDone = true;
    return;
  }
  if (params.has('probe')) {
    log.textContent = `PROBE ${base.length} repères`;
    (window as unknown as { __avatarTestDone: boolean }).__avatarTestDone = true;
    return;
  }
  // Validation visuelle : chaque profil (visage seul) rendu, repères détectés, curseurs retrouvés
  // avec l'étalonnage livré, puis rendu du résultat à côté.
  const { shapeVector } = await import('./onboarding/likenessFit.ts');
  const cal = (await import('./onboarding/likenessCalib.json')).default as unknown as Parameters<typeof fitSliders>[1];
  const ids = FACE_SLIDERS.filter((x) => x.group !== 'body').map((x) => x.id);
  const cw = 256;
  const sheet = document.createElement('canvas');
  sheet.width = 4 * cw;
  sheet.height = Math.ceil(BASE_PROFILES.length / 2) * cw;
  const g = sheet.getContext('2d') as CanvasRenderingContext2D;
  g.font = '600 15px system-ui, sans-serif';
  for (const [i, p] of BASE_PROFILES.entries()) {
    const truth = Object.fromEntries(ids.map((id) => [id, (p.shape as Record<string, number>)[id] ?? 0]));
    a.setFace(truth);
    // &yaw=0.35 : référence vue de biais (robustesse à la pose), le résultat est rendu de face.
    const yaw = Number(params.get('yaw') ?? 0);
    camera.position.set(eye.x + Math.sin(yaw) * 0.7, eye.y + 0.01, eye.z + Math.cos(yaw) * 0.7);
    camera.lookAt(eye.x, eye.y - 0.045, eye.z);
    engine.renderManual();
    cg.drawImage(canvas, 320, 40, 640, 640, 0, 0, 640, 640);
    camera.position.set(eye.x, eye.y + 0.01, eye.z + 0.7);
    camera.lookAt(eye.x, eye.y - 0.045, eye.z);
    const x = (i % 2) * 2 * cw;
    const y = Math.floor(i / 2) * cw;
    g.drawImage(crop, x, y, cw, cw);
    const lm = await faceLandmarks(crop);
    if (lm) {
      a.setFace(fitSliders(shapeVector(lm, cal, 1), cal));
      engine.renderManual();
      g.drawImage(canvas, 320, 40, 640, 640, x + cw, y, cw, cw);
    }
    g.fillStyle = '#000';
    g.fillText(`${p.name} (réf.)`, x + 6, y + 18);
    g.fillText(lm ? 'retrouvé' : 'non détecté', x + cw + 6, y + 18);
  }
  document.body.replaceChildren(sheet);
  sheet.style.cssText = 'display:block;width:100%;height:auto';
  (window as unknown as { __avatarTestDone: boolean }).__avatarTestDone = true;
}

/**
 * Planche des profils de base (?avatar=mpfb&profiles) : par profil, visage casqué et lunettes,
 * puis sans casque de face, de trois quarts et de profil.
 */
async function profileSheet(engine: Awaited<ReturnType<typeof createEngine>>): Promise<void> {
  const { scene, camera } = engine;
  const cw = 300;
  const views: Array<[string, boolean, [number, number, number]]> = [
    ['casque', true, [-0.3, 0.05, 0.42]], ['face', false, [-0.04, 0.02, 0.5]], ['3/4', false, [-0.32, 0.03, 0.4]], ['profil', false, [-0.5, 0.02, 0.02]],
  ];
  const sheet = document.createElement('canvas');
  sheet.width = views.length * cw;
  sheet.height = BASE_PROFILES.length * cw;
  const g = sheet.getContext('2d') as CanvasRenderingContext2D;
  g.font = '600 18px system-ui, sans-serif';
  camera.fov = 30;
  for (const [r, p] of BASE_PROFILES.entries()) {
    const a = new GltfRiderAvatar({ ...profileLook(p), bikeModel: 's26-04-cervelo-s5' });
    a.update(0, 0, 0, 'seated');
    a.update(1 / 60, 0.0001, 0, 'seated');
    scene.add(a.root);
    a.root.updateMatrixWorld(true);
    const eye = a.eyeWorld(new THREE.Vector3());
    for (const [c, [label, helmet, off]] of views.entries()) {
      a.root.traverse((o) => {
        if (/rider_(glasses|helmet)/.test(o.name)) o.visible = helmet && !o.name.startsWith('rider_helmet_aero');
      });
      camera.position.set(eye.x + off[0], eye.y + off[1], eye.z + off[2]);
      camera.updateProjectionMatrix();
      camera.lookAt(eye.x, eye.y - 0.05, eye.z - (label === 'profil' ? 0.02 : 0));
      engine.renderManual();
      g.drawImage(canvas, 340, 60, 600, 600, c * cw, r * cw, cw, cw);
      g.fillStyle = '#000';
      g.fillText(c === 0 ? `${p.name}, ${p.ageYears} ans` : label, c * cw + 8, r * cw + 22);
    }
    scene.remove(a.root);
  }
  document.body.replaceChildren(sheet);
  sheet.style.cssText = 'display:block;width:100%;height:auto';
  if (!params.has('noshot')) await fetch('/__shot?name=avatars-profils', { method: 'POST', body: sheet.toDataURL('image/jpeg', 0.88) });
  (window as unknown as { __avatarTestDone: boolean }).__avatarTestDone = true;
}

/**
 * Planche de têtes aléatoires (?avatar=mpfb&random=24[&seed=1][&nohelmet]) : tous les curseurs
 * tirés entre −0,8 et 0,8, passés par la tenue (look.face encodé, comme en réseau) ; casque et
 * lunettes en place pour repérer les interpénétrations.
 */
async function randomSheet(engine: Awaited<ReturnType<typeof createEngine>>): Promise<void> {
  const { scene, camera } = engine;
  const n = Number(params.get('random') || 24);
  let seed = Number(params.get('seed') ?? 1);
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const cols = 6;
  const cw = 240;
  const sheet = document.createElement('canvas');
  sheet.width = cols * cw;
  sheet.height = Math.ceil(n / cols) * cw;
  const g = sheet.getContext('2d') as CanvasRenderingContext2D;
  camera.fov = 30;
  for (let i = 0; i < n; i++) {
    const shape: FaceShape = {};
    for (const sl of FACE_SLIDERS) shape[sl.id] = sl.id.startsWith('origin') ? rnd() : (rnd() * 2 - 1) * 0.8;
    const a = new GltfRiderAvatar({ ...DEFAULT_LOOK, bikeModel: 's26-04-cervelo-s5', face: encodeFace(shape) });
    a.update(0, 0, 0, 'seated');
    a.update(1 / 60, 0.0001, 0, 'seated');
    if (params.has('nohelmet')) {
      a.root.traverse((o) => {
        if (/rider_(glasses|helmet)/.test(o.name)) o.visible = false;
      });
    }
    scene.add(a.root);
    const eye = a.eyeWorld(new THREE.Vector3());
    camera.position.set(eye.x - 0.3, eye.y + 0.05, eye.z + 0.42);
    camera.updateProjectionMatrix();
    camera.lookAt(eye.x, eye.y - 0.05, eye.z);
    engine.renderManual();
    g.drawImage(canvas, 340, 60, 600, 600, (i % cols) * cw, Math.floor(i / cols) * cw, cw, cw);
    scene.remove(a.root);
  }
  document.body.replaceChildren(sheet);
  sheet.style.cssText = 'display:block;width:100%;height:auto';
  (window as unknown as { __avatarTestDone: boolean }).__avatarTestDone = true;
}

/**
 * Planche des curseurs de forme (?avatar=mpfb&sliders[=nom1,nom2…]) : pour chaque curseur, −1,
 * base et +1, visage de trois quarts sans casque (curseurs de corps : buste entier).
 */
async function sliderSheet(engine: Awaited<ReturnType<typeof createEngine>>): Promise<void> {
  const { scene, camera } = engine;
  const a = new GltfRiderAvatar({ ...DEFAULT_LOOK, bikeModel: 's26-04-cervelo-s5' });
  a.update(0, 0, 0, 'seated');
  a.update(1 / 60, 0.0001, 0, 'seated');
  a.root.traverse((o) => {
    if (/rider_(glasses|helmet)/.test(o.name)) o.visible = false;
  });
  scene.add(a.root);
  const all = new Set<string>();
  a.root.traverse((o) => {
    const id = (o as THREE.Mesh).geometry?.userData.identity as { names: string[] } | undefined;
    id?.names.forEach((n) => all.add(n.slice(0, -1)));
  });
  const BODY = new Set(['sex', 'age', 'weight', 'muscle', 'shoulders', 'neckWidth', 'originAfrican', 'originAsian', 'originEuropean']);
  const list = (params.get('sliders') || [...all].join(',')).split(',').filter((n) => all.has(n));
  const cw = 300;
  const ch = 300;
  const sheet = document.createElement('canvas');
  sheet.width = cw * 3 * 2;
  sheet.height = ch * Math.ceil(list.length / 2);
  const g = sheet.getContext('2d') as CanvasRenderingContext2D;
  g.font = '600 16px system-ui, sans-serif';
  const eye = a.eyeWorld(new THREE.Vector3());
  camera.fov = 30;
  // &lod : le même coureur à 5, 15 et 45 m (téléobjectif : même taille à l'écran), un niveau par case.
  if (params.has('lod')) {
    sheet.width = 3 * cw;
    sheet.height = ch;
    g.font = '600 16px system-ui, sans-serif';
    const lod = (a as unknown as { lod: THREE.LOD }).lod;
    for (const [i, d] of [5, 15, 45].entries()) {
      a.update(1 / 30, 0.0001, 9, 'seated');
      const fov = 2 * Math.atan(1.1 / d) * (180 / Math.PI);
      camera.fov = fov;
      camera.position.set(-d * 0.55, 1.2, d * 0.84);
      camera.updateProjectionMatrix();
      camera.lookAt(0, 0.9, 0.2);
      engine.renderManual();
      g.drawImage(canvas, 280, 0, 720, 720, i * cw, 0, cw, ch);
      g.fillStyle = '#000';
      g.fillText(`${d} m · niveau ${lod.levels.filter((l) => l.distance <= d).length - 1}`, i * cw + 8, 20);
    }
    a.root.traverse((o) => {
      if (/rider_(glasses|helmet)/.test(o.name)) o.visible = true;
    });
    document.body.replaceChildren(sheet);
    sheet.style.cssText = 'display:block;width:100%;height:auto';
    (window as unknown as { __avatarTestDone: boolean }).__avatarTestDone = true;
    return;
  }
  // &skin : peau (teint, rides, barbe, taches de rousseur, rougeur d'effort et sueur).
  if (params.has('skin')) {
    const looks: Array<[string, Partial<AvatarLook>, number]> = [
      ['base', {}, 0.6], ['teint foncé', { skin: '#6b4430' }, 0.6], ['âgé', { face: encodeFace({ age: 1 }) }, 0.6],
      ['barbe', { beard: 1, hair: '#2a1d14' }, 0.6], ['rousseur', { skin: '#f0c8a8', freckles: 1, hair: '#b5652d' }, 0.6],
      ['effort 20 min', {}, 1.35],
    ];
    sheet.width = 3 * cw;
    sheet.height = 2 * ch;
    g.font = '600 16px system-ui, sans-serif';
    for (const [i, [label, lk, ftp]] of looks.entries()) {
      const b = new GltfRiderAvatar({ ...DEFAULT_LOOK, bikeModel: 's26-04-cervelo-s5', ...lk });
      b.root.traverse((o) => {
        if (/rider_(glasses|helmet)/.test(o.name)) o.visible = false;
      });
      scene.remove(a.root);
      scene.add(b.root);
      b.setEffort(ftp);
      for (let t = 0; t < 1200; t += 0.5) b.update(0.5, 90, 9, 'seated');
      b.update(1 / 30, 0.0001, 9, 'seated');
      b.root.updateMatrixWorld(true);
      const e = b.eyeWorld(new THREE.Vector3());
      camera.position.set(e.x - 0.16, e.y + 0.0, e.z + 0.42);
      camera.updateProjectionMatrix();
      camera.lookAt(e.x, e.y - 0.05, e.z);
      engine.renderManual();
      const x = (i % 3) * cw;
      const y = Math.floor(i / 3) * ch;
      g.drawImage(canvas, 390, 90, 500, 500, x, y, cw, ch);
      g.fillStyle = '#000';
      g.fillText(label, x + 8, y + 20);
      scene.remove(b.root);
    }
    document.body.replaceChildren(sheet);
    sheet.style.cssText = 'display:block;width:100%;height:auto';
    (window as unknown as { __avatarTestDone: boolean }).__avatarTestDone = true;
    return;
  }
  // &effort : visage en sortie (FaceAnimator) dans quatre situations, après 10 s simulées.
  if (params.has('effort')) {
    const cases: Array<[string, number, number, RiderPose, number]> = [
      ['au train', 0.65, 85, 'seated', 9], ['au seuil', 1.05, 90, 'seated', 8],
      ['à bloc', 1.4, 95, 'seated', 7], ['sprint', 1.8, 110, 'standing', 15], ['descente', 0, 0, 'coasting', 16],
    ];
    sheet.width = cases.length * cw;
    sheet.height = ch;
    g.font = '600 16px system-ui, sans-serif';
    for (const [i, [label, ftp, cad, pose, v]] of cases.entries()) {
      const b = new GltfRiderAvatar({ ...DEFAULT_LOOK, bikeModel: 's26-04-cervelo-s5' });
      b.root.traverse((o) => {
        if (/rider_(glasses|helmet)/.test(o.name)) o.visible = false;
      });
      scene.remove(a.root);
      scene.add(b.root);
      b.setEffort(ftp);
      for (let t = 0; t < 10.13; t += 1 / 30) b.update(1 / 30, cad, v, pose);
      b.root.updateMatrixWorld(true);
      const e = b.eyeWorld(new THREE.Vector3());
      camera.position.set(e.x - 0.12, e.y - 0.01, e.z + 0.34);
      camera.updateProjectionMatrix();
      camera.lookAt(e.x, e.y - 0.05, e.z);
      engine.renderManual();
      g.drawImage(canvas, 390, 90, 500, 500, i * cw, 0, cw, ch);
      g.fillStyle = '#000';
      g.fillText(label, i * cw + 8, 20);
      scene.remove(b.root);
    }
    document.body.replaceChildren(sheet);
    sheet.style.cssText = 'display:block;width:100%;height:auto';
    (window as unknown as { __avatarTestDone: boolean }).__avatarTestDone = true;
    return;
  }
  // &expr : formes d'expression (une par case, poids 1) au lieu des curseurs.
  if (params.has('expr')) {
    const names = new Set<string>();
    a.root.traverse((o) => {
      const d = (o as THREE.Mesh).morphTargetDictionary;
      if (d) Object.keys(d).forEach((n) => names.add(n));
    });
    const ex = [...names];
    const cols = 6;
    sheet.width = cols * cw;
    sheet.height = Math.ceil((ex.length + 1) / cols) * ch;
    g.font = '600 16px system-ui, sans-serif';
    for (const [i, name] of ['neutre', ...ex].entries()) {
      a.setExpressions(Object.fromEntries(ex.map((n) => [n, n === name ? 1 : 0])));
      camera.position.set(eye.x - 0.12, eye.y - 0.01, eye.z + 0.34);
      camera.updateProjectionMatrix();
      camera.lookAt(eye.x, eye.y - 0.05, eye.z);
      engine.renderManual();
      const x = (i % cols) * cw;
      const y = Math.floor(i / cols) * ch;
      g.drawImage(canvas, 390, 90, 500, 500, x, y, cw, ch);
      g.fillStyle = '#000';
      g.fillText(name, x + 8, y + 20);
    }
    document.body.replaceChildren(sheet);
    sheet.style.cssText = 'display:block;width:100%;height:auto';
    (window as unknown as { __avatarTestDone: boolean }).__avatarTestDone = true;
    return;
  }
  for (const [i, name] of list.entries()) {
    const body = BODY.has(name);
    for (const [j, v] of [-1, 0, 1].entries()) {
      a.setFace({ [name]: v });
      if (body) camera.position.set(eye.x - 1.1, eye.y - 0.1, eye.z + 1.5);
      else camera.position.set(eye.x - 0.2, eye.y + 0.01, eye.z + 0.3);
      camera.updateProjectionMatrix();
      camera.lookAt(eye.x, eye.y - (body ? 0.35 : 0.06), eye.z - (body ? 0.25 : 0));
      engine.renderManual();
      const x = ((i % 2) * 3 + j) * cw;
      const y = Math.floor(i / 2) * ch;
      if (body) g.drawImage(canvas, 280, 0, 720, 720, x, y, cw, ch);
      else g.drawImage(canvas, 390, 90, 500, 500, x, y, cw, ch);
      g.fillStyle = '#000';
      g.fillText(j === 1 ? name : (v > 0 ? '+1' : '−1'), x + 8, y + 20);
    }
  }
  a.setFace({});
  document.body.replaceChildren(sheet);
  sheet.style.cssText = 'display:block;width:100%;height:auto';
  (window as unknown as { __avatarTestDone: boolean }).__avatarTestDone = true;
}

/**
 * Banc de performance (docs/AVATARS.md § 10) : ?bench&quality=high&secs=30 — 10 coureurs animés
 * en peloton (pédalage, danseuse), caméra de poursuite ; fps moyen, 1 % bas, triangles.
 * Résultat dans window.__bench (et le journal de la page).
 */
async function bench(engine: Awaited<ReturnType<typeof createEngine>>): Promise<void> {
  const { scene, camera, renderer } = engine;
  const secs = Number(params.get('secs') ?? 30);
  const ids = BIKES.filter((b) => b.collection === 'saison-2026').slice(0, 10);
  GltfRiderAvatar.lodScale = { low: 0.6, medium: 0.8, high: 1, ultra: 1.5 }[(params.get('quality') ?? 'high') as QualityLevel] ?? 1;
  await GltfRiderAvatar.load([...new Set(ids.map((b) => b.family))]);
  const riders = ids.map((b, i) => {
    const a = new GltfRiderAvatar({ ...DEFAULT_LOOK, bikeModel: b.id });
    // Deux files, 2 m entre roues, décalées.
    a.root.position.set((i % 2) * 0.7 - 0.35, 0, -Math.floor(i / 2) * 2.1 - (i % 2) * 0.6);
    scene.add(a.root);
    return { a, cadence: 80 + (i % 4) * 5, pose: (i % 5 === 4 ? 'standing' : 'seated') as RiderPose, phase: i * 0.7 };
  });
  for (const r of riders) r.a.update(r.phase, r.cadence, 9, r.pose, 0);
  camera.fov = 50;
  camera.updateProjectionMatrix();
  const frames: number[] = [];
  const t0 = performance.now();
  let last = t0;
  let tris = 0;
  let cpu = 0;
  await new Promise<void>((done) => {
    const loop = (): void => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      if (now > t0 + 1000) frames.push(now - last); // 1 s de chauffe
      last = now;
      const t = (now - t0) / 1000;
      const c0 = performance.now();
      for (const r of riders) {
        r.a.root.position.z -= 9 * Math.min(dt, 0.05);
        r.a.update(Math.min(dt, 0.05), r.cadence, 9, r.pose, 0);
      }
      if (now > t0 + 1000) cpu += performance.now() - c0;
      // Poursuite : derrière et au-dessus du dernier, qui ondule un peu.
      const tail = (riders[riders.length - 1] as (typeof riders)[number]).a.root.position;
      camera.position.set(Math.sin(t * 0.4) * 2.5, 2.0, tail.z + 5);
      camera.lookAt(0, 0.9, tail.z - 4);
      engine.render();
      tris = renderer.info.render.triangles;
      if (now < t0 + 1000 + secs * 1000) requestAnimationFrame(loop);
      else done();
    };
    requestAnimationFrame(loop);
  });
  const sorted = [...frames].sort((a, b) => b - a);
  const avg = frames.reduce((s, f) => s + f, 0) / frames.length;
  const worst = sorted.slice(0, Math.max(1, Math.floor(frames.length / 100)));
  const res = {
    avatar: params.get('avatar') ?? 'classic',
    quality: params.get('quality') ?? 'high',
    frames: frames.length,
    fps: +(1000 / avg).toFixed(1),
    low1: +(1000 / (worst.reduce((s, f) => s + f, 0) / worst.length)).toFixed(1),
    ms: +avg.toFixed(2),
    /** Mise à jour des 10 avatars (IK, pédalage) par image, en ms. */
    updateMs: +(cpu / frames.length).toFixed(3),
    triangles: tris,
  };
  log.textContent = JSON.stringify(res);
  (window as unknown as { __bench: unknown }).__bench = res;
  (window as unknown as { __avatarTestDone: boolean }).__avatarTestDone = true;
}

/**
 * Planche des vélos du catalogue vus de profil, côté transmission (?bikes=id1,id2… par préfixes,
 * vide : la planche des livrées des aperçus Blender ; &rider : avec le coureur ; &side=left :
 * côté gauche ; &view=3q : de trois quarts avant ; &view=back : de dos ; &view=face : visage ; &view=portrait : visage de face sans casque ; ?avatar=mpfb&face=jawWidth:1,… : avatar MPFB et ses curseurs ; &view=cockpit : poste de pilotage). Enregistrée comme bikes-client-<nom>.jpg (&name=…), sauf avec ?noshot ; &each : chaque vélo aussi dans out/bikes-render/<id>.jpg.
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
    // &profile=lea : tenue d'un profil de base.
    const prof = BASE_PROFILES.find((p) => p.id === params.get('profile'));
    const a = new GltfRiderAvatar({ ...(prof ? profileLook(prof) : DEFAULT_LOOK), bikeModel: b.id });
    // &face=jawWidth:1,noseLength:-0.5 : curseurs de visage (avatar MPFB, ?avatar=mpfb).
    const face = Object.fromEntries((params.get('face') ?? '').split(',').filter(Boolean).map((kv) => [kv.split(':')[0] as string, Number(kv.split(':')[1])]));
    if (Object.keys(face).length) a.setFace(face);
    a.update(0, 0, 0, 'seated');
    a.update(1 / 60, 0.0001, 0, 'seated');
    const riderOn = params.has('rider');
    a.root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) o.visible = riderOn;
    });
    scene.add(a.root);
    camera.fov = 30;
    const sx = left ? 1 : -1;
    if (params.get('view') === 'portrait') {
      // Portrait de face, sans lunettes ni casque : le modelé du visage.
      a.root.traverse((o) => {
        if (/rider_(glasses|helmet)/.test(o.name)) o.visible = false;
      });
      const eye = a.eyeWorld(new THREE.Vector3());
      camera.position.set(eye.x + sx * 0.12, eye.y + 0.02, eye.z + 0.55);
      camera.updateProjectionMatrix();
      camera.lookAt(eye.x, eye.y - 0.05, eye.z);
    } else if (params.get('view') === 'face') {
      // Gros plan du visage : yeux du coureur (pose courante, position chrono comprise).
      const eye = a.eyeWorld(new THREE.Vector3());
      camera.position.set(eye.x + sx * 0.45, eye.y + 0.05, eye.z + 0.75);
      camera.updateProjectionMatrix();
      camera.lookAt(eye.x, eye.y - 0.06, eye.z);
    } else if (params.get('view') === 'cockpitside') {
      camera.position.set(sx * 1.1, 0.95, 0.5);
      camera.updateProjectionMatrix();
      camera.lookAt(0, 0.88, 0.5);
    } else if (params.get('view') === 'cockpit') {
      camera.position.set(sx * 0.75, 1.15, 1.05);
      camera.updateProjectionMatrix();
      camera.lookAt(0, 0.88, 0.5);
    } else if (params.get('view') === '3q') camera.position.set(sx * 2.2, 1.5, 2.6);
    else if (params.get('view') === 'back') camera.position.set(sx * 1.2, 1.9, -3.4);
    else if (params.get('view') === 'wheel') {
      // Gros plan de la roue arrière (inscriptions des jantes).
      camera.position.set(sx * 2.3, 0.4, -0.45);
      camera.updateProjectionMatrix();
      camera.lookAt(0, 0.33, -0.45);
    }
    else camera.position.set(sx * (riderOn ? 4.4 : 3.4) * Number(params.get('zoom') ?? 1), riderOn ? 0.95 : 0.62, 0.09);
    if (!['face', 'portrait', 'cockpit', 'cockpitside', 'wheel'].includes(params.get('view') ?? '')) {
      camera.updateProjectionMatrix();
      camera.lookAt(0, riderOn ? 0.85 : 0.56, 0.09);
    }
    engine.renderManual();
    const x = (i % cols) * cw;
    const y = Math.floor(i / cols) * ch;
    g.drawImage(canvas, 160, 60, 960, 600, x, y, cw, ch);
    // &each : chaque vélo enregistré à part (out/bikes-render/<id>.jpg), pour les planches photo / rendu.
    if (params.has('each')) {
      const one = document.createElement('canvas');
      one.width = 960;
      one.height = 600;
      (one.getContext('2d') as CanvasRenderingContext2D).drawImage(canvas, 160, 60, 960, 600, 0, 0, 960, 600);
      await fetch(`/__shot?name=${b.id}&dir=bikes-render`, { method: 'POST', body: one.toDataURL('image/jpeg', 0.9) });
    }
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
