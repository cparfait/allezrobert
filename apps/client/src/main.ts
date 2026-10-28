import './net/desktopAuth.ts';
import './hud/hud.css';
import * as THREE from 'three/webgpu';
import { rideOnMessage, DEFAULT_LOOK, RouteTrack, decimateRoute, rankRouteId, type PairState, type PhoneCommand, bikeOfLook, type AvatarLook, bikeSetupFor, weatherAt, weatherElapsedS, weatherSeed, worldToWgs84, type RideWeather, type RiderProfile, type RouteData } from '@allezrobert/shared';
import { createEngine, type Engine } from './engine/renderer.ts';
import { QUALITY_PRESETS, withUrlOverrides, type QualitySettings } from './engine/quality.ts';
import { detectHardwareQuality } from './engine/autoQuality.ts';
import { World } from './world/world.ts';
import { loadWorldSource } from './world/loader.ts';
import type { WorldSource } from './world/types.ts';
import { GltfRiderAvatar, createAvatar } from './rider/gltfAvatar.ts';
import { CROWD_FAMILIES, onBikeFamilyLoaded } from './rider/bikes.ts';
import { CameraRig } from './game/cameras.ts';
import { buzzLevel } from './game/roadBuzz.ts';
import { FreeFlyCamera } from './game/freecam.ts';
import { RideSession } from './game/ride.ts';
import { KeyboardControls, type InputSource } from './game/inputs.ts';
import { Peloton } from './game/peloton.ts';
import { separateRiders, type Body } from './game/collision.ts';
import { WorkoutController } from './game/workout.ts';
import { FriendGhost, Ghost, fetchFriendGhost, uploadGhost } from './game/ghost.ts';
import { createDeviceLayer } from './game/devices.ts';
import { Hud } from './hud/hud.ts';
import { RideSound } from './audio/rideSound.ts';
import { music } from './audio/music.ts';
import { companion } from './game/companionLink.ts';
import { companionQr } from './ui/companionQr.ts';
import { spotify } from './audio/spotify.ts';
import { musicSource, noteSpotifyPlaying } from './audio/musicSource.ts';
import { t, setLang, getLang } from './i18n/index.ts';
import { loadSettings, saveSettings, type Settings } from './ui/settings.ts';
import { MainMenu } from './ui/menu.ts';
import { bootStep, bootProgress, bootDone, bootError } from './ui/splash.ts';
import { PosterScene, POSTER_HOUR, GARAGE_VIEWS, type GarageView } from './ui/poster.ts';
import { showPause, rideToFit, rideToGpx, download, onlinePanel } from './ui/ridepanels.ts';
import { showRideSummary } from './ui/summary.ts';
import { compareAndStore, readPowerRecords, rideStats, updatePowerRecords } from './game/stats.ts';
import { shareCard } from './ui/sharecard.ts';
import { Onboarding, RideTutorial } from './onboarding/onboarding.ts';
import { fetchRealWeather } from './game/realWeather.ts';
import { addXp, awardRide, loadProgress, tunedBike } from './ui/garage.ts';
import { AtelierHost, slotOfPicked, type AtelierState } from './ui/atelier.ts';
import { rimGlow } from './rider/rimDecal.ts';
import { EQUALIZED_BIKE, paramsFromBike, roadHalfM } from '@allezrobert/physics';
import { awardTrophies } from './game/trophies.ts';
import { roadSurfaceAt, windShelterAt } from './world/conditions.ts';
import { OpenNavigator } from './game/open.ts';
import { ITINERARY_PREFIX } from './ui/routePlanner.ts';
import { findRoute, routeKey } from './game/direction.ts';
import { fmtLapTime, postRideEfforts, RouteTimer } from './game/efforts.ts';
import { waitBike } from './ui/waitBike.ts';
import { frameStats } from './engine/frameStats.ts';
import { KomChallenge, readKomRecord, type ChallengeResult } from './game/challenge.ts';
import { HairpinWatcher, hairpinToast, reachedFinish, summitStats } from './game/climb.ts';
import { showSummit } from './ui/summit.ts';
import { fetchMe, showLogin, applyProfile, logout, pushProfile, type Me } from './ui/account.ts';
import { sendRideInvites } from './ui/friends.ts';
import { RideSequences } from './game/sequences.ts';
import { GuestInputSource } from './game/guest.ts';
import { Crowd } from './world/crowd.ts';
import { FinishBanners } from './world/finishBanners.ts';
import { TownSigns } from './world/signs.ts';
import { AmbientCyclists } from './world/cyclists.ts';
import { Traffic, loadVehicleModels } from './world/traffic.ts';
import { Trains } from './world/trains.ts';
import { Multiplayer } from './game/multiplayer.ts';
import { VoiceChat, fetchVoiceConfig } from './game/voice.ts';
import { RideRoomUi } from './game/rideroom.ts';
import { showStartGate } from './game/startGate.ts';
import { PlaceFinder } from './game/place.ts';
import { TILES_BASE, installedPacks, keepStorage } from './world/packs.ts';
import { inDesktop, installFullscreenKey, keepAwake, mirrorProfile } from './platform/desktop.ts';
import { hasLocalMedia, prepareDesktop } from './platform/desktopBoot.ts';
import { offerDesktopUpdate } from './ui/desktopUi.ts';
import type { DevicePanel } from './ui/menu.ts';
import type { InterpolatedRider } from './net/index.ts';

const ui = document.getElementById('ui') as HTMLElement;
const hudRoot = document.getElementById('hud') as HTMLElement;

interface Scene3D {
  quality: Settings['quality'];
  q: QualitySettings;
  engine: Engine;
  source: WorldSource;
  world: World;
  route: RouteData;
  track: RouteTrack;
}

/** Charge le monde et l'itinéraire choisis (le monde reste affiché derrière le menu). */
async function loadScene(settings: Settings): Promise<Scene3D> {
  const params = new URLSearchParams(location.search);
  const q = withUrlOverrides(QUALITY_PRESETS[(params.get('quality') as Settings['quality'] | null) ?? settings.quality]);
  bootStep(20, 'Démarrage du moteur 3D (WebGPU)');
  const engine = await createEngine(document.getElementById('scene') as HTMLCanvasElement, q);
  performance.mark('ar:moteur prêt');
  GltfRiderAvatar.lodScale = { low: 0.6, medium: 0.8, high: 1, ultra: 1.5 }[q.level];
  bootStep(35, 'Monde et itinéraires');
  const source = await loadWorldSource(params.get('world') ?? settings.world ?? 'longchamp');
  performance.mark('ar:monde chargé');
  // Le mode « monde ouvert » n'existe que dans un monde qui a un graphe routier.
  if (settings.mode === 'open' && !source.open) settings.mode = 'free';
  const route = findRoute(source.routes, params.get('route') ?? routeKey(settings)) ?? (source.routes[0] as RouteData);
  const track = new RouteTrack(route);
  const world = new World(engine.scene, source, route, track, q, {
    hour: Number(params.get('hour') ?? settings.hour),
    season: (params.get('season') as Settings['season'] | null) ?? settings.season,
    weather: { clouds: settings.clouds, rain: settings.rain, fog: settings.fog, windMs: settings.windMs, windFrom: 4.4 },
  });
  return { quality: (params.get('quality') as Settings['quality'] | null) ?? settings.quality, q, engine, source, world, route, track };
}

/**
 * Changement d'itinéraire sans recharger la page (la musique du jeu et le lecteur Spotify
 * intégré continuent) : le monde est reconstruit pour le nouvel itinéraire.
 */
async function switchRoute(scene: Scene3D, s: Settings, onTile?: (done: number, total: number) => void): Promise<void> {
  const route = findRoute(scene.source.routes, routeKey(s));
  if (!route) return;
  scene.world.dispose();
  scene.route = route;
  scene.track = new RouteTrack(route);
  scene.world = new World(scene.engine.scene, scene.source, route, scene.track, scene.q, {
    hour: s.hour,
    season: s.season,
    weather: { clouds: s.clouds, rain: s.rain, fog: s.fog, windMs: s.windMs, windFrom: 4.4 },
  });
  const start = scene.track.positionAt(0, 1.2);
  await scene.world.preload(new THREE.Vector3(start.x, start.y, start.z), onTile);
  // Un rechargement ultérieur garde le bon itinéraire.
  const url = new URL(location.href);
  url.searchParams.set('route', route.id);
  history.replaceState(null, '', url.toString());
}

/** Petit écran d'attente par-dessus le menu (préparation du paysage à la demande). */
function worldOverlay(label: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'world-wait';
  el.innerHTML = `<div class="world-wait-box"><div class="world-wait-bar"><i></i></div><span>${label}</span><small class="world-wait-tip"></small></div>`;
  // Petit coureur qui pédale au-dessus de la barre.
  el.firstElementChild?.prepend(waitBike());
  document.body.appendChild(el);
  return el;
}

/**
 * Avancement d'un écran d'attente (0–1) : la barre animée devient une vraie barre de progression,
 * le pourcentage s'affiche après le texte.
 */
function setWaitProgress(el: HTMLElement, p: number): void {
  const bar = el.querySelector<HTMLElement>('.world-wait-bar i');
  const label = el.querySelector<HTMLElement>('.world-wait-box > span');
  const v = Math.max(0, Math.min(1, p));
  if (bar) {
    bar.style.animation = 'none';
    bar.style.transition = 'none';
    bar.style.width = `${Math.floor(v * 100)}%`;
  }
  if (label) {
    label.dataset.text ??= label.textContent ?? '';
    // Écran de sortie : le texte dit où en est la préparation (terrain, puis graphismes, puis finitions).
    const base = el.dataset.stages ? waitStage(v) : label.dataset.text;
    label.textContent = `${base} ${Math.floor(v * 100)} %`;
  }
}

/** Étape en cours de la préparation d'une sortie, d'après l'avancement (voir `tileStage` : 0–0,55 terrain, 0,55–0,85 shaders, au-delà finitions). */
function waitStage(p: number): string {
  const fr = getLang() === 'fr';
  if (p < 0.55) return fr ? 'Chargement du terrain…' : 'Loading the terrain…';
  if (p < 0.85) return fr ? 'Préparation des graphismes…' : 'Preparing the graphics…';
  return fr ? 'Derniers réglages…' : 'Final touches…';
}

/** Petites phrases qui défilent pendant l'attente (sortie). */
const WAIT_TIPS: Record<'fr' | 'en', string[]> = {
  fr: [
    'Le garage change ton maillot, ton casque, ton vélo et même le nombre de bidons.',
    'Les effets d’image se règlent depuis la pause : les couper rend le jeu plus fluide.',
    'Relief LiDAR HD de l’IGN, routes d’OpenStreetMap : les paysages sont ceux du vrai terrain.',
    'Le vent couche l’herbe et fait bouger les arbres : regarde dans quel sens il souffle.',
    'Tes sorties se règlent à ta taille : la selle suit la longueur de tes jambes.',
    'Le peloton se relaie : abrite-toi derrière un équipier pour économiser des watts.',
  ],
  en: [
    'The garage changes your jersey, helmet, bike and even the number of bottles.',
    'Image effects are set from the pause screen: turning them off makes the game smoother.',
    'IGN LiDAR HD relief and OpenStreetMap roads: the landscapes follow the real terrain.',
    'Wind lays the grass down and sways the trees: notice which way it blows.',
    'Your bike fits your size: the saddle follows your leg length.',
    'The bunch takes turns: tuck behind a teammate to save watts.',
  ],
};

/** Fait défiler les phrases de `WAIT_TIPS` dans l'écran d'attente, jusqu'à ce qu'il disparaisse. */
function rotateTips(el: HTMLElement): void {
  const tip = el.querySelector<HTMLElement>('.world-wait-tip');
  if (!tip) return;
  const list = WAIT_TIPS[getLang() === 'fr' ? 'fr' : 'en'];
  let i = Math.floor(Math.random() * list.length);
  const show = () => {
    if (!el.isConnected) return clearInterval(timer);
    tip.style.opacity = '0';
    setTimeout(() => {
      tip.textContent = list[i++ % list.length] as string;
      tip.style.opacity = '1';
    }, 350);
  };
  tip.textContent = list[i++ % list.length] as string;
  tip.style.opacity = '1';
  const timer = setInterval(show, 4500);
}

/** Étapes de la préparation d'une sortie sur la barre : tuiles, puis shaders, puis objets de la sortie. */
const tileStage = (el: HTMLElement, from: number, to: number) => (done: number, total: number) => setWaitProgress(el, from + (to - from) * (total ? done / total : 1));

/** Écran opaque « Préparation de la sortie… » (cache le menu, puis le monde tant que la première image n'est pas prête). */
function rideOverlay(): HTMLElement {
  const el = worldOverlay(getLang() === 'fr' ? 'Préparation de la sortie…' : 'Preparing the ride…');
  // Même fond que l'écran de chargement du jeu (index.html, #splash) : lueur chaude sur fond sombre, sans bleu en plus.
  el.style.background = 'radial-gradient(ellipse at 70% 30%, rgba(255, 196, 92, 0.22), transparent 55%), linear-gradient(180deg, #1a2333 0%, #0a0e16 70%)';
  el.style.backdropFilter = 'none';
  el.dataset.stages = '1';
  rotateTips(el);
  return el;
}

/** Attend que le navigateur ait peint (écran d'attente visible avant un calcul qui bloque). */
function nextPaint(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
}

/** Version des médias du menu (vidéos, images) : à augmenter quand on les régénère (cache navigateur). */
const MENU_MEDIA_VERSION = 11;

