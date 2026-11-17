"""B3 (lots v2: 케이슨랜드 정문 polish) — the L4 gate kit's base (feat/lot-mart-gate 75ab7df, docs/designs/village-lots/tools/
mg_base.py + market_geom.py) re-seated on B1's geometry (b1_geom.py) so the gate leaves v1's decoded-WebP band atlases for the
lots v2 rules: every surface a KTX2 PBR library set with metre UVs (contract 7), the few painted things (pennants, flower beds,
soil, the picture map) in one small own KTX2 atlas (`lot_gate_goods`, no words), no grime ("새것"), no money words.

The names and call shapes gate_kit.py uses are kept (surfaces ST SS RF WD PL RN GR SC OK GL LP SE with .tint / .u, cell(), cuv(),
cquad(), shrub(), soil_disc(), Mesh.box / member / lathe / cyl / disc / poly / transformed, BaseKit.place / glow).
"""
import math
import random

import b1_geom as BG
from b1_geom import S

# ------------------------------------------------------------------------------------------------ surfaces --
# (v1 material, band) -> lots v2 material (one PBR library set each; LOT_SURFACE_RULES.families.lot_gate)
MAP = {
    ("LM_mk_steel", "steel_painted"): "LM_martgate_steel",
    ("LM_mk_steel", "stainless"): "LM_martgate_metal",
    ("LM_mk_roof", "corrugated_metal"): "LM_martgate_steel",
    ("LM_mk_roof", "wood_boards"): "LM_martgate_oak",
    ("LM_mk_ground", "ceramic_tile_white"): "LM_martgate_render",
    ("LM_mk_plastic", "plastic_crate"): "LM_martgate_steel",
    ("LM_mg_wall", "render"): "LM_martgate_render",
    ("LM_mg_wall", "granite"): "LM_martgate_granite",
    ("LM_mg_trim", "stone_cladding"): "LM_martgate_stone",
    ("LM_mg_trim", "oak"): "LM_martgate_oak",
}
GOODS = "M_martgate_goods"


def lin(r, g, b):
    return (r, g, b)


class M:
    """A v1 surface (material, band, tint, U direction, atlas cell); converted to a b1 surface when a polygon is emitted."""

    def __init__(self, mat, band=None, col=(1, 1, 1), udir=None, cell=None, grime=False):
        self.mat, self.band, self.col, self.udir, self.cell, self.grime = mat, band, col, udir, cell, grime

    def tint(self, col):
        return M(self.mat, self.band, col, self.udir, self.cell)

    def t(self, col):
        return self.tint(col)

    def u(self, udir):
        return M(self.mat, self.band, self.col, udir, self.cell)

    def o(self, off):
        return self

    def to_s(self):
        if self.cell:
            return S(GOODS, self.col)
        if self.mat in ("M_glass", "M_lamp", "M_sign_emit"):
            return S(self.mat, self.col)
        return S(MAP[(self.mat, self.band)], self.col, self.udir)


ST = M("LM_mk_steel", "steel_painted", (0.6, 0.6, 0.6))
SS = M("LM_mk_steel", "stainless", (1, 1, 1))
RF = M("LM_mk_roof", "corrugated_metal", (0.5, 0.5, 0.5))
WD = M("LM_mk_roof", "wood_boards", (1, 1, 1))
TL = M("LM_mk_ground", "ceramic_tile_white", (1, 1, 1))
PL = M("LM_mk_plastic", "plastic_crate", (1, 1, 1))
RN = M("LM_mg_wall", "render", (0.92, 0.92, 0.90))
GR = M("LM_mg_wall", "granite", (1, 1, 1))
SC = M("LM_mg_trim", "stone_cladding", (1, 1, 1))
OK = M("LM_mg_trim", "oak", (1, 1, 1))
GL = M("M_glass")
LP = M("M_lamp")
SE = M("M_sign_emit")

# the gate's own atlas (1024 px, v up from the image's bottom row): four 512 px cells
CELLS = {"flag": (0.0, 0.0, 0.5, 0.5), "foliage": (0.5, 0.0, 1.0, 0.5), "soil": (0.0, 0.5, 0.5, 1.0), "park_map": (0.5, 0.5, 1.0, 1.0)}


