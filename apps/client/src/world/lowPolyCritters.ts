import * as THREE from 'three/webgpu';
import { box, part, prism, template } from './lowPolyKit.ts';

/**
 * Petits animaux du mode Poly (avant +x, pieds en y = 0), posés dans le maillage animé des troupeaux (roadsideLife.ts).
 * `head` partiel : la tête picore ou se baisse de quelques centimètres au lieu des 45 cm d'une vache.
 */
const cone = (r: number, h: number, sides = 4) => new THREE.ConeGeometry(r, h, sides);
const leg = (x: number, z: number, h: number, colour: string, w = 0.02) => part(box(w, h, w, x, h / 2, z), colour);

/** Chat assis : poitrail droit, oreilles, queue enroulée. */
function catSitting() {
  return template([
    part(prism(0.11, 0.065, 0, 0.3, 6).scale(1.15, 1, 1), '#ffffff', 1),
    part(box(0.1, 0.05, 0.2, 0.1, 0.025), '#ffffff', 1),
    part(new THREE.IcosahedronGeometry(0.085, 0).scale(0.95, 0.9, 1).translate(0.04, 0.37, 0), '#ffffff', 1, 0.06),
    ...[-0.045, 0.045].map((z) => part(cone(0.03, 0.07).translate(0.03, 0.46, z), '#ffffff', 1, 0.06)),
    part(box(0.03, 0.025, 0.03, 0.12, 0.355), '#e3a59a', 0, 0.06),
    part(box(0.2, 0.04, 0.045, -0.05, 0.03, 0.14), '#ffffff', 1),
  ]);
}

/** Chat couché, qui dort au soleil. */
function catLying() {
  return template([
    part(new THREE.IcosahedronGeometry(0.15, 0).scale(1.35, 0.62, 0.9).translate(0, 0.09, 0), '#ffffff', 1),
    part(new THREE.IcosahedronGeometry(0.08, 0).translate(0.2, 0.09, 0.05), '#ffffff', 1),
    ...[0.01, 0.09].map((z) => part(cone(0.028, 0.06).translate(0.2, 0.17, z), '#ffffff', 1)),
    part(box(0.26, 0.035, 0.04, -0.12, 0.03, 0.13), '#ffffff', 1),
  ]);
}

function hen(rooster: boolean) {
  const k = rooster ? 1.15 : 1;
  return template([
    part(new THREE.IcosahedronGeometry(0.13 * k, 0).scale(1.25, 0.95, 0.85).translate(0, 0.23 * k, 0), '#ffffff', 1),
    part(prism(0.06 * k, 0.04 * k, 0.26 * k, 0.4 * k, 5, 0.12 * k), '#ffffff', 1, 0.35),
    part(box(0.07, 0.07, 0.06, 0.14 * k, 0.43 * k), '#ffffff', 1, 0.35),
    part(cone(0.022, 0.06).rotateZ(-Math.PI / 2).translate(0.2 * k, 0.425 * k, 0), '#e6a23a', 0, 0.35),
    part(box(0.07, rooster ? 0.06 : 0.035, 0.02, 0.14 * k, 0.485 * k), '#d23b33', 0, 0.35),
    part(box(0.02, 0.04, 0.03, 0.18 * k, 0.385 * k), '#d23b33', 0, 0.35),
    part(cone(0.09 * k, rooster ? 0.3 : 0.18, 4).rotateZ(rooster ? 0.9 : 1.1).translate(-0.17 * k, 0.33 * k, 0), rooster ? '#26483c' : '#ffffff', rooster ? 0 : 1),
    leg(0.02, 0.04, 0.14 * k, '#e6a23a'),
    leg(0.02, -0.04, 0.14 * k, '#e6a23a'),
  ]);
}

function duck() {
  return template([
    part(new THREE.IcosahedronGeometry(0.14, 0).scale(1.45, 0.8, 0.9).translate(0, 0.17, 0), '#ffffff', 1),
    part(prism(0.045, 0.04, 0.2, 0.34, 5, 0.16), '#f4f1e8', 0, 0.12),
    part(new THREE.IcosahedronGeometry(0.06, 0).translate(0.17, 0.37, 0), '#2f6b4d', 0, 0.12),
    part(box(0.08, 0.025, 0.05, 0.25, 0.355), '#e6a23a', 0, 0.12),
    part(cone(0.06, 0.12).rotateZ(1.2).translate(-0.22, 0.22, 0), '#f4f1e8'),
    leg(0, 0.05, 0.08, '#e6853a', 0.03),
    leg(0, -0.05, 0.08, '#e6853a', 0.03),
  ]);
}

function goose() {
  return template([
    part(new THREE.IcosahedronGeometry(0.2, 0).scale(1.5, 0.85, 0.95).translate(0, 0.34, 0), '#ffffff', 1),
    part(prism(0.06, 0.045, 0.4, 0.82, 5, 0.22), '#ffffff', 1, 0.5),
    part(new THREE.IcosahedronGeometry(0.075, 0).scale(1.2, 0.9, 0.9).translate(0.25, 0.85, 0), '#ffffff', 1, 0.5),
    part(cone(0.035, 0.11).rotateZ(-Math.PI / 2).translate(0.37, 0.84, 0), '#e6853a', 0, 0.5),
    part(cone(0.09, 0.2).rotateZ(1.15).translate(-0.32, 0.42, 0), '#ffffff', 1),
    leg(0, 0.07, 0.2, '#e6853a', 0.035),
    leg(0, -0.07, 0.2, '#e6853a', 0.035),
  ]);
}

function rabbit() {
  return template([
    part(new THREE.IcosahedronGeometry(0.11, 0).scale(1.35, 1, 0.9).translate(-0.02, 0.12, 0), '#ffffff', 1),
    part(new THREE.IcosahedronGeometry(0.07, 0).translate(0.13, 0.2, 0), '#ffffff', 1, 0.18),
    ...[-0.03, 0.03].map((z) => part(box(0.03, 0.14, 0.025, 0.1, 0.31, z), '#ffffff', 1, 0.18)),
    part(new THREE.IcosahedronGeometry(0.04, 0).translate(-0.17, 0.13, 0), '#f6f2ea'),
    part(box(0.1, 0.04, 0.16, 0.04, 0.02), '#ffffff', 1),
  ]);
}

export function critterTemplates() {
  return { cat: catSitting(), catLying: catLying(), hen: hen(false), rooster: hen(true), duck: duck(), goose: goose(), rabbit: rabbit() };
}
export type CritterTemplates = ReturnType<typeof critterTemplates>;

export const CRITTER_COLOURS = {
  cat: ['#d98a3d', '#6d6a66', '#2c2a2a', '#efe9dd', '#a98b6a'].map((c) => new THREE.Color(c)),
  hen: ['#b5622e', '#f0ebe0', '#5c3a26', '#d9a45b'].map((c) => new THREE.Color(c)),
  duck: ['#8b7355', '#b9b2a6', '#6f5b45'].map((c) => new THREE.Color(c)),
  goose: ['#f4f2ea', '#c9c4ba'].map((c) => new THREE.Color(c)),
  rabbit: ['#9a7a5c', '#7d6a57', '#b79a78'].map((c) => new THREE.Color(c)),
};
