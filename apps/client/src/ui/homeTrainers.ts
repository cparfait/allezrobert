import * as THREE from 'three/webgpu';
import { BIKE_REFERENCE } from '@allezrobert/shared';
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

/** Hauteur de l'axe arrière (m) : celle d'une roue de route, le vélo reste à plat (rayon du vélo de référence, BIKE_REFERENCE). */
export const TRAINER_AXLE_Y = BIKE_REFERENCE.wheelRadiusM;

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

/** Cassette 11 vitesses sur la roue libre du home trainer, grand pignon côté cadre. */
function cassette(x0: number, maxTeeth: 28 | 30): THREE.Group {
  const g = new THREE.Group();
  const steel = mat('#c9ced4', 0.32, 0.55);
  const dark = mat('#90969d', 0.37, 0.60);
  const teeth = [maxTeeth, maxTeeth === 28 ? 25 : 27, maxTeeth === 28 ? 23 : 24, 21, 19, 17, 15, 14, 13, 12, 11];
  teeth.forEach((t, i) => {
    const x = x0 - 0.002 - i * 0.0036;
    const radius = t * 0.00202;
    const material = i < 4 ? dark : steel;
    const ring = new THREE.Shape();
    for (let tooth = 0; tooth < t; tooth++) {
      for (const [offset, depth] of [[0, 0.0024], [0.26, 0], [0.56, 0], [0.82, 0.0024]] as const) {
        const a = ((tooth + offset) / t) * Math.PI * 2;
        const px = Math.cos(a) * (radius - depth);
        const py = Math.sin(a) * (radius - depth) + TRAINER_AXLE_Y;
        if (tooth === 0 && offset === 0) ring.moveTo(px, py);
        else ring.lineTo(px, py);
      }
    }
    ring.closePath();
    g.add(slab(ring, x - 0.001, x + 0.001, material, 0));
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
    g.add(slab(rounded([[-0.16, 0.0064], [0.16, 0.0064], [0.16, 0.03], [-0.16, 0.03]], 0.012), -0.065, 0.065, body, 0.008));
    for (const s of [-1, 1]) g.add(slab(rounded([[s * 0.02, 0.028], [s * 0.15, 0.028], [s * 0.15, 0.062], [s * 0.1, 0.062]], 0.01), -0.05, 0.05, body, 0.006));
  } else {
    const neo3 = kind === 'tacx3m';
    const body = mat(neo3 ? '#26282c' : '#1e2024', 0.55, 0.15);
    const rubber = mat('#141517', 0.82);
    const len = neo3 ? 0.265 : 0.23;
    const h = neo3 ? 0.034 : 0.057;
    const half = neo3 ? 0.078 : 0.067;
    const gap = neo3 ? 0.024 : 0.020;
    const end = len / 2;
    const footprint: Pt[] = [[-half, -end + 0.027], [-half + 0.019, -end], [half - 0.019, -end],
      [half, -end + 0.027], [half, end - 0.027], [half - 0.019, end],
      [-half + 0.019, end], [-half, end - 0.027]];
    g.add(plate(footprint, null, 0.01, 0, 0.008, rubber, 0.003));
    for (const s of [-1, 1]) {
      const shape = rounded([[-end + 0.012, 0.008], [end - 0.012, 0.008], [end - 0.032, h * 0.72],
        [neo3 ? 0.061 : 0.016, h], [neo3 ? -0.08 : -0.053, h * 0.63]], 0.013);
      g.add(slab(shape, s < 0 ? -half + 0.004 : gap, s < 0 ? -gap : half - 0.004, body, 0.006));
    }
    g.add(onDriveSide(label('Tacx', neo3 ? '#c7c9cb' : '#19a7e6', 0.051, 0.014, 900, true),
      -half + 0.003, h * 0.39, 0.023));
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

/** Un pied pliant : la face monte vers ses deux charnières, la découpe traverse les deux coques. */
function tacxWing(s: -1 | 1, neo3: boolean, top: THREE.Material, liner: THREE.Material, rubber: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const edge = neo3 ? 0.392 : 0.368;
  const back = neo3 ? -0.367 : -0.338;
  const front = neo3 ? 0.251 : 0.229;
  const wing: Pt[] = [[0.057, -0.164], [edge - 0.044, back], [edge, back + 0.032], [edge, front - 0.023],
    [edge - 0.022, front], [edge - 0.087, front - 0.006], [0.057, 0.215]];
  const cutout: Pt[] = [[0.106, -0.145], [edge - 0.073, back + 0.083], [edge - 0.063, back + 0.105],
    [edge - 0.063, front - 0.152], [edge - 0.093, front - 0.069], [0.106, 0.133]];
  const mirror = (pts: ReadonlyArray<Pt>): Pt[] => pts.map(([x, z]) => [s * x, z]);
  const rise = (x: number, z: number) => {
    const t = THREE.MathUtils.clamp((edge - Math.abs(x)) / (edge - 0.057), 0, 1);
    return (neo3 ? 0.027 : 0.008) + t * (0.166 - z * 0.29);
  };
  const skin = (low: number, high: number, material: THREE.Material) => {
    const part = plate(mirror(wing), mirror(cutout), 0.018, low, high, material, 0.004);
    const p = part.geometry.attributes.position!;
    for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + rise(p.getX(i), p.getZ(i)));
    part.geometry.computeVertexNormals();
    g.add(part);
    return part;
  };
  skin(0, 0.011, liner);
  const upper = skin(0.01, neo3 ? 0.033 : 0.029, top);
  // Pièces en relief orientées sur le plan du pied : logo, charnières et fenêtres de verrouillage.
  const surface = (x: number, z: number) => {
    const pivot = new THREE.Group();
    const along = new THREE.Vector3(0, rise(x, z - s * 0.001) - rise(x, z), -s * 0.001).normalize();
    const across = new THREE.Vector3(s * 0.001, rise(x + s * 0.001, z) - rise(x, z), 0).normalize();
    const normal = across.cross(along).normalize();
    pivot.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(along, normal.clone().cross(along), normal));
    pivot.position.set(x, rise(x, z) + (neo3 ? 0.034 : 0.030), z);
    g.add(pivot);
    return pivot;
  };
  // Le marquage épouse la pente réelle du carter, y compris de part et d'autre de ses facettes.
  const mark = label('Tacx', neo3 ? '#e2e5e7' : '#1fb2f2', 0.093, 0.032, 900, true);
  const placement = surface(s * (edge - 0.033), front - 0.082);
  placement.updateMatrix();
  mark.geometry.dispose();
  mark.geometry = new THREE.PlaneGeometry(0.093, 0.032, 8, 3);
  const positions = mark.geometry.attributes.position!;
  const point = new THREE.Vector3();
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i).applyMatrix4(placement.matrix);
    ray.ray.origin.set(point.x, 1, point.z);
    const y = ray.intersectObject(upper)[0]?.point.y ?? point.y;
    positions.setXYZ(i, point.x, y + 0.002, point.z);
  }
  mark.geometry.computeVertexNormals();
  g.remove(placement);
  g.add(mark);
  const latch = mat('#b6b9bd', 0.4, 0.35);
  const slot = mat('#121315', 0.65);
  const locked = mat('#2789bd', 0.5);
  const locks = [-0.152, 0.183];
  for (const z of locks) {
    const pivot = surface(s * 0.107, z);
    pivot.add(box3(0.033, 0.052, 0.008, slot, 0, 0, 0.003));
    pivot.add(box3(0.021, 0.017, 0.004, latch, 0, -0.012, 0.008));
    pivot.add(box3(0.012, 0.004, 0.003, locked, 0, 0.013, 0.008));
  }
  if (neo3) {
    // Deux appuis reliés sous le pied, avec une molette à l'arrière pour bloquer la translation.
    const rail: Pt[] = [[edge - 0.053, back + 0.009], [edge, back + 0.033], [edge, front - 0.022],
      [edge - 0.028, front - 0.006], [edge - 0.061, front - 0.04], [edge - 0.074, back + 0.075]];
    g.add(plate(mirror(rail), null, 0.016, 0.009, 0.032, rubber));
    for (const z of [back + 0.066, front - 0.057]) {
      g.add(box3(0.049, 0.014, 0.105, rubber, s * (edge - 0.035), 0.007, z));
    }
    const x = s * (edge - 0.048);
    g.add(tube(new THREE.Vector3(x, 0.052, back + 0.048), new THREE.Vector3(x, 0.052, back - 0.02), 0.015, rubber));
  } else {
    for (const z of [back + 0.055, front - 0.044]) {
      g.add(plate(mirror([[edge - 0.053, z - 0.034], [edge - 0.011, z - 0.027],
        [edge - 0.011, z + 0.027], [edge - 0.053, z + 0.033]]), null, 0.008, 0, 0.017, liner, 0.003));
    }
  }
  return g;
}

