import { getV3Catalog, getV3Gear, type V3Bike, type V3Gear, type V3Wheel } from './visuals.ts';
import { photoKey, needsPhoto } from './thumbnails.ts';
import { V3_ICON, V3_SLOTS } from './icons.ts';

/**
 * Gestion des objets du style V3 (développement) : chaque article, vélo ou paire de roues du catalogue local de Zwift
 * peut être masqué ; un objet masqué disparaît des listes du garage et des tirages au hasard (un coureur qui le porte
 * déjà le garde). Choix rangés dans le navigateur (ar.v3.admin).
 */
export type V3AdminKind = 'gear' | 'bike' | 'wheel';
type AdminState = { hidden: string[] };

const STORE = 'ar.v3.admin';
const STUDIO = '/__v3/studio/v6/';
let cache: Set<string> | undefined;
const listeners = new Set<() => void>();

function hiddenSet(): Set<string> {
  if (!cache) {
    try {
      const state = JSON.parse(localStorage.getItem(STORE) ?? 'null') as AdminState | null;
      cache = new Set(Array.isArray(state?.hidden) ? state.hidden : []);
    } catch {
      cache = new Set();
    }
  }
  return cache;
}

function save(): void {
  try { localStorage.setItem(STORE, JSON.stringify({ hidden: [...hiddenSet()].sort() } satisfies AdminState)); } catch { /* stockage indisponible */ }
  for (const listener of listeners) listener();
}

const keyOf = (kind: V3AdminKind, id: string | number) => kind + ':' + id;

/** Objet proposé dans le garage et les tirages (non masqué par la page de gestion). */
export function v3Shown(kind: V3AdminKind, id: string | number): boolean {
  return !hiddenSet().has(keyOf(kind, id));
}

/** Appelé quand la gestion change (le garage refait ses listes). */
export function onV3AdminChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setHidden(keys: string[], hidden: boolean): void {
  const set = hiddenSet();
  for (const key of keys) {
    if (hidden) set.add(key);
    else set.delete(key);
  }
  save();
}

/** Rubriques de la page : articles du vestiaire (sauf course à pied), puis vélos et roues. */
const TABS: Array<{ id: string; label: string }> = [
  { id: 'CYCLING_JERSEY', label: 'Maillots' }, { id: 'HEAD_GEAR', label: 'Casques' }, { id: 'GLASSES', label: 'Lunettes' },
  { id: 'GLOVES', label: 'Gants' }, { id: 'CYCLING_SHOES', label: 'Chaussures' }, { id: 'SOCKS', label: 'Chaussettes' },
  { id: 'HEAD_TYPE', label: 'Têtes' }, { id: 'HAIR', label: 'Cheveux' }, { id: 'FACIAL_HAIR', label: 'Barbes' },
  { id: 'bikes', label: 'Vélos' }, { id: 'wheels', label: 'Roues' },
];

/** Marquage Zwift reconnaissable au nom (Zwift, ZC, ZRL, Watopia, Makuri, Neokyo, Academy…). */
const ZWIFT_NAME = /zwift|\bzc\b|\bzrl|\bzrs|\bza\b|watopia|makuri|neokyo|\btron|scotty|academy|big ?spin|drop ?shop/i;

type Row = { key: string; name: string; detail: string; image?: string; zwift: boolean };

let open: HTMLElement | undefined;

