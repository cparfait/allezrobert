import { frameStats } from '../engine/frameStats.ts';
import { LOW_POLY } from '../engine/style.ts';
import { RoadsideLife, type LifeDensity } from './roadsideLife.ts';
import { RoadsidePeople } from './roadsidePeople.ts';
import { SkyLife } from './skyLife.ts';
import * as THREE from 'three/webgpu';
import { baseRouteId, type RouteData, type RouteTrack } from '@allezrobert/shared';
import type { QualitySettings } from '../engine/quality.ts';
import { Environment, type EnvironmentState, type Season } from './environment.ts';
import { TerrainManager } from './terrain.ts';
import { Vegetation } from './vegetation.ts';
import { Buildings } from './buildings.ts';
import { RoadMesh, SHOULDER } from './road.ts';
import { RouteFootprint } from './ribbon.ts';
import { RoadNetwork } from './network.ts';
import { Rain } from './weather.ts';
import { GrassField } from './grass.ts';
import { WaterSystem } from './water.ts';
import { Railways } from './railways.ts';
import { Dust, surfaceUnder } from './dust.ts';
import { FarTerrain } from './horizon.ts';
import { alpineProfile } from './alpine.ts';
import { buildRoadProximity } from './roadProximity.ts';
import { soundSourcesForTile, type SoundSource } from '../audio/spatial.ts';
import type { WorldSource } from './types.ts';

/** Assemble le monde : environnement, terrain streamé, route, végétation, bâtiments. */
/** Temps accordé par image à la construction des tuiles arrivées (ms). */
const WORK_BUDGET_MS = 4;

export class World {
  readonly env: Environment;
  readonly terrain: TerrainManager;
  readonly vegetation: Vegetation;
  readonly buildings: Buildings;
  readonly road: RoadMesh;
  readonly network: RoadNetwork;
  readonly rain: Rain;
  readonly grass: GrassField;
  readonly water: WaterSystem;
  readonly railways: Railways;
  readonly dust: Dust;
  /** Style jeu vidéo : abords peuplés (clôtures, poteaux, fleurs, animaux). */
  readonly life: RoadsideLife | null = null;
  /** Style jeu vidéo : joggeurs, promeneurs, enfants, pêcheurs, footballeurs. */
  readonly people: RoadsidePeople | null = null;
  /** Style jeu vidéo : oiseaux et papillons. */
  readonly sky: SkyLife | null = null;
  /** Relief lointain (montagnes au-delà des tuiles), chargé en arrière-plan s'il existe. */
  horizon: FarTerrain | null = null;
  private disposed = false;
  /** Revêtement sous chaque émetteur de poussière (recalculé tous les 8 m). */
  private readonly surfaceCache = new Map<string, { x: number; z: number; unpaved: boolean; dusty: boolean }>();
  /** Contrôle visuel (?dust=force) : tout chemin est traité comme non revêtu. */
  forceUnpaved = new URLSearchParams(location.search).get('dust') === 'force';
  readonly source: WorldSource;
  private readonly scene: THREE.Scene;
  private readonly track: RouteTrack;
  private lastFocusTile = '';
  private updating = false;
  /** Sens de marche lissé (pour précharger les tuiles de devant) et dernière tuile préchargée. */
  private readonly lastFocus = new THREE.Vector3(Number.NaN, 0, 0);
  private readonly heading = new THREE.Vector2();
  private prefetchKey = '';
  private retryAcc = 0;
  private lastHour = Number.NaN;
  /** Sources sonores positionnées par tuile (tags OSM). */
  readonly soundSources = new Map<string, SoundSource[]>();
  private lifeVersion = -1;
  private lifeFailed = false;
  /** Tuiles dont la végétation est plantée. */
  private readonly vegReady = new Set<string>();

