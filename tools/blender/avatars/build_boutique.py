"""
Allez Robert ! — coureur acheté (modèle « cyclist male rigged », généré avec Tripo, rig Auto-Rig Pro).

Source : le FBX « NORMAL RIG.fbx » du pack (squelette de 60 os déformants, doigts compris, pièces
séparées : tête, bras, jambes avec chaussettes et chaussures, maillot, cuissard, casque, lunettes).
Le pack n'est PAS versionné (dépôt public) : il reste dans zzModel3D/, hors dépôt.

  - os renommés comme le squelette « game_engine » de l'avatar MPFB (pelvis, spine_01…, thigh_l,
    calf_l, index_01_l…) : le client les pilote avec la même table (gltfAvatar.ts) ;
  - os refaits en mode édition (queue vers l'enfant, roulis homogène) : l'import FBX les devine ;
  - pose de conduite appliquée comme pose de repos, mêmes cotes de vélo et même profil de buste
    que build_avatar.py (pose_rider, recopié ici : ce script-là construit l'humain MPFB) ;
  - hanches : le rig met le pivot des cuisses à la ceinture ; il est ramené à l'articulation
    (HIP_ABOVE_CROTCH au-dessus de l'entrejambe du cuissard) ;
  - cuisses allongées (le modèle généré les a très courtes : 28 cm de la hanche au genou pour
    46 cm de tibia) jusqu'à THIGH_RATIO du tibia, par modelage : seul le segment entrejambe →
    genou s'étire (peau et cuissard), fesses intactes ; genoux, jambes et pieds descendent ;
  - bras allongés de la même façon (le modèle les a très courts : 18 cm de l'épaule au coude) :
    bras et avant-bras portés à ARM_UPPER et ARM_FORE de la taille, épaule, coude et poignet
    intacts, manches comprises ;
  - peau des bras sous les manches : poids du tissu le plus proche (fondu sur SKIN_UNDER), sinon
    l'épaule traverse la manche quand le bras s'avance vers le guidon ;
  - poids du bas du corps refaits sur les pivots corrigés (lower_body_weights) : ceux du rig,
    peints pour un pivot à la ceinture, déformaient les fesses dès que la cuisse se lève ;
  - taille : le modèle (1,66 m) est mis à l'échelle pour que sa jambe aille au vélo, genou à
    KNEE_BOTTOM degrés en bas du coup de pédale (cycliste bien réglé) ; --height impose une taille ;
  - matériaux « tex_* » : textures d'origine gardées par le client, réduites et encodées en WebP ;
    LOD 1 et 2 sans images (le client réutilise celles du LOD 0) ;
  - maillot recolorable : jersey_mask.webp (R : bleu d'origine → couleur du maillot, G : blanc →
    couleur d'accent, B : détail du tissu sans le dessin, plis et coutures, 0,5 = neutre),
    luminances de référence des deux zones dans les extras du matériau (recolor_ref) : le client
    multiplie la couleur du coureur par la luminance relative du texel ; COLOR_0 du maillot :
    R = hauteur sur le torse (0 bas → 1 col), G = torse (1) ou manche (0), pour les bandes des
    maillots de champion ;
  - casque recolorable : attribut de sommet (COLOR_0, R) = coque extérieure, calculé sur la
    géométrie (l'atlas Tripo mélange coque, sangles et rembourrage) ; luminance de référence de
    la coque dans recolor_ref ;
  - textures : couleurs des îlots prolongées sur le fond transparent (pad_islands) ; sinon le
    filtrage mêle ce fond au tissu le long des coutures (taches couleur peau sur les épaules) ;
  - chaussures recolorables : attribut de sommet COLOR_0 (R) des jambes = chaussure (sous la
    cheville), seuls les texels clairs de la tige prennent la couleur (semelle et cale gardées) ;
  - quantification et compression meshopt (avatars/compress.mjs ; --no-compress pour s'en passer).

Usage (depuis la racine du dépôt) :
    blender -b --factory-startup --disable-autoexec --python tools/blender/avatars/build_boutique.py -- \\
        [--fbx "zzModel3D/NORMAL RIG.fbx"] [--out apps/client/public/models/avatar/boutique/] [--height 1.80]
"""

import argparse
import math
import os
import shutil
import subprocess
import sys

import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--fbx', default='zzModel3D/NORMAL RIG.fbx')
ap.add_argument('--out', default='apps/client/public/models/avatar/boutique/')
ap.add_argument('--height', type=float, default=0.0, help='taille du coureur (m) ; 0 : calculée pour le vélo')
ap.add_argument('--elbow', default='', help='direction des coudes x,y,z (repère client), essais')
ap.add_argument('--seat', default='', help='décalage des hanches x,y,z (repère client), essais')
ap.add_argument('--shoulders', default='', help='avancée,élévation des épaules (°), essais')
ap.add_argument('--no-compress', action='store_true')
args = ap.parse_args(argv)
OUT = os.path.abspath(args.out)
os.makedirs(OUT, exist_ok=True)
PNPM = shutil.which('pnpm') or 'pnpm'

# Cotes du vélo (repère CLIENT : +x gauche, +y haut, +z avant) — identiques à build_avatar.py.
BB = Vector((0.0, 0.27, 0.0))
CRANK = 0.1725
PEDAL_AXIS_X = 0.072
FOOT_X = 0.105
REST_PITCH = 0.35
ANKLE_FLAT = Vector((0.0, 0.095, -0.13))
HIP = Vector((0.0, 1.03, -0.17))
# Ce modèle a le fessier plus en arrière de l'articulation de la hanche que l'avatar MPFB : hanches
# reculées (et un peu relevées) pour que les ischions tombent sur la partie large de la selle.
SEAT_SHIFT = Vector((0.0, 0.0, -0.09))
if args.seat:
    SEAT_SHIFT = Vector(tuple(float(x) for x in args.seat.split(',')))
HIP_REF = HIP.copy()                      # taille du modèle calculée sur la cote de référence
HIP = HIP + SEAT_SHIFT
HOOD = Vector((0.2, 0.958, 0.54))
SOLE = 0.03

SPINE_SHAPE = {'pelvis': 6.0, 'spine_01': 4.0, 'spine_02': 0.0, 'spine_03': -8.0}
NECK_DEG = 42.0
SHOULDER_PROTRACT = 24.0
SHOULDER_RAISE = -6.0
HEAD_PITCH = 8.0
ARM_REACH = 0.70
if args.shoulders:
    SHOULDER_PROTRACT, SHOULDER_RAISE = (float(x) for x in args.shoulders.split(','))
ELBOW_POLE = Vector((0.36, 1.05, 0.30))   # direction des coudes (repère client, côté gauche)
if args.elbow:
    ELBOW_POLE = Vector(tuple(float(x) for x in args.elbow.split(',')))
