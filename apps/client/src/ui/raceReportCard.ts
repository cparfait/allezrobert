import './blocks.css';
import './raceReport.css';
import type { RaceReport } from '../game/raceReport.ts';

/**
 * Bilan de course du résumé de fin de sortie (course locale : étape du tour, contre-la-montre), en gros blocs
 * (ui/blocks.css, référence « Prêt à rouler ? ») à lire de haut en bas : ma course en quatre blocs (place, temps,
 * maillot vert, maillot à pois), l'arrivée (podium, puis les coureurs autour de moi avec l'écart en barre), mes
 * passages notés, mes efforts (W, W/kg, % de FTP) et mes tours.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

function clock(s: number): string {
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const ord = (n: number, fr: boolean) => (fr ? (n === 1 ? '1er' : `${n}e`) : n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

const svg = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const jersey = (fill: string, dots = false) =>
  `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M12 6 L4 12 L8 20 L11 18 L11 36 L29 36 L29 18 L32 20 L36 12 L28 6 Q20 11 12 6 Z" fill="${dots ? '#f2f2ee' : fill}" stroke="rgba(0,0,0,.35)" stroke-width="1.2"/>${dots ? '<g fill="#d63a2f"><circle cx="15" cy="16" r="2.2"/><circle cx="24" cy="14" r="2.2"/><circle cx="19" cy="24" r="2.2"/><circle cx="26" cy="27" r="2.2"/><circle cx="14" cy="30" r="2.2"/></g>' : ''}</svg>`;
const IC = {
  medal: svg('<circle cx="12" cy="15" r="5"/><path d="m9 10.8-3-7.3M15 10.8l3-7.3M9 3.5h6"/>'),
  time: svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5"/>'),
  sprint: svg('<path d="M4 18h16M6 14l4-4 3 3 5-6"/><path d="M15 7h3v3"/>'),
  climb: svg('<path d="M3 19 9.5 8l4 6 2.5-3.5L21 19z"/>'),
  power: svg('<path d="M13 2 5 13.5h6L10 22l9-12h-6.5z"/>'),
  attack: svg('<path d="M5 12h11M12 7l5 5-5 5"/><path d="M3 7v10"/>'),
  flag: svg('<path d="M5 21V4M5 4h12l-2.5 4L17 12H5"/>'),
  km: svg('<path d="M4 17h16M7 17V9M12 17V6M17 17v-5"/>'),
};

const T = {
  fr: {
    title: 'Ta course',
    titleTt: 'Ton contre-la-montre',
    place: 'Ta place',
    of: (n: number) => `sur ${n} coureurs`,
    win: 'Victoire !',
    podium: 'Sur le podium',
    behind: (gap: string, who: string) => `à ${gap} de ${who}`,
    time: 'Ton temps',
    timeDetail: 'de la ligne de départ à l’arrivée',
    green: 'Maillot vert',
    greenDetail: (f: number, s: number) => `arrivée ${f} · sprints ${s}`,
    kom: 'Maillot à pois',
    komDetail: (n: number) => (n ? `${n} sommet${n > 1 ? 's' : ''} passé${n > 1 ? 's' : ''}` : 'aucun sommet noté'),
    pts: 'pts',
    finish: 'L’arrivée',
    around: 'Autour de toi',
    all: 'Voir tout le classement',
    you: 'Toi',
    marks: 'Tes passages',
    sprintKind: 'Sprint',
    komKind: (c: number) => (c === 0 ? 'Côte hors catégorie' : `Côte de ${c}e catégorie`),
    effortFor: (d: string) => `${d} d’effort`,
    unplaced: 'Non classé',
    efforts: 'Tes efforts',
    race: 'Toute la course',
    attack: 'Ta meilleure minute',
    sprintE: 'Ton sprint final',
    sprintDetail: '10 s les plus fortes dans les 500 derniers mètres',
    lastKm: 'Le dernier kilomètre',
    ftp: (p: number) => `${p} % de ta FTP`,
    laps: 'Tes tours',
    lap: 'Tour',
    best: 'meilleur',
  },
  en: {
    title: 'Your race',
    titleTt: 'Your time trial',
    place: 'Your place',
    of: (n: number) => `out of ${n} riders`,
    win: 'Victory!',
    podium: 'On the podium',
    behind: (gap: string, who: string) => `${gap} behind ${who}`,
    time: 'Your time',
    timeDetail: 'from start line to finish',
    green: 'Green jersey',
    greenDetail: (f: number, s: number) => `finish ${f} · sprints ${s}`,
    kom: 'Polka-dot jersey',
    komDetail: (n: number) => (n ? `${n} summit${n > 1 ? 's' : ''} crossed` : 'no scored summit'),
    pts: 'pts',
    finish: 'The finish',
    around: 'Around you',
    all: 'See full standings',
    you: 'You',
    marks: 'Your scored points',
    sprintKind: 'Sprint',
    komKind: (c: number) => (c === 0 ? 'Climb, beyond category' : `Category ${c} climb`),
    effortFor: (d: string) => `${d} effort`,
    unplaced: 'Unplaced',
    efforts: 'Your efforts',
    race: 'Whole race',
    attack: 'Your best minute',
    sprintE: 'Your final sprint',
    sprintDetail: 'best 10 s in the last 500 metres',
    lastKm: 'The last kilometre',
    ftp: (p: number) => `${p}% of your FTP`,
    laps: 'Your laps',
    lap: 'Lap',
    best: 'best',
  },
};

/** Bloc commun (ui/blocks.css) : icône, nom, détail, grande valeur, état. */
function tile(o: { ico: string; name: string; detail: string; val: string; unit?: string; state?: string; tone?: 'ok' | 'info' | 'warn'; cls?: string }): string {
  return `<div class="ab-tile${o.tone ? ` is-${o.tone}` : ''}${o.cls ? ` ${o.cls}` : ''}"><span class="ab-ico sm">${o.ico}</span><span class="ab-name">${o.name}</span><span class="ab-detail">${o.detail}</span><span class="ab-val"><b>${o.val}</b>${o.unit ? `<small>${o.unit}</small>` : ''}</span>${o.state ? `<span class="ab-state"><i></i>${o.state}</span>` : ''}</div>`;
}

