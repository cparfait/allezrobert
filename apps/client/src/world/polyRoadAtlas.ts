import * as THREE from 'three/webgpu';
import { SIGN_KINDS, type PlanPlace, type SignKind } from './polyRoadPlan.ts';

/**
 * Atlas unique des panneaux du mode Poly : pictogrammes, noms des lieux, chiffres et flèches. Tout est dessiné
 * ici, sans image ni police embarquée ; un panneau de direction s'assemble à partir de ces cases.
 */
export const ATLAS = 1024;
const CELL = 128;
const COLS = 8;
/** Bande des noms : deux colonnes, sous les pictogrammes. */
const NAME_Y = CELL * 2;
export const NAME_W = 512;
export const NAME_H = 44;
/** Bande des chiffres et des flèches, en bas. */
const GLYPH = 64;
const GLYPH_Y = ATLAS - GLYPH;
const GLYPHS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '%', 'left', 'straight', 'right'] as const;
export type Glyph = (typeof GLYPHS)[number];

/** Rectangle de texture : u0, v0 (bas), u1, v1 (haut). */
export type UvRect = readonly [number, number, number, number];
const rect = (x: number, y: number, w: number, h: number, pad = 1.5): UvRect => [(x + pad) / ATLAS, 1 - (y + h - pad) / ATLAS, (x + w - pad) / ATLAS, 1 - (y + pad) / ATLAS];

export const signRect = (kind: SignKind): UvRect => {
  const i = SIGN_KINDS.indexOf(kind);
  return rect((i % COLS) * CELL, Math.floor(i / COLS) * CELL, CELL, CELL);
};
/** Nom d'un lieu, calé à gauche de sa case ; `width` : part de la case occupée par le texte. */
export const nameRect = (place: number, width = 1): UvRect => rect((place % 2) * NAME_W, NAME_Y + Math.floor(place / 2) * NAME_H, NAME_W * width, NAME_H, 1);
/** Chiffre (colonne centrale de sa case, 40 px sur 64) ou flèche (case entière). */
export const glyphRect = (g: Glyph): UvRect => {
  const inset = g.length === 1 && g !== '%' ? 12 : 0;
  return rect(GLYPHS.indexOf(g) * GLYPH + inset, GLYPH_Y, GLYPH - 2 * inset, GLYPH, 2);
};

const RED = '#c8102e';
const BLUE = '#1c5fae';
const INK = '#16181a';
const PAPER = '#f6f5ef';
const FONT = '"DIN Alternate", "Arial Narrow", Arial, sans-serif';

function triangle(ctx: CanvasRenderingContext2D, down = false): void {
  const path = (m: number) => {
    const top = 14 + m * 1.15;
    const bottom = 112 - m * 0.6;
    ctx.beginPath();
    if (down) {
      ctx.moveTo(6 + m, 128 - bottom);
      ctx.lineTo(122 - m, 128 - bottom);
      ctx.lineTo(64, 128 - top);
    } else {
      ctx.moveTo(64, top);
      ctx.lineTo(122 - m, bottom);
      ctx.lineTo(6 + m, bottom);
    }
    ctx.closePath();
    ctx.fill();
  };
  ctx.fillStyle = RED;
  path(0);
  ctx.fillStyle = '#fdfcf5';
  path(17);
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
}

