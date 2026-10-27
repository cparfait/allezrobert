import * as THREE from 'three/webgpu';
import { mat } from './atelierRoom.ts';

/**
 * Outils de mécanicien vélo en 3D : accrochés au panneau perforé (au-dessus de l'établi, mur du
 * fond) et posés sur l'établi. Repère du panneau : u le long du panneau (0 = bord gauche vu de la
 * pièce, z = 0,7), v en hauteur depuis son bord bas (y = 1,115), w vers la pièce.
 */

const CHROME = mat('#c9ced4', 0.22, 1);
const STEEL = mat('#4a4e55', 0.35, 0.85);
const BLUE = mat('#2a63c0', 0.5, 0.05);
const RED = mat('#c4361d', 0.5, 0.05);
const BLACK = mat('#17181b', 0.7, 0);
const WOOD = mat('#9a6a3a', 0.6, 0);

const BOARD = { x: -3.17, y: 1.115, z: 0.7 };

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

/** Cylindre d'axe y. */
const cylY = (r: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 14) => mesh(new THREE.CylinderGeometry(r, r, h, seg), m, x, y, z);

/** Crochet de panneau perforé : tige qui sort du panneau, extrémité relevée. */
function peg(u: number, v: number, len = 0.06): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.003, 0.003, len, 8).rotateX(Math.PI / 2), CHROME, 0, 0, len / 2));
  g.add(mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.018, 8), CHROME, 0, 0.009, len));
  g.position.set(u, v, 0);
  return g;
}

/**
 * Clé mixte (fourche + œil) pendue par l'œil : longueur L, largeur du corps w. Origine : centre
 * de l'œil, la clé descend.
 */
function comboWrench(L: number, w: number): THREE.Group {
  const g = new THREE.Group();
  const t = 0.005;
  const ringR = w * 0.95;
  // Œil (anneau polygonal 12 pans) en haut, légèrement décalé comme les vraies clés.
  g.add(mesh(new THREE.TorusGeometry(ringR, w * 0.38, 6, 12), CHROME, 0, 0, t));
  // Corps : plat, s'élargissant vers la fourche.
  const bodyL = L - ringR * 2;
  const body = new THREE.CylinderGeometry(w * 0.7, w * 0.85, bodyL, 4).rotateY(Math.PI / 4);
  body.scale(1, 1, 0.3);
  g.add(mesh(body, CHROME, 0, -L / 2, t));
  // Fourche ouverte en bas, inclinée à 15°.
  const jaw = new THREE.TorusGeometry(ringR * 1.05, w * 0.42, 6, 14, Math.PI * 1.25);
  const j = mesh(jaw, CHROME, 0, -L + ringR, t);
  j.rotation.z = -Math.PI / 2 - Math.PI * 0.625 + 0.26;
  g.add(j);
  return g;
}

/** Clé Allen en L : grand bras vertical, petit bras horizontal en haut. */
function hexKey(long: number, short: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const geo = (h: number) => new THREE.CylinderGeometry(d / 2, d / 2, h, 6);
  g.add(mesh(geo(long), STEEL, 0, -long / 2, 0));
  g.add(mesh(geo(short).rotateZ(Math.PI / 2), STEEL, short / 2, 0, 0));
  return g;
}

/** Tournevis pendu tige en bas : manche bi-matière, tige acier, bout plat ou cruciforme. */
function screwdriver(handle: THREE.Material, shaft: number): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.013, 0.015, 0.1, 16), handle, 0, 0.05, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.0135, 0.0135, 0.025, 16), BLACK, 0, 0.0, 0));
  g.add(mesh(new THREE.SphereGeometry(0.013, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), handle, 0, 0.1, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.003, 0.003, shaft, 8), CHROME, 0, -0.0125 - shaft / 2, 0));
  g.add(mesh(new THREE.BoxGeometry(0.006, 0.01, 0.0015), CHROME, 0, -0.0125 - shaft - 0.004, 0));
  return g;
}

/** Pince coupante (câbles et gaines) : poignées gainées, mâchoires acier, pivot. */
function cutters(grip: THREE.Material, open: number): THREE.Group {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const arm = new THREE.Group();
    arm.add(mesh(new THREE.CylinderGeometry(0.008, 0.007, 0.13, 10), grip, 0, -0.075, 0));
    arm.add(mesh(new THREE.BoxGeometry(0.012, 0.05, 0.006), STEEL, 0, 0.015, 0));
    arm.rotation.z = s * open;
    g.add(arm);
  }
  // Mâchoires et pivot.
  g.add(mesh(new THREE.ConeGeometry(0.012, 0.045, 4).rotateY(Math.PI / 4), STEEL, 0, 0.06, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.012, 12).rotateX(Math.PI / 2), CHROME, 0, 0.03, 0.004));
  return g;
}

