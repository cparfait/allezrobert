import { tune } from '../dev/tuning.ts';
import { LOW_POLY } from '../engine/style.ts';
import * as THREE from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { NightSky } from './nightsky.ts';
import { SkyLight } from './skyLight.ts';
import { SceneFog } from './fog.ts';
import { stepClouds } from './clouds.ts';
import { overcastDome, setOvercast } from './overcast.ts';
import { sunlight } from './sunlight.ts';
import { LOW_POLY_SKY, LowPolySky } from './lowPolySky.ts';
import type { QualitySettings } from '../engine/quality.ts';
import { SHADOW_DITHER, stableShadowFilter } from '../engine/stableShadowFilter.ts';
import { mainRenderer, type Grade } from '../engine/renderer.ts';

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

/** Part de la lumière hémisphérique gardée quand le ciel éclaire la scène (carte d'environnement). */
// Rue étroite : une bonne part de ce « ciel » est en fait des façades, qui renvoient une lumière neutre. Mesuré contre
// des photos de la rue Lepic (out/ref-photos, color_stats) : carte du ciel à 0,35 et appoint à 0,3, les ombres de midi
// sortaient franchement bleues (+0,08 de bleu sur les zones sombres, contre −0,01 sur les photos) ; carte du ciel à
// 0,105 et appoint à 0,78 : +0,01.
/** Pas de rotation de la lumière des ombres (rad) : 0,25°, soit environ une minute de course du soleil. */
const SHADOW_DIR_STEP = (0.25 * Math.PI) / 180;
const HEMI_WITH_SKY = LOW_POLY ? 0.3 : 0.78;
/** Intensité de la lumière du ciel (réglée à l'œil : au-delà, les ombres se délavent sous le ciel physique, très lumineux). */
const SKY_LIGHT_INTENSITY = LOW_POLY ? 0.35 : 0.105;
/** Réglages (?reglages) de l'éclairage du jour : lumière du ciel, appoint de l'hémisphère, soleil, balance, saturation. */
const SKY_K = tune('image.ciel', 'Lumière du ciel', 1, 0, 2, 0.02);
const HEMI_K = tune('image.ambiance', "Appoint d'ambiance", 1, 0, 2, 0.02);
const SUN_K = tune('image.soleil', 'Soleil', 1, 0.3, 2, 0.02);
const WARM_K = tune('image.balance', 'Balance des blancs (chaud)', 0, -1, 2, 0.02);
/** Balance des blancs de jour, style réaliste : compense le reste de bleu du ciel (mesuré contre les photos). */
const WARM_DEFAULT = 0.8;
const SAT_K = tune('image.saturation', 'Saturation', 1, 0.5, 1.5, 0.01);
const EXPO_K = tune('image.exposition', 'Exposition', 1, 0.5, 1.6, 0.01);
/** ?skylight=0 : sans carte d'environnement du ciel (comparaison avant / après). */
const SKY_LIGHT = typeof location === 'undefined' || new URLSearchParams(location.search).get('skylight') !== '0';
/** ?mist=0 : brume uniforme d'avant, sans brume de vallée ni teinte vers le soleil (comparaison). */
const VALLEY_MIST = typeof location === 'undefined' || new URLSearchParams(location.search).get('mist') !== '0';
/** Météo vue du ciel : la pluie impose des nuages (au moins 55 %, couvert complet sous l'averse). */
export function rainyWeather(w: Weather): Weather {
  return w.rain > 0.02 ? { ...w, clouds: Math.max(w.clouds, Math.min(1, 0.55 + 0.6 * w.rain)) } : w;
}

/** Brume de vallée du matin selon la saison (automne et hiver plus brumeux). */
const MORNING_MIST: Record<Season, number> = { spring: 0.7, summer: 0.35, autumn: 1, winter: 0.9 };

/**
 * Densité de la brume de vallée (1/m, au fond de vallée) : un voile en journée, les vallées noyées au
 * lever du jour et jusqu'au milieu de matinée (moins par ciel couvert), et le brouillard météo.
 */
