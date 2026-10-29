import * as THREE from 'three/webgpu';
import { LOW_POLY } from '../engine/style.ts';
import { canvasTex } from './atelierRoom.ts';

/**
 * Home trainers du garage (objets « trainer » du catalogue), construits dans le code d'après les photos
 * des fabricants : Tacx NEO 2T Smart (celui de départ), Tacx NEO 3M, Wahoo KICKR et KICKR CORE 2.
 * Tous à transmission directe : la roue arrière est retirée et le vélo se pose par ses pattes sur l'axe
 * du home trainer, cassette comprise. Purement visuels (aucun effet en course).
 *
 * Repère : celui du vélo (+z vers l'avant, y en haut, transmission côté −x), origine au sol sous l'axe
 * arrière, axe à TRAINER_AXLE_Y. Style jeu vidéo : facettes (peu de segments, ombrage plat), mêmes
 * formes et mêmes couleurs.
 */

/** Hauteur de l'axe arrière (m) : celle d'une roue de route, le vélo reste à plat. */
export const TRAINER_AXLE_Y = 0.335;

const SEG = LOW_POLY ? 10 : 40;

function mat(color: string, rough = 0.6, metal = 0): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ color, roughness: LOW_POLY ? Math.max(rough, 0.6) : rough, metalness: LOW_POLY ? metal * 0.5 : metal });
  m.flatShading = LOW_POLY;
  return m;
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

/** Contour (z, y) aux coins arrondis de rayon r (raccourci sur les côtés trop courts). */
function rounded(pts: ReadonlyArray<readonly [number, number]>, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const n = pts.length;
  pts.forEach((p, i) => {
    const a = pts[(i - 1 + n) % n] as readonly [number, number];
    const b = pts[(i + 1) % n] as readonly [number, number];
    const da = Math.hypot(a[0] - p[0], a[1] - p[1]);
    const db = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const ra = Math.min(r, da / 2) / da;
    const rb = Math.min(r, db / 2) / db;
    const x1 = p[0] + (a[0] - p[0]) * ra;
    const y1 = p[1] + (a[1] - p[1]) * ra;
    if (i === 0) s.moveTo(x1, y1);
    else s.lineTo(x1, y1);
    s.quadraticCurveTo(p[0], p[1], p[0] + (b[0] - p[0]) * rb, p[1] + (b[1] - p[1]) * rb);
  });
  s.closePath();
  return s;
}

/** Profil (z, y) extrudé sur l'épaisseur [x0, x1], arêtes adoucies. */
function slab(shape: THREE.Shape, x0: number, x1: number, m: THREE.Material, bevel = 0.012): THREE.Mesh {
  const depth = Math.max(0.002, x1 - x0 - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: LOW_POLY ? 1 : 4, curveSegments: LOW_POLY ? 3 : 12 });
  // Profil dans le plan (z, y), extrusion vers −x, puis calée entre x0 et x1.
  g.rotateY(-Math.PI / 2);
  g.translate(x1 - bevel, 0, 0);
  return mesh(g, m);
}

/** Cylindre d'axe x entre x0 et x1, centré en (y, z). */
function cylX(r: number, x0: number, x1: number, y: number, z: number, m: THREE.Material, seg = SEG): THREE.Mesh {
  const o = mesh(new THREE.CylinderGeometry(r, r, Math.abs(x1 - x0), seg).rotateZ(Math.PI / 2), m);
  o.position.set((x0 + x1) / 2, y, z);
  return o;
}

/** Tube rectangulaire (largeur w, hauteur h) de a à b. */
function bar(a: THREE.Vector3, b: THREE.Vector3, w: number, h: number, m: THREE.Material): THREE.Mesh {
  const o = mesh(new THREE.BoxGeometry(w, h, a.distanceTo(b)), m);
  o.position.copy(a).add(b).multiplyScalar(0.5);
  o.lookAt(b);
  return o;
}

