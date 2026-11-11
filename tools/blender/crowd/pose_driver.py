"""
Occupant d'un véhicule du trafic (style réaliste) : un personnage du public (Tripo, à squelette) est assis, les
mains au volant, puis figé en maillage simplifié → apps/client/public/models/drivers/<sortie>.glb, lu par
apps/client/src/world/vehicleDriver.ts.

Repère du fichier (celui du personnage à facettes de vehicleDriver.ts) : origine sur l'assise du siège,
regard vers +Z, gauche en +X, Y en haut.
- conducteur (défaut) : buste incliné vers le dossier, sommet du crâne à 0,82 m de l'origine (0,08 m en
  arrière), coupé sous les cuisses (le reste est caché par la caisse) ;
- --farmer : assis droit sur un tracteur sans cabine, hanches à 0,10 m de l'origine, jambes entières, chapeau
  de paille.
Mains sur un volant centré à (0, 0,36, 0,44).

Usage :
  blender -b --factory-startup -P tools/blender/crowd/pose_driver.py -- --character <nom> [--out <sortie>]
          [--farmer] [--tris 1400] [--tex 512] [--recline 25]
(characters.json : source zzModel3D/tripo_public/<nom>/animations_model_url.glb et taille.)
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:]
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))


def opt(k, d):
    return type(d)(argv[argv.index(k) + 1]) if k in argv else d


NAME = opt('--character', 'spectateur')
OUT = opt('--out', NAME)
FARMER = '--farmer' in argv
TRIS, TEX = opt('--tris', 1800 if FARMER else 1400), opt('--tex', 512)
RECLINE = math.radians(opt('--recline', 6.0 if FARMER else 25.0))
spec = json.load(open(os.path.join(HERE, 'characters.json'), encoding='utf-8'))['characters'][NAME]
src = os.path.join(ROOT, spec.get('source') or f'zzModel3D/tripo_public/{NAME}/animations_model_url.glb')
out_dir = os.path.join(ROOT, 'apps/client/public/models/drivers')
os.makedirs(out_dir, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
for o in list(bpy.data.objects):
    if o.type == 'MESH' and not o.vertex_groups:
        bpy.data.objects.remove(o, do_unlink=True)
body = next(o for o in bpy.data.objects if o.type == 'MESH')
rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')

# Simplification avant la pose (les poids des os suivent).
tris0 = sum(len(p.vertices) - 2 for p in body.data.polygons)
dec = body.modifiers.new('dec', 'DECIMATE')
dec.ratio = min(1.0, TRIS / tris0)
bpy.context.view_layer.objects.active = body
bpy.ops.object.modifier_move_to_index(modifier='dec', index=0)
bpy.ops.object.modifier_apply(modifier='dec')


def coords():
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    m = ev.to_mesh()
    co = [body.matrix_world @ v.co for v in m.vertices]
    ev.to_mesh_clear()
    return co


# Repos, mis à la taille (Tripo : face à +X, Z en haut).
if rig.animation_data:
    rig.animation_data.action = None
for pb in rig.pose.bones:
    pb.matrix_basis.identity()
bpy.context.view_layer.update()
co = coords()
k = spec['height'] / (max(c.z for c in co) - min(c.z for c in co))
rig.scale = rig.scale * k
bpy.context.view_layer.update()


def world(name):
    return rig.matrix_world @ rig.pose.bones[name].matrix


def rotate(name, rot):
    """Tourne l'os (et sa descendance) autour de sa tête, rotation donnée dans le repère du monde."""
    pb = rig.pose.bones[name]
    m = world(name)
    head = m.translation.copy()
    pb.matrix = rig.matrix_world.inverted() @ (Matrix.Translation(head) @ rot.to_4x4() @ Matrix.Translation(-head) @ m)
    bpy.context.view_layer.update()


def aim(name, direction):
    cur = (world(name).to_3x3() @ Vector((0, 1, 0))).normalized()
    rotate(name, cur.rotation_difference(Vector(direction).normalized()).to_matrix())


# Buste incliné vers l'arrière (face à +X : rotation autour de Y).
rotate('Hip', Matrix.Rotation(-RECLINE, 3, 'Y'))
for s, side in ((1, 'L'), (-1, 'R')):
    aim(f'{side}_Thigh', (0.95, s * 0.12, -0.15 if FARMER else 0.05))
    aim(f'{side}_Calf', (0.35, 0, -0.94) if FARMER else (0.6, 0, -0.8))
    aim(f'{side}_Foot', (1, s * 0.1, 0.0))

