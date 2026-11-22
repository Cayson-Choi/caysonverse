"""케이슨 마을 도서관 열람실 — real books (owner 2026-11-20: "책들이 너무 허접해 … 실제와 같이"), pure python on b1_geom, used by
library_room_dress.py / library_room_kit.py.

Every book is a hardback with its own geometry and the spine atlas `M_books` (b1_book_atlas.mjs, cells in library_book_atlas.json):
a rounded spine (two or three facets, smooth-shaded) with the cell's design (leather with raised bands and lettering pieces, book
cloth with gilt titles or a paper label, vellum, paper jackets; worn heads and tails), the head cap of the spine, the two boards'
edges, the page block 2.5 mm below them (cream, gilt, aged or sprinkled leaves with a silk headband at the spine), the side boards
(cloth or leather grain, tinted by the vertex colour to the spine's colour). Formats as on real shelves: octavo, quarto, folio
(heights 19–33 cm, depths 13–27 cm); multi-volume sets in one design and height; books pushed in by 0.5–3 cm unevenly; a book
leaning on its neighbour in a gap; small flat stacks; a brass bookend now and then. A run is 0.42 m (an instanced kind).
"""
import json
import math
import os

import b1_geom as G
from b1_geom import Mesh, S

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "library_book_atlas.json"), encoding="utf-8") as _f:
    A = json.load(_f)
SZ = A["size"]
BOOK = S("M_books")
RUG = S("M_rugs")
SPINES = A["spines"]
BY_KIND = {k: [c["i"] for c in SPINES if c["kind"] == k] for k in ("leather", "cloth", "vellum", "jacket")}
WHITE = (1.0, 1.0, 1.0, 1.0)
PHONE = False   # the phone LOD (lot_library_reading_phone.glb): the same atlases and runs, fewer facets a book (set by library_room_kit.build)


def uvr(cell, inset=2.0, size=SZ):
    """A pixel rectangle (x, y, w, h; top-left origin) -> (u0, u1, v0 = bottom, v1 = top) in Blender's UV (v up)."""
    x, y, w, h = cell
    return ((x + inset) / size, (x + w - inset) / size, 1.0 - (y + h - inset) / size, 1.0 - (y + inset) / size)


def side_tint(cell):
    """The side boards' neutral grain (mean sideMean) tinted to the spine's colour: linear multiplier, as COLOR_0."""
    base = G.lin(*(c / 255 for c in SPINES[cell]["base"]))
    m = G.lin(A["sideMean"] / 255)[0]
    return (min(1.0, base[0] / m), min(1.0, base[1] / m), min(1.0, base[2] / m), 1.0)


def page_kind(cell, rg):
    k = SPINES[cell]["kind"]
    if k == "leather":
        return "gilt" if rg.random() < 0.25 else "sprinkled" if rg.random() < 0.3 else "aged"
    if k == "vellum":
        return "aged"
    return "plain" if rg.random() < 0.6 else "aged"


def _face(m, pts, uv, col, xf, want, smooth=False):
    n = G.poly_normal(pts)
    if G.dot(n, want) < 0:
        pts, uv = pts[::-1], uv[::-1]
    m.poly([xf(p) for p in pts], BOOK, uv=uv, smooth=smooth, cols=[col] * len(pts))


