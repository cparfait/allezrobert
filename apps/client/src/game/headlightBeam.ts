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
  /**
   * Ligne de coupure (fraction de hauteur du motif, depuis le bas) : sur l'axe du projecteur, qui vise le sol à
   * ≈ 25 m. Plus haut (0,56), le faisceau montait au-dessus de l'horizon et éclairait les dos et le feuillage.
   */
  const cutoff = 0.5;
  for (let y = 0; y < size; y++) {
    // Rangée 0 du canevas = haut du motif.
    const v = 1 - (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      // Cœur étroit (≈ la chaussée à 10 m), bords vite éteints : il éclairait toute la largeur et les bas-côtés.
      const side = 1 - smooth(0.16, 0.42, Math.abs(u - 0.5));
      const top = 1 - smooth(cutoff - 0.03, cutoff + 0.005, v);
      // Plus fort vers la coupure (le loin), très discret au pied du vélo : sans cela, la décroissance avec la
      // distance et l'incidence rasante faisaient une flaque blanche autour de la roue et rien au-delà de 8 m.
      const ramp = 0.05 + 0.95 * smooth(0.08, cutoff - 0.04, v);
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
