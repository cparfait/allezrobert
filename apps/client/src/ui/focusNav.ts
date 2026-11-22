/**
 * Navigation spatiale du focus, commune à tous les écrans : flèches du clavier, croix de la manette et
 * boutons du cintre (Zwift Click/Play, télécommande) déplacent le focus vers l'élément focusable le plus
 * proche dans la direction voulue ; « valider » clique l'élément qui a le focus.
 *
 * Une fenêtre modale ouverte (`[aria-modal="true"]`) limite la recherche à son contenu.
 */

export type NavDir = 'up' | 'down' | 'left' | 'right';

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

function shown(el: HTMLElement): boolean {
  if (el.closest('[hidden], [inert]')) return false;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const st = getComputedStyle(el);
  return st.visibility !== 'hidden' && st.display !== 'none';
}

/** Racine de la recherche : la dernière fenêtre modale ouverte, sinon le document. */
export function navRoot(): ParentNode {
  const modals = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')].filter(shown);
  return modals.at(-1) ?? document;
}

/** Éléments focusables visibles. */
export function focusables(root: ParentNode = navRoot()): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(shown);
}

/** Le focus est-il dans un champ où les flèches servent déjà (saisie, liste, curseur) ? */
export function inEditable(el: Element | null = document.activeElement): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return !['button', 'submit', 'checkbox', 'radio', 'reset'].includes(el.type);
  return (el as HTMLElement).isContentEditable === true;
}

/** Candidat le plus proche dans une direction : distance sur l'axe principal + 2 × écart sur l'autre axe. */
export function pickNext(from: DOMRect, dir: NavDir, rects: ReadonlyArray<{ rect: DOMRect }>): number {
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  let best = -1;
  let bestScore = Infinity;
  rects.forEach(({ rect }, i) => {
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const dx = x - cx;
    const dy = y - cy;
    const main = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy;
    if (main <= 1) return;
    const side = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    const score = main + 2 * side;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/** Déplace le focus ; sans focus dans l'écran, le pose sur l'action principale (`.ab-go`) ou le premier élément. */
export function moveFocus(dir: NavDir): boolean {
  const list = focusables();
  if (!list.length) return false;
  const cur = document.activeElement as HTMLElement | null;
  if (!cur || cur === document.body || !list.includes(cur)) {
    const first = list.find((el) => el.classList.contains('ab-go')) ?? list[0]!;
    first.focus();
    return true;
  }
  const i = pickNext(
    cur.getBoundingClientRect(),
    dir,
    list.map((el) => ({ rect: el.getBoundingClientRect() })),
  );
  if (i < 0) return false;
  const next = list[i]!;
  next.focus();
  next.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  return true;
}

/** Clique l'élément qui a le focus (ou l'action principale de l'écran). */
export function activateFocus(): boolean {
  const cur = document.activeElement as HTMLElement | null;
  const list = focusables();
  const target = cur && cur !== document.body && list.includes(cur) ? cur : list.find((el) => el.classList.contains('ab-go'));
  if (!target) return false;
  target.click();
  return true;
}
