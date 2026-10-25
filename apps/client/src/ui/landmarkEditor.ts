import './landmarkEditor.css';
import { getLang } from '../i18n/index.ts';
import type { Landmark, Likeness, PhotoSession } from '../onboarding/likeness.ts';

/**
 * Retouche manuelle des repères du visage avant l'ajustement de l'avatar : le détecteur se trompe
 * parfois (angle, lunettes, barbe, cheveux sur le front) et l'avatar sortait alors avec une grosse
 * tête déformée. Ici, on voit la photo (en mémoire seulement) et les points clés ; on les glisse
 * sur les bons endroits, les repères voisins suivent en douceur, puis l'ajustement est refait.
 */

interface Handle {
  /** Indice du repère MediaPipe. */
  i: number;
  fr: string;
  en: string;
  group: 'eyes' | 'brows' | 'nose' | 'mouth' | 'face';
}

/** Points clés proposés (indices du maillage MediaPipe à 468 repères). */
const HANDLES: Handle[] = [
  { i: 33, fr: 'Œil droit, coin extérieur', en: 'Right eye, outer corner', group: 'eyes' },
  { i: 133, fr: 'Œil droit, coin intérieur', en: 'Right eye, inner corner', group: 'eyes' },
  { i: 362, fr: 'Œil gauche, coin intérieur', en: 'Left eye, inner corner', group: 'eyes' },
  { i: 263, fr: 'Œil gauche, coin extérieur', en: 'Left eye, outer corner', group: 'eyes' },
  { i: 70, fr: 'Sourcil droit, extérieur', en: 'Right brow, outer', group: 'brows' },
  { i: 107, fr: 'Sourcil droit, intérieur', en: 'Right brow, inner', group: 'brows' },
  { i: 336, fr: 'Sourcil gauche, intérieur', en: 'Left brow, inner', group: 'brows' },
  { i: 300, fr: 'Sourcil gauche, extérieur', en: 'Left brow, outer', group: 'brows' },
  { i: 168, fr: 'Haut du nez', en: 'Nose bridge', group: 'nose' },
  { i: 1, fr: 'Bout du nez', en: 'Nose tip', group: 'nose' },
  { i: 98, fr: 'Narine droite', en: 'Right nostril', group: 'nose' },
  { i: 327, fr: 'Narine gauche', en: 'Left nostril', group: 'nose' },
  { i: 61, fr: 'Bouche, coin droit', en: 'Mouth, right corner', group: 'mouth' },
  { i: 291, fr: 'Bouche, coin gauche', en: 'Mouth, left corner', group: 'mouth' },
  { i: 13, fr: 'Lèvre du haut', en: 'Upper lip', group: 'mouth' },
  { i: 14, fr: 'Lèvre du bas', en: 'Lower lip', group: 'mouth' },
  { i: 10, fr: 'Haut du front', en: 'Top of forehead', group: 'face' },
  { i: 234, fr: 'Tempe droite', en: 'Right temple', group: 'face' },
  { i: 454, fr: 'Tempe gauche', en: 'Left temple', group: 'face' },
  { i: 172, fr: 'Mâchoire droite', en: 'Right jaw', group: 'face' },
  { i: 397, fr: 'Mâchoire gauche', en: 'Left jaw', group: 'face' },
  { i: 152, fr: 'Menton', en: 'Chin', group: 'face' },
];

const COLORS: Record<Handle['group'], string> = { eyes: '#38bdf8', brows: '#a78bfa', nose: '#facc15', mouth: '#fb7185', face: '#4ade80' };

/** Contours tracés entre les points pour aider à voir la forme du visage. */
const CONTOURS: number[][] = [[234, 172, 152, 397, 454], [70, 107], [336, 300], [33, 133], [362, 263], [61, 13, 291, 14, 61], [168, 1]];

const SIGMA = 0.55;

/**
 * Ouvre la retouche pour une photo analysée ; renvoie la ressemblance recalculée avec les repères
 * corrigés, ou null si l'utilisateur annule. Sans visage détecté : couleurs seules, sans fenêtre.
 */
