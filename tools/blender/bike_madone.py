"""
Allez Robert ! — Trek Madone (famille dédiée « madone ») d'après le vélo de Mads Pedersen : nœud de
selle « IsoFlow » (horizontal prolongé derrière le tube de selle, mât carré, haubans hauts), tube de selle
droit à encoche arrière sous le nœud, diagonal très profond, cintre-potence monobloc, tige aéro noire, bidons Lidl-Trek.

Exécuté dans l'espace de noms de build_cyclist.py, après bike_families.py (mêmes outils). Mêmes
cotes que les autres vélos de route (boîtier, axes, selle, mains ROAD_HAND) : le coureur s'y pose à
l'identique. Plus détaillé que les familles génériques (voxel plus fin, budget proche du gravel).
"""

# Profils (corde bas / haut, largeur bas / haut, en mètres) : diagonal très profond (le TREK y tient sur toute la hauteur).
MADONE_STY = {'dt': (0.088, 0.096, 0.04, 0.044), 'st': (0.05, 0.046, 0.03, 0.028), 'ht': (0.084, 0.07, 0.046, 0.038)}
# Nœud de selle « IsoFlow » : l'horizontal dépasse en arrière du tube de selle ; mât peint et haubans partent de son extrémité,
# sur l'axe boîtier → selle (la tige reste alignée sur la selle commune à tous les vélos).
MADONE_NODE_Y = 0.73
MADONE_MAST_TOP_Y = 0.835


Z_AXIS = V(0, 0, 1)


def madone_geometry():
    g = bike_geometry(st_len=0.49, ht_len=0.178, steer_extra=0.014)
    st = g.st_dir
    g.node = BB + st * ((MADONE_NODE_Y - BB[1]) / st[1])
    g.mast_top = BB + st * ((MADONE_MAST_TOP_Y - BB[1]) / st[1])
    # Signature du Madone : l'horizontal finit en plateau plat et horizontal qui dépasse derrière le tube de selle ;
    # le mât se dresse sur son bout, haubans et tube de selle se rejoignent dessous en Y.
    g.slab_y = MADONE_NODE_Y + 0.008
    g.slab0 = V(0, g.slab_y, g.node[2] + 0.095)
    g.slab1 = V(0, g.slab_y, g.node[2] - 0.024)
    # Tube de selle droit, du boîtier jusque sous le plateau, 5 cm devant le mât (un peu plus redressé que l'axe de selle).
    g.st_a = V(0, g.slab_y - 0.01, g.node[2] + 0.05)
    g.st2 = nrm(g.st_a - BB)
    g.st2_front = nrm(Z_AXIS - g.st2 * g.st2[2])
    # Diagonal : axe droit du boîtier au-dessus du bas de la douille.
    g.dt0 = BB + V(0, -0.004, 0.012)
    g.dt1 = g.ht_bot + g.ht_up * 0.075 - g.pf * 0.004
    return g