export function valleyMist(hour: number, season: Season, weather: Weather): number {
  const morning = THREE.MathUtils.smoothstep(hour, 4.5, 6.5) * (1 - THREE.MathUtils.smoothstep(hour, 8.5, 11.5));
  const evening = THREE.MathUtils.smoothstep(hour, 19, 22) * 0.35;
  const clear = 1 - 0.5 * Math.max(weather.clouds - 0.4, 0) / 0.6;
  return 0.0004 + 0.0035 * Math.max(morning, evening) * MORNING_MIST[season] * clear + 0.004 * weather.fog;
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

/** Teintes fixes de `palette` et de `update` : créées une fois (elles l'étaient à chaque image, une vingtaine). */
const hex = (h: string): THREE.Color => new THREE.Color(h);
const PAL_C = {
  sunGold: new THREE.Color(1, 0.62, 0.32),
  sunWinter: new THREE.Color(0.9, 0.95, 1),
  sky: hex('#9cc3ec'),
  skyHigh: hex('#6f9fdc'),
  skyGold: hex('#ffb98a'),
  skyNight: hex('#0d1a2e'),
  ground: { spring: hex('#6f7f45'), summer: hex('#7a7448'), autumn: hex('#7b5a35'), winter: hex('#6b6b60') } as Record<Season, THREE.Color>,
  fog: { spring: hex('#dfe8ef'), summer: hex('#e8e0cf'), autumn: hex('#d9d2c3'), winter: hex('#c9d1d6') } as Record<Season, THREE.Color>,
  fogHigh: hex('#c4d5e6'),
  fogGold: hex('#f2b483'),
  fogNight: hex('#0b1220'),
  sunOvercast: hex('#c8ccd2'),
  skyOvercast: hex('#a9b2bc'),
  fogOvercast: hex('#b9c0c7'),
  skyOvercastNight: hex('#29405d'),
  fogOvercastNight: hex('#26384e'),
  moon: hex('#9fb4ff'),
  hemiNight: hex('#3b4f7a'),
};
/** Résultat de `palette`, réutilisé d'une image à l'autre : les appelants le lisent sans le modifier. */
const PAL: Palette = { hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), fog: new THREE.Color(), sunColor: new THREE.Color() };
const palSkyOvercast = new THREE.Color();
const palFogOvercast = new THREE.Color();
/** Entrées du dernier calcul : la palette n'est refaite que si l'une d'elles a changé. */
const palKey = { el: Number.NaN, season: '' as Season | '', clouds: Number.NaN, fog: Number.NaN, clarity: Number.NaN };
/** Vecteurs et couleur de travail de `Environment.update`. */
const envMoonDir = new THREE.Vector3();
const envLightDir = new THREE.Vector3();
const envOrigin = new THREE.Vector3();
const envGlow = new THREE.Color();

