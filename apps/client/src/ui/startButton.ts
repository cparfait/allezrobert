import './blocks.css';
import { getLang } from '../i18n/index.ts';

let pending: { kind: 'race' | 'tt'; go: () => void } | null = null;

/** Départ attendu en ce moment (pour le compagnon), ou null. */
export function awaitedStart(): 'race' | 'tt' | null {
  return pending?.kind ?? null;
}

/** Donne le départ attendu (commande du compagnon). Renvoie faux s'il n'y en a pas. */
export function triggerStart(): boolean {
  if (!pending) return false;
  pending.go();
  return true;
}

/**
 * Course locale et contre-la-montre : le départ attend que le joueur soit installé. Carte « Prêt ? » en bas de
 * l'écran (style gros blocs, ui/blocks.css) avec un bouton ; Entrée ou Espace le valident aussi (au guidon), et le bouton « Lancer » du compagnon (triggerStart).
 * La promesse se résout au clic.
 */
export function waitForStart(kind: 'race' | 'tt'): Promise<void> {
  const fr = getLang() === 'fr';
  const root = document.createElement('div');
  root.style.cssText = 'position:fixed;left:50%;bottom:16vh;transform:translateX(-50%);z-index:45;display:flex;flex-direction:column;align-items:center;gap:10px;padding:18px 26px;border-radius:22px;background:rgba(10,14,22,.82);border:2px solid rgba(255,255,255,.1);backdrop-filter:blur(6px);text-align:center;color:#f5f7fa';
  const title = kind === 'tt' ? (fr ? 'Sur la rampe' : 'On the start ramp') : fr ? 'Sur la ligne' : 'On the start line';
  const sub = fr ? 'Installe-toi bien, puis donne le départ.' : 'Get settled, then start.';
  const go = kind === 'tt' ? (fr ? 'Lancer le chrono' : 'Start the time trial') : fr ? 'Lancer la course' : 'Start the race';
  root.innerHTML = `<b style="font:800 20px var(--font, system-ui)">${title}</b><span style="font-size:14px;color:#c3cddb">${sub}</span><button type="button" class="ab-btn ab-go">${go}</button><small style="font-size:12px;color:#8d98a6">${fr ? 'ou Entrée' : 'or Enter'}</small>`;
  document.body.appendChild(root);
  const button = root.querySelector('button');
  button?.focus({ preventScroll: true });
  return new Promise((resolve) => {
    const done = () => {
      pending = null;
      window.removeEventListener('keydown', onKey, true);
      root.remove();
      resolve();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      done();
    };
    pending = { kind, go: done };
    window.addEventListener('keydown', onKey, true);
    button?.addEventListener('click', done);
  });
}
