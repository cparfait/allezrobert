import type { FanMode } from '@allezrobert/devices';
import type { ExperimentalAdapters, TacxRoadSurface } from '@allezrobert/protocols';
import { ROAD_FEEL, ROAD_FEEL_TEXT, clampRoadFeel, roadFeelLevel } from '@allezrobert/shared';
import { loadSettings } from './settings.ts';
import type { HardwareApi } from '../game/devices.ts';
import { getLang, strings } from '../i18n/index.ts';
import { CHECK_ROLES, startCheckModel, type CheckDevice, type CheckRole, type CheckState } from './startCheck.ts';
import type { DeviceLive } from './menu.ts';
import './blocks.css';
import './hardware-panel.css';

/**
 * Réglages avancés du matériel, sous les tuiles de l'onglet Capteurs : calibration (spin-down),
 * ventilateur asservi, manette et télécommande HID, adaptateurs expérimentaux, power match,
 * ANT+ et Direct Connect (app Windows), diagnostic (états, firmware, journal à copier).
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
/** Textes du module (français, anglais). */
const S = strings(
  {
    off: 'Arrêt',
    connectATacxNeo: 'Connectez un home trainer Tacx NEO (Bluetooth) pour l’essai.',
    readyPickASurface: 'Prêt. Choisissez un revêtement.',
    theNeoOnlyVibrates: 'Le NEO ne vibre que si la roue tourne : pédalez (15 km/h ou plus) pendant l’essai. Hors sortie, rien d’autre n’est envoyé au trainer.',
    testIntensity: 'Intensité de l’essai',
    playAllSurfacesS: 'Enchaîner les {a} revêtements ({b} s chacun)',
    stop: 'Arrêter',
    rideIntensitySettingsTrainer: 'L’intensité en sortie se règle dans Réglages → Home trainer (et sur l’appli compagnon). Plafond {n} %.',
    connectTheTrainerFirst: 'Connectez d’abord le home trainer.',
    tacxNeoTrainersNeed: 'Les Tacx NEO n’ont pas besoin de calibration : le moteur s’étalonne seul (le spin-down répond aussitôt « réussi »). Inutile de le lancer.',
    thisTrainerDoesNot: 'Ce trainer n’annonce pas le spin-down par FTMS : faites-le dans l’appli du fabricant (Wahoo : appli Wahoo → Calibration avancée).',
    warmUp10Min: 'Pédalez 10 min pour chauffer le trainer, puis lancez le spin-down.',
    theTargetSpeed: 'la vitesse demandée',
    requestSent: 'Demande envoyée au trainer…',
    speedUpToAnd: 'Accélérez jusqu’à {n} et tenez cette vitesse.',
    stopPedalingAndLet: 'Arrêtez de pédaler : laissez la roue ralentir seule jusqu’au résultat.',
    startSpinDown: 'Lancer le spin-down',
    manual: 'Manuel',
    t100At: '100 % à',
    maxHr: 'FC max',
    speedFollowsTheGame: 'Vitesse : suit la vitesse du jeu. FC : de 50 % à 90 % de la FC max. Pente : 30 % sur le plat, +10 points par % de pente, la vitesse en descente. L’appli compagnon passe en manuel.',
    test0: 'Essai 0 %',
    gamepadRbLbAnd: 'Manette : RB / LB et croix ↑ ↓ changent de vitesse, RT / LT de plateau',
    gamepadDetected: 'Manette détectée',
    noGamepadDetectedPress: 'Aucune manette détectée : appuyez sur un bouton de la manette pour la réveiller.',
    hidRemoteSeenAs: 'Télécommande HID (Bluetooth / USB, vue comme un clavier)',
    pressTheButton: 'Appuyez sur le bouton…',
    learnUp: 'Apprendre « monter »',
    learnDown: 'Apprendre « descendre »',
    clear: 'effacer',
    up: 'monter',
    down: 'descendre',
    defaultNextTrackUp: 'Par défaut : piste suivante = monter, piste précédente = descendre.',
    keyboardAlwaysWorks: 'Le clavier (↑ ↓, Page ↑ ↓) marche toujours. Avec une cassette réelle (Réglages → Transmission), les vitesses virtuelles sont coupées.',
    undocumentedProtocolsMayBreak: 'Protocoles non documentés par les fabricants, décodés par la communauté : ils peuvent cesser de marcher après une mise à jour du firmware.',
    browserBluetoothShowAll: 'Bluetooth du navigateur : afficher tous les appareils dans le sélecteur (Di2, HEADWIND qui n’annoncent pas leur service)',
    powerMatchInErg: 'Power match : en ERG, les pédales font foi ; la consigne du trainer est corrigée lentement (±15 % max)',
    currentCorrection: 'Correction actuelle',
    powerSource: 'source de puissance',
    antNetworkKey16: 'Clé réseau ANT+ (16 caractères hexadécimaux, licence ANT+ : jamais fournie avec le jeu)',
    emptyEnvVariableOr: 'vide = variable ANT_PLUS_NETWORK_KEY ou fichier',
    shimanoDi2NetworkKey: 'Clé réseau Shimano Di2 (rapport engagé via ANT, expérimental)',
    t16HexCharacters: '16 caractères hexadécimaux',
    directConnectAddA: 'Direct Connect : ajouter un trainer par adresse IP',
    add: 'Ajouter',
    restartTheAppAfter: 'Redémarre l’app après avoir saisi une clé réseau. Pour le Di2, sélectionne ANT+ puis associe le dérailleur dans Vitesses.',
    hosts: 'Adresses',
    antUsbAndDirect: 'ANT+ USB et Wahoo Direct Connect ne sont disponibles que dans l’app Windows (le navigateur ne voit que le Bluetooth).',
    device: 'Appareil',
    link: 'Liaison',
    state: 'État',
    battery: 'Batterie',
    reconnect: 'reconnecter',
    noDevice: 'Aucun appareil.',
    copied: 'Copié ✓',
    copyHardwareLog: 'Copier le journal matériel',
    pasteItInYour: 'À coller dans le signalement (docs/HARDWARE_TEST.md).',
    advancedSettings: 'Réglages avancés',
    trainerCalibration: 'Calibration du home trainer',
    spinDownRedoIt: 'Spin-down : à refaire quand la puissance du trainer paraît fausse.',
    roadFeel: 'Ressenti route',
    tryTheSurfaceVibrations: 'Essayer les vibrations des revêtements (Tacx NEO).',
    fan: 'Ventilateur',
    driveTheKickrHeadwind: 'Régler le KICKR HEADWIND sur la vitesse, le cardio ou la pente.',
    gamepadRemoteKeyboard: 'Manette, télécommande, clavier',
    pickTheButtonsThat: 'Choisir les boutons qui changent de vitesse.',
    experimentalAdapters: 'Adaptateurs expérimentaux',
    zwiftClickAndPlay: 'Zwift Click et Play, Shimano Di2, SRAM AXS, HEADWIND.',
    powerMatch: 'Power match',
    inErgAlignThe: 'En ERG, caler la consigne du trainer sur les pédales.',
    antAndDirectConnect: 'ANT+ et Direct Connect',
    antUsbStickAnd: 'Clé ANT+ USB et trainer par adresse IP (application Windows).',
    diagnostics: 'Diagnostic',
    deviceStatesAndA: 'État des appareils et journal à copier pour un signalement.',
    isAlreadyAGame: '« {n} » est déjà une touche du jeu : rien à apprendre.',
    invalidHost: 'Adresse IP ou nom d’hôte invalide.',
    copyTheLog: 'Copiez le journal :',
    testing: 'Essai : {surface} à {pct} %{seq} · arrêt dans {left} s.',
    sequenceTag: ' (enchaînement)',
    calibOk: 'Calibration réussie{n}.',
    calibUnsupported: 'Spin-down non pris en charge par ce trainer ({n}) : utilisez l’appli du fabricant.',
    refused: 'refusé',
    calibFailed: 'Échec de la calibration{n}. Réessayez après 10 min d’échauffement.',
    adZwift: 'Zwift Click v1 / v2, Play, Ride',
    adZwiftHint: 'Boutons uniquement ; le Click v2 gauche et le Ride v2 doivent avoir été déverrouillés par l’appli Zwift.',
    adDfly: 'Shimano Di2 (boutons D-Fly)',
    adDflyHint: 'Affecter les canaux D-Fly dans E-TUBE (canal 1 = monter, 2 = descendre) ; appairer le Di2 dans Windows.',
    adHeadwind: 'Wahoo KICKR HEADWIND',
    adHeadwindHint: 'Le jeu règle la vitesse (pas de 25 %).',
    adAxs: 'SRAM AXS',
    adAxsHint: 'Appuis anonymes, ou rapport engagé après appairage SRAMBond.',
    adAnt: 'Télécommandes ANT+ Controls',
    adAntHint: 'App Windows + clé ANT+.',
  },
  {
    off: 'Off',
    connectATacxNeo: 'Connect a Tacx NEO trainer (Bluetooth) to test.',
    readyPickASurface: 'Ready. Pick a surface.',
    theNeoOnlyVibrates: 'The NEO only vibrates while the wheel turns: pedal (15 km/h or more) during the test.',
    testIntensity: 'Test intensity',
    playAllSurfacesS: 'Play all {a} surfaces ({b} s each)',
    stop: 'Stop',
    rideIntensitySettingsTrainer: 'Ride intensity: Settings → Trainer (and the companion app). Capped at {n}%.',
    connectTheTrainerFirst: 'Connect the trainer first.',
    tacxNeoTrainersNeed: 'Tacx NEO trainers need no calibration: the motor calibrates itself (spin-down answers “successful” at once). No need to run it.',
    thisTrainerDoesNot: 'This trainer does not offer FTMS spin-down: use the maker’s app.',
    warmUp10Min: 'Warm up 10 min, then start the spin-down.',
    theTargetSpeed: 'the target speed',
    requestSent: 'Request sent…',
    speedUpToAnd: 'Speed up to {n} and hold it.',
    stopPedalingAndLet: 'Stop pedaling and let the wheel coast down.',
    startSpinDown: 'Start spin-down',
    manual: 'Manual',
    t100At: '100 % at',
    maxHr: 'Max HR',
    speedFollowsTheGame: 'Speed follows the game speed; HR from 50 to 90 % of max; grade adds 10 points per %.',
    test0: 'Test 0 %',
    gamepadRbLbAnd: 'Gamepad: RB / LB and d-pad ↑ ↓ shift, RT / LT change chainring',
    gamepadDetected: 'Gamepad detected',
    noGamepadDetectedPress: 'No gamepad detected: press a button to wake it.',
    hidRemoteSeenAs: 'HID remote (seen as a keyboard)',
    pressTheButton: 'Press the button…',
    learnUp: 'Learn “up”',
    learnDown: 'Learn “down”',
    clear: 'clear',
    up: 'up',
    down: 'down',
    defaultNextTrackUp: 'Default: next track = up, previous track = down.',
    keyboardAlwaysWorks: 'Keyboard always works.',
    undocumentedProtocolsMayBreak: 'Undocumented protocols: may break after a firmware update.',
    browserBluetoothShowAll: 'Browser Bluetooth: show all devices in the chooser',
    powerMatchInErg: 'Power match: in ERG, pedals are the reference',
    currentCorrection: 'Current correction',
    powerSource: 'power source',
    antNetworkKey16: 'ANT+ network key (16 hex characters)',
    emptyEnvVariableOr: 'empty = env variable or file',
    shimanoDi2NetworkKey: 'Shimano Di2 network key (gear position over ANT, experimental)',
    t16HexCharacters: '16 hex characters',
    directConnectAddA: 'Direct Connect: add a trainer by IP',
    add: 'Add',
    restartTheAppAfter: 'Restart the app after entering a network key. For Di2, select ANT+ and pair the derailleur under Shifters.',
    hosts: 'Hosts',
    antUsbAndDirect: 'ANT+ USB and Direct Connect need the Windows app.',
    device: 'Device',
    link: 'Link',
    state: 'State',
    battery: 'Battery',
    reconnect: 'reconnect',
    noDevice: 'No device.',
    copied: 'Copied ✓',
    copyHardwareLog: 'Copy hardware log',
    pasteItInYour: 'Paste it in your report.',
    advancedSettings: 'Advanced settings',
    trainerCalibration: 'Trainer calibration',
    spinDownRedoIt: 'Spin-down: redo it when the trainer’s power looks off.',
    roadFeel: 'Road feel',
    tryTheSurfaceVibrations: 'Try the surface vibrations (Tacx NEO).',
    fan: 'Fan',
    driveTheKickrHeadwind: 'Drive the KICKR HEADWIND from speed, heart rate or grade.',
    gamepadRemoteKeyboard: 'Gamepad, remote, keyboard',
    pickTheButtonsThat: 'Pick the buttons that shift gears.',
    experimentalAdapters: 'Experimental adapters',
    zwiftClickAndPlay: 'Zwift Click and Play, Shimano Di2, SRAM AXS, HEADWIND.',
    powerMatch: 'Power match',
    inErgAlignThe: 'In ERG, align the trainer’s target with the pedals.',
    antAndDirectConnect: 'ANT+ and Direct Connect',
    antUsbStickAnd: 'ANT+ USB stick and trainer by IP address (Windows app).',
    diagnostics: 'Diagnostics',
    deviceStatesAndA: 'Device states and a log to copy into a report.',
    isAlreadyAGame: '“{n}” is already a game key.',
    invalidHost: 'Invalid host.',
    copyTheLog: 'Copy the log:',
    testing: 'Testing: {surface} at {pct}%{seq} · stops in {left} s.',
    sequenceTag: ' (sequence)',
    calibOk: 'Calibration successful{n}.',
    calibUnsupported: 'Spin-down not supported by this trainer ({n}): use the maker’s app.',
    refused: 'refused',
    calibFailed: 'Calibration failed{n}. Retry after a 10 min warm-up.',
    adZwift: 'Zwift Click v1 / v2, Play, Ride',
    adZwiftHint: 'Buttons only; the left Click v2 and the Ride v2 must have been unlocked by the Zwift app.',
    adDfly: 'Shimano Di2 (D-Fly buttons)',
    adDflyHint: 'Assign the D-Fly channels in E-TUBE (channel 1 = up, 2 = down); pair the Di2 in Windows.',
    adHeadwind: 'Wahoo KICKR HEADWIND',
    adHeadwindHint: 'The game sets the fan speed (25 % steps).',
    adAxs: 'SRAM AXS',
    adAxsHint: 'Anonymous presses, or engaged gear after SRAMBond pairing.',
    adAnt: 'ANT+ Controls remotes',
    adAntHint: 'Windows app + ANT+ stick.',
  },
);
/** Textes des blocs d'appareils, rendus dans la langue demandée (`lang` des options). */
const HX_FR = {
    viaTheTrainer: 'via le home trainer',
    viaThePedals: 'via les pédales',
    reconnect: 'reconnecter',
    forget: 'oublier',
    testRoadFeel: 'Tester le ressenti route',
    powerSource: 'source de puissance',
    optional: 'facultatif',
    pairedPedalsBecomeThe: 'Des pédales associées deviennent la puissance de référence.',
    aPairedCadenceSensor: 'Un capteur de cadence associé passe avant le home trainer.',
    change: 'Changer',
    pair: 'Associer',
    connection: 'Connexion',
    howTheGameTalks: 'Comment le jeu parle à tes capteurs.',
    simulator: 'Simulateur',
    rideWithoutHardwarePower: 'Rouler sans matériel : la puissance est simulée.',
    guestWithoutHardware: 'Invité sans matériel',
    keyboardOrGamepadUnranked: 'Au clavier ou à la manette, hors classements.',
    bluetoothASensorTalks: 'Bluetooth : un capteur ne parle qu’à une appli à la fois. Ferme les autres (téléphone, compteur, autre logiciel).',
} as const;
const HX_EN: { readonly [K in keyof typeof HX_FR]: string } = {
    viaTheTrainer: 'via the trainer',
    viaThePedals: 'via the pedals',
    reconnect: 'reconnect',
    forget: 'forget',
    testRoadFeel: 'Test road feel',
    powerSource: 'power source',
    optional: 'optional',
    pairedPedalsBecomeThe: 'Paired pedals become the reference power.',
    aPairedCadenceSensor: 'A paired cadence sensor takes over from the trainer.',
    change: 'Change',
    pair: 'Pair',
    connection: 'Connection',
    howTheGameTalks: 'How the game talks to your sensors.',
    simulator: 'Simulator',
    rideWithoutHardwarePower: 'Ride without hardware: power is simulated.',
    guestWithoutHardware: 'Guest without hardware',
    keyboardOrGamepadUnranked: 'Keyboard or gamepad, unranked.',
    bluetoothASensorTalks: 'Bluetooth: a sensor talks to one app at a time. Close the others (phone, head unit, other software).',
};
const hxOf = (fr: boolean) => (k: keyof typeof HX_FR): string => (fr ? HX_FR : HX_EN)[k];
/** Gabarit à plusieurs variables : `fill(S('k'), { a: 1, b: 'x' })` remplace {a} et {b}. */
const fill = (s: string, v: Record<string, unknown>): string => s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k]));