def build_madone_frame(g, zl, voxel, target):
    mb = MB()
    n = 28 if voxel < 0.002 else 16
    Z, Y, X = V(0, 0, 1), V(0, 1, 0), V(1, 0, 0)
    st = g.st_dir
    N = g.node
    # Douille : haute et profonde, évasée en bas (couronne de fourche affleurante).
    c0, c1, w0, w1 = MADONE_STY['ht']
    R = tube(mb, [g.ht_bot - g.ht_up * 0.014, g.ht_bot + g.ht_up * 0.03, g.ht_bot + g.ht_up * 0.1, g.ht_top + g.ht_up * 0.004], 2,
             lambda t: kamm_sec(n, lerp(c0 * 1.08, c1, smoothstep(0, 0.5, t)), lerp(w0 * 1.14, w1, smoothstep(0, 0.45, t)), 0.74, -0.008), Z, 'frame')
    zlog(zl, R, 'head')
    # Diagonal : très profond sur toute sa longueur, s'élargit encore vers le boîtier.
    c0, c1, w0, w1 = MADONE_STY['dt']
    # Axe droit (le TREK y est posé, parallèle aux bords du tube).
    dt0, dt_end = g.dt0, g.dt1
    R = tube(mb, [dt0, lerp(dt0, dt_end, 0.25), lerp(dt0, dt_end, 0.6), dt_end], 2,
             lambda t: kamm_sec(n, lerp(c0 * 1.18, c1, smoothstep(0, 0.35, t)), lerp(w0 * 1.1, w1, t), 0.74), Z, 'frame')
    zlog(zl, R, 'main')
    # Tube de selle en arc autour du pneu arrière (corde le long du rayon), puis droit jusqu'à l'horizontal.
    c0, c1, w0, w1 = MADONE_STY['st']
    # Face avant droite ; à l'arrière, le tube s'élargit au boîtier et sous le nœud : l'encoche du Madone, au-dessus de la roue.
    def st_chord(t):
        return 0.062 - 0.016 * smoothstep(0.0, 0.14, t) + 0.02 * smoothstep(0.6, 0.68, t)
    R = tube(mb, [BB + g.st2 * -0.01, BB + g.st2 * 0.12, lerp(BB, g.st_a, 0.6), g.st_a + g.st2 * 0.01], 2,
             lambda t: kamm_sec(n, st_chord(t), lerp(w0, w1, t), 0.78, 0.024 - st_chord(t) / 2), Z, 'frame')
    zlog(zl, R, 'main')
    # Horizontal : arqué, plus haut que large, jusqu'au plateau du nœud.
    tt0 = g.ht_top - g.ht_up * 0.03
    tt1 = g.slab0 + V(0, 0.001, -0.012)
    ttm = lerp(tt0, tt1, 0.45) + V(0, 0.012, 0)
    R = tube(mb, [tt0, ttm, lerp(tt0, tt1, 0.85) + V(0, 0.002, 0), tt1], 2,
             lambda t: ell_sec(n, lerp(0.018, 0.0165, t), lerp(0.028, 0.0145, t), lerp(2.4, 3.4, smoothstep(0.6, 1.0, t))), Y, 'frame')
    zlog(zl, R, 'main')
    # Plateau du nœud : plat, horizontal, bout carré derrière le mât.
    R = tube(mb, [g.slab0 + V(0, 0, 0.006), lerp(g.slab0, g.slab1, 0.5), g.slab1], 1, lambda t: ell_sec(n, 0.0165, 0.0115, 4.0), Y, 'frame')
    zlog(zl, R, 'main')
    # Mât peint (manchon carré) dressé sur le bout du plateau ; la tige aéro noire s'y emboîte.
    m0 = BB + st * ((g.slab_y + 0.004 - BB[1]) / st[1])
    R = tube(mb, [m0, g.mast_top], 1, lambda t: ell_sec(n, 0.0185, 0.03, 4.0), Z, 'frame')
    zlog(zl, R, 'main')
    # Boîtier et carénage du pédalier (diagonal, tube de selle et bases s'y fondent).
    v, f, info = loft([BB + V(0.047, 0, 0), BB - V(0.047, 0, 0)], 0.026, 0.026, Y, n=20)
    mb.add(v, f, 'frame')
    zlog_pts(zl, info['centers'], 0.026, 'main')
    v, f, info = loft([BB + V(0, -0.012, -0.03), BB + V(0, 0.006, 0.0), BB + V(0, 0.03, 0.05)], [0.032, 0.038, 0.026], [0.03, 0.04, 0.035], X, n=20)
    mb.add(v, f, 'frame')
    zlog_pts(zl, info['centers'], 0.035, 'main')
    hr, hf = HUB_HALF[1], HUB_HALF[0]
    for s in (1, -1):
        drop = REAR_AXLE + V((hr + 0.002) * s, 0, 0)
        # Bases : hautes et plates (côté transmission un peu plus massive).
        k = 1.12 if s < 0 else 1.0
        R = tube(mb, stay_pts([BB + V(0.026 * s, -0.004, -0.02), BB + V(0.031 * s, 0, -0.12), REAR_AXLE + V((hr - 0.011) * s, 0, 0.11),
                               drop + V(0, -0.004, 0.012)]), 3, lambda t: ell_sec(14, lerp(0.0095, 0.0062, t), lerp(0.02, 0.0095, t) * k, 2.3), Y, 'frame')
        zlog(zl, R, 'rear')
        # Haubans fins, droits, du nœud aux pattes.
        top = V(0.011 * s, g.slab_y - 0.014, N[2] + 0.014)
        mid = lerp(top, drop, 0.45)
        R = tube(mb, [top, mid + V(0.04 * s - mid[0], 0, 0), drop + V(0, 0.016, 0.0)], 3,
                 lambda t: kamm_sec(12, lerp(0.024, 0.018, t), lerp(0.012, 0.0095, t), 0.74), Z, 'frame')
        zlog(zl, R, 'rear')
        v, f, info = loft([drop + V(0, -0.014, 0.022), drop + V(0, 0.016, -0.006)], 0.0135, 0.0048, X, n=12)
        mb.add(v, f, 'frame')
        zlog_pts(zl, info['centers'], 0.012, 'rear')
        # Fourche : fourreaux profonds, couronne large sous la douille.
        fdrop = g.fa + V((hf + 0.006) * s, 0.006, 0)
        topf = g.ht_bot + g.ht_up * 0.02 + V(0.021 * s, 0, 0) - g.pf * 0.006
        crown = g.ht_bot - g.ht_up * 0.05 + V(0.035 * s, 0, 0) + g.pf * 0.002
        midf = g.ht_bot - g.ht_up * 0.19 + V((hf + 0.004) * s, 0, 0) + g.pf * 0.01
        R = tube(mb, [topf, crown, midf, fdrop], 3, lambda t: kamm_sec(n, lerp(0.06, 0.034, t), lerp(0.025, 0.014, t), 0.76), Z, 'frame')
        zlog(zl, R, 'fork')
        v, f, info = loft([fdrop + V(0, -0.012, 0.012), fdrop + V(0, 0.016, -0.004)], 0.012, 0.0045, X, n=12)
        mb.add(v, f, 'frame')
        zlog_pts(zl, info['centers'], 0.01, 'fork')
    ob = mb.build('frame_union')
    remesh_union(ob, voxel, 6, 0.5)
    decimate_to(ob, target)
    shade(ob)
    return ob


