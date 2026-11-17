"""B2 (lots v2) — helpers both walk-in rooms share (pure python on b1_geom / b1_parts / b2_parts): the sacred props' bounds
from their GLBs, placements, walls with arched tops and splayed window reveals, candle flames (B1's M_fire hook), the
coloured light pools under the windows (projected along the room's sun), pews with carved ends and folded kneelers.
"""
import json
import math
import os
import struct

import b1_geom as G
import b1_parts as P
import b2_parts as Q
from b1_geom import Mesh, S

HERE = os.path.dirname(os.path.abspath(__file__))
SACRED = os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", "client", "public", "models", "village", "lots", "sacred"))
FLAME = S("M_fire")


def glb_bounds(name, only=None):
    """Bounds of a sacred GLB's PC meshes (asset frame, glTF: x right, y up, z front), from the accessors' min / max (each
    node's box turned by its rotation); `only` = one node's name (a placement that draws only that node)."""
    data = open(os.path.join(SACRED, name + ".glb"), "rb").read()
    n = struct.unpack_from("<I", data, 12)[0]
    js = json.loads(data[20:20 + n])
    lo, hi = [1e9] * 3, [-1e9] * 3
    for nd in js["nodes"]:
        if "mesh" not in nd or "_num_" in nd.get("name", ""):
            continue
        if only and nd.get("name") != only:
            continue
        t = nd.get("translation", [0, 0, 0])
        M = _qmat(nd["rotation"]) if nd.get("rotation") else ((1, 0, 0), (0, 1, 0), (0, 0, 1))
        for p in js["meshes"][nd["mesh"]]["primitives"]:
            a = js["accessors"][p["attributes"]["POSITION"]]
            for cx in (a["min"][0], a["max"][0]):
                for cy in (a["min"][1], a["max"][1]):
                    for cz in (a["min"][2], a["max"][2]):
                        q = tuple(M[r][0] * cx + M[r][1] * cy + M[r][2] * cz + t[r] for r in range(3))
                        lo = [min(lo[i], q[i]) for i in range(3)]
                        hi = [max(hi[i], q[i]) for i in range(3)]
    return tuple(lo), tuple(hi)


def place(kit, node, file, at, yaw, what, **kw):
    """A sacred prop placement: the room GLB gets an empty `node` at `at` (room frame) turned by `yaw`; the prop's own file."""
    lo, hi = glb_bounds(file, kw.get("drawOnly"))
    d = {"node": node, "file": file, "at": at, "yaw": yaw, "what": what, "bbox": (lo, hi)}
    d.update(kw)
    kit.sacred.append(d)
    return d


def yaw_facing(dx, dz):
    """The yaw that turns an asset's front (+z) toward the direction (dx, dz)."""
    return math.atan2(dx, dz)


# ------------------------------------------------------------------------------------------------ walls --

def arch_wall(m, f, u0, u1, v0, top, holes, s, step=0.5):
    """A wall from v0 up to a curved top `top(u)` (vault lunette or gable), minus rectangular holes [(a0, a1, b0, b1)]:
    columns split at the hole edges and every `step`; each column a stack of quads with a sloped top."""
    us = {u0, u1}
    k = int(math.ceil((u1 - u0) / step))
    us.update(u0 + (u1 - u0) * i / k for i in range(k + 1))
    for a0, a1, b0, b1 in holes:
        for a in (a0, a1):
            if u0 < a < u1:
                us.add(a)
    us = sorted(us)
    for ua, ub in zip(us, us[1:]):
        if ub - ua < 1e-4:
            continue
        cu = (ua + ub) / 2
        ta, tb = top(ua), top(ub)
        vs = {v0}
        for a0, a1, b0, b1 in holes:
            if a0 < cu < a1:
                vs.update([b0, b1])
        vs = sorted(v for v in vs if v < min(ta, tb) - 1e-4)
        vs.append(None)  # the top (sloped)
        for va, vb in zip(vs, vs[1:]):
            cv = (va + (vb if vb is not None else min(ta, tb))) / 2
            if any(a0 < cu < a1 and b0 < cv < b1 for a0, a1, b0, b1 in holes):
                continue
            if vb is None:
                f.poly(m, [(ua, va, 0.0), (ub, va, 0.0), (ub, tb, 0.0), (ua, ta, 0.0)], s)
            else:
                f.quad(m, ua, ub, va, vb, 0.0, s)


