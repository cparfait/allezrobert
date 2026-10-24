/**
 * Format et résolution d'affichage. Comme Zwift et MyWhoosh, l'image remplit la fenêtre même sur un
 * écran très large (32:9) sans chercher à s'y adapter ; ce qui borne le coût GPU, proportionnel à la
 * surface rendue, c'est le plafond de pixels : l'image est rendue plus petite puis agrandie.
 * En option, un format maximal (16:9, 21:9, 32:9) centre l'image avec des bandes sombres de chaque côté.
 * Réglages gardés dans localStorage (pas dans `Settings`), surchargeables par l'adresse : ?aspect=…&maxres=…
 */
export type AspectCap = '16:9' | '21:9' | '32:9' | 'full';
export type ResolutionCap = 'auto' | '1080p' | '1440p' | '4k';

export const ASPECT_RATIO: Record<AspectCap, number> = { '16:9': 16 / 9, '21:9': 64 / 27, '32:9': 32 / 9, full: Infinity };
export const RESOLUTION_PIXELS: Record<ResolutionCap, number> = { auto: Infinity, '1080p': 1920 * 1080, '1440p': 2560 * 1440, '4k': 3840 * 2160 };

export const DEFAULT_ASPECT_CAP: AspectCap = 'full';
const ASPECT_KEY = 'ar.aspect';
const RES_KEY = 'ar.maxRes';
/** Plancher du rapport de rendu : en dessous, l'image est trop floue pour servir. */
const MIN_PIXEL_RATIO = 0.35;

function readChoice<T extends string>(key: string, param: string, table: Record<T, number>, fallback: T): T {
  try {
    const fromUrl = new URLSearchParams(location.search).get(param);
    if (fromUrl && fromUrl in table) return fromUrl as T;
    const stored = localStorage.getItem(key);
    if (stored && stored in table) return stored as T;
  } catch {
    // Stockage indisponible : valeur par défaut.
  }
  return fallback;
}

export function getAspectCap(): AspectCap {
  return readChoice('ar.aspect', 'aspect', ASPECT_RATIO, DEFAULT_ASPECT_CAP);
}

export function getResolutionCap(): ResolutionCap {
  return readChoice('ar.maxRes', 'maxres', RESOLUTION_PIXELS, 'auto');
}

export function setAspectCap(v: AspectCap): void {
  localStorage.setItem(ASPECT_KEY, v);
}

export function setResolutionCap(v: ResolutionCap): void {
  localStorage.setItem(RES_KEY, v);
}

/** Taille de la zone d'affichage (px CSS) : toute la fenêtre, sauf si elle est plus large que le format maximal. */
export function viewportSize(winW: number, winH: number, cap: AspectCap): { w: number; h: number } {
  return { w: Math.min(winW, Math.round(winH * ASPECT_RATIO[cap])), h: winH };
}

export interface PixelRatioInput {
  /** Taille de la zone d'affichage en pixels CSS. */
  cssW: number;
  cssH: number;
  devicePixelRatio: number;
  /** Rapport voulu par le préréglage graphique. */
  presetRatio: number;
  /** Plafond de pixels du préréglage et celui choisi par le joueur. */
  presetMaxPixels: number;
  userMaxPixels: number;
  /** Échelle de la résolution dynamique (0 < scale ≤ 1). */
  scale?: number;
}

/** Rapport pixels rendus / pixels CSS : le rapport du préréglage, ramené sous le plafond de pixels, puis réduit par la résolution dynamique. */
export function renderPixelRatio(i: PixelRatioInput): number {
  const base = Math.min(i.devicePixelRatio, 2) * i.presetRatio;
  const budget = Math.min(i.presetMaxPixels, i.userMaxPixels);
  const fit = Math.sqrt(budget / Math.max(i.cssW * i.cssH, 1));
  return Math.max(MIN_PIXEL_RATIO, Math.min(base, fit) * Math.min(i.scale ?? 1, 1));
}

export const DEFAULT_UI_ASPECT_CAP: AspectCap = '21:9';

/** Format maximal de la zone sûre de l'interface (HUD et menus) : la 3D remplit l'écran, les informations restent groupées au centre. */
export function getUiAspectCap(): AspectCap {
  return readChoice('ar.uiAspect', 'uiaspect', ASPECT_RATIO, DEFAULT_UI_ASPECT_CAP);
}

export function setUiAspectCap(v: AspectCap): void {
  localStorage.setItem('ar.uiAspect', v);
}

/** Contraint le conteneur de l'application au format maximal et le centre ; le reste de la fenêtre reste sombre. */
export function applyViewport(app: HTMLElement): { w: number; h: number } {
  const cap = getAspectCap();
  const { w, h } = viewportSize(window.innerWidth, window.innerHeight, cap);
  if (w < window.innerWidth) {
    app.style.width = `${w}px`;
    app.style.margin = '0 auto';
    app.style.right = '0';
    app.style.left = '0';
  } else {
    app.style.removeProperty('width');
    app.style.removeProperty('margin');
    app.style.removeProperty('right');
    app.style.removeProperty('left');
  }
  applyUiZone(app, w, h);
  return { w, h };
}

/** Borne et centre le HUD et les menus (enfants directs de l'application) dans leur zone sûre. */
function applyUiZone(app: HTMLElement, appW: number, appH: number): void {
  const { w } = viewportSize(appW, appH, getUiAspectCap());
  app.querySelectorAll<HTMLElement>(':scope > .hud, :scope > .ui').forEach((el) => {
    if (w < appW) {
      el.style.left = '0';
      el.style.right = '0';
      el.style.margin = '0 auto';
      el.style.width = `${w}px`;
    } else {
      el.style.removeProperty('width');
      el.style.removeProperty('margin');
      el.style.removeProperty('left');
      el.style.removeProperty('right');
    }
  });
}

/** Limite d'images par seconde du rendu (0 = aucune) : sur un écran 240 Hz, inutile de dessiner 240 images. ?fps=60 ou localStorage ar.fpsCap. */
export function getFpsCap(): number {
  try {
    const raw = new URLSearchParams(location.search).get('fps') ?? localStorage.getItem('ar.fpsCap');
    const n = Number(raw);
    return Number.isFinite(n) && n >= 20 ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Résolution dynamique : désactivée par défaut (?dynres=1 ou localStorage ar.dynres=1 l'active). Mesuré :
 * le jeu est limité par le processeur (GPU à 2-7 ms), baisser la résolution n'apporte rien, et chaque
 * changement d'échelle réalloue les images intermédiaires du rendu, ce qui fait lui-même une saccade.
 */
export function dynamicResolutionEnabled(): boolean {
  try {
    const raw = new URLSearchParams(location.search).get('dynres') ?? localStorage.getItem('ar.dynres');
    return raw === '1';
  } catch {
    return false;
  }
}
