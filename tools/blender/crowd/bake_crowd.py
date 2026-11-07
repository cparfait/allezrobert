"""
Spectateur du public (style réaliste) : personnage texturé à squelette et animations (Tripo…) → fichiers du jeu
(apps/client/public/models/crowd/) lus par apps/client/src/world/crowdRealistic.ts :

- <nom>.json : en-tête (nombre de sommets et d'indices, clips, image tenue par les porteurs de pancarte,
  luminances de référence des zones, taille du masque) ;
- <nom>.bin : positions et normales au repos (float32), UV (float32), indices (uint32), animation cuite en
  texture (float16, une ligne par image : positions puis normales de chaque sommet, repère du jeu Y en haut)
  et masque de zones (uint8 RGBA : peau, cheveux, haut, bas ; brut, sans le PNG dont le navigateur peut
  prémultiplier l'alpha) ;
- <nom>.webp : couleur de base.

Le jeu instancie un seul maillage pour tout le public : chaque spectateur lit sa pose dans la texture
d'animation (clip et phase tirés au hasard) et recolore peau, cheveux, haut et bas d'après le masque
(couleur = teinte × luminance du texel / luminance de référence de la zone : plis et usure gardés).

Masque : chaque texel prend la zone de l'os qui porte sa face (tête, mains, buste, jambes, pieds), puis sa
couleur tranche (peau chaude et saturée, cheveux gris, chemise claire, pantalon sombre). Seuils réglés sur
le spectateur de référence ; vérifier <nom>_zones.png pour un nouveau modèle.

Usage :
  blender -b --factory-startup -P tools/blender/crowd/bake_crowd.py -- <animé.glb> <dossier> <nom>
          [--tris 1500] [--step 4] [--tex 1024] [--mask 256] [--height 1.70] [--yaw 90]
--yaw : rotation (degrés, autour de la verticale) qui tourne le modèle vers +Y de Blender, soit −Z du jeu,
l'avant des spectateurs de crowd.ts ; Tripo exporte face à +X : 90.
"""
import colorsys
import json
import math
import os
import struct
import sys

import bpy
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
VALUED = ('--tris', '--step', '--tex', '--mask', '--height', '--yaw')
src, out_dir, name = [a for i, a in enumerate(argv) if not a.startswith('--') and (i == 0 or argv[i - 1] not in VALUED)][:3]


def opt(k, d):
    return type(d)(argv[argv.index(k) + 1]) if k in argv else d


