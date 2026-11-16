import { apiBase } from '../ui/account.ts';
import { getV3Catalog, getV3Gear, itemSex, type V3Bike, type V3Gear, type V3Wheel } from './visuals.ts';
import { photoKey, needsPhoto } from './thumbnails.ts';
import { V3_ICON, V3_SLOTS } from './icons.ts';
import { v3Resource } from '../engine/v3Access.ts';

/**
 * Gestion des objets du style V3. En production, le serveur filtre le catalogue de tous les clients.
 * Le banc de développement garde ses réglages dans son navigateur.
 */
export type V3AdminKind = 'gear' | 'bike' | 'wheel';
type AdminState = { hidden: string[] };

const STORE = 'ar.v3.admin';
const STUDIO = v3Resource('studio/v6/');
let cache: Set<string> | undefined;
const listeners = new Set<() => void>();

function hiddenSet(): Set<string> {
  if (!import.meta.env.DEV) return cache ??= new Set();
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

function notify(): void {
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

async function adminRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(apiBase() + '/admin/' + path, { credentials: 'include', ...options });
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { error?: string; message?: string };
    if (error.error === 'locked') throw new Error('Déverrouille le compte administrateur sur /admin.html, puis rouvre le garage.');
    throw new Error(error.message ?? 'Gestion du catalogue V3 indisponible');
  }
  return response.json() as Promise<T>;
}

async function setHidden(keys: string[], hidden: boolean): Promise<void> {
  if (!import.meta.env.DEV) {
    const state = await adminRequest<AdminState>('v3/visibility', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys, hidden }),
    });
    cache = new Set(state.hidden);
    notify();
    return;
  }
  const set = hiddenSet();
  for (const key of keys) {
    if (hidden) set.add(key);
    else set.delete(key);
  }
  try { localStorage.setItem(STORE, JSON.stringify({ hidden: [...set].sort() } satisfies AdminState)); } catch { /* stockage indisponible */ }
  notify();
}

/** Rubriques de la page : articles du vestiaire (sauf course à pied), puis vélos et roues. */
const TABS: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'Tout' }, { id: 'CYCLING_JERSEY', label: 'Maillots' }, { id: 'HEAD_GEAR', label: 'Casques' }, { id: 'GLASSES', label: 'Lunettes' },
  { id: 'GLOVES', label: 'Gants' }, { id: 'CYCLING_SHOES', label: 'Chaussures' }, { id: 'SOCKS', label: 'Chaussettes' },
  { id: 'HEAD_TYPE', label: 'Têtes' }, { id: 'HAIR', label: 'Cheveux' }, { id: 'FACIAL_HAIR', label: 'Barbes' },
  { id: 'bikes', label: 'Vélos' }, { id: 'wheels', label: 'Roues' },
];

/** Marquage Zwift reconnaissable au nom (Zwift, ZC, ZRL, Watopia, Makuri, Neokyo, Academy…). */
const ZWIFT_NAME = /zwift|\bzc\b|\bzrl|\bzrs|\bza\b|watopia|makuri|neokyo|\btron|scotty|academy|big ?spin|drop ?shop/i;

type Row = { key: string; name: string; detail: string; image?: string; zwift: boolean; gear?: V3Gear };
/** Photo d'un article au studio du garage (têtes, cheveux, chaussettes… sans icône utilisable). */
type Photo = (item: V3Gear, sex: 'male' | 'female', wanted?: () => boolean) => Promise<string>;

let open: HTMLElement | undefined;

/**
 * Page de gestion réservée au développement ou au compte administrateur : le serveur reconnaît son e-mail
 * (ADMIN_EMAIL, comparé par empreinte) et répond 404 à tout autre compte. Aucune adresse dans le code du client.
 */
export function canManageV3(): Promise<boolean> {
  if (import.meta.env.DEV) return Promise.resolve(true);
  return fetch(apiBase() + '/admin/status', { credentials: 'include' }).then(response => response.ok).catch(() => false);
}