def circle_fill(m, f, uc, vc, r, half, s, n=24, clip=None):
    """Fill between a circle (radius r) and the square of half-size `half` round it (a round window cut as a square hole)."""
    for i in range(n):
        a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
        pa = (uc + r * math.cos(a0), vc + r * math.sin(a0))
        pb = (uc + r * math.cos(a1), vc + r * math.sin(a1))

        def sq(p):
            dx, dy = p[0] - uc, p[1] - vc
            k = max(abs(dx), abs(dy)) or 1.0
            return (uc + dx * half / k, vc + dy * half / k)
        qa, qb = sq(pa), sq(pb)
        f.poly(m, [(pa[0], pa[1], 0.0), (pb[0], pb[1], 0.0), (qb[0], qb[1], 0.0), (qa[0], qa[1], 0.0)], s)


def splayed_lancet(m, f, uc, sill, w, h, depth, splay, s_reveal, s_sill, k=1.0, n=6):
    """A lancet opening seen from inside: the glass outline (w x h, pointed head) `depth` into the wall, the opening at the
    wall face wider by `splay` all round, splayed reveals between them and a sloping sill. The wall's hole is cut by the
    caller as (uc - w/2 - splay, uc + w/2 + splay, sill - splay*0.6, sill + h + splay) and filled at the head (returns the
    outer head points)."""
    sp_in = sill + h - Q.apex_of(0.0, w, k)
    inner = [(uc - w / 2, sill)] + Q.pointed(uc, sp_in, w, n, k) + [(uc + w / 2, sill)]
    W2 = w + 2 * splay
    sp_out = sill + h + splay - Q.apex_of(0.0, W2, k)
    so = sill - splay * 0.6
    outer = [(uc - W2 / 2, so)] + Q.pointed(uc, sp_out, W2, n, k) + [(uc + W2 / 2, so)]
    for i in range(len(inner) - 1):
        a, b = inner[i], inner[i + 1]
        c, d = outer[i + 1], outer[i]
        q = [f.p(d[0], d[1], 0.0), f.p(c[0], c[1], 0.0), f.p(b[0], b[1], -depth), f.p(a[0], a[1], -depth)]
        mid = G.mul(G.add(q[0], q[1]), 0.5)
        cen = f.p(uc, (sill + sill + h) / 2, -depth)
        if G.dot(G.poly_normal(q), G.sub(cen, mid)) < 0:
            q.reverse()
        m.poly(q, s_reveal)
    # sloping sill
    a, b = inner[-1], inner[0]
    c, d = outer[0], outer[-1]
    q = [f.p(b[0], b[1], -depth), f.p(a[0], a[1], -depth), f.p(d[0], d[1], 0.0), f.p(c[0], c[1], 0.0)]
    if G.poly_normal(q)[1] < 0:
        q.reverse()
    m.poly(q, s_sill)
    return outer[1:-1], (uc - W2 / 2, uc + W2 / 2, so, sill + h + splay)


# ------------------------------------------------------------------------------------------------ candles --

