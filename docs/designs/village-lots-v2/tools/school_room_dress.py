"""케이슨 마을 학교 교실 — the realism pass (owner 2026-11-20: "학교 내부가 너무 허접하네 좀 실감나게 만들어봐. 그리고 학교에 걸린
그림액자도 너무 허접해 진짜 학생들이 그린 그림같은 걸 걸어두라고"), pure python on b1_geom, used by school_room_kit.py.

References (D:/ClaudeCode/tmpshots/school-real/refs, Aside 2026-11-20): new Scandinavian / Alpine primary classrooms — beech
laminate desk tops with rounded corners and edging on powder-coated tubular steel frames with T-feet and black glides, moulded
beech-plywood chairs (dished seat, curved back, two rivets) on tubular frames, a green chalkboard with a tray, cork boards in pale
frames with drawings pinned two pins each and a few crooked, drawings on a string line with wooden pegs, tapered plastic tubs with
rolled rims and laminated labels, picture books, panel radiators, a plain wall clock.

Everything with a picture on it maps the room's own atlas `M_school_art` (school_kidart.mjs; cells in school_art_atlas.json):
sixteen children's drawings on paper, the chalkboard's chalk, the ㄱㄴㄷ cards, the timetable, the clock face, bin labels, cork,
an exercise book, tape, the paper's back, page edges and picture-book spines.
"""
import json
import math
import os
import re

import b1_geom as G
from b1_geom import Mesh, S

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "school_art_atlas.json"), encoding="utf-8") as _f:
    ATLAS = json.load(_f)
ATL = ATLAS["atlases"]
PHONE = False   # set by school_room_kit.build for the phone LOD: fewer segments, the same atlases (the drawings stay as sharp)


def sg(pc, phone):
    """A segment count: the PC's or the phone LOD's."""
    return phone if PHONE else pc
CELLS = ATLAS["cells"]
DRAWINGS = ATLAS["drawings"]
with open(os.path.join(HERE, "school_kidart_draw.js"), encoding="utf-8") as _f:
    _js = _f.read()
SPINE_COLS = re.findall(r'\["[^"]+", "#([0-9A-Fa-f]{6})"\]', _js[_js.index("const SPINES = ["):_js.index("function spines(")])

import b1_parts as _P
P_GLASS_LAMP = _P.GLASS.t(_P.LAMP)
ART = S("M_school_art")                # the drawings
PRINT = S("M_school_print")            # the chalkboard, cards, labels, clock, timetable, cork, spines, tape, paper backs
MAT = {"art": ART, "print": PRINT}
GLOBE = S("M_globe")
WHITE = (1.0, 1.0, 1.0, 1.0)
SHEET_W, SHEET_H = 0.39, 0.275          # 8절 도화지 (a Korean school's drawing paper), landscape


def cm(cell):
    """The material of a cell's atlas."""
    c = CELLS[cell] if isinstance(cell, str) else cell
    return MAT[c["atlas"]]


def uvr(cell, inset=2.0, sub=None):
    """A cell (name or rect with its atlas) -> (u0, u1, v0 bottom, v1 top) in Blender UV; `sub` = (fx0, fy0, fx1, fy1) a part
    of the cell (fractions, top-left origin)."""
    c = CELLS[cell] if isinstance(cell, str) else cell
    aw, ah = ATL[c["atlas"]]["w"], ATL[c["atlas"]]["h"]
    x, y, w, h = c["x"], c["y"], c["w"], c["h"]
    if sub:
        x, y, w, h = x + sub[0] * w, y + sub[1] * h, (sub[2] - sub[0]) * w, (sub[3] - sub[1]) * h
    return ((x + inset) / aw, (x + w - inset) / aw, 1.0 - (y + h - inset) / ah, 1.0 - (y + inset) / ah)


def face(m, pts, uv, s=ART, want=None, smooth=False, cols=None):
    """A polygon with explicit UVs, flipped (with its UVs) to face `want`."""
    if want is not None:
        n = G.poly_normal(pts)
        if G.dot(n, want) < 0:
            pts = pts[::-1]
            uv = uv[::-1] if uv else uv
            if cols:
                cols = cols[::-1]
    m.poly(pts, s, uv=uv, smooth=smooth, cols=cols)


# ------------------------------------------------------------------------------------------------ paper on the walls --

def sheet(m, o, U, N, w, h, cell, rot=0.0, rg=None, curl=0.006, lift=0.002, back=None, nu=5, nv=4, sub=None):
    """A sheet of paper centred at `o` on a plane (U across, up = N x U ... V is world-up projected), `rot` radians in its
    plane, standing `lift` off the wall along N, its corners curling off by up to `curl` (the lower ones most), a gentle bow.
    `back`: a cell for the back face (a sheet on a string line), else the front only."""
    V = G.norm(G.cross(N, U))
    if PHONE:
        nu, nv = min(nu, 3), min(nv, 2)
    c, s_ = math.cos(rot), math.sin(rot)
    Ur = G.add(G.mul(U, c), G.mul(V, s_))
    Vr = G.add(G.mul(V, c), G.mul(U, -s_))
    rg = rg or G.rng(1)
    cc = [curl * rg.uniform(0.0, 0.35), curl * rg.uniform(0.0, 0.35), curl * rg.uniform(0.3, 1.0), curl * rg.uniform(0.2, 1.0)]  # tl tr bl br
    bow = rg.uniform(-0.002, 0.003)
    u0, u1, v0, v1 = uvr(cell, sub=sub)

    def P(i, j):
        a, b = i / nu, j / nv              # a across (0 left), b up (0 bottom)
        x, y = (a - 0.5) * w, (b - 0.5) * h
        d = lift + bow * math.sin(math.pi * a) * math.sin(math.pi * b)
        for (ca, cb), k in zip(((0, 1), (1, 1), (0, 0), (1, 0)), cc):
            dist = math.hypot(a - ca, (b - cb) * h / w)
            d += k * max(0.0, 1.0 - dist / 0.32) ** 2
        return G.add(o, G.add(G.add(G.mul(Ur, x), G.mul(Vr, y)), G.mul(N, d)))
    grid = [[P(i, j) for j in range(nv + 1)] for i in range(nu + 1)]
    for i in range(nu):
        for j in range(nv):
            q = [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]]
            uv = [(u0 + (u1 - u0) * i / nu, v0 + (v1 - v0) * j / nv), (u0 + (u1 - u0) * (i + 1) / nu, v0 + (v1 - v0) * j / nv),
                  (u0 + (u1 - u0) * (i + 1) / nu, v0 + (v1 - v0) * (j + 1) / nv), (u0 + (u1 - u0) * i / nu, v0 + (v1 - v0) * (j + 1) / nv)]
            face(m, q, uv, s=cm(cell), want=N, smooth=True)
            if back:
                b0, b1, c0, c1 = uvr(back)
                # mirrored across: the back seen from behind reads left-right the other way
                buv = [(b1 - (b1 - b0) * i / nu, c0 + (c1 - c0) * j / nv), (b1 - (b1 - b0) * (i + 1) / nu, c0 + (c1 - c0) * j / nv),
                       (b1 - (b1 - b0) * (i + 1) / nu, c0 + (c1 - c0) * (j + 1) / nv), (b1 - (b1 - b0) * i / nu, c0 + (c1 - c0) * (j + 1) / nv)]
                face(m, [G.add(p, G.mul(N, -0.0008)) for p in q], buv, s=cm(back), want=G.mul(N, -1), smooth=True)
    corners = {"tl": grid[0][nv], "tr": grid[nu][nv], "bl": grid[0][0], "br": grid[nu][0]}
    return corners, Ur, Vr


