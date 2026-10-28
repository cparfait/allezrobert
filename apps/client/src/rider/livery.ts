import * as THREE from 'three/webgpu';
import { abs, attribute, clamp, color, dot, float, floor, fract, hash, length, max, min, mix, mod, normalGeometry, positionGeometry, select, sin, smoothstep, texture, time, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { BikeLivery, LiveryAxis, LiveryFinish, LiveryPattern } from '@allezrobert/shared';
import { colorUniform, type ColorUniform } from '../engine/tsl.ts';
import { DECALS, type DecalBox } from './wordmarks.ts';

/**
 * Peinture des cadres du catalogue (bikes.json) : même convention que livery_material de
 * tools/blender/bike_families.py (aperçus Blender). Le motif est calculé dans le repère du
 * maillage du cadre (+x gauche, +y haut, +z avant) ; l'attribut de sommet « zone » (COLOR_0 :
 * R avant, G arrière, B fourche, A douille) permet de repeindre une partie du cadre.
 *
 * Tous les paramètres sont des uniformes : un seul programme pour toutes les livrées d'une même
 * finition, et changer de vélo ne recompile rien.
 */

const PATTERNS: readonly LiveryPattern[] = ['solid', 'fade', 'split', 'band', 'stripes', 'rainbow', 'checker', 'blocks', 'dots', 'stops', 'crystal', 'chroma'];
/** Plages du motif « stops » (au plus). */
const MAX_STOPS = 6;
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
  chroma: [0.1, 0.82, 1, 380],
};

