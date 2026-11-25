/**
 * Gestes du doigt : balayage horizontal de la page (changer de page sans viser) et appui maintenu (demi-tour, oubli de
 * l'appairage : rien d'important ne part sur un effleurement ou une goutte).
 */
import { swipeDir } from './logic.ts';

const HOLD_MS = 650;

export function watchGestures(root: HTMLElement, cb: { swipe(dir: -1 | 1): void; hold(name: string, el: HTMLElement): void; holdShort(): void }): void {
  let start: { x: number; y: number; at: number; id: number; swipe: boolean } | null = null;
  let holdEl: HTMLElement | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let held = false;
  let eatClick = 0;

  const endHold = (): void => {
    clearTimeout(holdTimer);
    holdEl?.classList.remove('holding');
    holdEl = null;
  };

  root.addEventListener('pointerdown', (e) => {
    const target = e.target as HTMLElement;
    // Un second doigt (ou une goutte) annule le geste en cours.
    if (start) {
      start = null;
      endHold();
      return;
    }
    start = { x: e.clientX, y: e.clientY, at: e.timeStamp, id: e.pointerId, swipe: !!target.closest('#page, #band, #dock') };
    const h = target.closest<HTMLElement>('[data-hold]');
    if (h) {
      held = false;
      holdEl = h;
      h.classList.add('holding');
      holdTimer = setTimeout(() => {
        held = true;
        endHold();
        cb.hold(h.dataset.hold!, h);
      }, HOLD_MS);
    }
  });
  root.addEventListener('pointermove', (e) => {
    if (start && holdEl && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 30) endHold();
  });
  const finish = (e: PointerEvent, ok: boolean): void => {
    if (!start || e.pointerId !== start.id) return;
    const s = start;
    start = null;
    const dir = ok && s.swipe ? swipeDir(e.clientX - s.x, e.clientY - s.y, e.timeStamp - s.at) : 0;
    const wasHolding = !!holdEl;
    endHold();
    if (dir) {
      eatClick = Date.now();
      cb.swipe(dir);
    } else if (ok && wasHolding && !held) cb.holdShort();
    if (held) {
      held = false;
      eatClick = Date.now();
    }
  };
  // Suivi sur la fenêtre : le doigt peut finir son geste hors de l'élément.
  window.addEventListener('pointerup', (e) => finish(e, true));
  window.addEventListener('pointercancel', (e) => finish(e, false));
  // Le « clic » qui suit un balayage ou un appui maintenu ne doit rien déclencher.
  root.addEventListener(
    'click',
    (e) => {
      if (Date.now() - eatClick < 350) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );
  // Appui long : pas de menu du navigateur.
  root.addEventListener('contextmenu', (e) => {
    if (!(e.target as HTMLElement).closest('input')) e.preventDefault();
  });
}
