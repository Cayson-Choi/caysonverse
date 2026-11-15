"""B1 waterfall, W1 (rock side): the 1024 textures of the site's stone and ground, from the CC0 sets in downloads/tex.

  python make_falls_textures.py            (system python with PIL + numpy; no Blender)

Writes art/village/work/tex/falls/:
  T_falls_rock.png    cliff colour: rock_face, desaturated to a cool granite grey (design 5.1: saturation 0.18)
  T_falls_rock_n.png  cliff normal (GL)
  T_falls_slab.png    slabs, seats, boulders: dry_riverbed_rock, desaturated, lighter (sun-bleached river granite)
  T_falls_slab_n.png
  T_falls_gravel.png  banks and the rest-area path: river_small_rocks
  T_falls_gravel_n.png
  T_falls_turf.png    flank and plateau ground: leafy_grass, darkened and cooled (forest floor)
  T_falls_turf_n.png
(W3 converts these to WebP and picks the sizes per quality tier; the water textures belong to W2.)
"""
import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "downloads", "tex")
OUT = os.path.join(ROOT, "work", "tex", "falls")
os.makedirs(OUT, exist_ok=True)


def load(name):
    return np.asarray(Image.open(os.path.join(SRC, name)).convert("RGB"), dtype=np.float32) / 255.0


def save(arr, name, size=1024):
    im = Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8))
    if im.size != (size, size):
        im = im.resize((size, size), Image.LANCZOS)
    im.save(os.path.join(OUT, name))
    print("wrote", name, im.size)


def desat(a, s, gain=1.0, tint=(1, 1, 1), gamma=1.0):
    lum = (a * np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)).sum(axis=2, keepdims=True)
    out = lum + (a - lum) * s
    out = np.power(np.clip(out, 0, 1), gamma) * gain
    return out * np.array(tint, dtype=np.float32)


def local_contrast(a, k=0.35):
    """Pull the large-scale brightness toward its mean so the tile does not show a pattern at 4 m."""
    from PIL import ImageFilter
    im = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(48))
    low = np.asarray(im, dtype=np.float32) / 255.0
    return np.clip(a - low * k + low.mean() * k, 0, 1)


# cliff granite: cool grey, a little lighter than the source (real wet-dry granite in photos 01/05/12 is mid grey)
r = load("rock_face_diff_1k.jpg")
r = local_contrast(desat(r, 0.18, gain=0.92, tint=(0.97, 0.98, 1.0), gamma=1.12), 0.55)
save(r, "T_falls_rock.png")
save(load("rock_face_nor_gl_1k.jpg"), "T_falls_rock_n.png")

s = load("dry_riverbed_rock_diff_1k.jpg")
save(local_contrast(desat(s, 0.22, gain=1.12, tint=(1.0, 0.99, 0.96)), 0.5), "T_falls_slab.png")
save(load("dry_riverbed_rock_nor_gl_1k.jpg"), "T_falls_slab_n.png")

g = load("river_small_rocks_diff_1k.jpg")
save(desat(g, 0.55, gain=1.0, tint=(0.95, 0.97, 0.95)), "T_falls_gravel.png")
save(load("river_small_rocks_nor_gl_1k.jpg"), "T_falls_gravel_n.png")

t = load("leafy_grass_diff_1k.jpg")
save(desat(t, 0.85, gain=0.55, tint=(0.86, 1.0, 0.8)), "T_falls_turf.png")
save(load("leafy_grass_nor_gl_1k.jpg"), "T_falls_turf_n.png")
