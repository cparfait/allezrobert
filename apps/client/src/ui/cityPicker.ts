import { cityOf, loadCommunes, searchCommunes, type Commune, type PlayerCity } from '../game/communes.ts';
import './cityPicker.css';

const TEXT = {
  fr: { placeholder: 'Nom ou code postal', none: 'Aucune commune trouvée.', error: 'Liste des communes indisponible.', clear: 'Enlever ma ville' },
  en: { placeholder: 'Name or postcode', none: 'No town found.', error: 'Town list unavailable.', clear: 'Remove my town' },
} as const;

const esc = (value: string): string => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** Champ « Ma ville » du profil : suggestions au fil de la saisie, clavier compris. */
export function cityPickerHtml(city: PlayerCity | undefined, lang: 'fr' | 'en'): string {
  const copy = TEXT[lang];
  return `<div class="cp" id="m-city-box">
    <input id="m-city" class="mm-input" type="text" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false" aria-controls="m-city-list" aria-autocomplete="list"
      placeholder="${copy.placeholder}" value="${city ? esc(`${city.name} (${city.code})`) : ''}" />
    ${city ? `<button type="button" class="cp-clear" aria-label="${copy.clear}" title="${copy.clear}">×</button>` : ''}
    <ul class="cp-list" id="m-city-list" role="listbox" hidden></ul>
  </div>`;
}

export function bindCityPicker(root: HTMLElement, lang: 'fr' | 'en', current: () => PlayerCity | undefined, pick: (city: PlayerCity | undefined) => void): void {
  const box = root.querySelector<HTMLElement>('#m-city-box');
  const input = box?.querySelector<HTMLInputElement>('#m-city');
  const list = box?.querySelector<HTMLUListElement>('.cp-list');
  if (!box || !input || !list) return;
  const copy = TEXT[lang];
  let found: Commune[] = [];
  let active = -1;
  let request = 0;
  const close = () => {
    list.hidden = true;
    active = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };
  const show = (html: string) => {
    list.innerHTML = html;
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };
  const mark = (i: number) => {
    active = i;
    list.querySelectorAll<HTMLElement>('[role=option]').forEach((el, k) => {
      el.setAttribute('aria-selected', String(k === i));
      if (k === i) el.scrollIntoView({ block: 'nearest' });
    });
    if (i >= 0) input.setAttribute('aria-activedescendant', `m-city-o${i}`);
  };
  const choose = (i: number) => {
    const c = found[i];
    if (!c) return;
    close();
    pick(cityOf(c, input.value));
  };
  const search = async () => {
    const q = input.value;
    const token = ++request;
    if (q.trim().length < 2) return close();
    try {
      const index = await loadCommunes();
      if (token !== request || !input.isConnected) return;
      found = searchCommunes(index, q);
      show(found.length ? found.map((c, i) => `<li role="option" id="m-city-o${i}" aria-selected="false" data-city="${i}"><b>${esc(c.name)}</b><small>${esc(c.codes.length > 1 ? `${c.codes[0]}…` : c.codes[0]!)}</small></li>`).join('') : `<li class="cp-none">${copy.none}</li>`);
      active = -1;
      if (found.length) mark(0);
    } catch {
      if (token === request && input.isConnected) show(`<li class="cp-none">${copy.error}</li>`);
    }
  };
  input.addEventListener('focus', () => {
    input.select();
    // Chargée d'avance : première frappe sans attente.
    void loadCommunes().catch(() => undefined);
  });
  input.addEventListener('input', () => void search());
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (found.length) mark((active + (e.key === 'ArrowDown' ? 1 : found.length - 1)) % found.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(Math.max(0, active));
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  });
  // Avant la perte du focus : le clic doit choisir.
  list.addEventListener('mousedown', (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('[data-city]');
    if (!li) return;
    e.preventDefault();
    choose(Number(li.dataset.city));
  });
  input.addEventListener('blur', () => {
    request++;
    close();
    // Saisie inachevée : le champ revient à la ville enregistrée.
    const c = current();
    input.value = c ? `${c.name} (${c.code})` : '';
  });
  box.querySelector('.cp-clear')?.addEventListener('click', () => pick(undefined));
}
