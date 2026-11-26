import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { climbCategory, climbCategoryLabel, komPoints, type RouteTrack } from '@allezrobert/shared';
import { groundChange, settleWhileVisible } from './groundSettle.ts';

type Kind = 'finish' | 'start' | 'km10' | 'km1' | 'summit' | 'komStart' | 'sprintStart' | 'sprintEnd' | 'split';

/** Sommet d'une côte classée : nom, catégorie et points du classement de la montagne. */
interface Summit {
  name: string;
  category: string;
  points: string;
}

/** Texture d'une banderole en travers de la route (`ratio` = largeur / hauteur). */
function bannerTexture(kind: Kind, ratio: number, summit?: Summit, label = 'ARRIVÉE'): THREE.CanvasTexture {
  const H = 256;
  const W = Math.round(H * ratio);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const font = (px: number) => `900 ${px}px "DIN Alternate", "Arial Black", Impact, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (kind === 'finish' || kind === 'start') {
    // Damier noir et blanc aux deux bouts, « ARRIVÉE » sur fond jaune.
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(0, 0, W, H);
    const sq = H / 4;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        ctx.fillStyle = (i + j) % 2 ? '#111' : '#fff';
        ctx.fillRect(j * sq, i * sq, sq, sq);
        ctx.fillRect(W - (j + 1) * sq, i * sq, sq, sq);
      }
    }
    ctx.fillStyle = '#c8102e';
    ctx.font = font(150);
    ctx.fillText(label, W / 2, H / 2 + 6, W - 2 * H - 20);
  } else if (kind === 'summit' && summit) {
    // Maillot à pois : fond blanc, pois rouges, bandeau central lisible.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#d4141c';
    for (let row = 0, y = 20; y < H + 30; row++, y += 52) for (let x = row % 2 ? 0 : 26; x < W + 30; x += 52) {
      ctx.beginPath();
      ctx.arc(x, y, 17, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.93)';
    ctx.fillRect(W * 0.04, H * 0.12, W * 0.92, H * 0.76);
    ctx.fillStyle = '#d4141c';
    ctx.font = font(96);
    ctx.fillText(`SOMMET · ${summit.category.toUpperCase()}`, W / 2, H * 0.32, W * 0.88);
    ctx.fillStyle = '#111';
    ctx.font = font(70);
    ctx.fillText(summit.name.toUpperCase(), W / 2, H * 0.58, W * 0.88);
    ctx.fillStyle = '#d4141c';
    ctx.font = font(52);
    ctx.fillText(summit.points, W / 2, H * 0.79, W * 0.88);
  } else if (kind === 'komStart' || kind === 'sprintStart' || kind === 'sprintEnd') {
    // Départ de KOM (rouge), départ et ligne de sprint (vert) : titre, nom du segment en dessous.
    const kom = kind === 'komStart';
    ctx.fillStyle = kom ? '#e5322d' : '#22a04b';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, 12);
    ctx.fillRect(0, H - 12, W, 12);
    ctx.font = font(118);
    ctx.fillText(kom ? 'DÉPART KOM' : kind === 'sprintStart' ? 'DÉPART SPRINT' : 'SPRINT', W / 2, H * 0.4, W * 0.9);
    ctx.font = font(62);
    ctx.fillText((summit?.name ?? label).toUpperCase(), W / 2, H * 0.78, W * 0.9);
  } else if (kind === 'split') {
    // Intermédiaire du contre-la-montre (orange) : numéro du pointage, « CHRONO » en dessous.
    ctx.fillStyle = '#f08a1c';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, 12);
    ctx.fillRect(0, H - 12, W, 12);
    ctx.font = font(118);
    ctx.fillText(label, W / 2, H * 0.4, W * 0.9);
    ctx.font = font(62);
    ctx.fillText('CONTRE-LA-MONTRE', W / 2, H * 0.78, W * 0.9);
  } else {
    ctx.fillStyle = kind === 'km1' ? '#c8102e' : '#1f4f9c';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, 14);
    ctx.fillRect(0, H - 14, W, 14);
    ctx.font = font(150);
    ctx.fillText(kind === 'km1' ? '1 KM' : '10 KM', W / 2, H * 0.4, W * 0.9);
    ctx.font = font(70);
    ctx.fillText('DE L’ARRIVÉE', W / 2, H * 0.8, W * 0.9);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Triangle rouge de la flamme rouge (1 km), suspendu au milieu du portique. */
function flameGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const v = new Float32Array([-0.55, 0, 0, 0.55, 0, 0, 0, -1.1, 0]);
  g.setAttribute('position', new THREE.BufferAttribute(v, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  return g;
}

/**
 * Portiques en travers de la route comme dans les vraies courses : banderole « 10 km » et
 * banderole « 1 km » avec la flamme rouge au-dessus de la chaussée, puis l'arche d'arrivée en
 * damier. Posés sur la route, face aux coureurs qui arrivent ; un seul appel de dessin par pièce.
 */
export class FinishBanners {
  readonly group = new THREE.Group();
  /** Panneau côté arrivée de l'arche d'une boucle : « ARRIVÉE » au dernier tour, sinon les kilomètres parcourus. */
  private loopFront: { mat: THREE.MeshStandardNodeMaterial; ratio: number; text: string } | null = null;
  private lapLengthM = 0;

  /**
   * Boucle de plusieurs tours : à chaque passage de la ligne, « ARRIVÉE » seulement au dernier tour ;
   * avant, la distance parcourue (`lap` = tour en cours, 1 à `laps`). `laps` absent : sortie libre, jamais « ARRIVÉE ».
   */
  setLap(lap: number, laps?: number): void {
    const lf = this.loopFront;
    if (!lf) return;
    const text = laps !== undefined && lap >= laps ? 'ARRIVÉE' : `${((lap * this.lapLengthM) / 1000).toFixed(1).replace('.', ',')} KM`;
    if (text === lf.text) return;
    lf.text = text;
    lf.mat.map?.dispose();
    lf.mat.map = bannerTexture('finish', lf.ratio, undefined, text);
    lf.mat.needsUpdate = true;
  }

  /**
   * `blocked` : premier bâtiment sur un segment (fraction 0–1 ou null, voir BuildingFootprints.firstHit) ; sert à
   * rétrécir l'arche dans une rue étroite, sinon un montant disparaît dans la façade (l'arche semble coupée).
   */
  constructor(track: RouteTrack, groundAt: (x: number, z: number) => number, blocked?: (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => number | null, opts: { splitsM?: readonly number[] } = {}) {
    this.group.name = 'finish-banners';
    const len = track.length;
    this.lapLengthM = len;
    // Boucle : une seule arche, départ et arrivée ; sinon une arche de départ 6 m après la ligne de départ.
    const loop = track.route.loop;
    const spots: Array<{ d: number; kind: Kind; summit?: Summit; label?: string; backLabel?: string }> = [{ d: len - 0.5, kind: 'finish', label: 'ARRIVÉE', backLabel: loop ? 'DÉPART' : 'ARRIVÉE' }];
    if (!loop) spots.push({ d: 6, kind: 'start', label: 'DÉPART', backLabel: 'DÉPART' });
    if (len > 3000) spots.push({ d: len - 1000, kind: 'km1' });
    if (len > 15000) spots.push({ d: len - 10000, kind: 'km10' });
    // Contre-la-montre : arche orange à chaque intermédiaire (mêmes distances que les temps annoncés).
    (opts.splitsM ?? []).forEach((d, i) => spots.push({ d, kind: 'split', label: `INTERMÉDIAIRE ${i + 1}` }));
    // Sommet de chaque côte, comme les banderoles du Grand Prix de la montagne.
    for (const seg of track.route.segments) {
      if (seg.kind !== 'kom') continue;
      const cat = climbCategory(seg);
      const pts = komPoints(cat);
      spots.push({ d: seg.endM, kind: 'summit', summit: { name: seg.name, category: climbCategoryLabel(cat), points: `GRIMPEUR : ${pts.join(' · ')} PTS` } });
    }
    // Départ des KOM, départ et ligne des sprints (arches gonflables rouges et vertes).
    for (const seg of track.route.segments) {
      if (seg.kind === 'kom' && seg.startM > 8) spots.push({ d: seg.startM, kind: 'komStart', label: seg.name });
      if (seg.kind === 'sprint') {
        if (seg.startM > 8) spots.push({ d: seg.startM, kind: 'sprintStart', label: seg.name });
        spots.push({ d: seg.endM, kind: 'sprintEnd', label: seg.name });
      }
    }
    const half = track.route.roadWidthM / 2;
    const span = half + 1.2; // poteaux à 1,2 m du bord de la chaussée
    const flameMat = new THREE.MeshStandardNodeMaterial({ color: '#d4141c', roughness: 0.6, side: THREE.DoubleSide });
    const TUBE = 0.5; // rayon du boudin gonflable
    // Fût d'un montant : hauteur 1 (mise à l'échelle), haut en y = 0 ; socle noir de 25 cm, bas en y = 0.
    const legGeo = new THREE.CylinderGeometry(TUBE, TUBE, 1, 14).translate(0, -0.5, 0);
    const footGeo = new THREE.CylinderGeometry(TUBE * 1.1, TUBE * 1.1, 0.25, 14).translate(0, 0.125, 0);
    const footMat = new THREE.MeshStandardNodeMaterial({ color: '#222', roughness: 0.8 });
    const tubeColor: Record<Kind, string> ={ finish: '#1f5fbf', start: '#1f5fbf', km1: '#c8102e', km10: '#1f5fbf', summit: '#f4f4f4', komStart: '#f4f4f4', sprintStart: '#f4f4f4', sprintEnd: '#22a04b', split: '#f4f4f4' };
    for (const { d, kind, summit, label, backLabel } of spots) {
      const p = track.positionAt(d, 0);
      const ground = groundAt(p.x, p.z);
      const y = Number.isFinite(ground) ? ground : p.y;
      const g = new THREE.Group();
      const H = kind === 'km1' || kind === 'km10' ? 5.4 : 6.0; // hauteur du sommet de l'arche
      let hw = span + TUBE; // demi-largeur au centre des boudins
      if (blocked) {
        // Largeur libre de chaque côté à 1,5 m du sol : le montant (rayon TUBE + 0,15 m de marge) reste devant la façade.
        const reach = hw + 0.5;
        for (const side of [-1, 1]) {
          const e = track.positionAt(d, side * reach);
          const hit = blocked(p.x, y + 1.5, p.z, e.x, y + 1.5, e.z);
          if (hit !== null) hw = Math.min(hw, Math.max(hit * reach - TUBE - 0.15, half + TUBE + 0.1));
        }
      }
      // Arche gonflable : boudin continu, montants verticaux et haut arrondi (carré à coins ronds).
      const path: THREE.Vector3[] = [];
      for (let k = 0; k <= 48; k++) {
        const t = (k / 48) * Math.PI;
        const c = Math.cos(t);
        path.push(new THREE.Vector3(hw * Math.sign(c) * Math.abs(c) ** 0.4, TUBE + (H - 2 * TUBE) * Math.sin(t) ** 0.3, 0));
      }
      const tubeMat = new THREE.MeshStandardNodeMaterial({ color: tubeColor[kind], roughness: 0.55 });
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path), 96, TUBE, 14), tubeMat);
      tube.castShadow = true;
      g.add(tube);
      // Pieds : socles noirs posés sur le sol affiché sous chaque montant (talus, dévers, pente). Le boudin
      // s'arrête à TUBE (0,5 m) au-dessus du centre de la chaussée : un fût le prolonge TOUJOURS jusqu'au socle,
      // même en terrain plat (sinon le montant flottait 25 cm au-dessus de son pied).
      const len2 = Math.hypot(p.dirX, p.dirZ) || 1;
      const feet: Array<{ x: number; z: number; leg: THREE.Mesh; foot: THREE.Mesh }> = [];
      for (const sx of [-1, 1]) {
        // Axe x local de l'arche après rotation (voir g.rotation.y plus bas) : (−dirZ, dirX) normalisé.
        const fx = p.x + (sx * hw * -p.dirZ) / len2;
        const fz = p.z + (sx * hw * p.dirX) / len2;
        const leg = new THREE.Mesh(legGeo, tubeMat);
        leg.position.set(sx * hw, TUBE, 0);
        leg.castShadow = true;
        const foot = new THREE.Mesh(footGeo, footMat);
        foot.position.x = sx * hw;
        g.add(leg, foot);
        feet.push({ x: fx, z: fz, leg, foot });
      }
      // Sol mesuré à la construction, puis de nouveau tant que l'arche est à l'écran : la tuile pouvait ne pas
      // être chargée (arche posée à l'altitude de l'itinéraire) ou être remplacée par un maillage plus fin.
      const settle = () => {
        const yc = groundChange(g.position.y, groundAt(p.x, p.z));
        if (yc !== null) g.position.y = yc;
        for (const f of feet) {
          const fg = groundAt(f.x, f.z);
          const drop = Number.isFinite(fg) ? Math.min(Math.max(g.position.y - fg, 0), 30) : 0;
          f.leg.scale.y = TUBE + drop;
          f.foot.position.y = -drop;
        }
      };
      settleWhileVisible(tube, settle);
      // Panneau d'inscription tendu sous le haut de l'arche, lisible des deux côtés.
      const bw = hw * 1.6;
      const bh = kind === 'km1' || kind === 'km10' ? 1.3 : 1.5;
      const bannerMat = new THREE.MeshStandardNodeMaterial({ map: bannerTexture(kind, bw / bh, summit, label), roughness: 0.7 });
      if (kind === 'finish' && loop) this.loopFront = { mat: bannerMat, ratio: bw / bh, text: label ?? '' };
      // Verso : sur une boucle, les coureurs qui viennent de partir voient « DÉPART », ceux qui arrivent « ARRIVÉE ».
      const backMat = backLabel && backLabel !== label ? new THREE.MeshStandardNodeMaterial({ map: bannerTexture(kind, bw / bh, summit, backLabel), roughness: 0.7 }) : bannerMat;
      const py = H - TUBE - bh / 2 - 0.1;
      const front = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), bannerMat);
      front.position.set(0, py, TUBE + 0.02);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), backMat);
      back.position.set(0, py, -TUBE - 0.02);
      back.rotation.y = Math.PI;
      g.add(front, back);
      if (kind === 'km1') {
        const flame = new THREE.Mesh(flameGeometry(), flameMat);
        flame.position.set(0, py - bh / 2 - 0.1, 0);
        g.add(flame);
      }
      g.position.set(p.x, y, p.z);
      // Face vers les coureurs : la normale pointe à l'opposé de la direction de marche.
      g.rotation.y = Math.atan2(-p.dirX, -p.dirZ);
      settle();
      this.group.add(g);
    }
    this.addFlags(track, groundAt, span);
  }

  /**
   * Haies de drapeaux des deux côtés de la route sur 40 m autour du départ et de l'arrivée de chaque KOM
   * (rouges et blancs) et sprint (verts et blancs), comme dans les courses : un seul maillage, couleurs par
   * sommet, drapeaux légèrement tournés vers la route.
   */
  private addFlags(track: RouteTrack, groundAt: (x: number, z: number) => number, span: number): void {
    const parts: THREE.BufferGeometry[] = [];
    const paint = (g: THREE.BufferGeometry, hex: string) => {
      const n = g.getAttribute('position').count;
      const c = new THREE.Color(hex);
      const cols = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) c.toArray(cols, i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      return g;
    };
    // Pied de chaque drapeau et ses sommets dans le maillage fusionné (premier sommet, nombre) : re-posé plus tard.
    const bases: Array<{ x: number; z: number; y: number; start: number; count: number }> = [];
    let vertices = 0;
    for (const seg of track.route.segments) {
      if (seg.kind !== 'kom' && seg.kind !== 'sprint') continue;
      const colA = seg.kind === 'kom' ? '#e5322d' : '#22a04b';
      for (const at of [seg.startM, seg.endM]) {
        for (let d = at - 40; d <= at + 40; d += 6) {
          if (d < 2 || d > track.length - 2 || Math.abs(d - at) < 4) continue;
          for (const side of [-1, 1]) {
            const p = track.positionAt(d, side * (span + 1.4));
            const gy = groundAt(p.x, p.z);
            const y = Number.isFinite(gy) ? gy : p.y;
            const k = Math.round(d / 6) + (side > 0 ? 1 : 0);
            const col = k % 2 ? colA : '#f4f4f4';
            const yaw = Math.atan2(p.dirX, p.dirZ) + (side > 0 ? -Math.PI / 2 : Math.PI / 2) + 0.35 * side;
            const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(p.x, y, p.z);
            const pole = paint(new THREE.CylinderGeometry(0.03, 0.035, 3.2, 5).translate(0, 1.6, 0).toNonIndexed(), '#d8d8d8');
            const flag = paint(new THREE.BoxGeometry(0.02, 0.62, 0.95).translate(0, 2.8, -0.5).toNonIndexed(), col);
            let count = 0;
            for (const g of [pole, flag]) {
              g.deleteAttribute('uv');
              g.applyMatrix4(m);
              parts.push(g);
              count += g.getAttribute('position').count;
            }
            bases.push({ x: p.x, z: p.z, y, start: vertices, count });
            vertices += count;
          }
        }
      }
    }
    if (!parts.length) return;
    const merged = mergeGeometries(parts) as THREE.BufferGeometry;
    const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide });
    mat.flatShading = true;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = 'segment-flags';
    mesh.castShadow = true;
    // Mâts posés sur le sol affiché dès qu'il est connu (tuile chargée après coup, maillage plus fin).
    const pos = merged.getAttribute('position') as THREE.BufferAttribute;
    settleWhileVisible(mesh, () => {
      let moved = false;
      for (const b of bases) {
        const y = groundChange(b.y, groundAt(b.x, b.z));
        if (y === null) continue;
        const dy = y - b.y;
        for (let i = b.start; i < b.start + b.count; i++) pos.setY(i, pos.getY(i) + dy);
        b.y = y;
        moved = true;
      }
      if (!moved) return;
      pos.needsUpdate = true;
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
    });
    this.group.add(mesh);
  }
}
