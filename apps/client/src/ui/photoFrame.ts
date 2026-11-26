/**
 * Mode photo de la sortie : la touche P prend la vue (sans l'interface) dans un cadre blanc, légendée (lieu, parcours,
 * kilomètre, date), avec un filtre au choix (Maj+P : naturel, chaud, noir et blanc, rétro). La photo est enregistrée et
 * rejoint celles du sommet des côtes (bilan, image de partage, vidéo résumé).
 */
export type PhotoFilter = 'naturel' | 'chaud' | 'nb' | 'retro';
export const PHOTO_FILTERS: readonly PhotoFilter[] = ['naturel', 'chaud', 'nb', 'retro'];
const CSS: Record<PhotoFilter, string> = {
  naturel: 'none',
  chaud: 'sepia(0.3) saturate(1.25) contrast(1.05) brightness(1.03)',
  nb: 'grayscale(1) contrast(1.12)',
  retro: 'sepia(0.55) saturate(0.85) contrast(0.95) brightness(1.06)',
};
const LABEL: Record<PhotoFilter, { fr: string; en: string }> = {
  naturel: { fr: 'Naturel', en: 'Natural' },
  chaud: { fr: 'Chaud', en: 'Warm' },
  nb: { fr: 'Noir et blanc', en: 'Black & white' },
  retro: { fr: 'Rétro', en: 'Retro' },
};
const KEY = 'ar.photoFilter';

export function photoFilter(): PhotoFilter {
  try {
    const v = localStorage.getItem(KEY) as PhotoFilter | null;
    return v && PHOTO_FILTERS.includes(v) ? v : 'naturel';
  } catch {
    return 'naturel';
  }
}

/** Filtre suivant (Maj+P), gardé pour les sorties suivantes ; renvoie son nom à afficher. */
export function cyclePhotoFilter(lang: 'fr' | 'en'): string {
  const next = PHOTO_FILTERS[(PHOTO_FILTERS.indexOf(photoFilter()) + 1) % PHOTO_FILTERS.length]!;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* réglage non gardé */
  }
  return LABEL[next][lang];
}

export interface PhotoCaption {
  place: string;
  route: string;
  km: number;
  lang: 'fr' | 'en';
}

/** Photo encadrée et légendée (JPEG, data URL) à partir de la vue du jeu. */
export function framePhoto(view: HTMLCanvasElement, cap: PhotoCaption, filter = photoFilter()): string {
  const W = view.width;
  const H = view.height;
  const pad = Math.round(Math.min(W, H) * 0.03);
  const band = Math.round(H * 0.1);
  const c = document.createElement('canvas');
  c.width = W + pad * 2;
  c.height = H + pad + band;
  const g = c.getContext('2d');
  if (!g) return view.toDataURL('image/jpeg', 0.9);
  g.fillStyle = '#fbfaf6';
  g.fillRect(0, 0, c.width, c.height);
  g.filter = CSS[filter];
  g.drawImage(view, pad, pad);
  g.filter = 'none';
  const fs = Math.round(band * 0.3);
  g.fillStyle = '#1f2a2c';
  g.textBaseline = 'middle';
  g.font = `700 ${fs}px Inter, "Segoe UI", system-ui, sans-serif`;
  const y = H + pad + band / 2;
  g.textAlign = 'left';
  g.fillText(`${cap.place} · ${cap.route}`, pad, y - fs * 0.35);
  g.font = `500 ${Math.round(fs * 0.75)}px Inter, "Segoe UI", system-ui, sans-serif`;
  g.fillStyle = '#5d6b6c';
  const date = new Date().toLocaleDateString(cap.lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  g.fillText(`${cap.km.toFixed(1).replace('.', cap.lang === 'fr' ? ',' : '.')} km · ${date}`, pad, y + fs * 0.6);
  g.textAlign = 'right';
  g.font = `800 ${fs}px Inter, "Segoe UI", system-ui, sans-serif`;
  g.fillStyle = '#e2604f';
  g.fillText('Allez Robert !', c.width - pad, y);
  return c.toDataURL('image/jpeg', 0.9);
}
