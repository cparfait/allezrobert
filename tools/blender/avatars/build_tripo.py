"""
Allez Robert ! — coureur généré avec Tripo (gen_tripo_body.py : texte → 3D, auto-rig « unreal »).

Source : rigged.fbx de zzModel3D/tripo_body/<nom>/ (hors dépôt). Un seul maillage, une seule texture
(couleur + normales, 2048 px) et un squelette aux noms Unreal, déjà ceux du squelette « game_engine »
que le client pilote (gltfAvatar.ts). La pose de conduite, les os refaits, les niveaux de détail et
l'export sont ceux du modèle acheté (build_boutique.py, importé comme module) ; ce script ajoute :

  - orientation : Tripo regarde +X, remis vers −Y (repère Blender des scripts du projet) ;
  - os en trop fusionnés dans leur voisin (poids additionnés, enfants rattachés) : root → bassin,
    spine_04 et spine_05 → spine_03, neck_02 → neck_01, métacarpes → main, deuxièmes os de
    torsion → premiers ;
  - taille calculée pour le vélo (genou à KNEE_BOTTOM degrés en bas du coup de pédale), pivot des
    hanches du rig gardé ;
  - pièces : chaque face classée d'après la couleur de sa texture (gris clair du maillot, noir,
    peau) et l'os qui la porte (tête, tronc, bras, cuisse, jambe), lissée sur ses voisines, puis
    rangée dans un matériau « tex_head », « tex_jersey », « tex_shorts », « tex_arms » ou
    « tex_legs » : les noms que le client recolore (texturedLook.ts). Un seul objet, plusieurs
    matériaux qui partagent l'atlas : normales continues aux bords des pièces ;
  - jersey_mask.webp (R : gris du maillot, B : détail du tissu), recolor_ref du maillot et des
    chaussures, COLOR_0 (maillot : hauteur sur le torse et torse/manche ; jambes : chaussure).

Usage (depuis la racine du dépôt) :
    blender -b --factory-startup --disable-autoexec --python tools/blender/avatars/build_tripo.py -- \\
        [--src zzModel3D/tripo_body/corps_a/rigged.fbx] [--out apps/client/public/models/avatar/tripo/] [--no-compress]
"""

import math
import os
import subprocess
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True  # pas de __pycache__ dans le dépôt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_boutique as bb  # noqa: E402  (pose de conduite, os, niveaux de détail, export)

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
import argparse  # noqa: E402
ap = argparse.ArgumentParser()
ap.add_argument('--src', default='zzModel3D/tripo_body/corps_a/rigged.fbx')
ap.add_argument('--out', default='apps/client/public/models/avatar/tripo/')
ap.add_argument('--no-compress', action='store_true')
# Position (pose_relaxed) : portée épaule → poignet en fraction de la longueur du bras (le buste se
# relève jusqu'à l'obtenir), avancée et élévation des épaules (°), direction des coudes (repère client).
ap.add_argument('--reach', type=float, default=0.95)
# Recul des hanches sur la selle (m, repère client) par rapport à la cote de référence du vélo ;
# −0,04 : assis 4 cm plus en avant, buste relevé de ≈ 4° (cintre du vélo de course bas et loin).
ap.add_argument('--seat-back', type=float, default=-0.04)
ap.add_argument('--shoulders', default='4,-5')
ap.add_argument('--elbow', default='0.34,1.0,0.15')
args, _ = ap.parse_known_args(argv)
OUT = bb.OUT = os.path.abspath(args.out)
os.makedirs(OUT, exist_ok=True)
# Hanches sur la selle : la cote de référence (HIP_REF), à peine reculée. build_boutique.py les recule
# de 9 cm (fessier de son modèle très en arrière) : mains 72 cm devant les hanches, buste couché. Le
# modèle de la galerie (référence visuelle) les a 65 cm devant.
bb.HIP = bb.HIP_REF + Vector((0.0, 0.0, -args.seat_back))

EXTRA = {'root': 'pelvis', 'spine_04': 'spine_03', 'spine_05': 'spine_03', 'neck_02': 'neck_01'}
for _s in ('l', 'r'):
    for _f in ('thumb', 'index', 'middle', 'ring', 'pinky'):
        EXTRA[f'{_f}_metacarpal_{_s}'] = f'hand_{_s}'
    for _t in ('upperarm', 'lowerarm', 'thigh', 'calf'):
        EXTRA[f'{_t}_twist_02_{_s}'] = f'{_t}_twist_01_{_s}'

# Matériau → (rugosité, métal).
MATS = {'tex_head': 0.55, 'tex_jersey': 0.7, 'tex_shorts': 0.45, 'tex_arms': 0.55, 'tex_legs': 0.6}
PART_ORDER = list(MATS)

