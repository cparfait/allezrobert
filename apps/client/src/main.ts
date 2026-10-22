import './hud/hud.css';
import * as THREE from 'three/webgpu';
import { RouteTrack, DEFAULT_BIKE, type RiderProfile, type RouteData } from '@allezrobert/shared';
import { createEngine, type Engine } from './engine/renderer.ts';
import { QUALITY_PRESETS, withUrlOverrides } from './engine/quality.ts';
import { World } from './world/world.ts';
import { loadWorldSource } from './world/loader.ts';
import type { WorldSource } from './world/types.ts';
import { GltfRiderAvatar, createAvatar } from './rider/gltfAvatar.ts';
import { CameraRig } from './game/cameras.ts';
import { RideSession } from './game/ride.ts';
import { KeyboardControls, type InputSource } from './game/inputs.ts';
import { Peloton } from './game/peloton.ts';
import { WorkoutController } from './game/workout.ts';
import { Ghost } from './game/ghost.ts';
import { createDeviceLayer } from './game/devices.ts';
import { Hud } from './hud/hud.ts';
import { GameAudio } from './audio/audio.ts';
import { t, setLang, getLang } from './i18n/index.ts';
import { loadSettings, saveSettings, type Settings } from './ui/settings.ts';
import { MainMenu } from './ui/menu.ts';
import { showPause, showSummary, rideToFit } from './ui/ridepanels.ts';
import { splatAt } from './world/splat.ts';
import { Onboarding, RideTutorial } from './onboarding/onboarding.ts';
import { showGarage, awardRide } from './ui/garage.ts';
import { fetchMe, showLogin, applyProfile, logout, pushProfile, type Me } from './ui/account.ts';
import { RideSequences } from './game/sequences.ts';
import { GuestInputSource } from './game/guest.ts';
import { Crowd } from './world/crowd.ts';
import { TownSigns } from './world/signs.ts';
import { Traffic } from './world/traffic.ts';
import { Multiplayer } from './game/multiplayer.ts';
import { VoiceChat } from './game/voice.ts';
import type { InterpolatedRider } from './net/index.ts';

const ui = document.getElementById('ui') as HTMLElement;
const hudRoot = document.getElementById('hud') as HTMLElement;

interface Scene3D {
  quality: Settings['quality'];
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
  const engine = await createEngine(document.getElementById('scene') as HTMLCanvasElement, q);
  const source = await loadWorldSource(params.get('world') ?? 'chevreuse');
  const route = source.routes.find((r) => r.id === (params.get('route') ?? settings.routeId)) ?? (source.routes[0] as RouteData);
  const track = new RouteTrack(route);
  const world = new World(engine.scene, source, route, track, q, {
    hour: Number(params.get('hour') ?? settings.hour),
    season: (params.get('season') as Settings['season'] | null) ?? settings.season,
    weather: { clouds: settings.clouds, rain: settings.rain, fog: settings.fog, windMs: settings.windMs, windFrom: 4.4 },
  });
  return { quality: (params.get('quality') as Settings['quality'] | null) ?? settings.quality, engine, source, world, route, track };
}

async function boot(): Promise<void> {
  const settings = loadSettings();
  setLang(settings.lang);
  ui.innerHTML = `<div class="loading">${t('loading')}</div>`;
  // Avatars Blender (glTF) chargés une fois ; repli procédural automatique en cas d'échec.
  const [scene] = await Promise.all([loadScene(settings), GltfRiderAvatar.load()]);
  const devices = createDeviceLayer();
  const start = scene.track.positionAt(0, 1.2);
  await scene.world.preload(new THREE.Vector3(start.x, start.y, start.z));

  // Plan d'attente derrière le menu : orbite lente autour du départ.
  let orbit = 0;
  let inMenu = true;
  const focus = new THREE.Vector3();
  scene.engine.renderer.setAnimationLoop(() => {
    if (!inMenu) return;
    orbit += 0.0015;
    const p = scene.track.positionAt(0, 0);
    focus.set(p.x, p.y, p.z);
    scene.engine.camera.position.set(p.x + Math.cos(orbit) * 40, p.y + 14, p.z + Math.sin(orbit) * 40);
    scene.engine.camera.lookAt(p.x, p.y + 2, p.z);
    scene.world.update(1 / 60, focus);
    scene.engine.exposure.value = scene.world.env.exposure();
    scene.engine.render();
  });

  const menu = new MainMenu(ui, settings, scene.source.routes, devices.panel, {
    onStart: (s, extras) => {
      saveSettings(s);
      // Changement d'itinéraire ou de qualité graphique : rechargement propre de la scène.
      if (s.routeId !== scene.route.id || s.quality !== scene.quality) {
        const url = new URL(location.href);
        url.searchParams.set('route', s.routeId);
        url.searchParams.delete('quality');
        url.searchParams.set('autostart', '1');
        location.href = url.toString();
        return;
      }
      inMenu = false;
      menu.hide();
      void startRide(scene, s, s.guest ? new GuestInputSource(s.massKg) : devices.source(), extras);
    },
  });
  menu.onSettingsChange = (s) => {
    const env = scene.world.env.state;
    env.hour = s.hour;
    env.weather.clouds = s.clouds;
    env.weather.rain = s.rain;
    env.weather.fog = s.fog;
    if (env.season !== s.season) scene.world.setSeason(s.season);
  };
  menu.onGarage = () => showGarage(ui, settings, () => menu.show());
  menu.onTutorial = () => {
    new Onboarding(ui, settings, devices.panel, (s, skipped) => {
      // Tutoriel passé : retour au menu ; terminé : première sortie commentée.
      if (skipped) {
        menu.show();
        return;
      }
      inMenu = false;
      ui.innerHTML = '';
      void startRide(scene, s, devices.source(), { tutorial: true });
    }).start();
  };
  if (new URLSearchParams(location.search).has('autostart')) {
    inMenu = false;
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
  const profile: RiderProfile = { id: 'local', displayName: s.name, massKg: s.massKg, heightCm: s.heightCm, ftpWatts: s.ftpWatts, bike: DEFAULT_BIKE };
  const params = new URLSearchParams(location.search);
  const startD = Number(params.get('d') ?? 0);
  const ride = new RideSession({
    profile,
    track,
    trainerDifficulty: s.trainerDifficulty,
    startDistM: startD,
    wind: { ms: s.windMs, from: 4.4 },
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
    if (e.key === 'c' || e.key === 'C') hud.toast(t(rig.cycle()));
    if (e.key === 'h' || e.key === 'H') hud.toggle();
    if (e.key === 'm' || e.key === 'M') audio.toggleMute();
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
  let hudAcc = 0;
  let remoteRiders: InterpolatedRider[] = [];
  let prevHeading = Number.NaN;
  let bank = 0;
  const frame = (dt: number, render: boolean, manual = false) => {
    const steer = keyboard.update(dt);
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
    avatar.root.visible = rig.mode !== 'cockpit';
    // Caméra embarquée : on garde le vélo et les bras, mais pas la tête dans le champ.
    avatar.setHeadVisible(rig.mode !== 'gopro');
    peloton.render(dt, engine.camera);

    rig.update(dt, { position: pos, dir, distM: ride.state.distM, speedMs: ride.state.speedMs });
    world.update(dt, pos);
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
        roughness: 0.15,
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
  (window as unknown as { __ar: unknown }).__ar = { engine, world, ride, rig, track, peloton, input, finish, advance, hud, shot };
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
  ui.innerHTML = `<div class="loading">Erreur : ${String((err as Error).message ?? err)}</div>`;
});