const fr = () => getLang() === 'fr';

/**
 * Carte ouverte : une seule à la fois, conservée entre deux rendus (le panneau se redessine à chaque événement
 * capteur). Toutes repliées au départ : la liste des réglages avancés se lit d'un coup d'œil.
 */
const openSections = new Set<string>();
/** Ouvre une carte et replie les autres. */
function openOnly(id: string): void {
  openSections.clear();
  openSections.add(id);
}
/** Section d'essai du ressenti route déjà ouverte d'office (une fois, à l'appairage du NEO). */
let roadAutoOpened = false;
/** Apprentissage d'une touche de télécommande en cours. */
let learning: 'up' | 'down' | null = null;
let learnCleanup: (() => void) | null = null;
let copiedAt = 0;

const STATE_FR: Record<string, string> = { connected: 'connecté', connecting: 'connexion…', reconnecting: 'reconnexion…', silent: 'muet', error: 'erreur', disconnected: 'déconnecté' };

/** Adaptateurs expérimentaux : clé, nom et aide (clés du dictionnaire `S`). */
const ADAPTERS: Array<[keyof ExperimentalAdapters, Parameters<typeof S>[0], Parameters<typeof S>[0]]> = [
  ['zwiftControllers', 'adZwift', 'adZwiftHint'],
  ['shimanoDfly', 'adDfly', 'adDflyHint'],
  ['headwind', 'adHeadwind', 'adHeadwindHint'],
  ['sramAxs', 'adAxs', 'adAxsHint'],
  ['antControls', 'adAnt', 'adAntHint'],
];

