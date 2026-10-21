/**
 * Assemblage d'une composition en document autonome (srcdoc du <hyperframes-player>).
 *
 * Les fichiers compositions/<nom>/index.html référencent leurs ressources en relatif
 * (assets/tokens.css, assets/gsap.min.js…) pour la CLI. Dans le jeu, le lecteur charge la
 * composition via `srcdoc` : les URL relatives ne pointent plus nulle part, donc on inline
 * tout (CSS, GSAP, utilitaires, textes FR/EN, runtime HyperFrames) et on remplace les URL des
 * polices par celles fournies par le bundler. Résultat : aucune requête réseau hors polices,
 * fonctionnement hors ligne, pas de dépendance au CDN du runtime.
 *
 * Module pur (chaînes uniquement) : testable sous Node.
 */
import type { Lang } from './strings.ts';

export interface SharedAssets {
  /** Contenu de tokens.css (URL de polices en ./assets/fonts/<fichier>). */
  tokensCss: string;
  /** Contenu de lib/ar-seq.css. */
  arSeqCss: string;
  /** Contenu de lib/ar-seq.js. */
  arSeqJs: string;
  /** Contenu de gsap/dist/gsap.min.js. */
  gsapJs: string;
  /** Tables de textes (STRINGS). */
  strings: unknown;
  /** Runtime HyperFrames (IIFE) à inliner ; absent = le lecteur l'injecte depuis son CDN. */
  runtimeJs?: string;
  /** Nom de fichier de police → URL servie (ex. import '…woff2?url'). */
  fontUrls: Record<string, string>;
}

export interface AssembleOptions {
  variables?: Record<string, string | number | boolean>;
  lang?: Lang;
}

/** Échappe un contenu de <script> / <style> inline. */
function escapeInline(code: string, tag: 'script' | 'style'): string {
  return code.replace(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`);
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .split('<').join('\\u003c')
    .split(String.fromCharCode(0x2028)).join('\\u2028')
    .split(String.fromCharCode(0x2029)).join('\\u2029');
}

function rewriteFontUrls(css: string, fontUrls: Record<string, string>): string {
  return css.replace(/url\((['"]?)\.\/(?:assets\/)?fonts\/([^'")]+)\1\)/g, (_m, _q, file: string) => {
    const url = fontUrls[file];
    if (!url) throw new Error(`Police inconnue dans tokens.css : ${file}`);
    return `url("${url}")`;
  });
}

/** Construit le document HTML complet à passer en `srcdoc`. */
export function assembleComposition(html: string, assets: SharedAssets, options: AssembleOptions = {}): string {
  const styles: Record<string, string> = {
    'tokens.css': rewriteFontUrls(assets.tokensCss, assets.fontUrls),
    'ar-seq.css': assets.arSeqCss,
  };
  const scripts: Record<string, string> = {
    'gsap.min.js': assets.gsapJs,
    'strings.js': `window.__AR_STRINGS = ${jsonForScript(assets.strings)};`,
    'ar-seq.js': assets.arSeqJs,
  };

  let out = html.replace(/<link\b[^>]*\bhref="assets\/([\w.-]+\.css)"[^>]*>/g, (_m, file: string) => {
    const css = styles[file];
    if (css === undefined) throw new Error(`Feuille de style non inlinable : assets/${file}`);
    return `<style data-ar-asset="${file}">\n${escapeInline(css, 'style')}\n</style>`;
  });
  out = out.replace(/<script\b[^>]*\bsrc="assets\/([\w.-]+\.js)"[^>]*><\/script>/g, (_m, file: string) => {
    const js = scripts[file];
    if (js === undefined) throw new Error(`Script non inlinable : assets/${file}`);
    return `<script data-ar-asset="${file}">\n${escapeInline(js, 'script')}\n</script>`;
  });

  // Variables + runtime en tête de <head> : le runtime lit window.__hfVariables (défauts déclarés
  // sur <html> fusionnés avec ces surcharges), exactement comme un rendu CLI avec --variables.
  const head: string[] = [];
  head.push(`<script>window.__hfVariables = ${jsonForScript(options.variables ?? {})};</script>`);
  if (assets.runtimeJs) {
    // Le commentaire « hyperframe.runtime.iife.js » signale au lecteur que le runtime est déjà
    // présent : il n'injecte alors pas sa copie CDN.
    head.push(`<script>/* hyperframe.runtime.iife.js (inline) */\n${escapeInline(assets.runtimeJs, 'script')}\n</script>`);
  }
  out = out.replace(/<head(\s[^>]*)?>/i, (m) => `${m}\n${head.join('\n')}`);

  if (options.lang) {
    out = out.replace(/<html\b([^>]*?)\slang="[^"]*"/i, (_m, attrs: string) => `<html${attrs} lang="${options.lang}"`);
  }

  const leftover = out.match(/(?:href|src)="assets\/[^"]+"/);
  if (leftover) throw new Error(`Ressource relative non résolue : ${leftover[0]}`);
  return out;
}