export function raceReportHtml(r: RaceReport, fr: boolean, ftp = 0): string {
  const S = fr ? T.fr : T.en;
  const dec = (v: number, d = 1) => (fr ? v.toFixed(d).replace('.', ',') : v.toFixed(d));
  const me = r.rows.find((x) => x.me);
  const winner = r.rows[0];
  const nearest = me && me.rank > 1 ? r.rows[me.rank - 2] : null;
  // 1. Ma course en quatre blocs.
  const placeState = me?.rank === 1 ? S.win : me && me.rank <= 3 ? S.podium : nearest && me ? S.behind(clock(me.timeS - nearest.timeS), esc(nearest.name)) : '';
  const head = [
    tile({ ico: IC.medal, name: S.place, detail: S.of(r.field), val: me ? ord(me.rank, fr) : '—', ...(placeState ? { state: placeState } : {}), ...(me && me.rank <= 3 ? { tone: 'ok' as const } : {}), cls: 'rr-hero' }),
    tile({ ico: IC.time, name: S.time, detail: S.timeDetail, val: me ? clock(me.timeS) : '—', ...(me && me.rank > 1 ? { state: `+${clock(me.gapS)}` } : {}) }),
    tile({ ico: jersey('#3fa65a'), name: S.green, detail: S.greenDetail(r.points.finish, r.points.sprint), val: `+${r.points.finish + r.points.sprint}`, unit: S.pts, cls: 'rr-green' }),
    tile({ ico: jersey('', true), name: S.kom, detail: S.komDetail(r.marks.filter((m) => m.kind === 'kom' && m.place).length), val: `+${r.points.kom}`, unit: S.pts, cls: 'rr-kom' }),
  ].join('');
  // 2. L'arrivée : podium, puis les coureurs autour de moi (deux devant, deux derrière), l'écart en barre.
  const podium = r.rows.slice(0, 3);
  const podiumHtml = `<div class="rr-podium">${[1, 0, 2]
    .map((i) => podium[i])
    .filter((x): x is RaceReport['rows'][number] => !!x)
    .map((x) => `<div class="rr-step s${x.rank}${x.me ? ' me' : ''}"><b class="rr-step-name">${x.me ? S.you : esc(x.name)}</b><small>${x.rank === 1 ? clock(x.timeS) : `+${clock(x.gapS)}`}</small><div class="rr-block">${x.rank}</div></div>`)
    .join('')}</div>`;
  const from = me ? Math.max(3, me.rank - 3) : 3;
  const around = me && me.rank > 3 ? r.rows.slice(from, Math.min(r.rows.length, me.rank + 2)) : r.rows.slice(3, 6);
  const maxGap = Math.max(1, ...r.rows.map((x) => x.gapS));
  const line = (x: RaceReport['rows'][number]) =>
    `<div class="rr-line${x.me ? ' me' : ''}"><span class="rr-pos">${x.rank}</span><span class="rr-who"><b>${x.me ? S.you : esc(x.name)}</b><small>${esc(x.team)}</small></span><span class="rr-gapbar"><i style="width:${((x.gapS / maxGap) * 100).toFixed(1)}%"></i></span><span class="rr-gap">${x.rank === 1 ? clock(x.timeS) : `+${clock(x.gapS)}`}</span></div>`;
  const finishHtml = `<section class="rr-block-sec"><h3 class="ab-section">${S.finish}</h3><div class="ab-tile ab-plain rr-finish">${podiumHtml}${
    around.length ? `<div class="rr-around">${me && me.rank > 3 ? `<h4>${S.around}</h4>` : ''}${around.map(line).join('')}</div>` : ''
  }${r.rows.length > 6 ? `<details class="rr-all"><summary class="ab-btn">${S.all} (${r.field})</summary>${r.rows.map(line).join('')}</details>` : ''}</div></section>`;
  // 3. Mes passages notés.
  const marksHtml = r.marks.length
    ? `<section class="rr-block-sec"><h3 class="ab-section">${S.marks}</h3><div class="ab-grid ab-grid-2">${r.marks
        .map((m) =>
          tile({
            ico: m.kind === 'kom' ? IC.climb : IC.sprint,
            name: esc(m.name),
            detail: `${m.kind === 'kom' ? S.komKind(m.cat ?? 4) : S.sprintKind}${m.durationS ? ` · ${S.effortFor(clock(m.durationS))}` : ''}`,
            val: m.place ? ord(m.place, fr) : '—',
            unit: m.place ? `/ ${m.of}` : S.unplaced,
            state: [m.points ? `+${m.points} ${S.pts}` : '', m.watts ? `${Math.round(m.watts)} W` : ''].filter(Boolean).join(' · '),
            ...(m.place === 1 ? { tone: 'ok' as const } : {}),
            cls: m.kind === 'kom' ? 'rr-kom' : 'rr-green',
          }),
        )
        .join('')}</div></section>`
    : '';
  // 4. Mes efforts.
  const meta = {
    race: { ico: IC.power, name: S.race },
    attack: { ico: IC.attack, name: S.attack },
    sprint: { ico: IC.flag, name: S.sprintE },
    lastKm: { ico: IC.km, name: S.lastKm },
  };
  const effortsHtml = r.efforts.length
    ? `<section class="rr-block-sec"><h3 class="ab-section">${S.efforts}</h3><div class="ab-grid ab-grid-4">${r.efforts
        .map((e) =>
          tile({
            ico: meta[e.key].ico,
            name: meta[e.key].name,
            detail: e.key === 'sprint' ? S.sprintDetail : e.key === 'attack' ? `${dec(e.wkg)} W/kg` : `${dec(e.wkg)} W/kg · ${clock(e.durationS)}`,
            val: String(Math.round(e.watts)),
            unit: 'W',
            ...(ftp > 0 ? { state: S.ftp(Math.round((e.watts / ftp) * 100)) } : {}),
          }),
        )
        .join('')}</div></section>`
    : '';
  // 5. Mes tours : barres comparées, le meilleur en jaune.
  const bestLap = r.laps.length ? Math.min(...r.laps.map((l) => l.timeS)) : 0;
  const slowLap = r.laps.length ? Math.max(...r.laps.map((l) => l.timeS)) : 0;
  const lapsHtml = r.laps.length
    ? `<section class="rr-block-sec"><h3 class="ab-section">${S.laps}</h3><div class="ab-tile ab-plain rr-laps">${r.laps
        .map((l) => {
          const w = slowLap > 0 ? 55 + 45 * (l.timeS / slowLap) : 100;
          const best = l.timeS === bestLap && bestLap < slowLap;
          return `<div class="rr-lap${best ? ' best' : ''}"><span>${S.lap} ${l.lap}</span><span class="rr-lapbar"><i style="width:${w.toFixed(1)}%"></i></span><b>${clock(l.timeS)}</b><small>${l.watts ? `${Math.round(l.watts)} W` : ''}${best ? ` · ${S.best}` : ''}</small></div>`;
        })
        .join('')}</div></section>`
    : '';
  return `<section class="rr">
    <h2 class="ab-title rr-title">${r.kind === 'tt' ? S.titleTt : S.title}</h2>
    <div class="ab-grid ab-grid-4 rr-head">${head}</div>
    ${finishHtml}
    ${marksHtml}
    ${effortsHtml}
    ${lapsHtml}
  </section>`;
}
