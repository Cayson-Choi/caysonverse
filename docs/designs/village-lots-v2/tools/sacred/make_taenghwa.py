"""후불탱화 texture from a CC0 museum photograph (Cleveland Museum of Art 1998.120, Korea, Joseon, 1878).

    python -E -P make_taenghwa.py <cma_1998.120.jpg> <out_dir>

- removes the written dedication cartouche at the bottom centre (no text in the hall), leaving a plain red panel
- a gentle "freshly painted" restore: lifts the yellowed silk, a little saturation and contrast (no repainting)
- writes taenghwa_color.png (3072 wide) + taenghwa_normal.png (faint silk weave and paint relief) + taenghwa_orm.png
"""
import sys, os
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter
from scipy import ndimage as ndi

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
im = Image.open(src).convert("RGB")
W, H = im.size
a = np.asarray(im).astype(np.float32)
# cartouche (measured on the 3400 x 2080 print image)
x0, x1, y0, y1 = 1409, 1969, 1904, 2031
sx, sy = W / 3400, H / 2080
x0, x1, y0, y1 = int(x0 * sx) + 8, int(x1 * sx) - 8, int(y0 * sy) + 8, int(y1 * sy) - 6
box = a[y0:y1, x0:x1]
closed = np.stack([ndi.grey_closing(box[..., c], size=(15, 15)) for c in range(3)], -1)
closed = np.stack([ndi.gaussian_filter(closed[..., c], 6) for c in range(3)], -1)
grain = box - np.stack([ndi.gaussian_filter(box[..., c], 1.5) for c in range(3)], -1)
grain = np.clip(grain, -6, 6) * (box.mean(2, keepdims=True) > closed.mean(2, keepdims=True) * 0.8)
a[y0:y1, x0:x1] = closed + grain
im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
# crop the museum mount edge, gentle restore
m = int(0.006 * W)
im = im.crop((m, m, W - m, H - int(0.018 * H)))
arr = np.asarray(im).astype(np.float32)
arr[..., 2] *= 1.05; arr[..., 0] *= 0.99            # lift the yellowed silk toward clean ground
im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
# brand-new (owner 2026-11-17 "새것 같아야 해"): pull craquelure / dark cracks up to the local paint colour, then fresh colour
arr = np.asarray(im).astype(np.float32)
loc = np.stack([ndi.uniform_filter(arr[..., c], 9) for c in range(3)], -1)
lum = arr.mean(2, keepdims=True); llum = loc.mean(2, keepdims=True)
dark = np.clip((llum * 0.80 - lum) / np.maximum(llum * 0.25, 1), 0, 1)
arr = arr * (1 - dark) + loc * dark
im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
im = ImageEnhance.Color(im).enhance(1.25)
im = ImageEnhance.Contrast(im).enhance(1.08)
im = ImageEnhance.Brightness(im).enhance(1.06)
w2 = 3072; h2 = int(round(im.size[1] * w2 / im.size[0] / 4) * 4)
im = im.resize((w2, h2), Image.LANCZOS)
im.save(os.path.join(out, "taenghwa_color.png"))
# normal: silk weave (fine crossed threads) + paint relief from luminance high-pass
g = np.asarray(im.convert("L")).astype(np.float32) / 255
hp = g - ndi.gaussian_filter(g, 3)
yy, xx = np.mgrid[0:h2, 0:w2].astype(np.float32)
weave = (np.sin(xx * np.pi / 1.5) + np.sin(yy * np.pi / 1.5)) * 0.15
hgt = hp * 1.2 + weave
gy, gx = np.gradient(hgt)
n = np.stack([-gx, gy, np.ones_like(gx)], -1); n /= np.linalg.norm(n, axis=-1, keepdims=True)
Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8)).save(os.path.join(out, "taenghwa_normal.png"))
orm = np.zeros((h2, w2, 3), np.uint8); orm[..., 0] = 255; orm[..., 1] = int(0.82 * 255); orm[..., 2] = 0
# gold leaf on the halos/mandorla reads a touch shinier
gold = (np.asarray(im).astype(np.float32)[..., 0] > 170) & (np.asarray(im).astype(np.float32)[..., 2] < 90)
orm[gold, 1] = int(0.5 * 255); orm[gold, 2] = int(0.4 * 255)
Image.fromarray(orm).save(os.path.join(out, "taenghwa_orm.png"))
print("taenghwa", w2, h2, "aspect", round(w2 / h2, 3))
