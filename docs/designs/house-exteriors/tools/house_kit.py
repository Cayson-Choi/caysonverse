"""A8 house body kit (X1): the ten houses' shells and body detail as polygons, in plain Python (no bpy), so the build (X4)
and the porch kit (X2) can import it.

Frame (contract 1, = parts_houses.Frame and houseExterior.ts): origin at the footprint's centre, local x = the right hand of
someone walking in through the door, local z = out of the door, y up from the lawn. Points here are (x, y, z) tuples.

Body (contract 1): outer wall faces x +-5.6, z -5.275 (back) .. 3.125 (front, the door), walls 0.30; the visible ground floor
+0.30 (granite plinth 0 .. 0.30, 0.08 out of the body all round, 2 cm chamfer); two storeys of 4.0 -> wall top 8.30; a 38
degree gable roof over the 11.2 m front (eaves front and back 0.70, rakes 0.50), slab 0.20.

Every surface is a PBR set (contract 6): `Poly.mat` is one of the five textured materials or an exempt one (M_glass,
M_window, M_lamp, M_screen); `uv` is in the set's tiling (house_textures.json: metres per texture width, bands);
`col` is the linear RGBA vertex colour = the house's tint (COLOR_0; no weathering since the owner's 2026-11-17 rule).

Two meshes per house (contract 5): `shell` (always drawn: walls, reveals, glass, rooms and curtains seen through it, the
plinth, roof, soffits, fascias, belt course, window heads, chimney) and `detail` (near only: window frames, sashes, handles,
screens, sills, door leaves and lock, drip edges, gutters with hangers, down pipes with clamps and splash blocks, plinth
joints). Shell materials <= 7 (render, stone, roof, metal, wood, glass, window), detail <= 5 (metal, stone, wood, screen,
lamp) so X2 can add M_leaf_flora and stay within contract 5's six detail draws.
"""
import json
import math
import os
import random

# --------------------------------------------------------------------------------------------- numbers --

HB = 5.6                 # half body width (outer faces)
ZB = -5.275              # back wall outer face
ZF = 3.125               # front wall outer face (door plane)
ZC = (ZB + ZF) / 2       # -1.075: the ridge line
HD = (ZF - ZB) / 2       # 4.2
T_WALL = 0.30
FL = 0.30                # visible ground floor (floorLift)
STOREY = 4.0
WT = FL + 2 * STOREY     # 8.30 wall top
PLINTH_OUT = 0.08
PITCH = math.radians(38.0)
TAN_P = math.tan(PITCH)
COS_P = math.cos(PITCH)
ROOF_T = 0.20
VT = ROOF_T / COS_P
EAVE = 0.70
RAKE = 0.50
Y_RIDGE_U = WT + HD * TAN_P            # roof underside at the ridge 11.581
Y_RIDGE_T = Y_RIDGE_U + VT             # 11.835
Y_EAVE_U = WT - EAVE * TAN_P           # underside at the eave edge 7.753
Y_EAVE_T = Y_EAVE_U + VT               # 8.007
FASCIA_H = 0.30
SHINGLE_LIP = 0.028                    # design 4.1: each course 2.8 cm proud of the one above
INTERIOR_W = 10.6
INTERIOR_D = 7.8
# X2 (porch_kit.py): the front eave's down pipes end in the porch beds' drain collars
FRONT_PIPES_INTO_BEDS = True

TRIM = "#F4F1EA"
FRAME_WHITE = "#F3F1EC"
FRAME_DARK = "#3B3E43"
METAL_DARK = "#4A4E54"
METAL_WHITE = "#ECEBE6"

# per house: the owner's wall colour stays in the layout; this is what differs (design 4.2 + parts_houses.HOUSE_SPEC; roofs per
# the owner's "추천대로" = Korean countryside 전원주택: asphalt shingles, zinc standing-seam on the three modern dark-fascia houses)
HOUSE_SPEC = {
    "house_1": dict(roof="shingle", roof_tint="#A0A8B2", frame="white", fascia="white", chimney="stucco",
                    curtains=["#F3E9DC", "#E8C3BA"], room="#EFE3D2", door="#9A6B47"),
    "house_2": dict(roof="shingle", roof_tint="#BAC1C9", frame="white", fascia="white", chimney="stucco",
                    curtains=["#FAF8F3", "#F6D27A"], room="#F3EAD8", door="#A0714B"),
    "house_3": dict(roof="shingle", roof_tint="#9DBBDD", frame="dark", fascia="white", chimney="stucco",
                    curtains=["#EFE8DA", "#C98A3A"], room="#EFE6D2", door="#7A5236", juliet=True),
    "house_4": dict(roof="zinc", roof_tint="#6E747C", frame="dark", fascia="dark", chimney="flue",
                    curtains=["#F4EFE4", "#A9C2B0"], room="#EEE6D6", door="#6B4A33", gable_cladding=True),
    "house_5": dict(roof="shingle", roof_tint="#BAC1C9", frame="white", fascia="white", chimney="stucco",
                    curtains=["#F8F7F2", "#BFE8D2"], room="#EDEAD8", door="#9A6B47"),
    "house_6": dict(roof="shingle", roof_tint="#9DBBDD", frame="white", fascia="white", chimney="stucco",
                    curtains=["#F6E7C2", "#E9C27A"], room="#F1E4C8", door="#A0714B"),
    "house_7": dict(roof="shingle", roof_tint="#BAC1C9", frame="dark", fascia="white", chimney="stucco",
                    curtains=["#F2ECE1", "#B7C9B0"], room="#EFE9DB", door="#7A5236"),
    "house_8": dict(roof="zinc", roof_tint="#8D949C", frame="dark", fascia="dark", chimney="flue",
                    curtains=["#4A5568", "#6EC1F0"], room="#D8DCE6", door="#5E4130", siding="#F2EDE6"),
    "house_9": dict(roof="shingle", roof_tint="#A0A8B2", frame="white", fascia="white", chimney="stucco",
                    curtains=["#F1E6D6", "#D9A3A0"], room="#F0E2D0", door="#9A6B47"),
    "house_10": dict(roof="zinc", roof_tint="#6E747C", frame="dark", fascia="dark", chimney="flue",
                     curtains=["#C8B48A", "#6F7A4A"], room="#EAE5D5", door="#6B4A33", siding="#D9CFC3"),
}

WALL_TINT = {"pink": "#FFC9D4", "skyblue": "#BFE3FA", "yellow": "#FFE9A6", "white": "#FFFFFF", "mint": "#C4F0DC"}


