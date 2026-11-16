import { getV3Gear, type V3Color, type V3Equipment, type V3Gear } from './visuals.ts';
import { V3_SLOTS } from './icons.ts';

type Actions = {
  equipment(equipment: V3Equipment): void;
  report(error: unknown): void;
  /** Photo de l'article porté par le coureur V3 (articles sans icône Zwift). */
  photo?(item: V3Gear, sex: 'male' | 'female', wanted?: () => boolean): Promise<string>;
};

/** Photos demandées seulement pour les pastilles visibles (le vestiaire compte plus de 1 700 articles). */
let watcher: IntersectionObserver | undefined;
const shots = new WeakMap<Element, () => void>();
function whenVisible(element: Element, shoot: () => void): void {
  watcher ??= new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      watcher?.unobserve(entry.target);
      shots.get(entry.target)?.();
      shots.delete(entry.target);
    }
  }, { rootMargin: '120px' });
  shots.set(element, shoot);
  watcher.observe(element);
}

/** Familles de maillots (préfixe du nom de variante), dans l'ordre d'affichage. */
const JERSEY_FAMILIES: Array<[string, string]> = [
  ['Originals', 'Originaux'],
  ['Pro', 'Équipes pro'],
  ['Events', 'Événements'],
  ['Clubs', 'Clubs'],
  ['Companies', 'Marques'],
  ['Charities', 'Associations'],
  ['Specials', 'Spéciaux'],
  ['Pack', 'Packs'],
];

