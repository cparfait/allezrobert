"""
Spectateurs du public tirés des avatars MPFB du jeu (rider_lod2.glb, rider_female_lod2.glb) → fichiers du public
(apps/client/public/models/crowd/<nom>.json/.bin/.webp, même format que bake_crowd.py, lus par
apps/client/src/world/crowdRealistic.ts).

Pour chaque variante de mpfb_spectators.json :
  - cibles de forme MPFB (âge, poids, muscle, origine) appliquées une fois, casque, lunettes et coiffures non
    choisies retirés, maillages simplifiés (corps, cheveux, chaussures) ;
  - tenue de spectateur peinte sur le corps (pas de vêtement modélisé) : tee-shirt à manches courtes ou longues,
    pantalon ou short au genou, d'après l'os qui porte chaque face ; tissu légèrement gonflé (1 à 1,5 cm) ;
  - atlas : peau MPFB (skin_albedo.webp) sur l'ancienne carte UV du corps, réduite, et pastilles unies pour les
    cheveux, les chaussures, les yeux et la bouche ; masque de zones peau, cheveux, haut, bas ;
  - squelette « game_engine » remis debout (la pose de repos des avatars est la pose de course), bras par
    cinématique inverse à deux os ; gestes « cheer » (bras levés, poings agités) et « clap » (applaudir) en
    boucle, plus une image tenue pour les porteurs de pancarte (mains sur le manche, 0,25 m devant).

Les GLB du jeu sont compressés (meshopt), que l'importeur de Blender ne lit pas : les décompresser d'abord dans
out/crowd-mpfb/src (voir out/crowd-mpfb/README.md).

Usage :
  blender -b --factory-startup -P tools/blender/crowd/bake_mpfb_spectators.py -- [--only nom,nom] [--preview]
      [--src out/crowd-mpfb/src] [--out apps/client/public/models/crowd] [--index]
--index : réécrit index.json avec les variantes du catalogue.
"""
import json
import math
import os
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))


def opt(k, d):
    return argv[argv.index(k) + 1] if k in argv else d


SRC = os.path.join(ROOT, opt('--src', 'out/crowd-mpfb/src'))
OUT = os.path.join(ROOT, opt('--out', 'apps/client/public/models/crowd'))
PREVIEW = '--preview' in argv
CATALOG = json.load(open(os.path.join(HERE, 'mpfb_spectators.json'), encoding='utf-8'))['spectators']
ONLY = [n for n in opt('--only', '').split(',') if n]
SKIN_ALBEDO = os.path.join(ROOT, 'apps/client/public/models/avatar/skin_albedo.webp')

TEX = 1024          # atlas de couleur
MASK = 256          # masque de zones
FPS = 8             # images cuites par seconde
CHEER_S, CLAP_S = 3.0, 2.0
BUDGET = {'body': 1800, 'hair': 450, 'shoes': 220}
BODY_S = 0.875      # carte UV du corps réduite dans [0, 0,875]² ; pastilles à droite
INFLATE = {'top': 0.010, 'bottom': 0.007}
# Tête agrandie (os « head », cheveux et yeux compris) : la tête réaliste de MPFB (1/8 de la taille) paraissait
# minuscule à côté des coureurs et des anciens spectateurs, et le spectateur semblait trop grand.
HEAD_K = 1.22

# Pastilles unies (centre u, v ; demi-côté PATCH) : cheveux recolorés, le reste gardé tel quel.
PATCH = 0.04
PATCHES = {'hair': (0.94, 0.06), 'shoe': (0.94, 0.18), 'sole': (0.94, 0.30), 'eye': (0.94, 0.42),
           'iris': (0.94, 0.54), 'mouth': (0.94, 0.66), 'dark': (0.94, 0.78)}
SKIN, TOP, BOTTOM, SHOE = 0, 1, 2, 3

# Repère de l'armature (Blender) : avant du coureur = −Y, gauche (_l) = +X, haut = +Z.
FWD, UP = Vector((0, -1, 0)), Vector((0, 0, 1))


def hexrgb(h):
    return [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]


# ---------------------------------------------------------------- import et préparation

