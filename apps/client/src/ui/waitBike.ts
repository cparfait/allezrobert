/**
 * Robert, le guide du tutoriel, qui patiente bras croisés au-dessus des barres d'attente : image fixe
 * (public/robert-attente.png). Pas d'animation : pendant un chargement, le processeur a mieux à faire.
 */
export function waitBike(): HTMLElement {
  const img = document.createElement('img');
  img.className = 'world-wait-bike';
  img.src = '/robert-attente.png';
  img.alt = '';
  img.decoding = 'async';
  return img;
}
