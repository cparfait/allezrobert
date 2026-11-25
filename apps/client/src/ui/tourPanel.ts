import './blocks.css';
import './tourPanel.css';
import { getLang } from '../i18n/index.ts';
import { fmtTime, standings, tourDone, type StageResult, type Tour } from '../game/stageRace.ts';

/**
 * Écran de fin d'étape du tour (idée NCT Ride) : podium de l'étape, puis classements à onglets — étape, général
 * (maillot jaune), points (vert), montagne (à pois), équipes. Dernière étape : podium final du général et des maillots.
 * Style « gros blocs » (ui/blocks.css). Renvoie une promesse résolue à la fermeture.
 */

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] as string);
const JERSEY = { gc: '#ffd23f', points: '#3fa65a', kom: '#d63a2f', young: '#f2f2ee' } as const;

function jerseySvg(color: string, dots = false): string {
  return `<svg viewBox="0 0 40 40" class="tp-jersey" aria-hidden="true"><path d="M12 6 L4 12 L8 20 L11 18 L11 36 L29 36 L29 18 L32 20 L36 12 L28 6 Q20 11 12 6 Z" fill="${dots ? '#f2f2ee' : color}" stroke="rgba(0,0,0,.35)" stroke-width="1.2"/>${dots ? '<g fill="#d63a2f"><circle cx="15" cy="16" r="2.2"/><circle cx="24" cy="14" r="2.2"/><circle cx="19" cy="24" r="2.2"/><circle cx="26" cy="27" r="2.2"/><circle cx="14" cy="30" r="2.2"/></g>' : ''}</svg>`;
}