/** Ouvre la page de gestion (plein écran, par-dessus le jeu). */
export async function openV3Admin(): Promise<void> {
  if (open) return;
  const [gear, catalog, stored] = await Promise.all([
    getV3Gear(), getV3Catalog(),
    fetch(STUDIO + 'index').then(response => (response.ok ? response.json() as Promise<string[]> : [])).catch(() => [] as string[]),
  ]);
  const photos = new Set(stored);
  const studio = (key: string) => (photos.has(key) ? STUDIO + key + '.png' : undefined);
  const gearImage = (item: V3Gear) => {
    if (item.colors[0]?.preview && !needsPhoto(item)) return '/__v3/gear/' + item.id + '/thumb.png';
    return studio(photoKey(item, item.sex === 'female' ? 'female' : 'male')) ?? (item.colors[0]?.preview ? '/__v3/gear/' + item.id + '/thumb.png' : undefined);
  };
  const bikeRow = (bike: V3Bike): Row => ({
    key: keyOf('bike', bike.id), name: (bike.name.toLowerCase().startsWith(bike.brand.toLowerCase()) ? bike.name : bike.brand + ' ' + bike.name),
    detail: bike.type + ' · ' + bike.id, image: studio('bike-' + bike.id) ?? (bike.preview ? '/__v3/bike/' + bike.id + '.png' : undefined),
    zwift: /zwift/i.test(bike.brand + ' ' + bike.name),
  });
  const wheelRow = (wheel: V3Wheel): Row => ({
    key: keyOf('wheel', wheel.id), name: wheel.brand + ' ' + wheel.name, detail: wheel.kind + ' · ' + wheel.weightG + ' g · ' + wheel.id,
    image: wheel.preview ? '/__v3/wheel/' + wheel.id + '.png' : studio('wheel-' + wheel.id), zwift: /zwift/i.test(wheel.brand + ' ' + wheel.id),
  });
  const gearRow = (item: V3Gear): Row => ({
    key: keyOf('gear', item.id), name: item.name || item.variant, detail: item.variant + ' · n° ' + item.id + (item.sex !== 'tous' ? ' · ' + (item.sex === 'female' ? 'femme' : 'homme') : ''),
    // Gamme « Originals » : maillots de Zwift, marqués de son logo même quand le nom ne le dit pas.
    image: gearImage(item), zwift: ZWIFT_NAME.test(item.name + ' ' + item.variant) || /^Originals_/.test(item.variant),
  });
  const rowsOf = (tab: string): Row[] => tab === 'bikes' ? catalog.bikes.map(bikeRow)
    : tab === 'wheels' ? (catalog.wheels ?? []).map(wheelRow)
      : gear.filter(item => item.type === tab).map(gearRow);

  const page = document.createElement('div');
  page.className = 'v3-admin';
  page.setAttribute('role', 'dialog');
  page.setAttribute('aria-label', 'Objets V3');
  open = page;
  const head = document.createElement('header');
  const title = document.createElement('h2');
  title.textContent = 'Objets V3 · gestion';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'v3-icon-button v3-admin-close';
  close.textContent = '✕';
  close.title = 'Fermer';
  close.setAttribute('aria-label', 'Fermer la gestion des objets');
  head.append(title, close);
  const tabs = document.createElement('nav');
  tabs.className = 'v3-admin-tabs';
  const tools = document.createElement('div');
  tools.className = 'v3-admin-tools';
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Rechercher (nom, variante, n°)';
  search.setAttribute('aria-label', 'Rechercher un objet');
  const filter = document.createElement('div');
  filter.className = 'mm-seg';
  filter.setAttribute('role', 'radiogroup');
  const counts = document.createElement('output');
  const hideShown = document.createElement('button');
  hideShown.type = 'button';
  hideShown.className = 'gr-sub';
  const showShown = document.createElement('button');
  showShown.type = 'button';
  showShown.className = 'gr-sub';
  const hideZwift = document.createElement('button');
  hideZwift.type = 'button';
  hideZwift.className = 'gr-sub v3-danger';
  tools.append(search, filter, counts, hideShown, showShown, hideZwift);
  const grid = document.createElement('div');
  grid.className = 'v3-admin-grid';
  page.append(head, tabs, tools, grid);
  document.body.append(page);

  let tab = TABS[0]!.id;
  type Mode = 'all' | 'shown' | 'hidden' | 'zwift';
  let mode = 'all' as Mode;
  const modes: Array<[Mode, string]> = [['all', 'Tous'], ['shown', 'Proposés'], ['hidden', 'Masqués'], ['zwift', 'Marqués Zwift']];
  for (const [id, label] of modes) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.mode = id;
    button.onclick = () => { mode = id; render(); };
    filter.append(button);
  }
  for (const { id, label } of TABS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.tab = id;
    button.onclick = () => { tab = id; search.value = ''; render(); };
    const icon = V3_SLOTS[id]?.icon ?? (id === 'bikes' || id === 'wheels' ? V3_ICON.bike : '');
    button.innerHTML = icon;
    button.append(label);
    tabs.append(button);
  }
  search.oninput = () => render();

  function visibleRows(): Row[] {
    const query = search.value.trim().toLowerCase();
    const hidden = hiddenSet();
    return rowsOf(tab).filter(row => (!query || (row.name + ' ' + row.detail).toLowerCase().includes(query))
      && (mode === 'all' || (mode === 'shown' ? !hidden.has(row.key) : mode === 'hidden' ? hidden.has(row.key) : row.zwift)));
  }

  function card(row: Row): HTMLElement {
    const hidden = hiddenSet().has(row.key);
    const item = document.createElement('article');
    item.className = 'v3-admin-card' + (hidden ? ' off' : '');
    const picture = document.createElement('div');
    picture.className = 'v3-admin-pic';
    if (row.image) {
      const image = document.createElement('img');
      image.src = row.image;
      image.loading = 'lazy';
      image.decoding = 'async';
      image.alt = '';
      image.onerror = () => image.remove();
      picture.append(image);
    }
    const name = document.createElement('b');
    name.textContent = row.name;
    const detail = document.createElement('small');
    detail.textContent = row.detail;
    const tags = document.createElement('div');
    tags.className = 'v3-admin-tags';
    if (row.zwift) {
      const tag = document.createElement('span');
      tag.textContent = 'Zwift';
      tags.append(tag);
    }
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'gr-sub' + (hidden ? '' : ' on');
    toggle.textContent = hidden ? 'Masqué' : 'Proposé';
    toggle.title = hidden ? 'Proposer de nouveau dans le garage' : 'Masquer dans le garage et les tirages';
    toggle.setAttribute('aria-pressed', String(!hidden));
    toggle.onclick = () => { setHidden([row.key], !hidden); render(); };
    tags.append(toggle);
    item.append(picture, name, detail, tags);
    return item;
  }

  function render(): void {
    const hidden = hiddenSet();
    for (const button of tabs.querySelectorAll<HTMLButtonElement>('button')) {
      const id = button.dataset.tab!;
      const all = rowsOf(id);
      const off = all.filter(row => hidden.has(row.key)).length;
      button.classList.toggle('on', id === tab);
      button.title = all.length + ' objets' + (off ? ', ' + off + ' masqués' : '');
    }
    for (const button of filter.querySelectorAll<HTMLButtonElement>('button')) button.classList.toggle('on', button.dataset.mode === mode);
    const rows = visibleRows();
    const all = rowsOf(tab);
    counts.textContent = rows.length + ' affichés · ' + all.filter(row => !hidden.has(row.key)).length + ' proposés sur ' + all.length;
    const shownHere = rows.filter(row => !hidden.has(row.key));
    const hiddenHere = rows.filter(row => hidden.has(row.key));
    const zwiftHere = all.filter(row => row.zwift && !hidden.has(row.key));
    hideShown.textContent = 'Masquer les affichés (' + shownHere.length + ')';
    hideShown.disabled = !shownHere.length;
    hideShown.onclick = () => { setHidden(shownHere.map(row => row.key), true); render(); };
    showShown.textContent = 'Proposer les affichés (' + hiddenHere.length + ')';
    showShown.disabled = !hiddenHere.length;
    showShown.onclick = () => { setHidden(hiddenHere.map(row => row.key), false); render(); };
    hideZwift.textContent = 'Masquer les marqués Zwift (' + zwiftHere.length + ')';
    hideZwift.disabled = !zwiftHere.length;
    hideZwift.onclick = () => { setHidden(zwiftHere.map(row => row.key), true); render(); };
    grid.replaceChildren(...rows.map(card));
  }

  const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') shut(); };
  function shut(): void {
    document.removeEventListener('keydown', onKey, true);
    page.remove();
    open = undefined;
  }
  close.onclick = shut;
  document.addEventListener('keydown', onKey, true);
  render();
  search.focus();
}
