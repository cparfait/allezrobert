/**
 * Robert, le guide du tutoriel, au-dessus des barres d'attente, tour à tour sur son vélo poing levé et bras
 * croisés qui patiente (un écran d'attente sur deux ; tools/robert-attente).
 * Sur le vélo, il pédale : calques de l'illustration animés en CSS (`.rb` dans index.html), uniquement par
 * transform pour que l'animation tourne même quand le chargement bloque la page. Bras croisés : image fixe.
 */
import { LOW_POLY } from '../engine/style.ts';

let next = 0;

export function waitBike(): HTMLElement {
  // Style jeu vidéo : Robert en low poly (public/robert-lowpoly/velo.png et attente.png), image fixe ;
  // repli sur l'illustration d'origine si les images manquent.
  if (LOW_POLY) return lowPoly();
  if (next++ % 2 === 0) return riding();
  const img = document.createElement('img');
  img.className = 'world-wait-bike';
  img.src = '/robert-attente.png';
  img.alt = '';
  img.decoding = 'async';
  return img;
}

/** Robert qui pédale : vélo (avec bassin et mains), jambe, buste et poing levé, chacun sur son calque. */
function riding(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'world-wait-bike rb';
  el.setAttribute('aria-hidden', 'true');
  const l = (name: string, cls = '') => `<img src="/robert-velo/${name}.webp" alt=""${cls ? ` class="${cls}"` : ''}>`;
  el.innerHTML = `<div class="rb-bike">${l('base')}${l('leg', 'rb-leg')}<div class="rb-upper">${l('upper')}${l('arm', 'rb-arm')}</div></div>`;
  return el;
}

/** Robert en low poly, tour à tour poing levé sur son vélo, bras croisés, et à côté de son vélo. */
const LOW_POLY_POSES = ['velo', 'attente', 'attente-velo'];
let pose = 0;

/**
 * Robert en low poly (public/robert-lowpoly/*.webp), présenté en carte claire aux coins arrondis (les images
 * ont un fond blanc). Une version à fond transparent s'affiche détourée sans autre changement.
 */
function lowPoly(): HTMLElement {
  const img = document.createElement('img');
  img.className = 'world-wait-bike rb-card';
  img.alt = '';
  img.decoding = 'async';
  const name = LOW_POLY_POSES[pose++ % LOW_POLY_POSES.length] as string;
  img.src = `/robert-lowpoly/${name}.webp`;
  img.onerror = () => {
    img.onerror = null;
    img.className = 'world-wait-bike';
    img.src = name === 'velo' ? '/robert-velo.png' : '/robert-attente.png';
  };
  return img;
}
