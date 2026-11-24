import * as THREE from 'three/webgpu';
import { DEFAULT_BIKE, DEFAULT_LOOK, type AvatarLook, type RouteTrack } from '@allezrobert/shared';
import { KEEP_RIGHT_M, draftReductionSingle, facingWithin, oncomingLookM, paramsFromBike, rightLaneM, sharedRoadCorridor, steadyStateSpeed, type LaneBody, type RouteBuildingCollision, type RiderPhysicsParams } from '@allezrobert/physics';
import { createAvatar, type RiderAvatarLike } from '../rider/gltfAvatar.ts';
import { brakeForCorners, cornerGrip } from '../game/cornerBrake.ts';
import { crowdShoes } from '../rider/shoeLook.ts';
import { crowdBike } from '../rider/bikes.ts';
import { rng } from '../engine/noise.ts';
import { BIKE_FRONT_M, BIKE_REAR_M, roadPose, type RoadPose } from './roadHeight.ts';
import { crowdV3 } from '../game/v3Crowd.ts';
import { AnimBudget } from '../game/animBudget.ts';
import { skipHiddenMatrixUpdates } from '../game/hiddenMatrices.ts';
import { SMALL_PARTS_CULL, cullSmallParts } from '../game/smallParts.ts';
import { disposeRiderMerge, updateRiderMerge } from '../game/riderMerge.ts';
import { disposeRiderLight, needsLightBuild, updateRiderLight } from '../game/riderLight.ts';
import { applyRiderShadows, disposeRiderShadows } from '../game/riderShadows.ts';
import { castsShadow, detailGroup, lightColorOf } from '../game/riderDetail.ts';
import { LATERAL_CRUISE, LATERAL_SPRING, LATERAL_URGENT, stepLateral, syncLateral, type LateralMotion } from '../game/lateralSpring.ts';
import type { V3Visual } from '../v3/visuals.ts';

/** Adhérence des IA en virage (enrobé sec), voir cornerBrake.ts. */
const CORNER_GRIP = cornerGrip(0);

const _pose: RoadPose = { y: 0, pitch: 0 };

/** Un cycliste d'ambiance : seul, ou membre d'un groupe qui roule ensemble. */
interface Member {
  avatar: RiderAvatarLike;
  /** Style V3 : coureur et vélo V3 montés sur l'avatar (v3Crowd.ts). */
  v3?: V3Visual;
  /** Décalage le long de la route par rapport au meneur (m, ≤ 0 : derrière). */
  off: number;
  /** Décalage latéral par rapport au groupe (m). */
  latOff: number;
  /** Décalage de cadence : chacun a son coup de pédale. */
  cadenceOff: number;
  /** Budget d'animation : une image sur 2 à 4 au-delà de 40 m (animBudget.ts). */
  anim: AnimBudget;
}

/** Cycliste ou groupe d'ambiance : il roule sur la même route, dans un sens ou dans l'autre. */
interface Unit {
  members: Member[];
  /** Distance « déroulée » du meneur sur l'itinéraire (m). */
  d: number;
  /** +1 : même sens que le joueur ; −1 : en face. */
  sens: 1 | -1;
  /** Puissance de croisière (W) : un cycliste plus lent qu'on double ou plus rapide qui double. */
  watts: number;
  wattsMin: number;
  wattsMax: number;
  params: RiderPhysicsParams;
  speed: number;
  lateral: number;
  /** Écart des duos côte à côte (0 à 1 × `latOff`) : resserré quand sa moitié de chaussée est trop étroite pour deux. */
  latScale: number;
  cadence: number;
  /** Longueur du groupe (m), pour ne pas le faire apparaître à vue. */
  length: number;
  id: string;
  /** Niveau (index de LEVELS) et masse (kg) : affichés dans « À proximité ». */
  level: number;
  massKg: number;
  color: string;
  /** Kilomètres déjà roulés au départ (simulés d'après le niveau) et parcourus depuis. */
  kmBase: number;
  travelledM: number;
}

