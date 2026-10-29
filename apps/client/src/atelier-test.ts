import * as THREE from 'three/webgpu';
import { BIKES, COSMETICS, DEFAULT_LOOK, encodeFace, jerseyLookOf, RARITY_LABEL, TUNE_ITEMS, TUNE_KITS, kitPrice, type AvatarLook, type TuneSlot } from '@allezrobert/shared';
import { createEngine } from './engine/renderer.ts';
import { QUALITY_PRESETS } from './engine/quality.ts';
import { GltfRiderAvatar } from './rider/gltfAvatar.ts';
import { loadBikeFamily } from './rider/bikes.ts';
import { AtelierHost, type AtelierState, type Shot } from './ui/atelier.ts';
import { preloadJerseyLogo } from './rider/jerseyPattern.ts';

/**
 * Banc d'essai de l'atelier (développement) : /atelier-test.html rend l'atelier et le peloton
 * hors du menu, image par image (rendu manuel : fonctionne onglet masqué), et envoie les captures
 * à POST /__shot (docs/screenshots/). ?noshot pour juste regarder.
 *  - ?kits : chaque ensemble monté sur le pied d'atelier → kit-<id>.jpg, planche kit-planche.jpg ;
 *  - ?views : cadrages de l'atelier (roue, transmission, cockpit, selle, cadre, coureur) → atelier-*.jpg ;
 *  - ?rendu=<suffixe> : coureur en selle, trois cadrages rapprochés (trois quarts avant, profil,
 *    buste) → rendu-<cadrage>-<suffixe>.jpg, pour comparer le rendu avant / après un changement
 *    (&maillot=<id> : un maillot du catalogue ; &tenue=<json> : réglages de tenue ; &cam=x,y,z&look=x,y,z&fov=n : un seul cadrage libre) ;
 *  - ?profil&n=nom[&zoom][&silhouette] : profil du coureur au téléobjectif, angles du dos et du cou
 *    mesurés sur le squelette → profil-<nom>.jpg ; &tete : la tête seule (&casque : casquée, &tq : de
 *    trois quarts avant ; &cam=x,y,z&look=x,y,z&fov=n : cadrage libre ; &manivelle=<°> : manivelles figées) ;
 *  - ?peloton : 50 coureurs tous équipés différemment, vus de la caméra de poursuite → peloton-identite.jpg.
 *  - ?velo=<id>[&bottles=2] : un vélo du catalogue sur le pied (garage), trois quarts et deux profils → out/bikes-render/.
 */

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const log = document.getElementById('log') as HTMLElement;
const params = new URLSearchParams(location.search);
const W = 1600;
const H = 900;
const done = (): void => {
  (window as unknown as { __atelierTestDone: boolean }).__atelierTestDone = true;
};

async function shot(name: string, c: HTMLCanvasElement): Promise<void> {
  if (params.has('noshot')) return;
  await fetch(`/__shot?name=${name}`, { method: 'POST', body: c.toDataURL('image/jpeg', 0.9) });
}

function copyCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  (c.getContext('2d') as CanvasRenderingContext2D).drawImage(canvas, 0, 0, W, H);
  return c;
}

/** Vélo de démonstration : aéro 2026 (famille préchargée). */
const DEMO_BIKE = BIKES.find((b) => b.id.startsWith('s26-01-'))?.id ?? BIKES[0]?.id;

