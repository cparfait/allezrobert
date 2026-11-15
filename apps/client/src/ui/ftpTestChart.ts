/**
 * Graphique du protocole de test FTP choisi (encart du menu) : consigne en watts au fil du temps, colorée par zone
 * d'après la FTP actuelle, effort libre du test 20 min en hachures, et pour la rampe la fin probable (le palier dont
 * 75 % égale la FTP actuelle). Les données viennent des protocoles du jeu (`ftpTestWorkout`).
 */
import { ftpTestWorkout, stepTargetWatts, type FtpTestProtocol } from '@allezrobert/physics';

export interface FtpChartSeg {
  /** Début et durée (s). */
  t0: number;
  d: number;
  /** Consigne au début et à la fin (W) ; l'effort libre n'a pas de consigne (`free`). */
  a: number;
  b: number;
  free: boolean;
}

export interface FtpChartProfile {
  segs: FtpChartSeg[];
  totalS: number;
  /** Partie dessinée (s) : la rampe s'arrête 5 min après la fin probable. */
  shownS: number;
  /** Rampe : fin probable (s) et palier correspondant (W) ; null pour le test 20 min ou si aucun palier n'y arrive. */
  probableEndS: number | null;
  probableStepW: number | null;
}

/** Repère visuel de l'effort libre : un peu au-dessus de la FTP (allure d'un effort de 20 minutes). */
const FREE_LEVEL = 1.05;

/** Profil du protocole pour la FTP donnée. */
export function ftpTestProfile(p: FtpTestProtocol, ftp: number): FtpChartProfile {
  const w = ftpTestWorkout(p);
  const segs: FtpChartSeg[] = [];
  let t = 0;
  for (const s of w.steps) {
    const a = stepTargetWatts(s, 0, ftp);
    const b = stepTargetWatts(s, 1, ftp);
    const free = a === null || b === null;
    segs.push({ t0: t, d: s.durationS, a: free ? ftp * FREE_LEVEL : a, b: free ? ftp * FREE_LEVEL : b, free });
    t += s.durationS;
  }
  const totalS = t;
  let probableEndS: number | null = null;
  let probableStepW: number | null = null;
  if (p !== 'ftp20') {
    // Rampe : FTP = 75 % de la meilleure minute → le test s'arrête vers le palier de FTP / 0,75.
    const need = ftp / 0.75;
    const step = segs.find((s, i) => i > 0 && s.a >= need - 1e-6);
    if (step) {
      probableEndS = step.t0 + step.d;
      probableStepW = Math.round(step.a);
    }
  }
  const shownS = probableEndS === null ? totalS : Math.min(totalS, probableEndS + 300);
  return { segs, totalS, shownS, probableEndS, probableStepW };
}

const ZONES = [0.55, 0.75, 0.9, 1.05, 1.2, 1.5];
const ZONE_HEX = ['#9aa5b1', '#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#a855f7'];
const zoneColor = (w: number, ftp: number): string => {
  const i = ZONES.findIndex((z) => w / Math.max(ftp, 1) < z);
  return ZONE_HEX[i === -1 ? 6 : i] as string;
};