def load(spec):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    src = os.path.join(SRC, 'rider_lod2.glb' if spec['base'] == 'male' else 'rider_female_lod2.glb')
    bpy.ops.import_scene.gltf(filepath=src)
    rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    keep_hair = set(spec['hair'])
    if spec.get('moustache'):
        keep_hair.add('rider_moustache')
    parts = {'body': None, 'eyes': None, 'shoes': None, 'hair': []}
    for o in list(bpy.data.objects):
        if o.type != 'MESH':
            continue
        base = o.data.name.split('.')[0]
        base = base[:-5] if base.endswith(('_lod1', '_lod2')) else base
        if base == 'rider_body':
            parts['body'] = o
        elif base == 'rider_eyes':
            parts['eyes'] = o
        elif base == 'rider_shoes':
            parts['shoes'] = o
        elif base in keep_hair:
            parts['hair'].append(o)
        else:
            bpy.data.objects.remove(o, do_unlink=True)
    assert parts['body'] and parts['shoes'], 'corps ou chaussures introuvables'
    return rig, parts


def apply_morphs(o, morph):
    sk = o.data.shape_keys
    if not sk:
        return
    n = len(o.data.vertices)
    basis = np.empty(n * 3, np.float32)
    sk.key_blocks[0].data.foreach_get('co', basis)
    co = basis.copy()
    for kb in sk.key_blocks[1:]:
        v = float(morph.get(kb.name, 0.0))
        if v:
            d = np.empty(n * 3, np.float32)
            kb.data.foreach_get('co', d)
            co += v * (d - basis)
    o.shape_key_clear()
    o.data.vertices.foreach_set('co', co)
    o.data.update()


def decimate(o, tris):
    t0 = sum(len(p.vertices) - 2 for p in o.data.polygons)
    if t0 <= tris:
        return
    bpy.context.view_layer.objects.active = o
    m = o.modifiers.new('dec', 'DECIMATE')
    m.ratio = tris / t0
    bpy.ops.object.modifier_move_to_index(modifier='dec', index=0)
    bpy.ops.object.modifier_apply(modifier='dec')


# ---------------------------------------------------------------- zones de la tenue

CHILD = {'pelvis': 'spine_01', 'spine_01': 'spine_02', 'spine_02': 'spine_03', 'spine_03': 'neck_01',
         'neck_01': 'head', 'clavicle': 'upperarm', 'upperarm': 'lowerarm', 'lowerarm': 'hand',
         'thigh': 'calf', 'calf': 'foot', 'foot': 'ball'}


def side_child(bone):
    for s in ('_l', '_r'):
        if bone.endswith(s):
            c = CHILD.get(bone[:-2])
            return c + s if c else None
    return CHILD.get(bone)


def face_zones(body, rig, spec):
    """Zones de la tenue. Rend (zone de chaque face, os de chaque face, positions des sommets, classe) où
    classe(os, P) donne la zone (SKIN, TOP, BOTTOM, SHOE) de points P (N×3) portés par une face de cet os : la
    taille est un plan perpendiculaire au buste, les manches et les jambes de pantalon des coupes le long du
    membre (épaule → poignet, hanche → cheville) ; ainsi les bords suivent le texel et non les faces."""
    me = body.data
    names = {g.index: g.name for g in body.vertex_groups}
    mw = body.matrix_world
    rw = rig.matrix_world
    H = {b.name: np.array(rw @ b.head_local, np.float64) for b in rig.data.bones}
    vbone = []
    for v in me.vertices:
        g = max(v.groups, key=lambda g: g.weight, default=None)
        vbone.append(names[g.group] if g else 'pelvis')
    co = np.array([mw @ v.co for v in me.vertices], np.float64)
    long_sleeves, long_legs = spec['sleeves'] == 'long', spec['legs'] == 'long'
    axis = H['neck_01'] - H['pelvis']
    axis /= np.linalg.norm(axis)
    waist = float((H['spine_01'] + 0.3 * (H['spine_02'] - H['spine_01']) - H['pelvis']) @ axis)

    def along(a, b, P):
        d = H[b] - H[a]
        return np.clip((P - H[a]) @ d / (d @ d), 0, 1)

    def classify(bone, P):
        b, s = (bone[:-2], bone[-2:]) if bone.endswith(('_l', '_r')) else (bone, '')
        z = np.full(len(P), SKIN, np.int32)
        if b in ('pelvis', 'spine_01', 'spine_02', 'spine_03', 'clavicle', 'Root'):
            h = (P - H['pelvis']) @ axis
            z[:] = np.where(h >= waist, TOP, BOTTOM)
        elif b in ('upperarm', 'lowerarm'):
            u = 0.5 * along('upperarm' + s, 'lowerarm' + s, P) if b == 'upperarm' else 0.5 + 0.5 * along('lowerarm' + s, 'hand' + s, P)
            z[:] = np.where(u < (0.96 if long_sleeves else 0.22), TOP, SKIN)
        elif b in ('thigh', 'calf'):
            u = 0.5 * along('thigh' + s, 'calf' + s, P) if b == 'thigh' else 0.5 + 0.5 * along('calf' + s, 'foot' + s, P)
            z[:] = np.where(u < (1.01 if long_legs else 0.54), BOTTOM, SKIN)
            if b == 'thigh':  # haut des cuisses au-dessus de la taille : haut
                h = (P - H['pelvis']) @ axis
                z[:] = np.where(h >= waist + 0.02, TOP, z)
        elif b in ('foot', 'ball'):
            z[:] = SHOE
        return z

    fbone = []
    zones = np.zeros(len(me.polygons), np.int32)
    for f in me.polygons:
        mat = me.materials[f.material_index].name if me.materials else ''
        counts = {}
        for vi in f.vertices:
            counts[vbone[vi]] = counts.get(vbone[vi], 0) + 1
        bone = max(counts, key=counts.get)
        if mat in ('mouth', 'lashes'):
            bone = 'head'
        fbone.append(bone)
        zones[f.index] = classify(bone, co[list(f.vertices)].mean(0)[None])[0]
    return zones, fbone, co, classify


