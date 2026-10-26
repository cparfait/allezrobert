"""
Véhicule du trafic : .blend (BlenderKit) → .glb prêt pour vehicles/optimize.mjs.

- supprime caméras, lumières, objets masqués au rendu et l'habitacle (--drop, motif des noms) ;
- regroupe les pièces de chaque roue (pneu, jante, disque…) en 4 objets « wheel_FL/FR/RL/RR »,
  origine au centre de la roue (le jeu les fait tourner autour de leur axe x) ;
- fusionne tout le reste en « body » (un maillage, une primitive par matériau) ;
- renomme « paint » le matériau de carrosserie (repeint par le jeu) ;
- échelle réelle, avant vers −Y de Blender (= +Z du glTF), roues posées à z = 0.

Usage :
  blender -b <fichier.blend> --python export_vehicle.py -- <sortie.glb> [--inspect] [--flip]
         [--drop MOTIF] [--wheels MOTIF] [--paint MOTIF] [--length M] [--split-wheels] [--wheel-islands]
  blender -b --python export_vehicle.py -- <sortie.glb> --import <source.glb> […]  (Sketchfab)
"""
import re
import sys
import json
import bpy
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def opt(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


VALUED = ('--drop', '--wheels', '--paint', '--length', '--import', '--json')
out = next((a for i, a in enumerate(argv) if not a.startswith('--') and (i == 0 or argv[i - 1] not in VALUED)), None)
DROP = r'interior|seat|dashboard|dash_|steering|pedal|engine|gear_?stick|shifter|cockpit|belt|carpet|speaker|mirror_inner|driver|wunderbaum'
# --drop complète la liste par défaut (noms d'objets ou de matériaux).
INTERIOR = re.compile(DROP + ('|' + opt('--drop') if opt('--drop') else ''), re.I)
# Pièces qui tournent avec la roue ; étriers et suspensions restent fixes.
WHEEL = re.compile(opt('--wheels', r'wheel|(^|_)rim|tire|tyre|roue|pneu|jante'), re.I)
FIXED = re.compile(r'caliper|brake|suspension|steering|fender|arch', re.I)
PAINT = re.compile(opt('--paint', r'paint|body|carpaint|car_paint|lack|lak|carros'), re.I)
NOT_PAINT = re.compile(r'glass|window|chrome|rubber|tire|tyre|light|lamp|plastic|black|interior|grill|plate', re.I)

if opt('--import'):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=opt('--import'))
scene = bpy.context.scene


def matches(o, rx):
    """Nom de l'objet ou d'un de ses matériaux."""
    return bool(rx.search(o.name)) or any(m and rx.search(m.name) for m in getattr(o.data, 'materials', []))


