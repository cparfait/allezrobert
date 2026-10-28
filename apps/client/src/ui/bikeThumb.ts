/**
 * Miniatures des vélos du garage : photos du vrai modèle 3D avec sa vraie livrée (public/bike-thumbs/<id>.webp, fabriquées par
 * bike-thumbs.html, voir bike-thumbs.ts). Le vélo sans marque prend la couleur choisie : sa photo (cadre blanc) est teintée.
 * Si une image manque (nouveau vélo pas encore photographié), le dessin d'avant la remplace.
 */

const BASE = `${import.meta.env.BASE_URL}bike-thumbs/`;

export const bikeThumbUrl = (id: string): string => `${BASE}${encodeURIComponent(id)}.webp`;

/** Vignette d'un vélo du catalogue ; `colors` (livrée) servent au dessin de remplacement si l'image ne charge pas (`swapMissingThumbs`). */
export function bikeThumbHtml(id: string, className: string, colors: readonly string[]): string {
  return `<img class="${className}" src="${bikeThumbUrl(id)}" alt="" loading="lazy" decoding="async" draggable="false" data-bikethumb="${colors.join(',')}" />`;
}

/** Les vignettes dont l'image est introuvable reprennent le dessin de remplacement fourni par `drawing(couleurs, grande)`. */
export function swapMissingThumbs(root: ParentNode, drawing: (colors: string[], big: boolean) => string): void {
  for (const img of root.querySelectorAll<HTMLImageElement>('img[data-bikethumb]')) {
    img.addEventListener(
      'error',
      () => {
        const colors = (img.dataset.bikethumb ?? '').split(',').filter(Boolean);
        img.outerHTML = drawing(colors, img.classList.contains('big'));
      },
      { once: true },
    );
  }
}

/** Vignette du vélo sans marque, à la couleur `color` (teintée à l'affichage par `paintPlainThumbs`). */
export function plainThumbHtml(color: string, className: string): string {
  return `<canvas class="${className}" width="320" height="200" data-plainthumb="${color}"></canvas>`;
}

let plain: Promise<HTMLImageElement | null> | null = null;

function plainImage(): Promise<HTMLImageElement | null> {
  plain ??= new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = bikeThumbUrl('plain');
  });
  return plain;
}

/**
 * Photo du vélo sans marque (cadre blanc) teintée : la couleur multiplie la photo, les ombres et les reflets sont gardés,
 * les pièces noires (pneus, groupe) restent noires. Les canvas `data-plainthumb` de `root` sont remplis.
 */
export async function paintPlainThumbs(root: ParentNode, onMissing: (el: HTMLCanvasElement) => void): Promise<void> {
  const canvases = [...root.querySelectorAll<HTMLCanvasElement>('canvas[data-plainthumb]')];
  if (!canvases.length) return;
  const img = await plainImage();
  for (const cv of canvases) {
    if (!img) {
      onMissing(cv);
      continue;
    }
    const g = cv.getContext('2d');
    if (!g) continue;
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    g.clearRect(0, 0, cv.width, cv.height);
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = cv.dataset.plainthumb ?? '#ffffff';
    g.fillRect(0, 0, cv.width, cv.height);
    // La multiplication a rempli tout le rectangle : on ne garde que la silhouette de la photo.
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-over';
  }
}
