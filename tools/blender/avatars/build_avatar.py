"""
Allez Robert ! — avatar MPFB, étape 2 de docs/AVATARS.md (preuve de bout en bout).

  - corps et tête de base MPFB 2 (maillage hm08), squelette game_engine et ses poids (CC0) ;
  - 5 curseurs de visage exportés en cibles (morph targets) : jawWidth, cheekVolume, noseLength,
    lipFullness, age (une cible « + » et une « − » chacun) ;
  - pose de conduite (bassin sur la selle, pieds sur les pédales à la manivelle 0, mains aux
    cocottes) appliquée comme pose de repos, cibles comprises : le client calcule sa cinématique
    inverse en écarts à cette pose, comme pour cyclist.glb ;
  - zones de tenue (maillot, bande, cuissard, chaussettes) par sommet, d'après les poids des os ;
  - globes oculaires (aides MPFB) avec iris et pupille ;
  - casque, casque chrono, lunettes, cheveux et chaussures repris de cyclist.glb, recalés sur la
    nouvelle tête et les nouveaux pieds (étape 3 : assets dédiés).

Usage (depuis la racine du dépôt) :
    blender -b --factory-startup --python tools/blender/avatars/build_avatar.py -- \\
        [--mpfb chemin/add-on-mpfb-v2.0.18.zip] [--out apps/client/public/models/avatar/]

MPFB (code GPL) n'est qu'un outil de génération : il est installé dans Blender depuis l'archive
officielle d'extensions.blender.org (téléchargée et vérifiée si --mpfb est absent) ; rien de son
code n'est livré avec le jeu. Les données produites (maillage, poids, cibles) sont en CC0.
"""

import argparse
import hashlib
import math
import os
import sys
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
args = ap.parse_args(argv)
OUT = os.path.abspath(args.out)
os.makedirs(OUT, exist_ok=True)

MPFB_URL = ('https://extensions.blender.org/download/sha256:c075b3e9b94b8e5556a5f03f4653602d02ea306de08126e8f55ed6dee28a2dad/'
            'add-on-mpfb-v2.0.18.zip?repository=%2Fapi%2Fv1%2Fextensions%2F&blender_version_min=4.2.0')
MPFB_SHA256 = 'c075b3e9b94b8e5556a5f03f4653602d02ea306de08126e8f55ed6dee28a2dad'
MPFB_MODULE = 'bl_ext.user_default.mpfb'

# Cotes du vélo (repère CLIENT : +x gauche, +y haut, +z avant) — identiques à build_cyclist.py.
BB = Vector((0.0, 0.27, 0.0))
CRANK = 0.1725
PEDAL_AXIS_X = 0.072
FOOT_X = 0.105
REST_PITCH = 0.35            # talon levé (rad), comme les pédales de bike_families
ANKLE_FLAT = Vector((0.0, 0.095, -0.13))  # cheville / axe de pédale, pied à plat
HIP = Vector((0.0, 1.03, -0.17))          # centre des hanches, assis sur la selle
HOOD = Vector((0.2, 0.958, 0.54))         # prise des mains sur les cocottes
SOLE = 0.03                               # épaisseur semelle + cale

# Curseurs de l'étape 2 : nom → (cibles « + », cibles « − »), chemins relatifs à data/targets.
SLIDERS = {
    'jawWidth': (['chin/chin-width-incr'], ['chin/chin-width-decr']),
    'cheekVolume': (['cheek/l-cheek-volume-incr', 'cheek/r-cheek-volume-incr'], ['cheek/l-cheek-volume-decr', 'cheek/r-cheek-volume-decr']),
    'noseLength': (['nose/nose-scale-vert-incr'], ['nose/nose-scale-vert-decr']),
    'lipFullness': (['mouth/mouth-upperlip-volume-incr', 'mouth/mouth-lowerlip-volume-incr'], ['mouth/mouth-upperlip-volume-decr', 'mouth/mouth-lowerlip-volume-decr']),
    'age': (['head/head-age-incr'], ['head/head-age-decr']),
}


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


