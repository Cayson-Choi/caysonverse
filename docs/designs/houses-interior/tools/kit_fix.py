"""HA additions / fixes on top of the K kit (do not edit the kit_* files; HB has its own copy of the kit):
  - H_leather: the speckled texture is replaced by a plain tinted, glossy leather (the speckles read as dirt)
  - fuller plants (the kit's leaves were sparse): plant_monstera_full, plant_olive_full, plant_rubber_full, plant_fern, plant_palm
  - genkwan: entrance tile + 귀틀 + a fixed glass screen (the 현관 of every house)
  - misc small pieces used by several houses: wall_hooks, umbrella_stand, hanging_lamp_shade is in the kit.
"""
import math
import random

from kit_core import *   # noqa: F401,F403
from kit_core import S
import kit_core as K
import kit_decor as DE
import kit_shell as SH
from kit_seating import sqleg

# ---- materials ---------------------------------------------------------------------------------------------------
K.MATS["H_leather"] = dict(color="#FFFFFF", rough=0.42, coat=0.18, tint=True)
K._M.pop("H_leather", None)
K.MATS["H_floor_oak"] = dict(tex="T_h_floor_oakL.png", rough=0.42, coat=0.12, tint=True)    # lighter, less orange oak (HA houses)
K._M.pop("H_floor_oak", None)


# ---- plants ------------------------------------------------------------------------------------------------------
def _stem(F, pts, r, tn=(0.55, 0.7, 0.4, 1)):
    tube(F, pts, r, "H_leaf", 5, tn=tn, caps=False)


def plant_monstera_full(F, h=1.15, seed=4, leaves=26, pot_r=0.21):
    """monstera: many long stems each ending in a big heart-shaped leaf, leaves facing outward / up (reads as a full plant)"""
    rnd = random.Random(seed)
    DE.pot(F, pot_r, 0.34)
    for i in range(leaves):
        a = i * 2.39996 + rnd.uniform(-0.3, 0.3)
        up = 0.18 + 0.82 * (i / leaves) ** 0.7
        reach = (0.12 + 0.30 * (1 - up) + rnd.uniform(0.0, 0.1))
        top = (math.cos(a) * reach, math.sin(a) * reach, 0.34 + (h - 0.34) * up)
        mid = (top[0] * 0.35, top[1] * 0.35, (0.34 + top[2]) / 2 + 0.05)
        _stem(F, [(0.0, 0.0, 0.33), mid, top], 0.008)
        L = rnd.uniform(0.30, 0.46) * (1.1 - 0.35 * up)
        d = (math.cos(a), math.sin(a), 0.1 - 0.3 * up)
        DE.leaf(F, top, d, L, L * 0.95, droop=0.18, tn=(0.55 + 0.25 * rnd.random(), 0.95, 0.5 + 0.2 * rnd.random(), 1), segs=4, curl=0.1)
    col(F, -0.3, 0.3, -0.3, 0.3, h, name="plant")


def plant_olive_full(F, h=1.7, seed=6, pot_r=0.22):
    """olive tree: forked trunk, 9 branches, ~160 small silver-green leaves in clusters"""
    rnd = random.Random(seed)
    DE.pot(F, pot_r, 0.4, tn=(0.82, 0.78, 0.7, 1), m="H_terracotta")
    wood = (0.5, 0.42, 0.36, 1)
    tube(F, [(0, 0, 0.4), (0.02, 0.01, h * 0.42), (0.0, -0.02, h * 0.6)], [0.03, 0.022, 0.014], "H_wood_oak", 8, tn=wood)
    for b in range(9):
        a = b * 2.4 + rnd.random() * 0.4
        r1 = 0.16 + 0.1 * rnd.random()
        tipz = h * (0.72 + 0.1 * (b % 3) / 2)
        pts = [(0, 0, h * 0.52), (math.cos(a) * r1 * 0.6, math.sin(a) * r1 * 0.6, h * 0.62), (math.cos(a) * r1 * 1.2, math.sin(a) * r1 * 1.2, tipz)]
        tube(F, pts, [0.011, 0.008, 0.005], "H_wood_oak", 5, tn=wood, caps=False)
        for k in range(12):
            t = 0.25 + 0.75 * k / 12
            px = pts[0][0] + (pts[2][0] - pts[0][0]) * t
            py = pts[0][1] + (pts[2][1] - pts[0][1]) * t
            pz = pts[0][2] + (pts[2][2] - pts[0][2]) * t
            aa = a + rnd.uniform(-1.6, 1.6)
            DE.leaf(F, (px, py, pz), (math.cos(aa), math.sin(aa), rnd.uniform(0.1, 0.7)), 0.13, 0.034, droop=0.15,
                    tn=(0.62 + 0.15 * rnd.random(), 0.78, 0.62, 1), segs=2)
    col(F, -0.3, 0.3, -0.3, 0.3, h, name="plant")