/** Carter des NEO, côté transmission argenté et côté opposé fermé par un capot noir. */
function neo(neo3: boolean): THREE.Group {
  const g = new THREE.Group();
  const shell = mat(neo3 ? '#2b2d30' : '#323439', 0.56);
  const edge = mat('#1d1f22', 0.5);
  const rubber = mat('#151619', 0.86);
  const silver = mat('#bac0c3', 0.36, 0.62);
  const steel = mat('#d3d6da', 0.3, 0.8);
  const x0 = -0.021;
  const x1 = 0.053;
  const y = TRAINER_AXLE_Y;
  const top = y + (neo3 ? 0.194 : 0.167);
  const profile: Pt[] = [[-0.235, y + 0.01], [-0.197, top - 0.018], [-0.064, top], [0.068, top, 0.095],
    [0.138, top - 0.058], [0.254, y - 0.112, 0.024], [0.244, y - 0.203], [-0.152, y - 0.098], [-0.226, y - 0.032]];
  const outline = (handle: boolean) => {
    const shape = rounded(profile, 0.023);
    if (handle) shape.holes.push(rounded([[-0.041, top - 0.049], [0.055, top - 0.049],
      [0.047, top - 0.023], [-0.045, top - 0.023]], 0.009));
    return shape;
  };
  g.add(slab(outline(neo3), x0, x1, edge, 0.006));
  g.add(slab(outline(neo3), x0 - 0.003, x0 + 0.006, shell, 0.002));
  // La coque extérieure du côté opposé à la cassette ménage le passage de la patte du vélo.
  const cover = rounded([[-0.219, y + 0.01], [-0.183, top - 0.041], [-0.055, top - 0.055],
    [0.061, top - 0.065], [0.103, y + 0.056], [0.233, y - 0.12],
    [0.226, y - 0.167], [-0.14, y - 0.077]], 0.018);
  g.add(slab(cover, x1 - 0.004, x1 + 0.006, shell, 0.003));
  g.add(cylX(0.032, x1 + 0.004, 0.069, y, 0, silver));
  g.add(cylX(0.014, 0.067, 0.073, y, 0, edge));
  g.add(cylX(0.007, 0.073, 0.077, y, 0, steel));

  const rotor = neo3 ? 0.122 : 0.125;
  g.add(cylX(rotor + 0.007, x0 - 0.007, x0, y, 0, rubber));
  g.add(cylX(rotor, x0 - 0.011, x0 - 0.007, y, 0, silver));
  g.add(cylX(0.034, x0 - 0.015, x0 - 0.011, y, 0, edge));
  g.add(cassette(x0 - 0.015, 30));
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * 2 * Math.PI;
    const r = rotor + 0.017;
    g.add(cylX(0.0027, x0 - 0.004, x0 - 0.002, y + Math.sin(a) * r, Math.cos(a) * r, edge, 8));
  }
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    g.add(cylX(0.003, x1 + 0.005, x1 + 0.007, y + Math.sin(a) * 0.047, Math.cos(a) * 0.047, silver, 8));
  }

  if (neo3) {
    // Module d'alimentation derrière le moteur, dégagé de l'axe et de la poignée.
    const module = rounded([[-0.235, y - 0.02], [-0.201, top - 0.022], [-0.089, top - 0.022],
      [-0.112, y + 0.048], [-0.093, y - 0.055], [-0.159, y - 0.103], [-0.22, y - 0.063]], 0.018);
    g.add(slab(module, x0 - 0.014, x1 + 0.028, edge, 0.007));
    for (const [face, x] of [[onDriveSide, x0 - 0.015], [onOtherSide, x1 + 0.029]] as const) {
      g.add(face(grille(0.023, '#1f2124', '#101113', 19), x, y + 0.097, -0.167));
      g.add(face(label('GARMIN', '#888b8d', 0.079, 0.014, 700), x, y + 0.042, -0.17));
    }
  } else {
    g.add(onDriveSide(grille(0.021, '#303236', '#101113', 19), x0 - 0.004, y - 0.044, -0.17));
    g.add(onDriveSide(grille(0.021, '#303236', '#101113', 19), x0 - 0.004, y - 0.128, 0.197));
  }
  g.add(onOtherSide(label(neo3 ? 'TACX NEO 3M' : 'NEO 2T SMART', '#9da1a6', 0.095, 0.012, 700),
    x1 + 0.007, y - 0.117, 0.145, 0.23));

  const liner = neo3 ? edge : mat('#168cc4', 0.5);
  for (const [z, hingeY] of [[-0.152, 0.236], [0.183, 0.148]] as const) {
    g.add(cylX(0.015, -0.081, 0.081, hingeY, z, edge));
  }
  for (const s of [-1, 1] as const) g.add(tacxWing(s, neo3, shell, liner, rubber));
  return g;
}

