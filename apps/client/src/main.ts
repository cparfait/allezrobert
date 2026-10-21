import './hud/hud.css';
import * as THREE from 'three/webgpu';
import { RouteTrack, DEFAULT_BIKE, type RiderProfile, type RouteData } from '@allezrobert/shared';
import { createEngine, type Engine } from './engine/renderer.ts';
import { QUALITY_PRESETS, withUrlOverrides } from './engine/quality.ts';
import { World } from './world/world.ts';
import { loadWorldSource } from './world/loader.ts';
import type { WorldSource } from './world/types.ts';
import { RiderAvatar } from './rider/avatar.ts';
import { CameraRig } from './game/cameras.ts';
import { RideSession } from './game/ride.ts';
import { KeyboardControls, type InputSource } from './game/inputs.ts';
import { Peloton } from './game/peloton.ts';
import { WorkoutController } from './game/workout.ts';
import { Ghost } from './game/ghost.ts';
import { createDeviceLayer } from './game/devices.ts';
import { Hud } from './hud/hud.ts';
import { GameAudio } from './audio/audio.ts';
import { t, setLang } from './i18n/index.ts';
import { loadSettings, saveSettings, type Settings } from './ui/settings.ts';
import { MainMenu } from './ui/menu.ts';
import { showPause, showSummary, rideToFit } from './ui/ridepanels.ts';
import { splatAt } from './world/splat.ts';
import { Onboarding, RideTutorial } from './onboarding/onboarding.ts';
import { showGarage, awardRide } from './ui/garage.ts';
import { RideSequences } from './game/sequences.ts';

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
  const scene = await loadScene(settings);
  const devices = createDeviceLayer();
  const start = scene.track.positionAt(0, -1.2);
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
      void startRide(scene, s, devices.source(), extras);
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
    new Onboarding(ui, settings, devices.panel, (s) => {
      inMenu = false;
      ui.innerHTML = '';
      void startRide(scene, s, devices.source(), { tutorial: true });
    }).start();
  };
  if (new URLSearchParams(location.search).has('autostart')) {
    inMenu = false;
    void startRide(scene, settings, devices.source(), {});
  } else if (Onboarding.needed()) menu.onTutorial();
  else menu.show();
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
  const avatar = new RiderAvatar(s.look);
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
  const aiCount = workout ? 0 : Math.min(Math.max(s.aiRiders, 0), 19);
  const peloton = new Peloton(engine.scene, track, aiCount, startD, s.ftpWatts);
  const ghost = new Ghost(engine.scene, track, track.route.id, startD);
  const rig = new CameraRig(engine.camera, track, (x, z) => world.terrain.heightAt(x, z), engine.renderer.domElement);
  rig.occluders = [world.buildings.group];
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
    if (sequences.enabled) sequences.segment(r, s.name, track.route.id, 1, 1);
    else hud.toast(`${t('segmentDone')} · ${r.seg.name} · ${Math.floor(r.timeS / 60)}:${String(Math.round(r.timeS % 60)).padStart(2, '0')}`);
  };
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
    tutorial?.stop();
    const xp = awardRide({ distanceM: ride.state.distM - startD, elevationM: ride.elevationGainM, movingS: ride.elapsedS });
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
  let prevHeading = Number.NaN;
  let bank = 0;
  const frame = (dt: number, render: boolean, manual = false) => {
    const steer = keyboard.update(dt);
    if (workout) ride.ergTarget = workout.update(ride.elapsedS, ride.inputs.watts);
    ride.update(dt, input, steer);
    if (!ride.paused) {
      ghost.update(dt, ride.elapsedS, ride.state.distM);
      tutorial?.update({ shifted, gradePercent: ride.gradePercent, inSegment: !!ride.segment, draft: ride.draft, distM: ride.state.distM - startD });
      ride.draft = peloton.update(dt, { distM: ride.state.distM, lateral: ride.lateral, speedMs: ride.state.speedMs, watts: ride.inputs.watts, massKg: s.massKg });
    }
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
}

boot().catch((err) => {
  console.error(err);
  ui.innerHTML = `<div class="loading">Erreur : ${String((err as Error).message ?? err)}</div>`;
});
