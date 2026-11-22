/**
 * Écran de fin du test FTP : ancienne et nouvelle FTP, écart, W/kg, et le choix du coureur
 * (« Garder la nouvelle » ou « Garder l'ancienne »). Rien n'est enregistré sans ce choix.
 */
import './blocks.css';
import type { FtpTestEnd } from '../game/workout.ts';

export interface FtpResultInput {
  fr: boolean;
  oldFtp: number;
  newFtp: number;
  massKg: number;
  end: FtpTestEnd;
  /** Rampe : meilleure minute ; 20 min : moyenne des 20 minutes (W), si connue. */
  basis?: { kind: 'bestMinute' | 'average20'; watts: number };
}

export interface FtpResultView {
  title: string;
  reason: string;
  oldText: string;
  newText: string;
  deltaText: string;
  /** +1 hausse, −1 baisse, 0 égale. */
  trend: 1 | -1 | 0;
  wkgText: string;
  basisText: string;
  keepNew: string;
  keepOld: string;
}

const num = (v: number, d: number, fr: boolean) => v.toFixed(d).replace('.', fr ? ',' : '.');

/**
 * Textes de l'écran. La langue vient de l'entrée (`fr`), pas de la langue du jeu : l'écran et ses tests
 * choisissent la langue eux-mêmes ; d'où ce dictionnaire à deux colonnes plutôt que `strings()`.
 */
const FR = {
  failed: 'Palier non tenu pendant 15 secondes : fin du test.',
  quit: 'Test arrêté en cours de route : résultat calculé sur l’effort réalisé.',
  completed: 'Test terminé.',
  bestMinute: '75 % de ta meilleure minute ({w} W)',
  average20: '95 % de ta moyenne sur 20 minutes ({w} W)',
  title: 'Nouvelle FTP estimée',
  keepNew: 'Garder la nouvelle FTP',
  keepOld: 'Garder l’ancienne',
  old: 'Ancienne',
  oldDetail: 'Ta FTP avant le test',
  new: 'Nouvelle',
  newDetail: 'Estimée par ce test',
  up: 'En hausse',
  down: 'En baisse',
  same: 'Inchangée',
  method: 'Calcul : {basis}',
  nothingSaved: 'Rien n’est enregistré sans ton choix.',
} as const;
const EN: { readonly [K in keyof typeof FR]: string } = {
  failed: 'Step not held for 15 seconds: test over.',
  quit: 'Test stopped early: result based on the effort done.',
  completed: 'Test complete.',
  bestMinute: '75% of your best minute ({w} W)',
  average20: '95% of your 20-minute average ({w} W)',
  title: 'New FTP estimate',
  keepNew: 'Keep the new FTP',
  keepOld: 'Keep the old one',
  old: 'Old',
  oldDetail: 'Your FTP before the test',
  new: 'New',
  newDetail: 'Estimated by this test',
  up: 'Up',
  down: 'Down',
  same: 'Unchanged',
  method: 'Method: {basis}',
  nothingSaved: 'Nothing is saved until you choose.',
};
export const ftpResultText = (fr: boolean): { readonly [K in keyof typeof FR]: string } => (fr ? FR : EN);

/** Textes de l'écran (sans DOM, pour les tests). */
export function ftpResultView(i: FtpResultInput): FtpResultView {
  const { fr } = i;
  const D = ftpResultText(fr);
  const delta = i.newFtp - i.oldFtp;
  const pct = i.oldFtp > 0 ? (delta / i.oldFtp) * 100 : 0;
  const trend: 1 | -1 | 0 = delta > 0 ? 1 : delta < 0 ? -1 : 0;
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±';
  const reason = i.end === 'failed' ? D.failed : i.end === 'quit' ? D.quit : D.completed;
  const basisText = i.basis ? (i.basis.kind === 'bestMinute' ? D.bestMinute : D.average20).replace('{w}', String(i.basis.watts)) : '';
  return {
    title: D.title,
    reason,
    oldText: `${Math.round(i.oldFtp)} W`,
    newText: `${Math.round(i.newFtp)} W`,
    deltaText: `${sign}${Math.abs(Math.round(delta))} W (${sign}${num(Math.abs(pct), 1, fr)} %)`,
    trend,
    wkgText: i.massKg > 0 ? `${num(i.newFtp / i.massKg, 2, fr)} W/kg` : '',
    basisText,
    keepNew: D.keepNew,
    keepOld: D.keepOld,
  };
}

