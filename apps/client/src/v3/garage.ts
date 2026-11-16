import { getV3Catalog, getV3Clips, getV3Colors, getV3Gear, type V3SockHeight, readV3Equipment, V3_HAIR_COLORS, saveV3Equipment, V3_POSES, type V3Bike, type V3Body, type V3Color, type V3Equipment, type V3Gear, mountedWheel, wheelsFor, type V3Wheel } from './visuals.ts';
import { addWardrobe, createHueControl, onScreen, whenVisible } from './wardrobe.ts';
import { V3_ICON } from './icons.ts';
import { COSMETICS, DEFAULT_BIKE, DEFAULT_TRAINER } from '@allezrobert/shared';
import { saveV3BikeSetup, v3BikeEffect } from './physics.ts';
import { createProfilesCard } from './profiles.ts';
import { v3Select } from './dropdown.ts';
import { roadEffectHtml } from '../ui/roadEffect.ts';
import { loadSettings } from '../ui/settings.ts';
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
  /** Photo de profil d'une roue sans icône Zwift. */
  photoWheel?(id: string, wanted: () => boolean): Promise<string>;
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
  field(parent, label, control);
  // Liste aux couleurs de l'appli (refaite à chaque ouverture : les choix changent après coup).
  v3Select(control);
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
  // Dé général à côté des rubriques : tout tiré ensemble (tenue, personnage, vélo, coloris, roues, home trainer).
  const navRow = document.createElement('div');
  navRow.className = 'v3-navrow';
  const allDice = diceButton('Tout au hasard : personnage, tenue, vélo, coloris, roues et home trainer');
  allDice.onclick = () => {
    void (async () => {
      await randomKit();
      await randomCharacter();
      await randomBike(true);
      randomTrainer();
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
    profiles.sync();
  }
  // Profils de coureur (tout l'équipement sous un nom), en tête du panneau, visibles dans chaque rubrique.
  const profiles = createProfilesCard({
    current: () => equipment,
    load: value => {
      apply(value);
      refreshAll();
    },
  });
  panel.append(profiles.element);
  /**
   * Effet du vélo et des accessoires sur la sortie (poids, traînée) d'après leurs caractéristiques Zwift :
   * affiché sous la fiche du vélo et enregistré pour la prochaine sortie en style V3.
   */
  let gearItems: V3Gear[] = [];
  // Panneau « Effet sur la route » des garages Réel et Poly (barres Aéro, Légèreté, Chemins, gains à mêmes watts),
  // pour le vélo V3 roulé : placé par l'atelier à gauche du panneau, comme dans les autres styles.
  const road = document.createElement('aside');
  road.className = 'gr-road';
  road.setAttribute('aria-label', 'Effet sur la route');
  function updateEffect() {
    if (!catalogBikes.length) return;
    const effect = v3BikeEffect(equipment, catalogBikes, gearItems, catalogWheels);
    saveV3BikeSetup(effect.setup);
    const rider = loadSettings();
    const html = document.createElement('template');
    html.innerHTML = roadEffectHtml(effect.setup, rider.massKg, rider.ftpWatts);
    road.replaceChildren(...(html.content.firstElementChild?.childNodes ?? []));
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
    // Comme dans les garages Réel et Poly : pas d'effet sur la route pour le visage et le corps.
    road.hidden = id === 'character';
    panel.parentElement?.scrollTo({ top: 0 });
    // Chaque menu s'ouvre sur l'équipement porté (famille ou marque dépliée, article visible).
    if (id === 'kit') openKit();
    if (id === 'character') openCharacter();
    if (id === 'bikes') foldBikes();
  }

  // Ordre des rubriques : Personnage, Tenue, Vélo (le garage s'ouvre sur la première).
  const character = sectionFor('character', 'Personnage', V3_ICON.face);
  const kit = sectionFor('kit', 'Tenue', V3_ICON.tenue);
  const bikes = sectionFor('bikes', 'Vélo', V3_ICON.bike);
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
    apply({ ...equipment, sex, kit, body: pick(bodies), hairColor, beardColor: Math.random() < 0.8 ? hairColor : Math.floor(Math.random() * 5), hairTint: undefined, beardTint: undefined });
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
  // Teinte des coloris réglables de Zwift : fait tourner les couleurs de la peinture (noir, gris et blanc restent).
  // Proposée avec les coloris, sous le vélo choisi dans la liste.
  const hue = createHueControl(value => apply({ ...equipment, hue: value }));
  hue.field.title = 'Fait tourner les couleurs de la peinture (coloris réglable) ; le noir, le gris et le blanc ne changent pas.';
  // Réglages du vélo équipé, regroupés dans une carte : une ligne par réglage (posture, roues, home trainer).
  const settingsCard = document.createElement('div');
  settingsCard.className = 'v3-settings';
  bikes.section.append(settingsCard);
  // Coloris et teinte du vélo équipé, toujours accessibles (première ligne des réglages).
  const colorRow = document.createElement('div');
  colorRow.className = 'v3-color-row';
  colorRow.hidden = true;
  settingsCard.append(colorRow);
  const ride = document.createElement('div');
  ride.className = 'v3-ride';
  const poses = select(ride, 'Posture');
  for (const [id, label] of Object.entries(V3_POSES)) poses.add(new Option(label, id));
  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'gr-sub v3-play';
  play.textContent = '▶ Pédaler';
  play.title = 'Pédaler à 90 tr/min';
  play.setAttribute('aria-pressed', 'false');
  play.onclick = () => {
    const on = play.getAttribute('aria-pressed') === 'false';
    play.setAttribute('aria-pressed', String(on));
    play.classList.toggle('on', on);
    play.textContent = on ? '❚❚ Pause' : '▶ Pédaler';
    actions.playing(on);
  };
  ride.append(play);
  settingsCard.append(ride);
  // Roues (comme dans Zwift, pas de pneus à part : ils viennent avec les roues). Même présentation que la liste des
  // vélos : intitulé repliable (paire montée), puis lignes avec vignette, marques repliées sauf celle de la paire montée.
  const wheelField = document.createElement('div');
  wheelField.className = 'field';
  wheelField.hidden = true;
  const wheelToggle = document.createElement('button');
  wheelToggle.type = 'button';
  wheelToggle.className = 'v3-fold v3-setting-toggle';
  wheelToggle.setAttribute('aria-expanded', 'false');
  const wheelName = document.createElement('span');
  wheelToggle.append('Roues', wheelName);
  const wheelList = document.createElement('div');
  wheelList.className = 'mm-bikelist v3-wheels';
  wheelList.hidden = true;
  wheelToggle.onclick = () => {
    wheelList.hidden = !wheelList.hidden;
    wheelToggle.setAttribute('aria-expanded', String(!wheelList.hidden));
    showWheels();
  };
  wheelField.append(wheelToggle, wheelList);
  settingsCard.append(wheelField);
  const openWheelBrands = new Set<string>();
  const wheelLabel = (wheel: V3Wheel) => wheel.name.toLowerCase().startsWith(wheel.brand.toLowerCase()) ? wheel.name : wheel.brand + ' ' + wheel.name;
  function wheelIcon(wheel: V3Wheel | undefined): HTMLElement {
    if (!wheel?.preview) {
      const empty = document.createElement('span');
      empty.className = 'mm-bikeicon v3-wheelicon';
      empty.innerHTML = V3_ICON.bike;
      // Pas d'icône Zwift : roue photographiée au studio quand la ligne devient visible.
      const photo = actions.photoWheel;
      if (wheel && photo) {
        const take = () => {
          void photo(wheel.id, () => onScreen(empty)).then(url => {
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
    image.className = 'mm-bikeicon v3-wheelicon';
    image.src = '/__v3/wheel/' + wheel.id + '.png';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.alt = '';
    return image;
  }
  function showWheels() {
    const bike = catalogBikes.find(row => row.id === equipment.bike);
    const offered = wheelsFor(bike?.type, catalogWheels)
      .sort((a, b) => a.brand.localeCompare(b.brand, 'fr') || a.name.localeCompare(b.name, 'fr', { numeric: true }));
    wheelField.hidden = !offered.length;
    const current = mountedWheel(equipment, bike, catalogWheels);
    const origin = bike?.wheels?.id ? catalogWheels.find(wheel => wheel.id === bike.wheels?.id) : undefined;
    wheelName.textContent = current ? wheelLabel(current) : 'D’origine';
    if (wheelList.hidden) return;
    // Poids et traînée de la paire par rapport aux roues d'origine du vélo.
    const versus = (wheel: V3Wheel) => {
      const own = bike?.wheels;
      const kind = wheel.kind === 'gravel' ? 'Gravel' : 'Route';
      if (!own) return kind + ' · ' + wheel.weightG.toLocaleString('fr-FR') + ' g';
      const grams = Math.round(wheel.weightG - own.weightG);
      const drag = Math.round((wheel.cdaBias - own.cdaBias) / DEFAULT_BIKE.cda * 1000) / 10;
      return kind + ' · ' + (grams > 0 ? '+' : '') + grams.toLocaleString('fr-FR') + ' g · traînée ' + (drag > 0 ? '+' : '') + drag.toLocaleString('fr-FR') + ' %';
    };
    const row = (wheel: V3Wheel | undefined, name: string, detail: string) => {
      const on = current?.id === wheel?.id;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mm-bike' + (on ? ' on' : '');
      button.setAttribute('aria-pressed', String(on));
      const text = document.createElement('span');
      text.className = 'mm-bike-txt';
      const title = document.createElement('b');
      title.textContent = name;
      const sub = document.createElement('small');
      sub.textContent = detail;
      text.append(title, sub);
      const side = document.createElement('span');
      side.className = 'mm-bike-side';
      if (on) side.innerHTML = '<span class="mm-bike-state">✓ Équipé</span>';
      button.append(wheelIcon(wheel ?? origin), text, side);
      button.onclick = () => { apply({ ...equipment, wheels: wheel?.id }); showWheels(); };
      return button;
    };
    const rows: HTMLElement[] = [row(undefined, 'D’origine', origin ? 'Livrées avec ce vélo : ' + wheelLabel(origin) : 'Livrées avec ce vélo')];
    for (const brand of [...new Set(offered.map(wheel => wheel.brand))]) {
      const own = offered.filter(wheel => wheel.brand === brand);
      const heading = document.createElement('h5');
      heading.className = 'mm-bl-brand';
      const count = document.createElement('span');
      count.textContent = String(own.length);
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'v3-fold';
      toggle.setAttribute('aria-expanded', String(openWheelBrands.has(brand)));
      toggle.append(brand, count);
      toggle.onclick = () => {
        if (openWheelBrands.has(brand)) openWheelBrands.delete(brand);
        else openWheelBrands.add(brand);
        showWheels();
      };
      heading.append(toggle);
      rows.push(heading);
      if (openWheelBrands.has(brand)) rows.push(...own.map(wheel => row(wheel, wheelLabel(wheel), versus(wheel))));
    }
    wheelList.replaceChildren(...rows);
  }
  // Home trainer du garage (ceux du jeu) : le vélo V3 est monté dessus, roue arrière retirée.
  const trainerField = document.createElement('div');
  trainerField.className = 'field';
  const trainers = document.createElement('div');
  trainers.className = 'v3-inline-colors v3-trainers';
  trainers.setAttribute('role', 'radiogroup');
  trainers.setAttribute('aria-label', 'Home trainer');
  const trainerOptions: Array<[string | null, string]> = [
    [null, 'Aucun'], ...COSMETICS.filter(item => item.slot === 'trainer').map(item => [item.id, item.name.fr] as [string, string]),
  ];
  // Replié par défaut : l'intertitre montre le home trainer choisi.
  const trainerToggle = document.createElement('button');
  trainerToggle.type = 'button';
  trainerToggle.className = 'v3-fold v3-setting-toggle';
  trainerToggle.setAttribute('aria-expanded', 'false');
  const trainerName = document.createElement('span');
  trainerToggle.append('Home trainer', trainerName);
  trainers.hidden = true;
  trainerToggle.onclick = () => {
    trainers.hidden = !trainers.hidden;
    trainerToggle.setAttribute('aria-expanded', String(!trainers.hidden));
  };
  function showTrainer() {
    const current = equipment.trainer === undefined ? DEFAULT_TRAINER : equipment.trainer;
    trainerName.textContent = trainerOptions.find(([id]) => id === current)?.[1] ?? '';
    trainers.querySelectorAll<HTMLButtonElement>('button').forEach((button, i) => {
      const on = trainerOptions[i]?.[0] === current;
      button.classList.toggle('on', on);
      button.setAttribute('aria-checked', String(on));
    });
  }
  for (const [id, name] of trainerOptions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gr-sub';
    button.setAttribute('role', 'radio');
    button.textContent = name;
    button.onclick = () => { apply({ ...equipment, trainer: id }); showTrainer(); };
    trainers.append(button);
  }
  trainerField.append(trainerToggle, trainers);
  settingsCard.append(trainerField);
  showTrainer();
  const catalogTitle = document.createElement('h4');
  catalogTitle.className = 'v3-subtitle';
  catalogTitle.textContent = 'Catalogue des vélos';
  const types = document.createElement('select');
  types.className = 'v3-types';
  types.setAttribute('aria-label', 'Type de vélo');
  types.onchange = () => { bikeType = types.value; fillBikes(); };
  const searchBike = document.createElement('input');
  searchBike.type = 'search';
  searchBike.placeholder = 'Rechercher un vélo';
  searchBike.setAttribute('aria-label', searchBike.placeholder);
  const list = document.createElement('div');
  list.className = 'mm-bikelist';
  // Vélo au hasard, avec un coloris au hasard.
  const bikeDice = diceButton('Vélo au hasard (modèle, coloris et roues)');
  bikeDice.onclick = () => { void randomBike().catch(report); };
  const searchRow = document.createElement('div');
  searchRow.className = 'v3-searchrow v3-catalog-row';
  searchRow.append(types, searchBike, bikeDice);
  v3Select(types);
  bikes.section.append(catalogTitle, searchRow, list);

  panel.append(status);

  let catalogBikes: V3Bike[] = [];
  let catalogWheels: V3Wheel[] = [];
  let bikeType = 'all';
  function showFocus() {
    const bike = catalogBikes.find(row => row.id === equipment.bike);
    focus.firstElementChild?.replaceWith(bikeIcon(bike, true));
    focusName.textContent = bike ? bikeName(bike) : equipment.bike;
    focusType.textContent = bike ? typeLabel(bike.type) : '';
  }
  const openBrands = new Set<string>();
  function fillBikes() {
    const query = searchBike.value.trim().toLowerCase();
    const counts = new Map<string, number>();
    for (const bike of catalogBikes) counts.set(bike.type, (counts.get(bike.type) ?? 0) + 1);
    const known = BIKE_TYPES.filter(([id]) => counts.has(id));
    const other = [...counts.keys()].filter(id => !BIKE_TYPES.some(([type]) => type === id)).map(id => [id, id] as [string, string]);
    const options: Array<[string, string]> = [['all', 'Tous les types (' + catalogBikes.length + ')'],
      ...[...known, ...other].map(([id, label]): [string, string] => [id, label + ' (' + (counts.get(id) ?? 0) + ')'])];
    if (types.options.length !== options.length) types.replaceChildren(...options.map(([id, label]) => new Option(label, id)));
    types.value = bikeType;
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
    // Coloris et teinte du vélo équipé, sous sa ligne (si sa marque est dépliée).
    void showInlineColors(equipment.bike);
  }
  /** Vélo au hasard ; le dé général se limite aux vélos de route, gravel, chrono et VTT. */
  /**
   * Vélo au hasard : modèle, coloris et roues (d'origine deux fois sur cinq ; sinon une paire de la famille du vélo,
   * gravel ou route), appliqués d'un coup (un seul chargement du vélo).
   */
  async function randomBike(usual = false): Promise<void> {
    const catalog = await getV3Catalog();
    const list = catalog.bikes;
    const bike = pick(usual ? list.filter(row => ['route', 'gravel', 'chrono', 'vtt'].includes(row.type)) : list);
    if (!bike) return;
    const { colors: options } = await getV3Colors(bike.id).catch(() => ({ colors: [] as V3Color[] }));
    const offered = wheelsFor(bike.type, catalog.wheels ?? []).filter(wheel => wheel.kind === (bike.type === 'gravel' ? 'gravel' : 'route'));
    const wheels = offered.length && Math.random() < 0.6 ? pick(offered)?.id : undefined;
    apply({ ...equipment, bike: bike.id, color: options.length > 1 ? Math.floor(Math.random() * options.length) : 0, hue: undefined, wheels });
    showFocus();
    fillBikes();
    showWheels();
  }
  /** Home trainer au hasard parmi ceux du jeu (dé général). */
  function randomTrainer(): void {
    const trainer = pick(trainerOptions.map(([id]) => id).filter((id): id is string => !!id));
    if (!trainer) return;
    apply({ ...equipment, trainer });
    showTrainer();
  }
  /** Coloris (s'il y en a plusieurs) et teinte (coloris réglable) du vélo équipé, en tête des réglages. */
  let inlineFor = '';
  function markInline() {
    colorRow.querySelectorAll<HTMLButtonElement>('.v3-inline-colors button').forEach((button, i) => {
      const on = i === equipment.color;
      button.classList.toggle('on', on);
      button.setAttribute('aria-checked', String(on));
    });
  }
  async function showInlineColors(id: string) {
    inlineFor = id;
    const options = (await getV3Colors(id).catch((error: unknown) => { report(error); return { colors: [] as V3Color[] }; })).colors;
    if (inlineFor !== id || equipment.bike !== id) return;
    // Toujours affichée : un seul coloris (sans teinte réglable) est dit tel quel.
    colorRow.hidden = false;
    if (options.length <= 1 && options[0]?.hue === undefined) {
      const only = document.createElement('div');
      only.className = 'v3-setting-line';
      const name = document.createElement('b');
      name.textContent = options[0]?.name && options[0].name !== 'Default' ? options[0].name : 'D’origine';
      only.append('Coloris', name);
      only.title = 'Un seul coloris pour ce vélo dans Zwift, sans teinte réglable.';
      colorRow.replaceChildren(only);
      return;
    }
    const title = document.createElement('div');
    title.className = 'v3-color-title';
    title.textContent = 'Coloris';
    const box = document.createElement('div');
    box.className = 'v3-inline-colors';
    box.setAttribute('role', 'radiogroup');
    box.setAttribute('aria-label', 'Coloris');
    if (options.length > 1) options.forEach((option, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'gr-sub';
      button.setAttribute('role', 'radio');
      button.textContent = option.name || 'Coloris ' + (i + 1);
      button.onclick = () => {
        apply({ ...equipment, color: i, hue: undefined });
        hue.set(option);
        markInline();
      };
      box.append(button);
    });
    hue.set(options[equipment.color], equipment.hue);
    box.append(hue.field);
    colorRow.replaceChildren(title, box);
    markInline();
  }
  /**
   * Arrivée dans la rubrique Vélo : tout replié (marques, roues, home trainer) ; le vélo équipé est en tête (fiche),
   * les roues et le home trainer montés dans leurs intitulés.
   */
  function foldBikes() {
    openBrands.clear();
    openWheelBrands.clear();
    searchBike.value = '';
    wheelList.hidden = true;
    wheelToggle.setAttribute('aria-expanded', 'false');
    trainers.hidden = true;
    trainerToggle.setAttribute('aria-expanded', 'false');
    if (catalogBikes.length) fillBikes();
    showWheels();
  }
  function choose(bike: string) {
    if (bike === equipment.bike) return;
    apply({ ...equipment, bike, color: 0, hue: undefined });
    showFocus();
    fillBikes();
    showWheels();
  }
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
    catalogWheels = catalog.wheels ?? [];
    showWheels();
    void getV3Gear().then(items => { gearItems = items; updateEffect(); }).catch(() => updateEffect());
    if (!catalogBikes.some(bike => bike.id === equipment.bike) && catalogBikes[0]) choose(catalogBikes[0].id);
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
  /** Tout le panneau remis d'accord avec l'équipement (profil chargé). */
  function refreshAll(): void {
    showSex();
    showBody();
    kitWardrobe.refresh();
    characterWardrobe.refresh();
    showFocus();
    if (catalogBikes.length) fillBikes();
    showWheels();
    showTrainer();
  }
  show('character');
  return { top, panel, road, report };
}
