"""B1 (lots v2: school + library) — pure-python geometry kit (no bpy), adapted from v1's market_geom / shops_geom
(feat/lot-hall-post, docs/designs/village-lots/tools): polygons in a lot's LOCAL frame (contract 1: x = the right hand of
someone walking in at the main door, y up, z out of the front), metre UVs (1 UV unit = 1 m, so the PBR library's
`repeatMeters` is [1, 1]), a per-vertex tint (COLOR_0, linear RGB) that recolours the library's neutral sets, and the
props' boxes for the numeric overlap check.

Every polygon is counter-clockwise seen from its outside (glTF). Materials are names (`LM_<lot>_<surface>`, `M_glass`);
b1_blender.py maps them to PBR library sets.
"""
import math
import random

# ------------------------------------------------------------------------------------------------ vectors --


def add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def mul(a, k):
    return (a[0] * k, a[1] * k, a[2] * k)


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def norm(a):
    l = math.sqrt(dot(a, a))
    return (a[0] / l, a[1] / l, a[2] / l) if l > 1e-12 else (0.0, 0.0, 0.0)


def lerp(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(len(a)))


def poly_normal(pts):
    n = (0.0, 0.0, 0.0)
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        n = (n[0] + (a[1] - b[1]) * (a[2] + b[2]), n[1] + (a[2] - b[2]) * (a[0] + b[0]), n[2] + (a[0] - b[0]) * (a[1] + b[1]))
    return norm(n)


def lin(r, g=None, b=None):
    """sRGB 0..1 (or one grey) -> linear."""
    if g is None:
        g = b = r

    def f(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f(r), f(g), f(b))


def hexc(h):
    h = h.lstrip("#")
    return lin(int(h[0:2], 16) / 255, int(h[2:4], 16) / 255, int(h[4:6], 16) / 255)


# ------------------------------------------------------------------------------------------------ surface --

LOD = 1.0   # the round sections' side count scale (a phone LOD sets it below 1; see Mesh.lathe)

class S:
    """A surface: material name, tint (linear RGB), an optional U direction (texture courses run along it), a UV scale
    (UV units per metre, 1 = real size) and a UV offset (so neighbouring parts do not repeat the same patch)."""

    def __init__(self, mat, col=(1.0, 1.0, 1.0), udir=None, scale=1.0, off=(0.0, 0.0)):
        self.mat, self.col, self.udir, self.scale, self.off = mat, col, udir, scale, off

    def t(self, col):
        return S(self.mat, col, self.udir, self.scale, self.off)

    def u(self, udir):
        return S(self.mat, self.col, udir, self.scale, self.off)

    def o(self, off):
        return S(self.mat, self.col, self.udir, self.scale, off)


class Poly:
    __slots__ = ("pts", "uv", "col", "mat", "smooth")

    def __init__(self, pts, uv, col, mat, smooth):
        self.pts, self.uv, self.col, self.mat, self.smooth = pts, uv, col, mat, smooth


