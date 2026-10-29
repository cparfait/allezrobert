import * as THREE from 'three/webgpu';
import { LOW_POLY } from '../engine/style.ts';
import { canvasTex } from './atelierRoom.ts';

/**
 * Home trainers du garage (objets « trainer » du catalogue), construits dans le code d'après les photos
 * des fabricants : Wahoo KICKR CORE 2 (celui de départ), Tacx NEO 2T Smart, Wahoo KICKR et Tacx NEO 3M.
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

/** Point de contour, avec rayon d'arrondi propre facultatif. */
type Pt = readonly [number, number] | readonly [number, number, number];

/** Contour (z, y) aux coins arrondis de rayon r (ou celui du point ; raccourci sur les côtés trop courts). */
function rounded(pts: ReadonlyArray<Pt>, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const n = pts.length;
  pts.forEach((p, i) => {
    const a = pts[(i - 1 + n) % n] as Pt;
    const b = pts[(i + 1) % n] as Pt;
    const rr = p[2] ?? r;
    const da = Math.hypot(a[0] - p[0], a[1] - p[1]);
    const db = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const ra = Math.min(rr, da / 2) / da;
    const rb = Math.min(rr, db / 2) / db;
    const x1 = p[0] + (a[0] - p[0]) * ra;
    const y1 = p[1] + (a[1] - p[1]) * ra;
    if (i === 0) s.moveTo(x1, y1);
    else s.lineTo(x1, y1);
    s.quadraticCurveTo(p[0], p[1], p[0] + (b[0] - p[0]) * rb, p[1] + (b[1] - p[1]) * rb);
  });
  s.closePath();
  return s;
}

/** Pavé w × h × d centré en (x, y, z). */
function box3(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const o = mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z);
  return o;
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
  return labelParts([[text, color]], w, h, weight, italic);
}