# ---------------------------------------------------------------------------------------------
# Corps de base, curseurs, aides
# ---------------------------------------------------------------------------------------------
def build_base(HS, TS, LS):
    macro = {'gender': 1.0, 'age': 0.5, 'muscle': 0.55, 'weight': 0.5, 'proportions': 0.5, 'height': 0.5,
             'cupsize': 0.5, 'firmness': 0.5, 'race': {'asian': 0.33, 'caucasian': 0.34, 'african': 0.33}}
    body = HS.create_human(macro_detail_dict=macro)
    rig = HS.add_builtin_rig(body, 'game_engine', import_weights=True)
    # Macros figées dans le maillage de base : les cibles des curseurs s'y ajoutent.
    TS.bake_targets(body)
    targets_dir = LS.get_mpfb_data('targets')
    for name, (plus, minus) in SLIDERS.items():
        for sign, paths in (('+', plus), ('-', minus)):
            for p in paths:
                TS.load_target(body, os.path.join(targets_dir, p + '.target.gz'), weight=1.0, name='tmp_' + os.path.basename(p))
            key = body.shape_key_add(name=name + sign, from_mix=True)
            key.value = 0.0
            for kb in list(body.data.shape_keys.key_blocks):
                if kb.name.startswith('tmp_'):
                    body.shape_key_remove(kb)
    for m in list(body.modifiers):
        if m.type == 'MASK':
            body.modifiers.remove(m)
    # Globes oculaires à part ; les autres aides (cils, cheveux, collants, jupe…) sont supprimées.
    eyes_idx = vgroup_members(body, 'helper-l-eye') | vgroup_members(body, 'helper-r-eye')
    keep = vgroup_members(body, 'body') | eyes_idx
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
    gone = [v for v in bm.verts if v.index not in keep]
    bmesh.ops.delete(bm, geom=gone, context='VERTS')
    bmesh.update_edit_mesh(body.data)
    bpy.ops.object.mode_set(mode='OBJECT')
    body.name = body.data.name = 'rider_body'
    return body, eyes, rig


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
    names = ['skin', 'jersey', 'jersey_accent', 'shorts', 'sock']
    me.materials.clear()
    for n in names:
        m = bpy.data.materials.get(n) or bpy.data.materials.new(n)
        me.materials.append(m)
    # Face entière d'un côté de chaque coupe : la région du sommet le plus « intérieur » l'emporte
    # rarement ; on prend la région de la face d'après son centre (mêmes règles que les sommets).
    mi = []
    for p in me.polygons:
        rr = [vreg[i] for i in p.vertices]
        reg = region_at(rig, max(set([dom[i] for i in p.vertices if dom[i]] or ['pelvis']), key=[dom[i] for i in p.vertices].count), p.center, pelvis_z, chest_z)
        mi.append(names.index(reg if reg else max(set(rr), key=rr.count)))
    me.polygons.foreach_set('material_index', mi)


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
    """Cheville (client) à la manivelle 0 : pédale gauche en bas, droite en haut, talon levé."""
    a = 0.0 if side == 'l' else math.pi
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