def book(m, xf, w, h, d, cell, page="plain", top=True):
    """One hardback in its own frame (x 0..w across, y 0..h up, the spine at z 0 bulging to +z, the fore-edge at z -d), each
    point through `xf` (a rigid move: the faces keep their orientation)."""
    sp = SPINES[cell]
    U0, U1, V0, V1 = uvr((sp["x"], sp["y"], sp["w"], sp["h"]))
    r = min(0.0055, w * 0.16) if w > 0.016 else 0.0012
    n = 3 if w >= 0.045 else 2 if w >= 0.02 else 1
    if PHONE:
        n = 1   # (one flat facet for the back: a book's 2-6 cm is 6-18 px on a phone from 3 m, the atlas cell carries the bands and lettering)
    bt = min(0.0028, w * 0.12)
    sq = 0.0025
    sd = r + 0.002
    xs = [w * i / n for i in range(n + 1)]
    zs = [r * math.sin(math.pi * i / n) for i in range(n + 1)]
    # the spine (smooth: the facets read as one rounded back)
    for i in range(n):
        pts = [(xs[i], 0.0, zs[i]), (xs[i + 1], 0.0, zs[i + 1]), (xs[i + 1], h, zs[i + 1]), (xs[i], h, zs[i])]
        ua, ub = U0 + (U1 - U0) * i / n, U0 + (U1 - U0) * (i + 1) / n
        _face(m, pts, [(ua, V0), (ub, V0), (ub, V1), (ua, V1)], WHITE, xf, (0, 0, 1), smooth=True)
    # the side boards (the cover's grain, the spine's colour)
    side = A["sides"][sp["kind"]]
    s0, s1, t0, t1 = uvr(side, inset=4.0)
    tint = side_tint(cell)
    du = (s1 - s0) * min(1.0, d / 0.3)
    dv = (t1 - t0) * min(1.0, h / 0.36)
    _face(m, [(0.0, 0.0, 0.0), (0.0, h, 0.0), (0.0, h, -d), (0.0, 0.0, -d)], [(s0, t0), (s0, t0 + dv), (s0 + du, t0 + dv), (s0 + du, t0)], tint, xf, (-1, 0, 0))
    _face(m, [(w, 0.0, 0.0), (w, 0.0, -d), (w, h, -d), (w, h, 0.0)], [(s0, t0), (s0 + du, t0), (s0 + du, t0 + dv), (s0, t0 + dv)], tint, xf, (1, 0, 0))
    if not top:
        return
    # the head of the spine (the cover turned over the top), the boards' edges, the page block 2.5 mm down
    # (the phone keeps the head cap and the page block, which read from a shelf's front and from above, and drops the 2 mm
    # board edges and the steps between the boards and the leaves: four faces a book, millimetres wide)
    vh0, vh1 = V1 - 10.0 / SZ, V1 - 3.0 / SZ
    arc = [(xs[i], h, zs[i]) for i in range(n + 1)]
    _face(m, arc + [(w, h, -sd), (0.0, h, -sd)], [(U0 + (U1 - U0) * i / n, vh1) for i in range(n + 1)] + [(U1, vh0), (U0, vh0)], WHITE, xf, (0, 1, 0))
    for (a, b) in (() if PHONE else ((0.0, bt), (w - bt, w))):
        _face(m, [(a, h, -sd), (b, h, -sd), (b, h, -d), (a, h, -d)], [(s0, t1), (s0 + 0.004, t1), (s0 + 0.004, t1 - 0.06), (s0, t1 - 0.06)], tint, xf, (0, 1, 0))
    p0, p1, q0, q1 = uvr(A["pages"][page], inset=3.0)
    pw = (p1 - p0) * min(1.0, (w - 2 * bt) / 0.08)
    _face(m, [(bt, h - sq, -sd), (w - bt, h - sq, -sd), (w - bt, h - sq, -(d - sq)), (bt, h - sq, -(d - sq))],
          [(p0, q1), (p0 + pw, q1), (p0 + pw, q0), (p0, q0)], WHITE, xf, (0, 1, 0))
    # the step down from the boards to the leaves (seen along a shelf): the boards' inner faces
    for (x, nx) in (() if PHONE else ((bt, 1), (w - bt, -1))):
        _face(m, [(x, h - sq, -sd), (x, h, -sd), (x, h, -d), (x, h - sq, -d)], [(s0, t1), (s0, t1 - 0.004), (s0 + 0.05, t1 - 0.004), (s0 + 0.05, t1)], tint, xf, (nx, 0, 0))


def upright(bx, zo):
    return lambda p: (bx + p[0], p[1], zo + p[2])


def leaning(bx, zo, ang):
    """Turned counter-clockwise (the top to -x) about its bottom-left corner at (bx, 0)."""
    c, s = math.cos(ang), math.sin(ang)
    return lambda p: (bx + p[0] * c - p[1] * s, p[0] * s + p[1] * c, zo + p[2])


def lying(bx, y0, zo, w):
    """Laid on its side, the spine still out: the height runs along the shelf from bx, the thickness up from y0."""
    return lambda p: (bx + p[1], y0 + (w - p[0]), zo + p[2])


FORMATS = (  # (weight, h range, d range, w range)
    (0.5, (0.19, 0.245), (0.13, 0.165), (0.018, 0.045)),
    (0.35, (0.25, 0.305), (0.18, 0.23), (0.024, 0.06)),
    (0.15, (0.31, 0.33), (0.23, 0.27), (0.035, 0.075)),
)


def pick_cell(rg, mix=(0.38, 0.47, 0.04, 0.11)):
    r = rg.random()
    kinds = ("leather", "cloth", "vellum", "jacket")
    acc = 0.0
    for k, p in zip(kinds, mix):
        acc += p
        if r < acc:
            return rg.choice(BY_KIND[k])
    return rg.choice(BY_KIND["cloth"])


def pick_format(rg, hmax=0.33):
    r = rg.random()
    acc = 0.0
    for wgt, hr, dr, wr in FORMATS:
        acc += wgt
        if r < acc:
            break
    h = min(hmax, rg.uniform(*hr))
    return h, rg.uniform(*dr), rg.uniform(*wr)


