import * as THREE from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { NightSky } from './nightsky.ts';
import type { QualitySettings } from '../engine/quality.ts';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export interface Weather {
  /** Couverture nuageuse 0–1. */
  clouds: number;
  /** Pluie 0–1. */
  rain: number;
  /** Brouillard 0–1. */
  fog: number;
  /** Vent : vitesse (m/s) et direction d'où il vient (radians, 0 = nord). */
  windMs: number;
  windFrom: number;
}

export interface EnvironmentState {
  /** Heure locale décimale (0–24). */
  hour: number;
  season: Season;
  weather: Weather;
}

/** Date représentative par saison (jour de l'année) pour la course du soleil. */
const SEASON_DAY: Record<Season, number> = { spring: 110, summer: 180, autumn: 290, winter: 355 };
const LATITUDE = 48.7 * (Math.PI / 180);

/** Position du soleil (élévation, azimut) pour la latitude de Chevreuse. */
export function sunDirection(hour: number, season: Season, out = new THREE.Vector3()): THREE.Vector3 {
  const day = SEASON_DAY[season];
  const decl = -23.44 * (Math.PI / 180) * Math.cos(((2 * Math.PI) / 365) * (day + 10));
  // Heure solaire ≈ heure locale − 1,5 h en été / − 0,9 h en hiver (France, longitude 2°E).
  const solar = hour - (season === 'summer' || season === 'spring' ? 1.9 : 0.9);
  const ha = ((solar - 12) / 12) * Math.PI;
  const sinEl = Math.sin(LATITUDE) * Math.sin(decl) + Math.cos(LATITUDE) * Math.cos(decl) * Math.cos(ha);
  const el = Math.asin(sinEl);
  const cosAz = (Math.sin(decl) - Math.sin(el) * Math.sin(LATITUDE)) / (Math.cos(el) * Math.cos(LATITUDE));
  let az = Math.acos(Math.min(Math.max(cosAz, -1), 1));
  if (ha > 0) az = 2 * Math.PI - az;
  // Repère : x est, z sud, y haut ; azimut depuis le nord dans le sens horaire.
  out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  return out;
}

interface Palette {
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  fog: THREE.Color;
  sunColor: THREE.Color;
}

/**
 * Air plus pur en altitude : facteur (0–1] appliqué à la brume de fond et au trouble du ciel,
 * 1 jusqu'à 400 m (plaines), ≈ 0,6 à 1 500 m, ≈ 0,4 à 2 400 m. La brume météo n'en dépend pas.
 */
export function altitudeClarity(altitudeM: number): number {
  return Math.exp(-Math.max(0, altitudeM - 400) / 2200);
}

/** Couleurs de lumière selon l'élévation du soleil et la saison (voir ART_DIRECTION.md). */
function palette(el: number, season: Season, weather: Weather, clarity = 1): Palette {
  const day = THREE.MathUtils.smoothstep(el, -0.08, 0.35);
  const golden = 1 - THREE.MathUtils.smoothstep(el, 0.05, 0.4);
  const night = 1 - THREE.MathUtils.smoothstep(el, -0.15, 0.02);
  const sun = new THREE.Color().setRGB(1, 0.96, 0.9).lerp(new THREE.Color(1, 0.62, 0.32), golden * 0.85);
  if (season === 'winter') sun.lerp(new THREE.Color(0.9, 0.95, 1), 0.25);
  // En altitude, ciel d'un bleu plus profond (moins d'air au-dessus de soi).
  const sky = new THREE.Color('#9cc3ec')
    .lerp(new THREE.Color('#6f9fdc'), (1 - clarity) * 0.9)
    .lerp(new THREE.Color('#ffb98a'), golden * 0.45)
    .lerp(new THREE.Color('#0d1a2e'), night);
  const groundTint: Record<Season, string> = { spring: '#6f7f45', summer: '#7a7448', autumn: '#7b5a35', winter: '#6b6b60' };
  const ground = new THREE.Color(groundTint[season]).multiplyScalar(0.35 + 0.65 * day);
  const fogBase: Record<Season, string> = { spring: '#dfe8ef', summer: '#e8e0cf', autumn: '#d9d2c3', winter: '#c9d1d6' };
  // Brume plus bleue et moins laiteuse en altitude.
  const fog = new THREE.Color(fogBase[season])
    .lerp(new THREE.Color('#c4d5e6'), (1 - clarity) * 0.8)
    .lerp(new THREE.Color('#f2b483'), golden * 0.35)
    .lerp(new THREE.Color('#0b1220'), night * 0.95);
  // Météo couverte : lumière plus grise et plus diffuse.
  const overcast = Math.max(weather.clouds - 0.4, 0) / 0.6;
  sun.lerp(new THREE.Color('#c8ccd2'), overcast * 0.6);
  sky.lerp(new THREE.Color('#a9b2bc').multiplyScalar(0.4 + 0.6 * day), overcast * 0.5);
  fog.lerp(new THREE.Color('#b9c0c7').multiplyScalar(0.3 + 0.7 * day), Math.max(overcast, weather.fog) * 0.6);
  return { hemiSky: sky, hemiGround: ground, fog, sunColor: sun };
}

