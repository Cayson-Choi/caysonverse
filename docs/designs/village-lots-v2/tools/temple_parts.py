"""B3 (lots v2: 마을 절) — Korean timber-architecture parts shared by the temple kit (temple_kit.py) and the 대웅전 room
(temple_room_kit.py), pure python on b1_geom.py: the painted atlas UV helpers (temple_atlas.py), 배흘림 columns with 주의초,
머리초 beams, the curved 팔작 / 맞배 roof with corner lift (앙곡) and plan curve (안허리곡), hip and main ridges with 취두, the
instanced eave parts (서까래, 부연, 수막새) and the 다포 bracket set (공포). Everything brand-new: fresh 단청, even dark 기와.
"""
import math

import b1_geom as G
from b1_geom import Mesh, S
from temple_atlas import REGIONS, ruv

# ------------------------------------------------------------------------------------------------ atlas guard --
# dancheong_wood is an atlas: a part built with metre UVs (box, cbox, member, lathe, tube, sphere) would sample a random region.
# Every such polygon on the atlas material is moved into the neutral `paint` strip (tinted by its colour), keeping the metre
# layout within the polygon (so the paint's brush grain and the wood under it stay continuous on one face).
_poly = Mesh.poly


def _atlas_poly(self, pts, s, uv=None, smooth=False, cols=None):
    if uv is None and "dancheong" in s.mat:
        n0 = len(self.polys)
        _poly(self, pts, s, None, smooth, cols)
        if len(self.polys) > n0:
            p = self.polys[-1]
            us = [a for a, _ in p.uv]
            vs = [b for _, b in p.uv]
            u0, v0 = math.floor(min(us) / 2.0) * 2.0, math.floor(min(vs) / 2.0) * 2.0
            p.uv = [ruv("paint", (a - u0) / 4.0 + 0.02, (b - v0) / 4.0 + 0.02) for a, b in p.uv]
        return
    _poly(self, pts, s, uv, smooth, cols)


Mesh.poly = _atlas_poly

# ------------------------------------------------------------------------------------------------ colours --
SEOK = G.hexc("8A3626")        # 석간주 (columns, frames)
SEOK_DK = G.hexc("6E2A1E")
LOK = G.hexc("5E9E86")         # 뇌록 (boards, 포벽)
CREAM = G.hexc("F1E8D2")       # 회벽 (lime plaster walls)
NAVY = G.hexc("1E2A44")        # plaque board
WHITE = (1.0, 1.0, 1.0)


def dan(mat):
    return S(mat)


