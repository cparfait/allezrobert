/**
 * Portrait du joueur pour l'écran « Prêt à rouler ? » (style Bêta) : son coureur V3, avec sa tenue et son apparence
 * du garage, debout, mains sur les hanches : pose « debout à l'arrêt » (CyclistStandingIdle01).
 * Photographié une fois hors écran par le moteur du jeu (comme les vignettes du vestiaire, v3/thumbnails.ts), puis
 * montré en image : rien ne tourne en continu pendant le chargement.
 */
import * as THREE from 'three/webgpu';
import type { AvatarLook } from '@allezrobert/shared';
import { isCompiling } from '../engine/renderer.ts';
import { V3Visual, readV3Equipment } from '../v3/visuals.ts';

const HEAD = 15;
/** Avant du visage (os des yeux), pour trouver vers où regarde le coureur. */
const FACE = [16, 19] as const;
/** Taille de la photo : largeur multiple de 32 (lignes relues sans remplissage, RGBA demi-flottants). */
export const PORTRAIT_W = 384;
export const PORTRAIT_H = 768;

// AgX approché (filmique) puis sRGB, comme les vignettes du vestiaire.
const tone = (x: number): number => {
  const y = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
  return Math.round(255 * Math.min(1, Math.max(0, y)) ** (1 / 2.2));
};

const v = (): THREE.Vector3 => new THREE.Vector3();
const world = (bone: THREE.Object3D): THREE.Vector3 => bone.getWorldPosition(v());

export interface PortraitOptions {
  renderer: THREE.WebGPURenderer;
  look: AvatarLook;
  environment?: THREE.Texture | null;
  /** Abandon (écran fermé entre-temps). */
  cancelled?: () => boolean;
}

/** Os du coureur V3 chargé dans `root` (nœuds « os_N »). */
function jointsOf(root: THREE.Object3D): Map<number, THREE.Object3D> {
  const joints = new Map<number, THREE.Object3D>();
  root.traverse((node) => {
    const m = /^os_(\d+)$/.exec(node.name);
    if (m) joints.set(Number(m[1]), node);
  });
  return joints;
}

/**
 * Dernière photo prise, repérée par l'apparence et la tenue V3 : prise dès la sortie du garage (`warmRiderPortrait`),
 * elle est prête quand « Prêt à rouler ? » s'ouvre. Une demande pendant la prise attend la même photo.
 */
let cached: { key: string; blob: Promise<Blob | null> } | undefined;

function portraitBlob(o: PortraitOptions): Promise<Blob | null> {
  const key = JSON.stringify([o.look, readV3Equipment()]);
  if (cached?.key === key) return cached.blob;
  const blob = shoot(o).catch((e: unknown) => {
    console.warn('Portrait V3', e);
    return null;
  });
  const entry = { key, blob };
  cached = entry;
  // Échec (coureur pas chargé à temps) : on réessaiera à la prochaine demande.
  void blob.then((b) => {
    if (!b && cached === entry) cached = undefined;
  });
  return blob;
}

/** Prend la photo en avance (sortie du garage), sans l'afficher. */
export function warmRiderPortrait(o: Omit<PortraitOptions, 'cancelled'>): void {
  void portraitBlob(o);
}

/**
 * Photo du coureur du joueur, debout mains sur les hanches, fond transparent : URL d'image (blob, à libérer par
 * l'appelant), ou `null` si le coureur n'a pas pu être chargé à temps (l'écran reste alors sans portrait).
 */
export async function riderPortrait(o: PortraitOptions): Promise<string | null> {
  const blob = await portraitBlob(o);
  if (!blob || o.cancelled?.()) return null;
  return URL.createObjectURL(blob);
}