/**
 * Ciel physique (SkyMesh avec nuages), soleil avec ombres en cascade (CSM), lumière
 * d'ambiance hémisphérique et brume atmosphérique. Piloté par l'heure, la saison et la météo.
 */
export class Environment {
  readonly sky: SkyMesh;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly fog: THREE.FogExp2;
  readonly nightSky = new NightSky();
  state: EnvironmentState;
  private csm: CSMShadowNode | null = null;
  /** Ombres redessinées une image sur N ; entre deux, cartes d'ombre et caméras de cascade restent figées ensemble. */
  private shadowEvery = 1;
  private shadowTick = 0;
  private shadowWarm = 0;
  private shadowFrozen = false;
  private readonly sunDir = new THREE.Vector3();
  private readonly scene: THREE.Scene;
  /** Altitude lissée du coureur suivi (m), pour la clarté de l'air. */
  private altitudeM = Number.NaN;

  constructor(scene: THREE.Scene, q: QualitySettings, state: EnvironmentState) {
    this.scene = scene;
    this.state = state;
    this.sky = new SkyMesh();
    this.sky.scale.setScalar(450000);
    this.sky.turbidity.value = 3.2;
    this.sky.rayleigh.value = 1.6;
    this.sky.mieCoefficient.value = 0.004;
    this.sky.mieDirectionalG.value = 0.82;
    // dessiné en premier : le relief lointain (horizon.ts) passe par-dessus
    this.sky.renderOrder = -2;
    scene.add(this.sky);
    scene.add(this.nightSky.mesh);

    this.sun = new THREE.DirectionalLight(0xffffff, 3.2);
    this.sun.castShadow = true;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x5b5a3a, 1.1);
    scene.add(this.hemi);

