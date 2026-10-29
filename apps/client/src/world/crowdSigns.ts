/**
 * Textes des pancartes tenues par le public au sommet des segments (pur, sans DOM : testé
 * dans apps/client/test). Encouragements en français, prénom du coureur, clins d'œil à
 * « Allez Robert ! ». La texture (canevas) est fabriquée dans crowd.ts.
 */
import { LOW_POLY } from '../engine/style.ts';

export interface SignDesign {
  /** Lignes du texte (1 à 3), déjà en forme. */
  lines: string[];
  /** Fond (carton, blanc, jaune…) et encre. */
  bg: string;
  ink: string;
  /** Petit cœur ou flèche dessiné en plus. */
  deco: 'none' | 'heart' | 'arrow' | 'stars';
}

const PALETTE_REAL: Array<[string, string]> = [
  ['#f4efe2', '#c8102e'],
  ['#ffd23f', '#111111'],
  ['#ffffff', '#1f3c88'],
  ['#d9b88f', '#2b1d12'],
  ['#ffffff', '#111111'],
  ['#e63946', '#ffffff'],
  ['#2a9d8f', '#ffffff'],
];

/** Style jeu vidéo : aplats francs (plus de carton brun), encres contrastées. */
const PALETTE_LOWPOLY: Array<[string, string]> = [
  ['#ffffff', '#e63946'],
  ['#ffd23f', '#1d3557'],
  ['#ffffff', '#1f6feb'],
  ['#8ac926', '#ffffff'],
  ['#ff7f11', '#ffffff'],
  ['#e63946', '#ffffff'],
  ['#1f6feb', '#ffd23f'],
];

const PALETTE = LOW_POLY ? PALETTE_LOWPOLY : PALETTE_REAL;

/** Prénom affichable : premier mot, capitales initiales, 14 caractères au plus. */
export function signName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? '';
  const clean = first.replace(/[^\p{L}\p{N}'-]/gu, '').slice(0, 14);
  return clean ? clean[0]!.toUpperCase() + clean.slice(1) : 'Robert';
}

/** Messages possibles ; `{n}` = prénom du coureur. */
export function signMessages(name: string, kind: 'kom' | 'sprint'): string[][] {
  const n = signName(name);
  const isRobert = n.toLowerCase() === 'robert';
  const common = [
    ['ALLEZ', 'ROBERT !'],
    ['ALLEZ', `${n.toUpperCase()} !`],
    [`VAS-Y`, `${n.toUpperCase()} !`],
    ['COURAGE !'],
    [`${n},`, 'ON CROIT', 'EN TOI !'],
    ['ROBERT', 'PRÉSIDENT'],
    ['MAMIE', 'EST FIÈRE', 'DE TOI'],
    ['PAS DE PITIÉ', 'POUR LES', 'MOLLETS'],
    ['ON T’AIME', n.toUpperCase()],
    ['ALLEZ', 'ALLEZ', 'ALLEZ !'],
    ['T’ES PAS', 'FATIGUÉ,', 'T’ES CHAUD !'],
    [isRobert ? 'C’EST TOI' : `${n} >`, isRobert ? 'ROBERT ?!' : 'ROBERT'],
  ];
  const specific =
    kind === 'kom'
      ? [['ÇA MONTE,', 'ÇA MONTE !'], ['DANSE SUR', 'LES PÉDALES'], ['LE SOMMET', 'EST LÀ !'], ['ROI DE', 'LA MONTAGNE'], ['PLUS QUE', '200 M !']]
      : [['SPRINTE', `${n.toUpperCase()} !`], ['FLAMME', 'ROUGE !'], ['À FOND', 'LES WATTS !'], ['LÂCHE', 'LES CHEVAUX']];
  return [...common, ...specific];
}

/**
 * `count` pancartes variées : le prénom et « Allez Robert ! » sont garantis, puis tirage
 * sans répétition tant que possible. `rand` ∈ [0, 1) (générateur déterministe de l'appelant).
 */
export function signDesigns(name: string, kind: 'kom' | 'sprint', count: number, rand: () => number): SignDesign[] {
  const msgs = signMessages(name, kind);
  const pool = msgs.slice(3);
  const out: SignDesign[] = [];
  const decos: SignDesign['deco'][] = ['none', 'heart', 'arrow', 'stars'];
  for (let i = 0; i < count; i++) {
    let lines: string[];
    if (i < 3) lines = msgs[i]!;
    else {
      if (!pool.length) pool.push(...msgs);
      lines = pool.splice(Math.floor(rand() * pool.length), 1)[0]!;
    }
    const [bg, ink] = PALETTE[Math.floor(rand() * PALETTE.length)]!;
    out.push({ lines, bg, ink, deco: lines.join(' ').includes('AIME') || lines.join(' ').includes('MAMIE') ? 'heart' : decos[Math.floor(rand() * decos.length)]! });
  }
  return out;
}
