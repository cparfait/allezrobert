import * as THREE from 'three/webgpu';
import { texture } from 'three/tsl';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

/**
 * Textures compressées KTX2 (Basis Universal) : le GPU les garde compressées (BC7/BC1 sur PC, ETC/ASTC
 * sur mobile), 4 à 8 fois moins de mémoire vidéo qu'une image décodée, et rien à décoder sur le fil
 * principal (transcodage dans des workers). Chaque image a son .ktx2 à côté (même nom), produit par
 * tools/blender/textures/to-ktx2.mjs ; s'il manque ou échoue, l'image d'origine est chargée.
 *
 * Les .ktx2 des textures chargées avec flipY (convention WebGL) sont retournés à l'encodage : une
 * texture compressée ne peut pas l'être au chargement.
 */

let ktx2: KTX2Loader | null = null;
let initialized = false;
const pending: LazyTexture[] = [];
let ready!: () => void;
/** Le moteur de rendu est prêt : les formats compressés pris en charge sont connus. */
const rendererReady = new Promise<void>((r) => (ready = r));

/** À appeler une fois le moteur de rendu prêt : les formats compressés dépendent du GPU. */
export function initTextureLoading(renderer: THREE.WebGPURenderer): void {
  if (initialized) return;
  initialized = true;
  // ?ktx2=0 : images d'origine seulement (comparaison de la mémoire vidéo, panneau F3).
  if (new URLSearchParams(location.search).get('ktx2') !== '0') ktx2 = new KTX2Loader().detectSupport(renderer);
  ready();
  for (const t of pending.splice(0)) t.start();
}

export interface TextureOptions {
  colorSpace?: THREE.ColorSpace;
  /** Image d'origine seulement (le .ktx2 n'a pas de flipY) ; défaut de three.js : true. */
  flipY?: boolean;
  wrap?: THREE.Wrapping;
  anisotropy?: number;
}

const ktx2Url = (url: string): string => url.replace(/\.(jpe?g|png|webp)$/i, '.ktx2');

function configure(t: THREE.Texture, o: TextureOptions): THREE.Texture {
  if (o.colorSpace !== undefined) t.colorSpace = o.colorSpace;
  if (o.wrap !== undefined) t.wrapS = t.wrapT = o.wrap;
  if (o.anisotropy !== undefined) t.anisotropy = o.anisotropy;
  return t;
}

/** Charge `url` en KTX2 si possible, sinon l'image d'origine (attend le moteur de rendu). */
export async function loadTexture(url: string, o: TextureOptions = {}): Promise<THREE.Texture> {
  await rendererReady;
  if (ktx2) {
    try {
      return configure(await ktx2.loadAsync(ktx2Url(url)), o);
    } catch {
      // Pas de .ktx2 (ou GPU sans format compatible) : image d'origine.
    }
  }
  const t = await new THREE.TextureLoader().loadAsync(url);
  if (o.flipY !== undefined) t.flipY = o.flipY;
  return configure(t, o);
}

/**
 * Texture partagée déclarée au chargement d'un module, avant le moteur de rendu : chargée dès que
 * celui-ci est prêt. Les nœuds créés par `sample` reçoivent la texture à son arrivée (la liaison GPU
 * suit `TextureNode.value`, le shader ne change pas).
 */
export class LazyTexture {
  private current: THREE.Texture;
  private readonly nodes: THREE.TextureNode[] = [];

  constructor(
    private readonly url: string,
    private readonly options: TextureOptions,
  ) {
    this.current = configure(new THREE.Texture(), options);
    if (initialized) this.start();
    else pending.push(this);
  }

  sample(uvNode: THREE.Node): THREE.TextureNode {
    const n = texture(this.current, uvNode);
    this.nodes.push(n);
    return n;
  }

  /** @internal */
  start(): void {
    void loadTexture(this.url, this.options).then(
      (t) => {
        this.current.dispose();
        this.current = t;
        for (const n of this.nodes) n.value = t;
      },
      (e) => console.warn(`Texture indisponible : ${this.url}`, e),
    );
  }
}
