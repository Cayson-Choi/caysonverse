"""Lamps, plants, rugs, frames, wood stove and other decor of the houses kit (real geometry: leaves are curved blades with
veins, shades are open drums, rugs have borders and fringe)."""
import math
import random
from kit_core import *   # noqa: F401,F403
from kit_core import S
from kit_seating import WOOD, BLK
from kit_storage import bowl, mug, dish, acell, books_stack


# ------------------------------------------------------------------------------------------------ plants ----------
def leaf(F, base, direction, length, width, droop=0.15, m="H_leaf", tn=None, segs=5, twist=0.0, curl=0.16):
    """a curved two-sided blade from `base` (local pt) toward the local `direction` (unit, may point up-out), outline sin-shaped."""
    bx, bz, by = base
    dx, dz, dy = direction
    ln = math.sqrt(dx * dx + dz * dz + dy * dy)
    dx, dz, dy = dx / ln, dz / ln, dy / ln
    # side vector: horizontal, perpendicular to direction
    sx, sz = -dz, dx
    sl = math.hypot(sx, sz) or 1.0
    sx, sz = sx / sl, sz / sl
    prof = []
    for i in range(segs + 1):
        t = i / segs
        w = width / 2 * math.sin(math.pi * min(1.0, t ** 0.75 + 0.02 * (t < 0.01)))
        cx = bx + dx * length * t
        cz = bz + dz * length * t
        cy = by + dy * length * t - droop * length * t * t
        # houses-real pass 2 (owner 2026-11-22: flat card leaves): the blade folds along its midrib (a V) and cups up at the margins
        fold = 0.1 * w + 0.002
        prof.append(((cx - sx * w, cz - sz * w, cy + curl * w), (cx + sx * w, cz + sz * w, cy + curl * w), (cx, cz, cy - fold)))
    for i in range(segs):
        a0, a1, mid0 = prof[i]
        b0, b1, mid1 = prof[i + 1]
        t0, t1 = i / segs, (i + 1) / segs
        for side in (0, 1):
            L0, R0 = (a0, mid0) if side == 0 else (mid0, a1)
            L1, R1 = (b0, mid1) if side == 0 else (mid1, b1)
            u0, u1 = (0.0, 0.5) if side == 0 else (0.5, 1.0)
            uvs = [(u0, t0), (u1, t0), (u1, t1), (u0, t1)]
            gface(F, [L0, R0, R1, L1], m, None, 1.0, (0, 1, 0), uv=uvs, tn=tn, smooth=True)
            gface(F, [L0, R0, R1, L1], m, None, 1.0, (0, -1, 0), uv=uvs, tn=tn, smooth=True)


def pot(F, r=0.17, h=0.3, tn=None, soil=True, m="H_terracotta"):
    tn = tn or PAL["terracotta"]
    prof = [(0, 0.0), (r * 0.62, 0.0), (r * 0.72, 0.02), (r * 0.9, h * 0.9), (r * 1.02, h * 0.92), (r * 1.02, h), (r * 0.93, h), (r * 0.9, h - 0.02)]
    lathe(F, 0, 0, 0.0, prof, m, 24, tn=tn)
    if soil:
        disc(F, 0, 0, h - 0.035, r * 0.9, "H_soil", 24)


def plant_monstera(F, h=1.1, seed=4, leaves=12):
    rnd = random.Random(seed)
    pot(F, 0.19, 0.32)
    for i in range(leaves):
        a = rnd.uniform(0, 2 * math.pi)
        up = rnd.uniform(0.35, 0.95)
        L = rnd.uniform(0.25, 0.42)
        base_h = 0.3 + rnd.uniform(0, 0.1)
        sp = rnd.uniform(0.05, 0.14)
        stem_top = (math.cos(a) * sp * (1 + up) * 2.0, math.sin(a) * sp * (1 + up) * 2.0, 0.3 + (h - 0.3) * up)
        tube(F, [(0.0, 0.0, base_h), (stem_top[0] * 0.5, stem_top[1] * 0.5, (base_h + stem_top[2]) / 2 + 0.02), stem_top], 0.007, "H_leaf", 5, tn=(0.6, 0.8, 0.5, 1))
        dirv = (math.cos(a), math.sin(a), 0.15 - up * 0.2)
        leaf(F, stem_top, dirv, L, L * 0.9, droop=0.25, tn=(0.85 + 0.2 * rnd.random(), 1.0, 0.8, 1), segs=5, curl=0.12)
        # monstera slits suggestion: darker notch triangles
    col(F, -0.35, 0.35, -0.35, 0.35, h, name="plant")


def plant_olive(F, h=1.6, seed=6):
    rnd = random.Random(seed)
    pot(F, 0.2, 0.38, tn=(0.75, 0.72, 0.65, 1), m="H_terracotta")
    tube(F, [(0, 0, 0.38), (0.02, 0.01, h * 0.45), (0.0, -0.02, h * 0.62)], [0.025, 0.02, 0.012], "H_wood_oak", 8, tn=(0.55, 0.45, 0.38, 1))
    for b in range(7):
        a = b * 2 * math.pi / 7 + rnd.random()
        pts = [(0, 0, h * 0.5), (math.cos(a) * 0.18, math.sin(a) * 0.18, h * 0.62), (math.cos(a) * 0.32, math.sin(a) * 0.32, h * (0.72 + 0.04 * (b % 3)))]
        tube(F, pts, [0.01, 0.008, 0.005], "H_wood_oak", 5, tn=(0.55, 0.45, 0.38, 1), caps=False)
        for k in range(26):
            t = 0.3 + 0.7 * k / 26
            px = pts[0][0] + (pts[2][0] - pts[0][0]) * t
            pz = pts[0][1] + (pts[2][1] - pts[0][1]) * t
            py = pts[0][2] + (pts[2][2] - pts[0][2]) * t
            aa = a + rnd.uniform(-1.4, 1.4)
            leaf(F, (px, pz, py), (math.cos(aa), math.sin(aa), rnd.uniform(0.1, 0.5)), 0.13, 0.04, droop=0.12, tn=(0.62, 0.78, 0.62, 1), segs=2)
    col(F, -0.3, 0.3, -0.3, 0.3, h, name="plant")