/** Couronne et cassette des KICKR, avec le bouchon d'axe visible côté opposé. */
function wahooDrive(radius: number, z: number, lift: number, black: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const y = TRAINER_AXLE_Y;
  const rim = mat('#161719', 0.43, 0.2);
  g.add(cylX(radius, -0.039, -0.008, y + lift, z, rim));
  g.add(cylX(radius - 0.003, -0.042, -0.038, y + lift, z, black));
  g.add(cylX(0.031, -0.044, -0.041, y, 0, rim));
  g.add(cassette(-0.040, 28));
  const steel = mat('#a7adb3', 0.4, 0.65);
  g.add(cylX(0.024, 0.027, 0.062, y, 0, rim));
  g.add(cylX(0.012, 0.061, 0.076, y, 0, steel));
  g.add(onDriveSide(label('wahoo', '#f5f5f5', radius * 1.66, radius * 0.46, 900),
    -0.043, y + lift + radius * 0.57, z - 0.023, 0.28));
  return g;
}

/** KICKR : deux bras latéraux repliables, une jambe centrale et la biellette de réglage bleue. */
function kickr(): THREE.Group {
  const g = new THREE.Group();
  const black = mat('#262729', 0.53, 0.22);
  const edge = mat('#18191b', 0.43, 0.28);
  const blue = mat('#245bd6', 0.45, 0.22);
  const rubber = mat('#111214', 0.86);
  const metal = mat('#a4a7aa', 0.36, 0.62);
  const y = TRAINER_AXLE_Y;
  g.add(wahooDrive(0.126, 0.009, 0.012, black));

  const pillar = rounded([[-0.247, 0.063], [-0.186, 0.064], [0.05, y - 0.062], [0.067, y + 0.034],
    [-0.044, y + 0.039], [-0.118, y - 0.026], [-0.253, 0.13]], 0.018);
  g.add(slab(pillar, -0.029, 0.059, black, 0.011));
  const handle = rounded([[-0.161, y + 0.017], [-0.159, y + 0.064], [-0.07, y + 0.055], [-0.046, y + 0.022]], 0.012);
  g.add(slab(handle, -0.002, 0.051, edge, 0.008));
  g.add(flywheel(new THREE.Vector3(0.101, 0.177, -0.132), 0.111, 0.089, edge));

  const rear = -0.223;
  const base = rounded([[rear - 0.034, 0.016], [rear + 0.039, 0.016], [rear + 0.043, 0.075],
    [rear - 0.027, 0.082]], 0.009);
  g.add(slab(base, -0.079, 0.102, edge, 0.007));
  const badge = label('wahoo', '#f5f5f5', 0.10, 0.026, 900);
  badge.rotation.y = Math.PI;
  badge.position.set(0.012, 0.054, rear - 0.035);
  g.add(badge);
  g.add(box3(0.121, 0.016, 0.055, rubber, 0.013, 0.008, rear));
  const hub = new THREE.Vector3(0.012, 0.055, rear);
  for (const s of [-1, 1]) {
    const tip = new THREE.Vector3(0.012 + s * 0.314, 0.057, -0.117);
    const dir = tip.clone().sub(hub).setY(0).normalize();
    g.add(tube(hub, tip.clone().addScaledVector(dir, 0.011), 0.024, black));
    g.add(foot(tip.x, tip.z, 0.034, rubber, blue));
    const t = label('KICKR', '#f2f2f2', 0.061, 0.018, 800);
    t.rotation.set(-Math.PI / 2, 0, s > 0 ? Math.atan2(-dir.z, dir.x) : Math.atan2(dir.z, -dir.x));
    t.position.copy(tip).addScaledVector(dir, -0.045).setY(0.082);
    g.add(t);
  }

  g.add(tube(hub, new THREE.Vector3(0.012, 0.039, 0.211), 0.025, black));
  g.add(slab(rounded([[0.181, 0.008], [0.251, 0.008], [0.257, 0.031], [0.23, 0.064],
    [0.192, 0.062]], 0.01), -0.029, 0.053, rubber, 0.007));
  g.add(box3(0.068, 0.008, 0.052, rubber, 0.012, 0.004, 0.213));
  const a = new THREE.Vector3(-0.033, 0.058, 0.075);
  const b = new THREE.Vector3(-0.033, 0.17, -0.103);
  g.add(bar(a, b, 0.012, 0.024, blue));
  for (const p of [a, b]) {
    g.add(cylX(0.013, p.x - 0.008, p.x + 0.009, p.y, p.z, blue));
    g.add(cylX(0.006, p.x - 0.010, p.x - 0.007, p.y, p.z, metal, 8));
  }
  for (const z of [0.037, 0.057, 0.078, 0.098]) g.add(cylX(0.004, -0.015, -0.012, 0.048, z, rubber, 8));
  return g;
}

