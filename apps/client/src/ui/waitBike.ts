/**
 * Robert, le guide du tutoriel, au-dessus des barres d'attente, tour à tour sur son vélo poing levé et bras
 * croisés qui patiente (un écran d'attente sur deux ; tools/robert-attente).
 * Sur le vélo, il pédale : calques de l'illustration animés en CSS (`.rb` dans index.html), uniquement par
 * transform pour que l'animation tourne même quand le chargement bloque la page. Bras croisés : image fixe.
 */

import { LOW_POLY } from '../engine/style.ts';

let next = 0;

/** Image de Robert bras croisés (écrans d'attente, messages d'échec) selon le style graphique. */
export function crossedArmsSrc(): string {
  return LOW_POLY ? '/robert-lowpoly/attente.webp' : '/robert-attente.png';
}

/** Robert d'un écran d'attente, tour à tour sur son vélo (il pédale) et bras croisés ; low poly en style jeu vidéo. */
export function waitBike(): HTMLElement {
  if (next++ % 2 === 0) return riding();
  const img = document.createElement('img');
  img.className = 'world-wait-bike';
  img.src = crossedArmsSrc();
  img.alt = '';
  img.decoding = 'async';
  return img;
}

/** Robert qui pédale : vélo (avec bassin et mains), jambe, buste et poing levé, chacun sur son calque. */
function riding(): HTMLElement {
  const dir = LOW_POLY ? 'robert-velo-poly' : 'robert-velo';
  const el = document.createElement('div');
  el.className = 'world-wait-bike rb';
  el.setAttribute('aria-hidden', 'true');
  const l = (name: string, cls = '') => `<img src="/${dir}/${name}.webp" alt=""${cls ? ` class="${cls}"` : ''}>`;
  el.innerHTML = `<div class="rb-bike">${l('base')}${l('leg', 'rb-leg')}<div class="rb-upper">${l('upper')}${l('arm', 'rb-arm')}</div></div>`;
  return el;
}
