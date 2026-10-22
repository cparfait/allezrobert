"""
Allez Robert ! — génération procédurale du cycliste (riggé) et du vélo de route.

Usage (depuis la racine du dépôt) :
    blender -b --factory-startup --python tools/blender/build_cyclist.py -- --out apps/client/public/models/

Options :
    --preview docs/screenshots/avatar-preview.png   rendu Eevee de contrôle (+ variantes -side, -front, -head, -lod1,
                                                    vélo seul : -bike-side, -bike-3q, -bike-cock, -bike-hood, -bike-drive, -bike-front,
                                                    -bike-climb ; gros plan main sur cocotte : -cockpit-hand)
    --views 3q,side,...                             sous-ensemble de vues à rendre
    --no-preview                                    pas de rendu
    --blend out/cyclist.blend                       sauvegarde du .blend (inspection)

Aucun asset externe : tout est modélisé ici (primitives → union voxel → lissage → décimation).

Conventions : on raisonne dans le repère CLIENT (three.js) : +x = GAUCHE du coureur, +y = haut,
+z = avant. Conversion vers Blender (Z en haut, le personnage regarde -Y) : (x, y, z) → (x, -z, y).
L'exportateur glTF (+Y up) refait la conversion inverse : les fichiers .glb sont donc directement
dans le repère du client.

Pose de repos = pose de conduite : assis, mains sur les cocottes, pieds sur les pédales à l'angle
de manivelle 0 (pédale gauche en bas, droite en haut). Le client pilote les os procéduralement.
"""

import argparse
import math
import os
import sys
import json

import bpy
import bmesh
import numpy as np
from mathutils import Vector

# ---------------------------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------------------------
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--out', default='apps/client/public/models/')
ap.add_argument('--preview', default='docs/screenshots/bikes.png')
ap.add_argument('--no-preview', action='store_true')
ap.add_argument('--blend', default='')
ap.add_argument('--views', default='')  # (obsolète, conservé pour compatibilité)
ap.add_argument('--only', default='', choices=['', 'rider', 'bikes'])
args = ap.parse_args(argv)
OUT = os.path.abspath(args.out)
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------------------------------------
# Cotes (repère client, mètres) — identiques à apps/client/src/rider/avatar.ts
# ---------------------------------------------------------------------------------------------
BB = np.array([0.0, 0.27, 0.0])
CRANK = 0.1725
WHEEL_R = 0.335
REAR_AXLE = np.array([0.0, WHEEL_R, -0.41])
FRONT_AXLE = np.array([0.0, WHEEL_R, 0.59])
SADDLE = np.array([0.0, 0.95, -0.2])

# Pédales : axe de pédale (bout de manivelle) et centre du pied.
PEDAL_AXIS_X = 0.072
PEDAL_X = 0.105
# Inclinaison de repos du pied (talon levé, rad). Le client fait varier cet angle (« ankling »).
REST_PITCH = 0.35
# Cheville par rapport à l'axe de pédale, pied à plat (y haut, z avant).
ANKLE_FLAT = np.array([0.0, 0.095, -0.13])

# Segments (adulte ≈ 1,75 m, hauteur de selle cohérente avec BB→selle 0,71 m).
THIGH = 0.43
SHIN = 0.41
UPPER = 0.31
FORE = 0.28

LOD0_BODY_TRIS = 5600
LOD1_RATIO = 0.25
PROTECT_FACTOR = float(os.environ.get('AR_PF', '0.012'))


# ---------------------------------------------------------------------------------------------
# Outils géométriques (numpy, repère client)
# ---------------------------------------------------------------------------------------------
def V(*a):
    return np.array(a, dtype=float)


def nrm(v):
    v = np.asarray(v, dtype=float)
    n = np.linalg.norm(v)
    return v / n if n > 1e-12 else v


def rotx(v, th):
    c, s = math.cos(th), math.sin(th)
    x, y, z = v
    return np.array([x, y * c - z * s, y * s + z * c])


def smoothstep(e0, e1, x):
    t = np.clip((np.asarray(x, dtype=float) - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def to_bl(p):
    """Repère client → Blender."""
    return (float(p[0]), float(-p[2]), float(p[1]))


def to_client_arr(a):
    a = np.asarray(a, dtype=float)
    return np.stack([a[:, 0], a[:, 2], -a[:, 1]], axis=1)


def two_bone(root, target, l1, l2, pole):
    """Cinématique inverse à deux os (même formule que le client)."""
    d = target - root
    dist = float(np.clip(np.linalg.norm(d), abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3))
    dr = nrm(d)
    a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist)
    h = math.sqrt(max(l1 * l1 - a * a, 0.0))
    bend = nrm(pole - dr * np.dot(pole, dr))
    return root + dr * a + bend * h


def catmull(pts, per=4):
    """Rééchantillonne une polyligne en Catmull-Rom (chemins lisses)."""
    pts = np.asarray(pts, dtype=float)
    n = len(pts)
    out = []
    for i in range(n - 1):
        p0, p1, p2, p3 = pts[max(i - 1, 0)], pts[i], pts[i + 1], pts[min(i + 2, n - 1)]
        for k in range(per):
            t = k / per
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(pts[-1])
    return np.array(out)


def resample(vals, per):
    """Interpolation linéaire d'attributs par point, cohérente avec catmull(per)."""
    vals = np.asarray(vals, dtype=float)
    out = []
    for i in range(len(vals) - 1):
        for k in range(per):
            out.append(vals[i] + (vals[i + 1] - vals[i]) * (k / per))
    out.append(vals[-1])
    return np.array(out)


# ---------------------------------------------------------------------------------------------
# Primitives (renvoient sommets client + faces + infos de distance pour l'attribution des os)
# ---------------------------------------------------------------------------------------------
def loft(path, rx, ry, ref, off=None, n=16, expo=2.0, cap=True):
    """Tube à sections (super)elliptiques le long d'un chemin.
    rx : demi-largeur selon S = T × F ; ry : demi-épaisseur selon F (ref projeté ⟂ tangente)."""
    P = np.asarray(path, dtype=float)
    m = len(P)
    rx = np.broadcast_to(np.asarray(rx, dtype=float), (m,)).copy()
    ry = np.broadcast_to(np.asarray(ry, dtype=float), (m,)).copy()
    off = np.zeros(m) if off is None else np.broadcast_to(np.asarray(off, dtype=float), (m,)).copy()
    T = np.zeros_like(P)
    T[1:-1] = P[2:] - P[:-2]
    T[0] = P[1] - P[0]
    T[-1] = P[-1] - P[-2]
    T /= np.linalg.norm(T, axis=1)[:, None]
    R = np.asarray(ref, dtype=float)
    if R.ndim == 1:
        R = np.tile(R, (m, 1))
    F = R - (R * T).sum(1)[:, None] * T
    F /= np.linalg.norm(F, axis=1)[:, None]
    S = np.cross(T, F)
    ang = np.arange(n) * 2 * math.pi / n
    c, s = np.cos(ang), np.sin(ang)
    e = 2.0 / expo
    ce = np.sign(c) * np.abs(c) ** e
    se = np.sign(s) * np.abs(s) ** e
    centers = P + F * off[:, None]
    verts = []
    for i in range(m):
        ring = centers[i] + S[i] * (rx[i] * ce)[:, None] + F[i] * (ry[i] * se)[:, None]
        verts.extend(ring.tolist())
    faces = []
    for i in range(m - 1):
        for k in range(n):
            a = i * n + k
            b = i * n + (k + 1) % n
            faces.append((a, b, b + n, a + n))
    if cap:
        i0 = len(verts)
        verts.append(centers[0].tolist())
        for k in range(n):
            faces.append((i0, (k + 1) % n, k))
        i1 = len(verts)
        verts.append(centers[-1].tolist())
        base = (m - 1) * n
        for k in range(n):
            faces.append((i1, base + k, base + (k + 1) % n))
    info = {'kind': 'loft', 'centers': centers, 'r': (rx + ry) * 0.5}
    return verts, faces, info


def ellipsoid(c, axes, radii, nu=20, nv=12):
    """Ellipsoïde ; axes = (a0, a1 = axe des pôles, a2)."""
    a0, a1, a2 = (nrm(a) for a in axes)
    c = np.asarray(c, dtype=float)
    verts = [(c + a1 * radii[1]).tolist()]
    for j in range(1, nv):
        th = math.pi * j / nv
        for k in range(nu):
            ph = 2 * math.pi * k / nu
            p = c + a0 * radii[0] * math.sin(th) * math.cos(ph) + a2 * radii[2] * math.sin(th) * math.sin(ph) + a1 * radii[1] * math.cos(th)
            verts.append(p.tolist())
    verts.append((c - a1 * radii[1]).tolist())
    faces = []
    for k in range(nu):
        faces.append((0, 1 + (k + 1) % nu, 1 + k))
    for j in range(nv - 2):
        r0 = 1 + j * nu
        r1 = r0 + nu
        for k in range(nu):
            faces.append((r0 + k, r0 + (k + 1) % nu, r1 + (k + 1) % nu, r1 + k))
    last = len(verts) - 1
    r0 = 1 + (nv - 2) * nu
    for k in range(nu):
        faces.append((last, r0 + k, r0 + (k + 1) % nu))
    info = {'kind': 'ell', 'c': c, 'R': np.stack([a0, a1, a2]), 'radii': np.asarray(radii, dtype=float)}
    return verts, faces, info


def lathe(profile, n=32, closed=True, phase=0.0, center=(0.0, 0.0, 0.0)):
    """Révolution autour de l'axe x client (roues, pédalier). profile = [(rayon, x)]."""
    c = np.asarray(center, dtype=float)
    m = len(profile)
    verts = []
    for k in range(n):
        ph = 2 * math.pi * k / n + phase
        for r, x in profile:
            verts.append((c + np.array([x, r * math.cos(ph), r * math.sin(ph)])).tolist())
    faces = []
    jmax = m if closed else m - 1
    for k in range(n):
        k2 = (k + 1) % n
        for j in range(jmax):
            j2 = (j + 1) % m
            faces.append((k * m + j, k * m + j2, k2 * m + j2, k2 * m + j))
    return verts, faces


def box(c, half, ref_axes=None):
    c = np.asarray(c, dtype=float)
    ax = ref_axes if ref_axes is not None else (V(1, 0, 0), V(0, 1, 0), V(0, 0, 1))
    verts = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                verts.append((c + ax[0] * half[0] * sx + ax[1] * half[1] * sy + ax[2] * half[2] * sz).tolist())
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    return verts, faces


# ---------------------------------------------------------------------------------------------
# Construction de maillages Blender
# ---------------------------------------------------------------------------------------------
class MB:
    """Accumulateur de géométrie (coordonnées Blender) avec un nom de matériau par face."""

    def __init__(self):
        self.v = []
        self.f = []
        self.fm = []

    def add(self, verts, faces, mat):
        off = len(self.v)
        self.v.extend(to_bl(p) for p in verts)
        self.f.extend(tuple(i + off for i in f) for f in faces)
        self.fm.extend([mat] * len(faces))

    def add_bl(self, verts_bl, faces, mats):
        off = len(self.v)
        self.v.extend(tuple(map(float, p)) for p in verts_bl)
        self.f.extend(tuple(i + off for i in f) for f in faces)
        self.fm.extend(mats)

    def build(self, name, recalc=True):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, [], self.f)
        names = []
        for m in self.fm:
            if m not in names:
                names.append(m)
        for m in names:
            me.materials.append(MATS[m])
        idx = {m: i for i, m in enumerate(names)}
        me.polygons.foreach_set('material_index', [idx[m] for m in self.fm])
        me.update()
        if recalc:
            bm = bmesh.new()
            bm.from_mesh(me)
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            bm.to_mesh(me)
            bm.free()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