def plant_rubber(F, h=1.5, seed=8):
    rnd = random.Random(seed)
    pot(F, 0.22, 0.38, tn=(0.9, 0.88, 0.84, 1), m="H_ceramic")
    tube(F, [(0, 0, 0.36), (0.01, 0, h * 0.6), (0.0, 0.01, h - 0.1)], [0.022, 0.018, 0.012], "H_leaf", 8, tn=(0.35, 0.45, 0.3, 1))
    for k in range(30):
        t = 0.2 + 0.8 * k / 30
        a = k * 2.4 + rnd.random()
        leaf(F, (0.0, 0.0, 0.36 + (h - 0.4) * t), (math.cos(a), math.sin(a), 0.35), 0.32, 0.17, droop=0.2, tn=(0.5 + 0.1 * rnd.random(), 0.7, 0.45, 1), segs=4)
    col(F, -0.3, 0.3, -0.3, 0.3, h, name="plant")


def plant_snake(F, h=0.7, seed=3):
    rnd = random.Random(seed)
    pot(F, 0.14, 0.24, tn=(0.9, 0.9, 0.88, 1), m="H_ceramic")
    for k in range(9):
        a = rnd.uniform(0, 2 * math.pi)
        r = rnd.uniform(0.0, 0.07)
        L = rnd.uniform(0.3, h - 0.1)
        leaf(F, (math.cos(a) * r, math.sin(a) * r, 0.22), (math.cos(a) * 0.1, math.sin(a) * 0.1, 1.0), L, 0.055, droop=0.0, tn=(0.55, 0.75, 0.5, 1), segs=3)
    col(F, -0.2, 0.2, -0.2, 0.2, h, name="plant")


def plant_orchid(F, seed=2):
    rnd = random.Random(seed)
    pot(F, 0.07, 0.12, tn=(0.95, 0.95, 0.93, 1), m="H_ceramic")
    for k in range(4):
        a = k * math.pi / 2 + 0.3
        leaf(F, (0, 0, 0.1), (math.cos(a), math.sin(a), 0.5), 0.17, 0.05, droop=0.4, tn=(0.55, 0.8, 0.5, 1), segs=3)
    tube(F, [(0, 0, 0.12), (0.02, 0, 0.3), (0.07, 0, 0.42)], 0.004, "H_leaf", 5, tn=(0.5, 0.6, 0.4, 1))
    for k in range(5):
        t = k / 4
        x, y = 0.02 + 0.05 * t, 0.28 + 0.14 * t
        lathe(F, x, 0.0, y, [(0, 0), (0.022, 0.0), (0.028, 0.012), (0.012, 0.02), (0, 0.016)], "H_plastic", 8, tn=(0.97, 0.9, 0.95, 1))
    col(F, -0.1, 0.1, -0.1, 0.1, 0.45, name="plant")


def plant_hanging(F, seed=5, drop=0.8):
    """행잉 화분: macramé-like 3 hang cords, a round pot and trailing vines with small leaves."""
    rnd = random.Random(seed)
    for k in range(3):
        a = k * 2 * math.pi / 3
        tube(F, [(0, 0, 0.0), (0.09 * math.cos(a), 0.09 * math.sin(a), -0.28)], 0.003, "H_rope" if False else "H_fabric", 4, tn=(0.9, 0.85, 0.7, 1), caps=False)
    pot(Frame(*F.p(0, 0, -0.42), F.yaw), 0.1, 0.12, tn=(0.9, 0.9, 0.86, 1), m="H_ceramic") if False else None
    G = F.sub(0, 0, -0.42, 0)
    pot(G, 0.1, 0.12, tn=(0.9, 0.9, 0.86, 1), m="H_ceramic")
    for k in range(5):
        a = k * 1.3
        pts = [(0.08 * math.cos(a), 0.08 * math.sin(a), 0.1), (0.13 * math.cos(a), 0.13 * math.sin(a), -0.05), (0.14 * math.cos(a), 0.14 * math.sin(a), -0.3 - 0.1 * rnd.random())]
        tube(F, pts, 0.004, "H_leaf", 4, tn=(0.4, 0.55, 0.3, 1), caps=False)
        for j in range(6):
            t = 0.2 + 0.8 * j / 6
            leaf(G, (pts[0][0] + (pts[2][0] - pts[0][0]) * t, pts[0][1] + (pts[2][1] - pts[0][1]) * t, pts[0][2] + (pts[2][2] - pts[0][2]) * t),
                 (math.cos(a + 1.5 * (-1) ** j), math.sin(a + 1.5 * (-1) ** j), -0.2), 0.06, 0.035, droop=0.1, tn=(0.6, 0.85, 0.5, 1), segs=2)


# ------------------------------------------------------------------------------------------------- lamps ----------
def shade(F, cx, cz, y0, r0, r1, h, tn=None, segs=14):
    tn = tn or (1, 0.95, 0.85, 1)
    lathe(F, cx, cz, y0, [(r0, 0.0), (r1, h)], "H_shade", segs, tn=tn)
    lathe(F, cx, cz, y0, [(r1, h), (r0, 0.0)], "H_shade", segs, tn=tn)


def floor_lamp(F, h=1.55, tn=None):
    """플로어 스탠드 (1번 집): round steel base, slim pole, drum linen shade with a bulb glow (light empty)."""
    lathe(F, 0, 0, 0.0, [(0, 0), (0.16, 0.0), (0.17, 0.01), (0.15, 0.025), (0, 0.025)], "H_metal", 14, tn=BLK)
    tube(F, [(0, 0, 0.02), (0, 0, h - 0.25)], 0.01, "H_metal", 8, tn=BLK)
    shade(F, 0, 0, h - 0.27, 0.15, 0.17, 0.28)
    lathe(F, 0, 0, h - 0.2, [(0, 0), (0.035, 0.015), (0.04, 0.06), (0.02, 0.09), (0, 0.095)], "H_lamp", 10)
    light(F, "lamp", 0, 0, h - 0.15, 60.0, "#FFD6A0")
    col(F, -0.18, 0.18, -0.18, 0.18, 0.5, name="lamp")


