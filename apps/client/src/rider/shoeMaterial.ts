import * as THREE from 'three/webgpu';
import { abs, clamp, faceDirection, float, floor, fract, fwidth, length, mix, normalView, positionView, smoothstep, step, texture, uniform, uv, vec2 } from 'three/tsl';
import type { AvatarLook } from '@allezrobert/shared';
import { colorUniform } from '../engine/tsl.ts';
import { shoeAccentOf, shoeColorOf, shoeMarkText } from './shoeLook.ts';

/**
 * Tige des chaussures (matériau « shoe » des modèles, tools/blender/build_cyclist.py) : couleur
 * du look, perforations de l'avant-pied et du bout, nervures diagonales des flancs, marquage
 * latéral facultatif (AvatarLook.shoeMark, couleur shoeAccent). Tout est calculé dans le nuanceur
 * à partir des deux jeux de coordonnées des modèles :
 *   uv  : u = longueur depuis le talon, v = 0,5 + abscisse autour depuis le dessus (0,3 m par unité,
 *         v > 0,5 côté extérieur) ;
 *   uv1 : boîte du marquage (0..1 sur le flanc extérieur, lisible sur les deux pieds).
 * Les motifs s'effacent quand ils deviennent plus fins que le pixel (pas de moiré au loin).
 */

/** Pas des perforations (m) et rapport mètres / unité de texture. */
const PERF_STEP = 0.0032;
const UV_M = 0.3;
const MARK_W = 1024;
const MARK_H = 156;

/** Texture vide (aucun marquage). */
const BLANK = new THREE.DataTexture(new Uint8Array(4), 1, 1);
BLANK.needsUpdate = true;

const marks = new Map<string, THREE.CanvasTexture>();

/** Marquage blanc sur fond transparent (alpha = lettres), à la proportion de la boîte du modèle. */
function markTexture(text: string): THREE.Texture {
  if (typeof document === 'undefined') return BLANK;
  const hit = marks.get(text);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = MARK_W;
  cv.height = MARK_H;
  const g = cv.getContext('2d') as CanvasRenderingContext2D;
  const font = (px: number) => `italic 900 ${px.toFixed(1)}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
  let px = MARK_H;
  g.font = font(px);
  let m = g.measureText(text);
  const glyphH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent || px * 0.72;
  px *= (MARK_H * 0.78) / glyphH;
  g.font = font(px);
  m = g.measureText(text);
  if (m.width > MARK_W * 0.94) {
    px *= (MARK_W * 0.94) / m.width;
    g.font = font(px);
    m = g.measureText(text);
  }
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillText(text, MARK_W / 2, MARK_H / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;
  marks.set(text, tex);
  return tex;
}

type FloatNode = THREE.Node<'float'>;

/** 1 entre lo et hi (bords adoucis sur e). */
const band = (x: FloatNode, lo: number, hi: number, e: number): FloatNode =>
  smoothstep(lo - e, lo, x).mul(float(1).sub(smoothstep(hi, hi + e, x)));

export class ShoeMaterial {
  readonly material = new THREE.MeshStandardNodeMaterial({ roughness: 0.32, metalness: 0 });
  private readonly base = colorUniform('#f2f2f2');
  private readonly accent = colorUniform('#8a9099');
  private readonly markOn = uniform(0);
  private readonly mark = texture(BLANK, uv(1));

  constructor(look: AvatarLook) {
    this.material.name = 'shoe';
    const t = uv();
    const a = t.x;
    const side = abs(t.y.sub(0.5));

    // Perforations : panneaux latéraux de l'avant-pied et dessus du bout.
    const zone = clamp(band(a, 0.69, 0.93, 0.015).mul(band(side, 0.09, 0.24, 0.015)).add(band(a, 0.86, 0.975, 0.012).mul(float(1).sub(smoothstep(0.075, 0.095, side)))), 0, 1);
    const p = vec2(t.x, t.y).mul(UV_M / PERF_STEP);
    const row = floor(p.y);
    const cell = fract(vec2(p.x.add(row.mul(0.5)), p.y)).sub(0.5);
    const w = fwidth(p.x).add(fwidth(p.y)).mul(0.5);
    const dots = float(1).sub(smoothstep(float(0.2).sub(w), float(0.2).add(w), length(cell)));
    const perf = dots.mul(zone).mul(float(1).sub(smoothstep(0.3, 0.6, w)));

    // Nervures diagonales des flancs (milieu du pied), pas de 6 mm.
    const ribZone = band(a, 0.33, 0.6, 0.02).mul(band(side, 0.07, 0.24, 0.02));
    const q = a.add(side).mul(UV_M / 0.006);
    const wq = fwidth(q);
    const groove = smoothstep(0, float(0.08).add(wq), fract(q)).mul(float(1).sub(smoothstep(0.22, float(0.3).add(wq), fract(q))));
    const rib = groove.mul(ribZone).mul(float(1).sub(smoothstep(0.25, 0.5, wq)));

    // Marquage latéral (alpha de la texture, dans la boîte seulement).
    const m = uv(1);
    const inBox = step(0, m.x).mul(step(m.x, 1)).mul(step(0, m.y)).mul(step(m.y, 1));
    const ink = this.mark.a.mul(inBox).mul(this.markOn);

    const col = mix(this.base.node, this.accent.node, ink);
    this.material.colorNode = col.mul(float(1).sub(perf.mul(0.45))).mul(float(1).sub(rib.mul(0.08)));
    this.material.roughnessNode = float(0.32).add(perf.mul(0.45)).add(rib.mul(0.15)).add(ink.mul(0.1));

    // Relief (perforations creuses, nervures) : perturbation de la normale par les dérivées
    // écran de la hauteur (Mikkelsen, comme BumpMapNode, sans texture).
    const h = perf.add(rib.mul(0.6)).negate();
    const dh = vec2(h.dFdx(), h.dFdy()).mul(0.5);
    const sx = positionView.dFdx().normalize();
    const sy = positionView.dFdy().normalize();
    const r1 = sy.cross(normalView);
    const r2 = normalView.cross(sx);
    const det = sx.dot(r1).mul(faceDirection);
    const grad = det.sign().mul(r1.mul(dh.x).add(r2.mul(dh.y)));
    this.material.normalNode = det.abs().mul(normalView).sub(grad).normalize();

    this.setLook(look);
  }

  setLook(look: AvatarLook): void {
    this.base.set(shoeColorOf(look));
    this.accent.set(shoeAccentOf(look));
    const text = shoeMarkText(look);
    this.markOn.value = text ? 1 : 0;
    this.mark.value = text ? markTexture(text) : BLANK;
  }
}
