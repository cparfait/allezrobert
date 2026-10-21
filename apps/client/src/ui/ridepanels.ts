import { encodeActivity, buildActivity } from '@allezrobert/fit';
import { worldToWgs84, type ActivityRecord } from '@allezrobert/shared';
import { t, getLang } from '../i18n/index.ts';
import { shareCard } from './sharecard.ts';
import type { RideSession } from '../game/ride.ts';

function fmt(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

/** Construit le fichier FIT de la sortie (positions GPS reconstruites depuis le repère monde). */
export function rideToFit(ride: RideSession, opts: { name: string; massKg: number; ftp: number; originL93?: { x: number; y: number }; skipStrava: boolean }): Uint8Array {
  const records: ActivityRecord[] = ride.records.map((r) => {
    const rec = r as ActivityRecord & { x?: number; z?: number };
    const out: ActivityRecord = { ...rec };
    delete (out as { x?: number }).x;
    delete (out as { z?: number }).z;
    if (opts.originL93 && rec.x !== undefined && rec.z !== undefined) {
      const g = worldToWgs84(rec.x, rec.z, opts.originL93);
      out.lat = g.lat;
      out.lon = g.lon;
    }
    return out;
  });
  const activity = buildActivity(
    { id: `ar-${ride.startT}`, name: opts.name, subSport: 'virtualActivity', deviceName: 'Allez Robert !', riderMassKg: opts.massKg, ftpWatts: opts.ftp, skipStrava: opts.skipStrava, startT: ride.startT },
    records,
    ride.lapTimes,
  );
  return encodeActivity(activity, { productName: 'Allez Robert !' });
}

export function download(bytes: Uint8Array, filename: string, mime = 'application/octet-stream'): void {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export interface PauseCallbacks {
  onResume(): void;
  onFinish(): void;
}

export function showPause(root: HTMLElement, cb: PauseCallbacks): void {
  root.innerHTML = `<div class="pause-overlay"><div class="panel" style="padding:28px 34px;text-align:center;min-width:320px">
    <h2 style="margin:0 0 18px">${t('pause')}</h2>
    <div class="row" style="justify-content:center">
      <button class="btn primary" id="p-resume">${t('resume')}</button>
      <button class="btn" id="p-finish">${t('finish')}</button>
    </div></div></div>`;
  (root.querySelector('#p-resume') as HTMLElement).onclick = cb.onResume;
  (root.querySelector('#p-finish') as HTMLElement).onclick = cb.onFinish;
}

/** Résumé de fin de sortie : statistiques, segments, téléchargement du FIT. */
export function showSummary(root: HTMLElement, ride: RideSession, fit: () => Uint8Array, onClose: () => void, xp?: { gained: number; level: number; levelUp: boolean; unlocked: Array<{ name: { fr: string; en: string } }> }): void {
  const distKm = (ride.records.at(-1)?.distanceM ?? 0) / 1000;
  const segs = ride.segmentResults
    .map((r) => `<div class="device"><div><b>${r.seg.kind === 'kom' ? t('kom') : t('sprint')} · ${r.seg.name}</b><div class="meta">${Math.round(r.avgWatts)} W</div></div><b class="num">${fmt(r.timeS)}</b></div>`)
    .join('');
  const kcal = Math.round((ride.avgWatts() * ride.elapsedS) / 1000 / 0.24 / 4.184);
  root.innerHTML = `<div class="menu"><div class="card panel">
    <h1>${getLang() === 'fr' ? 'Bravo' : 'Well done'}, <em>Robert</em> !</h1>
    <div class="grid3" style="margin:18px 0">
      ${[
        [t('distance'), `${distKm.toFixed(2).replace('.', ',')} km`],
        [t('time'), fmt(ride.elapsedS)],
        [t('elevation'), `${Math.round(ride.elevationGainM)} m`],
        [t('avgPower'), `${Math.round(ride.avgWatts())} W`],
        [t('np'), `${Math.round(ride.normalizedPower())} W`],
        ['kcal', String(kcal)],
      ]
        .map(([k, v]) => `<div class="panel metric"><div class="label">${k}</div><div class="value num" style="font-size:28px">${v}</div></div>`)
        .join('')}
    </div>
    ${xp ? `<div class="row" style="gap:12px;margin-bottom:6px"><b class="num" style="color:var(--ar-accent);font-size:20px">+${xp.gained} XP</b><span>${getLang() === 'fr' ? 'Niveau' : 'Level'} ${xp.level}${xp.levelUp ? ' 🎉' : ''}</span>${xp.unlocked.length ? `<span class="meta" style="color:var(--ar-muted)">${getLang() === 'fr' ? 'Débloqué' : 'Unlocked'} : ${xp.unlocked.map((u) => u.name[getLang()]).join(', ')}</span>` : ''}</div>` : ''}
    ${segs ? `<h2>Segments</h2><div class="device-list">${segs}</div>` : ''}
    <div class="row" style="justify-content:flex-end;margin-top:22px">
      <button class="btn" id="s-close">${getLang() === 'fr' ? 'Retour au menu' : 'Back to menu'}</button>
      <button class="btn" id="s-card">${getLang() === 'fr' ? 'Image à partager' : 'Share image'}</button>
      ${xp ? `<button class="btn primary" id="s-fit">${t('exportFit')}</button>` : ''}
    </div>
  </div></div>`;
  const fitBtn = root.querySelector('#s-fit') as HTMLElement | null;
  if (fitBtn) fitBtn.onclick = () => {
    const d = new Date(ride.startT);
    const name = `allez-robert-${d.toISOString().slice(0, 16).replace(/[:T]/g, '-')}.fit`;
    download(fit(), name);
  };
  (root.querySelector('#s-close') as HTMLElement).onclick = onClose;
  (root.querySelector('#s-card') as HTMLElement).onclick = async () => {
    const st = JSON.parse(localStorage.getItem('ar.settings') ?? '{}') as { name?: string; ftpWatts?: number };
    const blob = await shareCard(ride, { routeName: ride.route.name, riderName: st.name ?? 'Robert', ftp: st.ftpWatts ?? 250 });
    download(new Uint8Array(await blob.arrayBuffer()), `allez-robert-${new Date(ride.startT).toISOString().slice(0, 10)}.png`, 'image/png');
  };
}
