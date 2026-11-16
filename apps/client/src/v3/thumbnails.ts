import * as THREE from 'three/webgpu';
import { isCompiling } from '../engine/renderer.ts';
import { attachKit, freeGear, loadGearItem, loadRider, loadV3DisplayBike, restoreRider, showHairGeometry, type RiderVisual, type V3Gear } from './visuals.ts';

/**
 * Vignettes du vestiaire V3 pour les articles sans icône Zwift (maillots, chaussettes, têtes, barbes…) :
 * le coureur V3 porte l'article, photographié hors écran (fond transparent, éclairage de studio),
 * cadré sur la partie du corps concernée. Une prise à la fois ; gardées en mémoire et dans le cache du navigateur.
 */
const SIZE = 160; // multiple de 32 : lignes relues sans remplissage (RGBA demi-flottants, 256 octets)
const CACHE = 'ar-v3-vignettes-6';

/** Cadrage par type : centre (m, pose de repos debout, face vers +X) et demi-hauteur du champ. */
function framing(type: string): { y: number; half: number; z?: number; side?: number } {
  switch (type) {
    case 'HEAD_TYPE': case 'HAIR': case 'FACIAL_HAIR': case 'HEAD_GEAR': case 'GLASSES': return { y: 1.63, half: 0.17 };
    case 'SOCKS': return { y: 0.135, half: 0.08 };
    case 'CYCLING_SHOES': return { y: 0.12, half: 0.18 };
    case 'GLOVES': return { y: 1.0, half: 0.5 };
    default: return { y: 1.27, half: 0.36 };
  }
}

// AgX approché (filmique) puis sRGB : même rendu que les photos des affiches de l'atelier.
const tone = (x: number) => {
  const y = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
  return Math.round(255 * Math.min(1, Math.max(0, y)) ** (1 / 2.2));
};

export class V3ThumbnailStudio {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
  private readonly target = new THREE.RenderTarget(SIZE, SIZE, { type: THREE.HalfFloatType, samples: 4 });
  private readonly riders = new Map<'male' | 'female', Promise<RiderVisual>>();
  private readonly done = new Map<string, Promise<string>>();
  /** Prises en attente : la dernière demandée passe d'abord (l'onglet regardé avant les précédents). */
  private readonly pending: Array<() => Promise<void>> = [];
  private busy = false;

  constructor(private readonly renderer: THREE.WebGPURenderer, environment: THREE.Texture | null) {
    this.scene.environment = environment;
    this.scene.environmentIntensity = 0.55;
    this.scene.add(new THREE.HemisphereLight(0xfff4e6, 0x4a4036, 0.9));
    const key = new THREE.DirectionalLight(0xfff1e2, 3.0);
    key.position.set(4, 4, 2.5);
    const rim = new THREE.DirectionalLight(0xdfe8ff, 1.4);
    rim.position.set(-3, 3, -3);
    const fill = new THREE.DirectionalLight(0xffffff, 0.8);
    fill.position.set(3, 1, -3);
    this.scene.add(key, rim, fill);
  }

  /** URL d'image (blob) de l'article porté ; même promesse pour le même article. */
  photo(item: V3Gear, sex: 'male' | 'female', wanted: () => boolean = () => true): Promise<string> {
    const key = item.id + '-' + (item.sex === 'male' || item.sex === 'female' ? item.sex : sex);
    let job = this.done.get(key);
    if (!job) {
      // Pastille retirée entre-temps (autre catégorie, recherche) : la prise est abandonnée.
      job = this.cached(key).then(hit => hit ?? this.enqueue(() => (wanted() ? this.shoot(item, key) : Promise.reject(new Error('Vignette abandonnée.')))));
      job.catch(() => this.done.delete(key));
      this.done.set(key, job);
    }
    return job;
  }