def apoly(m, pts, s, region, st=None, out=None):
    """A polygon with atlas UVs: `st` = [(s, t)] in the region's 0..1 per corner. With `out`, the winding is fixed so the
    face looks along `out` (uv list reversed with it)."""
    if st is None:
        st = [(0.15 + 0.7 * (k % 2), 0.15 + 0.7 * ((k // 2) % 2)) for k in range(len(pts))]
    uv = [ruv(region, a, b) for a, b in st]
    pts = list(pts)
    if out is not None:
        n = G.poly_normal(pts)
        if G.dot(n, out) < 0:
            pts.reverse()
            uv.reverse()
    m.poly(pts, s, uv=uv)


def tint(s, col):
    return s.t(col)


def opoly(m, pts, s, out, uv=None, smooth=False):
    """A polygon facing `out` (winding fixed), metre UVs unless given."""
    pts = list(pts)
    n = G.poly_normal(pts)
    if G.dot(n, out) < 0:
        pts.reverse()
        if uv is not None:
            uv = list(reversed(uv))
    m.poly(pts, s, uv=uv, smooth=smooth)


# ------------------------------------------------------------------------------------------------ members --

def beam(m, s, a, b, w, h, region="beam_a", ends="paint", end_col=SEOK, bottom=True, top=False):
    """A painted beam between two points on the same height (a, b = centre of its BOTTOM face at both ends), `w` wide,
    `h` tall: the long faces carry the band (머리초 at both ends), the soffit too (s across), the end faces plain paint."""
    ax, ay, az = a
    bx, by, bz = b
    d = G.norm((bx - ax, 0.0, bz - az))
    n = (-d[2], 0.0, d[0])  # left of the beam's direction
    L = math.dist((ax, az), (bx, bz))
    hw = w / 2

    def P(along, side, y):
        return (ax + d[0] * along + n[0] * side, ay + y, az + d[2] * along + n[2] * side)
    for side in (hw, -hw):
        pts = [P(0, side, 0), P(L, side, 0), P(L, side, h), P(0, side, h)]
        apoly(m, pts, s, region, [(0, 0), (1, 0), (1, 1), (0, 1)], out=(n[0] * side, 0, n[2] * side))
    if bottom:
        apoly(m, [P(0, hw, 0), P(L, hw, 0), P(L, -hw, 0), P(0, -hw, 0)], s, region, [(0, 0), (1, 0), (1, 1), (0, 1)], out=(0, -1, 0))
    if top:
        apoly(m, [P(0, hw, h), P(L, hw, h), P(L, -hw, h), P(0, -hw, h)], s, region, [(0, 0), (1, 0), (1, 1), (0, 1)], out=(0, 1, 0))
    if ends:
        for along, sg in ((0, -1), (L, 1)):
            apoly(m, [P(along, hw, 0), P(along, -hw, 0), P(along, -hw, h), P(along, hw, h)], s.t(end_col), ends,
                  [(0.1, 0.1), (0.3, 0.1), (0.3, 0.9), (0.1, 0.9)], out=(d[0] * sg, 0, d[2] * sg))


def column(m, s, x, z, y0, y1, r=0.25, n=8, head=0.45, col=SEOK, entasis=True):
    """A round 배흘림 column (widest a third up, slimmer at the top), 석간주 below and 주의초 (hanging lotus pendants) in its
    top `head` metres."""
    if entasis:
        prof = [(r * 0.96, 0.0), (r * 1.04, (y1 - y0) * 0.33), (r * 0.9, (y1 - y0) - head), (r * 0.88, (y1 - y0))]
    else:
        prof = [(r, 0.0), (r, (y1 - y0) - head), (r, y1 - y0)]
    H = y1 - y0
    for k in range(len(prof) - 1):
        (ra, ya), (rb, yb) = prof[k], prof[k + 1]
        is_head = ya >= H - head - 1e-6
        for i in range(n):
            a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
            pa = (x + ra * math.cos(a0), y0 + ya, z - ra * math.sin(a0))
            pb = (x + ra * math.cos(a1), y0 + ya, z - ra * math.sin(a1))
            pc = (x + rb * math.cos(a1), y0 + yb, z - rb * math.sin(a1))
            pd = (x + rb * math.cos(a0), y0 + yb, z - rb * math.sin(a0))
            if is_head:
                st = [(i / n, 0.0), ((i + 1) / n, 0.0), ((i + 1) / n, 1.0), (i / n, 1.0)]
                apoly(m, [pa, pb, pc, pd], s, "column_head", st, out=(math.cos((a0 + a1) / 2), 0, -math.sin((a0 + a1) / 2)))
            else:
                st = [(ya / H, i / n), (ya / H, (i + 1) / n), (yb / H, (i + 1) / n), (yb / H, i / n)]
                apoly(m, [pa, pb, pc, pd], s.t(col), "paint", st, out=(math.cos((a0 + a1) / 2), 0, -math.sin((a0 + a1) / 2)))


def plinth_stone(m, s, x, z, w, h):
    """주춧돌: a dressed granite base with a raised round seat."""
    m.cbox(x - w / 2, x + w / 2, 0.0, h, z - w / 2, z + w / 2, s, c=0.03, skip=("-y",))


# ------------------------------------------------------------------------------------------------ roofs --

class Roof:
    """A Korean roof over a rectangle of columns (centre cx, cz; half sizes hx, hz along x / z): eaves `o` past the columns,
    the top surface at the eaves `ye` (middle of a side) rising concave (gentle at the eaves, steep at the ridge) to the ridge
    `yr`, the corners lifted `lift` (앙곡) and pushed out `bow` (안허리곡). `xg` = the half length of the ridge (팔작: the
    gable wall stands at x = +-xg; 맞배: xg >= hx + o, no hips)."""

    def __init__(self, cx, cz, hx, hz, o, ye, yr, xg, lift=0.45, bow=0.15, kind="paljak", nt=7, ns=12):
        self.cx, self.cz, self.hx, self.hz, self.o = cx, cz, hx, hz, o
        self.ye, self.yr, self.xg, self.lift, self.bow, self.kind = ye, yr, xg, lift, bow, kind
        self.Xe, self.Ze = hx + o, hz + o
        self.nt, self.ns = nt, ns
        if kind == "paljak":
            # the hip level: where the front slope's half length has shrunk to xg
            self.tg = (self.Xe - xg) / self.Ze  # in units of the front slope's depth (hips at 45 degrees in plan)
            self.tg = min(self.tg, 0.7)
        else:
            self.tg = 0.0

    def y_at(self, t):
        """Height of the roof surface at depth fraction t (0 eaves, 1 ridge)."""
        return self.ye + (self.yr - self.ye) * (0.32 * t + 0.68 * t * t)

    def xr(self, t):
        if self.kind != "paljak":
            return self.Xe
        if t >= self.tg:
            return self.xg
        return self.Xe - (self.Xe - self.xg) * (t / self.tg) if self.tg > 0 else self.xg

    def lift_at(self, s, t):
        k = (1 - t) ** 2
        return self.lift * abs(s) ** 3 * k, self.bow * abs(s) ** 3 * k

    def front(self, s, t, side=1):
        """A point on the front (side=+1) or back (-1) slope: s in -1..1 along x, t 0..1 eave to ridge."""
        ly, lb = self.lift_at(s, t)
        if self.kind != "paljak":
            ly, lb = ly * 0.35, 0.0
        x = s * self.xr(t) + math.copysign(lb, s)
        z = self.Ze * (1 - t) + lb
        return (self.cx + x, self.y_at(t) + ly, self.cz + side * z)

    def end(self, s, t, side=1):
        """A point on the right (+1) or left (-1) hip slope: s in -1..1 along z, t 0..tg."""
        ly, lb = self.lift_at(s, t / self.tg if False else t)
        x = self.xr(t) + lb
        z = s * self.Ze * (1 - t) + math.copysign(lb, s)
        return (self.cx + side * x, self.y_at(t) + ly, self.cz + z)

    def surface(self, m, s_roof):
        """The tiled slopes (metre UVs: u along the eaves, v down the slope) and, for 팔작, the gable walls."""
        nt, ns = self.nt, self.ns
        for side in (1, -1):
            ts = [i / nt for i in range(nt + 1)]
            ss = [-1 + 2 * j / ns for j in range(ns + 1)]
            grid = [[self.front(s, t, side) for s in ss] for t in ts]
            for i in range(nt):
                for j in range(ns):
                    a, b, c, d = grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]
                    uv = [(p[0] - self.cx, self.slope_v(ts[k])) for p, k in ((a, i), (b, i), (c, i + 1), (d, i + 1))]
                    opoly(m, [a, b, c, d], s_roof, (0, 1, side), uv)
        if self.kind == "paljak":
            for side in (1, -1):
                ts = [self.tg * i / (nt - 2) for i in range(nt - 1)]
                ss = [-1 + 2 * j / 8 for j in range(9)]
                grid = [[self.end(s, t, side) for s in ss] for t in ts]
                for i in range(len(ts) - 1):
                    for j in range(8):
                        a, b, c, d = grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]
                        uv = [(p[2] - self.cz, self.slope_v(ts[k])) for p, k in ((a, i), (b, i), (c, i + 1), (d, i + 1))]
                        opoly(m, [a, b, c, d], s_roof, (side, 1, 0), uv)

    def slope_v(self, t):
        # arc length down the slope from the ridge (approx.)
        n = 12
        L = 0.0
        prev = (0.0, self.y_at(1.0))
        for k in range(1, n + 1):
            tt = 1.0 - (1.0 - t) * k / n
            p = (self.Ze * (1 - tt), self.y_at(tt))
            L += math.dist(p, prev)
            prev = p
        return L

    def gables(self, m, s_gable, s_barge):
        """합각: the vertical gable triangles at x = +-xg (paint), the barge boards (박공) along their top edges."""
        if self.kind != "paljak":
            return
        ts = [self.tg + (1 - self.tg) * k / 5 for k in range(6)]
        for side in (1, -1):
            x = self.cx + side * (self.xg - 0.05)
            yb = self.y_at(self.tg)
            front = [(x, self.y_at(t), self.cz + self.Ze * (1 - t)) for t in ts]
            back = [(x, self.y_at(t), self.cz - self.Ze * (1 - t)) for t in ts]
            outline = [(x, yb, front[0][2])] + front[1:] + back[::-1][1:-1] + [(x, yb, back[0][2])]
            # fan from the base middle
            base = (x, yb, self.cz)
            ring = [(x, yb, front[0][2])] + front + back[::-1] + [(x, yb, back[0][2])]
            for k in range(len(ring) - 1):
                tri = [base, ring[k], ring[k + 1]]
                if math.dist(tri[1], tri[2]) < 1e-4:
                    continue
                uv = [ruv("paint", 0.5 + (p[2] - self.cz) / 12.0, 0.1 + (p[1] - yb) / (self.yr - yb + 0.01) * 0.8) for p in tri]
                opoly(m, tri, s_gable, (side, 0, 0), uv)
            for pts in (front, back):
                for a, b in zip(pts, pts[1:]):
                    a2 = (a[0] + side * 0.08, a[1] + 0.06, a[2])
                    b2 = (b[0] + side * 0.08, b[1] + 0.06, b[2])
                    m.member(a2, b2, G.prof_box(0.07, 0.32), s_barge)

    def eave_edge(self, m, s_edge, s_soffit, wall_y, depth=0.22):
        """The eave edge (기와 edge band down from the surface) and the painted soffit back to the wall line at `wall_y`."""
        ns = self.ns
        pts_front = lambda side: [self.front(-1 + 2 * j / ns, 0.0, side) for j in range(ns + 1)]
        rings = []
        for side in (1, -1):
            rings.append(("f", side, pts_front(side)))
        if self.kind == "paljak":
            for side in (1, -1):
                rings.append(("e", side, [self.end(-1 + 2 * j / ns, 0.0, side) for j in range(ns + 1)]))
        for kind, side, pts in rings:
            out = (0, 0, side) if kind == "f" else (side, 0, 0)
            for a, b in zip(pts, pts[1:]):
                q = [(a[0], a[1] - depth, a[2]), (b[0], b[1] - depth, b[2]), b, a]
                opoly(m, q, s_edge, out)
                # soffit: from the edge underside back to the wall line (painted boards seen between the rafters)
                if kind == "f":
                    a_in = (a[0] * 0 + max(min(a[0], self.cx + self.hx), self.cx - self.hx), wall_y, self.cz + side * self.hz)
                    b_in = (max(min(b[0], self.cx + self.hx), self.cx - self.hx), wall_y, self.cz + side * self.hz)
                else:
                    a_in = (self.cx + side * self.hx, wall_y, max(min(a[2], self.cz + self.hz), self.cz - self.hz))
                    b_in = (self.cx + side * self.hx, wall_y, max(min(b[2], self.cz + self.hz), self.cz - self.hz))
                q = [(a[0], a[1] - depth, a[2]), (b[0], b[1] - depth, b[2]), b_in, a_in]
                uv = [ruv("paint", 0.3, 0.3), ruv("paint", 0.6, 0.3), ruv("paint", 0.6, 0.7), ruv("paint", 0.3, 0.7)]
                opoly(m, q, s_soffit, (0, -1, 0), uv)
            if self.kind != "paljak" and kind == "f":
                # 맞배: close the gable ends' soffits under the barge boards
                pass

    def ridges(self, m, s_ridge, s_band, s_chwidu):
        """용마루 with a white mortar band, 취두 at its ends; 내림마루 down the gable edges; 추녀마루 along the hips, upturned."""
        yr = self.yr
        x0, x1 = self.cx - self.xg + 0.05, self.cx + self.xg - 0.05
        m.cbox(x0, x1, yr - 0.08, yr + 0.36, self.cz - 0.2, self.cz + 0.2, s_ridge, c=0.03)
        m.box(x0, x1, yr - 0.16, yr - 0.08, self.cz - 0.24, self.cz + 0.24, s_band)
        for sx in (-1, 1):
            xe = self.cx + sx * (self.xg - 0.05)
            # 취두: a tall carved block, its top curling inward
            m.cbox(xe - 0.22, xe + 0.22, yr + 0.3, yr + 0.62, self.cz - 0.2, self.cz + 0.2, s_chwidu, c=0.04)
            m.member((xe, yr + 0.6, self.cz), (xe - sx * 0.22, yr + 0.88, self.cz), G.prof_box(0.3, 0.22), s_chwidu)
            m.member((xe - sx * 0.22, yr + 0.88, self.cz), (xe - sx * 0.42, yr + 0.84, self.cz), G.prof_box(0.24, 0.16), s_chwidu)
        if self.kind == "paljak":
            for sx in (-1, 1):
                for sz in (-1, 1):
                    # 내림마루: down the barge edge from the ridge to the hip level
                    ts = [1.0 - (1.0 - self.tg) * k / 4 for k in range(5)]
                    pts = [(self.cx + sx * (self.xg - 0.02), self.y_at(t) + 0.16, self.cz + sz * self.Ze * (1 - t)) for t in ts]
                    m.tube(pts, 0.13, 4, s_ridge)
                    # 추녀마루: from the hip level down the hip to the corner, upturned at its end
                    ts2 = [self.tg * (1 - k / 5) for k in range(6)]
                    pts2 = []
                    for t in ts2:
                        p = self.front(sx, t, sz)
                        pts2.append((p[0], p[1] + 0.15, p[2]))
                    e = pts2[-1]
                    up = min(0.08, 0.015 * self.Xe)
                    pts2.append((e[0] + sx * up, e[1] + 0.3, e[2] + sz * up))
                    m.tube(pts2, min(0.12, 0.035 * self.Xe), 4, s_ridge)
        else:
            for sx in (-1, 1):
                ts = [1.0 - k / 6 for k in range(7)]
                for sz in (-1, 1):
                    pts = [(self.cx + sx * (self.xg - 0.08), self.y_at(t) + 0.12 + (self.lift * 0.35 * (1 - t) ** 2), self.cz + sz * self.Ze * (1 - t)) for t in ts]
                    m.tube(pts, 0.11, 5, s_ridge)

    def eave_points(self, spacing, inset_corner=0.6):
        """Positions along the eave lines for the instanced eave parts: (x, y, z, yaw, side-fraction) — y = the roof edge."""
        out = []
        sides = [("f", 1), ("f", -1)]
        if self.kind == "paljak":
            sides += [("e", 1), ("e", -1)]
        for kind, side in sides:
            half = self.Xe if kind == "f" else self.Ze
            n = max(2, int((2 * half - 2 * inset_corner) / spacing))
            for j in range(n + 1):
                s = (-half + inset_corner + (2 * half - 2 * inset_corner) * j / n) / half
                if self.kind != "paljak" and kind == "f":
                    s = (-(self.xg - 0.15) + 2 * (self.xg - 0.15) * j / n) / half
                if kind == "f":
                    p = self.front(s, 0.0, side)
                    yaw = 0.0 if side > 0 else math.pi
                else:
                    p = self.end(s, 0.0, side)
                    yaw = math.pi / 2 if side > 0 else -math.pi / 2
                out.append((p[0], p[1], p[2], yaw, abs(s)))
        return out


# ------------------------------------------------------------------------------------------------ instanced kinds --

def rafter_kind(s, L=1.5, pitch=0.42, r=0.085):
    """서까래 (kind-local: the round end at the origin facing +z, running back and up into the eaves by `pitch` rad):
    5 sides (no top) with the band on its sides, the 연화 rosette on its end."""
    m = Mesh("rafter")
    d = (0.0, math.sin(pitch), -math.cos(pitch))
    n = 6
    ring0 = [(r * math.cos(2 * math.pi * i / n + math.pi / 2), r * math.sin(2 * math.pi * i / n + math.pi / 2)) for i in range(n)]
    side = (1, 0, 0)
    up = G.cross(side, d)
    up = G.mul(up, -1) if up[1] < 0 else up

    def P(k, along):
        a, b = ring0[k]
        return G.add(G.mul(d, along), G.add(G.mul(side, a), G.mul(up, b)))
    for k in range(n):
        j = (k + 1) % n
        if k in (0, n - 1):
            continue  # the top faces sit under the boards
        pts = [P(k, 0), P(j, 0), P(j, L), P(k, L)]
        mid = G.add(G.mul(side, (ring0[k][0] + ring0[j][0]) / 2), G.mul(up, (ring0[k][1] + ring0[j][1]) / 2))
        apoly(m, pts, s, "rafter", [(0, k / n), (0, j / n), (1, j / n), (1, k / n)], out=mid)
    cap = [P(k, 0) for k in range(n)]
    st = [(0.5 + 0.5 * ring0[k][0] / r, 0.5 + 0.5 * ring0[k][1] / r) for k in range(n)]
    apoly(m, cap, s, "rafter_end", st, out=G.mul(d, -1))
    return m


def buyeon_kind(s, L=0.62, pitch=0.3, w=0.1):
    """부연: the square flying rafter over each 서까래, its end painted 매화점."""
    m = Mesh("buyeon")
    d = (0.0, math.sin(pitch), -math.cos(pitch))
    side = (1, 0, 0)
    up = G.cross(side, d)
    up = G.mul(up, -1) if up[1] < 0 else up
    h = w / 2

    def P(a, b, along):
        return G.add(G.mul(d, along), G.add(G.mul(side, a), G.mul(up, b)))
    faces = [((-h, -h), (h, -h)), ((h, -h), (h, h)), ((-h, h), (-h, -h))]
    for k, ((a0, b0), (a1, b1)) in enumerate(faces):
        pts = [P(a0, b0, 0), P(a1, b1, 0), P(a1, b1, L), P(a0, b0, L)]
        mid = G.add(G.mul(side, (a0 + a1) / 2), G.mul(up, (b0 + b1) / 2))
        apoly(m, pts, s, "buyeon", [(0, 0.1 + 0.3 * k), (0, 0.4 + 0.3 * k), (1, 0.4 + 0.3 * k), (1, 0.1 + 0.3 * k)], out=mid)
    cap = [P(-h, -h, 0), P(h, -h, 0), P(h, h, 0), P(-h, h, 0)]
    apoly(m, cap, s, "buyeon_end", [(0, 0), (1, 0), (1, 1), (0, 1)], out=G.mul(d, -1))
    return m


def makse_kind(s):
    """수막새: the round end tile of each 수키와 row at the eave edge (a 6-sided disc with a raised rim, kind-local facing +z)."""
    m = Mesh("makse")
    r = 0.085
    n = 6
    ring = [(r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n) + r) for i in range(n)]
    m.poly([(x, y, 0.0) for x, y in ring], s)
    return m


def gongpo_kind(s, scale=1.0):
    """다포 공포 (kind-local: its centre on the 평방 top at the origin, the wall plane x, outward +z): a 주두 block, two tiers of
    첨차 arms along the wall each carrying 소로, three tiers of 살미 stepping out (and in) to the 쇠서 tongues, painted
    (초엽 faces, 양록 / 삼청 sides)."""
    m = Mesh("gongpo")
    k = scale

    def blk(x0, x1, y0, y1, z0, z1, face="bracket", col=WHITE, bottom=True):
        x0, x1, y0, y1, z0, z1 = (v * k for v in (x0, x1, y0, y1, z0, z1))
        for zz, sg in ((z1, 1), (z0, -1)):
            apoly(m, [(x0, y0, zz), (x1, y0, zz), (x1, y1, zz), (x0, y1, zz)], s.t(col), face, [(0, 0), (1, 0), (1, 1), (0, 1)], out=(0, 0, sg))
        for xx, sg in ((x1, 1), (x0, -1)):
            apoly(m, [(xx, y0, z0), (xx, y0, z1), (xx, y1, z1), (xx, y1, z0)], s.t(col), "beam_b", [(0.45, 0.2), (0.55, 0.2), (0.55, 0.8), (0.45, 0.8)], out=(sg, 0, 0))
        if bottom:
            apoly(m, [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], s.t(LOK), "paint", [(0.1, 0.1), (0.2, 0.1), (0.2, 0.9), (0.1, 0.9)], out=(0, -1, 0))
    blk(-0.2, 0.2, 0.0, 0.2, -0.2, 0.2, bottom=False)       # 주두
    blk(-0.62, 0.62, 0.2, 0.36, -0.07, 0.07)                # 첨차 tier 1
    for x in (-0.52, 0.52):
        blk(x - 0.09, x + 0.09, 0.36, 0.46, -0.09, 0.09, face="beam_b", bottom=False)  # 소로
    blk(-0.8, 0.8, 0.46, 0.62, -0.07, 0.07)                 # 첨차 tier 2
    for t, (z1, y0) in enumerate(((0.45, 0.2), (0.68, 0.46), (0.88, 0.72))):  # 살미 stepping out
        blk(-0.07, 0.07, y0, y0 + 0.18, -0.35 - 0.12 * t, z1)
        # 쇠서: the tongue curling down at the front end
        m.member((0.0, (y0 + 0.02) * k, z1 * k), (0.0, (y0 - 0.1) * k, (z1 + 0.12) * k), G.prof_box(0.12 * k, 0.1 * k), s.t(G.hexc("4FA36A")))
    blk(-0.62, 0.62, 0.72, 0.88, -0.07, 0.07)               # 장여 / top tier
    return m


def lotus_lamp(m, kit, x, y, z, glow_part, s_paper, s_frame, r=0.22):
    """A hanging 연등 (lotus lantern): a round paper body clad in petal rows (lotus_paper), a small frame ring, a tassel; glows."""
    rings = [(0.0, -0.34), (r * 0.55, -0.3), (r * 0.95, -0.18), (r, 0.0), (r * 0.9, 0.12), (r * 0.5, 0.22), (0.0, 0.24)]
    n = 10
    for k in range(len(rings) - 1):
        (ra, ya), (rb, yb) = rings[k], rings[k + 1]
        for i in range(n):
            a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
            pts = [(x + ra * math.cos(a0), y + ya, z - ra * math.sin(a0)), (x + ra * math.cos(a1), y + ya, z - ra * math.sin(a1)),
                   (x + rb * math.cos(a1), y + yb, z - rb * math.sin(a1)), (x + rb * math.cos(a0), y + yb, z - rb * math.sin(a0))]
            if ra < 1e-6:
                pts = [pts[0], pts[2], pts[3]]
            elif rb < 1e-6:
                pts = pts[:3]
            st = [((i + q) / n * 2 % 1.0 if False else (i / n), 0) for q in range(len(pts))]
            u0, u1 = (i % 5) / 5, (i % 5 + 1) / 5
            stl = [(u0, k / 6), (u1, k / 6), (u1, (k + 1) / 6), (u0, (k + 1) / 6)][:len(pts)] if len(pts) == 4 else [(u0, k / 6), (u1, (k + 1) / 6), (u0, (k + 1) / 6)]
            apoly(m, pts, s_paper, "lotus_paper", stl, out=(math.cos((a0 + a1) / 2), (ya + yb) / 2 * 0.5, -math.sin((a0 + a1) / 2)))
    m.lathe([(r * 0.5, 0.0), (r * 0.55, 0.03), (r * 0.5, 0.06)], 8, s_frame, x, z, y + 0.2)
    m.member((x, y + 0.26, z), (x, y + 0.5, z), G.prof_round(0.008, 4), s_frame)
    m.member((x, y - 0.34, z), (x, y - 0.55, z), G.prof_round(0.012, 4), s_paper)
    if kit is not None:
        kit.glow(glow_part).sphere(x, y - 0.02, z, r * 0.7, S("M_glass").t((1.0, 0.72, 0.6)), n=6, rings=4)