const JERSEYS = ['#264653', '#e76f51', '#2a9d8f', '#e9c46a', '#d62828', '#3a86ff', '#8338ec', '#fb5607'];
const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
/** Kilomètres déjà roulés quand on les croise, selon le niveau (simulé). */
const KM_BASE: ReadonlyArray<readonly [number, number]> = [[3, 22], [12, 48], [25, 75], [40, 115]];
const HELMETS = ['#f4f4f4', '#111111', '#c1121f', '#1d4ed8', '#fde047', '#15803d', '#94a3b8', '#f97316'];
/** Maillots de club : couleur principale, accent. */
const CLUBS: Array<[string, string]> = [
  ['#c1121f', '#ffffff'],
  ['#1d4ed8', '#fde047'],
  ['#15803d', '#ffffff'],
  ['#111827', '#f97316'],
  ['#f8fafc', '#dc2626'],
  ['#7c3aed', '#fde047'],
  ['#0e7490', '#f1f5f9'],
];

/** Niveaux : du promeneur au coureur. Puissance de croisière (W) et part dans la population. */
const LEVELS = [
  { name: 'loisir', w: [75, 125], weight: 3, mass: [70, 92] },
  { name: 'régulier', w: [140, 200], weight: 4, mass: [62, 85] },
  { name: 'sportif', w: [215, 275], weight: 3, mass: [60, 80] },
  { name: 'pro', w: [300, 380], weight: 1.5, mass: [58, 72] },
] as const;

/**
 * Cyclistes virtuels croisés dans les deux sens (idée NCT Ride). Sur route : deux en face et deux
 * dans le sens du joueur, un lent devant (qu'on double), un rapide derrière (qui nous double).
 * Sur une piste cyclable (Longchamp, Vincennes…), un vrai trafic de loisir à pro : cyclistes seuls
 * et groupes de club en maillots assortis, à toutes les allures, qu'on rattrape ou qui nous
 * dépassent. Vitesse calculée par la même physique que le joueur à partir de la puissance et de
 * la pente ; recyclés hors de vue comme le trafic. On peut prendre la roue de ceux qui vont dans
 * le même sens.
 */
export class AmbientCyclists {
  /** Distance (m) en dessous de laquelle un cycliste croisé projette une ombre (0 = jamais). */
  shadowRange = 35;
  /** Altitude du sol (m) en un point : évite d'enfoncer les roues quand le bas-côté est plus haut que l'axe de la route. */
  heightAt: ((x: number, z: number) => number) | null = null;
  private readonly units: Unit[] = [];
  private readonly track: RouteTrack;
  private readonly r = rng(913);
  private readonly sample = { x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, grade: 0, d: 0 };
  /** Piste cyclable : chaussée étroite. */
  private readonly path: boolean;
  private serial = 0;

  /** Racines des cyclistes affichés (fondu des coureurs proches, game/nearFade.ts). */
  *roots(): Iterable<THREE.Object3D> {
    for (const u of this.units) for (const m of u.members) yield m.avatar.root;
  }

  /** Couloir praticable : la chaussée réelle, ou celle du pilote de collision (façades comprises). */
  private corridor: RouteBuildingCollision = sharedRoadCorridor();

  /** Pilote de collision actif : les cyclistes d'ambiance restent aussi hors des façades. */
  useCorridor(corridor: RouteBuildingCollision): void {
    this.corridor = corridor;
  }

  constructor(scene: THREE.Scene, track: RouteTrack, startDistM: number) {
    this.track = track;
    this.path = track.route.roadWidthM < 4.8;
    if (!this.path) {
      // Deux seulement (un par sens) : chaque cycliste est un avatar animé complet, coûteux.
      this.addUnit(scene, startDistM + 420, -1, { level: 1, size: 1, watts: 170 });
      this.addUnit(scene, startDistM - 220, 1, { level: 2, size: 1, watts: 290 });
      return;
    }
    // Piste cyclable : une quinzaine d'avatars au plus, répartis des deux côtés du joueur.
    let budget = 15;
    const plan: Array<{ sens: 1 | -1; d: number; size: number }> = [
      { sens: -1, d: 180, size: 4 },
      { sens: 1, d: 120, size: 1 },
      { sens: -1, d: 420, size: 1 },
      { sens: 1, d: -160, size: 5 },
      { sens: -1, d: 650, size: 3 },
      { sens: 1, d: 330, size: 2 },
      { sens: 1, d: -380, size: 1 },
      { sens: -1, d: 880, size: 1 },
    ];
    for (const p of plan) {
      if (budget < p.size) continue;
      budget -= p.size;
      this.addUnit(scene, startDistM + p.d, p.sens, { size: p.size });
    }
  }

