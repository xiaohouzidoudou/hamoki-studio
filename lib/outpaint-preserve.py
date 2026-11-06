#!/usr/bin/env python3
"""Overlay the exact unmodified source patch onto an AI-generated outpaint.

The AI image may not honor the requested pixels/ratio. ImageOps.fit normalizes
its canvas without nonuniform stretching, then the opaque (or transparent)
source pixels overwrite ONLY the original rectangle. All generated margins
stay intact and the patch is unchanged.
"""
import json
import sys
from PIL import Image, ImageOps

def main():
    if len(sys.argv) != 5:
        raise ValueError("expected generated, source, output and rectangle")
    target, original, destination, raw = sys.argv[1:]
    box = json.loads(raw)
    width, height = box['width'], box['height']
    x, y, w, h = box['x'], box['y'], box['w'], box['h']
    with Image.open(original) as image:
        if image.size != (width, height):
            raise ValueError('source canvas dimensions differ from requested outpaint')
        patch = image.convert('RGBA').crop((x, y, x+w, y+h))
    with Image.open(target) as image:
        art = image.convert('RGBA')
        if art.size != (width, height):
            art = ImageOps.fit(art, (width, height), method=Image.Resampling.LANCZOS)
    # paste() WITHOUT a mask replaces original pixels exactly, including alpha.
    art.paste(patch, (x, y))
    art.save(destination, format='PNG')

if __name__ == '__main__':
    main()
