import { FREEWHEELS } from '../audio/freewheels.ts';
import { BUSES, BUS_LABELS, getMix, setMix, type Bus } from '../audio/mix.ts';
import { getLang } from '../i18n/index.ts';
import { askMicAccess, canChooseOutput, getAudioDevices, listAudioDevices, onDevicesChanged, setAudioDevices } from '../audio/devices.ts';
import { music } from '../audio/music.ts';
import { musicSource } from '../audio/musicSource.ts';
import { spotify } from '../audio/spotify.ts';

/**
 * Réglages du son (menu Réglages et menu pause) : volume général, un curseur par catégorie,
 * souffle du coureur activable. Les changements s'appliquent en direct pendant la sortie.
 */
export function renderSoundSettings(el: Element | null): void {
  if (!el) return;
  const fr = getLang() === 'fr';
  const m = getMix();
  const lang = fr ? 'fr' : 'en';
  const label = (k: Bus | 'master') => BUS_LABELS[k][lang];
  const pct = (v: number) => `${Math.round(v * 100)} %`;
  const slider = (k: Bus | 'master') =>
    `<label class="field" title="${BUS_LABELS[k].hint[lang]}">${label(k)} <span data-v="${k}">${pct(m[k])}</span><input data-k="${k}" type="range" min="0" max="1" step="0.05" value="${m[k]}" /></label>`;
  el.innerHTML = `<div class="grid3">${(['master', ...BUSES] as const).map(slider).join('')}</div>
    <label class="field" style="flex-direction:row;align-items:center;gap:8px;margin-top:8px"><input id="snd-breath" type="checkbox" ${m.breathOn ? 'checked' : ''} style="width:auto" />
      ${fr ? 'Entendre mon souffle à l’effort' : 'Hear my breathing when pushing'}</label>`;
  el.insertAdjacentHTML(
    'beforeend',
    `<label class="field" style="margin-top:8px">${fr ? 'Roue libre' : 'Freewheel'}<select id="snd-freewheel">${FREEWHEELS.map(
      (f) => `<option value="${f.id}" ${f.id === m.freewheel ? 'selected' : ''}>${f.label[lang]}</option>`,
    ).join('')}</select></label>`,
  );
  el.querySelector<HTMLSelectElement>('#snd-freewheel')?.addEventListener('change', (e) => setMix({ freewheel: (e.target as HTMLSelectElement).value }));
  for (const input of el.querySelectorAll<HTMLInputElement>('input[data-k]')) {
    input.addEventListener('input', () => {
      const k = input.dataset.k as Bus | 'master';
      const v = Number(input.value);
      setMix({ [k]: v });
      const out = el.querySelector(`[data-v="${k}"]`);
      if (out) out.textContent = pct(v);
    });
  }
  el.querySelector<HTMLInputElement>('#snd-breath')?.addEventListener('change', (e) => setMix({ breathOn: (e.target as HTMLInputElement).checked }));
  renderDeviceSettings(el, fr);
}

/**
 * Musique en sortie (menu pause) : couper / remettre, morceau suivant, volume. Source active : la musique du jeu, ou
 * Spotify une fois connecté (mêmes effets que les touches B / N et que l'appli compagnon).
 */