def cell(name, col=(1, 1, 1)):
    return M(None, None, col, cell=name)


def cuv(name, s, t):
    u0, v0, u1, v1 = CELLS[name]
    m = 0.004
    return (u0 + m + (u1 - u0 - 2 * m) * min(max(s, 0), 1), v0 + m + (v1 - v0 - 2 * m) * min(max(t, 0), 1))


class Mesh(BG.Mesh):
    """b1_geom.Mesh taking v1 surfaces (M) and v1 call shapes."""

    def poly(self, pts, m, uv=None, smooth=False, cols=None):
        s = m.to_s() if isinstance(m, M) else m
        if isinstance(m, M) and not m.cell and m.mat not in ("M_glass", "M_lamp", "M_sign_emit"):
            uv = None if uv is not None and len(uv) and isinstance(uv[0], tuple) and False else uv
            if uv is not None and not getattr(self, "_keep_uv", False):
                uv = None  # metre UVs for every library surface
        BG.Mesh.poly(self, pts, s, uv=uv, smooth=smooth, cols=cols)

    def box(self, x0, x1, y0, y1, z0, z1, m, skip=(), mtop=None, top=None, label=None, kind=None):
        BG.Mesh.box(self, x0, x1, y0, y1, z0, z1, m, skip=skip, top=mtop or top, label=label, kind=kind)

    def member(self, a, b, prof, m, up=(0, 1, 0), caps=False):
        d = BG.norm(BG.sub(b, a))
        if abs(BG.dot(d, up)) > 0.98:
            up = (1, 0, 0) if abs(d[0]) < 0.9 else (0, 0, 1)
        side = BG.norm(BG.cross(d, up))
        up2 = BG.cross(side, d)
        ra = [BG.add(a, BG.add(BG.mul(side, s), BG.mul(up2, t))) for s, t in prof]
        rb = [BG.add(b, BG.add(BG.mul(side, s), BG.mul(up2, t))) for s, t in prof]
        n = len(prof)
        mm = m.u(d) if isinstance(m, M) else m
        for i in range(n):
            j = (i + 1) % n
            self.poly([ra[j], ra[i], rb[i], rb[j]], mm, smooth=n > 6)
        if caps:
            self.poly(list(ra), m)
            self.poly(list(reversed(rb)), m)

    def lathe(self, prof, n, m, cx=0.0, cz=0.0, y0=0.0, cap_top=False, cap_bottom=False, sx=1.0, sz=1.0, phase=0.0, smooth=True):
        rings = []
        for r, y in prof:
            rings.append([(cx + r * math.cos(phase + 2 * math.pi * i / n) * sx, y0 + y, cz - r * math.sin(phase + 2 * math.pi * i / n) * sz) for i in range(n)])
        for k in range(len(rings) - 1):
            A, B = rings[k], rings[k + 1]
            for i in range(n):
                j = (i + 1) % n
                if prof[k][0] < 1e-6:
                    self.poly([A[i], B[j], B[i]], m, smooth=smooth)
                elif prof[k + 1][0] < 1e-6:
                    self.poly([A[i], A[j], B[i]], m, smooth=smooth)
                else:
                    self.poly([A[i], A[j], B[j], B[i]], m, smooth=smooth)
        if cap_top and prof[-1][0] > 1e-6:
            self.poly(list(rings[-1]), m)
        if cap_bottom and prof[0][0] > 1e-6:
            self.poly(list(reversed(rings[0])), m)
        return rings

    def cyl(self, cx, cz, r, y0, y1, n, m, top=True, bottom=False, phase=0.0):
        self.lathe([(r, 0), (r, y1 - y0)], n, m, cx, cz, y0, cap_top=top, cap_bottom=bottom, phase=phase)

    def disc(self, cx, y, cz, r, n, m, down=False):
        ring = [(cx + r * math.cos(2 * math.pi * i / n), y, cz - r * math.sin(2 * math.pi * i / n)) for i in range(n)]
        self.poly(list(reversed(ring)) if down else ring, m)

    def quad(self, a, b, c, d, m):
        self.poly([a, b, c, d], m)

    def mats(self):
        return sorted({p.mat for p in self.polys})

    def transformed(self, fn, name=None):
        out = Mesh(name or self.name)
        for p in self.polys:
            out.polys.append(BG.Poly([fn(q) for q in p.pts], p.uv, p.col, p.mat, p.smooth))
        return out


