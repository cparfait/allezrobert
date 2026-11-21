import { getLang } from '../i18n/index.ts';
import type { RideSession } from '../game/ride.ts';
import { CURVE_DURATIONS, durationLabel, POWER_ZONES, type RideHistoryEntry, type RideStats } from '../game/stats.ts';
import type { HistoryRide, RideFeedback } from '@allezrobert/shared';
import { bindFtpReport, ftpHistoryHtml, ftpProfileHtml, ftpReportView, ftpResultCardHtml, ftpTestChartSvg, ftpZonesHtml, type FtpTestReport } from './ftpTestReport.ts';
import './blocks.css';
import './summary.css';

/** Couleurs des séries (palette catégorielle validée sur fond sombre) et des zones (HUD). */
const C_RIDE = '#ffd23f';
const C_RECORD = '#3987e5';
const C_HR = '#e66767';
const C_ALT = '#64748b';
const ZONE_HEX = ['#9aa5b1', '#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#a855f7'];
const INK = '#f1f5f9';
const MUTED = '#b4bfcd';
const GRID = 'rgba(255,255,255,0.14)';

export interface SummaryData {
  ride: RideSession;
  stats: RideStats;
  routeName: string;
  ftp: number;
  massKg: number;
  /** Sortie comparable précédente (même itinéraire), ou null. */
  previous: RideHistoryEntry | null;
  /** Records de puissance d'avant la sortie (durée → W) et durées battues. */
  records: { previous: Record<number, number>; beaten: number[] };
  /** XP gagnée et niveau (absent pour un invité). */
  xp?: { gained: number; level: number; progress: number; levelUp: boolean; detail: string; unlocked: string[]; credits?: number; won?: string[] };
  /** Il y avait des équipiers, des coureurs IA ou d'autres joueurs. */
  withGroup: boolean;
  guest: boolean;
  /** Défi KOM terminé : temps, record d'avant. */
  challenge?: { name: string; timeS: number; previousS: number | null; isRecord: boolean };
  /** Trophées gagnés par cette sortie. */
  trophies?: Array<{ name: string; description: string; xp: number }>;
  /** Test FTP : le bilan parle de la FTP (résultat, choix, zones) au lieu du parcours. */
  ftpTest?: FtpTestReport;
}

export interface SummaryActions {
  onShareCard(): void;
  /** Image de la carte de sortie (copier, partager) ; absent : seul le téléchargement. */
  cardBlob?: () => Promise<Blob>;
  onFit(): void;
  onGpx(): void;
  /** Absent : la sortie ne peut pas reprendre (course terminée, multijoueur). */
  onResume?: () => void;
  onNewRide(): void;
  onQuit(): void;
  /** Panneau compte / Strava / intervals.icu rempli après coup. */
  onlineBox?: (box: HTMLElement) => void;
  /** Ressenti de la sortie, gardé dans l'historique (absent : pas de question). */
  onFeedback?: (feedback: RideFeedback) => void;
  /** Test FTP : choix fait sur le bilan (garder la nouvelle FTP ou l'ancienne). */
  onFtpDecision?: (keepNew: boolean) => void;
}

/** Icônes au trait des blocs du bilan (24 × 24, couleur du texte), dans le carré `ab-ico`. */
const svg = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC = {
  distance: svg('<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5"/>'),
  time: svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5"/>'),
  power: svg('<path d="M13 2 5 13.5h6L10 22l9-12h-6.5z"/>'),
  speed: svg('<path d="M4 17a8 8 0 1 1 16 0"/><path d="m12 17 4-6"/><circle cx="12" cy="17" r="1.3"/>'),
  level: svg('<path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-3-5.4 3 1.1-6L3.2 9.4l6.1-.8z"/>'),
  flag: svg('<path d="M5 21V4M5 4h12l-2.5 4L17 12H5"/>'),
  cup: svg('<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4"/>'),
  medal: svg('<circle cx="12" cy="15" r="5"/><path d="m9 10.8-3-7.3M15 10.8l3-7.3M9 3.5h6"/>'),
  group: svg('<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.3"/><path d="M3 19a6 6 0 0 1 12 0M15.5 14.5A4.5 4.5 0 0 1 21 19"/>'),
  camera: svg('<path d="M4 8h3l1.5-2.5h7L17 8h3v11H4z"/><circle cx="12" cy="13.5" r="3.2"/>'),
  feel: svg('<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>'),
  user: svg('<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>'),
  share: svg('<circle cx="6" cy="12" r="2.5"/><circle cx="17.5" cy="6" r="2.5"/><circle cx="17.5" cy="18" r="2.5"/><path d="m8.2 10.8 7-3.6M8.2 13.2l7 3.6"/>'),
  file: svg('<path d="M7 3h7l4 4v14H7zM14 3v4h4M12 11v6M9.5 14.5 12 17l2.5-2.5"/>'),
};
/** Entête d'un bloc annexe : icône dans son carré et nom en gras. */
const blockHead = (icon: string, title: string) => `<div class="sum-bh"><span class="ab-ico sm">${icon}</span><b class="ab-name">${title}</b></div>`;
/** Sépare « 210 W » en valeur et unité (une valeur sans unité, comme « 1:39 », reste entière). */
function splitUnit(v: string): [string, string] {
  const i = v.lastIndexOf(' ');
  return i > 0 && !/\d/.test(v.slice(i + 1)) ? [v.slice(0, i), v.slice(i + 1)] : [v, ''];
}
/** Bloc de chiffre : nom, grande valeur, détail ; avec une icône pour les quatre chiffres principaux. */
function figureBlock(label: string, value: string, sub?: string, icon?: string): string {
  const [n, u] = splitUnit(value);
  return `<div class="ab-tile sum-fig${icon ? '' : ' sum-fig-plain'}">${icon ? `<span class="ab-ico sm">${icon}</span>` : ''}<span class="ab-name">${label}</span><span class="ab-detail">${sub ? esc(sub) : ''}</span><span class="ab-val"><b>${n}</b>${u ? `<small>${u}</small>` : ''}</span></div>`;
}

