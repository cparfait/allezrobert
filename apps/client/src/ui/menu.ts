import { deviceModesHtml, deviceOptionsHtml, deviceTilesHtml } from './hardware-panel.ts';
import { ICONS as START_ICONS } from './startCheck.ts';
import { workoutStudioHtml, type WorkoutDurFilter, type WorkoutSort } from './workoutStudio.ts';
import { clampWorkoutIntensity, ftpTestProtocolOf } from '../game/workout.ts';
import { ftpTestChartHtml } from './ftpTestChart.ts';
import { crossedArmsSrc } from './waitBike.ts';
import type { AvatarLook, CosmeticItem, RouteData, RouteSegment, WorldCatalogue } from '@allezrobert/shared';
import type { WorldRoutes } from '../world/routeStore.ts';
import { ROAD_FEEL, ROAD_FEEL_TEXT, clampRoadFeel, roadFeelLevel } from '@allezrobert/shared';
import { GRAPHIC_STYLE, V3_AVAILABLE, V3_STYLE, setGraphicStyle, type GraphicStyle } from '../engine/style.ts';
import { readKomRecord } from '../game/challenge.ts';
import { COUNTRIES, BIKE_BRANDS, BIKE_GROUPS, BIKE_TEAMS, COSMETICS, DEFAULT_BIKE, bikeById, routesForBike, mirrorStartM, rankRouteId, lookSex, tuneItem, withSex, bottleCapacity, bikeSetupFor, jerseyLookOf, helmetLookOf, glassesLookOf, levelProgress, xpForLevel, SHOE_MARKS, equippedTuneIds, trainerOf, type BikeCollection, type BikeType, type CapLook, type CosmeticSlot } from '@allezrobert/shared';
import { shoeAccentOf } from '../rider/shoeLook.ts';
import { WORKOUT_LIBRARY, WORKOUT_TYPES, WORKOUT_TYPE_LABELS, parseWorkoutFile, tunedBikeSetup, type LibraryWorkout, type WorkoutStep, type WorkoutType } from '@allezrobert/physics';
import { rideHistory } from '../data/history/instance.ts';
import type { LocalWorkout } from '../data/history/index.ts';
import { HistoryPanel } from './historyPanel.ts';
import { formatBytes, inTauri, installPack, installedPacks, loadCatalogue, packState, removePack } from '../world/packs.ts';
import { fillStoragePanel, storagePanelHtml } from './desktopUi.ts';
import { inDesktop, quitApp } from '../platform/desktop.ts';
import { compositeId, neighbourZones, PARIS_CITY_ZONES } from '../world/composite.ts';
import { t, setLang, getLang, strings, type I18nKey } from '../i18n/index.ts';
import type { Settings } from './settings.ts';
import { nowHour, saveSettings } from './settings.ts';
import { music } from '../audio/music.ts';
import { spotify, redirectUri } from '../audio/spotify.ts';
import { musicSource, setMusicSource } from '../audio/musicSource.ts';
import { renderStravaLink } from './stravaLink.ts';
import { apiBase } from './account.ts';
import { flagSvg } from './flagSvg.ts';
import { enhanceSelects, listKeys } from './dropdown.ts';
import { renderSoundSettings } from './soundSettings.ts';
import { bikeThumbHtml, paintPlainThumbs, plainThumbHtml, swapMissingThumbs } from './bikeThumb.ts';
import { OpenWorldPanel } from './openWorld.ts';
import { renderCompanionSettings } from './companionQr.ts';
import { HUD_BLOCKS } from '../hud/hud.ts';
import { bindHudPicker, hudPickerHtml } from './hudPicker.ts';
import { renderExpertSettings } from './expertZones.ts';
import { loadProgress, equipItem, equipPlainBike, SLOT_LABEL } from './garage.ts';
import { roadEffectHtml } from './roadEffect.ts';
import { AtelierPanel, COIN } from './atelierPanel.ts';
import type { AtelierState } from './atelier.ts';
import { WORLD_LIST } from '../world/worlds.ts';
import { OUTFITS } from './outfits.ts';
import type { GarageView } from './poster.ts';
import { FriendsPanel } from './friends.ts';
import { ProgressPage } from './progressPage.ts';
import { characterTypeHtml, faceEditorHtml, withBaseHead, withLikeness, withProfile, withRandomFace, withSlider, type FaceTab } from './faceEditor.ts';
import type { FaceSlider } from '@allezrobert/shared';
import { joinSettings } from './friendsLogic.ts';
import { RoutePlanner } from './routePlanner.ts';
import { companionQr } from './companionQr.ts';
import { FranceMap, type MapZone } from './franceMap.ts';
import { bindStartPicker, loadRouteBoards, routeDetailHtml } from './routeDetail.ts';
import { canMoveStart, canReverse, reversedOf, routeKey, snapStartM, startedOf } from '../game/direction.ts';
import { ZONE_SPOTS } from '../world/zoneMap.ts';

// Vignettes des mondes imaginaires (à côté de la carte de France) : chargées dès le menu, prêtes à l'ouverture.
if (typeof Image !== 'undefined') for (const z of ZONE_SPOTS) if (z.image) new Image().src = z.image;
import { getAspectCap, getResolutionCap, getUiAspectCap, setAspectCap, setResolutionCap, setUiAspectCap, type AspectCap, type ResolutionCap } from '../engine/display.ts';
import { activateFocus, inEditable, moveFocus, type NavDir } from './focusNav.ts';

/** Touches fléchées du menu et direction de navigation du focus. */
const ARROW_DIRS: Record<string, NavDir | undefined> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

const S = strings(
  {
    off: 'Coupé',
    selected: 'Choisie',
    customSky: 'ciel réglé',
    startAt: 'Départ à',
    todaySWeather: 'météo du moment',
    timeAndWeather: 'Heure et météo',
    wxFold: 'Réduire l’heure et la météo',
    wxUnfold: 'Afficher le détail de l’heure et de la météo',
    real: 'Réelles',
    custom: 'Personnalisées',
    conditions: 'Conditions',
    todayReal: 'Du jour (réelles)',
    custom2: 'Réglées',
    realSkyRainFog: 'Ciel, pluie, brouillard et vent réels autour du départ, à l’heure choisie (prévision du jour <a href="https://open-meteo.com" target="_blank" rel="noopener" style="color:inherit">Open-Meteo</a>). Sans réseau : conditions réglées.',
    sky: 'Ciel',
    sunny: '☀ Soleil',
    cloudy: '☁ Nuageux',
    rain: '🌧 Pluie',
    fog: '🌫 Brouillard',
    wind: 'Vent',
    calm: 'Calme',
    light: 'Léger',
    moderate: 'Moyen',
    strong: 'Fort',
    weather: 'Météo',
    fixed: 'Fixe',
    changing: 'Qui évolue',
    startTime: 'Heure de départ',
    currentTime: 'Heure actuelle',
    custom3: 'Réglée',
    progress: 'Progression',
    friends: 'Amis',
    loadingTheGarage: 'Chargement du garage…',
    rideTogetherEachFrom: 'Rouler ensemble, chacun chez soi.',
    pairYourTrainerAnd: 'Associe ton home trainer et tes capteurs. Une seule appli à la fois par capteur Bluetooth.',
    myProfile: 'Mon profil',
    level: 'Niveau',
    creditsOpenTheGarage: 'Crédits : ouvrir l’atelier du garage pour les dépenser',
    signOut: 'Déconnexion',
    signIn: 'Se connecter',
    quitAllezRobert: 'Quitter Allez Robert !',
    quit: 'Quitter',
    whatDoYouWant: 'Que veux-tu faire ?',
    freeRideToPick: 'Parcours libre : ← / → pour choisir ta direction à chaque carrefour, U pour faire demi-tour.',
    joinARide: 'Rejoindre une sortie',
    gotACodeFrom: 'Un ami t’a donné un code ? Saisis-le : tu roules avec ses réglages.',
    inviteCode: 'Code d’invitation',
    orCreateYourRace: 'Ou créer ta course',
    orCreateYourRide: 'Ou créer ta sortie',
    theseSettingsYourTime: 'Ces réglages, ton heure et ta météo valent pour tout le groupe.',
    laps: 'Tours',
    theRaceEndsAfter: 'La course s’arrête après ce nombre de tours.',
    aiRiders: 'Coureurs IA',
    eachHasItsOwn: 'Chacun a sa tactique et sa forme du jour.',
    aiLevel: 'Niveau des IA',
    theirPowerAsA: 'Leur puissance, en part de ta FTP.',
    targetAverageSpeed: 'Vitesse moyenne visée',
    aiRidersPaceThemselves: 'Les IA règlent leur effort pour la tenir ; l’organisateur peut l’augmenter en route.',
    free: 'Libre',
    bikes: 'Vélos',
    theSameBikeFor: 'Le même vélo pour tous, ou chacun le sien avec ses pièces de l’atelier.',
    sameBikeForAll: 'Même vélo pour tous',
    eachTheirOwn: 'Chacun son vélo',
    whereToRide: 'Où rouler ?',
    chooseMyCountry: 'Choisir mon pays',
    none: 'Aucune',
    myWorkout: 'Ma séance',
    changeWorkout: 'Changer de séance',
    chooseYourWorkout: 'Choisis ta séance',
    close: 'Fermer',
    orImportAWorkout: 'Importer une séance',
    workoutPickSub: 'Regarde le profil, règle l’intensité, puis choisis.',
    t8MinFrom50: '8 min de 50 à 80 W',
    t1530Min: '15 à 30 min',
    t5MinAt100: '5 min à 100 W',
    t1020Min: '10 à 20 min',
    ramp: 'Rampe',
    gentleRamp: 'Rampe douce',
    t20MinTest: 'Test 20 min',
    protocol: 'Protocole',
    coachVoice: 'Voix du coach',
    announcesTheStepsAnd: 'Annonce les paliers et la FTP estimée en direct.',
    on: 'Oui',
    off2: 'Non',
    howTheTestWorks: 'Comment se passe le test',
    freeRide: 'Parcours libre',
    drawnRoute: 'Parcours dessiné',
    loop: ' · boucle',
    changeRide: 'Changer de sortie',
    chooseMyRide: 'Choisir ma sortie',
    changeRoute: 'Changer de parcours',
    areaChoices: 'Choix de la zone',
    loadingTheOthers: 'chargement des autres…',
    areaOrder: 'Ordre de la zone',
    byDistance: 'Par distance',
    byClimbing: 'Par dénivelé',
    loop2: 'Boucle',
    oneWay: 'Aller simple',
    selected2: 'choisi',
    reversed: ', sens inverse',
    movedStart: ', départ déplacé',
    selectedRoute: 'Parcours choisi',
    details: 'Fiche',
    someRoutesCouldNot: 'Certains parcours n’ont pas pu être chargés. Ferme puis rouvre cette fenêtre pour réessayer.',
    exploreTheMap: 'Explorer la carte',
    freeCameraNoRiding: 'Caméra libre, sans rouler · Échap pour revenir',
    routes: 'Parcours',
    oneClickSelectsThe: 'Un clic choisit le parcours ; sa fiche montre les montées et les records.',
    normal: 'Sens normal',
    reversed2: 'Sens inverse',
    selectWithoutRiding: 'Choisir sans partir',
    noTimedClimbIn: 'Pas de montée chronométrée dans cette zone.',
    seeAllClimbs: 'Voir toutes les montées',
    noRecordYet: 'pas encore de record',
    changeClimb: 'Changer de montée',
    best: 'Record',
    allAreas: 'Toutes les zones',
    colClimb: 'Montée',
    colLength: 'Longueur',
    colGrade: 'Pente moy.',
    colBest: 'Mon record',
    myBest: 'mon record',
    bestOn: 'Record du',
    notRiddenYet: 'À découvrir',
    challenge: 'Défier',
    noTimedClimbKnown: 'Aucune montée chronométrée connue pour le moment.',
    komChallenge: 'Défi KOM',
    flyingStartGhostOf: 'Départ lancé, fantôme de ton meilleur temps et écart en direct.',
    searchAClimbA: 'Chercher une montée, un parcours ou une zone…',
    searchAClimb: 'Chercher une montée',
    filterByArea: 'Filtrer par zone',
    aZoneSClimbs: 'Les montées d’une zone apparaissent après sa première visite.',
    noTimedClimbIn2: 'Pas de montée chronométrée dans cette zone : choisis-en une autre.',
    best2: 'record',
    openWorld: 'monde ouvert',
    retry: 'Réessayer',
    downloaded: 'Téléchargée',
    update: 'Mettre à jour',
    downloading: 'Téléchargement',
    updateAvailable: 'Mise à jour disponible',
    toDownload: 'À télécharger',
    loadedWhileRiding: 'Chargée pendant la sortie',
    comingSoon: 'Bientôt',
    currentArea: 'Zone en cours',
    whereDoYouWant: 'Où veux-tu rouler ?',
    loading: 'Chargement de',
    pickAnAreaOn: 'Choisis une zone sur la carte, ou cherche une ville pour voir la zone qui la couvre.',
    onlyInOpenAreas: 'Seulement dans les zones ouvertes (toutes les routes roulables).',
    notInARace: 'Pas en course : le parcours est fixe (tu peux le dessiner).',
    allOfParis: 'Tout Paris',
    allOfParisLoaded: 'Paris entier chargé',
    loadAllOfParis: 'Charger tout Paris',
    neighbouringAreas: 'Zones voisines',
    loading2: 'Chargement…',
    addThemToRide: 'Ajoute-les pour rouler ou dessiner d’une zone à l’autre (parcours libre et à dessiner).',
    youPickYourRoad: 'Tu choisis ta route à chaque carrefour.',
    drawARoute: 'Parcours à dessiner',
    startWaypointsAndFinish: 'Départ, points de passage et arrivée sur la carte.',
    pickTheClimbTo: 'Choisis la côte à battre',
    mapOfFrance: 'Carte de France',
    offlineMaps: 'Cartes hors ligne',
    zoneCatalogueUnavailableOffline: 'Catalogue des zones indisponible (hors ligne ?).',
    queued: 'En attente',
    downloadFailed: 'Échec du téléchargement',
    remove: 'Supprimer',
    notDownloaded: 'Non téléchargée',
    download: 'Télécharger',
    currentArea2: 'zone affichée',
    spaceUsed: 'Espace utilisé',
    noAreaDownloaded: 'Aucune zone téléchargée',
    downloadAll: 'Tout télécharger',
    mapsAreKeptIn: 'Les cartes sont dans le dossier des données ci-dessous.',
    mapsAreStoredOn: 'Les cartes sont stockées sur cet appareil.',
    aDownloadedAreaLoads: 'Une zone téléchargée se charge tout de suite et fonctionne sans connexion ; sinon elle se charge pendant la sortie.',
    searchAnArea: 'Chercher une zone…',
    noAreaWithThat: 'Aucune zone à ce nom.',
    removeAll: 'Tout supprimer',
    removeEveryDownloadedArea: 'Supprimer toutes les zones téléchargées de cet appareil ?',
    side: 'Profil',
    front: 'Face',
    back: 'Dos',
    bike: 'Vélo',
    dragToRotate: 'Glisser pour tourner',
    backToProgress: 'Retour à la progression',
    bodyMeasurementsAndFtp: 'Mensurations et FTP',
    jersey: 'Maillot',
    jerseyStripe: 'Bande du maillot',
    helmet: 'Casque',
    unbrandedBike: 'Vélo sans marque',
    skin: 'Peau',
    hair: 'Cheveux',
    socks: 'Chaussettes',
    kitPresets: 'Tenues préréglées',
    gearUnlocksAsYou: 'Les équipements se débloquent en roulant. Clique un équipement verrouillé pour l’essayer.',
    workshopCredits: 'Crédits de l’atelier',
    collapseTheMenu: 'Réduire le menu',
    collapseTheMenuFor: 'Réduire le menu pour voir plus large',
    closeEsc: 'Fermer (Échap)',
    outfit: 'Tenue',
    shorts: 'Cuissard',
    gloves: 'Gants',
    shoes: 'Chaussures',
    pickMyBike: 'Choisir mon vélo',
    partsWorkshop: 'Atelier de pièces',
    homeTrainer: 'Home trainer',
    character: 'Personnage',
    face: 'Visage',
    beard: 'Barbe',
    colours: 'Couleurs',
    default: 'Par défaut',
    randomCharacterFaceSkin: 'Personnage au hasard (visage, peau, cheveux, barbe)',
    randomCharacter: 'Personnage au hasard',
    garageSections: 'Rubriques du garage',
    preview: 'Aperçu',
    lvl: 'niv.',
    equipped: 'Équipé',
    unlocked: 'Débloqué',
    clickToTryIt: 'Cliquer pour l’essayer',
    short: 'Courts',
    long: 'Longs',
    shoeLogo: 'Marquage des chaussures',
    none2: 'Aucun',
    shoeAccent: 'Accent des chaussures',
    gloveColour: 'Couleur des gants',
    none3: 'Sans',
    mitts: 'Mitaines',
    full: 'Complets',
    sockHeight: 'Hauteur des chaussettes',
    low: 'Basses',
    high: 'Hautes',
    sleeves: 'Manches',
    short2: 'Courtes',
    long2: 'Longues',
    riding: 'En selle',
    drag: 'traînée',
    gravelTyres: 'pneus gravel',
    mtbTyres: 'pneus VTT',
    roadTyres: 'pneus route',
    all: 'Tous',
    timeTrial: 'Chrono',
    cap: 'Casquette',
    kind: 'Genre',
    stripe: 'Bande',
    accent: 'Accent',
    length: 'Longueur',
    longShortsSuitCooler: 'Le cuissard long est utile par temps frais.',
    type: 'Type',
    hoverAChipFor: 'Survole une pastille pour lire son nom et son effet ; clique pour l’essayer ou l’équiper.',
    filter: 'Filtrer',
    all2: 'Tout',
    unlocked2: 'Débloqués',
    locked: 'Verrouillés',
    available: 'Disponibles',
    unlockByRiding: 'À débloquer en roulant',
    bottles: 'Bidons',
    thisFrameCarriesNo: 'Ce cadre ne porte pas de bidon.',
    bottleColour: 'Couleur des bidons',
    black: 'Noir',
    white: 'Blanc',
    pickItsColourIn: 'Couleur au choix dans l’onglet Couleurs',
    yourColourColoursTab: 'Couleur au choix (onglet Couleurs)',
    yourBike: 'Ton vélo',
    pickItsColourIn2: 'Sa couleur se choisit dans l’onglet Couleurs. Les vélos des équipes se débloquent en roulant.',
    backToMyBike: '← Revenir à mon vélo',
    history: 'Historique',
    kmRidden: 'km roulés',
    kilometresRiddenInThe: 'Kilomètres roulés dans le jeu, toutes sorties confondues',
    iAm: 'Je suis',
    aMan: 'Un homme',
    aWoman: 'Une femme',
    nationality: 'Nationalité',
    yourFlagNextTo: 'Ton drapeau à côté de ton nom.',
    countsOnTheClimbs: 'Compte dans les montées.',
    countsForYourDrag: 'Compte dans la prise au vent.',
    setsWorkoutsAndZones: 'Règle les séances et les zones.',
    previous: 'Précédent',
    playPauseB: 'Lecture / pause (B)',
    nextN: 'Suivant (N)',
    myPlaylists: 'Mes playlists',
    switchToTheGame: 'Passer à la musique du jeu (arrête Spotify)',
    playSpotifyInThe: 'Faire jouer Spotify par le jeu',
    playHere: 'Écouter ici',
    reconnectOnceToAllow: 'Une reconnexion autorise la lecture dans le jeu',
    playHere2: 'Jouer ici',
    musicOff: 'Musique coupée',
    musicOnOffB: 'Musique marche / arrêt (B)',
    nextTrackN: 'Morceau suivant (N)',
    switchToSpotify: 'Passer à Spotify',
    connectYourSpotifyAccount: 'Connecter ton compte Spotify',
    gameMusic: 'Musique du jeu',
    yieldsToSpotify: 'laisse la place à Spotify',
    on2: 'activée',
    off3: 'coupée',
    sourceGameMusic: 'Source : musique du jeu',
    sourceSpotify: 'Source : Spotify',
    disconnectSpotify: 'Déconnecter Spotify',
    connectSpotify: 'Connecter Spotify',
    noPlaylists: 'Aucune playlist.',
    clickPlayHereReconnect: 'Clique « Jouer ici » (reconnexion) pour voir tes playlists.',
    oneTimeOnlySpotify: 'Une seule fois : Spotify demande que le jeu soit déclaré comme « application » sur ton compte développeur (gratuit, 2 minutes).',
    open: 'Ouvre',
    andClickCreateApp: 'et clique « Create app ».',
    nameAllezRobertApi: 'Nom : « Allez Robert » ; API : coche « Web API ».',
    redirectUriCopyExactly: 'Redirect URI, à copier exactement (avec le « / » final) :',
    copy: 'Copier',
    saveThenPasteThe: 'Enregistre, puis colle ici le « Client ID » :',
    spotifyRejectsLocalhostOn: 'Spotify refuse « localhost » : à la connexion, le jeu passe tout seul à l’adresse 127.0.0.1 (garde-la ensuite).',
    musicPlaysFromYour: 'La musique sort de ton appli Spotify (ordinateur ou téléphone) ; lecture / pause et morceau suivant demandent un compte Premium.',
    cancel: 'Annuler',
    signInToSpotify: 'Se connecter à Spotify',
    controlledResistanceFtmsFe: 'Résistance pilotée (FTMS, FE-C)',
    pedalsOrCrankAssioma: 'Pédales ou manivelle (Assioma…)',
    cadenceSensorWahooRpm: 'Capteur de cadence (Wahoo RPM…)',
    strapOrWatchTrackr: 'Ceinture ou montre (TRACKR, TICKR…)',
    controllersClickAxsD: 'Manettes (Click, AXS, D-Fly)',
    smartFan: 'Ventilateur connecté',
    viaTheTrainer: 'via le home trainer',
    viaThePedals: 'via les pédales',
    testRoadFeel: 'Tester le ressenti route',
    reconnect: 'reconnecter',
    forget: 'oublier',
    pairedPedalsBecomeThe: 'Des pédales associées deviennent la puissance de référence.',
    aPairedCadenceSensor: 'Un capteur de cadence associé passe avant le home trainer.',
    change: 'Changer',
    pair: 'Associer',
    bluetoothAdapter: 'Adaptateur Bluetooth',
    thisAreaIsNot: 'Cette zone n’est pas encore publiée sur ce serveur.',
    theDownloadWasInterrupted: 'Le téléchargement s’est interrompu. Vérifie ta connexion, puis réessaie.',
    areaUnavailable: 'Zone indisponible',
    downloading2: 'Téléchargement de',
    analysingOnYourDevice: 'Analyse sur ton appareil…',
    cancelledPhotoDiscarded: 'Annulé ; photo oubliée.',
    faceSkinAndHair: 'Visage, teint et cheveux appliqués ; photo oubliée.',
    noFaceFoundSkin: 'Aucun visage trouvé : teint et cheveux seulement.',
    analysisFailedOnThis: 'Analyse impossible sur cet appareil.',
    gearPositionUnavailableVia: 'Rapport indisponible via D-Fly',
    waitingForGearPosition: 'En attente du rapport engagé',
    rpm: 'tr/min',
    simulatorNoHardware: 'Simulateur (sans matériel)',
    noSensor: 'Aucun capteur',
    est: 'env.',
    height: 'Hauteur',
    otherColour: 'Autre couleur',
    spotifyNothingPlaying: 'Spotify : rien en lecture',
    inGame: '♪ Dans le jeu',
    cannotPlayInThe: 'Lecture impossible dans le jeu.',
    noClimbMatches: 'Aucune montée ne correspond.',
    allOfParis2: 'Paris entier',
    txt: ' : ',
  },
  {
    off: 'Off',
    selected: 'Selected',
    customSky: 'custom sky',
    startAt: 'Start at',
    todaySWeather: 'today’s weather',
    timeAndWeather: 'Time and weather',
    wxFold: 'Collapse time and weather',
    wxUnfold: 'Show time and weather details',
    real: 'Real',
    custom: 'Custom',
    conditions: 'Conditions',
    todayReal: 'Today (real)',
    custom2: 'Custom',
    realSkyRainFog: 'Real sky, rain, fog and wind around the start, at the chosen time (today’s <a href="https://open-meteo.com" target="_blank" rel="noopener" style="color:inherit">Open-Meteo</a> forecast). Offline: custom conditions.',
    sky: 'Sky',
    sunny: '☀ Sunny',
    cloudy: '☁ Cloudy',
    rain: '🌧 Rain',
    fog: '🌫 Fog',
    wind: 'Wind',
    calm: 'Calm',
    light: 'Light',
    moderate: 'Moderate',
    strong: 'Strong',
    weather: 'Weather',
    fixed: 'Fixed',
    changing: 'Changing',
    startTime: 'Start time',
    currentTime: 'Current time',
    custom3: 'Custom',
    progress: 'Progress',
    friends: 'Friends',
    loadingTheGarage: 'Loading the garage…',
    rideTogetherEachFrom: 'Ride together, each from home.',
    pairYourTrainerAnd: 'Pair your trainer and sensors. One app at a time per Bluetooth sensor.',
    myProfile: 'My profile',
    level: 'Level',
    creditsOpenTheGarage: 'Credits: open the garage workshop to spend them',
    signOut: 'Sign out',
    signIn: 'Sign in',
    quitAllezRobert: 'Quit Allez Robert!',
    quit: 'Quit',
    whatDoYouWant: 'What do you want to do?',
    freeRideToPick: 'Free ride: ← / → to pick your way at each junction, U to turn around.',
    joinARide: 'Join a ride',
    gotACodeFrom: 'Got a code from a friend? Enter it: you ride with their settings.',
    inviteCode: 'Invite code',
    orCreateYourRace: 'Or create your race',
    orCreateYourRide: 'Or create your ride',
    theseSettingsYourTime: 'These settings, your time and your weather apply to the whole group.',
    laps: 'Laps',
    theRaceEndsAfter: 'The race ends after this many laps.',
    aiRiders: 'AI riders',
    eachHasItsOwn: 'Each has its own tactic and form of the day.',
    aiLevel: 'AI level',
    theirPowerAsA: 'Their power, as a share of your FTP.',
    targetAverageSpeed: 'Target average speed',
    aiRidersPaceThemselves: 'AI riders pace themselves to hold it; the host can raise it on the road.',
    free: 'Free',
    bikes: 'Bikes',
    theSameBikeFor: 'The same bike for all, or each rider’s own with its workshop parts.',
    sameBikeForAll: 'Same bike for all',
    eachTheirOwn: 'Each their own',
    whereToRide: 'Where to ride?',
    chooseMyCountry: 'Choose my country',
    none: 'None',
    myWorkout: 'My workout',
    changeWorkout: 'Change workout',
    chooseYourWorkout: 'Choose your workout',
    close: 'Close',
    orImportAWorkout: 'Import a workout',
    workoutPickSub: 'Look at the profile, set the intensity, then choose.',
    t8MinFrom50: '8 min from 50 to 80 W',
    t1530Min: '15–30 min',
    t5MinAt100: '5 min at 100 W',
    t1020Min: '10–20 min',
    ramp: 'Ramp',
    gentleRamp: 'Gentle ramp',
    t20MinTest: '20-min test',
    protocol: 'Protocol',
    coachVoice: 'Coach voice',
    announcesTheStepsAnd: 'Announces the steps and the live FTP estimate.',
    on: 'On',
    off2: 'Off',
    howTheTestWorks: 'How the test works',
    freeRide: 'Free ride',
    drawnRoute: 'Drawn route',
    loop: ' · loop',
    changeRide: 'Change ride',
    chooseMyRide: 'Choose my ride',
    changeRoute: 'Change route',
    areaChoices: 'Area choices',
    loadingTheOthers: 'loading the others…',
    areaOrder: 'Area order',
    byDistance: 'By distance',
    byClimbing: 'By climbing',
    loop2: 'Loop',
    oneWay: 'One way',
    selected2: 'selected',
    reversed: ', reversed',
    movedStart: ', moved start',
    selectedRoute: 'Selected route',
    details: 'Details',
    someRoutesCouldNot: 'Some routes could not be loaded. Close and reopen this window to try again.',
    exploreTheMap: 'Explore the map',
    freeCameraNoRiding: 'Free camera, no riding · Esc to come back',
    routes: 'Routes',
    oneClickSelectsThe: 'One click selects the route; its details show climbs and records.',
    normal: 'Normal',
    reversed2: 'Reversed',
    selectWithoutRiding: 'Select without riding',
    noTimedClimbIn: 'No timed climb in this area.',
    seeAllClimbs: 'See all climbs',
    noRecordYet: 'no record yet',
    changeClimb: 'Change climb',
    best: 'Best',
    allAreas: 'All areas',
    colClimb: 'Climb',
    colLength: 'Length',
    colGrade: 'Avg grade',
    colBest: 'My best',
    myBest: 'my best',
    bestOn: 'Best on',
    notRiddenYet: 'Not ridden yet',
    challenge: 'Challenge',
    noTimedClimbKnown: 'No timed climb known yet.',
    komChallenge: 'KOM challenge',
    flyingStartGhostOf: 'Flying start, ghost of your best time and live gap.',
    searchAClimbA: 'Search a climb, a route or an area…',
    searchAClimb: 'Search a climb',
    filterByArea: 'Filter by area',
    aZoneSClimbs: 'A zone’s climbs appear after you first visit it.',
    noTimedClimbIn2: 'No timed climb in this area: pick another one.',
    best2: 'best',
    openWorld: 'open world',
    retry: 'Retry',
    downloaded: 'Downloaded',
    update: 'Update',
    downloading: 'Downloading',
    updateAvailable: 'Update available',
    toDownload: 'To download',
    loadedWhileRiding: 'Loaded while riding',
    comingSoon: 'Coming soon',
    currentArea: 'Current area',
    whereDoYouWant: 'Where do you want to ride?',
    loading: 'Loading',
    pickAnAreaOn: 'Pick an area on the map, or search a town to see which area covers it.',
    onlyInOpenAreas: 'Only in open areas (every road rideable).',
    notInARace: 'Not in a race: the course is fixed (you can draw it).',
    allOfParis: 'All of Paris',
    allOfParisLoaded: 'All of Paris loaded',
    loadAllOfParis: 'Load all of Paris',
    neighbouringAreas: 'Neighbouring areas',
    loading2: 'Loading…',
    addThemToRide: 'Add them to ride or draw from one area to the next (free ride and drawn routes).',
    youPickYourRoad: 'You pick your road at each junction.',
    drawARoute: 'Draw a route',
    startWaypointsAndFinish: 'Start, waypoints and finish on the map.',
    pickTheClimbTo: 'Pick the climb to beat',
    mapOfFrance: 'Map of France',
    offlineMaps: 'Offline maps',
    zoneCatalogueUnavailableOffline: 'Zone catalogue unavailable (offline?).',
    queued: 'Queued',
    downloadFailed: 'Download failed',
    remove: 'Remove',
    notDownloaded: 'Not downloaded',
    download: 'Download',
    currentArea2: 'current area',
    spaceUsed: 'Space used',
    noAreaDownloaded: 'No area downloaded',
    downloadAll: 'Download all',
    mapsAreKeptIn: 'Maps are kept in the data folder below.',
    mapsAreStoredOn: 'Maps are stored on this device.',
    aDownloadedAreaLoads: 'A downloaded area loads instantly and works offline; otherwise it streams in during the ride.',
    searchAnArea: 'Search an area…',
    noAreaWithThat: 'No area with that name.',
    removeAll: 'Remove all',
    removeEveryDownloadedArea: 'Remove every downloaded area from this device?',
    side: 'Side',
    front: 'Front',
    back: 'Back',
    bike: 'Bike',
    dragToRotate: 'Drag to rotate',
    backToProgress: 'Back to progress',
    bodyMeasurementsAndFtp: 'Body measurements and FTP',
    jersey: 'Jersey',
    jerseyStripe: 'Jersey stripe',
    helmet: 'Helmet',
    unbrandedBike: 'Unbranded bike',
    skin: 'Skin',
    hair: 'Hair',
    socks: 'Socks',
    kitPresets: 'Kit presets',
    gearUnlocksAsYou: 'Gear unlocks as you ride. Click locked gear to try it on.',
    workshopCredits: 'Workshop credits',
    collapseTheMenu: 'Collapse the menu',
    collapseTheMenuFor: 'Collapse the menu for a wider view',
    closeEsc: 'Close (Esc)',
    outfit: 'Outfit',
    shorts: 'Shorts',
    gloves: 'Gloves',
    shoes: 'Shoes',
    pickMyBike: 'Pick my bike',
    partsWorkshop: 'Parts workshop',
    homeTrainer: 'Home trainer',
    character: 'Character',
    face: 'Face',
    beard: 'Beard',
    colours: 'Colours',
    default: 'Default',
    randomCharacterFaceSkin: 'Random character (face, skin, hair, beard)',
    randomCharacter: 'Random character',
    garageSections: 'Garage sections',
    preview: 'Preview',
    lvl: 'lvl',
    equipped: 'Equipped',
    unlocked: 'Unlocked',
    clickToTryIt: 'Click to try it on',
    short: 'Short',
    long: 'Long',
    shoeLogo: 'Shoe logo',
    none2: 'None',
    shoeAccent: 'Shoe accent',
    gloveColour: 'Glove colour',
    none3: 'None',
    mitts: 'Mitts',
    full: 'Full',
    sockHeight: 'Sock height',
    low: 'Low',
    high: 'High',
    sleeves: 'Sleeves',
    short2: 'Short',
    long2: 'Long',
    riding: 'Riding',
    drag: 'drag',
    gravelTyres: 'gravel tyres',
    mtbTyres: 'MTB tyres',
    roadTyres: 'road tyres',
    all: 'All',
    timeTrial: 'Time trial',
    cap: 'Cap',
    kind: 'Kind',
    stripe: 'Stripe',
    accent: 'Accent',
    length: 'Length',
    longShortsSuitCooler: 'Long shorts suit cooler weather.',
    type: 'Type',
    hoverAChipFor: 'Hover a chip for its name and effect; click to try it on or equip it.',
    filter: 'Filter',
    all2: 'All',
    unlocked2: 'Unlocked',
    locked: 'Locked',
    available: 'Available',
    unlockByRiding: 'Unlock by riding',
    bottles: 'Bottles',
    thisFrameCarriesNo: 'This frame carries no bottle.',
    bottleColour: 'Bottle colour',
    black: 'Black',
    white: 'White',
    pickItsColourIn: 'Pick its colour in the Colours tab',
    yourColourColoursTab: 'Your colour (Colours tab)',
    yourBike: 'Your bike',
    pickItsColourIn2: 'Pick its colour in the Colours tab. Team bikes unlock as you ride.',
    backToMyBike: '← Back to my bike',
    history: 'History',
    kmRidden: 'km ridden',
    kilometresRiddenInThe: 'Kilometres ridden in the game, all rides',
    iAm: 'I am',
    aMan: 'A man',
    aWoman: 'A woman',
    nationality: 'Nationality',
    yourFlagNextTo: 'Your flag next to your name.',
    countsOnTheClimbs: 'Counts on the climbs.',
    countsForYourDrag: 'Counts for your drag.',
    setsWorkoutsAndZones: 'Sets workouts and zones.',
    previous: 'Previous',
    playPauseB: 'Play / pause (B)',
    nextN: 'Next (N)',
    myPlaylists: 'My playlists',
    switchToTheGame: 'Switch to the game music (stops Spotify)',
    playSpotifyInThe: 'Play Spotify in the game',
    playHere: 'Play here',
    reconnectOnceToAllow: 'Reconnect once to allow in-game playback',
    playHere2: 'Play here',
    musicOff: 'Music off',
    musicOnOffB: 'Music on / off (B)',
    nextTrackN: 'Next track (N)',
    switchToSpotify: 'Switch to Spotify',
    connectYourSpotifyAccount: 'Connect your Spotify account',
    gameMusic: 'Game music',
    yieldsToSpotify: 'yields to Spotify',
    on2: 'on',
    off3: 'off',
    sourceGameMusic: 'Source: game music',
    sourceSpotify: 'Source: Spotify',
    disconnectSpotify: 'Disconnect Spotify',
    connectSpotify: 'Connect Spotify',
    noPlaylists: 'No playlists.',
    clickPlayHereReconnect: 'Click “Play here” (reconnect) to see your playlists.',
    oneTimeOnlySpotify: 'One time only: Spotify needs the game declared as an “app” on your developer account (free, 2 minutes).',
    open: 'Open',
    andClickCreateApp: 'and click “Create app”.',
    nameAllezRobertApi: 'Name: “Allez Robert”; API: tick “Web API”.',
    redirectUriCopyExactly: 'Redirect URI, copy exactly (with the trailing “/”):',
    copy: 'Copy',
    saveThenPasteThe: 'Save, then paste the “Client ID” here:',
    spotifyRejectsLocalhostOn: 'Spotify rejects “localhost”: on sign-in the game switches to 127.0.0.1 by itself (keep using it afterwards).',
    musicPlaysFromYour: 'Music plays from your Spotify app (computer or phone); play / pause and next need Premium.',
    cancel: 'Cancel',
    signInToSpotify: 'Sign in to Spotify',
    controlledResistanceFtmsFe: 'Controlled resistance (FTMS, FE-C)',
    pedalsOrCrankAssioma: 'Pedals or crank (Assioma…)',
    cadenceSensorWahooRpm: 'Cadence sensor (Wahoo RPM…)',
    strapOrWatchTrackr: 'Strap or watch (TRACKR, TICKR…)',
    controllersClickAxsD: 'Controllers (Click, AXS, D-Fly)',
    smartFan: 'Smart fan',
    viaTheTrainer: 'via the trainer',
    viaThePedals: 'via the pedals',
    testRoadFeel: 'Test road feel',
    reconnect: 'reconnect',
    forget: 'forget',
    pairedPedalsBecomeThe: 'Paired pedals become the reference power.',
    aPairedCadenceSensor: 'A paired cadence sensor takes over from the trainer.',
    change: 'Change',
    pair: 'Pair',
    bluetoothAdapter: 'Bluetooth adapter',
    thisAreaIsNot: 'This area is not published on this server yet.',
    theDownloadWasInterrupted: 'The download was interrupted. Check your connection and try again.',
    areaUnavailable: 'Area unavailable',
    downloading2: 'Downloading',
    analysingOnYourDevice: 'Analysing on your device…',
    cancelledPhotoDiscarded: 'Cancelled; photo discarded.',
    faceSkinAndHair: 'Face, skin and hair applied; photo discarded.',
    noFaceFoundSkin: 'No face found: skin and hair only.',
    analysisFailedOnThis: 'Analysis failed on this device.',
    gearPositionUnavailableVia: 'Gear position unavailable via D-Fly',
    waitingForGearPosition: 'Waiting for gear position',
    rpm: 'rpm',
    simulatorNoHardware: 'Simulator (no hardware)',
    noSensor: 'No sensor',
    est: 'est.',
    height: 'Height',
    otherColour: 'Other colour',
    spotifyNothingPlaying: 'Spotify: nothing playing',
    inGame: '♪ In game',
    cannotPlayInThe: 'Cannot play in the game.',
    noClimbMatches: 'No climb matches.',
    allOfParis2: 'All of Paris',
    txt: ': ',
  },
);