def lin(h, a=1.0):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple([x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [a])


def mul(c, k):
    return (c[0] * k, c[1] * k, c[2] * k, c[3])


# ------------------------------------------------------------------------------------------- vectors --

def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def sc(a, k):
    return (a[0] * k, a[1] * k, a[2] * k)


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def norm(a):
    l = math.sqrt(dot(a, a))
    return (a[0] / l, a[1] / l, a[2] / l) if l > 1e-12 else (0.0, 0.0, 0.0)


def newell(pts):
    n = [0.0, 0.0, 0.0]
    for i, p in enumerate(pts):
        q = pts[(i + 1) % len(pts)]
        n[0] += (p[1] - q[1]) * (p[2] + q[2])
        n[1] += (p[2] - q[2]) * (p[0] + q[0])
        n[2] += (p[0] - q[0]) * (p[1] + q[1])
    return norm(tuple(n))


UP = (0.0, 1.0, 0.0)

# ------------------------------------------------------------------------------------ textures / UVs --

_HERE = os.path.dirname(os.path.abspath(__file__))
TEX = None


def load_tex(path):
    global TEX
    with open(path, encoding="utf-8") as f:
        TEX = json.load(f)["materials"]
    return TEX


# set -> (material, band or None)
SET_MAT = {"render": ("LM_render", None), "granite": ("LM_stone", None), "shingle": ("LM_roof", None),
           "oak": ("LM_wood", "oak"), "timber_cladding": ("LM_wood", "timber_cladding"),
           "metal_painted": ("LM_metal", "metal_painted"), "pvc_frame": ("LM_metal", "pvc_frame")}
EXEMPT = ("M_glass", "M_window", "M_lamp", "M_screen")
# board sets cut on a grid: (metres per band = whole boards, band V start, band V end). The cedar band holds 7 boards of
# 80.3 mm between its rows 1 and 510 (make_house_textures.py: the scan's joints every 145.4 px of 2048).
VGRID = {"timber_cladding": (7 * 0.0803, 1.5 / 1024, 511.0 / 1024)}


class Poly:
    __slots__ = ("pts", "mat", "uv", "col", "set")

    def __init__(self, pts, mat, uv, col, sset):
        self.pts, self.mat, self.uv, self.col, self.set = pts, mat, uv, col, sset


class Part:
    """One mesh (a house's shell or detail): polygons in the house's local frame."""

    def __init__(self, name, rng):
        self.name = name
        self.polys = []
        self.rng = rng

    def tris(self):
        return sum(len(p.pts) - 2 for p in self.polys)

    def mats(self):
        return sorted({p.mat for p in self.polys})


def _clip(pts, uvs, axis, lo, hi):
    """Clip a convex polygon (with its UVs) to lo <= uv[axis] <= hi (Sutherland-Hodgman)."""
    def clip_one(P, U, keep):
        out_p, out_u = [], []
        n = len(P)
        for i in range(n):
            a, b = P[i], P[(i + 1) % n]
            ua, ub = U[i], U[(i + 1) % n]
            ina, inb = keep(ua), keep(ub)
            if ina:
                out_p.append(a)
                out_u.append(ua)
            if ina != inb:
                fa = ua[axis] - (lo if not keep_lo_flag[0] else hi)
                fb = ub[axis] - (lo if not keep_lo_flag[0] else hi)
                t = fa / (fa - fb) if abs(fa - fb) > 1e-12 else 0.0
                out_p.append(add(a, sc(sub(b, a), t)))
                out_u.append((ua[0] + (ub[0] - ua[0]) * t, ua[1] + (ub[1] - ua[1]) * t))
        return out_p, out_u
    keep_lo_flag = [False]
    P, U = clip_one(pts, uvs, lambda u: u[axis] >= lo - 1e-9)
    if len(P) < 3:
        return [], []
    keep_lo_flag[0] = True
    P, U = clip_one(P, U, lambda u: u[axis] <= hi + 1e-9)
    return (P, U) if len(P) >= 3 else ([], [])


def face(part, pts, sset, tint=(1, 1, 1, 1), hint=None, uax=None, origin=None, uoff=None, voff=None, scale=1.0,
         shade=None, uvs=None, mat=None):
    """A planar convex polygon. sset: a texture set name (render, granite, shingle, oak, timber_cladding, metal_painted,
    pvc_frame) or an exempt material (M_glass, ...). hint: the direction the normal must point along (the polygon is
    reversed otherwise). uax: the U direction on the face (default: horizontal along the face, or +x on a level face).
    scale: texture repeats per metre multiplier (2 = half the texel density)."""
    pts = [tuple(map(float, p)) for p in pts]
    n = newell(pts)
    if hint is not None and dot(n, hint) < 0:
        pts.reverse()
        if uvs is not None:
            uvs = list(reversed(uvs))
        n = sc(n, -1)
    if sset in EXEMPT:
        m, band = sset, None
        if uvs is None:
            uvs = [(0.0, 0.0)] * len(pts)
        col = [tint] * len(pts)
        part.polys.append(Poly(pts, m, uvs, col, sset))
        return
    m, band = SET_MAT[sset]
    if mat:
        m = mat
    info = TEX[m]
    if band:
        b = info["bands"][band]
        um, vm, v0, v1 = b["u_m"], b["v_m"], b["v0"], b["v1"]
    else:
        um, vm, v0, v1 = info["u_m"], info.get("v_m", info["u_m"]), None, None
    um, vm = um * scale, vm * scale
    if uvs is None:
        if uax is None:
            if abs(n[1]) > 0.95:
                uax = (1.0, 0.0, 0.0)
            else:
                uax = norm((n[2], 0.0, -n[0]))
        uax = norm(sub(uax, sc(n, dot(uax, n))))
        vax = cross(n, uax)
        o = origin if origin is not None else (0.0, 0.0, 0.0)
        rng = part.rng
        uo = rng.random() if uoff is None else uoff
        vo = (rng.random() if band is None else 0.0) if voff is None else voff
        if band in VGRID:
            # boards: cut the face on a fixed grid (whole boards per band, joints on the grid), every strip the same rows
            step, va, vb = VGRID[band]
            step *= scale
            uvw = [(dot(sub(p, o), uax) / um + uo, dot(sub(p, o), vax)) for p in pts]
            vw = [q[1] for q in uvw]
            k0, k1 = int(math.floor(min(vw) / step + 1e-6)), int(math.ceil(max(vw) / step - 1e-6))
            for k in range(k0, max(k1, k0 + 1)):
                P, U = _clip(pts, uvw, 1, k * step, (k + 1) * step)
                if not P:
                    continue
                uvb = [(q[0], va + (q[1] - k * step) / step * (vb - va)) for q in U]
                col = [mul(tint, shade(p)) if shade else tint for p in P]
                part.polys.append(Poly(P, m, uvb, col, sset))
            return
        uvs = [(dot(sub(p, o), uax) / um + uo, dot(sub(p, o), vax) / vm + vo) for p in pts]
    if band:
        vs = [u[1] for u in uvs]
        lo, hi = min(vs), max(vs)
        span = 0.96
        if hi - lo > span:
            k = lo
            while k < hi - 1e-9:
                P, U = _clip(pts, uvs, 1, k, min(k + span, hi))
                if P:
                    _band_poly(part, P, U, m, band, v0, v1, tint, shade, sset, n)
                k += span
            return
        _band_poly(part, pts, uvs, m, band, v0, v1, tint, shade, sset, n)
        return
    col = [mul(tint, shade(p)) if shade else tint for p in pts]
    part.polys.append(Poly(pts, m, uvs, col, sset))


def _band_poly(part, pts, uvs, m, band, v0, v1, tint, shade, sset, n):
    vs = [u[1] for u in uvs]
    lo, hi = min(vs), max(vs)
    room = max(0.0, 0.96 - (hi - lo))
    off = 0.02 + part.rng.random() * room
    uvb = [(u[0], v0 + (u[1] - lo + off) * (v1 - v0)) for u in uvs]
    col = [mul(tint, shade(p)) if shade else tint for p in pts]
    part.polys.append(Poly(pts, m, uvb, col, sset))


def box(part, x0, x1, y0, y1, z0, z1, sset, tint=(1, 1, 1, 1), skip=(), along=None, scale=1.0, shade=None):
    """An axis box in the local frame; skip: top bot front(+z) back(-z) right(+x) left(-x); along: 'x' 'y' 'z' = the U
    direction on the side faces (default the longest edge)."""
    if x1 - x0 < 1e-6 or y1 - y0 < 1e-6 or z1 - z0 < 1e-6:
        return
    dims = {"x": x1 - x0, "y": y1 - y0, "z": z1 - z0}
    al = along or max(dims, key=dims.get)
    A = {"x": (1.0, 0.0, 0.0), "y": (0.0, 1.0, 0.0), "z": (0.0, 0.0, 1.0)}
    F = {
        "top": ([(x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)], (0, 1, 0)),
        "bot": ([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], (0, -1, 0)),
        "front": ([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], (0, 0, 1)),
        "back": ([(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0)], (0, 0, -1)),
        "right": ([(x1, y0, z0), (x1, y0, z1), (x1, y1, z1), (x1, y1, z0)], (1, 0, 0)),
        "left": ([(x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0)], (-1, 0, 0)),
    }
    o = (x0, y0, z0)
    uo = part.rng.random()
    for k, (pts, h) in F.items():
        if k in skip:
            continue
        ua = A[al]
        if abs(dot(ua, h)) > 0.5:          # U can't run along the normal: take the other long edge
            rest = [d for d in ("x", "y", "z") if abs(dot(A[d], h)) < 0.5]
            ua = A[max(rest, key=dims.get)]
        face(part, pts, sset, tint, h, uax=ua, origin=o, uoff=uo, scale=scale, shade=shade)


# ----------------------------------------------------------------------------------------------- walls --

class Wall:
    """A vertical wall plane: n = outward normal (nx, nz); o = (x, z) on the outer plane at u = 0. u runs to the right
    seen from outside, d into the wall."""

    def __init__(self, n, o):
        self.n, self.o = n, o
        self.t = (n[1], -n[0])
        self.N = (float(n[0]), 0.0, float(n[1]))
        self.T = (float(self.t[0]), 0.0, float(self.t[1]))

    def P(self, u, y, d=0.0):
        return (self.o[0] + self.t[0] * u - self.n[0] * d, y, self.o[1] + self.t[1] * u - self.n[1] * d)

    def dirv(self, nu=0.0, ny=0.0, nd=0.0):
        return (self.t[0] * nu - self.n[0] * nd, ny, self.t[1] * nu - self.n[1] * nd)

    def quad(self, part, uyd, sset, tint=(1, 1, 1, 1), normal=(0, 0, -1), **kw):
        face(part, [self.P(*p) for p in uyd], sset, tint, self.dirv(*normal), **kw)

    def box(self, part, u0, u1, y0, y1, d0, d1, sset, tint=(1, 1, 1, 1), faces="frltu", along=None, scale=1.0, shade=None):
        """f: outer face (d0), b: back (d1), l: u0 side, r: u1 side, t: top, u: underside. along: 'u' 'y' 'd'."""
        if u1 - u0 < 1e-6 or y1 - y0 < 1e-6 or d1 - d0 < 1e-6:
            return
        dims = {"u": u1 - u0, "y": y1 - y0, "d": d1 - d0}
        al = along or max(dims, key=dims.get)
        A = {"u": self.T, "y": UP, "d": sc(self.N, -1)}
        o = self.P(u0, y0, d0)
        uo = part.rng.random()
        spec = {
            "f": ([(u0, y0, d0), (u1, y0, d0), (u1, y1, d0), (u0, y1, d0)], (0, 0, -1)),
            "b": ([(u0, y0, d1), (u1, y0, d1), (u1, y1, d1), (u0, y1, d1)], (0, 0, 1)),
            "l": ([(u0, y0, d0), (u0, y0, d1), (u0, y1, d1), (u0, y1, d0)], (-1, 0, 0)),
            "r": ([(u1, y0, d0), (u1, y0, d1), (u1, y1, d1), (u1, y1, d0)], (1, 0, 0)),
            "t": ([(u0, y1, d0), (u1, y1, d0), (u1, y1, d1), (u0, y1, d1)], (0, 1, 0)),
            "u": ([(u0, y0, d0), (u1, y0, d0), (u1, y0, d1), (u0, y0, d1)], (0, -1, 0)),
        }
        for k in faces:
            pts, nrm = spec[k]
            h = self.dirv(*nrm)
            ua = A[al]
            if abs(dot(ua, h)) > 0.5:
                rest = [d for d in ("u", "y", "d") if abs(dot(A[d], h)) < 0.5]
                ua = A[max(rest, key=dims.get)]
            face(part, [self.P(*p) for p in pts], sset, tint, h, uax=ua, origin=o, uoff=uo, scale=scale, shade=shade)


def wall_pieces(part, W, spans, y0, openings, sset, tint, ybreaks=(), uoff=0.0, shade=None, scale=1.0, uax=None):
    """The outer face of a wall as polygons around the openings (u0, u1, v0, v1). spans: (ua, ub) or a function of the
    height giving it (gables). The pieces share their vertices (no T-junctions) and their UVs are one continuous projection
    of the wall, so a wall is one seamless sheet of the texture."""
    ext = spans if callable(spans) else (lambda v, s=spans: s)
    vs = sorted({y0} | {o[2] for o in openings} | {o[3] for o in openings} | set(ybreaks))
    vs = [v for k, v in enumerate(vs) if k == 0 or v - vs[k - 1] >= 1e-4]

    def band_blocks(i):
        if i < 0 or i >= len(vs) - 1:
            return []
        vm = (vs[i] + vs[i + 1]) / 2
        return sorted((o[0], o[1]) for o in openings if o[2] <= vm <= o[3])

    def tj(i, lo, hi):
        return sorted({u for b in band_blocks(i) for u in b if lo + 1e-4 < u < hi - 1e-4})

    origin = W.P(0.0, 0.0, 0.0)
    ua_ = uax or W.T
    for i, (va, vb) in enumerate(zip(vs[:-1], vs[1:])):
        blocks = band_blocks(i)
        ea, eb = ext(va), ext(vb)
        edges = []
        left = (ea[0], eb[0])
        for (bu0, bu1) in blocks:
            edges.append((left, (bu0, bu0)))
            left = (bu1, bu1)
        edges.append((left, (ea[1], eb[1])))
        for (l, r) in edges:
            if r[0] - l[0] < 1e-4 and r[1] - l[1] < 1e-4:
                continue
            bot = [(l[0], va, 0)] + [(u, va, 0) for u in tj(i - 1, l[0], r[0])] + [(r[0], va, 0)]
            top = [(r[1], vb, 0)] + [(u, vb, 0) for u in reversed(tj(i + 1, l[1], r[1]))] + [(l[1], vb, 0)]
            if abs(r[1] - l[1]) < 1e-4:
                pts = bot + [top[0]]
            elif abs(r[0] - l[0]) < 1e-4:
                pts = [bot[0]] + top
            else:
                pts = bot + top
            face(part, [W.P(*p) for p in pts], sset, tint, W.N, uax=ua_, origin=origin, uoff=uoff, voff=0.0, shade=shade,
                 scale=scale)


def reveal(part, W, o, depth, tint, shade=None):
    """The four faces round an opening (u0, u1, v0, v1), from the outer plane to `depth` (render, like the wall)."""
    u0, u1, v0, v1 = o
    W.quad(part, [(u0, v0, 0), (u0, v0, depth), (u0, v1, depth), (u0, v1, 0)], "render", tint, (1, 0, 0), shade=shade)
    W.quad(part, [(u1, v0, 0), (u1, v0, depth), (u1, v1, depth), (u1, v1, 0)], "render", tint, (-1, 0, 0), shade=shade)
    W.quad(part, [(u0, v0, 0), (u1, v0, 0), (u1, v0, depth), (u0, v0, depth)], "render", tint, (0, 1, 0), shade=shade)
    W.quad(part, [(u0, v1, 0), (u1, v1, 0), (u1, v1, depth), (u0, v1, depth)], "render", tint, (0, -1, 0), shade=shade)


# ------------------------------------------------------------------------------------------------ house --

class House:
    """One house's kit run: `shell`, `detail`, the openings actually cut (for the window table) and its spec."""

    def __init__(self, hid, colour, seed, windows):
        self.id = hid
        self.spec = HOUSE_SPEC[hid]
        self.rng = random.Random(seed)
        self.shell = Part("houseshell__" + hid, random.Random(seed + 1))
        self.detail = Part("housedetail__" + hid, random.Random(seed + 2))
        self.wall = lin(WALL_TINT.get(colour, "#FFFFFF"))
        self.trim = lin(TRIM)
        self.frame = lin(FRAME_WHITE if self.spec["frame"] == "white" else FRAME_DARK)
        self.fascia = lin(METAL_WHITE if self.spec["fascia"] == "white" else METAL_DARK)
        self.windows = windows          # the design table's openings (interior frame)
        self.cut = []                   # (opening dict, u0, u1, v0, v1, wall name): what was cut
        self.lights = []                # (x, y, z, kind) for the renders
        self.lit = set()

    # no weathering (owner 2026-11-17: "모두가 새것이어야 해 헌집은 없어야 해"): the walls are evenly their colour. The 2026-11-16
    # build darkened the foot (0.80 at FL -> 1 at 1.25 m) and the top (0.94 over 7.2 m); housesPrep.ts freshenWalls undoes it in
    # a model built then.
    def wall_shade(self, p):
        return 1.0

    def wall_shade_2026_11_16(self, p):
        y = p[1]
        k = 1.0
        if y < 1.25:
            t = max(0.0, min(1.0, (y - FL) / (1.25 - FL)))
            k *= 0.80 + 0.20 * (t * t * (3 - 2 * t))
        if y > 7.2:
            k *= 0.94
        return k


def wall_frames():
    """The four walls of the body (outer planes) by name: front +z, back -z, left -x, right +x."""
    return {
        "front": Wall((0, 1), (0.0, ZF)),
        "back": Wall((0, -1), (0.0, ZB)),
        "left": Wall((-1, 0), (-HB, ZC)),
        "right": Wall((1, 0), (HB, ZC)),
    }


def opening_rect(o):
    """An opening of the table (interior frame) on its wall: (u0, u1, v0, v1) in that wall's u (outer plane)."""
    w = o["wall"]
    y0 = o["sill"] + FL
    if w in ("front", "back"):
        lx = o["at"] - INTERIOR_W / 2
        u = lx if w == "front" else -lx
    else:
        lz = (ZF - T_WALL) - o["at"]
        u = (lz - ZC) if w == "left" else -(lz - ZC)
    return (u - o["width"] / 2, u + o["width"] / 2, y0, y0 + o["height"])


def rect_to_opening(o, r):
    """The inverse: a cut rectangle back to the table's numbers (interior frame), for the build's window table."""
    u0, u1, v0, v1 = r
    uc = (u0 + u1) / 2
    w = o["wall"]
    if w in ("front", "back"):
        lx = uc if w == "front" else -uc
        at = lx + INTERIOR_W / 2
    else:
        lz = (uc if w == "left" else -uc) + ZC
        at = (ZF - T_WALL) - lz
    def r3(v):
        v = round(v + 0.0, 3)
        return int(v) if v == int(v) else v
    return {"wall": w, "floor": o["floor"], "kind": o["kind"], "at": r3(at), "width": r3(u1 - u0), "height": r3(v1 - v0),
            "sill": r3(v0 - FL)}


def gable_ext(v):
    if v <= WT + 1e-9:
        return (-HD, HD)
    k = max(0.0, (Y_RIDGE_U - v) / TAN_P)
    return (-k, k)


# ---------------------------------------------------------------------------------------------- windows --

def window(H, W, wname, rect, kind, lit, curtains=True, lite=False, sashes=2, transom=None):
    """A PVC tilt-and-slide window in an opening (contract 7: the opening is the table's rectangle): reveal, glass (shell),
    rooms seen through, curtains, a lit card for night (M_window), the window head moulding (shell); the frame ring, the
    sashes with their crescent lock, a fly screen on one sash, the granite sill with its drip groove (detail)."""
    sh, de = H.shell, H.detail
    u0, u1, v0, v1 = rect
    w, h = u1 - u0, v1 - v0
    uc = (u0 + u1) / 2
    # in the ceramic siding (houses 8, 10) the openings are lined with a trim return, as the cladding's J-trim is
    rt = H.trim if (H.spec.get("siding") and v0 < FL + STOREY) else H.wall
    reveal(sh, W, rect, T_WALL, rt, H.wall_shade)
    fw = 0.07
    d0, d1 = 0.09, 0.20                       # the frame's depth in the wall (outer face 9 cm in)
    fc = (d0 + d1) / 2
    fr = H.frame
    # frame ring: outer faces + the inner returns
    W.box(de, u0, u0 + fw, v0, v1, d0, d1, "pvc_frame", fr, faces="fr", along="y")
    W.box(de, u1 - fw, u1, v0, v1, d0, d1, "pvc_frame", fr, faces="fl", along="y")
    W.box(de, u0 + fw, u1 - fw, v1 - fw, v1, d0, d1, "pvc_frame", fr, faces="fu", along="u")
    W.box(de, u0 + fw, u1 - fw, v0, v0 + fw, d0, d1, "pvc_frame", fr, faces="ft", along="u")
    gi0, gi1 = u0 + fw, u1 - fw
    top = v1 - fw
    tr = transom if transom is not None else (0.45 if (h >= 1.8 and kind == "window") else 0.0)
    if tr > 0:
        W.box(de, gi0, gi1, top - tr - 0.06, top - tr, d0 + 0.005, d1 - 0.005, "pvc_frame", fr, faces="ftu", along="u")
        W.quad(sh, [(gi0, top - tr, fc), (gi1, top - tr, fc), (gi1, top, fc), (gi0, top, fc)], "M_glass", (1, 1, 1, 1),
               uvs=[(0, 0), (1, 0), (1, 1), (0, 1)])
        top = top - tr - 0.06
    bot = v0 + fw
    sw = (gi1 - gi0) / sashes
    sf = 0.055
    for k in range(sashes):
        su0 = gi0 + k * sw
        su1 = su0 + sw
        dd = fc + (0.0 if sashes == 1 else (-0.028 if k % 2 == 0 else 0.028))
        a, b = su0 - (0.012 if k > 0 else 0.0), su1 + (0.012 if k < sashes - 1 else 0.0)   # sashes overlap at the meeting rail
        W.box(de, a, a + sf, bot, top, dd - 0.022, dd + 0.022, "pvc_frame", fr, faces="fr", along="y")
        W.box(de, b - sf, b, bot, top, dd - 0.022, dd + 0.022, "pvc_frame", fr, faces="fl", along="y")
        W.box(de, a + sf, b - sf, top - sf, top, dd - 0.022, dd + 0.022, "pvc_frame", fr, faces="fu", along="u")
        W.box(de, a + sf, b - sf, bot, bot + sf + 0.01, dd - 0.022, dd + 0.022, "pvc_frame", fr, faces="ft", along="u")
        W.quad(sh, [(a + sf, bot + sf, dd), (b - sf, bot + sf, dd), (b - sf, top - sf, dd), (a + sf, top - sf, dd)],
               "M_glass", (1, 1, 1, 1), uvs=[(0, 0), (1, 0), (1, 1), (0, 1)])
        if sashes >= 2 and k < 2:
            # the crescent lock on the meeting stiles (one pair), a pull on the other sash
            if k == 0:
                hu = b - sf * 0.5
                W.box(de, hu - 0.018, hu + 0.018, bot + (top - bot) * 0.5 - 0.035, bot + (top - bot) * 0.5 + 0.035,
                      dd - 0.045, dd - 0.022, "metal_painted", lin("#B9BBBE"), faces="fltru")
            else:
                hu = a + sf * 0.5
                W.box(de, hu - 0.012, hu + 0.012, bot + (top - bot) * 0.45, bot + (top - bot) * 0.55,
                      dd - 0.040, dd - 0.022, "metal_painted", lin("#B9BBBE"), faces="fltr")
    # fly screen over the right-hand sash (outside it), in a thin aluminium frame
    if sashes == 2 and not lite and kind == "window":
        su0, su1 = gi0 + sw - 0.01, gi1
        ds = fc - 0.06
        face(de, [W.P(su0 + 0.025, bot + 0.025, ds), W.P(su1 - 0.025, bot + 0.025, ds), W.P(su1 - 0.025, top - 0.025, ds),
                  W.P(su0 + 0.025, top - 0.025, ds)], "M_screen", (1, 1, 1, 1), W.N)
        sfr = lin("#8E9298")
        W.box(de, su0, su0 + 0.025, bot, top, ds - 0.012, ds, "metal_painted", sfr, faces="f", along="y")
        W.box(de, su1 - 0.025, su1, bot, top, ds - 0.012, ds, "metal_painted", sfr, faces="f", along="y")
        W.box(de, su0 + 0.025, su1 - 0.025, top - 0.025, top, ds - 0.012, ds, "metal_painted", sfr, faces="f", along="u")
        W.box(de, su0 + 0.025, su1 - 0.025, bot, bot + 0.025, ds - 0.012, ds, "metal_painted", sfr, faces="ft", along="u")
    # the granite sill: 6 cm thick, 10 cm proud, 10 cm past each side, a 1 cm drip groove underneath (design 4.1)
    if kind == "window":
        sy1, sy0 = v0, v0 - 0.06
        W.box(de, u0 - 0.10, u1 + 0.10, sy0, sy1, -0.10, d0, "granite", (1, 1, 1, 1), faces="frltu", along="u")
        W.box(de, u0 - 0.06, u1 + 0.06, sy0 - 0.012, sy0, -0.075, -0.06, "granite", mul((1, 1, 1, 1), 0.8), faces="fltr",
              along="u")
    # the window head: a stucco moulding over the opening (shell, render, trim colour)
    W.box(sh, u0 - 0.12, u1 + 0.12, v1, v1 + 0.14, -0.05, 0.0, "render", H.trim, faces="ftlru", along="u")
    # room behind: curtains, and a warm card that the game lights at night (M_window)
    if curtains:
        curtain(H, W, uc, w, v0, h, T_WALL + 0.12, H.rng.choice([lin(c) for c in H.spec["curtains"]]), lite)
    if lit:
        dl = T_WALL + 0.45
        W.quad(sh, [(u0 - 0.2, v0 - 0.05, dl), (u1 + 0.2, v0 - 0.05, dl), (u1 + 0.2, v1 + 0.05, dl), (u0 - 0.2, v1 + 0.05, dl)],
               "M_window", (1, 1, 1, 1), uvs=[(0, 0), (1, 0), (1, 1), (0, 1)])
        H.lights.append(W.P(uc, v0 + h * 0.55, T_WALL + 0.9) + ("window",))
    H.cut.append((wname, rect))


def curtain(H, W, uc, w, y0, h, d, tint, lite):
    """Pleated curtain panels behind the glass (shell, render set at a fine scale = woven fabric mottling)."""
    sh = H.shell
    top = y0 + h + 0.08
    bot = y0 - 0.08
    n = 2 if lite else 4
    pw = w * 0.26
    rod0, rod1 = uc - w / 2 + 0.03, uc + w / 2 - 0.03          # the gathered panels show inside the opening
    for side in (-1, 1):
        ua = rod0 if side < 0 else rod1 - pw
        pts = [(ua + pw * i / n, d + (0.035 if i % 2 else -0.035)) for i in range(n + 1)]
        for i in range(n):
            (ua_, da), (ub_, db) = pts[i], pts[i + 1]
            face(sh, [W.P(ua_, bot, da), W.P(ub_, bot, db), W.P(ub_, top, db), W.P(ua_, top, da)], "render", tint,
                 W.dirv(0, 0, -1), uax=UP, scale=0.25)


# ------------------------------------------------------------------------------------------------- door --

def door(H, W, rect):
    """The front door (contract 1: 1.8 x 2.9 glass double door, centred): oak frame and leaves with glass, long bar pulls,
    a digital door lock with a lit keypad (M_lamp), a granite threshold."""
    sh, de = H.shell, H.detail
    u0, u1, v0, v1 = rect
    reveal(sh, W, rect, T_WALL, H.trim if H.spec.get("siding") else H.wall, H.wall_shade)
    oak = lin(H.spec["door"])
    leaf = mul(oak, 0.85)
    jw = 0.07
    d0, d1 = 0.08, 0.20
    W.box(de, u0, u0 + jw, v0, v1, d0, d1, "oak", oak, faces="fr", along="y")
    W.box(de, u1 - jw, u1, v0, v1, d0, d1, "oak", oak, faces="fl", along="y")
    W.box(de, u0 + jw, u1 - jw, v1 - jw, v1, d0, d1, "oak", oak, faces="fu", along="u")
    # threshold (granite, flush with the porch floor)
    W.box(de, u0, u1, v0 - 0.02, v0 + 0.015, -0.04, d1 + 0.05, "granite", (1, 1, 1, 1), faces="ft", along="u")
    uc = (u0 + u1) / 2
    top = v1 - jw
    dd = 0.14
    for k, (a, b) in enumerate(((u0 + jw, uc - 0.004), (uc + 0.004, u1 - jw))):
        st, rl, kick = 0.11, 0.11, 0.24
        W.box(de, a, a + st, v0 + 0.015, top - 0.004, dd - 0.028, dd + 0.028, "oak", leaf, faces="frl", along="y")
        W.box(de, b - st, b, v0 + 0.015, top - 0.004, dd - 0.028, dd + 0.028, "oak", leaf, faces="flr", along="y")
        W.box(de, a + st, b - st, top - 0.004 - rl, top - 0.004, dd - 0.028, dd + 0.028, "oak", leaf, faces="fu", along="u")
        W.box(de, a + st, b - st, v0 + 0.015, v0 + kick, dd - 0.028, dd + 0.028, "oak", leaf, faces="ft", along="u")
        W.box(de, a + st, b - st, v0 + 1.06, v0 + 1.14, dd - 0.026, dd + 0.026, "oak", leaf, faces="ftu", along="u")
        W.quad(sh, [(a + st, v0 + kick, dd), (b - st, v0 + kick, dd), (b - st, top - 0.004 - rl, dd), (a + st, top - 0.004 - rl, dd)],
               "M_glass", (1, 1, 1, 1), uvs=[(0, 0), (1, 0), (1, 1), (0, 1)])
        # a long stainless bar pull on standoffs at the meeting stiles
        hu = uc - 0.17 if k == 0 else uc + 0.17
        steel = lin("#C4C6C8")
        W.box(de, hu - 0.014, hu + 0.014, v0 + 0.80, v0 + 1.75, dd - 0.10, dd - 0.072, "metal_painted", steel, faces="fltru",
              along="y")
        for yy in (v0 + 0.86, v0 + 1.69):
            W.box(de, hu - 0.009, hu + 0.009, yy - 0.009, yy + 0.009, dd - 0.072, dd - 0.028, "metal_painted", steel, faces="fltu",
                  along="d")
    # the digital door lock on the right leaf (satin body, black face, lit 3 x 4 keypad, status bar, handle)
    lu = uc + 0.60
    lf = dd - 0.028
    satin = lin("#B5B8BC")
    W.box(de, lu - 0.05, lu + 0.05, v0 + 0.98, v0 + 1.38, lf - 0.035, lf, "metal_painted", satin, faces="fltru", along="y")
    W.quad(de, [(lu - 0.039, v0 + 1.02, lf - 0.037), (lu + 0.039, v0 + 1.02, lf - 0.037), (lu + 0.039, v0 + 1.34, lf - 0.037),
                (lu - 0.039, v0 + 1.34, lf - 0.037)], "metal_painted", lin("#141518"), (0, 0, -1), uax=UP)
    for r in range(4):
        for col in (-1, 0, 1):
            ku, kv = lu + col * 0.022, v0 + 1.11 + r * 0.035
            W.quad(de, [(ku - 0.007, kv - 0.007, lf - 0.038), (ku + 0.007, kv - 0.007, lf - 0.038),
                        (ku + 0.007, kv + 0.007, lf - 0.038), (ku - 0.007, kv + 0.007, lf - 0.038)], "M_lamp", (1, 1, 1, 1),
                   uvs=[(0.5, 0.5)] * 4)
    W.quad(de, [(lu - 0.025, v0 + 1.29, lf - 0.038), (lu + 0.025, v0 + 1.29, lf - 0.038), (lu + 0.025, v0 + 1.30, lf - 0.038),
                (lu - 0.025, v0 + 1.30, lf - 0.038)], "M_lamp", (1, 1, 1, 1), uvs=[(0.5, 0.5)] * 4)
    W.box(de, lu - 0.11, lu + 0.02, v0 + 0.925, v0 + 0.955, lf - 0.06, lf - 0.03, "metal_painted", satin, faces="fltru", along="u")
    # door head moulding
    W.box(sh, u0 - 0.14, u1 + 0.14, v1, v1 + 0.16, -0.05, 0.0, "render", H.trim, faces="ftlru", along="u")
    # curtains are not drawn behind a door: the hall (room colour) shows through its glass
    H.cut.append(("front", rect))


# ------------------------------------------------------------------------------------------- the body --

def body(H, lit_keys=None):
    """Plinth, the four walls with every opening of the window table, the belt course, rooms seen through the glass."""
    sh, de = H.shell, H.detail
    walls = wall_frames()
    spec = H.spec
    # ---- granite plinth (기초 단): 0.30 high, 0.08 out of the body, a 2 cm chamfer on its top edge, 5 cm into the lawn
    po = PLINTH_OUT
    x0, x1, z0, z1 = -HB - po, HB + po, ZB - po, ZF + po
    ch = 0.02
    granite = (1, 1, 1, 1)
    plinth_shade = lambda p: 0.78 + 0.22 * max(0.0, min(1.0, (p[1] + 0.05) / 0.3))
    for (a, b, n) in (((x0, z1), (x1, z1), (0, 0, 1)), ((x1, z1), (x1, z0), (1, 0, 0)), ((x1, z0), (x0, z0), (0, 0, -1)),
                      ((x0, z0), (x0, z1), (-1, 0, 0))):
        nx, nz = n[0], n[2]
        # vertical face, then the chamfer, then the top ledge back to the wall
        face(sh, [(a[0], -0.05, a[1]), (b[0], -0.05, b[1]), (b[0], FL - ch, b[1]), (a[0], FL - ch, a[1])], "granite", granite, n,
             shade=plinth_shade, uax=norm((b[0] - a[0], 0, b[1] - a[1])))
        ia = (a[0] - nx * ch - (0 if nx else 0), a[1] - nz * ch)
        ib = (b[0] - nx * ch, b[1] - nz * ch)
        # the chamfer's ends are mitred at the corners: inset along the edge too
        ea = norm((b[0] - a[0], 0, b[1] - a[1]))
        ia = (ia[0] + ea[0] * ch, ia[1] + ea[2] * ch)
        ib = (ib[0] - ea[0] * ch, ib[1] - ea[2] * ch)
        face(sh, [(a[0], FL - ch, a[1]), (b[0], FL - ch, b[1]), (ib[0], FL, ib[1]), (ia[0], FL, ia[1])], "granite", granite,
             (nx, 1, nz), uax=ea)
        wa = (a[0] - nx * po + ea[0] * po, a[1] - nz * po + ea[2] * po)
        wb = (b[0] - nx * po - ea[0] * po, b[1] - nz * po - ea[2] * po)
        face(sh, [(ia[0], FL, ia[1]), (ib[0], FL, ib[1]), (wb[0], FL, wb[1]), (wa[0], FL, wa[1])], "granite", granite, UP, uax=ea)
    # plinth joints: slabs of ~0.9 m (dark 5 mm strips, 1 mm proud), detail
    for (a, b, n) in (((x0, z1), (x1, z1), (0, 0, 1)), ((x1, z1), (x1, z0), (1, 0, 0)), ((x1, z0), (x0, z0), (0, 0, -1)),
                      ((x0, z0), (x0, z1), (-1, 0, 0))):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        m = max(2, int(round(L / 0.9)))
        e = ((b[0] - a[0]) / L, (b[1] - a[1]) / L)
        for k in range(1, m):
            s = L * k / m
            px, pz = a[0] + e[0] * s + n[0] * 0.001, a[1] + e[1] * s + n[2] * 0.001
            jw = 0.0025
            face(de, [(px - e[0] * jw, -0.02, pz - e[1] * jw), (px + e[0] * jw, -0.02, pz + e[1] * jw),
                      (px + e[0] * jw, FL - ch, pz + e[1] * jw), (px - e[0] * jw, FL - ch, pz - e[1] * jw)], "granite",
                 mul(granite, 0.35), n, uax=UP)

    # ---- the openings of the window table
    by_wall = {k: [] for k in walls}
    for o in H.windows:
        by_wall[o["wall"]].append(o)
    lit_keys = lit_keys or set()
    for wname, W in walls.items():
        ops = []
        for i, o in enumerate(sorted(by_wall[wname], key=lambda q: (q["floor"], q["at"]))):
            r = opening_rect(o)
            key = (wname, o["floor"], round(o["at"], 2))
            if o["kind"] == "door":
                door(H, W, r)
            elif o["kind"] == "patio":
                window(H, W, wname, r, "patio", key in lit_keys, curtains=wname != "back", lite=False,
                       sashes=3 if r[1] - r[0] > 2.4 else 2, transom=0.0)
                if spec.get("juliet") and wname == "front":
                    juliet(H, W, r)
            else:
                window(H, W, wname, r, "window", key in lit_keys, curtains=True, lite=wname != "front")
            ops.append(r)
            H.cut[-1] = (wname, r, o)
        ybreaks = [FL, 1.25, FL + STOREY, WT]
        uax = None
        sset, tint, scale = "render", H.wall, 1.0
        siding = spec.get("siding")
        if wname in ("left", "right"):
            spans = gable_ext
            ybreaks.append(Y_RIDGE_U)
            # the attic window in the gable (not the interior's: a small lined niche behind it)
            ar = (-0.49, 0.49, WT + 0.45, WT + 1.5)
            window(H, W, wname, ar, "attic", False, curtains=True, lite=True, sashes=1, transom=0.0)
            H.cut.pop()
            nu, ny0, ny1, nd = 0.62, ar[2] - 0.15, ar[3] + 0.12, T_WALL + 0.9
            room = lin(spec["room"])
            W.quad(sh, [(-nu, ny0, nd), (nu, ny0, nd), (nu, ny1, nd), (-nu, ny1, nd)], "render", room, (0, 0, -1), scale=0.5)
            W.quad(sh, [(-nu, ny0, T_WALL), (nu, ny0, T_WALL), (nu, ny0, nd), (-nu, ny0, nd)], "render", room, (0, 1, 0), scale=0.5)
            W.quad(sh, [(-nu, ny1, T_WALL), (nu, ny1, T_WALL), (nu, ny1, nd), (-nu, ny1, nd)], "render", room, (0, -1, 0), scale=0.5)
            for su in (-1, 1):
                W.quad(sh, [(su * nu, ny0, T_WALL), (su * nu, ny0, nd), (su * nu, ny1, nd), (su * nu, ny1, T_WALL)], "render",
                       room, (-su, 0, 0), scale=0.5)
            ops.append(ar)
        else:
            spans = (-HB, HB)
        uo = H.rng.random()
        if siding:
            # houses 8 and 10: the ground floor in wood-grain ceramic siding (timber_cladding set, boards along the wall),
            # the upper floor stucco; the siding runs up to the belt course
            lower = [o for o in ops if o[2] < FL + STOREY]
            upper = [o for o in ops if o[2] >= FL + STOREY]
            span_lo = spans if not callable(spans) else (-HD, HD)
            wall_pieces(sh, W, span_lo, FL, lower + [(span_lo[0] - 1, span_lo[1] + 1, FL + STOREY, 99)], "timber_cladding",
                        lin(siding), ybreaks=[1.25], uoff=uo, shade=H.wall_shade)
            wall_pieces(sh, W, spans, FL + STOREY, upper, "render", H.wall, ybreaks=[WT] + ([Y_RIDGE_U] if callable(spans) else []),
                        uoff=uo, shade=H.wall_shade)
        elif spec.get("gable_cladding") and wname in ("left", "right"):
            wall_pieces(sh, W, (-HD, HD), FL, [o for o in ops if o[3] <= WT + 1e-6], "render", H.wall, ybreaks=[1.25, FL + STOREY],
                        uoff=uo, shade=H.wall_shade)
            # house 4: the gable triangle in vertical cedar boards (timber_cladding set turned upright), 2 cm proud, on a
            # flashing over the wall top
            gops = [o for o in ops if o[2] > WT - 1e-6]
            brk = [Y_RIDGE_U]
            Wc = Wall(W.n, (W.o[0] + W.n[0] * 0.02, W.o[1] + W.n[1] * 0.02))
            wall_pieces(sh, Wc, gable_ext, WT, gops, "timber_cladding", lin("#E6D2B8"), ybreaks=brk, uoff=uo, uax=UP)
            Wc.box(sh, -HD - 0.02, HD + 0.02, WT - 0.06, WT, -0.03, 0.02, "metal_painted", H.fascia, faces="ftu", along="u")
        else:
            wall_pieces(sh, W, spans, FL, ops, sset, tint, ybreaks=ybreaks, uoff=uo, shade=H.wall_shade, scale=scale, uax=uax)
    # ---- belt course between the floors (a stucco moulding band all round), shell
    by = FL + STOREY
    box(sh, -HB - 0.05, HB + 0.05, by - 0.09, by + 0.08, ZB - 0.05, ZF + 0.05, "render", H.trim, skip=("bot", "top"))
    for (bx0, bx1, bz0, bz1, side) in ((-HB - 0.05, HB + 0.05, ZF, ZF + 0.05, "front"), (-HB - 0.05, HB + 0.05, ZB - 0.05, ZB, "back"),
                                       (-HB - 0.05, -HB, ZB, ZF, "left"), (HB, HB + 0.05, ZB, ZF, "right")):
        face(sh, [(bx0, by + 0.08, bz0), (bx1, by + 0.08, bz0), (bx1, by + 0.08, bz1), (bx0, by + 0.08, bz1)], "render", H.trim, UP)
        face(sh, [(bx0, by - 0.09, bz0), (bx1, by - 0.09, bz0), (bx1, by - 0.09, bz1), (bx0, by - 0.09, bz1)], "render",
             mul(H.trim, 0.8), (0, -1, 0))
    # ---- rooms seen through the glass: one closed shell per floor (inward faces), the interior's ceiling heights
    room = mul(lin(spec["room"]), 0.55)          # rooms read darker than the sunlit outside by day
    xa, xb, za, zb = -HB + T_WALL, HB - T_WALL, ZB + T_WALL, ZF - T_WALL
    for (ya, yb, k) in ((FL + 0.005, FL + 3.7, 1.0), (FL + STOREY + 0.005, FL + STOREY + 3.7, 1.0)):
        face(sh, [(xa, ya, za), (xb, ya, za), (xb, ya, zb), (xa, ya, zb)], "oak", mul(lin("#C8A27C"), 0.9), UP)
        face(sh, [(xa, yb, za), (xb, yb, za), (xb, yb, zb), (xa, yb, zb)], "render", mul(room, 1.05), (0, -1, 0), scale=0.5)
        face(sh, [(xa, ya, za), (xb, ya, za), (xb, yb, za), (xa, yb, za)], "render", room, (0, 0, 1), scale=0.5)
        face(sh, [(xa, ya, zb), (xb, ya, zb), (xb, yb, zb), (xa, yb, zb)], "render", room, (0, 0, -1), scale=0.5)
        face(sh, [(xa, ya, za), (xa, ya, zb), (xa, yb, zb), (xa, yb, za)], "render", mul(room, 0.92), (1, 0, 0), scale=0.5)
        face(sh, [(xb, ya, za), (xb, ya, zb), (xb, yb, zb), (xb, yb, za)], "render", mul(room, 0.92), (-1, 0, 0), scale=0.5)


def juliet(H, W, r):
    """House 3: a Juliet rail across the upper patio door (dark steel, flat bars), detail."""
    de = H.detail
    u0, u1, v0, v1 = r
    st = lin("#2E3135")
    W.box(de, u0 - 0.05, u1 + 0.05, v0 + 0.95, v0 + 1.0, -0.13, -0.07, "metal_painted", st, faces="frltu", along="u")
    W.box(de, u0 - 0.05, u1 + 0.05, v0 + 0.06, v0 + 0.10, -0.13, -0.07, "metal_painted", st, faces="frltu", along="u")
    n = 9
    for k in range(n):
        uu = u0 + 0.02 + k * (u1 - u0 - 0.04) / (n - 1)
        W.box(de, uu - 0.01, uu + 0.01, v0 + 0.10, v0 + 0.95, -0.115, -0.085, "metal_painted", st, faces="flr", along="y")
    for uu in (u0 - 0.03, u1 + 0.03):
        W.box(de, uu - 0.015, uu + 0.015, v0 + 0.06, v0 + 1.0, -0.07, 0.0, "metal_painted", st, faces="flr", along="y")


# ------------------------------------------------------------------------------------------------- roof --

def roof(H):
    """The main gable roof: the slab's courses (stepped asphalt shingles, 2.8 cm lip per course, one texture row per
    course with its own offset) or a zinc standing-seam roof; the ridge cap; cedar soffits under the eaves and rakes; metal
    fascias and verge boards (shell). Drip edges, K-style gutters with hangers and end caps, four down pipes with clamps,
    shoes and granite splash blocks (detail)."""
    sh, de = H.shell, H.detail
    spec = H.spec
    xe = HB + RAKE
    ze_off = HD + EAVE
    L = ze_off / COS_P                                   # along the slope, ridge to eave edge
    roof_t = lin(spec["roof_tint"])
    for s in (-1, 1):
        ze = ZC + s * ze_off

        def P(t, x, lift=0.0):
            """A point on the slab's top at slope distance t from the eave edge (0) toward the ridge (L), x across."""
            z = ze - s * (t * COS_P)
            y = Y_EAVE_T + t * math.sin(PITCH)
            # lift along the roof's normal
            nz, ny = s * math.sin(PITCH), COS_P
            return (x, y + ny * lift, z + nz * lift)

        nrm = (0.0, COS_P, s * math.sin(PITCH))
        if spec["roof"] == "shingle":
            info = TEX["LM_roof"]
            e = info["exposure_m"]
            rows = info["rows"]
            um = info["u_m"]
            n = int(math.ceil((L - 0.05) / e))
            for k in range(n):
                t0, t1 = k * e, min(L, (k + 1) * e)
                r = H.rng.randrange(rows)
                vb, vt = 1 - (r + 1) / rows, 1 - r / rows
                vt = vb + (vt - vb) * (t1 - t0) / e
                uo = H.rng.random()
                lip = SHINGLE_LIP if k > 0 else SHINGLE_LIP * 1.6          # the starter course doubles at the eave
                a0, a1 = P(t0, -xe, lip), P(t0, xe, lip)
                b0, b1 = P(t1, -xe, 0.0), P(t1, xe, 0.0)
                uv = [(-xe / um + uo, vb), (xe / um + uo, vb), (xe / um + uo, vt), (-xe / um + uo, vt)]
                face(sh, [a0, a1, b1, b0], "shingle", roof_t, nrm, uvs=uv)
                # the butt edge (riser), the granules' edge: the row's bottom 3 px
                c0, c1 = P(t0, -xe, 0.0 if k > 0 else -VT), P(t0, xe, 0.0 if k > 0 else -VT)
                rv = vb + 3.0 / 1024
                down = (0.0, -math.sin(PITCH), s * COS_P)          # down the slope: the riser faces the eave
                face(sh, [c0, c1, a1, a0], "shingle", mul(roof_t, 0.75), down,
                     uvs=[(-xe / um + uo, vb), (xe / um + uo, vb), (xe / um + uo, rv), (-xe / um + uo, rv)])
        else:
            # zinc standing seam: pans 0.43 m wide from the eave to the ridge, seams 3 cm high x 1.2 cm, folded over the eave
            pan = 0.43
            m = int(math.ceil(2 * xe / pan))
            pw = 2 * xe / m
            for k in range(m):
                xa, xb = -xe + k * pw, -xe + (k + 1) * pw
                face(sh, [P(0, xa), P(0, xb), P(L, xb), P(L, xa)], "metal_painted", roof_t, nrm, uax=norm(sub(P(L, 0), P(0, 0))),
                     scale=2.0, shade=lambda p, k=k: 0.96 + 0.08 * ((k * 7) % 5) / 4)
            for k in range(m + 1):
                x = -xe + k * pw
                hs, hw = 0.03, 0.006
                ends = (0.0, L)
                q = lambda t, dx, lift: P(t, x + dx, lift)
                face(sh, [q(0, -hw, 0), q(L, -hw, 0), q(L, -hw, hs), q(0, -hw, hs)], "metal_painted", mul(roof_t, 0.95), (-1, 0, 0),
                     uax=norm(sub(P(L, 0), P(0, 0))), scale=2.0)
                face(sh, [q(0, hw, 0), q(L, hw, 0), q(L, hw, hs), q(0, hw, hs)], "metal_painted", mul(roof_t, 1.02), (1, 0, 0),
                     uax=norm(sub(P(L, 0), P(0, 0))), scale=2.0)
                face(sh, [q(0, -hw, hs), q(0, hw, hs), q(L, hw, hs), q(L, -hw, hs)], "metal_painted", mul(roof_t, 1.08), nrm,
                     uax=norm(sub(P(L, 0), P(0, 0))), scale=2.0)
            # the pans' folded edge over the eave (a 4 cm drip lip)
            face(sh, [P(0, -xe, 0.0), P(0, xe, 0.0), (xe, Y_EAVE_T - 0.04, ze + s * 0.012), (-xe, Y_EAVE_T - 0.04, ze + s * 0.012)],
                 "metal_painted", mul(roof_t, 0.9), (0, 0, s), uax=(1, 0, 0), scale=2.0)
        # soffit (cedar boards along the eave, two strips) from the wall plane to the fascia
        zw = ZC + s * HD
        y_s = Y_EAVE_T - FASCIA_H
        zm = (zw + ze) / 2
        for (za_, zb_) in ((zw, zm), (zm, ze)):
            face(sh, [(-xe, y_s, za_), (xe, y_s, za_), (xe, y_s, zb_), (-xe, y_s, zb_)], "timber_cladding", lin("#E8DCCB"), (0, -1, 0),
                 uax=(1, 0, 0))
        # a vent strip in the soffit near the fascia (dark perforated band), detail
        face(de, [(-xe + 0.3, y_s - 0.003, ze - s * 0.12), (xe - 0.3, y_s - 0.003, ze - s * 0.12),
                  (xe - 0.3, y_s - 0.003, ze - s * 0.20), (-xe + 0.3, y_s - 0.003, ze - s * 0.20)], "metal_painted", lin("#5A5E63"),
             (0, -1, 0), uax=(1, 0, 0))
        # fascia: the outer face, its bottom return
        face(sh, [(-xe, y_s, ze), (xe, y_s, ze), (xe, Y_EAVE_T, ze), (-xe, Y_EAVE_T, ze)], "metal_painted", H.fascia, (0, 0, s),
             uax=(1, 0, 0))
        # drip edge (L flashing 3 x 6 cm) over the fascia top, detail
        box(de, -xe - 0.02, xe + 0.02, Y_EAVE_T - 0.06, Y_EAVE_T + 0.004, min(ze, ze + s * 0.022), max(ze, ze + s * 0.022),
            "metal_painted", mul(H.fascia, 0.92), skip=("bot",), along="x")
        gutter(H, s, ze, xe)
    # rakes: verge boards (the slab's side faces), the sloped cedar soffit under the rake, both sides
    for sx in (-1, 1):
        xr = sx * xe
        for s in (-1, 1):
            ze = ZC + s * ze_off
            face(sh, [(xr, Y_RIDGE_U - 0.05, ZC), (xr, Y_RIDGE_T + 0.03, ZC), (xr, Y_EAVE_T + 0.03, ze), (xr, Y_EAVE_T - FASCIA_H, ze)],
                 "metal_painted", H.fascia, (sx, 0, 0), uax=norm((0, -math.sin(PITCH), s * COS_P)))
            xw = sx * HB
            face(sh, [(xw, Y_RIDGE_U - 0.05, ZC), (xr, Y_RIDGE_U - 0.05, ZC), (xr, Y_EAVE_T - FASCIA_H, ze),
                      (xw, Y_EAVE_T - FASCIA_H, ze)], "timber_cladding", lin("#E8DCCB"), (0, -1, 0),
                 uax=norm((0, -math.sin(PITCH), s * COS_P)))
            # the rake's drip edge (detail)
            a = (xr + sx * 0.022, Y_RIDGE_T + 0.035, ZC)
            b = (xr + sx * 0.022, Y_EAVE_T + 0.035, ze)
            face(de, [(xr, a[1], a[2]), (xr, b[1], b[2]), b, a], "metal_painted", mul(H.fascia, 0.92), (0, 1, 0),
                 uax=norm(sub(b, a)))
            face(de, [a, b, (b[0], b[1] - 0.07, b[2]), (a[0], a[1] - 0.07, a[2])], "metal_painted", mul(H.fascia, 0.92),
                 (sx, 0, 0), uax=norm(sub(b, a)))
    # ridge cap
    yc = Y_RIDGE_T + (SHINGLE_LIP if spec["roof"] == "shingle" else 0.03)
    cap_t = mul(roof_t, 0.85)
    sset = "shingle" if spec["roof"] == "shingle" else "metal_painted"
    for s in (-1, 1):
        face(sh, [(-xe - 0.04, yc + 0.09, ZC), (xe + 0.04, yc + 0.09, ZC), (xe + 0.04, yc - 0.02, ZC + s * 0.20),
                  (-xe - 0.04, yc - 0.02, ZC + s * 0.20)], sset, cap_t, (0, 1, s), uax=(1, 0, 0),
             scale=1.0 if sset == "shingle" else 2.0)
        face(sh, [(-xe - 0.04, yc - 0.02, ZC + s * 0.20), (xe + 0.04, yc - 0.02, ZC + s * 0.20),
                  (xe + 0.04, yc - 0.05, ZC + s * 0.205), (-xe - 0.04, yc - 0.05, ZC + s * 0.205)], sset, mul(cap_t, 0.8), (0, 0, s),
             uax=(1, 0, 0), scale=1.0 if sset == "shingle" else 2.0)
    for sx in (-1, 1):
        face(sh, [(sx * (xe + 0.04), yc - 0.05, ZC - 0.205), (sx * (xe + 0.04), yc - 0.05, ZC + 0.205), (sx * (xe + 0.04), yc + 0.09, ZC)],
             sset, mul(cap_t, 0.8), (sx, 0, 0), uax=(0, 0, 1))
    if spec["roof"] == "shingle":
        # cap shingles: a lap line every 0.25 m along the ridge (1.2 cm risers; shell, so the roof keeps one material)
        n = int(2 * (xe + 0.04) / 0.25)
        for k in range(1, n):
            x = -xe - 0.04 + k * 0.25
            for s in (-1, 1):
                face(sh, [(x, yc + 0.09, ZC), (x, yc - 0.02, ZC + s * 0.2), (x, yc - 0.02 + 0.012, ZC + s * 0.2),
                          (x, yc + 0.09 + 0.012, ZC)], "shingle", mul(cap_t, 0.7), (-1, 0, 0), uax=(0, 0, 1))


def gutter(H, s, ze, xe):
    """A K-style box gutter (0.13 x 0.12) on the fascia with hangers every 0.6 m and end caps, and two down pipes on this
    eave (each end): outlet, a swan-neck offset back to the wall under the soffit, the pipe down the wall clear of the
    plinth, five clamps, a shoe and a granite splash block on the lawn (detail)."""
    de = H.detail
    g = lin(METAL_DARK if H.spec["fascia"] == "dark" else "#8E949B")
    gy1 = Y_EAVE_T - 0.035
    gy0 = gy1 - 0.12
    z0, z1 = ze, ze + s * 0.13
    xa, xb = -xe - 0.03, xe + 0.03
    # front face with a bead lip, the bottom, the back face shows only above the fascia (skip), the inside
    za, zb = min(z0, z1), max(z0, z1)
    face(de, [(xa, gy0 + 0.02, z1), (xb, gy0 + 0.02, z1), (xb, gy1, z1), (xa, gy1, z1)], "metal_painted", g, (0, 0, s), uax=(1, 0, 0))
    face(de, [(xa, gy0, z1 - s * 0.02), (xb, gy0, z1 - s * 0.02), (xb, gy0 + 0.02, z1), (xa, gy0 + 0.02, z1)], "metal_painted",
         mul(g, 0.9), (0, -0.7, s * 0.7), uax=(1, 0, 0))
    face(de, [(xa, gy0, z0), (xb, gy0, z0), (xb, gy0, z1 - s * 0.02), (xa, gy0, z1 - s * 0.02)], "metal_painted", mul(g, 0.85),
         (0, -1, 0), uax=(1, 0, 0))
    face(de, [(xa, gy1, z1), (xb, gy1, z1), (xb, gy1, z1 - s * 0.015), (xa, gy1, z1 - s * 0.015)], "metal_painted", mul(g, 1.1),
         (0, 1, 0), uax=(1, 0, 0))
    face(de, [(xa, gy0 + 0.005, z1 - s * 0.012), (xb, gy0 + 0.005, z1 - s * 0.012), (xb, gy1, z1 - s * 0.012),
              (xa, gy1, z1 - s * 0.012)], "metal_painted", mul(g, 0.55), (0, 0, -s), uax=(1, 0, 0))
    face(de, [(xa, gy0 + 0.004, z0 + s * 0.001), (xb, gy0 + 0.004, z0 + s * 0.001), (xb, gy0 + 0.004, z1 - s * 0.013),
              (xa, gy0 + 0.004, z1 - s * 0.013)], "metal_painted", mul(g, 0.4), UP, uax=(1, 0, 0))
    for x in (xa, xb):
        face(de, [(x, gy0, z0), (x, gy0, z1 - s * 0.02), (x, gy0 + 0.02, z1), (x, gy1, z1), (x, gy1, z0)], "metal_painted",
             mul(g, 0.95), (1 if x > 0 else -1, 0, 0), uax=(0, 0, 1))
    x = xa + 0.25
    while x < xb - 0.1:
        box(de, x - 0.012, x + 0.012, gy1 - 0.004, gy1 + 0.008, za, zb, "metal_painted", mul(g, 1.15), skip=("bot",), along="z")
        x += 0.6
    # down pipes: square 75 mm, both ends of this eave
    zw = ZC + s * HD                                     # the wall plane
    off = 0.13                                           # the pipe's centre from the wall (clear of the 0.08 plinth)
    zp = zw + s * off
    zo = (z0 + z1) / 2
    hp = 0.0375
    yo = gy0
    y_kick = yo - 0.22
    y_wall = y_kick - abs(zo - zp) * 1.0                 # 45 degree swan neck
    # X2: the front pipes stand in the porch's raised flower beds (porch_kit.beds, soil at 0.29) and run straight into a
    # drain collar there (no shoe, no splash block buried in the bed); the back pipes keep their shoe and splash block.
    into_bed = s > 0 and FRONT_PIPES_INTO_BEDS
    for px in (-(HB - 0.32), HB - 0.32):
        if into_bed:
            pts = [(px, yo + 0.01, zo), (px, y_kick, zo), (px, y_wall, zp), (px, 0.27, zp)]
        else:
            pts = [(px, yo + 0.01, zo), (px, y_kick, zo), (px, y_wall, zp), (px, 0.24, zp), (px, 0.09, zp + s * 0.12)]
        square_tube(de, pts, hp, g)
        # clamps: a band round the pipe and a standoff to the wall
        for yy in (1.0, 2.6, 4.2, 5.8, max(y_wall - 0.4, 6.4)):
            box(de, px - hp - 0.006, px + hp + 0.006, yy, yy + 0.03, min(zp - s * (hp + 0.006), zp + s * (hp + 0.006)),
                max(zp - s * (hp + 0.006), zp + s * (hp + 0.006)), "metal_painted", mul(g, 1.1), skip=(), along="x")
            box(de, px - 0.01, px + 0.01, yy + 0.005, yy + 0.025, min(zw, zp - s * hp), max(zw, zp - s * hp), "metal_painted",
                mul(g, 0.9), skip=("bot",), along="z")
        if into_bed:
            continue
        # granite splash block on the lawn under the shoe
        sz0, sz1 = zp + s * 0.0, zp + s * 0.6
        box(de, px - 0.25, px + 0.25, -0.02, 0.05, min(sz0, sz1), max(sz0, sz1), "granite", (1, 1, 1, 1), skip=("bot",), along="z")
        # its drainage channel (a shallow dark groove)
        face(de, [(px - 0.07, 0.0505, min(sz0, sz1) + 0.05), (px + 0.07, 0.0505, min(sz0, sz1) + 0.05),
                  (px + 0.07, 0.0505, max(sz0, sz1) - 0.05), (px - 0.07, 0.0505, max(sz0, sz1) - 0.05)], "granite",
             mul((1, 1, 1, 1), 0.55), UP, uax=(0, 0, 1))


def square_tube(part, pts, h, tint):
    """A square pipe (half width h) along a polyline; mitred joints; open ends capped at the start (the outlet)."""
    n = len(pts)
    rings = []
    for i, p in enumerate(pts):
        a = pts[max(i - 1, 0)]
        b = pts[min(i + 1, n - 1)]
        t = norm(sub(b, a))
        side = (1.0, 0.0, 0.0)                     # every run of these pipes lies in a plane x = const
        up = norm(cross(t, side))
        # mitre: scale the cross-section in the plane of the bend
        if 0 < i < n - 1:
            t0 = norm(sub(p, pts[i - 1]))
            t1 = norm(sub(pts[i + 1], p))
            c = max(0.3, math.sqrt(max(0.0, (1 + dot(t0, t1)) / 2)))
            upk = h / c
        else:
            upk = h
        rings.append([add(add(p, sc(side, sx * h)), sc(up, sy * upk)) for (sx, sy) in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
    for i in range(n - 1):
        L = math.sqrt(dot(sub(pts[i + 1], pts[i]), sub(pts[i + 1], pts[i])))
        for k in range(4):
            k2 = (k + 1) % 4
            q = [rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]]
            c = sc(add(add(q[0], q[1]), add(q[2], q[3])), 0.25)
            mid = sc(add(pts[i], pts[i + 1]), 0.5)
            face(part, q, "metal_painted", tint if k % 2 else mul(tint, 0.92), sub(c, mid), uax=norm(sub(pts[i + 1], pts[i])))


# ---------------------------------------------------------------------------------------------- chimney --

def chimney(H):
    """A stucco chimney with a granite cap and a steel flue pot, or (modern houses) a twin stainless flue with rain caps
    (shell), through the back slope near the ridge."""
    sh = H.shell
    cx = HB * 0.55
    cz = ZC - 0.75
    if H.spec["chimney"] == "stucco":
        s = 0.42
        y0 = Y_RIDGE_U - 1.2
        y1 = Y_RIDGE_T + 1.3
        box(sh, cx - s, cx + s, y0, y1, cz - s, cz + s, "render", H.wall, skip=("bot", "top"), along="y",
            shade=lambda p: 0.9 if p[1] < Y_RIDGE_T else 1.0)
        box(sh, cx - s - 0.07, cx + s + 0.07, y1, y1 + 0.10, cz - s - 0.07, cz + s + 0.07, "granite", (1, 1, 1, 1), skip=("bot",))
        box(sh, cx - 0.11, cx + 0.11, y1 + 0.10, y1 + 0.42, cz - 0.11, cz + 0.11, "metal_painted", lin("#5C6066"), skip=("bot",),
            along="y")
        box(sh, cx - 0.16, cx + 0.16, y1 + 0.42, y1 + 0.45, cz - 0.16, cz + 0.16, "metal_painted", lin("#5C6066"), along="x")
    else:
        for dx in (-0.3, 0.3):
            x = cx + dx
            r = 0.11
            y0 = Y_RIDGE_U - 1.0
            y1 = Y_RIDGE_T + 1.1
            pts = [(x + r * math.cos(2 * math.pi * k / 8), z) for k in range(8) for z in [0]]
            steel = lin("#C9CCCF")
            for k in range(8):
                a0 = 2 * math.pi * k / 8
                a1 = 2 * math.pi * (k + 1) / 8
                p0 = (x + r * math.cos(a0), cz + r * math.sin(a0))
                p1 = (x + r * math.cos(a1), cz + r * math.sin(a1))
                nrm = (math.cos((a0 + a1) / 2), 0, math.sin((a0 + a1) / 2))
                face(sh, [(p0[0], y0, p0[1]), (p1[0], y0, p1[1]), (p1[0], y1, p1[1]), (p0[0], y1, p0[1])], "metal_painted", steel, nrm,
                     uax=UP, scale=2.0)
                # the conical rain cap
                q0 = (x + r * 1.8 * math.cos(a0), cz + r * 1.8 * math.sin(a0))
                q1 = (x + r * 1.8 * math.cos(a1), cz + r * 1.8 * math.sin(a1))
                face(sh, [(q0[0], y1 + 0.12, q0[1]), (q1[0], y1 + 0.12, q1[1]), (x, y1 + 0.30, cz)], "metal_painted", mul(steel, 0.9),
                     (nrm[0], 1.0, nrm[2]), uax=(1, 0, 0))
                face(sh, [(q0[0], y1 + 0.12, q0[1]), (q1[0], y1 + 0.12, q1[1]), (x, y1 + 0.06, cz)], "metal_painted", mul(steel, 0.6),
                     (0, -1, 0), uax=(1, 0, 0))
            box(sh, x - 0.2, x + 0.2, Y_RIDGE_T - 0.35, Y_RIDGE_T - 0.2, cz - 0.2, cz + 0.2, "metal_painted", lin("#5C6066"),
                skip=("bot",))


# ------------------------------------------------------------------------------------------------- build --

def lit_choice(H):
    """Which windows glow at night (a warm M_window card behind them): about 45 %, the ground floor's front ones less
    often (the porch lamps light those), always one upstairs front window."""
    keys = []
    for o in H.windows:
        if o["kind"] == "door":
            continue
        k = (o["wall"], o["floor"], round(o["at"], 2))
        keys.append(k)
    lit = {k for k in keys if H.rng.random() < (0.3 if (k[0] == "front" and k[1] == 1) else 0.45)}
    fr2 = [k for k in keys if k[0] == "front" and k[1] == 2]
    if fr2 and not any(k in lit for k in fr2):
        lit.add(H.rng.choice(fr2))
    return lit


def vent(H, W, u, y):
    """A stainless exhaust vent hood (kitchen / bathroom fan), common on Korean houses: a square flange plate, a round
    duct 0.1 m out and a downward-facing hood (detail)."""
    de = H.detail
    st = lin("#C2C5C8")
    W.box(de, u - 0.11, u + 0.11, y - 0.11, y + 0.11, -0.012, 0.0, "metal_painted", st, faces="fltru", along="u")
    r, n = 0.065, 8
    for k in range(n):
        a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
        p0 = (u + r * math.cos(a0), y + r * math.sin(a0))
        p1 = (u + r * math.cos(a1), y + r * math.sin(a1))
        W.quad(de, [(p0[0], p0[1], -0.012), (p1[0], p1[1], -0.012), (p1[0], p1[1], -0.10), (p0[0], p0[1], -0.10)], "metal_painted",
               mul(st, 0.85 + 0.15 * math.sin(a0)), ((math.cos(a0) + math.cos(a1)) / 2, (math.sin(a0) + math.sin(a1)) / 2, 0),
               uax=W.dirv(nd=-1))
    # the hood: a quarter-round cowl over the duct's mouth, open downward
    hw, hy, hd = 0.095, 0.095, 0.17
    W.quad(de, [(u - hw, y + hy, -0.012), (u + hw, y + hy, -0.012), (u + hw, y + hy * 0.4, -hd), (u - hw, y + hy * 0.4, -hd)],
           "metal_painted", st, (0, 1, -0.6))
    W.quad(de, [(u - hw, y + hy * 0.4, -hd), (u + hw, y + hy * 0.4, -hd), (u + hw, y - hy, -hd - 0.01), (u - hw, y - hy, -hd - 0.01)],
           "metal_painted", mul(st, 0.95), (0, 0.2, -1))
    for sx in (-1, 1):
        W.quad(de, [(u + sx * hw, y + hy, -0.012), (u + sx * hw, y + hy * 0.4, -hd), (u + sx * hw, y - hy, -hd - 0.01),
                    (u + sx * hw, y - hy, -0.012)], "metal_painted", mul(st, 0.9), (sx, 0, 0))


# 2026-11-17 (owner, the Colmar Petite Venise photo): the houses are dressed as Alsatian half-timbered houses (colmar_kit.py);
# "modern" keeps the 2026-11-16 body (stucco, PVC, shingles) for the before / after renders
STYLE = "colmar"


def build_house(hid, colour, windows, seed):
    H = House(hid, colour, seed, windows)
    H.lit = lit_choice(H)
    if STYLE == "colmar":
        import colmar_kit
        C = colmar_kit.COLORS[hid]
        H.spec = dict(H.spec, roof_tint=colmar_kit.TILE[C["tile"]], fascia="dark", frame="white")
        H.fascia = lin(C["beam"])
        H.trim = lin(colmar_kit.STONE[C["stone"]])
        H.colmar = colmar_kit.build(H)
        return H
    body(H, H.lit)
    roof(H)
    chimney(H)
    walls = wall_frames()
    # exhaust vents: the kitchen's on one side wall, a bathroom's high on the back wall
    vent(H, walls["left" if H.rng.random() < 0.5 else "right"], -3.3, FL + 2.75)
    vent(H, walls["back"], -1.2 if H.rng.random() < 0.5 else 1.2, FL + STOREY + 2.6)
    return H


def local_to_world(centre, door_side, x, z):
    """houseExterior.ts houseLocalToWorld (game x, z), unrounded."""
    cx, cz = centre
    if door_side == "s":
        return cx + x, cz + z
    if door_side == "n":
        return cx - x, cz - z
    if door_side == "e":
        return cx + z, cz - x
    return cx - z, cz + x


DOOR_YAW = {"s": 0.0, "n": math.pi, "e": math.pi / 2, "w": -math.pi / 2}
