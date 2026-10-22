import * as THREE from 'three/webgpu';
import { AiRider, AI_PROFILES, DraftCalculator, PoseController, createRiderState, paramsFromBike, stepRider, airDensity, type AiProfileName, type RiderState } from '@allezrobert/physics';
import { DEFAULT_BIKE, DEFAULT_LOOK, type AvatarLook, type RouteTrack } from '@allezrobert/shared';
import { createAvatar, type RiderAvatarLike } from '../rider/gltfAvatar.ts';
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
  avatar: RiderAvatarLike;
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
  /**
   * Équipiers (idée « rouler seul en semaine ») : allure imposée en % de la FTP du joueur,
   * réglable en sortie ; null = le groupe suit l'allure du joueur.
   */
  paceFtpPct: number | null = null;
  /** Ordre « ralentissez » : allure réduite jusqu'à cet instant (s de sortie). */
  private slowUntil = 0;
  private time = 0;
  /** Équipier attendu (lâché) — pour l'affichage. */
  waitingFor: string | null = null;
  onWait?: (name: string | null) => void;

  /** Ordre « ralentissez » : −15 % pendant une minute. */
  slowDown(): void {
    this.slowUntil = this.time + 60;
  }
  private readonly sample = { x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, grade: 0, d: 0 };

  constructor(scene: THREE.Scene, track: RouteTrack, count: number, startDistM: number, ftpRef: number) {
    this.scene = scene;
    this.track = track;
    const r = rng(42);
    for (let i = 0; i < count; i++) {
      const massKg = 58 + r() * 30;
      // FTP de chaque IA autour du niveau choisi (± 10 %).
      const ftp = Math.round(ftpRef * (0.9 + r() * 0.2));
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
      const avatar = createAvatar(look);
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
        lateral: ((i % 3) - 1) * 0.9 + 1.0,
        ai: new AiRider({ id: `ai-${i}`, profile: PROFILES[i % PROFILES.length] as AiProfileName, ftpWatts: ftp, params, riderMassKg: massKg, seed: i * 7919, aggressiveness: 0.35 }),
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
  update(dt: number, player: { distM: number; lateral: number; speedMs: number; watts: number; massKg: number; ftpWatts?: number; reversed?: boolean }): number {
    if (!this.riders.length) return 0;
    // Joueur à contresens (demi-tour pour aller chercher quelqu'un) : le groupe continue à son
    // allure, sans l'attendre ni l'abriter ; tout reprend quand il refait demi-tour.
    if (player.reversed) return this.rideOn(dt);
    this.time += dt;
    // Allure : % de FTP imposé (équipiers) ou W/kg du joueur lissé sur ~20 s (le groupe roule « avec » lui).
    const target = this.paceFtpPct !== null && player.ftpWatts ? (player.ftpWatts * this.paceFtpPct) / Math.max(player.massKg, 1) : player.watts / Math.max(player.massKg, 1);
    this.paceWkg += (Math.min(Math.max(target, 1.2), 5.5) - this.paceWkg) * Math.min(1, dt / (this.paceFtpPct !== null ? 6 : 20));
    // Équipier lâché (> 60 m derrière le joueur) : le groupe lève le pied pour l'attendre.
    const dropped = this.riders.filter((r) => player.distM - r.state.distM > 60).sort((a, b) => a.state.distM - b.state.distM)[0];
    const waiting = dropped?.name ?? null;
    if (waiting !== this.waitingFor) {
      this.waitingFor = waiting;
      this.onWait?.(waiting);
    }
    const easing = (this.time < this.slowUntil ? 0.85 : 1) * (waiting ? 0.85 : 1);

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
          groupPaceWkg: this.paceWkg * easing * (1 - THREE.MathUtils.clamp((r.state.distM - player.distM - 4) / 50, -0.3, 0.45)),
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
      // En solo, personne ne file seul devant : au-delà de 40 m d'avance, l'équipier attend le groupe.
      const leadM = r.state.distM - player.distM;
      if (leadM > 40) r.watts = Math.min(r.watts, this.paceWkg * r.massKg * Math.max(0.2, 0.7 - (leadM - 40) / 200));
      r.cadence = out.cadence;
      r.pose = r.poseCtl.update({ watts: out.watts, cadence: out.cadence, gradePercent: s.grade, ftpWatts: r.ftp, speedMs: r.state.speedMs }, dt);
      stepRider(r.state, { watts: r.watts, gradePercent: s.grade, params: r.ai.params, env, cdaFactor: 1 - r.draft }, dt);
      const half = this.track.route.roadWidthM / 2 - 0.5;
      const targetLat = THREE.MathUtils.clamp((ahead?.lateral ?? 1) + out.lateralTargetM, -half, half);
      r.lateral += (targetLat - r.lateral) * Math.min(1, dt * 0.8);
    });
    return factors[0] ?? 0;
  }

  /** Le groupe roule seul, à l'allure courante (joueur à contresens). */
  private rideOn(dt: number): number {
    this.time += dt;
    const all = this.riders.map((r) => ({ distM: r.state.distM, lateralM: r.lateral, speedMs: r.state.speedMs }));
    const factors = this.draft.compute(all);
    const order = [...this.riders].sort((a, b) => b.state.distM - a.state.distM);
    order.forEach((r, rank) => {
      const i = this.riders.indexOf(r);
      r.draft = factors[i] ?? 0;
      const s = this.track.sample(r.state.distM, this.sample);
      const ahead = order[rank - 1];
      const env = { airDensity: airDensity(s.y, 14), windSpeedMs: 0 };
      const out = r.ai.update(
        {
          gradePercent: s.grade,
          speedMs: r.state.speedMs,
          groupPaceWkg: this.paceWkg,
          gapAheadM: ahead ? ahead.state.distM - r.state.distM - 1.8 : Infinity,
          speedAheadMs: ahead?.state.speedMs ?? r.state.speedMs,
          ...(ahead ? { lateralAheadM: ahead.lateral - r.lateral } : {}),
          positionInGroup: rank,
          groupSize: this.riders.length,
          cdaFactor: 1 - r.draft,
          env,
        },
        dt,
      );
      r.watts = out.watts;
      r.cadence = out.cadence;
      r.pose = r.poseCtl.update({ watts: out.watts, cadence: out.cadence, gradePercent: s.grade, ftpWatts: r.ftp, speedMs: r.state.speedMs }, dt);
      stepRider(r.state, { watts: r.watts, gradePercent: s.grade, params: r.ai.params, env, cdaFactor: 1 - r.draft }, dt);
    });
    return 0;
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
      // Ombres portées seulement pour les coureurs proches (coût des cascades d'ombre).
      r.avatar.setShadows(dist < 40);
      r.label.position.set(p.x, p.y + 2.15, p.z);
      r.label.visible = dist > 7 && dist < 150;
    }
  }

  dispose(): void {
    for (const r of this.riders) this.scene.remove(r.avatar.root, r.label);
  }
}
