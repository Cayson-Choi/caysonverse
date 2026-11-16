"""HB house 10 (난로 오두막) pieces: cast-iron wood stove on a brick hearth with a stovepipe to the ceiling, brick wall panel, chopping block with an axe,
log basket, coat hook board with jackets. No hunting decor, no brand marks."""
import math
import random

import kit_core as K
import kit_decor as DE
from kit_core import PAL

IRON = (0.12, 0.12, 0.13, 1)
BRICK = (0.72, 0.38, 0.28, 1)
MORTAR = (0.78, 0.74, 0.68, 1)


def brick_slab(F, x0, x1, z0, z1, y, rows_dir="x", course=0.065, length=0.215, seed=3):
    """a flat brick surface at height y: a mortar plane and each brick as its own quad (slightly raised) with colour variation; running bond"""
    rnd = random.Random(seed)
    K.gface(F, [(x0, z0, y), (x1, z0, y), (x1, z1, y), (x0, z1, y)], "H_stone", (1, 0, 0), 1.0, (0, 0, 1), tn=MORTAR)
    j = 0
    z = z0 + 0.006
    while z < z1 - 0.02:
        ze = min(z1 - 0.006, z + course - 0.008)
        x = x0 + 0.006 - (length / 2 if j % 2 else 0.0)
        while x < x1 - 0.02:
            xa, xb = max(x0 + 0.006, x), min(x1 - 0.006, x + length - 0.008)
            if xb - xa > 0.03:
                c = rnd.uniform(0.85, 1.12)
                K.gface(F, [(xa, z, y + 0.002), (xb, z, y + 0.002), (xb, ze, y + 0.002), (xa, ze, y + 0.002)], "H_brick", (1, 0, 0), 1.0, (0, 0, 1),
                        tn=(BRICK[0] * c, BRICK[1] * c, BRICK[2] * c, 1))
            x += length
        z += course
        j += 1


def brick_panel(F, w=1.8, h=1.9, seed=4):
    """firebrick wall behind the stove: running-bond bricks (each a quad on a mortar plane), a stone cap rail. Origin = the middle of the foot on the wall, +z = room."""
    rnd = random.Random(seed)
    hw = w / 2
    K.gface(F, [(-hw, 0.0, 0.0), (hw, 0.0, 0.0), (hw, 0.0, h), (-hw, 0.0, h)], "H_stone", (1, 0, 0), 1.0, (0, 1, 0), tn=MORTAR)
    y, j = 0.006, 0
    while y < h - 0.02:
        ye = min(h - 0.006, y + 0.065 - 0.008)
        x = -hw + 0.006 - (0.1075 if j % 2 else 0.0)
        while x < hw - 0.02:
            xa, xb = max(-hw + 0.006, x), min(hw - 0.006, x + 0.215 - 0.008)
            if xb - xa > 0.03:
                c = rnd.uniform(0.85, 1.12)
                K.gface(F, [(xa, 0.004, y), (xb, 0.004, y), (xb, 0.004, ye), (xa, 0.004, ye)], "H_brick", (1, 0, 0), 1.0, (0, 1, 0), tn=(BRICK[0] * c, BRICK[1] * c, BRICK[2] * c, 1))
            x += 0.215
        y += 0.065
        j += 1
    K.rbox(F, -hw - 0.02, hw + 0.02, 0.0, 0.07, h, h + 0.05, "H_stone", r=0.0, seg=1, tn=(0.62, 0.6, 0.57, 1))
    K.col(F, -hw, hw, 0.0, 0.08, h, name="brickwall")