def mesh_arrays(ob):
    me = ob.data
    vs = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get('co', vs)
    vs = vs.reshape(-1, 3)
    mw = np.array(ob.matrix_world)
    vs = vs @ mw[:3, :3].T + mw[:3, 3]
    faces = [tuple(p.vertices) for p in me.polygons]
    mats = [me.materials[p.material_index].name for p in me.polygons]
    return vs, faces, mats


def apply_modifiers(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    if old.users == 0:
        bpy.data.meshes.remove(old)
    me.name = ob.name


def remove_obj(ob):
    me = ob.data if ob.type == 'MESH' else None
    bpy.data.objects.remove(ob)
    if me is not None and me.users == 0:
        bpy.data.meshes.remove(me)


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def decimate_to(ob, target, protect=None, factor=8.0):
    """Décimation par effondrement d'arêtes ; protect = nom d'un groupe de sommets à préserver."""
    tris = tri_count(ob)
    if tris <= target:
        return
    m = ob.modifiers.new('dec', 'DECIMATE')
    m.decimate_type = 'COLLAPSE'
    m.ratio = target / tris
    m.use_collapse_triangulate = True
    if protect:
        m.vertex_group = protect
        m.vertex_group_factor = factor
    apply_modifiers(ob)
    if protect and protect in ob.vertex_groups:
        ob.vertex_groups.remove(ob.vertex_groups[protect])


def remesh_union(ob, voxel, smooth_iter, smooth_factor=0.5):
    m = ob.modifiers.new('rm', 'REMESH')
    m.mode = 'VOXEL'
    m.voxel_size = voxel
    m.adaptivity = 0.0
    apply_modifiers(ob)
    if smooth_iter:
        s = ob.modifiers.new('sm', 'SMOOTH')
        s.factor = smooth_factor
        s.iterations = smooth_iter
        apply_modifiers(ob)


def shade(ob, sharp_deg=None):
    ob.data.shade_smooth()
    if sharp_deg is not None:
        ob.data.set_sharp_from_angle(angle=math.radians(sharp_deg))


def copy_object(ob, name):
    o2 = ob.copy()
    o2.data = ob.data.copy()
    o2.name = name
    o2.data.name = name
    bpy.context.scene.collection.objects.link(o2)
    return o2


# ---------------------------------------------------------------------------------------------
# Matériaux (couleurs par défaut = DEFAULT_LOOK ; le client les remplace par nom)
# ---------------------------------------------------------------------------------------------
def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [1.0]


MAT_DEFS = {
    # nom : (couleur, rugosité, métal)
    'skin': ('#e0b48f', 0.55, 0.0),
    'jersey': ('#1f6feb', 0.7, 0.0),
    'jersey_accent': ('#ffd23f', 0.7, 0.0),
    'shorts': ('#15171c', 0.55, 0.0),
    'sock': ('#f2f2f2', 0.8, 0.0),
    'shoe': ('#f4f4f4', 0.4, 0.0),
    'shoe_sole': ('#1a1b1f', 0.6, 0.0),
    'helmet': ('#f4f4f4', 0.35, 0.0),
    'helmet_detail': ('#1c1d22', 0.6, 0.0),
    'lens': ('#20242c', 0.08, 0.6),
    'glasses_frame': ('#141518', 0.35, 0.0),
    'hair': ('#3b2a1e', 0.8, 0.0),
    'frame': ('#c0392b', 0.3, 0.3),
    'components': ('#18191c', 0.45, 0.2),
    'tire': ('#121214', 0.85, 0.0),
    'rim': ('#1e2024', 0.35, 0.1),
    'chrome': ('#b9bcc2', 0.2, 1.0),
    # Ajouts vélo 2026 (le client les recolore par nom : guidoline et bidons = accent du maillot).
    'rim_decal': ('#6a7079', 0.45, 0.1),
    'bar_tape': ('#ffd23f', 0.75, 0.0),
    'computer_screen': ('#1b2a30', 0.15, 0.0),
    'bottle': ('#ffd23f', 0.5, 0.0),
    # Catalogue de vélos : matériaux teintables séparément par le client.
    'tire_wall': ('#1a1a1c', 0.8, 0.0),
    'spokes': ('#151618', 0.4, 0.3),
    'hub': ('#1c1d21', 0.4, 0.3),
    'rotor': ('#b9bcc2', 0.25, 1.0),
    'valve': ('#b9bcc2', 0.3, 1.0),
    'saddle': ('#141518', 0.55, 0.0),
    'saddle_lattice': ('#202226', 0.6, 0.0),
    'crank': ('#18191c', 0.4, 0.2),
    'chainring': ('#2a2c31', 0.35, 0.5),
    'chain': ('#9a9da3', 0.3, 1.0),
    'pulley': ('#1c1d21', 0.5, 0.0),
    'cage': ('#18191c', 0.45, 0.1),
    'computer': ('#1b1c20', 0.45, 0.0),
    'caliper': ('#1c1d21', 0.4, 0.3),
    'spacers': ('#18191c', 0.4, 0.2),
    'topcap': ('#18191c', 0.4, 0.3),
    'bolts': ('#b9bcc2', 0.3, 1.0),
    'pad': ('#202124', 0.8, 0.0),
    'cassette': ('#b9bcc2', 0.25, 1.0),
}
MATS = {}


def make_materials():
    for name, (col, rough, metal) in MAT_DEFS.items():
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = srgb(col)
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
        if name == 'skin':
            try:
                bsdf.inputs['Subsurface Weight'].default_value = 0.15
                bsdf.inputs['Subsurface Radius'].default_value = (0.02, 0.008, 0.004)
            except KeyError:
                pass
        if name == 'computer_screen':
            bsdf.inputs['Emission Color'].default_value = srgb('#3f7f8f')
            bsdf.inputs['Emission Strength'].default_value = 0.6
        m.diffuse_color = srgb(col)
        MATS[name] = m


# ---------------------------------------------------------------------------------------------
# Squelette de référence (pose de conduite)
# ---------------------------------------------------------------------------------------------
class Rig:
    pass


def build_rig():
    r = Rig()
    r.H0 = V(0, 1.03, -0.17)
    a = math.radians(45)
    r.u = V(0, math.sin(a), math.cos(a))  # axe du tronc (bassin → épaules)
    r.f = V(0, -math.cos(a), math.sin(a))  # face ventrale
    r.C = lambda t: r.H0 + r.u * t
    r.N0 = r.C(0.50) - r.f * 0.01
    r.nd = V(0, math.sin(math.radians(55)), math.cos(math.radians(55)))
    r.atlas = r.N0 + r.nd * 0.10
    p = math.radians(12)
    r.xh = V(1, 0, 0)
    r.uh = V(0, math.cos(p), math.sin(p))
    r.fh = V(0, -math.sin(p), math.cos(p))
    r.Sc = r.atlas + r.uh * 0.06 + r.fh * 0.025
    r.crown = r.atlas + r.uh * 0.19
    r.H = lambda x, up, fw: r.Sc + r.xh * x + r.uh * up + r.fh * fw
    r.side = {}
    for s, tag in ((1, 'L'), (-1, 'R')):
        d = Rig()
        d.s = s
        d.hip = V(0.085 * s, 1.03, -0.17)
        ang = 0.0 if s > 0 else math.pi
        d.pedal = V(PEDAL_X * s, BB[1] - math.cos(ang) * CRANK, -math.sin(ang) * CRANK)
        d.ankle = d.pedal + rotx(ANKLE_FLAT, REST_PITCH)
        d.knee_pole = nrm(V(0.1 * s, 0.3, 1.0))
        d.knee = two_bone(d.hip, d.ankle, THIGH, SHIN, d.knee_pole)
        d.ball = d.pedal + rotx(V(0, 0.035, 0.03), REST_PITCH)
        d.shoulder = r.C(0.46) - r.f * 0.02 + V(0.175 * s, 0, 0)
        d.wrist = V(0.2 * s, 0.958, 0.54)
        d.elbow_pole = nrm(V(0.7 * s, -0.5, -0.3))
        d.elbow = two_bone(d.shoulder, d.wrist, UPPER, FORE, d.elbow_pole)
        d.knuckle = V(0.2 * s, 0.938, 0.634)
        d.thigh_d = nrm(d.knee - d.hip)
        d.shin_d = nrm(d.ankle - d.knee)
        d.upper_d = nrm(d.elbow - d.shoulder)
        d.fore_d = nrm(d.wrist - d.elbow)
        d.hand_d = nrm(d.knuckle - d.wrist)
        r.side[tag] = d
    # Os : (nom, tête, queue, parent)
    r.bones = [
        ('hips', r.H0, r.C(0.13), None),
        ('spine', r.C(0.13), r.C(0.27), 'hips'),
        ('chest', r.C(0.27), r.N0, 'spine'),
        ('neck', r.N0, r.atlas, 'chest'),
        ('head', r.atlas, r.crown, 'neck'),
    ]
    for tag, d in r.side.items():
        r.bones += [
            (f'upper_arm_{tag}', d.shoulder, d.elbow, 'chest'),
            (f'forearm_{tag}', d.elbow, d.wrist, f'upper_arm_{tag}'),
            (f'hand_{tag}', d.wrist, d.knuckle, f'forearm_{tag}'),
            (f'thigh_{tag}', d.hip, d.knee, 'hips'),
            (f'shin_{tag}', d.knee, d.ankle, f'thigh_{tag}'),
            (f'foot_{tag}', d.ankle, d.ball, f'shin_{tag}'),
        ]
    r.bone_names = [b[0] for b in r.bones]
    return r


# ---------------------------------------------------------------------------------------------
# Corps : primitives → union voxel
# ---------------------------------------------------------------------------------------------
def body_primitives(r):
    """Renvoie (MB, prims). Chaque primitive porte une région (matériaux) et un découpage en os."""
    mb = MB()
    prims = []

    def add(res, region, bones, mat='skin'):
        verts, faces, info = res
        mb.add(verts, faces, mat)
        info['region'] = region
        info['bones'] = bones  # liste [(s_max, os)] le long de la primitive
        prims.append(info)

    # Tronc : sections le long de l'axe u (t, demi-largeur, demi-profondeur, décalage ventral).
    T = [
        (-0.11, 0.065, 0.04, -0.03),
        (-0.08, 0.115, 0.068, -0.03),
        (-0.035, 0.148, 0.095, -0.022),
        (0.03, 0.156, 0.106, -0.01),
        (0.10, 0.152, 0.108, 0.0),
        (0.18, 0.148, 0.108, 0.01),
        (0.26, 0.153, 0.113, 0.014),
        (0.34, 0.163, 0.118, 0.01),
        (0.41, 0.168, 0.113, 0.0),
        (0.465, 0.152, 0.094, -0.012),
        (0.505, 0.108, 0.07, -0.02),
        (0.535, 0.06, 0.045, -0.022),
    ]
    tt = np.array([t[0] for t in T])
    path = catmull([r.C(t) for t in tt], 3)
    rx = resample([t[1] for t in T], 3)
    ry = resample([t[2] for t in T], 3)
    of = resample([t[3] for t in T], 3)
    total = tt[-1] - tt[0]
    s_hips = (0.13 - tt[0]) / total
    s_spine = (0.27 - tt[0]) / total
    add(loft(path, rx, ry, r.f, of, n=24, expo=2.3), 'torso', [(s_hips, 'hips'), (s_spine, 'spine'), (1.0, 'chest')])

    # Cou (de l'intérieur du thorax jusque dans le crâne).
    npts = [r.C(0.40) - r.f * 0.02, r.N0, r.atlas, r.atlas + r.uh * 0.05]
    seg = np.cumsum([0] + [np.linalg.norm(npts[i + 1] - npts[i]) for i in range(3)])
    add(loft(npts, [0.066, 0.053, 0.048, 0.044], [0.07, 0.056, 0.051, 0.046], r.f, n=16),
        'neck', [(seg[1] / seg[-1], 'chest'), (seg[2] / seg[-1], 'neck'), (1.0, 'head')])

    # Tête (repère tête : x latéral, uh haut, fh avant).
    H = r.H
    hx = (r.xh, r.uh, r.fh)
    add(ellipsoid(H(0, 0.0, -0.005), hx, (0.077, 0.098, 0.102), 24, 14), 'head', [(1.0, 'head')])
    add(ellipsoid(H(0, -0.056, 0.016), hx, (0.058, 0.052, 0.066), 20, 12), 'head', [(1.0, 'head')])
    add(ellipsoid(H(0, -0.1, 0.068), hx, (0.024, 0.018, 0.02), 12, 8), 'head', [(1.0, 'head')])
    add(ellipsoid(H(0, 0.022, 0.084), hx, (0.058, 0.014, 0.02), 16, 8), 'head', [(1.0, 'head')])
    add(ellipsoid(H(0, -0.076, 0.082), hx, (0.02, 0.007, 0.009), 12, 8), 'head', [(1.0, 'head')])
    for s in (1, -1):
        add(ellipsoid(H(0.042 * s, -0.03, 0.066), hx, (0.024, 0.02, 0.022), 12, 8), 'head', [(1.0, 'head')])
        add(ellipsoid(H(0.076 * s, -0.028, -0.008), hx, (0.011, 0.03, 0.019), 12, 8), 'head', [(1.0, 'head')])
    nose = [H(0, 0.008, 0.087), H(0, -0.018, 0.102), H(0, -0.04, 0.111), H(0, -0.05, 0.103)]
    add(loft(nose, [0.008, 0.010, 0.012, 0.014], [0.006, 0.009, 0.011, 0.007], r.fh, n=10), 'head', [(1.0, 'head')])

    for tag, d in r.side.items():
        s = d.s
        # Cuisse.
        ts = [-0.10, 0.0, 0.25, 0.55, 0.8, 0.95, 1.06]
        rxs = [0.058, 0.079, 0.078, 0.069, 0.056, 0.049, 0.04]
        rys = [0.058, 0.08, 0.079, 0.068, 0.055, 0.049, 0.04]
        ofs = [0.0, 0.0, 0.005, 0.008, 0.006, 0.0, 0.0]
        add(loft([d.hip + d.thigh_d * THIGH * t for t in ts], rxs, rys, d.knee_pole, ofs, n=18), f'thigh_{tag}', [(1.0, f'thigh_{tag}')])
        # Jambe (mollet en arrière).
        ts = [-0.08, 0.0, 0.12, 0.3, 0.55, 0.85, 1.0, 1.12]
        rxs = [0.042, 0.05, 0.05, 0.05, 0.04, 0.03, 0.03, 0.027]
        rys = [0.042, 0.05, 0.053, 0.058, 0.045, 0.032, 0.035, 0.03]
        ofs = [0.0, 0.0, -0.008, -0.016, -0.01, -0.002, 0.0, 0.0]
        add(loft([d.knee + d.shin_d * SHIN * t for t in ts], rxs, rys, d.knee_pole, ofs, n=16), f'shin_{tag}', [(1.0, f'shin_{tag}')])
        # Bras.
        ts = [-0.12, 0.0, 0.2, 0.5, 0.85, 1.0, 1.05]
        rr = [0.045, 0.056, 0.051, 0.045, 0.038, 0.036, 0.034]
        rr2 = [0.045, 0.058, 0.052, 0.046, 0.037, 0.034, 0.032]
        add(loft([d.shoulder + d.upper_d * UPPER * t for t in ts], rr, rr2, V(0, 1, 0), n=14), f'upper_arm_{tag}', [(1.0, f'upper_arm_{tag}')])
        ts = [-0.06, 0.15, 0.4, 0.8, 1.0, 1.06]
        rr = [0.035, 0.042, 0.038, 0.029, 0.027, 0.026]
        rr2 = [0.035, 0.04, 0.034, 0.022, 0.019, 0.018]
        add(loft([d.elbow + d.fore_d * FORE * t for t in ts], rr, rr2, V(0, 1, 0), n=14), f'forearm_{tag}', [(1.0, f'forearm_{tag}')])
        # Main posée sur la cocotte : paume, doigts enroulés, pouce à l'intérieur.
        palm = [d.wrist + (d.knuckle - d.wrist) * t for t in (0.0, 0.3, 0.85, 1.0)]
        add(loft(palm, [0.031, 0.04, 0.043, 0.041], [0.018, 0.02, 0.016, 0.014], V(0, 1, 0), n=12), f'hand_{tag}', [(1.0, f'hand_{tag}')])
        fp = catmull([d.knuckle - d.hand_d * 0.01, V(0.2 * s, 0.935, 0.655), V(0.2 * s, 0.906, 0.672), V(0.2 * s, 0.876, 0.668)], 3)
        fr = resample([0.041, 0.04, 0.038, 0.035], 3)
        ft = resample([0.013, 0.012, 0.011, 0.01], 3)
        add(loft(fp, fr, ft, V(0, 0.5, 1.0), n=12), f'hand_{tag}', [(1.0, f'hand_{tag}')])
        thumb = [V(0.172 * s, 0.948, 0.565), V(0.17 * s, 0.93, 0.6), V(0.174 * s, 0.918, 0.622)]
        add(loft(thumb, [0.013, 0.012, 0.01], [0.013, 0.011, 0.009], V(0, 1, 0), n=10), f'hand_{tag}', [(1.0, f'hand_{tag}')])
    return mb, prims


def label_vertices(vc, prims):
    """Pour chaque sommet (client) : primitive la plus proche (distance signée approx.), param s."""
    N = len(vc)
    best = np.full(N, np.inf)
    owner = np.zeros(N, dtype=int)
    best_s = np.zeros(N)
    for pi, p in enumerate(prims):
        if p['kind'] == 'loft':
            C = p['centers']
            r = p['r']
            seg = np.linalg.norm(C[1:] - C[:-1], axis=1)
            cum = np.concatenate([[0], np.cumsum(seg)])
            tot = cum[-1]
            sd = np.full(N, np.inf)
            ss = np.zeros(N)
            for i in range(len(C) - 1):
                a, b = C[i], C[i + 1]
                ab = b - a
                L2 = max(np.dot(ab, ab), 1e-12)
                t = np.clip(((vc - a) @ ab) / L2, 0, 1)
                d = np.linalg.norm(vc - (a + t[:, None] * ab), axis=1) - (r[i] + (r[i + 1] - r[i]) * t)
                m = d < sd
                sd[m] = d[m]
                ss[m] = (cum[i] + t[m] * seg[i]) / tot
        else:
            q = (vc - p['c']) @ p['R'].T
            k0 = np.linalg.norm(q / p['radii'], axis=1)
            k1 = np.maximum(np.linalg.norm(q / p['radii'] ** 2, axis=1), 1e-9)
            sd = k0 * (k0 - 1.0) / k1  # approximation classique de la distance à un ellipsoïde
            ss = np.zeros(N)
        m = sd < best
        best[m] = sd[m]
        owner[m] = pi
        best_s[m] = ss[m]
    regions = np.array([prims[i]['region'] for i in owner])
    bones = []
    for i in range(N):
        bl = prims[owner[i]]['bones']
        b = bl[-1][1]
        for smax, name in bl:
            if best_s[i] <= smax:
                b = name
                break
        bones.append(b)
    return regions, np.array(bones)


# ---------------------------------------------------------------------------------------------
# Finition du corps : coupe des ourlets, matériaux, poids, clé de forme « build »
# ---------------------------------------------------------------------------------------------
T_WAIST = 0.1
T_STRIPE = (0.30, 0.355)
SLEEVE = (0.47, 0.55)
SHORTS_HEM = 0.78
SOCK_H = 0.13


def near_neck(r, c, rad=0.16):
    v = c - r.N0
    return np.linalg.norm(v - r.nd * np.dot(v, r.nd)) < rad


def collar_skin(r, c):
    return np.dot(c - r.N0, r.nd) > 0.012 and near_neck(r, c)


def in_torso_zone(r, region, c):
    """Zone « tronc » indépendante de la région : évite les frontières dentelées aux jonctions
    tronc / cuisses / bras (le maillot et le cuissard y suivent les mêmes plans)."""
    if region == 'torso':
        return True
    if region.startswith('thigh'):
        d = r.side[region[-1]]
        return np.dot(c - d.hip, d.thigh_d) / THIGH < 0.12
    return False


def body_cuts(r):
    """Plans de coupe : (prédicat(région, centre de face), point, normale)."""
    cuts = []
    zone = lambda reg, c: in_torso_zone(r, reg, c)
    for t in (T_WAIST, T_STRIPE[0], T_STRIPE[1]):
        cuts.append((zone, r.C(t), r.u))
    cuts.append((lambda reg, c: reg in ('torso', 'neck') and near_neck(r, c), r.N0 + r.nd * 0.012, r.nd))
    for tag, d in r.side.items():
        cuts.append((lambda reg, c, tag=tag: reg == f'thigh_{tag}', d.hip + d.thigh_d * THIGH * SHORTS_HEM, d.thigh_d))
        cuts.append((lambda reg, c, tag=tag: reg == f'shin_{tag}', d.ankle - d.shin_d * SOCK_H, d.shin_d))
        for k in SLEEVE:
            cuts.append((lambda reg, c, tag=tag: reg == f'upper_arm_{tag}', d.shoulder + d.upper_d * UPPER * k, d.upper_d))
    return cuts


def face_material(r, region, c):
    if region in ('torso', 'neck') and collar_skin(r, c):
        return 'skin'
    if region == 'neck':
        return 'jersey'
    if in_torso_zone(r, region, c):
        t = np.dot(c - r.H0, r.u)
        if t < T_WAIST:
            return 'shorts'
        if T_STRIPE[0] < t < T_STRIPE[1]:
            return 'jersey_accent'
        return 'jersey'
    if region == 'head' or region.startswith('hand') or region.startswith('forearm'):
        return 'skin'
    d = r.side[region[-1]]
    if region.startswith('thigh'):
        return 'shorts' if np.dot(c - d.hip, d.thigh_d) / THIGH < SHORTS_HEM else 'skin'
    if region.startswith('shin'):
        return 'sock' if np.dot(c - d.ankle, d.shin_d) > -SOCK_H else 'skin'
    if region.startswith('upper_arm'):
        p = np.dot(c - d.shoulder, d.upper_d) / UPPER
        return 'jersey' if p < SLEEVE[0] else 'jersey_accent' if p < SLEEVE[1] else 'skin'
    return 'skin'


def body_joints(r):
    """Articulations : (parent, enfant, point, normale, demi-largeur de fondu, rayon d'action, côté)."""
    J = [
        ('hips', 'spine', r.C(0.13), r.u, 0.06, None, 0),
        ('spine', 'chest', r.C(0.27), r.u, 0.07, None, 0),
        ('chest', 'neck', r.N0, r.nd, 0.035, None, 0),
        ('neck', 'head', r.atlas, nrm(r.nd + r.uh), 0.03, None, 0),
    ]
    for tag, d in r.side.items():
        J += [
            ('hips', f'thigh_{tag}', d.hip, d.thigh_d, 0.07, 0.17, d.s),
            (f'thigh_{tag}', f'shin_{tag}', d.knee, nrm(d.thigh_d + d.shin_d), 0.05, None, 0),
            (f'shin_{tag}', f'foot_{tag}', d.ankle, d.shin_d, 0.03, None, 0),
            ('chest', f'upper_arm_{tag}', d.shoulder, d.upper_d, 0.05, 0.14, d.s),
            (f'upper_arm_{tag}', f'forearm_{tag}', d.elbow, nrm(d.upper_d + d.fore_d), 0.045, None, 0),
            (f'forearm_{tag}', f'hand_{tag}', d.wrist, d.hand_d, 0.025, None, 0),
        ]
    return J


def mesh_edges(me):
    e = np.zeros(len(me.edges) * 2, dtype=int)
    me.edges.foreach_get('vertices', e)
    return e.reshape(-1, 2)


def laplace(vals, edges, iters, lam=0.5):
    for _ in range(iters):
        acc = np.zeros_like(vals)
        cnt = np.zeros(len(vals))
        np.add.at(acc, edges[:, 0], vals[edges[:, 1]])
        np.add.at(acc, edges[:, 1], vals[edges[:, 0]])
        np.add.at(cnt, edges[:, 0], 1)
        np.add.at(cnt, edges[:, 1], 1)
        cnt = np.maximum(cnt, 1)
        if vals.ndim == 2:
            vals = vals * (1 - lam) + lam * acc / cnt[:, None]
        else:
            vals = vals * (1 - lam) + lam * acc / cnt
    return vals


def compute_weights(r, vc, owners, edges):
    names = r.bone_names
    idx = {b: i for i, b in enumerate(names)}
    N = len(vc)
    W = np.zeros((N, len(names)))
    oi = np.array([idx[o] for o in owners])
    W[np.arange(N), oi] = 1.0
    for parent, child, J, n, w, R, side in body_joints(r):
        ip, ic = idx[parent], idx[child]
        t = smoothstep(-w, w, (vc - J) @ n)
        mc = oi == ic
        moved = (1 - t[mc]) * W[mc, ic]
        W[mc, ic] -= moved
        W[mc, ip] += moved
        mp = oi == ip
        fall = np.ones(N)
        if R:
            fall *= 1 - smoothstep(0.6 * R, R, np.linalg.norm(vc - J, axis=1))
        if side:
            fall *= smoothstep(-0.01, 0.03, vc[:, 0] * side)
        moved = t[mp] * fall[mp] * W[mp, ip]
        W[mp, ip] -= moved
        W[mp, ic] += moved
    W = laplace(W, edges, 3)
    # 4 influences au plus, normalisées.
    order = np.argsort(-W, axis=1)
    W2 = np.zeros_like(W)
    rows = np.arange(N)[:, None]
    W2[rows, order[:, :4]] = W[rows, order[:, :4]]
    W2[W2 < 0.01] = 0
    W2 /= W2.sum(1, keepdims=True)
    return W2


def build_amount(r, vc, nc, regions):
    """Épaisseur ajoutée par la clé de forme « build » (fin → costaud)."""
    N = len(vc)
    amt = np.zeros(N)
    tt = (vc - r.H0) @ r.u
    nf = np.clip(nc @ r.f, 0, 1)
    for i in range(N):
        reg = regions[i]
        if reg == 'torso':
            amt[i] = 0.011 + 0.026 * math.exp(-((tt[i] - 0.14) / 0.12) ** 2) * nf[i] + 0.006 * math.exp(-((tt[i] - 0.36) / 0.1) ** 2)
        elif reg == 'neck':
            amt[i] = 0.01
        elif reg.startswith('thigh'):
            amt[i] = 0.014
        elif reg.startswith('shin'):
            amt[i] = 0.007
        elif reg.startswith('upper_arm'):
            amt[i] = 0.01
        elif reg.startswith('forearm'):
            amt[i] = 0.006
        elif reg.startswith('hand'):
            amt[i] = 0.002
        elif reg == 'head':
            up = np.dot(vc[i] - r.Sc, r.uh)
            amt[i] = 0.005 * float(smoothstep(-0.03, -0.08, up))
    return amt


def finalize_body(r, src, name, target_tris, prims):
    ob = copy_object(src, name)
    # Détail préservé sur le visage et les mains (vus de près).
    vc0 = to_client_arr(np.array([v.co[:] for v in ob.data.vertices]))
    reg0, _ = label_vertices(vc0, prims)
    # (Blender : poids faible = effondrement coûteux ; poids nul = jamais décimé.)
    vg = ob.vertex_groups.new(name='protect')
    for i, rg in enumerate(reg0):
        w = 1.0
        if rg == 'head':
            q = vc0[i] - r.Sc
            up, fw = np.dot(q, r.uh), np.dot(q, r.fh)
            # Calotte cachée par le casque : décimée librement ; visage : préservé.
            w = 1.0 if up > 0.035 else 0.3 if fw > 0.0 else 0.6
        elif rg.startswith('hand'):
            w = 0.7
        vg.add([i], w, 'REPLACE')
    decimate_to(ob, target_tris, 'protect', PROTECT_FACTOR)
    vc1 = to_client_arr(np.array([v.co[:] for v in ob.data.vertices]))
    reg1, _ = label_vertices(vc1, prims)
    print('INFO sommets tête', name, int((reg1 == 'head').sum()), '/', len(vc1))
    me = ob.data
    # Coupes nettes aux ourlets (maillot, cuissard, manches, chaussettes, bande d'accent, col).
    bm = bmesh.new()
    bm.from_mesh(me)
    for pred, co, no in body_cuts(r):
        bm.verts.ensure_lookup_table()
        bm.verts.index_update()
        vc = to_client_arr(np.array([v.co[:] for v in bm.verts]))
        regions, _ = label_vertices(vc, prims)
        sel = []
        for f in bm.faces:
            rr = [regions[v.index] for v in f.verts]
            reg = max(set(rr), key=rr.count)
            c = np.mean([vc[v.index] for v in f.verts], axis=0)
            if pred(reg, c):
                sel.append(f)
        if not sel:
            continue
        geom = set(sel)
        for f in sel:
            geom.update(f.edges)
            geom.update(f.verts)
        bmesh.ops.bisect_plane(bm, geom=list(geom), dist=1e-5, plane_co=to_bl(co), plane_no=to_bl(no))
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bm.to_mesh(me)
    bm.free()
    me.update()
    # Matériaux par face.
    vc = to_client_arr(np.array([v.co[:] for v in me.vertices]))
    regions, owners = label_vertices(vc, prims)
    me.materials.clear()
    names = ['skin', 'jersey', 'jersey_accent', 'shorts', 'sock']
    for n in names:
        me.materials.append(MATS[n])
    mi = []
    for p in me.polygons:
        rr = [regions[i] for i in p.vertices]
        reg = max(set(rr), key=rr.count)
        c = np.mean(vc[list(p.vertices)], axis=0)
        mi.append(names.index(face_material(r, reg, c)))
    me.polygons.foreach_set('material_index', mi)
    shade(ob)
    # Poids.
    edges = mesh_edges(me)
    W = compute_weights(r, vc, owners, edges)
    for bi, bname in enumerate(r.bone_names):
        vg = ob.vertex_groups.new(name=bname)
        nz = np.nonzero(W[:, bi])[0]
        for i in nz:
            vg.add([int(i)], float(W[i, bi]), 'REPLACE')
    # Clé de forme « build ».
    nn = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get('normal', nn)
    nc = to_client_arr(nn.reshape(-1, 3))
    amt = laplace(build_amount(r, vc, nc, regions), edges, 6)
    ob.shape_key_add(name='Basis', from_mix=False)
    k = ob.shape_key_add(name='build', from_mix=False)
    co = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3) + nn.reshape(-1, 3) * amt[:, None]
    k.data.foreach_set('co', co.ravel())
    return ob


