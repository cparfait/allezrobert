import { getLang } from '../i18n/index.ts';
import { thousands, type SummitStats } from '../game/climb.ts';
import './summit.css';

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
  const nf1 = (v: number) => (fr ? v.toFixed(1).replace('.', ',') : v.toFixed(1));
  const s = data.stats;
  const tile = (label: string, value: string, unit = '') => `<div class="smt-tile"><span>${label}</span><b class="num">${value}${unit ? `<small>${unit}</small>` : ''}</b></div>`;
  const k = s.kom;
  let komHtml = '';
  if (k) {
    const rec = k.recordS;
    const best = rec !== null && k.timeS <= rec + 0.5;
    const delta = rec === null ? '' : best ? (fr ? 'record personnel' : 'personal best') : `+${fmtTime(k.timeS - rec)} ${fr ? 'sur le record' : 'off the record'} (${fmtTime(rec)})`;
    komHtml = `<section class="smt-kom">
      <h3><span class="smt-dots" aria-hidden="true"></span>${esc(k.name)}</h3>
      <div class="smt-kom-row">
        <b class="num smt-kom-time">${fmtTime(k.timeS)}</b>
        <span class="num">${Math.round(k.avgWatts)} W · ${nf1(k.wkg)} W/kg · VAM ${thousands(k.vam, fr)} m/h</span>
      </div>
      ${delta ? `<p class="smt-rec${best ? ' best' : ''}">${delta}</p>` : ''}
    </section>`;
  }
  root.innerHTML = `<div class="smt">
    <div class="smt-card">
      <p class="smt-kicker">${fr ? 'Arrivée au sommet' : 'Summit finish'}</p>
      <h1>${esc(data.routeName)}</h1>
      <p class="smt-alt num">${thousands(data.altitudeM, fr)} m</p>
      <div class="smt-tiles">
        ${tile(fr ? 'Temps' : 'Time', fmtTime(s.timeS))}
        ${tile(fr ? 'Puissance moy.' : 'Avg power', String(Math.round(s.avgWatts)), 'W')}
        ${tile('W/kg', nf1(s.wkg))}
        ${tile('VAM', thousands(s.vam, fr), 'm/h')}
        ${tile(fr ? 'Dénivelé' : 'Climbing', thousands(s.elevationGainM, fr), 'm')}
      </div>
      ${komHtml}
      <div class="smt-actions">
        <button class="smt-btn accent" id="smt-menu">${fr ? 'Retour au menu' : 'Back to menu'}</button>
        <button class="smt-btn" id="smt-summary">${fr ? 'Bilan détaillé' : 'Full summary'}</button>
      </div>
    </div>
  </div>`;
  (root.querySelector('#smt-menu') as HTMLElement).onclick = cb.onMenu;
  (root.querySelector('#smt-summary') as HTMLElement).onclick = cb.onSummary;
}
