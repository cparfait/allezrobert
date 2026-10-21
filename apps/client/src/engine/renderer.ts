import * as THREE from 'three/webgpu';
import { pass, mrt, output, emissive, normalView, velocity, vec4, packNormalToRGB, unpackRGBToNormal, sample, uniform, float } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import type { QualitySettings } from './quality.ts';
import type { Vec4Node } from './tsl.ts';

export interface Engine {
  renderer: THREE.WebGPURenderer;
  pipeline: THREE.RenderPipeline;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  backend: 'webgpu' | 'webgl2';
  /** Exposition globale (étalonnage par saison / heure). */
  exposure: { value: number };
  rebuildPipeline(q: QualitySettings): void;
  resize(): void;
  render(): void;
}

/**
 * Crée le moteur de rendu : WebGPU par défaut, repli WebGL2 automatique (ou forcé par ?webgl).
 * Chaîne de post-traitement : MRT (couleur, normales, vitesses) → GTAO → bloom → TRAA.
 */
export async function createEngine(canvas: HTMLCanvasElement, q: QualitySettings): Promise<Engine> {
  const forceWebGL = new URLSearchParams(location.search).has('webgl');
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, forceWebGL, powerPreference: 'high-performance' });
  await renderer.init();
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * q.pixelRatio);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, q.viewDistance);

  const exposure = { value: 1 };
  const exposureNode = uniform(1);
  const pipeline = new THREE.RenderPipeline(renderer);

  const engine: Engine = {
    renderer,
    pipeline,
    scene,
    camera,
    backend,
    exposure,
    rebuildPipeline(settings: QualitySettings) {
      camera.far = settings.viewDistance;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * settings.pixelRatio);

      const scenePass = pass(scene, camera);
      const useMrt = settings.ao || settings.taa || settings.bloom;
      if (useMrt) {
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
      const color = scenePass.getTextureNode('output');
      // Chaîne d'effets : le type du nœud change à chaque étape (texture → vec4 → TRAA).
      let result: Vec4Node = color as unknown as Vec4Node;

      if (settings.ao) {
        const depth = scenePass.getTextureNode('depth');
        const normalColor = scenePass.getTextureNode('normal');
        const normal = sample((uvNode) => unpackRGBToNormal(normalColor.sample(uvNode)));
        const aoPass = ao(depth, normal, camera);
        aoPass.resolutionScale = settings.aoScale;
        aoPass.distanceExponent.value = 1;
        aoPass.radius.value = 0.6;
        aoPass.thickness.value = 1;
        const aoValue = aoPass.getTextureNode().r;
        // AO atténuée : on garde un monde lumineux (direction artistique).
        result = vec4(color.rgb.mul(aoValue.mul(0.75).add(0.25)), color.a);
      }

      if (settings.bloom) {
        // Bloom sélectif : seules les surfaces émissives (fenêtres, phares, lampadaires) diffusent,
        // le ciel HDR et le soleil restent nets (sinon voile laiteux sur toute l'image).
        const b = bloom(scenePass.getTextureNode('emissive'), 0.9, 0.4, 0);
        result = result.add(b) as unknown as Vec4Node;
      }

      result = vec4(result.rgb.mul(exposureNode), float(1));

      if (settings.taa) {
        const depth = scenePass.getTextureNode('depth');
        const vel = scenePass.getTextureNode('velocity');
        result = traa(result, depth, vel, camera) as unknown as Vec4Node;
      }
      pipeline.outputNode = result;
      pipeline.needsUpdate = true;
    },
    resize() {
      const w = canvas.clientWidth || window.innerWidth;
      const h = canvas.clientHeight || window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // 32:9 : on élargit le champ horizontal plutôt que d'étirer (FOV vertical réduit doucement).
      camera.fov = camera.aspect > 2.5 ? 48 : 62;
      camera.updateProjectionMatrix();
    },
    render() {
      exposureNode.value = exposure.value;
      pipeline.render();
    },
  };
  engine.rebuildPipeline(q);
  engine.resize();
  window.addEventListener('resize', () => engine.resize());
  return engine;
}