/** Marques repérées dans le nom ou la variante des accessoires (la marque n'est pas toujours le premier mot). */
const BRANDS: Array<[RegExp, string]> = [
  [/100race/, '100%'], [/abus/, 'Abus'], [/adidas/, 'adidas'], [/^bell|bell(javelin)/, 'Bell'], [/bont/, 'Bont'],
  [/ekoi/, 'Ekoi'], [/fizik/, 'Fizik'], [/garmin/, 'Garmin'], [/giant/, 'Giant'], [/giro(?!d'?italia)/, 'Giro'], [/goodr/, 'Goodr'],
  [/hjc/, 'HJC'], [/kask/, 'Kask'], [/lazer/, 'Lazer'], [/lecol/, 'Le Col'], [/limar/, 'Limar'], [/mavic/, 'Mavic'],
  [/neokyo/, 'Neokyo'], [/nimbl/, 'Nimbl'], [/oakley/, 'Oakley'], [/^poc/, 'POC'], [/rapha/, 'Rapha'], [/redbull/, 'Red Bull'],
  [/roka/, 'Roka'], [/duraace|shimano/, 'Shimano'], [/specialized|s-?works/, 'Specialized'], [/wahoo/, 'Wahoo'],
];
const TEAMS = /ineos|movistar|jumbovisma|fdj|canyonsram|bikeexchange|alpecin|hep2022|cylcingcaphep/;
const BRAND_TYPES = new Set(['HEAD_GEAR', 'GLASSES', 'GLOVES', 'CYCLING_SHOES', 'SOCKS']);
const OTHERS = 'Zwift et autres';
const TEAM_GROUP = 'Équipes';

function familyOf(item: V3Gear): string {
  if (BRAND_TYPES.has(item.type)) {
    const text = (item.name + ' ' + item.variant).toLowerCase().replace(/^(cycling )?(headgear|headhear|glasses|cycling shoes|socks) /, '').replace(/\s+/g, '');
    const brand = BRANDS.find(([pattern]) => pattern.test(text))?.[1];
    return brand ?? (TEAMS.test(text) ? TEAM_GROUP : OTHERS);
  }
  if (item.type !== 'CYCLING_JERSEY') return '';
  const prefix = item.variant.split('_')[0] ?? '';
  return JERSEY_FAMILIES.find(([id]) => prefix.startsWith(id))?.[1] ?? 'Autres';
}

/** Ordre des familles : maillots dans l'ordre fixé, marques par ordre alphabétique, puis équipes et le reste. */
function familyRank(name: string): [number, string] {
  const jersey = JERSEY_FAMILIES.findIndex(([, label]) => label === name);
  if (jersey >= 0) return [jersey, ''];
  if (name === TEAM_GROUP) return [101, ''];
  if (name === OTHERS || name === 'Autres') return [102, ''];
  return [100, name];
}

export function createHueControl(onChange: (hue: number) => void) {
  const field = document.createElement('label');
  field.className = 'field';
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '1';
  input.step = '0.005';
  field.append('Teinte', input);
  field.hidden = true;
  input.onchange = () => onChange(Number(input.value));
  return {
    field,
    set(color?: V3Color, value?: number) {
      field.hidden = color?.hue === undefined;
      if (color?.hue !== undefined) input.value = String(value ?? color.hue);
    },
  };
}

/**
 * Vestiaire V3 sur le modèle du garage Réel : pastilles des catégories (en tête du panneau),
 * nom de la catégorie, légende de l'article survolé, puis pastilles regroupées par famille.
 */
export function addWardrobe(head: HTMLElement, parent: HTMLElement, settings: () => V3Equipment, actions: Actions, character = false): () => void {
  const slots = document.createElement('div');
  slots.className = 'gr-slots';
  const typeName = document.createElement('div');
  typeName.className = 'gr-typename';
  head.append(slots, typeName);

  const panel = document.createElement('div');
  panel.className = 'v3-wardrobe';
  const caption = document.createElement('div');
  caption.className = 'gr-cap empty';
  caption.setAttribute('aria-live', 'polite');
  const capName = document.createElement('b');
  const capState = document.createElement('em');
  const capVariant = document.createElement('span');
  caption.append(capName, capState, capVariant);
  const colorLabel = document.createElement('label');
  colorLabel.className = 'field';
  const color = document.createElement('select');
  color.dataset.dd = 'native';
  colorLabel.append('Coloris', color);
  const hue = createHueControl(value => {
    const item = current();
    if (item) equip(item, Number(color.value), value);
  });
  const tools = document.createElement('div');
  tools.className = 'v3-tools';
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Rechercher';
  search.setAttribute('aria-label', 'Rechercher un équipement');
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'gr-sub';
  reset.textContent = 'D’origine';
  reset.title = 'Rétablir la pièce d’origine';
  reset.disabled = true;
  tools.append(search, reset);
  const grid = document.createElement('div');
  grid.className = 'v3-families';
  const status = document.createElement('output');
  // Nom de l'article au survol, au-dessus de la pastille (la légende peut être sortie de l'écran en défilant).
  const tip = document.createElement('div');
  tip.className = 'v3-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  function showTip(anchor: HTMLElement, text: string) {
    tip.textContent = text;
    tip.hidden = false;
    const box = anchor.getBoundingClientRect();
    const width = tip.offsetWidth;
    tip.style.left = Math.round(Math.min(window.innerWidth - width - 8, Math.max(8, box.left + box.width / 2 - width / 2))) + 'px';
    tip.style.top = Math.round(box.top - tip.offsetHeight - 6) + 'px';
  }
  grid.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });
  panel.append(caption, colorLabel, hue.field, tools, status, grid, tip);
  parent.append(panel);

  let items: V3Gear[] = [];
  let category = '';
  const current = () => {
    const equipped = settings().kit?.[category];
    return items.find(item => item.id === equipped?.id);
  };
  const label = (item: V3Gear) => item.name || item.variant;

  function showCaption(item?: V3Gear) {
    const shown = item ?? current();
    caption.classList.toggle('empty', !shown);
    capName.textContent = shown ? label(shown) : 'Pièce d’origine du personnage';
    capState.textContent = !shown ? '' : shown.id === current()?.id ? 'Équipé' : 'Cliquer pour équiper';
    capVariant.textContent = shown && shown.variant !== shown.name ? shown.variant : '';
  }
  function equip(item: V3Gear, index: number, value?: number) {
    const equipment = settings();
    const kit = { ...equipment.kit };
    if (item.type === 'CYCLING_SHOES') delete kit.RUNNING_SHOES;
    if (item.type === 'CYCLING_JERSEY') {
      delete kit.RUNNING_SHIRTS;
      delete kit.RUNNING_SHORTS;
    }
    kit[item.type] = { id: item.id, color: index, hue: value };
    actions.equipment({ ...equipment, kit });
    markEquipped();
    showColor();
  }
  function markEquipped() {
    const id = String(settings().kit?.[category]?.id ?? '');
    for (const chip of grid.querySelectorAll<HTMLButtonElement>('.gr-chip')) {
      const on = chip.dataset.v3Item === id;
      chip.classList.toggle('on', on);
      chip.setAttribute('aria-pressed', String(on));
      chip.querySelector('u')?.remove();
      if (on) chip.insertAdjacentHTML('beforeend', '<u class="ok">✓</u>');
    }
  }
  function showColor() {
    const item = current();
    const chosen = settings().kit?.[category];
    color.replaceChildren(...(item?.colors ?? []).map((option, index) => new Option(option.name || 'Coloris ' + (index + 1), String(index))));
    if (chosen) color.value = String(chosen.color);
    colorLabel.hidden = !item || color.options.length <= 1;
    reset.disabled = !chosen;
    hue.set(item?.colors[Number(color.value)], chosen?.hue);
    showCaption();
  }
  function chip(item: V3Gear): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gr-chip v3-chip';
    button.dataset.v3Item = String(item.id);
    button.setAttribute('aria-label', label(item));
    const photo = actions.photo;
    if (photo && !item.colors[0]?.icon) {
      // Pas d'icône Zwift : pictogramme en attendant la photo de l'article porté.
      button.classList.add('v3-chip-wait');
      button.insertAdjacentHTML('afterbegin', V3_SLOTS[item.type]?.icon ?? '');
      // Prise abandonnée (rubrique quittée avant son tour) : redemandée quand la pastille réapparaît.
      const take = () => {
        void photo(item, settings().sex ?? 'male', () => button.isConnected && button.getClientRects().length > 0).then(url => {
          const image = document.createElement('img');
          image.src = url;
          image.alt = '';
          button.querySelector('svg')?.remove();
          button.classList.remove('v3-chip-wait', 'v3-chip-text');
          button.prepend(image);
        }).catch(() => { if (button.isConnected) whenVisible(button, take); });
      };
      whenVisible(button, take);
    } else if (item.colors[0]?.preview) {
      const image = document.createElement('img');
      image.src = '/__v3/gear/' + item.id + '/thumb.png';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.alt = '';
      image.onerror = () => { image.remove(); button.classList.add('v3-chip-text'); };
      button.append(image);
    } else button.classList.add('v3-chip-text');
    const name = document.createElement('span');
    name.textContent = label(item);
    button.append(name);
    button.onmouseenter = button.onfocus = () => { showCaption(item); showTip(button, label(item)); };
    button.onmouseleave = button.onblur = () => { showCaption(); tip.hidden = true; };
    button.onclick = () => {
      if (settings().kit?.[item.type]?.id === item.id) return;
      equip(item, 0);
    };
    return button;
  }
  function filter() {
    const query = search.value.trim().toLowerCase();
    const matches = items.filter(item => item.type === category && (item.name + ' ' + item.variant).toLowerCase().includes(query));
    const families = new Map<string, V3Gear[]>();
    for (const item of matches) {
      const family = familyOf(item);
      families.set(family, [...(families.get(family) ?? []), item]);
    }
    const sorted = [...families].sort(([a], [b]) => {
      const [ra, na] = familyRank(a);
      const [rb, nb] = familyRank(b);
      return ra - rb || na.localeCompare(nb, 'fr');
    });
    // Vignettes encore en téléchargement : annulées (le navigateur n'ouvre que quelques connexions à la fois).
    for (const image of grid.querySelectorAll('img')) image.removeAttribute('src');
    grid.replaceChildren(...sorted.flatMap(([family, list]) => {
      const blocks: HTMLElement[] = [];
      if (family || sorted.length > 1) {
        const title = document.createElement('h3');
        title.className = 'mm-presets-title mm-pack';
        title.textContent = family + ' ';
        const count = document.createElement('span');
        count.textContent = String(list.length);
        title.append(count);
        blocks.push(title);
      }
      const row = document.createElement('div');
      row.className = 'mm-items';
      row.append(...list.map(chip));
      blocks.push(row);
      return blocks;
    }));
    status.textContent = matches.length ? '' : 'Aucun équipement ne correspond.';
    markEquipped();
    showColor();
  }
  function choose(type: string) {
    category = type;
    search.value = '';
    for (const tile of slots.querySelectorAll<HTMLButtonElement>('.gr-slot')) {
      const on = tile.dataset.v3Slot === type;
      tile.classList.toggle('on', on);
      tile.setAttribute('aria-pressed', String(on));
    }
    const count = items.filter(item => item.type === type).length;
    typeName.textContent = (V3_SLOTS[type]?.label ?? type) + ' · ' + count;
    filter();
  }
  search.oninput = filter;
  color.onchange = () => {
    const item = current();
    if (item) equip(item, Number(color.value));
  };
  reset.onclick = () => {
    const equipment = settings();
    const kit = { ...equipment.kit };
    delete kit[category];
    actions.equipment({ ...equipment, kit });
    markEquipped();
    showColor();
  };
  let loading = false;
  return () => {
    if (loading || items.length) return;
    loading = true;
    status.textContent = 'Chargement des équipements…';
    void getV3Gear().then(result => {
      items = result.filter(item => ['HEAD_TYPE', 'HAIR', 'FACIAL_HAIR'].includes(item.type) === character);
      const present = new Set(items.map(item => item.type));
      const types = [...Object.keys(V3_SLOTS).filter(type => present.has(type)), ...[...present].filter(type => !(type in V3_SLOTS))];
      slots.style.setProperty('--n', String(types.length));
      for (const type of types) {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'gr-slot';
        tile.dataset.v3Slot = type;
        tile.setAttribute('aria-pressed', 'false');
        const icon = document.createElement('i');
        icon.innerHTML = V3_SLOTS[type]?.icon ?? '';
        const name = document.createElement('small');
        name.textContent = V3_SLOTS[type]?.label ?? items.find(item => item.type === type)?.category ?? type;
        tile.append(icon, name);
        tile.onclick = () => choose(type);
        slots.append(tile);
      }
      status.textContent = '';
      if (types[0]) choose(types[0]);
    }).catch(actions.report).finally(() => { loading = false; });
  };
}
