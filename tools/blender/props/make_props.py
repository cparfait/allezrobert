"""
Décors du style réaliste, de la description au .glb du jeu (apps/client/public/models/props) :

  1. image de référence, dans ComfyUI local (API http://127.0.0.1:8188) :
     - depuis une photo (champ « photo » du décor ou --photo) : Qwen Image Edit 2509 (Apache 2.0, LoRA Lightning
       4 pas) isole l'objet de la photo, entier, de trois quarts, sur fond blanc, sans rien changer à sa forme ;
     - sinon depuis le texte (« prompt » + « style ») : FLUX.1-schnell (Apache 2.0) ;
  2. maillage, au choix (--backend) :
     - trellis (défaut) : TRELLIS image → 3D (MIT), installation locale (gen.py), maillage complet à couleurs par
       sommet lues dans ses gaussiennes (--color gaussian), cuites en texture par stylize_prop.py (sans nvdiffrast ni
       rasteriseur de splats, dont les licences se limitent à la recherche) ;
     - tripo : API Tripo (https://developers.tripo3d.ai, payante, en ligne), maillage UV + textures PBR ;
  3. stylize_prop.py (Blender) : taille réelle, posé au sol, version réaliste simplifiée (+ version low poly) ;
  4. vehicles/optimize.mjs --dir props : modèle proche et lointain, quantifiés et compressés (Meshopt).

Usage : python tools/blender/props/make_props.py [noms…] [--from image|mesh|blender|optimize] [--seed N]
                                                [--backend trellis|tripo] [--photo FICHIER] [--until ÉTAPE] [--front] [--dry-run]
  sans nom : tout le catalogue (catalogue.json) ; --from reprend à une étape (fichiers de work/ gardés ;
  « trellis » et « tripo » valent « mesh ») ; --until s'arrête après une étape (--until image : regarder
  work/<nom>/ref.png avant de lancer le maillage). Une image de référence faite ailleurs (FLUX Max, GPT Image…) se
  pose en work/<nom>/ref.png, puis --from mesh.
  --photo : photo de l'objet pour un seul décor (sinon champ « photo » du catalogue, chemin relatif à ce dossier) ;
  la photo doit être la vôtre ou sous licence libre (elle est notée dans work/<nom>/source.json).
  --front : les images passent devant les tâches déjà en attente dans ComfyUI (sans interrompre celle en cours).
  --dry-run : n'exécute rien, affiche pour chaque décor les étapes, la requête Tripo et son coût estimé.

Tripo : clé dans TRIPO_API_KEY (jamais versionnée). Réglages de la requête : bloc « tripo » de catalogue.json
(défauts), complété par le bloc « tripo » de chaque décor. Chaque tâche laisse work/<nom>/tripo.json (identifiant
de tâche, requête, dates, crédits estimés) pour la provenance (ASSETS_LICENSES.md) et tripo_preview.png.

Chemins (variables d'environnement) : TRELLIS_DIR (C:/tmp/__DEV__/trellis), BLENDER (Blender 5.2), COMFY (url),
TRIPO_API (https://openapi.tripo3d.ai/v3), PROPS_CATALOGUE (autre catalogue, pour les essais).
Fichiers de travail : tools/blender/props/work/<nom>/ (hors dépôt).
"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
TRELLIS = os.environ.get('TRELLIS_DIR', 'C:/tmp/__DEV__/trellis')
BLENDER = os.environ.get('BLENDER', 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe')
COMFY = os.environ.get('COMFY', 'http://127.0.0.1:8188')
TRIPO_API = os.environ.get('TRIPO_API', 'https://openapi.tripo3d.ai/v3').rstrip('/')
STEPS = ['image', 'mesh', 'blender', 'optimize']
ALIASES = {'trellis': 'mesh', 'tripo': 'mesh'}
BACKENDS = ('trellis', 'tripo')
# Requête Tripo par défaut (série H, modèle recommandé) ; l'échelle et l'orientation sont réglées par stylize_prop.py.
TRIPO_DEFAULTS = {'model': 'v3.1-20260211', 'texture': True, 'pbr': True, 'texture_quality': 'standard',
                  'face_limit': 30000, 'model_seed': 1, 'texture_seed': 1}

sys.stdout.reconfigure(encoding='utf-8', errors='replace')  # console Windows (cp1252) : ≈, →
args = sys.argv[1:]
VALUED = ('--from', '--seed', '--backend', '--photo', '--until')


def opt(k, d=None):
    return args[args.index(k) + 1] if k in args else d


start = ALIASES.get(opt('--from', 'image'), opt('--from', 'image'))
seed = int(opt('--seed', 7))
backend = opt('--backend', os.environ.get('PROPS_BACKEND', 'trellis'))
dry = '--dry-run' in args
# --front : les tâches ComfyUI de ce script passent devant celles déjà en attente (la tâche en cours n'est pas interrompue).
front = '--front' in args
until = ALIASES.get(opt('--until', 'optimize'), opt('--until', 'optimize'))
for k, v in (('--from', start), ('--until', until)):
    if v not in STEPS:
        sys.exit(f'{k} : {v} inconnu ({", ".join(STEPS)})')
if backend not in BACKENDS:
    sys.exit(f'--backend : {backend} inconnu ({", ".join(BACKENDS)})')
names = [a for i, a in enumerate(args) if not a.startswith('--') and (i == 0 or args[i - 1] not in VALUED)]
cat = json.load(open(os.environ.get('PROPS_CATALOGUE') or os.path.join(HERE, 'catalogue.json'), encoding='utf-8'))
unknown = [n for n in names if n not in cat['props']]
if unknown:
    sys.exit(f'décor inconnu : {", ".join(unknown)} (catalogue : {", ".join(cat["props"])})')
if opt('--photo') and len(names) != 1:
    sys.exit('--photo : nommer un seul décor')
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
    pid = comfy('/prompt', {'prompt': graph, 'front': front})['prompt_id']
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


def comfy_upload(path):
    """Envoie une image dans le dossier d'entrée de ComfyUI ; renvoie son nom pour LoadImage."""
    boundary = uuid.uuid4().hex
    fname = os.path.basename(path)
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="subfolder"\r\n\r\nallezrobert\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{fname}"\r\n'
            f'Content-Type: application/octet-stream\r\n\r\n').encode() + open(path, 'rb').read() + f'\r\n--{boundary}--\r\n'.encode()
    req = urllib.request.Request(COMFY + '/upload/image', data=body, headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
    with urllib.request.urlopen(req, timeout=60) as r:
        res = json.loads(r.read())
    return f'{res["subfolder"]}/{res["name"]}' if res.get('subfolder') else res['name']


# Consigne de Qwen Image Edit : isoler l'objet de la photo sans le réinventer (forme, matières et couleurs gardées).
QWEN_EDIT = ('Image 1 is a photo of {what}. Extract only this object and show it complete, alone and centered as an isolated '
             '3D game asset reference: three-quarter view from slightly above, plain pure white background, soft even '
             'lighting, no cast shadows, no ground, no people, no vehicles, no text, no letters. Keep exactly its shape, '
             'proportions, number of parts, materials, wear and colors; fill in hidden or cropped parts plausibly.')


def wait_comfy(pid, node, out):
    deadline = time.time() + 1800  # la file de ComfyUI peut être partagée avec d'autres travaux
    while time.time() < deadline:
        h = comfy(f'/history/{pid}')
        if pid in h:
            st = h[pid].get('status', {})
            if st.get('status_str') == 'error':
                raise RuntimeError(f'ComfyUI : {st}')
            img = h[pid]['outputs'][node]['images'][0]
            q = urllib.parse.urlencode({'filename': img['filename'], 'subfolder': img['subfolder'], 'type': 'output'})
            open(out, 'wb').write(comfy(f'/view?{q}'))
            return
        time.sleep(1)
    raise TimeoutError('ComfyUI : pas de résultat en 30 min')


def image_from_photo(name, photo, what, out):
    ref = comfy_upload(photo)
    pos = {'clip': ['2', 0], 'prompt': QWEN_EDIT.format(what=what), 'vae': ['3', 0], 'image1': ['21', 0]}
    neg = {'clip': ['2', 0], 'prompt': '', 'vae': ['3', 0], 'image1': ['21', 0]}
    graph = {
        '1': {'class_type': 'UNETLoader', 'inputs': {'unet_name': 'qwen_image_edit_2509_fp8_e4m3fn.safetensors', 'weight_dtype': 'default'}},
        '2': {'class_type': 'CLIPLoader', 'inputs': {'clip_name': 'qwen_2.5_vl_7b_fp8_scaled.safetensors', 'type': 'qwen_image'}},
        '3': {'class_type': 'VAELoader', 'inputs': {'vae_name': 'qwen_image_vae.safetensors'}},
        '4': {'class_type': 'LoraLoaderModelOnly', 'inputs': {'model': ['1', 0], 'lora_name': 'Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors',
                                                              'strength_model': 1.0}},
        '5': {'class_type': 'ModelSamplingAuraFlow', 'inputs': {'model': ['4', 0], 'shift': 3.0}},
        '8': {'class_type': 'TextEncodeQwenImageEditPlus', 'inputs': pos},
        '9': {'class_type': 'TextEncodeQwenImageEditPlus', 'inputs': neg},
        '10': {'class_type': 'EmptySD3LatentImage', 'inputs': {'width': 1024, 'height': 1024, 'batch_size': 1}},
        '11': {'class_type': 'KSampler', 'inputs': {'model': ['5', 0], 'positive': ['8', 0], 'negative': ['9', 0], 'latent_image': ['10', 0],
                                                    'seed': seed, 'steps': 4, 'cfg': 1.0, 'sampler_name': 'euler', 'scheduler': 'simple', 'denoise': 1.0}},
        '12': {'class_type': 'VAEDecode', 'inputs': {'samples': ['11', 0], 'vae': ['3', 0]}},
        '13': {'class_type': 'SaveImage', 'inputs': {'images': ['12', 0], 'filename_prefix': f'allezrobert/{name}_photo'}},
        '21': {'class_type': 'LoadImage', 'inputs': {'image': ref}},
    }
    wait_comfy(comfy('/prompt', {'prompt': graph, 'front': front})['prompt_id'], '13', out)


def tripo_body(spec):
    return {**TRIPO_DEFAULTS, **cat.get('tripo', {}), **spec.get('tripo', {})}


def tripo_credits(body):
    """Crédits estimés d'une tâche image → 3D (grille publique Tripo, 1 crédit = 0,01 $ ; à revérifier, elle change)."""
    c = 30 if body.get('texture', True) or body.get('pbr', True) else 20
    c += {'detailed': 10, 'extreme': 20}.get(body.get('texture_quality'), 0)
    c += 20 if body.get('geometry_quality') == 'detailed' else 0
    c += 5 if body.get('quad') else 0
    c += 10 if body.get('smart_low_poly') else 0
    c += 20 if body.get('generate_parts') else 0
    return c


def tripo(path, body=None, files=None, timeout=60):
    """Appel à l'API Tripo : JSON, ou multipart pour files={'file': (nom, octets, type)} ; renvoie data."""
    key = os.environ.get('TRIPO_API_KEY')
    if not key:
        raise RuntimeError('TRIPO_API_KEY absente (clé de https://platform.tripo3d.ai, à ne pas versionner)')
    headers = {'Authorization': f'Bearer {key}', 'User-Agent': 'allezrobert-props/1'}
    data = None
    if files:
        boundary = uuid.uuid4().hex
        parts = []
        for field, (fname, content, ctype) in files.items():
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"; filename="{fname}"\r\n'
                         f'Content-Type: {ctype}\r\n\r\n'.encode() + content + b'\r\n')
        data = b''.join(parts) + f'--{boundary}--\r\n'.encode()
        headers['Content-Type'] = f'multipart/form-data; boundary={boundary}'
    elif body is not None:
        data = json.dumps(body).encode()
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(TRIPO_API + path, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            res = json.loads(r.read())
    except urllib.error.HTTPError as err:
        raise RuntimeError(f'Tripo {path} : HTTP {err.code} {err.read()[:400].decode(errors="replace")}') from None
    if res.get('code') != 0:
        raise RuntimeError(f'Tripo {path} : {res}')
    return res['data']


def download(url, out):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'allezrobert-props/1'}), timeout=300) as r:
        open(out, 'wb').write(r.read())