/** Fouet à chaîne : manche acier, poignée, deux brins de chaîne. */
function chainWhip(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.022, 0.3, 0.005), STEEL, 0, -0.15, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.12, 12), BLUE, 0, -0.25, 0.004));
  const link = new THREE.CylinderGeometry(0.0035, 0.0035, 0.008, 8).rotateX(Math.PI / 2);
  const plate = new THREE.BoxGeometry(0.0055, 0.0127, 0.002);
  for (const [len, side] of [[24, -1], [14, 1]] as const) {
    for (let i = 0; i < len; i++) {
      const a = -0.25 + (i / len) * 1.1 * side;
      const r = 0.035 + i * 0.0025;
      const x = side * 0.012 + Math.sin(a) * r * 0.6;
      const y = -0.012 - i * 0.0127;
      g.add(mesh(link, STEEL, x, y, 0.002));
      g.add(mesh(plate, CHROME, x, y + 0.0064, 0.0025));
    }
  }
  return g;
}

/** Clé à pédales : longue clé plate de 15 mm, poignée rouge. */
function pedalWrench(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.026, 0.34, 0.006), CHROME, 0, -0.17, 0));
  g.add(mesh(new THREE.TorusGeometry(0.018, 0.008, 6, 12, Math.PI * 1.3), CHROME, 0, 0.005, 0).rotateZ(-Math.PI * 0.15));
  g.add(mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.15, 14), RED, 0, -0.26, 0.005));
  return g;
}

/** Maillet à tête caoutchouc, manche bois. */
function mallet(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.3, 12), WOOD, 0, -0.15, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.11, 18).rotateZ(Math.PI / 2), BLACK, 0, 0.0, 0.01));
  return g;
}

/** Clé en Y (trois six-pans 4, 5, 6 mm) : corps rouge, embouts acier. */
function yWrench(): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 + (i * Math.PI * 2) / 3;
    const arm = new THREE.Group();
    arm.add(mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.07, 10), RED, 0, 0.035, 0));
    arm.add(mesh(new THREE.CylinderGeometry(0.0025 + i * 0.0005, 0.0025 + i * 0.0005, 0.03, 6), STEEL, 0, 0.083, 0));
    arm.rotation.z = a - Math.PI / 2;
    g.add(arm);
  }
  g.add(mesh(new THREE.SphereGeometry(0.014, 12, 10), RED));
  return g;
}

/** Clé Allen en T : tige acier, poignée transversale gainée. */
function tHex(len: number, grip: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 12).rotateZ(Math.PI / 2), grip, 0, 0, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.0028, 0.0028, len, 6), STEEL, 0, -len / 2, 0));
  return g;
}

/** Clé à cônes : clé plate très fine, poignée plastifiée bleue, deux fourches. */
function coneWrench(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.022, 0.2, 0.003), CHROME, 0, -0.1, 0));
  g.add(mesh(new THREE.BoxGeometry(0.026, 0.11, 0.006), BLUE, 0, -0.1, 0.001));
  for (const y of [0.005, -0.205]) g.add(mesh(new THREE.TorusGeometry(0.014, 0.005, 5, 10, Math.PI * 1.3), CHROME, 0, y, 0).rotateZ(y > 0 ? -Math.PI * 0.15 : Math.PI * 0.85));
  return g;
}

/** Clé à molette : corps forgé, mâchoire, molette. */
function adjustable(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.028, 0.22, 0.008), CHROME, 0, -0.12, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 18).rotateX(Math.PI / 2), CHROME, 0, 0.0, 0));
  g.add(mesh(new THREE.BoxGeometry(0.024, 0.03, 0.013), STEEL, 0.012, 0.03, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.014, 12), STEEL, -0.012, -0.03, 0.006));
  g.add(mesh(new THREE.TorusGeometry(0.007, 0.0025, 6, 12), CHROME, 0, -0.225, 0));
  return g;
}

/** Dérive-chaîne : corps, vis à poignée, berceau. */
function chainTool(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.03, 0.06, 0.02), STEEL, 0, -0.03, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.06, 8), CHROME, 0, -0.09, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.07, 12).rotateZ(Math.PI / 2), RED, 0, -0.12, 0));
  return g;
}

/** Douille cannelée (boîtier de pédalier, écrou de cassette), pendue par un cordon. */
function splineTool(r: number, h: number): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(r, r, h, 20), STEEL, 0, -h / 2 - 0.02, 0.01));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.add(mesh(new THREE.BoxGeometry(0.004, 0.012, 0.004), STEEL, Math.cos(a) * r, -h - 0.026, 0.01 + Math.sin(a) * r));
  }
  g.add(mesh(new THREE.TorusGeometry(0.012, 0.002, 6, 12), BLACK, 0, -0.008, 0.01));
  return g;
}

