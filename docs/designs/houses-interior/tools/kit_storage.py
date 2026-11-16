"""Storage of the houses kit: 자개장, built-in wardrobe, wardrobe, bookcase (with real books), wall-high library wall with a rail
ladder, wall shelf with dishes, glass-door dish cabinet, floating shoe cabinet (LED), 반닫이, 문갑, toy storage, trunk, 병풍, 족자."""
import math
import random
from kit_core import *   # noqa: F401,F403
from kit_core import S
from kit_seating import WOOD, BLK

# atlas cell -> uv (make_house_textures.CELLS has 32 colours in the first half of the 8x8 atlas)
def acell(i):
    r, c = divmod(i % 64, 8)
    return ((c + 0.5) / 8, 1 - (r + 0.5) / 8)


BOOK_CELLS = [2, 3, 4, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 20, 21, 22, 26, 27, 30, 0, 1, 24, 7]


def books(F, x0, x1, z, y, hmax=0.30, hmin=0.2, depth=0.22, seed=1, fill=0.9, lean_end=True):
    """a row of books standing on y between x0..x1 (spine out toward +z at z + depth/2): real boxes, varied height/thickness/colour."""
    rnd = random.Random(seed)
    x = x0 + 0.01
    while x < x1 - 0.03:
        th = rnd.uniform(0.018, 0.045)
        if x + th > x1 - 0.01:
            break
        h = rnd.uniform(hmin, hmax)
        d = depth * rnd.uniform(0.8, 1.0)
        uvc = acell(rnd.choice(BOOK_CELLS))
        rbox(F, x, x + th, z - d / 2, z + d / 2, y, y + h, "H_atlas", r=0.0, seg=1, uvc=uvc)
        # white page block (front edge strip)
        x += th + 0.001
        if rnd.random() > fill:
            x += rnd.uniform(0.03, 0.12)


def books_stack(F, cx, cz, y, n=4, seed=2, w=0.2, d=0.15):
    rnd = random.Random(seed)
    for i in range(n):
        th = rnd.uniform(0.02, 0.04)
        rbox(F, cx - w / 2 + rnd.uniform(-0.01, 0.01), cx + w / 2 + rnd.uniform(-0.01, 0.01), cz - d / 2, cz + d / 2, y, y + th, "H_atlas", r=0.0, seg=1,
             uvc=acell(rnd.choice(BOOK_CELLS)))
        y += th


def wardrobe_jagae(F, w=1.9, d=0.58, tn=None):
    """자개장 (4번 집): black lacquer 장롱 in two stacked sections - upper 4 hinged doors with mother-of-pearl flowers and brass fittings, lower 12 small drawers + 2 big ones; brass hardware, a stepped plinth, a moulded top."""
    hw, hd = w / 2, d / 2
    # plinth
    rbox(F, -hw, hw, -hd, hd, 0.0, 0.1, "H_lacquer", r=0.01, seg=2)
    rbox(F, -hw - 0.015, hw + 0.015, -hd - 0.01, hd + 0.015, 0.1, 0.13, "H_lacquer", r=0.008, seg=2)
    brass = (0.95, 0.75, 0.35, 1)
    # lower section: 12 drawers (3 rows x 4) + body
    rbox(F, -hw, hw, -hd, hd, 0.13, 0.95, "H_lacquer", r=0.008, seg=2)
    dw = w / 4
    for r_ in range(3):
        for c_ in range(4):
            x0 = -hw + c_ * dw + 0.02
            x1 = x0 + dw - 0.04
            y0 = 0.17 + r_ * 0.25
            y1 = y0 + 0.22
            rbox(F, x0, x1, hd, hd + 0.018, y0, y1, "H_jagae", r=0.003, seg=1, uvc=None, grain=None, tile=1.0) if False else None
            f = rbox(F, x0, x1, hd, hd + 0.018, y0, y1, "H_lacquer", r=0.004, seg=1)
            # pearl inlay panel on the drawer face
            gface(F, [(x0 + 0.02, hd + 0.0185, y0 + 0.02), (x1 - 0.02, hd + 0.0185, y0 + 0.02), (x1 - 0.02, hd + 0.0185, y1 - 0.02),
                      (x0 + 0.02, hd + 0.0185, y1 - 0.02)], "H_jagae", None, 1.0, (0, 1, 0), uv=[(0.1, 0.4 + 0.1 * (r_ % 3)), (0.9, 0.4 + 0.1 * (r_ % 3)),
                                                                                                    (0.9, 0.6 + 0.1 * (r_ % 3)), (0.1, 0.6 + 0.1 * (r_ % 3))])
            cx = (x0 + x1) / 2
            lathe(F, cx, hd + 0.018, (y0 + y1) / 2 - 0.0, [(0, 0)], "H_metal", 4) if False else None
            rbox(F, cx - 0.045, cx + 0.045, hd + 0.018, hd + 0.03, (y0 + y1) / 2 - 0.008, (y0 + y1) / 2 + 0.008, "H_metal", r=0.003, seg=1, tn=brass)
    # upper section: 4 doors (2 pairs)
    rbox(F, -hw + 0.01, hw - 0.01, -hd + 0.01, hd - 0.01, 0.95, 1.95, "H_lacquer", r=0.008, seg=2)
    rbox(F, -hw - 0.012, hw + 0.012, -hd - 0.008, hd + 0.012, 1.95, 2.0, "H_lacquer", r=0.008, seg=2)
    rbox(F, -hw - 0.025, hw + 0.025, -hd - 0.018, hd + 0.025, 2.0, 2.05, "H_lacquer", r=0.008, seg=2)
    dw = w / 4
    for c_ in range(4):
        x0 = -hw + c_ * dw + 0.015
        x1 = x0 + dw - 0.03
        rbox(F, x0, x1, hd - 0.01, hd + 0.014, 0.98, 1.93, "H_lacquer", r=0.004, seg=1)
        gface(F, [(x0 + 0.03, hd + 0.0145, 1.01), (x1 - 0.03, hd + 0.0145, 1.01), (x1 - 0.03, hd + 0.0145, 1.9), (x0 + 0.03, hd + 0.0145, 1.9)],
              "H_jagae", None, 1.0, (0, 1, 0), uv=[(0.04, 0.02), (0.96, 0.02), (0.96, 0.98), (0.04, 0.98)])
        # butterfly hinge/lock plates in brass
        px = x1 - 0.05 if c_ % 2 == 0 else x0 + 0.05
        for y in (1.2, 1.45):
            rbox(F, px - 0.02, px + 0.02, hd + 0.014, hd + 0.022, y - 0.03, y + 0.03, "H_metal", r=0.003, seg=1, tn=brass)
        for y in (1.05, 1.85):
            rbox(F, (x0 if c_ % 2 else x1) - 0.015, (x0 if c_ % 2 else x1) + 0.015, hd + 0.014, hd + 0.02, y, y + 0.1, "H_metal", r=0.002, seg=1, tn=brass)
    col(F, -hw, hw, -hd, hd, 2.05, name="wardrobe")


