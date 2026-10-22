import * as THREE from 'three/webgpu';
import type { AvatarLook, RouteTrack } from '@allezrobert/shared';
import { DEFAULT_LOOK } from '@allezrobert/shared';
import { createAvatar, type RiderAvatarLike } from '../rider/gltfAvatar.ts';
import { crowdBike } from '../rider/bikes.ts';
import { sunDirection } from '../world/environment.ts';
import { splatAt } from '../world/splat.ts';
import type { World } from '../world/world.ts';
import type { Engine } from '../engine/renderer.ts';
import type { Settings } from './settings.ts';

/**
 * Image d'accueil : une vue fixe du vrai monde, façon photo de sortie club — route étroite
 * entre les champs, soleil bas du matin à contre-jour, un petit groupe qui arrive face à
 * l'objectif (le coureur du joueur en tête). Rendue une fois (puis au redimensionnement),
 * rien ne bouge derrière le menu.
 */

/** Heure de la photo : soleil bas et doré, quelle que soit l'heure choisie pour rouler. */
export const POSTER_HOUR = 9;

/** Endroits retenus à la main par itinéraire (abscisse en m) ; sinon recherche automatique. */
const POSTER_D: Record<string, number> = {};

interface Spot {
  d: number;
  score: number;
}

const _s = { x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, grade: 0, d: 0 };

/**
 * Pré-sélection géométrique : la route doit être droite et plate sur les 250 m que voit
 * l'objectif, et le soleil doit se trouver dans le cadre, un peu sur le côté (contre-jour).
 */
