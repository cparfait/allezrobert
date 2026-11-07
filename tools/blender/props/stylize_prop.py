"""
Décor .glb texturé ou à couleurs par sommet (Sketchfab, BlenderKit, TRELLIS…) → deux .glb prêts pour optimize.mjs --dir props :

- <nom>.real.glb : modèle d'origine (textures PBR ou couleurs par sommet gardées) en un seul objet, taille réelle,
  centré, posé à z = 0, simplifié à --real-faces triangles au plus ;
- <nom>.lowpoly.glb : style jeu vidéo du mode LOW_POLY : maillage simplifié (--faces), facettes nettes, une couleur
  par face lue dans la texture puis ramenée à une petite palette (--palette, k-moyennes), sans texture ni UV.

Usage :
  blender -b --factory-startup -P tools/blender/props/stylize_prop.py -- <source.glb> <dossier de sortie> <nom>
         [--height M | --length M] [--yaw DEGRÉS] [--faces 1500] [--palette 12] [--real-faces 30000]

--height : hauteur voulue ; --length : plus grande dimension au sol ; sans les deux, l'échelle de la source est
gardée. --yaw tourne le modèle autour de la verticale.
"""
import math
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:]
VALUED = ('--height', '--length', '--yaw', '--faces', '--palette', '--real-faces')
src, out_dir, name = [a for i, a in enumerate(argv) if not a.startswith('--') and (i == 0 or argv[i - 1] not in VALUED)][:3]


def opt(k, d=None):
    return float(argv[argv.index(k) + 1]) if k in argv else d


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
scene = bpy.context.scene


def meshes():
    return [o for o in scene.objects if o.type == 'MESH']


# Un seul objet, transformations appliquées (certaines sources ont un nœud parent qui porte l'échelle).
for o in meshes():
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = mw
for o in list(scene.objects):
    if o.type != 'MESH':
        bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
for o in meshes():
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes()[0]
bpy.ops.object.make_single_user(object=True, obdata=True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
if len(meshes()) > 1:
    bpy.ops.object.join()
prop = bpy.context.view_layer.objects.active
prop.name = prop.data.name = name
me = prop.data


def box():
    co = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    return co.min(0), co.max(0)


# Orientation, centrage, sol, échelle.
me.transform(Matrix.Rotation(math.radians(opt('--yaw', 0.0)), 4, 'Z'))
lo, hi = box()
me.transform(Matrix.Translation(Vector((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]))))
lo, hi = box()
k = 1.0
if opt('--height'):
    k = opt('--height') / (hi[2] - lo[2])
elif opt('--length'):
    k = opt('--length') / max(hi[0] - lo[0], hi[1] - lo[1])
me.transform(Matrix.Scale(k, 4))
me.update()


def tris():
    return sum(len(p.vertices) - 2 for p in me.polygons)


def export(path, vertex_colors=False):
    bpy.ops.object.select_all(action='DESELECT')
    prop.select_set(True)
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
              export_cameras=False, export_lights=False, export_animations=False, export_extras=False)
    if vertex_colors:
        # Couleurs par sommet sans matériau qui les lise : le mode par défaut (« MATERIAL ») les perdrait.
        kw['export_vertex_color'] = 'ACTIVE'
    bpy.ops.export_scene.gltf(**kw)


def decimate(target):
    if tris() <= target:
        return
    dec = prop.modifiers.new('decimate', 'DECIMATE')
    dec.decimate_type = 'COLLAPSE'
    dec.ratio = target / tris()
    dec.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = prop
    bpy.ops.object.modifier_apply(modifier=dec.name)


lo, hi = box()
size = hi - lo
src_tris = tris()
vertex_colored = bool(me.color_attributes) and not me.uv_layers
if vertex_colored:
    # Générateurs (TRELLIS…) : maillage dense sans normales, importé en facettes ; lissé, ses sommets restent
    # partagés et optimize.mjs peut encore le simplifier pour le modèle lointain.
    for p in me.polygons:
        p.use_smooth = True
# Version réaliste : --real-faces triangles au plus (0 : intacte) ; la simplification garde UV et couleurs.
decimate(int(opt('--real-faces', 30000)) or src_tris)
export(f'{out_dir}/{name}.real.glb', vertex_colors=vertex_colored)
print(f'réaliste : {size[0]:.2f} × {size[1]:.2f} × {size[2]:.2f} m, {src_tris} → {tris()} triangles')

# ---------- Variante low poly ----------


