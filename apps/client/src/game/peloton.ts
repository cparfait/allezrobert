import * as THREE from 'three/webgpu';
import { AiRider, AI_PROFILES, DraftCalculator, PoseController, createRiderState, paramsFromBike, stepRider, airDensity, type AiProfileName, type RiderState } from '@allezrobert/physics';
import { DEFAULT_BIKE, DEFAULT_LOOK, type AvatarLook, type RouteTrack } from '@allezrobert/shared';
import { RiderAvatar } from '../rider/avatar.ts';
import { rng } from '../engine/noise.ts';

/** Noms des coureurs IA (clins d'œil locaux, aucun nom réel). */
const NAMES = ['Lucien', 'Marcelle', 'Fernand', 'Odette', 'Gaston', 'Simone', 'Raymond', 'Paulette', 'Émile', 'Yvette', 'Marius', 'Germaine', 'Albert', 'Huguette', 'Léon', 'Jeannine', 'Maurice', 'Suzanne', 'René'];
const JERSEYS = ['#e63946', '#2a9d8f', '#f4a261', '#8d99ae', '#06d6a0', '#ef476f', '#118ab2', '#ffd166', '#6a4c93', '#90be6d', '#f3722c', '#277da1'];
const PROFILES: AiProfileName[] = ['rouleur', 'diesel', 'puncheur', 'sprinter'];

export interface PelotonRider {
  id: string;
  name: string;
  color: string;
  state: RiderState;
  lateral: number;
  ai: AiRider;
  avatar: RiderAvatar;
  label: THREE.Sprite;
  watts: number;
  cadence: number;
  draft: number;
  massKg: number;
  ftp: number;
  poseCtl: PoseController;
  pose: 'seated' | 'standing' | 'coasting';
}

function nameSprite(text: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = 'rgba(10,14,22,0.7)';
  ctx.beginPath();
  ctx.roundRect(4, 8, 248, 48, 22);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(32, 32, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f5f7fa';
  ctx.font = '600 26px Inter, Segoe UI, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 52, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Taille constante à l'écran, quelle que soit la distance.
  const mat = new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, sizeAttenuation: false });
  const s = new THREE.Sprite(mat);
  s.scale.set(0.11, 0.0275, 1);
  s.renderOrder = 10;
  return s;
}

/**
 * Peloton local de coureurs IA (sortie solo). Les IA roulent à l'allure du joueur
 * (W/kg glissant), prennent des relais, attaquent sur les segments ; l'aspiration est
 * calculée pour tout le monde, joueur compris.
 */
export class Peloton {
  readonly riders: PelotonRider[] = [];
  private readonly track: RouteTrack;
  private readonly scene: THREE.Scene;
  private readonly draft = new DraftCalculator();
  private paceWkg = 2.6;
  private readonly sample = { x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, grade: 0, d: 0 };

  constructor(scene: THREE.Scene, track: RouteTrack, count: number, startDistM: number, ftpRef: number) {
    this.scene = scene;
    this.track = track;
    const r = rng(42);
    for (let i = 0; i < count; i++) {
      const massKg = 58 + r() * 30;
      const ftp = Math.round(ftpRef * (0.8 + r() * 0.45));
      const color = JERSEYS[i % JERSEYS.length] as string;
      const look: AvatarLook = {
        ...DEFAULT_LOOK,
        jersey: color,
        jerseyAccent: JERSEYS[(i + 5) % JERSEYS.length] as string,
        bike: ['#1d1d1f', '#c0392b', '#f4f4f4', '#2c3e50', '#16a085'][i % 5] as string,
        skin: ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'][i % 5] as string,
        helmet: ['#f4f4f4', '#111111', color][i % 3] as string,
        build: r(),
      };
      const avatar = new RiderAvatar(look);
      scene.add(avatar.root);
      const name = NAMES[i % NAMES.length] as string;
      const label = nameSprite(name, color);
      scene.add(label);
      const params = paramsFromBike(massKg, DEFAULT_BIKE);
      this.riders.push({
        id: `ai-${i}`,
        name,
        color,
        // Départ groupé : en file indienne juste devant et derrière le joueur.
        state: createRiderState({ distM: startDistM + (i % 2 ? 1 : -1) * (2 + Math.floor(i / 2) * 2.2), speedMs: 0 }),
        lateral: ((i % 3) - 1) * 0.9 - 0.8,
        ai: new AiRider({ id: `ai-${i}`, profile: PROFILES[i % PROFILES.length] as AiProfileName, ftpWatts: ftp, params, riderMassKg: massKg, seed: i * 7919 }),
        avatar,
        label,
        watts: 0,
        cadence: 0,
        draft: 0,
        massKg,
        ftp,
        poseCtl: new PoseController(),
        pose: 'seated',
      });
    }
    void AI_PROFILES;
  }