def pose_rider(rig):
    set_active(rig)
    bpy.ops.object.mode_set(mode='POSE')
    pb = rig.pose.bones
    for b in pb:
        b.rotation_mode = 'QUATERNION'

    def world(name, tail=False):
        bpy.context.view_layer.update()
        b = pb[name]
        return rig.matrix_world @ (b.tail if tail else b.head)

    # Bassin sur la selle, buste penché : bascule répartie entre bassin et colonne.
    hip_bl = bl(HIP)
    pel = pb['pelvis']

    def lean(theta):
        pel.matrix_basis = Matrix.Identity(4)
        bpy.context.view_layer.update()
        m = pel.matrix.copy()
        loc = m.to_translation()
        rot = Matrix.Rotation(theta * 0.75, 4, 'X')
        pel.matrix = Matrix.Translation(hip_bl) @ rot @ Matrix.Translation(-loc) @ m
        for s in ('spine_01', 'spine_02', 'spine_03'):
            pb[s].rotation_quaternion = Matrix.Rotation(theta * 0.25 / 3, 4, 'X').to_quaternion()
        bpy.context.view_layer.update()

    arm_len = (rig.data.bones['upperarm_l'].length + rig.data.bones['lowerarm_l'].length)
    wrist = {s: bl(Vector((HOOD.x * (1 if s == 'l' else -1), HOOD.y + 0.018, HOOD.z - 0.075))) for s in ('l', 'r')}
    best = None
    for k in range(10, 76):
        th = math.radians(k)
        lean(th)
        err = abs((world('upperarm_l') - wrist['l']).length - 0.93 * arm_len)
        if best is None or err < best[0]:
            best = (err, th)
    lean(best[1])
    print(f'buste penché de {math.degrees(best[1]):.0f}°')

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
        dt = pb['hand_' + s].constraints.new('DAMPED_TRACK')
        dt.target = empty('hood_' + s, Vector((HOOD.x * (1 if s == 'l' else -1), HOOD.y - 0.01, HOOD.z + 0.06)))
        dt.track_axis = 'TRACK_Y'
        # Doigts refermés sur la cocotte.
        for f in ('index', 'middle', 'ring', 'pinky'):
            for j, ang in ((1, 35), (2, 55), (3, 35)):
                pb[f'{f}_0{j}_{s}'].rotation_quaternion = Matrix.Rotation(math.radians(ang), 4, 'X').to_quaternion()
    # Tête relevée vers la route : le cou et la tête compensent la bascule du buste.
    for n, part in (('neck_01', 0.45), ('head', 0.4)):
        pb[n].rotation_quaternion = Matrix.Rotation(-best[1] * part, 4, 'X').to_quaternion()
    bpy.context.view_layer.update()
    for s in ('l', 'r'):
        print(f'cheville {s} : cible {tuple(round(c, 3) for c in bl(ankle_target(s)[0]))}, obtenue {tuple(round(c, 3) for c in world("foot_" + s))}')
    bpy.ops.object.mode_set(mode='OBJECT')


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
        if n.startswith(('rider_helmet', 'rider_glasses', 'rider_hair')):
            mats = [m_head]
            groups = ['head']
        elif n.startswith('rider_shoes'):
            # Repère du pied : de la cheville vers la pointe (mesurée sur la chaussure pour
            # l'ancien modèle, bout des orteils du squelette pour le nouveau).
            mats, groups = [], []
            wv = [o.matrix_world @ v.co for v in o.data.vertices]
            for side, on, nn in (('l', 'foot_L', 'foot_l'), ('r', 'foot_R', 'foot_r')):
                a0, _ = bone_w(old_arm, on)
                sv = [w for w in wv if (w.x > 0) == (side == 'l')]
                toe0 = min(sv, key=lambda w: w.y)  # avant = −Y (Blender)
                a1 = rig.matrix_world @ rig.data.bones[nn].head_local
                toe1 = rig.matrix_world @ rig.data.bones['ball_' + side].tail_local
                d0, d1 = toe0 - a0, toe1 - a1
                s = d1.length / max(d0.length, 1e-6)
                mats.append(frame(a1, d1) @ Matrix.Scale(s, 4) @ frame(a0, d0).inverted())
                groups.append(nn)
        else:
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
    for o in new:
        if o not in out:
            bpy.data.objects.remove(o, do_unlink=True)
    return out


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
                              export_morph_normal=True, export_materials='EXPORT', export_normals=True,
                              export_texcoords=True, export_cameras=False, export_lights=False, export_extras=False)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    HS, TS, LS = ensure_mpfb()
    body, eyes, rig = build_base(HS, TS, LS)
    assign_kit(body, rig)
    assign_eyes(eyes, rig)
    for o in (eyes,):
        o.parent = rig
        if not any(m.type == 'ARMATURE' for m in o.modifiers):
            m = o.modifiers.new('Armature', 'ARMATURE')
            m.object = rig
    pose_rider(rig)
    apply_pose_as_rest(rig, [body, eyes])
    acc = import_accessories(rig, body)
    rig.name = rig.data.name = 'Armature'
    tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
    print(f'corps : {len(body.data.vertices)} sommets, {tris} triangles, cibles : {[k.name for k in body.data.shape_keys.key_blocks]}')
    export([rig, body, eyes] + acc, os.path.join(OUT, 'rider.glb'))
    print('exporté', os.path.join(OUT, 'rider.glb'))


main()
