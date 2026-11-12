import * as THREE from 'three/webgpu';
import { attribute, positionLocal, time, sin, vec2, vec3, float, floor, mix, instanceIndex, hash, color, varying, uv, texture, frontFacing, instancedBufferAttribute, uniform } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RouteTrack } from '@allezrobert/shared';
import { rng } from '../engine/noise.ts';
import { LOW_POLY } from '../engine/style.ts';
import { signDesigns, type SignDesign } from './crowdSigns.ts';
import { lowPolyCrowdMaterial, lowPolyPersonGeometry, lowPolySignGeometry, lowPolySignMaterial } from './crowdLowPoly.ts';
import { loadSpectators, spectatorMaterial } from './crowdRealistic.ts';

/** Spectateur : corps, tête et bras levés (attribut `part` : 0 corps, 1 tête, 2 bras). */
function personGeometry(): THREE.BufferGeometry {
  const tag = (g: THREE.BufferGeometry, part: number) => {
    const n = g.getAttribute('position').count;
    g.setAttribute('part', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1));
    g.deleteAttribute('uv');
    return g.index ? g.toNonIndexed() : g;
  };
  const body = tag(new THREE.CapsuleGeometry(0.2, 0.9, 3, 8).translate(0, 0.75, 0), 0);
  const head = tag(new THREE.SphereGeometry(0.13, 10, 8).translate(0, 1.42, 0), 1);
  const armL = tag(new THREE.CapsuleGeometry(0.05, 0.5, 2, 6).rotateZ(0.5).translate(0.28, 1.35, 0), 2);
  const armR = tag(new THREE.CapsuleGeometry(0.05, 0.5, 2, 6).rotateZ(-0.5).translate(-0.28, 1.35, 0), 2);
  return mergeGeometries([body, head, armL, armR]) as THREE.BufferGeometry;
}

/** Atlas des pancartes : 4 × 4 cases de 256 × 160 px (carton 0,9 × 0,56 m). */
const ATLAS_COLS = 4;
const ATLAS_ROWS = 4;
const CELL_W = 256;
const CELL_H = 160;
const SIGN_W = 0.9;
const SIGN_H = 0.56;

/** Pancarte : carton (part 0, uv) et manche (part 1). */
function signGeometry(): THREE.BufferGeometry {
  const board = new THREE.PlaneGeometry(SIGN_W, SIGN_H).translate(0, 2.0, 0);
  board.setAttribute('part', new THREE.BufferAttribute(new Float32Array(board.getAttribute('position').count).fill(0), 1));
  const stick = new THREE.BoxGeometry(0.035, 0.85, 0.035).translate(0, 1.38, -0.03);
  stick.setAttribute('part', new THREE.BufferAttribute(new Float32Array(stick.getAttribute('position').count).fill(1), 1));
  return mergeGeometries([board.toNonIndexed(), stick.toNonIndexed()]) as THREE.BufferGeometry;
}

/** Dessine une pancarte « faite main » dans sa case de l'atlas. */
function drawSign(ctx: CanvasRenderingContext2D, x: number, y: number, d: SignDesign, tilt: number): void {
  ctx.save();
  ctx.translate(x + CELL_W / 2, y + CELL_H / 2);
  ctx.fillStyle = d.bg;
  ctx.fillRect(-CELL_W / 2, -CELL_H / 2, CELL_W, CELL_H);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 4;
  ctx.strokeRect(-CELL_W / 2 + 2, -CELL_H / 2 + 2, CELL_W - 4, CELL_H - 4);
  ctx.rotate(tilt);
  ctx.fillStyle = d.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const font = (px: number) => `900 ${px}px "Marker Felt", "Comic Sans MS", "Chalkboard SE", "Arial Black", Impact, sans-serif`;
  const n = d.lines.length;
  let size = n === 1 ? 54 : n === 2 ? 46 : 36;
  ctx.font = font(size);
  while (size > 18 && Math.max(...d.lines.map((l) => ctx.measureText(l).width)) > CELL_W - 30) {
    size -= 2;
    ctx.font = font(size);
  }
  const lh = size * 1.05;
  d.lines.forEach((l, i) => ctx.fillText(l, 0, (i - (n - 1) / 2) * lh + (d.deco === 'none' ? 0 : -6)));
  // Décor : cœur, flèche ou étoiles sous le texte.
  const by = ((n - 1) / 2) * lh + size * 0.5 + 6;
  if (d.deco === 'heart') {
    ctx.beginPath();
    const s = 9;
    ctx.moveTo(0, by + s);
    ctx.bezierCurveTo(-2 * s, by - s * 0.2, -s, by - 1.4 * s, 0, by - 0.4 * s);
    ctx.bezierCurveTo(s, by - 1.4 * s, 2 * s, by - s * 0.2, 0, by + s);
    ctx.fillStyle = '#e63946';
    ctx.fill();
  } else if (d.deco === 'arrow') {
    ctx.fillRect(-40, by - 2, 70, 5);
    ctx.beginPath();
    ctx.moveTo(42, by + 0.5);
    ctx.lineTo(28, by - 9);
    ctx.lineTo(28, by + 10);
    ctx.fill();
  } else if (d.deco === 'stars') {
    for (const sx of [-50, 0, 50]) ctx.fillText('★', sx, by, 30);
  }
  ctx.restore();
}

