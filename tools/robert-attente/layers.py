import sys
from PIL import Image, ImageDraw
src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGBA'); W, H = im.size
def mask(poly=None, rect=None):
    m = Image.new('L', (W, H), 0); d = ImageDraw.Draw(m)
    if poly: d.polygon(poly, fill=255)
    for r in rect or []: d.rectangle(r, fill=255)
    return m
def cut(m):
    o = Image.new('RGBA', (W, H), (0,0,0,0)); o.paste(im, (0,0), m); return o
from PIL import ImageChops
ARM = [(176,228),(176,192),(198,150),(200,112),(259,105),(259,185),(232,222),(200,236)]
LEG = [(58,334),(99,334),(98,364),(87,372),(86,413),(49,413),(46,388),(53,360)]
arm = mask(ARM)
upper = ImageChops.subtract(mask(rect=[(0,0,W,279),(0,0,139,286)]), arm)
base = ImageChops.subtract(Image.new('L',(W,H),255), mask(rect=[(0,0,W,271)]))
base = ImageChops.subtract(base, arm)
leg = mask(LEG)
for name, m in [('base',base),('upper',upper),('arm',arm),('leg',leg)]:
    cut(m).save(f'{out}/{name}.png')
