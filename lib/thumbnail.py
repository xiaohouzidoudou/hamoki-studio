from pathlib import Path
import sys
from PIL import Image, ImageOps

source, destination = map(Path, sys.argv[1:3])
Image.MAX_IMAGE_PIXELS = 80_000_000
with Image.open(source) as image:
    image = ImageOps.exif_transpose(image)
    image.thumbnail((480, 480), Image.Resampling.LANCZOS, reducing_gap=3.0)
    if image.mode not in ('RGBA', 'RGB'):
        image = image.convert('RGBA' if 'A' in image.getbands() or 'transparency' in image.info else 'RGB')
    image.save(destination, format='WEBP', quality=72, method=4)