def pin(m, p, N, s, r=0.0065):
    """A push pin: a domed plastic head and a short collar standing on the paper."""
    a = G.add(p, G.mul(N, 0.002))
    b = G.add(p, G.mul(N, 0.008))
    m.member(a, b, G.prof_round(r * 0.55, 6), s)
    tip = G.add(p, G.mul(N, 0.016))
    m.member(b, G.add(p, G.mul(N, 0.012)), G.prof_round(r, sg(8, 5)), s)
    m.member(G.add(p, G.mul(N, 0.012)), tip, G.prof_round(r * 0.75, sg(8, 5)), s, caps=True)


def tape(m, p, U, N, ang, l=0.055, w=0.022):
    """A strip of masking tape over a corner (the tape cell)."""
    c, s_ = math.cos(ang), math.sin(ang)
    V = G.norm(G.cross(N, U))
    a = G.add(G.mul(U, c), G.mul(V, s_))
    b = G.add(G.mul(V, c), G.mul(U, -s_))
    o = G.add(p, G.mul(N, 0.0035))
    q = [G.add(o, G.add(G.mul(a, -l / 2), G.mul(b, -w / 2))), G.add(o, G.add(G.mul(a, l / 2), G.mul(b, -w / 2))),
         G.add(o, G.add(G.mul(a, l / 2), G.mul(b, w / 2))), G.add(o, G.add(G.mul(a, -l / 2), G.mul(b, w / 2)))]
    u0, u1, v0, v1 = uvr("tape", inset=3)
    face(m, q, [(u0, v0), (u1, v0), (u1, v1), (u0, v1)], s=PRINT, want=N)


def drawing_on_wall(m, f, u, v, name, rg, how="pins", pin_s=None, w=SHEET_W, h=SHEET_H, wall_w=0.0):
    """A child's drawing on a wall frame `f` (u across, v up, w out of the wall) at (u, v), slightly crooked, pinned or taped."""
    o = f.p(u, v, wall_w)
    U = G.norm(G.sub(f.p(1, 0, 0), f.p(0, 0, 0)))
    N = G.norm(G.sub(f.p(0, 0, 1), f.p(0, 0, 0)))
    rot = math.radians(rg.uniform(-3.5, 3.5) if rg.random() < 0.85 else rg.uniform(-8, 8))
    cn, Ur, Vr = sheet(m, o, U, N, w, h, name, rot, rg)
    if how == "pins":
        for k in ("tl", "tr"):
            q = G.add(cn[k], G.add(G.mul(Ur, 0.018 if k == "tl" else -0.018), G.mul(Vr, -0.018)))
            pin(m, q, N, pin_s[rg.randrange(len(pin_s))])
        if rg.random() < 0.3:
            q = G.add(cn["bl"], G.add(G.mul(Ur, 0.02), G.mul(Vr, 0.02)))
            pin(m, q, N, pin_s[rg.randrange(len(pin_s))])
    else:
        for k in ("tl", "tr", "bl", "br") if rg.random() < 0.5 else ("tl", "tr"):
            ang = (0.75 if k in ("tl", "br") else -0.75) + rg.uniform(-0.25, 0.25)
            tape(m, cn[k], U, N, ang)
    return cn


def cork_board(m, f, u0, u1, v0, v1, frame_s, back_s):
    """A cork board on a wall: granulated cork (the atlas's cork cell) in a pale oak frame with rounded outer arrises, 2.5 cm
    proud of the wall."""
    d = 0.022
    f.box(m, u0, u1, v0, v1, 0.0, d - 0.008, back_s, skip=("-w",))
    U = G.norm(G.sub(f.p(1, 0, 0), f.p(0, 0, 0)))
    N = G.norm(G.sub(f.p(0, 0, 1), f.p(0, 0, 0)))
    c0, c1, t0, t1 = uvr("cork", inset=4)
    q = [f.p(u0 + 0.03, v0 + 0.03, d - 0.005), f.p(u1 - 0.03, v0 + 0.03, d - 0.005), f.p(u1 - 0.03, v1 - 0.03, d - 0.005), f.p(u0 + 0.03, v1 - 0.03, d - 0.005)]
    face(m, q, [(c0, t0), (c1, t0), (c1, t1), (c0, t1)], s=PRINT, want=N)
    fw = 0.035
    for (a, b, c, e) in ((u0, u1, v0, v0 + fw), (u0, u1, v1 - fw, v1), (u0, u0 + fw, v0 + fw, v1 - fw), (u1 - fw, u1, v0 + fw, v1 - fw)):
        f.box(m, a, b, c, e, 0.0, d, frame_s, c=0.006, skip=("-w",))
    return d - 0.005


# ------------------------------------------------------------------------------------------------ the string line --