def mesh_tripo(ref, raw, body, work):
    token = tripo('/files', files={'file': ('ref.png', open(ref, 'rb').read(), 'image/png')})['file_token']
    task = tripo('/generation/image-to-model', {**body, 'input': token})['task_id']
    print(f'  tâche Tripo {task} (≈ {tripo_credits(body)} crédits)', flush=True)
    deadline, last = time.time() + 900, -1
    while time.time() < deadline:
        d = tripo(f'/tasks/{task}')
        if d['status'] == 'success':
            # Les liens de sortie expirent en 5 min : téléchargement immédiat.
            download(d['output']['model_url'], raw)
            if d['output'].get('rendered_image_url'):
                download(d['output']['rendered_image_url'], os.path.join(work, 'tripo_preview.png'))
            meta = {'task_id': task, 'api': TRIPO_API, 'request': body, 'credits_estimate': tripo_credits(body),
                    'created_at': d.get('created_at'), 'completed_at': d.get('completed_at')}
            json.dump(meta, open(os.path.join(work, 'tripo.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
            return
        if d['status'] in ('failed', 'cancelled', 'banned', 'expired', 'unknown'):
            raise RuntimeError(f'Tripo : tâche {task} {d["status"]} : {d}')
        if d.get('progress', 0) != last:
            last = d.get('progress', 0)
            print(f'  Tripo {d["status"]} {last} %', flush=True)
        time.sleep(3)
    raise TimeoutError(f'Tripo : tâche {task} sans résultat en 15 min')


def run(cmd, **kw):
    print('  $', ' '.join(str(c) for c in cmd[:4]), '…', flush=True)
    subprocess.run(cmd, check=True, **kw)


freed, total = False, 0
first, last = STEPS.index(start), STEPS.index(until)
for name in names:
    spec = cat['props'][name]
    work = os.path.join(HERE, 'work', name)
    ref, raw = os.path.join(work, 'ref.png'), os.path.join(work, f'{backend}.glb')
    photo = opt('--photo') or spec.get('photo')
    if photo and not os.path.isabs(photo) and not os.path.exists(photo):
        photo = os.path.join(HERE, photo)
    print(f'== {name} ({backend})', flush=True)
    if dry:
        print('  étapes :', ', '.join(STEPS[first:last + 1]), f'(image depuis la photo {photo})' if photo and first == 0 else '')
        if backend == 'tripo' and first <= 1:
            body = tripo_body(spec)
            total += tripo_credits(body)
            print(f'  requête Tripo : {json.dumps(body, ensure_ascii=False)} → ≈ {tripo_credits(body)} crédits')
        continue
    os.makedirs(work, exist_ok=True)
    t = time.time()
    if first <= 0:
        if photo:
            if not os.path.exists(photo):
                raise FileNotFoundError(f'photo absente : {photo}')
            image_from_photo(name, photo, spec['prompt'], ref)
            json.dump({'photo': os.path.abspath(photo), 'tool': 'Qwen Image Edit 2509 + Lightning 4 pas', 'seed': seed},
                      open(os.path.join(work, 'source.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        else:
            image(name, spec['prompt'] + cat['style'], ref)
        print(f'  image : {time.time() - t:.0f} s → {ref}', flush=True)
    if last < 1:
        continue
    if first <= 1:
        if not os.path.exists(ref):
            raise FileNotFoundError(f'{ref} absente : lancer depuis --from image ou y poser une image')
        if backend == 'tripo':
            mesh_tripo(ref, raw, tripo_body(spec), work)
        else:
            # TRELLIS occupe presque toute la mémoire vidéo : ComfyUI décharge ses modèles avant.
            if not freed:
                try:
                    comfy('/free', {'unload_models': True, 'free_memory': True})
                except Exception as err:  # ComfyUI absent : rien à libérer
                    print('  /free :', err)
                freed = True
            run([os.path.join(TRELLIS, 'venv', 'Scripts', 'python.exe'), os.path.join(TRELLIS, 'gen.py'), ref, raw, '--seed', '1', '--color', 'gaussian'],
                cwd=TRELLIS)
        print(f'  maillage : {time.time() - t:.0f} s', flush=True)
    if last < 2:
        continue
    if first <= 2:
        if not os.path.exists(raw):
            raise FileNotFoundError(f'{raw} absent : relancer avec --from mesh --backend {backend}')
        size = ['--height', str(spec['height'])] if 'height' in spec else ['--length', str(spec['length'])]
        yaw = ['--yaw', str(spec['yaw'])] if 'yaw' in spec else []
        run([BLENDER, '-b', '--factory-startup', '-P', os.path.join(HERE, 'stylize_prop.py'), '--', raw, work, name, *size, *yaw,
             '--real-faces', '30000'], stdout=subprocess.DEVNULL)
    if last < 3:
        continue
    run(['node', os.path.join(HERE, '..', 'vehicles', 'optimize.mjs'), os.path.join(work, f'{name}.real.glb'), name, '--near', str(spec.get('near', 12000)),
         '--far', str(spec.get('far', 2000)), '--dir', 'props'], cwd=os.path.join(HERE, '..'))
    print(f'  {name} prêt en {time.time() - t:.0f} s', flush=True)
if dry and total:
    print(f'Total Tripo estimé : {total} crédits ≈ {total / 100:.2f} $ (une tentative par décor)')
