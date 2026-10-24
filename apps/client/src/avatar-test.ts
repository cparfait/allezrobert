import * as THREE from 'three/webgpu';
import { BASE_PROFILES, BIKES, COSMETICS, DEFAULT_LOOK, FACE_SLIDERS, encodeFace, jerseyLookOf, profileLook, type AvatarLook, type BikeModel, type FaceShape } from '@allezrobert/shared';
import { createEngine } from './engine/renderer.ts';
import { QUALITY_PRESETS, type QualityLevel } from './engine/quality.ts';
import { GltfRiderAvatar, type RiderPose } from './rider/gltfAvatar.ts';
import { preloadJerseyLogo } from './rider/jerseyPattern.ts';

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
  const q = params.has('bench') || params.has('shorts') ? preset : { ...QUALITY_PRESETS.high, ao: false, taa: false, bloom: false, pixelRatio: 1 };
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

  // ?posecheck=/__pose/a.jpg,/__pose/b.jpg : mesures de posture sur des photos (dev/poseCheck.ts).
  if (params.has('posecheck')) return (await import('./dev/poseCheck.ts')).poseSheet((params.get('posecheck') ?? '').split(',').filter(Boolean));
  const ok = await GltfRiderAvatar.load();
  log.textContent = ok ? 'modèles chargés' : 'ÉCHEC du chargement';
  if (!ok) return;
  if (params.has('bikes')) return bikeSheet(engine, params.get('bikes') ?? '');
  if (params.has('bench')) return bench(engine);
  if (params.has('sliders')) return sliderSheet(engine);
  if (params.has('random')) return randomSheet(engine);
  if (params.has('tailles')) return sizeSheet(engine);
  if (params.has('maillots')) return jerseySheet(engine);
  if (params.has('pack')) return packSheet(engine, params.get('pack') ?? '');
  if (params.has('sleeves')) return sleevesSheet(engine);
  if (params.has('bidons')) return bottlesSheet(engine);
  if (params.has('profiles')) return profileSheet(engine);
  if (params.has('measure')) return measureHead();
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
  // ?hands : gros plans des mains droite et gauche des trois coureurs (assis, danseuse, roue libre)
  // et distance paume → cintre mesurée en repère monde (window.__hands).
  // ?shorts : cuissard du coureur assis, de près, à distance moyenne et au loin (grain, moiré) ;
  // &bench&quality=ultra pour les réglages de la capture, &avatar=boutique pour l'autre modèle.
  if (params.has('shorts')) {
    const r = riders[0] as Rig;
    far.root.visible = false;
    for (const o of riders) o.a.root.visible = o === r;
    r.a.root.updateMatrixWorld(true);
    const sheet = document.createElement('canvas');
    sheet.width = 1920;
    sheet.height = 540;
    const g = sheet.getContext('2d') as CanvasRenderingContext2D;
    const c = new THREE.Vector3(r.a.root.position.x + 0.1, 0.98, -0.1);
    [[1.0, 30], [3.0, 24], [8.0, 12]].forEach(([d, fov], k) => {
      camera.fov = fov as number;
      camera.position.set(c.x + 0.8 * (d as number), c.y + 0.2 * (d as number), c.z + 0.6 * (d as number));
      camera.updateProjectionMatrix();
      camera.lookAt(c);
      for (let n = 0; n < 8; n++) engine.renderManual();
      g.drawImage(canvas, 320, 0, 640, 540, k * 640, 0, 640, 540);
    });
    document.body.replaceChildren(sheet);
    sheet.style.cssText = 'display:block;width:100%;height:auto';
    if (!params.has('noshot')) await fetch(`/__shot?name=avatar-cuissard-${params.get('name') ?? 'essai'}`, { method: 'POST', body: sheet.toDataURL('image/jpeg', 0.92) });
    (window as unknown as { __avatarTestDone: boolean }).__avatarTestDone = true;
    return;
  }
  // ?film : les dix coureurs du film d'accueil (tenues de ui/cinematic.ts), de face puis de profil.
  if (params.has('film')) {
    const { lookFor } = await import('./ui/cinematic.ts');
    for (const o of riders) o.a.root.visible = false;
    far.root.visible = false;
    const crew = Array.from({ length: 10 }, (_, i) => {
      const a = new GltfRiderAvatar(lookFor(i));
      a.root.position.set((i - 4.5) * 1.1, 0, 0);
      scene.add(a.root);
      for (let t = 0; t < 1; t += 1 / 60) a.update(1 / 60, 85, 9, 'seated', 0);
      return a;
    });
    void crew;
    const sheet = document.createElement('canvas');
    sheet.width = 1920;
    sheet.height = 1080;
    const g = sheet.getContext('2d') as CanvasRenderingContext2D;
    camera.fov = 22;
    camera.position.set(0, 1.5, 11);
    camera.updateProjectionMatrix();
    camera.lookAt(0, 0.95, 0);
    for (let n = 0; n < 4; n++) engine.renderManual();
    g.drawImage(canvas, 0, 0, 1280, 720, 0, 0, 1920, 540);
    camera.position.set(11, 1.5, 0.5);
    camera.lookAt(0, 0.95, 0.5);
    for (const [i, a] of crew.entries()) a.root.position.set(0, 0, (i - 4.5) * 1.1);
    for (let n = 0; n < 4; n++) engine.renderManual();
    g.drawImage(canvas, 0, 0, 1280, 720, 0, 540, 1920, 540);
    document.body.replaceChildren(sheet);
    sheet.style.cssText = 'display:block;width:100%;height:auto';
    if (!params.has('noshot')) await fetch('/__shot?name=avatar-film-tenues', { method: 'POST', body: sheet.toDataURL('image/jpeg', 0.92) });
    (window as unknown as { __avatarTestDone: boolean }).__avatarTestDone = true;
    return;
  }
  // ?profil : profil strict zoomé du haut du corps (dos, nuque, tête) des coureurs du film puis de
  // corpulences et tailles extrêmes ; &pose=standing|seated ; angles dans window.__profil.
  if (params.has('profil')) {
    const { lookFor } = await import('./ui/cinematic.ts');
    const pose = (params.get('pose') ?? 'seated') as RiderPose;
    // &morphs=a:1,b:-1 : un coureur par curseur de forme (valeur donnée), sur la tenue par défaut.
    const morphs = (params.get('morphs') ?? '').split(',').filter(Boolean);
    const looks: Array<[string, AvatarLook]> = morphs.length
      ? [['base', { ...DEFAULT_LOOK, bikeModel: 's26-04-cervelo-s5' }], ...morphs.map((m): [string, AvatarLook] => [m, { ...DEFAULT_LOOK, bikeModel: 's26-04-cervelo-s5', face: encodeFace({ [m.split(':')[0] as string]: Number(m.split(':')[1]) } as FaceShape) }])]
      : [
      ...Array.from({ length: 10 }, (_, i): [string, AvatarLook] => [`film${i}`, lookFor(i)]),
      ...([[160, 0], [160, 1], [175, 0], [175, 1], [195, 0], [195, 1]] as const).map(([h, b]): [string, AvatarLook] => [`${h}cm-b${b}`, { ...DEFAULT_LOOK, bikeModel: 's26-04-cervelo-s5', heightCm: h, build: b }]),
    ];
    // &only=film4,film6 : seulement ces coureurs.
    const only = (params.get('only') ?? '').split(',').filter(Boolean);
    if (only.length) looks.splice(0, looks.length, ...looks.filter(([n]) => only.includes(n)));
    for (const o of riders) o.a.root.visible = false;
    far.root.visible = false;
    const cols = 4;
    const cw = 480;
    const ch = 360;
    const sheet = document.createElement('canvas');
    sheet.width = cols * cw;
    sheet.height = Math.ceil(looks.length / cols) * ch;
    const g = sheet.getContext('2d') as CanvasRenderingContext2D;
    g.font = '600 16px sans-serif';
    const out: unknown[] = [];
    for (const [i, [name, look]] of looks.entries()) {
      const a = new GltfRiderAvatar(look);
      a.root.position.set(0, 0, 0);
      scene.add(a.root);
      for (let t = 0; t < 1; t += 1 / 60) a.update(1 / 60, pose === 'standing' ? 70 : 85, 9, pose, 0);
      a.root.updateMatrixWorld(true);
      const P = (n: string): THREE.Vector3 => (a.root.getObjectByName(n) as THREE.Object3D).getWorldPosition(new THREE.Vector3());
      const hip = P('thigh_l');
      const sh = P('upperarm_l');
      const nk = P('neck_01');
      const hd = P('head');
      const elev = (u: THREE.Vector3, v: THREE.Vector3): number => (Math.atan2(v.y - u.y, v.z - u.z) * 180) / Math.PI;
      // Angles de référence (docs/REFERENCE_POSTURE.md) : épaule (tronc / bras), coude, hanche (tronc / cuisse).
      const ang3 = (o: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3): number => (u.clone().sub(o).angleTo(v.clone().sub(o)) * 180) / Math.PI;
      const el = P('lowerarm_l');
      const wr = P('hand_l');
      const kn = P('calf_l');
      (window as unknown as { __ang: Record<string, unknown> }).__ang ??= {};
      ((window as unknown as { __ang: Record<string, unknown> }).__ang)[name] = { shoulder: +ang3(sh, hip, el).toFixed(1), elbow: +ang3(el, sh, wr).toFixed(1), hip: +ang3(hip, sh, kn).toFixed(1), neckVsBack: +(elev(nk, hd) - elev(hip, sh)).toFixed(1) };
      out.push({ name, back: +elev(hip, sh).toFixed(1), neck: +elev(nk, hd).toFixed(1), shDz: +(sh.z - hip.z).toFixed(3), shDy: +(sh.y - hip.y).toFixed(3), headFwd: +(hd.z - sh.z).toFixed(3) });
      camera.fov = Number(params.get('fov') ?? 9);
      // &rear : trois quarts arrière (vue du peloton) au lieu du profil strict.
      if (params.has('rear')) camera.position.set(-5.5, sh.y + 0.7, sh.z - 6.5);
      else camera.position.set(-9, sh.y, sh.z - 0.15);
      // &low : bas du dos, bassin et selle (au lieu des épaules).
      const low = params.has('low');
      if (low && !params.has('rear')) camera.position.set(-9, hip.y + 0.1, hip.z);
      camera.updateProjectionMatrix();
      camera.lookAt(0, low ? hip.y + 0.05 : sh.y - 0.05, low ? hip.z : sh.z - 0.15);
      for (let n = 0; n < 3; n++) engine.renderManual();
      g.drawImage(canvas, 240, 0, 800, 600, (i % cols) * cw, Math.floor(i / cols) * ch, cw, ch);
      g.fillStyle = '#000';
      g.fillRect((i % cols) * cw, Math.floor(i / cols) * ch, 90, 22);
      g.fillStyle = '#fff';
      g.fillText(name, (i % cols) * cw + 4, Math.floor(i / cols) * ch + 16);
      scene.remove(a.root);
    }
    (window as unknown as { __profil: unknown }).__profil = out;
    document.body.replaceChildren(sheet);
    sheet.style.cssText = 'display:block;width:100%;height:auto';
    if (!params.has('noshot')) await fetch(`/__shot?name=avatar-profil-${params.get('name') ?? 'essai'}`, { method: 'POST', body: sheet.toDataURL('image/jpeg', 0.92) });
    (window as unknown as { __avatarTestDone: boolean }).__avatarTestDone = true;
    return;
  }
  // ?refview : profil strict du coureur par défaut sur un vélo de route, avec les repères de mesure
  // (hanche, épaule, coude, poignet, genou, cheville, oreille) et angles ; comparé à docs/REFERENCE_POSTURE.md.
  if (params.has('refview')) {
    for (const o of riders) o.a.root.visible = false;
    far.root.visible = false;
    const a = new GltfRiderAvatar({ ...DEFAULT_LOOK, bikeModel: 's26-04-cervelo-s5' });
    scene.add(a.root);
    const priv = a as unknown as { crankAngle: number };
    priv.crankAngle = Math.PI + 0.25;
    a.update(0, 0.0001, 0, 'seated');
    priv.crankAngle = Math.PI + 0.25;
    a.update(1e-4, 0.0001, 0, 'seated');
    a.root.updateMatrixWorld(true);
    camera.fov = 14;
    camera.position.set(-6.5, 0.8, 0.1);
    camera.updateProjectionMatrix();
    camera.lookAt(0, 0.8, 0.1);
    for (let n = 0; n < 4; n++) engine.renderManual();
    const sheet = document.createElement('canvas');
    sheet.width = 1280;
    sheet.height = 720;
    const g = sheet.getContext('2d') as CanvasRenderingContext2D;
    g.drawImage(canvas, 0, 0, 1280, 720);
    const P = (n: string): THREE.Vector3 => (a.root.getObjectByName(n) as THREE.Object3D).getWorldPosition(new THREE.Vector3());
    const scr = (v: THREE.Vector3): [number, number] => {
      const q = v.clone().project(camera);
      return [((q.x + 1) / 2) * 1280, ((1 - q.y) / 2) * 720];
    };
    const pts: Record<string, THREE.Vector3> = { hip: P('thigh_r'), sh: P('upperarm_r'), el: P('lowerarm_r'), wr: P('hand_r'), kn: P('calf_r'), an: P('foot_r'), ear: P('head') };
    g.lineWidth = 3;
    g.strokeStyle = '#00e5ff';
    g.beginPath();
    for (const k of ['ear', 'sh', 'hip', 'kn', 'an']) g.lineTo(...scr(pts[k] as THREE.Vector3));
    g.stroke();
    g.beginPath();
    for (const k of ['sh', 'el', 'wr']) g.lineTo(...scr(pts[k] as THREE.Vector3));
    g.stroke();
    g.fillStyle = '#ff3d00';
    for (const v of Object.values(pts)) {
      const [x, y] = scr(v);
      g.beginPath();
      g.arc(x, y, 6, 0, 7);
      g.fill();
    }
    const ang3 = (o: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3): number => (u.clone().sub(o).angleTo(v.clone().sub(o)) * 180) / Math.PI;
    const elev = (u: THREE.Vector3, v: THREE.Vector3): number => (Math.atan2(v.y - u.y, v.z - u.z) * 180) / Math.PI;
    const info = { backDeg: +elev(pts.hip as THREE.Vector3, pts.sh as THREE.Vector3).toFixed(1), shoulderDeg: +ang3(pts.sh as THREE.Vector3, pts.hip as THREE.Vector3, pts.el as THREE.Vector3).toFixed(1), elbowDeg: +ang3(pts.el as THREE.Vector3, pts.sh as THREE.Vector3, pts.wr as THREE.Vector3).toFixed(1), hipDeg: +ang3(pts.hip as THREE.Vector3, pts.sh as THREE.Vector3, pts.kn as THREE.Vector3).toFixed(1), kneeDeg: +ang3(pts.kn as THREE.Vector3, pts.hip as THREE.Vector3, pts.an as THREE.Vector3).toFixed(1), neckElevDeg: +elev(P('neck_01'), pts.ear as THREE.Vector3).toFixed(1) };
    g.font = '28px sans-serif';
    g.fillStyle = '#000';
    g.fillText(Object.entries(info).map(([k, v]) => `${k} ${v}`).join('  '), 20, 700);
    (window as unknown as { __refview: unknown }).__refview = { ...info, pts: Object.fromEntries(Object.entries(pts).map(([k, v]) => [k, [+v.z.toFixed(3), +v.y.toFixed(3)]])) };
    document.body.replaceChildren(sheet);
    sheet.style.cssText = 'display:block;width:100%;height:auto';
    if (!params.has('noshot')) await fetch(`/__shot?name=avatar-ref-${params.get('name') ?? 'essai'}`, { method: 'POST', body: sheet.toDataURL('image/jpeg', 0.92) });
    (window as unknown as { __avatarTestDone: boolean }).__avatarTestDone = true;
    return;
  }
  if (params.has('hands')) {
    far.root.visible = false;
    const sheet = document.createElement('canvas');
    sheet.width = 1280;
    sheet.height = 1440;
    const g = sheet.getContext('2d') as CanvasRenderingContext2D;
    const stats: unknown[] = [];
    for (const [i, r] of riders.entries()) {
      for (const o of riders) o.a.root.visible = o === r;
      r.a.root.updateMatrixWorld(true);
      const wp = (n: string): THREE.Vector3 => (r.a.root.getObjectByName(n) as THREE.Object3D).getWorldPosition(new THREE.Vector3());
      const bars: THREE.Vector3[] = [];
      r.a.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || !m.visible || o.parent?.name !== 'cockpit') return;
        const p = m.geometry.getAttribute('position');
        for (let k = 0; k < p.count; k += 2) bars.push(new THREE.Vector3().fromBufferAttribute(p, k).applyMatrix4(m.matrixWorld));
      });
      const row: Record<string, unknown> = { pose: r.pose };
      for (const [si, s] of (['r', 'l'] as const).entries()) {
        const palm = wp(`hand_${s}`).add(wp(`middle_01_${s}`)).multiplyScalar(0.5);
        row[s] = +Math.min(...bars.map((b) => b.distanceTo(palm))).toFixed(3);
        const sx = s === 'r' ? -1 : 1;
        if (params.has('top')) {
          // Vue de dessus (avant du vélo en haut) : position avant / arrière des deux paumes.
          if (si === 0) {
            const mid = wp('hand_l').add(wp('hand_r')).multiplyScalar(0.5);
            camera.fov = 14;
            camera.position.set(mid.x, mid.y + 1.6, mid.z);
            camera.up.set(0, 0, 1);
            camera.updateProjectionMatrix();
            camera.lookAt(mid);
            camera.up.set(0, 1, 0);
            engine.renderManual();
            g.drawImage(canvas, 240, 0, 800, 480, 0, i * 480, 1280, 480);
          }
        } else {
          camera.fov = 18;
          camera.position.set(palm.x + sx * 0.5, palm.y + 0.35, palm.z + 0.55);
          camera.updateProjectionMatrix();
          camera.lookAt(palm);
          engine.renderManual();
          g.drawImage(canvas, 240, 0, 800, 480, si * 640, i * 480, 640, 480);
        }
      }
      stats.push(row);
    }
    (window as unknown as { __hands: unknown }).__hands = stats;
    if (!params.has('noshot')) await fetch(`/__shot?name=avatar-mains-${params.has('top') ? 'dessus' : 'gros-plans'}`, { method: 'POST', body: sheet.toDataURL('image/jpeg', 0.9) });
    document.body.replaceChildren(sheet);
    sheet.style.cssText = 'display:block;width:100%;height:auto';
    (window as unknown as { __avatarTestDone: boolean }).__avatarTestDone = true;
    return;
  }
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

