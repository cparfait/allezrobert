// Piper hébergé chez nous (directeur sportif, apps/client/src/audio/directorVoice.ts) : copie le moteur ONNX installé,
// télécharge le phonétiseur Piper et les voix une fois, dans apps/client/public/piper/ (hors dépôt, ~140 Mo).
// Le jeu ne va plus chercher ces fichiers sur cdnjs, jsDelivr ni Hugging Face. À relancer avant un déploiement web ou
// bureau (docs/DEPLOY.md). Usage : node tools/piper/fetch-piper.mjs
import { copyFile, mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'apps/client/public/piper');
// onnxruntime-web : dépendance du paquet Piper (même version que celle que le jeu embarque), voisine dans node_modules.
const piperDir = await realpath(path.join(root, 'apps/client/node_modules/@mintplex-labs/piper-tts-web'));
const ortDir = path.join(piperDir, '../../onnxruntime-web/dist');

/** Voix servies (mêmes chemins que le dépôt public des voix Piper). */
const VOICES = ['fr/fr_FR/tom/medium/fr_FR-tom-medium.onnx', 'en/en_GB/northern_english_male/medium/en_GB-northern_english_male-medium.onnx'];
const HF = 'https://huggingface.co/diffusionstudio/piper-voices/resolve/main';
const PHONEMIZE = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize';

const exists = (f) => stat(f).then((s) => s.size > 0, () => false);
async function fetchTo(url, file) {
  if (await exists(file)) return console.log('déjà là', path.relative(root, file));
  await mkdir(path.dirname(file), { recursive: true });
  const res = await fetch(url, { headers: { 'User-Agent': 'allezrobert-assets/1' } });
  if (!res.ok) throw new Error(`${url} : HTTP ${res.status}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  console.log('téléchargé', path.relative(root, file), `${((await stat(file)).size / 1e6).toFixed(1)} Mo`);
}

await mkdir(path.join(out, 'ort'), { recursive: true });
for (const f of ['ort-wasm-simd-threaded.wasm']) await copyFile(path.join(ortDir, f), path.join(out, 'ort', f));
console.log('moteur ONNX copié depuis', path.relative(root, ortDir));
for (const ext of ['wasm', 'data']) await fetchTo(`${PHONEMIZE}.${ext}`, path.join(out, `piper_phonemize.${ext}`));
for (const v of VOICES) for (const f of [v, `${v}.json`]) await fetchTo(`${HF}/${f}`, path.join(out, 'voices', f));
