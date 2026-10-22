/**
 * Vidéo résumé de REPLI, rendue avec FFmpeg seul (sans Chromium ni HyperFrames) : 12 s en
 * 1280 × 720, titre, parcours, coureur, statistiques qui apparaissent l'une après l'autre et
 * profil d'altitude qui se dévoile. Utilisée quand HyperFrames est absent ou échoue.
 *
 * Le fond (dégradé, profil) est dessiné en JavaScript dans une image PPM ; les textes passent
 * par le filtre `drawtext` (fichiers texte : aucun échappement fragile), le dévoilement du
 * profil par un cache uni (`overlay` animé) qui glisse vers la droite. Encodage H.264 (libx264) si disponible, sinon MPEG-4.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RenderCapabilities } from './capabilities.ts';

export interface FallbackSummaryInput {
  lang?: 'fr' | 'en';
  title?: string;
  date?: string | number;
  routeName?: string;
  riderName?: string;
  stats?: Partial<{ distanceKm: number; durationS: number; elevationM: number; avgPowerW: number; npW: number }>;
  records?: Array<{ altitudeM?: number; distanceM?: number }>;
  elevation?: number[];
}

export const FALLBACK_W = 1280;
export const FALLBACK_H = 720;
export const FALLBACK_DURATION_S = 12;
const BG: [number, number, number] = [14, 20, 36];
const ACCENT: [number, number, number] = [255, 210, 63];
const PROFILE = { x: 90, y: 420, w: 1100, h: 220 };

/** Altitudes de la sortie (≤ 1100 points) : `elevation` fourni ou tiré des enregistrements. */
export function profileOf(input: FallbackSummaryInput): number[] {
  const src = input.elevation?.length ? input.elevation : (input.records ?? []).map((r) => r.altitudeM).filter((a): a is number => typeof a === 'number' && Number.isFinite(a));
  if (src.length < 2) return [];
  const n = Math.min(PROFILE.w, src.length);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(src[Math.round((i * (src.length - 1)) / (n - 1))]!);
  return out;
}

/** Fond PPM (P6) : dégradé discret, liseré, profil d'altitude rempli et tracé. */
export function backgroundPpm(profile: readonly number[]): Buffer {
  const W = FALLBACK_W;
  const H = FALLBACK_H;
  const header = Buffer.from(`P6\n${W} ${H}\n255\n`, 'ascii');
  const px = Buffer.alloc(W * H * 3);
  const set = (x: number, y: number, c: readonly number[], a = 1): void => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 3;
    for (let k = 0; k < 3; k++) px[i + k] = Math.round(px[i + k]! * (1 - a) + c[k]! * a);
  };
  for (let y = 0; y < H; y++) {
    // Haut légèrement plus clair ; la zone du profil reste au fond uni (dévoilement invisible).
    const k = y < PROFILE.y - 20 ? 1 - y / (PROFILE.y - 20) : 0;
    const c = [BG[0] + 10 * k, BG[1] + 14 * k, BG[2] + 26 * k];
    for (let x = 0; x < W; x++) set(x, y, c);
  }
  for (let y = 64; y < 92; y++) for (let x = 70; x < 76; x++) set(x, y, ACCENT);
  if (profile.length >= 2) {
    const lo = Math.min(...profile);
    const hi = Math.max(...profile);
    const span = Math.max(hi - lo, 30);
    const yAt = (i: number): number => PROFILE.y + PROFILE.h - ((profile[i]! - lo) / span) * (PROFILE.h - 20) - 4;
    for (let x = 0; x < PROFILE.w; x++) {
      const f = (x / (PROFILE.w - 1)) * (profile.length - 1);
      const i = Math.floor(f);
      const t = f - i;
      const y = yAt(i) * (1 - t) + yAt(Math.min(i + 1, profile.length - 1)) * t;
      const top = Math.round(y);
      for (let yy = top; yy < PROFILE.y + PROFILE.h; yy++) set(PROFILE.x + x, yy, ACCENT, 0.18 + 0.12 * (1 - (yy - top) / PROFILE.h));
      for (let d = -1; d <= 1; d++) set(PROFILE.x + x, top + d, ACCENT, 1);
    }
  }
  return Buffer.concat([header, px]);
}

function fmtDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

function fmtDate(d: string | number | undefined, lang: 'fr' | 'en'): string {
  if (d === undefined) return '';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return String(d);
  return date.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
}

export interface TextItem {
  text: string;
  x: number;
  y: number;
  size: number;
  bold: boolean;
  color: string;
  /** Apparition (s). */
  at: number;
}

