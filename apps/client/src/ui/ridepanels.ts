import { encodeActivity, buildActivity } from '@allezrobert/fit';
import { worldToWgs84, type ActivityRecord } from '@allezrobert/shared';
import { t, getLang } from '../i18n/index.ts';
import { apiBase, fetchMe } from './account.ts';
import type { RideSession } from '../game/ride.ts';

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

/** Trace GPX 1.1 de la sortie (positions, altitude, temps ; puissance, FC et cadence en extensions). */
export function rideToGpx(ride: RideSession, opts: { name: string; originL93?: { x: number; y: number } }): Uint8Array {
  const pts = ride.records
    .map((r) => {
      const rec = r as ActivityRecord & { x?: number; z?: number };
      if (!opts.originL93 || rec.x === undefined || rec.z === undefined) return '';
      const g = worldToWgs84(rec.x, rec.z, opts.originL93);
      const ext = [
        rec.watts !== undefined ? `<power>${Math.round(rec.watts)}</power>` : '',
        rec.hr !== undefined || rec.cadence !== undefined
          ? `<gpxtpx:TrackPointExtension>${rec.hr !== undefined ? `<gpxtpx:hr>${Math.round(rec.hr)}</gpxtpx:hr>` : ''}${rec.cadence !== undefined ? `<gpxtpx:cad>${Math.round(rec.cadence)}</gpxtpx:cad>` : ''}</gpxtpx:TrackPointExtension>`
          : '',
      ].join('');
      return `<trkpt lat="${g.lat.toFixed(7)}" lon="${g.lon.toFixed(7)}"><ele>${rec.altitudeM.toFixed(1)}</ele><time>${new Date(rec.t).toISOString()}</time>${ext ? `<extensions>${ext}</extensions>` : ''}</trkpt>`;
    })
    .filter(Boolean)
    .join('\n');
  const name = opts.name.replace(/[<&>]/g, '');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Allez Robert !" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
<metadata><name>${name}</name><time>${new Date(ride.startT).toISOString()}</time></metadata>
<trk><name>${name}</name><type>VirtualRide</type><trkseg>
${pts}
</trkseg></trk>
</gpx>
`;
  return new TextEncoder().encode(xml);
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

/**
 * Compte connecté : enregistrement de la sortie sur le serveur (XP, segments), envoi
 * automatique vers Strava (sauf option « Garmin ») et intervals.icu s'ils sont reliés.
 */
export async function onlinePanel(box: HTMLElement, ride: RideSession, fit: () => Uint8Array): Promise<void> {
  const fr = getLang() === 'fr';
  const me = await fetchMe();
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
    if (r?.ok) void onlinePanel(box, ride, fit);
    else alert(fr ? 'intervals.icu a refusé cette clé.' : 'intervals.icu rejected this key.');
  });
  box.querySelector('#o-save')?.addEventListener('click', async (e) => {
    const b = e.target as HTMLButtonElement;
    b.disabled = true;
    const q = new URLSearchParams({ name: `Allez Robert ! — ${ride.route.name}`.slice(0, 100), routeId: ride.route.id, skipStrava: st.skipStrava ? '1' : '0' });
    const r = await api(`/activities?${q}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: fit() as BlobPart }).catch(() => null);
    const msg = box.querySelector('#o-save-msg') as HTMLElement;
    if (r?.ok) {
      const j = (await r.json()) as { xpGained: number; progression: { level: number } };
      msg.textContent = `${fr ? 'Enregistrée' : 'Saved'} · +${j.xpGained} XP · ${fr ? 'niveau' : 'level'} ${j.progression.level}${integ?.strava.connected && !st.skipStrava ? ' · Strava…' : ''}${integ?.intervals.connected ? ' · intervals.icu…' : ''}`;
    } else {
      msg.textContent = fr ? 'Enregistrement impossible pour le moment.' : 'Could not save right now.';
      b.disabled = false;
    }
  });
}