def build_madone_cockpit(g, lod):
    """Cintre-potence monobloc (type Aero RSL) : potence en aile dans le prolongement de la douille,
    dessus de cintre plat, bas de cintre ronds (guidoline), cocottes, compteur déporté."""
    return build_road_cockpit(g, 'aero', lod, 'cockpit', (MADONE_STY['ht'][1], MADONE_STY['ht'][3]))


def build_madone_saddle(g, lod):
    """Selle et tige aéro noire (matériau « components » du nœud saddle → « seatpost » côté client)."""
    s = build_saddle('race', lod, 'saddle_shell')
    mb = MB()
    Z = V(0, 0, 1)
    n = 16 if lod == 0 else 8
    st = g.st_dir
    # Tige : emboîtée dans le mât, profil d'aile, puis tête coudée vers le chariot.
    p0 = g.mast_top - st * 0.03
    p1 = BB + st * ((0.895 - BB[1]) / st[1])
    tube(mb, [p0, p1], 1, lambda t: kamm_sec(n, lerp(0.043, 0.04, t), lerp(0.0255, 0.024, t), 0.74), Z, 'components')
    # Collerette au bord du mât (léger ressaut).
    tube(mb, [g.mast_top - st * 0.004, g.mast_top + st * 0.006], 1, lambda t: kamm_sec(n, 0.0465, 0.0285, 0.74), Z, 'components')
    head = [p1 - st * 0.004, p1 + st * 0.012 + V(0, 0, -0.004), V(0, 0.921, -0.215)]
    tube(mb, head, 2 if lod == 0 else 1, lambda t: ell_sec(n, lerp(0.012, 0.016, t), lerp(0.02, 0.016, t), 2.6), Z, 'components')
    post = mb.build('seatpost_madone')
    shade(post, 40)
    return merge_objects([s, post], 'saddle', sharp=40)