/** Textes de l'onglet Réglages. */
const SET = strings(
  {
    ghost: 'Fantôme',
    ghostHelp: 'Ton meilleur tour (ou celui d’un ami) roule à côté de toi. Touche G en sortie.',
    shownOn: 'Affiché',
    shownOff: 'Masqué',
    soloAi: 'Équipiers IA en sortie libre',
    soloAiHelp: 'Coureurs IA qui roulent avec toi. Chacun coûte des images par seconde : 0 pour rouler seul.',
    advanced: 'Avancé',
    sub: 'Chaque choix s’applique tout de suite, sauf mention contraire.',
    qualityHelp: 'Plus haut : plus beau, plus exigeant pour la carte graphique.',
    style: 'Style graphique',
    styleGame: 'Jeu vidéo',
    styleReal: 'Réaliste',
    fpsCap: 'Images par seconde max.',
    fpsHelp: 'Moins d’images : carte graphique plus calme et plus froide. Pris en compte à la prochaine sortie.',
    fpsScreen: 'Écran',
    aspect: 'Format de l’image',
    aspectHelp: 'Bandes noires sur un écran plus large que le format choisi.',
    aspectFull: 'Plein écran',
    maxRes: 'Résolution max.',
    hudMine: 'Mes données',
    hudRoute: 'Parcours et environnement',
    hudOthers: 'Autres coureurs',
    hudMap: 'Carte et profil',
    layout: 'Disposition de l’interface',
    nextRide: 'Prend effet à la prochaine sortie.',
    shown: 'Éléments affichés en sortie',
    shownHelp: 'Décoche ce que ton matériel ne mesure pas ou ce que tu ne veux pas voir.',
    uiArea: 'Zone de l’interface',
    uiAreaHelp: 'Sur un écran très large, garde les compteurs au centre.',
    uiFull: 'Toute la largeur',
    startTime: 'Heure de départ',
    nowTime: 'Heure actuelle',
    customTime: 'Réglée',
    clouds: 'Nuages',
    rain: 'Pluie',
    rainHelp: 'La chaussée mouillée roule moins bien.',
    fog: 'Brouillard',
    evolve: 'Météo pendant la sortie',
    fixed: 'Fixe',
    changing: 'Qui évolue',
    diffHelp: 'Part de la pente que le home trainer te fait sentir.',
    drive: 'Transmission',
    driveHelp: 'Vitesses virtuelles : le jeu change de rapport, ta chaîne ne bouge pas.',
    virtual: 'Vitesses virtuelles',
    cassette: 'Cassette réelle',
    inertia: 'Inertie',
    inertiaHelp: '100 % : masse et roues réelles. Plus bas, la vitesse suit plus vite les relances.',
    smooth: 'Lissage de la puissance',
    smoothHelp: 'Affiche la moyenne sur 3 secondes.',
    off: 'Non',
    stand: 'Danseuse au-delà de',
    standHelp: 'Auto : le coureur se lève en sprint, en côte et en force.',
    music: 'Musique',
    gameSounds: 'Sons du jeu',
    gameSoundsHelp: 'Volume général, puis un curseur par famille de sons, voix comprises.',
    tutorial: 'Tutoriel',
    tutorialHelp: 'La présentation du premier lancement.',
    tutorialAgain: 'Revoir le tutoriel',
    myData: 'Mes données',
    exportData: 'Télécharger mes données',
    exportHelp: 'Un fichier avec tout ce que le serveur garde de ton compte.',
    exportGo: 'Télécharger',
    deleteAccount: 'Supprimer mon compte',
    deleteHelp: 'Efface le compte et tout ce qui lui est lié, pour de bon.',
    deleteOpen: 'Supprimer…',
    deleteWhat: 'Le compte, ses sorties, ses fichiers FIT, ses amis et les liaisons Strava / intervals.icu seront effacés pour de bon.',
    deleteType: 'Tape SUPPRIMER pour confirmer.',
    deleteForGood: 'Effacer définitivement',
    deleteFailed: 'Échec de la suppression',
    stravaHelp: 'Envoi de tes sorties à la fin de chacune.',
    stravaSkip: 'Ne pas envoyer',
    stravaSend: 'Envoyer',
    catImage: 'Image',
    catInterface: 'Interface',
    catRide: 'Sortie',
    catTrainer: 'Home trainer',
    trainerSettings: 'Réglages du home trainer',
    catSound: 'Son et musique',
    catCompanion: 'Compagnon',
    catZones: 'Zones hors ligne',
    catGeneral: 'Général',
    renderNow: 'Rendu actuel',
  },
  {
    ghost: 'Ghost',
    ghostHelp: 'Your best lap (or a friend’s) rides next to you. G key while riding.',
    shownOn: 'Shown',
    shownOff: 'Hidden',
    soloAi: 'AI teammates on free rides',
    soloAiHelp: 'AI riders who ride with you. Each one costs frames per second: 0 to ride alone.',
    advanced: 'Advanced',
    sub: 'Every choice applies right away unless stated otherwise.',
    qualityHelp: 'Higher: prettier, harder on the graphics card.',
    style: 'Graphic style',
    styleGame: 'Video game',
    styleReal: 'Realistic',
    fpsCap: 'Max frames per second',
    fpsHelp: 'Fewer frames: a quieter, cooler graphics card. Applies from the next ride.',
    fpsScreen: 'Screen',
    aspect: 'Picture format',
    aspectHelp: 'Black bars on a screen wider than the chosen format.',
    aspectFull: 'Full',
    maxRes: 'Max resolution',
    hudMine: 'My data',
    hudRoute: 'Route and conditions',
    hudOthers: 'Other riders',
    hudMap: 'Map and profile',
    layout: 'Interface layout',
    nextRide: 'Applies from the next ride.',
    shown: 'Shown during the ride',
    shownHelp: 'Untick what your hardware does not measure or what you do not want to see.',
    uiArea: 'Interface area',
    uiAreaHelp: 'On a very wide screen, keeps the gauges in the centre.',
    uiFull: 'Full width',
    startTime: 'Start time',
    nowTime: 'Current time',
    customTime: 'Custom',
    clouds: 'Clouds',
    rain: 'Rain',
    rainHelp: 'A wet road rolls slower.',
    fog: 'Fog',
    evolve: 'Weather during the ride',
    fixed: 'Fixed',
    changing: 'Changing',
    diffHelp: 'Share of the gradient the trainer makes you feel.',
    drive: 'Drivetrain',
    driveHelp: 'Virtual shifting: the game changes gear, your chain stays put.',
    virtual: 'Virtual shifting',
    cassette: 'Real cassette',
    inertia: 'Inertia',
    inertiaHelp: '100%: real mass and wheels. Lower: speed follows accelerations faster.',
    smooth: 'Power smoothing',
    smoothHelp: 'Shows the 3-second average.',
    off: 'Off',
    stand: 'Stand up above',
    standHelp: 'Auto: the rider stands in sprints, climbs and low-cadence efforts.',
    music: 'Music',
    gameSounds: 'Game sounds',
    gameSoundsHelp: 'Master volume, then one slider per sound family, voices included.',
    tutorial: 'Tutorial',
    tutorialHelp: 'The first-launch walkthrough.',
    tutorialAgain: 'Watch the tutorial again',
    myData: 'My data',
    exportData: 'Download my data',
    exportHelp: 'A file with everything the server keeps about your account.',
    exportGo: 'Download',
    deleteAccount: 'Delete my account',
    deleteHelp: 'Erases the account and everything linked to it, for good.',
    deleteOpen: 'Delete…',
    deleteWhat: 'Your account, rides, FIT files, friends and Strava / intervals.icu links will be erased for good.',
    deleteType: 'Type SUPPRIMER to confirm.',
    deleteForGood: 'Erase for good',
    deleteFailed: 'Deletion failed',
    stravaHelp: 'Uploads your rides when each one ends.',
    stravaSkip: 'Don’t upload',
    stravaSend: 'Upload',
    catImage: 'Picture',
    catInterface: 'Interface',
    catRide: 'Ride',
    catTrainer: 'Smart trainer',
    trainerSettings: 'Smart trainer settings',
    catSound: 'Sound and music',
    catCompanion: 'Companion',
    catZones: 'Offline areas',
    catGeneral: 'General',
    renderNow: 'Current render',
  },
);

/** Gabarits, pluriels et confirmations du menu ({n}, {w}, {what}, {name} remplacés à l'appel). */
const MX = strings(
  {
    credits: 'crédits',
    locale: 'fr-FR',
    dec: ',',
    favAdd: 'Ajouter aux favoris',
    favRemove: 'Retirer des favoris',
    ftpNow: 'FTP actuelle : {w} W. Bien reposé, ventilateur allumé, bidon à portée de main.',
    route1: '{n} parcours',
    routeN: '{n} parcours',
    climb1: '{n} montée',
    climbN: '{n} montées',
    record1: '{n} record',
    recordN: '{n} records',
    climbFound1: '{n} montée trouvée',
    climbFoundN: '{n} montées trouvées',
    zoneRoutes1: '{n} parcours déjà tracé dans la zone.',
    zoneRoutesN: '{n} parcours déjà tracés dans la zone.',
    area1: '{n} zone',
    areaN: '{n} zones',
    stopQueued: 'Arrêter ({n} en attente)',
    confirmDownload: 'Télécharger {what} ? Elles arrivent une par une ; tu peux continuer à utiliser le jeu.',
    confirmRemove: 'Supprimer la zone « {name} » de cet appareil ? Tu pourras la télécharger de nouveau.',
    levelsToGo: 'dans {n} niv.',
    previewUnlocks: 'Aperçu · se débloque au niveau {n}',
    garageTitle: 'Garage',
    garageSub: 'Ta tenue, ton vélo et ton home trainer.',
    menu: 'Menu',
    spSteps: 'Déclarer le jeu chez Spotify',
    spClientId: 'Identifiant client (Client ID)',
  },
  {
    credits: 'credits',
    locale: 'en-GB',
    dec: '.',
    favAdd: 'Add to favourites',
    favRemove: 'Remove from favourites',
    ftpNow: 'Current FTP: {w} W. Be rested, fan on, bottle within reach.',
    route1: '{n} route',
    routeN: '{n} routes',
    climb1: '{n} climb',
    climbN: '{n} climbs',
    record1: '{n} record',
    recordN: '{n} records',
    climbFound1: '{n} climb found',
    climbFoundN: '{n} climbs found',
    zoneRoutes1: '{n} ready-made route in the area.',
    zoneRoutesN: '{n} ready-made routes in the area.',
    area1: '{n} area',
    areaN: '{n} areas',
    stopQueued: 'Stop ({n} queued)',
    confirmDownload: 'Download {what}? They arrive one at a time; you can keep using the game.',
    confirmRemove: 'Remove “{name}” from this device? You can download it again.',
    levelsToGo: '{n} to go',
    previewUnlocks: 'Preview · unlocks at level {n}',
    garageTitle: 'Garage',
    garageSub: 'Your kit, your bike and your smart trainer.',
    menu: 'Menu',
    spSteps: 'Declare the game on Spotify',
    spClientId: 'Client ID',
  },
);
/** Nombre + nom accordé : `count(n, 'route1', 'routeN')`. */
const count = (n: number, one: Parameters<typeof MX>[0], many: Parameters<typeof MX>[0]): string => MX(n > 1 ? many : one).replace('{n}', String(n));
/** Nombre décimal à la virgule ou au point selon la langue. */
const dec = (v: number, d = 1): string => v.toFixed(d).replace('.', MX('dec'));
import './blocks.css';
import './menu.css';

/** Ce que l'écran d'appairage sait faire, quel que soit le transport (implémenté avec @allezrobert/devices). */
export interface DevicePanel {
  /** Appareils connus avec leur état lisible. */
  list(): Array<{ id: string; name: string; role: string; roleIds?: string[]; kinds?: string[]; simulated?: boolean; state: string; detail?: string; ok: boolean; canReconnect?: boolean }>;
  /** Transports disponibles sur cette plateforme. */
  transports(): Array<{ id: string; label: string }>;
  /** Lance l'appairage d'un rôle (Web Bluetooth ouvre le sélecteur du navigateur). */
  pair(role: 'trainer' | 'power' | 'heartRate' | 'cadence' | 'shifter' | 'fan', transport: string): Promise<void>;
  forget(id: string): void;
  /** Relance tout de suite la connexion d'un appareil appairé (salle d'attente, onglet Capteurs). */
  reconnect?(id: string): void;
  useSimulator(on: boolean): void;
  simulatorOn(): boolean;
  warnings(): string[];
  /** Commandes Di2 activées (adaptateur D-Fly) ou appairées. */
  di2Active?(): boolean;
  /** Adaptateurs Bluetooth (app Windows) : intégré ou dongle. */
  adapters?(): Promise<Array<{ id: string; name: string; isDefault: boolean }>>;
  selectAdapter?(id: string): Promise<void>;
  onChange(cb: () => void): void;
  /** Réglages avancés du matériel (calibration, ventilateur, adaptateurs, journal) : ui/hardware-panel.ts. */
  renderExtras?(el: HTMLElement): void;
  /** Le home trainer assigné reproduit-il le revêtement (Tacx NEO) ? Bouton d'essai sur sa tuile. */
  roadFeelSupported?(): boolean;
  /** Puissance et cadence mesurées en ce moment, et l'appareil qui les fournit (pédales, home trainer, capteur). */
  live?(): DeviceLive;
}

export interface MenuCallbacks {
  /** `inviteFriends` : amis (identifiants de relation) à inviter une fois la sortie créée. */
  onStart(settings: Settings, extras: { workoutFile?: { name: string; content: string }; inviteCode?: string; inviteFriends?: string[]; customRoute?: RouteData; openStart?: { x: number; z: number }; publicRoom?: boolean; nearFriend?: string }): void;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

type Tab = 'home' | 'ride' | 'friends' | 'garage' | 'progress' | 'devices' | 'profile' | 'settings';
type Role = Parameters<DevicePanel['pair']>[0];

const fr = () => getLang() === 'fr';

/** Ressenti route : valeur affichée à côté du curseur. */
function roadFeelValue(percent: number, L: boolean): string {
  return percent > 0 ? `${percent} %` : S('off');
}

/** Ressenti route : message sous le curseur, en alerte à partir du seuil « fort » (id m-roadfeelmsg). */
function roadFeelMessage(percent: number, L: boolean): string {
  const T = ROAD_FEEL_TEXT[getLang()];
  const level = roadFeelLevel(percent);
  const cls = level === 'extreme' ? 'warning mm-roadfeel-extreme' : level === 'strong' ? 'warning' : 'mm-hint';
  return `<p id="m-roadfeelmsg" class="${cls}">${esc(T[level])} ${esc(T.unsupported)}</p>`;
}

/** Pictogrammes (traits, couleur héritée). */
const svg = (d: string, size = 22) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
/**
 * Dessins des trois choix d'une zone : un tracé prêt (départ, lacets, drapeau d'arrivée), un panneau à deux
 * directions pour le parcours libre, un crayon pour le parcours à dessiner.
 */
const ZONE_ICONS = {
  routes: svg('<circle cx="5.5" cy="18.5" r="2"/><path d="M7.5 18.5H13a3 3 0 0 0 0-6h-2.5a3 3 0 0 1 0-6H15"/><path d="M17 3.5v6"/><path d="M17 4l4 1.5L17 7"/>'),
  free: svg('<path d="M12 3v18"/><path d="M12 5h6l2.2 2.2L18 9.5h-6z"/><path d="M12 12H6l-2.2 2.2L6 16.5h6z"/>'),
  draw: svg('<path d="M14.5 4.5l5 5L9 20H4v-5z"/><path d="M12.5 6.5l5 5"/><path d="M14 20h1.5M18 20h1.5"/>'),
};
/** Couleur et accroche de chaque mode (cartes « Que veux-tu faire ? »). */
const MODE_COLORS: Partial<Record<Settings['mode'], string>> = {
  free: '#ffd23f',
  group: '#4ade80',
  race: '#f87171',
  workout: '#60a5fa',
  ftpTest: '#c084fc',
  challenge: '#fb923c',
};
const MODE_TAGS: Record<'fr' | 'en', Partial<Record<Settings['mode'], string>>> = {
  fr: { free: 'En solo', group: 'Avec tes amis', race: 'Classement', workout: 'Séances ERG', ftpTest: 'Rampe ou 20 min', challenge: 'Records en côte' },
  en: { free: 'On your own', group: 'With friends', race: 'Results', workout: 'ERG sessions', ftpTest: 'Ramp or 20 min', challenge: 'Climb records' },
};

/** Ce que fait chaque mode, en une ligne, dans son bloc de l'onglet Rouler. */
const MODE_LINES: Record<'fr' | 'en', Partial<Record<Settings['mode'], string>>> = {
  fr: {
    free: 'Seul, à ton rythme',
    group: 'À plusieurs, le groupe reste ensemble',
    race: 'Départ groupé, classement à l’arrivée',
    workout: 'Séance guidée en mode ERG',
    ftpTest: 'Estime ta FTP en 20 à 30 min',
    challenge: 'Bats ton record sur une montée',
  },
  en: {
    free: 'Solo, at your own pace',
    group: 'Together, the group stays as one',
    race: 'Mass start, results at the finish',
    workout: 'Guided session in ERG mode',
    ftpTest: 'Estimate your FTP in 20 to 30 min',
    challenge: 'Beat your record on a climb',
  },
};

const ICON = {
  free: svg('<path d="M4 20 10 4M20 20 14 4M12 6v2M12 11v2M12 16v2"/>'),
  group: svg('<circle cx="8" cy="8" r="3"/><circle cx="16" cy="9" r="2.5"/><path d="M2.5 20c.6-3.4 2.8-5 5.5-5s4.9 1.6 5.5 5M13.5 15.2c.8-.5 1.6-.7 2.5-.7 2.4 0 4.3 1.4 4.8 4.5"/>'),
  race: svg('<path d="M5 21V4M5 4h12l-2 4 2 4H5"/>'),
  workout: svg('<path d="M4 20v-6M9 20V8M14 20v-9M19 20V5"/>'),
  ftpTest: svg('<path d="M4 16a8 8 0 1 1 16 0"/><path d="m12 16 4-6"/><circle cx="12" cy="16" r="1.2"/>'),
  open: svg('<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>'),
  challenge: svg('<path d="M3 20 10 8l4 6 3-4 4 10z"/><path d="M14 4h4v3h-4z"/>'),
  trainer: svg('<circle cx="7" cy="15" r="4"/><path d="M7 15h7l3-7h2M13 8l1 7M3 21h18"/>'),
  power: svg('<path d="M13 2 5 14h6l-1 8 8-12h-6z"/>'),
  heartRate: svg('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/><path d="M7 12h3l1-2 2 4 1-2h3"/>'),
  shifter: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 4v3M12 17v3M4 12h3M17 12h3"/>'),
  cadence: svg('<circle cx="12" cy="12" r="8"/><path d="M12 12 7.5 7.5M12 12h5"/><circle cx="12" cy="12" r="1.5"/>'),
  fan: svg('<circle cx="12" cy="12" r="1.5"/><path d="M12 10.5C11 6 13 3 16 4s1 5-2.5 7M13.5 12.5c4.4 1 6.5 3.5 5 6s-5 .5-6.5-3M10.5 12c-4.5.2-7.3-1.7-6.6-4.5s4.6-1.6 6.4 1.9"/>'),
  music: svg('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>', 16),
  musicOff: svg('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/><path d="M3 3l18 18"/>', 16),
  next: svg('<path d="m5 4 10 8-10 8zM19 5v14"/>', 14),
  prev: svg('<path d="M19 20 9 12l10-8zM5 19V5"/>', 14),
  play: svg('<path d="m7 4 13 8-13 8z"/>', 14),
  pause: svg('<path d="M7 4v16M17 4v16"/>', 14),
  list: svg('<path d="M4 6h12M4 12h12M4 18h8M18 15v6l4-3z"/>', 16),
  rotate: svg('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>', 16),
  pShorts: svg('<path d="M5 4h14l1.2 15H14l-2-8-2 8H3.8Z"/><path d="M5 8h14"/>', 26),
  pGloves: svg('<path d="M7 21v-8L5.5 9.5c-.5-1.2 1-2 1.8-1L9 11V4.5c0-1.3 2-1.3 2 0V10V3.5c0-1.3 2-1.3 2 0V10V4.5c0-1.3 2-1.3 2 0V11V6.5c0-1.3 2-1.3 2 0V15c0 3.5-2 6-5.5 6Z"/>', 26),
  pShoes: svg('<path d="M3 17v-5l5-1 3 3 8 1.5c1.8.3 2.2 3.5 0 3.5H4a1 1 0 0 1-1-1Z"/><path d="M8 11l1.5 2M12 14l1 2"/>', 26),
  pFace: svg('<circle cx="12" cy="12" r="8.5"/><circle cx="9" cy="10.5" r=".9"/><circle cx="15" cy="10.5" r=".9"/><path d="M8.5 15c1 1.2 2.2 1.8 3.5 1.8s2.5-.6 3.5-1.8"/>', 26),
  pSkin: svg('<path d="M12 3c4 5 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 2-6 6-11Z"/>', 26),
  pHair: svg('<path d="M5 14c0-6 3-9 7-9s7 3 7 9v1c-2-1-3-3-3-5-2 2-6 2-8 0 0 2-1 4-3 5Z"/>', 26),
  pBeard: svg('<path d="M6 8c0 6 2 10 6 10s6-4 6-10M9 14c1 1 5 1 6 0"/>', 26),
  pPalette: svg('<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 1.4-2-.7-1.2.1-2.6 1.6-2.6H17a4 4 0 0 0 4-4c0-5-4-9.4-9-9.4Z"/><circle cx="8" cy="11" r="1"/><circle cx="11" cy="7.5" r="1"/><circle cx="15.5" cy="8.5" r="1"/>', 26),
  dice: svg('<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.1"/><circle cx="15" cy="9" r="1.1"/><circle cx="12" cy="12" r="1.1"/><circle cx="9" cy="15" r="1.1"/><circle cx="15" cy="15" r="1.1"/>', 22),
  pLock: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', 12),
  pJersey: svg('<path d="M8 3 3 6l2 4 2-1v12h10V9l2 1 2-4-5-3c-.5 1.6-2 2.5-4 2.5S8.5 4.6 8 3Z"/>', 26),
  pHelmet: svg('<path d="M3 15a9 8 0 0 1 18 0v2H3Z"/><path d="M8 8.5 9.5 15M12 7v8M16 8.5 14.5 15"/><path d="M6 17v2.5M18 17v2.5"/>', 26),
  pGlasses: svg('<path d="M2.5 9.5h19"/><path d="M4 9.5c0 4.5 2 6 4.5 6S11 13 11 10M13 10c0 3 .8 5.5 3.5 5.5S20 14 20 9.5"/>', 26),
  pSocks: svg('<path d="M9 3h6v10l4.5 3c1.5 1 1 4-1.5 4H10c-2 0-2-1.5-2-3Z"/><path d="M9 7h6"/>', 26),
  gTenue: svg('<path d="M8 3 3 6l2 4 2-1v12h10V9l2 1 2-4-5-3c-.5 1.6-2 2.5-4 2.5S8.5 4.6 8 3Z"/>', 18),
  gBike: svg('<circle cx="6" cy="16" r="4"/><circle cx="18" cy="16" r="4"/><path d="M6 16l4-8h5l3 8M10 8 8 5H6M12 16l-2-8"/>', 18),
  gFace: svg('<circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r="1"/><circle cx="15" cy="10" r="1"/><path d="M8.5 15c1 1.2 2.2 1.8 3.5 1.8s2.5-.6 3.5-1.8"/>', 18),
  gWrench: svg('<path d="M14.5 6.5a4 4 0 0 0 5 5L21 13l-8 8a2.1 2.1 0 0 1-3-3l8-8Z"/><path d="M16 3.5 13 6.5 17.5 11l3-3"/>', 16),
  explore: svg('<circle cx="12" cy="12" r="9"/><path d="m15.8 8.2-2.3 5.3-5.3 2.3 2.3-5.3z"/>', 20),
};

/** Catégorie ouverte dans le garage. */
type GarageSlot = CosmeticSlot | 'colors' | 'face' | 'atelier' | 'shorts' | 'gloves' | 'shoes' | 'skin' | 'hair' | 'beard';
/** Types du personnage qui montrent la tête nue (visage, peau, cheveux, barbe). */
const isFaceSlot = (sl: GarageSlot): sl is 'face' | 'skin' | 'hair' | 'beard' => sl === 'face' || sl === 'skin' || sl === 'hair' || sl === 'beard';

/** Seuils des zones de puissance (× FTP) et leurs couleurs (Z1 à Z7). */
const ZONE_LIMITS = [0.55, 0.75, 0.9, 1.05, 1.2, 1.5];
const ZONE_COLORS = ['#c3cbd5', '#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#a855f7'];
const zoneColorOf = (ftp: number) => ZONE_COLORS[ZONE_LIMITS.findIndex((z) => ftp < z) === -1 ? 6 : ZONE_LIMITS.findIndex((z) => ftp < z)] as string;

/** Couleur d'un type de séance : la zone où se joue l'essentiel (mêmes teintes que le graphe). */
const TYPE_COLORS: Record<WorkoutType, string> = {
  recovery: ZONE_COLORS[0]!,
  endurance: ZONE_COLORS[1]!,
  tempo: ZONE_COLORS[2]!,
  sweetspot: '#a3c726',
  threshold: ZONE_COLORS[3]!,
  vo2max: ZONE_COLORS[4]!,
  anaerobic: ZONE_COLORS[5]!,
};

/** Durée lisible : « 45 min », « 1 h 05 ». */
const fmtWkDur = (s: number) => {
  const min = Math.round(s / 60);
  return min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : `${min} min`;
};

/**
 * Carte d'une séance : nom et durée, type (couleur de sa zone), TSS et IF estimés (puissance normalisée
 * calculée sur les paliers), description, puis profil des paliers (hauteur = % de FTP, couleur = zone,
 * ligne FTP repérée). L'échelle est la même pour toutes les cartes (0 à 160 % de FTP) : on compare d'un coup d'œil.
 */
function workoutCard(w: (typeof WORKOUT_LIBRARY)[number], on: boolean, opens?: string, fav?: boolean): string {
  const lang = getLang();
  const steps = w.build().steps;
  const total = steps.reduce((a, st) => a + st.durationS, 0) || 1;
  const H = 56;
  const W = 300;
  const PMAX = 1.6;
  const y = (p: number) => (H - (Math.min(p, PMAX) / PMAX) * (H - 2)).toFixed(1);
  // Effort « à fond » (sprint) : dessiné et compté à 150 % de FTP, faute de cible.
  const powerOf = (st: WorkoutStep, p: number) => (st.mode === 'max' ? 1.5 : p);
  let t = 0;
  let p4 = 0;
  // Paliers voisins de la même zone : une seule forme (pas de couture ton sur ton) ; 1 px d'écart
  // entre deux zones différentes, pour que chaque bloc se lise.
  const runs: Array<{ color: string; pts: Array<[number, number]> }> = [];
  for (const st of steps) {
    const x0 = (t / total) * W;
    const x1 = ((t + st.durationS) / total) * W;
    t += st.durationS;
    const a = powerOf(st, st.powerStart);
    const b = powerOf(st, st.powerEnd);
    const mid = (a + b) / 2;
    p4 += mid ** 4 * st.durationS;
    const color = zoneColorOf(mid);
    const last = runs.at(-1);
    if (last && last.color === color) last.pts.push([x0, a], [x1, b]);
    else runs.push({ color, pts: [[x0, a], [x1, b]] });
  }
  const GAP = 1;
  // Effort très court (sprint de 15 s sur 45 min) : 3 unités de large au moins, dessiné par-dessus ses voisins.
  const MIN_W = 3;
  const wide: string[] = [];
  const narrow: string[] = [];
  runs.forEach((r, i) => {
    const pts = r.pts.map(([x, p]) => [x, p] as [number, number]);
    if (i > 0) pts[0]![0] += GAP;
    if (i < runs.length - 1) pts[pts.length - 1]![0] -= GAP;
    const x0 = pts[0]![0];
    const x1 = pts[pts.length - 1]![0];
    const thin = x1 - x0 < MIN_W;
    if (thin) {
      const c = (x0 + x1) / 2;
      pts[0]![0] = c - MIN_W / 2;
      pts[pts.length - 1]![0] = c + MIN_W / 2;
    }
    const top = pts.map(([x, p]) => `${x.toFixed(1)},${y(p)}`).join(' ');
    (thin ? narrow : wide).push(`<polygon points="${pts[0]![0].toFixed(1)},${H} ${top} ${pts[pts.length - 1]![0].toFixed(1)},${H}" fill="${r.color}"/>`);
  });
  const shapes = wide.join('') + narrow.join('');
  const ifv = (p4 / total) ** 0.25;
  const tss = Math.round((total / 3600) * ifv * ifv * 100);
  const dur = fmtWkDur(total);
  const ftpPct = (((1 / PMAX) * (H - 2)) / H) * 100;
  const favHtml =
    fav === undefined
      ? ''
      : `<span class="mm-wk-fav${fav ? ' on' : ''}" data-fav="${w.id}" role="button" tabindex="0" aria-pressed="${fav}" title="${MX(fav ? 'favRemove' : 'favAdd')}">${fav ? '★' : '☆'}</span>`;
  return `<button class="mm-wk${on ? ' on' : ''}" ${opens ? `data-picker="${opens}"` : `data-preset="${w.id}"`} style="--wk:${TYPE_COLORS[w.type]}">
    <span class="mm-wk-head"><b>${esc(w.name[lang])}</b><em>${dur}</em>${favHtml}</span>
    <span class="mm-wk-meta"><span class="mm-wk-type">${WORKOUT_TYPE_LABELS[w.type][lang]}</span><span class="mm-wk-stat"><small>TSS</small>${tss}</span><span class="mm-wk-stat"><small>IF</small>${dec(ifv, 2)}</span>${on && !opens ? `<span class="mm-wk-chosen">✓ ${S('selected')}</span>` : ''}</span>
    <span class="mm-wk-desc">${esc(w.description[lang])}</span>
    <span class="mm-wk-graph" aria-hidden="true"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${shapes}</svg><i class="mm-wk-ftp" style="bottom:${ftpPct.toFixed(1)}%"><span>FTP</span></i></span>
  </button>`;
}

/** Séances favorites (stockage local ; l'appli de bureau le sauvegarde avec le profil). */
const FAV_KEY = 'ar.workoutFavorites';

/** Séance perso vue comme une séance de la bibliothèque (même carte). */
function storedAsLibrary(w: LocalWorkout): LibraryWorkout {
  const desc = w.description ?? (w.source === 'custom' ? 'Séance créée' : `Fichier .${w.source}`);
  return {
    id: `mine:${w.id}`,
    type: (WORKOUT_TYPES as readonly string[]).includes(w.type ?? '') ? (w.type as WorkoutType) : 'endurance',
    source: 'allezrobert',
    name: { fr: w.name, en: w.name },
    description: { fr: desc, en: desc },
    build: () => ({ name: w.name, steps: w.steps as WorkoutStep[] }),
  };
}

/** Empreinte courte d'un fichier (même fichier réimporté = même séance). */
function contentId(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** Ciels proposés au départ d'une sortie (nuages, pluie, brouillard de 0 à 1). */
const WEATHER_PRESETS: Array<[string, { clouds: number; rain: number; fog: number }]> = [
  ['sun', { clouds: 0.1, rain: 0, fog: 0 }],
  ['cloudy', { clouds: 0.65, rain: 0, fog: 0.05 }],
  ['rain', { clouds: 0.9, rain: 0.7, fog: 0.1 }],
  ['fog', { clouds: 0.5, rain: 0, fog: 0.7 }],
];
/** Forces de vent proposées (m/s) : calme, léger (≈ 11 km/h), moyen (≈ 22 km/h), fort (≈ 36 km/h). */
const WIND_STEPS = [0, 3, 6, 10];

/** Zoom du garage à la molette : limites de la distance de la caméra (1 = cadrage normal). */
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 1.6;

/** Gros plan du garage selon la catégorie choisie. */
const SLOT_VIEW: Record<CosmeticSlot, GarageView> = { jersey: '3q', helmet: 'front', bike: 'side', socks: 'shoes', glasses: 'front', trainer: 'trainer' };

/** Filtres de la liste des vélos du garage. */
type BikeFilter = BikeCollection | 'unlocked';
const BIKE_FILTERS: Array<[BikeFilter, string, string]> = [
  ['saison-2026', 'Saison 2026', '2026 season'],
  ['mythiques', 'Mythiques', 'Legends'],
  ['divers', 'Divers', 'Misc.'],
  ['unlocked', 'Débloqués', 'Unlocked'],
];
const BIKE_TYPE: Record<BikeType, [string, string]> = {
  aero: ['Aéro', 'Aero'],
  climbing: ['Grimpeur', 'Climbing'],
  tt: ['Chrono', 'Time trial'],
  classic: ['Classique', 'Classic'],
  track: ['Piste', 'Track'],
};

const BIKE_TYPE_ORDER: BikeType[] = ['aero', 'climbing', 'classic', 'tt', 'track'];

/** Équipe (saison 2026 : plusieurs équipes roulent le même modèle) ou collection d'un vélo. */
function bikeFrom(group: string, lang: 'fr' | 'en'): string | undefined {
  return BIKE_TEAMS.find((t) => t.id === group)?.name ?? BIKE_GROUPS.find((g) => g.id === group)?.name[lang];
}

/** Marque d'un vélo (nom affiché), pour classer la liste. */
function brandName(id: string): string {
  const brand = bikeById(id)?.brand;
  return BIKE_BRANDS.find((b) => b.id === brand)?.name ?? brand ?? (id === 'bike-vtt' ? 'VTT' : id === 'bike-gravel' ? 'Gravel' : '');
}

/**
 * Dessin de repli (photo manquante, voir bikeThumb.ts) : silhouette de vélo aux couleurs de la livrée (cadre : 1re couleur, haubans et fourche : 2e,
 * guidon : 3e), cernée de sombre pour rester lisible quelle que soit la couleur.
 */
function bikeIcon(colors: readonly string[], big = false): string {
  const main = colors[0] ?? '#7a8594';
  const acc = colors[1] ?? main;
  const third = colors[2] ?? acc;
  const tubes = (d: string, c: string) => `<path d="${d}" stroke="#141820" stroke-width="5.2"/><path d="${d}" stroke="${c}" stroke-width="3"/>`;
  return `<svg class="mm-bikeicon${big ? ' big' : ''}" viewBox="0 0 64 40" aria-hidden="true" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="14" cy="27" r="10" stroke="#20252e" stroke-width="2.6"/><circle cx="50" cy="27" r="10" stroke="#20252e" stroke-width="2.6"/>
    ${tubes('M14 27 25 10M14 27h16M44 11l6 16', acc)}${tubes('M30 27 25 10h19L30 27', main)}${tubes('M44 11l1.5-4h5', third)}
    <path d="M21 8.5h7" stroke="#141820" stroke-width="2.6"/></svg>`;
}

/** Vignette d'un maillot à motif (pois, manches, moitié, dégradé, chevrons), aux couleurs du shader de l'avatar. */
function patternSwatch(c: CosmeticItem): string | null {
  const base = c.color ?? '#ffffff';
  const acc = c.jersey?.accent ?? base;
  switch (c.jersey?.style) {
    case 'pois':
      return `radial-gradient(circle at 25% 25%, ${acc} 0 21%, transparent 23%) 0 0 / 17px 17px, radial-gradient(circle at 75% 75%, ${acc} 0 21%, transparent 23%) 0 0 / 17px 17px, ${base}`;
    case 'manches':
      return `linear-gradient(90deg, ${acc} 0 24%, ${base} 24% 76%, ${acc} 76% 100%)`;
    case 'moitie':
      return `linear-gradient(180deg, ${base} 0 50%, ${acc} 50% 100%)`;
    case 'degrade':
      return `linear-gradient(180deg, ${base} 10%, ${acc} 95%)`;
    case 'chevrons':
      return `linear-gradient(180deg, ${base} 0 32%, ${acc} 32% 50%, ${base} 50% 100%)`;
    default:
      return null;
  }
}

/** Vignette d'une casquette à motif (pois, losanges, quartiers) ; une casquette unie garde sa couleur. */
function capSwatch(cap: CapLook): string | null {
  const cols = cap.colors?.length ? cap.colors : [cap.color];
  switch (cap.style) {
    case 'pois': {
      const acc = cap.accent ?? '#e8501d';
      return `radial-gradient(circle at 25% 25%, ${acc} 0 21%, transparent 23%) 0 0 / 17px 17px, radial-gradient(circle at 75% 75%, ${acc} 0 21%, transparent 23%) 0 0 / 17px 17px, ${cap.color}`;
    }
    case 'losanges':
      return `linear-gradient(135deg, ${cols.map((x, i) => `${x} ${((i * 100) / cols.length).toFixed(0)}% ${(((i + 1) * 100) / cols.length).toFixed(0)}%`).join(', ')})`;
    case 'panneaux':
      return `linear-gradient(90deg, ${cols.map((x, i) => `${x} ${((i * 100) / cols.length).toFixed(0)}% ${(((i + 1) * 100) / cols.length).toFixed(0)}%`).join(', ')})`;
    default:
      return null;
  }
}

/** Vignette d'un équipement : couleur unie, ou bandes de la livrée pour un vélo. */
/** Genre d'une coiffe du garage : sans (tête nue), casquette, chrono (forme aéro) ou casque de route. */
function helmetKind(c: CosmeticItem): 'road' | 'tt' | 'cap' | 'none' {
  return c.bare ? 'none' : c.cap ? 'cap' : c.helmetShape ? 'tt' : 'road';
}

/** Pictogramme de chaque emplacement de la tenue. */
const SLOT_PICTO: Partial<Record<GarageSlot, string>> = { jersey: ICON.pJersey, helmet: ICON.pHelmet, glasses: ICON.pGlasses, socks: ICON.pSocks, shorts: ICON.pShorts, gloves: ICON.pGloves, shoes: ICON.pShoes, face: ICON.pFace, skin: ICON.pSkin, hair: ICON.pHair, beard: ICON.pBeard, colors: ICON.pPalette };

/** Encre (claire ou foncée) lisible sur le fond d'une pastille : d'après la première couleur hexadécimale du fond. */
function pictoInk(bg: string): string {
  const m = /#([0-9a-f]{6})/i.exec(bg);
  if (!m) return '#ffffff';
  const n = parseInt(m[1]!, 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.62 ? '#10141c' : '#ffffff';
}

/** Couleurs proposées d'un coup d'œil (la roue de couleur reste disponible à côté). */
const QUICK_COLORS: Record<string, string[]> = {
  jersey: ['#1f6feb', '#d62828', '#ffffff', '#2a9d8f', '#f4a261', '#111111', '#ffd23f', '#7b2cbf'],
  jerseyAccent: ['#ffd23f', '#ffffff', '#111111', '#d62828', '#1f6feb', '#2a9d8f'],
  helmet: ['#f4f4f4', '#111111', '#1f6feb', '#d62828', '#ffd23f', '#2a9d8f'],
  shoes: ['#f2f2f2', '#111418', '#1e5bd8', '#c0392b', '#d7f205', '#ff7a1a'],
  socks: ['#f2f2f2', '#111418', '#1e5bd8', '#c0392b', '#ffd23f', '#2a9d8f'],
  skin: ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#5c3a21'],
  hair: ['#1f1a17', '#3b2a1e', '#6a4e35', '#b88a52', '#d9c08a', '#9a9a9a', '#a8442a'],
  shoeAccent: ['#ffd23f', '#ffffff', '#111111', '#d62828', '#1f6feb', '#2a9d8f'],
  gloveColor: ['#16161a', '#ffffff', '#d62828', '#1f6feb', '#ffd23f', '#2a9d8f'],
};

function swatch(c: CosmeticItem): string {
  // « Sans casque » / « Sans lunettes » : pastille barrée.
  if (c.bare) return 'linear-gradient(135deg, transparent 44%, #e05a4f 44% 56%, transparent 56%), #3a3f47';
  const cap = c.cap ? capSwatch(c.cap) : null;
  if (cap) return cap;
  const pattern = patternSwatch(c);
  if (pattern) return pattern;
  // Maillot à bandes de champion : le maillot, traversé de ses bandes de poitrine.
  const bands = c.jersey?.style === 'bandes' ? (c.jersey.bands ?? []) : [];
  if (bands.length) {
    const h = Math.min(16, 48 / bands.length);
    const top = 50 - (h * bands.length) / 2;
    const stops = bands.map((x, i) => `${x} ${(top + i * h).toFixed(1)}% ${(top + (i + 1) * h).toFixed(1)}%`);
    return `linear-gradient(180deg, ${c.color ?? '#ffffff'} 0 ${top.toFixed(1)}%, ${stops.join(', ')}, ${c.color ?? '#ffffff'} ${(top + h * bands.length).toFixed(1)}% 100%)`;
  }
  const cols = c.colors ?? [];
  if (cols.length < 2) return c.color ?? '#7a8594';
  const n = cols.length;
  return `linear-gradient(135deg, ${cols.map((x, i) => `${x} ${((i * 100) / n).toFixed(0)}% ${(((i + 1) * 100) / n).toFixed(0)}%`).join(', ')})`;
}

/** Packs de maillots du garage, dans l'ordre d'affichage ; les maillots sans pack viennent en premier. */
const JERSEY_PACKS: ReadonlyArray<{ id: string; name: { fr: string; en: string } }> = [
  { id: '', name: { fr: 'Maillots', en: 'Jerseys' } },
  { id: 'tour', name: { fr: 'Tour de France', en: 'Tour de France' } },
  { id: 'pays', name: { fr: 'Champions nationaux', en: 'National champions' } },
  { id: 'distinctifs', name: { fr: 'Maillots distinctifs', en: 'Distinctive jerseys' } },
  { id: 'equipes', name: { fr: 'Couleurs d’équipes', en: 'Team colours' } },
  { id: 'pro', name: { fr: 'Équipes pro', en: 'Pro teams' } },
];

/**
 * Menu principal façon jeu : barre d'onglets en haut (Rouler, Garage, Capteurs, Profil,
 * Réglages), lecteur de musique et compte à droite ; panneaux posés sur la scène 3D fixe.
 * Onglet Rouler : modes en tuiles, carte et profil de l'itinéraire, départ. Garage : aperçu 3D
 * du coureur (vues prédéfinies, rotation à la souris) piloté par onScene.
 */
/** Mesures récentes affichées sur l'écran Capteurs. */
export interface DeviceLive {
  powerFrom?: 'pedals' | 'trainer';
  powerName?: string;
  watts?: number;
  cadenceFrom?: 'sensor' | 'pedals' | 'trainer';
  cadenceName?: string;
  cadence?: number;
  hr?: number;
  gear?: string;
  di2ButtonsOnly?: boolean;
}

type LiveKind = 'watts' | 'cadence' | 'hr' | 'gear';

function liveText(kind: LiveKind, live: DeviceLive | undefined): string {
  const v = live?.[kind];
  if (kind === 'gear') {
    if (live?.gear) return live.gear;
    if (live?.di2ButtonsOnly) return S('gearPositionUnavailableVia');
    return S('waitingForGearPosition');
  }
  const unit = kind === 'watts' ? 'W' : kind === 'hr' ? 'bpm' : S('rpm');
  return `${v === undefined ? '—' : v} ${unit}`;
}

/** Nom ramené en minuscules sans accents, pour une recherche tolérante. */
const foldName = (v: string): string => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export class MainMenu {
  private readonly root: HTMLElement;
  private readonly s: Settings;
  /** Itinéraires de la zone, chargés à la demande : seul celui qui est choisi l'est au lancement (routeStore.ts). */
  private routeStore: WorldRoutes;
  /** Itinéraires déjà chargés. */
  private get allRoutes(): RouteData[] {
    return this.routeStore.loaded();
  }
  /** Identifiants des parcours proposés avec le vélo équipé (route, gravel ou VTT), d'après l'index de la zone. */
  private get routeIds(): string[] {
    return routesForBike(this.routeStore.index, bikeSetupFor(loadProgress().equipped).tyre)
      .map((r) => r.id)
      .filter((id) => !this.routeBroken.has(id));
  }
  /** Parcours proposés et déjà chargés : ceux du vélo équipé. */
  private get routes(): RouteData[] {
    const mine = new Set(this.routeIds);
    return this.allRoutes.filter((r) => mine.has(r.id));
  }
  /** Chargements en cours ou en échec, pour ne pas les relancer à chaque dessin de l'écran. */
  private readonly routeAsked = new Set<string>();
  private allRoutesAsked = false;
  /** Parcours dont le fichier n'a pas pu être lu : plus proposés comme parcours choisi dans cette zone. */
  private readonly routeBroken = new Set<string>();
  /** Vrai quand le dernier chargement de parcours a échoué (message dans la liste, nouvel essai à la réouverture). */
  private routesFailed = false;
  /** Parcours des amis : ceux qui sont chargés, et le seul nom de l'index pour les autres (tableau gardé à jour sur place). */
  private readonly friendRoutes: RouteData[] = [];

  private syncFriendRoutes(): void {
    this.friendRoutes.length = 0;
    for (const ref of this.routeStore.index)
      this.friendRoutes.push(this.routeStore.get(ref.id) ?? { id: ref.id, name: ref.name, loop: ref.loop, lengthM: ref.lengthM, elevationGainM: ref.elevationGainM, points: [], segments: [], roadWidthM: 0, attribution: [] });
  }

  /** Les parcours viennent d'arriver : index des montées, amis, écran refait si le menu est affiché. */
  private routesArrived(): void {
    this.syncFriendRoutes();
    this.checkRoute();
    this.indexClimbs();
    if (this.root.querySelector('.mm')) this.render();
  }

  /** Charge le parcours `id` s'il est connu et pas encore là (fiche, parcours choisi), puis refait l'écran. */
  private needRoute(id: string): void {
    if (!id || this.routeStore.get(id) || this.routeAsked.has(id) || !this.routeStore.index.some((r) => r.id === id)) return;
    this.routeAsked.add(id);
    const store = this.routeStore;
    store.load(id).then(
      () => {
        this.routeAsked.delete(id);
        if (store === this.routeStore) this.routesArrived();
      },
      (e: unknown) => {
        console.warn(`Parcours ${id} indisponible`, e);
        this.routeAsked.delete(id);
        if (store !== this.routeStore) return;
        // Le parcours choisi est illisible : un autre prend sa place (checkRoute), sans redemander celui-ci.
        this.routeBroken.add(id);
        this.routesFailed = true;
        this.routesArrived();
      },
    );
  }

  /** Charge tous les parcours de la zone (liste, fiches, montées du défi KOM), puis refait l'écran. */
  private needAllRoutes(): void {
    if (this.routeStore.complete || this.allRoutesAsked) return;
    this.allRoutesAsked = true;
    const store = this.routeStore;
    store.loadAll().then(
      () => {
        if (store !== this.routeStore) return;
        this.routesFailed = false;
        this.routesArrived();
      },
      (e: unknown) => {
        console.warn('Parcours de la zone indisponibles', e);
        if (store !== this.routeStore) return;
        this.routesFailed = true;
        // Ceux qui sont arrivés restent utilisables ; la liste dit qu'il en manque.
        this.routesArrived();
      },
    );
  }

  /**
   * Parcours choisi : s'il n'est pas proposé avec le vélo équipé (ou inconnu), le premier qui l'est ; chargé s'il
   * ne l'est pas encore.
   */
  private checkRoute(): void {
    const ids = this.routeIds;
    if (!this.s.routeId || !ids.includes(this.s.routeId)) this.s.routeId = ids[0] ?? '';
    this.needRoute(this.s.routeId);
  }
  private readonly devices: DevicePanel;
  /** Rafraîchissement des valeurs en direct de l'écran Capteurs. */
  private devLiveTimer: ReturnType<typeof setInterval> | undefined;
  private readonly cb: MenuCallbacks;
  private workoutFile: { name: string; content: string } | undefined;
  /** Filtre de la fenêtre des séances : un type, « mes séances » (importées), ou tout. */
  private wkFilter: WorkoutType | 'mine' | '' = '';
  /** Filtre de la fenêtre des séances au dernier rendu (null : fenêtre fermée), pour garder son défilement. */
  private wkScrollKey: string | null = null;
  /** Séance regardée dans la fiche du studio (pas encore choisie). */
  private wkSel: string | null = null;
  /** Recherche, filtre de durée et ordre de la liste du studio (le temps de la session). */
  private wkQuery = '';
  private wkDur: WorkoutDurFilter = '';
  private wkSort: WorkoutSort = 'type';
  /** Position du curseur dans la recherche, à rendre après un nouveau rendu (null : pas de focus à rendre). */
  private wkQueryCaret: number | null = null;
  /** Séances importées, gardées dans l'historique (rechargées à l'ouverture de la fenêtre). */
  private myWorkouts: LocalWorkout[] = [];
  /** Séances favorites (identifiants de la bibliothèque ou `mine:…`), listées dans « Mes séances ». */
  private favWorkouts = new Set<string>(
    (() => {
      try {
        return JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]') as string[];
      } catch {
        return [];
      }
    })(),
  );
  /** Historique (sous-onglet du Profil). */
  private readonly historyPanel = new HistoryPanel();
  /** Carte « Heure et météo » réduite à son résumé (en personnalisé). */
  private wxFolded = (() => {
    try {
      return localStorage.getItem('ar.wxFolded') === '1';
    } catch {
      return false;
    }
  })();
  /** Sous-onglet du Profil : réglages du coureur ou historique des sorties. */
  private profileView: 'profile' | 'history' = 'profile';
  /** Compteur de km du profil : redessiné quand l'historique change (nouvelle sortie, synchronisation). */
  private readonly historyWatch = rideHistory.subscribe(() => {
    if (this.tab === 'profile' && this.profileView === 'profile' && this.root.querySelector('.mm-bigstats')) this.render();
    // Trophées : meilleure sortie et nombre de sorties viennent de l'historique.
    if (this.tab === 'progress') this.render();
  });
  private tab: Tab = 'ride';
  private garageSlot: GarageSlot = 'jersey';
  /** Filtre du catalogue du garage : tout, débloqués (portables) ou verrouillés (niveau à atteindre). */
  private itemFilter: 'all' | 'unlocked' | 'locked' = 'all';
  /** Casques : type affiché (casque route, chrono, casquette, sans coiffe). */
  private helmetType: 'all' | 'road' | 'tt' | 'cap' | 'none' = 'all';
  /** Menu du garage réduit (vue plus large). */
  private grFolded = false;
  /** Le garage est déjà ouvert (animation d'arrivée jouée). */
  private garageEntered = false;
  /** Atelier (pièces du vélo, ensembles, crédits) : panneau et état de la scène 3D. */
  private readonly atelier: AtelierPanel;
  /** Onglet Progression : niveaux, récompenses, trophées et défis. */
  private readonly progress: ProgressPage;
  /** Atelier 3D (pièce procédurale, vélo sur pied) : état demandé, null pour le fermer. */
  onAtelier?: (st: AtelierState | null) => void;
  /** Pièce du vélo 3D sous le pointeur (coordonnées écran) : emplacement d'atelier, null si aucune. */
  onAtelierPick?: (x: number, y: number) => import('@allezrobert/shared').TuneSlot | null;
  /** Style Beta : clic sur la vue du garage (pièce du coureur ou du vélo V3 → sa rubrique, qui pulse). */
  onV3Pick?: (x: number, y: number) => boolean;
  /** Éditeur de visage : groupe de curseurs, tête nue dans l'aperçu, tenues précédentes (annulation). */
  private faceTab: FaceTab = 'head';
  private bareHead = true;
  private readonly faceUndo: AvatarLook[] = [];
  private photoOpen = false;
  private bikeFilter: BikeFilter = 'saison-2026';
  private bikeType: BikeType | 'all' = 'all';
  /** Panneau affiché (onglet, catégorie, filtre) : sa position de défilement survit à un nouveau rendu. */
  private panelKey = '';
  private view: GarageView = '3q';
  private yaw = 0;
  /** Distance de la caméra du garage (molette) : 1 = cadrage normal. */
  private zoom = 1;
  private readonly onKey = (e: KeyboardEvent) => {
    if (this.picker && e.key === 'Escape') {
      e.preventDefault();
      this.closePicker();
      return;
    }
    if (!this.root.querySelector('.mm')) return;
    // Flèches : le focus passe au bouton ou bloc le plus proche dans cette direction (fenêtre ouverte comprise),
    // sauf dans un champ de saisie, une liste ou un curseur, où elles gardent leur rôle. Entrée : natif sur <button>.
    const dir = ARROW_DIRS[e.key];
    if (dir) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || inEditable(e.target as Element | null)) return;
      if (moveFocus(dir)) e.preventDefault();
      return;
    }
    if (this.root.querySelector('.mm-modal')) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT') return;
    // Échap : d'un onglet vers Rouler, de Rouler vers l'accueil.
    if (e.key === 'Escape' && this.tab !== 'home') this.go(this.tab === 'ride' ? 'home' : 'ride');
  };