  /** Tire un niveau selon les parts de la population. */
  private pickLevel(): number {
    const total = LEVELS.reduce((s, l) => s + l.weight, 0);
    let x = this.r() * total;
    for (let i = 0; i < LEVELS.length; i++) {
      x -= (LEVELS[i] as (typeof LEVELS)[number]).weight;
      if (x < 0) return i;
    }
    return 1;
  }

  private addUnit(scene: THREE.Scene, d: number, sens: 1 | -1, opt: { level?: number; size: number; watts?: number }): void {
    const li = opt.level ?? this.pickLevel();
    const lv = LEVELS[li] as (typeof LEVELS)[number];
    const watts = opt.watts ?? lv.w[0] + this.r() * (lv.w[1] - lv.w[0]);
    const club = opt.size > 1 || (this.path && this.r() < 0.12);
    // Un groupe de club : même maillot, même casque ; sinon chacun sa couleur.
    const kit = CLUBS[Math.floor(this.r() * CLUBS.length)] as [string, string];
    const pairs = !this.path && opt.size > 2 && li <= 1;
    const members: Member[] = [];
    let firstJersey = kit[0];
    let rowOff = 0;
    let lastRow = -1;
    for (let k = 0; k < opt.size; k++) {
      const i = this.serial++;
      const jersey = club ? kit[0] : (JERSEYS[Math.floor(this.r() * JERSEYS.length)] as string);
      if (k === 0) firstJersey = jersey;
      const look: AvatarLook = {
        ...DEFAULT_LOOK,
        jersey,
        jerseyAccent: club ? kit[1] : (JERSEYS[(i + 3) % JERSEYS.length] as string),
        skin: SKINS[Math.floor(this.r() * SKINS.length)] as string,
        // Même maillot dans un club ; casque, chaussures et vélo sont ceux de chacun.
        helmet: HELMETS[Math.floor(this.r() * HELMETS.length)] as string,
        bike: ['#1d1d1f', '#c0392b', '#f4f4f4', '#2c3e50', '#1d4ed8', '#15803d', '#e9c46a'][Math.floor(this.r() * 7)] as string,
        ...(crowdBike(Math.floor(this.r() * 1000)) ? { bikeModel: crowdBike(Math.floor(this.r() * 1000)) as string } : {}),
        build: this.r(),
        ...crowdShoes(Math.floor(this.r() * 1000)),
        heightCm: 160 + ((i * 17) % 36),
      };
      const avatar = createAvatar(look);
      scene.add(avatar.root);
      skipHiddenMatrixUpdates(avatar.root);
      // Loisir en duo côte à côte, club en file serrée (roue dans la roue au-delà de 25 km/h).
      const row = pairs ? Math.floor(k / 2) : k;
      // Le vélo fait 1,75 m : sous 2,1 m entre les centres, les roues se chevauchent. L'écart s'ajoute rang après rang
      // (un écart tiré pour chaque coureur puis multiplié par son rang pouvait rapprocher deux voisins sous 1,7 m).
      if (row !== lastRow) {
        const gap = li >= 2 ? 2.25 + this.r() * 0.35 : pairs ? 3.1 + this.r() * 0.5 : 2.9 + this.r() * 0.9;
        if (row > 0) rowOff += gap;
        lastRow = row;
      }
      const v3 = crowdV3(avatar, look, i, this.r() < 0.4);
      members.push({ avatar, ...(v3 ? { v3 } : {}), off: -rowOff, latOff: pairs && k % 2 ? -1.0 * sens : 0, cadenceOff: Math.round((this.r() - 0.5) * 8), anim: new AnimBudget(members.length + Math.floor(this.r() * 4)) });
    }
    const mass = lv.mass[0] + this.r() * (lv.mass[1] - lv.mass[0]);
    const length = Math.abs((members[members.length - 1] as Member).off);
    const kmRange = KM_BASE[li] ?? [10, 40];
    this.units.push({
      members,
      d,
      sens,
      watts,
      wattsMin: lv.w[0] * 0.9,
      wattsMax: lv.w[1] * 1.05,
      params: paramsFromBike(mass, DEFAULT_BIKE),
      speed: 6,
      lateral: this.laneOf(sens),
      latScale: 1,
      cadence: 85,
      length,
      id: `amb${this.units.length}`,
      level: li,
      massKg: mass,
      color: firstJersey,
      kmBase: kmRange[0] + this.r() * (kmRange[1] - kmRange[0]),
      travelledM: 0,
    });
  }