# Origine (assise du siège) : sous les hanches du paysan ; pour le conducteur, d'après le sommet du crâne.
co = coords()
hip = world('Hip').translation
top = max(c.z for c in co)
if FARMER:
    origin = Vector((hip.x, hip.y, hip.z - 0.10))
else:
    crown = [c for c in co if c.z > top - 0.1]
    origin = Vector((sum(c.x for c in crown) / len(crown) + 0.08, hip.y, top - 0.82))

# Bras : mains sur le volant (cinématique inverse à deux os, coude vers le bas et l'extérieur).
for s, side in ((1, 'L'), (-1, 'R')):
    shoulder = world(f'{side}_Upperarm').translation
    l1 = (world(f'{side}_Forearm').translation - shoulder).length
    l2 = (world(f'{side}_Hand').translation - world(f'{side}_Forearm').translation).length
    wrist = origin + Vector((0.44 - 0.07, s * 0.19, 0.36))
    to = wrist - shoulder
    d = min(to.length, (l1 + l2) * 0.98)
    to.normalize()
    a = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
    h = math.sqrt(max(l1 * l1 - a * a, 0.0))
    pole = Vector((-0.1, s * 0.5, -1.0))
    pole = (pole - to * pole.dot(to)).normalized()
    elbow = shoulder + to * a + pole * h
    aim(f'{side}_Upperarm', elbow - shoulder)
    aim(f'{side}_Forearm', shoulder + to * d - elbow)
    aim(f'{side}_Hand', (1, -s * 0.25, 0.25))

# Pose figée : maillage seul, origine sur l'assise, regard vers −Y de Blender (+Z du jeu), gauche en +X.
bpy.context.view_layer.objects.active = body
body.select_set(True)
for m in list(body.modifiers):
    bpy.ops.object.modifier_apply(modifier=m.name)
mw = body.matrix_world.copy()
body.parent = None
body.matrix_world = Matrix.Rotation(-math.pi / 2, 4, 'Z') @ Matrix.Translation(-origin) @ mw
bpy.data.objects.remove(rig, do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
body.vertex_groups.clear()

if not FARMER:
    # Sous les cuisses, la caisse cache tout : coupé (sinon les jambes dépassent sous les voitures basses).
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, -0.16), plane_no=(0, 0, 1), clear_inner=True)
    bm.to_mesh(body.data)
    bm.free()

# Matériau : couleur de base seule, réduite.
img = next(i for i in bpy.data.images if i.name.startswith('Color'))
img.scale(TEX, TEX)
mat = bpy.data.materials.new('driver')
mat.use_nodes = True
nodes, links = mat.node_tree.nodes, mat.node_tree.links
bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
tex = nodes.new('ShaderNodeTexImage')
tex.image = img
links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value = 0.85
bsdf.inputs['Metallic'].default_value = 0.0
body.data.materials.clear()
body.data.materials.append(mat)
body.name = 'driver'

if FARMER:
    # Chapeau de paille : bord et calotte, posés sur le crâne.
    zs = [v.co.z for v in body.data.vertices]
    top = max(zs)
    crown = [v.co for v in body.data.vertices if v.co.z > top - 0.08]
    cx = sum(c.x for c in crown) / len(crown)
    cy = sum(c.y for c in crown) / len(crown)
    straw = bpy.data.materials.new('straw')
    straw.use_nodes = True
    sb = next(n for n in straw.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    sb.inputs['Base Color'].default_value = (0.72, 0.55, 0.2, 1)
    sb.inputs['Roughness'].default_value = 0.9
    parts = []
    for radius, depth, z in ((0.21, 0.012, top - 0.045), (0.1, 0.1, top + 0.0)):
        bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=radius, depth=depth, location=(cx, cy, z))
        part = bpy.context.active_object
        part.data.materials.append(straw)
        parts.append(part)
    bpy.ops.object.select_all(action='DESELECT')
    for part in parts:
        part.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()

bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
path = os.path.join(out_dir, f'{OUT}.glb')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_image_format='JPEG', export_jpeg_quality=82,
                          export_animations=False, export_skins=False, export_yup=True, export_apply=True)
zs = [v.co.z for v in body.data.vertices]
print(f'DRIVER {OUT} : {sum(len(p.vertices) - 2 for p in body.data.polygons)} triangles, hauteur {min(zs):.2f} à {max(zs):.2f} m, {os.path.getsize(path) // 1024} ko')
