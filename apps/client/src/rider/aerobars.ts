import * as THREE from 'three/webgpu';
import type { AerobarKind } from '@allezrobert/shared';

/**
 * Prolongateurs de l'atelier montés sur un cintre route (BikeExtras.aerobars), construits ici et posés
 * d'après les cocottes du cadre (ancres hand_L / hand_R) : colliers sur le haut du cintre, repose-coudes,
 * pont entre les deux côtés, extensions qui remontent en bout (« ski »), poignées. Repère du vélo : +z
 * avant, +y haut, +x gauche.
 *  - « clip » (type Swiss Side Hadron, plan de 400 mm) : repose-coudes bas, juste au-dessus des colliers ;
 *  - « clip-haut » (type FastT Xenos) : repose-coudes sur des pieds, extensions plus relevées (mains hautes).
 * Matériaux : « aerobar » (carbone), « aerobar_pad » (mousse des repose-coudes, poignées).
 */

interface KindDef {
  /** Hauteur du dessus des repose-coudes au-dessus du haut du cintre (m). */
  stack: number;
  /** Remontée du bout des extensions au-dessus de leur départ (m). */
  tipRise: number;
}

const KINDS: Record<AerobarKind, KindDef> = {
  clip: { stack: 0.04, tipRise: 0.05 },
  'clip-haut': { stack: 0.12, tipRise: 0.09 },
};

/** Haut du cintre (milieu, sur la potence) par rapport à l'ancre de la cocotte (mesuré sur le vélo de base). */
const BAR_FROM_HOOD = new THREE.Vector3(0, -0.073, -0.025);
/** Repose-coudes : centre (x), longueur et largeur (m, plan Swiss Side 137,8 × 88,5 mm), recul du centre derrière le cintre. */
const PAD_X = 0.085;
const PAD_LEN = 0.138;
const PAD_W = 0.088;
const PAD_BACK = 0.035;
/** Extensions : écart (x), longueur au-delà du cintre (m), rayon du tube. */
const EXT_X = 0.06;
const EXT_REACH = 0.33;
const EXT_R = 0.011;

type Side = 'L' | 'R';

/** Points d'appui du coureur : coudes sur les repose-coudes, mains sur les poignées (repère du vélo). */
export interface AerobarAnchors {
  pads: Record<Side, THREE.Vector3>;
  grips: Record<Side, THREE.Vector3>;
}

/** Haut du cintre au milieu (sur la potence), d'après les cocottes. */
function barTop(hands: Record<Side, THREE.Vector3>): THREE.Vector3 {
  return new THREE.Vector3(0, (hands.L.y + hands.R.y) / 2, (hands.L.z + hands.R.z) / 2).add(BAR_FROM_HOOD);
}

/** Courbe d'une extension (côté sx = ±1) : départ sous le repose-coudes, droite, puis remontée en bout. */
function extensionCurve(kind: AerobarKind, top: THREE.Vector3, sx: number): THREE.CatmullRomCurve3 {
  const k = KINDS[kind];
  const y0 = top.y + k.stack - 0.02;
  const z0 = top.z;
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(sx * EXT_X, y0, z0 - 0.07),
    new THREE.Vector3(sx * EXT_X, y0 + 0.002, z0 + 0.12),
    new THREE.Vector3(sx * EXT_X * 0.88, y0 + k.tipRise * 0.3, z0 + 0.25),
    new THREE.Vector3(sx * EXT_X * 0.8, y0 + k.tipRise, z0 + EXT_REACH),
  ]);
}

export function aerobarAnchors(kind: AerobarKind, hands: Record<Side, THREE.Vector3>): AerobarAnchors {
  const top = barTop(hands);
  const k = KINDS[kind];
  const pad = (sx: number) => new THREE.Vector3(sx * PAD_X, top.y + k.stack + 0.035, top.z - PAD_BACK - 0.02);
  // Poignée : un peu avant le bout de l'extension.
  const grip = (sx: number) => extensionCurve(kind, top, sx).getPoint(0.9).add(new THREE.Vector3(0, 0.02, 0));
  return { pads: { L: pad(1), R: pad(-1) }, grips: { L: grip(1), R: grip(-1) } };
}