/** Motifs du Tacx NEO proposés à l'essai (le revêtement « coupé » est le bouton Arrêter). */
const ROAD_SURFACES: Array<[Exclude<TacxRoadSurface, 'off'>, string, string]> = [
  ['cobblestonesHard', 'Pavés durs', 'Hard cobbles'],
  ['cobblestonesSoft', 'Pavés doux', 'Soft cobbles'],
  ['brickRoad', 'Briques', 'Brick road'],
  ['concretePlates', 'Plaques de béton', 'Concrete plates'],
  ['woodenBoards', 'Planches', 'Wooden boards'],
  ['gravel', 'Gravier', 'Gravel'],
  ['offRoad', 'Terre', 'Dirt'],
  ['cattleGrid', 'Grille à bétail', 'Cattle grid'],
  ['ice', 'Glace', 'Ice'],
];
/** Durée d'un essai (s) avant l'arrêt automatique, et d'un motif dans l'enchaînement. */
const ROAD_TEST_S = 15;
const ROAD_SEQ_STEP_S = 6;

/** Essai du ressenti route en cours (conservé entre deux rendus du panneau). */
const roadTest = {
  percent: -1,
  surface: 'off' as TacxRoadSurface,
  endsAt: 0,
  sequence: false,
  timer: undefined as ReturnType<typeof setTimeout> | undefined,
  confirmed: false,
};

