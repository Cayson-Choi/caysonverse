"""HB (houses 6-10) pieces: lighter / better versions of weak kit pieces and the special furniture of houses 6-10.
Importing this module patches kit_storage.books with a lighter row (only the faces a player can see) so the kit's bookcase / wall
shelves get cheaper; bookwall_lite / bookcase_lite are the study's ceiling-high library (~0.7k triangles per metre instead of 2.7k).
"""
import math
import random

import kit_core as K
from kit_core import *   # noqa: F401,F403
import kit_storage as ST
import kit_decor as DE
from kit_storage import acell, BOOK_CELLS


# ---------------------------------------------------------------------------------------------------- lighter books ----
def _row(rnd, x0, x1, hmin, hmax, fill, thmin=0.034, thmax=0.074):
    out, x = [], x0 + 0.01
    while x < x1 - 0.03:
        th = rnd.uniform(thmin, thmax)
        if x + th > x1 - 0.01:
            break
        out.append([x, th, rnd.uniform(hmin, hmax), rnd.choice(BOOK_CELLS)])
        x += th + 0.001
        if rnd.random() > fill:
            x += rnd.uniform(0.04, 0.14)
    return out


def books_lite(F, x0, x1, z, y, hmax=0.30, hmin=0.2, depth=0.22, seed=1, fill=0.9, lean_end=True, front=None):
    """a row of books drawn with the faces a player can see only: the spine, the top (below 2.2 m), and a side where the book is taller than
    its neighbour. z = the middle of the row's depth (spines at z + depth / 2); `front` overrides the spine plane."""
    rnd = random.Random(seed)
    bk = _row(rnd, x0, x1, hmin, hmax, fill, *((0.12, 0.3) if y > 2.4 else ()))   # above reach: sets / runs of books
    zf = z + depth / 2 if front is None else front
    zb = zf - depth * rnd.uniform(0.85, 1.0)
    for i, (x, th, h, c) in enumerate(bk):
        uvc = acell(c)
        d = (zf - zb) * (0.9 + 0.1 * ((i * 7) % 3) / 2)
        z0 = zf - d
        K.gface(F, [(x, zf, y), (x + th, zf, y), (x + th, zf, y + h), (x, zf, y + h)], "H_atlas", None, 1.0, (0, 1, 0), uv=[uvc] * 4)
        if y < 1.7:
            K.gface(F, [(x, z0, y + h), (x + th, z0, y + h), (x + th, zf, y + h), (x, zf, y + h)], "H_atlas", None, 1.0, (0, 0, 1), uv=[uvc] * 4)
        hl = bk[i - 1][2] if i > 0 and abs(bk[i - 1][0] + bk[i - 1][1] + 0.001 - x) < 0.01 else 0.0
        hr = bk[i + 1][2] if i + 1 < len(bk) and abs(x + th + 0.001 - bk[i + 1][0]) < 0.01 else 0.0
        if y > 2.4:
            continue
        if h > hr + 0.004:
            K.gface(F, [(x + th, z0, y + hr), (x + th, zf, y + hr), (x + th, zf, y + h), (x + th, z0, y + h)], "H_atlas", None, 1.0, (1, 0, 0), uv=[uvc] * 4)
        if h > hl + 0.004:
            K.gface(F, [(x, z0, y + hl), (x, zf, y + hl), (x, zf, y + h), (x, z0, y + h)], "H_atlas", None, 1.0, (-1, 0, 0), uv=[uvc] * 4)