/** Mesures (m, repère du modèle au repos) : lunettes, cils (yeux), largeur du crâne à hauteur des yeux. */
function measureHead(): void {
  const a = new GltfRiderAvatar({ ...DEFAULT_LOOK });
  a.root.updateMatrixWorld(true);
  a.root.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && (o as THREE.SkinnedMesh).skeleton.update());
  const out: Record<string, string> = {};
  const p = new THREE.Vector3();
  let headInv: THREE.Matrix4 | null = null;
  a.root.traverse((o) => {
    if (!headInv && o.name === 'head' && (o as THREE.Bone).isBone) headInv = o.matrixWorld.clone().invert();
  });
  const boxes = new Map<string, THREE.Box3>();
  let eyeY = 0;
  const pts: Array<[string, THREE.Vector3]> = [];
  a.root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || !m.visible) return;
    const pos = m.geometry.getAttribute('position');
    const groups = m.geometry.groups.length ? m.geometry.groups : [{ start: 0, count: m.geometry.index?.count ?? pos.count, materialIndex: 0 }];
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const idx = m.geometry.index;
    for (const g of groups) {
      const key = `${o.name}/${mats[g.materialIndex ?? 0]?.name}`;
      const b = boxes.get(key) ?? new THREE.Box3();
      for (let k = g.start; k < g.start + g.count; k++) {
        const i = idx ? idx.getX(k) : k;
        m.applyBoneTransform(i, p.fromBufferAttribute(pos, i)).applyMatrix4(m.matrixWorld);
        if (params.has('local') && headInv) p.applyMatrix4(headInv);
        b.expandByPoint(p);
        if (key.endsWith('/skin')) pts.push([key, p.clone()]);
      }
      boxes.set(key, b);
    }
  });
  const f = (v: THREE.Vector3) => `${v.x.toFixed(3)} ${v.y.toFixed(3)} ${v.z.toFixed(3)}`;
  for (const [k, b] of boxes) if (/glasses|lashes|helmet\/|mouth/.test(k)) out[k] = `${f(b.min)} → ${f(b.max)}`;
  const lashes = [...boxes].find(([k]) => k.endsWith('/lashes'))?.[1];
  if (lashes) {
    eyeY = (lashes.min.y + lashes.max.y) / 2;
    let hw = 0, front = -9, back = 9;
    for (const [, q] of pts) if (Math.abs(q.y - eyeY) < 0.01 && Math.abs(q.x) < 0.12) { hw = Math.max(hw, Math.abs(q.x)); front = Math.max(front, q.z); back = Math.min(back, q.z); }
    out.headAtEyes = `demi-largeur ${hw.toFixed(3)} avant ${front.toFixed(3)} arrière ${back.toFixed(3)}`;
  }
  for (const n of ['hand_l', 'middle_01_l', 'middle_03_l', 'index_01_l', 'pinky_01_l', 'thumb_02_l', 'lowerarm_l']) {
    const b = a.root.getObjectByName(n);
    if (b) out[`bone ${n}`] = f(b.getWorldPosition(new THREE.Vector3()));
  }
  const bk = a.root.getObjectByName('bike');
  for (const n of ['hand_L', 'pad_L']) {
    const o = bk?.getObjectByName(n);
    if (o) out[`ancre ${n}`] = f(o.getWorldPosition(new THREE.Vector3()));
  }
  log.textContent = JSON.stringify(out, null, 1);
  (window as unknown as { __measure: unknown }).__measure = out;
}