/** Boucle vidéo de la saison en fond du menu (public/menu/loop-<saison>.webm), sur son image fixe. */
function createMenuVideo(el: HTMLVideoElement | null) {
  let failed = false;
  /**
   * Formats essayés dans l'ordre, le suivant en cas d'erreur : AV1 (deux fois plus léger) seulement si la
   * carte graphique le décode (sinon il occuperait le processeur), puis H.264, puis VP9, et en dernier recours
   * AV1 décodé par logiciel (l'installateur Windows ne livre pas le VP9 : voir scripts/installerDiet.ts).
   */
  let formats = ['mp4', 'webm', 'av1.mp4'];
  let format = 0;
  let current = '';
  const caps: Promise<void> = navigator.mediaCapabilities
    ? navigator.mediaCapabilities
        .decodingInfo({ type: 'file', video: { contentType: 'video/mp4; codecs="av01.0.08M.08"', width: 1920, height: 1080, bitrate: 2_500_000, framerate: 30 } })
        .then((info) => {
          if (info.supported && info.powerEfficient && !current) formats = ['av1.mp4', 'mp4', 'webm'];
        })
        .catch(() => undefined)
    : Promise.resolve();
  /** Attentes de `preload` : libérées quand la vidéo est assez chargée, ou quand elle est abandonnée. */
  const waiters = new Set<() => void>();
  /** Adresse de la boucle de la saison dans le format courant (H.264 → VP9 si H.264 n'est pas lu). */
  const urlFor = (season: Settings['season']): string => {
    // AV1 si décodé par la carte graphique, sinon H.264, sinon VP9 ; repli sur le suivant en cas d'erreur.
    if (el && formats[format] === 'mp4' && !el.canPlayType('video/mp4; codecs="avc1.640028"')) format = formats.indexOf('webm');
    // Application Windows : depuis les ressources du jeu sur le disque si elles ont la boucle, sinon du serveur ; web : même origine.
    const file = `menu/loop-${season}.${formats[format] as string}`;
    return `${inDesktop && !hasLocalMedia(file) ? TILES_BASE : ''}/${file}?v=${MENU_MEDIA_VERSION}`;
  };
  // Image fixe de la saison, affichée tout de suite sous la vidéo (et seule si la vidéo échoue).
  const still = document.getElementById('menu-still');
  const showStill = (season: Settings['season'] | null) => {
    if (!still) return;
    if (season) still.style.backgroundImage = `url(/menu/still-${season}.jpg?v=${MENU_MEDIA_VERSION})`;
    still.hidden = !season;
  };
  if (el) {
    el.addEventListener('error', () => {
      const ext = formats[format];
      if (ext && format + 1 < formats.length) {
        // Format refusé (ou fichier absent) : on retente avec le suivant avant d'abandonner (l'image fixe reste en dessous).
        const next = formats[++format] as string;
        current = current.replace(`.${ext}?`, `.${next}?`);
        el.src = current;
        void el.play().catch(() => undefined);
        return;
      }
      // Tous les formats ont échoué : image fixe seule (nouvel essai à la prochaine saison / au prochain accueil).
      failed = true;
      for (const release of [...waiters]) release();
      el.hidden = true;
      console.warn('Boucle vidéo du menu illisible :', current, el.error?.message ?? el.error?.code);
    });
    el.addEventListener('playing', () => el.classList.add('on'));
    // Lecture refusée (autoplay du navigateur) ou coupée (économie d'énergie, onglet masqué) : on relance dès le
    // premier geste, et à chaque pause involontaire tant que la boucle est affichée.
    const resume = () => {
      if (!el.hidden && !document.hidden && el.paused) void el.play().catch(() => undefined);
    };
    for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, resume, { passive: true });
    el.addEventListener('pause', () => setTimeout(resume, 300));
    el.addEventListener('stalled', () => setTimeout(resume, 1000));
    document.addEventListener('visibilitychange', () => {
      if (!el.hidden) void (document.hidden ? el.pause() : el.play().catch(() => undefined));
    });
  }
  return {
    /**
     * Affiche la boucle ; false si impossible (fichier absent). Jouée même avec « réduire les animations »
     * du système (coupé par défaut sur bien des PC Windows) : c'est le décor du menu, pas une animation d'interface.
     */
    show(season: Settings['season']): boolean {
      showStill(season);
      if (!el || failed) return true;
      const src = urlFor(season);
      if (current !== src) {
        current = src;
        el.classList.remove('on');
        el.src = src;
      }
      el.hidden = false;
      void el.play().catch(() => undefined);
      return true;
    },
    /**
     * Télécharge la boucle de la saison, cachée, avant tout le reste (modèles, shaders) : la lecture ne « rame » plus
     * quand le menu apparaît. Rend la main quand elle est jouable en continu, abandonnée, ou après `maxMs`.
     */
    async preload(season: Settings['season'], maxMs = 15_000): Promise<void> {
      if (!el || failed) return;
      await caps;
      const src = urlFor(season);
      if (current !== src) {
        current = src;
        el.src = src;
        el.load();
      }
      if (el.readyState >= 4) return;
      await new Promise<void>((resolve) => {
        const release = () => {
          clearTimeout(timer);
          el.removeEventListener('canplaythrough', release);
          waiters.delete(release);
          resolve();
        };
        const timer = setTimeout(release, maxMs);
        el.addEventListener('canplaythrough', release);
        waiters.add(release);
      });
    },
    stop(): void {
      showStill(null);
      if (!el) return;
      el.pause();
      el.hidden = true;
    },
    /** Fond du menu affiché (vidéo ou, à défaut, image fixe) : pas de rendu 3D nécessaire. */
    playing(): boolean {
      return !!still && !still.hidden;
    },
  };
}

/** Musique : volume de base (plus bas en sortie) et annonce des titres Spotify pendant la sortie. */
const musicCtl = { base: 1, lastTitle: '', spotifyPlaying: false, onTrack: null as ((label: string) => void) | null };

/** Musique vue par l'appli compagnon : Spotify s'il est connecté, sinon la musique du jeu. */
function companionMusic(): NonNullable<PairState['music']> {
  if (spotify.connected) return { source: 'spotify', playing: musicCtl.spotifyPlaying, title: musicCtl.lastTitle, volume: music.volume };
  return { source: 'game', playing: music.playing, title: music.current?.title ?? '', volume: music.volume };
}

/** Recherche Spotify demandée par le téléphone : résultats renvoyés en événement (la recherche vide liste les playlists du compte). */
async function companionMusicSearch(query: string): Promise<void> {
  if (!spotify.connected) return companion.sendEvent({ kind: 'musicResults', query, items: [], error: 'not_connected' });
  try {
    const items = await spotify.search(query);
    companion.sendEvent({ kind: 'musicResults', query, items: items.slice(0, 20).map((i) => ({ ...i, name: i.name.slice(0, 80), sub: i.sub.slice(0, 60) })) });
  } catch {
    companion.sendEvent({ kind: 'musicResults', query, items: [], error: 'failed' });
  }
}

/** Commandes musique de l'appli compagnon (mêmes effets que B / N au clavier) ; vrai si traitée. */
function companionMusicCommand(c: PhoneCommand): boolean {
  if (c.kind === 'musicSearch') {
    void companionMusicSearch(c.query);
    return true;
  }
  if (c.kind === 'musicPlay') {
    if (spotify.connected) void spotify.playUri(c.uri).then((ok) => ok && ((musicCtl.spotifyPlaying = true), noteSpotifyPlaying()));
    return true;
  }
  if (c.kind !== 'music') return false;
  const sp = musicSource() === 'spotify';
  if (c.action === 'toggle') {
    if (sp) void spotify.toggleSmart().then((on) => (musicCtl.spotifyPlaying = on));
    else music.toggle();
  } else if (c.action === 'next') {
    if (sp) void spotify.next();
    else music.next();
  } else if (c.action === 'previous') {
    if (sp) void spotify.previous();
    else music.previous();
  } else if (c.action === 'volume' && c.volume !== undefined) {
    if (sp) spotify.setHereVolume(c.volume);
    music.setVolume(c.volume);
  }
  return true;
}