def world_box(objs):
    # Sommets plutôt que bound_box : celle-ci n'est recalculée qu'à la mise à jour de la scène.
    pts = [o.matrix_world @ v.co for o in objs for v in o.data.vertices] if all(o.type == 'MESH' for o in objs) else [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def meshes():
    return [o for o in scene.objects if o.type == 'MESH']


if '--inspect' in argv:
    info = []
    for o in meshes():
        lo, hi = world_box([o])
        info.append({'name': o.name, 'parent': o.parent.name if o.parent else None, 'tris': sum(len(p.vertices) - 2 for p in o.data.polygons),
                     'mats': [m.name for m in o.data.materials if m], 'min': [round(v, 2) for v in lo], 'max': [round(v, 2) for v in hi],
                     'hidden': o.hide_render})
    lo, hi = world_box(meshes())
    report = json.dumps({'objects': info, 'size': [round(v, 2) for v in hi - lo]}, ensure_ascii=False)
    if opt('--json'):
        with open(opt('--json'), 'w', encoding='utf-8') as f:
            f.write(report)
    else:
        print('INSPECT ' + report)
    sys.exit(0)

# Instances de collection et liens : objets réels, modificateurs appliqués.
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.duplicates_make_real()
for o in list(scene.objects):
    if o.type not in ('MESH', 'EMPTY') or o.hide_render or (o.type == 'MESH' and matches(o, INTERIOR)):
        bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
for o in meshes():
    o.hide_set(False)
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes()[0]
bpy.ops.object.convert(target='MESH')
# Maillages partagés (roues dupliquées) : une copie par objet, sinon les transformations s'additionnent.
bpy.ops.object.make_single_user(object=True, obdata=True)
# Détache les parents en gardant la position, puis applique les transformations.
for o in meshes():
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = mw
for o in list(scene.objects):
    if o.type == 'EMPTY':
        bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# Orientation : la longueur suit l'axe Y, l'avant vers −Y (convention BlenderKit ; --flip sinon).
lo, hi = world_box(meshes())
size = hi - lo
rot = Matrix.Identity(4)
if size.x > size.y:
    rot = Matrix.Rotation(-1.5707963, 4, 'Z')
if '--flip' in argv:
    rot = Matrix.Rotation(3.14159265, 4, 'Z') @ rot
center = (lo + hi) / 2
for o in meshes():
    o.data.transform(rot @ Matrix.Translation(Vector((-center.x, -center.y, -lo.z))))
    o.data.update()
target_len = opt('--length')
if target_len:
    lo, hi = world_box(meshes())
    k = float(target_len) / (hi.y - lo.y)
    for o in meshes():
        o.data.transform(Matrix.Scale(k, 4))

# --wheel-islands : modèle d'un seul maillage dont les roues sont des îlots (disques) : on sépare tout par
# îlots, puis les disques posés au sol (rond dans le plan longueur × hauteur, mince en largeur) deviennent des roues.
if '--wheel-islands' in argv:
    for o in meshes():
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.separate(type='LOOSE')
        bpy.ops.object.mode_set(mode='OBJECT')
    _lo, _hi = world_box(meshes())
    H = _hi.z - _lo.z
    for i, o in enumerate(meshes()):
        lo, hi = world_box([o])
        e = hi - lo
        if lo.z < 0.06 * H and e.z > 0.18 * H and abs(e.y - e.z) < 0.2 * e.z and e.x < e.y:
            o.name = f'wheel_island_{i}'

# --split-wheels : pneus et jantes de plusieurs roues fusionnés en un seul objet (essieu ou côté entier) :
# on les sépare par îlots de géométrie, puis chaque îlot est rangé dans son quart ci-dessous.
if '--split-wheels' in argv:
    for o in [m for m in meshes() if matches(m, WHEEL) and not FIXED.search(m.name)]:
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.separate(type='LOOSE')
        bpy.ops.object.mode_set(mode='OBJECT')

# Roues : pièces dont le nom correspond, regroupées par quart (gauche/droite × avant/arrière).
wheel_parts = {}
for o in meshes():
    if not matches(o, WHEEL) or FIXED.search(o.name):
        continue
    lo, hi = world_box([o])
    c = (lo + hi) / 2
    key = ('F' if c.y < 0 else 'R') + ('L' if c.x > 0 else 'R')
    wheel_parts.setdefault(key, []).append(o)


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    obj.data.name = name
    return obj


for key, parts in wheel_parts.items():
    w = join(parts, 'wheel_' + key)
    lo, hi = world_box([w])
    c = (lo + hi) / 2
    w.data.transform(Matrix.Translation(-c))
    w.location = c
rest = [o for o in meshes() if not o.name.startswith('wheel_')]
body = join(rest, 'body')

# Matériau de carrosserie : par le nom, sinon la plus grande surface hors vitres / chromes / caoutchouc.
area = {}
for poly in body.data.polygons:
    m = body.data.materials[poly.material_index] if body.data.materials else None
    if m:
        area[m] = area.get(m, 0) + poly.area
named = [m for m in area if PAINT.search(m.name) and not NOT_PAINT.search(m.name)]
paint = max(named or [m for m in area if not NOT_PAINT.search(m.name)] or list(area), key=lambda m: area[m], default=None)
if paint:
    print(f'carrosserie : « {paint.name} » → paint')
    paint.name = 'paint'

lo, hi = world_box(meshes())
tris = sum(len(p.vertices) - 2 for o in meshes() for p in o.data.polygons)
print(f'véhicule : {hi.x - lo.x:.2f} × {hi.y - lo.y:.2f} × {hi.z - lo.z:.2f} m, {tris} triangles, roues {sorted(wheel_parts)}')
if out:
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, export_yup=True, export_cameras=False, export_lights=False,
                              export_extras=False, export_animations=False, export_image_format='AUTO')