def candle_flame(m, x, y, z, h=0.045, w=0.011, seed=0):
    """A small soft candle flame: two crossed cards (spine bright, rims alpha 0), B1's M_fire layout (UV y = height)."""
    rg = G.rng(seed)
    for ang in (0.3 + rg.uniform(0, 0.4), 1.87 + rg.uniform(0, 0.4)):
        ca, sa = math.cos(ang), math.sin(ang)
        n = 4
        spine, left, right = [], [], []
        for i in range(n + 1):
            t = i / n
            half = w * (math.sin(math.pi * min(1.0, t * 1.1 + 0.12)) ** 0.7) * (1 - 0.5 * t)
            spine.append((x, y + h * t, z))
            left.append((x - half * ca, y + h * t, z - half * sa))
            right.append((x + half * ca, y + h * t, z + half * sa))

        def col(t, a):
            return (1.25 - 0.35 * t, max(0.25, 0.95 - 0.6 * t), max(0.05, 0.6 - 1.0 * t), a)
        for i in range(n):
            t0, t1 = i / n, (i + 1) / n
            a0, a1 = 0.95 * (1 - t0 ** 1.5), 0.95 * (1 - t1 ** 1.5)
            for side, sgn in ((left, -1), (right, 1)):
                q = [spine[i], side[i], side[i + 1], spine[i + 1]]
                cols = [col(t0, a0), col(t0, 0.0), col(t1, 0.0), col(t1, a1)]
                uv = [(0.0, t0), (sgn * 1.0, t0), (sgn * 1.0, t1), (0.0, t1)]
                m.poly(q, FLAME, uv=uv, cols=cols)
                m.poly(list(reversed(q)), FLAME, uv=list(reversed(uv)), cols=list(reversed(cols)))


def glow_disc(m, x, y, z, r, col, a, n=10):
    """A soft additive glow lying flat (a candle's warm spot on the cloth / the floor)."""
    ring = [(x + r * math.cos(2 * math.pi * i / n), y, z + r * math.sin(2 * math.pi * i / n)) for i in range(n)]
    for i in range(n):
        j = (i + 1) % n
        q = [(x, y, z), ring[j], ring[i]]
        if G.poly_normal(q)[1] < 0:
            q = [(x, y, z), ring[i], ring[j]]
        m.poly(q, FLAME, uv=[(0, 0), (1, 0), (1, 0)], cols=[(*col, a), (*col, 0.0), (*col, 0.0)])


# ------------------------------------------------------------------------------------------------ light pools --

def light_pool(m, mat, win, sun, cell, floor_y=0.012, clip=None):
    """The coloured light of one window on the floor: the window's rectangle (`win` = 4 room points: bottom-left,
    bottom-right, top-right, top-left as seen from inside) projected along `sun` (a unit direction, light travelling) onto
    y = floor_y; UVs = the atlas cell (u0, v0, u1, v1) of the glass's transmission map (image v down)."""
    u0, v0, u1, v1 = cell
    uvs = [(u0, v1), (u1, v1), (u1, v0), (u0, v0)]
    pts = []
    for p in win:
        t = (p[1] - floor_y) / -sun[1]
        pts.append((p[0] + sun[0] * t, floor_y, p[2] + sun[2] * t))
    if G.poly_normal(pts)[1] < 0:
        pts = list(reversed(pts))
        uvs = list(reversed(uvs))
    m.poly(pts, S(mat), uv=uvs)
    return pts


# ------------------------------------------------------------------------------------------------ pews --

