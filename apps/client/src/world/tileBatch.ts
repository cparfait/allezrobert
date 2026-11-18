import * as THREE from 'three/webgpu';

/**
 * Décor par tuile regroupé en `BatchedMesh` : les maillages immobiles ajoutés directement à un groupe de décor
 * (bâti, routes, mobilier, garde-corps, eau, rails : un par tuile) sont recopiés dans un lot par (famille,
 * matériau, jeu d'attributs), et le maillage d'origine est masqué. three.js prépare alors un seul objet par lot
 * (liaisons, pipeline, contrôles de rafraîchissement) au lieu d'un par tuile ; le lot élimine encore chaque tuile
 * hors champ, une par une. Le maillage d'origine reste dans la scène (requêtes, retrait de la tuile).
 *
 * Mesure du 18/11/2026 (Bêta, Boulogne, boucle 20 km, qualité Moyenne, 8 coureurs, essai par injection,
 * out/cpu-beta) : 34,6 → 39,7 images/s, rendu CPU 22,1 → 18,8 ms, 279 → 219 dessins dans l'image principale.
 * Le terrain n'en profite pas : chaque tuile a son propre matériau.
 */

/** Activé par défaut ; `?tilebatch=0` revient aux maillages séparés (comparaison). */
export const TILE_BATCH = (() => {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get('tilebatch') !== '0';
  } catch {
    return true;
  }
})();

interface Slot {
  batch: Batch;
  geometryId: number;
  instanceId: number;
}

interface Batch {
  mesh: THREE.BatchedMesh;
  /** Instances vivantes : le lot vide est retiré de la scène. */
  live: number;
}

/** Nom de la famille : nom du maillage sans le suffixe de tuile (`roads_-4_-8` → `roads`). */
export function tileFamily(name: string): string {
  return name.replace(/[_-]?-?\d+_-?\d+$/, '');
}

/** Clé d'attributs : un lot n'accepte que des géométries de même structure. */
export function geometrySignature(g: THREE.BufferGeometry): string {
  const attrs = Object.entries(g.attributes)
    .map(([k, a]) => `${k}:${a.itemSize}:${(a as THREE.BufferAttribute).array.constructor.name}:${a.normalized}`)
    .sort()
    .join(',');
  return `${attrs}|${g.index ? 'i' : 'n'}`;
}

function eligible(o: THREE.Object3D): o is THREE.Mesh {
  const m = o as THREE.Mesh;
  return (
    !!m.isMesh &&
    !(m as unknown as THREE.InstancedMesh).isInstancedMesh &&
    !(m as unknown as THREE.SkinnedMesh).isSkinnedMesh &&
    !(m as unknown as THREE.BatchedMesh).isBatchedMesh &&
    !Array.isArray(m.material) &&
    m.geometry.groups.length <= 1 &&
    Object.keys(m.geometry.morphAttributes).length === 0 &&
    !!m.name
  );
}

export class TileBatcher {
  private readonly batches = new Map<string, Batch>();
  private readonly slots = new Map<THREE.Mesh, Slot>();
  private readonly root = new THREE.Group();

  constructor(scene: THREE.Object3D) {
    this.root.name = 'tile-batches';
    this.root.matrixAutoUpdate = false;
    scene.add(this.root);
  }

  /**
   * Regroupe les maillages ajoutés à `group` (enfants directs, après `freezeStatic` : matrices déjà à jour) et
   * ceux qu'il contient déjà.
   */
  adopt(group: THREE.Object3D): void {
    const add = group.add.bind(group);
    const remove = group.remove.bind(group);
    group.add = (...objects: THREE.Object3D[]) => {
      add(...objects);
      for (const o of objects) this.take(o);
      return group;
    };
    group.remove = (...objects: THREE.Object3D[]) => {
      for (const o of objects) this.release(o);
      remove(...objects);
      return group;
    };
    for (const o of group.children) this.take(o);
  }

  private take(o: THREE.Object3D): void {
    if (!eligible(o) || this.slots.has(o) || !o.visible) return;
    const material = o.material as THREE.Material;
    const g = o.geometry;
    const key = `${tileFamily(o.name)}|${material.uuid}|${geometrySignature(g)}|${+o.castShadow}${+o.receiveShadow}|${o.renderOrder}`;
    let batch = this.batches.get(key);
    const vertices = g.getAttribute('position').count;
    const indices = g.index?.count ?? 0;
    if (!batch) {
      const mesh = new THREE.BatchedMesh(8, Math.max(vertices * 8, 4096), indices ? Math.max(indices * 8, 4096) : 0, material);
      mesh.name = `batch:${tileFamily(o.name)}`;
      mesh.castShadow = o.castShadow;
      mesh.receiveShadow = o.receiveShadow;
      mesh.renderOrder = o.renderOrder;
      mesh.sortObjects = false;
      // Sphère englobante du lot non recalculée à chaque ajout : seule l'élimination par tuile sert.
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      batch = { mesh, live: 0 };
      this.batches.set(key, batch);
    }
    try {
      const geometryId = this.addGeometry(batch.mesh, g, vertices, indices);
      const instanceId = this.addInstance(batch.mesh, geometryId);
      o.updateMatrixWorld(true);
      batch.mesh.setMatrixAt(instanceId, o.matrixWorld);
      this.slots.set(o, { batch, geometryId, instanceId });
    } catch (err) {
      // Géométrie refusée par le lot : le maillage reste dessiné seul.
      console.warn('[tileBatch]', o.name, err);
      return;
    }
    if (batch.live++ === 0) this.root.add(batch.mesh);
    o.visible = false;
  }

  private release(o: THREE.Object3D): void {
    const slot = this.slots.get(o as THREE.Mesh);
    if (!slot) return;
    this.slots.delete(o as THREE.Mesh);
    const { batch } = slot;
    batch.mesh.deleteInstance(slot.instanceId);
    batch.mesh.deleteGeometry(slot.geometryId);
    o.visible = true;
    if (--batch.live === 0) this.root.remove(batch.mesh);
  }

  private addGeometry(mesh: THREE.BatchedMesh, g: THREE.BufferGeometry, vertices: number, indices: number): number {
    const m = mesh as unknown as { _nextVertexStart: number; _nextIndexStart: number; _maxVertexCount: number; _maxIndexCount: number };
    const fits = () => m._nextVertexStart + vertices <= m._maxVertexCount && m._nextIndexStart + indices <= m._maxIndexCount;
    if (!fits()) mesh.optimize(); // récupère la place des tuiles retirées
    if (!fits()) {
      const v = Math.ceil(Math.max(m._maxVertexCount * 1.5, m._nextVertexStart + vertices));
      const i = indices ? Math.ceil(Math.max(m._maxIndexCount * 1.5, m._nextIndexStart + indices)) : 0;
      mesh.setGeometrySize(v, i);
    }
    return mesh.addGeometry(g);
  }

  private addInstance(mesh: THREE.BatchedMesh, geometryId: number): number {
    if (mesh.instanceCount >= mesh.maxInstanceCount) mesh.setInstanceCount(Math.ceil(mesh.maxInstanceCount * 1.5) + 1);
    return mesh.addInstance(geometryId);
  }

  dispose(): void {
    for (const { mesh } of this.batches.values()) mesh.dispose();
    this.batches.clear();
    this.slots.clear();
    this.root.parent?.remove(this.root);
  }
}