async function boot(): Promise<void> {
  // Retour de l'autorisation Spotify (?code&state), avant tout le reste.
  await spotify.handleRedirect();
  // Spotify déconnecté entre-temps : la musique du jeu reprend sa place.
  if (!spotify.connected) music.yieldToExternal(false);
  music.unlockOnGesture();
  // Application Windows : zones du disque, ressources du jeu à jour, profil sauvegardé, F11, veille rendue à Windows.
  await prepareDesktop();
  mirrorProfile();
  installFullscreenKey();
  keepAwake(false);
  // Zones déjà téléchargées : demande (sans effet si refusée) que le navigateur ne les purge pas.
  if (installedPacks().length) keepStorage();
  const settings = loadSettings();
  // Premier lancement ou qualité jamais choisie à la main : préréglage selon la carte graphique.
  if (!localStorage.getItem('ar.quality') && !new URLSearchParams(location.search).has('quality')) settings.quality = await detectHardwareQuality();
  setLang(settings.lang);
  // Vélo affiché au garage et sur l'image d'accueil : celui qui est équipé (sauvegardes anciennes).
  settings.look = { ...settings.look, bikeType: bikeSetupFor(loadProgress().equipped).tyre ?? 'road' };
  bootStep(20, 'Chargement du jeu');
  // Fond du menu : boucle vidéo de la saison (aucun calcul 3D pendant ce temps). Elle se télécharge en premier : modèles,
  // moteur et shaders attendent qu'elle soit jouable, sinon ils lui prennent le réseau et le processeur et elle saccade.
  const menuVideo = createMenuVideo(document.getElementById('menu-bg') as HTMLVideoElement | null);
  const videoReady = new URLSearchParams(location.search).has('autostart') ? Promise.resolve() : menuVideo.preload(settings.season);
  bootStep(20, 'Chargement de l’accueil');
  await videoReady;
  // Avatars Blender (glTF) : chargés en parallèle, attendus seulement quand la 3D sert.
  const modelsReady = GltfRiderAvatar.load([bikeOfLook(settings.look).family, ...CROWD_FAMILIES]);
  // Voitures : en tâche de fond, attendues au départ d'une sortie (facultatives).
  const vehiclesReady = new URLSearchParams(location.search).get('traffic') !== '0' ? loadVehicleModels().catch(() => undefined) : Promise.resolve();
  // Léger : moteur, liste des mondes et des parcours. Le paysage (tuiles, shaders) se charge après le menu.
  const scene = await loadScene(settings);
  // Film d'accueil (développement) : rendu image par image, sans menu (voir tools/menu-loop).
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('cinematic')) {
    await modelsReady;
    const { runCinematic } = await import('./ui/cinematic.ts');
    bootDone();
    return runCinematic(scene.engine, scene.world, scene.track);
  }
  // Appli compagnon : lien ouvert dès l'accueil (le téléphone suit la musique) ; QR code sur Q,
  // dans les Réglages et proposé au lancement d'une sortie.
  companion.connect();
  companionQr();
  companion.provider = () => ({ phase: 'menu', music: companionMusic() });
  companion.onCommand = (c) => void companionMusicCommand(c);
  const devices = createDeviceLayer();
  devicePanel = devices.panel;
  const autostart = new URLSearchParams(location.search).has('autostart');
  /** Ciel et lumière de la sortie (réglages du coureur) ; l'environnement suit le monde courant. */
  const applyEnv = (s: Settings) => {
    const env = scene.world.env.state;
    env.hour = s.hour;
    env.weather.clouds = s.clouds;
    env.weather.rain = s.rain;
    env.weather.fog = s.fog;
    if (env.season !== s.season) scene.world.setSeason(s.season);
  };

  // Image d'accueil fixe : un lieu ouvert de l'itinéraire, soleil du matin, le groupe face à l'objectif.
  // Rendue sur quelques images (lissage temporel) puis plus rien ne bouge ; nouveau rendu au redimensionnement.
  let inMenu = !autostart;
  /** « Explorer la carte » depuis l'accueil : caméra libre, sans sortie. */
  let exploring = false;
  let poster = new PosterScene(scene.engine, scene.world, scene.track);
  let posterFrames = 0;
  const focus = new THREE.Vector3();
  const renderPoster = () => {
    const env = scene.world.env.state;
    poster.frame();
    env.hour = POSTER_HOUR;
    env.weather.clouds = 0.15;
    env.weather.rain = 0;
    env.weather.fog = 0.08;
    posterFrames = 24;
  };
  /**
   * Paysage autour du départ de l'itinéraire choisi (tuiles, végétation, bâtiments) et ses shaders.
   * Préparé sous l'écran de chargement pour l'itinéraire courant (l'accueil est une vidéo) ; refait au clic
   * sur « Rouler » si la zone a changé.
   */
  let worldReady: Promise<void> | null = null;
  /** Écran d'attente qui suit la préparation du paysage en cours (barre de progression). */
  let worldWait: HTMLElement | null = null;
  /** Vrai seulement quand la préparation est terminée : `worldReady` est une promesse déjà « vraie » pendant qu'elle court. */
  let worldDone = false;
  /** Progression (0–0,85) de la préparation du paysage quand elle se fait sous l'écran de chargement. */
  let bootWorld: ((p: number) => void) | null = null;
  const prepareWorld = (): Promise<void> =>
    (worldReady ??= (async () => {
      await modelsReady;
      performance.mark('ar:modèles prêts');
      if (scene.world.env.state.season !== settings.season) scene.world.setSeason(settings.season);
      const start = scene.track.positionAt(0, 1.2);
      // Barre : tuiles jusqu'à 55 %, shaders jusqu'à 85 % (le reste : objets de la sortie, dans startRide).
      await scene.world.preload(new THREE.Vector3(start.x, start.y, start.z), (d, t) => {
        worldWait && tileStage(worldWait, 0, 0.55)(d, t);
        bootWorld?.(0.55 * (t ? d / t : 1));
      });
      performance.mark('ar:tuiles prêtes');
      await scene.engine.compileScene((d, t) => {
        worldWait && tileStage(worldWait, 0.55, 0.85)(d, t);
        bootWorld?.(0.55 + 0.3 * (t ? d / t : 1));
      });
      performance.mark('ar:paysage compilé');
      worldDone = true;
    })());
  /** Attend le paysage avant une action 3D, avec un écran d'attente seulement s'il n'est pas prêt. */
  const withWorld = async (label: string): Promise<void> => {
    let done = false;
    const p = prepareWorld().then(() => (done = true));
    await Promise.race([p, new Promise((r) => setTimeout(r, 60))]);
    if (done) return;
    const overlay = worldOverlay(label);
    worldWait = overlay;
    await p;
    worldWait = null;
    overlay.remove();
  };
  window.addEventListener('resize', () => inMenu && !exploring && worldReady && !menuVideo.playing() && renderPoster());
  // Vélo essayé dans le garage dont la famille arrive à l'instant : l'avatar l'a monté, on refait l'image.
  onBikeFamilyLoaded(() => inMenu && !exploring && !!worldReady && !menuVideo.playing() && renderPoster());
  // Explorer la carte : caméra libre au-dessus du monde chargé ; les tuiles suivent la caméra.
  const explorer = new FreeFlyCamera(scene.engine.camera, scene.engine.renderer.domElement, (x, z) => scene.world.terrain.heightAt(x, z));
  let exploreT = 0;
  // Atelier du garage : sa propre pièce et son rendu à la demande (ui/atelier.ts).
  const atelier = new AtelierHost(scene.engine);
  scene.engine.renderer.setAnimationLoop(() => {
    if (inMenu && !exploring && atelier.tick()) return;
    if (exploring) {
      const now = performance.now();
      const dt = Math.min((now - exploreT) / 1000, 0.1);
      exploreT = now;
      explorer.update(dt);
      scene.world.update(dt, explorer.position);
      scene.engine.exposure.value = scene.world.env.exposure();
      scene.world.env.grade(scene.engine.grade);
      scene.engine.render();
      return;
    }
    if (!inMenu || posterFrames <= 0) return;
    posterFrames--;
    scene.world.update(1 / 60, focus);
    scene.engine.exposure.value = scene.world.env.exposure();
    scene.world.env.grade(scene.engine.grade);
    scene.engine.render();
  });
  /** Sortie de l'accueil : retrait du groupe figé, réglages du coureur rétablis. */
  const leaveMenu = (s: Settings) => {
    inMenu = false;
    atelier.set(null);
    menuVideo.stop();
    poster.dispose();
    applyEnv(s);
  };

  // Spotify lancé ou mis en pause depuis le jeu : la musique du jeu suit aussitôt.
  // Une fois Spotify lancé, la musique du jeu ne revient pas d'elle-même (pause, changement d'écran, accueil).
  spotify.onPlayState = (playing) => {
    musicCtl.spotifyPlaying = playing;
    if (playing) {
      music.yieldToExternal(true);
      noteSpotifyPlaying();
    }
  };
  // Suivi Spotify : la musique du jeu se tait quand Spotify joue ; titre annoncé au changement.
  setInterval(async () => {
    if (!spotify.connected || document.hidden) return;
    const np = await spotify.nowPlaying();
    musicCtl.spotifyPlaying = !!np?.isPlaying;
    if (np?.isPlaying) {
      music.yieldToExternal(true);
      noteSpotifyPlaying();
    }
    const label = np ? `${np.title} — ${np.artist}` : '';
    if (np?.isPlaying && label !== musicCtl.lastTitle) {
      musicCtl.lastTitle = label;
      musicCtl.onTrack?.(label);
    }
    if (inMenu) void menu.refreshNowPlaying();
  }, 8000);

  const menu = new MainMenu(ui, settings, scene.source.routes, devices.panel, {
    onStart: (s, extras) => {
      saveSettings(s);
      // Itinéraire tracé sur la carte : il remplace le précédent dans les parcours du monde.
      if (extras.customRoute) {
        const routes = scene.source.routes;
        for (let i = routes.length - 1; i >= 0; i--) if (routes[i]?.id.startsWith(ITINERARY_PREFIX) && routes[i]?.id !== extras.customRoute.id) routes.splice(i, 1);
        if (!routes.some((r) => r.id === extras.customRoute?.id)) routes.push(extras.customRoute);
      }
      // Changement de qualité graphique : rechargement propre de la page.
      if (s.quality !== scene.quality) {
        const url = new URL(location.href);
        url.searchParams.set('route', routeKey(s));
        url.searchParams.delete('quality');
        url.searchParams.set('autostart', '1');
        location.href = url.toString();
        return;
      }
      // Écran de préparation affiché tout de suite, avant tout calcul ; il reste jusqu'à la première image de la sortie.
      const overlay = rideOverlay();
      // Changement d'itinéraire : monde reconstruit sur place (sans attendre l'ancien), la musique continue.
      if (routeKey(s) !== scene.route.id) {
        void nextPaint()
          .then(() => {
            menu.hide();
            leaveMenu(s);
            return modelsReady;
          })
          .then(() => switchRoute(scene, s, tileStage(overlay, 0, 0.55)))
          .then(() => scene.engine.compileScene(tileStage(overlay, 0.55, 0.85)))
          .then(() => startRide(scene, s, s.guest ? new GuestInputSource(s.massKg) : devices.source(), extras, overlay));
        return;
      }
      worldWait = overlay;
      void nextPaint()
        .then(() => prepareWorld())
        .then(() => {
          worldWait = null;
          leaveMenu(s);
          menu.hide();
          return startRide(scene, s, s.guest ? new GuestInputSource(s.massKg) : devices.source(), extras, overlay);
        });
    },
  });
  menu.worldId = scene.source.id;
  menu.loadedZones = scene.source.zones ?? [scene.source.id];
  menu.openWorld = !!scene.source.open;
  menu.planner.setOpen(scene.source.open ? { ...scene.source.open, areas: scene.source.areas ?? [scene.source.bounds], ...(scene.source.originL93 ? { originL93: scene.source.originL93 } : {}) } : null);
  // Changement de monde sans recharger la page : données du nouveau monde, paysage refait en arrière-plan.
  menu.onWorld = (id) => {
    settings.world = id;
    settings.routeId = '';
    settings.reverse = false;
    settings.startM = 0;
    saveSettings(settings);
    void (async () => {
      const source = await loadWorldSource(id);
      if (settings.mode === 'open' && !source.open) settings.mode = 'free';
      const pending = worldReady;
      worldReady = null;
      worldDone = false;
      await pending?.catch(() => undefined);
      poster.dispose();
      scene.world.dispose();
      scene.source = source;
      scene.route = source.routes[0] as RouteData;
      scene.track = new RouteTrack(scene.route);
      scene.world = new World(scene.engine.scene, source, scene.route, scene.track, scene.q, {
        hour: settings.hour,
        season: settings.season,
        weather: { clouds: settings.clouds, rain: settings.rain, fog: settings.fog, windMs: settings.windMs, windFrom: 4.4 },
      });
      poster = new PosterScene(scene.engine, scene.world, scene.track);
      settings.routeId = scene.route.id;
      saveSettings(settings);
      const url = new URL(location.href);
      url.searchParams.set('world', id);
      url.searchParams.delete('route');
      history.replaceState(null, '', url.toString());
      menu.planner.setOpen(source.open ? { ...source.open, areas: source.areas ?? [source.bounds], ...(source.originL93 ? { originL93: source.originL93 } : {}) } : null);
      menu.loadedZones = source.zones ?? [source.id];
      menu.setWorld(source.routes, source.id, !!source.open);
    })();
  };
  const onExploreKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    stopExplore();
  };
  const startExplore = async () => {
    if (exploring || !inMenu) return;
    await withWorld(getLang() === 'fr' ? 'Chargement de la carte…' : 'Loading the map…');
    menuVideo.stop();
    menu.hide();
    exploring = true;
    // Vue de départ : au-dessus du début de l'itinéraire, dans son sens.
    const p0 = scene.track.positionAt(0, 0);
    scene.engine.camera.position.set(p0.x - p0.dirX * 60, p0.y + 40, p0.z - p0.dirZ * 60);
    scene.engine.camera.lookAt(p0.x + p0.dirX * 80, p0.y, p0.z + p0.dirZ * 80);
    exploreT = performance.now();
    const cam = scene.engine.camera;
    cam.fov = cam.aspect > 2.5 ? 55 : 70;
    cam.updateProjectionMatrix();
    explorer.exitHint = getLang() === 'fr' ? '<kbd>Échap</kbd> retour au menu' : '<kbd>Esc</kbd> back to menu';
    explorer.enable();
    window.addEventListener('keydown', onExploreKey);
  };
  /** Retour à l'accueil : l'image fixe est recadrée, puis refaite une fois les tuiles du lieu rechargées. */
  const stopExplore = () => {
    if (!exploring) return;
    exploring = false;
    window.removeEventListener('keydown', onExploreKey);
    explorer.disable();
    menu.show(); // → onScene('poster') → vidéo de la saison (ou image 3D si absente)
    void scene.world.preload(focus).then(() => inMenu && !exploring && renderPoster());
  };
  menu.onExplore = () => void startExplore();
  if (import.meta.env.DEV) (window as unknown as { __arMenu: unknown }).__arMenu = { engine: scene.engine, world: scene.world, explorer, startExplore, stopExplore };
  // Nouveau morceau : barre musique du menu à jour, annonce dans le HUD pendant la sortie.
  music.onTrack = (tr) => {
    menu.renderMusic();
    musicCtl.onTrack?.(tr.title);
  };
  // Accueil : seuls la saison et le maillot / vélo changent l'image ; le reste s'applique au départ.
  menu.onSettingsChange = (s) => {
    if (!inMenu) return applyEnv(s);
    if (scene.world.env.state.season !== s.season) scene.world.setSeason(s.season);
    if (menuVideo.playing()) menuVideo.show(s.season);
    if (garage) return showGarage(menu.currentLook());
    if (!worldReady || menuVideo.playing()) return;
    poster.build({ ...s.look, heightCm: s.heightCm });
    poster.setPlayerLook({ ...s.look, heightCm: s.heightCm }, menu.bareHeadPreview);
    poster.place(poster.d);
    renderPoster();
  };
  // Éditeur de visage : le coureur du garage suit les curseurs sans reconstruire la scène.
  menu.onLookLive = (look, bareHead) => {
    if (!inMenu) return;
    if (garage) return showGarage(look, bareHead);
    poster.setPlayerLook({ ...look, heightCm: settings.heightCm }, bareHead);
    renderPoster();
  };
  // Onglets : photo du groupe, ou aperçu du coureur dans le garage (vues et rotation).
  // Garage : aperçu d'un équipement (même verrouillé) sur le coureur, puis retour à la tenue équipée.
  menu.onPreviewLook = (look) => {
    if (inMenu && garage) return showGarage(look ?? settings.look, menu.bareHeadPreview);
    if (!inMenu || !worldReady || menuVideo.playing()) return;
    poster.build({ ...(look ?? settings.look), heightCm: settings.heightCm });
    poster.place(poster.d);
    renderPoster();
  };
  menu.onAtelierPick = (x, y) => {
    const names = atelier.pick(x, y);
    return names ? slotOfPicked(names) : null;
  };
  menu.onAtelier = (st) => {
    if (!inMenu || exploring) return;
    if (st) {
      menuVideo.stop();
      garage = null;
      garageLook = null;
    }
    if (st) whenAtelierReady(() => (atelier.set(st), true));
    else void modelsReady.then(() => atelier.set(st));
  };
  if (import.meta.env.DEV) (window as unknown as { __arAtelier: unknown }).__arAtelier = atelier;
  // Garage : le coureur sur son vélo dans l'atelier, sans paysage ni groupe : s'ouvre sans attendre le monde.
  let garage: { view: GarageView; yaw: number; far?: number; bikeOnly?: boolean } | null = null;
  // Première ouverture de l'atelier : les modèles se chargent puis la pièce se construit d'un coup, sans rien
  // montrer. Un écran d'attente reste jusqu'à ce que ce soit fait (une seule fois, pas à chaque changement de vue).
  let atelierBuilt = false;
  let atelierWait: HTMLElement | null = null;
  /**
   * Préparation en coulisse de l'atelier (pièce, coureur, shaders) dès le lancement, une fois les modèles
   * prêts : la première ouverture du garage ou de l'étape Avatar du tutoriel est alors immédiate.
   */
  let atelierPrep: Promise<void> | null = null;
  const prepareAtelier = (): Promise<void> =>
    (atelierPrep ??= (async () => {
      const t0 = performance.now();
      await modelsReady;
      const t1 = performance.now();
      // Garage demandé avant la fin : son écran d'attente suit la compilation.
      await atelier.prepare({ ...settings.look, heightCm: settings.heightCm }, (done, total) => {
        if (total > 0) {
          menu.setGarageProgress(done / total);
          bootProgress(60 + 20 * (done / total));
        }
        if (atelierWait && total > 0) setWaitProgress(atelierWait, done / total);
      });
      atelierBuilt = true;
      // L'image de préparation est restée dans la toile : l'accueil 3D (sans vidéo) se redessine.
      if (inMenu && !garage && !exploring && worldDone && !menuVideo.playing()) renderPoster();
      console.info(`[atelier] préparé : modèles ${Math.round(t1 - t0)} ms, pièce et shaders ${Math.round(performance.now() - t1)} ms`);
    })()
      .catch(() => undefined)
      // Garage chargé (ou impossible à charger : le bouton ne doit pas manquer pour autant) : « Rouler » apparaît à l'accueil.
      .then(() => menu.setGarageReady()));
  const whenAtelierReady = (build: () => boolean): void => {
    // Atelier déjà affiché une fois : tout est prêt, changement immédiat.
    if (atelierBuilt) {
      build();
      return;
    }
    if (!atelierWait) atelierWait = worldOverlay(getLang() === 'fr' ? 'Chargement du garage…' : 'Loading the garage…');
    // Attend la fin de la préparation en coulisse (shaders compilés sans bloquer) : l'atelier ne se dessine pas
    // tant qu'elle compile (AtelierHost.tick), il resterait noir. compilePass borne déjà sa durée (45 s).
    void modelsReady
      .then(() => prepareAtelier())
      .then(() => (atelierWait ? new Promise<void>((r) => setTimeout(r, 40)) : undefined)) // laisse l'écran d'attente se peindre
      .then(() => {
        if (build()) atelierBuilt = true;
      })
      .finally(() => {
        atelierWait?.remove();
        atelierWait = null;
      });
  };
  /** Tenue ou vélo affiché (essai d'un équipement verrouillé compris) : la rotation à la souris le conserve. */
  let garageLook: AvatarLook | null = null;
  const showGarage = (look: AvatarLook, bareHead = menu.bareHeadPreview) => {
    if (!garage) return;
    garageLook = look;
    const v = GARAGE_VIEWS[garage.view];
    const c = Math.cos(garage.yaw);
    const sn = Math.sin(garage.yaw);
    // Recul (tutoriel) : coureur plus petit, pour laisser la place aux sous-titres.
    const k = garage.far ?? 1;
    // Choix du vélo : le vélo seul sur le pied d'atelier (sans coureur), vue d'ensemble tournante.
    if (garage.bikeOnly) {
      const only: AtelierState = { look: { ...look, heightCm: settings.heightCm }, focus: 'overview', rider: false, yaw: garage.yaw, bareHead: false };
      whenAtelierReady(() => !!garage && (atelier.set(only), true));
      return;
    }
    const st: AtelierState = {
      look: { ...look, heightCm: settings.heightCm },
      focus: 'overview',
      rider: true,
      yaw: 0,
      bareHead,
      view: { cam: [0, 0, 0], look: [v.look[0], v.look[1] - (k - 1) * 0.35, v.look[2]], fov: v.fov },
    };
    // La caméra reste dans la pièce (murs à x = −3,2 / 3,4 et z = −3 / 3,4) : elle recule moins et l'angle de champ
    // s'élargit pour garder le même cadrage.
    const cam: [number, number, number] = [(v.cam[0] * c + v.cam[2] * sn) * k, v.cam[1] + (k - 1) * 0.3, (-v.cam[0] * sn + v.cam[2] * c) * k];
    const room = (val: number, neg: number, pos: number) => (val < 0 ? neg / -val : pos / val);
    const fit = Math.min(1, room(cam[0], 2.8, 3.2), room(cam[2], 2.6, 3.2));
    st.view = { cam: [cam[0] * fit, cam[1], cam[2] * fit], look: st.view!.look, fov: fit < 1 ? (2 * Math.atan(Math.tan((v.fov * Math.PI) / 360) / fit) * 180) / Math.PI : v.fov };
    whenAtelierReady(() => !!garage && (atelier.set(st), true));
  };
  menu.onScene = (view, yaw, bikeOnly) => {
    if (!inMenu || exploring) return;
    if (view !== 'poster') {
      menuVideo.stop();
      garage = { view, yaw, ...(bikeOnly ? { bikeOnly } : {}) };
      return showGarage(garageLook ?? menu.currentLook());
    }
    garage = null;
    garageLook = null;
    atelier.set(null);
    // Accueil : la vidéo de la saison (attend le paysage si l'image 3D sert).
    if (menuVideo.show(settings.season)) return;
    menuVideo.stop();
    poster.setView('poster', yaw);
    // Écran d'attente tant que le paysage n'est pas prêt : `worldReady` est une promesse déjà « vraie » pendant qu'elle court.
    if (worldDone) return renderPoster();
    void withWorld(getLang() === 'fr' ? 'Chargement de l’accueil…' : 'Loading the home screen…').then(() => {
      if (!inMenu || exploring || garage) return;
      poster.setView('poster', yaw);
      renderPoster();
    });
  };
  menu.onTutorial = () => {
    void prepareAtelier();
    // Tutoriel terminé ou passé : retour à l'accueil, sans lancer de sortie.
    const preview = {
      show: (look: AvatarLook, bareHead = true) => {
        if (!inMenu) return;
        menuVideo.stop();
        garage = { view: '3q', yaw: 0, far: 1.45 };
        // Tête nue (teint et cheveux visibles), sauf quand on vient de choisir un casque.
        showGarage(look, bareHead);
      },
      hide: () => {
        garage = null;
        atelier.set(null);
      },
    };
    // Fin du tutoriel : directement le menu (onglet Rouler), sans repasser par la page d'accueil et son bouton.
    new Onboarding(ui, settings, devices.panel, () => menu.show('ride'), preview).start();
  };
  // Tout ce qui se télécharge ou se compile pour l'accueil et le garage se fait ici, sous l'écran de chargement :
  // une fois le menu (et sa vidéo) affiché, « Rouler » est utilisable tout de suite.
  if (!autostart) {
    bootStep(50, 'Chargement des avatars');
    await modelsReady.catch(() => undefined);
    bootStep(60, 'Préparation du garage');
    await prepareAtelier();
    // Paysage du départ choisi, véhicules : prêts avant l'accueil, « Rouler » démarre sans attente.
    bootStep(80, 'Préparation du paysage');
    bootWorld = (p) => bootProgress(80 + 19 * (p / 0.85));
    await Promise.all([prepareWorld().catch(() => undefined), vehiclesReady]);
    bootWorld = null;
  }
  bootDone();
  void offerDesktopUpdate();
  if (autostart) {
    await withWorld(getLang() === 'fr' ? 'Préparation de la sortie…' : 'Preparing the ride…');
    void startRide(scene, settings, devices.source(), {});
  } else {
    // L'atelier est déjà préparé (écran de chargement) ; aucune zone : l'accueil est une vidéo,
    // le paysage se prépare au clic sur « Rouler ».
    // Compte : session existante, sinon écran de connexion (sauf choix « sans compte »).
    let me: Me | null = await fetchMe();
    if (me) applyProfile(me, settings);
    const afterLogin = () => {
      menu.account = me ? { name: me.profile.displayName, level: me.progression.level, ...(me.atelier ? { credits: me.atelier.credits } : {}) } : null;
      // Retour de la liaison Strava : on revient sur la rubrique des Réglages qui l'affiche.
      const fromStrava = new URLSearchParams(location.search).has('strava');
      if (fromStrava) menu.openSettingsSection('lang');
      // Toujours l'accueil d'abord : son bouton « Rouler » (visible une fois le garage chargé) donne le premier geste qui
      // autorise le son, puis ouvre le tutoriel au premier lancement (menu.onHomeRide) ou l'onglet Rouler.
      menu.show(fromStrava ? 'settings' : 'home');
    };
    menu.onHomeRide = () => {
      if (!Onboarding.needed()) return false;
      menu.hide();
      menu.onTutorial?.();
      return true;
    };
    menu.onLogin = () =>
      void showLogin(ui, settings, (m) => {
        me = m;
        afterLogin();
      });
    menu.onLogout = async () => {
      await logout();
      me = null;
      localStorage.removeItem('ar.skipLogin');
      afterLogin();
    };
    // Profil envoyé au compte une fois les réglages stabilisés (1,5 s sans changement).
    let pushTimer: ReturnType<typeof setTimeout> | undefined;
    menu.onSettingsSaved = (st) => {
      if (!me) return;
      clearTimeout(pushTimer);
      pushTimer = setTimeout(() => void pushProfile(st, me?.progression.level), 1500);
    };
    if (!me && !localStorage.getItem('ar.skipLogin')) menu.onLogin();
    else afterLogin();
  }
}