def table_lamp(F, tn=None):
    """스탠드 (협탁 위): ceramic gourd base, drum shade."""
    tn = tn or (0.9, 0.85, 0.75, 1)
    lathe(F, 0, 0, 0.0, [(0, 0), (0.07, 0.0), (0.09, 0.03), (0.095, 0.1), (0.06, 0.2), (0.03, 0.26), (0.018, 0.3), (0.018, 0.33)], "H_ceramic", 12, tn=tn)
    shade(F, 0, 0, 0.3, 0.1, 0.13, 0.18)
    lathe(F, 0, 0, 0.32, [(0, 0), (0.025, 0.01), (0.03, 0.04), (0.015, 0.06), (0, 0.065)], "H_lamp", 8)
    light(F, "lamp", 0, 0, 0.38, 25.0, "#FFD6A0")


def pendant_dome(F, drop=1.0, r=0.2, tn=None):
    """펜던트 돔 등 (origin = ceiling): rose + cord + metal dome with a glowing bulb inside."""
    tn = tn or (0.12, 0.12, 0.13, 1)
    cyl(F, 0, 0, -0.03, 0.0, 0.05, "H_paint", 14, cap=True, tn=(0.9, 0.9, 0.9, 1))
    tube(F, [(0, 0, 0.0), (0, 0, -drop)], 0.004, "H_rubber", 5, caps=False)
    lathe(F, 0, 0, -drop - 0.2, [(0.04, 0.2), (0.05, 0.17), (r * 0.6, 0.13), (r, 0.0), (r - 0.004, 0.0), (r * 0.6 - 0.004, 0.127), (0.045, 0.165), (0.04, 0.19)], "H_metal", 28, tn=tn)
    lathe(F, 0, 0, -drop - 0.17, [(0, 0), (0.04, 0.02), (0.05, 0.07), (0.035, 0.1), (0, 0.11)], "H_lamp", 12)
    light(F, "pendant", 0, 0, -drop - 0.1, 50.0, "#FFD6A0")


def pendant_globe(F, drop=1.1, r=0.14):
    tube(F, [(0, 0, 0.0), (0, 0, -drop + r)], 0.004, "H_rubber", 5, caps=False)
    cyl(F, 0, 0, -0.03, 0.0, 0.05, "H_paint", 14, tn=(0.9, 0.9, 0.9, 1))
    # a round glass globe: a 16-ring profile (every 11.25 deg) x 32 segments, not the old 6-ring faceted ball
    prof = [(0.0, -r)] + [(r * math.sin(a), -r * math.cos(a)) for a in [math.pi * k / 16.0 for k in range(1, 15)]] + [(0.025, r * 0.99)]
    lathe(F, 0, 0, -drop - r * 0.0, prof, "H_lamp", 32)
    cyl(F, 0, 0, -drop + r * 0.9, -drop + r + 0.05, 0.03, "H_metal", 10, tn=(0.9, 0.8, 0.5, 1))
    light(F, "pendant", 0, 0, -drop, 40.0, "#FFD6A0")


def pendant_bar(F, w=1.3, drop=1.0, n=3):
    """긴 식탁 위 펜던트 3구 (2~3 bulbs on a wood bar, hung by two cords)."""
    rbox(F, -w / 2, w / 2, -0.025, 0.025, -drop - 0.03, -drop + 0.03, "H_wood_oak", r=0.01, seg=2, tn=WOOD["walnut"])
    for x in (-w / 2 + 0.1, w / 2 - 0.1):
        tube(F, [(x, 0, 0.0), (x, 0, -drop + 0.03)], 0.004, "H_rubber", 5, caps=False)
        cyl(F, x, 0, -0.03, 0.0, 0.04, "H_paint", 12, cap=True, tn=(0.9, 0.9, 0.9, 1))      # the ceiling rose each cord ends in
    for i in range(n):
        x = -w / 2 + w * (i + 0.5) / n
        tube(F, [(x, 0, -drop - 0.03), (x, 0, -drop - 0.12)], 0.004, "H_rubber", 5, caps=False)
        lathe(F, x, 0, -drop - 0.28, [(0, 0.0), (0.02, 0.01), (0.07, 0.06), (0.085, 0.13), (0.03, 0.17), (0.0, 0.17)], "H_lamp", 16)
        light(F, "pendant", x, 0, -drop - 0.18, 25.0, "#FFD6A0")


def hanji_lantern(F, drop=0.8, r=0.17, h=0.4):
    """한지 등 (8번 집): cylinder paper lantern with ribs, top and bottom caps."""
    tube(F, [(0, 0, 0.0), (0, 0, -drop + h)], 0.004, "H_rubber", 5, caps=False)
    lathe(F, 0, 0, -drop, [(r * 0.9, 0.0), (r, h * 0.2), (r, h * 0.8), (r * 0.9, h)], "H_paper", 24)
    for k in range(12):
        a = k * 2 * math.pi / 12
        tube(F, [(r * 0.9 * math.cos(a), r * 0.9 * math.sin(a), -drop), (r * math.cos(a), r * math.sin(a), -drop + h * 0.2), (r * math.cos(a), r * math.sin(a), -drop + h * 0.8),
                 (r * 0.9 * math.cos(a), r * 0.9 * math.sin(a), -drop + h)], 0.003, "H_wood_oak", 4, tn=(0.4, 0.28, 0.2, 1), caps=False)
    for y in (-drop, -drop + h):
        disc(F, 0, 0, y, r * 0.9, "H_wood_oak", 24, down=(y == -drop), tn=(0.4, 0.28, 0.2, 1))
    light(F, "pendant", 0, 0, -drop + h * 0.5, 20.0, "#FFC890")


