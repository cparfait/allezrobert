import * as THREE from 'three/webgpu';
import type { AvatarLook, RouteTrack, TrackSample } from '@allezrobert/shared';
import { BASE_PROFILES, DEFAULT_LOOK, FACE_SLIDERS, encodeFace, type FaceShape } from '@allezrobert/shared';
import { GltfRiderAvatar, createAvatar, type RiderAvatarLike } from '../rider/gltfAvatar.ts';
import { crowdShoes } from '../rider/shoeLook.ts';
import { crowdBike } from '../rider/bikes.ts';
import { rng } from '../engine/noise.ts';
import { sunDirection } from '../world/environment.ts';
import { splatAt } from '../world/splat.ts';
import type { World } from '../world/world.ts';
import type { Engine } from '../engine/renderer.ts';
import { filmClock, freezeStreaming, waitForAssets, type ViewPoint } from './cinematicStream.ts';
import { CINE_ENV, GROUP_SPEED, LOOP_S, SLOTS, XFADE_S, formation, frameCount, frontFraming, isCineSeason, shotAt, smooth, type CineSeason } from './cinematicPlan.ts';

/**
 * Mode « cinématique » (développement uniquement) : film d'accueil rendu image par image à pas
 * fixe, sans dépendre de requestAnimationFrame (le panneau du navigateur peut être masqué).
 *
 *   /?cinematic=autumn&route=chevreuse-boucle&quality=ultra&fps=30&w=1920&h=1080&ss=2&sub=8&capture=1
 *
 * - capture=1 : chaque image part en PNG (sans perte) vers POST /__save (dir=menu-loop/<saison>),
 *   puis un manifeste ; tools/menu-loop attend ce manifeste et encode la boucle (voir son README).
 *   &then=summer,winter enchaîne les saisons suivantes dans le même onglet.
 * - stills=5,15.5 : quelques images seulement (out/menu-loop/stills-<saison>/), pour régler les plans.
 * - sans l'un ni l'autre : aperçu en continu.
 * - d=<m> : impose l'abscisse de départ de la tête (sinon CINE_D, sinon recherche automatique).
 * - hour=<h> : autre heure que celle de la saison (essais d'éclairage).
 * - ss=2 : suréchantillonnage, rendu à (w·ss)×(h·ss) puis réduit à w×h dans la page.
 * - sub=8 : rendus de plus sur chaque image, scène immobile, pour que l'anticrénelage temporel
 *   converge (48 au premier plan d'un raccord, où son historique repart de zéro).
 * Le paysage est figé pour tout le trajet avant la première image (cinematicStream.ts) : pas
 * d'apparition de tuiles, d'arbres ni d'herbe en cours de plan.
 */

/** Abscisse de départ retenue par itinéraire (m, issue de la recherche automatique ; même tronçon pour les 4 saisons). */
const CINE_D: Record<string, number> = { 'chevreuse-boucle': 5825 };

const JERSEYS = ['#d7f205', '#111418', '#c0392b', '#e8ecf0', '#1e5bd8', '#2b2f36', '#f39c12', '#16a085', '#8e44ad'];
const BIKES = ['#1d1d1f', '#e8ecf0', '#c0392b', '#2c3e50', '#16a085', '#f4f4f4', '#d35400'];
const HELMETS = ['#f4f4f4', '#111111', '#1e5bd8', '#c0392b', '#f4f4f4'];
/**
 * Visages du groupe (avatar MPFB) : un profil de base par coureur (packages/shared/src/profiles.ts),
 * Robert en tête ; les deux derniers reprennent un profil avec d'autres traits et un autre teint.
 */
const CAST = ['robert', 'moussa', 'lea', 'karim', 'aiko', 'tom', 'ines', 'marta', 'tom', 'moussa'];
const RECAST: ReadonlyArray<Partial<AvatarLook>> = [
  { skin: '#d9a47e', hair: '#5a3b22', beard: 0.6 },
  { skin: '#7a4e34', hair: '#1a1a1a', beard: 0.3 },
];