  /** Voie de droite dans son sens de marche (repère du joueur : positif = à droite) : au bord, comme le joueur ; ceux d'en face, au bord opposé. */
  private laneOf(sens: 1 | -1): number {
    const lane = rightLaneM(this.track.route.roadWidthM);
    return sens > 0 ? lane : -lane;
  }

  private readonly sameWay: LaneBody[] = [];
  private readonly bounds = { left: 0, right: 0 };

  /** Cyclistes qui vont dans le sens du joueur, un par membre de groupe : les IA du peloton les doublent sans les traverser. */
  sameWayBodies(): LaneBody[] {
    const out = this.sameWay;
    out.length = 0;
    for (const c of this.units) {
      if (c.sens < 0) continue;
      c.members.forEach((m, k) => out.push({ id: `${c.id}.${k}`, distM: c.d + m.off, lateralM: c.lateral + m.latOff * c.latScale, speedMs: c.speed }));
    }
    return out;
  }

  /**
   * Quelqu'un de ces cyclistes arrive en face de qui roule dans le sens `dir` (repère de l'itinéraire) à `distM` :
   * entre 8 m derrière et `rangeM` devant. Pour le joueur, qui reste alors sur sa moitié de la chaussée.
   */
  approaching(distM: number, dir: 1 | -1, rangeM: number): boolean {
    for (const c of this.units) {
      if (c.sens === dir) continue;
      for (const m of c.members) if (facingWithin((c.d + m.off - distM) * dir, rangeM)) return true;
    }
    return false;
  }

  /** Un cycliste de notre sens voit arriver en face un cycliste d'ambiance ou le joueur à contresens. */
  private facingFor(c: Unit, player: { distM: number }, playerDir: 1 | -1): boolean {
    if (c.sens < 0) return true;
    const range = oncomingLookM(c.speed);
    if (playerDir < 0 && facingWithin(player.distM - c.d, range)) return true;
    for (const o of this.units) {
      if (o.sens > 0) continue;
      for (const m of o.members) if (facingWithin(o.d + m.off - c.d, range)) return true;
    }
    return false;
  }

  /**
   * Plage permise au décalage du groupe : chaussée réelle `b`, membres côte à côte compris, puis, si `own`,
   * sa moitié de chaussée (lanes.ts). Si la chaussée ne laisse pas la marge, au plus près de son bord (la chaussée prime).
   */
  private range(c: Unit, b: { left: number; right: number }, own: boolean): [number, number] {
    let lo = -b.left, hi = b.right;
    for (const m of c.members) {
      lo = Math.max(lo, -b.left - m.latOff * c.latScale);
      hi = Math.min(hi, b.right - m.latOff * c.latScale);
    }
    if (lo > hi) return [(lo + hi) / 2, (lo + hi) / 2];
    const loC = lo, hiC = hi;
    if (own)
      for (const m of c.members) {
        if (c.sens < 0) hi = Math.min(hi, -KEEP_RIGHT_M - m.latOff * c.latScale);
        else lo = Math.max(lo, KEEP_RIGHT_M - m.latOff * c.latScale);
      }
    if (lo > hi) return c.sens < 0 ? [loC, loC] : [hiC, hiC];
    return [lo, hi];
  }

  /** Un cycliste vient en face entre `distM - 8` et `distM + rangeM` : la voie de gauche n'est pas libre pour doubler. */
  oncomingAhead(distM: number, rangeM: number): boolean {
    for (const c of this.units) {
      if (c.sens > 0) continue;
      for (const m of c.members) {
        const d = c.d + m.off - distM;
        if (d > -8 && d < rangeM) return true;
      }
    }
    return false;
  }

