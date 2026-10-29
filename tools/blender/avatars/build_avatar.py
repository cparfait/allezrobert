"""
Allez Robert ! — avatar MPFB (docs/AVATARS.md, étapes 2 et 3).

  - corps et tête de base MPFB 2 (maillage hm08), squelette game_engine et ses poids (CC0) ;
  - curseurs de forme (§ 4, packages/shared/src/face.ts) exportés en cibles « nom+ » / « nom− » :
    34 pour le visage (cibles MakeHuman) et 8 pour le corps (macros sexe, âge, poids, muscle,
    origine : écart entre deux humains MPFB, ramené au squelette de base pour ne pas changer la
    taille ni la longueur des membres) ; le client les applique une fois, sur le processeur ;
  - pose de conduite (bassin sur la selle, les deux pieds sur leur pédale en bas, BIND_PHASE, mains aux
    cocottes) appliquée comme pose de repos, cibles comprises : le client calcule sa cinématique
    inverse en écarts à cette pose, comme pour cyclist.glb ;
  - zones de tenue (maillot, bande, cuissard, chaussettes) coupées par plans, ourlets nets ;
  - globes oculaires (aides MPFB) avec iris et pupille ;
  - casque route (coque à aérations, molette, sangles en Y) et lunettes à grand écran modélisés
    sur la tête ; casque chrono et bonnet de cheveux repris de cyclist.glb, recalés sur la
    nouvelle tête ; tous suivent les curseurs (cibles reportées depuis les sommets du corps les
    plus proches) ;
  - chaussures de cyclist.glb posées telles quelles sur les pédales, pied caché retiré
    (avatars/reshoe.mjs, après l'export) ;
  - quantification et compression meshopt (avatars/compress.mjs ; --no-compress pour s'en passer).

Usage (depuis la racine du dépôt) :
    blender -b --factory-startup --python tools/blender/avatars/build_avatar.py -- \\
        [--mpfb chemin/add-on-mpfb-v2.0.18.zip] [--out apps/client/public/models/avatar/]

Pillow doit être importable par le Python de Blender (textures de peau), par exemple :
    <python de Blender> -m pip install --target out/blender-py pillow
    PYTHONPATH=out/blender-py blender -b --factory-startup --python-use-system-env --python …

MPFB (code GPL) n'est qu'un outil de génération : il est installé dans Blender depuis l'archive
officielle d'extensions.blender.org (téléchargée et vérifiée si --mpfb est absent) ; rien de son
code n'est livré avec le jeu. Les données produites (maillage, poids, cibles) sont en CC0.
"""

import argparse
import hashlib
import math
import os
import sys
import shutil
import subprocess
import urllib.request
from importlib import import_module

import bpy  # avant bmesh (module bpy hors de Blender)
import bmesh
import addon_utils
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--mpfb', default='')
ap.add_argument('--out', default='apps/client/public/models/avatar/')
ap.add_argument('--cyclist', default='apps/client/public/models/cyclist.glb')
# Quantification et compression meshopt (avatars/compress.mjs, glTF-Transform : MIT, outil de
# fabrication seulement).
ap.add_argument('--no-compress', action='store_true')
# Variante : « male » (modèle de base) ou « female » (modèle féminin de base, fichiers rider_female*.glb une fois renommés).
ap.add_argument('--variant', default='male', choices=['male', 'female'])
ap.add_argument('--height', type=float, default=-1.0)   # macro MPFB « height » (variante féminine)
ap.add_argument('--cup', type=float, default=-1.0)      # macro MPFB « cupsize »
ap.add_argument('--humerus', type=float, default=-1.0)  # remplace HUMERUS_SCALE
ap.add_argument('--reach', type=float, default=-1.0)     # remplace ARM_REACH
ap.add_argument('--forearm', type=float, default=1.0)   # facteur de longueur de l'avant-bras
ap.add_argument('--neck', type=float, default=3.0)      # intensité de FEMALE_NECK (variante féminine)
ap.add_argument('--glute-flat', type=float, default=-1.0)   # remplace GLUTE_FLAT
ap.add_argument('--glute-start', type=float, default=-1.0)  # remplace GLUTE_START
ap.add_argument('--glute-pelvis', type=float, default=-1.0)  # remplace GLUTE_PELVIS
ap.add_argument('--glute-fold', type=float, default=-1.0)    # remplace GLUTE_FOLD
ap.add_argument('--glute-side', type=float, default=-1.0)    # remplace GLUTE_SIDE
ap.add_argument('--reduce-body', action='store_true')  # corps de près (niveau 0) simplifié à BODY_RATIO (avant le 28/10/2026 : pli en V derrière le genou, facettes aux fesses)
ap.add_argument('--skull', type=float, default=0.8)     # arrière du crâne moins profond (SKULL_BACK), 0 : base MPFB
args = ap.parse_args(argv)
OUT = os.path.abspath(args.out)
os.makedirs(OUT, exist_ok=True)

MPFB_URL = ('https://extensions.blender.org/download/sha256:c075b3e9b94b8e5556a5f03f4653602d02ea306de08126e8f55ed6dee28a2dad/'
            'add-on-mpfb-v2.0.18.zip?repository=%2Fapi%2Fv1%2Fextensions%2F&blender_version_min=4.2.0')
MPFB_SHA256 = 'c075b3e9b94b8e5556a5f03f4653602d02ea306de08126e8f55ed6dee28a2dad'
MPFB_MODULE = 'bl_ext.user_default.mpfb'
PNPM = shutil.which('pnpm') or 'pnpm'

# Cotes du vélo (repère CLIENT : +x gauche, +y haut, +z avant) — identiques à build_cyclist.py.
BB = Vector((0.0, 0.27, 0.0))
CRANK = 0.1725
PEDAL_AXIS_X = 0.072
FOOT_X = 0.105
REST_PITCH = 0.35            # talon levé (rad), comme les pédales de bike_families
# Phase de pédale des deux pieds dans la pose de repos (0 : pédale en bas). Les deux jambes sont
# liées dans la même pose, celle de la jambe gauche d'avant le 29/10/2026 : jusque-là manivelle 0
# (gauche en bas, droite en haut), la fesse droite, liée cuisse pliée, se froissait d'un pli en
# travers dès que la jambe droite descendait, la gauche restait lisse. Liées devant (3π/2), les deux
# fesses se froissaient jambe en bas.
BIND_PHASE = 0.0
ANKLE_FLAT = Vector((0.0, 0.095, -0.13))  # cheville / axe de pédale, pied à plat
HIP = Vector((0.0, 1.02, -0.215))          # centre des hanches, assis sur la selle
HOOD = Vector((0.2, 0.958, 0.54))         # prise des mains sur les cocottes
SOLE = 0.03                               # épaisseur semelle + cale

# Profil du buste (pose_rider), relevé sur des photos de coureurs de profil (screen/) : dos arrondi,
# raide au bassin, presque à plat aux épaules ; oreille à peu près à la hauteur du haut du dos.
SPINE_SHAPE = {'pelvis': 3.0, 'spine_01': 2.0, 'spine_02': 0.0, 'spine_03': -6.0}  # ° autour de l'inclinaison
# Cou, épaules et coudes repris du coureur acheté (build_boutique.py), validés en jeu : cou plus
# redressé (menton non écrasé), épaules avancées et basses (moins carrées), coudes vers l'arrière.
NECK_DEG = 44.0                           # cou au-dessus de l'horizontale (°)
SHOULDER_PROTRACT = 24.0                  # épaules avancées vers le guidon (°, clavicules)
SHOULDER_RAISE = -6.0                     # épaules un peu abaissées (°)
HEAD_PITCH = 8.0                          # tête inclinée vers la route (°)
ARM_REACH = 0.83                          # épaule → poignet / longueur du bras : coudes fléchis
BACK_DAMP = {'sex-': 1.0, 'muscle+': 0.7, 'age+': 0.7}  # atténuation de ces cibles sur le haut du dos (0 à 1)
GLUTE_START = 0.06                        # saillie des fesses comptée à partir de 6 cm derrière l'os du bassin (m)
GLUTE_FLAT = 0.6                          # part de cette saillie supprimée (0 à 1)
GLUTE_PELVIS = 0.0                        # part du poids de cuisse reportée sur le bassin pour le haut des fesses (0 à 1) ; 0 depuis le 28/10/2026 : à 1, le bas de la fesse suit le bassin penché et pointe vers l'arrière
GLUTE_FOLD = 0.19                         # le report s'étend de la hanche jusqu'à ce point sous elle, pli fessier (m)
GLUTE_SIDE = 0.24                         # demi-largeur où le report s'annule (m) : le côté de la hanche reste à la cuisse
HUMERUS_SCALE = 1.28                      # humérus × 1,28 : 0,25 → 0,32 m (adulte de 1,75 m ≈ 0,33 m)
BELLY_DAMP = {'sex-': 0.6}   # atténuation du ventre rentré (déplacement vers le dos) des cibles, 0 à 1
NECK_DAMP = {'sex-': 0.6}                 # atténuation de la cible « sex− » sur le cou (0 à 1)
NECK_KEY_SCALE = {'neckWidth-': 0.5}      # « neckWidth− » : moitié de l'amplitude
# Cou du modèle féminin, d'après des photos de profil : cou plus fin et gorge creusée sous la
# mâchoire (le bas du visage se fondait dans le cou). Cibles MPFB figées dans le maillage de base.
FEMALE_NECK = [('neck/neck-double-decr', 1.0), ('neck/neck-scale-depth-decr', 0.6), ('neck/neck-scale-horiz-decr', 0.4)]
# Arrière du crâne de la base MPFB trop profond (forme de casque, tête nue) : ramené vers l'avant, hommes et femmes.
SKULL_BACK = [('head/head-back-scale-depth-decr', 1.0)]
# Nuque creusée sous l'occiput (m) : la base masculine y fait une pente droite et bombée jusqu'au dos.
NAPE_DEPTH = {'male': 0.014, 'female': 0.0}
ELBOW_POLE = Vector((0.36, 1.05, 0.30))   # direction des coudes (repère client, côté gauche)

# Curseurs de forme (docs/AVATARS.md § 4) : nom → (cibles « + », cibles « − »), chemins relatifs
# à data/targets, éventuellement pondérés (chemin, poids). « l/r- » : les deux côtés.
def _lr(*paths):
    return [f'{d}/{s}-{n}' for d, n in (p.split('/') for p in paths) for s in ('l', 'r')]


SLIDERS = {
    # Visage (34)
    'jawWidth': (['chin/chin-bones-incr'], ['chin/chin-bones-decr']),
    'jawHeight': (['chin/chin-jaw-drop-incr'], ['chin/chin-jaw-drop-decr']),
    'jawAngle': ([('head/head-square', 0.6)], [('head/head-triangular', 0.6)]),
    'chinProtrusion': (['chin/chin-prominent-incr', 'chin/chin-prognathism-incr'], ['chin/chin-prominent-decr', 'chin/chin-prognathism-decr']),
    'chinHeight': (['chin/chin-height-incr'], ['chin/chin-height-decr']),
    'chinWidth': (['chin/chin-width-incr'], ['chin/chin-width-decr', ('chin/chin-triangle', 0.5)]),
    'chinCleft': (['chin/chin-cleft-incr'], ['chin/chin-cleft-decr']),
    'cheekbones': (_lr('cheek/cheek-bones-incr'), _lr('cheek/cheek-bones-decr')),
    'cheekVolume': (_lr('cheek/cheek-volume-incr'), _lr('cheek/cheek-volume-decr')),
    'cheekHeight': (_lr('cheek/cheek-trans-up'), _lr('cheek/cheek-trans-down')),
    'faceFat': (['head/head-fat-incr'], ['head/head-fat-decr']),
    'headWidth': (['head/head-scale-horiz-incr'], ['head/head-scale-horiz-decr']),
    'headLength': (['head/head-scale-vert-incr'], ['head/head-scale-vert-decr']),
    'headDepth': (['head/head-scale-depth-incr', 'head/head-back-scale-depth-incr'], ['head/head-scale-depth-decr', 'head/head-back-scale-depth-decr']),
    'foreheadSlope': (['forehead/forehead-trans-forward'], ['forehead/forehead-trans-backward']),
    'browRidge': ([('forehead/forehead-nubian-incr', 0.6), 'eyebrows/eyebrows-trans-forward'], ['forehead/forehead-nubian-decr', 'eyebrows/eyebrows-trans-backward']),
    'browHeight': (['eyebrows/eyebrows-trans-up'], ['eyebrows/eyebrows-trans-down']),
    'browAngle': (['eyebrows/eyebrows-angle-up'], ['eyebrows/eyebrows-angle-down']),
    'eyeSize': (_lr('eyes/eye-scale-incr'), _lr('eyes/eye-scale-decr')),
    'eyeSpacing': (_lr('eyes/eye-trans-out'), _lr('eyes/eye-trans-in')),
    'eyeHeight': (_lr('eyes/eye-trans-up'), _lr('eyes/eye-trans-down')),
    'eyeTilt': (_lr('eyes/eye-corner1-down', 'eyes/eye-corner2-up'), _lr('eyes/eye-corner1-up', 'eyes/eye-corner2-down')),
    'eyelidFold': (_lr('eyes/eye-epicanthus-in', 'eyes/eye-eyefold-down'), _lr('eyes/eye-epicanthus-out', 'eyes/eye-eyefold-up')),
    'noseLength': (['nose/nose-scale-vert-incr'], ['nose/nose-scale-vert-decr']),
    'noseWidth': (['nose/nose-scale-horiz-incr', 'nose/nose-nostrils-width-incr'], ['nose/nose-scale-horiz-decr', 'nose/nose-nostrils-width-decr']),
    'noseBridge': (['nose/nose-hump-incr', 'nose/nose-width1-incr'], ['nose/nose-hump-decr', 'nose/nose-width1-decr']),
    'noseTip': (['nose/nose-point-up'], [('nose/nose-point-down', 0.5)]),
    'nostrilFlare': (['nose/nose-flaring-incr'], ['nose/nose-flaring-decr']),
    'lipFullness': (['mouth/mouth-upperlip-volume-incr', 'mouth/mouth-lowerlip-volume-incr'], ['mouth/mouth-upperlip-volume-decr', 'mouth/mouth-lowerlip-volume-decr']),
    'mouthWidth': (['mouth/mouth-scale-horiz-incr'], ['mouth/mouth-scale-horiz-decr']),
    'mouthCorners': (['mouth/mouth-angles-up'], ['mouth/mouth-angles-down']),
    'earSize': (_lr('ears/ear-scale-incr', 'ears/ear-scale-vert-incr'), _lr('ears/ear-scale-decr', 'ears/ear-scale-vert-decr')),
    'earAngle': (_lr('ears/ear-flap-incr', 'ears/ear-wing-incr'), _lr('ears/ear-flap-decr', 'ears/ear-wing-decr')),
    'neckWidth': (['neck/measure-neck-circ-incr', 'neck/neck-scale-horiz-incr'], ['neck/measure-neck-circ-decr', 'neck/neck-scale-horiz-decr']),
    # Corps (cibles locales)
    'shoulders': (['torso/measure-shoulder-dist-incr'], ['torso/measure-shoulder-dist-decr']),
}

# Macros de la base et curseurs de corps qui les font varier : nom → {« + » : macros, « − » : macros}.
# Taille et longueur des jambes déplacent les articulations : elles sont traitées par le squelette
# (client), pas par des cibles.
# Homme : cupsize 0,5 = pectoraux neutres de MPFB ; 0 applique la cible « bonnet minimal » qui creuse
# et plisse les pectoraux (une poitrine dessinée sous le maillot).
BASE_MACRO = {'gender': 1.0, 'age': 0.5, 'muscle': 0.55, 'weight': 0.5, 'proportions': 0.5, 'height': 0.5,
              'cupsize': 0.5, 'firmness': 0.5, 'race': {'asian': 0.33, 'caucasian': 0.34, 'african': 0.33}}
MACRO_SLIDERS = {
    'sex': {'-': {'gender': 0.0, 'cupsize': 0.75}},
    'age': {'+': {'age': 0.9}, '-': {'age': 0.37}},          # ≈ 77 ans / ≈ 19 ans (base 25 ans)
    'weight': {'+': {'weight': 0.9}, '-': {'weight': 0.15}},
    'muscle': {'+': {'muscle': 1.0}, '-': {'muscle': 0.15}},
    'originAfrican': {'+': {'race': {'african': 1.0, 'asian': 0.0, 'caucasian': 0.0}}},
    'originAsian': {'+': {'race': {'african': 0.0, 'asian': 1.0, 'caucasian': 0.0}}},
    'originEuropean': {'+': {'race': {'african': 0.0, 'asian': 0.0, 'caucasian': 1.0}}},
}


if args.variant == 'female':
    # Modèle féminin : base entièrement féminine ; le curseur « sex » n'existe plus (ni ses atténuations).
    BASE_MACRO['gender'] = 0.0
    BASE_MACRO['cupsize'] = 0.5
    if args.height >= 0:
        BASE_MACRO['height'] = args.height
    if args.cup >= 0:
        BASE_MACRO['cupsize'] = args.cup
    MACRO_SLIDERS.pop('sex', None)


def bl(v):
    """Repère client → Blender (Z en haut, avant = −Y)."""
    return Vector((v[0], -v[2], v[1]))


def cl(v):
    return Vector((v[0], v[2], -v[1]))


# ---------------------------------------------------------------------------------------------
# MPFB
# ---------------------------------------------------------------------------------------------
def ensure_mpfb():
    if not any(m.__name__ == MPFB_MODULE for m in addon_utils.modules()):
        path = args.mpfb
        if not path:
            path = os.path.join(os.path.abspath('out'), 'avatar-cache', 'add-on-mpfb-v2.0.18.zip')
            if not os.path.isfile(path):
                os.makedirs(os.path.dirname(path), exist_ok=True)
                print('Téléchargement de MPFB…')
                urllib.request.urlretrieve(MPFB_URL, path)
        with open(path, 'rb') as f:
            if hashlib.sha256(f.read()).hexdigest() != MPFB_SHA256:
                raise SystemExit(f'Empreinte inattendue pour {path}')
        bpy.ops.extensions.package_install_files(filepath=path, repo='user_default', enable_on_install=True)
    addon_utils.enable(MPFB_MODULE, default_set=True)
    return (import_module(MPFB_MODULE + '.services.humanservice').HumanService,
            import_module(MPFB_MODULE + '.services.targetservice').TargetService,
            import_module(MPFB_MODULE + '.services.locationservice').LocationService)


