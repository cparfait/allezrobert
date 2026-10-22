import type { FanMode } from '@allezrobert/devices';
import type { ExperimentalAdapters } from '@allezrobert/protocols';
import type { HardwareApi } from '../game/devices.ts';
import { getLang } from '../i18n/index.ts';
import './hardware-panel.css';

/**
 * Réglages avancés du matériel, sous les tuiles de l'onglet Capteurs : calibration (spin-down),
 * ventilateur asservi, manette et télécommande HID, adaptateurs expérimentaux, power match,
 * ANT+ et Direct Connect (app Windows), diagnostic (états, firmware, journal à copier).
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const fr = () => getLang() === 'fr';
const L = (f: string, e: string) => (fr() ? f : e);

/** Sections ouvertes : conservées entre deux rendus (le panneau se redessine à chaque événement capteur). */
const openSections = new Set<string>(['calib']);
/** Apprentissage d'une touche de télécommande en cours. */
let learning: 'up' | 'down' | null = null;
let learnCleanup: (() => void) | null = null;
let copiedAt = 0;

const STATE_FR: Record<string, string> = { connected: 'connecté', connecting: 'connexion…', reconnecting: 'reconnexion…', silent: 'muet', error: 'erreur', disconnected: 'déconnecté' };

const ADAPTERS: Array<[keyof ExperimentalAdapters, string, string]> = [
  ['zwiftControllers', 'Zwift Click v1 / v2, Play, Ride', 'Boutons uniquement ; le Click v2 gauche et le Ride v2 doivent avoir été déverrouillés par l’appli Zwift.'],
  ['shimanoDfly', 'Shimano Di2 (boutons D-Fly)', 'Affecter les canaux D-Fly dans E-TUBE (canal 1 = monter, 2 = descendre) ; appairer le Di2 dans Windows.'],
  ['headwind', 'Wahoo KICKR HEADWIND', 'Le jeu règle la vitesse (pas de 25 %).'],
  ['sramAxs', 'SRAM AXS', 'Appuis anonymes, ou rapport engagé après appairage SRAMBond.'],
  ['antControls', 'Télécommandes ANT+ Controls', 'App Windows + clé ANT+.'],
];

const FAN_MODES: Array<[FanMode, string, string]> = [
  ['off', 'Arrêt', 'Off'],
  ['manual', 'Manuel', 'Manual'],
  ['speed', 'Vitesse', 'Speed'],
  ['heartRate', 'FC', 'Heart rate'],
  ['grade', 'Pente', 'Grade'],
];

function calibrationText(api: HardwareApi): string {
  const c = api.calibration();
  const support = api.calibrationSupport();
  if (support === 'unknown') return L('Connectez d’abord le home trainer.', 'Connect the trainer first.');
  if (!c) {
    return support === 'unsupported'
      ? L('Ce trainer n’annonce pas le spin-down par FTMS : faites-le dans l’appli du fabricant (Wahoo : appli Wahoo → Calibration avancée).', 'This trainer does not offer FTMS spin-down: use the maker’s app.')
      : L('Pédalez 10 min pour chauffer le trainer, puis lancez le spin-down.', 'Warm up 10 min, then start the spin-down.');
  }
  const range = c.targetSpeedLowKmh !== undefined ? (c.targetSpeedHighKmh && c.targetSpeedHighKmh !== c.targetSpeedLowKmh ? `${Math.round(c.targetSpeedLowKmh)}–${Math.round(c.targetSpeedHighKmh)} km/h` : `${Math.round(c.targetSpeedLowKmh)} km/h`) : L('la vitesse demandée', 'the target speed');
  switch (c.status) {
    case 'started':
      return L('Demande envoyée au trainer…', 'Request sent…');
    case 'requested':
      return L(`Accélérez jusqu’à ${range} et tenez cette vitesse.`, `Speed up to ${range} and hold it.`);
    case 'stopPedaling':
      return L('Arrêtez de pédaler : laissez la roue ralentir seule jusqu’au résultat.', 'Stop pedaling and let the wheel coast down.');
    case 'success':
      return L(`Calibration réussie${c.spinDownTimeMs ? ` (spin-down ${(c.spinDownTimeMs / 1000).toFixed(1)} s)` : ''}.`, 'Calibration successful.');
    case 'unsupported':
      return L(`Spin-down non pris en charge par ce trainer (${c.reason ?? 'refusé'}) : utilisez l’appli du fabricant.`, 'Spin-down not supported: use the maker’s app.');
    case 'error':
      return L(`Échec de la calibration${c.reason ? ` : ${c.reason}` : ''}. Réessayez après 10 min d’échauffement.`, 'Calibration failed. Retry after a warm-up.');
  }
}