def wardrobe_builtin(F, w=2.7, d=0.6, h=2.4, tn=None, bays=3):
    """붙박이장: floor-to-ceiling flush doors in 3 bays with slim vertical handle grooves, a top cornice, a plinth."""
    tn = tn or PAL["paint_white"]
    hw, hd = w / 2, d / 2
    rbox(F, -hw, hw, -hd, hd, 0.0, 0.08, "H_paint", r=0.004, seg=1, tn=(0.45, 0.45, 0.45, 1))
    rbox(F, -hw, hw, -hd, hd - 0.02, 0.08, h, "H_paint", r=0.004, seg=1, tn=tn)
    bw = w / bays
    for i in range(bays):
        x0 = -hw + i * bw + 0.006
        x1 = x0 + bw - 0.012
        for (ya, yb) in ((0.09, 1.56), (1.575, h - 0.02)):
            rbox(F, x0, x1, hd - 0.02, hd, ya, yb, "H_paint", r=0.004, seg=1, tn=tn)
        hx = x1 - 0.06 if i % 2 == 0 else x0 + 0.06
        rbox(F, hx - 0.008, hx + 0.008, hd, hd + 0.012, 1.0, 1.4, "H_metal", r=0.004, seg=1, tn=(0.75, 0.75, 0.75, 1))
    col(F, -hw, hw, -hd, hd, h, name="wardrobe")