  constructor(scene: THREE.Scene, source: WorldSource, route: RouteData, track: RouteTrack, q: QualitySettings, envState: EnvironmentState) {
    this.scene = scene;
    this.source = source;
    this.track = track;
    this.env = new Environment(scene, q, envState);
    // Brume de vallée calée sur le point le plus bas de l'itinéraire (fond de vallée).
    let low = Infinity;
    for (const p of route.points) if (p.y < low) low = p.y;
    if (Number.isFinite(low)) this.env.setMistBase(low + 10);
    this.terrain = new TerrainManager(source, q, envState.season);
    // Emprise du ruban : terrain abaissé dessous, réseau OSM découpé à son bord. Monde ouvert :
    // toutes les routes sont déjà creusées et dessinées par le réseau, pas de ruban d'itinéraire.
    const open = !!source.open;
    const footprint = open ? null : new RouteFootprint(route.points, route.loop, route.roadWidthM / 2, SHOULDER);
    this.terrain.footprint = footprint;
    // routes des tuiles : identifiant du parcours d'origine (sans sens ni départ)
    // Style jeu vidéo, monde ouvert : l'itinéraire est dessiné par le réseau, le sol le peint aussi en enrobé.
    this.terrain.activeRoute = LOW_POLY && open ? null : baseRouteId(route.id);
    scene.add(this.terrain.group);
    this.road = new RoadMesh(route);
    this.road.mesh.visible = !open;
    scene.add(this.road.mesh);

    // Pas d'arbre sur la route ni à moins de 4 m du bord de chaussée.
    const half = route.roadWidthM / 2 + 4;
    const nearRoad = buildRoadProximity(route, half);
    const groundAt = (x: number, z: number) => this.terrain.heightAt(x, z);
    // Arbres réels (LiDAR) : seule la chaussée est interdite, les haies de bord de route restent.
    const onRoadEdge = buildRoadProximity(route, route.roadWidthM / 2 + 0.6);
    // Ruban de l'itinéraire (hors monde ouvert) : aucun houppier au-dessus, comme pour les routes OSM.
    const routeRoads = open ? [] : [{ pts: route.points.flatMap((p) => [p.x, p.z]), half: route.roadWidthM / 2 + SHOULDER }];
    this.vegetation = new Vegetation(q, envState.season, groundAt, nearRoad, onRoadEdge, routeRoads);
    this.vegetation.setWorld(source.id);
    scene.add(this.vegetation.group);
    this.buildings = new Buildings(groundAt, q.propDensity);
    this.buildings.setWorld(source.id);
    scene.add(this.buildings.group);
    this.network = new RoadNetwork(open ? '' : baseRouteId(route.id), groundAt, footprint, open);
    scene.add(this.network.group);
    this.rain = new Rain();
    scene.add(this.rain.mesh);
    // Herbe tenue à 1 m du bord (les touffes penchées ne débordent plus sur l'enrobé).
    const onAsphalt = buildRoadProximity(route, route.roadWidthM / 2 + 1.0);
    this.grass = new GrassField(q, envState.season, (x, z) => this.terrain.getTile(...this.terrain.tileCoord(x, z)), groundAt, onAsphalt);
    scene.add(this.grass.mesh);
    this.water = new WaterSystem(q, envState.season, groundAt, nearRoad);
    if (source.sea) this.water.setSea(source.sea.levelM, source.bounds);
    scene.add(this.water.group);
    this.railways = new Railways(q, groundAt);
    this.railways.clock = envState.hour * 3600;
    scene.add(this.railways.group);
    this.dust = new Dust(q);
    scene.add(this.dust.sprite);
    // Style jeu vidéo : clôtures, poteaux, fleurs et animaux le long du parcours (monde plus vivant).
    if (LOW_POLY) {
      // Tuile prise en compte une fois sa végétation plantée (les animaux évitent les arbres).
      const lifeTile = (x: number, z: number) => {
        const t = this.terrain.getTile(...this.terrain.tileCoord(x, z));
        return t && this.vegReady.has(t.id) ? t : undefined;
      };
      this.life = new RoadsideLife(track, groundAt, lifeTile, lifeDensity(q), (a, b, c, d) => this.treesIn(a, b, c, d));
      scene.add(this.life.group);
      this.people = new RoadsidePeople(this.life, groundAt, lifeDensity(q).people);
      scene.add(this.people.group);
      this.sky = new SkyLife(this.life);
      scene.add(this.sky.group);
      if (import.meta.env.DEV) (globalThis as { __life?: RoadsideLife }).__life = this.life;
      if (import.meta.env.DEV) (globalThis as { __world?: World }).__world = this;
    }

    void source
      .loadHorizon?.()
      .then((grid) => {
        if (!grid || this.disposed) return;
        this.horizon = new FarTerrain(grid, source, q, this.env.state.season, alpineProfile(source.id));
        this.horizon.requestFocus(this.focusTile[0] * source.tileSize + 1, this.focusTile[1] * source.tileSize + 1);
        this.horizon.commitFocus();
        scene.add(this.horizon.mesh);
      })
      .catch((err) => console.warn('Relief lointain indisponible', err));

    // Décor fixe (rien n'y bouge après sa pose) : matrices calculées une fois, plus à chaque image.
    for (const g of [this.terrain.group, this.buildings.group, this.network.group, this.vegetation.group, this.water.group, this.railways.group]) freezeStatic(g);

    // Entités d'une tuile construites par étapes (bâtiments, routes, végétation…) dans le budget de
    // chaque image, plutôt que toutes d'un coup au moment où la tuile arrive (saccades en roulant).
    this.terrain.onTileLoaded = (tile, alive) => {
      this.soundSources.set(tile.id, soundSourcesForTile(tile));
      const priority = this.terrain.distTo(tile.tx, tile.tz);
      for (const [label, step] of [
        ['bâtiments', () => this.buildings.addTile(tile)],
        ['routes', () => this.network.addTile(tile)],
        [
          'végétation',
          () => {
            this.vegetation.addTile(tile);
            this.vegReady.add(tile.id);
          },
        ],
        ['eau', () => this.water.addTile(tile)],
        ['rails', () => this.railways.addTile(tile)],
      ] as const)
        this.terrain.work.defer(() => alive() && step(), priority, label);
    };
    this.terrain.onTileUnloaded = (tile) => {
      this.soundSources.delete(tile.id);
      this.vegReady.delete(tile.id);
      this.buildings.removeTile(tile);
      this.network.removeTile(tile);
      this.vegetation.removeTile(tile);
      this.water.removeTile(tile);
      this.railways.removeTile(tile);
    };
  }

