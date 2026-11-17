"""B1 (lots v2: school + library) — the architectural parts both kits share (pure python on b1_geom.py, lot LOCAL frame):
facade frames, walls with openings, sash windows with real reveals, glazing bars, sills and a shallow lit room behind the
glass, round-arched windows, panelled double doors on hinges, backed park benches, lanterns on posts, flower beds and window
boxes with 3D flowers, potted plants. Everything brand-new (owner 2026-11-17 "헌집은 없어야 해"): crisp chamfers, fresh paint.
"""
import math

import b1_geom as G
from b1_geom import Mesh, S


class Kit:
    """What a lot kit hands to b1_blender.py."""

    def __init__(self, lot):
        self.lot = lot
        self.S = Mesh("shell")
        self.D = Mesh("structure")
        self.G = Mesh("goods")
        self.kinds = {}
        self.inst = {}
        self.night = {}
        self.doors = {}
        self.letters = []
        self.lights = []
        self.sweeps = []
        self.extra_props = []
        self.mats = {}
        self.roof_slabs = []
        self.ground = Mesh("ground")
        self.dayfill = []  # render-only daylight bounce inside rooms seen through glass: (x, y, z, size, W)

    def place(self, kind, mesh, x, y, z, yaw=0.0):
        if kind not in self.kinds:
            self.kinds[kind] = mesh
            self.inst[kind] = []
        self.inst[kind].append((x, y, z, yaw))

    def glow(self, part):
        if part not in self.night:
            self.night[part] = Mesh("night_" + part)
        return self.night[part]


GLASS = S("M_glass")
WARM = G.lin(1.0, 0.78, 0.5)       # 3000 K window glow
LAMP = G.lin(1.0, 0.86, 0.62)


class F:
    """A facade frame: P(u, v, w) = o + U u + up v + W w (U = the viewer's right seen from outside, W = outward)."""

    def __init__(self, o, U, W):
        self.o, self.U, self.W = o, U, W

    def p(self, u, v, w=0.0):
        return (self.o[0] + self.U[0] * u + self.W[0] * w, self.o[1] + v, self.o[2] + self.U[2] * u + self.W[2] * w)

    def quad(self, m, u0, u1, v0, v1, w, s, out=1):
        q = [self.p(u0, v0, w), self.p(u1, v0, w), self.p(u1, v1, w), self.p(u0, v1, w)]
        m.poly(q if out > 0 else list(reversed(q)), s)

    def box(self, m, u0, u1, v0, v1, w0, w1, s, c=0.0, skip=(), label=None, kind=None):
        a, b = self.p(u0, v0, w0), self.p(u1, v1, w1)
        x0, x1, y0, y1, z0, z1 = min(a[0], b[0]), max(a[0], b[0]), min(a[1], b[1]), max(a[1], b[1]), min(a[2], b[2]), max(a[2], b[2])
        sk = tuple(self._ax(k) for k in skip)
        if c > 0:
            m.cbox(x0, x1, y0, y1, z0, z1, s, c, skip=sk, label=label, kind=kind)
        else:
            m.box(x0, x1, y0, y1, z0, z1, s, skip=sk, label=label, kind=kind)

    def _ax(self, k):
        if k in ("+v", "-v"):
            return k.replace("v", "y")
        vec = self.U if k[1] == "u" else self.W
        sgn = 1 if k[0] == "+" else -1
        if abs(vec[0]) > 0.5:
            return "+x" if vec[0] * sgn > 0 else "-x"
        return "+z" if vec[2] * sgn > 0 else "-z"

    def poly(self, m, uvw, s, out=1):
        q = [self.p(*t) for t in uvw]
        n = G.poly_normal(q)
        want = self.W if out > 0 else G.mul(self.W, -1)
        if abs(G.dot(n, want)) > 0.3 and G.dot(n, want) < 0:
            q.reverse()
        m.poly(q, s)


def wall(m, f, u0, u1, v0, v1, holes, s, extra_v=()):
    """A flat wall (outward = f.W) minus rectangular holes [(a0, a1, b0, b1)]: cut into a grid along the holes' edges."""
    us = {u0, u1}
    vs = {v0, v1} | {v for v in extra_v if v0 < v < v1}
    for a0, a1, b0, b1 in holes:
        us.update([min(max(a0, u0), u1), min(max(a1, u0), u1)])
        vs.update([min(max(b0, v0), v1), min(max(b1, v0), v1)])
    us, vs = sorted(us), sorted(vs)
    for i in range(len(us) - 1):
        for j in range(len(vs) - 1):
            if us[i + 1] - us[i] < 1e-4 or vs[j + 1] - vs[j] < 1e-4:
                continue
            cu, cv = (us[i] + us[i + 1]) / 2, (vs[j] + vs[j + 1]) / 2
            if any(a0 < cu < a1 and b0 < cv < b1 for a0, a1, b0, b1 in holes):
                continue
            f.quad(m, us[i], us[i + 1], vs[j], vs[j + 1], 0.0, s)


