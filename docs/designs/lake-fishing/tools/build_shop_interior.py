"""The fishing shop's interior (관리소 겸 낚시 대여점) as its own model: client/public/models/lake/lake_shop_interior.glb.

  blender -b -P docs/designs/lake-fishing/tools/build_shop_interior.py -- [--glb client/public/models/lake/lake_shop_interior.glb]
          [--tex art/shop/tex] [--blend art/shop/shop_interior.blend] [--samples 256] [--preview art/shop/preview]

Before: render_shop_photo.py (the framed catch photo) and make_shop_interior_textures.py (surfaces + props atlas).

What it is (owner 2026-11-16: "낚시점 같지가 않아" -- real geometry, real textures, real detail): an inner shell that lines the
office of lake_structures.glb (built by parts_lake_structures.build_office, which keeps the outer walls, the window, the door
and the roof) and everything a small Korean pond-side tackle shop holds, matched to the reference photos (art/shop/refs):

  back wall    a floor-standing rod rack with 17 real rods (spinning rods: cork / EVA grips, reel seats with hoods, thread
               wraps, 5-7 guides on legs, three with reels; collapsed 민장대 with stepped sections, end caps, bands); a
               brown pegboard of hooks with hanging lure blister packs and soft-plastic bags; the whiteboard notice with the
               rental terms; a wall clock; two glass shelves of spinning reels; a white wire grid of float (찌) packs; a low
               cabinet with tackle boxes, line spools and bins of 떡밥 bags; a steel shelf of bait bags and corn cans; a
               glass-door bait fridge (cans, worm cups, its own light)
  west wall    landing nets hung by their hoops (cut-out mesh bags), the fish-measuring board, the framed catch photo;
               coolers (아이스박스) under the side window; folding chairs and closed parasols for rent in the corner
  east wall    a shelf of tackle boxes, coolers, a calendar, the no-smoking sign, the fire extinguisher by the door
  counter      the old desk's place behind the rental window (top at 1.42): worn hardwood, a glass-topped lure case on
               dark felt, a cash tray with coins, the open ledger and a pen, a jar of floats, a small desk fan, rental slips
  shell        white 300 mm floor tiles, honey-pine wainscot with a rail, cream plaster above, 텍스 ceiling tiles, four twin-
               tube fluorescent battens

Light: baked here with Cycles (fluorescent tubes 4000 K + the sky through the windows) into COLOR_0 (linear irradiance x 0.5);
the game draws the interior unlit (MeshBasicMaterial: map x COLOR_0 x 2, LakeShopInterior.tsx), the same light day and
night, as a lit shop is. Normals are not exported (unlit), positions are draco'd, textures go out as WebP.

Everything is in the game's world coordinates (glTF +Y up). The shopkeeper's spot (npc__lake_shopkeeper, x 102, z -20.9) and
the rental window are kept clear. No brands or logos anywhere."""
import json
import math
import os
import random
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    return ARGV[ARGV.index(name) + 1] if name in ARGV else default


TEX = os.path.abspath(arg("--tex", os.path.join(REPO, "art", "shop", "tex")))
GLB = os.path.abspath(arg("--glb", os.path.join(REPO, "client", "public", "models", "lake", "lake_shop_interior.glb")))
BLEND = arg("--blend", os.path.join(REPO, "art", "shop", "shop_interior.blend"))
PREVIEW = arg("--preview")
SAMPLES = int(arg("--samples", "256"))
ATL = json.load(open(os.path.join(TEX, "atlas.json"), encoding="utf-8"))
rng = random.Random(20261116)

# ------------------------------------------------------------------------------------------------ the room (game coords)
# The office of lake_structures.glb: footprint x 98..106, z -25..-19.5; plinth / floor top 0.4 (+ boards 0.432); walls 0.16
# thick to 3.6; the old fit-out (shelves to 0.45 off the back wall, the carp print, the desk) is inside these linings.
X0, X1 = 98.2, 105.8
ZB, ZF = -24.36, -19.70  # back lining (clear of the old shelves), front lining
FY, CY = 0.44, 3.40  # floor, ceiling
RAIL = 1.30  # wainscot top
WIN_S = (100.0, 104.0, 1.5, 2.7)  # south (rental) window x0 x1 y0 y1
DOOR_S = (104.6, 105.8, 0.4, 3.0)
WIN_W = (-23.15, -21.35, 1.7, 2.6)  # west window z0 z1 y0 y1
CTR = dict(x0=100.0, x1=104.0, z0=-20.55, z1=ZF, top=1.42)
TILE = dict(floor=2.4, wall=2.0, wainscot=1.0, ceiling=1.2, wood=1.0, peg=0.4)


def B(p):
    """game (x, y up, z south) -> Blender (x, -z, y)"""
    return Vector((p[0], -p[2], p[1]))


class Fr:
    """A local frame: origin + rotation (yaw about +y: 0 faces +z, pi/2 faces +x; then pitch about local x: + tips local +y
    toward local +z; then roll about local z)."""

    def __init__(self, x=0.0, y=0.0, z=0.0, yaw=0.0, pitch=0.0, roll=0.0, R=None):
        self.o = Vector((x, y, z))
        if R is None:
            R = Fr.rot(yaw, pitch, roll)
        self.R = R

    @staticmethod
    def rot(yaw, pitch, roll):
        cy, sy = math.cos(yaw), math.sin(yaw)
        cp, sp = math.cos(pitch), math.sin(pitch)
        cr, sr = math.cos(roll), math.sin(roll)
        Ry = Matrix(((cy, 0, sy), (0, 1, 0), (-sy, 0, cy)))
        Rx = Matrix(((1, 0, 0), (0, cp, -sp), (0, sp, cp)))
        Rz = Matrix(((cr, -sr, 0), (sr, cr, 0), (0, 0, 1)))
        return Ry @ Rx @ Rz

    def g(self, x, y, z):
        return self.o + self.R @ Vector((x, y, z))

    def d(self, x, y, z):
        return self.R @ Vector((x, y, z))

    def sub(self, x=0.0, y=0.0, z=0.0, yaw=0.0, pitch=0.0, roll=0.0):
        f = Fr(R=self.R @ Fr.rot(yaw, pitch, roll))
        f.o = self.g(x, y, z)
        return f


W0 = Fr()

# ------------------------------------------------------------------------------------------------ geometry store
MATS = ["floor", "wall", "wainscot", "ceiling", "wood", "peg", "atlas", "glass", "emit"]
GEO = {m: dict(v=[], f=[]) for m in MATS}


def rect(key):
    return ATL[key]


def auv(key, s, t):
    u0, v0, u1, v1 = rect(key)
    return (u0 + (u1 - u0) * s, v0 + (v1 - v0) * t)


def face(mat, pts, uvs, smooth=False):
    g = GEO[mat]
    i0 = len(g["v"])
    g["v"].extend(Vector(p) for p in pts)
    g["f"].append((list(range(i0, i0 + len(pts))), list(uvs), smooth))


def tile_uvs(mat, pts, uo=0.0, vo=0.0):
    """Planar metric UVs for a quad: u along p0->p1, v along p0->p3, in tiles of TILE[mat] metres."""
    s = TILE[mat]
    p0 = Vector(pts[0])
    eu = (Vector(pts[1]) - p0)
    ev = (Vector(pts[3]) - p0)
    lu, lv = eu.length, ev.length
    eu.normalize()
    ev.normalize()
    out = []
    for p in pts:
        q = Vector(p) - p0
        out.append(((q.dot(eu) + uo) / s, (q.dot(ev) + vo) / s))
    return out


def grid(mat, o, ua, va, cell=0.15, uvfn=None, key=None):
    """A subdivided quad o, o+ua, o+ua+va, o+va (front = ua x va): cells <= `cell` m (the baked light lives on vertices).
    UV: tiling (metric, from the world position projected on ua / va) or the atlas rect `key` stretched over it."""
    o, ua, va = Vector(o), Vector(ua), Vector(va)
    nu = max(1, int(math.ceil(ua.length / cell)))
    nv = max(1, int(math.ceil(va.length / cell)))
    g = GEO[mat]
    i0 = len(g["v"])
    eu, ev = ua.normalized(), va.normalized()
    for j in range(nv + 1):
        for i in range(nu + 1):
            g["v"].append(o + ua * (i / nu) + va * (j / nv))
    s = TILE.get(mat, 1.0)
    for j in range(nv):
        for i in range(nu):
            idx = [i0 + j * (nu + 1) + i, i0 + j * (nu + 1) + i + 1, i0 + (j + 1) * (nu + 1) + i + 1, i0 + (j + 1) * (nu + 1) + i]
            uvs = []
            for k in idx:
                p = g["v"][k]
                if key:
                    q = p - o
                    uvs.append(auv(key, q.dot(eu) / ua.length, q.dot(ev) / va.length))
                elif uvfn:
                    uvs.append(uvfn(p))
                else:
                    q = p - o
                    uvs.append((q.dot(eu) / s, q.dot(ev) / s))
            g["f"].append((idx, uvs, False))


def box(mat, fr, x0, x1, y0, y1, z0, z1, key=None, skip="", keys=None, cell=None):
    """A box in frame fr. key: the atlas rect for every face (mat 'atlas'), keys: per face {'F','B','L','R','U','D'};
    tiling materials get metric UVs. cell: subdivide the faces (light on vertices) for big boxes."""
    P = lambda x, y, z: fr.g(x, y, z)  # noqa: E731
    faces = {
        "F": (P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)),
        "B": (P(x1, y0, z0), P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0)),
        "L": (P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0)),
        "R": (P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1)),
        "U": (P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0)),
        "D": (P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)),
    }
    for k, q in faces.items():
        if k in skip:
            continue
        kk = (keys or {}).get(k, key)
        if cell:
            grid(mat, q[0], q[1] - q[0], q[3] - q[0], cell, key=kk if mat == "atlas" else None)
            continue
        if mat == "atlas":
            uvs = [auv(kk, 0, 0), auv(kk, 1, 0), auv(kk, 1, 1), auv(kk, 0, 1)]
        elif mat in TILE:
            uvs = tile_uvs(mat, q)
        else:
            uvs = [(0, 0), (1, 0), (1, 1), (0, 1)]
        face(mat, q, uvs)


def _perp(a):
    """A unit vector perpendicular to axis a, the one closest to +z (the window side) so a cylinder's u = 0.5 faces the viewer."""
    ref = Vector((0, 0, 1))
    if abs(a.dot(ref)) > 0.95:
        ref = Vector((1, 0, 0))
    p = ref - a * a.dot(ref)
    return p.normalized()


def cyl(mat, p0, p1, r0, r1=None, sides=8, key="pl_grey", caps=(True, True), smooth=True, capkey=None, ring_uv=None):
    """A (tapered) cylinder p0 -> p1 in world coords. u runs round it (u 0.5 toward +z), v along it."""
    r1 = r0 if r1 is None else r1
    p0, p1 = Vector(p0), Vector(p1)
    a = (p1 - p0).normalized()
    e1 = _perp(a)
    e2 = a.cross(e1)
    g = GEO[mat]
    i0 = len(g["v"])
    ring = []
    for k in range(sides + 1):
        th = (k / sides) * math.tau
        ring.append((math.cos(th - math.pi), math.sin(th - math.pi), k / sides))
    for (c, s, u) in ring:
        d = e1 * c + e2 * s
        g["v"].append(p0 + d * r0)
        g["v"].append(p1 + d * r1)
    for k in range(sides):
        a0, b0, a1, b1 = i0 + 2 * k, i0 + 2 * k + 1, i0 + 2 * k + 2, i0 + 2 * k + 3
        u0, u1 = ring[k][2], ring[k + 1][2]
        if mat == "atlas":
            uvs = [auv(key, u0, 0.02), auv(key, u1, 0.02), auv(key, u1, 0.98), auv(key, u0, 0.98)]
        else:
            uvs = [(u0, 0), (u1, 0), (u1, 1), (u0, 1)]
        g["f"].append(([a0, a1, b1, b0], uvs, smooth))
    ck = capkey or key
    for end, (pc, r, sgn) in enumerate(((p0, r0, -1), (p1, r1, 1))):
        if not caps[end] or r < 1e-5:
            continue
        pts, uvs = [], []
        for k in range(sides):
            th = (k / sides) * math.tau
            d = e1 * math.cos(th) + e2 * math.sin(th)
            pts.append(pc + d * r)
            uvs.append(auv(ck, 0.5 + 0.48 * math.cos(th), 0.5 + 0.48 * math.sin(th)) if mat == "atlas" else (0.5, 0.5))
        if sgn < 0:
            pts.reverse()
            uvs.reverse()
        face(mat, pts, uvs)


def cyl_f(mat, fr, a, b, r0, r1=None, **kw):
    cyl(mat, fr.g(*a), fr.g(*b), r0, r1, **kw)


