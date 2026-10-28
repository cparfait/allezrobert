import * as THREE from 'three/webgpu';
import { box, part, prism, template, type Template } from './lowPolyKit.ts';

/**
 * Gabarits du décor « jeu vidéo » le long de la route (style low poly) : quelques dizaines de triangles
 * à facettes chacun, fusionnés par tronçon dans roadsideLife.ts. Les animaux regardent vers +x ; les
 * objets tournés vers la route (boîtes aux lettres, poubelles, bancs) ont leur face avant vers +z.
 */

/** Pattes : quatre pavés sous le corps, couleur propre (sabots compris). */
function legs(len: number, halfX: number, halfZ: number, w: number, col: string): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(part(box(w, len, w, sx * halfX, len / 2, sz * halfZ), col, 0));
  return out;
}

/** Vache (tête vers +x), ≈ 130 triangles. Robe = couleur de l'objet, taches sombres. */
function cow(): Template {
  return template([
    part(box(1.7, 0.8, 0.75, 0, 1.1, 0), '#ffffff', 1),
    part(box(0.7, 0.42, 0.77, -0.25, 1.25, 0), '#2b2420', 0),
    part(box(0.3, 0.3, 0.77, 0.45, 0.98, 0), '#2b2420', 0),
    part(box(0.25, 0.5, 0.35, 0.95, 1.2, 0), '#ffffff', 1, 1),
    part(box(0.42, 0.38, 0.4, 1.2, 1.15, 0), '#ffffff', 1, 1),
    part(box(0.12, 0.2, 0.36, 1.43, 1.05, 0), '#e7a9a0', 0, 1),
    part(box(0.06, 0.16, 0.06, 1.15, 1.42, 0.16), '#e8e2d2', 0, 1),
    part(box(0.06, 0.16, 0.06, 1.15, 1.42, -0.16), '#e8e2d2', 0, 1),
    part(box(0.05, 0.6, 0.05, -0.88, 1.05, 0), '#2b2420', 0),
    ...legs(0.72, 0.6, 0.24, 0.17, '#3a302a'),
  ]);
}

/** Mouton : toison en icosaèdre, tête et pattes sombres. */
function sheep(): Template {
  return template([
    part(new THREE.IcosahedronGeometry(0.55, 0).scale(1.35, 0.95, 1).translate(0, 0.78, 0), '#ffffff', 1),
    part(box(0.3, 0.3, 0.26, 0.7, 0.82, 0), '#2a2522', 0, 1),
    part(box(0.1, 0.06, 0.4, 0.66, 0.92, 0), '#2a2522', 0, 1),
    ...legs(0.45, 0.32, 0.18, 0.09, '#2a2522'),
  ]);
}

/** Cheval : corps, encolure et tête inclinées, crinière et queue. */
function horse(): Template {
  const neck = new THREE.BoxGeometry(0.32, 0.85, 0.3).rotateZ(-0.6).translate(0.95, 1.85, 0);
  const headG = new THREE.BoxGeometry(0.62, 0.26, 0.26).rotateZ(-0.5).translate(1.38, 2.05, 0);
  const mane = new THREE.BoxGeometry(0.08, 0.8, 0.12).rotateZ(-0.6).translate(0.85, 1.98, 0);
  const tail = new THREE.BoxGeometry(0.1, 0.75, 0.1).rotateZ(0.35).translate(-1.0, 1.25, 0);
  return template([
    part(box(1.65, 0.62, 0.55, 0, 1.45, 0), '#ffffff', 1),
    part(neck, '#ffffff', 1, 1),
    part(headG, '#ffffff', 1, 1),
    part(mane, '#2a1d15', 0, 1),
    part(tail, '#2a1d15', 0),
    ...legs(1.15, 0.62, 0.18, 0.13, '#2a1d15'),
  ]);
}