function roadName(surface: TacxRoadSurface): string {
  const r = ROAD_SURFACES.find(([k]) => k === surface);
  return r ? (fr() ? r[1] : r[2]) : S('off');
}

/** Lance un motif (ou l'enchaînement) et programme la suite ; 'off' arrête l'essai. */
function runRoadTest(api: HardwareApi, surface: TacxRoadSurface, sequence: boolean, rerender: () => void): void {
  clearTimeout(roadTest.timer);
  roadTest.surface = surface;
  roadTest.sequence = sequence && surface !== 'off';
  const stepS = roadTest.sequence ? ROAD_SEQ_STEP_S : ROAD_TEST_S;
  roadTest.endsAt = surface === 'off' ? 0 : Date.now() + stepS * 1000;
  void api.testRoadFeel(surface, roadTest.percent).catch((e: unknown) => alert((e as Error).message));
  if (surface !== 'off') {
    roadTest.timer = setTimeout(() => {
      const i = ROAD_SURFACES.findIndex(([k]) => k === surface);
      const next = roadTest.sequence && i >= 0 && i + 1 < ROAD_SURFACES.length ? ROAD_SURFACES[i + 1]![0] : 'off';
      runRoadTest(api, next, roadTest.sequence, rerender);
    }, stepS * 1000);
  }
  rerender();
}

function roadTestBody(api: HardwareApi): string {
  if (roadTest.percent < 0) roadTest.percent = clampRoadFeel(loadSettings().roadFeelPercent) || ROAD_FEEL.defaultPercent;
  const T = ROAD_FEEL_TEXT[getLang()];
  const ok = api.roadFeelSupported();
  const level = roadFeelLevel(roadTest.percent);
  const running = roadTest.surface !== 'off';
  const left = Math.max(0, Math.ceil((roadTest.endsAt - Date.now()) / 1000));
  const status = !ok
    ? S('connectATacxNeo')
    : running
      ? fill(S('testing'), { surface: roadName(roadTest.surface), pct: roadTest.percent, seq: roadTest.sequence ? S('sequenceTag') : '', left })
      : S('readyPickASurface');
  return `<p class="hw-msg ${running ? 'requested' : ''}">${esc(status)}</p>
    <p class="hw-hint">${S('theNeoOnlyVibrates')}</p>
    <div class="hw-grid"><label class="field">${S('testIntensity')} <span id="hw-roadv">${roadTest.percent} %</span><input id="hw-roadpct" type="range" min="5" max="${ROAD_FEEL.maxPercent}" step="5" value="${roadTest.percent}"/></label></div>
    <p class="${level === 'extreme' ? 'hw-msg error' : level === 'strong' ? 'hw-warn' : 'hw-hint'}" id="hw-roadmsg">${esc(T[level])}</p>
    <div class="hw-row">${ROAD_SURFACES.map(([k, f, e]) => `<button class="btn small ${roadTest.surface === k ? 'primary' : ''}" data-roadtest="${k}" ${ok ? '' : 'disabled'}>${fr() ? f : e}</button>`).join('')}</div>
    <div class="hw-row"><button class="btn small" id="hw-roadseq" ${ok ? '' : 'disabled'}>${fill(S('playAllSurfacesS'), { a: ROAD_SURFACES.length, b: ROAD_SEQ_STEP_S })}</button><button class="btn small" id="hw-roadstop" ${ok && running ? '' : 'disabled'}>${S('stop')}</button></div>
    <p class="hw-hint">${S('rideIntensitySettingsTrainer').replace('{n}', String(ROAD_FEEL.maxPercent))}</p>`;
}

const FAN_MODES: Array<[FanMode, string, string]> = [
  ['off', 'Arrêt', 'Off'],
  ['manual', 'Manuel', 'Manual'],
  ['speed', 'Vitesse', 'Speed'],
  ['heartRate', 'FC', 'Heart rate'],
  ['grade', 'Pente', 'Grade'],
];

function calibrationText(api: HardwareApi): string {
  const c = api.calibration();
  const support = api.calibrationSupport();
  if (support === 'unknown') return S('connectTheTrainerFirst');
  const neo = /\bneo\b/i.test(api.details().find((d) => d.roles.includes('trainer'))?.name ?? '');
  if (neo && (!c || c.status === 'success')) {
    return S('tacxNeoTrainersNeed');
  }
  if (!c) {
    return support === 'unsupported'
      ? S('thisTrainerDoesNot')
      : S('warmUp10Min');
  }
  const range = c.targetSpeedLowKmh !== undefined ? (c.targetSpeedHighKmh && c.targetSpeedHighKmh !== c.targetSpeedLowKmh ? `${Math.round(c.targetSpeedLowKmh)}–${Math.round(c.targetSpeedHighKmh)} km/h` : `${Math.round(c.targetSpeedLowKmh)} km/h`) : S('theTargetSpeed');
  switch (c.status) {
    case 'started':
      return S('requestSent');
    case 'requested':
      return S('speedUpToAnd').replace('{n}', String(range));
    case 'stopPedaling':
      return S('stopPedalingAndLet');
    case 'success':
      return S('calibOk').replace('{n}', c.spinDownTimeMs ? ` (spin-down ${(c.spinDownTimeMs / 1000).toFixed(1)} s)` : '');
    case 'unsupported':
      return S('calibUnsupported').replace('{n}', c.reason ?? S('refused'));
    case 'error':
      return S('calibFailed').replace('{n}', c.reason ? ` : ${c.reason}` : '');
  }
}

