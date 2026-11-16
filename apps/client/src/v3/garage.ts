import { getV3Catalog, getV3Clips, getV3Colors, readV3Equipment, saveV3Equipment, V3_POSES, type V3Bike, type V3Color, type V3Equipment, type V3Gear } from './visuals.ts';
import { addWardrobe, createHueControl } from './wardrobe.ts';
import { V3_ICON } from './icons.ts';
import './garage.css';

export interface V3GarageActions {
  equipment(equipment: V3Equipment): void;
  pose(name: string): void;
  playing(on: boolean): void;
  /** Photo d'un article porté par le coureur V3 (vignettes des articles sans icône Zwift). */
  photo?(item: V3Gear, sex: 'male' | 'female', wanted?: () => boolean): Promise<string>;
}

/** Libellés des types de vélos du catalogue V3, dans l'ordre d'affichage. */
const BIKE_TYPES: Array<[string, string]> = [
  ['route', 'Route'], ['chrono', 'Chrono'], ['gravel', 'Gravel'], ['vtt', 'VTT'], ['cruiser', 'Ville'],
  ['concept', 'Concept'], ['tricycle', 'Tricycle'], ['handbike', 'Handbike'], ['couché', 'Couché'],
];
const typeLabel = (type: string) => BIKE_TYPES.find(([id]) => id === type)?.[1] ?? type;
const bikeName = (bike: V3Bike) => (bike.name.toLowerCase().startsWith(bike.brand.toLowerCase()) ? bike.name : bike.brand + ' ' + bike.name).trim();

function field(parent: HTMLElement, label: string, control: HTMLElement): HTMLLabelElement {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  wrap.append(label, control);
  parent.append(wrap);
  return wrap;
}

function select(parent: HTMLElement, label: string): HTMLSelectElement {
  const control = document.createElement('select');
  control.dataset.dd = 'native';
  field(parent, label, control);
  return control;
}

function bikeIcon(bike: V3Bike | undefined, big = false): HTMLElement {
  if (!bike?.preview) {
    const empty = document.createElement('span');
    empty.className = 'mm-bikeicon' + (big ? ' big' : '');
    return empty;
  }
  const image = document.createElement('img');
  image.className = 'mm-bikeicon' + (big ? ' big' : '');
  image.src = '/__v3/bike/' + bike.id + '.png';
  image.loading = 'lazy';
  image.decoding = 'async';
  image.alt = '';
  return image;
}

/**
 * Garage V3 sur le modèle du garage Réel et Poly : trois rubriques (Tenue, Vélo, Personnage) en tête
 * du panneau (`top`), leur contenu dans le corps (`panel`). Ressources Zwift locales, développement seulement.
 */