  private focusTile: [number, number] = [0, 0];

  /** Charge le voisinage initial (à attendre avant le départ). */
  async preload(focus: THREE.Vector3, onTile?: (done: number, total: number) => void): Promise<void> {
    this.focusTile = this.terrain.tileCoord(focus.x, focus.z);
    this.vegetation.update(focus);
    await this.terrain.update(focus, onTile);
    // Avant le départ : tout est construit tout de suite (écran d'attente affiché).
    this.terrain.work.flush();
    this.lastFocusTile = this.focusTile.join('_');
  }

  /**
   * Préchargement : à mi-tuile du bord dans le sens de marche, les tuiles voulues autour du point
   * situé devant sont téléchargées et décodées à l'avance ; en changeant de tuile, il ne reste qu'à
   * les construire (par étapes).
   */
  private prefetchAhead(focus: THREE.Vector3): void {
    if (Number.isFinite(this.lastFocus.x)) {
      const dx = focus.x - this.lastFocus.x;
      const dz = focus.z - this.lastFocus.z;
      if (dx * dx + dz * dz > 1e-6 && dx * dx + dz * dz < 400) this.heading.multiplyScalar(0.95).add(new THREE.Vector2(dx, dz).multiplyScalar(0.05));
    }
    this.lastFocus.copy(focus);
    const len = this.heading.length();
    if (len < 1e-4) return;
    const lead = this.terrain.tileSizeM * 0.5;
    const ahead = new THREE.Vector3(focus.x + (this.heading.x / len) * lead, focus.y, focus.z + (this.heading.y / len) * lead);
    const key = this.terrain.tileCoord(ahead.x, ahead.z).join('_');
    if (key === this.prefetchKey || key === this.lastFocusTile) return;
    this.prefetchKey = key;
    this.terrain.prefetch(ahead);
  }

