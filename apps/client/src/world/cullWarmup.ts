import type * as THREE from 'three/webgpu';

/** Nombre de dessins (toutes passes confondues : image, cascades d'ombre) avant d'activer le culling. */
const WARMUP_DRAWS = 60;

/**
 * Culling différé d'un maillage dont la sphère englobante est tenue à jour à la main (lot d'instances refait en
 * cours de sortie : herbe, vrais arbres, wagons). Tant qu'il n'a pas été dessiné `WARMUP_DRAWS` fois, il reste
 * hors culling comme avant : même vide, il passe alors par la passe d'image et par les passes d'ombre, ce qui
 * compile ses shaders au chargement. Un lot vide écarté dès le départ n'aurait compilé les siens qu'à l'arrivée
 * de sa première instance, en pleine sortie (saccade « COMPIL. SHADER »). Ensuite, un lot vide ou hors champ
 * n'est plus préparé à chaque passe.
 */
export function cullAfterWarmup(mesh: THREE.Mesh): void {
  mesh.frustumCulled = false;
  const previous = mesh.onAfterRender;
  let draws = 0;
  mesh.onAfterRender = function (this: THREE.Mesh, ...args: Parameters<THREE.Mesh['onAfterRender']>): void {
    previous.apply(this, args);
    if (++draws < WARMUP_DRAWS) return;
    mesh.frustumCulled = true;
    mesh.onAfterRender = previous;
  };
}