export function geometricSpots(track: RouteTrack, season: Settings['season'], max = 8): Spot[] {
  const sun = sunDirection(POSTER_HOUR, season);
  const sunAz = Math.atan2(sun.x, sun.z);
  const spots: Spot[] = [];
  const L = track.length;
  for (let d = 300; d < L - 60; d += 20) {
    const p = track.sample(d, { ..._s });
    // L'objectif regarde vers l'arrière (les coureurs arrivent vers lui).
    const view = Math.atan2(-p.dirX, -p.dirZ);
    let maxTurn = 0;
    let maxGrade = 0;
    for (let k = -250; k <= 30; k += 10) {
      const q = track.sample(d + k, _s);
      const turn = Math.abs(Math.atan2(p.dirX * q.dirZ - p.dirZ * q.dirX, p.dirX * q.dirX + p.dirZ * q.dirZ));
      maxTurn = Math.max(maxTurn, turn);
      maxGrade = Math.max(maxGrade, Math.abs(q.grade));
    }
    if (maxTurn > 0.12 || maxGrade > 4) continue;
    let off = Math.abs(sunAz - view);
    if (off > Math.PI) off = 2 * Math.PI - off;
    // Idéal : soleil à ~25° de l'axe (dans le coin du cadre) ; pénalité au-delà de 50°.
    const sunScore = off < 0.9 ? 1 - Math.abs(off - 0.45) / 0.9 : -1;
    const score = sunScore * 2 - maxTurn * 6 - maxGrade * 0.15;
    spots.push({ d, score });
  }
  spots.sort((a, b) => b.score - a.score);
  // Points espacés d'au moins 400 m.
  const out: Spot[] = [];
  for (const s of spots) {
    if (out.every((o) => Math.abs(o.d - s.d) > 400)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** Ouverture du paysage autour d'un point (tuiles chargées) : champs et prés, peu de forêt et de bâti. */
export function openness(world: World, track: RouteTrack, d: number): number {
  let field = 0;
  let forest = 0;
  let urban = 0;
  let n = 0;
  for (let k = -220; k <= 20; k += 20) {
    const p = track.sample(d + k, _s);
    for (const lat of [-35, -15, 15, 35]) {
      const x = p.x + p.dirZ * lat;
      const z = p.z - p.dirX * lat;
      const tile = world.terrain.getTile(...world.terrain.tileCoord(x, z));
      if (!tile) continue;
      field += splatAt(tile, 1, x, z) + splatAt(tile, 2, x, z);
      forest += splatAt(tile, 0, x, z);
      urban += splatAt(tile, 4, x, z);
      n++;
    }
  }
  if (!n) return -10;
  return (field - forest * 1.5 - urban * 3) / n;
}

/** Endroit de la photo : table manuelle, sinon meilleur compromis géométrie + paysage ouvert. */
export async function choosePosterSpot(world: World, track: RouteTrack, season: Settings['season']): Promise<number> {
  const manual = POSTER_D[track.route.id];
  if (manual !== undefined) return manual;
  const cached = Number(localStorage.getItem(`ar.poster.${track.route.id}`));
  if (cached) return cached;
  const spots = geometricSpots(track, season, 5);
  let best = spots[0]?.d ?? 0;
  let bestScore = -Infinity;
  for (const s of spots) {
    const p = track.sample(s.d, _s);
    await world.preload(new THREE.Vector3(p.x, p.y, p.z));
    const score = s.score + openness(world, track, s.d) * 4;
    if (score > bestScore) {
      bestScore = score;
      best = s.d;
    }
  }
  localStorage.setItem(`ar.poster.${track.route.id}`, String(best));
  return best;
}

/** Vues du garage autour du coureur du joueur (repère du vélo : +z vers l'avant, y en haut). */
export type GarageView = '3q' | 'side' | 'front' | 'back' | 'bike' | 'cockpit' | 'face';
const GARAGE_VIEWS: Record<GarageView, { cam: [number, number, number]; look: [number, number, number]; fov: number }> = {
  '3q': { cam: [2.3, 1.55, 2.7], look: [0, 0.95, 0.15], fov: 34 },
  side: { cam: [3.6, 1.05, 0.25], look: [0, 0.85, 0.25], fov: 34 },
  front: { cam: [0.35, 1.35, 3.9], look: [0, 1.0, 0], fov: 32 },
  back: { cam: [-0.4, 1.5, -3.8], look: [0, 1.0, 0.1], fov: 32 },
  bike: { cam: [2.1, 0.7, 0.35], look: [0, 0.5, 0.2], fov: 36 },
  cockpit: { cam: [0.75, 1.45, 1.35], look: [0, 1.0, 0.5], fov: 36 },
  // Éditeur de visage : gros plan de trois quarts sur la tête.
  face: { cam: [0.75, 1.6, 2.0], look: [0, 1.38, 0.3], fov: 22 },
};

const PALETTE = ['#d7f205', '#111418', '#1e5bd8', '#d7f205', '#2b2f36', '#e8ecf0', '#c0392b', '#111418'];

/** Groupe figé : paires de front, le coureur du joueur en tête à droite, puis quelques retardataires au loin. */
export class PosterScene {
  private readonly riders: RiderAvatarLike[] = [];
  private readonly group = new THREE.Group();
  private savedFov = 0;
  d = 0;
  /** Cadrage courant : photo du groupe, ou une vue du garage avec rotation (rad) autour du coureur. */
  view: 'poster' | GarageView = 'poster';
  yaw = 0;

  constructor(
    private readonly engine: Engine,
    private readonly world: World,
    private readonly track: RouteTrack,
  ) {}

  build(playerLook: AvatarLook): void {
    this.clear();
    // [recul par rapport à la tête (m), décalage latéral (m), maillot]
    const slots: Array<[number, number]> = [
      [0, 1.9],
      [0.4, 0.8],
      [2.6, 1.6],
      [3.1, 0.6],
      [5.4, 1.2],
      [24, 1.4],
      [31, 0.9],
      [52, 1.3],
    ];
    slots.forEach(([back, lat], i) => {
      const look: AvatarLook =
        i === 0
          ? playerLook
          : {
              ...DEFAULT_LOOK,
              jersey: PALETTE[i % PALETTE.length] as string,
              jerseyAccent: PALETTE[(i + 3) % PALETTE.length] as string,
              bike: ['#1d1d1f', '#c0392b', '#e8ecf0', '#2c3e50', '#16a085'][i % 5] as string,
              bikeModel: crowdBike(i),
              skin: ['#f1c27d', '#e0ac69', '#c68642', '#ffdbac'][i % 4] as string,
              helmet: ['#f4f4f4', '#111111', '#1e5bd8'][i % 3] as string,
            };
      const a = createAvatar(look);
      a.setShadows(back < 10);
      // Coup de pédale figé à des angles différents (quelques-uns en roue libre).
      a.update(0.13 * i + 0.05, 82, 8, i === 2 || i === 6 ? 'coasting' : 'seated');
      a.root.userData.slot = [back, lat];
      this.group.add(a.root);
      this.riders.push(a);
    });
    this.engine.scene.add(this.group);
  }

  /** Place le groupe et la caméra à l'abscisse d ; renvoie le point de mise au point. */
  place(d: number): THREE.Vector3 {
    this.d = d;
    const p = this.track.sample(d, { ..._s });
    for (const a of this.riders) {
      const [back, lat] = a.root.userData.slot as [number, number];
      const q = this.track.positionAt(d - back, lat);
      a.root.position.set(q.x, q.y + 0.06, q.z);
      a.root.rotation.set(0, 0, 0);
      a.root.rotateY(Math.atan2(q.dirX, q.dirZ));
      a.root.rotateX(-Math.atan(q.grade / 100));
    }
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  /** Place la caméra selon la vue courante (à rappeler après redimensionnement). */
  frame(): void {
    const camera = this.engine.camera;
    if (!this.savedFov) this.savedFov = camera.fov;
    // Le garage ne montre que le coureur du joueur.
    this.riders.forEach((a, i) => (a.root.visible = this.view === 'poster' || i === 0));
    if (this.view === 'poster') {
      // Objectif à 9 m devant la tête, côté axe de la route, à hauteur d'homme, regard vers le groupe.
      const cam = this.track.positionAt(this.d + 9, -0.4);
      const target = this.track.positionAt(this.d - 6, 1.2);
      camera.position.set(cam.x, cam.y + 1.55, cam.z);
      camera.lookAt(target.x, target.y + 1.25, target.z);
      camera.fov = camera.aspect > 1.2 ? 40 : 58;
    } else {
      const me = this.riders[0];
      if (!me) return;
      const v = GARAGE_VIEWS[this.view];
      const c = Math.cos(this.yaw);
      const s = Math.sin(this.yaw);
      const off = new THREE.Vector3(v.cam[0] * c + v.cam[2] * s, v.cam[1], -v.cam[0] * s + v.cam[2] * c);
      me.root.updateMatrixWorld(true);
      camera.position.copy(me.root.localToWorld(off));
      camera.lookAt(me.root.localToWorld(new THREE.Vector3(...v.look)));
      // Écran large : le coureur est décalé à droite du panneau de gauche, on élargit un peu.
      camera.fov = camera.aspect > 1.2 ? v.fov : v.fov * 1.5;
    }
    camera.updateProjectionMatrix();
  }

  setView(view: 'poster' | GarageView, yaw = 0): void {
    this.view = view;
    this.yaw = yaw;
  }

  /** Tenue du coureur du joueur mise à jour sur place (éditeur de visage : pas de reconstruction). */
  setPlayerLook(look: AvatarLook, bareHead = false): void {
    const a = this.riders[0];
    if (!a) return;
    a.setLook(look);
    a.setBareHead?.(bareHead);
  }

  clear(): void {
    this.engine.scene.remove(this.group);
    this.group.clear();
    this.riders.length = 0;
  }

  /** Fin de l'accueil : retire le groupe et rend la focale d'origine. */
  dispose(): void {
    this.clear();
    if (this.savedFov) {
      this.engine.camera.fov = this.savedFov;
      this.engine.camera.updateProjectionMatrix();
    }
  }
}
