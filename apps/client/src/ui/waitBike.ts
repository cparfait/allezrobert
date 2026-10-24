/**
 * Robert, le guide du tutoriel, sur son home trainer au-dessus des barres d'attente : image fixe
 * (tools/robert-trainer). Pas d'animation : pendant un chargement, le processeur a mieux à faire.
 */
export function waitBike(): HTMLElement {
  const img = document.createElement('img');
  img.className = 'world-wait-bike';
  img.src = '/robert-trainer.png';
  img.alt = '';
  img.decoding = 'async';
  return img;
}
