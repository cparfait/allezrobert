import { SHOE_MARKS, type AvatarLook } from '@allezrobert/shared';

/**
 * Couleurs dérivées des chaussures (sans three.js : utilisées aussi par le menu) : molettes
 * blanches sur une chaussure claire, noires sur une chaussure foncée ou colorée (comme les
 * S-Phyre blanches et rouges), accent du marquage gris ou blanc s'il n'est pas choisi.
 */

const DEFAULT_SHOE = '#f2f2f2';

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