def set_active(ob):
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def vgroup_members(ob, name, threshold=0.5):
    g = ob.vertex_groups.get(name)
    if g is None:
        return set()
    out = set()
    for v in ob.data.vertices:
        for ge in v.groups:
            if ge.group == g.index and ge.weight >= threshold:
                out.add(v.index)
    return out


# Expressions ARKit (docs/AVATARS.md § 5), recréées à partir des unités d'expression MakeHuman
# (CC0, moyenne des trois variantes d'origine) : nom → [(unité, poids)], masque. Masques : côté
# gauche / droit du coureur (+X / −X), moitié haute / basse de la bouche. Les formes sans unité
# (mâchoire latérale et en avant, bouche latérale, joues gonflées, regard) sont scriptées
# (expression_shapes), langue tirée comprise.
EXPRESSIONS = {
    'browDownLeft': ([('eyebrows-left-down', 1)], None),
    'browDownRight': ([('eyebrows-right-down', 1)], None),
    'browInnerUp': ([('eyebrows-left-inner-up', 1), ('eyebrows-right-inner-up', 1)], None),
    'browOuterUpLeft': ([('eyebrows-left-extern-up', 1)], None),
    'browOuterUpRight': ([('eyebrows-right-extern-up', 1)], None),
    'cheekSquintLeft': ([('eye-left-slit', 0.5), ('mouth-corner-puller', 0.3)], 'cheekL'),
    'cheekSquintRight': ([('eye-right-slit', 0.5), ('mouth-corner-puller', 0.3)], 'cheekR'),
    'eyeBlinkLeft': ([('eye-left-closure', 1)], None),
    'eyeBlinkRight': ([('eye-right-closure', 1)], None),
    'eyeSquintLeft': ([('eye-left-slit', 0.7)], None),
    'eyeSquintRight': ([('eye-right-slit', 0.7)], None),
    'eyeWideLeft': ([('eye-left-opened-up', 1)], None),
    'eyeWideRight': ([('eye-right-opened-up', 1)], None),
    'jawOpen': ([('mouth-open', 1)], None),
    'mouthClose': ([('mouth-compression', 0.6)], None),
    'mouthFunnel': ([('mouth-protusion', 0.7), ('mouth-eversion', 0.5)], None),
    'mouthPucker': ([('mouth-pursing', 1)], None),
    'mouthSmileLeft': ([('mouth-corner-puller', 1)], 'L'),
    'mouthSmileRight': ([('mouth-corner-puller', 1)], 'R'),
    'mouthFrownLeft': ([('mouth-depression', 1)], 'L'),
    'mouthFrownRight': ([('mouth-depression', 1)], 'R'),
    'mouthDimpleLeft': ([('mouth-retraction', 0.7)], 'L'),
    'mouthDimpleRight': ([('mouth-retraction', 0.7)], 'R'),
    'mouthStretchLeft': ([('mouth-depression-retraction', 1), ('neck-platysma', 0.4)], 'L'),
    'mouthStretchRight': ([('mouth-depression-retraction', 1), ('neck-platysma', 0.4)], 'R'),
    'mouthRollLower': ([('mouth-compression', 0.8)], 'lower'),
    'mouthRollUpper': ([('mouth-compression', 0.8)], 'upper'),
    'mouthShrugLower': ([('mouth-elevation', 1)], 'lower'),
    'mouthShrugUpper': ([('mouth-elevation', 1)], 'upper'),
    'mouthPressLeft': ([('mouth-compression', 1)], 'L'),
    'mouthPressRight': ([('mouth-compression', 1)], 'R'),
    'mouthLowerDownLeft': ([('mouth-parling', 1)], 'lowerL'),
    'mouthLowerDownRight': ([('mouth-parling', 1)], 'lowerR'),
    'mouthUpperUpLeft': ([('mouth-upward-retraction', 1)], 'upperL'),
    'mouthUpperUpRight': ([('mouth-upward-retraction', 1)], 'upperR'),
    'noseSneerLeft': ([('nose-left-elevation', 1)], None),
    'noseSneerRight': ([('nose-right-elevation', 1)], None),
}


MOUTH = []  # centre des lèvres (pose debout), pour l'intérieur de la bouche
LASHES = ('helper-l-eyelashes-1', 'helper-l-eyelashes-2', 'helper-r-eyelashes-1', 'helper-r-eyelashes-2')


def LASH_GROUPS_MEMBERS(ob, upper_only=True):
    """Cils du haut : sommets des aides de cils au-dessus du centre de chaque œil."""
    out = set()
    for g in LASHES:
        idx = vgroup_members(ob, g)
        if not idx or not upper_only:
            out |= idx
            continue
        zc = sum(ob.data.vertices[i].co.z for i in idx) / len(idx)
        out |= {i for i in idx if ob.data.vertices[i].co.z > zc + 0.0015}
    return out


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def expression_shapes(body, TS, LS):
    """Ajoute les formes ARKit au corps (pose debout, avant la pose de course)."""
    units = os.path.join(LS.get_mpfb_data('targets'), 'expression', 'units')
    basis = body.data.shape_keys.key_blocks['Basis']
    base = [d.co.copy() for d in basis.data]
    head_w = [0.0] * len(base)
    g = body.vertex_groups.get('head')
    for v in body.data.vertices:
        for ge in v.groups:
            if g and ge.group == g.index:
                head_w[v.index] = ge.weight
    eye_idx = {s: sorted(vgroup_members(body, f'helper-{s}-eye')) for s in ('l', 'r')}
    eye_c = {s: sum((base[i] for i in idx), Vector()) / len(idx) for s, idx in eye_idx.items()}

    def unit_delta(name, w):
        for o in ('african', 'asian', 'caucasian'):
            TS.load_target(body, os.path.join(units, o, name + '.target.gz'), weight=w / 3, name='tmp_' + o + name)
        k = body.shape_key_add(name='tmp_mix', from_mix=True)
        d = [k.data[i].co - base[i] for i in range(len(base))]
        for kb in list(body.data.shape_keys.key_blocks):
            if kb.name.startswith('tmp_'):
                body.shape_key_remove(kb)
        return d

    # Repères : centre de la bouche (lèvres pincées), commissures (sourire).
    pur = unit_delta('mouth-pursing', 1)
    wsum = sum(d.length for d in pur)
    mouth = sum((base[i] * pur[i].length for i in range(len(base))), Vector()) / wsum
    MOUTH[:] = [mouth]
    print(f'bouche {tuple(round(c, 3) for c in mouth)}, yeux {tuple(round(c, 3) for c in eye_c["l"])}')

    def mask(kind, co):
        if kind is None:
            return 1.0
        side = smoothstep(mouth.x - 0.008, mouth.x + 0.008, co.x)
        up = smoothstep(mouth.z - 0.004, mouth.z + 0.004, co.z)
        cheek = smoothstep(mouth.z - 0.005, mouth.z + 0.02, co.z)
        return {'L': side, 'R': 1 - side, 'upper': up, 'lower': 1 - up, 'upperL': up * side, 'upperR': up * (1 - side),
                'lowerL': (1 - up) * side, 'lowerR': (1 - up) * (1 - side), 'cheekL': cheek * side, 'cheekR': cheek * (1 - side)}[kind]

    def add(name, delta):
        k = body.shape_key_add(name=name, from_mix=False)
        for i, d in enumerate(delta):
            k.data[i].co = base[i] + d
        k.value = 0.0

    for name, (parts, kind) in EXPRESSIONS.items():
        tot = [Vector() for _ in base]
        for u, w in parts:
            for i, d in enumerate(unit_delta(u, w)):
                tot[i] += d
        add(name, [d * mask(kind, base[i]) for i, d in enumerate(tot)])

    # Mâchoire : tout ce qui est sous la bouche et devant les oreilles, sur la tête.
    jaw = [head_w[i] * smoothstep(mouth.z - 0.004, mouth.z - 0.03, c.z) * smoothstep(eye_c['l'].y + 0.1, eye_c['l'].y + 0.06, c.y)
           for i, c in enumerate(base)]
    add('jawForward', [Vector((0, -0.006, 0)) * w for w in jaw])
    add('jawLeft', [Vector((0.007, 0, 0)) * w for w in jaw])
    add('jawRight', [Vector((-0.007, 0, 0)) * w for w in jaw])
    lips = [head_w[i] * math.exp(-((c - mouth).length / 0.022) ** 2) for i, c in enumerate(base)]
    add('mouthLeft', [Vector((0.008, 0, 0)) * w for w in lips])
    add('mouthRight', [Vector((-0.008, 0, 0)) * w for w in lips])
    # Joues gonflées : bosse le long de la normale autour des deux joues.
    nrm = [v.normal.copy() for v in body.data.vertices]
    cheeks = [mouth + Vector((s * 0.03, 0.012, 0.012)) for s in (1, -1)]
    add('cheekPuff', [nrm[i] * 0.009 * head_w[i] * max(math.exp(-((c - ch).length / 0.02) ** 2) for ch in cheeks) for i, c in enumerate(base)])
    # Langue tirée : bouche ouverte, la langue (aide MakeHuman gardée dans le corps) glisse vers l'avant,
    # pointe plus loin et un peu abaissée.
    tongue = sorted(vgroup_members(body, 'helper-tongue'))
    if tongue:
        ty = [base[i].y for i in tongue]
        tip, rear = min(ty), max(ty)
        out_d = unit_delta('mouth-open', 0.55)
        for i in tongue:
            w = smoothstep(rear, tip, base[i].y)
            out_d[i] += Vector((0, -0.012 - 0.038 * w, -0.002 - 0.009 * w))
        add('tongueOut', out_d)
    # Regard : rotation des globes autour de leur centre, paupières qui suivent un peu.
    lids_up = {s: unit_delta(f'eye-{n}-opened-up', 0.3) for s, n in (('l', 'left'), ('r', 'right'))}
    lids_dn = {s: unit_delta(f'eye-{n}-closure', 0.35) for s, n in (('l', 'left'), ('r', 'right'))}
    for s, side in (('l', 'Left'), ('r', 'Right')):
        inward = -1 if s == 'l' else 1  # vers le nez
        for look, rot, lids in (('Up', Matrix.Rotation(math.radians(18), 3, 'X'), lids_up[s]),
                                ('Down', Matrix.Rotation(math.radians(-20), 3, 'X'), lids_dn[s]),
                                ('In', Matrix.Rotation(math.radians(22 * inward), 3, 'Z'), None),
                                ('Out', Matrix.Rotation(math.radians(-22 * inward), 3, 'Z'), None)):
            delta = list(lids) if lids else [Vector() for _ in base]
            for i in eye_idx[s]:
                delta[i] = rot @ (base[i] - eye_c[s]) + eye_c[s] - base[i]
            add(f'eyeLook{look}{side}', delta)


def flatten_glutes(body, base_m):
    """Fesses moins proéminentes : la base MPFB a des fessiers très arrondis, qui font une grosse
    saillie derrière la selle sur un coureur penché. Les sommets de l'arrière du bassin (au-delà de
    GLUTE_START derrière l'os du bassin) sont ramenés vers l'avant de GLUTE_FLAT × leur saillie, de
    la même quantité dans toutes les cibles (la base et les curseurs gardent leurs écarts)."""
    pel = base_m['pelvis'][0].translation
    mw = body.matrix_world
    imw = mw.inverted()
    blocks = list(body.data.shape_keys.key_blocks)
    basis = blocks[0]
    g_start = args.glute_start if args.glute_start >= 0 else GLUTE_START
    g_flat = args.glute_flat if args.glute_flat >= 0 else GLUTE_FLAT
    shifts = []
    peak = 0.0
    for v in basis.data:
        c = mw @ v.co
        dz = (c.z - pel.z) / 0.12                      # hauteur : de 12 cm sous l'os à 0
        h = max(0.0, min(1.0, 1.0 + dz)) * max(0.0, min(1.0, (0.06 - (c.z - pel.z)) / 0.05)) if c.z < pel.z + 0.06 else 0.0
        side = max(0.0, min(1.0, (0.24 - abs(c.x)) / 0.08))
        prot = max(0.0, c.y - (pel.y + g_start))
        peak = max(peak, prot * h * side)
        shifts.append(Vector((0.0, -g_flat * prot * h * side, 0.0)))
    print(f'fessiers : saillie maximale {100 * peak:.1f} cm, ramenée de {100 * g_flat * peak:.1f} cm')
    for kb in blocks:
        for d, sh in zip(kb.data, shifts):
            d.co = d.co + imw.to_3x3() @ sh
    body.data.update()


def stabilize_glutes(body, rig):
    """Fessiers qui restent des fessiers : dans la base MPFB le haut de la fesse est surtout porté par
    la cuisse. À la flexion de hanche de la position de course (~100°) et à chaque coup de pédale, la
    fesse de la jambe levée est tirée vers l'avant et s'écrase en diagonale, celle de l'autre côté
    gonfle (collage linéaire des poids). Le poids des cuisses est donc reporté sur le bassin
    (GLUTE_PELVIS, 0 à 1) pour les sommets de l'arrière du bassin, de la hanche jusqu'au pli fessier ;
    au-dessous, la cuisse garde ses poids (le pli se plie comme un vrai pli)."""
    g_pelvis = args.glute_pelvis if args.glute_pelvis >= 0 else GLUTE_PELVIS
    g_fold = args.glute_fold if args.glute_fold >= 0 else GLUTE_FOLD
    g_side = args.glute_side if args.glute_side >= 0 else GLUTE_SIDE
    if g_pelvis <= 0 or 'pelvis' not in body.vertex_groups:
        return
    mw = body.matrix_world
    bones = rig.data.bones
    hip = rig.matrix_world @ bones['thigh_l'].head_local
    pelvis_idx = body.vertex_groups['pelvis'].index
    thigh_idx = {g.index for g in body.vertex_groups if g.name.startswith('thigh_')}
    moved = 0
    for v in body.data.vertices:
        c = mw @ v.co
        up = smoothstep(hip.z - g_fold, hip.z - g_fold + 0.09, c.z)
        back = smoothstep(hip.y - 0.01, hip.y + 0.05, c.y)
        side = 1.0 - smoothstep(g_side - 0.07, g_side, abs(c.x))
        f = g_pelvis * up * back * side
        if f <= 1e-4:
            continue
        w_th = sum(ge.weight for ge in v.groups if ge.group in thigh_idx)
        if w_th <= 0:
            continue
        w_pel = next((ge.weight for ge in v.groups if ge.group == pelvis_idx), 0.0)
        for ge in list(v.groups):
            if ge.group in thigh_idx:
                body.vertex_groups[ge.group].add([v.index], ge.weight * (1.0 - f), 'REPLACE')
        body.vertex_groups[pelvis_idx].add([v.index], w_pel + w_th * f, 'REPLACE')
        moved += 1
    print(f'fessiers : poids de cuisse reporté sur le bassin pour {moved} sommets')


def hollow_nape(body, base_m, depth):
    """Nuque creusée : les sommets de l'arrière du cou, entre la base du cou et la base du crâne,
    sont avancés au plus de `depth` (vers le milieu du cou) ; même déplacement dans toutes les cibles."""
    if depth <= 0:
        return
    nk = base_m['neck_01'][0].translation
    hd = base_m['head'][0].translation
    mw = body.matrix_world
    imw = mw.inverted()
    blocks = list(body.data.shape_keys.key_blocks)
    shifts = []
    n = 0
    for v in blocks[0].data:
        c = mw @ v.co
        t = (c.z - nk.z) / max(hd.z - nk.z, 1e-6)
        if not 0.0 < t < 1.0:
            shifts.append(None)
            continue
        axis_y = nk.y + (hd.y - nk.y) * t
        prof = math.sin(math.pi * t ** 0.75) ** 1.5             # maximum aux deux tiers de la hauteur
        back = smoothstep(0.0, 0.03, c.y - axis_y)               # +Y : vers le dos
        side = max(0.0, min(1.0, (0.075 - abs(c.x)) / 0.045))
        w = prof * back * side
        n += w > 0.05
        shifts.append(Vector((0.0, -depth * w, 0.0)) if w > 0 else None)
    print(f'nuque : {n} sommets, creusée de {100 * depth:.1f} cm au plus')
    for kb in blocks:
        for d, sh in zip(kb.data, shifts):
            if sh is not None:
                d.co = d.co + imw.to_3x3() @ sh
    body.data.update()