# ---------------------------------------------------------------------------------------------
# Accessoires rigides (cheveux, casque, lunettes, chaussures)
# ---------------------------------------------------------------------------------------------
def bisect_keep(ob, co, no):
    """Coupe par un plan et supprime la partie du côté -no."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
    bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-6, plane_co=to_bl(co), plane_no=to_bl(no), clear_inner=True)
    bm.to_mesh(ob.data)
    bm.free()


def build_hair(r):
    mb = MB()
    H = r.H
    v, f, _ = ellipsoid(H(0, 0.0, -0.005), (r.xh, r.uh, r.fh), (0.083, 0.104, 0.108), 20, 12)
    mb.add(v, f, 'hair')
    ob = mb.build('rider_hair')
    a, b = H(0, 0.05, 0.1), H(0, -0.068, -0.1)
    slope = nrm(a - b)
    no = nrm(np.cross(r.xh, slope))
    if np.dot(no, r.uh) < 0:
        no = -no
    bisect_keep(ob, a, no)
    m = ob.modifiers.new('sol', 'SOLIDIFY')
    m.thickness = 0.005
    m.offset = -1
    apply_modifiers(ob)
    shade(ob)
    return ob


def build_helmet(r):
    H = r.H
    hx = (r.xh, r.uh, r.fh)
    cen = H(0, 0.03, -0.016)
    rad = (0.099, 0.097, 0.14)
    mb = MB()
    v, f, _ = ellipsoid(cen, hx, rad, 30, 15)
    # Queue effilée vers l'arrière.
    vv = []
    for p in v:
        p = np.array(p)
        q = p - cen
        fw = np.dot(q, r.fh)
        up = np.dot(q, r.uh)
        k = float(smoothstep(-0.06, -0.136, fw))
        p = p - r.fh * 0.03 * k - r.uh * 0.012 * k * float(up < 0.02)
        vv.append(p.tolist())
    mb.add(vv, f, 'helmet')
    ob = mb.build('rider_helmet')
    a, b = H(0, 0.036, 0.125), H(0, -0.05, -0.15)
    no = nrm(np.cross(r.xh, nrm(a - b)))
    if np.dot(no, r.uh) < 0:
        no = -no
    bisect_keep(ob, a, no)
    sol = ob.modifiers.new('sol', 'SOLIDIFY')
    sol.thickness = 0.022
    sol.offset = -1
    apply_modifiers(ob)
    # Aérations : découpe booléenne par des ellipsoïdes orientés selon la normale du casque.
    cm = MB()
    for xx, fw in ((0.022, 0.07), (-0.022, 0.07), (0.058, 0.05), (-0.058, 0.05), (0.0, 0.02), (0.035, 0.0), (-0.035, 0.0),
                   (0.074, -0.015), (-0.074, -0.015), (0.0, -0.07), (0.04, -0.07), (-0.04, -0.07)):
        q = 1 - (xx / rad[0]) ** 2 - ((fw + 0.0) / rad[2]) ** 2
        up = rad[1] * math.sqrt(max(q, 0.05))
        p = cen + r.xh * xx + r.uh * up + r.fh * fw
        n = nrm(r.xh * xx / rad[0] ** 2 + r.uh * up / rad[1] ** 2 + r.fh * fw / rad[2] ** 2)
        lat = nrm(r.xh - n * np.dot(r.xh, n))
        ln = np.cross(n, lat)
        vv, ff, _ = ellipsoid(p, (lat, n, ln), (0.009, 0.045, 0.036), 12, 8)
        cm.add(vv, ff, 'helmet_detail')
    cut = cm.build('helmet_cutter')
    bo = ob.modifiers.new('vents', 'BOOLEAN')
    bo.operation = 'DIFFERENCE'
    bo.solver = 'EXACT'
    bo.object = cut
    apply_modifiers(ob)
    remove_obj(cut)
    decimate_to(ob, 1050)
    # Matériaux : coque extérieure = couleur du casque, intérieur / tranches / aérations = sombre.
    me = ob.data
    me.materials.clear()
    me.materials.append(MATS['helmet'])
    me.materials.append(MATS['helmet_detail'])
    cen_bl = Vector(to_bl(cen))
    mi = []
    for p in me.polygons:
        radial = (p.center - cen_bl).normalized()
        mi.append(0 if p.normal.dot(radial) > 0.55 else 1)
    me.polygons.foreach_set('material_index', mi)
    shade(ob, 50)
    # Sangles.
    sb = MB()
    for s in (1, -1):
        for start in (H(0.088 * s, -0.012, 0.035), H(0.09 * s, -0.022, -0.05)):
            pth = catmull([start, H(0.07 * s, -0.075, -0.004), H(0.032 * s, -0.122, 0.05), H(0.0, -0.128, 0.052)], 2)
            v2, f2, _ = loft(pth, 0.0075, 0.0018, r.xh * s, n=4)
            sb.add(v2, f2, 'helmet_detail')
    straps = sb.build('straps')
    return join_into(ob, [straps])


def join_into(ob, others):
    mb = MB()
    for o in [ob] + others:
        vs, fs, ms = mesh_arrays(o)
        mb.add_bl(vs, fs, ms)
    name = ob.name
    sharp_src = ob
    for o in [ob] + others:
        remove_obj(o)
    new = mb.build(name, recalc=False)
    shade(new, 50)
    return new


def build_glasses(r):
    H = r.H
    mb = MB()
    nphi = 18
    phis = np.linspace(-math.radians(80), math.radians(80), nphi)
    rows = 3
    verts = []
    for ph in phis:
        hmin = -0.034 + 0.02 * math.exp(-(ph / 0.22) ** 2)
        for j in range(rows):
            h = hmin + (0.016 - hmin) * j / (rows - 1)
            fw = math.cos(ph) * 0.12 - 0.012 * (h / 0.03) ** 2 - 0.004
            p = H(math.sin(ph) * 0.087, h, fw)
            verts.append(p.tolist())
    faces = []
    for i in range(nphi - 1):
        for j in range(rows - 1):
            a = i * rows + j
            faces.append((a, a + 1, a + rows + 1, a + rows))
    mb.add(verts, faces, 'lens')
    lens = mb.build('lens', recalc=False)
    m = lens.modifiers.new('sol', 'SOLIDIFY')
    m.thickness = 0.0025
    apply_modifiers(lens)
    fb = MB()
    top = [H(math.sin(ph) * 0.0875, 0.0185, math.cos(ph) * 0.1205 - 0.012 * (0.0185 / 0.03) ** 2 - 0.004) for ph in phis]
    v, f, _ = loft(top, 0.0045, 0.003, r.uh, n=5)
    fb.add(v, f, 'glasses_frame')
    for s in (1, -1):
        ph = math.radians(80) * s
        st = H(math.sin(ph) * 0.087, 0.008, math.cos(ph) * 0.12 - 0.006)
        pth = catmull([st, H(0.085 * s, 0.006, -0.02), H(0.081 * s, -0.006, -0.065)], 2)
        v, f, _ = loft(pth, 0.006, 0.0022, r.xh * s, n=4)
        fb.add(v, f, 'glasses_frame')
    fr = fb.build('gframe')
    ob = join_into(lens, [fr])
    ob.name = 'rider_glasses'
    ob.data.name = 'rider_glasses'
    return ob


def build_shoes(r):
    mb = MB()
    zs = [-0.205, -0.19, -0.14, -0.08, -0.02, 0.03, 0.06, 0.077]
    hw = [0.026, 0.034, 0.037, 0.040, 0.046, 0.045, 0.035, 0.016]
    bot = [0.02, 0.016, 0.016, 0.016, 0.016, 0.017, 0.021, 0.03]
    top = [0.085, 0.112, 0.116, 0.096, 0.072, 0.056, 0.046, 0.036]
    for tag, d in r.side.items():
        s = d.s

        def T(p):
            return d.pedal + rotx(np.asarray(p, dtype=float), REST_PITCH)

        # Tige (upper).
        path = [T(V(0, (bot[i] + top[i]) / 2, zs[i])) for i in range(len(zs))]
        ry = [(top[i] - bot[i]) / 2 for i in range(len(zs))]
        pth = catmull(path, 2)
        v, f, _ = loft(pth, resample(hw, 2), resample(ry, 2), rotx(V(0, 1, 0), REST_PITCH), n=10, expo=2.8)
        mb.add(v, f, 'shoe')
        # Semelle rigide.
        sp = [T(V(0, 0.0125, z)) for z in zs[:-1]] + [T(V(0, 0.018, zs[-1] - 0.002))]
        v, f, _ = loft(sp, [w + 0.002 for w in hw[:-1]] + [hw[-1]], 0.0048, rotx(V(0, 1, 0), REST_PITCH), n=8, expo=4)
        mb.add(v, f, 'shoe_sole')
        # Cale.
        v, f = box(T(V(0, 0.0105, 0.005)), (0.026, 0.004, 0.032), (V(1, 0, 0), rotx(V(0, 1, 0), REST_PITCH), rotx(V(0, 0, 1), REST_PITCH)))
        mb.add(v, f, 'components')
        # Molette de serrage.
        dial = T(V(0.0, 0.101, -0.07))
        v, f, _ = loft([dial - rotx(V(0, 0.006, 0), REST_PITCH), dial + rotx(V(0, 0.006, 0), REST_PITCH)], 0.014, 0.014, V(1, 0, 0), n=8)
        mb.add(v, f, 'shoe_sole')
    ob = mb.build('rider_shoes')
    shade(ob, 45)
    return ob


def rigid_weights(ob, bone_fn):
    """Poids rigides : bone_fn(position client) → nom d'os."""
    me = ob.data
    vc = to_client_arr(np.array([v.co[:] for v in me.vertices]))
    groups = {}
    for i, p in enumerate(vc):
        b = bone_fn(p)
        if b not in groups:
            groups[b] = ob.vertex_groups.new(name=b)
        groups[b].add([i], 1.0, 'REPLACE')


