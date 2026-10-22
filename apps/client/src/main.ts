import './hud/hud.css';
import * as THREE from 'three/webgpu';
import { RouteTrack, bikeSetupFor, type RiderProfile, type RouteData } from '@allezrobert/shared';
import { surfaceRoughness } from '@allezrobert/physics';
import { createEngine, type Engine } from './engine/renderer.ts';
import { QUALITY_PRESETS, withUrlOverrides, type QualitySettings } from './engine/quality.ts';
import { World } from './world/world.ts';
import { loadWorldSource } from './world/loader.ts';
import type { WorldSource } from './world/types.ts';
import { GltfRiderAvatar, createAvatar } from './rider/gltfAvatar.ts';
import { CameraRig } from './game/cameras.ts';
import { FreeFlyCamera } from './game/freecam.ts';
import { RideSession } from './game/ride.ts';
import { KeyboardControls, type InputSource } from './game/inputs.ts';
import { Peloton } from './game/peloton.ts';
import { WorkoutController } from './game/workout.ts';
import { Ghost } from './game/ghost.ts';
import { createDeviceLayer } from './game/devices.ts';
import { Hud } from './hud/hud.ts';
import { GameAudio } from './audio/audio.ts';
import { music } from './audio/music.ts';
import { spotify } from './audio/spotify.ts';
import { t, setLang, getLang } from './i18n/index.ts';
import { loadSettings, saveSettings, type Settings } from './ui/settings.ts';
import { MainMenu } from './ui/menu.ts';
import { bootStep, bootDone, bootError } from './ui/splash.ts';
import { PosterScene, choosePosterSpot, POSTER_HOUR } from './ui/poster.ts';
import { showPause, showSummary, rideToFit } from './ui/ridepanels.ts';
import { splatAt } from './world/splat.ts';
import { Onboarding, RideTutorial } from './onboarding/onboarding.ts';
import { awardRide, loadProgress } from './ui/garage.ts';
import { roadSurfaceAt, windShelterAt } from './world/conditions.ts';
import { fetchMe, showLogin, applyProfile, logout, pushProfile, type Me } from './ui/account.ts';
import { RideSequences } from './game/sequences.ts';
import { GuestInputSource } from './game/guest.ts';
import { Crowd } from './world/crowd.ts';
import { TownSigns } from './world/signs.ts';
import { Traffic, loadVehicleModels } from './world/traffic.ts';
import { Multiplayer } from './game/multiplayer.ts';
import { VoiceChat } from './game/voice.ts';
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
  bootStep(35, 'Monde et itinéraires');
  const source = await loadWorldSource(params.get('world') ?? 'chevreuse');
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

/** Musique : volume de base (plus bas en sortie) et annonce des titres Spotify pendant la sortie. */
const musicCtl = { base: 1, lastTitle: '', onTrack: null as ((label: string) => void) | null };

