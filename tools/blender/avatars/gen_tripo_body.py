"""
Allez Robert ! — génère un corps de coureur avec l'API Tripo (texte → 3D, puis auto-rig).

Le corps est destiné à recevoir la tête MPFB (curseurs de ressemblance, expressions) : la tête Tripo
sera coupée au cou, d'où la tête simple, le cou dégagé, ni casque ni lunettes.

Étapes :
  1. /v3/generation/text-to-model (H3.1, textures PBR, face_limit) → model.glb + preview.png
  2. /v3/animations/rig-check (gratuit) → doit répondre riggable, biped
  3. /v3/animations/rig (modèle v3.0, spec « unreal » : pelvis, spine_01, thigh_l… comme le
     squelette « game_engine » de l'avatar MPFB) → rigged.fbx

Sorties dans zzModel3D/tripo_body/<nom>/ (hors dépôt, voir .gitignore), avec tripo.json (identifiants
de tâches, requêtes, crédits consommés, dates) pour la provenance (ASSETS_LICENSES.md).

Usage (depuis la racine du dépôt) :
    python -I tools/blender/avatars/gen_tripo_body.py [--name corps_a] [--seed 1] [--style realistic|stylized]
                                                     [--from-task ID] [--dry-run]
  --from-task : saute la génération et rigge une tâche texte → 3D déjà faite.

Clé : variable TRIPO_API_KEY, sinon la variable utilisateur Windows du même nom (posée par setx), jamais
versionnée.
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
API = os.environ.get('TRIPO_API', 'https://openapi.tripo3d.ai/v3').rstrip('/')
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))

STYLE = {
    'realistic': 'Realistic athletic slim build',
    'stylized': 'Stylized semi-realistic animated film style body, athletic slim build',
}
# Même tenue pour tous (maillot gris clair uni, cuissard et accessoires noirs) : build_tripo.py découpe
# les pièces d'après ces couleurs.
OUTFIT = ('Plain short-sleeve cycling jersey in light grey with no logos or patterns, black bib shorts, '
          'fingerless cycling gloves, dark mid-calf socks, black cycling shoes. No helmet, no glasses. Game-ready character.')
BODY = {
    'male': ('an adult male road cyclist', '{style}, realistic adult proportions, long legs, long arms, defined calves '
             'and forearms. Simple realistic head with very short hair, neutral expression, long visible neck.'),
    # Sprinteuse : cuisses et mollets puissants ; cheveux en chignon bas et serré (sous un casque).
    'female': ('an adult female road cyclist', '{style}, realistic adult female proportions, long legs, long arms, '
               'powerful muscular thighs and calves of a track sprinter, toned shoulders and arms. Realistic female face, '
               'neutral expression, dark hair pulled back in a small tight low bun at the nape, long visible neck.'),
}
PROMPT = ('Full body 3D character of {who}, standing in A-pose, arms slightly away from the body, legs straight and '
          'slightly apart, facing forward, no bicycle. {body} ' + OUTFIT)
NEGATIVE = ('bicycle, bike, sitting, logos, text, patterns, helmet, sunglasses, hood, scarf, high collar, '
            'short legs, short arms, cartoon, big eyes')

ap = argparse.ArgumentParser()
ap.add_argument('--name', default='corps_a')
ap.add_argument('--seed', type=int, default=1)
ap.add_argument('--style', default='realistic', choices=list(STYLE))
ap.add_argument('--sex', default='male', choices=list(BODY))
ap.add_argument('--face-limit', type=int, default=50000)
ap.add_argument('--from-task', default='')
ap.add_argument('--dry-run', action='store_true')
# Rig bipède même si rig-check propose « others » (coiffure, accessoires) : le modèle reste un humain en T.
ap.add_argument('--force-biped', action='store_true')
args = ap.parse_args()

GEN = {'model': 'v3.1-20260211', 'prompt': PROMPT.format(who=BODY[args.sex][0], body=BODY[args.sex][1].format(style=STYLE[args.style])), 'negative_prompt': NEGATIVE,
       'texture': True, 'pbr': True, 'texture_quality': 'standard', 'face_limit': args.face_limit,
       'model_seed': args.seed, 'image_seed': args.seed, 'texture_seed': args.seed}
RIG = {'model': 'v3.0-20260909', 'rig_type': 'biped', 'spec': 'unreal', 'out_format': 'fbx'}
assert len(NEGATIVE) <= 255 and len(GEN['prompt']) <= 1024


def api_key():
    key = os.environ.get('TRIPO_API_KEY')
    if not key and sys.platform == 'win32':
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, 'Environment') as k:
                key = winreg.QueryValueEx(k, 'TRIPO_API_KEY')[0]
        except OSError:
            pass
    if not key:
        sys.exit('TRIPO_API_KEY absente : setx TRIPO_API_KEY <clé de https://platform.tripo3d.ai>')
    return key


def call(path, body=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Authorization': f'Bearer {api_key()}', 'Content-Type': 'application/json',
                                          'User-Agent': 'allezrobert-avatars/1'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            res = json.loads(r.read())
    except urllib.error.HTTPError as err:
        sys.exit(f'Tripo {path} : HTTP {err.code} {err.read()[:400].decode(errors="replace")}')
    if res.get('code') != 0:
        sys.exit(f'Tripo {path} : {res}')
    return res['data']


def wait(task, what, minutes=20):
    deadline, last = time.time() + minutes * 60, None
    while time.time() < deadline:
        d = call(f'/tasks/{task}')
        if d['status'] == 'success':
            return d
        if d['status'] in ('failed', 'cancelled', 'banned', 'expired', 'unknown'):
            sys.exit(f'Tripo : {what} {task} {d["status"]} : {json.dumps(d)[:600]}')
        if (d['status'], d.get('progress')) != last:
            last = (d['status'], d.get('progress'))
            print(f'  {what} : {d["status"]} {d.get("progress", 0)} %', flush=True)
        time.sleep(4)
    sys.exit(f'Tripo : {what} {task} sans résultat en {minutes} min')


def download(url, out):
    # Les liens de sortie expirent en quelques minutes : téléchargement immédiat.
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'allezrobert-avatars/1'}),
                                timeout=600) as r:
        open(out, 'wb').write(r.read())
    print(f'  → {os.path.relpath(out, ROOT)} ({os.path.getsize(out) / 1e6:.1f} Mo)')


out = os.path.join(ROOT, 'zzModel3D', 'tripo_body', args.name)
if args.dry_run:
    print(json.dumps({'out': out, 'generation': GEN, 'rig': RIG}, ensure_ascii=False, indent=1))
    sys.exit()
os.makedirs(out, exist_ok=True)
meta_path = os.path.join(out, 'tripo.json')
meta = json.load(open(meta_path, encoding='utf-8')) if os.path.exists(meta_path) else {'api': API}

def save():
    json.dump(meta, open(meta_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

gen_task = args.from_task
if not gen_task:
    gen_task = call('/generation/text-to-model', GEN)['task_id']
    print(f'texte → 3D : tâche {gen_task}', flush=True)
    meta['generation'] = {'task_id': gen_task, 'request': GEN}
    save()
    d = wait(gen_task, 'génération')
    o = d.get('output', {})
    if o.get('model_url'):
        download(o['model_url'], os.path.join(out, 'model.glb'))
    elif o.get('pbr_model_url'):
        download(o['pbr_model_url'], os.path.join(out, 'model.glb'))
    if o.get('rendered_image_url'):
        download(o['rendered_image_url'], os.path.join(out, 'preview.png'))
    meta['generation'].update({k: d.get(k) for k in ('credits_consumed', 'created_at', 'completed_at')})
    save()

check_task = call('/animations/rig-check', {'input': gen_task})['task_id']
d = wait(check_task, 'rig-check', 5)
o = d.get('output', {})
print(f'rig-check : riggable={o.get("riggable")} rig_type={o.get("rig_type")}')
meta['rig_check'] = {'task_id': check_task, 'output': o}
save()
if not o.get('riggable') or (o.get('rig_type') not in (None, 'biped') and not args.force_biped):
    sys.exit('Modèle non riggable en bipède : rig annulé (aucun crédit dépensé pour le rig).')

rig_task = call('/animations/rig', {**RIG, 'input': gen_task})['task_id']
print(f'auto-rig : tâche {rig_task}', flush=True)
meta['rig'] = {'task_id': rig_task, 'request': RIG}
save()
d = wait(rig_task, 'auto-rig')
download(d['output']['model_url'], os.path.join(out, 'rigged.fbx'))
meta['rig'].update({k: d.get(k) for k in ('credits_consumed', 'created_at', 'completed_at')})
save()
print('terminé :', os.path.relpath(out, ROOT))
