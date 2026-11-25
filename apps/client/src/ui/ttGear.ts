/**
 * Contre-la-montre : matériel proposé avant le départ si le joueur n'est pas équipé pour (game/headgear.ts, `ttMissing`).
 * Il peut s'équiper d'office pour cette sortie (Réel et Poly : modèles du catalogue), choisir au garage, ou partir comme
 * il est. En Bêta, rien n'est mis d'office : le garage ou partir.
 */
import './blocks.css';
import './rideRecovery.css';
import { getLang } from '../i18n/index.ts';
import type { TtMissing } from '../game/headgear.ts';

/** `cancel` : Échap, retour au menu sans partir. */
export type TtChoice = 'auto' | 'garage' | 'keep' | 'cancel';

/** Choix pour le prochain départ, gardé à travers un rechargement (changement de qualité graphique). */
const KEY = 'ar.ttGear';

export function rememberTtChoice(keep: boolean): void {
  try {
    if (keep) sessionStorage.setItem(KEY, 'keep');
    else sessionStorage.removeItem(KEY);
  } catch {
    // Stockage interdit : matériel mis d'office.
  }
}

/** Partir avec son propre matériel ? Lu une fois par départ. */
export function takeTtKeep(): boolean {
  try {
    const keep = sessionStorage.getItem(KEY) === 'keep';
    sessionStorage.removeItem(KEY);
    return keep;
  } catch {
    return false;
  }
}

/** Phrase de ce qui manque (pure, testée) ; `null` : inconnu (Bêta). */
export function ttGearText(missing: TtMissing | null, fr: boolean): string {
  if (!missing) return fr ? 'Pense à ton matériel aéro : vélo, roues et casque de chrono.' : 'Check your aero gear: time trial bike, wheels and helmet.';
  const parts = [...(missing.bike ? [fr ? 'de vélo de chrono (roues aéro comprises)' : 'time trial bike (aero wheels included)'] : []), ...(missing.helmet ? [fr ? 'de casque chrono' : 'aero helmet'] : [])];
  return fr ? `Tu n’as pas ${parts.join(' ni ')}.` : `You have no ${parts.join(' or ')}.`;
}

export function askTtGear(missing: TtMissing | null): Promise<TtChoice> {
  const fr = getLang() === 'fr';
  const root = document.createElement('div');
  root.className = 'rr-overlay';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'tt-gear-title');
  const btn = (k: TtChoice, label: string, go = false) => `<button type="button" class="ab-btn${go ? ' ab-go' : ''}" data-tt="${k}">${label}</button>`;
  const garage = fr ? 'Choisir au garage' : 'Choose in the garage';
  root.innerHTML = `<div class="rr-card">
    <header><h2 class="ab-title" id="tt-gear-title">${fr ? 'Contre-la-montre' : 'Time trial'}</h2><p class="ab-sub">${ttGearText(missing, fr)}</p></header>
    <footer class="ab-foot"><div class="ab-btns">${btn('keep', fr ? 'Partir comme ça' : 'Ride as is')}${missing ? btn('garage', garage) + btn('auto', fr ? 'M’équiper pour cette sortie' : 'Equip me for this ride', true) : btn('garage', garage, true)}</div></footer>
  </div>`;
  document.body.appendChild(root);
  root.querySelector<HTMLButtonElement>('.ab-go')?.focus();
  return new Promise((resolve) => {
    const done = (c: TtChoice) => {
      document.removeEventListener('keydown', onKey, true);
      root.remove();
      resolve(c);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      done('cancel');
    };
    document.addEventListener('keydown', onKey, true);
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-tt]')) b.onclick = () => done(b.dataset.tt as TtChoice);
  });
}