def build_lidl_bottle(mb, base, axis, mount, lod):
    """Bidon d'équipe Lidl-Trek : corps bleu (« bottle »), bande jaune, filets rouges, haut blanc, bouchon rouge."""
    n = 14 if lod == 0 else 8
    segs = [((0.0, 0.012), 'bottle', (0.031, 0.0365)), ((0.012, 0.02), 'bottle', (0.0365, 0.0362)),
            ((0.02, 0.078), 'bottle_band', (0.0362, 0.0352)), ((0.078, 0.09), 'bottle', (0.0352, 0.0348)),
            ((0.09, 0.112), 'bottle_trim', (0.0348, 0.0346)), ((0.112, 0.146), 'bottle', (0.0346, 0.0362)),
            ((0.146, 0.172), 'bottle_white', (0.0362, 0.033))]
    if lod:
        segs = [((0.0, 0.02), 'bottle', (0.031, 0.0362)), ((0.02, 0.078), 'bottle_band', (0.0362, 0.0352)),
                ((0.078, 0.146), 'bottle', (0.0352, 0.0362)), ((0.146, 0.172), 'bottle_white', (0.0362, 0.033))]
    for (t0, t1), mat, (r0, r1) in segs:
        v, f, _ = loft([base + axis * t0, base + axis * t1], [r0, r1], [r0, r1], mount, n=n, cap=(t0 == 0.0 or t1 == 0.172))
        mb.add(v, f, mat)
    v, f, _ = loft([base + axis * t for t in (0.17, 0.19, 0.198, 0.205)], [0.031, 0.025, 0.012, 0.008], [0.031, 0.025, 0.012, 0.008], mount, n=n)
    mb.add(v, f, 'bottle_trim')
    lat = nrm(np.cross(axis, mount))
    # Logo Lidl de chaque côté, sur la bande jaune : carré bleu, rond jaune cerclé de rouge (pastilles épousant le bidon).
    if lod == 0:
        for side in (1, -1):
            cyl_patch(mb, base, axis, mount, lat * side, 0.049, 0.0175, 0.0362 + 0.0006, 'bottle', 'square')
            cyl_patch(mb, base, axis, mount, lat * side, 0.049, 0.0135, 0.0362 + 0.0011, 'bottle_trim', 'disc')
            cyl_patch(mb, base, axis, mount, lat * side, 0.049, 0.0112, 0.0362 + 0.0015, 'bottle_band', 'disc')
    for sgn in (1, -1):
        rail = [base + axis * t + mount * 0.026 + lat * sgn * 0.027 for t in (0.004, 0.06, 0.12, 0.155)]
        rail[0] = rail[0] - mount * 0.012
        v, f, _ = loft(rail if lod == 0 else [rail[0], rail[-1]], 0.0035, 0.0018, lat * sgn, n=4)
        mb.add(v, f, 'cage')
    if lod == 0:
        v, f, _ = loft([base - axis * 0.004 + mount * 0.04, base - axis * 0.004 - mount * 0.012], 0.012, 0.0025, axis, n=4)
        mb.add(v, f, 'cage')
        v, f, _ = loft([base + axis * 0.03 + mount * 0.034, base + axis * 0.14 + mount * 0.034], 0.009, 0.003, mount, n=4)
        mb.add(v, f, 'cage')


def cyl_patch(mb, base, axis, mount, out, t, half, radius, mat, shape):
    """Pastille (carré ou disque de demi-taille `half`) collée sur un bidon de rayon `radius`, centrée à `t` le long de
    l'axe, du côté `out` (unitaire ⟂ à l'axe) : grille dépliée sur le cylindre."""
    side = nrm(np.cross(axis, out))
    k = 6
    verts, faces = [], []
    if shape == 'square':
        for i in range(k + 1):
            for j in range(k + 1):
                u, w = (i / k * 2 - 1) * half, (j / k * 2 - 1) * half
                a = u / radius
                verts.append(base + axis * (t + w) + (out * math.cos(a) + side * math.sin(a)) * radius)
        for i in range(k):
            for j in range(k):
                q = i * (k + 1) + j
                faces.append((q, q + k + 1, q + k + 2, q + 1))
    else:
        m = 16
        verts.append(base + axis * t + out * radius)
        for r_i in (0.5, 1.0):
            for q in range(m):
                ph = 2 * math.pi * q / m
                u, w = math.cos(ph) * half * r_i, math.sin(ph) * half * r_i
                a = u / radius
                verts.append(base + axis * (t + w) + (out * math.cos(a) + side * math.sin(a)) * radius)
        for q in range(m):
            faces.append((0, 1 + q, 1 + (q + 1) % m))
            faces.append((1 + q, 1 + m + q, 1 + m + (q + 1) % m, 1 + (q + 1) % m))
    # Orientation des faces vers l'extérieur.
    c = np.mean(verts, axis=0)
    a0, b0, c0 = verts[faces[0][0]], verts[faces[0][1]], verts[faces[0][2]]
    if np.dot(np.cross(b0 - a0, c0 - a0), out) < 0:
        faces = [tuple(reversed(fc)) for fc in faces]
    mb.add(verts, faces, mat)


