import * as THREE from 'three/webgpu';
import { pass, mrt, output, emissive, normalView, velocity, vec4, vec3, packNormalToRGB, unpackRGBToNormal, sample, uniform, float, saturation, vibrance, mix, smoothstep, dot, screenUV, length } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { taau } from 'three/addons/tsl/display/TAAUNode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import type { QualitySettings } from './quality.ts';
import { applyViewport, dynamicResolutionEnabled, getFpsCap, getResolutionCap, RESOLUTION_PIXELS, renderPixelRatio } from './display.ts';
import { DynamicResolution } from './autoQuality.ts';
import { PerfOverlay, perfRequested } from './perf.ts';
import type { Vec4Node } from './tsl.ts';
import { instrumentDevice, pipelineStats } from './pipelineStats.ts';
import { initTextureLoading } from './textures.ts';

/** Compilations de passes en cours : le rendu attend (la cible de rendu est celle de la passe). */
let compiling = 0;
/** Durée maximale (ms) d'une précompilation de la scène avant de lancer la sortie quand même (voir `compilePass`). */
const COMPILE_TIMEOUT_MS = 45_000;
/**
 * three.js range ses objets de rendu par contexte (cible, MRT, profondeur d'appel). La passe de scène est
 * dessinée en appel imbriqué (profondeur 1 dans la chaîne de post-traitement, 2 avec le TAA), mais
 * `compileAsync` demande toujours la profondeur 0 : ce qu'il prépare ne servait jamais, et chaque objet
 * était reconstruit (graphe de nœuds, sur le fil principal) à sa première image. La passe de scène n'étant
 * dessinée qu'une fois par image, on lui donne toujours la même profondeur, en précompilation comme au rendu.
 */
function sharedSceneContext(renderer: THREE.WebGPURenderer, sceneTarget: () => THREE.RenderTarget | null): void {
  const contexts = (renderer as unknown as { _renderContexts: { get(rt: unknown, mrt: unknown, depth?: number): unknown } })._renderContexts;
  const get = contexts.get.bind(contexts);
  contexts.get = (rt, mrt, depth = 0) => get(rt, mrt, rt !== null && rt === sceneTarget() && depth >= 0 ? 1 : depth);
}
export const isCompiling = (): boolean => compiling > 0;

/**
 * Échelle de rendu de la scène avec reconstruction temporelle (TAAU) : 1 = coupé (défaut) ; ?taau=0.75 ou
 * localStorage ar.taau. Soulage la carte graphique sur un grand écran (4K, 32:9) quand elle est le goulot.
 */
function taauScale(): number {
  try {
    const raw = new URLSearchParams(location.search).get('taau') ?? localStorage.getItem('ar.taau');
    const n = Number(raw);
    return raw !== null && Number.isFinite(n) && n >= 0.5 && n < 1 ? n : 1;
  } catch {
    return 1;
  }
}

/** Moteur de rendu du jeu (un seul), pour les systèmes qui préparent des textures (carte d'environnement du ciel). */
let main: THREE.WebGPURenderer | null = null;
export const mainRenderer = (): THREE.WebGPURenderer | null => main;

/**
 * Lance `compile` avec les objets de `root` hors du champ compris (rétablis au retour, avant toute image).
 * three.js garde la clé d'environnement (lumières, brouillard, ombres) d'un appel de rendu à l'autre
 * (`info.calls`), et `compileAsync` n'avance pas ce compteur : sans cela, il reprendrait la clé d'un rendu
 * précédent (menu) et ce qu'il prépare ne servirait pas.
 */
function withoutCulling<T>(renderer: THREE.WebGPURenderer, root: THREE.Object3D, compile: () => T): T {
  (renderer.info as { calls: number }).calls++;
  const culled: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (!o.frustumCulled) return;
    culled.push(o);
    o.frustumCulled = false;
  });
  try {
    return compile();
  } finally {
    for (const o of culled) o.frustumCulled = true;
  }
}

/**
 * Lance `compile` avec tous les niveaux de détail visibles (coureurs) : un coureur distancé passe à un
 * niveau plus simple, jamais dessiné jusque-là, donc compilé en pleine sortie. Les autres objets masqués
 * restent de côté (25 s de plus au chargement en qualité haute). Rétabli au retour, avant toute image.
 */
