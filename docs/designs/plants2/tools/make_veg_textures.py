"""Runtime vegetation textures (2026-11-16, plants2): tree bark and bed soil for the client's veg3d.

  python -I docs/designs/plants2/tools/make_veg_textures.py <polyhaven dir> <out dir>

<polyhaven dir> holds the Poly Haven CC0 1k JPGs (diff + nor_gl) of sakura_bark, japanese_zelkova_bark, bark_willow,
japanese_hackberry_bark, bark_brown_02 and brown_mud (https://polyhaven.com, CC0 1.0). Writes to <out dir>
(client/public/models/village/veg):

  bark_<pattern>_c1024.jpg / _c512.jpg  bark colour, LINEAR values, each channel scaled to a mean of 0.5 (the vertex
                                        colour carries the bark's absolute colour: barkGeometry.BARK_STYLE / TEX_MEAN)
  bark_<pattern>_n512.jpg / _n256.jpg   its normal map (OpenGL convention, as Poly Haven's nor_gl)
  soil_c1024.jpg / soil_c512.jpg        bed soil with bark-chip mulch (sRGB), a 1 m tile: damp dark soil (brown_mud),
                                        shredded pine-bark chips 2-5 cm with shading and contact shadows, a few pebbles,
                                        fallen cherry petals and small dry leaves; tiles both ways
  soil_n512.jpg / soil_n256.jpg         its normal map (the mud's own normals + the chips' relief)
  means.json                            each bark photo's mean colour (sRGB hex) for BARK_STYLE.old
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)

BARK = {
    "cherry": "sakura_bark",
    "plates": "japanese_zelkova_bark",
    "willow": "bark_willow",
    "smooth": "japanese_hackberry_bark",
    "plum": "bark_brown_02",
}


def srgb_to_lin(a):
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(a):
    a = np.clip(a, 0, 1)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * a ** (1 / 2.4) - 0.055)


def load(name, kind):
    for d in (SRC, os.path.join(SRC, "..", "tex")):
        p = os.path.join(d, f"{name}_{kind}_1k.jpg")
        if os.path.exists(p):
            return Image.open(p).convert("RGB")
    raise FileNotFoundError(name + " " + kind)


def save(im, name, size):
    im.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name), quality=88, optimize=True)


CONTRAST = {"cherry": 1.9, "smooth": 1.3, "plates": 1.15}
means = {}
for pattern, ph in BARK.items():
    c = np.asarray(load(ph, "diff"), np.float32) / 255
    lin = srgb_to_lin(c)
    m = lin.reshape(-1, 3).mean(0)
    means[pattern] = "#%02X%02X%02X" % tuple(int(round(v * 255)) for v in lin_to_srgb(m))
    # the cherry's photo is soft: its lenticels and peeling bands brought out (a contrast curve round the mean)
    k = CONTRAST.get(pattern, 1.0)
    rel = (lin / m) ** k
    rel = rel / rel.reshape(-1, 3).mean(0)
    norm = np.clip(rel * 0.5, 0, 1)
    im = Image.fromarray((norm * 255 + 0.5).astype(np.uint8), "RGB")
    if pattern in ("cherry", "plates"):
        save(im, f"bark_{pattern}_c1024.jpg", 1024)
    save(im, f"bark_{pattern}_c512.jpg", 512)
    n = load(ph, "nor_gl")
    save(n, f"bark_{pattern}_n512.jpg", 512)
    save(n, f"bark_{pattern}_n256.jpg", 256)
    print(pattern, means[pattern])

# ------------------------------------------------------------------------------------------- the coping --
# the square planters' granite coping: the same Poly Haven rock as the village's own stone (T_stone), sharper (1k, 1.6 m)
st = load("rock_boulder_dry", "diff")
stc = np.asarray(st, np.float32) / 255
# as make_textures.py makes T_stone from it: brightness 1.10, saturation 0.55 (the planter block's own grey)
grey = stc.mean(-1, keepdims=True)
stc = np.clip((grey + (stc - grey) * 0.55) * 1.1, 0, 1)
save(Image.fromarray((stc * 255).astype(np.uint8), "RGB"), "stone_c1024.jpg", 1024)
save(Image.fromarray((stc * 255).astype(np.uint8), "RGB"), "stone_c512.jpg", 512)
save(load("rock_boulder_dry", "nor_gl"), "stone_n512.jpg", 512)
save(load("rock_boulder_dry", "nor_gl"), "stone_n256.jpg", 256)

# ------------------------------------------------------------------------------------------------- soil --
S = 1024
rng = np.random.default_rng(1116)
mud = load("brown_mud", "diff").resize((S, S), Image.LANCZOS)
mud_n = load("brown_mud", "nor_gl").resize((S, S), Image.LANCZOS)
# the mud darker and damper (a watered bed), a little warmer
base = np.asarray(mud, np.float32) / 255
base = base * np.array([0.62, 0.55, 0.5])
col = Image.fromarray((np.clip(base, 0, 1) * 255).astype(np.uint8), "RGB").convert("RGBA")
height = Image.new("L", (S, S), 0)
shadow = Image.new("L", (S, S), 0)
hd = ImageDraw.Draw(height)
sd = ImageDraw.Draw(shadow)
layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
cd = ImageDraw.Draw(layer)


def wrapped(draw_fn, x, y, reach):
    """Draw at (x, y) and at its wrapped copies near the edges (the tile repeats)."""
    for dx in (-S, 0, S):
        for dy in (-S, 0, S):
            if -reach < x + dx < S + reach and -reach < y + dy < S + reach:
                draw_fn(x + dx, y + dy)


BROWNS = [(118, 78, 48), (134, 92, 58), (100, 66, 42), (150, 108, 72), (86, 58, 38), (164, 122, 84), (122, 88, 62)]


def chip_poly(x, y, L, W, a):
    pts = []
    k = rng.uniform(0.15, 0.45)
    shape = [(-0.5, -0.3), (-0.2, -0.5), (0.35, -0.42), (0.5, -0.1 + k * 0.3), (0.42, 0.45), (-0.1, 0.5), (-0.48, 0.25)]
    ca, sa = math.cos(a), math.sin(a)
    for (u, v) in shape:
        u += rng.uniform(-0.06, 0.06)
        v += rng.uniform(-0.08, 0.08)
        pts.append((x + (u * L) * ca - (v * W) * sa, y + (u * L) * sa + (v * W) * ca))
    return pts


# chips in two layers (under ones darker), ~65 % cover; pixels: 1 px = 1 mm. Each chip is a piece of real bark
# (cut out of the bark photos: shredded pine bark is bark), so it has the bark's own grain and colour.
BARK_SRC = [np.asarray(load(n, "diff"), np.float32) for n in ("bark_brown_02", "bark_willow", "japanese_zelkova_bark", "sakura_bark")]
chips_rgb = np.zeros((S, S, 3), np.float32)
chips_a = np.zeros((S, S), np.float32)
# pine-bark mulch is red-brown: the grey bark photos warmed
WARM = np.array([1.22, 0.92, 0.7], np.float32)


def paste_chip(xx, yy, L, W, a, k, src, ox, oy, h):
    poly = chip_poly(xx, yy, L, W, a)
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    x0, x1 = int(max(0, min(xs))), int(min(S, max(xs) + 1))
    y0, y1 = int(max(0, min(ys))), int(min(S, max(ys) + 1))
    if x1 <= x0 or y1 <= y0:
        return
    m = Image.new("L", (x1 - x0, y1 - y0), 0)
    ImageDraw.Draw(m).polygon([(px - x0, py - y0) for px, py in poly], fill=255)
    m = np.asarray(m.filter(ImageFilter.GaussianBlur(0.6)), np.float32) / 255
    patch = src[oy:oy + (y1 - y0), ox:ox + (x1 - x0)]
    if patch.shape[0] != y1 - y0 or patch.shape[1] != x1 - x0:
        return
    # a shredded chip: its centre lit, its edges in shade
    chips_rgb[y0:y1, x0:x1] = chips_rgb[y0:y1, x0:x1] * (1 - m[..., None]) + patch * WARM * k * m[..., None]
    chips_a[y0:y1, x0:x1] = np.maximum(chips_a[y0:y1, x0:x1], m)
    sd.polygon([(px + 3, py + 4) for px, py in poly], fill=210)
    hd.polygon(poly, fill=h)


for layer_i, n in ((0, 1050), (1, 800)):
    for i in range(n):
        x, y = rng.uniform(0, S), rng.uniform(0, S)
        L = rng.uniform(18, 50)
        W = L * rng.uniform(0.3, 0.65)
        a = rng.uniform(0, math.pi)
        k = (0.5 if layer_i == 0 else 0.72) * rng.uniform(0.8, 1.15)
        h = int((90 if layer_i == 0 else 170) + rng.uniform(-25, 25))
        src = BARK_SRC[rng.integers(len(BARK_SRC))]
        ox, oy = int(rng.uniform(0, 1024 - 80)), int(rng.uniform(0, 1024 - 80))
        wrapped(lambda xx, yy: paste_chip(xx, yy, L, W, a, k, src, ox, oy, h), x, y, 60)
# pebbles
for i in range(40):
    x, y = rng.uniform(0, S), rng.uniform(0, S)
    r = rng.uniform(3, 8)
    g = int(rng.uniform(95, 140))

    def draw(xx, yy, r=r, g=g):
        sd.ellipse((xx - r + 3, yy - r * 0.8 + 4, xx + r + 3, yy + r * 0.8 + 4), fill=220)
        cd.ellipse((xx - r, yy - r * 0.8, xx + r, yy + r * 0.8), fill=(g, g - 6, g - 14, 255))
        cd.ellipse((xx - r * 0.5, yy - r * 0.6, xx + r * 0.1, yy - r * 0.1), fill=(min(255, g + 25), min(255, g + 22), min(255, g + 16), 255))
        hd.ellipse((xx - r, yy - r * 0.8, xx + r, yy + r * 0.8), fill=200)

    wrapped(draw, x, y, 20)
# fallen cherry petals and a few small dry leaves on top
PINK = [(226, 188, 198), (216, 172, 186), (232, 204, 212)]
for i in range(45):
    x, y = rng.uniform(0, S), rng.uniform(0, S)
    r = rng.uniform(6, 9)
    a = rng.uniform(0, math.pi)
    c = PINK[rng.integers(3)]

    def draw(xx, yy, r=r, a=a, c=c):
        ca, sa = math.cos(a), math.sin(a)
        pts = [(xx + ca * r * math.cos(t) * 1.0 - sa * r * 0.62 * math.sin(t), yy + sa * r * math.cos(t) + ca * r * 0.62 * math.sin(t)) for t in np.linspace(0, 2 * math.pi, 14)]
        cd.polygon(pts, fill=c + (255,))
        hd.polygon(pts, fill=210)

    wrapped(draw, x, y, 15)
for i in range(12):
    x, y = rng.uniform(0, S), rng.uniform(0, S)
    L = rng.uniform(30, 48)
    a = rng.uniform(0, 2 * math.pi)
    c = [(150, 112, 56), (128, 96, 50), (110, 120, 60)][rng.integers(3)]

    def draw(xx, yy, L=L, a=a, c=c):
        ca, sa = math.cos(a), math.sin(a)
        pts = []
        for t in np.linspace(0, 1, 9):
            w = L * 0.22 * math.sin(math.pi * t)
            pts.append((xx + ca * L * t - sa * w, yy + sa * L * t + ca * w))
        for t in np.linspace(1, 0, 9):
            w = -L * 0.22 * math.sin(math.pi * t)
            pts.append((xx + ca * L * t - sa * w, yy + sa * L * t + ca * w))
        sd.polygon([(px + 3, py + 4) for px, py in pts], fill=170)
        cd.polygon(pts, fill=c + (255,))
        cd.line([(xx, yy), (xx + ca * L, yy + sa * L)], fill=(int(c[0] * 0.7), int(c[1] * 0.7), int(c[2] * 0.7), 255), width=1)
        hd.polygon(pts, fill=230)

    wrapped(draw, x, y, 60)
# compose: soil, the soft contact shadows of everything on it, then the chips etc.
sh = np.asarray(shadow.filter(ImageFilter.GaussianBlur(3)), np.float32) / 255
soil = np.asarray(col, np.float32)[..., :3] * (1 - 0.55 * sh[..., None])
lay = np.asarray(layer, np.float32)
al = lay[..., 3:4] / 255
ca = chips_a[..., None]
out = soil * (1 - ca) + chips_rgb * ca
out = out * (1 - al) + lay[..., :3] * al
# ambient occlusion from the relief: low places (soil between chips) darker
hgt = np.asarray(height.filter(ImageFilter.GaussianBlur(1.2)), np.float32) / 255
blur = np.asarray(height.filter(ImageFilter.GaussianBlur(9)), np.float32) / 255
ao = np.clip(1 - 0.9 * np.maximum(0, blur - hgt), 0.45, 1)
out = out * ao[..., None]
soil_img = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")
save(soil_img, "soil_c1024.jpg", 1024)
save(soil_img, "soil_c512.jpg", 512)
# normals: the chips' relief (height 1 px = ~1 mm; chips ~4 mm thick) over the mud's normals
gy, gx = np.gradient(hgt * 6.0)
mn = np.asarray(mud_n, np.float32) / 255 * 2 - 1
nx = -gx + mn[..., 0] * 0.6
ny = gy + mn[..., 1] * 0.6  # OpenGL: +y is up the image
nz = np.ones_like(nx)
l = np.sqrt(nx * nx + ny * ny + nz * nz)
nmap = np.stack([nx / l, ny / l, nz / l], -1) * 0.5 + 0.5
nimg = Image.fromarray((nmap * 255).astype(np.uint8), "RGB")
save(nimg, "soil_n512.jpg", 512)
save(nimg, "soil_n256.jpg", 256)
json.dump(means, open(os.path.join(OUT, "means.json"), "w"), indent=1)
print("soil done", means)