function bike(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, colour: string): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.strokeStyle = colour;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const x of [-21, 21]) {
    ctx.beginPath();
    ctx.arc(x, 10, 14, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(-21, 10);
  ctx.lineTo(-9, -13);
  ctx.lineTo(12, -13);
  ctx.lineTo(1, 10);
  ctx.closePath();
  ctx.moveTo(-9, -13);
  ctx.lineTo(1, 10);
  ctx.moveTo(21, 10);
  ctx.lineTo(11, -20);
  ctx.lineTo(21, -20);
  ctx.moveTo(-15, -19);
  ctx.lineTo(-4, -19);
  ctx.stroke();
  ctx.restore();
}

/** Trait de route dans un triangle de danger : coude ou double coude. */
function bend(ctx: CanvasRenderingContext2D, pts: ReadonlyArray<readonly [number, number]>, flip: boolean): void {
  ctx.save();
  if (flip) {
    ctx.translate(128, 0);
    ctx.scale(-1, 1);
  }
  ctx.lineWidth = 11;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
  ctx.restore();
}

const ELBOW = [[72, 102], [72, 78], [52, 56]] as const;
const DOUBLE = [[64, 104], [64, 94], [52, 82], [72, 66], [64, 54]] as const;

function slope(c: CanvasRenderingContext2D, up: boolean): void {
  triangle(c);
  c.beginPath();
  c.moveTo(up ? 100 : 28, 78);
  c.lineTo(28, 104);
  c.lineTo(100, 104);
  c.closePath();
  c.fill();
}

function chevrons(c: CanvasRenderingContext2D): void {
  c.fillStyle = '#fdfcf5';
  c.fillRect(2, 2, 124, 124);
  c.fillStyle = '#17324d';
  for (const x of [4, 62]) {
    c.beginPath();
    c.moveTo(x, 8);
    c.lineTo(x + 28, 8);
    c.lineTo(x + 58, 64);
    c.lineTo(x + 28, 120);
    c.lineTo(x, 120);
    c.lineTo(x + 30, 64);
    c.closePath();
    c.fill();
  }
}

const DRAW: Record<SignKind, (ctx: CanvasRenderingContext2D) => void> = {
  stop: (c) => {
    c.beginPath();
    for (let i = 0; i < 8; i++) c.lineTo(64 + Math.cos(Math.PI / 8 + (i * Math.PI) / 4) * 61, 64 + Math.sin(Math.PI / 8 + (i * Math.PI) / 4) * 61);
    c.closePath();
    c.fillStyle = RED;
    c.fill();
    c.lineWidth = 5;
    c.strokeStyle = '#fff';
    c.stroke();
    c.fillStyle = '#fff';
    c.font = `800 42px ${FONT}`;
    c.fillText('STOP', 64, 67, 98);
  },
  yield: (c) => triangle(c, true),
  priority: (c) => {
    triangle(c);
    c.fillRect(57, 50, 14, 54);
    c.fillRect(42, 79, 44, 8);
    c.beginPath();
    c.moveTo(64, 38);
    c.lineTo(79, 57);
    c.lineTo(49, 57);
    c.fill();
  },
  crossing: (c) => {
    triangle(c);
    c.lineWidth = 11;
    c.beginPath();
    c.moveTo(44, 62);
    c.lineTo(84, 100);
    c.moveTo(84, 62);
    c.lineTo(44, 100);
    c.stroke();
  },
  curveLeft: (c) => {
    triangle(c);
    bend(c, ELBOW, false);
  },
  curveRight: (c) => {
    triangle(c);
    bend(c, ELBOW, true);
  },
  sLeft: (c) => {
    triangle(c);
    bend(c, DOUBLE, false);
  },
  sRight: (c) => {
    triangle(c);
    bend(c, DOUBLE, true);
  },
  descent: (c) => slope(c, false),
  climb: (c) => slope(c, true),
  zone30: (c) => {
    c.fillStyle = '#f4f2ea';
    c.fillRect(4, 4, 120, 120);
    c.lineWidth = 4;
    c.strokeStyle = '#3a3f44';
    c.strokeRect(6, 6, 116, 116);
    for (const [r, fill] of [[40, RED], [30, '#ffffff']] as const) {
      c.fillStyle = fill;
      c.beginPath();
      c.arc(64, 50, r, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = INK;
    c.font = `800 38px ${FONT}`;
    c.fillText('30', 64, 53);
    c.font = `800 24px ${FONT}`;
    c.fillText('ZONE', 64, 107);
  },
  pedestrians: (c) => {
    c.fillStyle = BLUE;
    c.fillRect(4, 4, 120, 120);
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(64, 14);
    c.lineTo(116, 112);
    c.lineTo(12, 112);
    c.fill();
    c.fillStyle = INK;
    c.beginPath();
    c.arc(66, 46, 7, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = INK;
    c.lineWidth = 8;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(62, 56);
    c.lineTo(60, 78);
    c.lineTo(48, 98);
    c.moveTo(60, 76);
    c.lineTo(74, 98);
    c.moveTo(46, 72);
    c.lineTo(62, 60);
    c.lineTo(78, 72);
    c.stroke();
    for (const x of [30, 50, 70, 90]) c.fillRect(x, 103, 10, 6);
  },
  cycleway: (c) => {
    for (const [r, fill] of [[58, '#ffffff'], [53, BLUE]] as const) {
      c.fillStyle = fill;
      c.beginPath();
      c.arc(64, 64, r, 0, Math.PI * 2);
      c.fill();
    }
    bike(c, 64, 62, 0.95, '#fff');
  },
  chevronRight: chevrons,
  chevronLeft: (c) => {
    c.translate(128, 0);
    c.scale(-1, 1);
    chevrons(c);
  },
  cyclists: (c) => {
    triangle(c);
    bike(c, 64, 82, 0.62, INK);
  },
};

export interface RoadAtlas {
  texture: THREE.CanvasTexture;
  /** Part de sa case (0 à 1) occupée par chaque nom. */
  nameWidth: number[];
}

let cache: { key: string; atlas: RoadAtlas } | null = null;

export function roadAtlas(places: readonly PlanPlace[]): RoadAtlas {
  const key = places.map((p) => p.name).join('|');
  if (cache?.key === key) return cache.atlas;
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS;
  canvas.height = ATLAS;
  const ctx = canvas.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  SIGN_KINDS.forEach((kind, i) => {
    ctx.save();
    ctx.translate((i % COLS) * CELL, Math.floor(i / COLS) * CELL);
    DRAW[kind](ctx);
    ctx.restore();
  });
  const nameWidth: number[] = [];
  places.forEach((p, i) => {
    const x = (i % 2) * NAME_W;
    const y = NAME_Y + Math.floor(i / 2) * NAME_H;
    // Fond plein : les bords de case ne bavent pas dans les mipmaps.
    ctx.fillStyle = PAPER;
    ctx.fillRect(x, y, NAME_W, NAME_H);
    ctx.fillStyle = INK;
    ctx.textAlign = 'left';
    ctx.font = `700 34px ${FONT}`;
    ctx.fillText(p.name, x + 6, y + NAME_H / 2 + 1, NAME_W - 12);
    nameWidth.push(Math.min(1, (ctx.measureText(p.name).width + 14) / NAME_W));
  });
  ctx.textAlign = 'center';
  GLYPHS.forEach((g, i) => {
    const x = i * GLYPH;
    ctx.fillStyle = PAPER;
    ctx.fillRect(x, GLYPH_Y, GLYPH, GLYPH);
    ctx.fillStyle = INK;
    if (g.length === 1) {
      ctx.font = `700 56px ${FONT}`;
      ctx.fillText(g, x + 32, GLYPH_Y + 34, 56);
      return;
    }
    ctx.save();
    ctx.translate(x + 32, GLYPH_Y + 32);
    ctx.rotate(g === 'left' ? -Math.PI / 2 : g === 'right' ? Math.PI / 2 : 0);
    ctx.fillRect(-5, -8, 10, 34);
    ctx.beginPath();
    ctx.moveTo(0, -27);
    ctx.lineTo(20, -2);
    ctx.lineTo(-20, -2);
    ctx.fill();
    ctx.restore();
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const atlas = { texture, nameWidth };
  cache = { key, atlas };
  return atlas;
}