/** Couleurs de lumière selon l'élévation du soleil et la saison (voir ART_DIRECTION.md). */
function palette(el: number, season: Season, weather: Weather, clarity = 1): Palette {
  if (palKey.el === el && palKey.season === season && palKey.clouds === weather.clouds && palKey.fog === weather.fog && palKey.clarity === clarity) return PAL;
  palKey.el = el;
  palKey.season = season;
  palKey.clouds = weather.clouds;
  palKey.fog = weather.fog;
  palKey.clarity = clarity;
  const day = THREE.MathUtils.smoothstep(el, -0.08, 0.35);
  const golden = 1 - THREE.MathUtils.smoothstep(el, 0.05, 0.4);
  const night = 1 - THREE.MathUtils.smoothstep(el, -0.15, 0.02);
  const sun = PAL.sunColor.setRGB(1, 0.96, 0.9).lerp(PAL_C.sunGold, golden * 0.85);
  if (season === 'winter') sun.lerp(PAL_C.sunWinter, 0.25);
  // En altitude, ciel d'un bleu plus profond (moins d'air au-dessus de soi).
  const sky = PAL.hemiSky
    .copy(PAL_C.sky)
    .lerp(PAL_C.skyHigh, (1 - clarity) * 0.9)
    .lerp(PAL_C.skyGold, golden * 0.45)
    .lerp(PAL_C.skyNight, night);
  PAL.hemiGround.copy(PAL_C.ground[season]).multiplyScalar(0.35 + 0.65 * day);
  // Brume plus bleue et moins laiteuse en altitude.
  const fog = PAL.fog
    .copy(PAL_C.fog[season])
    .lerp(PAL_C.fogHigh, (1 - clarity) * 0.8)
    .lerp(PAL_C.fogGold, golden * 0.35)
    .lerp(PAL_C.fogNight, night * 0.95);
  // Météo couverte : lumière plus grise et plus diffuse.
  const overcast = Math.max(weather.clouds - 0.4, 0) / 0.6;
  sun.lerp(PAL_C.sunOvercast, overcast * 0.6);
  const skyOvercast = palSkyOvercast.copy(PAL_C.skyOvercast).multiplyScalar(0.4 + 0.6 * day);
  const fogOvercast = palFogOvercast.copy(PAL_C.fogOvercast).multiplyScalar(0.3 + 0.7 * day);
  skyOvercast.lerp(PAL_C.skyOvercastNight, night);
  fogOvercast.lerp(PAL_C.fogOvercastNight, night);
  sky.lerp(skyOvercast, overcast * 0.5);
  fog.lerp(fogOvercast, Math.max(overcast, weather.fog) * 0.6);
  return PAL;
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
  /** Reflets et lumière d'ambiance tirés du ciel du moment (carte d'environnement de la scène). */
  private readonly skyLight = new SkyLight();
  private readonly overcastMesh: THREE.Mesh;
  /** Brume de la scène (fond, vallée, teinte vers le soleil) : voir SceneFog. */
  readonly sceneFog = new SceneFog();
  state: EnvironmentState;
  private csm: CSMShadowNode | null = null;
  /** Ombres redessinées une image sur N ; entre deux, cartes d'ombre et caméras de cascade restent figées ensemble. */
  private shadowEvery = 1;
  private shadowTick = 0;
  private shadowWarm = 0;
  private shadowFrozen = false;
  /** Direction de la lumière qui porte les ombres, tournée par pas (voir SHADOW_DIR_STEP). */
  private readonly shadowDir = new THREE.Vector3();
  private shadowDirSet = false;
  private readonly sunDir = new THREE.Vector3();
  private readonly scene: THREE.Scene;
  /** Ciel du style jeu vidéo (lowPolySky.ts) : dôme en dégradé et nuages à facettes. */
  private readonly lowPolySky: LowPolySky | null = null;
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
    // Voile gris des ciels couverts et de pluie, sur le ciel physique (overcast.ts).
    this.overcastMesh = overcastDome();
    scene.add(this.overcastMesh);
    if (LOW_POLY_SKY) {
      // Le ciel physique reste calculé (soleil, nuit) mais n'est plus dessiné.
      this.lowPolySky = new LowPolySky(q.viewDistance);
      this.sky.visible = false;
      scene.add(this.lowPolySky.group);
    }

    this.sun = new THREE.DirectionalLight(0xffffff, 3.2);
    this.sun.castShadow = true;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x5b5a3a, 1.1);
    scene.add(this.hemi);

    this.fog = new THREE.FogExp2(0xdfe8ef, 0.00018);
    scene.fog = this.fog;
    if (VALLEY_MIST) (scene as unknown as { fogNode: THREE.Node | null }).fogNode = this.sceneFog.node;
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
    // Sans TAA, le grain du PCF de three.js reste à l'écran et grésille sous l'ombre du coureur : filtre à angle
    // fixe (stableShadowFilter.ts). Posé sur les ombres des cascades, créées (par clonage) à la première compilation.
    if (!q.taa && !SHADOW_DITHER) {
      const csmInit = this.csm as unknown as { _init: (builder: unknown) => void; lights: Array<{ shadow: { filterNode?: unknown } }> };
      const init = csmInit._init.bind(csmInit);
      csmInit._init = (builder) => {
        init(builder);
        for (const l of csmInit.lights) l.shadow.filterNode = stableShadowFilter;
      };
    }
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
    const { hour, season } = this.state;
    // Pas de pluie sous un ciel bleu : la pluie couvre le ciel (et la lumière) en proportion.
    const weather = rainyWeather(this.state.weather);
    sunDirection(hour, season, this.sunDir);
    const el = Math.asin(this.sunDir.y);
    // Altitude du point suivi, lissée (quelques secondes) pour éviter tout saut de brume.
    if (focus && Number.isFinite(focus.y)) this.altitudeM = Number.isFinite(this.altitudeM) ? this.altitudeM + (focus.y - this.altitudeM) * Math.min(1, _dt * 0.5) : focus.y;
    const clarity = altitudeClarity(Number.isFinite(this.altitudeM) ? this.altitudeM : 0);
    const pal = palette(el, season, weather, clarity);
    // Voile couvert réglé avant la capture du ciel (SkyLight), qui le reprend.
    setOvercast(weather.clouds, THREE.MathUtils.smoothstep(this.sunDir.y, -0.1, 0.3));

    this.sky.sunPosition.value.copy(this.sunDir);
    this.sky.cloudCoverage.value = 0.15 + weather.clouds * 0.75;
    this.sky.cloudDensity.value = 0.25 + weather.clouds * 0.6;
    // Ciel moins trouble (plus profond) en altitude.
    this.sky.turbidity.value = 1.6 + 0.9 * clarity + weather.fog * 6 + weather.clouds * 3;
    this.sky.mieCoefficient.value = 0.004 * (0.5 + 0.5 * clarity);

    // Le soleil passe sous l'horizon : la lune prend le relais (lumière froide et faible).
    const isNight = this.sunDir.y < -0.02;
    // Passage soleil → lune progressif (pas de saut de direction ni d'intensité au coucher : l'ombre ne « saute » plus).
    const moonK = 1 - THREE.MathUtils.smoothstep(this.sunDir.y, -0.08, 0.04);
    const moonDir = envMoonDir.set(-this.sunDir.x, 0.6, -this.sunDir.z).normalize();
    const lightDir = envLightDir.copy(this.sunDir).lerp(moonDir, moonK).normalize();
    // Soleil rasant : les ombres de la carte d'ombres grésillent (acné, plis qui bougent) ; la direction de la lumière
    // qui les porte ne descend jamais sous ~8° au-dessus de l'horizon.
    if (lightDir.y < 0.14) {
      const h = Math.hypot(lightDir.x, lightDir.z) || 1;
      const k = Math.sqrt(1 - 0.14 * 0.14) / h;
      lightDir.set(lightDir.x * k, 0.14, lightDir.z * k);
    }
    // L'heure avance pendant la sortie : la direction était reprise 4 fois par seconde. Chaque reprise fait tourner
    // la grille des cartes d'ombre autour de l'origine du monde ; à 8,6 km de l'origine (Boulogne), elle glissait
    // de 20 cm (~2 texels) au niveau du coureur et toutes les ombres étaient redessinées un peu ailleurs : rien ne
    // restait fixe (19/11/2026). La lumière des ombres ne tourne plus que par pas (~1 min de soleil) ; le ciel suit
    // l'heure en continu.
    if (!this.shadowDirSet || this.shadowDir.angleTo(lightDir) > SHADOW_DIR_STEP) {
      this.shadowDir.copy(lightDir);
      this.shadowDirSet = true;
    }
    const center = focus ?? envOrigin.set(0, 0, 0);
    this.sun.position.copy(center).addScaledVector(this.shadowDir, 400);
    this.sun.target.position.copy(center);
    const sunStrength = THREE.MathUtils.smoothstep(this.sunDir.y, -0.05, 0.25);
    const overcast = Math.max(weather.clouds - 0.3, 0) / 0.7;
    // Ciel plombé : le soleil n'est plus qu'une lueur diffuse (pas de reflet vif sur la route mouillée).
    // Soleil un quart plus fort qu'avant la mesure contre les photos (contraste lumière / ombre, voir HEMI_WITH_SKY).
    const dayIntensity = (LOW_POLY ? 0.4 + 3.0 * sunStrength : 0.5 + 3.75 * sunStrength) * (1 - 0.88 * overcast);
    this.sun.intensity = THREE.MathUtils.lerp(dayIntensity * SUN_K.value, 0.12, moonK);
    this.sun.color.copy(pal.sunColor).lerp(PAL_C.moon, moonK);
    this.hemi.color.copy(pal.hemiSky);
    this.hemi.groundColor.copy(pal.hemiGround);
    const nightK = 1 - THREE.MathUtils.smoothstep(this.sunDir.y, -0.18, 0.02);
    this.nightSky.night.value = nightK;
    // Nuit : clair de lune bleuté (lisibilité de la route), jamais le noir complet.
    const ambient = 0.25 + 1.1 * THREE.MathUtils.smoothstep(this.sunDir.y, -0.2, 0.3)
      + overcast * (0.5 - 0.3 * nightK);
    const renderer = mainRenderer();
    // Avec la carte d'environnement, le ciel éclaire déjà les ombres : l'hémisphère ne garde qu'un appoint.
    if (renderer && SKY_LIGHT) this.updateSkyLight(renderer, pal);
    this.hemi.intensity = ambient * (this.scene.environment ? HEMI_WITH_SKY : 1) * HEMI_K.value + nightK * 0.35;
    // Ciel couvert : la carte du ciel est grise, plus bleue ; elle retrouve son intensité d'avant (ombres moins noires sous la pluie).
    if (this.scene.environment) this.scene.environmentIntensity = SKY_LIGHT_INTENSITY * (LOW_POLY ? 1 : 1 + overcast * 2.3 * (1 - nightK)) * SKY_K.value;
    if (nightK > 0) this.hemi.color.lerp(PAL_C.hemiNight, nightK * 0.8);
    this.lowPolySky?.update(_dt, center, pal.hemiSky, pal.fog, this.sunDir, this.sun.color, sunStrength, weather.clouds, weather.windMs, weather.windFrom);
    this.fog.color.copy(pal.fog);
    this.fog.density = 0.00012 * clarity + weather.fog * 0.0022 + weather.rain * 0.0004;
    // Ombres des nuages sur le sol : défilent avec le vent, seulement quand le soleil perce.
    stepClouds(_dt, weather.clouds, THREE.MathUtils.smoothstep(this.sunDir.y, 0.02, 0.15), weather.windMs, weather.windFrom);
    // Soleil pour le contre-jour du feuillage (sunlight.ts) : seulement s'il perce.
    sunlight.dir.value.copy(this.sunDir);
    sunlight.color.value.copy(this.sun.color);
    sunlight.backlight.value = isNight ? 0 : 0.55 * THREE.MathUtils.smoothstep(this.sunDir.y, 0.0, 0.12) * (1 - overcast);
    sunlight.castDir.value.copy(this.shadowDir);
    sunlight.sunShare.value = 1 - moonK;
    const f = this.sceneFog;
    f.color.value.copy(pal.fog);
    f.density.value = this.fog.density;
    f.mist.value = valleyMist(hour, season, weather);
    f.sunDir.value.copy(this.sunDir);
    // Vers le soleil (seulement s'il est levé, moins sous un ciel couvert) : brume dorée du contre-jour.
    const glow = THREE.MathUtils.smoothstep(this.sunDir.y, -0.04, 0.12) * (1 - 0.8 * overcast) * 0.75;
    f.sunColor.value.copy(pal.fog).lerp(envGlow.copy(this.sun.color).multiplyScalar(1.2), glow);
  }

  /** Fond de vallée (m) : la brume de vallée y a sa densité nominale (voir SceneFog). */
  setMistBase(altitudeM: number): void {
    this.sceneFog.mistBase.value = altitudeM;
  }

  /** Recapture le ciel quand il a changé (voir SkyLight) ; la première capture pose la carte d'environnement. */
  private updateSkyLight(renderer: THREE.WebGPURenderer, pal: Palette): void {
    // Sol vu de loin : teinte de la saison éclairée par le soleil et le ciel (radiance, pas albédo).
    const lit = 0.25 + 0.2 * this.sun.intensity;
    const ground = pal.hemiGround.clone().multiplyScalar(lit);
    if (!this.skyLight.update(renderer, { sky: this.sky, sunDir: this.sunDir, clouds: rainyWeather(this.state.weather).clouds, ground, horizon: pal.fog })) return;
    if (!this.scene.environment && this.skyLight.texture) {
      this.scene.environment = this.skyLight.texture;
      this.scene.environmentIntensity = SKY_LIGHT_INTENSITY;
    }
  }

  /** Étalonnage conseillé selon saison, heure et météo (voir ART_DIRECTION.md). */
  grade(out: Grade): void {
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
    out.saturation = (sat - night * 0.25) * (1 - weather.rain * (LOW_POLY ? 0.22 : 0.32) - weather.fog * 0.15) * SAT_K.value;
    out.vibrance = vib * (1 - night);
    // Balance des blancs (réglage) : de jour seulement, la nuit garde son bleu.
    const warm = ((LOW_POLY ? 0 : WARM_DEFAULT) + WARM_K.value) * (1 - night);
    out.tint.setRGB(r + golden * 0.06 - night * 0.08 + warm * 0.04, g - golden * 0.01 - night * 0.04 + warm * 0.01, 1 - golden * 0.08 + night * 0.1 + (season === 'winter' ? 0.03 : 0) - warm * 0.07);
    // Virage : ombres fraîches (ciel) et lumières chaudes (soleil), plus marqué à l'heure dorée, neutre sous la pluie.
    const split = (0.035 + golden * 0.045) * (1 - night) * (1 - weather.rain * 0.8) * (season === 'winter' ? 0.6 : 1);
    out.shadows.setRGB(1 - split * 0.8, 1 - split * 0.15, 1 + split);
    out.highlights.setRGB(1 + split, 1 + split * 0.25, 1 - split * 0.9);
    // Vignettage plus présent la nuit et dans le brouillard (ambiance), discret en plein jour.
    out.vignette = 0.14 + night * 0.12 + weather.fog * 0.06;
  }

  /** Exposition conseillée pour le tone mapping (plus forte la nuit pour rester lisible). */
  exposure(): number {
    const el = this.sunDir.y;
    // Continue au coucher (l'ancien saut de 1,35 à 1,6 à l'horizon faisait « pomper » l'image et scintiller le lointain).
    const nightLift = 0.08;
    return (1.0 + 0.35 * (1 - THREE.MathUtils.smoothstep(el, 0, 0.3)) + nightLift * (1 - THREE.MathUtils.smoothstep(el, -0.12, 0.0))) * EXPO_K.value;
  }

  dispose(): void {
    this.scene.remove(this.sky, this.sun, this.hemi, this.nightSky.mesh, this.overcastMesh);
    if (this.lowPolySky) {
      this.scene.remove(this.lowPolySky.group);
      this.lowPolySky.dispose();
    }
    if (this.scene.environment === this.skyLight.texture) this.scene.environment = null;
    const s = this.scene as unknown as { fogNode: THREE.Node | null };
    if (s.fogNode === this.sceneFog.node) s.fogNode = null;
    this.skyLight.dispose();
    this.csm?.dispose();
  }
}
