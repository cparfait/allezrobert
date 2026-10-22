"""
Allez Robert ! — familles de cadres, bibliothèque de roues et de pièces (cockpits, selles).

Ce fichier est exécuté dans l'espace de noms de build_cyclist.py (exec) : il en réutilise les
outils (MB, loft, tube, kamm_sec, ell_sec, lathe_m, MATS…). Repère CLIENT partout (+x gauche,
+y haut, +z avant). Contrat des nœuds glTF : voir l'en-tête de build_cyclist.py.

Familles : aero, climb, tt, retro, retro_compact, steel, lowpro, lotus.
"""

ZONE_IDX = {'main': 0, 'rear': 1, 'fork': 2, 'head': 3}
WHEEL_TYPES = ('box', 'c35', 'c50', 'c65', 'disc', 'tri')
WHEEL_DEPTH = {'box': 0.02, 'c35': 0.035, 'c50': 0.05, 'c65': 0.065, 'disc': 0.03, 'tri': 0.05}
FAMILIES = ('aero', 'climb', 'tt', 'retro', 'retro_compact', 'steel', 'lowpro', 'lotus')
COCKPITS = ('classic', 'aero', 'light', 'wing')
SADDLES = ('race', 'min', 'comfort', 'aero', '3d')
TT_FAMILIES = ('tt', 'lowpro', 'lotus')
CLASSIC_FAMILIES = ('retro', 'retro_compact', 'steel', 'lowpro')
ROAD_HAND = V(0.2, 0.958, 0.54)
TT_HAND = V(0.066, 0.93, 0.53)
TT_PAD = V(0.10, 0.86, 0.27)

FRAME_STYLES = {
    'aero': dict(BIKE_STYLES['aero'], ss_j=0.735, st_ext=0.035, fork_type='modern', flare=True, post_type='aero'),
    'climb': dict(BIKE_STYLES['climb'], ss_j=0.735, st_ext=0.035, fork_type='modern', flare=True, post_type='round'),
    'tt': {
        'ht': (0.094, 0.082, 0.032, 0.028), 'dt': (0.072, 0.088, 0.03, 0.032), 'st': (0.072, 0.05, 0.03, 0.03),
        'tt': (0.0135, 0.0125, 0.024, 0.017), 'ss': (0.026, 0.01), 'cs': (0.0075, 0.016, 0.0055, 0.0085),
        'fork': (0.062, 0.042, 0.017, 0.013), 'post': (0.05, 0.022), 'trunc': 0.72, 'round': False,
        'ss_j': 0.62, 'st_ext': 0.035, 'fork_type': 'modern', 'flare': True, 'post_type': 'aero',
    },
    'retro': {
        'ht': (0.04, 0.04, 0.04, 0.04), 'dt': (0.042, 0.045, 0.042, 0.045), 'st': (0.032, 0.032, 0.032, 0.032),
        'tt': (0.0165, 0.016, 0.0165, 0.016), 'ss': (0.017, 0.017), 'cs': (0.009, 0.012, 0.007, 0.008),
        'fork': (0.03, 0.02, 0.03, 0.02), 'post': (0.0272, 0.0272), 'trunc': 0.9, 'round': True,
        'ss_j': 0.955, 'st_ext': 0.012, 'fork_type': 'modern', 'flare': False, 'post_type': 'chrome',
    },
    'steel': {
        'ht': (0.0318, 0.0318, 0.0318, 0.0318), 'dt': (0.0286, 0.0286, 0.0286, 0.0286), 'st': (0.0286, 0.0286, 0.0286, 0.0286),
        'tt': (0.0127, 0.0127, 0.0127, 0.0127), 'ss': (0.013, 0.013), 'cs': (0.0065, 0.011, 0.0048, 0.006),
        'fork': (0.026, 0.016, 0.017, 0.011), 'post': (0.0262, 0.0262), 'trunc': 0.9, 'round': True,
        'ss_j': 0.955, 'st_ext': 0.012, 'fork_type': 'curved', 'flare': False, 'post_type': 'chrome',
    },
    'lowpro': {
        'ht': (0.05, 0.05, 0.034, 0.034), 'dt': (0.05, 0.054, 0.03, 0.032), 'st': (0.05, 0.045, 0.028, 0.028),
        'tt': (0.016, 0.014, 0.018, 0.016), 'ss': (0.02, 0.012), 'cs': (0.0075, 0.013, 0.0055, 0.0075),
        'fork': (0.04, 0.026, 0.02, 0.013), 'post': (0.034, 0.022), 'trunc': 0.85, 'round': False,
        'ss_j': 0.955, 'st_ext': 0.012, 'fork_type': 'modern', 'flare': False, 'post_type': 'aero',
    },
}
FRAME_STYLES['retro_compact'] = dict(FRAME_STYLES['retro'])


# ---------------------------------------------------------------------------------------------
# Géométrie de base et zones
# ---------------------------------------------------------------------------------------------
class Bike:
    pass


def bike_geometry(st_len=0.49, ht_len=0.17, fa=None, ht_bot_y=0.655, steer_extra=0.03):
    g = Bike()
    g.fa = FRONT_AXLE.copy() if fa is None else np.asarray(fa, dtype=float)
    g.ra = REAR_AXLE.copy()
    g.st_dir = nrm(SADDLE - BB)
    g.st_len = st_len
    g.st_top = BB + g.st_dir * st_len
    a = math.radians(73)
    g.ht_up = V(0, math.sin(a), -math.cos(a))
    g.pf = V(0, math.cos(a), math.sin(a))
    A = g.fa - g.pf * 0.045
    s_bot = (ht_bot_y - A[1]) / g.ht_up[1]
    g.ht_bot = A + g.ht_up * s_bot
    g.ht_top = g.ht_bot + g.ht_up * ht_len
    g.steer_top = g.ht_top + g.ht_up * steer_extra
    g.bar = V(0, 0.866, 0.507)
    g.dt_dir = nrm(g.ht_bot - BB)
    nb = nrm(np.cross(g.dt_dir, V(1, 0, 0)))
    g.dt_back = nb if nb[1] > 0 else -nb
    g.st_front = nrm(V(0, 0, 1) - g.st_dir * g.st_dir[2])
    g.sp_top = BB + g.st_dir * ((0.915 - BB[1]) / g.st_dir[1])
    g.wheel_scale_f = 1.0
    return g


def zlog(zl, R, zone):
    """Mémorise l'axe d'un tube balayé (anneaux R) pour l'attribution des zones."""
    R = np.asarray(R, dtype=float)
    C = R.mean(axis=1)
    r = float(np.max(np.linalg.norm(R - C[:, None, :], axis=2)))
    zl.append((C, r, ZONE_IDX[zone]))


def zlog_pts(zl, P, r, zone):
    zl.append((np.asarray(P, dtype=float), float(r), ZONE_IDX[zone]))


def assign_zones(ob, zl):
    """Attribut de couleur « zone » (one-hot RGBA) : R avant, G arrière, B fourche, A douille."""
    me = ob.data
    vc = to_client_arr(np.array([v.co[:] for v in me.vertices]))
    N = len(vc)
    best = np.full(N, np.inf)
    zone = np.zeros(N, dtype=int)
    for C, r, z in zl:
        sd = np.full(N, np.inf)
        if len(C) == 1:
            sd = np.linalg.norm(vc - C[0], axis=1) - r
        for i in range(len(C) - 1):
            a, b = C[i], C[i + 1]
            ab = b - a
            L2 = max(float(np.dot(ab, ab)), 1e-12)
            t = np.clip(((vc - a) @ ab) / L2, 0, 1)
            d = np.linalg.norm(vc - (a + t[:, None] * ab), axis=1) - r
            sd = np.minimum(sd, d)
        m = sd < best
        best[m] = sd[m]
        zone[m] = z
    cols = np.zeros((N, 4), dtype=np.float32)
    cols[np.arange(N), zone] = 1.0
    attr = me.color_attributes.new('zone', 'FLOAT_COLOR', 'POINT')
    attr.data.foreach_set('color', cols.ravel())
    me.color_attributes.active_color = attr
    try:
        me.color_attributes.render_color_index = me.color_attributes.find('zone')
    except Exception:
        pass
    return zone


def merge_objects(objs, name, sharp=50):
    mb = MB()
    for o in objs:
        vs, fs, ms = mesh_arrays(o)
        mb.add_bl(vs, fs, ms)
    for o in objs:
        remove_obj(o)
    ob = mb.build(name, recalc=False)
    shade(ob, sharp)
    return ob


def make_empty(name, pos, rot_x=0.0, scale=(1.0, 1.0, 1.0), parent=None):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = 'ARROWS'
    e.empty_display_size = 0.05
    e.location = Vector(to_bl(pos))
    e.rotation_euler = (rot_x, 0.0, 0.0)
    e.scale = scale
    bpy.context.scene.collection.objects.link(e)
    if parent is not None:
        e.parent = parent
    return e


def decal_empty(name, center, direction, length, height, lateral):
    """Cadre de décor : axe local +Z le long du tube (sens de lecture), +Y en travers, +X latéral.
    Échelle = (étendue latérale, hauteur, longueur)."""
    d = nrm(direction)
    # Rotation autour de X dans le repère BLENDER (Z en haut) : l'axe local Z doit suivre la
    # direction du tube convertie, to_bl(d) = (x, −z, y), soit th = atan2(d_z, d_y) du repère client.
    th = math.atan2(d[2], d[1])
    return make_empty(name, center, th, (lateral, height, length))