def arch_spandrels(m, f, uc, w, spring, s, n=10):
    """Fill the wall between a round arch head and its bounding rectangle (the hole is cut as a rectangle up to the crown)."""
    r = w / 2
    pts = G.arch_pts(uc, spring, w, n)
    top = spring + r
    half = n // 2
    left = [(uc - r, top)] + pts[:half + 1]
    right = pts[half:] + [(uc + r, top)]
    for i in range(half):
        a, b = pts[i], pts[i + 1]
        f.poly(m, [(a[0], a[1], 0), (b[0], b[1], 0), (b[0], top, 0), (a[0], top, 0)], s)
    for i in range(half, n):
        a, b = pts[i], pts[i + 1]
        f.poly(m, [(a[0], a[1], 0), (b[0], b[1], 0), (b[0], top, 0), (a[0], top, 0)], s)
    return left, right


# ------------------------------------------------------------------------------------------------ windows --

def sash_window(kit, f, uc, sill, w, h, paint, stone, wall_s, room_s, cols=2, rows=3, depth=0.22, arch=False, shutters=None,
                box=None, plant=None, glow="windows", glow_col=WARM, keystone=None, surround=None, room_depth=1.1, sill_out=0.05,
                lights=True, room=True, fill=None, shutter_gap=0.06):
    """A painted timber window in a wall hole (u = uc +- w/2, v = sill .. sill + h; `arch`: a round head, h includes it):
    reveals and soffit in the wall's material, a frame and glazing bars (cols x rows panes), glass set back `depth`, a stone
    sill, an optional stone surround / keystone, a shallow room behind (plaster walls, ceiling, floor) whose back wall glows at
    night, shutters, a window box with flowers or a pot plant on the inside sill."""
    D, Gd, SH = kit.D, kit.G, kit.S
    u0, u1 = uc - w / 2, uc + w / 2
    top = sill + h
    r = w / 2
    spring = top - r if arch else top
    # reveals (sides, head, sill) in the wall material, w = 0 .. -depth
    for (ua, ub, out) in ((u0, u0, 1), (u1, u1, -1)):
        q = [f.p(ua, sill, 0), f.p(ua, spring, 0), f.p(ua, spring, -depth), f.p(ua, sill, -depth)]
        n = G.poly_normal(q)
        inward = G.mul(f.U, out)
        if G.dot(n, inward) < 0:
            q.reverse()
        SH.poly(q, wall_s.u((0, 1, 0)))
    if arch:
        pts = G.arch_pts(uc, spring, w, 10)
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            q = [f.p(a[0], a[1], 0), f.p(b[0], b[1], 0), f.p(b[0], b[1], -depth), f.p(a[0], a[1], -depth)]
            mid = G.mul(G.add(q[0], q[1]), 0.5)
            cen = f.p(uc, spring, 0)
            if G.dot(G.poly_normal(q), G.sub(cen, mid)) < 0:
                q.reverse()
            SH.poly(q, wall_s)
    else:
        q = [f.p(u0, top, 0), f.p(u1, top, 0), f.p(u1, top, -depth), f.p(u0, top, -depth)]
        if G.poly_normal(q)[1] > 0:
            q.reverse()
        SH.poly(q, wall_s)
    q = [f.p(u0, sill, 0), f.p(u1, sill, 0), f.p(u1, sill, -depth), f.p(u0, sill, -depth)]
    if G.poly_normal(q)[1] < 0:
        q.reverse()
    SH.poly(q, wall_s)
    # glass
    if arch:
        pts = G.arch_pts(uc, spring, w, 10)
        outline = [(u0, sill), (u1, sill)] + [(p[0], p[1]) for p in reversed(pts)]
        f.poly(SH, [(a, b, -depth) for a, b in outline], GLASS)
    else:
        f.quad(SH, u0, u1, sill, top, -depth, GLASS)
    # frame + glazing bars (painted), proud of the glass by 4 cm
    fw = 0.075
    wf0, wf1 = -depth - 0.01, -depth + 0.05
    f.box(SH, u0, u0 + fw, sill, spring, wf0, wf1, paint, skip=("-u", "-w", "-v", "+v"))
    f.box(SH, u1 - fw, u1, sill, spring, wf0, wf1, paint, skip=("+u", "-w", "-v", "+v"))
    f.box(SH, u0 + fw, u1 - fw, sill, sill + 0.09, wf0, wf1, paint, skip=("-w", "-v", "-u", "+u"))
    bw = 0.032
    for i in range(1, cols):
        u = u0 + w * i / cols
        f.box(D, u - bw / 2, u + bw / 2, sill + 0.09, spring if not arch else spring + r * math.sin(math.acos(min(1, abs(u - uc) / r))) - 0.03, wf0 + 0.01, wf1 - 0.01, paint, skip=("-w", "-v", "+v"))
    for j in range(1, rows):
        v = sill + (spring - sill) * j / rows
        f.box(D, u0 + fw, u1 - fw, v - bw / 2, v + bw / 2, wf0 + 0.01, wf1 - 0.01, paint, skip=("-w", "-u", "+u"))
    if arch:
        pts = G.arch_pts(uc, spring, w - 0.02, 12)
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            inner_a = (uc + (a[0] - uc) * (r - fw) / r, spring + (a[1] - spring) * (r - fw) / r)
            inner_b = (uc + (b[0] - uc) * (r - fw) / r, spring + (b[1] - spring) * (r - fw) / r)
            f.poly(D, [(a[0], a[1], wf1), (inner_a[0], inner_a[1], wf1), (inner_b[0], inner_b[1], wf1), (b[0], b[1], wf1)], paint)
        # radial bars of the fanlight
        for k in (0.25, 0.5, 0.75):
            ang = math.pi * k
            a = (uc - (r - fw) * math.cos(ang), spring + (r - fw) * math.sin(ang))
            D.member(f.p(uc, spring, wf1 - 0.02), f.p(a[0], a[1], wf1 - 0.02), G.prof_box(0.03, 0.035), paint)
        f.box(D, u0 + fw, u1 - fw, spring - 0.04, spring, wf0, wf1, paint, skip=("-w", "-u", "+u"))
    else:
        f.box(SH, u0 + fw, u1 - fw, top - fw, top, wf0, wf1, paint, skip=("-w", "-u", "+u", "+v"))
    # stone sill (projects sill_out, chamfered, drip below)
    f.box(D, u0 - 0.08, u1 + 0.08, sill - 0.09, sill + 0.02, -depth + 0.02, sill_out, stone, skip=("-w",))
    if surround:
        sw, s_s = surround
        if not arch:
            f.box(SH, u0 - sw, u0, sill, top, 0.0, 0.025, s_s, skip=("-w", "-v", "+v", "+u"))
            f.box(SH, u1, u1 + sw, sill, top, 0.0, 0.025, s_s, skip=("-w", "-v", "+v", "-u"))
            f.box(SH, u0 - sw, u1 + sw, top, top + sw, 0.0, 0.025, s_s, skip=("-w",))
    if keystone:
        ks, k_s = keystone
        kv = top
        q = [(uc - ks * 0.6, kv + ks), (uc - ks * 0.4, kv - 0.06), (uc + ks * 0.4, kv - 0.06), (uc + ks * 0.6, kv + ks)]
        f.poly(D, [(a, b, 0.045) for a, b in q], k_s)
        for i in range(4):
            a, b = q[i], q[(i + 1) % 4]
            f.poly(D, [(a[0], a[1], 0.0), (b[0], b[1], 0.0), (b[0], b[1], 0.045), (a[0], a[1], 0.045)], k_s, out=0)
    # the room behind: floor at the sill - 0.9 (a room floor), plaster walls, ceiling, lit back wall
    rd = room_depth
    if not room:
        glow = None
    rv0, rv1 = max(sill - 0.95, 0.02), top + 0.35
    ru0, ru1 = u0 - 0.35, u1 + 0.35
    wb = -depth - rd
    R = D if room else Mesh("unused")
    f.quad(R, ru0, ru1, rv0, rv1, wb, room_s)  # back wall faces out (toward the glass)
    for (ua, sgn) in ((ru0, 1), (ru1, -1)):
        q = [f.p(ua, rv0, -depth - 0.02), f.p(ua, rv0, wb), f.p(ua, rv1, wb), f.p(ua, rv1, -depth - 0.02)]
        if G.dot(G.poly_normal(q), G.mul(f.U, sgn)) < 0:
            q.reverse()
        R.poly(q, room_s)
    q = [f.p(ru0, rv1, -depth - 0.02), f.p(ru1, rv1, -depth - 0.02), f.p(ru1, rv1, wb), f.p(ru0, rv1, wb)]
    if G.poly_normal(q)[1] > 0:
        q.reverse()
    R.poly(q, room_s)
    q = [f.p(ru0, rv0, -depth - 0.02), f.p(ru1, rv0, -depth - 0.02), f.p(ru1, rv0, wb), f.p(ru0, rv0, wb)]
    if G.poly_normal(q)[1] < 0:
        q.reverse()
    R.poly(q, room_s.t(G.mul(room_s.col, 0.8)))
    if fill and room:
        fill(kit, f, ru0, ru1, rv0, rv1, wb, -depth)
    if glow:
        g = kit.glow(glow)
        q = [f.p(u0 - 0.2, sill - 0.3, wb + 0.01), f.p(u1 + 0.2, sill - 0.3, wb + 0.01), f.p(u1 + 0.2, top + 0.2, wb + 0.01), f.p(u0 - 0.2, top + 0.2, wb + 0.01)]
        g.poly(q, GLASS.t(glow_col))
        if lights:
            p = f.p(uc, top + 0.1, -depth - rd * 0.5)
            kit.lights.append(("point", p[0], p[1], p[2], (1.0, 0.8, 0.55), 40.0))
        p = f.p(uc, top - 0.2, -depth - rd * 0.5)
        kit.dayfill.append((p[0], p[1], p[2], 1.0, 25.0))
    if shutters:
        sh_s, sw = shutters
        for (a0, a1) in ((u0 - shutter_gap - sw, u0 - shutter_gap), (u1 + shutter_gap, u1 + shutter_gap + sw)):
            f.box(D, a0, a1, sill, top, 0.0, 0.035, sh_s.u((0, 1, 0)), skip=("-w",))
            for v in (sill + 0.32, top - 0.32):
                f.box(D, a0 + 0.04, a1 - 0.04, v - 0.06, v + 0.06, 0.035, 0.055, sh_s, skip=("-w",))
            f.box(D, a0 + 0.05, a1 - 0.05, sill + 0.42, top - 0.42, 0.035, 0.045, sh_s, skip=("-w", "-v", "+v"))
    if box:
        box_s, flower_kinds = box
        f.box(Gd, u0 - 0.02, u1 + 0.02, sill + 0.02, sill + 0.24, sill_out + 0.005, sill_out + 0.22, box_s, skip=("-w",))
        flowers_row(kit, f, u0 + 0.08, u1 - 0.08, sill + 0.2, sill_out + 0.11, flower_kinds, seed=int(uc * 100 + sill * 10), step=0.2)
    if plant:
        pot_s, leaf_s = plant
        pc = f.p(uc + w * 0.22, sill, -depth - 0.18)
        potted_plant(Gd, pc, pot_s, leaf_s, 0.32)


