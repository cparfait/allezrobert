import { encodeActivity, buildActivity } from '@allezrobert/fit';
import { worldToWgs84, type ActivityRecord } from '@allezrobert/shared';
import { t, getLang } from '../i18n/index.ts';
import { shareCard } from './sharecard.ts';
import { SummaryVideoPanel } from './summaryvideo.ts';
import { apiBase, fetchMe } from './account.ts';
import { renderRideInvite } from './friends.ts';
import type { RideSession } from '../game/ride.ts';
import { renderSoundSettings } from './soundSettings.ts';

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
  /** Libellé du bouton de fin (ex. « Abandonner la course »). */
  finishLabel?: string;
  /** Sortie de groupe en cours : la pause propose d'y inviter des amis. */
  roomId?: string;
}

export function showPause(root: HTMLElement, cb: PauseCallbacks): void {
  root.innerHTML = `<div class="pause-overlay"><div class="panel" style="padding:28px 34px;text-align:center;min-width:320px;max-width:min(720px,92vw)">
    <h2 style="margin:0 0 18px">${t('pause')}</h2>
    <div class="row" style="justify-content:center">
      <button class="btn primary" id="p-resume">${t('resume')}</button>
      <button class="btn" id="p-finish">${cb.finishLabel ?? t('finish')}</button>
    </div><div id="p-friends"></div>
    <div id="p-sound" style="margin-top:18px;text-align:left"></div></div></div>`;
  renderSoundSettings(root.querySelector('#p-sound'));
  (root.querySelector('#p-resume') as HTMLElement).onclick = cb.onResume;
  (root.querySelector('#p-finish') as HTMLElement).onclick = cb.onFinish;
  if (cb.roomId) void renderRideInvite(root.querySelector('#p-friends') as HTMLElement, cb.roomId);
}

/** Résumé de fin de sortie : statistiques, segments, téléchargement du FIT. */
export function showSummary(
  root: HTMLElement,
  ride: RideSession,
  fit: () => Uint8Array,
  onClose: () => void,
  xp?: { gained: number; level: number; levelUp: boolean; unlocked: Array<{ name: { fr: string; en: string } }> },
  /** Course en ligne : tableau des résultats (déjà échappé). */
  raceHtml = '',
): void {
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
    ${raceHtml}
    ${segs ? `<h2>Segments</h2><div class="device-list">${segs}</div>` : ''}
    <div id="s-video"></div>
    <div id="s-online"></div>
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
  // Vidéo résumé : MP4 rendu sur le serveur (sortie enregistrée), sinon résumé animé dans le navigateur.
  const riderName = (JSON.parse(localStorage.getItem('ar.settings') ?? '{}') as { name?: string }).name ?? 'Robert';
  const video = new SummaryVideoPanel(root.querySelector('#s-video') as HTMLElement, ride, riderName);
  if (xp) void onlinePanel(root.querySelector('#s-online') as HTMLElement, ride, fit, video);
  (root.querySelector('#s-card') as HTMLElement).onclick = async () => {
    const st = JSON.parse(localStorage.getItem('ar.settings') ?? '{}') as { name?: string; ftpWatts?: number };
    const photo = ride.summitPhotos[0];
    const blob = await shareCard(ride, { routeName: ride.route.name, riderName: st.name ?? 'Robert', ftp: st.ftpWatts ?? 250, ...(photo ? { photo } : {}) });
    download(new Uint8Array(await blob.arrayBuffer()), `allez-robert-${new Date(ride.startT).toISOString().slice(0, 10)}.png`, 'image/png');
  };
}

/**
 * Compte connecté : enregistrement de la sortie sur le serveur (XP, segments), envoi
 * automatique vers Strava (sauf option « Garmin ») et intervals.icu s'ils sont reliés.
 */
