/**
 * Actions : huit grosses touches au plus, toujours à la même place, sans défilement. Un appui agit, ou ouvre un panneau de
 * grosses touches (caméra, ventilateur, son, écran). Le demi-tour demande un appui maintenu.
 */
import type { PairState } from '@allezrobert/shared';
import { $, esc, setHtml, setText } from '../dom.ts';
import { icon, tile } from '../icons.ts';
import { t, withLocal, type Metrics } from '../state.ts';

const hasUturn = (st: PairState): boolean => !!st.open || !st.multiplayer;

export const actionsKey = (st: PairState): string => `${hasUturn(st)}${!!st.shifter}`;

export function actionsHtml(st: PairState): string {
  return `<section class="acts">
    ${
      st.shifter
        ? `<div class="stepper gears"><button data-cmd="shift-down" aria-label="${esc(t.shiftDown)}">${icon('minus')}</button><div><span>${esc(t.gear)}</span><b id="a-gear">–</b><small id="a-gearn"></small></div><button data-cmd="shift-up" aria-label="${esc(t.shiftUp)}">${icon('plus')}</button></div>`
        : ''
    }
    <div class="tiles">
      ${tile('data-cmd="pause"', 'pause', esc(t.pause), { id: 'a-pause' })}
      ${tile('data-panel="camera"', 'camera', esc(t.camera), { id: 'a-cam', sub: '' })}
      ${tile('data-cmd="lookback"', 'behind', esc(t.lookBack), { id: 'a-look', sub: '' })}
      ${tile('data-cmd="photo"', 'photo', esc(t.photo))}
      ${tile('data-panel="fan"', 'fan', esc(t.fan), { id: 'a-fan', sub: '' })}
      ${tile('data-panel="sound"', 'sound', esc(t.sound), { id: 'a-sound', sub: '' })}
      ${tile('data-panel="screen"', 'screen', esc(t.screen))}
      ${hasUturn(st) ? tile('data-hold="uturn"', 'uturn', esc(t.uturn), { sub: esc(t.hold) }) : ''}
    </div>
  </section>`;
}

/** État écrit sous le nom d'une touche, et touche éclairée. */
function sub(id: string, text: string, on = false): void {
  const el = $(id);
  if (!el) return;
  setText(el.querySelector('small'), text);
  el.classList.toggle('on', on);
}

/** Ventilateur : mode suivi (« Vitesse », « Cardio »…) ou force réglée. */
export function fanWord(st: PairState): string {
  const mode = withLocal('fanMode', st.fanMode);
  return mode && mode !== 'manual' ? t.fanModes[mode] : `${withLocal('fan', st.fanPercent ?? 0)} %`;
}

export function updateActions(st: PairState, m: Metrics): void {
  const paused = st.phase === 'paused';
  const p = $('a-pause');
  if (p) {
    p.classList.toggle('go', paused);
    setHtml(p, `${icon(paused ? 'play' : 'pause')}<span class="tx"><b>${esc(paused ? t.resume : t.pause)}</b></span>`);
  }
  sub('a-cam', st.camera ? t.cameras[withLocal('camera', st.camera)] : '');
  const look = withLocal('lookBack', !!st.lookBack);
  sub('a-look', look ? t.lookOn : '', look);
  sub('a-fan', fanWord(st));
  const muted = withLocal('muted', !!st.muted);
  sub('a-sound', muted ? t.soundOff : t.soundOn);
  $('a-sound')?.classList.toggle('bad', muted);
  setText($('a-gear'), m.gearLabel || String(m.gearIndex + 1));
  setText($('a-gearn'), `${m.gearIndex + 1} / ${m.gearCount}`);
}