/** Patin rond en caoutchouc posé au sol, bague de couleur facultative. */
function foot(x: number, z: number, r: number, rubber: THREE.Material, ring?: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const pad = mesh(new THREE.CylinderGeometry(r, r * 1.08, 0.022, LOW_POLY ? 8 : 24), rubber);
  pad.position.y = 0.011;
  g.add(pad);
  if (ring) {
    const band = mesh(new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.008, LOW_POLY ? 8 : 24), ring);
    band.position.y = 0.026;
    g.add(band);
  }
  g.position.set(x, 0, z);
  return g;
}

/** Inscription (logo) sur un plan transparent de w × h m, face +z (à orienter). */
function label(text: string, color: string, w: number, h: number, weight = 800, italic = false): THREE.Mesh {
  const W = 512;
  const H = Math.max(32, Math.round((W * h) / w));
  const map = canvasTex(W, H, (g) => {
    g.clearRect(0, 0, W, H);
    g.fillStyle = color;
    g.font = `${italic ? 'italic ' : ''}${weight} ${Math.round(H * 0.78)}px "Arial Black", Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, W / 2, H / 2 + H * 0.04, W * 0.96);
  });
  const m = new THREE.MeshStandardNodeMaterial({ map, transparent: true, roughness: 0.5, depthWrite: false });
  const o = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  o.renderOrder = 2;
  return o;
}

/** Plan d'inscription posé sur la face −x (côté transmission) au point (x, y, z), incliné de `tilt` rad. */
function onDriveSide(o: THREE.Mesh, x: number, y: number, z: number, tilt = 0): THREE.Mesh {
  o.rotation.set(0, -Math.PI / 2, 0);
  o.rotateZ(tilt);
  o.position.set(x, y, z);
  return o;
}

/** Même chose sur la face +x (côté opposé à la transmission). */
function onOtherSide(o: THREE.Mesh, x: number, y: number, z: number, tilt = 0): THREE.Mesh {
  o.rotation.set(0, Math.PI / 2, 0);
  o.rotateZ(tilt);
  o.position.set(x, y, z);
  return o;
}

/** Inscription couchée sur un pied, lue depuis le côté transmission en suivant le pied de `from` vers `to`. */
function onLeg(o: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3, at: number, y: number): THREE.Mesh {
  const d = to.clone().sub(from).normalize();
  o.rotation.set(-Math.PI / 2, 0, Math.atan2(-d.z, d.x));
  o.position.copy(from).lerp(to, at).setY(y);
  return o;
}

/** Cassette 11 vitesses (11–30 dents) sur la roue libre du home trainer, grand pignon côté cadre. */
function cassette(x0: number): THREE.Group {
  const g = new THREE.Group();
  const steel = mat('#c9ced4', 0.28, 0.95);
  const dark = mat('#5d636b', 0.35, 0.9);
  const teeth = [30, 27, 24, 21, 19, 17, 15, 14, 13, 12, 11];
  teeth.forEach((t, i) => {
    const x = x0 - 0.002 - i * 0.0036;
    g.add(cylX(t * 0.00202, x - 0.0009, x + 0.0009, TRAINER_AXLE_Y, 0, i < 4 ? dark : steel, LOW_POLY ? Math.min(t, 16) : t * 2));
  });
  // Corps de roue libre et axe traversant (bouchons des deux côtés).
  g.add(cylX(0.017, x0 + 0.004, x0 - 0.042, TRAINER_AXLE_Y, 0, dark, LOW_POLY ? 8 : 24));
  g.add(cylX(0.007, -0.078, 0.078, TRAINER_AXLE_Y, 0, steel, LOW_POLY ? 6 : 16));
  return g;
}

/**
 * Cale de roue avant : deux butées en caoutchouc devant et derrière le point de contact du pneu,
 * à `frontZ` de l'axe arrière (repère du home trainer).
 */
function frontBlock(frontZ: number, kind: 'tacx' | 'tacx3m' | 'wahoo'): THREE.Group {
  const g = new THREE.Group();
  const body = mat(kind === 'tacx3m' ? '#1c1d20' : '#16171a', 0.75);
  const accent = kind === 'tacx' ? mat('#1aa6e0', 0.5) : null;
  // Socle plat, puis deux coins en pente vers le pneu (berceau).
  const len = kind === 'tacx3m' ? 0.36 : 0.32;
  g.add(slab(rounded([[-len / 2, 0], [len / 2, 0], [len / 2, 0.03], [-len / 2, 0.03]], 0.012), -0.065, 0.065, body, 0.008));
  for (const s of [-1, 1]) g.add(slab(rounded([[s * 0.02, 0.028], [s * 0.15, 0.028], [s * 0.15, 0.062], [s * 0.1, 0.062]], 0.01), -0.05, 0.05, body, 0.006));
  if (accent) g.add(slab(rounded([[-len / 2 + 0.01, 0.0], [len / 2 - 0.01, 0.0], [len / 2 - 0.01, 0.008], [-len / 2 + 0.01, 0.008]], 0.004), -0.068, 0.068, accent, 0.002));
  g.position.z = frontZ;
  return g;
}

// ————————————————————————————————————————————— Modèles

/**
 * Tacx NEO 2T Smart : grand corps noir mat en bouclier, poignée évidée en haut à l'arrière, disque
 * argenté côté transmission avec la cassette au centre ; deux pieds pliants en X, plats, dessous bleu
 * Tacx et logo sur le pied.
 */
function neo2t(): THREE.Group {
  const g = new THREE.Group();
  const shell = mat('#1c1d21', 0.62, 0.15);
  const silver = mat('#b8bec6', 0.32, 0.85);
  const blue = mat('#1aa6e0', 0.45, 0.1);
  const rubber = mat('#0d0d0f', 0.95);
  const Y = TRAINER_AXLE_Y;
  // Corps (profil de côté), plus épais côté opposé à la transmission ; poignée évidée.
  const prof = rounded([[0.2, 0.1], [0.21, Y + 0.07], [0.1, Y + 0.17], [-0.16, Y + 0.2], [-0.33, Y + 0.17], [-0.36, Y + 0.02], [-0.2, 0.09], [-0.02, 0.06]], 0.07);
  prof.holes.push(rounded([[-0.17, Y + 0.12], [-0.29, Y + 0.105], [-0.3, Y + 0.145], [-0.17, Y + 0.16]], 0.018));
  g.add(slab(prof, -0.024, 0.085, shell, 0.018));
  // Disque argenté (moteur) et sa bague sombre, cassette sur l'axe.
  g.add(cylX(0.15, -0.031, -0.022, Y, 0, silver));
  g.add(cylX(0.058, -0.035, -0.03, Y, 0, mat('#2b2e33', 0.4, 0.6)));
  g.add(cassette(-0.035));
  // Bandeau lumineux du sol (dessous du corps) : bleu.
  g.add(slab(rounded([[0.16, 0.085], [-0.18, 0.1], [-0.2, 0.115], [0.17, 0.1]], 0.01), -0.02, 0.08, blue, 0.004));
  // Pieds en X : longues lames plates, dessus noir, tranche bleue, patins au bout.
  const legs = [
    [new THREE.Vector3(-0.36, 0.04, 0.36), new THREE.Vector3(0.3, 0.04, -0.42)],
    [new THREE.Vector3(0.34, 0.04, 0.36), new THREE.Vector3(-0.28, 0.04, -0.42)],
  ] as const;
  for (const [a, b] of legs) {
    g.add(bar(a, b, 0.085, 0.034, shell));
    g.add(bar(a.clone().setY(0.018), b.clone().setY(0.018), 0.092, 0.012, blue));
    for (const p of [a, b]) g.add(foot(p.x, p.z, 0.04, rubber));
  }
  // Moyeu des pieds sous le corps.
  g.add(cylX(0.06, -0.06, 0.12, 0.07, -0.04, shell));
  // Logos : « Tacx » sur les deux faces du corps et sur le pied avant côté transmission, « NEO 2T » en haut.
  g.add(onDriveSide(label('Tacx', '#1aa6e0', 0.13, 0.045, 900, true), -0.045, Y - 0.205, 0.04));
  g.add(onDriveSide(label('NEO 2T', '#d6dbe0', 0.11, 0.028), -0.045, Y + 0.17, -0.18));
  g.add(onOtherSide(label('Tacx', '#1aa6e0', 0.16, 0.055, 900, true), 0.104, Y - 0.04, -0.07));
  g.add(onOtherSide(label('NEO 2T', '#d6dbe0', 0.11, 0.028), 0.104, Y + 0.17, -0.18));
  const [front] = legs[0];
  const [, rearB] = legs[0];
  g.add(onLeg(label('Tacx', '#1aa6e0', 0.11, 0.036, 900, true), rearB, front, 0.8, 0.058));
  return g;
}

/**
 * Tacx NEO 3M : corps plus massif, entièrement noir graphite, grand disque gris foncé cerclé d'argent ;
 * posé sur une plaque de mouvement (avant / arrière, roulis) au lieu des pieds en X.
 */
function neo3m(): THREE.Group {
  const g = new THREE.Group();
  const shell = mat('#202125', 0.55, 0.2);
  const graphite = mat('#2c2e33', 0.5, 0.35);
  const silver = mat('#aeb4bb', 0.3, 0.9);
  const rubber = mat('#0d0d0f', 0.95);
  const Y = TRAINER_AXLE_Y;
  const prof = rounded([[0.22, 0.09], [0.22, Y + 0.09], [0.12, Y + 0.19], [-0.2, Y + 0.19], [-0.34, Y + 0.1], [-0.34, 0.09]], 0.09);
  prof.holes.push(rounded([[-0.18, Y + 0.13], [-0.29, Y + 0.115], [-0.29, Y + 0.15], [-0.18, Y + 0.16]], 0.016));
  g.add(slab(prof, -0.024, 0.1, shell, 0.022));
  g.add(cylX(0.16, -0.03, -0.022, Y, 0, silver));
  g.add(cylX(0.148, -0.034, -0.028, Y, 0, graphite));
  g.add(cylX(0.05, -0.037, -0.032, Y, 0, mat('#16171a', 0.4, 0.5)));
  g.add(cassette(-0.037));
  // Socle de mouvement : plaque arrondie, avancée vers l'avant, deux rails et patins.
  g.add(slab(rounded([[0.36, 0], [0.36, 0.045], [0.2, 0.1], [-0.36, 0.1], [-0.42, 0.045], [-0.42, 0]], 0.05), -0.22, 0.28, shell, 0.02));
  for (const x of [-0.17, 0.23]) g.add(slab(rounded([[0.32, 0], [0.32, 0.02], [-0.4, 0.02], [-0.4, 0]], 0.008), x - 0.03, x + 0.03, graphite, 0.004));
  for (const [x, z] of [[-0.2, 0.32], [0.26, 0.32], [-0.2, -0.38], [0.26, -0.38]] as const) g.add(foot(x, z, 0.03, rubber));
  g.add(onDriveSide(label('Tacx', '#c9ced4', 0.13, 0.045, 900, true), -0.226, 0.06, 0.12));
  g.add(onDriveSide(label('NEO 3M', '#c9ced4', 0.11, 0.028), -0.048, Y + 0.165, -0.19));
  g.add(onOtherSide(label('Tacx', '#c9ced4', 0.13, 0.045, 900, true), 0.286, 0.06, 0.12));
  g.add(onOtherSide(label('NEO 3M', '#c9ced4', 0.13, 0.034), 0.124, Y + 0.0, -0.08));
  return g;
}

/**
 * Wahoo KICKR : grand disque noir (carter du volant) marqué « wahoo » côté transmission, carter
 * à ailettes derrière, colonne inclinée réglable (barre bleue) et piétement en X à patins bagués de bleu.
 */
function kickr(): THREE.Group {
  const g = new THREE.Group();
  const black = mat('#18191c', 0.55, 0.2);
  const housing = mat('#2a2c31', 0.5, 0.4);
  const blue = mat('#1f6fe0', 0.4, 0.2);
  const rubber = mat('#0d0d0f', 0.95);
  const Y = TRAINER_AXLE_Y;
  // Disque (légèrement en arrière et au-dessus de l'axe), lèvre en relief.
  const cz = -0.045;
  const cy = Y + 0.035;
  g.add(cylX(0.215, -0.034, -0.012, cy, cz, black));
  g.add(cylX(0.205, -0.036, -0.032, cy, cz, mat('#101113', 0.45, 0.2)));
  // Carter du volant derrière le disque, avec ailettes.
  g.add(cylX(0.17, -0.012, 0.12, cy - 0.02, cz - 0.02, housing));
  for (let i = 0; i < (LOW_POLY ? 5 : 9); i++) {
    const a = (i / (LOW_POLY ? 5 : 9)) * Math.PI - Math.PI * 0.95;
    const fin = mesh(new THREE.BoxGeometry(0.11, 0.012, 0.03), black);
    fin.position.set(0.055, cy - 0.02 + Math.sin(a) * 0.172, cz - 0.02 + Math.cos(a) * 0.172);
    fin.rotation.x = -a;
    g.add(fin);
  }
  g.add(cassette(-0.036));
  // Colonne inclinée vers l'arrière jusqu'au moyeu du piétement ; barre de réglage bleue.
  const hub = new THREE.Vector3(0.03, 0.075, -0.1);
  g.add(bar(new THREE.Vector3(0.03, cy - 0.15, cz - 0.06), hub, 0.07, 0.06, black));
  g.add(bar(new THREE.Vector3(-0.03, cy - 0.12, cz + 0.06), new THREE.Vector3(-0.03, 0.09, -0.02), 0.022, 0.03, blue));
  g.add(cylX(0.05, -0.04, 0.1, hub.y, hub.z, black));
  // Piétement en X (deux jambes avant, deux arrière), patins bagués de bleu.
  for (const [x, z] of [[-0.34, 0.3], [0.38, 0.3], [-0.3, -0.42], [0.34, -0.42]] as const) {
    const end = new THREE.Vector3(x, 0.035, z);
    g.add(bar(hub, end, 0.05, 0.045, black));
    g.add(foot(x, z, 0.045, rubber, blue));
  }
  g.add(onDriveSide(label('wahoo', '#f4f4f4', 0.24, 0.07, 900), -0.0375, cy + 0.04, cz + 0.02, 0.28));
  g.add(onOtherSide(label('wahoo', '#f4f4f4', 0.2, 0.06, 900), 0.124, cy - 0.01, cz - 0.03, -0.2));
  g.add(onDriveSide(label('KICKR', '#d0d4da', 0.12, 0.03), -0.0375, cy - 0.12, cz - 0.05, 0.28));
  return g;
}

/** Bande de chevrons noirs et blancs du volant apparent du KICKR CORE 2. */
function chevronTex(): THREE.CanvasTexture {
  return canvasTex(1024, 128, (c) => {
    c.fillStyle = '#f2f2f2';
    c.fillRect(0, 0, 1024, 128);
    c.fillStyle = '#111214';
    for (let x = -128; x < 1024 + 128; x += 96) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x + 40, 0);
      c.lineTo(x + 88, 64);
      c.lineTo(x + 40, 128);
      c.lineTo(x, 128);
      c.lineTo(x + 48, 64);
      c.closePath();
      c.fill();
    }
  });
}

/**
 * Wahoo KICKR CORE 2 : palette noire en goutte qui porte la cassette (« wahoo » en blanc), volant
 * apparent à chevrons noirs et blancs en bas à l'arrière, cadre en H de tubes carrés noirs.
 */
function kickrCore2(): THREE.Group {
  const g = new THREE.Group();
  const black = mat('#141416', 0.6, 0.2);
  const rubber = mat('#0d0d0f', 0.95);
  const Y = TRAINER_AXLE_Y;
  // Palette en goutte : disque autour de l'axe qui s'effile vers le bas et l'arrière.
  const drop = new THREE.Shape();
  const r = 0.12;
  drop.absarc(0, Y, r, Math.PI * 0.08, Math.PI * 1.32, false);
  drop.lineTo(-0.2, Y - 0.2);
  drop.quadraticCurveTo(-0.17, Y - 0.25, -0.12, Y - 0.22);
  drop.closePath();
  g.add(slab(drop, -0.032, -0.006, black, 0.006));
  g.add(cylX(0.035, -0.036, -0.03, Y, 0, mat('#2c2f34', 0.4, 0.7)));
  g.add(cassette(-0.036));
  // Corps vertical derrière la palette jusqu'au volant.
  const fly = new THREE.Vector3(0.0, 0.2, -0.22);
  g.add(bar(new THREE.Vector3(0.0, Y - 0.12, -0.08), fly, 0.06, 0.08, black));
  // Volant apparent : bande à chevrons, flasques noires.
  const chev = new THREE.MeshStandardNodeMaterial({ map: chevronTex(), roughness: 0.45, metalness: 0.2 });
  chev.flatShading = LOW_POLY;
  const wheel = mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.075, LOW_POLY ? 12 : 48, 1, true).rotateZ(Math.PI / 2), chev);
  wheel.position.copy(fly);
  g.add(wheel);
  for (const s of [-1, 1]) g.add(cylX(0.13, s * 0.036, s * 0.044, fly.y, fly.z, black));
  g.add(cylX(0.03, -0.05, 0.05, fly.y, fly.z, mat('#3a3d42', 0.4, 0.8)));
  // Cadre en H : longeron central, jambes avant et arrière, embouts.
  g.add(bar(new THREE.Vector3(0, 0.03, -0.36), new THREE.Vector3(0, 0.03, 0.26), 0.06, 0.045, black));
  g.add(bar(new THREE.Vector3(0, 0.07, -0.14), fly.clone().setY(0.1), 0.05, 0.05, black));
  for (const z of [0.24, -0.34]) {
    const half = z > 0 ? 0.33 : 0.3;
    g.add(bar(new THREE.Vector3(-half, 0.03, z), new THREE.Vector3(half, 0.03, z), 0.06, 0.045, black));
    for (const x of [-half, half]) g.add(foot(x, z, 0.035, rubber));
  }
  g.add(onDriveSide(label('wahoo', '#f4f4f4', 0.17, 0.05, 900), -0.0335, Y + 0.035, -0.035, 0.42));
  const legLogo = label('KICKR', '#e8e8e8', 0.14, 0.03);
  legLogo.rotation.set(-Math.PI / 2, 0, 0);
  legLogo.position.set(-0.17, 0.054, 0.24);
  g.add(legLogo);
  return g;
}

const BUILDERS: Record<string, { build: () => THREE.Group; block: 'tacx' | 'tacx3m' | 'wahoo' }> = {
  'trainer-neo-2t': { build: neo2t, block: 'tacx' },
  'trainer-neo-3m': { build: neo3m, block: 'tacx3m' },
  'trainer-kickr': { build: kickr, block: 'wahoo' },
  'trainer-kickr-core-2': { build: kickrCore2, block: 'wahoo' },
};

/** Home trainer `id` (NEO 2T si inconnu), avec sa cale de roue avant ; `name` : 'trainer_<id>'. */
export function buildHomeTrainer(id: string): { group: THREE.Group; front: THREE.Group } {
  const spec = BUILDERS[id] ?? BUILDERS['trainer-neo-2t']!;
  const group = spec.build();
  group.name = `trainer_${id}`;
  const front = frontBlock(0, spec.block);
  front.name = 'trainer_front_block';
  return { group, front };
}
