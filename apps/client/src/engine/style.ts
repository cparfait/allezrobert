import { requestV3Access, v3AccessStatus } from './v3Access.ts';

declare const __AR_V3_PROTECTED__: boolean;

/**
 * Style graphique : « lowpoly » (jeu vidéo : facettes, aplats de couleur, sans textures photo, monde plus
 * peuplé) ou « real » (semi-réalisme), choisi au premier lancement (tutoriel) puis dans les réglages. Lu une fois au chargement : les matériaux
 * sont construits dans les constructeurs, changer de style recharge la page.
 * ?style=real|lowpoly|v3 a priorité sur localStorage ar.style ; défaut : réaliste.
 */
export type GraphicStyle = 'lowpoly' | 'real' | 'v3';
export const V3_AVAILABLE = import.meta.env?.DEV === true
  || (typeof __AR_V3_PROTECTED__ !== 'undefined' && __AR_V3_PROTECTED__);

export const STYLE_KEY = 'ar.style';
const DEFAULT_STYLE: GraphicStyle = 'real';
const pendingV3 = 'ar.style.v3.pending';
const protectedV3 = typeof __AR_V3_PROTECTED__ !== 'undefined' && __AR_V3_PROTECTED__;

function readStyle(): GraphicStyle {
  try {
    const raw = new URLSearchParams(location.search).get('style') ?? localStorage.getItem(STYLE_KEY);
    return raw === 'real' || raw === 'lowpoly' || (raw === 'v3' && V3_AVAILABLE) ? raw : DEFAULT_STYLE;
  } catch {
    return DEFAULT_STYLE;
  }
}

async function bootStyle(): Promise<GraphicStyle> {
  const style = readStyle();
  if (style !== 'v3' || !protectedV3) return style;
  const activating = sessionStorage.getItem(pendingV3) === '1';
  sessionStorage.removeItem(pendingV3);
  const status = activating ? 403 : await v3AccessStatus();
  // Pas de réseau et rien de copié sur le disque : sortie en Réel cette fois, le choix V3 reste enregistré.
  if (status === 503) return DEFAULT_STYLE;
  const allowed = status === 204 || await requestV3Access();
  if (activating || !allowed) {
    const url = new URL(location.href);
    url.searchParams.delete('style');
    history.replaceState(history.state, '', url);
  }
  if (allowed) {
    if (activating) localStorage.setItem(STYLE_KEY, 'v3');
    return 'v3';
  }
  const saved = localStorage.getItem(STYLE_KEY);
  if (saved === 'v3') localStorage.removeItem(STYLE_KEY);
  return saved === 'lowpoly' ? 'lowpoly' : DEFAULT_STYLE;
}

export const GRAPHIC_STYLE: GraphicStyle = typeof location === 'undefined' ? DEFAULT_STYLE : await bootStyle();
/** Style jeu vidéo (low poly) actif. */
export const LOW_POLY = GRAPHIC_STYLE === 'lowpoly';
export const V3_STYLE = GRAPHIC_STYLE === 'v3';

/** Change le style et recharge (les matériaux du monde sont construits au chargement). */
export function setGraphicStyle(style: GraphicStyle): void {
  const url = new URL(location.href);
  url.searchParams.delete('style');
  if (style === 'v3' && protectedV3) {
    sessionStorage.setItem(pendingV3, '1');
    url.searchParams.set('style', 'v3');
  } else {
    localStorage.setItem(STYLE_KEY, style);
  }
  location.replace(url.toString());
}