# ---------------------------------------------------------------------------------------------
# Armature
# ---------------------------------------------------------------------------------------------
def build_armature(r):
    arm = bpy.data.armatures.new('Armature')
    ao = bpy.data.objects.new('Armature', arm)
    bpy.context.scene.collection.objects.link(ao)
    bpy.context.view_layer.objects.active = ao
    ao.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for name, head, tail, parent in r.bones:
        eb = arm.edit_bones.new(name)
        eb.head = to_bl(head)
        eb.tail = to_bl(tail)
        if parent:
            eb.parent = arm.edit_bones[parent]
            eb.use_connect = False
        eb.align_roll(Vector((0, 0, 1)) if name.startswith(('upper_arm', 'forearm', 'hand')) else Vector((0, -1, 0)))
    bpy.ops.object.mode_set(mode='OBJECT')
    ao.select_set(False)
    return ao


def skin_to(ob, ao):
    ob.parent = ao
    m = ob.modifiers.new('Armature', 'ARMATURE')
    m.object = ao


# ---------------------------------------------------------------------------------------------
# Vélo de route moderne (2025-2026) — cf. docs/research/VELOS_2026.md
# Aéro tout-terrain : tubes en aile tronquée (Kamm), haubans abaissés, cintre-potence monobloc,
# compteur déporté, jantes carbone ≈ 50 mm, pneus 28 mm, freins à disque, 2 × 12 vitesses,
# pédales à capteur de puissance, selle à bec court, deux bidons.
# Les cotes d'ancrage (boîtier, axes, selle, cocottes) sont celles du coureur : ne pas les bouger.
# ---------------------------------------------------------------------------------------------
BIKE_STYLES = {
    # Aéro (famille « aero », bikes/aero.glb). Cordes / largeurs en mètres.
    'aero': {
        'ht': (0.076, 0.064, 0.036, 0.032),     # douille : corde bas, corde haut, largeur bas, largeur haut
        'dt': (0.054, 0.066, 0.034, 0.037),     # diagonal : corde côté boîtier, côté douille, largeurs
        'st': (0.05, 0.042, 0.028, 0.03),       # tube de selle
        'tt': (0.0165, 0.0145, 0.0125, 0.011),  # horizontal : demi-largeur avant / arrière, demi-hauteur avant / arrière
        'ss': (0.022, 0.0095),                  # haubans : corde, largeur
        'cs': (0.0075, 0.0155, 0.0055, 0.008),  # bases : demi-largeur avant / arrière, demi-hauteur avant / arrière
        'fork': (0.046, 0.03, 0.016, 0.012),    # fourreaux : corde haut / bas, largeur haut / bas
        'post': (0.042, 0.021),                 # tige de selle : corde, largeur
        'trunc': 0.72,                          # troncature du profil NACA (0,72 = culot franc)
        'round': False,
        'rim': (0.052, 0.048),                  # hauteur de jante avant / arrière
    },
    # Grimpeur (famille « climb », bikes/climb.glb) : tubes ronds et fins, tige ronde, jantes 38 mm.
    'climb': {
        'ht': (0.05, 0.044, 0.042, 0.038),
        'dt': (0.044, 0.05, 0.04, 0.042),
        'st': (0.032, 0.03, 0.03, 0.03),
        'tt': (0.016, 0.0135, 0.0135, 0.012),
        'ss': (0.013, 0.0105),
        'cs': (0.0075, 0.014, 0.0055, 0.0075),
        'fork': (0.032, 0.022, 0.018, 0.013),
        'post': (0.0272, 0.0272),
        'trunc': 0.9,
        'round': True,
        'rim': (0.038, 0.038),
    },
}
# Plans des disques (côté gauche, x > 0) et rayons (160 mm avant, 140 mm arrière).
ROTOR_X = (0.044, 0.052)
ROTOR_R = (0.08, 0.07)
# Moyeux : 100 mm avant, 142 mm arrière (demi-largeurs).
HUB_HALF = (0.05, 0.068)
# Ligne de chaîne et galets du dérailleur (repère client).
CHAIN_X = -0.045


