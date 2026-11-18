"""Side-wall hanging scroll texture from a CC0 museum photograph (Cleveland Museum of Art 1918.542 "Tathagata Buddha", Korea, late 1800s).

    python -E -P make_scroll.py <cma_1918.542.jpg> <out_dir>

Brand-new treatment like make_taenghwa.py (craquelure pulled up to the local paint colour, a little saturation); writes scroll_color.png
(896 wide: the print is 1378 x 3400), scroll_normal.png (silk weave) and scroll_orm.png.
"""
import sys, os
import numpy as np
from PIL import Image, ImageEnhance
from scipy import ndimage as ndi

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
im = Image.open(src).convert("RGB")
arr = np.asarray(im).astype(np.float32)
loc = np.stack([ndi.uniform_filter(arr[..., c], 7) for c in range(3)], -1)
lum = arr.mean(2, keepdims=True); llum = loc.mean(2, keepdims=True)
dark = np.clip((llum * 0.82 - lum) / np.maximum(llum * 0.25, 1), 0, 1) * (llum > 60)   # not the black ink outlines (dark local mean)
arr = arr * (1 - dark) + loc * dark
im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
im = ImageEnhance.Color(im).enhance(1.2)
im = ImageEnhance.Contrast(im).enhance(1.05)
im = ImageEnhance.Brightness(im).enhance(1.05)
w2 = 896
h2 = int(round(im.size[1] * w2 / im.size[0] / 4) * 4)
im = im.resize((w2, h2), Image.LANCZOS)
im.save(os.path.join(out, "scroll_color.png"))
g = np.asarray(im.convert("L")).astype(np.float32) / 255
yy, xx = np.mgrid[0:h2, 0:w2].astype(np.float32)
hgt = (g - ndi.gaussian_filter(g, 2.5)) * 0.8 + (np.sin(xx * np.pi / 1.4) + np.sin(yy * np.pi / 1.4)) * 0.12
gy, gx = np.gradient(hgt)
n = np.stack([-gx, gy, np.ones_like(gx)], -1)
n /= np.linalg.norm(n, axis=-1, keepdims=True)
Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8)).save(os.path.join(out, "scroll_normal.png"))
orm = np.zeros((h2, w2, 3), np.uint8)
orm[..., 0] = 255
orm[..., 1] = int(0.8 * 255)
Image.fromarray(orm).save(os.path.join(out, "scroll_orm.png"))
print("scroll", w2, h2, "aspect", round(w2 / h2, 4))
