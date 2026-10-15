#!/usr/bin/env python3
"""Normalize one generated UI component to an independent PNG while checking alpha."""
import io,sys
from collections import deque
from PIL import Image
data=sys.stdin.buffer.read(40*1024*1024+1)
if len(data)>40*1024*1024: raise ValueError("component input too large")
im=Image.open(io.BytesIO(data))
im.load()
if im.width*im.height>35000000: raise ValueError("image pixels exceed safe limit")
rgba=im.convert("RGBA")
alpha=rgba.getchannel("A")
transparent=alpha.getextrema()[0]<255
# When an image model returns a flat background despite transparent-background
# request, remove only a sufficiently uniform border-connected matte.
removed=False
if not transparent:
    width,height=rgba.size
    if width*height>3000000:
        out=io.BytesIO();rgba.save(out,format="PNG")
        sys.stderr.write("TRANSPARENT=0 MATTE_REMOVED=0\n")
        sys.stdout.buffer.write(out.getvalue());sys.exit(0)
    corners=[rgba.getpixel((x,y)) for x,y in ((0,0),(width-1,0),(0,height-1),(width-1,height-1))]
    center=tuple(sorted(c[i] for c in corners)[2] for i in range(3))
    if max(max(abs(c[i]-center[i]) for i in range(3)) for c in corners)<=17:
        step=max(1,min(width,height)//80)
        boundary=([(x,0) for x in range(0,width,step)]+[(x,height-1) for x in range(0,width,step)]
          +[(0,y) for y in range(0,height,step)]+[(width-1,y) for y in range(0,height,step)])
        matches=0
        for x,y in boundary:
            p=rgba.getpixel((x,y))
            if max(abs(p[i]-center[i]) for i in range(3))<=24: matches+=1
        if matches>=len(boundary)*.92:
            rgba_px=rgba.load()
            mask=Image.new("L",rgba.size,255);mask_px=mask.load()
            # Connected flood fill bounded by image area (uses compact bytearray).
            seen=bytearray(width*height)
            pending=deque()
            def enqueue(x,y):
                i=y*width+x
                if not seen[i]:
                    seen[i]=1;pending.append(i)
            for x in range(width):
                enqueue(x,0);enqueue(x,height-1)
            for y in range(height):
                enqueue(0,y);enqueue(width-1,y)
            count=0
            while pending:
                index=pending.popleft()
                x=index%width;y=index//width
                color=rgba_px[x,y]
                if max(abs(color[i]-center[i]) for i in range(3))>27:continue
                mask_px[x,y]=0;count+=1
                if x>0:enqueue(x-1,y)
                if x+1<width:enqueue(x+1,y)
                if y>0:enqueue(x,y-1)
                if y+1<height:enqueue(x,y+1)
            if .03*width*height<count<.92*width*height:
                rgba.putalpha(mask);removed=True
                transparent=True
out=io.BytesIO()
rgba.save(out,format="PNG")
buf=out.getvalue()
if len(buf)>36*1024*1024:raise ValueError("normalized component PNG exceeds 36 MB")
sys.stderr.write("TRANSPARENT="+("1" if transparent else "0")+" MATTE_REMOVED="+("1" if removed else "0")+"\n")
sys.stdout.buffer.write(buf)


