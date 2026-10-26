"""
VTT du jeu : « Carbon Frame Bike » de prefrontal cortex (Sketchfab, CC BY-SA 4.0, d'après le vélo de Robert Schweier / Needle)
adapté au coureur. Modèle dérivé : à redistribuer sous la même licence (ASSETS_LICENSES.md).

Le modèle d'origine (115 k triangles, 320 pièces) est un VTT tout-suspendu de descente à l'arrêt, roue avant braquée, câbles
flottants, roues de tailles différentes et pneus de 7,5 à 10 cm. Il est remis dans le repère du jeu :

  - roue avant débraquée (rotation autour de l'axe de direction), vélo mis de niveau, échelle pour que le cintre soit à
    portée des mains du coureur ;
  - le pédalier du jeu (BB à 0,27 m) est plus bas de 6,5 cm sous les axes que celui du modèle (boîtier à hauteur d'axe) :
    le vélo est mis « en suspension écrasée » (bras oscillant relevé autour de son pivot, fourche raccourcie) ;
  - roues refaites : jante et moyeu du modèle, pneu à crampons, rayons, disque de frein et cassette procéduraux ;
  - cadre (matériau « frame »), fourche, cintre (« bar_tape » pour les poignées), selle ; câbles, chaîne d'origine,
    pédalier, galets, boulons et logos supprimés. Les pédales, le pédalier et les inscriptions viennent de la famille de base.

Usage :
  blender -b --python build_vtt.py -- --src carbon_frame_bike.glb --base aero.glb --out vtt.glb [--lod 1] [--debug DOSSIER] [--stop N]
"""
import sys
import math
import bpy
import bmesh
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def opt(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


SRC = opt('--src')
BASE = opt('--base')
OUT = opt('--out')
LOD = int(opt('--lod', '0'))
DEBUG = opt('--debug')
STOP = int(opt('--stop', '99'))

# Repères du vélo de base (tools/blender/build_cyclist.py), en mètres, repère glTF (x gauche, y haut, z avant).
BB = (0.0, 0.27, 0.0)
R_OUT = 0.335            # rayon des roues (pneu compris)
TIRE_H = 0.062           # hauteur de pneu
TIRE_W = 0.066           # largeur de pneu
MTB_PALM = (0.235, 1.0, 0.535)  # gltfAvatar.ts : milieu de la paume sur la poignée gauche

B = {'frame': (9000, 3000), 'swing': (6000, 2000), 'fork': (2600, 900), 'cockpit': (3000, 900), 'saddle': (1500, 600),
     'rim': (2400, 800), 'hub': (700, 250), 'rd': (700, 250), 'caliper': (900, 300)}


def to_bl(p):
    """glTF (x, y, z) → Blender (x, −z, y)."""
    return Vector((p[0], -p[2], p[1]))


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def bbox(objs):
    pts = [v.co for o in objs for v in o.data.vertices]
    return Vector([min(p[i] for p in pts) for i in range(3)]), Vector([max(p[i] for p in pts) for i in range(3)])


def centre(objs):
    lo, hi = bbox(objs)
    return (lo + hi) / 2


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


def poly_tube(name, pts, r, closed=False):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = r
    cu.bevel_resolution = 0
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


def transform(objs, m):
    for o in objs:
        o.data.transform(m)
        o.data.update()


def rot_about(axis_dir, point, angle):
    return Matrix.Translation(point) @ Matrix.Rotation(angle, 4, axis_dir) @ Matrix.Translation(-point)


# ---------------------------------------------------------------------------------------------
# 1. Source : pose de départ, objets indépendants (nom des ancêtres gardé), repère du jeu
# ---------------------------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
sc = bpy.context.scene
sc.frame_set(0)
for o in list(sc.objects):
    if o.name.startswith('Icosphere'):
        bpy.data.objects.remove(o, do_unlink=True)
src = [o for o in sc.objects if o.type == 'MESH']
for o in src:
    anc = []
    p = o.parent
    while p:
        anc.append(p.name)
        p = p.parent
    o['anc'] = '|'.join(anc) + '|' + o.name
    mw = o.matrix_world.copy()
    o.animation_data_clear()
    o.parent = None
    o.matrix_world = mw
for o in list(sc.objects):
    if o.type != 'MESH':
        bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
for o in src:
    o.select_set(True)
bpy.context.view_layer.objects.active = src[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def has(o, *keys):
    return any(k in o['anc'] for k in keys)


# Pivot, éléments à part. Matériaux d'origine (noms allemands) : Carbon = cadre.
G = {}
for o in src:
    a = o['anc']
    if has(o, 'Schlauch', 'GLTF_created', 'Armature', 'Logo', 'ISO_', 'inafag', 'Gummi', 'Umlenkrolle', 'RobertS2016_Kette', 'Pedale_569', 'Shadow'):
        g = 'drop'
    elif has(o, 'ZB_HR'):
        g = 'rim_r' if has(o, 'Felge') else 'hub_r' if has(o, 'Nabe') else 'drop'
    elif has(o, 'ZB_VR'):
        g = 'rim_f' if has(o, 'Felge') else 'hub_f' if has(o, 'Nabe') else 'drop'
    elif has(o, 'Schaltwerk'):
        g = 'rd'
    elif has(o, 'Sattelstange_733'):
        g = 'saddle'
    elif has(o, 'Federgabel_470'):
        g = 'stanch'
    elif has(o, 'Lenker 1_479', 'Lenkergriff', 'Bremsgriff', 'Vorbau'):
        g = 'cockpit'
    elif has(o, 'Magura_MT7 1'):
        g = 'caliper_f'
    elif has(o, 'Magura_MT7_'):
        g = 'caliper_r'
    elif has(o, 'Federgabel'):
        g = 'fork'
    elif has(o, 'Federachse_4') and has(o, 'Schwinge', 'Daempfer', 'Hauptlager', 'Schaltwerkauge', 'HR-Aufnahme'):
        g = 'swing'
    else:
        g = 'frame'
    G.setdefault(g, []).append(o)
for g, l in sorted(G.items()):
    print('GROUPE', g, len(l), sum(tris(o) for o in l))
for o in G.get('drop', []):
    bpy.data.objects.remove(o, do_unlink=True)
G.pop('drop', None)
FRONT = ['fork', 'stanch', 'cockpit', 'caliper_f', 'rim_f', 'hub_f']
if STOP == 0:
    palette = {'frame': (0.8, 0.8, 0.8), 'swing': (0.2, 0.4, 1), 'fork': (1, 0.2, 0.2), 'cockpit': (0.1, 0.8, 0.1), 'saddle': (1, 0.8, 0), 'rd': (0.8, 0.2, 0.8),
               'caliper_f': (0, 0.8, 0.8), 'caliper_r': (0, 0.8, 0.8), 'rim_f': (0.5, 0.3, 0.1), 'rim_r': (0.5, 0.3, 0.1), 'hub_f': (0, 0, 0), 'hub_r': (0, 0, 0)}
    for g, l in G.items():
        for o in l:
            o.color = (*palette.get(g, (1, 1, 1)), 1)
    bpy.ops.wm.save_as_mainfile(filepath=(DEBUG or 'C:/tmp/gravel-work/dbg').rstrip('/') + '/vtt0.blend')
    sys.exit(0)

# Axe de direction (jeu de direction) et plan de la roue avant : débraquage.
import numpy as np


def plane_normal(o):
    P = np.array([tuple(v.co) for v in o.data.vertices])
    C = P.mean(0)
    n = np.linalg.svd(P - C, full_matrices=False)[2][2]
    return Vector(n)


alive = [o for l in G.values() for o in l]
hs_up = centre([o for o in alive if has(o, 'Steuersatz_ob')])
hs_lo = centre([o for o in alive if has(o, 'Steuersatz_un')])

axis = (hs_up - hs_lo).normalized()
n_f = plane_normal(G['rim_f'][0])
n_r = plane_normal(G['rim_r'][0])
best = (9.0, 0.0)
for i in range(-1800, 1801):
    a = i * math.pi / 3600
    m = Matrix.Rotation(a, 3, axis)
    e = (m @ n_f).cross(n_r).length
    if e < best[0]:
        best = (e, a)
phi = best[1]
print('BRAQUAGE', round(math.degrees(phi), 1), 'deg, erreur', round(best[0], 4))
front = [o for g in FRONT for o in G.get(g, [])]
transform(front, rot_about(axis, hs_lo, phi))

# Repère du jeu : rotation de +90° autour de Z ((x, y) → (−y, x) : avant −x → −Y, côté transmission +y → −X).
R90 = Matrix.Rotation(math.pi / 2, 4, 'Z')
allm = [o for l in G.values() for o in l]
transform(allm, R90)

# Mise de niveau (axes des roues) autour de l'axe latéral X, puis échelle et recalage sur le boîtier de pédalier.
rc = centre(G['rim_r'])
fc = centre(G['rim_f'])
tilt = math.atan2(fc.z - rc.z, -(fc.y - rc.y))  # pente du segment arrière → avant (avant vers −Y)
print('TANGAGE', round(math.degrees(tilt), 2), 'deg')
transform(allm, rot_about('X', rc, tilt))  # à vérifier : signe
rc = centre(G['rim_r'])
fc = centre(G['rim_f'])
rc0 = rc.copy()
print('AXES', [round(v, 3) for v in rc], [round(v, 3) for v in fc])

# Échelle et recalage : boîtier de pédalier du modèle (axe des manivelles) → BB du jeu. Le modèle est en mètres.
K = float(opt('--k', '1.0'))
# Le boîtier est à hauteur d'axe dans le modèle, à 0,184 m devant l'axe arrière (x d'origine) : mesuré sur le pédalier d'origine.
bb_model = Vector((0.0, rc.y - 0.415, rc.z + (0.331 - 0.333)))
bb_model.z -= 0.415 * math.sin(tilt) * 0.0
T = Matrix.Translation(to_bl(BB)) @ Matrix.Scale(K, 4) @ Matrix.Translation(-bb_model)
transform([o for l in G.values() for o in l], T)
axis_g = (T.to_3x3() @ R90.to_3x3() @ axis).normalized()
hs_lo_g = T @ (rot_about('X', rc, tilt) @ (R90 @ hs_lo))
rc = centre(G['rim_r'])
fc = centre(G['rim_f'])
print('AXES K', [round(v, 3) for v in rc], [round(v, 3) for v in fc], 'axe de direction', [round(v, 3) for v in axis_g])

# Suspension écrasée : le boîtier du jeu est 6,5 cm sous les axes, celui du modèle à hauteur d'axe.
# Arrière : bras oscillant (et dérailleur, étrier) relevés autour de son pivot.
pivot_objs = [o for o in G['swing'] if has(o, 'Hauptlager')]
pivot = centre(pivot_objs) if pivot_objs else Vector((0, rc.y - 0.1, rc.z + 0.12))
print('PIVOT', [round(v, 3) for v in pivot])
swing = G['swing'] + G.get('rd', []) + G.get('caliper_r', [])


def axle_after(angle):
    return rot_about('X', pivot, angle) @ rc


best = (9.0, 0.0)
for i in range(-300, 301):
    a = i * 0.0005
    e = abs(axle_after(a).z - R_OUT)
    if e < best[0]:
        best = (e, a)
theta = best[1]
transform(swing, rot_about('X', pivot, theta))
rear_axle = axle_after(theta)
print('BRAS OSCILLANT', round(math.degrees(theta), 1), 'deg ; axe arrière', [round(v, 3) for v in rear_axle])

# Avant : bas de fourche (fourreaux, étrier) remonté le long de l'axe de direction, dans les tubes plongeurs ; roue relevée d'autant.
a_up = axis_g if axis_g.z > 0 else -axis_g
d = (R_OUT - fc.z) / a_up.z
transform(G['fork'] + G.get('caliper_f', []), Matrix.Translation(a_up * d))
front_axle = fc + a_up * d
print('FOURCHE', round(d, 3), 'm ; axe avant', [round(v, 3) for v in front_axle])

# ---------------------------------------------------------------------------------------------
# 2. Poste de pilotage et selle sur les cibles du coureur (gltfAvatar.ts : paumes sur les poignées, selle de la famille route)
# ---------------------------------------------------------------------------------------------
BAR_HALF = 0.2325   # milieu des poignées (m, de part et d'autre de l'axe)
GRIP_AXIS = (0.0, 0.958, 0.54)
grips = [o for o in G['cockpit'] if has(o, 'Lenkergriff') and tris(o) > 1000]
gl = centre([o for o in grips if centre([o]).x > 0])
sx = BAR_HALF / abs(gl.x)
# Cintre resserré (poignées de 16,5 à 30 cm de l'axe), puis recalé : poignées à y 0,958, z 0,54.
transform(G['cockpit'], Matrix.Scale(sx, 4, Vector((1, 0, 0))))
gl = centre([o for o in grips if centre([o]).x > 0])
target = to_bl(GRIP_AXIS)
shift = Vector((0, target.y - gl.y, target.z - gl.z))
transform(G['cockpit'], Matrix.Translation(shift))
print('CINTRE ×', round(sx, 2), 'décalage', [round(v, 3) for v in shift])

# Potence prolongée : du haut du jeu de direction au centre du cintre (la potence d'origine a suivi le cintre).
hs_up_g = T @ (rot_about('X', rc0, tilt) @ (R90 @ hs_up))
steer_top = hs_up_g + a_up * 0.045
bar_c = centre([o for o in G['cockpit'] if has(o, 'Vorbau')])
bm = bmesh.new()
dv = bar_c - steer_top
mat = Matrix.Translation((steer_top + bar_c) / 2) @ dv.to_track_quat('Z', 'Y').to_matrix().to_4x4()
bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.019, radius2=0.019, depth=dv.length, matrix=mat)
stem = new_obj('stem_ext', bm)
set_material(stem, 'components')

# Selle : recalée sur la selle route (rails de z −0,33 à −0,09, dessus à 0,96), légèrement inclinée vers l'arrière.
SADDLE_Z = float(opt('--saddle-z', '-0.17'))
SADDLE_TOP = float(opt('--saddle-top', '0.93'))
SADDLE_TILT = math.radians(float(opt('--saddle-tilt', '7')))
post_lo = min((v.co for o in G['saddle'] for v in o.data.vertices), key=lambda c: c.z)
transform(G['saddle'], rot_about('X', post_lo, -SADDLE_TILT))
slo, shi = bbox(G['saddle'])
sc_ = (slo + shi) / 2
transform(G['saddle'], Matrix.Translation(Vector((0, -SADDLE_Z - sc_.y, SADDLE_TOP - shi.z))))
print('SELLE', [round(v, 3) for v in bbox(G['saddle'])[0]], [round(v, 3) for v in bbox(G['saddle'])[1]])

# ---------------------------------------------------------------------------------------------
# 3. Roues : jante et moyeu du modèle, pneu à crampons, rayons, disque et cassette refaits
# ---------------------------------------------------------------------------------------------
def make_tire(tag, c):
    n_around = 72 if LOD == 0 else 28
    kt = 14 if LOD == 0 else 8
    r_c = R_OUT - TIRE_H / 2
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
    me = bpy.data.meshes.new('w_%s_tire' % tag)
    me.materials.append(material('tire'))
    me.materials.append(material('tire_wall'))
    for i in range(n_around):
        for j in range(kt):
            f = bm.faces.new((ring[i][j], ring[(i + 1) % n_around][j], ring[(i + 1) % n_around][(j + 1) % kt], ring[i][(j + 1) % kt]))
            am = (j + 0.5) / kt * math.tau
            f.material_index = 0 if math.cos(am) > 0.2 else 1
            f.smooth = True
    # Crampons : un au centre, deux aux épaules en alternance.
    n_k = 36 if LOD == 0 else 16
    for i in range(n_k):
        t = i / n_k * math.tau
        for lat in ((0.0,) if LOD else ((0.0,) if i % 2 else (-0.024, 0.024))):
            m = Matrix.Translation(c) @ Matrix.Rotation(t, 4, 'X') @ Matrix.Translation((lat, 0, R_OUT - 0.004)) \
                @ Matrix.Diagonal((0.017, 0.016, 0.011, 1.0))
            bmesh.ops.create_cube(bm, size=1.0, matrix=m)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new('w_%s_tire' % tag, me)
    sc.collection.objects.link(o)
    return o


def build_wheel(tag, axle):
    rim = G['rim_' + tag][0]
    hubs = G['hub_' + tag]
    parts = []
    c0 = centre([rim])
    # Jante : centrée sur l'axe, rayon ramené à R_OUT − TIRE_H (le pneu la coiffe).
    r_rim = max(math.hypot(v.co.y - c0.y, v.co.z - c0.z) for v in rim.data.vertices)
    k = (R_OUT - TIRE_H) / r_rim
    for v in rim.data.vertices:
        v.co = Vector((axle.x + v.co.x - c0.x, axle.y + (v.co.y - c0.y) * k, axle.z + (v.co.z - c0.z) * k))
    rim.data.update()
    set_material(rim, 'rim')
    decimate(rim, B['rim'][LOD])
    parts.append(rim)
    hc = centre(hubs)
    for o in hubs:
        o.data.transform(Matrix.Translation(axle - hc))
        o.data.update()
        set_material(o, 'hub')
    hub = join(hubs, 'w_%s_hub' % tag)
    decimate(hub, B['hub'][LOD])
    parts.append(hub)
    parts.append(make_tire(tag, axle))
    # Rayons : 32, croisés.
    if LOD == 0:
        flange = 0.032
        cu = bpy.data.curves.new('spokes_' + tag, 'CURVE')
        cu.dimensions = '3D'
        cu.bevel_depth = 0.0009
        cu.bevel_resolution = 0
        r_in = R_OUT - TIRE_H - 0.004
        for i in range(32):
            a = i / 32 * math.tau
            sgn = 1 if i % 2 else -1
            sp = cu.splines.new('POLY')
            sp.points.add(1)
            sp.points[0].co = (axle.x + sgn * flange, axle.y + math.sin(a + sgn * 0.5) * 0.025, axle.z + math.cos(a + sgn * 0.5) * 0.025, 1)
            sp.points[1].co = (axle.x, axle.y + math.sin(a) * r_in, axle.z + math.cos(a) * r_in, 1)
        co = bpy.data.objects.new('spokes_' + tag, cu)
        sc.collection.objects.link(co)
        sp_o = to_mesh(co)
        set_material(sp_o, 'spokes')
        parts.append(sp_o)
    # Disque de frein : côté gauche (+X), 18 cm.
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=36 if LOD == 0 else 16, radius1=0.09, radius2=0.09, depth=0.002,
                          matrix=Matrix.Translation((axle.x + 0.058, axle.y, axle.z)) @ Matrix.Rotation(math.pi / 2, 4, 'Y'))
    rot = new_obj('rotor_' + tag, bm)
    set_material(rot, 'rotor')
    parts.append(rot)
    if tag == 'r':
        bm = bmesh.new()
        for i, rad in enumerate((0.076, 0.066, 0.057, 0.049, 0.042, 0.036, 0.030)):
            bmesh.ops.create_cone(bm, cap_ends=True, segments=24 if LOD == 0 else 10, radius1=rad, radius2=rad, depth=0.0045,
                                  matrix=Matrix.Translation((axle.x - 0.034 - i * 0.0055, axle.y, axle.z)) @ Matrix.Rotation(math.pi / 2, 4, 'Y'))
        cas = new_obj('cassette', bm)
        set_material(cas, 'cassette')
        parts.append(cas)
    w = join(parts, 'wheel_' + ('front' if tag == 'f' else 'rear'))
    w.data.transform(Matrix.Translation(-axle))
    w.location = axle
    return w