def flowers_row(kit, f, u0, u1, v, w, kinds, seed=0, step=0.11):
    """3D flowers (instanced kinds) along a window box / bed: each a stem cluster with petals (geranium-like heads)."""
    rg = G.rng(seed)
    u = u0
    while u < u1:
        k = kinds[rg.randrange(len(kinds))]
        p = f.p(u, v, w + rg.uniform(-0.04, 0.04))
        kit.place(k[0], k[1], p[0], p[1], p[2], rg.uniform(0, 6.28))
        u += step * rg.uniform(0.8, 1.2)


def flower_kind(name, petal_s, leaf_s, h=0.22, r=0.07):
    """A geranium/petunia clump: a leafy mound (5-sided) and two petal heads, ~40 triangles; origin at its base."""
    m = Mesh(name)
    m.lathe([(r * 0.9, 0.0), (r * 1.15, h * 0.4), (r * 0.5, h * 0.62), (0.0, h * 0.66)], 5, leaf_s)
    m.sphere(0.02, h * 0.82, 0.0, r * 0.62, petal_s, n=5, rings=3)
    m.sphere(-0.03, h * 0.74, 0.03, r * 0.5, petal_s, n=5, rings=2)
    return m


def potted_plant(m, p, pot_s, leaf_s, h=0.35):
    x, y, z = p
    m.lathe([(0.07, 0.0), (0.095, h * 0.42), (0.105, h * 0.47), (0.0, h * 0.47)], 6, pot_s, x, z, y)
    for i in range(3):
        a = i * 2 * math.pi / 3
        m.sphere(x + 0.05 * math.cos(a), y + h * 0.62 + 0.03 * (i % 2), z + 0.05 * math.sin(a), 0.075, leaf_s, n=5, rings=3)
    m.sphere(x, y + h * 0.8, z, 0.08, leaf_s, n=5, rings=3)