/** Carte repliée d'un réglage avancé : un nom clair, une ligne qui dit à quoi il sert, le contenu une fois ouverte. */
function section(id: string, title: string, purpose: string, body: string): string {
  return `<details class="hw-sec" data-sec="${id}" ${openSections.has(id) ? 'open' : ''}><summary><span class="hw-sec-t"><b>${title}</b><small>${purpose}</small></span></summary><div class="hw-body">${body}</div></details>`;
}

export function renderHardwarePanel(el: HTMLElement, api: HardwareApi): void {
  // Le panneau est redessiné à chaque événement capteur : on garde la saisie en cours.
  const active = document.activeElement as HTMLInputElement | null;
  const keepId = active && el.contains(active) && active.id ? active.id : null;
  const keepVal = keepId ? active?.value : undefined;

  if (!roadAutoOpened && api.roadFeelSupported()) {
    roadAutoOpened = true;
    openOnly('road');
  }
  const p = api.prefs();
  const exp = api.experimental();
  const devices = api.details();
  const cal = api.calibration();
  const busy = cal && (cal.status === 'started' || cal.status === 'requested' || cal.status === 'stopPedaling');
  const pads = (navigator.getGamepads?.() ?? []).filter((g): g is Gamepad => !!g);
  const hid = Object.entries(p.hidBindings);
  const pm = api.manager.powerMatch;

  const calib = `<p class="hw-msg ${cal?.status ?? ''}">${esc(calibrationText(api))}</p>
    <button class="btn small primary" id="hw-cal" ${api.calibrationSupport() !== 'supported' || busy ? 'disabled' : ''}>${S('startSpinDown')}</button>`;

  const fan = `<div class="mm-seg" id="hw-fanmode">${FAN_MODES.map(([m, f, e]) => `<button data-mode="${m}" class="${p.fan.mode === m ? 'on' : ''}">${fr() ? f : e}</button>`).join('')}</div>
    <div class="hw-grid">
      <label class="field">${S('manual')} <span>${p.fan.manualPercent} %</span><input id="hw-fanpct" type="range" min="0" max="100" step="25" value="${p.fan.manualPercent}"/></label>
      <label class="field">${S('t100At')} (km/h)<input id="hw-fanfull" type="number" min="15" max="80" value="${p.fan.speedForFullKmh ?? 48}"/></label>
      <label class="field">${S('maxHr')} (bpm)<input id="hw-hrmax" type="number" min="120" max="230" value="${p.fan.maxHeartRateBpm ?? 185}"/></label>
    </div>
    <p class="hw-hint">${S('speedFollowsTheGame')}</p>
    <div class="hw-row"><button class="btn small" data-fantest="0">${S('test0')}</button><button class="btn small" data-fantest="50">50 %</button><button class="btn small" data-fantest="100">100 %</button></div>`;

  const shifters = `<label class="mm-check"><input type="checkbox" id="hw-pad" ${p.gamepad ? 'checked' : ''}/> ${S('gamepadRbLbAnd')}</label>
    <p class="hw-hint">${pads.length ? `${S('gamepadDetected')} : ${esc(pads.map((g) => g.id).join(', '))}` : S('noGamepadDetectedPress')}</p>
    <div class="hw-row">
      <span>${S('hidRemoteSeenAs')}</span>
      <button class="btn small ${learning === 'up' ? 'primary' : ''}" data-learn="up">${learning === 'up' ? S('pressTheButton') : S('learnUp')}</button>
      <button class="btn small ${learning === 'down' ? 'primary' : ''}" data-learn="down">${learning === 'down' ? S('pressTheButton') : S('learnDown')}</button>
      ${hid.length ? `<button class="mm-link" id="hw-hidclear">${S('clear')}</button>` : ''}
    </div>
    <p class="hw-hint">${hid.length ? hid.map(([k, a]) => `<code>${esc(k)}</code> → ${a === 'up' ? S('up') : S('down')}`).join(' · ') : S('defaultNextTrackUp')}</p>
    <p class="hw-hint">${S('keyboardAlwaysWorks')}</p>`;

  const adapters = `<p class="hw-warn">${S('undocumentedProtocolsMayBreak')}</p>
    ${ADAPTERS.map(([k, label, hint]) => `<label class="mm-check"><input type="checkbox" data-exp="${k}" ${exp[k] ? 'checked' : ''}/> <span><b>${esc(S(label))}</b> <small>${esc(S(hint))}</small></span></label>`).join('')}
    <label class="mm-check"><input type="checkbox" id="hw-all" ${api.showAllDevices ? 'checked' : ''}/> ${S('browserBluetoothShowAll')}</label>`;

  const ergBody = `<label class="mm-check"><input type="checkbox" id="hw-pm" ${api.manager.powerMatchEnabled ? 'checked' : ''}/> ${S('powerMatchInErg')}</label>
    <p class="hw-hint">${S('currentCorrection')} : ${(pm.correction * 100).toFixed(1)} % · ${S('powerSource')} : ${esc(api.manager.powerSource)}</p>`;

  const desktop = api.isDesktop
    ? `<div class="hw-grid">
        <label class="field">${S('antNetworkKey16')}<input id="hw-antkey" type="password" autocomplete="off" spellcheck="false" value="${esc(p.antNetworkKey)}" placeholder="${S('emptyEnvVariableOr')}"/></label>
        <label class="field">${S('shimanoDi2NetworkKey')}<input id="hw-shimano-key" type="password" autocomplete="off" spellcheck="false" value="${esc(p.shimanoNetworkKey)}" placeholder="${S('t16HexCharacters')}"/></label>
        <label class="field">${S('directConnectAddA')}<span class="hw-row"><input id="hw-dircon" placeholder="192.168.1.42"/><button class="btn small" id="hw-diradd">${S('add')}</button></span></label>
      </div>
      <p class="hw-hint">${S('restartTheAppAfter')} ${p.dirconHosts.length ? `${S('hosts')} : ${p.dirconHosts.map(esc).join(', ')}` : ''}</p>`
    : `<p class="hw-hint">${S('antUsbAndDirect')}</p>`;

  const diag = `<table class="hw-table"><thead><tr><th>${S('device')}</th><th>${S('link')}</th><th>${S('state')}</th><th>Firmware</th><th>${S('battery')}</th><th>RSSI</th><th></th></tr></thead><tbody>
    ${devices.length ? devices.map((d) => `<tr><td>${esc(d.name)}${d.model ? ` <small>${esc(d.model)}</small>` : ''}</td><td>${esc(d.transport)}</td><td class="st-${d.state}">${esc(fr() ? STATE_FR[d.state] ?? d.state : d.state)}</td><td>${esc(d.firmware ?? '—')}</td><td>${d.battery !== undefined ? `${d.battery} %` : '—'}</td><td>${d.rssi ?? '—'}</td><td>${d.state !== 'connected' ? `<button class="mm-link" data-reco="${esc(d.id)}">${S('reconnect')}</button>` : ''}</td></tr>`).join('') : `<tr><td colspan="7">${S('noDevice')}</td></tr>`}
    </tbody></table>
    <div class="hw-row"><button class="btn small" id="hw-copy">${Date.now() - copiedAt < 2500 ? S('copied') : S('copyHardwareLog')}</button><span class="hw-hint">${S('pasteItInYour')}</span></div>
    <pre class="hw-log">${esc(api.log().split('\n').slice(-12).join('\n'))}</pre>`;

  el.innerHTML = `<div class="hw">
    <h3 class="ab-section">${S('advancedSettings')}</h3>
    ${section('calib', S('trainerCalibration'), S('spinDownRedoIt'), calib)}
    ${section('road', S('roadFeel'), S('tryTheSurfaceVibrations'), roadTestBody(api))}
    ${section('fan', S('fan'), S('driveTheKickrHeadwind'), fan)}
    ${section('shift', S('gamepadRemoteKeyboard'), S('pickTheButtonsThat'), shifters)}
    ${section('exp', S('experimentalAdapters'), S('zwiftClickAndPlay'), adapters)}
    ${section('erg', S('powerMatch'), S('inErgAlignThe'), ergBody)}
    ${section('desk', S('antAndDirectConnect'), S('antUsbStickAnd'), desktop)}
    ${section('diag', S('diagnostics'), S('deviceStatesAndA'), diag)}
  </div>`;

  const rerender = () => renderHardwarePanel(el, api);
  el.querySelectorAll<HTMLDetailsElement>('details.hw-sec').forEach((d) =>
    d.addEventListener('toggle', () => {
      const id = d.dataset.sec as string;
      if (d.open) {
        // Une seule carte ouverte à la fois : les autres se replient sans redessiner le panneau.
        openOnly(id);
        el.querySelectorAll<HTMLDetailsElement>('details.hw-sec[open]').forEach((o) => {
          if (o !== d) o.open = false;
        });
      } else openSections.delete(id);
    }),
  );
  const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel);

  q('#hw-cal')?.addEventListener('click', () => {
    void api.calibrate().catch((e: unknown) => alert((e as Error).message));
  });
  el.querySelectorAll<HTMLButtonElement>('#hw-fanmode button').forEach((b) =>
    b.addEventListener('click', () => api.update((pr) => (pr.fan = { ...pr.fan, mode: b.dataset.mode as FanMode }))),
  );
  const num = (id: string, apply: (v: number) => void) =>
    q<HTMLInputElement>(id)?.addEventListener('change', (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      if (Number.isFinite(v)) apply(v);
    });
  num('#hw-fanpct', (v) => api.update((pr) => (pr.fan = { ...pr.fan, manualPercent: v })));
  num('#hw-fanfull', (v) => api.update((pr) => (pr.fan = { ...pr.fan, speedForFullKmh: v })));
  num('#hw-hrmax', (v) => api.update((pr) => (pr.fan = { ...pr.fan, maxHeartRateBpm: v })));
  el.querySelectorAll<HTMLButtonElement>('[data-fantest]').forEach((b) =>
    b.addEventListener('click', () => void api.testFan(Number(b.dataset.fantest)).catch((e: unknown) => alert((e as Error).message))),
  );
  // Essai du ressenti route : intensité propre à l'essai (non enregistrée), confirmation au premier « très fort ».
  q<HTMLInputElement>('#hw-roadpct')?.addEventListener('input', (e) => {
    roadTest.percent = clampRoadFeel(Number((e.target as HTMLInputElement).value));
    const v = q('#hw-roadv');
    if (v) v.textContent = `${roadTest.percent} %`;
    const lvl = roadFeelLevel(roadTest.percent);
    const msg = q('#hw-roadmsg');
    if (msg) {
      msg.className = lvl === 'extreme' ? 'hw-msg error' : lvl === 'strong' ? 'hw-warn' : 'hw-hint';
      msg.textContent = ROAD_FEEL_TEXT[getLang()][lvl];
    }
  });
  q<HTMLInputElement>('#hw-roadpct')?.addEventListener('change', () => {
    if (roadFeelLevel(roadTest.percent) === 'extreme' && !roadTest.confirmed) {
      if (confirm(ROAD_FEEL_TEXT[getLang()].confirm)) roadTest.confirmed = true;
      else roadTest.percent = ROAD_FEEL.extremePercent - 5;
    }
    // Essai en cours : la nouvelle intensité part tout de suite.
    if (roadTest.surface !== 'off') void api.testRoadFeel(roadTest.surface, roadTest.percent).catch(() => undefined);
    rerender();
  });
  el.querySelectorAll<HTMLButtonElement>('[data-roadtest]').forEach((b) =>
    b.addEventListener('click', () => runRoadTest(api, b.dataset.roadtest as TacxRoadSurface, false, rerender)),
  );
  q('#hw-roadseq')?.addEventListener('click', () => runRoadTest(api, ROAD_SURFACES[0]![0], true, rerender));
  q('#hw-roadstop')?.addEventListener('click', () => runRoadTest(api, 'off', false, rerender));
  q<HTMLInputElement>('#hw-pad')?.addEventListener('change', (e) => api.update((pr) => (pr.gamepad = (e.target as HTMLInputElement).checked)));
  el.querySelectorAll<HTMLButtonElement>('[data-learn]').forEach((b) =>
    b.addEventListener('click', () => {
      learnCleanup?.();
      learning = b.dataset.learn as 'up' | 'down';
      const action = learning;
      const onKey = (e: KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();
        learnCleanup?.();
        // Touches déjà gérées par le clavier du jeu : inutile (et double changement de vitesse).
        if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Escape'].includes(e.code)) {
          if (e.code !== 'Escape') alert(S('isAlreadyAGame').replace('{n}', String(e.code)));
          rerender();
          return;
        }
        api.update((pr) => (pr.hidBindings = { ...pr.hidBindings, [e.code || e.key]: action }));
      };
      window.addEventListener('keydown', onKey, true);
      learnCleanup = () => {
        window.removeEventListener('keydown', onKey, true);
        learning = null;
        learnCleanup = null;
      };
      rerender();
    }),
  );
  q('#hw-hidclear')?.addEventListener('click', () => api.update((pr) => (pr.hidBindings = {})));
  el.querySelectorAll<HTMLInputElement>('[data-exp]').forEach((c) =>
    c.addEventListener('change', () => api.setExperimental({ [c.dataset.exp as keyof ExperimentalAdapters]: c.checked })),
  );
  q<HTMLInputElement>('#hw-all')?.addEventListener('change', (e) => {
    api.showAllDevices = (e.target as HTMLInputElement).checked;
  });
  q<HTMLInputElement>('#hw-pm')?.addEventListener('change', (e) => {
    api.manager.setPowerMatch((e.target as HTMLInputElement).checked);
    rerender();
  });
  q<HTMLInputElement>('#hw-antkey')?.addEventListener('change', (e) => api.update((pr) => (pr.antNetworkKey = (e.target as HTMLInputElement).value.trim())));
  q<HTMLInputElement>('#hw-shimano-key')?.addEventListener('change', (e) => api.update((pr) => (pr.shimanoNetworkKey = (e.target as HTMLInputElement).value.trim())));
  q('#hw-diradd')?.addEventListener('click', () => {
    const v = q<HTMLInputElement>('#hw-dircon')?.value ?? '';
    if (/^[\w.-]+$/.test(v.trim())) api.addDirconHost(v);
    else alert(S('invalidHost'));
  });
  el.querySelectorAll<HTMLButtonElement>('[data-reco]').forEach((b) => b.addEventListener('click', () => api.reconnect(b.dataset.reco as string)));
  q('#hw-copy')?.addEventListener('click', () => {
    const text = api.log();
    const done = () => {
      copiedAt = Date.now();
      rerender();
    };
    if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(text).then(done, () => prompt(S('copyTheLog'), text));
    else prompt(S('copyTheLog'), text);
  });

  if (keepId) {
    const again = el.querySelector<HTMLInputElement>(`#${keepId}`);
    if (again) {
      if (keepVal !== undefined) again.value = keepVal;
      again.focus();
    }
  }
}