# ---------------------------------------------------------------------------------------------
# Corps de base, curseurs, aides
# ---------------------------------------------------------------------------------------------
def build_base(HS, TS, LS):
    def macro_coords(over):
        """Sommets (maillage complet, aides comprises) d'un humain aux macros de base modifiées,
        et repères de repos de ses os (squelette recalé par MPFB sur cette morphologie)."""
        m = dict(BASE_MACRO, **over)
        h = HS.create_human(macro_detail_dict=m)
        r = HS.add_builtin_rig(h, 'game_engine', import_weights=False)
        TS.bake_targets(h)
        co = [v.co.copy() for v in h.data.vertices]
        mats = {b.name: (r.matrix_world @ b.matrix_local, b.length) for b in r.data.bones}
        mw = h.matrix_world.copy()
        for o in (h, r):
            bpy.data.objects.remove(o, do_unlink=True)
        return [mw @ c for c in co], mats

    base_co = macro_coords({})
    macro_keys = {name + sign: macro_coords(over) for name, sides in MACRO_SLIDERS.items() for sign, over in sides.items()}
    body = HS.create_human(macro_detail_dict=dict(BASE_MACRO))
    rig = HS.add_builtin_rig(body, 'game_engine', import_weights=True)
    # Macros figées dans le maillage de base : les cibles des curseurs s'y ajoutent.
    TS.bake_targets(body)
    targets_dir = LS.get_mpfb_data('targets')
    base_fix = [(p, w * args.skull) for p, w in SKULL_BACK if args.skull > 0]
    if args.variant == 'female' and args.neck > 0:
        base_fix += [(p, w * args.neck) for p, w in FEMALE_NECK]
    if base_fix:
        for p, w in base_fix:
            TS.load_target(body, os.path.join(targets_dir, p + '.target.gz'), weight=w, name='fix_' + os.path.basename(p))
        TS.bake_targets(body)
    for name, (plus, minus) in SLIDERS.items():
        for sign, paths in (('+', plus), ('-', minus)):
            for p in paths:
                p, w = p if isinstance(p, tuple) else (p, 1.0)
                TS.load_target(body, os.path.join(targets_dir, p + '.target.gz'), weight=w, name='tmp_' + os.path.basename(p))
            key = body.shape_key_add(name=name + sign, from_mix=True)
            key.value = 0.0
            for kb in list(body.data.shape_keys.key_blocks):
                if kb.name.startswith('tmp_'):
                    body.shape_key_remove(kb)
    # Cou : un cou très fin et long fait « tortue » de profil sur un coureur penché ; la cible
    # « neckWidth− » est atténuée (NECK_KEY_SCALE).
    kbs = body.data.shape_keys.key_blocks
    for kname, k_scale in NECK_KEY_SCALE.items():
        if kname in kbs:
            for d, b0 in zip(kbs[kname].data, kbs['Basis'].data):
                d.co = b0.co + (d.co - b0.co) * k_scale
    # Curseurs de corps : écart entre l'humain aux macros modifiées et celui de base, ramené au
    # squelette de base. Chaque sommet est replacé par l'inverse des déplacements de ses os
    # (mélange linéaire selon ses poids) : la cible garde la forme (gras, muscles, silhouette)
    # sans changer la taille ni la longueur des membres, que la pose de course fige.
    basis = body.data.shape_keys.key_blocks['Basis']
    gname = {g.index: g.name for g in body.vertex_groups}
    weights = []
    for v in body.data.vertices:
        ws = [(gname[ge.group], ge.weight) for ge in v.groups if gname[ge.group] in rig.data.bones and ge.weight > 0]
        tot = sum(w for _, w in ws) or 1.0
        weights.append([(n, w / tot) for n, w in ws])
    base_m = base_co[1]
    imw = body.matrix_world.inverted()

    def belly_zone(c):
        """0 à 1 : face avant du torse, de la taille à la poitrine (ventre, dessous de la poitrine)."""
        lo = base_m['pelvis'][0].translation.z
        hi = base_m['spine_03'][0].translation.z + 0.05
        mid = base_m['spine_03'][0].translation.y
        t = (c.z - lo) / max(hi - lo, 1e-6)
        h = min(max(t * 4.0, 0.0), 1.0) * min(max((1.0 - t) * 4.0, 0.0), 1.0)
        front = min(max((mid - 0.01 - c.y) / 0.03, 0.0), 1.0)
        side = min(max((0.20 - abs(c.x)) / 0.08, 0.0), 1.0)
        return h * front * side

    def neck_zone(c):
        """0 à 1 : cou (de la base à la base du crâne), tout autour."""
        lo = base_m['neck_01'][0].translation.z - 0.03
        hi = base_m['head'][0].translation.z + 0.02
        t = (c.z - lo) / max(hi - lo, 1e-6)
        return min(max(t * 5.0, 0.0), 1.0) * min(max((1.0 - t) * 5.0, 0.0), 1.0) * min(max((0.14 - abs(c.x)) / 0.04, 0.0), 1.0)

    def back_zone(c):
        """0 à 1 : haut du dos (omoplates, trapèzes, base de la nuque), côté dos, près du plan médian.
        La morphologie féminine y arrondit et remonte le dos ; le squelette est celui de la base
        (pose de course fixe) : on y atténue la cible pour garder un dos plat, incliné."""
        lo = base_m['spine_02'][0].translation.z
        hi = base_m['neck_01'][0].translation.z + 0.06
        mid = base_m['spine_03'][0].translation.y
        t = (c.z - lo) / max(hi - lo, 1e-6)
        h = min(max(t * 4.0, 0.0), 1.0) * min(max((1.0 - t) * 6.0, 0.0), 1.0)
        back = min(max((c.y - mid) / 0.03, 0.0), 1.0)
        side = min(max((0.26 - abs(c.x)) / 0.08, 0.0), 1.0)
        return h * back * side

    for name, (co, mats) in macro_keys.items():
        inv = {}
        for bn, (m1, l1) in mats.items():
            m0, l0 = base_m[bn]
            s_ = l0 / max(l1, 1e-6)
            inv[bn] = m0 @ Matrix.Scale(s_, 4) @ m1.inverted()
        k = body.shape_key_add(name=name, from_mix=False)
        for i, (d, b0, c0, c1) in enumerate(zip(k.data, basis.data, base_co[0], co)):
            ws = weights[i]
            back = sum(((inv[n] @ c1) * w for n, w in ws), Vector()) if ws else c1
            dv = back - c0
            if name in BACK_DAMP:
                dv = dv * (1.0 - BACK_DAMP[name] * back_zone(c0))
            if name in NECK_DAMP:
                dv = dv * (1.0 - NECK_DAMP[name] * neck_zone(c0))
            if name in BELLY_DAMP and dv.y > 0.0:
                dv.y = dv.y * (1.0 - BELLY_DAMP[name] * belly_zone(c0))   # +Y = vers le dos : ventre rentré
            d.co = b0.co + imw.to_3x3() @ dv
        k.value = 0.0
    expression_shapes(body, TS, LS)
    flatten_glutes(body, base_m)
    hollow_nape(body, base_m, NAPE_DEPTH[args.variant])
    for m in list(body.modifiers):
        if m.type == 'MASK':
            body.modifiers.remove(m)
    # Globes oculaires à part ; les autres aides (cils, cheveux, collants, jupe…) sont supprimées.
    eyes_idx = vgroup_members(body, 'helper-l-eye') | vgroup_members(body, 'helper-r-eye')
    set_active(body)
    bpy.ops.object.mode_set(mode='EDIT')
    bm = bmesh.from_edit_mesh(body.data)
    bm.verts.ensure_lookup_table()
    for v in bm.verts:
        v.select = v.index in eyes_idx
    bm.select_flush_mode()
    bmesh.update_edit_mesh(body.data)
    bpy.ops.mesh.separate(type='SELECTED')
    bpy.ops.object.mode_set(mode='OBJECT')
    eyes = next(o for o in bpy.context.selected_objects if o is not body)
    eyes.name = eyes.data.name = 'rider_eyes'
    set_active(body)
    bpy.ops.object.mode_set(mode='EDIT')
    bm = bmesh.from_edit_mesh(body.data)
    bm.verts.ensure_lookup_table()
    # Indices recalculés après la séparation des yeux (ceux d'avant sont décalés). Langue gardée
    # (bouche ouverte) ; les dents d'aide de MakeHuman, grossières, sont retirées.
    keep = vgroup_members(body, 'body') | vgroup_members(body, 'helper-tongue') | LASH_GROUPS_MEMBERS(body)
    gone = [v for v in bm.verts if v.index not in keep]
    bmesh.ops.delete(bm, geom=gone, context='VERTS')
    bmesh.update_edit_mesh(body.data)
    bpy.ops.object.mode_set(mode='OBJECT')
    body.name = body.data.name = 'rider_body'
    return body, eyes, rig



def prune_keys(ob, eps=1e-5):
    """Retire les cibles sans effet sur cet objet (les globes ne suivent que les curseurs des yeux)."""
    keys = ob.data.shape_keys.key_blocks
    base = keys['Basis']
    for kb in list(keys)[1:]:
        if all((d.co - b.co).length < eps for d, b in zip(kb.data, base.data)):
            ob.shape_key_remove(kb)


# ---------------------------------------------------------------------------------------------
# Zones de tenue
# ---------------------------------------------------------------------------------------------
def dominant_bones(ob):
    names = {g.index: g.name for g in ob.vertex_groups}
    out = []
    for v in ob.data.vertices:
        best, w = None, 0.0
        for ge in v.groups:
            n = names[ge.group]
            if ge.weight > w and not n.startswith(('helper', 'joint', 'body', 'Mid', 'Left', 'Right', 'HelperGeometry', 'JointCubes')) and n in BONE_NAMES:
                best, w = n, ge.weight
        out.append(best)
    return out


BONE_NAMES = set()


def along(rig, bone, co):
    """Position (0 = tête de l'os, 1 = queue) du point co le long de l'os (pose de repos)."""
    b = rig.data.bones[bone]
    a, c = b.head_local, b.tail_local
    d = c - a
    return (co - a).dot(d) / max(d.length_squared, 1e-9)


def cut_hems(body, rig):
    """Ourlets nets : coupes planes (bmesh.bisect, cibles et poids interpolés) aux bords du
    maillot, des manches, de la bande, du cuissard et des chaussettes, limitées aux faces de
    l'os concerné."""
    dom = dominant_bones(body)
    planes = []
    chest_z = rig.data.bones['spine_03'].head_local.z
    pelvis_z = rig.data.bones['pelvis'].head_local.z
    for z in (chest_z + 0.03, chest_z + 0.075):
        planes.append((('spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r'), Vector((0, 0, z)), Vector((0, 0, 1))))
    planes.append((('pelvis', 'spine_01'), Vector((0, 0, pelvis_z + 0.07)), Vector((0, 0, 1))))
    planes.append((('neck_01', 'spine_03', 'spine_02', 'clavicle_l', 'clavicle_r'),) + neck_plane(rig))
    for side in ('l', 'r'):
        for bone, ts in (('upperarm_' + side, (0.5, 0.58)), ('thigh_' + side, (0.74,)), ('calf_' + side, (0.78,))):
            b = rig.data.bones[bone]
            d = (b.tail_local - b.head_local)
            for t in ts:
                planes.append(((bone,), b.head_local + d * t, d.normalized()))
    me = body.data
    bm = bmesh.new()
    bm.from_mesh(me)
    for bones, co, no in planes:
        bm.verts.ensure_lookup_table()
        idx = {v.index for v in bm.verts if v.index < len(dom) and dom[v.index] in bones}
        faces = [f for f in bm.faces if all(v.index in idx for v in f.verts)]
        if not faces:
            continue
        geom = set(faces)
        for f in faces:
            geom.update(f.edges)
            geom.update(f.verts)
        bmesh.ops.bisect_plane(bm, geom=list(geom), dist=1e-5, plane_co=co, plane_no=no)
        bm.verts.index_update()
        dom = dom + [None] * (len(bm.verts) - len(dom))
        # Les nouveaux sommets héritent de l'os de leurs voisins.
        bm.verts.ensure_lookup_table()
        for v in bm.verts:
            if dom[v.index] is None:
                nb = [dom[e.other_vert(v).index] for e in v.link_edges if dom[e.other_vert(v).index]]
                dom[v.index] = nb[0] if nb else None
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bm.to_mesh(me)
    bm.free()
    me.update()


def neck_plane(rig):
    """Col du maillot : plan à la base du cou, incliné pour descendre devant (avant = −Y)."""
    nb = rig.data.bones['neck_01']
    co = nb.head_local + (nb.tail_local - nb.head_local) * 0.1
    return co, Vector((0, -0.35, 0.94)).normalized()


def region_at(rig, b, co, pelvis_z, chest_z):
    """Zone de tenue d'un point (pose debout) selon l'os dominant et la position le long de l'os."""
    if b in ('neck_01', 'spine_03', 'spine_02') or b.startswith('clavicle'):
        nco, nno = neck_plane(rig)
        if (co - nco).dot(nno) > 0:
            return 'skin'
        if b == 'neck_01':
            return 'jersey'
    if b == 'head' or b.startswith(('lowerarm', 'hand', 'thumb', 'index', 'middle', 'ring', 'pinky')):
        return 'skin'
    if b in ('pelvis', 'spine_01') and co.z <= pelvis_z + 0.07:
        return 'shorts'
    if b.startswith(('spine', 'clavicle')):
        # Bande du maillot : ceinture de poitrine, comme sur cyclist.glb.
        return 'jersey_accent' if chest_z + 0.03 < co.z < chest_z + 0.075 else 'jersey'
    if b == 'pelvis':
        return 'jersey' if co.z > pelvis_z + 0.07 else 'shorts'
    if b.startswith('upperarm'):
        t = along(rig, b, co)
        return 'jersey' if t < 0.5 else 'jersey_accent' if t < 0.58 else 'skin'
    if b.startswith('thigh'):
        return 'shorts' if along(rig, b, co) < 0.74 else 'skin'
    if b.startswith('calf'):
        return 'sock' if along(rig, b, co) > 0.78 else 'skin'
    if b.startswith(('foot', 'ball')):
        return 'sock'
    return 'skin'


def assign_kit(body, rig):
    """Matériaux par face : peau, maillot, bande du maillot, cuissard, chaussettes."""
    global BONE_NAMES
    BONE_NAMES = {b.name for b in rig.data.bones}
    cut_hems(body, rig)
    dom = dominant_bones(body)
    me = body.data
    pelvis_z = rig.data.bones['pelvis'].head_local.z
    chest_z = rig.data.bones['spine_03'].head_local.z
    vreg = [region_at(rig, dom[v.index] or 'pelvis', v.co, pelvis_z, chest_z) for v in me.vertices]
    names = ['skin', 'jersey', 'jersey_accent', 'shorts', 'sock', 'mouth', 'lashes']
    lashes = LASH_GROUPS_MEMBERS(body, upper_only=False)  # cils du bas déjà retirés
    tongue = vgroup_members(body, 'helper-tongue')
    mouth = MOUTH[0]

    # Intérieur de la bouche : faces derrière les lèvres tournées vers l'intérieur de la tête (la
    # peau extérieure, elle, regarde vers l'extérieur).
    head_c = mouth + Vector((0, 0.08, 0.05))

    def inside_mouth(p):
        c = p.center
        return (abs(c.x - mouth.x) < 0.034 and mouth.z - 0.04 < c.z < mouth.z + 0.022 and mouth.y + 0.004 < c.y < mouth.y + 0.095
                and p.normal.dot(head_c - c) > 0)
    me.materials.clear()
    for n in names:
        m = bpy.data.materials.get(n) or bpy.data.materials.new(n)
        me.materials.append(m)
    # Face entière d'un côté de chaque coupe : la région du sommet le plus « intérieur » l'emporte
    # rarement ; on prend la région de la face d'après son centre (mêmes règles que les sommets).
    mi = []
    for p in me.polygons:
        vs = set(p.vertices)
        if vs <= lashes:
            mi.append(names.index('lashes'))
            continue
        if vs <= tongue or inside_mouth(p):
            mi.append(names.index('mouth'))
            continue
        rr = [vreg[i] for i in p.vertices]
        reg = region_at(rig, max(set([dom[i] for i in p.vertices if dom[i]] or ['pelvis']), key=[dom[i] for i in p.vertices].count), p.center, pelvis_z, chest_z)
        mi.append(names.index(reg if reg else max(set(rr), key=rr.count)))
    me.polygons.foreach_set('material_index', mi)
    print('zones :', {n: mi.count(i) for i, n in enumerate(names)})


def assign_eyes(eyes, rig):
    """Sclérotique, iris, pupille : faces selon l'angle à l'axe avant de chaque globe."""
    me = eyes.data
    names = ['eye', 'iris', 'pupil']
    me.materials.clear()
    for n in names:
        me.materials.append(bpy.data.materials.get(n) or bpy.data.materials.new(n))
    fwd = Vector((0, -1, 0))
    centers = {}
    for side in (1, -1):
        vs = [v.co for v in me.vertices if v.co.x * side > 0]
        centers[side] = sum(vs, Vector()) / max(len(vs), 1)
    mi = []
    for p in me.polygons:
        c = p.center
        o = centers[1 if c.x > 0 else -1]
        ang = math.degrees((c - o).angle(fwd)) if (c - o).length > 1e-6 else 90
        mi.append(2 if ang < 8 else 1 if ang < 22 else 0)
    me.polygons.foreach_set('material_index', mi)


# ---------------------------------------------------------------------------------------------
# Pose de conduite
# ---------------------------------------------------------------------------------------------
def ankle_target(side):
    """Cheville (client) sur sa pédale à BIND_PHASE, talon levé : les deux pieds au même endroit du
    tour de pédale (jambes en miroir)."""
    a = BIND_PHASE
    pedal = Vector((PEDAL_AXIS_X if side == 'l' else -PEDAL_AXIS_X, BB.y - math.cos(a) * CRANK, BB.z - math.sin(a) * CRANK))
    rest = ANKLE_FLAT.copy()
    rot = Matrix.Rotation(REST_PITCH, 3, 'X')
    off = rot @ rest
    return Vector((FOOT_X if side == 'l' else -FOOT_X, pedal.y + off.y, pedal.z + off.z)), pedal


def empty(name, loc_client):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.location = bl(loc_client)
    return e