function signAtlas(designs: SignDesign[]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = CELL_W * ATLAS_COLS;
  c.height = CELL_H * ATLAS_ROWS;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  designs.forEach((d, i) => drawSign(ctx, (i % ATLAS_COLS) * CELL_W, Math.floor(i / ATLAS_COLS) * CELL_H, d, ((i * 37) % 7) * 0.012 - 0.036));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export interface CrowdOptions {
  /** Prénom du coureur, écrit sur certaines pancartes. */
  riderName?: string;
  /** Densité (1 : un spectateur tous les 3,2 m sur les KOM, 4 m sur les sprints, de chaque côté) ; voir `QualitySettings.crowdDensity`. */
  density?: number;
  /** Style réaliste : vrais personnages recolorés (crowdRealistic.ts) plutôt que des capsules ; vrai par défaut. */
  realPeople?: boolean;
  /**
   * Arrivée de course : foule sur les FINISH_M derniers mètres, en rangs de plus en plus serrés vers la ligne,
   * derrière des barrières ; sinon (sortie libre) 60 m de public à la ligne. Faux par défaut.
   */
  finish?: boolean;
}

/** Arrivée de course : longueur de la foule et des barrières avant la ligne (m). */
const FINISH_M = 250;
const FINISH_BARRIER_M = 200;
/** Barrière de foule : longueur d'un élément, écart au bord de la chaussée (m). */
const BARRIER_LEN = 2;
const BARRIER_GAP = 0.6;

/**
 * Barrière de foule (repère : longueur le long de x, centrée ; pieds en y = 0 ; face côté route vers −z) :
 * cadre en tubes, barreaux, deux pieds plats et une bâche publicitaire côté route. Attribut `part` :
 * 0 métal, 1 bâche.
 */
function barrierGeometry(): THREE.BufferGeometry {
  const tag = (g: THREE.BufferGeometry, part: number) => {
    const ng = g.index ? g.toNonIndexed() : g;
    // uv gardées pour la bâche (publicité), nulles ailleurs (même jeu d'attributs pour la fusion)
    if (part !== 1) ng.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(ng.getAttribute('position').count * 2), 2));
    ng.setAttribute('part', new THREE.BufferAttribute(new Float32Array(ng.getAttribute('position').count).fill(part), 1));
    return ng;
  };
  const L = BARRIER_LEN - 0.04;
  const parts: THREE.BufferGeometry[] = [
    tag(new THREE.BoxGeometry(L, 0.035, 0.035).translate(0, 1.08, 0), 0),
    tag(new THREE.BoxGeometry(L, 0.035, 0.035).translate(0, 0.2, 0), 0),
  ];
  for (const x of [-L / 2, L / 2]) {
    parts.push(tag(new THREE.BoxGeometry(0.04, 1.1, 0.04).translate(x, 0.55, 0), 0));
    parts.push(tag(new THREE.BoxGeometry(0.05, 0.03, 0.6).translate(x * 0.92, 0.015, 0), 0));
  }
  for (let i = 1; i < 14; i++) parts.push(tag(new THREE.BoxGeometry(0.018, 0.88, 0.018).translate(-L / 2 + (i * L) / 14, 0.64, 0), 0));
  parts.push(tag(new THREE.PlaneGeometry(L - 0.06, 0.82).rotateY(Math.PI).translate(0, 0.64, -0.03), 1));
  return mergeGeometries(parts) as THREE.BufferGeometry;
}

