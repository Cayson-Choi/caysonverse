"""Houses-real pass 2 textures (owner 2026-11-22: flat card leaves, books like coloured boxes, a plain hearth) — system Python: numpy + PIL.

  python art/village/tools/houses/make_house_textures_real2.py [--client]

Writes art/village/work/tex_h/ (1024 + small/ 128 px); --client also client/public/textures/houses/{hi 1024, lo 512} WebP.
 - T_h_leaf (replaces the flat green with ruled lines): a real leaf blade — a pale raised midrib, fine alternate side veins that curve
   to the margin and fade, a darker margin, soft glossy mottling and cell grain; u = across the blade (0 / 1 the margins, 0.5 the
   midrib), v = base -> tip (the kit's leaf() mapping). Mean colour kept near the old one so the kit's leaf tints still read.
 - T_h_books: 16 cloth / paper spines side by side in the left 7/8 (each 1/16 of 0.875 wide: a colour, a darker head and tail band,
   gold or cream title bands and a small author block, cloth weave), the right 1/8 a page block (cream, fine page lines, a slight
   shade toward the edges) for the books' tops and fore-edges.
 - T_h_hearth: the CC0 Poly Haven granite_tile albedo (slate-grey honed tiles, already in the art downloads) for the hearth slab.
"""
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
REPO = os.path.dirname(os.path.dirname(ROOT))
OUT = os.path.join(ROOT, "work", "tex_h")
SRC = os.environ.get("CV_ART_DL") or os.path.join(ROOT, "downloads", "tex")
CLIENT = os.path.join(REPO, "client", "public", "textures", "houses")
N = 1024
rng = np.random.default_rng(20261122)


def smooth_noise(n, cells, seed, w=None):
    r = np.random.default_rng(seed)
    g = r.random((cells + 1, (w or cells) + 1))
    im = Image.fromarray((g * 255).astype(np.uint8)).resize((n, n), Image.BICUBIC)
    return np.asarray(im, np.float32) / 255.0


def leaf():
    y, x = np.mgrid[0:N, 0:N] / N           # x across (0..1), y base -> tip (image rows: v = 1 - row; symmetric enough)
    v = 1 - y
    u = x - 0.5
    base = np.array([0.20, 0.42, 0.16])
    tipc = np.array([0.30, 0.55, 0.22])
    col = base[None, None] * (1 - v[..., None]) + tipc[None, None] * v[..., None]
    mott = (smooth_noise(N, 10, 1) - 0.5) * 0.16 + (smooth_noise(N, 40, 2) - 0.5) * 0.06
    col = col * (1 + mott[..., None])
    # margin darker, a glossy sheen band beside the midrib
    edge = np.clip(1 - np.abs(u) * 2, 0, 1)
    col = col * (0.78 + 0.22 * edge[..., None] ** 0.5)
    sheen = np.exp(-((np.abs(u) - 0.17) / 0.07) ** 2) * 0.12
    col = col + sheen[..., None] * np.array([0.6, 0.75, 0.5])
    # midrib
    rib = np.exp(-(u / 0.008) ** 2)
    col = col * (1 - rib[..., None] * 0.15) + rib[..., None] * np.array([0.55, 0.72, 0.38]) * 0.6
    # side veins: alternate, leaving the midrib at ~40 deg and curving toward the tip as they fade near the margin
    vein = np.zeros_like(u)
    for k in range(13):
        v0 = 0.05 + k * 0.072
        for s in (-1, 1):
            off = 0.018 * (1 if s > 0 else 0)
            au = np.abs(u)
            vv = v0 + off + au * 0.95 + au ** 2 * 0.6        # the vein's v at this |u|
            d = np.abs(v - vv)   # veins leave the midrib toward the tip (V when the tip is up)
            side = (np.sign(u) == s)
            vein = np.maximum(vein, side * np.exp(-(d / 0.0035) ** 2) * np.clip(1 - au / 0.47, 0, 1) ** 0.7)
    col = col * (1 - vein[..., None] * 0.05) + vein[..., None] * np.array([0.42, 0.6, 0.3]) * 0.35
    grain = (rng.random((N, N)) - 0.5) * 0.035
    col = col * (1 + grain[..., None])
    return np.clip(col, 0, 1)


