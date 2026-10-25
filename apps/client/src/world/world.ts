import { frameStats } from '../engine/frameStats.ts';
import * as THREE from 'three/webgpu';
import type { RouteData, RouteTrack } from '@allezrobert/shared';
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
  /** Relief lointain (montagnes au-delà des tuiles), chargé en arrière-plan s'il existe. */
  horizon: FarTerrain | null = null;
  private disposed = false;
  /** Revêtement sous chaque émetteur de poussière (recalculé tous les 8 m). */
  private readonly surfaceCache = new Map<string, { x: number; z: number; unpaved: boolean }>();
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

  constructor(scene: THREE.Scene, source: WorldSource, route: RouteData, track: RouteTrack, q: QualitySettings, envState: EnvironmentState) {
    this.scene = scene;
    this.source = source;
    this.track = track;
    this.env = new Environment(scene, q, envState);
    this.terrain = new TerrainManager(source, q, envState.season);
    // Emprise du ruban : terrain abaissé dessous, réseau OSM découpé à son bord. Monde ouvert :
    // toutes les routes sont déjà creusées et dessinées par le réseau, pas de ruban d'itinéraire.
    const open = !!source.open;
    const footprint = open ? null : new RouteFootprint(route.points, route.loop, route.roadWidthM / 2, SHOULDER);
    this.terrain.footprint = footprint;
    this.terrain.activeRoute = route.id;
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
    this.network = new RoadNetwork(open ? '' : route.id, groundAt, footprint, open);
    scene.add(this.network.group);
    this.rain = new Rain();
    scene.add(this.rain.mesh);
    const onAsphalt = buildRoadProximity(route, route.roadWidthM / 2 + 0.4);
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
        ['végétation', () => this.vegetation.addTile(tile)],
        ['eau', () => this.water.addTile(tile)],
        ['rails', () => this.railways.addTile(tile)],
      ] as const)
        this.terrain.work.defer(() => alive() && step(), priority, label);
    };
    this.terrain.onTileUnloaded = (tile) => {
      this.soundSources.delete(tile.id);
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
  }

  update(dt: number, focus: THREE.Vector3): void {
    this.env.update(dt, focus);
    const tv = frameStats.enabled ? performance.now() : 0;
    this.vegetation.update(focus);
    if (frameStats.enabled) frameStats.add('végétation (détail)', performance.now() - tv);
    this.grass.update(focus);
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
    if (this.horizon) {
      this.horizon.fogColor.value.copy(this.env.fog.color);
      this.horizon.fogDensity.value = this.env.fog.density;
      this.horizon.skyColor.value.copy(this.env.hemi.color);
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

  /** Chemin non revêtu sous (x, z) (route OSM la plus proche), mis en cache par émetteur. */
  isUnpavedAt(id: string, x: number, z: number): boolean {
    if (this.forceUnpaved) return true;
    const c = this.surfaceCache.get(id);
    if (c && Math.hypot(c.x - x, c.z - z) < 8) return c.unpaved;
    const s = surfaceUnder(this.terrain.getTile(...this.terrain.tileCoord(x, z)), x, z);
    const unpaved = s?.unpaved ?? false;
    this.surfaceCache.set(id, { x, z, unpaved });
    return unpaved;
  }

  /**
   * Poussière derrière un vélo (ou un véhicule) qui roule sur un chemin non revêtu, par temps sec.
   * `id` : identifiant stable de l'émetteur ; (dx, dz) : direction de marche.
   */
  kickDust(id: string, x: number, y: number, z: number, dx: number, dz: number, speedMs: number, dt: number): void {
    if (this.env.state.weather.rain > 0.25 || !this.isUnpavedAt(id, x, z)) return;
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

/** Test rapide « trop près de la route » via une grille de hachage des points de l'itinéraire. */
function buildRoadProximity(route: RouteData, radius: number): (x: number, z: number) => boolean {
  const cell = Math.max(radius, 8);
  const grid = new Map<string, Array<{ x: number; z: number }>>();
  for (const p of route.points) {
    const k = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`;
    let a = grid.get(k);
    if (!a) grid.set(k, (a = []));
    a.push(p);
  }
  const r2 = radius * radius;
  return (x, z) => {
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) {
        const a = grid.get(`${cx + i},${cz + j}`);
        if (!a) continue;
        for (const p of a) if ((p.x - x) ** 2 + (p.z - z) ** 2 < r2) return true;
      }
    return false;
  };
}