def inflate(body, zones):
    me = body.data
    amount = np.zeros(len(me.vertices), np.float32)
    for f in me.polygons:
        a = INFLATE['top'] if zones[f.index] == TOP else INFLATE['bottom'] if zones[f.index] == BOTTOM else 0.0
        for vi in f.vertices:
            amount[vi] = max(amount[vi], a)
    for f in me.polygons:  # bords du tissu (poignets, chevilles, cou) : à demi
        if zones[f.index] in (SKIN, SHOE):
            for vi in f.vertices:
                if amount[vi]:
                    amount[vi] *= 0.5
    for v in me.vertices:
        if amount[v.index]:
            v.co += v.normal * float(amount[v.index])
    me.update()


# ---------------------------------------------------------------- atlas et masque

def load_skin():
    img = bpy.data.images.load(SKIN_ALBEDO)
    w, h = img.size
    px = np.array(img.pixels[:], np.float32).reshape(h, w, 4)[..., :3]
    return px


def rasterize(tri_uv, W):
    """Texels (ys, xs, l1, l2, l3) couverts par un triangle UV (0..1)."""
    uv = np.asarray(tri_uv) * W
    x0, y0 = np.maximum(np.floor(uv.min(0)).astype(int) - 1, 0)
    x1, y1 = np.minimum(np.ceil(uv.max(0)).astype(int) + 1, W - 1)
    if x1 < x0 or y1 < y0:
        return None
    gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
    (ax, ay), (bx, by), (cx, cy) = uv
    d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if abs(d) < 1e-12:
        return None
    l1 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / d
    l2 = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / d
    l3 = 1 - l1 - l2
    inside = (l1 >= -0.03) & (l2 >= -0.03) & (l3 >= -0.03)
    ys, xs = np.nonzero(inside)
    return ys + y0, xs + x0, l1[inside], l2[inside], l3[inside]