export function renderMusicControls(el: Element | null): void {
  if (!el) return;
  const fr = getLang() === 'fr';
  el.innerHTML = `<div class="row" style="flex-wrap:wrap;margin-bottom:10px"><button class="btn small" id="snd-music" type="button"></button><button class="btn small" id="snd-next" type="button">${fr ? 'Morceau suivant' : 'Next track'}</button></div>
    <label class="field">${fr ? 'Volume de la musique' : 'Music volume'} <span id="snd-music-v">${Math.round(music.volume * 100)} %</span><input id="snd-music-vol" type="range" min="0" max="1" step="0.05" value="${music.volume}" /></label>`;
  const button = el.querySelector<HTMLButtonElement>('#snd-music');
  const draw = (playing: boolean): void => {
    if (button) button.textContent = playing ? (fr ? '♪ Couper la musique' : '♪ Mute the music') : fr ? '♪ Remettre la musique' : '♪ Turn the music back on';
  };
  const state = async (): Promise<boolean> => (musicSource() === 'spotify' ? !!(await spotify.nowPlaying())?.isPlaying : music.enabled);
  void state().then(draw);
  button?.addEventListener('click', () => {
    if (musicSource() === 'spotify') void spotify.toggleSmart().then(draw);
    else draw(music.toggle());
  });
  el.querySelector('#snd-next')?.addEventListener('click', () => {
    if (musicSource() === 'spotify') void spotify.next();
    else music.next();
  });
  el.querySelector<HTMLInputElement>('#snd-music-vol')?.addEventListener('input', (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    if (musicSource() === 'spotify') spotify.setHereVolume(v);
    music.setVolume(v);
    const out = el.querySelector('#snd-music-v');
    if (out) out.textContent = `${Math.round(v * 100)} %`;
  });
}

const escHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Micro et sortie audio : listes des appareils du système. Les noms n'apparaissent qu'après l'accord du
 * navigateur pour le micro (bouton « Autoriser »). Le choix s'applique tout de suite (jeu, musique, voix).
 */
function renderDeviceSettings(el: Element, fr: boolean): void {
  const box = document.createElement('div');
  box.className = 'snd-devices';
  box.style.marginTop = '12px';
  el.appendChild(box);
  let stop = (): void => undefined;
  const draw = async (): Promise<void> => {
    if (!box.isConnected) return stop();
    const { inputs, outputs, labelled } = await listAudioDevices();
    const cur = getAudioDevices();
    const options = (list: MediaDeviceInfo[], sel: string): string =>
      `<option value="">${fr ? 'Par défaut du système' : 'System default'}</option>${list
        .map((d, i) => `<option value="${escHtml(d.deviceId)}" ${d.deviceId === sel ? 'selected' : ''}>${escHtml(d.label || `${fr ? 'Appareil' : 'Device'} ${i + 1}`)}</option>`)
        .join('')}`;
    const out = canChooseOutput();
    box.innerHTML = `<div class="grid3" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">
        <label class="field">${fr ? 'Microphone' : 'Microphone'}<select id="snd-mic">${options(inputs, cur.micId)}</select></label>
        ${
          out
            ? `<label class="field">${fr ? 'Sortie audio (haut-parleurs, casque)' : 'Audio output (speakers, headset)'}<select id="snd-out">${options(outputs, cur.speakerId)}</select></label>`
            : `<p class="mm-hint" style="align-self:end">${fr ? 'Ce navigateur ne permet pas de choisir la sortie audio : utilise celle du système (ou Chrome / Edge / l’appli Windows).' : 'This browser cannot choose the audio output: use the system one (or Chrome / Edge / the Windows app).'}</p>`
        }
      </div>
      ${labelled ? '' : `<button class="mm-link" id="snd-allow" type="button">${fr ? 'Autoriser le micro pour afficher les noms des appareils' : 'Allow the microphone to show device names'}</button>`}
      <p class="mm-hint" id="snd-dev-msg"></p>`;
    box.querySelector<HTMLSelectElement>('#snd-mic')?.addEventListener('change', (e) => setAudioDevices({ micId: (e.target as HTMLSelectElement).value }));
    box.querySelector<HTMLSelectElement>('#snd-out')?.addEventListener('change', (e) => setAudioDevices({ speakerId: (e.target as HTMLSelectElement).value }));
    box.querySelector('#snd-allow')?.addEventListener('click', () => {
      void askMicAccess().then((ok) => {
        if (ok) void draw();
        else {
          const m = box.querySelector('#snd-dev-msg');
          if (m) m.textContent = fr ? 'Accès au micro refusé : autorise-le dans les réglages du navigateur.' : 'Microphone access denied: allow it in the browser settings.';
        }
      });
    });
  };
  stop = onDevicesChanged(() => void draw());
  void draw();
}
