"""HB house 7 (music + workshop) pieces: guitar on an A-frame stand, floor speaker, turntable, record shelf, pegboard tool wall,
material shelf, bench props, potter's wheel. Same conventions as the kit (frame +z = front, local coordinates, K.col registers colliders)."""
import math
import random

import kit_core as K
import hb_pieces as HP
from kit_storage import acell, BOOK_CELLS

BLK = (0.1, 0.1, 0.11, 1)
STEEL = (0.62, 0.64, 0.66, 1)


def _g_poly():
    half = [(0.0, 0.0), (0.085, 0.01), (0.125, 0.07), (0.115, 0.15), (0.095, 0.2), (0.105, 0.26), (0.14, 0.33), (0.155, 0.41), (0.12, 0.47), (0.0, 0.485)]
    return half + [(-x, y) for x, y in reversed(half[1:-1])]


def guitar_a_frame(F, wood=0):
    """기타 스탠드 + 어쿠스틱 기타 1대: tripod base, a post BEHIND the guitar, a cradle under the body and a yoke round the neck; the guitar stands in it
    (waist body, sound hole, bridge, neck with frets, headstock, tuners, strings). Front = +z."""
    for k in range(3):
        a = k * 2 * math.pi / 3 + math.pi / 2
        ex, ez = 0.26 * math.cos(a), -0.13 + 0.26 * math.sin(a)
        K.tube(F, [(0.0, -0.13, 0.05), (ex, ez, 0.012)], 0.009, "H_metal", 6, tn=BLK)
        K.rbox(F, ex - 0.02, ex + 0.02, ez - 0.02, ez + 0.02, 0.0, 0.02, "H_rubber", r=0.0, seg=1)
    K.tube(F, [(0, -0.13, 0.05), (0, -0.13, 0.84)], 0.011, "H_metal", 6, tn=BLK)
    for sx in (-1, 1):
        K.tube(F, [(0, -0.13, 0.2), (sx * 0.08, -0.04, 0.2), (sx * 0.09, 0.05, 0.2)], 0.008, "H_metal", 5, tn=BLK)
        K.tube(F, [(0, -0.13, 0.82), (sx * 0.045, -0.06, 0.82), (sx * 0.05, 0.0, 0.82)], 0.007, "H_metal", 5, tn=BLK)
    warm = ((0.95, 0.66, 0.4, 1), (0.78, 0.46, 0.28, 1), (0.9, 0.82, 0.68, 1))[wood % 3]
    dark = (0.28, 0.19, 0.14, 1)
    G = F.sub(0, 0, 0.19, 0)
    K.prism_v(G, _g_poly(), -0.045, 0.045, "H_wood_oak", tn=warm, front_m="H_wood_oak")
    n_ = 18
    K.gface(G, [(0.045 * math.cos(2 * math.pi * i / n_), 0.0462, 0.3 + 0.045 * math.sin(2 * math.pi * i / n_)) for i in range(n_)], "H_rubber", (1, 0, 0), 1.0, (0, 1, 0))
    K.rbox(G, -0.05, 0.05, 0.0462, 0.052, 0.14, 0.17, "H_wood_oak", r=0.0, seg=1, tn=dark)
    K.rbox(G, -0.022, 0.022, -0.012, 0.016, 0.47, 0.96, "H_wood_oak", r=0.0, seg=1, tn=dark)
    for k in range(9):
        K.rbox(G, -0.022, 0.022, 0.016, 0.0185, 0.5 + k * 0.045, 0.504 + k * 0.045, "H_metal", r=0.0, seg=1, tn=(0.8, 0.8, 0.78, 1), skip=("+x", "-x"))
    K.rbox(G, -0.04, 0.04, -0.012, 0.014, 0.96, 1.07, "H_wood_oak", r=0.0, seg=1, tn=dark)
    for s in (-0.012, -0.004, 0.004, 0.012):
        K.tube(G, [(s, 0.053, 0.16), (s, 0.02, 0.98)], 0.0008, "H_metal", 3, tn=(0.9, 0.9, 0.9, 1), caps=False)
    for s in (-1, 1):
        for yy in (0.99, 1.04):
            K.rbox(G, s * 0.05 - 0.008, s * 0.05 + 0.008, -0.01, 0.01, yy - 0.01, yy + 0.01, "H_metal", r=0.0, seg=1, tn=(0.8, 0.8, 0.8, 1))
    K.col(F, -0.3, 0.3, -0.3, 0.2, 1.1, name="guitar")


