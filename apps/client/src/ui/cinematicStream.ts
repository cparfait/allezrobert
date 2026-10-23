import * as THREE from 'three/webgpu';
import { rng } from '../engine/noise.ts';
import type { Engine } from '../engine/renderer.ts';
import { splatAt } from '../world/splat.ts';
import type { LoadedTile } from '../world/types.ts';
import type { World } from '../world/world.ts';

/**
 * Film d'accueil (développement) : rendu reproductible, sans apparition d'objets en cours de plan.
 *
 * En jeu, le paysage suit le coureur (tuiles et niveaux de détail recalculés quand il avance,
 * herbe retirée au hasard tous les 12 m) et les animations des shaders suivent l'horloge réelle.
 * Pour le film, tout est figé à partir du trajet complet, sans toucher aux modules du monde
 * (méthodes remplacées sur les instances, le temps d'une page de capture) :
 * - terrain : un seul voisinage, centré sur le milieu du trajet (rien ne se charge ni ne change de
 *   niveau de détail pendant le film) ;
 * - arbres : niveau de détail selon la distance au point de vue le plus proche du trajet
 *   (caméra et groupe sur tout le film), donc constant ;
 * - herbe : touffes posées sur une grille fixe du monde, autour de la caméra (seul le bord du
 *   disque de 60 m bouge, au lieu d'un nouveau tirage tous les 12 m) ;
 * - horloge des shaders (vent, eau) : temps du film, et non temps réel.
 */

export interface ViewPoint {
  x: number;
  z: number;
}

interface TerrainInternals {
  update(focus: THREE.Vector3): Promise<void>;
  tiles: Map<string, { textures: THREE.Texture[] }>;
}

interface VegetationInternals {
  focus: THREE.Vector3;
  lodFor(c: unknown): number;
  isFar(x0: number, z0: number, size: number): boolean;
  update(focus: THREE.Vector3): void;
}

interface GrassInternals {
  max: number;
  mesh: THREE.InstancedMesh;
  tileAt(x: number, z: number): LoadedTile | undefined;
  heightAt(x: number, z: number): number;
  avoid(x: number, z: number): boolean;
  update(focus: THREE.Vector3): void;
}

interface NodeFrameInternals {
  frameId: number;
  time: number;
  deltaTime: number;
  lastTime?: number;
  update(): void;
}

/** Rayon de l'herbe : le même que RADIUS dans world/grass.ts. */
const GRASS_RADIUS = 60;
/** Maille de la grille fixe de l'herbe (m). */
const GRASS_CELL = 8;

/** Horloge des nœuds (time, deltaTime) pilotée par le film plutôt que par performance.now(). */
export function filmClock(engine: Engine): { time: number; delta: number } {
  const clock = { time: 0, delta: 0 };
  const nodeFrame = (engine.renderer as unknown as { _nodes: { nodeFrame: NodeFrameInternals } })._nodes.nodeFrame;
  nodeFrame.update = function (this: NodeFrameInternals) {
    this.frameId++;
    this.deltaTime = clock.delta;
    this.time = clock.time;
    this.lastTime = performance.now();
  };
  return clock;
}

