/**
 * Encodage du film d'accueil : arguments ffmpeg (fonctions pures, testées) pour refermer la
 * boucle et produire le WebM VP9 (principal) et le MP4 H.264 (repli).
 *
 * Les images capturées couvrent loopS + xfadeS secondes. La vidéo finale dure loopS :
 *   images [F, L) telles quelles, puis les F dernières images (L…L+F) fondues dans les F premières.
 * La dernière image fondue est presque l'image F-1, suivie (en boucle) de l'image F : raccord invisible.
 */

export interface Manifest {
  season: string;
  fps: number;
  width: number;
  height: number;
  frames: number;
  loopS: number;
  xfadeS: number;
  routeId: string;
  d0: number;
  hour: number;
}

export interface EncodeOptions {
  /** Taille de sortie (les images sont réduites : suréchantillonnage). */
  width: number;
  height: number;
  /** Débit visé (kbit/s) ; 60 s à 780 kbit/s ≈ 5,7 Mo. */
  webmKbps: number;
  mp4Kbps: number;
}

export const DEFAULT_ENCODE: EncodeOptions = { width: 1600, height: 900, webmKbps: 780, mp4Kbps: 700 };

/** Bornes de la boucle en images : L = durée de la boucle, F = fondu de raccord. */
export function loopFrames(m: Pick<Manifest, 'fps' | 'loopS' | 'xfadeS' | 'frames'>): { L: number; F: number } {
  const L = Math.round(m.loopS * m.fps);
  const F = Math.round(m.xfadeS * m.fps);
  if (m.frames < L + F) throw new Error(`${m.frames} images capturées, ${L + F} attendues`);
  return { L, F };
}

/** Graphe de filtres : corps [F, L) puis fondu des images [L, L+F) vers [0, F), réduction, yuv420p. */
export function loopFilter(m: Manifest, o: Pick<EncodeOptions, 'width' | 'height'>): string {
  const { L, F } = loopFrames(m);
  // Poids de l'image de début : (N+1)/(F+1), de 1/(F+1) à F/(F+1) (jamais une image pure de part et d'autre).
  const mix = `A+(B-A)*(N+1)/${F + 1}`;
  return [
    '[0:v]split=3[a][b][c]',
    `[a]trim=start_frame=${F}:end_frame=${L},setpts=PTS-STARTPTS[body]`,
    `[b]trim=start_frame=${L}:end_frame=${L + F},setpts=PTS-STARTPTS[tail]`,
    `[c]trim=start_frame=0:end_frame=${F},setpts=PTS-STARTPTS[head]`,
    `[tail][head]blend=all_expr='${mix}'[seam]`,
    `[body][seam]concat=n=2:v=1:a=0,scale=${o.width}:${o.height}:flags=lanczos,format=yuv420p[out]`,
  ].join(';');
}

/** Entrée : séquence d'images JPEG frame-00000.jpg… à la cadence du manifeste. */
export function inputArgs(m: Manifest, framesDir: string): string[] {
  return ['-y', '-hide_banner', '-loglevel', 'error', '-framerate', String(m.fps), '-start_number', '0', '-i', `${framesDir}/frame-%05d.jpg`];
}

/** WebM VP9 en deux passes (débit maîtrisé), sans son, une image clé toutes les 4 s. */
export function webmPasses(m: Manifest, framesDir: string, out: string, passlog: string, o: EncodeOptions, nullDev: string): string[][] {
  const common = [
    ...inputArgs(m, framesDir),
    '-filter_complex', loopFilter(m, o),
    '-map', '[out]',
    '-an',
    '-c:v', 'libvpx-vp9',
    '-b:v', `${o.webmKbps}k`,
    '-maxrate', `${Math.round(o.webmKbps * 1.45)}k`,
    '-bufsize', `${o.webmKbps * 3}k`,
    '-deadline', 'good',
    '-row-mt', '1',
    '-tile-columns', '2',
    '-g', String(m.fps * 4),
    '-r', String(m.fps),
    '-passlogfile', passlog,
  ];
  return [
    [...common, '-pass', '1', '-cpu-used', '4', '-f', 'webm', nullDev],
    [...common, '-pass', '2', '-cpu-used', '1', '-auto-alt-ref', '1', '-lag-in-frames', '25', out],
  ];
}

/** MP4 H.264 (repli Safari / anciens navigateurs) en deux passes, démarrage rapide (faststart). */
export function mp4Passes(m: Manifest, framesDir: string, out: string, passlog: string, o: EncodeOptions, nullDev: string): string[][] {
  const common = [
    ...inputArgs(m, framesDir),
    '-filter_complex', loopFilter(m, o),
    '-map', '[out]',
    '-an',
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-profile:v', 'high',
    '-b:v', `${o.mp4Kbps}k`,
    '-maxrate', `${Math.round(o.mp4Kbps * 1.6)}k`,
    '-bufsize', `${o.mp4Kbps * 3}k`,
    '-g', String(m.fps * 4),
    '-r', String(m.fps),
    '-passlogfile', passlog,
  ];
  return [
    [...common, '-pass', '1', '-f', 'mp4', nullDev],
    [...common, '-pass', '2', '-movflags', '+faststart', out],
  ];
}

/**
 * Images de contrôle extraites de la vidéo finale : une par plan (temps du plan de tournage,
 * apps/client/src/ui/cinematicPlan.ts), et les deux côtés du raccord (dernière image, puis première).
 */
export function checkPoints(m: Pick<Manifest, 'fps' | 'loopS' | 'xfadeS'>): Array<{ name: string; frame: number }> {
  const L = Math.round(m.loopS * m.fps);
  // La vidéo commence à l'image capturée F : temps de capture s → image (s − xfadeS)·fps.
  const at = (s: number) => Math.min(L - 1, Math.max(0, Math.round((s - m.xfadeS) * m.fps)));
  return [
    { name: 'a-front', frame: at(4) },
    { name: 'b-side', frame: at(14) },
    { name: 'c-crane', frame: at(27) },
    { name: 'd-pass', frame: at(35.5) },
    { name: 'e-close', frame: at(44) },
    { name: 'f-front-end', frame: at(54) },
    { name: 'g-seam-last', frame: L - 1 },
    { name: 'h-seam-first', frame: 0 },
  ];
}