/** Inscription en plusieurs couleurs (« KICKR » blanc, « CORE » bleu…). */
function labelParts(parts: ReadonlyArray<readonly [string, string]>, w: number, h: number, weight = 800, italic = false): THREE.Mesh {
  const W = 512;
  const H = Math.max(32, Math.round((W * h) / w));
  const map = canvasTex(W, H, (g) => {
    g.clearRect(0, 0, W, H);
    g.font = `${italic ? 'italic ' : ''}${weight} ${Math.round(H * 0.78)}px "Arial Black", Arial, sans-serif`;
    g.textBaseline = 'middle';
    const widths = parts.map(([t]) => g.measureText(t).width);
    const total = widths.reduce((a, b) => a + b, 0);
    const k = Math.min(1, (W * 0.96) / total);
    let x = (W - total * k) / 2;
    g.save();
    g.scale(k, 1);
    parts.forEach(([t, c], i) => {
      g.fillStyle = c;
      g.fillText(t, x / k, H / 2 + H * 0.04);
      x += (widths[i] as number) * k;
    });
    g.restore();
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
 * Cale de roue avant à `frontZ` de l'axe arrière (repère du home trainer). Tacx : bloc trapézoïdal
 * rainuré (le pneu se loge dans la rainure), logo sur le flanc ; NEO 3M : semelle basse arrondie ;
 * Wahoo : socle plat et deux butées en pente.
 */
function frontBlock(frontZ: number, kind: 'tacx' | 'tacx3m' | 'wahoo'): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'wahoo') {
    const body = mat('#16171a', 0.75);
    g.add(slab(rounded([[-0.16, 0], [0.16, 0], [0.16, 0.03], [-0.16, 0.03]], 0.012), -0.065, 0.065, body, 0.008));
    for (const s of [-1, 1]) g.add(slab(rounded([[s * 0.02, 0.028], [s * 0.15, 0.028], [s * 0.15, 0.062], [s * 0.1, 0.062]], 0.01), -0.05, 0.05, body, 0.006));
  } else {
    const neo3 = kind === 'tacx3m';
    const body = mat(neo3 ? '#26282c' : '#1e2024', 0.55, 0.15);
    const len = neo3 ? 0.3 : 0.26;
    const h = neo3 ? 0.045 : 0.075;
    const top = neo3 ? 0.22 : 0.12;
    const prof = () => rounded([[-len / 2, 0, 0.01], [len / 2, 0, 0.01], [top / 2, h, 0.03], [-top / 2, h, 0.03]], 0.02);
    // Deux flancs de part et d'autre de la rainure du pneu, fond de rainure bas.
    for (const s of [-1, 1]) g.add(slab(prof(), s < 0 ? -0.062 : 0.016, s < 0 ? -0.016 : 0.062, body, 0.008));
    g.add(slab(rounded([[-len / 2 + 0.02, 0], [len / 2 - 0.02, 0], [len / 2 - 0.03, 0.012], [-len / 2 + 0.03, 0.012]], 0.004), -0.02, 0.02, body, 0.003));
    g.add(onDriveSide(label('Tacx', neo3 ? '#e6e8ea' : '#19a7e6', 0.07, 0.022, 900, true), -0.0625, h * 0.45, 0.04));
  }
  g.position.z = frontZ;
  return g;
}

/** Disque de grille (haut-parleur) ou de carter perforé : trous sombres en quinconce. */
function grille(r: number, bg: string, hole: string, step = 14): THREE.Mesh {
  const map = canvasTex(256, 256, (c) => {
    c.fillStyle = bg;
    c.fillRect(0, 0, 256, 256);
    c.fillStyle = hole;
    for (let y = step / 2, row = 0; y < 256; y += step * 0.87, row++)
      for (let x = row % 2 ? step : step / 2; x < 256; x += step) {
        c.beginPath();
        c.arc(x, y, step * 0.28, 0, Math.PI * 2);
        c.fill();
      }
  });
  const m = new THREE.MeshStandardNodeMaterial({ map, roughness: 0.6, metalness: 0.2 });
  return new THREE.Mesh(new THREE.CircleGeometry(r, LOW_POLY ? 12 : 40), m);
}

/** Fentes d'aération parallèles (w × h m). */
function vents(w: number, h: number, n: number): THREE.Mesh {
  const map = canvasTex(256, 64, (c) => {
    c.clearRect(0, 0, 256, 64);
    c.fillStyle = '#0c0d0f';
    for (let i = 0; i < n; i++) c.fillRect(8 + (i * 240) / n, 6, (240 / n) * 0.45, 52);
  });
  const o = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardNodeMaterial({ map, transparent: true, roughness: 0.6, depthWrite: false }));
  o.renderOrder = 2;
  return o;
}

/** Pied plat posé au sol : contour (x, z) et découpe, entre les hauteurs y0 et y1. */
function plate(pts: ReadonlyArray<Pt>, hole: ReadonlyArray<Pt> | null, r: number, y0: number, y1: number, m: THREE.Material, bevel = 0.005): THREE.Mesh {
  const flip = (p: Pt): Pt => [p[0], -p[1], p[2] ?? r];
  const shape = rounded(pts.map(flip), r);
  if (hole) shape.holes.push(rounded(hole.map(flip), r));
  const depth = Math.max(0.002, y1 - y0 - 2 * bevel);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: LOW_POLY ? 1 : 3, curveSegments: LOW_POLY ? 3 : 10 });
  // Contour dans le plan (x, −z), extrusion vers le haut.
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y0 + bevel, 0);
  return mesh(geo, m);
}

/** Contour réduit vers son centre (découpe d'un pied). */
function inset(pts: ReadonlyArray<Pt>, k: number): Pt[] {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return pts.map((p): Pt => [cx + (p[0] - cx) * k, cz + (p[1] - cz) * k]);
}

/** Cylindre de rayon r de a à b. */
function tube(a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material, seg = LOW_POLY ? 8 : 20): THREE.Mesh {
  const d = b.clone().sub(a);
  const o = mesh(new THREE.CylinderGeometry(r, r, d.length(), seg), m);
  o.position.copy(a).addScaledVector(d, 0.5);
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return o;
}

/** Bande de chevrons noirs et blancs du volant apparent des KICKR. */
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

