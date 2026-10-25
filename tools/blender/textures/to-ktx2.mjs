/**
 * Conversion des textures du client en KTX2 (Basis Universal), à côté des sources (même nom,
 * extension .ktx2) : le client essaie le .ktx2 d'abord et revient à l'image d'origine s'il manque
 * (apps/client/src/engine/textures.ts). Les sources sont gardées.
 *
 * - Couleurs (albédo, orthophotos) : ETC1S, sRGB, mipmaps. Le GPU les garde compressées
 *   (BC7/BC1 sur PC) : 4 à 8 fois moins de mémoire vidéo qu'un RGBA8.
 * - Normales et masques : UASTC + zstd, linéaires (ETC1S mélange les canaux).
 * - Textures chargées avec flipY (TextureLoader, convention WebGL) : retournées à l'encodage, une
 *   texture compressée ne pouvant pas l'être au chargement.
 *
 * Usage : pnpm --filter @allezrobert/blender-tools ktx2:textures [groupe…] [--force]
 *   groupes : world, avatar, ortho:<monde> (ex. ortho:neuville), ortho:all
 */
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import sharp from 'sharp';
import { encodeToKTX2 } from 'ktx2-encoder';

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), '../../../apps/client/public');

const imageDecoder = async (buffer) => {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
};

/** Couleur : ETC1S sRGB. */
const COLOR = { isUASTC: false, qualityLevel: 200, compressionLevel: 2, isPerceptual: true, isSetKTX2SRGBTransferFunc: true };
/** Normales : UASTC linéaire, préréglage « normal map » de basisu, zstd. */
const NORMAL = { isUASTC: true, needSupercompression: true, isNormalMap: true, isPerceptual: false, isSetKTX2SRGBTransferFunc: false };
/** Données (masques, albédo lu sans conversion par le shader) : UASTC linéaire, zstd. */
const DATA = { isUASTC: true, needSupercompression: true, isPerceptual: false, isSetKTX2SRGBTransferFunc: false };

/** Jobs { src, options } d'un groupe. */
function jobs(group) {
  if (group === 'world') {
    // Textures Poly Haven des routes et du bâti (TextureLoader, flipY). rough.jpg : inutilisé.
    const dir = join(PUBLIC, 'assets/textures');
    return readdirSync(dir).flatMap((d) => [
      { src: join(dir, d, 'diffuse.jpg'), options: { ...COLOR, isYFlip: true } },
      { src: join(dir, d, 'nor_gl.jpg'), options: { ...NORMAL, isYFlip: true } },
    ]);
  }
  if (group === 'avatar') {
    // Convention glTF (flipY = false) et NoColorSpace côté client : tout en linéaire.
    const dir = join(PUBLIC, 'models/avatar');
    return [
      { src: join(dir, 'skin_albedo.webp'), options: DATA },
      { src: join(dir, 'skin_masks.webp'), options: DATA },
      { src: join(dir, 'skin_detail.webp'), options: DATA },
      { src: join(dir, 'cloth_normal.webp'), options: NORMAL },
      { src: join(dir, 'knit_normal.webp'), options: NORMAL },
      { src: join(dir, 'boutique/jersey_mask.webp'), options: DATA },
    ];
  }
  if (group.startsWith('ortho:')) {
    const name = group.slice(6);
    const worlds = name === 'all' ? readdirSync(join(PUBLIC, 'worlds')) : [name];
    return worlds.flatMap((w) => {
      const dir = join(PUBLIC, 'worlds', w, 'tiles');
      if (!existsSync(dir)) return [];
      // Orthophotos décodées en ImageBitmap avec flipY = false (terrain.ts).
      return readdirSync(dir)
        .filter((f) => f.endsWith('.ortho.jpg'))
        .map((f) => ({ src: join(dir, f), options: COLOR }));
    });
  }
  throw new Error(`groupe inconnu : ${group}`);
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const groups = args.filter((a) => !a.startsWith('--'));
const all = (groups.length ? groups : ['world', 'avatar']).flatMap(jobs).filter((j) => existsSync(j.src));
const todo = all.filter((j) => {
  const out = j.src.replace(/\.(jpe?g|png|webp)$/, '.ktx2');
  return force || !existsSync(out) || statSync(out).mtimeMs < statSync(j.src).mtimeMs;
});

let srcBytes = 0;
let outBytes = 0;
let done = 0;
const t0 = performance.now();
// Encodeur WASM sur le fil principal : en parallèle, seul le décodage (sharp) avance pendant un encodage.
const queue = [...todo];
async function worker() {
  for (let job = queue.shift(); job; job = queue.shift()) {
    const out = job.src.replace(/\.(jpe?g|png|webp)$/, '.ktx2');
    const input = new Uint8Array(await sharp(job.src).toBuffer());
    const ktx = await encodeToKTX2(input, { generateMipmap: true, ...job.options, imageDecoder });
    writeFileSync(out, ktx);
    srcBytes += statSync(job.src).size;
    outBytes += ktx.byteLength;
    done++;
    if (done % 50 === 0 || done === todo.length) {
      const s = (performance.now() - t0) / 1000;
      console.log(`${done}/${todo.length}  ${s.toFixed(0)} s  (${(s / done).toFixed(2)} s/texture)`);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(4, Math.max(1, cpus().length >> 1)) }, worker));
console.log(
  `${todo.length} texture(s) converties (${all.length - todo.length} à jour) : ` +
    `${(srcBytes / 1e6).toFixed(1)} Mo → ${(outBytes / 1e6).toFixed(1)} Mo`,
);