const STYLE_ID = 'ftp-result-style';
// Mise en page de la fenêtre seulement : titres, blocs et boutons viennent de blocks.css.
const CSS = `
.ftpr-back{position:fixed;inset:0;z-index:9000;display:grid;place-items:center;padding:16px;background:rgba(5,8,14,.55);backdrop-filter:blur(3px)}
.ftpr{width:min(560px,100%);display:flex;flex-direction:column;gap:16px;padding:24px 24px 18px;border-radius:26px;color:#f5f7fa;font:15px/1.4 var(--font,system-ui),sans-serif;background:linear-gradient(180deg,rgba(24,33,50,.98),rgba(12,17,27,.98));border:2px solid rgba(255,255,255,.12);box-shadow:0 24px 60px rgba(0,0,0,.5)}
.ftpr .ab-grid-2{display:grid}
.ftpr .ab-tile{grid-template-columns:1fr;grid-template-areas:'name' 'detail' 'val' 'state';padding:16px 18px 14px}
.ftpr-basis{margin:0;font-size:14px;color:#c3cddb}
.ftpr-basis small{display:block;margin-top:2px;font-size:12px;color:#9aa6b5}
@media (max-width:420px){.ftpr .ab-grid-2{grid-template-columns:1fr}}
`;

/**
 * Affiche l'écran au-dessus du jeu ; `onDecision(true)` = garder la nouvelle FTP. Renvoie une
 * fonction qui ferme l'écran sans décision (la FTP n'est alors pas changée).
 */
export function showFtpResult(i: FtpResultInput, onDecision: (keepNew: boolean) => void, host: HTMLElement = document.body): () => void {
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const v = ftpResultView(i);
  const back = document.createElement('div');
  back.className = 'ftpr-back';
  const D = ftpResultText(i.fr);
  const tone = v.trend > 0 ? 'is-ok' : v.trend < 0 ? 'is-bad' : 'is-info';
  const trendWord = v.trend > 0 ? D.up : v.trend < 0 ? D.down : D.same;
  back.innerHTML = `<div class="ftpr" role="dialog" aria-modal="true" aria-labelledby="ftpr-title">
    <header><h2 class="ab-title" id="ftpr-title">${v.title}</h2><p class="ab-sub">${v.reason}</p></header>
    <div class="ab-grid ab-grid-2">
      <div class="ab-tile"><span class="ab-name">${D.old}</span><span class="ab-detail">${D.oldDetail}</span><span class="ab-val"><b>${v.oldText.replace(' W', '')}</b><small>W</small></span></div>
      <div class="ab-tile ${tone}"><span class="ab-name">${D.new}</span><span class="ab-detail">${D.newDetail}</span><span class="ab-val"><b>${v.newText.replace(' W', '')}</b><small>W</small></span><span class="ab-state"><i></i>${trendWord} · ${v.deltaText}</span></div>
    </div>
    <p class="ftpr-basis">${v.wkgText ? `<b>${v.wkgText}</b>` : ''}${v.wkgText && v.basisText ? ' · ' : ''}${v.basisText ? D.method.replace('{basis}', v.basisText) : ''}<small>${D.nothingSaved}</small></p>
    <div class="ab-foot"><div class="ab-btns"><button type="button" class="ab-btn ftpr-keep-old">${v.keepOld}</button><button type="button" class="ab-btn ab-go ftpr-keep-new">${v.keepNew}</button></div></div>
  </div>`;
  let done = false;
  const close = () => {
    done = true;
    back.remove();
  };
  const decide = (keepNew: boolean) => {
    if (done) return;
    close();
    onDecision(keepNew);
  };
  (back.querySelector('.ftpr-keep-new') as HTMLButtonElement).addEventListener('click', () => decide(true));
  (back.querySelector('.ftpr-keep-old') as HTMLButtonElement).addEventListener('click', () => decide(false));
  // Les touches du jeu (flèches, espace…) ne passent pas à travers la fenêtre.
  back.addEventListener('keydown', (e) => e.stopPropagation());
  host.appendChild(back);
  (back.querySelector('.ftpr-keep-new') as HTMLButtonElement).focus();
  return () => {
    if (!done) close();
  };
}