def kamm_sec(n, chord, width, trunc=0.72, fo=0.0):
    """Section en aile tronquée (profil NACA symétrique coupé à « trunc ») : n points (s latéral,
    f le long de la corde), bord d'attaque en +f, centrée sur le milieu de la corde (+ fo)."""
    m = 48
    x = (1 - np.cos(np.linspace(0, math.pi, m))) / 2 * trunc
    yt = 0.2969 * np.sqrt(x) - 0.126 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1015 * x ** 4
    up = np.stack([yt, -x], 1)
    lo = np.stack([-yt[::-1], -x[::-1]], 1)
    poly = np.concatenate([up, lo[:-1], up[:1]])
    seg = np.linalg.norm(np.diff(poly, axis=0), axis=1)
    cum = np.concatenate([[0], np.cumsum(seg)])
    tgt = np.arange(n) * cum[-1] / n
    s = np.interp(tgt, cum, poly[:, 0]) * width / (2 * yt.max())
    f = (np.interp(tgt, cum, poly[:, 1]) / trunc + 0.5) * chord + fo
    return np.stack([s, f], 1)


def ell_sec(n, a_s, a_f, expo=2.0, fo=0.0):
    """Section (super)elliptique : même convention que kamm_sec (départ en +f, puis +s)."""
    th = np.arange(n) * 2 * math.pi / n
    c, s = np.cos(th), np.sin(th)
    e = 2.0 / expo
    return np.stack([a_s * np.sign(s) * np.abs(s) ** e, a_f * np.sign(c) * np.abs(c) ** e + fo], 1)


