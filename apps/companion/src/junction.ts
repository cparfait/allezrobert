/**
 * Carrefour (monde ouvert) : en roulant, quelques secondes pour choisir. La moitié basse de l'écran devient deux ou trois
 * énormes flèches, sous le pouce ; les chiffres du haut restent visibles.
 */
import { esc, $, setHtml, setText } from './dom.ts';
import { icon, type IconId } from './icons.ts';
import { haptic, S, t } from './state.ts';

const ARROWS: Record<string, IconId> = { left: 'left', straight: 'straight', right: 'right', back: 'uturn' };

let seen = '';
let wasLocked = false;
let openedAt = 0;

/** Un doigt posé ailleurs au moment où le carrefour s'affiche ne doit pas choisir à la place du coureur. */
export const junctionArmed = (): boolean => Date.now() - openedAt > 400;

export function updateJunction(): void {
  const el = $('junction');
  if (!el) return;
  const j = S.st?.phase === 'ride' ? S.st.junction : null;
  const show = !!j && j.inM <= 450;
  const key = show ? j.choices.map((c) => c.name + c.dir).join('|') : '';
  if (show && key !== seen) {
    openedAt = Date.now();
    haptic([70, 50, 70]);
  }
  if (show && j.locked && !wasLocked) haptic(30);
  seen = key;
  wasLocked = show && j.locked;
  el.hidden = !show;
  if (!show) return void setHtml(el, '');
  setHtml(
    el,
    `<div class="jn ${j.locked ? 'locked' : ''}"><div class="jn-head"><b>${esc(j.locked ? t.lockedShort : t.junction)}</b><span></span></div><div class="jn-choices c${j.choices.length}">${j.choices
      .map((c, i) => {
        const dir = (c.dir in ARROWS ? c.dir : 'straight') as keyof typeof t.dirs;
        return `<button class="${i === j.selected ? 'on' : ''}" data-turn="${i}" ${j.locked ? 'disabled' : ''}>${icon(ARROWS[dir]!)}<b>${esc(t.dirs[dir])}</b><span>${esc(c.name)}</span>${c.unpaved ? `<em>${esc(t.unpaved)}</em>` : ''}</button>`;
      })
      .join('')}</div></div>`,
  );
  setText(el.querySelector('.jn-head span'), `${Math.max(0, Math.round(j.inM / 10) * 10)} m`);
}
