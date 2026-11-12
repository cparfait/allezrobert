"""
Personnage du public avec l'API Tripo (https://developers.tripo3d.ai, payante) : texte → image (modèle « t_pose »),
image → 3D (H3.1, textures PBR), vérification, auto-rig (v1.0, bipède : seul ce rig a les animations « cheer » et
« clap »), animations prédéfinies. Environ 80 crédits (0,80 $) par personnage.

Usage : python tools/blender/crowd/gen_tripo_spectator.py <nom> [<nom>…]   (noms de characters.json)
        python tools/blender/crowd/gen_tripo_spectator.py <nom> --rig-file <modèle.glb>
          (squelette et animations seulement, 45 crédits ; p. ex. après keep_one.py quand l'image montrait deux vues)
Clé : TRIPO_API_KEY (jamais versionnée). Sorties hors dépôt : zzModel3D/tripo_public/<nom>/ (glb animé, images,
tripo_log.json : identifiants de tâches et crédits, à reporter dans ASSETS_LICENSES.md). Puis bake_crowd.py.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
API = os.environ.get('TRIPO_API', 'https://openapi.tripo3d.ai/v3').rstrip('/')
CAT = json.load(open(os.path.join(HERE, 'characters.json'), encoding='utf-8'))


def call(path, body=None):
    key = os.environ.get('TRIPO_API_KEY')
    if not key:
        sys.exit('TRIPO_API_KEY absente')
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json', 'User-Agent': 'allezrobert-crowd/1'})
    # Tripo limite les générations simultanées (HTTP 429) : attente puis nouvel essai (une tâche refusée ne coûte rien).
    for _ in range(90):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                res = json.loads(r.read())
            break
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = int(e.headers.get('Retry-After') or 20)
                print(f'  limite Tripo atteinte, nouvel essai dans {wait} s', flush=True)
                time.sleep(wait)
                continue
            raise RuntimeError(f'{path} : HTTP {e.code} {e.read()[:400].decode(errors="replace")}') from None
    else:
        raise RuntimeError(f'{path} : limite Tripo toujours atteinte après 30 min')
    if res.get('code') != 0:
        raise RuntimeError(f'{path} : {res}')
    return res['data']


CRLF = chr(13) + chr(10)


def upload(path):
    """Envoie un fichier (/files, multipart) ; renvoie son file_token."""
    b = uuid.uuid4().hex
    head = f'--{b}' + CRLF + 'Content-Disposition: form-data; name="file"; filename="' + os.path.basename(path) + '"' + CRLF + 'Content-Type: application/octet-stream' + CRLF + CRLF
    data = head.encode() + open(path, 'rb').read() + (CRLF + f'--{b}--' + CRLF).encode()
    req = urllib.request.Request(API + '/files', data=data, headers={'Authorization': f'Bearer {os.environ["TRIPO_API_KEY"]}',
                                                                      'Content-Type': f'multipart/form-data; boundary={b}', 'User-Agent': 'allezrobert-crowd/1'})
    with urllib.request.urlopen(req, timeout=300) as r:
        res = json.loads(r.read())
    if res.get('code') != 0:
        raise RuntimeError(f'/files : {res}')
    return res['data']['file_token']


def task(name, out, log, label, path, body):
    tid = call(path, body)['task_id']
    print(f'[{name}] {label} : tâche {tid}', flush=True)
    t = time.time()
    while time.time() - t < 1200:
        d = call(f'/tasks/{tid}')
        if d['status'] == 'success':
            entry = {'label': label, 'task_id': tid, 'request': body, 'credits': d.get('credits_consumed'), 'seconds': round(time.time() - t),
                     'output': {k: v for k, v in (d.get('output') or {}).items() if not str(v).startswith('http')}}
            for k, v in (d.get('output') or {}).items():
                if isinstance(v, str) and v.startswith('http'):  # liens valables 5 min : téléchargement immédiat
                    dest = os.path.join(out, f'{label}_{k}{".png" if "image" in k else ".glb"}')
                    with urllib.request.urlopen(v, timeout=300) as r:
                        open(dest, 'wb').write(r.read())
            log['steps'].append(entry)
            json.dump(log, open(os.path.join(out, 'tripo_log.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
            print(f'[{name}] {label} : ok en {entry["seconds"]} s, {entry["credits"]} crédits', flush=True)
            return tid, d
        if d['status'] in ('failed', 'cancelled', 'banned', 'expired', 'unknown'):
            raise RuntimeError(f'{label} : {d}')
        time.sleep(3)
    raise TimeoutError(label)


def generate(name, rig_file=None):
    spec = CAT['characters'][name]
    out = os.path.join(ROOT, 'zzModel3D', 'tripo_public', name)
    os.makedirs(out, exist_ok=True)
    log_path = os.path.join(out, 'tripo_log.json')
    log = json.load(open(log_path, encoding='utf-8')) if rig_file and os.path.exists(log_path) else {'name': name, 'date': time.strftime('%Y-%m-%d'), 'steps': []}
    if rig_file:
        model = upload(rig_file)
        log['steps'].append({'label': 'fichier', 'file': os.path.basename(rig_file)})
    else:
        prompt = f'{CAT["style"]}: {spec["prompt"]} {CAT["negative"]}'
        img, _ = task(name, out, log, 'image', '/generation/text-to-image', {'prompt': prompt, 'model': 'seedream_v4', 'template': 't_pose', 'size': '2K'})
        model, _ = task(name, out, log, 'modele', '/generation/image-to-model',
                        {'input': img, 'model': 'v3.1-20260211', 'texture': True, 'pbr': True, 'texture_quality': 'standard', 'face_limit': 8000,
                         'model_seed': 1, 'texture_seed': 1})
    _, chk = task(name, out, log, 'verif', '/animations/rig-check', {'input': model})
    if not (chk.get('output') or {}).get('riggable', True):
        raise RuntimeError(f'{name} : modèle non riggable')
    rig, _ = task(name, out, log, 'squelette', '/animations/rig', {'input': model, 'model': 'v1.0-20240301', 'rig_type': 'biped', 'spec': 'tripo', 'out_format': 'glb'})
    task(name, out, log, 'animations', '/animations/retarget',
         {'input': rig, 'animations': ['preset:biped:cheer', 'preset:biped:clap'], 'out_format': 'glb', 'animate_in_place': True})
    total = sum(float(s.get('credits') or 0) for s in log['steps'])
    print(f'[{name}] terminé : {total} crédits', flush=True)


if __name__ == '__main__':
    args = sys.argv[1:]
    rig_file = args[args.index('--rig-file') + 1] if '--rig-file' in args else None
    names = [a for i, a in enumerate(args) if not a.startswith('--') and (i == 0 or args[i - 1] != '--rig-file')]
    for n in names:
        if n not in CAT['characters'] or 'prompt' not in CAT['characters'][n]:
            sys.exit(f'personnage inconnu ou sans invite : {n}')
    failed = []
    for n in names:
        try:
            generate(n, rig_file)
        except Exception as err:  # un échec n'arrête pas les suivants
            print(f'[{n}] ÉCHEC : {err}', flush=True)
            failed.append(n)
    if failed:
        sys.exit(f'échecs : {" ".join(failed)}')
