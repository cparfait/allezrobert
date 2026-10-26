import * as THREE from 'three/webgpu';
import { climbCategory, climbCategoryLabel, komPoints, type RouteTrack } from '@allezrobert/shared';

type Kind = 'finish' | 'start' | 'km10' | 'km1' | 'summit';

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

  constructor(track: RouteTrack, groundAt: (x: number, z: number) => number) {
    this.group.name = 'finish-banners';
    const len = track.length;
    this.lapLengthM = len;
    // Boucle : une seule arche, départ et arrivée ; sinon une arche de départ 6 m après la ligne de départ.
    const loop = track.route.loop;
    const spots: Array<{ d: number; kind: Kind; summit?: Summit; label?: string; backLabel?: string }> = [{ d: len - 0.5, kind: 'finish', label: 'ARRIVÉE', backLabel: loop ? 'DÉPART' : 'ARRIVÉE' }];
    if (!loop) spots.push({ d: 6, kind: 'start', label: 'DÉPART', backLabel: 'DÉPART' });
    if (len > 3000) spots.push({ d: len - 1000, kind: 'km1' });
    if (len > 15000) spots.push({ d: len - 10000, kind: 'km10' });
    // Sommet de chaque côte, comme les banderoles du Grand Prix de la montagne.
    for (const seg of track.route.segments) {
      if (seg.kind !== 'kom') continue;
      const cat = climbCategory(seg);
      const pts = komPoints(cat);
      spots.push({ d: seg.endM, kind: 'summit', summit: { name: seg.name, category: climbCategoryLabel(cat), points: `GRIMPEUR : ${pts.join(' · ')} PTS` } });
    }
    const half = track.route.roadWidthM / 2;
    const span = half + 1.2; // poteaux à 1,2 m du bord de la chaussée
    const flameMat = new THREE.MeshStandardNodeMaterial({ color: '#d4141c', roughness: 0.6, side: THREE.DoubleSide });
    const TUBE = 0.5; // rayon du boudin gonflable
    const tubeColor: Record<Kind, string> = { finish: '#1f5fbf', start: '#1f5fbf', km1: '#c8102e', km10: '#1f5fbf', summit: '#f4f4f4' };
    for (const { d, kind, summit, label, backLabel } of spots) {
      const p = track.positionAt(d, 0);
      const ground = groundAt(p.x, p.z);
      const y = Number.isFinite(ground) ? ground : p.y;
      const g = new THREE.Group();
      const H = kind === 'finish' || kind === 'start' || kind === 'summit' ? 6.0 : 5.4; // hauteur du sommet de l'arche
      const hw = span + TUBE; // demi-largeur au centre des boudins
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
      // Pieds : socles noirs à la base des montants.
      for (const sx of [-1, 1]) {
        const foot = new THREE.Mesh(new THREE.CylinderGeometry(TUBE * 1.1, TUBE * 1.1, 0.25, 14), new THREE.MeshStandardNodeMaterial({ color: '#222', roughness: 0.8 }));
        foot.position.set(sx * hw, 0.12, 0);
        g.add(foot);
      }
      // Panneau d'inscription tendu sous le haut de l'arche, lisible des deux côtés.
      const bw = hw * 1.6;
      const bh = kind === 'finish' || kind === 'start' || kind === 'summit' ? 1.5 : 1.3;
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
      this.group.add(g);
    }
  }
}