def speaker_floor(F, h=0.86, tn=None):
    """floor-standing speaker on a plinth: veneer cabinet, black baffle with a tweeter and a woofer (cone, surround), no brand"""
    tn = tn or (0.62, 0.42, 0.3, 1)
    K.rbox(F, -0.16, 0.16, -0.15, 0.15, 0.0, 0.04, "H_rubber", r=0.0, seg=1)
    K.rbox(F, -0.14, 0.14, -0.13, 0.13, 0.04, h, "H_wood_oak", r=0.008, seg=1, tn=tn)
    K.rbox(F, -0.125, 0.125, 0.13, 0.14, 0.1, h - 0.08, "H_rubber", r=0.0, seg=1, tn=(0.12, 0.12, 0.13, 1))
    for (yy, rr) in ((h - 0.2, 0.035), (h - 0.42, 0.085)):
        K.lathe(F, 0, 0.14, yy, [(rr * 1.18, 0.0), (rr, -0.006), (rr * 0.45, -0.025), (0, -0.03)], "H_rubber", 14, tn=(0.2, 0.2, 0.22, 1))
        K.lathe(F, 0, 0.14, yy, [(rr * 1.3, 0.0), (rr * 1.18, 0.004), (rr, 0.0)], "H_metal", 14, tn=(0.55, 0.55, 0.56, 1))
    K.col(F, -0.17, 0.17, -0.16, 0.16, h, name="speaker")


def turntable(F, tn=None):
    """record player: wood plinth, platter with a record and a paper label, tonearm. No brand."""
    tn = tn or (0.6, 0.42, 0.3, 1)
    K.rbox(F, -0.22, 0.22, -0.17, 0.17, 0.0, 0.06, "H_wood_oak", r=0.0, seg=1, tn=tn)
    K.lathe(F, -0.03, 0.0, 0.06, [(0, 0), (0.14, 0.0), (0.145, 0.004), (0.14, 0.012), (0, 0.012)], "H_rubber", 22, tn=(0.08, 0.08, 0.09, 1))
    K.lathe(F, -0.03, 0.0, 0.072, [(0, 0), (0.045, 0.0), (0.045, 0.002), (0, 0.002)], "H_atlas", 12, uvscale=None)
    K.tube(F, [(0.17, 0.1, 0.07), (0.17, 0.1, 0.1), (0.1, 0.0, 0.1), (0.045, -0.06, 0.082)], 0.004, "H_metal", 5, tn=STEEL)
    K.lathe(F, 0.17, 0.1, 0.06, [(0, 0), (0.02, 0.0), (0.02, 0.03), (0, 0.03)], "H_metal", 10, tn=STEEL)