async function boot(): Promise<void> {
  // Retour de l'autorisation Spotify (?code&state), avant tout le reste.
  await spotify.handleRedirect();
  music.unlockOnGesture();
  const settings = loadSettings();
  setLang(settings.lang);
  bootStep(12, 'Chargement des coureurs, des vélos et des voitures');
  // Avatars Blender (glTF) chargés une fois ; repli procédural automatique en cas d'échec.
  const [scene] = await Promise.all([loadScene(settings), GltfRiderAvatar.load(), loadVehicleModels()]);
  // Film d'accueil (développement) : rendu image par image, sans menu (voir tools/menu-loop).
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('cinematic')) {
    const { runCinematic } = await import('./ui/cinematic.ts');
    bootDone();
    return runCinematic(scene.engine, scene.world, scene.track);
  }
  bootStep(50, 'Choix du lieu de la photo d’accueil');
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
  const poster = new PosterScene(scene.engine, scene.world, scene.track);
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
  if (inMenu) {
    if (scene.world.env.state.season !== settings.season) scene.world.setSeason(settings.season);
    const d = await choosePosterSpot(scene.world, scene.track, settings.season);
    poster.build(settings.look);
    focus.copy(poster.place(d));
    bootStep(60, 'Paysage : relief, routes, bâtiments, arbres');
    await scene.world.preload(focus);
    renderPoster();
    window.addEventListener('resize', () => inMenu && !exploring && renderPoster());
  } else {
    bootStep(60, 'Paysage : relief, routes, bâtiments, arbres');
    const start = scene.track.positionAt(0, 1.2);
    await scene.world.preload(new THREE.Vector3(start.x, start.y, start.z));
  }
  // Shaders compilés derrière l'écran de chargement : le premier affichage ne saccade pas.
  bootStep(85, 'Préparation des matériaux (shaders)');
  if (inMenu) {
    poster.frame();
    scene.world.update(1 / 60, focus);
  }
  await scene.engine.renderer.compileAsync(scene.engine.scene, scene.engine.camera).catch(() => undefined);
  // Explorer la carte : caméra libre au-dessus du monde chargé ; les tuiles suivent la caméra.
  const explorer = new FreeFlyCamera(scene.engine.camera, scene.engine.renderer.domElement, (x, z) => scene.world.terrain.heightAt(x, z));
  let exploreT = 0;
  scene.engine.renderer.setAnimationLoop(() => {
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
    poster.dispose();
    applyEnv(s);
  };

  // Spotify lancé ou mis en pause depuis le jeu : la musique du jeu suit aussitôt.
  spotify.onPlayState = (playing) => music.setDuck(playing ? 0 : musicCtl.base);
  // Suivi Spotify : la musique du jeu se tait quand Spotify joue ; titre annoncé au changement.
  setInterval(async () => {
    if (!spotify.connected || document.hidden) return music.setDuck(musicCtl.base);
    const np = await spotify.nowPlaying();
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
      // Changement de qualité graphique : rechargement propre de la page.
      if (s.quality !== scene.quality) {
        const url = new URL(location.href);
        url.searchParams.set('route', s.routeId);
        url.searchParams.delete('quality');
        url.searchParams.set('autostart', '1');
        location.href = url.toString();
        return;
      }
      // Changement d'itinéraire : monde reconstruit sur place, la musique continue.
      if (s.routeId !== scene.route.id) {
        menu.hide();
        leaveMenu(s);
        ui.innerHTML = `<div class="loading">${getLang() === 'fr' ? 'Chargement de l’itinéraire…' : 'Loading route…'}</div>`;
        void switchRoute(scene, s).then(() => startRide(scene, s, s.guest ? new GuestInputSource(s.massKg) : devices.source(), extras));
        return;
      }
      leaveMenu(s);
      menu.hide();
      void startRide(scene, s, s.guest ? new GuestInputSource(s.massKg) : devices.source(), extras);
    },
  });
  const onExploreKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    stopExplore();
  };
  const startExplore = () => {
    if (exploring || !inMenu) return;
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
    menu.show(); // → onScene('poster') → renderPoster()
    void scene.world.preload(focus).then(() => inMenu && !exploring && renderPoster());
  };
  menu.onExplore = startExplore;
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
    poster.build(s.look);
    poster.place(poster.d);
    renderPoster();
  };
  // Onglets : photo du groupe, ou aperçu du coureur dans le garage (vues et rotation).
  // Garage : aperçu d'un équipement (même verrouillé) sur le coureur, puis retour à la tenue équipée.
  menu.onPreviewLook = (look) => {
    if (!inMenu) return;
    poster.build(look ?? settings.look);
    poster.place(poster.d);
    renderPoster();
  };
  menu.onScene = (view, yaw) => {
    if (!inMenu) return;
    poster.setView(view, yaw);
    renderPoster();
  };
  menu.onTutorial = () => {
    new Onboarding(ui, settings, devices.panel, (s, skipped) => {
      // Tutoriel passé : retour au menu ; terminé : première sortie commentée.
      if (skipped) {
        menu.show();
        return;
      }
      leaveMenu(s);
      ui.innerHTML = '';
      void startRide(scene, s, devices.source(), { tutorial: true });
    }).start();
  };
  bootStep(95, 'Première image');
  // Deux images rendues, sans bloquer si l'onglet est en arrière-plan (pas de requestAnimationFrame).
  await Promise.race([new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))), new Promise((r) => setTimeout(r, 400))]);
  bootDone();
  if (autostart) {
    void startRide(scene, settings, devices.source(), {});
  } else {
    // Compte : session existante, sinon écran de connexion (sauf choix « sans compte »).
    let me: Me | null = await fetchMe();
    if (me) applyProfile(me, settings);
    const afterLogin = () => {
      menu.account = me ? { name: me.profile.displayName, level: me.progression.level } : null;
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
      pushTimer = setTimeout(() => void pushProfile(st), 1500);
    };
    if (!me && !localStorage.getItem('ar.skipLogin')) menu.onLogin();
    else afterLogin();
  }
}

