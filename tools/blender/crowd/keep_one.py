"""
Garde un seul personnage d'un modèle Tripo qui en contient plusieurs (l'image de départ montrait parfois deux
vues côte à côte) : les morceaux sont séparés par composantes connexes, regroupés par position sur l'axe horizontal le plus long, et
seul le groupe choisi (le plus à gauche par défaut) est gardé, textures comprises.

blender -b --factory-startup -P tools/blender/crowd/keep_one.py -- <entrée.glb> <sortie.glb> [--right]
Puis : gen_tripo_spectator.py <nom> --rig-file <sortie.glb> (squelette et animations seulement, 45 crédits).
"""
import sys

import bmesh
import bpy

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]
right = '--right' in argv
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
for o in [o for o in bpy.data.objects if o.type == 'MESH']:
    mw = o.matrix_world
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.verts.ensure_lookup_table()
    pts = [mw @ v.co for v in bm.verts]
    # Axe horizontal le plus long : celui sur lequel les personnages sont alignés.
    ax = 0 if (max(p.x for p in pts) - min(p.x for p in pts)) >= (max(p.y for p in pts) - min(p.y for p in pts)) else 1
    xs = [p[ax] for p in pts]
    mid = (min(xs) + max(xs)) / 2
    # Composantes connexes : chacune part entière d'un côté ou de l'autre selon son centre.
    seen, drop = set(), []
    for v in bm.verts:
        if v in seen:
            continue
        comp, stack = [], [v]
        seen.add(v)
        while stack:
            a = stack.pop()
            comp.append(a)
            for e in a.link_edges:
                b = e.other_vert(a)
                if b not in seen:
                    seen.add(b)
                    stack.append(b)
        cx = sum((mw @ a.co)[ax] for a in comp) / len(comp)
        if (cx < mid) == right:
            drop.extend(comp)
    bmesh.ops.delete(bm, geom=drop, context='VERTS')
    bm.to_mesh(o.data)
    bm.free()
    print('GARDÉ', o.name, len(o.data.vertices), 'sommets')
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_yup=True, export_materials='EXPORT', export_animations=False)
print('OK', dst)