# Proportions du haut du corps : le modèle Tripo a les épaules larges, de grandes mains (0,13 de la
# taille, 0,11 chez l'humain) et des bras courts (épaule → poignet ≈ 0,26 de la taille, 0,33 chez
# l'humain), son envergure reste celle d'un humain. Allonger les bras seuls donnait des bras de
# gorille : épaules resserrées, mains réduites et bras allongés modérément, ensemble.
SHOULDER_NARROW = 0.06                    # épaules resserrées (fraction de la largeur, build_boutique)
# Bras proches de l'anatomie (≈ 0,186 et 0,146 de la taille) : plus courts (0,160 + 0,130), ils ne
# rejoignaient les cocottes qu'avec un buste couché à ≈ 20° au lieu des ≈ 40° de la référence.
ARM_UPPER = 0.178                         # épaule → coude / taille
ARM_FORE = 0.146                          # coude → poignet / taille
HAND_SCALE = 0.86                         # main et doigts, autour du poignet
# Hanches : le rig Tripo met le pivot des cuisses à la ceinture (≈ 0,075 de la taille au-dessus de
# l'entrejambe) ; cuisse levée, le cuissard gonflait en ballon. Articulation ramenée à HIP_ABOVE_CROTCH.
HIP_ABOVE_CROTCH = 0.05                   # fraction de la taille (≈ 9 cm)
# Poids du bas du corps refaits (fondus en mètres, pose debout), comme build_boutique.py : bassin →
# cuisse autour de l'articulation de la hanche, cuisse → jambe autour du genou, gauche ↔ droite à
# l'entrejambe. Le maillot ne suit plus les cuisses.
HIP_FADE = (0.07, 0.11)
KNEE_FADE = 0.06
CROTCH_FADE = 0.03
# Lissage correctif à la cuisson de la pose (volume des hanches et des genoux pliés).
SMOOTH_ITER = 12
# Dos d'après le modèle de la galerie (coureur et vélo d'un bloc, vu de profil) : bassin droit posé
# sur la selle, dos droit du bassin aux omoplates puis arrondi en haut, épaules un peu avancées.
# Bassin : élévation fixe (90 = debout), peu basculé (basculé de toute l'inclinaison du buste, il
# sortait les fesses en arrière et creusait les reins). Vertèbres : écarts à l'inclinaison du buste,
# du bas vers le haut, décroissants (dos rond, jamais creusé) : la flexion est répartie sur toutes
# les vertèbres pour effacer la cambrure du modèle debout (concentrée sur une seule, la cambrure
# restait figée dans le bas du dos).
PELVIS_DEG = 66.0
SPINE_SHAPE = {'spine_01': 12.0, 'spine_02': 3.0, 'spine_03': -8.0}
# Colonne : le rig Tripo tasse ses vertèbres dans 15 cm à la taille (0,545 → 0,623 de la taille),
# contre la peau du dos, et une seule porte toute la poitrine : le buste pivotait autour d'un point
# du bas du dos, le ventre reculait derrière les cuisses. Vertèbres réparties de la taille aux
# omoplates (hauteurs en fraction de la taille, pose debout), placées à SPINE_DEPTH de la profondeur
# du tronc depuis le dos ; poids de la peau refaits par tranches, fondus de SPINE_FADE.
SPINE_Z = {'spine_01': 0.580, 'spine_02': 0.640, 'spine_03': 0.705}
SPINE_DEPTH = 0.30
SPINE_FADE = 0.022
NECK_DEG = 60.0
HEAD_PITCH = 6.0
# Mains sur les cocottes, comme le client les pose (gltfAvatar.ts, HOOD_PALM) : milieu de la paume sur
# le dessus de la cocotte, main pointée vers le bec, dos de la main incliné vers l'extérieur (pouce
# relevé, paume vers le bas et l'intérieur), doigts refermés sur le côté. Le client garde
# l'orientation de repos de la main : c'est elle qu'on voit en roulant.
HOOD_PALM = Vector((0.2, 0.9, 0.565))
HOOD_TIP = Vector((0.2, 0.905, 0.665))
HAND_TILT = 38.0                          # dos de la main : inclinaison vers l'extérieur (°)
TWIST_SHARE = 0.5                         # part de la rotation de la main reprise par l'avant-bras