  setSeason(season: Season): void {
    this.env.state.season = season;
    this.terrain.setSeason(season);
    this.vegetation.setSeason(season);
    this.grass.setSeason(season);
    this.water.setSeason(season);
    this.horizon?.setSeason(season);
  }

  setQuality(q: QualitySettings): void {
    this.env.applyQuality(q);
    this.terrain.setQuality(q);
    this.vegetation.setQuality(q);
    this.water.setQuality(q);
    this.horizon?.setQuality(q);
    this.life?.setDensity(lifeDensity(q));
  }

  update(dt: number, focus: THREE.Vector3): void {
    this.env.update(dt, focus);
    const tv = frameStats.enabled ? performance.now() : 0;
    this.vegetation.update(focus);
    if (frameStats.enabled) frameStats.add('végétation (détail)', performance.now() - tv);
    this.grass.update(focus);
    this.updateLife(dt, focus);
    const w = this.env.state.weather;
    this.road.wetness.value = w.rain;
    this.network.wetness.value = w.rain;
    this.terrain.wetness.value = w.rain * 0.8;
    this.vegetation.windStrength.value = 0.15 + w.windMs * 0.06;
    this.grass.wind.value = 0.25 + w.windMs * 0.08;
    // Sens du vent (vers où il souffle), commun aux arbres, à l'herbe, à l'eau et à la poussière.
    const wx = -Math.sin(w.windFrom);
    const wz = Math.cos(w.windFrom);
    (this.vegetation.windDir.value as THREE.Vector2).set(wx, wz);
    (this.grass.windDir.value as THREE.Vector2).set(wx, wz);
    (this.water.windDir.value as THREE.Vector2).set(wx, wz);
    this.water.windMs.value = w.windMs;
    this.water.rain.value = w.rain;
    // L'eau reflète le ciel (zénith) et l'horizon (brume) du moment.
    this.water.skyColor.value.copy(this.env.hemi.color);
    this.water.horizonColor.value.copy(this.env.fog.color);
    this.water.fakeSky.value = this.scene.environment ? 0.2 : 1;
    if (this.horizon) {
      this.horizon.fogColor.value.copy(this.env.fog.color);
      this.horizon.fogDensity.value = this.env.fog.density;
      this.horizon.skyColor.value.copy(this.env.hemi.color);
      this.horizon.fogSunColor.value.copy(this.env.sceneFog.sunColor.value);
      (this.horizon.sunDir.value as THREE.Vector3).copy(this.env.sceneFog.sunDir.value as THREE.Vector3);
    }
    this.rain.update(w.rain, w.windMs, w.windFrom);
    this.buildings.night.value = this.nightFactor() > 0.35 ? 1 : 0;
    this.railways.night.value = this.nightFactor() > 0.25 ? 1 : 0;
    // Horloge des trains : l'heure choisie (peut changer au menu) plus le temps écoulé.
    if (Math.abs(this.railways.clock / 3600 - this.env.state.hour) > 1 && Math.abs(this.lastHour - this.env.state.hour) > 1e-6) this.railways.clock = this.env.state.hour * 3600;
    this.lastHour = this.env.state.hour;
    this.railways.update(dt);
    this.dust.update(dt);
    (this.dust.windDir.value as THREE.Vector2).set(wx, wz);
    this.dust.windMs.value = w.windMs;
    // Construction étalée : quelques millisecondes par image pour les tuiles arrivées.
    this.terrain.work.pump(WORK_BUDGET_MS);
    this.prefetchAhead(focus);
    // Streaming : à chaque changement de tuile, on recharge le voisinage.
    const ft = this.terrain.tileCoord(focus.x, focus.z);
    const key = ft.join('_');
    // Nouvelle tentative périodique pour les tuiles manquantes (génération en cours, réseau).
    this.retryAcc += dt;
    if (this.retryAcc > 10) {
      this.retryAcc = 0;
      this.lastFocusTile = '';
    }
    if (key !== this.lastFocusTile && !this.updating) {
      this.lastFocusTile = key;
      this.focusTile = ft;
      this.updating = true;
      this.horizon?.requestFocus(focus.x, focus.z);
      this.terrain.update(focus).finally(() => {
        this.updating = false;
        this.horizon?.commitFocus();
      });
    }
  }