def wardrobe_wood(F, w=1.2, d=0.55, h=1.9, tn=None):
    """옷장: wooden 2-door wardrobe on short feet with a drawer base."""
    tn = tn or WOOD["pine"]
    hw, hd = w / 2, d / 2
    for (sx, sz) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        sqleg(F, sx * (hw - 0.04), sz * (hd - 0.04), 0.0, 0.1, 0.05, 0.04, "H_wood_oak", tn) if False else \
            rbox(F, sx * (hw - 0.04) - 0.03, sx * (hw - 0.04) + 0.03, sz * (hd - 0.04) - 0.03, sz * (hd - 0.04) + 0.03, 0.0, 0.1, "H_wood_oak", r=0.006, seg=1, tn=tn)
    rbox(F, -hw, hw, -hd, hd, 0.1, h, "H_wood_oak", r=0.008, seg=2, tn=tn, grain=(0, 0, 1))
    rbox(F, -hw - 0.015, hw + 0.015, -hd - 0.01, hd + 0.015, h, h + 0.035, "H_wood_oak", r=0.008, seg=2, tn=tn)
    for i in range(2):
        x0 = -hw + i * hw + 0.012
        x1 = x0 + hw - 0.024
        rbox(F, x0, x1, hd, hd + 0.018, 0.55, h - 0.06, "H_wood_oak", r=0.005, seg=1, tn=tuple(c * 1.05 for c in tn[:3]) + (1,), grain=(0, 0, 1))
        hx = x1 - 0.05 if i == 0 else x0 + 0.05
        rbox(F, hx - 0.01, hx + 0.01, hd + 0.018, hd + 0.04, 0.95, 1.2, "H_wood_oak", r=0.005, seg=1, tn=WOOD["walnut"])
    for i in range(2):
        rbox(F, -hw + 0.012, hw - 0.012, hd, hd + 0.018, 0.14 + i * 0.2, 0.32 + i * 0.2, "H_wood_oak", r=0.005, seg=1, tn=tuple(c * 0.97 for c in tn[:3]) + (1,))
        rbox(F, -0.06, 0.06, hd + 0.018, hd + 0.03, 0.24 + i * 0.2, 0.255 + i * 0.2, "H_metal", r=0.003, seg=1, tn=(0.7, 0.6, 0.4, 1))
    col(F, -hw, hw, -hd, hd, h, name="wardrobe")


def bookcase(F, w=1.0, d=0.3, h=2.0, shelves=5, tn=None, seed=3, fill=0.85, open_back=False):
    """책장: side boards, fixed shelves, a back panel, a toe-kick, books standing on every shelf (real boxes) with a few leaning/stacked."""
    tn = tn or WOOD["natural"]
    hw, hd = w / 2, d / 2
    for sx in (-1, 1):
        rbox(F, sx * hw - (0.02 if sx > 0 else 0.0) - (0.0 if sx > 0 else 0.0) + (0.0 if sx > 0 else 0.0), sx * hw + (0.0 if sx > 0 else 0.02), -hd, hd, 0.0, h, "H_wood_oak", r=0.004, seg=1, tn=tn, grain=(0, 0, 1)) if False else None
    rbox(F, -hw, -hw + 0.022, -hd, hd, 0.0, h, "H_wood_oak", r=0.004, seg=1, tn=tn, grain=(0, 0, 1))
    rbox(F, hw - 0.022, hw, -hd, hd, 0.0, h, "H_wood_oak", r=0.004, seg=1, tn=tn, grain=(0, 0, 1))
    rbox(F, -hw + 0.02, hw - 0.02, -hd, -hd + 0.01, 0.0, h, "H_wood_oak", r=0.0, seg=1, tn=tuple(c * 0.85 for c in tn[:3]) + (1,))
    rbox(F, -hw + 0.02, hw - 0.02, -hd + 0.01, hd - 0.02, 0.0, 0.08, "H_wood_oak", r=0.004, seg=1, tn=tn)
    gap = (h - 0.08 - 0.022) / shelves
    for k in range(shelves + 1):
        y = 0.08 + k * gap if k < shelves else h - 0.022
        rbox(F, -hw + 0.02, hw - 0.02, -hd + 0.01, hd, y, y + 0.022, "H_wood_oak", r=0.004, seg=1, tn=tn, grain=(1, 0, 0))
        if k < shelves:
            books(F, -hw + 0.03, hw - 0.03, 0.0, y + 0.022, hmax=min(0.34, gap - 0.04), hmin=0.2, depth=d - 0.08, seed=seed * 10 + k, fill=fill)
    col(F, -hw, hw, -hd, hd, h, name="bookcase", camera=True)


def bookwall(F, w=3.6, d=0.34, h=3.6, tn=None, seed=7, ladder=True):
    """서재 벽 책장 (6번 집): ceiling-high bookcase wall in 3 m-wide bays, a rail near the top and a rolling ladder."""
    tn = tn or WOOD["walnut"]
    n = max(1, int(round(w / 1.0)))
    bw = w / n
    for i in range(n):
        G = F.sub(-w / 2 + (i + 0.5) * bw, 0, 0, 0)
        bookcase(G, w=bw, d=d, h=h, shelves=11, tn=tn, seed=seed + i, fill=0.9)
    if ladder:
        rbox(F, -w / 2, w / 2, d / 2 + 0.02, d / 2 + 0.05, 3.3, 3.34, "H_metal", r=0.003, seg=1, tn=BLK)
        lx = -w / 2 + 0.7
        for sx in (-0.2, 0.2):
            rbox(F, lx + sx - 0.015, lx + sx + 0.015, d / 2 + 0.1, d / 2 + 0.15, 0.0, 3.3, "H_wood_oak", r=0.004, seg=1, tn=tn, grain=(0, 0, 1)) if False else \
                tube(F, [(lx + sx, d / 2 + 0.28, 0.0), (lx + sx, d / 2 + 0.05, 3.3)], 0.02, "H_wood_oak", 8, tn=tn)
        for k in range(9):
            t = (k + 0.6) / 9
            tube(F, [(lx - 0.2, d / 2 + 0.28 - 0.23 * t, 3.3 * t), (lx + 0.2, d / 2 + 0.28 - 0.23 * t, 3.3 * t)], 0.014, "H_wood_oak", 8, tn=tn, caps=True)
        rbox(F, lx - 0.25, lx + 0.25, d / 2 + 0.03, d / 2 + 0.07, 3.3, 3.34, "H_metal", r=0.003, seg=1, tn=BLK)
    col(F, -w / 2, w / 2, -d / 2, d / 2, h, name="bookwall", camera=True)