/** Rectangle aux coins arrondis (plan x-y de la forme), centré. */
function roundedRect(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function named(name: string): THREE.MeshStandardNodeMaterial {
  // Matériau provisoire : le vélo monté le remplace par celui de BikeMaterials (même nom).
  const m = new THREE.MeshStandardNodeMaterial({ color: name === 'aerobar_pad' ? '#1f2022' : '#141518' });
  m.name = name;
  return m;
}

/** Prolongateurs (un niveau de détail : `lod` 1 = moins de segments), groupe « aerobars » dans le repère du vélo. */
export function buildAerobars(kind: AerobarKind, hands: Record<Side, THREE.Vector3>, lod: 0 | 1): THREE.Group {
  const g = new THREE.Group();
  g.name = 'aerobars';
  const top = barTop(hands);
  const k = KINDS[kind];
  const carbon = named('aerobar');
  const foam = named('aerobar_pad');
  const seg = lod ? 8 : 16;
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material): void => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  };
  const barY = top.y - 0.0125;
  for (const sx of [1, -1]) {
    // Collier autour du cintre.
    add(new THREE.CylinderGeometry(0.019, 0.019, 0.032, seg).rotateZ(Math.PI / 2).translate(sx * 0.07, barY, top.z), carbon);
    // Pied : du collier au repose-coudes (haut pour « clip-haut »).
    const h = k.stack - 0.005;
    add(new THREE.BoxGeometry(0.026, h, 0.034).translate(sx * 0.07, top.y + h / 2 - 0.004, top.z - 0.012), carbon);
    if (kind === 'clip-haut') add(new THREE.BoxGeometry(0.026, h, 0.03).translate(sx * 0.07, top.y + h / 2 - 0.004, top.z - 0.075), carbon);
    // Repose-coudes : coque carbone et mousse, bords relevés dehors et derrière.
    const padY = top.y + k.stack;
    const padZ = top.z - PAD_BACK;
    const shell = new THREE.ExtrudeGeometry(roundedRect(PAD_W, PAD_LEN, 0.03), { depth: 0.006, bevelEnabled: false, curveSegments: lod ? 3 : 6 });
    add(shell.rotateX(Math.PI / 2).translate(sx * PAD_X, padY, padZ), carbon);
    const cushion = new THREE.ExtrudeGeometry(roundedRect(PAD_W - 0.012, PAD_LEN - 0.012, 0.026), { depth: 0.008, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: lod ? 1 : 2, curveSegments: lod ? 3 : 6 });
    add(cushion.rotateX(-Math.PI / 2).translate(sx * PAD_X, padY + 0.001, padZ), foam);
    add(new THREE.BoxGeometry(0.006, 0.022, PAD_LEN * 0.75).translate(sx * (PAD_X + PAD_W / 2 - 0.003), padY + 0.011, padZ - 0.01), carbon);
    add(new THREE.BoxGeometry(PAD_W * 0.7, 0.022, 0.006).translate(sx * (PAD_X + 0.008), padY + 0.011, padZ - PAD_LEN / 2 + 0.003), carbon);
    // Extension et poignée en bout.
    const curve = extensionCurve(kind, top, sx);
    add(new THREE.TubeGeometry(curve, lod ? 10 : 24, EXT_R, seg, false), carbon);
    const end = curve.getPoint(1);
    const tip = new THREE.CatmullRomCurve3([curve.getPoint(0.82), curve.getPoint(0.91), end]);
    add(new THREE.TubeGeometry(tip, lod ? 3 : 6, EXT_R * 1.25, seg, false), foam);
    add(new THREE.SphereGeometry(EXT_R * 1.25, seg, lod ? 4 : 8).translate(end.x, end.y, end.z), foam);
  }
  // Pont entre les deux côtés, sous les repose-coudes.
  add(new THREE.BoxGeometry(0.16, 0.012, 0.026).translate(0, top.y + k.stack - 0.014, top.z - 0.02), carbon);
  return g;
}
