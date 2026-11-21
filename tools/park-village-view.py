"""Stitch the gate-view photo ring (e2e/probes/gate-view-capture.mjs) into the cylinder strip the park draws beyond its arch.

  python tools/park-village-view.py <shots dir> <tag> <out.webp> [width=2048] [height=512]

The strip is a cylinder of radius R round the capture eye: u runs with the bearing (-90 .. +90 degrees round north, west to east), v with
the height on the cylinder (H0 .. H1 metres above the ground). The photos' magenta clear colour (no sky was drawn) becomes alpha 0, so the
park's own sky shows over the village's roofs; the strip's top fades out so nothing ends in a hard line.
The numbers (R, H0, H1, the span) are the ones land/ParkVillageView.tsx builds its cylinder with: keep them the same.
"""
import json, math, os, sys
import numpy as np
from PIL import Image

R, H0, H1, SPAN_DEG = 60.0, 0.0, 15.0, 180.0

d, tag, out = sys.argv[1], sys.argv[2], sys.argv[3]
W = int(sys.argv[4]) if len(sys.argv) > 4 else 2048
H = int(sys.argv[5]) if len(sys.argv) > 5 else 512
meta = json.load(open(os.path.join(d, tag + ".json")))
eye_y, vfov, step, n = meta["eye"][1], math.radians(meta["vfov"]), math.radians(meta["stepDeg"]), meta["shots"]
shots = [np.asarray(Image.open(os.path.join(d, f"{tag}-{i:02d}.png")).convert("RGB"), dtype=np.float32) for i in range(n)]
sh, sw = shots[0].shape[:2]
tv = math.tan(vfov / 2)
th = tv * sw / sh

theta = (np.arange(W) + 0.5) / W * math.radians(SPAN_DEG) - math.radians(SPAN_DEG) / 2  # bearing of each column
hgt = H1 - (np.arange(H) + 0.5) / H * (H1 - H0)  # height of each row (top row first)
tan_e = (hgt - eye_y) / R
idx = np.clip(np.round(theta / step + (n - 1) / 2).astype(int), 0, n - 1)
delta = theta - (idx - (n - 1) / 2) * step
x = (np.tan(delta) / th * 0.5 + 0.5) * sw - 0.5  # per column
y = (0.5 - (tan_e[:, None] / np.cos(delta)[None, :]) / tv * 0.5) * sh - 0.5  # per row and column

rgb = np.zeros((H, W, 3), np.float32)
for i in range(n):
    cols = np.where(idx == i)[0]
    if cols.size == 0:
        continue
    xs = np.clip(x[cols], 0, sw - 1.001)
    ys = np.clip(y[:, cols], 0, sh - 1.001)
    x0 = np.floor(xs).astype(int); fx = (xs - x0)[None, :, None]
    y0 = np.floor(ys).astype(int); fy = (ys - y0)[:, :, None]
    im = shots[i]
    a = im[y0, x0[None, :]]; b = im[y0, x0[None, :] + 1]; c = im[y0 + 1, x0[None, :]]; e = im[y0 + 1, x0[None, :] + 1]
    rgb[:, cols] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy

# the key: the clear colour as the photos hold it (the corner of the middle photo is sky), distance to it -> alpha
key = shots[n // 2][2:10, 2:10].reshape(-1, 3).mean(0)
dist = np.sqrt(((rgb - key) ** 2).sum(-1))
alpha = np.clip((dist - 28.0) / 40.0, 0, 1)
# the outline's half-covered pixels keep a magenta tint whatever is done to them: the cover shrinks by a pixel
from PIL import ImageFilter
alpha = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)), dtype=np.float32) / 255
# pull the key's tint out of the half-covered edge pixels (toward the neighbouring opaque colour: a cheap despill)
spill = np.clip(1 - alpha, 0, 1)[..., None]
grey = rgb.mean(-1, keepdims=True)
rgb = rgb * (1 - spill * 0.6) + grey * spill * 0.6
# the top fades out over its last 12 %
fade = np.clip((np.arange(H) + 0.5) / (H * 0.12), 0, 1)[:, None]
alpha *= fade
im = Image.fromarray(np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8), "RGBA")
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
im.save(out, quality=86, method=6)
print(out, im.size, "opaque %.1f %%" % (100 * (alpha > 0.5).mean()), "key", key.round().tolist(), os.path.getsize(out) // 1024, "KB")