def dish(F, cx, cz, y, r=0.1, h=0.03, tn=None, plate=True):
    tn = tn or (0.95, 0.95, 0.92, 1)
    lathe(F, cx, cz, y, [(0, 0.0), (r * 0.5, 0.0), (r * 0.55, 0.005), (r, h), (r * 0.98, h + 0.004), (r * 0.5, 0.008), (0, 0.006)], "H_ceramic", 14, tn=tn)


def bowl(F, cx, cz, y, r=0.065, tn=None):
    tn = tn or (0.85, 0.9, 0.93, 1)
    lathe(F, cx, cz, y, [(0, 0.0), (r * 0.45, 0.0), (r * 0.5, 0.01), (r, 0.06), (r * 1.02, 0.065), (r * 0.96, 0.066), (r * 0.5, 0.02), (0, 0.016)],
          "H_ceramic", 20, tn=tn)


def mug(F, cx, cz, y, tn=None, r=0.04, h=0.095):
    tn = tn or (0.9, 0.9, 0.88, 1)
    lathe(F, cx, cz, y, [(0, 0.0), (r, 0.0), (r * 1.04, h), (r * 0.9, h), (r * 0.88, 0.01), (0, 0.008)], "H_ceramic", 14, tn=tn)
    tube(F, [(cx + r, cz, y + h * 0.8), (cx + r * 1.6, cz, y + h * 0.75), (cx + r * 1.6, cz, y + h * 0.3), (cx + r, cz, y + h * 0.2)], 0.005, "H_ceramic", 6, tn=tn)


def wall_shelf(F, w=1.4, d=0.24, rows=2, tn=None, dishes=True):
    """벽 선반 (3번 집): two thick oak boards on brass-black brackets with stacked plates, bowls and mugs on them."""
    tn = tn or WOOD["natural"]
    for r_ in range(rows):
        y = 0.0 + r_ * 0.4
        rbox(F, -w / 2, w / 2, 0.0, d, y, y + 0.035, "H_wood_oak", r=0.006, seg=2, tn=tn)
        for x in (-w / 2 + 0.15, w / 2 - 0.15):
            rbox(F, x - 0.01, x + 0.01, 0.0, 0.01, y - 0.17, y, "H_metal", r=0.002, seg=1, tn=BLK)
            tube(F, [(x, 0.01, y - 0.0), (x, d - 0.03, y - 0.0)], 0.008, "H_metal", 6, tn=BLK, caps=False) if False else None
            tube(F, [(x, 0.01, y - 0.15), (x, d - 0.02, y - 0.0)], 0.007, "H_metal", 6, tn=BLK)
        if dishes:
            rnd = random.Random(5 + r_)
            for k in range(3):
                for j in range(3):
                    dish(F, -w / 2 + 0.2 + k * 0.2, d * 0.5, y + 0.035 + j * 0.014, 0.09)
            for k in range(3):
                bowl(F, 0.05 + k * 0.16, d * 0.5, y + 0.035, 0.07)
            for k in range(3):
                mug(F, w / 2 - 0.18 + k * 0.05 * 0, d * 0.35 + k * 0.0, y + 0.035, (0.9 - 0.1 * k, 0.8, 0.7 + 0.1 * k, 1)) if k == 0 else None
            for k in range(2):
                mug(F, w / 2 - 0.12 - k * 0.1, d * 0.5, y + 0.035, (0.85, 0.65 + 0.15 * k, 0.5, 1))


