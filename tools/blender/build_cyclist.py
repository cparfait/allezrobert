"""
Allez Robert ! — génération procédurale du cycliste (riggé) et du vélo de route.

Usage (depuis la racine du dépôt) :
    blender -b --factory-startup --python tools/blender/build_cyclist.py -- --out apps/client/public/models/

Options :
    --preview docs/screenshots/avatar-preview.png   rendu Eevee de contrôle (+ variantes -side, -front, -head, -lod1)
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
ap.add_argument('--preview', default='docs/screenshots/avatar-preview.png')
ap.add_argument('--no-preview', action='store_true')
ap.add_argument('--blend', default='')
ap.add_argument('--views', default='3q,side,front,head,back,lod1')
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

LOD0_BODY_TRIS = 7200
LOD1_RATIO = 0.25


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
    me.name = ob.name
    if old.users == 0:
        bpy.data.meshes.remove(old)


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def decimate_to(ob, target):
    tris = tri_count(ob)
    if tris <= target:
        return
    m = ob.modifiers.new('dec', 'DECIMATE')
    m.decimate_type = 'COLLAPSE'
    m.ratio = target / tris
    m.use_collapse_triangulate = True
    apply_modifiers(ob)


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
    'rim': ('#1e2024', 0.3, 0.2),
    'chrome': ('#b9bcc2', 0.2, 1.0),
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
        (-0.115, 0.07, 0.045, -0.035),
        (-0.085, 0.125, 0.075, -0.035),
        (-0.035, 0.162, 0.105, -0.025),
        (0.03, 0.172, 0.118, -0.012),
        (0.10, 0.158, 0.112, 0.0),
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
    add(loft(npts, [0.07, 0.057, 0.051, 0.046], [0.075, 0.06, 0.054, 0.048], r.f, n=16),
        'neck', [(seg[1] / seg[-1], 'chest'), (seg[2] / seg[-1], 'neck'), (1.0, 'head')])

    # Tête (repère tête : x latéral, uh haut, fh avant).
    H = r.H
    hx = (r.xh, r.uh, r.fh)
    add(ellipsoid(H(0, 0.0, -0.005), hx, (0.077, 0.098, 0.102), 24, 14), 'head', [(1.0, 'head')])
    add(ellipsoid(H(0, -0.064, 0.026), hx, (0.06, 0.058, 0.07), 20, 12), 'head', [(1.0, 'head')])
    add(ellipsoid(H(0, -0.11, 0.068), hx, (0.026, 0.022, 0.025), 12, 8), 'head', [(1.0, 'head')])
    add(ellipsoid(H(0, 0.022, 0.084), hx, (0.058, 0.014, 0.02), 16, 8), 'head', [(1.0, 'head')])
    add(ellipsoid(H(0, -0.079, 0.087), hx, (0.021, 0.009, 0.011), 12, 8), 'head', [(1.0, 'head')])
    for s in (1, -1):
        add(ellipsoid(H(0.042 * s, -0.03, 0.066), hx, (0.024, 0.02, 0.022), 12, 8), 'head', [(1.0, 'head')])
        add(ellipsoid(H(0.076 * s, -0.028, -0.008), hx, (0.011, 0.03, 0.019), 12, 8), 'head', [(1.0, 'head')])
    nose = [H(0, 0.008, 0.087), H(0, -0.018, 0.102), H(0, -0.04, 0.111), H(0, -0.05, 0.103)]
    add(loft(nose, [0.008, 0.010, 0.012, 0.014], [0.006, 0.009, 0.011, 0.007], r.fh, n=10), 'head', [(1.0, 'head')])

    for tag, d in r.side.items():
        s = d.s
        # Cuisse.
        ts = [-0.10, 0.0, 0.25, 0.55, 0.8, 0.95, 1.06]
        rxs = [0.06, 0.085, 0.083, 0.072, 0.058, 0.05, 0.04]
        rys = [0.06, 0.085, 0.083, 0.07, 0.056, 0.05, 0.04]
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
            q = (vc - p['c']) @ p['R'].T / p['radii']
            sd = (np.linalg.norm(q, axis=1) - 1.0) * p['radii'].min()
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
T_WAIST = 0.07
T_STRIPE = (0.30, 0.355)
SLEEVE = (0.47, 0.55)
SHORTS_HEM = 0.78
SOCK_H = 0.13


def body_cuts(r):
    cuts = []
    cuts.append(({'torso'}, r.C(T_WAIST), r.u, None))
    cuts.append(({'torso'}, r.C(T_STRIPE[0]), r.u, None))
    cuts.append(({'torso'}, r.C(T_STRIPE[1]), r.u, None))
    ncol = r.N0 + r.nd * 0.012

    def near_neck(c):
        v = c - r.N0
        return np.linalg.norm(v - r.nd * np.dot(v, r.nd)) < 0.085

    cuts.append(({'torso', 'neck'}, ncol, r.nd, near_neck))
    for tag, d in r.side.items():
        cuts.append(({f'thigh_{tag}'}, d.hip + d.thigh_d * THIGH * SHORTS_HEM, d.thigh_d, None))
        cuts.append(({f'shin_{tag}'}, d.ankle - d.shin_d * SOCK_H, d.shin_d, None))
        cuts.append(({f'upper_arm_{tag}'}, d.shoulder + d.upper_d * UPPER * SLEEVE[0], d.upper_d, None))
        cuts.append(({f'upper_arm_{tag}'}, d.shoulder + d.upper_d * UPPER * SLEEVE[1], d.upper_d, None))
    return cuts


def face_material(r, region, c):
    if region in ('torso', 'neck'):
        v = c - r.N0
        if np.dot(v, r.nd) > 0.012 and np.linalg.norm(v - r.nd * np.dot(v, r.nd)) < 0.085:
            return 'skin'
        if region == 'neck':
            return 'jersey'
        t = np.dot(c - r.H0, r.u)
        if t < T_WAIST:
            return 'shorts'
        if T_STRIPE[0] < t < T_STRIPE[1]:
            return 'jersey_accent'
        return 'jersey'
    if region == 'head' or region.startswith('hand') or region.startswith('forearm'):
        return 'skin'
    tag = region[-1]
    d = r.side[tag]
    if region.startswith('thigh'):
        return 'shorts' if np.dot(c - d.hip, d.thigh_d) / THIGH < SHORTS_HEM else 'skin'
    if region.startswith('shin'):
        return 'sock' if np.dot(c - d.ankle, d.shin_d) > -SOCK_H else 'skin'
    if region.startswith('upper_arm'):
        p = np.dot(c - d.shoulder, d.upper_d) / UPPER
        if p < SLEEVE[0]:
            return 'jersey'
        if p < SLEEVE[1]:
            return 'jersey_accent'
        return 'skin'
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
    decimate_to(ob, target_tris)
    me = ob.data
    # Coupes nettes aux ourlets (maillot, cuissard, manches, chaussettes, bande d'accent, col).
    bm = bmesh.new()
    bm.from_mesh(me)
    for regs, co, no, cond in body_cuts(r):
        bm.verts.ensure_lookup_table()
        vc = to_client_arr(np.array([v.co[:] for v in bm.verts]))
        regions, _ = label_vertices(vc, prims)
        sel = []
        for f in bm.faces:
            rr = [regions[v.index] for v in f.verts]
            reg = max(set(rr), key=rr.count)
            if reg in regs:
                c = np.mean([vc[v.index] for v in f.verts], axis=0)
                if cond is None or cond(c):
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
    v, f, _ = ellipsoid(H(0, 0.0, -0.005), (r.xh, r.uh, r.fh), (0.083, 0.104, 0.108), 28, 16)
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
    cen = H(0, 0.028, -0.012)
    rad = (0.099, 0.104, 0.136)
    mb = MB()
    v, f, _ = ellipsoid(cen, hx, rad, 36, 18)
    # Queue effilée vers l'arrière.
    vv = []
    for p in v:
        p = np.array(p)
        q = p - cen
        fw = np.dot(q, r.fh)
        up = np.dot(q, r.uh)
        k = float(smoothstep(-0.06, -0.136, fw))
        p = p - r.fh * 0.02 * k - r.uh * 0.01 * k * float(up < 0.02)
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
    for xx, fw in ((0.03, 0.065), (-0.03, 0.065), (0.032, -0.015), (-0.032, -0.015), (0.068, 0.03), (-0.068, 0.03),
                   (0.062, -0.055), (-0.062, -0.055), (0.0, 0.02), (0.03, -0.085), (-0.03, -0.085)):
        q = 1 - (xx / rad[0]) ** 2 - ((fw + 0.0) / rad[2]) ** 2
        up = rad[1] * math.sqrt(max(q, 0.05))
        p = cen + r.xh * xx + r.uh * up + r.fh * fw
        n = nrm(r.xh * xx / rad[0] ** 2 + r.uh * up / rad[1] ** 2 + r.fh * fw / rad[2] ** 2)
        lat = nrm(r.xh - n * np.dot(r.xh, n))
        ln = np.cross(n, lat)
        vv, ff, _ = ellipsoid(p, (lat, n, ln), (0.0105, 0.045, 0.03), 12, 8)
        cm.add(vv, ff, 'helmet_detail')
    cut = cm.build('helmet_cutter')
    bo = ob.modifiers.new('vents', 'BOOLEAN')
    bo.operation = 'DIFFERENCE'
    bo.solver = 'EXACT'
    bo.object = cut
    apply_modifiers(ob)
    bpy.data.objects.remove(cut)
    decimate_to(ob, 1500)
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
            pth = catmull([start, H(0.07 * s, -0.075, -0.004), H(0.032 * s, -0.122, 0.05), H(0.0, -0.128, 0.052)], 3)
            v2, f2, _ = loft(pth, 0.0075, 0.0018, r.xh * s, n=6)
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
        bpy.data.objects.remove(o)
    new = mb.build(name, recalc=False)
    shade(new, 50)
    return new


def build_glasses(r):
    H = r.H
    mb = MB()
    nphi = 26
    phis = np.linspace(-math.radians(80), math.radians(80), nphi)
    rows = 5
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
    v, f, _ = loft(top, 0.0045, 0.003, r.uh, n=8)
    fb.add(v, f, 'glasses_frame')
    for s in (1, -1):
        ph = math.radians(80) * s
        st = H(math.sin(ph) * 0.087, 0.008, math.cos(ph) * 0.12 - 0.006)
        pth = catmull([st, H(0.085 * s, 0.006, -0.02), H(0.081 * s, -0.006, -0.065)], 3)
        v, f, _ = loft(pth, 0.006, 0.0022, r.xh * s, n=6)
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
        v, f, _ = loft(pth, resample(hw, 2), resample(ry, 2), rotx(V(0, 1, 0), REST_PITCH), n=14, expo=2.8)
        mb.add(v, f, 'shoe')
        # Semelle rigide.
        sp = catmull([T(V(0, 0.0125, z)) for z in zs[:-1]] + [T(V(0, 0.018, zs[-1] - 0.002))], 2)
        v, f, _ = loft(sp, resample([w + 0.002 for w in hw[:-1]] + [hw[-1]], 2), 0.0048, rotx(V(0, 1, 0), REST_PITCH), n=10, expo=4)
        mb.add(v, f, 'shoe_sole')
        # Cale.
        v, f = box(T(V(0, 0.0105, 0.005)), (0.026, 0.004, 0.032), (V(1, 0, 0), rotx(V(0, 1, 0), REST_PITCH), rotx(V(0, 0, 1), REST_PITCH)))
        mb.add(v, f, 'components')
        # Molette de serrage.
        dial = T(V(0.0, 0.101, -0.07))
        v, f, _ = loft([dial - rotx(V(0, 0.006, 0), REST_PITCH), dial + rotx(V(0, 0.006, 0), REST_PITCH)], 0.014, 0.014, V(1, 0, 0), n=10)
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
# Vélo
# ---------------------------------------------------------------------------------------------
class Bike:
    pass


def bike_geometry():
    g = Bike()
    g.st_dir = nrm(SADDLE - BB)
    g.st_top = BB + g.st_dir * 0.52
    a = math.radians(73)
    g.ht_up = V(0, math.sin(a), -math.cos(a))
    g.pf = V(0, math.cos(a), math.sin(a))
    A = FRONT_AXLE - g.pf * 0.045
    s_bot = (0.655 - A[1]) / g.ht_up[1]
    g.ht_bot = A + g.ht_up * s_bot
    g.ht_top = g.ht_bot + g.ht_up * 0.17
    g.steer_top = g.ht_top + g.ht_up * 0.03
    g.bar = V(0, 0.865, 0.505)
    return g


def build_frame(g, voxel=0.0025, target=2600):
    mb = MB()
    X = V(1, 0, 0)

    def tube(pts, rin, rlat, n=14, per=1):
        if per > 1:
            P = catmull(pts, per)
            rin = resample(rin, per) if np.ndim(rin) else rin
            rlat = resample(rlat, per) if np.ndim(rlat) else rlat
        else:
            P = pts
        v, f, _ = loft(P, rin, rlat, X, n=n)
        mb.add(v, f, 'frame')

    st = g.st_dir
    tube([BB - st * 0.02, g.st_top + st * 0.03], [0.018, 0.016], [0.015, 0.0145])
    tube([g.st_top - st * 0.025, g.ht_top - g.ht_up * 0.025], [0.02, 0.019], [0.016, 0.0155])
    tube([BB + V(0, 0.0, 0.0), g.ht_bot + g.ht_up * 0.03], [0.026, 0.024], [0.022, 0.021])
    tube([g.ht_bot - g.ht_up * 0.012, g.ht_top + g.ht_up * 0.008], [0.024, 0.02], [0.024, 0.02])
    # Boîtier de pédalier (cylindre transversal).
    v, f, _ = loft([BB + V(0.043, 0, 0), BB - V(0.043, 0, 0)], 0.021, 0.021, V(0, 1, 0), n=16)
    mb.add(v, f, 'frame')
    for s in (1, -1):
        drop = REAR_AXLE + V(0.064 * s, 0, 0)
        tube([BB + V(0.035 * s, 0.0, -0.02), BB + V(0.05 * s, 0.01, -0.2), drop + V(0, -0.002, 0.012)], [0.013, 0.011, 0.008], [0.01, 0.009, 0.007], n=10, per=3)
        tube([g.st_top - st * 0.09 + V(0.012 * s, 0, 0), drop + V(0, 0.012, 0.004)], [0.009, 0.007], [0.008, 0.006], n=10)
        # Pattes arrière.
        v, f, _ = loft([drop + V(0, -0.012, 0.02), drop + V(0, 0.012, -0.004)], 0.012, 0.004, X, n=10)
        mb.add(v, f, 'frame')
        # Fourche.
        fdrop = FRONT_AXLE + V(0.05 * s, 0, 0)
        crown = g.ht_bot - g.ht_up * 0.03 + V(0.03 * s, 0, 0)
        mid = g.ht_bot - g.ht_up * 0.2 + V(0.048 * s, 0, 0) + g.pf * 0.004
        tube([crown, mid, fdrop + V(0, 0.01, 0.0)], [0.02, 0.016, 0.01], [0.012, 0.011, 0.008], n=10, per=4)
    v, f, _ = loft([g.ht_bot - g.ht_up * 0.03 + V(0.045, 0, 0), g.ht_bot - g.ht_up * 0.03 - V(0.045, 0, 0)], 0.026, 0.02, g.ht_up, n=12)
    mb.add(v, f, 'frame')
    ob = mb.build('frame_union')
    remesh_union(ob, voxel, 4, 0.5)
    decimate_to(ob, target)
    shade(ob)
    return ob


def build_bike_parts(g, lod=0):
    """Pièces fixes (non fusionnées) : cockpit, selle, transmission, freins."""
    mb = MB()
    X = V(1, 0, 0)
    n = 10 if lod == 0 else 6
    # Jeu de direction, entretoises, pivot.
    v, f, _ = loft([g.ht_top - g.ht_up * 0.005, g.steer_top + g.ht_up * 0.008], 0.017, 0.017, g.pf, n=n)
    mb.add(v, f, 'components')
    # Potence.
    v, f, _ = loft([g.steer_top - g.pf * 0.012, g.bar], [0.02, 0.017], [0.017, 0.016], X, n=n)
    mb.add(v, f, 'components')
    # Cintre (courbe complète).
    half = [V(0.0, 0.865, 0.505), V(0.08, 0.865, 0.505), V(0.15, 0.866, 0.507), V(0.185, 0.868, 0.52), V(0.198, 0.872, 0.55),
            V(0.2, 0.874, 0.585), V(0.2, 0.868, 0.612), V(0.2, 0.845, 0.632), V(0.2, 0.81, 0.635), V(0.2, 0.775, 0.618),
            V(0.2, 0.752, 0.585), V(0.2, 0.745, 0.545), V(0.2, 0.745, 0.49)]
    other = [p * V(-1, 1, 1) for p in half[1:]]
    full = list(reversed(other)) + half
    per = 3 if lod == 0 else 1
    pth = catmull(full, per)
    v, f, _ = loft(pth, 0.0125, 0.0125, V(0, 1, 0.3), n=8 if lod == 0 else 5)
    mb.add(v, f, 'components')
    for s in (1, -1):
        # Cocotte (corps de levier) + lame de frein.
        hood = catmull([V(0.2 * s, 0.888, 0.562), V(0.2 * s, 0.896, 0.6), V(0.2 * s, 0.906, 0.626), V(0.2 * s, 0.917, 0.638), V(0.2 * s, 0.911, 0.648)], 2 if lod == 0 else 1)
        v, f, _ = loft(hood, resample([0.016, 0.018, 0.017, 0.012, 0.008], 2 if lod == 0 else 1), resample([0.02, 0.02, 0.018, 0.011, 0.006], 2 if lod == 0 else 1), V(0, 1, 0), n=n)
        mb.add(v, f, 'components')
        if lod == 0:
            lever = catmull([V(0.2 * s, 0.892, 0.645), V(0.2 * s, 0.85, 0.656), V(0.2 * s, 0.8, 0.653), V(0.2 * s, 0.77, 0.641)], 2)
            v, f, _ = loft(lever, 0.0055, 0.009, V(0, 0, 1), n=6)
            mb.add(v, f, 'chrome')
    # Selle.
    S = [(-0.335, 0.045, 0.952, 0.935), (-0.325, 0.066, 0.958, 0.93), (-0.29, 0.07, 0.96, 0.928), (-0.245, 0.06, 0.957, 0.928),
         (-0.19, 0.04, 0.953, 0.93), (-0.14, 0.024, 0.952, 0.932), (-0.09, 0.02, 0.953, 0.934), (-0.062, 0.012, 0.95, 0.937)]
    sp = catmull([V(0, (s[2] + s[3]) / 2, s[0]) for s in S], 2 if lod == 0 else 1)
    k = 2 if lod == 0 else 1
    v, f, _ = loft(sp, resample([s[1] for s in S], k), resample([(s[2] - s[3]) / 2 for s in S], k), V(0, 1, 0), n=16 if lod == 0 else 8, expo=3.0)
    mb.add(v, f, 'components')
    # Tige de selle + chariot + rails.
    sp_top = BB + g.st_dir * ((0.915 - BB[1]) / g.st_dir[1])
    v, f, _ = loft([g.st_top - g.st_dir * 0.02, sp_top], 0.0136, 0.0136, X, n=n)
    mb.add(v, f, 'components')
    if lod == 0:
        v, f = box(sp_top + V(0, 0.005, 0), (0.024, 0.008, 0.02))
        mb.add(v, f, 'components')
        for s in (1, -1):
            rail = catmull([V(0.03 * s, 0.933, -0.31), V(0.034 * s, 0.914, -0.25), V(0.033 * s, 0.914, -0.15), V(0.016 * s, 0.934, -0.085)], 2)
            v, f, _ = loft(rail, 0.0035, 0.0035, V(0, 1, 0), n=6)
            mb.add(v, f, 'chrome')
    # Transmission : chaîne, dérailleur arrière (fixes).
    if lod == 0:
        R1 = 0.102
        ring = [V(-0.044, BB[1] + R1 * math.sin(a), R1 * math.cos(a)) for a in np.linspace(math.pi / 2, -math.pi / 2, 12)]
        LP = V(-0.044, 0.235, -0.39)
        UP = V(-0.044, 0.29, -0.405)
        chain = ring + [LP + V(0, -0.018, 0.0), LP + V(0, 0.0, -0.018), UP + V(0, 0.0, 0.016), UP + V(0, 0.016, -0.005),
                        V(-0.044, REAR_AXLE[1] - 0.012, -0.452), V(-0.044, REAR_AXLE[1] + 0.03, -0.44), V(-0.044, REAR_AXLE[1] + 0.04, -0.41)]
        chain = chain + [ring[0]]
        cp = catmull(chain, 2)
        v, f, _ = loft(cp, 0.0045, 0.0035, X, n=4, cap=True)
        mb.add(v, f, 'chrome')
        for c in (LP, UP):
            v, f, _ = loft([c + V(0.004, 0, 0), c - V(0.004, 0, 0)], 0.017, 0.017, V(0, 1, 0), n=10)
            mb.add(v, f, 'components')
        cage = [UP + V(-0.008, 0.01, 0.005), LP + V(-0.008, -0.01, 0.0)]
        v, f, _ = loft(cage, 0.015, 0.003, X, n=6)
        mb.add(v, f, 'components')
        body = [REAR_AXLE + V(-0.068, -0.012, 0.005), UP + V(-0.012, 0.012, -0.01)]
        v, f, _ = loft(body, 0.012, 0.01, X, n=8)
        mb.add(v, f, 'components')
        # Étriers de frein à disque (côté gauche, x > 0).
        v, f = box(FRONT_AXLE + V(0.062, 0.07, -0.035), (0.012, 0.03, 0.018), (V(1, 0, 0), nrm(V(0, 1, -0.6)), nrm(V(0, 0.6, 1))))
        mb.add(v, f, 'components')
        v, f = box(REAR_AXLE + V(0.075, 0.055, 0.05), (0.012, 0.018, 0.03), (V(1, 0, 0), nrm(V(0, 1, 0.5)), nrm(V(0, -0.5, 1))))
        mb.add(v, f, 'components')
        # Bidon et porte-bidon sur le tube diagonal.
        dt = nrm(g.ht_bot - BB)
        nb = nrm(np.cross(dt, X))
        if nb[1] < 0:
            nb = -nb
        b0 = BB + dt * 0.14 + nb * 0.06
        bottle = [b0 + dt * t for t in (0.0, 0.01, 0.06, 0.15, 0.17, 0.185, 0.2)]
        v, f, _ = loft(bottle, [0.02, 0.035, 0.036, 0.036, 0.03, 0.012, 0.01], [0.02, 0.035, 0.036, 0.036, 0.03, 0.012, 0.01], X, n=12)
        mb.add(v, f, 'components')
    ob = mb.build('parts')
    return ob


def build_wheel(name, axle, front, lod=0):
    mb = MB()
    n = 40 if lod == 0 else 20
    tire = [(0.3225 + 0.0125 * math.cos(a), 0.0125 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 9)[:-1]]
    v, f = lathe(tire, n)
    mb.add(v, f, 'tire')
    rim = [(0.312, 0.0125), (0.30, 0.0142), (0.285, 0.0136), (0.272, 0.0105), (0.266, 0.005), (0.264, 0.0),
           (0.266, -0.005), (0.272, -0.0105), (0.285, -0.0136), (0.30, -0.0142), (0.312, -0.0125)]
    if lod:
        rim = rim[::2]
    v, f = lathe(rim, n)
    mb.add(v, f, 'rim')
    hub = [(0.008, 0.062), (0.016, 0.055), (0.03, 0.03), (0.017, 0.026), (0.017, -0.026), (0.03, -0.03), (0.016, -0.055), (0.008, -0.062)]
    v, f = lathe(hub, 16 if lod == 0 else 8, closed=True)
    mb.add(v, f, 'components')
    if lod == 0:
        ns = 20 if front else 24
        for k in range(ns):
            a = 2 * math.pi * (k + 0.5) / ns
            sx = 0.028 if k % 2 else -0.028
            a2 = a + (0.12 if k % 2 else -0.12)
            p0 = V(sx, 0.028 * math.cos(a2), 0.028 * math.sin(a2))
            p1 = V(0.0, 0.266 * math.cos(a), 0.266 * math.sin(a))
            v, f, _ = loft([p0, p1], 0.0012, 0.0012, V(1, 0, 0) if abs(math.cos(a)) < 0.7 else V(0, 0, 1), n=3, cap=False)
            mb.add(v, f, 'chrome')
        # Disque de frein (gauche) et cassette (droite, roue arrière).
        rr = 0.08 if front else 0.07
        disc = [(0.05, 0.051), (rr, 0.051), (rr, 0.049), (0.05, 0.049)]
        v, f = lathe(disc, 32)
        mb.add(v, f, 'chrome')
        if not front:
            cas = []
            radii = [0.05, 0.046, 0.042, 0.038, 0.034, 0.031, 0.028, 0.025]
            for i, rc in enumerate(radii):
                x = -0.034 - i * 0.0038
                cas += [(rc, x), (rc, x - 0.0022), (rc - 0.006, x - 0.0022)]
            cas = [(0.012, -0.03)] + cas + [(0.012, cas[-1][1])]
            v, f = lathe(cas, 24, closed=True)
            mb.add(v, f, 'chrome')
    # Coordonnées locales (origine = axe) → objet placé à l'axe.
    ob = mb.build(name)
    ob.location = Vector(to_bl(axle))
    shade(ob, 40)
    return ob


def build_crankset(lod=0):
    mb = MB()
    n = 36 if lod == 0 else 16
    # Plateau dentelé (grand) et petit plateau.
    if lod == 0:
        teeth = 36
        pts_o = []
        for k in range(teeth * 2):
            a = math.pi * k / teeth
            r = 0.104 if k % 2 == 0 else 0.099
            pts_o.append((r, a))
        verts = []
        faces = []
        nn = len(pts_o)
        for x in (-0.043, -0.047):
            for r, a in pts_o:
                verts.append(V(x, r * math.cos(a), r * math.sin(a)))
            for r, a in pts_o:
                verts.append(V(x, 0.086 * math.cos(a), 0.086 * math.sin(a)))
        for k in range(nn):
            k2 = (k + 1) % nn
            o0, i0, o1, i1 = 0, nn, 2 * nn, 3 * nn
            faces.append((o0 + k, o0 + k2, i0 + k2, i0 + k))
            faces.append((o1 + k, i1 + k, i1 + k2, o1 + k2))
            faces.append((o0 + k, o1 + k, o1 + k2, o0 + k2))
            faces.append((i0 + k, i0 + k2, i1 + k2, i1 + k))
        mb.add([p.tolist() for p in verts], faces, 'chrome')
    else:
        v, f = lathe([(0.086, -0.043), (0.103, -0.043), (0.103, -0.047), (0.086, -0.047)], n)
        mb.add(v, f, 'chrome')
    v, f = lathe([(0.068, -0.037), (0.08, -0.037), (0.08, -0.04), (0.068, -0.04)], n)
    mb.add(v, f, 'components')
    # Araignée.
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        d = V(0, math.cos(a), math.sin(a))
        v, f, _ = loft([V(-0.045, 0, 0) + d * 0.015, V(-0.045, 0, 0) + d * 0.09], [0.012, 0.007], 0.004, V(1, 0, 0), n=6)
        mb.add(v, f, 'components')
    # Axe et manivelles (gauche vers le bas, droite vers le haut : angle 0).
    v, f, _ = loft([V(0.07, 0, 0), V(-0.07, 0, 0)], 0.012, 0.012, V(0, 1, 0), n=12 if lod == 0 else 6)
    mb.add(v, f, 'chrome')
    for s in (1, -1):
        dy = -1.0 if s > 0 else 1.0
        arm = [V(0.06 * s, 0, 0), V(0.066 * s, dy * CRANK * 0.5, 0), V(PEDAL_AXIS_X * s - 0.004 * s, dy * CRANK, 0)]
        v, f, _ = loft(arm, [0.019, 0.013, 0.012], [0.011, 0.009, 0.008], V(1, 0, 0), n=10 if lod == 0 else 6, expo=2.6)
        mb.add(v, f, 'components')
    ob = mb.build('crankset')
    ob.location = Vector(to_bl(BB))
    shade(ob, 40)
    return ob


def build_pedal(tag, lod=0):
    s = 1 if tag == 'L' else -1
    mb = MB()
    # Origine = bout de manivelle (axe de pédale) ; corps centré à PEDAL_X.
    off = (PEDAL_X - PEDAL_AXIS_X) * s
    v, f, _ = loft([V(0, 0, 0), V(off + 0.02 * s, 0, 0)], 0.0055, 0.0055, V(0, 1, 0), n=8 if lod == 0 else 4)
    mb.add(v, f, 'chrome')
    pts = [V(off, 0, -0.036), V(off, 0, -0.02), V(off, 0, 0.02), V(off, 0, 0.05), V(off, 0, 0.058)]
    v, f, _ = loft(pts, [0.024, 0.032, 0.036, 0.03, 0.02], [0.008, 0.01, 0.01, 0.008, 0.006], V(0, 1, 0), n=10 if lod == 0 else 6, expo=2.6)
    mb.add(v, f, 'components')
    ob = mb.build(f'pedal_{tag}')
    ang = 0.0 if s > 0 else math.pi
    ob.location = Vector(to_bl(V(PEDAL_AXIS_X * s, BB[1] - math.cos(ang) * CRANK, -math.sin(ang) * CRANK)))
    # Pédale automatique : solidaire de la chaussure → même inclinaison que le pied au repos.
    ob.rotation_euler = (REST_PITCH, 0, 0)
    shade(ob, 40)
    return ob


def build_bike(lod=0):
    g = bike_geometry()
    frame = build_frame(g, 0.0025 if lod == 0 else 0.004, 2600 if lod == 0 else 650)
    parts = build_bike_parts(g, lod)
    vs, fs, ms = mesh_arrays(frame)
    mb = MB()
    mb.add_bl(vs, fs, ms)
    vs, fs, ms = mesh_arrays(parts)
    mb.add_bl(vs, fs, ms)
    bpy.data.objects.remove(frame)
    bpy.data.objects.remove(parts)
    fr = mb.build('frame', recalc=False)
    shade(fr, 50)
    objs = [fr,
            build_wheel('wheel_rear', REAR_AXLE, False, lod),
            build_wheel('wheel_front', FRONT_AXLE, True, lod),
            build_crankset(lod),
            build_pedal('L', lod),
            build_pedal('R', lod)]
    return objs


# ---------------------------------------------------------------------------------------------
# Export / rendu
# ---------------------------------------------------------------------------------------------
def export_glb(objs, path):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
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
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_draco_mesh_compression_enable=False,
    )
    for o in objs:
        o.select_set(False)


def tris_of(objs):
    return sum(tri_count(o) for o in objs if o.type == 'MESH')


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
    return co, go


def render_view(co, pos, target, lens, path):
    co.location = Vector(to_bl(pos))
    d = Vector(to_bl(target)) - co.location
    co.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    co.data.lens = lens
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


# ---------------------------------------------------------------------------------------------
# Programme principal
# ---------------------------------------------------------------------------------------------
def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    make_materials()
    r = build_rig()
    stats = {}

    # --- Cycliste
    mb, prims = body_primitives(r)
    raw = mb.build('body_raw')
    remesh_union(raw, 0.0045, 12, 0.5)
    print('body remesh tris', tri_count(raw))
    ao = build_armature(r)
    body0 = finalize_body(r, raw, 'rider_body', LOD0_BODY_TRIS, prims)
    body1 = finalize_body(r, raw, 'rider_body_lod1', int(LOD0_BODY_TRIS * LOD1_RATIO), prims)
    bpy.data.objects.remove(raw)

    hair = build_hair(r)
    helmet = build_helmet(r)
    glasses = build_glasses(r)
    shoes = build_shoes(r)
    acc0 = [hair, helmet, glasses, shoes]
    acc1 = []
    for o, tgt in ((hair, 160), (helmet, 400), (glasses, 120), (shoes, 240)):
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
    stats['cyclist'] = tris_of(rider0)
    stats['cyclist_lod1'] = tris_of(rider1)
    stats['cyclist_parts'] = {o.name: tri_count(o) for o in rider0 if o.type == 'MESH'}

    # --- Vélo
    bike0 = build_bike(0)
    stats['bike'] = tris_of(bike0)
    stats['bike_parts'] = {o.name: tri_count(o) for o in bike0}

    export_glb(rider0, os.path.join(OUT, 'cyclist.glb'))
    export_glb(bike0, os.path.join(OUT, 'bike.glb'))

    # Rendu de contrôle (LOD0).
    if not args.no_preview:
        prev = os.path.abspath(args.preview)
        os.makedirs(os.path.dirname(prev), exist_ok=True)
        base, ext = os.path.splitext(prev)
        for o in rider1:
            if o is not ao:
                o.hide_render = True
        co, ground = setup_preview_scene()
        views = args.views.split(',')
        if '3q' in views:
            render_view(co, V(2.0, 1.25, 2.1), V(0, 0.78, 0.08), 40, prev)
        if 'side' in views:
            render_view(co, V(3.6, 0.85, 0.1), V(0, 0.8, 0.08), 40, base + '-side' + ext)
        if 'front' in views:
            render_view(co, V(0.7, 1.25, 3.4), V(0, 0.9, 0.2), 45, base + '-front' + ext)
        if 'head' in views:
            render_view(co, V(0.55, 1.62, 1.05), V(0, 1.5, 0.27), 70, base + '-head' + ext)
        if 'back' in views:
            render_view(co, V(-1.6, 1.7, -2.4), V(0, 0.9, 0.0), 40, base + '-back' + ext)
        for o in rider1:
            o.hide_render = False

    # --- LOD1 : on retire le LOD0 et on reprend les mêmes noms d'objets.
    for o in [body0] + acc0 + bike0:
        bpy.data.objects.remove(o)
    for o in [body1] + acc1:
        o.name = o.name.replace('_lod1', '')
        o.data.name = o.name
    bike1 = build_bike(1)
    stats['bike_lod1'] = tris_of(bike1)
    export_glb(rider1, os.path.join(OUT, 'cyclist_lod1.glb'))
    export_glb(bike1, os.path.join(OUT, 'bike_lod1.glb'))
    if not args.no_preview and 'lod1' in args.views.split(','):
        base, ext = os.path.splitext(os.path.abspath(args.preview))
        render_view(bpy.context.scene.camera, V(2.0, 1.25, 2.1), V(0, 0.78, 0.08), 40, base + '-lod1' + ext)
    if args.blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.blend))
    stats['bones'] = r.bone_names
    print('STATS ' + json.dumps(stats))


main()
