"""
Animaux de ferme animés de Quaternius (Farm Animal Pack, CC0, opengameart.org) → GLB du style jeu vidéo.

  blender -b --disable-autoexec --factory-startup -P tools/blender/convert_quaternius_animals.py -- <dossier FBX> <dossier de sortie>

Pour la vache, le cheval et le mouton : import FBX, faces en aplats (facettes nettes), animations renommées
sans le préfixe « Armature|Armature| » et sans « Death », export GLB avec toutes les animations. La taille
réelle (vache 2,3 m, cheval 2,5 m, mouton 1,3 m de long) est réglée dans le jeu (roadsideLife.ts).
"""
import bpy
import sys

argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]

for name in ['Cow', 'Horse', 'Sheep']:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=f'{src}/{name}.fbx')
    for o in bpy.data.objects:
        if o.type == 'MESH':
            for p in o.data.polygons:
                p.use_smooth = False
    for a in list(bpy.data.actions):
        short = a.name.split('|')[-1]
        if short == 'Death':
            bpy.data.actions.remove(a)
            continue
        a.name = short
        a.use_fake_user = True
    bpy.ops.export_scene.gltf(
        filepath=f'{out}/{name.lower()}.glb',
        export_format='GLB',
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_force_sampling=True,
        export_apply=False,
        export_yup=True,
    )
    print('ok', name, [a.name for a in bpy.data.actions])