/**
 * Publicités des bâches : marques de vélo inventées (pas de vraies marques ni de logos réels). Atlas de
 * ADS_COLS × ADS_ROWS cases de 512 × 224 px (bâche ≈ 1,9 × 0,82 m).
 */
const ADS: Array<{ bg: string; ink: string; name: string; sub: string; icon: 'bike' | 'wheel' | 'bottle' | 'none' }> = [
  { bg: '#f2c21b', ink: '#111111', name: 'PNEUS VÉLOCE', sub: 'adhérence tous temps', icon: 'wheel' },
  { bg: '#1d3557', ink: '#ffffff', name: 'CYCLES DUPÉDALIER', sub: 'cadres carbone depuis 1952', icon: 'bike' },
  { bg: '#e63946', ink: '#ffffff', name: 'BRAQUET', sub: 'transmissions 12 vitesses', icon: 'none' },
  { bg: '#ffffff', ink: '#d62828', name: 'ROUE LIBRE', sub: 'le magazine du cyclisme', icon: 'wheel' },
  { bg: '#2a9d8f', ink: '#ffffff', name: 'CHAMOIS PRO', sub: 'cuissards & maillots', icon: 'none' },
  { bg: '#111111', ink: '#ffd23f', name: 'ALLEZ ROBERT !', sub: 'roulez sur les vraies routes', icon: 'bike' },
  { bg: '#ff7f11', ink: '#ffffff', name: 'GOURDE & CO', sub: 'bidons isothermes', icon: 'bottle' },
  { bg: '#f4f4f4', ink: '#1d3557', name: 'COL DU JOUR', sub: 'barres énergétiques', icon: 'none' },
];
const ADS_COLS = 4;
const ADS_ROWS = 2;
const AD_W = 512;
const AD_H = 224;

/** Pictogrammes des publicités : vélo de route, roue à rayons, bidon. */
function adIcon(ctx: CanvasRenderingContext2D, kind: 'bike' | 'wheel' | 'bottle', x: number, y: number, ink: string): void {
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (kind === 'bike') {
    const r = 30;
    ctx.beginPath();
    ctx.arc(x - 44, y + 18, r, 0, Math.PI * 2);
    ctx.moveTo(x + 44 + r, y + 18);
    ctx.arc(x + 44, y + 18, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    // base arrière, tube de selle, tube supérieur, tube diagonal, fourche, cintre, selle
    ctx.moveTo(x - 44, y + 18);
    ctx.lineTo(x - 2, y + 18);
    ctx.lineTo(x - 18, y - 22);
    ctx.lineTo(x + 30, y - 22);
    ctx.lineTo(x - 2, y + 18);
    ctx.moveTo(x - 44, y + 18);
    ctx.lineTo(x - 18, y - 22);
    ctx.moveTo(x + 44, y + 18);
    ctx.lineTo(x + 30, y - 30);
    ctx.lineTo(x + 42, y - 32);
    ctx.moveTo(x - 28, y - 30);
    ctx.lineTo(x - 8, y - 30);
    ctx.stroke();
  } else if (kind === 'wheel') {
    ctx.beginPath();
    ctx.arc(x, y, 46, 0, Math.PI * 2);
    ctx.lineWidth = 12;
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * 40, y + Math.sin(a) * 40);
    }
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.roundRect(x - 20, y - 34, 40, 78, 10);
    ctx.fill();
    ctx.fillRect(x - 10, y - 50, 20, 18);
  }
  ctx.restore();
}

