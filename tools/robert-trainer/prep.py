from PIL import Image, ImageDraw, ImageFilter
import numpy as np, colorsys
from scipy import ndimage
import os
HERE=os.path.dirname(os.path.abspath(__file__))
OUT=os.path.join(HERE,'robert')+'/'
os.makedirs(OUT,exist_ok=True)
src=Image.open(os.path.join(HERE,'source.jpg')).convert('RGB')
im=np.asarray(src).astype(np.float32)
H,W,_=im.shape
mn=im.min(axis=2); spread=im.max(axis=2)-mn
white=(mn>222)&(spread<22)
lab,n=ndimage.label(white)
border=set(np.unique(np.concatenate([lab[0],lab[-1],lab[:,0],lab[:,-1]])))-{0}
holes={161,162,163,166,173,179,181,183,191,212,214,216,217,218,219,220,225,226,227,228}
bg=np.isin(lab,list(border|holes))
# Petits îlots blancs isolés dans le fond : fond aussi.
bg=ndimage.binary_closing(bg,iterations=1)|bg
# Alpha : 0 dans le fond ; bord adouci (pixels clairs au contact du fond).
alpha=np.where(bg,0.0,1.0)
near=ndimage.binary_dilation(bg,iterations=3)&~bg
a_edge=np.clip((255-mn)/70.0,0,1)
alpha=np.where(near,np.minimum(alpha,a_edge),alpha)
rgb=im.copy()
a3=np.maximum(alpha,1e-3)[...,None]
rgb=np.where(near[...,None],np.clip((rgb-(1-a3)*255)/a3,0,255),rgb)
# Maillot rouge -> jaune du site (même ombrage), dans la zone du maillot seulement.
zone=Image.new('L',(W,H),0)
ImageDraw.Draw(zone).polygon([(380,455),(700,440),(705,525),(600,600),(560,655),(470,665),(380,650)],fill=255)
zone=np.asarray(zone)>0
import matplotlib.colors as mc
hsv=mc.rgb_to_hsv(np.clip(rgb/255.0,0,1))
h,sat,val=hsv[...,0],hsv[...,1],hsv[...,2]
redish=zone&((h<0.028)|(h>0.95))&(sat>0.45)&(val>0.25)
# Rouge -> jaune du site (#ffd23f : teinte 46°), ombrage gardé, un peu éclairci.
nh=np.full_like(h,46/360); ns=np.clip(sat*0.85,0,0.8); nv=np.clip(val*1.25+0.05,0,1)
yel=mc.hsv_to_rgb(np.dstack([nh,ns,nv]))*255
rgb=np.where(redish[...,None],yel,rgb)
full=np.dstack([rgb,alpha*255]).astype(np.uint8)
Image.fromarray(full,'RGBA').save(OUT+'full.png')

def poly_mask(pts):
    m=Image.new('L',(W,H),0); ImageDraw.Draw(m).polygon(pts,fill=255); return np.asarray(m)>0
ARM=[(688,520),(700,470),(722,428),(735,380),(722,334),(760,288),(845,296),(845,425),(775,425),(735,470),(712,520)]
HEAD=[(300,30),(705,30),(705,300),(668,330),(668,452),(625,496),(560,515),(480,503),(432,472),(400,425),(330,335),(298,285)]
arm=poly_mask(ARM); head=poly_mask(HEAD)&~arm
def layer(mask):
    out=full.copy(); out[...,3]=np.where(mask,out[...,3],0); return out
Image.fromarray(layer(arm),'RGBA').save(OUT+'arm.png')
Image.fromarray(layer(head),'RGBA').save(OUT+'head.png')
body=full.copy(); body[...,3]=np.where(arm|head,0,body[...,3])
# Sous le menton : col du maillot (caché par la tête au repos, visible si elle bascule).
neck=poly_mask([(450,440),(640,440),(625,496),(560,515),(480,503),(450,480)])
body[...,:3]=np.where(neck[...,None],np.array([235,190,50],np.uint8),body[...,:3])
body[...,3]=np.where(neck,255,body[...,3])
# Pédalage : 12 images, pieds sur un cercle (pied gauche visible, pied droit derrière le cadre en opposition).
FEET=[((440,852),0.0),((565,878),np.pi)]
RAD=15; SIG=42
yy,xx=np.mgrid[0:H,0:W].astype(np.float32)
for f in range(12):
    th=2*np.pi*f/12
    dx=np.zeros((H,W),np.float32); dy=np.zeros((H,W),np.float32)
    for (cx,cy),ph in FEET:
        ox=RAD*(np.cos(th+ph)-np.cos(ph)); oy=RAD*(np.sin(th+ph)-np.sin(ph))
        w=np.exp(-((xx-cx)**2+(yy-cy)**2)/(2*SIG**2))
        dx+=w*ox; dy+=w*oy
    sx=np.clip(xx-dx,0,W-1); sy=np.clip(yy-dy,0,H-1)
    out=np.stack([ndimage.map_coordinates(body[...,c].astype(np.float32),[sy,sx],order=1) for c in range(4)],axis=-1)
    Image.fromarray(np.clip(out,0,255).astype(np.uint8),'RGBA').save(OUT+f'body_{f:02d}.png')
print('ok')