/** Scie à métaux (gaines, cintres) : arceau, lame, poignée. */
function hacksaw(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.34, 0.012, 0.008), BLUE, 0, 0, 0));
  g.add(mesh(new THREE.BoxGeometry(0.012, 0.09, 0.008), BLUE, -0.165, -0.045, 0));
  g.add(mesh(new THREE.BoxGeometry(0.012, 0.09, 0.008), BLUE, 0.165, -0.045, 0));
  g.add(mesh(new THREE.BoxGeometry(0.33, 0.012, 0.002), CHROME, 0, -0.085, 0));
  g.add(mesh(new THREE.BoxGeometry(0.03, 0.08, 0.02), BLACK, 0.19, -0.07, 0).rotateZ(-0.35));
  return g;
}

/** Pneu ou chambre à air enroulé, pendu à un crochet. */
function coil(r: number, tube: number, m: THREE.Material): THREE.Mesh {
  const o = mesh(new THREE.TorusGeometry(r, tube, 10, 40), m);
  o.scale.set(1, 1, 0.55);
  return o;
}

/** Outils accrochés au panneau perforé (repère du panneau), avec leurs crochets. */
function boardTools(): THREE.Group {
  const b = new THREE.Group();
  b.name = 'atelier_tools_board';
  // Support de clés Allen : réglette bleue percée, neuf clés de 1,5 à 10 mm.
  b.add(mesh(new THREE.BoxGeometry(0.26, 0.025, 0.03), BLUE, 0.32, 1.02, 0.02));
  b.add(peg(0.22, 1.05), peg(0.42, 1.05));
  for (let i = 0; i < 9; i++) {
    const k = hexKey(0.07 + i * 0.012, 0.022 + i * 0.003, 0.0022 + i * 0.0009);
    k.position.set(0.21 + i * 0.026, 1.0, 0.03);
    b.add(k);
  }
  // Clé en Y.
  b.add(peg(0.62, 0.92));
  const y = yWrench();
  y.position.set(0.62, 0.86, 0.02);
  b.add(y);
  // Clés mixtes de 8 à 17 mm sur une réglette chromée.
  b.add(mesh(new THREE.BoxGeometry(0.62, 0.012, 0.012), CHROME, 1.08, 1.08, 0.03));
  b.add(peg(0.8, 1.08), peg(1.36, 1.08));
  for (let i = 0; i < 10; i++) {
    const w = comboWrench(0.12 + i * 0.012, 0.009 + i * 0.0009);
    w.position.set(0.8 + i * 0.062, 1.06, 0.025);
    b.add(w);
  }
  // Tournevis dans un râtelier bleu.
  b.add(mesh(new THREE.BoxGeometry(0.3, 0.018, 0.05), BLUE, 1.67, 1.0, 0.03));
  [BLUE, RED, BLACK, BLUE, RED, BLACK].forEach((m, i) => {
    const s = screwdriver(m, 0.07 + (i % 3) * 0.03);
    s.position.set(1.55 + i * 0.048, 1.02, 0.03);
    b.add(s);
  });
  // Pinces coupantes.
  [BLUE, RED].forEach((m, i) => {
    b.add(peg(1.95 + i * 0.1, 1.05));
    const c = cutters(m, 0.08 + i * 0.04);
    c.position.set(1.95 + i * 0.1, 0.98, 0.03);
    b.add(c);
  });
  // Fouet à chaîne, clé à pédales, maillet : grands outils à droite.
  b.add(peg(2.32, 1.05));
  const cw = chainWhip();
  cw.position.set(2.32, 1.04, 0.025);
  b.add(cw);
  b.add(peg(2.55, 1.05));
  const pw = pedalWrench();
  pw.position.set(2.55, 1.03, 0.02);
  b.add(pw);
  b.add(peg(2.8, 0.95));
  const ml = mallet();
  ml.position.set(2.8, 0.92, 0.03);
  b.add(ml);
  // Rangée du milieu : clés Allen en T, clés à cônes, clé à molette, dérive-chaîne, douilles, scie.
  b.add(mesh(new THREE.BoxGeometry(0.4, 0.014, 0.04), STEEL, 0.36, 0.66, 0.02));
  [RED, BLUE, RED, BLUE, RED, BLUE].forEach((m, i) => {
    const t = tHex(0.1 + i * 0.012, m);
    t.position.set(0.2 + i * 0.065, 0.69, 0.03);
    b.add(t);
  });
  for (let i = 0; i < 5; i++) {
    b.add(peg(0.72 + i * 0.05, 0.68));
    const c = coneWrench();
    c.position.set(0.72 + i * 0.05, 0.67, 0.025 + i * 0.002);
    b.add(c);
  }
  b.add(peg(1.06, 0.7));
  const adj = adjustable();
  adj.position.set(1.06, 0.66, 0.02);
  b.add(adj);
  b.add(peg(1.2, 0.68));
  const ct = chainTool();
  ct.position.set(1.2, 0.67, 0.02);
  b.add(ct);
  [[1.32, 0.022, 0.03], [1.4, 0.019, 0.025], [1.48, 0.03, 0.02]].forEach(([u, r, h]) => {
    b.add(peg(u as number, 0.68));
    const t = splineTool(r as number, h as number);
    t.position.set(u as number, 0.68, 0);
    b.add(t);
  });
  b.add(peg(1.6, 0.62), peg(1.95, 0.62));
  const saw = hacksaw();
  saw.position.set(1.78, 0.64, 0.025);
  b.add(saw);
  // Pneus pliés et chambres à air enroulés, en bas à droite.
  b.add(peg(2.25, 0.42, 0.08), peg(2.6, 0.42, 0.08), peg(2.92, 0.42, 0.08));
  const t1 = coil(0.12, 0.016, BLACK);
  t1.position.set(2.25, 0.3, 0.04);
  const t2 = coil(0.12, 0.016, mat('#a9825a', 0.85, 0));
  t2.position.set(2.6, 0.3, 0.04);
  const t3 = coil(0.09, 0.009, BLACK);
  t3.position.set(2.92, 0.33, 0.04);
  b.add(t1, t2, t3);
  // Rangée basse : démonte-pneus, clés à rayons, mètre ruban, colliers.
  for (let i = 0; i < 3; i++) {
    b.add(peg(0.3 + i * 0.07, 0.32, 0.04));
    const lever = mesh(new THREE.BoxGeometry(0.018, 0.11, 0.006), i === 1 ? RED : BLUE, 0.3 + i * 0.07, 0.27, 0.02);
    b.add(lever);
  }
  for (let i = 0; i < 2; i++) {
    b.add(peg(0.62 + i * 0.07, 0.32, 0.04));
    b.add(mesh(new THREE.TorusGeometry(0.018, 0.005, 6, 16), i ? RED : BLACK, 0.62 + i * 0.07, 0.295, 0.02));
  }
  b.add(peg(0.9, 0.32, 0.04));
  b.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 18).rotateX(Math.PI / 2), mat('#e8b51c', 0.5, 0), 0.9, 0.28, 0.02));
  b.add(peg(1.05, 0.32, 0.04));
  for (let i = 0; i < 12; i++) b.add(mesh(new THREE.BoxGeometry(0.003, 0.16, 0.0015), BLACK, 1.035 + i * 0.003, 0.24, 0.02 + (i % 3) * 0.002));
  b.position.set(BOARD.x, BOARD.y, BOARD.z);
  b.rotation.y = Math.PI / 2;
  return b;
}

