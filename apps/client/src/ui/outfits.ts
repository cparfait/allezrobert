import type { AvatarLook } from '@allezrobert/shared';

/** Tenues préréglées du garage : couleurs de maillot, casque, vélo, chaussures et chaussettes. */
export const OUTFITS: Array<{ id: string; name: { fr: string; en: string }; hint: { fr: string; en: string }; look: Partial<AvatarLook> & Pick<AvatarLook, 'jersey' | 'jerseyAccent'> }> = [
  {
    id: 'classique',
    name: { fr: 'Classique', en: 'Classic' },
    hint: { fr: 'Bleu et jaune, chaussures blanches', en: 'Blue and yellow, white shoes' },
    look: { jersey: '#1f6feb', jerseyAccent: '#ffd23f', helmet: '#f4f4f4', bike: '#c0392b', shoes: '#f2f2f2', socks: '#f2f2f2' },
  },
  {
    id: 'nuit',
    name: { fr: 'La nuit', en: 'Night' },
    hint: { fr: 'Tout en noir, liseré gris', en: 'All black, grey trim' },
    look: { jersey: '#141518', jerseyAccent: '#6b7280', helmet: '#111111', bike: '#1d1d1f', shoes: '#111111', socks: '#111111' },
  },
  {
    id: 'fluo',
    name: { fr: 'Fluo', en: 'Hi-vis' },
    hint: { fr: 'Jaune fluo, bien visible', en: 'Neon yellow, easy to spot' },
    look: { jersey: '#d7ff2f', jerseyAccent: '#111111', helmet: '#d7ff2f', bike: '#111111', shoes: '#d7ff2f', socks: '#d7ff2f' },
  },
  {
    id: 'grimpeur',
    name: { fr: 'Grimpeur', en: 'Climber' },
    hint: { fr: 'Blanc et rouge, façon maillot à pois', en: 'White and red, polka-dot style' },
    look: { jersey: '#ffffff', jerseyAccent: '#d62828', helmet: '#ffffff', bike: '#eeeeee', shoes: '#ffffff', socks: '#d62828' },
  },
  {
    id: 'tricolore',
    name: { fr: 'Tricolore', en: 'Tricolour' },
    hint: { fr: 'Bleu, blanc, rouge', en: 'Blue, white, red' },
    look: { jersey: '#0b3d91', jerseyAccent: '#ef4135', helmet: '#ffffff', bike: '#0b3d91', shoes: '#ffffff', socks: '#ef4135' },
  },
  {
    id: 'retro',
    name: { fr: 'Rétro', en: 'Retro' },
    hint: { fr: 'Laine rouge, acier bleu, chaussures noires', en: 'Red wool, blue steel, black shoes' },
    look: { jersey: '#b22222', jerseyAccent: '#ffffff', helmet: '#222222', bike: '#2c6e91', shoes: '#111111', socks: '#ffffff' },
  },
];