def cabinet_glass(F, w=1.2, d=0.42, h=1.9, tn=None):
    """그릇장 (3번 집): wooden dish cabinet - lower closed doors, upper glass doors with shelves of plates and bowls, mullions."""
    tn = tn or (0.9, 0.62, 0.4, 1)
    hw, hd = w / 2, d / 2
    rbox(F, -hw, hw, -hd, hd, 0.0, 0.88, "H_wood_oak", r=0.008, seg=2, tn=tn)
    rbox(F, -hw - 0.01, hw + 0.01, -hd - 0.005, hd + 0.01, 0.88, 0.92, "H_wood_oak", r=0.008, seg=2, tn=tn)
    for sx in (-1, 1):
        rbox(F, sx * hw - 0.02 * (1 if sx > 0 else 0) - (0.0 if sx > 0 else 0.0) + (0.0), sx * hw + (0.0 if sx > 0 else 0.0) + 0.0, -hd + 0.0, hd, 0.92, h, "H_wood_oak", r=0.0, seg=1, tn=tn) if False else None
    rbox(F, -hw + 0.01, -hw + 0.04, -hd + 0.02, hd - 0.01, 0.92, h, "H_wood_oak", r=0.004, seg=1, tn=tn, grain=(0, 0, 1))
    rbox(F, hw - 0.04, hw - 0.01, -hd + 0.02, hd - 0.01, 0.92, h, "H_wood_oak", r=0.004, seg=1, tn=tn, grain=(0, 0, 1))
    rbox(F, -hw + 0.01, hw - 0.01, -hd + 0.02, hd - 0.01, h - 0.04, h, "H_wood_oak", r=0.004, seg=1, tn=tn)
    rbox(F, -hw + 0.04, hw - 0.04, -hd + 0.02, -hd + 0.03, 0.92, h - 0.04, "H_wood_oak", r=0.0, seg=1, tn=tuple(c * 0.8 for c in tn[:3]) + (1,))
    for k in (1, 2):
        y = 0.92 + k * (h - 0.92) / 3
        rbox(F, -hw + 0.04, hw - 0.04, -hd + 0.03, hd - 0.03, y, y + 0.02, "H_wood_oak", r=0.003, seg=1, tn=tn)
        for j in range(5):
            dish(F, -hw + 0.12 + j * 0.2 * 0.8, 0.0, y + 0.02 + (0 if j % 2 else 0.0), 0.085) if False else dish(F, -hw + 0.15 + j * 0.2, 0.0, y + 0.02, 0.085)
        bowl(F, hw - 0.2, 0.0, y + 0.02, 0.07)
    for i in range(2):
        x0 = -hw + i * hw + 0.012
        x1 = x0 + hw - 0.024
        rbox(F, x0, x1, hd - 0.0, hd + 0.018, 0.04, 0.84, "H_wood_oak", r=0.005, seg=1, tn=tuple(c * 1.06 for c in tn[:3]) + (1,))
        rbox(F, (x0 + x1) / 2 + (0.2 if i == 0 else -0.2) - 0.01, (x0 + x1) / 2 + (0.2 if i == 0 else -0.2) + 0.01, hd + 0.018, hd + 0.03, 0.4, 0.55,
             "H_wood_oak", r=0.003, seg=1, tn=WOOD["walnut"])
        # glass doors with frame
        for (a, b) in ((x0, x0 + 0.04), (x1 - 0.04, x1)):
            rbox(F, a, b, hd - 0.0, hd + 0.018, 0.96, h - 0.06, "H_wood_oak", r=0.003, seg=1, tn=tn, grain=(0, 0, 1))
        rbox(F, x0, x1, hd - 0.0, hd + 0.018, 0.96, 1.0, "H_wood_oak", r=0.003, seg=1, tn=tn)
        rbox(F, x0, x1, hd - 0.0, hd + 0.018, h - 0.1, h - 0.06, "H_wood_oak", r=0.003, seg=1, tn=tn)
        gface(F, [(x0 + 0.04, hd + 0.01, 1.0), (x1 - 0.04, hd + 0.01, 1.0), (x1 - 0.04, hd + 0.01, h - 0.1), (x0 + 0.04, hd + 0.01, h - 0.1)], "H_glass", (1, 0, 0), 1.0, (0, 1, 0))
    col(F, -hw, hw, -hd, hd, h, name="cabinet")


def shoe_cabinet(F, w=1.6, d=0.32, h=0.9, tn=None):
    """띄움 신발장 (현관): floating wall cabinet with flip-down shoe drawers on a recessed plinth lit by a warm LED strip (간접등)."""
    tn = tn or PAL["paint_white"]
    hw, hd = w / 2, d / 2
    rbox(F, -hw + 0.03, hw - 0.03, -hd, hd - 0.03, 0.0, 0.14, "H_paint", r=0.003, seg=1, tn=(0.3, 0.3, 0.3, 1))      # recessed plinth (dark)
    rbox(F, -hw + 0.02, hw - 0.02, hd - 0.03 - 0.05, hd - 0.03, 0.01, 0.02, "H_lamp", r=0.0, seg=1)                     # LED strip under the body
    rbox(F, -hw, hw, -hd, hd, 0.15, h, "H_paint", r=0.006, seg=1, tn=tn)
    n = 3
    for i in range(n):
        x0 = -hw + i * w / n + 0.008
        x1 = -hw + (i + 1) * w / n - 0.008
        for (ya, yb) in ((0.17, 0.5), (0.52, h - 0.02)):
            rbox(F, x0, x1, hd, hd + 0.018, ya, yb, "H_wood_oak", r=0.004, seg=1, tn=WOOD["walnut"], grain=(0, 0, 1))
        rbox(F, x0 + 0.05, x1 - 0.05, hd + 0.018, hd + 0.03, 0.5, 0.515, "H_metal", r=0.003, seg=1, tn=BLK)
    light(F, "led", 0.0, 0.0, 0.05, 15.0, "#FFC890")
    col(F, -hw, hw, -hd, hd, h, name="shoe_cabinet")