def string_line(m, a, b, sag, sheets, rg, string_s, peg_s, spring_s):
    """A cotton string from a to b sagging `sag` in the middle (two hooks at the ends), drawings hanging from it on wooden
    pegs, each sheet double-sided (two drawings back to back), hanging plumb under its pegs."""
    n = 16
    pts = []
    for i in range(n + 1):
        t = i / n
        p = G.lerp(a, b, t)
        pts.append((p[0], p[1] - sag * 4 * t * (1 - t), p[2]))
    m.tube(pts, 0.0013, 4, string_s)
    for p in (a, b):
        m.member(p, G.add(p, (0, 0.012, 0)), G.prof_round(0.004, 5), spring_s, caps=True)
    along = G.norm(G.sub(b, a))
    N = G.norm(G.cross(along, (0, 1, 0)))
    L = math.dist(a, b)
    for (t, front, back) in sheets:
        p = G.lerp(a, b, t)
        y = p[1] - sag * 4 * t * (1 - t)
        top = (p[0], y - 0.012, p[2])
        o = G.add(top, (0, -SHEET_H / 2, 0))
        sheet(m, o, along, N, SHEET_W, SHEET_H, front, rot=math.radians(rg.uniform(-1.2, 1.2)), rg=rg, curl=0.004, lift=0.0, back=back, nu=4, nv=3)
        for dx in (-SHEET_W / 2 + 0.05, SHEET_W / 2 - 0.05):
            c = G.add((p[0], y, p[2]), G.mul(along, dx))
            peg(m, c, along, N, peg_s, spring_s)


def peg(m, c, along, N, wood_s, spring_s):
    """A small wooden clothes peg straddling the string and the sheet's top edge: two jaws and a steel spring."""
    up = (0, 1, 0)
    for side in (-1, 1):
        o = G.add(c, G.mul(N, side * 0.0045))
        a = G.add(o, (0, -0.03, 0))
        b = G.add(o, (0, 0.012, 0))
        m.member(a, b, [(-0.004, -0.0035), (0.004, -0.0035), (0.004, 0.0035), (-0.004, 0.0035)], wood_s, up=along, caps=True)
    m.member(G.add(c, G.mul(N, -0.009)), G.add(c, G.mul(N, 0.009)), G.prof_round(0.0022, 5), spring_s)


# ------------------------------------------------------------------------------------------------ furniture --

def rrect(x0, x1, z0, z1, r, n=4):
    """A rounded rectangle outline (x, z), CCW seen from above (x right, -z up)."""
    out = []
    for (cx, cz, a0) in ((x1 - r, z0 + r, -math.pi / 2), (x1 - r, z1 - r, 0.0), (x0 + r, z1 - r, math.pi / 2), (x0 + r, z0 + r, math.pi)):
        for k in range(n + 1):
            a = a0 + (math.pi / 2) * k / n
            out.append((cx + r * math.cos(a), cz + r * math.sin(a)))
    return out


def top_slab(m, x0, x1, z0, z1, y0, y1, r, s, edge_s=None, bevel=0.003):
    n = sg(4, 2)
    """A table top: a rounded-corner slab with a small bevel all round the top arris (a slightly smaller cap on a body)."""
    m.extrude(rrect(x0, x1, z0, z1, r, n), y0, y1 - bevel, edge_s or s, top=False, bottom=True)
    lo = rrect(x0, x1, z0, z1, r, n)
    hi = rrect(x0 + bevel, x1 - bevel, z0 + bevel, z1 - bevel, max(0.002, r - bevel), n)
    for i in range(len(lo)):
        j = (i + 1) % len(lo)
        q = [(lo[i][0], y1 - bevel, lo[i][1]), (lo[j][0], y1 - bevel, lo[j][1]), (hi[j][0], y1, hi[j][1]), (hi[i][0], y1, hi[i][1])]
        n = G.poly_normal(q)
        mid = ((lo[i][0] + lo[j][0]) / 2 - (x0 + x1) / 2, 0, (lo[i][1] + lo[j][1]) / 2 - (z0 + z1) / 2)
        if G.dot(n, mid) + n[1] < 0:
            q.reverse()
        m.poly(q, edge_s or s, smooth=True)
    pts = [(x, y1, z) for x, z in hi]
    if G.poly_normal(pts)[1] < 0:
        pts.reverse()
    m.poly(pts, s)


def pupil_desk(top_s, edge_s, steel_s, ply_s, black_s):
    """A pupil's single desk (0.5 deep along x, 0.8 wide along z; the pupil sits on the +x side): a 22 mm beech laminate top
    with rounded corners and a bevelled arris, a birch-ply book tray under it open to the pupil, powder-coated 25 mm tubular
    steel side frames with T-feet, black glides and end caps, a stretcher at the front, a bag hook on one side."""
    m = Mesh("desk")
    top_slab(m, -0.25, 0.25, -0.4, 0.4, 0.698, 0.72, 0.035, top_s.u((0, 0, 1)), edge_s)
    rt = G.prof_round(0.0125, sg(8, 5))
    for z in (-0.355, 0.355):
        for x in (-0.17, 0.17):
            m.member((x, 0.035, z), (x, 0.69, z), rt, steel_s)
        m.member((-0.2, 0.682, z), (0.2, 0.682, z), G.prof_box(0.02, 0.025), steel_s)
        m.member((-0.235, 0.022, z), (0.235, 0.022, z), G.prof_round(0.014, sg(8, 5)), steel_s)
        for x in (-0.235, 0.235):
            if not PHONE:
                m.member((x, 0.022, z), (x + (0.012 if x > 0 else -0.012), 0.022, z), G.prof_round(0.015, sg(8, 5)), black_s, caps=True)
            m.box(x - 0.02, x + 0.02, 0.0, 0.008, z - 0.013, z + 0.013, black_s, skip=("-y",))
    m.member((-0.17, 0.24, -0.355), (-0.17, 0.24, 0.355), G.prof_round(0.011, 8), steel_s)
    # the book tray: a ply bottom with a lip at the front and the sides (open toward the pupil, +x)
    m.box(-0.2, 0.16, 0.585, 0.597, -0.33, 0.33, ply_s, skip=())
    m.box(-0.2, -0.188, 0.597, 0.66, -0.33, 0.33, ply_s)
    for z in (-0.33, 0.318):
        m.box(-0.188, 0.16, 0.597, 0.66, z, z + 0.012, ply_s)
    if PHONE:
        return m
    # the bag hook on the -z side frame
    m.member((0.17, 0.62, -0.367), (0.17, 0.62, -0.395), G.prof_round(0.004, 5), steel_s)
    m.member((0.17, 0.62, -0.395), (0.17, 0.645, -0.398), G.prof_round(0.004, 5), steel_s, caps=True)
    return m


