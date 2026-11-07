"""
Décors du style réaliste, de la description au .glb du jeu (apps/client/public/models/props) :

  1. image de référence : FLUX.1-schnell (Apache 2.0) dans ComfyUI local (API http://127.0.0.1:8188) ;
  2. maillage à couleurs par sommet : TRELLIS image → 3D (MIT), installation locale (gen.py, décodeur « mesh ») ;
  3. stylize_prop.py (Blender) : taille réelle, posé au sol, version réaliste simplifiée (+ version low poly) ;
  4. vehicles/optimize.mjs --dir props : modèle proche et lointain, quantifiés et compressés (Meshopt).

Usage : python tools/blender/props/make_props.py [noms…] [--from image|trellis|blender] [--seed N]
  sans nom : tout le catalogue (catalogue.json) ; --from reprend à une étape (fichiers de work/ gardés).

Chemins (variables d'environnement) : TRELLIS_DIR (C:/tmp/__DEV__/trellis), BLENDER (Blender 5.2), COMFY (url).
Fichiers de travail : tools/blender/props/work/<nom>/ (hors dépôt).
"""
import json
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
TRELLIS = os.environ.get('TRELLIS_DIR', 'C:/tmp/__DEV__/trellis')
BLENDER = os.environ.get('BLENDER', 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe')
COMFY = os.environ.get('COMFY', 'http://127.0.0.1:8188')
STEPS = ['image', 'trellis', 'blender', 'optimize']

args = sys.argv[1:]
start = args[args.index('--from') + 1] if '--from' in args else 'image'
seed = int(args[args.index('--seed') + 1]) if '--seed' in args else 7
names = [a for i, a in enumerate(args) if not a.startswith('--') and (i == 0 or args[i - 1] not in ('--from', '--seed'))]
cat = json.load(open(os.path.join(HERE, 'catalogue.json'), encoding='utf-8'))
names = names or list(cat['props'])


def comfy(path, body=None):
    req = urllib.request.Request(COMFY + path, data=json.dumps(body).encode() if body is not None else None, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    return json.loads(data) if data[:1] in (b'{', b'[') else data


def image(name, prompt, out):
    graph = {
        '1': {'class_type': 'UNETLoader', 'inputs': {'unet_name': 'flux1-schnell-fp8.safetensors', 'weight_dtype': 'default'}},
        '2': {'class_type': 'DualCLIPLoader', 'inputs': {'clip_name1': 't5xxl_fp8_e4m3fn_scaled.safetensors', 'clip_name2': 'clip_l.safetensors', 'type': 'flux'}},
        '3': {'class_type': 'CLIPTextEncode', 'inputs': {'text': prompt, 'clip': ['2', 0]}},
        '4': {'class_type': 'EmptySD3LatentImage', 'inputs': {'width': 1024, 'height': 1024, 'batch_size': 1}},
        '5': {'class_type': 'KSampler', 'inputs': {'model': ['1', 0], 'seed': seed, 'steps': 4, 'cfg': 1.0, 'sampler_name': 'euler', 'scheduler': 'simple',
                                                    'positive': ['3', 0], 'negative': ['3', 0], 'latent_image': ['4', 0], 'denoise': 1.0}},
        '6': {'class_type': 'VAELoader', 'inputs': {'vae_name': 'ae.safetensors'}},
        '7': {'class_type': 'VAEDecode', 'inputs': {'samples': ['5', 0], 'vae': ['6', 0]}},
        '8': {'class_type': 'SaveImage', 'inputs': {'images': ['7', 0], 'filename_prefix': f'allezrobert/{name}'}},
    }
    pid = comfy('/prompt', {'prompt': graph})['prompt_id']
    deadline = time.time() + 600
    while time.time() < deadline:
        h = comfy(f'/history/{pid}')
        if pid in h:
            st = h[pid].get('status', {})
            if st.get('status_str') == 'error':
                raise RuntimeError(f'ComfyUI : {st}')
            imgs = h[pid]['outputs']['8']['images']
            q = urllib.parse.urlencode({'filename': imgs[0]['filename'], 'subfolder': imgs[0]['subfolder'], 'type': 'output'})
            open(out, 'wb').write(comfy(f'/view?{q}'))
            return
        time.sleep(1)
    raise TimeoutError('ComfyUI : pas de résultat en 10 min')


def run(cmd, **kw):
    print('  $', ' '.join(str(c) for c in cmd[:4]), '…', flush=True)
    subprocess.run(cmd, check=True, **kw)


freed = False
for name in names:
    spec = cat['props'][name]
    work = os.path.join(HERE, 'work', name)
    os.makedirs(work, exist_ok=True)
    ref, raw = os.path.join(work, 'ref.png'), os.path.join(work, 'trellis.glb')
    print(f'== {name}', flush=True)
    t = time.time()
    if STEPS.index(start) <= 0:
        image(name, spec['prompt'] + cat['style'], ref)
        print(f'  image : {time.time() - t:.0f} s', flush=True)
    if STEPS.index(start) <= 1:
        # TRELLIS occupe presque toute la mémoire vidéo : ComfyUI décharge ses modèles avant.
        if not freed:
            try:
                comfy('/free', {'unload_models': True, 'free_memory': True})
            except Exception as err:  # ComfyUI absent : rien à libérer
                print('  /free :', err)
            freed = True
        run([os.path.join(TRELLIS, 'venv', 'Scripts', 'python.exe'), os.path.join(TRELLIS, 'gen.py'), ref, raw, '--seed', '1'], cwd=TRELLIS)
    if STEPS.index(start) <= 2:
        size = ['--height', str(spec['height'])] if 'height' in spec else ['--length', str(spec['length'])]
        run([BLENDER, '-b', '--factory-startup', '-P', os.path.join(HERE, 'stylize_prop.py'), '--', raw, work, name, *size, '--real-faces', '30000'],
            stdout=subprocess.DEVNULL)
    run(['node', os.path.join(HERE, '..', 'vehicles', 'optimize.mjs'), os.path.join(work, f'{name}.real.glb'), name, '--near', str(spec.get('near', 12000)),
         '--far', str(spec.get('far', 2000)), '--dir', 'props'], cwd=os.path.join(HERE, '..'))
    print(f'  {name} prêt en {time.time() - t:.0f} s', flush=True)