KNEE_BOTTOM = 145.0                       # genou en bas du coup de pédale (°, 180 = tendu)
SHOULDER_NARROW = 0.10                    # épaules resserrées (fraction de la largeur)
ARM_UPPER = 0.165                         # épaule → coude / taille (≈ 0,17 chez l'humain)
ARM_FORE = 0.142                          # coude → poignet / taille (≈ 0,145)
HIP_ABOVE_CROTCH = 0.10                   # articulation de la hanche / entrejambe (m, modèle d'origine)
THIGH_RATIO = 0.85                        # cuisse (hanche → genou) / tibia (genou → cheville)

# Os Auto-Rig Pro → noms « game_engine » (MPFB).
BONE_MAP = {'root.x': 'pelvis', 'spine_01.x': 'spine_01', 'spine_02.x': 'spine_02', 'spine_03.x': 'spine_03',
            'neck.x': 'neck_01', 'head.x': 'head'}
for s in ('l', 'r'):
    BONE_MAP.update({
        f'shoulder.{s}': f'clavicle_{s}', f'arm_stretch.{s}': f'upperarm_{s}', f'arm_twist.{s}': f'upperarm_twist_01_{s}',
        f'forearm_stretch.{s}': f'lowerarm_{s}', f'forearm_twist.{s}': f'lowerarm_twist_01_{s}', f'hand.{s}': f'hand_{s}',
        f'thigh_stretch.{s}': f'thigh_{s}', f'thigh_twist.{s}': f'thigh_twist_01_{s}', f'leg_stretch.{s}': f'calf_{s}',
        f'leg_twist.{s}': f'calf_twist_01_{s}', f'foot.{s}': f'foot_{s}', f'toes_01.{s}': f'ball_{s}',
    })
    for f in ('thumb', 'index', 'middle', 'ring', 'pinky'):
        for j in (1, 2, 3):
            BONE_MAP[f'c_{f}{j}.{s}'] = f'{f}_0{j}_{s}'

# Pièces du FBX → objet exporté, matériau, (rugosité, métal), côté de texture maximal (px).
PARTS = {
    'HEAD': ('rider_head', 'tex_head', 0.55, 2048),
    'TSHIRT': ('rider_jersey', 'tex_jersey', 0.7, 2048),
    'SHORT': ('rider_shorts', 'tex_shorts', 0.5, 1024),
    'LL': ('rider_legs', 'tex_legs', 0.6, 1024),
    'RL': ('rider_legs', 'tex_legs', 0.6, 1024),
    'LH': ('rider_arms', 'tex_arms', 0.55, 1024),
    'RH': ('rider_arms', 'tex_arms', 0.55, 1024),
    'HELMET': ('rider_helmet', 'tex_helmet', None, 2048),
    'GLASSES': ('rider_glasses', 'tex_glasses', None, 2048),
    'GLASS': ('rider_glasses_lens', 'tex_lens', None, 2048),
}


def bl(v):
    """Repère client → Blender (Z en haut, avant = −Y)."""
    return Vector((v[0], -v[2], v[1]))


def cl(v):
    return Vector((v[0], v[2], -v[1]))


def set_active(ob):
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


# ---------------------------------------------------------------------------------------------
# Import et remise en ordre
# ---------------------------------------------------------------------------------------------
HIP_Z = 0.0
CROTCH_Z = 0.0
KNEE_Z = 0.0
THIGH_DZ = 0.0                            # allongement vertical des cuisses (m, après mise à l'échelle)


def import_rig():
    bpy.ops.import_scene.fbx(filepath=os.path.abspath(args.fbx), use_custom_normals=False, use_anim=False)
    rig = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    # Échelle 0,01 du FBX appliquée : tout en mètres, armature à l'identité.
    for o in meshes:
        m = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = m
    bpy.ops.object.select_all(action='DESELECT')
    for o in [rig] + meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    head = next(o for o in meshes if o.name == 'HEAD')
    top = max((head.matrix_world @ v.co).z for v in head.data.vertices)
    shorts = next(o for o in meshes if o.name == 'SHORT')
    crotch = min(v.co.z for v in shorts.data.vertices if abs(v.co.x) < 0.02)
    hip_z = crotch + HIP_ABOVE_CROTCH
    bones = rig.data.bones
    knee, ankle = bones['leg_stretch.l'].head_local, bones['foot.l'].head_local
    hip = Vector((bones['thigh_stretch.l'].head_local.x, knee.y, hip_z))
    a0, b = (knee - hip).length, (ankle - knee).length
    a = THIGH_RATIO * b
    dz = (a - a0) * (hip.z - knee.z) / a0
    grown = top + dz
    if args.height > 0:
        f = args.height / grown
    else:
        # Hanche (selle) → cheville, pédale en bas : distance fixée par le vélo.
        d = (bl(HIP_REF) - bl(ankle_target('l')[0])).length
        c = math.cos(math.radians(KNEE_BOTTOM))
        # d² = f²(a² + b² − 2ab·cos θ)
        f = d / math.sqrt(a * a + b * b - 2 * a * b * c)
    for o in [rig] + meshes:
        o.scale = (f, f, f)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    global HIP_Z, CROTCH_Z, KNEE_Z, THIGH_DZ
    HIP_Z, CROTCH_Z, KNEE_Z, THIGH_DZ = hip_z * f, crotch * f, knee.z * f, dz * f
    print(f'taille : {top:.3f} m → {grown * f:.3f} m (×{f:.3f}, cuisses +{100 * THIGH_DZ:.0f} cm) ; cuisse {100 * a * f:.0f} cm, tibia {100 * b * f:.0f} cm, '
          f'hanche à {100 * HIP_Z:.0f} cm (pivot du rig à {100 * bones["thigh_stretch.l"].head_local.z:.0f} cm)')
    for o in meshes:
        o.parent = rig
    for b in rig.data.bones:
        if b.name in BONE_MAP:
            b.name = BONE_MAP[b.name]  # groupes de sommets renommés avec
    missing = [b.name for b in rig.data.bones if b.name not in BONE_MAP.values()]
    if missing:
        raise SystemExit(f'os inattendus : {missing}')
    return rig, meshes


def lengthen_thighs(rig, meshes):
    """Cuisses allongées de THIGH_DZ : sommets étirés entre l'entrejambe et le genou (rien au-dessus,
    tout descend en dessous), genoux, jambes et pieds abaissés d'autant (pose de repos)."""
    top = CROTCH_Z - 0.03
    for ob in meshes:
        for v in ob.data.vertices:
            z = v.co.z
            if z < top:
                v.co.z = z - THIGH_DZ * min(1.0, (top - z) / (top - KNEE_Z))
    set_active(rig)
    bpy.ops.object.mode_set(mode='EDIT')
    for b in rig.data.edit_bones:
        b.use_connect = False
    for b in rig.data.edit_bones:
        if b.name[:-2] in ('calf', 'calf_twist_01', 'foot', 'ball'):
            b.head.z -= THIGH_DZ
            b.tail.z -= THIGH_DZ
    bpy.ops.object.mode_set(mode='OBJECT')


