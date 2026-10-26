"""Icônes de l'appli compagnon (PWA Android / iOS) : la tête de Robert sur fond sombre.

Source : tools/robert-attente/source.webp (planche 1024 px, deux Robert sur fond blanc ; on prend celui de
gauche). Le fond blanc est retiré depuis les bords (le contour noir du dessin arrête la propagation), puis la
tête est posée sur le fond du site (#10151c, lueur chaude derrière).

Sorties dans apps/companion/public/icons/ :
  icon-192.png, icon-512.png            coins arrondis (« any »)
  icon-maskable-512.png                 pleine page, tête dans la zone sûre (« maskable » : Android recadre)
  apple-touch-icon.png (180)            pleine page (iOS arrondit lui-même)
  icon.svg                              l'icône 192 embarquée (onglet du navigateur, anciens lanceurs)

Lancer : python apps/companion/scripts/make-icons.py   (Pillow requis)
"""
import base64
import io
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / 'tools' / 'robert-attente' / 'source.webp'
OUT = Path(__file__).resolve().parents[1] / 'public' / 'icons'
BG = (0x10, 0x15, 0x1C)
GLOW = (0xFF, 0xD2, 0x3F)

# Tête du Robert de gauche (le casque, le visage, la barbe) dans la planche, sans les épaules.
HEAD = (0, 0, 340, 384)


def head_cutout() -> Image.Image:
    """Tête détourée : fond blanc retiré depuis les bords, liseré clair rongé d'un pixel."""
    im = Image.open(SOURCE).convert('RGB').crop(HEAD)
    w, h = im.size
    # Fond = pixels quasi blancs reliés au bord de l'image.
    r, g, b = im.split()
    white = ImageChops.darker(ImageChops.darker(r.point(lambda v: 255 if v > 238 else 0), g.point(lambda v: 255 if v > 238 else 0)), b.point(lambda v: 255 if v > 238 else 0))
    flood = white.copy()
    for seed in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)] + [(x, 0) for x in range(0, w, 20)] + [(0, y) for y in range(0, h, 20)] + [(w - 1, y) for y in range(0, h, 20)]:
        if flood.getpixel(seed) == 255:
            ImageDraw.floodfill(flood, seed, 128)
    background = flood.point(lambda v: 255 if v == 128 else 0)
    alpha = ImageChops.invert(background)
    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    # Col du maillot jaune (sous la barbe) : retiré, pour ne garder que la tête.
    px = im.load()
    apx = alpha.load()
    for y in range(h):
        for x in range(w):
            pr, pg, pb = px[x, y]
            if pr > 170 and pg > 150 and pb < 110 and pg - pb > 85:
                apx[x, y] = 0
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.6))
    # Bas de la barbe : fondu sur 26 px, pour ne pas laisser de coupure nette ni de reste du col.
    fade = 26
    apx = alpha.load()
    for y in range(h - fade, h):
        k = (h - 1 - y) / fade
        for x in range(w):
            apx[x, y] = int(apx[x, y] * k)
    out = im.convert('RGBA')
    out.putalpha(alpha)
    # Rogne la tête à son contour visible.
    return out.crop(out.getbbox())


def canvas(size: int, head: Image.Image, fill: float, rounded: bool) -> Image.Image:
    """Fond sombre avec une lueur chaude, tête centrée sur `fill` de la hauteur."""
    img = Image.new('RGBA', (size, size), BG + (255,))
    glow = Image.new('L', (size, size), 0)
    ImageDraw.Draw(glow).ellipse((size * 0.12, size * 0.1, size * 0.88, size * 0.86), fill=70)
    glow = glow.filter(ImageFilter.GaussianBlur(size * 0.14))
    img.paste(Image.new('RGBA', (size, size), GLOW + (255,)), (0, 0), glow)
    k = size * fill / head.height
    hd = head.resize((max(1, round(head.width * k)), max(1, round(head.height * k))), Image.LANCZOS)
    img.alpha_composite(hd, ((size - hd.width) // 2, round((size - hd.height) / 2 + size * 0.015)))
    if rounded:
        mask = Image.new('L', (size * 4, size * 4), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1), radius=size * 4 * 96 // 512, fill=255)
        img.putalpha(mask.resize((size, size), Image.LANCZOS))
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    head = head_cutout()
    canvas(512, head, 0.78, True).save(OUT / 'icon-512.png', optimize=True)
    canvas(192, head, 0.78, True).save(OUT / 'icon-192.png', optimize=True)
    canvas(512, head, 0.60, False).save(OUT / 'icon-maskable-512.png', optimize=True)
    canvas(180, head, 0.72, False).save(OUT / 'apple-touch-icon.png', optimize=True)
    buf = io.BytesIO()
    canvas(192, head, 0.78, True).save(buf, 'PNG', optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode()
    (OUT / 'icon.svg').write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 192 192" width="192" height="192"><image width="192" height="192" xlink:href="data:image/png;base64,{b64}"/></svg>\n',
        encoding='utf-8',
    )
    print('icônes écrites dans', OUT)


if __name__ == '__main__':
    main()