# ---------------------------------------------------------------------------------------------
# Cadres tubulaires (aero, climb, tt, retro, steel, lowpro)
# ---------------------------------------------------------------------------------------------
def build_frame(g, sty, zl, voxel=0.0025, target=2400):
    mb = MB()
    n = 20
    Z, Y, X = V(0, 0, 1), V(0, 1, 0), V(1, 0, 0)
    tr = sty['trunc']
    rnd = sty['round']

    def sec(chord, width, fo=0.0):
        if rnd:
            return ell_sec(n, width / 2, chord / 2, 2.0, fo)
        return kamm_sec(n, chord, width, tr, fo)

    st = g.st_dir
    fo_ht = 0.0 if rnd else -0.006
    c0, c1, w0, w1 = sty['ht']
    if sty['flare']:
        R = tube(mb, [g.ht_bot + g.ht_up * 0.004, g.ht_bot + g.ht_up * 0.04, g.ht_top], 1,
                 lambda t: sec(c0 * 1.04 if t < 0.1 else lerp(c0, c1, t), max(w0, 0.056) if t < 0.1 else lerp(w0, w1, t), fo_ht), Z, 'frame')
    else:
        R = tube(mb, [g.ht_bot - g.ht_up * 0.004, g.ht_top + g.ht_up * 0.004], 1, lambda t: sec(lerp(c0, c1, t), lerp(w0, w1, t), fo_ht), Z, 'frame')
    zlog(zl, R, 'head')
    c0, c1, w0, w1 = sty['dt']
    dt_end = g.ht_bot + g.ht_up * (0.055 if sty['flare'] else 0.03) - g.pf * 0.004
    R = tube(mb, [BB + V(0, -0.006, -0.004), dt_end], 1, lambda t: sec(lerp(c0, c1, t), lerp(w0, w1, t)), Z, 'frame')
    zlog(zl, R, 'main')
    c0, c1, w0, w1 = sty['st']
    R = tube(mb, [BB - st * 0.015, BB + st * 0.2, g.st_top + st * sty['st_ext']], 1, lambda t: sec(lerp(c0, c1, t), lerp(w0, w1, t)), Z, 'frame')
    zlog(zl, R, 'main')
    a0, a1, h0, h1 = sty['tt']
    R = tube(mb, [g.ht_top - g.ht_up * (0.028 if sty['flare'] else 0.018), g.st_top + st * 0.0],
             1, lambda t: ell_sec(n, lerp(a0, a1, t), lerp(h0, h1, t), 2.0 if rnd else 2.4), Y, 'frame')
    zlog(zl, R, 'main')
    v, f, info = loft([BB + V(0.043, 0, 0), BB - V(0.043, 0, 0)], 0.022 if not rnd else 0.0205, 0.022 if not rnd else 0.0205, V(0, 1, 0), n=16)
    mb.add(v, f, 'frame')
    zlog_pts(zl, info['centers'], 0.022, 'main')
    hr = HUB_HALF[1]
    hf = HUB_HALF[0]
    sw, sh, sw1, sh1 = sty['cs']
    J = BB + st * (g.st_len * sty['ss_j'])
    for s in (1, -1):
        drop = REAR_AXLE + V((hr + 0.002) * s, 0, 0)
        R = tube(mb, [BB + V(0.025 * s, -0.003, -0.02), BB + V(0.029 * s, 0.003, -0.115), REAR_AXLE + V((hr - 0.012) * s, -0.008, 0.12),
                      drop + V(0, -0.004, 0.012)], 3, lambda t: ell_sec(12, lerp(sw, sw1, t), lerp(sh, sh1, t), 2.2), Y, 'frame')
        zlog(zl, R, 'rear')
        mid = lerp(J, drop, 0.5)
        R = tube(mb, [J + V(0.013 * s, 0, -0.004), mid + V(0.043 * s - mid[0], 0.0, 0.0), drop + V(0, 0.014, 0.0)],
                 3, lambda t: (ell_sec(12, sty['ss'][1] / 2, sty['ss'][0] / 2) if rnd else kamm_sec(12, sty['ss'][0], sty['ss'][1], tr)), Z, 'frame')
        zlog(zl, R, 'rear')
        v, f, info = loft([drop + V(0, -0.013, 0.02), drop + V(0, 0.014, -0.006)], 0.013, 0.0045, X, n=10)
        mb.add(v, f, 'frame')
        zlog_pts(zl, info['centers'], 0.012, 'rear')
        fdrop = g.fa + V((hf + 0.006) * s, 0.006, 0)
        c0, c1, w0, w1 = sty['fork']
        if sty['fork_type'] == 'modern':
            top = g.ht_bot + g.ht_up * 0.05 + V(0.016 * s, 0, 0) - g.pf * 0.004
            mid = g.ht_bot - g.ht_up * 0.16 + V(hf * s, 0, 0) + g.pf * 0.008
            pts = [top, mid, fdrop]
        else:
            # Fourche acier cintrée : fourreaux dans l'axe de direction puis courbe vers l'avant (déport).
            top = g.ht_bot - g.ht_up * 0.012 + V(0.03 * s, 0, 0)
            ax_low = g.ht_bot + g.ht_up * ((g.fa[1] + 0.09 - g.ht_bot[1]) / g.ht_up[1])
            mid = g.ht_bot - g.ht_up * 0.13 + V((hf - 0.002) * s, 0, 0)
            low = ax_low + g.pf * 0.012 + V((hf + 0.004) * s, 0, 0)
            pts = [top, mid, low, fdrop]
        R = tube(mb, pts, 3, lambda t: sec(lerp(c0, c1, t), lerp(w0, w1, t)), Z, 'frame')
        zlog(zl, R, 'fork')
        v, f, info = loft([fdrop + V(0, -0.012, 0.012), fdrop + V(0, 0.016, -0.004)], 0.012, 0.0045, X, n=10)
        mb.add(v, f, 'frame')
        zlog_pts(zl, info['centers'], 0.01, 'fork')
    if sty['fork_type'] != 'modern':
        # Té de fourche (sous la douille) peint, recouvert du té chromé (pièce fixe).
        v, f, info = loft([g.ht_bot - g.ht_up * 0.004 + V(0.04, 0, 0), g.ht_bot - g.ht_up * 0.004 - V(0.04, 0, 0)], 0.016, 0.012, Y, n=12)
        mb.add(v, f, 'frame')
        zlog_pts(zl, info['centers'], 0.014, 'fork')
    ob = mb.build('frame_union')
    remesh_union(ob, voxel, 5, 0.5)
    decimate_to(ob, target)
    shade(ob)
    return ob


def build_lotus_frame(g, zl, voxel=0.0025, target=2400):
    """Monocoque Lotus 108/110 : poutre en aile (douille → selle), lame vers le boîtier,
    bras arrière et fourche monolames côté gauche (+x)."""
    mb = MB()
    X, Y, Z = V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)
    # Douille intégrée (profil en aile profonde).
    R = tube(mb, [g.ht_bot - g.ht_up * 0.01, g.ht_top + g.ht_up * 0.01], 1, lambda t: kamm_sec(20, 0.09, 0.036, 0.8, -0.01), Z, 'frame')
    zlog(zl, R, 'head')
    # Poutre principale : de la douille vers l'arrière et vers le haut jusqu'au tube de selle.
    beam = [g.ht_top - g.ht_up * 0.04 - g.pf * 0.01, V(0, 0.775, 0.22), V(0, 0.79, 0.02), V(0, 0.81, -0.12), g.st_top + g.st_dir * 0.03]
    P = catmull(beam, 4)
    m = len(P)
    hgt = np.interp(np.linspace(0, 1, m), [0, 0.25, 0.6, 1], [0.13, 0.085, 0.07, 0.05])
    wid = np.interp(np.linspace(0, 1, m), [0, 0.5, 1], [0.034, 0.03, 0.03])
    v, f, info = loft(P, wid / 2, hgt / 2, Y, n=20, expo=2.6)
    mb.add(v, f, 'frame')
    zl.append((info['centers'], 0.04, ZONE_IDX['main']))
    # Lame vers le boîtier (aile verticale, corde le long de z).
    strut = catmull([V(0, 0.76, 0.07), V(0, 0.58, 0.045), V(0, 0.4, 0.025), BB + V(0, 0.02, 0.0)], 3)
    R = tube(mb, strut, 1, lambda t: kamm_sec(20, lerp(0.11, 0.075, t), lerp(0.03, 0.034, t), 0.85), Z, 'frame')
    zlog(zl, R, 'main')
    v, f, info = loft([BB + V(0.043, 0, 0), BB - V(0.043, 0, 0)], 0.024, 0.024, Y, n=16)
    mb.add(v, f, 'frame')
    zlog_pts(zl, info['centers'], 0.024, 'main')
    hr = HUB_HALF[1]
    s = 1
    drop = REAR_AXLE + V((hr + 0.004) * s, 0, 0)
    # Base monolame (gauche) et hauban monolame partant de la poutre.
    R = tube(mb, [BB + V(0.03, 0.0, -0.02), BB + V(0.05, 0.01, -0.13), drop + V(0, -0.002, 0.07), drop + V(0, 0, 0.004)], 3,
             lambda t: kamm_sec(14, lerp(0.05, 0.03, t), 0.018, 0.85), Z, 'frame')
    zlog(zl, R, 'rear')
    R = tube(mb, [g.st_top + g.st_dir * -0.06 + V(0.01, 0, -0.02), V(0.05, 0.62, -0.25), drop + V(0, 0.012, 0.0)], 3,
             lambda t: kamm_sec(14, lerp(0.05, 0.03, t), 0.018, 0.85), Z, 'frame')
    zlog(zl, R, 'rear')
    v, f, info = loft([drop + V(0.004, -0.02, 0.0), drop + V(0.004, 0.02, 0.0)], 0.02, 0.006, X, n=10)
    mb.add(v, f, 'frame')
    zlog_pts(zl, info['centers'], 0.02, 'rear')
    # Fourche monolame (gauche).
    hf = HUB_HALF[0]
    fdrop = g.fa + V(hf + 0.008, 0.0, 0.0)
    R = tube(mb, [g.ht_bot + g.ht_up * 0.02 + V(0.01, 0, 0), g.ht_bot - g.ht_up * 0.06 + V(0.04, 0, 0.005), g.ht_bot - g.ht_up * 0.2 + V(hf + 0.008, 0, 0.012), fdrop + V(0, 0.01, 0)], 3,
             lambda t: kamm_sec(16, lerp(0.075, 0.045, t), lerp(0.024, 0.016, t), 0.8), Z, 'frame')
    zlog(zl, R, 'fork')
    v, f, info = loft([fdrop + V(0.0, -0.016, 0.0), fdrop + V(0.0, 0.02, 0.0)], 0.018, 0.006, X, n=10)
    mb.add(v, f, 'frame')
    zlog_pts(zl, info['centers'], 0.018, 'fork')
    ob = mb.build('frame_union')
    remesh_union(ob, voxel, 5, 0.5)
    decimate_to(ob, target)
    shade(ob)
    return ob


# ---------------------------------------------------------------------------------------------
# Pièces : cockpits, selles, transmission, freins, bidons
# ---------------------------------------------------------------------------------------------
HOOD = [(0.556, 0.887, 0.861, 0.0126), (0.578, 0.898, 0.855, 0.0138), (0.600, 0.905, 0.847, 0.0142),
        (0.622, 0.910, 0.849, 0.0138), (0.638, 0.915, 0.857, 0.0122), (0.650, 0.920, 0.872, 0.0088),
        (0.657, 0.922, 0.89, 0.0066), (0.661, 0.918, 0.903, 0.0042)]
BAR_HALF = [V(0.0, 0.866, 0.507), V(0.07, 0.866, 0.51), V(0.135, 0.867, 0.518), V(0.17, 0.869, 0.53), V(0.19, 0.871, 0.55),
            V(0.198, 0.872, 0.572), V(0.201, 0.866, 0.594), V(0.204, 0.85, 0.608), V(0.207, 0.825, 0.614), V(0.211, 0.795, 0.608),
            V(0.215, 0.77, 0.588), V(0.218, 0.754, 0.56), V(0.22, 0.748, 0.528), V(0.221, 0.748, 0.49)]


def add_bolt(mb, p, axis, r=0.0028, h=0.004, n=6):
    v, f, _ = loft([p, p + nrm(axis) * h], r, r, V(0, 1, 0) if abs(nrm(axis)[1]) < 0.9 else V(1, 0, 0), n=n)
    mb.add(v, f, 'bolts')