function withAllLevels<T>(root: THREE.Object3D, compile: () => T): T {
  const saved: Array<() => void> = [];
  root.traverse((o) => {
    const lod = o as THREE.LOD;
    if (!lod.isLOD) return;
    const auto = lod.autoUpdate;
    // Niveau choisi en calculant ses matrices (voir GltfRiderAvatar) : méthode standard le temps de la compilation.
    const own = Object.hasOwn(lod, 'updateMatrixWorld') ? lod.updateMatrixWorld : null;
    const visible = lod.levels.map((l) => l.object.visible);
    lod.autoUpdate = false;
    if (own) lod.updateMatrixWorld = THREE.LOD.prototype.updateMatrixWorld;
    for (const l of lod.levels) l.object.visible = true;
    saved.push(() => {
      lod.autoUpdate = auto;
      if (own) lod.updateMatrixWorld = own;
      lod.levels.forEach((l, i) => (l.object.visible = visible[i] as boolean));
    });
  });
  try {
    return compile();
  } finally {
    for (const restore of saved) restore();
  }
}

/**
 * Précompile les matériaux d'une passe de scène pour SA cible de rendu et SA disposition MRT : c'est avec
 * elles que la scène est vraiment dessinée. `renderer.compileAsync(scene, camera)` seul compile pour
 * l'écran, et tout est recompilé à la première image. `onProgress(fait, total)` suit les objets compilés.
 */
export async function compilePass(renderer: THREE.WebGPURenderer, p: ReturnType<typeof pass>, onProgress?: (done: number, total: number) => void): Promise<void> {
  const target = renderer.getRenderTarget();
  const m = renderer.getMRT();
  compiling++;
  renderer.setRenderTarget(p.renderTarget);
  renderer.setMRT(p.getMRT());
  try {
    // Garde-fou : si une compilation ne se termine pas (shader refusé, objet qui bloque), on ne reste pas
    // indéfiniment sur « Derniers réglages » : au-delà de COMPILE_TIMEOUT_MS la sortie démarre, le reste se
    // compile au fil des images, comme avant la précompilation.
    const done = withAllLevels(p.scene, () => withoutCulling(renderer, p.scene, () => renderer.compileAsync(p.scene, p.camera, null, onProgress ? (e) => onProgress(e.loaded, e.total) : null)));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        console.warn(`[compilation] ${COMPILE_TIMEOUT_MS / 1000} s dépassées : la sortie démarre, le reste se compile en roulant`);
        resolve();
      }, COMPILE_TIMEOUT_MS);
    });
    try {
      await Promise.race([done, late]);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Compilation au premier rendu, comme avant.
  } finally {
    renderer.setRenderTarget(target);
    renderer.setMRT(m);
    compiling--;
  }
}

/**
 * Étalonnage : saturation, vivacité, teinte d'ensemble (lumière chaude ou froide), virage des ombres et
 * des hautes lumières (frais dans l'ombre, chaud au soleil, selon la saison et l'heure) et vignettage.
 */
export interface Grade {
  saturation: number;
  vibrance: number;
  tint: THREE.Color;
  shadows: THREE.Color;
  highlights: THREE.Color;
  /** Assombrissement des coins (0–1). */
  vignette: number;
}