def import_rig():
    bpy.ops.import_scene.fbx(filepath=os.path.abspath(args.src), use_custom_normals=False, use_anim=False)
    rig = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
    mesh = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
    m = mesh.matrix_world.copy()
    mesh.parent = None
    mesh.matrix_world = m
    # Tripo regarde +X : quart de tour vers −Y.
    for o in (rig, mesh):
        o.matrix_world = Matrix.Rotation(-math.pi / 2, 4, 'Z') @ o.matrix_world
    bb.set_active(rig)
    mesh.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bones = rig.data.bones
    hand, foot, ball = bones['hand_l'].head_local, bones['foot_l'].head_local, bones['ball_l'].head_local
    if hand.x < 0.1 or ball.y > foot.y:
        raise SystemExit(f'orientation inattendue : main gauche {tuple(hand)}, pied {tuple(foot)} → orteils {tuple(ball)}')
    top = max(v.co.z for v in mesh.data.vertices)
    bottom = min(v.co.z for v in mesh.data.vertices)
    knee, ankle = bones['calf_l'].head_local, bones['foot_l'].head_local
    # Entrejambe : bas de la coupe pleine du bassin sur l'axe (tranches de 5 mm) ; plus bas, les
    # faces internes des cuisses, très proches, frôlent l'axe sans le traverser.
    hh = top - bottom
    mid = [c for c in (v.co for v in mesh.data.vertices) if abs(c.x) < 0.015 and bottom + 0.3 * hh < c.z < bottom + 0.6 * hh]
    crotch = None
    for k in range(60, 120):
        zl = bottom + k * 0.005 * hh
        sl = [c.y for c in mid if zl <= c.z < zl + 0.005 * hh]
        if sl and max(sl) - min(sl) > 0.06 * hh:
            crotch = zl
            break
    if crotch is None:
        raise SystemExit('entrejambe introuvable')
    hip_z = crotch + HIP_ABOVE_CROTCH * (top - bottom)
    print(f'hanche : pivot du rig à {(bones["thigh_l"].head_local.z - bottom) / (top - bottom):.3f}, entrejambe à {(crotch - bottom) / (top - bottom):.3f}, '
          f'articulation ramenée à {(hip_z - bottom) / (top - bottom):.3f} de la taille')
    hip = Vector((bones['thigh_l'].head_local.x, knee.y, hip_z))
    a, b = (knee - hip).length, (ankle - knee).length
    # Hanche (selle) → cheville, pédale en bas : distance fixée par le vélo.
    d = (bb.bl(bb.HIP_REF) - bb.bl(bb.ankle_target('l')[0])).length
    f = d / math.sqrt(a * a + b * b - 2 * a * b * math.cos(math.radians(bb.KNEE_BOTTOM)))
    for o in (rig, mesh):
        o.scale = (f, f, f)
    bb.set_active(rig)
    mesh.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    # Pieds au sol.
    dz = -bottom * f
    for o in (rig, mesh):
        o.location.z += dz
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    bb.HIP_Z = hip_z * f + dz
    height = (top - bottom) * f
    print(f'taille : {height:.3f} m (×{f:.3f}) ; cuisse {100 * a * f:.0f} cm, tibia {100 * b * f:.0f} cm, hanche à {100 * bb.HIP_Z:.0f} cm')
    mesh.parent = rig
    mod = next((md for md in mesh.modifiers if md.type == 'ARMATURE'), None) or mesh.modifiers.new('Armature', 'ARMATURE')
    mod.object = rig
    return rig, mesh, height


def merge_extra_bones(rig, mesh):
    groups = {g.name: g for g in mesh.vertex_groups}
    for src, dst in EXTRA.items():
        g = groups.get(src)
        if g is None:
            continue
        tgt = groups.get(dst) or mesh.vertex_groups.new(name=dst)
        groups[dst] = tgt
        for v in mesh.data.vertices:
            for ge in v.groups:
                if ge.group == g.index and ge.weight > 0:
                    tgt.add([v.index], ge.weight, 'ADD')
        mesh.vertex_groups.remove(g)
        del groups[src]
    bb.set_active(rig)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = rig.data.edit_bones
    for src, dst in EXTRA.items():
        if src not in eb:
            continue
        for c in list(eb[src].children):
            c.use_connect = False
            c.parent = None if c.name == dst else eb[dst]
        eb.remove(eb[src])
    bpy.ops.object.mode_set(mode='OBJECT')
    left = sorted(set(b.name for b in rig.data.bones) - set(bb.BONE_MAP.values()))
    missing = sorted(set(bb.BONE_MAP.values()) - set(b.name for b in rig.data.bones))
    if left or missing:
        raise SystemExit(f'os inattendus : {left} ; manquants : {missing}')
    bb.set_active(mesh)
    bpy.ops.object.vertex_group_clean(group_select_mode='ALL', limit=1e-4)
    bpy.ops.object.vertex_group_limit_total(group_select_mode='BONE_DEFORM', limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='BONE_DEFORM', lock_active=False)
    print(f'squelette : {len(rig.data.bones)} os')


def lengthen_arms(rig, mesh, height):
    """Bras et avant-bras allongés le long de l'axe épaule → poignet (pose en T) : sommets étirés
    entre l'épaule et le coude puis entre le coude et le poignet (épaule, coude et poignet gardent
    leur forme), main et doigts déplacés d'un bloc ; os de même."""
    bones = rig.data.bones
    arms = {}
    for sd in ('l', 'r'):
        S, E, W = (bones[f'{n}_{sd}'].head_local.copy() for n in ('upperarm', 'lowerarm', 'hand'))
        d = (W - S).normalized()
        arms[sd] = (S, d, (E - S).dot(d), (W - S).dot(d), ARM_UPPER * height - (E - S).length, ARM_FORE * height - (W - E).length)
        print(f'bras {sd} : {100 * (E - S).length:.0f} + {100 * (W - E).length:.0f} cm → {100 * ARM_UPPER * height:.0f} + {100 * ARM_FORE * height:.0f} cm')

    def ramp(t, a, b):
        return min(1.0, max(0.0, (t - a) / (b - a)))

    def moved(co):
        S, d, te, tw, du, df = arms['l' if co.x > 0 else 'r']
        rel = co - S
        t = rel.dot(d)
        if t <= 0 or (rel - d * t).length > 0.15:
            return co
        out = co + d * (du * ramp(t, 0.03, te - 0.025) + df * ramp(t, te + 0.025, tw - 0.03))
        if t > tw - 0.015:
            wn = S + d * (tw + du + df)  # poignet déplacé
            out = wn + (out - wn) * (1 - (1 - HAND_SCALE) * ramp(t, tw - 0.015, tw + 0.01))
        return out

    for v in mesh.data.vertices:
        v.co = moved(v.co)
    bb.set_active(rig)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = rig.data.edit_bones
    for b in eb:
        b.use_connect = False
    new = {b.name: (moved(b.head.copy()), moved(b.tail.copy())) for b in eb
           if b.name.startswith(('upperarm', 'lowerarm', 'hand', 'thumb', 'index', 'middle', 'ring', 'pinky'))}
    for n, (h, t) in new.items():
        eb[n].head, eb[n].tail = h, t
    bpy.ops.object.mode_set(mode='OBJECT')