# ------------------------------------------------------------------------------------------------ doors --

def double_door(kit, door_id, f_local_x, door_z, width, height, leaf_s, frame_s, metal_s, glass_top=True):
    """Two panelled oak leaves on hinges at the jambs (local frame of the front wall: the door's centre at local x
    `f_local_x`, the leaves' outer face at local z `door_z`), turning inward (to -z) 0 -> 90 deg. Leaf meshes are built with
    the hinge at the origin and handed to the kit (b1_blender parents them under `door__<id>`)."""
    lw = width / 2
    t = 0.06
    leaves = []
    for name, sgn in (("l", 1), ("r", -1)):
        m = Mesh("leaf_" + name)
        # the leaf from the hinge (x = 0) toward the middle (x = sgn * lw), outer face at z = 0, inner at -t
        x0, x1 = (0.004, lw - 0.004) if sgn > 0 else (-lw + 0.004, -0.004)
        m.cbox(x0, x1, 0.01, height - 0.005, -t, 0.0, leaf_s.u((0, 1, 0)), c=0.01)
        # raised panels (outer face): two tall, one small; glazed top panel
        px0, px1 = (x0 + 0.12, x1 - 0.12)
        for (v0, v1) in ((0.18, 1.15), (1.32, 2.15)):
            m.cbox(px0, px1, v0, v1, -0.005, 0.022, leaf_s.u((0, 1, 0)), c=0.012)
        if glass_top:
            m.box(px0, px1, 2.32, height - 0.16, -0.03, -0.028, GLASS, skip=("-z",))
            for frac in (0.5,):
                xm = px0 + (px1 - px0) * frac
                m.box(xm - 0.018, xm + 0.018, 2.32, height - 0.16, -0.03, 0.012, leaf_s)
            m.box(px0, px1, 2.30, 2.32, -0.03, 0.012, leaf_s)
        else:
            m.cbox(px0, px1, 2.32, height - 0.16, -0.005, 0.022, leaf_s.u((0, 1, 0)), c=0.012)
        # handle (brass-tinted iron) and three hinges
        hx = x1 - 0.09 if sgn > 0 else x0 + 0.09
        m.box(hx - 0.015, hx + 0.015, 0.98, 1.22, 0.0, 0.03, metal_s)
        m.member((hx, 1.05, 0.03), (hx - sgn * 0.12, 1.05, 0.065), G.prof_round(0.012, 6), metal_s)
        for v in (0.3, height / 2, height - 0.35):
            hx2 = 0.0
            m.box(hx2 - 0.01 if sgn > 0 else hx2 - 0.03, hx2 + 0.03 if sgn > 0 else hx2 + 0.01, v - 0.06, v + 0.06, -t - 0.004, -t + 0.012, metal_s)
        hinge = (f_local_x - sgn * lw, 0.0, door_z)
        leaves.append((name, m, hinge, sgn))
    kit.doors[door_id] = leaves
    # the leaves' sweep (inward): width x width / 2 behind the door line, floor to the door head
    kit.sweeps.append(("door " + door_id, (f_local_x - lw - 0.004, f_local_x + lw + 0.004, door_z - lw - 0.07, door_z - 0.07), height))