async function startRide(scene: Scene3D, s: Settings, input: InputSource, extras: { workoutFile?: { name: string; content: string }; inviteCode?: string; tutorial?: boolean }): Promise<void> {
  const { engine, world, track, source } = scene;
  ui.innerHTML = '';
  // Le vélo roulé dépend de l'équipement porté au garage (masse, traînée, pneus, roues).
  const profile: RiderProfile = { id: 'local', displayName: s.name, massKg: s.massKg, heightCm: s.heightCm, ftpWatts: s.ftpWatts, bike: bikeSetupFor(loadProgress().equipped) };
  const params = new URLSearchParams(location.search);
  const startD = Number(params.get('d') ?? 0);
  const ride = new RideSession({
    profile,
    track,
    trainerDifficulty: s.trainerDifficulty,
    startDistM: startD,
    wind: { ms: s.windMs, from: 4.4 },
    inertiaFactor: s.inertia,
  });
  const avatar = createAvatar(s.look);
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
    else if (s.mode === 'ftpTest') workout = new WorkoutController(params.get('ftptest') === '20' ? 'ftp20' : 'ramp', s.ftpWatts);
  } catch (e) {
    console.warn('Séance illisible', e);
  }
  // Sortie de groupe / course : le serveur fait rouler tout le monde (IA comprises).
  let mp: Multiplayer | null = null;
  let voice: VoiceChat | null = null;
  if (s.mode === 'group' || s.mode === 'race') {
    mp = new Multiplayer(engine.scene, track, s.name);
    try {
      const code = await mp.connect({ ...(extras.inviteCode ? { inviteCode: extras.inviteCode } : {}), mode: s.mode, guest: s.guest, aiRiders: s.aiRiders, trainerDifficulty: s.trainerDifficulty, name: s.name });
      setTimeout(() => hud.toast(`${getLang() === 'fr' ? 'Code d’invitation' : 'Invite code'} : ${code}`), 500);
    } catch (e) {
      console.warn('Serveur injoignable, sortie solo', e);
      setTimeout(() => hud.toast(getLang() === 'fr' ? 'Serveur injoignable : sortie solo' : 'Server unreachable: solo ride'), 500);
      mp = null;
    }
  }
  const aiCount = workout || mp ? 0 : Math.min(Math.max(s.aiRiders, 0), 19);
  const peloton = new Peloton(engine.scene, track, aiCount, startD, s.ftpWatts * (s.aiLevel ?? 1));
  const ghost = new Ghost(engine.scene, track, track.route.id, startD);
  peloton.onWait = (name) => name && hud.toast(getLang() === 'fr' ? `On attend ${name}` : `Waiting for ${name}`);
  const rig = new CameraRig(engine.camera, track, (x, z) => world.terrain.heightAt(x, z), engine.renderer.domElement);
  rig.occluders = [world.buildings.group];
  // Public sur les côtes (une fois le terrain chargé autour du départ).
  const crowd = new Crowd(track, (x, z) => world.terrain.heightAt(x, z));
  engine.scene.add(crowd.mesh);
  engine.scene.add(new TownSigns(track, (x, z) => world.terrain.heightAt(x, z)).group);
  // Monde vivant : circulation et piétons (désactivable par ?traffic=0).
  const traffic = params.get('traffic') === '0' ? null : new Traffic(track);
  if (traffic) engine.scene.add(traffic.group);
  const hud = new Hud(hudRoot, track, source.attribution);
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
  const audio = new GameAudio();
  audio.start();
  audio.setVolume(s.volume);
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
  if (mp) {
    const net = mp.net;
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
      } else if (ev.kind === 'phase' && ev.phase === 'countdown' && ev.startsAt) {
        // Départ groupé : tout le monde attend le signal du serveur.
        ride.paused = true;
        setTimeout(() => (ride.paused = false), Math.max(0, ev.startsAt - net.serverNow()));
      }
    });
    // Chat vocal LiveKit (micro coupé à l'arrivée, V pour parler) et Ride On depuis la liste.
    voice = new VoiceChat();
    voice.onState = (st, detail) => hud.setVoice({ connected: st === 'connected', micOn: voice?.micOn ?? false, ...(detail ? { detail } : {}) });
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
  if (!params.has('nointro')) {
    ride.paused = true;
    void sequences
      .intro({ season: s.season, riders: peloton.riders.length + 1, rideType: s.mode })
      .finally(() => (ride.paused = false));
  }
  ride.onLap = (lap) => {
    hud.toast(`${t('lap')} ${lap}`);
    ghost.lap(ride.elapsedS, ride.state.distM);
  };

  const finish = () => {
    engine.renderer.setAnimationLoop(null);
    clearInterval(sourcesTimer);
    void mp?.dispose();
    void voice?.disconnect();
    tutorial?.stop();
    // Invité : ni XP compétitive, ni segments, ni FIT.
    const xp = s.guest ? undefined : awardRide({ distanceM: ride.state.distM - startD, elevationM: ride.elevationGainM, movingS: ride.elapsedS });
    audio.dispose();
    hud.setVisible(false);
    input.sendTrainer({ kind: 'simulation', gradePercent: 0 });
    showSummary(
      ui,
      ride,
      () => rideToFit(ride, { name: `Allez Robert ! — ${track.route.name}`, massKg: s.massKg, ftp: s.ftpWatts, ...(source.originL93 ? { originL93: source.originL93 } : {}), skipStrava: s.skipStrava }),
      () => {
        const url = new URL(location.href);
        url.searchParams.delete('autostart');
        location.href = url.toString();
      },
      xp,
    );
  };
  const togglePause = () => {
    ride.paused = !ride.paused;
    if (ride.paused) showPause(ui, { onResume: togglePause, onFinish: finish });
    else ui.innerHTML = '';
  };
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
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
    if ((e.key === '[' || e.key === ']') && peloton.riders.length) {
      peloton.paceFtpPct = Math.min(1.2, Math.max(0.5, (peloton.paceFtpPct ?? 0.75) + (e.key === ']' ? 0.05 : -0.05)));
      hud.toast(`${getLang() === 'fr' ? 'Allure du groupe' : 'Group pace'} : ${Math.round(peloton.paceFtpPct * 100)} % FTP`);
    }
    if ((e.key === 'r' || e.key === 'R') && peloton.riders.length) {
      peloton.slowDown();
      hud.toast(getLang() === 'fr' ? '« Ralentissez ! »' : '“Ease up!”');
    }
    if (e.key === 'p' || e.key === 'P') {
      // Photo : rendu immédiat puis lecture du canvas (sans l'interface).
      engine.renderManual();
      const a = document.createElement('a');
      a.href = engine.renderer.domElement.toDataURL('image/png');
      a.download = `allez-robert-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
      a.click();
      hud.toast('📷');
    }
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
  const eye = new THREE.Vector3();
  const hands = new THREE.Vector3();
  let hudAcc = 0;
  let remoteRiders: InterpolatedRider[] = [];
  let prevHeading = Number.NaN;
  let bank = 0;
  let condAcc = Infinity;
  const frame = (dt: number, render: boolean, manual = false) => {
    const steer = keyboard.update(dt);
    // Conditions sous les roues, 4 fois par seconde : revêtement, abri du vent, pluie.
    condAcc += dt;
    if (condAcc > 0.25) {
      condAcc = 0;
      const here = track.positionAt(ride.state.distM, ride.lateral, sample);
      const t = world.terrain.getTile(...world.terrain.tileCoord(here.x, here.z));
      ride.surface = track.surfaceAt(ride.state.distM) ?? roadSurfaceAt(t, here.x, here.z, ride.surface);
      ride.shelter = windShelterAt(t, here.x, here.z, here.dirX, here.dirZ);
      ride.rain = world.env.state.weather.rain;
    }
    if (workout) ride.ergTarget = workout.update(ride.elapsedS, ride.inputs.watts);
    ride.update(dt, input, steer);
    if (!ride.paused) {
      ghost.update(dt, ride.elapsedS, ride.state.distM);
      tutorial?.update({ shifted, gradePercent: ride.gradePercent, inSegment: !!ride.segment, draft: ride.draft, distM: ride.state.distM - startD });
      if (mp) {
        // Prédiction locale + correction douce vers la position autoritaire du serveur.
        ride.draft = mp.selfDraft();
        ride.state.distM += mp.reconcile(ride.state.distM, dt);
      } else ride.draft = peloton.update(dt, { distM: ride.state.distM, lateral: ride.lateral, speedMs: ride.state.speedMs, watts: ride.inputs.watts, massKg: s.massKg, ftpWatts: s.ftpWatts });
      // Abri derrière un tracteur ou une camionnette qui roule dans le même sens.
      if (traffic) ride.draft = Math.max(ride.draft, traffic.draftFor(ride.state.distM, ride.lateral));
    }
    remoteRiders = mp ? mp.render(dt, engine.camera) : [];
    traffic?.update(dt, ride.state, [
      { distM: ride.state.distM, lateral: ride.lateral, speedMs: ride.state.speedMs },
      ...peloton.riders.map((r) => ({ distM: r.state.distM, lateral: r.lateral, speedMs: r.state.speedMs })),
      ...remoteRiders.map((r) => ({ distM: r.unwrappedM, lateral: r.lateralM, speedMs: r.speedMs })),
    ]);
    track.positionAt(ride.state.distM, ride.lateral, sample);
    pos.set(sample.x, sample.y + 0.06, sample.z);
    dir.set(sample.dirX, 0, sample.dirZ);
    avatar.root.position.copy(pos);
    const heading = Math.atan2(sample.dirX, sample.dirZ);
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
    avatar.root.rotateX(-Math.atan(sample.grade / 100));
    avatar.update(dt, ride.inputs.cadence, ride.state.speedMs, ride.pose, bank);
    // Vue subjective et caméra embarquée : on garde le vélo, les bras et les mains, mais pas la tête.
    const onboard = rig.mode === 'cockpit' || rig.mode === 'gopro';
    avatar.setHeadVisible(!onboard);
    peloton.render(dt, engine.camera);

    const eyeOk = rig.mode === 'cockpit' && !!avatar.eyeWorld;
    if (eyeOk) avatar.eyeWorld?.(eye, hands);
    rig.update(dt, { position: pos, dir, distM: ride.state.distM, speedMs: ride.state.speedMs, ...(eyeOk ? { eye, hands } : {}) });
    // Les tuiles se chargent autour de la caméra libre, où qu'elle aille ; sinon autour du coureur.
    world.update(dt, rig.mode === 'free' ? engine.camera.position : pos);
    headlight.intensity = world.nightFactor() * 120;
    if (!render) return;
    engine.exposure.value = world.env.exposure();
    world.env.grade(engine.grade);
    if (manual) engine.renderManual();
    else engine.render();

    const tile = world.terrain.getTile(...world.terrain.tileCoord(pos.x, pos.z));
    audio.update(
      {
        speedMs: ride.state.speedMs,
        cadence: ride.inputs.cadence,
        watts: ride.inputs.watts,
        ftp: s.ftpWatts,
        roughness: surfaceRoughness(ride.surface),
        rain: world.env.state.weather.rain,
        forest: tile ? splatAt(tile, 0, pos.x + 30, pos.z) * 0.5 + splatAt(tile, 0, pos.x - 30, pos.z) * 0.5 : 0,
        crowd: ride.segment?.seg.kind === 'kom' ? 0.6 : 0,
        windMs: world.env.state.weather.windMs,
        x: pos.x,
        z: pos.z,
        heading,
      },
      dt,
    );

    hudAcc += dt;
    if (hudAcc > 0.1) {
      hudAcc = 0;
      // Habillage TV synchronisé avec la caméra « réalisation TV ».
      const rank = 1 + peloton.riders.filter((r) => r.state.distM > ride.state.distM).length;
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
          gearLabel: `${ride.gear.chainring}×${ride.gear.cog}`,
          gearIndex: ride.gearIndex,
          gearCount: ride.gears.length,
          ...(i.balanceLeft !== undefined ? { balanceLeft: i.balanceLeft } : {}),
          draftPct: ride.draft * 100,
          lap: ride.lap,
          riders: [
            { id: 'me', name: s.name, distM: ride.state.distM, x: pos.x, z: pos.z, me: true, isAI: false, isGuest: false, color: '#ffd23f' },
            ...remoteRiders.map((r) => {
              const p = track.sample(r.unwrappedM);
              return { id: r.id, name: r.name, distM: r.unwrappedM, x: p.x, z: p.z, me: false, isAI: r.isAI, isGuest: r.isGuest, color: r.avatar.jersey, online: !r.isAI, speaking: voice?.speaking.has(r.name) ?? false };
            }),
            ...peloton.riders.map((r) => {
              const p = track.sample(r.state.distM);
              return { id: r.id, name: r.name, distM: r.state.distM, x: p.x, z: p.z, me: false, isAI: true, isGuest: false, color: r.color };
            }),
          ],
          ...(ride.segment ? { segment: { seg: ride.segment.seg, progress: ride.segment.progress, elapsedS: (ride.startT + ride.elapsedS * 1000 - ride.segment.startT) / 1000 } } : {}),
          devices: input.status(),
        },
        s.massKg,
      );
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
  (window as unknown as { __ar: unknown }).__ar = { engine, world, ride, rig, track, peloton, input, finish, advance, hud, shot, avatar };
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