/** Volant apparent : bande à chevrons, face perforée côté transmission, flasque noire de l'autre côté. */
function flywheel(c: THREE.Vector3, r: number, width: number, black: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const chev = new THREE.MeshStandardNodeMaterial({ map: chevronTex(), roughness: 0.45, metalness: 0.2 });
  chev.flatShading = LOW_POLY;
  const band = mesh(new THREE.CylinderGeometry(r, r, width, LOW_POLY ? 14 : 56, 1, true).rotateZ(Math.PI / 2), chev);
  band.position.copy(c);
  g.add(band);
  g.add(cylX(r * 1.01, c.x + width / 2 - 0.004, c.x + width / 2 + 0.006, c.y, c.z, black));
  g.add(cylX(r * 1.01, c.x - width / 2 - 0.004, c.x - width / 2 + 0.004, c.y, c.z, black));
  g.add(onDriveSide(grille(r * 0.9, '#3d4046', '#0b0b0d', 12), c.x - width / 2 - 0.0045, c.y, c.z));
  g.add(cylX(0.022, c.x + width / 2, c.x + width / 2 + 0.01, c.y, c.z, mat('#2a2c30', 0.4, 0.6)));
  return g;
}

// ————————————————————————————————————————————— Modèles

/**
 * Tacx NEO 2T Smart : corps gris anthracite satiné à pan coupé en haut à l'arrière, grand angle arrondi
 * à l'avant, arche ouverte en bas ; disque clair au centre (cassette), grilles de haut-parleur, fentes
 * d'aération, loquets clairs. Un pied plat par côté, triangle évidé noir sur tranche bleue, patins bleus,
 * logo Tacx bleu.
 */
function neo2t(): THREE.Group {
  const g = new THREE.Group();
  const shell = mat('#31343a', 0.42, 0.25);
  const black = mat('#15161a', 0.55, 0.15);
  const blue = mat('#19a7e6', 0.4, 0.1);
  const Y = TRAINER_AXLE_Y;
  const X0 = -0.025;
  const X1 = 0.085;
  const XC = (X0 + X1) / 2;
  const body = rounded(
    [[-0.2, 0.03, 0.012], [-0.2, 0.3], [-0.1, 0.475], [0.27, 0.475, 0.1], [0.27, 0.19], [0.215, 0.05, 0.012], [0.185, 0.05, 0.012], [0.115, 0.18], [-0.055, 0.18], [-0.135, 0.03, 0.012]],
    0.03,
  );
  g.add(slab(body, X0, X1, shell, 0.02));
  // Disque clair dans son logement sombre, moyeu, cassette.
  g.add(cylX(0.108, X0 - 0.003, X0 + 0.004, Y, 0, black));
  g.add(cylX(0.1, X0 - 0.006, X0 + 0.004, Y, 0, mat('#d6d8da', 0.45, 0.3)));
  g.add(cylX(0.032, X0 - 0.009, X0 - 0.005, Y, 0, mat('#2c2f34', 0.35, 0.7)));
  g.add(cassette(X0 - 0.009));
  // Détails des deux faces : grilles, aérations le long du pan coupé, loquets.
  for (const [side, x, tilt] of [[onDriveSide, X0 - 0.002, 1.05], [onOtherSide, X1 + 0.002, -1.05]] as const) {
    g.add(side(grille(0.022, '#24262b', '#08090a', 26), x, 0.275, -0.175));
    g.add(side(grille(0.022, '#24262b', '#08090a', 26), x, 0.165, 0.205));
    g.add(side(vents(0.075, 0.018, 7), x, 0.378, -0.125, tilt));
  }
  const latch = mat('#c9cdd2', 0.4, 0.4);
  for (const x of [X0 - 0.004, X1 + 0.004]) for (const z of [-0.168, 0.2]) g.add(box3(0.01, 0.03, 0.022, latch, x, 0.09, z));
  // Pieds : un triangle évidé de chaque côté, dessus noir, tranche bleue, patins bleus aux pointes.
  for (const s of [-1, 1]) {
    const leg: Pt[] = [[XC + s * 0.06, 0.17], [XC + s * 0.36, 0.35], [XC + s * 0.29, -0.37], [XC + s * 0.06, -0.15]];
    const hole = inset(leg, 0.6);
    g.add(plate(leg, hole, 0.03, 0.008, 0.032, blue));
    g.add(plate(leg, hole, 0.03, 0.03, 0.05, black));
    for (const p of [leg[1], leg[2]]) if (p) g.add(foot(p[0] - s * 0.025, p[1] - Math.sign(p[1]) * 0.025, 0.03, blue));
  }
  const logo = label('Tacx', '#19a7e6', 0.12, 0.04, 900, true);
  logo.rotation.set(-Math.PI / 2, 0, Math.atan2(-0.72, -0.07));
  logo.position.set(XC - 0.26, 0.051, 0.21);
  g.add(logo);
  return g;
}