def sweep_rings(P, secs, ref):
    """Anneaux (m, n, 3) d'une section balayée le long de P. F = ref ⟂ tangente (corde), S = T × F."""
    P = np.asarray(P, dtype=float)
    m = len(P)
    T = np.zeros_like(P)
    T[1:-1] = P[2:] - P[:-2]
    T[0] = P[1] - P[0]
    T[-1] = P[-1] - P[-2]
    T /= np.linalg.norm(T, axis=1)[:, None]
    R = np.asarray(ref, dtype=float)
    if R.ndim == 1:
        R = np.tile(R, (m, 1))
    F = R - (R * T).sum(1)[:, None] * T
    for i in range(m):
        if np.linalg.norm(F[i]) < 1e-6:
            alt = V(0, 1, 0) if abs(T[i][1]) < 0.9 else V(1, 0, 0)
            F[i] = alt - np.dot(alt, T[i]) * T[i]
    F /= np.linalg.norm(F, axis=1)[:, None]
    S = np.cross(T, F)
    return np.stack([P[i] + S[i] * secs[i][:, :1] + F[i] * secs[i][:, 1:2] for i in range(m)])


def transported_refs(P, i0, f0):
    """Repère à rotation minimale : la corde vaut f0 à l'indice i0 puis est transportée le long de P
    (évite les vrilles quand la tangente tourne, ex. cintre : ailes → cintre rond → bas de cintre)."""
    P = np.asarray(P, dtype=float)
    T = np.zeros_like(P)
    T[1:-1] = P[2:] - P[:-2]
    T[0] = P[1] - P[0]
    T[-1] = P[-1] - P[-2]
    T /= np.linalg.norm(T, axis=1)[:, None]
    F = np.zeros_like(P)
    F[i0] = nrm(f0 - np.dot(f0, T[i0]) * T[i0])
    for rng, step in ((range(i0 + 1, len(P)), -1), (range(i0 - 1, -1, -1), 1)):
        for i in rng:
            prev = F[i + step]
            F[i] = nrm(prev - np.dot(prev, T[i]) * T[i])
    return F