const _s: TrackSample = { x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, grade: 0, d: 0 };

/** Recherche d'un tronçon de ~600 m : peu de pente, pas d'épingle, paysage ouvert, soleil de côté. */
async function chooseStart(world: World, track: RouteTrack, season: CineSeason): Promise<number> {
  const manual = CINE_D[track.route.id];
  if (manual !== undefined) return manual;
  const span = GROUP_SPEED * (LOOP_S + XFADE_S) + 20;
  const sun = sunDirection(CINE_ENV[season].hour, season);
  const sunAz = Math.atan2(sun.x, sun.z);
  const heading = (d: number) => {
    const p = track.sample(d, _s);
    return Math.atan2(p.dirX, p.dirZ);
  };
  const turn = (a: number, b: number) => {
    let x = b - a;
    while (x > Math.PI) x -= 2 * Math.PI;
    while (x < -Math.PI) x += 2 * Math.PI;
    return Math.abs(x);
  };
  const cands: Array<{ d: number; score: number }> = [];
  for (let d0 = 0; d0 < track.length; d0 += 25) {
    let maxGrade = 0;
    let maxTurn = 0;
    let sunScore = 0;
    let n = 0;
    for (let k = -15; k <= span; k += 10) {
      const p = track.sample(d0 + k, _s);
      maxGrade = Math.max(maxGrade, Math.abs(p.grade));
      maxTurn = Math.max(maxTurn, turn(heading(d0 + k - 15), heading(d0 + k + 15)));
      // Lumière rasante de côté : soleil à ~90° de l'axe de la route.
      const off = turn(Math.atan2(p.dirX, p.dirZ), sunAz);
      sunScore += 1 - Math.abs(off - Math.PI / 2) / (Math.PI / 2);
      n++;
    }
    if (maxGrade > 4.5 || maxTurn > 0.5) continue;
    cands.push({ d: d0, score: (sunScore / n) * 2 - maxGrade * 0.15 - maxTurn * 2 });
  }
  cands.sort((a, b) => b.score - a.score);
  const picked: Array<{ d: number; score: number }> = [];
  for (const c of cands) {
    if (picked.every((p) => Math.abs(p.d - c.d) > 300)) picked.push(c);
    if (picked.length >= 10) break;
  }
  let best = picked[0]?.d ?? 0;
  let bestScore = -Infinity;
  for (const c of picked) {
    const p = track.sample(c.d + span / 2, _s);
    await world.preload(new THREE.Vector3(p.x, p.y, p.z));
    let open = 0;
    let m = 0;
    for (let k = 0; k <= span; k += 30)
      for (const lat of [-25, -10, 10, 25]) {
        const q = track.positionAt(c.d + k, lat, _s);
        const tile = world.terrain.getTile(...world.terrain.tileCoord(q.x, q.z));
        if (!tile) continue;
        open += splatAt(tile, 1, q.x, q.z) + splatAt(tile, 2, q.x, q.z) - splatAt(tile, 0, q.x, q.z) - 2.5 * splatAt(tile, 4, q.x, q.z);
        m++;
      }
    const score = c.score + (m ? (open / m) * 4 : -10);
    console.info(`[cinematic] d=${c.d} géométrie+soleil=${c.score.toFixed(2)} total=${score.toFixed(2)}`);
    if (score > bestScore) {
      bestScore = score;
      best = c.d;
    }
  }
  return best;
}

/**
 * Tenue et visage du coureur i : profil de base, curseurs du visage un peu variés (comme les IA
 * en sortie, game/peloton.ts), maillot et vélo de la palette du film. Tirages reproductibles.
 */