/** Poteau électrique en bois, traverse et trois isolateurs (8,6 m) ; traverse selon z. */
function pole(): Template {
  return template([
    part(prism(0.14, 0.1, 0, 8.6, 6), '#ffffff', 1),
    part(box(0.12, 0.14, 1.7, 0, 8.05, 0), '#5a3e28', 0),
    part(box(0.08, 0.16, 0.08, 0, 8.2, -0.7), '#d8d8d0', 0),
    part(box(0.08, 0.16, 0.08, 0, 8.2, 0), '#d8d8d0', 0),
    part(box(0.08, 0.16, 0.08, 0, 8.2, 0.7), '#d8d8d0', 0),
  ]);
}

/** Fleur : tige (prisme à 3 pans) et corolle colorée. */
function flower(): Template {
  return template([part(new THREE.CylinderGeometry(0.012, 0.012, 0.36, 3, 1, true).translate(0, 0.18, 0), '#4f8a2c', 0), part(new THREE.OctahedronGeometry(0.075, 0).scale(1, 0.6, 1).translate(0, 0.38, 0), '#ffffff', 1)]);
}

/** Buisson : icosaèdre aplati ; `dots` : baies ou fleurs posées sur le dessus. */
function bush(dots?: string): Template {
  const parts = [part(new THREE.IcosahedronGeometry(1, 0).scale(1, 0.78, 1).translate(0, 0.55, 0), '#ffffff', 1)];
  if (dots) {
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4;
      const r = 0.45 + (i % 3) * 0.17;
      const y = 0.55 + Math.sqrt(Math.max(0, 1 - r * r)) * 0.78 * 0.92;
      parts.push(part(new THREE.OctahedronGeometry(0.075, 0).translate(Math.cos(a) * r, y, Math.sin(a) * r), dots, 0));
    }
  }
  return template(parts);
}

/** Boîte aux lettres individuelle sur son poteau (face avant vers +z) ; caisse à la couleur de l'objet. */
function mailbox(): Template {
  return template([
    part(box(0.08, 1.0, 0.08, 0, 0.5, 0), '#6b6e70', 0),
    part(box(0.34, 0.36, 0.42, 0, 1.18, 0), '#ffffff', 1),
    part(box(0.38, 0.05, 0.46, 0, 1.385, 0), '#ffffff', 1),
    part(box(0.22, 0.03, 0.01, 0, 1.28, 0.215), '#151515', 0),
    part(box(0.1, 0.07, 0.01, 0, 1.1, 0.215), '#e8e4d8', 0),
  ]);
}

/** Boîte aux lettres de La Poste : caisse jaune au dôme arrondi, bandeau bleu, sur un pied gris. */
function posteBox(): Template {
  return template([
    part(box(0.1, 0.85, 0.1, 0, 0.425, 0), '#5c6064', 0),
    part(box(0.46, 0.55, 0.34, 0, 1.12, 0), '#f6c400', 0),
    part(new THREE.CylinderGeometry(0.17, 0.17, 0.46, 8, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).translate(0, 1.395, 0), '#f6c400', 0),
    part(box(0.3, 0.035, 0.01, 0, 1.28, 0.172), '#141414', 0),
    part(box(0.47, 0.08, 0.35, 0, 0.95, 0), '#1d4fa0', 0),
  ]);
}

/**
 * Poubelle à roulettes (face avant vers +z, roues et poignée à l'arrière) : caisse évasée, couvercle,
 * deux roues. Couleurs fixes par sorte (ordures ménagères, tri, verre, déchets verts).
 */
function bin(body: string, lid: string): Template {
  const shell = new THREE.CylinderGeometry(0.42, 0.36, 0.92, 4, 1).rotateY(Math.PI / 4).scale(1, 1, 1.22).translate(0, 0.52, 0);
  return template([
    part(shell, body, 0),
    part(box(0.64, 0.06, 0.8, 0, 1.0, 0.01), lid, 0),
    part(box(0.6, 0.05, 0.05, 0, 0.98, -0.42), '#2a2b2d', 0),
    part(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 8).rotateZ(Math.PI / 2).translate(0.26, 0.1, -0.33), '#141414', 0),
    part(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 8).rotateZ(Math.PI / 2).translate(-0.26, 0.1, -0.33), '#141414', 0),
  ]);
}