  private async cached(key: string): Promise<string | undefined> {
    try {
      const hit = await (await caches.open(CACHE)).match('/__v3-studio/' + key + '.png');
      return hit ? URL.createObjectURL(await hit.blob()) : undefined;
    } catch {
      return undefined; // stockage indisponible : la photo est refaite
    }
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.push(() => task().then(resolve, reject));
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      for (let next = this.pending.pop(); next; next = this.pending.pop()) {
        // Pas pendant la précompilation des shaders de l'atelier ; une prise ne bloque jamais la file plus de 20 s.
        while (isCompiling()) await new Promise(done => setTimeout(done, 150));
        await Promise.race([next(), new Promise(done => setTimeout(done, 20_000))]);
      }
    } finally {
      this.busy = false;
    }
  }


  private rider(sex: 'male' | 'female'): Promise<RiderVisual> {
    let rider = this.riders.get(sex);
    if (!rider) {
      rider = loadRider(sex).then(visual => {
        visual.levels.forEach(node => { node.visible = node.name === 'LOD0'; });
        if (visual.helmet) visual.helmet.visible = false;
        visual.scene.visible = false;
        this.scene.add(visual.scene);
        return visual;
      });
      rider.catch(() => this.riders.delete(sex));
      this.riders.set(sex, rider);
    }
    return rider;
  }

  /** Vélo sans icône Zwift : photo de profil, roues comprises (vignette 256 × 160, comme les icônes du catalogue). */
  photoBike(id: string, wanted: () => boolean = () => true): Promise<string> {
    const key = 'bike-' + id;
    let job = this.done.get(key);
    if (!job) {
      job = this.cached(key).then(hit => hit ?? this.enqueue(() => (wanted() ? this.shootBike(id, key) : Promise.reject(new Error('Vignette abandonnée.')))));
      job.catch(() => this.done.delete(key));
      this.done.set(key, job);
    }
    return job;
  }

  private bikeTarget?: THREE.RenderTarget;

  private async shootBike(id: string, key: string): Promise<string> {
    const node = await loadV3DisplayBike(id);
    try {
      this.scene.add(node);
      node.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(node);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      // Profil : caméra sur l'axe horizontal le plus court (perpendiculaire au vélo), côté transmission.
      const across = size.x < size.z ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
      const length = Math.max(size.x, size.z);
      const w = 256, h = 160;
      const halfW = Math.max(length, size.y * (w / h)) * 0.53;
      const halfH = halfW * (h / w);
      const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 20);
      cam.position.copy(center).addScaledVector(across, 5);
      cam.lookAt(center);
      cam.updateProjectionMatrix();
      this.bikeTarget ??= new THREE.RenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
      return await this.capture(cam, this.bikeTarget, w, h, key);
    } finally {
      node.removeFromParent();
      node.traverse(child => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
      });
    }
  }

  /** Rendu hors écran (fond transparent), relu, tonalisé, mis en cache ; renvoie une URL d'image. */
  private async capture(cam: THREE.Camera, target: THREE.RenderTarget, width: number, height: number, key: string): Promise<string> {
    await Promise.race([this.renderer.compileAsync(this.scene, cam), new Promise(done => setTimeout(done, 4000))]);
    const renderer = this.renderer;
    const prev = renderer.getRenderTarget();
    const prevMrt = renderer.getMRT();
    const clear = renderer.getClearColor(new THREE.Color());
    const clearAlpha = renderer.getClearAlpha();
    renderer.setMRT(null);
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(this.scene, cam);
    renderer.setRenderTarget(prev);
    renderer.setMRT(prevMrt);
    renderer.setClearColor(clear, clearAlpha);
    const pixels = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height)) as Uint16Array;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d') as CanvasRenderingContext2D;
    const image = context.createImageData(width, height);
    const half16 = THREE.DataUtils.fromHalfFloat;
    for (let i = 0; i < width * height * 4; i += 4) {
      // WebGPU : lignes relues de haut en bas, comme les photos des affiches.
      const alpha = Math.min(1, half16(pixels[i + 3] as number));
      if (alpha <= 0.002) continue;
      image.data[i] = tone(half16(pixels[i] as number) / alpha);
      image.data[i + 1] = tone(half16(pixels[i + 1] as number) / alpha);
      image.data[i + 2] = tone(half16(pixels[i + 2] as number) / alpha);
      image.data[i + 3] = Math.round(alpha * 255);
    }
    context.putImageData(image, 0, 0);
    const blob = await new Promise<Blob>((done, fail) => canvas.toBlob(b => (b ? done(b) : fail(new Error('Vignette vide.'))), 'image/png'));
    try {
      await (await caches.open(CACHE)).put('/__v3-studio/' + key + '.png', new Response(blob, { headers: { 'Content-Type': 'image/png' } }));
    } catch { /* cache indisponible */ }
    return URL.createObjectURL(blob);
  }

  private async shoot(item: V3Gear, key: string): Promise<string> {
    const sex = key.endsWith('female') ? 'female' : 'male';
    const rider = await this.rider(sex);
    const gear = await loadGearItem(item, { id: item.id, color: 0 }, sex);
    const hidden: THREE.Object3D[] = [];
    try {
      restoreRider(rider);
      attachKit(rider, [gear]);
      if (item.type === 'HAIR') showHairGeometry(gear.left, 'none');
      // Maillot seul, sans le personnage : seules les surfaces du matériau du maillot restent visibles.
      if (item.type === 'CYCLING_JERSEY') rider.scene.traverse(node => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        if (materials.some(material => /^CyclistKIT$/i.test(material.name))) return;
        hidden.push(mesh);
        mesh.visible = false;
      });
      rider.scene.visible = true;
      // Trois quarts face, légèrement plongeant ; pieds vus un peu plus de côté.
      const { y, half, z = 0 } = framing(item.type);
      // Maillot presque de face, comme les icônes Zwift ; pieds un peu de côté ; têtes de trois quarts.
      const direction = item.type === 'CYCLING_JERSEY' ? new THREE.Vector3(1, 0.06, 0.22)
        : item.type === 'SOCKS' || item.type === 'CYCLING_SHOES' ? new THREE.Vector3(0.75, 0.25, 0.85) : new THREE.Vector3(1, 0.12, 0.5);
      const cam = this.camera;
      cam.left = cam.bottom = -half;
      cam.right = cam.top = half;
      cam.position.set(0, y, z).addScaledVector(direction.normalize(), 5);
      cam.lookAt(0, y, z);
      cam.updateProjectionMatrix();
      return await this.capture(cam, this.target, SIZE, SIZE, key);
    } finally {
      rider.scene.visible = false;
      for (const node of hidden) node.visible = true;
      restoreRider(rider);
      freeGear(gear);
    }
  }
}