def bookcase_lite(F, w=1.0, d=0.32, h=2.0, shelves=5, tn=None, seed=3, fill=0.92, y_from=0.08, name="bookcase"):
    """책장 bay with plain-box boards (no bevel - the boards are 2 cm thin) and lighter books; shelf gap = (h - y_from) / shelves."""
    tn = tn or ST.WOOD["walnut"]
    hw, hd = w / 2, d / 2
    dark = tuple(c * 0.8 for c in tn[:3]) + (1,)
    K.rbox(F, -hw, -hw + 0.022, -hd, hd, 0.0, h, "H_wood_oak", r=0.0, seg=1, tn=tn, grain=(0, 0, 1), skip=("-z",))
    K.rbox(F, hw - 0.022, hw, -hd, hd, 0.0, h, "H_wood_oak", r=0.0, seg=1, tn=tn, grain=(0, 0, 1), skip=("-z",))
    K.gface(F, [(-hw + 0.022, -hd + 0.012, 0.0), (hw - 0.022, -hd + 0.012, 0.0), (hw - 0.022, -hd + 0.012, h), (-hw + 0.022, -hd + 0.012, h)],
            "H_wood_oak", (1, 0, 0), 1.0, (0, 1, 0), tn=dark)
    K.rbox(F, -hw + 0.022, hw - 0.022, -hd + 0.012, hd - 0.01, 0.0, y_from, "H_wood_oak", r=0.0, seg=1, tn=tn, skip=("-z", "+x", "-x"))
    gap = (h - y_from - 0.022) / shelves
    for k in range(shelves + 1):
        y = y_from + k * gap if k < shelves else h - 0.022
        K.rbox(F, -hw + 0.022, hw - 0.022, -hd + 0.012, hd, y, y + 0.022, "H_wood_oak", r=0.0, seg=1, tn=tn, grain=(1, 0, 0),
               bottom=(y > 1.2), skip=("-z", "+x", "-x"))
        if k < shelves:
            hm = min(0.40, gap - 0.04)
            books_lite(F, -hw + 0.03, hw - 0.03, 0.0, y + 0.022, hmax=hm, hmin=min(0.2, hm - 0.02), depth=d - 0.07, seed=seed * 10 + k, fill=fill,
                       front=hd - 0.035)
    K.col(F, -hw, hw, -hd, hd, h, name=name, camera=True)


def bookwall_lite(F, w=3.6, d=0.34, h=3.5, tn=None, seed=7, ladder=False, ladder_x=0.7, bay=1.05, shelves=None, y_from=0.08):
    """ceiling-high library wall: bays of ~1.05 m of bookcase_lite side by side (one collider), optional rail + rolling ladder"""
    tn = tn or ST.WOOD["walnut"]
    n = max(1, int(round(w / bay)))
    bw = w / n
    shelves = shelves or int((h - y_from) / 0.3)
    for i in range(n):
        G = F.sub(-w / 2 + (i + 0.5) * bw, 0, 0, 0)
        bookcase_lite(G, w=bw, d=d, h=h, shelves=shelves, tn=tn, seed=seed + i, y_from=y_from, name="bookwall_bay")
    K.S.cols = [c for c in K.S.cols if c["name"] != "bookwall_bay"]
    if ladder:
        BLK_ = (0.14, 0.14, 0.15, 1)
        K.rbox(F, -w / 2, w / 2, d / 2 + 0.02, d / 2 + 0.05, h - 0.2, h - 0.17, "H_metal", r=0.003, seg=1, tn=BLK_)
        lx = -w / 2 + ladder_x
        for sx in (-0.2, 0.2):
            K.tube(F, [(lx + sx, d / 2 + 0.28, 0.0), (lx + sx, d / 2 + 0.05, h - 0.2)], 0.02, "H_wood_oak", 8, tn=tn)
        for k in range(9):
            t = (k + 0.6) / 9
            K.tube(F, [(lx - 0.2, d / 2 + 0.28 - 0.23 * t, (h - 0.2) * t), (lx + 0.2, d / 2 + 0.28 - 0.23 * t, (h - 0.2) * t)], 0.014, "H_wood_oak", 8, tn=tn)
        K.rbox(F, lx - 0.25, lx + 0.25, d / 2 + 0.03, d / 2 + 0.07, h - 0.2, h - 0.16, "H_metal", r=0.003, seg=1, tn=BLK_)
    K.col(F, -w / 2, w / 2, -d / 2, d / 2, h, name="bookwall", camera=True)


ST.books = books_lite


