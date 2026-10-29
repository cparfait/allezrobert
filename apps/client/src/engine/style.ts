/**
 * Style graphique : « lowpoly » (jeu vidéo : facettes, aplats de couleur, sans textures photo, monde plus
 * peuplé) ou « real » (semi-réalisme), choisi au premier lancement (tutoriel) puis dans les réglages. Lu une fois au chargement : les matériaux
 * sont construits dans les constructeurs, changer de style recharge la page.
 * ?style=real|lowpoly a priorité sur localStorage ar.style ; défaut (jamais choisi) : réaliste.
 */
export type GraphicStyle = 'lowpoly' | 'real';

export const STYLE_KEY = 'ar.style';
const DEFAULT_STYLE: GraphicStyle = 'real';

function readStyle(): GraphicStyle {
  try {
    const raw = new URLSearchParams(location.search).get('style') ?? localStorage.getItem(STYLE_KEY);
    return raw === 'real' || raw === 'lowpoly' ? raw : DEFAULT_STYLE;
  } catch {
    return DEFAULT_STYLE;
  }
}

export const GRAPHIC_STYLE: GraphicStyle = typeof location === 'undefined' ? 'real' : readStyle();
/** Style jeu vidéo (low poly) actif. */
export const LOW_POLY = GRAPHIC_STYLE === 'lowpoly';

/** Change le style et recharge (les matériaux du monde sont construits au chargement). */
export function setGraphicStyle(style: GraphicStyle): void {
  localStorage.setItem(STYLE_KEY, style);
  const url = new URL(location.href);
  url.searchParams.delete('style');
  location.replace(url.toString());
}
