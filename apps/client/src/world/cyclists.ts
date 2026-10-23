import * as THREE from 'three/webgpu';
import { DEFAULT_BIKE, DEFAULT_LOOK, type AvatarLook, type RouteTrack } from '@allezrobert/shared';
import { draftReductionSingle, paramsFromBike, steadyStateSpeed, type RiderPhysicsParams } from '@allezrobert/physics';
import { createAvatar, type RiderAvatarLike } from '../rider/gltfAvatar.ts';
import { crowdShoes } from '../rider/shoeLook.ts';
import { rng } from '../engine/noise.ts';

/** Cycliste d'ambiance : il roule sur la même route, dans un sens ou dans l'autre. */
interface Cyclist {
  avatar: RiderAvatarLike;
  /** Distance « déroulée » sur l'itinéraire (m). */
  d: number;
  /** +1 : même sens que le joueur ; −1 : en face. */
  sens: 1 | -1;
  /** Puissance de croisière (W) : un cycliste plus lent qu'on double ou plus rapide qui double. */
  watts: number;
  params: RiderPhysicsParams;
  speed: number;
  lateral: number;
  cadence: number;
}

const JERSEYS = ['#264653', '#e76f51', '#2a9d8f', '#e9c46a', '#d62828', '#3a86ff', '#8338ec', '#fb5607'];
const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];

/**
 * Cyclistes virtuels croisés dans les deux sens (idée NCT Ride) : deux en face, un plus lent
 * devant (qu'on double), un plus rapide derrière (qui nous double). Vitesse calculée par la même
 * physique que le joueur à partir de leur puissance et de la pente ; recyclés hors de vue comme
 * le trafic. On peut prendre la roue de ceux qui vont dans le même sens.
 */
export class AmbientCyclists {
  private readonly list: Cyclist[] = [];
  private readonly track: RouteTrack;
  private readonly r = rng(913);
  private readonly sample = { x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, grade: 0, d: 0 };

  constructor(scene: THREE.Scene, track: RouteTrack, startDistM: number) {
    this.track = track;
    const kinds: Array<{ sens: 1 | -1; watts: number; d: number }> = [
      // Deux seulement (un par sens) : chaque cycliste est un avatar animé complet, coûteux.
      { sens: -1, watts: 170, d: 420 },
      { sens: 1, watts: 290, d: -220 },
    ];
    kinds.forEach((k, i) => {
      const jersey = JERSEYS[i % JERSEYS.length] as string;
      const look: AvatarLook = {
        ...DEFAULT_LOOK,
        jersey,
        jerseyAccent: JERSEYS[(i + 3) % JERSEYS.length] as string,
        skin: SKINS[i % SKINS.length] as string,
        helmet: ['#f4f4f4', '#111111', jersey][i % 3] as string,
        bike: ['#1d1d1f', '#c0392b', '#f4f4f4', '#2c3e50'][i % 4] as string,
        build: this.r(),
        ...crowdShoes(i + 3),
        heightCm: 160 + ((i * 17) % 36),
      };
      const avatar = createAvatar(look);
      scene.add(avatar.root);
      const mass = 62 + this.r() * 25;
      this.list.push({ avatar, d: startDistM + k.d, sens: k.sens, watts: k.watts, params: paramsFromBike(mass, DEFAULT_BIKE), speed: 6, lateral: this.laneOf(k.sens), cadence: 85 });
    });
  }

  /** Voie de droite dans son sens de marche (repère du joueur : positif = à droite). */
  private laneOf(sens: 1 | -1): number {
    const half = this.track.route.roadWidthM / 2;
    return sens > 0 ? Math.max(0.6, half - 0.7) : -Math.max(0.6, half - 0.7);
  }

  /**
   * @param player distance et décalage du joueur
   * @param camera pour les niveaux de détail (animation et ombres seulement près de la caméra)
   * @returns l'aspiration dont profite le joueur derrière un cycliste qui va dans son sens
   */
  update(dt: number, player: { distM: number; lateral: number; speedMs: number }, camera: THREE.Camera): number {
    const L = this.track.length;
    const loop = this.track.route.loop;
    let draft = 0;
    for (const c of this.list) {
      const rel = c.d - player.distM;
      // Recyclage hors de vue : en face, il revient loin devant ; dans le même sens, le lent repart
      // devant et le rapide derrière.
      if (rel > 900 || rel < -600) {
        if (c.sens < 0) c.d = player.distM + 500 + this.r() * 500;
        else if (c.watts < 200) c.d = player.distM + 250 + this.r() * 300;
        else c.d = player.distM - 250 - this.r() * 150;
        c.lateral = this.laneOf(c.sens);
        c.watts *= 0.85 + this.r() * 0.3;
        c.watts = Math.min(320, Math.max(100, c.watts));
      }
      const s = this.track.sample(loop ? ((c.d % L) + L) % L : Math.min(Math.max(c.d, 0), L), this.sample);
      const grade = s.grade * c.sens;
      // Roue libre dans les descentes raides, sinon puissance de croisière.
      const watts = grade < -4 ? 0 : c.watts;
      const target = steadyStateSpeed(watts, grade, c.params);
      c.speed += (target - c.speed) * Math.min(1, dt * 0.5);
      // Même sens : on s'écarte pour doubler le joueur s'il roule moins vite juste devant.
      let lateralTarget = this.laneOf(c.sens);
      if (c.sens > 0 && rel < 0 && rel > -12 && c.speed > player.speedMs + 0.3 && Math.abs(player.lateral - c.lateral) < 1.2) lateralTarget = player.lateral - 1.4;
      c.lateral += (lateralTarget - c.lateral) * Math.min(1, dt * 1.2);
      c.d += c.sens * c.speed * dt;
      c.cadence = watts > 0 ? 82 + (c.watts - 150) / 20 : 0;

      const outside = !loop && (c.d < 0 || c.d > L);
      const p = this.track.positionAt(loop ? ((c.d % L) + L) % L : Math.min(Math.max(c.d, 0), L), c.lateral, this.sample);
      const a = c.avatar;
      a.root.position.set(p.x, p.y + 0.06, p.z);
      a.root.rotation.set(0, 0, 0);
      a.root.rotateY(Math.atan2(p.dirX, p.dirZ) + (c.sens < 0 ? Math.PI : 0));
      a.root.rotateX(-Math.atan(p.grade / 100) * c.sens);
      const dist = camera.position.distanceTo(a.root.position);
      a.root.visible = !outside && dist < 500;
      if (a.root.visible && dist < 200) a.update(dt, c.cadence, c.speed, watts > 0 ? 'seated' : 'coasting');
      a.setShadows(dist < 35);

      // Aspiration : derrière un cycliste qui roule dans le même sens.
      if (c.sens > 0 && !outside) {
        const gap = c.d - player.distM - 1.75;
        draft = Math.max(draft, draftReductionSingle(gap, c.lateral - player.lateral));
      }
    }
    return draft;
  }

  dispose(scene: THREE.Scene): void {
    for (const c of this.list) scene.remove(c.avatar.root);
  }
}
