"""Small props that read as what they are at phone close-up distance (2026-11-28 prop sweep): books with a page block,
cover boards and a round spine (a plain box read as a laptop or a slab), an open book whose pages curve up from the gutter,
and helpers shared by the sacred rooms. Pure python on b1_geom.Mesh (no Blender)."""
import math

import b1_geom as G
from b1_geom import Mesh


def _place(src, dst, fn):
    for p in src.polys:
        dst.polys.append(G.Poly([fn(q) for q in p.pts], p.uv, p.col, p.mat, p.smooth))


def _frame(x, y, z, yaw=0.0, tilt=0.0):
    """local (u across, h up, v along) -> world: tilt about the local u axis (front edge down), then yaw about y."""
    ct, st = math.cos(tilt), math.sin(tilt)
    cy, sy = math.cos(yaw), math.sin(yaw)

    def fn(p):
        u, h, v = p
        h2, v2 = h * ct + v * st, -h * st + v * ct
        return (x + u * cy + v2 * sy, y + h2, z - u * sy + v2 * cy)
    return fn


def closed_book(m, x, y, z, w, d, t, cover, pages, yaw=0.0, tilt=0.0, spine="-u"):
    """A hardback lying flat at (x, y, z) (y = underside), `w` across x `d` deep x `t` thick: two cover boards overhanging the
    page block by 3 mm on three sides, a cream page block with a faint page-line shading, a rounded spine on the `spine` side."""
    k = Mesh("book")
    b = 0.0035          # board thickness
    o = 0.003           # overhang
    hw, hd = w / 2, d / 2
    k.cbox(-hw, hw, 0.0, b, -hd, hd, cover, c=0.0012)
    k.cbox(-hw, hw, t - b, t, -hd, hd, cover, c=0.0012)
    k.box(-hw + 0.004, hw - o, b, t - b, -hd + o, hd - o, pages)
    # the spine: a half-round of cover cloth on the -u edge from board to board
    n = 8
    r = t / 2
    for i in range(n):
        a0, a1 = math.pi / 2 + math.pi * i / n, math.pi / 2 + math.pi * (i + 1) / n
        p0 = (-hw + 0.004 + r * 0.55 * math.cos(a0), r + r * math.sin(a0), 0)
        p1 = (-hw + 0.004 + r * 0.55 * math.cos(a1), r + r * math.sin(a1), 0)
        k.poly([(p0[0], p0[1], -hd), (p1[0], p1[1], -hd), (p1[0], p1[1], hd), (p0[0], p0[1], hd)][::-1], cover, smooth=True)
    yaw2 = yaw + {"-u": 0.0, "+u": math.pi, "-v": -math.pi / 2, "+v": math.pi / 2}[spine]
    _place(k, m, _frame(x, y, z, yaw2, tilt))


def open_book(m, x, y, z, w, d, cover, pages, yaw=0.0, tilt=0.0, ink=None, lines=9):
    """An open book (w = both pages across, d = page height) on a plane through (x, y, z): the boards flat under it, each page
    stack rising from the sunk gutter in a soft curve to a rounded fore-edge; faint text lines when `ink` is given."""
    k = Mesh("openbook")
    hw, hd = w / 2, d / 2
    k.cbox(-hw - 0.004, hw + 0.004, 0.0, 0.003, -hd - 0.004, hd + 0.004, cover, c=0.001)
    n = 10
    for side in (-1, 1):
        prof = []
        for i in range(n + 1):
            s = i / n                                  # 0 at the gutter, 1 at the fore-edge
            u = side * (0.004 + s * (hw - 0.006))
            h = 0.003 + 0.012 * math.sin(math.pi * 0.5 * min(1.0, s * 1.6)) * (1.0 - 0.25 * s) + 0.004 * (1 - s) ** 3 * 0.0
            prof.append((u, h))
        for i in range(n):
            (u0, h0), (u1, h1) = prof[i], prof[i + 1]
            q = [(u0, h0, -hd), (u1, h1, -hd), (u1, h1, hd), (u0, h0, hd)]
            if side < 0:
                q.reverse()
            k.poly(q, pages, smooth=True)
        # the fore-edge and the stack's ends (a thin wall down to the board)
        ue, he = prof[-1]
        q = [(ue, 0.003, -hd), (ue, 0.003, hd), (ue, he, hd), (ue, he, -hd)]
        if side < 0:
            q.reverse()
        k.poly(q, pages)
        for zz, sg in ((-hd, -1), (hd, 1)):
            q = [(u, 0.003, zz) for u, _ in prof[::-1]] + [(u, h, zz) for u, h in prof]
            pts = [(u, h, zz) for u, h in prof] + [(prof[-1][0], 0.003, zz), (prof[0][0], 0.003, zz)]
            if G.dot(G.poly_normal(pts), (0, 0, sg)) < 0:
                pts.reverse()
            k.poly(pts, pages)
        if ink is not None:
            # a few text lines: thin strips just above the page surface
            for j in range(lines):
                vv = -hd + 0.025 + j * (d - 0.05) / (lines - 0.5)
                for i in range(2, n - 1):
                    (u0, h0), (u1, h1) = prof[i], prof[i + 1]
                    q = [(u0, h0 + 0.0004, vv), (u1, h1 + 0.0004, vv), (u1, h1 + 0.0004, vv + 0.004), (u0, h0 + 0.0004, vv + 0.004)]
                    if side < 0:
                        q.reverse()
                    k.poly(q[::-1], ink)
    _place(k, m, _frame(x, y, z, yaw, tilt))


def book_rest(m, x, y, z, w, d, wood, yaw=0.0, tilt=0.3):
    """A small oak book rest (a sloped board on a ledge and two legs) for an open altar or pulpit Bible; returns the
    (x, y, z) of the open book's plane centre and its tilt."""
    k = Mesh("rest")
    hw, hd = w / 2, d / 2
    rise = math.sin(tilt) * d
    k.cbox(-hw, hw, 0.0, 0.018, -hd, hd, wood, c=0.004)                # base
    # the sloped board: from the front (low) to the back (high)
    run = math.cos(tilt) * d
    q = [(-hw, 0.03, -run / 2), (hw, 0.03, -run / 2), (hw, 0.03 + rise, run / 2), (-hw, 0.03 + rise, run / 2)]
    k.poly(q[::-1], wood)
    k.poly([(p[0], p[1] - 0.012, p[2]) for p in q], wood)
    for u in (-hw, hw):
        sg = 1 if u > 0 else -1
        side = [(u, 0.018, -run / 2), (u, 0.018, run / 2), (u, 0.03 + rise, run / 2), (u, 0.018 + 0.012, -run / 2)]
        if G.dot(G.poly_normal(side), (sg, 0, 0)) < 0:
            side.reverse()
        k.poly(side, wood)
    k.cbox(-hw, hw, 0.018, 0.05, -run / 2 - 0.012, -run / 2, wood, c=0.003)    # the ledge
    _place(k, m, _frame(x, y, z, yaw, 0.0))
    return (x, y + 0.03 + rise / 2 + 0.001, z), tilt