/** Matériel du poste, repris par la salle d'attente des courses (posé au démarrage). */
let devicePanel: DevicePanel | null = null;

async function startRide(scene: Scene3D, s: Settings, input: InputSource, extras: { workoutFile?: { name: string; content: string }; inviteCode?: string; inviteFriends?: string[]; tutorial?: boolean; openStart?: { x: number; z: number }; publicRoom?: boolean; nearFriend?: string }, overlay?: HTMLElement): Promise<void> {
  const { engine, world, source } = scene;
  // Écran gardé allumé pendant la sortie (rendu à Windows au retour au menu, qui recharge la page).
  keepAwake(true);
  // Monde ouvert : chemin construit au fil des carrefours (le même RouteTrack s'allonge).
  const nav =
    s.mode === 'open' && source.open
      ? new OpenNavigator(
          source.open.graph,
          // Départ ailleurs qu'au point par défaut : choisi sur la carte du menu, ou ?x=…&z=… (repère monde, m).
          extras.openStart ?? (new URLSearchParams(location.search).has('x') ? { x: Number(new URLSearchParams(location.search).get('x')), z: Number(new URLSearchParams(location.search).get('z') ?? 0) } : source.open.start),
          getLang() === 'fr' ? `Monde ouvert — ${source.name}` : `Open world — ${source.name}`,
        )
      : null;
  const track = nav ? nav.track : scene.track;
  // Monde ouvert : les abords (style jeu vidéo) suivent le tracé du navigateur.
  if (nav) world.setTrack(track);
  // Défi KOM : départ lancé avant le pied de la montée choisie, fantôme du record.
  const komSeg = s.mode === 'challenge' && !nav ? (track.route.segments.find((g) => g.kind === 'kom' && g.id === s.challengeSeg) ?? track.route.segments.find((g) => g.kind === 'kom')) : undefined;
  const challenge = komSeg ? new KomChallenge(engine.scene, track, komSeg, { ...s.look, heightCm: s.heightCm }) : null;
  let challengeResult: ChallengeResult | null = null;
  // L'accueil n'a préparé que le lieu de l'affiche : le paysage autour du départ doit être là avant le
  // premier rendu, sinon le HUD s'affiche sur un ciel vide. L'écran d'attente reste jusqu'à la première image :
  // c'est elle qui compile la chaîne de rendu complète (ombres, post-traitement) et fige le navigateur un moment.
  const startOverlay = overlay ?? rideOverlay();
  {
    const d0 = challenge?.startD ?? (nav ? 0 : Number(new URLSearchParams(location.search).get('d') ?? 0));
    const p0 = track.positionAt(d0, 1.2);
    performance.mark('ar:départ : tuiles');
    await world.preload(new THREE.Vector3(p0.x, p0.y, p0.z), (d, t) => t > 0 && tileStage(startOverlay, 0.55, 0.85)(d, t));
  }
  ui.innerHTML = '';
  // Le vélo roulé dépend de l'équipement porté au garage et des pièces de l'atelier (masse, traînée, pneus, roues).
  const profile: RiderProfile = { id: 'local', displayName: s.name, massKg: s.massKg, heightCm: s.heightCm, ftpWatts: s.ftpWatts, bike: tunedBike() };
  const params = new URLSearchParams(location.search);
  const startD = nav ? 0 : challenge ? challenge.startD : Number(params.get('d') ?? 0);
  const ride = new RideSession({
    profile,
    standWatts: s.standWatts,
    track,
    trainerDifficulty: s.trainerDifficulty,
    drivetrain: s.drivetrain,
    cassetteSpeeds: s.cassetteSpeeds,
    startDistM: startD,
    wind: { ms: s.windMs, from: 4.4 },
    inertiaFactor: s.inertia,
  });
  // Modèle du vélo (route, gravel, VTT) : celui du vélo équipé.
  const avatar = createAvatar({ ...s.look, heightCm: s.heightCm, bikeType: profile.bike.tyre ?? 'road' });
  engine.scene.add(avatar.root);
  // Phare avant (la nuit) : projecteur fixé au vélo, sans ombre portée (coût).
  const headlight = new THREE.SpotLight(0xfff1d6, 0, 60, 0.45, 0.6, 1.4);
  headlight.position.set(0, 1.0, 0.6);
  headlight.target.position.set(0, 0, 14);
  avatar.root.add(headlight, headlight.target);
  // Séance structurée : fichier .zwo/.erg/.mrc ou test FTP (rampe) ; pas d'IA pendant une séance.
  let workout: WorkoutController | null = null;
  try {
    if (s.mode === 'workout' && extras.workoutFile) workout = new WorkoutController('file', s.ftpWatts, extras.workoutFile);
    else if (s.mode === 'workout' && s.workoutPreset) workout = new WorkoutController('library', s.ftpWatts, undefined, s.workoutPreset);
    else if (s.mode === 'ftpTest') workout = new WorkoutController(params.get('ftptest') === '20' ? 'ftp20' : 'ramp', s.ftpWatts);
  } catch (e) {
    console.warn('Séance illisible', e);
  }
  // Sortie de groupe / course : le serveur fait rouler tout le monde (IA comprises).
  // Heure et météo de la sortie : réglages du coureur ; en groupe, celles de l'hôte (partagées).
  const myWeather: RideWeather = { hour: s.hour, clouds: s.clouds, rain: s.rain, fog: s.fog, windMs: s.windMs, evolving: s.weatherEvolves, seed: weatherSeed(`${Date.now()}`) };
  // Météo réelle du jour au départ, à l'heure choisie (Open-Meteo) ; sans réseau : conditions réglées.
  if (s.realWeather && source.originL93) {
    const p0 = track.positionAt(startD, 0);
    const { lat, lon } = worldToWgs84(p0.x, p0.z, source.originL93);
    const real = await fetchRealWeather(lat, lon, s.hour);
    const L = getLang() === 'fr';
    if (real) Object.assign(myWeather, real, { evolving: false });
    setTimeout(
      () =>
        hud.toast(
          real
            ? L
              ? `Météo du jour : nuages ${Math.round(real.clouds * 100)} %, vent ${Math.round(real.windMs * 3.6)} km/h`
              : `Today's weather: clouds ${Math.round(real.clouds * 100)} %, wind ${Math.round(real.windMs * 3.6)} km/h`
            : L
              ? 'Météo réelle indisponible : conditions réglées'
              : 'Real weather unavailable: custom conditions',
        ),
      700,
    );
  }
  let rideWeather = myWeather;
  let mp: Multiplayer | null = null;
  let voice: VoiceChat | null = null;
  if (s.mode === 'group' || s.mode === 'race' || extras.publicRoom) {
    // Profil (avatar) envoyé au compte juste avant l'entrée : les autres te voient comme tu te vois.
    mp = new Multiplayer(engine.scene, track, s.name, () => pushProfile(s));
    try {
      // Monde ouvert : salle publique de la zone (celle des amis d'abord), sans code ni hôte.
      if (extras.publicRoom) {
        // Premier arrivé : son heure et sa météo ouvrent la salle, figées (sans évolution) pour tous ceux qui suivent.
        await mp.connectPublic(track.route.id, s.name, extras.nearFriend, { ...myWeather, evolving: false });
        if (mp.weather) rideWeather = mp.weather;
        const L = getLang() === 'fr';
        const here = mp.friendsHere.join(', ');
        setTimeout(() => hud.toast(here ? (L ? `Tes amis sont là : ${here}` : `Your friends are here: ${here}`) : L ? 'Monde ouvert : tu roules avec les coureurs connectés' : 'Open world: you are riding with the riders online'), 600);
      } else {
      const code = await mp.connect({ ...(extras.inviteCode ? { inviteCode: extras.inviteCode } : {}), mode: s.mode, guest: s.guest, aiRiders: s.aiRiders, aiLevel: s.aiLevel, ...(s.groupTargetKmh ? { targetKmh: s.groupTargetKmh } : {}), laps: s.raceLaps, trainerDifficulty: s.trainerDifficulty, name: s.name, weather: myWeather, ...(s.equalEquipment !== undefined ? { equalEquipment: s.equalEquipment } : {}) });
      // Équipement égalisé : la prédiction locale roule le même vélo que le serveur.
      if (mp.equalized) Object.assign(ride.params, { ...paramsFromBike(s.massKg, EQUALIZED_BIKE), inertiaFactor: ride.params.inertiaFactor });
      setTimeout(() => hud.toast(`${getLang() === 'fr' ? 'Code d’invitation' : 'Invite code'} : ${code}`), 500);
      if (mp.weather) rideWeather = mp.weather;
      // « Partir et inviter » depuis l'onglet Amis : invitations envoyées une fois la salle créée.
      if (extras.inviteFriends?.length) {
        void sendRideInvites(mp.net.roomId, extras.inviteFriends).then((n) => n && setTimeout(() => hud.toast(getLang() === 'fr' ? `Invitation envoyée à ${n} ami${n > 1 ? 's' : ''}` : `Invite sent to ${n} friend${n > 1 ? 's' : ''}`), 2500));
      }
      }
    } catch (e) {
      console.warn(extras.publicRoom ? 'Monde ouvert indisponible, sortie solo' : 'Serveur injoignable, sortie solo', e);
      const L = getLang() === 'fr';
      const reason = String((e as Error).message ?? e);
      const login = /Connexion requise|401/.test(reason);
      // Rejoindre un ami impossible (il est parti, sa salle est pleine) : le message du serveur.
      const friendMsg = extras.nearFriend && !login ? reason : '';
      setTimeout(() => hud.toast(friendMsg ? `${friendMsg}${L ? ' : sortie solo' : ': solo ride'}` : login ? (L ? 'Connecte-toi pour rouler en monde ouvert : sortie solo' : 'Sign in to ride in the open world: solo ride') : L ? 'Serveur injoignable : sortie solo' : 'Server unreachable: solo ride'), 500);
      mp = null;
    }
  }
  // Poids envoyé au trainer FE-C (Neo…) : celui du vélo réellement roulé, égalisé ou non en multijoueur.
  input.setRiderWeights?.(s.massKg, ride.params.massKg - s.massKg);
  // Sortie solo, séance, test FTP et défi : seul sur la route. Des IA locales seulement en repli d'une sortie de groupe / course (serveur injoignable).
  const aiCount = workout || mp || challenge || (s.mode !== 'group' && s.mode !== 'race') ? 0 : Math.min(Math.max(s.aiRiders, 0), engine.quality.aiRidersMax);
  const peloton = new Peloton(engine.scene, track, aiCount, startD, s.ftpWatts * (s.aiLevel ?? 1));
  const ghost = new Ghost(engine.scene, track, track.route.id, startD, { ...s.look, heightCm: s.heightCm });
  // Fantôme d'un ami (compte connecté, tour complet depuis le départ) : son meilleur tour sur cette boucle.
  // Et son propre record est envoyé au serveur pour que ses amis le retrouvent.
  const ghostable = !s.guest && !mp && !nav && !workout && !challenge && startD === 0 && !track.route.id.startsWith(ITINERARY_PREFIX);
  let friendGhost: FriendGhost | null = null;
  let disposed = false;
  if (ghostable) {
    ghost.onSaved = (lap) => void uploadGhost(track.route.id, lap);
    const mine = ghost.bestLap();
    if (mine) void uploadGhost(track.route.id, mine);
    void fetchFriendGhost(track.route.id).then((g) => {
      if (!g || disposed) return;
      friendGhost = new FriendGhost(engine.scene, track, g, { ...DEFAULT_LOOK, ...g.look });
      const L = getLang() === 'fr';
      hud.toast(`${L ? 'Fantôme de' : 'Ghost of'} ${g.name} · ${Math.floor(g.lapTimeS / 60)}:${String(Math.round(g.lapTimeS % 60)).padStart(2, '0')}`);
    });
  }
  peloton.shadowRiders = engine.quality.shadowRiders;
  peloton.onWait = (name) => name && hud.toast(getLang() === 'fr' ? `On attend ${name}` : `Waiting for ${name}`);
  peloton.onFormation = (f, pref) => {
    const L = getLang() === 'fr';
    const label = { single: L ? 'file indienne' : 'single file', double: L ? 'deux files tournantes' : 'double paceline', echelon: L ? 'bordure' : 'echelon' }[f];
    hud.toast(`${L ? 'Peloton' : 'Group'} : ${label}${pref === 'auto' ? (L ? ' (auto)' : ' (auto)') : ''}`);
  };
  peloton.onUTurn = (name) => hud.toast(getLang() === 'fr' ? `${name} fait demi-tour pour revenir au groupe` : `${name} turns back to rejoin the group`);
  // Source d'entrées après la ligne : mêmes capteurs, mais sans puissance ni pédalage.
  const coastInput: InputSource = Object.create(input, { read: { value: () => ({ ...input.read(), watts: 0, cadence: 0 }) } });
  const rig = new CameraRig(engine.camera, track, (x, z) => world.terrain.heightAt(x, z), engine.renderer.domElement);
  const footprints = world.buildings.footprints;
  rig.occlusion = (a, b) => footprints.firstHit(a.x, a.y, a.z, b.x, b.y, b.z);
  // Public sur les côtes (une fois le terrain chargé autour du départ).
  const crowd = new Crowd(track, (x, z) => world.terrain.heightAt(x, z), { riderName: s.name, density: engine.quality.crowdDensity });
  engine.scene.add(crowd.group);
  engine.scene.add(new TownSigns(track, (x, z) => world.terrain.heightAt(x, z)).group);
  const banners = new FinishBanners(track, (x, z) => world.terrain.heightAt(x, z));
  engine.scene.add(banners.group);
  // Monde vivant (circulation, cyclistes croisés) : désactivable par ?traffic=0.
  const alive = params.get('traffic') !== '0' && engine.quality.trafficDensity > 0;
  // Voitures (modèles chargés à la demande ; primitives si indisponibles).
  if (alive) await loadVehicleModels();
  const traffic = alive ? new Traffic(track, engine.quality.trafficDensity, startD, GltfRiderAvatar.lodScale) : null;
  traffic?.setPlaces(source.open?.places);
  if (traffic) engine.scene.add(traffic.group);
  if (import.meta.env.DEV && traffic) (globalThis as { __traffic?: Traffic }).__traffic = traffic;
  // Trains : départ quand on approche de l'endroit où la route longe ou croise une voie.
  const trains = new Trains(track, (x, z) => world.terrain.heightAt(x, z), () => world.terrain.loadedTiles());
  engine.scene.add(trains.group);
  if (import.meta.env.DEV && params.has('fakerail')) {
    // Développement : voie factice qui croise l'itinéraire 260 m devant le départ (1,4 km de long).
    const c = track.positionAt(startD + 260, 0);
    const pts: number[] = [];
    for (let k = -700; k <= 700; k += 20) pts.push(c.x - c.dirZ * k, c.z + c.dirX * k);
    trains.addRail(pts);
  }
  // Cyclistes croisés dans les deux sens (désactivables avec le monde vivant ou par ?cyclists=0).
  const cyclists = alive && params.get('cyclists') !== '0' ? new AmbientCyclists(engine.scene, track, startD) : null;
  if (cyclists) cyclists.heightAt = (x, z) => world.terrain.heightAt(x, z);
  if (cyclists) cyclists.shadowRange = engine.quality.shadowRiders >= 8 ? 35 : engine.quality.shadowRiders > 0 ? 20 : 0;
  // Les équipiers IA ne doublent par la gauche que si personne ne vient en face.
  if (cyclists) peloton.oncoming = (d, range) => cyclists.oncomingAhead(d, range);
  const hud = new Hud(hudRoot, track, source.attribution);
  // Mini-carte : fond Plan IGN quand le monde est calé en Lambert-93 ; bandeau « lieu » (commune, route).
  if (source.originL93) hud.setBasemap(source.originL93);
  hud.setPlaces(source.open?.places);
  const placeFinder = new PlaceFinder(source.open?.places, track.route.landmarks, track.length, !!track.route.loop);
  hud.setHidden(s.hudHidden ?? []);
  if (nav && source.open) hud.setOpen(source.open.graph);
  // En groupe, le panneau « À proximité » montre d'abord les coureurs réels.
  hud.riderFilter = mp ? 'real' : 'all';
  // Musique plus discrète en sortie ; titres Spotify annoncés dans le HUD.
  musicCtl.base = 0.6;
  music.setDuck(musicCtl.base);
  musicCtl.onTrack = (label) => hud.toast(`♪ ${label}`);
  hud.ftp = s.ftpWatts;
  hud.setVisible(true);
  if (workout) {
    workout.onMessage = (m) => hud.toast(m);
    workout.onFinished = (ftp) => {
      if (ftp) {
        hud.toast(`FTP estimée : ${ftp} W`);
        s.ftpWatts = ftp;
        saveSettings(s);
      } else hud.toast(t('segmentDone'));
    };
  }
  ghost.onNewRecord = (lapS, prev) => hud.toast(`${t('newRecord')} ${Math.floor(lapS / 60)}:${String(Math.round(lapS % 60)).padStart(2, '0')}${prev ? ` (−${Math.round(prev - lapS)} s)` : ''}`);
  const keyboard = new KeyboardControls();
  // Caméra libre : les flèches déplacent la caméra, pas le coureur.
  keyboard.arrowsBlocked = () => rig.mode === 'free';
  // Monde ouvert : à l'approche d'un carrefour, ← / → choisissent la sortie au lieu de déporter.
  const choosing = () => !!nav?.next && !nav.next.locked && nav.next.d - ride.state.distM < 350;
  keyboard.steerBlocked = choosing;
  // Son de la sortie (ambiances, roulement, roue libre, souffle, public, trafic) : audio/rideSound.ts.
  const audio = new RideSound({ world, track, ride, traffic, ftpWatts: s.ftpWatts });
  // Sons positionnés (églises, prés, eau) : la liste suit les tuiles chargées.
  const refreshSources = () => audio.setSources([...world.soundSources.values()].flat());
  refreshSources();
  const sourcesTimer = setInterval(refreshSources, 5000);

  const tutorial = extras.tutorial ? new RideTutorial() : null;
  let shifted = false;
  const onShift = (a: string) => {
    shifted = true;
    if (a === 'up') ride.shift(1);
    else if (a === 'down') ride.shift(-1);
    else if (a === 'frontUp') ride.shift(12);
    else if (a === 'frontDown') ride.shift(-12);
  };
  keyboard.onShift(onShift);
  input.onShift(onShift);
  input.onWarning?.((m) => hud.toast(m));
  const sequences = new RideSequences(document.getElementById('app') as HTMLElement, track);
  ride.onSegmentDone = (r) => {
    // Séquence HyperFrames (KOM / sprint) ; toast texte si les séquences sont coupées.
    // Rang solo : le joueur est classé seul ; en multijoueur le serveur fournit le vrai rang.
    if (s.guest) return;
    // Sommet d'une côte : photo automatique (caméra courante, sans l'interface).
    if (r.seg.kind === 'kom' && ride.summitPhotos.length < 6) {
      engine.renderManual();
      ride.summitPhotos.push(engine.renderer.domElement.toDataURL('image/jpeg', 0.85));
    }
    if (sequences.enabled) sequences.segment(r, s.name, rankRouteId(track.route.id), 1, 1);
    else hud.toast(`${t('segmentDone')} · ${r.seg.name} · ${Math.floor(r.timeS / 60)}:${String(Math.round(r.timeS % 60)).padStart(2, '0')}`);
  };
  // Sortie à plusieurs : salle d'attente et compte à rebours (course), panneau en direct, résultats, allure du groupe.
  let room: RideRoomUi | null = null;
  if (mp) {
    const net = mp.net;
    const voiceCfg = fetchVoiceConfig();
    // Monde ouvert : ni salle d'attente, ni départ, ni hôte (pas d'interface de sortie organisée).
    if (!mp.isPublic) {
      const roomUi = new RideRoomUi({
        hudRoot,
        net,
        track,
        mode: s.mode === 'race' ? 'race' : 'group',
        lang: getLang(),
        toast: (m) => hud.toast(m),
        voice: voiceCfg,
        ...(devicePanel ? { gear: { panel: devicePanel, phones: () => (companion.connected ? companion.presence.phones : null) } } : {}),
      });
      room = roomUi;
      // Course pas lancée : le coureur reste sur la grille (le serveur le tient immobile).
      roomUi.onHoldChange = (hold) => (ride.paused = hold);
      roomUi.onLeave = () => finish();
      // Vainqueur : bras levés en V au passage de la ligne, quelques secondes.
      roomUi.onWin = () => {
        avatar.setCelebrating?.(true);
        setTimeout(() => avatar.setCelebrating?.(false), 7000);
      };
    }
    // Télémétrie à 10 Hz : puissance mesurée (ou virtuelle pour un invité), rapport, direction.
    net.startTelemetry(() => ({ watts: ride.inputs.watts, cadence: ride.inputs.cadence, ...(ride.inputs.hr !== undefined ? { hr: ride.inputs.hr } : {}), gear: ride.gearIndex, steer: ride.lateral * ride.dir }));
    net.on('event', (ev) => {
      if (ev.kind === 'segmentEnd' && ev.riderId === net.selfId && !s.guest) {
        const seg = track.route.segments.find((x) => x.id === ev.segmentId);
        if (seg) sequences.segment({ seg, timeS: ev.timeMs / 1000, avgWatts: ride.avgWatts() }, s.name, rankRouteId(track.route.id), ev.rank, net.roster.size);
      } else if (ev.kind === 'chat') hud.addChat(net.roster.get(ev.riderId)?.name ?? '?', ev.text);
      else if (ev.kind === 'rideOn' && ev.to === net.selfId) hud.toast(rideOnMessage(net.roster.get(ev.from)?.name ?? '', getLang()));
      // Amis : arrivée (jeu chargé, il est sur la route) et départ annoncés.
      else if (ev.kind === 'join' && net.friendIds.has(ev.riderId)) hud.toast(getLang() === 'fr' ? `★ Ton ami ${ev.name} vient d'arriver` : `★ Your friend ${ev.name} just joined`);
      else if (ev.kind === 'leave' && net.friendIds.has(ev.riderId)) {
        // Parti pendant le chargement : il n'avait pas été annoncé, son départ non plus.
        const r = net.roster.get(ev.riderId);
        const who = r && !r.loading ? r.name : '';
        if (who) hud.toast(getLang() === 'fr' ? `Ton ami ${who} est parti` : `Your friend ${who} left`);
      }
      else if (ev.kind === 'results') {
        const top = ev.results.filter((r) => r.rank > 0).sort((a, b) => a.rank - b.rank);
        void sequences.podium(top.map((r) => ({ name: r.name, timeS: r.timeMs / 1000, color: net.roster.get(r.riderId)?.avatar.jersey ?? '#ffd23f' })));
      }
    });
    // Chat vocal LiveKit (micro coupé à l'arrivée, V pour parler) et Ride On depuis la liste.
    voice = new VoiceChat();
    // Repli Discord : lien du salon proposé quand LiveKit est absent ou échoue.
    voice.onState = (st, detail) => void voiceCfg.then((cfg) => hud.setVoice({ connected: st === 'connected', micOn: voice?.micOn ?? false, ...(detail ? { detail } : {}), discordUrl: cfg.discordInvite }));
    void voice.connect(net.roomId);
    // Monde ouvert : on n'entend que les coureurs proches.
    if (mp.isPublic && mp.proximity) {
      const near = mp.proximity;
      voice.setProximity({ distanceOf: (id) => mp?.distanceTo(id) ?? null, nearM: near.voiceNearM, farM: near.voiceFarM });
    }
    hud.onRideOn = (id) => {
      net.rideOn(id);
      hud.toast(`👍 → ${net.roster.get(id)?.name ?? ''}`);
    };
    mp.onCompanion((c) => {
      if (c.kind === 'shift') onShift(c.action);
      else if (c.kind === 'pause' || c.kind === 'resume') togglePause();
      else if (c.kind === 'camera') rig.setMode(c.camera);
      else if (c.kind === 'fan') input.setFan?.(c.percent);
      else if (c.kind === 'chat') net.chat(c.text);
      else if (c.kind === 'rideOn') net.rideOn(c.to);
    });
  }
  // Départ : intro + compte à rebours HyperFrames, la sortie démarre au « go » (?nointro pour les tests).
  // Course en ligne : le départ est donné par le serveur (compte à rebours synchronisé), pas par l'intro.
  const playIntro = () => {
    ride.paused = true;
    void sequences
      .intro({ season: s.season, riders: peloton.riders.length + 1, rideType: s.mode })
      .finally(() => (ride.paused = false));
  };
  if (s.mode === 'race' && !mp && devicePanel && !params.has('nointro') && !params.has('autostart')) {
    // Course sans salle en ligne : une fois dans la zone, la session attend le bouton (matériel visible et relançable).
    ride.paused = true;
    const panel = devicePanel;
    showStartGate(hudRoot.parentElement ?? hudRoot, {
      gear: { panel, phones: () => (companion.connected ? companion.presence.phones : null) },
      fr: getLang() === 'fr',
      routeName: track.route.name,
      watch: (cb) => {
        panel.onChange(cb);
        companion.listen(cb);
      },
      onStart: playIntro,
      onLeave: () => finish(),
    });
  } else if (!params.has('nointro') && !(mp && s.mode === 'race') && !mp?.isPublic) {
    // Monde ouvert : pas d'intro ni de compte à rebours — le coureur est déjà dans la salle (parfois dans la roue d'un ami) et doit rouler tout de suite.
    playIntro();
  }
  // Montée : annonce de chaque lacet numéroté ; arrivée au sommet d'un itinéraire aller simple.
  const hairpins = new HairpinWatcher(nav ? undefined : track.route.hairpins);
  let summitShown = false;
  const reachSummit = () => {
    summitShown = true;
    routeTimer.finish(ride.elapsedS);
    ride.state.distM = track.length;
    ride.state.speedMs = 0;
    ride.paused = true;
    hud.setVisible(false);
    input.sendTrainer({ kind: 'simulation', gradePercent: 0 });
    const kom = ride.segmentResults.filter((r) => r.seg.kind === 'kom').at(-1);
    const stats = summitStats({
      elapsedS: ride.elapsedS,
      distanceM: ride.state.distM - startD,
      elevationGainM: ride.elevationGainM,
      avgWatts: ride.avgWatts(),
      massKg: s.massKg,
      ...(kom ? { kom: { name: kom.seg.name, timeS: kom.timeS, avgWatts: kom.avgWatts, climbM: track.sample(kom.seg.endM).y - track.sample(kom.seg.startM).y, recordS: readKomRecord(rankRouteId(track.route.id), kom.seg.id)?.timeS ?? null } } : {}),
    });
    showSummit(ui, { routeName: track.route.name, altitudeM: track.sample(track.length).y, stats }, {
      onSummary: () => finish(),
      // XP, historique et records comptés comme à une fin normale, puis retour au menu.
      onMenu: () => {
        finish();
        teardown(false);
      },
    });
  };
  // Temps classés (sortie solo) : montées, sprints et parcours entier, pris du départ (0 m) jusqu'à
  // l'arrivée ou sur chaque tour complet, envoyés à chaque tour et à la fin. Pas en invité, en groupe (la salle les
  // enregistre), en séance ERG, en monde ouvert ni sur un itinéraire dessiné.
  const ranked = !s.guest && !mp && !nav && !workout && !track.route.id.startsWith(ITINERARY_PREFIX);
  const routeTimer = new RouteTimer(startD === 0 && !challenge);
  let sentSegments = 0;
  let sentRouteTimes = 0;
  // Un envoi par temps du parcours (chaque tour d'une boucle, dès la ligne passée), avec les
  // montées et sprints faits depuis l'envoi précédent.
  const sendEfforts = () => {
    if (!ranked) return;
    do {
      const segs = ride.segmentResults.slice(sentSegments);
      const routeS = routeTimer.times[sentRouteTimes];
      if (!segs.length && routeS === undefined) return;
      sentSegments = ride.segmentResults.length;
      if (routeS !== undefined) sentRouteTimes++;
      void postRideEfforts({
        // départ déplacé sur une boucle : mêmes montées et même tour, classés avec la boucle
        routeId: rankRouteId(track.route.id),
        rideId: String(ride.startT),
        segments: segs.map((r) => ({ segmentId: r.seg.id, elapsedMs: Math.round(r.timeS * 1000) })),
        ...(routeS !== undefined ? { routeTimeMs: Math.round(routeS * 1000) } : {}),
      });
    } while (sentRouteTimes < routeTimer.times.length);
  };
  ride.onLap = (lap) => {
    const done = routeTimer.lap(ride.elapsedS);
    const fr = getLang() === 'fr';
    hud.toast(done ? `${t('lap')} ${lap - 1} · ${fmtLapTime(done.timeS)}${done.best ? (fr ? ' · meilleur tour' : ' · best lap') : ''}` : `${t('lap')} ${lap}`);
    ghost.lap(ride.elapsedS, ride.state.distM);
    friendGhost?.lap(ride.elapsedS);
    sendEfforts();
  };

  // Fin de sortie : écran de stats par-dessus la scène figée. « Reprendre » relance la sortie (solo) ;
  // « Nouvelle sortie » et « Quitter » rendent la main au menu. XP, historique et records sont
  // enregistrés à chaque fin (sans double compte si la sortie a été reprise).
  const recordsBefore = readPowerRecords();
  let credited: { distanceM: number; elevationM: number; movingS: number } | undefined;
  const fileStem = () => `allez-robert-${new Date(ride.startT).toISOString().slice(0, 16).replace(/[:T]/g, '-')}`;
  const fitBytes = () => rideToFit(ride, { name: `Allez Robert ! — ${track.route.name}`, massKg: s.massKg, ftp: s.ftpWatts, ...(source.originL93 ? { originL93: source.originL93 } : {}), skipStrava: s.skipStrava });
  const teardown = (autostart: boolean) => {
    disposed = true;
    engine.renderer.setAnimationLoop(null);
    const raceHtml = room?.summaryHtml() ?? '';
    room?.dispose();
    clearInterval(sourcesTimer);
    void mp?.dispose();
    void voice?.disconnect();
    tutorial?.stop();
    audio.dispose();
    input.sendTrainer({ kind: 'simulation', gradePercent: 0 });
    const url = new URL(location.href);
    if (autostart) url.searchParams.set('autostart', '1');
    else url.searchParams.delete('autostart');
    location.href = url.toString();
  };
  const finish = () => {
    ride.paused = true;
    hud.setVisible(false);
    input.sendTrainer({ kind: 'simulation', gradePercent: 0 });
    const done = { distanceM: ride.state.distM - startD, elevationM: ride.elevationGainM, movingS: ride.elapsedS };
    // Invité : ni XP compétitive, ni segments, ni FIT.
    const xp = s.guest
      ? undefined
      : awardRide(done, credited, {
          segments: ride.segmentResults.length,
          koms: ride.segmentResults.filter((r) => r.seg.kind === 'kom').length,
          routeId: track.route.id,
          routeFinished: !nav && reachedFinish(track.route.loop, ride.dir, ride.state.distM, track.length),
          raceRank: room?.selfRank() ?? 0,
        });
    if (!s.guest) credited = done;
    sendEfforts();
    const stats = rideStats(ride.records, { ftp: s.ftpWatts, elevationGainM: ride.elevationGainM, elapsedS: ride.elapsedS });
    const records = s.guest ? { previous: recordsBefore, beaten: [] } : updatePowerRecords(stats.curve, recordsBefore);
    const previous = s.guest
      ? null
      : compareAndStore({ routeId: track.route.id, date: ride.startT, distanceM: stats.distanceM, movingS: stats.movingS, avgSpeedKmh: stats.avgSpeedKmh, avgWatts: stats.avgWatts, np: stats.np });
    const L = getLang() === 'fr';
    const trophies = awardTrophies(
      {
        distanceM: done.distanceM,
        elevationGainM: done.elevationM,
        komsDone: ride.segmentResults.filter((r) => r.seg.kind === 'kom').length,
        recordsBeaten: records.beaten.length,
        rainSeen,
        nightSeen,
        openWorld: !!nav,
        draftS: ride.group.draftS,
        pulls: ride.group.pulls,
        workoutFinished: !!workout?.position.finished,
        guest: s.guest,
      },
      String(ride.startT),
    );
    const trophyXp = trophies.reduce((a, t) => a + t.xp, 0);
    const after = trophyXp && xp ? addXp(trophyXp) : null;
    showRideSummary(
      ui,
      {
        ride,
        stats,
        routeName: track.route.name,
        ftp: s.ftpWatts,
        massKg: s.massKg,
        previous,
        records,
        withGroup: peloton.riders.length > 0 || !!mp || ride.group.draftS > 0,
        guest: s.guest,
        trophies: trophies.map((t) => ({ name: t.name[getLang()], description: t.description[getLang()], xp: t.xp })),
        ...(challengeResult ? { challenge: challengeResult } : {}),
        ...(xp
          ? {
              xp: {
                gained: xp.total + trophyXp,
                level: after?.level ?? xp.level,
                progress: after?.progress ?? xp.progress,
                levelUp: xp.levelUp,
                detail: `${Math.round((20 * done.distanceM) / 1000)} ${L ? 'distance' : 'distance'} · ${Math.round(done.elevationM)} ${L ? 'dénivelé' : 'climbing'} · ${Math.round((2 * done.movingS) / 60)} ${L ? 'temps' : 'time'}`,
                unlocked: xp.unlocked.map((u) => u.name[getLang()]),
                credits: xp.credits,
                won: xp.won.map((u) => u.name[getLang()]),
              },
            }
          : {}),
      },
      {
        onShareCard: async () => {
          const photo = ride.summitPhotos[0];
          const blob = await shareCard(ride, { routeName: track.route.name, riderName: s.name, ftp: s.ftpWatts, ...(photo ? { photo } : {}) });
          download(new Uint8Array(await blob.arrayBuffer()), `${fileStem()}.png`, 'image/png');
        },
        onFit: () => download(fitBytes(), `${fileStem()}.fit`),
        onGpx: () => download(rideToGpx(ride, { name: `Allez Robert ! — ${track.route.name}`, ...(source.originL93 ? { originL93: source.originL93 } : {}) }), `${fileStem()}.gpx`, 'application/gpx+xml'),
        // Multijoueur : le serveur a pu terminer la sortie, on ne reprend pas.
        ...(mp
          ? {}
          : {
              onResume: () => {
                ui.innerHTML = '';
                hud.setVisible(true);
                ride.paused = false;
              },
            }),
        onNewRide: () => teardown(true),
        onQuit: () => teardown(false),
        ...(s.guest ? {} : { onlineBox: (box: HTMLElement) => void onlinePanel(box, ride, fitBytes) }),
      },
    );
  };
  if (challenge) {
    challenge.onDone = (r) => {
      challengeResult = r;
      const L = getLang() === 'fr';
      const t = `${Math.floor(r.timeS / 60)}:${String(Math.round(r.timeS % 60)).padStart(2, '0')}`;
      hud.toast(r.isRecord ? (r.previousS === null ? `🏁 ${t} · ${L ? 'premier record' : 'first record'}` : `🏆 ${L ? 'Record battu' : 'New record'} : ${t} (−${Math.round(r.previousS - r.timeS)} s)`) : `🏁 ${t} · ${L ? 'record' : 'best'} ${Math.floor((r.previousS as number) / 60)}:${String(Math.round((r.previousS as number) % 60)).padStart(2, '0')}`);
      // Quelques secondes pour savourer, puis l'écran de fin.
      setTimeout(() => !ride.paused && finish(), 4000);
    };
  }
  /** Écran de pause affiché (pas les autres arrêts : intro, salle d'attente, fin). */
  let pauseOpen = false;
  const togglePause = () => {
    ride.paused = !ride.paused;
    pauseOpen = ride.paused;
    // En pleine course, « Terminer » = abandonner (classé DNF).
    if (ride.paused)
      showPause(ui, {
        onResume: togglePause,
        onFinish: finish,
        onCompanion: () => companionQr().show(),
        graphics: {
          level: s.quality,
          current: engine.quality.level,
          onLevel: (l) => {
            s.quality = l;
            localStorage.setItem('ar.quality', l);
            saveSettings(s);
          },
          effects: { ao: engine.quality.ao, bloom: engine.quality.bloom, taa: engine.quality.taa },
          onEffect: (k) => engine.rebuildPipeline({ ...engine.quality, [k]: !engine.quality[k] }),
        },
        ...(mp?.net.roomId ? { roomId: mp.net.roomId } : {}),
        ...(room?.racing ? { finishLabel: getLang() === 'fr' ? 'Abandonner la course' : 'Abandon the race' } : {}),
      });
    else ui.innerHTML = '';
  };
  /**
   * Demi-tour : on repart dans l'autre sens, à droite de la chaussée. Monde ouvert : nouveau
   * chemin ; itinéraire : on le remonte (pas en multijoueur, le serveur fait la course).
   */
  const uturn = () => {
    if (nav) {
      if (nav.uturn(ride.state.distM)) {
        ride.state.speedMs = Math.min(ride.state.speedMs, 3);
        hud.toast(getLang() === 'fr' ? '↶ Demi-tour' : '↶ U-turn');
      }
    } else if (mp?.isPublic) {
      // Monde ouvert : le serveur décide (délai entre deux demi-tours) ; le jeu suit dès qu'il confirme le nouveau sens.
      mp.net.uturn();
    } else if (!mp && !workout) {
      ride.uturn();
      const L = getLang() === 'fr';
      hud.toast(ride.dir < 0 ? (L ? '↶ Demi-tour : à contresens de l’itinéraire' : '↶ U-turn: riding the route backwards') : L ? '↷ Retour dans le sens de l’itinéraire' : '↷ Back on the route direction');
    }
  };
  /** Équipiers : allure du groupe en % de FTP (±5 %). */
  const changePace = (delta: number) => {
    if (!peloton.riders.length) return;
    peloton.paceFtpPct = Math.min(1.2, Math.max(0.5, (peloton.paceFtpPct ?? 0.75) + delta * 0.05));
    hud.toast(`${getLang() === 'fr' ? 'Allure du groupe' : 'Group pace'} : ${Math.round(peloton.paceFtpPct * 100)} % FTP`);
  };
  const slowDown = () => {
    if (!peloton.riders.length) return;
    peloton.slowDown();
    hud.toast(getLang() === 'fr' ? '« Ralentissez ! »' : '“Ease up!”');
  };
  /** « Attendez-moi » : les équipiers devant moi me laissent revenir (90 s). */
  const waitMe = () => {
    if (!peloton.riders.length) return;
    peloton.waitForMe();
    hud.toast(getLang() === 'fr' ? '« Attendez-moi ! »' : '“Wait for me!”');
  };
  /** Forme du peloton : auto → file indienne → deux files → bordure. */
  const cycleFormation = () => {
    if (!peloton.riders.length) return;
    const pref = peloton.cycleFormation();
    const L = getLang() === 'fr';
    hud.toast(`${L ? 'Forme demandée' : 'Formation'} : ${{ auto: 'auto', single: L ? 'file indienne' : 'single file', double: L ? 'deux files' : 'double paceline', echelon: L ? 'bordure' : 'echelon' }[pref]}`);
  };
  /** Photo : rendu immédiat puis lecture du canvas (sans l'interface). */
  const photo = () => {
    engine.renderManual();
    const png = atob(engine.renderer.domElement.toDataURL('image/png').split(',')[1] ?? '');
    const bytes = Uint8Array.from(png, (c) => c.charCodeAt(0));
    // Application Windows : directement dans Images\Allez Robert ; navigateur : téléchargement.
    download(bytes, `allez-robert-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`, 'image/png');
    hud.toast('📷');
  };
  window.addEventListener('keyup', (e) => {
    if (e.key === 'x' || e.key === 'X') rig.lookBack = false;
  });
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
    if (nav && rig.mode !== 'free' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && choosing()) {
      e.preventDefault();
      nav.select(e.key === 'ArrowLeft' ? -1 : 1, ride.state.distM);
    }
    if (e.key === 'u' || e.key === 'U') uturn();
    if (e.key === 'x' || e.key === 'X') rig.lookBack = true;
    if (e.key === 'c' || e.key === 'C') {
      const m = rig.cycle();
      hud.toast(t(m === 'free' ? 'freeCam' : m));
    }
    if (e.key === 'h' || e.key === 'H') hud.toggle();
    if (e.key === 'm' || e.key === 'M') audio.toggleMute();
    // Musique : B lecture / arrêt (Spotify s'il est connecté, sinon musique du jeu), N morceau suivant.
    if (e.key === 'b' || e.key === 'B') {
      if (musicSource() === 'spotify') void spotify.toggleSmart().then((on) => hud.toast(on ? '♪ Spotify ▶' : '♪ Spotify ⏸'));
      else hud.toast(music.toggle() ? (getLang() === 'fr' ? '♪ Musique activée' : '♪ Music on') : getLang() === 'fr' ? '♪ Musique coupée' : '♪ Music off');
    }
    if (e.key === 'n' || e.key === 'N') {
      if (musicSource() === 'spotify') void spotify.next();
      else music.next();
    }
    if (mp && (e.key === 't' || e.key === 'T')) {
      e.preventDefault();
      hud.openChat((text) => mp?.net.chat(text));
    }
    if (voice && (e.key === 'v' || e.key === 'V')) void voice.toggleMic().then((on) => hud.setVoice({ connected: true, micOn: on }));
    // Équipiers : allure du groupe en % de FTP ([ / ]), ordre « ralentissez » (R).
    if (e.key === '[' || e.key === ']') changePace(e.key === ']' ? 1 : -1);
    if (e.key === 'r' || e.key === 'R') slowDown();
    if (e.key === 'k' || e.key === 'K') waitMe();
    if (e.key === 'f' || e.key === 'F') cycleFormation();
    if (e.key === 'p' || e.key === 'P') photo();
    if (e.key === ' ' || e.key === 'Escape') {
      e.preventDefault();
      togglePause();
    }
  });

  const timer = new THREE.Timer();
  timer.connect(document);
  const pos = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const sample = { x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, grade: 0, d: 0 };
  const dustSample = { x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, grade: 0, d: 0 };
  const eye = new THREE.Vector3();
  const hands = new THREE.Vector3();
  let hudAcc = 0;
  let remoteRiders: InterpolatedRider[] = [];
  /** Prochain virage annoncé au HUD, recalculé 5 fois par seconde ; affiché à 8 s de route (80 m au moins). */
  let turnInfo: { inM: number; angleDeg: number } | null = null;
  let turnCheckedAt = 0;
  const upcomingTurn = () => {
    const now = performance.now();
    if (now - turnCheckedAt > 200) {
      turnCheckedAt = now;
      const tn = track.nextTurn(ride.state.distM, ride.dir, 220);
      turnInfo = tn && tn.inM <= Math.max(80, ride.state.speedMs * 8) ? tn : null;
    }
    return turnInfo;
  };
  let prevHeading = Number.NaN;
  let bank = 0;
  /**
   * Demi-tour animé : le cap saute d'un demi-tour d'une image à l'autre (itinéraire remonté, chemin
   * inversé du monde ouvert) ; le coureur affiché tourne en arc sur la chaussée pendant UTURN_S.
   */
  const UTURN_S = 3.4;
  let turn: { t: number; fromHeading: number; delta: number; from: THREE.Vector3; fwdX: number; fwdZ: number } | null = null;
  const shownPos = new THREE.Vector3(Number.NaN, 0, 0);
  const shownDir = new THREE.Vector3();
  /** Caméra pendant un demi-tour : elle reste en place pendant que le vélo poursuit sa route et fait son arc, puis pivote doucement. */
  const camPos = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  let camTurn = false;
  let condAcc = Infinity;
  // Pour les trophées : pluie et nuit rencontrées pendant la sortie.
  let rainSeen = false;
  let nightSeen = false;
  const frame = (dt: number, render: boolean, manual = false) => {
    // Panneau F3 : temps de chaque poste de l'image (ce qui n'est pas mesuré compte en « autre »).
    let tm = performance.now();
    const lap = (label: string | null) => {
      if (!frameStats.enabled) return;
      const now = performance.now();
      if (label) frameStats.add(label, now - tm);
      tm = now;
    };
    const steer = keyboard.update(dt);
    if (nav) {
      nav.update(ride.state.distM);
      track.route.roadWidthM = Math.max(3, nav.widthAt(ride.state.distM));
    }
    // Conditions sous les roues, 4 fois par seconde : heure et météo de la sortie (qui avancent ou
    // évoluent au fil du temps), revêtement, abri du vent, pluie.
    condAcc += dt;
    if (condAcc > 0.25) {
      condAcc = 0;
      // En salle : temps de la salle (horloge du serveur), le même ciel pour tous ; en solo : chrono de la sortie.
      const wNow = weatherAt(rideWeather, weatherElapsedS(rideWeather, ride.elapsedS, mp?.net.serverNow()));
      const envState = world.env.state;
      envState.hour = wNow.hour;
      envState.weather.clouds = wNow.clouds;
      envState.weather.rain = wNow.rain;
      envState.weather.fog = wNow.fog;
      envState.weather.windMs = wNow.windMs;
      envState.weather.windFrom = wNow.windFrom;
      ride.setWind(wNow.windMs, wNow.windFrom);
      const here = track.positionAt(ride.state.distM, ride.lateral, sample);
      const t = world.terrain.getTile(...world.terrain.tileCoord(here.x, here.z));
      ride.surface = nav?.surfaceAt(ride.state.distM) ?? track.surfaceAt(ride.state.distM) ?? roadSurfaceAt(t, here.x, here.z, ride.surface);
      ride.shelter = windShelterAt(t, here.x, here.z, here.dirX, here.dirZ);
      ride.rain = world.env.state.weather.rain;
      if (!ride.paused) {
        rainSeen ||= ride.rain > 0.2;
        nightSeen ||= world.nightFactor() > 0.6;
      }
      // Jantes lumineuses de l'atelier : pulsation plus marquée la nuit.
      rimGlow.night.value = 0.35 + 0.65 * world.nightFactor();
    }
    if (workout) ride.ergTarget = workout.update(ride.elapsedS, ride.inputs.watts);
    // Course au salon / compte à rebours : immobile sur la grille, à la place donnée par le serveur.
    if (room?.holding) {
      ride.paused = true;
      const me = mp?.net.getSelfSnapshot();
      if (me) ride.state.distM = me.lap * track.length + me.distM;
    }
    lap('conditions');
    banners.setLap(ride.lap, s.mode === 'race' ? s.raceLaps : undefined);
    const prevD = ride.state.distM;
    // Ligne franchie en course : plus de pédalage, le coureur roule sur sa lancée.
    ride.update(dt, room?.finished ? coastInput : input, steer);
    lap('physique');
    // Jeu chargé : arrivée annoncée aux autres. Monde ouvert : à la première image où l'on roule (le serveur place alors
    // le coureur dans la roue de son ami) ; sortie de groupe / course : dès la première image, salon d'attente compris.
    if (mp && (!mp.isPublic || !ride.paused)) mp.notifyReady();
    if (!ride.paused && ride.dir > 0) {
      const hp = hairpins.update(prevD, ride.state.distM);
      if (hp) hud.toast(hairpinToast(hp, getLang() === 'fr'), true);
      if (!summitShown && !nav && !mp && reachedFinish(track.route.loop, ride.dir, ride.state.distM, track.length)) reachSummit();
    }
    if (!ride.paused) {
      ghost.update(dt, ride.elapsedS, ride.state.distM);
      friendGhost?.update(dt, ride.elapsedS);
      challenge?.update(dt, ride.state.distM - startD, ride.elapsedS);
      tutorial?.update({ shifted, gradePercent: ride.gradePercent, inSegment: !!ride.segment, draft: ride.draft, distM: ride.state.distM - startD });
      if (mp) {
        // Prédiction locale + correction douce vers la position autoritaire du serveur.
        ride.draft = mp.selfDraft();
        // Monde ouvert : demi-tour confirmé par le serveur → le coureur repart dans l'autre sens.
        if (mp.isPublic) {
          const sd = mp.selfDir();
          if (sd !== null && sd !== ride.dir) {
            ride.uturn();
            hud.toast(ride.dir < 0 ? (getLang() === 'fr' ? '↶ Demi-tour' : '↶ U-turn') : getLang() === 'fr' ? '↷ Demi-tour : retour dans le sens initial' : '↷ U-turn: back the original way');
          }
        }
        ride.state.distM += mp.reconcileLocal(ride.dir, ride.state.distM, dt);
      } else ride.draft = peloton.update(dt, { distM: ride.state.distM, lateral: ride.lateral, speedMs: ride.state.speedMs, watts: ride.inputs.watts, massKg: s.massKg, ftpWatts: s.ftpWatts, reversed: ride.dir < 0, headWindMs: ride.headWindMs, crossWindMs: ride.crossWindMs }, cyclists && ride.dir > 0 ? cyclists.sameWayBodies() : []);
      // Relais : quelqu'un roule dans ma roue (0,5 à 4 m derrière, à moins d'un mètre de côté).
      const onWheel = (d: number, lat: number) => {
        const gap = ride.state.distM - d;
        return gap > 0.5 && gap < 4 && Math.abs(lat - ride.lateral) < 1;
      };
      ride.wheelFollowed = peloton.riders.some((r) => onWheel(r.state.distM, r.lateral)) || remoteRiders.some((r) => r.dir === ride.dir && onWheel(r.unwrappedM, r.lateralM));
      // Collisions : ni le joueur ni les IA ne traversent un autre coureur (les coureurs distants, imposés par le serveur, ne bougent pas).
      if (ride.dir > 0) {
        const mobile = peloton.riders.filter((r) => !r.uturn.active);
        // Le joueur garde sa ligne : ce sont les IA qui s'écartent (ou qui sont retenues), jamais lui qui est déporté.
        const me: Body = { distM: ride.state.distM, lateral: ride.lateral, speedMs: ride.state.speedMs, priority: true };
        const ais: Body[] = mobile.map((r) => ({ distM: r.state.distM, lateral: r.lateral, speedMs: r.state.speedMs }));
        const far: Body[] = remoteRiders.filter((r) => r.dir === ride.dir).map((r) => ({ distM: r.unwrappedM, lateral: r.lateralM, speedMs: r.speedMs, fixed: true }));
        separateRiders([me, ...ais, ...far], roadHalfM(track.route.roadWidthM), dt);
        ride.state.distM = me.distM;
        ride.state.speedMs = me.speedMs;
        ride.lateral = me.lateral;
        mobile.forEach((r, i) => {
          const b = ais[i] as Body;
          r.state.distM = b.distM;
          r.state.speedMs = b.speedMs;
          r.lateral = b.lateral;
        });
        // Aucune IA entre la caméra de poursuite et mon coureur : elles doublent sur le côté ou restent en retrait.
        peloton.keepCameraClear({ distM: ride.state.distM, lateral: ride.lateral, speedMs: ride.state.speedMs }, dt);
      }
      // Abri derrière un tracteur ou une camionnette qui roule dans le même sens.
      if (traffic && ride.dir > 0) ride.draft = Math.max(ride.draft, traffic.draftFor(ride.state.distM, ride.lateral));
      if (cyclists) {
        const d = cyclists.update(dt, { distM: ride.state.distM, lateral: ride.lateral, speedMs: ride.state.speedMs }, engine.camera, peloton.riders.filter((r) => !r.uturn.active).map((r) => ({ distM: r.state.distM, lateral: r.lateral, speedMs: r.state.speedMs })));
        if (ride.dir > 0) ride.draft = Math.max(ride.draft, d);
      }
    }
    lap('coureurs IA');
    remoteRiders = mp ? mp.render(dt, engine.camera, ride.state.distM) : [];
    if (!ride.paused) {
      trains.update(dt, ride.state.distM, ride.dir, ride.state.speedMs);
      // Public : il s'anime quand le coureur approche (style jeu vidéo).
      crowd.update(ride.state.distM);
      if (traffic) {
        const push = traffic.yieldPush(ride.state.distM, ride.lateral, ride.dir);
        if (push) {
          const half = roadHalfM(track.route.roadWidthM);
          ride.lateral = Math.max(-half, Math.min(half, ride.lateral + push * dt));
        }
      }
      traffic?.update(dt, ride.state, [
        { distM: ride.state.distM, lateral: ride.lateral, speedMs: ride.state.speedMs },
        ...peloton.riders.map((r) => ({ distM: r.state.distM, lateral: r.lateral, speedMs: r.state.speedMs })),
        ...remoteRiders.map((r) => ({ distM: r.unwrappedM, lateral: r.lateralM, speedMs: r.speedMs })),
      ], ride.dir);
    }
    lap('trains, trafic');
    // Trajectoire d'affichage : virages pris en arc, cap progressif (la physique garde la distance sur le tracé).
    track.linePositionAt(ride.state.distM, ride.lateral, ride.state.speedMs, sample);
    pos.set(sample.x, sample.y + 0.06, sample.z);
    // Sens de marche : après un demi-tour, on remonte l'itinéraire.
    dir.set(sample.dirX * ride.dir, 0, sample.dirZ * ride.dir);
    const heading = Math.atan2(sample.dirX, sample.dirZ) + (ride.dir < 0 ? Math.PI : 0);
    if (Number.isNaN(prevHeading)) prevHeading = heading;
    if (Number.isNaN(shownPos.x)) shownPos.copy(pos);
    // Inclinaison en virage : ∝ v·(dψ/dt), bornée.
    let dh = heading - prevHeading;
    if (dh > Math.PI) dh -= Math.PI * 2;
    if (dh < -Math.PI) dh += Math.PI * 2;
    if (Math.abs(dh) > 2.4) {
      // Demi-tour : on tourne du côté où se trouve la nouvelle position (de l'autre côté de la chaussée).
      const side = (pos.x - shownPos.x) * Math.cos(prevHeading) - (pos.z - shownPos.z) * Math.sin(prevHeading);
      turn = { t: 0, fromHeading: prevHeading, delta: side >= 0 ? Math.PI : -Math.PI, from: shownPos.clone(), fwdX: Math.sin(prevHeading), fwdZ: Math.cos(prevHeading) };
      dh = 0;
    }
    prevHeading = heading;
    // Inclinaison en virage : physique (vitesse² × courbure de la trajectoire), comme les autres coureurs.
    let lean = track.leanAt(ride.state.distM, ride.state.speedMs, ride.dir);
    let shownHeading = heading;
    shownPos.copy(pos);
    if (turn) {
      turn.t = Math.min(1, turn.t + dt / UTURN_S);
      const t = turn.t;
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      shownHeading = turn.fromHeading + turn.delta * e;
      // De l'ancienne position à la nouvelle, en arc vers l'avant (rayon : la moitié de l'écart, 2 m au moins).
      const gap = Math.hypot(pos.x - turn.from.x, pos.z - turn.from.z);
      const bulge = Math.sin(Math.PI * e) * Math.max(2, gap / 2);
      shownPos.lerpVectors(turn.from, pos, e);
      shownPos.x += turn.fwdX * bulge;
      shownPos.z += turn.fwdZ * bulge;
      // Penché franchement dans l'épingle (≈ 23° au milieu du demi-tour).
      lean = -Math.sign(turn.delta) * 0.4 * Math.sin(Math.PI * t);
      // Caméra : immobile jusqu'à 45 % du demi-tour (l'image « s'arrête », on voit le vélo traverser la chaussée en
      // arc), puis elle rejoint doucement la nouvelle position et le nouveau cap (arrivée sur `pos` et `dir` : pas de
      // saut à la fin). Vue embarquée : la caméra sort derrière le coureur le temps du demi-tour (CameraTarget.uturn).
      const c = Math.min(1, Math.max(0, (t - 0.45) / 0.55));
      const cs = c * c * (3 - 2 * c);
      camPos.lerpVectors(turn.from, pos, cs);
      const camHeading = turn.fromHeading + turn.delta * cs;
      camDir.set(Math.sin(camHeading), 0, Math.cos(camHeading));
      camTurn = true;
      if (turn.t >= 1) turn = null;
    } else camTurn = false;
    bank += (lean - bank) * Math.min(1, dt * 3);
    shownDir.set(Math.sin(shownHeading), 0, Math.cos(shownHeading));
    avatar.root.position.copy(shownPos);
    avatar.root.rotation.set(0, 0, 0);
    avatar.root.rotateY(shownHeading);
    avatar.root.rotateX(-Math.atan((sample.grade * ride.dir) / 100));
    avatar.setEffort?.(ride.inputs.watts / Math.max(50, s.ftpWatts), ride.inputs.hr !== undefined ? ride.inputs.hr / 190 : undefined);
    avatar.update(dt, ride.inputs.cadence, ride.state.speedMs, ride.pose, bank);
    // Vue subjective et caméra embarquée : on garde le vélo, les bras et les mains, mais pas la tête.
    // (pendant un demi-tour, la caméra sort derrière le coureur : la tête redevient visible)
    const onboard = (rig.mode === 'cockpit' || rig.mode === 'action' || rig.mode === 'gopro') && !rig.lookBack && !camTurn;
    avatar.setHeadVisible(!onboard);
    lap('mon coureur');
    peloton.render(dt, engine.camera);
    lap('coureurs IA (animation)');
    // Poussière des roues sur les chemins non revêtus (coureur et coureurs IA), voir world/dust.ts.
    if (!ride.paused) {
      world.kickDust('me', pos.x, pos.y, pos.z, sample.dirX, sample.dirZ, ride.state.speedMs, dt);
      for (const r of peloton.riders) {
        const p = track.positionAt(r.state.distM, r.lateral, dustSample);
        world.kickDust(r.id, p.x, p.y, p.z, p.dirX, p.dirZ, r.state.speedMs, dt);
      }
    }

    const eyeOk = (rig.mode === 'cockpit' || rig.mode === 'action') && !!avatar.eyeWorld;
    if (eyeOk) avatar.eyeWorld?.(eye, hands);
    // Pendant un demi-tour, la caméra reste d'abord en place puis pivote doucement (voir camPos / camDir).
    rig.update(dt, { position: camTurn ? camPos : pos, dir: camTurn ? camDir : dir, distM: ride.state.distM, speedMs: ride.state.speedMs, sign: ride.dir, buzz: buzzLevel(ride.surface), uturn: camTurn, subject: shownPos, ...(eyeOk ? { eye, hands } : {}) });
    lap('poussière, caméra');
    // Les tuiles se chargent autour de la caméra libre, où qu'elle aille ; sinon autour du coureur.
    world.update(dt, rig.mode === 'free' ? engine.camera.position : pos);
    // Le monde mesure lui-même ses postes (tuiles, végétation) : pas de total ici, pour ne pas compter deux fois.
    lap(null);
    headlight.intensity = world.nightFactor() * 120;
    if (!render) return;
    engine.exposure.value = world.env.exposure();
    world.env.grade(engine.grade);
    if (manual) engine.renderManual();
    else engine.render();
    // Le rendu est mesuré à part (« rendu ») par le panneau.
    lap(null);

    audio.update(dt, pos, heading);
    lap('son');

    hudAcc += dt;
    if (hudAcc > 0.1) {
      hudAcc = 0;
      // Habillage TV synchronisé avec la caméra « réalisation TV ».
      const rank = 1 + peloton.riders.filter((r) => r.state.distM > ride.state.distM).length;
      // Roue juste devant (même voie à 1,5 m près, à moins de 30 m) : écart roue arrière → roue avant.
      const wheelGap = (): number | null => {
        let best: number | null = null;
        const consider = (d: number, lat: number) => {
          const gap = (d - ride.state.distM) * ride.dir - 1.75;
          if (gap > -0.5 && gap < 30 && Math.abs(lat - ride.lateral) < 1.5 && (best === null || gap < best)) best = Math.max(0, gap);
        };
        for (const r of peloton.riders) consider(r.state.distM, r.lateral);
        for (const r of remoteRiders) consider(r.unwrappedM, r.lateralM);
        return best;
      };
      // Vent ressenti : d'où il vient pour le coureur ; par vent de côté, l'abri est sous le vent.
      const windInfo = () => {
        const h = ride.headWindMs;
        const c = ride.crossWindMs;
        const from: 'face' | 'dos' | 'gauche' | 'droite' = Math.abs(h) >= Math.abs(c) ? (h > 0 ? 'face' : 'dos') : c > 0 ? 'gauche' : 'droite';
        return { kmh: Math.hypot(h, c) * 3.6, from, shelter: Math.abs(c) > 2 ? (c > 0 ? ('right' as const) : ('left' as const)) : null };
      };
      room?.update({ distM: ride.state.distM, speedMs: ride.state.speedMs, wkg: ride.watts3s() / s.massKg });
      sequences.tv(rig.mode === 'tv', { riderName: s.name, color: s.look.jersey, position: rank, wkg: ride.watts3s() / s.massKg, watts: ride.watts3s() });
      const i = ride.inputs;
      hud.update(
        {
          watts3s: ride.watts3s(),
          watts: i.watts,
          ...(i.hr !== undefined ? { hr: i.hr } : {}),
          cadence: i.cadence,
          speedKmh: ride.state.speedMs * 3.6,
          distM: ride.state.distM - startD,
          lapDistM: track.wrap(ride.state.distM),
          elapsedS: ride.elapsedS,
          elevationGainM: ride.elevationGainM,
          gradePercent: ride.gradePercent,
          avgWatts: ride.avgWatts(),
          np: ride.normalizedPower(),
          ftp: s.ftpWatts,
          gearLabel: ride.gearLabel,
          gearIndex: ride.gearIndex,
          gearCount: ride.gears.length,
          ...(i.balanceLeft !== undefined ? { balanceLeft: i.balanceLeft } : {}),
          draftPct: ride.draft * 100,
          draftW: ride.draftSavedW,
          wheelGapM: wheelGap(),
          wind: windInfo(),
          altitudeM: sample.y,
          lap: ride.lap,
          turn: upcomingTurn(),
          ...(() => {
            const town = placeFinder.at(pos.x, pos.z, track.route.loop ? ride.state.distM % Math.max(track.length, 1) : ride.state.distM);
            const road = nav?.roadName(ride.state.distM);
            return town ? { place: { town, ...(road ? { road } : {}) } } : road ? { place: { town: road } } : {};
          })(),
          riders: [
            { id: 'me', name: s.name, distM: ride.state.distM, x: pos.x, z: pos.z, me: true, isAI: false, isGuest: false, color: '#ffd23f', km: ride.state.distM / 1000, watts: ride.watts3s(), wkg: ride.watts3s() / s.massKg, ...(s.look.nationality ? { nationality: s.look.nationality } : {}) },
            ...remoteRiders.map((r) => {
              const p = track.sample(r.unwrappedM);
              const mass = mp?.net.roster.get(r.id)?.massKg ?? 75;
              return { id: r.id, name: r.name, distM: r.unwrappedM, x: p.x, z: p.z, me: false, isAI: r.isAI, isGuest: r.isGuest, color: r.avatar.jersey, online: !r.isAI, friend: mp?.net.friendIds.has(r.id) ?? false, speaking: voice?.speaking.has(r.name) ?? false, km: r.unwrappedM / 1000, watts: r.watts, wkg: r.watts / mass, ...(r.avatar.nationality ? { nationality: r.avatar.nationality } : {}) };
            }),
            ...(cyclists
              ? cyclists.roster(ride.state.distM, 400).map((c) => {
                  const mine = s.ftpWatts / s.massKg;
                  const follow: 'easy' | 'ok' | 'hard' = c.wkg > mine * 1.0 ? 'hard' : c.wkg < mine * 0.6 ? 'easy' : 'ok';
                  return { id: c.id, name: c.name, distM: c.distM, x: c.x, z: c.z, me: false, isAI: true, isGuest: false, color: c.color, wkg: c.wkg, km: c.km, watts: c.watts, ambient: { level: c.level, follow } };
                })
              : []),
            ...peloton.riders.map((r) => {
              const p = track.sample(r.state.distM);
              return { id: r.id, name: r.name, distM: r.state.distM, x: p.x, z: p.z, me: false, isAI: true, isGuest: false, color: r.color, km: r.state.distM / 1000, watts: r.watts, wkg: r.watts / r.massKg, nationality: r.nationality };
            }),
          ],
          ...(ride.segment ? { segment: { seg: ride.segment.seg, progress: ride.segment.progress, elapsedS: (ride.startT + ride.elapsedS * 1000 - ride.segment.startT) / 1000 } } : {}),
          devices: input.status(),
          ...(nav
            ? {
                open: {
                  distM: ride.state.distM,
                  road: nav.roadName(ride.state.distM),
                  junction: nav.next
                    ? {
                        inM: nav.next.d - ride.state.distM,
                        selected: nav.next.selected,
                        locked: nav.next.locked,
                        choices: nav.next.choices.map((c) => ({ dir: c.dir, name: c.name, unpaved: !/^(asphalt|paved|concrete|chipseal)/.test(c.surface) })),
                      }
                    : null,
                },
              }
            : {}),
        },
        s.massKg,
      );
      hud.setChallenge(challenge ? challenge.info(ride.state.distM - startD) : null);
      if (workout) {
        const w = workout.position;
        const next = workout.workout.steps[w.stepIndex + 1];
        hud.setWorkout({
          name: workout.workout.name,
          targetWatts: w.targetWatts,
          watts3s: ride.watts3s(),
          stepIndex: w.stepIndex,
          stepCount: workout.workout.steps.length,
          stepRemainingS: w.stepRemainingS,
          remainingS: w.remainingS,
          ...(next ? { next: `${Math.round(((next.powerStart + next.powerEnd) / 2) * (next.powerUnit === 'ftp' ? s.ftpWatts : 1))} W` } : {}),
          profile: workout.profile(s.ftpWatts),
          elapsedS: ride.elapsedS,
          totalS: workout.durationS,
        });
      }
      lap('affichage (HUD)');
    }
  };
  // Pipelines des objets ajoutés pour la sortie (coureur, groupe, circulation) compilés avant la première image,
  // au lieu de figer la première image du jeu.
  performance.mark('ar:départ : objets de la sortie');
  await engine.compileScene(tileStage(startOverlay, 0.85, 1));
  performance.mark('ar:départ : objets compilés');
  // Laisse l'écran d'attente se peindre, puis fait les premières images (lentes) derrière lui : la première
  // compile la passe de scène, les suivantes les ombres (redessinées une image sur deux) et le post-traitement.
  await new Promise<void>((r) => setTimeout(r, 50));
  for (let i = 0; i < 4; i++) engine.renderManual();
  performance.mark('ar:premières images');
  // Désormais, ce qui arrive dans la scène (tuiles, cyclistes) est compilé à l'avance avant d'être dessiné.
  engine.watchNewObjects(true);
  // Coureurs : niveau de détail choisi d'après la caméra de la sortie, niveaux masqués non recalculés.
  GltfRiderAvatar.camera = engine.camera;
  // Repère pour les outils de mesure (tools/perf) : la sortie commence.
  performance.mark('ar:ride-start');
  startOverlay.remove();
  engine.renderer.setAnimationLoop(() => {
    timer.update();
    frame(Math.min(timer.getDelta(), 0.1), true);
  });

  // Appli compagnon (QR code) : état de la sortie poussé au téléphone, ses commandes appliquées
  // comme les touches du clavier. Marche en solo ; en groupe, chat et Ride On passent par la salle.
  let fanPercent: number | undefined;
  const sendPairRoute = () => {
    const pts = track.route.points;
    if (nav) {
      // Monde ouvert : le chemin s'allonge, on n'envoie que les abords (1,5 km derrière, la suite devant).
      const d = ride.state.distM;
      companion.sendRoute({ name: track.route.name, loop: false, lengthM: track.length, open: true, points: decimateRoute(pts.filter((p) => p.d > d - 1500 && p.d < d + 1000)) });
    } else companion.sendRoute({ name: track.route.name, loop: track.route.loop, lengthM: track.length, points: decimateRoute(pts) });
  };
  sendPairRoute();
  if (nav) setInterval(sendPairRoute, 5000);
  let phones = companion.presence.phones;
  companion.listen(() => {
    if (companion.presence.phones > phones) hud.toast(getLang() === 'fr' ? 'Appli compagnon connectée' : 'Companion app connected', true);
    phones = companion.presence.phones;
  });
  hud.onToast = (text) => companion.sendEvent({ kind: 'toast', text });
  hud.onChat = (who, text) => companion.sendEvent({ kind: 'chat', who, text });
  companion.provider = (): PairState => {
    const i = ride.inputs;
    const d = ride.state.distM;
    const me = { id: mp?.net.selfId || 'me', name: s.name, gapM: 0, wkg: ride.watts3s() / s.massKg, color: s.look.jersey, me: true };
    const others = [
      ...remoteRiders.map((r) => ({ id: r.id, name: r.name, gapM: r.unwrappedM - d, wkg: r.watts / (mp?.net.roster.get(r.id)?.massKg ?? 75), color: r.avatar.jersey, ai: r.isAI, online: !r.isAI })),
      ...peloton.riders.map((r) => ({ id: r.id, name: r.name, gapM: r.state.distM - d, wkg: r.watts / r.massKg, color: r.color, ai: true })),
    ];
    // Les 11 plus proches, dans l'ordre de la course.
    const riders = [me, ...others.sort((a, b) => Math.abs(a.gapM) - Math.abs(b.gapM)).slice(0, 11)].sort((a, b) => b.gapM - a.gapM);
    const w = workout?.position;
    const wNext = w && workout ? workout.workout.steps[w.stepIndex + 1] : undefined;
    return {
      phase: pauseOpen ? 'paused' : 'ride',
      routeName: track.route.name,
      ...(nav ? { road: nav.roadName(d), open: true } : {}),
      multiplayer: !!mp,
      team: peloton.riders.length > 0,
      metrics: {
        speedKmh: ride.state.speedMs * 3.6,
        watts: i.watts,
        watts3s: ride.watts3s(),
        avgWatts: ride.avgWatts(),
        np: ride.normalizedPower(),
        cadence: i.cadence,
        ...(i.hr !== undefined ? { hr: i.hr } : {}),
        distM: d - startD,
        elapsedS: ride.elapsedS,
        elevationGainM: ride.elevationGainM,
        gradePercent: ride.gradePercent,
        altitudeM: track.sample(d).y,
        routeM: nav ? d : track.wrap(d),
        lap: ride.lap,
        draftPct: ride.draft * 100,
        ftp: s.ftpWatts,
        wkg: ride.watts3s() / s.massKg,
        // Énergie mécanique (kJ) ≈ calories dépensées (rendement musculaire ~24 %).
        kcal: (ride.avgWatts() * ride.elapsedS) / 1000,
        gearLabel: ride.gearLabel,
        gearIndex: ride.gearIndex,
        gearCount: ride.gears.length,
        ...(i.balanceLeft !== undefined ? { balanceLeft: i.balanceLeft } : {}),
      },
      pos: { x: pos.x, z: pos.z, heading: Number.isFinite(prevHeading) ? prevHeading : 0 },
      camera: rig.mode === 'free' ? 'chase' : rig.mode,
      ...(fanPercent !== undefined ? { fanPercent } : {}),
      hudVisible: hud.visible,
      music: companionMusic(),
      junction:
        nav?.next && nav.next.d - d < 600
          ? { inM: nav.next.d - d, selected: nav.next.selected, locked: nav.next.locked, choices: nav.next.choices.map((c) => ({ dir: c.dir, name: c.name, unpaved: !/^(asphalt|paved|concrete|chipseal)/.test(c.surface) })) }
          : null,
      segment: ride.segment ? { name: ride.segment.seg.name, kind: ride.segment.seg.kind, progress: ride.segment.progress, elapsedS: (ride.startT + ride.elapsedS * 1000 - ride.segment.startT) / 1000 } : null,
      workout:
        w && workout
          ? { name: workout.workout.name, targetWatts: w.targetWatts, stepRemainingS: w.stepRemainingS, remainingS: w.remainingS, ...(wNext ? { next: `${Math.round(((wNext.powerStart + wNext.powerEnd) / 2) * (wNext.powerUnit === 'ftp' ? s.ftpWatts : 1))} W` } : {}) }
          : null,
      riders,
    };
  };
  companion.onCommand = (c) => {
    if (companionMusicCommand(c)) return;
    const d = ride.state.distM;
    switch (c.kind) {
      case 'shift':
        onShift(c.action);
        break;
      case 'pause':
        if (!ride.paused) togglePause();
        break;
      case 'resume':
        if (pauseOpen) togglePause();
        break;
      case 'camera':
        rig.setMode(c.camera);
        break;
      case 'fan':
        fanPercent = c.percent;
        input.setFan?.(c.percent);
        break;
      case 'chat':
        mp?.net.chat(c.text);
        break;
      case 'rideOn':
        if (mp) hud.onRideOn?.(c.to);
        break;
      case 'turn':
        if (nav?.next && choosing()) nav.select(c.index !== undefined ? c.index - nav.next.selected : (c.delta ?? 0), d);
        break;
      case 'uturn':
        uturn();
        break;
      case 'hud':
        hud.toggle();
        break;
      case 'photo':
        photo();
        break;
      case 'slowDown':
        slowDown();
        break;
      case 'pace':
        changePace(c.delta);
        break;
      case 'waitMe':
        waitMe();
        break;
      case 'formation':
        cycleFormation();
        break;
    }
  };
  // Crochet de test : avance la simulation à pas fixe (1/60 s) sans dépendre de l'affichage.
  const advance = (seconds: number) => {
    const n = Math.round(seconds * 60);
    for (let k = 0; k < n; k++) frame(1 / 60, k === n - 1, true);
  };
  /** Capture du canvas (rendu immédiat puis lecture dans la même tâche) envoyée au serveur de dev. */
  const shot = async (name: string) => {
    frame(1 / 60, false);
    // Rendu manuel puis lecture du canvas dans la même tâche (avant présentation).
    engine.exposure.value = world.env.exposure();
    world.env.grade(engine.grade);
    engine.renderManual();
    const url = engine.renderer.domElement.toDataURL('image/jpeg', 0.9);
    const res = await fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: url });
    return res.text();
  };
  (window as unknown as { __ar: unknown }).__ar = { engine, world, ride, rig, track, peloton, traffic, cyclists, input, finish, advance, hud, shot, avatar, audio, room };
  // Contrôle visuel du monde (?worldcheck=1, développement) : une capture tous les 500 m de l'itinéraire.
  if (params.has('worldcheck')) {
    void (async () => {
      for (let d = 0; d < track.length; d += 500) {
        ride.state.distM = d;
        rig.setMode('chase'); // recale la caméra sans lissage après le saut
        advance(0.2);
        // Laisse le temps aux tuiles autour du nouveau point de se charger.
        await new Promise((r) => setTimeout(r, 6000));
        advance(1);
        await shot(`worldcheck-${track.route.id}-${String(Math.round(d)).padStart(5, '0')}`);
      }
      hud.toast('Contrôle visuel terminé : docs/screenshots/worldcheck-*');
    })();
  }
}

boot().catch((err) => {
  console.error(err);
  bootError(String((err as Error).message ?? err));
  ui.innerHTML = `<div class="loading">Erreur : ${String((err as Error).message ?? err)}</div>`;
});