type FloatNode = THREE.Node<'float'>;
/** Texture vide (aucun décor). */
const BLANK = new THREE.DataTexture(new Uint8Array(4), 1, 1);
BLANK.needsUpdate = true;
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
  /** Motif « stops » : fin de chaque plage le long de l'axe, et sa couleur. */
  private readonly stopTo = Array.from({ length: MAX_STOPS }, () => uniform(2));
  private readonly stopCols: ColorUniform[] = Array.from({ length: MAX_STOPS }, () => colorUniform());
  /** Inscriptions : boîte de projection, présence, couleur imposée ou automatique, par emplacement. */
  private readonly decalM = DECALS.map(() => uniform(new THREE.Matrix4()));
  private readonly decalOn = DECALS.map(() => uniform(0));
  private readonly decalCol: ColorUniform[] = DECALS.map(() => colorUniform('#ffffff'));
  private readonly decalAuto = DECALS.map(() => uniform(1));
  /** Échantillonnages de la texture des inscriptions (un par boîte), mis à jour par setDecals. */
  private readonly logoTaps: Array<{ value: THREE.Texture }> = [];
  /** Épaisseur du film irisé (nm) et miroitement animé (0–1). */
  private readonly film = uniform(0);
  private readonly shimmer = uniform(0);

  constructor(livery: BikeLivery) {
    this.material.name = 'frame';
    this.material.colorNode = this.colorNode();
    this.material.clearcoatRoughness = 0.05;
    // Film irisé : épaisseur qui ondule doucement le long du cadre (miroitement), sans recompiler.
    const wave = sin(time.mul(0.9).add(positionGeometry.z.mul(9)).add(positionGeometry.y.mul(5)));
    this.material.iridescenceThicknessNode = this.film.mul(float(1).add(wave.mul(0.22).mul(this.shimmer)));
    this.set(livery);
  }

  /** Surbrillance de l'atelier (0–1) : lueur dorée passagère. */
  highlight(amount: number): void {
    this.material.emissive.setRGB(1, 0.82, 0.25).multiplyScalar(0.55 * amount);
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
    const stops = (liv.stops ?? []).slice(0, MAX_STOPS);
    // « stops » : fin de chaque plage (la dernière va jusqu'au bout) ; « chroma » : position de chaque repère.
    const keys = liv.pattern === 'chroma';
    for (let i = 0; i < MAX_STOPS; i++) {
      const st = stops[i] ?? stops[stops.length - 1];
      (this.stopTo[i] as { value: number }).value = i < stops.length - (keys ? 0 : 1) ? (stops[i]?.to ?? 2) : 2 + i;
      (this.stopCols[i] as ColorUniform).set(st?.color ?? c[0] ?? '#808080');
    }
    const finish = liv.finish ?? 'gloss';
    this.raw.value = finish === 'raw' ? 1 : 0;
    const [rough, metal, coat, film] = FINISH[finish];
    const m = this.material;
    m.roughness = rough;
    m.metalness = metal;
    m.clearcoat = coat;
    m.iridescence = film > 0 ? 1 : 0;
    m.iridescenceThicknessRange = [film, film];
    this.film.value = film;
    this.shimmer.value = finish === 'iridescent' || finish === 'chroma' ? 1 : 0;
    m.needsUpdate = true;
  }

  /**
   * Inscriptions du vélo : texture (lignes dans l'ordre de DECALS), boîtes de la famille, et par
   * emplacement la présence d'un texte et sa couleur (absente : contraste automatique avec la
   * peinture). Sans texture : aucune inscription.
   */
  setDecals(map: THREE.Texture | null, boxes: readonly (DecalBox | null)[], marks: readonly ({ color?: string } | null)[]): void {
    for (const t of this.logoTaps) t.value = map ?? BLANK;
    DECALS.forEach((_, i) => {
      const b = boxes[i];
      const m = marks[i];
      if (b) (this.decalM[i] as { value: THREE.Matrix4 }).value.copy(b.inverse);
      (this.decalOn[i] as { value: number }).value = map && b && m ? 1 : 0;
      (this.decalAuto[i] as { value: number }).value = m?.color ? 0 : 1;
      if (m?.color) (this.decalCol[i] as ColorUniform).set(m.color);
    });
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

    // Plages franches le long de l'axe (la dernière va jusqu'au bout).
    let stops = (this.stopCols[MAX_STOPS - 1] as ColorUniform).node as unknown as Vec3Node;
    for (let i = MAX_STOPS - 2; i >= 0; i--) stops = select(v.lessThan(this.stopTo[i] as FloatNode), (this.stopCols[i] as ColorUniform).node as unknown as Vec3Node, stops);

    // Cristaux : facettes triangulaires de ~4 cm, teintes tirées au hasard, arêtes claires.
    const ta = cz.mul(24).add(cy.mul(12));
    const tb = cy.mul(20.8);
    const fa = fract(ta);
    const fb = fract(tb);
    const upper = gt(fa.add(fb), 1);
    const facet = hash(floor(ta).add(512).mul(977).add(floor(tb).add(512).mul(31)).add(upper.mul(7)));
    const edge = lt(min(min(fa, fb), abs(float(1).sub(fa).sub(fb))), 0.035);
    const crystal = mix(mix(c0, mix(c1, c2, gt(facet, 0.82)), gt(facet, 0.5)), color('#ffffff') as unknown as Vec3Node, edge.mul(0.6));

    // Chroma : dégradé fondu entre les repères, en hauteur ; bases (bas du cadre) dorées aux deux bouts seulement,
    // haut du mât de selle (derrière le nœud) ramené vers le milieu du dégradé.
    const zoneAttr = attribute<'vec4'>('color', 'vec4');
    const cyN = clamp(cy.sub(0.27).div(0.55), 0, 1);
    const ends = min(abs(cz), abs(cz.add(0.41)));
    const stays = gt(zoneAttr.y, 0.5).mul(lt(cy, 0.4));
    const hv = max(cyN, smoothstep(0.03, 0.16, ends).mul(0.78).mul(stays));
    const mast = smoothstep(0.7, 0.8, cy).mul(lt(cz, -0.09));
    const cv = mix(hv, float(0.2), mast);
    let chroma = (this.stopCols[0] as ColorUniform).node as unknown as Vec3Node;
    for (let i = 1; i < MAX_STOPS; i++) chroma = mix(chroma, (this.stopCols[i] as ColorUniform).node as unknown as Vec3Node, smoothstep(this.stopTo[i - 1] as FloatNode, this.stopTo[i] as FloatNode, cv));

    const byPattern = [solid, fade, split, band, stripes, rainbow, checker, blocks, dots, stops, crystal, chroma];
    let col = byPattern[byPattern.length - 1] as Vec3Node;
    for (let i = byPattern.length - 2; i >= 0; i--) col = select(this.pattern.lessThan(i + 0.5), byPattern[i] as Vec3Node, col);

    // Zones repeintes (arrière, fourche, douille).
    const zone = attribute<'vec4'>('color', 'vec4');
    const on = this.zoneOn;
    col = mix(col, (this.zoneCols[0] as ColorUniform).node as unknown as Vec3Node, gt(zone.y, 0.5).mul(on.x));
    col = mix(col, (this.zoneCols[1] as ColorUniform).node as unknown as Vec3Node, gt(zone.z, 0.5).mul(on.y));
    col = mix(col, (this.zoneCols[2] as ColorUniform).node as unknown as Vec3Node, gt(zone.w, 0.5).mul(on.z));

    // Mots-symboles projetés de part et d'autre des tubes (lisibles des deux côtés), seulement sur
    // les faces tournées vers le côté (pas de traînées sur le dessus des tubes).
    // Faces tournées vers l'extérieur seulement (pas l'intérieur de la base ou du hauban d'en face).
    const nx = normalGeometry.x;
    const side = smoothstep(0.12, 0.32, abs(nx)).mul(select(cx.mul(nx).greaterThan(-1e-4), float(1), float(0)));
    const luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    const auto = select(luma.greaterThan(0.25), color('#111214'), color('#f4f4f2')) as unknown as Vec3Node;
    this.decalM.forEach((m, i) => {
      const q = m.mul(vec4(p, 1)).xyz;
      const inside = lt(max(max(abs(q.x), abs(q.y)), abs(q.z)), 0.5);
      const u0 = q.y.add(0.5);
      const u = select(nx.greaterThan(0), float(1).sub(u0), u0);
      const v = float(1).sub(float(i + 1).sub(float(0.5).sub(q.z)).div(DECALS.length));
      const tap = texture(BLANK, vec2(u, v));
      this.logoTaps.push(tap as unknown as { value: THREE.Texture });
      const ink = clamp(tap.a.mul(inside).mul(this.decalOn[i] as unknown as FloatNode).mul(side), 0, 1);
      const inkCol = mix((this.decalCol[i] as ColorUniform).node as unknown as Vec3Node, auto, this.decalAuto[i] as unknown as FloatNode);
      col = mix(col, inkCol, ink);
    });

    // Carbone brut : damier très fin, à peine teinté par la livrée.
    const weave = mod(floor(cx.mul(300)).add(floor(cy.mul(300))).add(floor(cz.mul(300))), 2);
    const carbon = mix(mix(color('#16171a'), color('#2a2b30'), weave), col, 0.12);
    return mix(col, carbon, this.raw);
  }
}