/** Prise de la photo (voir riderPortrait). Pas d'abandon : la photo partagée sert aussi à la prochaine ouverture. */
async function shoot(o: Omit<PortraitOptions, 'cancelled'>): Promise<Blob | null> {
  const scene = new THREE.Scene();
  scene.environment = o.environment ?? null;
  scene.environmentIntensity = 0.5;
  scene.add(new THREE.HemisphereLight(0xfff4e6, 0x3a3f4a, 1.1));
  const key = new THREE.DirectionalLight(0xfff1e2, 3.2);
  const rim = new THREE.DirectionalLight(0xffd9a0, 2.2);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.9);
  scene.add(key, rim, fill);
  const holder = new THREE.Group();
  scene.add(holder);
  const visual = new V3Visual({ parent: holder, level: () => 0, replace: () => undefined }, () => undefined, (e) => console.warn('Portrait V3', e));
  const target = new THREE.RenderTarget(PORTRAIT_W, PORTRAIT_H, { type: THREE.HalfFloatType, samples: 4 });
  try {
    visual.set(o.look);
    const t0 = performance.now();
    while (!visual.settled) {
      if (performance.now() - t0 > 30_000) return null;
      await new Promise((r) => setTimeout(r, 120));
    }
    // Debout à l'arrêt, mains sur les hanches (première image du clip), sans vélo.
    visual.update(0, 0, 0, 'seated', { clip: 'CyclistStandingIdle01', helmet: true });
    const v3Group = holder.children[0];
    if (!v3Group) return null;
    let riderRoot: THREE.Object3D | undefined;
    for (const child of v3Group.children) {
      let hasBones = false;
      child.traverse((n) => {
        if (/^os_0+$/.test(n.name)) hasBones = true;
      });
      if (hasBones) riderRoot = child;
      else child.visible = false;
    }
    if (!riderRoot) return null;
    scene.updateMatrixWorld(true);
    const joints = jointsOf(riderRoot);
    const head = joints.get(HEAD);
    const eyes = FACE.map((id) => joints.get(id)).filter((b): b is THREE.Object3D => !!b);
    if (!head || eyes.length < 2) return null;
    const ahead = world(eyes[0] as THREE.Object3D).add(world(eyes[1] as THREE.Object3D)).multiplyScalar(0.5).sub(world(head)).setY(0).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const right = ahead.clone().cross(up).normalize();

    // Cadrage : de trois quarts, le coureur tourné vers sa gauche (vers les cartes, à droite de l'écran).
    // Sur la tête, pas sur la boîte du modèle : ses maillages ont une boîte élargie exprès (wideRiderBounds).
    const feet = world(joints.get(0) ?? riderRoot);
    const top = world(head).y + 0.2;
    const height = top - feet.y + 0.08;
    const center = new THREE.Vector3(feet.x, feet.y + height / 2 - 0.03, feet.z);
    const cam = new THREE.PerspectiveCamera(22, PORTRAIT_W / PORTRAIT_H, 0.1, 50);
    const dir = ahead.clone().multiplyScalar(Math.cos(0.5)).addScaledVector(right, Math.sin(0.5)).normalize();
    const distance = (height / 2) / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * 1.06;
    cam.position.copy(center).addScaledVector(dir, distance).addScaledVector(up, 0.35);
    cam.lookAt(center);
    cam.updateProjectionMatrix();
    // Lumière de studio : face avant gauche, contre-jour chaud (le fond de l'écran est éclairé en haut à droite).
    key.position.copy(center).addScaledVector(ahead, 3).addScaledVector(right, 2.5).addScaledVector(up, 3);
    rim.position.copy(center).addScaledVector(ahead, -3).addScaledVector(right, -2).addScaledVector(up, 2.5);
    fill.position.copy(center).addScaledVector(ahead, 2).addScaledVector(right, -3).addScaledVector(up, 0.5);

    // Pas pendant une précompilation des shaders du jeu.
    while (isCompiling()) {
      await new Promise((r) => setTimeout(r, 150));
    }
    await Promise.race([o.renderer.compileAsync(scene, cam), new Promise((r) => setTimeout(r, 6000))]);
    const renderer = o.renderer;
    const prev = renderer.getRenderTarget();
    const prevMrt = renderer.getMRT();
    const clear = renderer.getClearColor(new THREE.Color());
    const clearAlpha = renderer.getClearAlpha();
    renderer.setMRT(null);
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(prev);
    renderer.setMRT(prevMrt);
    renderer.setClearColor(clear, clearAlpha);
    const pixels = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, PORTRAIT_W, PORTRAIT_H)) as Uint16Array;
    const canvas = document.createElement('canvas');
    canvas.width = PORTRAIT_W;
    canvas.height = PORTRAIT_H;
    const context = canvas.getContext('2d') as CanvasRenderingContext2D;
    const image = context.createImageData(PORTRAIT_W, PORTRAIT_H);
    const half16 = THREE.DataUtils.fromHalfFloat;
    for (let i = 0; i < PORTRAIT_W * PORTRAIT_H * 4; i += 4) {
      const alpha = Math.min(1, half16(pixels[i + 3] as number));
      if (alpha <= 0.002) continue;
      image.data[i] = tone(half16(pixels[i] as number) / alpha);
      image.data[i + 1] = tone(half16(pixels[i + 1] as number) / alpha);
      image.data[i + 2] = tone(half16(pixels[i + 2] as number) / alpha);
      image.data[i + 3] = Math.round(alpha * 255);
    }
    context.putImageData(image, 0, 0);
    return await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'));
  } finally {
    visual.dispose();
    target.dispose();
  }
}
