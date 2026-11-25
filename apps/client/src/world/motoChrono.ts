/**
 * Afficheur LED ambre du panneau arrière de la moto chrono (`Chrono_Ecran` des GLB moto-chrono-*.glb).
 * Repris du prototype `out/moto-chrono/chrono-display.mjs` et de `chrono.json` (même dessin, mêmes couleurs, même
 * taille de canevas 640 × 300 que la texture cuite dans le GLB). Différence avec le prototype : les écarts de 10 min et
 * plus ne sont pas plafonnés à 9:59, les chiffres des minutes se resserrent pour tenir dans le panneau.
 */

export const CHRONO_W = 640;
export const CHRONO_H = 300;

const BACKGROUND = '#101820';
const AMBER = '#ffb33e';
const INACTIVE = '#362b21';

const SEGMENTS: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abdeg',
  '3': 'abcdg',
  '4': 'bcfg',
  '5': 'acdfg',
  '6': 'acdefg',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
};

const GLYPHS: Record<string, readonly string[]> = {
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  '•': ['00000', '00000', '00100', '01110', '00100', '00000', '00000'],
};

/** Segments d'un chiffre (x, y, largeur, hauteur) dans une case de 92 × 157. */
const BARS: Record<string, readonly [number, number, number, number]> = {
  a: [16, 0, 60, 13],
  b: [79, 14, 13, 58],
  c: [79, 85, 13, 58],
  d: [16, 144, 60, 13],
  e: [0, 85, 13, 58],
  f: [0, 14, 13, 58],
  g: [16, 72, 60, 13],
};

/** Plus long écart affiché : 999:59. */
const MAX_S = 999 * 60 + 59;

/** Texte de l'écart : « +0:42 » (derrière le groupe de devant), « −0:25 » (avance sur celui de derrière), « +12:05 ». */
export function chronoText(seconds: number): string {
  const abs = Math.min(Math.abs(Math.trunc(seconds)), MAX_S);
  return `${seconds < 0 ? '−' : '+'}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
}

type Ctx = Pick<CanvasRenderingContext2D, 'fillStyle' | 'fillRect'>;

/**
 * Dessine l'écart (secondes signées : positif = retard sur le groupe de devant, négatif = avance sur celui de derrière)
 * sur un canevas de CHRONO_W × CHRONO_H. Renvoie le texte affiché.
 */
export function drawChrono(ctx: Ctx, seconds: number): string {
  const text = chronoText(seconds);
  const negative = text.startsWith('−');
  const [minute = '0', sec = '00'] = text.slice(1).split(':');
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };
  rect(0, 0, CHRONO_W, CHRONO_H, BACKGROUND);
  const label = negative ? 'ECART • AR' : 'ECART • TETE';
  const letters = [...label];
  const left = (CHRONO_W - (letters.length * 36 - 6)) / 2;
  letters.forEach((letter, i) => {
    GLYPHS[letter]?.forEach((row, y) => {
      [...row].forEach((dot, x) => {
        if (dot === '1') rect(left + i * 36 + x * 6, 26 + y * 6, 5, 5, AMBER);
      });
    });
  });
  rect(38, 88, 564, 2, INACTIVE);

  // Ligne des chiffres (unités du prototype) : signe 54, 33, minutes (92 + 30 entre deux), 29, deux-points 15, 28,
  // secondes 92 + 30 + 92. Une minute : exactement la mise en page du prototype (x de 75 à 540).
  const n = minute.length;
  const total = 343 + 122 * n;
  const k = Math.min(1, 600 / total);
  const x0 = n === 1 ? 75 : (CHRONO_W - total * k) / 2;
  const cy = 112 + 157 / 2;
  const X = (u: number) => x0 + u * k;
  const Y = (v: number) => cy + (v - 157 / 2) * k;
  const r = (u: number, v: number, w: number, h: number, color: string) => rect(X(u), Y(v), w * k, h * k, color);
  // Signe (repères relatifs au haut de la case des chiffres, y = 112).
  r(0, 71, 54, 14, AMBER);
  if (!negative) r(20, 51, 14, 54, AMBER);
  const digit = (u: number, d: string) => {
    const on = SEGMENTS[d] ?? '';
    for (const [bar, [dx, dy, w, h]] of Object.entries(BARS)) r(u + dx, dy, w, h, on.includes(bar) ? AMBER : INACTIVE);
  };
  let u = 87;
  for (const d of minute) {
    digit(u, d);
    u += 122;
  }
  u -= 30;
  r(u + 29, 39, 15, 15, AMBER);
  r(u + 29, 101, 15, 15, AMBER);
  u += 72;
  digit(u, sec[0] ?? '0');
  digit(u + 122, sec[1] ?? '0');
  return text;
}
