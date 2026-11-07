import * as THREE from 'three/webgpu';
import {
  Fn,
  float,
  floor,
  fract,
  hash,
  instanceIndex,
  instancedBufferAttribute,
  ivec2,
  mix,
  mod,
  normalLocal,
  attribute,
  positionLocal,
  pow,
  clamp,
  dot,
  texture,
  textureLoad,
  time,
  uv,
  vec2,
  vec3,
  vertexIndex,
  color,
} from 'three/tsl';

/**
 * Spectateurs du style réaliste à partir d'un vrai personnage (tools/blender/crowd/bake_crowd.py) : un seul
 * maillage instancié, chaque spectateur lit sa pose dans une texture d'animation (clip et phase tirés au hasard,
 * interpolation entre deux images) et recolore peau, cheveux, haut et bas d'après le masque de zones
 * (couleur = teinte × (luminance / luminance de référence de la zone)^0,75 : plis, rides et usure gardés).
 *
 * Le placement (zones, orientation, porteurs de pancarte) reste celui de crowd.ts ; ce module ne remplace que la
 * géométrie et le matériau, une fois les fichiers chargés (repli : les capsules).
 */

export interface SpectatorAsset {
  geometry: THREE.BufferGeometry;
  vat: THREE.DataTexture;
  mask: THREE.DataTexture;
  base: THREE.Texture;
  meta: SpectatorMeta;
}

interface SpectatorMeta {
  vertexCount: number;
  indexCount: number;
  tris: number;
  vatRows: number;
  normalRow: number;
  clips: Array<{ name: string; row: number; frames: number; fps: number }>;
  hold: number;
  maskSize: number;
  refLum: { skin: number; hair: number; top: number; bottom: number };
  offsets: { position: number; normal: number; uv: number; index: number; vat: number; mask: number };
}

const BASE = '/models/crowd/spectateur';
let loading: Promise<SpectatorAsset | null> | null = null;

/** Charge le spectateur une fois (null hors navigateur ou si un fichier manque : les capsules restent). */
export function loadSpectator(): Promise<SpectatorAsset | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);
  loading ??= (async () => {
    try {
      const [meta, bin, base] = await Promise.all([
        fetch(`${BASE}.json`).then((r) => (r.ok ? (r.json() as Promise<SpectatorMeta>) : Promise.reject(new Error(r.statusText)))),
        fetch(`${BASE}.bin`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText)))),
        new THREE.TextureLoader().loadAsync(`${BASE}.webp`),
      ]);
      const V = meta.vertexCount;
      const o = meta.offsets;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bin, o.position, V * 3), 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(bin, o.normal, V * 3), 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(bin, o.uv, V * 2), 2));
      geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(bin, o.index, meta.indexCount), 1));
      // Boîte élargie aux bras levés (le maillage bouge dans le nuanceur).
      geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 1.4);
      const vat = new THREE.DataTexture(new Uint16Array(bin, o.vat, V * meta.vatRows * 4), V, meta.vatRows, THREE.RGBAFormat, THREE.HalfFloatType);
      vat.minFilter = vat.magFilter = THREE.NearestFilter;
      vat.needsUpdate = true;
      const ms = meta.maskSize;
      const mask = new THREE.DataTexture(new Uint8Array(bin, o.mask, ms * ms * 4), ms, ms, THREE.RGBAFormat);
      mask.minFilter = THREE.LinearFilter;
      mask.magFilter = THREE.LinearFilter;
      mask.needsUpdate = true;
      base.colorSpace = THREE.SRGBColorSpace;
      base.anisotropy = 4;
      return { geometry, vat, mask, base, meta };
    } catch (err) {
      console.warn('Public : spectateur réaliste indisponible, capsules gardées', err);
      return null;
    }
  })();
  return loading;
}

/** Palettes (sRGB) tirées par spectateur. */
const SKINS = ['#f2c9a8', '#e0ac85', '#c68a62', '#a8734f', '#8d5a3b', '#5b3a26'];
const HAIRS = ['#d8d4cc', '#9a958e', '#1f1a17', '#4a3020', '#7a5232', '#c8a66a', '#9a4a22'];
const TOPS = ['#e63946', '#ffd23f', '#2a9d8f', '#f4f4f4', '#1f6feb', '#3f7a3c', '#b3362c', '#f08a24', '#cdbb94', '#6b4fa0'];
const BOTTOMS = ['#2f3f5c', '#55575c', '#26272b', '#6b4426', '#b9a27c', '#3d4a2e'];

type V3 = ReturnType<typeof vec3>;
type F = ReturnType<typeof float>;