def add_hoods(mb, lod, classic=False):
    Y, Z = V(0, 1, 0), V(0, 0, 1)
    hood = HOOD if lod == 0 else [HOOD[i] for i in (0, 2, 4, 6, 7)]
    k = 2 if lod == 0 else 1
    hz = resample([h[0] for h in hood], k)
    htop = resample([h[1] for h in hood], k)
    hbot = resample([h[2] for h in hood], k)
    hwid = resample([h[3] for h in hood], k) * (0.92 if classic else 1.0)
    nh = 8 if lod == 0 else 5
    for s in (1, -1):
        hp = catmull([V(0.2 * s, (h[1] + h[2]) / 2, h[0]) for h in hood], k)
        hsec = [ell_sec(nh, hwid[i], (htop[i] - hbot[i]) / 2, 2.5) for i in range(len(hz))]
        skin(mb, sweep_rings(hp, hsec, Y), 'components')
        # Levier : lame plate (≈ 2 cm d'avant en arrière, 1 cm d'épaisseur) qui suit la courbe du cintre.
        lever = [V(0.2 * s, 0.874, 0.65), V(0.2 * s, 0.845, 0.653), V(0.201 * s, 0.81, 0.646), V(0.203 * s, 0.78, 0.629), V(0.206 * s, 0.758, 0.604)]
        tube(mb, lever, 2 if lod == 0 else 1, lambda t: ell_sec(8, lerp(0.0115, 0.0072, t), lerp(0.0058, 0.0042, t), 2.6), Z, 'chrome' if classic else 'components')
        if lod == 0 and not classic:
            pad = [V(0.197 * s, 0.858, 0.643), V(0.196 * s, 0.83, 0.643), V(0.197 * s, 0.808, 0.634)]
            tube(mb, pad, 1, lambda t: ell_sec(6, 0.0045, 0.0022, 2.4), Z, 'chrome')


def add_computer(mb, g, lod, base=None):
    X, Y = V(1, 0, 0), V(0, 1, 0)
    b = g.bar if base is None else base
    tube(mb, [b + V(0, -0.006, 0.012), b + V(0, -0.002, 0.07)], 1, lambda t: ell_sec(8, 0.011, 0.0045, 2.6), Y, 'components')
    tilt = math.radians(10)
    du = V(0, math.sin(tilt), math.cos(tilt))
    nu = V(0, math.cos(tilt), -math.sin(tilt))
    cu = b + V(0, 0.013, 0.08)
    if lod == 0:
        tube(mb, [cu - du * 0.053, cu - du * 0.05, cu + du * 0.05, cu + du * 0.053], 1,
             lambda t: ell_sec(16, 0.027 if t in (0.0, 1.0) else 0.03, 0.0065 if t in (0.0, 1.0) else 0.0082, 4.0), nu, 'computer')
    else:
        v, f = box(cu, (0.03, 0.008, 0.052), (X, nu, du))
        mb.add(v, f, 'computer')
    v, f = box(cu + nu * 0.0084 + du * 0.006, (0.0245, 0.0005, 0.038), (X, nu, du))
    mb.add(v, f, 'computer_screen')