function section(id: string, title: string, body: string): string {
  return `<details class="hw-sec" data-sec="${id}" ${openSections.has(id) ? 'open' : ''}><summary>${title}</summary><div class="hw-body">${body}</div></details>`;
}

export function renderHardwarePanel(el: HTMLElement, api: HardwareApi): void {
  // Le panneau est redessiné à chaque événement capteur : on garde la saisie en cours.
  const active = document.activeElement as HTMLInputElement | null;
  const keepId = active && el.contains(active) && active.id ? active.id : null;
  const keepVal = keepId ? active?.value : undefined;

  const p = api.prefs();
  const exp = api.experimental();
  const devices = api.details();
  const cal = api.calibration();
  const busy = cal && (cal.status === 'started' || cal.status === 'requested' || cal.status === 'stopPedaling');
  const pads = (navigator.getGamepads?.() ?? []).filter((g): g is Gamepad => !!g);
  const hid = Object.entries(p.hidBindings);
  const pm = api.manager.powerMatch;

  const calib = `<p class="hw-msg ${cal?.status ?? ''}">${esc(calibrationText(api))}</p>
    <button class="btn small primary" id="hw-cal" ${api.calibrationSupport() !== 'supported' || busy ? 'disabled' : ''}>${L('Lancer le spin-down', 'Start spin-down')}</button>`;

  const fan = `<div class="mm-seg" id="hw-fanmode">${FAN_MODES.map(([m, f, e]) => `<button data-mode="${m}" class="${p.fan.mode === m ? 'on' : ''}">${fr() ? f : e}</button>`).join('')}</div>
    <div class="hw-grid">
      <label class="field">${L('Manuel', 'Manual')} <span>${p.fan.manualPercent} %</span><input id="hw-fanpct" type="range" min="0" max="100" step="25" value="${p.fan.manualPercent}"/></label>
      <label class="field">${L('100 % à', '100 % at')} (km/h)<input id="hw-fanfull" type="number" min="15" max="80" value="${p.fan.speedForFullKmh ?? 48}"/></label>
      <label class="field">${L('FC max', 'Max HR')} (bpm)<input id="hw-hrmax" type="number" min="120" max="230" value="${p.fan.maxHeartRateBpm ?? 185}"/></label>
    </div>
    <p class="hw-hint">${L('Vitesse : suit la vitesse du jeu. FC : de 50 % à 90 % de la FC max. Pente : 30 % sur le plat, +10 points par % de pente, la vitesse en descente. L’appli compagnon passe en manuel.', 'Speed follows the game speed; HR from 50 to 90 % of max; grade adds 10 points per %.')}</p>
    <div class="hw-row"><button class="btn small" data-fantest="0">${L('Essai 0 %', 'Test 0 %')}</button><button class="btn small" data-fantest="50">50 %</button><button class="btn small" data-fantest="100">100 %</button></div>`;

  const shifters = `<label class="mm-check"><input type="checkbox" id="hw-pad" ${p.gamepad ? 'checked' : ''}/> ${L('Manette : RB / LB et croix ↑ ↓ changent de vitesse, RT / LT de plateau', 'Gamepad: RB / LB and d-pad ↑ ↓ shift, RT / LT change chainring')}</label>
    <p class="hw-hint">${pads.length ? `${L('Manette détectée', 'Gamepad detected')} : ${esc(pads.map((g) => g.id).join(', '))}` : L('Aucune manette détectée : appuyez sur un bouton de la manette pour la réveiller.', 'No gamepad detected: press a button to wake it.')}</p>
    <div class="hw-row">
      <span>${L('Télécommande HID (Bluetooth / USB, vue comme un clavier)', 'HID remote (seen as a keyboard)')}</span>
      <button class="btn small ${learning === 'up' ? 'primary' : ''}" data-learn="up">${learning === 'up' ? L('Appuyez sur le bouton…', 'Press the button…') : L('Apprendre « monter »', 'Learn “up”')}</button>
      <button class="btn small ${learning === 'down' ? 'primary' : ''}" data-learn="down">${learning === 'down' ? L('Appuyez sur le bouton…', 'Press the button…') : L('Apprendre « descendre »', 'Learn “down”')}</button>
      ${hid.length ? `<button class="mm-link" id="hw-hidclear">${L('effacer', 'clear')}</button>` : ''}
    </div>
    <p class="hw-hint">${hid.length ? hid.map(([k, a]) => `<code>${esc(k)}</code> → ${a === 'up' ? L('monter', 'up') : L('descendre', 'down')}`).join(' · ') : L('Par défaut : piste suivante = monter, piste précédente = descendre.', 'Default: next track = up, previous track = down.')}</p>
    <p class="hw-hint">${L('Le clavier (↑ ↓, Page ↑ ↓) marche toujours. Avec une cassette réelle (Réglages → Transmission), les vitesses virtuelles sont coupées.', 'Keyboard always works.')}</p>`;

  const adapters = `<p class="hw-warn">${L('Protocoles non documentés par les fabricants, décodés par la communauté : ils peuvent cesser de marcher après une mise à jour du firmware.', 'Undocumented protocols: may break after a firmware update.')}</p>
    ${ADAPTERS.map(([k, label, hint]) => `<label class="mm-check"><input type="checkbox" data-exp="${k}" ${exp[k] ? 'checked' : ''}/> <span><b>${esc(label)}</b> <small>${esc(hint)}</small></span></label>`).join('')}
    <label class="mm-check"><input type="checkbox" id="hw-all" ${api.showAllDevices ? 'checked' : ''}/> ${L('Bluetooth du navigateur : afficher tous les appareils dans le sélecteur (Di2, HEADWIND qui n’annoncent pas leur service)', 'Browser Bluetooth: show all devices in the chooser')}</label>`;

  const ergBody = `<label class="mm-check"><input type="checkbox" id="hw-pm" ${api.manager.powerMatchEnabled ? 'checked' : ''}/> ${L('Power match : en ERG, les pédales font foi ; la consigne du trainer est corrigée lentement (±15 % max)', 'Power match: in ERG, pedals are the reference')}</label>
    <p class="hw-hint">${L('Correction actuelle', 'Current correction')} : ${(pm.correction * 100).toFixed(1)} % · ${L('source de puissance', 'power source')} : ${esc(api.manager.powerSource)}</p>`;

  const desktop = api.isDesktop
    ? `<div class="hw-grid">
        <label class="field">${L('Clé réseau ANT+ (16 caractères hexadécimaux, licence ANT+ : jamais fournie avec le jeu)', 'ANT+ network key (16 hex characters)')}<input id="hw-antkey" type="password" autocomplete="off" spellcheck="false" value="${esc(p.antNetworkKey)}" placeholder="${L('vide = variable ANT_PLUS_NETWORK_KEY ou fichier', 'empty = env variable or file')}"/></label>
        <label class="field">${L('Direct Connect : ajouter un trainer par adresse IP', 'Direct Connect: add a trainer by IP')}<span class="hw-row"><input id="hw-dircon" placeholder="192.168.1.42"/><button class="btn small" id="hw-diradd">${L('Ajouter', 'Add')}</button></span></label>
      </div>
      <p class="hw-hint">${L('Clé ANT+ : prise en compte au prochain lancement de l’app. Direct Connect : choisir « Wahoo Direct Connect » puis Associer.', 'ANT+ key: applied at next launch.')} ${p.dirconHosts.length ? `${L('Adresses', 'Hosts')} : ${p.dirconHosts.map(esc).join(', ')}` : ''}</p>`
    : `<p class="hw-hint">${L('ANT+ USB et Wahoo Direct Connect ne sont disponibles que dans l’app Windows (le navigateur ne voit que le Bluetooth).', 'ANT+ USB and Direct Connect need the Windows app.')}</p>`;

  const diag = `<table class="hw-table"><thead><tr><th>${L('Appareil', 'Device')}</th><th>${L('Liaison', 'Link')}</th><th>${L('État', 'State')}</th><th>Firmware</th><th>${L('Batterie', 'Battery')}</th><th>RSSI</th><th></th></tr></thead><tbody>
    ${devices.length ? devices.map((d) => `<tr><td>${esc(d.name)}${d.model ? ` <small>${esc(d.model)}</small>` : ''}</td><td>${esc(d.transport)}</td><td class="st-${d.state}">${esc(fr() ? STATE_FR[d.state] ?? d.state : d.state)}</td><td>${esc(d.firmware ?? '—')}</td><td>${d.battery !== undefined ? `${d.battery} %` : '—'}</td><td>${d.rssi ?? '—'}</td><td>${d.state !== 'connected' ? `<button class="mm-link" data-reco="${esc(d.id)}">${L('reconnecter', 'reconnect')}</button>` : ''}</td></tr>`).join('') : `<tr><td colspan="7">${L('Aucun appareil.', 'No device.')}</td></tr>`}
    </tbody></table>
    <div class="hw-row"><button class="btn small" id="hw-copy">${Date.now() - copiedAt < 2500 ? L('Copié ✓', 'Copied ✓') : L('Copier le journal matériel', 'Copy hardware log')}</button><span class="hw-hint">${L('À coller dans le signalement (docs/HARDWARE_TEST.md).', 'Paste it in your report.')}</span></div>
    <pre class="hw-log">${esc(api.log().split('\n').slice(-12).join('\n'))}</pre>`;

  el.innerHTML = `<div class="hw">
    <h3>${L('Réglages avancés', 'Advanced settings')}</h3>
    ${section('calib', L('Calibration du home trainer (spin-down)', 'Trainer calibration (spin-down)'), calib)}
    ${section('fan', L('Ventilateur KICKR HEADWIND', 'KICKR HEADWIND fan'), fan)}
    ${section('shift', L('Manette, télécommande, clavier', 'Gamepad, remote, keyboard'), shifters)}
    ${section('exp', L('Adaptateurs expérimentaux (Click, Di2, HEADWIND…)', 'Experimental adapters'), adapters)}
    ${section('erg', 'ERG · power match', ergBody)}
    ${section('desk', L('ANT+ USB et Direct Connect', 'ANT+ USB and Direct Connect'), desktop)}
    ${section('diag', L('Diagnostic et journal', 'Diagnostics and log'), diag)}
  </div>`;

  const rerender = () => renderHardwarePanel(el, api);
  el.querySelectorAll<HTMLDetailsElement>('details.hw-sec').forEach((d) =>
    d.addEventListener('toggle', () => {
      const id = d.dataset.sec as string;
      if (d.open) openSections.add(id);
      else openSections.delete(id);
    }),
  );
  const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel);

  q('#hw-cal')?.addEventListener('click', () => {
    void api.calibrate().catch((e: unknown) => alert((e as Error).message));
  });
  el.querySelectorAll<HTMLButtonElement>('#hw-fanmode button').forEach((b) =>
    b.addEventListener('click', () => api.update((pr) => (pr.fan = { ...pr.fan, mode: b.dataset.mode as FanMode }))),
  );
  const num = (id: string, apply: (v: number) => void) =>
    q<HTMLInputElement>(id)?.addEventListener('change', (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      if (Number.isFinite(v)) apply(v);
    });
  num('#hw-fanpct', (v) => api.update((pr) => (pr.fan = { ...pr.fan, manualPercent: v })));
  num('#hw-fanfull', (v) => api.update((pr) => (pr.fan = { ...pr.fan, speedForFullKmh: v })));
  num('#hw-hrmax', (v) => api.update((pr) => (pr.fan = { ...pr.fan, maxHeartRateBpm: v })));
  el.querySelectorAll<HTMLButtonElement>('[data-fantest]').forEach((b) =>
    b.addEventListener('click', () => void api.testFan(Number(b.dataset.fantest)).catch((e: unknown) => alert((e as Error).message))),
  );
  q<HTMLInputElement>('#hw-pad')?.addEventListener('change', (e) => api.update((pr) => (pr.gamepad = (e.target as HTMLInputElement).checked)));
  el.querySelectorAll<HTMLButtonElement>('[data-learn]').forEach((b) =>
    b.addEventListener('click', () => {
      learnCleanup?.();
      learning = b.dataset.learn as 'up' | 'down';
      const action = learning;
      const onKey = (e: KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();
        learnCleanup?.();
        // Touches déjà gérées par le clavier du jeu : inutile (et double changement de vitesse).
        if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Escape'].includes(e.code)) {
          if (e.code !== 'Escape') alert(L(`« ${e.code} » est déjà une touche du jeu : rien à apprendre.`, `“${e.code}” is already a game key.`));
          rerender();
          return;
        }
        api.update((pr) => (pr.hidBindings = { ...pr.hidBindings, [e.code || e.key]: action }));
      };
      window.addEventListener('keydown', onKey, true);
      learnCleanup = () => {
        window.removeEventListener('keydown', onKey, true);
        learning = null;
        learnCleanup = null;
      };
      rerender();
    }),
  );
  q('#hw-hidclear')?.addEventListener('click', () => api.update((pr) => (pr.hidBindings = {})));
  el.querySelectorAll<HTMLInputElement>('[data-exp]').forEach((c) =>
    c.addEventListener('change', () => api.setExperimental({ [c.dataset.exp as keyof ExperimentalAdapters]: c.checked })),
  );
  q<HTMLInputElement>('#hw-all')?.addEventListener('change', (e) => {
    api.showAllDevices = (e.target as HTMLInputElement).checked;
  });
  q<HTMLInputElement>('#hw-pm')?.addEventListener('change', (e) => {
    api.manager.setPowerMatch((e.target as HTMLInputElement).checked);
    rerender();
  });
  q<HTMLInputElement>('#hw-antkey')?.addEventListener('change', (e) => api.update((pr) => (pr.antNetworkKey = (e.target as HTMLInputElement).value.trim())));
  q('#hw-diradd')?.addEventListener('click', () => {
    const v = q<HTMLInputElement>('#hw-dircon')?.value ?? '';
    if (/^[\w.-]+$/.test(v.trim())) api.addDirconHost(v);
    else alert(L('Adresse IP ou nom d’hôte invalide.', 'Invalid host.'));
  });
  el.querySelectorAll<HTMLButtonElement>('[data-reco]').forEach((b) => b.addEventListener('click', () => api.reconnect(b.dataset.reco as string)));
  q('#hw-copy')?.addEventListener('click', () => {
    const text = api.log();
    const done = () => {
      copiedAt = Date.now();
      rerender();
    };
    if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(text).then(done, () => prompt(L('Copiez le journal :', 'Copy the log:'), text));
    else prompt(L('Copiez le journal :', 'Copy the log:'), text);
  });

  if (keepId) {
    const again = el.querySelector<HTMLInputElement>(`#${keepId}`);
    if (again) {
      if (keepVal !== undefined) again.value = keepVal;
      again.focus();
    }
  }
}