SPINES = [  # cloth / paper colours of a lived-in shelf
    (0.55, 0.12, 0.10), (0.12, 0.22, 0.38), (0.15, 0.32, 0.22), (0.78, 0.68, 0.48), (0.30, 0.20, 0.14), (0.85, 0.82, 0.74),
    (0.62, 0.36, 0.14), (0.20, 0.20, 0.22), (0.45, 0.50, 0.58), (0.70, 0.22, 0.25), (0.88, 0.72, 0.30), (0.34, 0.42, 0.30),
    (0.92, 0.90, 0.86), (0.42, 0.18, 0.30), (0.18, 0.40, 0.48), (0.60, 0.52, 0.40)]


def books():
    img = np.zeros((N, N, 3))
    W = 0.875 / 16
    y, x = np.mgrid[0:N, 0:N] / N
    v = 1 - y
    r = np.random.default_rng(5)
    weave = ((np.sin(x * N * 1.3) * np.sin(y * N * 1.1)) * 0.03)
    for k, c in enumerate(SPINES):
        m = (x >= k * W) & (x < (k + 1) * W)
        c = np.array(c)
        col = np.broadcast_to(c, img.shape).copy()
        gold = np.array([0.80, 0.64, 0.32]) if k % 3 != 2 else np.array([0.92, 0.90, 0.84])
        dark = c * 0.6
        # head / tail bands, title band(s), author block
        bands = [(0.03, 0.06, dark), (0.94, 0.97, dark)]
        t0 = r.uniform(0.62, 0.74)
        bands += [(t0, t0 + r.uniform(0.08, 0.14), gold if k % 2 else dark * 0.8)]
        bands += [(t0 + 0.02, t0 + 0.024, gold), (t0 - 0.02, t0 - 0.016, gold)] if k % 4 == 0 else []
        bands += [(0.14, 0.18, gold)] if k % 2 == 0 else [(0.12, 0.15, np.array([0.95, 0.93, 0.88]))]
        for (a, b, bc) in bands:
            sel = m & (v >= a) & (v < b)
            col[sel] = bc
        # fine "letters" inside the title band: tiny ticks (reads as type at game distance)
        tick = (np.sin((v - t0) * N * 0.9) > 0.6) & (np.abs(((x - k * W) / W) - 0.5) < 0.22)
        sel = m & (v >= t0 + 0.015) & (v < t0 + 0.06) & tick
        col[sel] = col[sel] * 0.55 + (gold if k % 2 == 0 else np.array([0.95, 0.93, 0.88])) * 0.45
        # rounded spine shading across the width
        sx = (x - k * W) / W
        shade = 0.82 + 0.18 * np.sin(np.clip(sx, 0, 1) * np.pi)
        col = col * shade[..., None] * (1 + weave[..., None])
        img[m] = col[m]
    # page block
    m = x >= 0.875
    pages = np.array([0.90, 0.87, 0.78]) * (1 + 0.05 * np.sin(y * N * 2.7)[..., None]) * (0.92 + 0.08 * np.sin((x - 0.875) / 0.125 * np.pi))[..., None]
    img[m] = pages[m]
    return np.clip(img, 0, 1)


def hearth():
    p = os.path.join(SRC, "granite_tile_diff_1k.jpg")
    a = np.asarray(Image.open(p).convert("RGB").resize((N, N), Image.LANCZOS), np.float32) / 255.0
    return np.clip(a * 1.08, 0, 1)


def save(name, a, smooth=False):
    os.makedirs(os.path.join(OUT, "small"), exist_ok=True)
    im = Image.fromarray((a * 255 + 0.5).astype(np.uint8))
    if smooth:
        im = im.filter(ImageFilter.SMOOTH)
    im.save(os.path.join(OUT, name + ".png"))
    im.resize((128, 128), Image.LANCZOS).save(os.path.join(OUT, "small", name + ".png"))
    if "--client" in sys.argv:
        for tier, size in (("hi", 1024), ("lo", 512)):
            d = os.path.join(CLIENT, tier)
            os.makedirs(d, exist_ok=True)
            im.resize((size, size), Image.LANCZOS).save(os.path.join(d, name + ".webp"), "WEBP", quality=84, method=6)
    print(name, "ok")


if __name__ == "__main__":
    save("T_h_leaf", leaf(), smooth=True)
    save("T_h_books", books())
    save("T_h_hearth", hearth())
