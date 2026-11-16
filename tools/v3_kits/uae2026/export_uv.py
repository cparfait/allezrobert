import bpy, sys, json
argv = sys.argv[sys.argv.index('--')+1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=argv[0])
out=[]
for o in bpy.data.objects:
    if o.type!='MESH' or o.name not in ('LOD0_g03','LOD0_g40'): continue
    me=o.data; uv=me.uv_layers.active.data
    mw=o.matrix_world
    me.calc_loop_triangles()
    for t in me.loop_triangles:
        m=me.materials[t.material_index]
        if not m or m.name!='CyclistKIT': continue
        tri=[]
        for li,vi in zip(t.loops,t.vertices):
            p=mw@me.vertices[vi].co; n=(mw.to_3x3()@me.vertices[vi].normal).normalized()
            u=uv[li].uv
            tri.append([u.x,u.y,p.x,p.y,p.z,n.x,n.y,n.z])
        out.append([o.name]+tri)
json.dump(out,open(argv[1],'w'))
print('TRIS',len(out))
