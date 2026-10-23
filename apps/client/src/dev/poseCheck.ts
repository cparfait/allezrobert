/**
 * Mesure de posture (développement) : MediaPipe Pose sur une photo de cycliste de profil ou sur un
 * rendu du jeu, mêmes mesures des deux côtés pour comparer.
 *
 * Modèle `pose_landmarker_heavy.task` (Google, non versionné) dans `public/__pose/`.
 *
 * - torse : angle hanche → épaule au-dessus de l'horizontale (degrés) ;
 * - tête : oreille par rapport à l'épaule, en longueurs de torse (avant, haut) et angle ;
 * - coude : angle épaule-coude-poignet (180 = tendu) ;
 * - dos : écart de la silhouette dorsale à la ligne droite entre ses deux bouts, au milieu du dos,
 *   en % de la longueur du torse : négatif = creusé, positif = bosse.
 */
import type { PoseLandmarker } from '@mediapipe/tasks-vision';

export interface PoseMetrics {
  torso: number;
  headFwd: number;
  headUp: number;
  neckAngle: number;
  elbow: number;
  /** Profil du dos (12 points de la hanche à l'épaule), écart à la corde, % du torse. */
  back: number[];
  backMin: number;
  backMax: number;
}

let landmarker: Promise<PoseLandmarker> | null = null;

function getLandmarker(): Promise<PoseLandmarker> {
  landmarker ??= (async () => {
    const [{ PoseLandmarker }, loader, binary] = await Promise.all([
      import('@mediapipe/tasks-vision'),
      import('@mediapipe/tasks-vision/vision_wasm_internal.js?url'),
      import('@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'),
    ]);
    return PoseLandmarker.createFromOptions(
      { wasmLoaderPath: loader.default, wasmBinaryPath: binary.default },
      {
        // GPU : sur le processeur, le masque de segmentation fait planter MediaPipe (ImageFrame).
        baseOptions: { modelAssetPath: '/__pose/pose_landmarker_heavy.task', delegate: 'GPU' },
        runningMode: 'IMAGE',
        numPoses: 1,
        outputSegmentationMasks: true,
      },
    );
  })();
  return landmarker;
}

type P = { x: number; y: number };

