import type { FaceLandmarker } from '@mediapipe/tasks-vision';
import { STIFFNESS, fitSliders, pointWeights, shapeVector, tameSliders, type LikenessCalibration, type TameOptions } from './likenessFit.ts';
import { beardFromImage } from './beard.ts';
import calibration from './likenessCalib.json';

/**
 * Ressemblance à partir d'une photo (docs/AVATARS.md § 11) : teint, couleur des cheveux et
 * curseurs de forme du visage.
 *
 * Donnée personnelle sensible : réservé à une photo de soi, avec consentement explicite.
 * Traitement 100 % local : la photo est décodée en mémoire, passée au détecteur de repères
 * (MediaPipe Face Landmarker, Apache 2.0, modèle et WebAssembly servis par le jeu lui-même :
 * aucune requête vers un tiers), puis effacée ; elle n'est ni envoyée ni conservée. Seuls les
 * réglages (curseurs, teint, cheveux) sortent de ce module.
 *
 * Les repères détectés peuvent être corrigés à la main (ui/landmarkEditor.ts) avant l'ajustement :
 * c'est ce qui évite les visages déformés quand le détecteur se trompe (angle, lunettes, barbe).
 *
 * Sans visage détecté : teint et cheveux seulement, sur un cadrage de face supposé (V1).
 */
export interface Likeness {
  skin: string;
  hair: string;
  /** Curseurs du visage (absents si aucun visage n'a été détecté). */
  face?: Record<string, number>;
  /** Barbe (0 = rasé → 1 = barbe courte), d'après le menton et le bas des joues. */
  beard?: number;
}

/** Repère de visage (coordonnées normalisées de l'image). */
export type Landmark = { x: number; y: number; z: number };

/**
 * Photo analysée, gardée en mémoire le temps de la retouche des repères : jamais envoyée ni
 * stockée ; `dispose()` efface les pixels.
 */
export interface PhotoSession {
  width: number;
  height: number;
  /** Repères détectés (468 + iris) ; vide si aucun visage n'a été trouvé. */
  landmarks: Landmark[];
  /** Photo réduite pour l'écran de retouche (même cadrage que les repères). */
  preview: HTMLCanvasElement;
  /** Teint et cheveux seuls (aucun visage détecté). */
  colors: Likeness;
  /** Teint, cheveux et curseurs d'après des repères (détectés ou retouchés à la main). */
  likenessFrom(lm: Landmark[]): Likeness;
  dispose(): void;
}

let landmarker: Promise<FaceLandmarker> | null = null;

