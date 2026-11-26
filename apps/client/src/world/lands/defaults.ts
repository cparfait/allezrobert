import type { PolyTheme } from './types.ts';

/** Thème par défaut : celui de l'île (couleurs de LOWPOLY_GROUND, sable et roche d'origine). */
export const DEFAULT_THEME: PolyTheme = {
  ground: {
    spring: { forest: '#3f7a2e', field: '#a7c957', field2: '#e9d65a', meadow: '#7cbf4a', urban: '#cfc8b6', dirt: '#a88a5c' },
    summer: { forest: '#3d6f2a', field: '#e2c46a', field2: '#cfa955', meadow: '#86c04e', urban: '#d0c8b2', dirt: '#b08e5e' },
    autumn: { forest: '#5a8a30', field: '#9cc85a', field2: '#e3bc5c', meadow: '#86c24e', urban: '#d0c7b1', dirt: '#b48a58' },
    winter: { forest: '#4f7a3c', field: '#a0c46a', field2: '#d9c47c', meadow: '#92c063', urban: '#cfcabe', dirt: '#a68a64' },
  },
  sand: ['#c5af8b', '#e7ce9e'],
  rock: '#6d6860',
};