async function onlinePanel(box: HTMLElement, ride: RideSession, fit: () => Uint8Array, video?: SummaryVideoPanel): Promise<void> {
  const fr = getLang() === 'fr';
  const me = await fetchMe();
  video?.setLoggedIn(!!me);
  if (!me) {
    box.innerHTML = `<p class="meta" style="color:var(--ar-muted);font-size:13px">${fr ? 'Connecte-toi pour enregistrer la sortie sur ton compte et l’envoyer vers Strava / intervals.icu.' : 'Sign in to save the ride and send it to Strava / intervals.icu.'}</p>`;
    return;
  }
  const api = (p: string, init?: RequestInit) => fetch(`${apiBase()}${p}`, { credentials: 'include', ...init });
  const integ = (await api('/integrations').then((r) => (r.ok ? r.json() : null)).catch(() => null)) as null | {
    strava: { available: boolean; connected: boolean; athleteName: string | null };
    intervals: { connected: boolean };
  };
  const st = JSON.parse(localStorage.getItem('ar.settings') ?? '{}') as { skipStrava?: boolean };
  box.innerHTML = `<h2>${fr ? 'Partager' : 'Share'}</h2><div class="device-list">
    <div class="device"><div><b>${fr ? 'Mon compte' : 'My account'}</b><div class="meta" id="o-save-msg">${fr ? 'Enregistre la sortie, l’XP et les segments' : 'Saves the ride, XP and segments'}</div></div><button class="btn small primary" id="o-save">${fr ? 'Enregistrer' : 'Save'}</button></div>
    <div class="device"><div><b>Strava</b><div class="meta">${!integ?.strava.available ? (fr ? 'non configuré sur le serveur' : 'not configured on the server') : integ.strava.connected ? `${fr ? 'relié' : 'linked'}${integ.strava.athleteName ? ` · ${integ.strava.athleteName}` : ''}${st.skipStrava ? (fr ? ' · envoi désactivé (Garmin)' : ' · upload off (Garmin)') : ''}` : fr ? 'non relié' : 'not linked'}</div></div>
      ${integ?.strava.available && !integ.strava.connected ? `<button class="btn small" id="o-strava">${fr ? 'Relier' : 'Link'}</button>` : ''}</div>
    <div class="device"><div><b>intervals.icu</b><div class="meta">${integ?.intervals.connected ? (fr ? 'relié' : 'linked') : fr ? 'clé API (Réglages → Developer settings)' : 'API key (Settings → Developer settings)'}</div></div>
      ${integ?.intervals.connected ? '' : `<form id="o-int" class="row"><input id="o-intkey" type="password" placeholder="${fr ? 'clé API' : 'API key'}" class="btn small" style="width:160px;text-align:left"/><button class="btn small" type="submit">${fr ? 'Relier' : 'Link'}</button></form>`}</div>
  </div>`;
  box.querySelector('#o-strava')?.addEventListener('click', () => (location.href = `${apiBase()}/integrations/strava/start`));
  box.querySelector('#o-int')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = (box.querySelector('#o-intkey') as HTMLInputElement).value.trim();
    const r = await api('/integrations/intervals', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey: key }) }).catch(() => null);
    if (r?.ok) void onlinePanel(box, ride, fit, video);
    else alert(fr ? 'intervals.icu a refusé cette clé.' : 'intervals.icu rejected this key.');
  });
  box.querySelector('#o-save')?.addEventListener('click', async (e) => {
    const b = e.target as HTMLButtonElement;
    b.disabled = true;
    const q = new URLSearchParams({ name: `Allez Robert ! — ${ride.route.name}`.slice(0, 100), routeId: ride.route.id, skipStrava: st.skipStrava ? '1' : '0' });
    const r = await api(`/activities?${q}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: fit() as BlobPart }).catch(() => null);
    const msg = box.querySelector('#o-save-msg') as HTMLElement;
    if (r?.ok) {
      const j = (await r.json()) as { xpGained: number; progression: { level: number }; activity?: { id: string } };
      if (j.activity?.id) video?.setActivity(j.activity.id);
      msg.textContent = `${fr ? 'Enregistrée' : 'Saved'} · +${j.xpGained} XP · ${fr ? 'niveau' : 'level'} ${j.progression.level}${integ?.strava.connected && !st.skipStrava ? ' · Strava…' : ''}${integ?.intervals.connected ? ' · intervals.icu…' : ''}`;
    } else {
      msg.textContent = fr ? 'Enregistrement impossible pour le moment.' : 'Could not save right now.';
      b.disabled = false;
    }
  });
}
