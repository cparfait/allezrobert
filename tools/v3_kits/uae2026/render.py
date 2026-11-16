import bpy, sys, math, mathutils
argv = sys.argv[sys.argv.index('--')+1:]
glb, diffuse, normal, outprefix = argv[:4]
samples = int(argv[4]) if len(argv)>4 else 48
res = int(argv[5]) if len(argv)>5 else 900
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
shown = {1,3,5,13,15,18,20,24,31}
for o in bpy.data.objects:
    if o.type!='MESH': continue
    ok = o.name.startswith('LOD0_g') and int(o.name[6:]) in shown
    o.hide_render = not ok; o.hide_viewport = not ok
mat = bpy.data.materials['CyclistKIT']
nt = mat.node_tree
bsdf = next(n for n in nt.nodes if n.type=='BSDF_PRINCIPLED')
for l in list(bsdf.inputs['Base Color'].links)+list(bsdf.inputs['Normal'].links): nt.links.remove(l)
t = nt.nodes.new('ShaderNodeTexImage'); t.image = bpy.data.images.load(diffuse)
nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
if normal != '-':
    tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = bpy.data.images.load(normal); tn.image.colorspace_settings.name='Non-Color'
    nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = 1.0
    nt.links.new(tn.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
bsdf.inputs['Roughness'].default_value = 0.62
bsdf.inputs['Metallic'].default_value = 0.0
try:
    bsdf.inputs['Sheen Weight'].default_value = 0.15; bsdf.inputs['Sheen Roughness'].default_value = 0.4
except KeyError: pass
sc = bpy.context.scene
sc.render.engine = 'CYCLES'; sc.cycles.samples = samples; sc.cycles.use_denoising = True
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences; prefs.compute_device_type = 'OPTIX'; prefs.get_devices()
    for d in prefs.devices: d.use = True
    sc.cycles.device = 'GPU'
except Exception as e: print('CPU', e)
sc.render.resolution_x = res; sc.render.resolution_y = int(res*1.25)
sc.view_settings.view_transform = 'Standard'; sc.view_settings.exposure = -1.1
world = bpy.data.worlds.new('w'); sc.world = world; world.use_nodes = True
wn = world.node_tree.nodes; bg = wn['Background']
sky = wn.new('ShaderNodeTexSky')
try: sky.sky_type = 'NISHITA'
except Exception: pass
try: sky.sun_elevation = math.radians(35); sky.sun_rotation = math.radians(30)
except Exception: pass
world.node_tree.links.new(sky.outputs['Color'], bg.inputs['Color']); bg.inputs['Strength'].default_value = 0.25
sun = bpy.data.lights.new('sun','SUN'); sun.energy = 3.2; sun.angle = math.radians(2)
so = bpy.data.objects.new('sun', sun); sc.collection.objects.link(so); so.rotation_euler = (math.radians(50), 0, math.radians(120))
fill = bpy.data.lights.new('fill','AREA'); fill.energy = 120; fill.size = 2
fo = bpy.data.objects.new('fill', fill); sc.collection.objects.link(fo); fo.location = (-2, -2.5, 1.6)
fo.rotation_euler = mathutils.Vector((0.0,0.0,1.1)).to_track_quat('-Z','Y').to_euler()
# ground
bpy.ops.mesh.primitive_plane_add(size=20, location=(0,0,0)); g = bpy.context.active_object
gm = bpy.data.materials.new('g'); gm.use_nodes=True; gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(0.35,0.35,0.36,1); g.data.materials.append(gm)
cam = bpy.data.cameras.new('c'); cam.lens = 85
co = bpy.data.objects.new('c', cam); sc.collection.objects.link(co); sc.camera = co
target = mathutils.Vector((-0.05, 0, 1.12))
views = {'zoom': 25, 'face': 0, 'trois-quarts': 40, 'profil': 90, 'dos': 180, 'dos-34': 220}
only = argv[6].split(',') if len(argv)>6 else list(views)
for name in only:
    a = math.radians(views[name]); d = 3.2
    tg = target
    if name == 'zoom': d = 0.95; tg = mathutils.Vector((0.0, 0.05, 1.3))
    co.location = tg + mathutils.Vector((math.cos(a)*d, math.sin(a)*d, 0.12 if name=='zoom' else 0.25))
    co.rotation_euler = (tg - co.location).to_track_quat('-Z','Y').to_euler()
    sc.render.filepath = f'{outprefix}-{name}.png'
    bpy.ops.render.render(write_still=True)
