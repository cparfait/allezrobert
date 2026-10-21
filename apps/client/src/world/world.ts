import * as THREE from 'three/webgpu';
import type { RouteData, RouteTrack } from '@allezrobert/shared';
import type { QualitySettings } from '../engine/quality.ts';
import { Environment, type EnvironmentState, type Season } from './environment.ts';
import { TerrainManager } from './terrain.ts';
import { Vegetation } from './vegetation.ts';
import { Buildings } from './buildings.ts';
import { RoadMesh } from './road.ts';
import type { WorldSource } from './types.ts';

/** Assemble le monde : environnement, terrain streamé, route, végétation, bâtiments. */
export class World {
  readonly env: Environment;
  readonly terrain: TerrainManager;
  readonly vegetation: Vegetation;
  readonly buildings: Buildings;
  readonly road: RoadMesh;
  readonly source: WorldSource;
  private readonly scene: THREE.Scene;
  private readonly track: RouteTrack;
  private lastFocusTile = '';
  private updating = false;

  constructor(scene: THREE.Scene, source: WorldSource, route: RouteData, track: RouteTrack, q: QualitySettings, envState: EnvironmentState) {
    this.scene = scene;
    this.source = source;
    this.track = track;
    this.env = new Environment(scene, q, envState);
    this.terrain = new TerrainManager(source, q, envState.season);
    scene.add(this.terrain.group);
    this.road = new RoadMesh(route);
    scene.add(this.road.mesh);

    // Pas d'arbre sur la route ni à moins de 4 m du bord de chaussée.
    const half = route.roadWidthM / 2 + 4;
    const nearRoad = buildRoadProximity(route, half);
    const groundAt = (x: number, z: number) => this.terrain.heightAt(x, z);
    this.vegetation = new Vegetation(q, envState.season, groundAt, nearRoad);
    scene.add(this.vegetation.group);
    this.buildings = new Buildings(groundAt);
    scene.add(this.buildings.group);

    this.terrain.onTileLoaded = (tile) => {
      this.buildings.addTile(tile);
      this.vegetation.addTile(tile);
    };
    this.terrain.onTileUnloaded = (tile) => {
      this.buildings.removeTile(tile);
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
  }

  setQuality(q: QualitySettings): void {
    this.env.applyQuality(q);
    this.terrain.setQuality(q);
    this.vegetation.setQuality(q);
  }

  update(dt: number, focus: THREE.Vector3): void {
    this.env.update(dt, focus);
    this.vegetation.update(focus);
    const w = this.env.state.weather;
    this.road.wetness.value = w.rain;
    this.terrain.wetness.value = w.rain * 0.8;
    this.vegetation.windStrength.value = 0.15 + w.windMs * 0.06;
    this.buildings.night.value = this.env.sun.position.y < focus.y + 20 ? 1 : 0;
    // Streaming : à chaque changement de tuile, on recharge le voisinage.
    const ft = this.terrain.tileCoord(focus.x, focus.z);
    const key = ft.join('_');
    if (key !== this.lastFocusTile && !this.updating) {
      this.lastFocusTile = key;
      this.focusTile = ft;
      this.updating = true;
      this.terrain.update(focus).finally(() => (this.updating = false));
    }
  }

  dispose(): void {
    this.env.dispose();
    this.scene.remove(this.terrain.group, this.road.mesh, this.vegetation.group, this.buildings.group);
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