function lookFor(i: number): AvatarLook {
  const r = rng(4242 + i * 7919);
  const id = CAST[i % CAST.length] as string;
  const p = BASE_PROFILES.find((b) => b.id === id) ?? BASE_PROFILES[0];
  const shape: FaceShape = { ...p?.shape };
  const spread = i >= 8 ? 0.8 : 0.45;
  for (const sl of FACE_SLIDERS) {
    if (sl.group === 'body') continue;
    shape[sl.id] = Math.max(-1, Math.min(1, (shape[sl.id] ?? 0) + (r() - 0.5) * spread));
  }
  const { jersey: _j, jerseyAccent: _a, ...face } = p?.look ?? {};
  const base: AvatarLook = { ...DEFAULT_LOOK, ...face, ...(i >= 8 ? RECAST[i - 8] : {}), face: encodeFace(shape) };
  if (i === 0) return base;
  const j = i - 1;
  return {
    ...base,
    jersey: JERSEYS[j % JERSEYS.length] as string,
    jerseyAccent: JERSEYS[(j + 4) % JERSEYS.length] as string,
    helmet: HELMETS[j % HELMETS.length] as string,
    ...crowdShoes(j),
    bike: BIKES[j % BIKES.length] as string,
    bikeModel: crowdBike(j),
    build: ((j * 37) % 10) / 10,
  };
}

interface CameraPose {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

export async function runCinematic(engine: Engine, world: World, track: RouteTrack): Promise<void> {
  const params = new URLSearchParams(location.search);
  const seasonParam = params.get('cinematic');
  const season: CineSeason = isCineSeason(seasonParam) ? seasonParam : 'autumn';
  const fps = Number(params.get('fps') ?? 30);
  const W = Number(params.get('w') ?? 1920);
  const H = Number(params.get('h') ?? 1080);
  const capture = params.get('capture') === '1';
  const ss = Math.min(3, Math.max(1, Math.round(Number(params.get('ss') ?? 1))));
  const sub = Math.max(0, Math.round(Number(params.get('sub') ?? 0)));
  const cutSub = sub ? Math.max(48, sub) : 6;
  const stills = (params.get('stills') ?? '')
    .split(',')
    .filter(Boolean)
    .map(Number)
    .filter((x) => Number.isFinite(x));

  // Canvas à la taille exacte de la vidéo, indépendamment de la fenêtre et de l'écran.
  const canvas = engine.renderer.domElement;
  canvas.style.width = `${W * ss}px`;
  canvas.style.height = `${H * ss}px`;
  engine.renderer.setPixelRatio(1);
  engine.resize();
  const status = document.createElement('div');
  status.style.cssText = 'position:fixed;left:8px;top:8px;z-index:60;padding:4px 8px;font:12px monospace;color:#fff;background:rgba(0,0,0,.6)';
  document.body.append(status);
  const say = (msg: string) => {
    status.textContent = msg;
    document.title = msg;
  };
  const state = { season, fps, frames: frameCount(fps), done: 0, finished: false, d0: 0, error: '' };
  (window as unknown as { __cine: unknown }).__cine = state;

  // Saison, heure dorée et ciel du film.
  const env = CINE_ENV[season];
  if (world.env.state.season !== season) world.setSeason(season);
  const ws = world.env.state;
  ws.hour = params.has('hour') ? Number(params.get('hour')) : env.hour;
  ws.weather.clouds = env.clouds;
  ws.weather.rain = 0;
  ws.weather.fog = env.fog;
  ws.weather.windMs = env.windMs;

  say('cinematic : choix du tronçon…');
  const d0 = params.has('d') ? Number(params.get('d')) : await chooseStart(world, track, season);
  state.d0 = d0;
  console.info(`[cinematic] ${season} : départ de la tête à d=${d0} m`);

  // Niveau de détail maximal à toute distance : au téléobjectif, un coureur lointain occupe une
  // grande part de l'image (et le visage ne s'anime qu'au premier niveau).
  GltfRiderAvatar.lodScale = 1000;
  const riders: RiderAvatarLike[] = SLOTS.map((_, i) => {
    const a = createAvatar(lookFor(i));
    a.setShadows(true);
    // Effort d'endurance tranquille : respiration posée, aucune grimace.
    a.setEffort?.(0.6 + 0.04 * (i % 4), 0.6 + 0.03 * (i % 3));
    engine.scene.add(a.root);
    return a;
  });

  const leaderD = (t: number) => d0 + GROUP_SPEED * t;
  const heading = (d: number) => {
    const p = track.sample(d, _s);
    return Math.atan2(p.dirX, p.dirZ);
  };
  /** Inclinaison en virage ∝ v²·courbure (comme en sortie), bornée. */
  const bankAt = (d: number) => {
    let dh = heading(d + 6) - heading(d - 6);
    if (dh > Math.PI) dh -= 2 * Math.PI;
    if (dh < -Math.PI) dh += 2 * Math.PI;
    const yawRate = (dh / 12) * GROUP_SPEED;
    return THREE.MathUtils.clamp(-yawRate * GROUP_SPEED * 0.08, -0.35, 0.35);
  };

  const placeRiders = (t: number, dt: number) => {
    const dL = leaderD(t);
    riders.forEach((a, i) => {
      const f = formation(i, t);
      const d = dL - f.back;
      const p = track.positionAt(d, f.lat, _s);
      a.root.position.set(p.x, p.y + 0.06, p.z);
      a.root.rotation.set(0, 0, 0);
      a.root.rotateY(Math.atan2(p.dirX, p.dirZ));
      a.root.rotateX(-Math.atan(p.grade / 100));
      a.update(dt, (SLOTS[i] as { cadence: number }).cadence, GROUP_SPEED, 'seated', bankAt(d));
    });
  };

  const ground = (x: number, z: number) => world.terrain.heightAt(x, z);
  const at = (d: number, lat: number, h: number, out: THREE.Vector3, minAboveGround = 0.3) => {
    const p = track.positionAt(d, lat, _s);
    out.set(p.x, p.y + h, p.z);
    const g = ground(p.x, p.z);
    if (Number.isFinite(g)) out.y = Math.max(out.y, g + minAboveGround, p.y + h);
    return out;
  };
  const cam: CameraPose = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 40 };
  const passD = leaderD(36.5) - 5;

