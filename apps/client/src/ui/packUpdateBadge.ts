/**
 * Mise à jour des zones téléchargées (world/packs.ts) : au lancement, une pastille en bas à gauche propose la
 * nouvelle version des zones regénérées (« Mettre à jour » / « Plus tard »), sans la forcer. Acceptée, elle montre
 * l'avancement (nom de la zone, pourcentage, barre), au menu comme en sortie, puis « Zones à jour ». Refusée, elle est
 * reproposée au prochain lancement ; en attendant, le jeu lit ces zones en ligne.
 */
import './packUpdateBadge.css';
import { getLang } from '../i18n/index.ts';
import { formatBytes, onPackUpdate, stalePacks, updateStalePacks } from '../world/packs.ts';
import { polyWorld } from '../world/polyWorlds.ts';

const COPY = {
  fr: {
    ask: (n: number) => (n > 1 ? `${n} zones ont une nouvelle version` : 'Nouvelle version d’une zone'),
    update: 'Mettre à jour',
    later: 'Plus tard',
    meanwhile: 'D’ici là, elle est lue en ligne.',
    meanwhileMany: 'D’ici là, elles sont lues en ligne.',
    updating: 'Mise à jour',
    of: 'sur',
    done: 'Zones à jour',
    failed: 'Mise à jour impossible, elle sera reproposée au prochain lancement',
  },
  en: {
    ask: (n: number) => (n > 1 ? `${n} areas have a new version` : 'New version of an area'),
    update: 'Update',
    later: 'Later',
    meanwhile: 'Until then it is streamed online.',
    meanwhileMany: 'Until then they are streamed online.',
    updating: 'Updating',
    of: 'of',
    done: 'Areas up to date',
    failed: 'Update failed, it will be offered again at next launch',
  },
};

let badge: HTMLElement | null = null;

function mount(): HTMLElement {
  if (badge) return badge;
  const el = document.createElement('div');
  el.className = 'pu-badge';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.hidden = true;
  document.body.append(el);
  let hideTimer = 0;
  onPackUpdate((e) => {
    const lang = getLang() === 'en' ? 'en' : 'fr';
    const c = COPY[lang];
    window.clearTimeout(hideTimer);
    el.hidden = false;
    el.classList.remove('is-ask', 'is-done', 'is-failed');
    if (e.kind === 'progress') {
      const name = polyWorld(e.id)?.title[lang] ?? e.name;
      const p = e.total > 0 ? Math.min(100, Math.floor((e.done / e.total) * 100)) : 0;
      const count = e.count > 1 ? `${e.index + 1} ${c.of} ${e.count} · ` : '';
      el.innerHTML = `<div class="pu-row"><span class="pu-spin" aria-hidden="true"></span><b class="pu-title"></b><span class="pu-pct">${p} %</span></div><div class="pu-bar"><i style="width:${p}%"></i></div><small class="pu-sub"></small>`;
      el.querySelector('.pu-title')!.textContent = `${c.updating} : ${name}`;
      el.querySelector('.pu-sub')!.textContent = `${count}${formatBytes(e.done, lang === 'fr')} / ${formatBytes(e.total, lang === 'fr')}`;
      return;
    }
    const ok = e.failed === 0;
    el.classList.add(ok ? 'is-done' : 'is-failed');
    el.innerHTML = `<div class="pu-row"><b class="pu-title"></b><span class="pu-pct">${ok ? '✓' : ''}</span></div>`;
    el.querySelector('.pu-title')!.textContent = ok ? c.done : c.failed;
    hideTimer = window.setTimeout(() => (el.hidden = true), ok ? 4000 : 12000);
  });
  badge = el;
  return el;
}

/** Au lancement : propose la mise à jour des zones regénérées (rien s'il n'y en a pas, ou hors ligne). */
export async function proposePackUpdates(): Promise<void> {
  if (typeof document === 'undefined') return;
  const stale = await stalePacks();
  if (!stale.length) return;
  const el = mount();
  const lang = getLang() === 'en' ? 'en' : 'fr';
  const c = COPY[lang];
  const names = stale.map((z) => polyWorld(z.id)?.title[lang] ?? z.name).join(', ');
  const bytes = stale.reduce((s, z) => s + z.bytes, 0);
  el.classList.remove('is-done', 'is-failed');
  el.classList.add('is-ask');
  el.innerHTML = `<div class="pu-row"><b class="pu-title"></b></div><small class="pu-sub"></small><div class="pu-actions"><button type="button" class="pu-go" data-pu="go"></button><button type="button" class="pu-later" data-pu="later"></button></div>`;
  el.querySelector('.pu-title')!.textContent = c.ask(stale.length);
  el.querySelector('.pu-sub')!.textContent = `${names} · ${formatBytes(bytes, lang === 'fr')}. ${stale.length > 1 ? c.meanwhileMany : c.meanwhile}`;
  el.querySelector('[data-pu="go"]')!.textContent = c.update;
  el.querySelector('[data-pu="later"]')!.textContent = c.later;
  el.hidden = false;
  el.querySelector<HTMLButtonElement>('[data-pu="go"]')!.addEventListener('click', () => {
    el.classList.remove('is-ask');
    void updateStalePacks(stale.map((z) => z.id));
  });
  el.querySelector<HTMLButtonElement>('[data-pu="later"]')!.addEventListener('click', () => {
    el.hidden = true;
  });
}
