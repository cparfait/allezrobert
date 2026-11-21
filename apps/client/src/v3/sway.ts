/**
 * Style Bêta : part du balancement du vélo et du coureur qui pédale (1 = l'amplitude d'origine). Le balancement
 * vient de deux sources qui s'additionnent : l'inclinaison rythmée du repère du coureur (`lean`, gltfAvatar.ts) et
 * l'oscillation de l'os racine des clips (visuals.ts). Réduit à 0,6 pour essai ; `?v3sway=1` rend l'amplitude
 * d'origine, `?v3sway=0` le coupe.
 */
export const V3_SWAY = (() => {
  const DEFAULT = 0.6;
  try {
    const raw = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('v3sway');
    if (raw === null || raw === '') return DEFAULT;
    const v = Number(raw);
    return Number.isFinite(v) ? Math.min(1.5, Math.max(0, v)) : DEFAULT;
  } catch {
    return DEFAULT;
  }
})();