/**
 * Tacx NEO 3M : corps anthracite plus massif, module arrière « GARMIN » en relief avec sa grille,
 * poignée évidée sur le dessus, grand disque gris clair ; posé sur un piédestal en arche (loquets
 * clairs marqués de rouge, logo Tacx blanc) et des semelles plates évidées, tout en noir.
 */
function neo3m(): THREE.Group {
  const g = new THREE.Group();
  const shell = mat('#2b2d32', 0.45, 0.22);
  const module = mat('#222428', 0.55, 0.2);
  const black = mat('#1a1b1e', 0.6, 0.15);
  const Y = TRAINER_AXLE_Y;
  const X0 = -0.028;
  const X1 = 0.1;
  const XC = (X0 + X1) / 2;
  const body = rounded([[-0.215, 0.28, 0.02], [-0.205, 0.455], [-0.16, 0.48], [0.165, 0.49, 0.1], [0.165, 0.275], [0.105, 0.205], [-0.12, 0.225], [-0.2, 0.265, 0.02]], 0.03);
  body.holes.push(rounded([[-0.03, 0.452], [0.055, 0.452], [0.055, 0.468], [-0.03, 0.468]], 0.007));
  g.add(slab(body, X0, X1, shell, 0.02));
  // Module arrière en relief des deux côtés.
  g.add(slab(rounded([[-0.224, 0.27], [-0.212, 0.462], [-0.165, 0.487], [-0.075, 0.482], [-0.07, 0.29], [-0.125, 0.25]], 0.02), X0 - 0.01, X1 + 0.01, module, 0.012));
  for (const [side, x] of [[onDriveSide, X0 - 0.012], [onOtherSide, X1 + 0.012]] as const) {
    g.add(side(label('GARMIN', '#5d6168', 0.1, 0.02, 700), x, 0.36, -0.145));
    g.add(side(grille(0.02, '#1c1d21', '#060607', 24), x, 0.432, -0.115));
  }
  // Disque gris clair, logement sombre, moyeu, cassette.
  g.add(cylX(0.096, X0 - 0.003, X0 + 0.004, Y, 0, black));
  g.add(cylX(0.088, X0 - 0.006, X0 + 0.004, Y, 0, mat('#cfcac3', 0.5, 0.25)));
  g.add(cylX(0.034, X0 - 0.008, X0 - 0.005, Y, 0, mat('#3b3d41', 0.4, 0.5)));
  g.add(cassette(X0 - 0.008));
  g.add(onDriveSide(label('TACX NEO 3M', '#7d8189', 0.08, 0.012, 700), X0 - 0.002, 0.245, -0.01));
  // Piédestal en arche sous le corps.
  const ped = rounded([[-0.27, 0, 0.012], [0.24, 0, 0.012], [0.24, 0.03], [0.16, 0.215], [0.12, 0.235], [-0.13, 0.235], [-0.17, 0.215], [-0.27, 0.03]], 0.025);
  ped.holes.push(rounded([[-0.11, 0.065], [0.15, 0.065], [0.115, 0.19], [-0.08, 0.19]], 0.02));
  g.add(slab(ped, X0 + 0.005, X1 - 0.005, black, 0.012));
  const latch = mat('#c9cdd2', 0.4, 0.4);
  const red = mat('#c8282c', 0.5);
  for (const [x, out] of [[X0, -0.004], [X1, 0.004]] as const) {
    for (const [z, y] of [[-0.128, 0.205], [0.176, 0.117]] as const) {
      g.add(box3(0.01, 0.034, 0.024, latch, x + out, y, z));
      g.add(box3(0.011, 0.008, 0.016, red, x + out * 1.1, y - 0.008, z));
    }
  }
  g.add(onDriveSide(label('Tacx', '#eef0f2', 0.09, 0.03, 900, true), X0 + 0.002, 0.045, 0.19));
  // Semelles plates évidées de chaque côté.
  for (const s of [-1, 1]) {
    const sole: Pt[] = [[XC + s * 0.06, 0.22], [XC + s * 0.31, 0.27], [XC + s * 0.28, -0.31], [XC + s * 0.06, -0.27]];
    g.add(plate(sole, inset(sole, 0.6), 0.03, 0, 0.032, black));
  }
  return g;
}