/** Fige le streaming du monde pour tout le film (voir l'en-tête). `grassCenter` suit la caméra. */
export function freezeStreaming(world: World, fixedFocus: THREE.Vector3, views: readonly ViewPoint[], grassCenter: THREE.Vector3): void {
  const terrain = world.terrain as unknown as TerrainInternals;
  const terrainUpdate = terrain.update.bind(terrain);
  terrain.update = () => terrainUpdate(fixedFocus);

  const veg = world.vegetation as unknown as VegetationInternals;
  const lodFor = veg.lodFor.bind(veg);
  const isFar = veg.isFar.bind(veg);
  const saved = new THREE.Vector3();
  veg.lodFor = (c: unknown) => {
    saved.copy(veg.focus);
    let best = 2;
    for (const p of views) {
      veg.focus.set(p.x, saved.y, p.z);
      best = Math.min(best, lodFor(c));
      if (best === 0) break;
    }
    veg.focus.copy(saved);
    return best;
  };
  veg.isFar = (x0: number, z0: number, size: number) => {
    saved.copy(veg.focus);
    let far = true;
    for (const p of views) {
      veg.focus.set(p.x, saved.y, p.z);
      if (!isFar(x0, z0, size)) {
        far = false;
        break;
      }
    }
    veg.focus.copy(saved);
    return far;
  };
  // Réévaluation immédiate des blocs déjà chargés.
  veg.focus.set(1e9, 0, 1e9);
  veg.update(fixedFocus);

  const grass = world.grass as unknown as GrassInternals;
  // Même nombre d'essais au m² que GrassField.update (2 × max sur le disque).
  const perCell = Math.round(((grass.max * 2) / (Math.PI * GRASS_RADIUS * GRASS_RADIUS)) * GRASS_CELL * GRASS_CELL);
  const last = new THREE.Vector3(1e9, 0, 1e9);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  grass.update = () => {
    if (!grass.max) return;
    const c = grassCenter;
    if (Math.hypot(c.x - last.x, c.z - last.z) < 1.5) return;
    last.copy(c);
    const R = GRASS_RADIUS;
    const cells: Array<{ ix: number; iz: number; d: number }> = [];
    for (let iz = Math.floor((c.z - R) / GRASS_CELL); iz <= Math.floor((c.z + R) / GRASS_CELL); iz++)
      for (let ix = Math.floor((c.x - R) / GRASS_CELL); ix <= Math.floor((c.x + R) / GRASS_CELL); ix++) {
        const nx = Math.min(Math.max(c.x, ix * GRASS_CELL), (ix + 1) * GRASS_CELL);
        const nz = Math.min(Math.max(c.z, iz * GRASS_CELL), (iz + 1) * GRASS_CELL);
        if (Math.hypot(nx - c.x, nz - c.z) > R) continue;
        cells.push({ ix, iz, d: Math.hypot((ix + 0.5) * GRASS_CELL - c.x, (iz + 0.5) * GRASS_CELL - c.z) });
      }
    // Les plus proches d'abord : si le plafond d'instances est atteint, seul le bord manque.
    cells.sort((a, b) => a.d - b.d);
    let n = 0;
    for (const cell of cells) {
      if (n >= grass.max) break;
      // Tirage propre à la case (indépendant du centre) : une touffe reste où elle est.
      const r = rng((Math.imul(cell.ix, 73856093) ^ Math.imul(cell.iz, 19349663)) >>> 0);
      for (let k = 0; k < perCell && n < grass.max; k++) {
        // Toujours six tirages par candidat, qu'il soit retenu ou non.
        const x = (cell.ix + r()) * GRASS_CELL;
        const z = (cell.iz + r()) * GRASS_CELL;
        const keep = r();
        const size = r();
        const rot = r();
        const tall = r();
        if (Math.hypot(x - c.x, z - c.z) > R) continue;
        const tile = grass.tileAt(x, z);
        if (!tile) continue;
        // Densité : même règle que GrassField.update (world/grass.ts), pour un monde de plaine
        // (le film se tourne à Chevreuse : ni roche ni neige d'altitude).
        const meadow = splatAt(tile, 2, x, z);
        const field = splatAt(tile, 1, x, z);
        const forest = splatAt(tile, 0, x, z);
        const road = splatAt(tile, 5, x, z);
        const water = splatAt(tile, 3, x, z);
        const verge = splatAt(tile, 6, x, z);
        const density = road > 0.3 || water > 0.3 ? 0 : 0.35 + meadow * 0.65 - forest * 0.25 + field * 0.1 + verge * 0.8;
        if (keep > density) continue;
        if (grass.avoid(x, z)) continue;
        const y = grass.heightAt(x, z);
        if (!Number.isFinite(y)) continue;
        const kk = (0.6 + size * 0.7) * (1 + verge * 0.6);
        p.set(x, y - 0.02, z);
        q.setFromAxisAngle(up, rot * Math.PI);
        s.set(kk, kk * (0.8 + tall * 0.6), kk);
        m.compose(p, q, s);
        grass.mesh.setMatrixAt(n++, m);
      }
    }
    grass.mesh.count = n;
    grass.mesh.instanceMatrix.needsUpdate = true;
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Attend que tout soit arrivé : orthophotos des tuiles (chargées en arrière-plan) et plus aucune
 * requête réseau nouvelle pendant 2 s. Une orthophoto en échec ne bloque pas plus de 15 s.
 */
export async function waitForAssets(world: World, say: (msg: string) => void, maxMs = 120_000): Promise<void> {
  performance.setResourceTimingBufferSize(1_000_000);
  const tiles = (world.terrain as unknown as TerrainInternals).tiles;
  const t0 = performance.now();
  let lastRes = -1;
  let quiet = 0;
  let lastPending = -1;
  let pendingSince = performance.now();
  while (performance.now() - t0 < maxMs) {
    let pending = 0;
    for (const e of tiles.values()) for (const tx of e.textures) if (!tx.image) pending++;
    const res = performance.getEntriesByType('resource').length;
    quiet = res === lastRes ? quiet + 1 : 0;
    lastRes = res;
    if (pending !== lastPending) {
      lastPending = pending;
      pendingSince = performance.now();
    }
    say(`cinematic : chargement (${tiles.size} tuiles, ${pending} textures en attente, ${res} requêtes)…`);
    if (quiet >= 4 && (pending === 0 || performance.now() - pendingSince > 15_000)) {
      if (pending) console.warn(`[cinematic] ${pending} textures de tuile toujours absentes`);
      return;
    }
    await sleep(500);
  }
  console.warn('[cinematic] chargement incomplet après', maxMs, 'ms');
}