# ------------------------------------------------------------------------------------------------ furniture --

def park_bench(m, cx, cz, yaw, length, wood_s, iron_s, label):
    """A backed park bench (seat top 0.45, the seat's front edge 0.22 in front of its centre): cast-iron ends with arm rests,
    five oak seat slats and three back slats, the back leaning 12 degrees; local frame: faces +z (the sitter looks +z)."""
    b = Mesh("bench")
    L = length / 2
    for x in (-L + 0.06, L - 0.06):
        # cast-iron end frame: front leg, back leg (raked), arm
        b.member((x, 0.0, 0.2), (x, 0.43, 0.18), G.prof_box(0.045, 0.06), iron_s)
        b.member((x, 0.0, -0.24), (x, 0.43, -0.2), G.prof_box(0.045, 0.06), iron_s)
        b.member((x, 0.43, -0.2), (x, 0.92, -0.215), G.prof_box(0.045, 0.05), iron_s)
        b.member((x, 0.40, 0.19), (x, 0.40, -0.21), G.prof_box(0.04, 0.05), iron_s)
        b.member((x, 0.66, 0.2), (x, 0.66, -0.2), G.prof_box(0.05, 0.035), iron_s)
        b.member((x, 0.43, 0.18), (x, 0.66, 0.19), G.prof_box(0.035, 0.035), iron_s)
        b.box(x - 0.035, x + 0.035, 0.0, 0.02, 0.15, 0.25, iron_s)
        b.box(x - 0.035, x + 0.035, 0.0, 0.02, -0.24, -0.16, iron_s)
    for i in range(5):
        z0 = 0.2 - i * 0.088
        b.box(-L, L, 0.42, 0.45, z0 - 0.075, z0, wood_s.u((1, 0, 0)), skip=("-y",))
    for i in range(3):
        y0 = 0.56 + i * 0.13
        z = -0.17 - (y0 - 0.5) * 0.1
        b.box(-L, L, y0, y0 + 0.1, z - 0.03, z, wood_s.u((1, 0, 0)))
    out = G.moved(b, cx, 0.0, cz, yaw)
    m.extend(out)
    bb = G.mesh_aabb(out)
    m.prop(label, bb, "solid")