def pose_relaxed(rig):
    """Pose de conduite détendue, posée sur les points de contact du vélo du jeu (selle, cocottes,
    pédales : cotes de build_boutique.py, identiques au client) : hanches sur la selle, buste relevé
    jusqu'à ce que l'épaule soit à --reach de la longueur du bras du poignet posé sur la cocotte,
    dos presque droit, épaules basses, tête qui regarde la route ; bras et jambes en IK."""
    protract, raise_ = (float(x) for x in args.shoulders.split(','))
    elbow_pole = Vector(tuple(float(x) for x in args.elbow.split(',')))
    bl, cl = bb.bl, bb.cl
    bb.set_active(rig)
    bpy.ops.object.mode_set(mode='POSE')
    pb = rig.pose.bones
    for b in pb:
        b.rotation_mode = 'QUATERNION'

    def world(name):
        bpy.context.view_layer.update()
        return rig.matrix_world @ pb[name].head

    hip_bl = bl(bb.HIP)
    pel = pb['pelvis']
    spine = ('pelvis', 'spine_01', 'spine_02', 'spine_03')
    head_rest = pb['head'].matrix.to_3x3().normalized()

    def aim(name, deg):
        bpy.context.view_layer.update()
        b = pb[name]
        d = b.tail - b.head
        r = Matrix.Rotation(-math.radians(deg - math.degrees(math.atan2(d.z, -d.y))), 4, 'X')
        b.matrix = Matrix.Translation(b.head) @ r @ Matrix.Translation(-b.head) @ b.matrix
        bpy.context.view_layer.update()

    def torso(lean):
        for n in spine + ('neck_01', 'head', 'clavicle_l', 'clavicle_r'):
            pb[n].matrix_basis = Matrix.Identity(4)
        bpy.context.view_layer.update()
        aim('pelvis', PELVIS_DEG)
        for n in spine[1:]:
            aim(n, lean + SPINE_SHAPE[n])
        mid = (pb['thigh_l'].head + pb['thigh_r'].head) / 2
        pel.matrix = Matrix.Translation(hip_bl - mid) @ pel.matrix
        bpy.context.view_layer.update()
        for side, sg in (('l', 1), ('r', -1)):
            c = pb['clavicle_' + side]
            r = Matrix.Rotation(-math.radians(protract) * sg, 4, 'Z') @ Matrix.Rotation(-math.radians(raise_) * sg, 4, 'Y')
            c.matrix = Matrix.Translation(c.head) @ r @ Matrix.Translation(-c.head) @ c.matrix
            bpy.context.view_layer.update()
        aim('neck_01', NECK_DEG)
        h = pb['head']
        h.matrix = Matrix.Translation(h.head) @ (Matrix.Rotation(math.radians(HEAD_PITCH), 3, 'X') @ head_rest).to_4x4()
        bpy.context.view_layer.update()

    arm_len = rig.data.bones['upperarm_l'].length + rig.data.bones['lowerarm_l'].length
    H = bb.HOOD
    # Poignet estimé derrière la paume posée sur la cocotte (recalé ensuite sur la paume réelle).
    wrist = {s: bl(Vector((HOOD_PALM.x * (1 if s == 'l' else -1), HOOD_PALM.y + 0.03, HOOD_PALM.z - 0.055))) for s in ('l', 'r')}
    best = None
    for k in range(10, 75):
        torso(k)
        err = abs((world('upperarm_l') - wrist['l']).length - args.reach * arm_len)
        if best is None or err < best[0]:
            best = (err, k)
    torso(best[1])
    print(f'buste : {best[1]} degrés au-dessus de l\'horizontale, portée à {100 * best[0]:.1f} cm près (bras {100 * arm_len:.0f} cm)')

    for s in ('l', 'r'):
        # Les deux pieds sur leur pédale en bas (BIND_PHASE = 0 du client, jambes en miroir) : aucune
        # jambe cuite en flexion maximale ; le client reconnaît les pieds à la même hauteur.
        ank, pedal = bb.ankle_target('l')
        if s == 'r':
            ank, pedal = Vector((-ank.x, ank.y, ank.z)), Vector((-pedal.x, pedal.y, pedal.z))
        c = pb['calf_' + s].constraints.new('IK')
        c.target = bb.empty('ik_ankle_' + s, ank)
        c.pole_target = bb.empty('pole_knee_' + s, Vector((ank.x * 1.15, 0.75, 0.45)))
        c.chain_count = 2
        best_pa, best_z = 0.0, -1e9
        for pa in range(-180, 181, 15):
            c.pole_angle = math.radians(pa)
            knee = cl(world('calf_' + s))
            score = knee.z - abs(knee.x - ank.x) * 2
            if score > best_z:
                best_pa, best_z = pa, score
        c.pole_angle = math.radians(best_pa)
        dt = pb['foot_' + s].constraints.new('DAMPED_TRACK')
        dt.target = bb.empty('pedal_' + s, pedal + Vector((0, bb.SOLE, 0.012)))
        dt.track_axis = 'TRACK_Y'
    for s in ('l', 'r'):
        sg = 1 if s == 'l' else -1
        fa = pb['lowerarm_' + s]
        fa.lock_ik_x = fa.lock_ik_y = True
        fa.rotation_quaternion = Matrix.Rotation(math.radians(-20 * sg), 4, 'Z').to_quaternion()
        c = fa.constraints.new('IK')
        c.target = bb.empty('ik_wrist_' + s, cl(wrist[s]))
        c.chain_count = 2
        pole = Vector((elbow_pole.x * sg, elbow_pole.y, elbow_pole.z))
        c.pole_target = bb.empty('pole_elbow_' + s, pole)
        best_pa, best_d = 0.0, 1e9
        for pa in range(-180, 181, 10):
            c.pole_angle = math.radians(pa)
            d = (cl(world('lowerarm_' + s)) - pole).length
            if d < best_d:
                best_pa, best_d = pa, d
        c.pole_angle = math.radians(best_pa)
        dt = pb['hand_' + s].constraints.new('DAMPED_TRACK')
        dt.target = bb.empty('hood_' + s, Vector((HOOD_TIP.x * sg, HOOD_TIP.y, HOOD_TIP.z)))
        dt.track_axis = 'TRACK_Y'
        for f in ('index', 'middle', 'ring', 'pinky'):
            for j, ang in ((1, 40), (2, 60), (3, 40)):
                pb[f'{f}_0{j}_{s}'].rotation_quaternion = Matrix.Rotation(math.radians(ang), 4, 'X').to_quaternion()
    # Paume sur la cocotte (milieu poignet → base du majeur, comme le client) et dos de la main incliné.
    from mathutils import Quaternion
    for s in ('l', 'r'):
        sg = 1 if s == 'l' else -1
        target = Vector((HOOD_PALM.x * sg, HOOD_PALM.y, HOOD_PALM.z))
        ik = bpy.data.objects['ik_wrist_' + s]
        hand, twist = pb['hand_' + s], pb['lowerarm_twist_01_' + s]
        total = 0.0
        for _ in range(6):
            bpy.context.view_layer.update()
            palm = cl((world('hand_' + s) + world('middle_01_' + s)) / 2)
            ik.location = ik.location + bl(target - palm)
            bpy.context.view_layer.update()
            m = (rig.matrix_world @ hand.matrix).to_3x3().normalized()
            y, z = m.col[1], m.col[2]
            want = bl(Vector((math.sin(math.radians(HAND_TILT)) * sg, math.cos(math.radians(HAND_TILT)), 0.0)))
            want = (want - y * want.dot(y)).normalized()
            ang = math.atan2(z.cross(want).dot(y), z.dot(want))
            total += ang
            hand.rotation_quaternion = Quaternion((0, 1, 0), ang) @ hand.rotation_quaternion
        twist.rotation_quaternion = Quaternion((0, 1, 0), total * TWIST_SHARE)
        bpy.context.view_layer.update()
        palm = cl((world('hand_' + s) + world('middle_01_' + s)) / 2)
        print(f'main {s} : paume à {100 * (palm - target).length:.1f} cm de la cocotte, tournée de {math.degrees(total):.0f} degrés')
    bpy.context.view_layer.update()
    sh, el, wr = world('upperarm_l'), world('lowerarm_l'), world('hand_l')
    hip_, knee_, ank_ = world('thigh_l'), world('calf_l'), world('foot_l')
    print(f'coude : {math.degrees((sh - el).angle(wr - el)):.0f} degrés ; genou en bas : {math.degrees((hip_ - knee_).angle(ank_ - knee_)):.0f} degrés (180 = tendu)')
    bpy.ops.object.mode_set(mode='OBJECT')