  private animFrame = 0;
  /** Vitesse latérale de chaque groupe de cyclistes (lateralSpring.ts). */
  private readonly latMotion = new WeakMap<object, LateralMotion>();
  /**
   * @param player distance et décalage du joueur
   * @param camera pour les niveaux de détail (animation et ombres seulement près de la caméra)
   * @param others autres coureurs qui vont dans le sens du joueur (équipiers IA) : on les double et on les croise sans les traverser
   * @param playerDir sens du joueur sur l'itinéraire (−1 après un demi-tour) : à contresens, il arrive en face de ceux de son sens d'origine
   * @returns l'aspiration dont profite le joueur derrière un cycliste qui va dans son sens
   */
  update(dt: number, player: { distM: number; lateral: number; speedMs: number }, camera: THREE.Camera, others: ReadonlyArray<{ distM: number; lateral: number; speedMs: number }> = [], playerDir: 1 | -1 = 1): number {
    this.animFrame++;
    const L = this.track.length;
    const loop = this.track.route.loop;
    let draft = 0;
    // Le joueur et les équipiers IA : tous sont à éviter ou à doubler de la même façon.
    const rivals = [player, ...others];
    for (const c of this.units) {
      const rel = c.d - player.distM;
      // Recyclage hors de vue : en face, il revient loin devant ; dans le même sens, le lent repart
      // devant et le rapide derrière. Sur piste, une nouvelle allure est tirée à chaque passage.
      if (rel > 900 || rel < -600 - c.length) {
        if (c.sens < 0) c.d = player.distM + 450 + this.r() * 500;
        else if (this.path ? c.watts < player.speedMs * 0 + this.medianWatts() : c.watts < 200) c.d = player.distM + 250 + this.r() * 300;
        else c.d = player.distM - 250 - c.length - this.r() * 200;
        c.lateral = this.laneOf(c.sens);
        c.watts *= 0.85 + this.r() * 0.3;
        c.watts = Math.min(this.path ? c.wattsMax : 320, Math.max(this.path ? c.wattsMin : 100, c.watts));
      }
      const s = this.track.sample(loop ? ((c.d % L) + L) % L : Math.min(Math.max(c.d, 0), L), this.sample);
      const grade = s.grade * c.sens;
      // Roue libre dans les descentes raides, sinon puissance de croisière.
      const watts = grade < -4 ? 0 : c.watts;
      const target = steadyStateSpeed(watts, grade, c.params);
      c.speed += (target - c.speed) * Math.min(1, dt * 0.5);
      // Même sens : on s'écarte pour doubler le joueur s'il roule moins vite juste devant.
      let lateralTarget = this.laneOf(c.sens);
      const gapNeeded = 4 + c.length;
      if (c.sens > 0)
        for (const p of rivals) {
          const behind = c.d - p.distM;
          if (behind < 0 && behind > -12 - c.length && c.speed > p.speedMs + 0.3 && Math.abs(p.lateral - c.lateral) < 1.2) lateralTarget = Math.min(lateralTarget, p.lateral - 1.4);
        }
      // Sur piste, on déboîte aussi pour doubler un autre cycliste plus lent dans le même sens.
      if (this.path) {
        for (const o of this.units) {
          if (o === c || o.sens !== c.sens) continue;
          const ahead = (o.d - c.d) * c.sens;
          if (ahead > 0 && ahead < 18 + gapNeeded && c.speed > o.speed + 0.4) lateralTarget = this.laneOf(c.sens) - c.sens * 1.3;
        }
      }
      // Un cycliste d'en face ne se rabat pas vers le milieu (pour doubler un autre) quand on arrive.
      if (c.sens < 0 && rivals.some((p) => Math.abs(c.d - p.distM) < 60 && Math.abs(lateralTarget - p.lateral) < 1.8)) lateralTarget = this.laneOf(c.sens);
      // Jamais à travers le joueur ni un équipier : un cycliste trop près (en long comme en large) s'écarte de lui,
      // de l'autre côté si le bord de la chaussée l'en empêche.
      let rate = 1.2;
      const edge = Math.max(0.5, this.track.route.roadWidthM / 2 - 0.25);
      avoid: for (const p of rivals) {
        for (const m of c.members) {
          const gap = c.d + m.off - p.distM;
          if (Math.abs(gap) > (c.sens < 0 ? 30 : 14)) continue;
          const cur = c.lateral + m.latOff * c.latScale - p.lateral;
          const sep = c.sens < 0 ? 1.4 : 1.0;
          if (Math.abs(cur) >= sep) continue;
          let dir = cur >= 0 ? 1 : -1;
          let t = p.lateral + dir * sep - m.latOff * c.latScale;
          if (Math.abs(t + m.latOff * c.latScale) > edge) {
            dir = -dir;
            t = p.lateral + dir * sep - m.latOff * c.latScale;
          }
          lateralTarget = Math.max(-edge - m.latOff * c.latScale, Math.min(edge - m.latOff * c.latScale, t));
          rate = 4;
          break avoid;
        }
      }
      // Chacun sa moitié de chaussée (lanes.ts) : ceux d'en face toujours, ceux de notre sens quand quelqu'un arrive
      // en face (pas de dépassement ni de duo qui déborde au milieu). Duo côte à côte resserré si la moitié est étroite.
      const b = this.corridor.steeringBounds(this.track, c.d, c.speed, c.sens, this.bounds);
      const own = this.facingFor(c, player, playerDir);
      const room = (c.sens < 0 ? b.left : b.right) - KEEP_RIGHT_M;
      const scaleGoal = own ? Math.min(1, Math.max(0, room)) : 1;
      c.latScale += (scaleGoal - c.latScale) * Math.min(1, dt * 2);
      const [ownLo, ownHi] = this.range(c, b, own);
      if (lateralTarget < ownLo || lateralTarget > ownHi) {
        lateralTarget = Math.max(ownLo, Math.min(ownHi, lateralTarget));
        if (c.lateral < ownLo - 0.05 || c.lateral > ownHi + 0.05) rate = 4;
      }
      // Ressort amorti à vitesse plafonnée (lateralSpring.ts) : écarts sans à-coup, plus vifs pour éviter quelqu'un.
      let motion = this.latMotion.get(c);
      if (!motion) this.latMotion.set(c, (motion = { v: 0 }));
      const tuning = rate >= 4 ? LATERAL_URGENT : LATERAL_CRUISE;
      const latBefore = c.lateral;
      c.lateral = LATERAL_SPRING ? stepLateral(motion, c.lateral, lateralTarget, dt, tuning) : c.lateral + (lateralTarget - c.lateral) * Math.min(1, dt * rate);
      // Rester sur la chaussée réelle du tronçon (pistes et rues étroites), membres côte à côte compris ; ceux d'en face
      // jamais sur la moitié du joueur (ceux de notre sens y reviennent par le ressort, sans saut).
      const [lo, hi] = this.range(c, b, c.sens < 0);
      c.lateral = Math.max(lo, Math.min(hi, c.lateral));
      syncLateral(motion, latBefore, c.lateral, dt, tuning);
      // Freinage avant les virages serrés, comme le joueur (cornerBrake.ts).
      c.speed = brakeForCorners(this.track, c.d, c.sens, c.speed, CORNER_GRIP, dt);
      c.d += c.sens * c.speed * dt;
      c.travelledM += c.speed * dt;
      c.cadence = watts > 0 ? Math.min(105, 74 + c.watts / 12) : 0;

      // Aspiration : derrière un cycliste qui roule dans le même sens (celui de queue du groupe).
      for (const m of c.members) {
        const dm = c.d + m.off;
        const outside = !loop && (dm < 0 || dm > L);
        const p = this.track.positionAt(loop ? ((dm % L) + L) % L : Math.min(Math.max(dm, 0), L), c.lateral + m.latOff * c.latScale, this.sample);
        const a = m.avatar;
        const ground = this.heightAt ? Math.max(p.y, this.heightAt(p.x, p.z)) : p.y;
        const yaw = Math.atan2(p.dirX, p.dirZ) + (c.sens < 0 ? Math.PI : 0);
        // Monde ouvert : roues sur la chaussée dessinée (roadHeight.ts) ; sinon au-dessus du sol (origine 5 cm plus
        // bas que celle du coureur, d'où + 0,11 au lieu de + 0,06).
        const onRoad = roadPose(p.x, p.z, Math.sin(yaw), Math.cos(yaw), ground + 0.06, Math.atan(p.grade / 100) * c.sens, BIKE_FRONT_M, BIKE_REAR_M, _pose);
        a.root.position.set(p.x, onRoad ? _pose.y + 0.05 : ground + 0.11, p.z);
        a.root.rotation.set(0, 0, 0);
        a.root.rotateY(yaw);
        a.root.rotateX(-_pose.pitch);
        const dist = camera.position.distanceTo(a.root.position);
        a.root.visible = !outside && dist < 500;
        // Rendu détaillé (groupe V3, ou branche du coureur réaliste / poly) ; masqué = version légère en place.
        const detail = detailGroup(a, m.v3);
        const light = !m.v3 && !!detail && !detail.visible;
        if (a.root.visible && dist < 200) {
          const animDt = m.anim.step(dt, dist, this.animFrame);
          if (animDt > 0) {
            if (!light) a.update(animDt, c.cadence > 0 ? c.cadence + m.cadenceOff : 0, c.speed, watts > 0 ? 'seated' : 'coasting');
            m.v3?.update(animDt, c.cadence > 0 ? c.cadence + m.cadenceOff : 0, c.speed, watts > 0 ? 'seated' : 'coasting');
          }
        } else if (m.v3 && a.root.visible && needsLightBuild(a.root) && (this.animFrame + m.cadenceOff + 30) % 30 === 0) {
          // Trop loin pour être animé : mise à jour V3 occasionnelle pour qu'il se charge et passe en version légère.
          m.v3.update(1 / 60, c.cadence > 0 ? c.cadence + m.cadenceOff : 0, c.speed, watts > 0 ? 'seated' : 'coasting');
        }
        a.setShadows(dist < this.shadowRange);
        if (SMALL_PARTS_CULL && a.root.visible && (this.animFrame + m.cadenceOff + 8) % 6 === 0) cullSmallParts(a.root, camera.position, (camera as THREE.PerspectiveCamera).projectionMatrix.elements[5] ?? 1);
        // Version légère au-delà de 60 m et pièces fusionnées (riderLight.ts, riderMerge.ts), tous styles.
        if (detail) updateRiderLight(a.root, detail, dist, this.animFrame, castsShadow(a) && dist < this.shadowRange, undefined, lightColorOf(a, m.v3), !m.v3 || m.v3.posed);
        if (m.v3) applyRiderShadows(a.root, dist < this.shadowRange, (m.v3 as unknown as { group: THREE.Object3D }).group);
        if (a.root.visible && (this.animFrame + m.cadenceOff + 3) % 10 === 0) updateRiderMerge(a.root, this.animFrame);
        if (c.sens > 0 && !outside) {
          const gap = dm - player.distM - 1.75;
          draft = Math.max(draft, draftReductionSingle(gap, c.lateral + m.latOff * c.latScale - player.lateral));
        }
      }
    }
    return draft;
  }

