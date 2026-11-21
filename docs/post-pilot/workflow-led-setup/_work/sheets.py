import sys,glob
from PIL import Image
prefix=sys.argv[1]; per=int(sys.argv[2]) if len(sys.argv)>2 else 8
fs=sorted(glob.glob(f'shots/{prefix}-[0-9]*.png'))
for k in range(0,len(fs),per):
    ims=[Image.open(f) for f in fs[k:k+per]]
    w,h=ims[0].size; cols=4; rows=(len(ims)+cols-1)//cols
    s=Image.new('RGB',(cols*(w+8),rows*(h+8)),(225,225,225))
    for i,im in enumerate(ims): s.paste(im,((i%cols)*(w+8),(i//cols)*(h+8)))
    out=f'shots/_{prefix}_{k//per+1}.png'; s.save(out); print(out,s.size)