const fmtMin = (s: number): string => {
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`;
};

/** Graphique HTML (SVG et repères) du protocole, prêt à insérer dans l'encart du test. */
export function ftpTestChartHtml(p: FtpTestProtocol, ftpWatts: number, fr: boolean): string {
  const ftp = Math.max(50, Math.round(ftpWatts));
  const prof = ftpTestProfile(p, ftp);
  const W = 600;
  const H = 150;
  const shown = prof.segs.filter((s) => s.t0 < prof.shownS);
  const maxW = Math.max(...shown.map((s) => Math.max(s.a, s.b)), ftp) * 1.12;
  const x = (t: number) => (Math.min(t, prof.shownS) / prof.shownS) * W;
  const y = (w: number) => H - (w / maxW) * H;
  const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(2)}%`;
  const shapes = shown
    .map((s) => {
      const x0 = x(s.t0);
      const x1 = x(s.t0 + s.d);
      // Fin de segment coupée à la partie dessinée : la consigne est interpolée.
      const cut = s.t0 + s.d > prof.shownS ? (prof.shownS - s.t0) / s.d : 1;
      const bEnd = s.a + (s.b - s.a) * cut;
      const gap = x1 - x0 > 3 ? 0.6 : 0;
      const pts = `${(x0 + gap).toFixed(1)},${H} ${(x0 + gap).toFixed(1)},${y(s.a).toFixed(1)} ${(x1 - gap).toFixed(1)},${y(bEnd).toFixed(1)} ${(x1 - gap).toFixed(1)},${H}`;
      return s.free
        ? `<polygon points="${pts}" fill="url(#ftpc-hatch)" stroke="#9aa5b1" stroke-width="1" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>`
        : `<polygon points="${pts}" fill="${zoneColor((s.a + bEnd) / 2, ftp)}"/>`;
    })
    .join('');
  const ftpY = y(ftp);
  const endX = prof.probableEndS === null ? null : x(prof.probableEndS);
  const tick = prof.shownS > 3600 ? 900 : prof.shownS > 1500 ? 600 : 300;
  const ticks: string[] = [];
  for (let t = tick; t < prof.shownS - tick / 3; t += tick) ticks.push(`<span style="position:absolute;left:${pct(t, prof.shownS)};transform:translateX(-50%)">${fmtMin(t)}</span>`);
  const free = prof.segs.find((s) => s.free);
  const caption =
    p === 'ftp20'
      ? fr
        ? `Durée totale ${fmtMin(prof.totalS)} · les 20 minutes libres (hachures) se font à ton allure ; la ligne jaune est ta FTP actuelle (${ftp} W).`
        : `Total ${fmtMin(prof.totalS)} · the 20 free minutes (hatched) are at your own pace; the yellow line is your current FTP (${ftp} W).`
      : prof.probableEndS !== null
        ? fr
          ? `Avec ta FTP actuelle (${ftp} W), le test devrait s’arrêter vers ${fmtMin(prof.probableEndS)}, au palier de ${prof.probableStepW} W (75 % de ${prof.probableStepW} W ≈ ${ftp} W).`
          : `With your current FTP (${ftp} W), the test should end around ${fmtMin(prof.probableEndS)}, at the ${prof.probableStepW} W step (75% of ${prof.probableStepW} W ≈ ${ftp} W).`
        : fr
          ? `Ta FTP actuelle (${ftp} W) dépasse les paliers de ce protocole : choisis la rampe standard.`
          : `Your current FTP (${ftp} W) is beyond this protocol's steps: choose the standard ramp.`;
  return `<figure class="ftpc" style="margin:4px 0 12px">
    <div style="position:relative;padding-bottom:18px">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true" style="display:block;width:100%;height:140px;border-radius:10px;background:rgba(0,0,0,.25)">
        <defs><pattern id="ftpc-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="rgba(154,165,177,.12)"/><line x1="0" y1="0" x2="0" y2="8" stroke="rgba(154,165,177,.55)" stroke-width="3"/></pattern></defs>
        ${shapes}
        <line x1="0" x2="${W}" y1="${ftpY.toFixed(1)}" y2="${ftpY.toFixed(1)}" stroke="#ffd23f" stroke-width="1.5" stroke-dasharray="6 4" vector-effect="non-scaling-stroke"/>
        ${endX === null ? '' : `<line x1="${endX.toFixed(1)}" x2="${endX.toFixed(1)}" y1="0" y2="${H}" stroke="#ef4444" stroke-width="2" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>`}
      </svg>
      <span style="position:absolute;left:6px;top:${Math.max(2, Math.round((ftpY / H) * 140 - 16))}px;font-size:11px;font-weight:700;color:#ffd23f">FTP ${ftp} W</span>
      ${endX === null ? '' : `<span style="position:absolute;top:4px;left:${pct(endX, W)};transform:translateX(${(endX ?? 0) > W * 0.7 ? 'calc(-100% - 6px)' : '6px'});font-size:11px;font-weight:700;color:#fca5a5;white-space:nowrap">${fr ? 'fin probable' : 'likely end'}</span>`}
      ${free ? `<span style="position:absolute;top:4px;left:${pct(x(free.t0 + free.d / 2), W)};transform:translateX(-50%);font-size:11px;font-weight:700;color:#cbd5e1;white-space:nowrap">${fr ? '20 min libres' : '20 free min'}</span>` : ''}
      <div style="position:absolute;left:0;right:0;bottom:0;height:16px;font-size:11px;color:#aab4c2">${ticks.join('')}</div>
    </div>
    <figcaption class="mm-hint" style="margin-top:4px">${caption}</figcaption>
  </figure>`;
}
