import { FREEWHEELS } from '../audio/freewheels.ts';
import { BUSES, BUS_LABELS, getMix, setMix, type Bus } from '../audio/mix.ts';
import { getLang } from '../i18n/index.ts';

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
}