// ————————————————————————————————————————————— Blocs des appareils (onglet Capteurs)

/** Mots d'état des blocs : les mêmes que sur l'écran « Prêt à rouler ? » (ui/startCheck.ts). */
const STATE_WORD: Record<'fr' | 'en', Record<CheckState, string>> = {
  fr: { live: 'Connecté', simulated: 'Simulé', searching: 'Recherche…', lost: 'Signal perdu', none: 'Non associé' },
  en: { live: 'Connected', simulated: 'Simulated', searching: 'Searching…', lost: 'Signal lost', none: 'Not paired' },
};
const STATE_CLASS: Record<CheckState, string> = { live: 'is-ok', simulated: 'is-info hw-sim', searching: 'is-warn hw-search', lost: 'is-bad', none: '' };
const ROLE_NAME: Record<'fr' | 'en', Record<CheckRole, string>> = {
  fr: { trainer: 'Home trainer', power: 'Puissance', cadence: 'Cadence', heartRate: 'Cardio', shifter: 'Vitesses', fan: 'Ventilateur' },
  en: { trainer: 'Trainer', power: 'Power', cadence: 'Cadence', heartRate: 'Heart rate', shifter: 'Shifting', fan: 'Fan' },
};
const ROLE_HINT: Record<'fr' | 'en', Record<CheckRole, string>> = {
  fr: { trainer: 'Résistance pilotée (FTMS, FE-C)', power: 'Pédales ou manivelle', cadence: 'Capteur de cadence', heartRate: 'Ceinture ou montre', shifter: 'Manettes (Click, AXS, D-Fly)', fan: 'Ventilateur connecté' },
  en: { trainer: 'Controlled resistance (FTMS, FE-C)', power: 'Pedals or crank', cadence: 'Cadence sensor', heartRate: 'Strap or watch', shifter: 'Controllers (Click, AXS, D-Fly)', fan: 'Smart fan' },
};
/** Mesure en direct d'un rôle (clé de `DeviceLive`), s'il en a une. */
const LIVE_KIND: Partial<Record<CheckRole, 'watts' | 'cadence' | 'hr' | 'gear'>> = { power: 'watts', cadence: 'cadence', heartRate: 'hr', shifter: 'gear' };