def torus(mat, c, axis, R, r, key="chrome", seg=10, sides=4, arc=math.tau, start=0.0):
    c, axis = Vector(c), Vector(axis).normalized()
    e1 = _perp(axis)
    e2 = axis.cross(e1)
    g = GEO[mat]
    i0 = len(g["v"])
    n = seg + (0 if arc >= math.tau - 1e-6 else 1)
    for i in range(n):
        t = start + arc * i / seg
        cen = c + (e1 * math.cos(t) + e2 * math.sin(t)) * R
        rad = (e1 * math.cos(t) + e2 * math.sin(t))
        for j in range(sides):
            ph = j / sides * math.tau
            g["v"].append(cen + (rad * math.cos(ph) + axis * math.sin(ph)) * r)
    for i in range(seg):
        i1 = (i + 1) % n if arc >= math.tau - 1e-6 else i + 1
        for j in range(sides):
            j1 = (j + 1) % sides
            idx = [i0 + i * sides + j, i0 + i1 * sides + j, i0 + i1 * sides + j1, i0 + i * sides + j1]
            g["f"].append((idx, [auv(key, 0.5, 0.5)] * 4, True))


def poly_tube(mat, pts, r, key, sides=5):
    for a, b in zip(pts, pts[1:]):
        cyl(mat, a, b, r, r, sides, key, caps=(False, False))


