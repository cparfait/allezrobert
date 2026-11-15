/**
 * Écran de fin du test FTP : ancienne et nouvelle FTP, écart, W/kg, et le choix du coureur
 * (« Garder la nouvelle » ou « Garder l'ancienne »). Rien n'est enregistré sans ce choix.
 */
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

/** Textes de l'écran (sans DOM, pour les tests). */
export function ftpResultView(i: FtpResultInput): FtpResultView {
  const { fr } = i;
  const delta = i.newFtp - i.oldFtp;
  const pct = i.oldFtp > 0 ? (delta / i.oldFtp) * 100 : 0;
  const trend: 1 | -1 | 0 = delta > 0 ? 1 : delta < 0 ? -1 : 0;
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±';
  const reason =
    i.end === 'failed'
      ? fr
        ? 'Palier non tenu pendant 15 secondes : fin du test.'
        : 'Step not held for 15 seconds: test over.'
      : i.end === 'quit'
        ? fr
          ? 'Test arrêté en cours de route : résultat calculé sur l’effort réalisé.'
          : 'Test stopped early: result based on the effort done.'
        : fr
          ? 'Test terminé.'
          : 'Test complete.';
  const basisText = i.basis
    ? i.basis.kind === 'bestMinute'
      ? fr
        ? `75 % de ta meilleure minute (${i.basis.watts} W)`
        : `75% of your best minute (${i.basis.watts} W)`
      : fr
        ? `95 % de ta moyenne sur 20 minutes (${i.basis.watts} W)`
        : `95% of your 20-minute average (${i.basis.watts} W)`
    : '';
  return {
    title: fr ? 'Nouvelle FTP estimée' : 'New FTP estimate',
    reason,
    oldText: `${Math.round(i.oldFtp)} W`,
    newText: `${Math.round(i.newFtp)} W`,
    deltaText: `${sign}${Math.abs(Math.round(delta))} W (${sign}${num(Math.abs(pct), 1, fr)} %)`,
    trend,
    wkgText: i.massKg > 0 ? `${num(i.newFtp / i.massKg, 2, fr)} W/kg` : '',
    basisText,
    keepNew: fr ? 'Garder la nouvelle FTP' : 'Keep the new FTP',
    keepOld: fr ? 'Garder l’ancienne' : 'Keep the old one',
  };
}

const STYLE_ID = 'ftp-result-style';
const CSS = `
.ftpr-back{position:fixed;inset:0;z-index:9000;display:grid;place-items:center;padding:16px;background:rgba(5,8,14,.55);backdrop-filter:blur(3px)}
.ftpr{width:min(440px,100%);display:flex;flex-direction:column;gap:14px;padding:22px 22px 18px;border-radius:20px;color:#f5f7fa;font:14px/1.4 system-ui,"Segoe UI",sans-serif;background:radial-gradient(120% 90% at 0% 0%,rgba(192,132,252,.22),transparent 60%),linear-gradient(180deg,rgba(24,33,50,.98),rgba(12,17,27,.98));border:1px solid rgba(255,255,255,.12);border-top:3px solid #c084fc;box-shadow:0 24px 60px rgba(0,0,0,.5)}
.ftpr h2{margin:0;font-size:22px;font-weight:900;letter-spacing:-.01em}
.ftpr p{margin:0;color:#cbd5e1}
.ftpr-cmp{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:10px}
.ftpr-cmp div{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:14px;background:rgba(0,0,0,.25)}
.ftpr-cmp small{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#b9c4d3;font-weight:700}
.ftpr-cmp b{font-size:26px;font-weight:900;font-variant-numeric:tabular-nums}
.ftpr-cmp .new b{color:#ffd23f}
.ftpr-cmp i{font-style:normal;font-size:20px;color:#8d98a6}
.ftpr-delta{display:flex;flex-wrap:wrap;gap:8px 14px;font-weight:800;font-variant-numeric:tabular-nums}
.ftpr-delta .up{color:#86efac}.ftpr-delta .down{color:#fca5a5}.ftpr-delta .eq{color:#cbd5e1}
.ftpr small.basis{color:#9aa6b5;font-size:12px}
.ftpr-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:4px}
.ftpr-actions button{appearance:none;border-radius:12px;padding:11px 16px;font:800 14px inherit;cursor:pointer}
.ftpr-keep-old{border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:#f5f7fa}
.ftpr-keep-new{border:0;background:#ffd23f;color:#0a0e16;box-shadow:0 8px 22px rgba(255,210,63,.3)}
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
  const trendCls = v.trend > 0 ? 'up' : v.trend < 0 ? 'down' : 'eq';
  back.innerHTML = `<div class="ftpr" role="dialog" aria-modal="true" aria-labelledby="ftpr-title">
    <h2 id="ftpr-title">${v.title}</h2>
    <p>${v.reason}</p>
    <div class="ftpr-cmp"><div><small>${i.fr ? 'Ancienne' : 'Old'}</small><b>${v.oldText}</b></div><i>→</i><div class="new"><small>${i.fr ? 'Nouvelle' : 'New'}</small><b>${v.newText}</b></div></div>
    <div class="ftpr-delta"><span class="${trendCls}">${v.deltaText}</span>${v.wkgText ? `<span>${v.wkgText}</span>` : ''}</div>
    ${v.basisText ? `<small class="basis">${v.basisText}</small>` : ''}
    <div class="ftpr-actions"><button type="button" class="ftpr-keep-old">${v.keepOld}</button><button type="button" class="ftpr-keep-new">${v.keepNew}</button></div>
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