export function editLandmarks(session: PhotoSession): Promise<Likeness | null> {
  if (!session.landmarks.length) return Promise.resolve(session.colors);
  const fr = getLang() === 'fr';
  const orig = session.landmarks.map((l) => ({ ...l }));
  const cur = session.landmarks.map((l) => ({ ...l }));
  // Distance interoculaire (normalisée) : échelle de l'influence d'un point sur ses voisins.
  const iod = Math.hypot((orig[33] as Landmark).x - (orig[263] as Landmark).x, (orig[33] as Landmark).y - (orig[263] as Landmark).y) || 0.2;
  const sigma = iod * SIGMA;
  const { width: pw, height: ph } = session.preview;
  const overlay = document.createElement('div');
  overlay.className = 'lme-modal';
  overlay.innerHTML = `<div class="lme-dialog" role="dialog" aria-modal="true">
    <h2>${fr ? 'Ajuste les points de ton visage' : 'Adjust your face points'}</h2>
    <p>${fr ? 'Glisse chaque point à sa place sur la photo (coins des yeux, bout du nez, coins de la bouche, menton, mâchoire). Les points voisins suivent. Ta photo reste sur cet appareil et est effacée à la fermeture.' : 'Drag each point to its place on the photo (eye corners, nose tip, mouth corners, chin, jaw). Neighbouring points follow. Your photo stays on this device and is erased when you close this window.'}</p>
    <div class="lme-stage" style="aspect-ratio:${pw} / ${ph};width:min(100%, calc(62vh * ${(pw / ph).toFixed(3)}))"><svg class="lme-svg" viewBox="0 0 ${pw} ${ph}"></svg></div>
    <div class="lme-legend"><span style="--c:${COLORS.eyes}">${fr ? 'Yeux' : 'Eyes'}</span><span style="--c:${COLORS.brows}">${fr ? 'Sourcils' : 'Brows'}</span><span style="--c:${COLORS.nose}">${fr ? 'Nez' : 'Nose'}</span><span style="--c:${COLORS.mouth}">${fr ? 'Bouche' : 'Mouth'}</span><span style="--c:${COLORS.face}">${fr ? 'Visage' : 'Face'}</span></div>
    <div class="lme-foot"><button class="btn" data-act="reset">${fr ? 'Revenir à la détection' : 'Back to detection'}</button><button class="btn" data-act="cancel">${fr ? 'Annuler' : 'Cancel'}</button><button class="btn primary" data-act="ok">${fr ? 'Valider' : 'Apply'}</button></div>
  </div>`;
  const stage = overlay.querySelector('.lme-stage') as HTMLElement;
  stage.insertBefore(session.preview, stage.firstChild);
  session.preview.className = 'lme-photo';
  const svg = overlay.querySelector('.lme-svg') as SVGSVGElement;

  const P = (i: number): [number, number] => [(cur[i] as Landmark).x * pw, (cur[i] as Landmark).y * ph];
  const draw = () => {
    const lines = CONTOURS.map((c) => `<polyline class="lme-line" points="${c.map((i) => P(i).join(',')).join(' ')}"/>`).join('');
    const dots = HANDLES.map((h) => {
      const [x, y] = P(h.i);
      return `<g class="lme-pt" data-i="${h.i}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><title>${fr ? h.fr : h.en}</title><circle class="lme-hit" r="16"/><circle class="lme-dot" r="5.5" fill="${COLORS[h.group]}"/></g>`;
    }).join('');
    svg.innerHTML = lines + dots;
  };

  /** Déplace le repère `h` de (dx, dy) normalisés ; ses voisins suivent selon leur distance (gaussienne). */
  const moveBy = (h: number, dx: number, dy: number) => {
    const o = orig[h] as Landmark;
    for (let i = 0; i < cur.length; i++) {
      const d = Math.hypot((orig[i] as Landmark).x - o.x, (orig[i] as Landmark).y - o.y);
      const w = Math.exp(-((d / sigma) ** 2));
      if (w < 0.01) continue;
      (cur[i] as Landmark).x += dx * w;
      (cur[i] as Landmark).y += dy * w;
    }
  };

  let drag: { i: number; x: number; y: number } | null = null;
  const toNorm = (e: PointerEvent): [number, number] => {
    const r = svg.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };
  svg.addEventListener('pointerdown', (e) => {
    const g = (e.target as Element).closest<SVGGElement>('.lme-pt');
    if (!g) return;
    const [x, y] = toNorm(e);
    drag = { i: Number(g.dataset.i), x, y };
    svg.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const [x, y] = toNorm(e);
    moveBy(drag.i, x - drag.x, y - drag.y);
    drag.x = x;
    drag.y = y;
    draw();
  });
  const end = () => (drag = null);
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  return new Promise((resolve) => {
    const close = (result: Likeness | null) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(null);
    };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'cancel' || e.target === overlay) close(null);
      else if (act === 'reset') {
        for (let i = 0; i < cur.length; i++) {
          (cur[i] as Landmark).x = (orig[i] as Landmark).x;
          (cur[i] as Landmark).y = (orig[i] as Landmark).y;
        }
        draw();
      } else if (act === 'ok') close(session.likenessFrom(cur));
    });
    document.body.appendChild(overlay);
    draw();
  });
}

/**
 * Photo → ressemblance avec retouche manuelle des repères : analyse locale, fenêtre de retouche,
 * puis effacement de la photo. Renvoie null si l'utilisateur annule.
 */
export async function likenessWithEditing(file: File): Promise<Likeness | null> {
  const { analyzePhoto } = await import('../onboarding/likeness.ts');
  const session = await analyzePhoto(file);
  try {
    return await editLandmarks(session);
  } finally {
    session.dispose();
  }
}