/**
 * Wahoo KICKR : grand disque noir satiné marqué « wahoo », cassette en avant de son centre, poignée
 * grise en haut à l'arrière ; volant à chevrons derrière (face perforée côté transmission) ; colonne
 * et pieds en X en tubes ronds, embouts rectangulaires, patins à bague bleue, barre de réglage bleue.
 */
function kickr(): THREE.Group {
  const g = new THREE.Group();
  const black = mat('#18191c', 0.45, 0.3);
  const satin = mat('#141518', 0.4, 0.3);
  const blue = mat('#1f5fd6', 0.35, 0.3);
  const rubber = mat('#0d0d0f', 0.95);
  const Y = TRAINER_AXLE_Y;
  const cz = -0.045;
  const cy = Y + 0.03;
  g.add(cylX(0.205, -0.034, -0.012, cy, cz, satin));
  g.add(cylX(0.197, -0.037, -0.032, cy, cz, mat('#101113', 0.5, 0.2)));
  g.add(cassette(-0.037));
  g.add(onDriveSide(label('wahoo', '#f4f4f4', 0.3, 0.085, 900), -0.0375, cy + 0.08, cz + 0.005, 0.06));
  // Carter derrière le disque, volant, poignée.
  g.add(slab(rounded([[-0.24, 0.2], [-0.22, Y + 0.12], [0.06, Y + 0.12], [0.11, 0.21], [0.0, 0.12], [-0.19, 0.12]], 0.04), -0.012, 0.07, black, 0.012));
  g.add(flywheel(new THREE.Vector3(0.075, 0.205, -0.11), 0.14, 0.1, black));
  g.add(slab(rounded([[-0.17, Y + 0.1], [-0.13, Y + 0.1], [-0.13, Y + 0.17], [-0.19, Y + 0.17]], 0.012), 0.0, 0.06, black, 0.006));
  g.add(tube(new THREE.Vector3(0.03, Y + 0.14, -0.18), new THREE.Vector3(0.03, Y + 0.14, -0.3), 0.022, mat('#8e949b', 0.45, 0.4)));
  // Colonne, moyeu et pieds en X.
  const hub = new THREE.Vector3(0.04, 0.075, -0.06);
  g.add(bar(hub, new THREE.Vector3(0.03, 0.2, -0.04), 0.07, 0.06, black));
  g.add(cylX(0.045, -0.02, 0.1, hub.y, hub.z, black));
  const ends: Array<[number, number]> = [[-0.3, 0.3], [0.37, 0.3], [-0.26, -0.4], [0.33, -0.4]];
  ends.forEach(([x, z], i) => {
    const end = new THREE.Vector3(x, 0.045, z);
    const dir = end.clone().sub(hub).setY(0).normalize();
    const start = end.clone().addScaledVector(dir, -0.11);
    g.add(tube(hub, start.clone().setY(0.05), 0.02, black));
    g.add(bar(start, end.clone().addScaledVector(dir, 0.01), 0.055, 0.05, black));
    g.add(foot(end.x, end.z, 0.04, rubber, blue));
    if (i === 0 || i === 2) {
      const t = label(i === 0 ? 'KICKR' : 'wahoo', '#f2f2f2', 0.075, 0.02, 800);
      t.rotation.set(-Math.PI / 2, 0, Math.atan2(-dir.z, dir.x));
      t.position.copy(start).lerp(end, 0.5).setY(0.071);
      g.add(t);
    }
  });
  // Barre de réglage bleue et ses pivots.
  const a = new THREE.Vector3(-0.035, 0.06, 0.13);
  const b = new THREE.Vector3(-0.035, 0.22, -0.02);
  g.add(bar(a, b, 0.012, 0.03, blue));
  for (const p of [a, b]) g.add(cylX(0.014, p.x - 0.01, p.x + 0.01, p.y, p.z, black));
  return g;
}