def run(seed, length=0.42, hmax=0.33, top=True, mix=(0.38, 0.47, 0.04, 0.11), sets=True, flats=True, lean=True):
    """A shelf run (origin = its left end at the shelf's front edge, base y 0; spines toward +z, pushed in 0.5–3 cm)."""
    m = Mesh("books")
    rg = G.rng(seed)
    x = 0.003
    last_h = 0.0
    while x < length - 0.02:
        roll = rg.random()
        room = length - x
        if sets and roll < 0.14 and room > 0.1:
            # a multi-volume set: one design, one format, the volumes' thickness a little varied
            cell = pick_cell(rg, mix)
            h, d, w = pick_format(rg, hmax)
            page = page_kind(cell, rg)
            zo = -rg.uniform(0.006, 0.02)
            for _ in range(rg.randint(3, 8)):
                ww = w * rg.uniform(0.9, 1.1)
                if x + ww > length - 0.003:
                    break
                book(m, upright(x, zo + rg.uniform(-0.002, 0.002)), ww, h, d, cell, page, top)
                x += ww + rg.uniform(0.0, 0.0012)
                last_h = h
            continue
        if flats and roll < 0.21 and room > 0.25 and x > 0.04:
            # a small stack lying flat (the longest at the bottom), the top one turned a little
            x += 0.008
            hs = []
            y = 0.0
            for k in range(rg.randint(2, 5)):
                cell = pick_cell(rg, mix)
                h, d, w = pick_format(rg, 0.3)
                h = min(h, room - 0.02)
                if y + w > hmax - 0.02:
                    break
                hs.append(h)
                off = rg.uniform(0.0, 0.015)
                book(m, lying(x + off, y, -rg.uniform(0.005, 0.03), w), w, h, d, cell, page_kind(cell, rg), True)
                y += w
            x += (max(hs) if hs else 0.1) + 0.012
            last_h = 0.0
            continue
        if lean and roll < 0.27 and last_h > 0.18 and room > 0.09 and x > 0.1:
            # a gap, and a book leaning on its neighbour (its top-left edge on the neighbour's head)
            cell = pick_cell(rg, mix)
            h, d, w = pick_format(rg, hmax)
            ang = math.radians(rg.uniform(9, 20))
            hn = min(last_h, h * math.cos(ang)) - 0.004
            bx = x + hn * math.tan(ang)
            book(m, leaning(bx, -rg.uniform(0.008, 0.025), ang), w, h, d, cell, page_kind(cell, rg), top)
            x = bx + w * math.cos(ang) + rg.uniform(0.03, 0.08)
            last_h = 0.0
            continue
        cell = pick_cell(rg, mix)
        h, d, w = pick_format(rg, hmax)
        w = min(w, room - 0.003)
        if w < 0.014:
            break
        book(m, upright(x, -rg.uniform(0.005, 0.03)), w, h, d, cell, page_kind(cell, rg), top)
        x += w + rg.uniform(0.0, 0.0015)
        last_h = h
    return m


def pile(m, x, y, z, yaw, n, seed, hmax=0.26, spin=0.25):
    """A pile of books lying on a surface (a table, the window seat, the floor), centred at (x, z), base y; each turned a little."""
    rg = G.rng(seed)
    yy = y
    for k in range(n):
        cell = pick_cell(rg)
        h, d, w = pick_format(rg, hmax)
        a = yaw + rg.uniform(-spin, spin)
        loc = Mesh("p")
        book(loc, lying(-h / 2, 0.0, d / 2, w), w, h, d, cell, page_kind(cell, rg), True)
        m.extend(G.moved(loc, x + rg.uniform(-0.01, 0.01), yy, z, a))
        yy += w
    return yy