export interface Engine {
  renderer: THREE.WebGPURenderer;
  pipeline: THREE.RenderPipeline;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  backend: 'webgpu' | 'webgl2';
  /** Exposition globale (étalonnage par saison / heure). */
  exposure: { value: number };
  /** Étalonnage : saturation, vivacité et teinte multiplicative (lumière chaude ou froide). */
  grade: Grade;
  /** Préréglage en cours (change à chaque `rebuildPipeline`). */
  quality: QualitySettings;
  /** Résolution dynamique : échelle de rendu courante, ajustée selon le temps d'image. */
  dynamicRes: DynamicResolution;
  /** Recalcule la résolution de rendu (plafond de pixels, format, échelle dynamique). */
  applyResolution(): void;
  rebuildPipeline(q: QualitySettings): void;
  /** Précompile la scène pour la passe réellement dessinée (voir `compilePass`). */
  compileScene(onProgress?: (done: number, total: number) => void): Promise<void>;
  /**
   * Sortie en cours : tout objet ajouté ensuite à la scène (tuile, cycliste…) est compilé à l'avance,
   * sans bloquer l'affichage, et n'est dessiné qu'une fois prêt (voir `enqueue` et `compileObject`).
   * Les objets déjà présents sont supposés compilés (`compileScene`).
   */
  watchNewObjects(on: boolean): void;
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
  main = renderer;
  initTextureLoading(renderer);
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
  if (backend === 'webgpu') instrumentDevice((renderer.backend as unknown as { device: GPUDevice }).device);
  sharedSceneContext(renderer, () => scenePass?.renderTarget ?? null);
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, q.viewDistance);

  const exposure = { value: 1 };
  const exposureNode = uniform(1);
  const grade: Grade = { saturation: 1.12, vibrance: 0.18, tint: new THREE.Color(1, 1, 1), shadows: new THREE.Color(1, 1, 1), highlights: new THREE.Color(1, 1, 1), vignette: 0.16 };
  const satNode = uniform(1.12);
  const vibNode = uniform(0.18);
  const tintNode = uniform(new THREE.Color(1, 1, 1));
  const shadowNode = uniform(new THREE.Color(1, 1, 1));
  const highlightNode = uniform(new THREE.Color(1, 1, 1));
  const vignetteNode = uniform(0.16);
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
  /** Objets de la scène déjà vus (compilés ou en file) ; `null` : pas de surveillance (menu, garage). */
  let seen: WeakSet<THREE.Object3D> | null = null;
  /**
   * File de précompilation des nouveaux objets visibles, retirés du rendu jusqu'à ce qu'ils soient prêts.
   * Pas les objets masqués : les préparer en fond coûte plus cher sur le fil principal (graphes de nœuds
   * construits par three.js même « en asynchrone ») que leur construction à l'apparition, étalée par
   * leurs propriétaires (blocs d'arbres : voir `Vegetation.pendingLod`).
   */
  const queue: Array<{ obj: THREE.Object3D; restore: () => void }> = [];
  let busy = false;

  const isDrawable = (obj: THREE.Object3D): boolean => {
    let found = false;
    obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite || (o as THREE.Line).isLine) found = true;
    });
    return found;
  };

  /**
   * Compile `obj` pour la passe de scène réelle : la partie synchrone de `compileAsync` (liste des objets,
   * cible de rendu, MRT, premier graphe de nœuds) se fait tout de suite, la suite par morceaux et les
   * shaders sur les fils de Dawn. Ses parties masquées (niveaux de détail des coureurs, options) restent
   * de côté : trop chères à préparer toutes.
   */
  const compileObject = (obj: THREE.Object3D): Promise<void> => {
    // Retiré entre-temps (tuile déchargée) : rien à faire.
    if (!scenePass || !obj.parent) return Promise.resolve();
    const target = renderer.getRenderTarget();
    const m = renderer.getMRT();
    renderer.setRenderTarget(scenePass.renderTarget);
    renderer.setMRT(scenePass.getMRT());
    try {
      // Hors du champ aussi : la tuile de devant doit être prête avant d'y arriver.
      return withoutCulling(renderer, obj, () => renderer.compileAsync(obj, camera, scene));
    } catch {
      return Promise.resolve();
    } finally {
      renderer.setRenderTarget(target);
      renderer.setMRT(m);
    }
  };

  /**
   * Une compilation à la fois : three.js ne cède la main qu'entre les objets d'une même compilation. Lancer
   * celles de cinquante blocs d'arbres d'une tuile dans la même image figeait l'image (300 ms et plus).
   */
  const pump = (): void => {
    if (busy) return;
    const job = queue.shift();
    if (!job) return;
    busy = true;
    void compileObject(job.obj)
      .catch(() => undefined)
      .finally(() => {
        job.restore();
        busy = false;
        pipelineStats.prepared++;
        pipelineStats.pending = queue.length;
        pump();
      });
  };

  /** Objet visible arrivé dans la scène : il n'est dessiné (calques) qu'une fois compilé. */
  const enqueue = (obj: THREE.Object3D): void => {
    if (!obj.visible || !isDrawable(obj)) return;
    const objs: THREE.Object3D[] = [];
    obj.traverse((o) => objs.push(o));
    const masks = objs.map((o) => o.layers.mask);
    for (const o of objs) o.layers.mask = 0;
    queue.push({ obj, restore: () => objs.forEach((o, i) => (o.layers.mask = masks[i] as number)) });
    pipelineStats.pending = queue.length;
    pump();
  };

  /** Nouveaux objets de la scène : enfants directs, et enfants des groupes (tuiles des systèmes du monde, coureurs). */
  const prepareNewObjects = (): void => {
    if (!seen) return;
    for (const c of scene.children) {
      if (!seen.has(c)) {
        seen.add(c);
        if (!(c as THREE.Group).isGroup) {
          enqueue(c);
          continue;
        }
      }
      if (!(c as THREE.Group).isGroup) continue;
      for (const g of c.children)
        if (!seen.has(g)) {
          seen.add(g);
          enqueue(g);
        }
    }
  };

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
      // Feuille de style : verre dépoli du HUD coupé en qualité basse et moyenne (hud.css).
      document.documentElement.dataset.quality = settings.level;
      if (camera.far !== settings.viewDistance) {
        camera.far = settings.viewDistance;
        camera.updateProjectionMatrix();
      }
      if (resChanged || !scenePass) applyResolution();

      // La passe de scène (et sa disposition MRT) survit aux changements d'effets : couper le bloom,
      // l'AO ou le TAA en cours de sortie ne refait que le post-traitement. Changer la disposition MRT
      // recompilerait les matériaux de toute la scène (plusieurs secondes).
      // Toujours en MRT, même sans aucun effet (préréglage Bas) : activer un effet en cours de sortie ne
      // recompile alors plus les matériaux de toute la scène (plusieurs secondes de blocage au clic).
      const needMrt = true;
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
      // Rendu de la scène à résolution réduite, reconstruit par l'anticrénelage temporel (TAAU) : seulement avec le TAA.
      const upscale = settings.taa ? taauScale() : 1;
      if (scenePass.getResolutionScale() !== upscale) scenePass.setResolutionScale(upscale);
      const key = `${settings.ao ? settings.aoScale : 0}|${settings.bloom ? 1 : 0}|${settings.taa ? (upscale < 1 ? 3 : 1) : settings.smaa ? 2 : 0}`;
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
        const graded = vibrance(saturation(tinted, satNode), vibNode);
        // Virage : teinte des ombres vers celle des hautes lumières selon la luminance (avant le tone mapping).
        const lum = dot(graded, vec3(0.2126, 0.7152, 0.0722));
        const split = mix(vec3(shadowNode as unknown as THREE.Node<'vec3'>), vec3(highlightNode as unknown as THREE.Node<'vec3'>), smoothstep(0.03, 0.7, lum));
        // Vignettage doux : le regard va au centre (la route), les coins s'assombrissent à peine.
        const corner = smoothstep(0.35, 0.95, length(screenUV.sub(0.5)).mul(1.35));
        chain = vec4(graded.mul(split).mul(float(1).sub(corner.mul(vignetteNode))), float(1));

        if (settings.taa) {
          const depth = sp.getTextureNode('depth');
          const vel = sp.getTextureNode('velocity');
          chain = (upscale < 1 ? taau(chain as unknown as THREE.TextureNode, depth, vel, camera) : traa(chain, depth, vel, camera)) as unknown as Vec4Node;
        } else if (settings.smaa) {
          // Sans TAA (préréglages Bas et Moyen) : SMAA, bien moins cher, pour ne pas laisser l'image crénelée.
          chain = smaa(chain) as unknown as Vec4Node;
        }
        result = chain;
        variants.set(key, result);
      }
      pipeline.outputNode = result;
      pipeline.needsUpdate = true;
    },
    compileScene(onProgress) {
      return scenePass ? compilePass(renderer, scenePass, onProgress) : Promise.resolve();
    },
    watchNewObjects(on) {
      pipelineStats.inRide = on;
      if (!on) {
        seen = null;
        return;
      }
      seen = new WeakSet();
      for (const c of scene.children) {
        seen.add(c);
        for (const g of c.children) seen.add(g);
      }
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
      if (compiling) return;
      const now = performance.now();
      if (fpsCap && now - lastRendered < 1000 / fpsCap - 1) return;
      const dt = lastRendered ? now - lastRendered : 0;
      lastRendered = now;
      if (dynEnabled && dynamicRes.update(dt, now) !== null) applyResolution();
      exposureNode.value = exposure.value;
      satNode.value = grade.saturation;
      vibNode.value = grade.vibrance;
      (tintNode.value as THREE.Color).copy(grade.tint);
      (shadowNode.value as THREE.Color).copy(grade.shadows);
      (highlightNode.value as THREE.Color).copy(grade.highlights);
      vignetteNode.value = grade.vignette;
      prepareNewObjects();
      const t0 = performance.now();
      pipeline.render();
      // Lu après le rendu : le moteur remet ses compteurs à zéro au début de chaque image.
      perf.frame(dt, engine, performance.now() - t0);
    },
    renderManual() {
      if (compiling) return;
      // Sans requestAnimationFrame (page masquée, tests), les passes « une fois par image »
      // ne se recalculent pas : on avance nous-mêmes le compteur, comme le fait la boucle d'animation.
      const nodes = (renderer as unknown as { _nodes: { nodeFrame: { update(): void; frameId: number } } })._nodes;
      nodes.nodeFrame.update();
      (renderer.info as { frame: number }).frame = nodes.nodeFrame.frameId;
      exposureNode.value = exposure.value;
      satNode.value = grade.saturation;
      vibNode.value = grade.vibrance;
      (tintNode.value as THREE.Color).copy(grade.tint);
      (shadowNode.value as THREE.Color).copy(grade.shadows);
      (highlightNode.value as THREE.Color).copy(grade.highlights);
      vignetteNode.value = grade.vignette;
      pipeline.render();
    },
  };
  engine.rebuildPipeline(q);
  engine.resize();
  window.addEventListener('resize', () => engine.resize());
  return engine;
}
