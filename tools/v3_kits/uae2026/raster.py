import json, numpy as np, sys
from PIL import Image
S=sys.argv[1]; N=int(sys.argv[2])
tris=json.load(open(S+'/kit_tris.json'))
pos=np.zeros((N,N,3),np.float32); nor=np.zeros((N,N,3),np.float32); mask=np.zeros((N,N),np.uint8)
for t in tris:
    if t[0]!='LOD0_g03': continue
    a=np.array(t[1:],np.float64)
    xs=a[:,0]*N; ys=(1-a[:,1])*N
    x0,x1=int(max(0,np.floor(xs.min()))),int(min(N-1,np.ceil(xs.max())))
    y0,y1=int(max(0,np.floor(ys.min()))),int(min(N-1,np.ceil(ys.max())))
    if x1<x0 or y1<y0: continue
    gx,gy=np.meshgrid(np.arange(x0,x1+1)+.5,np.arange(y0,y1+1)+.5)
    (xa,xb,xc),(ya,yb,yc)=xs,ys
    d=(yb-yc)*(xa-xc)+(xc-xb)*(ya-yc)
    if abs(d)<1e-12: continue
    l1=((yb-yc)*(gx-xc)+(xc-xb)*(gy-yc))/d; l2=((yc-ya)*(gx-xc)+(xa-xc)*(gy-yc))/d; l3=1-l1-l2
    e=-0.02
    ins=(l1>=e)&(l2>=e)&(l3>=e)
    L=np.stack([l1,l2,l3],-1)
    P=L@a[:,2:5]; Nn=L@a[:,5:8]
    sl=(slice(y0,y1+1),slice(x0,x1+1))
    pos[sl][ins]=P[ins]; nor[sl][ins]=Nn[ins]; mask[sl][ins]=255
np.savez_compressed(S+f'/maps{N}.npz',pos=pos,nor=nor,mask=mask)
P=pos[mask>0]; print('bounds',P.min(0),P.max(0))
# visualise
lo,hi=P.min(0),P.max(0)
vis=((pos-lo)/(hi-lo)*255).clip(0,255).astype(np.uint8); vis[mask==0]=0
Image.fromarray(vis).save(S+'/posmap.png')
# Contrôle facultatif : superposition avec la texture UAE 2017 de référence (cache local du garage V3).
import glob
refs=glob.glob('out/v3/map/171-diffuse-0-*.png')
if refs:
    ref=Image.open(refs[0]).convert('RGB').resize((N,N))
    Image.blend(ref,Image.fromarray(vis),0.5).save(S+'/overlay.jpg')
