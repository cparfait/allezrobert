import * as THREE from 'three/webgpu';
import type { Engine } from '../engine/renderer.ts';
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
 * - herbe : touffes de GrassField (ancrées au monde par blocs), autour de la caméra, regénérées
 *   tous les 1,5 m et d'un coup (en jeu : tous les 12 m, étalé sur plusieurs images) : seul le
 *   bord du disque bouge ;
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
  center: THREE.Vector3;
  job: unknown;
  advance(budget: number): void;
  update(focus: THREE.Vector3): void;
}

interface NodeFrameInternals {
  frameId: number;
  time: number;
  deltaTime: number;
  lastTime?: number;
  update(): void;
}

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
  const grassUpdate = grass.update.bind(grass);
  const last = new THREE.Vector3(1e9, 0, 1e9);
  grass.update = () => {
    const c = grassCenter;
    if (Math.hypot(c.x - last.x, c.z - last.z) < 1.5) return;
    last.copy(c);
    // Blocs déjà tirés gardés en cache : regénérer souvent ne coûte que le bord du disque.
    grass.center.set(1e9, 0, 1e9);
    grassUpdate(c);
    if (grass.job) grass.advance(Infinity);
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