def cquad(mesh, pts, name, s0=0.0, t0=0.0, s1=1.0, t1=1.0, col=(1, 1, 1)):
    uv = [cuv(name, s0, t0), cuv(name, s1, t0), cuv(name, s1, t1), cuv(name, s0, t1)]
    mesh.poly(list(pts), cell(name, col), uv)


def rot_y(p, yaw, ox=0.0, oy=0.0, oz=0.0):
    c, s = math.cos(yaw), math.sin(yaw)
    return (ox + p[0] * c + p[2] * s, oy + p[1], oz - p[0] * s + p[2] * c)


def aabb_of(pts):
    xs, ys, zs = zip(*pts)
    return (min(xs), max(xs), min(ys), max(ys), min(zs), max(zs))


def mesh_aabb(mesh):
    pts = [q for p in mesh.polys for q in p.pts]
    return aabb_of(pts) if pts else None


def prof_box(w, h):
    return [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]


def prof_round(r, n=6):
    return [(r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n)) for i in range(n)]


def shrub(mesh, cx, y0, cz, rx, ry, rz, n=7, rings=3, seed=0):
    """A clipped shrub / flowering bush: a lumpy dome with the foliage cell (real leaf texture, volume)."""
    rng = random.Random(seed)
    prof = [(math.cos(math.pi / 2 * i / rings), math.sin(math.pi / 2 * i / rings)) for i in range(rings + 1)]
    rings_pts = []
    for k, (c, s) in enumerate(prof):
        ring = []
        for i in range(n):
            a = 2 * math.pi * i / n
            j = 1 + rng.uniform(-0.12, 0.12) if 0 < k < rings else 1.0
            ring.append((cx + rx * c * math.cos(a) * j, y0 + ry * s * j, cz - rz * c * math.sin(a) * j))
        rings_pts.append(ring)
    for k in range(rings):
        A, B = rings_pts[k], rings_pts[k + 1]
        for i in range(n):
            j = (i + 1) % n
            pts = [A[i], A[j], B[i]] if k == rings - 1 else [A[i], A[j], B[j], B[i]]
            uv = [cuv("foliage", 0.5 + (p[0] - cx) / (2.2 * rx), 0.5 + (p[1] - y0) / (1.2 * ry) * 0.5 + (p[2] - cz) / (4 * rz)) for p in pts]
            mesh.poly(pts, cell("foliage"), uv, smooth=True)


def soil_disc(mesh, cx, y, cz, rx, rz, n=8):
    ring = [(cx + rx * math.cos(2 * math.pi * i / n), y, cz - rz * math.sin(2 * math.pi * i / n)) for i in range(n)]
    uv = [cuv("soil", 0.5 + 0.5 * math.cos(2 * math.pi * i / n), 0.5 + 0.5 * math.sin(2 * math.pi * i / n)) for i in range(n)]
    mesh.poly(ring, cell("soil"), uv)


class BaseKit:
    """As L4's BaseKit: shell, detail, goods, night glow, instanced kinds (x, y, z, yaw, scale), letters, lights, doors."""

    def __init__(self, seed=23):
        self.S = Mesh("shell")
        self.D = Mesh("detail")
        self.Gd = Mesh("goods")
        self.night = {}
        self.kinds = {}
        self.inst = {}
        self.letters = []
        self.lights = []
        self.W = {}
        self.doors = {}
        self.sweeps = []
        self.rng = random.Random(seed)

    INSTANCED = ()

    def glow(self, part):
        return self.night.setdefault(part, Mesh(part))

    def place(self, kind, x, y, z, yaw=0.0, scale=1.0, into=None):
        if kind in self.INSTANCED and into is None and abs(scale - 1.0) < 1e-6:
            self.inst.setdefault(kind, []).append((x, y, z, yaw))
        else:
            target = into if into is not None else self.Gd
            target.extend(self.kinds[kind].transformed(lambda p: rot_y((p[0] * scale, p[1] * scale, p[2] * scale), yaw, x, y, z)))