export function createV3Garage(actions: V3GarageActions) {
  const top = document.createElement('div');
  top.className = 'v3-top';
  const nav = document.createElement('nav');
  nav.className = 'gr-groups';
  nav.setAttribute('aria-label', 'Rubriques du garage V3');
  top.append(nav);
  const panel = document.createElement('div');
  panel.className = 'ar-v3-garage';
  const sections = new Map<string, { head: HTMLElement; section: HTMLElement; button: HTMLButtonElement }>();
  const status = document.createElement('output');
  status.className = 'v3-status';
  status.setAttribute('role', 'status');
  const report = (error: unknown) => { status.textContent = error instanceof Error ? error.message : String(error); };
  let equipment = readV3Equipment();
  function apply(value: V3Equipment) {
    equipment = value;
    saveV3Equipment(equipment);
    actions.equipment(equipment);
  }
  function sectionFor(id: string, title: string, icon: string) {
    const head = document.createElement('div');
    head.className = 'v3-head';
    const section = document.createElement('section');
    section.id = 'v3-garage-' + id;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gr-group';
    button.innerHTML = icon;
    const name = document.createElement('span');
    name.textContent = title;
    button.append(name);
    button.setAttribute('aria-controls', section.id);
    button.onclick = () => show(id);
    nav.append(button);
    top.append(head);
    panel.append(section);
    sections.set(id, { head, section, button });
    return { head, section };
  }
  function show(id: string) {
    for (const [key, { head, section, button }] of sections) {
      const on = key === id;
      head.hidden = section.hidden = !on;
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
    }
    status.textContent = '';
    if (id === 'kit') openKit();
    if (id === 'character') openCharacter();
    panel.parentElement?.scrollTo({ top: 0 });
  }

  const kit = sectionFor('kit', 'Tenue', V3_ICON.tenue);
  const bikes = sectionFor('bikes', 'Vélo', V3_ICON.bike);
  const character = sectionFor('character', 'Personnage', V3_ICON.face);
  const wardrobeActions = { equipment: apply, report, photo: actions.photo };
  const openKit = addWardrobe(kit.head, kit.section, () => equipment, wardrobeActions);
  const sex = select(character.section, 'Silhouette');
  sex.add(new Option('Selon mon profil', ''));
  sex.add(new Option('Coureur', 'male'));
  sex.add(new Option('Coureuse', 'female'));
  sex.value = equipment.sex ?? '';
  sex.onchange = () => apply({ ...equipment, sex: sex.value === 'male' || sex.value === 'female' ? sex.value : undefined });
  const openCharacter = addWardrobe(character.head, character.section, () => equipment, wardrobeActions, true);

  // Vélo : fiche du vélo équipé (vignette, coloris, teinte), posture, puis le catalogue par type et par marque.
  const focus = document.createElement('div');
  focus.className = 'v3-bikefocus';
  const focusText = document.createElement('div');
  focusText.className = 'mm-bike-txt';
  const focusName = document.createElement('b');
  const focusType = document.createElement('small');
  focusText.append(focusName, focusType);
  focus.append(bikeIcon(undefined, true), focusText);
  bikes.section.append(focus);
  const colors = select(bikes.section, 'Coloris');
  const hue = createHueControl(value => apply({ ...equipment, hue: value }));
  bikes.section.append(hue.field);
  const ride = document.createElement('div');
  ride.className = 'v3-ride';
  const poses = select(ride, 'Posture');
  for (const [id, label] of Object.entries(V3_POSES)) poses.add(new Option(label, id));
  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'gr-sub';
  play.textContent = 'Pédaler à 90 tr/min';
  play.setAttribute('aria-pressed', 'false');
  play.onclick = () => {
    const on = play.getAttribute('aria-pressed') === 'false';
    play.setAttribute('aria-pressed', String(on));
    play.classList.toggle('on', on);
    play.textContent = on ? 'Pause' : 'Pédaler à 90 tr/min';
    actions.playing(on);
  };
  ride.append(play);
  bikes.section.append(ride);
  const types = document.createElement('div');
  types.className = 'mm-biketypes';
  types.setAttribute('role', 'radiogroup');
  const searchBike = document.createElement('input');
  searchBike.type = 'search';
  searchBike.placeholder = 'Rechercher un vélo';
  searchBike.setAttribute('aria-label', searchBike.placeholder);
  const list = document.createElement('div');
  list.className = 'mm-bikelist';
  bikes.section.append(types, searchBike, list);

  panel.append(status);

  let catalogBikes: V3Bike[] = [];
  let bikeType = 'all';
  let bikeColors: V3Color[] = [];
  let colorRequest = 0;
  function showFocus() {
    const bike = catalogBikes.find(row => row.id === equipment.bike);
    focus.firstElementChild?.replaceWith(bikeIcon(bike, true));
    focusName.textContent = bike ? bikeName(bike) : equipment.bike;
    focusType.textContent = bike ? typeLabel(bike.type) : '';
  }
  async function showColors() {
    const request = ++colorRequest;
    colors.disabled = true;
    colors.replaceChildren(new Option('Chargement…', '0'));
    hue.set();
    try {
      const result = await getV3Colors(equipment.bike);
      if (request !== colorRequest) return;
      bikeColors = result.colors.length ? result.colors : [{ name: 'D’origine' }];
      colors.replaceChildren(...bikeColors.map((color, i) => new Option(color.name || (bikeColors.length === 1 ? 'D’origine' : 'Coloris ' + (i + 1)), String(i))));
      colors.value = String(equipment.color);
      colors.disabled = bikeColors.length <= 1;
      hue.set(bikeColors[equipment.color], equipment.hue);
    } catch (error) {
      if (request !== colorRequest) return;
      colors.replaceChildren(new Option('Coloris indisponibles'));
      report(error);
    }
  }
  function fillBikes() {
    const query = searchBike.value.trim().toLowerCase();
    const counts = new Map<string, number>();
    for (const bike of catalogBikes) counts.set(bike.type, (counts.get(bike.type) ?? 0) + 1);
    const chip = (id: string, label: string, n: number) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(id === bikeType));
      button.classList.toggle('on', id === bikeType);
      const count = document.createElement('span');
      count.textContent = String(n);
      button.append(label, count);
      button.onclick = () => { bikeType = id; fillBikes(); };
      return button;
    };
    const known = BIKE_TYPES.filter(([id]) => counts.has(id));
    const other = [...counts.keys()].filter(id => !BIKE_TYPES.some(([type]) => type === id)).map(id => [id, id] as [string, string]);
    types.replaceChildren(chip('all', 'Tous', catalogBikes.length), ...[...known, ...other].map(([id, label]) => chip(id, label, counts.get(id) ?? 0)));
    const shown = catalogBikes
      .filter(bike => bikeType === 'all' || bike.type === bikeType)
      .filter(bike => (bike.brand + ' ' + bike.name + ' ' + typeLabel(bike.type)).toLowerCase().includes(query))
      .sort((a, b) => a.brand.localeCompare(b.brand, 'fr') || bikeName(a).localeCompare(bikeName(b), 'fr'));
    const rows: HTMLElement[] = [];
    let brand: string | undefined;
    for (const bike of shown) {
      if (bike.brand !== brand) {
        brand = bike.brand;
        const title = document.createElement('h5');
        title.className = 'mm-bl-brand';
        title.textContent = brand || 'Sans marque';
        const count = document.createElement('span');
        count.textContent = String(shown.filter(row => row.brand === bike.brand).length);
        title.append(count);
        rows.push(title);
      }
      const on = bike.id === equipment.bike;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'mm-bike' + (on ? ' on' : '');
      row.dataset.v3Bike = bike.id;
      row.setAttribute('aria-pressed', String(on));
      const text = document.createElement('span');
      text.className = 'mm-bike-txt';
      const name = document.createElement('b');
      name.textContent = bikeName(bike);
      const sub = document.createElement('small');
      sub.textContent = typeLabel(bike.type);
      text.append(name, sub);
      const side = document.createElement('span');
      side.className = 'mm-bike-side';
      if (on) side.innerHTML = '<span class="mm-bike-state">✓ Équipé</span>';
      row.append(bikeIcon(bike), text, side);
      row.onclick = () => choose(bike.id);
      rows.push(row);
    }
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'mm-hint';
      empty.textContent = 'Aucun vélo ne correspond.';
      rows.push(empty);
    }
    list.replaceChildren(...rows);
  }
  function choose(bike: string) {
    if (bike === equipment.bike) return;
    apply({ ...equipment, bike, color: 0, hue: undefined });
    showFocus();
    fillBikes();
    void showColors();
  }
  colors.onchange = () => {
    const color = Number(colors.value);
    hue.set(bikeColors[color]);
    apply({ ...equipment, color, hue: undefined });
  };
  poses.onchange = () => {
    actions.pose(poses.value);
    const timeTrial = catalogBikes.find(bike => bike.id === equipment.bike)?.type === 'chrono';
    if (/_TT$/i.test(poses.value) && !timeTrial) {
      const speedmax = catalogBikes.find(bike => bike.id === 'canyonspeedmaxcfr2026') ?? catalogBikes.find(bike => bike.type === 'chrono');
      if (speedmax) choose(speedmax.id);
    }
  };
  searchBike.oninput = fillBikes;
  void getV3Catalog().then(catalog => {
    catalogBikes = catalog.bikes;
    if (!catalogBikes.some(bike => bike.id === equipment.bike) && catalogBikes[0]) choose(catalogBikes[0].id);
    else void showColors();
    showFocus();
    fillBikes();
  }).catch(report);
  void getV3Clips().then(clips => {
    const alternatives = [...new Set(clips.map(clip => clip.name))].filter(name => !(name in V3_POSES));
    const group = document.createElement('optgroup');
    group.label = 'Variantes par type de vélo';
    for (const name of alternatives) group.append(new Option(name, name));
    poses.add(group);
  }).catch(report);
  show('kit');
  return { top, panel, report };
}