def pew_kind(name, L, oak, oak_dk, cushion, kneeler, carve=True):
    """A new oak pew facing +z, its centre on the seat's centre (contract iseat): seat top 0.45, front edge +0.25, the back
    0.35 behind (rect -0.35 .. +0.25), `L` long: carved bench ends with a rolled top and a sunk Gothic panel, a moulded seat
    with a cushion, a raked panelled back with a capping rail, a hymn-book shelf and a folded kneeler on its back."""
    m = Mesh(name)
    h = L / 2
    # bench ends (x = +-(h - 0.03)): an outline with a rolled top higher at the back, 7 cm thick
    end = [(-0.35, 0.0), (0.25, 0.0), (0.25, 0.62), (0.22, 0.7), (0.12, 0.74), (0.0, 0.8), (-0.1, 0.9), (-0.2, 0.98), (-0.28, 1.0), (-0.35, 0.98)]
    for sx in (-1, 1):
        x = sx * (h - 0.035)
        m.slab(end, ((x - 0.035, 0.0, 0.0), (0, 0, 1), (0, 1, 0)), 0.07, oak.u((0, 1, 0)))
        if carve:
            # a sunk pointed panel on the outer face and a carved boss under the roll
            sgn = sx
            pts = [(-0.2, 0.12), (0.1, 0.12)] + [(p[0], p[1]) for p in reversed(Q.pointed(-0.05, 0.48, 0.3, 4, 1.0))]
            face_x = x + 0.035 * sgn + 0.004 * sgn
            q = [(face_x, py, pz) for (pz, py) in pts]
            if G.dot(G.poly_normal(q), (sgn, 0, 0)) < 0:
                q.reverse()
            m.poly(q, oak_dk)
            m.box(face_x - 0.01 if sgn > 0 else face_x - 0.004, face_x + 0.004 if sgn > 0 else face_x + 0.01, 0.84, 0.92, -0.2, -0.12, oak)
    # seat: a moulded board (rounded front lip) and a cushion strip
    m.cbox(-h + 0.07, h - 0.07, 0.385, 0.42, -0.22, 0.25, oak.u((1, 0, 0)), c=0.012, skip=("-y",))
    m.cbox(-h + 0.09, h - 0.09, 0.42, 0.45, -0.2, 0.235, cushion.u((1, 0, 0)), c=0.014)
    m.box(-h + 0.07, h - 0.07, 0.3, 0.385, 0.2, 0.235, oak.u((1, 0, 0)), skip=("-y",))   # apron rail under the front lip
    m.box(-h + 0.07, h - 0.07, 0.06, 0.12, -0.08, -0.02, oak_dk.u((1, 0, 0)))          # floor rail
    # raked back: two boards and a capping rail, a hymn shelf and the folded kneeler behind
    for (y0, y1) in ((0.5, 0.7), (0.72, 0.9)):
        za, zb = -0.22 - (y0 - 0.45) * 0.12, -0.22 - (y1 - 0.45) * 0.12
        q = [(-h + 0.07, y0, za), (h - 0.07, y0, za), (h - 0.07, y1, zb), (-h + 0.07, y1, zb)]
        m.poly(q, oak.u((1, 0, 0)))
        q2 = [(p[0], p[1], p[2] - 0.03) for p in reversed(q)]
        m.poly(q2, oak.u((1, 0, 0)))
    m.cbox(-h + 0.07, h - 0.07, 0.92, 0.97, -0.34, -0.24, oak.u((1, 0, 0)), c=0.015)
    m.cbox(-h + 0.07, h - 0.07, 0.7, 0.72, -0.35, -0.27, oak.u((1, 0, 0)), c=0.006)       # hymn shelf on the back
    m.box(-h + 0.07, h - 0.07, 0.72, 0.76, -0.35, -0.338, oak.u((1, 0, 0)))
    if kneeler is not None:
        m.cbox(-h + 0.12, h - 0.12, 0.16, 0.44, -0.345, -0.3, kneeler.u((1, 0, 0)), c=0.012)   # the kneeler, folded up
    return m


def chandelier_kind(brass, wax, arms=8, r=0.55):
    """A brass chandelier: a turned central stem with a ball, S-curved arms with drip pans, wax candle sleeves with lamp
    flames (M_fire), a lower ring; hung on a rod from the ceiling by the kit."""
    m = Mesh("chandelier")
    m.lathe([(0.0, -0.12), (0.06, -0.1), (0.1, -0.02), (0.11, 0.06), (0.05, 0.12), (0.03, 0.4), (0.05, 0.45), (0.03, 0.55), (0.04, 0.62), (0.0, 0.66)], 10, brass)
    m.sphere(0.0, -0.17, 0.0, 0.06, brass, n=8, rings=4)
    for k in range(arms):
        a = 2 * math.pi * k / arms
        ca, sa = math.cos(a), math.sin(a)
        path = [(0.08 * ca, 0.05, 0.08 * sa), (r * 0.45 * ca, -0.02, r * 0.45 * sa), (r * 0.76 * ca, 0.04, r * 0.76 * sa), (r * 0.95 * ca, 0.16, r * 0.95 * sa), (r * ca, 0.26, r * sa)]
        m.tube(path, 0.014, 5, brass)
        p = (r * ca, 0.26, r * sa)
        m.lathe([(0.0, 0.0), (0.06, 0.02), (0.065, 0.035), (0.0, 0.03)], 8, brass, p[0], p[2], p[1])
        m.lathe([(0.017, 0.0), (0.017, 0.13), (0.0, 0.135)], 6, wax, p[0], p[2], p[1] + 0.03)
        candle_flame(m, p[0], p[1] + 0.16, p[2], 0.045, 0.012, seed=k)
    ring = [(r * 0.65 * math.cos(2 * math.pi * k / 24), -0.02, r * 0.65 * math.sin(2 * math.pi * k / 24)) for k in range(25)]
    m.tube(ring, 0.01, 4, brass)
    return m