def build_madone_bottles(g, lod):
    mb = MB()
    build_lidl_bottle(mb, BB + g.dt_dir * 0.1 + g.dt_back * (MADONE_STY['dt'][0] / 2 + 0.04), g.dt_dir, -g.dt_back, lod)
    build_lidl_bottle(mb, BB + g.st2 * 0.2 + g.st2_front * 0.066, g.st2, -g.st2_front, lod)
    ob = mb.build('opt_bottles')
    shade(ob, 40)
    return ob


def build_madone_crankset(lod):
    """Pédalier SRAM Red 1× : un grand plateau (corps noir, dents argentées), araignée à capteur à 4 bras,
    anneau rouge au centre, manivelles noires (logo SRAM côté client, matériau « crank »)."""
    mb = MB()
    if lod == 0:
        tooth_ring(mb, -0.0475, -0.0435, 0.1125, 0.1078, 0.082, 32, 'ring_teeth', 'chainring', 0.103)
        v, f = lathe([(0.064, -0.0405), (0.084, -0.0405), (0.084, -0.0455), (0.064, -0.0455)], 32)
        mb.add(v, f, 'chainring')
    else:
        v, f = lathe([(0.075, -0.0435), (0.112, -0.0435), (0.112, -0.0475), (0.075, -0.0475)], 18)
        mb.add(v, f, 'ring_teeth')
    for a in [math.radians(a) for a in (30, 120, 210, 300)]:
        d = V(0, math.cos(a), math.sin(a))
        v, f, _ = loft([V(-0.044, 0, 0) + d * 0.02, V(-0.044, 0, 0) + d * 0.074], [0.017, 0.011], 0.005, V(1, 0, 0), n=6 if lod == 0 else 4)
        mb.add(v, f, 'components')
    # Capteur (boîtier noir) et anneau rouge.
    v, f = lathe([(0.016, -0.038), (0.034, -0.038), (0.034, -0.05), (0.016, -0.05)], 16 if lod == 0 else 10)
    mb.add(v, f, 'components')
    if lod == 0:
        v, f = lathe([(0.034, -0.044), (0.04, -0.044), (0.04, -0.049), (0.034, -0.049)], 20)
        mb.add(v, f, 'crank_accent')
    v, f, _ = loft([V(0.07, 0, 0), V(-0.07, 0, 0)], 0.012, 0.012, V(0, 1, 0), n=12 if lod == 0 else 6)
    mb.add(v, f, 'chrome')
    for s in (1, -1):
        dy = -1.0 if s > 0 else 1.0
        arm = [V(0.058 * s, 0, 0), V(0.064 * s, dy * CRANK * 0.45, 0), V(PEDAL_AXIS_X * s - 0.004 * s, dy * CRANK, 0)]
        v, f, _ = loft(arm, [0.021, 0.014, 0.0125], [0.012, 0.0095, 0.008], V(1, 0, 0), n=14 if lod == 0 else 6, expo=3.0)
        mb.add(v, f, 'crank')
        if lod == 0:
            v, f, _ = loft([V(0.066 * s, 0, 0), V(0.072 * s, 0, 0)], 0.014, 0.014, V(0, 1, 0), n=10)
            mb.add(v, f, 'bolts')
    ob = mb.build('crankset')
    ob.location = Vector(to_bl(BB))
    shade(ob, 40)
    return ob


def build_madone_derailleur(g, lod):
    """Dérailleur arrière seul (transmission 1×) : galets, chape, corps ; pas de dérailleur avant."""
    mb = MB()
    X, Y = V(1, 0, 0), V(0, 1, 0)
    hr = HUB_HALF[1]
    _, UP, LP, PR = chain_path()
    for c in (LP, UP):
        v, f, _ = loft([c + V(0.003, 0, 0), c - V(0.003, 0, 0)], PR, PR, Y, n=12 if lod == 0 else 6)
        mb.add(v, f, 'pulley')
        if lod == 0:
            v, f, _ = loft([c - V(0.0085, 0, 0), c - V(0.0105, 0, 0)], 0.0055, 0.0055, Y, n=6)
            mb.add(v, f, 'bolts')
    for dx in ((-0.0075, 0.0075) if lod == 0 else (-0.0075,)):
        v, f, _ = loft([UP + V(dx, 0.004, 0.0), LP + V(dx, -0.004, 0.0)], 0.017, 0.0016, X, n=8 if lod == 0 else 4)
        mb.add(v, f, 'components')
    kb = REAR_AXLE + V(-(hr + 0.008), -0.012, -0.016)
    kp = UP + V(-0.016, 0.006, -0.02)
    v, f, _ = loft(catmull([kb, kb + V(-0.004, -0.014, -0.022), kp], 2 if lod == 0 else 1), 0.014, 0.018, X, n=10 if lod == 0 else 5, expo=2.6)
    mb.add(v, f, 'components')
    ob = mb.build('opt_derailleur')
    shade(ob, 40)
    return ob