/** Outils posés sur l'établi (plateau à y = 0,95, le long du mur du fond). */
function benchTools(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'atelier_tools_bench';
  const top = 0.95;
  // Clé dynamométrique couchée : tube acier, poignée noire, tête à cliquet, échelle gravée.
  const tq = new THREE.Group();
  tq.add(mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.26, 14).rotateZ(Math.PI / 2), CHROME));
  tq.add(mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.11, 14).rotateZ(Math.PI / 2), BLACK, -0.17, 0, 0));
  tq.add(mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.016, 18), STEEL, 0.15, 0, 0));
  tq.add(mesh(new THREE.BoxGeometry(0.01, 0.012, 0.01), STEEL, 0.15, -0.013, 0));
  tq.position.set(-2.62, top + 0.014, -1.62);
  tq.rotation.y = 0.3;
  g.add(tq);
  // Cassette démontée (pignons empilés) et son outil de démontage.
  for (let i = 0; i < 9; i++) {
    const r = 0.025 + i * 0.0045;
    g.add(mesh(new THREE.CylinderGeometry(r, r, 0.0022, 28), CHROME, -2.62, top + 0.0011 + i * 0.0042, -1.25));
  }
  g.add(mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.005, 20), STEEL, -2.62, top + 0.04, -1.25));
  g.add(mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.035, 12), STEEL, -2.55, top + 0.0175, -1.38));
  // Vérificateur d'usure de chaîne et démonte-pneus.
  const checker = mesh(new THREE.BoxGeometry(0.12, 0.004, 0.016), RED, -2.58, top + 0.002, -0.6);
  checker.rotation.y = -0.3;
  g.add(checker);
  [BLUE, RED, BLUE].forEach((m, i) => {
    const l = mesh(new THREE.BoxGeometry(0.11, 0.006, 0.018), m, -2.52 + i * 0.01, top + 0.003 + i * 0.006, -0.82 + i * 0.012);
    l.rotation.y = 0.2 + i * 0.25;
    g.add(l);
  });
  return g;
}

export function buildTools(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'atelier_tools';
  g.add(boardTools(), benchTools());
  return g;
}