export function showTourPanel(tour: Tour, stage: StageResult): Promise<void> {
  const fr = getLang() === 'fr';
  const st = standings(tour);
  const name = (id: string) => tour.riders.find((r) => r.id === id)?.name ?? id;
  const team = (id: string) => tour.riders.find((r) => r.id === id)?.team ?? '';
  const n = tour.results.length;
  const final = tourDone(tour);
  const winner = stage.order[0] ?? '';
  const t0 = stage.times[winner] ?? 0;
  // Podium : de l'étape, ou du général final.
  const podium = final ? st.gc.slice(0, 3).map((r) => r.id) : stage.order.slice(0, 3);
  const podiumHtml = `<div class="tp-podium">${[1, 0, 2]
    .map((i) => {
      const id = podium[i];
      if (!id) return '<div class="tp-step"></div>';
      return `<div class="tp-step s${i + 1}${id === 'me' ? ' me' : ''}"><div class="tp-who">${i === 0 && final ? jerseySvg(JERSEY.gc) : ''}<b>${esc(name(id))}</b><small>${esc(team(id))}</small></div><div class="tp-block">${i + 1}</div></div>`;
    })
    .join('')}</div>`;
  const row = (rank: number, id: string, value: string, me: boolean) => `<tr class="${me ? 'me' : ''}"><td class="num">${rank}</td><td>${esc(name(id))}<small>${esc(team(id))}</small></td><td class="num">${value}</td></tr>`;
  const stageRows = stage.order.map((id, i) => row(i + 1, id, i === 0 ? fmtTime(stage.times[id] ?? 0) : fmtTime((stage.times[id] ?? 0) - t0, true), id === 'me')).join('');
  const gc0 = st.gc[0]?.value ?? 0;
  const gcRows = st.gc.map((r, i) => row(i + 1, r.id, i === 0 ? fmtTime(r.value) : fmtTime(r.value - gc0, true), !!r.me)).join('');
  const ptRows = st.points.map((r, i) => row(i + 1, r.id, `${r.value} pts`, !!r.me)).join('');
  const komRows = st.kom.map((r, i) => row(i + 1, r.id, `${r.value} pts`, !!r.me)).join('');
  const tm0 = st.teams[0]?.value ?? 0;
  const teamRows = st.teams.map((tm, i) => `<tr class="${tm.mine ? 'me' : ''}"><td class="num">${i + 1}</td><td>${esc(tm.team)}</td><td class="num">${i === 0 ? fmtTime(tm.value) : fmtTime(tm.value - tm0, true)}</td></tr>`).join('');
  const tabs: Array<[string, string, string]> = [
    ['stage', fr ? 'Étape' : 'Stage', stageRows],
    ['gc', `${jerseySvg(JERSEY.gc)}${fr ? 'Général' : 'General'}`, gcRows],
    ['points', `${jerseySvg(JERSEY.points)}${fr ? 'Points' : 'Points'}`, ptRows],
    ['kom', `${jerseySvg(JERSEY.kom, true)}${fr ? 'Montagne' : 'Mountains'}`, komRows],
    ['teams', fr ? 'Équipes' : 'Teams', teamRows],
  ];
  const leaders = [
    [JERSEY.gc, false, fr ? 'Maillot jaune' : 'Yellow jersey', st.gc[0]],
    [JERSEY.points, false, fr ? 'Maillot vert' : 'Green jersey', st.points[0]],
    [JERSEY.kom, true, fr ? 'Maillot à pois' : 'Polka-dot jersey', st.kom[0]?.value ? st.kom[0] : undefined],
  ] as const;
  const leadersHtml = `<div class="tp-leaders">${leaders
    .map(([c, dots, label, r]) => `<div class="ab-tile ab-plain tp-lead${r?.me ? ' me' : ''}">${jerseySvg(c, dots)}<div><small>${label}</small><b>${r ? esc(r.name) : '—'}</b></div></div>`)
    .join('')}</div>`;
  const root = document.createElement('div');
  root.className = 'tp-overlay';
  const myStage = stage.order.indexOf('me') + 1;
  const myGc = st.gc.findIndex((r) => r.me) + 1;
  root.innerHTML = `<div class="tp-card">
    <h1 class="ab-title">${esc(tour.name)} — ${final ? (fr ? 'classement final' : 'final standings') : `${fr ? 'étape' : 'stage'} ${n}/${tour.stages.length}`}</h1>
    <p class="ab-sub">${stage.kind === 'tt' ? (fr ? 'Contre-la-montre' : 'Time trial') : fr ? 'Course en ligne' : 'Road stage'} · ${esc(stage.route)} · ${fr ? `tu es ${myStage}e de l’étape, ${myGc}e au général` : `you are ${myStage} on the stage, ${myGc} overall`}</p>
    ${podiumHtml}
    ${leadersHtml}
    <div class="tp-tabs" role="tablist">${tabs.map(([id, label], i) => `<button type="button" role="tab" class="tp-tab${i === (final ? 1 : 0) ? ' on' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>
    ${tabs.map(([id, , rows], i) => `<div class="tp-pane" data-pane="${id}"${i === (final ? 1 : 0) ? '' : ' hidden'}><table class="tp-table">${rows}</table></div>`).join('')}
    <div class="ab-foot"><span class="ab-sub">${final ? (fr ? 'Tour terminé : un nouveau tour repartira au prochain lancement.' : 'Tour finished: a new one starts next time.') : fr ? 'Étape suivante : choisis ton parcours et relance une course « Tour à étapes », aujourd’hui ou un autre jour.' : 'Next stage: pick a route and start a “Stage race” again, today or another day.'}</span><div class="ab-btns"><button type="button" class="ab-btn ab-go" data-close>${fr ? 'Continuer' : 'Continue'}</button></div></div>
  </div>`;
  document.body.appendChild(root);
  root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      root.querySelectorAll('.tp-tab').forEach((x) => x.classList.toggle('on', x === b));
      root.querySelectorAll<HTMLElement>('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== b.dataset.tab));
    }),
  );
  return new Promise((res) => {
    root.querySelector('[data-close]')?.addEventListener('click', () => {
      root.remove();
      res();
    });
  });
}
