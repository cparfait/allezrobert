import './hud/hud.css';
import * as THREE from 'three/webgpu';
import { RouteTrack, decimateRoute, type PairState, type PhoneCommand, bikeOfLook, bikeSetupFor, weatherAt, weatherSeed, type RideWeather, type RiderProfile, type RouteData } from '@allezrobert/shared';
import { createEngine, type Engine } from './engine/renderer.ts';
import { QUALITY_PRESETS, withUrlOverrides, type QualitySettings } from './engine/quality.ts';
import { detectHardwareQuality } from './engine/autoQuality.ts';
import { World } from './world/world.ts';
import { loadWorldSource } from './world/loader.ts';
import type { WorldSource } from './world/types.ts';
import { GltfRiderAvatar, createAvatar } from './rider/gltfAvatar.ts';
import { CROWD_FAMILIES, onBikeFamilyLoaded } from './rider/bikes.ts';
import { CameraRig } from './game/cameras.ts';
import { FreeFlyCamera } from './game/freecam.ts';
import { RideSession } from './game/ride.ts';
import { KeyboardControls, type InputSource } from './game/inputs.ts';
import { Peloton } from './game/peloton.ts';
import { WorkoutController } from './game/workout.ts';
import { Ghost } from './game/ghost.ts';
import { createDeviceLayer } from './game/devices.ts';
import { Hud } from './hud/hud.ts';
import { RideSound } from './audio/rideSound.ts';
import { music } from './audio/music.ts';
import { companion } from './game/companionLink.ts';
import { companionQr } from './ui/companionQr.ts';
import { spotify } from './audio/spotify.ts';
import { t, setLang, getLang } from './i18n/index.ts';
import { loadSettings, saveSettings, type Settings } from './ui/settings.ts';
import { MainMenu } from './ui/menu.ts';
import { bootStep, bootDone, bootError } from './ui/splash.ts';
import { PosterScene, choosePosterSpot, POSTER_HOUR } from './ui/poster.ts';
import { showPause, rideToFit, rideToGpx, download, onlinePanel } from './ui/ridepanels.ts';
import { showRideSummary } from './ui/summary.ts';
import { compareAndStore, readPowerRecords, rideStats, updatePowerRecords } from './game/stats.ts';
import { shareCard } from './ui/sharecard.ts';
import { Onboarding, RideTutorial } from './onboarding/onboarding.ts';
import { addXp, awardRide, loadProgress, tunedBike } from './ui/garage.ts';
import { AtelierHost } from './ui/atelier.ts';
import { rimGlow } from './rider/rimDecal.ts';
import { EQUALIZED_BIKE, paramsFromBike } from '@allezrobert/physics';
import { awardTrophies } from './game/trophies.ts';
import { roadSurfaceAt, windShelterAt } from './world/conditions.ts';
import { OpenNavigator } from './game/open.ts';
import { ITINERARY_PREFIX } from './ui/routePlanner.ts';
import { waitBike } from './ui/waitBike.ts';
import { KomChallenge, readKomRecord, type ChallengeResult } from './game/challenge.ts';
import { HairpinWatcher, hairpinToast, reachedFinish, summitStats } from './game/climb.ts';
import { showSummit } from './ui/summit.ts';
import { fetchMe, showLogin, applyProfile, logout, pushProfile, type Me } from './ui/account.ts';
import { sendRideInvites } from './ui/friends.ts';
import { RideSequences } from './game/sequences.ts';
import { GuestInputSource } from './game/guest.ts';
import { Crowd } from './world/crowd.ts';
import { TownSigns } from './world/signs.ts';
import { Traffic, loadVehicleModels } from './world/traffic.ts';
import { AmbientCyclists } from './world/cyclists.ts';
import { Trains } from './world/trains.ts';
import { Multiplayer } from './game/multiplayer.ts';
import { VoiceChat, fetchVoiceConfig } from './game/voice.ts';
import { RideRoomUi } from './game/rideroom.ts';
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
  GltfRiderAvatar.lodScale = { low: 0.6, medium: 0.8, high: 1, ultra: 1.5 }[q.level];
  bootStep(35, 'Monde et itinéraires');
  const source = await loadWorldSource(params.get('world') ?? settings.world ?? 'chevreuse');
  // Le mode « monde ouvert » n'existe que dans un monde qui a un graphe routier.
  if (settings.mode === 'open' && !source.open) settings.mode = 'free';
  const route = source.routes.find((r) => r.id === (params.get('route') ?? settings.routeId)) ?? (source.routes[0] as RouteData);
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
async function switchRoute(scene: Scene3D, s: Settings): Promise<void> {
  const route = scene.source.routes.find((r) => r.id === s.routeId);
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
  await scene.world.preload(new THREE.Vector3(start.x, start.y, start.z));
  // Un rechargement ultérieur garde le bon itinéraire.
  const url = new URL(location.href);
  url.searchParams.set('route', route.id);
  history.replaceState(null, '', url.toString());
}