  /** Caméra du plan courant (fonction pure du temps, raccords francs entre plans). */
  const cameraAt = (t: number): CameraPose => {
    const { shot, local, u } = shotAt(t);
    const dL = leaderD(t);
    const dG = dL - 5; // milieu du groupe
    switch (shot.kind) {
      case 'front':
      case 'frontEnd': {
        // Travelling avant bas : caméra devant la tête, regard vers le groupe qui arrive.
        const f = frontFraming(shot.kind, local);
        at(dL + f.ahead, f.lat, f.height, cam.pos);
        at(dL - 4, 2.4, 1.0, cam.target);
        cam.fov = 34;
        break;
      }
      case 'side': {
        // Travelling latéral au téléobjectif depuis l'autre côté de la route ; le groupe glisse dans le cadre.
        const k = smooth(u);
        at(dG + 4 - 9 * k, -15, 1.7, cam.pos, 1.5);
        at(dG + 1.5 - 3 * k, 1.3, 1.0, cam.target);
        cam.fov = 14;
        break;
      }
      case 'crane': {
        // Grue : départ au ras du bas-côté devant le groupe, montée à 14 m pendant qu'il passe dessous.
        const k = smooth(u);
        at(dL + 10 - 20 * k, 4.6 + 1.5 * k, 1.3 + 13 * smooth(u * 1.15), cam.pos);
        at(dG + 1 - 2 * k, 1.2, 0.9, cam.target);
        cam.fov = 40 - 6 * k;
        break;
      }
      case 'pass': {
        // Plan fixe au bord de la route : le groupe arrive de loin, passe et s'éloigne ; panoramique.
        at(passD, -4.8, 0.8, cam.pos);
        at(dG, 1.3, 1.0, cam.target);
        // Zoom : le groupe garde à peu près la même taille de loin comme de près.
        cam.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(3.2 / cam.pos.distanceTo(cam.target))), 9, 40);
        break;
      }
      case 'close': {
        // Gros plan : roues et jambes de la tête, caméra basse côté accotement qui recule doucement.
        const k = smooth(u);
        const lat = formation(0, t).lat;
        at(dL + 1.9 - 1.5 * k, lat + 1.5, 0.5 + 0.3 * k, cam.pos);
        at(dL + 0.1 - 0.4 * k, lat, 0.62 + 0.12 * k, cam.target);
        cam.fov = 42;
        break;
      }
    }
    return cam;
  };

  /** Centre du groupe : soleil et ombres le suivent (world.update). */
  const focus = new THREE.Vector3();
  const setFocus = (t: number) => {
    const p = track.positionAt(leaderD(t) - 5, 1, _s);
    focus.set(p.x, p.y, p.z);
  };

  // Paysage figé pour tout le film : points de vue (caméra et groupe) toutes les 0,5 s.
  const views: ViewPoint[] = [];
  for (let t = -1.5; t <= LOOP_S + XFADE_S + 0.5; t += 0.5) {
    const c = cameraAt(t);
    views.push({ x: c.pos.x, z: c.pos.z });
    const g = track.positionAt(leaderD(t) - 5, 1, _s);
    views.push({ x: g.x, z: g.z });
  }
  const mid = track.positionAt(leaderD((LOOP_S + XFADE_S) / 2) - 5, 1, _s);
  const fixedFocus = new THREE.Vector3(mid.x, mid.y, mid.z);
  const grassCenter = new THREE.Vector3();
  freezeStreaming(world, fixedFocus, views, grassCenter);
  const clock = filmClock(engine);

  const camera = engine.camera;
  const step = (t: number, dt: number) => {
    setFocus(t);
    // Horloge des shaders : temps du film (décalé : jamais négatif), arrêtée pendant les sous-rendus.
    clock.time = 100 + t;
    clock.delta = dt;
    placeRiders(t, dt);
    const c = cameraAt(t);
    grassCenter.copy(c.pos);
    camera.position.copy(c.pos);
    camera.fov = c.fov;
    camera.updateProjectionMatrix();
    camera.lookAt(c.target);
    world.update(dt, focus);
    engine.exposure.value = world.env.exposure();
    world.env.grade(engine.grade);
    engine.renderManual();
  };

  // Attente de la carte graphique entre deux images (pas de file de rendus sans fin).
  const device = (engine.renderer.backend as { device?: { queue: { onSubmittedWorkDone(): Promise<void> } } }).device;
  const settle = () => device?.queue.onSubmittedWorkDone() ?? Promise.resolve();

  /**
   * Rend la séquence [t0, t1) à pas fixe ; `onFrame` reçoit chaque image utile. `subFrames` :
   * avec les sous-rendus de convergence (sans : mise en route rapide).
   */
  const run = async (t0: number, n: number, onFrame: ((i: number, t: number) => Promise<void>) | null, subFrames = true) => {
    const dt = 1 / fps;
    let prevShot = -1;
    for (let i = 0; i < n; i++) {
      const t = t0 + i * dt;
      const idx = shotAt(t).index;
      step(t, dt);
      // Sous-rendus de la même image (scène immobile) : l'anticrénelage temporel converge ; plus
      // nombreux au raccord entre deux plans, où son historique repart de zéro.
      const extra = !subFrames ? 0 : prevShot >= 0 && idx !== prevShot ? cutSub : sub;
      for (let k = 0; k < extra; k++) step(t, 0);
      prevShot = idx;
      if (onFrame) await onFrame(i, t);
      await settle();
    }
  };

  // Envoi au serveur de dev, avec nouvelles tentatives pendant 3 min : si le serveur tombe,
  // tools/menu-loop le relance et la capture continue sans recommencer la saison.
  const post = async (url: string, body: string | Blob) => {
    for (let k = 0; ; k++) {
      const res = await fetch(url, { method: 'POST', body }).catch(() => null);
      if (res?.ok) return;
      if (k >= 90) throw new Error(`${url} : ${res ? `HTTP ${res.status}` : 'serveur injoignable'}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  };
  // Image finale w×h : réduction du rendu suréchantillonné (filtre de qualité du navigateur),
  // copiée tout de suite après le rendu ; l'encodage PNG (sans perte) se fait en parallèle.
  const outCanvas = document.createElement('canvas');
  outCanvas.width = W;
  outCanvas.height = H;
  const out2d = outCanvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
  out2d.imageSmoothingEnabled = true;
  out2d.imageSmoothingQuality = 'high';
  const png = (): Promise<Blob> => {
    out2d.drawImage(canvas, 0, 0, W, H);
    return new Promise((res, rej) => outCanvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob a échoué'))), 'image/png'));
  };

  try {
    // Mise en route : tuiles, shaders, visages (effort lissé sur quelques secondes) et historique
    // temporel : 6 s rendues avant la première image, non capturées.
    say('cinematic : préchargement…');
    setFocus(-1);
    await world.preload(fixedFocus);
    step(-1, 0);
    await waitForAssets(world, say);
    await engine.renderer.compileAsync(engine.scene, camera).catch(() => undefined);
    if (stills.length) {
      for (const ts of stills) {
        await run(ts - 6, 5 * fps, null, false);
        // Copie de l'image dans la même tâche que son rendu (après une attente, le canvas WebGPU est vide).
        let shot: Promise<Blob> | null = null;
        await run(ts - 1, fps + 1, async (i) => {
          if (i === fps) shot = png();
        });
        say(`cinematic : image t=${ts}`);
        if (shot) await post(`/__save?dir=menu-loop/stills-${season}&name=${encodeURIComponent(`t${ts.toFixed(1).replace('.', '_')}.png`)}`, await shot);
      }
      state.finished = true;
      say(`cinematic : ${stills.length} images → out/menu-loop/stills-${season}/`);
      return;
    }
    await run(-6, 5 * fps, null, false);
    await run(-1, fps, null);
    if (capture) {
      const inflight = new Set<Promise<void>>();
      const t0 = performance.now();
      await run(0, state.frames, async (i) => {
        const p = png()
          .then((blob) => post(`/__save?dir=menu-loop/${season}&name=frame-${String(i).padStart(5, '0')}.png`, blob))
          .then(() => {
            inflight.delete(p);
            state.done++;
          });
        inflight.add(p);
        if (inflight.size >= 4) await Promise.race(inflight);
        if (i % 15 === 0) {
          const rate = (i + 1) / ((performance.now() - t0) / 1000);
          say(`cinematic ${season} : ${i + 1}/${state.frames} (${rate.toFixed(1)} img/s)`);
        }
      });
      await Promise.all(inflight);
      const manifest = { season, fps, width: W, height: H, format: 'png', ss, sub, frames: state.frames, loopS: LOOP_S, xfadeS: XFADE_S, routeId: track.route.id, d0, hour: env.hour, renderS: Math.round((performance.now() - t0) / 1000), createdAt: new Date().toISOString() };
      await post(`/__save?dir=menu-loop/${season}&name=manifest.json`, JSON.stringify(manifest, null, 2));
      state.finished = true;
      say(`cinematic ${season} : ${state.frames} images capturées`);
      // Saisons suivantes dans le même onglet (&then=summer,winter).
      const then = (params.get('then') ?? '').split(',').filter(isCineSeason);
      if (then.length) {
        const url = new URL(location.href);
        url.searchParams.set('cinematic', then[0] as string);
        if (then.length > 1) url.searchParams.set('then', then.slice(1).join(','));
        else url.searchParams.delete('then');
        location.href = url.toString();
      }
      return;
    }
    // Aperçu : une image par tour d'animation, au pas fixe (ralenti si le rendu est lent).
    let i = 0;
    let busy = false;
    engine.renderer.setAnimationLoop(() => {
      if (busy) return;
      busy = true;
      const t = (i++ / fps) % (LOOP_S + XFADE_S);
      step(t, 1 / fps);
      say(`cinematic ${season} t=${t.toFixed(1)} s · ${shotAt(t).shot.kind}`);
      busy = false;
    });
  } catch (err) {
    state.error = String(err);
    say(`cinematic : erreur ${String(err)}`);
    throw err;
  }
}