/** Ouvre la page de gestion (plein écran, par-dessus le jeu). */
export async function openV3Admin(photo?: Photo): Promise<void> {
  if (open || !(await canManageV3())) return;
  const local = import.meta.env.DEV;
  if (!local) cache = new Set((await adminRequest<AdminState>('v3/visibility')).hidden);
  const [gear, catalog, stored] = await Promise.all([
    local ? getV3Gear() : adminRequest<V3Gear[]>('v3/gear'),
    local ? getV3Catalog() : adminRequest<Awaited<ReturnType<typeof getV3Catalog>>>('v3/catalogue'),
    fetch(STUDIO + 'index').then(response => (response.ok ? response.json() as Promise<string[]> : [])).catch(() => [] as string[]),
  ]);
  if (open) return;
  const photos = new Set(stored);
  const studio = (key: string) => (photos.has(key) ? STUDIO + key + '.png' : undefined);
  const sexOf = (item: V3Gear) => (itemSex(item) === 'female' ? 'female' : 'male');
  const gearImage = (item: V3Gear) => {
    if (item.colors[0]?.preview && !needsPhoto(item)) return v3Resource('gear/' + item.id + '/thumb.png');
    // Sans photo au studio : prise à l'affichage de la carte (l'icône de Zwift n'est qu'une texture à plat).
    return studio(photoKey(item, sexOf(item))) ?? (photo ? undefined : item.colors[0]?.preview ? v3Resource('gear/' + item.id + '/thumb.png') : undefined);
  };
  const bikeRow = (bike: V3Bike): Row => ({
    key: keyOf('bike', bike.id), name: (bike.name.toLowerCase().startsWith(bike.brand.toLowerCase()) ? bike.name : bike.brand + ' ' + bike.name),
    detail: bike.type + ' · ' + bike.id, image: studio('bike-' + bike.id) ?? (bike.preview ? v3Resource('bike/' + bike.id + '.png') : undefined),
    zwift: /zwift/i.test(bike.brand + ' ' + bike.name),
  });
  const wheelRow = (wheel: V3Wheel): Row => ({
    key: keyOf('wheel', wheel.id), name: wheel.brand + ' ' + wheel.name, detail: wheel.kind + ' · ' + wheel.weightG + ' g · ' + wheel.id,
    image: wheel.preview ? v3Resource('wheel/' + wheel.id + '.png') : studio('wheel-' + wheel.id), zwift: /zwift/i.test(wheel.brand + ' ' + wheel.id),
  });
  const gearRow = (item: V3Gear): Row => ({
    key: keyOf('gear', item.id), name: item.name || item.variant, detail: item.variant + ' · n° ' + item.id + (itemSex(item) !== 'tous' ? ' · ' + (itemSex(item) === 'female' ? 'femme' : 'homme') : ''),
    // Gamme « Originals » : maillots de Zwift, marqués de son logo même quand le nom ne le dit pas.
    image: gearImage(item), gear: item, zwift: ZWIFT_NAME.test(item.name + ' ' + item.variant) || /^Originals_/.test(item.variant),
  });
  const rowsOf = (tab: string): Row[] => tab === 'all' ? TABS.filter(row => row.id !== 'all').flatMap(row => rowsOf(row.id))
    : tab === 'bikes' ? catalog.bikes.map(bikeRow)
      : tab === 'wheels' ? (catalog.wheels ?? []).map(wheelRow)
        : gear.filter(item => item.type === tab).map(gearRow);

  const page = document.createElement('div');
  page.className = 'v3-admin';
  page.setAttribute('role', 'dialog');
  page.setAttribute('aria-label', 'Objets V3');
  open = page;
  const head = document.createElement('header');
  const title = document.createElement('h2');
  title.textContent = local ? 'Objets V3 · banc local' : 'Objets V3 · catalogue des joueurs';
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
  const status = document.createElement('output');
  status.setAttribute('role', 'status');
  const hideShown = document.createElement('button');
  hideShown.type = 'button';
  hideShown.className = 'gr-sub';
  const showShown = document.createElement('button');
  showShown.type = 'button';
  showShown.className = 'gr-sub';
  const hideZwift = document.createElement('button');
  hideZwift.type = 'button';
  hideZwift.className = 'gr-sub v3-danger';
  hideShown.title = 'Masquer tous les objets affichés (rubrique, recherche et filtre en cours)';
  showShown.title = 'Proposer tous les objets affichés (rubrique, recherche et filtre en cours)';
  tools.append(search, filter, counts, showShown, hideShown, hideZwift, status);
  const grid = document.createElement('div');
  grid.className = 'v3-admin-grid';
  page.append(head, tabs, tools, grid);
  document.body.append(page);

  let tab = TABS[1]!.id;
  let saving = false;
  let changed = false;

  async function changeVisibility(keys: string[], hidden: boolean): Promise<void> {
    if (saving) return;
    saving = true;
    status.textContent = 'Enregistrement…';
    try {
      await setHidden(keys, hidden);
      changed = true;
      status.textContent = local ? 'Enregistré dans ce navigateur.' : 'Catalogue des joueurs mis à jour.';
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      saving = false;
      render();
    }
  }
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
    const icon = V3_SLOTS[id]?.icon ?? (id === 'bikes' || id === 'wheels' ? V3_ICON.bike : id === 'all' ? V3_ICON.admin : '');
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
    } else if (row.gear && photo) {
      const gear = row.gear;
      void photo(gear, sexOf(gear), () => picture.isConnected).then(url => {
        const image = document.createElement('img');
        image.src = url;
        image.alt = '';
        picture.replaceChildren(image);
      }).catch(() => undefined);
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
    toggle.onclick = () => { void changeVisibility([row.key], !hidden); };
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
    // Actions sur la sélection affichée (rubrique, recherche et filtre en cours).
    hideShown.textContent = 'Tout masquer (' + shownHere.length + ')';
    hideShown.disabled = !shownHere.length;
    hideShown.onclick = () => { void changeVisibility(shownHere.map(row => row.key), true); };
    showShown.textContent = 'Tout proposer (' + hiddenHere.length + ')';
    showShown.disabled = !hiddenHere.length;
    showShown.onclick = () => { void changeVisibility(hiddenHere.map(row => row.key), false); };
    hideZwift.textContent = 'Masquer les marqués Zwift (' + zwiftHere.length + ')';
    hideZwift.disabled = !zwiftHere.length;
    hideZwift.onclick = () => { void changeVisibility(zwiftHere.map(row => row.key), true); };
    grid.replaceChildren(...rows.map(card));
  }

  const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') shut(); };
  function shut(): void {
    if (saving) return;
    document.removeEventListener('keydown', onKey, true);
    page.remove();
    open = undefined;
    if (changed && !local) location.reload();
  }
  close.onclick = shut;
  document.addEventListener('keydown', onKey, true);
  render();
  search.focus();
}