/** Choix dans une palette par paliers d'un hachage (0..1). */
function pick(list: string[], h: F): V3 {
  let c = color(list[0] as string) as unknown as V3;
  for (let i = 1; i < list.length; i++) c = h.greaterThan(i / list.length).select(color(list[i] as string), c) as unknown as V3;
  return c;
}

/**
 * Matériau du public réaliste. `orient` : par spectateur cos et sin de son orientation (lacet) et son échelle ;
 * `still` : 1 pour les porteurs de pancarte (pose tenue, sans animation).
 */
export function spectatorMaterial(asset: SpectatorAsset, orient: Float32Array, still: Float32Array): THREE.MeshStandardNodeMaterial {
  const { meta } = asset;
  const mat = new THREE.MeshStandardNodeMaterial();
  const o = instancedBufferAttribute(new THREE.InstancedBufferAttribute(orient, 3)) as unknown as ReturnType<typeof vec3>;
  const holder = instancedBufferAttribute(new THREE.InstancedBufferAttribute(still, 1)) as unknown as ReturnType<typeof float>;
  const h = hash(instanceIndex.add(5)) as unknown as F;
  const hp = hash(instanceIndex.add(17)) as unknown as F;
  const c0 = meta.clips[0] as SpectatorMeta['clips'][number];
  const c1 = meta.clips[1] ?? c0;
  const second = h.greaterThan(0.5);
  const row0 = second.select(float(c1.row), float(c0.row));
  const frames = second.select(float(c1.frames), float(c0.frames));
  const fps = second.select(float(c1.fps), float(c0.fps));
  // Phase et vitesse propres à chacun ; porteurs : image tenue.
  const t = time.mul(fps).mul(float(0.85).add(hp.mul(0.3))).add(hp.mul(frames));
  const fa = holder.greaterThan(0.5).select(float(meta.hold), row0.add(floor(mod(t, frames))));
  const fb = holder.greaterThan(0.5).select(float(meta.hold), row0.add(mod(floor(t).add(1), frames)));
  const a = holder.greaterThan(0.5).select(float(0), fract(t));
  const vi = float(vertexIndex);
  const at = (row: F) => ivec2(vec2(vi, row));
  const nrm = float(meta.normalRow);

  mat.positionNode = Fn(() => {
    const p = mix(textureLoad(asset.vat, at(fa as unknown as F)).xyz, textureLoad(asset.vat, at(fb as unknown as F)).xyz, a);
    const n = mix(textureLoad(asset.vat, at(fa.add(nrm) as unknown as F)).xyz, textureLoad(asset.vat, at(fb.add(nrm) as unknown as F)).xyz, a).normalize();
    // positionLocal porte déjà la matrice d'instance appliquée au repos : on y ajoute l'écart de pose, tourné
    // et mis à l'échelle comme l'instance (lacet autour de Y, échelle uniforme).
    const d = p.sub(attribute<'vec3'>('position')) as unknown as V3;
    const cs = o.x;
    const sn = o.y;
    const rot = (v: V3) => vec3(v.x.mul(cs).add(v.z.mul(sn)), v.y, v.x.negate().mul(sn).add(v.z.mul(cs)));
    normalLocal.assign(rot(n as unknown as V3));
    return positionLocal.add(rot(d).mul(o.z));
  })();

  // Recoloration par zones.
  const tex = texture(asset.base, uv());
  const m = texture(asset.mask, uv());
  const lum = dot(tex.rgb, vec3(0.2126, 0.7152, 0.0722)) as unknown as F;
  const tint = (c: V3, ref: number) => c.mul(pow(clamp(lum.div(Math.max(ref, 1e-4)), 0, 3), 0.75)) as unknown as V3;
  const skin = pick(SKINS, hash(instanceIndex.add(101)) as unknown as F);
  const hair = pick(HAIRS, hash(instanceIndex.add(202)) as unknown as F);
  const top = pick(TOPS, hash(instanceIndex.add(303)) as unknown as F);
  const bottom = pick(BOTTOMS, hash(instanceIndex.add(404)) as unknown as F);
  let col = tex.rgb as unknown as V3;
  col = mix(col, tint(skin, meta.refLum.skin), m.r as unknown as F) as unknown as V3;
  col = mix(col, tint(hair, meta.refLum.hair), m.g as unknown as F) as unknown as V3;
  col = mix(col, tint(top, meta.refLum.top), m.b as unknown as F) as unknown as V3;
  col = mix(col, tint(bottom, meta.refLum.bottom), m.a as unknown as F) as unknown as V3;
  mat.colorNode = col;
  mat.roughnessNode = float(0.85);
  mat.metalnessNode = float(0);
  return mat;
}