  /**
   * Cyclistes qui vont dans le sens du joueur à moins de `rangeM` : nom, niveau, W/kg et centre du
   * groupe, pour « À proximité » (savoir si on peut les suivre).
   */
  roster(playerDistM: number, rangeM: number): Array<{ id: string; name: string; level: string; levelIdx: number; distM: number; x: number; z: number; color: string; wkg: number; km: number; watts: number; cadence: number }> {
    const out: Array<{ id: string; name: string; level: string; levelIdx: number; distM: number; x: number; z: number; color: string; wkg: number; km: number; watts: number; cadence: number }> = [];
    const L = this.track.length;
    for (const c of this.units) {
      if (c.sens < 0) continue;
      const mid = c.d - c.length / 2;
      if (Math.abs(mid - playerDistM) > rangeM) continue;
      const p = this.track.sample(this.track.route.loop ? ((mid % L) + L) % L : Math.min(Math.max(mid, 0), L), this.sample);
      const n = c.members.length;
      const lv = LEVELS[c.level] as (typeof LEVELS)[number];
      out.push({ id: c.id, name: n > 1 ? `Groupe de ${n}` : 'Cycliste', level: lv.name, levelIdx: c.level, distM: mid, x: p.x, z: p.z, color: c.color, wkg: c.watts / c.massKg, km: c.kmBase + c.travelledM / 1000, watts: c.watts, cadence: c.cadence });
    }
    return out;
  }

  /** Puissance médiane de la population : en dessous, on repart devant (rattrapé), au-dessus derrière (il nous dépasse). */
  private medianWatts(): number {
    return 190;
  }

  dispose(scene: THREE.Scene): void {
    for (const c of this.units)
      for (const m of c.members) {
        m.v3?.dispose();
        disposeRiderMerge(m.avatar.root);
        disposeRiderLight(m.avatar.root);
        disposeRiderShadows(m.avatar.root);
        scene.remove(m.avatar.root);
      }
  }
}
