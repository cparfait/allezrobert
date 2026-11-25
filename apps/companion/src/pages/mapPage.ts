/** Carte : toute la place pour le plan, trois grosses touches dessous. */
import type { PairState } from '@allezrobert/shared';
import { $, esc, setText } from '../dom.ts';
import { icon } from '../icons.ts';
import { drawMap, drawProfile } from '../map.ts';
import { S, t, type Metrics } from '../state.ts';

export const mapKey = (st: PairState): string => `${!!st.open}${st.mapOpen !== undefined}`;

export function mapHtml(st: PairState): string {
  return `<section class="mapp">
    <div class="mapbox"><canvas id="m-map"></canvas></div>
    <div class="mapprof"><canvas id="m-prof"></canvas></div>
    <div class="mapbtns">
      <button class="btn" data-act="follow" id="m-follow">${icon('whole')}<span></span></button>
      ${st.open ? `<button class="btn" data-panel="dest">${icon('flag')}<span>${esc(t.destTitle)}</span></button>` : ''}
      ${st.mapOpen !== undefined ? `<button class="btn" data-act="map-screen" id="m-screen">${icon('screen')}<span>${esc(t.screen)}</span></button>` : ''}
    </div>
  </section>`;
}

export function updateMap(st: PairState, m: Metrics): void {
  setText($('m-follow')?.querySelector('span') ?? null, S.follow ? t.whole : t.follow);
  $('m-screen')?.classList.toggle('on', !!st.mapOpen);
  if (!S.geo) return;
  const canvas = $('m-map') as HTMLCanvasElement | null;
  if (canvas) drawMap(canvas, S.geo, { routeM: m.routeM, ...(st.pos ? { pos: st.pos } : {}), riders: st.riders ?? [], follow: S.follow, ...(st.open && st.destination ? { destination: st.destination } : {}) });
  const prof = $('m-prof') as HTMLCanvasElement | null;
  if (prof) drawProfile(prof, S.geo, m.routeM, S.geo.startD, S.geo.route.loop ? S.geo.route.lengthM : S.geo.endD);
}
