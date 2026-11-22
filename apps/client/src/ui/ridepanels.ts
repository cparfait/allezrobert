import { phoneIcon } from './companionQr.ts';
import { encodeActivity, buildActivity } from '@allezrobert/fit';
import { worldToWgs84, type ActivityRecord, type RideKind } from '@allezrobert/shared';
import { t, getLang } from '../i18n/index.ts';
import type { SummaryVideoPanel } from './summaryvideo.ts';
import { apiBase, fetchMe } from './account.ts';
import { renderRideInvite } from './friends.ts';
import type { RideSession } from '../game/ride.ts';
import { renderMusicControls, renderSoundSettings } from './soundSettings.ts';
import type { QualityLevel } from '../engine/quality.ts';
import { saveExport } from '../platform/desktop.ts';
import { exportSaved } from './desktopUi.ts';
import './blocks.css';

/** Construit le fichier FIT de la sortie (positions GPS reconstruites depuis le repère monde). */
/** FIT de la sortie : une `RideSession` ou un brouillon relu (départ, mesures, tours). */
export function rideToFit(ride: Pick<RideSession, 'startT' | 'records' | 'lapTimes'>, opts: { name: string; massKg: number; ftp: number; originL93?: { x: number; y: number }; skipStrava: boolean }): Uint8Array {
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

/**
 * Fichier exporté : téléchargé dans un navigateur ; dans l'application Windows, enregistré directement
 * (sorties FIT/GPX dans Documents\Allez Robert\Sorties, images dans Images\Allez Robert) et montré.
 */
export function download(bytes: Uint8Array, filename: string, mime = 'application/octet-stream'): void {
  const kind = /\.(png|jpe?g)$/i.test(filename) ? 'screenshot' : 'ride';
  saveExport(kind, filename, bytes, mime)
    .then((path) => path && exportSaved(path))
    .catch((err) => alert(`${getLang() === 'fr' ? 'Enregistrement impossible' : 'Could not save'} : ${String(err)}`));
}

export interface PauseCallbacks {
  onResume(): void;
  onFinish(): void;
  /** Libellé du bouton de fin (ex. « Abandonner la course »). */
  finishLabel?: string;
  /** Sortie de groupe en cours : la pause propose d'y inviter des amis. */
  roomId?: string;
  /** Affiche le QR code de l'appli compagnon. */
  onCompanion?(): void;
  /** Graphismes : préréglage (appliqué à la prochaine sortie) et effets d'image (tout de suite). */
  graphics?: PauseGraphics;
}

export interface PauseGraphics {
  /** Préréglage enregistré pour les prochaines sorties. */
  level: QualityLevel;
  /** Préréglage de la sortie en cours. */
  current: QualityLevel;
  onLevel(level: QualityLevel): void;
  effects: { ao: boolean; bloom: boolean; taa: boolean };
  onEffect(key: 'ao' | 'bloom' | 'taa'): void;
}

/** Bloc « Graphismes » de la pause, redessiné à chaque changement. */
function renderGraphics(box: HTMLElement | null, g: PauseGraphics): void {
  if (!box) return;
  const fr = getLang() === 'fr';
  const levels: Array<[QualityLevel, string]> = [
    ['low', t('low')],
    ['medium', t('medium')],
    ['high', t('high')],
    ['ultra', t('ultra')],
  ];
  const fx: Array<['ao' | 'bloom' | 'taa', string]> = [
    ['ao', fr ? 'Ombrage des recoins' : 'Ambient occlusion'],
    ['bloom', fr ? 'Halo lumineux' : 'Bloom'],
    ['taa', fr ? 'Lissage' : 'Anti-aliasing'],
  ];
  const later = g.level !== g.current;
  box.innerHTML = `<h3 class="ab-section">${fr ? 'Image' : 'Image'}</h3>
    <div class="mm-opt mm-opt-first mm-opt-col"><div class="mm-opt-l"><b>${fr ? 'Qualité' : 'Quality'}</b><small>${later ? (fr ? 'Appliquée à la prochaine sortie.' : 'Applies from the next ride.') : fr ? 'Un changement s’applique à la prochaine sortie.' : 'A change applies from the next ride.'}</small></div>
      <div class="pz-seg" role="group">${levels.map(([l, name]) => `<button type="button" class="${l === g.level ? 'on' : ''}" aria-pressed="${l === g.level}" data-q="${l}">${name}</button>`).join('')}</div></div>
    <div class="mm-opt mm-opt-col"><div class="mm-opt-l"><b>${fr ? 'Effets d’image' : 'Image effects'}</b><small>${fr ? 'Appliqués tout de suite ; les couper rend le jeu plus fluide.' : 'Applied at once; turning them off makes the game smoother.'}</small></div>
      <div class="pz-seg" role="group">${fx.map(([k, name]) => `<button type="button" class="${g.effects[k] ? 'on' : ''}" aria-pressed="${g.effects[k]}" data-fx="${k}">${name}</button>`).join('')}</div></div>`;
  box.querySelectorAll<HTMLElement>('[data-q]').forEach((b) =>
    b.addEventListener('click', () => {
      g.level = b.dataset.q as QualityLevel;
      g.onLevel(g.level);
      renderGraphics(box, g);
    }),
  );
  box.querySelectorAll<HTMLElement>('[data-fx]').forEach((b) =>
    b.addEventListener('click', () => {
      const k = b.dataset.fx as 'ao' | 'bloom' | 'taa';
      g.effects[k] = !g.effects[k];
      g.onEffect(k);
      renderGraphics(box, g);
    }),
  );
}

/** Raccourcis clavier de la sortie, une touche par ligne (menu pause). */
function shortcutsHtml(): string {
  const fr = getLang() === 'fr';
  const keys: [string[], string, string][] = [
    [['↑', '↓'], 'Vitesses', 'Gears'],
    [['←', '→'], 'Direction aux carrefours', 'Steer at junctions'],
    [['C'], 'Caméra', 'Camera'],
    [['X'], 'Regarder derrière (maintenu)', 'Look back (hold)'],
    [['U'], 'Demi-tour', 'U-turn'],
    [['P'], 'Photo', 'Photo'],
    [['H'], 'Afficher / masquer l’interface', 'Show / hide interface'],
    [['B'], 'Musique', 'Music'],
    [['N'], 'Morceau suivant', 'Next track'],
    [['M'], 'Couper le son', 'Mute sound'],
    [['Q'], 'Code de l’appli compagnon', 'Companion app code'],
    [[fr ? 'Espace' : 'Space', fr ? 'Échap' : 'Esc'], 'Pause / reprendre', 'Pause / resume'],
  ];
  return `<div class="pause-keys">${keys.map(([k, f, e]) => `<span>${k.map((x) => `<kbd>${x}</kbd>`).join(' ')}</span><span>${fr ? f : e}</span>`).join('')}</div>`;
}

export function showPause(root: HTMLElement, cb: PauseCallbacks): void {
  const fr = getLang() === 'fr';
  // Trois gros blocs d'action en tête (une seule action jaune : reprendre), puis les réglages, un par ligne.
  const ico = (path: string): string => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  const keys = fr ? '<kbd>Espace</kbd> ou <kbd>Échap</kbd>' : '<kbd>Space</kbd> or <kbd>Esc</kbd>';
  root.innerHTML = `<div class="pause-overlay"><div class="pause-card pz">
    <header class="pz-head"><h2 class="ab-title">${t('pause')}</h2><p class="ab-sub">${fr ? 'Le chrono et la distance attendent ton retour.' : 'Time and distance wait for you.'}</p></header>
    <div class="ab-grid ${cb.onCompanion ? '' : 'ab-grid-2'} pz-actions">
      <button type="button" class="ab-tile pz-act pz-go" id="p-resume"><span class="ab-ico">${ico('<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>')}</span><span class="ab-name">${t('resume')}</span><span class="ab-detail">${keys}</span></button>
      <button type="button" class="ab-tile pz-act pz-quit" id="p-finish"><span class="ab-ico">${ico('<path d="M6 21V4"/><path d="M6 4h11l-2.2 4L17 12H6"/>')}</span><span class="ab-name">${cb.finishLabel ?? t('finish')}</span><span class="ab-detail">${fr ? 'Arrête la sortie et affiche le bilan.' : 'Ends the ride and shows the summary.'}</span></button>
      ${cb.onCompanion ? `<button type="button" class="ab-tile pz-act" id="p-companion"><span class="ab-ico">${phoneIcon(46)}</span><span class="ab-name">${fr ? 'Appli compagnon' : 'Companion app'}</span><span class="ab-detail">${fr ? 'Affiche le code à scanner avec le téléphone.' : 'Shows the code to scan with your phone.'}</span></button>` : ''}
    </div>
    <div id="p-friends"></div>
    <div class="pz-grid">
      ${cb.graphics ? '<section class="pz-sec" id="p-graphics"></section>' : ''}
      <section class="pz-sec pz-sound"><h3 class="ab-section">${fr ? 'Son' : 'Sound'}</h3><div id="p-music"></div><div id="p-sound"></div>
        <details class="pz-more"><summary>${fr ? 'Avancé' : 'Advanced'}</summary><div id="p-sound-more"></div></details></section>
    </div>
    <details class="pz-sec pz-keys"><summary>${fr ? 'Raccourcis clavier' : 'Keyboard shortcuts'}</summary>${shortcutsHtml()}</details>
  </div></div>`;
  if (cb.graphics) renderGraphics(root.querySelector('#p-graphics'), cb.graphics);
  renderMusicControls(root.querySelector('#p-music'));
  renderSoundSettings(root.querySelector('#p-sound'));
  // Choix rares (roue libre, micro, sortie audio) : déplacés tels quels sous « Avancé », écouteurs compris.
  const more = root.querySelector<HTMLElement>('#p-sound-more');
  const sound = root.querySelector<HTMLElement>('#p-sound');
  if (more && sound) {
    const freewheel = sound.querySelector('#snd-freewheel')?.closest('label');
    if (freewheel) more.appendChild(freewheel);
    const devices = sound.querySelector('.snd-devices');
    if (devices) more.appendChild(devices);
  }
  (root.querySelector('#p-resume') as HTMLElement).onclick = cb.onResume;
  // « Terminer » en deux temps : le premier appui demande confirmation (4 s), le second termine. Évite d'arrêter
  // une longue sortie par un appui de trop sur la manette ou le cintre.
  const finishBtn = root.querySelector('#p-finish') as HTMLElement;
  let armed: ReturnType<typeof setTimeout> | null = null;
  finishBtn.onclick = () => {
    if (armed) {
      clearTimeout(armed);
      armed = null;
      cb.onFinish();
      return;
    }
    const name = finishBtn.querySelector('.ab-name');
    const detail = finishBtn.querySelector('.ab-detail');
    const before = [name?.textContent ?? '', detail?.textContent ?? ''] as const;
    if (name) name.textContent = fr ? 'Confirmer ?' : 'Confirm?';
    if (detail) detail.textContent = fr ? 'Appuie encore pour terminer la sortie.' : 'Press again to end the ride.';
    finishBtn.classList.add('pz-armed');
    armed = setTimeout(() => {
      armed = null;
      if (name) name.textContent = before[0];
      if (detail) detail.textContent = before[1];
      finishBtn.classList.remove('pz-armed');
    }, 4000);
  };
  const cmp = root.querySelector<HTMLElement>('#p-companion');
  if (cmp && cb.onCompanion) cmp.onclick = cb.onCompanion;
  if (cb.roomId) void renderRideInvite(root.querySelector('#p-friends') as HTMLElement, cb.roomId);
}

/**
 * Compte connecté : enregistrement de la sortie sur le serveur (XP, segments), envoi
 * automatique vers Strava (sauf option « Garmin ») et intervals.icu s'ils sont reliés.
 */
/** Lien avec l'historique : la sortie envoyée remplace celle déjà synchronisée (même identifiant). */
export interface UploadMeta {
  clientRideId: string;
  kind: RideKind;
  workoutId?: string | null;
  workoutName?: string | null;
  ftp: number;
  /** FIT bien enregistré sur le compte. */
  onSaved?: () => void;
}

export async function onlinePanel(box: HTMLElement, ride: RideSession, fit: () => Uint8Array, video?: SummaryVideoPanel, meta?: UploadMeta): Promise<void> {
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
  box.innerHTML = `<h4 class="sum-sub">${fr ? 'Compte et services' : 'Account and services'}</h4><div class="device-list">
    <div class="device"><div><b>${fr ? 'Mon compte' : 'My account'}</b><div class="meta" id="o-save-msg">${fr ? 'Enregistre la sortie, l’XP et les segments' : 'Saves the ride, XP and segments'}</div></div><button class="btn small primary" id="o-save">${fr ? 'Enregistrer' : 'Save'}</button></div>
    <div class="device"><div><b>Strava</b><div class="meta">${!integ?.strava.available ? (fr ? 'non configuré sur le serveur' : 'not configured on the server') : integ.strava.connected ? `${fr ? 'relié' : 'linked'}${integ.strava.athleteName ? ` · ${integ.strava.athleteName}` : ''}${st.skipStrava ? (fr ? ' · envoi désactivé (Garmin)' : ' · upload off (Garmin)') : ''}` : fr ? 'non relié' : 'not linked'}</div></div>
      ${integ?.strava.available && !integ.strava.connected ? `<button class="btn small" id="o-strava">${fr ? 'Relier' : 'Link'}</button>` : ''}</div>
    <div class="device"><div><b>intervals.icu</b><div class="meta">${integ?.intervals.connected ? (fr ? 'relié' : 'linked') : fr ? 'clé API (Réglages → Developer settings)' : 'API key (Settings → Developer settings)'}</div></div>
      ${integ?.intervals.connected ? '' : `<form id="o-int" class="row"><input id="o-intkey" type="password" placeholder="${fr ? 'clé API' : 'API key'}" class="btn small" style="width:160px;text-align:left"/><button class="btn small" type="submit">${fr ? 'Relier' : 'Link'}</button></form>`}</div>
  </div>`;
  box.querySelector('#o-strava')?.addEventListener('click', () => (location.href = `${apiBase()}/integrations/strava/start?redirect=${encodeURIComponent(location.pathname)}`));
  box.querySelector('#o-int')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = (box.querySelector('#o-intkey') as HTMLInputElement).value.trim();
    const r = await api('/integrations/intervals', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey: key }) }).catch(() => null);
    if (r?.ok) void onlinePanel(box, ride, fit, video, meta);
    else alert(fr ? 'intervals.icu a refusé cette clé.' : 'intervals.icu rejected this key.');
  });
  box.querySelector('#o-save')?.addEventListener('click', async (e) => {
    const b = e.target as HTMLButtonElement;
    b.disabled = true;
    const q = new URLSearchParams({ name: `Allez Robert ! — ${ride.route.name}`.slice(0, 100), routeId: ride.route.id, skipStrava: st.skipStrava ? '1' : '0' });
    if (meta) {
      q.set('clientRideId', meta.clientRideId);
      q.set('kind', meta.kind);
      q.set('ftp', String(Math.round(meta.ftp)));
      if (meta.workoutId) q.set('workoutId', meta.workoutId.slice(0, 80));
      if (meta.workoutName) q.set('workoutName', meta.workoutName.slice(0, 100));
    }
    const r = await api(`/activities?${q}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: fit() as BlobPart }).catch(() => null);
    const msg = box.querySelector('#o-save-msg') as HTMLElement;
    if (r?.ok) {
      const j = (await r.json()) as { xpGained: number; progression: { level: number }; activity?: { id: string } };
      if (j.activity?.id) video?.setActivity(j.activity.id);
      meta?.onSaved?.();
      msg.textContent = `${fr ? 'Enregistrée' : 'Saved'} · +${j.xpGained} XP · ${fr ? 'niveau' : 'level'} ${j.progression.level}${integ?.strava.connected && !st.skipStrava ? ' · Strava…' : ''}${integ?.intervals.connected ? ' · intervals.icu…' : ''}`;
    } else {
      msg.textContent = fr ? 'Enregistrement impossible pour le moment.' : 'Could not save right now.';
      b.disabled = false;
    }
  });
}