def pose_rider(rig, body):
    set_active(rig)
    bpy.ops.object.mode_set(mode='POSE')
    pb = rig.pose.bones
    for b in pb:
        b.rotation_mode = 'QUATERNION'

    def world(name, tail=False):
        bpy.context.view_layer.update()
        b = pb[name]
        return rig.matrix_world @ (b.tail if tail else b.head)

    # --- Buste : profil calé sur des photos de coureurs de profil (screen/, docs/AVATARS.md) ---
    # Chaque os de la colonne reçoit une direction absolue dans le plan sagittal (degrés au-dessus de
    # l'horizontale, vers l'avant) : inclinaison générale L du buste + forme du dos (SPINE_SHAPE),
    # dos arrondi qui s'aplatit en arrivant aux épaules. L est cherché pour que les mains tombent
    # sur les cocottes (coudes fléchis, ARM_REACH), épaules avancées vers le guidon ; cou incliné
    # de NECK_DEG, tête droite, regard vers la route (HEAD_PITCH).
    hip_bl = bl(HIP)
    pel = pb['pelvis']
    spine = ('pelvis', 'spine_01', 'spine_02', 'spine_03')
    head_rest = pb['head'].matrix.to_3x3().normalized()

    def elevation(name):
        b = pb[name]
        d = b.tail - b.head
        return math.degrees(math.atan2(d.z, -d.y))

    def aim(name, deg):
        """Oriente l'os vers `deg` (plan sagittal), en tournant autour de l'axe X passant par sa tête."""
        bpy.context.view_layer.update()
        b = pb[name]
        r = Matrix.Rotation(-math.radians(deg - elevation(name)), 4, 'X')
        b.matrix = Matrix.Translation(b.head) @ r @ Matrix.Translation(-b.head) @ b.matrix
        bpy.context.view_layer.update()

    def torso(lean, neck_deg):
        for n in spine + ('neck_01', 'head', 'clavicle_l', 'clavicle_r'):
            pb[n].matrix_basis = Matrix.Identity(4)
        bpy.context.view_layer.update()
        # Bassin posé sur la selle (centre des hanches), puis orientations successives.
        m = pel.matrix.copy()
        pel.matrix = Matrix.Translation(hip_bl - m.to_translation()) @ m
        for n in spine:
            aim(n, lean + SPINE_SHAPE[n])
        # Épaules : clavicules avancées (rotation autour de la verticale) et un peu remontées.
        for side, sg in (('l', 1), ('r', -1)):
            c = pb['clavicle_' + side]
            c.matrix_basis = Matrix.Identity(4)
            bpy.context.view_layer.update()
            r = Matrix.Rotation(-math.radians(SHOULDER_PROTRACT) * sg, 4, 'Z') @ Matrix.Rotation(-math.radians(SHOULDER_RAISE) * sg, 4, 'Y')
            c.matrix = Matrix.Translation(c.head) @ r @ Matrix.Translation(-c.head) @ c.matrix
            bpy.context.view_layer.update()
        aim('neck_01', neck_deg)
        # Tête droite (comme debout), inclinée vers la route.
        h = pb['head']
        h.matrix = Matrix.Translation(h.head) @ (Matrix.Rotation(math.radians(HEAD_PITCH), 3, 'X') @ head_rest).to_4x4()
        bpy.context.view_layer.update()

    print('repos : ' + ', '.join(f'{n} {elevation(n):.0f}°' for n in spine + ('neck_01', 'head')))
    arm_len = (rig.data.bones['upperarm_l'].length + rig.data.bones['lowerarm_l'].length)
    wrist = {s: bl(Vector((HOOD.x * (1 if s == 'l' else -1), HOOD.y + 0.018, HOOD.z - 0.075))) for s in ('l', 'r')}
    best = None
    for k in range(5, 80):
        torso(k, 30)
        err = abs((world('upperarm_l') - wrist['l']).length - (args.reach if args.reach > 0 else ARM_REACH) * arm_len)
        if best is None or err < best[0]:
            best = (err, k)
    lean_deg = best[1]
    print(f'portée : écart {100 * best[0]:.1f} cm')

    torso(lean_deg, NECK_DEG)
    print(f'buste : inclinaison {lean_deg}°, ' + ', '.join(f'{n} {elevation(n):.0f}°' for n in spine + ('neck_01',))
          + f", tête {100 * (world('head').z - world('upperarm_l').z):+.1f} cm au-dessus de l'épaule, {100 * (world('upperarm_l').y - world('head').y):.1f} cm devant")

    # Jambes : IK vers les chevilles, genoux vers l'avant.
    for s in ('l', 'r'):
        ank, pedal = ankle_target(s)
        t = empty('ik_ankle_' + s, ank)
        pole = empty('pole_knee_' + s, Vector((ank.x * 1.15, 0.75, 0.45)))
        c = pb['calf_' + s].constraints.new('IK')
        c.target = t
        c.pole_target = pole
        c.chain_count = 2
        best_pa, best_z = 0.0, -1e9
        for pa in range(-180, 181, 15):
            c.pole_angle = math.radians(pa)
            bpy.context.view_layer.update()
            knee = cl(world('calf_' + s))
            score = knee.z - abs(knee.x - ank.x) * 2
            if score > best_z:
                best_pa, best_z = pa, score
        c.pole_angle = math.radians(best_pa)
        # Pied : pointé vers le dessus de la pédale (cale sous l'avant-pied).
        dt = pb['foot_' + s].constraints.new('DAMPED_TRACK')
        dt.target = empty('pedal_' + s, pedal + Vector((0, SOLE, 0.012)))
        dt.track_axis = 'TRACK_Y'
    # Bras : IK vers les poignets, mains vers l'avant des cocottes.
    for s in ('l', 'r'):
        c = pb['lowerarm_' + s].constraints.new('IK')
        c.target = empty('ik_wrist_' + s, cl(wrist[s]))
        c.chain_count = 2
        # Coudes vers l'arrière, un peu écartés (ELBOW_POLE) : angle de pôle cherché.
        pole = Vector((ELBOW_POLE.x * (1 if s == 'l' else -1), ELBOW_POLE.y, ELBOW_POLE.z))
        c.pole_target = empty('pole_elbow_' + s, pole)
        best_pa, best_d = 0.0, 1e9
        for pa in range(-180, 181, 10):
            c.pole_angle = math.radians(pa)
            bpy.context.view_layer.update()
            d = (cl(world('lowerarm_' + s)) - pole).length
            if d < best_d:
                best_pa, best_d = pa, d
        c.pole_angle = math.radians(best_pa)
        dt = pb['hand_' + s].constraints.new('DAMPED_TRACK')
        dt.target = empty('hood_' + s, Vector((HOOD.x * (1 if s == 'l' else -1), HOOD.y - 0.01, HOOD.z + 0.06)))
        dt.track_axis = 'TRACK_Y'
        # Doigts refermés sur la cocotte.
        for f in ('index', 'middle', 'ring', 'pinky'):
            for j, ang in ((1, 35), (2, 55), (3, 35)):
                pb[f'{f}_0{j}_{s}'].rotation_quaternion = Matrix.Rotation(math.radians(ang), 4, 'X').to_quaternion()
    for s in ('l', 'r'):
        print(f'cheville {s} : cible {tuple(round(c, 3) for c in bl(ankle_target(s)[0]))}, obtenue {tuple(round(c, 3) for c in world("foot_" + s))}')
    bpy.ops.object.mode_set(mode='OBJECT')


def lengthen_humerus(body, rig):
    """Humérus rallongé de HUMERUS_SCALE − 1 : le haut du bras MPFB (0,25 m) est ≈ 22 % plus court que
    celui d'un adulte de 1,75 m (≈ 0,33 m, Winter : 0,186 × taille). Os : le coude et tout ce qui est
    en aval (avant-bras, main, doigts) reculent de Δ le long de l'humérus. Maillage et cibles : chaque
    sommet suit ses poids (humérus : étirement linéaire de 0 à Δ de l'épaule au coude ; avant-bras,
    main, doigts : Δ), donc pas de saut au coude et la peau, les manches et les UV s'étirent
    seulement sur l'humérus."""
    hs = args.humerus if args.humerus > 0 else HUMERUS_SCALE
    zs = [(body.matrix_world @ v.co).z for v in body.data.vertices]
    bl_ = rig.data.bones
    print('mesures : stature %.3f m, fémur %.3f, tibia %.3f, humérus %.3f, avant-bras %.3f, clavicule %.3f' % (
        max(zs) - min(zs), bl_['thigh_l'].length, bl_['calf_l'].length, bl_['upperarm_l'].length, bl_['lowerarm_l'].length, bl_['clavicle_l'].length))
    shifts = [Vector() for _ in body.data.vertices]
    mw_b = body.matrix_world
    imw_b = mw_b.inverted()
    mw_r = rig.matrix_world
    names = {g.index: g.name for g in body.vertex_groups}
    moves = {}
    moves2 = {}
    for s in ('l', 'r'):
        up = rig.data.bones['upperarm_' + s]
        lo = rig.data.bones['lowerarm_' + s]
        a = mw_r @ up.head_local
        e = mw_r @ lo.head_local
        d = (e - a)
        delta = d * (hs - 1.0)
        distal = {lo.name} | {c.name for c in lo.children_recursive}
        moves[s] = (up.name, distal, a, d, delta)
        hand = rig.data.bones['hand_' + s]
        w_ = mw_r @ hand.head_local
        d2 = w_ - e
        moves2[s] = (lo.name, {hand.name} | {c.name for c in hand.children_recursive}, e, d2, d2 * (args.forearm - 1.0))
        print(f'humérus {s} : {d.length:.3f} m → {d.length * hs:.3f} m')
    for i, v in enumerate(body.data.vertices):
        co = mw_b @ v.co
        tot = Vector()
        for ge in v.groups:
            n = names[ge.group]
            for up_n, distal, a, d, delta in moves.values():
                if n == up_n:
                    t = min(max((co - a).dot(d) / max(d.length_squared, 1e-9), 0.0), 1.0)
                    tot += delta * (t * ge.weight)
                elif n in distal:
                    tot += delta * ge.weight
        for lo_n, dist2, a2, d2, delta2 in moves2.values():
            for ge in v.groups:
                n = names[ge.group]
                if n == lo_n:
                    t2 = min(max((co - a2).dot(d2) / max(d2.length_squared, 1e-9), 0.0), 1.0)
                    tot += delta2 * (t2 * ge.weight)
                elif n in dist2:
                    tot += delta2 * ge.weight
        shifts[i] = imw_b.to_3x3() @ tot
    for kb in body.data.shape_keys.key_blocks:
        for dd, sh in zip(kb.data, shifts):
            dd.co = dd.co + sh
    for v, sh in zip(body.data.vertices, shifts):
        v.co = v.co + sh
    set_active(rig)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = rig.data.edit_bones
    for s, (up_n, distal, a, d, delta) in moves.items():
        dl = mw_r.inverted().to_3x3() @ delta
        eb[up_n].tail = eb[up_n].tail + dl
        for n in distal:
            eb[n].head = eb[n].head + dl
            eb[n].tail = eb[n].tail + dl
        lo_n, dist2, a2, d2, delta2 = moves2[s]
        dl2 = mw_r.inverted().to_3x3() @ delta2
        eb[lo_n].tail = eb[lo_n].tail + dl2
        for n in dist2:
            eb[n].head = eb[n].head + dl2
            eb[n].tail = eb[n].tail + dl2
    bpy.ops.object.mode_set(mode='OBJECT')
    body.data.update()


def apply_pose_as_rest(rig, meshes):
    """Fige la pose (maillages et cibles) puis en fait la pose de repos du squelette."""
    dg = bpy.context.evaluated_depsgraph_get()
    for ob in meshes:
        keys = ob.data.shape_keys.key_blocks if ob.data.shape_keys else []
        coords = {}
        for kb in keys:
            for k2 in keys:
                k2.value = 0.0
            if kb.name != 'Basis':
                kb.value = 1.0
            dg.update()
            ev = ob.evaluated_get(dg)
            coords[kb.name] = [v.co.copy() for v in ev.to_mesh().vertices]
            ev.to_mesh_clear()
        if not keys:
            dg.update()
            ev = ob.evaluated_get(dg)
            coords['Basis'] = [v.co.copy() for v in ev.to_mesh().vertices]
            ev.to_mesh_clear()
        names = [kb.name for kb in keys]
        if ob.data.shape_keys:
            ob.shape_key_clear()
        for v, c in zip(ob.data.vertices, coords['Basis']):
            v.co = c
        if names:
            ob.shape_key_add(name='Basis', from_mix=False)
            for n in names[1:]:
                k = ob.shape_key_add(name=n, from_mix=False)
                for d, c in zip(k.data, coords[n]):
                    d.co = c
                k.value = 0.0
    set_active(rig)
    bpy.ops.object.mode_set(mode='POSE')
    # Pose visuelle (IK et suivis compris) copiée dans les os avant de retirer les contraintes,
    # sinon le squelette perdrait la pose que le maillage a gardée.
    bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.pose.visual_transform_apply()
    for b in rig.pose.bones:
        for c in list(b.constraints):
            b.constraints.remove(c)
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in list(bpy.data.objects):
        if o.type == 'EMPTY':
            bpy.data.objects.remove(o)


# ---------------------------------------------------------------------------------------------
# Accessoires repris de cyclist.glb
# ---------------------------------------------------------------------------------------------
def frame(origin, axis):
    """Repère orthonormé : Y = axis, Z = haut du monde rendu orthogonal, X = Y × Z."""
    y = axis.normalized()
    up = Vector((0, 0, 1))
    z = (up - y * up.dot(y)).normalized()
    x = y.cross(z)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = origin
    return m


def import_accessories(rig, body):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(args.cyclist))
    new = [o for o in bpy.data.objects if o not in before]
    old_arm = next(o for o in new if o.type == 'ARMATURE')
    old_body = next(o for o in new if o.name.startswith('rider_body'))

    def bone_w(arm, name):
        b = arm.data.bones[name]
        return arm.matrix_world @ b.head_local, arm.matrix_world.to_3x3() @ (b.tail_local - b.head_local)

    def extent_x(ob, group):
        idx = vgroup_members(ob, group)
        xs = [(ob.matrix_world @ ob.data.vertices[i].co).x for i in idx]
        return (max(xs) - min(xs)) if xs else 1.0

    # Tête : centre et axe de l'os, échelle d'après la largeur du crâne.
    oh, oa = bone_w(old_arm, 'head')
    nh, na = bone_w(rig, 'head')
    s_head = extent_x(body, 'head') / max(extent_x(old_body, 'head'), 1e-6)
    m_head = frame(nh, na) @ Matrix.Scale(s_head, 4) @ frame(oh, oa).inverted()
    out = []
    for o in new:
        if o.type != 'MESH' or o is old_body:
            continue
        n = o.name.split('.')[0]
        # Casque route et lunettes : modélisés ici (build_headgear), ceux de cyclist.glb sont écartés.
        if n.startswith(('rider_helmet_aero', 'rider_hair')):
            mats = [m_head]
            groups = ['head']
        else:
            # Chaussures : posées sur les pédales par avatars/reshoe.mjs (même pose de repos, aucun
            # recalage sur le pied MPFB, dont les orteils dépassent vers l'intérieur).
            continue
        # Transformation monde figée avant de détacher l'objet (sans parent, Blender garde la
        # matrice locale).
        mw = o.matrix_world.copy()
        o.parent = None
        me = o.data
        if me.shape_keys:
            o.shape_key_clear()
        for mod in list(o.modifiers):
            o.modifiers.remove(mod)
        for v in me.vertices:
            w = mw @ v.co
            i = 0 if len(mats) == 1 or w.x > 0 else 1
            v.co = mats[i] @ w
        o.matrix_world = Matrix.Identity(4)
        o.vertex_groups.clear()
        if len(groups) == 1:
            g = o.vertex_groups.new(name=groups[0])
            g.add(range(len(me.vertices)), 1.0, 'REPLACE')
        else:
            gl, gr = o.vertex_groups.new(name=groups[0]), o.vertex_groups.new(name=groups[1])
            gl.add([v.index for v in me.vertices if v.co.x > 0], 1.0, 'REPLACE')
            gr.add([v.index for v in me.vertices if v.co.x <= 0], 1.0, 'REPLACE')
        o.parent = rig
        mod = o.modifiers.new('Armature', 'ARMATURE')
        mod.object = rig
        o.name = n
        out.append(o)
    fit_headgear([o for o in out if o.name.startswith(('rider_helmet', 'rider_hair', 'rider_glasses'))], body, old_body, (oh, oa), (nh, na), s_head)
    for o in new:
        if o not in out:
            bpy.data.objects.remove(o, do_unlink=True)
    return out


def fit_headgear(objs, body, old_body, old_frame, new_frame, s_head):
    """Casque, lunettes et bonnet de cheveux recalés sur le crâne de ce modèle : profondeur ramenée à celle du
    crâne (l'échelle d'import ne suit que sa largeur ; l'avant, le front, reste en place), puis tout
    point entré dans la peau (sangles sur la joue et la mâchoire) ressorti à 3 mm."""
    from mathutils.bvhtree import BVHTree
    f_old, f_new = frame(*old_frame).inverted(), frame(*new_frame).inverted()

    def head_z(ob, fr):
        idx = vgroup_members(ob, 'head')
        return [(fr @ (ob.matrix_world @ ob.data.vertices[i].co)).z for i in idx]
    zo, zn = head_z(old_body, f_old), head_z(body, f_new)
    r = (max(zn) - min(zn)) / max((max(zo) - min(zo)) * s_head, 1e-6)
    fwd = (f_new.to_3x3() @ Vector((0.0, -1.0, 0.0))).z         # sens de l'avant dans le repère de la tête
    anchor = max(zn) if fwd > 0 else min(zn)
    to_w = f_new.inverted()
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.transform(body.matrix_world)
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    # Sommet du crâne : le casque est descendu jusqu'à n'y laisser que le rembourrage (bord au-dessus des sourcils).
    hq = [f_new @ (body.matrix_world @ body.data.vertices[i].co) for i in vgroup_members(body, 'head')]
    crown = max(hq, key=lambda q: q.y)
    pushed = 0
    for o in objs:
        qs = [f_new @ v.co for v in o.data.vertices]
        for q in qs:
            q.z = anchor + (q.z - anchor) * r
        drop = 0.0
        if o.name.startswith('rider_helmet'):
            above = [q.y for q in qs if abs(q.x - crown.x) < 0.025 and abs(q.z - crown.z) < 0.03 and q.y > crown.y]
            if above:
                drop = max(0.0, min(above) - crown.y - 0.012)
            print(f'{o.name} : descendu de {100 * drop:.1f} cm')
        for v, q in zip(o.data.vertices, qs):
            q.y -= drop
            w = to_w @ q
            loc, nrm, _, _ = tree.find_nearest(w)
            if loc is not None and (w - loc).dot(nrm) < 0.003:
                w = loc + nrm * 0.003
                pushed += 1
            v.co = w
        o.data.update()
    print(f'casque : profondeur × {r:.3f}, {pushed} sommets ressortis de la peau')


