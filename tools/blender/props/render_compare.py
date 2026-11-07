"""
Planche de comparaison : plusieurs .glb posés côte à côte au sol, soleil de fin d'après-midi, rendu EEVEE.
Sert à juger un décor généré à côté d'un modèle du jeu (ex. la vache) avant de l'intégrer.

  blender -b --factory-startup -P tools/blender/props/render_compare.py -- <sortie.png> <a.glb> [b.glb@2.3 …]
         [--flat]  (facettes nettes partout, comme le mode LOW_POLY)

Les modèles gardent leur échelle (mètres) : la taille relative est donc lisible sur l'image. « fichier@L » remet
à L mètres de long un modèle dont la taille réelle est réglée dans le jeu (vache de farmAnimals.ts : 2,3 m).
"""
import math
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
files = [a for a in argv if not a.startswith('--')]
out, models = files[0], files[1:]

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
x = 0.0
GAP = 0.15
tops = []
for arg in models:
    path, _, length = arg.rpartition('@') if '@' in arg else (arg, '', '')
    before = set(scene.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in scene.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    if length:
        k = float(length) / max(hi.x - lo.x, hi.y - lo.y)
        for o in new:
            if o.parent is None:
                o.scale *= k
                o.location *= k
        lo, hi = lo * k, hi * k
    shift = Vector((x - lo.x, -(lo.y + hi.y) / 2, -lo.z))
    for o in new:
        if o.parent is None:
            o.location += shift
    if '--flat' in argv:
        for o in meshes:
            for p in o.data.polygons:
                p.use_smooth = False
    tops.append(hi.z - lo.z)
    x += (hi.x - lo.x) + max(GAP, 0.3 * (hi.x - lo.x))

# Sol, ciel, soleil.
bpy.ops.mesh.primitive_plane_add(size=200, location=(x / 2, 0, 0))
ground = bpy.context.object
gm = bpy.data.materials.new('sol')
gm.diffuse_color = (0.28, 0.36, 0.18, 1)
if gm.node_tree is None:
    gm.use_nodes = True
next(n for n in gm.node_tree.nodes if n.type == 'BSDF_PRINCIPLED').inputs['Base Color'].default_value = (0.20, 0.30, 0.11, 1)
ground.data.materials.append(gm)
world = bpy.data.worlds.new('ciel')
scene.world = world
if world.node_tree is None:
    world.use_nodes = True
bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
bg.inputs['Color'].default_value = (0.55, 0.70, 0.95, 1)
bg.inputs['Strength'].default_value = 0.8
sun = bpy.data.objects.new('soleil', bpy.data.lights.new('soleil', 'SUN'))
sun.data.energy = 3.5
sun.data.angle = math.radians(2)
sun.rotation_euler = (math.radians(50), 0, math.radians(35))
scene.collection.objects.link(sun)

# Caméra de trois quarts, cadrée sur la rangée.
width, height = x - GAP, max(tops)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
cam.data.lens = 50
scene.collection.objects.link(cam)
target = Vector((width / 2, 0, height * 0.45))
dist = max(width, height * 1.6) * 1.6
cam.location = target + Vector((0, -dist, dist * 0.35))
cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam

for engine in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
    try:
        scene.render.engine = engine
        break
    except TypeError:
        continue
scene.render.resolution_x, scene.render.resolution_y = 1600, 900
scene.view_settings.view_transform = 'AgX'
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print('rendu', out)