def pew_place(kit, kind, mesh, x, z):
    kit.place(kind, mesh, x, 0.0, z, 0.0)


# ------------------------------------------------------------------------------------------------ merging prop geometry --

def _qmat(q):
    x, y, z, w = q
    return ((1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)),
            (2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)),
            (2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)))


def glb_meshes(name):
    """Every mesh primitive of a sacred GLB as triangles in the asset frame (node transforms applied): [(node, material,
    [(a, b, c), ...])]. The sacred GLBs are plain (no Draco): float positions, u16/u32 indices."""
    data = open(os.path.join(SACRED, name + ".glb"), "rb").read()
    n = struct.unpack_from("<I", data, 12)[0]
    js = json.loads(data[20:20 + n])
    off = 20 + n
    blen = struct.unpack_from("<I", data, off)[0]
    bin_ = data[off + 8: off + 8 + blen]

    def acc(i):
        a = js["accessors"][i]
        bv = js["bufferViews"][a["bufferView"]]
        start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        comp = {5126: ("f", 4), 5123: ("H", 2), 5125: ("I", 4), 5121: ("B", 1)}[a["componentType"]]
        k = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]
        stride = bv.get("byteStride", comp[1] * k)
        out = []
        for e in range(a["count"]):
            vals = struct.unpack_from("<" + comp[0] * k, bin_, start + e * stride)
            out.append(vals if k > 1 else vals[0])
        return out

    parent = {}
    for i, nd in enumerate(js["nodes"]):
        for c in nd.get("children", []):
            parent[c] = i

    def xf(i, p):
        while i is not None:
            nd = js["nodes"][i]
            s = nd.get("scale", [1, 1, 1])
            p = (p[0] * s[0], p[1] * s[1], p[2] * s[2])
            if "rotation" in nd:
                M = _qmat(nd["rotation"])
                p = tuple(M[r][0] * p[0] + M[r][1] * p[1] + M[r][2] * p[2] for r in range(3))
            t = nd.get("translation", [0, 0, 0])
            p = (p[0] + t[0], p[1] + t[1], p[2] + t[2])
            i = parent.get(i)
        return p

    out = []
    for i, nd in enumerate(js["nodes"]):
        if "mesh" not in nd:
            continue
        for prim in js["meshes"][nd["mesh"]]["primitives"]:
            pos = [xf(i, p) for p in acc(prim["attributes"]["POSITION"])]
            idx = acc(prim["indices"]) if "indices" in prim else list(range(len(pos)))
            mat = js["materials"][prim["material"]]["name"] if "material" in prim else ""
            tris = [(pos[idx[k]], pos[idx[k + 1]], pos[idx[k + 2]]) for k in range(0, len(idx) - 2, 3)]
            out.append((nd.get("name", ""), mat, tris))
    return out


def merge_prop(m, name, at, yaw, matmap, keep=lambda node, mat: True, smooth=False):
    """Copy a sacred GLB's untextured parts (station plaques and numerals, saddle bars and cames, the rose's stone tracery)
    into a room mesh at a placement: the materials become the room's PBR sets (`matmap`: GLB material -> surface)."""
    n = 0
    for node, mat, tris in glb_meshes(name):
        if not keep(node, mat):
            continue
        s = matmap.get(mat.split(".")[0])
        if s is None:
            continue
        for (a, b, c) in tris:
            pts = [G.rot_y(p, yaw, *at) for p in (a, b, c)]
            if G.poly_normal(pts) == (0.0, 0.0, 0.0):
                continue
            m.poly(pts, s, smooth=smooth)
            n += 1
    return n