/**
 * Wahoo KICKR CORE 2 : grande palette ronde noire marquée « wahoo » qui porte la cassette, châssis en A
 * (deux poutres de la tête vers les rails), deux rails transversaux à embouts caoutchouc, « KICKR CORE »
 * sur le rail avant ; volant à chevrons en bas à l'arrière, face perforée côté transmission.
 */
function kickrCore2(): THREE.Group {
  const g = new THREE.Group();
  const black = mat('#141416', 0.5, 0.2);
  const rubber = mat('#0d0d0f', 0.95);
  const Y = TRAINER_AXLE_Y;
  g.add(cylX(0.125, -0.03, -0.008, Y, 0, black));
  g.add(cylX(0.035, -0.034, -0.028, Y, 0, mat('#2c2f34', 0.4, 0.7)));
  g.add(cassette(-0.034));
  g.add(onDriveSide(label('wahoo', '#f4f4f4', 0.2, 0.058, 900), -0.0315, Y + 0.058, -0.008));
  // Tête derrière la palette, poutres en A vers les rails.
  g.add(slab(rounded([[-0.06, Y - 0.1], [0.05, Y - 0.1], [0.05, Y + 0.03], [-0.06, Y + 0.03]], 0.02), -0.008, 0.05, black, 0.008));
  const apex = new THREE.Vector3(0.02, Y - 0.08, -0.01);
  const zf = 0.2;
  const zr = -0.21;
  for (const z of [zf, zr]) g.add(bar(apex, new THREE.Vector3(0.02, 0.05, z), 0.065, 0.05, black));
  // Volant, côté opposé à la transmission, derrière la poutre arrière.
  g.add(flywheel(new THREE.Vector3(0.1, 0.2, -0.13), 0.105, 0.075, black));
  g.add(bar(new THREE.Vector3(0.05, 0.2, -0.13), new THREE.Vector3(0.064, 0.2, -0.13), 0.03, 0.03, black));
  // Rails transversaux et embouts.
  for (const z of [zf, zr]) {
    g.add(bar(new THREE.Vector3(-0.27, 0.027, z), new THREE.Vector3(0.31, 0.027, z), 0.07, 0.05, black));
    for (const x of [-0.29, 0.33]) g.add(box3(0.045, 0.056, 0.076, rubber, x, 0.028, z));
  }
  const logo = labelParts([['KICKR', '#f2f2f2'], ['CORE', '#29a8e0']], 0.15, 0.028, 800);
  logo.rotation.set(-Math.PI / 2, 0, 0);
  logo.position.set(-0.17, 0.053, zf);
  g.add(logo);
  return g;
}

const BUILDERS: Record<string, { build: () => THREE.Group; block: 'tacx' | 'tacx3m' | 'wahoo' }> = {
  'trainer-neo-2t': { build: neo2t, block: 'tacx' },
  'trainer-neo-3m': { build: neo3m, block: 'tacx3m' },
  'trainer-kickr': { build: kickr, block: 'wahoo' },
  'trainer-kickr-core-2': { build: kickrCore2, block: 'wahoo' },
};

/** Home trainer `id` (KICKR CORE 2 si inconnu), avec sa cale de roue avant ; `name` : 'trainer_<id>'. */
export function buildHomeTrainer(id: string): { group: THREE.Group; front: THREE.Group } {
  const spec = BUILDERS[id] ?? BUILDERS['trainer-kickr-core-2']!;
  const group = spec.build();
  group.name = `trainer_${id}`;
  const front = frontBlock(0, spec.block);
  front.name = 'trainer_front_block';
  return { group, front };
}
