/** Musique : trois énormes touches, le volume au − et au +, et le choix d'un morceau à part. */
import { $, esc, setHtml, setText } from '../dom.ts';
import { icon } from '../icons.ts';
import { S, t, withLocal } from '../state.ts';

export function musicHtml(): string {
  return `<section class="music">
    <div class="cover" id="mu-cover"></div>
    <div class="mu-title"><span id="mu-src"></span><b id="mu-title">–</b></div>
    <div class="transport">
      <button data-music="previous" aria-label="${esc(t.previous)}">${icon('prev')}</button>
      <button class="play" data-music="toggle" id="mu-play" aria-label="${esc(t.play)}"></button>
      <button data-music="next" aria-label="${esc(t.nextTrack)}">${icon('next')}</button>
    </div>
    <div class="stepper"><button data-vol="-1" aria-label="${esc(t.volume)} −">${icon('minus')}</button><div><span>${esc(t.volume)}</span><b id="mu-vol">–</b></div><button data-vol="1" aria-label="${esc(t.volume)} +">${icon('plus')}</button></div>
    <button class="btn" data-panel="search">${icon('list')}${esc(t.musicPick)}</button>
  </section>`;
}

/** Pochette Spotify ; seule une adresse https de Spotify est acceptée. */
function coverOf(): string {
  const mu = S.st?.music;
  return mu?.source === 'spotify' && mu.cover && /^https:\/\/[a-z0-9.-]*scdn\.co\//.test(mu.cover) ? mu.cover : '';
}

export function updateMusic(): void {
  const mu = S.st?.music;
  setText($('mu-src'), !mu ? '' : mu.source === 'spotify' ? t.musicSpotify : t.musicGame);
  setText($('mu-title'), mu ? mu.title || (mu.playing ? '…' : t.musicOff) : '–');
  const playing = withLocal('playing', !!mu?.playing);
  setHtml($('mu-play'), icon(playing ? 'pause' : 'play'));
  const cover = coverOf();
  const c = $('mu-cover');
  c?.classList.toggle('img', !!cover);
  setHtml(c, cover ? `<img src="${esc(cover)}" alt="" />` : icon('music'));
  setText($('mu-vol'), mu ? `${Math.round(withLocal('volume', mu.volume) * 100)} %` : '–');
}
