import * as THREE from 'three/webgpu';
import { abs, attribute, clamp, color, float, floor, fract, hash, length, max, mix, mod, positionGeometry, select, smoothstep, uniform, vec2 } from 'three/tsl';
import type { BikeLivery, LiveryAxis, LiveryFinish, LiveryPattern } from '@allezrobert/shared';
import { colorUniform, type ColorUniform } from '../engine/tsl.ts';

/**
 * Peinture des cadres du catalogue (bikes.json) : même convention que livery_material de
 * tools/blender/bike_families.py (aperçus Blender). Le motif est calculé dans le repère du
 * maillage du cadre (+x gauche, +y haut, +z avant) ; l'attribut de sommet « zone » (COLOR_0 :
 * R avant, G arrière, B fourche, A douille) permet de repeindre une partie du cadre.
 *
 * Tous les paramètres sont des uniformes : un seul programme pour toutes les livrées d'une même
 * finition, et changer de vélo ne recompile rien.
 */

const PATTERNS: readonly LiveryPattern[] = ['solid', 'fade', 'split', 'band', 'stripes', 'rainbow', 'checker', 'blocks', 'dots'];
/** Poids (uz, uy, 1 − uy, ux) de l'abscisse du motif selon l'axe. */
const AXES: Record<LiveryAxis, [number, number, number, number]> = {
  z: [1, 0, 0, 0],
  y: [0, 1, 0, 0],
  diag: [0.5, 0.5, 0, 0],
  anti: [0.5, 0, 0.5, 0],
  x: [0, 0, 0, 1],
};
const RAINBOW = ['#0a5cc2', '#d81e2b', '#111111', '#f4c300', '#1a9b3a'];
/** Finition : rugosité, métal, vernis, épaisseur du film irisé (nm, 0 = aucun). */
const FINISH: Record<LiveryFinish, [number, number, number, number]> = {
  gloss: [0.28, 0, 1, 0],
  matte: [0.62, 0, 0, 0],
  metallic: [0.3, 0.6, 1, 0],
  chrome: [0.08, 1, 1, 0],
  pearl: [0.25, 0, 1, 320],
  iridescent: [0.2, 0, 1, 520],
  raw: [0.28, 0, 1, 0],
};

type FloatNode = THREE.Node<'float'>;
type Vec3Node = THREE.Node<'vec3'>;

const lt = (a: FloatNode, b: FloatNode | number): FloatNode => select(a.lessThan(b), float(1), float(0));
const gt = (a: FloatNode, b: FloatNode | number): FloatNode => select(a.greaterThan(b), float(1), float(0));

/** Rampe à paliers (interpolation « constante » de Blender) : k couleurs régulièrement réparties. */
function ramp(v: FloatNode, colors: Vec3Node[], k: FloatNode | number = colors.length): Vec3Node {
  const idx = clamp(floor(v.mul(k)), 0, typeof k === 'number' ? k - 1 : k.sub(1));
  let out = colors[colors.length - 1] as Vec3Node;
  for (let i = colors.length - 2; i >= 0; i--) out = select(idx.lessThan(i + 0.5), colors[i] as Vec3Node, out);
  return out;
}

export class LiveryMaterial {
  readonly material = new THREE.MeshPhysicalNodeMaterial();
  private readonly cols: ColorUniform[] = Array.from({ length: 5 }, () => colorUniform());
  private readonly zoneCols: ColorUniform[] = Array.from({ length: 3 }, () => colorUniform());
  private readonly pattern = uniform(0);
  private readonly axis = uniform(new THREE.Vector4(1, 0, 0, 0));
  private readonly at = uniform(0.5);
  private readonly width = uniform(0.2);
  private readonly line = uniform(0);
  private readonly palette = uniform(3);
  private readonly zoneOn = uniform(new THREE.Vector3());
  private readonly raw = uniform(0);

  constructor(livery: BikeLivery) {
    this.material.name = 'frame';
    this.material.colorNode = this.colorNode();
    this.material.clearcoatRoughness = 0.05;
    this.set(livery);
  }