def banndaji(F, w=0.95, d=0.46, h=0.85, tn=None):
    """반닫이 (7·8번 집): Korean front-opening chest, a tall wooden box with a hinged flap front, big brass lock plate and corner/edge fittings."""
    tn = tn or (0.62, 0.4, 0.26, 1)
    brass = (0.95, 0.75, 0.35, 1)
    hw, hd = w / 2, d / 2
    rbox(F, -hw, hw, -hd, hd, 0.0, h, "H_wood_oak", r=0.012, seg=2, tn=tn)
    rbox(F, -hw + 0.02, hw - 0.02, hd, hd + 0.016, 0.06, h * 0.62, "H_wood_oak", r=0.006, seg=1, tn=tuple(c * 1.1 for c in tn[:3]) + (1,))       # lower drawers
    rbox(F, -hw - 0.006, hw + 0.006, hd - 0.0, hd + 0.016, h * 0.64, h, "H_wood_oak", r=0.006, seg=1, tn=tn)                                     # flap
    rbox(F, -0.06, 0.06, hd + 0.016, hd + 0.022, h * 0.5, h * 0.82, "H_metal", r=0.004, seg=1, tn=brass)                                         # lock plate
    for sx in (-1, 1):
        for y in (0.2, 0.36, 0.5):
            rbox(F, sx * (hw * 0.7) - 0.03, sx * (hw * 0.7) + 0.03, hd + 0.016, hd + 0.022, y, y + 0.025, "H_metal", r=0.003, seg=1, tn=brass)
    for sx in (-1, 1):
        for y in (0.03, h - 0.06):
            rbox(F, sx * hw - 0.0 + (-0.03 if sx > 0 else 0.0) - 0.0, sx * hw + (0.0 if sx > 0 else 0.03), hd - 0.02, hd + 0.018, y, y + 0.05, "H_metal", r=0.003, seg=1, tn=brass)
    col(F, -hw, hw, -hd, hd, h, name="chest")


def mungap(F, w=0.9, d=0.3, h=0.6, tn=None):
    """문갑: low sliding-door cabinet, two door panels with brass pulls, small feet."""
    tn = tn or (0.62, 0.4, 0.26, 1)
    hw, hd = w / 2, d / 2
    for sx in (-1, 1):
        rbox(F, sx * (hw - 0.05) - 0.03, sx * (hw - 0.05) + 0.03, -hd + 0.03, hd - 0.03, 0.0, 0.05, "H_wood_oak", r=0.006, seg=1, tn=tn)
    rbox(F, -hw, hw, -hd, hd, 0.05, h, "H_wood_oak", r=0.01, seg=2, tn=tn)
    for i in range(2):
        x0 = -hw + i * hw + 0.015
        x1 = x0 + hw - 0.03
        rbox(F, x0, x1, hd, hd + 0.014, 0.09, h - 0.04, "H_wood_oak", r=0.004, seg=1, tn=tuple(c * 1.08 for c in tn[:3]) + (1,))
        rbox(F, (x0 + x1) / 2 - 0.02, (x0 + x1) / 2 + 0.02, hd + 0.014, hd + 0.02, h * 0.45, h * 0.6, "H_metal", r=0.003, seg=1, tn=(0.95, 0.75, 0.35, 1))
    col(F, -hw, hw, -hd, hd, h, name="chest")