  /**
   * @param player position et puissance du joueur (référence d'allure et d'aspiration)
   * @returns l'aspiration dont bénéficie le joueur (0–1)
   */
  update(dt: number, player: { distM: number; lateral: number; speedMs: number; watts: number; massKg: number }): number {
    if (!this.riders.length) return 0;
    // Allure du groupe : W/kg du joueur, lissé sur ~20 s (le groupe roule « avec » lui).
    const wkg = player.watts / Math.max(player.massKg, 1);
    this.paceWkg += (Math.min(Math.max(wkg, 1.2), 5.5) - this.paceWkg) * Math.min(1, dt / 20);

    const all = [{ distM: player.distM, lateralM: player.lateral, speedMs: player.speedMs }, ...this.riders.map((r) => ({ distM: r.state.distM, lateralM: r.lateral, speedMs: r.state.speedMs }))];
    const factors = this.draft.compute(all);
    const order = [...this.riders].sort((a, b) => b.state.distM - a.state.distM);
    order.forEach((r, rank) => {
      r.draft = factors[this.riders.indexOf(r) + 1] ?? 0;
      const s = this.track.sample(r.state.distM, this.sample);
      // Coureur juste devant (IA ou joueur).
      let ahead: { distM: number; speedMs: number; lateral: number } | null = null;
      for (const o of [...this.riders.map((x) => ({ distM: x.state.distM, speedMs: x.state.speedMs, lateral: x.lateral })), { distM: player.distM, speedMs: player.speedMs, lateral: player.lateral }]) {
        if (o.distM > r.state.distM + 0.01 && (!ahead || o.distM < ahead.distM)) ahead = o;
      }
      const env = { airDensity: airDensity(s.y, 14), windSpeedMs: 0 };
      const out = r.ai.update(
        {
          gradePercent: s.grade,
          speedMs: r.state.speedMs,
          // Élastique autour du joueur : on ralentit devant lui, on accélère derrière (sortie solo).
          groupPaceWkg: this.paceWkg * (1 - THREE.MathUtils.clamp((r.state.distM - player.distM - 4) / 50, -0.3, 0.45)),
          gapAheadM: ahead ? ahead.distM - r.state.distM - 1.8 : Infinity,
          speedAheadMs: ahead?.speedMs ?? r.state.speedMs,
          ...(ahead ? { lateralAheadM: ahead.lateral - r.lateral } : {}),
          positionInGroup: rank,
          groupSize: this.riders.length + 1,
          cdaFactor: 1 - r.draft,
          env,
        },
        dt,
      );
      r.watts = out.watts;
      r.cadence = out.cadence;
      r.pose = r.poseCtl.update({ watts: out.watts, cadence: out.cadence, gradePercent: s.grade, ftpWatts: r.ftp, speedMs: r.state.speedMs }, dt);
      stepRider(r.state, { watts: out.watts, gradePercent: s.grade, params: r.ai.params, env, cdaFactor: 1 - r.draft }, dt);
      const half = this.track.route.roadWidthM / 2 - 0.5;
      const targetLat = THREE.MathUtils.clamp((ahead?.lateral ?? -1) + out.lateralTargetM, -half, half);
      r.lateral += (targetLat - r.lateral) * Math.min(1, dt * 0.8);
    });
    return factors[0] ?? 0;
  }

  /** Place les avatars ; les coureurs lointains ne sont pas animés (économie). */
  render(dt: number, camera: THREE.Camera): void {
    for (const r of this.riders) {
      const p = this.track.positionAt(r.state.distM, r.lateral, this.sample);
      r.avatar.root.position.set(p.x, p.y + 0.06, p.z);
      r.avatar.root.rotation.set(0, 0, 0);
      r.avatar.root.rotateY(Math.atan2(p.dirX, p.dirZ));
      r.avatar.root.rotateX(-Math.atan(p.grade / 100));
      const dist = camera.position.distanceTo(r.avatar.root.position);
      r.avatar.root.visible = dist < 600;
      if (dist < 250) r.avatar.update(dt, r.cadence, r.state.speedMs, r.pose);
      r.label.position.set(p.x, p.y + 2.15, p.z);
      r.label.visible = dist > 7 && dist < 150;
    }
  }

  dispose(): void {
    for (const r of this.riders) this.scene.remove(r.avatar.root, r.label);
  }
}
