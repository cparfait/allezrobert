import { getLang, strings } from '../i18n/index.ts';
import { thousands, type SummitStats } from '../game/climb.ts';
import './blocks.css';
import './summit.css';

/** Textes du module (français, anglais). */
const S = strings(
  {
    personalBest: 'record personnel',
    offTheRecord: 'sur le record',
    summitFinish: 'Arrivée au sommet',
    time: 'Temps',
    avgPower: 'Puissance moy.',
    climbing: 'Dénivelé',
    backToMenu: 'Retour au menu',
    fullSummary: 'Bilan détaillé',
    dec: ',',
  },
  {
    personalBest: 'personal best',
    offTheRecord: 'off the record',
    summitFinish: 'Summit finish',
    time: 'Time',
    avgPower: 'Avg power',
    climbing: 'Climbing',
    backToMenu: 'Back to menu',
    fullSummary: 'Full summary',
    dec: '.',
  },
);

export interface SummitCallbacks {
  /** Bilan complet de la sortie (graphiques, records, fichiers FIT / GPX). */
  onSummary: () => void;
  /** Retour au menu (la sortie est comptée comme à la fin normale). */
  onMenu: () => void;
}

function fmtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

/**
 * Arrivée au sommet d'un itinéraire aller simple : temps, puissance moyenne, W/kg, VAM et chrono
 * de la montée (avec le record), par-dessus la scène figée ; puis bilan complet ou retour au menu.
 */
export function showSummit(root: HTMLElement, data: { routeName: string; altitudeM: number; stats: SummitStats }, cb: SummitCallbacks): void {
  const fr = getLang() === 'fr';
  const nf1 = (v: number) => v.toFixed(1).replace('.', S('dec'));
  const s = data.stats;
  const tile = (label: string, value: string, unit = '') => `<div class="ab-tile ab-plain smt-tile"><span class="ab-detail">${label}</span><span class="ab-val"><b>${value}</b>${unit ? `<small>${unit}</small>` : ''}</span></div>`;
  const k = s.kom;
  let komHtml = '';
  if (k) {
    const rec = k.recordS;
    const best = rec !== null && k.timeS <= rec + 0.5;
    const delta = rec === null ? '' : best ? (S('personalBest')) : `+${fmtTime(k.timeS - rec)} ${S('offTheRecord')} (${fmtTime(rec)})`;
    komHtml = `<section class="smt-kom">
      <h3 class="ab-section"><span class="smt-dots" aria-hidden="true"></span>${esc(k.name)}</h3>
      <div class="smt-kom-row">
        <b class="num smt-kom-time">${fmtTime(k.timeS)}</b>
        <span class="num">${Math.round(k.avgWatts)} W · ${nf1(k.wkg)} W/kg · VAM ${thousands(k.vam, fr)} m/h</span>
      </div>
      ${delta ? `<p class="smt-rec${best ? ' best' : ''}">${delta}</p>` : ''}
    </section>`;
  }
  root.innerHTML = `<div class="smt">
    <div class="smt-card">
      <p class="smt-kicker">${S('summitFinish')}</p>
      <h1 class="ab-title">${esc(data.routeName)}</h1>
      <p class="smt-alt num">${thousands(data.altitudeM, fr)} m</p>
      <div class="smt-tiles">
        ${tile(S('time'), fmtTime(s.timeS))}
        ${tile(S('avgPower'), String(Math.round(s.avgWatts)), 'W')}
        ${tile('W/kg', nf1(s.wkg))}
        ${tile('VAM', thousands(s.vam, fr), 'm/h')}
        ${tile(S('climbing'), thousands(s.elevationGainM, fr), 'm')}
      </div>
      ${komHtml}
      <div class="smt-actions">
        <button class="smt-btn accent ab-btn ab-go" id="smt-menu">${S('backToMenu')}</button>
        <button class="smt-btn ab-btn" id="smt-summary">${S('fullSummary')}</button>
      </div>
    </div>
  </div>`;
  (root.querySelector('#smt-menu') as HTMLElement).onclick = cb.onMenu;
  (root.querySelector('#smt-summary') as HTMLElement).onclick = cb.onSummary;
}
