import * as THREE from 'three/webgpu';
import { LOW_POLY } from '../engine/style.ts';
import { float, mx_noise_float, positionWorld, smoothstep, uniform, varying, vec2 } from 'three/tsl';

/**
 * Ombres des nuages qui défilent sur le paysage (esprit « ciels immenses » du plateau de Saclay) :
 * un champ de bruit à l'échelle des cumulus (≈ 700 m), entraîné par le vent, assombrit le sol là où un
 * nuage passe devant le soleil. Uniformes partagés par tous les matériaux du sol, mis à jour par
 * Environment ; rien à dessiner en plus (deux bruits par sommet).
 */
export const clouds = {
  /** Couverture nuageuse (0–1). */
  coverage: uniform(0.2),
  /** Décalage du champ (m), cumulé selon le vent des nuages. */
  offset: uniform(new THREE.Vector2(0, 0)),
  /** Force des ombres (0 : pas de soleil, ou ciel uniformément couvert). */
  strength: uniform(0),
};

/** ?clouds=0 : sans ombres de nuages (comparaison). */
const CLOUD_SHADOWS = !LOW_POLY && (typeof location === 'undefined' || new URLSearchParams(location.search).get('clouds') !== '0');

/**
 * Multiplicateur de la couleur du sol (≈ 0,55 sous un nuage, 1 au soleil), calculé aux sommets : à
 * l'échelle d'un nuage (centaines de mètres) l'interpolation suffit, et rien n'est calculé par pixel.
 */
export function cloudShade(): THREE.Node<'float'> {
  if (!CLOUD_SHADOWS) return float(1) as unknown as THREE.Node<'float'>;
  const p = positionWorld.xz.add(clouds.offset);
  const n = mx_noise_float(p.div(700)).mul(0.65).add(mx_noise_float(p.div(260).add(vec2(17.3, 4.1))).mul(0.35));
  // Plus de ciel couvert : le seuil descend, les nuages s'étendent.
  const threshold = float(0.55).sub(clouds.coverage.mul(1.1));
  const shadow = smoothstep(threshold, threshold.add(0.22), n);
  return varying(float(1).sub(shadow.mul(clouds.strength).mul(0.45))) as unknown as THREE.Node<'float'>;
}

/**
 * Avance le champ de nuages (vent en altitude ≈ 2,5 fois le vent au sol, au moins une brise) et règle la
 * force des ombres : nettes par ciel de traîne, absentes sous un ciel bleu ou entièrement gris.
 */
export function stepClouds(dt: number, coverage: number, sunUp: number, windMs: number, windFrom: number): void {
  const speed = Math.max(4, windMs * 2.5);
  const o = clouds.offset.value as THREE.Vector2;
  // Le champ suit le vent : il souffle vers (−sin, cos) de sa direction d'origine (repère x est, z sud).
  o.x -= -Math.sin(windFrom) * speed * dt;
  o.y -= Math.cos(windFrom) * speed * dt;
  clouds.coverage.value = coverage;
  const broken = Math.max(0, 1 - Math.abs(coverage - 0.5) / 0.4);
  clouds.strength.value = sunUp * Math.min(1, broken * 1.4);
}
