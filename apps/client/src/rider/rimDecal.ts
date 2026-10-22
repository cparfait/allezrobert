import * as THREE from 'three/webgpu';
import { abs, atan, float, fract, length, mix, positionGeometry, sign, step, texture, uniform, vec2 } from 'three/tsl';

/**
 * Inscriptions des jantes : le nom de la marque (`params.rimBrand`) écrit dans la bande décor des
 * roues (matériau « rim_decal » des modèles), comme les autocollants des vraies jantes : deux
 * fois par flanc, lettres tournées vers le pneu, couleur `livery.rim` sur le carbone (ou le
 * chrome des jantes à boyau, le flanc des lenticulaires). Projection dans le nuanceur, en
 * coordonnées polaires autour de l'axe du moyeu (X) : aucun dépliage UV dans les modèles.
 */

/** Libellés des marques de roues (sinon : identifiant en capitales). */
const RIM_WORDMARKS: Record<string, string> = {
  'dt-swiss': 'DT SWISS',
  'swiss-side': 'SWISS SIDE',
  shimano: 'DURA-ACE',
  campagnolo: 'CAMPAGNOLO',
};

export function rimWordmark(brand: string): string {
  return RIM_WORDMARKS[brand] ?? brand.replace(/-/g, ' ').toUpperCase();
}

const textures = new Map<string, { tex: THREE.CanvasTexture; aspect: number }>();

/** Texte blanc sur fond transparent (alpha = lettres), et son rapport largeur / hauteur. */
function wordTexture(text: string): { tex: THREE.CanvasTexture; aspect: number } {
  const hit = textures.get(text);
  if (hit) return hit;
  const H = 96;
  const cv = document.createElement('canvas');
  const g = cv.getContext('2d') as CanvasRenderingContext2D;
  const font = `900 ${H}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
  g.font = font;
  const m = g.measureText(text);
  const glyphH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent || H * 0.72;
  cv.width = Math.ceil(m.width + H * 0.2);
  cv.height = Math.ceil(glyphH * 1.15);
  g.font = font;
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillText(text, cv.width / 2, cv.height / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;
  const out = { tex, aspect: cv.width / cv.height };
  textures.set(text, out);
  return out;
}

export interface RimBand {
  /** Rayons intérieur et extérieur de la bande (repère de la roue). */
  r0: number;
  r1: number;
  /** Fond : jante carbone, jante chromée (boyau) ou flanc de lenticulaire. */
  base: 'carbon' | 'box' | 'disc';
}

/** Bande d'une roue, mesurée sur la géométrie de son maillage « rim_decal » (mise en cache). */
const bands = new WeakMap<THREE.BufferGeometry, { r0: number; r1: number }>();
export function measureBand(g: THREE.BufferGeometry): { r0: number; r1: number } {
  let b = bands.get(g);
  if (!b) {
    const p = g.getAttribute('position');
    let r0 = Infinity;
    let r1 = 0;
    for (let i = 0; i < p.count; i++) {
      const r = Math.hypot(p.getY(i), p.getZ(i));
      r0 = Math.min(r0, r);
      r1 = Math.max(r1, r);
    }
    b = { r0, r1 };
    bands.set(g, b);
  }
  return b;
}

const BASES: Record<RimBand['base'], [string, number, number]> = {
  carbon: ['#1e2024', 0.35, 0.1],
  box: ['#b9bcc2', 0.2, 1],
  disc: ['#1e2024', 0.35, 0.1],
};

export class RimDecalMaterial {
  readonly material: THREE.MeshStandardNodeMaterial;
  private readonly textColor = uniform(new THREE.Color('#f2f2f2'));
  private readonly baseColor = uniform(new THREE.Color());

  constructor(band: RimBand, brand: string) {
    const { tex, aspect } = wordTexture(rimWordmark(brand));
    const [bc, rough, metal] = BASES[band.base];
    (this.baseColor.value as THREE.Color).set(bc);
    const m = new THREE.MeshStandardNodeMaterial({ roughness: rough, metalness: metal });
    m.name = 'rim_decal';
    const p = positionGeometry;
    const r = length(vec2(p.y, p.z));
    const mid = (band.r0 + band.r1) / 2;
    const h = band.r1 - band.r0;
    // Deux inscriptions par flanc, centrées à 0 et π ; abscisse le long de la circonférence (m).
    const reps = 2;
    const L = (2 * Math.PI * mid) / reps;
    const s = fract(atan(p.z, p.y).mul(reps / (2 * Math.PI)).add(0.5)).sub(0.5).mul(L);
    // Lettres : 80 % de la hauteur de bande, sens de lecture rétabli sur le flanc gauche (miroir).
    const textH = h * 0.8;
    const textW = Math.min(textH * aspect, L * 0.8);
    const u = s.mul(sign(p.x).negate()).div(textW).add(0.5);
    const v = r.sub(mid).div(textH).add(0.5);
    const inside = step(abs(u.sub(0.5)), float(0.5)).mul(step(abs(v.sub(0.5)), float(0.5)));
    const a = texture(tex, vec2(u, v)).a.mul(inside);
    m.colorNode = mix(this.baseColor, this.textColor, a);
    m.metalnessNode = mix(float(metal), float(0), a);
    m.roughnessNode = mix(float(rough), float(0.45), a);
    this.material = m;
  }

  set(text: string | undefined, base?: string): void {
    (this.textColor.value as THREE.Color).set(text ?? '#f2f2f2');
    if (base) (this.baseColor.value as THREE.Color).set(base);
  }
}