wheel_r = build_wheel('r', rear_axle)
wheel_f = build_wheel('f', front_axle)

# Chaîne : anneau du pédalier du jeu, pignon de la cassette, cage du dérailleur d'origine.
R1 = 0.105
CHAIN_X = -0.045
zr = -rear_axle.y
chain = [(CHAIN_X, BB[1] + R1 * math.sin(math.pi / 2 - i * math.pi / 14), R1 * math.cos(math.pi / 2 - i * math.pi / 14)) for i in range(15)]
chain += [(CHAIN_X, R_OUT - 0.115, zr + 0.055), (CHAIN_X, R_OUT - 0.085, zr + 0.02), (CHAIN_X, R_OUT - 0.045, zr - 0.012),
          (CHAIN_X, R_OUT - 0.005, zr - 0.047), (CHAIN_X, R_OUT + 0.035, zr - 0.036), (CHAIN_X, R_OUT + 0.049, zr), chain[0]]
ch = to_mesh(poly_tube('chain', [tuple(to_bl(q)) for q in chain], 0.0045))
set_material(ch, 'chain')


# ---------------------------------------------------------------------------------------------
# 4. Pièces : cadre, fourche, cintre, selle
# ---------------------------------------------------------------------------------------------
def mats_of(o):
    return [m.name for m in o.data.materials if m]