  /**
   * Navigation sans souris (manette, boutons du cintre) : `up`/`down`/`left`/`right` déplacent le focus comme les
   * flèches, `confirm` active l'élément qui a le focus (ou l'action principale jaune), `back` fait comme Échap.
   * Renvoie vrai si le menu a réagi.
   */
  navigate(dir: 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back'): boolean {
    if (!this.root.querySelector('.mm')) return false;
    if (dir === 'confirm') return activateFocus();
    if (dir !== 'back') return moveFocus(dir);
    if (this.picker) {
      this.closePicker();
      return true;
    }
    const modal = [...this.root.querySelectorAll<HTMLElement>('.mm-modal')].at(-1);
    if (modal) {
      const close = modal.querySelector<HTMLElement>('.mm-x, [data-close], [data-picker-close]:not(.mm-modal)');
      close?.click();
      return !!close;
    }
    if (this.tab === 'home') return false;
    this.go(this.tab === 'ride' ? 'home' : 'ride');
    return true;
  }
  onSettingsChange?: (s: Settings) => void;
  /** Relance le tutoriel (onboarding) depuis le menu. */
  onTutorial?: () => void;
  /**
   * Clic sur « Rouler » de l'accueil : vrai si le jeu a pris la suite lui-même (premier lancement : le tutoriel),
   * faux pour ouvrir l'onglet Rouler. Le clic autorise déjà le son (musique, voix du tutoriel).
   */
  onHomeRide?: () => boolean;
  /** Garage prêt en mémoire (pièce, coureur, shaders) : jusqu'ici l'accueil n'offre pas « Rouler ». */
  private garageReady = false;
  private garageProgress = 0;

  /** Le garage est chargé : « Rouler » remplace la barre d'attente de l'accueil. */
  setGarageReady(): void {
    if (this.garageReady) return;
    this.garageReady = true;
    if (this.tab === 'home' && this.root.querySelector('.mm-tab-home')) this.render();
  }

  /** Avancement de la préparation du garage (0–1), affiché sur l'accueil. */
  setGarageProgress(fraction: number): void {
    this.garageProgress = fraction;
    const pct = this.root.querySelector('.mm-home-wait-pct');
    if (pct) pct.textContent = fraction > 0 ? `${Math.round(fraction * 100)} %` : '';
  }
  /** « Explorer la carte » : survol libre du monde chargé, sans rouler (Échap pour revenir). */
  onExplore?: () => void;
  /** Aperçu immédiat d'une tenue (éditeur de visage) sur le coureur du garage, sans reconstruire la scène. */
  onLookLive?: (look: AvatarLook, bareHead: boolean) => void;
  /** Éditeur de visage ouvert avec tête nue : l'aperçu garde casque et lunettes masqués. */
  get bareHeadPreview(): boolean {
    return this.tab === 'garage' && isFaceSlot(this.garageSlot) && this.bareHead;
  }
  /** Cadrage 3D demandé par le menu : photo du groupe ou vue du garage (rotation en radians). */
  onScene?: (view: 'poster' | GarageView, yaw: number, bikeOnly?: boolean, zoom?: number) => void;
  /** Style V3 : emplacements du panneau du garage (corps, tête du panneau) à remplir par l'atelier. */
  onV3Garage?: (body: HTMLElement | null, top: HTMLElement | null) => void;
  /** Style Beta : récompense de la page Progression (`gear:…`, `bike:…`, `wheel:…`) à montrer au garage. */
  onV3Reveal?: (id: string) => void;
  /** Aperçu d'un équipement (même verrouillé) sur le coureur du garage ; null : tenue équipée. */
  onPreviewLook?: (look: AvatarLook | null) => void;
  /** Carte du choix (sous « Choisir ma sortie ») : seulement après un choix fait dans ce menu. */
  private selMap = false;
  private mq: MediaQueryList | null = null;


  /** Essais en cours au garage, un par emplacement (vélo, maillot…) : ils restent en place pendant qu'on en essaie d'autres. */
  private readonly previews = new Map<CosmeticSlot, string>();
  /** Compte connecté (affiché dans le menu), connexion / déconnexion, synchro du profil. */
  account: { name: string; level: number; credits?: number } | null = null;
  onLogin?: () => void;
  onLogout?: () => void;
  /** Monde affiché et changement de monde (rechargement de la page). */
  worldId = 'longchamp';
  /** Zones chargées ensemble : la zone `worldId` puis les voisines ajoutées (parcours libre et à dessiner). */
  loadedZones: string[] = [];

  /** Montées chronométrées connues par zone (mémorisées à chaque zone chargée) : le tableau des records les liste toutes. */
  private komIndex(): Record<string, Array<{ routeId: string; routeName: string; segId: string; name: string; lengthM: number; grade: number }>> {
    try {
      return JSON.parse(localStorage.getItem('ar.komIndex') ?? '{}') as ReturnType<MainMenu['komIndex']>;
    } catch {
      return {};
    }
  }

  private indexClimbs(): void {
    // Liste partielle (parcours pas tous chargés) : l'index mémorisé de la zone, complet, reste en place.
    if (!this.routeStore.complete) return;
    const seen = new Set<string>();
    const list: ReturnType<MainMenu['komIndex']>[string] = [];
    for (const route of this.routes)
      for (const k of route.segments)
        if (k.kind === 'kom' && !seen.has(k.name)) {
          seen.add(k.name);
          list.push({ routeId: route.id, routeName: this.routeName(route), segId: k.id, name: k.name, lengthM: k.endM - k.startM, grade: k.avgGrade });
        }
    if (!list.length || !this.worldId) return;
    const all = this.komIndex();
    all[this.worldId] = list;
    try {
      localStorage.setItem('ar.komIndex', JSON.stringify(all));
    } catch {
      // Stockage indisponible : le tableau ne montrera que la zone affichée.
    }
  }

  /** Nom d'une zone (catalogue du jeu, sinon carte de France). */
  private zoneLabel(id: string): string {
    const lang = getLang();
    return WORLD_LIST.find((x) => x.id === id)?.name[lang] ?? ZONE_SPOTS.find((x) => x.id === id)?.name[lang] ?? id;
  }

  /** Graphe routier de la zone arrivé (chargé à la demande) : la carte du planificateur est redessinée. */
  refreshMap(): void {
    // Seulement si une carte du planificateur est à l'écran : refaire l'écran ailleurs ferait perdre une saisie en cours.
    if (this.root.querySelector('.rp-roads')) this.render();
  }

  /** Nouveau monde chargé sur place : parcours, identifiant, monde ouvert ; l'écran est refait. */
  setWorld(store: WorldRoutes, worldId: string, open: boolean): void {
    this.routeStore = store;
    this.routeAsked.clear();
    this.routeBroken.clear();
    this.allRoutesAsked = false;
    this.routesFailed = false;
    this.syncFriendRoutes();
    const routes = this.routeStore.index.filter((r) => this.routeIds.includes(r.id));
    this.worldId = worldId;
    this.openWorld = open;
    this.indexClimbs();
    // Montée choisie dans une autre zone : sélectionnée dès que sa zone est chargée.
    if (this.pendingKom && routes.some((r) => r.id === this.pendingKom?.routeId)) {
      this.s.mode = 'challenge';
      this.s.routeId = this.pendingKom.routeId;
      this.s.reverse = false;
      this.s.challengeSeg = this.pendingKom.segId;
      saveSettings(this.s);
      this.pendingKom = null;
    }
    this.checkRoute();
    if (this.routesAfterWorld && this.picker === 'zones') this.picker = 'zone';
    // Autre zone : le parcours dessiné et le départ du libre de l'ancienne ne valent plus.
    if (worldId !== this.drawnWorld) {
      this.drawn = null;
      this.freeStart = null;
    }
    this.routesAfterWorld = false;
    this.loadingZone = '';
    if (this.root.querySelector('.mm')) this.render();
    // Monde ouvert choisi dans une autre zone : on y va dès qu'elle est chargée.
    const pendingOpen = this.pendingOpen;
    this.pendingOpen = null;
    if (pendingOpen && routes.some((r) => r.id === pendingOpen.routeId)) this.joinOpenWorld(pendingOpen.routeId, worldId, pendingOpen.friendId);
  }

  /** Rejoint le monde ouvert d'un itinéraire public, en chargeant d'abord sa zone si ce n'est pas la zone affichée. */
  private joinOpenWorld(routeId: string, worldId: string, friendId?: string): void {
    if (this.worldId !== worldId && this.onWorld) {
      this.pendingOpen = { routeId, ...(friendId ? { friendId } : {}) };
      this.loadingZone = this.zoneLabel(worldId);
      this.onWorld(worldId);
      return;
    }
    this.s.mode = 'free';
    this.s.routeId = routeId;
    this.s.reverse = false;
    saveSettings(this.s);
    this.launch(this.s, { publicRoom: true, ...(friendId ? { nearFriend: friendId } : {}) });
  }
  openWorld = false;
  /** Zone choisie dans la fenêtre « Zones » : ses parcours s'ouvrent dès qu'elle est chargée. */
  private routesAfterWorld = false;
  /** Nom de la zone en cours de chargement (affiché sur la carte de France). */
  private loadingZone = '';
  /** Carte de France de la fenêtre « Zones ». */
  private readonly franceMap = new FranceMap();
  /** Itinéraire sur la carte d'une zone ouverte (fenêtre « Parcours ») : graphe donné par `planner.setOpen`. */
  readonly planner = new RoutePlanner();
  onWorld?: (id: string) => void;
  onSettingsSaved?: (s: Settings) => void;
  /** Fenêtre de choix ouverte au milieu de l'écran (bouton « Choisir ma sortie »). */
  private picker: 'zones' | 'zone' | 'routes' | 'map' | 'route' | 'workouts' | 'koms' | null = null;
  /** Fenêtre « Défi KOM » : zone filtrée ('' = toutes) et montée d'une autre zone à choisir une fois cette zone chargée. */
  private komZone = '';
  /** Tri du tableau des montées (clic sur un titre de colonne ; un second clic inverse l'ordre). */
  private komSort: { key: 'name' | 'length' | 'grade' | 'best'; dir: 1 | -1 } | null = null;
  /** Recherche dans la liste des montées (filtre les lignes sur place, sans redessiner). */
  private komQuery = '';
  private pendingKom: { routeId: string; segId: string } | null = null;
  /** Parcours ouvert dans sa fiche (fenêtre « route »). */
  private detailId = '';
  /** Sens montré dans la fiche du parcours (choisi au départ). */
  private detailReverse = false;
  /** Départ choisi dans la fiche (boucles) : m sur le tracé d'origine dans le sens montré, 0 = d'origine. */
  private detailStartM = 0;
  /** Fenêtre déjà affichée (l'animation d'ouverture ne se joue qu'au changement). */
  private shownPicker: string | null = null;
  /** Carte de parcours cliquée : la fiche s'ouvre en grandissant depuis elle. */
  private fromRect: DOMRect | null = null;
  /** Parcours dessiné sur la carte (zone ouverte), roulé au départ s'il est le parcours choisi. */
  private drawn: RouteData | null = null;
  /** Départ choisi sur la carte pour le roulage libre (null : départ de la zone). */
  private freeStart: { x: number; z: number } | null = null;
  /** Zone du parcours dessiné et du départ du libre. */
  private drawnWorld = '';
  /** Catalogue des zones (packs de cartes). */
  private zones: WorldCatalogue['zones'] = [];
  /** Téléchargements en cours : octets reçus / total, ou message d'erreur. */
  private readonly downloads = new Map<string, { done: number; total: number; error?: string }>();
  /** « Tout télécharger » : zones en attente, téléchargées une à une dans l'ordre. */
  private readonly queued = new Set<string>();
  private queueRunning = false;
  private lastProgressRender = 0;
  /** Onglet Amis : présence, demandes, invitations (interrogation tant que le menu est affiché). */
  private readonly friends: FriendsPanel;
  /** Monde ouvert : salles publiques par zone (affluence, amis présents). */
  private readonly openWorldPanel: OpenWorldPanel;
  /** Zone ouverte choisie dans un autre monde : rejointe dès que ce monde est chargé. */
  private pendingOpen: { routeId: string; friendId?: string } | null = null;

  constructor(root: HTMLElement, settings: Settings, routes: WorldRoutes, devices: DevicePanel, cb: MenuCallbacks) {
    this.root = root;
    this.s = settings;
    this.routeStore = routes;
    this.devices = devices;
    this.cb = cb;
    this.syncFriendRoutes();
    this.checkRoute();
    this.indexClimbs();
    void loadCatalogue().then((cat) => {
      this.zones = cat?.zones ?? [];
      if (this.tab === 'ride' && this.root.querySelector('.mm')) this.render();
    });
    this.openWorldPanel = new OpenWorldPanel({
      loggedIn: () => !!this.account,
      login: () => this.onLogin?.(),
      zones: () => this.zones,
      join: (routeId, worldId, friendId) => this.joinOpenWorld(routeId, worldId, friendId),
    });
    this.friends = new FriendsPanel({
      loggedIn: () => !!this.account,
      login: () => this.onLogin?.(),
      routes: this.friendRoutes,
      currentRouteId: () => routeKey(this.s),
      join: (info) => {
        // Rejoindre un ami : son mode et son itinéraire (s'il existe dans ce monde), code fourni par le serveur.
        const j = joinSettings(info, this.routeIds, this.s);
        this.s.mode = j.mode;
        this.s.routeId = j.routeId;
        this.s.reverse = j.reverse;
        this.s.startM = j.startM;
        saveSettings(this.s);
        this.launch(this.s, { inviteCode: info.inviteCode });
      },
      rideWith: (ids) => {
        if (this.s.mode !== 'group' && this.s.mode !== 'race') this.s.mode = 'group';
        saveSettings(this.s);
        this.launch(this.s, { inviteFriends: ids });
      },
    });
    devices.onChange(() => {
      if (this.tab === 'devices') this.renderDevices();
      this.renderStatus();
    });
    this.atelier = new AtelierPanel(settings, {
      account: () => this.account,
      scene: (st) => this.onAtelier?.(st),
      changed: () => {
        saveSettings(this.s);
        this.onSettingsChange?.(this.s);
        this.onSettingsSaved?.(this.s);
      },
      rerender: () => this.render(),
    });
    this.progress = new ProgressPage(this.root, {
      level: () => this.account?.level ?? levelProgress(loadProgress().xp).level,
      credits: () => this.account?.credits ?? loadProgress().credits,
      look: () => this.s.look,
      cosmeticSwatch: swatch,
      bikeIcon: (colors) => bikeIcon(colors),
      openCosmetic: (item) => {
        this.leaveProgress();
        this.openInGarage(item);
      },
      openV3: (id) => {
        this.leaveProgress();
        this.go('garage');
        this.onV3Reveal?.(id);
      },
      openTune: (id) => {
        this.leaveProgress();
        if (this.garageSlot !== 'atelier') this.garageSlot = 'atelier';
        this.atelier.openItem(id);
        this.go('garage');
        this.atelier.blink(id);
        // Même clignotement jaune que pour un équipement : la pastille de la pièce dans la liste de l'atelier.
        const chip = this.root.querySelector<HTMLElement>(`[data-tune="${CSS.escape(id)}"]`);
        chip?.scrollIntoView({ block: 'center' });
        chip?.classList.add('blink');
        setTimeout(() => chip?.classList.remove('blink'), 3800);
      },
      rerender: () => this.render(),
    });
  }

  /**
   * Récompense choisie dans l'onglet Progression : le garage s'ouvre sur sa catégorie, l'équipement
   * essayé sur le coureur s'il est encore verrouillé, la liste des vélos sur sa collection.
   */
  private openInGarage(item: CosmeticItem): void {
    this.garageSlot = item.slot;
    this.view = SLOT_VIEW[item.slot];
    this.yaw = 0;
    if (item.slot === 'bike') {
      const bike = bikeById(item.id);
      this.bikeFilter = bike ? bike.collection : 'divers';
      this.bikeType = 'all';
    }
    this.go('garage');
    if (item.level > levelProgress(loadProgress().xp).level) {
      this.previews.set(item.slot, item.id);
      this.sendPreview();
      this.render();
    }
    const card = this.root.querySelector<HTMLElement>(`[data-item="${CSS.escape(item.id)}"]`);
    card?.scrollIntoView({ block: 'center' });
    this.blinkArrival(item, card);
  }

  private blinkTimer: ReturnType<typeof setInterval> | undefined;

  /**
   * Arrivée depuis Progression : l'équipement clignote quelques secondes, sur le coureur (il apparaît et disparaît)
   * et dans la liste (carte en surbrillance), pour qu'on le repère tout de suite.
   */
  private blinkArrival(item: CosmeticItem, card: HTMLElement | null): void {
    clearInterval(this.blinkTimer);
    card?.classList.add('blink');
    setTimeout(() => card?.classList.remove('blink'), 3800);
    // Déjà équipé : le coureur le porte déjà, seule la carte clignote.
    if (loadProgress().equipped[item.slot] === item.id) return;
    this.previews.set(item.slot, item.id);
    this.sendPreview();
    let n = 0;
    this.blinkTimer = setInterval(() => {
      n++;
      if (n % 2 === 1) this.previews.delete(item.slot);
      else this.previews.set(item.slot, item.id);
      this.sendPreview();
      if (n >= 8) {
        clearInterval(this.blinkTimer);
        this.previews.set(item.slot, item.id);
        this.sendPreview();
      }
    }, 380);
  }

  /** Ouvre une rubrique des Réglages (retour de Strava : la rubrique d'envoi des sorties). */
  openSettingsSection(id: string): void {
    this.settingsOpen.add(id);
    // Anciennes rubriques repliables : chacune a rejoint une catégorie.
    const cat: Record<string, string> = { graphics: 'image', hud: 'interface', weather: 'ride', trainer: 'ride', music: 'sound', sound: 'sound', companion: 'companion', zones: 'zones', lang: 'general', expert: 'expert' };
    this.settingsCat = cat[id] ?? id;
  }

  show(tab: Tab = 'home'): void {
    document.addEventListener('keydown', this.onKey);
    if (!this.mq) {
      this.mq = matchMedia('(max-width: 900px)');
      this.mq.addEventListener('change', () => this.root.querySelector('.mm') && this.tab === 'ride' && this.render());
    }
    // Au lancement du jeu et après une sortie : pas de carte du choix tant qu'on n'a rien choisi.
    this.selMap = false;
    this.friends.start();
    this.openWorldPanel.start();
    // Lien /?ami=CODE : l'onglet Amis propose la demande.
    this.go((tab === 'home' || tab === 'ride') && this.friends.hasPendingCode() ? 'friends' : tab);
  }

  hide(): void {
    if (this.garageSlot === 'atelier') this.atelier.leave();
    document.removeEventListener('keydown', this.onKey);
    this.friends.stop();
    this.openWorldPanel.stop();
    this.root.innerHTML = '';
  }

  /** Arrivée au garage depuis une fiche de la page Progression : bouton de retour affiché au garage. */
  private fromProgress = false;

  private leaveProgress(): void {
    this.progress.keep();
    this.fromProgress = true;
  }

  private go(tab: Tab): void {
    if (tab !== 'garage') clearInterval(this.blinkTimer);
    if (tab !== 'garage') this.fromProgress = false;
    this.picker = null;
    if (tab !== 'progress' && !this.fromProgress) this.progress.reset();
    if (tab !== 'garage' && this.previews.size) {
      this.previews.clear();
      this.onPreviewLook?.(null);
    }
    this.tab = tab;
    if (V3_STYLE && tab === 'garage') this.garageSlot = 'jersey';
    this.render();
    // Garage resté sur l'atelier : sa pièce 3D ; sinon la photo ou le coureur du garage.
    if (tab === 'garage' && this.garageSlot === 'atelier') return this.atelier.emit();
    if (this.garageSlot === 'atelier') this.atelier.leave();
    this.onScene?.(tab === 'garage' ? this.view : 'poster', tab === 'garage' ? this.yaw : 0, tab === 'garage' && this.garageSlot === 'bike', this.zoom);
  }

  /** Croix de fermeture d'un panneau (retour à l'onglet Rouler, comme Échap). */
  private closeBtn(): string {
    return `<button class="mm-close" data-tab="ride" aria-label="${S('close')}" title="${S('closeEsc')}">×</button>`;
  }

  /** Champ numérique avec − et + aux couleurs de l'appli (remplace les flèches du navigateur). */
  private stepper(id: string, min: number, max: number, value: number, step = 1): string {
    return `<div class="mm-stepper" data-stepper><button type="button" data-step="-1" aria-label="−" tabindex="-1">−</button><input id="${id}" type="number" inputmode="decimal" min="${min}" max="${max}" step="${step}" value="${value}" /><button type="button" data-step="1" aria-label="+" tabindex="-1">+</button></div>`;
  }

  /** Branche les − / + : la valeur reste dans [min, max] et le champ émet « change » comme s'il avait été saisi. */
  private bindSteppers(scope: ParentNode): void {
    scope.querySelectorAll<HTMLElement>('[data-stepper]').forEach((box) => {
      const input = box.querySelector('input') as HTMLInputElement;
      box.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((b) =>
        b.addEventListener('click', () => {
          const step = Number(input.step) || 1;
          const min = Number(input.min);
          const max = Number(input.max);
          const v = Math.min(max, Math.max(min, Math.round(((Number(input.value) || min) + Number(b.dataset.step) * step) / step) * step));
          input.value = String(Number(v.toFixed(2)));
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }),
      );
    });
  }