def base_color_source(mat):
    """(pixels h×w×4 en sRGB, None) si la couleur de base vient d'une image, sinon (None, couleur RGBA linéaire)."""
    if not mat or not mat.node_tree:
        return None, np.array(mat.diffuse_color if mat else (0.8, 0.8, 0.8, 1.0))
    bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not bsdf:
        return None, np.array((0.8, 0.8, 0.8, 1.0))
    sock = bsdf.inputs['Base Color']
    # Remonte les liens (l'import glTF peut intercaler un nœud de mélange avec la couleur des sommets).
    stack, seen = [sock], set()
    while stack:
        s = stack.pop()
        for link in s.links:
            n = link.from_node
            if n.name in seen:
                continue
            seen.add(n.name)
            if n.type == 'TEX_IMAGE' and n.image:
                img = n.image
                w, h = img.size
                px = np.empty(w * h * 4, np.float32)
                img.pixels.foreach_get(px)
                px = px.reshape(h, w, 4)
                if img.is_float or img.colorspace_settings.name != 'sRGB':
                    px[..., :3] = linear_to_srgb(px[..., :3])
                return px, None
            stack.extend(i for i in n.inputs if i.is_linked)
    return None, np.array(sock.default_value)


def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


sources = [base_color_source(m) for m in me.materials] or [(None, np.array((0.8, 0.8, 0.8, 1.0)))]
# Couleurs par sommet de la source (TRELLIS, Hunyuan… sans texture) : simplifiées avec le maillage, puis lues par face.
src_vc = me.color_attributes.active_color.name if me.color_attributes.active_color else None

decimate(int(opt('--faces', 1500)))
tri = prop.modifiers.new('tri', 'TRIANGULATE')
bpy.ops.object.modifier_apply(modifier=tri.name)

# Couleur de chaque face : moyenne (en linéaire) de 4 échantillons de la texture, le centre et trois points
# à mi-chemin des coins ; évite de lire une couture d'UV ou le bord d'un îlot.
n = len(me.polygons)
face_lin = np.zeros((n, 3), np.float32)
uv_layer = me.uv_layers.active
mat_idx = np.empty(n, np.int32)
me.polygons.foreach_get('material_index', mat_idx)
if uv_layer:
    uv = np.empty(len(me.loops) * 2, np.float32)
    uv_layer.data.foreach_get('uv', uv)
    uv = uv.reshape(-1, 3, 2)  # triangles : 3 coins par face, dans l'ordre des faces
    c = uv.mean(1, keepdims=True)
    samples = np.concatenate([c, (2 * c + uv) / 3], axis=1)  # n × 4 × 2
vc_face = None
if src_vc and me.color_attributes.get(src_vc):
    a = me.color_attributes[src_vc]
    vals = np.empty(len(a.data) * 4, np.float32)
    a.data.foreach_get('color', vals)  # linéaire
    vals = vals.reshape(-1, 4)[:, :3]
    if a.domain == 'POINT':
        vi = np.empty(len(me.loops), np.int32)
        me.loops.foreach_get('vertex_index', vi)
        vals = vals[vi]
    vc_face = vals.reshape(-1, 3, 3).mean(1)
for mi, (px, flat) in enumerate(sources):
    sel = mat_idx == mi
    if not sel.any():
        continue
    if px is not None and uv_layer:
        h, w = px.shape[:2]
        s = samples[sel] % 1.0
        x = np.clip((s[..., 0] * w).astype(int), 0, w - 1)
        y = np.clip((s[..., 1] * h).astype(int), 0, h - 1)
        face_lin[sel] = srgb_to_linear(px[y, x, :3]).mean(1)
    elif vc_face is not None:
        face_lin[sel] = vc_face[sel]
    else:
        face_lin[sel] = flat[:3]

# Palette : k-moyennes en sRGB (plus proche de la perception), pondérées par l'aire des faces.
k_pal = int(opt('--palette', 12))
area = np.empty(n, np.float32)
me.polygons.foreach_get('area', area)
pts = linear_to_srgb(face_lin)
if k_pal > 0 and n > k_pal:
    rng = np.random.default_rng(1)
    centers = pts[rng.choice(n, k_pal, replace=False, p=area / area.sum())]
    for _ in range(30):
        lab = ((pts[:, None, :] - centers[None]) ** 2).sum(-1).argmin(1)
        for j in range(k_pal):
            m = lab == j
            if m.any():
                centers[j] = (pts[m] * area[m, None]).sum(0) / area[m].sum()
    pts = centers[lab]
face_lin = srgb_to_linear(pts)

while me.color_attributes:
    me.color_attributes.remove(me.color_attributes[0])
attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
cols = np.ones((n, 3, 4), np.float32)
cols[..., :3] = face_lin[:, None, :]
attr.data.foreach_set('color', cols.ravel())
me.color_attributes.active_color = attr

for p in me.polygons:
    p.use_smooth = False
while me.uv_layers:
    me.uv_layers.remove(me.uv_layers[0])
mat = bpy.data.materials.new('lowpoly')
if mat.node_tree is None:  # Blender < 5 : nœuds à activer
    mat.use_nodes = True
nodes = mat.node_tree.nodes
bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
bsdf.inputs['Roughness'].default_value = 0.9
bsdf.inputs['Metallic'].default_value = 0.0
vc = nodes.new('ShaderNodeVertexColor')
vc.layer_name = 'Col'
mat.node_tree.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
me.materials.clear()
me.materials.append(mat)

export(f'{out_dir}/{name}.lowpoly.glb')
print(f'low poly : {tris()} triangles, palette {len(np.unique(pts, axis=0))} couleurs')