def pillow(fr, w, h, th, key, back="pl_clear", nu=4, nv=5, bulge_back=0.35):
    """A filled bag: a bulged front printed with `key`, a gently bulged back, crimped (flat) top and bottom seals. Local:
    x -w/2..w/2, y 0..h, front toward +z."""
    g = GEO["atlas"]
    for side in (1, -1):
        i0 = len(g["v"])
        for j in range(nv + 1):
            for i in range(nu + 1):
                s, t = i / nu, j / nv
                bul = (math.sin(math.pi * s) ** 0.6) * (math.sin(math.pi * min(1, max(0, (t - 0.06) / 0.88))) ** 0.5)
                z = th * bul * (1 if side > 0 else -bulge_back)
                g["v"].append(fr.g((s - 0.5) * w, t * h, z))
        for j in range(nv):
            for i in range(nu):
                a = i0 + j * (nu + 1) + i
                idx = [a, a + 1, a + nu + 2, a + nu + 1]
                if side < 0:
                    idx = [a + 1, a, a + nu + 1, a + nu + 2]
                uvs = []
                for k in idx:
                    kk = k - i0
                    s, t = (kk % (nu + 1)) / nu, (kk // (nu + 1)) / nv
                    uvs.append(auv(key if side > 0 else back, s, t))
                g["f"].append((idx, uvs, True))


# ------------------------------------------------------------------------------------------------ the shell
def wall_rects(a0, a1, b0, b1, holes):
    """(a0..a1) x (b0..b1) minus holes, as rectangles (columns between hole edges)."""
    xs = sorted({a0, a1, *[h[0] for h in holes], *[h[1] for h in holes]})
    out = []
    for xa, xb in zip(xs, xs[1:]):
        if xb - xa < 1e-4 or xa < a0 - 1e-6 or xb > a1 + 1e-6:
            continue
        cuts = sorted((h[2], h[3]) for h in holes if h[0] <= xa + 1e-6 and h[1] >= xb - 1e-6)
        y = b0
        for (c0, c1) in cuts:
            if c0 > y:
                out.append((xa, xb, y, min(c0, b1)))
            y = max(y, c1)
        if y < b1:
            out.append((xa, xb, y, b1))
    return out


def wall(fr, a0, a1, holes):
    """A wall lining in frame fr (local +z into the room, local x along it, y up): wainscot to RAIL, plaster above, a rail
    and a skirting board; holes cut with aluminium reveals."""
    for (xa, xb, ya, yb) in wall_rects(a0, a1, FY, CY, holes):
        for (y0, y1, mat) in ((ya, min(yb, RAIL), "wainscot"), (max(ya, RAIL), yb, "wall")):
            if y1 - y0 < 1e-4:
                continue
            p0 = fr.g(xa, y0, 0)
            grid(mat, p0, fr.d(xb - xa, 0, 0), fr.d(0, y1 - y0, 0), 0.16, uvfn=lambda p, fr=fr, mat=mat: _wall_uv(fr, p, mat))
    # rail and skirting along the wall, broken at the holes
    for (xa, xb) in _intervals(a0, a1, [(h[0], h[1]) for h in holes if h[2] < RAIL + 0.03]):
        box("wood", fr, xa, xb, RAIL - 0.01, RAIL + 0.05, 0.0, 0.028)
        box("wood", fr, xa + 0.004, xb - 0.004, RAIL + 0.05, RAIL + 0.058, 0.0, 0.02)
    for (xa, xb) in _intervals(a0, a1, [(h[0], h[1]) for h in holes if h[2] < FY + 0.1]):
        box("atlas", fr, xa, xb, FY, FY + 0.09, 0.0, 0.016, key="wood_dark", skip="D")
    for (h0, h1, b0, b1) in holes:
        t = 0.045
        box("atlas", fr, h0 - t, h1 + t, b1, b1 + t, -0.06, 0.012, key="alu", skip="B")
        if b0 > FY + 0.05:
            box("atlas", fr, h0 - t, h1 + t, b0 - t, b0, -0.06, 0.03, key="alu", skip="B")  # the inner sill
        box("atlas", fr, h0 - t, h0, b0, b1, -0.06, 0.012, key="alu", skip="B")
        box("atlas", fr, h1, h1 + t, b0, b1, -0.06, 0.012, key="alu", skip="B")


def _wall_uv(fr, p, mat):
    q = fr.R.transposed() @ (Vector(p) - fr.o)
    s = TILE[mat]
    return (q.x / s, q.y / s)


def _intervals(a0, a1, cuts):
    out, x = [], a0
    for (c0, c1) in sorted(cuts):
        if c0 > x:
            out.append((x, min(c0, a1)))
        x = max(x, c1)
    if x < a1:
        out.append((x, a1))
    return out


def build_shell():
    grid("floor", (X0, FY, ZF), (X1 - X0, 0, 0), (0, 0, ZB - ZF), 0.15, uvfn=lambda p: (p.x / TILE["floor"], -p.z / TILE["floor"]))
    grid("ceiling", (X0, CY, ZB), (X1 - X0, 0, 0), (0, 0, ZF - ZB), 0.2, uvfn=lambda p: (p.x / TILE["ceiling"], p.z / TILE["ceiling"]))
    wall(Fr(X0, 0, ZB, 0.0), 0.0, X1 - X0, [])  # back, facing +z
    wall(Fr(X1, 0, ZF, math.pi), 0.0, X1 - X0, [(X1 - DOOR_S[1], X1 - DOOR_S[0], FY, DOOR_S[3]), (X1 - WIN_S[1], X1 - WIN_S[0], WIN_S[2], WIN_S[3])])  # front
    wall(Fr(X0, 0, ZF, math.pi / 2), 0.0, ZF - ZB, [(ZF - WIN_W[1], ZF - WIN_W[0], WIN_W[2], WIN_W[3])])  # west, facing +x
    wall(Fr(X1, 0, ZB, -math.pi / 2), 0.0, ZF - ZB, [])  # east, facing -x
    # ceiling cornice (a small painted coving)
    for fr, ln in ((Fr(X0, 0, ZB, 0.0), X1 - X0), (Fr(X1, 0, ZF, math.pi), X1 - X0), (Fr(X0, 0, ZF, math.pi / 2), ZF - ZB), (Fr(X1, 0, ZB, -math.pi / 2), ZF - ZB)):
        box("atlas", fr, 0, ln, CY - 0.06, CY, 0, 0.03, key="card_white", skip="UB")
    # the fluorescent battens: a white steel housing, two bare 26 mm tubes, end caps (4000 K), a cable
    for (cx, cz) in ((100.25, -21.35), (103.75, -21.35), (100.25, -23.25), (103.75, -23.25)):
        f = Fr(cx, CY, cz)
        box("atlas", f, -0.64, 0.64, -0.055, 0.0, -0.065, 0.065, key="pl_white", skip="U")
        box("atlas", f, -0.6, 0.6, -0.058, -0.055, -0.05, 0.05, key="steel", skip="U")
        for dz in (-0.03, 0.03):
            cyl("emit", f.g(-0.6, -0.075, dz), f.g(0.6, -0.075, dz), 0.013, sides=8, key="pl_white")
            for sx in (-1, 1):
                box("atlas", f, sx * 0.6 - 0.025, sx * 0.6 + 0.025, -0.095, -0.055, dz - 0.016, dz + 0.016, key="pl_white")
    cyl("atlas", (102.0, CY - 0.002, -22.3), (102.0, CY - 0.002, -21.35), 0.004, sides=4, key="pl_white", caps=(False, False))


# ------------------------------------------------------------------------------------------------ rods and reels
ROD_COLS = ["rod_black", "rod_navy", "rod_wine", "rod_green", "rod_grey", "rod_white", "rod_gold"]


def reel(fr, body="gunmetal", line="line_green", knob="pl_black", size=1.0):
    """A spinning reel, its foot at the origin, the body above (+y), the spool's axis along +z (toward the rod tip)."""
    s = size
    box("atlas", fr, -0.009 * s, 0.009 * s, 0.0, 0.005 * s, -0.036 * s, 0.036 * s, key="gunmetal")
    box("atlas", fr, -0.005 * s, 0.005 * s, 0.005 * s, 0.05 * s, -0.012 * s, 0.008 * s, key=body)
    yb = 0.078 * s
    cyl_f("atlas", fr, (-0.021 * s, yb, -0.012 * s), (0.021 * s, yb, -0.012 * s), 0.03 * s, sides=10, key=body)
    cyl_f("atlas", fr, (0, yb, 0.012 * s), (0, yb, 0.044 * s), 0.025 * s, 0.021 * s, sides=10, key=body)
    cyl_f("atlas", fr, (0, yb, 0.044 * s), (0, yb, 0.048 * s), 0.025 * s, sides=12, key="gunmetal")
    cyl_f("atlas", fr, (0, yb, 0.048 * s), (0, yb, 0.071 * s), 0.0195 * s, sides=12, key=line, capkey="gunmetal")
    cyl_f("atlas", fr, (0, yb, 0.071 * s), (0, yb, 0.075 * s), 0.023 * s, sides=12, key="chrome")
    cyl_f("atlas", fr, (0, yb, 0.075 * s), (0, yb, 0.081 * s), 0.011 * s, 0.009 * s, sides=8, key="chrome")
    # the bail: a wire half-hoop over the spool's front, from arm to arm
    pts = []
    for k in range(7):
        a = math.pi * k / 6
        pts.append(fr.g(math.cos(a) * 0.027 * s, yb + math.sin(a) * 0.027 * s - 0.004 * s, 0.07 * s))
    poly_tube("atlas", pts, 0.0014 * s, "chrome", 4)
    for sx in (-1, 1):
        cyl_f("atlas", fr, (sx * 0.024 * s, yb - 0.004 * s, 0.03 * s), (sx * 0.027 * s, yb - 0.004 * s, 0.07 * s), 0.003 * s, sides=4, key=body)
    # handle: shaft, arm, knob
    side = 1
    cyl_f("atlas", fr, (side * 0.021 * s, yb, -0.012 * s), (side * 0.04 * s, yb, -0.012 * s), 0.0035 * s, sides=6, key="gunmetal")
    cyl_f("atlas", fr, (side * 0.04 * s, yb, -0.012 * s), (side * 0.043 * s, yb - 0.04 * s, -0.012 * s), 0.003 * s, sides=5, key="gunmetal")
    cyl_f("atlas", fr, (side * 0.043 * s, yb - 0.042 * s, -0.012 * s), (side * 0.063 * s, yb - 0.042 * s, -0.012 * s), 0.0075 * s, 0.0065 * s, sides=8, key=knob)
    # the side cover's gold ring
    cyl_f("atlas", fr, (-0.0215 * s, yb, -0.012 * s), (-0.0225 * s, yb, -0.012 * s), 0.018 * s, sides=10, key="gold", caps=(False, True))


def rod_spinning(base, tilt_x, tilt_z, length, col, grip, seed, with_reel=None):
    """A spinning rod standing on its butt at `base` (world), leaning by (tilt_x, tilt_z) per metre. Guides on a random side."""
    r = random.Random(seed)
    up = Vector((tilt_x, 1.0, tilt_z)).normalized()
    side_ang = r.uniform(0, math.tau)
    e1 = _perp(up)
    e2 = up.cross(e1)
    gside = (e1 * math.cos(side_ang) + e2 * math.sin(side_ang)).normalized()
    b = Vector(base)
    P = lambda t: b + up * t  # noqa: E731
    gk = "cork" if grip == "cork" else ("eva_black" if grip == "eva" else "eva_grey")
    cyl("atlas", P(0), P(0.03), 0.0165, 0.0165, 10, "rubber")
    cyl("atlas", P(0.03), P(0.31), 0.0155, 0.0135, 10, gk, caps=(False, False))
    cyl("atlas", P(0.31), P(0.325), 0.0145, 0.0145, 10, "chrome")
    cyl("atlas", P(0.325), P(0.43), 0.0115, 0.0115, 10, "gunmetal", caps=(False, False))
    cyl("atlas", P(0.43), P(0.445), 0.014, 0.014, 10, "chrome")
    cyl("atlas", P(0.445), P(0.52), 0.0125, 0.0105, 10, gk, caps=(False, False))
    cyl("atlas", P(0.52), P(0.53), 0.0095, 0.0095, 8, "chrome", caps=(False, False))
    blank_len = length - 0.53
    rb0, rb1 = 0.0105, 0.0028
    rad = lambda t: rb0 + (rb1 - rb0) * ((t - 0.53) / blank_len)  # noqa: E731
    cyl("atlas", P(0.53), P(length), rb0, rb1, 6, col, caps=(False, True))
    # ferrule / decoration wraps
    for t in (0.55, 0.6, 0.53 + blank_len * 0.45):
        cyl("atlas", P(t), P(t + 0.02), rad(t) + 0.0009, rad(t + 0.02) + 0.0009, 6, "thread_gold" if r.random() < 0.5 else "thread_red", caps=(False, False))
    n = r.choice((5, 6, 7))
    for k in range(n):
        f = (k / (n - 1)) ** 1.35
        t = 0.53 + 0.16 + f * (blank_len - 0.18)
        if k == n - 1:
            t = length - 0.004
        ring_r = 0.013 * (1 - f) + 0.0028 * f
        stand = ring_r + 0.006 * (1 - f) + 0.002
        foot = P(t)
        top = foot + gside * stand
        cyl("atlas", P(t - 0.012), P(t + 0.012), rad(t) + 0.0008, rad(t) + 0.0008, 5, "thread_red" if col != "rod_wine" else "thread_gold", caps=(False, False))
        cyl("atlas", foot + gside * rad(t), top - gside * ring_r * 0.9, 0.0011, 0.0011, 4, "chrome", caps=(False, False))
        cyl("atlas", foot + gside * rad(t) - up * 0.008, top - gside * ring_r * 0.9, 0.0009, 0.0009, 3, "chrome", caps=(False, False))
        torus("atlas", top, up.cross(gside), ring_r, 0.0012 + 0.0008 * (1 - f), "chrome", seg=8, sides=3)
    # the hook keeper above the fore grip
    cyl("atlas", P(0.56) + gside * 0.008, P(0.575) + gside * 0.006, 0.001, 0.001, 3, "chrome", caps=(False, False))
    if with_reel:
        # the reel hangs under the seat on the guides' side
        m = Matrix((gside, up, gside.cross(up))).transposed()
        f = Fr(R=m @ Fr.rot(0, math.pi, 0) @ Fr.rot(0, 0, math.pi))
        f.o = P(0.378) + gside * 0.011
        fr = Fr(R=Matrix((-gside, -up.cross(-gside) * -1, up)).transposed())
        # local: +y = away from the blank (toward the guides' side), +z = up the rod
        zl = up
        yl = gside
        xl = yl.cross(zl)
        fr = Fr(R=Matrix((xl, yl, zl)).transposed())
        fr.o = P(0.36) + gside * 0.0115
        reel(fr, *with_reel)


def rod_tele(base, tilt_x, tilt_z, length, col, seed):
    """A collapsed telescopic 민장대: one long butt section with the inner sections' ends stepping out at the top, a screw-
    on butt cap, a non-slip grip zone, gold cosmetic bands, a rubber tip plug."""
    r = random.Random(seed)
    up = Vector((tilt_x, 1.0, tilt_z)).normalized()
    b = Vector(base)
    P = lambda t: b + up * t  # noqa: E731
    R0 = r.uniform(0.016, 0.019)
    cyl("atlas", P(0), P(0.035), R0 + 0.0012, R0 + 0.001, 10, r.choice(("gold", "chrome", "gunmetal")))
    cyl("atlas", P(0.035), P(0.32), R0, R0 * 0.98, 10, "eva_black" if r.random() < 0.5 else col, caps=(False, False))
    cyl("atlas", P(0.32), P(length - 0.09), R0 * 0.98, R0 * 0.82, 8, col, caps=(False, False))
    for t in (0.33, length - 0.12):
        cyl("atlas", P(t), P(t + 0.018), R0 * 0.99 + 0.001, R0 * 0.99 + 0.001, 8, "gold", caps=(False, False))
    t = length - 0.09
    rr = R0 * 0.82
    for k in range(4):  # the inner sections' lips
        cyl("atlas", P(t), P(t + 0.018), rr, rr, 8, col if k % 2 else "gold", caps=(True, False))
        t += 0.018
        rr *= 0.8
    cyl("atlas", P(t), P(t + 0.02), rr * 1.1, rr * 0.9, 6, "rubber")


def rod_case(base, tilt_x, tilt_z, length, col, seed):
    """A soft rod case (낚싯대 가방) standing in the rack: a padded tube, a zip down its side, a carry strap, a reinforced base."""
    r = random.Random(seed)
    up = Vector((tilt_x, 1.0, tilt_z)).normalized()
    b = Vector(base)
    P = lambda t: b + up * t  # noqa: E731
    rr = r.uniform(0.045, 0.055)
    cyl("atlas", P(0), P(0.08), rr + 0.004, rr + 0.004, 10, "rubber")
    cyl("atlas", P(0.08), P(length - 0.06), rr, rr * 0.94, 10, col, caps=(False, False))
    cyl("atlas", P(length - 0.06), P(length), rr * 0.94, rr * 0.5, 10, col)
    side = _perp(up)
    cyl("atlas", P(0.1) + side * rr, P(length - 0.08) + side * rr * 0.94, 0.004, 0.004, 4, "pl_black", caps=(False, False))
    cyl("atlas", P(length - 0.08) + side * rr, P(length - 0.02) + side * rr * 0.6, 0.006, 0.006, 4, "chrome")
    e2 = up.cross(side)
    a0, a1 = P(0.45) - e2 * rr, P(1.0) - e2 * rr
    poly_tube("atlas", [a0, a0 - e2 * 0.05 + up * 0.1, a1 - e2 * 0.05 - up * 0.1, a1], 0.008, "pl_black", 4)
    for t in (0.45, 1.0):
        cyl("atlas", P(t - 0.025), P(t + 0.025), rr + 0.003, rr + 0.003, 10, "pl_black", caps=(False, False))


def build_rod_rack():
    # a floor trough of dark wood (the rods' butts stand in it) and a wall rail with spring clips at 1.75
    x0, x1 = 98.32, 99.98
    z0, z1 = ZB + 0.03, ZB + 0.42
    f = W0
    box("wood", f, x0, x1, FY, FY + 0.03, z0, z1, skip="D")
    for (a, b_, c, d) in ((x0, x1, z1 - 0.025, z1), (x0, x1, z0, z0 + 0.025), (x0, x0 + 0.025, z0, z1), (x1 - 0.025, x1, z0, z1)):
        box("wood", f, a, b_, FY, FY + 0.13, c, d, skip="D")
    box("atlas", f, x0 + 0.03, x1 - 0.03, FY + 0.03, FY + 0.035, z0 + 0.03, z1 - 0.03, key="eva_black")  # the rubber mat
    for yr in (1.72, 2.42):
        box("wood", f, x0, x1, yr, yr + 0.05, ZB, ZB + 0.035)
        for k in range(10):
            xx = x0 + 0.08 + k * 0.17
            box("atlas", f, xx - 0.012, xx + 0.012, yr + 0.005, yr + 0.045, ZB + 0.035, ZB + 0.075, key="pl_black")
    for xx in (x0 + 0.05, x1 - 0.05):
        box("atlas", f, xx - 0.015, xx + 0.015, 1.6, 2.5, ZB, ZB + 0.02, key="steel_dark")
    # back row: tall spinning rods and long 민장대; front row: shorter rods
    specs_back = [("s", 2.62, "rod_black", "cork", ("gunmetal", "line_green", "pl_black")), ("t", 1.45, "rod_wine"), ("s", 2.55, "rod_navy", "eva", None),
                  ("s", 2.7, "rod_grey", "cork", None), ("t", 1.5, "rod_green"), ("s", 2.48, "rod_white", "eva", ("pl_white", "line_orange", "pl_black")),
                  ("s", 2.6, "rod_black", "eva2", None), ("t", 1.42, "rod_gold"), ("s", 2.66, "rod_green", "cork", None)]
    specs_front = [("c", 1.42, "canvas_blue"), ("t", 1.3, "rod_navy"), ("s", 1.95, "rod_wine", "eva", None), ("c", 1.3, "pl_black"), ("t", 1.25, "rod_black"),
                   ("t", 1.36, "rod_green"), ("s", 2.05, "rod_grey", "cork", ("gold", "line_white", "cork")), ("c", 1.5, "canvas_green"), ("t", 1.28, "rod_wine"),
                   ("s", 1.9, "rod_navy", "eva2", None), ("t", 1.33, "rod_gold"), ("c", 1.36, "rod_wine")]
    specs_back = specs_back + [("s", 2.58, "rod_wine", "cork", None), ("t", 1.55, "rod_navy"), ("s", 2.5, "rod_gold", "eva", None)]
    for row, specs, zz in ((0, specs_back, ZB + 0.12), (1, specs_front, ZB + 0.3)):
        n = len(specs)
        for k, sp in enumerate(specs):
            x = x0 + 0.1 + k * (x1 - x0 - 0.2) / (n - 1) + rng.uniform(-0.02, 0.02)
            tx, tz = rng.uniform(-0.015, 0.015), -0.035 - 0.03 * row + rng.uniform(-0.01, 0.01)  # leaning back to the rail
            base = (x, FY + 0.035, zz)
            if sp[0] == "s":
                rod_spinning(base, tx, tz, sp[1], sp[2], sp[3], 300 + 17 * k + row, sp[4])
            elif sp[0] == "c":
                rod_case(base, tx, tz, sp[1], sp[2], 700 + k)
            else:
                rod_tele(base, tx, tz, sp[1], sp[2], 500 + 13 * k + row)
    # a price card clipped on the rail
    box("atlas", f, 99.0, 99.16, 1.62, 1.72, ZB + 0.04, ZB + 0.042, key="paper")


# ------------------------------------------------------------------------------------------------ the pegboard and packs
def peg_hook(f, x, y, ln=0.17):
    """A pegboard hook: a steel wire out of the board, a little upturn at the tip, a price-label holder."""
    cyl("atlas", f.g(x, y, 0.0), f.g(x, y + 0.012, ln), 0.0022, 0.0022, 4, "chrome", caps=(False, False))
    cyl("atlas", f.g(x, y + 0.012, ln), f.g(x, y + 0.03, ln + 0.012), 0.0022, 0.0022, 4, "chrome", caps=(False, True))
    box("atlas", f, x - 0.022, x + 0.022, y + 0.018, y + 0.04, ln + 0.004, ln + 0.008, key="paper")


def lure_pack(f, x, ytop, z, key, w=0.11, h=0.18, blister=True, tilt=0.0):
    """A blister card hanging from its slot: the card and, on its front, the clear blister (mapped to the card's window)."""
    p = f.sub(x, ytop, z, roll=tilt)
    u0, v0, u1, v1 = rect(key)
    box("atlas", p, -w / 2, w / 2, -h, 0, -0.0012, 0.0012, keys={"F": key, "B": "card_white", "L": "card_white", "R": "card_white", "U": "card_white", "D": "card_white"})
    if blister:
        # the blister window in the art is at x 18..174 of 192, y 82..262 of 320 (from the top)
        bx0, bx1 = (18 / 192 - 0.5) * w, (174 / 192 - 0.5) * w
        by1, by0 = -82 / 320 * h, -262 / 320 * h
        sub = [u0 + (u1 - u0) * 18 / 192, v1 - (v1 - v0) * 262 / 320, u0 + (u1 - u0) * 174 / 192, v1 - (v1 - v0) * 82 / 320]
        ATL["_bl"] = sub
        dz = 0.022
        inset = 0.006
        q = lambda x_, y_, z_: p.g(x_, y_, z_)  # noqa: E731
        fr_ = (q(bx0 + inset, by0 + inset, dz), q(bx1 - inset, by0 + inset, dz), q(bx1 - inset, by1 - inset, dz), q(bx0 + inset, by1 - inset, dz))
        face("atlas", fr_, [auv("_bl", 0.04, 0.04), auv("_bl", 0.96, 0.04), auv("_bl", 0.96, 0.96), auv("_bl", 0.04, 0.96)])
        base = (q(bx0, by0, 0.0012), q(bx1, by0, 0.0012), q(bx1, by1, 0.0012), q(bx0, by1, 0.0012))
        for i in range(4):
            a, b_ = base[i], base[(i + 1) % 4]
            c, d = fr_[(i + 1) % 4], fr_[i]
            face("atlas", (a, b_, c, d), [auv("pl_clear", 0.5, 0.5)] * 4)


def build_back_center():
    # --- brown pegboard (x 100.05..101.8, y 1.0..3.15) on battens, a dark wood frame
    f = Fr(0, 0, ZB)
    px0, px1, py0, py1 = 100.05, 101.8, 0.62, 3.1
    grid("peg", (px0, py0, ZB + 0.025), (px1 - px0, 0, 0), (0, py1 - py0, 0), 0.18, uvfn=lambda p: ((p.x - px0) / TILE["peg"], (p.y - py0) / TILE["peg"]))
    for (a, b_, c, d) in ((px0 - 0.03, px1 + 0.03, py0 - 0.03, py0), (px0 - 0.03, px1 + 0.03, py1, py1 + 0.03), (px0 - 0.03, px0, py0, py1), (px1, px1 + 0.03, py0, py1)):
        box("atlas", f, a, b_, c, d, 0.0, 0.04, key="wood_dark", skip="B")
    pf = Fr(0, 0, ZB + 0.025)
    cols = 12
    for row, (y, kind) in enumerate(((2.95, "lure"), (2.65, "lure"), (2.35, "lure"), (2.04, "worm"), (1.73, "worm"), (1.42, "lure"), (1.12, "lure"))):
        for c in range(cols):
            x = px0 + 0.08 + c * (px1 - px0 - 0.16) / (cols - 1)
            if kind == "lure":
                key = f"lure{rng.randrange(8)}"
                h = 0.18
            else:
                key = f"worm{rng.randrange(6)}"
                h = 0.19
            peg_hook(pf, x, y, 0.15)
            n = rng.choice((2, 3, 3, 4))
            for k in range(n):
                z = 0.03 + k * 0.03
                lure_pack(pf, x + rng.uniform(-0.003, 0.003), y + 0.012 + z * 0.08, z, key, 0.105, h, blister=(kind == "lure" and k >= n - 2), tilt=rng.uniform(-0.04, 0.04))
    # --- the whiteboard notice (x 101.9..103.2, y 2.05..2.95), aluminium frame, a marker tray with markers; the clock above
    bx0, bx1, by0, by1 = 101.92, 103.2, 1.62, 2.52
    box("atlas", f, bx0, bx1, by0, by1, 0.0, 0.014, keys={"F": "board"}, key="alu")
    for (a, b_, c, d) in ((bx0 - 0.02, bx1 + 0.02, by0 - 0.02, by0), (bx0 - 0.02, bx1 + 0.02, by1, by1 + 0.02), (bx0 - 0.02, bx0, by0, by1), (bx1, bx1 + 0.02, by0, by1)):
        box("atlas", f, a, b_, c, d, 0.0, 0.024, key="alu", skip="B")
    box("atlas", f, bx0 + 0.2, bx1 - 0.2, by0 - 0.05, by0 - 0.02, 0.0, 0.05, key="alu", skip="B")
    for k, kk in enumerate(("pl_blue", "pl_red", "pl_black")):
        x = bx0 + 0.35 + k * 0.09
        cyl("atlas", (x, by0 - 0.012, ZB + 0.035), (x + 0.12, by0 - 0.012, ZB + 0.035), 0.008, sides=6, key=kk)
    cx, cy_ = (bx0 + bx1) / 2, 2.78
    cyl("atlas", (cx, cy_, ZB), (cx, cy_, ZB + 0.045), 0.17, sides=24, key="pl_black", capkey="clock")
    cyl("atlas", (cx, cy_, ZB + 0.045), (cx, cy_, ZB + 0.048), 0.155, sides=24, key="clock", capkey="clock", caps=(False, True))
    for (ang, ln, w) in ((math.radians(305), 0.085, 0.006), (math.radians(60), 0.12, 0.004)):
        hf = Fr(cx, cy_, ZB + 0.052, roll=-ang)
        box("atlas", hf, -w / 2, w / 2, -0.01, ln, 0.0, 0.003, key="dark")
    cyl("glass", (cx, cy_, ZB + 0.06), (cx, cy_, ZB + 0.062), 0.156, sides=24, key="pl_clear")
    # --- two glass shelves of reels under the board (y 1.3 and 1.7), chrome brackets
    for ys in (0.86, 1.24):
        box("glass", f, bx0, bx1, ys - 0.008, ys, 0.02, 0.27)
        box("atlas", f, bx0, bx1, ys - 0.012, ys - 0.008, 0.265, 0.272, key="chrome")
        for xx in (bx0 + 0.08, bx1 - 0.08):
            box("atlas", f, xx - 0.006, xx + 0.006, ys - 0.06, ys - 0.008, 0.0, 0.24, key="chrome")
        bodies = [("gunmetal", "line_green", "pl_black"), ("pl_black", "line_white", "eva_black"), ("gold", "line_orange", "cork"), ("pl_white", "line_green", "pl_black"),
                  ("gunmetal", "line_white", "cork"), ("pl_red", "line_white", "pl_black")]
        for k in range(5):
            x = bx0 + 0.13 + k * 0.255
            body = bodies[(k + int(ys * 10)) % len(bodies)]
            reel(Fr(x, ys, ZB + 0.15, yaw=math.radians(rng.uniform(55, 80))), *body, size=1.05)
            box("atlas", f, x - 0.025, x + 0.025, ys, ys + 0.004, 0.235, 0.265, key="paper")
    # --- the float (찌) wire grid (x 103.3..104.15, y 1.1..3.1): white wire, hooks, long packs
    gx0, gx1, gy0, gy1 = 103.3, 104.15, 0.62, 2.9
    zz = ZB + 0.04
    for k in range(int((gx1 - gx0) / 0.05) + 1):
        x = gx0 + k * 0.05
        cyl("atlas", (x, gy0, zz), (x, gy1, zz), 0.0028, sides=4, key="wire_white", caps=(False, False))
    for k in range(int((gy1 - gy0) / 0.05) + 1):
        y = gy0 + k * 0.05
        cyl("atlas", (gx0, y, zz + 0.004), (gx1, y, zz + 0.004), 0.0028, sides=4, key="wire_white", caps=(False, False))
    for (xx,) in ((gx0 - 0.01,), (gx1 + 0.01,)):
        box("atlas", f, xx - 0.01, xx + 0.01, gy0, gy1, 0.0, 0.04, key="wire_white")
    gf = Fr(0, 0, zz + 0.006)
    for y in (2.8, 2.38, 1.96, 1.54):
        for c in range(6):
            x = gx0 + 0.07 + c * 0.142
            peg_hook(gf, x, y, 0.13)
            key = f"float{rng.randrange(6)}"
            for k in range(rng.choice((3, 4, 5))):
                p = gf.sub(x + rng.uniform(-0.003, 0.003), y + 0.012, 0.025 + k * 0.022, roll=rng.uniform(-0.03, 0.03))
                box("atlas", p, -0.024, 0.024, -0.36, 0.0, -0.004, 0.004, keys={"F": key}, key="pl_clear")
    # line spools in a tray on the grid's lower part (y 1.2..1.7): a wire basket of spools
    box("atlas", f, gx0 + 0.02, gx1 - 0.02, 0.9, 0.92, 0.04, 0.26, key="wire_white")
    box("atlas", f, gx0 + 0.02, gx1 - 0.02, 0.92, 1.0, 0.25, 0.26, key="wire_white")
    for k in range(7):
        x = gx0 + 0.1 + k * 0.11
        for j in range(2):
            z = ZB + 0.1 + j * 0.09
            sk = f"spool{(k + j) % 4}"
            cyl("atlas", (x, 0.92, z), (x, 0.92 + 0.055, z), 0.045, sides=12, key="pl_black", capkey=sk)
            cyl("atlas", (x, 0.975, z), (x, 0.98, z), 0.045, sides=12, key=sk, capkey=sk, caps=(False, True))


# ------------------------------------------------------------------------------------------------ cabinets, shelves, bins
def tackle_box(f, w, h, d, key, latch="pl_white"):
    """A plastic tackle box: body, a lid with a lip, two latches, a folding handle."""
    box("atlas", f, -w / 2, w / 2, 0, h * 0.7, -d / 2, d / 2, key=key, skip="D")
    box("atlas", f, -w / 2 - 0.004, w / 2 + 0.004, h * 0.7, h * 0.74, -d / 2 - 0.004, d / 2 + 0.004, key=key)
    box("atlas", f, -w / 2, w / 2, h * 0.74, h, -d / 2, d / 2, key=key)
    for sx in (-1, 1):
        box("atlas", f, sx * w * 0.3 - 0.018, sx * w * 0.3 + 0.018, h * 0.55, h * 0.82, d / 2, d / 2 + 0.008, key=latch)
    cyl("atlas", f.g(-w * 0.22, h + 0.012, 0), f.g(w * 0.22, h + 0.012, 0), 0.009, sides=6, key="pl_black")
    for sx in (-1, 1):
        box("atlas", f, sx * w * 0.24 - 0.01, sx * w * 0.24 + 0.01, h, h + 0.015, -0.01, 0.01, key="pl_black")


def cooler(f, w, h, d, body="cooler_white", lid="cooler_blue"):
    """An ice box: rounded-ish body (chamfered with a second box), a coloured lid with a hinge line, side handles, a drain plug."""
    box("atlas", f, -w / 2, w / 2, 0.0, h * 0.78, -d / 2, d / 2, key=body, skip="D")
    box("atlas", f, -w / 2 + 0.01, w / 2 - 0.01, h * 0.78, h * 0.8, -d / 2 + 0.01, d / 2 - 0.01, key="pl_grey")
    box("atlas", f, -w / 2 - 0.005, w / 2 + 0.005, h * 0.8, h * 0.94, -d / 2 - 0.005, d / 2 + 0.005, key=lid)
    box("atlas", f, -w / 2 + 0.02, w / 2 - 0.02, h * 0.94, h, -d / 2 + 0.02, d / 2 - 0.02, key=lid)
    for sx in (-1, 1):
        box("atlas", f, sx * (w / 2) - 0.012 * (1 - sx) / 2 * 2 + (0 if sx > 0 else 0), sx * (w / 2) + 0.012 * (1 + sx) / 2 * 2 - (0.012 if sx > 0 else 0), h * 0.6, h * 0.68, -0.06, 0.06, key="pl_grey")
    cyl("atlas", f.g(w * 0.35, h * 0.08, d / 2), f.g(w * 0.35, h * 0.08, d / 2 + 0.012), 0.012, sides=8, key="pl_black")
    # the push-button latch on the lid's front
    box("atlas", f, -0.03, 0.03, h * 0.82, h * 0.9, d / 2 + 0.004, d / 2 + 0.012, key="pl_white")


def bin_with_bags(f, w, h, d, keys):
    """A blue plastic crate full of 떡밥 bags lying at angles (ref05)."""
    box("atlas", f, -w / 2, w / 2, 0.0, 0.012, -d / 2, d / 2, key="pl_blue")
    for (a, b_, c, e) in ((-w / 2, w / 2, d / 2 - 0.012, d / 2), (-w / 2, w / 2, -d / 2, -d / 2 + 0.012), (-w / 2, -w / 2 + 0.012, -d / 2, d / 2), (w / 2 - 0.012, w / 2, -d / 2, d / 2)):
        box("atlas", f, a, b_, 0.0, h, c, e, key="pl_blue")
    box("atlas", f, -w / 2 - 0.006, w / 2 + 0.006, h - 0.012, h, d / 2 - 0.004, d / 2 + 0.006, key="pl_blue")
    n = max(2, int(w / 0.12))
    for k in range(n):
        x = -w / 2 + 0.07 + k * (w - 0.14) / max(1, n - 1)
        p = f.sub(x, 0.02, d * 0.1, yaw=rng.uniform(-0.25, 0.25), pitch=rng.uniform(-1.15, -0.85))
        pillow(p, 0.15, 0.22, 0.035, rng.choice(keys), back="pl_white", nu=3, nv=4)


def build_cabinet():
    # (references 05 / 06) bins of 떡밥 bags on the floor under the pegboard, the reels' base, and the floor displays either
    # side of the shopkeeper: a crate stack, coolers for rent, rod stands -- the floor is what the window shows most
    keys = [f"bait{i}" for i in range(8)]
    bin_with_bags(Fr(100.93, FY, ZB + 0.26), 1.62, 0.2, 0.42, keys)
    bin_with_bags(Fr(100.93, FY + 0.2, ZB + 0.2), 1.5, 0.16, 0.3, keys)
    f = W0
    box("wood", f, 101.9, 103.22, FY, 0.62, ZB, ZB + 0.3)
    box("atlas", f, 101.95, 102.5, 0.62, 0.84, ZB + 0.04, ZB + 0.28, key="cardboard")
    box("atlas", f, 102.55, 103.15, 0.62, 0.78, ZB + 0.05, ZB + 0.27, key="cardboard")
    box("atlas", f, 102.55, 103.15, 0.78, 0.782, ZB + 0.14, ZB + 0.18, key="pl_clear")
    # left of the shopkeeper: two crates of bags, a tackle-box pile
    bin_with_bags(Fr(100.75, FY, -22.05, 0.12), 0.62, 0.3, 0.42, keys)
    bin_with_bags(Fr(100.78, FY + 0.3, -22.08, 0.05), 0.62, 0.28, 0.42, keys)
    tackle_box(Fr(100.62, FY, -21.35, -0.25), 0.4, 0.2, 0.26, "pl_teal")
    tackle_box(Fr(100.62, FY + 0.2, -21.35, -0.2), 0.36, 0.15, 0.24, "pl_pink")
    tackle_box(Fr(100.65, FY + 0.35, -21.33, -0.3), 0.3, 0.12, 0.2, "pl_clear", latch="pl_orange")
    # middle: a pallet of bait cartons and an open carton of bags (stock waiting for the shelves)
    for (x, z, w, h, d, yaw) in ((102.35, -23.35, 0.5, 0.3, 0.36, 0.05), (102.95, -23.3, 0.46, 0.3, 0.34, -0.08), (102.6, -23.32, 0.48, 0.28, 0.34, 0.15)):
        yb = FY if h == 0.3 else FY + 0.3
        c = Fr(x, yb, z, yaw)
        box("atlas", c, -w / 2, w / 2, 0.0, h, -d / 2, d / 2, key="cardboard", skip="D")
        box("atlas", c, -w / 2 - 0.002, w / 2 + 0.002, h * 0.45, h * 0.55, -d / 2 - 0.002, d / 2 + 0.002, key="pl_clear", skip="UD")
        box("atlas", c, -0.12, 0.12, h * 0.3, h * 0.7, d / 2 + 0.002, d / 2 + 0.004, key=f"bait{rng.randrange(8)}")
    # right: coolers for rent with a tag, a bundle of rod stands (받침틀) in a bucket
    cooler(Fr(103.75, FY, -22.05, -0.1), 0.62, 0.42, 0.4, "cooler_white", "cooler_blue")
    cooler(Fr(103.78, FY + 0.42, -22.05, 0.05), 0.5, 0.36, 0.34, "cooler_white", "cooler_red")
    box("atlas", Fr(103.78, FY + 0.78, -22.05, 0.05), -0.08, 0.08, 0.0, 0.002, -0.05, 0.05, key="paper")
    cyl("atlas", (104.55, FY, -21.75), (104.55, FY + 0.32, -21.75), 0.15, 0.17, 14, "pl_blue", caps=(True, False))
    for k in range(7):
        a = k / 7 * math.tau
        b_ = Vector((104.55 + math.cos(a) * 0.08, FY + 0.05, -21.75 + math.sin(a) * 0.08))
        t = b_ + Vector((math.cos(a) * 0.12, 0.95, math.sin(a) * 0.12))
        cyl("atlas", b_, t, 0.008, 0.007, 5, "pl_black")
        cyl("atlas", t, t + Vector((0.0, 0.06, 0.0)), 0.012, 0.012, 5, "rubber")
        torus("atlas", t + Vector((0, 0.09, 0)), Vector((math.sin(a), 0, -math.cos(a))), 0.03, 0.005, "pl_black", seg=6, sides=3, arc=math.pi, start=0)


def build_steel_shelf():
    # a grey steel shelf (x 104.25..105.0, depth 0.42) of bait bags and corn cans
    x0, x1 = 104.25, 105.0
    z0, z1 = ZB + 0.01, ZB + 0.43
    f = W0
    for (xx, zz) in ((x0, z0), (x1 - 0.035, z0), (x0, z1 - 0.035), (x1 - 0.035, z1 - 0.035)):
        box("atlas", f, xx, xx + 0.035, FY, 2.45, zz, zz + 0.035, key="steel")
    levels = (FY + 0.08, 0.98, 1.48, 1.98, 2.42)
    for y in levels:
        box("atlas", f, x0, x1, y - 0.025, y, z0, z1, key="steel", keys={"F": "steel_dark"})
    keys = [f"bait{i}" for i in range(8)]
    # bottom: a crate of bags; level 1: cans; levels 2-3: bags standing; top: bags lying
    bin_with_bags(Fr((x0 + x1) / 2, levels[0], (z0 + z1) / 2), 0.68, 0.22, 0.38, keys)
    for j in range(3):
        for k in range(5):
            x = x0 + 0.1 + k * 0.135
            z = z1 - 0.07 - j * 0.12
            cyl("atlas", (x, levels[1], z), (x, levels[1] + 0.11, z), 0.042, sides=12, key="can_corn", capkey="alu")
            if j == 0 and k % 2 == 0:
                cyl("atlas", (x + 0.06, levels[1] + 0.11, z - 0.05), (x + 0.06, levels[1] + 0.22, z - 0.05), 0.042, sides=12, key="can_corn", capkey="alu")
    for li in (2, 3):
        for k in range(4):
            x = x0 + 0.11 + k * 0.175
            p = Fr(x, levels[li], z1 - 0.14, yaw=rng.uniform(-0.08, 0.08), pitch=-0.12)
            pillow(p, 0.16, 0.36, 0.045, rng.choice(keys), back="pl_white")
    for k in range(3):
        p = Fr(x0 + 0.17 + k * 0.22, levels[4] + 0.005, ZB + 0.22, yaw=rng.uniform(-0.2, 0.2), pitch=-math.pi / 2 + 0.08)
        pillow(p, 0.2, 0.3, 0.05, rng.choice(keys), back="pl_white")
    # shelf-edge price strips
    for y in levels[1:4]:
        box("atlas", f, x0 + 0.02, x1 - 0.02, y - 0.06, y - 0.025, z1, z1 + 0.003, key="paper")


def build_fridge():
    # a glass-door bait fridge (x 105.05..105.75): white cabinet, lit inside, four wire shelves of cans and worm cups
    x0, x1 = 105.06, 105.76
    z0, z1 = ZB + 0.01, ZB + 0.68
    yh = FY + 1.86
    f = W0
    t = 0.04
    box("atlas", f, x0, x1, FY + 0.08, yh, z0, z0 + t, key="fridge")
    box("atlas", f, x0, x0 + t, FY + 0.08, yh, z0, z1, key="fridge")
    box("atlas", f, x1 - t, x1, FY + 0.08, yh, z0, z1, key="fridge")
    box("atlas", f, x0, x1, yh - 0.2, yh, z0, z1, key="pl_blue", keys={"F": "pl_blue"})
    box("atlas", f, x0, x1, FY + 0.08, FY + 0.22, z0, z1, key="steel_dark")  # the compressor grille
    box("atlas", f, x0 + 0.02, x1 - 0.02, FY, FY + 0.08, z0 + 0.02, z1 - 0.06, key="dark")
    # inner liner
    box("atlas", f, x0 + t, x1 - t, FY + 0.22, yh - 0.2, z0 + t, z0 + t + 0.002, key="fridge_in")
    for xx, k in ((x0 + t, "L"), (x1 - t - 0.002, "R")):
        box("atlas", f, xx, xx + 0.002, FY + 0.22, yh - 0.2, z0 + t, z1 - 0.05, key="fridge_in")
    box("emit", f, x0 + t + 0.02, x1 - t - 0.02, yh - 0.215, yh - 0.2, z1 - 0.14, z1 - 0.1)  # the light strip
    shelves = [FY + 0.25, FY + 0.6, FY + 0.95, FY + 1.3]
    for y in shelves:
        for k in range(8):
            z = z0 + t + 0.03 + k * 0.075
            cyl("atlas", (x0 + t, y, z), (x1 - t, y, z), 0.003, sides=4, key="wire_white", caps=(False, False))
        cyl("atlas", (x0 + t, y, z1 - 0.07), (x1 - t, y, z1 - 0.07), 0.004, sides=4, key="wire_white", caps=(False, False))
    for si, y in enumerate(shelves):
        for k in range(5 if si % 2 == 0 else 4):
            for j in range(3):
                x = x0 + t + 0.07 + k * (0.11 if si % 2 == 0 else 0.135)
                z = z1 - 0.13 - j * 0.15
                if si % 2 == 0:
                    cyl("atlas", (x, y, z), (x, y + 0.11, z), 0.042, sides=12, key="can_corn", capkey="alu")
                else:
                    cyl("atlas", (x, y, z), (x, y + 0.07, z), 0.05, 0.055, sides=12, key="pl_white", caps=(False, False))
                    cyl("atlas", (x, y + 0.07, z), (x, y + 0.085, z), 0.058, sides=12, key="pl_green", capkey="cup_lid")
    # the door: black gasket frame, glass, a long aluminium handle, hinges
    dz = z1
    fw = 0.045
    for (a, b_, c, d) in ((x0, x1, FY + 0.22, FY + 0.22 + fw), (x0, x1, yh - 0.2 - fw, yh - 0.2), (x0, x0 + fw, FY + 0.22, yh - 0.2), (x1 - fw, x1, FY + 0.22, yh - 0.2)):
        box("atlas", f, a, b_, c, d, dz, dz + 0.04, key="pl_black")
    box("glass", f, x0 + fw, x1 - fw, FY + 0.22 + fw, yh - 0.2 - fw, dz + 0.018, dz + 0.022)
    box("atlas", f, x0 + 0.06, x0 + 0.085, FY + 0.7, FY + 1.35, dz + 0.04, dz + 0.07, key="alu")
    box("atlas", f, x0 + 0.1, x0 + 0.34, yh - 0.42, yh - 0.26, dz + 0.04, dz + 0.042, key="paper")


# ------------------------------------------------------------------------------------------------ west and east walls
def landing_net(top, handle_len=1.2, hoop_r=0.22, net_depth=0.42):
    """A landing net hung by its hoop: a telescopic handle hanging down, the hoop's frame, the cut-out mesh bag."""
    c = Vector(top) + Vector((0.035, -hoop_r, 0.0))
    # the hoop lies in the wall's plane (x = c.x), handle downward
    ax = Vector((1, 0, 0))
    torus("atlas", c, ax, hoop_r, 0.006, "pl_black", seg=18, sides=4)
    yoke = c + Vector((0, -hoop_r, 0))
    cyl("atlas", yoke, yoke + Vector((0, -0.08, 0)), 0.012, 0.014, 6, "gunmetal")
    h0 = yoke + Vector((0, -0.08, 0))
    cyl("atlas", h0, h0 + Vector((0, -handle_len * 0.55, 0)), 0.014, 0.016, 8, "rod_black")
    cyl("atlas", h0 + Vector((0, -handle_len * 0.55, 0)), h0 + Vector((0, -handle_len, 0)), 0.018, 0.019, 8, "eva_black")
    cyl("atlas", h0 + Vector((0, -handle_len, 0)), h0 + Vector((0, -handle_len - 0.02, 0)), 0.02, 0.02, 8, "rubber")
    # the net: a bag hanging from the hoop, falling away from the wall and down
    g = GEO["atlas"]
    seg, rings = 14, 5
    i0 = len(g["v"])
    for j in range(rings + 1):
        t = j / rings
        rr = hoop_r * (1 - 0.8 * t ** 1.1)
        cc = c + Vector((0.07 * math.sin(t * 2.6) + 0.02, -net_depth * 1.15 * t - hoop_r * 0.35 * t, 0))
        for i in range(seg + 1):
            a = i / seg * math.tau
            g["v"].append(cc + Vector((0, math.cos(a) * rr, math.sin(a) * rr)))
    for j in range(rings):
        for i in range(seg):
            a = i0 + j * (seg + 1) + i
            idx = [a, a + 1, a + seg + 2, a + seg + 1]
            uvs = [auv("net", (i / seg) % 1 * 0.999, j / rings), auv("net", ((i + 1) / seg) * 0.999, j / rings), auv("net", ((i + 1) / seg) * 0.999, (j + 1) / rings),
                   auv("net", (i / seg) * 0.999, (j + 1) / rings)]
            g["f"].append((idx, uvs, True))
            g["f"].append((list(reversed(idx)), list(reversed(uvs)), True))
    # the hook it hangs on
    cyl("atlas", (top[0] - 0.035, top[1] + 0.005, top[2]), (top[0] + 0.07, top[1] + 0.02, top[2]), 0.004, sides=4, key="chrome")


def folding_chair(f, fabric):
    """A folded fishing chair leaning on the wall: two tube frames flat together, the seat and back fabric between."""
    for sx in (-1, 1):
        cyl("atlas", f.g(sx * 0.22, 0, 0), f.g(sx * 0.22, 0.86, 0), 0.011, sides=6, key="pl_black")
        cyl("atlas", f.g(sx * 0.2, 0, 0.03), f.g(sx * 0.2, 0.62, 0.03), 0.01, sides=6, key="steel_dark")
    for y in (0.05, 0.42, 0.84):
        cyl("atlas", f.g(-0.22, y, 0), f.g(0.22, y, 0), 0.009, sides=5, key="pl_black")
    box("atlas", f, -0.21, 0.21, 0.45, 0.82, -0.004, 0.004, key=fabric)
    box("atlas", f, -0.19, 0.19, 0.1, 0.4, 0.018, 0.026, key=fabric)
    for sx in (-1, 1):
        box("atlas", f, sx * 0.22 - 0.02, sx * 0.22 + 0.02, 0.5, 0.53, -0.005, 0.05, key="pl_black")


def parasol(f, cloth):
    """A closed fishing parasol: pole, the furled canopy (a fluted cone), ribs' tips, the strap, a spike."""
    cyl("atlas", f.g(0, 0, 0), f.g(0, 1.85, 0), 0.012, sides=6, key="alu")
    cyl("atlas", f.g(0, -0.12, 0), f.g(0, 0.0, 0), 0.004, 0.012, 5, "steel")
    g = GEO["atlas"]
    n = 12
    i0 = len(g["v"])
    for (y, r) in ((1.0, 0.012), (1.15, 0.05), (1.55, 0.07), (1.85, 0.045), (1.95, 0.014)):
        for k in range(n + 1):
            a = k / n * math.tau
            rr = r * (1.0 if k % 2 == 0 else 0.72)
            g["v"].append(f.g(math.cos(a) * rr, y, math.sin(a) * rr))
    for j in range(4):
        for k in range(n):
            a = i0 + j * (n + 1) + k
            idx = [a, a + n + 1, a + n + 2, a + 1]
            g["f"].append((idx, [auv(cloth, k / n, j / 4), auv(cloth, k / n, (j + 1) / 4), auv(cloth, (k + 1) / n, (j + 1) / 4), auv(cloth, (k + 1) / n, j / 4)], True))
    box("atlas", f, -0.072, 0.072, 1.4, 1.43, -0.072, 0.072, key="pl_black")
    cyl("atlas", f.g(0, 1.95, 0), f.g(0, 2.02, 0), 0.01, 0.006, 6, "pl_black")


def measuring_board(f):
    box("atlas", f, 0, 0.66, 0, 0.09, 0, 0.022, keys={"F": "ruler"}, key="pl_white")
    box("atlas", f, -0.03, 0.0, -0.01, 0.11, 0, 0.08, key="pl_yellow")


def frame_photo(f, w, h, key):
    box("atlas", f, -w / 2, w / 2, -h / 2, h / 2, 0, 0.025, key="wood_dark")
    box("atlas", f, -w / 2 + 0.03, w / 2 - 0.03, -h / 2 + 0.03, h / 2 - 0.03, 0.025, 0.027, key=key)
    box("glass", f, -w / 2 + 0.025, w / 2 - 0.025, -h / 2 + 0.025, h / 2 - 0.025, 0.03, 0.032)


def build_west():
    wf = Fr(X0, 0, 0, math.pi / 2)  # local +z = +x (into the room), local x = -z
    # nets and the board between the window and the front wall (z -21.25..-19.8)
    landing_net((X0 + 0.02, 2.95, -20.25), 1.25)
    landing_net((X0 + 0.02, 2.88, -20.85), 1.1, 0.2)
    measuring_board(Fr(X0 + 0.01, 1.55, -20.05, math.pi / 2))
    frame_photo(Fr(X0 + 0.01, 2.0, -20.9, math.pi / 2), 0.4, 0.32, "photo")
    box("atlas", Fr(X0 + 0.01, 0, 0, math.pi / 2), 20.95 - 0.08, 20.95 + 0.08, 2.24, 2.27, 0, 0.004, key="paper")
    # coolers under the side window
    cooler(Fr(X0 + 0.32, FY, -22.75, math.pi / 2), 0.62, 0.42, 0.4, "cooler_white", "cooler_blue")
    cooler(Fr(X0 + 0.32, FY + 0.42, -22.72, math.pi / 2 + 0.06), 0.46, 0.32, 0.32, "cooler_white", "cooler_red")
    cooler(Fr(X0 + 0.3, FY, -22.05, math.pi / 2), 0.5, 0.36, 0.36, "cooler_blue", "cooler_white")
    tackle_box(Fr(X0 + 0.3, FY + 0.36, -22.05, math.pi / 2 - 0.08), 0.34, 0.14, 0.22, "pl_orange", latch="pl_black")
    box("atlas", Fr(X0 + 0.01, 0, 0, math.pi / 2), 22.4 - 0.12, 22.4 + 0.12, 1.35, 1.5, 0, 0.004, key="paper")
    # folding chairs and closed parasols in the corner by the rod rack
    for k, fab in enumerate(("canvas_green", "canvas_blue", "canvas_green")):
        folding_chair(Fr(X0 + 0.07 + k * 0.05, FY, -23.55 + k * 0.03, math.pi / 2, pitch=-0.2), fab)
    parasol(Fr(X0 + 0.12, FY + 0.12, -23.85, 0, pitch=-0.06, roll=-0.08), "parasol")
    parasol(Fr(X0 + 0.2, FY + 0.12, -23.95, 0, pitch=-0.05, roll=-0.12), "parasol_b")


def build_east():
    ef = Fr(X1, 0, 0, -math.pi / 2)  # local +z = -x, local x = +z
    # a wall shelf of tackle boxes (y 1.55), two coolers below, a calendar, the no-smoking sign, the extinguisher
    box("wood", Fr(0, 0, 0), X1 - 0.34, X1, 1.55, 1.58, -23.35, -21.95)
    for zz in (-23.25, -22.05):
        box("atlas", Fr(0, 0, 0), X1 - 0.3, X1, 1.48, 1.55, zz - 0.012, zz + 0.012, key="steel_dark")
    for k, (kk, h) in enumerate((("pl_blue", 0.16), ("pl_teal", 0.13), ("pl_pink", 0.16), ("pl_clear", 0.12))):
        tackle_box(Fr(X1 - 0.16, 1.58, -23.1 + k * 0.33, -math.pi / 2 + rng.uniform(-0.06, 0.06)), 0.3, h, 0.22, kk)
    tackle_box(Fr(X1 - 0.16, 1.74, -23.1, -math.pi / 2 + 0.04), 0.28, 0.12, 0.2, "pl_yellow")
    cooler(Fr(X1 - 0.3, FY, -23.0, -math.pi / 2), 0.62, 0.42, 0.4, "cooler_white", "cooler_red")
    cooler(Fr(X1 - 0.3, FY, -22.3, -math.pi / 2), 0.62, 0.42, 0.4, "cooler_white", "cooler_blue")
    box("atlas", Fr(X1 - 0.3, FY + 0.42, -22.3, -math.pi / 2), -0.1, 0.1, 0.0, 0.002, -0.07, 0.07, key="paper")
    box("atlas", Fr(X1, 0, 0, -math.pi / 2), -21.45 - 0.12, -21.45 + 0.12, 1.95, 2.29, 0, 0.004, key="calendar")
    box("atlas", Fr(X1, 0, 0, -math.pi / 2), -21.45 - 0.1, -21.45 + 0.1, 2.45, 2.65, 0, 0.004, key="nosmoke")
    # a second pegboard above the tackle-box shelf (the references' walls are packed to the ceiling): worm bags and lures
    z0, z1, y0, y1 = -23.45, -21.95, 2.0, 3.12
    grid("peg", (X1 - 0.025, y0, z0), (0, 0, z1 - z0), (0, y1 - y0, 0), 0.18, uvfn=lambda p: ((p.z - z0) / TILE["peg"], (p.y - y0) / TILE["peg"]))
    pf = Fr(X1 - 0.025, 0, 0, -math.pi / 2)
    for (a, b_, c, d) in ((z0 - 0.03, z1 + 0.03, y0 - 0.03, y0), (z0 - 0.03, z1 + 0.03, y1, y1 + 0.03), (z0 - 0.03, z0, y0, y1), (z1, z1 + 0.03, y0, y1)):
        box("atlas", pf, a, b_, c, d, -0.025, 0.015, key="wood_dark", skip="B")
    for row, (y, kind) in enumerate(((3.0, "lure"), (2.68, "worm"), (2.36, "lure"))):
        for c in range(10):
            zc = z0 + 0.08 + c * (z1 - z0 - 0.16) / 9
            key = f"lure{rng.randrange(8)}" if kind == "lure" else f"worm{rng.randrange(6)}"
            peg_hook(pf, zc, y, 0.14)
            n = rng.choice((2, 3, 4))
            for k in range(n):
                zz = 0.03 + k * 0.03
                lure_pack(pf, zc + rng.uniform(-0.003, 0.003), y + 0.012 + zz * 0.08, zz, key, 0.1, 0.18 if kind == "lure" else 0.19,
                          blister=(kind == "lure" and k >= n - 2), tilt=rng.uniform(-0.04, 0.04))
    parasol(Fr(X1 - 0.12, FY + 0.12, -21.7, 0, pitch=-0.03, roll=0.07), "parasol")
    # the extinguisher by the door
    ex, ez = X1 - 0.14, -21.15
    cyl("atlas", (ex, FY, ez), (ex, FY + 0.46, ez), 0.075, sides=14, key="ext_red", capkey="ext_red")
    cyl("atlas", (ex, FY + 0.46, ez), (ex, FY + 0.51, ez), 0.075, 0.03, 10, "ext_red")
    box("atlas", Fr(ex, FY + 0.12, ez, -math.pi / 2 - 0.5), -0.045, 0.045, 0.0, 0.25, 0.0745, 0.077, key="extinguisher")
    box("atlas", Fr(ex, FY + 0.51, ez, -math.pi / 2), -0.012, 0.012, 0.0, 0.07, -0.02, 0.02, key="pl_black")
    box("atlas", Fr(ex, FY + 0.56, ez, -math.pi / 2), -0.06, 0.03, 0.0, 0.012, -0.012, 0.012, key="pl_black")
    poly_tube("atlas", [Vector((ex - 0.01, FY + 0.55, ez + 0.02)), Vector((ex - 0.05, FY + 0.45, ez + 0.08)), Vector((ex - 0.06, FY + 0.25, ez + 0.08))], 0.008, "pl_black")
    # a plastic stool behind the counter
    st = Fr(103.55, FY, -21.15, 0.3)
    box("atlas", st, -0.15, 0.15, 0.4, 0.43, -0.15, 0.15, key="pl_red")
    for sx in (-1, 1):
        for sz in (-1, 1):
            cyl("atlas", st.g(sx * 0.13, 0.4, sz * 0.13), st.g(sx * 0.155, 0.0, sz * 0.155), 0.016, sides=5, key="pl_red")


# ------------------------------------------------------------------------------------------------ the counter
def jar_of_floats(c):
    x, y, z = c
    cyl("glass", (x, y, z), (x, y + 0.16, z), 0.06, sides=12, key="pl_clear", caps=(False, False))
    cyl("atlas", (x, y, z), (x, y + 0.006, z), 0.06, sides=12, key="glass_jar")
    cyl("atlas", (x, y + 0.16, z), (x, y + 0.172, z), 0.063, sides=12, key="pl_red", caps=(False, False))
    for k in range(13):
        a = k / 13 * math.tau + rng.uniform(-0.2, 0.2)
        rr = rng.uniform(0.0, 0.045)
        b = Vector((x + math.cos(a) * rr, y + 0.006, z + math.sin(a) * rr))
        top = b + Vector((math.cos(a) * 0.05, rng.uniform(0.3, 0.42), math.sin(a) * 0.05))
        d = (top - b)
        mid0 = b + d * 0.25
        mid1 = b + d * 0.62
        cyl("atlas", b, mid0, 0.0015, 0.0015, 3, "wood_light", caps=(False, False))
        cyl("atlas", mid0, mid1, 0.0035, 0.0075, 6, "pl_white", caps=(False, False))
        cyl("atlas", mid1, top - d * 0.18, 0.0075, 0.0025, 6, rng.choice(("pl_white", "pl_orange", "pl_white")), caps=(False, False))
        cyl("atlas", top - d * 0.18, top, 0.0018, 0.0016, 4, rng.choice(("pl_red", "pl_orange", "pl_yellow", "pl_green")))


def desk_fan(f):
    box("atlas", f, -0.08, 0.08, 0.0, 0.025, -0.08, 0.08, key="pl_white")
    cyl("atlas", f.g(0, 0.025, -0.02), f.g(0, 0.2, -0.02), 0.012, sides=6, key="pl_white")
    h = f.sub(0, 0.22, -0.02, pitch=0.1)
    cyl("atlas", h.g(0, 0, -0.09), h.g(0, 0, 0.0), 0.04, 0.035, 10, "pl_white")
    torus("atlas", h.g(0, 0, 0.04), h.d(0, 0, 1), 0.11, 0.004, "pl_white", seg=20, sides=4)
    for z_, k in ((0.005, "grille"), (0.075, "grille")):
        g = GEO["atlas"]
        n = 16
        pts = [h.g(math.cos(a) * 0.11, math.sin(a) * 0.11, z_) for a in (i / n * math.tau for i in range(n))]
        uvs = [auv(k, 0.5 + 0.5 * math.cos(i / n * math.tau), 0.5 + 0.5 * math.sin(i / n * math.tau)) for i in range(n)]
        face("atlas", pts, uvs)
        face("atlas", list(reversed(pts)), list(reversed(uvs)))
    for k in range(3):
        bl = h.sub(0, 0, 0.04, roll=k * math.tau / 3 + 0.3, yaw=0.0)
        box("atlas", bl, -0.03, 0.03, 0.015, 0.095, -0.002, 0.002, key="fan_blue")
    cyl("atlas", h.g(0, 0, 0.035), h.g(0, 0, 0.055), 0.018, sides=8, key="fan_blue")


def build_counter():
    x0, x1, z0, z1, top = CTR["x0"], CTR["x1"], CTR["z0"], CTR["z1"], CTR["top"]
    f = W0
    ex0, ex1 = 100.15, 101.55  # the glass-topped lure case
    # body: a panelled front toward the shopkeeper, kick plate, ends
    box("wood", f, x0, x1, FY + 0.08, top - 0.04, z0 + 0.05, z1 - 0.01, skip="D", cell=0.25)
    box("atlas", f, x0 + 0.02, x1 - 0.02, FY, FY + 0.08, z0 + 0.09, z1 - 0.02, key="dark", skip="D")
    for k in range(5):
        a = x0 + 0.06 + k * (x1 - x0 - 0.12) / 5
        box("wood", f, a + 0.03, a + (x1 - x0 - 0.12) / 5 - 0.03, FY + 0.2, top - 0.16, z0 + 0.03, z0 + 0.05)
    # the top: worn hardwood slab, a bull-nosed front lip, broken by the case
    for (a, b_) in ((x0 - 0.05, ex0), (ex1, x1 + 0.05)):
        box("wood", f, a, b_, top - 0.04, top, z0, z1, cell=0.3)
    box("wood", f, ex0, ex1, top - 0.04, top, z0, z0 + 0.08)
    box("wood", f, ex0, ex1, top - 0.04, top, z1 - 0.1, z1)
    # the case: a felt tray 8 cm down, lures and tags on it, an aluminium-framed glass lid flush with the top
    yt = top - 0.1
    box("atlas", f, ex0, ex1, yt - 0.01, yt, z0 + 0.08, z1 - 0.1, key="felt")
    for (a, b_, c, d) in ((ex0, ex1, z0 + 0.08, z0 + 0.09), (ex0, ex1, z1 - 0.11, z1 - 0.1), (ex0, ex0 + 0.01, z0 + 0.08, z1 - 0.1), (ex1 - 0.01, ex1, z0 + 0.08, z1 - 0.1)):
        box("atlas", f, a, b_, yt, top - 0.04, c, d, key="felt")
    box("glass", f, ex0, ex1, top - 0.006, top - 0.002, z0 + 0.08, z1 - 0.1)
    for (a, b_, c, d) in ((ex0, ex1, z0 + 0.075, z0 + 0.09), (ex0, ex1, z1 - 0.115, z1 - 0.1), (ex0 - 0.005, ex0 + 0.012, z0 + 0.08, z1 - 0.1), (ex1 - 0.012, ex1 + 0.005, z0 + 0.08, z1 - 0.1)):
        box("atlas", f, a, b_, top - 0.008, top + 0.002, c, d, key="alu")
    cols = [("rod_green", "pl_white"), ("rod_navy", "chrome"), ("pl_orange", "pl_yellow"), ("rod_black", "gold"), ("pl_pink", "pl_white"), ("rod_wine", "chrome"), ("pl_green", "pl_yellow")]
    for k in range(14):
        x = ex0 + 0.1 + (k % 7) * 0.18 + rng.uniform(-0.02, 0.02)
        z = z0 + 0.22 + (k // 7) * 0.24 + rng.uniform(-0.03, 0.03)
        a = rng.uniform(-0.6, 0.6)
        d = Vector((math.cos(a), 0, math.sin(a)))
        b_ = Vector((x, yt + 0.012, z))
        c0, c1 = cols[k % len(cols)]
        if k % 5 == 3:  # a spoon
            box("atlas", Fr(x, yt, z, a), -0.012, 0.012, 0.0, 0.006, -0.035, 0.035, key="gold" if k % 2 else "chrome")
            continue
        L = rng.uniform(0.07, 0.1)
        cyl("atlas", b_ - d * L / 2, b_ - d * L * 0.1, 0.004, 0.011, 6, c0, caps=(True, False))
        cyl("atlas", b_ - d * L * 0.1, b_ + d * L / 2, 0.011, 0.007, 6, c0, caps=(False, True))
        box("atlas", Fr(*(b_ + d * L / 2 + d * 0.008), yaw=math.atan2(d.x, d.z)), -0.006, 0.006, -0.006, 0.0, -0.004, 0.012, key="pl_clear")
        for t in (-0.25, 0.3):
            hp = b_ + d * L * t
            torus("atlas", hp - Vector((0, 0.008, 0)), d, 0.006, 0.0008, "chrome", seg=6, sides=3)
        box("atlas", Fr(x + 0.03, yt, z + 0.05, rng.uniform(-0.3, 0.3)), -0.018, 0.018, 0.0, 0.001, -0.011, 0.011, key="paper")
    # on the top: cash tray, ledger and pen, jar of floats, the fan, a pile of rental slips, a calculator
    ct = Fr(103.35, top, -20.2, 0.08)
    box("atlas", ct, -0.17, 0.17, 0.0, 0.035, -0.12, 0.12, key="cash_tray", skip="D")
    for k in range(4):
        cx = -0.12 + k * 0.08
        cyl("atlas", ct.g(cx, 0.035, 0.0), ct.g(cx, 0.039, 0.0), 0.028, sides=10, key="steel_dark", caps=(False, True))
        for j in range(rng.randint(2, 5)):
            cyl("atlas", ct.g(cx + rng.uniform(-0.01, 0.01), 0.035 + j * 0.003, rng.uniform(-0.06, 0.06)), ct.g(cx, 0.037 + j * 0.003, 0.0), 0.012, sides=8, key="coin")
    box("atlas", ct, -0.16, -0.0, 0.035, 0.04, 0.03, 0.11, key="note_green")
    box("atlas", ct, 0.0, 0.16, 0.035, 0.038, 0.03, 0.11, key="note_blue")
    lg = Fr(102.6, top, -20.22, -0.12)
    for sx, rl in ((-1, -0.05), (1, 0.05)):
        p = lg.sub(sx * 0.0, 0.0, 0.0, roll=rl)
        box("atlas", p, (0 if sx > 0 else -0.24), (0.24 if sx > 0 else 0), 0.0, 0.012, -0.16, 0.16, keys={"U": "ledger"}, key="paper")
        cyl("atlas", lg.g(0.05, 0.02, 0.02), lg.g(0.17, 0.02, -0.06), 0.0045, sides=6, key="pl_blue")
    jar_of_floats((101.85, top, -20.08))
    desk_fan(Fr(103.82, top, -20.38, math.radians(160)))
    box("atlas", Fr(102.15, top, -20.3, 0.2), -0.06, 0.06, 0.0, 0.03, -0.04, 0.04, key="paper")
    calc = Fr(102.95, top, -20.38, -0.2)
    box("atlas", calc, -0.06, 0.06, 0.0, 0.015, -0.085, 0.085, key="pl_grey")
    box("atlas", calc, -0.05, 0.05, 0.015, 0.017, 0.03, 0.075, key="note_green")
    for i in range(4):
        for j in range(4):
            box("atlas", calc, -0.045 + i * 0.025, -0.027 + i * 0.025, 0.015, 0.02, -0.075 + j * 0.025, -0.06 + j * 0.025, key="pl_black")
    # the rental hand-over: a shallow plastic tray at the window with two rod stand forks in it
    box("atlas", Fr(101.0, top, -19.85), -0.1, 0.1, 0.0, 0.01, -0.06, 0.06, key="pl_white")


# ------------------------------------------------------------------------------------------------ density pass (2026-11-17)
# Real shops are packed (references 03 lure wall, 06 bait baskets): the upper side walls and the ceiling carry hanging stock,
# the floor edges are lined with baskets and cartons, the counter's front has clip strips and a hook-pack stand.
def hang_case(top, length, col, seed):
    """A rod bag hung by its strap from a hook: a padded tube hanging straight down, the strap's loop, a zip line."""
    r = random.Random(seed)
    t = Vector(top)
    rr = r.uniform(0.04, 0.05)
    a = t + Vector((0, -0.08, 0))
    cyl("atlas", a, a + Vector((0, -length, 0)), rr * 0.6, rr, 10, col, caps=(True, False))
    cyl("atlas", a + Vector((0, -length, 0)), a + Vector((0, -length - 0.07, 0)), rr + 0.004, rr + 0.004, 10, "rubber")
    poly_tube("atlas", [a + Vector((-0.02, 0, 0)), t, a + Vector((0.02, 0, 0))], 0.006, "pl_black", 4)
    cyl("atlas", a + Vector((0, -0.05, rr)), a + Vector((0, -length + 0.05, rr)), 0.003, 0.003, 4, "pl_black", caps=(False, False))
    for f_ in (0.3, 0.75):
        y = -length * f_
        cyl("atlas", a + Vector((0, y - 0.02, 0)), a + Vector((0, y + 0.02, 0)), rr + 0.003, rr + 0.003, 10, "pl_black", caps=(False, False))


def keep_net(top, r=0.19, rings=7, drop=0.34):
    """A 살림망 (keep net) hung folded: its hoops stacked loose under the top ring, the mesh sleeve between them, a cord."""
    t = Vector(top)
    cyl("atlas", t, t + Vector((0, -0.12, 0)), 0.003, 0.003, 3, "pl_black", caps=(False, False))
    c0 = t + Vector((0, -0.12 - r * 0.15, 0))
    up = Vector((0, 1, 0))
    for k in range(rings):
        cc = c0 + Vector((0.01 * math.sin(k * 1.7), -drop * k / (rings - 1), 0.012 * math.cos(k * 1.3)))
        torus("atlas", cc, up + Vector((0.06 * math.sin(k), 0, 0.05 * math.cos(k))), r, 0.004, "pl_black" if k else "galv", seg=16, sides=3)
    g = GEO["atlas"]
    seg = 16
    i0 = len(g["v"])
    for j in range(2):
        cc = c0 + Vector((0, -drop * j, 0))
        for i in range(seg + 1):
            a_ = i / seg * math.tau
            g["v"].append(cc + Vector((math.cos(a_) * r * 0.985, 0, math.sin(a_) * r * 0.985)))
    for i in range(seg):
        idx = [i0 + i, i0 + i + 1, i0 + seg + 2 + i, i0 + seg + 1 + i]
        uvs = [auv("net", i / seg * 0.999, 0), auv("net", (i + 1) / seg * 0.999, 0), auv("net", (i + 1) / seg * 0.999, 1), auv("net", i / seg * 0.999, 1)]
        g["f"].append((idx, uvs, True))
    pts = [c0 + Vector((math.cos(i / seg * math.tau) * r, -drop, math.sin(i / seg * math.tau) * r)) for i in range(seg)]
    face("atlas", pts, [auv("net", 0.5 + 0.5 * math.cos(i / seg * math.tau), 0.5 + 0.5 * math.sin(i / seg * math.tau)) for i in range(seg)])


def clip_strip(f, x, ytop, z, n, keys, w=0.075, h=0.11):
    """A clip strip: a clear plastic strip hung from a hook, small packs clipped down it (hooks, sinkers, swivels)."""
    box("atlas", f, x - 0.012, x + 0.012, ytop - n * (h + 0.012) - 0.02, ytop, z, z + 0.003, key="pl_clear")
    for k in range(n):
        lure_pack(f, x + rng.uniform(-0.004, 0.004), ytop - 0.02 - k * (h + 0.012), z + 0.006, rng.choice(keys), w, h, blister=False, tilt=rng.uniform(-0.05, 0.05))


def ceiling_bar(p0, p1, y=3.12):
    """A galvanised pipe hung from the ceiling on two threaded rods (S-hooks along it carry the stock)."""
    a, b = Vector((p0[0], y, p0[1])), Vector((p1[0], y, p1[1]))
    cyl("atlas", a, b, 0.012, 0.012, 6, "galv")
    for q in (a + (b - a) * 0.1, a + (b - a) * 0.9):
        cyl("atlas", q, Vector((q.x, CY, q.z)), 0.005, 0.005, 4, "galv", caps=(False, False))
        cyl("atlas", Vector((q.x, CY - 0.01, q.z)), Vector((q.x, CY, q.z)), 0.03, 0.03, 8, "galv")
    return a, b


def build_density():
    lures = [f"lure{i}" for i in range(8)]
    worms = [f"worm{i}" for i in range(6)]
    keys = [f"bait{i}" for i in range(8)]
    # --- west wall, above the side window: a white wire grid of float packs (y 2.66..3.32)
    wf = Fr(X0 + 0.03, 0, 0, math.pi / 2)  # local x = -z (world), local +z = +x
    gz0, gz1 = -23.25, -21.25
    for k in range(int((gz1 - gz0) / 0.05) + 1):
        zz = gz0 + k * 0.05
        cyl("atlas", (X0 + 0.03, 2.66, zz), (X0 + 0.03, 3.32, zz), 0.0026, sides=4, key="wire_white", caps=(False, False))
    for yy in (2.66, 2.71, 2.81, 2.91, 3.01, 3.11, 3.21, 3.32):
        cyl("atlas", (X0 + 0.034, yy, gz0), (X0 + 0.034, yy, gz1), 0.0026, sides=4, key="wire_white", caps=(False, False))
    for c in range(12):
        zc = gz0 + 0.1 + c * (gz1 - gz0 - 0.2) / 11
        lx = -zc
        peg_hook(wf, lx, 3.24, 0.1)
        key = f"float{rng.randrange(6)}"
        for k in range(rng.choice((2, 3))):
            p = wf.sub(lx + rng.uniform(-0.003, 0.003), 3.25, 0.03 + k * 0.022, roll=rng.uniform(-0.03, 0.03))
            box("atlas", p, -0.024, 0.024, -0.36, 0.0, -0.004, 0.004, keys={"F": key}, key="pl_clear")
    # --- west corner above the chairs: rod bags hanging from a wall rail
    box("wood", W0, X0, X0 + 0.05, 3.18, 3.23, -24.3, -23.3)
    for k, col in enumerate(("canvas_blue", "pl_black", "canvas_green", "rod_wine", "pl_black")):
        hang_case((X0 + 0.11, 3.2, -24.2 + k * 0.2), rng.uniform(0.85, 1.05), col, 900 + k)
    # --- east wall by the door: two keep nets on hooks; a rod bag between the fridge and the pegboard
    for k, z in enumerate((-21.75, -21.2)):
        cyl("atlas", (X1, 3.25, z), (X1 - 0.12, 3.27, z), 0.004, sides=4, key="chrome")
        keep_net((X1 - 0.24, 3.25, z), 0.2 if k == 0 else 0.17)
    hang_case((X1 - 0.1, 3.2, -23.62), 0.9, "canvas_green", 950)
    # --- ceiling bars over the west and east sides: clip strips, rod bags, a keep net
    a, b = ceiling_bar((99.05, -23.6), (99.05, -21.7))
    for k in range(6):
        q = a + (b - a) * (0.08 + k * 0.17)
        if k in (1, 4):
            hang_case((q.x, q.y, q.z), 0.8, "canvas_blue" if k == 1 else "pl_black", 980 + k)
        elif k == 2:
            keep_net((q.x, q.y, q.z), 0.17)
        else:
            clip_strip(Fr(q.x, 0, q.z, 0.0), 0.0, q.y - 0.03, 0.0, 5, lures + worms)
            clip_strip(Fr(q.x, 0, q.z, math.pi), 0.0, q.y - 0.03, 0.0, 5, lures + worms)
    a, b = ceiling_bar((105.0, -23.3), (105.0, -21.9))
    for k in range(5):
        q = a + (b - a) * (0.1 + k * 0.2)
        if k == 2:
            hang_case((q.x, q.y, q.z), 0.85, "canvas_green", 990)
        else:
            clip_strip(Fr(q.x, 0, q.z, -math.pi / 2), 0.0, q.y - 0.03, 0.0, 6, lures)
    # --- floor edges: baskets and cartons (reference 06)
    bin_with_bags(Fr(98.62, FY, -20.55, math.pi / 2), 0.55, 0.3, 0.4, keys)
    bin_with_bags(Fr(98.62, FY + 0.3, -20.52, math.pi / 2 + 0.05), 0.55, 0.26, 0.4, keys)
    for (x, z, w, h, d, yaw, y0) in ((99.3, -20.05, 0.5, 0.32, 0.38, 0.04, FY), (99.32, -20.05, 0.46, 0.28, 0.34, -0.06, FY + 0.32), (99.75, -20.25, 0.32, 0.22, 0.3, 0.3, FY)):
        c = Fr(x, y0, z, yaw)
        box("atlas", c, -w / 2, w / 2, 0.0, h, -d / 2, d / 2, key="cardboard", skip="D")
        box("atlas", c, -0.1, 0.1, h * 0.3, h * 0.7, -d / 2 - 0.002, -d / 2, key=f"bait{rng.randrange(8)}")
    bin_with_bags(Fr(103.72, FY, ZB + 0.32), 0.8, 0.22, 0.4, keys)
    bin_with_bags(Fr(105.45, FY, -20.55, -math.pi / 2), 0.5, 0.26, 0.38, keys)
    # --- the counter's front (toward the shopkeeper): clip strips on its lip, a price sheet; a hook-pack stand on the top
    cf = Fr(0, 0, CTR["z0"] + 0.03, math.pi)  # local +z = -z (toward the room), local x = -x
    for x in (100.6, 101.15, 102.9, 103.45):
        clip_strip(cf, -x, CTR["top"] - 0.03, 0.0, 6, lures + worms, 0.07, 0.1)
    box("atlas", cf, -102.35, -101.75, 0.7, 1.08, 0.0, 0.002, key="paper")
    st = Fr(101.62, CTR["top"], -20.42, 0.0)
    box("atlas", st, -0.13, 0.13, 0.0, 0.012, -0.06, 0.06, key="pl_black")
    box("atlas", st, -0.012, 0.012, 0.0, 0.34, -0.012, 0.012, key="pl_black")
    for row in range(3):
        for c in range(3):
            x = -0.1 + c * 0.1
            y = 0.32 - row * 0.1
            cyl("atlas", st.g(x, y, 0.0), st.g(x, y + 0.006, 0.07), 0.0018, 0.0018, 3, "chrome", caps=(False, False))
            for k in range(2):
                lure_pack(st, x, y - 0.005, 0.02 + k * 0.02, rng.choice(lures), 0.06, 0.085, blister=False)


# ------------------------------------------------------------------------------------------------ assemble, bake, export
def make_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Roughness"].default_value = 0.6
    if name in TILE or name == "atlas":
        img = bpy.data.images.load(os.path.join(TEX, f"{name}.png"))
        img.colorspace_settings.name = "sRGB"
        tx = nt.nodes.new("ShaderNodeTexImage")
        tx.image = img
        tx.interpolation = "Linear"
        nt.links.new(tx.outputs["Color"], b.inputs["Base Color"])
        if name == "atlas":
            nt.links.new(tx.outputs["Alpha"], b.inputs["Alpha"])
            try:
                m.blend_method = "CLIP"
            except Exception:  # noqa: BLE001
                pass
    elif name == "glass":
        b.inputs["Base Color"].default_value = (0.8, 0.88, 0.9, 1)
        b.inputs["Alpha"].default_value = 0.15
        b.inputs["Roughness"].default_value = 0.05
    elif name == "emit":
        b.inputs["Base Color"].default_value = (1, 1, 1, 1)
        b.inputs["Emission Color"].default_value = (1.0, 0.96, 0.9, 1)
        b.inputs["Emission Strength"].default_value = 6.0
    return m


def to_objects():
    col = bpy.data.collections.new("shop_interior")
    bpy.context.scene.collection.children.link(col)
    objs = {}
    for name in MATS:
        g = GEO[name]
        if not g["f"]:
            continue
        bm = bmesh.new()
        vs = [bm.verts.new(B(p)) for p in g["v"]]
        uvl = bm.loops.layers.uv.new("UVMap")
        for (idx, uvs, smooth) in g["f"]:
            try:
                fc = bm.faces.new([vs[i] for i in idx])
            except ValueError:
                continue
            fc.smooth = smooth
            for lp, uv in zip(fc.loops, uvs):
                lp[uvl].uv = uv
        bm.verts.index_update()
        me = bpy.data.meshes.new(f"shopint_{name}")
        bm.to_mesh(me)
        bm.free()
        o = bpy.data.objects.new(f"shopint_{name}", me)
        col.objects.link(o)
        o.data.materials.append(make_mat(name))
        objs[name] = o
        print(name, "verts", len(me.vertices), "tris", sum(len(p.vertices) - 2 for p in me.polygons))
    return objs


def setup_cycles():
    sc = bpy.context.scene
    try:
        sc.render.engine = "CYCLES"
    except TypeError:
        pass
    sc.cycles.samples = SAMPLES
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for t in ("OPTIX", "CUDA"):
            try:
                prefs.compute_device_type = t
            except TypeError:
                continue
            prefs.get_devices()
            if any(d.type == t for d in prefs.devices):
                for d in prefs.devices:
                    d.use = d.type == t
                sc.cycles.device = "GPU"
                print("cycles on", t)
                break
    except Exception as e:  # noqa: BLE001
        print("gpu?", e)
    w = bpy.data.worlds.new("w")
    sc.world = w
    w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1)
    # the tubes (4000 K) as area lights just under each tube pair, the sky through the south and west windows
    for (cx, cz) in ((100.25, -21.35), (103.75, -21.35), (100.25, -23.25), (103.75, -23.25)):
        L = bpy.data.lights.new("tube", "AREA")
        L.shape = "RECTANGLE"
        L.size, L.size_y = 1.2, 0.09
        L.energy = 95.0
        L.color = (1.0, 0.93, 0.83)
        o = bpy.data.objects.new("tube", L)
        bpy.context.scene.collection.objects.link(o)
        o.location = B((cx, CY - 0.1, cz))
    for (pos, rot, sx, sy, e) in (((102.0, 2.1, -19.6), (math.radians(90), 0, math.pi), 4.0, 1.2, 60.0), ((98.1, 2.15, -22.25), (0, math.radians(90), 0), 1.8, 0.9, 20.0),
                                  ((105.2, 1.7, -19.6), (math.radians(90), 0, math.pi), 1.2, 2.6, 12.0)):
        L = bpy.data.lights.new("sky", "AREA")
        L.shape = "RECTANGLE"
        L.size, L.size_y = sx, sy
        L.energy = e
        L.color = (0.82, 0.9, 1.0)
        o = bpy.data.objects.new("sky", L)
        bpy.context.scene.collection.objects.link(o)
        o.location = B(pos)
        o.rotation_euler = rot


def bake(objs):
    sc = bpy.context.scene
    bake_objs = [o for k, o in objs.items() if k not in ("glass", "emit")]
    for k in ("glass", "emit"):
        if k in objs:
            objs[k].visible_shadow = False
            objs[k].visible_diffuse = k == "emit"
    for o in objs.values():
        a = o.data.color_attributes.new("Light", "FLOAT_COLOR", "POINT")
        o.data.color_attributes.active_color = a
        o.data.attributes.active_color = a
    bpy.ops.object.select_all(action="DESELECT")
    for o in bake_objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = bake_objs[0]
    sc.render.bake.target = "VERTEX_COLORS"
    sc.render.bake.use_pass_direct = True
    sc.render.bake.use_pass_indirect = True
    sc.render.bake.use_pass_color = False
    sc.cycles.max_bounces = 4
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, target="VERTEX_COLORS")
    # exposure: the cream plaster's median irradiance -> 0.33 (x 2 in the game = 0.66 of the albedo; the window glass of the
    # office adds its own veil, measured in the game 2026-11-17)
    import numpy as np
    w = objs["wall"].data.color_attributes["Light"]
    arr = np.zeros(len(w.data) * 4, np.float32)
    w.data.foreach_get("color", arr)
    lum = arr.reshape(-1, 4)[:, :3].mean(1)
    ref = float(np.median(lum))
    gain = 0.33 / max(ref, 1e-6)
    print("bake median wall", ref, "gain", gain)
    for k, o in objs.items():
        a = o.data.color_attributes["Light"]
        arr = np.zeros(len(a.data) * 4, np.float32)
        a.data.foreach_get("color", arr)
        c = arr.reshape(-1, 4)
        if k in ("glass", "emit"):
            c[:, :3] = 0.5
        else:
            # a little more contrast than the raw irradiance (corners, undersides and contact shadows read as in the photos)
            c[:, :3] = np.clip(0.33 * (c[:, :3] * gain / 0.33) ** 1.25, 0.02, 0.62)
        c[:, 3] = 1.0
        a.data.foreach_set("color", c.ravel())


def export(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs.values():
        o.select_set(True)
    os.makedirs(os.path.dirname(GLB), exist_ok=True)
    kw = dict(filepath=GLB, export_format="GLB", use_selection=True, export_yup=True, export_apply=False, export_image_format="WEBP", export_image_quality=82,
              export_normals=False, export_tangents=False, export_extras=False, export_cameras=False, export_lights=False)
    try:
        kw["export_vertex_color"] = "ACTIVE"
    except Exception:  # noqa: BLE001
        pass
    bpy.ops.export_scene.gltf(export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7, export_draco_position_quantization=14,
                              export_draco_normal_quantization=8, export_draco_color_quantization=10, export_draco_generic_quantization=12,
                              export_draco_texcoord_quantization=12, **kw)
    print("GLB", GLB, os.path.getsize(GLB))


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    build_shell()
    build_rod_rack()
    build_back_center()
    build_cabinet()
    build_steel_shelf()
    build_fridge()
    build_west()
    build_east()
    build_counter()
    build_density()
    objs = to_objects()
    total = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs.values())
    print("TOTAL tris", total)
    setup_cycles()
    bake(objs)
    if BLEND:
        os.makedirs(os.path.dirname(os.path.abspath(BLEND)), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(BLEND))
    export(objs)


main()