def string_lights(F, length=3.0, sag=0.25, n=14):
    """별 줄조명 (8번 집 2층): a catenary wire with small warm bulbs."""
    pts = [(length * (i / 40 - 0.5), 0.0, -sag * math.sin(math.pi * i / 40) ** 1) for i in range(41)]
    tube(F, pts, 0.0025, "H_rubber", 4, caps=False)
    for i in range(n):
        t = (i + 0.5) / n
        x = length * (t - 0.5)
        y = -sag * math.sin(math.pi * t)
        lathe(F, x, 0.0, y - 0.04, [(0, 0), (0.01, 0.005), (0.014, 0.02), (0.008, 0.035), (0, 0.04)], "H_lamp", 8)
        if i % 4 == 0:
            light(F, "string", x, 0.0, y - 0.02, 4.0, "#FFD6A0")


# -------------------------------------------------------------------------------------------------- rugs ----------
def rug_rect(F, w=2.4, d=1.7, tn=None, border_tn=None, th=0.014, fringe=True):
    """러그: wool slab with a darker border band, a soft rim and fringe on the short ends."""
    tn = tn or PAL["rug_cream"]
    bt = border_tn or tuple(c * 0.7 for c in tn[:3]) + (1,)
    hw, hd = w / 2, d / 2
    rbox(F, -hw, hw, -hd, hd, 0.0, th, "H_rug", r=0.005, seg=2, tile=0.8, tn=bt)
    rbox(F, -hw + 0.12, hw - 0.12, -hd + 0.12, hd - 0.12, th - 0.001, th + 0.002, "H_rug", r=0.0, seg=1, tile=0.8, tn=tn)
    if fringe:
        for sx in (-1, 1):
            for k in range(int(d / 0.04)):
                z = -hd + 0.02 + k * 0.04
                bar(F, (sx * hw, z, th * 0.5), (sx * (hw + 0.06), z, 0.002), 0.012, 0.003, "H_rug", tn=tn)
    col_ = None


def rug_round(F, d=1.6, tn=None, th=0.014, border_tn=None):
    """round rug: a flat up-facing disc (layered pass 2: the old lathe top baked black under the light map), a bound edge and a border ring"""
    tn = tn or PAL["rug_cream"]
    r = d / 2
    n = 32
    ring = [(r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n)) for i in range(n)]
    gface(F, [(x, z, th) for (x, z) in ring], "H_rug", (1, 0, 0), 0.8, (0, 0, 1), tn=tn)
    for i in range(n):
        (ax, az), (bx, bz) = ring[i], ring[(i + 1) % n]
        gface(F, [(ax, az, 0.0), (bx, bz, 0.0), (bx, bz, th), (ax, az, th)], "H_rug", (1, 0, 0), 0.8, ((ax + bx) / 2, (az + bz) / 2, 0.0),
              tn=tuple(c * 0.8 for c in tn[:3]) + (1,))
    rr = r * 0.86
    inner = [(rr * math.cos(2 * math.pi * i / n), rr * math.sin(2 * math.pi * i / n)) for i in range(n)]
    for i in range(n):
        (ax, az), (bx, bz) = inner[i], inner[(i + 1) % n]
        k = 0.92
        gface(F, [(ax, az, th + 0.001), (bx, bz, th + 0.001), (bx * k, bz * k, th + 0.001), (ax * k, az * k, th + 0.001)], "H_rug", (1, 0, 0), 0.8,
              (0, 0, 1), tn=border_tn or tuple(c * 0.68 for c in tn[:3]) + (1,))


def rug_check(F, w=2.0, d=1.4, a_tn=None, b_tn=None, n=6, th=0.012):
    """체크 러그 (10번 집 판재 오두막): plaid built from real strips of two tints."""
    a_tn = a_tn or PAL["rug_red"]
    b_tn = b_tn or (0.08, 0.07, 0.07, 1)
    rbox(F, -w / 2, w / 2, -d / 2, d / 2, 0.0, th, "H_rug", r=0.004, seg=2, tile=0.8, tn=a_tn)
    for i in range(n):
        x = -w / 2 + (i + 0.5) * w / n
        rbox(F, x - w / n * 0.15, x + w / n * 0.15, -d / 2, d / 2, th - 0.001, th + 0.002, "H_rug", r=0.0, seg=1, tile=0.8, tn=b_tn)
    for i in range(int(n * d / w)):
        z = -d / 2 + (i + 0.5) * d / int(n * d / w)
        rbox(F, -w / 2, w / 2, z - 0.05, z + 0.05, th - 0.001, th + 0.003, "H_rug", r=0.0, seg=1, tile=0.8, tn=b_tn)


# ------------------------------------------------------------------------------------------------ wall decor -----
def frame_art(F, w=0.5, h=0.65, art=0, tn=None, mat_m=True):
    """액자 (wall plane z = 0): a real public-domain painting in a moulded frame (kit_paint.py; `art` is kept for the old call sites)."""
    import kit_paint as KP
    KP.framed(F, w, h, frame_tn=tn or WOOD["walnut"])


def frame_family(F, w=0.3, h=0.4):
    """작은 액자: a real painting in a slim gilt-brown frame (the old sepia 'family photo' is gone)."""
    import kit_paint as KP
    KP.framed(F, w, h, frame_tn=(0.55, 0.38, 0.22, 1), mat=False)


