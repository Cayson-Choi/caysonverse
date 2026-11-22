"""Fireplace textures for the houses-real pass (owner 2026-11-21: "is this supposed to be realistic?") — system Python: numpy + PIL.

  python art/village/tools/houses/make_house_textures_fire.py [--client]

Writes art/village/work/tex_h/T_h_firebrick.png / T_h_bark.png / T_h_endgrain.png (1024) + small/ (128 px, embedded in the GLB);
--client also writes client/public/textures/houses/hi (1024 WebP) and lo (512 WebP).
 - T_h_firebrick: new buff firebricks in running bond, 4 bricks x 11 courses per 0.96 m tile, thin light mortar, per-brick shade
   and fine speckle; clean (no soot) — brand-new house. Tinted by the vertex colour (warm red for the facing slips).
 - T_h_bark: the CC0 Poly Haven japanese_zelkova_bark albedo (downloads/tex, already in the art set), levelled to a mid oak bark.
 - T_h_endgrain: a sawn log end: pale sapwood, growth rings round a slightly off-centre pith, two radial checks, a bark ring at the
   rim (the disc fills the square: u, v = 0.5 + 0.5 cos/sin on the log caps).
"""
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))                 # art/village
REPO = os.path.dirname(os.path.dirname(ROOT))
OUT = os.path.join(ROOT, "work", "tex_h")
SRC = os.environ.get("CV_ART_DL") or os.path.join(ROOT, "downloads", "tex")
CLIENT = os.path.join(REPO, "client", "public", "textures", "houses")
rng = np.random.default_rng(20261121)
N = 1024


def smooth_noise(n, cells, seed):
    r = np.random.default_rng(seed)
    g = r.random((cells + 1, cells + 1))
    g[-1, :] = g[0, :]
    g[:, -1] = g[:, 0]
    im = Image.fromarray((g * 255).astype(np.uint8)).resize((n, n), Image.BICUBIC)
    return np.asarray(im, np.float32) / 255.0


def firebrick():
    tile = 0.96
    px = N / tile
    bw, ch, joint = tile / 4, tile / 11, 0.009
    y, x = np.mgrid[0:N, 0:N] / px
    course = np.floor(y / ch).astype(int)
    xo = x + (course % 2) * bw / 2
    col = np.floor(xo / bw).astype(int) % 4
    fx = xo - np.floor(xo / bw) * bw
    fy = y - course * ch
    mortar = (fx < joint) | (fy < joint)
    # per-brick colour: buff to pale salmon, a few slightly darker, all clean
    r = np.random.default_rng(7)
    shade = r.uniform(0.9, 1.06, (11, 4))
    warm = r.uniform(-0.05, 0.06, (11, 4))
    s = shade[course % 11, col]
    w = warm[course % 11, col]
    base = np.stack([0.86 + w, 0.70 + w * 0.6, 0.55 - w * 0.3], -1) * s[..., None]
    # surface: fine sand speckle and a soft mottling inside each brick, a slight darkening at the arrises
    speck = rng.random((N, N)) * 0.08 - 0.04
    mott = (smooth_noise(N, 24, 3) - 0.5) * 0.12
    edge = np.clip(np.minimum(np.minimum(fx - joint, bw - fx), np.minimum(fy - joint, ch - fy)) / 0.006, 0, 1)
    k = (1 + speck + mott) * (0.9 + 0.1 * edge)
    img = base * k[..., None]
    mort = np.array([0.80, 0.78, 0.74]) * (1 + speck[..., None] * 0.6)
    img = np.where(mortar[..., None], mort, img)
    return np.clip(img, 0, 1)


def bark():
    p = os.path.join(SRC, "japanese_zelkova_bark_diff_1k.jpg")
    im = Image.open(p).convert("RGB").resize((N, N), Image.LANCZOS)
    a = np.asarray(im, np.float32) / 255.0
    lum = a.mean()
    a = a * (0.42 / max(lum, 1e-3))                        # a mid oak-bark level (tinted per log by the vertex colour)
    a = a * np.array([1.08, 0.98, 0.86])
    return np.clip(a, 0, 1)


def endgrain():
    y, x = (np.mgrid[0:N, 0:N] + 0.5) / N * 2 - 1
    cx, cy = 0.08, -0.05
    ang = np.arctan2(y - cy, x - cx)
    rr = np.hypot(x - cx, y - cy)
    wob = (smooth_noise(N, 8, 11) - 0.5) * 0.06
    rings = 0.5 + 0.5 * np.sin((rr + wob) * 2 * np.pi * 13)
    rings = rings ** 3
    pale = np.array([0.93, 0.80, 0.62])
    late = np.array([0.80, 0.62, 0.44])
    img = pale * (1 - rings[..., None] * 0.35) + late * rings[..., None] * 0.35
    heart = np.clip(1 - rr / 0.55, 0, 1) ** 1.5
    img = img * (1 - heart[..., None] * np.array([0.1, 0.16, 0.22]))
    # two radial drying checks from the pith
    for a0, ln in ((0.7, 0.62), (2.9, 0.45)):
        d = np.abs(np.angle(np.exp(1j * (ang - a0))))
        crack = (d < 0.012 / np.maximum(rr, 0.05)) & (rr < ln) & (rr > 0.04)
        img = np.where(crack[..., None], img * 0.45, img)
    saw = (smooth_noise(N, 64, 5) - 0.5) * 0.08          # saw-cut fuzz
    img = img * (1 + saw[..., None])
    r0 = np.hypot(x, y)
    barkr = (r0 > 0.9)
    cam = (r0 > 0.86) & ~barkr
    img = np.where(cam[..., None], img * np.array([0.82, 0.74, 0.62]), img)
    img = np.where(barkr[..., None], np.array([0.30, 0.22, 0.16]) * (1 + saw[..., None] * 2), img)
    return np.clip(img, 0, 1)


def save(name, a):
    os.makedirs(os.path.join(OUT, "small"), exist_ok=True)
    im = Image.fromarray((a * 255 + 0.5).astype(np.uint8)).filter(ImageFilter.SMOOTH_MORE if name == "T_h_firebrick" else ImageFilter.SMOOTH)
    im.save(os.path.join(OUT, name + ".png"))
    im.resize((128, 128), Image.LANCZOS).save(os.path.join(OUT, "small", name + ".png"))
    if "--client" in sys.argv:
        for tier, size in (("hi", 1024), ("lo", 512)):
            d = os.path.join(CLIENT, tier)
            os.makedirs(d, exist_ok=True)
            im.resize((size, size), Image.LANCZOS).save(os.path.join(d, name + ".webp"), "WEBP", quality=84, method=6)
    print(name, "ok")


if __name__ == "__main__":
    save("T_h_firebrick", firebrick())
    save("T_h_bark", bark())
    save("T_h_endgrain", endgrain())