async function main(): Promise<void> {
  const engine = await createEngine(canvas, { ...QUALITY_PRESETS.high, taa: false, pixelRatio: 1 });
  engine.renderer.setPixelRatio(1);
  engine.renderer.setSize(W, H, false);
  const ok = await GltfRiderAvatar.load(['aero', 'climb', 'retro']);
  log.textContent = ok ? 'modèles chargés' : 'ÉCHEC du chargement';
  if (!ok) return;
  if (params.has('peloton')) return peloton(engine);
  const host = new AtelierHost(engine);
  // &maillot=<id> : maillot du catalogue (cosmetics.json) porté par le coureur.
  const jerseyItem = COSMETICS.find((c) => c.slot === 'jersey' && c.id === params.get('maillot'));
  const maillot = jerseyItem ? jerseyLookOf(jerseyItem) : {};
  if (jerseyItem?.jersey?.logo) await preloadJerseyLogo(jerseyItem.jersey.logo.id);
  // &tenue=<json> : réglages de tenue en plus (ex. {"noHelmet":true,"noGlasses":true}).
  const tenue = (params.has('tenue') ? JSON.parse(params.get('tenue') as string) : {}) as Partial<AvatarLook>;
  const look = (tune: string[], extra: Partial<AvatarLook> = {}): AvatarLook => ({ ...DEFAULT_LOOK, ...(params.has('female') ? { face: encodeFace({ sex: -1, ...(params.has('cou') ? { neckWidth: Number(params.get('cou')) } : {}) }) } : {}), ...(DEMO_BIKE ? { bikeModel: DEMO_BIKE } : {}), ...(params.has('coiffure') ? { hairStyle: Number(params.get('coiffure')), hair: '#3a2416' } : {}), ...maillot, ...tenue, tune, ...extra });
  const render = async (st: AtelierState) => {
    host.set(st);
    // Familles et textures : quelques images pour que tout arrive.
    await new Promise((r) => setTimeout(r, 400));
    host.renderManual();
    await new Promise((r) => setTimeout(r, 60));
    host.renderManual();
    return copyCanvas();
  };
  if (params.has('plaques')) {
    // Plaque de cadre sur chaque famille de vélo : doit tenir à la tige de selle.
    for (const fam of ['aero', 'climb', 'retro', 'steel', 'lotus', 'lowpro', 'tt', 'retro_compact']) {
      const id = BIKES.find((b) => b.family === fam)?.id;
      if (!id) continue;
      await loadBikeFamily(fam as Parameters<typeof loadBikeFamily>[0]).catch(() => undefined);
      const c = await render({ look: { ...DEFAULT_LOOK, bikeModel: id, tune: ['tune-nu-92'] }, focus: 'number', rider: false, yaw: 0 });
      await shot(`plaque-${fam}`, c);
    }
    return done();
  }
  if (params.has('kits')) {
    const sheet = document.createElement('canvas');
    sheet.width = 5 * 480;
    sheet.height = 2 * 270;
    const sg = sheet.getContext('2d') as CanvasRenderingContext2D;
    for (const [i, k] of TUNE_KITS.entries()) {
      const c = await render({ look: look(k.pieces ?? []), focus: 'overview', rider: false, yaw: -0.25 });
      const g = c.getContext('2d') as CanvasRenderingContext2D;
      // Carte : badge, nom, rareté, titre de l'ensemble complet.
      const rar = RARITY_LABEL[k.rarity];
      g.fillStyle = 'rgba(10,13,20,0.78)';
      g.beginPath();
      g.roundRect(40, H - 190, 640, 150, 18);
      g.fill();
      g.fillStyle = k.badge ?? rar.color;
      g.beginPath();
      g.arc(100, H - 115, 34, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#0a0e16';
      g.font = '900 34px Arial';
      g.textAlign = 'center';
      g.fillText('★', 100, H - 103);
      g.textAlign = 'left';
      g.fillStyle = '#fff';
      g.font = '800 40px Arial';
      g.fillText(k.name.fr, 152, H - 120);
      g.fillStyle = rar.color;
      g.font = '800 20px Arial';
      g.fillText(`${rar.fr.toUpperCase()} · ${(k.pieces ?? []).length} pièces · ${kitPrice(k)} crédits`, 152, H - 88);
      g.fillStyle = '#c9d1db';
      g.font = '600 20px Arial';
      g.fillText(`Titre : « ${k.title?.fr ?? ''} »`, 152, H - 58);
      await shot(`kit-${k.id.replace(/^kit-/, '')}`, c);
      sg.drawImage(c, 0, 0, W, H, (i % 5) * 480, Math.floor(i / 5) * 270, 480, 270);
    }
    document.body.replaceChildren(sheet);
    sheet.style.cssText = 'display:block;width:100%;height:auto';
    await shot('kit-planche', sheet);
    return done();
  }
  if (params.has('views')) {
    const views: Array<[string, TuneSlot | 'overview', string[], boolean, number, Partial<AvatarLook>?]> = [
      ['atelier-vue', 'overview', ['tune-wh-enve-67', 'tune-pa-aurore', 'tune-fi-irise', 'tune-gl-cyan', 'tune-tp-blanche', 'tune-nu-51'], false, -0.2],
      ['atelier-roue', 'wheelset', ['tune-wh-dt-arc50', 'tune-ty-corsa-gum', 'tune-rd-or', 'tune-va-or', 'tune-sk-or', 'tune-pa-chrome'], false, 0],
      ['atelier-transmission', 'groupset', ['tune-gs-red', 'tune-ch-or', 'tune-pu-ospw', 'tune-cr-carbon', 'tune-pa-carbone', 'tune-wh-enve-67'], false, 0],
      ['atelier-cockpit', 'cockpit', ['tune-ck-aero', 'tune-tp-neon', 'tune-co-wahoo', 'tune-tc-or', 'tune-es-bleu', 'tune-pa-neon-nuit'], false, 0],
      ['atelier-selle', 'number', ['tune-nu-13', 'tune-sa-antares', 'tune-sp-carbon', 'tune-pa-glacier', 'tune-st-robert'], false, 0],
      ['atelier-cadre', 'paint', ['tune-pa-glacier', 'tune-wh-zipp-303', 'tune-rd-glace', 'tune-st-kom'], false, 0],
      ['atelier-coureur', 'overview', ['tune-pa-eclair', 'tune-wh-dt-arc50', 'tune-rd-noir', 'tune-bo-rouge', 'tune-ty-gp5000'], true, -0.3],
    ];
    for (const [name, focus, tune, rider, yaw, extra] of views) {
      if (params.has('sel') && !name.endsWith(params.get('sel') as string)) continue; // &sel=vue : une seule vue
      const c = await render({ look: look(tune, extra), focus, rider, yaw });
      await shot(name, c);
    }
    return done();
  }
  if (params.has('velo')) {
    // ?velo=<id>[&bottles=2] : un vélo du catalogue sur le pied de l'atelier, cadrage du garage (trois quarts)
    // puis profils droit (transmission) et gauche → out/bikes-render/atelier-<id>-<vue>.jpg.
    const id = params.get('velo') as string;
    const fam = BIKES.find((b) => b.id === id)?.family;
    if (fam) await loadBikeFamily(fam);
    const extra: Partial<AvatarLook> = { bikeModel: id, ...(params.has('bottles') ? { bottles: Number(params.get('bottles')) as 0 | 1 | 2 } : {}) };
    const lift = 0.5;
    const views: Array<[string, Shot | undefined]> = [
      ['3q', undefined],
      ['droite', { cam: [-1.95, 0.62 + lift, 0.09], look: [0, 0.6 + lift, 0.09], fov: 42 }],
      ['gauche', { cam: [1.95, 0.62 + lift, 0.09], look: [0, 0.6 + lift, 0.09], fov: 42 }],
    ];
    for (const [name, view] of views) {
      const c = await render({ look: look([], extra), focus: 'overview', rider: false, yaw: 0, ...(view ? { view } : {}) });
      if (!params.has('noshot')) await fetch(`/__shot?name=atelier-${id}-${name}&dir=bikes-render`, { method: 'POST', body: c.toDataURL('image/jpeg', 0.9) });
    }
    return done();
  }
  if (params.has('rendu')) {
    const tag = (params.get('rendu') || 'essai').replace(/[^a-z0-9_-]/gi, '_');
    const vec = (k: string) => (params.get(k) ?? '').split(',').map(Number) as [number, number, number];
    // &cam=x,y,z&look=x,y,z&fov=n : un seul cadrage libre (rendu-libre-<suffixe>.jpg).
    const views: Array<[string, Shot]> = params.has('cam')
      ? [['libre', { cam: vec('cam'), look: vec('look'), fov: Number(params.get('fov') ?? 30) }]]
      : [
          ['trois-quarts', { cam: [1.55, 1.95, 2.05], look: [0, 0.95, 0.12], fov: 30 }],
          ['profil', { cam: [2.75, 1.25, 0.1], look: [0, 1.0, 0.05], fov: 32 }],
          ['buste', { cam: [1.05, 1.62, 1.5], look: [0, 1.3, 0.28], fov: 28 }],
        ];
    const tune = ['tune-pa-eclair', 'tune-wh-dt-arc50', 'tune-rd-noir', 'tune-bo-rouge', 'tune-ty-gp5000'];
    for (const [name, view] of views) {
      // &pose=standing|seated&cadence=70&img=N&vitesse=m/s : coureur posé (N images à 60 i/s, la manivelle tourne).
      const pose = params.has('pose') ? { pose: params.get('pose') as 'standing' | 'seated', cadence: Number(params.get('cadence') ?? 70), frames: Number(params.get('img') ?? 120), speed: Number(params.get('vitesse') ?? 5) } : undefined;
      const c = await render({ look: look(tune), focus: 'overview', rider: true, yaw: 0, view, ...(pose ? { pose } : {}) });
      await shot(`rendu-${name}-${tag}`, c);
    }
    return done();
  }
  if (params.has('profil')) {
    // Profil du coureur au téléobjectif, angles mesurés sur le squelette ; &zoom : buste et tête ;
    // &silhouette : coureur et vélo en noir sur fond blanc (comparaison avec des photos).
    const tune = ['tune-pa-eclair', 'tune-wh-dt-arc50', 'tune-rd-noir', 'tune-bo-rouge', 'tune-ty-gp5000'];
    // &cam=x,y,z&look=x,y,z[&fov=n] : cadrage libre (fesses sur la selle, détails).
    const vec = (k: string) => (params.get(k) ?? '').split(',').map(Number) as [number, number, number];
    const view: Shot = params.has('cam') ? { cam: vec('cam'), look: vec('look'), fov: Number(params.get('fov') ?? 20) } : params.has('tete') ? { cam: params.has('tq') ? [0.95, 1.62, 1.12] : [1.1, 1.53, 0.2], look: [0, params.has('tq') ? 1.56 : 1.53, 0.2], fov: 16 } : params.has('zoom') ? { cam: [3.4, 1.32, 0.2], look: [0, 1.3, 0.16], fov: 12 } : { cam: [6, 1.2, 0.12], look: [0, 1.15, 0.12], fov: 13 };
    const st: AtelierState = { look: look(tune), focus: 'overview', rider: true, yaw: 0, view, bareHead: params.has('tete') && !params.has('casque') };
    host.set(st);
    const h = host as unknown as { scene: THREE.Scene; avatar: { root: THREE.Object3D; setGesture?(g: { crank?: number }): void }; bikeRoot: THREE.Object3D };
    // &manivelle=<°> : manivelles figées à cet angle (comparer les deux côtés dans des poses symétriques).
    if (params.has('manivelle')) h.avatar.setGesture?.({ crank: (Number(params.get('manivelle')) * Math.PI) / 180 });
    if (params.has('silhouette')) {
      for (const o of h.scene.children) o.visible = o === h.bikeRoot;
      h.scene.background = new THREE.Color('#ffffff');
      h.scene.overrideMaterial = new THREE.MeshBasicNodeMaterial({ color: '#000000' });
    }
    const c = await render(st);
    const root = h.avatar.root;
    root.updateMatrixWorld(true);
    const P = (n: string) => (root.getObjectByName(n) as THREE.Object3D).getWorldPosition(new THREE.Vector3());
    const ang = (a: THREE.Vector3, b: THREE.Vector3) => (Math.atan2(b.y - a.y, b.z - a.z) * 180) / Math.PI;
    const pel = P('pelvis'), sp3 = P('spine_03'), nk = P('neck_01'), hd = P('head'), sh = P('upperarm_l');
    const m = { dos: ang(pel, sp3), hautDuDos: ang(sp3, nk), cou: ang(nk, hd), devant: (hd.z - sh.z) * 100, dessus: (hd.y - sh.y) * 100 };
    (window as unknown as { __mesure: unknown }).__mesure = m;
    (window as unknown as { __root: unknown }).__root = root; // squelette, pour mesurer les angles à la console
    if (!params.has('silhouette')) {
      const g = c.getContext('2d') as CanvasRenderingContext2D;
      g.fillStyle = 'rgba(10,13,20,0.75)';
      g.fillRect(20, 20, 640, 76);
      g.fillStyle = '#fff';
      g.font = '600 22px Arial';
      g.fillText(`dos ${m.dos.toFixed(0)}° · haut du dos ${m.hautDuDos.toFixed(0)}° · cou ${m.cou.toFixed(0)}°`, 36, 52);
      g.fillText(`tête / épaule : ${m.devant.toFixed(1)} cm devant, ${m.dessus.toFixed(1)} cm au-dessus`, 36, 84);
    }
    await shot(`profil-${params.get('n') ?? 'essai'}`, c);
    return done();
  }
  log.textContent = '?kits, ?views, ?rendu, ?profil ou ?peloton';
}

/** Peloton de 50 : chacun ses pièces (ensembles, livrées, jantes lumineuses), caméra de poursuite. */
async function peloton(engine: Awaited<ReturnType<typeof createEngine>>): Promise<void> {
  const { scene, camera } = engine;
  scene.background = new THREE.Color('#9fb8d6');
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x5a5f50, 1.1));
  const sun = new THREE.DirectionalLight(0xfff1dc, 3.0);
  sun.position.set(8, 14, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = sc.bottom = -30;
  sc.right = sc.top = 30;
  scene.add(sun, sun.target);
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardNodeMaterial({ color: '#6f8a4a', roughness: 1 }));
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  scene.add(grass);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(7, 300), new THREE.MeshStandardNodeMaterial({ color: '#4a4c50', roughness: 0.9 }));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.01, 60);
  road.receiveShadow = true;
  scene.add(road);
  for (const x of [-3.3, 3.3]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 300), new THREE.MeshStandardNodeMaterial({ color: '#f2f2f2', roughness: 0.8 }));
    line.rotation.x = -Math.PI / 2;
    line.position.set(x, 0.02, 60);
    scene.add(line);
  }
  const bikes = BIKES.filter((b) => b.collection === 'saison-2026' && (b.family === 'aero' || b.family === 'climb'));
  await Promise.all(['aero', 'climb'].map((f) => loadBikeFamily(f as 'aero')));
  // Équipements : les dix ensembles, puis des combinaisons tirées du catalogue (une pièce par emplacement).
  const rng = mulberry(7);
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rng() * a.length)] as T;
  const bySlot = (slot: string) => TUNE_ITEMS.filter((t) => t.slot === slot);
  const jerseys = ['#e63946', '#2a9d8f', '#e9c46a', '#264653', '#f4a261', '#1982c4', '#8ac926', '#ff595e', '#6a4c93', '#ffffff', '#111111', '#ffd23f'];
  const riders: GltfRiderAvatar[] = [];
  for (let i = 0; i < 50; i++) {
    const kit = TUNE_KITS[i % TUNE_KITS.length];
    const tune = i < 20 && kit ? [...(kit.pieces ?? [])] : [pick(bySlot('paint')).id, pick(bySlot('wheelset')).id, pick(bySlot('rimdecal')).id, ...(rng() < 0.3 ? [pick(bySlot('rimglow')).id] : []), pick(bySlot('tape')).id, pick(bySlot('tyres')).id];
    const look: AvatarLook = { ...DEFAULT_LOOK, jersey: pick(jerseys), jerseyAccent: pick(jerseys), helmet: pick(['#f4f4f4', '#111111', '#1e5bd8', '#e63946']), bikeModel: pick(bikes).id, tune };
    const a = new GltfRiderAvatar(look);
    const row = Math.floor(i / 5);
    const col = i % 5;
    a.root.position.set((col - 2) * 0.78 + (rng() - 0.5) * 0.25, 0.02, 4 + row * 2.05 + (rng() - 0.5) * 0.5);
    a.update(rng(), 85, 11, 'seated');
    a.update(1 / 60, 85, 11, 'seated');
    a.setShadows(row < 5);
    scene.add(a.root);
    riders.push(a);
  }
  // Caméra de poursuite de trois quarts arrière (comme la vue « chase » décalée) : cadres et roues visibles.
  camera.fov = 46;
  camera.aspect = W / H;
  camera.position.set(4.6, 2.5, -1.5);
  camera.lookAt(-0.4, 0.75, 11);
  camera.updateProjectionMatrix();
  for (const a of riders) a.root.updateMatrixWorld(true);
  await new Promise((r) => setTimeout(r, 600));
  for (let k = 0; k < 3; k++) engine.renderManual();
  const c = copyCanvas();
  await shot('peloton-identite', c);
  done();
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

main().catch((e) => {
  log.textContent = String(e);
  console.error(e);
});