def wall_clock(F, r=0.17):
    """벽시계: round wood case, white face with 12 tick bars, two hands and a centre cap (no brand text)."""
    lathe(F, 0, 0, 0, [(0, 0)], "H_wood_oak", 4) if False else None
    n = 24
    ring = [(r * math.cos(2 * math.pi * i / n), 0.0, r * math.sin(2 * math.pi * i / n)) for i in range(n)]
    tube(F.sub(0, 0.02, r, 0), ring + [ring[0]], 0.012, "H_wood_oak", 6, tn=(0.5, 0.35, 0.22, 1), caps=False)
    gface(F.sub(0, 0.0, r, 0), [(r * 0.97 * math.cos(2 * math.pi * i / n), 0.018, r * 0.97 * math.sin(2 * math.pi * i / n)) for i in range(n)], "H_paper", (1, 0, 0), 1.0, (0, 1, 0))
    G = F.sub(0, 0.02, r, 0)
    for k in range(12):
        a = k * math.pi / 6
        bar(G, (r * 0.78 * math.sin(a), 0.003, r * 0.78 * math.cos(a)), (r * 0.9 * math.sin(a), 0.003, r * 0.9 * math.cos(a)), 0.008, 0.003, "H_rubber", up=(0, 1, 0))
    bar(G, (0, 0.006, 0), (r * 0.5 * math.sin(2.1), 0.006, r * 0.5 * math.cos(2.1)), 0.012, 0.003, "H_rubber", up=(0, 1, 0))
    bar(G, (0, 0.008, 0), (r * 0.72 * math.sin(-0.5), 0.008, r * 0.72 * math.cos(-0.5)), 0.008, 0.003, "H_rubber", up=(0, 1, 0))
    cyl(G, 0, 0.0, 0.0, 0.0, 0.0, "H_rubber", 4) if False else None


def calendar_wall(F, w=0.3, h=0.42):
    """달력: paper pad with a picture area, a grid of day cells (colour cells), a hanger loop. No text."""
    rbox(F, -w / 2, w / 2, 0.0, 0.006, 0.0, h, "H_paper", r=0.0, seg=1)
    rbox(F, -w / 2 + 0.01, w / 2 - 0.01, 0.006, 0.0075, h * 0.45, h - 0.01, "H_atlas", r=0.0, seg=1, uvc=acell(11))
    for r_ in range(5):
        for c_ in range(7):
            x = -w / 2 + 0.02 + c_ * (w - 0.04) / 7
            y = 0.02 + r_ * (h * 0.4 - 0.03) / 5
            rbox(F, x + 0.002, x + (w - 0.04) / 7 - 0.002, 0.006, 0.0068, y + 0.002, y + (h * 0.4 - 0.03) / 5 - 0.002, "H_atlas", r=0.0, seg=1, uvc=acell(0 if c_ < 6 else 8))
    rbox(F, -0.015, 0.015, 0.0, 0.008, h, h + 0.02, "H_metal", r=0.002, seg=1, tn=BLK)


def mirror_round(F, r=0.4):
    """round wall mirror (back at z = 0): a brass ring on a shallow bevelled dish and a SILVERED glass (H_mirror, opaque: it used to be
    H_glass, 84 % see-through, so the ring looked like an empty hoop on the wall: owner 2026-11-20 '왜 이런 원들이 여기 저기 있는거야')."""
    n = 28              # interior polish (triangle budget): was 40, a 28-sided ring still reads round at a mirror's size
    G = F.sub(0, 0.0, r, 0)
    ang = [2 * math.pi * i / n for i in range(n)]
    # a thin backing board the size of the ring, so nothing but the mirror shows through it
    gface(G, [(r * 1.0 * math.cos(a), 0.004, r * 1.0 * math.sin(a)) for a in ang], "H_wood_oak", (1, 0, 0), 1.0, (0, 1, 0), tn=(0.32, 0.22, 0.14, 1))
    ring = [(r * math.cos(a), 0.016, r * math.sin(a)) for a in ang]
    tube(G, ring + [ring[0]], 0.014, "H_metal", 8, tn=(0.8, 0.7, 0.45, 1), caps=False)
    # a dark bevel just inside the ring (the glass' edge shadow), then the glass
    rim = [(r * 0.955 * math.cos(a), 0.0105, r * 0.955 * math.sin(a)) for a in ang]
    tube(G, rim + [rim[0]], 0.006, "H_rubber", 5, tn=(0.2, 0.17, 0.14, 1), caps=False)
    gface(G, [(r * 0.945 * math.cos(a), 0.0115, r * 0.945 * math.sin(a)) for a in ang], "H_mirror", (1, 0, 0), 1.0, (0, 1, 0))


# -------------------------------------------------------------------------------------------- stove & others ----
def wood_stove(F, w=0.55, d=0.45, h=0.7, chimney_to=3.7):
    """무쇠 장작 난로 (10번 집): cast-iron box with a glass door, a top plate with a pot, 4 short legs, a firebrick base slab, a black stovepipe to the ceiling."""
    iron = (0.12, 0.12, 0.13, 1)
    hw, hd = w / 2, d / 2
    rbox(F, -hw - 0.35, hw + 0.35, -hd - 0.3, hd + 0.5, 0.0, 0.1, "H_brick", r=0.01, seg=1, tn=(0.75, 0.55, 0.45, 1))
    for i in range(10):
        x = -hw - 0.35 + i * (w + 0.7) / 10
        rbox(F, x, x + 0.004, -hd - 0.3, hd + 0.5, 0.098, 0.102, "H_brick", r=0.0, seg=1, tn=(0.3, 0.25, 0.22, 1))
    y0 = 0.22
    for (sx, sz) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        rbox(F, sx * (hw - 0.04) - 0.025, sx * (hw - 0.04) + 0.025, sz * (hd - 0.04) - 0.025, sz * (hd - 0.04) + 0.025, 0.1, y0, "H_rubber", r=0.006, seg=1, tn=iron)
    rbox(F, -hw, hw, -hd, hd, y0, y0 + h, "H_rubber", r=0.02, seg=2, tn=iron)
    rbox(F, -hw - 0.02, hw + 0.02, -hd - 0.02, hd + 0.02, y0 + h, y0 + h + 0.03, "H_rubber", r=0.01, seg=1, tn=iron)
    rbox(F, -hw * 0.6, hw * 0.6, hd, hd + 0.015, y0 + 0.15, y0 + h - 0.1, "H_rubber", r=0.01, seg=1, tn=(0.2, 0.2, 0.22, 1))
    rbox(F, -hw * 0.5, hw * 0.5, hd + 0.015, hd + 0.017, y0 + 0.22, y0 + h - 0.17, "H_lamp", r=0.0, seg=1)        # fire glow through the glass
    rbox(F, hw * 0.6 - 0.0, hw * 0.6 + 0.04, hd + 0.01, hd + 0.05, y0 + 0.35, y0 + 0.37, "H_metal", r=0.004, seg=1, tn=(0.6, 0.6, 0.6, 1))
    cyl(F, 0, -hd * 0.5, y0 + h + 0.03, chimney_to, 0.075, "H_rubber", 20, tn=iron, cap=False)
    tube(F, [(0, -hd * 0.5, y0 + h + 0.2), (0, -hd * 0.5, y0 + h + 0.3)], 0.08, "H_rubber", 20, tn=(0.2, 0.2, 0.22, 1), caps=False)
    cyl(F, 0, -hd * 0.5, chimney_to - 0.12, chimney_to - 0.08, 0.09, "H_rubber", 20, tn=iron, cap=False)
    lathe(F, -0.1, 0.0, y0 + h + 0.03, [(0, 0.0), (0.09, 0.0), (0.1, 0.02), (0.1, 0.09), (0.0, 0.09)], "H_metal", 18, tn=(0.2, 0.2, 0.22, 1))
    light(F, "fire", 0, hd + 0.2, 0.5, 60.0, "#FF9A50")
    col(F, -hw - 0.35, hw + 0.35, -hd - 0.3, hd + 0.5, 3.7, name="stove")