/** Textes du résumé, positions et instants d'apparition. */
export function summaryTexts(input: FallbackSummaryInput): TextItem[] {
  const fr = (input.lang ?? 'fr') === 'fr';
  const nf = (v: number, d = 1) => (fr ? v.toFixed(d).replace('.', ',') : v.toFixed(d));
  const items: TextItem[] = [
    { text: 'ALLEZ ROBERT !', x: 90, y: 58, size: 26, bold: true, color: '0xffd23f', at: 0.2 },
    { text: (input.title || (fr ? 'Ma sortie' : 'My ride')).slice(0, 48), x: 90, y: 96, size: 54, bold: true, color: 'white', at: 0.5 },
  ];
  const sub = [input.routeName, fmtDate(input.date, input.lang ?? 'fr')].filter(Boolean).join(' · ');
  if (sub) items.push({ text: sub.slice(0, 90), x: 90, y: 168, size: 26, bold: false, color: '0x9aa5b1', at: 0.9 });
  if (input.riderName) items.push({ text: input.riderName.slice(0, 40), x: 90, y: 206, size: 30, bold: true, color: 'white', at: 1.2 });
  const s = input.stats ?? {};
  const stats: Array<[string, string]> = [];
  if (s.distanceKm !== undefined) stats.push([fr ? 'DISTANCE' : 'DISTANCE', `${nf(s.distanceKm)} km`]);
  if (s.durationS !== undefined) stats.push([fr ? 'DURÉE' : 'TIME', fmtDuration(s.durationS)]);
  if (s.elevationM !== undefined) stats.push(['D+', `${Math.round(s.elevationM)} m`]);
  if (s.avgPowerW !== undefined) stats.push([fr ? 'PUISSANCE MOY.' : 'AVG POWER', `${Math.round(s.avgPowerW)} W`]);
  if (s.npW !== undefined) stats.push(['NP', `${Math.round(s.npW)} W`]);
  stats.slice(0, 5).forEach(([label, value], i) => {
    const x = 90 + i * 225;
    const at = 1.8 + i * 0.35;
    items.push({ text: label, x, y: 282, size: 20, bold: false, color: '0x9aa5b1', at });
    items.push({ text: value, x, y: 310, size: 44, bold: true, color: 'white', at: at + 0.1 });
  });
  items.push({ text: fr ? 'Résumé de la sortie · allezrobert' : 'Ride summary · allezrobert', x: 90, y: 668, size: 18, bold: false, color: '0x6b7785', at: 8.5 });
  return items;
}

function findFont(bold: boolean): string | null {
  const names = bold ? ['DejaVuSans-Bold.ttf', 'LiberationSans-Bold.ttf'] : ['DejaVuSans.ttf', 'LiberationSans-Regular.ttf'];
  const dirs = ['/usr/share/fonts/truetype/dejavu', '/usr/share/fonts/truetype/liberation', '/usr/share/fonts/dejavu', '/usr/share/fonts/TTF', '/Library/Fonts', 'C:\\Windows\\Fonts'];
  for (const d of dirs) for (const n of names) if (existsSync(path.join(d, n))) return path.join(d, n);
  return null;
}

/** Valeur d'option de filtre FFmpeg entre apostrophes (chemins). */
function q(v: string): string {
  return `'${v.replace(/\\/g, '/').replace(/'/g, "'\\''").replace(/:/g, '\\:')}'`;
}

/** Graphe de filtres (écrit dans un fichier : pas d'échappement par le shell). */
export function filterGraph(texts: TextItem[], textFiles: string[], caps: Pick<RenderCapabilities, 'drawtext'>): string {
  const f: string[] = [];
  // Dévoilement du profil de 2,5 s à 7,5 s : un cache de la couleur du fond glisse vers la droite.
  f.push(`overlay=x='${PROFILE.x}+${PROFILE.w + 4}*min(max((t-2.5)/5\\,0)\\,1)':y=${PROFILE.y - 6}:eval=frame:shortest=1`);
  if (caps.drawtext) {
    texts.forEach((it, i) => {
      const font = findFont(it.bold);
      f.push(
        `drawtext=textfile=${q(textFiles[i]!)}${font ? `:fontfile=${q(font)}` : ''}:fontsize=${it.size}:fontcolor=${it.color}:x=${it.x}:y=${it.y + it.size}-ascent:alpha='min(max((t-${it.at})/0.5\\,0)\\,1)'`,
      );
    });
  }
  f.push('fade=t=in:st=0:d=0.4', `fade=t=out:st=${FALLBACK_DURATION_S - 0.8}:d=0.8`, 'format=yuv420p');
  return `color=c=0x0e1424:s=${PROFILE.w + 10}x${PROFILE.h + 12}:r=30[cache];[0:v][cache]${f.join(',')}[v]`;
}

function runFfmpeg(bin: string, args: string[], timeoutS: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-3000)));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutS * 1000);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg a échoué (code ${code}) : ${err.trim().split('\n').slice(-3).join(' | ')}`));
    });
  });
}

/** Rend la vidéo de repli ; renvoie la taille du MP4 (octets). */
export async function renderFallbackSummary(input: FallbackSummaryInput, output: string, caps: RenderCapabilities, opts: { timeoutS?: number } = {}): Promise<number> {
  if (!caps.ffmpeg) throw new Error('ffmpeg absent : rendu vidéo impossible');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ar-fallback-'));
  try {
    await writeFile(path.join(dir, 'bg.ppm'), backgroundPpm(profileOf(input)));
    const texts = summaryTexts(input);
    const files = texts.map((_, i) => path.join(dir, `t${i}.txt`));
    await Promise.all(texts.map((t, i) => writeFile(files[i]!, t.text)));
    const graphFile = path.join(dir, 'graph.txt');
    await writeFile(graphFile, filterGraph(texts, files, caps));
    await mkdir(path.dirname(output), { recursive: true });
    const codec = caps.libx264 ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22'] : ['-c:v', 'mpeg4', '-q:v', '4'];
    await runFfmpeg(
      caps.ffmpeg,
      ['-hide_banner', '-loglevel', 'error', '-y', '-loop', '1', '-framerate', '30', '-t', String(FALLBACK_DURATION_S), '-i', path.join(dir, 'bg.ppm'), '-filter_complex_script', graphFile, '-map', '[v]', ...codec, '-r', '30', '-movflags', '+faststart', output],
      opts.timeoutS ?? 300,
    );
    const st = await stat(output);
    if (st.size === 0) throw new Error('MP4 vide');
    return st.size;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
