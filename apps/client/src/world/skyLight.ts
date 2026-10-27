import * as THREE from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { mix, normalize, positionLocal, smoothstep } from 'three/tsl';
import { colorUniform } from '../engine/tsl.ts';
import { overcastDome } from './overcast.ts';

/** Côté (px) d'une face de la carte d'environnement : reflets flous de toute façon (rugosité ≥ 0,05), 128 suffit. */
const SIZE = 128;
/** Écart du soleil (rad, ≈ 1,5°) ou de la météo au-delà duquel le ciel est recapturé. */
const SUN_STEP = 0.026;
const WEATHER_STEP = 0.04;

export interface SkyLightInput {
  sky: SkyMesh;
  sunDir: THREE.Vector3;
  clouds: number;
  /** Couleur du sol vu de loin (radiance, linéaire) et de la brume à l'horizon. */
  ground: THREE.Color;
  horizon: THREE.Color;
}

/**
 * Lumière du ciel (éclairage par image) : une copie du ciel du moment, sans disque solaire (le soleil
 * reste la lumière directionnelle, ombres comprises), posée sur un sol couleur paysage, préfiltrée
 * (PMREM) en carte d'environnement de la scène. Vitres, carrosseries, cadres, route mouillée et eau
 * reflètent le vrai ciel ; l'ombre prend la teinte du ciel et du sol au lieu d'un cyan uniforme.
 *
 * Coût : rien par image ; une capture (quelques millisecondes GPU) quand le soleil a bougé de 1,5° ou
 * que la couverture nuageuse a changé, soit quelques fois par heure de sortie. Même cible de rendu à
 * chaque capture : la texture ne change pas d'identité, aucun shader n'est recompilé.
 */
export class SkyLight {
  private readonly envScene = new THREE.Scene();
  private readonly sky = new SkyMesh();
  private readonly ground = colorUniform('#5b5a3a');
  private readonly horizon = colorUniform('#dfe8ef');
  private pmrem: THREE.PMREMGenerator | null = null;
  private target: THREE.RenderTarget | null = null;
  private readonly lastSun = new THREE.Vector3(Number.NaN, 0, 0);
  private lastClouds = Number.NaN;

  constructor() {
    this.sky.scale.setScalar(2000);
    this.sky.showSunDisc.value = 0;
    this.envScene.add(this.sky);
    // Demi-sphère basse : brume à l'horizon, sol en dessous (sans elle, le bas du ciel physique serait la
    // couleur de l'horizon, beaucoup trop claire pour le dessous des carrosseries et des cadres).
    const geo = new THREE.SphereGeometry(500, 32, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, fog: false });
    m.colorNode = mix(this.horizon.node, this.ground.node, smoothstep(0, 0.25, normalize(positionLocal).y.negate()));
    this.envScene.add(new THREE.Mesh(geo, m));
    // Ciel couvert : le même voile gris que le ciel visible.
    this.envScene.add(overcastDome());
  }

  /** Texture d'environnement (null tant que rien n'a été capturé). */
  get texture(): THREE.Texture | null {
    return this.target?.texture ?? null;
  }

  /** Recapture le ciel s'il a changé de façon visible (ou si `force`). Renvoie vrai après une capture. */
  update(renderer: THREE.WebGPURenderer, s: SkyLightInput, force = false): boolean {
    const moved = !Number.isFinite(this.lastSun.x) || this.lastSun.angleTo(s.sunDir) > SUN_STEP || Math.abs(this.lastClouds - s.clouds) > WEATHER_STEP;
    if (!force && !moved) return false;
    this.lastSun.copy(s.sunDir);
    this.lastClouds = s.clouds;
    const src = s.sky;
    const dst = this.sky;
    dst.sunPosition.value.copy(src.sunPosition.value);
    dst.turbidity.value = src.turbidity.value;
    dst.rayleigh.value = src.rayleigh.value;
    dst.mieCoefficient.value = src.mieCoefficient.value;
    dst.mieDirectionalG.value = src.mieDirectionalG.value;
    dst.cloudCoverage.value = src.cloudCoverage.value;
    dst.cloudDensity.value = src.cloudDensity.value;
    this.ground.value.copy(s.ground);
    this.horizon.value.copy(s.horizon);
    this.pmrem ??= new THREE.PMREMGenerator(renderer);
    try {
      this.target = this.pmrem.fromScene(this.envScene, 0, 0.1, 5000, { size: SIZE, ...(this.target ? { renderTarget: this.target } : {}) });
    } catch (e) {
      console.warn('[ciel] carte d’environnement indisponible', e);
      return false;
    }
    return true;
  }

  dispose(): void {
    this.pmrem?.dispose();
    this.target?.dispose();
    this.pmrem = null;
    this.target = null;
  }
}