/**
 * Planche des profils de base (?avatar=mpfb&profiles) : par profil, visage casqué et lunettes,
 * puis sans casque de face, de trois quarts et de profil.
 */
async function profileSheet(engine: Awaited<ReturnType<typeof createEngine>>): Promise<void> {
  const { scene, camera } = engine;
  const cw = 300;
  const views: Array<[string, boolean, [number, number, number]]> = [
    ['casque', true, [-0.3, 0.05, 0.42]], ['face', false, [-0.04, 0.02, 0.5]], ['3/4', false, [-0.32, 0.03, 0.4]], ['profil', false, [-0.5, 0.02, 0.02]], ['profil casqué', true, [-0.5, 0.02, 0.02]], ['course', true, [-1.6, -0.25, 0.1]],
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
      camera.lookAt(eye.x, eye.y - (label === 'course' ? 0.3 : 0.05), eye.z - (label.startsWith('profil') ? 0.02 : 0));
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
 * Planche des tailles (?tailles) : coureurs de 1,60, 1,765 et 1,95 m sur le même vélo (taille de
 * cadre adaptée, roues et manivelles identiques), de profil côte à côte puis de trois quarts avant,
 * manivelle à l'horizontale → avatar-tailles.jpg.
 */
async function sizeSheet(engine: Awaited<ReturnType<typeof createEngine>>): Promise<void> {
  const { scene, camera } = engine;
  const heights = [160, params.get('avatar') === 'boutique' ? 176.5 : 175, 195];
  const riders = heights.map((h, i) => {
    const a = new GltfRiderAvatar({ ...DEFAULT_LOOK, bikeModel: 's26-04-cervelo-s5', heightCm: h, jersey: ['#d62828', '#1f6feb', '#2a9d8f'][i] as string });
    const priv = a as unknown as { crankAngle: number };
    priv.crankAngle = Math.PI / 2;
    a.update(0, 0.0001, 0, 'seated');
    a.root.position.set(0, 0, (i - 1) * 2.2);
    scene.add(a.root);
    return a;
  });
  const sheet = document.createElement('canvas');
  sheet.width = 1280;
  sheet.height = 1440;
  const g = sheet.getContext('2d') as CanvasRenderingContext2D;
  // Profil (téléobjectif : pas de perspective entre les trois).
  camera.fov = 5.2;
  camera.position.set(42, 1.0, 0);
  camera.updateProjectionMatrix();
  camera.lookAt(0, 0.95, 0);
  engine.renderManual();
  g.drawImage(canvas, 0, 0, 1280, 720);
  // Trois quarts avant, coureurs alignés de côté.
  riders.forEach((r, i) => r.root.position.set((i - 1) * 1.1, 0, 0));
  camera.fov = 30;
  camera.position.set(3.2, 1.6, 5.2);
  camera.updateProjectionMatrix();
  camera.lookAt(0, 0.8, 0);
  engine.renderManual();
  g.drawImage(canvas, 0, 720, 1280, 720);
  if (!params.has('noshot')) await fetch('/__shot?name=avatar-tailles', { method: 'POST', body: sheet.toDataURL('image/jpeg', 0.9) });
  log.textContent += '\ntailles : terminé';
  (window as unknown as { __avatarTestDone: boolean }).__avatarTestDone = true;
}

/**
 * Planche d'un pack de maillots du garage (?pack=pays|distinctifs|equipes|tour|pro ; &back : vu de dos) : une vignette par
 * maillot (tenue complète du catalogue), coureur de trois quarts avant → avatar-pack-<pack>.jpg.
 */
async function packSheet(engine: Awaited<ReturnType<typeof createEngine>>, pack: string): Promise<void> {
  const { scene, camera } = engine;
  const items = COSMETICS.filter((c) => c.slot === 'jersey' && c.pack === pack);
  const cols = 5;
  const cw = 320;
  const ch = 400;
  const sheet = document.createElement('canvas');
  sheet.width = cols * cw;
  sheet.height = Math.ceil(items.length / cols) * ch;
  const g = sheet.getContext('2d') as CanvasRenderingContext2D;
  g.font = '600 18px sans-serif';
  g.textAlign = 'center';
  camera.fov = params.has('torso') ? 9 : 22; // &torso : buste en gros plan (bandes des maillots)
  // Logos des maillots chargés avant le premier rendu ; &back : vu de dos.
  await Promise.all(items.map((i) => (i.jersey?.logo ? preloadJerseyLogo(i.jersey.logo.id) : null)));
  const back = params.has('back');
  camera.position.set(back ? -1.0 : 1.0, 1.75, back ? -3.6 : 3.6);
  camera.updateProjectionMatrix();
  camera.lookAt(0, params.has('torso') ? 1.12 : 1.0, 0.1);
  for (const [i, item] of items.entries()) {
    const helmet = item.jersey?.style === 'bandes' ? '#ffffff' : (item.color ?? '#ffffff');
    const a = new GltfRiderAvatar({ ...DEFAULT_LOOK, bikeModel: 's26-04-cervelo-s5', helmet, ...jerseyLookOf(item) });
    (a as unknown as { crankAngle: number }).crankAngle = Math.PI / 2;
    a.update(0, 0.0001, 0, 'seated');
    scene.add(a.root);
    engine.renderManual();
    const x = (i % cols) * cw;
    const y = Math.floor(i / cols) * ch;
    g.drawImage(canvas, 340, 0, 600, 750, x, y, cw, ch);
    g.fillStyle = '#000a';
    g.fillRect(x, y + ch - 30, cw, 30);
    g.fillStyle = '#fff';
    g.fillText(item.name.fr, x + cw / 2, y + ch - 9);
    scene.remove(a.root);
  }
  if (!params.has('noshot')) await fetch(`/__shot?name=avatar-pack-${pack}${back ? '-back' : ''}`, { method: 'POST', body: sheet.toDataURL('image/jpeg', 0.9) });
  if (params.has('show')) {
    document.body.replaceChildren(sheet);
    sheet.style.cssText = 'display:block;width:100%;height:auto';
  }
  log.textContent += `\npack ${pack} : ${items.length} maillots`;
  (window as unknown as { __avatarTestDone: boolean }).__avatarTestDone = true;
}

/**
 * Planche des maillots (?maillots) : jaune (uni), champion de France, champion du monde, uni
 * rouge et dessin d'origine recoloré, de trois quarts avant puis de dos → avatar-maillots.jpg.
 */
async function jerseySheet(engine: Awaited<ReturnType<typeof createEngine>>): Promise<void> {
  const { scene, camera } = engine;
  const looks: Array<Partial<AvatarLook>> = [
    { jersey: '#ffd200', jerseyAccent: '#ffd200', jerseyStyle: 'uni', helmet: '#ffd200' },
    { jersey: '#ffffff', jerseyStyle: 'bandes', jerseyBands: ['#1f3c88', '#ffffff', '#d71920'], helmet: '#ffffff' },
    { jersey: '#ffffff', jerseyStyle: 'bandes', jerseyBands: ['#0072ce', '#e4002b', '#111111', '#ffd100', '#009a44'], helmet: '#ffffff' },
    { jersey: '#c62828', jerseyAccent: '#c62828', jerseyStyle: 'uni', helmet: '#111111', shoes: '#111111' },
    { jersey: '#1f6feb', jerseyAccent: '#ffd23f', helmet: '#1f6feb' },
  ];
  const riders = looks.map((l, i) => {
    const a = new GltfRiderAvatar({ ...DEFAULT_LOOK, bikeModel: 's26-04-cervelo-s5', ...l });
    (a as unknown as { crankAngle: number }).crankAngle = Math.PI / 2;
    a.update(0, 0.0001, 0, 'seated');
    a.root.position.set((i - 2) * 0.95, 0, 0);
    scene.add(a.root);
    return a;
  });
  const sheet = document.createElement('canvas');
  sheet.width = 1280;
  sheet.height = 1440;
  const g = sheet.getContext('2d') as CanvasRenderingContext2D;
  camera.fov = 26;
  camera.position.set(1.2, 1.9, 5.6);
  camera.updateProjectionMatrix();
  camera.lookAt(0, 0.95, 0);
  engine.renderManual();
  g.drawImage(canvas, 0, 0, 1280, 720);
  camera.position.set(-1.2, 1.9, -5.0);
  camera.lookAt(0, 0.95, 0);
  engine.renderManual();
  g.drawImage(canvas, 0, 720, 1280, 720);
  if (!params.has('noshot')) await fetch('/__shot?name=avatar-maillots', { method: 'POST', body: sheet.toDataURL('image/jpeg', 0.9) });
  if (params.has('show')) {
    document.body.replaceChildren(sheet);
    sheet.style.cssText = 'display:block;width:100%;height:auto';
  }
  log.textContent += '\nmaillots : terminé';
  void riders;
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
 * côté gauche ; &view=3q : de trois quarts avant ; &view=upper : haut du corps de profil ; &view=back : de dos ; &view=face : visage ; &view=portrait : visage de face sans casque ; ?avatar=mpfb&face=jawWidth:1,… : avatar MPFB et ses curseurs ; &view=cockpit : poste de pilotage). Enregistrée comme bikes-client-<nom>.jpg (&name=…), sauf avec ?noshot ; &each : chaque vélo aussi dans out/bikes-render/<id>.jpg.
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
    // &biketype=gravel|mtb : kit du vélo (VTT, gravel) ; &pose=standing|coasting : posture du coureur.
    const bikeType = params.get('biketype');
    const a = new GltfRiderAvatar({ ...(prof ? profileLook(prof) : DEFAULT_LOOK), bikeModel: b.id, ...(bikeType === 'gravel' || bikeType === 'mtb' ? { bikeType } : {}) });
    // &face=jawWidth:1,noseLength:-0.5 : curseurs de visage (avatar MPFB, ?avatar=mpfb).
    const face = Object.fromEntries((params.get('face') ?? '').split(',').filter(Boolean).map((kv) => [kv.split(':')[0] as string, Number(kv.split(':')[1])]));
    if (Object.keys(face).length) a.setFace(face);
    a.update(0, 0, 0, 'seated');
    a.update(1 / 60, 0.0001, 0, 'seated');
    // &angles : angles de la posture (degrés), dans window.__angles : buste (hanche → épaule) et cou
    // (base du cou → tête) au-dessus de l'horizontale, extension du cou par rapport au buste,
    // épaule (buste / bras), coude (180 = tendu).
    if (params.has('angles')) {
      a.root.updateMatrixWorld(true);
      const P = (n: string) => (a.root.getObjectByName(n) as THREE.Object3D).getWorldPosition(new THREE.Vector3());
      const hip = P('thigh_l');
      const sh = P('upperarm_l');
      const el = P('lowerarm_l');
      const wr = P('hand_l');
      const nk = P('neck_01');
      const hd = P('head');
      const elev = (u: THREE.Vector3, v: THREE.Vector3) => (Math.atan2(v.y - u.y, v.z - u.z) * 180) / Math.PI;
      const ang = (o: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3) => (u.clone().sub(o).angleTo(v.clone().sub(o)) * 180) / Math.PI;
      const torso = elev(hip, sh);
      const neck = elev(nk, hd);
      // Profil du dos (mêmes conventions que dev/poseCheck.ts, sur la géométrie) : sommets du corps
      // proches du plan médian, écart à la corde hanche → épaule côté dos, en % du torse.
      const L = Math.hypot(sh.z - hip.z, sh.y - hip.y);
      const ux = (sh.z - hip.z) / L;
      const uy = (sh.y - hip.y) / L;
      const nz = -uy;
      const ny = ux;
      const best = new Array(12).fill(-1);
      const v = new THREE.Vector3();
      a.root.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (!m.isSkinnedMesh || !m.visible || !/^rider_body(\d+)?(_\d+)?$/.test(m.name)) return;
        const lvl = (m.parent as THREE.Object3D | null)?.visible !== false;
        if (!lvl) return;
        const pos = m.geometry.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          m.applyBoneTransform(i, v.fromBufferAttribute(pos, i)).applyMatrix4(m.matrixWorld);
          if (Math.abs(v.x - a.root.position.x) > 0.08) continue;
          const t = ((v.z - hip.z) * ux + (v.y - hip.y) * uy) / L;
          const k = Math.round((t - 0.08) / (0.84 / 11));
          if (k < 0 || k > 11) continue;
          const d = (v.z - hip.z) * nz + (v.y - hip.y) * ny;
          if (d > best[k]) best[k] = d;
        }
      });
      // cases vides : interpolées entre leurs voisines
      for (let k = 0; k < 12; k++) if (best[k] < 0) best[k] = ((best[k - 1] ?? best[k + 1]) + (best[k + 1] >= 0 ? best[k + 1] : (best[k - 1] ?? 0))) / 2;
      const b0 = best[0] as number;
      const b1 = best[11] as number;
      const back = best.map((d: number, k: number) => +(((d - (b0 + ((b1 - b0) * k) / 11)) / L) * 100).toFixed(1));
      const res = { torso: +torso.toFixed(1), neck: +neck.toFixed(1), neckExt: +(neck - torso).toFixed(1), shoulder: +ang(sh, hip, el).toFixed(1), elbow: +ang(el, sh, wr).toFixed(1), back, headFwd: +((P('head').z - sh.z) / L).toFixed(2), headUp: +((P('head').y - sh.y) / L).toFixed(2) };
      ((window as unknown as { __angles: unknown[] }).__angles ??= []).push(res);
    }
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
    } else if (params.get('view') === 'upper') {
      // Haut du corps de profil (cou, tête, épaules) : réglage de la posture.
      const eye = a.eyeWorld(new THREE.Vector3());
      camera.position.set(eye.x + sx * 2.2, eye.y - 0.2, eye.z - 0.3);
      camera.updateProjectionMatrix();
      camera.lookAt(eye.x, eye.y - 0.2, eye.z - 0.3);
    } else if (params.get('view') === 'cockpitside') {
      camera.position.set(sx * 1.1, 0.95, 0.5);
      camera.updateProjectionMatrix();
      camera.lookAt(0, 0.88, 0.5);
    } else if (params.get('view') === 'cockpit') {
      camera.position.set(sx * 0.75, 1.15, 1.05);
      camera.updateProjectionMatrix();
      camera.lookAt(0, 0.88, 0.5);
    } else if (params.get('view') === 'top') {
      // Cintre vu d'en haut : les deux mains (symétrie gauche / droite).
      camera.position.set(0, 2.1, 0.62);
      camera.up.set(0, 0, 1);
      camera.updateProjectionMatrix();
      camera.lookAt(0, 0.9, 0.6);
      camera.up.set(0, 1, 0);
    } else if (params.get('view') === 'front') {
      // Cintre vu de face (de l'avant du vélo).
      camera.position.set(0, 1.0, 1.5);
      camera.updateProjectionMatrix();
      camera.lookAt(0, 0.9, 0.55);
    } else if (params.get('view') === '3q') camera.position.set(sx * 2.2, 1.5, 2.6);
    else if (params.get('view') === 'back') camera.position.set(sx * 1.2, 1.9, -3.4);
    else if (params.get('view') === 'wheel') {
      // Gros plan de la roue arrière (inscriptions des jantes).
      camera.position.set(sx * 2.3, 0.4, -0.45);
      camera.updateProjectionMatrix();
      camera.lookAt(0, 0.33, -0.45);
    }
    else camera.position.set(sx * (riderOn ? 4.4 : 3.4) * Number(params.get('zoom') ?? 1), riderOn ? 0.95 : 0.62, 0.09);
    if (!['face', 'portrait', 'upper', 'cockpit', 'cockpitside', 'wheel', 'top', 'front'].includes(params.get('view') ?? '')) {
      camera.updateProjectionMatrix();
      camera.lookAt(0, riderOn ? 0.85 : 0.56, 0.09);
    }
    engine.renderManual();
    // &analyze : mêmes mesures de posture que sur les photos (dev/poseCheck.ts), repères tracés.
    if (params.has('analyze')) {
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      const cg = copy.getContext('2d') as CanvasRenderingContext2D;
      cg.drawImage(canvas, 0, 0);
      const { measurePose } = await import('./dev/poseCheck.ts');
      const m = await measurePose(copy, cg);
      ((window as unknown as { __pose: unknown[] }).__pose ??= []).push({ bike: b.id, m });
      await fetch(`/__shot?name=pose-${params.get('profile') ?? 'robert'}-${i}`, { method: 'POST', body: copy.toDataURL('image/jpeg', 0.9) });
      engine.renderManual();
    }
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