/** Mesures d'une image (null : personne non détectée). `draw` : contexte où tracer les repères. */
export async function measurePose(src: HTMLCanvasElement | HTMLImageElement, draw?: CanvasRenderingContext2D): Promise<PoseMetrics | null> {
  const lm = await getLandmarker();
  const res = lm.detect(src);
  const l = res.landmarks[0];
  const mask = res.segmentationMasks?.[0];
  if (!l) return null;
  const W = src instanceof HTMLImageElement ? src.naturalWidth : src.width;
  const H = src instanceof HTMLImageElement ? src.naturalHeight : src.height;
  const px = (i: number): P => ({ x: (l[i]?.x ?? 0) * W, y: (l[i]?.y ?? 0) * H });
  const vis = (ids: number[]) => ids.reduce((s, i) => s + (l[i]?.visibility ?? 0), 0);
  // côté le plus visible (gauche : 7 oreille, 11 épaule, 13 coude, 15 poignet, 23 hanche)
  const side = vis([7, 11, 13, 15, 23]) >= vis([8, 12, 14, 16, 24]) ? [7, 11, 13, 15, 23] : [8, 12, 14, 16, 24];
  const [ear, sh, el, wr, hip] = side.map(px) as [P, P, P, P, P];
  // sens de marche : le poignet est devant l'épaule
  const dir = Math.sign(wr.x - sh.x) || 1;
  const torsoLen = Math.hypot(sh.x - hip.x, sh.y - hip.y);
  const torso = (Math.atan2(hip.y - sh.y, (sh.x - hip.x) * dir) * 180) / Math.PI;
  const headFwd = ((ear.x - sh.x) * dir) / torsoLen;
  const headUp = (sh.y - ear.y) / torsoLen;
  const neckAngle = (Math.atan2(sh.y - ear.y, (ear.x - sh.x) * dir) * 180) / Math.PI;
  const a = { x: sh.x - el.x, y: sh.y - el.y };
  const b = { x: wr.x - el.x, y: wr.y - el.y };
  const elbow = (Math.acos((a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y))) * 180) / Math.PI;
  // Silhouette dorsale : depuis la corde hanche → épaule, on remonte (côté dos, normale « vers le
  // haut et l'arrière ») jusqu'au bord du masque.
  const back: number[] = [];
  if (mask) {
    const m = mask.getAsFloat32Array();
    const mw = mask.width;
    const mh = mask.height;
    const inside = (x: number, y: number) => {
      const i = Math.round((y / H) * mh) * mw + Math.round((x / W) * mw);
      return (m[i] ?? 0) > 0.5;
    };
    const ux = (sh.x - hip.x) / torsoLen;
    const uy = (sh.y - hip.y) / torsoLen;
    // normale côté dos : celle qui monte (y écran décroissant)
    let nx = uy;
    let ny = -ux;
    if (ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    const d: number[] = [];
    for (let k = 0; k < 12; k++) {
      const t = 0.08 + (0.84 * k) / 11;
      const cx = hip.x + (sh.x - hip.x) * t;
      const cy = hip.y + (sh.y - hip.y) * t;
      // dernier pixel du corps sur le rayon (le masque a parfois des trous dans le maillot)
      let s = 0;
      for (let r = 0; r < torsoLen * 0.5; r += 0.5) if (inside(cx + nx * r, cy + ny * r)) s = r;
      d.push(s);
      if (draw) {
        draw.fillStyle = '#ff2';
        draw.fillRect(cx + nx * s - 2, cy + ny * s - 2, 4, 4);
      }
    }
    const d0 = d[0] as number;
    const d1 = d[d.length - 1] as number;
    for (let k = 0; k < d.length; k++) back.push(+(((d[k] as number) - (d0 + ((d1 - d0) * k) / (d.length - 1))) / torsoLen * 100).toFixed(1));
    mask.close();
  }
  if (draw) {
    draw.strokeStyle = '#0f0';
    draw.lineWidth = 3;
    draw.beginPath();
    draw.moveTo(hip.x, hip.y);
    draw.lineTo(sh.x, sh.y);
    draw.lineTo(ear.x, ear.y);
    draw.moveTo(sh.x, sh.y);
    draw.lineTo(el.x, el.y);
    draw.lineTo(wr.x, wr.y);
    draw.stroke();
  }
  const mid = back.slice(2, 10);
  return {
    torso: +torso.toFixed(1),
    headFwd: +headFwd.toFixed(2),
    headUp: +headUp.toFixed(2),
    neckAngle: +neckAngle.toFixed(1),
    elbow: +elbow.toFixed(1),
    back,
    backMin: mid.length ? Math.min(...mid) : 0,
    backMax: mid.length ? Math.max(...mid) : 0,
  };
}

/** Planche : chaque image avec ses repères, mesures dans window.__pose. */
export async function poseSheet(urls: string[]): Promise<void> {
  const out: Array<{ url: string; m: PoseMetrics | null }> = [];
  const sheet = document.createElement('div');
  sheet.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;background:#fff';
  for (const url of urls) {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    g.drawImage(img, 0, 0);
    const m = await measurePose(img, g);
    out.push({ url, m });
    g.fillStyle = '#000';
    g.font = '600 14px system-ui';
    if (m) g.fillText(`torse ${m.torso}° tête +${m.headFwd}/${m.headUp} dos ${m.backMin}/${m.backMax}`, 6, 18);
    sheet.appendChild(c);
  }
  document.body.replaceChildren(sheet);
  (window as unknown as { __pose: unknown }).__pose = out;
}
