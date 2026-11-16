import { getV3Catalog, getV3Clips, getV3Colors, getV3Gear, type V3SockHeight, readV3Equipment, V3_HAIR_COLORS, saveV3Equipment, V3_POSES, type V3Bike, type V3Body, type V3Color, type V3Equipment, type V3Gear } from './visuals.ts';
import { addWardrobe, createHueControl, onScreen, whenVisible } from './wardrobe.ts';
import { V3_ICON } from './icons.ts';
import { saveV3BikeSetup, v3BikeEffect } from './physics.ts';
import './garage.css';

export interface V3GarageActions {
  equipment(equipment: V3Equipment): void;
  pose(name: string): void;
  playing(on: boolean): void;
  /** Photo d'un article porté par le coureur V3 (vignettes des articles sans icône Zwift). */
  photo?(item: V3Gear, sex: 'male' | 'female', wanted?: () => boolean): Promise<string>;
  /** Silhouette effective du coureur V3. */
  sex?(): 'male' | 'female' | undefined;
  /** Photo de profil d'un vélo sans icône Zwift. */
  photoBike?(id: string, wanted: () => boolean): Promise<string>;
  /** Tête nue (casque retiré) tant que la catégorie Cheveux est ouverte. */
  bareHead?(on: boolean): void;
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

/** Bouton « au hasard » : dé à points pleins sur fond jaune, pour qu'on le repère au premier coup d'œil. */
function diceButton(title: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'v3-dice';
  button.innerHTML = V3_ICON.dice;
  button.title = title;
  button.setAttribute('aria-label', title);
  return button;
}

const pick = <T>(list: T[]): T | undefined => list[Math.floor(Math.random() * list.length)];

/** Photo de profil d'un vélo (studio de l'atelier) ; fournie par le garage. */
let bikePhoto: ((id: string, wanted: () => boolean) => Promise<string>) | undefined;

function bikeIcon(bike: V3Bike | undefined, big = false): HTMLElement {
  // Tous les vélos en photo de profil roues comprises (les icônes Zwift ne montrent que le cadre).
  if (!bike?.preview || bikePhoto) {
    const empty = document.createElement('span');
    empty.className = 'mm-bikeicon' + (big ? ' big' : '');
    const photo = bikePhoto;
    if (bike && photo) {
      // Photo du vélo quand la ligne devient visible.
      // Photographiée à son tour seulement si la ligne est encore à l'écran ; sinon redemandée quand elle y revient.
      const take = () => {
        void photo(bike.id, () => onScreen(empty)).then(url => {
          const image = document.createElement('img');
          image.className = empty.className;
          image.src = url;
          image.alt = '';
          empty.replaceWith(image);
        }).catch(() => { if (empty.isConnected) whenVisible(empty, take); });
      };
      whenVisible(empty, take);
    }
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
  bikePhoto = actions.photoBike;
  const top = document.createElement('div');
  top.className = 'v3-top';
  const nav = document.createElement('nav');
  nav.className = 'gr-groups';
  nav.setAttribute('aria-label', 'Rubriques du garage V3');
  // Dé général à côté des rubriques : tenue, vélo et personnage tirés ensemble.
  const navRow = document.createElement('div');
  navRow.className = 'v3-navrow';
  const allDice = diceButton('Tout au hasard : tenue, vélo et personnage');
  allDice.onclick = () => {
    void (async () => {
      await randomKit();
      await randomCharacter();
      await randomBike(true);
    })().catch(report);
  };
  navRow.append(nav, allDice);
  top.append(navRow);
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
    updateEffect();
  }
  /**
   * Effet du vélo et des accessoires sur la sortie (poids, traînée) d'après leurs caractéristiques Zwift :
   * affiché sous la fiche du vélo et enregistré pour la prochaine sortie en style V3.
   */
  let gearItems: V3Gear[] = [];
  function updateEffect() {
    if (!catalogBikes.length) return;
    const effect = v3BikeEffect(equipment, catalogBikes, gearItems);
    saveV3BikeSetup(effect.setup);
    const kg = (value: number) => value.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const drag = Math.round(effect.dragPct * 10) / 10;
    effectLine.textContent = 'En selle : ' + kg(effect.setup.massKg) + ' kg · traînée ' + (drag > 0 ? '+' : '') + drag.toLocaleString('fr-FR') + ' %';
    effectLine.title = 'Vélo ' + kg(effect.bikeKg) + ' kg + équipement ' + kg(effect.gearKg) + ' kg (poids et traînée Zwift) ; '
      + 'appliqué à la prochaine sortie en style V3. Pneus : ' + (effect.setup.tyre === 'mtb' ? 'VTT' : effect.setup.tyre === 'gravel' ? 'gravel' : 'route') + '.';
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
    actions.bareHead?.(id === 'character' && characterType === 'HAIR');
    if (id === 'kit') openKit();
    if (id === 'character') openCharacter();
    panel.parentElement?.scrollTo({ top: 0 });
  }

  const kit = sectionFor('kit', 'Tenue', V3_ICON.tenue);
  const bikes = sectionFor('bikes', 'Vélo', V3_ICON.bike);
  const character = sectionFor('character', 'Personnage', V3_ICON.face);
  const wardrobeActions = { equipment: apply, report, photo: actions.photo, sex: actions.sex };
  // Personnage › Cheveux : tête nue pour voir la coiffure (le casque revient dans les autres catégories et rubriques).
  let characterType = '';
  const characterActions = { ...wardrobeActions, view: (type: string) => { characterType = type; actions.bareHead?.(type === 'HAIR'); } };
  const kitWardrobe = addWardrobe(kit.head, kit.section, () => equipment, wardrobeActions);
  const openKit = kitWardrobe.open;
  // En tête du choix du personnage, avant les catégories : silhouette puis corps, en boutons segmentés.
  const identity = document.createElement('div');
  identity.className = 'v3-identity';
  const sexField = document.createElement('div');
  sexField.className = 'field';
  const sexSeg = document.createElement('div');
  sexSeg.className = 'mm-seg';
  sexSeg.setAttribute('role', 'radiogroup');
  sexSeg.setAttribute('aria-label', 'Silhouette');
  // Homme ou femme ; sans choix enregistré, la silhouette effective (celle du profil) est cochée.
  const sexes: Array<['male' | 'female', string]> = [['male', 'Homme'], ['female', 'Femme']];
  function showSex() {
    const current = equipment.sex ?? actions.sex?.() ?? 'male';
    for (const button of sexSeg.querySelectorAll<HTMLButtonElement>('button')) {
      const on = button.dataset.v3Sex === current;
      button.classList.toggle('on', on);
      button.setAttribute('aria-checked', String(on));
    }
  }
  for (const [value, text] of sexes) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.dataset.v3Sex = value;
    button.textContent = text;
    button.onclick = () => {
      apply({ ...equipment, sex: value });
      showSex();
      showBody();
      kitWardrobe.refresh();
      characterWardrobe.refresh();
    };
    sexSeg.append(button);
  }
  sexField.append('Silhouette');
  // Corps Zwift : standard, mince, fort (le corps fort n'existe que pour le coureur).
  const bodyField = document.createElement('div');
  bodyField.className = 'field';
  const bodySeg = document.createElement('div');
  bodySeg.className = 'mm-seg';
  bodySeg.setAttribute('role', 'radiogroup');
  bodySeg.setAttribute('aria-label', 'Corps');
  const bodies: Array<[V3Body, string]> = [['standard', 'Standard'], ['skinny', 'Mince'], ['big', 'Fort']];
  function showBody() {
    const female = (actions.sex?.() ?? equipment.sex) === 'female';
    const chosen = female && equipment.body === 'big' ? 'standard' : equipment.body ?? 'standard';
    for (const button of bodySeg.querySelectorAll<HTMLButtonElement>('button')) {
      button.hidden = female && button.dataset.v3Body === 'big';
      const on = button.dataset.v3Body === chosen;
      button.classList.toggle('on', on);
      button.setAttribute('aria-checked', String(on));
    }
  }
  for (const [body, text] of bodies) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.dataset.v3Body = body;
    button.textContent = text;
    button.onclick = () => { apply({ ...equipment, body }); showBody(); };
    bodySeg.append(button);
  }
  bodyField.append('Corps', bodySeg);
  // Personnage au hasard : corps, tête, coiffure et couleur, barbe ; la silhouette choisie est gardée.
  const sexNow = () => equipment.sex ?? actions.sex?.() ?? 'male';
  async function randomCharacter(): Promise<void> {
    const items = await getV3Gear();
    const sex = sexNow();
    const fits = (item: V3Gear, type: string) => item.type === type && (item.sex === 'tous' || item.sex === sex);
    const kit = { ...equipment.kit };
    const wear = (type: string, item: V3Gear | undefined) => {
      if (item) kit[type] = { id: item.id, color: 0 };
      else delete kit[type];
    };
    wear('HEAD_TYPE', pick(items.filter(item => fits(item, 'HEAD_TYPE'))));
    // Toujours des cheveux (« Clean Shaven » écarté) ; barbe une fois sur deux pour le coureur.
    wear('HAIR', pick(items.filter(item => fits(item, 'HAIR') && !/clean shaven/i.test(item.variant))));
    const beards = items.filter(item => fits(item, 'FACIAL_HAIR') && !/clean shaven/i.test(item.variant));
    // Barbe une fois sur deux ; sinon « sans barbe » (sinon la moustache d'origine du visage resterait).
    const shaven = items.find(item => item.type === 'FACIAL_HAIR' && /clean shaven/i.test(item.variant));
    wear('FACIAL_HAIR', sex === 'male' && Math.random() < 0.5 ? pick(beards) : shaven);
    const bodies: V3Body[] = sex === 'male' ? ['standard', 'standard', 'skinny', 'big'] : ['standard', 'standard', 'skinny'];
    const hairColor = Math.floor(Math.random() * (V3_HAIR_COLORS.length - 1)); // le bleu reste un choix délibéré
    apply({ ...equipment, sex, kit, body: pick(bodies), hairColor, beardColor: Math.random() < 0.8 ? hairColor : Math.floor(Math.random() * 5) });
    showSex();
    showBody();
    characterWardrobe.refresh();
  }
  // Tenue au hasard (dé général) : maillot, casque, gants, chaussettes et chaussures, lunettes deux fois sur trois.
  async function randomKit(): Promise<void> {
    const items = await getV3Gear();
    const sex = sexNow();
    const kit = { ...equipment.kit };
    for (const type of ['CYCLING_JERSEY', 'HEAD_GEAR', 'GLASSES', 'GLOVES', 'SOCKS', 'CYCLING_SHOES']) {
      const choice = pick(items.filter(item => item.type === type && (item.sex === 'tous' || item.sex === sex) && !/^none$/i.test(item.variant)));
      if (choice && (type !== 'GLASSES' || Math.random() < 2 / 3)) kit[type] = { id: choice.id, color: Math.floor(Math.random() * Math.max(1, choice.colors.length)) };
      else delete kit[type];
    }
    apply({ ...equipment, kit, sockHeight: pick<V3SockHeight>(['low', 'mid', 'high']) });
    kitWardrobe.refresh();
  }
  const dice = diceButton('Personnage au hasard (corps, tête, cheveux, barbe)');
  dice.onclick = () => { void randomCharacter().catch(report); };
  const sexRow = document.createElement('div');
  sexRow.className = 'v3-sexrow';
  sexRow.append(sexSeg, dice);
  sexField.append(sexRow);
  identity.append(sexField, bodyField);
  character.head.append(identity);
  showSex();
  const characterWardrobe = addWardrobe(character.head, character.section, () => equipment, characterActions, true);
  const openCharacter = () => { characterWardrobe.open(); showSex(); showBody(); };

  // Vélo : fiche du vélo équipé (vignette, coloris, teinte), posture, puis le catalogue par type et par marque.
  const focus = document.createElement('div');
  focus.className = 'v3-bikefocus';
  const focusText = document.createElement('div');
  focusText.className = 'mm-bike-txt';
  const focusName = document.createElement('b');
  const focusType = document.createElement('small');
  const effectLine = document.createElement('small');
  effectLine.className = 'v3-effect';
  focusText.append(focusName, focusType, effectLine);
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
  // Vélo au hasard, avec un coloris au hasard.
  const bikeDice = diceButton('Vélo au hasard (modèle et coloris)');
  bikeDice.onclick = () => { void randomBike().catch(report); };
  const searchRow = document.createElement('div');
  searchRow.className = 'v3-searchrow';
  searchRow.append(searchBike, bikeDice);
  bikes.section.append(types, searchRow, list);

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
  const openBrands = new Set<string>();
  let brandsReady = false;
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
    if (!brandsReady && catalogBikes.length) {
      brandsReady = true;
      const worn = catalogBikes.find(bike => bike.id === equipment.bike);
      if (worn) openBrands.add(worn.brand);
    }
    for (const bike of shown) {
      if (bike.brand !== brand) {
        brand = bike.brand;
        const title = document.createElement('h5');
        title.className = 'mm-bl-brand';
        const count = document.createElement('span');
        count.textContent = String(shown.filter(row => row.brand === bike.brand).length);
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'v3-fold';
        toggle.setAttribute('aria-expanded', String(!!query || openBrands.has(bike.brand)));
        toggle.append(brand || 'Sans marque', count);
        const name = bike.brand;
        toggle.onclick = () => {
          if (openBrands.has(name)) openBrands.delete(name);
          else openBrands.add(name);
          fillBikes();
        };
        title.append(toggle);
        rows.push(title);
      }
      if (!query && !openBrands.has(bike.brand)) continue;
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
      row.onclick = () => { choose(bike.id); void showInlineColors(bike.id); };
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
  /** Vélo au hasard ; le dé général se limite aux vélos de route, gravel, chrono et VTT. */
  async function randomBike(usual = false): Promise<void> {
    const list = catalogBikes.length ? catalogBikes : (await getV3Catalog()).bikes;
    const bike = pick(usual ? list.filter(row => ['route', 'gravel', 'chrono', 'vtt'].includes(row.type)) : list);
    if (!bike) return;
    choose(bike.id);
    const { colors: options } = await getV3Colors(bike.id);
    if (options.length > 1 && equipment.bike === bike.id) {
      apply({ ...equipment, color: Math.floor(Math.random() * options.length), hue: undefined });
      void showColors();
    }
  }
  /**
   * Coloris proposés juste sous le vélo cliqué (s'il en a plusieurs), pour ne pas devoir remonter à la fiche du vélo.
   * Reste synchronisé avec la liste « Coloris » du haut.
   */
  let inlineFor = '';
  function markInline() {
    list.querySelectorAll<HTMLButtonElement>('.v3-inline-colors button').forEach((button, i) => {
      const on = i === equipment.color;
      button.classList.toggle('on', on);
      button.setAttribute('aria-checked', String(on));
    });
  }
  async function showInlineColors(id: string) {
    inlineFor = id;
    list.querySelector('.v3-inline-colors')?.remove();
    const options = (await getV3Colors(id).catch(() => ({ colors: [] as V3Color[] }))).colors;
    if (inlineFor !== id || options.length <= 1) return;
    const row = list.querySelector<HTMLElement>('[data-v3-bike="' + CSS.escape(id) + '"]');
    if (!row) return;
    const box = document.createElement('div');
    box.className = 'v3-inline-colors';
    box.setAttribute('role', 'radiogroup');
    box.setAttribute('aria-label', 'Coloris');
    options.forEach((option, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'gr-sub';
      button.setAttribute('role', 'radio');
      button.textContent = option.name || 'Coloris ' + (i + 1);
      button.onclick = () => {
        apply({ ...equipment, color: i, hue: undefined });
        colors.value = String(i);
        hue.set(bikeColors[i]);
        markInline();
      };
      box.append(button);
    });
    list.querySelector('.v3-inline-colors')?.remove();
    row.after(box);
    markInline();
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
    markInline();
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
    void getV3Gear().then(items => { gearItems = items; updateEffect(); }).catch(() => updateEffect());
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