/** Appareil tel que le liste le panneau des capteurs (`DevicePanel.list()`), avec son état déjà traduit. */
export interface DeviceTileDevice extends CheckDevice {
  /** État en clair (« connecté », « reconnexion… »), affiché à côté du nom quand il y a plusieurs appareils. */
  state?: string;
}

export interface DeviceTilesInput {
  devices: readonly DeviceTileDevice[];
  live?: DeviceLive | undefined;
  simulatorOn: boolean;
  /** Dessin de chaque rôle (SVG), fourni par l'appelant ; sans dessin, le bloc garde sa case vide. */
  icons?: Partial<Record<CheckRole, string>>;
  /** Texte de la mesure en direct d'un rôle (« 215 W ») ; rafraîchi ensuite par l'appelant via `data-live`. */
  liveText?: (kind: 'watts' | 'cadence' | 'hr' | 'gear') => string;
  /** Le gestionnaire sait relancer un appareil (lien « reconnecter »). */
  canReconnect?: boolean;
  /** Tacx NEO associé : lien « Tester le ressenti route » sur le bloc du home trainer. */
  roadFeel?: boolean;
  /** Cassette réelle : le rapport engagé s'affiche sur le bloc Vitesses. */
  cassette?: boolean;
  lang?: 'fr' | 'en';
}