def wood_stove2(F, h=3.7):
    """무쇠 장작 난로: a brick hearth (1.5 x 1.3, 8 cm), a cast-iron box on four short legs with a glass door (fire glow), a rim, a top plate with a kettle and a
    pot, an ash drawer, then a black stovepipe with a collar and a ceiling plate up to `h`. Origin = the middle of the hearth. Front = +z."""
    hw, hd = 0.3, 0.26
    # hearth
    K.rbox(F, -0.75, 0.75, -0.55, 0.75, 0.0, 0.08, "H_stone", r=0.0, seg=1, tn=(0.55, 0.52, 0.48, 1))
    brick_slab(F, -0.74, 0.74, -0.54, 0.74, 0.08)
    # stove body
    for (sx, sz) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        K.rbox(F, sx * (hw - 0.04) - 0.025, sx * (hw - 0.04) + 0.025, sz * (hd - 0.04) - 0.025, sz * (hd - 0.04) + 0.025, 0.08, 0.26, "H_rubber", r=0.0, seg=1, tn=IRON)
    K.rbox(F, -hw, hw, -hd, hd, 0.26, 0.9, "H_rubber", r=0.012, seg=1, tn=IRON)
    K.rbox(F, -hw - 0.025, hw + 0.025, -hd - 0.025, hd + 0.025, 0.9, 0.94, "H_rubber", r=0.01, seg=1, tn=(0.16, 0.16, 0.17, 1))          # top plate
    K.rbox(F, -hw - 0.02, hw + 0.02, -hd - 0.02, hd + 0.02, 0.25, 0.28, "H_rubber", r=0.006, seg=1, tn=(0.16, 0.16, 0.17, 1))          # base rim
    # door frame + glass with the fire
    K.rbox(F, -0.2, 0.2, hd, hd + 0.02, 0.4, 0.8, "H_rubber", r=0.006, seg=1, tn=(0.18, 0.18, 0.19, 1))
    K.rbox(F, -0.15, 0.15, hd + 0.02, hd + 0.024, 0.46, 0.74, "H_lamp", r=0.0, seg=1)
    K.rbox(F, 0.2, 0.235, hd + 0.01, hd + 0.05, 0.55, 0.65, "H_metal", r=0.004, seg=1, tn=(0.6, 0.6, 0.6, 1))
    K.rbox(F, -0.22, 0.22, hd, hd + 0.015, 0.28, 0.36, "H_rubber", r=0.0, seg=1, tn=(0.2, 0.2, 0.21, 1))                                  # ash drawer
    # kettle + pot on the top plate
    K.lathe(F, -0.12, 0.0, 0.94, [(0, 0), (0.09, 0.0), (0.1, 0.03), (0.085, 0.14), (0.05, 0.17), (0.0, 0.172)], "H_metal", 16, tn=(0.15, 0.15, 0.16, 1))
    K.tube(F, [(-0.03, 0.0, 0.99), (0.03, 0.0, 0.99), (0.08, 0.0, 1.04), (0.11, 0.0, 1.1)], 0.009, "H_metal", 6, tn=(0.15, 0.15, 0.16, 1))
    K.tube(F, [(-0.12, -0.08, 1.1), (-0.12, 0.0, 1.2), (-0.12, 0.08, 1.1)], 0.005, "H_metal", 4, tn=(0.15, 0.15, 0.16, 1), caps=False)
    K.lathe(F, 0.13, 0.05, 0.94, [(0, 0), (0.07, 0.0), (0.075, 0.12), (0.0, 0.12)], "H_metal", 14, tn=(0.55, 0.3, 0.2, 1))
    # pipe: collar, long pipe, a heat shield ring, a ceiling plate
    px, pz = 0.0, -0.06
    K.cyl(F, px, pz, 0.94, 1.0, 0.1, "H_rubber", segs=18, tn=IRON, cap=False)
    K.cyl(F, px, pz, 1.0, h, 0.075, "H_rubber", segs=16, tn=IRON, cap=False)
    for yy in (1.5, 2.3, 3.1):
        K.cyl(F, px, pz, yy, yy + 0.03, 0.085, "H_rubber", segs=16, tn=(0.18, 0.18, 0.19, 1), cap=False)
    K.cyl(F, px, pz, h - 0.1, h - 0.06, 0.15, "H_rubber", segs=18, tn=IRON, cap=False)
    K.light(F, "fire", 0.0, hd + 0.25, 0.55, 70.0, "#FF9A50")
    K.col(F, -0.75, 0.75, -0.55, 0.75, h, name="stove")


