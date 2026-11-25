import { getV3Gear, isBare, itemFits, resolvedBody, V3_DEFAULT_KIT, V3_HAIR_COLORS, V3_OPENINGS, V3_POCKETS, V3_ZIPS, type V3Color, type V3Equipment, type V3Gear, type V3SockHeight } from './visuals.ts';
import { gearLevel, playerLevel } from './levels.ts';
import { V3_SLOTS } from './icons.ts';
import { v3Select } from './dropdown.ts';
import { v3Shown } from './catalogAdmin.ts';
import { css, shiftHue, type Rgb } from './swatch.ts';
import { needsPhoto } from './thumbnails.ts';
import { v3Resource } from '../engine/v3Access.ts';
import { strings } from '../i18n/index.ts';

/** Textes du vestiaire Beta ; `{n}`, `{slot}`… : valeurs remplacées à l'appel (voir `fill`). */
const S = strings(
  {
    famOriginals: 'Originaux',
    famPro: 'Équipes pro',
    famEvents: 'Événements',
    famClubs: 'Clubs',
    famCompanies: 'Marques',
    famCharities: 'Associations',
    famSpecials: 'Spéciaux',
    famPacks: 'Packs',
    others: 'Autres accessoires',
    teams: 'Équipes',
    otherJerseys: 'Autres',
    tint: 'Teinte',
    colourway: 'Coloris',
    colourwayN: 'Coloris {n}',
    search: 'Rechercher',
    searchAria: 'Rechercher un équipement',
    stock: 'D’origine',
    stockTitle: 'Rétablir la pièce d’origine',
    remove: 'Retirer',
    removeTitle: 'Retirer la pièce ({slot})',
    sockAria: 'Hauteur des chaussettes',
    sockLow: 'Basses',
    sockMid: 'Mi-hautes',
    sockHigh: 'Hautes',
    height: 'Hauteur',
    sleevesAria: 'Manches du maillot',
    sleeves: 'Manches',
    pocketsAria: 'Poches du maillot',
    pockets: 'Poches',
    zipAria: 'Fermeture du maillot',
    zip: 'Fermeture',
    otherColour: 'Autre couleur',
    hairColour: 'Couleur des cheveux',
    beardColour: 'Couleur de la barbe',
    removed: 'Retiré',
    characterStock: 'Pièce d’origine du personnage',
    equipped: 'Équipé',
    clickToEquip: 'Cliquer pour équiper',
    lockState: 'Niveau {need} · dans {n} niv.',
    preview: 'Aperçu · {lock}',
    noMatch: 'Aucun équipement ne correspond.',
    loading: 'Chargement des équipements…',
  },
  {
    famOriginals: 'Originals',
    famPro: 'Pro teams',
    famEvents: 'Events',
    famClubs: 'Clubs',
    famCompanies: 'Brands',
    famCharities: 'Charities',
    famSpecials: 'Specials',
    famPacks: 'Packs',
    others: 'Other accessories',
    teams: 'Teams',
    otherJerseys: 'Others',
    tint: 'Tint',
    colourway: 'Colourway',
    colourwayN: 'Colourway {n}',
    search: 'Search',
    searchAria: 'Search gear',
    stock: 'Stock',
    stockTitle: 'Restore the stock item',
    remove: 'Remove',
    removeTitle: 'Remove the item ({slot})',
    sockAria: 'Sock height',
    sockLow: 'Low',
    sockMid: 'Mid',
    sockHigh: 'High',
    height: 'Height',
    sleevesAria: 'Jersey sleeves',
    sleeves: 'Sleeves',
    pocketsAria: 'Jersey pockets',
    pockets: 'Pockets',
    zipAria: 'Jersey zip',
    zip: 'Zip',
    otherColour: 'Other colour',
    hairColour: 'Hair colour',
    beardColour: 'Beard colour',
    removed: 'Removed',
    characterStock: 'Character’s stock item',
    equipped: 'Equipped',
    clickToEquip: 'Click to equip',
    lockState: 'Level {need} · in {n} lv.',
    preview: 'Preview · {lock}',
    noMatch: 'No gear matches.',
    loading: 'Loading gear…',
  },
);
/** Gabarit du dictionnaire avec ses valeurs (`{n}` → 12). */
const fill = (text: string, values: Record<string, string | number>): string => text.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));

