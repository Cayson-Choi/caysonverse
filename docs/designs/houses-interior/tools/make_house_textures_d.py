"""HA wallpaper textures (system Python: PIL + numpy): subtle patterned 벽지, near-white so the vertex tint colours them.
  python art/village/tools/houses/make_house_textures_d.py   -> art/village/work/tex_h/T_h_wp1..5.png (512 px, tile 2.5 m: pattern pitch ~0.3 m)
"""
import math
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "work", "tex_h")
N = 512
rng = np.random.default_rng(7)


def base(v=0.97):
    return Image.new("RGB", (N, N), tuple(int(255 * v) for _ in range(3)))


def grain(im, amt=0.025):
    a = np.asarray(im, np.float32) / 255
    a = a + rng.normal(0, amt, a.shape[:2])[..., None]
    a = a * (1 + 0.03 * np.sin(np.arange(N)[None, :, None] * 2 * math.pi / 4))   # weave
    return Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))


def save(im, n):
    im.save(os.path.join(OUT, f"T_h_wp{n}.png"))
    print("wrote T_h_wp%d.png" % n, np.asarray(im).mean((0, 1)).round(1))


# 1 modern: fine linen, faint vertical slubs
im = base(0.96)
a = np.asarray(im, np.float32) / 255
for x in range(0, N, 3):
    a[:, x:x + 1] *= 0.985 + 0.02 * rng.random()
save(grain(Image.fromarray((a * 255).astype(np.uint8)), 0.02), 1)

# 2 family: soft stripes with tiny dots
im = base(0.97)
d = ImageDraw.Draw(im)
for x in range(0, N, 64):
    d.rectangle([x, 0, x + 21, N], fill=(228, 232, 240))
    for y in range(16, N, 64):
        d.ellipse([x + 40 - 3, y - 3, x + 40 + 3, y + 3], fill=(214, 222, 236))
save(grain(im, 0.012), 2)

# 3 farm: small four-petal flowers on a cream ground
im = base(0.97)
d = ImageDraw.Draw(im)
for gx in range(0, N, 64):
    for gy in range(0, N, 64):
        ox = 32 if (gy // 64) % 2 else 0
        cx, cy = gx + ox + 16, gy + 16
        for k in range(4):
            a_ = k * math.pi / 2
            px, py = cx + 7 * math.cos(a_), cy + 7 * math.sin(a_)
            d.ellipse([px - 5, py - 5, px + 5, py + 5], fill=(232, 205, 160))
        d.ellipse([cx - 3, cy - 3, cx + 3, cy + 3], fill=(205, 150, 110))
        d.line([cx, cy + 12, cx, cy + 28], fill=(190, 205, 165), width=2)
save(grain(im, 0.012), 3)

# 4 ondol: diamond lattice with a small blossom at every crossing (traditional wallpaper)
im = base(0.97)
d = ImageDraw.Draw(im)
for gx in range(0, N + 1, 64):
    for gy in range(0, N + 1, 64):
        d.line([gx, gy - 32, gx + 32, gy], fill=(224, 208, 170), width=2)
        d.line([gx + 32, gy, gx, gy + 32], fill=(224, 208, 170), width=2)
        d.line([gx, gy - 32, gx - 32, gy], fill=(224, 208, 170), width=2)
        d.line([gx - 32, gy, gx, gy + 32], fill=(224, 208, 170), width=2)
        for k in range(5):
            a_ = k * 2 * math.pi / 5
            d.ellipse([gx + 6 * math.cos(a_) - 3, gy + 6 * math.sin(a_) - 3, gx + 6 * math.cos(a_) + 3, gy + 6 * math.sin(a_) + 3], fill=(210, 160, 130))
        d.ellipse([gx - 2, gy - 2, gx + 2, gy + 2], fill=(190, 140, 70))
save(grain(im, 0.012), 4)

# 5 sunroom: leaf sprigs in light vertical stripes
im = base(0.97)
d = ImageDraw.Draw(im)
for x in range(0, N, 64):
    d.line([x + 32, 0, x + 32, N], fill=(214, 230, 218), width=3)
    for y in range(8, N, 40):
        d.ellipse([x + 32 + 2, y, x + 32 + 16, y + 8], fill=(200, 224, 206))
        d.ellipse([x + 32 - 16, y + 18, x + 32 - 2, y + 26], fill=(200, 224, 206))
save(grain(im, 0.012), 5)
