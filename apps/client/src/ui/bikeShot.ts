import * as THREE from 'three/webgpu';
import { DEFAULT_LOOK, type AvatarLook } from '@allezrobert/shared';
import { createAvatar, type RiderAvatarLike } from '../rider/gltfAvatar.ts';

/**
 * Photo d'un vélo du catalogue : le vrai modèle 3D (cadre, livrée, roues, pièces), sans coureur, de profil côté transmission,
 * rendu hors écran sur fond transparent sous un éclairage de studio, relu et tonalisé comme les photos des affiches de
 * l'atelier. Sert à fabriquer les miniatures du garage (public/bike-thumbs, voir bike-thumbs.ts) : ce ne sont pas des dessins.
 */

/** Cadre commun à toutes les miniatures : même échelle pour tous les vélos, bas des roues alignés, centré sur chaque vélo. */
export interface BikeFrame {
  halfWidthM: number;
  halfHeightM: number;
}

/** Emprise d'un vélo monté (repère monde : +z devant, y haut). */
export interface BikeBounds {
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/** AgX approché (filmique) puis sRGB : même rendu doux que le jeu. */
const tone = (x: number): number => {
  const y = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
  return Math.round(255 * Math.min(1, Math.max(0, y)) ** (1 / 2.2));
};

export class BikeShooter {
  private readonly studio = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 30);

  /** `environment` : reflets du studio (AtelierHost.studioEnvironment) ; sans, la lumière directe seule. */
  constructor(
    private readonly renderer: THREE.WebGPURenderer,
    environment: THREE.Texture | null,
  ) {
    const s = this.studio;
    if (environment) {
      s.environment = environment;
      s.environmentIntensity = 0.55;
    }
    s.add(new THREE.HemisphereLight(0xfff4e6, 0x4a4036, 0.95));
    const sun = new THREE.DirectionalLight(0xfff1e2, 3.2);
    sun.position.set(-4, 5, 3);
    const back = new THREE.DirectionalLight(0xdfe8ff, 1.5);
    back.position.set(3, 3, -3);
    s.add(sun, back);
  }

  /** Vélo seul, sans ombre, roues et pédalier en place. */
  async mount(look: Partial<AvatarLook>): Promise<{ avatar: RiderAvatarLike; bounds: BikeBounds }> {
    const avatar = createAvatar({ ...DEFAULT_LOOK, ...look });
    (avatar as RiderAvatarLike & { setRiderVisible?(on: boolean): void }).setRiderVisible?.(false);
    avatar.setShadows(false);
    for (let i = 0; i < 4; i++) avatar.update(1 / 60, 0, 0, 'coasting');
    this.studio.add(avatar.root);
    // Textures et décalcomanies de la livrée.
    await new Promise((r) => setTimeout(r, 120));
    avatar.root.updateMatrixWorld(true);
    const bike = avatar.root.getObjectByName('bike') ?? avatar.root;
    const box = new THREE.Box3().setFromObject(bike);
    this.studio.remove(avatar.root);
    return { avatar, bounds: { minY: box.min.y, maxY: box.max.y, minZ: box.min.z, maxZ: box.max.z } };
  }

  /** Photo transparente de `width` × `height` pixels (largeur multiple de 32), vélo centré, vu du côté transmission. */
  async shoot(avatar: RiderAvatarLike, bounds: BikeBounds, frame: BikeFrame, width: number, height: number): Promise<HTMLCanvasElement> {
    const renderer = this.renderer;
    const rt = new THREE.RenderTarget(width, height, { type: THREE.HalfFloatType, samples: 4 });
    const cam = this.camera;
    cam.left = -frame.halfWidthM;
    cam.right = frame.halfWidthM;
    cam.top = frame.halfHeightM;
    cam.bottom = -frame.halfHeightM;
    cam.updateProjectionMatrix();
    // Bas des roues sur la marge basse, centré sur la longueur du vélo ; la caméra regarde vers +x : l'avant (+z) est à droite.
    const cy = bounds.minY + frame.halfHeightM - frame.halfHeightM * 0.04;
    const cz = (bounds.minZ + bounds.maxZ) / 2;
    cam.position.set(-8, cy, cz);
    cam.lookAt(0, cy, cz);
    this.studio.add(avatar.root);
    const prev = renderer.getRenderTarget();
    // Sans MRT : celui de l'atelier ou du jeu, s'il est actif, viderait la photo (shaders sans sortie).
    const prevMrt = renderer.getMRT();
    const clear = renderer.getClearColor(new THREE.Color());
    const clearAlpha = renderer.getClearAlpha();
    renderer.setMRT(null);
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(this.studio, cam);
    renderer.setRenderTarget(prev);
    renderer.setMRT(prevMrt);
    renderer.setClearColor(clear, clearAlpha);
    const px = (await renderer.readRenderTargetPixelsAsync(rt, 0, 0, width, height)) as Uint16Array;
    this.studio.remove(avatar.root);
    rt.dispose();
    const cv = document.createElement('canvas');
    cv.width = width;
    cv.height = height;
    const g = cv.getContext('2d') as CanvasRenderingContext2D;
    const img = g.createImageData(width, height);
    const half = THREE.DataUtils.fromHalfFloat;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const al = Math.min(1, half(px[i + 3] as number));
        if (al <= 0.002) continue;
        // Bords anticrénelés : couleur prémultipliée par la couverture.
        img.data[i] = tone(half(px[i] as number) / al);
        img.data[i + 1] = tone(half(px[i + 1] as number) / al);
        img.data[i + 2] = tone(half(px[i + 2] as number) / al);
        img.data[i + 3] = Math.round(al * 255);
      }
    }
    g.putImageData(img, 0, 0);
    return cv;
  }
}

/** Cadre commun à partir des emprises de tous les vélos : le plus long et le plus haut, avec une marge, au rapport `aspect` (largeur / hauteur). */
export function commonFrame(all: readonly BikeBounds[], aspect: number, margin = 0.06): BikeFrame {
  let halfW = 0;
  let halfH = 0;
  for (const b of all) {
    halfW = Math.max(halfW, (b.maxZ - b.minZ) / 2);
    halfH = Math.max(halfH, (b.maxY - b.minY) / 2);
  }
  halfW *= 1 + margin;
  halfH *= 1 + margin;
  // Le rapport d'image prime : on agrandit la dimension qui manque.
  if (halfW / halfH < aspect) halfW = halfH * aspect;
  else halfH = halfW / aspect;
  return { halfWidthM: halfW, halfHeightM: halfH };
}
