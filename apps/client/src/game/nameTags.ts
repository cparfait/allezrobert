import * as THREE from 'three/webgpu';
import { flagSvg } from '../ui/flagSvg.ts';

/**
 * Noms au-dessus des coureurs IA en texte de la page (et non en image dans la scène 3D) : nets quelle que soit la
 * résolution de rendu. En sprite, le nom était dessiné sur 256 × 64 px puis réduit à ~97 × 24 px avec des mipmaps,
 * dans une image elle-même rendue en 1092 px de haut puis agrandie, et repassée par l'anticrénelage : baveux.
 */
export interface NameTag {
  /** Point d'ancrage dans la scène (au-dessus de la tête) : sa position et `visible` pilotent l'étiquette. */
  anchor: THREE.Object3D;
  el: HTMLDivElement;
}

let layer: HTMLDivElement | null = null;

function tagLayer(): HTMLDivElement {
  if (layer?.isConnected) return layer;
  layer = document.createElement('div');
  layer.className = 'name-tags';
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;overflow:hidden';
  // Juste après le canevas du jeu : le HUD, plus loin dans la page, reste au-dessus des noms.
  const canvas = document.querySelector('canvas#scene');
  if (canvas?.parentElement) canvas.parentElement.insertBefore(layer, canvas.nextSibling);
  else document.body.appendChild(layer);
  return layer;
}

/** « Matteo MORETTI » → « M. MORETTI ». */
export function shortRiderName(text: string): string {
  const parts = text.trim().split(/\s+/);
  return parts.length > 1 ? `${(parts[0] ?? '').charAt(0)}. ${parts.slice(1).join(' ')}` : text;
}

export function createNameTag(text: string, nationality?: string): NameTag {
  const el = document.createElement('div');
  el.style.cssText =
    'position:absolute;left:0;top:0;display:none;align-items:center;gap:6px;padding:3px 9px 3px 7px;border-radius:6px;' +
    'background:rgba(10,14,22,0.78);color:#f5f7fa;font:700 13px/1.2 Inter,"Segoe UI",sans-serif;white-space:nowrap;' +
    'transform:translate(-50%,-100%);transform-origin:50% 100%;transition:opacity .25s;will-change:transform';
  const flag = nationality ? flagSvg(nationality, 12) : '';
  const name = shortRiderName(text).replace(/[<>&]/g, '');
  el.innerHTML = `${flag ? `<span style="display:inline-flex">${flag}</span>` : ''}<span>${name}</span>` +
    '<i style="position:absolute;left:50%;bottom:-5px;margin-left:-5px;border:5px solid transparent;border-bottom:0;border-top-color:rgba(10,14,22,0.78)"></i>';
  tagLayer().appendChild(el);
  const anchor = new THREE.Object3D();
  anchor.visible = false;
  return { anchor, el };
}

const _v = new THREE.Vector3();

/** Place les étiquettes visibles à l'écran (une fois par image, après le déplacement des coureurs). */
// Rectangle du canevas mis en cache : relu à chaque image, getBoundingClientRect forçait un recalcul de mise en page
// (les étiquettes déplacées à l'image précédente l'invalident), ≈ 2 % du temps processeur en groupe.
let rectCanvas: HTMLCanvasElement | null = null;
let rectCache: DOMRect | null = null;
let rectWatch: ResizeObserver | null = null;
let rectListening = false;
const dropRect = () => {
  rectCache = null;
};

function canvasRect(): DOMRect | null {
  if (!rectCanvas?.isConnected) {
    rectCanvas = document.querySelector<HTMLCanvasElement>('canvas#scene') ?? document.querySelector('canvas');
    rectCache = null;
    rectWatch?.disconnect();
    rectWatch = null;
    if (!rectCanvas) return null;
    if (typeof ResizeObserver !== 'undefined') {
      rectWatch = new ResizeObserver(dropRect);
      rectWatch.observe(rectCanvas);
    }
    if (!rectListening) {
      rectListening = true;
      addEventListener('resize', dropRect);
      addEventListener('scroll', dropRect, true);
    }
  }
  return (rectCache ??= rectCanvas.getBoundingClientRect());
}

const _cam = new THREE.Vector3();
/** Étiquettes placées à cette image (les plus proches d'abord) : sert à écarter celles qui se recouvrent. */
const placed: Array<{ x: number; y: number; w: number }> = [];
const order: Array<{ t: NameTag; d: number; x: number; y: number }> = [];
/** Largeur approximative d'une étiquette (px) : lue une fois, à la première apparition. */
const widths = new WeakMap<HTMLElement, number>();

/**
 * Lisibilité en peloton : opacité et taille diminuent avec la distance (pleine jusqu'à 25 m, 40 % et 75 % à 90 m),
 * et une étiquette qui recouvre plus de la moitié d'une étiquette plus proche est masquée.
 */
export function placeNameTags(tags: readonly NameTag[], camera: THREE.Camera): void {
  camera.updateMatrixWorld();
  camera.getWorldPosition(_cam);
  const rect = canvasRect();
  order.length = 0;
  for (const t of tags) {
    let show = t.anchor.visible && !!rect;
    if (show && rect) {
      _v.copy(t.anchor.position).project(camera);
      show = _v.z > -1 && _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
      if (show) order.push({ t, d: t.anchor.position.distanceTo(_cam), x: rect.left + ((_v.x + 1) / 2) * rect.width, y: rect.top + ((1 - _v.y) / 2) * rect.height });
    }
    if (!show && t.el.style.display !== 'none') t.el.style.display = 'none';
  }
  order.sort((a, b) => a.d - b.d);
  placed.length = 0;
  for (const o of order) {
    const k = Math.min(1, Math.max(0, (o.d - 25) / 65));
    const scale = 1 - 0.25 * k;
    const el = o.t.el;
    if (el.style.display !== 'flex') el.style.display = 'flex';
    let w = widths.get(el);
    if (w === undefined) {
      w = el.offsetWidth || 90;
      widths.set(el, w);
    }
    w *= scale;
    const covered = placed.some((p) => Math.abs(p.y - o.y) < 18 * scale && Math.abs(p.x - o.x) < (p.w + w) / 4);
    const opacity = covered ? 0 : 1 - 0.6 * k;
    if (!covered) placed.push({ x: o.x, y: o.y, w });
    el.style.transform = `translate(${o.x.toFixed(1)}px,${o.y.toFixed(1)}px) translate(-50%,-100%) scale(${scale.toFixed(2)})`;
    const op = opacity.toFixed(2);
    if (el.style.opacity !== op) el.style.opacity = op;
  }
}

export function removeNameTag(t: NameTag): void {
  t.el.remove();
}
