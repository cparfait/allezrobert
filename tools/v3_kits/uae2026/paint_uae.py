"""Tenue UAE Team Emirates XRG 2026 (essai) pour le coureur V3.

Les motifs sont décrits sur le corps (repère du coureur : +x devant, +y gauche du coureur, +z haut, mètres)
puis projetés sur le dépliage UV grâce à la carte des positions (maps2048.npz). Sortie : diffuse et normale 2048².
"""
import sys, math, numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from scipy import ndimage as ndi

S = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else S + '/uae2026'
DEBUG = '--debug' in sys.argv
N = 2048
d = np.load(S + f'/maps{N}.npz')
pos, nor, mask = d['pos'], d['nor'], d['mask'] > 0
X, Y, Z = pos[..., 0], pos[..., 1], pos[..., 2]
NX, NY, NZ = nor[..., 0], nor[..., 1], nor[..., 2]
rows = np.repeat(np.arange(N)[:, None], N, 1)
cols = np.repeat(np.arange(N)[None, :], N, 0)
jersey = mask & (rows < 0.55 * N)
shorts = mask & (rows >= 0.55 * N)
AY = np.abs(Y)
sleeve = jersey & (AY > 0.158) & (Z > 1.24)
torso = jersey & ~sleeve
collar = jersey & (cols < 0.08 * N) & (rows > 0.19 * N)
torso &= ~collar

def srgb(h):
    h = h.lstrip('#'); return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.float32) / 255

WHITE, BLACK, CARBON = srgb('f3f3f1'), srgb('17171a'), srgb('232326')
RED, GREEN, NAVY = srgb('d71a28'), srgb('00843d'), srgb('1d2a5a')
SHORTS = srgb('141416')