def firewood_pile(F, w=0.9, h=0.6, seed=9):
    """장작 더미: stacked split logs (real half-round logs with end-grain discs)."""
    rnd = random.Random(seed)
    rows = int(h / 0.1)
    for r_ in range(rows):
        n = int(w / 0.11) - (r_ % 2)
        for k in range(n):
            x = -w / 2 + 0.06 + k * 0.11 + (0.055 if r_ % 2 else 0)
            rr = rnd.uniform(0.04, 0.05)
            tn = (0.75 + 0.2 * rnd.random(), 0.55 + 0.1 * rnd.random(), 0.38, 1)
            tube(F, [(x, -0.15, 0.05 + r_ * 0.1), (x, 0.15, 0.05 + r_ * 0.1)], rr, "H_wood_oak", 9, tn=tn, uv_per_m=1.5)
    col(F, -w / 2, w / 2, -0.17, 0.17, h, name="firewood")


def globe(F, r=0.17, tn=None):
    """지구본: wood tripod stand, brass meridian ring, ocean-blue sphere with green/ochre continents (real caps), no text."""
    for k in range(3):
        a = k * 2 * math.pi / 3
        tube(F, [(0.0, 0.0, 0.15), (0.14 * math.cos(a), 0.14 * math.sin(a), 0.0)], 0.012, "H_wood_oak", 8, tn=(0.4, 0.28, 0.2, 1))
    ring = [(r * 1.1 * math.cos(a), 0.0, 0.3 + r * 1.1 * math.sin(a)) for a in [i * 2 * math.pi / 40 for i in range(41)]]
    tube(F, ring, 0.007, "H_metal", 6, tn=(0.9, 0.75, 0.4, 1), caps=False)
    cz_ = 0.3
    lathe(F, 0, 0, cz_ - r, [(0, 0), (r * 0.5, r * 0.13), (r * 0.87, r * 0.5), (r, r), (r * 0.87, 1.5 * r), (r * 0.5, r * 1.87), (0, 2 * r)], "H_ceramic", 24, tn=(0.25, 0.45, 0.75, 1))
    rnd = random.Random(4)
    for k, (az, el, rr) in enumerate(((0.3, 0.4, 0.07), (2.0, 0.1, 0.06), (3.6, 0.5, 0.075), (5.0, -0.3, 0.05), (1.1, -0.7, 0.045), (4.4, 1.0, 0.04))):
        x, y, z = math.cos(el) * math.cos(az) * r * 0.985, math.cos(el) * math.sin(az) * r * 0.985, math.sin(el) * r * 0.985
        # a flattened patch: small lathe cap laid on the surface (approximated by an upright cap tilted by placement)
        lathe(F, x, y, cz_ + z - rr * 0.35, [(0, 0.0), (rr * 0.9, rr * 0.18), (rr, rr * 0.3), (rr * 0.6, rr * 0.55), (0, rr * 0.6)], "H_leaf", 10, tn=(0.55 + 0.2 * (k % 2), 0.75, 0.4, 1))
    lathe(F, 0, 0, 0.0, [(0, 0.0), (0.07, 0.0), (0.07, 0.015), (0.02, 0.03), (0.02, 0.14)], "H_wood_oak", 14, tn=(0.4, 0.28, 0.2, 1))


def _guitar_body_poly():
    half = [(0.0, 0.0), (0.085, 0.01), (0.125, 0.07), (0.115, 0.15), (0.095, 0.2), (0.105, 0.26), (0.14, 0.33), (0.155, 0.41), (0.12, 0.47), (0.0, 0.485)]
    return [(x, y) for x, y in half] + [(-x, y) for x, y in reversed(half[1:-1])]