/**
 * Planche des manches (?sleeves) : 6 maillots (uni, bandes, pois, jaune du Tour, Visma, Lidl–Trek),
 * en manches courtes puis longues, de face, de trois quarts, de dos et mains sur le guidon
 * → avatar-manches[-<avatar>].jpg (&noshot : pas d'enregistrement).
 */
async function sleevesSheet(engine: Awaited<ReturnType<typeof createEngine>>): Promise<void> {
  const { scene, camera } = engine;
  // &close : gros plans (dessus, trois quarts, dos, poignet) sur six maillots dont le bleu à bande dorée par défaut.
  const close = params.has('close');
  const ids = close ? ['default', 'jersey-pois', 'jersey-champion-france', 'jersey-pro-redbull-bora', 'jersey-pro-astana', 'jersey-pro-lidl-trek'] : ['jersey-leader-rouge', 'jersey-champion-france', 'jersey-pois', 'jersey-leader-jaune', 'jersey-pro-visma', 'jersey-pro-lidl-trek'];
  const items = ids.map((id) => (id === 'default' ? ({ id, name: { fr: 'Bleu et bande dorée', en: 'Blue, gold band' }, slot: 'jersey', level: 1 } as (typeof COSMETICS)[number]) : COSMETICS.find((c) => c.id === id))).filter((c): c is NonNullable<typeof c> => !!c);
  await Promise.all(items.map((i) => (i.jersey?.logo ? preloadJerseyLogo(i.jersey.logo.id) : null)));
  const views: Array<{ fov: number; pos: [number, number, number]; at: [number, number, number] }> = close ? [
    { fov: 14, pos: [1.6, 1.25, 1.9], at: [0, 1.0, 0.45] },
    { fov: 22, pos: [0.1, 2.3, 1.0], at: [0, 1.0, 0.4] },
    { fov: 20, pos: [-1.5, 1.35, -1.3], at: [0, 1.05, 0.1] },
    { fov: 8, pos: [0.9, 1.1, 1.5], at: [0.15, 1.0, 0.55] },
  ] : [
    { fov: 24, pos: [1.0, 1.75, 3.6], at: [0, 1.0, 0.1] },
    { fov: 24, pos: [2.4, 1.5, 2.8], at: [0, 1.0, 0.1] },
    { fov: 24, pos: [-1.0, 1.75, -3.6], at: [0, 1.0, 0.1] },
    { fov: 16, pos: [1.6, 1.25, 1.9], at: [0, 1.0, 0.45] },
  ];
  const cw = 400;
  const ch = 300;
  const sheet = document.createElement('canvas');
  sheet.width = views.length * 2 * cw;
  sheet.height = items.length * ch;
  const g = sheet.getContext('2d') as CanvasRenderingContext2D;
  g.font = '600 16px sans-serif';
  for (const [row, item] of items.entries()) {
    for (const [col, long] of [false, true].entries()) {
      const a = new GltfRiderAvatar({ ...DEFAULT_LOOK, bikeModel: 's26-04-cervelo-s5', helmet: item.jersey?.style === 'bandes' ? '#ffffff' : (item.color ?? '#ffffff'), ...(item.id === 'default' ? {} : jerseyLookOf(item)), sleeves: long ? 'long' : 'short' });
      (a as unknown as { crankAngle: number }).crankAngle = Math.PI / 2;
      a.update(0, 0.0001, 0, 'seated');
      scene.add(a.root);
      for (const [vi, v] of views.entries()) {
        camera.fov = v.fov;
        camera.position.set(...v.pos);
        camera.updateProjectionMatrix();
        camera.lookAt(...v.at);
        engine.renderManual();
        const x = (col * views.length + vi) * cw;
        g.drawImage(canvas, 0, 0, canvas.width, canvas.height, x, row * ch, cw, ch);
        g.fillStyle = '#000a';
        g.fillRect(x, row * ch + ch - 22, cw, 22);
        g.fillStyle = '#fff';
        g.fillText(`${item.name.fr} · ${long ? 'longues' : 'courtes'}`, x + 8, row * ch + ch - 6);
      }
      scene.remove(a.root);
    }
  }
  const kind = params.get('avatar') ?? 'mpfb';
  if (!params.has('noshot')) await fetch(`/__shot?name=avatar-manches-${close ? 'gros-plans-' : ''}${kind}${params.has('dir') ? '&dir=jerseys' : ''}`, { method: 'POST', body: sheet.toDataURL('image/jpeg', 0.88) });
  log.textContent += '\nmanches : terminé';
  (window as unknown as { __avatarTestDone: boolean }).__avatarTestDone = true;
}