  set(liv: BikeLivery): void {
    const c = liv.colors.length ? liv.colors : ['#808080'];
    const main = [0, 1, 2].map((i) => c[Math.min(i, c.length - 1)] as string);
    const pal = [...main, ...(liv.extra ?? [])];
    for (let i = 0; i < 5; i++) (this.cols[i] as ColorUniform).set(pal[Math.min(i, pal.length - 1)] as string);
    this.palette.value = liv.pattern === 'blocks' ? pal.length : 3;
    this.pattern.value = Math.max(PATTERNS.indexOf(liv.pattern), 0);
    this.axis.value.set(...AXES[liv.axis ?? 'z']);
    this.at.value = liv.at ?? 0.5;
    this.width.value = liv.width ?? 0.2;
    this.line.value = liv.line ? 1 : 0;
    const zones = liv.zones ?? {};
    (['rear', 'fork', 'head'] as const).forEach((z, i) => {
      const ci = zones[z];
      if (ci !== undefined) (this.zoneCols[i] as ColorUniform).set(c[Math.min(ci, c.length - 1)] as string);
      this.zoneOn.value.setComponent(i, ci !== undefined ? 1 : 0);
    });
    const finish = liv.finish ?? 'gloss';
    this.raw.value = finish === 'raw' ? 1 : 0;
    const [rough, metal, coat, film] = FINISH[finish];
    const m = this.material;
    m.roughness = rough;
    m.metalness = metal;
    m.clearcoat = coat;
    m.iridescence = film > 0 ? 1 : 0;
    m.iridescenceThicknessRange = [film, film];
    m.needsUpdate = true;
  }

  dispose(): void {
    this.material.dispose();
  }

  private colorNode(): Vec3Node {
    const p = positionGeometry;
    const cx = p.x;
    const cy = p.y;
    const cz = p.z;
    const [c0, c1, c2, e0, e1] = this.cols.map((u) => u.node as unknown as Vec3Node) as [Vec3Node, Vec3Node, Vec3Node, Vec3Node, Vec3Node];
    // Abscisse du motif (0–1) le long de l'axe choisi.
    const uz = clamp(cz.add(0.45).div(1.1), 0, 1);
    const uy = clamp(cy.sub(0.25).div(0.75), 0, 1);
    const ux = clamp(cx.mul(5).add(0.5), 0, 1);
    const a = this.axis;
    const v = uz.mul(a.x).add(uy.mul(a.y)).add(float(1).sub(uy).mul(a.z)).add(ux.mul(a.w));
    const at = this.at;
    const half = this.width.mul(0.5);
    const dv = abs(v.sub(at));
    const inband = lt(dv, half);
    const sLoc = clamp(v.sub(at.sub(half)).div(max(this.width, 1e-4)), 0, 1);

    const solid = c0;
    const fade = mix(c0, c1, smoothstep(at.sub(half), at.add(half), v));
    const split = mix(mix(c0, c1, gt(v, at)), c2, lt(dv, 0.012).mul(this.line));
    const band = mix(mix(c0, c1, inband), c2, lt(abs(dv.sub(half)), 0.008).mul(this.line));
    const stripes = mix(c0, ramp(sLoc, [c1, c2, c1]), inband);
    const rainbow = mix(c0, ramp(sLoc, RAINBOW.map((h) => color(h) as unknown as Vec3Node)), inband);
    const checker = mix(c0, mix(c1, c2, mod(floor(cz.div(0.02)).add(floor(cy.div(0.02))), 2)), inband);
    // Blocs : une couleur tirée au hasard par case de 9 cm, joints sombres.
    const bz = cz.div(0.09);
    const by = cy.div(0.09);
    const seed = floor(bz).add(512).mul(1024).add(floor(by).add(512));
    const joint = max(gt(abs(fract(bz).sub(0.5)), 0.45), gt(abs(fract(by).sub(0.5)), 0.45));
    const blocks = mix(ramp(hash(seed), [c0, c1, c2, e0, e1], this.palette), color('#111111'), joint);
    const dots = mix(c0, c1, lt(length(vec2(fract(cz.div(0.04)).sub(0.5), fract(cy.div(0.04)).sub(0.5))), 0.3));

    const byPattern = [solid, fade, split, band, stripes, rainbow, checker, blocks, dots];
    let col = byPattern[byPattern.length - 1] as Vec3Node;
    for (let i = byPattern.length - 2; i >= 0; i--) col = select(this.pattern.lessThan(i + 0.5), byPattern[i] as Vec3Node, col);

    // Zones repeintes (arrière, fourche, douille).
    const zone = attribute<'vec4'>('color', 'vec4');
    const on = this.zoneOn;
    col = mix(col, (this.zoneCols[0] as ColorUniform).node as unknown as Vec3Node, gt(zone.y, 0.5).mul(on.x));
    col = mix(col, (this.zoneCols[1] as ColorUniform).node as unknown as Vec3Node, gt(zone.z, 0.5).mul(on.y));
    col = mix(col, (this.zoneCols[2] as ColorUniform).node as unknown as Vec3Node, gt(zone.w, 0.5).mul(on.z));

    // Carbone brut : damier très fin, à peine teinté par la livrée.
    const weave = mod(floor(cx.mul(300)).add(floor(cy.mul(300))).add(floor(cz.mul(300))), 2);
    const carbon = mix(mix(color('#16171a'), color('#2a2b30'), weave), col, 0.12);
    return mix(col, carbon, this.raw);
  }
}