def skin(mb, R, mat, i0=0, i1=None, cap0=True, cap1=True):
    """Peau quadrangulée entre les anneaux i0..i1 (+ bouchons)."""
    i1 = len(R) - 1 if i1 is None else i1
    sub = R[i0:i1 + 1]
    m, n, _ = sub.shape
    verts = [p for p in sub.reshape(-1, 3)]
    faces = []
    for i in range(m - 1):
        for k in range(n):
            a = i * n + k
            b = i * n + (k + 1) % n
            faces.append((a, b, b + n, a + n))
    if cap0:
        c = len(verts)
        verts.append(sub[0].mean(0))
        faces += [(c, (k + 1) % n, k) for k in range(n)]
    if cap1:
        c = len(verts)
        verts.append(sub[-1].mean(0))
        base = (m - 1) * n
        faces += [(c, base + k, base + (k + 1) % n) for k in range(n)]
    mb.add(verts, faces, mat)


def tube(mb, ctrl, per, sec_fn, ref, mat, cap=True):
    """Tube à section variable : sec_fn(t ∈ [0, 1]) → section (n, 2) ; ref : vecteur ou ref(t)."""
    P = catmull(ctrl, per) if per > 1 else np.asarray(ctrl, dtype=float)
    L = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))])
    t = L / L[-1]
    secs = [sec_fn(tt) for tt in t]
    refs = np.array([ref(tt) for tt in t]) if callable(ref) else ref
    R = sweep_rings(P, secs, refs)
    skin(mb, R, mat, cap0=cap, cap1=cap)
    return R


def lerp(a, b, t):
    return a + (b - a) * t


def lathe_m(profile, segmats, n, phase=0.0):
    """Révolution autour de x (profil fermé [(rayon, x)]) avec un matériau par segment de profil."""
    m = len(profile)
    verts = []
    for k in range(n):
        ph = 2 * math.pi * k / n + phase
        for r, x in profile:
            verts.append([x, r * math.cos(ph), r * math.sin(ph)])
    faces, mats = [], []
    for k in range(n):
        k2 = (k + 1) % n
        for j in range(m):
            j2 = (j + 1) % m
            faces.append((k * m + j, k * m + j2, k2 * m + j2, k2 * m + j))
            mats.append(segmats[j])
    return verts, faces, mats


def add_m(mb, verts, faces, mats):
    """Ajoute une géométrie (repère client) avec un matériau par face."""
    off = len(mb.v)
    mb.v.extend(to_bl(p) for p in verts)
    mb.f.extend(tuple(i + off for i in f) for f in faces)
    mb.fm.extend(mats)


# ---------------------------------------------------------------------------------------------
# Familles de vélos, roues, pièces (tools/blender/bike_families.py, exécuté ici)
# ---------------------------------------------------------------------------------------------
_HERE = os.path.dirname(os.path.abspath(__file__)) if '__file__' in globals() else os.path.dirname(os.path.abspath(sys.argv[sys.argv.index('--python') + 1]))
exec(compile(open(os.path.join(_HERE, 'bike_families.py'), encoding='utf-8').read(), os.path.join(_HERE, 'bike_families.py'), 'exec'), globals())
REPO = os.path.abspath(os.path.join(_HERE, '..', '..'))


# ---------------------------------------------------------------------------------------------
# Export / rendu
# ---------------------------------------------------------------------------------------------
def with_children(objs):
    out = []
    seen = set()

    def rec(o):
        if o.name in seen:
            return
        seen.add(o.name)
        out.append(o)
        for c in o.children:
            rec(c)
    for o in objs:
        rec(o)
    return out


def export_glb(objs, path):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    sel = with_children(objs)
    for o in sel:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_animations=False,
        export_skins=True,
        export_morph=True,
        export_morph_normal=True,
        export_materials='EXPORT',
        export_normals=True,
        export_texcoords=False,
        export_vertex_color='NAME',
        export_vertex_color_name='zone',
        export_all_vertex_colors=False,
        export_active_vertex_color_when_no_material=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_draco_mesh_compression_enable=False,
    )
    for o in sel:
        o.select_set(False)


def tris_of(objs):
    return sum(tri_count(o) for o in with_children(objs) if o.type == 'MESH')


def setup_preview_scene():
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x = 1600
    sc.render.resolution_y = 1000
    sc.render.film_transparent = False
    try:
        sc.eevee.taa_render_samples = 48
    except AttributeError:
        pass
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.55, 0.68, 0.85, 1)
    bg.inputs['Strength'].default_value = 0.9
    sc.world = world
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 3.5
    sun.angle = math.radians(3)
    so = bpy.data.objects.new('sun', sun)
    sc.collection.objects.link(so)
    so.rotation_euler = (math.radians(50), 0, math.radians(-35))
    gm = bpy.data.materials.new('ground')
    gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.32, 0.33, 0.3, 1)
    gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
    me = bpy.data.meshes.new('ground')
    me.from_pydata([(-20, -20, 0), (20, -20, 0), (20, 20, 0), (-20, 20, 0)], [], [(0, 1, 2, 3)])
    me.materials.append(gm)
    go = bpy.data.objects.new('ground', me)
    sc.collection.objects.link(go)
    cam = bpy.data.cameras.new('cam')
    co = bpy.data.objects.new('cam', cam)
    sc.collection.objects.link(co)
    sc.camera = co
    tm = bpy.data.materials.new('label')
    tm.use_nodes = True
    tm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.02, 0.02, 0.03, 1)
    MATS['_label'] = tm
    return co, go


def render_view(co, pos, target, lens, path, res=None):
    sc = bpy.context.scene
    if res:
        sc.render.resolution_x, sc.render.resolution_y = res
    co.location = Vector(to_bl(pos))
    d = Vector(to_bl(target)) - co.location
    co.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    co.data.lens = lens
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def add_label(text, pos, size=0.06):
    """Texte face à la caméra de profil (côté transmission, x < 0)."""
    cu = bpy.data.curves.new('label', 'FONT')
    cu.body = text
    cu.size = size
    cu.align_x = 'CENTER'
    ob = bpy.data.objects.new('label', cu)
    bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(MATS['_label'])
    from mathutils import Matrix
    m = Matrix(((0, 0, -1), (-1, 0, 0), (0, 1, 0)))
    ob.rotation_euler = m.to_euler()
    ob.location = Vector(to_bl(pos))
    return ob


def place_wheels(g, wheels, brakes):
    objs = []
    for typ, front in ((wheels[0], True), (wheels[1], False)):
        w, rot = build_wheel_lib(typ, front, 0)
        w.location = Vector(to_bl(g.fa if front else REAR_AXLE))
        if front and g.wheel_scale_f != 1.0:
            w.scale = (g.wheel_scale_f,) * 3
        rot.hide_render = brakes != 'disc'
        objs += [w, rot]
    return objs


def set_bike_options(objs, brakes='disc', track=False, toeclips=False):
    for o in with_children(objs):
        n = o.name
        if n.startswith('opt_brakes_disc'):
            o.hide_render = brakes != 'disc'
        elif n.startswith('opt_brakes_rim'):
            o.hide_render = brakes != 'rim'
        elif n.startswith('opt_derailleur') or n.startswith('opt_bottles'):
            o.hide_render = track
        elif n.startswith('opt_toeclips'):
            o.hide_render = not toeclips


SIDE_VIEW = (V(-3.1, 0.6, 0.1), V(0, 0.56, 0.1), 50)


def render_bike_side(co, objs, g, wheels, brakes, path, label=None, track=False, toeclips=False, res=(1200, 750)):
    set_bike_options(objs, brakes, track, toeclips)
    ws = place_wheels(g, wheels, brakes)
    lab = add_label(label, V(0, 1.12, 0.1)) if label else None
    pos, tgt, lens = SIDE_VIEW
    render_view(co, pos, tgt, lens, path, res)
    for o in ws:
        remove_obj(o)
    if lab:
        cu = lab.data
        bpy.data.objects.remove(lab)
        bpy.data.curves.remove(cu)


def compose_sheet(paths, cols, out):
    imgs = [bpy.data.images.load(p) for p in paths]
    w, h = imgs[0].size
    rows = (len(imgs) + cols - 1) // cols
    sheet = np.ones((rows * h, cols * w, 4), dtype=np.float32)
    sheet[..., :3] = 0.92
    for i, im in enumerate(imgs):
        px = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)
        rr = rows - 1 - i // cols  # pixels Blender : origine en bas
        c = i % cols
        sheet[rr * h:(rr + 1) * h, c * w:(c + 1) * w] = px
    out_im = bpy.data.images.new('sheet', cols * w, rows * h, alpha=True)
    out_im.pixels.foreach_set(sheet.ravel())
    out_im.filepath_raw = out
    out_im.file_format = 'PNG'
    out_im.save()
    for im in imgs:
        bpy.data.images.remove(im)
    bpy.data.images.remove(out_im)


