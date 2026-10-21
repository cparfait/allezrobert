import './hud/hud.css';
import * as THREE from 'three/webgpu';
import { RouteTrack, DEFAULT_BIKE, DEFAULT_LOOK, type RiderProfile } from '@allezrobert/shared';
import { createEngine } from './engine/renderer.ts';
import { QUALITY_PRESETS, detectDefaultQuality, withUrlOverrides } from './engine/quality.ts';
import { World } from './world/world.ts';
import { loadWorldSource } from './world/loader.ts';
import { RiderAvatar } from './rider/avatar.ts';
import { CameraRig } from './game/cameras.ts';
import { RideSession } from './game/ride.ts';
import { KeyboardControls, type InputSource } from './game/inputs.ts';
import { DevSimSource } from './game/devsim.ts';
import { Hud } from './hud/hud.ts';
import { t } from './i18n/index.ts';
import type { Season } from './world/environment.ts';

async function boot(): Promise<void> {
  const ui = document.getElementById('ui') as HTMLElement;
  ui.innerHTML = `<div class="loading">${t('loading')}</div>`;
  const params = new URLSearchParams(location.search);
  const q = withUrlOverrides(QUALITY_PRESETS[detectDefaultQuality()]);
  const engine = await createEngine(document.getElementById('scene') as HTMLCanvasElement, q);

  const source = await loadWorldSource(params.get('world') ?? 'chevreuse');
  const route = source.routes[0];
  if (!route) throw new Error('Aucun itinéraire dans le monde');
  const track = new RouteTrack(route);
  const season = (params.get('season') as Season | null) ?? 'autumn';
  const hour = Number(params.get('hour') ?? 10.5);
  const world = new World(engine.scene, source, route, track, q, {
    hour,
    season,
    weather: { clouds: Number(params.get('clouds') ?? 0.35), rain: Number(params.get('rain') ?? 0), fog: Number(params.get('fog') ?? 0), windMs: 3, windFrom: 4.4 },
  });

  const profile: RiderProfile = {
    id: 'local',
    displayName: localStorage.getItem('ar.name') ?? 'Robert',
    massKg: 75,
    heightCm: 178,
    ftpWatts: 250,
    bike: DEFAULT_BIKE,
  };
  const startD = Number(params.get('d') ?? 0);
  const ride = new RideSession({ profile, track, trainerDifficulty: 0.5, startDistM: startD, wind: { ms: 3, from: 4.4 } });
  const start = track.positionAt(startD, ride.lateral);
  await world.preload(new THREE.Vector3(start.x, start.y, start.z));

  const avatar = new RiderAvatar(DEFAULT_LOOK);
  engine.scene.add(avatar.root);
  const rig = new CameraRig(engine.camera, track, (x, z) => world.terrain.heightAt(x, z), engine.renderer.domElement);
  const hud = new Hud(document.getElementById('hud') as HTMLElement, track, source.attribution);
  const keyboard = new KeyboardControls();
  const input: InputSource = new DevSimSource();
  const onShift = (a: string) => {
    if (a === 'up') ride.shift(1);
    else if (a === 'down') ride.shift(-1);
    else if (a === 'frontUp') ride.shift(12);
    else if (a === 'frontDown') ride.shift(-12);
  };
  keyboard.onShift(onShift);
  input.onShift(onShift);
  ride.onSegmentDone = (r) => hud.toast(`${t('segmentDone')} · ${r.seg.name} · ${Math.floor(r.timeS / 60)}:${String(Math.round(r.timeS % 60)).padStart(2, '0')}`);
  ride.onLap = (lap) => hud.toast(`${t('lap')} ${lap}`);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'c' || e.key === 'C') hud.toast(t(rig.cycle()));
    if (e.key === 'h' || e.key === 'H') hud.toggle();
    if (e.key === ' ') ride.paused = !ride.paused;
  });
  ui.innerHTML = '';

  const timer = new THREE.Timer();
  timer.connect(document);
  const pos = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const sample = { x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, grade: 0, d: 0 };
  let hudAcc = 0;
  let prevHeading = 0;
  let bank = 0;
  (window as unknown as { __ar: unknown }).__ar = { engine, world, ride, rig, track };

  engine.renderer.setAnimationLoop(() => {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.1);
    const steer = keyboard.update(dt);
    ride.update(dt, input, steer);
    track.positionAt(ride.state.distM, ride.lateral, sample);
    pos.set(sample.x, sample.y + 0.06, sample.z);
    dir.set(sample.dirX, 0, sample.dirZ);
    avatar.root.position.copy(pos);
    const heading = Math.atan2(sample.dirX, sample.dirZ);
    // Inclinaison en virage : proportionnelle à v²/R (vitesse angulaire du cap × vitesse).
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

    rig.update(dt, { position: pos, dir, distM: ride.state.distM, speedMs: ride.state.speedMs });
    world.update(dt, pos);
    engine.exposure.value = world.env.exposure();
    engine.render();

    hudAcc += dt;
    if (hudAcc > 0.1) {
      hudAcc = 0;
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
          ftp: profile.ftpWatts,
          gearLabel: `${ride.gear.chainring}×${ride.gear.cog}`,
          gearIndex: ride.gearIndex,
          gearCount: ride.gears.length,
          ...(i.balanceLeft !== undefined ? { balanceLeft: i.balanceLeft } : {}),
          draftPct: ride.draft * 100,
          lap: ride.lap,
          riders: [{ id: 'me', name: profile.displayName, distM: ride.state.distM, x: pos.x, z: pos.z, me: true, isAI: false, isGuest: false, color: '#ffd23f' }],
          ...(ride.segment ? { segment: { seg: ride.segment.seg, progress: ride.segment.progress, elapsedS: (Date.now() - ride.segment.startT) / 1000 } } : {}),
          devices: input.status(),
        },
        profile.massKg,
      );
    }
  });
}

boot().catch((err) => {
  console.error(err);
  const ui = document.getElementById('ui') as HTMLElement;
  ui.innerHTML = `<div class="loading">Erreur : ${String((err as Error).message ?? err)}</div>`;
});