def guitar_stand(F, n=2):
    """기타 스탠드 + 어쿠스틱 기타 2대 (7번 집): tripod stand with a neck rest; guitars with a profile body (waist, side thickness), sound hole,
    bridge, neck, headstock, tuners and strings. No brands."""
    for k in range(3):
        a = k * 2 * math.pi / 3 + 0.3
        tube(F, [(0.0, 0.0, 0.3), (0.2 * math.cos(a), 0.2 * math.sin(a), 0.0)], 0.01, "H_metal", 6, tn=BLK)
    tube(F, [(0, 0, 0.3), (0, 0, 0.85)], 0.012, "H_metal", 6, tn=BLK)
    poly = _guitar_body_poly()
    for g in range(n):
        x = -0.22 + 0.44 * g
        G = F.sub(x, 0.04, 0.12, 0.0)
        warm = (0.95, 0.68, 0.42, 1) if g == 0 else (0.75, 0.45, 0.28, 1)
        prism_v(G, poly, -0.045, 0.045, "H_wood_oak", tn=warm, front_m="H_wood_oak")
        n_ = 18
        gface(G, [(0.045 * math.cos(2 * math.pi * i / n_), 0.047, 0.31 + 0.045 * math.sin(2 * math.pi * i / n_)) for i in range(n_)], "H_rubber", (1, 0, 0), 1.0, (0, 1, 0))
        rbox(G, -0.05, 0.05, 0.045, 0.052, 0.16, 0.19, "H_wood_oak", r=0.002, seg=1, tn=(0.3, 0.2, 0.14, 1))
        rbox(G, -0.022, 0.022, -0.015, 0.015, 0.485, 0.98, "H_wood_oak", r=0.004, seg=1, tn=(0.3, 0.2, 0.14, 1))
        rbox(G, -0.04, 0.04, -0.012, 0.012, 0.98, 1.1, "H_wood_oak", r=0.004, seg=1, tn=(0.3, 0.2, 0.14, 1))
        for s in (-0.012, -0.004, 0.004, 0.012):
            tube(G, [(s, 0.053, 0.17), (s, 0.02, 1.0)], 0.0008, "H_metal", 3, tn=(0.9, 0.9, 0.9, 1), caps=False)
        for s in (-1, 1):
            for yy in (1.03, 1.08):
                rbox(G, s * 0.05 - 0.008, s * 0.05 + 0.008, -0.01, 0.01, yy - 0.01, yy + 0.01, "H_metal", r=0.002, seg=1, tn=(0.8, 0.8, 0.8, 1))
    col(F, -0.35, 0.35, -0.25, 0.25, 1.1, name="guitar")