/** CORE 2 : bâti en A et deux rails boulonnés, avec le rail avant plus long. */
function kickrCore2(): THREE.Group {
  const g = new THREE.Group();
  const black = mat('#262729', 0.53, 0.20);
  const edge = mat('#18191b', 0.47, 0.20);
  const rubber = mat('#111214', 0.86);
  const screws = mat('#36393d', 0.37, 0.35);
  const y = TRAINER_AXLE_Y;
  g.add(wahooDrive(0.118, 0.005, 0.01, black));

  const rear = -0.225;
  const front = 0.228;
  const outer = rounded([[rear - 0.025, 0.047], [rear + 0.052, 0.041], [0.046, y - 0.06],
    [0.033, y + 0.022], [-0.067, y + 0.023], [-0.122, y - 0.083]], 0.015);
  g.add(slab(outer, -0.036, 0.043, black, 0.009));
  const forward = rounded([[0.008, y - 0.018], [-0.04, y - 0.085], [front - 0.043, 0.045],
    [front + 0.029, 0.044], [0.128, 0.179], [0.055, y - 0.026]], 0.012);
  g.add(slab(forward, -0.021, 0.056, black, 0.008));
  g.add(flywheel(new THREE.Vector3(0.093, 0.177, -0.137), 0.107, 0.088, edge));
  g.add(tube(new THREE.Vector3(-0.04, 0.155, -0.21), new THREE.Vector3(-0.045, 0.13, -0.249), 0.005, edge));
  for (const [z, half] of [[rear, 0.227], [front, 0.29]] as const) {
    const rail = rounded([[z - 0.028, 0.006], [z + 0.028, 0.006], [z + 0.027, 0.039],
      [z + 0.015, 0.048], [z - 0.015, 0.048], [z - 0.027, 0.039]], 0.005);
    g.add(slab(rail, -half + 0.021, half - 0.021, black, 0.005));
    for (const s of [-1, 1]) {
      const end = rounded([[z - 0.032, 0.004], [z + 0.032, 0.004], [z + 0.032, 0.027],
        [z + 0.017, 0.044], [z - 0.017, 0.044], [z - 0.032, 0.027]], 0.006);
      g.add(slab(end, s < 0 ? -half : half - 0.05, s < 0 ? -half + 0.05 : half, rubber, 0.004));
    }
    for (const x of [-0.051, 0.062]) {
      g.add(tube(new THREE.Vector3(x, 0.047, z), new THREE.Vector3(x, 0.051, z), 0.006, screws, 8));
    }
    const logo = labelParts([['KICKR', '#f2f2f2'], ['CORE', '#29a8e0']], 0.117, 0.023, 800);
    logo.rotation.set(-Math.PI / 2, 0, 0);
    logo.position.set(-0.131, 0.053, z);
    g.add(logo);
  }
  return g;
}

const BUILDERS: Record<string, { build: () => THREE.Group; block: 'tacx' | 'tacx3m' | 'wahoo' }> = {
  'trainer-neo-2t': { build: () => neo(false), block: 'tacx' },
  'trainer-neo-3m': { build: () => neo(true), block: 'tacx3m' },
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