def swap_names(a, b):
    """Échange les noms (objets et données) de deux listes parallèles d'objets."""
    for x, y in zip(a, b):
        nx, ny = x.name, y.name
        x.name = '__tmp__'
        y.name = nx
        x.name = ny
        if x.type == 'MESH' and y.type == 'MESH':
            dx, dy = x.data.name, y.data.name
            x.data.name = '__tmpd__'
            y.data.name = dx
            x.data.name = dy


LIVERY_SHEET = ['s26-04-', 's26-01-', 's26-14-', 'myth-bianchi-specialissima-acier', 'myth-peugeot-px10', 'myth-lotus-110',
                's26-06-', 'myth-look-kg86', 'myth-specialized-tarmac-sl7', 'myth-pinarello-espada', 'myth-giant-tcr-compact', 'myth-colnago-c40-mapei']


# ---------------------------------------------------------------------------------------------
# Programme principal
# ---------------------------------------------------------------------------------------------
def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    make_materials()
    r = build_rig()
    stats = {}
    only = args.only
    preview = not args.no_preview
    shots = os.path.abspath(os.path.dirname(args.preview))
    os.makedirs(shots, exist_ok=True)
    bout = os.path.join(OUT, 'bikes')
    os.makedirs(bout, exist_ok=True)
    co = None
    if preview:
        co, ground = setup_preview_scene()

    # --- Cycliste (LOD0 + LOD1, casques route et chrono)
    rider0, rider1, ao = [], [], None
    if only in ('', 'rider'):
        mb, prims = body_primitives(r)
        raw = mb.build('body_raw')
        remesh_union(raw, 0.0045, 12, 0.5)
        print('body remesh tris', tri_count(raw))
        ao = build_armature(r)
        body0 = finalize_body(r, raw, 'rider_body', LOD0_BODY_TRIS, prims)
        body1 = finalize_body(r, raw, 'rider_body_lod1', int(LOD0_BODY_TRIS * 0.2), prims)
        remove_obj(raw)
        hair = build_hair(r)
        helmet = build_helmet(r)
        aero = build_rider_aero_helmet(r)
        glasses = build_glasses(r)
        shoes = build_shoes(r)
        acc0 = [hair, helmet, aero, glasses, shoes]
        acc1 = []
        for o, tgt in ((hair, 160), (helmet, 400), (aero, 360), (glasses, 120), (shoes, 240)):
            c = copy_object(o, o.name + '_lod1')
            decimate_to(c, tgt)
            acc1.append(c)
        for o in acc0 + acc1:
            if o.name.startswith('rider_shoes'):
                rigid_weights(o, lambda p: 'foot_L' if p[0] > 0 else 'foot_R')
            else:
                rigid_weights(o, lambda p: 'head')
        for o in [body0, body1] + acc0 + acc1:
            skin_to(o, ao)
        rider0 = [ao, body0] + acc0
        rider1 = [ao, body1] + acc1
        stats['cyclist'] = tris_of(rider0) - tri_count(aero)
        stats['cyclist_aero_helmet'] = tri_count(aero)
        stats['cyclist_lod1'] = tris_of(rider1)
        stats['cyclist_parts'] = {o.name: tri_count(o) for o in rider0 if o.type == 'MESH'}
        export_glb(rider0, os.path.join(OUT, 'cyclist.glb'))
        swap_names(rider0[1:], rider1[1:])
        export_glb(rider1, os.path.join(OUT, 'cyclist_lod1.glb'))
        swap_names(rider0[1:], rider1[1:])
        for o in rider1[1:]:
            o.hide_render = True
        for o in rider0[1:]:
            o.hide_render = True

    if only == 'rider':
        print('STATS ' + json.dumps(stats))
        return

    with open(os.path.join(REPO, 'packages', 'shared', 'src', 'bikes.json'), encoding='utf-8') as f:
        catalog = json.load(f)['bikes']

    # --- Bibliothèque de roues
    for lod in (0, 1):
        ws = []
        st = {}
        for typ in WHEEL_TYPES:
            for front in (True, False):
                w, rot = build_wheel_lib(typ, front, lod)
                ws.append(w)
                st[w.name] = tri_count(w) + tri_count(rot)
        export_glb(ws, os.path.join(bout, 'wheels.glb' if lod == 0 else 'wheels_lod1.glb'))
        stats['wheels' if lod == 0 else 'wheels_lod1'] = st
        for w in ws:
            for c in list(w.children):
                remove_obj(c)
            remove_obj(w)

    # --- Bibliothèque de pièces
    for lod in (0, 1):
        ps = build_parts_lib(lod)
        stats['parts' if lod == 0 else 'parts_lod1'] = {o.name: tri_count(o) for o in ps}
        export_glb(ps, os.path.join(bout, 'parts.glb' if lod == 0 else 'parts_lod1.glb'))
        for o in ps:
            remove_obj(o)

    # --- Familles
    anchors = {}
    fam_shots = []
    liv_shots = {}
    rider_done = False
    for fam in FAMILIES:
        objs, info, g = build_family(fam, 0)
        anchors[fam] = info
        stats[fam] = tris_of(objs)
        stats[fam + '_parts'] = {o.name: tri_count(o) for o in with_children(objs) if o.type == 'MESH'}
        export_glb(objs, os.path.join(bout, f'{fam}.glb'))
        if preview:
            defw = {'tt': ['c65', 'disc'], 'lowpro': ['tri', 'disc'], 'lotus': ['tri', 'disc'], 'steel': ['box', 'box'],
                    'retro': ['box', 'box'], 'retro_compact': ['box', 'box']}.get(fam, ['c50', 'c50'])
            brakes = 'disc' if fam in ('aero', 'climb', 'tt') else 'rim'
            p = os.path.join(shots, f'bikes-family-{fam}.png')
            render_bike_side(co, objs, g, defw, brakes, p, label=fam, toeclips=(fam == 'steel'))
            fam_shots.append(p)
            ws = place_wheels(g, defw, brakes)
            render_view(co, V(1.5, 1.35, 1.55), V(0, 0.68, 0.18), 40, os.path.join(shots, f'bikes-family-{fam}-3q.png'), (1200, 750))
            for o in ws:
                remove_obj(o)
            fr = next(o for o in objs if o.name == 'frame')
            slot = [i for i, m in enumerate(fr.data.materials) if m.name == 'frame'][0]
            base_mat = fr.data.materials[slot]
            for key in LIVERY_SHEET:
                b = next((x for x in catalog if x['id'].startswith(key)), None)
                if not b or b['family'] != fam:
                    continue
                mat = livery_material(b['livery'], 'liv_' + b['id'])
                fr.data.materials[slot] = mat
                pr = b['params']
                p = os.path.join(shots, f"bikes-livery-{b['id']}.png")
                render_bike_side(co, objs, g, pr['wheels'], pr['brakes'], p, label=b['name'], track=pr.get('track', False), toeclips=pr.get('toeClips', False))
                liv_shots[key] = p
                # Coureur sur le vélo (deux vues).
                if rider0 and key in ('s26-04-', 'myth-peugeot-px10'):
                    for o in rider0[1:]:
                        o.hide_render = o.name.startswith('rider_helmet_aero')
                    set_bike_options(objs, pr['brakes'], False, pr.get('toeClips', False))
                    ws = place_wheels(g, pr['wheels'], pr['brakes'])
                    tag = 'aero' if key == 's26-04-' else 'steel'
                    render_view(co, V(2.3, 1.4, 2.4), V(0, 0.85, 0.08), 35, os.path.join(shots, f'bikes-rider-{tag}-3q.png'), (1600, 1000))
                    render_view(co, V(-3.6, 0.85, 0.1), V(0, 0.8, 0.08), 40, os.path.join(shots, f'bikes-rider-{tag}-side.png'), (1600, 1000))
                    if tag == 'aero':
                        render_view(co, V(0.8, 1.05, 0.95), V(0.18, 0.88, 0.6), 45, os.path.join(shots, 'bikes-rider-cockpit-hand.png'), (1600, 1000))
                        for o in rider0[1:]:
                            o.hide_render = o.name.startswith('rider_helmet') and not o.name.startswith('rider_helmet_aero')
                        render_view(co, V(0.75, 1.55, 0.9), V(0, 1.42, 0.2), 60, os.path.join(shots, 'bikes-rider-aero-helmet.png'), (1600, 1000))
                    for o in ws:
                        remove_obj(o)
                    for o in rider0[1:]:
                        o.hide_render = True
                fr.data.materials[slot] = base_mat
        for o in with_children(objs):
            remove_obj(o) if o.type == 'MESH' else bpy.data.objects.remove(o)
        objs1, _, _ = build_family(fam, 1)
        stats[fam + '_lod1'] = tris_of(objs1)
        export_glb(objs1, os.path.join(bout, f'{fam}_lod1.glb'))
        for o in with_children(objs1):
            remove_obj(o) if o.type == 'MESH' else bpy.data.objects.remove(o)
    if preview:
        compose_sheet(fam_shots, 3, os.path.join(shots, 'bikes-contact-sheet.png'))
        order = [liv_shots[k] for k in LIVERY_SHEET if k in liv_shots]
        compose_sheet(order, 4, os.path.join(shots, 'bikes-liveries.png'))
    if args.blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.blend))
    stats['anchors'] = anchors
    os.makedirs(os.path.join(REPO, 'out'), exist_ok=True)
    stats['bones'] = r.bone_names
    with open(os.path.join(REPO, 'out', 'bike_stats.json'), 'w', encoding='utf-8') as f:
        json.dump(stats, f, indent=1)
    print('STATS ' + json.dumps(stats))


main()