/**
 * Planche des bidons (?bidons) : route aéro, route acier, chrono, gravel, VTT avec 0, 1 et 2 bidons,
 * de trois quarts (pédalier à 90°), de profil (pédalier à 0°) et en danseuse → avatar-bidons[-<avatar>].jpg.
 */
async function bottlesSheet(engine: Awaited<ReturnType<typeof createEngine>>): Promise<void> {
  const { scene, camera } = engine;
  const tt = BIKES.find((b) => b.family === 'tt' && !b.params.track);
  const rows: Array<{ label: string; bike: string; type?: 'gravel' | 'mtb' }> = [
    { label: 'route aéro', bike: 's26-04-cervelo-s5' },
    { label: 'route acier', bike: BIKES.find((b) => b.family === 'steel')?.id ?? 's26-04-cervelo-s5' },
    { label: 'chrono', bike: tt?.id ?? 's26-04-cervelo-s5' },
    { label: 'gravel', bike: 's26-04-cervelo-s5', type: 'gravel' },
    { label: 'VTT', bike: 's26-04-cervelo-s5', type: 'mtb' },
  ];
  const { loadBikeFamily } = await import('./rider/bikes.ts');
  await Promise.all([...new Set(rows.map((r) => BIKES.find((x) => x.id === r.bike)?.family ?? 'aero'))].map((f) => loadBikeFamily(f)));
  const views: Array<{ pos: [number, number, number]; at: [number, number, number]; crank: number; pose: RiderPose }> = [
    { pos: [2.4, 1.4, 2.6], at: [0, 0.72, 0.1], crank: Math.PI / 2, pose: 'seated' },
    { pos: [4.0, 0.95, 0.09], at: [0, 0.72, 0.1], crank: 0, pose: 'seated' },
    { pos: [4.0, 0.95, 0.09], at: [0, 0.72, 0.1], crank: Math.PI / 3, pose: 'standing' },
  ];
  const cw = 360;
  const ch = 270;
  const sheet = document.createElement('canvas');
  sheet.width = 3 * views.length * cw;
  sheet.height = rows.length * ch;
  const g = sheet.getContext('2d') as CanvasRenderingContext2D;
  g.font = '600 15px sans-serif';
  camera.fov = 26;
  for (const [row, r] of rows.entries()) {
    for (const n of [0, 1, 2] as const) {
      const a = new GltfRiderAvatar({ ...DEFAULT_LOOK, bikeModel: r.bike, bottles: n, ...(r.type ? { bikeType: r.type } : {}) });
      scene.add(a.root);
      for (const [vi, v] of views.entries()) {
        (a as unknown as { crankAngle: number }).crankAngle = v.crank;
        a.update(0, 0.0001, 0, v.pose);
        camera.position.set(...v.pos);
        camera.updateProjectionMatrix();
        camera.lookAt(...v.at);
        engine.renderManual();
        const x = (n * views.length + vi) * cw;
        g.drawImage(canvas, 0, 0, canvas.width, canvas.height, x, row * ch, cw, ch);
        g.fillStyle = '#000a';
        g.fillRect(x, row * ch + ch - 22, cw, 22);
        g.fillStyle = '#fff';
        g.fillText(`${r.label} · ${n} bidon${n > 1 ? 's' : ''}`, x + 8, row * ch + ch - 6);
      }
      scene.remove(a.root);
    }
  }
  const kind = params.get('avatar') ?? 'mpfb';
  if (!params.has('noshot')) await fetch(`/__shot?name=avatar-bidons-${kind}&dir=bidons`, { method: 'POST', body: sheet.toDataURL('image/jpeg', 0.88) });
  log.textContent += '\nbidons : terminé';
  (window as unknown as { __avatarTestDone: boolean }).__avatarTestDone = true;
}