def plant_rubber_full(F, h=1.5, seed=8, pot_r=0.23):
    """rubber plant: thick trunk with big glossy oval leaves all the way up (dense)"""
    rnd = random.Random(seed)
    DE.pot(F, pot_r, 0.4, tn=(0.9, 0.88, 0.84, 1), m="H_ceramic")
    tube(F, [(0, 0, 0.38), (0.01, 0, h * 0.6), (0.0, 0.01, h - 0.08)], [0.026, 0.02, 0.012], "H_leaf", 8, tn=(0.35, 0.42, 0.3, 1))
    for k in range(52):
        t = 0.12 + 0.88 * k / 52
        a = k * 2.4 + rnd.random() * 0.5
        DE.leaf(F, (0.0, 0.0, 0.38 + (h - 0.42) * t), (math.cos(a), math.sin(a), 0.28 + 0.2 * rnd.random()), 0.30 * (1.05 - 0.4 * t), 0.17,
                droop=0.22, tn=(0.35 + 0.2 * rnd.random(), 0.65, 0.4, 1), segs=3)
    col(F, -0.32, 0.32, -0.32, 0.32, h, name="plant")


def plant_fern(F, h=0.8, seed=3, pot_r=0.2, n=22):
    """boston fern: a fountain of long arching fronds with small leaflets"""
    rnd = random.Random(seed)
    DE.pot(F, pot_r, 0.28, tn=(0.8, 0.7, 0.6, 1))
    for i in range(n):
        a = i * 2.4 + rnd.random() * 0.3
        L = rnd.uniform(0.35, 0.6) * h / 0.8
        for j in range(4):
            DE.leaf(F, (0.0, 0.0, 0.27), (math.cos(a), math.sin(a), 1.1 - 0.15 * j), L * (1 - 0.1 * j), 0.1, droop=0.9, tn=(0.3 + 0.2 * rnd.random(), 0.62, 0.35, 1), segs=3,
                    twist=0.0) if j == 0 else None
    col(F, -0.35, 0.35, -0.35, 0.35, h, name="plant")


def plant_palm(F, h=1.7, seed=5, pot_r=0.24):
    """areca-style palm: 9 arching fronds on thin stalks"""
    rnd = random.Random(seed)
    DE.pot(F, pot_r, 0.4, tn=(0.75, 0.68, 0.6, 1))
    for i in range(10):
        a = i * 2.4
        top = (math.cos(a) * 0.16, math.sin(a) * 0.16, h * (0.62 + 0.3 * rnd.random()))
        _stem(F, [(0, 0, 0.38), (top[0] * 0.5, top[1] * 0.5, (0.38 + top[2]) / 2), top], 0.007)
        for s in (-1, 1):
            for k in range(7):
                t = k / 7
                pp = (top[0] + math.cos(a) * 0.05 * k, top[1] + math.sin(a) * 0.05 * k, top[2] - 0.012 * k * k * 0.5)
                aa = a + s * 1.2
                DE.leaf(F, pp, (math.cos(aa), math.sin(aa), -0.25), 0.34 * (1 - 0.5 * t), 0.045, droop=0.3, tn=(0.35 + 0.2 * rnd.random(), 0.7, 0.35, 1), segs=2)
    col(F, -0.32, 0.32, -0.32, 0.32, h, name="plant")