  /** Choix en boutons segmentés (remplace les listes déroulantes du système). */
  /**
   * Heure et météo de la sortie (onglet Rouler, tous les modes) : heure de départ, ciel, vent, météo
   * fixe ou qui évolue. En groupe, celles du créateur s'appliquent à tous.
   */
  private weatherHtml(): string {
    const s = this.s;
    const L = fr();
    // Préréglage le plus proche des curseurs (Réglages), s'il y en a un.
    const near = WEATHER_PRESETS.map(([id, w]) => [id, Math.abs(w.clouds - s.clouds) + Math.abs(w.rain - s.rain) + Math.abs(w.fog - s.fog)] as const).sort((a, b) => a[1] - b[1])[0];
    const sky = near && near[1] < 0.35 ? near[0] : '';
    const wind = String(WIND_STEPS.reduce((best, v) => (Math.abs(v - s.windMs) < Math.abs(best - s.windMs) ? v : best), WIND_STEPS[0] as number));
    // Carte toujours visible : un interrupteur « Réelles / Personnalisées » règle d'un geste l'heure et la météo ;
    // le détail (heure, ciel, vent) n'apparaît qu'en personnalisé.
    const allReal = s.realTime && s.realWeather;
    const skyName: Record<string, [string, string]> = { sun: ['soleil', 'sunny'], cloudy: ['nuageux', 'cloudy'], rain: ['pluie', 'rain'], fog: ['brouillard', 'fog'] };
    const skyLabel = sky && skyName[sky] ? (skyName[sky] as [string, string])[L ? 0 : 1] : S('customSky');
    const summary = allReal
      ? L
        ? `Heure actuelle (${this.hourLabel(nowHour())}) et météo du moment autour du départ.`
        : `Current time (${this.hourLabel(nowHour())}) and today’s weather around the start.`
      : `${S('startAt')} ${this.hourLabel(s.realTime ? nowHour() : s.hour)} · ${s.realWeather ? (S('todaySWeather')) : skyLabel}`;
    // Personnalisé : la carte se réduit à sa ligne de résumé (bouton « ˄ / ˅ », choix gardé).
    const folded = !allReal && this.wxFolded;
    const foldBtn = allReal
      ? ''
      : `<button type="button" class="mm-wx-fold${folded ? ' is-folded' : ''}" data-wxfold aria-expanded="${!folded}" title="${folded ? S('wxUnfold') : S('wxFold')}" aria-label="${folded ? S('wxUnfold') : S('wxFold')}"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 10.5 8 5.5l5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
    return `<div class="mm-card mm-wxcard">
      <div class="mm-opt mm-opt-first"><div class="mm-opt-l"><b>${S('timeAndWeather')}</b><small>${esc(summary)}</small></div><div class="mm-wx-head">${this.seg('m-realall', allReal ? '1' : '0', [
        ['1', S('real')],
        ['0', S('custom')],
      ])}${foldBtn}</div></div>
      ${allReal || folded ? '' : `<div class="mm-weather">
      ${this.hourFields()}
      <div class="field">${S('conditions')}${this.seg('m-realwx', s.realWeather ? '1' : '0', [
        ['1', S('todayReal')],
        ['0', S('custom2')],
      ])}</div>
      ${
        s.realWeather
          ? `<p class="hw-hint">${S('realSkyRainFog')}</p>`
          : `<div class="field">${S('sky')}${this.seg('m-wx', sky, [
        ['sun', S('sunny')],
        ['cloudy', S('cloudy')],
        ['rain', S('rain')],
        ['fog', S('fog')],
      ])}</div>
      <div class="field">${S('wind')}${this.seg('m-wind', wind, [
        ['0', S('calm')],
        ['3', S('light')],
        ['6', S('moderate')],
        ['10', S('strong')],
      ])}</div>
      <div class="field">${S('weather')}${this.seg('m-evolve', s.weatherEvolves ? '1' : '0', [
        ['0', S('fixed')],
        ['1', S('changing')],
      ])}</div>`
      }
    </div>`}
    </div>`;
  }

  /** Niveau des coureurs IA, en part de la FTP du joueur (chacun varie ensuite autour, forme du jour comprise). */
  private aiLevelSeg(): string {
    const L = fr();
    const levels: Array<[number, string, string]> = [
      [0.7, 'Facile', 'Easy'],
      [0.85, 'Modéré', 'Moderate'],
      [1, 'Égal', 'Even'],
      [1.15, 'Fort', 'Strong'],
      [1.3, 'Pro', 'Pro'],
    ];
    const cur = levels.reduce((b, l) => (Math.abs(l[0] - this.s.aiLevel) < Math.abs(b[0] - this.s.aiLevel) ? l : b), levels[2] as [number, string, string]);
    return this.seg(
      'm-ailevel',
      String(cur[0]),
      levels.map(([v, f, e]) => [String(v), `${L ? f : e} ${Math.round(v * 100)} %`]),
    );
  }

  private seg(id: string, current: string, opts: Array<[string, string]>): string {
    return `<div class="mm-seg" id="${id}" data-value="${esc(current)}" role="radiogroup">${opts
      .map(([v, label]) => `<button type="button" role="radio" aria-checked="${v === current}" class="${v === current ? 'on' : ''}" data-v="${esc(v)}">${esc(label)}</button>`)
      .join('')}</div>`;
  }

  /** Branche les boutons segmentés : valeur lue comme un <select> (propriété value + événement change). */
  private bindSegs(scope: ParentNode): void {
    scope.querySelectorAll<HTMLElement>('.mm-seg').forEach((box) => {
      Object.defineProperty(box, 'value', { configurable: true, get: () => box.dataset.value ?? '' });
      box.querySelectorAll<HTMLButtonElement>('[data-v]').forEach((b) =>
        b.addEventListener('click', () => {
          box.dataset.value = b.dataset.v ?? '';
          box.querySelectorAll('[data-v]').forEach((x) => {
            x.classList.toggle('on', x === b);
            x.setAttribute('aria-checked', String(x === b));
          });
          box.dispatchEvent(new Event('change'));
        }),
      );
    });
  }

  /** Tenue du coureur avec un équipement à couleur appliqué (aperçu). */
  /** Tenue affichée au garage : celle équipée, avec les essais en cours par-dessus. */
  currentLook(): AvatarLook {
    let look = this.s.look;
    for (const id of this.previews.values()) {
      const item = COSMETICS.find((c) => c.id === id);
      if (item) look = this.lookWith(item, look);
    }
    return look;
  }

  private sendPreview(): void {
    this.onPreviewLook?.(this.previews.size ? this.currentLook() : null);
  }

  private lookWith(item: CosmeticItem, base: AvatarLook = this.s.look): AvatarLook {
    const look = { ...base };
    if (item.slot === 'helmet') return helmetLookOf(item, look);
    if (item.slot === 'glasses') return glassesLookOf(item, look);
    if (item.color) {
      if (item.slot === 'jersey') Object.assign(look, jerseyLookOf(item));
      if (item.slot === 'bike') look.bike = item.color;
      if (item.slot === 'socks') look.socks = item.color;
    }
    if (item.slot === 'bike') {
      // Modèle du catalogue (cadre, livrée) ou VTT / gravel : le type de pneus suit l'équipement.
      look.bikeType = item.physics?.tyre ?? 'road';
      if (bikeById(item.id)) look.bikeModel = item.id;
      else delete look.bikeModel;
      // Vélo essayé : avec sa propre livrée, sans la peinture de l'atelier.
      if (look.tune?.length) look.tune = look.tune.filter((id) => tuneItem(id)?.slot !== 'paint');
    }
    return look;
  }

  private opt<T extends string>(value: T, current: string, label: string): string {
    return `<option value="${value}" ${value === current ? 'selected' : ''}>${esc(label)}</option>`;
  }

  private routeName(r: RouteData): string {
    return getLang() === 'en' && r.nameEn ? r.nameEn : r.name;
  }

  /** 9,25 → « 9 h 15 ». */
  /** Heure de départ : l'heure actuelle (choisie par défaut) ou une heure réglée à la main avec le curseur. */
  private hourFields(): string {
    const s = this.s;
    return `<div class="field">${S('startTime')}${this.seg('m-realtime', s.realTime ? '1' : '0', [
      ['1', `${S('currentTime')} · ${this.hourLabel(nowHour())}`],
      ['0', S('custom3')],
    ])}</div>${
      s.realTime
        ? ''
        : `<label class="field">${t('hour')} <span id="m-hourv">${this.hourLabel(s.hour)}</span><input id="m-hour" type="range" min="5" max="22" step="0.25" value="${s.hour}" /></label>`
    }`;
  }

  private hourLabel(h: number): string {
    const hh = Math.floor(h);
    const mm = Math.round((h - hh) * 60);
    return `${hh} h ${String(mm).padStart(2, '0')}`;
  }

  private km(m: number): string {
    return dec(m / 1000);
  }

  /** Durée indicative à allure d'endurance (≈ 26 km/h à plat, plus 1 h par 700 m de D+). */
  private eta(r: RouteData): string {
    const h = r.lengthM / 26000 + r.elevationGainM / 700;
    const hh = Math.floor(h);
    const mm = Math.round((h - hh) * 60);
    return hh ? `${hh} h ${String(mm).padStart(2, '0')}` : `${mm} min`;
  }

  private modes(): Array<[Settings['mode'], I18nKey, string]> {
    return fr()
      ? [
          ['free', 'free', 'Rouler seul, à son rythme.'],
          ['group', 'group', 'Rouler à plusieurs : le groupe reste ensemble.'],
          ['race', 'race', 'Course en ligne, classement à l’arrivée.'],
          ['workout', 'workout', 'Séance structurée en mode ERG : séances intégrées ou fichier .zwo, .erg, .mrc.'],
          ['ftpTest', 'ftpTest', 'Test FTP : rampe, rampe douce ou 20 minutes, pour estimer ta FTP.'],
          ['challenge', 'challenge', 'Bats ton record sur une montée : départ lancé, fantôme de ton meilleur temps, écart en direct.'],
        ]
      : [
          ['free', 'free', 'Ride on your own, at your own pace.'],
          ['group', 'group', 'Ride together: the group stays as one.'],
          ['race', 'race', 'Online race, results at the finish.'],
          ['workout', 'workout', 'Structured session in ERG mode: built-in workouts or a .zwo, .erg, .mrc file.'],
          ['ftpTest', 'ftpTest', 'FTP test: ramp, gentle ramp or 20 minutes, to estimate your FTP.'],
          ['challenge', 'challenge', 'Beat your record on a climb: flying start, ghost of your best time, live gap.'],
        ];
  }

  // ————————————————————————————————————————————— Cadre commun

  private render(): void {
    const tabs: Array<[Tab, string]> = [
      ['ride', t('ride')],
      ['garage', 'Garage'],
      ['progress', S('progress')],
      ['profile', t('profile')],
      ['friends', S('friends')],
      ['devices', t('devices')],
      ['settings', t('settings')],
    ];
    const p = loadProgress();
    // Vélo changé au garage : le parcours choisi doit être de son type
    if (this.s.mode !== 'free' && this.routeStore.index.length) this.checkRoute();
    // Liste des parcours, fiche, carte de la zone, défi KOM : il faut tous les tracés de la zone (montées, cartes).
    if ((this.picker && this.picker !== 'workouts' && this.picker !== 'zones') || this.s.mode === 'challenge') this.needAllRoutes();
    else if (this.routesFailed) {
      // Fenêtre refermée après un échec : la prochaine ouverture réessaie.
      this.allRoutesAsked = false;
      this.routesFailed = false;
    }
    const lp = levelProgress(p.xp);
    const level = this.account?.level ?? lp.level;
    const name = this.account?.name ?? this.s.name;
    const initials = name
      .split(/\s+/)
      .map((w) => w[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase();
    // Accueil : rien que la vidéo, le titre et le bouton Rouler, qui ouvre le menu. Le bouton n'apparaît qu'une fois le
    // garage chargé en mémoire (barre d'attente à sa place) : le garage et le tutoriel s'ouvrent alors sans attente.
    if (this.tab === 'home') {
      const wait = `<div class="mm-home-wait" role="status"><div class="world-wait-bar"><i></i></div><span>${S('loadingTheGarage')} <b class="mm-home-wait-pct">${this.garageProgress > 0 ? `${Math.round(this.garageProgress * 100)} %` : ''}</b></span></div>`;
      this.root.innerHTML = `<div class="mm mm-tab-home">
        <div class="mm-hero mm-hero-home"><h1>Allez <em>Robert</em> !</h1><p>${S('rideTogetherEachFrom')}</p></div>
        ${this.garageReady ? `<button class="mm-go mm-home-go" data-tab="ride">${t('ride')}</button>` : wait}
      </div>`;
      this.bind();
      return;
    }
    const body: Record<Tab, () => string> = {
      home: () => '',
      ride: () => this.rideHtml(),
      friends: () => this.friends.html(),
      garage: () => this.garageHtml(),
      devices: () =>
        `<section class="mm-panel mm-center mm-wide mm-xl">${this.closeBtn()}<header class="mm-head"><h2 class="ab-title">${t('devices')}</h2><p class="ab-sub">${S('pairYourTrainerAnd')}</p></header><div id="m-devices"></div><h3 class="ab-section set-title mm-trainer-title">${SET('trainerSettings')}</h3><div class="ab-tile ab-plain set-card mm-trainer-set">${this.trainerSettingsHtml()}</div><div id="m-devmodes" class="mm-devmodes"></div></section>`,
      progress: () => this.progress.html(this.closeBtn()),
      profile: () => this.profileHtml(),
      settings: () => this.settingsHtml(),
    };
    // Liste longue (vélos) : même panneau, même position de défilement après un nouveau rendu.
    const key = `${this.tab}/${this.garageSlot}/${this.bikeFilter}/${this.bikeType}`;
    const scroll = key === this.panelKey ? ((this.root.querySelector('.gr-body') ?? this.root.querySelector('.mm-side'))?.scrollTop ?? 0) : 0;
    this.panelKey = key;
    // Fenêtre des séances : même défilement après une étoile ; à l'ouverture, la séance choisie en vue.
    const wkKey = this.picker === 'workouts' ? `${this.wkFilter}|${this.wkDur}|${this.wkSort}|${this.wkQuery}` : null;
    const wkScroll = wkKey !== null && wkKey === this.wkScrollKey ? (this.root.querySelector('.mm-wks-grid')?.scrollTop ?? 0) : null;
    this.wkScrollKey = wkKey;
    // Arrivée dans le garage : le panneau glisse en place une seule fois (pas à chaque nouveau rendu).
    const enter = this.tab === 'garage' && !this.garageEntered;
    this.garageEntered = this.tab === 'garage';
    this.root.innerHTML = `<div class="mm mm-tab-${this.tab}${enter ? ' mm-enter' : ''}">
      <header class="mm-top">
        <nav class="mm-tabs">${tabs.map(([id, label]) => `<button class="mm-tab ${id === this.tab ? 'on' : ''}" data-tab="${id}">${esc(label)}${id === 'friends' ? this.friends.badgeHtml() : ''}</button>`).join('')}</nav>
        <div class="mm-right">
          ${this.musicInHero() ? '' : '<div class="mm-music" id="m-music"></div>'}
          <div class="mm-account">
            <div class="mm-idcard">
            <button type="button" class="mm-me-card mm-me" data-tab="profile" title="${S('myProfile')}">
              <span class="mm-avatar" style="background:${this.s.look.jersey}">${esc(initials || 'R')}</span>
              <span class="mm-who"><b>${esc(name)}</b><span class="mm-lvl"><em>${S('level')} ${level}</em><i class="mm-xp"><i style="width:${(lp.progress * 100).toFixed(0)}%"></i></i>${
                // Points d'XP vers le niveau suivant : seulement quand le niveau affiché est celui de la progression locale.
                lp.nextLevelXp !== null && level === lp.level ? `<small>${(p.xp - xpForLevel(lp.level)).toLocaleString(MX('locale'))} / ${(lp.nextLevelXp - xpForLevel(lp.level)).toLocaleString(MX('locale'))} XP</small>` : ''
              }</span></span>
            </button>
            <button type="button" class="mm-credits" title="${S('creditsOpenTheGarage')}">${COIN}<b>${(this.account?.credits ?? p.credits).toLocaleString(MX('locale'))}</b><small>${MX('credits')}</small></button>
            </div>
            ${this.account ? `<button type="button" class="mm-link" id="m-logout">${S('signOut')}</button>` : `<button type="button" class="ab-btn mm-signin" id="m-login">${S('signIn')}</button>`}
          </div>
          ${inDesktop ? `<button class="mm-quit" id="m-quit" title="${S('quitAllezRobert')}" aria-label="${S('quit')}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>` : ''}
        </div>
      </header>
      ${body[this.tab]()}
      <div id="m-friendbar"></div>
      <footer class="mm-foot">
        <div class="mm-status" id="m-status"></div>
        ${this.tab === 'ride' ? `<button id="m-start" class="mm-go">${t('ride')}</button>` : `<button class="mm-go ghost" data-tab="ride">← ${t('ride')}</button>`}
      </footer>
    </div>`;
    if (V3_STYLE) this.onV3Garage?.(this.root.querySelector('[data-v3-garage]'), this.root.querySelector('[data-v3-top]'));
    if (this.tab === 'devices') this.renderDevices();
    const side = this.root.querySelector('.gr-body') ?? this.root.querySelector('.mm-side');
    if (side) side.scrollTop = scroll;
    const wks = this.root.querySelector<HTMLElement>('.mm-wks-grid');
    const wkOn = wks?.querySelector<HTMLElement>('.mm-wk.on');
    if (wks) wks.scrollTop = wkScroll ?? (wkOn ? wkOn.offsetTop - (wks.clientHeight - wkOn.offsetHeight) / 2 : 0);
    // Recherche du studio : la frappe redessine l'écran, le champ garde le focus et la place du curseur.
    if (this.wkQueryCaret !== null) {
      const q = this.root.querySelector<HTMLInputElement>('#ws-q');
      if (q) {
        q.focus();
        q.setSelectionRange(this.wkQueryCaret, this.wkQueryCaret);
      }
      this.wkQueryCaret = null;
    }
    this.renderStatus();
    this.renderMusic();
    renderSoundSettings(this.root.querySelector('#m-sound-settings'));
    renderCompanionSettings(this.root.querySelector('#m-companion-settings'));
    renderStravaLink(this.root.querySelector('#m-strava-link'), !!this.account);
    renderStravaLink(this.root.querySelector('#m-strava-profile'), !!this.account, 'row');
    this.renderZonesSettings();
    renderExpertSettings(this.root.querySelector('#m-expert-settings'));
    // Rubriques repliables des Réglages : on retient celles qui sont ouvertes (l'écran est redessiné à chaque changement).
    // Catégories des Réglages : une seule visible, sans redessiner l'écran.
    for (const b of this.root.querySelectorAll<HTMLElement>('[data-setcat]')) {
      b.addEventListener('click', () => {
        const id = b.dataset.setcat ?? 'image';
        this.settingsCat = id;
        try {
          localStorage.setItem('ar.settingsCat', id);
        } catch {
          /* stockage indisponible : la catégorie reste en mémoire */
        }
        this.root.querySelectorAll<HTMLElement>('[data-setcat]').forEach((x) => {
          x.classList.toggle('on', x === b);
          x.setAttribute('aria-current', x === b ? 'true' : 'false');
        });
        this.root.querySelectorAll<HTMLElement>('[data-setpane]').forEach((x) => (x.hidden = x.dataset.setpane !== id));
      });
    }
    for (const d of this.root.querySelectorAll<HTMLDetailsElement>('details.set-sec, details.set-adv')) {
      d.addEventListener('toggle', () => {
        const id = d.dataset.sec ?? '';
        if (d.open) this.settingsOpen.add(id);
        else this.settingsOpen.delete(id);
        localStorage.setItem('ar.settingsOpen2', JSON.stringify([...this.settingsOpen]));
      });
    }
    this.bind();
    if (this.tab === 'progress') this.progress.bind();
    enhanceSelects(this.root);
    // Miniatures de vélos : le dessin d'avant remplace une photo manquante ; le vélo sans marque prend sa couleur.
    swapMissingThumbs(this.root, (colors, big) => bikeIcon(colors, big));
    void paintPlainThumbs(this.root, (cv) => (cv.outerHTML = bikeIcon([cv.dataset.plainthumb ?? '#7a8594'], cv.classList.contains('big'))));
    this.friends.mount(this.root, this.tab === 'friends');
    this.historyPanel.mount(this.tab === 'profile' && this.profileView === 'history' ? this.root.querySelector<HTMLElement>('#m-history') : null, { massKg: this.s.massKg, loggedIn: !!this.account });
    this.openWorldPanel.mount(this.root);
  }

  /** Pied de page : état des capteurs (cliquable vers l'onglet Capteurs). Les raccourcis sont dans le menu pause. */
  private renderStatus(): void {
    const box = this.root.querySelector('#m-status');
    if (!box) return;
    const real = this.devices.list().filter((d) => d.ok && !d.simulated);
    const sim = this.devices.simulatorOn() && !real.length;
    const chips = real.length
      ? real.map((d) => `<span class="mm-chip ok">${esc(d.name)}</span>`).join('')
      : sim
        ? `<span class="mm-chip sim">${S('simulatorNoHardware')}</span>`
        : `<span class="mm-chip warn">${S('noSensor')}</span>`;
    box.innerHTML = `<button class="mm-chips" title="${t('devices')}">${chips}</button>`;
    box.querySelector('.mm-chips')?.addEventListener('click', () => this.go('devices'));
  }

  // ————————————————————————————————————————————— Rouler

  private rideHtml(): string {
    const s = this.s;
    // Parcours choisi en cours de chargement : pas de carte d'un autre parcours en attendant.
    const r = this.routes.find((x) => x.id === s.routeId) ?? (this.routeAsked.has(s.routeId) ? undefined : this.routes[0]);
    // Roulage libre (choisi dans la fenêtre de la zone) : une sortie libre.
    const shown = s.mode === 'open' ? 'free' : s.mode;
    const line = MODE_LINES[getLang()];
    return `<section class="mm-panel mm-left">
      <header class="mm-head"><h2 class="ab-title">${S('whatDoYouWant')}</h2></header>
      <div class="mm-modes">${this.modes()
        .map(
          ([v, k]) =>
            `<button class="mm-mode ${v === shown ? 'on' : ''}" data-mode="${v}" aria-pressed="${v === shown}" style="--c:${MODE_COLORS[v] ?? '#ffd23f'}"><span class="mm-mode-ico">${ICON[v]}</span><b>${esc(t(k))}</b></button>`,
        )
        .join('')}</div>
      <p class="mm-hint">${s.mode === 'open' ? (S('freeRideToPick')) : esc(line[shown as Settings['mode']] ?? '')}</p>
      <div id="m-openworld" class="ow" hidden></div>
      <hr class="mm-sep" />
      ${this.weatherHtml()}
      ${
        s.mode === 'group' || s.mode === 'race'
          ? `<div class="mm-card">
              <h3 class="mm-card-t">${S('joinARide')}</h3>
              <p class="mm-card-d">${S('gotACodeFrom')}</p>
              <input id="m-invite" class="mm-input" placeholder="${S('inviteCode')}" />
            </div>
            <div class="mm-card mm-groupopts">
              <h3 class="mm-card-t">${s.mode === 'race' ? (S('orCreateYourRace')) : S('orCreateYourRide')}</h3>
              <p class="mm-card-d">${S('theseSettingsYourTime')}</p>
              ${
                // Course sur une boucle : nombre de tours (créateur de la course).
                s.mode === 'race' && r?.loop
                  ? `<div class="mm-opt"><div class="mm-opt-l"><b>${S('laps')}</b><small>${S('theRaceEndsAfter')}</small></div>${this.stepper('m-laps', 1, 20, s.raceLaps)}</div>`
                  : ''
              }
              <div class="mm-opt"><div class="mm-opt-l"><b>${S('aiRiders')}</b><small>${S('eachHasItsOwn')}</small></div>${this.stepper('m-ai', 0, 19, s.aiRiders)}</div>
              ${
                s.mode === 'race'
                  ? `<div class="mm-opt mm-opt-col"><div class="mm-opt-l"><b>${S('aiLevel')}</b><small>${S('theirPowerAsA')}</small></div>${this.aiLevelSeg()}</div>`
                  : `<div class="mm-opt mm-opt-col"><div class="mm-opt-l"><b>${S('targetAverageSpeed')}</b><small>${S('aiRidersPaceThemselves')}</small></div>${this.seg('m-target', String(s.groupTargetKmh), [
                      ['0', S('free')],
                      ...[22, 25, 28, 30, 32, 35].map((v): [string, string] => [String(v), `${v} km/h`]),
                    ])}</div>`
              }
              <div class="mm-opt mm-opt-col"><div class="mm-opt-l"><b>${S('bikes')}</b><small>${S('theSameBikeFor')}</small></div>${this.seg('m-equal', (s.equalEquipment ?? s.mode === 'race') ? '1' : '0', [
                ['1', S('sameBikeForAll')],
                ['0', S('eachTheirOwn')],
              ])}</div>
            </div>`
          : s.mode === 'challenge'
            ? this.challengeChoiceHtml(r)
          : s.mode === 'workout'
            ? this.workoutChoiceHtml()
            : ''
      }
      ${
        s.mode === 'ftpTest'
          ? this.ftpTestHtml()
          : s.mode === 'challenge'
            ? ''
            : `<h3 class="ab-section mm-where">${S('whereToRide')}</h3>${this.pickersHtml(r)}`
      }
    </section>
    <div class="mm-hero">${this.musicInHero() ? '<div class="mm-music mm-hero-music" id="m-music"></div>' : ''}<h1>Allez <em>Robert</em> !</h1><p>${S('rideTogetherEachFrom')}</p></div>
    ${this.pickerHtml()}`;
  }

  /** Liste déroulante des nationalités, drapeau devant chaque pays (le <select> du navigateur n'affiche pas d'images). */
  private nationHtml(): string {
    const cur = COUNTRIES.find((c) => c.code === this.s.look.nationality);
    const item = (code: string, label: string) => `<button type="button" role="option" class="mm-dd-opt${code === (cur?.code ?? '') ? ' on' : ''}" data-nation="${code}">${code ? flagSvg(code, 15) : '<i class="mm-dd-none"></i>'}<span>${esc(label)}</span></button>`;
    return `<div class="mm-dd" id="m-nation"><button type="button" class="mm-dd-btn" aria-haspopup="listbox">${cur ? flagSvg(cur.code, 15) : '<i class="mm-dd-none"></i>'}<span>${esc(cur ? cur[getLang()] : S('chooseMyCountry'))}</span><em>▾</em></button><div class="mm-dd-list" role="listbox" hidden>${item('', S('none'))}${COUNTRIES.map((c) => item(c.code, c[getLang()])).join('')}</div></div>`;
  }

  /** Lecteur au-dessus du titre (onglet Rouler, écran large) ; sinon dans la barre du haut (petits écrans, autres onglets). */
  private musicInHero(): boolean {
    // Le lecteur reste dans la barre du haut (jamais au-dessus du titre) ; seul l'accueil, sans barre, le pose en coin.
    return false;
  }

  /** Séance choisie (carte seule, un clic rouvre la liste au milieu de l'écran) ou fichier importé. */
  private workoutChoiceHtml(): string {
    const w = WORKOUT_LIBRARY.find((x) => x.id === this.s.workoutPreset) ?? WORKOUT_LIBRARY[0];
    const current = this.workoutFile
      ? `<button class="mm-wk on" data-picker="workouts" style="--wk:#9aa5b1"><span class="mm-wk-head"><b>${esc(this.workoutFile.name.replace(/\.json$/i, ''))}</b></span><span class="mm-wk-desc">${S('myWorkout')}</span></button>`
      : w
        ? workoutCard(w, true, 'workouts')
        : '';
    return `<div class="mm-wks">${current}</div>
      <button class="ab-btn mm-change" data-picker="workouts">${S('changeWorkout')}</button>`;
  }

  /** Fenêtre « Séances » au milieu de l'écran, comme la carte de France : séances intégrées et import de fichier. */
  private workoutsHtml(): string {
    const L = fr();
    return `<div class="mm-modal mm-picker-modal" data-picker-close>
      <div class="mm-dialog mm-picker wk-dialog ws" role="dialog" aria-modal="true">
        <header><div class="pk-head"><h2 class="ab-title">${S('chooseYourWorkout')}</h2><p class="ab-sub">${S('workoutPickSub')}</p></div><label class="ab-btn ws-import" title=".zwo / .erg / .mrc">${S('orImportAWorkout')}<input id="m-workout" type="file" accept=".zwo,.erg,.mrc" hidden /><span id="m-wname">${this.workoutFile ? esc(this.workoutFile.name) : ''}</span></label><button class="mm-x" data-picker-close aria-label="${S('close')}">×</button></header>
        ${workoutStudioHtml({
          fr: L,
          filter: this.wkFilter,
          types: WORKOUT_TYPES,
          library: WORKOUT_LIBRARY,
          mine: this.myWorkouts.map((w) => storedAsLibrary(w)),
          favs: this.favWorkouts,
          current: this.workoutFile ? undefined : this.s.workoutPreset,
          selected: this.wkSel ?? undefined,
          ftp: this.s.ftpWatts,
          typeColors: TYPE_COLORS,
          typeLabels: WORKOUT_TYPE_LABELS,
          zoneColor: zoneColorOf,
          query: this.wkQuery,
          dur: this.wkDur,
          sort: this.wkSort,
          intensity: clampWorkoutIntensity(this.s.workoutIntensity),
        })}
      </div></div>`;
  }

  /** Test FTP : choix du protocole (rampe, rampe douce, 20 min) et son déroulé (pas de choix de zone ni de parcours). */
  private ftpTestHtml(): string {
    const L = fr();
    const p = ftpTestProtocolOf(this.s.ftpTestProtocol);
    const ramp = (warm: string, start: number, inc: number, dur: string): string[][] =>
      L
        ? [
            ['Échauffement', `${warm}, mode ERG : le home trainer impose la puissance.`],
            ['Paliers', `${start} W puis +${inc} W chaque minute. Reste assis, cadence régulière (70–100 tr/min).`],
            ['Jusqu’au bout', `Le test s’arrête tout seul quand tu ne tiens plus le palier pendant 15 s (souvent ${dur}).`],
            ['Résultat', 'FTP = 75 % de ta meilleure minute, estimée en direct. Tu choisis à la fin de la garder ou non.'],
          ]
        : [
            ['Warm-up', `${warm} in ERG mode: the trainer sets the power.`],
            ['Steps', `${start} W then +${inc} W every minute. Stay seated, steady cadence (70–100 rpm).`],
            ['To the end', `The test stops by itself when you can no longer hold the step for 15 s (often ${dur}).`],
            ['Result', 'FTP = 75% of your best minute, estimated live. At the end you choose whether to keep it.'],
          ];
    const steps =
      p === 'ftp20'
        ? L
          ? [
              ['Échauffement', '20 min progressives, trois accélérations de 20 s, 5 min soutenues, 10 min faciles.'],
              ['20 minutes', 'Effort libre au maximum que tu peux tenir : pars prudemment, finis fort. Moyenne affichée en direct.'],
              ['Retour au calme', '10 min faciles. Durée totale : environ 1 h 10.'],
              ['Résultat', 'FTP = 95 % de ta moyenne sur 20 min. Tu choisis à la fin de la garder ou non.'],
            ]
          : [
              ['Warm-up', '20 progressive minutes, three 20 s efforts, 5 min hard, 10 min easy.'],
              ['20 minutes', 'Free effort at the most you can hold: start carefully, finish strong. Live average shown.'],
              ['Cool-down', '10 easy minutes. Total about 1 h 10.'],
              ['Result', 'FTP = 95% of your 20-minute average. At the end you choose whether to keep it.'],
            ]
        : p === 'rampLite'
          ? ramp(S('t8MinFrom50'), 50, 10, S('t1530Min'))
          : ramp(S('t5MinAt100'), 100, 20, S('t1020Min'));
    const opts: Array<[string, string]> = [
      ['ramp', S('ramp')],
      ['rampLite', S('gentleRamp')],
      ['ftp20', S('t20MinTest')],
    ];
    const who =
      p === 'ftp20'
        ? L
          ? 'Le plus précis si tu sais doser un effort long ; le plus éprouvant.'
          : 'Most accurate if you can pace a long effort; the hardest.'
        : p === 'rampLite'
          ? L
            ? 'Pour débuter ou pour les coureurs légers : la puissance monte plus doucement.'
            : 'For beginners or lighter riders: power rises more gently.'
          : L
            ? 'Court et sans calcul d’allure : le plus simple pour la plupart des coureurs.'
            : 'Short and no pacing needed: the simplest for most riders.';
    return `<div class="mm-card mm-ftptest">
      <div class="mm-opt mm-opt-col mm-opt-first"><div class="mm-opt-l"><b>${S('protocol')}</b><small>${who}</small></div>${this.seg('m-ftpproto', p, opts)}</div>
      ${ftpTestChartHtml(p, this.s.ftpWatts, L)}
      <div class="mm-opt"><div class="mm-opt-l"><b>${S('coachVoice')}</b><small>${S('announcesTheStepsAnd')}</small></div>${this.seg('m-ftpvoice', this.s.ftpCoachVoice === false ? '0' : '1', [
        ['1', S('on')],
        ['0', S('off2')],
      ])}</div>
      <details class="mm-more"><summary>${S('howTheTestWorks')}</summary>
        <ol>${steps.map(([t, d]) => `<li><b>${t}</b><span>${d}</span></li>`).join('')}</ol>
      </details>
      <p class="mm-hint">${MX('ftpNow').replace('{w}', String(Math.round(this.s.ftpWatts)))}</p>
    </div>`;
  }

  /** Parcours dessiné, s'il est le parcours choisi (et pas en roulage libre). */
  private get drawnChoice(): RouteData | null {
    return this.s.mode !== 'open' && this.drawn && this.drawn.id === this.s.routeId ? this.drawn : null;
  }

  /**
   * Un bouton (carte de France → zone → parcours, libre ou à dessiner), puis la carte de ce qui est
   * choisi : tracé du parcours (sur les routes de la zone si elle est ouverte) ou départ du libre.
   */
  private pickersHtml(r: RouteData | undefined): string {
    const L = fr();
    const lang = getLang();
    const w = WORLD_LIST.find((x) => x.id === this.worldId);
    const zone = w ? w.name[lang] : (ZONE_SPOTS.find((x) => x.id === this.worldId)?.name[lang] ?? this.worldId);
    const free = this.s.mode === 'open';
    const drawn = this.drawnChoice;
    const route = free ? null : (drawn ?? r ?? null);
    const what = free ? (S('freeRide')) : drawn ? (S('drawnRoute')) : route ? this.routeName(route) : '';
    const stats = route
      ? `${this.km(route.lengthM)} km · ${Math.round(route.elevationGainM)} m D+${route.loop ? (S('loop')) : ''}`
      : free
        ? L
          ? 'Choisis ta route à chaque carrefour'
          : 'Pick your road at each junction'
        : '';
    // Entraînement : pas de carte (la séance compte, pas le paysage) ; sinon seulement après un choix.
    const map = this.openWorld && this.selMap && this.s.mode !== 'workout' ? this.planner.preview(route, free ? this.freeStart : null) : '';
    const body = map ? `<div class="mm-selmap">${map}</div>` : route ? this.routeCard(route) : '';
    const pickers = `<div class="mm-pickers mm-pickers-one">
      <button class="mm-pick mm-pick-big ab-btn" data-picker="zones"><b>${what ? (S('changeRide')) : S('chooseMyRide')}</b></button>
    </div>`;
    // Sans carte de la zone, la fiche du parcours porte déjà son nom et ses chiffres.
    const head = map || !route ? `<b>${esc(what)}</b><span>${esc(stats)}</span>` : '';
    return `${what ? `<button class="mm-sel" data-picker="zone" title="${S('changeRoute')}"><span class="mm-sel-head"><small>${esc(zone)}</small>${head}</span>${body}</button>` : ''}
    ${pickers}`;
  }

  /** Fenêtre centrée : liste des zones (avec leurs packs) ou des parcours de la zone. */
  private pickerHtml(): string {
    if (!this.picker) return '';
    // Zone ouverte choisie : sa carte, où l'on trace son itinéraire (ou roulage libre).
    if (this.picker === 'map') {
      const w = WORLD_LIST.find((x) => x.id === this.worldId);
      return `<div class="mm-modal mm-picker-modal" data-picker-close>
      <div class="mm-dialog mm-picker" role="dialog" aria-modal="true">
        <header><h2>${esc(w ? w.name[getLang()] : this.worldId)}</h2><span class="rp-head-links"><button class="mm-link" data-picker="zone">← ${S('areaChoices')}</button></span><button class="mm-x" data-picker-close aria-label="${S('close')}">×</button></header>
        ${this.planner.html((r) => this.routeCard(r))}
      </div></div>`;
    }
    if (this.picker === 'zones') return this.franceHtml();
    if (this.picker === 'workouts') return this.workoutsHtml();
    if (this.picker === 'koms') return this.komsHtml();
    if (this.picker === 'route') return this.routeDetailWindow();
    if (this.picker === 'zone') return this.zoneHtml();
    // Parcours fixés de la zone : un bloc par parcours (un clic le choisit, « Fiche » ouvre ses détails),
    // tri simple en tête, avec retour aux choix de la zone.
    const w = WORLD_LIST.find((x) => x.id === this.worldId);
    const sorted = [...this.routes];
    if (this.routeSort === 'dist') sorted.sort((x, y) => x.lengthM - y.lengthM);
    else if (this.routeSort === 'climb') sorted.sort((x, y) => x.elevationGainM - y.elevationGainM);
    const waiting = !this.routeStore.complete && !this.routesFailed;
    const ghosts = waiting ? Array.from({ length: Math.max(0, Math.min(3, this.routeIds.length - sorted.length)) }, () => `<div class="rpk rpk-ghost" aria-hidden="true"></div>`).join('') : '';
    const list = `<div class="rpk-bar"><span class="rpk-count">${count(sorted.length, 'route1', 'routeN')}${waiting ? ` · ${S('loadingTheOthers')}` : ''}</span>${this.seg('m-routesort', this.routeSort, [
      ['default', S('areaOrder')],
      ['dist', S('byDistance')],
      ['climb', S('byClimbing')],
    ])}</div>
      <div class="mm-cardgrid">${sorted
        .map((x) => {
          const on = x.id === this.s.routeId;
          const tag = `${x.loop ? (S('loop2')) : S('oneWay')}${on ? ` · ${S('selected2')}${this.s.reverse ? (S('reversed')) : ''}${this.s.startM > 0 ? (S('movedStart')) : ''}` : ''}`;
          return `<div class="mm-routepick rpk ${on ? 'on' : ''}" role="button" tabindex="0" data-routepick="${esc(x.id)}" aria-pressed="${on}">
            ${this.routeCard(x)}
            <span class="mm-routetag">${tag}</span>
            <span class="rpk-foot">${on ? `<span class="ab-state is-ok"><i></i>${S('selectedRoute')}</span>` : '<span></span>'}<button type="button" class="ab-btn ab-chip rpk-open" data-route="${esc(x.id)}">${S('details')}</button></span></div>`;
        })
        .join('')}${ghosts}</div>${
        this.routesFailed && !this.routeStore.complete
          ? `<p class="mm-hint rpk-fail">${S('someRoutesCouldNot')}</p>`
          : ''
      }
        ${this.onExplore ? `<button id="m-explore" class="mm-explore">${ICON.explore}<span><b>${S('exploreTheMap')}</b><small>${S('freeCameraNoRiding')}</small></span></button>` : ''}`;
    return `<div class="mm-modal mm-picker-modal" data-picker-close>
      <div class="mm-dialog mm-picker pk" role="dialog" aria-modal="true">
        <header><div class="pk-head"><h2 class="ab-title">${S('routes')}${w ? ` · ${esc(w.name[getLang()])}` : ''}</h2><p class="ab-sub">${S('oneClickSelectsThe')}</p></div><span class="rp-head-links"><button class="mm-link" data-picker="zone">← ${S('areaChoices')}</button></span><button class="mm-x" data-picker-close aria-label="${S('close')}">×</button></header>
        ${list}
      </div></div>`;
  }

  /** Fiche d'un parcours : carte, profil, montées, records (les temps du serveur arrivent ensuite). */
  private routeDetailWindow(): string {
    const base = this.routes.find((x) => x.id === this.detailId);
    if (!base) return '';
    const r = this.detailRoute(base);
    const chosen = base.id === this.s.routeId && this.s.reverse === this.detailReverse && (this.s.startM || 0) === this.detailStartM;
    const dir = canReverse(base)
      ? this.seg('rd-dir', this.detailReverse ? '1' : '0', [
          ['0', S('normal')],
          ['1', S('reversed2')],
        ])
      : '';
    return `<div class="mm-modal mm-picker-modal" data-picker-close>
      <div class="mm-dialog mm-picker rd-dialog" role="dialog" aria-modal="true">
        <header><h2>${esc(this.routeName(base))}</h2><span class="rd-head-tag">${r.loop ? (S('loop2')) : S('oneWay')}</span>${dir}<span class="rp-head-links"><button class="mm-link" data-picker="routes">← ${S('routes')}</button>${chosen ? '' : `<button class="mm-link" data-rd="pick">${S('selectWithoutRiding')}</button>`}</span><button class="mm-x" data-picker-close aria-label="${S('close')}">×</button></header>
        ${routeDetailHtml(r, this.routeName(r), { loggedIn: !!this.account, start: { movable: canMoveStart(this.detailDir(base)), startM: this.detailStartM } })}
      </div></div>`;
  }

  /** Parcours de la fiche dans le sens choisi (records et montées de ce sens). */
  private detailDir(base: RouteData): RouteData {
    return this.detailReverse && canReverse(base) ? reversedOf(base) : base;
  }

  /** Parcours de la fiche dans le sens choisi, depuis le départ choisi (distances, profil, villages, montées). */
  private detailRoute(base: RouteData): RouteData {
    return startedOf(this.detailDir(base), this.detailStartM);
  }

  /**
   * Ouverture d'une fenêtre : la fiche d'un parcours grandit depuis la carte cliquée, les autres
   * fenêtres apparaissent en fondu ; rien ne bouge quand la même fenêtre est seulement redessinée.
   */
  private animatePicker(): void {
    const key = this.picker ? `${this.picker}:${this.picker === 'route' ? this.detailId : ''}` : null;
    if (key === this.shownPicker) return;
    this.shownPicker = key;
    const dlg = this.root.querySelector<HTMLElement>('.mm-picker');
    if (!dlg) return;
    const from = this.fromRect;
    this.fromRect = null;
    if (this.picker === 'route' && from && dlg.animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const to = dlg.getBoundingClientRect();
      const dx = from.left + from.width / 2 - (to.left + to.width / 2);
      const dy = from.top + from.height / 2 - (to.top + to.height / 2);
      dlg.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) scale(${from.width / to.width}, ${from.height / to.height})`, opacity: 0.4, borderRadius: '24px' },
          { transform: 'none', opacity: 1 },
        ],
        { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      );
      return;
    }
    dlg.classList.add('mm-anim-in');
  }

  private closePicker(): void {
    this.picker = null;
    this.franceMap.clearSearch();
    this.render();
  }

  /** Montées chronométrées de la zone affichée (toutes ses routes, une fois chacune, celle du parcours choisi d'abord). */
  private zoneClimbs(r: RouteData | undefined): Array<{ route: RouteData; k: RouteSegment }> {
    const ordered = r ? [r, ...this.routes.filter((x) => x.id !== r.id)] : this.routes;
    const seen = new Set<string>();
    const koms: Array<{ route: RouteData; k: RouteSegment }> = [];
    for (const route of ordered)
      for (const k of route.segments)
        if (k.kind === 'kom' && !seen.has(k.name)) {
          seen.add(k.name);
          koms.push({ route, k });
        }
    return koms;
  }

  /** Panneau de gauche du mode Défi KOM : la montée choisie et son record, un clic rouvre le tableau. */
  private challengeChoiceHtml(r: RouteData | undefined): string {
    const koms = this.zoneClimbs(r);
    if (!koms.length) return `<p class="mm-hint">${S('noTimedClimbIn')}</p><button class="ab-btn mm-change" data-picker="koms">${S('seeAllClimbs')}</button>`;
    const cur = koms.find((c) => c.k.id === this.s.challengeSeg && c.route.id === this.s.routeId) ?? (koms[0] as (typeof koms)[number]);
    this.s.challengeSeg = cur.k.id;
    const rec = readKomRecord(cur.route.id, cur.k.id);
    const t = rec ? `${Math.floor(rec.timeS / 60)}:${String(Math.round(rec.timeS % 60)).padStart(2, '0')}` : S('noRecordYet');
    return `<button class="ab-tile is-on mm-kom" data-picker="koms" title="${S('changeClimb')}"><span class="ab-ico sm">${ICON.challenge}</span><b class="ab-name">${esc(cur.k.name)}</b><span class="ab-detail">${S('best')} : ${t}</span>
        <span class="mm-kom-vals"><span class="ab-val"><b>${this.km(cur.k.endM - cur.k.startM)}</b><small>km</small></span><span class="ab-val"><b>${dec(cur.k.avgGrade)}</b><small>%</small></span></span></button>
      <button class="ab-btn mm-change" data-picker="koms">${S('changeClimb')}</button>`;
  }

  /** Fenêtre centrale « Défi KOM » : tableau des montées et de tes records, filtre par zone. */
  private komsHtml(): string {
    const lang = getLang();
    // Zones connues : celle affichée (toujours à jour) et celles déjà visitées.
    this.indexClimbs();
    const index = this.komIndex();
    const zoneIds = Object.keys(index).sort((a, b) => (a === this.worldId ? -1 : b === this.worldId ? 1 : this.zoneLabel(a).localeCompare(this.zoneLabel(b), lang)));
    const filter = this.komZone && index[this.komZone] ? this.komZone : '';
    const rows = zoneIds
      .filter((z) => !filter || z === filter)
      .flatMap((z) => (index[z] ?? []).map((c) => ({ zone: z, ...c, rec: readKomRecord(c.routeId, c.segId) })));
    // Tri choisi par un clic sur un titre de colonne (sans record : toujours en fin de liste pour « Mon record »).
    const sort = this.komSort;
    if (sort) {
      const key = (c: (typeof rows)[number]): number | string =>
        sort.key === 'length' ? c.lengthM : sort.key === 'grade' ? c.grade : sort.key === 'best' ? (c.rec ? c.rec.timeS : Infinity) : c.name.toLocaleLowerCase(lang);
      rows.sort((a, b) => {
        const ka = key(a);
        const kb = key(b);
        if (sort.key === 'best' && (ka === Infinity || kb === Infinity)) return ka === kb ? 0 : ka === Infinity ? 1 : -1;
        return (typeof ka === 'string' ? ka.localeCompare(kb as string, lang) : (ka as number) - (kb as number)) * sort.dir;
      });
    }
    const head = (key: 'name' | 'length' | 'grade' | 'best', label: string) => {
      const on = sort?.key === key;
      const arrow = on ? (sort.dir === 1 ? ' ▲' : ' ▼') : '';
      return `<button type="button" class="kom-sort${on ? ' on' : ''}" data-komsort="${key}" aria-sort="${on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}">${label}${arrow}</button>`;
    };
    const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
    const chips = [['', S('allAreas')] as const, ...zoneIds.map((z) => [z, this.zoneLabel(z)] as const)]
      .map(([z, label]) => `<button class="kom-chip${z === filter ? ' on' : ''}" data-komzone="${esc(z)}">${esc(label)}</button>`)
      .join('');
    const body = rows.length
      ? rows
          .map((c) => {
            const on = c.routeId === this.s.routeId && c.segId === this.s.challengeSeg && this.s.mode === 'challenge';
            const date = c.rec ? new Date(c.rec.date).toLocaleDateString(MX('locale'), { day: 'numeric', month: 'short', year: 'numeric' }) : '';
            const hay = `${c.name} ${c.routeName} ${this.zoneLabel(c.zone)}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
            // Une ligne par montée (liste plus lisible qu'une grille de blocs) : colonnes alignées sur l'en-tête.
            return `<button type="button" class="kom-tile kom-row${on ? ' is-on' : ''}" role="listitem" data-kom="${esc(c.segId)}" data-kom-route="${esc(c.routeId)}" data-kom-zone="${esc(c.zone)}" data-search="${esc(hay)}">
              <span class="kr-main"><b>${esc(c.name)}</b><small>${esc(c.routeName)} · ${esc(this.zoneLabel(c.zone))}</small></span>
              <span class="kr-num"><b>${this.km(c.lengthM)}</b><small>km</small></span>
              <span class="kr-num"><b>${dec(c.grade)}</b><small>%</small></span>
              <span class="kr-best">${c.rec ? `<b>${fmt(c.rec.timeS)}</b><small>${date}</small>` : `<small>${S('noRecordYet')}</small>`}</span>
              <span class="ab-act${on ? ' quiet' : ''}">${on ? (S('selected')) : S('challenge')}</span>
            </button>`;
          })
          .join('')
      : `<p class="kom-empty">${S('noTimedClimbKnown')}</p>`;
    const records = rows.filter((c) => c.rec).length;
    return `<div class="mm-modal mm-picker-modal" data-picker-close>
      <div class="mm-dialog mm-picker kom-dialog pk" role="dialog" aria-modal="true">
        <header><div class="pk-head"><h2 class="ab-title">${S('komChallenge')}</h2><p class="ab-sub">${S('flyingStartGhostOf')}</p></div><button class="mm-x" data-picker-close aria-label="${S('close')}">×</button></header>
        <input class="kom-search" id="m-kom-q" type="search" autocomplete="off" value="${esc(this.komQuery)}" placeholder="${S('searchAClimbA')}" aria-label="${S('searchAClimb')}" />
        <div class="kom-filter" role="group" aria-label="${S('filterByArea')}">${chips}</div>
        <div class="kom-wrap"><div class="kom-list" role="list"><div class="kom-head">${head('name', S('colClimb'))}${head('length', S('colLength'))}${head('grade', S('colGrade'))}${head('best', S('colBest'))}<span></span></div>${body}</div></div>
        <div class="kom-foot"><span>${count(rows.length, 'climb1', 'climbN')} · ${count(records, 'record1', 'recordN')}</span><span>${S('aZoneSClimbs')}</span></div>
      </div></div>`;
  }

  /**
   * Mode défi : toutes les montées chronométrées de la zone (tous ses parcours, une fois chacune,
   * celles du parcours choisi d'abord), avec le record de chacune ; en choisir une prend son parcours.
   */
  private challengeHtml(r: RouteData | undefined, onlySelected = false): string {
    const ordered = r ? [r, ...this.routes.filter((x) => x.id !== r.id)] : this.routes;
    const seen = new Set<string>();
    const koms: Array<{ route: RouteData; k: RouteSegment }> = [];
    for (const route of ordered)
      for (const k of route.segments)
        if (k.kind === 'kom' && !seen.has(k.name)) {
          seen.add(k.name);
          koms.push({ route, k });
        }
    if (!koms.length) return `<p class="mm-hint">${S('noTimedClimbIn2')}</p>`;
    const cur = r?.id;
    if (!koms.some((c) => c.route.id === cur && c.k.id === this.s.challengeSeg)) this.s.challengeSeg = (koms[0] as (typeof koms)[number]).k.id;
    // panneau de gauche : la côte choisie seulement (la liste complète est dans la fenêtre de la zone)
    const shown = onlySelected ? koms.filter((c) => c.route.id === cur && c.k.id === this.s.challengeSeg) : koms;
    return `<div class="mm-routes mm-presets">${shown
      .map(({ route, k }) => {
        const rec = readKomRecord(route.id, k.id);
        const t = rec ? `${Math.floor(rec.timeS / 60)}:${String(Math.round(rec.timeS % 60)).padStart(2, '0')}` : S('noRecordYet');
        const on = route.id === cur && k.id === this.s.challengeSeg;
        return `<button class="mm-route ab-tile ab-plain ${on ? 'on is-on' : ''}" data-kom="${esc(k.id)}" data-kom-route="${esc(route.id)}"><b class="ab-name">${esc(k.name)}</b><span class="ab-detail">${this.km(k.endM - k.startM)} km · ${dec(k.avgGrade)} % · ${S('best2')} ${t}</span></button>`;
      })
      .join('')}</div>`;
  }

  /**
   * Zones de la carte de France : une par point de ZONE_SPOTS (mondes du menu et mondes à venir).
   * Publiée = présente dans le catalogue `worlds/index.json` (sans catalogue : celles de WORLD_LIST).
   */
  private mapZones(): MapZone[] {
    const lang = getLang();
    return ZONE_SPOTS.map((spot) => {
      const w = WORLD_LIST.find((x) => x.id === spot.id);
      const z = this.zones.find((c) => c.id === spot.id);
      const available = this.zones.length ? !!z : !!w;
      const n = z ? routesForBike(z.routes, bikeSetupFor(loadProgress().equipped).tyre).length : 0;
      const info = [n ? count(n, 'route1', 'routeN') : '', spot.open ? (S('openWorld')) : '', w ? w.hint[lang] : ''].filter(Boolean).join(' · ');
            return { id: spot.id, name: w ? w.name[lang] : spot.name[lang], region: spot.region[lang], x: spot.x, y: spot.y, available, current: spot.id === this.worldId, info, ...(z?.l93 ? { rect: z.l93 } : {}), ...(spot.image ? { image: spot.image } : {}) };
    });
  }

  /**
   * Pack de cartes d'une zone (catalogue `worlds/index.json`) : télécharger (taille), progression,
   * téléchargée / supprimer, mettre à jour. Sans pack, la zone se charge quand même depuis le
   * serveur, au fil de la sortie.
   */
  private packAction(id: string): string {
    const L = fr();
    const z = this.zones.find((c) => c.id === id);
    const st = packState(id, z?.pack?.version);
    const dl = this.downloads.get(id);
    if (dl && !dl.error) {
      const pct = Math.floor((dl.done / Math.max(dl.total, 1)) * 100);
      return `<span class="mm-pack busy"><i class="mm-pack-bar"><i style="width:${pct}%"></i></i>${pct} %</span>`;
    }
    if (dl?.error) return `<button class="mm-pack err" data-pack="${esc(id)}" title="${esc(dl.error)}">${S('retry')}</button>`;
    if (st.kind === 'installed' && st.upToDate) return `<span class="mm-pack ok">${S('downloaded')} ✓</span>`;
    if (st.kind === 'installed') return `<button class="mm-pack" data-pack="${esc(id)}">${S('update')}${z?.pack ? ` · ${formatBytes(z.pack.gzBytes ?? z.pack.bytes, L)}` : ''}</button>`;
    if (st.kind === 'absent' && z?.pack) return `<button class="mm-pack" data-pack="${esc(id)}">↓ ${formatBytes(z.pack.gzBytes ?? z.pack.bytes, L)}</button>`;
    return '';
  }

  /** État du pack d'une zone, en un mot avec sa classe de pastille (liste des zones du choix de sortie). */
  private zonePackState(id: string): { cls: string; text: string; rank: number } {
    const L = fr();
    const z = this.zones.find((c) => c.id === id);
    const st = packState(id, z?.pack?.version);
    const dl = this.downloads.get(id);
    const size = z?.pack ? formatBytes(z.pack.gzBytes ?? z.pack.bytes, L) : '';
    if (dl && !dl.error) return { cls: 'is-warn', text: `${S('downloading')} ${Math.floor((dl.done / Math.max(dl.total, 1)) * 100)} %`, rank: 0 };
    if (st.kind === 'installed' && st.upToDate) return { cls: 'is-ok', text: S('downloaded'), rank: 1 };
    if (st.kind === 'installed') return { cls: 'is-warn', text: S('updateAvailable'), rank: 1 };
    if (z?.pack) return { cls: '', text: `${S('toDownload')}${size ? ` · ${size}` : ''}`, rank: 2 };
    return { cls: 'is-info', text: S('loadedWhileRiding'), rank: 2 };
  }

  /** Fenêtre « Zones » : carte de France à gauche, les zones en gros blocs à droite (recherche par nom). */
  private franceHtml(): string {
    const lang = getLang();
    const fold = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const zones = this.mapZones()
      .map((z) => ({ z, st: z.available ? this.zonePackState(z.id) : { cls: '', text: S('comingSoon'), rank: 9 } }))
      // Zone en cours d'abord, puis celles qui se téléchargent ou sont déjà sur l'appareil, puis les autres par nom.
      .sort((a, b) => Number(b.z.current) - Number(a.z.current) || a.st.rank - b.st.rank || a.z.name.localeCompare(b.z.name, lang));
    const blocks = zones
      .map(({ z, st }) => {
        const detail = [z.region, z.info].filter(Boolean).join(' · ');
        const ico = z.image ? `<img src="${esc(z.image)}" alt="" loading="lazy" />` : ICON.free;
        return `<button type="button" class="ab-tile zp-tile${z.current ? ' is-on' : ''}${st.cls ? ` ${st.cls}` : ''}" data-zonepick="${esc(z.id)}" data-search="${esc(fold(`${z.name} ${z.region}`))}"${z.available ? '' : ' disabled'}>
          <span class="ab-ico sm">${ico}</span>
          <span class="ab-name">${esc(z.name)}</span>
          <span class="ab-detail">${esc(detail)}</span>
          <span class="ab-state"><i></i>${esc(st.text)}</span>
          ${z.current ? `<span class="ab-act quiet">${S('currentArea')}</span>` : ''}
        </button>`;
      })
      .join('');
    return `<div class="mm-modal mm-picker-modal" data-picker-close>
      <div class="mm-dialog mm-picker fm-dialog pk" role="dialog" aria-modal="true">
        <header><div class="pk-head"><h2 class="ab-title">${S('whereDoYouWant')}</h2><p class="ab-sub mm-hint">${this.loadingZone ? `${S('loading')} ${esc(this.loadingZone)}…` : S('pickAnAreaOn')}</p></div><button class="mm-x" data-picker-close aria-label="${S('close')}">×</button></header>
        <div class="zp-layout">
          <div class="zp-map">${this.franceMap.html(this.mapZones())}</div>
        </div>
      </div></div>`;
  }

  /** Fenêtre d'une zone : parcours fixés, parcours libre, parcours à dessiner (ces deux-là : zones ouvertes). */
  private zoneHtml(): string {
    const L = fr();
    const lang = getLang();
    const w = WORLD_LIST.find((x) => x.id === this.worldId);
    const spot = ZONE_SPOTS.find((x) => x.id === this.worldId);
    const n = this.routeIds.length;
    const openOnly = S('onlyInOpenAreas');
    const fixedOnly = S('notInARace');
    const tileBody = (icon: string, title: string, text: string) => `<span class="ab-ico">${icon}</span><span class="ab-name">${title}</span><span class="ab-detail">${text}</span>`;
    const card = (id: string, icon: string, title: string, text: string) =>
      id === 'free' && this.s.mode === 'race'
        ? `<button class="zc-choice zc-off ab-tile" disabled>${tileBody(icon, title, fixedOnly)}</button>`
        : id !== 'routes' && !this.openWorld
        ? `<button class="zc-choice zc-off ab-tile" disabled>${tileBody(icon, title, openOnly)}</button>`
        : `<button class="zc-choice ab-tile" data-zc="${id}">${tileBody(icon, title, text)}</button>`;
    const pack = this.packAction(this.worldId);
    // Région, puis la description de la zone (sans répéter la région si elle y figure déjà).
    const hint = w?.hint[lang] ?? '';
    const region = spot?.region[lang] ?? '';
    const zoneSub = [hint.includes(region) ? '' : region, hint].filter(Boolean).join(' · ');
    // zones voisines (qui touchent ou chevauchent celle-ci) : chargées avec elle pour le libre et le dessin
    const showParis = this.openWorld && this.worldId === PARIS_CITY_ZONES[0];
    const parisLoaded = showParis && PARIS_CITY_ZONES.every((id) => this.loadedZones.includes(id));
    const near = this.openWorld
      ? [...new Set([...neighbourZones({ formatVersion: 1, zones: this.zones }, this.worldId),
          ...this.loadedZones.filter((id) => id !== this.worldId)])]
      : [];
    const parisHtml = showParis
      ? `<div class="zc-near"><div><b>${S('allOfParis')}</b><span>${L
          ? 'Les 20 arrondissements et les bois de Boulogne et de Vincennes. Pour le parcours libre et le tracé sur la carte.'
          : 'All 20 arrondissements plus the Bois de Boulogne and Bois de Vincennes. For free rides and drawn routes.'}</span></div>
          <button class="zc-near-chip${parisLoaded ? ' on' : ''}" id="m-all-paris"${parisLoaded || this.loadingZone ? ' disabled' : ''}>${parisLoaded
            ? (S('allOfParisLoaded'))
            : (S('loadAllOfParis'))}</button></div>`
      : '';
    const zoneName = (id: string) => WORLD_LIST.find((x) => x.id === id)?.name[lang] ?? ZONE_SPOTS.find((x) => x.id === id)?.name[lang] ?? id;
    const nearHtml = near.length
      ? `<div class="zc-near"><div><b>${S('neighbouringAreas')}</b><span>${
          this.loadingZone ? `${S('loading2')}` : S('addThemToRide')
        }</span></div><div class="zc-near-list">${near
          .map((id) => {
            const on = this.loadedZones.includes(id);
            return `<button class="zc-near-chip${on ? ' on' : ''}" data-near="${esc(id)}" aria-pressed="${on}"${this.loadingZone ? ' disabled' : ''}>${on ? '✓ ' : '+ '}${esc(zoneName(id))}</button>`;
          })
          .join('')}</div></div>`
      : '';
    const kom = this.s.mode === 'challenge';
    const choices = `<div class="zc-choices">
          ${n ? card('routes', ZONE_ICONS.routes, S('routes'), count(n, 'zoneRoutes1', 'zoneRoutesN')) : ''}
          ${card('free', ZONE_ICONS.free, S('freeRide'), S('youPickYourRoad'))}
          ${card('draw', ZONE_ICONS.draw, S('drawARoute'), S('startWaypointsAndFinish'))}
        </div>`;
    // Défi KOM : les côtes de la zone tout de suite (en choisir une prend son parcours)
    const koms = kom ? `<h3 class="ab-section">${S('pickTheClimbTo')}</h3>${this.challengeHtml(this.routes.find((x) => x.id === this.s.routeId))}` : '';
    const packSt = this.zonePackState(this.worldId);
    return `<div class="mm-modal mm-picker-modal" data-picker-close>
      <div class="mm-dialog mm-picker pk" role="dialog" aria-modal="true">
        <header class="zc-head"><div class="pk-head"><h2 class="ab-title">${esc(w ? w.name[lang] : (spot?.name[lang] ?? this.worldId))}</h2><p class="ab-sub">${esc(zoneSub)}</p></div><button class="mm-x" data-picker-close aria-label="${S('close')}">×</button></header>
        ${kom ? koms : choices}
        ${kom ? '' : parisHtml + nearHtml}
        <div class="zc-pack ab-foot"><button class="mm-link zc-back" data-picker="zones">← ${S('mapOfFrance')}</button><span class="ab-state ${packSt.cls}"><i></i>${S('offlineMaps')} : ${esc(packSt.text)}</span>${pack && !/mm-pack ok/.test(pack) ? pack : ''}</div>
      </div></div>`;
  }

  private async downloadZone(id: string): Promise<void> {
    if (this.downloads.has(id) && !this.downloads.get(id)?.error) return;
    this.downloads.set(id, { done: 0, total: 1 });
    this.render();
    try {
      await installPack(id, (done, total) => {
        this.downloads.set(id, { done, total });
        // rafraîchissement limité (un rendu complet du panneau par quart de seconde au plus)
        const now = performance.now();
        if (now - this.lastProgressRender > 250) {
          this.lastProgressRender = now;
          if (this.tab === 'ride') this.render();
          else this.renderZonesSettings();
        }
      });
      this.downloads.delete(id);
    } catch (err) {
      this.downloads.set(id, { done: 0, total: 1, error: String((err as Error).message ?? err) });
    }
    if (this.tab === 'ride') this.render();
    else this.renderZonesSettings();
  }

  /** Ajoute des zones à la file « Tout télécharger » et la vide une zone à la fois (un échec n'arrête pas la suite). */
  private async downloadAll(ids: string[]): Promise<void> {
    for (const id of ids) this.queued.add(id);
    this.renderZonesSettings();
    if (this.queueRunning) return;
    this.queueRunning = true;
    try {
      for (let id = this.queued.values().next().value; id !== undefined; id = this.queued.values().next().value) {
        this.queued.delete(id);
        await this.downloadZone(id);
      }
    } finally {
      this.queueRunning = false;
      this.renderZonesSettings();
    }
  }

  /**
   * Réglages › « Zones et cartes » : seul endroit où l'on gère les téléchargements (état, taille, télécharger,
   * mettre à jour, supprimer, espace utilisé). La fenêtre de choix d'une zone ne fait que télécharger.
   */
  private renderZonesSettings(): void {
    const box = this.root.querySelector<HTMLElement>('#m-zones-settings');
    if (!box) return;
    // Un téléchargement en cours redessine la liste : la saisie de la recherche ne doit pas perdre le curseur.
    const refocusZoneQuery = document.activeElement?.id === 'm-zone-q';
    const L = fr();
    const lang = getLang();
    const zones = this.zones.filter((z) => z.pack);
    if (!zones.length) {
      box.innerHTML = `<p class="mm-hint">${S('zoneCatalogueUnavailableOffline')}</p>`;
      return;
    }
    const nameOf = (id: string) => WORLD_LIST.find((x) => x.id === id)?.name[lang] ?? ZONE_SPOTS.find((x) => x.id === id)?.name[lang] ?? id;
    const sizeOf = (z: (typeof zones)[number]) => formatBytes(z.pack?.gzBytes ?? z.pack?.bytes ?? 0, L);
    const rows = zones
      .map((z) => {
        const st = packState(z.id, z.pack?.version);
        const dl = this.downloads.get(z.id);
        const have = st.kind === 'installed';
        let state: string;
        let actions = '';
        if (dl && !dl.error) {
          const pct = Math.floor((dl.done / Math.max(dl.total, 1)) * 100);
          state = `<span class="zs-state busy">${S('downloading')} ${pct} %</span><i class="zs-bar"><i style="width:${pct}%"></i></i>`;
        } else if (this.queued.has(z.id)) {
          state = `<span class="zs-state busy">${S('queued')}</span>`;
        } else if (dl?.error) {
          state = `<span class="zs-state err" title="${esc(dl.error)}">${S('downloadFailed')}</span>`;
          actions = `<button class="btn small primary" data-zpack="${esc(z.id)}">${S('retry')}</button>`;
        } else if (st.kind === 'installed' && st.upToDate) {
          state = `<span class="zs-state ok">${S('downloaded')} ✓</span>`;
          actions = `<button class="btn small" data-zunpack="${esc(z.id)}">${S('remove')}</button>`;
        } else if (st.kind === 'installed') {
          state = `<span class="zs-state warn">${S('updateAvailable')}</span>`;
          actions = `<button class="btn small primary" data-zpack="${esc(z.id)}">${S('update')}</button><button class="btn small" data-zunpack="${esc(z.id)}">${S('remove')}</button>`;
        } else {
          state = `<span class="zs-state">${S('notDownloaded')}</span>`;
          actions = `<button class="btn small primary" data-zpack="${esc(z.id)}">${S('download')}</button>`;
        }
        return { have, html: `<div class="zs-row${z.id === this.worldId ? ' cur' : ''}" data-zname="${esc(foldName(nameOf(z.id)))}"><div class="zs-name"><b>${esc(nameOf(z.id))}</b><small>${sizeOf(z)}${z.id === this.worldId ? ` · ${S('currentArea2')}` : ''}</small></div><div class="zs-mid">${state}</div><div class="zs-act">${actions}</div></div>` };
      })
      .sort((a, b) => Number(b.have) - Number(a.have));
    const mine = installedPacks();
    // Application Windows : place réelle sur le disque (fichiers décompressés) ; navigateur : fichiers gardés compressés.
    const total = mine.reduce((sum, p) => sum + (inTauri ? p.bytes : (zones.find((z) => z.id === p.id)?.pack?.gzBytes ?? p.bytes)), 0);
    const used = mine.length ? `${S('spaceUsed')} : <b>${formatBytes(total, L)}</b> · ${count(mine.length, 'area1', 'areaN')}` : S('noAreaDownloaded');
    // Zones à télécharger ou à mettre à jour, hors celles en cours ou déjà en file.
    const missing = zones.filter((z) => {
      const st = packState(z.id, z.pack?.version);
      const dl = this.downloads.get(z.id);
      return !(st.kind === 'installed' && st.upToDate) && st.kind !== 'unavailable' && (!dl || dl.error) && !this.queued.has(z.id);
    });
    const missingBytes = missing.reduce((s, z) => s + (z.pack?.gzBytes ?? z.pack?.bytes ?? 0), 0);
    const allBtn = this.queued.size
      ? `<button class="btn small" data-zqueue-stop>${MX('stopQueued').replace('{n}', String(this.queued.size))}</button>`
      : '';
    const getAll = missing.length ? `<button class="btn small primary" data-zpack-all>${S('downloadAll')} · ${formatBytes(missingBytes, L)}</button>` : '';
    const where = inTauri ? (S('mapsAreKeptIn')) : S('mapsAreStoredOn');
    box.innerHTML = `<p class="mm-hint">${S('aDownloadedAreaLoads')} ${where}</p>
      ${storagePanelHtml()}
      <input id="m-zone-q" class="mm-input zs-search" type="search" autocomplete="off" placeholder="${S('searchAnArea')}" value="${esc(this.zoneQuery)}" />
      <div class="zs-list">${rows.map((r) => r.html).join('')}</div>
      <p class="mm-hint zs-none" hidden>${S('noAreaWithThat')}</p>
      <div class="zs-foot"><span>${used}</span>${getAll}${allBtn}${mine.length ? `<button class="btn small" data-zunpack-all>${S('removeAll')}</button>` : ''}</div>`;
    void fillStoragePanel(box, () => this.renderZonesSettings());
    // Recherche : filtre les lignes sans redessiner la liste (l'état des téléchargements la redessine déjà).
    const q = box.querySelector<HTMLInputElement>('#m-zone-q');
    const applyQuery = (): void => {
      const needle = foldName(this.zoneQuery.trim());
      let shown = 0;
      box.querySelectorAll<HTMLElement>('.zs-row').forEach((row) => {
        const hit = !needle || (row.dataset.zname ?? '').includes(needle);
        row.hidden = !hit;
        if (hit) shown++;
      });
      const none = box.querySelector<HTMLElement>('.zs-none');
      if (none) none.hidden = shown > 0;
    };
    q?.addEventListener('input', () => {
      this.zoneQuery = q.value;
      applyQuery();
    });
    applyQuery();
    if (refocusZoneQuery && q) {
      q.focus();
      q.setSelectionRange(q.value.length, q.value.length);
    }
    box.querySelector('[data-zpack-all]')?.addEventListener('click', () => {
      const n = missing.length;
      const what = `${count(n, 'area1', 'areaN')} (${formatBytes(missingBytes, L)})`;
      if (!confirm(MX('confirmDownload').replace('{what}', what))) return;
      void this.downloadAll(missing.map((z) => z.id));
    });
    box.querySelector('[data-zqueue-stop]')?.addEventListener('click', () => {
      this.queued.clear();
      this.renderZonesSettings();
    });
    box.querySelectorAll<HTMLElement>('[data-zpack]').forEach((el) => el.addEventListener('click', () => void this.downloadZone(el.dataset.zpack as string)));
    box.querySelectorAll<HTMLElement>('[data-zunpack]').forEach((el) =>
      el.addEventListener('click', () => {
        const id = el.dataset.zunpack as string;
        if (!confirm(MX('confirmRemove').replace('{name}', nameOf(id)))) return;
        void removePack(id).then(() => this.renderZonesSettings());
      }),
    );
    box.querySelector('[data-zunpack-all]')?.addEventListener('click', () => {
      if (!confirm(S('removeEveryDownloadedArea'))) return;
      void Promise.all(installedPacks().map((p) => removePack(p.id))).then(() => this.renderZonesSettings());
    });
  }

  /** Carte de l'itinéraire (tracé coloré selon la pente) et profil d'altitude. */
  private routeCard(r: RouteData): string {
    const step = Math.max(1, Math.floor(r.points.length / 260));
    const sel = r.points.filter((_, i) => i % step === 0);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of sel) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const W = 360;
    const H = 170;
    const k = Math.min((W - 24) / (maxX - minX || 1), (H - 24) / (maxZ - minZ || 1));
    const ox = (W - (maxX - minX) * k) / 2;
    const oz = (H - (maxZ - minZ) * k) / 2;
    const X = (x: number) => (ox + (x - minX) * k).toFixed(1);
    const Z = (z: number) => (oz + (z - minZ) * k).toFixed(1);
    const gradeColor = (g: number) => (g > 6 ? '#ef4444' : g > 3 ? '#f97316' : g > 1 ? '#facc15' : g < -2 ? '#60a5fa' : '#e5e7eb');
    let lines = '';
    for (let i = 1; i < sel.length; i++) {
      const a = sel[i - 1] as (typeof sel)[number];
      const b = sel[i] as (typeof sel)[number];
      const g = ((b.y - a.y) / Math.max(1, b.d - a.d)) * 100;
      lines += `<line x1="${X(a.x)}" y1="${Z(a.z)}" x2="${X(b.x)}" y2="${Z(b.z)}" stroke="${gradeColor(g)}"/>`;
    }
    const first = sel[0];
    const PW = 360;
    const PH = 56;
    const ys = sel.map((p) => p.y);
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    const len = r.lengthM || 1;
    const px = (d: number) => (d / len) * PW;
    const py = (y: number) => (PH - 4 - ((y - lo) / (hi - lo || 1)) * (PH - 10)).toFixed(1);
    const area = `M0,${PH} ${sel.map((p) => `L${px(p.d).toFixed(1)},${py(p.y)}`).join(' ')} L${PW},${PH} Z`;
    return `<div class="mm-routecard">
      <div class="mm-rc-title">${esc(this.routeName(r))}</div>
      <svg class="mm-map" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <g stroke-width="3.2" stroke-linecap="round">${lines}</g>
        ${first ? `<circle cx="${X(first.x)}" cy="${Z(first.z)}" r="6" fill="var(--ar-accent)" stroke="#0a0e16" stroke-width="2.5"/>` : ''}
      </svg>
      <div class="mm-stats">
        <div class="ab-val"><b>${this.km(r.lengthM)}</b><small>km</small></div>
        <div class="ab-val"><b>${Math.round(r.elevationGainM)}</b><small>m D+</small></div>
        <div class="ab-val"><b>${r.maxGradePct !== undefined ? Math.round(r.maxGradePct) : '—'}</b><small>% max</small></div>
        <div class="ab-val"><b>${this.eta(r)}</b><small>${S('est')}</small></div>
      </div>
      <svg class="mm-profile" viewBox="0 0 ${PW} ${PH}" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="mm-prof" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd23f" stop-opacity=".55"/><stop offset="1" stop-color="#ffd23f" stop-opacity=".04"/></linearGradient></defs>
        ${r.segments.map((g) => `<rect x="${px(g.startM).toFixed(1)}" y="0" width="${Math.max(1, px(g.endM) - px(g.startM)).toFixed(1)}" height="${PH}" fill="${g.kind === 'kom' ? '#ef4444' : '#22c55e'}" opacity=".14"/>`).join('')}
        <path d="${area}" fill="url(#mm-prof)" stroke="#ffd23f" stroke-width="1.2" vector-effect="non-scaling-stroke"/>
      </svg>
    </div>`;
  }

  // ————————————————————————————————————————————— Garage

  private garageHtml(): string {
    if (!V3_STYLE && this.garageSlot === 'atelier') {
      const xp = loadProgress().xp;
      return this.atelier.html(this.garageHeader(levelProgress(xp), xp), this.garageNav());
    }
    const lang = getLang();
    const p = loadProgress();
    const lp = levelProgress(p.xp);
    const slots = [...new Set(COSMETICS.map((c) => c.slot))];
    const views: Array<[GarageView, string]> = [
      ['3q', '3/4'],
      ['side', S('side')],
      ['front', S('front')],
      ['back', S('back')],
      ['bike', S('bike')],
      ['cockpit', 'Cockpit'],
    ];
    const camera = `<div class="mm-dragzone" id="m-dragzone"></div>
      <div class="mm-views">${views.map(([v, label]) => `<button class="mm-view ${v === this.view ? 'on' : ''}" data-view="${v}">${label}</button>`).join('')}
        <span class="mm-drag">${ICON.rotate} ${S('dragToRotate')}</span></div>`;
    const reopen = `<button class="gr-reopen ab-btn" data-gr="open" ${this.grFolded ? '' : 'hidden'}>‹ ${MX('menu')}</button>`;
    // Venu d'une fiche de la page Progression : retour direct à la frise, au même endroit.
    const back = this.fromProgress ? `<button class="gr-back ab-btn" data-grback>‹ ${S('backToProgress')}</button>` : '';
    if (V3_STYLE) return `${camera}${back}${reopen}
      <section class="mm-panel mm-side gr-panel${this.grFolded ? ' gr-folded' : ''}">
        <div class="gr-top">${this.garageHeader(lp, p.xp)}<div data-v3-top></div></div>
        <div class="gr-body" data-v3-garage></div>
        <div class="gr-foot">
          <details class="set-sec">
            <summary>${S('bodyMeasurementsAndFtp')}</summary>
            <div class="set-body grid2b">${this.bodyMeasurementFields()}<div class="field"><label for="m-ftp">${t('ftp')}</label>${this.stepper('m-ftp', 50, 600, this.s.ftpWatts)}</div></div>
          </details></div>
      </section>`;
    const items =
      this.garageSlot === 'skin' || this.garageSlot === 'hair' || this.garageSlot === 'beard'
        ? characterTypeHtml(this.garageSlot, this.s.look, (l, k, c) => this.colorRow(l, k, c))
        : this.garageSlot === 'face'
        ? faceEditorHtml(this.s.look, this.faceTab, this.bareHead, this.faceUndo.length > 0, this.photoOpen)
        : this.garageSlot === 'colors'
        ? `<div class="mm-colors">
            <label class="field">${S('jersey')}<input id="m-jersey" type="color" value="${this.s.look.jersey}" /></label>
            <label class="field">${S('jerseyStripe')}<input id="m-accent" type="color" value="${this.s.look.jerseyAccent}" /></label>
            <label class="field">${S('helmet')}<input id="m-helmet" type="color" value="${this.s.look.helmet}" /></label>
            <label class="field">${S('unbrandedBike')}<input id="m-bike" type="color" value="${this.s.look.bike}" /></label>
            <label class="field">${S('skin')}<input id="m-skin" type="color" value="${this.s.look.skin}" /></label>
            <label class="field">${S('hair')}<input id="m-hair" type="color" value="${this.s.look.hair}" /></label>
            ${this.shoeFields()}
            <label class="field">${S('socks')}<input id="m-socks" type="color" value="${this.s.look.socks ?? '#f2f2f2'}" /></label>
            ${this.sockHeightToggle()}
            ${this.legsToggle()}
            ${this.glovesToggle()}
            ${this.gloveColorField()}
          </div>
          <h3 class="mm-presets-title ab-section">${S('kitPresets')}</h3>
          <div class="mm-items mm-kits">${OUTFITS.map(
            (o) =>
              `<button class="mm-item" data-outfit="${o.id}"><i style="background:linear-gradient(90deg, ${o.look.jersey} 0 50%, ${o.look.jerseyAccent} 50% 100%)"></i><b>${esc(o.name[lang])}</b><span>${esc(o.hint[lang])}</span></button>`,
          ).join('')}
          </div>`
        : this.garageSlot === 'shorts' || this.garageSlot === 'gloves' || this.garageSlot === 'shoes'
        ? this.typeHtml()
        : this.garageSlot === 'bike'
        ? this.bikeListHtml(lp.level, p.equipped.bike)
        : this.garageSlot === 'jersey'
        ? `${this.colorRows()}${this.optRow(S('sleeves'), 'sleeves', this.s.look.sleeves ?? 'short', [['short', S('short2')], ['long', S('long2')]])}${this.captionHtml()}${this.filterBar(lp.level)}${this.jerseyPacksHtml(lp.level, p.equipped.jersey)}`
        : `${this.colorRows()}${this.garageSlot === 'helmet' ? this.helmetTypeRow() : ''}${this.garageSlot === 'socks' ? this.optRow(S('height'), 'sockHeight', this.s.look.sockHeight ?? 'low', [['low', S('low')], ['high', S('high')]]) : ''}${SLOT_PICTO[this.garageSlot] ? this.captionHtml() : ''}${this.filterBar(lp.level)}<div class="mm-items">${this.garageItems(lp.level)
            .map((c) => this.itemHtml(c, lp.level, c.slot === 'trainer' ? trainerOf(p.equipped) : p.equipped[c.slot]))
            .join('')}</div>`;
    return `${camera}
      ${isFaceSlot(this.garageSlot) ? '' : this.roadEffect()}
      ${back}${reopen}
      <section class="mm-panel mm-side gr-panel${this.grFolded ? ' gr-folded' : ''}">
        <div class="gr-top"><div class="gr-titles"><h2 class="ab-title gr-title">${MX('garageTitle')}</h2><p class="ab-sub gr-sub-line">${MX('garageSub')}</p></div>${this.garageHeader(lp, p.xp)}${this.garageNav()}</div>
        <div class="gr-body">${items}</div>
        <div class="gr-foot">${this.bikeSummary()}<p>${S('gearUnlocksAsYou')}</p></div>
      </section>`;
  }

  /** En-tête du garage : niveau et progression, crédits, fermeture. */
  private garageHeader(lp: ReturnType<typeof levelProgress>, xp: number): string {
    return `<div class="gr-head">
        <div class="gr-lvl"><b>${S('level')} ${lp.level}</b><i class="mm-xp big"><i style="width:${(lp.progress * 100).toFixed(1)}%"></i></i><span>${xp}${lp.nextLevelXp ? ` / ${lp.nextLevelXp}` : ''} XP</span></div>
        <span class="gr-coins" title="${S('workshopCredits')}">${COIN} <b>${(this.account?.credits ?? loadProgress().credits).toLocaleString(MX('locale'))}</b></span>
        <button class="gr-fold" data-gr="fold" aria-label="${S('collapseTheMenu')}" title="${S('collapseTheMenuFor')}"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 10.5 8 5.5l5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <button class="gr-x" data-tab="ride" aria-label="${S('close')}" title="${S('closeEsc')}">×</button>
      </div>`;
  }

  /** Navigation du garage à deux niveaux : trois rubriques (Tenue, Vélo, Personnage), puis leurs catégories. */
  private garageNav(): string {
    const lang = getLang();
    const cur = this.garageSlot;
    const slotLabel = (sl: CosmeticSlot) => SLOT_LABEL[sl][lang];
    const groups: Array<{ label: string; icon: string; first: GarageSlot; subs: Array<[GarageSlot, string]> }> = [
      { label: S('outfit'), icon: ICON.gTenue, first: 'jersey', subs: [['jersey', slotLabel('jersey')], ['shorts', S('shorts')], ['helmet', slotLabel('helmet')], ['glasses', slotLabel('glasses')], ['gloves', S('gloves')], ['socks', slotLabel('socks')], ['shoes', S('shoes')]] },
      { label: S('bike'), icon: ICON.gBike, first: 'bike', subs: [['bike', S('pickMyBike')], ['atelier', `${ICON.gWrench} ${S('partsWorkshop')}`], ['trainer', S('homeTrainer')]] },
      { label: S('character'), icon: ICON.gFace, first: 'face', subs: [['face', S('face')], ['skin', S('skin')], ['hair', S('hair')], ...(lookSex(this.s.look) === 'male' ? ([['beard', S('beard')]] as Array<[GarageSlot, string]>) : []), ['colors', S('colours')]] },
    ];
    const active = groups.find((g) => g.subs.some(([id]) => id === cur)) ?? groups[0]!;
    // Tenue : une tuile par emplacement, avec l'équipement porté (coup d'œil sur ce qu'on porte, un clic ouvre son catalogue).
    const equipped = loadProgress().equipped;
    const tile = ([id, label]: [GarageSlot, string]) => {
      const item = COSMETICS.find((c) => c.slot === id && c.id === equipped[id as CosmeticSlot]);
      // Rien d'équipé au catalogue : la couleur portée (réglages du coureur) et « Par défaut ».
      const look = this.s.look;
      const base: Partial<Record<GarageSlot, string>> = { jersey: look.jersey, helmet: look.helmet, socks: look.socks ?? '#f2f2f2', glasses: '#1a1d24' };
      return `<button class="gr-slot ${id === cur ? 'on' : ''}" data-slot="${id}" aria-pressed="${id === cur}" title="${esc(item ? item.name[lang] : S('default'))}"><i>${SLOT_PICTO[id] ?? ''}</i><small>${label}</small></button>`;
    };
    const subs = active.label === (S('outfit')) || active.label === (S('character'))
      ? `<div class="gr-slots" style="--n:${active.subs.length}">${active.subs.map(tile).join('')}</div><div class="gr-typename">${esc(active.subs.find(([id]) => id === cur)?.[1] ?? '')}${active.label === (S('character')) ? `<button class="gr-dice" id="gr-dice" title="${S('randomCharacterFaceSkin')}" aria-label="${S('randomCharacter')}">${ICON.dice}</button>` : ''}</div>`
      : `<div class="gr-subs">${active.subs.map(([id, label]) => `<button class="gr-sub ${id === cur ? 'on' : ''}" data-slot="${id}">${label}</button>`).join('')}</div>`;
    return `<nav class="gr-groups" aria-label="${S('garageSections')}">${groups
      .map((g) => `<button class="gr-group ${g === active ? 'on' : ''}" data-slot="${g === active ? cur : g.first}" aria-pressed="${g === active}">${g.icon}<span>${g.label}</span></button>`)
      .join('')}</nav>
      ${subs}`;
  }

  /** Vignette d'un équipement du garage (équipé, verrouillé, en aperçu). */
  private itemHtml(c: CosmeticItem, level: number, equipped: string | undefined): string {
    const lang = getLang();
    const locked = c.level > level;
    const on = equipped === c.id;
    const prev = [...this.previews.values()].includes(c.id);
    if (SLOT_PICTO[c.slot as GarageSlot]) {
      const bg = swatch(c);
      const stateTxt = prev ? `${S('preview')} · ${S('lvl')} ${c.level}` : locked ? `${S('level')} ${c.level} · ${MX('levelsToGo').replace('{n}', String(c.level - level))}` : on ? (S('equipped')) : S('unlocked');
      return `<button class="gr-chip ${on ? 'on' : ''} ${locked ? 'locked' : ''} ${prev ? 'preview' : ''}" data-item="${c.id}" data-cap-name="${esc(c.name[lang])}" data-cap-effect="${esc(c.effect?.[lang] ?? '')}" data-cap-state="${esc(stateTxt)}" aria-label="${esc(c.name[lang])} — ${esc(stateTxt)}" style="background:${bg};color:${pictoInk(bg)}">${locked ? `<u>${ICON.pLock}</u>` : on ? '<u class="ok">✓</u>' : ''}</button>`;
    }
    return `<button class="mm-item ${on ? 'on' : ''} ${locked ? 'locked' : ''} ${prev ? 'preview' : ''}" data-item="${c.id}" title="${locked ? (S('clickToTryIt')) : ''}">
                <i style="background:${swatch(c)}"></i>
                <span class="mm-it-txt"><b>${esc(c.name[lang])}</b>${c.effect ? `<em class="mm-effect">${esc(c.effect[lang])}</em>` : ''}
                <span class="mm-it-state st-${prev ? 'preview' : locked ? 'locked' : on ? 'on' : 'free'}">${prev ? `${S('preview')} · ${S('lvl')} ${c.level}` : locked ? `${S('level')} ${c.level} · ${MX('levelsToGo').replace('{n}', String(c.level - level))}` : on ? (S('equipped')) : S('unlocked')}</span></span></button>`;
  }

  /** Cuissard court ou long (look.legs) ; aperçu immédiat. */
  private legsToggle(): string {
    return `<div class="field mm-sleeves">${S('shorts')}${this.seg('m-legs', this.s.look.legs ?? 'short', [
      ['short', S('short')],
      ['long', S('long')],
    ])}</div>`;
  }

  /** Couleur, marquage et accent des chaussures (onglets Couleurs et Chaussettes). */
  private shoeFields(): string {
    return `<label class="field">${S('shoes')}<input id="m-shoes" type="color" value="${this.s.look.shoes ?? '#f2f2f2'}" /></label>
            <label class="field">${S('shoeLogo')}<select id="m-shoe-mark"><option value="">${S('none2')}</option>${SHOE_MARKS.map((m) => `<option value="${m.id}" ${this.s.look.shoeMark === m.id ? 'selected' : ''}>${m.text}</option>`).join('')}</select></label>
            <label class="field">${S('shoeAccent')}<input id="m-shoe-accent" type="color" value="${this.s.look.shoeAccent ?? shoeAccentOf(this.s.look)}" /></label>`;
  }

  /** Couleur des gants (mitaines ou gants longs), à côté du choix des gants. */
  private gloveColorField(): string {
    return `<label class="field">${S('gloveColour')}<input id="m-glove-color" type="color" value="${this.s.look.gloveColor ?? '#16161a'}" /></label>`;
  }

  /** Gants : aucun, mitaines (doigts nus) ou gants complets (look.gloves) ; aperçu immédiat. */
  private glovesToggle(): string {
    return `<div class="field mm-sleeves">${S('gloves')}${this.seg('m-gloves', this.s.look.gloves ?? 'none', [
      ['none', S('none3')],
      ['mitts', S('mitts')],
      ['full', S('full')],
    ])}</div>`;
  }

  /** Chaussettes basses ou hautes (look.sockHeight) ; aperçu immédiat. */
  private sockHeightToggle(): string {
    return `<div class="field mm-sleeves">${S('sockHeight')}${this.seg('m-sock-height', this.s.look.sockHeight ?? 'low', [
      ['low', S('low')],
      ['high', S('high')],
    ])}</div>`;
  }

  /** Manches courtes ou longues, pour tous les maillots (look.sleeves) ; aperçu immédiat. */
  private sleevesToggle(): string {
    return `<div class="field mm-sleeves">${S('sleeves')}${this.seg('m-sleeves', this.s.look.sleeves ?? 'short', [
      ['short', S('short2')],
      ['long', S('long2')],
    ])}</div>`;
  }

  /** Maillots regroupés par pack (en-tête, puis grille) ; un pack inconnu garde son identifiant comme titre. */
  private jerseyPacksHtml(level: number, equipped: string | undefined): string {
    const lang = getLang();
    const jerseys = this.garageItems(level);
    const known = new Set(JERSEY_PACKS.map((k) => k.id));
    const packs = [...JERSEY_PACKS, ...[...new Set(jerseys.map((c) => c.pack ?? ''))].filter((id) => !known.has(id)).map((id) => ({ id, name: { fr: id, en: id } }))];
    return packs
      .map((k) => ({ k, items: jerseys.filter((c) => (c.pack ?? '') === k.id) }))
      .filter((g) => g.items.length)
      .map(
        (g) =>
          `${g.k.id || packs.length > 1 ? `<h3 class="mm-presets-title ab-section mm-pack">${esc(g.k.name[lang])} <span>${g.items.length}</span></h3>` : ''}<div class="mm-items">${g.items.map((c) => this.itemHtml(c, level, equipped)).join('')}</div>`,
      )
      .join('');
  }

  /** Panneau « Effet sur la route » : vélo roulé (équipé, ou essayé) avec les pièces de l'atelier montées. */
  private roadEffect(): string {
    const eq: Record<string, string | undefined> = { ...loadProgress().equipped, ...Object.fromEntries(this.previews) };
    const bike = tunedBikeSetup(bikeSetupFor(eq), equippedTuneIds(eq)).bike;
    return roadEffectHtml(bike, this.s.massKg, this.s.ftpWatts);
  }

  /** Home trainer montré au garage : celui essayé, sinon celui équipé (KICKR CORE 2 au départ). */
  currentTrainer(): string {
    return this.previews.get('trainer') ?? trainerOf(loadProgress().equipped);
  }

  /** Vélo réellement roulé avec l'équipement porté : masse, traînée, pneus. */
  private bikeSummary(): string {
    const b = bikeSetupFor(loadProgress().equipped);
    const drag = Math.round((b.cda / DEFAULT_BIKE.cda - 1) * 1000) / 10;
    const num = dec;
    return `<p class="mm-hint mm-bikephys">${S('riding')} : <b>${num(b.massKg)} kg</b> · ${S('drag')} <b>${drag > 0 ? '+' : ''}${num(drag)} %</b> · ${
      b.tyre === 'gravel' ? (S('gravelTyres')) : b.tyre === 'mtb' ? (S('mtbTyres')) : S('roadTyres')
    }</p>`;
  }

  /** Équipements de l'emplacement choisi (hors vélos, voir bikesInCollection). */
  private garageItems(level: number): CosmeticItem[] {
    return COSMETICS.filter((c) => c.slot === this.garageSlot)
      .filter((c) => this.garageSlot !== 'helmet' || this.helmetType === 'all' || helmetKind(c) === this.helmetType)
      .filter((c) => this.itemFilter === 'all' || (this.itemFilter === 'locked') === c.level > level);
  }

  /** Type de coiffe : choix du genre (casque, chrono, casquette, sans) avec les effectifs. */
  private helmetTypeRow(): string {
    const all = COSMETICS.filter((c) => c.slot === 'helmet');
    const count = (k: string) => all.filter((c) => helmetKind(c) === k).length;
    const opts: Array<['all' | 'road' | 'tt' | 'cap' | 'none', string, number]> = [
      ['all', S('all'), all.length],
      ['road', S('helmet'), count('road')],
      ['tt', S('timeTrial'), count('tt')],
      ['cap', S('cap'), count('cap')],
      ['none', S('none3'), count('none')],
    ].filter(([k, , n]) => k === 'all' || (n as number) > 0) as Array<['all' | 'road' | 'tt' | 'cap' | 'none', string, number]>;
    return `<div class="gr-vopt"><small>${S('kind')}</small><div>${opts
      .map(([k, l, n]) => `<button class="gr-vchip ${this.helmetType === k ? 'on' : ''}" data-htype="${k}" aria-pressed="${this.helmetType === k}">${l} <i>${n}</i></button>`)
      .join('')}</div></div>`;
  }

  /** Couleurs de l'emplacement : pastilles rondes et roue de couleur (même effet que l'onglet Couleurs). */
  private colorRow(label: string, key: 'jersey' | 'jerseyAccent' | 'helmet' | 'shoes' | 'shoeAccent' | 'socks' | 'gloveColor' | 'skin' | 'hair', current: string): string {
    const cur = current.toLowerCase();
    return `<div class="gr-colors"><small>${label}</small><div>${(QUICK_COLORS[key] ?? [])
      .map((h) => `<button class="gr-sw ${h.toLowerCase() === cur ? 'on' : ''}" data-setcolor="${key}:${h}" style="background:${h}" aria-label="${h}" aria-pressed="${h.toLowerCase() === cur}"></button>`)
      .join('')}<label class="gr-sw gr-custom" title="${S('otherColour')}"><input type="color" data-colorkey="${key}" value="${current.length === 7 ? current : '#888888'}" /></label></div></div>`;
  }

  /** Lignes de couleur de l'emplacement affiché. */
  private colorRows(): string {
    const look = this.s.look;
    switch (this.garageSlot) {
      case 'jersey':
        return this.colorRow(S('jersey'), 'jersey', look.jersey) + this.colorRow(S('stripe'), 'jerseyAccent', look.jerseyAccent);
      case 'helmet':
        return this.colorRow(S('helmet'), 'helmet', look.helmet);
      case 'socks':
        return this.colorRow(S('socks'), 'socks', look.socks ?? '#f2f2f2');
      case 'gloves':
        return this.colorRow(S('gloves'), 'gloveColor', look.gloveColor ?? '#16161a');
      case 'shoes':
        return this.colorRow(S('shoes'), 'shoes', look.shoes ?? '#f2f2f2') + this.colorRow(S('accent'), 'shoeAccent', look.shoeAccent ?? shoeAccentOf(look));
      default:
        return '';
    }
  }

  /** Choix d'un type (manches, cuissard, gants…) : pastilles avec libellé, qui écrivent look.<clé>. */
  private optRow(label: string, key: 'sleeves' | 'legs' | 'gloves' | 'sockHeight', current: string, options: Array<[string, string]>): string {
    return `<div class="gr-vopt"><small>${label}</small><div>${options
      .map(([v, l]) => `<button class="gr-vchip ${v === current ? 'on' : ''}" data-setopt="${key}:${v}" aria-pressed="${v === current}">${l}</button>`)
      .join('')}</div></div>`;
  }

  /** Contenu des types sans catalogue (cuissard, gants, chaussures) : leurs choix, sans liste d'objets. */
  private typeHtml(): string {
    const look = this.s.look;
    const intro = (t: string) => `<p class="gr-note">${t}</p>`;
    if (this.garageSlot === 'shorts')
      return this.optRow(S('length'), 'legs', look.legs ?? 'short', [['short', S('short')], ['long', S('long')]]) + intro(S('longShortsSuitCooler'));
    if (this.garageSlot === 'gloves')
      return this.optRow(S('type'), 'gloves', look.gloves ?? 'none', [['none', S('none3')], ['mitts', S('mitts')], ['full', S('full')]]) + this.colorRows();
    return this.colorRows() + `<div class="mm-colors gr-shoefields">${this.shoeFields()}</div>`;
  }

  /** Légende de l'équipement survolé (ou équipé / essayé) sous la grille de pastilles. */
  private captionHtml(): string {
    return `<div class="gr-cap" id="gr-cap" aria-live="polite"><b></b><span></span><em></em></div><p class="gr-cap-hint">${S('hoverAChipFor')}</p>`;
  }

  /** Barre de filtre du catalogue : Tout / Débloqués / Verrouillés, avec les effectifs. */
  private filterBar(level: number): string {
    const all = COSMETICS.filter((c) => c.slot === this.garageSlot);
    const open = all.filter((c) => c.level <= level).length;
    const seg = (id: 'all' | 'unlocked' | 'locked', label: string, n: number) =>
      `<button class="gr-f ${this.itemFilter === id ? 'on' : ''}" data-gfilter="${id}" aria-pressed="${this.itemFilter === id}">${label} <i>${n}</i></button>`;
    return `<div class="gr-filter" role="group" aria-label="${S('filter')}">${seg('all', S('all2'), all.length)}${seg('unlocked', S('unlocked2'), open)}${seg('locked', S('locked'), all.length - open)}</div>`;
  }

  /** Vélos de la collection choisie (ou débloqués), par marque, puis par niveau et par groupe. */
  private bikesInCollection(level: number): CosmeticItem[] {
    const group = (id: string) => BIKE_GROUPS.findIndex((g) => g.id === bikeById(id)?.group);
    return COSMETICS.filter((c) => c.slot === 'bike')
      // Le VTT et le gravel ne sont pas au catalogue des cadres : ils sont rangés dans « Divers ».
      .filter((c) => (this.bikeFilter === 'unlocked' ? c.level <= level : (bikeById(c.id)?.collection ?? 'divers') === this.bikeFilter))
      .sort((a, b) => brandName(a.id).localeCompare(brandName(b.id), 'fr') || a.level - b.level || group(a.id) - group(b.id) || a.name.fr.localeCompare(b.name.fr));
  }

  /** Lignes des vélos (déjà triés par marque), un intertitre par marque. */
  private bikeRowsByBrand(list: CosmeticItem[], row: (c: CosmeticItem) => string): string {
    let out = '';
    let last: string | undefined;
    for (const c of list) {
      const brand = brandName(c.id);
      if (brand !== last) {
        out += `<h5 class="mm-bl-brand">${esc(brand)}<span>${list.filter((x) => brandName(x.id) === brand).length}</span></h5>`;
        last = brand;
      }
      out += row(c);
    }
    return out;
  }

  /**
   * Sélection du vélo : fiche du vélo regardé (aperçu d'un vélo verrouillé, sinon le vélo équipé),
   * collection, type, puis une ligne par vélo : disponibles d'abord, à débloquer ensuite.
   */
  private bikeListHtml(level: number, equippedId: string | undefined): string {
    const L = fr();
    const all = this.bikesInCollection(level);
    const types = BIKE_TYPE_ORDER.filter((ty) => all.some((c) => bikeById(c.id)?.type === ty));
    const type = this.bikeType !== 'all' && types.includes(this.bikeType) ? this.bikeType : 'all';
    const list = type === 'all' ? all : all.filter((c) => bikeById(c.id)?.type === type);
    const plain = type === 'all';
    const open = list.filter((c) => c.level <= level);
    const locked = list.filter((c) => c.level > level);
    const row = (c: CosmeticItem) => this.bikeRowHtml(c, level, equippedId);
    const chip = (id: BikeType | 'all', label: string, n: number) =>
      `<button class="${id === type ? 'on' : ''}" data-biketype="${id}" role="radio" aria-checked="${id === type}">${label}<span>${n}</span></button>`;
    return `${this.bikeFocusHtml(equippedId)}
      ${this.bottlesToggle(equippedId)}
      <div class="mm-bikefilter" role="radiogroup">${BIKE_FILTERS.map(
        ([id, fr_, en]) => `<button class="${id === this.bikeFilter ? 'on' : ''}" data-bikefilter="${id}" role="radio" aria-checked="${id === this.bikeFilter}">${L ? fr_ : en}</button>`,
      ).join('')}</div>
      ${types.length > 1 ? `<div class="mm-biketypes" role="radiogroup">${chip('all', S('all'), all.length)}${types.map((ty) => chip(ty, BIKE_TYPE[ty][L ? 0 : 1], all.filter((c) => bikeById(c.id)?.type === ty).length)).join('')}</div>` : ''}
      <div class="mm-bikelist">
        ${open.length || plain ? `<h4 class="mm-bl-head">${S('available')}<span>${open.length + (plain ? 1 : 0)}</span></h4>${plain ? this.plainBikeHtml() : ''}${this.bikeRowsByBrand(open, row)}` : ''}
        ${locked.length ? `<h4 class="mm-bl-head">${S('unlockByRiding')}<span>${locked.length}</span></h4>${this.bikeRowsByBrand(locked, row)}` : ''}
      </div>`;
  }

  /** Bidons : aucun, 1 ou 2 selon ce que le cadre équipé peut porter (look.bottles) ; aperçu immédiat. */
  private bottlesToggle(equippedId: string | undefined): string {
    const cap = bottleCapacity(equippedId);
    if (cap === 0) return `<div class="field mm-bottles">${S('bottles')}<span class="mm-hint">${S('thisFrameCarriesNo')}</span></div>`;
    const cur = Math.min(this.s.look.bottles ?? 1, cap);
    const opts: Array<[string, string]> = [['0', S('none2')], ['1', '1'], ['2', '2']];
    const color = this.s.look.bottleColor ?? 'auto';
    return `<div class="field mm-bottles">${S('bottles')}${this.seg('m-bottles', String(cur), opts.slice(0, cap + 1))}</div>
      <div class="field mm-bottles">${S('bottleColour')}${this.seg('m-bottlecolor', color, [
        ['auto', 'Auto'],
        ['black', S('black')],
        ['white', S('white')],
      ])}</div>`;
  }

  /** Une ligne de la liste des vélos : silhouette aux couleurs de la livrée, nom, type et équipe, effet, état. */
  private bikeRowHtml(c: CosmeticItem, level: number, equippedId: string | undefined): string {
    const L = fr();
    const lang = getLang();
    const bike = bikeById(c.id);
    const locked = c.level > level;
    const on = equippedId === c.id;
    const prev = [...this.previews.values()].includes(c.id);
    const from = bike ? bikeFrom(bike.group, lang) : undefined;
    const sub = bike ? `${BIKE_TYPE[bike.type][L ? 0 : 1]}${from ? ` · ${from}` : ''}` : '';
    const state = prev ? `👁 ${S('preview')}` : locked ? `🔒 ${S('lvl')} ${c.level}` : on ? `✓ ${S('equipped')}` : '';
    return `<button class="mm-bike ${on ? 'on' : ''} ${locked ? 'locked' : ''} ${prev ? 'preview' : ''}" data-item="${c.id}" title="${esc([bike?.desc[lang] ?? '', locked ? (S('clickToTryIt')) : ''].filter(Boolean).join(' — '))}">
      ${bikeThumbHtml(c.id, 'mm-bikeicon', c.colors?.length ? c.colors : [c.color ?? '#7a8594'])}
      <span class="mm-bike-txt"><b>${esc(c.name[lang])}</b><small>${esc(sub)}</small></span>
      <span class="mm-bike-side">${c.effect ? `<em>${esc(c.effect[lang])}</em>` : ''}${state ? `<span class="mm-bike-state">${state}</span>` : ''}</span>
    </button>`;
  }

  /** Vélo de départ sans marque, à la couleur choisie dans « Couleurs ». */
  private plainBikeHtml(): string {
    const on = !this.s.look.bikeModel;
    return `<button class="mm-bike ${on ? 'on' : ''}" data-plainbike title="${S('pickItsColourIn')}">
      ${plainThumbHtml(this.s.look.bike, 'mm-bikeicon')}
      <span class="mm-bike-txt"><b>${S('unbrandedBike')}</b><small>${S('yourColourColoursTab')}</small></span>
      <span class="mm-bike-side">${on ? `<span class="mm-bike-state">✓ ${S('equipped')}</span>` : ''}</span></button>`;
  }

  /** Fiche du vélo regardé : aperçu d'un vélo verrouillé, sinon le vélo équipé. */
  private bikeFocusHtml(equippedId: string | undefined): string {
    const L = fr();
    const lang = getLang();
    const previewed = this.previews.has('bike') ? COSMETICS.find((c) => c.id === this.previews.get('bike')) : undefined;
    const c = previewed ?? (equippedId ? COSMETICS.find((x) => x.id === equippedId) : undefined);
    if (!c) {
      return `<div class="mm-bikefocus">${plainThumbHtml(this.s.look.bike, 'mm-bikeicon big')}<div class="mm-bf-txt"><small>${S('yourBike')}</small><b>${S('unbrandedBike')}</b>
        <p>${S('pickItsColourIn2')}</p></div></div>`;
    }
    const bike = bikeById(c.id);
    const from = bike ? bikeFrom(bike.group, lang) : undefined;
    const tags = [bike ? BIKE_TYPE[bike.type][L ? 0 : 1] : '', from ?? '', bike?.year ? String(bike.year) : ''].filter(Boolean);
    return `<div class="mm-bikefocus ${previewed ? 'preview' : ''}">${bikeThumbHtml(c.id, 'mm-bikeicon big', c.colors?.length ? c.colors : [c.color ?? '#7a8594'])}
      <div class="mm-bf-txt">
        <small>${previewed ? MX('previewUnlocks').replace('{n}', String(c.level)) : S('yourBike')}</small>
        <b>${esc(c.name[lang])}</b>
        <span class="mm-bf-tags">${tags.map((x) => `<em>${esc(x)}</em>`).join('')}${c.effect ? `<em class="fx">${esc(c.effect[lang])}</em>` : ''}</span>
        ${bike ? `<p>${esc(bike.desc[lang])}</p>` : ''}
        ${previewed ? `<button class="mm-link" data-unpreview>${S('backToMyBike')}</button>` : ''}
      </div></div>`;
  }

  // ————————————————————————————————————————————— Profil et réglages

  private profileHtml(): string {
    const s = this.s;
    const wkg = s.ftpWatts / s.massKg;
    const sub = `<nav class="hp-tabs mm-subtabs" role="tablist">${(
      [
        ['profile', S('myProfile')],
        ['history', S('history')],
      ] as const
    )
      .map(([v, label]) => `<button role="tab" class="hp-tab${v === this.profileView ? ' on' : ''}" aria-selected="${v === this.profileView}" data-pview="${v}">${label}</button>`)
      .join('')}</nav>`;
    // Historique : toutes les sorties, la forme, les records et les FTP (fenêtre large).
    if (this.profileView === 'history') {
      return `<section class="mm-panel mm-center mm-wide mm-xl">${this.closeBtn()}
      <header class="mm-head"><h2 class="ab-title">${t('profile')}</h2></header>${sub}<div id="m-history"></div></section>`;
    }
    const stat = (value: string, unit: string, title = ''): string => `<div class="ab-tile ab-plain"${title ? ` title="${title}"` : ''}><div class="ab-val"><b>${value}</b><small>${unit}</small></div></div>`;
    const row = (label: string, help: string, control: string, forId = ''): string =>
      `<div class="mm-opt"><div class="mm-opt-l"><b>${forId ? `<label for="${forId}">${label}</label>` : label}</b>${help ? `<small>${help}</small>` : ''}</div>${control}</div>`;
    return `<section class="mm-panel mm-center">${this.closeBtn()}
      <header class="mm-head"><h2 class="ab-title">${t('profile')}</h2></header>${sub}
      <div class="mm-bigstats ab-grid ab-grid-4">${stat(dec(wkg), 'W/kg')}${stat(String(Math.round(s.ftpWatts)), 'W FTP')}${stat(String(s.massKg), 'kg')}${stat(
        Math.round((rideHistory.summary?.totals.distanceM ?? 0) / 1000).toLocaleString(MX('locale')),
        S('kmRidden'),
        S('kilometresRiddenInThe'),
      )}</div>
      <div class="mm-card mm-profile-form">
        ${row(t('name'), '', `<input id="m-name" class="mm-input" value="${esc(s.name)}" />`, 'm-name').replace('class="mm-opt"', 'class="mm-opt mm-opt-first"')}
        ${row(S('iAm'), '', `<div class="row">${(['male', 'female'] as const).map((x) => `<button class="btn small ${lookSex(s.look) === x ? 'primary' : ''}" data-sex="${x}">${x === 'male' ? (S('aMan')) : S('aWoman')}</button>`).join('')}</div>`)}
        ${row(S('nationality'), S('yourFlagNextTo'), this.nationHtml())}
        ${row(t('weight'), S('countsOnTheClimbs'), this.stepper('m-mass', 30, 200, s.massKg, 0.5), 'm-mass')}
        ${row(t('height'), S('countsForYourDrag'), this.stepper('m-height', 120, 220, s.heightCm), 'm-height')}
        ${row(t('ftp'), S('setsWorkoutsAndZones'), this.stepper('m-ftp', 50, 600, s.ftpWatts), 'm-ftp')}
        <div id="m-strava-profile"></div>
      </div>
    </section>`;
  }

  private bodyMeasurementFields(): string {
    return `<div class="field"><label for="m-mass">${t('weight')}</label>${this.stepper('m-mass', 30, 200, this.s.massKg, 0.5)}</div>
      <div class="field"><label for="m-height">${t('height')}</label>${this.stepper('m-height', 120, 220, this.s.heightCm)}</div>`;
  }

  /** Rubriques repliables de l'onglet Réglages ouvertes en ce moment (mémorisées, pour résister aux réaffichages). */
  private settingsOpen = new Set<string>(
    (() => {
      try {
        // Tout est replié au départ : l'utilisateur ouvre ce dont il a besoin.
        return JSON.parse(localStorage.getItem('ar.settingsOpen2') ?? '[]') as string[];
      } catch {
        return [];
      }
    })(),
  );

  /** Catégorie des Réglages affichée (mémorisée : l'écran est redessiné à chaque changement). */
  private settingsCat: string = (() => {
    try {
      return localStorage.getItem('ar.settingsCat') ?? 'image';
    } catch {
      return 'image';
    }
  })();

  /** Recherche de la liste des zones hors ligne (gardée d'un réaffichage à l'autre). */
  private zoneQuery = '';
  /** Choix de sortie : recherche dans la liste des zones, et tri des parcours d'une zone. */
  private zonePickQuery = '';
  private routeSort: 'default' | 'dist' | 'climb' = 'default';

  /** Un réglage : libellé et explication courte à gauche, commande à droite (ou dessous avec `col`). */
  private setOpt(label: string, help: string, control: string, col = false): string {
    return `<div class="mm-opt${col ? ' mm-opt-col' : ''}"><div class="mm-opt-l"><b>${label}</b>${help ? `<small>${help}</small>` : ''}</div>${control}</div>`;
  }

  /** Réglages rares ou techniques d'une catégorie : toujours visibles (la place ne manque pas), sous un intertitre « Avancé ». */
  private setAdvanced(id: string, body: string): string {
    return `<section class="set-adv" data-sec="adv-${id}"><h4 class="set-adv-t">${SET('advanced')}</h4>${body}</section>`;
  }

  /**
   * Réglages du home trainer, dans l'écran Capteurs sous les blocs des appareils (avant : une rubrique des Réglages,
   * loin de l'appareil). Branchés par `bind` comme les autres réglages (mêmes id).
   */
  private trainerSettingsHtml(): string {
    const s = this.s;
    const L = fr();
    const opt = (label: string, help: string, control: string, col = false) => this.setOpt(label, help, control, col);
    const range = (id: string, min: number, max: number, step: number, value: number) => `<input class="set-range" id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" />`;
    const val = (id: string, text: string) => ` <span class="set-val" id="${id}">${text}</span>`;
    const RF = ROAD_FEEL_TEXT[getLang()];
    return `
      ${opt(`${t('difficulty')}${val('m-diffv', `${Math.round(s.trainerDifficulty * 100)} %`)}`, SET('diffHelp'), range('m-diff', 0, 1, 0.05, s.trainerDifficulty))}
      ${opt(SET('drive'), SET('driveHelp'), this.seg('m-drive', s.drivetrain, [['cog', SET('virtual')], ['cassette', SET('cassette')]]), true)}
      ${opt(`${RF.title}${val('m-roadfeelv', roadFeelValue(s.roadFeelPercent, L))}`, '', range('m-roadfeel', 0, ROAD_FEEL.maxPercent, 5, s.roadFeelPercent))}
      ${roadFeelMessage(s.roadFeelPercent, L)}
      ${this.setAdvanced('trainer', opt(`${SET('inertia')}${val('m-inertiav', `${Math.round(s.inertia * 100)} %`)}`, SET('inertiaHelp'), range('m-inertia', 0.6, 1, 0.05, s.inertia)))}`;
  }

  /** Limite d'images par seconde enregistrée (`ar.fpsCap`, '0' = celle de l'écran), lue par engine/display.ts au chargement. */
  private fpsCapSeg(): string {
    let cur = '0';
    try {
      const n = Number(localStorage.getItem('ar.fpsCap') ?? '0');
      cur = Number.isFinite(n) && n >= 20 ? String(Math.round(n)) : '0';
    } catch {
      /* stockage indisponible : écran */
    }
    const opts: Array<[string, string]> = [['0', SET('fpsScreen')], ['30', '30'], ['60', '60'], ['120', '120']];
    // Valeur posée à la main (144…) : proposée telle quelle pour ne pas l'effacer sans le vouloir.
    if (!opts.some(([v]) => v === cur)) opts.push([cur, cur]);
    return this.seg('m-fpscap', cur, opts);
  }

  private settingsHtml(): string {
    const s = this.s;
    const L = fr();
    const opt = (label: string, help: string, control: string, col = false) => this.setOpt(label, help, control, col);
    const range = (id: string, min: number, max: number, step: number, value: number) => `<input class="set-range" id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" />`;
    const val = (id: string, text: string) => ` <span class="set-val" id="${id}">${text}</span>`;

    const image = `
      ${opt(t('quality'), SET('qualityHelp'), this.seg('m-quality', s.quality, (['low', 'medium', 'high', 'ultra'] as const).map((q) => [q, t(q)])), true)}
      ${opt(SET('style'), '', this.seg('m-style', GRAPHIC_STYLE, [['lowpoly', SET('styleGame')], ['real', SET('styleReal')], ...(V3_AVAILABLE ? [['v3', 'Beta'] as [string, string]] : [])]), true)}
      ${opt(SET('fpsCap'), SET('fpsHelp'), this.fpsCapSeg(), true)}
      ${this.setAdvanced(
        'image',
        `${opt(SET('aspect'), SET('aspectHelp'), this.seg('m-aspect', getAspectCap(), [['full', SET('aspectFull')], ['16:9', '16:9'], ['21:9', '21:9'], ['32:9', '32:9']]), true)}
        ${opt(SET('maxRes'), '<span id="m-res-now"></span>', this.seg('m-maxres', getResolutionCap(), [['auto', 'Auto'], ['1080p', '1080p'], ['1440p', '1440p'], ['4k', '4K']]), true)}`,
      )}`;

    // Blocs du HUD : décocher ce que son matériel ne mesure pas (cardio, cadence…), rangés par famille.
    const hidden = new Set(s.hudHidden);
    const groups: Array<[string, string[]]> = [
      [SET('hudMine'), ['hr', 'power', 'cadence', 'speed', 'avg', 'np', 'gear', 'balance', 'zones']],
      [SET('hudRoute'), ['grade', 'time', 'dist', 'gain', 'wind', 'alt', 'lap']],
      [SET('hudOthers'), ['draft', 'group', 'riders']],
      [SET('hudMap'), ['map', 'profile']],
    ];
    const grouped = new Set(groups.flatMap(([, ids]) => ids));
    // Un bloc ajouté plus tard au HUD et pas encore rangé reste proposé, dans la première famille.
    const strays = HUD_BLOCKS.filter((b) => !grouped.has(b.id)).map((b) => b.id as string);
    if (strays.length) (groups[0] as [string, string[]])[1].push(...strays);
    const check = (id: string): string => {
      const b = HUD_BLOCKS.find((x) => x.id === id);
      return b ? `<label class="mm-check"><input type="checkbox" data-hudblock="${b.id}" ${hidden.has(b.id) ? '' : 'checked'}/> ${L ? b.fr : b.en}</label>` : '';
    };
    const interfaceCat = `
      ${opt(SET('layout'), SET('nextRide'), hudPickerHtml(), true)}
      <div class="mm-opt mm-opt-col"><div class="mm-opt-l"><b>${SET('shown')}</b><small>${SET('shownHelp')}</small></div>
        <div class="set-groups">${groups.map(([title, ids]) => `<div class="set-group"><h4>${title}</h4>${ids.map(check).join('')}</div>`).join('')}</div></div>
      ${this.setAdvanced('interface', opt(SET('uiArea'), SET('uiAreaHelp'), this.seg('m-uiaspect', getUiAspectCap(), [['full', SET('uiFull')], ['16:9', '16:9'], ['21:9', '21:9']]), true))}`;

    const ride = `
      ${opt(SET('soloAi'), SET('soloAiHelp'), this.stepper('m-solo-ai', 0, 8, s.soloAiRiders ?? 0))}
      ${opt(SET('ghost'), SET('ghostHelp'), this.seg('m-ghost', s.showGhost === false ? '0' : '1', [['1', SET('shownOn')], ['0', SET('shownOff')]]))}
      ${opt(t('season'), '', this.seg('m-season', s.season, (['spring', 'summer', 'autumn', 'winter'] as const).map((q) => [q, t(q)])), true)}
      ${opt(SET('startTime'), '', this.seg('m-realtime', s.realTime ? '1' : '0', [['1', `${SET('nowTime')} · ${this.hourLabel(nowHour())}`], ['0', SET('customTime')]]), true)}
      ${s.realTime ? '' : opt(`${t('hour')}${val('m-hourv', this.hourLabel(s.hour))}`, '', range('m-hour', 5, 22, 0.25, s.hour))}
      ${opt(SET('clouds'), '', range('m-clouds', 0, 1, 0.05, s.clouds))}
      ${opt(SET('rain'), SET('rainHelp'), range('m-rain', 0, 1, 0.05, s.rain))}
      ${opt(SET('fog'), '', range('m-fog', 0, 1, 0.05, s.fog))}
      ${opt(SET('evolve'), '', this.seg('m-evolve', s.weatherEvolves ? '1' : '0', [['0', SET('fixed')], ['1', SET('changing')]]), true)}
      ${this.setAdvanced(
        'ride',
        `${opt(SET('smooth'), SET('smoothHelp'), this.seg('m-smooth', s.smoothing3s ? '1' : '0', [['0', SET('off')], ['1', '3 s']]))}
        ${opt(`${SET('stand')}${val('m-standv', s.standWatts ? `${s.standWatts} W` : 'Auto')}`, SET('standHelp'), range('m-stand', 0, 1200, 25, s.standWatts))}`,
      )}`;

    const sound = `
      <div class="mm-opt mm-opt-col"><div class="mm-opt-l"><b>${SET('music')}</b></div><div id="m-music-settings" class="mm-musicset"></div></div>
      <div class="mm-opt mm-opt-col"><div class="mm-opt-l"><b>${SET('gameSounds')}</b><small>${SET('gameSoundsHelp')}</small></div><div id="m-sound-settings"></div></div>`;

    const general = `
      ${opt(t('language'), '', this.seg('m-lang', s.lang, [['fr', 'Français'], ['en', 'English']]))}
      ${opt(SET('tutorial'), SET('tutorialHelp'), `<button type="button" class="ab-btn" id="m-tuto">${SET('tutorialAgain')}</button>`)}
      ${opt('Strava', SET('stravaHelp'), this.seg('m-strava', s.skipStrava ? 'skip' : 'send', [['skip', SET('stravaSkip')], ['send', SET('stravaSend')]]))}
      <div id="m-strava-link"></div>
      ${
        // Compte connecté : portabilité (export JSON) et droit à l'effacement (confirmation en tapant SUPPRIMER).
        this.account
          ? `<h4 class="ab-section mm-data-title">${SET('myData')}</h4>
      ${opt(SET('exportData'), SET('exportHelp'), `<button type="button" class="ab-btn mm-data-btn" id="m-export">${SET('exportGo')}</button>`)}
      ${opt(SET('deleteAccount'), SET('deleteHelp'), `<button type="button" class="ab-btn mm-danger mm-data-btn" id="m-delete" aria-expanded="false" aria-controls="m-delete-box">${SET('deleteOpen')}</button>`)}
      <div class="mm-delete-box" id="m-delete-box" hidden>
        <p class="mm-delete-what">${SET('deleteWhat')}</p>
        <label class="mm-delete-type" for="m-delete-word">${SET('deleteType')}</label>
        <div class="mm-delete-row"><input type="text" id="m-delete-word" autocomplete="off" spellcheck="false" placeholder="SUPPRIMER" /><button type="button" class="ab-btn" id="m-delete-cancel">${S('cancel')}</button><button type="button" class="ab-btn mm-danger-go" id="m-delete-go" disabled>${SET('deleteForGood')}</button></div>
        <p class="mm-delete-msg" id="m-delete-msg" aria-live="polite"></p>
      </div>`
          : ''
      }`;

    const ico = (d: string): string => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
    const cats: Array<[id: string, name: string, icon: string, body: string]> = [
      ['image', SET('catImage'), ico('<rect x="3" y="5" width="18" height="13" rx="2"/><path d="M8 21h8"/>'), image],
      ['interface', SET('catInterface'), ico('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/>'), interfaceCat],
      ['ride', SET('catRide'), ico('<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>'), ride],
      ['sound', SET('catSound'), ico('<path d="M4 10v4h4l5 4V6L8 10H4z"/><path d="M16 9a4 4 0 010 6M18.5 6.5a8 8 0 010 11"/>'), sound],
      ['companion', SET('catCompanion'), ico('<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>'), '<div id="m-companion-settings"></div>'],
      ['zones', SET('catZones'), ico('<path d="M12 4v10M8 10l4 4 4-4M5 19h14"/>'), '<div id="m-zones-settings"></div>'],
      ['general', SET('catGeneral'), ico('<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>'), general],
      ['expert', 'Expert', ico('<path d="M4 20l5-1 10-10-4-4L5 15l-1 5z"/><path d="M13 7l4 4"/>'), '<div id="m-expert-settings"></div>'],
    ];
    const cur = cats.some(([id]) => id === this.settingsCat) ? this.settingsCat : 'image';
    // Toutes les catégories restent dans la page (le branchement des réglages les trouve) ; une seule est visible.
    // Gros blocs : catégories en blocs à gauche, la catégorie choisie dans un bloc à droite (blocks.css).
    return `<section class="mm-panel mm-center mm-wide mm-xl mm-settings">${this.closeBtn()}
      <header class="mm-head"><h2 class="ab-title">${t('settings')}</h2><p class="ab-sub">${SET('sub')}</p></header>
      <div class="set-layout">
        <nav class="set-nav" aria-label="${t('settings')}">${cats.map(([id, name, icon]) => `<button type="button" data-setcat="${id}" class="set-cat${id === cur ? ' on' : ''}" aria-current="${id === cur ? 'true' : 'false'}"><span class="set-cat-ico">${icon}</span><span>${name}</span></button>`).join('')}</nav>
        <div class="set-panes">${cats.map(([id, name, , body]) => `<div class="set-pane" data-setpane="${id}" ${id === cur ? '' : 'hidden'}><h3 class="ab-section set-title">${name}</h3><div class="ab-tile ab-plain set-card">${body}</div></div>`).join('')}</div>
      </div>
    </section>`;
  }

  // ————————————————————————————————————————————— Musique et Spotify

  /** Lecteur compact de la barre du haut, et section complète dans les réglages. */
  renderMusic(): void {
    const top = this.root.querySelector('#m-music');
    if (top && musicSource() === 'spotify') {
      // Spotify piloté depuis le jeu : lecture ici, titre, commandes, playlists, volume.
      top.innerHTML = `<img class="mm-cover" id="sp-cover" alt="" hidden />
        <span class="mm-now" id="mu-now"><i class="sp">●</i> Spotify</span>
        <button class="mm-ico" id="sp-prev" title="${S('previous')}">${ICON.prev}</button>
        <button class="mm-ico on" id="sp-play" title="${S('playPauseB')}">${ICON.play}</button>
        <button class="mm-ico" id="sp-next" title="${S('nextN')}">${ICON.next}</button>
        <button class="mm-ico" id="sp-lists" title="${S('myPlaylists')}">${ICON.list}</button>
        <button class="mm-ico" id="sp-game" title="${S('switchToTheGame')}">${ICON.music}</button>
        ${
          spotify.canPlayHere
            ? `<button class="mm-spotify" id="sp-here" title="${S('playSpotifyInThe')}">${S('playHere')}</button>`
            : `<button class="mm-spotify" id="sp-relog" title="${S('reconnectOnceToAllow')}">${S('playHere2')}</button>`
        }
        <div class="mm-pop" id="sp-pop" hidden></div>`;
      const later = () => setTimeout(() => void this.refreshNowPlaying(), 700);
      top.querySelector('#sp-prev')?.addEventListener('click', () => void spotify.previous().then(later));
      // Lecture : dans le jeu dès que c'est autorisé (sinon l'appareil actif, ex. le téléphone).
      top.querySelector('#sp-play')?.addEventListener('click', () => {
        void spotify.toggleSmart().then(later);
      });
      top.querySelector('#sp-next')?.addEventListener('click', () => void spotify.next().then(later));
      top.querySelector('#sp-relog')?.addEventListener('click', () => void spotify.login());
      top.querySelector('#sp-here')?.addEventListener('click', () => {
        void spotify.playHere().then((ok) => {
          if (!ok) this.spotifyError();
          later();
        });
      });
      top.querySelector('#sp-lists')?.addEventListener('click', () => void this.spotifyPlaylists());
      top.querySelector('#sp-game')?.addEventListener('click', () => void this.switchSource('game'));
      void this.refreshNowPlaying();
    } else if (top) {
      const cur = music.enabled && music.current ? esc(music.current.title) : S('musicOff');
      top.innerHTML = `<button class="mm-ico ${music.enabled ? 'on' : ''}" id="mu-toggle" title="${S('musicOnOffB')}">${music.enabled ? ICON.music : ICON.musicOff}</button>
        <span class="mm-now" id="mu-now">${cur}</span>
        <button class="mm-ico" id="mu-next" title="${S('nextTrackN')}">${ICON.next}</button>
        <button class="mm-spotify" id="sp-login" title="${spotify.connected ? (S('switchToSpotify')) : S('connectYourSpotifyAccount')}"><i class="sp">●</i> Spotify</button>`;
      top.querySelector('#mu-toggle')?.addEventListener('click', () => {
        music.toggle();
        this.renderMusic();
      });
      top.querySelector('#mu-next')?.addEventListener('click', () => music.next());
      top.querySelector('#sp-login')?.addEventListener('click', () => (spotify.connected ? void this.switchSource('spotify') : this.spotifyConnect()));
    }
    const set = this.root.querySelector('#m-music-settings');
    if (set) {
      set.innerHTML = `<button class="btn small ${music.enabled ? 'on' : ''}" id="mu-toggle2">♪ ${S('gameMusic')} : ${music.enabled ? (music.yielded ? (S('yieldsToSpotify')) : S('on2')) : S('off3')}</button>
        <label class="mm-vol">Volume<input id="mu-vol" type="range" min="0" max="1" step="0.05" value="${music.volume}" /></label>
        ${spotify.connected ? `<span class="mm-seg-inline"><button class="btn small ${musicSource() === 'game' ? 'primary' : ''}" id="src-game">${S('sourceGameMusic')}</button><button class="btn small ${musicSource() === 'spotify' ? 'primary' : ''}" id="src-spotify">${S('sourceSpotify')}</button></span>` : ''}
        ${spotify.connected ? `<button class="btn small" id="sp-logout">${S('disconnectSpotify')}</button>` : `<button class="btn small mm-spotify" id="sp-login2"><i class="sp">●</i> ${S('connectSpotify')}</button>`}`;
      set.querySelector('#mu-toggle2')?.addEventListener('click', () => {
        music.toggle();
        this.renderMusic();
      });
      set.querySelector('#mu-vol')?.addEventListener('input', (e) => music.setVolume(Number((e.target as HTMLInputElement).value)));
      set.querySelector('#sp-login2')?.addEventListener('click', () => this.spotifyConnect());
      set.querySelector('#src-game')?.addEventListener('click', () => void this.switchSource('game'));
      set.querySelector('#src-spotify')?.addEventListener('click', () => void this.switchSource('spotify'));
      set.querySelector('#sp-logout')?.addEventListener('click', () => {
        spotify.logout();
        music.yieldToExternal(false);
        this.renderMusic();
      });
    }
  }

  /** Bascule entre la musique du jeu et Spotify (sans déconnecter le compte). */
  private async switchSource(to: 'game' | 'spotify'): Promise<void> {
    await setMusicSource(to);
    this.renderMusic();
  }

  /** Titre Spotify affiché (appelé aussi par le suivi périodique). */
  async refreshNowPlaying(): Promise<void> {
    if (!spotify.connected) return;
    const el = this.root.querySelector('#mu-now');
    if (!el) return;
    const np = await spotify.nowPlaying();
    el.innerHTML = np ? `${esc(np.title)} <span>— ${esc(np.artist)}</span>` : `<i class="sp">●</i> ${S('spotifyNothingPlaying')}`;
    el.setAttribute('title', np ? `${np.title} — ${np.artist}` : '');
    const cover = this.root.querySelector<HTMLImageElement>('#sp-cover');
    if (cover) {
      cover.hidden = !np?.image;
      if (np?.image) cover.src = np.image;
    }
    const play = this.root.querySelector('#sp-play');
    if (play) play.innerHTML = np?.isPlaying ? ICON.pause : ICON.play;
    const here = this.root.querySelector<HTMLElement>('#sp-here');
    if (here) {
      const on = np?.isPlaying ? await spotify.playingHere() : false;
      here.classList.toggle('on', on);
      here.textContent = on ? (S('inGame')) : S('playHere');
    }
  }

  private spotifyError(): void {
    const msg = spotify.playerError || (S('cannotPlayInThe'));
    const el = this.root.querySelector('#mu-now');
    if (el) el.innerHTML = `<span class="warn-text">${esc(msg)}</span>`;
  }

  /** Liste des playlists du compte : un clic la lance dans le jeu. */
  private async spotifyPlaylists(): Promise<void> {
    const pop = this.root.querySelector<HTMLElement>('#sp-pop');
    if (!pop) return;
    if (!pop.hidden) {
      pop.hidden = true;
      return;
    }
    pop.hidden = false;
    pop.innerHTML = `<div class="mm-pop-head">${S('myPlaylists')}</div><div class="mm-hint">${S('loading2')}</div>`;
    const lists = await spotify.playlists();
    pop.innerHTML = `<div class="mm-pop-head">${S('myPlaylists')}
        <label class="mm-vol">Volume<input id="sp-vol" type="range" min="0" max="1" step="0.05" value="${spotify.volume}" /></label></div>
      <div class="mm-pop-list">${
        lists.length
          ? lists.map((p) => `<button class="mm-pl" data-uri="${esc(p.uri)}">${p.image ? `<img src="${esc(p.image)}" alt="" />` : '<i></i>'}<b>${esc(p.name)}</b><span>${p.tracks}</span></button>`).join('')
          : `<p class="mm-hint">${spotify.canPlayHere ? (S('noPlaylists')) : S('clickPlayHereReconnect')}</p>`
      }</div>`;
    pop.querySelector('#sp-vol')?.addEventListener('input', (e) => {
      // Même volume partout (Réglages, pause, compagnon) : Spotify et la musique du jeu.
      const v = Number((e.target as HTMLInputElement).value);
      spotify.setHereVolume(v);
      music.setVolume(v);
    });
    pop.querySelectorAll<HTMLElement>('[data-uri]').forEach((b) =>
      b.addEventListener('click', () => {
        pop.hidden = true;
        void spotify.playContext(b.dataset.uri as string).then((ok) => {
          if (!ok) this.spotifyError();
          setTimeout(() => void this.refreshNowPlaying(), 900);
        });
      }),
    );
  }

  /** Connexion Spotify ; la première fois, assistant pour déclarer l'application (identifiant client). */
  private spotifyConnect(): void {
    if (spotify.available) {
      void spotify.login();
      return;
    }
    const uri = redirectUri();
    const local = location.hostname === 'localhost';
    const dlg = document.createElement('div');
    dlg.className = 'mm-modal';
    dlg.innerHTML = `<div class="mm-dialog mm-spdlg" role="dialog" aria-modal="true" aria-labelledby="sp-title">
      <header class="sp-head">
        <h2 class="ab-title" id="sp-title"><i class="sp" aria-hidden="true">●</i> ${S('connectSpotify')}</h2>
        <p class="ab-sub">${S('oneTimeOnlySpotify')}</p>
      </header>
      <section class="sp-sec">
        <h3 class="ab-section">${MX('spSteps')}</h3>
        <ol class="sp-steps">
          <li>${S('open')} <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">developer.spotify.com/dashboard</a> ${S('andClickCreateApp')}</li>
          <li>${S('nameAllezRobertApi')}</li>
          <li>${S('redirectUriCopyExactly')} <span class="sp-uri"><code>${esc(uri)}</code> <button class="ab-btn ab-chip sp-copy" id="sp-copy">${S('copy')}</button></span></li>
          <li>${S('saveThenPasteThe')}</li>
        </ol>
      </section>
      <section class="sp-sec">
        <h3 class="ab-section"><label for="sp-id">${MX('spClientId')}</label></h3>
        <input id="sp-id" class="mm-input sp-input" placeholder="Client ID" autocomplete="off" spellcheck="false" />
        ${local ? `<p class="sp-hint">${S('spotifyRejectsLocalhostOn')}</p>` : ''}
        <p class="sp-hint">${S('musicPlaysFromYour')}</p>
      </section>
      <div class="ab-foot sp-foot"><div class="ab-btns"><button class="ab-btn" id="sp-cancel">${S('cancel')}</button><button class="ab-btn ab-go" id="sp-ok">${S('signInToSpotify')}</button></div></div>
    </div>`;
    this.root.appendChild(dlg);
    const close = () => dlg.remove();
    dlg.querySelector('#sp-cancel')?.addEventListener('click', close);
    dlg.addEventListener('click', (e) => e.target === dlg && close());
    dlg.addEventListener('keydown', (e) => e.key === 'Escape' && close());
    dlg.querySelector('#sp-copy')?.addEventListener('click', () => void navigator.clipboard?.writeText(uri));
    dlg.querySelector('#sp-ok')?.addEventListener('click', () => {
      const input = dlg.querySelector('#sp-id') as HTMLInputElement;
      if (!spotify.setClientId(input.value)) {
        input.classList.add('bad');
        input.focus();
        return;
      }
      void spotify.login();
    });
    (dlg.querySelector('#sp-id') as HTMLInputElement).focus();
  }

  // ————————————————————————————————————————————— Capteurs

  private renderDevices(): void {
    const box = this.root.querySelector('#m-devices');
    if (!box) return;
    const list = this.devices.list();
    const transports = this.devices.transports();
    const previousTransport = box.querySelector<HTMLElement>('#m-transport')?.dataset.value;
    const selectedTransport = transports.find((tr) => tr.id === previousTransport)?.id ?? transports[0]?.id ?? '';
    const live = this.devices.live?.();
    // Appareils en gros blocs, comme sur l'écran « Prêt à rouler ? » (mêmes dessins, mêmes mots d'état).
    box.innerHTML = `
      ${deviceTilesHtml({ devices: list, live, simulatorOn: this.devices.simulatorOn(), icons: START_ICONS, liveText: (k) => liveText(k, live), canReconnect: !!this.devices.reconnect, roadFeel: !!this.devices.roadFeelSupported?.(), cassette: this.s.drivetrain === 'cassette' })}
      ${deviceOptionsHtml({ transportSeg: this.seg('m-transport', selectedTransport, transports.map((tr) => [tr.id, tr.label])), bluetooth: selectedTransport === 'web-bluetooth', simulatorOn: this.devices.simulatorOn(), guest: this.s.guest, warnings: this.devices.warnings(), modes: false })}
      <div id="m-devextra"></div>`;
    this.bindSegs(box);
    // Mesures en direct : rafraîchies chaque seconde tant que l'écran Capteurs est affiché.
    clearInterval(this.devLiveTimer);
    this.devLiveTimer = setInterval(() => {
      if (!box.isConnected) return clearInterval(this.devLiveTimer);
      const now = this.devices.live?.();
      box.querySelectorAll<HTMLElement>('[data-live]').forEach((el) => (el.textContent = liveText(el.dataset.live as LiveKind, now)));
    }, 1000);
    const extra = box.querySelector<HTMLElement>('#m-devextra');
    if (extra) this.devices.renderExtras?.(extra);
    box.querySelectorAll<HTMLButtonElement>('[data-pair]').forEach((b) =>
      b.addEventListener('click', async () => {
        const transport = (box.querySelector('#m-transport') as HTMLElement).dataset.value ?? '';
        b.disabled = true;
        try {
          await this.devices.pair(b.dataset.pair as Role, transport);
        } catch (e) {
          alert(String((e as Error).message ?? e));
        } finally {
          b.disabled = false;
          this.renderDevices();
        }
      }),
    );
    box.querySelectorAll<HTMLButtonElement>('[data-forget]').forEach((b) => b.addEventListener('click', () => this.devices.forget(b.dataset.forget as string)));
    box.querySelectorAll<HTMLButtonElement>('[data-reconnect]').forEach((b) => b.addEventListener('click', () => this.devices.reconnect?.(b.dataset.reconnect as string)));
    box.querySelector('[data-roadtest-open]')?.addEventListener('click', () => {
      const sec = box.querySelector<HTMLDetailsElement>('details[data-sec="road"]');
      if (!sec) return;
      sec.open = true;
      sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    // Rouler sans matériel (simulateur, invité) : tout en bas de l'écran, sous les réglages du home trainer.
    const modes = this.root.querySelector<HTMLElement>('#m-devmodes');
    if (modes) modes.innerHTML = deviceModesHtml({ simulatorOn: this.devices.simulatorOn(), guest: this.s.guest });
    modes?.querySelector<HTMLInputElement>('#m-guest')?.addEventListener('change', (e) => {
      this.s.guest = (e.target as HTMLInputElement).checked;
      saveSettings(this.s);
    });
    modes?.querySelector<HTMLInputElement>('#m-sim')?.addEventListener('change', (e) => {
      this.devices.useSimulator((e.target as HTMLInputElement).checked);
      this.renderDevices();
      this.renderStatus();
    });
    if (this.devices.adapters) {
      void this.devices.adapters().then((ads) => {
        const el = box.querySelector('#m-adapters');
        if (!el || ads.length < 2) return;
        el.innerHTML = `<label class="field">${S('bluetoothAdapter')}<select id="m-adapter">${ads.map((a) => `<option value="${esc(a.id)}" ${a.isDefault ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>`;
        el.querySelector('select')?.addEventListener('change', (e) => void this.devices.selectAdapter?.((e.target as HTMLSelectElement).value));
        enhanceSelects(el);
      });
    }
  }

  /**
   * Pas de départ tant que la carte de la zone n'est pas téléchargée (le téléchargement démarre
   * tout seul), application Windows comme navigateur. Sans stockage hors ligne, la zone se charge depuis le serveur.
   */
  private zoneReady(args: Parameters<MenuCallbacks['onStart']>): boolean {
    const z = this.zones.find((c) => c.id === this.worldId);
    if (!z?.pack) return true;
    if (packState(z.id, z.pack.version).kind !== 'absent') return true;
    const busy = this.downloads.get(z.id);
    if (!busy || busy.error) void this.downloadZone(z.id);
    this.showZoneDownload(z.id, () => this.launch(...args));
    return false;
  }

  /** Écran d'attente du téléchargement d'une zone : barre et pourcentage lus sur la même valeur ; départ automatique à la fin. */
  private showZoneDownload(id: string, then: () => void): void {
    const L = fr();
    document.querySelector('.world-wait.zone-dl')?.remove();
    const el = document.createElement('div');
    el.className = 'world-wait zone-dl';
    const tip = inTauri
      ? ''
      : L
        ? 'Astuce : l’application Windows télécharge les zones plus vite et les garde sur ton ordinateur. <a href="/#telecharger" target="_blank" rel="noopener" style="color:#ffd23f">Télécharger l’application</a>'
        : 'Tip: the Windows app downloads areas faster and keeps them on your computer. <a href="/#telecharger" target="_blank" rel="noopener" style="color:#ffd23f">Get the app</a>';
    el.innerHTML = `<div class="world-wait-box"><div class="world-wait-bar"><i style="animation:none;width:0%"></i></div><span></span><small class="world-wait-tip">${tip}</small><button class="btn small" style="margin-top:14px">${S('cancel')}</button></div>`;
    document.body.appendChild(el);
    const bar = el.querySelector<HTMLElement>('.world-wait-bar i') as HTMLElement;
    const label = el.querySelector<HTMLElement>('.world-wait-box > span') as HTMLElement;
    const name = this.zoneLabel(id);
    const stop = () => {
      clearInterval(timer);
      el.remove();
    };
    el.querySelector('button')?.addEventListener('click', stop);
    const tick = () => {
      const dl = this.downloads.get(id);
      if (dl?.error) {
        clearInterval(timer);
        // Échec : Robert bras croisés, ce qui s'est passé en clair, l'astuce de l'appli, puis « Fermer ».
        const missing = /pas publiée|introuvable/.test(dl.error);
        const why = missing
          ? S('thisAreaIsNot')
          : S('theDownloadWasInterrupted');
        el.innerHTML = `<div class="world-wait-box zone-dl-err"><img class="world-wait-bike" src="${crossedArmsSrc()}" alt="" /><h3>${S('areaUnavailable')}</h3><p>${why}</p>${tip ? `<small class="world-wait-tip">${tip}</small>` : ''}<button class="btn primary" style="margin-top:16px">${S('close')}</button></div>`;
        el.querySelector('button')?.addEventListener('click', () => el.remove());
        return;
      }
      if (!dl) {
        stop();
        if (packState(id, this.zones.find((c) => c.id === id)?.pack?.version).kind === 'installed') then();
        return;
      }
      const pct = Math.floor((dl.done / Math.max(dl.total, 1)) * 100);
      bar.style.transition = 'none';
      bar.style.width = `${pct}%`;
      label.textContent = `${S('downloading2')} ${name} ${pct} %`;
    };
    const timer = setInterval(tick, 150);
    tick();
  }

  /** Départ d'une sortie : l'appli compagnon est d'abord proposée (tous les modes). */
  private launch(...args: Parameters<MenuCallbacks['onStart']>): void {
    if (!this.zoneReady(args)) return;
    void companionQr()
      .beforeRide()
      .then(() => this.cb.onStart(...args));
  }

  private start(more: { customRoute?: RouteData; openStart?: { x: number; z: number } } = {}): void {
    const invite = (this.root.querySelector('#m-invite') as HTMLInputElement | null)?.value.trim();
    if (this.s.realTime) this.s.hour = nowHour();
    const laps = Number((this.root.querySelector('#m-laps') as HTMLInputElement | null)?.value);
    if (Number.isFinite(laps) && laps >= 1) this.s.raceLaps = Math.min(20, Math.round(laps));
    this.launch(this.s, { ...(this.workoutFile ? { workoutFile: this.workoutFile } : {}), ...(invite ? { inviteCode: invite } : {}), ...more });
  }

  // ————————————————————————————————————————————— Événements

  private bind(): void {
    const s = this.s;
    this.bindSegs(this.root.querySelector('.mm-panel') ?? this.root);
    this.bindSteppers(this.root);
    const on = <T extends HTMLElement>(id: string, ev: string, fn: (el: T) => void) => {
      const el = this.root.querySelector(`#${id}`) as T | null;
      el?.addEventListener(ev, () => fn(el));
    };
    const changed = () => {
      saveSettings(s);
      this.onSettingsChange?.(s);
      this.onSettingsSaved?.(s);
    };
    this.root.querySelectorAll<HTMLElement>('[data-tab]').forEach((el) =>
      el.addEventListener('click', () => {
        // « Rouler » de l'accueil : premier geste de l'utilisateur, le son est autorisé ; au premier lancement, le tutoriel prend la suite.
        if (this.tab === 'home' && el.dataset.tab === 'ride') {
          music.unlock();
          if (this.onHomeRide?.()) return;
        }
        // Nom ou avatar du coureur : sa fiche, pas l'historique.
        if (el.classList.contains('mm-me')) this.profileView = 'profile';
        this.go(el.dataset.tab as Tab);
      }),
    );
    on('m-tuto', 'click', () => this.onTutorial?.());
    on('m-login', 'click', () => this.onLogin?.());
    on('m-logout', 'click', () => this.onLogout?.());
    // Mes données : export JSON du compte, suppression après avoir tapé SUPPRIMER.
    on('m-export', 'click', async () => {
      const res = await fetch(`${apiBase()}/me/export`, { credentials: 'include' }).catch(() => null);
      if (!res?.ok) return;
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement('a'), { href: url, download: 'allez-robert-mes-donnees.json' });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    });
    // La confirmation s'ouvre sous la ligne ; « Annuler » la referme et vide la saisie.
    const deleteBox = (open: boolean) => {
      const box = this.root.querySelector<HTMLElement>('#m-delete-box');
      const word = this.root.querySelector<HTMLInputElement>('#m-delete-word');
      const go = this.root.querySelector<HTMLButtonElement>('#m-delete-go');
      const opener = this.root.querySelector<HTMLButtonElement>('#m-delete');
      if (box) box.hidden = !open;
      opener?.setAttribute('aria-expanded', String(open));
      if (opener) opener.disabled = open;
      if (open) return word?.focus();
      if (word) word.value = '';
      if (go) go.disabled = true;
    };
    on('m-delete', 'click', () => deleteBox(true));
    on('m-delete-cancel', 'click', () => deleteBox(false));
    on<HTMLInputElement>('m-delete-word', 'input', (el) => {
      const go = this.root.querySelector<HTMLButtonElement>('#m-delete-go');
      if (go) go.disabled = el.value.trim() !== 'SUPPRIMER';
    });
    on('m-delete-go', 'click', async () => {
      const res = await fetch(`${apiBase()}/me`, { method: 'DELETE', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'SUPPRIMER' }) }).catch(() => null);
      if (res?.ok) {
        this.onLogout?.();
        return;
      }
      const msg = this.root.querySelector<HTMLElement>('#m-delete-msg');
      if (msg) msg.textContent = `${SET('deleteFailed')}${res ? ` (${res.status})` : ''}`;
    });
    // Application installée : enregistre le profil puis ferme le jeu.
    on('m-quit', 'click', () => void quitApp());
    // Crédits : mènent à l'atelier du garage, où ils se dépensent (le bloc voisin ouvre le profil, d'où stopPropagation).
    const credits = this.root.querySelector<HTMLElement>('.mm-credits');
    const openWorkshop = (e: Event) => {
      e.stopPropagation();
      this.garageSlot = 'atelier';
      this.go('garage');
    };
    credits?.addEventListener('click', openWorkshop);
    credits?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openWorkshop(e);
      }
    });
    // Rouler : le parcours dessiné ou le départ du libre choisis sur la carte.
    on('m-start', 'click', () => {
      const drawn = this.drawnChoice;
      this.start(drawn ? { customRoute: drawn } : s.mode === 'open' && this.freeStart ? { openStart: this.freeStart } : {});
    });
    on('m-explore', 'click', () => this.onExplore?.());
    // Itinéraire sur la carte : parcours calculé (sortie libre sur ce tracé) ou roulage libre.
    this.planner.noFree = s.mode === 'race';
    if (this.picker === 'map' && this.openWorld)
      this.planner.bind(this.root, (r) => this.routeCard(r), {
        // « Rouler cet itinéraire » / « Rouler en libre » : la sortie part tout de suite.
        ride: (route) => {
          this.drawn = route;
          this.drawnWorld = this.worldId;
          s.routeId = route.id;
          s.reverse = false;
          s.startM = 0;
          if (s.mode !== 'free' && s.mode !== 'workout' && s.mode !== 'race') s.mode = 'free';
          this.picker = null;
          changed();
          this.start({ customRoute: route });
        },
        free: (start) => {
          s.mode = 'open';
          this.freeStart = start;
          this.drawnWorld = this.worldId;
          this.picker = null;
          changed();
          this.start(start ? { openStart: start } : {});
        },
      });
    // Rouler : modes et itinéraires.
    this.root.querySelectorAll<HTMLElement>('[data-mode]').forEach((el) =>
      el.addEventListener('click', () => {
        const v = el.dataset.mode as Settings['mode'];
        if (!(v === 'free' && s.mode === 'open')) s.mode = v;
        // Entraînement : la liste des séances s'ouvre au milieu de l'écran, comme la carte de France.
        if (v === 'workout') this.picker = 'workouts';
        if (v === 'challenge') this.picker = 'koms';
        changed();
        this.render();
      }),
    );
    this.root.querySelectorAll<HTMLElement>('[data-kom]').forEach((el) =>
      el.addEventListener('click', () => {
        // Montée d'une autre zone : la zone se charge, la montée est choisie à son arrivée.
        if (el.dataset.komZone && el.dataset.komZone !== this.worldId && this.onWorld) {
          this.pendingKom = { routeId: el.dataset.komRoute as string, segId: el.dataset.kom as string };
          this.picker = null;
          this.loadingZone = this.zoneLabel(el.dataset.komZone);
          s.mode = 'challenge';
          this.onWorld(el.dataset.komZone);
          return;
        }
        s.mode = 'challenge';
        s.challengeSeg = el.dataset.kom as string;
        // montée d'un autre parcours de la zone : on prend ce parcours (dans son sens)
        if (el.dataset.komRoute && el.dataset.komRoute !== s.routeId) {
          s.routeId = el.dataset.komRoute;
          s.reverse = false;
        }
        // choisie dans la fenêtre de la zone : la fenêtre se ferme
        if (this.picker) this.picker = null;
        changed();
        this.render();
      }),
    );
    const komInput = this.root.querySelector<HTMLInputElement>('#m-kom-q');
    if (komInput) {
      const norm = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
      const apply = () => {
        const words = norm(this.komQuery).split(/\s+/).filter(Boolean);
        let n = 0;
        this.root.querySelectorAll<HTMLElement>('.kom-tile[data-kom]').forEach((tr) => {
          const ok = words.every((w) => (tr.dataset.search ?? '').includes(w));
          tr.hidden = !ok;
          if (ok) n++;
        });
        const foot = this.root.querySelector<HTMLElement>('.kom-foot span');
        if (foot && words.length) foot.textContent = count(n, 'climbFound1', 'climbFoundN');
        let none = this.root.querySelector<HTMLElement>('.kom-nomatch');
        if (words.length && n === 0 && !none) {
          none = document.createElement('p');
          none.className = 'mm-hint kom-nomatch';
          none.textContent = S('noClimbMatches');
          this.root.querySelector('.kom-wrap')?.after(none);
        } else if (none && (n > 0 || !words.length)) none.remove();
      };
      komInput.addEventListener('input', () => {
        this.komQuery = komInput.value;
        apply();
      });
      if (this.komQuery) apply();
    }
    this.root.querySelectorAll<HTMLElement>('[data-komzone]').forEach((el) =>
      el.addEventListener('click', () => {
        this.komZone = el.dataset.komzone ?? '';
        this.render();
      }),
    );
    // Titres de colonnes du Défi KOM : tri par nom, longueur, pente ou record ; un second clic inverse l'ordre.
    this.root.querySelectorAll<HTMLElement>('[data-komsort]').forEach((el) =>
      el.addEventListener('click', () => {
        const key = el.dataset.komsort as 'name' | 'length' | 'grade' | 'best';
        // Longueur et pente : la plus grande d'abord au premier clic ; nom et record : ordre croissant.
        const first: 1 | -1 = key === 'length' || key === 'grade' ? -1 : 1;
        this.komSort = this.komSort?.key === key ? { key, dir: this.komSort.dir === 1 ? -1 : 1 } : { key, dir: first };
        this.render();
      }),
    );
    this.root.querySelectorAll<HTMLElement>('[data-fav]').forEach((el) => {
      const toggle = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        const id = el.dataset.fav as string;
        if (this.favWorkouts.has(id)) this.favWorkouts.delete(id);
        else this.favWorkouts.add(id);
        try {
          localStorage.setItem(FAV_KEY, JSON.stringify([...this.favWorkouts]));
        } catch {
          // Stockage indisponible : favoris pour cette session seulement.
        }
        this.render();
      };
      el.addEventListener('click', toggle);
      el.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && toggle(e));
    });
    // Studio des séances : un clic sur une ligne montre sa fiche, un double clic la choisit.
    this.root.querySelectorAll<HTMLElement>('[data-wksel]').forEach((el) => {
      const show = () => {
        this.wkSel = el.dataset.wksel ?? null;
        this.render();
      };
      el.addEventListener('click', show);
      el.addEventListener('dblclick', () => this.root.querySelector<HTMLElement>('.ws-go')?.click());
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          show();
        }
      });
    });
    this.root.querySelectorAll<HTMLElement>('[data-preset]').forEach((el) =>
      el.addEventListener('click', () => {
        const preset = el.dataset.preset as string;
        // Séance perso : jouée comme un fichier (format JSON du jeu).
        const mine = preset.startsWith('mine:') ? this.myWorkouts.find((w) => `mine:${w.id}` === preset) : undefined;
        if (mine) {
          this.workoutFile = { name: `${mine.name}.json`, content: JSON.stringify({ name: mine.name, ...(mine.description ? { description: mine.description } : {}), steps: mine.steps }) };
          if (this.picker === 'workouts') this.picker = null;
          this.render();
          return;
        }
        this.wkSel = null;
        s.workoutPreset = preset;
        this.workoutFile = undefined;
        if (this.picker === 'workouts') this.picker = null;
        changed();
        this.render();
      }),
    );
    // Carte de France : une zone choisie ouvre ses choix (parcours, libre, à dessiner).
    if (this.picker === 'zones') {
      const openZone = (id: string): void => {
        if (id === this.worldId) {
          this.picker = 'zone';
          this.render();
          return;
        }
        if (this.loadingZone) return;
        this.routesAfterWorld = true;
        this.loadingZone = this.mapZones().find((z) => z.id === id)?.name ?? id;
        const hint = this.root.querySelector('.fm-dialog .mm-hint');
        if (hint) hint.textContent = `${S('loading')} ${this.loadingZone}…`;
        this.onWorld?.(id);
      };
      this.franceMap.bind(this.root, this.mapZones(), openZone);
      // Liste des zones : même action que le point de la carte ; recherche par nom sans redessiner.
      this.root.querySelectorAll<HTMLElement>('[data-zonepick]').forEach((el) => el.addEventListener('click', () => openZone(el.dataset.zonepick as string)));
      const zq = this.root.querySelector<HTMLInputElement>('#m-zonepick-q');
      if (zq) {
        const applyZones = (): void => {
          const words = this.zonePickQuery.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().split(/\s+/).filter(Boolean);
          let shown = 0;
          this.root.querySelectorAll<HTMLElement>('.zp-tile').forEach((el) => {
            const ok = words.every((x) => (el.dataset.search ?? '').includes(x));
            el.hidden = !ok;
            if (ok) shown++;
          });
          const none = this.root.querySelector<HTMLElement>('.zp-none');
          if (none) none.hidden = shown > 0;
        };
        zq.addEventListener('input', () => {
          this.zonePickQuery = zq.value;
          applyZones();
        });
        if (this.zonePickQuery) applyZones();
      }
    }
    on('m-all-paris', 'click', () => {
      if (this.loadingZone) return;
      this.loadingZone = S('allOfParis2');
      this.render();
      this.onWorld?.(compositeId([...new Set([...PARIS_CITY_ZONES, ...this.loadedZones])]));
    });
    // Zones voisines : ajoutées ou retirées, le monde est rechargé avec elles (même zone principale).
    this.root.querySelectorAll<HTMLElement>('[data-near]').forEach((el) =>
      el.addEventListener('click', () => {
        if (this.loadingZone) return;
        const id = el.dataset.near as string;
        const on = new Set(this.loadedZones.filter((z) => z !== this.worldId));
        if (on.has(id)) on.delete(id);
        else on.add(id);
        this.loadingZone = id;
        this.render();
        this.onWorld?.(compositeId([this.worldId, ...on]));
      }),
    );
    // Zone ouverte : parcours fixés, parcours libre (départ par défaut), parcours à dessiner.
    this.root.querySelectorAll<HTMLElement>('[data-zc]').forEach((el) =>
      el.addEventListener('click', () => {
        const c = el.dataset.zc;
        // Parcours libre : la carte de la zone s'ouvre pour fixer le point de départ.
        if (c === 'free' && this.openWorld) {
          this.planner.startOnly = true;
          this.picker = 'map';
          this.render();
          return;
        }
        if (c === 'free') {
          this.selMap = true;
          s.mode = 'open';
          this.freeStart = null;
          this.picker = null;
          changed();
          this.render();
          return;
        }
        this.planner.startOnly = false;
        this.picker = c === 'draw' ? 'map' : 'routes';
        this.render();
      }),
    );
    // « Choisir ma sortie » et carte du choix : fenêtre de choix au milieu de l'écran.
    this.root.querySelectorAll<HTMLElement>('[data-picker]').forEach((el) =>
      el.addEventListener('click', () => {
        this.picker = el.dataset.picker as 'zones' | 'zone' | 'routes' | 'map' | 'route' | 'workouts' | 'koms';
        if (this.picker === 'zones' && el.closest('.mm-pickers')) this.franceMap.reset();
        this.render();
      }),
    );
    this.root.querySelectorAll<HTMLElement>('[data-picker-close]').forEach((el) =>
      el.addEventListener('click', (e) => {
        if (e.target === el) this.closePicker();
      }),
    );
    // Zones : télécharger ou supprimer le pack de cartes.
    this.root.querySelectorAll<HTMLElement>('[data-pack]').forEach((el) => el.addEventListener('click', () => void this.downloadZone(el.dataset.pack as string)));
    // Carte de parcours : sa fiche s'ouvre (records, montées) ; on part ou on le choisit depuis elle.
    this.root.querySelectorAll<HTMLElement>('[data-route]').forEach((el) =>
      el.addEventListener('click', (e) => {
        // Bouton « Fiche » d'un bloc : le clic ne doit pas aussi choisir le parcours.
        e.stopPropagation();
        this.detailId = el.dataset.route as string;
        this.detailReverse = this.detailId === s.routeId && s.reverse;
        this.detailStartM = this.detailId === s.routeId ? s.startM || 0 : 0;
        this.fromRect = el.getBoundingClientRect();
        this.picker = 'route';
        this.render();
      }),
    );
    const pickRoute = () => {
      this.selMap = true;
      s.routeId = this.detailId;
      s.reverse = this.detailReverse;
      s.startM = this.detailStartM;
      if (s.mode === 'open' || s.mode === 'ftpTest' || s.mode === 'challenge') s.mode = 'free';
      this.picker = null;
      changed();
    };
    // Bloc d'un parcours (fenêtre « Parcours ») : un clic ou Entrée le choisit et ferme la fenêtre.
    this.root.querySelectorAll<HTMLElement>('[data-routepick]').forEach((el) => {
      const choose = (): void => {
        const id = el.dataset.routepick as string;
        // Parcours déjà choisi : son sens et son départ sont gardés.
        this.detailReverse = id === s.routeId && s.reverse;
        this.detailStartM = id === s.routeId ? s.startM || 0 : 0;
        this.detailId = id;
        pickRoute();
        this.render();
      };
      el.addEventListener('click', choose);
      el.addEventListener('keydown', (e) => {
        if (e.target === el && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          choose();
        }
      });
    });
    // Tri des parcours : boutons de la fenêtre (hors du panneau où les choix segmentés sont branchés d'office).
    this.root.querySelectorAll<HTMLElement>('#m-routesort [data-v]').forEach((el) =>
      el.addEventListener('click', () => {
        this.routeSort = (el.dataset.v ?? 'default') as 'default' | 'dist' | 'climb';
        this.render();
      }),
    );
    this.root.querySelectorAll<HTMLElement>('[data-rd]').forEach((el) =>
      el.addEventListener('click', () => {
        pickRoute();
        if (el.dataset.rd === 'ride') this.start();
        else this.render();
      }),
    );
    // Défi sur une montée de la fiche : mode défi KOM sur ce parcours, départ lancé.
    this.root.querySelectorAll<HTMLElement>('[data-rd-kom]').forEach((el) =>
      el.addEventListener('click', () => {
        pickRoute();
        s.mode = 'challenge';
        s.challengeSeg = el.dataset.rdKom as string;
        changed();
        this.start();
      }),
    );
    if (this.picker === 'route') {
      const r = this.routes.find((x) => x.id === this.detailId);
      if (r) void loadRouteBoards(this.root, this.detailRoute(r), !!this.account);
      // Sens du parcours : la fiche se refait pour l'autre sens (profil, montées, records) ; le
      // départ choisi reste au même endroit du tracé.
      this.root.querySelectorAll<HTMLElement>('#rd-dir [data-v]').forEach((el) =>
        el.addEventListener('click', () => {
          const rev = el.dataset.v === '1';
          if (r && rev !== this.detailReverse) {
            this.detailReverse = rev;
            this.detailStartM = snapStartM(this.detailDir(r), mirrorStartM(r.lengthM, this.detailStartM));
          }
          this.render();
        }),
      );
      // Départ choisi sur la carte (boucles) : la fiche se refait depuis ce point.
      const setStart = (startM: number) => {
        if (startM === this.detailStartM) return;
        this.detailStartM = startM;
        this.render();
      };
      if (r) {
        const dir = this.detailDir(r);
        bindStartPicker(this.root, this.detailRoute(r), (d) => setStart(snapStartM(dir, d + this.detailStartM)));
      }
      this.root.querySelectorAll<HTMLElement>('[data-rd-start]').forEach((el) => el.addEventListener('click', () => setStart(0)));
    }
    this.animatePicker();
    on<HTMLInputElement>('m-workout', 'change', async (el) => {
      const f = el.files?.[0];
      if (!f) return;
      this.workoutFile = { name: f.name, content: await f.text() };
      // Gardée dans « Mes séances » (et synchronisée avec le compte).
      try {
        const parsed = parseWorkoutFile(f.name, this.workoutFile.content);
        const ext = f.name.toLowerCase().split('.').pop() ?? '';
        if (ext === 'zwo' || ext === 'erg' || ext === 'mrc') {
          const name = (parsed.name || f.name.replace(/\.[^.]+$/, '')).slice(0, 100);
          await rideHistory.saveWorkout({ id: `${ext}.${contentId(this.workoutFile.content)}`, name, source: ext, type: null, description: parsed.description ?? null, steps: parsed.steps, deleted: false });
          this.myWorkouts = await rideHistory.workouts();
        }
      } catch (err) {
        console.warn('Séance non gardée', err);
      }
      if (this.picker === 'workouts') this.picker = null;
      this.render();
    });
    this.root.querySelectorAll<HTMLElement>('[data-pview]').forEach((el) =>
      el.addEventListener('click', () => {
        this.profileView = el.dataset.pview as 'profile' | 'history';
        this.render();
      }),
    );
    this.root.querySelectorAll<HTMLElement>('[data-wkfilter]').forEach((el) =>
      el.addEventListener('click', () => {
        this.wkFilter = (el.dataset.wkfilter ?? '') as WorkoutType | 'mine' | '';
        if (this.wkFilter === 'mine') void rideHistory.workouts().then((list) => {
          this.myWorkouts = list;
          if (this.picker === 'workouts') this.render();
        });
        this.render();
      }),
    );
    // Studio des séances : filtre de durée, recherche, tri, intensité.
    this.root.querySelectorAll<HTMLElement>('[data-wkdur]').forEach((el) =>
      el.addEventListener('click', () => {
        this.wkDur = (el.dataset.wkdur ?? '') as WorkoutDurFilter;
        this.render();
      }),
    );
    const wkQ = this.root.querySelector<HTMLInputElement>('#ws-q');
    wkQ?.addEventListener('input', () => {
      this.wkQuery = wkQ.value;
      this.wkQueryCaret = wkQ.selectionStart ?? wkQ.value.length;
      this.render();
    });
    // Échap vide la recherche avant de fermer la fenêtre.
    wkQ?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && wkQ.value) {
        e.preventDefault();
        e.stopPropagation();
        this.wkQuery = '';
        this.wkQueryCaret = 0;
        this.render();
      }
    });
    this.root.querySelector<HTMLSelectElement>('#ws-sort')?.addEventListener('change', (e) => {
      this.wkSort = (e.target as HTMLSelectElement).value as WorkoutSort;
      this.render();
    });
    this.root.querySelectorAll<HTMLElement>('[data-wkreset]').forEach((el) =>
      el.addEventListener('click', () => {
        this.wkQuery = '';
        this.wkDur = '';
        this.render();
      }),
    );
    this.root.querySelectorAll<HTMLElement>('[data-wkint]').forEach((el) =>
      el.addEventListener('click', () => {
        const step = Number(el.dataset.wkint);
        s.workoutIntensity = step === 0 ? 1 : clampWorkoutIntensity(clampWorkoutIntensity(s.workoutIntensity) + step * 0.05);
        changed();
        this.render();
      }),
    );
    // Éditeur de visage : aperçu immédiat pendant le glissement, enregistrement au relâcher.
    const faceLive = (look: AvatarLook) => {
      s.look = look;
      this.onLookLive?.(look, this.bareHeadPreview);
    };
    const faceCommit = (before: AvatarLook) => {
      this.faceUndo.push(before);
      if (this.faceUndo.length > 30) this.faceUndo.shift();
      saveSettings(s);
      this.onSettingsSaved?.(s);
      const undo = this.root.querySelector<HTMLButtonElement>('#fe-undo');
      if (undo) undo.disabled = false;
    };
    const faceSet = (look: AvatarLook) => {
      const before = s.look;
      faceLive(look);
      faceCommit(before);
      this.render();
    };
    this.root.querySelectorAll<HTMLInputElement>('[data-feslider]').forEach((el) => {
      let before: AvatarLook | null = null;
      el.addEventListener('input', () => {
        before ??= s.look;
        faceLive(withSlider(s.look, el.dataset.feslider as FaceSlider, Number(el.value)));
      });
      el.addEventListener('change', () => {
        if (before) faceCommit(before);
        before = null;
      });
    });
    const feNum = (id: string, key: 'beard' | 'freckles') =>
      on<HTMLInputElement>(id, 'input', (el) => faceLive({ ...s.look, [key]: Number(el.value) }));
    feNum('fe-beard', 'beard');
    feNum('fe-freckles', 'freckles');
    for (const id of ['fe-beard', 'fe-freckles', 'fe-skin', 'fe-hair']) {
      let before: AvatarLook | null = null;
      on<HTMLInputElement>(id, 'pointerdown', () => (before = s.look));
      on<HTMLInputElement>(id, 'change', () => {
        faceCommit(before ?? s.look);
        before = null;
      });
    }
    on<HTMLInputElement>('fe-skin', 'input', (el) => faceLive({ ...s.look, skin: el.value }));
    on<HTMLInputElement>('fe-hair', 'input', (el) => faceLive({ ...s.look, hair: el.value }));
    on<HTMLInputElement>('fe-moustache', 'change', (el) => faceSet({ ...s.look, moustache: el.checked }));
    this.root.querySelectorAll<HTMLElement>('#fe-hairstyle [data-v]').forEach((el) =>
      el.addEventListener('click', () => faceSet({ ...s.look, hairStyle: Number(el.dataset.v) })),
    );
    // Homme / femme : seuls les profils de base du même sexe sont proposés.
    this.root.querySelectorAll<HTMLElement>('[data-fesex]').forEach((el) =>
      el.addEventListener('click', () => faceSet(withSex(s.look, el.dataset.fesex as 'male' | 'female'))),
    );
    this.root.querySelectorAll<HTMLElement>('[data-feprofile]').forEach((el) =>
      el.addEventListener('click', () => faceSet(withProfile(s.look, el.dataset.feprofile as string))),
    );
    this.root.querySelectorAll<HTMLElement>('[data-fetab]').forEach((el) =>
      el.addEventListener('click', () => {
        this.faceTab = el.dataset.fetab as FaceTab;
        this.render();
      }),
    );
    on('fe-random', 'click', () => faceSet(withRandomFace(s.look)));
    // Dé : personnage entier au hasard (visage, teint, cheveux, coiffure, barbe), en gardant le sexe choisi.
    on('gr-dice', 'click', () => {
      const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)] as T;
      const male = lookSex(s.look) === 'male';
      const base = withRandomFace(s.look);
      faceSet({
        ...base,
        skin: pick(QUICK_COLORS.skin as string[]),
        hair: pick(QUICK_COLORS.hair as string[]),
        hairStyle: pick(male ? [0, 3, 4, 5, 8] : [0, 1, 2, 5, 6, 7, 9, 10, 11]),
        freckles: Math.random() < 0.25 ? Math.random() * 0.8 : 0,
        ...(male ? { beard: Math.random() < 0.45 ? 0.3 + Math.random() * 0.6 : 0, moustache: Math.random() < 0.3 } : {}),
      });
    });
    on('fe-reset', 'click', () => faceSet(withBaseHead(s.look)));
    on('fe-undo', 'click', () => {
      const prev = this.faceUndo.pop();
      if (!prev) return;
      faceLive(prev);
      saveSettings(s);
      this.onSettingsSaved?.(s);
      this.render();
    });
    // Ressemblance photo : consentement à chaque fois, traitement local (onboarding/likeness.ts).
    this.root.querySelector('.fe-photo')?.addEventListener('toggle', (e) => (this.photoOpen = (e.target as HTMLDetailsElement).open));
    on<HTMLInputElement>('fe-consent', 'change', (el) => {
      const input = this.root.querySelector<HTMLInputElement>('#fe-photo');
      if (input) input.disabled = !el.checked;
      this.root.querySelector('#fe-photo-label')?.setAttribute('aria-disabled', String(!el.checked));
    });
    on<HTMLInputElement>('fe-photo', 'change', async (el) => {
      const f = el.files?.[0];
      el.value = '';
      if (!f || !this.root.querySelector<HTMLInputElement>('#fe-consent')?.checked) return;
      const msg = this.root.querySelector<HTMLElement>('#fe-photo-msg');
      if (msg) msg.textContent = S('analysingOnYourDevice');
      try {
        // Repères détectés, à corriger à la main dans une fenêtre avant l'ajustement de l'avatar.
        const { likenessWithEditing } = await import('./landmarkEditor.ts');
        const l = await likenessWithEditing(f);
        if (!l) {
          const m3 = this.root.querySelector<HTMLElement>('#fe-photo-msg');
          if (m3) m3.textContent = S('cancelledPhotoDiscarded');
          return;
        }
        faceSet(withLikeness(s.look, l));
        const m2 = this.root.querySelector<HTMLElement>('#fe-photo-msg');
        if (m2) m2.textContent = l.face ? (S('faceSkinAndHair')) : S('noFaceFoundSkin');
      } catch {
        if (msg) msg.textContent = S('analysisFailedOnThis');
      }
    });
    on<HTMLInputElement>('fe-bare', 'change', (el) => {
      this.bareHead = el.checked;
      this.onLookLive?.(s.look, this.bareHeadPreview);
    });
    // Garage : catégories, objets, vues et rotation de l'aperçu.
    this.root.querySelectorAll<HTMLElement>('[data-slot]').forEach((el) =>
      el.addEventListener('click', () => {
        const was = this.garageSlot;
        this.garageSlot = el.dataset.slot as GarageSlot;
        if (this.garageSlot === 'atelier') {
          this.render();
          this.atelier.emit();
          return;
        }
        if (was === 'atelier') this.atelier.leave();
        if (isFaceSlot(this.garageSlot)) {
          this.view = 'face';
          this.yaw = 0;
        } else if (this.garageSlot !== 'colors') {
          this.view = this.garageSlot === 'shorts' ? '3q' : this.garageSlot === 'gloves' ? 'front' : this.garageSlot === 'shoes' ? 'shoes' : SLOT_VIEW[this.garageSlot];
          this.yaw = 0;
        }
        this.render();
        this.onScene?.(this.view, this.yaw, this.garageSlot === 'bike', this.zoom);
        if (isFaceSlot(was) !== isFaceSlot(this.garageSlot)) this.onLookLive?.(s.look, this.bareHeadPreview);
      }),
    );
    this.root.querySelectorAll<HTMLElement>('[data-htype]').forEach((el) =>
      el.addEventListener('click', () => {
        this.helmetType = el.dataset.htype as typeof this.helmetType;
        this.render();
      }),
    );
    this.root.querySelectorAll<HTMLElement>('[data-gfilter]').forEach((el) =>
      el.addEventListener('click', () => {
        this.itemFilter = el.dataset.gfilter as typeof this.itemFilter;
        this.render();
      }),
    );
    this.root.querySelectorAll<HTMLElement>('[data-bikefilter]').forEach((el) =>
      el.addEventListener('click', () => {
        this.bikeFilter = el.dataset.bikefilter as BikeFilter;
        this.render();
      }),
    );
    this.root.querySelectorAll<HTMLElement>('[data-biketype]').forEach((el) =>
      el.addEventListener('click', () => {
        this.bikeType = el.dataset.biketype as BikeType | 'all';
        this.render();
      }),
    );
    this.root.querySelector<HTMLElement>('[data-unpreview]')?.addEventListener('click', () => {
      this.previews.delete('bike');
      this.sendPreview();
      this.render();
    });
    this.root.querySelector<HTMLElement>('[data-plainbike]')?.addEventListener('click', () => {
      this.previews.delete('bike');
      equipPlainBike(s);
      changed();
      this.sendPreview();
      this.render();
    });
    this.root.querySelectorAll<HTMLElement>('[data-item]').forEach((el) =>
      el.addEventListener('click', () => {
        const item = COSMETICS.find((c) => c.id === el.dataset.item);
        if (!item) return;
        const locked = item.level > levelProgress(loadProgress().xp).level;
        if (locked) {
          // Verrouillé : simple aperçu sur le coureur, rien n'est équipé ni enregistré.
          if (this.previews.get(item.slot) === item.id) this.previews.delete(item.slot);
          else this.previews.set(item.slot, item.id);
          this.sendPreview();
          this.render();
          return;
        }
        this.previews.delete(item.slot);
        equipItem(item, s);
        changed();
        this.sendPreview();
        this.render();
      }),
    );
    this.root.querySelectorAll<HTMLElement>('[data-view]').forEach((el) =>
      el.addEventListener('click', () => {
        this.view = el.dataset.view as GarageView;
        this.yaw = 0;
        this.zoom = 1;
        this.root.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b === el));
        this.onScene?.(this.view, this.yaw, this.garageSlot === 'bike', this.zoom);
      }),
    );
    this.root.querySelector<HTMLElement>('[data-grback]')?.addEventListener('click', () => this.go('progress'));
    // Garage : réduire le menu de droite pour une vue plus large, le rouvrir avec « ‹ Menu ».
    this.root.querySelectorAll<HTMLElement>('[data-gr]').forEach((b) =>
      b.addEventListener('click', () => {
        this.grFolded = b.dataset.gr === 'fold';
        this.root.querySelector('.gr-panel')?.classList.toggle('gr-folded', this.grFolded);
        this.root.querySelector<HTMLElement>('.gr-reopen')?.toggleAttribute('hidden', !this.grFolded);
      }),
    );
    const zone = this.root.querySelector<HTMLElement>('#m-dragzone');
    if (zone) {
      let lastX: number | null = null;
      let downAt: [number, number] | null = null;
      zone.addEventListener('pointerdown', (e) => {
        lastX = e.clientX;
        downAt = [e.clientX, e.clientY];
        zone.setPointerCapture(e.pointerId);
      });
      zone.addEventListener('pointermove', (e) => {
        if (lastX === null) return;
        if (this.garageSlot === 'atelier') {
          this.atelier.yaw -= (e.clientX - lastX) * 0.008;
          lastX = e.clientX;
          this.atelier.emit();
          return;
        }
        this.yaw -= (e.clientX - lastX) * 0.008;
        lastX = e.clientX;
        this.onScene?.(this.view, this.yaw, this.garageSlot === 'bike', this.zoom);
      });
      const up = (e: PointerEvent) => {
        lastX = null;
        // Simple clic (sans glisser) sur une pièce du vélo : la catégorie correspondante s'ouvre.
        if (e.type === 'pointerup' && downAt && this.garageSlot === 'atelier' && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 5) {
          const slot = this.onAtelierPick?.(e.clientX, e.clientY);
          if (slot) this.atelier.focusSlot(slot);
        } else if (e.type === 'pointerup' && downAt && V3_STYLE && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 5) {
          // Style Beta : la pièce cliquée (vélo, roue, maillot, gants…) ouvre sa rubrique et pulse sur le coureur.
          if (this.grFolded && this.onV3Pick?.(e.clientX, e.clientY)) {
            this.grFolded = false;
            this.root.querySelector('.gr-panel')?.classList.remove('gr-folded');
            this.root.querySelector<HTMLElement>('.gr-reopen')?.toggleAttribute('hidden', true);
          } else this.onV3Pick?.(e.clientX, e.clientY);
        }
        downAt = null;
      };
      // Molette : avance / recule la caméra, entre 0,6 (près) et 1,6 (loin) du cadrage normal.
      zone.addEventListener(
        'wheel',
        (e) => {
          e.preventDefault();
          const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (this.garageSlot === 'atelier' ? this.atelier.zoom : this.zoom) * (e.deltaY > 0 ? 1.08 : 1 / 1.08)));
          if (this.garageSlot === 'atelier') {
            this.atelier.zoom = z;
            this.atelier.emit();
          } else {
            this.zoom = z;
            this.onScene?.(this.view, this.yaw, this.garageSlot === 'bike', this.zoom);
          }
        },
        { passive: false },
      );
      zone.addEventListener('pointerup', up);
      zone.addEventListener('pointercancel', up);
    }
    const color = (id: string, key: 'jersey' | 'jerseyAccent' | 'helmet' | 'bike' | 'skin' | 'hair' | 'shoes' | 'shoeAccent' | 'socks') =>
      on<HTMLInputElement>(id, 'input', (el) => {
        s.look = { ...s.look, [key]: el.value };
        changed();
      });
    color('m-jersey', 'jersey');
    color('m-accent', 'jerseyAccent');
    color('m-helmet', 'helmet');
    color('m-skin', 'skin');
    // Couleur du vélo : celle du vélo sans marque, qui devient le vélo équipé.
    on<HTMLInputElement>('m-bike', 'input', (el) => {
      equipPlainBike(s, el.value);
      changed();
    });
    color('m-hair', 'hair');
    color('m-shoes', 'shoes');
    color('m-shoe-accent', 'shoeAccent');
    on<HTMLSelectElement>('m-shoe-mark', 'change', (el) => {
      const mark = SHOE_MARKS.find((m) => m.id === el.value)?.id;
      const { shoeMark: _old, ...rest } = s.look;
      s.look = mark ? { ...rest, shoeMark: mark } : rest;
      changed();
    });
    color('m-socks', 'socks');
    // Types (manches, cuissard, gants, hauteur des chaussettes) : pastilles à libellé.
    this.root.querySelectorAll<HTMLElement>('[data-setopt]').forEach((el) =>
      el.addEventListener('click', () => {
        const [key, val] = (el.dataset.setopt ?? '').split(':');
        if (!key || !val) return;
        s.look = { ...s.look, [key]: val };
        changed();
        this.render();
      }),
    );
    // Couleurs rapides (pastilles et roue de couleur du garage).
    this.root.querySelectorAll<HTMLElement>('[data-setcolor]').forEach((el) =>
      el.addEventListener('click', () => {
        const [key, hex] = (el.dataset.setcolor ?? '').split(':');
        if (!key || !hex) return;
        s.look = { ...s.look, [key]: hex };
        changed();
        this.render();
      }),
    );
    this.root.querySelectorAll<HTMLInputElement>('[data-colorkey]').forEach((el) =>
      el.addEventListener('input', () => {
        s.look = { ...s.look, [el.dataset.colorkey as string]: el.value };
        changed();
      }),
    );
    // Légende : nom, effet et état de la pastille survolée ; au repos, l'équipement essayé ou porté.
    const cap = this.root.querySelector<HTMLElement>('#gr-cap');
    if (cap) {
      const show = (chip: HTMLElement | null) => {
        const b = cap.querySelector('b') as HTMLElement;
        const sp = cap.querySelector('span') as HTMLElement;
        const em = cap.querySelector('em') as HTMLElement;
        b.textContent = chip?.dataset.capName ?? '';
        sp.textContent = chip?.dataset.capEffect ?? '';
        em.textContent = chip?.dataset.capState ?? '';
        cap.classList.toggle('empty', !chip);
      };
      const rest = () => show(this.root.querySelector<HTMLElement>('.gr-chip.preview') ?? this.root.querySelector<HTMLElement>('.gr-chip.on'));
      this.root.querySelectorAll<HTMLElement>('.gr-chip').forEach((chip) => {
        chip.addEventListener('mouseenter', () => show(chip));
        chip.addEventListener('focus', () => show(chip));
        chip.addEventListener('mouseleave', rest);
        chip.addEventListener('blur', rest);
      });
      rest();
    }
    on<HTMLElement>('m-bottles', 'change', (el) => {
      const n = Number((el as unknown as { value: string }).value);
      s.look = { ...s.look, bottles: n === 0 || n === 1 || n === 2 ? n : 2 };
      changed();
    });
    on<HTMLElement>('m-bottlecolor', 'change', (el) => {
      const v = (el as unknown as { value: string }).value;
      const { bottleColor: _old, ...rest } = s.look;
      s.look = v === 'black' || v === 'white' ? { ...rest, bottleColor: v } : rest;
      changed();
    });
    on<HTMLElement>('m-legs', 'change', (el) => {
      s.look = { ...s.look, legs: (el as unknown as { value: string }).value === 'long' ? 'long' : 'short' };
      changed();
    });
    on<HTMLElement>('m-sock-height', 'change', (el) => {
      s.look = { ...s.look, sockHeight: (el as unknown as { value: string }).value === 'high' ? 'high' : 'low' };
      changed();
    });
    on<HTMLElement>('m-gloves', 'change', (el) => {
      const v = (el as unknown as { value: string }).value;
      s.look = { ...s.look, gloves: v === 'mitts' || v === 'full' ? v : 'none' };
      changed();
    });
    on<HTMLInputElement>('m-glove-color', 'input', (el) => {
      s.look = { ...s.look, gloveColor: el.value };
      changed();
    });
    on<HTMLElement>('m-sleeves', 'change', (el) => {
      s.look = { ...s.look, sleeves: (el as unknown as { value: string }).value === 'long' ? 'long' : 'short' };
      changed();
    });
    this.root.querySelectorAll<HTMLElement>('[data-outfit]').forEach((el) =>
      el.addEventListener('click', () => {
        const o = OUTFITS.find((x) => x.id === el.dataset.outfit);
        if (!o) return;
        // Tenue complète : couleurs seulement, la peau, les cheveux et la carrure restent.
        s.look = { ...s.look, ...o.look };
        changed();
        this.render();
      }),
    );
    // Profil.
    const num = (id: string, key: 'ftpWatts' | 'aiRiders' | 'soloAiRiders') =>
      on<HTMLInputElement>(id, 'change', (el) => {
        s[key] = Number(el.value);
        changed();
        if (this.tab === 'profile') this.render();
      });
    const measurement = (id: string, key: 'massKg' | 'heightCm') =>
      on<HTMLInputElement>(id, 'change', (el) => {
        const value = el.valueAsNumber;
        const step = Number(el.step);
        const next = Number.isFinite(value)
          ? Math.min(Number(el.max), Math.max(Number(el.min), Math.round(value / step) * step))
          : s[key];
        el.value = String(next);
        if (next === s[key]) return;
        s[key] = next;
        changed();
        if (this.tab === 'profile') this.render();
      });
    measurement('m-mass', 'massKg');
    measurement('m-height', 'heightCm');
    num('m-ftp', 'ftpWatts');
    num('m-ai', 'aiRiders');
    num('m-solo-ai', 'soloAiRiders');
    this.root.querySelectorAll<HTMLElement>('[data-sex]').forEach((el) =>
      el.addEventListener('click', () => {
        s.look = withSex(s.look, el.dataset.sex as 'male' | 'female');
        changed();
        this.render();
      }),
    );
    on<HTMLInputElement>('m-name', 'change', (el) => {
      s.name = el.value.trim().slice(0, 24) || 'Robert';
      changed();
      this.render();
    });
    // Nationalité : drapeau montré aux autres coureurs (À proximité, classement des courses).
    const dd = this.root.querySelector<HTMLElement>('#m-nation');
    if (dd) {
      const list = dd.querySelector<HTMLElement>('.mm-dd-list') as HTMLElement;
      const pickNation = (o: HTMLElement) => {
        const { nationality: _old, ...rest } = s.look;
        const code = o.dataset.nation ?? '';
        s.look = code ? { ...rest, nationality: code } : rest;
        close();
        changed();
        this.render();
      };
      const onKey = listKeys(list, '[data-nation]', pickNation);
      // Le défilement de la liste elle-même ne la ferme pas (seul celui de la page).
      const onScroll = (e: Event) => {
        if (!list.contains(e.target as Node)) close();
      };
      const close = () => {
        list.hidden = true;
        list.style.cssText = '';
        list.querySelector('.hl')?.classList.remove('hl');
        dd.appendChild(list);
        document.removeEventListener('pointerdown', outside, true);
        document.removeEventListener('scroll', onScroll, true);
        document.removeEventListener('keydown', onKey, true);
      };
      const outside = (e: Event) => {
        if (!dd.contains(e.target as Node) && !list.contains(e.target as Node)) close();
      };
      dd.querySelector('.mm-dd-btn')?.addEventListener('click', () => {
        if (!list.hidden) return close();
        // Posée sur l'écran (et non dans le panneau, qui la rognerait) juste sous le champ.
        const r = (dd.querySelector('.mm-dd-btn') as HTMLElement).getBoundingClientRect();
        // Sorti du panneau (son flou crée un repère qui rognerait la liste) : posé sur la page.
        document.body.appendChild(list);
        list.style.cssText = `position:fixed;z-index:9999;left:${r.left}px;top:${r.bottom + 6}px;width:${r.width}px;max-height:${Math.max(160, Math.min(340, innerHeight - r.bottom - 16))}px`;
        list.hidden = false;
        list.querySelector('.on')?.scrollIntoView({ block: 'center' });
        document.addEventListener('pointerdown', outside, true);
        document.addEventListener('keydown', onKey, true);
        // Le défilement de la page ferme la liste, mais pas celui qu'on provoque pour montrer le pays choisi.
        setTimeout(() => !list.hidden && document.addEventListener('scroll', onScroll, true), 200);
      });
      dd.querySelectorAll<HTMLElement>('[data-nation]').forEach((o) =>
        o.addEventListener('click', () => pickNation(o)),
      );
      dd.addEventListener('keydown', (e) => e.key === 'Escape' && (e.stopPropagation(), close()));
    }
    // Réglages.
    on<HTMLSelectElement>('m-quality', 'change', (el) => {
      s.quality = el.value as Settings['quality'];
      localStorage.setItem('ar.quality', s.quality);
      changed();
    });
    // Style graphique : matériaux construits au chargement, la page se recharge.
    on<HTMLSelectElement>('m-style', 'change', (el) => setGraphicStyle(el.value as GraphicStyle));
    // HUD : disposition construite au chargement, la page se recharge.
    bindHudPicker(this.root, () => this.render());
    // Format et résolution : pris en compte tout de suite (le moteur écoute « resize »), sans recharger.
    on<HTMLSelectElement>('m-aspect', 'change', (el) => {
      setAspectCap(el.value as AspectCap);
      window.dispatchEvent(new Event('resize'));
    });
    on<HTMLSelectElement>('m-uiaspect', 'change', (el) => {
      setUiAspectCap(el.value as AspectCap);
      window.dispatchEvent(new Event('resize'));
    });
    // Taille de l'image réellement calculée (le choix « Auto » ne la dit pas) : celle du canevas 3D.
    const showRes = () => {
      const out = this.root.querySelector<HTMLElement>('#m-res-now');
      const c = document.getElementById('scene') as HTMLCanvasElement | null;
      if (!out || !c?.width) return;
      const lang = MX('locale');
      out.textContent = `${SET('renderNow')}${S('txt')}${c.width.toLocaleString(lang)} × ${c.height.toLocaleString(lang)} · ${((c.width * c.height) / 1e6).toLocaleString(lang, { maximumFractionDigits: 1 })} Mpx`;
    };
    showRes();
    on<HTMLSelectElement>('m-maxres', 'change', (el) => {
      setResolutionCap(el.value as ResolutionCap);
      window.dispatchEvent(new Event('resize'));
      // Le moteur redimensionne à l'image suivante.
      requestAnimationFrame(() => requestAnimationFrame(showRes));
    });
    // Limite d'images par seconde : lue par le moteur au chargement (engine/display.ts), donc à la prochaine sortie.
    on<HTMLSelectElement>('m-fpscap', 'change', (el) => {
      try {
        localStorage.setItem('ar.fpsCap', el.value || '0');
      } catch {
        /* stockage indisponible : le choix n'est pas gardé */
      }
    });
    on<HTMLSelectElement>('m-season', 'change', (el) => {
      s.season = el.value as Settings['season'];
      changed();
    });
    const range = (id: string, key: 'hour' | 'clouds' | 'rain' | 'fog' | 'trainerDifficulty' | 'inertia', label?: string, fmt?: (v: number) => string) =>
      on<HTMLInputElement>(id, 'input', (el) => {
        s[key] = Number(el.value);
        const l = label ? this.root.querySelector(`#${label}`) : null;
        if (l && fmt) l.textContent = fmt(s[key]);
        changed();
      });
    range('m-hour', 'hour', 'm-hourv', (v) => this.hourLabel(v));
    on<HTMLSelectElement>('m-realall', 'change', (el) => {
      // Un geste pour l'heure et la météo : tout réel, ou tout réglable (chaque partie reste réglable ensuite).
      const real = el.value === '1';
      s.realTime = real;
      s.realWeather = real;
      if (real) s.hour = nowHour();
      changed();
      this.render();
    });
    on<HTMLSelectElement>('m-realtime', 'change', (el) => {
      s.realTime = el.value === '1';
      if (s.realTime) s.hour = nowHour();
      changed();
      this.render();
    });
    range('m-clouds', 'clouds');
    range('m-rain', 'rain');
    range('m-fog', 'fog');
    range('m-diff', 'trainerDifficulty', 'm-diffv', (v) => `${Math.round(v * 100)} %`);
    range('m-inertia', 'inertia', 'm-inertiav', (v) => `${Math.round(v * 100)} %`);
    on<HTMLSelectElement>('m-lang', 'change', (el) => {
      s.lang = el.value as Settings['lang'];
      setLang(s.lang);
      changed();
      this.render();
    });
    on<HTMLSelectElement>('m-drive', 'change', (el) => {
      s.drivetrain = el.value as Settings['drivetrain'];
      changed();
    });
    on<HTMLSelectElement>('m-strava', 'change', (el) => {
      s.skipStrava = el.value === 'skip';
      changed();
    });
    on<HTMLSelectElement>('m-ghost', 'change', (el) => {
      s.showGhost = el.value === '1';
      changed();
    });
    on<HTMLSelectElement>('m-target', 'change', (el) => {
      s.groupTargetKmh = Number(el.value);
      changed();
    });
    on<HTMLSelectElement>('m-ailevel', 'change', (el) => {
      s.aiLevel = Number(el.value);
      changed();
    });
    on<HTMLSelectElement>('m-equal', 'change', (el) => {
      s.equalEquipment = el.value === '1';
      changed();
    });
    on<HTMLSelectElement>('m-ftpproto', 'change', (el) => {
      s.ftpTestProtocol = ftpTestProtocolOf(el.value);
      changed();
      this.render();
    });
    on<HTMLSelectElement>('m-ftpvoice', 'change', (el) => {
      s.ftpCoachVoice = el.value !== '0';
      changed();
    });
    if (this.tab === 'garage' && this.garageSlot === 'atelier') this.atelier.bind(this.root);
    this.root.querySelector<HTMLElement>('[data-wxfold]')?.addEventListener('click', () => {
      this.wxFolded = !this.wxFolded;
      try {
        localStorage.setItem('ar.wxFolded', this.wxFolded ? '1' : '0');
      } catch {
        // Stockage interdit : choix valable pour la session.
      }
      this.render();
    });
    on<HTMLSelectElement>('m-wx', 'change', (el) => {
      const w = WEATHER_PRESETS.find(([id]) => id === el.value)?.[1];
      if (!w) return;
      Object.assign(s, w);
      changed();
    });
    on<HTMLSelectElement>('m-wind', 'change', (el) => {
      s.windMs = Number(el.value);
      changed();
    });
    on<HTMLSelectElement>('m-evolve', 'change', (el) => {
      s.weatherEvolves = el.value === '1';
      changed();
    });
    on<HTMLSelectElement>('m-realwx', 'change', (el) => {
      s.realWeather = el.value === '1';
      changed();
      this.render();
    });
    this.root.querySelectorAll<HTMLInputElement>('[data-hudblock]').forEach((el) =>
      el.addEventListener('change', () => {
        const id = el.dataset.hudblock as string;
        s.hudHidden = el.checked ? s.hudHidden.filter((x) => x !== id) : [...new Set([...s.hudHidden, id])];
        changed();
      }),
    );
    on<HTMLSelectElement>('m-smooth', 'change', (el) => {
      s.smoothing3s = el.value === '1';
      changed();
    });
    // Ressenti route : valeur et message d'alerte suivent le curseur ; confirmation au premier passage en « très fort ».
    let roadFeelConfirmed = roadFeelLevel(s.roadFeelPercent) === 'extreme';
    on<HTMLInputElement>('m-roadfeel', 'input', (el) => {
      s.roadFeelPercent = clampRoadFeel(Number(el.value));
      const v = document.getElementById('m-roadfeelv');
      if (v) v.textContent = roadFeelValue(s.roadFeelPercent, fr());
      const msg = document.getElementById('m-roadfeelmsg');
      if (msg) msg.outerHTML = roadFeelMessage(s.roadFeelPercent, fr());
    });
    on<HTMLInputElement>('m-roadfeel', 'change', (el) => {
      const extreme = roadFeelLevel(s.roadFeelPercent) === 'extreme';
      if (extreme && !roadFeelConfirmed && !confirm(ROAD_FEEL_TEXT[getLang()].confirm)) {
        s.roadFeelPercent = ROAD_FEEL.extremePercent - 5;
        el.value = String(s.roadFeelPercent);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      roadFeelConfirmed = roadFeelLevel(s.roadFeelPercent) === 'extreme';
      changed();
    });
    on<HTMLInputElement>('m-stand', 'input', (el) => {
      s.standWatts = Number(el.value);
      const v = document.getElementById('m-standv');
      if (v) v.textContent = s.standWatts ? `${s.standWatts} W` : 'Auto';
      changed();
    });
  }
}