/**
 * Gros blocs des appareils, au même aspect que l'écran « Prêt à rouler ? » (classes `ab-*` de blocks.css) et avec
 * les mêmes mots d'état. Les attributs lus par l'onglet Capteurs sont conservés : `data-pair="<rôle>"` sur le
 * bouton, `data-forget` et `data-reconnect` sur les liens d'un appareil, `data-live` sur la valeur,
 * `data-roadtest-open` sur le lien d'essai du ressenti route. Fonction pure (aucun accès au document).
 */
export function deviceTilesHtml(o: DeviceTilesInput): string {
  const lang = o.lang ?? (fr() ? 'fr' : 'en');
  const F = lang === 'fr';
  const HX = hxOf(F);
  // Onglet Capteurs : le simulateur se branchera au départ ; ses blocs disent déjà « Simulé ».
  const model = startCheckModel({ devices: o.devices, live: o.live, simulatorOn: o.simulatorOn, loaded: true, simulatorPlanned: F ? 'Simulateur (au départ)' : 'Simulator (at the start)' });
  const tiles = CHECK_ROLES.map((role) => {
    const tile = model.tiles.find((x) => x.role === role);
    if (!tile) return '';
    const mine = o.devices.filter((d) => d.roleIds?.includes(role));
    const own = mine.some((d) => d.ok && !d.simulated);
    const via = tile.via ? ` · ${tile.via === 'trainer' ? (HX('viaTheTrainer')) : HX('viaThePedals')}` : '';
    // Un appareil par ligne, avec ses liens ; sans appareil, ce que le rôle attend (ou celui qui le fournit).
    const lines = mine.length
      ? mine
          .map(
            (d) =>
              `<span class="hw-dev">${esc(d.name)}${mine.length > 1 && d.state ? ` · ${esc(d.state)}` : ''}${d.detail ? ` · ${esc(d.detail)}` : ''}${
                d.canReconnect && o.canReconnect ? ` <button type="button" class="mm-link" data-reconnect="${esc(d.id)}">${HX('reconnect')}</button>` : ''
              }${d.simulated ? '' : ` <button type="button" class="mm-link" data-forget="${esc(d.id)}">${HX('forget')}</button>`}</span>`,
          )
          .join('')
      : `<span class="hw-dev">${esc(tile.device ? `${tile.device}${via}` : ROLE_HINT[lang][role])}</span>`;
    const road = role === 'trainer' && o.roadFeel && tile.state === 'live' ? `<button type="button" class="mm-link" data-roadtest-open>${HX('testRoadFeel')}</button>` : '';
    // Le home trainer montre ses watts quand c'est lui la source de puissance, comme sur l'écran de départ.
    const kind = role === 'shifter' && !o.cassette ? undefined : role === 'trainer' ? (o.live?.powerFrom === 'trainer' ? 'watts' : undefined) : LIVE_KIND[role];
    const shown = kind && (tile.state === 'live' || tile.state === 'simulated');
    const value = shown && o.liveText ? `<b data-live="${kind}">${esc(o.liveText(kind))}</b>` : '';
    const tag = role === 'trainer' || role === 'power' ? (HX('powerSource')) : HX('optional');
    const title =
      tile.via && role === 'power'
        ? HX('pairedPedalsBecomeThe')
        : tile.via && role === 'cadence'
          ? HX('aPairedCadenceSensor')
          : '';
    const quiet = tile.state === 'live' || tile.state === 'simulated';
    return `<div class="ab-tile hw-tile ${STATE_CLASS[tile.state]}" data-role="${role}">
      <span class="ab-tag">${tag}</span>
      <span class="ab-ico" aria-hidden="true">${o.icons?.[role] ?? ''}</span>
      <span class="ab-name">${ROLE_NAME[lang][role]}</span>
      <span class="ab-detail">${lines}${road}</span>
      <span class="ab-val">${value}</span>
      <span class="ab-state"><i></i>${STATE_WORD[lang][tile.state]}</span>
      <button type="button" class="ab-act${quiet ? ' quiet' : ''}" data-pair="${role}"${title ? ` title="${esc(title)}"` : ''}>${own ? (HX('change')) : HX('pair')}</button>
    </div>`;
  }).join('');
  return `<div class="ab-grid hw-tiles">${tiles}</div>`;
}

export interface DeviceOptionsInput {
  /** Choix de la connexion, déjà construit par l'onglet (`this.seg('m-transport', …)`) ; vide s'il n'y en a qu'une. */
  transportSeg: string;
  /** La connexion choisie est le Bluetooth du navigateur : la mise en garde « une appli à la fois » s'applique. */
  bluetooth: boolean;
  simulatorOn: boolean;
  guest: boolean;
  /** Avertissements du gestionnaire d'appareils, un par ligne. */
  warnings?: readonly string[];
  lang?: 'fr' | 'en';
}

/**
 * Connexion, simulateur et invité : un réglage par ligne (libellé, aide courte, commande), au motif `.mm-opt` du
 * menu. Identifiants conservés : `#m-transport` (dans `transportSeg`), `#m-adapters`, `#m-sim`, `#m-guest`. La
 * mise en garde Bluetooth tient en une ligne et ne s'affiche qu'avec le Bluetooth du navigateur. Fonction pure.
 */
export function deviceOptionsHtml(o: DeviceOptionsInput): string {
  const F = (o.lang ?? (fr() ? 'fr' : 'en')) === 'fr';
  const HX = hxOf(F);
  const row = (label: string, help: string, control: string, col = false) =>
    `<div class="mm-opt${col ? ' mm-opt-col' : ''}"><div class="mm-opt-l"><b>${label}</b><small>${help}</small></div>${control}</div>`;
  return `<div class="hw-opts">
    ${o.transportSeg ? row(HX('connection'), HX('howTheGameTalks'), o.transportSeg, true) : ''}
    <div id="m-adapters"></div>
    ${row(HX('simulator'), HX('rideWithoutHardwarePower'), `<input type="checkbox" class="hw-switch" id="m-sim" aria-label="${HX('simulator')}" ${o.simulatorOn ? 'checked' : ''}/>`)}
    ${row(HX('guestWithoutHardware'), HX('keyboardOrGamepadUnranked'), `<input type="checkbox" class="hw-switch" id="m-guest" aria-label="${HX('guestWithoutHardware')}" ${o.guest ? 'checked' : ''}/>`)}
    ${(o.warnings ?? []).map((w) => `<p class="hw-line warn">${esc(w)}</p>`).join('')}
    ${o.bluetooth ? `<p class="hw-line">${HX('bluetoothASensorTalks')}</p>` : ''}
  </div>`;
}