# ---- 현관 --------------------------------------------------------------------------------------------------------
def genkwan(F, x0=3.6, x1=7.0, depth=1.5, screen_x=None, screen_len=None, screen=True, tile="tile_grey"):
    """entrance: grey tile slab (y 0.004: the walking plane stays at 0), 귀틀 along the inner edge and a fixed glass screen
    (3-pane 중문, drawn closed-up at one side so the middle stays open). Local frame = room-local origin."""
    SH.floor(F.sub(0, 0, 0.004), x0, x1, 0.0, depth, tile, tn=(0.9, 0.9, 0.9, 1))
    # tile joints (real grooves read as thin dark strips)
    for xx in (x0 + (x1 - x0) / 3, x0 + 2 * (x1 - x0) / 3):
        rbox(F, xx - 0.004, xx + 0.004, 0.0, depth, 0.0, 0.0065, "H_tile_grey", r=0.0, seg=1, tn=(0.55, 0.55, 0.55, 1))
    SH.threshold(F, x0, x1, depth)
    if not screen:
        return
    sx = (x1 - 0.1) if screen_x is None else screen_x
    ln = depth if screen_len is None else screen_len
    # screen along z at x = sx, glass facing the passage (-x)
    W = F.sub(sx, 0.0, 0, -math.pi / 2)
    SH.jungmun(W, 0.0, ln, 2.35)
    col(F, sx - 0.02, sx + 0.22, 0.0, ln, 2.4, name="screen", camera=True)


# ---- small things --------------------------------------------------------------------------------------------------
def wall_hooks(F, n=4, spacing=0.2, tn=None):
    """a row of wall hooks on a wood rail (coats), F at the wall face"""
    rbox(F, -n * spacing / 2 - 0.05, n * spacing / 2 + 0.05, 0.0, 0.025, 0.0, 0.09, "H_wood_oak", r=0.006, seg=2, tn=tn or WOODTN)
    for i in range(n):
        x = (i - (n - 1) / 2) * spacing
        tube(F, [(x, 0.02, 0.045), (x, 0.09, 0.05), (x, 0.11, 0.09)], 0.008, "H_metal", 6, tn=(0.25, 0.25, 0.26, 1))


WOODTN = (0.78, 0.6, 0.42, 1)


# ---- stairwell shaft + props --------------------------------------------------------------------------------------
def stair_shaft(F, hole, y0=FLOOR_HEIGHT, y1=FLOOR_HEIGHT + CEILING_HEIGHT, tn=None):
    """the hole of the 1F ceiling continues up to the 2F ceiling (closed with a cap), so looking up from the stair never shows the sky.
    hole = (x0, x1, z0, z1) room-local."""
    import kit_core as KC
    hx0, hx1, hz0, hz1 = hole
    tn = tn or PAL["white"]
    for (a, b, c, d, hint) in ((hx0, hz0, hx0, hz1, (1, 0, 0)), (hx1, hz0, hx1, hz1, (-1, 0, 0)), (hx0, hz0, hx1, hz0, (0, 1, 0)),
                               (hx0, hz1, hx1, hz1, (0, -1, 0))):
        gface(F, [(a, b, y0), (c, d, y0), (c, d, y1), (a, b, y1)], "H_plaster", (1, 0, 0), 2.5, hint, tn=tn)
    gface(F, [(hx0, hz0, y1), (hx1, hz0, y1), (hx1, hz1, y1), (hx0, hz1, y1)], "H_plaster", (1, 0, 0), 2.5, (0, 0, -1), tn=tn)


def prop(F, which="mug_p", **kw):
    """one of the kit's small props (kit_props) drawn into the house mesh (atlas colours, baked with the rest)"""
    import kit_props as KP
    getattr(KP, which)(F, **kw)
    S.fuv = None