def assign(objs, fn):
    for o in objs:
        m = mats_of(o)
        set_material(o, fn(m[0] if m else '', o))


def finish(objs, key):
    # Pièces lourdes plafonnées une à une avant la fusion (vis, roulements restent légers).
    for o in objs:
        decimate(o, max(60, int(B[key][LOD] * 0.45)))
    ob = join(objs, key)
    decimate(ob, B[key][LOD])
    return ob


print('MATERIAUX', {g: sorted({mm for o in G[g] for mm in mats_of(o)}) for g in ('frame', 'swing', 'fork', 'stanch', 'cockpit', 'saddle', 'rd', 'caliper_f')})
assign(G['frame'] + G['swing'], lambda m, o: 'frame' if m == 'Carbon' else 'components')
assign(G['fork'] + G['stanch'] + G.get('caliper_f', []) + G.get('caliper_r', []) + G.get('rd', []), lambda m, o: 'components')
assign(G['cockpit'], lambda m, o: 'bar_tape' if m == 'Griffe' else 'components')
assign(G['saddle'], lambda m, o: 'saddle' if m == 'Sattel' and centre([o]).z > 0.8 else 'components')
for o in G.get('rd', []):
    decimate(o, 40)
frame = finish(G['frame'] + G['swing'] + [stem, ch], 'frame')
extras = G.get('rd', []) + G.get('caliper_r', []) + G.get('caliper_f', [])
for o in extras:
    decimate(o, 120)