# ---------------------------------------------------------------------------------------------- cheaper primitives ----
_rbox_orig = K.rbox if not getattr(K.rbox, '_lite', False) else K.rbox


def rbox_lite(F, x0, x1, z0, z1, y0, y1, m, r=0.01, seg=2, **kw):
    """kit rbox without the bevel where it cannot be seen: radii <= 4 mm become plain boxes, <= 12 mm one bevel segment"""
    if m == "H_metal" and abs(x1 - x0) <= 0.02 and abs(z1 - z0) <= 0.02 and (y1 - y0) > 0.25 and not kw.get("skip"):
        # a thin vertical bar (stair baluster): two crossed quads instead of a box (4 triangles instead of 10)
        cx, cz, hx, hz = (x0 + x1) / 2, (z0 + z1) / 2, abs(x1 - x0) / 2, abs(z1 - z0) / 2
        tnn = kw.get("tn")
        K.gface(F, [(cx - hx, cz, y0), (cx + hx, cz, y0), (cx + hx, cz, y1), (cx - hx, cz, y1)], m, (0, 0, 1), 1.0, (0, 1, 0), tn=tnn)
        K.gface(F, [(cx, cz - hz, y0), (cx, cz + hz, y0), (cx, cz + hz, y1), (cx, cz - hz, y1)], m, (0, 0, 1), 1.0, (1, 0, 0), tn=tnn)
        return []
    if r <= 0.0045:
        r = 0.0
    elif r <= 0.012 and seg > 1:
        seg = 1
    return _rbox_orig(F, x0, x1, z0, z1, y0, y1, m, r=r, seg=seg, **kw)


def curtain_lite(W, s0, s1, y_top, y_bot, folds=8, z=0.10, amp=0.035, tn=None, m="H_fabric", rod=True, panels=2, gap=0.0):
    """pleated curtain, one-sided (the back never faces the room), 20 columns per panel, rod + finials + a few rings"""
    tn = tn or PAL["cream"]
    width = s1 - s0
    for pi_ in range(panels):
        a = s0 + pi_ * width / panels
        b = s0 + (pi_ + 1) * width / panels
        if panels == 2:
            if pi_ == 0:
                b -= gap
            else:
                a += gap
        nf = max(2, int(folds / panels))
        n = max(8, int((b - a) / 0.045))
        cols = []
        for i in range(n + 1):
            u = i / n
            cols.append((a + (b - a) * u, z + amp * math.sin(u * nf * 2 * math.pi)))
        for i in range(n):
            (xa, za), (xb, zb) = cols[i], cols[i + 1]
            K.gface(W, [(xa, za, y_bot), (xb, zb, y_bot), (xb, zb, y_top), (xa, za, y_top)], m, (1, 0, 0), 0.6, (0, 1, 0), tn=tn, smooth=True)
    if rod:
        dk = (0.18, 0.18, 0.18, 1)
        K.tube(W, [(s0 - 0.12, z + 0.04, y_top + 0.06), (s1 + 0.12, z + 0.04, y_top + 0.06)], 0.014, "H_metal", 6, tn=dk)
        for xx in (s0 - 0.12, s1 + 0.12):
            K.lathe(W, xx, z + 0.04, y_top + 0.03, [(0, 0), (0.025, 0.0), (0.03, 0.03), (0.02, 0.06), (0, 0.062)], "H_metal", 8, tn=dk)
        for i in range(6):
            x = s0 + width * (i + 0.5) / 6
            K.tube(W, [(x - 0.012, z + 0.04, y_top + 0.06), (x, z + 0.04, y_top + 0.02), (x + 0.012, z + 0.04, y_top + 0.06)], 0.004, "H_metal", 4,
                   tn=dk, caps=False)


def patch_kit():
    import kit_shell, kit_seating, kit_tables, kit_decor, kit_beds, kit_kitchen, kit_storage
    for mod in (K, kit_shell, kit_seating, kit_tables, kit_decor, kit_beds, kit_kitchen, kit_storage):
        if hasattr(mod, "rbox"):
            mod.rbox = rbox_lite
    kit_shell.curtain = curtain_lite


