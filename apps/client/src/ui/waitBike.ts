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

/** Robert en low poly, tour à tour sur son vélo (animé), bras croisés, et bras croisés à côté de son vélo. */
const LOW_POLY_POSES = ['velo', 'attente', 'attente-velo'];
let pose = 0;

/**
 * Robert en low poly (public/robert-lowpoly/, images détourées) : sur le vélo, il pédale comme l'illustration
 * d'origine (calques vélo, jambe, buste, bras levé animés en CSS, `.rb.rb-lp` dans index.html) ; sinon image fixe.
 */
function lowPoly(): HTMLElement {
  const name = LOW_POLY_POSES[pose++ % LOW_POLY_POSES.length] as string;
  if (name === 'velo') {
    const el = document.createElement('div');
    el.className = 'world-wait-bike rb rb-lp';
    el.setAttribute('aria-hidden', 'true');
    const l = (part: string, cls = '') => `<img src="/robert-lowpoly/velo-${part}.webp" alt=""${cls ? ` class="${cls}"` : ''}>`;
    el.innerHTML = `<div class="rb-bike">${l('base')}${l('leg', 'rb-leg')}<div class="rb-upper">${l('upper')}${l('arm', 'rb-arm')}</div></div>`;
    return el;
  }
  const img = document.createElement('img');
  img.className = 'world-wait-bike';
  img.alt = '';
  img.decoding = 'async';
  img.src = `/robert-lowpoly/${name}.webp`;
  img.onerror = () => {
    img.onerror = null;
    img.src = '/robert-attente.png';
  };
  return img;
}