const FEELINGS: Array<[RideFeedback, string, string]> = [
  ['easy', 'Facile', 'Easy'],
  ['right', 'Juste bien', 'Just right'],
  ['hard', 'Dur', 'Hard'],
  ['failed', 'Pas tenu', 'Couldn’t finish'],
];

const fr = () => getLang() === 'fr';
const num = (v: number, d = 0) => v.toFixed(d).replace('.', fr() ? ',' : '.');

function hms(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/** Écran de fin de sortie : chiffres clés, courbe de puissance et records, profil, zones, segments. */
export function showRideSummary(root: HTMLElement, d: SummaryData, a: SummaryActions): void {
  const L = fr();
  const s = d.stats;
  const prev = d.previous;
  const vs = prev ? s.avgSpeedKmh - prev.avgSpeedKmh : null;
  const vsTile: [string, string, string] = [
    L ? 'Vs dernière fois' : 'Vs last time',
    vs === null ? '—' : `${vs >= 0 ? '+' : '−'}${num(Math.abs(vs), 1)} km/h`,
    prev ? `${L ? 'le' : 'on'} ${new Date(prev.date).toLocaleDateString(L ? 'fr-FR' : 'en-GB')}` : L ? 'première fois ici' : 'first time here',
  ];
  // Deux familles : le parcours (distance, temps, allure) et l'effort (puissance, cœur, énergie).
  const course: Array<[string, string, string?]> = [
    ['Distance', `${num(s.distanceM / 1000, 2)} km`],
    [L ? 'Temps' : 'Time', hms(s.movingS)],
    [L ? 'Dénivelé +' : 'Climbing', `${Math.round(s.elevationGainM)} m`],
    [L ? 'Vitesse moy.' : 'Avg speed', `${num(s.avgSpeedKmh, 1)} km/h`, `max ${num(s.maxSpeedKmh, 1)}`],
    vsTile,
  ];
  const effort: Array<[string, string, string?]> = [
    [L ? 'Puissance moy.' : 'Avg power', `${Math.round(s.avgWatts)} W`, `${num(s.avgWatts / d.massKg, 1)} W/kg`],
    [L ? 'Normalisée' : 'Normalized', `${Math.round(s.np)} W`, `max ${Math.round(s.maxWatts)} W`],
    [L ? 'Charge (TSS) · IF' : 'Load (TSS) · IF', `${Math.round(s.tss)} · ${num(s.ifactor, 2)}`],
    [L ? 'Cardio moy.' : 'Avg HR', s.avgHr ? `${Math.round(s.avgHr)} bpm` : '— bpm', [s.maxHr ? `max ${Math.round(s.maxHr)}` : '', s.avgCadence ? `${Math.round(s.avgCadence)} tr/min` : ''].filter(Boolean).join(' · ')],
    [L ? 'Énergie' : 'Energy', `${Math.round(s.kcal)} kcal`, `${Math.round(s.workKJ)} kJ`],
  ];
  // Bilan lisible d'un coup d'œil : quatre grands chiffres, le reste sur une ligne.
  const heroTiles: Array<[string, string, string?]> = [course[0], course[1], effort[0], course[3]] as Array<[string, string, string?]>;
  const minor: Array<[string, string]> = [
    [L ? 'Dénivelé' : 'Climbing', `${Math.round(s.elevationGainM)} m`],
    [L ? 'Normalisée' : 'Normalized', `${Math.round(s.np)} W`],
    ['TSS', `${Math.round(s.tss)}`],
    ['IF', num(s.ifactor, 2)],
    ...(s.avgHr ? ([[L ? 'Cardio' : 'Heart rate', `${Math.round(s.avgHr)} bpm${s.maxHr ? ` (max ${Math.round(s.maxHr)})` : ''}`]] as Array<[string, string]>) : []),
    ...(s.avgCadence ? ([['Cadence', `${Math.round(s.avgCadence)} tr/min`]] as Array<[string, string]>) : []),
    [L ? 'Énergie' : 'Energy', `${Math.round(s.kcal)} kcal`],
    ...(vs !== null ? ([[vsTile[0], vsTile[1]]] as Array<[string, string]>) : []),
  ];
  const minorHtml = `<div class="sum-minor">${minor.map(([k, v]) => `<span>${k} <b>${v}</b></span>`).join('')}</div>`;
  const tilesHtml = (list: Array<[string, string, string?]>, icons: string[] = []) => list.map(([k, v, sub], i) => figureBlock(k, v, sub, icons[i])).join('');
  // Pastilles du résumé : ce qui compte en un coup d'œil.
  const chips: string[] = [];
  if (d.records.beaten.length) chips.push(`<span class="sum-chip gold">🏅 ${d.records.beaten.length} ${L ? (d.records.beaten.length > 1 ? 'records battus' : 'record battu') : d.records.beaten.length > 1 ? 'records beaten' : 'record beaten'}</span>`);
  if (d.xp?.levelUp) chips.push(`<span class="sum-chip gold">🎉 ${L ? 'Niveau' : 'Level'} ${d.xp.level}</span>`);
  if (d.trophies?.length) chips.push(`<span class="sum-chip gold">🏆 ${d.trophies.length} ${L ? (d.trophies.length > 1 ? 'trophées' : 'trophée') : d.trophies.length > 1 ? 'trophies' : 'trophy'}</span>`);
  const ftpT = d.ftpTest;
  const fv = ftpT ? ftpReportView(ftpT, L) : null;
  if (vs !== null && !ftpT) chips.push(`<span class="sum-chip ${vs >= 0 ? 'up' : 'down'}">${vs >= 0 ? '▲' : '▼'} ${num(Math.abs(vs), 1)} km/h ${L ? 'vs dernière fois' : 'vs last time'}</span>`);
  if (d.xp) chips.push(`<span class="sum-chip">+${d.xp.gained} XP</span>`);
  const segs = d.ride.segmentResults;
  const g = d.ride.group;
  const beaten = d.records.beaten;
  root.innerHTML = `<div class="sum">
    <header class="sum-head">
      <div class="sum-hero"><span class="sum-robert" aria-hidden="true"></span>
        <div><h1 class="ab-title">${fv ? fv.title : L ? 'Bravo, <em>belle sortie</em> !' : 'Well done, <em>great ride</em>!'}</h1><p class="ab-sub">${fv ? esc(fv.subtitle) : esc(d.routeName)}</p>
          ${chips.length ? `<div class="sum-chips">${chips.join('')}</div>` : ''}</div></div>
      <nav class="sum-actions">
        ${a.onResume ? `<button class="sum-btn ab-btn" id="s-resume">${L ? 'Reprendre' : 'Resume'}</button>` : ''}
        <button class="sum-btn accent ab-btn ab-go" id="s-new">${L ? 'Nouvelle sortie' : 'New ride'}</button>
        <button class="sum-btn ab-btn" id="s-quit">${L ? 'Quitter' : 'Quit'}</button>
      </nav>
    </header>
    <div class="sum-body">
      <aside class="sum-side">
        ${
          d.xp
            ? `<section class="sum-card sum-level">${blockHead(IC.level, `${L ? 'Niveau' : 'Level'} ${d.xp.level}${d.xp.levelUp ? ' 🎉' : ''}`)}<div class="sum-lv"><i class="sum-xp"><i style="width:${(d.xp.progress * 100).toFixed(0)}%"></i></i></div>
              <p>+${d.xp.gained} XP <span>(${esc(d.xp.detail)})</span>${d.xp.credits ? ` · <b class="sum-credits">+${d.xp.credits} ${L ? 'crédits' : 'credits'}</b>` : ''}</p>${d.xp.unlocked.length ? `<p class="sum-unlock">${L ? 'Débloqué' : 'Unlocked'} : ${d.xp.unlocked.map(esc).join(', ')}</p>` : ''}${d.xp.won?.length ? `<p class="sum-unlock">🔧 ${L ? 'Atelier' : 'Workshop'} : ${d.xp.won.map(esc).join(', ')}</p>` : ''}</section>`
            : `<section class="sum-card">${blockHead(IC.user, L ? 'Invité' : 'Guest')}<p class="sum-muted">${L ? 'Sortie hors classements, sans XP ni export.' : 'No rankings, XP or export.'}</p></section>`
        }
        ${
          d.challenge
            ? `<section class="sum-card sum-challenge">${blockHead(IC.flag, `${L ? 'Défi' : 'Challenge'} · ${esc(d.challenge.name)}`)}<span class="ab-val"><b>${hms(d.challenge.timeS)}</b></span><p>${
                d.challenge.isRecord
                  ? d.challenge.previousS === null
                    ? L ? 'Premier record établi' : 'First record set'
                    : `🏆 ${L ? 'Record battu de' : 'Record beaten by'} ${Math.round(d.challenge.previousS - d.challenge.timeS)} s`
                  : `${L ? 'Record' : 'Best'} ${hms(d.challenge.previousS as number)} (+${Math.round(d.challenge.timeS - (d.challenge.previousS as number))} s)`
              }</p></section>`
            : ''
        }
        ${
          d.trophies?.length
            ? `<section class="sum-card">${blockHead(IC.cup, L ? 'Trophées' : 'Trophies')}${d.trophies
                .map((t) => `<div class="sum-row sum-trophy"><span><b>${esc(t.name)}</b><small>${esc(t.description)}</small></span><b></b><em>+${t.xp} XP</em></div>`)
                .join('')}</section>`
            : ''
        }
        ${
          beaten.length
            ? `<section class="sum-card">${blockHead(IC.medal, L ? 'Nouveaux records' : 'New records')}${beaten
                .map((dur) => {
                  const w = s.curve.find((p) => p.durationS === dur)?.watts ?? 0;
                  return `<div class="sum-row"><span>${durationLabel(dur)}</span><b>${Math.round(w)} W</b><em>+${Math.max(1, Math.round(w - (d.records.previous[dur] ?? 0)))} W</em></div>`;
                })
                .join('')}</section>`
            : ''
        }
        ${
          d.withGroup && (g.draftS > 0 || g.pulls > 0 || g.savedJ > 0)
            ? `<section class="sum-card">${blockHead(IC.group, L ? 'En groupe' : 'In the group')}
              <div class="sum-row"><span>${L ? 'Dans les roues' : 'On a wheel'}</span><b>${hms(g.draftS)}</b></div>
              <div class="sum-row"><span>${L ? 'Énergie économisée' : 'Energy saved'}</span><b>${Math.round(g.savedJ / 1000)} kJ</b></div>
              <div class="sum-row"><span>${L ? 'Relais pris' : 'Pulls taken'}</span><b>${g.pulls}</b></div></section>`
            : ''
        }
        ${
          d.ride.summitPhotos.length
            ? `<section class="sum-card">${blockHead(IC.camera, L ? 'Photos au sommet' : 'Summit photos')}<div class="sum-photos">${d.ride.summitPhotos
                .map((src, i) => `<a href="${src}" download="allez-robert-sommet-${i + 1}.jpg" title="${L ? 'Enregistrer la photo' : 'Save the photo'}"><img src="${src}" alt="${L ? 'Photo au sommet' : 'Summit photo'} ${i + 1}" /></a>`)
                .join('')}</div></section>`
            : ''
        }
        ${
          a.onFeedback
            ? `<section class="sum-card sum-feel">${blockHead(IC.feel, L ? 'Ton ressenti' : 'How did it feel?')}<div class="sum-feel-row">${FEELINGS.map(([id, f, e]) => `<button class="sum-btn" data-feel="${id}">${L ? f : e}</button>`).join('')}</div></section>`
            : ''
        }
        ${
          localStorage.getItem('ar.skipLogin')
            ? `<section class="sum-card sum-login">${blockHead(IC.user, L ? 'Garde ta sortie' : 'Keep this ride')}<p>${L ? 'Sans compte, elle reste sur cet appareil.' : 'Without an account it stays on this device.'}</p><button class="sum-btn" id="s-login">${L ? 'Se connecter' : 'Sign in'}</button></section>`
            : ''
        }
        <section class="sum-card sum-share">
          ${blockHead(IC.share, L ? 'Carte de sortie' : 'Ride card')}
          <p class="sum-muted">${L ? 'Une image à poster.' : 'An image to post.'}</p>
          <div class="sum-share-btns"><button class="sum-btn" id="s-card">${L ? 'Enregistrer' : 'Save'}</button>${a.cardBlob ? `<button class="sum-btn" id="s-card-copy">${L ? 'Copier' : 'Copy'}</button><button class="sum-btn" id="s-card-share" hidden>${L ? 'Partager…' : 'Share…'}</button>` : ''}</div>
          <div class="sum-online" id="s-online"></div>
          <p class="sum-share-msg" id="s-share-msg" role="status"></p>
        </section>
        ${
          d.guest
            ? ''
            : `<section class="sum-card sum-files">
          ${blockHead(IC.file, L ? 'Fichiers de la sortie' : 'Ride files')}
          <p class="sum-muted">${L ? '.fit pour Strava et Garmin, .gpx pour le tracé.' : '.fit for Strava and Garmin, .gpx for the route.'}</p>
          <div class="sum-share-btns"><button class="sum-btn" id="s-fit">.fit</button><button class="sum-btn" id="s-gpx">.gpx</button></div>
        </section>`
        }
      </aside>
      <main class="sum-main${ftpT ? ' ftprep-main' : ''}">${
        ftpT && fv
          ? `
        ${ftpResultCardHtml(ftpT, L)}
        <h3 class="sum-cap">${L ? 'Le test' : 'The test'}</h3>
        <div class="sum-tiles sum-heroes">${tilesHtml(fv.tiles)}</div>
        <section class="sum-card sum-chart ftprep-chart"><h3>${L ? 'Ta puissance et la consigne' : 'Your power and the target'}</h3>${ftpTestChartSvg(ftpT, L)}</section>
        <div class="sum-charts ftprep-grid">
          ${ftpZonesHtml(ftpT, L)}
          ${ftpProfileHtml(ftpT, L)}
          ${ftpHistoryHtml(ftpT, L)}
          <section class="sum-card sum-chart"><h3>${L ? 'Cardio et puissance' : 'Heart rate and power'}</h3>
            <div class="sum-canvas tall"><canvas id="c-time"></canvas><div class="sum-tip" hidden></div></div></section>
        </div>`
          : `
        <div class="sum-tiles sum-heroes">${tilesHtml(heroTiles, [IC.distance, IC.time, IC.power, IC.speed])}</div>
        ${minorHtml}
        <div class="sum-charts">
          <section class="sum-card sum-chart"><h3>${L ? 'Courbe de puissance' : 'Power curve'}</h3>
            <div class="sum-legend"><span><i style="background:${C_RIDE}"></i>${L ? 'Cette sortie' : 'This ride'}</span><span><i class="dash" style="border-color:${C_RECORD}"></i>${L ? 'Tes records (avant)' : 'Your records (before)'}</span></div>
            <div class="sum-canvas"><canvas id="c-curve"></canvas><div class="sum-tip" hidden></div></div></section>
          <section class="sum-card sum-chart"><h3>${L ? 'Profil · puissance · cardio' : 'Profile · power · heart rate'}</h3>
            <div class="sum-canvas tall"><canvas id="c-time"></canvas><div class="sum-tip" hidden></div></div></section>
          <section class="sum-card sum-chart${segs.length ? '' : ' sum-wide'}"><h3>${L ? 'Temps par zone' : 'Time in zone'}</h3><div class="sum-zones" id="c-zones"></div></section>
          ${
            segs.length
              ? `<section class="sum-card sum-chart"><h3>${L ? 'Segments et records' : 'Segments and records'}</h3>${segs
                  .map(
                    (r) =>
                      `<div class="sum-row"><span>${r.seg.kind === 'kom' ? 'KOM' : 'Sprint'} · ${esc(r.seg.name)}</span><b>${hms(r.timeS)}</b><em>${Math.round(r.avgWatts)} W</em></div>`,
                  )
                  .join('')}</section>`
              : ''
          }
        </div>`
      }
      </main>
    </div>
  </div>`;
  const on = (id: string, f?: () => void) => {
    const el = root.querySelector(`#${id}`) as HTMLElement | null;
    if (el && f) el.onclick = f;
  };
  on('s-card', a.onShareCard);
  // Sans compte : on retire le choix mémorisé et on recharge, l'écran de connexion revient au démarrage.
  on('s-login', () => {
    localStorage.removeItem('ar.skipLogin');
    location.reload();
  });
  const msg = root.querySelector<HTMLElement>('#s-share-msg');
  const say = (t: string) => {
    if (msg) msg.textContent = t;
  };
  if (a.cardBlob) {
    const getBlob = a.cardBlob;
    const file = async () => new File([await getBlob()], 'allez-robert.png', { type: 'image/png' });
    on('s-card-copy', () => {
      void (async () => {
        try {
          if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('clipboard');
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': getBlob() })]);
          say(L ? 'Image copiée : colle-la dans ton message.' : 'Image copied: paste it in your message.');
        } catch {
          say(L ? 'Copie impossible ici : utilise « Enregistrer ».' : 'Copy not available here: use “Save”.');
        }
      })();
    });
    // Partage natif (téléphone, tablette, Windows) : seulement si le navigateur sait partager un fichier.
    const shareBtn = root.querySelector<HTMLButtonElement>('#s-card-share');
    if (shareBtn && typeof navigator.canShare === 'function' && typeof navigator.share === 'function') {
      shareBtn.hidden = false;
      shareBtn.onclick = () =>
        void (async () => {
          try {
            const f = await file();
            if (!navigator.canShare({ files: [f] })) return say(L ? 'Partage de fichier indisponible ici.' : 'File sharing not available here.');
            await navigator.share({ files: [f], title: d.routeName, text: `${d.routeName} · ${num(s.distanceM / 1000, 1)} km · Allez Robert !` });
          } catch (e) {
            if ((e as Error).name !== 'AbortError') say(L ? 'Partage impossible.' : 'Could not share.');
          }
        })();
    }
  }
  on('s-fit', a.onFit);
  on('s-gpx', a.onGpx);
  on('s-resume', a.onResume);
  on('s-new', a.onNewRide);
  on('s-quit', a.onQuit);
  root.querySelectorAll<HTMLButtonElement>('[data-feel]').forEach((b) =>
    b.addEventListener('click', () => {
      root.querySelectorAll('[data-feel]').forEach((x) => x.classList.toggle('accent', x === b));
      a.onFeedback?.(b.dataset.feel as RideFeedback);
    }),
  );
  const online = root.querySelector('#s-online') as HTMLElement;
  if (a.onlineBox) a.onlineBox(online);
  else online.closest('.sum-share')?.querySelector('.sum-online')?.remove();
  if (ftpT) {
    // Choix fait sur le bilan : la carte et les zones suivent la valeur retenue.
    bindFtpReport(root, ftpT, L, (keepNew) => a.onFtpDecision?.(keepNew));
  } else {
    drawZones(root.querySelector('#c-zones') as HTMLElement, s.zonesS, d.ftp);
    interactiveCanvas(root.querySelector('#c-curve') as HTMLCanvasElement, (ctx, w, h, hx) => drawCurve(ctx, w, h, hx, s, d.records.previous));
  }
  interactiveCanvas(root.querySelector('#c-time') as HTMLCanvasElement, (ctx, w, h, hx) => drawTimeline(ctx, w, h, hx, d.ride));
}

/**
 * Stats d'une sortie passée (clic dans l'historique) : mêmes chiffres, courbe de puissance et temps par zone que
 * l'écran de fin, à partir de la sortie gardée (le profil seconde par seconde reste dans le FIT).
 */
export function showPastRide(root: HTMLElement, r: HistoryRide, o: { massKg: number; ftp: number; onClose(): void }): void {
  const L = fr();
  const n = (v: number | null | undefined) => (v === null || v === undefined ? null : v);
  const date = new Date(r.startedAt).toLocaleDateString(L ? 'fr-FR' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const tiles: Array<[string, string, string?]> = [
    ['Distance', `${num(r.distanceM / 1000, 2)} km`],
    [L ? 'Temps' : 'Time', hms(r.movingS)],
    ['D+', `${Math.round(r.elevationM)} m`],
    [L ? 'Vitesse moy.' : 'Avg speed', n(r.avgSpeedKmh) === null ? '—' : `${num(r.avgSpeedKmh as number, 1)} km/h`],
    [L ? 'Cardio moy.' : 'Avg HR', r.avgHr ? `${Math.round(r.avgHr)} bpm` : '— bpm', r.maxHr ? `max ${Math.round(r.maxHr)}` : ''],
    [L ? 'Puissance moy.' : 'Avg power', n(r.avgWatts) === null ? '—' : `${Math.round(r.avgWatts as number)} W`, r.avgWatts ? `${num(r.avgWatts / o.massKg, 1)} W/kg` : ''],
    [L ? 'Normalisée' : 'Normalized', n(r.np) === null ? '—' : `${Math.round(r.np as number)} W`, r.maxWatts ? `max ${Math.round(r.maxWatts)} W` : ''],
    ['TSS · IF', n(r.tss) === null ? '—' : `${Math.round(r.tss as number)} · ${r.intensity === null ? '—' : num(r.intensity, 2)}`],
    [L ? 'Énergie' : 'Energy', r.workKJ ? `${Math.round(r.workKJ)} kJ` : '—', r.workKJ ? `${Math.round(r.workKJ / (4.184 * 0.24))} kcal` : ''],
    [L ? 'Cadence moy.' : 'Avg cadence', r.avgCadence ? `${Math.round(r.avgCadence)} tr/min` : '—'],
  ];
  const feel = r.feedback ? FEELINGS.find((f) => f[0] === r.feedback) : undefined;
  root.innerHTML = `<div class="sum">
    <header class="sum-head">
      <div><h1>${esc(r.name)}</h1><p>${esc(date)} · ${num(r.distanceM / 1000, 1)} km${r.workoutName ? ` · ${esc(r.workoutName)}` : ''}${feel ? ` · ${L ? feel[1] : feel[2]}` : ''}</p></div>
      <nav class="sum-actions"><button class="sum-btn accent ab-btn ab-go" id="s-close">${L ? 'Retour à l’historique' : 'Back to history'}</button></nav>
    </header>
    <main class="sum-main">
      <div class="sum-tiles sum-heroes">${tiles.map(([k, v, sub]) => figureBlock(k, v, sub)).join('')}</div>
      <div class="sum-charts">
        <section class="sum-card sum-chart"><h3>${L ? 'Courbe de puissance' : 'Power curve'}</h3>
          <div class="sum-canvas"><canvas id="c-curve"></canvas><div class="sum-tip" hidden></div></div></section>
        <section class="sum-card sum-chart"><h3>${L ? 'Temps par zone' : 'Time in zone'}</h3><div class="sum-zones" id="c-zones"></div></section>
      </div>
    </main>
  </div>`;
  (root.querySelector('#s-close') as HTMLElement).onclick = o.onClose;
  const stats = { curve: r.curve.map(([durationS, watts]) => ({ durationS, watts })) } as RideStats;
  if (r.zonesS.length) drawZones(root.querySelector('#c-zones') as HTMLElement, r.zonesS, r.ftpAtRide ?? o.ftp);
  else (root.querySelector('#c-zones') as HTMLElement).innerHTML = `<p class="sum-muted">${L ? 'Zones inconnues pour cette sortie.' : 'No zone data for this ride.'}</p>`;
  interactiveCanvas(root.querySelector('#c-curve') as HTMLCanvasElement, (ctx, w, h, hx) => drawCurve(ctx, w, h, hx, stats, {}));
}

/** Canevas net (devicePixelRatio), redessiné au survol avec la position de la souris. */
function interactiveCanvas(c: HTMLCanvasElement, draw: (ctx: CanvasRenderingContext2D, w: number, h: number, hoverX: number | null) => string | null): void {
  const box = c.parentElement as HTMLElement;
  const tip = box.querySelector('.sum-tip') as HTMLElement;
  const render = (hx: number | null) => {
    const w = box.clientWidth;
    const h = box.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const html = draw(ctx, w, h, hx);
    if (html && hx !== null) {
      tip.innerHTML = html;
      tip.hidden = false;
      tip.style.left = `${Math.min(hx + 14, w - tip.offsetWidth - 4)}px`;
    } else tip.hidden = true;
  };
  c.addEventListener('mousemove', (e) => render(e.offsetX));
  c.addEventListener('mouseleave', () => render(null));
  new ResizeObserver(() => render(null)).observe(box);
  render(null);
}

const PAD = { l: 44, r: 12, t: 10, b: 24 };

function axisText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, align: CanvasTextAlign = 'center'): void {
  ctx.fillStyle = MUTED;
  ctx.font = '11px system-ui, sans-serif';
  // Libellé centré qui déborderait du cadre : calé sur le bord.
  const half = ctx.measureText(text).width / 2;
  const w = ctx.canvas.width / (window.devicePixelRatio || 1);
  if (align === 'center' && x + half > w - 2) {
    align = 'right';
    x = w - 2;
  }
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
}

/** Courbe de puissance : abscisse logarithmique des durées, records en pointillés. */
function drawCurve(ctx: CanvasRenderingContext2D, w: number, h: number, hx: number | null, s: RideStats, records: Record<number, number>): string | null {
  const pts = s.curve;
  const durs: number[] = CURVE_DURATIONS.filter((x) => x <= Math.max(5, pts.at(-1)?.durationS ?? 5));
  const rec: Array<{ x: number; w: number }> = [];
  for (const x of durs) {
    const w = records[x];
    if (w !== undefined) rec.push({ x, w });
  }
  const maxW = Math.max(100, ...pts.map((p) => p.watts), ...rec.map((p) => p.w)) * 1.08;
  const x0 = Math.log(durs[0] ?? 1);
  const x1 = Math.log(durs[durs.length - 1] ?? 60);
  const X = (dur: number) => PAD.l + ((Math.log(dur) - x0) / Math.max(x1 - x0, 1e-6)) * (w - PAD.l - PAD.r);
  const Y = (v: number) => h - PAD.b - (v / maxW) * (h - PAD.t - PAD.b);
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  const step = maxW > 800 ? 200 : maxW > 400 ? 100 : 50;
  for (let v = step; v < maxW; v += step) {
    ctx.beginPath();
    ctx.moveTo(PAD.l, Y(v));
    ctx.lineTo(w - PAD.r, Y(v));
    ctx.stroke();
    axisText(ctx, `${v}`, PAD.l - 6, Y(v) + 4, 'right');
  }
  for (const dur of durs) if ([1, 5, 60, 300, 1200, 3600].includes(dur)) axisText(ctx, durationLabel(dur), X(dur), h - 6);
  const line = (list: Array<{ x: number; w: number }>, color: string, dash: number[]) => {
    if (list.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash(dash);
    ctx.beginPath();
    list.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.w)) : ctx.moveTo(X(p.x), Y(p.w))));
    ctx.stroke();
    ctx.setLineDash([]);
  };
  line(rec, C_RECORD, [5, 5]);
  line(
    pts.map((p) => ({ x: p.durationS, w: p.watts })),
    C_RIDE,
    [],
  );
  if (hx === null || !pts.length) return null;
  // Point le plus proche de la souris.
  let best = pts[0] as (typeof pts)[number];
  for (const p of pts) if (Math.abs(X(p.durationS) - hx) < Math.abs(X(best.durationS) - hx)) best = p;
  const bx = X(best.durationS);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.moveTo(bx, PAD.t);
  ctx.lineTo(bx, h - PAD.b);
  ctx.stroke();
  for (const [v, col] of [
    [best.watts, C_RIDE],
    [records[best.durationS], C_RECORD],
  ] as Array<[number | undefined, string]>) {
    if (v === undefined) continue;
    ctx.fillStyle = col;
    ctx.strokeStyle = '#0a0e16';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(bx, Y(v), 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  const r = records[best.durationS];
  return `<b>${durationLabel(best.durationS)}</b><span><i style="background:${C_RIDE}"></i>${Math.round(best.watts)} W</span>${r !== undefined ? `<span><i style="background:${C_RECORD}"></i>${fr() ? 'record' : 'record'} ${r} W</span>` : ''}`;
}

/**
 * Trois petits graphiques empilés sur le même axe des distances (une échelle chacun, jamais deux
 * axes sur un même graphique) : altitude, puissance lissée sur 10 s, fréquence cardiaque.
 */
function drawTimeline(ctx: CanvasRenderingContext2D, w: number, h: number, hx: number | null, ride: RideSession): string | null {
  const rec = ride.records;
  if (rec.length < 2) return null;
  const hasHr = rec.some((r) => (r.hr ?? 0) > 0);
  const lanes = hasHr ? 3 : 2;
  const gap = 10;
  const laneH = (h - PAD.b - gap * (lanes - 1)) / lanes;
  const D = (rec.at(-1)?.distanceM ?? 1) || 1;
  const X = (dm: number) => PAD.l + (dm / D) * (w - PAD.l - PAD.r);
  const smooth = rec.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let k = Math.max(0, i - 9); k <= i; k++) {
      s += rec[k]?.watts ?? 0;
      n++;
    }
    return s / n;
  });
  const series: Array<{ label: string; color: string; values: number[]; unit: string; area?: boolean }> = [
    { label: fr() ? 'Altitude' : 'Elevation', color: C_ALT, values: rec.map((r) => r.altitudeM), unit: 'm', area: true },
    { label: fr() ? 'Puissance' : 'Power', color: C_RIDE, values: smooth, unit: 'W' },
  ];
  if (hasHr) series.push({ label: fr() ? 'Cardio' : 'Heart rate', color: C_HR, values: rec.map((r) => r.hr ?? 0), unit: 'bpm' });
  let idx = -1;
  if (hx !== null) {
    const dm = ((hx - PAD.l) / (w - PAD.l - PAD.r)) * D;
    let lo = 0;
    let hi = rec.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((rec[mid]?.distanceM ?? 0) < dm) lo = mid + 1;
      else hi = mid;
    }
    idx = lo;
  }
  series.forEach((sr, k) => {
    const top = k * (laneH + gap);
    const vals = sr.values.filter((v) => v > 0 || sr.unit === 'm');
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (sr.unit !== 'm') lo = Math.min(lo, sr.unit === 'W' ? 0 : lo);
    if (hi - lo < 10) hi = lo + 10;
    const Y = (v: number) => top + laneH - 4 - ((v - lo) / (hi - lo)) * (laneH - 18);
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD.l, top + laneH);
    ctx.lineTo(w - PAD.r, top + laneH);
    ctx.stroke();
    axisText(ctx, `${Math.round(hi)}`, PAD.l - 6, top + 14, 'right');
    axisText(ctx, `${Math.round(lo)}`, PAD.l - 6, top + laneH - 2, 'right');
    ctx.fillStyle = INK;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${sr.label} (${sr.unit})`, PAD.l + 4, top + 12);
    ctx.beginPath();
    rec.forEach((r, i) => {
      const v = sr.values[i] as number;
      if (i) ctx.lineTo(X(r.distanceM), Y(v));
      else ctx.moveTo(X(r.distanceM), Y(v));
    });
    if (sr.area) {
      ctx.lineTo(X(D), top + laneH);
      ctx.lineTo(X(0), top + laneH);
      ctx.closePath();
      ctx.fillStyle = 'rgba(100,116,139,0.45)';
      ctx.fill();
    } else {
      ctx.strokeStyle = sr.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      // Voile sous la courbe, de la couleur de la série.
      ctx.lineTo(X(D), top + laneH);
      ctx.lineTo(X(0), top + laneH);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, top, 0, top + laneH);
      grad.addColorStop(0, `${sr.color}55`);
      grad.addColorStop(1, `${sr.color}05`);
      ctx.fillStyle = grad;
      ctx.fill();
    }
    if (idx >= 0) {
      const r = rec[idx] as (typeof rec)[number];
      ctx.fillStyle = sr.area ? INK : sr.color;
      ctx.strokeStyle = '#0a0e16';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(X(r.distanceM), Y(sr.values[idx] as number), 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  });
  for (let km = 0; km <= D / 1000; km += D > 20000 ? 5 : D > 6000 ? 2 : 1) axisText(ctx, `${km} km`, X(km * 1000), h - 6);
  if (idx < 0) return null;
  const r = rec[idx] as (typeof rec)[number];
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(X(r.distanceM), 0);
  ctx.lineTo(X(r.distanceM), h - PAD.b);
  ctx.stroke();
  return `<b>${num(r.distanceM / 1000, 2)} km</b><span><i style="background:${C_ALT}"></i>${Math.round(r.altitudeM)} m</span><span><i style="background:${C_RIDE}"></i>${Math.round(smooth[idx] ?? 0)} W</span>${hasHr ? `<span><i style="background:${C_HR}"></i>${r.hr ?? '—'} bpm</span>` : ''}`;
}

/** Barres horizontales Z1–Z7 (couleurs des zones du HUD), temps et part de la sortie. */
function drawZones(box: HTMLElement, zonesS: number[], ftp: number): void {
  const total = zonesS.reduce((a, b) => a + b, 0) || 1;
  const bounds = [0, ...POWER_ZONES.map((z) => Math.round(z * ftp))];
  const range = (i: number): string => {
    const lo = bounds[i] as number;
    const hi = bounds[i + 1];
    return hi === undefined ? `> ${lo} W` : `${lo}–${hi} W`;
  };
  const used = zonesS.map((sec, i) => ({ sec, i })).filter((z) => z.sec > 0);
  // Une seule barre, découpée selon le temps passé ; la légende ne cite que les zones réellement tenues.
  box.innerHTML = `<div class="sum-zstack">${used.map((z) => `<i title="Z${z.i + 1} · ${range(z.i)}" style="flex:${z.sec};background:${ZONE_HEX[z.i]}"></i>`).join('')}</div>
    <div class="sum-zlegend">${used
      .map((z) => `<span title="${range(z.i)}"><i style="background:${ZONE_HEX[z.i]}"></i>Z${z.i + 1} <b>${hms(z.sec)}</b> <em>${Math.round((z.sec / total) * 100)} %</em></span>`)
      .join('')}</div>`;
}