def paint(body, zinfo, spec, others):
    """Atlas (sRGB) et masque RGBA (peau, cheveux, haut, bas) ; UV du corps réduites, autres pièces sur leurs pastilles."""
    W = TEX
    skin = load_skin()
    SH, SW = skin.shape[:2]
    base = np.zeros((W, W, 3), np.float32)
    mask = np.zeros((W, W, 4), np.float32)
    used = np.zeros((W, W), bool)
    me = body.data
    uvl = me.uv_layers.active.data
    rng = np.random.default_rng(7)
    # Tissu : gris moyen légèrement bruité (grain basse fréquence), pour que la recoloration ne soit pas plate.
    g = rng.normal(0, 1, (W // 32 + 2, W // 32 + 2)).astype(np.float32)
    x = np.arange(W) / 32.0
    i0 = np.floor(x).astype(int)
    fx = (x - i0)[None, :]
    fy = (x - i0)[:, None]
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a, b = g[i0][:, i0], g[i0][:, i0 + 1]
    c, d = g[i0 + 1][:, i0], g[i0 + 1][:, i0 + 1]
    noise = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy   # bruit lisse (bilinéaire adouci)
    cloth = 0.62 * (1 + 0.06 * noise)
    zones, fbone, vco, classify = zinfo
    shoe = np.array(hexrgb(spec['shoe']), np.float32)
    for f in me.polygons:
        loops = list(f.loop_indices)
        for i in range(1, len(loops) - 1):
            tri = [loops[0], loops[i], loops[i + 1]]
            uv = [tuple(uvl[li].uv) for li in tri]
            r = rasterize([(u * BODY_S, v * BODY_S) for u, v in uv], W)
            if r is None:
                continue
            ys, xs, l1, l2, l3 = r
            vv = [me.loops[li].vertex_index for li in tri]
            P = l1[:, None] * vco[vv[0]] + l2[:, None] * vco[vv[1]] + l3[:, None] * vco[vv[2]]
            zt = classify(fbone[f.index], P)
            sk = zt == SKIN
            if sk.any():
                su = (l1 * uv[0][0] + l2 * uv[1][0] + l3 * uv[2][0])[sk]
                sv = (l1 * uv[0][1] + l2 * uv[1][1] + l3 * uv[2][1])[sk]
                sx = np.clip((su * SW).astype(int), 0, SW - 1)
                sy = np.clip((sv * SH).astype(int), 0, SH - 1)
                base[ys[sk], xs[sk]] = skin[sy, sx]
                mask[ys[sk], xs[sk]] = (1, 0, 0, 0)
            m = zt == TOP
            base[ys[m], xs[m]] = cloth[ys[m], xs[m], None]
            mask[ys[m], xs[m]] = (0, 0, 1, 0)
            m = zt == BOTTOM
            base[ys[m], xs[m]] = cloth[ys[m], xs[m], None] * 0.85
            mask[ys[m], xs[m]] = (0, 0, 0, 1)
            m = zt == SHOE
            base[ys[m], xs[m]] = shoe
            mask[ys[m], xs[m]] = 0
            used[ys, xs] = True
    # Débord dans les marges des îlots (pas de couture au filtrage ni aux mipmaps).
    for _ in range(8):
        gb, gm, gu = base.copy(), mask.copy(), used.copy()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sb, sm, su = (np.roll(np.roll(a, dy, 0), dx, 1) for a in (base, mask, used))
            take = ~gu & su
            gb[take], gm[take], gu[take] = sb[take], sm[take], True
        base, mask, used = gb, gm, gu
    # Pastilles.
    colors = {'hair': (0.30, 0.30, 0.30), 'shoe': tuple(shoe), 'sole': (0.08, 0.08, 0.09), 'eye': (0.80, 0.77, 0.72),
              'iris': (0.10, 0.08, 0.07), 'mouth': (0.45, 0.22, 0.22), 'dark': (0.08, 0.07, 0.07)}
    for name, (cu, cv) in PATCHES.items():
        x0, x1 = int((cu - PATCH) * W), int((cu + PATCH) * W)
        y0, y1 = int((cv - PATCH) * W), int((cv + PATCH) * W)
        base[y0:y1, x0:x1] = colors[name]
        mask[y0:y1, x0:x1] = (0, 1, 0, 0) if name == 'hair' else 0
    # UV : corps réduit, autres pièces sur leurs pastilles (selon le matériau de chaque face).
    for li, l in enumerate(uvl):
        l.uv = (l.uv[0] * BODY_S, l.uv[1] * BODY_S)
    for o in others:
        while o.data.uv_layers:
            o.data.uv_layers.remove(o.data.uv_layers[0])
        o.data.uv_layers.new(name=me.uv_layers.active.name)
        ol = o.data.uv_layers.active.data
        for f in o.data.polygons:
            mat = o.data.materials[f.material_index].name.split('.')[0] if o.data.materials else 'dark'
            key = ('hair' if mat == 'hair' else 'shoe' if mat in ('shoe', 'shoe_dial', 'shoe_reflect') else
                   'eye' if mat == 'eye' else 'iris' if mat in ('iris', 'pupil') else 'sole')
            cu, cv = PATCHES[key]
            for li in f.loop_indices:
                ol[li].uv = (cu, cv)
    return base, mask


def save_textures(name, base, mask):
    W = TEX
    img = bpy.data.images.new(name, W, W, alpha=True)
    a = np.ones((W, W, 4), np.float32)
    a[..., :3] = np.clip(base, 0, 1)
    img.pixels = a.ravel()
    img.filepath_raw = os.path.join(OUT, f'{name}.webp')
    img.file_format = 'WEBP'
    img.save()
    lin = np.where(base <= 0.04045, base / 12.92, ((base + 0.055) / 1.055) ** 2.4)
    lum = lin @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    ref = {k: float((lum * mask[..., i]).sum() / max(mask[..., i].sum(), 1)) for i, k in enumerate(('skin', 'hair', 'top', 'bottom'))}
    f = W // MASK
    m = mask.reshape(MASK, f, MASK, f, 4).mean((1, 3))
    return ref, (np.clip(m, 0, 1) * 255 + 0.5).astype(np.uint8)


# ---------------------------------------------------------------- poses

class Poser:
    def __init__(self, rig):
        self.rig = rig
        self.pb = rig.pose.bones
        self.rest = {b.name: b.matrix_local.copy() for b in rig.data.bones}
        self.len = {}
        for s in ('_l', '_r'):
            self.len['upper' + s] = (rig.data.bones['lowerarm' + s].head_local - rig.data.bones['upperarm' + s].head_local).length
            self.len['fore' + s] = (rig.data.bones['hand' + s].head_local - rig.data.bones['lowerarm' + s].head_local).length

    def upd(self):
        bpy.context.view_layer.update()

    def head(self, b):
        return self.pb[b].head.copy()

    def rotate(self, b, q):
        """Tourne l'os b (et ses enfants) autour de sa tête, rotation q en repère de l'armature."""
        pb = self.pb[b]
        M = pb.matrix.copy()
        loc = M.to_translation()
        pb.matrix = Matrix.Translation(loc) @ q.to_matrix().to_4x4() @ Matrix.Translation(-loc) @ M
        self.upd()

    def aim(self, b, child, target):
        cur = (self.head(child) - self.head(b)).normalized()
        self.rotate(b, cur.rotation_difference(Vector(target).normalized()))

    def orient(self, b, R):
        """Orientation absolue de l'os b (repère de l'armature)."""
        pb = self.pb[b]
        pb.matrix = Matrix.Translation(pb.head) @ R.to_4x4()
        self.upd()

    def reset(self):
        for pb in self.pb:
            pb.matrix_basis.identity()
        self.upd()

    def arm(self, s, target, pole, hand_pitch, hand_roll=0.0):
        """Bras par cinématique inverse à deux os : main (poignet) en `target`, coude vers `pole`."""
        side = 1.0 if s == '_l' else -1.0
        S = self.head('upperarm' + s)
        L1, L2 = self.len['upper' + s], self.len['fore' + s]
        d = Vector(target) - S
        D = min(d.length, (L1 + L2) * 0.995)
        dn = d.normalized()
        a = (L1 * L1 - L2 * L2 + D * D) / (2 * D)
        h = math.sqrt(max(L1 * L1 - a * a, 0.0))
        p = Vector(pole) - dn * Vector(pole).dot(dn)
        p.normalize()
        E = S + dn * a + p * h
        T = S + dn * D
        self.aim('upperarm' + s, 'lowerarm' + s, E - S)
        self.aim('lowerarm' + s, 'hand' + s, T - E)
        # Main : orientation de repos (sur les cocottes : paume vers l'intérieur, doigts vers l'avant), basculée
        # autour de l'axe latéral (doigts vers le bas : +90°, vers le haut : −90°) puis tournée autour de l'avant-bras.
        R = Matrix.Rotation(math.radians(hand_pitch), 3, 'X') @ self.rest['hand' + s].to_3x3()
        if hand_roll:
            R = Matrix.Rotation(math.radians(hand_roll * side), 3, (T - E).normalized()) @ R
        self.orient('hand' + s, R)

    def stand(self, sway=0.0, nod=0.0):
        """Debout, bras le long du corps (avant les gestes)."""
        self.reset()
        self.aim('pelvis', 'spine_01', (0, 0.02, 1))
        self.aim('spine_01', 'spine_02', (sway, 0.02, 1))
        self.aim('spine_02', 'spine_03', (sway * 0.5, 0.0, 1))
        self.aim('spine_03', 'neck_01', (0, -0.08, 1))
        self.aim('neck_01', 'head', (0, -0.18, 1))
        R = Matrix.Rotation(math.radians(-6 + nod), 3, 'X') @ self.rest['head'].to_3x3()
        self.orient('head', R @ Matrix.Scale(HEAD_K, 3))
        for s, side in (('_l', 1), ('_r', -1)):
            self.aim('thigh' + s, 'calf' + s, (side * 0.07, -0.02, -1))
            self.aim('calf' + s, 'foot' + s, (side * 0.02, 0.03, -1))
            self.orient('foot' + s, self.foot_rot[s] if hasattr(self, 'foot_rot') else self.rest['foot' + s].to_3x3())
            self.aim('clavicle' + s, 'upperarm' + s, (side, 0.12, 0.02))
        for s, side in (('_l', 1), ('_r', -1)):
            S = self.head('upperarm' + s)
            L = self.len['upper' + s] + self.len['fore' + s]
            self.arm(s, S + Vector((side * 0.10, -0.03, -L * 0.97)), (side * 0.3, 1, 0), 90)

    def level_feet(self, body):
        """Semelles à plat : bascule du pied (autour de l'axe latéral) qui égalise talon et pointe."""
        self.foot_rot = {s: self.rest['foot' + s].to_3x3() for s in ('_l', '_r')}
        names = {g.index: g.name for g in body.vertex_groups}
        for s in ('_l', '_r'):
            idx = [v.index for v in body.data.vertices if any(names[g.group] in ('foot' + s, 'ball' + s) and g.weight > 0.5 for g in v.groups)]
            best = None
            for deg in range(-60, 61, 2):
                R = Matrix.Rotation(math.radians(deg), 3, 'X') @ self.rest['foot' + s].to_3x3()
                self.foot_rot[s] = R
                self.stand()
                co, _ = evaluated(body)
                p = co[idx]
                y = p[:, 1]
                lo = p[:, 2].min()
                front = p[y < np.percentile(y, 25), 2].min()   # avant = −Y
                back = p[y > np.percentile(y, 75), 2].min()
                score = abs(front - back) + 0.2 * abs(lo - min(front, back))
                if best is None or score < best[0]:
                    best = (score, R)
            self.foot_rot[s] = best[1]


def evaluated(body):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    m = ev.to_mesh()
    mw = body.matrix_world
    n = len(m.vertices)
    co = np.empty(n * 3, np.float32)
    nm = np.empty(n * 3, np.float32)
    m.vertices.foreach_get('co', co)
    m.vertices.foreach_get('normal', nm)
    ev.to_mesh_clear()
    co = co.reshape(-1, 3)
    nm = nm.reshape(-1, 3)
    M = np.array(mw, np.float32)
    co = co @ M[:3, :3].T + M[:3, 3]
    nm = nm @ M[:3, :3].T
    nm /= np.maximum(np.linalg.norm(nm, axis=1, keepdims=True), 1e-9)
    return co, nm


def gesture(P, clip, ph):
    """Pose du geste `clip` à la phase ph (0..1, boucle)."""
    w = 2 * math.pi * ph
    if clip == 'cheer':
        P.stand(sway=0.05 * math.sin(w), nod=4 * math.sin(2 * w))
        mid = (P.head('upperarm_l') + P.head('upperarm_r')) / 2
        for s, side, off in (('_l', 1, 0.0), ('_r', -1, 0.5)):
            pump = math.sin(4 * w + off * math.pi)         # poings agités, 4 fois par boucle
            S = P.head('upperarm' + s)
            reach = P.len['upper' + s] + P.len['fore' + s]
            # Poings juste au-dessus de la tête, coudes pliés vers l'extérieur (bras tendus à la verticale : mains
            # vers 2,15 m, silhouette étirée).
            T = S + Vector((side * (0.24 + 0.04 * pump), -0.10, reach * (0.58 + 0.10 * pump)))
            P.arm(s, T, (side, 0.3, -0.2), -90, 0)
    elif clip == 'clap':
        P.stand(sway=0.02 * math.sin(w), nod=2 * math.sin(w))
        mid = (P.head('upperarm_l') + P.head('upperarm_r')) / 2
        o = 0.5 - 0.5 * math.cos(4 * w)                     # 4 claps par boucle : 0 = mains jointes
        for s, side in (('_l', 1), ('_r', -1)):
            T = mid + Vector((side * (0.045 + 0.16 * o), -0.36, -0.10 + 0.02 * o))
            P.arm(s, T, (side, 0.3, -0.8), -40, 0)
    elif clip == 'hold':
        P.stand()
        mid = (P.head('upperarm_l') + P.head('upperarm_r')) / 2
        foot_y = (P.head('foot_l').y + P.head('foot_r').y) / 2
        # Manche à 0,25 m devant le porteur (avant = −Y), poings l'un au-dessus de l'autre sous l'épaule (1,15 à
        # 1,35 m pour 1,75 m) : pancarte au-dessus de la tête.
        for s, side, dz in (('_l', 1, -0.02), ('_r', -1, -0.22)):
            T = Vector((side * 0.025, foot_y - 0.27 * SCALE_INV[0], mid.z + dz))
            P.arm(s, T, (side, 0.2, -1), 0, 0)


SCALE_INV = [1.0]


# ---------------------------------------------------------------- variante

def bake(name, spec):
    rig, parts = load(spec)
    body = parts['body']
    meshes = [body, parts['shoes']] + ([parts['eyes']] if parts['eyes'] else []) + parts['hair']
    for o in meshes:
        apply_morphs(o, spec.get('morph', {}))
    # Sommets dédoublés par l'export glTF aux limites de matériaux (maillot, cuissard, peau) : fusionnés, sinon
    # la simplification, le gonflement du tissu et le lissage y ouvrent des fentes en dents de scie.
    for o in (body, parts['shoes']):
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bm.to_mesh(o.data)
        bm.free()
        o.data.update()
    decimate(body, BUDGET['body'])
    decimate(parts['shoes'], BUDGET['shoes'])
    for o in parts['hair']:
        decimate(o, BUDGET['hair'] if len(parts['hair']) == 1 else BUDGET['hair'] // 2)
    zinfo = face_zones(body, rig, spec)
    inflate(body, zinfo[0])
    base, mask = paint(body, zinfo, spec, [o for o in meshes if o is not body])
    ref, mask8 = save_textures(name, base, mask)

    # Une seule pièce : tout est déjà lié au même squelette.
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    me = body.data
    me.materials.clear()
    if PREVIEW:
        mat = bpy.data.materials.new('atlas')
        mat.use_nodes = True
        tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image = bpy.data.images.load(os.path.join(OUT, f'{name}.webp'))
        mat.node_tree.links.new(tex.outputs['Color'], mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
        mat.node_tree.nodes.active = tex
        me.materials.append(mat)

    # Lissage correctif (après l'armature) sur le bassin et le haut des cuisses : la pose de repos est assise, et
    # redresser les cuisses pinçait l'entrejambe en un pli sombre.
    names = {g.index: g.name for g in body.vertex_groups}
    smooth = body.vertex_groups.new(name='lissage')
    for v in me.vertices:
        w = sum(g.weight for g in v.groups if names.get(g.group) in ('pelvis', 'Root', 'spine_01', 'thigh_l', 'thigh_r'))
        if w > 0.02:
            smooth.add([v.index], min(1.0, w * 1.3), 'REPLACE')
    cs = body.modifiers.new('lissage', 'CORRECTIVE_SMOOTH')
    cs.vertex_group = 'lissage'
    cs.factor = 0.8
    cs.iterations = 12
    cs.smooth_type = 'LENGTH_WEIGHTED'
    cs.rest_source = 'ORCO'
    cs.use_pin_boundary = False

    P = Poser(rig)
    # Taille réelle (sans les cheveux), face à +Y de Blender (−Z du jeu), pieds au sol.
    P.stand()
    co, _ = evaluated(body)
    k = spec['height'] / float(co[:, 2].max() - co[:, 2].min())
    SCALE_INV[0] = 1.0 / (rig.scale.x * k)
    rig.scale = rig.scale * k
    rig.rotation_mode = 'XYZ'
    rig.rotation_euler.z += math.pi
    bpy.context.view_layer.update()
    P.level_feet(body)
    P.stand()
    co, _ = evaluated(body)
    rig.location.z -= float(co[:, 2].min())
    rig.location.x -= float(co[:, 0].mean())
    rig.location.y -= float(co[:, 1].mean())
    bpy.context.view_layer.update()
    rest_co, rest_nm = evaluated(body)

    def to_game(a):
        return np.stack([a[:, 0], a[:, 2], -a[:, 1]], 1)

    uvl = me.uv_layers.active.data
    me.calc_loop_triangles()
    key_to_idx, src_vert, uvs, indices = {}, [], [], []
    for tri in me.loop_triangles:
        for vi, li in zip(tri.vertices, tri.loops):
            u, v = uvl[li].uv
            key = (vi, round(u, 5), round(v, 5))
            idx = key_to_idx.get(key)
            if idx is None:
                idx = key_to_idx[key] = len(src_vert)
                src_vert.append(vi)
                uvs.append((u, v))
            indices.append(idx)
    src_vert = np.array(src_vert)
    V, I = len(src_vert), len(indices)

    clips, pos_rows, nrm_rows = [], [], []
    for clip, secs in (('cheer', CHEER_S), ('clap', CLAP_S)):
        n = int(round(secs * FPS))
        clips.append({'name': clip, 'row': len(pos_rows), 'frames': n, 'fps': float(FPS)})
        for f in range(n):
            gesture(P, clip, f / n)
            c, nm = evaluated(body)
            pos_rows.append(to_game(c)[src_vert])
            nrm_rows.append(to_game(nm)[src_vert])
            if PREVIEW and f in (0, n // 8, n // 4):
                preview(body, f'{name}_{clip}_{f}')
    hold = len(pos_rows)
    gesture(P, 'hold', 0)
    c, nm = evaluated(body)
    pos_rows.append(to_game(c)[src_vert])
    nrm_rows.append(to_game(nm)[src_vert])
    if PREVIEW:
        preview(body, f'{name}_hold')
        P.stand()
        preview(body, f'{name}_stand')
    R = len(pos_rows)
    low = min(float(r[:, 1].min()) for r in pos_rows)

    rp, rn = to_game(rest_co)[src_vert], to_game(rest_nm)[src_vert]
    vat = np.zeros((2 * R, V, 4), np.float16)
    vat[:R, :, :3] = np.array(pos_rows)
    vat[R:, :, :3] = np.array(nrm_rows)
    parts_b = [rp.astype('<f4'), rn.astype('<f4'), np.array(uvs, '<f4'), np.array(indices, '<u4'), vat.astype('<f2'), mask8]
    offsets, pos = {}, 0
    for key, arr in zip(('position', 'normal', 'uv', 'index', 'vat', 'mask'), parts_b):
        offsets[key] = pos
        pos += arr.nbytes
    with open(os.path.join(OUT, f'{name}.bin'), 'wb') as f:
        for arr in parts_b:
            f.write(arr.tobytes())
    meta = {'vertexCount': V, 'indexCount': I, 'tris': I // 3, 'vatRows': 2 * R, 'normalRow': R, 'clips': clips, 'hold': hold,
            'maskSize': MASK, 'refLum': ref, 'heightM': spec['height'], 'weight': spec.get('weight', 1.0), 'offsets': offsets, 'bytes': pos,
            'source': 'mpfb'}
    json.dump(meta, open(os.path.join(OUT, f'{name}.json'), 'w', encoding='utf-8'), indent=1)
    print(f'SPECTATEUR {name} : {I // 3} triangles, {V} sommets, {R} images, porteur {hold}, pieds au plus bas {low:.3f} m, {pos / 1e6:.2f} Mo')


def preview(body, label):
    """Vue de face et de profil (Workbench) dans out/crowd-mpfb/preview."""
    scene = bpy.context.scene
    d = os.path.join(ROOT, 'out', 'crowd-mpfb', 'preview')
    os.makedirs(d, exist_ok=True)
    cam = bpy.data.objects.get('cam')
    if cam is None:
        cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
        scene.collection.objects.link(cam)
        cam.data.type = 'ORTHO'
        cam.data.ortho_scale = 2.3
        scene.camera = cam
        scene.render.engine = 'BLENDER_WORKBENCH'
        scene.render.resolution_x = scene.render.resolution_y = 420
        scene.display.shading.color_type = 'TEXTURE'
        scene.display.shading.light = 'STUDIO'
    for view, loc, rot in (('face', (0, 6, 1.0), (math.pi / 2, 0, math.pi)), ('profil', (6, 0, 1.0), (math.pi / 2, 0, math.pi / 2))):
        cam.location = loc
        cam.rotation_euler = rot
        scene.render.filepath = os.path.join(d, f'{label}_{view}.png')
        bpy.ops.render.render(write_still=True)


def main():
    os.makedirs(OUT, exist_ok=True)
    names = ONLY or list(CATALOG)
    for n in names:
        bake(n, CATALOG[n])
    if '--index' in argv:
        idx_path = os.path.join(OUT, 'index.json')
        json.dump({'models': list(CATALOG)}, open(idx_path, 'w', encoding='utf-8'), indent=1)


main()