def open_book(m, x, y, z, yaw, seed, size=(0.32, 0.23)):
    """An open book lying on a table: the two boards (the cover's grain) and the two page blocks, each page surface bowed up
    from the gutter (three facets), the spread's text (b1_book_atlas: glyph-like lines, a vignette)."""
    rg = G.rng(seed)
    cell = pick_cell(rg, (0.5, 0.5, 0.0, 0.0))
    W, D = size
    loc = Mesh("open")
    tint = side_tint(cell)
    side = A["sides"][SPINES[cell]["kind"]]
    s0, s1, t0, t1 = uvr(side, inset=4.0)
    for sx in (-1, 1):
        # the board under each half, 3 mm, a little larger than the leaves
        x0, x1 = (-W / 2 - 0.004, 0.0) if sx < 0 else (0.0, W / 2 + 0.004)
        for (pts, want) in (([(x0, 0.003, -D / 2 - 0.004), (x1, 0.003, -D / 2 - 0.004), (x1, 0.003, D / 2 + 0.004), (x0, 0.003, D / 2 + 0.004)], (0, 1, 0)),
                            ([(x0, 0.0, D / 2 + 0.004), (x1, 0.0, D / 2 + 0.004), (x1, 0.003, D / 2 + 0.004), (x0, 0.003, D / 2 + 0.004)], (0, 0, 1)),
                            ([(x0, 0.0, -D / 2 - 0.004), (x1, 0.0, -D / 2 - 0.004), (x1, 0.003, -D / 2 - 0.004), (x0, 0.003, -D / 2 - 0.004)], (0, 0, -1))):
            _face(loc, pts, [(s0, t0), (s0 + 0.05, t0), (s0 + 0.05, t0 + 0.05), (s0, t0 + 0.05)], tint, lambda p: p, want)
    u0, u1, v0, v1 = uvr(A["spread"], inset=3.0)
    um = (u0 + u1) / 2
    prof = [(0.0, 0.006), (0.03, 0.016), (0.12, 0.02), (W / 2, 0.015)]  # (distance from the gutter, height)
    for sx in (-1, 1):
        for i in range(len(prof) - 1):
            (a0, h0), (a1, h1) = prof[i], prof[i + 1]
            ua = um + sx * (u1 - um) * a0 / (W / 2)
            ub = um + sx * (u1 - um) * a1 / (W / 2)
            pts = [(sx * a0, h0, D / 2), (sx * a1, h1, D / 2), (sx * a1, h1, -D / 2), (sx * a0, h0, -D / 2)]
            _face(loc, pts, [(ua, v0), (ub, v0), (ub, v1), (ua, v1)], WHITE, lambda p: p, (0, 1, 0), smooth=True)
        # the leaves' edge at the outer side (a page block, 1.5 cm high at the outside)
        p0, p1, q0, q1 = uvr(A["pages"]["plain"], inset=3.0)
        xo = sx * W / 2
        _face(loc, [(xo, 0.003, D / 2), (xo, 0.015, D / 2), (xo, 0.015, -D / 2), (xo, 0.003, -D / 2)], [(p0, q0), (p0 + 0.02, q0), (p0 + 0.02, q1), (p0, q1)], WHITE, lambda p: p, (sx, 0, 0))
    m.extend(G.moved(loc, x, y, z, yaw))


def rug(m, cx, cz, w, d, cell, yaw=0.0, along_z=False, fringe=None):
    """A Persian-style rug from the rugs atlas (b1_book_atlas.mjs): a pile slab 8 mm thick with its edges, the cell's design on
    top (its long side along x, or along z for the runner), knotted fringes at the two short ends."""
    r = Mesh("rug")
    u0, u1, v0, v1 = uvr(A["rugs"][cell], inset=2.0)
    hw, hd = w / 2, d / 2
    t = 0.008
    if along_z:
        top = [(-hw, t, -hd), (hw, t, -hd), (hw, t, hd), (-hw, t, hd)]
        uv = [(u0, v0), (u0, v1), (u1, v1), (u1, v0)]  # the cell's u runs along z
    else:
        top = [(-hw, t, -hd), (-hw, t, hd), (hw, t, hd), (hw, t, -hd)]
        uv = [(u0, v1), (u0, v0), (u1, v0), (u1, v1)]
    _face_rug(r, top, uv, (0, 1, 0))
    edge = [(u0, v0), (u0 + 0.002, v0), (u0 + 0.002, v0 + 0.002), (u0, v0 + 0.002)]
    for (pts, want) in (([(-hw, 0.0, hd), (hw, 0.0, hd), (hw, t, hd), (-hw, t, hd)], (0, 0, 1)),
                        ([(-hw, 0.0, -hd), (hw, 0.0, -hd), (hw, t, -hd), (-hw, t, -hd)], (0, 0, -1)),
                        ([(hw, 0.0, -hd), (hw, 0.0, hd), (hw, t, hd), (hw, t, -hd)], (1, 0, 0)),
                        ([(-hw, 0.0, -hd), (-hw, 0.0, hd), (-hw, t, hd), (-hw, t, -hd)], (-1, 0, 0))):
        _face_rug(r, pts, edge, want)
    if fringe is not None:
        ends = ((-hd, -1), (hd, 1)) if along_z else ((-hw, -1), (hw, 1))
        for (e, sgn) in ends:
            k = -(hd if not along_z else hw) + 0.015
            span = hd if not along_z else hw
            while k < span - 0.01:
                if along_z:
                    a, b = (k, 0.003, e), (k + 0.004, 0.002, e + sgn * 0.055)
                else:
                    a, b = (e, 0.003, k), (e + sgn * 0.055, 0.002, k + 0.004)
                r.member(a, b, G.prof_box(0.007, 0.003), fringe)
                k += 0.022
    m.extend(G.moved(r, cx, 0.0, cz, yaw))


def _face_rug(m, pts, uv, want):
    n = G.poly_normal(pts)
    if G.dot(n, want) < 0:
        pts, uv = pts[::-1], uv[::-1]
    m.poly(pts, RUG, uv=uv, cols=[WHITE] * len(pts))