def shell_panel(m, fn, nu, nv, t, s, want_fn):
    """A thin moulded panel: the front surface fn(a, b) (a, b in 0..1), the back offset by `t` along the normal, the rim."""
    def nrm(a, b):
        e = 1e-3
        p = fn(a, b)
        du = G.sub(fn(min(1, a + e), b), fn(max(0, a - e), b))
        dv = G.sub(fn(a, min(1, b + e)), fn(a, max(0, b - e)))
        n = G.norm(G.cross(du, dv))
        return n if G.dot(n, want_fn(p)) >= 0 else G.mul(n, -1)
    F = [[fn(i / nu, j / nv) for j in range(nv + 1)] for i in range(nu + 1)]
    B = [[G.add(F[i][j], G.mul(nrm(i / nu, j / nv), -t)) for j in range(nv + 1)] for i in range(nu + 1)]
    for i in range(nu):
        for j in range(nv):
            q = [F[i][j], F[i + 1][j], F[i + 1][j + 1], F[i][j + 1]]
            c = G.mul(G.add(G.add(q[0], q[1]), G.add(q[2], q[3])), 0.25)
            w = want_fn(c)
            if G.dot(G.poly_normal(q), w) < 0:
                q.reverse()
            m.poly(q, s, smooth=True)
            qb = [B[i][j], B[i + 1][j], B[i + 1][j + 1], B[i][j + 1]]
            if G.dot(G.poly_normal(qb), w) > 0:
                qb.reverse()
            m.poly(qb, s, smooth=True)
    rim = [(i, 0) for i in range(nu)] + [(nu, j) for j in range(nv)] + [(i, nv) for i in range(nu, 0, -1)] + [(0, j) for j in range(nv, 0, -1)]
    cen = F[nu // 2][nv // 2]
    for k in range(len(rim)):
        (i0, j0), (i1, j1) = rim[k], rim[(k + 1) % len(rim)]
        q = [F[i0][j0], F[i1][j1], B[i1][j1], B[i0][j0]]
        mid = G.mul(G.add(G.add(q[0], q[1]), G.add(q[2], q[3])), 0.25)
        if G.dot(G.poly_normal(q), G.sub(mid, cen)) < 0:
            q.reverse()
        m.poly(q, s, smooth=True)


def pupil_chair(ply_s, steel_s, black_s, rivet_s, w=0.38):
    """A pupil's chair facing +z (as b1_room.chair_kind): a moulded beech-ply seat 38 x 37 cm, top 0.45, dished with a waterfall
    front edge; a curved ply backrest 36 x 17 cm on the rear legs, leaning back, two rivets; a 20 mm tubular steel frame —
    front legs, rear legs splayed back running up into the back posts, side rails under the seat — on black glides."""
    m = Mesh("pchair")
    h = w / 2

    def seat(a, b):
        x = (a - 0.5) * w
        z = -0.17 + b * 0.37
        y = 0.45 - 0.012 * (1 - (2 * a - 1) ** 2) * math.sin(math.pi * min(1, b * 1.1)) * 0.9
        if b > 0.86:
            t = (b - 0.86) / 0.14
            y -= 0.03 * t * t
            z -= 0.012 * t * t
        if b < 0.08:
            y += 0.008 * (1 - b / 0.08)
        return (x, y, z)
    shell_panel(m, seat, sg(6, 3), sg(7, 4), 0.011, ply_s.u((0, 0, 1)), lambda p: (0, 1, 0))

    R = 0.42

    def back(a, b):
        ang = (a - 0.5) * (0.36 / R)
        x = R * math.sin(ang)
        z = -0.2 + (R - R * math.cos(ang)) - b * 0.022
        y = 0.63 + b * 0.17
        return (x, y, z)
    shell_panel(m, back, sg(7, 4), sg(3, 1), 0.01, ply_s.u((1, 0, 0)), lambda p: (0, 0.2, 1))
    rt = G.prof_round(0.01, sg(8, 5))
    for x in (-h + 0.025, h - 0.025):
        m.member((x, 0.008, 0.17), (x, 0.437, 0.165), rt, steel_s)
        m.tube([(x, 0.008, -0.2), (x, 0.437, -0.165), (x, 0.6, -0.178), (x * 0.96, 0.76, -0.205)], 0.01, sg(8, 5), steel_s)
        m.member((x, 0.437, -0.165), (x, 0.437, 0.165), rt, steel_s)
        for z in (0.17, -0.2):
            m.cyl(x, z, 0.012, 0.0, 0.01, sg(8, 5), black_s)
        for y in (0.68, 0.76) if not PHONE else ():
            p = (x * 0.97, y, -0.2)
            m.sphere(p[0], p[1], p[2] - 0.004, 0.006, rivet_s, n=6, rings=3)
    m.member((-h + 0.025, 0.2, -0.18), (h - 0.025, 0.2, -0.18), rt, steel_s)
    return m


def book(m, x0, y0, z0, w, h, d, cell, axis="x", lean=0.0):
    """A picture book standing on a shelf, its spine facing -x (axis 'x': the reading shelf, books along z) or -z (axis 'z':
    the cubbies, books along x): the spine (two facets, the atlas spine cell), the covers in the spine's colour (COLOR_0 over the
    atlas's blank paper), the page block's top (the atlas page edges)."""
    col = G.hexc(SPINE_COLS[cell % len(SPINE_COLS)])
    tint = (col[0], col[1], col[2], 1.0)
    sw, sh = ATLAS["spine"]["w"], ATLAS["spine"]["h"]
    sp = {"atlas": "print", "x": CELLS["spines"]["x"] + cell * sw, "y": CELLS["spines"]["y"], "w": sw, "h": sh}
    U0, U1, V0, V1 = uvr(sp, inset=1.5)
    if axis in ("z", "xp"):
        U0, U1 = U1, U0  # (a reader facing these spines has +a on the left: keep the titles unmirrored)
    bl0, bl1, bt0, bt1 = uvr(ATLAS["blank"], inset=4)
    pg0, pg1, pq0, pq1 = uvr("pages", inset=3)

    def X(a, y, b):
        # a across the spine (0..w), b depth from the spine (0..d), y up; lean: rotate about the bottom spine edge
        yy = y * math.cos(lean) + a * math.sin(lean)
        aa = a * math.cos(lean) - y * math.sin(lean)
        if axis == "x":
            return (x0 + b, y0 + yy, z0 + aa)
        if axis == "xp":
            return (x0 - b, y0 + yy, z0 + aa)
        return (x0 + aa, y0 + yy, z0 + b)
    out_spine = {"x": (-1, 0, 0), "xp": (1, 0, 0)}.get(axis, (0, 0, -1))
    r = min(0.004, w * 0.3)
    xs = [0.0, w / 2, w] if not PHONE else [0.0, w]
    bs = [0.0, -r, 0.0] if not PHONE else [0.0, 0.0]
    for i in range(len(xs) - 1):
        q = [X(xs[i], 0, bs[i]), X(xs[i + 1], 0, bs[i + 1]), X(xs[i + 1], h, bs[i + 1]), X(xs[i], h, bs[i])]
        ua, ub = U0 + (U1 - U0) * i / (len(xs) - 1), U0 + (U1 - U0) * (i + 1) / (len(xs) - 1)
        face(m, q, [(ua, V0), (ub, V0), (ub, V1), (ua, V1)], s=PRINT, want=out_spine, smooth=True)
    side = (0, 0, 1) if axis in ("x", "xp") else (1, 0, 0)
    # the front cover (the atlas's printed cover for this title) on the side where, seen from outside, the spine is on the
    # left (axis x: the +a side; z and xp: the -a side, their frames being mirrored); the back cover plain in the spine's colour
    front_a = w if axis == "x" else 0.0
    cvw, cvh, ccols = ATLAS["cover"]["w"], ATLAS["cover"]["h"], ATLAS["cover"]["cols"]
    k = cell % len(SPINE_COLS)
    cv = {"atlas": "print", "x": CELLS["covers"]["x"] + (k % ccols) * cvw, "y": CELLS["covers"]["y"] + (k // ccols) * cvh, "w": cvw, "h": cvh}
    c0, c1, e0, e1 = uvr(cv, inset=2)
    for (a, sgn) in ((0.0, -1), (w, 1)):
        q = [X(a, 0, 0), X(a, 0, d), X(a, h, d), X(a, h, 0)]
        if a == front_a:
            face(m, q, [(c0, e0), (c1, e0), (c1, e1), (c0, e1)], s=PRINT, want=G.mul(side, sgn))
        else:
            face(m, q, [(bl0, bt0), (bl1, bt0), (bl1, bt1), (bl0, bt1)], s=PRINT, want=G.mul(side, sgn), cols=[tint] * 4)
    # fore-edge (the back, against the shelf's back: still drawn, a gap may show it) and the top
    if not PHONE:
        face(m, [X(0, 0, d), X(w, 0, d), X(w, h, d), X(0, h, d)], [(pg0, pq0), (pg1, pq0), (pg1, pq1), (pg0, pq1)], s=PRINT, want=G.mul(out_spine, -1))
    bt = 0.0018
    face(m, [X(bt, h - 0.002, 0.002), X(w - bt, h - 0.002, 0.002), X(w - bt, h - 0.002, d - 0.002), X(bt, h - 0.002, d - 0.002)],
         [(pg0, pq1), (pg0, pq0), (pg1, pq0), (pg1, pq1)], s=PRINT, want=(0, 1, 0))
    for a in (0.0, w - bt) if not PHONE else ():
        face(m, [X(a, h, 0), X(a + bt, h, 0), X(a + bt, h, d), X(a, h, d)], [(bl0, bt0), (bl1, bt0), (bl1, bt1), (bl0, bt1)], s=PRINT, want=(0, 1, 0), cols=[tint] * 4)


def book_run(m, x0, x1, y, z_front, depth, rg, axis="z", hmin=0.2, hmax=0.3, gap_end=0.03):
    """Books standing along a shelf from x0 to x1 (axis 'z': spines facing -z at z_front; axis 'x': along z, spines at x
    `z_front` facing -x), now and then one leaning on its neighbour."""
    u = x0 + 0.004
    while u < x1 - gap_end:
        w = rg.uniform(0.008, 0.024) if rg.random() < 0.7 else rg.uniform(0.024, 0.04)
        if PHONE:
            w *= 1.7
        h = rg.uniform(hmin, hmax)
        d = min(depth, rg.uniform(0.17, 0.25))
        cell = rg.randrange(len(SPINE_COLS))
        push = rg.uniform(0.0, 0.02)
        if axis == "z":
            book(m, u, y, z_front + push, w, h, d, cell, axis="z")
        else:
            book(m, z_front + push, y, u, w, h, d, cell, axis="x")
        u += w + rg.uniform(0.0005, 0.003)


def plastic_bin(m, x0, x1, y0, y1, z0, z1, s, label, rg, dark_s):
    """A tapered plastic tub (open top, rolled rim, a finger recess at the front, a laminated label): front face at z0."""
    t = 0.012
    bot = (x0 + t, x1 - t, z0 + t, z1 - t)
    topr = (x0, x1, z0, z1)
    lo = [(bot[0], bot[2]), (bot[1], bot[2]), (bot[1], bot[3]), (bot[0], bot[3])]
    hi = [(topr[0], topr[2]), (topr[1], topr[2]), (topr[1], topr[3]), (topr[0], topr[3])]
    for i in range(4):
        j = (i + 1) % 4
        q = [(lo[i][0], y0, lo[i][1]), (lo[j][0], y0, lo[j][1]), (hi[j][0], y1, hi[j][1]), (hi[i][0], y1, hi[i][1])]
        c = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
        mid = G.mul(G.add(G.add(q[0], q[1]), G.add(q[2], q[3])), 0.25)
        if G.dot(G.poly_normal(q), G.sub(mid, c)) < 0:
            q.reverse()
        m.poly(q, s)
    m.poly([(lo[0][0], y0, lo[0][1]), (lo[1][0], y0, lo[1][1]), (lo[2][0], y0, lo[2][1]), (lo[3][0], y0, lo[3][1])], s)
    # the inside (walls a shade darker, the floor of the tub) so it reads hollow from above, and the rolled rim
    inner = s.t(tuple(c * 0.78 for c in s.col))
    li = [(bot[0] + 0.004, bot[2] + 0.004), (bot[1] - 0.004, bot[2] + 0.004), (bot[1] - 0.004, bot[3] - 0.004), (bot[0] + 0.004, bot[3] - 0.004)]
    hi2 = [(topr[0] + 0.004, topr[2] + 0.004), (topr[1] - 0.004, topr[2] + 0.004), (topr[1] - 0.004, topr[3] - 0.004), (topr[0] + 0.004, topr[3] - 0.004)]
    c = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    for i in range(4):
        j = (i + 1) % 4
        q = [(li[i][0], y0 + 0.006, li[i][1]), (li[j][0], y0 + 0.006, li[j][1]), (hi2[j][0], y1, hi2[j][1]), (hi2[i][0], y1, hi2[i][1])]
        mid = G.mul(G.add(G.add(q[0], q[1]), G.add(q[2], q[3])), 0.25)
        if G.dot(G.poly_normal(q), G.sub(mid, c)) > 0:
            q.reverse()
        m.poly(q, inner)
    m.poly([(li[3][0], y0 + 0.006, li[3][1]), (li[2][0], y0 + 0.006, li[2][1]), (li[1][0], y0 + 0.006, li[1][1]), (li[0][0], y0 + 0.006, li[0][1])], inner)
    ring = [(x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1), (x0, y1, z0)]
    m.tube(ring, 0.006, sg(5, 3), s)
    # finger recess and label on the front
    fz = z0 - 0.0005
    cx = (x0 + x1) / 2
    hy = y1 - 0.03
    m.poly([(cx + 0.04, hy - 0.012, fz), (cx - 0.04, hy - 0.012, fz), (cx - 0.04, hy + 0.012, fz), (cx + 0.04, hy + 0.012, fz)], dark_s)
    lw, lh = min(0.12, (x1 - x0) * 0.6), 0.045
    ly = y0 + (y1 - y0) * 0.38
    l0, l1, k0, k1 = uvr("labels", sub=(label / 8, 0, (label + 1) / 8, 1), inset=1)
    face(m, [(cx - lw / 2, ly - lh / 2, z0 - 0.0012), (cx + lw / 2, ly - lh / 2, z0 - 0.0012), (cx + lw / 2, ly + lh / 2, z0 - 0.0012), (cx - lw / 2, ly + lh / 2, z0 - 0.0012)],
         [(l1, k0), (l0, k0), (l0, k1), (l1, k1)], s=PRINT, want=(0, 0, -1))  # (seen from the room, looking +z: its right is -x)


def exercise_book(m, cx, y, cz, yaw, cover_s, rg):
    """An open exercise book (공책) on a desk: two pages (the atlas spread with a child's 받아쓰기), a coloured cover peeking
    out, the gutter dipping a little."""
    w, d = 0.34, 0.24
    u0, u1, v0, v1 = uvr("exercise", inset=3)
    c, s_ = math.cos(yaw), math.sin(yaw)

    def P(a, b, yy):
        x, z = (a - 0.5) * w, (b - 0.5) * d
        return (cx + x * c - z * s_, y + yy, cz + x * s_ + z * c)
    face(m, [P(-0.012, 1.025, 0.0012), P(1.012, 1.025, 0.0012), P(1.012, -0.025, 0.0012), P(-0.012, -0.025, 0.0012)], None, s=cover_s, want=(0, 1, 0))
    for (a0, a1) in ((0.0, 0.5), (0.5, 1.0)):
        n = sg(3, 1)
        for k in range(n):
            aa, ab = a0 + (a1 - a0) * k / n, a0 + (a1 - a0) * (k + 1) / n
            ya = 0.004 + 0.004 * math.sin(math.pi * min(aa, 1 - aa) * 2) * 0.6
            yb = 0.004 + 0.004 * math.sin(math.pi * min(ab, 1 - ab) * 2) * 0.6
            q = [P(aa, 1.0, ya), P(ab, 1.0, yb), P(ab, 0.0, yb), P(aa, 0.0, ya)]
            uv = [(u0 + (u1 - u0) * aa, v0), (u0 + (u1 - u0) * ab, v0), (u0 + (u1 - u0) * ab, v1), (u0 + (u1 - u0) * aa, v1)]
            face(m, q, uv, s=PRINT, want=(0, 1, 0), smooth=True)


def pencil(m, a, b, body_s, wood_s, lead_s):
    """A hexagonal pencil from a (end) to b (tip): painted body, sharpened wood cone, graphite point."""
    L = math.dist(a, b)
    d = G.norm(G.sub(b, a))
    k = G.add(a, G.mul(d, L - 0.02))
    m.member(a, k, [(0.0035 * math.cos(math.pi / 3 * i), 0.0035 * math.sin(math.pi / 3 * i)) for i in range(6)], body_s, caps=True)
    t = G.add(a, G.mul(d, L - 0.004))
    m.member(k, t, [(0.0022 * math.cos(math.pi / 3 * i), 0.0022 * math.sin(math.pi / 3 * i)) for i in range(6)], wood_s)
    m.member(t, b, G.prof_round(0.0008, 4), lead_s, caps=True)


# ------------------------------------------------------------------------------------------------ plants --

def leafy_plant(m, x, y, z, pot_s, soil_s, leaf_s, leaf2_s, h=0.32, rg=None, flowers=None, flower_s=None):
    """A real pot plant (not balls): a terracotta pot with a rim and soil, a dozen broad leaves on petioles (each a cupped
    elliptical blade with a folded midrib, two-sided), and for a geranium a few umbels of five-petalled flowers on stalks."""
    rg = rg or G.rng(3)
    pr = 0.07
    m.lathe([(pr * 0.72, 0.0), (pr * 0.95, 0.11), (pr * 1.08, 0.112), (pr * 1.08, 0.135), (pr * 0.98, 0.135), (pr * 0.96, 0.12)], sg(16, 10), pot_s, x, z, y)   # (2026-11-28: a 7-sided pot on the phone)
    m.lathe([(pr * 0.96, 0.12), (0.0, 0.118)], sg(16, 10), soil_s, x, z, y)
    n = sg(11, 6)
    for k in range(n):
        ang = k * 2.4 + rg.uniform(-0.3, 0.3)
        L = h * rg.uniform(0.35, 0.6)
        up = rg.uniform(0.25, 0.9)
        base = (x, y + 0.12, z)
        dirv = (math.cos(ang), 0, math.sin(ang))
        tipp = G.add(base, (dirv[0] * L * (1 - up * 0.5), L * up + 0.03, dirv[2] * L * (1 - up * 0.5)))
        m.member(base, tipp, G.prof_round(0.0028, 4), leaf2_s)
        # the blade: round-ish (geranium) or oval, cupped, a midrib fold
        bl = h * rg.uniform(0.18, 0.26)
        bw = bl * (0.95 if flowers else 0.55)
        fw = (dirv[0], -0.35, dirv[2])
        fw = G.norm(fw)
        sd = G.norm(G.cross(fw, (0, 1, 0)))
        upn = G.norm(G.cross(sd, fw))
        segs = sg(8, 5)
        ring = []
        for i in range(segs):
            t = i / segs * 2 * math.pi
            a = (math.cos(t) * 0.5 + 0.5) * bl
            b = math.sin(t) * bw * 0.5 * (1 - 0.15 * math.cos(t))
            cup = 0.12 * bw * (abs(b) / (bw * 0.5 + 1e-6)) ** 2
            p = G.add(tipp, G.add(G.mul(fw, a), G.add(G.mul(sd, b), G.mul(upn, cup))))
            ring.append(p)
        cen = G.add(tipp, G.add(G.mul(fw, bl * 0.5), G.mul(upn, -0.004)))
        s_leaf = leaf_s if k % 3 else leaf2_s
        for i in range(segs):
            q = [cen, ring[i], ring[(i + 1) % segs]]
            m.poly(q, s_leaf, smooth=True)
            m.poly([G.add(p, G.mul(upn, -0.0015)) for p in q[::-1]], s_leaf, smooth=True)
    if flowers:
        for k in range(flowers if not PHONE else 2):
            ang = k * 2.1 + 0.5
            top = (x + math.cos(ang) * 0.05, y + 0.12 + h * rg.uniform(0.75, 0.95), z + math.sin(ang) * 0.05)
            m.member((x, y + 0.12, z), top, G.prof_round(0.0025, 4), leaf2_s)
            nf = sg(7, 4)
            for j in range(nf):
                a2 = j * 2.4
                rr = 0.026 * math.sqrt((j + 0.5) / nf)
                c = G.add(top, (math.cos(a2) * rr, 0.006 + 0.01 * (1 - rr / 0.028), math.sin(a2) * rr))
                pts = []
                for p5 in range(6):
                    t = p5 / 6 * 2 * math.pi
                    rad = 0.0105 if p5 % 2 == 0 else 0.0075
                    pts.append(G.add(c, (math.cos(t) * rad, 0.0, math.sin(t) * rad)))
                m.poly(pts[::-1], flower_s)
                m.poly(pts, flower_s)


# ------------------------------------------------------------------------------------------------ fixtures --

def radiator(m, f, uc, v0, w, h, white_s, valve_s):
    """A white panel radiator on wall brackets (5 cm deep): vertical flutes, a top grille, end panels, a thermostatic valve and
    short chrome pipes to the floor."""
    u0, u1 = uc - w / 2, uc + w / 2
    f.box(m, u0, u1, v0, v0 + h, 0.012, 0.045, white_s, skip=("-w",))
    n = int(w / sg(0.033, 0.066))
    for k in range(n + 1):
        u = u0 + 0.01 + (w - 0.02) * k / n
        f.box(m, u - 0.004, u + 0.004, v0 + 0.02, v0 + h - 0.02, 0.045, 0.05, white_s, skip=("-w",))
    for k in range(int(w / sg(0.012, 0.03))):
        u = u0 + 0.01 + k * 0.012
        f.box(m, u, u + 0.006, v0 + h, v0 + h + 0.003, 0.015, 0.045, white_s, skip=("-v",))
    vu = u1 + 0.05
    f.box(m, vu - 0.012, vu + 0.012, v0 + 0.02, v0 + 0.09, 0.02, 0.044, valve_s)
    f.box(m, vu - 0.02, vu + 0.02, v0 + 0.09, v0 + 0.15, 0.015, 0.05, white_s)
    for uu in (vu, u0 - 0.04):
        f.box(m, uu - 0.008, uu + 0.008, 0.0, v0 + 0.05, 0.025, 0.04, valve_s)


def switch_plate(m, f, u, v, white_s, n=2):
    """A light switch plate (8 x 8 cm, n rockers) on a wall."""
    f.box(m, u - 0.04 * n / 2 - 0.02, u + 0.04 * n / 2 + 0.02, v - 0.04, v + 0.04, 0.0, 0.009, white_s, c=0.003, skip=("-w",))
    for k in range(n):
        a = u - 0.04 * n / 2 + k * 0.04 + 0.004
        f.box(m, a, a + 0.032, v - 0.026, v + 0.026, 0.009, 0.014, white_s, skip=("-w",))


def socket(m, f, u, v, white_s, dark_s):
    """A Schuko socket outlet (8 x 8 cm) with its round recess and two holes."""
    f.box(m, u - 0.04, u + 0.04, v - 0.04, v + 0.04, 0.0, 0.01, white_s, c=0.003, skip=("-w",))
    pts = [f.p(u + 0.022 * math.cos(2 * math.pi * k / 12), v + 0.022 * math.sin(2 * math.pi * k / 12), 0.0102) for k in range(12)]
    m.poly(pts, dark_s) if G.dot(G.poly_normal(pts), G.sub(f.p(0, 0, 1), f.p(0, 0, 0))) > 0 else m.poly(pts[::-1], dark_s)


def clock_face(m, f, cx, cy, r, w):
    """The clock's dial (the atlas clock cell) as a disc on the frame."""
    n = 36
    u0, u1, v0, v1 = uvr("clock", inset=2)
    cu, cv = (u0 + u1) / 2, (v0 + v1) / 2
    ru, rv = (u1 - u0) / 2 * 0.98, (v1 - v0) / 2 * 0.98
    pts, uv = [], []
    for k in range(n):
        a = 2 * math.pi * k / n
        pts.append(f.p(cx + r * math.cos(a), cy + r * math.sin(a), w))
        uv.append((cu + ru * math.cos(a), cv + rv * math.sin(a)))
    face(m, pts, uv, s=PRINT, want=G.sub(f.p(0, 0, 1), f.p(0, 0, 0)))


def globe(m, x, y, z, r, stand_s, ring_s):
    """A school globe: the library's world chart (M_globe, Natural Earth) on a sphere tilted 23.5 deg in a half meridian,
    on a turned base."""
    tilt = math.radians(23.5)

    def surf(u, v):
        lon = (u - 0.5) * math.tau + math.radians(130)
        lat = (v - 0.5) * math.pi
        px, py, pz = r * math.cos(lat) * math.sin(lon), r * math.sin(lat), r * math.cos(lat) * math.cos(lon)
        return (x + px * math.cos(tilt) - py * math.sin(tilt), y + px * math.sin(tilt) + py * math.cos(tilt), z + pz)
    nu, nv = sg(28, 16), sg(14, 8)
    for j in range(nv):
        v0, v1 = j / nv, (j + 1) / nv
        for i in range(nu):
            u0, u1 = i / nu, (i + 1) / nu
            if j == 0:
                uv = [((u0 + u1) / 2, v0), (u1, v1), (u0, v1)]
            elif j == nv - 1:
                uv = [(u0, v0), (u1, v0), ((u0 + u1) / 2, v1)]
            else:
                uv = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
            m.poly([surf(u, v) for u, v in uv], GLOBE, uv=uv, smooth=True)
    ring = []
    for k in range(19):
        a = -math.pi / 2 + math.pi * k / 18
        q = ((r + 0.012) * math.cos(a), (r + 0.012) * math.sin(a))
        ax = (-math.sin(tilt), math.cos(tilt))
        nx = (math.cos(tilt), math.sin(tilt))
        ring.append((x - nx[0] * q[0] + ax[0] * q[1], y - nx[1] * q[0] + ax[1] * q[1], z))
    for a_, b_ in zip(ring, ring[1:]):
        m.member(a_, b_, G.prof_box(0.008, 0.014), ring_s)
    return ring


# ------------------------------------------------------------------------------------------------ bunting, pendants --

def pennant(m, p, q, drop, s, hem_s, thread_s, N, rg, stitches=True):
    """A cotton pennant hanging from the string between p and q: a folded hem over the string, a triangle of cloth 2 mm
    thick that billows a little and whose tip swings forward, a white running stitch along its two long edges."""
    m.member(G.add(p, (0, -0.006, 0)), G.add(q, (0, -0.006, 0)), [(-0.003, -0.009), (0.003, -0.009), (0.003, 0.009), (-0.003, 0.009)], hem_s)
    top_l, top_r = G.add(p, (0, -0.014, 0)), G.add(q, (0, -0.014, 0))
    mid = G.lerp(top_l, top_r, 0.5)
    sway = rg.uniform(-0.02, 0.02)
    tip = G.add(G.add(mid, (0, -drop, 0)), G.mul(N, 0.02 + sway))
    nu, nv = 2, sg(4, 2)

    def P(i, j, off):
        u, v = i / nu, j / nv
        a = G.lerp(G.lerp(top_l, top_r, u), tip, v)
        bil = 0.006 * math.sin(math.pi * u) * (1 - v) + 0.01 * v * v
        return G.add(a, G.mul(N, bil + off))
    for side, off in ((1, 0.001), (-1, -0.001)):
        want = G.mul(N, side)
        for j in range(nv):
            for i in range(nu):
                q4 = [P(i, j, off), P(i + 1, j, off), P(i + 1, j + 1, off), P(i, j + 1, off)]
                c = G.mul(G.add(G.add(q4[0], q4[1]), G.add(q4[2], q4[3])), 0.25)
                if G.dot(G.poly_normal(q4), want) < 0:
                    q4.reverse()
                m.poly(q4, s, smooth=True)
    for i in (0, nu):
        for j in range(nv):
            q4 = [P(i, j, 0.001), P(i, j + 1, 0.001), P(i, j + 1, -0.001), P(i, j, -0.001)]
            out = G.sub(G.lerp(top_l, top_r, i / nu), mid)
            if G.dot(G.poly_normal(q4), out) < 0:
                q4.reverse()
            m.poly(q4, s)
    if stitches:
        for i, inset in ((0, 0.08), (nu, -0.08)):
            pts = [G.add(P(i, j, 0.0016), G.mul(G.sub(mid, G.lerp(top_l, top_r, i / nu)), abs(inset) * (1 - j / nv))) for j in range(nv)]
            for a_, b_ in zip(pts, pts[1:]):
                m.member(a_, b_, G.prof_box(0.0016, 0.0006), thread_s, up=N)


def bunting_line(m, pts_attach, sag, n_per_span, cols, string_s, thread_s, rg, stitches=True, drop=0.19):
    """A bunting string tied between attachment points (each span sagging `sag`), pennants along it."""
    for a, b in zip(pts_attach, pts_attach[1:]):
        n = n_per_span * 2
        pts = []
        for t in range(n + 1):
            u = t / n
            p = G.lerp(a, b, u)
            pts.append((p[0], p[1] - sag * 4 * u * (1 - u), p[2]))
        m.tube(pts, 0.0018, 4, string_s)
        along = G.norm(G.sub(b, a))
        N = G.norm(G.cross(along, (0, 1, 0)))
        for k in range(n_per_span):
            p0, p1 = pts[2 * k], pts[2 * k + 1]
            p0 = G.lerp(p0, p1, 0.12)
            s = cols[rg.randrange(len(cols))]
            pennant(m, p0, p1, drop, s, s, thread_s, N, rg, stitches)
    for a in pts_attach:
        m.sphere(a[0], a[1] + 0.006, a[2], 0.01, thread_s, n=8, rings=4)


def school_pendant(kit, m, x, z, H, drop, rose_s, cord_s, cap_s, opal_s, r=0.17, segs=28):
    """A school pendant: a white ceiling rose, a fabric cord, a brass gallery and a smooth opal-glass globe (opaque white by
    day, glowing at night: the night glow is a shell a hair outside the globe)."""
    y = H - drop
    m.lathe([(0.0, 0.0), (0.065, 0.0), (0.065, 0.012), (0.05, 0.028), (0.012, 0.034), (0.0, 0.034)], segs, rose_s, x, z, H - 0.034)
    m.member((x, H - 0.03, z), (x, y + r + 0.05, z), G.prof_round(0.0032, 6), cord_s)
    m.lathe([(0.0, 0.0), (0.006, 0.0), (0.008, 0.012), (0.03, 0.03), (0.055, 0.045), (0.06, 0.058), (0.0, 0.058)], segs, cap_s, x, z, y + r - 0.012)
    # the opal glass: a smooth sphere (the lathe's consistent winding) whose UVs are moved onto the print atlas's blank paper cell
    # (an even, warm milky white; the plaster set's mottling read as a paper lantern)
    u0, u1, v0, v1 = uvr(ATLAS["blank"], inset=6)
    n0 = len(m.polys)
    m.sphere(x, y, z, r, PRINT, n=segs, rings=segs // 2)
    new = m.polys[n0:]
    umax = max(max(uu for uu, _ in pp.uv) for pp in new) or 1.0
    vmax = max(max(vv for _, vv in pp.uv) for pp in new) or 1.0
    for pp in new:
        pp.uv = [(u0 + (u1 - u0) * min(1.0, max(0.0, uu / umax)), v0 + (v1 - v0) * min(1.0, max(0.0, vv / vmax))) for uu, vv in pp.uv]
        pp.col = [(1.0, 0.99, 0.96, 1.0)] * len(pp.pts)
    # the night glow: a shell with the globe's own tessellation a hair outside it (a coarser shell cut through the globe in
    # diamonds, a larger one showed as a faceted halo by day)
    kit.glow("pendants").sphere(x, y, z, r * 1.008, P_GLASS_LAMP, n=segs, rings=segs // 2)
    # (the bake's lamp just under the globe: the opal shell is opaque to Cycles and would hold the light in)
    kit.lights.append(("point", x, y - r - 0.04, z, (1.0, 0.86, 0.66), 60.0))
    kit.dayfill.append((x, H - 0.3, z, 2.0, 70.0))
