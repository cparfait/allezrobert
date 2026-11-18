import * as THREE from 'three/webgpu';

/**
 * Faisceau de phare de vélo (motif projeté par le projecteur, `SpotLight.map`) : un projecteur nu dessine un rond
 * de lumière devant la roue et éclaire aussi en hauteur (dos des coureurs, feuillage). Un vrai phare route a un
 * faisceau large et plat, une coupure nette en haut (rien au-dessus de l'horizon) et plus de lumière au loin qu'au
 * pied du vélo. Motif en niveaux de gris, de bas (près de la roue) en haut (horizon).
 */
export function headlightBeamTexture(size = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const img = ctx.createImageData(size, size);
  const smooth = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  /** Ligne de coupure (fraction de hauteur du motif, depuis le bas). */
  const cutoff = 0.56;
  for (let y = 0; y < size; y++) {
    // Rangée 0 du canevas = haut du motif.
    const v = 1 - (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const side = 1 - smooth(0.3, 0.5, Math.abs(u - 0.5));
      const top = 1 - smooth(cutoff - 0.03, cutoff + 0.01, v);
      // Plus fort vers la coupure (le loin), discret au pied du vélo.
      const ramp = 0.22 + 0.78 * smooth(0.12, cutoff - 0.02, v);
      const k = Math.round(255 * side * top * ramp);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = k;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}