/** But de football (ouverture vers +z, 6 × 2 m) : poteaux, barre, cadre arrière. */
function goal(): Template {
  const w = '#f4f4f0';
  const back = (x: number) => new THREE.BoxGeometry(0.06, 2.3, 0.06).rotateX(0.7).translate(x, 1.0, -0.72);
  return template([
    part(box(0.1, 2.0, 0.1, 3.0, 1.0, 0), w, 0),
    part(box(0.1, 2.0, 0.1, -3.0, 1.0, 0), w, 0),
    part(box(6.1, 0.1, 0.1, 0, 2.0, 0), w, 0),
    part(back(3.0), w, 0),
    part(back(-3.0), w, 0),
    part(box(6.0, 0.05, 0.05, 0, 0.03, -1.45), w, 0),
  ]);
}

/** Banc : planches en bois sur deux pieds en béton (long de 2 m selon x). */
function bench(): Template {
  return template([
    part(box(2.0, 0.06, 0.4, 0, 0.45, 0), '#8a5a33', 0),
    part(box(2.0, 0.3, 0.05, 0, 0.72, -0.19), '#8a5a33', 0),
    part(box(0.12, 0.45, 0.4, 0.8, 0.225, 0), '#a7a49c', 0),
    part(box(0.12, 0.45, 0.4, -0.8, 0.225, 0), '#a7a49c', 0),
  ]);
}

/** Petite tribune en gradins (10 m selon x, face vers +z) avec auvent. */
function stand(): Template {
  const grey = '#b7b4ac';
  const wood = '#7d5230';
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    parts.push(part(box(10, 0.45 * (i + 1), 0.9, 0, 0.225 * (i + 1), -0.9 * i), grey, 0));
    parts.push(part(box(10, 0.06, 0.4, 0, 0.45 * (i + 1) + 0.03, -0.9 * i + 0.1), wood, 0));
  }
  parts.push(part(box(10.4, 0.12, 3.4, 0, 3.2, -0.9), '#c8463c', 0));
  for (const x of [-5, 0, 5]) parts.push(part(box(0.12, 3.2, 0.12, x, 1.6, -2.3), '#5f6266', 0));
  return template(parts);
}

/** Bloc de parapet en pierre : de x = 0 à 1 (longueur donnée par la base), 0,8 m de haut. */
function parapet(): Template {
  return template([part(box(1, 0.75, 0.42, 0.5, 0.375, 0), '#ffffff', 1), part(box(1, 0.08, 0.5, 0.5, 0.79, 0), '#e9e3d6', 0)]);
}

/** Tête d'aqueduc d'un ruisseau busé : mur en béton (3 m selon x, face +z), buse sombre. */
function headwall(): Template {
  return template([part(box(3.0, 1.1, 0.35, 0, 0.55, 0), '#b9b6ae', 0), part(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 8).rotateX(Math.PI / 2).translate(0, 0.45, 0.2), '#1c1f22', 0)]);
}

/** Abreuvoir galvanisé (2,4 m selon x) ; l'eau est posée à part (matériau brillant). */
function trough(): Template {
  return template([
    part(box(2.4, 0.5, 0.06, 0, 0.35, 0.3), '#9aa3a8', 0),
    part(box(2.4, 0.5, 0.06, 0, 0.35, -0.3), '#9aa3a8', 0),
    part(box(0.06, 0.5, 0.66, 1.2, 0.35, 0), '#9aa3a8', 0),
    part(box(0.06, 0.5, 0.66, -1.2, 0.35, 0), '#9aa3a8', 0),
    part(box(2.4, 0.06, 0.66, 0, 0.13, 0), '#7f878c', 0),
    part(box(0.1, 0.12, 0.6, 0.9, 0.05, 0), '#6c5a46', 0),
    part(box(0.1, 0.12, 0.6, -0.9, 0.05, 0), '#6c5a46', 0),
  ]);
}