TRIS, STEP, TEX, MASK = opt('--tris', 1500), opt('--step', 4), opt('--tex', 1024), opt('--mask', 256)
HEIGHT, YAW = opt('--height', 1.70), opt('--yaw', 90.0)
out_dir = os.path.abspath(out_dir)
os.makedirs(out_dir, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
scene = bpy.context.scene
for o in list(bpy.data.objects):
    if o.type == 'MESH' and not o.vertex_groups:
        bpy.data.objects.remove(o, do_unlink=True)
body = next(o for o in bpy.data.objects if o.type == 'MESH')
rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
actions = sorted(bpy.data.actions, key=lambda a: a.name)

# Simplification (avant l'armature : les poids des os suivent).
tris0 = sum(len(p.vertices) - 2 for p in body.data.polygons)
dec = body.modifiers.new('dec', 'DECIMATE')
dec.ratio = min(1.0, TRIS / tris0)
bpy.context.view_layer.objects.active = body
bpy.ops.object.modifier_move_to_index(modifier='dec', index=0)
bpy.ops.object.modifier_apply(modifier='dec')
me = body.data


def set_action(a):
    rig.animation_data.action = a
    ad = rig.animation_data
    if hasattr(ad, 'action_slot') and getattr(a, 'slots', None):
        ad.action_slot = a.slots[0]


def evaluated():
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    m = ev.to_mesh()
    mw = body.matrix_world
    co = np.array([mw @ v.co for v in m.vertices], np.float32)
    nm = np.array([(mw.to_3x3() @ v.normal).normalized() for v in m.vertices], np.float32)
    ev.to_mesh_clear()
    return co, nm


# Repos : taille, pieds au sol, face à +Y (Blender) = −Z (jeu, avant des spectateurs).
set_action(actions[0])
for pb in rig.pose.bones:
    pb.matrix_basis.identity()
rig.animation_data.action = None
scene.frame_set(0)
co, _ = evaluated()
k = HEIGHT / float(co[:, 2].max() - co[:, 2].min())
rig.scale = rig.scale * k
rig.rotation_mode = 'XYZ'
rig.rotation_euler.z += math.radians(YAW)
bpy.context.view_layer.update()
co, nm = evaluated()
rig.location.z -= float(co[:, 2].min())
rig.location.x -= float(co[:, 0].mean())
rig.location.y -= float(co[:, 1].mean())
bpy.context.view_layer.update()
rest_co, rest_nm = evaluated()


def to_game(a):
    """Blender (Z en haut) → jeu (Y en haut) : (x, z, -y)."""
    return np.stack([a[:, 0], a[:, 2], -a[:, 1]], 1)


# Sommets du jeu : un par couple (sommet Blender, UV) ; chaque sommet du jeu garde l'indice du sommet Blender.
uvl = me.uv_layers.active.data
me.calc_loop_triangles()
key_to_idx, src_vert, uvs, indices = {}, [], [], []
for tri in me.loop_triangles:
    for vi, li in zip(tri.vertices, tri.loops):
        u, v = uvl[li].uv
        key = (vi, round(u, 5), round(v, 5))
        idx = key_to_idx.get(key)
        if idx is None:
            idx = key_to_idx[key] = len(src_vert)
            src_vert.append(vi)
            uvs.append((u, v))
        indices.append(idx)
src_vert = np.array(src_vert)
V, I = len(src_vert), len(indices)

# Animation cuite : toutes les STEP images de chaque clip.
clips, pos_rows, nrm_rows = [], [], []
for a in actions:
    set_action(a)
    f0, f1 = (int(round(x)) for x in a.frame_range)
    frames = list(range(f0, f1, STEP))
    clips.append({'name': a.name, 'row': len(pos_rows), 'frames': len(frames), 'fps': scene.render.fps / STEP})
    for f in frames:
        scene.frame_set(f)
        c, n = evaluated()
        pos_rows.append(to_game(c)[src_vert])
        nrm_rows.append(to_game(n)[src_vert])
R = len(pos_rows)

# Image tenue par les porteurs de pancarte : mains les plus hautes près de 1,6 m, devant le buste.
hand_groups = [g.index for g in body.vertex_groups if any(s in g.name.lower() for s in ('hand', 'finger'))]
hand_v = np.array([v.index for v in me.vertices if any(g.group in hand_groups and g.weight > 0.5 for g in v.groups)])
hand_rows = np.isin(src_vert, hand_v)
best, hold = 1e9, 0
for r, p in enumerate(pos_rows):
    if not hand_rows.any():
        break
    h = p[hand_rows]
    score = abs(float(h[:, 1].mean()) - 1.6) + abs(float(h[:, 0].mean())) * 0.5
    if score < best:
        best, hold = score, r

# ---------- Texture de base et masque de zones ----------
mat = me.materials[0]
bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
stack, img = [bsdf.inputs['Base Color']], None
while stack and img is None:
    for l in stack.pop().links:
        if l.from_node.type == 'TEX_IMAGE':
            img = l.from_node.image
            break
        stack.extend(i for i in l.from_node.inputs if i.is_linked)
if img.size[0] != MASK:
    work = img.copy()
    work.scale(MASK, MASK)
else:
    work = img
W = H = MASK
px = np.array(work.pixels[:], np.float32).reshape(H, W, 4)[..., :3]  # sRGB, ligne 0 = bas (v = 0)


def zone_of(bone):
    b = bone.lower()
    if 'head' in b or 'neck' in b:
        return 0
    if any(s in b for s in ('hand', 'finger', 'thumb', 'index', 'middle', 'ring', 'pinky', 'forearm')):
        return 1
    if any(s in b for s in ('foot', 'toe')):
        return 4
    if any(s in b for s in ('thigh', 'calf', 'hip', 'pelvis')):
        return 3
    return 2  # buste


names = {g.index: g.name for g in body.vertex_groups}
vzone = np.full(len(me.vertices), 2, np.int32)
for v in me.vertices:
    score = {}
    for g in v.groups:
        z = zone_of(names[g.group])
        score[z] = score.get(z, 0) + g.weight
    if score:
        vzone[v.index] = max(score, key=score.get)
zmap = np.full((H, W), -1, np.int32)
for tri in me.loop_triangles:
    uv = np.array([uvl[li].uv[:] for li in tri.loops]) * [W, H]
    z = np.bincount(vzone[list(tri.vertices)], minlength=5).argmax()
    x0, y0 = np.maximum(np.floor(uv.min(0)).astype(int), 0)
    x1, y1 = np.minimum(np.ceil(uv.max(0)).astype(int), [W - 1, H - 1])
    if x1 < x0 or y1 < y0:
        continue
    gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
    (ax, ay), (bx, by), (cx, cy) = uv
    d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if abs(d) < 1e-9:
        continue
    l1 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / d
    l2 = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / d
    inside = (l1 >= -0.02) & (l2 >= -0.02) & (1 - l1 - l2 >= -0.02)
    zmap[y0:y1 + 1, x0:x1 + 1][inside] = z
hsv = np.array([colorsys.rgb_to_hsv(*c) for c in px.reshape(-1, 3)]).reshape(H, W, 3)
h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
warm = ((h < 0.09) | (h > 0.97)) & (s > 0.35) & (s < 0.8) & (v > 0.4)   # chair (chemise beige : s ≈ 0,28)
grey = (((h > 0.45) & (h < 0.8)) | (s < 0.26)) & (v > 0.36)            # cheveux et moustache gris (casquette sombre)
beige = (s < 0.36) & (v > 0.5)                                         # tissu clair du haut, aussi rentré dans le bas
dark = v <= 0.42                                                       # ceinture, haut du pantalon
tete, mains, buste, jambes = (zmap == i for i in range(4))
mask = np.zeros((H, W, 4), np.float32)
mask[..., 0] = (tete | mains | buste) & warm
mask[..., 1] = tete & grey & ~warm
mask[..., 2] = ((buste | mains) & ~warm & ~dark) | (jambes & beige)
mask[..., 3] = (jambes & ~beige) | (buste & ~warm & dark)
used = mask.sum(-1) > 0
for _ in range(6):  # débord dans la marge des îlots UV (coutures invisibles au filtrage)
    grown = mask.copy()
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        grown = np.maximum(grown, np.roll(np.roll(mask, dy, 0), dx, 1))
    mask[~used] = grown[~used]
    used = mask.sum(-1) > 0
kern = np.ones(3) / 3
for c in range(4):
    m = np.apply_along_axis(lambda r: np.convolve(r, kern, 'same'), 1, mask[..., c])
    mask[..., c] = np.apply_along_axis(lambda r: np.convolve(r, kern, 'same'), 0, m)
lin = np.where(px <= 0.04045, px / 12.92, ((px + 0.055) / 1.055) ** 2.4)
lum = lin @ np.array([0.2126, 0.7152, 0.0722], np.float32)
ref = {k: float((lum * mask[..., i]).sum() / max(mask[..., i].sum(), 1)) for i, k in enumerate(('skin', 'hair', 'top', 'bottom'))}

# Couleur de base (PNG puis WebP par tools/blender/crowd/finish.mjs ou à la main).
base = img.copy()
if base.size[0] != TEX:
    base.scale(TEX, TEX)
base.filepath_raw = f'{out_dir}/{name}_base.png'
base.file_format = 'PNG'
base.save()
viz = px * 0.25 + 0.75 * (mask[..., 0:1] * [1.0, 0.55, 0.35] + mask[..., 1:2] * [0.95, 0.9, 0.2] + mask[..., 2:3] * [0.2, 0.5, 1.0] + mask[..., 3:4] * [0.3, 0.8, 0.3])
zimg = bpy.data.images.new('zones', W, H, alpha=True)
za = np.ones((H, W, 4), np.float32)
za[..., :3] = np.clip(viz, 0, 1)
zimg.pixels = za.ravel()
zimg.filepath_raw = f'{out_dir}/{name}_zones.png'
zimg.file_format = 'PNG'
zimg.save()

# ---------- Écriture ----------
rp, rn = to_game(rest_co)[src_vert], to_game(rest_nm)[src_vert]
vat = np.zeros((2 * R, V, 4), np.float16)
vat[:R, :, :3] = np.array(pos_rows)
vat[R:, :, :3] = np.array(nrm_rows)
mask8 = (np.clip(mask, 0, 1) * 255 + 0.5).astype(np.uint8)
parts = [rp.astype('<f4'), rn.astype('<f4'), np.array(uvs, '<f4'), np.array(indices, '<u4'), vat.astype('<f2'), mask8]
offsets, pos = {}, 0
for key, arr in zip(('position', 'normal', 'uv', 'index', 'vat', 'mask'), parts):
    offsets[key] = pos
    pos += arr.nbytes
with open(f'{out_dir}/{name}.bin', 'wb') as f:
    for arr in parts:
        f.write(arr.tobytes())
meta = {'vertexCount': V, 'indexCount': I, 'tris': I // 3, 'vatRows': 2 * R, 'normalRow': R, 'clips': clips, 'hold': hold,
        'maskSize': MASK, 'refLum': ref, 'heightM': HEIGHT, 'offsets': offsets, 'bytes': pos}
json.dump(meta, open(f'{out_dir}/{name}.json', 'w', encoding='utf-8'), indent=1)
print(f'SPECTATEUR {name} : {tris0} → {I // 3} triangles, {V} sommets, {R} images ({", ".join(c["name"] + " " + str(c["frames"]) for c in clips)}), '
      f'porteur : image {hold}, {pos / 1e6:.2f} Mo, références {ref}')