fork = finish(G['fork'] + G['stanch'], 'fork')
frame = join([frame, fork] + extras, 'frame')
cockpit = finish(G['cockpit'], 'cockpit')
saddle = finish(G['saddle'], 'saddle')
print('PIECES', {o.name: tris(o) for o in (frame, cockpit, saddle, wheel_f, wheel_r)})
if STOP == 4:
    bpy.ops.wm.save_as_mainfile(filepath=(DEBUG or 'C:/tmp/gravel-work/dbg').rstrip('/') + '/vtt4.blend')
    sys.exit(0)

# Attribut « zone » (livrée) : 0 cadre, 1 bras arrière, 2 avant (fourche), 3 douille.
me = frame.data
attr = me.color_attributes.new('zone', 'FLOAT_COLOR', 'POINT')
cols = []
for v in me.vertices:
    zone = 0
    if v.co.y > 0.12 and v.co.z < 0.62:
        zone = 1
    elif v.co.y < -0.35 and v.co.z < 0.75:
        zone = 2
    c = [0, 0, 0, 0]
    c[zone] = 1.0
    cols.extend(c)
attr.data.foreach_set('color', cols)
me.color_attributes.active_color = attr
frame.name = 'frame'

# ---------------------------------------------------------------------------------------------
# 5. Pédalier, pédales, ancres et boîtes d'inscriptions de la famille de base
# ---------------------------------------------------------------------------------------------
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=BASE)
base_objs = [o for o in bpy.data.objects if o not in before]
KEEP = ('crankset', 'pedal_L', 'pedal_R')
for o in list(base_objs):
    root = o.name.split('.0')[0]
    if o.type == 'MESH' and root not in KEEP:
        bpy.data.objects.remove(o, do_unlink=True)
        base_objs.remove(o)
