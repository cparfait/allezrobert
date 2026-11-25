/**
 * Compteur : peu de chiffres, les plus gros possible (3, 5 ou 7 au choix dans les réglages). Rien à toucher ici en roulant,
 * un doigt ou une goutte ne change rien. La séance, le segment et la montée viennent s'y ajouter d'eux-mêmes.
 */
import { climbAhead, type PairState } from '@allezrobert/shared';
import { climbBarHtml, climbPageHtml, climbPageWanted, climbSummary, moveClimbMark, updateClimbPage } from '../climb.ts';
import { $, esc, numHtml, setHtml, setNum, setText } from '../dom.ts';
import { field, fmtDist, fmtTime, nf } from '../format.ts';
import { icon } from '../icons.ts';
import { targetTone, TONE_COLORS } from '../logic.ts';
import { drawProfile } from '../map.ts';
import { S, t, type Metrics } from '../state.ts';

/** Ce qui oblige à reconstruire la page. */
export const dashKey = (): string => (climbPageWanted() ? 'climb' : `n${S.density}`);

export function dashHtml(): string {
  if (climbPageWanted()) return climbPageHtml();
  return `<section class="dash">
    <div class="wk" id="d-wk" hidden><div class="wk-top"><span id="wk-name"></span><b id="wk-left"></b></div><div class="wk-mid"><span class="wk-goal"><b id="wk-target"></b><small id="wk-unit">W</small></span><span class="wk-say" id="wk-say"></span></div><div class="wk-next" id="wk-next"></div></div>
    <div class="nums n${S.density}" id="d-nums">${S.fields.slice(0, S.density).map((_, i) => numHtml(i === 0 ? 'main tint' : 'tint')).join('')}</div>
    <div class="seg" id="d-seg" hidden></div>
    <div id="d-climb"></div>
    <div class="prof"><span>${esc(t.climb)}</span><canvas id="d-prof"></canvas></div>
  </section>`;
}

export function updateDash(st: PairState, m: Metrics): void {
  if (climbPageWanted()) return updateClimbPage(m);
  const nums = $('d-nums');
  if (!nums) return;
  // En séance, la puissance prend la couleur de la cible : une seule lecture possible, celle du bloc au-dessus.
  const target = st.workout?.targetWatts ?? null;
  const tone = target !== null ? TONE_COLORS[targetTone(m.watts3s, target)] : undefined;
  S.fields.slice(0, S.density).forEach((id, i) => {
    const f = field(id, m);
    if (tone && (id === 'power3s' || id === 'power')) f.color = tone;
    setNum(nums.children[i] ?? null, t.fields[id], f.v, f.u, f.color);
  });
  updateWorkout(st, m);
  const sg = $('d-seg');
  if (sg) {
    const s = st.segment;
    sg.hidden = !s;
    if (s) {
      setHtml(sg, `${icon(s.kind === 'kom' ? 'mountain' : s.kind === 'sprint' ? 'bolt' : 'flag')}<b>${esc(s.name)}</b><span></span><i><i></i></i>`);
      setText(sg.children[2] ?? null, fmtTime(s.elapsedS));
      const bar = sg.children[3]?.firstElementChild as HTMLElement | null;
      if (bar) bar.style.width = `${Math.round(s.progress * 100)}%`;
    }
  }
  updateClimbStrip(m);
  const prof = $('d-prof') as HTMLCanvasElement | null;
  if (prof && S.geo) {
    const from = m.routeM - 300;
    const loop = S.geo.route.loop;
    drawProfile(prof, S.geo, m.routeM, loop ? from : Math.max(from, S.geo.startD), loop ? from + 3300 : Math.min(from + 3300, Math.max(S.geo.endD, m.routeM + 100)));
  }
}

/** Séance : la cible en très gros, ce qui reste du bloc, et un mot (« plus fort », « moins fort », « dans la cible »). */
function updateWorkout(st: PairState, m: Metrics): void {
  const el = $('d-wk');
  if (!el) return;
  const w = st.workout;
  el.hidden = !w;
  if (!w) return;
  setText($('wk-name'), w.targetWatts !== null ? t.target : w.name);
  setText($('wk-left'), fmtTime(w.stepRemainingS));
  setText($('wk-target'), w.targetWatts !== null ? nf(w.targetWatts) : t.free);
  setText($('wk-unit'), w.targetWatts !== null ? 'W' : '');
  const tone = w.targetWatts !== null ? targetTone(m.watts3s, w.targetWatts) : 'free';
  el.dataset.tone = tone;
  setText($('wk-say'), tone === 'ok' ? t.wkOk : tone === 'low' ? t.wkLow : tone === 'high' ? t.wkHigh : '');
  setText($('wk-next'), w.next ? `${t.next} ${w.next}` : '');
}

/** Prochaine montée, ou montée en cours dont la page a été fermée (un appui la rouvre). */
function updateClimbStrip(m: Metrics): void {
  const el = $('d-climb');
  if (!el) return;
  if (S.climb) {
    setHtml(el, S.climbHidden ? `<button class="strip" data-act="climb-show">${icon('mountain')}<b>${esc(t.climbNow)}</b><span>${esc(t.climbShow)}</span>${climbBarHtml(S.climb.climb)}</button>` : '');
    moveClimbMark(el, Math.min(Math.max(S.climb.pos, 0), S.climb.climb.lengthM) / S.climb.climb.lengthM, S.climb.pos >= 0);
    return;
  }
  const a = S.geo && !S.backwards ? climbAhead(S.climbs, m.routeM, { loop: S.geo.route.loop, lengthM: S.geo.route.lengthM }) : null;
  if (!a) return void setHtml(el, '');
  setHtml(el, `<div class="strip">${icon('mountain')}<b></b><span>${esc(climbSummary(a.climb))}</span></div>`);
  setText(el.querySelector('b'), t.climbDist(fmtDist(-a.pos, 1)));
}