def chopping_block(F):
    """stump with an axe stuck in it, a few split logs and chips"""
    K.cyl(F, 0, 0, 0.0, 0.36, 0.2, "H_wood_oak", segs=12, tn=(0.75, 0.55, 0.4, 1), cap=True)
    K.disc(F, 0, 0, 0.361, 0.17, "H_wood_oak", 12, tn=(0.9, 0.72, 0.5, 1))
    K.tube(F, [(0.0, 0.0, 0.34), (0.0, 0.03, 0.56), (0.0, 0.05, 0.78)], 0.016, "H_wood_oak", 6, tn=(0.55, 0.38, 0.26, 1))
    K.rbox(F, -0.015, 0.015, 0.0, 0.12, 0.72, 0.8, "H_metal", r=0.0, seg=1, tn=(0.5, 0.52, 0.55, 1))
    K.col(F, -0.22, 0.22, -0.22, 0.22, 0.4, name="block")


def log_basket(F, r=0.28, h=0.42):
    """a woven basket full of split logs (end grain circles on top)"""
    rnd = random.Random(2)
    K.lathe(F, 0, 0, 0.0, [(r * 0.8, 0.0), (r, h * 0.5), (r * 1.05, h), (r * 1.0, h)], "H_rattan", 18, tn=(0.8, 0.62, 0.4, 1))
    for k in range(9):
        a = k * 2 * math.pi / 9 + 0.3
        rr = rnd.uniform(0.04, 0.05)
        c = (0.8 + 0.2 * rnd.random(), 0.6 + 0.1 * rnd.random(), 0.4, 1)
        px, pz = math.cos(a) * r * 0.45, math.sin(a) * r * 0.45
        K.tube(F, [(px, pz, h - 0.12), (px + rnd.uniform(-0.05, 0.05), pz, h + 0.12 + 0.1 * rnd.random())], rr, "H_wood_oak", 7, tn=c)
    K.col(F, -r, r, -r, r, h, name="basket")


def hook_board(F, w=1.0):
    """a plank with five iron hooks and three jackets (plain wool and canvas, flat cut-outs with a collar and sleeves) hanging on it, boots below"""
    K.rbox(F, -w / 2, w / 2, 0.0, 0.03, 0.0, 0.16, "H_wood_oak", r=0.0, seg=1, tn=(0.55, 0.38, 0.26, 1), skip=("-z",))
    for i in range(5):
        x = -w / 2 + 0.1 + i * (w - 0.2) / 4
        K.tube(F, [(x, 0.03, 0.08), (x, 0.09, 0.08), (x, 0.11, 0.12)], 0.006, "H_metal", 5, tn=IRON)
    cols = ((0.5, 0.2, 0.17, 1), (0.28, 0.36, 0.28, 1), (0.55, 0.5, 0.38, 1))
    for i, c in enumerate(cols):
        x = -w / 2 + 0.2 + i * 0.3
        K.rbox(F, x - 0.17, x + 0.17, 0.115, 0.15, -0.55, 0.12, "H_fabric", r=0.01, seg=1, tn=c, skip=("-z",))
        K.rbox(F, x - 0.21, x - 0.17, 0.115, 0.15, -0.5, 0.08, "H_fabric", r=0.0, seg=1, tn=tuple(v * 0.85 for v in c[:3]) + (1,), skip=("-z",))
        K.rbox(F, x + 0.17, x + 0.21, 0.115, 0.15, -0.5, 0.08, "H_fabric", r=0.0, seg=1, tn=tuple(v * 0.85 for v in c[:3]) + (1,), skip=("-z",))