def lantern_post(kit, m, x, z, h, iron_s, glass_s, label, head="lantern", glow_part="lamps", arm=None):
    """A cast-iron lamp post (fluted shaft on a round base) with a four-sided glazed lantern; with `arm` = (dx, dz) the
    lantern hangs from a scrolled bracket that far from the shaft (keeps it inside the footprint). Night glow in the lantern."""
    m.lathe([(0.055, 0.0), (0.055, 0.12), (0.045, 0.18), (0.04, 0.36)], 8, iron_s, x, z)
    m.lathe([(0.04, 0.36), (0.035, h - 0.25), (0.05, h - 0.2), (0.055, h - 0.12), (0.0, h - 0.12)], 8, iron_s, x, z)
    lx, lz = x, z
    hy = h - 0.12
    if arm:
        lx, lz = x + arm[0], z + arm[1]
        hy = h - 0.75
        m.member((x, h - 0.2, z), (lx, h - 0.2, lz), G.prof_box(0.035, 0.035), iron_s)
        m.member((x, h - 0.55, z), (G.lerp((x, 0, z), (lx, 0, lz), 0.6)[0], h - 0.2, G.lerp((x, 0, z), (lx, 0, lz), 0.6)[2]), G.prof_box(0.025, 0.025), iron_s)
        m.member((lx, h - 0.2, lz), (lx, hy + 0.72, lz), G.prof_round(0.012, 5), iron_s)
    x, z = lx, lz
    # lantern: base plate, four glass sides with iron corner bars, a hipped cap and a finial
    m.box(x - 0.13, x + 0.13, hy, hy + 0.04, z - 0.13, z + 0.13, iron_s)
    for (dx, dz) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        m.member((x + dx * 0.11, hy + 0.04, z + dz * 0.11), (x + dx * 0.14, hy + 0.46, z + dz * 0.14), G.prof_box(0.02, 0.02), iron_s)
    for (a, b) in (((-1, 1), (1, 1)), ((1, 1), (1, -1)), ((1, -1), (-1, -1)), ((-1, -1), (-1, 1))):
        q = [(x + a[0] * 0.11, hy + 0.04, z + a[1] * 0.11), (x + b[0] * 0.11, hy + 0.04, z + b[1] * 0.11),
             (x + b[0] * 0.135, hy + 0.46, z + b[1] * 0.135), (x + a[0] * 0.135, hy + 0.46, z + a[1] * 0.135)]
        n = G.poly_normal(q)
        if G.dot(n, ((a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2)) < 0:
            q.reverse()
        m.poly(q, glass_s)
    m.box(x - 0.165, x + 0.165, hy + 0.46, hy + 0.5, z - 0.165, z + 0.165, iron_s)
    m.lathe([(0.165 * math.sqrt(2), 0.0), (0.0, 0.17)], 4, iron_s, x, z, hy + 0.5, phase=math.pi / 4, smooth=False)
    m.lathe([(0.025, 0.0), (0.045, 0.05), (0.0, 0.12)], 5, iron_s, x, z, hy + 0.66)
    g = kit.glow(glow_part)
    g.lathe([(0.0, 0.0), (0.09, 0.05), (0.09, 0.36), (0.0, 0.4)], 6, GLASS.t(LAMP), x, z, hy + 0.05)
    kit.lights.append(("point", x, hy + 0.25, z, (1.0, 0.85, 0.6), 120.0))
    m.prop(label, (x - 0.06, x + 0.06, 0.0, 2.1, z - 0.06, z + 0.06) if not arm else (x - arm[0] - 0.06, x - arm[0] + 0.06, 0.0, 2.1, z - arm[1] - 0.06, z - arm[1] + 0.06), "solid")


def box_hedge(m, x0, x1, z0, z1, h, leaf_s, seed=0):
    """A clipped low box hedge: a rounded block of leafy lumps."""
    m.cbox(x0, x1, 0.0, h * 0.8, z0, z1, leaf_s, c=0.04, skip=("-y",))
    rg = G.rng(seed)
    x = x0 + 0.1
    while x < x1 - 0.05:
        m.sphere(x, h * 0.78, (z0 + z1) / 2, min(0.13, (z1 - z0) / 2), leaf_s, n=6, rings=3, sy=0.5 + rg.uniform(0, 0.25))
        x += 0.2


def tree(m, x, z, bark_s, leaf_s, h, r, seed=0):
    """A young, well-kept deciduous tree (lime / maple): a straight trunk with a slight flare, a crown of overlapping leafy
    lumps starting above 2.3 m (clear headroom), origin at the trunk's foot."""
    rg = G.rng(seed)
    m.lathe([(0.17, 0.0), (0.12, 0.25), (0.1, 1.2), (0.085, h * 0.62), (0.05, h * 0.8)], 7, bark_s, x, z)
    lumps = [(0.0, 0.0, h * 0.78, r * 0.8)]
    for i in range(7):
        a = i * 2 * math.pi / 7 + rg.uniform(-0.3, 0.3)
        lumps.append((r * 0.55 * math.cos(a), r * 0.55 * math.sin(a), h * rg.uniform(0.6, 0.78), r * rg.uniform(0.5, 0.62)))
    for (dx, dz, dy, rr) in lumps:
        dy = max(dy, 2.32 + rr * 0.82)  # headroom: no leaf below 2.3 m outside the trunk box
        m.sphere(x + dx, dy, z + dz, rr, leaf_s.t(G.mul(leaf_s.col, rg.uniform(0.8, 1.1))), n=7, rings=4, sy=0.85)
    for (a, l) in ((0.6, 0.7), (2.6, 0.6), (4.4, 0.65)):
        m.member((x, 2.4, z), (x + l * math.cos(a), 2.9, z + l * math.sin(a)), G.prof_round(0.035, 5), bark_s)


# ------------------------------------------------------------------------------------------------ half-timbering --

def timber(m, f, a, b, width, s, w=0.025):
    """One Alsatian timber (Fachwerk) member on a facade: a straight beam from (u, v) a to b, `width` wide, its face `w` proud
    of the render with two thin side faces (the render infill sits a little back, as on new Alsatian houses)."""
    du, dv = b[0] - a[0], b[1] - a[1]
    L = math.hypot(du, dv)
    nu, nv = -dv / L * width / 2, du / L * width / 2
    q = [(a[0] - nu, a[1] - nv), (b[0] - nu, b[1] - nv), (b[0] + nu, b[1] + nv), (a[0] + nu, a[1] + nv)]
    f.poly(m, [(u, v, w) for u, v in q], s.u(G.norm(G.sub(f.p(b[0], b[1]), f.p(a[0], a[1])))))
    for i in (0, 2):
        p0, p1 = q[i], q[i + 1]
        f.poly(m, [(p0[0], p0[1], 0.0), (p1[0], p1[1], 0.0), (p1[0], p1[1], w), (p0[0], p0[1], w)], s, out=0)


def fachwerk(m, f, u0, u1, v0, v1, s, openings, width=0.17, studs=1.1):
    """A storey of half-timbering between v0 and v1 across u0..u1: sill and head beams, posts at the ends and either side
    of every opening [(a0, a1, b0, b1)] (shutters included), intermediate studs no further apart than `studs`, a
    St Andrew's cross in every free panel at least 0.9 m wide, short studs above and below the openings."""
    timber(m, f, (u0, v0 + width / 2), (u1, v0 + width / 2), width, s)
    timber(m, f, (u0, v1 - width / 2), (u1, v1 - width / 2), width, s)
    posts = {u0 + width / 2, u1 - width / 2}
    for a0, a1, b0, b1 in openings:
        posts.update([a0 - width / 2, a1 + width / 2])
    posts = sorted(p for p in posts if u0 <= p <= u1)
    vb0, vb1 = v0 + width, v1 - width
    free = []
    for pa, pb in zip(posts, posts[1:]):
        mid = (pa + pb) / 2
        op = next((o for o in openings if o[0] - 0.01 <= mid <= o[1] + 0.01), None)
        if op:
            # above / below the opening: short studs and a rail
            if op[3] + width < vb1:
                timber(m, f, (op[0], op[3] + width / 2), (op[1], op[3] + width / 2), width * 0.8, s)
                for u in (op[0] + (op[1] - op[0]) / 3, op[0] + 2 * (op[1] - op[0]) / 3):
                    timber(m, f, (u, op[3] + width), (u, vb1), width * 0.7, s)
            if op[2] - width > vb0:
                timber(m, f, (op[0], op[2] - width / 2), (op[1], op[2] - width / 2), width * 0.8, s)
                if op[2] - width - vb0 > 0.35:
                    timber(m, f, (op[0] + 0.05, vb0), (op[1] - 0.05, op[2] - width), width * 0.7, s)
                    timber(m, f, (op[1] - 0.05, vb0), (op[0] + 0.05, op[2] - width), width * 0.7, s)
            continue
        free.append((pa, pb))
    for pa, pb in free:
        n = max(1, int(math.ceil((pb - pa) / studs)))
        us = [pa + (pb - pa) * k / n for k in range(n + 1)]
        for ua, ub in zip(us, us[1:]):
            if ub - ua >= 0.75:
                timber(m, f, (ua + width / 2, vb0), (ub - width / 2, vb1), width * 0.8, s)
                timber(m, f, (ub - width / 2, vb0), (ua + width / 2, vb1), width * 0.8, s)
        for u in us[1:-1]:
            timber(m, f, (u, vb0), (u, vb1), width, s)
    for p in posts:
        timber(m, f, (p, vb0), (p, vb1), width, s)


def gable_timber(m, f, uc, half, v0, apex, s, collar, width=0.17, skip=None):
    """Half-timbering in a gable triangle (base half width `half` at v0, apex): a collar beam, a king post, raking braces and
    two posts under the collar, avoiding a central round window between `skip` = (v_lo, v_hi)."""
    def at(v):
        return half * (apex - v) / (apex - v0)
    hc = at(collar) - 0.05
    timber(m, f, (uc - hc, collar), (uc + hc, collar), width, s)
    timber(m, f, (uc, collar + width / 2), (uc, apex - 0.25), width, s)
    for sx in (-1, 1):
        timber(m, f, (uc + sx * at(collar + 0.5) * 0.8, collar + width / 2), (uc + sx * 0.12, apex - 0.45), width * 0.8, s)
        pu = uc + sx * half * 0.55
        timber(m, f, (pu, v0 + 0.05), (pu, collar - width / 2), width, s)
        timber(m, f, (pu, v0 + 0.1), (uc + sx * half * 0.92, v0 + (collar - v0) * 0.08 + 0.15), width * 0.7, s)
        timber(m, f, (pu + sx * 0.08, collar - width), (uc + sx * at(collar) * 0.95, collar - width - 0.02), width * 0.7, s)
        if skip is None:
            timber(m, f, (uc + sx * 0.12, v0 + 0.1), (pu - sx * 0.12, collar - width / 2), width * 0.8, s)


def pillow(m, cx, cy, cz, w, h, d, s, tilt=0.0, yaw=0.0):
    """A plump scatter cushion: a squashed sphere with puffed corners (w x h x d), tilted back by `tilt` (radians)."""
    k = Mesh("pillow")
    k.lathe([(0.0, -0.5), (0.3, -0.44), (0.45, -0.25), (0.5, 0.0), (0.45, 0.25), (0.3, 0.44), (0.0, 0.5)], 12, s, 0.0, 0.0, 0.0, phase=math.pi / 12)

    def f(p):
        # squarer outline (a stuffed square cushion, not a disc): push each ring point out toward the square's corners
        px, pz = p[0], p[2]
        r = math.hypot(px, pz)
        if r > 1e-9:
            k4 = (px ** 4 + pz ** 4) ** 0.25
            g = (r / k4) ** 0.8
            px, pz = px * g, pz * g
        x, y, z = px * w, pz * h, p[1] * d  # the lathe axis becomes the cushion's thickness
        # tilt about x, then yaw
        c, sn = math.cos(tilt), math.sin(tilt)
        y, z = y * c - z * sn, y * sn + z * c
        return G.rot_y((x, y, z), yaw, cx, cy, cz)
    m.extend(k.transformed(f))