def smooth(e0, e1, v):
    t = np.clip((v - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)

def aa(m, s=0.8):
    """Masque binaire → bord adouci (anticrénelage d'environ un texel)."""
    return np.clip(ndi.gaussian_filter(m.astype(np.float32), s), 0, 1)

col = np.zeros((N, N, 3), np.float32); col[:] = WHITE
height = np.zeros((N, N), np.float32)      # relief fin (m-ish arbitraire) pour la normale
fabric = np.zeros((N, N), np.uint8)        # 0 maille blanche, 1 lycra noir, 2 cuissard, 3 picots

def paint(m, c, alpha=None):
    a = m.astype(np.float32) if alpha is None else alpha * m
    col[:] = col * (1 - a[..., None]) + np.asarray(c, np.float32) * a[..., None]

# ---------------------------------------------------------------- dessin v2 : d'après les photos produit Pissei (body route 2026)
FONTS = 'C:/Windows/Fonts/'
def font(name, size, variation=None):
    f = ImageFont.truetype(FONTS + name, size)
    if variation:
        try: f.set_variation_by_name(variation)
        except Exception: pass
    return f

INK, WHITE8, REDI, NAVYI, GREYI = (23, 23, 26, 255), (255, 255, 255, 255), (215, 26, 40, 255), (29, 42, 90, 255), (60, 60, 64, 255)
big = font('bahnschrift.ttf', 300, 'Bold')
small = font('bahnschrift.ttf', 120, 'SemiBold')
serif = font('georgiab.ttf', 220)
segoe = font('segoeuib.ttf', 160)

def text_img(txt, f, fill, pad=8, box=None, tracking=0):
    widths = [f.getbbox(ch)[2] - f.getbbox(ch)[0] for ch in txt] if tracking else None
    b = f.getbbox(txt)
    w = (sum(widths) + tracking * (len(txt) - 1)) if tracking else b[2] - b[0]
    h = b[3] - b[1]
    im = Image.new('RGBA', (w + 2 * pad, h + 2 * pad), (0, 0, 0, 0)); dr = ImageDraw.Draw(im)
    if box: dr.rectangle([0, 0, im.width - 1, im.height - 1], fill=box)
    if tracking:
        x = pad
        for ch, cw in zip(txt, widths):
            dr.text((x - f.getbbox(ch)[0], pad - b[1]), ch, font=f, fill=fill); x += cw + tracking
    else:
        dr.text((pad - b[0], pad - b[1]), txt, font=f, fill=fill)
    return im

def hcat(*ims, gap=20):
    w = sum(i.width for i in ims) + gap * (len(ims) - 1); h = max(i.height for i in ims)
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0)); x = 0
    for i in ims: out.alpha_composite(i, (x, (h - i.height) // 2)); x += i.width + gap
    return out

def vcat(*ims, gap=10):
    w = max(i.width for i in ims); h = sum(i.height for i in ims) + gap * (len(ims) - 1)
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0)); y = 0
    for i in ims: out.alpha_composite(i, ((w - i.width) // 2, y)); y += i.height + gap
    return out

def clover(fill, s=200):
    im = Image.new('RGBA', (s, s), (0, 0, 0, 0)); d = ImageDraw.Draw(im); r = s * 0.2
    for cx, cy in ((0.5, 0.27), (0.29, 0.52), (0.71, 0.52)):
        d.ellipse([cx * s - r, cy * s - r, cx * s + r, cy * s + r], fill=fill)
    d.polygon([(0.46 * s, 0.5 * s), (0.54 * s, 0.5 * s), (0.62 * s, 0.97 * s), (0.38 * s, 0.97 * s)], fill=fill)
    return im

def analog(fill):
    t = text_img('Analog', segoe, fill)
    s = t.height; c = Image.new('RGBA', (s, s), (0, 0, 0, 0)); d = ImageDraw.Draw(c)
    d.ellipse([s * 0.12, s * 0.2, s * 0.88, s * 0.96], outline=fill, width=int(s * 0.1))
    d.line([(s * 0.25, s * 0.85), (s * 0.75, s * 0.3)], fill=fill, width=int(s * 0.1))
    return hcat(c, t, gap=12)

def fab(fill):
    t = text_img('FAB', big, fill)
    flag = Image.new('RGBA', (int(t.height * 0.45), t.height), (0, 0, 0, 0))
    ImageDraw.Draw(flag).polygon([(0, t.height * 0.95), (flag.width * 0.35, t.height * 0.1), (flag.width, t.height * 0.05), (flag.width * 0.55, t.height * 0.95)], fill=REDI)
    return hcat(t, flag, gap=6)

def emirates_box(): return text_img('Emirates', serif, WHITE8, pad=40, box=REDI)

def e_and(sub=True):
    t = text_img('e&', big, REDI)
    return vcat(t, text_img('etisalat and', small, REDI)) if sub else t

def uci(fill):
    disc = Image.new('RGBA', (110, 110), (0, 0, 0, 0)); ImageDraw.Draw(disc).ellipse([5, 15, 105, 95], fill=(196, 160, 80, 255))
    return hcat(disc, vcat(text_img('UCI WORLDTOUR', small, fill), text_img('BEST TEAM', small, fill), gap=4), gap=14)

def ihc():
    t = text_img('IHC', big, WHITE8)
    s = t.height; sp = Image.new('RGBA', (s, s), (0, 0, 0, 0)); d = ImageDraw.Draw(sp)
    for i in range(9):
        for j in range(9):
            x, y = (i + 0.5) / 9 * 2 - 1, (j + 0.5) / 9 * 2 - 1
            r2 = x * x + y * y
            if r2 < 0.95:
                rad = s * 0.045 * (1.15 - 0.5 * math.sqrt(r2)) * (1 if x < 0.3 else 0.7)
                d.ellipse([(x + 1) / 2 * s - rad, (y + 1) / 2 * s - rad, (x + 1) / 2 * s + rad, (y + 1) / 2 * s + rad], fill=WHITE8)
    return hcat(sp, t, gap=40)

def pissei(fill):
    t = text_img('PISSEI', small, fill, tracking=10)
    s = t.height; m = Image.new('RGBA', (s, s), (0, 0, 0, 0)); d = ImageDraw.Draw(m)
    d.polygon([(s * .1, s * .25), (s * .5, s * .95), (s * .9, s * .25), (s * .7, s * .25), (s * .5, s * .6), (s * .3, s * .25)], fill=fill)
    return hcat(m, t, gap=12)

def poly_img(pts_m, ybox, zbox, fill, px=4000):
    """Polygone en mètres (y, z) → image RGBA couvrant ybox × zbox (y vers la droite de l'image)."""
    W = int(px); H = int(px * (zbox[1] - zbox[0]) / (ybox[1] - ybox[0]))
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    for pts, f in zip(pts_m, fill):
        d.polygon([((y - ybox[0]) / (ybox[1] - ybox[0]) * W, (zbox[1] - z) / (zbox[1] - zbox[0]) * H) for y, z in pts], fill=f)
    return im

def decal(img, center, right, width=0.1, facing=(1, 0, 0), min_dot=0.25, depth=0.06, region=None, rotate=0.0, height=None):
    right = np.asarray(right, np.float32); facing = np.asarray(facing, np.float32)
    right /= np.linalg.norm(right); fn = facing / np.linalg.norm(facing)
    up = np.cross(fn, right); up /= np.linalg.norm(up); right = np.cross(up, fn)
    if rotate:
        c, s_ = math.cos(math.radians(rotate)), math.sin(math.radians(rotate))
        right, up = right * c + up * s_, -right * s_ + up * c
    a = np.asarray(img, np.float32) / 255
    hgt = width * img.height / img.width if height is None else height
    rel = pos - np.asarray(center, np.float32)
    u = rel @ right / width + 0.5
    v = 0.5 - rel @ up / hgt
    ok = (mask if region is None else region) & (u >= 0) & (u < 1) & (v >= 0) & (v < 1)
    ok &= (nor @ fn > min_dot) & (np.abs(rel @ fn) < depth)
    if not ok.any(): return
    H, W = a.shape[:2]
    fx = np.clip(u[ok] * W - 0.5, 0, W - 1.001); fy = np.clip(v[ok] * H - 0.5, 0, H - 1.001)
    x0 = fx.astype(int); y0 = fy.astype(int); tx = (fx - x0)[:, None]; ty = (fy - y0)[:, None]
    smp = (a[y0, x0] * (1 - tx) * (1 - ty) + a[y0, x0 + 1] * tx * (1 - ty) + a[y0 + 1, x0] * (1 - tx) * ty + a[y0 + 1, x0 + 1] * tx * ty)
    al = smp[:, 3:4]
    col[ok] = col[ok] * (1 - al) + smp[:, :3] * al

def anchor(region, cond, want):
    want = np.asarray(want, np.float32); want /= np.linalg.norm(want)
    score = np.where(region & cond, nor @ want, -9); k_ = np.unravel_index(np.argmax(score), score.shape)
    return pos[k_].copy(), nor[k_] / np.linalg.norm(nor[k_])

FRONT = dict(right=(0, 1, 0), facing=(1, 0, 0))
BACK = dict(right=(0, -1, 0), facing=(-1, 0, 0))

# Trame de points (dégradé « mesh » des bords noirs).
ang = math.radians(45); per = 7.0
uu_ = (cols * math.cos(ang) + rows * math.sin(ang)) / per
vv_ = (-cols * math.sin(ang) + rows * math.cos(ang)) / per
dotr = np.hypot(uu_ - np.round(uu_), vv_ - np.round(vv_))
def halftone(dist, width):
    """dist < 0 côté blanc : points noirs de plus en plus petits sur `width` mètres."""
    f = smooth(-width, 0.0, dist)
    return (dist < 0) & (dist > -width) & (dotr < 0.62 * np.sqrt(f))

# ---------------------------------------------------------------- empiècements du maillot
yy = np.clip(AY, 0.0, 0.32)
front = X > -0.05
zl_front = np.interp(yy, [0.0, 0.06, 0.12, 0.17, 0.32], [1.60, 1.47, 1.385, 1.30, 1.30])
s_rag = np.where(front, Z - zl_front, -1.0)            # raglan avant : > 0 côté épaule
R, L = Y < 0, Y > 0                                     # droite / gauche du coureur
# Droite : manche noire sur le devant et le dessus, épaule avant noire jusqu'au raglan.
s_rs = (X + 0.10) + 0.8 * (Z - 1.40)
black_r = jersey & ~collar & R & ((sleeve & (s_rs > 0)) | (torso & (s_rag > 0)))
dist_r = np.where(sleeve, s_rs, s_rag)
dots_r = jersey & ~collar & R & halftone(dist_r, 0.03)
# Gauche : manche blanche, bande noire de 2 cm le long du raglan, tramée des deux côtés.
band = 0.018
black_l = jersey & ~collar & L & front & (s_rag > 0) & (s_rag < band) & (Z > 1.28)
dots_l = jersey & ~collar & L & front & (Z > 1.28) & (halftone(s_rag, 0.022) | halftone(-(s_rag - band), 0.02))
# Flancs dans le dos : bande noire tramée sous le bras.
s_side = (np.abs(NY) - 0.82) * 0.25
side = torso & (X < -0.07) & (Z < 1.32) & (s_side > 0)
dots_side = torso & (X < -0.07) & (Z < 1.32) & halftone(s_side, 0.02)
black_j = black_r | black_l | side
paint(black_j, CARBON, aa(black_j, 0.7))
paint(dots_r | dots_l | dots_side, CARBON, aa(dots_r | dots_l | dots_side, 0.5))
fabric[jersey] = 0
fabric[black_j] = 1
paint(collar & (Z > 1.508), BLACK)                       # liseré du col

# ---------------------------------------------------------------- devant
def uae_block(face, z, scale=1.0):
    k = 0.06 if face is FRONT else -0.165
    decal(text_img('UAE', big, INK, tracking=10), (k, 0, z), width=0.20 * scale, region=jersey, **face)
    decal(emirates_box(), (k, 0, z - 0.068 * scale), width=0.19 * scale, region=jersey, **face)
    decal(text_img('XRG', big, INK, tracking=30), (k, 0, z - 0.135 * scale), width=0.165 * scale, region=jersey, **face)

uae_block(FRONT, 1.29)
decal(uci(INK), (0.06, -0.075, 1.40), width=0.055, region=torso, **FRONT)
decal(pissei(INK), (0.06, -0.07, 1.375), width=0.05, region=torso, **FRONT)
decal(fab(NAVYI), (0.06, 0.07, 1.405), width=0.04, region=torso, **FRONT)
decal(e_and(), (0.06, 0.07, 1.37), width=0.032, region=torso, **FRONT)

# Éclats du bas du devant, relevés sur la photo à plat (px → m : y = (px − 345) × 0,00085, z = 1,12 − (py − 345) × 0,00068).
def fy(px): return (px - 345) * 0.00085
def fz(py): return 1.12 - (py - 345) * 0.00068
P = lambda pts: [(fy(x), fz(y)) for x, y in pts]
ybox, zbox = (-0.17, 0.17), (0.96, 1.16)
frag = poly_img([
    P([(232, 410), (338, 470), (338, 545), (245, 540)]),                      # maille grise (droite du coureur)
    P([(360, 455), (420, 445), (432, 545), (360, 548)]),                      # maille grise (centre)
    P([(452, 380), (500, 360), (520, 450), (530, 560), (440, 560), (432, 470)]),  # aile sombre (hanche gauche)
    P([(352, 375), (458, 375), (448, 452), (402, 412)]),                      # éclat noir
    P([(355, 413), (398, 413), (442, 540), (430, 545)]),                      # éclat rouge
], ybox, zbox, [(206, 206, 208, 255), (214, 214, 216, 255), (44, 45, 50, 255), INK, REDI])
decal(frag, (0.05, sum(ybox) / 2, sum(zbox) / 2), width=ybox[1] - ybox[0], height=zbox[1] - zbox[0], region=torso, min_dot=0.1, depth=0.3, **FRONT)

# Flancs avant : « FAB » vertical bleu sous l'aisselle.
for sgn in (1, -1):
    decal(fab(NAVYI), (0.0, 0.14 * sgn, 1.22), right=(0, 0, 1), width=0.06, facing=(0.6, sgn, 0), region=torso, min_dot=0.75, depth=0.025)

# Épaules et manches : trèfle, « Analog », FAB, ADQ, Emirates.
for sgn in (1, -1):
    ink = WHITE8 if sgn < 0 else INK
    decal(analog(ink), (0.03, 0.125 * sgn, 1.435), width=0.085, region=jersey, rotate=-35 * sgn, min_dot=0.0, depth=0.08, **FRONT)
    decal(clover(WHITE8 if sgn < 0 else INK), (-0.06, 0.185 * sgn, 1.47), right=(1, 0, 0), width=0.022, facing=(0.2, 0.1 * sgn, 1), region=sleeve, min_dot=0.3, depth=0.08)
    # Face avant-extérieure de la manche (en T : vers l'avant et le haut) ; texte en travers du bras, l'épaule en haut.
    want = np.array([0.7, 0.25 * sgn, 0.66]); want /= np.linalg.norm(want)
    side_sl = sleeve & (np.sign(Y) == sgn)
    for name, img, yy_, w in (('FAB', fab(WHITE8 if sgn < 0 else NAVYI), 0.200, 0.058),
                              ('ADQ', text_img('ADQ', big, WHITE8 if sgn < 0 else INK), 0.228, 0.058),
                              ('Emirates', emirates_box(), 0.256, 0.066)):
        near = side_sl & (np.abs(AY - yy_) < 0.003)
        score = np.where(near, nor @ want, -9); k_ = np.unravel_index(np.argmax(score), score.shape)
        c_, n_ = pos[k_], nor[k_] / np.linalg.norm(nor[k_])
        right = np.cross(np.array([0, -sgn, 0.0]), n_)
        print('manche', sgn, name, c_.round(3), n_.round(2))
        decal(img, c_, right=right, width=w, facing=n_, region=side_sl, min_dot=0.2, depth=0.03)

# ---------------------------------------------------------------- dos
uae_block(BACK, 1.315, 1.1)
decal(e_and(False), (-0.16, 0, 1.478), width=0.03, region=jersey, **BACK)
# Éclats du dos, relevés sur la photo à plat du dos (image à droite = droite du coureur = −y).
def by(px): return (315 - px) * 0.0009
def bz(py): return 1.13 - (py - 295) * 0.00052
Q = lambda pts: [(by(x), bz(y)) for x, y in pts]
ybk, zbk = (-0.18, 0.18), (0.96, 1.18)
# Image en coordonnées « vues de dos » : la droite de l'image est −y ; on dessine en u = −y.
QB = lambda pts: [(-y, z) for y, z in Q(pts)]
fragb = poly_img([
    QB([(440, 265), (492, 262), (486, 342)]),                                  # petit éclat noir (droite)
    QB([(175, 560), (300, 345), (478, 345), (398, 438), (300, 580), (175, 580)]),  # grande bande noire
    QB([(352, 470), (404, 470), (325, 580), (272, 580)]),                      # bande rouge
], ybk, zbk, [INK, INK, REDI])
decal(fragb, (-0.165, 0, sum(zbk) / 2), width=ybk[1] - ybk[0], height=zbk[1] - zbk[0], region=torso, min_dot=0.25, depth=0.3, **BACK)
tag = vcat(text_img('#WeAreUAE', small, WHITE8), poly_img([[(0, 0), (0.3, 0), (0.3, 1), (0, 1)], [(0.3, 0), (1, 0), (1, 0.33), (0.3, 0.33)],
                                                           [(0.3, 0.33), (1, 0.33), (1, 0.66), (0.3, 0.66)], [(0.3, 0.66), (1, 0.66), (1, 1), (0.3, 1)]],
                                                          (0, 1), (0, 1), [REDI, (20, 20, 20, 255), WHITE8, (0, 132, 61, 255)], px=600).resize((600, 40)), gap=12)
decal(tag, (-0.17, by(312), bz(488)), width=0.075, region=torso, min_dot=-0.2, depth=0.3, **BACK)
for sgn in (1, -1):
    decal(analog(GREYI), (-0.14, 0.105 * sgn, 1.46), width=0.05, region=jersey, rotate=30 * sgn, min_dot=0.0, depth=0.08, **BACK)

# ---------------------------------------------------------------- cuissard
paint(shorts, SHORTS); fabric[shorts] = 2
# Hanches : empiècement maille gris anthracite, en dégradé vers le bas.
hip = shorts & (np.abs(NY) > 0.45) & (Z > 0.80)
paint(hip, srgb('34353a'), smooth(0.80, 0.97, Z) * 0.85 * hip)
leg_end = shorts & (Z < 0.668)
paint(leg_end, srgb('1b1b1e')); fabric[leg_end] = 3
for sgn in (1, -1):
    legside = shorts & (np.sign(Y) == sgn)
    out_f = np.array([0.35, sgn, 0.0])
    decal(pissei(WHITE8), (0.03, 0.15 * sgn, 0.95), right=(-sgn, 0.35, 0), width=0.07, facing=out_f, region=legside, min_dot=0.2, depth=0.08)
    # Logo vertical, le haut des lettres vers l'avant : G42 à gauche (lu de bas en haut), UAE à droite (de haut en bas).
    word = 'G42' if sgn > 0 else 'UAE'
    decal(text_img(word, big, WHITE8), (0.02, 0.165 * sgn, 0.765), right=(0, 0, sgn), width=0.12, facing=out_f, region=legside, min_dot=0.3, depth=0.07)
    bar = Image.new('RGBA', (600, 60), (0, 0, 0, 0)); ImageDraw.Draw(bar).rectangle([0, 0, 600, 60], fill=REDI)
    decal(bar, (0.045, 0.15 * sgn, 0.865), right=(0, 0, sgn), width=0.075, facing=out_f, rotate=-30, region=legside, min_dot=0.2, depth=0.08)
    zup = np.array([0, 0, 1.0])
    c_, n_ = anchor(legside, np.abs(Z - 0.722) < 0.002, (0.95, 0.32 * sgn, 0))
    decal(clover(WHITE8), c_, right=np.cross(zup, n_), width=0.026, facing=n_, region=legside, min_dot=0.2, depth=0.03)
    c_, n_ = anchor(legside, np.abs(Z - 0.69) < 0.002, (0.3, sgn, 0))
    decal(emirates_box(), c_, right=np.cross(zup, n_), width=0.085, facing=n_, region=legside, min_dot=0.1, depth=0.04)
    red_tab = Image.new('RGBA', (100, 100), REDI)
    decal(red_tab, (-0.06, 0.16 * sgn, 0.645), right=(1, 0, 0), width=0.02, facing=np.array([-0.4, sgn, 0]), region=legside, min_dot=0.1, depth=0.08)
decal(ihc(), (-0.18, 0, 0.975), width=0.16, region=shorts, **BACK)

if DEBUG:
    Image.fromarray((col * 255).clip(0, 255).astype(np.uint8)).save(OUT + '-flat.png')

# ---------------------------------------------------------------- réalisme : tissu, coutures, ombrage
ang = math.radians(60)
# Maille ajourée (blanc) : petits trous en quinconce, période 6 texels (~3 mm).
hx = cols / 6.0; hy = rows / (6.0 * 0.866)
hy_i = np.floor(hy); hx_s = hx + 0.5 * (hy_i % 2)
hole = np.hypot(hx_s - np.round(hx_s), (hy - hy_i - 0.5) * 0.866)
mesh_h = -smooth(0.32, 0.18, hole)                     # creux
rib = np.sin((cols * 0.7 + rows * 0.7) * math.pi / 2.2)  # côte fine du lycra
dotp = np.hypot((cols % 14) - 7, (rows % 14) - 7)      # picots silicone
gripper_h = smooth(4.0, 2.5, dotp)
fab_h = np.where(fabric == 0, mesh_h * 0.9, np.where(fabric == 3, gripper_h * 1.2 + rib * 0.05, rib * 0.18))
height += np.where(mask, fab_h, 0)

# Coutures : bord de chaque îlot UV (piqûre double, points de 4 texels).
inner = ndi.binary_erosion(mask, iterations=1)
dist_in = ndi.distance_transform_edt(inner)
stitch_line = ((np.abs(dist_in - 7) < 0.9) | (np.abs(dist_in - 12) < 0.9)) & mask
dash = ((cols + rows) // 5) % 2 == 0
stitch = stitch_line & dash
seam_shadow = mask & (dist_in < 16)
height -= np.where(seam_shadow, 0.6 * smooth(16, 3, dist_in), 0)
height += np.where(stitch, 0.5, 0)

# Diffuse : grain du fil, trous de maille un peu plus sombres, fils de couture légèrement contrastés.
rng = np.random.default_rng(7)
grain = ndi.gaussian_filter(rng.standard_normal((N, N)).astype(np.float32), 0.7)
lum = 1 + 0.018 * grain
lum += np.where(fabric == 0, 0.05 * mesh_h, 0)
lum += np.where(fabric != 0, 0.04 * rib, 0)
col *= lum[..., None]
lightc = col.mean(-1) > 0.5
col[stitch] = np.where(lightc[stitch][:, None], col[stitch] * 0.82, col[stitch] * 1.0 + 0.10)

# Plis : ombrage doux tiré de la normale Zwift (creux plus sombres), occlusion des coutures.
zn = np.asarray(Image.open(S + '/ref_normal.png').convert('RGB').resize((N, N), Image.BICUBIC), np.float32) / 255 * 2 - 1
fold = np.clip(zn[..., 2], 0, 1)
shade = 1 - 0.35 * (1 - fold) - 0.07 * np.where(seam_shadow, smooth(16, 2, dist_in), 0)
col *= np.clip(shade, 0.7, 1)[..., None]

# Bords : on étale la couleur hors des îlots (évite les liserés au filtrage).
outside = ~mask
idx = ndi.distance_transform_edt(outside, return_distances=False, return_indices=True)
col = col[idx[0], idx[1]]
Image.fromarray((np.clip(col, 0, 1) * 255).astype(np.uint8)).save(OUT + '-diffuse.png')

# Normale : normale Zwift + relief fin (mélange RNM simplifié).
hs = ndi.gaussian_filter(height, 0.6)
gx = ndi.sobel(hs, 1) / 8; gy = ndi.sobel(hs, 0) / 8
k = 0.9
dn = np.dstack([-gx * k, gy * k, np.ones_like(gx)]); dn /= np.linalg.norm(dn, axis=-1, keepdims=True)
b = zn.copy(); b[..., 2] = np.clip(b[..., 2], 0.05, 1)
t = b + np.array([0, 0, 1], np.float32); uu = dn * np.array([-1, -1, 1], np.float32)
r = t * (t * uu).sum(-1, keepdims=True) / t[..., 2:3] - uu
r /= np.linalg.norm(r, axis=-1, keepdims=True)
r = np.where(mask[..., None], r, b)
Image.fromarray(((r * 0.5 + 0.5) * 255).clip(0, 255).astype(np.uint8)).save(OUT + '-normal.png')
print('ok', OUT)