def lengthen_arms(rig, meshes):
    """Bras et avant-bras allongés le long de l'axe épaule → poignet (pose en T) : sommets étirés
    entre l'épaule et le coude, puis entre le coude et le poignet (marges : moignon de l'épaule,
    coude et poignet gardent leur forme), main et doigts déplacés d'un bloc ; os de même."""
    head = next(o for o in meshes if o.name == 'HEAD')
    # Taille finale : les cuisses viennent d'être allongées (pieds sous le sol).
    height = max(v.co.z for v in head.data.vertices) - min(v.co.z for o in meshes for v in o.data.vertices)
    bones = rig.data.bones
    arms = {}
    for sd in ('l', 'r'):
        S, E, W = (bones[f'{n}_{sd}'].head_local.copy() for n in ('upperarm', 'lowerarm', 'hand'))
        d = (W - S).normalized()
        te, tw = (E - S).dot(d), (W - S).dot(d)
        du, df = ARM_UPPER * height - (E - S).length, ARM_FORE * height - (W - E).length
        arms[sd] = (S, d, te, tw, du, df)
        print(f'bras {sd} : {100 * (E - S).length:.0f} + {100 * (W - E).length:.0f} cm → '
              f'{100 * ARM_UPPER * height:.0f} + {100 * ARM_FORE * height:.0f} cm')

    def ramp(t, a, b):
        return min(1.0, max(0.0, (t - a) / (b - a)))

    def moved(co):
        sd = 'l' if co.x > 0 else 'r'
        S, d, te, tw, du, df = arms[sd]
        rel = co - S
        t = rel.dot(d)
        if t <= 0 or (rel - d * t).length > 0.15:  # hors du bras (torse, jambes, tête)
            return co
        f = du * ramp(t, 0.03, te - 0.025) + df * ramp(t, te + 0.025, tw - 0.03)
        return co + d * f

    for ob in meshes:
        for v in ob.data.vertices:
            v.co = moved(v.co)
    set_active(rig)
    bpy.ops.object.mode_set(mode='EDIT')
    # Os déconnectés et positions calculées d'abord : déplacer la tête d'un os connecté déplace
    # aussi la queue de son parent (os déplacés deux fois).
    eb = rig.data.edit_bones
    for b in eb:
        b.use_connect = False
    new = {b.name: (moved(b.head.copy()), moved(b.tail.copy())) for b in eb
           if any(b.name.startswith(p) for p in ('upperarm', 'lowerarm', 'hand', 'thumb', 'index', 'middle', 'ring', 'pinky'))}
    for n, (h, t) in new.items():
        eb[n].head, eb[n].tail = h, t
    bpy.ops.object.mode_set(mode='OBJECT')


def narrow_shoulders(rig, meshes):
    """Buste resserré aux épaules (le modèle généré les a très larges et carrées), pose en T :
    largeur réduite progressivement de la poitrine aux épaules (SHOULDER_NARROW), revenant à 1
    au cou ; bras déplacés d'un bloc avec l'articulation de l'épaule ; os de même."""
    bones = rig.data.bones
    xs = abs(bones['upperarm_l'].head_local.x)
    zs = bones['upperarm_l'].head_local.z
    zn = bones['neck_01'].head_local.z

    def k(z):
        return 1 - SHOULDER_NARROW * float(smooth(zs - 0.18, zs - 0.02, z)) * (1 - float(smooth(zn - 0.04, zn + 0.02, z)))

    def moved(co):
        c = co.copy()
        if abs(c.x) <= xs:
            c.x *= k(c.z)
        else:
            c.x += (1 if c.x > 0 else -1) * xs * (k(zs) - 1)
        return c

    for ob in meshes:
        for v in ob.data.vertices:
            v.co = moved(v.co)
    set_active(rig)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = rig.data.edit_bones
    for b in eb:
        b.use_connect = False
    new = {b.name: (moved(b.head.copy()), moved(b.tail.copy())) for b in eb}
    for n, (h, t) in new.items():
        eb[n].head, eb[n].tail = h, t
    bpy.ops.object.mode_set(mode='OBJECT')
    print(f'épaules : {200 * xs:.0f} → {200 * xs * k(zs):.0f} cm entre les articulations')


def rebuild_bones(rig):
    """Queues vers l'enfant principal, roulis homogène : l'import FBX devine l'orientation des os."""
    set_active(rig)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = rig.data.edit_bones
    for b in eb:
        b.use_connect = False
    nxt = {'pelvis': 'spine_01', 'spine_01': 'spine_02', 'spine_02': 'spine_03', 'spine_03': 'neck_01', 'neck_01': 'head'}
    for s in ('l', 'r'):
        nxt.update({f'clavicle_{s}': f'upperarm_{s}', f'upperarm_{s}': f'lowerarm_{s}', f'lowerarm_{s}': f'hand_{s}',
                    f'hand_{s}': f'middle_01_{s}', f'thigh_{s}': f'calf_{s}', f'calf_{s}': f'foot_{s}', f'foot_{s}': f'ball_{s}'})
        for f in ('thumb', 'index', 'middle', 'ring', 'pinky'):
            nxt[f'{f}_01_{s}'] = f'{f}_02_{s}'
            nxt[f'{f}_02_{s}'] = f'{f}_03_{s}'
    # Pivot des cuisses : articulation de la hanche, pas la ceinture (torsions comprises) ; le
    # bassin garde le sien (bas du dos).
    for n in ('thigh_l', 'thigh_r', 'thigh_twist_01_l', 'thigh_twist_01_r'):
        eb[n].head.z = HIP_Z
    for a, b in nxt.items():
        eb[a].tail = eb[b].head
    eb['head'].tail = eb['head'].head + Vector((0, 0, 0.18))
    for s in ('l', 'r'):
        for f in ('thumb', 'index', 'middle', 'ring', 'pinky'):
            e, p = eb[f'{f}_03_{s}'], eb[f'{f}_02_{s}']
            e.tail = e.head + (p.tail - p.head).normalized() * p.length * 0.8
        ball = eb[f'ball_{s}']
        ball.tail = ball.head + Vector((0, -0.05, 0))
        for tw, par in (('upperarm_twist_01', 'upperarm'), ('lowerarm_twist_01', 'lowerarm'), ('thigh_twist_01', 'thigh'), ('calf_twist_01', 'calf')):
            eb[f'{tw}_{s}'].tail = eb[f'{par}_{s}'].tail
    # Roulis : axe Z des os vers l'avant (−Y) pour le tronc et les jambes, vers le haut pour les bras.
    bpy.ops.armature.select_all(action='DESELECT')
    for b in eb:
        b.select = b.select_head = b.select_tail = True
    bpy.ops.armature.calculate_roll(type='GLOBAL_NEG_Y')
    bpy.ops.armature.select_all(action='DESELECT')
    for b in eb:
        if any(b.name.startswith(p) for p in ('clavicle', 'upperarm', 'lowerarm', 'hand', 'thumb', 'index', 'middle', 'ring', 'pinky')):
            b.select = b.select_head = b.select_tail = True
    bpy.ops.armature.calculate_roll(type='GLOBAL_POS_Z')
    # Doigts : axe Z vers le bas (paume, mains à plat en T) ; la flexion autour de +X (ici et dans
    # le client, GRIP_CURL) les referme alors vers la paume, pas vers le dos de la main.
    bpy.ops.armature.select_all(action='DESELECT')
    for b in eb:
        if any(b.name.startswith(p) for p in ('thumb', 'index', 'middle', 'ring', 'pinky')):
            b.select = b.select_head = b.select_tail = True
    bpy.ops.armature.calculate_roll(type='GLOBAL_NEG_Z')
    bpy.ops.object.mode_set(mode='OBJECT')