patch_kit()


# ------------------------------------------------------------------------------------- kit pieces with a seat count ----
def _wrap(name, fn, furn, **fixed):
    def g(F, **kw):
        kk = dict(fixed)
        kk.update(kw)
        fn(F, **kk)
    g.__name__ = name
    K.FURN[name] = furn
    return g


def sofa_leather_n(F, n=2, w=1.75, **kw):
    import kit_seating as SE
    SE.sofa_leather(F, w=w, seats=n, **kw)


def sofa_fabric_n(F, n=3, w=2.4, **kw):
    import kit_seating as SE
    SE.sofa_fabric(F, w=w, seats=n, **kw)


K.FURN["sofa_leather_n"] = "sofa"
K.FURN["sofa_fabric_n"] = "sofa"


# ------------------------------------------------------------------------------------------------- tabletop props ----
def props_desk(F, w=1.8, top=0.76, seed=3, lamp=False):
    """what lies on a study desk (frame = the desk's own frame, origin = its middle on the floor): stacked books, an open book,
    a few loose sheets, a pen cup and a mug. Plain geometry, no text."""
    rnd = random.Random(seed)
    hw = w / 2
    ST.books_stack(F, -hw + 0.3, -0.02, top, n=5, seed=seed, w=0.24, d=0.18)
    ST.books_stack(F, -hw + 0.62, 0.02, top, n=3, seed=seed + 1, w=0.2, d=0.15)
    # open book: two pages and two covers
    bx, bz = 0.15, 0.06
    K.rbox(F, bx - 0.20, bx + 0.0, bz - 0.14, bz + 0.14, top, top + 0.006, "H_atlas", r=0.0, seg=1, uvc=acell(9))
    K.rbox(F, bx - 0.19, bx - 0.005, bz - 0.13, bz + 0.13, top + 0.006, top + 0.016, "H_plaster", r=0.0, seg=1, tn=(0.95, 0.93, 0.85, 1))
    K.rbox(F, bx + 0.0, bx + 0.20, bz - 0.14, bz + 0.14, top, top + 0.006, "H_atlas", r=0.0, seg=1, uvc=acell(9))
    K.rbox(F, bx + 0.005, bx + 0.19, bz - 0.13, bz + 0.13, top + 0.006, top + 0.016, "H_plaster", r=0.0, seg=1, tn=(0.95, 0.93, 0.85, 1))
    # loose sheets
    for k in range(3):
        K.rbox(F, 0.42 + 0.03 * k, 0.66 + 0.03 * k, -0.2 + 0.05 * k, 0.05 + 0.05 * k, top + 0.002 * k, top + 0.002 * (k + 1), "H_plaster", r=0.0, seg=1,
               tn=(0.96, 0.95, 0.9, 1))
    ST.mug(F, hw - 0.18, -0.12, top, (0.85, 0.5, 0.4, 1))
    # pen cup
    K.lathe(F, hw - 0.3, 0.1, top, [(0, 0), (0.035, 0.0), (0.038, 0.09), (0.032, 0.09), (0, 0.005)], "H_ceramic", 10, tn=(0.3, 0.35, 0.45, 1))
    for k in range(4):
        a = k * 1.6
        K.tube(F, [(hw - 0.3, 0.1, top + 0.05), (hw - 0.3 + 0.012 * math.cos(a), 0.1 + 0.012 * math.sin(a), top + 0.17)], 0.004, "H_plastic", 4,
               tn=((0.8, 0.2, 0.2, 1), (0.2, 0.3, 0.7, 1), (0.9, 0.8, 0.2, 1), (0.1, 0.1, 0.1, 1))[k], caps=False)


