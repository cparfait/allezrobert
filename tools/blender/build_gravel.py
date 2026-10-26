"""
Vélo gravel du jeu : « Road Bike » de Tanya Andreeva (Sketchfab, CC BY 4.0) adapté au coureur.

Le modèle d'origine (380 k triangles, 119 pièces, dont des rayons à 690 triangles pièce) est remis
à l'échelle du vélo de base (empattement 1 m, roues de 0,335 m), allégé et découpé comme une
famille de vélos du jeu (voir apps/client/src/rider/bikes.ts) :

  frame (matériau « frame », zones de livrée en couleur de sommet « zone »), cockpit (cintre, potence,
  cocottes ; ruban en « bar_tape »), saddle (selle et tige), wheel_front / wheel_rear (jante, pneu à flancs
  beiges élargi, moyeu, rayons refaits, disque de frein ; cassette à l'arrière), chaîne.

Pédalier, pédales, dérailleur, étriers à disque, ancres des mains et boîtes d'inscriptions viennent d'une
famille de vélos existante (--base) : le coureur pédale et tient le cintre exactement comme sur le vélo route.
Étriers sur jante, câbles, pédales d'origine, dérailleur d'origine et valves sont supprimés.

Usage :
  blender -b --python build_gravel.py -- --tanya roadbike.glb --base aero.glb --out gravel.glb [--lod 1] [--debug DOSSIER]
"""
import sys
import math
import bpy
import bmesh
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def opt(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


SRC = opt('--tanya')
BASE = opt('--base')
OUT = opt('--out')
LOD = int(opt('--lod', '0'))
DEBUG = opt('--debug')

# Repères du vélo de base (tools/blender/build_cyclist.py), en mètres, repère glTF (x gauche, y haut, z avant).
BB = (0.0, 0.27, 0.0)
WHEEL_R = 0.335
REAR_AXLE = (0.0, WHEEL_R, -0.41)
FRONT_AXLE = (0.0, WHEEL_R, 0.59)
ROTOR_X = (0.044, 0.052)
ROTOR_R = (0.08, 0.07)
CHAIN_X = -0.045
TIRE_H = 0.040          # hauteur de pneu gravel (m)
TIRE_W = 0.042          # largeur de pneu gravel (m)
# Cibles de pose du coureur (gltfAvatar.ts HOOD_PALM etc.) : le cintre du modèle y est recalé.

# Budgets de triangles (LOD 0 / LOD 1).
B = {
    'rim': (2200, 700),
    'hub': (700, 200),
    'frame': (6500, 2200),
    'cockpit': (4200, 1500),
    'saddle': (2800, 900),
}


def to_bl(p):
    """glTF (x, y, z) → Blender (x, −z, y)."""
    return Vector((p[0], -p[2], p[1]))


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def bbox(o):
    pts = [v.co for v in o.data.vertices]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def material(name):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
    return m


def set_material(o, name):
    o.data.materials.clear()
    o.data.materials.append(material(name))


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
    return o


def decimate(o, target):
    n = tris(o)
    if n <= target:
        return
    bpy.context.view_layer.objects.active = o
    md = o.modifiers.new('dec', 'DECIMATE')
    md.ratio = max(0.02, target / n)
    bpy.ops.object.modifier_apply(modifier=md.name)


def new_obj(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def cyl(bm, p0, p1, r0, r1=None, seg=8):
    """Tube plein entre deux points (Blender)."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    mat = Matrix.Translation((p0 + p1) / 2) @ d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r0, radius2=r1 if r1 is not None else r0, depth=d.length, matrix=mat)


def poly_tube(name, pts, r, closed=False, res=0):
    """Tube de section carrée/ronde le long d'une ligne brisée (courbe biseautée convertie en maillage)."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = r
    cu.bevel_resolution = res
    cu.use_fill_caps = True
    sp = cu.splines.new('POLY')
    sp.points.add(len(pts) - 1)
    for p, q in zip(sp.points, pts):
        p.co = (q[0], q[1], q[2], 1)
    sp.use_cyclic_u = closed
    o = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(o)
    return o


def to_mesh(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.convert(target='MESH')
    return bpy.context.view_layer.objects.active


# ---------------------------------------------------------------------------------------------
# 1. Modèle source : instances réelles, transformations appliquées, pas de hiérarchie
# ---------------------------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
sc = bpy.context.scene
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.duplicates_make_real()
for o in list(sc.objects):
    if o.type not in ('MESH', 'EMPTY'):
        bpy.data.objects.remove(o, do_unlink=True)
src = [o for o in sc.objects if o.type == 'MESH']
for o in src:
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = mw
for o in list(sc.objects):
    if o.type == 'EMPTY':
        bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
for o in src:
    o.select_set(True)
bpy.context.view_layer.objects.active = src[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# Repère d'origine : x vers l'avant, z en haut. Centres des roues d'après les pièces « wheel left ».
wl = [o for o in src if o.name.startswith('wheel left') and 'wheel.black' in o.name]
cs = sorted(((bbox(o)[0] + bbox(o)[1]) / 2 for o in wl), key=lambda c: c.x)
rear_c, front_c = cs[0], cs[-1]
K = 1.0 / (front_c.x - rear_c.x)  # empattement 1 m


def classify(o):
    lo, hi = bbox(o)
    c = (lo + hi) / 2
    n = o.name
    mats = [m.name for m in o.data.materials if m]
    m0 = mats[0] if mats else ''
    ext = hi - lo
    # Roues : jante, flancs, bande de roulement, rayons.
    if n.startswith('wheel left') or n.startswith('protector') or n.startswith('spitsi'):
        return ('wheel_f' if c.x > 0 else 'wheel_r', n)
    # Moyeux et axes.
    for wc, tag in ((front_c, 'wheel_f'), (rear_c, 'wheel_r')):
        if abs(c.x - wc.x) < 0.12 and abs(c.z - wc.z) < 0.12 and max(ext.x, ext.z) < 0.4 and not n.startswith('Plane'):
            return (tag + '_hub', n)
    # Valves (bas des roues).
    if c.z < 0.35 and n.startswith('Circle.05'):
        return ('drop', n)
    # Étriers de frein sur jante et câbles : au-dessus des roues.
    if c.z > 1.3 and (abs(c.x - 1.06) < 0.07 or abs(c.x + 0.83) < 0.08) and ext.y > 0.05:
        return ('drop', n)
    if n.startswith('Cube') or n.startswith('Circle.001') or n.startswith('Circle.005') or n.startswith('Circle.006') or n.startswith('Circle.032'):
        return ('drop', n)
    if n.startswith('NurbsPath') and m0 != 'metal.black':
        return ('drop', n)
    if n.startswith('Circle.009') or n.startswith('Circle.045'):
        return ('drop', n)
    # Transmission d'origine (le jeu garde pédalier, pédales, dérailleur du vélo de base) : chaîne, pédales, manivelles.
    if (n.startswith('Plane.022') or n.startswith('Plane.006') or n.startswith('Circle.039') or n.startswith('Plane.020') or
            n.startswith('Circle.04') or n.startswith('Plane.018') or n.startswith('Plane.026') or n.startswith('Circle.026') or
            (n.startswith('Plane.0') and c.z < 1.0)):
        return ('drop', n)
    if c.x > 0.55 and c.z > 1.7:
        return ('cockpit', n)
    if c.x < -0.3 and c.z > 1.65:
        return ('saddle', n)
    if m0 in ('rama', 'orange.metal'):
        return ('frame', n)
    return ('unknown', n)


groups = {}
for o in src:
    g, n = classify(o)
    groups.setdefault(g, []).append(o)
for g, l in sorted(groups.items()):
    print('GROUPE', g, len(l), sum(tris(o) for o in l))
for o in groups.get('unknown', []):
    lo, hi = bbox(o)
    print('  INCONNU', o.name, tris(o), [round(v, 2) for v in lo], [round(v, 2) for v in hi])

# ---------------------------------------------------------------------------------------------
# 2. Repère du jeu : avant vers −Y, empattement 1 m, roues posées à z = 0
# ---------------------------------------------------------------------------------------------
M = Matrix.Translation(to_bl(REAR_AXLE)) @ Matrix.Scale(K, 4) @ Matrix.Rotation(-math.pi / 2, 4, 'Z') @ Matrix.Translation(-rear_c)
for o in src:
    o.data.transform(M)
    o.data.update()
wheel_c = {'f': to_bl(FRONT_AXLE), 'r': to_bl(REAR_AXLE)}


def make_tire(tag, c):
    """Pneu gravel : section ovale (largeur TIRE_W, hauteur TIRE_H) autour de l'axe X ; couronne « tire », flancs « tire_wall »."""
    n_around = 72 if LOD == 0 else 28
    kt = 14 if LOD == 0 else 8
    r_c = WHEEL_R - TIRE_H / 2
    ra, rl = TIRE_H / 2, TIRE_W / 2
    bm = bmesh.new()
    ring = []
    for i in range(n_around):
        t = i / n_around * math.tau
        ct, st = math.cos(t), math.sin(t)
        row = []
        for j in range(kt):
            a = j / kt * math.tau
            rad = r_c + ra * math.cos(a)
            row.append(bm.verts.new((c.x + rl * math.sin(a), c.y + rad * ct, c.z + rad * st)))
        ring.append(row)
    bm.verts.ensure_lookup_table()
    me = bpy.data.meshes.new('w_%s_tire' % tag)
    me.materials.append(material('tire'))
    me.materials.append(material('tire_wall'))
    for i in range(n_around):
        for j in range(kt):
            f = bm.faces.new((ring[i][j], ring[(i + 1) % n_around][j], ring[(i + 1) % n_around][(j + 1) % kt], ring[i][(j + 1) % kt]))
            am = (j + 0.5) / kt * math.tau
            f.material_index = 0 if math.cos(am) > 0.5 else 1
            f.smooth = True
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new('w_%s_tire' % tag, me)
    sc.collection.objects.link(o)
    return o


def refine_wheel(tag):
    """Roue centrée sur son axe : pneu élargi, jante rabaissée, rayons et disque refaits."""
    c = wheel_c[tag]
    parts = {}
    for o in groups.get('wheel_' + tag, []):
        n = o.name
        if n.startswith('protector'):
            parts.setdefault('tread', []).append(o)
        elif 'wheel.orange' in n:
            parts.setdefault('wall', []).append(o)
        elif n.startswith('spitsi'):
            bpy.data.objects.remove(o, do_unlink=True)
        else:
            parts.setdefault('rim', []).append(o)
    hubs = groups.get('wheel_%s_hub' % tag, [])
    r_in_new = WHEEL_R - TIRE_H

    # Pneu refait : la bande de roulement d'origine (86 k triangles) ne survit pas à la réduction (silhouette hérissée),
    # on garde la jante du modèle (rabaissée) et on refait un pneu gravel lisse, flancs beiges.
    # (repère des sommets : x latéral, y avant−, z haut ; roue dans le plan y-z)
    wall_in = min(math.hypot((v.co - c).y, (v.co - c).z) for o in parts['wall'] for v in o.data.vertices)
    for o in parts['tread'] + parts['wall']:
        bpy.data.objects.remove(o, do_unlink=True)
    k_rim = r_in_new / wall_in
    for o in parts['rim']:
        for v in o.data.vertices:
            d = v.co - c
            v.co = Vector((v.co.x, c.y + d.y * k_rim, c.z + d.z * k_rim))
        o.data.update()
    rim_in = min(math.hypot((v.co - c).y, (v.co - c).z) for o in parts['rim'] for v in o.data.vertices)

    out = {}
    for o in parts['rim']:
        set_material(o, 'rim')
    out['rim'] = join(parts['rim'], 'w_%s_rim' % tag)
    decimate(out['rim'], B['rim'][LOD])
    out['tire'] = make_tire(tag, c)
    for o in hubs:
        mats = [m.name for m in o.data.materials if m]
        set_material(o, 'chrome' if mats and 'silver' in mats[0] else 'hub')
    hub = join(hubs, 'w_%s_hub' % tag) if hubs else None
    if hub:
        # Moyeu d'origine : tambour de 13 cm ; ramené à un moyeu à brides (rayon × 0,6), largeur inchangée.
        for v in hub.data.vertices:
            d = v.co - c
            v.co = Vector((v.co.x, c.y + d.y * 0.6, c.z + d.z * 0.6))
        hub.data.update()
        decimate(hub, B['hub'][LOD])
    extra = []
    # Rayons : 28, croisés, de la bride du moyeu au bas de la jante.
    if LOD == 0:
        side_x = 0.026 if tag == 'f' else 0.03
        pts = []
        n_sp = 28
        for i in range(n_sp):
            a = (i / n_sp) * math.tau
            sgn = 1 if i % 2 else -1
            hub_p = (c.x + sgn * side_x, c.y + math.sin(a + sgn * 0.5) * 0.017, c.z + math.cos(a + sgn * 0.5) * 0.017)
            rim_p = (c.x, c.y + math.sin(a) * (rim_in + 0.002), c.z + math.cos(a) * (rim_in + 0.002))
            pts.append((hub_p, rim_p))
        cu = bpy.data.curves.new('spokes_' + tag, 'CURVE')
        cu.dimensions = '3D'
        cu.bevel_depth = 0.0007
        cu.bevel_resolution = 0
        for a, b in pts:
            sp = cu.splines.new('POLY')
            sp.points.add(1)
            sp.points[0].co = (*a, 1)
            sp.points[1].co = (*b, 1)
        co = bpy.data.objects.new('spokes_' + tag, cu)
        sc.collection.objects.link(co)
        sp_o = to_mesh(co)
        set_material(sp_o, 'spokes')
        extra.append(sp_o)
    # Disque de frein.
    bm = bmesh.new()
    rx = ROTOR_X[0 if tag == 'f' else 1]
    rr = ROTOR_R[0 if tag == 'f' else 1]
    bmesh.ops.create_cone(bm, cap_ends=True, segments=36 if LOD == 0 else 16, radius1=rr, radius2=rr, depth=0.002,
                          matrix=Matrix.Translation((c.x + rx, c.y, c.z)) @ Matrix.Rotation(math.pi / 2, 4, 'Y'))
    rot = new_obj('rotor_' + tag, bm)
    set_material(rot, 'rotor')
    extra.append(rot)
    if tag == 'r':
        bm = bmesh.new()
        for i, rad in enumerate((0.046, 0.040, 0.034, 0.029, 0.024)):
            x0 = c.x - 0.030 - i * 0.0055
            bmesh.ops.create_cone(bm, cap_ends=True, segments=24 if LOD == 0 else 10, radius1=rad, radius2=rad, depth=0.005,
                                  matrix=Matrix.Translation((x0, c.y, c.z)) @ Matrix.Rotation(math.pi / 2, 4, 'Y'))
        cas = new_obj('cassette', bm)
        set_material(cas, 'cassette')
        extra.append(cas)
    parts_all = [out['tire'], out['rim']] + ([hub] if hub else []) + extra
    w = join(parts_all, 'wheel_' + ('front' if tag == 'f' else 'rear'))
    return w


wheel_f = refine_wheel('f')
wheel_r = refine_wheel('r')
for w, tag in ((wheel_f, 'f'), (wheel_r, 'r')):
    c = wheel_c[tag]
    w.data.transform(Matrix.Translation(-c))
    w.location = c
    w.data.update()


# ---------------------------------------------------------------------------------------------
# 3. Cadre, cockpit, selle
# ---------------------------------------------------------------------------------------------
def build_group(tag, name, mapper):
    objs = groups.get(tag, [])
    for o in objs:
        mats = [m.name for m in o.data.materials if m]
        set_material(o, mapper(o.name, mats[0] if mats else ''))
    # Tiges de selle et rails en nappes de 4 500 triangles : plafonnés pièce par pièce avant la fusion.
    for o in objs:
        decimate(o, 350 if o.name.startswith('NurbsPath') else 99999)
    ob = join(objs, name)
    decimate(ob, B[name][LOD])
    return ob


def frame_mat(n, m):
    return 'frame'


def cockpit_mat(n, m):
    if m == 'seat.skin' and n.split('_')[0] in ('Circle.012', 'Circle.013', 'Circle.017'):
        return 'bar_tape'
    return 'components'


def saddle_mat(n, m):
    if m in ('seat.skin', 'seat.plastic') and not n.startswith('1_'):
        return 'saddle'
    return 'components'


frame = build_group('frame', 'frame', frame_mat)
cockpit = build_group('cockpit', 'cockpit', cockpit_mat)
saddle = build_group('saddle', 'saddle', saddle_mat)
for o in groups.get('unknown', []):
    bpy.data.objects.remove(o, do_unlink=True)
for o in groups.get('drop', []):
    bpy.data.objects.remove(o, do_unlink=True)

# Chaîne (même tracé que bike_families.chain_path : elle passe par les poulies du dérailleur du vélo de base).
R1 = 0.105
chain = []
for i in range(15):
    a = math.pi / 2 - i * math.pi / 14
    chain.append((CHAIN_X, BB[1] + R1 * math.sin(a), R1 * math.cos(a)))
UP = (CHAIN_X, REAR_AXLE[1] - 0.052, REAR_AXLE[2] - 0.004)
LP = (CHAIN_X, REAR_AXLE[1] - 0.122, REAR_AXLE[2] + 0.018)
PR = 0.019
chain += [(CHAIN_X, LP[1] - PR, LP[2] + 0.006), (CHAIN_X, LP[1] - 0.004, LP[2] - PR), (CHAIN_X, UP[1], UP[2] + PR * 0.9),
          (CHAIN_X, UP[1] + PR * 0.8, UP[2] - 0.008), (CHAIN_X, REAR_AXLE[1] - 0.012, REAR_AXLE[2] - 0.041),
          (CHAIN_X, REAR_AXLE[1] + 0.028, REAR_AXLE[2] - 0.03), (CHAIN_X, REAR_AXLE[1] + 0.041, REAR_AXLE[2]), chain[0]]
ch = to_mesh(poly_tube('chain', [tuple(to_bl(p)) for p in chain], 0.0042))
set_material(ch, 'chain')
frame = join([frame, ch], 'frame')

# Attribut « zone » (livrée) : R tubes principaux, G arrière, B fourche, A douille.
me = frame.data
attr = me.color_attributes.new('zone', 'FLOAT_COLOR', 'POINT')
cols = []
for v in me.vertices:
    x, y, z = v.co.x, v.co.z, -v.co.y  # glTF
    zone = 0
    if z < -0.12 and y < 0.52:
        zone = 1
    elif z > 0.46 and y < 0.64:
        zone = 2
    elif z > 0.40 and y >= 0.64:
        zone = 3
    c = [0, 0, 0, 0]
    c[zone] = 1.0
    cols.extend(c)
attr.data.foreach_set('color', cols)
me.color_attributes.active_color = attr


# Recalage sur les cibles du coureur (cotes mesurées sur le vélo de base) : selle 4 cm plus bas, cintre 2 cm plus bas et 1 cm en avant.
saddle.data.transform(Matrix.Translation(to_bl((0, -0.04, 0))))
cockpit.data.transform(Matrix.Translation(to_bl((0, -0.02, 0.01))))
for o in (frame, cockpit, saddle):
    o.data.update()

# ---------------------------------------------------------------------------------------------
# 4. Pièces du vélo de base : pédalier, pédales, dérailleur, étriers à disque, ancres, boîtes d'inscriptions
# ---------------------------------------------------------------------------------------------
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=BASE)
base_objs = [o for o in bpy.data.objects if o not in before]
DROP_BASE = ('frame', 'cockpit', 'saddle', 'opt_bottles', 'opt_brakes_rim')
for o in list(base_objs):
    if o.name.split('.0')[0] in DROP_BASE:
        bpy.data.objects.remove(o, do_unlink=True)
        base_objs.remove(o)
# Matériaux importés en double (« components.001 ») : ramenés aux matériaux nommés.
for o in base_objs:
    if o.type != 'MESH':
        continue
    for i, slot in enumerate(o.material_slots):
        m = slot.material
        if m and '.0' in m.name:
            root = bpy.data.materials.get(m.name.split('.0')[0])
            if root:
                slot.material = root


def decal(name, centre, direction, length, height, lateral):
    e = bpy.data.objects.get(name)
    if e is None:
        e = bpy.data.objects.new(name, None)
        e.empty_display_type = 'ARROWS'
        sc.collection.objects.link(e)
    d = Vector(direction).normalized()
    e.location = to_bl(centre)
    e.rotation_euler = (math.atan2(d.z, d.y), 0.0, 0.0)
    e.scale = (lateral, height, length)


# Inscriptions du cadre : mesurées sur les tubes du modèle (centre, sens de lecture, longueur, hauteur, épaisseur).
decal('decal_dt', (0, 0.46, 0.25), (0, 0.34, 0.44), 0.34, 0.05, 0.08)
decal('decal_tt', (0, 0.775, 0.15), (0, 0.085, 0.46), 0.14, 0.032, 0.06)
decal('decal_st', (0, 0.50, -0.07), (0, 0.41, -0.135), 0.2, 0.05, 0.06)
decal('decal_fork', (0, 0.50, 0.54), (0, 0.285, -0.12), 0.14, 0.04, 0.14)
decal('decal_cs', (0, 0.30, -0.22), (0, -0.065, 0.38), 0.12, 0.03, 0.12)
an = bpy.data.objects.get('anchor_number')
if an:
    an.location = to_bl((0, 0.86, -0.23))

for o in list(bpy.data.objects):
    if o.type == 'MESH' and o.data.users == 0:
        bpy.data.objects.remove(o, do_unlink=True)
if DEBUG:
    bpy.ops.wm.save_as_mainfile(filepath=DEBUG.rstrip('/') + '/stage.blend')
if OUT:
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=OUT, export_format='GLB', use_selection=False, export_yup=True, export_apply=False, export_animations=False,
        export_skins=False, export_morph=False, export_materials='EXPORT', export_normals=True, export_texcoords=False,
        export_vertex_color='NAME', export_vertex_color_name='zone', export_all_vertex_colors=False,
        export_active_vertex_color_when_no_material=False, export_cameras=False, export_lights=False,
        export_extras=False, export_draco_mesh_compression_enable=False)
    tot = sum(tris(o) for o in bpy.data.objects if o.type == 'MESH')
    print('TOTAL', tot, 'triangles')
