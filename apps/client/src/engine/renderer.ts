import * as THREE from 'three/webgpu';
import { pass, mrt, output, emissive, normalView, velocity, vec4, vec3, packNormalToRGB, unpackRGBToNormal, sample, uniform, float, saturation, vibrance } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import type { QualitySettings } from './quality.ts';
import { applyViewport, dynamicResolutionEnabled, getFpsCap, getResolutionCap, RESOLUTION_PIXELS, renderPixelRatio } from './display.ts';
import { DynamicResolution } from './autoQuality.ts';
import { PerfOverlay, perfRequested } from './perf.ts';
import type { Vec4Node } from './tsl.ts';

export interface Engine {
  renderer: THREE.WebGPURenderer;
  pipeline: THREE.RenderPipeline;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  backend: 'webgpu' | 'webgl2';
  /** Exposition globale (étalonnage par saison / heure). */
  exposure: { value: number };
  /** Étalonnage : saturation, vivacité et teinte multiplicative (lumière chaude ou froide). */
  grade: { saturation: number; vibrance: number; tint: THREE.Color };
  /** Préréglage en cours (change à chaque `rebuildPipeline`). */
  quality: QualitySettings;
  /** Résolution dynamique : échelle de rendu courante, ajustée selon le temps d'image. */
  dynamicRes: DynamicResolution;
  /** Recalcule la résolution de rendu (plafond de pixels, format, échelle dynamique). */
  applyResolution(): void;
  rebuildPipeline(q: QualitySettings): void;
  resize(): void;
  render(): void;
  /** Rendu hors boucle d'animation (tests, captures) : avance le compteur d'images des nœuds. */
  renderManual(): void;
}

/**
 * Crée le moteur de rendu : WebGPU par défaut, repli WebGL2 automatique (ou forcé par ?webgl).
 * Chaîne de post-traitement : MRT (couleur, normales, vitesses) → GTAO → bloom → TRAA.
 */