def toy_shelf(F, w=1.2, d=0.34, h=0.8, tn=None):
    """장난감 정리함 (2번 집): a low cubby shelf, 2 rows x 3, each cubby with a fabric basket (6 baskets) with toys sticking out."""
    tn = tn or WOOD["pine"]
    hw, hd = w / 2, d / 2
    rbox(F, -hw, hw, -hd, hd, 0.0, 0.03, "H_wood_oak", r=0.004, seg=1, tn=tn)
    for k in range(4):
        x = -hw + k * (w - 0.025) / 3
        rbox(F, x, x + 0.025, -hd, hd, 0.03, h, "H_wood_oak", r=0.003, seg=1, tn=tn, grain=(0, 0, 1))
    for k in range(3):
        y = 0.03 + k * (h - 0.03) / 2
        rbox(F, -hw, hw, -hd, hd, y, y + 0.025, "H_wood_oak", r=0.003, seg=1, tn=tn)
    rbox(F, -hw, hw, -hd, -hd + 0.01, 0.03, h, "H_wood_oak", r=0.0, seg=1, tn=tuple(c * 0.85 for c in tn[:3]) + (1,))
    cols_ = [PAL["terracotta"], PAL["sky"], PAL["mustard"], PAL["sage"], PAL["blush"], PAL["rug_blue"]]
    k = 0
    for r_ in range(2):
        for c_ in range(3):
            cx = -hw + 0.0125 + (c_ + 0.5) * (w - 0.025) / 3
            y0 = 0.055 + r_ * (h - 0.03) / 2
            lathe(F, cx, 0.0, y0, [(0.0, 0.0), (0.12, 0.0), (0.135, 0.02), (0.14, 0.17), (0.125, 0.18), (0.12, 0.02), (0.0, 0.015)], "H_fabric", 18, tn=cols_[k], tile=0.4)
            # a toy peeking out: ball / block
            if k % 2 == 0:
                lathe(F, cx + 0.02, 0.0, y0 + 0.14, [(0, 0.0), (0.04, 0.02), (0.05, 0.05), (0.04, 0.08), (0, 0.1)], "H_plastic", 12, tn=cols_[(k + 2) % 6])
            else:
                rbox(F, cx - 0.04, cx + 0.04, -0.04, 0.04, y0 + 0.14, y0 + 0.22, "H_wood_oak", r=0.006, seg=1, tn=cols_[(k + 3) % 6])
            k += 1
    col(F, -hw, hw, -hd, hd, h, name="toy_shelf")


def trunk(F, w=0.9, d=0.5, h=0.45, tn=None):
    """트렁크: leather-look trunk with wood slats, metal corners and a latch."""
    tn = tn or (0.45, 0.32, 0.22, 1)
    hw, hd = w / 2, d / 2
    rbox(F, -hw, hw, -hd, hd, 0.0, h - 0.1, "H_wood_oak", r=0.012, seg=2, tn=tn)
    rbox(F, -hw - 0.005, hw + 0.005, -hd - 0.005, hd + 0.005, h - 0.1, h - 0.07, "H_wood_oak", r=0.008, seg=1, tn=tn)
    lathe(F.sub(0, 0, h - 0.1, 0), 0, 0, 0, [(0, 0)], "H_wood_oak", 4) if False else None
    rbox(F, -hw + 0.004, hw - 0.004, -hd + 0.004, hd - 0.004, h - 0.07, h, "H_wood_oak", r=0.04, seg=3, tn=tn, puff=0.0)
    for x in (-hw + 0.1, hw - 0.1):
        rbox(F, x - 0.02, x + 0.02, -hd - 0.008, hd + 0.008, 0.0, h, "H_wood_oak", r=0.003, seg=1, tn=(0.6, 0.45, 0.3, 1))
    for sx in (-1, 1):
        for sz in (-1, 1):
            rbox(F, sx * hw - 0.04 * sx - 0.025, sx * hw - 0.04 * sx + 0.025, sz * hd - 0.04 * sz - 0.025, sz * hd - 0.04 * sz + 0.025, 0.0, 0.05, "H_metal", r=0.003, seg=1, tn=(0.6, 0.55, 0.45, 1))
    rbox(F, -0.04, 0.04, hd, hd + 0.015, h - 0.17, h - 0.05, "H_metal", r=0.004, seg=1, tn=(0.8, 0.65, 0.35, 1))
    col(F, -hw, hw, -hd, hd, h, name="trunk")


def folding_screen(F, panels=4, pw=0.42, h=1.5, tn=None):
    """병풍 (4폭): zig-zag 4-panel folding screen, wood frames, painted silk panels (landscape colours), 5 cm folds."""
    tn = tn or (0.5, 0.33, 0.22, 1)
    total = panels * pw
    for i in range(panels):
        x0 = -total / 2 + i * pw
        z = 0.06 * (i % 2)
        z2 = 0.06 * ((i + 1) % 2)
        silk = [(0.85, 0.8, 0.6, 1), (0.7, 0.75, 0.62, 1), (0.85, 0.8, 0.6, 1), (0.7, 0.75, 0.62, 1)][i % 4]
        for (a, b, za, zb) in ((x0, x0 + pw, z, z2),):
            gface(F, [(a, za, 0.04), (b, zb, 0.04), (b, zb, h - 0.04), (a, za, h - 0.04)], "H_fabric", (1, 0, 0), 0.4, (0, 1, 0), tn=silk)
            gface(F, [(a, za, 0.04), (b, zb, 0.04), (b, zb, h - 0.04), (a, za, h - 0.04)], "H_fabric", (1, 0, 0), 0.4, (0, -1, 0), tn=silk)
            # frame bars along the panel edges
            for (xx, zz) in ((a, za), (b, zb)):
                rbox(F, xx - 0.015, xx + 0.015, zz - 0.015, zz + 0.015, 0.0, h, "H_wood_oak", r=0.004, seg=1, tn=tn, grain=(0, 0, 1))
            for (y0, y1) in ((0.0, 0.05), (h - 0.05, h)):
                bar(F, (a, za, (y0 + y1) / 2), (b, zb, (y0 + y1) / 2), 0.03, y1 - y0, "H_wood_oak", tn=tn)
            # a painted branch motif: dark ink strokes
            bar(F, (a + 0.08, za + (zb - za) * 0.2 + 0.003, 0.3 + 0.2 * i), (b - 0.08, za + (zb - za) * 0.8 + 0.003, 0.9 + 0.1 * i), 0.012, 0.012, "H_lacquer")
    col(F, -total / 2, total / 2, -0.03, 0.1, h, name="screen")