def tea_set(F, tn=None):
    """다기 세트 (5번 집 차실): tray, teapot with handle and lid knob, 4 small cups, a pitcher."""
    tn = tn or (0.9, 0.9, 0.85, 1)
    rbox(F, -0.25, 0.25, -0.17, 0.17, 0.0, 0.02, "H_wood_oak", r=0.006, seg=1, tn=(0.45, 0.3, 0.2, 1))
    lathe(F, -0.06, 0.0, 0.02, [(0, 0.0), (0.05, 0.0), (0.075, 0.04), (0.075, 0.07), (0.045, 0.095), (0.0, 0.1)], "H_ceramic", 16, tn=tn)
    lathe(F, -0.06, 0.0, 0.115, [(0, 0.0), (0.012, 0.0), (0.014, 0.015), (0, 0.02)], "H_ceramic", 8, tn=tn)
    tube(F, [(-0.06 + 0.07, 0.0, 0.1), (-0.06 + 0.12, 0.0, 0.1), (-0.06 + 0.125, 0.0, 0.05), (-0.06 + 0.075, 0.0, 0.045)], 0.007, "H_ceramic", 6, tn=tn, caps=False)
    tube(F, [(-0.06 - 0.07, 0.0, 0.09), (-0.06 - 0.12, 0.0, 0.07), (-0.06 - 0.075, 0.0, 0.035)], 0.007, "H_ceramic", 6, tn=tn, caps=False)
    for k in range(4):
        x = 0.1 + 0.07 * (k % 2) - 0.0
        z = -0.06 + 0.12 * (k // 2)
        lathe(F, x + 0.05, z, 0.02, [(0, 0.0), (0.017, 0.0), (0.03, 0.04), (0.028, 0.043), (0.0, 0.01)], "H_ceramic", 12, tn=tn)


def basket(F, r=0.2, h=0.25, tn=None):
    """바구니 (현관·원예): woven rattan basket with two handles."""
    tn = tn or (1, 0.92, 0.8, 1)
    lathe(F, 0, 0, 0.0, [(0, 0.0), (r * 0.8, 0.0), (r, h), (r * 0.98, h)], "H_rattan", 20, tn=tn, tile=0.3)
    lathe(F, 0, 0, 0.0, [(r * 0.98, h), (r * 0.78, 0.01), (0, 0.01)], "H_rattan", 20, tn=tn, tile=0.3)
    tube(F, [(-r, 0, h), (-r * 0.8, 0, h + 0.1), (0, 0, h + 0.17), (r * 0.8, 0, h + 0.1), (r, 0, h)], 0.01, "H_wood_oak", 6, tn=(0.8, 0.65, 0.4, 1), caps=False)


def boots_pair(F, tn=None):
    """장화 한 켤레 (3번 집 현관): rubber boots, rounded toe, shaft with a lip, sole."""
    tn = tn or (0.2, 0.35, 0.22, 1)
    for s in (-1, 1):
        G = F.sub(s * 0.08, 0.0, 0.0, 0.05 * s)
        rbox(G, -0.045, 0.045, -0.12, 0.14, 0.0, 0.03, "H_plastic", r=0.012, seg=2, tn=(0.12, 0.12, 0.12, 1))
        rbox(G, -0.045, 0.045, -0.09, 0.13, 0.03, 0.12, "H_plastic", r=0.025, seg=3, tn=tn)
        rbox(G, -0.04, 0.04, -0.1, -0.02, 0.1, 0.38, "H_plastic", r=0.02, seg=3, tn=tn, smooth=True)
        rbox(G, -0.043, 0.043, -0.105, -0.015, 0.36, 0.385, "H_plastic", r=0.01, seg=2, tn=tuple(c * 1.2 for c in tn[:3]) + (1,))


def garlic_braid(F, n=10):
    """마늘 엮음 (3번 집): a braided stalk with bulbs hanging from a hook."""
    tube(F, [(0, 0, 0.0), (0.01, 0, -0.2), (-0.01, 0, -0.4), (0.0, 0, -0.55)], 0.012, "H_rattan", 6, tn=(0.8, 0.7, 0.45, 1), caps=False)
    for k in range(n):
        t = k / n
        a = k * 2.2
        lathe(F, 0.045 * math.cos(a), 0.045 * math.sin(a), -0.5 + 0.45 * (1 - t) - 0.06, [(0, 0.0), (0.02, 0.01), (0.04, 0.045), (0.03, 0.08), (0.006, 0.1)], "H_ceramic", 10,
              tn=(0.95, 0.92, 0.85, 1))


def vase_branch(F, h=0.3, seed=2):
    """꽃병 + 가지 (8번 집 청자 화병): celadon-green vase with a long neck and a few leafy twigs."""
    rnd = random.Random(seed)
    lathe(F, 0, 0, 0.0, [(0, 0.0), (0.05, 0.0), (0.095, 0.08), (0.1, 0.14), (0.06, 0.22), (0.03, 0.27), (0.035, h), (0.05, h + 0.02)], "H_ceramic", 20, tn=(0.62, 0.78, 0.7, 1))
    for k in range(3):
        a = k * 2.1
        pts = [(0, 0, h), (0.05 * math.cos(a), 0.05 * math.sin(a), h + 0.18), (0.12 * math.cos(a), 0.12 * math.sin(a), h + 0.34)]
        tube(F, pts, 0.004, "H_wood_oak", 4, tn=(0.35, 0.25, 0.2, 1), caps=False)
        for j in range(4):
            t = 0.3 + 0.2 * j
            leaf(F, (pts[0][0] + (pts[2][0] - pts[0][0]) * t, pts[0][1] + (pts[2][1] - pts[0][1]) * t, pts[0][2] + (pts[2][2] - pts[0][2]) * t),
                 (math.cos(a + 1.2 * (-1) ** j), math.sin(a + 1.2 * (-1) ** j), 0.3), 0.07, 0.03, droop=0.1, tn=(0.8, 0.95, 0.7, 1), segs=2)


PIECES = [
    dict(name="plant_monstera", fn=plant_monstera, group="decor", ref="18_sunroom", cam=dict(az=30, el=15)),
    dict(name="plant_olive", fn=plant_olive, group="decor", ref="18_sunroom", cam=dict(az=30, el=15)),
    dict(name="plant_rubber", fn=plant_rubber, group="decor", ref="18_sunroom", cam=dict(az=30, el=15)),
    dict(name="plant_snake", fn=plant_snake, group="decor", ref="18_sunroom", cam=dict(az=30, el=15)),
    dict(name="plant_orchid", fn=plant_orchid, group="decor", ref="17_sarangbang", cam=dict(az=30, el=15)),
    dict(name="plant_hanging", fn=plant_hanging, group="decor", ref="18_sunroom", cam=dict(az=30, el=-8, dz=-0.3)),
    dict(name="floor_lamp", fn=floor_lamp, group="decor", ref="02_modern_living", cam=dict(az=30, el=10)),
    dict(name="table_lamp", fn=table_lamp, group="decor", ref="15_master_bedroom", cam=dict(az=30, el=10)),
    dict(name="pendant_dome", fn=pendant_dome, group="decor", ref="03_farm_kitchen", cam=dict(az=30, el=-10, dz=-0.5)),
    dict(name="pendant_globe", fn=pendant_globe, group="decor", ref="11_dining", cam=dict(az=30, el=-10, dz=-0.5)),
    dict(name="pendant_bar", fn=pendant_bar, group="decor", ref="11_dining", cam=dict(az=25, el=-10, dz=-0.5)),
    dict(name="hanji_lantern", fn=hanji_lantern, group="decor", ref="07_hanok_maru", cam=dict(az=25, el=-5, dz=-0.3)),
    dict(name="string_lights", fn=string_lights, group="decor", ref="09_attic", cam=dict(az=15, el=0, dz=-0.1)),
    dict(name="rug_rect", fn=rug_rect, group="decor", ref="02_modern_living", cam=dict(az=25, el=35)),
    dict(name="rug_round", fn=rug_round, group="decor", ref="05_kids_room", cam=dict(az=25, el=35)),
    dict(name="rug_check", fn=rug_check, group="decor", ref="09_attic", cam=dict(az=25, el=35)),
    dict(name="frame_art", fn=frame_art, group="decor", ref="02_modern_living", cam=dict(az=15, el=5)),
    dict(name="frame_family", fn=frame_family, group="decor", ref="06_grandparents_room", cam=dict(az=15, el=5)),
    dict(name="wall_clock", fn=wall_clock, group="decor", ref="06_grandparents_room", cam=dict(az=0, el=0)),
    dict(name="calendar_wall", fn=calendar_wall, group="decor", ref="01_ondol_room", cam=dict(az=0, el=0)),
    dict(name="mirror_round", fn=mirror_round, group="decor", ref="15_master_bedroom", cam=dict(az=10, el=0)),
    dict(name="wood_stove", fn=wood_stove, kw=dict(chimney_to=2.6), group="decor", ref="09_attic", cam=dict(az=30, el=18, dist=1.5)),
    dict(name="firewood_pile", fn=firewood_pile, group="decor", ref="13_workshop", cam=dict(az=25, el=15)),
    dict(name="globe", fn=globe, group="decor", ref="04_study", cam=dict(az=25, el=15)),
    dict(name="guitar_stand", fn=guitar_stand, group="decor", ref="12_hobby_music", cam=dict(az=25, el=12)),
    dict(name="tea_set", fn=tea_set, group="decor", ref="10_tea_room", cam=dict(az=25, el=30)),
    dict(name="basket", fn=basket, group="decor", ref="16_genkwan", cam=dict(az=25, el=25)),
    dict(name="boots_pair", fn=boots_pair, group="decor", ref="16_genkwan", cam=dict(az=25, el=25)),
    dict(name="garlic_braid", fn=garlic_braid, group="decor", ref="03_farm_kitchen", cam=dict(az=25, el=0, dz=-0.2)),
    dict(name="vase_branch", fn=vase_branch, group="decor", ref="07_hanok_maru", cam=dict(az=25, el=10)),
]