def record_shelf(F, w=1.3, d=0.36, h=0.75, tn=None, seed=2):
    """음반 선반: a walnut cube unit (2 rows of cells) with LP sleeves standing in the cells (colour top edges + the front sleeve of each cell)"""
    rnd = random.Random(seed)
    tn = tn or (0.5, 0.36, 0.3, 1)
    hw, hd = w / 2, d / 2
    nc = max(2, int(round(w / 0.36)))
    cw = (w - 0.04) / nc
    rows = 2
    ch = (h - 0.1) / rows
    for sx in (-1, 1):
        K.rbox(F, sx * hw - (0.02 if sx > 0 else 0), sx * hw + (0 if sx > 0 else 0.02), -hd, hd, 0.06, h, "H_wood_oak", r=0.0, seg=1, tn=tn, skip=("-z",))
        K.rbox(F, sx * (hw - 0.04) - 0.03, sx * (hw - 0.04) + 0.03, -hd + 0.03, hd - 0.03, 0.0, 0.06, "H_wood_oak", r=0.0, seg=1, tn=tn)
    for r_ in range(rows + 1):
        y = 0.06 + r_ * ch
        K.rbox(F, -hw + 0.02, hw - 0.02, -hd, hd, y, y + 0.02, "H_wood_oak", r=0.0, seg=1, tn=tn, bottom=True, skip=("-z", "+x", "-x"))
    for i in range(1, nc):
        x = -hw + 0.02 + i * cw
        K.rbox(F, x - 0.01, x + 0.01, -hd, hd, 0.08, h, "H_wood_oak", r=0.0, seg=1, tn=tn, skip=("-z",))
    K.gface(F, [(-hw + 0.02, -hd + 0.01, 0.08), (hw - 0.02, -hd + 0.01, 0.08), (hw - 0.02, -hd + 0.01, h), (-hw + 0.02, -hd + 0.01, h)], "H_wood_oak", (1, 0, 0), 1.0, (0, 1, 0),
            tn=tuple(c * 0.75 for c in tn[:3]) + (1,))
    for r_ in range(rows):
        y0 = 0.08 + r_ * ch
        for i in range(nc):
            xa = -hw + 0.02 + i * cw + 0.015
            n = int((cw - 0.04) / 0.011)
            for k in range(n):
                x = xa + k * 0.011
                c = acell(rnd.choice(BOOK_CELLS))
                ht = 0.3
                K.gface(F, [(x, hd - 0.33, y0 + ht), (x + 0.0085, hd - 0.33, y0 + ht), (x + 0.0085, hd - 0.02, y0 + ht), (x, hd - 0.02, y0 + ht)], "H_atlas", None, 1.0, (0, 0, 1), uv=[c] * 4)
            c = acell(rnd.choice(BOOK_CELLS))
            xf = xa + (n - 1) * 0.011
            K.gface(F, [(xa, hd - 0.02, y0), (xf + 0.0085, hd - 0.02, y0), (xf + 0.0085, hd - 0.02, y0 + 0.3), (xa, hd - 0.02, y0 + 0.3)], "H_atlas", None, 1.0, (0, 1, 0), uv=[c] * 4)
    K.col(F, -hw, hw, -hd, hd, h, name="records")