def transfer_keys(body, objs):
    """Cibles du corps reportées sur les accessoires : chaque sommet suit la moyenne des sommets
    du corps les plus proches (cheveux : 16, casque, lunettes : 24, pour rester rigides ; sangles :
    8, et la mâchoire qui s'ouvre, pour rester sous le menton)."""
    from mathutils import kdtree
    keys = body.data.shape_keys.key_blocks
    base = [v.co.copy() for v in keys['Basis'].data]
    kd = kdtree.KDTree(len(base))
    for i, c in enumerate(base):
        kd.insert(c, i)
    kd.balance()
    ident = [kb for kb in list(keys)[1:] if kb.name[-1] in '+-']
    deltas = {kb.name: [kb.data[i].co - base[i] for i in range(len(base))] for kb in ident}
    jaw = [kb for kb in keys if kb.name == 'jawOpen']
    for kb in jaw:
        deltas[kb.name] = [kb.data[i].co - base[i] for i in range(len(base))]
    for o in objs:
        straps = o.name == 'rider_helmet_straps'
        n = 16 if o.name.startswith('rider_hair') else 8 if straps else 24
        near = [[i for _, i, _ in kd.find_n(v.co, n)] for v in o.data.vertices]
        o.shape_key_add(name='Basis', from_mix=False)
        for kb in ident + (jaw if straps else []):
            d = deltas[kb.name]
            k = o.shape_key_add(name=kb.name, from_mix=False)
            for kd_, v, nb in zip(k.data, o.data.vertices, near):
                kd_.co = v.co + sum((d[i] for i in nb), Vector()) / len(nb)
            k.value = 0.0
        prune_keys(o)


# ---------------------------------------------------------------------------------------------
# Coiffures compatibles casque et moustache (profils, docs/AVATARS.md § 9)
# ---------------------------------------------------------------------------------------------
def hair_material():
    return bpy.data.materials.get('hair') or bpy.data.materials.new('hair')


def skin_to_head(ob, rig):
    g = ob.vertex_groups.new(name='head')
    g.add(range(len(ob.data.vertices)), 1.0, 'REPLACE')
    ob.parent = rig
    m = ob.modifiers.new('Armature', 'ARMATURE')
    m.object = rig


def build_hair_styles(body, rig):
    """Queue de cheval et tresse (sortant sous le casque, dans la nuque), en pose debout, liées à
    l'os de la tête ; moustache : copie de la peau au-dessus de la lèvre, décollée de 2 mm (suit
    curseurs et expressions puisque ce sont les mêmes sommets et cibles)."""
    head = [body.matrix_world @ v.co for v in body.data.vertices if v.co.z > MOUTH[0].z - 0.02]
    back_y = max(c.y for c in head if abs(c.x) < 0.02 and c.z > MOUTH[0].z + 0.05)
    eye_z = MOUTH[0].z + 0.072
    out = []

    def tube(name, path, radii, twist=0.0, lumps=0, lump_from=0):
        bm = bmesh.new()
        rings = []
        n = 10
        pts = []
        for i in range(len(path) - 1):
            for k in range(6):
                t = k / 6
                pts.append((path[i].lerp(path[i + 1], t), radii[i] + (radii[i + 1] - radii[i]) * t))
        pts.append((path[-1], radii[-1]))
        for j, (p, r) in enumerate(pts):
            nxt = pts[min(j + 1, len(pts) - 1)][0] - pts[max(j - 1, 0)][0]
            d = nxt.normalized()
            u = d.cross(Vector((1, 0, 0))).normalized()
            w = d.cross(u)
            if lumps and j >= lump_from * 6:  # tresse : mèches qui se croisent (à partir du segment lump_from)
                p = p + Vector((math.sin(j * math.pi / 3) * r * 0.35, 0, 0))
                r = r * (0.85 + 0.15 * abs(math.cos(j * math.pi / 3)))
            rings.append([bm.verts.new(p + (u * math.cos(a) + w * math.sin(a)) * r) for a in (2 * math.pi * q / n for q in range(n))])
        for a, b in zip(rings, rings[1:]):
            for q in range(n):
                bm.faces.new((a[q], a[(q + 1) % n], b[(q + 1) % n], b[q]))
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        me.materials.append(hair_material())
        for p in me.polygons:
            p.use_smooth = True
        skin_to_head(ob, rig)
        out.append(ob)

    root = Vector((0, back_y - 0.012, eye_z - 0.035))
    tube('rider_hair_ponytail', [root, root + Vector((0, 0.03, -0.035)), root + Vector((0, 0.04, -0.09)), root + Vector((0, 0.035, -0.15))],
         [0.02, 0.022, 0.016, 0.006])
    tube('rider_hair_braid', [root, root + Vector((0, 0.025, -0.04)), root + Vector((0, 0.03, -0.11)), root + Vector((0, 0.025, -0.2))],
         [0.016, 0.015, 0.013, 0.007], lumps=1)
    # Queue tressée : queue rassemblée (lisse) puis tressée, plus épaisse et plus longue que la tresse.
    tube('rider_hair_plait', [root, root + Vector((0, 0.03, -0.035)), root + Vector((0, 0.04, -0.10)), root + Vector((0, 0.035, -0.17)), root + Vector((0, 0.025, -0.24))],
         [0.021, 0.019, 0.016, 0.012, 0.005], lumps=1, lump_from=1)
    # Deux tresses collées : du front à la nuque de part et d'autre de la raie, posées sur le crâne
    # (tête nue seulement) ; leurs bouts pendent dans la nuque (visibles aussi sous le casque).
    yc = (min(c.y for c in head) + back_y) / 2
    Hc = Vector((0.0, yc, eye_z + 0.01))
    scalp, tails = [], []
    for sx in (-1.0, 1.0):
        x0 = sx * 0.03
        near = [c for c in head if abs(c.x - x0) < 0.008]
        pts = []
        for k in range(15):
            a = 0.8 + (math.pi + 0.45 - 0.8) * k / 14          # 0 : devant, π/2 : sommet, π : derrière
            d = Vector((0.0, -math.cos(a), math.sin(a)))
            best = max((c for c in near if (Vector((0.0, c.y - Hc.y, c.z - Hc.z)).normalized() - d).length < 0.07),
                       key=lambda c: (Vector((0.0, c.y - Hc.y, c.z - Hc.z))).length, default=None)
            if best is not None:
                pts.append(Vector((x0 * (1.0 - 0.35 * k / 14), best.y, best.z)) + d * 0.009)
        scalp.append(pts)
        end = pts[-1]
        tails.append([end, end + Vector((0, 0.012, -0.05)), end + Vector((0, 0.014, -0.11))])
    for i, pts in enumerate(scalp):
        tube(f'rider_hair_dutch{i}', pts, [0.0105] * len(pts), lumps=1)
    for i, pts in enumerate(tails):
        tube(f'rider_hair_dutchtail{i}', pts, [0.0095, 0.008, 0.004], lumps=1)
    # Moustache : faces de peau au-dessus de la lèvre supérieure, retombant aux commissures.
    m = MOUTH[0]
    mo = body.copy()
    mo.data = body.data.copy()
    bpy.context.scene.collection.objects.link(mo)
    mo.name = mo.data.name = 'rider_moustache'
    me = mo.data

    def in_zone(c):
        ax = abs(c.x - m.x)
        top = m.z + 0.017 - 0.006 * (ax / 0.028) ** 2
        bottom = m.z + 0.003 - (0.012 * max(0.0, ax - 0.016) / 0.012 if ax > 0.016 else 0)
        return ax < 0.029 and bottom < c.z < top and c.y < m.y + 0.012

    keep = {p.index for p in me.polygons if in_zone(p.center) and p.normal.y < -0.2}
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(me)
    bm.free()
    me.materials.clear()
    me.materials.append(hair_material())
    # Décollée de la peau (même décalage sur toutes les cibles : écarts inchangés).
    me.update()
    nrm = [v.normal.copy() for v in me.vertices]
    for kb in me.shape_keys.key_blocks:
        for d, n in zip(kb.data, nrm):
            d.co += n * 0.0022
    for v, n in zip(me.vertices, nrm):
        v.co += n * 0.0022
    prune_keys(mo)
    print(f'moustache : {len(me.polygons)} faces, {len(me.shape_keys.key_blocks) - 1} cibles')
    out.append(mo)
    out += hair_shells(body, rig, back_y, eye_z)
    return out