    this.fog = new THREE.FogExp2(0xdfe8ef, 0.00018);
    scene.fog = this.fog;
    this.applyQuality(q);
    this.update(0);
  }

  applyQuality(q: QualitySettings): void {
    this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.04;
    this.csm?.dispose();
    this.csm = new CSMShadowNode(this.sun, { cascades: q.shadowCascades, maxFar: q.shadowFar, mode: 'practical', lightMargin: 120 });
    this.csm.fade = true;
    this.sun.shadow.shadowNode = this.csm;
    this.shadowEvery = Math.max(1, Math.round(q.shadowEvery));
    this.shadowTick = 0;
    this.shadowWarm = 0;
    this.shadowFrozen = false;
    // Image sautée : on ne recalcule pas non plus les caméras des cascades, sinon la carte d'ombre (ancienne)
    // serait lue avec des matrices neuves et les ombres glisseraient d'une image à l'autre.
    const csm = this.csm as unknown as { updateBefore: (frame: unknown) => void };
    const original = csm.updateBefore.bind(csm);
    csm.updateBefore = (frame) => {
      if (!this.shadowFrozen) original(frame);
    };
  }

  /** Décide si les ombres sont redessinées à cette image (voir shadowEvery). */
  private stepShadows(): void {
    if (this.shadowEvery <= 1) {
      if (this.shadowFrozen) this.setShadowFrozen(false);
      return;
    }
    this.shadowWarm++;
    this.shadowTick = (this.shadowTick + 1) % this.shadowEvery;
    // Les premières images sont toujours complètes (cartes d'ombre à créer, cascades à cadrer).
    this.setShadowFrozen(this.shadowWarm > 4 && this.shadowTick !== 0);
  }

  private setShadowFrozen(frozen: boolean): void {
    this.shadowFrozen = frozen;
    for (const l of (this.csm as unknown as { lights: Array<{ shadow: { autoUpdate: boolean } }> } | null)?.lights ?? []) l.shadow.autoUpdate = !frozen;
  }

  /** Avance l'environnement ; `focus` = position du coureur suivi (pour cadrer le soleil). */
  update(_dt: number, focus?: THREE.Vector3): void {
    this.stepShadows();
    const { hour, season, weather } = this.state;
    sunDirection(hour, season, this.sunDir);
    const el = Math.asin(this.sunDir.y);
    // Altitude du point suivi, lissée (quelques secondes) pour éviter tout saut de brume.
    if (focus && Number.isFinite(focus.y)) this.altitudeM = Number.isFinite(this.altitudeM) ? this.altitudeM + (focus.y - this.altitudeM) * Math.min(1, _dt * 0.5) : focus.y;
    const clarity = altitudeClarity(Number.isFinite(this.altitudeM) ? this.altitudeM : 0);
    const pal = palette(el, season, weather, clarity);

    this.sky.sunPosition.value.copy(this.sunDir);
    this.sky.cloudCoverage.value = 0.15 + weather.clouds * 0.75;
    this.sky.cloudDensity.value = 0.25 + weather.clouds * 0.6;
    // Ciel moins trouble (plus profond) en altitude.
    this.sky.turbidity.value = 1.6 + 0.9 * clarity + weather.fog * 6 + weather.clouds * 3;
    this.sky.mieCoefficient.value = 0.004 * (0.5 + 0.5 * clarity);

    // Le soleil passe sous l'horizon : la lune prend le relais (lumière froide et faible).
    const isNight = this.sunDir.y < -0.02;
    const lightDir = isNight ? new THREE.Vector3(-this.sunDir.x, 0.6, -this.sunDir.z).normalize() : this.sunDir;
    const center = focus ?? new THREE.Vector3();
    this.sun.position.copy(center).addScaledVector(lightDir, 400);
    this.sun.target.position.copy(center);
    const sunStrength = THREE.MathUtils.smoothstep(this.sunDir.y, -0.05, 0.25);
    const overcast = Math.max(weather.clouds - 0.3, 0) / 0.7;
    this.sun.intensity = isNight ? 0.12 : (0.4 + 3.0 * sunStrength) * (1 - 0.7 * overcast);
    this.sun.color.copy(isNight ? new THREE.Color('#9fb4ff') : pal.sunColor);
    this.hemi.color.copy(pal.hemiSky);
    this.hemi.groundColor.copy(pal.hemiGround);
    const nightK = 1 - THREE.MathUtils.smoothstep(this.sunDir.y, -0.18, 0.02);
    this.nightSky.night.value = nightK;
    // Nuit : clair de lune bleuté (lisibilité de la route), jamais le noir complet.
    this.hemi.intensity = 0.25 + 1.1 * THREE.MathUtils.smoothstep(this.sunDir.y, -0.2, 0.3) + overcast * 0.5 + nightK * 0.35;
    if (nightK > 0) this.hemi.color.lerp(new THREE.Color('#3b4f7a'), nightK * 0.8);
    this.fog.color.copy(pal.fog);
    this.fog.density = 0.00012 * clarity + weather.fog * 0.0022 + weather.rain * 0.0004;
  }

  /** Étalonnage conseillé selon saison, heure et météo (voir ART_DIRECTION.md). */
  grade(out: { saturation: number; vibrance: number; tint: THREE.Color }): void {
    const { season, weather } = this.state;
    const el = this.sunDir.y;
    const golden = el > 0 ? 1 - THREE.MathUtils.smoothstep(el, 0.05, 0.3) : 0;
    const night = 1 - THREE.MathUtils.smoothstep(el, -0.15, 0.02);
    const base: Record<Season, [number, number, number, number]> = {
      spring: [1.14, 0.2, 0.99, 1.01],
      summer: [1.1, 0.18, 1.0, 1.0],
      autumn: [1.16, 0.22, 1.03, 0.99],
      winter: [0.96, 0.1, 0.97, 1.0],
    };
    const [sat, vib, r, g] = base[season];
    out.saturation = (sat - night * 0.25) * (1 - weather.rain * 0.22 - weather.fog * 0.15);
    out.vibrance = vib * (1 - night);
    out.tint.setRGB(r + golden * 0.06 - night * 0.08, g - golden * 0.01 - night * 0.04, 1 - golden * 0.08 + night * 0.1 + (season === 'winter' ? 0.03 : 0));
  }

  /** Exposition conseillée pour le tone mapping (plus forte la nuit pour rester lisible). */
  exposure(): number {
    const el = this.sunDir.y;
    return el < 0 ? 1.6 : 1.0 + 0.35 * (1 - THREE.MathUtils.smoothstep(el, 0, 0.3));
  }

  dispose(): void {
    this.scene.remove(this.sky, this.sun, this.hemi, this.nightSky.mesh);
    this.csm?.dispose();
  }
}
