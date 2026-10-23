/**
 * Encodage du film d'accueil : arguments ffmpeg (fonctions pures, testées) pour refermer la
 * boucle et produire le MP4 H.264 (principal) et le WebM VP9 (repli).
 *
 * Les images capturées couvrent loopS + xfadeS secondes. La vidéo finale dure loopS :
 *   images [F, L) telles quelles, puis les F dernières images (L…L+F) fondues dans les F premières.
 * La dernière image fondue est presque l'image F-1, suivie (en boucle) de l'image F : raccord invisible.
 *
 * Qualité constante (CRF) plutôt qu'un débit imposé : 1920×1080, 4:2:0 en plage vidéo (yuv420p,
 * pas yuvj), matrice BT.709 déclarée, une image clé toutes les 2 s.
 */

export interface Manifest {
  season: string;
  fps: number;
  width: number;
  height: number;
  /** Format des images capturées (anciennes captures : JPEG). */
  format?: 'png' | 'jpg';
  frames: number;
  loopS: number;
  xfadeS: number;
  routeId: string;
  d0: number;
  hour: number;
}

export interface EncodeOptions {
  /** Taille de sortie. */
  width: number;
  height: number;
  /** H.264 : facteur de qualité constante (18–20 : très propre). */
  crf: number;
  /**
   * H.264 : plafond de débit (kbit/s). L'herbe et le feuillage au téléobjectif coûtent très cher :
   * en CRF 19 pur, ≈20 Mbit/s (150 Mo la minute). Le plafond garde la qualité CRF 19 sur les plans
   * calmes et borne les plans chargés : ≤ 30 Mo la minute à 3 800 kbit/s.
   */
  mp4MaxKbps?: number;
  /**
   * VP9 : facteur de qualité constante (débit libre, -b:v 0 ; pas de débit contraint, mal décodé
   * par Chrome sur certaines machines). CRF 30 : ≈75 Mo la minute pour ce film ; 40 : ≈35 Mo.
   */
  vp9Crf: number;
}

export const DEFAULT_ENCODE: EncodeOptions = { width: 1920, height: 1080, crf: 19, mp4MaxKbps: 3800, vp9Crf: 40 };

/** Bornes de la boucle en images : L = durée de la boucle, F = fondu de raccord. */
export function loopFrames(m: Pick<Manifest, 'fps' | 'loopS' | 'xfadeS' | 'frames'>): { L: number; F: number } {
  const L = Math.round(m.loopS * m.fps);
  const F = Math.round(m.xfadeS * m.fps);
  if (m.frames < L + F) throw new Error(`${m.frames} images capturées, ${L + F} attendues`);
  return { L, F };
}

/**
 * Graphe de filtres : corps [F, L) puis fondu des images [L, L+F) vers [0, F) (en RVB), mise à
 * l'échelle Lanczos et conversion en yuv420p BT.709 plage vidéo.
 */
export function loopFilter(m: Manifest, o: Pick<EncodeOptions, 'width' | 'height'>): string {
  const { L, F } = loopFrames(m);
  // Poids de l'image de début : (N+1)/(F+1), de 1/(F+1) à F/(F+1) (jamais une image pure de part et d'autre).
  const mix = `A+(B-A)*(N+1)/${F + 1}`;
  return [
    '[0:v]format=gbrp,split=3[a][b][c]',
    `[a]trim=start_frame=${F}:end_frame=${L},setpts=PTS-STARTPTS[body]`,
    `[b]trim=start_frame=${L}:end_frame=${L + F},setpts=PTS-STARTPTS[tail]`,
    `[c]trim=start_frame=0:end_frame=${F},setpts=PTS-STARTPTS[head]`,
    `[tail][head]blend=all_expr='${mix}'[seam]`,
    `[body][seam]concat=n=2:v=1:a=0,scale=${o.width}:${o.height}:flags=lanczos+accurate_rnd+full_chroma_int:out_color_matrix=bt709:out_range=tv,format=yuv420p[out]`,
  ].join(';');
}

/** Entrée : séquence d'images frame-00000.png… à la cadence du manifeste. */
export function inputArgs(m: Manifest, framesDir: string): string[] {
  const ext = m.format ?? 'jpg';
  return ['-y', '-hide_banner', '-loglevel', 'error', '-framerate', String(m.fps), '-start_number', '0', '-i', `${framesDir}/frame-%05d.${ext}`];
}

/** Étiquettes de couleur (BT.709, plage vidéo) : les navigateurs convertissent sans dérive de teinte. */
const COLOR_TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];

/** Une image clé toutes les 2 s exactement (pas de coupure de plan détectée en plus). */
function gop(m: Manifest): string[] {
  return ['-g', String(m.fps * 2), '-keyint_min', String(m.fps * 2)];
}

/** MP4 H.264 High, yuv420p, qualité constante, démarrage rapide (faststart), sans son. */
export function mp4Args(m: Manifest, framesDir: string, out: string, o: EncodeOptions): string[] {
  const cap = o.mp4MaxKbps ? ['-maxrate', `${o.mp4MaxKbps}k`, '-bufsize', `${o.mp4MaxKbps * 2}k`] : [];
  return [
    ...inputArgs(m, framesDir),
    '-filter_complex', loopFilter(m, o),
    '-map', '[out]',
    '-an',
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-profile:v', 'high',
    '-pix_fmt', 'yuv420p',
    '-crf', String(o.crf),
    ...cap,
    // aq-mode 3 : plus de bits dans les aplats sombres et les dégradés (ciel), moins de bandes.
    // Couleurs aussi dans le VUI du flux H.264 (les options -color_* seules n'y vont pas toujours).
    '-x264-params', 'aq-mode=3:scenecut=0:colorprim=bt709:transfer=bt709:colormatrix=bt709',
    ...gop(m),
    '-r', String(m.fps),
    ...COLOR_TAGS,
    '-movflags', '+faststart',
    out,
  ];
}

/** WebM VP9 profil 0 (yuv420p), qualité constante (-crf, -b:v 0), en deux passes, sans son. */
export function webmPasses(m: Manifest, framesDir: string, out: string, passlog: string, o: EncodeOptions, nullDev: string): string[][] {
  const common = [
    ...inputArgs(m, framesDir),
    '-filter_complex', loopFilter(m, o),
    '-map', '[out]',
    '-an',
    '-c:v', 'libvpx-vp9',
    '-pix_fmt', 'yuv420p',
    '-crf', String(o.vp9Crf),
    '-b:v', '0',
    '-deadline', 'good',
    '-row-mt', '1',
    '-tile-columns', '2',
    ...gop(m),
    '-r', String(m.fps),
    ...COLOR_TAGS,
    '-passlogfile', passlog,
  ];
  return [
    [...common, '-pass', '1', '-cpu-used', '4', '-f', 'webm', nullDev],
    [...common, '-pass', '2', '-cpu-used', '2', '-auto-alt-ref', '1', '-lag-in-frames', '25', out],
  ];
}

/**
 * Image fixe de la saison (repli du menu) : première image de la vidéo, en JPEG (BT.601 pleine
 * plage, la convention JPEG ; passage par le RVB pour convertir la matrice BT.709 de la vidéo).
 */
export function stillArgs(video: string, out: string, q: number): string[] {
  return ['-y', '-hide_banner', '-loglevel', 'error', '-i', video, '-frames:v', '1', '-vf', 'scale=in_color_matrix=bt709:in_range=tv:flags=accurate_rnd+full_chroma_int,format=rgb24,scale=out_color_matrix=bt601:out_range=pc,format=yuvj420p', '-q:v', String(q), out];
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
