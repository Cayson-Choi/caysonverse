"""B2 (lots v2: 성당 + 교회) — parts both B2 kits share, pure python on B1's b1_geom.py / b1_parts.py (lot LOCAL frame or a
room frame): pointed (Gothic) arch heads, lancet windows with chamfered stone surrounds and hood moulds, a stained-glass
"inner panel" seen from outside (jewel colours, the lead lines as gaps), plank oak doors with wrought-iron strap hinges on a
pointed head, stepped buttresses, a quatrefoil fountain, a rose arch, low box hedges, garden flowers. Everything brand-new.
"""
import math

import b1_geom as G
import b1_parts as P
from b1_geom import Mesh, S


def pointed(cx, spring, w, n=8, k=1.0):
    """Points of a two-centred pointed arch from left to right (`k` = radius / span: 1.0 equilateral, 0.6 a drop arch)."""
    r = w * k
    half = w / 2
    # the left side is drawn round a centre on the springing line at cx - half + r (the right springing point when r = w)
    apex = spring + math.sqrt(max(r * r - (r - half) ** 2, 0.0))
    a0 = math.pi  # the left springing point seen from that centre
    cl = cx - half + r
    a1 = math.atan2(apex - spring, cx - cl)
    left = [(cl + r * math.cos(a0 + (a1 - a0) * i / n), spring + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]
    right = [(2 * cx - x, y) for (x, y) in reversed(left)]
    return left + right[1:]


def apex_of(spring, w, k=1.0):
    r = w * k
    return spring + math.sqrt(max(r * r - (r - w / 2) ** 2, 0.0))


def head_fill(m, f, pts, top, s, w=0.0):
    """Fill the wall between an arch head (points left -> right) and the horizontal line `top` (the hole was cut as a
    rectangle up to `top`)."""
    for a, b in zip(pts, pts[1:]):
        f.poly(m, [(a[0], a[1], w), (b[0], b[1], w), (b[0], top, w), (a[0], top, w)], s)


def arch_ring(m, f, pts, wid, w0, w1, s, side=True):
    """A flat moulded ring round an arch (points left -> right): a band `wid` wide on the face (w = w1), its outer edge
    returned to the wall (w0 .. w1)."""
    cx = (pts[0][0] + pts[-1][0]) / 2
    sp = pts[0][1]
    outer = []
    for i, p in enumerate(pts):
        a = pts[max(i - 1, 0)]
        b = pts[min(i + 1, len(pts) - 1)]
        tx, ty = b[0] - a[0], b[1] - a[1]
        L = math.hypot(tx, ty) or 1.0
        nx, ny = ty / L, -tx / L  # outward normal (left of the path running left -> right over the top is up/out)
        if (p[0] - cx) * nx + (p[1] - sp) * ny < 0:
            nx, ny = -nx, -ny
        outer.append((p[0] + nx * wid, p[1] + ny * wid))
    for i in range(len(pts) - 1):
        a, b, c, d = pts[i], pts[i + 1], outer[i + 1], outer[i]
        f.poly(m, [(a[0], a[1], w1), (b[0], b[1], w1), (c[0], c[1], w1), (d[0], d[1], w1)], s)
        if side:
            f.poly(m, [(d[0], d[1], w0), (c[0], c[1], w0), (c[0], c[1], w1), (d[0], d[1], w1)], s, out=0)
            f.poly(m, [(a[0], a[1], w0), (b[0], b[1], w0), (b[0], b[1], w1), (a[0], a[1], w1)], s, out=0)
    return outer


# ------------------------------------------------------------------------------------------------ windows --

JEWEL = [G.hexc(c) for c in ("1E3F8A", "2A5DB0", "8E1F2A", "B8322E", "C9962E", "E0B84A", "2F6B4A", "6B3A7A", "D8C9A0")]


def glass_panel(m, f, uc, sill, w, spring, apex_y, w_at, seed=0, dim=0.32, cols=3, rows=8, pts=None):
    """The stained glass seen from OUTSIDE by day: a mosaic of jewel-coloured cells (M_screen, unlit, dim) a little behind the
    glass; the dark gaps between the cells read as the lead cames. `w_at` = its depth (negative = into the wall)."""
    rg = G.rng(seed)
    u0, u1 = uc - w / 2, uc + w / 2
    gap = 0.018
    for j in range(rows):
        v0 = sill + (spring - sill) * j / rows
        v1 = sill + (spring - sill) * (j + 1) / rows
        for i in range(cols):
            a = u0 + w * i / cols
            b = u0 + w * (i + 1) / cols
            c = JEWEL[rg.randrange(len(JEWEL))]
            if (i == cols // 2) and rows > 3 and 2 <= j <= rows - 2:
                c = JEWEL[(j + seed) % 3 + 3]  # the figure's robe down the middle light
            col = (*G.mul(c, dim), 1.0)
            q = [f.p(a + gap, v0 + gap, w_at), f.p(b - gap, v0 + gap, w_at), f.p(b - gap, v1 - gap, w_at), f.p(a + gap, v1 - gap, w_at)]
            m.poly(q, S("M_screen"), cols=[col] * 4)
    if pts:
        # the head: a fan of cells
        c = (*G.mul(JEWEL[1], dim), 1.0)
        mid = (uc, (spring + apex_y) / 2)
        for a, b in zip(pts, pts[1:]):
            m.poly([f.p(mid[0], mid[1], w_at), f.p(b[0], b[1] - 0.02, w_at), f.p(a[0], a[1] - 0.02, w_at)], S("M_screen"),
                   cols=[(*G.mul(JEWEL[rg.randrange(6)], dim), 1.0)] * 3)
        m.poly([f.p(u0 + gap, spring - gap * 0.5, w_at), f.p(u1 - gap, spring - gap * 0.5, w_at), f.p(mid[0], mid[1], w_at)], S("M_screen"), cols=[c] * 3)


def lancet(kit, f, uc, sill, w, h, stone, wall_s, glass_seed=0, depth=0.32, surround=0.14, hood=True, glow=None,
           glow_col=None, panel=True, k=1.0, inside=None, glazing="stained"):
    """A pointed lancet seen from outside (`h` up to the apex): splayed stone reveals, the glass set back `depth`, a stained
    glass panel behind it, a chamfered stone surround, a hood mould (drip) and a sloping sill. Holes are cut by the caller
    as (uc - w/2, uc + w/2, sill, sill + h)."""
    SH, D = kit.S, kit.D
    u0, u1 = uc - w / 2, uc + w / 2
    spring = sill + h - (apex_of(0.0, w, k))
    pts = pointed(uc, spring, w, 6, k)
    top = sill + h
    head_fill(SH, f, pts, top, wall_s)
    # reveals: sides, head and the sill (into the wall)
    for (ua, out) in ((u0, 1), (u1, -1)):
        q = [f.p(ua, sill, 0), f.p(ua, spring, 0), f.p(ua, spring, -depth), f.p(ua, sill, -depth)]
        if G.dot(G.poly_normal(q), G.mul(f.U, out)) < 0:
            q.reverse()
        SH.poly(q, stone.u((0, 1, 0)))
    cen = f.p(uc, spring, 0)
    for a, b in zip(pts, pts[1:]):
        q = [f.p(a[0], a[1], 0), f.p(b[0], b[1], 0), f.p(b[0], b[1], -depth), f.p(a[0], a[1], -depth)]
        mid = G.mul(G.add(q[0], q[1]), 0.5)
        if G.dot(G.poly_normal(q), G.sub(cen, mid)) < 0:
            q.reverse()
        SH.poly(q, stone)
    q = [f.p(u0, sill, 0), f.p(u1, sill, 0), f.p(u1, sill, -depth), f.p(u0, sill, -depth)]
    if G.poly_normal(q)[1] < 0:
        q.reverse()
    SH.poly(q, stone)
    outline = [(u0, sill), (u1, sill)] + list(reversed(pts))
    f.poly(SH, [(a, b, -depth) for a, b in outline], P.GLASS)
    if panel:
        glass_panel(D, f, uc, sill, w, spring, top, -depth - 0.04, seed=glass_seed, pts=pts, dim=0.3 if glazing == "stained" else 0.55,
                    cols=3 if w > 0.7 else 2, rows=max(3, int((spring - sill) / 0.42)))
    if inside:
        inside(kit, f, uc, sill, w, spring, top, depth)
    # chamfered surround (flat band proud 4 cm) and the hood mould over the head, with two carved stops
    if surround:
        f.box(D, u0 - surround, u0, sill, spring, 0.0, 0.04, stone, skip=("-w", "-v", "+v", "+u"))
        f.box(D, u1, u1 + surround, sill, spring, 0.0, 0.04, stone, skip=("-w", "-v", "+v", "-u"))
        arch_ring(D, f, pts, surround, 0.0, 0.04, stone)
    if hood:
        hp = pointed(uc, spring, w + 2 * surround + 0.06, 6, k)
        arch_ring(D, f, hp, 0.07, 0.0, 0.09, stone, side=False)
        for p in (hp[0], hp[-1]):
            f.box(D, p[0] - 0.07, p[0] + 0.07, p[1] - 0.16, p[1], 0.0, 0.1, stone)
    # sloping stone sill with a drip
    f.box(D, u0 - surround - 0.04, u1 + surround + 0.04, sill - 0.12, sill, -0.02, 0.1, stone, skip=("-w",))
    if glow:
        g = kit.glow(glow)
        col = glow_col or P.WARM
        outline2 = [(u0 + 0.02, sill + 0.02), (u1 - 0.02, sill + 0.02)] + [(p[0], p[1] - 0.02) for p in reversed(pts[1:-1])]
        f.poly(g, [(a, b, -depth - 0.02) for a, b in outline2], P.GLASS.t(col))
        p = f.p(uc, (sill + spring) / 2, -depth - 0.8)
        kit.lights.append(("point", p[0], p[1], p[2], (1.0, 0.8, 0.55), 30.0))
    return pts, spring


# ------------------------------------------------------------------------------------------------ doors --

def plank_door(kit, door_id, cx, door_z, width, spring, k, oak, iron, height_clear, leaf_t=0.075, inward=True):
    """Two oak plank leaves under a pointed head (each leaf's top follows its half of the arch), wrought-iron strap hinges
    with scrolled ends, ring pulls and a lock plate; hinge at the jambs, turning inward (to -z) 0 -> 90 degrees. Built hinge
    at the origin, outer face at z = 0, like b1_parts.double_door, and handed to the kit."""
    lw = width / 2
    pts = pointed(0.0, spring, width, 10, k)
    leaves = []
    for name, sgn in (("l", 1), ("r", -1)):
        m = Mesh("leaf_" + name)
        # outline in leaf space (x from the hinge toward the middle): left leaf x = X + lw (0 .. lw), right x = X - lw (-lw .. 0)
        if sgn > 0:
            half = [(x + lw, y) for (x, y) in pts if x <= 1e-6]
            xs0, xs1 = 0.004, lw - 0.006
        else:
            half = [(x - lw, y) for (x, y) in pts if x >= -1e-6]
            xs0, xs1 = -lw + 0.006, -0.004
        top = [(min(max(x, xs0), xs1), y - 0.004) for x, y in half]
        outline = [(xs0, 0.01), (xs1, 0.01)] + list(reversed(top))
        # clean the outline (drop doubled points), make it CCW seen from +z
        clean = []
        for p in outline:
            if not clean or math.dist(p, clean[-1]) > 1e-4:
                clean.append(p)
        area = sum(clean[i][0] * clean[(i + 1) % len(clean)][1] - clean[(i + 1) % len(clean)][0] * clean[i][1] for i in range(len(clean)))
        if area < 0:
            clean.reverse()
        m.slab(clean, ((0.0, 0.0, 0.0), (1, 0, 0), (0, 1, 0)), leaf_t, oak.u((0, 1, 0)))
        # vertical planks: shallow grooves as raised battens on the outer face (5 per leaf)
        n = 5
        for i in range(1, n):
            x = xs0 + (xs1 - xs0) * i / n
            ytop = _leaf_top(clean, x) - 0.02
            m.box(x - 0.008, x + 0.008, 0.02, ytop, 0.0, 0.006, oak.t(G.mul(oak.col, 0.7)), skip=("-z",))
        # three wrought-iron strap hinges with scrolled ends (on the outer face), from the hinge edge
        for v in (0.45, spring * 0.52, spring - 0.25):
            L = (xs1 - xs0) * 0.82
            x0 = 0.0 if sgn > 0 else 0.0
            x1 = sgn * L
            m.box(min(x0, x1), max(x0, x1), v - 0.035, v + 0.035, 0.0, 0.012, iron, skip=("-z",))
            # the scroll: a curled tip and a fleur pair of short branches
            tip = x1
            for (dy, dx) in ((0.08, 0.16), (-0.08, 0.16)):
                m.member((tip - sgn * 0.12, v, 0.009), (tip - sgn * (0.12 + dx * 0.5), v + dy, 0.009), G.prof_box(0.02, 0.012), iron)
            m.box(tip - 0.03, tip + 0.03, v - 0.05, v + 0.05, 0.0, 0.014, iron, skip=("-z",))
        # ring pull and lock plate near the meeting stiles
        hx = xs1 - 0.12 if sgn > 0 else xs0 + 0.12
        m.box(hx - 0.06, hx + 0.06, 1.0, 1.18, 0.0, 0.012, iron, skip=("-z",))
        ring = [(hx + 0.07 * math.cos(2 * math.pi * i / 10), 1.0 - 0.02 + 0.07 * math.sin(2 * math.pi * i / 10), 0.03) for i in range(11)]
        m.tube(ring, 0.009, 4, iron)
        # inner face: ledges and braces (seen when it swings open)
        for v in (0.35, spring * 0.5, spring - 0.2):
            m.box(xs0 + 0.05 if sgn > 0 else xs0 + 0.05, xs1 - 0.05, v - 0.07, v + 0.07, -leaf_t - 0.025, -leaf_t, oak, skip=("+z",))
        hinge = (cx - sgn * lw, 0.0, door_z)
        leaves.append((name, m, hinge, sgn if inward else -sgn))
    kit.doors[door_id] = leaves
    kit.sweeps.append(("door " + door_id, (cx - lw - 0.004, cx + lw + 0.004, door_z - lw - 0.07, door_z - 0.07), height_clear))
    return pts


def _leaf_top(clean, x):
    best = 0.0
    for i in range(len(clean)):
        a, b = clean[i], clean[(i + 1) % len(clean)]
        if (a[0] - x) * (b[0] - x) <= 0 and abs(b[0] - a[0]) > 1e-6:
            t = (x - a[0]) / (b[0] - a[0])
            best = max(best, a[1] + (b[1] - a[1]) * t)
    return best


# ------------------------------------------------------------------------------------------------ masonry --

def buttress(m, f, u, w, d, h, stone, offs=2, label=None, cap=None):
    """A stepped buttress on a facade frame: `w` wide at u, projecting `d` (outward), `h` high, with `offs` set-offs each
    with a sloping weathering (a wedge) and a chamfered plinth."""
    cap = cap or stone
    steps = []
    hh = h
    for i in range(offs):
        frac = (i + 1) / offs
        steps.append((h * (i / offs), h * frac, d * (1 - 0.35 * i)))
    for (v0, v1, dd) in steps:
        f.box(m, u - w / 2, u + w / 2, v0, v1 - 0.18, 0.0, dd, stone, skip=("-w",))
        # weathering: a sloped wedge from the front edge up to the wall/next stage
        nxt = dd * 0.65 if v1 < h - 1e-6 else 0.0
        a, b = u - w / 2, u + w / 2
        q = [(a, v1 - 0.18, dd), (b, v1 - 0.18, dd), (b, v1 + 0.12, nxt), (a, v1 + 0.12, nxt)]
        f.poly(m, q, cap)
        for (x, sg) in ((a, -1), (b, 1)):
            tri = [(x, v1 - 0.18, dd), (x, v1 + 0.12, nxt), (x, v1 - 0.18, nxt)]
            pts = [f.p(*t) for t in tri]
            n = G.poly_normal(pts)
            if G.dot(n, G.mul(f.U, sg)) < 0:
                pts.reverse()
            m.poly(pts, cap)
    f.box(m, u - w / 2 - 0.06, u + w / 2 + 0.06, 0.0, 0.45, 0.0, d + 0.06, stone, skip=("-w", "-v"))


# ------------------------------------------------------------------------------------------------ garden --

def hedge_low(m, x0, x1, z0, z1, leaf_s, h=0.28):
    """A clipped box hedge (<= 0.3 m: walkover height)."""
    m.cbox(x0, x1, 0.0, h, z0, z1, leaf_s, c=0.04, skip=("-y",))


def lavender_kind(name, stem_s, flower_s, h=0.27, r=0.16):
    """A lavender clump: a grey-green mound and a ring of purple spikes (~60 triangles)."""
    m = Mesh(name)
    m.lathe([(r * 0.8, 0.0), (r, h * 0.35), (0.0, h * 0.6)], 5, stem_s)
    for i in range(5):
        a = i * 2 * math.pi / 5
        x, z = r * 0.55 * math.cos(a), r * 0.55 * math.sin(a)
        m.lathe([(0.018, 0.0), (0.022, 0.05), (0.0, 0.11)], 3, flower_s, x * 1.2, z * 1.2, h * 0.55 + 0.02 * (i % 3))
    m.lathe([(0.02, 0.0), (0.024, 0.05), (0.0, 0.12)], 3, flower_s, 0.0, 0.0, h * 0.6)
    return m


def rose_kind(name, leaf_s, petal_s, h=0.62, r=0.24):
    """A rose bush (for beds inside a collider): a leafy mound with five open blooms (cupped petals) ~110 triangles."""
    m = Mesh(name)
    m.lathe([(r * 0.5, 0.0), (r, h * 0.4), (r * 0.8, h * 0.8), (0.0, h * 0.95)], 6, leaf_s)
    for i in range(4):
        a = i * 2 * math.pi / 4 + 0.3
        x, z = r * 0.72 * math.cos(a), r * 0.72 * math.sin(a)
        y = h * (0.66 + 0.1 * (i % 2))
        m.lathe([(0.0, -0.02), (0.055, 0.01), (0.04, 0.05), (0.0, 0.04)], 5, petal_s, x, z, y)
    m.lathe([(0.0, -0.02), (0.06, 0.01), (0.045, 0.055), (0.0, 0.045)], 5, petal_s, 0.0, 0.0, h * 0.9)
    return m


def flower_low_kind(name, leaf_s, petal_s, h=0.2, r=0.1):
    """A low bedding plant (<= 0.25 m): a mound and three petal heads (~45 triangles)."""
    m = Mesh(name)
    m.lathe([(r * 0.9, 0.0), (r * 1.1, h * 0.45), (0.0, h * 0.72)], 5, leaf_s)
    for (dx, dz, dy) in ((0.03, 0.0, 0.85), (-0.04, 0.03, 0.78), (0.0, -0.045, 0.8)):
        m.sphere(dx, h * dy, dz, r * 0.42, petal_s, n=4, rings=2, sy=0.7)
    return m


def scatter(kit, kind, mesh, x0, x1, z0, z1, step, seed, jitter=0.35, avoid=None):
    rg = G.rng(seed)
    z = z0 + step / 2
    row = 0
    while z < z1:
        x = x0 + step / 2 + (step / 2 if row % 2 else 0.0)
        while x < x1:
            px = x + rg.uniform(-jitter, jitter) * step
            pz = z + rg.uniform(-jitter, jitter) * step
            if x0 <= px <= x1 and z0 <= pz <= z1 and not (avoid and avoid(px, pz)):
                kit.place(kind, mesh, px, 0.0, pz, rg.uniform(0, 6.28))
            x += step
        z += step * 0.87
        row += 1


def rose_cluster_kind(name, leaf_s, leaf_s2, petal_s, petal_s2):
    """A clump of climbing rose (for an arch): two overlapping leafy lumps of different greens, two open blooms and a bud;
    ~110 triangles, origin at its centre."""
    m = Mesh(name)
    m.sphere(0.0, 0.0, 0.0, 0.17, leaf_s, n=5, rings=3, sy=0.8)
    m.sphere(0.09, 0.05, 0.05, 0.12, leaf_s2, n=5, rings=3, sy=0.9)
    m.lathe([(0.0, -0.02), (0.05, 0.0), (0.04, 0.045), (0.0, 0.035)], 5, petal_s, 0.06, 0.13, 0.08)
    m.lathe([(0.0, -0.02), (0.045, 0.0), (0.035, 0.04), (0.0, 0.03)], 5, petal_s2, -0.1, -0.06, 0.1)
    m.sphere(0.02, 0.15, -0.12, 0.03, petal_s, n=4, rings=2)
    return m


def box_ball_kind(name, leaf_s, leaf_s2, r=0.24, h=0.27):
    """A clipped box mound (walkover height): a squashed lumpy ball with a second lump, ~50 triangles."""
    m = Mesh(name)
    m.sphere(0.0, h * 0.5, 0.0, r, leaf_s, n=6, rings=4, sy=h / (2 * r) * 1.02)
    m.sphere(0.06, h * 0.62, -0.05, r * 0.6, leaf_s2, n=5, rings=3, sy=0.7)
    return m