def pegboard(F, w=2.3, h=1.1, seed=3):
    """타공판 공구 벽: pine-ply board with a grid of holes (dark squares every 10 cm) in a frame and the tools hanging on it: hammers, a saw,
    pliers, screwdrivers, a square, a tape, a shelf of jars. Origin = the middle of the board's foot on the wall, +z = into the room."""
    hw = w / 2
    pine = (0.9, 0.72, 0.52, 1)
    frame = (0.7, 0.52, 0.36, 1)
    K.rbox(F, -hw, hw, 0.0, 0.02, 0.0, h, "H_wood_pine", r=0.0, seg=1, tn=pine, skip=("-z",))
    K.rbox(F, -hw - 0.03, hw + 0.03, 0.0, 0.035, h, h + 0.03, "H_wood_pine", r=0.0, seg=1, tn=frame, skip=("-z",))
    K.rbox(F, -hw - 0.03, hw + 0.03, 0.0, 0.035, -0.03, 0.0, "H_wood_pine", r=0.0, seg=1, tn=frame, skip=("-z",))
    K.rbox(F, -hw - 0.03, -hw, 0.0, 0.035, 0.0, h, "H_wood_pine", r=0.0, seg=1, tn=frame, skip=("-z",))
    K.rbox(F, hw, hw + 0.03, 0.0, 0.035, 0.0, h, "H_wood_pine", r=0.0, seg=1, tn=frame, skip=("-z",))
    nx, ny = int((w - 0.1) / 0.1), int((h - 0.1) / 0.1)
    for i in range(nx):
        for j in range(ny):
            x, y = -hw + 0.08 + i * 0.1, 0.08 + j * 0.1
            K.gface(F, [(x, 0.0205, y), (x + 0.012, 0.0205, y), (x + 0.012, 0.0205, y + 0.012), (x, 0.0205, y + 0.012)], "H_rubber", None, 1.0, (0, 1, 0), uv=[(0.5, 0.5)] * 4,
                    tn=(0.22, 0.17, 0.12, 1))
    steel, wood = STEEL, (0.62, 0.42, 0.26, 1)
    for x in (-hw + 0.2, -hw + 0.38):
        K.rbox(F, x - 0.012, x + 0.012, 0.03, 0.05, h - 0.62, h - 0.22, "H_wood_oak", r=0.0, seg=1, tn=wood)
        K.rbox(F, x - 0.045, x + 0.045, 0.027, 0.062, h - 0.24, h - 0.18, "H_metal", r=0.0, seg=1, tn=(0.35, 0.36, 0.38, 1))
    sx = -hw + 0.62
    K.gface(F, [(sx - 0.07, 0.036, h - 0.88), (sx + 0.07, 0.036, h - 0.88), (sx + 0.02, 0.036, h - 0.22), (sx - 0.02, 0.036, h - 0.22)], "H_metal", None, 1.0, (0, 1, 0), uv=[(0.5, 0.5)] * 4,
            tn=(0.75, 0.76, 0.78, 1))
    K.rbox(F, sx - 0.04, sx + 0.06, 0.03, 0.05, h - 0.3, h - 0.18, "H_wood_oak", r=0.0, seg=1, tn=(0.5, 0.3, 0.2, 1))
    for k in range(4):
        x = -hw + 0.95 + k * 0.1
        K.rbox(F, x - 0.01, x + 0.01, 0.03, 0.045, h - 0.5 - k * 0.03, h - 0.2, "H_metal", r=0.0, seg=1, tn=steel)
        K.rbox(F, x - 0.02, x + 0.02, 0.03, 0.045, h - 0.25, h - 0.18, "H_metal", r=0.0, seg=1, tn=steel)
    cols = ((0.8, 0.2, 0.15, 1), (0.2, 0.4, 0.7, 1), (0.9, 0.7, 0.2, 1))
    for k in range(3):
        x = -hw + 1.42 + k * 0.1
        K.rbox(F, x - 0.014, x + 0.014, 0.03, 0.05, h - 0.55, h - 0.2, "H_plastic", r=0.0, seg=1, tn=cols[k])
        K.rbox(F, x - 0.004, x + 0.004, 0.03, 0.04, h - 0.7, h - 0.55, "H_metal", r=0.0, seg=1, tn=steel)
    K.rbox(F, hw - 0.55, hw - 0.52, 0.03, 0.04, h - 0.65, h - 0.2, "H_metal", r=0.0, seg=1, tn=steel)
    K.rbox(F, hw - 0.55, hw - 0.28, 0.03, 0.04, h - 0.23, h - 0.2, "H_metal", r=0.0, seg=1, tn=steel)
    K.rbox(F, hw - 0.3, hw - 0.16, 0.03, 0.065, h - 0.58, h - 0.5, "H_plastic", r=0.0, seg=1, tn=(0.9, 0.75, 0.1, 1))
    K.rbox(F, hw - 0.62, hw - 0.1, 0.02, 0.15, 0.3, 0.32, "H_wood_oak", r=0.0, seg=1, tn=wood)
    for k in range(5):
        x = hw - 0.55 + k * 0.095
        K.lathe(F, x, 0.085, 0.32, [(0, 0), (0.032, 0.0), (0.032, 0.09), (0.026, 0.1), (0.0, 0.1)], "H_glass", 8, tn=(0.85, 0.9, 0.9, 1))
        K.lathe(F, x, 0.085, 0.32, [(0, 0), (0.026, 0.0), (0.026, 0.05), (0, 0.05)], "H_metal", 8, tn=(0.55, 0.5, 0.4, 1))
    K.col(F, -hw - 0.03, hw + 0.03, 0.0, 0.16, h + 0.03, name="pegboard")


