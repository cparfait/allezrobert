/**
 * Chargement paresseux des ressources par le bundler (Vite) : HTML des compositions et
 * ressources partagées en `?raw`, polices en `?url`. Chaque import dynamique devient un chunk
 * séparé, téléchargé au premier `preload()` / `play()` — rien n'alourdit le démarrage du jeu.
 */
import type { SharedAssets } from './assemble.ts';
import type { CompositionFile } from './catalog.ts';
import { STRINGS } from './strings.ts';

const compositionLoaders: Record<CompositionFile, () => Promise<{ default: string }>> = {
  intro: () => import('../compositions/intro/index.html?raw'),
  segment: () => import('../compositions/segment/index.html?raw'),
  podium: () => import('../compositions/podium/index.html?raw'),
  tv: () => import('../compositions/tv/index.html?raw'),
  summary: () => import('../compositions/summary/index.html?raw'),
};

const htmlCache = new Map<CompositionFile, Promise<string>>();

export function loadCompositionHtml(file: CompositionFile): Promise<string> {
  let p = htmlCache.get(file);
  if (!p) {
    p = compositionLoaders[file]().then((m) => m.default);
    htmlCache.set(file, p);
    p.catch(() => htmlCache.delete(file));
  }
  return p;
}

let sharedPromise: Promise<SharedAssets> | null = null;

/** Ressources communes (CSS, GSAP, utilitaires, runtime HyperFrames, polices). */
export function loadSharedAssets(): Promise<SharedAssets> {
  if (!sharedPromise) {
    sharedPromise = Promise.all([
      import('../tokens.css?raw'),
      import('../lib/ar-seq.css?raw'),
      import('../lib/ar-seq.js?raw'),
      import('gsap/dist/gsap.min.js?raw'),
      import('@hyperframes/core/runtime-script'),
      import('../assets/fonts/inter-latin-wght-normal.woff2?url'),
      import('../assets/fonts/jetbrains-mono-latin-wght-normal.woff2?url'),
    ]).then(([tokens, css, js, gsap, runtime, inter, mono]) => ({
      tokensCss: tokens.default,
      arSeqCss: css.default,
      arSeqJs: js.default,
      gsapJs: gsap.default,
      runtimeJs: runtime.getHyperframeRuntimeScript(),
      strings: STRINGS,
      fontUrls: {
        'inter-latin-wght-normal.woff2': absoluteUrl(inter.default),
        'jetbrains-mono-latin-wght-normal.woff2': absoluteUrl(mono.default),
      },
    }));
    sharedPromise.catch(() => {
      sharedPromise = null;
    });
  }
  return sharedPromise;
}

/** Le srcdoc hérite de l'URL de base du parent, mais on rend l'URL absolue par sécurité. */
function absoluteUrl(url: string): string {
  try {
    return new URL(url, document.baseURI).href;
  } catch {
    return url;
  }
}

let playerModule: Promise<unknown> | null = null;

/** Enregistre le custom element <hyperframes-player> (une seule fois). */
export function loadPlayerElement(): Promise<unknown> {
  if (!playerModule) playerModule = import('@hyperframes/player');
  return playerModule;
}