  /**
   * Monde ouvert : l'itinéraire roulé est celui du navigateur (créé au départ de la sortie, après le
   * monde). Le décor des abords et ses personnages suivent ce nouvel itinéraire.
   */
  setTrack(track: RouteTrack): void {
    if (!this.life || !track) return;
    this.life.setTrack(track);
    this.people?.reset();
    this.sky?.reset();
  }

  /** Style jeu vidéo : décor des abords (une erreur n'arrête jamais la boucle de rendu). */
  private updateLife(dt: number, focus: THREE.Vector3): void {
    const life = this.life;
    if (!life || !focus || !Number.isFinite(focus.x) || !Number.isFinite(focus.z)) return;
    const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.25) : 0;
    try {
      life.update(step, focus);
      if (life.version !== this.lifeVersion) {
        this.lifeVersion = life.version;
        this.soundSources.set('life:troupeaux', life.sources);
      }
      this.people?.update(step, focus);
      if (this.sky) {
        // pas d'oiseaux la nuit ; pas de papillons en hiver, la nuit ni sous la pluie
        const night = this.nightFactor();
        const w = this.env.state.weather;
        this.sky.birdsOn = night < 0.6 && w.rain < 0.6;
        this.sky.butterfliesOn = night < 0.3 && w.rain < 0.25 && this.env.state.season !== 'winter';
        this.sky.update(step, focus);
      }
    } catch (err) {
      if (!this.lifeFailed) console.error('Abords de la route :', err);
      this.lifeFailed = true;
    }
  }

  /**
   * Arbres et buissons plantés par la végétation dans un rectangle : (x, z, rayon du tronc et des basses
   * branches) à la suite, lus dans les matrices des instances (repère monde).
   */
  private treesIn(minX: number, minZ: number, maxX: number, maxZ: number): number[] {
    const out: number[] = [];
    for (const o of this.vegetation.group.children) {
      const im = o as THREE.InstancedMesh;
      if (!im.isInstancedMesh || !im.count) continue;
      if (!im.boundingSphere) im.computeBoundingSphere();
      const bs = im.boundingSphere;
      if (bs && (bs.center.x + bs.radius < minX || bs.center.x - bs.radius > maxX || bs.center.z + bs.radius < minZ || bs.center.z - bs.radius > maxZ)) continue;
      const g = im.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      // le gabarit fait ~ hauteur / 2 de rayon : tronc et basses branches ≈ 35 % (3 m au plus)
      const base = Math.min(3, (g.boundingSphere?.radius ?? 4) * 0.35);
      const a = im.instanceMatrix.array;
      for (let i = 0; i < im.count; i++) {
        const k = i * 16;
        const x = a[k + 12] as number;
        const z = a[k + 14] as number;
        if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
        out.push(x, z, base * Math.hypot(a[k] as number, a[k + 1] as number, a[k + 2] as number));
      }
    }
    return out;
  }

  /** Revêtement sous (x, z) (route OSM la plus proche), mis en cache par émetteur. */
  private surfaceFor(id: string, x: number, z: number): { unpaved: boolean; dusty: boolean } {
    const c = this.surfaceCache.get(id);
    if (c && Math.hypot(c.x - x, c.z - z) < 8) return c;
    const s = surfaceUnder(this.terrain.getTile(...this.terrain.tileCoord(x, z)), x, z);
    const e = { x, z, unpaved: s?.unpaved ?? false, dusty: s?.dusty ?? false };
    this.surfaceCache.set(id, e);
    return e;
  }

  /** Chemin non revêtu sous (x, z). */
  isUnpavedAt(id: string, x: number, z: number): boolean {
    return this.forceUnpaved || this.surfaceFor(id, x, z).unpaved;
  }

  /** Terre, sable ou gravier sous (x, z) : seuls revêtements qui soulèvent de la poussière. */
  isDustyAt(id: string, x: number, z: number): boolean {
    return this.forceUnpaved || this.surfaceFor(id, x, z).dusty;
  }

  /**
   * Poussière derrière un vélo (ou un véhicule) qui roule sur un chemin non revêtu, par temps sec.
   * `id` : identifiant stable de l'émetteur ; (dx, dz) : direction de marche.
   */
  kickDust(id: string, x: number, y: number, z: number, dx: number, dz: number, speedMs: number, dt: number): void {
    if (this.env.state.weather.rain > 0.25 || !this.isDustyAt(id, x, z)) return;
    this.dust.emit(id, x, y, z, dx, dz, speedMs, dt);
  }

  /** Rugosité du roulement pour le son (0,15 sur l'asphalte, 0,6 sur un chemin). */
  rollingRoughness(x: number, z: number): number {
    return this.isUnpavedAt('rolling', x, z) ? 0.6 : 0.15;
  }

  /** 0 = plein jour, 1 = nuit noire (élévation du soleil). */
  nightFactor(): number {
    const el = this.env.sky.sunPosition.value.y;
    return Math.min(1, Math.max(0, (0.06 - el) / 0.16));
  }

  dispose(): void {
    this.disposed = true;
    if (this.horizon) {
      this.scene.remove(this.horizon.mesh);
      this.horizon.dispose();
    }
    this.terrain.disposeAll();
    this.env.dispose();
    this.road.mesh.geometry.dispose();
    this.scene.remove(this.terrain.group, this.road.mesh, this.vegetation.group, this.buildings.group, this.network.group, this.grass.mesh, this.rain.mesh, this.water.group, this.railways.group, this.dust.sprite);
    if (this.life) {
      this.scene.remove(this.life.group);
      this.life.dispose();
    }
    if (this.people) {
      this.scene.remove(this.people.group);
      this.people.dispose();
    }
    if (this.sky) {
      this.scene.remove(this.sky.group);
      this.sky.dispose();
    }
    void this.track;
  }
}

/**
 * Groupe de décor fixe : ses objets ne sont jamais déplacés après leur ajout. À l'ajout, leurs matrices
 * sont calculées une fois et figées (`matrixAutoUpdate = false`) : three.js ne les recompose plus à chaque
 * image (les blocs de végétation, plus de mille, coûtaient une bonne part du temps d'image).
 * Les instances (arbres, wagons) restent mobiles : elles vivent dans les attributs, pas dans la matrice.
 */
export function freezeStatic(group: THREE.Object3D): void {
  group.updateMatrixWorld(true);
  group.matrixAutoUpdate = false;
  const add = group.add.bind(group);
  group.add = (...objects: THREE.Object3D[]) => {
    add(...objects);
    for (const o of objects) {
      o.traverse((c) => {
        c.updateMatrix();
        c.matrixAutoUpdate = false;
      });
      o.updateMatrixWorld(true);
    }
    return group;
  };
}

/** Densités du décor des abords (style jeu vidéo) selon la qualité graphique. */
function lifeDensity(q: QualitySettings): LifeDensity {
  return { props: q.propDensity, people: (q.trafficDensity + q.crowdDensity) / 2 };
}