for o in base_objs:
    if o.type != 'MESH':
        continue
    for slot in o.material_slots:
        m = slot.material
        if m and '.0' in m.name:
            root = bpy.data.materials.get(m.name.split('.0')[0])
            if root:
                slot.material = root


def decal(name, centre_, direction, length, height, lateral):
    e = bpy.data.objects.get(name)
    if e is None:
        e = bpy.data.objects.new(name, None)
        e.empty_display_type = 'ARROWS'
        sc.collection.objects.link(e)
    dd = Vector(direction).normalized()
    e.location = to_bl(centre_)
    e.rotation_euler = (math.atan2(dd.z, dd.y), 0.0, 0.0)
    e.scale = (lateral, height, length)


# Inscription sur le tube principal ; les autres emplacements (haubans, fourche…) n'ont pas de tube plat : boîtes minuscules.
decal('decal_dt', (0, 0.64, 0.26), (0, 0.34, 0.36), 0.28, 0.07, 0.12)
for nm, c_ in (('decal_tt', (0, 0.7, 0.2)), ('decal_st', (0, 0.6, -0.1)), ('decal_fork', (0, 0.6, 0.5)), ('decal_cs', (0, 0.4, -0.2))):
    decal(nm, c_, (0, 0, 1), 0.001, 0.001, 0.001)
an = bpy.data.objects.get('anchor_number')
if an:
    an.location = to_bl((0, 0.8, -0.15))

keep_mesh = {frame, cockpit, saddle, wheel_f, wheel_r}
for o in list(bpy.data.objects):
    if o.type == 'MESH' and o not in keep_mesh and o.name.split('.0')[0] not in KEEP:
        bpy.data.objects.remove(o, do_unlink=True)
if DEBUG:
    bpy.ops.wm.save_as_mainfile(filepath=DEBUG.rstrip('/') + '/vtt5.blend')
if OUT:
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=OUT, export_format='GLB', use_selection=False, export_yup=True, export_apply=False, export_animations=False,
        export_skins=False, export_morph=False, export_materials='EXPORT', export_normals=True, export_texcoords=False,
        export_vertex_color='NAME', export_vertex_color_name='zone', export_all_vertex_colors=False,
        export_active_vertex_color_when_no_material=False, export_cameras=False, export_lights=False,
        export_extras=False, export_draco_mesh_compression_enable=False)
    print('TOTAL', sum(tris(o) for o in bpy.data.objects if o.type == 'MESH'), 'triangles')
