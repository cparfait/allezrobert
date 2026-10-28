/**
 * Écran de chargement (déclaré dans index.html pour s'afficher avant le code) : barre de
 * progression, étape en cours, et durée de chaque étape dans la console (« [démarrage] »).
 */
let last = performance.now();

const el = (id: string) => document.getElementById(id);

export function bootStep(pct: number, label: string): void {
  const now = performance.now();
  // Repère lu par tools/perf (détail du temps de chargement).
  performance.mark(`ar:${label}`);
  console.info(`[démarrage] ${label} — ${(now / 1000).toFixed(1)} s (étape précédente : ${Math.round(now - last)} ms)`);
  last = now;
  const bar = el('splash-bar');
  if (bar) bar.style.width = `${Math.max(4, Math.min(100, pct))}%`;
  const step = el('splash-step');
  if (step) step.textContent = label;
  const p = el('splash-pct');
  if (p) p.textContent = `${Math.round(pct)} %`;
}

/** Avance la barre sans changer l'étape affichée (progression fine à l'intérieur d'une étape). */
export function bootProgress(pct: number): void {
  const bar = el('splash-bar');
  if (bar) bar.style.width = `${Math.max(4, Math.min(100, pct))}%`;
  const p = el('splash-pct');
  if (p) p.textContent = `${Math.round(pct)} %`;
}

/** Change le texte de l'étape sans nouveau repère (progression détaillée : « 120 Mo sur 390 Mo »). */
export function bootLabel(label: string): void {
  const step = el('splash-step');
  if (step) {
    step.textContent = label;
    step.style.color = '';
  }
}

/** Fondu de sortie une fois le premier écran prêt. */
export function bootDone(): void {
  const s = el('splash');
  if (!s) return;
  bootStep(100, 'Prêt');
  s.classList.add('out');
  setTimeout(() => s.remove(), 600);
}

export function bootError(message: string): void {
  const step = el('splash-step');
  if (step) {
    step.textContent = `Erreur : ${message}`;
    step.style.color = '#fca5a5';
  }
}