def high_chair(F, tn=None):
    """아기 의자 (decor only, no seat marker: too small for the avatar): wooden high chair with a tray and a back rail"""
    tn = tn or (0.85, 0.65, 0.45, 1)
    for (sx, sz) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        sqleg(F, sx * 0.16, sz * 0.15, 0.0, 0.52, 0.04, 0.03, "H_wood_oak", tn, splay=(sx * 0.05, sz * 0.05))
    rbox(F, -0.19, 0.19, -0.18, 0.18, 0.5, 0.54, "H_wood_oak", r=0.012, seg=2, tn=tn)
    rbox(F, -0.17, 0.17, -0.16, 0.16, 0.54, 0.575, "H_fabric", r=0.012, seg=2, tn=(0.55, 0.75, 0.85, 1))
    for sx in (-1, 1):
        rbox(F, sx * 0.19 - 0.012, sx * 0.19 + 0.012, -0.18, 0.12, 0.54, 0.86, "H_wood_oak", r=0.006, seg=1, tn=tn, grain=(0, 0, 1))
        rbox(F, sx * 0.19 - 0.012, sx * 0.19 + 0.012, -0.18, -0.15, 0.86, 1.0, "H_wood_oak", r=0.006, seg=1, tn=tn, grain=(0, 0, 1))
    rbox(F, -0.2, 0.2, -0.19, -0.16, 0.8, 0.98, "H_wood_oak", r=0.006, seg=1, tn=tn)
    rbox(F, -0.23, 0.23, 0.0, 0.3, 0.66, 0.69, "H_plastic", r=0.015, seg=2, tn=(0.95, 0.85, 0.5, 1))
    rbox(F, -0.23, 0.23, 0.28, 0.3, 0.69, 0.72, "H_plastic", r=0.01, seg=1, tn=(0.95, 0.85, 0.5, 1))
    rbox(F, -0.23, -0.2, 0.0, 0.3, 0.69, 0.72, "H_plastic", r=0.01, seg=1, tn=(0.95, 0.85, 0.5, 1))
    rbox(F, 0.2, 0.23, 0.0, 0.3, 0.69, 0.72, "H_plastic", r=0.01, seg=1, tn=(0.95, 0.85, 0.5, 1))
    col(F, -0.25, 0.25, -0.2, 0.32, 1.0, name="highchair")


def futon_stack(F, w=1.0, d=0.7, n=6, seed=3, tn_list=None):
    """folded 이불 pile: n quilts stacked, each slightly different in size/colour/offset, soft rounded folds with a stitched edge"""
    rnd = random.Random(seed)
    cols = tn_list or [(0.85, 0.45, 0.45, 1), (0.95, 0.85, 0.55, 1), (0.5, 0.65, 0.85, 1), (0.9, 0.6, 0.7, 1), (0.55, 0.75, 0.6, 1), (0.9, 0.9, 0.85, 1)]
    y = 0.0
    for i in range(n):
        th = rnd.uniform(0.10, 0.15)
        ww, dd = w * rnd.uniform(0.94, 1.02), d * rnd.uniform(0.94, 1.02)
        ox, oz = rnd.uniform(-0.03, 0.03), rnd.uniform(-0.03, 0.03)
        rbox(F, ox - ww / 2, ox + ww / 2, oz - dd / 2, oz + dd / 2, y, y + th, "H_fabric", r=0.04, seg=3, tile=0.5, tn=cols[i % len(cols)], puff=0.02, cuts=4, smooth=True,
             bottom=False)
        y += th
    col(F, -w / 2 - 0.03, w / 2 + 0.03, -d / 2 - 0.03, d / 2 + 0.03, y, name="futon")


# ---- window view (M_view) -------------------------------------------------------------------------------------------
K.MATS["M_view"] = dict(color="#8FB4D8", rough=1.0)          # exported plain: G binds house_N_view.webp (top half day, bottom half night)


def view_band(F, house=1, R=9.0, n=48, cx=5.3, cz=3.9, eye=1.6):
    """the window panorama: a full ring (radius R, outside the walls, normals inward) centred on the room, latitude -45..+45 deg around
    eye height `eye`; material M_view, UV 0..1 (u = 0.5 + bearing / 2pi, bearing 0 = local +z = into the room, + toward local +x; v = 1 top).
    G samples house_N_view.webp (2048 x 1024, day = top half, night = bottom half) with repeat.y 0.5 and offset 0 / 0.5."""
    import os
    p = os.path.join(K.WORK, f"house_{house}_view_day.png")
    if os.path.exists(p) and os.environ.get("CV_VIEW_PREVIEW", "1") == "1":       # authoring / preview renders only (the export is a plain material)
        K.MATS["M_view"] = dict(tex=p, rough=1.0, glow=1.0)
        K._M.pop("M_view", None)
    y0, y1 = eye - R, eye + R
    for i in range(n):
        a0 = -math.pi + 2 * math.pi * i / n
        a1 = -math.pi + 2 * math.pi * (i + 1) / n
        P0 = (cx + R * math.sin(a0), cz + R * math.cos(a0))
        P1 = (cx + R * math.sin(a1), cz + R * math.cos(a1))
        am = (a0 + a1) / 2
        gface(F, [(P0[0], P0[1], y0), (P1[0], P1[1], y0), (P1[0], P1[1], y1), (P0[0], P0[1], y1)], "M_view", None, 1.0,
              (-math.sin(am), -math.cos(am), 0), uv=[(i / n, 0.0), ((i + 1) / n, 0.0), ((i + 1) / n, 1.0), (i / n, 1.0)])


