import * as THREE from 'three/webgpu';
import { attribute, positionLocal, time, sin, abs, vec2, vec3, float, mix, instanceIndex, hash, color, varying, max, uv, texture, frontFacing, instancedBufferAttribute, uniform } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RouteTrack } from '@allezrobert/shared';
import { rng } from '../engine/noise.ts';
import { LOW_POLY } from '../engine/style.ts';
import { signDesigns, type SignDesign } from './crowdSigns.ts';
import { lowPolyCrowdMaterial, lowPolyPersonGeometry, lowPolySignGeometry, lowPolySignMaterial } from './crowdLowPoly.ts';

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
  readonly group = new THREE.Group();
  /**
   * Style jeu vidéo : position du coureur (x, z). Le public ne s'anime qu'à son approche (voir
   * crowdLowPoly.ts). Mise à jour par `update` ; tant qu'elle ne l'est pas, la caméra en tient lieu.
   */
  private readonly rider = uniform(new THREE.Vector2(1e9, 1e9));
  private driven = false;
  private readonly track: RouteTrack;

  constructor(track: RouteTrack, groundAt: (x: number, z: number) => number, opts: CrowdOptions = {}) {
    this.track = track;
    const r = rng(2026);
    const mats: THREE.Matrix4[] = [];
    const still: number[] = [];
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
    for (const seg of track.route.segments.filter((s) => s.kind === 'kom' || s.kind === 'sprint')) {
      const kom = seg.kind === 'kom';
      const from = Math.max(seg.startM, seg.endM - (kom ? 350 : 120));
      for (let d = from; d < seg.endM; d += (kom ? 3.25 : 4) / density) {
        for (const side of [-1, 1]) {
          if (r() < (kom ? 0.35 : 0.5)) continue;
          const lateral = side * (half + 1.6 + r() * 3);
          const dd = d + r() * 2;
          const p = track.positionAt(dd, lateral);
          const ground = groundAt(p.x, p.z);
          const y = (Number.isFinite(ground) ? ground : p.y) - 0.05;
          // Face à la route : regard perpendiculaire à la direction de marche.
          const yaw = Math.atan2(p.dirX, p.dirZ) + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
          q.setFromAxisAngle(up, yaw);
          spots.push(p.x, p.z, Math.cos(yaw), Math.sin(yaw));
          const s = 0.9 + r() * 0.2;
          m.compose(new THREE.Vector3(p.x, y, p.z), q, new THREE.Vector3(s, s, s));
          mats.push(m.clone());
          // Premier rang, dans les 150 derniers mètres (KOM) : une pancarte de temps en temps.
          const front = Math.abs(lateral) < half + 3;
          const holder = front && seg.endM - d < (kom ? 150 : 120) && r() < 0.32;
          still.push(holder ? 1 : 0);
          if (!holder) continue;
          // Pancarte tournée vers la route et vers les coureurs qui arrivent.
          const c = track.positionAt(dd, 0);
          const n = new THREE.Vector3(c.x - p.x, 0, c.z - p.z).normalize().addScaledVector(new THREE.Vector3(-p.dirX, 0, -p.dirZ), 0.75).normalize();
          const sq = new THREE.Quaternion().setFromAxisAngle(up, Math.atan2(n.x, n.z));
          const pos = new THREE.Vector3(p.x + n.x * 0.25, y, p.z + n.z * 0.25);
          signMats.push(new THREE.Matrix4().compose(pos, sq, new THREE.Vector3(s, s, s)));
          signSpots.push(pos.x, pos.z);
          signCells.push(kom ? komNext++ % 10 : 10 + (sprintNext++ % 6));
        }
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
  }

  /**
   * Position du coureur sur l'itinéraire (style jeu vidéo : le public ne s'anime qu'à son approche, puis
   * se calme après son passage). À appeler à chaque image ; sans appel, la caméra sert de repli.
   */
  update(riderDistM: number): void {
    if (!LOW_POLY) return;
    const p = this.track.positionAt(riderDistM, 0);
    this.rider.value.set(p.x, p.z);
    this.driven = true;
  }
}

/** Attribut d'instance d'au moins une instance (le maillage instancié n'est jamais vide). */
function padded(values: number[], itemSize: number): Float32Array {
  const out = new Float32Array(Math.max(values.length, itemSize));
  out.set(values);
  return out;
}

/** Spectateurs du style réaliste : sautent et agitent les bras en permanence. */
function realCrowdMaterial(still: number[]): THREE.MeshStandardNodeMaterial {
  const mat = new THREE.MeshStandardNodeMaterial();
  const part = attribute<'float'>('part');
  const h = hash(instanceIndex);
  const h2 = hash(instanceIndex.add(31));
  // Porteurs de pancarte : ni saut ni bras agités (ils tiennent le manche).
  const stillAttr = instancedBufferAttribute(new THREE.InstancedBufferAttribute(new Float32Array(Math.max(still.length, 1)).map((_, i) => still[i] ?? 0), 1)) as unknown as ReturnType<typeof float>;
  const move = float(1).sub(stillAttr);
  // Saut et bras agités, déphasés par spectateur.
  const jump = max(sin(time.mul(float(5).add(h.mul(3))).add(h.mul(20))), float(0)).mul(0.12).mul(h2.greaterThan(0.5).select(float(1), float(0.3))).mul(move);
  const wave = sin(time.mul(9).add(h.mul(10))).mul(0.18).mul(part.equal(2).select(float(1), float(0))).mul(move);
  // positionLocal inclut déjà la transformation d'instance : le côté du bras vient de l'attribut brut.
  const raw = attribute<'vec3'>('position');
  mat.positionNode = positionLocal.add(vec3(wave.mul(raw.x.sign()), jump.add(abs(wave).mul(0.3)), 0));
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
  // Pancartes agitées : léger va-et-vient vertical et latéral, déphasé.
  const sh = hash(instanceIndex.add(7));
  const lift = sin(time.mul(float(2.2).add(sh)).add(sh.mul(12))).mul(0.06);
  const sway = sin(time.mul(1.6).add(sh.mul(9))).mul(0.05);
  smat.positionNode = positionLocal.add(vec3(sway, lift, 0));
  return smat;
}
