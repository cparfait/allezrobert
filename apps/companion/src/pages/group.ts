/**
 * Groupe : où sont les autres, et un mot ou un ordre en un appui. Coéquipiers IA : allure et ordres ; vrais joueurs :
 * Ride On au plus proche, message tout prêt, écriture seulement si on y tient.
 */
import type { PairRider, PairState } from '@allezrobert/shared';
import { $, esc, setHtml, setText } from '../dom.ts';
import { icon, tile } from '../icons.ts';
import { S, t } from '../state.ts';

export const groupKey = (st: PairState): string => `${!!st.team}${!!st.multiplayer}`;

/** Vrais joueurs, du plus proche au plus lointain. */
export function humans(st: PairState | null): PairRider[] {
  return (st?.riders ?? []).filter((r) => !r.me && !r.ai).sort((a, b) => Math.abs(a.gapM) - Math.abs(b.gapM));
}

export function groupHtml(st: PairState): string {
  return `<section class="grp">
    <div class="radar"><i class="line"></i><div id="g-dots"></div><i class="me"></i><span>${esc(t.groupBehind)}</span><span>${esc(t.groupYou)}</span><span>${esc(t.groupAhead)}</span></div>
    <div class="riders" id="g-list"></div>
    ${
      st.multiplayer
        ? `<div class="tiles two">${tile('data-rideon="near"', 'thumb', esc(t.rideOn), { id: 'g-near', cls: 'wide' })}${tile('data-panel="quick"', 'chat', esc(t.quickBtn))}${tile('data-panel="chat"', 'keyboard', esc(t.writeBtn), { id: 'g-chat', sub: '' })}</div>`
        : ''
    }
    ${
      st.team
        ? `<div class="stepper"><button data-cmd="pace-down" aria-label="${esc(t.paceDown)}">${icon('minus')}</button><div><span>${esc(t.pace)}</span><b id="g-pace">–</b><small>% FTP</small></div><button data-cmd="pace-up" aria-label="${esc(t.paceUp)}">${icon('plus')}</button></div>
    <div class="tiles six">${tile('data-cmd="waitme"', 'wait', esc(t.waitMe))}${tile('data-cmd="slowdown"', 'slow', esc(t.slowDown))}${tile('data-cmd="team-pull"', 'pull', esc(t.teamPull))}${tile('data-cmd="team-attack"', 'attack', esc(t.teamAttack))}${tile('data-cmd="formation"', 'formation', esc(t.formation), { cls: 'wide2' })}</div>`
        : ''
    }
  </section>`;
}

export function updateGroup(st: PairState): void {
  const riders = (st.riders ?? []).filter((r) => !r.me);
  // Radar : 30 m derrière à 30 m devant, moi au centre (comme le panneau « Groupe » du jeu).
  setHtml(
    $('g-dots'),
    riders
      .filter((r) => Math.abs(r.gapM) <= 30)
      .map((r) => `<i style="left:${(50 + (r.gapM / 30) * 50).toFixed(0)}%;background:${esc(r.color)}"></i>`)
      .join(''),
  );
  // Les plus proches, du premier au dernier ; IA : énergie (W′) et ce qu'elles font de notable.
  const eff = { attack: t.effAttack, chase: t.effChase, cracked: t.effCracked } as const;
  setHtml(
    $('g-list'),
    riders
      .slice()
      .sort((a, b) => Math.abs(a.gapM) - Math.abs(b.gapM))
      .slice(0, 5)
      .sort((a, b) => b.gapM - a.gapM)
      .map((r) => {
        const e = r.energy === undefined ? null : Math.max(0, Math.min(100, Math.round(r.energy)));
        const tone = e === null ? '' : e > 60 ? 'hi' : e > 30 ? 'mid' : 'lo';
        return `<div><i style="background:${esc(r.color)}"></i><b>${esc(r.name)}</b>${r.effort ? `<em class="${r.effort}">${esc(eff[r.effort])}</em>` : ''}${e === null ? '' : `<u class="${tone}"><s style="width:${Math.round(e / 5) * 5}%"></s></u>`}<span>${Math.round(Math.abs(r.gapM)) === 0 ? '' : r.gapM > 0 ? '+' : '−'}${Math.round(Math.abs(r.gapM))} m</span></div>`;
      })
      .join(''),
  );
  setText($('g-pace'), st.groupPacePct ? String(st.groupPacePct) : '–');
  const near = $('g-near');
  if (near) {
    const h = humans(st)[0];
    (near as HTMLButtonElement).disabled = !h;
    near.dataset.rideon = h ? (humans(st).length > 1 ? 'pick' : h.id) : 'near';
    setText(near.querySelector('b'), h && humans(st).length === 1 ? t.rideOnTo(h.name) : h ? t.rideOn : t.nobody);
  }
  const chat = $('g-chat');
  if (chat) setText(chat.querySelector('small'), S.unread ? `+${S.unread}` : '');
}
