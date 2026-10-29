import { SHOE_MARKS, type AvatarLook } from '@allezrobert/shared';

/**
 * Couleurs dérivées des chaussures (sans three.js : utilisées aussi par le menu) : molettes
 * blanches sur une chaussure claire, noires sur une chaussure foncée ou colorée (comme les
 * S-Phyre blanches et rouges), accent du marquage gris ou blanc s'il n'est pas choisi.
 */

const DEFAULT_SHOE = '#f2f2f2';

/** Chaussures des autres coureurs (peloton, film d'accueil, cyclistes du monde) : surtout blanches et noires, quelques couleurs. */
const CROWD_SHOES = ['#f2f2f2', '#111418', '#f2f2f2', '#c0392b', '#111418', '#1e5bd8', '#f2f2f2', '#d7f205', '#7a7f87', '#e8e2d0', '#111418', '#ff7a1a'];
const CROWD_SOCKS = ['#f2f2f2', '#f2f2f2', '#111418', '#f2f2f2', '#c0392b'];

/** Chaussures et chaussettes variées du coureur i (reproductible, décalé des maillots). */
export function crowdShoes(i: number): Pick<AvatarLook, 'shoes' | 'socks' | 'shoeMark'> {
  const shoes = CROWD_SHOES[(i * 5 + 1) % CROWD_SHOES.length] as string;
  const mark = SHOE_MARKS[(i * 3) % (SHOE_MARKS.length + 2)]?.id;
  return { shoes, socks: CROWD_SOCKS[(i * 2 + 1) % CROWD_SOCKS.length] as string, ...(mark ? { shoeMark: mark } : {}) };
}

/** Luminance relative (sRGB linéarisé) d'une couleur « #rrggbb » ; 1 si illisible. */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 1;
  const n = parseInt(m[1] as string, 16);
  const lin = (c: number) => {
    const x = c / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

export function shoeColorOf(look: AvatarLook): string {
  return look.shoes ?? DEFAULT_SHOE;
}

/** Chaussure claire (molettes blanches, marquage gris par défaut) ? */
function lightShoe(look: AvatarLook): boolean {
  return luminance(shoeColorOf(look)) > 0.45;
}

export function shoeDialOf(look: AvatarLook): string {
  return lightShoe(look) ? '#f4f4f4' : '#16171a';
}

export function shoeAccentOf(look: AvatarLook): string {
  return look.shoeAccent ?? (lightShoe(look) ? '#8a9099' : '#f2f2f2');
}

/** Texte du marquage latéral, ou null (chaussure unie). */
export function shoeMarkText(look: AvatarLook): string | null {
  return SHOE_MARKS.find((m) => m.id === look.shoeMark)?.text ?? null;
}

/** Couleur des bidons : celle choisie (noir ou blanc), sinon blanc sur un cadre foncé et noir sur un cadre clair. */
export function bottleColorOf(look: Pick<AvatarLook, 'bottleColor'>, frame: string | undefined): string {
  if (look.bottleColor === 'black') return '#16171a';
  if (look.bottleColor === 'white') return '#f4f4f2';
  return frame && luminance(frame) > 0.4 ? '#16171a' : '#f4f4f2';
}