def base_images(mesh):
    mat = mesh.material_slots[0].material
    imgs = {}
    for n in mat.node_tree.nodes:
        if n.type != 'TEX_IMAGE' or not n.image:
            continue
        nm = n.image.name.lower()
        imgs['Normal' if 'normal' in nm else 'Base Color'] = n.image
    imgs['Base Color'].colorspace_settings.name = 'sRGB'
    if 'Normal' in imgs:
        imgs['Normal'].colorspace_settings.name = 'Non-Color'
    return imgs


def region_of(name):
    if name in ('head', 'neck_01'):
        return 'head'
    if name.startswith(('upperarm', 'lowerarm', 'hand', 'thumb', 'index', 'middle', 'ring', 'pinky')):
        return 'arm'
    if name.startswith('thigh'):
        return 'thigh'
    if name.startswith(('calf', 'foot', 'ball')):
        return 'leg'
    return 'torso'


def classify(mesh, rig, im):
    """Pièce de chaque face : couleur de la texture (échantillons sur la face) × région de l'os
    dominant, puis lissage (vote des faces voisines)."""
    me = mesh.data
    rgb = bb.image_array(im)
    H, W = rgb.shape[:2]
    uv = me.uv_layers.active.data
    nf = len(me.polygons)
    col = np.zeros((nf, 3), np.float32)
    for p in me.polygons:
        uvs = [Vector(uv[li].uv) for li in p.loop_indices]
        c = sum(uvs, Vector((0, 0))) / len(uvs)
        pts = [c] + [c.lerp(u, 0.6) for u in uvs]
        acc = np.zeros(3, np.float32)
        for q in pts:
            acc += rgb[min(max(int(q.y * H), 0), H - 1), min(max(int(q.x * W), 0), W - 1)]
        col[p.index] = acc / len(pts)
    mx, mn = col.max(1), col.min(1)
    d = np.maximum(mx - mn, 1e-4)
    sat = (mx - mn) / np.maximum(mx, 1e-4)
    r, g, b = col[:, 0], col[:, 1], col[:, 2]
    hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    grey = (sat < 0.15) & (mx > 0.5)
    black = mx < 0.22
    skin = ~grey & ~black & ((hue < 50) | (hue > 330)) & (sat > 0.12) & (mx > 0.3)
    # Région : os dominant (somme des poids des sommets de la face).
    names = {gr.index: gr.name for gr in mesh.vertex_groups}
    vreg = []
    for v in me.vertices:
        best = max(v.groups, key=lambda ge: ge.weight, default=None)
        vreg.append(region_of(names[best.group]) if best else 'torso')
    shoulder_z = rig.data.bones['upperarm_l'].head_local.z
    part = np.empty(nf, object)
    for p in me.polygons:
        regs = [vreg[i] for i in p.vertices]
        reg = max(set(regs), key=regs.count)
        i = p.index
        z = p.center.z
        if reg == 'head':
            part[i] = 'tex_jersey' if grey[i] else 'tex_head'
        elif reg == 'arm':
            part[i] = 'tex_jersey' if grey[i] else 'tex_arms'
        elif reg == 'thigh':
            part[i] = 'tex_legs' if skin[i] else ('tex_jersey' if grey[i] and z > bb.HIP_Z else 'tex_shorts')
        elif reg == 'leg':
            part[i] = 'tex_legs'
        else:
            if black[i]:
                part[i] = 'tex_shorts' if z < bb.HIP_Z + 0.25 else 'tex_jersey'
            elif skin[i]:
                part[i] = 'tex_head' if z > shoulder_z - 0.06 and abs(p.center.x) < 0.12 else 'tex_arms'
            else:
                part[i] = 'tex_jersey'
    # Lissage : une face prend la pièce de la majorité de ses voisines (arêtes partagées).
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    nbrs = [[lf.index for e in f.edges for lf in e.link_faces if lf.index != f.index] for f in bm.faces]
    bm.free()
    for _ in range(4):
        new = part.copy()
        for i, nb in enumerate(nbrs):
            if not nb:
                continue
            votes = {}
            for j in nb:
                votes[part[j]] = votes.get(part[j], 0) + 1
            top, n = max(votes.items(), key=lambda kv: kv[1])
            if top != part[i] and n >= max(2, (len(nb) + 1) // 2 + 1) and votes.get(part[i], 0) == 0:
                new[i] = top
        part = new
    counts = {k: int((part == k).sum()) for k in PART_ORDER}
    print('pièces : ' + ', '.join(f'{k} {v}' for k, v in counts.items()))
    return part, grey


def make_materials(mesh, part, imgs):
    me = mesh.data
    me.materials.clear()
    mats = {}
    for key in PART_ORDER:
        m = bpy.data.materials.new(key)
        m.use_nodes = True
        nt = m.node_tree
        p = nt.nodes['Principled BSDF']
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = imgs['Base Color']
        nt.links.new(t.outputs['Color'], p.inputs['Base Color'])
        if 'Normal' in imgs:
            tn = nt.nodes.new('ShaderNodeTexImage')
            tn.image = imgs['Normal']
            nm = nt.nodes.new('ShaderNodeNormalMap')
            nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
            nt.links.new(nm.outputs['Normal'], p.inputs['Normal'])
        p.inputs['Roughness'].default_value = MATS[key]
        p.inputs['Metallic'].default_value = 0.0
        me.materials.append(m)
        mats[key] = m
    idx = {k: i for i, k in enumerate(PART_ORDER)}
    me.polygons.foreach_set('material_index', [idx[k] for k in part])
    for p in me.polygons:
        p.use_smooth = True
    return mats


def jersey_mask(im, mat):
    """R : gris clair du maillot (texel peu saturé et clair), G : rien (pas d'accent), B : détail du
    tissu (luminance / moyenne locale dans la zone), 0,5 = neutre. Luminance de référence du gris."""
    rgb = bb.image_array(im)
    lum = bb.srgb_to_lin(rgb) @ np.array(bb.LUMA, np.float32)
    mx, mn = rgb.max(-1), rgb.min(-1)
    sat = (mx - mn) / np.maximum(mx, 1e-4)
    grey = (1 - bb.smooth(0.10, 0.2, sat)) * bb.smooth(0.4, 0.55, mx)
    ref = float(np.median(lum[grey > 0.5]))
    mat['recolor_ref'] = [ref, ref]
    n = 1024
    k = im.size[0] // n

    def blur(x, r=6):
        for ax in (0, 1):
            acc = np.zeros_like(x)
            for o in range(-r, r + 1):
                acc += np.roll(x, o, ax)
            x = acc / (2 * r + 1)
        return x

    def small(x):
        return x.reshape(n, k, n, k).mean((1, 3))

    ls, zg = small(lum), small(grey)
    detail = np.zeros_like(ls)
    for z in (zg, np.clip(1 - zg, 0, 1)):
        local = blur(ls * z) / np.maximum(blur(z), 1e-4)
        detail += z * ls / np.maximum(local, 1e-4)
    detail = np.clip(0.5 * detail, 0.3, 0.7)
    out = bpy.data.images.new('jersey_mask', n, n, alpha=False)
    out.colorspace_settings.name = 'Non-Color'
    px = np.ones((n, n, 4), np.float32)
    px[..., 0] = zg
    px[..., 1] = 0
    px[..., 2] = detail
    out.pixels.foreach_set(px.ravel())
    out.filepath_raw = os.path.join(OUT, 'jersey_mask.webp')
    out.file_format = 'WEBP'
    out.save(quality=100)
    print(f'maillot : gris {100 * (grey > 0.5).mean():.0f} % de la texture, luminance de référence {ref:.3f}')


def vertex_coords(mesh, rig, part, mats, im):
    """COLOR_0 : sommets du maillot R = hauteur sur le torse, G = torse (1) / manche (0) ; sommets
    des jambes R = chaussure (sous la cheville). recolor_ref des chaussures (tige claire)."""
    me = mesh.data
    co = np.array([v.co for v in me.vertices])
    jv, lv = set(), set()
    for p in me.polygons:
        if part[p.index] == 'tex_jersey':
            jv.update(p.vertices)
        elif part[p.index] == 'tex_legs':
            lv.update(p.vertices)
    jv, lv = np.array(sorted(jv)), np.array(sorted(lv - set(jv)))
    colr = np.zeros((len(co), 4), np.float32)
    colr[:, 3] = 1
    jc = co[jv]
    torso = jc[np.abs(jc[:, 0]) < 0.10]
    lo, hi = torso[:, 2].min(), torso[:, 2].max()
    colr[jv, 0] = np.clip((jc[:, 2] - lo) / (hi - lo), 0, 1)
    colr[jv, 1] = bb.smooth(0.20, 0.16, np.abs(jc[:, 0]))
    ankle = rig.data.bones['foot_l'].head_local.z
    shoe = bb.smooth(ankle + 0.045, ankle + 0.015, co[lv, 2])
    colr[lv, 0] = shoe
    attr = me.color_attributes.new('coords', 'FLOAT_COLOR', 'POINT')
    attr.data.foreach_set('color', colr.ravel())
    me.color_attributes.active_color = attr
    me.color_attributes.render_color_index = 0
    # Tige claire des chaussures (texels clairs sous la cheville) ; chaussures noires : aucune, 0,5.
    rgb = bb.image_array(im)
    uv = me.uv_layers.active.data
    shoe_w = np.zeros(len(co))
    shoe_w[lv] = shoe
    lums = []
    for p in me.polygons:
        if part[p.index] != 'tex_legs':
            continue
        for li in p.loop_indices:
            if shoe_w[me.loops[li].vertex_index] > 0.9:
                u, v = uv[li].uv
                px = rgb[min(int(v * im.size[1]), im.size[1] - 1), min(int(u * im.size[0]), im.size[0] - 1)]
                lum = float(bb.srgb_to_lin(px) @ np.array(bb.LUMA, np.float32))
                if lum > 0.35:
                    lums.append(lum)
    mats['tex_legs']['recolor_ref'] = [float(np.median(lums)) if len(lums) > 50 else 0.5]
    print(f'maillot : torse de {100 * lo:.0f} à {100 * hi:.0f} cm ; chaussures : {int((shoe > 0.5).sum())} sommets, '
          f'{len(lums)} texels clairs')


def respine(rig, mesh, height):
    """Têtes des vertèbres replacées (SPINE_Z, SPINE_DEPTH) et poids du bassin et des vertèbres
    répartis par tranches de hauteur ; la part des autres os (clavicules, bras, cou) est gardée."""
    me = mesh.data
    co = np.array([v.co for v in me.vertices])
    bottom = co[:, 2].min()
    chain = ('pelvis', 'spine_01', 'spine_02', 'spine_03')
    zs = [bottom + SPINE_Z[n] * height for n in chain[1:]]
    bb.set_active(rig)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = rig.data.edit_bones
    for n, z in zip(chain[1:], zs):
        sl = co[(np.abs(co[:, 2] - z) < 0.01 * height) & (np.abs(co[:, 0]) < 0.03 * height)]
        back, front = sl[:, 1].max(), sl[:, 1].min()  # avant = −Y
        eb[n].use_connect = False
        eb[n].head = Vector((0.0, back - SPINE_DEPTH * (back - front), z))
    bpy.ops.object.mode_set(mode='OBJECT')
    groups = {g.name: g for g in mesh.vertex_groups}
    for n in chain:
        if n not in groups:
            groups[n] = mesh.vertex_groups.new(name=n)
    idx = {groups[n].index for n in chain}
    f = SPINE_FADE * height
    for v in me.vertices:
        ws = sum(ge.weight for ge in v.groups if ge.group in idx)
        if ws <= 0:
            continue
        z = v.co.z
        up = [float(bb.smooth(zc - f, zc + f, z)) for zc in zs]  # au-dessus de chaque vertèbre
        w = {'pelvis': 1 - up[0], 'spine_01': up[0] - up[1], 'spine_02': up[1] - up[2], 'spine_03': up[2]}
        for n in chain:
            groups[n].remove([v.index])
        for n, x in w.items():
            if x > 1e-4:
                groups[n].add([v.index], ws * x, 'REPLACE')
    bb.set_active(mesh)
    bpy.ops.object.vertex_group_limit_total(group_select_mode='BONE_DEFORM', limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='BONE_DEFORM', lock_active=False)
    print('colonne : vertèbres à ' + ', '.join(f'{100 * (z - bottom):.0f}' for z in zs) + ' cm')


def lower_weights(rig, mesh, part):
    """Poids du cuissard et des jambes (bassin, cuisses, jambes, torsions) recalculés d'après la
    position seule, la part des autres os (pieds, dos) gardée ; maillot : part des cuisses → bassin."""
    me = mesh.data
    LOWER = ('pelvis', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r')
    TWISTS = ('thigh_twist_01_l', 'thigh_twist_01_r', 'calf_twist_01_l', 'calf_twist_01_r')
    groups = {g.name: g for g in mesh.vertex_groups}
    for n in LOWER:
        if n not in groups:
            groups[n] = mesh.vertex_groups.new(name=n)
    mine = [n for n in LOWER + TWISTS if n in groups]
    idx = {groups[n].index for n in mine}
    thighs = {groups[n].index for n in ('thigh_l', 'thigh_r', 'thigh_twist_01_l', 'thigh_twist_01_r') if n in groups}
    lower_v, jersey_v = set(), set()
    for p in me.polygons:
        if part[p.index] in ('tex_shorts', 'tex_legs'):
            lower_v.update(p.vertices)
        elif part[p.index] == 'tex_jersey':
            jersey_v.update(p.vertices)
    jersey_v -= lower_v
    knee_z = rig.data.bones['calf_l'].head_local.z
    hip_z = bb.HIP_Z
    for i in lower_v:
        v = me.vertices[i]
        ws = sum(ge.weight for ge in v.groups if ge.group in idx)
        if ws <= 0:
            continue
        x, z = v.co.x, v.co.z
        thigh = float(bb.smooth(-HIP_FADE[0], HIP_FADE[1], hip_z - z))
        calf = float(bb.smooth(-KNEE_FADE, KNEE_FADE, knee_z - z))
        left = float(bb.smooth(-CROTCH_FADE, CROTCH_FADE, x))
        w = {'pelvis': 1 - thigh}
        for sd, k in (('l', left), ('r', 1 - left)):
            w[f'thigh_{sd}'] = thigh * (1 - calf) * k
            w[f'calf_{sd}'] = thigh * calf * k
        for n in mine:
            groups[n].remove([i])
        for n, x_ in w.items():
            if x_ > 1e-4:
                groups[n].add([i], ws * x_, 'REPLACE')
    pel = groups['pelvis']
    for i in jersey_v:
        v = me.vertices[i]
        w = sum(ge.weight for ge in v.groups if ge.group in thighs)
        if w > 0:
            for ge in v.groups:
                if ge.group in thighs:
                    ge.weight = 0.0
            pel.add([i], w, 'ADD')
    bb.set_active(mesh)
    bpy.ops.object.vertex_group_clean(group_select_mode='ALL', limit=1e-4)
    bpy.ops.object.vertex_group_limit_total(group_select_mode='BONE_DEFORM', limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='BONE_DEFORM', lock_active=False)
    print(f'poids du bas du corps : {len(lower_v)} sommets refaits, {len(jersey_v)} sommets du maillot détachés des cuisses')


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rig, mesh, height = import_rig()
    merge_extra_bones(rig, mesh)
    bb.SHOULDER_NARROW = SHOULDER_NARROW
    bb.narrow_shoulders(rig, [mesh])
    respine(rig, mesh, height)
    lengthen_arms(rig, mesh, height)
    bb.rebuild_bones(rig)
    mesh.name = mesh.data.name = 'rider_body'
    imgs = base_images(mesh)
    part, _ = classify(mesh, rig, imgs['Base Color'])
    mats = make_materials(mesh, part, imgs)
    jersey_mask(imgs['Base Color'], mats['tex_jersey'])
    vertex_coords(mesh, rig, part, mats, imgs['Base Color'])
    lower_weights(rig, mesh, part)
    pose_relaxed(rig)
    # Lissage correctif (repos = pose debout) pendant la cuisson : hanches et genoux pliés sans
    # pincement ni ballon ; retiré ensuite (le client déforme à partir de la pose cuite).
    cs = mesh.modifiers.new('CorrectiveSmooth', 'CORRECTIVE_SMOOTH')
    cs.rest_source = 'ORCO'
    cs.smooth_type = 'LENGTH_WEIGHTED'
    cs.iterations = SMOOTH_ITER
    cs.use_only_smooth = False
    bb.apply_pose_as_rest(rig, [mesh])
    mesh.modifiers.remove(mesh.modifiers['CorrectiveSmooth'])
    rig.name = rig.data.name = 'Armature'
    print(f'niveau 0 : {bb.tris(mesh)} triangles ; taille {100 * height:.1f} cm')
    lods = bb.make_lods([mesh])
    for name, level, images in [('rider', [mesh], True)] + [('rider' + sfx, lv, False) for sfx, lv in lods]:
        out = os.path.join(OUT, name + '.glb')
        raw = out if args.no_compress else os.path.join(OUT, name + '.raw.glb')
        bb.export([rig] + level, raw, images)
        if not args.no_compress:
            subprocess.run([bb.PNPM, '--filter', '@allezrobert/blender-tools', 'compress:avatar', os.path.abspath(raw), os.path.abspath(out)], check=True)
            os.remove(raw)
        print(f'{name} : {os.path.getsize(out) / 1e6:.2f} Mo')


main()
