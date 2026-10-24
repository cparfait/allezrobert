/**
 * Robert, le guide du tutoriel, au-dessus des barres d'attente : image fixe, tour à tour sur son vélo poing
 * levé et bras croisés qui patiente (une image par écran d'attente, en alternance ; tools/robert-attente).
 * Pas d'animation : pendant un chargement, le processeur a mieux à faire.
 */
const IMAGES = ['/robert-attente-velo.png', '/robert-attente.png'];
let next = 0;

export function waitBike(): HTMLElement {
  const img = document.createElement('img');
  img.className = 'world-wait-bike';
  img.src = IMAGES[next++ % IMAGES.length] as string;
  img.alt = '';
  img.decoding = 'async';
  return img;
}