/** Petit écran d'attente par-dessus le menu (préparation du paysage à la demande). */
function worldOverlay(label: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'world-wait';
  el.innerHTML = `<div class="world-wait-box"><div class="world-wait-bar"><i></i></div><span>${label}</span></div>`;
  // Petit coureur qui pédale au-dessus de la barre.
  el.firstElementChild?.prepend(waitBike());
  document.body.appendChild(el);
  return el;
}

/** Version des médias du menu (vidéos, images) : à augmenter quand on les régénère (cache navigateur). */
const MENU_MEDIA_VERSION = 7;

/** Boucle vidéo de la saison en fond du menu (public/menu/loop-<saison>.webm), sur son image fixe. */
function createMenuVideo(el: HTMLVideoElement | null) {
  let failed = false;
  let useWebm = false;
  let current = '';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Image fixe de la saison, affichée tout de suite sous la vidéo (et seule si la vidéo échoue).
  const still = document.getElementById('menu-still');
  const showStill = (season: Settings['season'] | null) => {
    if (!still) return;
    if (season) still.style.backgroundImage = `url(/menu/still-${season}.jpg?v=${MENU_MEDIA_VERSION})`;
    still.hidden = !season;
  };
  if (el) {
    el.addEventListener('error', () => {
      if (!useWebm && current.includes('.mp4')) {
        // MP4 refusé : on retente en WebM avant d'abandonner (l'image fixe reste en dessous).
        useWebm = true;
        current = current.replace('.mp4', '.webm');
        el.src = current;
        void el.play().catch(() => undefined);
        return;
      }
      failed = true;
      el.hidden = true;
    });
    el.addEventListener('playing', () => el.classList.add('on'));
    document.addEventListener('visibilitychange', () => {
      if (!el.hidden) void (document.hidden ? el.pause() : el.play().catch(() => undefined));
    });
  }
  return {
    /** Affiche la boucle ; false si impossible (fichier absent, mouvement réduit). */
    show(season: Settings['season']): boolean {
      showStill(season);
      if (!el || failed || reduced) return true;
      // H.264 (décodé par toutes les cartes graphiques) sinon VP9 ; repli sur l'autre format en cas d'erreur.
      const ext = useWebm || !el.canPlayType('video/mp4; codecs="avc1.640028"') ? 'webm' : 'mp4';
      const src = `/menu/loop-${season}.${ext}?v=${MENU_MEDIA_VERSION}`;
      if (current !== src) {
        current = src;
        el.classList.remove('on');
        el.src = src;
      }
      el.hidden = false;
      void el.play().catch(() => undefined);
      return true;
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

/** Commandes musique de l'appli compagnon (mêmes effets que B / N au clavier) ; vrai si traitée. */
function companionMusicCommand(c: PhoneCommand): boolean {
  if (c.kind !== 'music') return false;
  const sp = spotify.connected;
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
  music.unlockOnGesture();
  const settings = loadSettings();
  // Premier lancement ou qualité jamais choisie à la main : préréglage selon la carte graphique.
  if (!localStorage.getItem('ar.quality') && !new URLSearchParams(location.search).has('quality')) settings.quality = await detectHardwareQuality();
  setLang(settings.lang);
  // Vélo affiché au garage et sur l'image d'accueil : celui qui est équipé (sauvegardes anciennes).
  settings.look = { ...settings.look, bikeType: bikeSetupFor(loadProgress().equipped).tyre ?? 'road' };
  bootStep(20, 'Chargement du jeu');
  // Avatars Blender (glTF) et voitures : chargés en parallèle, attendus seulement quand la 3D sert.
  const modelsReady = Promise.all([GltfRiderAvatar.load([bikeOfLook(settings.look).family, ...CROWD_FAMILIES]), loadVehicleModels()]);
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
   * Paysage du monde courant (tuiles, végétation, bâtiments), image d'accueil 3D et shaders.
   * Lancé en arrière-plan une fois le menu affiché ; garage, exploration, tutoriel et départ l'attendent.
   */
  let worldReady: Promise<void> | null = null;
  const prepareWorld = (): Promise<void> =>
    (worldReady ??= (async () => {
      await modelsReady;
      if (inMenu) {
        if (scene.world.env.state.season !== settings.season) scene.world.setSeason(settings.season);
        const d = await choosePosterSpot(scene.world, scene.track, settings.season);
        poster.build(settings.look);
        focus.copy(poster.place(d));
        await scene.world.preload(focus);
        poster.frame();
        scene.world.update(1 / 60, focus);
      } else {
        const start = scene.track.positionAt(0, 1.2);
        await scene.world.preload(new THREE.Vector3(start.x, start.y, start.z));
      }
      await scene.engine.renderer.compileAsync(scene.engine.scene, scene.engine.camera).catch(() => undefined);
      if (inMenu && !menuVideo.playing()) renderPoster();
    })());
  /** Attend le paysage avant une action 3D, avec un écran d'attente seulement s'il n'est pas prêt. */
  const withWorld = async (label: string): Promise<void> => {
    let done = false;
    const p = prepareWorld().then(() => (done = true));
    await Promise.race([p, new Promise((r) => setTimeout(r, 60))]);
    if (done) return;
    const overlay = worldOverlay(label);
    await p;
    overlay.remove();
  };
  window.addEventListener('resize', () => inMenu && !exploring && worldReady && !menuVideo.playing() && renderPoster());
  // Fond du menu : boucle vidéo de la saison (aucun calcul 3D pendant ce temps).
  const menuVideo = createMenuVideo(document.getElementById('menu-bg') as HTMLVideoElement | null);
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
  spotify.onPlayState = (playing) => {
    musicCtl.spotifyPlaying = playing;
    music.setDuck(playing ? 0 : musicCtl.base);
  };
  // Suivi Spotify : la musique du jeu se tait quand Spotify joue ; titre annoncé au changement.
  setInterval(async () => {
    if (!spotify.connected || document.hidden) return music.setDuck(musicCtl.base);
    const np = await spotify.nowPlaying();
    musicCtl.spotifyPlaying = !!np?.isPlaying;
    music.setDuck(np?.isPlaying ? 0 : musicCtl.base);
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
        url.searchParams.set('route', s.routeId);
        url.searchParams.delete('quality');
        url.searchParams.set('autostart', '1');
        location.href = url.toString();
        return;
      }
      // Changement d'itinéraire : monde reconstruit sur place (sans attendre l'ancien), la musique continue.
      if (s.routeId !== scene.route.id) {
        menu.hide();
        leaveMenu(s);
        const overlay = worldOverlay(getLang() === 'fr' ? 'Chargement de l’itinéraire…' : 'Loading route…');
        void modelsReady
          .then(() => switchRoute(scene, s))
          .then(() => scene.engine.renderer.compileAsync(scene.engine.scene, scene.engine.camera).catch(() => undefined))
          .then(() => {
            overlay.remove();
            return startRide(scene, s, s.guest ? new GuestInputSource(s.massKg) : devices.source(), extras);
          });
        return;
      }
      void withWorld(getLang() === 'fr' ? 'Préparation de la sortie…' : 'Preparing the ride…').then(() => {
        leaveMenu(s);
        menu.hide();
        return startRide(scene, s, s.guest ? new GuestInputSource(s.massKg) : devices.source(), extras);
      });
    },
  });
  menu.worldId = scene.source.id;
  menu.openWorld = !!scene.source.open;
  menu.planner.setOpen(scene.source.open ?? null);
  // Changement de monde sans recharger la page : données du nouveau monde, paysage refait en arrière-plan.
  menu.onWorld = (id) => {
    settings.world = id;
    settings.routeId = '';
    saveSettings(settings);
    void (async () => {
      const source = await loadWorldSource(id);
      if (settings.mode === 'open' && !source.open) settings.mode = 'free';
      const pending = worldReady;
      worldReady = null;
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
      menu.planner.setOpen(source.open ?? null);
      menu.setWorld(source.routes, source.id, !!source.open);
      void prepareWorld();
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
    if (!worldReady) return;
    poster.build(s.look);
    poster.setPlayerLook(s.look, menu.bareHeadPreview);
    poster.place(poster.d);
    renderPoster();
  };
  // Éditeur de visage : le coureur du garage suit les curseurs sans reconstruire la scène.
  menu.onLookLive = (look, bareHead) => {
    if (!inMenu) return;
    poster.setPlayerLook(look, bareHead);
    renderPoster();
  };
  // Onglets : photo du groupe, ou aperçu du coureur dans le garage (vues et rotation).
  // Garage : aperçu d'un équipement (même verrouillé) sur le coureur, puis retour à la tenue équipée.
  menu.onPreviewLook = (look) => {
    if (!inMenu || !worldReady) return;
    poster.build(look ?? settings.look);
    poster.place(poster.d);
    renderPoster();
  };
  menu.onAtelier = (st) => {
    if (!inMenu || exploring) return;
    if (st) menuVideo.stop();
    void modelsReady.then(() => atelier.set(st));
  };
  if (import.meta.env.DEV) (window as unknown as { __arAtelier: unknown }).__arAtelier = atelier;
  menu.onScene = (view, yaw) => {
    if (!inMenu || exploring) return;
    atelier.set(null);
    // Accueil : la vidéo de la saison ; garage : vraie 3D (attend le paysage si besoin).
    if (view === 'poster' && menuVideo.show(settings.season)) return;
    menuVideo.stop();
    poster.setView(view, yaw);
    if (worldReady) return renderPoster();
    void withWorld(getLang() === 'fr' ? 'Chargement du garage…' : 'Loading the garage…').then(() => {
      if (!inMenu || exploring) return;
      poster.setView(view, yaw);
      renderPoster();
    });
  };
  menu.onTutorial = () => {
    // Tutoriel terminé ou passé : retour à l'accueil, sans lancer de sortie.
    new Onboarding(ui, settings, devices.panel, () => menu.show('home')).start();
  };
  bootDone();
  if (autostart) {
    await withWorld(getLang() === 'fr' ? 'Préparation de la sortie…' : 'Preparing the ride…');
    void startRide(scene, settings, devices.source(), {});
  } else {
    // Le paysage se prépare pendant que le coureur choisit (sans bloquer le menu).
    setTimeout(() => void prepareWorld(), 400);
    // Compte : session existante, sinon écran de connexion (sauf choix « sans compte »).
    let me: Me | null = await fetchMe();
    if (me) applyProfile(me, settings);
    const afterLogin = () => {
      menu.account = me ? { name: me.profile.displayName, level: me.progression.level, ...(me.atelier ? { credits: me.atelier.credits } : {}) } : null;
      if (Onboarding.needed()) menu.onTutorial?.();
      else menu.show();
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

async function startRide(scene: Scene3D, s: Settings, input: InputSource, extras: { workoutFile?: { name: string; content: string }; inviteCode?: string; inviteFriends?: string[]; tutorial?: boolean; openStart?: { x: number; z: number } }): Promise<void> {
  const { engine, world, source } = scene;
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
  // Défi KOM : départ lancé avant le pied de la montée choisie, fantôme du record.
  const komSeg = s.mode === 'challenge' && !nav ? (track.route.segments.find((g) => g.kind === 'kom' && g.id === s.challengeSeg) ?? track.route.segments.find((g) => g.kind === 'kom')) : undefined;
  const challenge = komSeg ? new KomChallenge(engine.scene, track, komSeg) : null;
  let challengeResult: ChallengeResult | null = null;
  if (nav || challenge) {
    const p0 = track.positionAt(challenge?.startD ?? 0, 1.2);
    await world.preload(new THREE.Vector3(p0.x, p0.y, p0.z));
  }
  ui.innerHTML = '';
  // Le vélo roulé dépend de l'équipement porté au garage et des pièces de l'atelier (masse, traînée, pneus, roues).
  const profile: RiderProfile = { id: 'local', displayName: s.name, massKg: s.massKg, heightCm: s.heightCm, ftpWatts: s.ftpWatts, bike: tunedBike() };
  const params = new URLSearchParams(location.search);
  const startD = nav ? 0 : challenge ? challenge.startD : Number(params.get('d') ?? 0);
  const ride = new RideSession({
    profile,
    track,
    trainerDifficulty: s.trainerDifficulty,
    drivetrain: s.drivetrain,
    startDistM: startD,
    wind: { ms: s.windMs, from: 4.4 },
    inertiaFactor: s.inertia,
  });
  // Modèle du vélo (route, gravel, VTT) : celui du vélo équipé.
  const avatar = createAvatar({ ...s.look, bikeType: profile.bike.tyre ?? 'road' });
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
  let rideWeather = myWeather;
  let mp: Multiplayer | null = null;
  let voice: VoiceChat | null = null;
  if (s.mode === 'group' || s.mode === 'race') {
    mp = new Multiplayer(engine.scene, track, s.name);
    try {
      const code = await mp.connect({ ...(extras.inviteCode ? { inviteCode: extras.inviteCode } : {}), mode: s.mode, guest: s.guest, aiRiders: s.aiRiders, aiLevel: s.aiLevel, laps: s.raceLaps, trainerDifficulty: s.trainerDifficulty, name: s.name, weather: myWeather, ...(s.equalEquipment !== undefined ? { equalEquipment: s.equalEquipment } : {}) });
      // Équipement égalisé : la prédiction locale roule le même vélo que le serveur.
      if (mp.equalized) Object.assign(ride.params, { ...paramsFromBike(s.massKg, EQUALIZED_BIKE), inertiaFactor: ride.params.inertiaFactor });
      setTimeout(() => hud.toast(`${getLang() === 'fr' ? 'Code d’invitation' : 'Invite code'} : ${code}`), 500);
      if (mp.weather) rideWeather = mp.weather;
      // « Partir et inviter » depuis l'onglet Amis : invitations envoyées une fois la salle créée.
      if (extras.inviteFriends?.length) {
        void sendRideInvites(mp.net.roomId, extras.inviteFriends).then((n) => n && setTimeout(() => hud.toast(getLang() === 'fr' ? `Invitation envoyée à ${n} ami${n > 1 ? 's' : ''}` : `Invite sent to ${n} friend${n > 1 ? 's' : ''}`), 2500));
      }
    } catch (e) {
      console.warn('Serveur injoignable, sortie solo', e);
      setTimeout(() => hud.toast(getLang() === 'fr' ? 'Serveur injoignable : sortie solo' : 'Server unreachable: solo ride'), 500);
      mp = null;
    }
  }
  const aiCount = workout || mp || challenge ? 0 : Math.min(Math.max(s.aiRiders, 0), engine.quality.aiRidersMax);
  const peloton = new Peloton(engine.scene, track, aiCount, startD, s.ftpWatts * (s.aiLevel ?? 1));
  const ghost = new Ghost(engine.scene, track, track.route.id, startD);
  peloton.onWait = (name) => name && hud.toast(getLang() === 'fr' ? `On attend ${name}` : `Waiting for ${name}`);
  peloton.onUTurn = (name) => hud.toast(getLang() === 'fr' ? `${name} fait demi-tour pour revenir au groupe` : `${name} turns back to rejoin the group`);
  const rig = new CameraRig(engine.camera, track, (x, z) => world.terrain.heightAt(x, z), engine.renderer.domElement);
  rig.occluders = [world.buildings.group];
  // Public sur les côtes (une fois le terrain chargé autour du départ).
  const crowd = new Crowd(track, (x, z) => world.terrain.heightAt(x, z), { riderName: s.name });
  engine.scene.add(crowd.group);
  engine.scene.add(new TownSigns(track, (x, z) => world.terrain.heightAt(x, z)).group);
  // Monde vivant : circulation et piétons (désactivable par ?traffic=0).
  const traffic = params.get('traffic') === '0' || engine.quality.trafficDensity <= 0 ? null : new Traffic(track, engine.quality.trafficDensity);
  if (traffic) engine.scene.add(traffic.group);
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
  // Cyclistes croisés dans les deux sens (désactivables avec le trafic ou par ?cyclists=0).
  const cyclists = traffic && params.get('cyclists') !== '0' ? new AmbientCyclists(engine.scene, track, startD) : null;
  const hud = new Hud(hudRoot, track, source.attribution);
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
    if (sequences.enabled) sequences.segment(r, s.name, track.route.id, 1, 1);
    else hud.toast(`${t('segmentDone')} · ${r.seg.name} · ${Math.floor(r.timeS / 60)}:${String(Math.round(r.timeS % 60)).padStart(2, '0')}`);
  };
  // Sortie à plusieurs : salle d'attente et compte à rebours (course), panneau en direct, résultats, allure du groupe.
  let room: RideRoomUi | null = null;
  if (mp) {
    const net = mp.net;
    const voiceCfg = fetchVoiceConfig();
    room = new RideRoomUi({ hudRoot, net, track, mode: s.mode === 'race' ? 'race' : 'group', lang: getLang(), toast: (m) => hud.toast(m), voice: voiceCfg });
    // Course pas lancée : le coureur reste sur la grille (le serveur le tient immobile).
    room.onHoldChange = (hold) => (ride.paused = hold);
    room.onLeave = () => finish();
    // Télémétrie à 10 Hz : puissance mesurée (ou virtuelle pour un invité), rapport, direction.
    net.startTelemetry(() => ({ watts: ride.inputs.watts, cadence: ride.inputs.cadence, ...(ride.inputs.hr !== undefined ? { hr: ride.inputs.hr } : {}), gear: ride.gearIndex, steer: ride.lateral }));
    net.on('event', (ev) => {
      if (ev.kind === 'segmentEnd' && ev.riderId === net.selfId && !s.guest) {
        const seg = track.route.segments.find((x) => x.id === ev.segmentId);
        if (seg) sequences.segment({ seg, timeS: ev.timeMs / 1000, avgWatts: ride.avgWatts() }, s.name, track.route.id, ev.rank, net.roster.size);
      } else if (ev.kind === 'chat') hud.addChat(net.roster.get(ev.riderId)?.name ?? '?', ev.text);
      else if (ev.kind === 'rideOn' && ev.to === net.selfId) hud.toast(`👍 Ride On — ${net.roster.get(ev.from)?.name ?? ''}`);
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
  if (!params.has('nointro') && !(mp && s.mode === 'race')) {
    ride.paused = true;
    void sequences
      .intro({ season: s.season, riders: peloton.riders.length + 1, rideType: s.mode })
      .finally(() => (ride.paused = false));
  }
  // Montée : annonce de chaque lacet numéroté ; arrivée au sommet d'un itinéraire aller simple.
  const hairpins = new HairpinWatcher(nav ? undefined : track.route.hairpins);
  let summitShown = false;
  const reachSummit = () => {
    summitShown = true;
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
      ...(kom ? { kom: { name: kom.seg.name, timeS: kom.timeS, avgWatts: kom.avgWatts, climbM: track.sample(kom.seg.endM).y - track.sample(kom.seg.startM).y, recordS: readKomRecord(track.route.id, kom.seg.id)?.timeS ?? null } } : {}),
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
  ride.onLap = (lap) => {
    hud.toast(`${t('lap')} ${lap}`);
    ghost.lap(ride.elapsedS, ride.state.distM);
  };

  // Fin de sortie : écran de stats par-dessus la scène figée. « Reprendre » relance la sortie (solo) ;
  // « Nouvelle sortie » et « Quitter » rendent la main au menu. XP, historique et records sont
  // enregistrés à chaque fin (sans double compte si la sortie a été reprise).
  const recordsBefore = readPowerRecords();
  let credited: { distanceM: number; elevationM: number; movingS: number } | undefined;
  const fileStem = () => `allez-robert-${new Date(ride.startT).toISOString().slice(0, 16).replace(/[:T]/g, '-')}`;
  const fitBytes = () => rideToFit(ride, { name: `Allez Robert ! — ${track.route.name}`, massKg: s.massKg, ftp: s.ftpWatts, ...(source.originL93 ? { originL93: source.originL93 } : {}), skipStrava: s.skipStrava });
  const teardown = (autostart: boolean) => {
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
  /** Photo : rendu immédiat puis lecture du canvas (sans l'interface). */
  const photo = () => {
    engine.renderManual();
    const a = document.createElement('a');
    a.href = engine.renderer.domElement.toDataURL('image/png');
    a.download = `allez-robert-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    a.click();
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
      if (spotify.connected) void spotify.toggleSmart().then((on) => hud.toast(on ? '♪ Spotify ▶' : '♪ Spotify ⏸'));
      else hud.toast(music.toggle() ? (getLang() === 'fr' ? '♪ Musique activée' : '♪ Music on') : getLang() === 'fr' ? '♪ Musique coupée' : '♪ Music off');
    }
    if (e.key === 'n' || e.key === 'N') {
      if (spotify.connected) void spotify.next();
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
  let prevHeading = Number.NaN;
  let bank = 0;
  let condAcc = Infinity;
  // Pour les trophées : pluie et nuit rencontrées pendant la sortie.
  let rainSeen = false;
  let nightSeen = false;
  const frame = (dt: number, render: boolean, manual = false) => {
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
      const wNow = weatherAt(rideWeather, ride.elapsedS);
      const envState = world.env.state;
      envState.hour = wNow.hour;
      envState.weather.clouds = wNow.clouds;
      envState.weather.rain = wNow.rain;
      envState.weather.fog = wNow.fog;
      envState.weather.windMs = wNow.windMs;
      ride.setWind(wNow.windMs);
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
    const prevD = ride.state.distM;
    ride.update(dt, input, steer);
    if (!ride.paused && ride.dir > 0) {
      const hp = hairpins.update(prevD, ride.state.distM);
      if (hp) hud.toast(hairpinToast(hp, getLang() === 'fr'), true);
      if (!summitShown && !nav && !mp && reachedFinish(track.route.loop, ride.dir, ride.state.distM, track.length)) reachSummit();
    }
    if (!ride.paused) {
      ghost.update(dt, ride.elapsedS, ride.state.distM);
      challenge?.update(dt, ride.state.distM - startD, ride.elapsedS);
      tutorial?.update({ shifted, gradePercent: ride.gradePercent, inSegment: !!ride.segment, draft: ride.draft, distM: ride.state.distM - startD });
      if (mp) {
        // Prédiction locale + correction douce vers la position autoritaire du serveur.
        ride.draft = mp.selfDraft();
        ride.state.distM += mp.reconcile(ride.state.distM, dt);
      } else ride.draft = peloton.update(dt, { distM: ride.state.distM, lateral: ride.lateral, speedMs: ride.state.speedMs, watts: ride.inputs.watts, massKg: s.massKg, ftpWatts: s.ftpWatts, reversed: ride.dir < 0 });
      // Relais : quelqu'un roule dans ma roue (0,5 à 4 m derrière, à moins d'un mètre de côté).
      const onWheel = (d: number, lat: number) => {
        const gap = ride.state.distM - d;
        return gap > 0.5 && gap < 4 && Math.abs(lat - ride.lateral) < 1;
      };
      ride.wheelFollowed = peloton.riders.some((r) => onWheel(r.state.distM, r.lateral)) || remoteRiders.some((r) => onWheel(r.unwrappedM, r.lateralM));
      // Abri derrière un tracteur ou une camionnette qui roule dans le même sens.
      if (traffic && ride.dir > 0) ride.draft = Math.max(ride.draft, traffic.draftFor(ride.state.distM, ride.lateral));
      if (cyclists) {
        const d = cyclists.update(dt, { distM: ride.state.distM, lateral: ride.lateral, speedMs: ride.state.speedMs }, engine.camera);
        if (ride.dir > 0) ride.draft = Math.max(ride.draft, d);
      }
    }
    remoteRiders = mp ? mp.render(dt, engine.camera) : [];
    if (!ride.paused) trains.update(dt, ride.state.distM, ride.dir, ride.state.speedMs);
    traffic?.update(dt, ride.state, [
      { distM: ride.state.distM, lateral: ride.lateral, speedMs: ride.state.speedMs },
      ...peloton.riders.map((r) => ({ distM: r.state.distM, lateral: r.lateral, speedMs: r.state.speedMs })),
      ...remoteRiders.map((r) => ({ distM: r.unwrappedM, lateral: r.lateralM, speedMs: r.speedMs })),
    ]);
    track.positionAt(ride.state.distM, ride.lateral, sample);
    pos.set(sample.x, sample.y + 0.06, sample.z);
    // Sens de marche : après un demi-tour, on remonte l'itinéraire.
    dir.set(sample.dirX * ride.dir, 0, sample.dirZ * ride.dir);
    avatar.root.position.copy(pos);
    const heading = Math.atan2(sample.dirX, sample.dirZ) + (ride.dir < 0 ? Math.PI : 0);
    if (Number.isNaN(prevHeading)) prevHeading = heading;
    // Inclinaison en virage : ∝ v·(dψ/dt), bornée.
    let dh = heading - prevHeading;
    if (dh > Math.PI) dh -= Math.PI * 2;
    if (dh < -Math.PI) dh += Math.PI * 2;
    prevHeading = heading;
    const yawRate = dt > 0 ? dh / dt : 0;
    bank += (THREE.MathUtils.clamp(-yawRate * ride.state.speedMs * 0.08, -0.35, 0.35) - bank) * Math.min(1, dt * 3);
    avatar.root.rotation.set(0, 0, 0);
    avatar.root.rotateY(heading);
    avatar.root.rotateX(-Math.atan((sample.grade * ride.dir) / 100));
    avatar.setEffort?.(ride.inputs.watts / Math.max(50, s.ftpWatts), ride.inputs.hr !== undefined ? ride.inputs.hr / 190 : undefined);
    avatar.update(dt, ride.inputs.cadence, ride.state.speedMs, ride.pose, bank);
    // Vue subjective et caméra embarquée : on garde le vélo, les bras et les mains, mais pas la tête.
    const onboard = (rig.mode === 'cockpit' || rig.mode === 'gopro') && !rig.lookBack;
    avatar.setHeadVisible(!onboard);
    peloton.render(dt, engine.camera);
    // Poussière des roues sur les chemins non revêtus (coureur et coureurs IA), voir world/dust.ts.
    if (!ride.paused) {
      world.kickDust('me', pos.x, pos.y, pos.z, sample.dirX, sample.dirZ, ride.state.speedMs, dt);
      for (const r of peloton.riders) {
        const p = track.positionAt(r.state.distM, r.lateral, dustSample);
        world.kickDust(r.id, p.x, p.y, p.z, p.dirX, p.dirZ, r.state.speedMs, dt);
      }
    }

    const eyeOk = rig.mode === 'cockpit' && !!avatar.eyeWorld;
    if (eyeOk) avatar.eyeWorld?.(eye, hands);
    rig.update(dt, { position: pos, dir, distM: ride.state.distM, speedMs: ride.state.speedMs, sign: ride.dir, ...(eyeOk ? { eye, hands } : {}) });
    // Les tuiles se chargent autour de la caméra libre, où qu'elle aille ; sinon autour du coureur.
    world.update(dt, rig.mode === 'free' ? engine.camera.position : pos);
    headlight.intensity = world.nightFactor() * 120;
    if (!render) return;
    engine.exposure.value = world.env.exposure();
    world.env.grade(engine.grade);
    if (manual) engine.renderManual();
    else engine.render();

    audio.update(dt, pos, heading);

    hudAcc += dt;
    if (hudAcc > 0.1) {
      hudAcc = 0;
      // Habillage TV synchronisé avec la caméra « réalisation TV ».
      const rank = 1 + peloton.riders.filter((r) => r.state.distM > ride.state.distM).length;
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
          lap: ride.lap,
          riders: [
            { id: 'me', name: s.name, distM: ride.state.distM, x: pos.x, z: pos.z, me: true, isAI: false, isGuest: false, color: '#ffd23f', wkg: ride.watts3s() / s.massKg },
            ...remoteRiders.map((r) => {
              const p = track.sample(r.unwrappedM);
              const mass = mp?.net.roster.get(r.id)?.massKg ?? 75;
              return { id: r.id, name: r.name, distM: r.unwrappedM, x: p.x, z: p.z, me: false, isAI: r.isAI, isGuest: r.isGuest, color: r.avatar.jersey, online: !r.isAI, speaking: voice?.speaking.has(r.name) ?? false, wkg: r.watts / mass };
            }),
            ...peloton.riders.map((r) => {
              const p = track.sample(r.state.distM);
              return { id: r.id, name: r.name, distM: r.state.distM, x: p.x, z: p.z, me: false, isAI: true, isGuest: false, color: r.color, wkg: r.watts / r.massKg };
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
    }
  };
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
  (window as unknown as { __ar: unknown }).__ar = { engine, world, ride, rig, track, peloton, input, finish, advance, hud, shot, avatar, audio, room };
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