def hair_shells(body, rig, back_y, eye_z):
    """Coiffures visibles tête nue (le client les cache sous le casque) : coques découpées dans la
    tête de base le long d'une ligne d'implantation, décollées de la peau d'une épaisseur variable
    (volume, frange, mèches par bruit) ; cibles reportées ensuite par transfer_keys. Plus un chignon."""
    from mathutils import noise
    heads = [v.co.copy() for v in body.data.vertices if v.co.z > eye_z - 0.02]
    front_y = min(c.y for c in heads)
    ycen = (front_y + back_y) / 2
    ztop = max(c.z for c in heads)
    mouth_z = MOUTH[0].z
    H = Vector((0.0, ycen, eye_z + 0.01))
    L_f, L_s, L_b = eye_z + 0.055, eye_z + 0.012, eye_z - 0.085   # implantation : front, au-dessus de l'oreille, nuque

    def phi(c):
        return math.atan2(abs(c.x), -(c.y - ycen))

    # Oreille repérée sur le maillage : ce qui dépasse sur le côté la largeur de la tempe, juste devant.
    band = [v.co.copy() for v in body.data.vertices if eye_z - 0.075 < v.co.z < eye_z + 0.04]
    x_ref = max(abs(c.x) for c in band if 1.0 < phi(c) < 1.15)
    ear_pts = [c for c in band if abs(c.x) > x_ref + 0.008 and 1.2 < phi(c) < 2.3]
    from mathutils import kdtree
    ear_kd = kdtree.KDTree(len(ear_pts))
    for k, c in enumerate(ear_pts):
        ear_kd.insert(c, k)
    ear_kd.balance()
    pe0, pe1 = min(phi(c) for c in ear_pts), max(phi(c) for c in ear_pts)
    ez1 = max(c.z for c in ear_pts)
    print(f'oreille : {len(ear_pts)} sommets, phi {pe0:.2f} à {pe1:.2f}, haut à {100 * (ez1 - eye_z):+.1f} cm des yeux, tempe {100 * x_ref:.1f} cm')
    SIDEBURN, BEHIND_EAR = eye_z - 0.03, eye_z - 0.065    # bas des pattes devant l'oreille, implantation derrière

    def hairline(c, front=L_f, side=L_s, back=L_b, low=None, ear=True):
        f = phi(c)
        if low is not None and f > 1.25:   # mèches qui descendent derrière et sur les côtés
            return side + (low - side) * smoothstep(1.25, 1.8, f)
        if f < 0.9:
            return front + (side - front) * smoothstep(0.0, 0.9, f)
        if not ear:                         # côtés dégagés au-dessus de l'oreille (dégradé)
            if f < 1.9:
                return side
            return side + (back - side) * smoothstep(1.9, math.pi, f)
        # Pattes devant l'oreille, contour du haut de l'oreille (marge), puis derrière jusqu'à la nuque.
        arch = ez1 - 0.004                 # touche le haut de l'oreille (plaqué derrière elle, voir covers_ears)
        if f < pe0 - 0.14:
            return side + (SIDEBURN - side) * smoothstep(0.9, pe0 - 0.14, f)
        if f < pe0 - 0.02:
            return SIDEBURN + (arch - SIDEBURN) * smoothstep(pe0 - 0.14, pe0 - 0.02, f)
        if f < pe1 + 0.02:
            return arch
        if f < pe1 + 0.16:
            return arch + (BEHIND_EAR - arch) * smoothstep(pe1 + 0.02, pe1 + 0.16, f)
        return BEHIND_EAR + (back - BEHIND_EAR) * smoothstep(pe1 + 0.16, math.pi, f)

    def fur(c, scale, amp):
        return amp * noise.noise(Vector((c.x * scale, c.y * scale, c.z * scale * 0.6)))

    crown = lambda c, a=0.06: smoothstep(ztop - a, ztop, c.z)
    allv = [v.co.copy() for v in body.data.vertices]

    def curtain(key, z_front, z_back, phi0, swell, tuck):
        """Rideau de cheveux tombant droit du crâne (pose debout, liée à la tête) : il part du bas de
        la calotte, passe au-dessus des oreilles et de la mâchoire (rayon pris sur le maillage,
        oreilles comprises), bas net légèrement rentré ; deux faces (extérieure, intérieure) fermées."""
        z_top = eye_z + 0.03
        amax = math.pi - phi0
        NA, NZ = 44, 20
        az_of = lambda c: math.atan2(c.x, c.y - ycen)      # 0 : derrière, ±π : devant
        rad_of = lambda c: math.hypot(c.x, c.y - ycen)

        # Sommets de la tête et du cou par secteur angulaire (rayon horizontal, hauteur).
        sectors = []
        for i in range(NA + 1):
            az = -amax + 2 * amax * i / NA
            sectors.append([(c.z, rad_of(c)) for c in allv
                            if z_back - 0.12 < c.z < z_top + 0.03 and abs(math.atan2(math.sin(az_of(c) - az), math.cos(az_of(c) - az))) < 0.1])
        bm = bmesh.new()
        outer, inner = [], []
        for i in range(NA + 1):
            az = -amax + 2 * amax * i / NA
            frontness = abs(az) / amax
            z_bot = z_back + (z_front - z_back) * frontness
            sec = sectors[i]
            ro, ri = [], []
            r_prev = 0.0
            for j in range(NZ + 1):
                t = j / NZ
                z = z_top + (z_bot - z_top) * t
                # Collée au crâne en haut (épaisseur de la calotte), puis tombe droit : le rayon ne
                # diminue jamais en descendant (les cheveux passent au-dessus des oreilles et de la mâchoire).
                sl = max((r for zz, r in sec if abs(zz - z) < 0.012), default=0.0)
                r_prev = max(r_prev, sl + (0.011 if j == 0 else 0.006))
                # Bord avant : le rideau se rapproche de la joue au lieu de finir en plaque.
                hug = 0.8 * smoothstep(0.75, 1.0, frontness)
                r = r_prev + (sl + 0.007 - r_prev) * hug if sl > 0 else r_prev
                r += (swell * math.sin(math.pi * min(t / 0.85, 1.0)) - tuck * smoothstep(0.8, 1.0, t)) * (1 - hug)
                r += 0.0016 * math.sin(az * 46 + 6 * noise.noise(Vector((az * 3, z * 20, 0.0)))) * smoothstep(0.1, 0.4, t)
                d = Vector((math.sin(az), math.cos(az), 0.0))
                base = Vector((0.0, ycen, z))
                ro.append(bm.verts.new(base + d * r))
                ri.append(bm.verts.new(base + d * (r - 0.006)))
            outer.append(ro)
            inner.append(ri)
        for i in range(NA):
            for j in range(NZ):
                bm.faces.new((outer[i][j], outer[i + 1][j], outer[i + 1][j + 1], outer[i][j + 1]))
                bm.faces.new((inner[i][j + 1], inner[i + 1][j + 1], inner[i + 1][j], inner[i][j]))
            bm.faces.new((outer[i][NZ], outer[i + 1][NZ], inner[i + 1][NZ], inner[i][NZ]))     # bas
        for i in (0, NA):                                                                           # bords avant
            for j in range(NZ):
                bm.faces.new((outer[i][j], outer[i][j + 1], inner[i][j + 1], inner[i][j]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        me = bpy.data.meshes.new('curtain_' + key)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new('curtain_' + key, me)
        bpy.context.scene.collection.objects.link(ob)
        me.materials.append(hair_material())
        for p in me.polygons:
            p.use_smooth = True
        return ob

    def join_curtain(shell, cur):
        """Rideau fondu dans la coque : groupe « head » à 1 (suit la tête seule)."""
        g = cur.vertex_groups.new(name='head')
        g.add(range(len(cur.data.vertices)), 1.0, 'REPLACE')
        bpy.ops.object.select_all(action='DESELECT')
        cur.select_set(True)
        shell.select_set(True)
        bpy.context.view_layer.objects.active = shell
        bpy.ops.object.join()
    quiff_c = Vector((0.0, ycen - 0.035, ztop))
    # Rideaux (carré, longs) : bas des cheveux devant / derrière, avant du rideau (phi), renflement, rentré du bas.
    CURTAINS = {'bob': (mouth_z - 0.045, mouth_z - 0.02, 1.15, 0.010, 0.010),
                'long': (mouth_z - 0.085, mouth_z - 0.04, 1.05, 0.012, 0.004)}

    # nom : (implantation, épaisseur(c), mèches (échelle, amplitude), fin pointue ?, réduction)
    STYLES = {
        'cut': (dict(), lambda c: 0.005 + 0.012 * smoothstep(eye_z + 0.03, ztop - 0.01, c.z), (70, 0.002), True, 0.4),   # dessus fourni, côtés courts
        'slick': (dict(front=L_f + 0.01), lambda c: 0.0035, (60, 0.001), True, 0.4),
        'fade': (dict(back=L_b + 0.02), lambda c: 0.0022 + 0.012 * smoothstep(eye_z + 0.04, eye_z + 0.09, c.z), (80, 0.0015), True, 0.4),   # côtés ras autour de l'oreille, dessus fourni
        'curls': (dict(front=eye_z + 0.05, side=L_s - 0.025), lambda c: 0.02 + 0.014 * smoothstep(eye_z + 0.0, ztop, c.z), (150, 0.007), True, 0.6),
        'bob': (dict(front=eye_z + 0.04, side=L_s - 0.02), lambda c: 0.010 + 0.006 * crown(c, 0.08) + 0.016 * smoothstep(0, 0.07, L_s - c.z), (70, 0.002), False, 0.35),
        'quiff': (dict(front=L_f + 0.012, side=L_s + 0.01), lambda c: 0.004 + 0.045 * math.exp(-(((c - quiff_c).length) / 0.06) ** 2), (80, 0.002), True, 0.45),
        'long': (dict(front=eye_z + 0.045, side=L_s - 0.02), lambda c: 0.012 + 0.006 * crown(c, 0.08) + 0.02 * smoothstep(0, 0.08, L_s - c.z), (70, 0.002), False, 0.3),
    }
    out = []
    for key, (hl_kw, thick, (fscale, famp), pointed, ratio) in STYLES.items():
        mo = body.copy()
        mo.data = body.data.copy()
        bpy.context.scene.collection.objects.link(mo)
        mo.name = mo.data.name = 'rider_hairs_' + key
        if mo.data.shape_keys:
            for kb in list(mo.data.shape_keys.key_blocks)[::-1]:
                mo.shape_key_remove(kb)
        me = mo.data
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.faces.ensure_lookup_table()
        # Maillage de la tête affiné d'un cran : l'implantation suit mieux sa courbe.
        zone = [f for f in bm.faces if abs(f.calc_center_median().x) < 0.14 and f.calc_center_median().z > eye_z - 0.3]
        bmesh.ops.subdivide_edges(bm, edges=list({e for f in zone for e in f.edges}), cuts=1, use_grid_fill=True)
        bm.faces.ensure_lookup_table()
        bm.faces.index_update()
        outside = [f for f in bm.faces if not (abs(f.calc_center_median().x) < 0.14 and f.calc_center_median().z > hairline(f.calc_center_median(), **hl_kw))]
        bmesh.ops.delete(bm, geom=outside, context='FACES')
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        # Bord adouci (la ligne d'implantation ne suit pas l'escalier des faces).
        edge_vs = [v for v in bm.verts if any(e.is_boundary for e in v.link_edges)]
        for _ in range(4):
            new = {}
            for v in edge_vs:
                nb = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
                if nb:
                    new[v] = v.co * 0.4 + sum((n.co for n in nb), Vector()) / len(nb) * 0.6
            for v, c in new.items():
                v.co = c
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        bm.to_mesh(me)
        bm.free()
        me.materials.clear()
        me.materials.append(hair_material())
        while me.uv_layers:
            me.uv_layers.remove(me.uv_layers[0])
        set_active(mo)
        dec = mo.modifiers.new('Decimate', 'DECIMATE')
        dec.ratio = ratio
        bpy.ops.object.modifier_move_to_index(modifier='Decimate', index=0)
        bpy.ops.object.modifier_apply(modifier='Decimate')
        me = mo.data
        # Sur les côtés, l'oreille est ramenée sur le crâne (les mèches passent derrière elle).
        covers_ears = hl_kw.get('ear', True)
        band = sorted((v.co - H).length for v in me.vertices if 1.2 < phi(v.co) < 2.0 and abs(v.co.z - eye_z) < 0.06)
        r_skull = band[int(len(band) * 0.4)] if band else None
        for v in me.vertices:
            c = v.co.copy()
            d = c - H
            r = d.length
            # Oreille seule : sommets posés sur l'oreille (derrière elle, le crâne est aussi large
            # que la tempe ; ramené au rayon du crâne, il passait sous la peau : trou au-dessus de l'oreille).
            if covers_ears and r_skull and pe0 - 0.08 < phi(c) < pe1 + 0.08 and eye_z - 0.07 < c.z < ez1 + 0.01 and abs(c.x) > x_ref + 0.004                     and ear_kd.find(c)[2] < 0.003:
                r = min(r, r_skull)
            d.normalize()
            f = phi(c)
            blunt = smoothstep(1.25, 1.8, f) if not pointed else 0.0
            near_edge = smoothstep(0.0, 0.015, c.z - hairline(c, **hl_kw))
            t = thick(c) * (1 - 0.75 * (1 - near_edge) * (1 - blunt))
            t += fur(c, fscale, famp)
            # Mèches rayonnant depuis le sommet du crâne (épi), plus marquées dans le haut.
            t += (0.0018 + famp * 0.5) * math.sin(26 * math.atan2(c.x, c.y - ycen) + 7 * noise.noise(Vector((c.x * 25, c.y * 25, c.z * 25)))) * (0.4 + 0.6 * crown(c, 0.1))
            v.co = H + d * (r + max(t, 0.0015))
            if key == 'quiff':  # le toupet est ramené vers l'avant
                v.co.y -= 0.02 * math.exp(-(((c - quiff_c).length) / 0.06) ** 2)
        for p in me.polygons:
            p.use_smooth = True
        me.update()
        if key in CURTAINS:
            join_curtain(mo, curtain(key, *CURTAINS[key]))
            me = mo.data
        out.append(mo)
        print(f'coiffure {key} : {len(me.vertices)} sommets, {len(me.polygons)} triangles')

    # Chignon : boule haute à l'arrière du crâne (avec la coque « slick »).
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=14, v_segments=10, radius=0.03)
    for v in bm.verts:
        v.co = Vector((v.co.x * 1.0, v.co.y * 0.95, v.co.z * 0.8)) + Vector((0, back_y - 0.004, ztop - 0.03))
    me = bpy.data.meshes.new('rider_hair_bun')
    bm.to_mesh(me)
    bm.free()
    bun = bpy.data.objects.new('rider_hair_bun', me)
    bpy.context.scene.collection.objects.link(bun)
    me.materials.append(hair_material())
    for p in me.polygons:
        p.use_smooth = True
    skin_to_head(bun, rig)
    out.append(bun)
    return out


# ---------------------------------------------------------------------------------------------
# Casque route et lunettes : modélisés sur la tête (pose debout, liés à l'os de la tête)
# ---------------------------------------------------------------------------------------------
# Aérations longitudinales, doublées de part et d'autre du milieu : centre latéral s (0 : milieu,
# 1 : bord au-dessus de l'oreille), début et fin t (0 : bord avant, 1 : bord arrière), demi-largeur
# (en s), rétrécissement vers l'arrière (0 à 1).
HELMET_VENTS = ((0.10, 0.10, 0.60, 0.066, 0.45),
                (0.33, 0.09, 0.55, 0.075, 0.50),
                (0.57, 0.15, 0.47, 0.062, 0.55),
                (0.20, 0.68, 0.88, 0.058, 0.25))
HELMET_NS, HELMET_NT = 48, 56   # mailles de la coque : en travers, d'avant en arrière


def gear_material(name):
    return bpy.data.materials.get(name) or bpy.data.materials.new(name)


def head_surface(objs, sheets=()):
    """Surface extérieure de la tête et de ce qui la couvre : premier point touché par un rayon
    venu de loin, point le plus proche et distance signée (négative dedans). `sheets` : indices
    des feuilles ouvertes (coque de cheveux), ignorées au-delà de leur bord."""
    from mathutils.bvhtree import BVHTree
    trees = []
    for o in objs:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.transform(o.matrix_world)
        trees.append(BVHTree.FromBMesh(bm))
        bm.free()

    def ray_in(origin, d, far=0.4):
        best = None
        for t in trees:
            hit = t.ray_cast(origin + d * far, -d, far)
            if hit[0] is not None and (best is None or hit[3] < best[2]):
                best = (hit[0], hit[1], hit[3])
        return best

    def nearest(p):
        best = None
        for k, t in enumerate(trees):
            loc, nrm, _, dist = t.find_nearest(p)
            if loc is None:
                continue
            sd = (p - loc).dot(nrm)
            if k in sheets and ((p - loc) - nrm * sd).length > 0.0015:
                continue
            if best is None or sd < best[2]:
                best = (loc, nrm, sd)
        return best
    return ray_in, nearest


def catmull(pts, step):
    """Courbe de Catmull-Rom par les points, rééchantillonnée tous les `step` mètres."""
    ext = [pts[0] * 2 - pts[1]] + list(pts) + [pts[-1] * 2 - pts[-2]]
    dense = []
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for k in range(20):
            t = k / 20
            dense.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    dense.append(pts[-1].copy())
    total = sum((b - a).length for a, b in zip(dense, dense[1:]))
    n = max(2, int(total / step) + 1)
    out, acc, k = [dense[0].copy()], 0.0, 0
    for i in range(1, n):
        target = total * i / (n - 1)
        while k < len(dense) - 2 and acc + (dense[k + 1] - dense[k]).length < target:
            acc += (dense[k + 1] - dense[k]).length
            k += 1
        seg = (dense[k + 1] - dense[k]).length
        out.append(dense[k].lerp(dense[k + 1], min(1.0, (target - acc) / max(seg, 1e-9))))
    return out


def lie_on(path, nearest, off, rounds=6):
    """Chemin tendu posé sur la peau : ressorti à `off` au moins et lissé, bouts fixes."""
    pts = [p.copy() for p in path]

    def push():
        for i, p in enumerate(pts):
            loc, nrm, sd = nearest(p)
            if sd < off:
                pts[i] = loc + nrm * off
    for _ in range(rounds):
        push()
        pts = [p if i in (0, len(pts) - 1) else (pts[i - 1] + p * 2 + pts[i + 1]) / 4 for i, p in enumerate(pts)]
    push()
    return pts


def drape(pts, nearest, near_all, off, spread=0.007):
    """Chemin posé sur la peau puis soulevé en bosse douce là où il croise autre chose (branche
    des lunettes) : soulèvement nécessaire étalé le long du chemin (gaussienne de `spread` m)."""
    pts = lie_on(pts, nearest, off)
    s = [0.0]
    for a, b in zip(pts, pts[1:]):
        s.append(s[-1] + (b - a).length)
    need = [(si, off - near_all(p)[2]) for si, p in zip(s, pts) if near_all(p)[2] < off]
    out = []
    for si, p in zip(s, pts):
        lift = max([n * math.exp(-((si - sj) / spread) ** 2) for sj, n in need] + [0.0])
        out.append(p + nearest(p)[1] * lift * 1.15)
    return out


def ribbon(bm, pts, nearest, width, thick, mat, ring_ids=None, ring0=0):
    """Bande plate le long du chemin : largeur à plat sur la peau (orientée par `nearest`),
    épaisseur vers l'extérieur, arêtes vives (une sangle, pas un tube)."""
    rings = []
    tgs = [(pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized() for i in range(len(pts))]
    # Normales de la peau lissées le long du chemin : la bande ne vrille pas d'une face à l'autre.
    nrms = [nearest(p)[1].copy() for p in pts]
    for _ in range(8):
        nrms = [(nrms[max(i - 1, 0)] + nrms[i] * 2 + nrms[min(i + 1, len(nrms) - 1)]).normalized() for i in range(len(nrms))]
    for i, p in enumerate(pts):
        tg, nrm = tgs[i], nrms[i]
        nn = (nrm - tg * nrm.dot(tg)).normalized()
        b = tg.cross(nn)
        w = width(i / max(1, len(pts) - 1)) if callable(width) else width
        rings.append([bm.verts.new(p + b * w / 2 * sx + nn * thick * sy / 2) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
        if ring_ids is not None:
            for v in rings[-1]:
                ring_ids[v] = ring0 + i
    for a, c in zip(rings, rings[1:]):
        for q in range(4):
            bm.faces.new((a[q], a[(q + 1) % 4], c[(q + 1) % 4], c[q])).material_index = mat
    for r in (rings[0], rings[-1]):
        bm.faces.new(r).material_index = mat
    for r in rings:
        for q in range(4):
            e = bm.edges.get((r[q], r[(q + 1) % 4]))
            if e:
                e.smooth = False
    for a, c in zip(rings, rings[1:]):
        for q in range(4):
            bm.edges.get((a[q], c[q])).smooth = False
    return ring0 + len(pts)


def block(bm, center, ax, ay, az, size, mat, ring_ids=None, ring=None, bevel=0.3):
    """Pavé aux coins chanfreinés (boucles, plaquettes) : axes ax, ay, az, demi-côtés `size`."""
    sx, sy, sz = size
    c = bevel
    prof = [(-1 + c, -1), (1 - c, -1), (1, -1 + c), (1, 1 - c), (1 - c, 1), (-1 + c, 1), (-1, 1 - c), (-1, -1 + c)]
    bot = [bm.verts.new(center + ax * px * sx + ay * py * sy - az * sz) for px, py in prof]
    top = [bm.verts.new(center + ax * px * sx + ay * py * sy + az * sz) for px, py in prof]
    n = len(prof)
    for q in range(n):
        bm.faces.new((bot[q], bot[(q + 1) % n], top[(q + 1) % n], top[q])).material_index = mat
    bm.faces.new(top).material_index = mat
    bm.faces.new(list(reversed(bot))).material_index = mat
    for r in (top, bot):
        for q in range(n):
            bm.edges.get((r[q], r[(q + 1) % n])).smooth = False
    if ring_ids is not None:
        for v in top + bot:
            ring_ids[v] = ring


def gear_object(name, bm, mats, rig):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for n in mats:
        me.materials.append(gear_material(n))
    for p in me.polygons:
        p.use_smooth = True
    skin_to_head(ob, rig)
    return ob


def build_headgear(body, eyes, rig, styles):
    """Casque route compact (Van Rysel RCR, POC Omne Air) : coque arrondie à grandes aérations
    longitudinales, bord avant bas et presque droit au-dessus des sourcils, arrière descendu sur
    l'occiput ; berceau et molette de serrage dessous ; sangles fines en Y (une branche devant
    l'oreille, une derrière) réunies par un séparateur sous le lobe, puis sous la mâchoire jusqu'à
    la boucle. Lunettes à grand écran (build_glasses). Matériaux : « helmet » (coque, couleur du
    joueur), « helmet_detail » (intérieur, tranche, berceau, sangles), « lens », « glasses_frame »."""
    m = MOUTH[0]
    eye_z = m.z + 0.072
    vs = [v.co.copy() for v in body.data.vertices]
    heads = [c for c in vs if c.z > eye_z - 0.02]
    back_y = max(c.y for c in vs if c.z > m.z + 0.05 and abs(c.x) < 0.02)
    ycen = (min(c.y for c in heads) + back_y) / 2
    H = Vector((0.0, ycen, eye_z + 0.01))
    phi = lambda c: math.atan2(abs(c.x), -(c.y - ycen))
    band = [c for c in vs if eye_z - 0.075 < c.z < eye_z + 0.04]
    x_ref = max(abs(c.x) for c in band if 1.0 < phi(c) < 1.15)
    ear = [c for c in vs if eye_z - 0.11 < c.z < eye_z + 0.04 and abs(c.x) > x_ref + 0.008 and 1.2 < phi(c) < 2.3]
    ear_top = max(ear, key=lambda c: c.z)
    e_top = ear_top.z - eye_z
    lobe = min(ear, key=lambda c: c.z)
    pe0, pe1 = min(phi(c) for c in ear), max(phi(c) for c in ear)
    slick = next(o for o in styles if o.name == 'rider_hairs_slick')
    ray_in, nearest = head_surface([body, slick], sheets=(1,))

    # Bord : hauteur (au-dessus des yeux) selon l'azimut (0 : devant, π : derrière).
    keys = [(0.0, 0.025), (0.85, 0.028), (pe0 - 0.12, max(0.027, e_top + 0.02)), ((pe0 + pe1) / 2, e_top + 0.021),
            (pe1 + 0.2, e_top + 0.004), (2.65, -0.026), (math.pi, -0.040)]

    def rim_z(a):
        a = abs(math.atan2(math.sin(a), math.cos(a)))
        for k in range(len(keys) - 1):
            (a0, z0), (a1, z1) = keys[k], keys[k + 1]
            if a <= a1:
                # Hermite, pentes de Catmull-Rom (nulles aux bouts : bord symétrique).
                d0 = 0.0 if k == 0 else (z1 - keys[k - 1][1]) / (a1 - keys[k - 1][0])
                d1 = 0.0 if k + 2 >= len(keys) else (keys[k + 2][1] - z0) / (keys[k + 2][0] - a0)
                t, h = (a - a0) / (a1 - a0), a1 - a0
                return eye_z + (2 * t ** 3 - 3 * t * t + 1) * z0 + (t ** 3 - 2 * t * t + t) * h * d0 + (-2 * t ** 3 + 3 * t * t) * z1 + (t ** 3 - t * t) * h * d1
        return eye_z + keys[-1][1]

    def head_dir(az, el):
        return Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))

    def rim_dir(az):
        """Direction (depuis H) du point de la tête à la hauteur du bord."""
        target = rim_z(az)
        lo, hi = -1.0, 1.2
        for _ in range(30):
            el = (lo + hi) / 2
            hit = ray_in(H, head_dir(az, el))
            if (hit[0].z if hit else H.z) < target:
                lo = el
            else:
                hi = el
        return head_dir(az, (lo + hi) / 2)

    def to_uv(d):
        u = math.atan2(d.z, -d.y)
        if u < -math.pi / 2:
            u += 2 * math.pi
        return u, math.asin(max(-1.0, min(1.0, d.x)))

    def from_uv(u, v):
        return Vector((math.sin(v), -math.cos(v) * math.cos(u), math.cos(v) * math.sin(u)))

    # Coque : carreau de Coons en (u, v) (u : du front vers la nuque par le sommet, v : vers le côté)
    # entre le bord avant, les côtés au-dessus des oreilles et le bord arrière.
    A1, A2 = 1.05, pe1 + 0.32   # coins : tempe, derrière l'oreille
    NS, NT = HELMET_NS, HELMET_NT
    ss = [-1 + 2 * j / NS for j in range(NS + 1)]
    ts = [i / NT for i in range(NT + 1)]
    F = [to_uv(rim_dir(s * A1)) for s in ss]
    Bk = [to_uv(rim_dir(math.pi - (math.pi - A2) * s)) for s in ss]
    L = [to_uv(rim_dir(-(A1 + (A2 - A1) * t))) for t in ts]
    R = [to_uv(rim_dir(A1 + (A2 - A1) * t)) for t in ts]

    def coons(s, t):
        fj = min(max((s + 1) / 2 * NS, 0.0), NS - 1e-9)
        fi = min(max(t * NT, 0.0), NT - 1e-9)
        j0, i0 = int(fj), int(fi)
        a, b = fj - j0, fi - i0
        sg = (s + 1) / 2
        out = []
        for c in (0, 1):
            f = F[j0][c] * (1 - a) + F[j0 + 1][c] * a
            bk = Bk[j0][c] * (1 - a) + Bk[j0 + 1][c] * a
            le = L[i0][c] * (1 - b) + L[i0 + 1][c] * b
            ri = R[i0][c] * (1 - b) + R[i0 + 1][c] * b
            out.append((1 - t) * f + t * bk + (1 - sg) * le + sg * ri
                       - ((1 - sg) * (1 - t) * F[0][c] + sg * (1 - t) * F[NS][c] + (1 - sg) * t * Bk[0][c] + sg * t * Bk[NS][c]))
        return out

    # Aérations : trous dans la grille, sommets du bord glissés sur le contour (en travers sur les
    # côtés, d'avant en arrière aux bouts : pas d'escalier ni de maille retournée).
    def vent_half(vent, t):
        c, t0, t1, w, taper = vent
        tau = (t - t0) / (t1 - t0)
        if not 0.0 < tau < 1.0:
            return 0.0
        return w * (1 - abs(2 * tau - 1) ** 3.5) ** (1 / 3.5) * (1 - taper * tau)
    vents = [(sx * c, t0, t1, w, tp) for c, t0, t1, w, tp in HELMET_VENTS for sx in (-1, 1)]
    hole = [[any(abs((ss[j] + ss[j + 1]) / 2 - v[0]) < vent_half(v, (ts[i] + ts[i + 1]) / 2) for v in vents)
             for j in range(NS)] for i in range(NT)]
    KS, KT = 0.10, 0.33   # longueur sur la coque d'une unité de s et de t (m)
    st = [[(ss[j], ts[i]) for j in range(NS + 1)] for i in range(NT + 1)]
    for i in range(NT + 1):
        for j in range(NS + 1):
            adj = [hole[a][b] for a in (i - 1, i) for b in (j - 1, j) if 0 <= a < NT and 0 <= b < NS]
            if not any(adj) or all(adj):
                continue
            s, t = st[i][j]
            cands = []
            for v in vents:
                hw = vent_half(v, t)
                if hw > 0:
                    cands.append((v[0] + math.copysign(hw, s - v[0]), t))
                d = abs(s - v[0])
                if d < v[3]:
                    grid = [v[1] + (v[2] - v[1]) * k / 200 for k in range(201)]
                    for ta, tb in zip(grid, grid[1:]):
                        ha, hb = vent_half(v, ta) - d, vent_half(v, tb) - d
                        if ha * hb <= 0 and ha != hb:
                            cands.append((s, ta + (tb - ta) * ha / (ha - hb)))
            if cands:
                st[i][j] = min(cands, key=lambda p: ((p[0] - s) * KS) ** 2 + ((p[1] - t) * KT) ** 2)
    dirs = [[from_uv(*coons(*st[i][j])) for j in range(NS + 1)] for i in range(NT + 1)]
    raw = [[((ray_in(H, dirs[i][j]) or (H,))[0] - H).length for j in range(NS + 1)] for i in range(NT + 1)]

    def smooth(f, n):
        g = [row[:] for row in f]
        nb = lambda i, j: [(a, b) for a, b in ((i - 1, j), (i + 1, j), (i, j - 1), (i, j + 1)) if 0 <= a <= NT and 0 <= b <= NS]
        for _ in range(n):
            g = [[(g[i][j] * 2 + sum(g[a][b] for a, b in nb(i, j))) / (2 + len(nb(i, j))) for j in range(NS + 1)] for i in range(NT + 1)]
        return g
    sm = smooth(raw, 6)
    r_in = [[max(sm[i][j], raw[i][j]) + 0.004 for j in range(NS + 1)] for i in range(NT + 1)]
    sm2 = smooth(r_in, 40)
    r_out = []
    for i in range(NT + 1):
        row = []
        for j in range(NS + 1):
            s, t = st[i][j]
            th = 0.012 + 0.008 * math.sin(math.pi * min(max(t, 0.0), 1.0)) ** 0.6 * (1 - 0.4 * s * s)
            r = max(sm2[i][j] + th, r_in[i][j] + 0.010)
            edge = min(i, NT - i, j, NS - j)
            r -= (0.0035, 0.0012)[edge] if edge < 2 else 0.0   # bord arrondi
            row.append(r)
        r_out.append(row)

    bm = bmesh.new()
    O = [[bm.verts.new(H + dirs[i][j] * r_out[i][j]) for j in range(NS + 1)] for i in range(NT + 1)]
    I = [[bm.verts.new(H + dirs[i][j] * r_in[i][j]) for j in range(NS + 1)] for i in range(NT + 1)]
    SHELL, DETAIL = 0, 1
    for i in range(NT):
        for j in range(NS):
            if not hole[i][j]:
                bm.faces.new((O[i][j], O[i][j + 1], O[i + 1][j + 1], O[i + 1][j])).material_index = SHELL
                bm.faces.new((I[i + 1][j], I[i + 1][j + 1], I[i][j + 1], I[i][j])).material_index = DETAIL
    # Tranches : bord du casque (intérieur foncé) et parois des aérations (couleur de la coque).
    sharp = []
    for i in range(NT + 1):
        for j in range(NS + 1):
            for di, dj in ((0, 1), (1, 0)):
                i2, j2 = i + di, j + dj
                if i2 > NT or j2 > NS:
                    continue
                side = [hole[a][j] for a in (i - 1, i) if 0 <= a < NT] if di == 0 else [hole[i][b] for b in (j - 1, j) if 0 <= b < NS]
                if sum(1 for h in side if not h) != 1:
                    continue
                f = bm.faces.new((O[i][j], I[i][j], I[i2][j2], O[i2][j2]))
                f.material_index = DETAIL if len(side) == 1 else SHELL
                sharp += [(O[i][j], O[i2][j2]), (I[i][j], I[i2][j2])]
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    for a, b in sharp:
        e = bm.edges.get((a, b))
        if e:
            e.smooth = False
    # Sommets recalés au même point du contour (bouts des aérations) : fusionnés.
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=0.0002)
    bmesh.ops.dissolve_degenerate(bm, dist=0.0002, edges=bm.edges[:])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])

    # Berceau et molette de serrage, sous l'arrière de la coque.
    def on_head(az, z, off):
        hit = ray_in(Vector((0.0, ycen, z)), Vector((math.sin(az), -math.cos(az), 0.0)))
        loc, nrm, _ = nearest(hit[0])
        return loc + nrm * off
    cz = lobe.z - 0.004
    cradle = [on_head(a * sx, z, 0.004) for sx, a, z in (
        (1, A2 - 0.25, rim_z(A2 - 0.25) + 0.012), (1, A2 + 0.1, (rim_z(A2) + cz) / 2 + 0.006), (1, 2.75, cz + 0.004),
        (1, math.pi, cz), (-1, 2.75, cz + 0.004), (-1, A2 + 0.1, (rim_z(A2) + cz) / 2 + 0.006), (-1, A2 - 0.25, rim_z(A2 - 0.25) + 0.012))]
    ribbon(bm, lie_on(catmull(cradle, 0.004), nearest, 0.004), nearest, 0.011, 0.003, DETAIL)
    loc, nrm, _ = nearest(on_head(math.pi, cz, 0.0))
    ax = Vector((0, 0, 1)).cross(nrm).normalized()
    ay = nrm.cross(ax)
    nd = 28
    ring_b, ring_o, cap = [], [], []
    for k in range(nd):
        dv = ax * math.cos(2 * math.pi * k / nd) + ay * math.sin(2 * math.pi * k / nd)
        rr = 0.0145 if k % 2 == 0 else 0.0133   # molette crantée
        ring_b.append(bm.verts.new(loc + nrm * 0.005 + dv * rr))
        ring_o.append(bm.verts.new(loc + nrm * 0.0135 + dv * rr))
        cap.append(bm.verts.new(loc + nrm * 0.0145 + dv * 0.011))
    for k in range(nd):
        k2 = (k + 1) % nd
        bm.faces.new((ring_b[k], ring_b[k2], ring_o[k2], ring_o[k])).material_index = DETAIL
        bm.faces.new((ring_o[k], ring_o[k2], cap[k2], cap[k])).material_index = DETAIL
    bm.faces.new(cap).material_index = DETAIL
    bm.faces.new(list(reversed(ring_b))).material_index = DETAIL
    for k in range(nd):
        for r in (ring_o, cap):
            bm.edges.get((r[k], r[(k + 1) % nd])).smooth = False
    helmet = gear_object('rider_helmet', bm, ('helmet', 'helmet_detail'), rig)

    glasses = build_glasses(body, eyes, rig, nearest, ray_in, eye_z, ear_top)

    # Sangles en Y : branches devant et derrière l'oreille (par-dessus les branches des lunettes),
    # séparateur sous le lobe, jugulaire sous la mâchoire jusqu'à la boucle.
    _, near_g = head_surface([body, slick, glasses], sheets=(1,))
    bm = bmesh.new()
    ring_ids = {}
    ring = 0
    # Boucle sous le menton, 3,5 cm derrière la lèvre : dessous de la mâchoire cherché par en bas.
    hit = ray_in(Vector((0.0, m.y + 0.035, m.z - 0.02)), Vector((0.0, 0.0, -1.0)), 0.08)
    chin = lie_on([hit[0] if hit else Vector((0.0, m.y + 0.035, m.z - 0.056))], nearest, 0.003)[0]
    halves = []
    for sx in (-1, 1):
        loc, nrm, _ = nearest(Vector((sx * abs(lobe.x), lobe.y, lobe.z)) + Vector((-sx * 0.012, -0.008, -0.009)))
        div = loc + nrm * 0.004
        for a in (sx * (pe0 - 0.34), sx * (pe1 + 0.28)):
            top = on_head(a, rim_z(a) + 0.014, 0.0025)
            # Par-dessus les branches des lunettes, à plat selon la tête (sans vriller).
            ring = ribbon(bm, drape(catmull([top, top.lerp(div, 0.5), div], 0.003), nearest, near_g, 0.0025),
                          nearest, 0.009, 0.0013, 0, ring_ids, ring)
        halves.append([div, div.lerp(chin, 0.45) + Vector((0, 0.008, -0.01))])
        tg = (chin - div).normalized()
        nn = (nrm - tg * nrm.dot(tg)).normalized()
        block(bm, div, tg.cross(nn), tg, nn, (0.008, 0.0105, 0.0018), 0, ring_ids, ring)
        ring += 1
    p = lie_on(catmull(halves[0] + [chin] + list(reversed(halves[1])), 0.004), nearest, 0.0028)
    ring = ribbon(bm, p, nearest, 0.0105, 0.0013, 0, ring_ids, ring)
    _, nrm, _ = nearest(chin)
    tg = (p[len(p) // 2 + 1] - p[len(p) // 2 - 1]).normalized()
    nn = (nrm - tg * nrm.dot(tg)).normalized()
    block(bm, chin + nn * 0.0012, tg, tg.cross(nn), nn, (0.015, 0.008, 0.0028), 0, ring_ids, ring)
    rid = [ring_ids.get(v, -1) for v in bm.verts]
    straps = gear_object('rider_helmet_straps', bm, ('helmet_detail',), rig)
    straps.data.attributes.new('strap_ring', 'INT', 'POINT').data.foreach_set('value', rid)
    print(f'casque route : {len(helmet.data.polygons)} faces, sangles {len(straps.data.polygons)}, lunettes {len(glasses.data.polygons)} ; '
          f'oreille haut {100 * e_top:+.1f} cm, lobe {100 * (lobe.z - eye_z):+.1f} cm des yeux')
    return [helmet, straps, glasses]


def build_glasses(body, eyes, rig, nearest, ray_in, eye_z, ear_top):
    """Lunettes de vélo à grand écran (Oakley Sutro, Van Rysel…) : un seul verre cintré d'une tempe
    à l'autre, du haut des sourcils au milieu des pommettes, échancré en V sur le nez ; barre de
    monture fine en haut seulement, plaquettes de nez, branches fines et droites qui passent
    par-dessus l'oreille (sous les sangles du casque)."""
    ev = [eyes.matrix_world @ v.co for v in eyes.data.vertices]
    y_eye = min(c.y for c in ev)
    X = max(abs(c.x) for c in ev) + 0.026        # demi-largeur de l'écran
    T, Bo, rc = eye_z + 0.024, eye_z - 0.037, 0.014   # haut, bas sur les pommettes, rayon des coins
    y0 = y_eye - 0.016

    def skin_y(x, z):
        hit = ray_in(Vector((x, y_eye + 0.1, z)), Vector((0.0, -1.0, 0.0)), 0.3)
        return hit[0].y if hit else 1.0

    # Verre : cintré en largeur (plus fort vers les tempes), un peu en hauteur ; avancé là où il
    # passerait à moins de 9 mm de la peau (cils, sourcils, pommettes ; 5 mm aux tempes).
    NJ, NI = 48, 14
    xs = [X * math.sin(math.pi / 2 * (2 * j / NJ - 1)) for j in range(NJ + 1)]
    # Bas de l'écran incliné vers le visage (≈ 9°).
    base = lambda x, z: y0 + x * x / 0.17 + 900 * x ** 4 + (z - eye_z) ** 2 / 0.24 + (eye_z + 0.01 - z) * 0.16

    def top(x):
        a = abs(x) - (X - rc)
        return T - 0.003 * (x / X) ** 2 - (rc - math.sqrt(max(rc * rc - a * a, 0.0)) if a > 0 else 0.0)

    def low(x):
        a = abs(x) - (X - rc)
        z = Bo + 0.017 * smoothstep(0.025, X, abs(x)) ** 1.6
        return z + (rc - math.sqrt(max(rc * rc - a * a, 0.0)) if a > 0 else 0.0)
    push = []
    for x in xs:
        clear = 0.009 if abs(x) < X - 0.018 else 0.005
        zs = [low(x) + (top(x) - low(x)) * k / 10 for k in range(11)]
        if abs(x) < 0.02:
            zs = [z for z in zs if z > eye_z - 0.004]   # le nez est traité par l'échancrure
        push.append(max([base(x, z) - (skin_y(x, z) - clear) for z in zs] + [0.0]))
    for _ in range(8):
        push = [max(push[j], (push[max(j - 1, 0)] + push[j] * 2 + push[min(j + 1, NJ)]) / 4) for j in range(NJ + 1)]
    sym = [max(push[j], push[NJ - j]) for j in range(NJ + 1)]
    lens_y = lambda j, z: base(xs[j], z) - sym[j]
    # Échancrure du nez en V : le bas du verre remonte jusqu'à passer à 4 mm devant le nez.
    def nose_clear(j):
        zz = eye_z - 0.002
        while zz > Bo and skin_y(xs[j], zz) > lens_y(j, zz) + 0.004:
            zz -= 0.0005
        return zz + 0.003
    near_nose = [j for j in range(NJ + 1) if abs(xs[j]) < 0.02]
    req = {j: nose_clear(j) for j in near_nose}
    apex = max(req.values())
    slope = min([1.8] + [(apex - req[j]) / abs(xs[j]) for j in near_nose if abs(xs[j]) > 0.004])
    slope = max(slope, 0.7)
    bottom = [max(low(x), apex - slope * abs(x)) for x in xs]
    bm = bmesh.new()
    LENS, FRAME = 0, 1
    front, back = [], []
    for j, x in enumerate(xs):
        zt = top(x)
        col_f, col_b = [], []
        for i in range(NI + 1):
            z = bottom[j] + (zt - bottom[j]) * i / NI
            y = lens_y(j, z)
            col_f.append(bm.verts.new((x, y, z)))
            col_b.append(bm.verts.new((x, y + 0.0018, z)))
        front.append(col_f)
        back.append(col_b)
    for j in range(NJ):
        for i in range(NI):
            bm.faces.new((front[j][i], front[j + 1][i], front[j + 1][i + 1], front[j][i + 1])).material_index = LENS
            bm.faces.new((back[j][i + 1], back[j + 1][i + 1], back[j + 1][i], back[j][i])).material_index = LENS
    loop = [(j, 0) for j in range(NJ)] + [(NJ, i) for i in range(NI)] + [(j, NI) for j in range(NJ, 0, -1)] + [(0, i) for i in range(NI, 0, -1)]
    for k, (j, i) in enumerate(loop):
        j2, i2 = loop[(k + 1) % len(loop)]
        bm.faces.new((front[j][i], back[j][i], back[j2][i2], front[j2][i2])).material_index = LENS
        bm.edges.get((front[j][i], front[j2][i2])).smooth = False
        bm.edges.get((back[j][i], back[j2][i2])).smooth = False
    # Barre de monture en haut (le verre y est serti), d'un coin à l'autre.
    bar = []
    for j, x in enumerate(xs):
        zt = top(x)
        fx = (lens_y(min(j + 1, NJ), zt) - lens_y(max(j - 1, 0), zt)) / max(xs[min(j + 1, NJ)] - xs[max(j - 1, 0)], 1e-6)
        fwd = Vector((fx, -1.0, 0.0)).normalized()
        up = Vector((0.0, 0.0, 1.0))
        c = Vector((x, lens_y(j, zt) + 0.0009, zt + 0.0006))
        bar.append([bm.verts.new(c + fwd * dy + up * dz) for dy, dz in ((0.003, -0.0022), (0.003, 0.0024), (-0.0028, 0.0024), (-0.0028, -0.0022))])
    for a, c in zip(bar, bar[1:]):
        for q in range(4):
            bm.faces.new((a[q], a[(q + 1) % 4], c[(q + 1) % 4], c[q])).material_index = FRAME
            bm.edges.get((a[q], c[q])).smooth = False
    for r in (bar[0], bar[-1]):
        bm.faces.new(r).material_index = FRAME
    # Pont de nez en V et plaquettes posées sur le nez.
    for sx in (-1, 1):
        loc, nrm, _ = nearest(Vector((sx * 0.0085, y_eye - 0.004, eye_z - 0.017)))
        tg = Vector((0.0, 0.0, 1.0))
        tg = (tg - nrm * tg.dot(nrm)).normalized()
        block(bm, loc + nrm * 0.0022, nrm.cross(tg), tg, nrm, (0.0035, 0.0065, 0.0015), FRAME)
    # Branches : de la charnière (coin haut de l'écran) jusque derrière l'oreille, posées sur la
    # racine de l'oreille.
    for sx, j_end in ((-1, 0), (1, NJ)):
        zt = top(xs[j_end]) - 0.006
        hinge = Vector((xs[j_end] - sx * 0.002, lens_y(j_end, zt) + 0.004, zt))
        over = Vector((sx * abs(ear_top.x), ear_top.y, ear_top.z + 0.003))
        hit = ray_in(Vector((0.0, over.y, over.z)), Vector((sx, 0.0, 0.0)))
        over.x = hit[0].x + sx * 0.0018
        mid = hinge.lerp(over, 0.45)
        end = over + Vector((sx * -0.004, 0.026, -0.016))
        path = lie_on(catmull([hinge, mid, over, over + Vector((0, 0.012, -0.004)), end], 0.003), nearest, 0.0018)
        ribbon(bm, path, nearest, lambda t: 0.0055 - 0.002 * smoothstep(0.0, 0.5, t), 0.0024, FRAME)
        block(bm, hinge + Vector((sx * -0.0005, -0.002, 0.0)), Vector((0.0, 1.0, 0.0)), Vector((0.0, 0.0, 1.0)), Vector((sx, 0.0, 0.0)), (0.005, 0.0045, 0.0018), FRAME)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return gear_object('rider_glasses', bm, ('lens', 'glasses_frame'), rig)


def settle_straps(straps, body, slick, glasses):
    """Après la pose : chaque section de sangle ressortie d'un bloc de la peau (le cou et la
    mâchoire ne suivent pas exactement l'os de la tête)."""
    _, nearest = head_surface([body, slick, glasses], sheets=(1,))
    me = straps.data
    att = me.attributes['strap_ring']
    rings = {}
    for v, d in zip(me.vertices, att.data):
        rings.setdefault(d.value, []).append(v)
    moved = 0
    for r, vs in rings.items():
        need = Vector()
        for v in vs:
            loc, nrm, sd = nearest(straps.matrix_world @ v.co)
            if sd < 0.0008 and (0.0008 - sd) > need.length:
                need = nrm * (0.0008 - sd)
        if need.length > 0:
            moved += 1
            for v in vs:
                v.co += need
    me.attributes.remove(me.attributes['strap_ring'])
    me.update()
    print(f'sangles : {moved} sections ressorties de la peau après la pose')


def fix_material_names(objs):
    """Matériaux dédoublés à l'import (« hair.001 ») ramenés à leur nom (le client s'en sert)."""
    import re
    for o in objs:
        for slot in o.material_slots:
            mt = slot.material
            if mt and re.match(r'.*\.\d{3}$', mt.name):
                base = bpy.data.materials.get(mt.name[:-4])
                if base:
                    slot.material = base


# ---------------------------------------------------------------------------------------------
# Niveaux de détail (docs/AVATARS.md § 8)
# ---------------------------------------------------------------------------------------------
# Suffixe, réduction du corps (depuis le niveau 0), des accessoires, ourlets protégés.
LODS = (('_lod1', 0.4, 0.6, True), ('_lod2', 0.2, 0.3, False))


def border_verts(me):
    """Sommets au bord de deux matériaux (ourlets de la tenue), et leurs voisins."""
    mats = {}
    for p in me.polygons:
        for k in p.edge_keys:
            mats.setdefault(k, set()).add(p.material_index)
    border = {v for k, m in mats.items() if len(m) > 1 for v in k}
    ring = set(border)
    for e in me.edges:
        a, b = e.vertices
        if a in border or b in border:
            ring.update((a, b))
    return ring


def decimate_group(ob, protect_head):
    """Groupe « decimate » : 1 = libre, 0 = protégé (ourlets ; tête si demandé)."""
    hg = ob.vertex_groups.get('head')
    ng = ob.vertex_groups.get('neck_01')
    keep = border_verts(ob.data)
    g = ob.vertex_groups.new(name='decimate')
    for v in ob.data.vertices:
        w = 0.0
        if protect_head:
            for ge in v.groups:
                if (hg and ge.group == hg.index) or (ng and ge.group == ng.index):
                    w = max(w, ge.weight)
        f = 0.0 if v.index in keep else 1.0 - min(1.0, w * 2)
        g.add([v.index], f, 'REPLACE')


BODY_RATIO = 0.45                         # part des triangles gardée au niveau 0 avec --reduce-body


def reduce_body(body, ratio=BODY_RATIO):
    """Niveau 0 : corps décimé hors de la tête (protégée par son poids d'os : visage, expressions
    et curseurs intacts) ; toutes les cibles reportées depuis l'original."""
    if not args.reduce_body:
        print(f'corps (niveau 0) : {sum(len(p.vertices) - 2 for p in body.data.polygons)} triangles, non simplifié')
        return body
    from mathutils import kdtree
    c = body.copy()
    c.data = body.data.copy()
    bpy.context.scene.collection.objects.link(c)
    c.shape_key_clear()
    decimate_group(c, protect_head=True)
    dec = c.modifiers.new('Decimate', 'DECIMATE')
    dec.ratio = ratio
    dec.vertex_group = 'decimate'
    dec.vertex_group_factor = 1.0
    dec.use_collapse_triangulate = True
    set_active(c)
    bpy.ops.object.modifier_move_to_index(modifier='Decimate', index=0)
    bpy.ops.object.modifier_apply(modifier='Decimate')
    c.vertex_groups.remove(c.vertex_groups['decimate'])
    keys = body.data.shape_keys.key_blocks
    base = [d.co.copy() for d in keys['Basis'].data]
    kd = kdtree.KDTree(len(base))
    for i, p in enumerate(base):
        kd.insert(p, i)
    kd.balance()
    near = []
    for v in c.data.vertices:
        found = kd.find_n(v.co, 3)
        if found[0][2] < 1e-6:
            near.append([(found[0][1], 1.0)])
            continue
        w = [1 / max(d, 1e-5) for _, _, d in found]
        t = sum(w)
        near.append([(i, wi / t) for (_, i, _), wi in zip(found, w)])
    c.shape_key_add(name='Basis', from_mix=False)
    for kb in list(keys)[1:]:
        k = c.shape_key_add(name=kb.name, from_mix=False)
        for kd_, v, nb in zip(k.data, c.data.vertices, near):
            kd_.co = v.co + sum(((kb.data[i].co - base[i]) * w for i, w in nb), Vector())
        k.value = 0.0
    name = body.name
    bpy.data.objects.remove(body, do_unlink=True)
    c.name = c.data.name = name
    print(f'corps (niveau 0) : {sum(len(p.vertices) - 2 for p in c.data.polygons)} triangles')
    return c


def make_lods(rig, objs):
    """Copies décimées (poids des os interpolés par la décimation), sans expressions ; cibles
    d'identité reportées depuis l'original (moyenne pondérée des 3 sommets les plus proches)."""
    from mathutils import kdtree
    out = []
    for suffix, r_body, r_acc, hems in LODS:
        level = []
        for o in objs:
            c = o.copy()
            c.data = o.data.copy()
            bpy.context.scene.collection.objects.link(c)
            c.name = c.data.name = o.name + suffix
            if c.data.shape_keys:
                c.shape_key_clear()
            dec = c.modifiers.new('Decimate', 'DECIMATE')
            # Corps de près non simplifié : les niveaux gardent le nombre de triangles d'avant.
            dec.ratio = (r_body * (1.0 if args.reduce_body else BODY_RATIO)) if o.name == 'rider_body' else r_acc
            dec.use_collapse_triangulate = True
            if o.name == 'rider_body' and hems:
                decimate_group(c, protect_head=False)
                dec.vertex_group = 'decimate'
            set_active(c)
            bpy.ops.object.modifier_move_to_index(modifier='Decimate', index=0)
            bpy.ops.object.modifier_apply(modifier='Decimate')
            if 'decimate' in c.vertex_groups:
                c.vertex_groups.remove(c.vertex_groups['decimate'])
            keys = o.data.shape_keys.key_blocks if o.data.shape_keys else []
            ident = [kb for kb in list(keys)[1:] if kb.name[-1] in '+-']
            if ident:
                base = [d.co.copy() for d in keys['Basis'].data]
                kd = kdtree.KDTree(len(base))
                for i, p in enumerate(base):
                    kd.insert(p, i)
                kd.balance()
                near = []
                for v in c.data.vertices:
                    found = kd.find_n(v.co, 3)
                    w = [1 / max(d, 1e-5) for _, _, d in found]
                    t = sum(w)
                    near.append([(i, wi / t) for (_, i, _), wi in zip(found, w)])
                c.shape_key_add(name='Basis', from_mix=False)
                for kb in ident:
                    k = c.shape_key_add(name=kb.name, from_mix=False)
                    for kd_, v, nb in zip(k.data, c.data.vertices, near):
                        kd_.co = v.co + sum(((kb.data[i].co - base[i]) * w for i, w in nb), Vector())
                    k.value = 0.0
                prune_keys(c)
            tris = sum(len(p.vertices) - 2 for p in c.data.polygons)
            print(f'{c.name} : {tris} triangles')
            level.append(c)
        out.append((suffix, level))
    return out


# ---------------------------------------------------------------------------------------------
# Textures de peau (docs/AVATARS.md § 6)
# ---------------------------------------------------------------------------------------------
VENDOR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'vendor', 'makehuman')
SKIN_RES = 1024


def bake_skin_textures(body, eyes, out_dir):
    """skin_albedo.webp : peau MakeHuman jeune (CC0) divisée par sa teinte moyenne (variations
    relatives, ×0,5 : 1 = gris moyen), multipliée par le teint dans le client ; skin_masks.webp :
    R rougeur d'effort et sueur, G barbe, B rides (peau âgée / peau jeune, détail seul ;
    0,5 = neutre), A taches de rousseur. Zones calculées en 3D (pose debout) puis reportées
    dans l'espace UV par rastérisation des triangles."""
    import numpy as np
    from PIL import Image, ImageFilter
    N = SKIN_RES
    me = body.data
    uv = me.uv_layers.active.data
    pos = np.zeros((N, N, 3), np.float32)
    cov = np.zeros((N, N), bool)
    co = [v.co for v in me.vertices]
    for p in me.polygons:
        li = list(p.loop_indices)
        for k in range(1, len(li) - 1):
            tri = (li[0], li[k], li[k + 1])
            u = np.array([[uv[l].uv.x * N, (1 - uv[l].uv.y) * N] for l in tri])
            w = np.array([co[me.loops[l].vertex_index] for l in tri])
            x0, y0 = np.floor(u.min(0)).astype(int)
            x1, y1 = np.ceil(u.max(0)).astype(int)
            x0, y0 = max(x0, 0), max(y0, 0)
            x1, y1 = min(x1, N - 1), min(y1, N - 1)
            if x1 < x0 or y1 < y0:
                continue
            ys, xs = np.mgrid[y0:y1 + 1, x0:x1 + 1]
            P = np.stack([xs + 0.5, ys + 0.5], -1)
            a, b, c = u
            d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(d) < 1e-9:
                continue
            l1 = ((b[1] - c[1]) * (P[..., 0] - c[0]) + (c[0] - b[0]) * (P[..., 1] - c[1])) / d
            l2 = ((c[1] - a[1]) * (P[..., 0] - c[0]) + (a[0] - c[0]) * (P[..., 1] - c[1])) / d
            l3 = 1 - l1 - l2
            m = (l1 >= -0.01) & (l2 >= -0.01) & (l3 >= -0.01)
            if not m.any():
                continue
            q = l1[..., None] * w[0] + l2[..., None] * w[1] + l3[..., None] * w[2]
            pos[ys[m], xs[m]] = q[m]
            cov[ys[m], xs[m]] = True
    mouth = np.array(MOUTH[0])
    ev = [v.co for v in eyes.data.vertices]
    eye_l = np.array(sum((c for c in ev if c.x > 0), Vector()) / max(1, sum(1 for c in ev if c.x > 0)))
    eye_c = np.array([0.0, eye_l[1], eye_l[2]])

    def blob(center, r):
        d = np.linalg.norm(pos - np.array(center), axis=-1)
        return np.exp(-(d / r) ** 2) * cov

    def sstep(a, b, x):
        t = np.clip((x - a) / (b - a), 0, 1)
        return t * t * (3 - 2 * t)

    flush = np.zeros((N, N), np.float32)
    for sx in (1, -1):
        flush = np.maximum(flush, blob(mouth + [sx * 0.036, 0.012, 0.024], 0.024))  # pommettes
        flush = np.maximum(flush, 0.8 * blob(eye_c + [sx * 0.072, 0.075, -0.012], 0.02))  # oreilles
    flush = np.maximum(flush, blob(mouth + [0, -0.012, 0.03], 0.013))  # nez
    flush = np.maximum(flush, 0.6 * blob(eye_c + [0, -0.005, 0.055], 0.035))  # front
    x, y, z = pos[..., 0], pos[..., 1], pos[..., 2]
    beard = (sstep(mouth[2] + 0.03, mouth[2] + 0.012, z) * sstep(mouth[2] - 0.085, mouth[2] - 0.06, z)
             * sstep(eye_l[1] + 0.08, eye_l[1] + 0.055, y) * cov)
    beard *= 1 - 0.85 * blob(mouth + [0, 0.002, 0], 0.013)  # lèvres
    beard *= 1 - sstep(0.025, 0.045, np.abs(x)) * sstep(mouth[2] + 0.0, mouth[2] + 0.02, z)  # haut des joues
    # Taches de rousseur : petits points sur le nez et les pommettes.
    rng = np.random.default_rng(7)
    dots = np.zeros((N, N), np.float32)
    zone = np.maximum(blob(mouth + [0, -0.008, 0.035], 0.03), np.maximum(blob(mouth + [0.035, 0.008, 0.03], 0.025), blob(mouth + [-0.035, 0.008, 0.03], 0.025)))
    ys, xs = np.nonzero(zone > 0.2)
    for i in rng.choice(len(ys), size=min(len(ys), 900), replace=False) if len(ys) else []:
        cy, cx = ys[i], xs[i]
        r = rng.uniform(0.8, 2.2)
        yy, xx = np.mgrid[max(cy - 3, 0):min(cy + 4, N), max(cx - 3, 0):min(cx + 4, N)]
        dots[yy, xx] = np.maximum(dots[yy, xx], np.clip(1 - np.hypot(yy - cy, xx - cx) / r, 0, 1) * rng.uniform(0.4, 1))
    freckles = dots * zone
    # Rides : détail (passe-haut) de la peau âgée moins celui de la peau jeune.
    young = Image.open(os.path.join(VENDOR, 'young_lightskinned_male_diffuse.jpg')).convert('RGB').resize((N, N))
    old = Image.open(os.path.join(VENDOR, 'old_lightskinned_male_diffuse.jpg')).convert('RGB').resize((N, N))

    def hp(im):
        l = np.asarray(im.convert('L'), np.float32) / 255
        return l - np.asarray(im.convert('L').filter(ImageFilter.GaussianBlur(10)), np.float32) / 255

    wr = np.clip(0.5 + (hp(old) - hp(young)) * 2.5, 0, 1)
    ya = np.asarray(young, np.float32) / 255
    # Référence du teint : la couleur la plus fréquente (fond de la texture, teinte de base voulue
    # par MakeHuman) ; luminance relative, et teinte relative atténuée (garde lèvres et sourcils).
    q = (np.asarray(young) // 4).reshape(-1, 3)
    vals, counts = np.unique(q, axis=0, return_counts=True)
    mean = (vals[counts.argmax()] * 4 + 2).astype(np.float32) / 255
    lum = ya @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    mlum = float(mean @ np.array([0.2126, 0.7152, 0.0722], np.float32))
    chroma = (ya / np.maximum(lum[..., None], 1e-3)) / (mean / mlum)
    rel = np.clip((lum / mlum)[..., None] * (1 + (chroma - 1) * 0.7) * 0.5, 0, 1)
    print(f'peau : teinte moyenne {tuple(np.round(mean * 255).astype(int))}')
    Image.fromarray((rel * 255).astype(np.uint8)).save(os.path.join(out_dir, 'skin_albedo.webp'), quality=88)
    masks = np.stack([flush, beard, wr, freckles], -1)
    Image.fromarray((np.clip(masks, 0, 1) * 255).astype(np.uint8), 'RGBA').save(os.path.join(out_dir, 'skin_masks.webp'), lossless=True, exact=True)


# ---------------------------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------------------------
def export(objs, path):
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True,
                              export_apply=False, export_animations=False, export_skins=True, export_morph=True,
                              export_morph_normal=True, export_try_sparse_sk=False, export_materials='EXPORT', export_normals=True,
                              export_texcoords=True, export_cameras=False, export_lights=False, export_extras=False)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    HS, TS, LS = ensure_mpfb()
    body, eyes, rig = build_base(HS, TS, LS)
    prune_keys(eyes)
    assign_kit(body, rig)
    assign_eyes(eyes, rig)
    lengthen_humerus(body, rig)
    stabilize_glutes(body, rig)
    for o in (eyes,):
        o.parent = rig
        if not any(m.type == 'ARMATURE' for m in o.modifiers):
            m = o.modifiers.new('Armature', 'ARMATURE')
            m.object = rig
    bake_skin_textures(body, eyes, OUT)
    styles = build_hair_styles(body, rig)
    gear = build_headgear(body, eyes, rig, styles)
    pose_rider(rig, body)
    apply_pose_as_rest(rig, [body, eyes] + styles + gear)
    settle_straps(gear[1], body, next(o for o in styles if o.name == 'rider_hairs_slick'), gear[2])
    acc = import_accessories(rig, body)
    transfer_keys(body, acc + gear + [o for o in styles if o.name.startswith('rider_hair')])
    acc += styles + gear
    fix_material_names(acc)
    body = reduce_body(body)
    rig.name = rig.data.name = 'Armature'
    tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
    print(f'corps : {len(body.data.vertices)} sommets, {tris} triangles, cibles : {[k.name for k in body.data.shape_keys.key_blocks]}')
    lods = make_lods(rig, [body, eyes] + acc)
    for name, objs in [('rider', [body, eyes] + acc)] + [('rider' + sfx, lv) for sfx, lv in lods]:
        out = os.path.join(OUT, name + '.glb')
        raw = out if args.no_compress else os.path.join(OUT, name + '.raw.glb')
        export([rig] + objs, raw)
        if not args.no_compress:
            subprocess.run([PNPM, '--filter', '@allezrobert/blender-tools', 'compress:avatar', os.path.abspath(raw), os.path.abspath(out)], check=True)
            os.remove(raw)
            print(f'{name} compressé : {os.path.getsize(out) / 1e6:.2f} Mo')
    # Chaussures de cyclist.glb / cyclist_lod1.glb, pied caché retiré (fichiers compressés).
    subprocess.run([PNPM, '--filter', '@allezrobert/blender-tools', 'reshoe:avatar', OUT, os.path.dirname(os.path.abspath(args.cyclist))], check=True)
    print('exporté', os.path.join(OUT, 'rider.glb'))


main()