def build_madone(lod):
    """Objets de la famille « madone » (maillages + vides) ; renvoie (objets, infos des ancres, géométrie)."""
    g = madone_geometry()
    zl = []
    voxel = 0.0014 if lod == 0 else 0.0032
    target = 9000 if lod == 0 else 2400
    frame = build_madone_frame(g, zl, voxel, target)
    fx = MB()
    add_chain(fx, lod)
    fixed = fx.build('fixed')
    frame_ob = merge_objects([frame, fixed], 'frame')
    assign_zones(frame_ob, zl)
    objs = [frame_ob, build_madone_cockpit(g, lod), build_madone_saddle(g, lod), build_madone_crankset(lod)]
    for tag in ('L', 'R'):
        objs += build_pedal(tag, lod, 'clipless')
    objs.append(build_disc_brakes(g, lod))
    objs.append(build_rim_brakes(g, lod, g.node, WHEEL_R - 0.02))
    objs.append(build_madone_derailleur(g, lod))
    objs.append(build_madone_bottles(g, lod))
    info = {}
    e = [make_empty('axle_front', g.fa), make_empty('axle_rear', REAR_AXLE)]
    info['axle_front'] = (g.fa.tolist(), 1.0)
    info['axle_rear'] = (REAR_AXLE.tolist(), 1.0)
    for s, tag in ((1, 'L'), (-1, 'R')):
        hp = ROAD_HAND * V(s, 1, 1)
        e.append(make_empty(f'hand_{tag}', hp))
        info[f'hand_{tag}'] = [round(float(x), 4) for x in hp]
    # Inscriptions : TREK en grand sur le diagonal, nom du coureur près du nœud, PROJECT ONE à l'avant
    # de l'horizontal, marque du groupe sur la base.
    dl = float(np.linalg.norm(g.ht_bot - BB))
    tt0 = g.ht_top - g.ht_up * 0.026
    tdir = nrm(tt0 - g.slab0)
    cs0 = BB + V(0, 0.004, -0.12)
    cs1 = REAR_AXLE + V(0, -0.006, 0.11)
    dec = {
        'decal_dt': (lerp(g.dt0, g.dt1, 0.58), nrm(g.dt1 - g.dt0), float(np.linalg.norm(g.dt1 - g.dt0)) * 0.6, 0.078, 0.11),
        'decal_tt': (lerp(g.slab0, g.slab1, 0.38), V(0, 0, 1), 0.085, 0.018, 0.06),
        'decal_ttf': (lerp(g.slab0, tt0, 0.68), tdir, 0.15, 0.026, 0.06),
        'decal_st': (BB + g.st2 * 0.3, g.st2, 0.12, 0.04, 0.07),
        'decal_fork': (g.ht_bot - g.ht_up * 0.045, g.ht_up, 0.06, 0.03, 2 * (HUB_HALF[0] + 0.03)),
        'decal_cs': (lerp(cs0, cs1, 0.5), nrm(cs0 - cs1), float(np.linalg.norm(cs0 - cs1)) * 0.5, 0.026, 0.12),
    }
    for k, (c, d, L_, H_, W_) in dec.items():
        e.append(decal_empty(k, c, d, float(L_), float(H_), float(W_)))
        dd = nrm(d)
        info[k] = {'center': [round(float(x), 4) for x in c], 'rot_x': round(math.atan2(dd[2], dd[1]), 4), 'scale': [round(float(W_), 4), round(float(H_), 4), round(float(L_), 4)]}
    num = g.mast_top + V(0, -0.02, -0.04)
    e.append(make_empty('anchor_number', num))
    info['anchor_number'] = [round(float(x), 4) for x in num]
    objs += e
    if lod:
        lim = {'cockpit': 420, 'crankset': 200, 'opt_derailleur': 110, 'opt_bottles': 220, 'opt_brakes_disc': 90, 'opt_brakes_rim': 120, 'saddle': 300}
        for o in objs:
            if o.type == 'MESH' and o.name in lim:
                decimate_to(o, lim[o.name])
    return objs, info, g