def shelf_materials(F, w=1.2, d=0.4, h=1.9, seed=4, rows=5):
    """공방 재료 선반: open pine shelving with cardboard boxes, jars, rolled paper, offcut timber, paint tins"""
    rnd = random.Random(seed)
    hw, hd = w / 2, d / 2
    pine = (0.95, 0.78, 0.56, 1)
    for sx in (-1, 1):
        K.rbox(F, sx * hw - (0.04 if sx > 0 else 0), sx * hw + (0 if sx > 0 else 0.04), -hd, hd, 0.0, h, "H_wood_pine", r=0.0, seg=1, tn=pine, grain=(0, 0, 1), skip=("-z",))
    gap = (h - 0.1) / rows
    K.gface(F, [(-hw + 0.04, -hd + 0.01, 0.0), (hw - 0.04, -hd + 0.01, 0.0), (hw - 0.04, -hd + 0.01, h), (-hw + 0.04, -hd + 0.01, h)], "H_wood_pine", (1, 0, 0), 1.0, (0, 1, 0),
            tn=(0.7, 0.55, 0.4, 1))
    for r_ in range(rows + 1):
        y = 0.08 + r_ * gap if r_ < rows else h - 0.03
        K.rbox(F, -hw + 0.04, hw - 0.04, -hd + 0.01, hd, y, y + 0.03, "H_wood_pine", r=0.0, seg=1, tn=pine, bottom=(y > 1.2), skip=("-z", "+x", "-x"))
        if r_ >= rows:
            continue
        x = -hw + 0.07
        top = y + 0.03
        while x < hw - 0.12:
            kind = rnd.choice(("box", "box", "jar", "tin", "roll", "stack"))
            room = hw - 0.08 - x
            if kind == "box" or room < 0.3:
                bw, bh = min(rnd.uniform(0.18, 0.34), room), rnd.uniform(0.12, min(0.3, gap - 0.08))
                K.rbox(F, x, x + bw, -hd + 0.04, hd - 0.03, top, top + bh, "H_plaster", r=0.0, seg=1, tn=(0.78, 0.6, 0.42, 1), skip=("-z", "-x"))
                K.rbox(F, x + bw * 0.25, x + bw * 0.75, hd - 0.031, hd - 0.025, top + bh * 0.4, top + bh * 0.8, "H_plaster", r=0.0, seg=1, tn=(0.95, 0.93, 0.85, 1), skip=("-z",))
                x += bw + 0.03
            elif kind == "jar":
                for k in range(2):
                    K.lathe(F, x + 0.06 + k * 0.13, 0.0, top, [(0, 0), (0.05, 0.0), (0.05, 0.17), (0.04, 0.19), (0, 0.19)], "H_glass", 10, tn=(0.85, 0.92, 0.9, 1))
                    K.lathe(F, x + 0.06 + k * 0.13, 0.0, top, [(0, 0), (0.04, 0.0), (0.04, 0.1 + 0.04 * k), (0, 0.1 + 0.04 * k)], "H_atlas", 8, tn=(1, 1, 1, 1))
                x += 0.3
            elif kind == "tin":
                for k in range(3):
                    K.lathe(F, x + 0.06 + k * 0.1, 0.0, top, [(0, 0), (0.045, 0.0), (0.045, 0.12), (0, 0.12)], "H_metal", 10, tn=((0.8, 0.8, 0.82, 1), (0.7, 0.3, 0.25, 1), (0.3, 0.5, 0.6, 1))[k])
                x += 0.34
            elif kind == "roll":
                for k in range(4):
                    K.tube(F, [(x + 0.05 + k * 0.07, 0.0, top + 0.05), (x + 0.05 + k * 0.07, 0.0, top + 0.28)], 0.03, "H_plaster", 7, tn=(0.95, 0.92, 0.85, 1))
                x += 0.38
            else:
                for k in range(4):
                    K.rbox(F, x, x + min(0.34, room), -0.1, 0.1, top + k * 0.045, top + k * 0.045 + 0.04, "H_wood_oak", r=0.0, seg=1, tn=(0.85 - 0.05 * k, 0.65, 0.45, 1), skip=("-z",))
                x += 0.4
    K.col(F, -hw, hw, -hd, hd, h, name="shelf")