class Mesh:
    """A bag of polygons (one Blender object / glTF node). `props`: (label, aabb, kind) for the overlap check, kind
    "solid" (must sit inside a contract collider below 2.2 m), "walkover" (<= 0.3 m: kerbs, edging, safety pads),
    "overhead" (its underside >= 2.2 m), "wall" (part of the body: inside the body box)."""

    def __init__(self, name):
        self.name = name
        self.polys = []
        self.props = []

    def tris(self):
        return sum(len(p.pts) - 2 for p in self.polys)

    def extend(self, other):
        self.polys += other.polys
        self.props += other.props

    def prop(self, label, box, kind="solid"):
        self.props.append((label, tuple(box), kind))

    def poly(self, pts, s, uv=None, smooth=False, cols=None):
        if len(pts) < 3:
            return
        n = poly_normal(pts)
        if n == (0.0, 0.0, 0.0):
            return
        if uv is None:
            U = None
            if s.udir is not None:
                U = sub(s.udir, mul(n, dot(s.udir, n)))
                U = norm(U) if dot(U, U) > 1e-6 else None
            if U is None:
                # world-aligned: horizontal faces use x; anything sloped or vertical runs U horizontally and V up-slope
                if abs(n[1]) > 0.97:
                    U = norm(sub((1, 0, 0), mul(n, n[0])))
                else:
                    U = norm(cross((0, 1, 0), n))
            V = norm(cross(n, U))
            k = s.scale
            uv = [(dot(p, U) * k + s.off[0], dot(p, V) * k + s.off[1]) for p in pts]
            u0 = math.floor(min(u for u, _ in uv))
            v0 = math.floor(min(v for _, v in uv))
            uv = [(u - u0, v - v0) for u, v in uv]
        c = s.col
        col = cols or [(c[0], c[1], c[2], 1.0)] * len(pts)
        self.polys.append(Poly([tuple(p) for p in pts], list(uv), list(col), s.mat, smooth))

    # ------------------------------------------------------------------------------------------- shapes --
    def quad(self, a, b, c, d, s):
        self.poly([a, b, c, d], s)

    def box(self, x0, x1, y0, y1, z0, z1, s, skip=(), top=None, label=None, kind=None):
        f = {
            "+x": [(x1, y0, z1), (x1, y0, z0), (x1, y1, z0), (x1, y1, z1)],
            "-x": [(x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0)],
            "+y": [(x0, y1, z1), (x1, y1, z1), (x1, y1, z0), (x0, y1, z0)],
            "-y": [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)],
            "+z": [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)],
            "-z": [(x1, y0, z0), (x0, y0, z0), (x0, y1, z0), (x1, y1, z0)],
        }
        for k, pts in f.items():
            if k in skip:
                continue
            self.poly(pts, top if (k == "+y" and top) else s)
        if kind:
            self.prop(label or self.name, (x0, x1, y0, y1, z0, z1), kind)

    def cbox(self, x0, x1, y0, y1, z0, z1, s, c=0.025, skip=(), label=None, kind=None):
        """A box with chamfered edges (c m, the contract's 2–3 cm bevel): 6 faces, 12 chamfer strips, 8 corner tris.
        `skip` drops whole faces (and their chamfers) on sides that touch something ("-y" = sits on the ground)."""
        c = min(c, (x1 - x0) / 2.01, (y1 - y0) / 2.01, (z1 - z0) / 2.01)
        X = (x0, x1)
        Y = (y0, y1)
        Z = (z0, z1)

        def P(ix, iy, iz, ax):
            # the corner (ix, iy, iz) pulled in by c along every axis except `ax`
            p = [X[ix], Y[iy], Z[iz]]
            sgn = [1 if ix == 0 else -1, 1 if iy == 0 else -1, 1 if iz == 0 else -1]
            for a in range(3):
                if a != ax:
                    p[a] += sgn[a] * c
            return tuple(p)

        faces = {"-x": (0, 0), "+x": (0, 1), "-y": (1, 0), "+y": (1, 1), "-z": (2, 0), "+z": (2, 1)}
        for key, (ax, side) in faces.items():
            if key in skip:
                continue
            o = [(a) for a in range(3) if a != ax]
            pts = []
            for i0, i1 in ((0, 0), (1, 0), (1, 1), (0, 1)):
                idx = [0, 0, 0]
                idx[ax] = side
                idx[o[0]] = i0
                idx[o[1]] = i1
                pts.append(P(idx[0], idx[1], idx[2], ax))
            n = poly_normal(pts)
            want = [0, 0, 0]
            want[ax] = 1 if side else -1
            if dot(n, want) < 0:
                pts.reverse()
            self.poly(pts, s)
        # chamfer strips along the 12 edges
        for ax in range(3):
            o = [a for a in range(3) if a != ax]
            for s0 in (0, 1):
                for s1 in (0, 1):
                    k0 = ("-+"[s0]) + "xyz"[o[0]]
                    k1 = ("-+"[s1]) + "xyz"[o[1]]
                    if k0 in skip or k1 in skip:
                        continue
                    pts = []
                    for e in (0, 1):
                        for which in (o[0], o[1]):
                            idx = [0, 0, 0]
                            idx[ax] = e
                            idx[o[0]] = s0
                            idx[o[1]] = s1
                            pts.append(P(idx[0], idx[1], idx[2], which))
                    q = [pts[0], pts[1], pts[3], pts[2]]
                    out = [0.0, 0.0, 0.0]
                    out[o[0]] = 1 if s0 else -1
                    out[o[1]] = 1 if s1 else -1
                    if dot(poly_normal(q), out) < 0:
                        q.reverse()
                    self.poly(q, s.u(tuple(1.0 if a == ax else 0.0 for a in range(3))))
        # corner triangles
        for ix in (0, 1):
            for iy in (0, 1):
                for iz in (0, 1):
                    ks = [("-+"[ix]) + "x", ("-+"[iy]) + "y", ("-+"[iz]) + "z"]
                    if any(k in skip for k in ks):
                        continue
                    t = [P(ix, iy, iz, 0), P(ix, iy, iz, 1), P(ix, iy, iz, 2)]
                    out = (1 if ix else -1, 1 if iy else -1, 1 if iz else -1)
                    if dot(poly_normal(t), out) < 0:
                        t.reverse()
                    self.poly(t, s)
        if kind:
            self.prop(label or self.name, (x0, x1, y0, y1, z0, z1), kind)

    def member(self, a, b, prof, s, up=(0, 1, 0), caps=False):
        """A straight member a -> b with a closed 2D section `prof` [(side, up)] CCW."""
        d = norm(sub(b, a))
        if abs(dot(d, up)) > 0.98:
            up = (1, 0, 0) if abs(d[0]) < 0.9 else (0, 0, 1)
        side = norm(cross(d, up))
        up2 = cross(side, d)
        ra = [add(a, add(mul(side, p), mul(up2, q))) for p, q in prof]
        rb = [add(b, add(mul(side, p), mul(up2, q))) for p, q in prof]
        n = len(prof)
        L = math.dist(a, b)
        per = 0.0
        for i in range(n):
            j = (i + 1) % n
            w = math.dist(ra[i], ra[j])
            self.poly([ra[j], ra[i], rb[i], rb[j]], s, uv=[(per + w, 0.0), (per, 0.0), (per, L), (per + w, L)], smooth=n > 6)
            per += w
        if caps:
            self.poly(list(reversed(ra)), s)
            self.poly(list(rb), s)

    def lathe(self, prof, n, s, cx=0.0, cz=0.0, y0=0.0, cap_top=False, cap_bottom=False, sx=1.0, sz=1.0, phase=0.0, smooth=True):
        """Revolve [(r, y)] (bottom to top) round a vertical axis; arc-length / height UVs."""
        if LOD < 1.0 and n > 8:
            n = max(8, int(round(n * LOD)))   # (a phone LOD: a kit sets G.LOD; the round sections keep their read at fewer sides)
        rings = []
        for r, y in prof:
            rings.append([(cx + r * math.cos(phase + 2 * math.pi * i / n) * sx, y0 + y, cz - r * math.sin(phase + 2 * math.pi * i / n) * sz) for i in range(n)])
        vs = [0.0]
        for k in range(1, len(prof)):
            vs.append(vs[-1] + math.hypot(prof[k][0] - prof[k - 1][0], prof[k][1] - prof[k - 1][1]))
        for k in range(len(rings) - 1):
            A, B = rings[k], rings[k + 1]
            ra, rb = prof[k][0], prof[k + 1][0]
            for i in range(n):
                j = (i + 1) % n
                ua, ub = 2 * math.pi * ra * i / n, 2 * math.pi * ra * (i + 1) / n
                uc, ud = 2 * math.pi * rb * (i + 1) / n, 2 * math.pi * rb * i / n
                if ra < 1e-6:
                    self.poly([A[i], B[j], B[i]], s, uv=[(ua, vs[k]), (uc, vs[k + 1]), (ud, vs[k + 1])], smooth=smooth)
                elif rb < 1e-6:
                    self.poly([A[i], A[j], B[i]], s, uv=[(ua, vs[k]), (ub, vs[k]), (ud, vs[k + 1])], smooth=smooth)
                else:
                    self.poly([A[i], A[j], B[j], B[i]], s, uv=[(ua, vs[k]), (ub, vs[k]), (uc, vs[k + 1]), (ud, vs[k + 1])], smooth=smooth)
        if cap_top and prof[-1][0] > 1e-6:
            self.poly(list(rings[-1]), s)
        if cap_bottom and prof[0][0] > 1e-6:
            self.poly(list(reversed(rings[0])), s)
        return rings

    def cyl(self, cx, cz, r, y0, y1, n, s, top=True, bottom=False):
        self.lathe([(r, 0.0), (r, y1 - y0)], n, s, cx, cz, y0, cap_top=top, cap_bottom=bottom)

    def tube(self, path, r, n, s, caps=False):
        """A round tube along a polyline (rings perpendicular to the path)."""
        if LOD < 1.0 and n > 4:
            n = max(4, int(round(n * LOD)))
        rings = []
        for i, p in enumerate(path):
            if i == 0:
                d = sub(path[1], path[0])
            elif i == len(path) - 1:
                d = sub(path[-1], path[-2])
            else:
                d = add(norm(sub(path[i], path[i - 1])), norm(sub(path[i + 1], path[i])))
            d = norm(d)
            up = (0, 1, 0) if abs(d[1]) < 0.95 else (1, 0, 0)
            side = norm(cross(d, up))
            up2 = cross(side, d)
            rings.append([add(p, add(mul(side, r * math.cos(2 * math.pi * k / n)), mul(up2, r * math.sin(2 * math.pi * k / n)))) for k in range(n)])
        L = 0.0
        for i in range(len(rings) - 1):
            A, B = rings[i], rings[i + 1]
            l = math.dist(path[i], path[i + 1])
            for k in range(n):
                j = (k + 1) % n
                u0, u1 = 2 * math.pi * r * k / n, 2 * math.pi * r * (k + 1) / n
                self.poly([A[j], A[k], B[k], B[j]], s, uv=[(u1, L), (u0, L), (u0, L + l), (u1, L + l)], smooth=True)
            L += l
        if caps:
            self.poly(list(rings[0]), s)
            self.poly(list(reversed(rings[-1])), s)

    def sphere(self, cx, cy, cz, r, s, n=10, rings=6, sy=1.0):
        prof = [(r * math.cos(-math.pi / 2 + math.pi * i / rings), r * sy * math.sin(-math.pi / 2 + math.pi * i / rings)) for i in range(rings + 1)]
        prof[0] = (0.0, prof[0][1])
        prof[-1] = (0.0, prof[-1][1])
        self.lathe(prof, n, s, cx, cz, cy)

    def extrude(self, outline, y0, y1, s, top=True, bottom=False):
        """A vertical prism over a CCW (seen from above, i.e. x right, -z up) outline [(x, z)]."""
        n = len(outline)
        per = 0.0
        for i in range(n):
            a, b = outline[i], outline[(i + 1) % n]
            w = math.dist(a, b)
            q = [(a[0], y0, a[1]), (b[0], y0, b[1]), (b[0], y1, b[1]), (a[0], y1, a[1])]
            if dot(poly_normal(q), (b[1] - a[1], 0, -(b[0] - a[0]))) < 0:
                q.reverse()
            self.poly(q, s)
            per += w
        if top:
            pts = [(x, y1, z) for x, z in outline]
            if poly_normal(pts)[1] < 0:
                pts.reverse()
            self.poly(pts, s)
        if bottom:
            pts = [(x, y0, z) for x, z in outline]
            if poly_normal(pts)[1] > 0:
                pts.reverse()
            self.poly(pts, s)

    def slab(self, outline2d, frame, t, s, sides=True):
        """A flat plate: a 2D outline [(u, v)] in a frame (origin, U, V) given thickness t along U x V (outward)."""
        o, U, V = frame
        N = norm(cross(U, V))
        front = [add(o, add(mul(U, u), mul(V, v))) for u, v in outline2d]
        back = [add(p, mul(N, -t)) for p in front]
        f = list(front)
        if dot(poly_normal(f), N) < 0:
            f.reverse()
        self.poly(f, s)
        b = list(back)
        if dot(poly_normal(b), N) > 0:
            b.reverse()
        self.poly(b, s)
        if sides:
            n = len(front)
            for i in range(n):
                j = (i + 1) % n
                q = [front[i], front[j], back[j], back[i]]
                mid = mul(add(add(front[i], front[j]), add(back[i], back[j])), 0.25)
                cen = mul(add(add(front[0], front[n // 3]), front[2 * n // 3]), 1 / 3)
                if dot(poly_normal(q), sub(mid, cen)) < 0:
                    q.reverse()
                self.poly(q, s)

    def transformed(self, fn, name=None):
        out = Mesh(name or self.name)
        for p in self.polys:
            out.polys.append(Poly([fn(q) for q in p.pts], p.uv, p.col, p.mat, p.smooth))
        return out


def aabb_of(pts):
    xs, ys, zs = [p[0] for p in pts], [p[1] for p in pts], [p[2] for p in pts]
    return (min(xs), max(xs), min(ys), max(ys), min(zs), max(zs))


def mesh_aabb(m):
    return aabb_of([q for p in m.polys for q in p.pts])


def rot_y(p, yaw, ox=0.0, oy=0.0, oz=0.0):
    c, s = math.cos(yaw), math.sin(yaw)
    return (ox + p[0] * c + p[2] * s, oy + p[1], oz - p[0] * s + p[2] * c)


def moved(m, dx=0.0, dy=0.0, dz=0.0, yaw=0.0, name=None):
    return m.transformed(lambda p: rot_y(p, yaw, dx, dy, dz), name)


def prof_box(w, h):
    return [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]


def prof_round(r, n=8):
    return [(r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n)) for i in range(n)]


def arch_pts(cx, spring, w, n=10, rise=None):
    """Points of a round (semicircular, or segmental with `rise`) arch head from left to right."""
    r = w / 2
    if rise is None or rise >= r - 1e-6:
        return [(cx - r * math.cos(math.pi * i / n), spring + r * math.sin(math.pi * i / n)) for i in range(n + 1)]
    R = (r * r + rise * rise) / (2 * rise)
    a0 = math.asin(r / R)
    yc = spring + rise - R
    return [(cx + R * math.sin(-a0 + 2 * a0 * i / n), yc + R * math.cos(-a0 + 2 * a0 * i / n)) for i in range(n + 1)]


def box_overlap(a, b, tol=0.004):
    dx = min(a[1], b[1]) - max(a[0], b[0])
    dy = min(a[3], b[3]) - max(a[2], b[2])
    dz = min(a[5], b[5]) - max(a[4], b[4])
    return dx > tol and dy > tol and dz > tol


def rng(seed):
    return random.Random(seed)