LOWER = ('pelvis', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r')
TWISTS = ('thigh_twist_01_l', 'thigh_twist_01_r', 'calf_twist_01_l', 'calf_twist_01_r')
# Fondus des poids du bas du corps (m, pose debout) : bassin → cuisse autour de l'articulation de
# la hanche (au-dessus → en dessous), cuisse → jambe autour du genou, gauche ↔ droite à l'entrejambe.
HIP_FADE = (0.06, 0.10)
KNEE_FADE = 0.05
CROTCH_FADE = 0.03
SKIN_UNDER = (0.02, 0.05)                  # peau sous le tissu → poids propres (m)


def trim_arm_roots(rig, arms, jersey):
    """Peau des bras couverte par les manches supprimée (jusqu'à 6 cm sous l'ourlet) : collée au
    tissu, voire au travers par endroits dans le modèle généré, elle ressortait sur les épaules."""
    import bmesh
    bones = rig.data.bones
    axes = {}
    for sd in ('l', 'r'):
        S, W = bones[f'upperarm_{sd}'].head_local, bones[f'hand_{sd}'].head_local
        axes[sd] = (S, (W - S).normalized())
    # Ourlet de chaque manche : point du maillot le plus loin le long du bras, près de son axe.
    hem = {}
    for sd, (S, d) in axes.items():
        ts = [(v.co - S).dot(d) for v in jersey.data.vertices
              if (v.co.x > 0) == (sd == 'l') and ((v.co - S) - d * (v.co - S).dot(d)).length < 0.12]
        hem[sd] = max(ts)
    bm = bmesh.new()
    bm.from_mesh(arms.data)

    def t_of(co):
        sd = 'l' if co.x > 0 else 'r'
        return (co - axes[sd][0]).dot(axes[sd][1]) - hem[sd]

    dead = [v for v in bm.verts if t_of(v.co) < -0.06]
    bmesh.ops.delete(bm, geom=dead, context='VERTS')
    bm.to_mesh(arms.data)
    bm.free()
    print(f'rider_arms : {len(dead)} sommets sous les manches supprimés (ourlets à {100 * hem["l"]:.0f} cm de l’épaule)')
    return axes


def skin_under_cloth(skin, cloth, deep=None):
    """La peau couverte par le tissu prend les poids du tissu au point le plus proche (moyenne
    des trois sommets voisins) ; fondu vers ses propres poids à la sortie (SKIN_UNDER). `deep` :
    sommets entièrement calés quelle que soit leur profondeur (moignon de l'épaule)."""
    from mathutils.bvhtree import BVHTree
    from mathutils import kdtree
    cv = [v.co.copy() for v in cloth.data.vertices]
    bvh = BVHTree.FromPolygons(cv, [p.vertices for p in cloth.data.polygons])
    kd = kdtree.KDTree(len(cv))
    for k, co in enumerate(cv):
        kd.insert(co, k)
    kd.balance()
    cn = {g.index: g.name for g in cloth.vertex_groups}
    cw = [{cn[ge.group]: ge.weight for ge in v.groups if ge.weight > 1e-4} for v in cloth.data.vertices]
    sn = {g.index: g.name for g in skin.vertex_groups}
    groups = {g.name: g for g in skin.vertex_groups}
    n = 0
    for v in skin.data.vertices:
        hit = bvh.find_nearest(v.co)
        if hit[0] is None:
            continue
        t = 1.0 if deep and deep(v.co) else 1 - float(smooth(SKIN_UNDER[0], SKIN_UNDER[1], hit[3]))
        if t <= 0:
            continue
        n += 1
        near = kd.find_n(hit[0], 3)
        inv = [1 / max(d, 1e-5) for _, _, d in near]
        tot = sum(inv)
        under = {}
        for (_, k, _), w in zip(near, inv):
            for g, x in cw[k].items():
                under[g] = under.get(g, 0.0) + x * w / tot
        own = {sn[ge.group]: ge.weight for ge in v.groups}
        for g in set(own) | set(under):
            if g not in groups:
                groups[g] = skin.vertex_groups.new(name=g)
            groups[g].add([v.index], (1 - t) * own.get(g, 0.0) + t * under.get(g, 0.0), 'REPLACE')
    set_active(skin)
    bpy.ops.object.vertex_group_clean(group_select_mode='ALL', limit=1e-4)
    bpy.ops.object.vertex_group_limit_total(group_select_mode='BONE_DEFORM', limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='BONE_DEFORM', lock_active=False)
    print(f'{skin.name} : {n} sommets de peau sous {cloth.name} calés sur le tissu')


def lower_body_weights(rig, objs):
    """Poids du cuissard et des jambes refaits sur les pivots corrigés (ceux du rig, peints pour un
    pivot à la ceinture, déformaient les fesses dès que la cuisse se lève). Champ de poids qui ne
    dépend que de la position : cuissard (7 panneaux) et jambes (peau, chaussettes, chaussures en
    coquilles séparées) se superposent, deux couches voisines doivent bouger ensemble — la chaleur
    des os de Blender, calculée coquille par coquille, les faisait se traverser. La part des autres
    os (pieds, dos) est gardée ; le maillot ne suit plus du tout les cuisses."""
    knee_z = rig.data.bones['calf_l'].head_local.z
    for ob in objs:
        if ob.name not in ('rider_shorts', 'rider_legs'):
            continue
        groups = {g.name: g for g in ob.vertex_groups}
        for n in LOWER:
            if n not in groups:
                groups[n] = ob.vertex_groups.new(name=n)
        mine = [n for n in LOWER + TWISTS if n in groups]
        idx = {groups[n].index for n in mine}
        for v in ob.data.vertices:
            ws = sum(ge.weight for ge in v.groups if ge.group in idx)
            if ws <= 0:
                continue
            x, z = v.co.x, v.co.z
            thigh = float(smooth(-HIP_FADE[0], HIP_FADE[1], HIP_Z - z))
            calf = float(smooth(-KNEE_FADE, KNEE_FADE, knee_z - z))
            left = float(smooth(-CROTCH_FADE, CROTCH_FADE, x))
            w = {'pelvis': 1 - thigh}
            for sd, k in (('l', left), ('r', 1 - left)):
                w[f'thigh_{sd}'] = thigh * (1 - calf) * k
                w[f'calf_{sd}'] = thigh * calf * k
            for n in mine:
                groups[n].remove([v.index])
            for n, x_ in w.items():
                if x_ > 1e-4:
                    groups[n].add([v.index], ws * x_, 'REPLACE')
        set_active(ob)
        bpy.ops.object.vertex_group_limit_total(group_select_mode='BONE_DEFORM', limit=4)
        bpy.ops.object.vertex_group_normalize_all(group_select_mode='BONE_DEFORM', lock_active=False)
    jersey = next(o for o in objs if o.name == 'rider_jersey')
    groups = {g.name: g for g in jersey.vertex_groups}
    thighs = {groups[n].index for n in ('thigh_l', 'thigh_r') + TWISTS[:2] if n in groups}
    pel = groups.get('pelvis') or jersey.vertex_groups.new(name='pelvis')
    for v in jersey.data.vertices:
        w = sum(ge.weight for ge in v.groups if ge.group in thighs)
        if w > 0:
            for ge in v.groups:
                if ge.group in thighs:
                    ge.weight = 0.0
            pel.add([v.index], w, 'ADD')


def join_parts(meshes):
    """Une pièce par matériau (jambes et bras fusionnés) ; matériaux refaits (textures d'origine)."""
    objs = {}
    for o in meshes:
        name, mat, _, _ = PARTS[o.name]
        objs.setdefault(name, []).append(o)
    out = []
    for name, group in objs.items():
        set_active(group[0])
        for o in group[1:]:
            o.select_set(True)
        bpy.ops.object.join()
        ob = bpy.context.view_layer.objects.active
        ob.name = ob.data.name = name
        for p in ob.data.polygons:
            p.use_smooth = True
        for a in list(ob.data.color_attributes):
            ob.data.color_attributes.remove(a)
        # Quatre os au plus par sommet (glTF), poids renormalisés.
        bpy.ops.object.vertex_group_limit_total(group_select_mode='BONE_DEFORM', limit=4)
        bpy.ops.object.vertex_group_normalize_all(group_select_mode='BONE_DEFORM', lock_active=False)
        out.append(ob)
    return out


def srgb_to_lin(c):
    import numpy as np
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def smooth(e0, e1, x):
    import numpy as np
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def image_array(im):
    """Pixels (de bas en haut, comme Blender), RVB dans l'encodage du fichier (sRGB)."""
    import numpy as np
    a = np.empty(im.size[0] * im.size[1] * 4, np.float32)
    im.pixels.foreach_get(a)
    return a.reshape(im.size[1], im.size[0], 4)[..., :3]


LUMA = (0.2126, 0.7152, 0.0722)


def jersey_mask(im, mat):
    """Zones recolorables du maillot, d'après la teinte du texel : bleu (saturé, teinte 185 à
    265°) → couleur du maillot, blanc (peu saturé, clair) → accent ; noir, gris foncés, étiquette
    rouge gardés. Écrit jersey_mask.webp (1024 px, sans perte) et les luminances de référence."""
    import numpy as np
    rgb = image_array(im)
    lum = srgb_to_lin(rgb) @ np.array(LUMA, np.float32)
    mx, mn = rgb.max(-1), rgb.min(-1)
    d = np.maximum(mx - mn, 1e-4)
    sat = (mx - mn) / np.maximum(mx, 1e-4)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    blue = smooth(0.12, 0.3, sat) * smooth(170, 195, hue) * (1 - smooth(255, 280, hue)) * smooth(0.008, 0.03, lum)
    white = (1 - smooth(0.12, 0.25, sat)) * smooth(0.25, 0.5, lum) * (1 - blue)
    ref = [float(np.median(lum[blue > 0.5])), float(np.median(lum[white > 0.5]))]
    mat['recolor_ref'] = ref
    n = 1024
    k = im.size[0] // n
    # Détail du tissu : luminance / sa moyenne locale dans la même zone (bleu, blanc, reste),
    # flou normalisé par zone (pas de halo au bord des panneaux du dessin).
    def blur(x, r=6):
        for ax in (0, 1):
            acc = np.zeros_like(x)
            for o in range(-r, r + 1):
                acc += np.roll(x, o, ax)
            x = acc / (2 * r + 1)
        return x
    small = lambda x: x.reshape(n, k, n, k).mean((1, 3))
    ls, zones = small(lum), [small(blue), small(white)]
    zones.append(np.clip(1 - zones[0] - zones[1], 0, 1))
    detail = np.zeros_like(ls)
    for z in zones:
        local = blur(ls * z) / np.maximum(blur(z), 1e-4)
        detail += z * ls / np.maximum(local, 1e-4)
    detail = np.clip(0.5 * detail, 0.3, 0.7)
    m = np.stack([small(blue), small(white), detail], -1)
    out = bpy.data.images.new('jersey_mask', n, n, alpha=False)
    out.colorspace_settings.name = 'Non-Color'
    px = np.ones((n, n, 4), np.float32)
    px[..., :3] = m
    out.pixels.foreach_set(px.ravel())
    out.filepath_raw = os.path.join(OUT, 'jersey_mask.webp')
    out.file_format = 'WEBP'
    out.save(quality=100)
    print(f'maillot : bleu {100 * (blue > 0.5).mean():.0f} %, blanc {100 * (white > 0.5).mean():.0f} % de la texture, '
          f'luminances de référence {ref[0]:.3f} / {ref[1]:.3f}')


def helmet_shell(ob, mat):
    """Coque extérieure du casque (pose debout) : normale tournée vers l'extérieur du crâne et
    au-dessus des sangles ; poids lissé dans COLOR_0 (R). Luminance de référence : médiane de
    la texture sur la coque."""
    import numpy as np
    me = ob.data
    co = np.array([v.co for v in me.vertices])
    nrm = np.array([v.normal for v in me.vertices])
    lo, hi = co.min(0), co.max(0)
    c = np.array([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, hi[2] - 0.5 * (hi[2] - lo[2])])
    rel = co - c
    out = np.einsum('ij,ij->i', nrm, rel / np.linalg.norm(rel, axis=1, keepdims=True))
    h = (co[:, 2] - lo[2]) / (hi[2] - lo[2])
    w = smooth(0.05, 0.35, out) * smooth(0.36, 0.44, h)
    # Lissage sur les arêtes (deux passes) : pas d'escalier aux bords de la coque.
    ed = np.array([e.vertices for e in me.edges])
    for _ in range(2):
        acc = w.copy()
        cnt = np.ones_like(w)
        np.add.at(acc, ed[:, 0], w[ed[:, 1]])
        np.add.at(acc, ed[:, 1], w[ed[:, 0]])
        np.add.at(cnt, ed[:, 0], 1)
        np.add.at(cnt, ed[:, 1], 1)
        w = acc / cnt
    attr = me.color_attributes.new('shell', 'FLOAT_COLOR', 'POINT')
    col = np.zeros((len(w), 4), np.float32)
    col[:, 0] = w
    col[:, 3] = 1
    attr.data.foreach_set('color', col.ravel())
    me.color_attributes.active_color = attr
    me.color_attributes.render_color_index = 0
    im = next(n.image for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE' and n.outputs['Color'].links
              and n.outputs['Color'].links[0].to_socket.name == 'Base Color')
    rgb = image_array(im)
    uv = me.uv_layers.active.data
    lums = []
    for loop in me.loops:
        if w[loop.vertex_index] > 0.8:
            u, v = uv[loop.index].uv
            px = rgb[min(int(v * im.size[1]), im.size[1] - 1), min(int(u * im.size[0]), im.size[0] - 1)]
            lums.append(float(srgb_to_lin(px) @ np.array(LUMA, np.float32)))
    mat['recolor_ref'] = [float(np.median(lums))]
    print(f'casque : coque {100 * (w > 0.5).mean():.0f} % des sommets, luminance de référence {mat["recolor_ref"][0]:.3f}')


def pad_islands(im, steps=24, warm=False):
    """Prolonge les îlots de la texture sur le fond (alpha nul) : chaque pixel vide prend la
    moyenne de ses voisins pleins, `steps` fois ; alpha ensuite plein partout. `warm` : les
    texels de teinte chaude (peau, orangé, rouge, cuits par erreur dans le maillot généré) sont
    traités comme vides, donc repeints avec le tissu voisin."""
    import numpy as np
    w, h = im.size
    a = np.empty(w * h * 4, np.float32)
    im.pixels.foreach_get(a)
    px = a.reshape(h, w, 4)
    rgb, full = px[..., :3].copy(), px[..., 3] > 0.5
    if warm:
        mx, mn = rgb.max(-1), rgb.min(-1)
        d = np.maximum(mx - mn, 1e-4)
        r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
        hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
        hot = ((mx - mn) / np.maximum(mx, 1e-4) > 0.15) & ((hue < 50) | (hue > 320)) & full
        full &= ~hot
        print(f'{im.name} : {100 * hot.mean():.2f} % de texels chauds repeints')
    for _ in range(steps):
        acc = np.zeros_like(rgb)
        cnt = np.zeros((h, w), np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            m = np.roll(full, (dy, dx), (0, 1))
            acc += np.roll(rgb, (dy, dx), (0, 1)) * m[..., None]
            cnt += m
        grow = ~full & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow][:, None]
        full |= grow
    px[..., :3] = rgb
    px[..., 3] = 1.0
    im.pixels.foreach_set(px.ravel())
    im.update()


def jersey_coords(ob):
    """COLOR_0 du maillot (pose debout) : R = hauteur sur le torse (0 au bas, 1 au col), G = torse
    (1) ou manche (0, au-delà de l'épaule) : bandes des maillots de champion."""
    import numpy as np
    me = ob.data
    co = np.array([v.co for v in me.vertices])
    torso = co[np.abs(co[:, 0]) < 0.10]
    lo, hi = torso[:, 2].min(), torso[:, 2].max()
    attr = me.color_attributes.new('jersey', 'FLOAT_COLOR', 'POINT')
    col = np.zeros((len(co), 4), np.float32)
    col[:, 0] = np.clip((co[:, 2] - lo) / (hi - lo), 0, 1)
    col[:, 1] = smooth(0.20, 0.16, np.abs(co[:, 0]))
    col[:, 3] = 1
    attr.data.foreach_set('color', col.ravel())
    me.color_attributes.active_color = attr
    me.color_attributes.render_color_index = 0


def fill_holes(ob, max_sides=12):
    """Bouche les petits trous (bords libres de max_sides arêtes au plus) ; coordonnées de texture
    des nouvelles faces reprises des faces voisines (même sommet), la texture s'y raccorde."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    uv = bm.loops.layers.uv.active
    known = {}
    for f in bm.faces:
        for lp in f.loops:
            known.setdefault(lp.vert.index, lp[uv].uv.copy())
    before = set(bm.faces)
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=max_sides)
    new = [f for f in bm.faces if f not in before]
    for f in new:
        f.smooth = True
        for lp in f.loops:
            if lp.vert.index in known:
                lp[uv].uv = known[lp.vert.index]
    bmesh.ops.triangulate(bm, faces=new)
    bm.to_mesh(ob.data)
    bm.free()
    print(f'{ob.name} : {len(new)} trous bouchés')


def shoe_mask(legs, rig, mat):
    """Chaussures : poids 1 sous la cheville, 0 au-dessus du col de la chaussure (pose debout), dans
    COLOR_0 (R) ; luminance de référence de la tige (texels clairs) dans recolor_ref."""
    import numpy as np
    ankle = rig.data.bones['foot_l'].head_local.z
    me = legs.data
    z = np.array([v.co.z for v in me.vertices])
    w = smooth(ankle + 0.045, ankle + 0.015, z)
    attr = me.color_attributes.new('shoe', 'FLOAT_COLOR', 'POINT')
    col = np.zeros((len(w), 4), np.float32)
    col[:, 0] = w
    col[:, 3] = 1
    attr.data.foreach_set('color', col.ravel())
    me.color_attributes.active_color = attr
    me.color_attributes.render_color_index = 0
    im = next(n.image for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE' and n.outputs['Color'].links
              and n.outputs['Color'].links[0].to_socket.name == 'Base Color')
    rgb = image_array(im)
    uv = me.uv_layers.active.data
    lums = []
    for loop in me.loops:
        if w[loop.vertex_index] > 0.9:
            u, v = uv[loop.index].uv
            px = rgb[min(int(v * im.size[1]), im.size[1] - 1), min(int(u * im.size[0]), im.size[0] - 1)]
            lum = float(srgb_to_lin(px) @ np.array(LUMA, np.float32))
            if lum > 0.35:
                lums.append(lum)
    mat['recolor_ref'] = [float(np.median(lums))]
    print(f'chaussures : {100 * (w > 0.5).mean():.0f} % des sommets des jambes, luminance de la tige {mat["recolor_ref"][0]:.3f}')


def remake_materials(objs):
    """Principled simple, sans transparence (les pièces de peau étaient en mélange alpha à cause
    des bords d'îlots UV) ; verre des lunettes translucide. Images réduites à leur côté maximal."""
    made = {}
    for ob in objs:
        old = ob.material_slots[0].material
        key = next(v[1] for k, v in PARTS.items() if v[0] == ob.name)
        if key not in made:
            nt_old = old.node_tree
            imgs = {}
            for n in nt_old.nodes:
                if n.type == 'TEX_IMAGE' and n.image and n.outputs['Color'].links:
                    imgs[n.outputs['Color'].links[0].to_socket.name if n.outputs['Color'].links[0].to_node.type == 'BSDF_PRINCIPLED' else 'Normal'] = n.image
            spec = next(v for v in PARTS.values() if v[1] == key)
            m = bpy.data.materials.new(key)
            m.use_nodes = True
            nt = m.node_tree
            p = nt.nodes['Principled BSDF']
            for sock, im in imgs.items():
                # Espace colorimétrique avant la réduction : le changer recharge l'image.
                cs = 'sRGB' if sock == 'Base Color' else 'Non-Color'
                if im.colorspace_settings.name != cs:
                    im.colorspace_settings.name = cs
                if sock == 'Base Color' and key not in ('tex_helmet', 'tex_glasses', 'tex_lens') and not im.get('padded'):
                    pad_islands(im, steps=48 if key == 'tex_jersey' else 24, warm=key == 'tex_jersey')
                    im['padded'] = True
                if im.size[0] > spec[3]:
                    im.scale(spec[3], spec[3])
                t = nt.nodes.new('ShaderNodeTexImage')
                t.image = im
                if sock == 'Normal':
                    nm = nt.nodes.new('ShaderNodeNormalMap')
                    nt.links.new(t.outputs['Color'], nm.inputs['Color'])
                    nt.links.new(nm.outputs['Normal'], p.inputs['Normal'])
                else:
                    nt.links.new(t.outputs['Color'], p.inputs[sock])
            if spec[2] is not None:
                p.inputs['Roughness'].default_value = spec[2]
                p.inputs['Metallic'].default_value = 0.0
            if key == 'tex_lens':
                p.inputs['Alpha'].default_value = 0.45
                m.surface_render_method = 'BLENDED'
            made[key] = m
            print(f'{key} : {", ".join(f"{s} {im.size[0]} px" for s, im in imgs.items())}')
            if key == 'tex_jersey':
                jersey_mask(imgs['Base Color'], m)
        ob.data.materials.clear()
        ob.data.materials.append(made[key])
        if key == 'tex_helmet':
            helmet_shell(ob, made[key])
        if key == 'tex_jersey':
            fill_holes(ob)
            jersey_coords(ob)


# ---------------------------------------------------------------------------------------------
# Pose de conduite (reprise de build_avatar.py)
# ---------------------------------------------------------------------------------------------
def ankle_target(side):
    a = 0.0 if side == 'l' else math.pi
    pedal = Vector((PEDAL_AXIS_X if side == 'l' else -PEDAL_AXIS_X, BB.y - math.cos(a) * CRANK, BB.z - math.sin(a) * CRANK))
    off = Matrix.Rotation(REST_PITCH, 3, 'X') @ ANKLE_FLAT.copy()
    return Vector((FOOT_X if side == 'l' else -FOOT_X, pedal.y + off.y, pedal.z + off.z)), pedal


def empty(name, loc_client):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.location = bl(loc_client)
    return e


def pose_rider(rig):
    set_active(rig)
    bpy.ops.object.mode_set(mode='POSE')
    pb = rig.pose.bones
    for b in pb:
        b.rotation_mode = 'QUATERNION'

    def world(name):
        bpy.context.view_layer.update()
        return rig.matrix_world @ pb[name].head

    hip_bl = bl(HIP)
    pel = pb['pelvis']
    spine = ('pelvis', 'spine_01', 'spine_02', 'spine_03')
    head_rest = pb['head'].matrix.to_3x3().normalized()

    def elevation(name):
        d = pb[name].tail - pb[name].head
        return math.degrees(math.atan2(d.z, -d.y))

    def aim(name, deg):
        bpy.context.view_layer.update()
        b = pb[name]
        r = Matrix.Rotation(-math.radians(deg - elevation(name)), 4, 'X')
        b.matrix = Matrix.Translation(b.head) @ r @ Matrix.Translation(-b.head) @ b.matrix
        bpy.context.view_layer.update()

    def torso(lean, neck_deg):
        for n in spine + ('neck_01', 'head', 'clavicle_l', 'clavicle_r'):
            pb[n].matrix_basis = Matrix.Identity(4)
        bpy.context.view_layer.update()
        m = pel.matrix.copy()
        pel.matrix = Matrix.Translation(hip_bl - m.to_translation()) @ m
        for n in spine:
            aim(n, lean + SPINE_SHAPE[n])
        # Hanches (milieu des têtes de cuisses) sur la selle : le pivot du bassin est plus haut.
        mid = (pb['thigh_l'].head + pb['thigh_r'].head) / 2
        pel.matrix = Matrix.Translation(hip_bl - mid) @ pel.matrix
        bpy.context.view_layer.update()
        for side, sg in (('l', 1), ('r', -1)):
            c = pb['clavicle_' + side]
            c.matrix_basis = Matrix.Identity(4)
            bpy.context.view_layer.update()
            r = Matrix.Rotation(-math.radians(SHOULDER_PROTRACT) * sg, 4, 'Z') @ Matrix.Rotation(-math.radians(SHOULDER_RAISE) * sg, 4, 'Y')
            c.matrix = Matrix.Translation(c.head) @ r @ Matrix.Translation(-c.head) @ c.matrix
            bpy.context.view_layer.update()
        aim('neck_01', neck_deg)
        h = pb['head']
        h.matrix = Matrix.Translation(h.head) @ (Matrix.Rotation(math.radians(HEAD_PITCH), 3, 'X') @ head_rest).to_4x4()
        bpy.context.view_layer.update()

    arm_len = rig.data.bones['upperarm_l'].length + rig.data.bones['lowerarm_l'].length
    wrist = {s: bl(Vector((HOOD.x * (1 if s == 'l' else -1), HOOD.y + 0.018, HOOD.z - 0.075))) for s in ('l', 'r')}
    best = None
    for k in range(5, 80):
        torso(k, 30)
        err = abs((world('upperarm_l') - wrist['l']).length - ARM_REACH * arm_len)
        if best is None or err < best[0]:
            best = (err, k)
    torso(best[1], NECK_DEG)
    print(f'buste : inclinaison {best[1]}°, portée à {100 * best[0]:.1f} cm près')

    for s in ('l', 'r'):
        ank, pedal = ankle_target(s)
        t = empty('ik_ankle_' + s, ank)
        pole = empty('pole_knee_' + s, Vector((ank.x * 1.15, 0.75, 0.45)))
        c = pb['calf_' + s].constraints.new('IK')
        c.target = t
        c.pole_target = pole
        c.chain_count = 2
        best_pa, best_z = 0.0, -1e9
        for pa in range(-180, 181, 15):
            c.pole_angle = math.radians(pa)
            bpy.context.view_layer.update()
            knee = cl(world('calf_' + s))
            score = knee.z - abs(knee.x - ank.x) * 2
            if score > best_z:
                best_pa, best_z = pa, score
        c.pole_angle = math.radians(best_pa)
        dt = pb['foot_' + s].constraints.new('DAMPED_TRACK')
        dt.target = empty('pedal_' + s, pedal + Vector((0, SOLE, 0.012)))
        dt.track_axis = 'TRACK_Y'
    for s in ('l', 'r'):
        # Coude en charnière : l'avant-bras ne tourne qu'autour de son axe Z (vertical en T, paumes
        # en bas), préfléchi vers l'avant ; sans cela l'IK plie le coude dans un plan quelconque
        # (pli sur le côté du bras) et le client garde ce plan de repos.
        fa = pb['lowerarm_' + s]
        fa.lock_ik_x = fa.lock_ik_y = True
        fa.rotation_quaternion = Matrix.Rotation(math.radians(-20 if s == 'l' else 20), 4, 'Z').to_quaternion()
        c = fa.constraints.new('IK')
        c.target = empty('ik_wrist_' + s, cl(wrist[s]))
        c.chain_count = 2
        # Coude vers le bas, à peine écarté du buste (ELBOW_POLE) : angle de pôle cherché.
        pole = Vector((ELBOW_POLE.x * (1 if s == 'l' else -1), ELBOW_POLE.y, ELBOW_POLE.z))
        c.pole_target = empty('pole_elbow_' + s, pole)
        best_pa, best_d = 0.0, 1e9
        for pa in range(-180, 181, 10):
            c.pole_angle = math.radians(pa)
            bpy.context.view_layer.update()
            d = (cl(world('lowerarm_' + s)) - pole).length
            if d < best_d:
                best_pa, best_d = pa, d
        c.pole_angle = math.radians(best_pa)
        dt = pb['hand_' + s].constraints.new('DAMPED_TRACK')
        dt.target = empty('hood_' + s, Vector((HOOD.x * (1 if s == 'l' else -1), HOOD.y - 0.01, HOOD.z + 0.06)))
        dt.track_axis = 'TRACK_Y'
        # Doigts refermés sur la cocotte (flexion autour de X : roulis « Z en haut » des bras).
        for f in ('index', 'middle', 'ring', 'pinky'):
            for j, ang in ((1, 35), (2, 55), (3, 35)):
                pb[f'{f}_0{j}_{s}'].rotation_quaternion = Matrix.Rotation(math.radians(ang), 4, 'X').to_quaternion()
    bpy.context.view_layer.update()
    hip_, knee_, ank_ = world('thigh_l'), world('calf_l'), world('foot_l')
    print(f'genou gauche en bas du coup de pédale : {math.degrees((hip_ - knee_).angle(ank_ - knee_)):.0f}° (180 = tendu)')
    for s in ('l', 'r'):
        print(f'cheville {s} : cible {tuple(round(c, 3) for c in bl(ankle_target(s)[0]))}, obtenue {tuple(round(c, 3) for c in world("foot_" + s))}')
    bpy.ops.object.mode_set(mode='OBJECT')



def apply_pose_as_rest(rig, meshes):
    dg = bpy.context.evaluated_depsgraph_get()
    for ob in meshes:
        dg.update()
        ev = ob.evaluated_get(dg)
        coords = [v.co.copy() for v in ev.to_mesh().vertices]
        ev.to_mesh_clear()
        for v, c in zip(ob.data.vertices, coords):
            v.co = c
    set_active(rig)
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.pose.visual_transform_apply()
    for b in rig.pose.bones:
        for c in list(b.constraints):
            b.constraints.remove(c)
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in list(bpy.data.objects):
        if o.type == 'EMPTY':
            bpy.data.objects.remove(o)


# ---------------------------------------------------------------------------------------------
# Niveaux de détail, export
# ---------------------------------------------------------------------------------------------
LODS = (('_lod1', 0.35), ('_lod2', 0.15))


def make_lods(objs):
    out = []
    for suffix, ratio in LODS:
        level = []
        for o in objs:
            if o.name == 'rider_glasses_lens':
                continue
            c = o.copy()
            c.data = o.data.copy()
            bpy.context.scene.collection.objects.link(c)
            c.name = c.data.name = o.name + suffix
            dec = c.modifiers.new('Decimate', 'DECIMATE')
            dec.ratio = ratio
            dec.use_collapse_triangulate = True
            set_active(c)
            bpy.ops.object.modifier_move_to_index(modifier='Decimate', index=0)
            bpy.ops.object.modifier_apply(modifier='Decimate')
            level.append(c)
        print(f'{suffix} : {sum(tris(o) for o in level)} triangles')
        out.append((suffix, level))
    return out


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def export(objs, path, images):
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True,
                              export_apply=False, export_animations=False, export_skins=True, export_morph=False,
                              export_materials='EXPORT', export_image_format='WEBP' if images else 'NONE',
                              export_image_quality=88, export_normals=True, export_texcoords=True,
                              export_vertex_color='ACTIVE', export_cameras=False, export_lights=False, export_extras=True)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rig, meshes = import_rig()
    lengthen_thighs(rig, meshes)
    lengthen_arms(rig, meshes)
    narrow_shoulders(rig, meshes)
    rebuild_bones(rig)
    objs = join_parts(meshes)
    remake_materials(objs)
    legs = next(o for o in objs if o.name == 'rider_legs')
    shoe_mask(legs, rig, legs.material_slots[0].material)
    lower_body_weights(rig, objs)
    arms = next(o for o in objs if o.name == 'rider_arms')
    jersey = next(o for o in objs if o.name == 'rider_jersey')
    axes = trim_arm_roots(rig, arms, jersey)

    def shoulder(co):
        S, d = axes['l' if co.x > 0 else 'r']
        return (co - S).dot(d) < 0.06

    skin_under_cloth(arms, jersey, shoulder)
    pose_rider(rig)
    apply_pose_as_rest(rig, objs)
    rig.name = rig.data.name = 'Armature'
    print('niveau 0 : ' + ', '.join(f'{o.name} {tris(o)}' for o in objs) + f' ; total {sum(tris(o) for o in objs)} triangles')
    lods = make_lods(objs)
    for name, level, images in [('rider', objs, True)] + [('rider' + sfx, lv, False) for sfx, lv in lods]:
        out = os.path.join(OUT, name + '.glb')
        raw = out if args.no_compress else os.path.join(OUT, name + '.raw.glb')
        export([rig] + level, raw, images)
        if not args.no_compress:
            subprocess.run([PNPM, '--filter', '@allezrobert/blender-tools', 'compress:avatar', os.path.abspath(raw), os.path.abspath(out)], check=True)
            os.remove(raw)
        print(f'{name} : {os.path.getsize(out) / 1e6:.2f} Mo')


main()