def props_table(F, top, seed=5, w=1.0, tea=False):
    """a low table: a stack of books, a mug, a small vase with a branch (frame = the table's frame)"""
    ST.books_stack(F, -w / 2 + 0.2, 0.0, top, n=3, seed=seed, w=0.22, d=0.16)
    ST.mug(F, w / 2 - 0.2, 0.05, top, (0.9, 0.85, 0.75, 1))
    DE.vase_branch(F.sub(0.05, -0.05, top, 0.0), h=0.22, seed=seed)


def plant_big(F, h=1.25, seed=4, leaves=22, kind="monstera", pot_tn=None):
    """denser houseplant than the kit's: more and larger leaves on arching stems (monstera) or on a straight trunk (fiddle / rubber)"""
    rnd = random.Random(seed)
    if kind == "monstera":
        DE.pot(F, 0.21, 0.34, tn=pot_tn)
        for i in range(leaves):
            a = i * 2.39996 + rnd.uniform(-0.2, 0.2)
            t = (i + 1) / leaves
            up = 0.3 + 0.65 * (1 - t) ** 0.8 + rnd.uniform(-0.05, 0.05)
            r0 = 0.04 + 0.26 * t
            top_h = 0.34 + (h - 0.34) * up
            L = rnd.uniform(0.34, 0.5) * (0.85 + 0.3 * (1 - t))
            sx, sz = math.cos(a) * r0, math.sin(a) * r0
            K.tube(F, [(0, 0, 0.3), (sx * 0.5, sz * 0.5, 0.3 + (top_h - 0.3) * 0.7), (sx, sz, top_h)], 0.006, "H_leaf", 4, tn=(0.55, 0.75, 0.45, 1), caps=False)
            DE.leaf(F, (sx, sz, top_h), (math.cos(a), math.sin(a), 0.12 - 0.2 * (1 - t)), L, L * 0.92, droop=0.3, tn=(0.8 + 0.25 * rnd.random(), 1.0, 0.8, 1),
                    segs=4, curl=0.14)
    else:
        DE.pot(F, 0.22, 0.38, tn=pot_tn or (0.9, 0.88, 0.84, 1), m="H_ceramic")
        K.tube(F, [(0, 0, 0.36), (0.01, 0, h * 0.5), (0.0, 0.01, h - 0.12)], [0.026, 0.02, 0.011], "H_wood_oak", 6, tn=(0.45, 0.36, 0.28, 1))
        for k in range(leaves):
            t = 0.2 + 0.8 * k / leaves
            a = k * 2.4 + rnd.random() * 0.5
            L = 0.4 * (1.15 - 0.45 * t)
            yy = 0.36 + (h - 0.4) * t
            r0 = 0.03 + 0.05 * (1 - t)
            K.tube(F, [(0.0, 0.0, yy), (math.cos(a) * r0, math.sin(a) * r0, yy + 0.02)], 0.004, "H_leaf", 4, tn=(0.4, 0.55, 0.35, 1), caps=False)
            DE.leaf(F, (math.cos(a) * r0, math.sin(a) * r0, yy + 0.02), (math.cos(a), math.sin(a), 0.55 - 0.3 * t), L, L * 0.78, droop=0.3,
                    tn=(0.55 + 0.1 * rnd.random(), 0.8, 0.45, 1), segs=3, curl=0.1)
    K.col(F, -0.32, 0.32, -0.32, 0.32, h, name="plant")


K.FURN.setdefault("plant_big", None)


# ------------------------------------------------------------------------------------------- material budget (<= 24) ----
# The game material is unlit albedo only (texture x vertex tint), so materials that differ only in roughness / metalness / coat are the same
# thing in the GLB: merge them (white-tinted ones into H_paint, near-black untinted ones into H_rubber) to stay within the 24-material budget.
MAT_ALIAS = {"H_ceramic": "H_paint", "H_plastic": "H_paint", "H_terracotta": "H_paint", "H_metal": "H_paint",
             "H_screen": "H_rubber", "H_lacquer": "H_rubber", "H_soil": "H_rubber"}
_mi_orig = K.MB.mi


def _mi_alias(self, n):
    return _mi_orig(self, MAT_ALIAS.get(n, n))


K.MB.mi = _mi_alias