export async function createEngine(canvas: HTMLCanvasElement, q: QualitySettings): Promise<Engine> {
  const forceWebGL = new URLSearchParams(location.search).has('webgl');
  // ?perf=1 : mesures GPU (requêtes d'horodatage) pour le panneau de performance (F3).
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, forceWebGL, powerPreference: 'high-performance', trackTimestamp: perfRequested() });
  await renderer.init();
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, q.viewDistance);

  const exposure = { value: 1 };
  const exposureNode = uniform(1);
  const grade = { saturation: 1.12, vibrance: 0.18, tint: new THREE.Color(1, 1, 1) };
  const satNode = uniform(1.12);
  const vibNode = uniform(0.18);
  const tintNode = uniform(new THREE.Color(1, 1, 1));
  const pipeline = new THREE.RenderPipeline(renderer);
  const dynamicRes = new DynamicResolution();
  const dynEnabled = dynamicResolutionEnabled();
  const fpsCap = getFpsCap();
  let current = q;
  let lastRendered = 0;
  let scenePass: ReturnType<typeof pass> | null = null;
  let scenePassMrt = false;
  const aoNodes = new Map<number, ReturnType<ReturnType<typeof ao>['getTextureNode']>['r']>();
  let bloomNode: ReturnType<typeof bloom> | null = null;
  const variants = new Map<string, Vec4Node>();
  const perf = new PerfOverlay();

  const applyResolution = () => {
    const cssW = canvas.clientWidth || window.innerWidth;
    const cssH = canvas.clientHeight || window.innerHeight;
    const ratio = renderPixelRatio({
      cssW,
      cssH,
      devicePixelRatio: window.devicePixelRatio,
      presetRatio: current.pixelRatio,
      presetMaxPixels: current.maxPixels,
      userMaxPixels: RESOLUTION_PIXELS[getResolutionCap()],
      scale: dynEnabled ? dynamicRes.scale : 1,
    });
    renderer.setPixelRatio(ratio);
  };

  const engine: Engine = {
    renderer,
    pipeline,
    scene,
    camera,
    backend,
    exposure,
    grade,
    get quality() {
      return current;
    },
    dynamicRes,
    applyResolution,
    rebuildPipeline(settings: QualitySettings) {
      // Couper un effet ne change ni la distance de vue ni la résolution : on évite de réallouer
      // toutes les cibles de rendu (setPixelRatio redimensionne tout, même à ratio identique).
      const resChanged = settings.pixelRatio !== current.pixelRatio || settings.maxPixels !== current.maxPixels;
      current = settings;
      if (camera.far !== settings.viewDistance) {
        camera.far = settings.viewDistance;
        camera.updateProjectionMatrix();
      }
      if (resChanged || !scenePass) applyResolution();

      // La passe de scène (et sa disposition MRT) survit aux changements d'effets : couper le bloom,
      // l'AO ou le TAA en cours de sortie ne refait que le post-traitement. Changer la disposition MRT
      // recompilerait les matériaux de toute la scène (plusieurs secondes).
      const needMrt = settings.ao || settings.taa || settings.bloom;
      if (!scenePass || (needMrt && !scenePassMrt)) {
        scenePass = pass(scene, camera);
        scenePassMrt = needMrt;
        aoNodes.clear();
        bloomNode = null;
        variants.clear();
        if (needMrt) {
          scenePass.setMRT(
            mrt({
              output,
              normal: packNormalToRGB(normalView),
              velocity,
              emissive,
            }),
          );
          // Normales sur 8 bits par canal : suffisant pour l'AO et deux fois moins de bande passante.
          const normalTex = scenePass.getTexture('normal');
          normalTex.type = THREE.UnsignedByteType;
        }
      }
      // Un graphe par combinaison d'effets, mémorisé : rallumer ou recouper un effet déjà vu rebascule
      // sur un graphe dont les passes (et leurs shaders) existent déjà. AO et bloom sont partagés.
      const key = `${settings.ao ? settings.aoScale : 0}|${settings.bloom ? 1 : 0}|${settings.taa ? 1 : 0}`;
      let result = variants.get(key);
      if (!result) {
        const sp = scenePass;
        const color = sp.getTextureNode('output');
        // Chaîne d'effets : le type du nœud change à chaque étape (texture → vec4 → TRAA).
        let chain: Vec4Node = color as unknown as Vec4Node;

        if (settings.ao) {
          let aoValue = aoNodes.get(settings.aoScale);
          if (!aoValue) {
            const depth = sp.getTextureNode('depth');
            const normalColor = sp.getTextureNode('normal');
            const normal = sample((uvNode) => unpackRGBToNormal(normalColor.sample(uvNode)));
            const aoPass = ao(depth, normal, camera);
            aoPass.resolutionScale = settings.aoScale;
            aoPass.distanceExponent.value = 1;
            aoPass.radius.value = 0.6;
            aoPass.thickness.value = 1;
            aoValue = aoPass.getTextureNode().r;
            aoNodes.set(settings.aoScale, aoValue);
          }
          // AO atténuée : on garde un monde lumineux (direction artistique).
          chain = vec4(color.rgb.mul(aoValue.mul(0.75).add(0.25)), color.a);
        }

        if (settings.bloom) {
          // Bloom sélectif : seules les surfaces émissives (fenêtres, phares, lampadaires) diffusent,
          // le ciel HDR et le soleil restent nets (sinon voile laiteux sur toute l'image).
          bloomNode ??= bloom(sp.getTextureNode('emissive'), 0.9, 0.4, 0);
          chain = chain.add(bloomNode) as unknown as Vec4Node;
        }

        // Étalonnage avant le tone mapping : couleurs vives mais crédibles (direction artistique).
        const tinted = chain.rgb.mul(exposureNode).mul(vec3(tintNode as unknown as THREE.Node<'vec3'>));
        chain = vec4(vibrance(saturation(tinted, satNode), vibNode), float(1));

        if (settings.taa) {
          const depth = sp.getTextureNode('depth');
          const vel = sp.getTextureNode('velocity');
          chain = traa(chain, depth, vel, camera) as unknown as Vec4Node;
        }
        result = chain;
        variants.set(key, result);
      }
      pipeline.outputNode = result;
      pipeline.needsUpdate = true;
    },
    resize() {
      // Format maximal éventuel : le conteneur de l'application est borné et centré avant la mesure.
      if (canvas.parentElement) applyViewport(canvas.parentElement);
      applyResolution();
      const w = canvas.clientWidth || window.innerWidth;
      const h = canvas.clientHeight || window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // 32:9 : on élargit le champ horizontal plutôt que d'étirer (FOV vertical réduit doucement).
      camera.fov = camera.aspect > 2.5 ? 48 : 62;
      camera.updateProjectionMatrix();
    },
    render() {
      const now = performance.now();
      if (fpsCap && now - lastRendered < 1000 / fpsCap - 1) return;
      const dt = lastRendered ? now - lastRendered : 0;
      lastRendered = now;
      if (dynEnabled && dynamicRes.update(dt, now) !== null) applyResolution();
      exposureNode.value = exposure.value;
      satNode.value = grade.saturation;
      vibNode.value = grade.vibrance;
      (tintNode.value as THREE.Color).copy(grade.tint);
      const t0 = performance.now();
      pipeline.render();
      // Lu après le rendu : le moteur remet ses compteurs à zéro au début de chaque image.
      perf.frame(dt, engine, performance.now() - t0);
    },
    renderManual() {
      // Sans requestAnimationFrame (page masquée, tests), les passes « une fois par image »
      // ne se recalculent pas : on avance nous-mêmes le compteur, comme le fait la boucle d'animation.
      const nodes = (renderer as unknown as { _nodes: { nodeFrame: { update(): void; frameId: number } } })._nodes;
      nodes.nodeFrame.update();
      (renderer.info as { frame: number }).frame = nodes.nodeFrame.frameId;
      exposureNode.value = exposure.value;
      satNode.value = grade.saturation;
      vibNode.value = grade.vibrance;
      (tintNode.value as THREE.Color).copy(grade.tint);
      pipeline.render();
    },
  };
  engine.rebuildPipeline(q);
  engine.resize();
  window.addEventListener('resize', () => engine.resize());
  return engine;
}