/** Atlas des publicités des bâches. */
function adsAtlas(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = AD_W * ADS_COLS;
  c.height = AD_H * ADS_ROWS;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ADS.forEach((ad, i) => {
    const x0 = (i % ADS_COLS) * AD_W;
    const y0 = Math.floor(i / ADS_COLS) * AD_H;
    ctx.fillStyle = ad.bg;
    ctx.fillRect(x0, y0, AD_W, AD_H);
    // liseré, comme les bâches imprimées
    ctx.fillStyle = ad.ink;
    ctx.fillRect(x0, y0 + AD_H - 16, AD_W, 6);
    const icon = ad.icon !== 'none';
    if (icon) adIcon(ctx, ad.icon as 'bike' | 'wheel' | 'bottle', x0 + 90, y0 + AD_H / 2 - 6, ad.ink);
    const cx = x0 + (icon ? 320 : AD_W / 2);
    const maxW = icon ? 340 : 470;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = 64;
    const font = (px: number) => `900 ${px}px Impact, "Arial Black", "Helvetica Neue", Arial, sans-serif`;
    ctx.font = font(size);
    while (size > 28 && ctx.measureText(ad.name).width > maxW) ctx.font = font((size -= 2));
    ctx.fillText(ad.name, cx, y0 + AD_H / 2 - 22);
    ctx.font = `italic 600 26px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText(ad.sub, cx, y0 + AD_H / 2 + 38, maxW);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * Barrières : métal galvanisé ; bâche imprimée côté route (publicités de l'atlas, une marque par série de trois
 * barrières, comme sur les arrivées), toile unie côté public.
 */
function barrierMaterial(): THREE.MeshStandardNodeMaterial {
  const mat = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
  mat.flatShading = LOW_POLY;
  const part = attribute<'float'>('part');
  // Les barrières sont créées par paires (gauche, droite) le long de la route : 6 instances = 3 barrières par côté.
  // × 3 (premier avec 8) : les marques se suivent dans le désordre.
  const cell = floor(float(instanceIndex).div(6)).mul(3).mod(ADS.length);
  const col = cell.mod(ADS_COLS);
  const row = floor(cell.div(ADS_COLS));
  const adUv = uv()
    .mul(vec2(1 / ADS_COLS, 1 / ADS_ROWS))
    .add(vec2(col.div(ADS_COLS), float(1).sub(row.add(1).div(ADS_ROWS))));
  const cloth = frontFacing.select(texture(adsAtlas(), adUv).rgb, vec3(0.82, 0.82, 0.8));
  mat.colorNode = part.equal(1).select(cloth, vec3(0.4, 0.42, 0.44));
  mat.roughnessNode = part.equal(1).select(float(0.8), float(0.45));
  mat.metalnessNode = part.equal(1).select(float(0), float(0.6));
  return mat;
}

/**
 * Public sur les côtes : spectateurs le long des 350 derniers mètres de chaque KOM (et des
 * 120 derniers mètres des sprints), des deux côtés, qui sautent et agitent les bras (animation
 * GPU, un seul appel de dessin). Au premier rang, près du sommet / de la ligne, certains
 * tiennent une pancarte (encouragements, prénom du coureur, « Allez Robert ! ») : atlas de
 * textures dessiné sur un canevas, pancartes instanciées (un appel de dessin), tournées vers
 * les coureurs qui arrivent et agitées doucement.
 */
/** Slogans des pancartes (le nom du coureur s'ajoute en tête). */
const SLOGANS = ['ALLEZ !', 'ALLEZ ROBERT !', 'VAS-Y !', 'ON LÂCHE RIEN', 'KOM !'];

/** Texture d'une pancarte : carton clair, lettres peintes à la main. */
function signTexture(text: string, hue: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = hue % 2 ? '#f6f1e3' : '#fff8c2';
  ctx.fillRect(0, 0, 256, 160);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, 250, 154);
  ctx.fillStyle = ['#d62828', '#1d3557', '#2a9d8f', '#111111'][hue % 4] as string;
  ctx.font = `900 ${text.length > 10 ? 34 : 46}px Impact, Arial Black, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const words = text.split(' ');
  const lines = text.length > 10 && words.length > 1 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : [text];
  lines.forEach((l, i) => ctx.fillText(l, 128, 80 + (i - (lines.length - 1) / 2) * 44, 236));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Crowd {
  readonly mesh: THREE.InstancedMesh;
  /** Pancartes (null si aucun segment). */
  readonly signs: THREE.InstancedMesh | null;
  /** Barrières de l'arrivée de course (null hors course). */
  readonly barriers: THREE.InstancedMesh | null;
  readonly group = new THREE.Group();
  /**
   * Style jeu vidéo : position du coureur (x, z). Le public ne s'anime qu'à son approche (voir
   * crowdLowPoly.ts). Mise à jour par `update` ; tant qu'elle ne l'est pas, la caméra en tient lieu.
   */
  private readonly rider = uniform(new THREE.Vector2(1e9, 1e9));
  private driven = false;
  private readonly track: RouteTrack;
  private readonly groundAt: (x: number, z: number) => number;
  /** Reprise des hauteurs : prochain spectateur (puis pancarte) à reposer sur le sol dessiné. */
  private groundCursor = 0;
  /** Style réaliste : maillages des vrais personnages (un par personnage), reposés sur le sol comme les capsules. */
  private readonly people: THREE.InstancedMesh[] = [];

  constructor(track: RouteTrack, groundAt: (x: number, z: number) => number, opts: CrowdOptions = {}) {
    this.track = track;
    this.groundAt = groundAt;
    const r = rng(2026);
    const mats: THREE.Matrix4[] = [];
    const still: number[] = [];
    // Style réaliste : par spectateur cos et sin de son lacet et son échelle (vrais personnages, crowdRealistic.ts).
    const orient: number[] = [];
    // Style jeu vidéo : par spectateur x, z, cosinus et sinus de son orientation ; par pancarte x, z.
    const spots: number[] = [];
    const signSpots: number[] = [];
    const signMats: THREE.Matrix4[] = [];
    const signCells: number[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const half = track.route.roadWidthM / 2;
    const up = new THREE.Vector3(0, 1, 0);
    // Pancartes : 10 cases pour les KOM, 6 pour les sprints.
    const name = opts.riderName ?? 'Robert';
    const density = Math.min(Math.max(opts.density ?? 0.5, 0.1), 1);
    const komDesigns = signDesigns(name, 'kom', 10, r);
    const sprintDesigns = signDesigns(name, 'sprint', 6, r);
    let komNext = 0;
    let sprintNext = 0;
    // Zones de public : fin des KOM (350 m) et des sprints (120 m), et foule serrée sur 30 m de part et d'autre de
    // chaque arche (départ, arrivée, départ de KOM, départ et ligne de sprint).
    const zones: Array<{ startM: number; endM: number; kom: boolean; arch: boolean }> = [];
    for (const seg of track.route.segments.filter((s) => s.kind === 'kom' || s.kind === 'sprint')) {
      const kom = seg.kind === 'kom';
      zones.push({ startM: Math.max(seg.startM, seg.endM - (kom ? 350 : 120)), endM: seg.endM, kom, arch: false });
      zones.push({ startM: Math.max(0, seg.startM - 30), endM: Math.min(track.length, seg.startM + 30), kom, arch: true });
      zones.push({ startM: seg.endM, endM: Math.min(track.length, seg.endM + 30), kom, arch: true });
    }
    // Arrivée de course : foule de FINISH_M mètres derrière les barrières (voir plus bas) ; sinon 60 m serrés.
    const finish = opts.finish === true && track.length > 120;
    if (!finish) zones.push({ startM: Math.max(0, track.length - 60), endM: track.length - 1, kom: false, arch: true });
    if (!track.route.loop) zones.push({ startM: 0, endM: 40, kom: false, arch: true });

    /**
     * Pose un spectateur à `dd` (m) et `lateral` (m, signé) ; porteur de pancarte avec la probabilité `sign`.
     * `yawJitter` : écart d'orientation (rad) pour une foule moins alignée.
     */
    const put = (dd: number, lateral: number, kom: boolean, sign: number, yawJitter = 0): void => {
      const side = Math.sign(lateral);
      const p = track.positionAt(dd, lateral);
      const ground = groundAt(p.x, p.z);
      const y = (Number.isFinite(ground) ? ground : p.y) - 0.05;
      // Face à la route : regard perpendiculaire à la direction de marche.
      const yaw = Math.atan2(p.dirX, p.dirZ) + (side > 0 ? -Math.PI / 2 : Math.PI / 2) + (r() - 0.5) * 2 * yawJitter;
      q.setFromAxisAngle(up, yaw);
      spots.push(p.x, p.z, Math.cos(yaw), Math.sin(yaw));
      const s = 0.9 + r() * 0.2;
      orient.push(Math.cos(yaw), Math.sin(yaw), s);
      m.compose(new THREE.Vector3(p.x, y, p.z), q, new THREE.Vector3(s, s, s));
      mats.push(m.clone());
      const holder = r() < sign;
      still.push(holder ? 1 : 0);
      if (!holder) return;
      // Pancarte tournée vers la route et vers les coureurs qui arrivent.
      const c = track.positionAt(dd, 0);
      const n = new THREE.Vector3(c.x - p.x, 0, c.z - p.z).normalize().addScaledVector(new THREE.Vector3(-p.dirX, 0, -p.dirZ), 0.75).normalize();
      const sq = new THREE.Quaternion().setFromAxisAngle(up, Math.atan2(n.x, n.z));
      const pos = new THREE.Vector3(p.x + n.x * 0.25, y, p.z + n.z * 0.25);
      signMats.push(new THREE.Matrix4().compose(pos, sq, new THREE.Vector3(s, s, s)));
      signSpots.push(pos.x, pos.z);
      signCells.push(kom ? komNext++ % 10 : 10 + (sprintNext++ % 6));
    };

    for (const seg of zones) {
      const kom = seg.kom;
      for (let d = seg.startM; d < seg.endM; d += (seg.arch ? 2.4 : kom ? 3.25 : 4) / density) {
        for (const side of [-1, 1]) {
          if (r() < (seg.arch ? 0.15 : kom ? 0.35 : 0.5)) continue;
          const lateral = side * (half + 1.6 + r() * 3);
          // Premier rang, dans les 150 derniers mètres (KOM) : une pancarte de temps en temps.
          const front = Math.abs(lateral) < half + 3;
          put(d + r() * 2, lateral, kom, front && seg.endM - d < (kom ? 150 : 120) ? 0.32 : 0);
        }
      }
    }

    // Arrivée de course : derrière les barrières, de plus en plus serrés et nombreux vers la ligne (1 rang à
    // FINISH_M mètres, 4 sur les 50 derniers), pancartes au premier rang, un peu de foule passé la ligne.
    const barrierMats: THREE.Matrix4[] = [];
    if (finish) {
      const len = track.length;
      const from = Math.max(0, len - FINISH_M);
      for (let d = from; d < len - 1; ) {
        const c = Math.min(1, (d - from) / (len - 50 - from));
        const rows = 1 + Math.round(3 * c * c);
        for (const side of [-1, 1])
          for (let row = 0; row < rows; row++) {
            if (r() < 0.12) continue;
            const lateral = side * (half + BARRIER_GAP + 0.55 + row * 0.7 + (r() - 0.5) * 0.25);
            put(d + (r() - 0.5) * 0.8, lateral, false, row === 0 ? 0.08 + 0.17 * c : 0, 0.35);
          }
        d += (2.6 - 1.7 * c) / density;
      }
      // Barrières des deux côtés, de FINISH_BARRIER_M mètres avant la ligne jusqu'à la ligne.
      const bq = new THREE.Quaternion();
      for (let d = Math.max(0, len - FINISH_BARRIER_M); d + BARRIER_LEN <= len - 0.5; d += BARRIER_LEN + 0.05)
        for (const side of [-1, 1]) {
          const p = track.positionAt(d + BARRIER_LEN / 2, side * (half + BARRIER_GAP));
          const ground = groundAt(p.x, p.z);
          const y = (Number.isFinite(ground) ? ground : p.y) - 0.02;
          // Bâche imprimée (−z local) tournée vers la chaussée.
          const c = track.positionAt(d + BARRIER_LEN / 2, 0);
          bq.setFromAxisAngle(up, Math.atan2(p.x - c.x, p.z - c.z));
          barrierMats.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, y, p.z), bq, new THREE.Vector3(1, 1, 1)));
        }
    }
    // Style jeu vidéo : spectateurs à facettes, animés seulement à l'approche du coureur (crowdLowPoly.ts).
    const mat = LOW_POLY ? lowPolyCrowdMaterial(padded(spots, 4), padded(still, 1), this.rider) : realCrowdMaterial(still);
    this.mesh = new THREE.InstancedMesh(LOW_POLY ? lowPolyPersonGeometry() : personGeometry(), mat, Math.max(mats.length, 1));
    mats.forEach((mm, i) => this.mesh.setMatrixAt(i, mm));
    this.mesh.count = mats.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.computeBoundingSphere();
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'crowd';
    this.group.add(this.mesh);
    if (!LOW_POLY && mats.length && opts.realPeople !== false) {
      // Vrais personnages recolorés dès que leurs fichiers sont là ; d'ici là (ou s'ils manquent), les capsules.
      // Un maillage instancié par personnage ; chaque spectateur en tire un selon les poids (tirage fixe).
      void loadSpectators().then((assets) => {
        if (!assets.length) return;
        const total = assets.reduce((n, a) => n + a.weight, 0);
        const pick = rng(4242);
        const groups = assets.map(() => ({ mats: [] as THREE.Matrix4[], orient: [] as number[], still: [] as number[] }));
        mats.forEach((mm, i) => {
          let x = pick() * total;
          let k = 0;
          while (k < assets.length - 1 && x >= (assets[k] as (typeof assets)[number]).weight) x -= (assets[k++] as (typeof assets)[number]).weight;
          const g = groups[k] as (typeof groups)[number];
          g.mats.push(mm);
          g.orient.push(orient[i * 3] as number, orient[i * 3 + 1] as number, orient[i * 3 + 2] as number);
          g.still.push(still[i] as number);
        });
        assets.forEach((asset, k) => {
          const g = groups[k] as (typeof groups)[number];
          if (!g.mats.length) return;
          const mesh = new THREE.InstancedMesh(asset.geometry, spectatorMaterial(asset, padded(g.orient, 3), padded(g.still, 1), k * 1009), g.mats.length);
          g.mats.forEach((mm, i) => mesh.setMatrixAt(i, mm));
          mesh.instanceMatrix.needsUpdate = true;
          mesh.computeBoundingSphere();
          mesh.castShadow = false;
          mesh.receiveShadow = true;
          mesh.name = `crowd-${asset.name}`;
          this.group.add(mesh);
          this.people.push(mesh);
        });
        // Les capsules restent dans le groupe (comptes, tests) mais ne sont plus dessinées.
        this.mesh.visible = false;
      });
    }
    if (LOW_POLY) {
      // Sans appel à `update`, la caméra tient lieu de coureur (elle le suit dans presque tous les plans).
      this.mesh.onBeforeRender = (_r, _s, camera) => {
        if (!this.driven) this.rider.value.set(camera.matrixWorld.elements[12] as number, camera.matrixWorld.elements[14] as number);
      };
    }

    if (signMats.length) {
      const atlas = signAtlas([...komDesigns, ...sprintDesigns]);
      const offsets = new Float32Array(signCells.length * 2);
      signCells.forEach((c, i) => {
        offsets[i * 2] = (c % ATLAS_COLS) / ATLAS_COLS;
        offsets[i * 2 + 1] = 1 - (Math.floor(c / ATLAS_COLS) + 1) / ATLAS_ROWS;
      });
      const cell = instancedBufferAttribute(new THREE.InstancedBufferAttribute(offsets, 2)) as unknown as ReturnType<typeof vec2>;
      const smat = LOW_POLY ? lowPolySignMaterial(atlas, cell, ATLAS_COLS, ATLAS_ROWS, new Float32Array(signSpots), this.rider) : realSignMaterial(atlas, cell);
      const signs = new THREE.InstancedMesh(LOW_POLY ? lowPolySignGeometry(SIGN_W, SIGN_H) : signGeometry(), smat, signMats.length);
      signMats.forEach((mm, i) => signs.setMatrixAt(i, mm));
      signs.instanceMatrix.needsUpdate = true;
      signs.computeBoundingSphere();
      signs.castShadow = false;
      signs.receiveShadow = true;
      signs.name = 'crowd-signs';
      this.signs = signs;
      this.group.add(signs);
    } else this.signs = null;

    if (barrierMats.length) {
      const barriers = new THREE.InstancedMesh(barrierGeometry(), barrierMaterial(), barrierMats.length);
      barrierMats.forEach((mm, i) => barriers.setMatrixAt(i, mm));
      barriers.instanceMatrix.needsUpdate = true;
      barriers.computeBoundingSphere();
      barriers.castShadow = true;
      barriers.receiveShadow = true;
      barriers.name = 'crowd-barriers';
      this.barriers = barriers;
      this.group.add(barriers);
    } else this.barriers = null;
  }

  /**
   * Position du coureur sur l'itinéraire (style jeu vidéo : le public ne s'anime qu'à son approche, puis
   * se calme après son passage). À appeler à chaque image ; sans appel, la caméra sert de repli.
   */
  update(riderDistM: number): void {
    const p = this.track.positionAt(riderDistM, 0);
    if (LOW_POLY) {
      this.rider.value.set(p.x, p.z);
      this.driven = true;
    }
    this.reground(p.x, p.z);
  }

  /**
   * Spectateurs et pancartes reposés sur le sol dessiné, 64 par image, à moins de 600 m du coureur : le
   * public est placé à la construction de la sortie, souvent avant le chargement des tuiles (hauteur de la
   * route en repli), et le terrain s'affine ensuite (tuile détaillée) : sinon enfoncés ou en l'air.
   * Style réaliste : ce sont les maillages des vrais personnages (les capsules ne sont plus dessinées).
   */
  private reground(rx: number, rz: number): void {
    const bodies = this.people.length ? this.people : [this.mesh];
    const meshes = [...bodies, ...(this.signs ? [this.signs] : []), ...(this.barriers ? [this.barriers] : [])];
    const total = meshes.reduce((n, m) => n + m.count, 0);
    if (!total) return;
    for (let k = 0; k < 64; k++) {
      let i = this.groundCursor++ % total;
      let j = 0;
      while (i >= (meshes[j] as THREE.InstancedMesh).count) i -= (meshes[j++] as THREE.InstancedMesh).count;
      const mesh = meshes[j] as THREE.InstancedMesh;
      const a = mesh.instanceMatrix.array as Float32Array;
      const x = a[i * 16 + 12] as number;
      const z = a[i * 16 + 14] as number;
      if ((x - rx) ** 2 + (z - rz) ** 2 > 600 * 600) continue;
      const g = this.groundAt(x, z);
      if (!Number.isFinite(g)) continue;
      const y = g - (mesh === this.barriers ? 0.02 : 0.05);
      if (Math.abs((a[i * 16 + 13] as number) - y) < 0.02) continue;
      a[i * 16 + 13] = y;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

/** Attribut d'instance d'au moins une instance (le maillage instancié n'est jamais vide). */
function padded(values: number[], itemSize: number): Float32Array {
  const out = new Float32Array(Math.max(values.length, itemSize));
  out.set(values);
  return out;
}

/** Spectateurs du style réaliste (capsules de repli) : agitent les bras, les pieds restent au sol. */
function realCrowdMaterial(still: number[]): THREE.MeshStandardNodeMaterial {
  const mat = new THREE.MeshStandardNodeMaterial();
  const part = attribute<'float'>('part');
  const h = hash(instanceIndex);
  const h2 = hash(instanceIndex.add(31));
  // Porteurs de pancarte : bras immobiles (ils tiennent le manche).
  const stillAttr = instancedBufferAttribute(new THREE.InstancedBufferAttribute(new Float32Array(Math.max(still.length, 1)).map((_, i) => still[i] ?? 0), 1)) as unknown as ReturnType<typeof float>;
  const move = float(1).sub(stillAttr);
  // Bras agités sur le côté, déphasés par spectateur (pas de saut : le public ne monte ni ne descend).
  const wave = sin(time.mul(9).add(h.mul(10))).mul(0.18).mul(part.equal(2).select(float(1), float(0))).mul(move);
  // positionLocal inclut déjà la transformation d'instance : le côté du bras vient de l'attribut brut.
  const raw = attribute<'vec3'>('position');
  mat.positionNode = positionLocal.add(vec3(wave.mul(raw.x.sign()), 0, 0));
  // Maillots et vêtements variés : choix par paliers du hachage de l'instance.
  const step = (e: number) => h.greaterThan(e).select(float(1), float(0));
  const shirt = mix(mix(mix(mix(color('#e63946'), color('#ffd23f'), step(0.2)), color('#2a9d8f'), step(0.4)), color('#f4f4f4'), step(0.6)), color('#1f6feb'), step(0.8));
  const skin = mix(color('#f1c27d'), color('#8d5524'), h2);
  mat.colorNode = varying(mix(shirt, skin, part.equal(1).select(float(1), float(0))));
  mat.roughnessNode = float(0.8);
  return mat;
}

/** Pancartes du style réaliste : carton à l'atlas, verso nu, manche en bois. */
function realSignMaterial(atlas: THREE.Texture, cell: ReturnType<typeof vec2>): THREE.MeshStandardNodeMaterial {
  const smat = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
  const spart = attribute<'float'>('part');
  const atlasUv = uv().mul(vec2(1 / ATLAS_COLS, 1 / ATLAS_ROWS)).add(cell);
  // Recto : la pancarte ; verso : carton nu ; manche en bois.
  const face = frontFacing.select(texture(atlas, atlasUv).rgb, vec3(0.48, 0.3, 0.13));
  smat.colorNode = spart.equal(0).select(face, vec3(0.2, 0.11, 0.05));
  smat.roughnessNode = float(0.85);
  // Pancartes : lent balancement latéral, déphasé, sans va-et-vient vertical.
  const sh = hash(instanceIndex.add(7));
  const sway = sin(time.mul(float(1.1).add(sh.mul(0.5))).add(sh.mul(9))).mul(0.04);
  smat.positionNode = positionLocal.add(vec3(sway, 0, 0));
  return smat;
}
