import type { Season } from './environment.ts';

/**
 * Montagne : étagement de la végétation, roche et neige selon l'altitude et la saison.
 * Partagé par le terrain (sol), le relief lointain (horizon), la végétation et l'herbe.
 */
export interface AlpineProfile {
  /** Limite supérieure de la forêt (m) : les arbres s'éclaircissent de 150 m en dessous à 100 m au-dessus. */
  treelineM: number;
  /** Teinte de la roche nue (sRGB). */
  rock: string;
}

/** Profils propres à certains mondes ; par défaut, Alpes du Nord (Oisans). */
const PROFILES: Record<string, Partial<AlpineProfile>> = {
  // Ventoux : forêt arrêtée vers 1 600 m par le vent, sommet de calcaire blanc (pierrier).
  'mont-ventoux': { treelineM: 1650, rock: '#c4bdb0' },
};

export function alpineProfile(worldId: string): AlpineProfile {
  return { treelineM: 2150, rock: '#6d6860', ...PROFILES[worldId] };
}

/** Limite moyenne de l'enneigement (m) par saison ; abaissée de 200 m sur les versants nord. */
export const SNOW_LINE_M: Record<Season, number> = { spring: 1900, summer: 3000, autumn: 2500, winter: 1100 };

/** Altitude à partir de laquelle le sol prend ses couleurs d'alpage (m, milieu de la transition). */
export const ALPINE_GROUND_M = 1500;

/** Couleurs d'alpage (pelouse rase) par saison. */
export const ALPINE_MEADOW: Record<Season, string> = { spring: '#7f9850', summer: '#929d58', autumn: '#9a8a5c', winter: '#8b8670' };

function smooth(x: number, a: number, b: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Densité relative des arbres (0–1) à l'altitude `y` : pleine sous la limite, nulle au-dessus. */
export function treeDensityAt(y: number, treelineM: number): number {
  return 1 - smooth(y, treelineM - 150, treelineM + 100);
}

/**
 * Penchant pour les conifères dû à l'altitude : nul en plaine, étage montagnard mixte vers
 * 900–1 200 m (hêtre-sapin), épicéas et mélèzes au-dessus de 1 200 m.
 */
export function coniferBiasAt(y: number): number {
  return smooth(y, 850, 1300) * 1.2;
}

/** Part des mélèzes parmi les conifères : ils dominent à l'approche de la limite des arbres. */
export function larchShareAt(y: number, treelineM: number): number {
  return smooth(y, treelineM - 800, treelineM - 150) * 0.65;
}

/** Échelle des arbres près de la limite : plus bas et trapus en altitude. */
export function treeScaleAt(y: number, treelineM: number): number {
  return 1 - 0.3 * smooth(y, treelineM - 400, treelineM + 50);
}

/** Enneigement probable (0–1) à l'altitude `y` en saison `season` (sans le bruit ni l'exposition). */
export function snowCoverAt(y: number, season: Season): number {
  const line = SNOW_LINE_M[season];
  return smooth(y, line - 150, line + 250);
}