def bench_props(F, w=1.8, d=0.8, top=0.9, seed=5):
    """on a workbench: a half-finished wooden box, a hand plane, a mallet, an offcut, a tray of screws, a coil of wire"""
    hw = w / 2
    K.rbox(F, -hw + 0.2, -hw + 0.62, -0.2, 0.12, top, top + 0.14, "H_wood_oak", r=0.0, seg=1, tn=(0.85, 0.65, 0.45, 1))
    K.rbox(F, -hw + 0.23, -hw + 0.59, -0.17, 0.09, top + 0.1, top + 0.142, "H_wood_dark", r=0.0, seg=1, tn=(0.4, 0.3, 0.22, 1), skip=("-y",))
    K.rbox(F, -0.1, 0.22, -0.08, 0.02, top, top + 0.05, "H_wood_oak", r=0.0, seg=1, tn=(0.7, 0.45, 0.3, 1))
    K.rbox(F, -0.04, 0.12, -0.05, -0.0, top + 0.05, top + 0.1, "H_wood_oak", r=0.0, seg=1, tn=(0.55, 0.35, 0.22, 1))
    K.tube(F, [(0.3, 0.0, top + 0.03), (0.52, 0.0, top + 0.03)], 0.013, "H_wood_oak", 7, tn=(0.8, 0.6, 0.4, 1))
    K.rbox(F, 0.5, 0.62, -0.05, 0.05, top, top + 0.07, "H_wood_oak", r=0.0, seg=1, tn=(0.75, 0.55, 0.4, 1))
    K.rbox(F, hw - 0.32, hw - 0.04, 0.12, 0.32, top, top + 0.035, "H_wood_oak", r=0.0, seg=1, tn=(0.5, 0.4, 0.3, 1), skip=("-z",))
    for k in range(7):
        K.rbox(F, hw - 0.3 + 0.03 * (k % 4), hw - 0.285 + 0.03 * (k % 4), 0.15 + 0.04 * (k // 4), 0.162 + 0.04 * (k // 4), top + 0.035, top + 0.045, "H_metal", r=0.0, seg=1, tn=STEEL)
    K.lathe(F, -0.05, -0.28, top, [(0, 0), (0.07, 0.0), (0.07, 0.03), (0.045, 0.045), (0, 0.045)], "H_metal", 12, tn=(0.8, 0.45, 0.2, 1))


def potter_wheel(F, tn=None):
    """물레 (장식): steel frame on four legs with a splash pan, a wheel head and a half-thrown clay pot; a clay bucket beside it. Origin = the wheel's middle."""
    tn = tn or (0.6, 0.62, 0.64, 1)
    for (sx, sz) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        K.rbox(F, sx * 0.26 - 0.02, sx * 0.26 + 0.02, sz * 0.2 - 0.02, sz * 0.2 + 0.02, 0.0, 0.62, "H_metal", r=0.0, seg=1, tn=tn)
    K.rbox(F, -0.28, 0.28, -0.22, 0.22, 0.28, 0.31, "H_metal", r=0.0, seg=1, tn=tn)
    K.lathe(F, 0, 0, 0.62, [(0.1, 0.0), (0.36, 0.0), (0.38, 0.02), (0.38, 0.08), (0.36, 0.08), (0.36, 0.03), (0.1, 0.03)], "H_plastic", 26, tn=(0.88, 0.88, 0.9, 1))
    K.lathe(F, 0, 0, 0.62, [(0, 0.0), (0.1, 0.0), (0.1, 0.1), (0.0, 0.1)], "H_metal", 12, tn=tn)
    K.lathe(F, 0, 0, 0.72, [(0, 0.0), (0.16, 0.0), (0.17, 0.012), (0.15, 0.02), (0, 0.02)], "H_metal", 20, tn=(0.75, 0.76, 0.78, 1))
    K.lathe(F, 0, 0, 0.74, [(0.0, 0.0), (0.08, 0.0), (0.095, 0.05), (0.09, 0.1), (0.06, 0.15), (0.05, 0.19), (0.058, 0.2), (0.044, 0.2), (0.0, 0.1)], "H_terracotta", 18, tn=(0.74, 0.5, 0.38, 1))
    K.lathe(F, 0.6, 0.1, 0.0, [(0, 0), (0.17, 0.0), (0.2, 0.3), (0.0, 0.3)], "H_plastic", 14, tn=(0.2, 0.3, 0.45, 1))
    K.col(F, -0.42, 0.82, -0.3, 0.32, 0.8, name="wheel")


def lumber_rack(F, w=1.2, h=1.7, seed=3):
    """a wall rack of timber: two uprights with four arms, planks and battens of different lengths and colours lying on it, ends showing"""
    rnd = random.Random(seed)
    hw = w / 2
    wood = (0.55, 0.4, 0.28, 1)
    for sx in (-1, 1):
        K.rbox(F, sx * (hw - 0.04) - 0.03, sx * (hw - 0.04) + 0.03, 0.0, 0.05, 0.0, h, "H_wood_oak", r=0.0, seg=1, tn=wood, skip=("-z",))
    for k, y in enumerate((0.25, 0.65, 1.05, 1.45)):
        for sx in (-1, 1):
            K.rbox(F, sx * (hw - 0.04) - 0.03, sx * (hw - 0.04) + 0.03, 0.05, 0.4, y, y + 0.05, "H_wood_oak", r=0.0, seg=1, tn=wood)
        n = 3 + (k % 2)
        for j in range(n):
            ln = rnd.uniform(0.7, w - 0.1)
            x0 = -hw + 0.06 + rnd.uniform(0, w - 0.12 - ln)
            t = rnd.choice((0.04, 0.05, 0.07))
            z0 = 0.08 + j * 0.085
            c = (0.85 + 0.15 * rnd.random(), 0.65 + 0.1 * rnd.random(), 0.45 + 0.1 * rnd.random(), 1)
            K.rbox(F, x0, x0 + ln, z0, z0 + 0.075, y + 0.05, y + 0.05 + t, "H_wood_oak", r=0.0, seg=1, tn=c, grain=(1, 0, 0), skip=("-z", "-y") if False else ())
    K.col(F, -hw, hw, 0.0, 0.42, h, name="lumber")


def crate_stack(F, n=3, seed=2):
    """slatted wooden crates stacked 1-3 high, one with offcuts and one with paint tins"""
    rnd = random.Random(seed)
    wood = (0.78, 0.6, 0.42, 1)
    for k in range(n):
        y = k * 0.3
        x = rnd.uniform(-0.03, 0.03)
        K.rbox(F, x - 0.3, x + 0.3, -0.2, 0.2, y, y + 0.06, "H_wood_pine", r=0.0, seg=1, tn=wood, bottom=True)
        for (a, b, c, d) in ((x - 0.3, x - 0.27, -0.2, 0.2), (x + 0.27, x + 0.3, -0.2, 0.2), (x - 0.3, x + 0.3, -0.2, -0.17), (x - 0.3, x + 0.3, 0.17, 0.2)):
            for yy in (0.06, 0.15, 0.24):
                K.rbox(F, a, b, c, d, y + yy - 0.0, y + yy + 0.05, "H_wood_pine", r=0.0, seg=1, tn=wood)
    K.rbox(F, -0.25, 0.25, -0.15, 0.15, 0.06, 0.12, "H_wood_oak", r=0.0, seg=1, tn=(0.85, 0.65, 0.45, 1), skip=("-z",))
    K.col(F, -0.33, 0.33, -0.23, 0.23, 0.3 * n, name="crates")
