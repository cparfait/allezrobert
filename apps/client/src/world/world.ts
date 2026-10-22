import * as THREE from 'three/webgpu';
import type { RouteData, RouteTrack } from '@allezrobert/shared';
import type { QualitySettings } from '../engine/quality.ts';
import { Environment, type EnvironmentState, type Season } from './environment.ts';
import { TerrainManager } from './terrain.ts';
import { Vegetation } from './vegetation.ts';
import { Buildings } from './buildings.ts';
import { RoadMesh, SHOULDER, TMP_NOFIX } from './road.ts';
import { RouteFootprint } from './ribbon.ts';
import { RoadNetwork } from './network.ts';
import { Rain } from './weather.ts';
import { GrassField } from './grass.ts';
import { soundSourcesForTile, type SoundSource } from '../audio/spatial.ts';
import type { WorldSource } from './types.ts';

/** Assemble le monde : environnement, terrain streamé, route, végétation, bâtiments. */
export class World {
  readonly env: Environment;
  readonly terrain: TerrainManager;
  readonly vegetation: Vegetation;
  readonly buildings: Buildings;
  readonly road: RoadMesh;
  readonly network: RoadNetwork;
  readonly rain: Rain;
  readonly grass: GrassField;
  readonly source: WorldSource;
  private readonly scene: THREE.Scene;
  private readonly track: RouteTrack;
  private lastFocusTile = '';
  private updating = false;
  private retryAcc = 0;
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
    this.terrain.footprint = TMP_NOFIX ? null : footprint;
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
    this.vegetation = new Vegetation(q, envState.season, groundAt, nearRoad, onRoadEdge);
    scene.add(this.vegetation.group);
    this.buildings = new Buildings(groundAt);
    scene.add(this.buildings.group);
    this.network = new RoadNetwork(open ? '' : route.id, groundAt, TMP_NOFIX ? null : footprint, open);
    scene.add(this.network.group);
    this.rain = new Rain();
    scene.add(this.rain.mesh);
    const onAsphalt = buildRoadProximity(route, route.roadWidthM / 2 + 0.4);
    this.grass = new GrassField(q, envState.season, (x, z) => this.terrain.getTile(...this.terrain.tileCoord(x, z)), groundAt, onAsphalt);
    scene.add(this.grass.mesh);

    this.terrain.onTileLoaded = (tile) => {
      this.soundSources.set(tile.id, soundSourcesForTile(tile));
      this.buildings.addTile(tile);
      this.network.addTile(tile);
      this.vegetation.addTile(tile);
    };
    this.terrain.onTileUnloaded = (tile) => {
      this.soundSources.delete(tile.id);
      this.buildings.removeTile(tile);
      this.network.removeTile(tile);
      this.vegetation.removeTile(tile);
    };
  }

  private focusTile: [number, number] = [0, 0];

  /** Charge le voisinage initial (à attendre avant le départ). */
  async preload(focus: THREE.Vector3): Promise<void> {
    this.focusTile = this.terrain.tileCoord(focus.x, focus.z);
    this.vegetation.update(focus);
    await this.terrain.update(focus);
    this.lastFocusTile = this.focusTile.join('_');
  }

  setSeason(season: Season): void {
    this.env.state.season = season;
    this.terrain.setSeason(season);
    this.vegetation.setSeason(season);
    this.grass.setSeason(season);
  }

  setQuality(q: QualitySettings): void {
    this.env.applyQuality(q);
    this.terrain.setQuality(q);
    this.vegetation.setQuality(q);
  }

  update(dt: number, focus: THREE.Vector3): void {
    this.env.update(dt, focus);
    this.vegetation.update(focus);
    this.grass.update(focus);
    const w = this.env.state.weather;
    this.road.wetness.value = w.rain;
    this.network.wetness.value = w.rain;
    this.terrain.wetness.value = w.rain * 0.8;
    this.vegetation.windStrength.value = 0.15 + w.windMs * 0.06;
    this.grass.wind.value = 0.25 + w.windMs * 0.08;
    this.rain.update(w.rain, w.windMs, w.windFrom);
    this.buildings.night.value = this.nightFactor() > 0.35 ? 1 : 0;
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
      this.terrain.update(focus).finally(() => (this.updating = false));
    }
  }

  /** 0 = plein jour, 1 = nuit noire (élévation du soleil). */
  nightFactor(): number {
    const el = this.env.sky.sunPosition.value.y;
    return Math.min(1, Math.max(0, (0.06 - el) / 0.16));
  }

  dispose(): void {
    this.terrain.disposeAll();
    this.env.dispose();
    this.road.mesh.geometry.dispose();
    this.scene.remove(this.terrain.group, this.road.mesh, this.vegetation.group, this.buildings.group, this.network.group, this.grass.mesh, this.rain.mesh);
    void this.track;
  }
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
