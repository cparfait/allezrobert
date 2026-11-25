import * as THREE from 'three/webgpu';

/** Enseignes parodiques du mode Poly, avec leurs propres couleurs et motifs. */
const SPONSORS = [
  ['PÉDALIDAS', 'LE STYLE AU BRAQUET', '#6041b5', '#fff6d2', '#f0bd40'],
  ['SPÉCIALISELLE', 'ASSISE DE COMPÉTITION', '#0c5d72', '#f3fced', '#fe7e6a'],
  ['ROUE BULL', 'ÇA DONNE DES JANTES', '#813567', '#fff6e9', '#ffba37'],
  ['COCA-CADENCE', 'LE GOÛT DU FAUX PLAT', '#a93849', '#fff4db', '#24b5ab'],
  ['NUTEROULE', 'À TARTINER AVANT LE COL', '#d89b52', '#26140f', '#fff0ab'],
  ['MAC’CADENCE', 'LE MENU GRAND BRAQUET', '#186448', '#fff6dc', '#ff9960'],
  ['LE COQ CYCLO', 'FIER JUSQU’À LA LIGNE', '#29436f', '#fffae5', '#ff705c'],
  ['CHIMÂNON', 'ÇA PASSE CRÈME', '#afd479', '#173d31', '#f9f7de'],
  ['DÉCAT’ DU COL', 'LE SPORT AU SOMMET', '#187e9e', '#fff5da', '#e8c157'],
  ['CANNONDUR', 'DU CADRE ET DU CARACTÈRE', '#693f34', '#fff3e3', '#9cce78'],
  ['STRAVACHE', 'TOUT POUR LE SEGMENT', '#eb8b55', '#271e3d', '#f9e7bb'],
  ['MICH’PNEU', 'ADHÉRENCE AU BONHEUR', '#315490', '#fff5ca', '#a5cf57'],
  ['PERRIROUE', 'DES BULLES DANS LE BIDON', '#337452', '#fff5d2', '#a9dfd1'],
  ['BRAQUET KING', 'BIEN CUIT DANS LES BOSSES', '#ce5141', '#fff5db', '#fcd166'],
  ['JANTES & JERRY', 'GLACÉ AU SOMMET', '#9287c8', '#24243f', '#f5d07a'],
  ['IKÉCÔTE', 'LE VÉLO À MONTER SOI-MÊME', '#f1ce57', '#213958', '#579a98'],
] as const;

export const POLY_SPONSOR_COLS = 4;
export const POLY_SPONSOR_ROWS = 4;
export const POLY_SPONSOR_COUNT = SPONSORS.length;
const WIDTH = 512;
const HEIGHT = 256;

export function polySponsorUv(index: number): [number, number] {
  const cell = index % SPONSORS.length;
  return [(cell % POLY_SPONSOR_COLS) / POLY_SPONSOR_COLS, 1 - (Math.floor(cell / POLY_SPONSOR_COLS) + 1) / POLY_SPONSOR_ROWS];
}

let atlas: THREE.CanvasTexture | undefined;

/** Les bâches et les panneaux rigides partagent la même texture, conservée le temps du mode Poly. */
export function polySponsorAtlas(): THREE.CanvasTexture {
  if (atlas) return atlas;
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * POLY_SPONSOR_COLS;
  canvas.height = HEIGHT * POLY_SPONSOR_ROWS;
  const ctx = canvas.getContext('2d')!;
  SPONSORS.forEach(([name, slogan, bg, ink, accent], i) => {
    ctx.save();
    ctx.translate((i % POLY_SPONSOR_COLS) * WIDTH, Math.floor(i / POLY_SPONSOR_COLS) * HEIGHT);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = accent;
    ctx.fillRect(18, 18, WIDTH - 36, 7);
    ctx.fillRect(18, HEIGHT - 25, WIDTH - 36, 7);
    ctx.fillRect(32, 44, 48, 6);
    ctx.fillRect(WIDTH - 80, HEIGHT - 50, 48, 6);
    ctx.beginPath();
    ctx.moveTo(219, 58);
    ctx.lineTo(243, 35);
    ctx.lineTo(255, 46);
    ctx.lineTo(276, 32);
    ctx.lineTo(296, 58);
    ctx.closePath();
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = ink;
    ctx.font = '900 65px "Arial Black", Arial, sans-serif';
    ctx.fillText(name, WIDTH / 2, 119, WIDTH - 58);
    ctx.font = '700 25px Arial, sans-serif';
    ctx.fillText(slogan, WIDTH / 2, 179, WIDTH - 66);
    ctx.restore();
  });
  atlas = new THREE.CanvasTexture(canvas);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 8;
  return atlas;
}