# ---- per-house wallpaper, shoes, partitions ------------------------------------------------------------------------------
def set_house(n):
    """H_plaster (walls + ceilings) becomes this house's patterned wallpaper T_h_wp<n>.png (same material count)"""
    K.MATS["H_plaster"] = dict(tex=f"T_h_wp{n}.png", rough=0.92, tint=True)
    K._M.pop("H_plaster", None)


def shoes_pair(F, tn=(0.85, 0.85, 0.82, 1), sole=(0.95, 0.95, 0.95, 1)):
    """a pair of sneakers (about 80 triangles): sole + upper + toe cap + tongue, two shoes slightly apart"""
    for k, sx in enumerate((-0.07, 0.07)):
        a = 0.12 * (1 if k else -1)
        G = F.sub(sx, 0.0, 0.0, a)
        rbox(G, -0.045, 0.045, -0.13, 0.13, 0.0, 0.025, "H_rubber", r=0.0, seg=1, tn=sole)
        rbox(G, -0.04, 0.04, -0.12, 0.07, 0.025, 0.075, "H_fabric", r=0.0, seg=1, tn=tn)
        rbox(G, -0.04, 0.04, 0.02, 0.12, 0.025, 0.055, "H_fabric", r=0.0, seg=1, tn=tuple(c * 0.8 for c in tn[:3]) + (1,))
        rbox(G, -0.03, 0.03, -0.06, 0.0, 0.075, 0.1, "H_fabric", r=0.0, seg=1, tn=tn)


def part_wall(F, length, openings=(), th=0.12, h=3.7, tn=None, name="part", along="x", trim_tn=None):
    """interior partition: a wall of `length` along local +x of F with doorways (s0, s1, head) (doorless, >= 1.6 m wide), both faces
    wallpapered, baseboards, a crown line, architrave on both sides, colliders per segment (camera boxes). Origin = start of the wall,
    the wall is centred on z = 0."""
    tn = tn or PAL["white"]
    ttn = trim_tn or PAL["paint_white"]
    ops = sorted(openings)
    segs, s = [], 0.0
    for (a, b, hd) in ops:
        if a - s > 0.02:
            segs.append((s, a))
        s = b
    if length - s > 0.02:
        segs.append((s, length))
    hz = th / 2
    for (a, b) in segs:
        rbox(F, a, b, -hz, hz, 0.0, h, "H_plaster", r=0.0, seg=1, tn=tn, grain=(1, 0, 0))
        for sgn in (-1, 1):
            rbox(F, a, b, sgn * hz if sgn > 0 else -hz - 0.014, (hz + 0.014) if sgn > 0 else -hz, 0.0, 0.1, "H_paint", r=0.0, seg=1, tn=ttn)
            rbox(F, a, b, sgn * hz if sgn > 0 else -hz - 0.03, (hz + 0.03) if sgn > 0 else -hz, h - 0.08, h, "H_paint", r=0.0, seg=1, tn=ttn)
        col(F, a, b, -hz, hz, h, name=name, camera=True)
    for (a, b, hd) in ops:
        rbox(F, a, b, -hz, hz, hd, h, "H_plaster", r=0.0, seg=1, tn=tn)
        for sgn in (-1, 1):
            z0, z1 = (hz, hz + 0.016) if sgn > 0 else (-hz - 0.016, -hz)
            rbox(F, a - 0.07, a, z0, z1, 0.0, hd + 0.07, "H_paint", r=0.0, seg=1, tn=ttn)
            rbox(F, b, b + 0.07, z0, z1, 0.0, hd + 0.07, "H_paint", r=0.0, seg=1, tn=ttn)
            rbox(F, a - 0.07, b + 0.07, z0, z1, hd, hd + 0.07, "H_paint", r=0.0, seg=1, tn=ttn)