type Actions = {
  equipment(equipment: V3Equipment): void;
  report(error: unknown): void;
  /** Photo de l'article porté par le coureur V3 (articles sans icône dans le catalogue). */
  photo?(item: V3Gear, sex: 'male' | 'female', wanted?: () => boolean): Promise<string>;
  /** Catégorie ouverte (les coiffures se montrent tête nue). */
  view?(type: string): void;
  /** Silhouette effective du coureur V3 (articles réservés à l'autre silhouette masqués). */
  sex?(): 'male' | 'female' | undefined;
  /** Article pas encore gagné : essayé sur le coureur sans être enregistré (comme aux garages Réel et Poly). */
  tryOn?(item: V3Gear): void;
};

/** Cadenas des articles pas encore gagnés (même pastille que les garages Réel et Poly). */
export const V3_LOCK = '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

/** Photos demandées seulement pour les pastilles visibles (le vestiaire compte plus de 1 700 articles). */
let watcher: IntersectionObserver | undefined;
const shots = new WeakMap<Element, () => void>();
/** Élément à l'écran (dans la zone défilante du panneau, à 150 px près) au moment présent. */
export function onScreen(element: Element): boolean {
  if (!element.isConnected) return false;
  const rect = element.getBoundingClientRect();
  if (!rect.width && !rect.height) return false;
  const area = (element.closest('.gr-body') ?? document.documentElement).getBoundingClientRect();
  return rect.bottom > area.top - 150 && rect.top < area.bottom + 150;
}

