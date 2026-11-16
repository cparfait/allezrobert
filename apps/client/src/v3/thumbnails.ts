import * as THREE from 'three/webgpu';
import { isCompiling } from '../engine/renderer.ts';
import { attachKit, BUILT_IN_BEARDS, freeGear, showSockHeight, getV3Catalog, getV3Gear, loadGearItem, loadRider, loadV3DisplayBike, loadV3DisplayWheel, restoreRider, showHairGeometry, type RiderVisual, type V3Gear } from './visuals.ts';

/**
 * Vignettes du vestiaire V3 pour les articles sans icône Zwift (maillots, chaussettes, têtes, barbes…) :
 * le coureur V3 porte l'article, photographié hors écran (fond transparent, éclairage de studio),
 * cadré sur la partie du corps concernée. Une prise à la fois ; gardées en mémoire et dans le cache du navigateur.
 */
const SIZE = 160; // multiple de 32 : lignes relues sans remplissage (RGBA demi-flottants, 256 octets)
const CACHE = 'ar-v3-vignettes-6';
/** Version des photos gardées sur le serveur (out/v3/studio/<version>) : à changer avec CACHE quand le rendu change. */
const STUDIO = '/__v3/studio/v6/';

/** Vignette photographiée par le studio (sinon icône Zwift, ou pastille de couleur pour les chaussettes). */
/**
 * Clé de la photo d'un article ; têtes, coiffures et barbes en version « b » : photographiées sans la moustache
 * d'origine (les premières photos la montraient sur toutes les têtes).
 */
export function photoKey(item: V3Gear, sex: 'male' | 'female'): string {
  const own = item.sex === 'male' || item.sex === 'female' ? item.sex : sex;
  const base = item.id + '-' + own;
  // Photos féminines à suffixe refaites (« 2 ») : prises à tort sur le coureur (voir sexOfKey).
  const again = own === 'female' ? '2' : '';
  if (item.type === 'FACIAL_HAIR') return base + '-c' + again; // barbes montrées par les pièces du visage
  if (item.type === 'SOCKS') return base + '-d' + again; // chaussette seule, haute, de côté
  if (item.type === 'HAIR') return base + '-c' + again; // coiffures vues de trois quarts arrière
  return item.type === 'HEAD_TYPE' ? base + '-b' + again : base;
}

/** Silhouette d'une photo d'après sa clé (« 1709-female-b2 », « 453-female ») : le suffixe ne doit pas la masquer. */
function sexOfKey(key: string): 'male' | 'female' {
  return /-female(-|$)/.test(key) ? 'female' : 'male';
}

export function needsPhoto(item: V3Gear): boolean {
  // Maillots et coiffures toujours photographiés (icônes Zwift : fond noir, ou mannequin d'un autre style).
  return item.type === 'CYCLING_JERSEY' || item.type === 'HAIR' || !item.colors[0]?.icon;
}