/** Détecteur chargé à la demande (code, WebAssembly et modèle : ~10 Mo, une seule fois). */
function getLandmarker(): Promise<FaceLandmarker> {
  landmarker ??= (async () => {
    const [{ FaceLandmarker }, loader, binary] = await Promise.all([
      import('@mediapipe/tasks-vision'),
      import('@mediapipe/tasks-vision/vision_wasm_internal.js?url'),
      import('@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'),
    ]);
    return FaceLandmarker.createFromOptions(
      { wasmLoaderPath: loader.default, wasmBinaryPath: binary.default },
      {
        baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}models/face/face_landmarker.task`, delegate: 'CPU' },
        runningMode: 'IMAGE',
        numFaces: 1,
      },
    );
  })();
  landmarker.catch(() => (landmarker = null));
  return landmarker;
}

/** Repères du visage d'une image (coordonnées normalisées), ou null. */
export async function faceLandmarks(image: ImageBitmap | HTMLCanvasElement | OffscreenCanvas): Promise<Landmark[] | null> {
  const lm = await getLandmarker();
  const res = lm.detect(image as unknown as HTMLCanvasElement);
  return res.faceLandmarks[0] ?? null;
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
}

/** Médiane par canal d'une zone (robuste aux reflets et aux ombres). */
function medianColor(data: Uint8ClampedArray, w: number, x0: number, y0: number, x1: number, y1: number): [number, number, number] {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let y = Math.floor(y0); y < y1; y += 2)
    for (let x = Math.floor(x0); x < x1; x += 2) {
      const i = (y * w + x) * 4;
      rs.push(data[i] as number);
      gs.push(data[i + 1] as number);
      bs.push(data[i + 2] as number);
    }
  const med = (a: number[]) => a.sort((p, q) => p - q)[Math.floor(a.length / 2)] ?? 0;
  return [med(rs), med(gs), med(bs)];
}

/** Décode la photo, détecte le visage et garde le tout en mémoire jusqu'à `dispose()`. */
export async function analyzePhoto(file: File): Promise<PhotoSession> {
  const bitmap = await createImageBitmap(file);
  const W = bitmap.width;
  const H = bitmap.height;
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  ctx.drawImage(bitmap, 0, 0);
  let landmarks: Landmark[] = [];
  try {
    landmarks = (await faceLandmarks(bitmap).catch(() => null)) ?? [];
  } catch {
    landmarks = [];
  }
  const preview = document.createElement('canvas');
  const k = Math.min(1, 560 / Math.max(W, H));
  preview.width = Math.round(W * k);
  preview.height = Math.round(H * k);
  (preview.getContext('2d') as CanvasRenderingContext2D).drawImage(bitmap, 0, 0, preview.width, preview.height);
  const colors = colorsOnly(bitmap);
  bitmap.close();
  return {
    width: W,
    height: H,
    landmarks,
    preview,
    colors,
    likenessFrom: (lm) => likenessFromLandmarks(ctx, W, H, lm),
    dispose() {
      ctx.clearRect(0, 0, W, H);
      canvas.width = canvas.height = 1;
      preview.getContext('2d')?.clearRect(0, 0, preview.width, preview.height);
      preview.width = preview.height = 1;
    },
  };
}

/** Ressemblance automatique (sans retouche des repères) : photo effacée aussitôt. */
export async function likenessFromPhoto(file: File): Promise<Likeness> {
  const a = await analyzePhoto(file);
  try {
    return a.landmarks.length ? a.likenessFrom(a.landmarks) : a.colors;
  } finally {
    a.dispose();
  }
}

export interface FitOptions extends TameOptions {
  /** Multiplicateur de la régularisation de l'étalonnage. */
  lambdaMul: number;
  /** Poids fort au voisinage des points posés à la main, faible ailleurs (voir pointWeights). */
  weighted: boolean;
  /** Curseurs de volume mou et de traits devinés plus difficiles à écarter (voir STIFFNESS). */
  stiff: boolean;
}

/** Réglage de l'ajustement d'après photo. */
export const DEFAULT_FIT: FitOptions = { lambdaMul: 3, weighted: true, stiff: true, shrink: 0.9, limitScale: 1.3 };

/** Curseurs du visage d'après les repères d'une photo (largeur / hauteur de l'image : `aspect`). */
export function faceFromLandmarks(lm: readonly Landmark[], aspect: number, opts: FitOptions = DEFAULT_FIT, beard = 0): Record<string, number> {
  const cal = calibration as LikenessCalibration;
  // Ajustement régularisé, puis curseurs plafonnés : pas de tête déformée.
  return tameSliders(fitSliders(shapeVector(lm, cal, aspect), cal, cal.lambda * opts.lambdaMul, opts.weighted ? pointWeights(cal, beard) : undefined, opts.stiff ? STIFFNESS : undefined), opts);
}

/** Teint (joues et front), cheveux (au-dessus du front) et curseurs, à partir des repères. */
function likenessFromLandmarks(ctx: OffscreenCanvasRenderingContext2D, W: number, H: number, lm: readonly Landmark[]): Likeness {
  const iod = Math.hypot(((lm[33]?.x ?? 0) - (lm[263]?.x ?? 0)) * W, ((lm[33]?.y ?? 0) - (lm[263]?.y ?? 0)) * H);
  const patch = (i: number, dy = 0, r = 0.12): [number, number, number] => {
    const c = lm[i] ?? { x: 0.5, y: 0.5 };
    const cx = c.x * W;
    const cy = c.y * H + dy * iod;
    const h = Math.max(2, r * iod);
    const x0 = Math.max(0, Math.round(cx - h));
    const y0 = Math.max(0, Math.round(cy - h));
    const x1 = Math.min(W, Math.round(cx + h));
    const y1 = Math.min(H, Math.round(cy + h));
    if (x1 <= x0 || y1 <= y0) return [128, 128, 128];
    const { data } = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
    const col = medianColor(data, x1 - x0, 0, 0, x1 - x0, y1 - y0);
    data.fill(0);
    return col;
  };
  // Joues (sous les pommettes) et front ; cheveux : au-dessus du haut du front.
  const cheeks = [patch(50), patch(280), patch(151, 0, 0.1)];
  const skin = [0, 1, 2].map((k) => cheeks.map((c) => c[k] as number).sort((a, b) => a - b)[1] as number) as [number, number, number];
  const hair = patch(10, -0.35, 0.1);
  const beard = beardFromImage(ctx, lm, W, H);
  const face = faceFromLandmarks(lm, W / H, DEFAULT_FIT, beard);
  return { skin: toHex(...skin), hair: toHex(...hair), face, beard };
}

function colorsOnly(bitmap: ImageBitmap): Likeness {
  const size = 256;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
  // Recadrage carré centré.
  const side = Math.min(bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  // Joues (sous les yeux, de part et d'autre du nez) pour le teint ; haut du crâne pour les cheveux.
  const left = medianColor(data, size, size * 0.3, size * 0.5, size * 0.42, size * 0.62);
  const right = medianColor(data, size, size * 0.58, size * 0.5, size * 0.7, size * 0.62);
  const hair = medianColor(data, size, size * 0.35, size * 0.04, size * 0.65, size * 0.16);
  const skin: [number, number, number] = [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2, (left[2] + right[2]) / 2];
  // Les données de pixels ne quittent pas cette fonction.
  data.fill(0);
  return { skin: toHex(...skin), hair: toHex(...hair) };
}