def build_road_cockpit(g, kind, lod, name='cockpit', ht_profile=None):
    """Cockpits route : classic | aero | light | wing (modernes, potence à serrage externe) ;
    retro (potence alu, cintre rond) ; steel (potence plongeur, cintre rond chromé)."""
    mb = MB()
    X, Y, Z = V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)
    n = 10 if lod == 0 else 6
    per = 2 if lod == 0 else 1
    silver = kind in ('retro', 'steel')
    metal = 'chrome' if silver else 'components'
    # --- Entretoises / douille au-dessus du cadre.
    if kind == 'aero':
        c1, w1 = ht_profile if ht_profile else (0.064, 0.032)
        tube(mb, [g.ht_top - g.ht_up * 0.004, g.steer_top + g.ht_up * 0.002], 1, lambda t: kamm_sec(n + 4, c1 * 0.94, w1 * 0.94, 0.72, -0.006), Z, 'spacers')
    elif kind == 'steel':
        # Écrou de jeu de direction (chromé) puis plongeur.
        v, f, _ = loft([g.ht_top - g.ht_up * 0.002, g.ht_top + g.ht_up * 0.012], 0.019, 0.019, Z, n=n + 2)
        mb.add(v, f, 'spacers')
    else:
        v, f, _ = loft([g.ht_top - g.ht_up * 0.002, g.steer_top - g.ht_up * 0.02], 0.0175, 0.0175, Z, n=n + 2)
        mb.add(v, f, 'spacers')
    # --- Potence.
    if kind == 'aero':
        tube(mb, [g.steer_top - g.ht_up * 0.012 - g.pf * 0.006, g.steer_top + V(0, 0.01, 0.055), g.bar + V(0, 0, -0.014)], per,
             lambda t: ell_sec(n, lerp(0.0145, 0.024, t ** 2), lerp(0.016, 0.0105, t), 2.8), Y, 'components')
        v, f, _ = loft([g.steer_top + g.ht_up * 0.004, g.steer_top + g.ht_up * 0.009], 0.016, 0.016, Z, n=n)
        mb.add(v, f, 'topcap')
        add_bolt(mb, g.steer_top + g.ht_up * 0.009, g.ht_up, 0.004, 0.003)
        for dx in (0.009, -0.009):
            add_bolt(mb, g.steer_top + V(dx, 0.012, 0.04), V(0, 1, 0.1), 0.0026, 0.003)
    elif kind == 'steel':
        q = g.ht_top + g.ht_up * ((0.85 - g.ht_top[1]) / g.ht_up[1])
        v, f, _ = loft([g.ht_top + g.ht_up * 0.005, q + g.ht_up * 0.008], 0.0112, 0.0112, Z, n=n)
        mb.add(v, f, 'chrome')
        tube(mb, [q, q + V(0, 0.01, 0.05), g.bar + V(0, 0, -0.012)], per, lambda t: ell_sec(n, 0.0115, 0.0125), Y, 'chrome')
        v, f, _ = loft([g.bar + V(0.022, 0, 0), g.bar - V(0.022, 0, 0)], 0.0165, 0.0165, Y, n=n)
        mb.add(v, f, 'chrome')
        v, f, _ = loft([q + g.ht_up * 0.008, q + g.ht_up * 0.012], 0.007, 0.007, Z, n=8)
        mb.add(v, f, 'topcap')
        add_bolt(mb, q + g.ht_up * 0.012, g.ht_up, 0.0035, 0.003)
    else:
        rs = 0.0125 if kind == 'light' else 0.016
        top = g.steer_top
        v, f, _ = loft([top - g.ht_up * 0.022, top + g.ht_up * 0.018], 0.0205, 0.0205, Z, n=n + 2)
        mb.add(v, f, metal)
        tube(mb, [top, top + V(0, 0.008, 0.06), g.bar + V(0, 0, -0.016)], per, lambda t: ell_sec(n, rs, lerp(rs * 1.15, rs, t)), Y, metal)
        # Façade du cintre + 4 vis.
        v, f = box(g.bar + V(0, 0, 0.012), (0.022 if kind != 'light' else 0.018, 0.019, 0.004))
        mb.add(v, f, metal)
        if lod == 0:
            for dx in (0.014, -0.014):
                for dy in (0.012, -0.012):
                    add_bolt(mb, g.bar + V(dx * (0.85 if kind == 'light' else 1), dy, 0.016), Z, 0.0026, 0.003)
        v, f, _ = loft([top + g.ht_up * 0.018, top + g.ht_up * 0.023], 0.0165, 0.0165, Z, n=n)
        mb.add(v, f, 'topcap')
        add_bolt(mb, top + g.ht_up * 0.023, g.ht_up, 0.004, 0.003)
    # --- Cintre.
    full = [p * V(-1, 1, 1) for p in reversed(BAR_HALF[1:])] + BAR_HALF
    P = catmull(full, 2 if lod == 0 else 1)
    nb = 8 if lod == 0 else 5
    ax = np.abs(P[:, 0])
    if kind in ('aero', 'wing'):
        wing = kamm_sec(nb, 0.046 if kind == 'aero' else 0.062, 0.011 if kind == 'aero' else 0.0095, 0.75)
        rnd = ell_sec(nb, 0.0122, 0.0122)
        w = smoothstep(0.12, 0.185, ax) if kind == 'aero' else smoothstep(0.15, 0.192, ax)
        secs = [wing * (1 - wi) + rnd * wi for wi in w]
        tape_x = 0.075 if kind == 'aero' else 0.15
    else:
        rc = {'classic': 0.0159, 'light': 0.0145, 'retro': 0.0145, 'steel': 0.0129}[kind]
        rr = smoothstep(0.035, 0.075, ax)
        secs = [ell_sec(nb, lerp(rc, 0.0119, ri), lerp(rc, 0.0119, ri)) for ri in rr]
        tape_x = 0.05
    R = sweep_rings(P, secs, transported_refs(P, len(P) // 2, Z))
    ia = int(np.argmax(P[:, 0] > -tape_x))
    ib = int(len(P) - 1 - np.argmax(P[::-1, 0] < tape_x))
    bar_mat = 'chrome' if silver else 'components'
    skin(mb, R, 'bar_tape', 0, ia, cap0=True, cap1=False)
    skin(mb, R, bar_mat, ia, ib, cap0=False, cap1=False)
    skin(mb, R, 'bar_tape', ib, len(P) - 1, cap0=False, cap1=True)
    if kind == 'wing':
        # Branches : seconde lame sous l'aile qui rejoint l'avant des cocottes.
        for s in (1, -1):
            br = catmull([V(0.06 * s, 0.858, 0.508), V(0.12 * s, 0.846, 0.53), V(0.175 * s, 0.842, 0.575), V(0.199 * s, 0.85, 0.6)], 2 if lod == 0 else 1)
            tube(mb, br, 1, lambda t: ell_sec(6, lerp(0.009, 0.0075, t), lerp(0.0045, 0.006, t), 2.6), Y, 'components')
    add_hoods(mb, lod, classic=silver)
    if not silver:
        add_computer(mb, g, lod)
    ob = mb.build(name)
    shade(ob, 50)
    return ob


def build_tt_cockpit(g, kind, lod, name='cockpit'):
    """Cockpit chrono : base (aile, cornes de vache pour lowpro), prolongateurs, repose-coudes."""
    mb = MB()
    X, Y, Z = V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)
    n = 10 if lod == 0 else 6
    per = 2 if lod == 0 else 1
    base_y = {'tt': 0.792, 'lowpro': 0.735, 'lotus': 0.79}[kind]
    base_z = {'tt': 0.47, 'lowpro': 0.47, 'lotus': 0.47}[kind]
    # Potence.
    v, f, _ = loft([g.ht_top - g.ht_up * 0.002, g.steer_top - g.ht_up * 0.01], 0.0175, 0.0175, Z, n=n)
    mb.add(v, f, 'spacers')
    tube(mb, [g.steer_top - g.ht_up * 0.02, g.steer_top + V(0, 0.004, 0.03), V(0, base_y, base_z - 0.012)], per,
         lambda t: ell_sec(n, lerp(0.016, 0.02, t), lerp(0.017, 0.011, t), 2.6), Y, 'components')
    v, f, _ = loft([g.steer_top - g.ht_up * 0.004, g.steer_top + g.ht_up * 0.002], 0.016, 0.016, Z, n=n)
    mb.add(v, f, 'topcap')
    add_bolt(mb, g.steer_top + g.ht_up * 0.002, g.ht_up, 0.004, 0.003)
    # Base.
    if kind == 'lowpro':
        half = [V(0.0, base_y, base_z), V(0.08, base_y, base_z), V(0.16, base_y + 0.002, base_z + 0.01), V(0.19, base_y + 0.01, base_z + 0.05),
                V(0.195, base_y + 0.03, base_z + 0.11), V(0.195, base_y + 0.05, base_z + 0.15)]
    else:
        half = [V(0.0, base_y, base_z), V(0.09, base_y, base_z + 0.002), V(0.16, base_y - 0.004, base_z + 0.012), V(0.195, base_y - 0.012, base_z + 0.04),
                V(0.205, base_y - 0.03, base_z + 0.08)]
    full = [p * V(-1, 1, 1) for p in reversed(half[1:])] + half
    P = catmull(full, per)
    nb = 8 if lod == 0 else 5
    if kind == 'lowpro':
        secs = [ell_sec(nb, 0.0125, 0.0125) for _ in P]
    else:
        wing = kamm_sec(nb, 0.05, 0.014, 0.75)
        rnd = ell_sec(nb, 0.0115, 0.0115)
        w = smoothstep(0.15, 0.2, np.abs(P[:, 0]))
        secs = [wing * (1 - wi) + rnd * wi for wi in w]
    R = sweep_rings(P, secs, transported_refs(P, len(P) // 2, Z))
    ia = int(np.argmax(P[:, 0] > -0.17))
    ib = int(len(P) - 1 - np.argmax(P[::-1, 0] < 0.17))
    skin(mb, R, 'bar_tape', 0, ia, cap0=True, cap1=False)
    skin(mb, R, 'components', ia, ib, cap0=False, cap1=False)
    skin(mb, R, 'bar_tape', ib, len(P) - 1, cap0=False, cap1=True)
    hand = TT_HAND.copy()
    pad = TT_PAD.copy()
    for s in (1, -1):
        end = half[-1] * V(s, 1, 1)
        # Leviers de frein dans les embouts de la base : corps cylindrique puis lame plate vers
        # l'avant, légèrement plongeante (comme les leviers chrono intégrés aux cornes).
        d = nrm(half[-1] - half[-2]) * V(s, 1, 1)
        v, f, _ = loft([end - d * 0.004, end + d * 0.018], 0.0125, 0.0115, Y if abs(d[1]) < 0.9 else Z, n=n)
        mb.add(v, f, 'components')
        tip0 = end + d * 0.018
        lv = [tip0, tip0 + V(0.001 * s, -0.004, 0.03), tip0 + V(0.002 * s, -0.012, 0.062), tip0 + V(0.002 * s, -0.02, 0.078)]
        tube(mb, lv, per, lambda t: ell_sec(8, lerp(0.0095, 0.007, t), lerp(0.0045, 0.0035, t), 2.6), Y, 'components')
        # Repose-coude : coque + support + colonne vers la base.
        pc = V(pad[0] * s, pad[1] - 0.009, pad[2])
        v, f, _ = ellipsoid(pc, (V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)), (0.04, 0.011, 0.055), 14 if lod == 0 else 8, 6 if lod == 0 else 4)
        mb.add(v, f, 'pad')
        v, f = box(pc + V(0, -0.012, 0), (0.035, 0.0035, 0.05))
        mb.add(v, f, 'components')
        riser = [pc + V(0, -0.014, 0.03), V(0.095 * s, base_y + 0.03, base_z - 0.06), V(0.09 * s, base_y + 0.006, base_z - 0.01)]
        tube(mb, riser, 1, lambda t: ell_sec(8, 0.011, 0.014), Y, 'components')
        # Prolongateur : sous la coque, vers l'avant, pointe relevée (« ski »).
        ext = [V(0.078 * s, 0.846, 0.24), V(0.072 * s, 0.852, 0.36), V(0.067 * s, 0.868, 0.48), V(0.066 * s, 0.882, 0.58),
               V(0.066 * s, 0.9, 0.635), V(0.067 * s, 0.928, 0.668)]
        Pe = catmull(ext, per)
        Re = sweep_rings(Pe, [ell_sec(8 if lod == 0 else 5, 0.0112, 0.0112) for _ in Pe], transported_refs(Pe, 0, Y))
        k = int(np.argmax(Pe[:, 2] > 0.52))
        skin(mb, Re, 'components', 0, k, cap0=True, cap1=False)
        skin(mb, Re, 'bar_tape', k, len(Pe) - 1, cap0=False, cap1=True)
        # Manette au bout.
        tip = Pe[-1]
        v, f, _ = loft([tip, tip + V(0, 0.022, 0.006)], 0.008, 0.006, Z, n=6)
        mb.add(v, f, 'components')
    # Compteur entre les prolongateurs.
    if lod == 0:
        v, f = box(V(0, 0.862, 0.44), (0.025, 0.007, 0.04), (X, nrm(V(0, 1, -0.2)), nrm(V(0, 0.2, 1))))
        mb.add(v, f, 'computer')
        v, f = box(V(0, 0.8695, 0.442), (0.021, 0.0006, 0.032), (X, nrm(V(0, 1, -0.2)), nrm(V(0, 0.2, 1))))
        mb.add(v, f, 'computer_screen')
    ob = mb.build(name)
    shade(ob, 50)
    return ob, hand, pad


SADDLE_SHAPES = {
    # (z, demi-largeur, dessus, dessous)
    'race': [(-0.33, 0.05, 0.95, 0.935), (-0.322, 0.068, 0.957, 0.93), (-0.29, 0.072, 0.96, 0.928), (-0.25, 0.065, 0.958, 0.928),
             (-0.205, 0.047, 0.955, 0.93), (-0.165, 0.031, 0.954, 0.932), (-0.125, 0.025, 0.953, 0.933), (-0.098, 0.021, 0.951, 0.936),
             (-0.088, 0.012, 0.946, 0.94)],
    'min': [(-0.335, 0.05, 0.948, 0.94), (-0.326, 0.066, 0.951, 0.939), (-0.29, 0.068, 0.952, 0.94), (-0.25, 0.06, 0.951, 0.94),
            (-0.2, 0.04, 0.95, 0.941), (-0.155, 0.025, 0.95, 0.942), (-0.11, 0.019, 0.949, 0.943), (-0.075, 0.016, 0.947, 0.943),
            (-0.066, 0.01, 0.944, 0.942)],
    'comfort': [(-0.335, 0.06, 0.955, 0.928), (-0.326, 0.08, 0.966, 0.924), (-0.29, 0.085, 0.97, 0.922), (-0.25, 0.076, 0.967, 0.922),
                (-0.205, 0.054, 0.962, 0.925), (-0.165, 0.036, 0.959, 0.928), (-0.125, 0.029, 0.957, 0.93), (-0.096, 0.024, 0.955, 0.933),
                (-0.086, 0.014, 0.95, 0.938)],
    'aero': [(-0.33, 0.06, 0.95, 0.932), (-0.322, 0.076, 0.957, 0.928), (-0.29, 0.079, 0.96, 0.926), (-0.25, 0.072, 0.958, 0.926),
             (-0.21, 0.058, 0.955, 0.928), (-0.17, 0.048, 0.953, 0.93), (-0.14, 0.044, 0.952, 0.932), (-0.12, 0.036, 0.95, 0.935),
             (-0.112, 0.022, 0.946, 0.938)],
}
SADDLE_SHAPES['3d'] = SADDLE_SHAPES['aero']


def build_saddle(kind, lod, name='saddle'):
    mb = MB()
    Y = V(0, 1, 0)
    S = SADDLE_SHAPES[kind]
    k = 2 if lod == 0 else 1
    sp = catmull([V(0, (s[2] + s[3]) / 2, s[0]) for s in S], k)
    v, f, _ = loft(sp, resample([s[1] for s in S], k), resample([(s[2] - s[3]) / 2 for s in S], k), Y, n=12 if lod == 0 else 6, expo=3.0)
    if kind == '3d':
        # Dessus (normales vers le haut) en « saddle_lattice », coque dessous en « saddle ».
        vv = np.asarray(v)
        mats = []
        for fc in f:
            c = vv[list(fc)].mean(0)
            nrm_up = True
            if len(fc) >= 3:
                a, b, cc = vv[fc[0]], vv[fc[1]], vv[fc[2]]
                nn = np.cross(b - a, cc - a)
                cen_y = np.interp(c[2], [s[0] for s in S], [(s[2] + s[3]) / 2 for s in S])
                nrm_up = c[1] > cen_y + 0.001
            mats.append('saddle_lattice' if nrm_up else 'saddle')
        add_m(mb, v, f, mats)
    else:
        mb.add(v, f, 'saddle')
    if lod == 0:
        v, f = box(V(0, 0.921, -0.215), (0.022, 0.008, 0.024))
        mb.add(v, f, 'components')
        for s in (1, -1):
            rail = catmull([V(0.03 * s, 0.933, -0.31), V(0.034 * s, 0.914, -0.25), V(0.033 * s, 0.914, -0.16), V(0.016 * s, 0.936, -0.1)], 2)
            v, f, _ = loft(rail, 0.0036, 0.0045, Y, n=4)
            mb.add(v, f, 'components')
    ob = mb.build(name)
    shade(ob, 40)
    return ob


def build_bottle(mb, base, axis, mount, lod, cage=True):
    n = 10 if lod == 0 else 6
    L = 0.205
    ts = [0.0, 0.012, 0.1, 0.15, 0.172]
    rs = [0.031, 0.0365, 0.0345, 0.0365, 0.033]
    if lod:
        ts, rs = [0.0, 0.012, 0.15, 0.172], [0.031, 0.0365, 0.0365, 0.033]
    v, f, _ = loft([base + axis * t for t in ts], rs, rs, mount, n=n)
    mb.add(v, f, 'bottle')
    v, f, _ = loft([base + axis * t for t in (0.17, 0.19, 0.198, L)], [0.031, 0.025, 0.012, 0.008], [0.031, 0.025, 0.012, 0.008], mount, n=n)
    mb.add(v, f, 'components')
    if cage:
        lat = nrm(np.cross(axis, mount))
        for sgn in ((1, -1) if lod == 0 else (1, -1)):
            rail = [base + axis * t + mount * 0.026 + lat * sgn * 0.027 for t in (0.004, 0.06, 0.12, 0.155)]
            rail[0] = rail[0] - mount * 0.012
            v, f, _ = loft(rail if lod == 0 else [rail[0], rail[-1]], 0.0035, 0.0018, lat * sgn, n=4)
            mb.add(v, f, 'cage')
        if lod == 0:
            v, f, _ = loft([base - axis * 0.004 + mount * 0.04, base - axis * 0.004 - mount * 0.012], 0.012, 0.0025, axis, n=4)
            mb.add(v, f, 'cage')
            v, f, _ = loft([base + axis * 0.03 + mount * 0.034, base + axis * 0.14 + mount * 0.034], 0.009, 0.003, mount, n=4)
            mb.add(v, f, 'cage')


def build_bottles(g, sty, lod, single=False):
    mb = MB()
    build_bottle(mb, BB + g.dt_dir * 0.085 + g.dt_back * (sty['dt'][0] / 2 + 0.043), g.dt_dir, -g.dt_back, lod)
    if not single:
        build_bottle(mb, BB + g.st_dir * 0.215 + g.st_front * (sty['st'][0] / 2 + 0.043), g.st_dir, -g.st_front, lod)
    ob = mb.build('opt_bottles')
    shade(ob, 40)
    return ob


def chain_path():
    R1 = 0.105
    ring = [V(CHAIN_X, BB[1] + R1 * math.sin(a), R1 * math.cos(a)) for a in np.linspace(math.pi / 2, -math.pi / 2, 14)]
    UP = V(CHAIN_X, REAR_AXLE[1] - 0.052, REAR_AXLE[2] - 0.004)
    LP = V(CHAIN_X, REAR_AXLE[1] - 0.122, REAR_AXLE[2] + 0.018)
    PR = 0.019
    cog = 0.041
    chain = ring + [LP + V(0, -PR, 0.006), LP + V(0, -0.004, -PR), UP + V(0, 0.0, PR * 0.9), UP + V(0, PR * 0.8, -0.008),
                    V(CHAIN_X, REAR_AXLE[1] - 0.012, REAR_AXLE[2] - cog), V(CHAIN_X, REAR_AXLE[1] + 0.028, REAR_AXLE[2] - 0.03),
                    V(CHAIN_X, REAR_AXLE[1] + cog, REAR_AXLE[2])]
    return chain + [ring[0]], UP, LP, PR


def add_chain(mb, lod):
    chain, UP, LP, PR = chain_path()
    if lod:
        chain = chain[::2] + [chain[-1]]
    v, f, _ = loft(catmull(chain, 1), 0.0045, 0.0034, V(1, 0, 0), n=4)
    mb.add(v, f, 'chain')


def build_derailleurs(g, lod, classic=False):
    mb = MB()
    X, Y = V(1, 0, 0), V(0, 1, 0)
    hr = HUB_HALF[1]
    body = 'chrome' if classic else 'components'
    _, UP, LP, PR = chain_path()
    for c in (LP, UP):
        v, f, _ = loft([c + V(0.003, 0, 0), c - V(0.003, 0, 0)], PR, PR, Y, n=12 if lod == 0 else 6)
        mb.add(v, f, 'pulley')
        if lod == 0:
            v, f, _ = loft([c - V(0.0085, 0, 0), c - V(0.0105, 0, 0)], 0.0055, 0.0055, Y, n=6)
            mb.add(v, f, 'bolts')
    for dx in ((-0.0075, 0.0075) if lod == 0 else (-0.0075,)):
        v, f, _ = loft([UP + V(dx, 0.004, 0.0), LP + V(dx, -0.004, 0.0)], 0.017, 0.0016, X, n=8 if lod == 0 else 4)
        mb.add(v, f, body)
    kb = REAR_AXLE + V(-(hr + 0.008), -0.012, -0.016)
    kp = UP + V(-0.016, 0.006, -0.02)
    v, f, _ = loft(catmull([kb, kb + V(-0.004, -0.014, -0.022), kp], 2 if lod == 0 else 1), 0.013, 0.016, X, n=10 if lod == 0 else 5, expo=2.6)
    mb.add(v, f, body)
    fdb = BB + g.st_dir * 0.125 + V(-0.024, 0, 0) - g.st_front * 0.012
    v, f = box(fdb, (0.011, 0.016, 0.014), (X, g.st_dir, g.st_front))
    mb.add(v, f, body)
    arc = [V(-0.053, BB[1] + 0.113 * math.cos(a), -0.113 * math.sin(a)) for a in np.linspace(math.radians(5), math.radians(42), 5 if lod == 0 else 3)]
    v, f, _ = loft(arc, 0.011, 0.0016, X, n=6 if lod == 0 else 4)
    mb.add(v, f, body)
    ob = mb.build('opt_derailleur')
    shade(ob, 40)
    return ob


def build_disc_brakes(g, lod):
    mb = MB()
    X = V(1, 0, 0)
    for axle, side, rr, ang, anc in ((g.fa, ROTOR_X[0], ROTOR_R[0], math.radians(160), V(0.054, 0.05, -0.022)),
                                     (REAR_AXLE, ROTOR_X[1], ROTOR_R[1], math.radians(28), V(0.062, -0.002, 0.075))):
        rc = rr - 0.006
        arcp = [axle + V(side, rc * math.sin(a), rc * math.cos(a)) for a in np.linspace(ang - 0.36, ang + 0.36, 5 if lod == 0 else 3)]
        v, f, _ = loft(arcp, [0.008, 0.012, 0.0125, 0.012, 0.008] if lod == 0 else [0.008, 0.0125, 0.008], 0.013, X, n=8 if lod == 0 else 4, expo=3.0)
        mb.add(v, f, 'caliper')
        v, f, _ = loft([arcp[len(arcp) // 2] + V(0.006, 0, 0), axle + anc], 0.007, 0.006, X, n=6 if lod == 0 else 4)
        mb.add(v, f, 'components')
        if lod == 0:
            for hh, rad in ((HUB_HALF[0] + 0.011, 0.011) if axle is g.fa else (HUB_HALF[1] + 0.008, 0.011),):
                v, f, _ = loft([axle + V(hh, 0, 0), axle + V(hh + 0.006, 0, 0)], rad, rad, V(0, 1, 0), n=8)
                mb.add(v, f, 'components')
    ob = mb.build('opt_brakes_disc')
    shade(ob, 40)
    return ob


def rim_caliper(mb, axle, toward, wheel_r, lod, mount_len=0.02):
    """Étrier sur jante (double pivot) : bras de part et d'autre du pneu, pont au-dessus."""
    X = V(1, 0, 0)
    d = nrm(toward - axle)
    d = nrm(V(0, d[1], d[2]))
    tng = nrm(np.cross(X, d))
    top = axle + d * (wheel_r + 0.022)
    n = 6 if lod == 0 else 4
    for s in (1, -1):
        arm = [axle + d * (wheel_r - 0.045) + X * 0.016 * s, axle + d * (wheel_r - 0.01) + X * 0.024 * s, top + X * 0.02 * s + d * 0.004]
        tube(mb, arm, 1, lambda t: ell_sec(n, 0.006, lerp(0.009, 0.006, t), 2.4), tng, 'caliper')
        v, f = box(axle + d * (wheel_r - 0.04) + X * 0.011 * s, (0.003, 0.004, 0.012), (X, d, tng))
        mb.add(v, f, 'components')
    v, f, _ = loft([top + X * 0.022, top - X * 0.022], 0.007, 0.006, d, n=n)
    mb.add(v, f, 'caliper')
    v, f, _ = loft([top, top + d * mount_len], 0.004, 0.004, X, n=n)
    mb.add(v, f, 'bolts')


def build_rim_brakes(g, lod, rear_target=None, wheel_r_f=None):
    mb = MB()
    crown = g.ht_bot - g.ht_up * 0.01
    rim_caliper(mb, g.fa, crown, wheel_r_f if wheel_r_f else WHEEL_R - 0.02, lod, 0.02)
    tgt = rear_target if rear_target is not None else (BB + g.st_dir * (g.st_len * 0.9))
    rim_caliper(mb, REAR_AXLE, tgt, WHEEL_R - 0.02, lod, 0.02)
    ob = mb.build('opt_brakes_rim')
    shade(ob, 40)
    return ob


def build_dt_shifters(g, lod):
    mb = MB()
    X = V(1, 0, 0)
    p = BB + g.dt_dir * (np.linalg.norm(g.ht_bot - BB) - 0.11)
    v, f, _ = loft([p + X * 0.02, p - X * 0.02], 0.008, 0.008, g.dt_dir, n=8)
    mb.add(v, f, 'chrome')
    for s in (1, -1):
        lev = [p + X * 0.02 * s, p + X * 0.026 * s - g.dt_back * 0.01 + g.dt_dir * 0.01, p + X * 0.03 * s - g.dt_back * 0.04 + g.dt_dir * 0.03]
        v, f, _ = loft(lev, 0.005, 0.0022, X, n=4)
        mb.add(v, f, 'chrome')
    ob = mb.build('opt_shifters_dt')
    shade(ob, 40)
    return ob


def tooth_ring(mb, x0, x1, r_tip, r_root, r_in, teeth, mat_teeth, mat_body, r_mid=None):
    pts = [(r_tip if k % 2 == 0 else r_root, math.pi * k / teeth) for k in range(teeth * 2)]
    nn = len(pts)
    r_mid = r_mid or (r_root - 0.006)
    verts = []
    for x in (x0, x1):
        for r, a in pts:
            verts.append(V(x, r * math.cos(a), r * math.sin(a)))
        for r, a in pts:
            verts.append(V(x, r_mid * math.cos(a), r_mid * math.sin(a)))
        for r, a in pts:
            verts.append(V(x, r_in * math.cos(a), r_in * math.sin(a)))
    faces, mats = [], []
    o0, m0, i0, o1, m1, i1 = 0, nn, 2 * nn, 3 * nn, 4 * nn, 5 * nn
    for k in range(nn):
        k2 = (k + 1) % nn
        faces += [(o0 + k, o0 + k2, m0 + k2, m0 + k), (m0 + k, m0 + k2, i0 + k2, i0 + k),
                  (o1 + k, i1 + k, i1 + k2, o1 + k2),
                  (o0 + k, o1 + k, o1 + k2, o0 + k2), (i0 + k, i0 + k2, i1 + k2, i1 + k)]
        mats += [mat_teeth, mat_body, mat_body, mat_teeth, mat_body]
    add_m(mb, verts, faces, mats)


def build_crankset(lod=0, classic=False):
    """Pédalier : moderne (4 bras, capteur ; matériaux crank / chainring) ou classique 5 bras chromé."""
    mb = MB()
    ring_m = 'chrome' if classic else 'chainring'
    arm_m = 'chrome' if classic else 'crank'
    if lod == 0:
        tooth_ring(mb, -0.0475, -0.0445, 0.1065, 0.1015, 0.07, 28, ring_m, ring_m, 0.097)
        v, f = lathe([(0.058, -0.0375), (0.0745, -0.0375), (0.0745, -0.0405), (0.058, -0.0405)], 24)
        mb.add(v, f, ring_m)
    else:
        v, f = lathe([(0.07, -0.0445), (0.105, -0.0445), (0.105, -0.0475), (0.07, -0.0475)], 16)
        mb.add(v, f, ring_m)
        v, f = lathe([(0.058, -0.0375), (0.075, -0.0375), (0.075, -0.0405), (0.058, -0.0405)], 10)
        mb.add(v, f, ring_m)
    angs = [math.radians(a) for a in ((30, 115, 210, 295) if not classic else (18, 90, 162, 234, 306))]
    for a in angs:
        d = V(0, math.cos(a), math.sin(a))
        v, f, _ = loft([V(-0.047, 0, 0) + d * 0.016, V(-0.047, 0, 0) + d * (0.075 if not classic else 0.068)], [0.016, 0.009] if not classic else [0.012, 0.008],
                       0.0045, V(1, 0, 0), n=6 if lod == 0 else 4)
        mb.add(v, f, arm_m if classic else 'components')
    if lod == 0 and not classic:
        v, f = lathe([(0.016, -0.042), (0.03, -0.042), (0.03, -0.05), (0.016, -0.05)], 12)
        mb.add(v, f, 'components')
        v, f = box(V(-0.04, 0.035, -0.022), (0.004, 0.012, 0.014), (V(1, 0, 0), nrm(V(0, 1, -0.6)), nrm(V(0, 0.6, 1))))
        mb.add(v, f, 'components')
    v, f, _ = loft([V(0.07, 0, 0), V(-0.07, 0, 0)], 0.012, 0.012, V(0, 1, 0), n=12 if lod == 0 else 6)
    mb.add(v, f, 'chrome')
    for s in (1, -1):
        dy = -1.0 if s > 0 else 1.0
        arm = [V(0.058 * s, 0, 0), V(0.064 * s, dy * CRANK * 0.45, 0), V(PEDAL_AXIS_X * s - 0.004 * s, dy * CRANK, 0)]
        rw = [0.02, 0.0135, 0.0125] if not classic else [0.016, 0.012, 0.011]
        v, f, _ = loft(arm, rw, [0.012, 0.0095, 0.008], V(1, 0, 0), n=12 if lod == 0 else 6, expo=3.0 if not classic else 2.4)
        mb.add(v, f, arm_m)
        if lod == 0:
            v, f, _ = loft([V(0.066 * s, 0, 0), V(0.072 * s, 0, 0)], 0.014, 0.014, V(0, 1, 0), n=10)
            mb.add(v, f, 'bolts' if not classic else 'chrome')
    ob = mb.build('crankset')
    ob.location = Vector(to_bl(BB))
    shade(ob, 40)
    return ob


def build_pedal(tag, lod=0, kind='clipless', toeclips=False):
    s = 1 if tag == 'L' else -1
    mb = MB()
    off = (PEDAL_X - PEDAL_AXIS_X) * s
    v, f, _ = loft([V(0, 0, 0), V(off + 0.022 * s, 0, 0)], 0.006, 0.006, V(0, 1, 0), n=8 if lod == 0 else 4)
    mb.add(v, f, 'chrome')
    if kind == 'clipless':
        v, f, _ = loft([V(0.004 * s, 0, 0), V(0.012 * s, 0, 0), V(0.016 * s, 0, 0)], [0.012, 0.012, 0.009], [0.012, 0.012, 0.009], V(0, 1, 0), n=10 if lod == 0 else 5)
        mb.add(v, f, 'components')
        pts = [V(off, 0.001, -0.038), V(off, 0, -0.022), V(off, 0, 0.018), V(off, 0, 0.048), V(off, 0.002, 0.06)]
        v, f, _ = loft(pts, [0.024, 0.033, 0.036, 0.029, 0.016], [0.008, 0.0105, 0.0105, 0.0085, 0.006], V(0, 1, 0), n=10 if lod == 0 else 6, expo=2.6)
        mb.add(v, f, 'components')
        if lod == 0:
            v, f = box(V(off, 0.0098, 0.0), (0.022, 0.0012, 0.026))
            mb.add(v, f, 'chrome')
    else:
        # Pédale à cage (acier) : corps central + deux flasques dentelées.
        v, f, _ = loft([V(off - 0.04 * s, 0, 0), V(off + 0.04 * s, 0, 0)], 0.009, 0.009, V(0, 1, 0), n=8 if lod == 0 else 4)
        mb.add(v, f, 'chrome')
        for zz in (-0.035, 0.035):
            v, f = box(V(off, 0.0, zz), (0.04, 0.009, 0.0022))
            mb.add(v, f, 'chrome')
    ob = mb.build(f'pedal_{tag}')
    ang = 0.0 if s > 0 else math.pi
    ob.location = Vector(to_bl(V(PEDAL_AXIS_X * s, BB[1] - math.cos(ang) * CRANK, -math.sin(ang) * CRANK)))
    ob.rotation_euler = (REST_PITCH, 0, 0)
    shade(ob, 40)
    out = [ob]
    if toeclips:
        tb = MB()
        loop = catmull([V(off - 0.035 * s, 0.002, 0.04), V(off - 0.02 * s, 0.01, 0.085), V(off, 0.045, 0.1), V(off + 0.02 * s, 0.01, 0.085),
                        V(off + 0.035 * s, 0.002, 0.04)], 2 if lod == 0 else 1)
        v, f, _ = loft(loop, 0.006, 0.0018, V(0, 0, 1), n=4)
        tb.add(v, f, 'chrome')
        strap = catmull([V(off - 0.04 * s, -0.004, 0.0), V(off - 0.044 * s, 0.05, 0.04), V(off, 0.075, 0.05), V(off + 0.044 * s, 0.05, 0.04),
                         V(off + 0.04 * s, -0.004, 0.0)], 2 if lod == 0 else 1)
        v, f, _ = loft(strap, 0.0016, 0.009, V(0, 0, 1), n=4)
        tb.add(v, f, 'components')
        tc = tb.build(f'opt_toeclips_{tag}')
        tc.parent = ob
        shade(tc, 40)
        out.append(tc)
    return out


# ---------------------------------------------------------------------------------------------
# Bibliothèque de roues
# ---------------------------------------------------------------------------------------------
def build_wheel_lib(typ, front, lod=0):
    name = f"wheel_{typ}_{'F' if front else 'R'}"
    mb = MB()
    n = 28 if lod == 0 else 12
    X = V(1, 0, 0)
    # Pneu : bande de roulement + flancs.
    rc, ar, ax = WHEEL_R - 0.0135, 0.0135, 0.0143
    kt = 6 if lod == 0 else 4
    angs = np.linspace(0, 2 * math.pi, kt + 1)[:-1]
    tire = [(rc + ar * math.cos(a), ax * math.sin(a)) for a in angs]
    mats = []
    for j in range(kt):
        am = (angs[j] + (angs[(j + 1) % kt] if j + 1 < kt else 2 * math.pi)) / 2
        mats.append('tire' if math.cos(am) > 0.55 else 'tire_wall')
    v, f, mm = lathe_m(tire, mats, n)
    add_m(mb, v, f, mm)
    D = WHEEL_DEPTH[typ]
    r0, r1 = 0.3135, 0.311 - D
    if typ == 'box':
        half = [(0.0, 0.0105), (0.25, 0.0108), (0.6, 0.0102), (1.0, 0.0)]
        body = 'chrome'
    else:
        half = [(0.0, 0.0122), (0.12, 0.0152), (0.4, 0.0154), (0.6, 0.015), (1.0, 0.0)]
        if lod:
            half = [(0.0, 0.0122), (0.45, 0.0154), (1.0, 0.0)]
        body = 'rim'
    if lod and typ == 'box':
        half = [(0.0, 0.0105), (0.45, 0.0108), (1.0, 0.0)]
    prof = [(r0 - t * (r0 - r1), w) for t, w in half] + [(r0 - t * (r0 - r1), -w) for t, w in reversed(half[:-1])]
    segm = []
    lo, hi = (0.2, 0.7) if typ == 'box' else (0.39, 0.61)
    if lod:
        lo, hi = 0.15, 0.75
    for j in range(len(prof)):
        a, b = prof[j], prof[(j + 1) % len(prof)]
        rm = (a[0] + b[0]) / 2
        tm = (r0 - rm) / (r0 - r1)
        segm.append('rim_decal' if lo < tm < hi and abs(a[1]) > 0.008 and abs(b[1]) > 0.008 and a[1] * b[1] > 0 else body)
    if typ == 'disc':
        # Lenticulaire : flancs bombés du bord de jante au moyeu ; bande décor près du bord.
        hub_x = 0.028 if not front else 0.024
        rr = np.linspace(r0 - 0.004, 0.03, 9 if lod == 0 else 5)
        side = [(r, 0.0118 + (hub_x - 0.0118) * ((r0 - r) / (r0 - 0.03)) ** 1.6) for r in rr]
        prof = side + [(r, -w) for r, w in reversed(side)]
        segm = []
        for j in range(len(prof)):
            a, b = prof[j], prof[(j + 1) % len(prof)]
            rm = (a[0] + b[0]) / 2
            segm.append('rim_decal' if (r0 - 0.04) < rm < (r0 - 0.012) and a[1] * b[1] > 0 else 'rim')
    v, f, mm = lathe_m(prof, segm, n)
    add_m(mb, v, f, mm)
    hh = HUB_HALF[0 if front else 1] - 0.002
    flL = 0.034 if front else 0.036
    flR = 0.034 if front else 0.021
    fr_r = 0.023 if typ != 'box' else 0.03
    hub = [(0.008, hh), (0.013, hh - 0.004), (0.014, flL + 0.004), (fr_r, flL + 0.0015), (fr_r, flL - 0.0015), (0.015, flL - 0.005),
           (0.015, -flR + 0.005), (fr_r, -flR + 0.0015), (fr_r, -flR - 0.0015), (0.014, -flR - 0.004), (0.013, -hh + 0.004), (0.008, -hh)]
    if lod:
        hub = [hub[0], hub[3], hub[8], hub[11]]
    v, f = lathe(hub, 8 if lod == 0 else 6, closed=True)
    mb.add(v, f, 'hub')
    if typ == 'tri':
        for k in range(3):
            a = 2 * math.pi * k / 3 + 0.3
            d = V(0, math.cos(a), math.sin(a))
            pth = [d * 0.02, d * 0.12, d * (r1 + 0.004)]
            v, f, _ = loft(pth, [0.03, 0.022, 0.024], [0.017, 0.011, 0.012], X, n=10 if lod == 0 else 6, expo=2.4)
            mb.add(v, f, 'rim')
    elif typ != 'disc' and lod == 0:
        ns = 32 if typ == 'box' else (20 if front else 24)
        for k in range(ns):
            a = 2 * math.pi * (k + 0.5) / ns
            sx = flL if k % 2 else -flR
            a2 = a + (0.13 if k % 2 else -0.13)
            p0 = V(sx, (fr_r - 0.002) * math.cos(a2), (fr_r - 0.002) * math.sin(a2))
            p1 = V(0.0, (r1 + 0.002) * math.cos(a), (r1 + 0.002) * math.sin(a))
            if typ == 'box':
                v, f, _ = loft([p0, p1], 0.0009, 0.0009, V(1, 0, 0), n=3, cap=False)
            else:
                v, f, _ = loft([p0, p1], 0.0012, 0.0005, V(1, 0, 0), n=4, cap=False)
            mb.add(v, f, 'spokes')
    # Valve (bouchon) à l'intérieur de la jante.
    av = 2 * math.pi * 0.5 / (32 if typ == 'box' else 24)
    dv = V(0, math.cos(av), math.sin(av))
    rv = r1 if typ not in ('disc',) else r0 - 0.045
    if typ == 'disc':
        v, f, _ = loft([dv * rv + X * 0.012, dv * rv + X * 0.017], 0.0045, 0.0045, dv, n=6)
    else:
        v, f, _ = loft([dv * (rv + 0.004), dv * (rv - 0.016)], 0.0035, 0.0035, X, n=6)
    mb.add(v, f, 'valve')
    if not front:
        teeth = [34, 30, 27, 24, 21, 19, 17, 15, 13, 11] if lod == 0 else [34, 24, 17, 11]
        pitch = 0.041 / (len(teeth) - 1)
        cas = [(0.016, -0.029)]
        for i, tth in enumerate(teeth):
            r = 0.0127 * tth / (2 * math.pi) + 0.0035
            x = -0.031 - i * pitch
            cas += [(r, x), (r, x - (0.0018 if lod == 0 else 0.006))]
        cas += [(0.016, cas[-1][1])]
        v, f = lathe(cas, 14 if lod == 0 else 6, closed=True)
        mb.add(v, f, 'cassette')
    ob = mb.build(name)
    shade(ob, 40)
    # Disque de frein (enfant, masquable).
    rb = MB()
    rx_ = ROTOR_X[0 if front else 1]
    rr = ROTOR_R[0 if front else 1]
    v, f = lathe([(rr - 0.016, rx_ + 0.0009), (rr, rx_ + 0.0009), (rr, rx_ - 0.0009), (rr - 0.016, rx_ - 0.0009)], 24 if lod == 0 else 10)
    rb.add(v, f, 'rotor')
    for k in range(6 if lod == 0 else 3):
        a = 2 * math.pi * (k + 0.25) / (6 if lod == 0 else 3)
        d = V(0, math.cos(a), math.sin(a))
        d2 = V(0, math.cos(a + 0.35), math.sin(a + 0.35))
        v, f, _ = loft([V(rx_, 0, 0) + d * 0.02, V(rx_, 0, 0) + d2 * (rr - 0.014)], [0.007, 0.005], 0.0011, V(1, 0, 0), n=4)
        rb.add(v, f, 'components')
    v, f = lathe([(0.017, rx_ + 0.003), (0.026, rx_ + 0.002), (0.026, rx_ - 0.002), (0.017, rx_ - 0.002)], 8 if lod == 0 else 6)
    rb.add(v, f, 'components')
    rot = rb.build(name + '_rotor')
    rot.parent = ob
    shade(rot, 40)
    return ob, rot


# ---------------------------------------------------------------------------------------------
# Familles complètes
# ---------------------------------------------------------------------------------------------
def family_geometry(fam):
    if fam == 'tt':
        return bike_geometry(st_len=0.53, ht_len=0.11, steer_extra=0.02)
    if fam == 'retro':
        return bike_geometry(st_len=0.56, ht_len=0.16)
    if fam == 'retro_compact':
        return bike_geometry(st_len=0.45, ht_len=0.16)
    if fam == 'steel':
        return bike_geometry(st_len=0.565, ht_len=0.155)
    if fam == 'lowpro':
        sc = 0.86
        g = bike_geometry(st_len=0.54, ht_len=0.10, fa=V(0, WHEEL_R * sc, 0.585), ht_bot_y=0.56, steer_extra=0.02)
        g.wheel_scale_f = sc
        return g
    if fam == 'lotus':
        return bike_geometry(st_len=0.53, ht_len=0.12, steer_extra=0.02)
    return bike_geometry()


def build_family(fam, lod):
    """Objets d'une famille (maillages + vides) ; renvoie (objets, infos des ancres)."""
    g = family_geometry(fam)
    zl = []
    voxel = 0.002 if lod == 0 else (0.0032 if fam in ('steel', 'retro', 'retro_compact') else 0.004)
    target = 2250 if lod == 0 else 520
    classic = fam in CLASSIC_FAMILIES
    if fam == 'lotus':
        frame = build_lotus_frame(g, zl, voxel, target)
        sty = FRAME_STYLES['tt']
    else:
        sty = FRAME_STYLES[fam]
        frame = build_frame(g, sty, zl, voxel, target)
    # Pièces fixes fusionnées dans « frame » : tige de selle, chaîne, raccords chromés.
    fx = MB()
    Z = V(0, 0, 1)
    n = 10 if lod == 0 else 6
    post = sty.get('post_type', 'round') if fam != 'lotus' else 'lotus'
    if post == 'aero':
        R = tube(fx, [g.st_top - g.st_dir * 0.02, g.sp_top], 1, lambda t: kamm_sec(n, sty['post'][0], sty['post'][1], sty['trunc']), Z, 'frame')
        zlog(zl, R, 'main')
    elif post == 'lotus':
        R = tube(fx, [g.st_top, g.sp_top], 1, lambda t: kamm_sec(n, 0.045, 0.024, 0.8), Z, 'frame')
        zlog(zl, R, 'main')
    else:
        tube(fx, [g.st_top - g.st_dir * 0.02, g.sp_top], 1, lambda t: ell_sec(n, 0.0136, 0.0136), Z, 'chrome' if post == 'chrome' else 'components')
    add_chain(fx, lod)
    if fam == 'steel':
        # Raccords chromés : douille haut / bas, raccord de selle, té de fourche, bouchons de haubans.
        for p0, p1, r in ((g.ht_top - g.ht_up * 0.012, g.ht_top + g.ht_up * 0.008, 0.0182), (g.ht_bot - g.ht_up * 0.008, g.ht_bot + g.ht_up * 0.014, 0.0182),
                          (g.st_top - g.st_dir * 0.025, g.st_top + g.st_dir * 0.012, 0.0165)):
            v, f, _ = loft([p0, p1], r, r, Z, n=12 if lod == 0 else 8)
            fx.add(v, f, 'chrome')
        v, f, _ = loft([g.ht_bot - g.ht_up * 0.02 + V(0.042, 0, 0), g.ht_bot - g.ht_up * 0.02 - V(0.042, 0, 0)], 0.0175, 0.0135, V(0, 1, 0), n=12 if lod == 0 else 8)
        fx.add(v, f, 'chrome')
        v, f, _ = loft([BB + V(0.036, 0, 0), BB - V(0.036, 0, 0)], 0.0215, 0.0215, V(0, 1, 0), n=16 if lod == 0 else 8)
        fx.add(v, f, 'chrome')
    fixed = fx.build('fixed')
    frame_ob = merge_objects([frame, fixed], 'frame')
    assign_zones(frame_ob, zl)
    objs = [frame_ob]
    # Cockpit.
    hand = ROAD_HAND.copy()
    pad = None
    if fam in TT_FAMILIES:
        ck, hand, pad = build_tt_cockpit(g, fam, lod)
    else:
        kind = {'aero': 'aero', 'climb': 'classic', 'retro': 'retro', 'retro_compact': 'retro', 'steel': 'steel'}[fam]
        ck = build_road_cockpit(g, kind, lod, 'cockpit', (sty['ht'][1], sty['ht'][3]) if fam == 'aero' else None)
    objs.append(ck)
    objs.append(build_saddle('race', lod, 'saddle'))
    objs.append(build_crankset(lod, classic=classic))
    pk = 'cage' if fam == 'steel' else 'clipless'
    for tag in ('L', 'R'):
        objs += build_pedal(tag, lod, pk, toeclips=(fam == 'steel'))
    # Options.
    if fam in ('aero', 'climb', 'tt'):
        objs.append(build_disc_brakes(g, lod))
    if fam == 'lotus':
        rear_t = V(0.0, 0.81, -0.12)
    elif fam in ('aero', 'climb', 'tt'):
        rear_t = BB + g.st_dir * (g.st_len * sty['ss_j'])
    else:
        rear_t = BB + g.st_dir * (g.st_len * 0.9)
    objs.append(build_rim_brakes(g, lod, rear_t, (WHEEL_R - 0.02) * g.wheel_scale_f + (0.0 if g.wheel_scale_f == 1 else 0.0)))
    objs.append(build_derailleurs(g, lod, classic=classic))
    if fam in ('aero', 'climb', 'retro', 'retro_compact', 'steel'):
        objs.append(build_bottles(g, sty, lod, single=(fam == 'steel')))
    if fam == 'steel':
        objs.append(build_dt_shifters(g, lod))
    # Vides (ancres).
    info = {}
    e = [make_empty('axle_front', g.fa, 0.0, (g.wheel_scale_f,) * 3), make_empty('axle_rear', REAR_AXLE)]
    info['axle_front'] = (g.fa.tolist(), g.wheel_scale_f)
    info['axle_rear'] = (REAR_AXLE.tolist(), 1.0)
    for s, tag in ((1, 'L'), (-1, 'R')):
        hp = hand * V(s, 1, 1)
        e.append(make_empty(f'hand_{tag}', hp))
        info[f'hand_{tag}'] = [round(float(x), 4) for x in hp]
        if pad is not None:
            pp = pad * V(s, 1, 1)
            e.append(make_empty(f'pad_{tag}', pp))
            info[f'pad_{tag}'] = [round(float(x), 4) for x in pp]
    # Décors : centres sur l'axe des tubes, projetés latéralement.
    dl = float(np.linalg.norm(g.ht_bot - BB))
    side_h = lambda c: c
    if fam == 'lotus':
        dec = {
            'decal_dt': (V(0, 0.79, 0.12), V(0, 0.08, 1), 0.26, 0.05, 0.05),
            'decal_tt': (V(0, 0.81, -0.08), V(0, 0.15, 1), 0.12, 0.045, 0.05),
            'decal_st': (V(0, 0.5, 0.05), nrm(V(0, 0.75, 0.07)), 0.22, 0.07, 0.05),
            'decal_fork': (g.ht_bot - g.ht_up * 0.12 + V(0.04, 0, 0.005), g.ht_up, 0.13, 0.04, 0.12),
        }
    else:
        dc = sty['dt'][0] if not sty['round'] else sty['dt'][2]
        sc_ = sty['st'][0] if not sty['round'] else sty['st'][2]
        tth = 2 * sty['tt'][2]
        fk = sty['fork'][0] if not sty['round'] else sty['fork'][2]
        dec = {
            # Hauteurs proches de celle du tube : les marques couvrent presque tout le flanc, comme en vrai.
            'decal_dt': (BB + g.dt_dir * dl * 0.56, g.dt_dir, dl * 0.62, dc * 0.95, 0.08),
            'decal_tt': (lerp(g.st_top, g.ht_top, 0.5), nrm(g.ht_top - g.st_top), np.linalg.norm(g.ht_top - g.st_top) * 0.5, tth * 0.92, 0.06),
            'decal_st': (BB + g.st_dir * g.st_len * 0.55, g.st_dir, g.st_len * 0.42, sc_ * 0.92, 0.06),
            'decal_fork': (g.ht_bot - g.ht_up * 0.12, g.ht_up, 0.14, fk * 0.9, 2 * (HUB_HALF[0] + 0.02)),
        }
    for k, (c, d, L_, H_, W_) in dec.items():
        e.append(decal_empty(k, c, d, float(L_), float(H_), float(W_)))
        dd = nrm(d)
        info[k] = {'center': [round(float(x), 4) for x in c], 'rot_x': round(math.atan2(dd[2], dd[1]), 4), 'scale': [round(float(W_), 4), round(float(H_), 4), round(float(L_), 4)]}
    num = g.st_top + g.st_dir * ((0.86 - g.st_top[1]) / g.st_dir[1]) + V(0, 0, -0.045)
    e.append(make_empty('anchor_number', num))
    info['anchor_number'] = [round(float(x), 4) for x in num]
    objs += e
    if lod:
        lim = {'cockpit': 360, 'crankset': 200, 'opt_derailleur': 110, 'opt_bottles': 140, 'opt_brakes_disc': 90, 'opt_brakes_rim': 120}
        for o in objs:
            if o.type == 'MESH' and o.name in lim:
                decimate_to(o, lim[o.name])
    return objs, info, g


def build_parts_lib(lod):
    g = bike_geometry()
    objs = []
    for k in COCKPITS:
        objs.append(build_road_cockpit(g, k, lod, f'cockpit_{k}', (BIKE_STYLES['aero']['ht'][1], BIKE_STYLES['aero']['ht'][3])))
    for k in SADDLES:
        objs.append(build_saddle(k, lod, f'saddle_{k}'))
    return objs


def build_rider_aero_helmet(r):
    """Casque chrono : coque lisse à longue queue, visière."""
    H = r.H
    hx = (r.xh, r.uh, r.fh)
    cen = H(0, 0.028, -0.02)
    rad = (0.1, 0.103, 0.135)
    mb = MB()
    v, f, _ = ellipsoid(cen, hx, rad, 30, 16)
    vv = []
    for p in v:
        p = np.array(p)
        q = p - cen
        fw = float(np.dot(q, r.fh))
        up = float(np.dot(q, r.uh))
        lat = float(np.dot(q, r.xh))
        k = float(smoothstep(-0.02, -0.135, fw))
        # Queue : étirée vers l'arrière, effilée et abaissée.
        fw2 = fw - 0.13 * k ** 1.3
        lat2 = lat * (1 - 0.62 * k ** 1.2)
        up2 = up * (1 - 0.45 * k) - 0.035 * k ** 1.5
        vv.append((cen + r.xh * lat2 + r.uh * up2 + r.fh * fw2).tolist())
    mb.add(vv, f, 'helmet')
    ob = mb.build('rider_helmet_aero')
    a, b = H(0, 0.018, 0.13), H(0, -0.09, -0.14)
    no = nrm(np.cross(r.xh, nrm(a - b)))
    if np.dot(no, r.uh) < 0:
        no = -no
    bisect_keep(ob, a, no)
    sol = ob.modifiers.new('sol', 'SOLIDIFY')
    sol.thickness = 0.016
    sol.offset = -1
    apply_modifiers(ob)
    decimate_to(ob, 900)
    me = ob.data
    me.materials.clear()
    me.materials.append(MATS['helmet'])
    me.materials.append(MATS['helmet_detail'])
    cen_bl = Vector(to_bl(cen))
    mi = []
    for p in me.polygons:
        radial = (p.center - cen_bl).normalized()
        mi.append(0 if p.normal.dot(radial) > 0.4 else 1)
    me.polygons.foreach_set('material_index', mi)
    shade(ob, 50)
    # Visière enveloppante.
    vb = MB()
    nphi = 16
    phis = np.linspace(-math.radians(78), math.radians(78), nphi)
    rows = 3
    verts = []
    for ph in phis:
        for j in range(rows):
            h = -0.07 + (0.02 + 0.07) * j / (rows - 1)
            fw = math.cos(ph) * 0.128 - 0.01 * (h / 0.04) ** 2
            verts.append(H(math.sin(ph) * 0.094, h, fw).tolist())
    faces = []
    for i in range(nphi - 1):
        for j in range(rows - 1):
            a0 = i * rows + j
            faces.append((a0, a0 + 1, a0 + rows + 1, a0 + rows))
    vb.add(verts, faces, 'lens')
    vis = vb.build('aero_visor', recalc=False)
    m = vis.modifiers.new('sol', 'SOLIDIFY')
    m.thickness = 0.003
    apply_modifiers(vis)
    sb = MB()
    for s in (1, -1):
        pth = catmull([H(0.09 * s, -0.02, -0.03), H(0.07 * s, -0.075, -0.004), H(0.032 * s, -0.122, 0.05), H(0.0, -0.128, 0.052)], 2)
        v2, f2, _ = loft(pth, 0.0075, 0.0018, r.xh * s, n=4)
        sb.add(v2, f2, 'helmet_detail')
    straps = sb.build('straps_aero')
    return join_into(ob, [vis, straps])


# ---------------------------------------------------------------------------------------------
# Matériau de livrée (aperçus Blender) — même convention que le shader du client
# ---------------------------------------------------------------------------------------------
RAINBOW = ['#0a5cc2', '#d81e2b', '#111111', '#f4c300', '#1a9b3a']


def livery_material(liv, name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    N = nt.nodes
    Lk = nt.links
    bsdf = N.get('Principled BSDF')
    cols = [srgb(c) for c in liv['colors']]

    def rgb(c):
        nd = N.new('ShaderNodeRGB')
        nd.outputs[0].default_value = c
        return nd.outputs[0]

    def op(kind, a, b=None, clamp=False):
        nd = N.new('ShaderNodeMath')
        nd.operation = kind
        nd.use_clamp = clamp
        for i, x in enumerate((a, b)):
            if x is None:
                continue
            if isinstance(x, (int, float)):
                nd.inputs[i].default_value = float(x)
            else:
                Lk.new(x, nd.inputs[i])
        return nd.outputs[0]

    def mix(fac, a, b):
        nd = N.new('ShaderNodeMix')
        nd.data_type = 'RGBA'
        if isinstance(fac, (int, float)):
            nd.inputs[0].default_value = float(fac)
        else:
            Lk.new(fac, nd.inputs[0])
        for idx, x in ((6, a), (7, b)):
            if isinstance(x, (list, tuple)):
                nd.inputs[idx].default_value = x
            else:
                Lk.new(x, nd.inputs[idx])
        return nd.outputs[2]

    def smooth(v, e0, e1):
        nd = N.new('ShaderNodeMapRange')
        nd.interpolation_type = 'SMOOTHSTEP'
        Lk.new(v, nd.inputs['Value'])
        nd.inputs['From Min'].default_value = e0
        nd.inputs['From Max'].default_value = e1
        return nd.outputs['Result']

    def ramp(v, colors):
        nd = N.new('ShaderNodeValToRGB')
        cr = nd.color_ramp
        cr.interpolation = 'CONSTANT'
        k = len(colors)
        while len(cr.elements) < k:
            cr.elements.new(0.5)
        for i, c in enumerate(colors):
            cr.elements[i].position = i / k
            cr.elements[i].color = c
        Lk.new(v, nd.inputs[0])
        return nd.outputs[0]

    tc = N.new('ShaderNodeTexCoord')
    sep = N.new('ShaderNodeSeparateXYZ')
    Lk.new(tc.outputs['Object'], sep.inputs[0])
    cx = sep.outputs[0]
    cy = sep.outputs[2]
    cz = op('MULTIPLY', sep.outputs[1], -1.0)
    uz = op('DIVIDE', op('ADD', cz, 0.45), 1.1, clamp=True)
    uy = op('DIVIDE', op('SUBTRACT', cy, 0.25), 0.75, clamp=True)
    axis = liv.get('axis', 'z')
    if axis == 'z':
        v = uz
    elif axis == 'y':
        v = uy
    elif axis == 'x':
        v = op('ADD', op('MULTIPLY', cx, 5.0), 0.5, clamp=True)
    elif axis == 'diag':
        v = op('MULTIPLY', op('ADD', uz, uy), 0.5)
    else:
        v = op('MULTIPLY', op('ADD', uz, op('SUBTRACT', 1.0, uy)), 0.5)
    at = float(liv.get('at', 0.5))
    w = float(liv.get('width', 0.2))
    c0, c1, c2 = (cols + cols[-1:] * 3)[:3]
    pat = liv.get('pattern', 'solid')
    dv = op('ABSOLUTE', op('SUBTRACT', v, at))
    inband = op('LESS_THAN', dv, w / 2)
    s_loc = op('DIVIDE', op('SUBTRACT', v, at - w / 2), max(w, 1e-4), clamp=True)
    if pat == 'solid':
        col = rgb(c0)
    elif pat == 'fade':
        col = mix(smooth(v, at - w / 2, at + w / 2), c0, c1)
    elif pat == 'split':
        col = mix(op('GREATER_THAN', v, at), c0, c1)
        if liv.get('line'):
            col = mix(op('LESS_THAN', dv, 0.012), col, c2)
    elif pat == 'band':
        col = mix(inband, c0, c1)
        if liv.get('line'):
            col = mix(op('LESS_THAN', op('ABSOLUTE', op('SUBTRACT', dv, w / 2)), 0.008), col, c2)
    elif pat == 'stripes':
        col = mix(inband, c0, ramp(s_loc, [c1, c2, c1]))
    elif pat == 'rainbow':
        col = mix(inband, c0, ramp(s_loc, [srgb(c) for c in RAINBOW]))
    elif pat == 'checker':
        k = op('MODULO', op('ADD', op('FLOOR', op('DIVIDE', cz, 0.02)), op('FLOOR', op('DIVIDE', cy, 0.02))), 2.0)
        k = op('ABSOLUTE', k)
        col = mix(inband, c0, mix(k, c1, c2))
    elif pat == 'blocks':
        pal = [c0, c1, c2] + [srgb(c) for c in liv.get('extra', [])]
        comb = N.new('ShaderNodeCombineXYZ')
        Lk.new(op('FLOOR', op('DIVIDE', cz, 0.09)), comb.inputs[0])
        Lk.new(op('FLOOR', op('DIVIDE', cy, 0.09)), comb.inputs[1])
        wn = N.new('ShaderNodeTexWhiteNoise')
        wn.noise_dimensions = '3D'
        Lk.new(comb.outputs[0], wn.inputs['Vector'])
        col = ramp(wn.outputs['Value'], pal)
        fz = op('FRACT', op('DIVIDE', cz, 0.09))
        fy = op('FRACT', op('DIVIDE', cy, 0.09))
        lz = op('GREATER_THAN', op('ABSOLUTE', op('SUBTRACT', fz, 0.5)), 0.45)
        ly = op('GREATER_THAN', op('ABSOLUTE', op('SUBTRACT', fy, 0.5)), 0.45)
        col = mix(op('MAXIMUM', lz, ly), col, srgb('#111111'))
    elif pat == 'dots':
        fz = op('SUBTRACT', op('FRACT', op('DIVIDE', cz, 0.04)), 0.5)
        fy = op('SUBTRACT', op('FRACT', op('DIVIDE', cy, 0.04)), 0.5)
        d = op('SQRT', op('ADD', op('MULTIPLY', fz, fz), op('MULTIPLY', fy, fy)))
        col = mix(op('LESS_THAN', d, 0.3), c0, c1)
    else:
        col = rgb(c0)
    zones = liv.get('zones', {})
    if zones:
        at_ = N.new('ShaderNodeAttribute')
        at_.attribute_name = 'zone'
        sc = N.new('ShaderNodeSeparateColor')
        Lk.new(at_.outputs['Color'], sc.inputs[0])
        chans = {'rear': sc.outputs[1], 'fork': sc.outputs[2], 'head': at_.outputs['Alpha']}
        for zk, ci in zones.items():
            col = mix(op('GREATER_THAN', chans[zk], 0.5), col, cols[int(ci)])
    fin = liv.get('finish', 'gloss')
    if fin == 'raw':
        ck = N.new('ShaderNodeTexChecker')
        Lk.new(tc.outputs['Object'], ck.inputs['Vector'])
        ck.inputs['Scale'].default_value = 300.0
        ck.inputs['Color1'].default_value = srgb('#16171a')
        ck.inputs['Color2'].default_value = srgb('#2a2b30')
        col = mix(0.12, ck.outputs['Color'], col)
    Lk.new(col, bsdf.inputs['Base Color'])
    rough, metal, coat, film = 0.28, 0.0, 1.0, 0.0
    if fin == 'matte':
        rough, coat = 0.62, 0.0
    elif fin == 'metallic':
        rough, metal = 0.3, 0.6
    elif fin == 'chrome':
        rough, metal = 0.08, 1.0
    elif fin == 'pearl':
        rough, film = 0.25, 320.0
    elif fin == 'iridescent':
        rough, film = 0.2, 520.0
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    for key, val in (('Coat Weight', coat), ('Coat Roughness', 0.05), ('Thin Film Thickness', film)):
        try:
            bsdf.inputs[key].default_value = val
        except KeyError:
            pass
    m.diffuse_color = cols[0]
    return m