def scroll_hanging(F, w=0.35, h=1.3, tn=None):
    """족자: hanging scroll on the wall, silk mount + paper painting, wooden rod top and bottom with knobs (frame at wall: local z = 0 wall plane, +z out)."""
    silk = (0.4, 0.45, 0.35, 1)
    rbox(F, -w / 2, w / 2, 0.0, 0.006, 0.0, h, "H_fabric", r=0.0, seg=1, tn=silk)
    rbox(F, -w / 2 + 0.05, w / 2 - 0.05, 0.006, 0.008, 0.2, h - 0.25, "H_paper", r=0.0, seg=1)
    bar(F, (-w / 2 + 0.09, 0.009, 0.4), (w / 2 - 0.1, 0.009, 0.95), 0.012, 0.012, "H_lacquer")
    for y in (h - 0.03, 0.0):
        tube(F, [(-w / 2 - 0.03, 0.01, y), (w / 2 + 0.03, 0.01, y)], 0.012, "H_wood_oak", 8, tn=(0.35, 0.25, 0.2, 1))
    for sx in (-1, 1):
        lathe(F.sub(sx * (w / 2 + 0.03), 0.01, 0, 0), 0, 0, 0.0, [(0, 0)], "H_wood_oak", 4) if False else None
    tube(F, [(-0.05, 0.012, h - 0.03), (0.0, 0.01, h + 0.08), (0.05, 0.012, h - 0.03)], 0.004, "H_paint", 5, tn=(0.9, 0.85, 0.7, 1), caps=False)


from kit_seating import sqleg  # noqa: E402,F401

PIECES = [
    dict(name="wardrobe_jagae", fn=wardrobe_jagae, group="storage", ref="06_grandparents_room", cam=dict(az=25, el=10, dist=1.7)),
    dict(name="wardrobe_builtin", fn=wardrobe_builtin, group="storage", ref="15_master_bedroom", cam=dict(az=25, el=10, dist=1.7)),
    dict(name="wardrobe_wood", fn=wardrobe_wood, group="storage", ref="15_master_bedroom", cam=dict(az=30, el=12, dist=1.7)),
    dict(name="bookcase", fn=bookcase, group="storage", ref="04_study", cam=dict(az=25, el=10, dist=1.7)),
    dict(name="bookwall", fn=bookwall, kw=dict(w=3.0), group="storage", ref="04_study", cam=dict(az=20, el=8, dist=1.7)),
    dict(name="wall_shelf", fn=wall_shelf, group="storage", ref="03_farm_kitchen", cam=dict(az=25, el=10, dist=1.7)),
    dict(name="cabinet_glass", fn=cabinet_glass, group="storage", ref="03_farm_kitchen", cam=dict(az=25, el=12, dist=1.7)),
    dict(name="shoe_cabinet", fn=shoe_cabinet, group="storage", ref="16_genkwan", cam=dict(az=25, el=15, dist=1.7)),
    dict(name="banndaji", fn=banndaji, group="storage", ref="07_hanok_maru", cam=dict(az=30, el=18)),
    dict(name="mungap", fn=mungap, group="storage", ref="17_sarangbang", cam=dict(az=30, el=18)),
    dict(name="toy_shelf", fn=toy_shelf, group="storage", ref="05_kids_room", cam=dict(az=25, el=15)),
    dict(name="trunk", fn=trunk, group="storage", ref="09_attic", cam=dict(az=30, el=22)),
    dict(name="folding_screen", fn=folding_screen, group="storage", ref="17_sarangbang", cam=dict(az=25, el=12)),
    dict(name="scroll_hanging", fn=scroll_hanging, group="storage", ref="17_sarangbang", cam=dict(az=15, el=5)),
]