/** Cadrage par type : centre (m, pose de repos debout, face vers +X) et demi-hauteur du champ. */
function framing(type: string): { y: number; half: number; z?: number; side?: number } {
  switch (type) {
    case 'HAIR': return { y: 1.6, half: 0.21 }; // coiffures longues (queues de cheval, chignons) comprises
    case 'HEAD_TYPE': case 'FACIAL_HAIR': case 'HEAD_GEAR': case 'GLASSES': return { y: 1.63, half: 0.17 };
    case 'SOCKS': return { y: 0.19, half: 0.14 };
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
  /** Photos préparées d'avance, quand rien d'autre n'attend et que le garage est ouvert. */
  private readonly background: Array<() => Promise<void>> = [];
  private busy = false;
  /** Clés déjà photographiées et gardées sur le serveur. */
  private readonly stored: Promise<Set<string>> = fetch(STUDIO + 'index').then(r => (r.ok ? r.json() as Promise<string[]> : []))
    .then(keys => new Set(keys)).catch(() => new Set<string>());
  /** Garage ouvert : sinon les photos d'avance attendent (pas de rendu hors écran pendant une sortie). */
  active = () => true;
  private prewarmed = false;

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
    const key = photoKey(item, sex);
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
    if ((await this.stored).has(key)) return STUDIO + key + '.png';
    try {
      const hit = await (await caches.open(CACHE)).match('/__v3-studio/' + key + '.png');
      if (!hit) return undefined;
      const blob = await hit.blob();
      void this.store(key, blob); // photo d'une session précédente : déposée sur le serveur au passage
      return URL.createObjectURL(blob);
    } catch {
      return undefined; // stockage indisponible : la photo est refaite
    }
  }

  /** Dépose une photo sur le serveur (out/v3/studio) : elle servira à tous les navigateurs, sans être refaite. */
  private async store(key: string, blob: Blob): Promise<void> {
    try {
      const response = await fetch(STUDIO + key + '.png', { method: 'POST', body: blob, headers: { 'Content-Type': 'image/png' } });
      if (response.ok) (await this.stored).add(key);
    } catch { /* serveur indisponible : la photo reste dans le cache du navigateur */ }
  }

  /** Relance les photos d'avance (garage rouvert). */
  resume(): void {
    void this.drain();
  }

  /**
   * Photographie d'avance, une fois par session, tout ce qui manque sur le serveur : articles de la silhouette
   * (petites catégories d'abord, maillots ensuite) puis vélos. Les vignettes demandées à l'écran passent toujours avant.
   */
  prewarm(sex: 'male' | 'female'): void {
    if (this.prewarmed) return;
    this.prewarmed = true;
    void Promise.all([getV3Gear(), getV3Catalog(), this.stored]).then(([items, catalog, stored]) => {
      const todo = items.filter(item => needsPhoto(item) && (item.sex === 'tous' || item.sex === sex))
        .sort((a, b) => Number(a.type === 'CYCLING_JERSEY') - Number(b.type === 'CYCLING_JERSEY'));
      for (const item of todo) {
        const key = photoKey(item, sex);
        if (!stored.has(key)) this.background.push(() => (this.done.has(key) ? Promise.resolve() : this.remember(key, this.shoot(item, key))));
      }
      for (const bike of catalog.bikes) {
        const key = 'bike-' + bike.id;
        if (!stored.has(key)) this.background.push(() => (this.done.has(key) ? Promise.resolve() : this.remember(key, this.shootBike(bike.id, key))));
      }
      void this.drain();
    }).catch(() => { this.prewarmed = false; });
  }

  private remember(key: string, job: Promise<string>): Promise<void> {
    job.catch(() => this.done.delete(key));
    this.done.set(key, job);
    return job.then(() => undefined, () => undefined);
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
      for (let next = this.pending.pop() ?? (this.active() ? this.background.shift() : undefined); next;
        next = this.pending.pop() ?? (this.active() ? this.background.shift() : undefined)) {
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

  /** Roue sans icône Zwift : photo de profil de la roue avant (même format que les vignettes de vélos). */
  photoWheel(id: string, wanted: () => boolean = () => true): Promise<string> {
    const key = 'wheel-' + id;
    let job = this.done.get(key);
    if (!job) {
      job = this.cached(key).then(hit => hit ?? this.enqueue(() => (wanted() ? this.shootProfile(loadV3DisplayWheel(id), key) : Promise.reject(new Error('Vignette abandonnée.')))));
      job.catch(() => this.done.delete(key));
      this.done.set(key, job);
    }
    return job;
  }

  private bikeTarget?: THREE.RenderTarget;

  private shootBike(id: string, key: string): Promise<string> {
    return this.shootProfile(loadV3DisplayBike(id), key);
  }

  /** Photo de profil d'un modèle (vélo ou roue), cadré sur sa boîte, fond transparent. */
  private async shootProfile(loading: Promise<THREE.Object3D>, key: string): Promise<string> {
    const node = await loading;
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
    void this.store(key, blob);
    return URL.createObjectURL(blob);
  }

  private async shoot(item: V3Gear, key: string): Promise<string> {
    const sex = sexOfKey(key);
    const rider = await this.rider(sex);
    const gear = await loadGearItem(item, { id: item.id, color: 0 }, sex);
    const hidden: THREE.Object3D[] = [];
    try {
      restoreRider(rider);
      attachKit(rider, [gear]);
      // Têtes et coiffures : visage rasé (pas de moustache d'origine) pour bien voir l'article.
      if (item.type === 'HEAD_TYPE' || item.type === 'HAIR') {
        for (const { id, node } of rider.groups) if (BUILT_IN_BEARDS.includes(id)) node.visible = false;
      }
      if (item.type === 'HAIR') showHairGeometry(gear.left, 'none');
      // Maillot seul, sans le personnage : seules les surfaces du matériau du maillot restent visibles.
      // Chaussette seule, en version haute (plus de motif visible), sans la jambe ni la chaussure.
      if (item.type === 'SOCKS') {
        showSockHeight(rider, 'high');
        rider.scene.traverse(node => {
          const mesh = node as THREE.Mesh;
          if (!mesh.isMesh) return;
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          if (materials.some(material => /^SockKIT$/i.test(material.name))) return;
          hidden.push(mesh);
          mesh.visible = false;
        });
      }
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
        : item.type === 'HAIR' ? new THREE.Vector3(-0.35, 0.25, 1) // trois quarts arrière : la coiffure, pas le visage
        : item.type === 'SOCKS' ? new THREE.Vector3(0.3, 0.12, 1) // de côté : le motif de la chaussette
        : item.type === 'CYCLING_SHOES' ? new THREE.Vector3(0.75, 0.25, 0.85) : new THREE.Vector3(1, 0.12, 0.5);
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