/** Fontaine de village : vasque octogonale en pierre, colonne et coupe (l'eau est posée à part). */
function fountain(): Template {
  const stone = '#cfc6b4';
  return template([
    part(new THREE.CylinderGeometry(1.45, 1.5, 0.6, 8, 1, true).translate(0, 0.3, 0), stone, 0),
    part(new THREE.CylinderGeometry(1.25, 1.25, 0.6, 8, 1, true).scale(-1, 1, 1).translate(0, 0.3, 0), '#b4ab98', 0),
    part(new THREE.RingGeometry(1.25, 1.5, 8, 1).rotateX(-Math.PI / 2).translate(0, 0.6, 0), '#ddd5c4', 0),
    part(prism(0.22, 0.17, 0, 1.45, 8), stone, 0),
    part(prism(0.2, 0.42, 1.35, 1.55, 8), stone, 0),
    part(prism(0.08, 0.04, 1.55, 1.85, 6), stone, 0),
    part(box(0.05, 0.05, 0.35, 0, 1.05, 0.3), '#7d7a72', 0),
  ]);
}

/** Borne fontaine en fonte verte (1,1 m) avec son bec. */
function borne(): Template {
  const g = '#2f5a3a';
  return template([part(prism(0.14, 0.11, 0, 1.0, 8), g, 0), part(prism(0.16, 0.05, 1.0, 1.16, 8), g, 0), part(box(0.05, 0.05, 0.2, 0, 0.72, 0.18), '#9a8d5a', 0), part(box(0.34, 0.03, 0.34, 0, 0.015, 0.3), '#3a3d40', 0)]);
}

/** Touffe de roseaux : cinq tiges effilées inclinées, quelques massettes brunes. */
function reeds(): Template {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const a = i * 1.05;
    const h = 1.0 + (i % 3) * 0.28;
    const blade = new THREE.CylinderGeometry(0.004, 0.025, h, 3, 1, true)
      .translate(0, h / 2, 0)
      .rotateX(Math.sin(a) * 0.2)
      .rotateZ(Math.cos(a) * 0.2)
      .translate(Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12);
    parts.push(part(blade, i % 2 ? '#7f9a3e' : '#94a84a', 0));
    if (i % 3 === 0) parts.push(part(prism(0.03, 0.03, h - 0.28, h - 0.06, 5).rotateX(Math.sin(a) * 0.2).rotateZ(Math.cos(a) * 0.2).translate(Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12), '#5a3a22', 0));
  }
  return template(parts);
}

/** Tous les gabarits, construits une fois (au premier tronçon). */
export function lifeTemplates() {
  return {
    post: template([part(box(0.13, 1.15, 0.13, 0, 0.575, 0), '#ffffff', 1)]),
    /** Lisse : de x = 0 à 1 (base mise à l'échelle). */
    rail: template([part(box(1, 0.09, 0.05, 0.5, 0, 0), '#ffffff', 1)]),
    pole: pole(),
    flower: flower(),
    rock: template([part(new THREE.IcosahedronGeometry(1, 0), '#ffffff', 1)]),
    bush: bush(),
    bushBerries: bush('#c8262c'),
    bushBlossom: bush('#f6f0f4'),
    bushPink: bush('#ef7fb0'),
    cow: cow(),
    sheep: sheep(),
    horse: horse(),
    mailbox: mailbox(),
    poste: posteBox(),
    binGrey: bin('#4c5156', '#5d6368'),
    binYellow: bin('#5d6368', '#f2c21b'),
    binGreen: bin('#2f5b3a', '#3d7148'),
    binBrown: bin('#5a4030', '#6e5038'),
    binBlue: bin('#2d5d9a', '#3a6fb0'),
    goal: goal(),
    bench: bench(),
    stand: stand(),
    parapet: parapet(),
    headwall: headwall(),
    trough: trough(),
    fountain: fountain(),
    borne: borne(),
    reeds: reeds(),
  };
}

export type LifeTemplates = ReturnType<typeof lifeTemplates>;
