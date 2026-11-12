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
  sin,
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
 * Spectateurs du style réaliste à partir de vrais personnages (tools/blender/crowd/bake_crowd.py, liste dans
 * public/models/crowd/index.json) : un maillage instancié par personnage, chaque spectateur lit sa pose dans une texture d'animation (clip et phase tirés au hasard,
 * interpolation entre deux images) et recolore peau, cheveux, haut et bas d'après le masque de zones
 * (couleur = teinte × (luminance / luminance de référence de la zone)^0,75 : plis, rides et usure gardés).
 *
 * Le placement (zones, orientation, porteurs de pancarte) reste celui de crowd.ts ; ce module ne remplace que la
 * géométrie et le matériau, une fois les fichiers chargés (repli : les capsules).
 */

export interface SpectatorAsset {
  name: string;
  /** Fréquence relative dans le public (supporters à pois ou en jaune plus nombreux). */
  weight: number;
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
  weight?: number;
}

const DIR = '/models/crowd';
let loading: Promise<SpectatorAsset[]> | null = null;

/** Personnages lus une fois, d'après index.json (liste vide hors navigateur ou si rien ne charge : les capsules restent). */
export function loadSpectators(): Promise<SpectatorAsset[]> {
  if (typeof document === 'undefined') return Promise.resolve([]);
  loading ??= (async () => {
    let names = ['spectateur'];
    try {
      const r = await fetch(`${DIR}/index.json`);
      if (r.ok) names = ((await r.json()) as { models: string[] }).models;
    } catch {
      // index absent : seul le spectateur d'origine
    }
    const assets = (await Promise.all(names.map(loadOne))).filter((a): a is SpectatorAsset => a !== null);
    // Rien de chargé (serveur injoignable un instant…) : on retentera à la prochaine sortie plutôt que de
    // garder les capsules pour toute la session.
    if (!assets.length) loading = null;
    return assets;
  })();
  return loading;
}

async function loadOne(name: string): Promise<SpectatorAsset | null> {
  const BASE = `${DIR}/${name}`;
  {
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
      // Garde-fou : une animation dont les pieds descendent sous le sol (cuisson ratée, ex. `enfant` à −2,2 m)
      // enfoncerait le personnage ; on l'écarte plutôt que de l'afficher à moitié sous terre.
      const feet = lowestVatY(vat.image.data as Uint16Array, V * meta.normalRow);
      if (feet < -0.25) {
        console.warn(`Public : personnage ${name} écarté, animation sous le sol (${feet.toFixed(2)} m)`);
        return null;
      }
      vat.minFilter = vat.magFilter = THREE.NearestFilter;
      vat.needsUpdate = true;
      const ms = meta.maskSize;
      const mask = new THREE.DataTexture(new Uint8Array(bin, o.mask, ms * ms * 4), ms, ms, THREE.RGBAFormat);
      mask.minFilter = THREE.LinearFilter;
      mask.magFilter = THREE.LinearFilter;
      mask.needsUpdate = true;
      base.colorSpace = THREE.SRGBColorSpace;
      base.anisotropy = 4;
      return { name, weight: meta.weight ?? (name.startsWith('fan_') ? 1.6 : 1), geometry, vat, mask, base, meta };
    } catch (err) {
      console.warn(`Public : personnage ${name} indisponible`, err);
      return null;
    }
  }
}

/** Plus basse hauteur (m) parmi les `count` premiers texels (positions animées, RGBA demi-flottants). */
function lowestVatY(data: Uint16Array, count: number): number {
  let low = Infinity;
  for (let i = 0; i < count; i++) low = Math.min(low, THREE.DataUtils.fromHalfFloat(data[i * 4 + 1] as number));
  return low;
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
 * `still` : 1 pour les porteurs de pancarte (pose tenue, sans animation) ; `seed` : décalage des tirages (un par
 * personnage, sinon le n-ième spectateur de chaque personnage aurait les mêmes couleurs et la même phase).
 */
export function spectatorMaterial(asset: SpectatorAsset, orient: Float32Array, still: Float32Array, seed = 0): THREE.MeshStandardNodeMaterial {
  const { meta } = asset;
  // Deux faces : les maillages simplifiés (1 500 triangles) ont des trous, surtout sur la tête ; sans faces arrière
  // on voyait le ciel à travers (crânes, épaules incomplets).
  const mat = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
  const o = instancedBufferAttribute(new THREE.InstancedBufferAttribute(orient, 3)) as unknown as ReturnType<typeof vec3>;
  const holder = instancedBufferAttribute(new THREE.InstancedBufferAttribute(still, 1)) as unknown as ReturnType<typeof float>;
  const h = hash(instanceIndex.add(5 + seed)) as unknown as F;
  const hp = hash(instanceIndex.add(17 + seed)) as unknown as F;
  const c0 = meta.clips[0] as SpectatorMeta['clips'][number];
  const c1 = meta.clips[1] ?? c0;
  // Clip « clap » (applaudissements à peine visibles de loin) pour un spectateur sur quatre ; les autres acclament.
  const second = h.greaterThan(0.75);
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
    // Porteurs de pancarte (pose tenue) : lent balancement d'un pied sur l'autre, sans mouvement vertical,
    // nul aux pieds et croissant avec la hauteur, pour qu'ils ne restent pas figés.
    const hb = hash(instanceIndex.add(29 + seed)) as unknown as F;
    const isHolder = holder.greaterThan(0.5).select(float(1), float(0));
    const lean = sin(time.mul(float(1.1).add(hb.mul(0.5))).add(hb.mul(17))).mul(0.04).mul(isHolder).mul(p.y.div(1.7));
    return positionLocal.add(rot(d.add(vec3(lean, 0, 0)) as unknown as V3).mul(o.z));
  })();

  // Recoloration par zones.
  const tex = texture(asset.base, uv());
  const m = texture(asset.mask, uv());
  const lum = dot(tex.rgb, vec3(0.2126, 0.7152, 0.0722)) as unknown as F;
  const tint = (c: V3, ref: number) => c.mul(pow(clamp(lum.div(Math.max(ref, 1e-4)), 0, 3), 0.75)) as unknown as V3;
  const skin = pick(SKINS, hash(instanceIndex.add(101 + seed)) as unknown as F);
  const hair = pick(HAIRS, hash(instanceIndex.add(202 + seed)) as unknown as F);
  const top = pick(TOPS, hash(instanceIndex.add(303 + seed)) as unknown as F);
  const bottom = pick(BOTTOMS, hash(instanceIndex.add(404 + seed)) as unknown as F);
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