export function whenVisible(element: Element, shoot: () => void): void {
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
const JERSEY_FAMILIES: Array<[string, Parameters<typeof S>[0]]> = [
  ['Originals', 'famOriginals'],
  ['Pro', 'famPro'],
  ['Events', 'famEvents'],
  ['Clubs', 'famClubs'],
  ['Companies', 'famCompanies'],
  ['Charities', 'famCharities'],
  ['Specials', 'famSpecials'],
  ['Pack', 'famPacks'],
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
// Noms de groupe affichés (et clés des familles ouvertes) dans la langue du moment.
const OTHERS = () => S('others');
const TEAM_GROUP = () => S('teams');

function familyOf(item: V3Gear): string {
  if (BRAND_TYPES.has(item.type)) {
    const text = (item.name + ' ' + item.variant).toLowerCase().replace(/^(cycling )?(headgear|headhear|glasses|cycling shoes|socks) /, '').replace(/\s+/g, '');
    const brand = BRANDS.find(([pattern]) => pattern.test(text))?.[1];
    return brand ?? (TEAMS.test(text) ? TEAM_GROUP() : OTHERS());
  }
  if (item.type !== 'CYCLING_JERSEY') return '';
  const prefix = item.variant.split('_')[0] ?? '';
  const key = JERSEY_FAMILIES.find(([id]) => prefix.startsWith(id))?.[1];
  return key ? S(key) : S('otherJerseys');
}

/** Ordre des familles : maillots dans l'ordre fixé, marques par ordre alphabétique, puis équipes et le reste. */
function familyRank(name: string): [number, string] {
  const jersey = JERSEY_FAMILIES.findIndex(([, key]) => S(key) === name);
  if (jersey >= 0) return [jersey, ''];
  if (name === TEAM_GROUP()) return [101, ''];
  if (name === OTHERS() || name === S('otherJerseys')) return [102, ''];
  return [100, name];
}

/**
 * Réglage de la teinte d'un coloris : décale la teinte des parties colorées de la peinture (le noir, le
 * gris et le blanc ne changent pas). Avec la couleur dominante du coloris (`paint`), la piste montre les couleurs
 * obtenues et une pastille la couleur choisie.
 */
export function createHueControl(onChange: (hue: number) => void, label = S('tint'), hint?: string) {
  const field = document.createElement('label');
  field.className = 'field v3-hue';
  const head = document.createElement('span');
  head.className = 'v3-hue-head';
  const preview = document.createElement('i');
  preview.className = 'v3-hue-preview';
  preview.hidden = true;
  head.append(label, preview);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '1';
  input.step = '0.005';
  field.append(head, input);
  if (hint) {
    const note = document.createElement('small');
    note.className = 'v3-hue-hint';
    note.textContent = hint;
    field.append(note);
  }
  field.hidden = true;
  let base: Rgb | undefined;
  const show = () => {
    preview.hidden = !base;
    if (base) preview.style.background = css(shiftHue(base, Number(input.value)));
  };
  input.oninput = show;
  input.onchange = () => onChange(Number(input.value));
  return {
    field,
    set(color?: V3Color, value?: number) {
      field.hidden = color?.hue === undefined;
      if (color?.hue !== undefined) input.value = String(value ?? color.hue);
      show();
    },
    /** Couleur dominante du coloris sans teinte : piste en dégradé des couleurs possibles. */
    paint(color?: Rgb) {
      base = color;
      input.classList.toggle('v3-hue-track', !!color);
      input.style.background = color
        ? 'linear-gradient(to right, ' + Array.from({ length: 13 }, (_, i) => css(shiftHue(color, i / 12))).join(', ') + ')'
        : '';
      show();
    },
  };
}

/**
 * Vestiaire V3 sur le modèle du garage Réel : pastilles des catégories (en tête du panneau),
 * nom de la catégorie, légende de l'article survolé, puis pastilles regroupées par famille.
 */
export function addWardrobe(head: HTMLElement, parent: HTMLElement, settings: () => V3Equipment, actions: Actions, character = false): { open(): void; refresh(): void; reveal(item: V3Gear): Promise<HTMLElement | null>; focus(type: string): Promise<V3Gear | undefined> } {
  const riderSex = () => actions.sex?.() ?? settings().sex ?? 'male';
  // Articles de la silhouette seulement (sexe du catalogue ou indiqué par le nom).
  const fits = (item: V3Gear) => itemFits(item, riderSex());
  // Tout le catalogue est montré ; les articles pas encore gagnés (progression Beta, levels.ts) portent un cadenas
  // et s'essaient sans s'équiper. Celui porté compte comme gagné.
  const earned = (item: V3Gear) => settings().kit?.[item.type]?.id === item.id || gearLevel(item, items) <= playerLevel();
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
  const capThumb = document.createElement('span');
  capThumb.className = 'v3-cap-thumb';
  caption.classList.add('v3-cap');
  caption.append(capThumb, capName, capState);
  let capShown: V3Gear | undefined;
  const colorLabel = document.createElement('label');
  colorLabel.className = 'field';
  const color = document.createElement('select');
  colorLabel.append(S('colourway'), color);
  v3Select(color);
  const hue = createHueControl(value => {
    const item = current();
    if (item) equip(item, Number(color.value), value);
  });
  const tools = document.createElement('div');
  tools.className = 'v3-tools';
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = S('search');
  search.setAttribute('aria-label', S('searchAria'));
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'gr-sub';
  reset.textContent = S('stock');
  reset.title = S('stockTitle');
  reset.disabled = true;
  // Retirer la pièce (gants, casque, lunettes, chaussettes) : article « None » du catalogue, mains ou tête nues.
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'gr-sub';
  remove.textContent = S('remove');
  remove.hidden = true;
  tools.append(search, remove, reset);
  const grid = document.createElement('div');
  grid.className = 'v3-families';
  const status = document.createElement('output');
  // Nom de l'article au survol, au-dessus de la pastille (la légende peut être sortie de l'écran en défilant).
  // Attachée à la page : dans le panneau (flou d'arrière-plan), une position fixe serait relative au panneau et rognée.
  const tip = document.createElement('div');
  tip.className = 'v3-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  function showTip(anchor: HTMLElement, text: string) {
    if (!tip.isConnected) document.body.append(tip);
    tip.textContent = text;
    tip.hidden = false;
    const box = anchor.getBoundingClientRect();
    const width = tip.offsetWidth;
    tip.style.left = Math.round(Math.min(window.innerWidth - width - 8, Math.max(8, box.left + box.width / 2 - width / 2))) + 'px';
    tip.style.top = Math.round(box.top - tip.offsetHeight - 6) + 'px';
  }
  document.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true, capture: true });
  // Hauteur des chaussettes (trois maillages du coureur V3), comme le réglage « Hauteur » du garage Réel.
  const sockField = document.createElement('div');
  sockField.className = 'field';
  const sockSeg = document.createElement('div');
  sockSeg.className = 'mm-seg';
  sockSeg.setAttribute('role', 'radiogroup');
  sockSeg.setAttribute('aria-label', S('sockAria'));
  const sockHeights: Array<[V3SockHeight, string]> = [['low', S('sockLow')], ['mid', S('sockMid')], ['high', S('sockHigh')]];
  function showSockHeight() {
    const current = settings().sockHeight ?? 'low';
    for (const button of sockSeg.querySelectorAll<HTMLButtonElement>('button')) {
      const on = button.dataset.v3Sock === current;
      button.classList.toggle('on', on);
      button.setAttribute('aria-checked', String(on));
    }
  }
  for (const [height, text] of sockHeights) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.dataset.v3Sock = height;
    button.textContent = text;
    button.onclick = () => {
      actions.equipment({ ...settings(), sockHeight: height });
      showSockHeight();
    };
    sockSeg.append(button);
  }
  sockField.append(S('height'), sockSeg);
  sockField.hidden = true;
  // Manches du maillot (pièces du maillage du corps) : courtes d'origine, longues avec col rond (coureur seulement).
  const zipField = document.createElement('div');
  zipField.className = 'field';
  const zipSeg = document.createElement('div');
  zipSeg.className = 'mm-seg';
  zipSeg.setAttribute('role', 'radiogroup');
  zipSeg.setAttribute('aria-label', S('sleevesAria'));
  function showZipChoice() {
    const current = settings().zip ?? 0;
    zipSeg.querySelectorAll<HTMLButtonElement>('button').forEach((button, i) => {
      const on = i === current;
      button.classList.toggle('on', on);
      button.setAttribute('aria-checked', String(on));
    });
  }
  V3_ZIPS.forEach((text, zip) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.textContent = text;
    button.onclick = () => {
      actions.equipment({ ...settings(), zip });
      showZipChoice();
    };
    zipSeg.append(button);
  });
  zipField.append(S('sleeves'), zipSeg);
  zipField.hidden = true;
  // Poches arrière du maillot, de vides (d'origine) à pleines.
  const pocketField = document.createElement('div');
  pocketField.className = 'field';
  const pocketSeg = document.createElement('div');
  pocketSeg.className = 'mm-seg';
  pocketSeg.setAttribute('role', 'radiogroup');
  pocketSeg.setAttribute('aria-label', S('pocketsAria'));
  function showPocketChoice() {
    const current = settings().pockets ?? 0;
    pocketSeg.querySelectorAll<HTMLButtonElement>('button').forEach((button, i) => {
      const on = i === current;
      button.classList.toggle('on', on);
      button.setAttribute('aria-checked', String(on));
    });
  }
  V3_POCKETS.forEach((text, pockets) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.textContent = text;
    button.onclick = () => {
      actions.equipment({ ...settings(), pockets });
      showPocketChoice();
    };
    pocketSeg.append(button);
  });
  pocketField.append(S('pockets'), pocketSeg);
  pocketField.hidden = true;
  // Fermeture éclair : maillot fermé (d'origine) ou ouvert sur la poitrine, pour les manches courtes comme longues.
  const openField = document.createElement('div');
  openField.className = 'field';
  const openSeg = document.createElement('div');
  openSeg.className = 'mm-seg';
  openSeg.setAttribute('role', 'radiogroup');
  openSeg.setAttribute('aria-label', S('zipAria'));
  function showOpenChoice() {
    const current = settings().open ? 1 : 0;
    openSeg.querySelectorAll<HTMLButtonElement>('button').forEach((button, i) => {
      const on = i === current;
      button.classList.toggle('on', on);
      button.setAttribute('aria-checked', String(on));
    });
  }
  V3_OPENINGS.forEach((text, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.textContent = text;
    button.onclick = () => {
      actions.equipment({ ...settings(), open: index === 1 });
      showOpenChoice();
    };
    openSeg.append(button);
  });
  openField.append(S('zip'), openSeg);
  openField.hidden = true;
  // Couleur des cheveux et de la barbe : six cases des planches de textures, en pastilles comme le garage Réel.
  function hairColorRow(text: string, key: 'hairColor' | 'beardColor', tintKey: 'hairTint' | 'beardTint') {
    const row = document.createElement('div');
    row.className = 'gr-colors';
    const small = document.createElement('small');
    small.textContent = text;
    const swatches = document.createElement('div');
    // Autre couleur : palette libre (comme le garage Réel), appliquée sur la case grise de la planche de textures.
    const custom = document.createElement('label');
    custom.className = 'gr-sw gr-custom';
    custom.title = S('otherColour');
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.setAttribute('aria-label', S('otherColour'));
    custom.append(picker);
    picker.oninput = () => {
      actions.equipment({ ...settings(), [tintKey]: picker.value });
      sync();
    };
    const sync = () => {
      const tint = settings()[tintKey];
      const chosen = tint ? -1 : settings()[key] ?? 0;
      swatches.querySelectorAll<HTMLButtonElement>('button').forEach((button, i) => {
        button.classList.toggle('on', i === chosen);
        button.setAttribute('aria-pressed', String(i === chosen));
      });
      custom.classList.toggle('on', !!tint);
      custom.style.background = tint ?? '';
      picker.value = tint ?? '#7a5230';
    };
    V3_HAIR_COLORS.forEach(({ name, swatch }, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'gr-sw';
      button.style.background = swatch;
      button.title = name;
      button.setAttribute('aria-label', name);
      button.onclick = () => {
        actions.equipment({ ...settings(), [key]: i, [tintKey]: undefined });
        sync();
      };
      swatches.append(button);
    });
    swatches.append(custom);
    row.append(small, swatches);
    row.hidden = true;
    return { row, sync };
  }
  const hairColor = hairColorRow(S('hairColour'), 'hairColor', 'hairTint');
  const beardColor = hairColorRow(S('beardColour'), 'beardColor', 'beardTint');
  // Personnage (tête, cheveux, barbe) : pas de carte « Équipé », l'article choisi est coché dans la grille.
  caption.hidden = character;
  panel.append(caption, sockField, zipField, openField, pocketField, hairColor.row, beardColor.row, colorLabel, hue.field, tools, status, grid);
  parent.append(panel);

  let items: V3Gear[] = [];
  let category = '';
  const current = () => {
    const equipped = settings().kit?.[category];
    return items.find(item => item.id === equipped?.id);
  };
  const label = (item: V3Gear) => item.name || item.variant;
  const bareItem = () => items.find(item => item.type === category && isBare(item));

  function showCaption(item?: V3Gear) {
    const shown = item ?? current();
    const bare = !!shown && isBare(shown);
    caption.classList.toggle('empty', !shown || bare);
    capName.textContent = bare ? S('removed') : shown ? label(shown) : S('characterStock');
    capState.textContent = !shown || bare ? '' : shown.id === current()?.id ? S('equipped')
      : !earned(shown) ? lockText(shown) : S('clickToEquip');
    // Vignette de l'article (pastille non cliquable), refaite seulement quand l'article change.
    if (shown !== capShown) {
      capShown = shown;
      const thumb = shown && !bare ? chip(shown) : undefined;
      if (thumb) {
        thumb.tabIndex = -1;
        thumb.setAttribute('aria-hidden', 'true');
        thumb.onclick = thumb.onmouseenter = thumb.onmouseleave = thumb.onfocus = thumb.onblur = null;
      }
      capThumb.replaceChildren(...(thumb ? [thumb] : []));
    }
  }
  /** « Niveau 12 · dans 11 niv. » : article pas encore gagné. */
  function lockText(item: V3Gear): string {
    const level = gearLevel(item, items);
    return fill(S('lockState'), { need: level, n: Math.max(1, level - playerLevel()) });
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
      chip.querySelector('u.ok')?.remove();
      if (on) chip.insertAdjacentHTML('beforeend', '<u class="ok">✓</u>');
    }
  }
  function showColor() {
    const item = current();
    const chosen = settings().kit?.[category];
    color.replaceChildren(...(item?.colors ?? []).map((option, index) => new Option(option.name || fill(S('colourwayN'), { n: index + 1 }), String(index))));
    if (chosen) color.value = String(chosen.color);
    colorLabel.hidden = !item || color.options.length <= 1;
    const origin = V3_DEFAULT_KIT[category];
    reset.disabled = origin ? chosen?.id === origin.id : !chosen;
    const none = bareItem();
    remove.hidden = !none;
    remove.disabled = !!none && chosen?.id === none.id;
    remove.title = fill(S('removeTitle'), { slot: (V3_SLOTS[category]?.label ?? category).toLowerCase() });
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
    if (photo && needsPhoto(item)) {
      // Maillots toujours photographiés (fond transparent) : leurs icônes dans le catalogue ont un fond noir opaque.
      // Pas d'icône dans le catalogue : pictogramme en attendant la photo de l'article porté.
      button.classList.add('v3-chip-wait');
      button.insertAdjacentHTML('afterbegin', V3_SLOTS[item.type]?.icon ?? '');
      // Prise abandonnée (rubrique quittée avant son tour) : redemandée quand la pastille réapparaît.
      const take = () => {
        void photo(item, riderSex(), () => onScreen(button)).then(url => {
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
      image.src = v3Resource('gear/' + item.id + '/thumb.png');
      image.loading = 'lazy';
      image.decoding = 'async';
      image.alt = '';
      image.onerror = () => { image.remove(); button.classList.add('v3-chip-text'); };
      button.append(image);
    } else button.classList.add('v3-chip-text');
    const name = document.createElement('span');
    name.textContent = label(item);
    button.append(name);
    const locked = !earned(item);
    if (locked) {
      button.classList.add('locked');
      button.insertAdjacentHTML('beforeend', '<u class="v3-lock">' + V3_LOCK + '</u>');
    }
    button.onmouseenter = button.onfocus = () => { showCaption(item); showTip(button, label(item) + (locked ? ' — ' + lockText(item) : '')); };
    button.onmouseleave = button.onblur = () => { showCaption(); tip.hidden = true; };
    button.onclick = () => {
      if (settings().kit?.[item.type]?.id === item.id) return;
      // Pas encore gagné : essai sur le coureur (non enregistré), la légende le dit.
      if (locked) {
        actions.tryOn?.(item);
        showCaption(item);
        capState.textContent = fill(S('preview'), { lock: lockText(item) });
        return;
      }
      equip(item, 0);
    };
    return button;
  }
  /** Familles ouvertes, par catégorie : toutes repliées à l'arrivée dans la rubrique (l'article porté est en tête). */
  const openFamilies = new Set<string>();
  function filter() {
    const query = search.value.trim().toLowerCase();
    // Objets masqués par la page de gestion : hors de la liste (un coureur qui les porte les garde).
    const matches = items.filter(item => item.type === category && fits(item) && !isBare(item) && v3Shown('gear', item.id) && (item.name + ' ' + item.variant).toLowerCase().includes(query));
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
    // Toutes les familles (maillots, marques) repliées par défaut ; une recherche les ouvre toutes.
    const foldable = !query && sorted.length > 1;
    // Vignettes encore en téléchargement : annulées (le navigateur n'ouvre que quelques connexions à la fois).
    for (const image of grid.querySelectorAll('img')) image.removeAttribute('src');
    grid.replaceChildren(...sorted.flatMap(([family, list]) => {
      const blocks: HTMLElement[] = [];
      if (family || sorted.length > 1) {
        const title = document.createElement('h3');
        title.className = 'mm-presets-title mm-pack';
        const count = document.createElement('span');
        count.textContent = String(list.length);
        if (foldable) {
          const open = openFamilies.has(category + '|' + family);
          const toggle = document.createElement('button');
          toggle.type = 'button';
          toggle.className = 'v3-fold';
          toggle.setAttribute('aria-expanded', String(open));
          toggle.append(family, count);
          toggle.onclick = () => {
            const id = category + '|' + family;
            // Une seule famille ouverte à la fois dans la rubrique : en ouvrir une ferme les autres.
            if (openFamilies.has(id)) openFamilies.delete(id);
            else {
              for (const open of [...openFamilies]) if (open.startsWith(category + '|')) openFamilies.delete(open);
              openFamilies.add(id);
            }
            filter();
          };
          title.append(toggle);
          blocks.push(title);
          if (!open) return blocks;
        } else {
          title.append(family + ' ', count);
          blocks.push(title);
        }
      }
      const row = document.createElement('div');
      row.className = 'mm-items';
      row.append(...list.map(chip));
      blocks.push(row);
      return blocks;
    }));
    status.textContent = matches.length ? '' : S('noMatch');
    markEquipped();
    showColor();
  }
  function choose(type: string) {
    actions.view?.(type);
    category = type;
    search.value = '';
    for (const tile of slots.querySelectorAll<HTMLButtonElement>('.gr-slot')) {
      const on = tile.dataset.v3Slot === type;
      tile.classList.toggle('on', on);
      tile.setAttribute('aria-pressed', String(on));
    }
    sockField.hidden = type !== 'SOCKS';
    showSockHeight();
    // Maillot ouvert : corps masculin seulement (le modèle féminin n'en a pas).
    // Manches longues : coureur seulement, et pas le corps fort (le maillot à manches longues n'y existe pas).
    zipField.hidden = type !== 'CYCLING_JERSEY' || riderSex() !== 'male' || resolvedBody(settings(), 'male') === 'big';
    showZipChoice();
    pocketField.hidden = type !== 'CYCLING_JERSEY';
    showPocketChoice();
    openField.hidden = type !== 'CYCLING_JERSEY';
    showOpenChoice();
    hairColor.row.hidden = type !== 'HAIR';
    beardColor.row.hidden = type !== 'FACIAL_HAIR';
    hairColor.sync();
    beardColor.sync();
    const count = items.filter(item => item.type === type && fits(item) && !isBare(item) && v3Shown('gear', item.id)).length;
    typeName.textContent = (V3_SLOTS[type]?.label ?? type) + ' · ' + count;
    // Arrivée dans la rubrique : familles repliées ; l'article porté est montré en tête (légende).
    for (const id of [...openFamilies]) if (id.startsWith(type + '|')) openFamilies.delete(id);
    filter();
  }
  search.oninput = filter;
  color.onchange = () => {
    const item = current();
    if (item) equip(item, Number(color.value));
  };
  remove.onclick = () => {
    const none = bareItem();
    if (none) equip(none, 0);
  };
  reset.onclick = () => {
    const equipment = settings();
    const kit = { ...equipment.kit };
    const origin = V3_DEFAULT_KIT[category];
    if (origin) kit[category] = { ...origin };
    else delete kit[category];
    actions.equipment({ ...equipment, kit });
    markEquipped();
    showColor();
  };
  let loading = false;
  let pending: Promise<void> | undefined;
  /** Silhouette changée : articles, compteurs et catégories (pas de barbe pour la coureuse) mis à jour. */
  function refresh() {
    if (!items.length) return;
    for (const tile of slots.querySelectorAll<HTMLButtonElement>('.gr-slot')) {
      // Pas de barbe pour la coureuse (seul « Clean Shaven », commun aux deux, y figurerait).
      tile.hidden = !items.some(item => item.type === tile.dataset.v3Slot && fits(item))
        || (tile.dataset.v3Slot === 'FACIAL_HAIR' && riderSex() === 'female');
    }
    const visible = [...slots.querySelectorAll<HTMLButtonElement>('.gr-slot')].filter(tile => !tile.hidden);
    const next = visible.some(tile => tile.dataset.v3Slot === category) ? category : visible[0]?.dataset.v3Slot;
    if (next) choose(next);
  }
  const open = () => {
    if (items.length) { choose(category); return; }
    if (loading) return;
    loading = true;
    status.textContent = S('loading');
    pending = getV3Gear().then(result => {
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
        const label = V3_SLOTS[type]?.label ?? items.find(item => item.type === type)?.category ?? type;
        name.textContent = label;
        tile.append(icon, name);
        // Infobulle : le nom de la rubrique (seule l'icône est visible sur la tuile).
        tile.setAttribute('aria-label', label);
        tile.onmouseenter = tile.onfocus = () => showTip(tile, label);
        tile.onmouseleave = tile.onblur = () => { tip.hidden = true; };
        tile.onclick = () => choose(type);
        slots.append(tile);
      }
      status.textContent = '';
      if (types[0]) choose(types[0]);
      refresh();
    }).catch(actions.report).finally(() => { loading = false; });
  };
  /**
   * Arrivée depuis la page Progression : catégorie de l'article choisie, sa famille dépliée, l'article dans la légende ;
   * rend sa pastille (ou la légende si l'article n'est pas encore gagné, donc absent de la liste).
   */
  async function reveal(item: V3Gear): Promise<HTMLElement | null> {
    if (!items.length) {
      open();
      await pending;
    }
    if (!items.some(row => row.id === item.id)) return null;
    choose(item.type);
    openFamilies.add(item.type + '|' + familyOf(item));
    filter();
    showCaption(item);
    if (!earned(item)) capState.textContent = fill(S('preview'), { lock: lockText(item) });
    return grid.querySelector<HTMLElement>(`[data-v3-item="${item.id}"]`) ?? caption;
  }
  /**
   * Clic sur la vue du garage : catégorie `type` choisie, famille de l'article porté dépliée et pastille mise en vue ;
   * rend l'article porté (pour le faire pulser sur le coureur).
   */
  async function focus(type: string): Promise<V3Gear | undefined> {
    if (!items.length) {
      open();
      await pending;
    }
    if (![...slots.querySelectorAll<HTMLElement>('.gr-slot')].some(tile => tile.dataset.v3Slot === type && !tile.hidden)) return;
    choose(type);
    const worn = current();
    if (worn && !isBare(worn)) {
      openFamilies.add(type + '|' + familyOf(worn));
      filter();
      grid.querySelector<HTMLElement>(`[data-v3-item="${worn.id}"]`)?.scrollIntoView({ block: 'center' });
    }
    return worn;
  }
  return { open, refresh, reveal, focus };
}
