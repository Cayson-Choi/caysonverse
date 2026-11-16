"""B1 waterfall W1 round 4: the cliff dressed with photoscanned CC0 rocks (Poly Haven, prepared by prep_falls_scans.py).

The LOCKED W0 face (falls_shape.face_x) stays the reference: a backing face follows it (exactly in the cascade groove,
0.8 m behind it elsewhere) and decimated scan pieces (namaqualand cliff sections, granite masses, a lichen rock face,
boulders) are stacked over it bottom-up until the bare rock is covered, each turned, tilted, mirrored, scaled and BENT so
its front follows a smoothed face_x (the amphitheatre plan, the benches, the rim roll), overlapping and intersecting
its neighbours. Every vertex is clamped so the contract holds:
  - never closer than 0.5 m to the camera wall;
  - in the cascade groove and the band beside it (|z - channel z| < 3.8 m, above the ledge) and in the plunge zone
    (|z - lip z| < 7.5 m, below the ledge) never out of face_x (the pieces stay 3 cm behind it; the backing face is
    exactly face_x in the groove core |dz| < 2.4 m).
A raycast of the assembled cliff from the east gives the front depth map (z, y): it drives the macro colour map (UV2:
cracks dark and green, moss on the ledges, wet purple-brown near the water, water streaks, rust patches), the hidden-face
cull and the plant sites.
Coordinates: game (x east, z south, y up); Blender = (x, -z, y).
"""
import math
import random

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

import falls_shape as F

GROOVE_CORE = 2.4          # |z - channel z| inside which W2's film lies on the plain face_x
GROOVE_BAND = 3.8          # ... and up to here the rock may only be cut back
PLUNGE_HALF = 7.5          # |z - lip z| below the ledge: the plunge and its side strands
INSET = 1.6                # the backing face's depth behind face_x where the scans cover it
BEHIND = 0.03              # clamped scan vertices stay this far behind face_x in the restricted zones
KEYS = ("cliff2", "cliff1", "face2", "boulder1", "boulder3")
UV2_Z = F.FACE_Z
UV2_Y = F.FACE_Y


def Vb(x, z, y):
    return (x, -z, y)


# ================================================================================================== zones ==
def groove_d(z, y):
    return abs(z - F.channel_z(y)) if y > F.LEDGE - 0.6 else 99.0


def restricted(z, y):
    """Nothing may stand out of face_x here (W2's water sheets)."""
    if y > F.LEDGE - 0.6 and abs(z - F.channel_z(y)) < GROOVE_BAND + 0.3:
        return True
    return y < F.LEDGE + 0.6 and abs(z - F.LIP["z"]) < PLUNGE_HALF + 0.5


def zone_w(z, y):
    """0..1: how much a piece placed here must keep behind face_x (ramps in 2 m before the restricted zones)."""
    g = F.smooth(GROOVE_BAND + 2.3, GROOVE_BAND + 0.3, groove_d(z, y)) * F.smooth(F.LEDGE - 2.5, F.LEDGE - 0.6, y)
    p = F.smooth(PLUNGE_HALF + 2.5, PLUNGE_HALF + 0.5, abs(z - F.LIP["z"])) * F.smooth(F.LEDGE + 2.5, F.LEDGE + 0.6, y)
    return max(g, p)


def core_w(z, y):
    """1 in the groove core (backing face exactly face_x), 0 where the backing face stands INSET behind it."""
    if y < F.LEDGE - 0.6:
        return 0.0
    return F.smooth(GROOVE_BAND, GROOVE_CORE, groove_d(z, y)) * F.smooth(F.LEDGE - 0.6, F.LEDGE - 0.2, y)


def face_min(z, y, h):
    """face_x minimised over the h x h cell round (z, y) (5 x 5 samples): a mesh through such points stays on or behind
    the W0 face (its sheet steps, cracks and the lip bulge are sharper than any affordable grid)."""
    k = 0.5 if y < F.TOP - 0.7 else 0.2             # at the rim the face drops away fast above: a short window there
    return min(F.face_x(z + h * a, y + h * k * b) for a in (-0.5, -0.25, 0.0, 0.25, 0.5) for b in (-1.0, -0.5, 0.0, 0.5, 1.0))


def base_x(z, y, h, ref, fl=0.0):
    """The backing face: face_x (conservative, see face_min) in the groove core, else well behind face_x and its local
    minimum (INSET); fl -> 1 onto the wooded flanks (plain face_x)."""
    fx = F.face_x(z, y)
    cw = core_w(z, y)
    under = min(fx, ref.g.sample(ref.mn, z, min(y, F.PLATEAU_Y - 0.6))) - INSET
    out = fx * fl + under * (1.0 - fl)
    if cw <= 0.0:
        return out
    return face_min(z, y, h) * cw + out * (1.0 - cw)


def limit_x(z, y):
    lim = F.camera_wall_x(z) - 0.5 - 0.002
    if restricted(z, y):
        lim = min(lim, F.face_x(z, y) - BEHIND)
    return lim


# ============================================================================================ (z, y) grids ==
class Grid:
    """A raster over (z, y) with bilinear sampling."""

    def __init__(self, z0, z1, y0, y1, step):
        self.z0, self.y0, self.step = z0, y0, step
        self.nz = int(round((z1 - z0) / step)) + 1
        self.ny = int(round((y1 - y0) / step)) + 1
        self.zs = z0 + step * np.arange(self.nz)
        self.ys = y0 + step * np.arange(self.ny)

    def fill(self, fn):
        return np.array([[fn(z, y) for z in self.zs] for y in self.ys], np.float64)

    def sample(self, a, z, y):
        fz = min(max((z - self.z0) / self.step, 0.0), self.nz - 1.001)
        fy = min(max((y - self.y0) / self.step, 0.0), self.ny - 1.001)
        i, j = int(fz), int(fy)
        tz, ty = fz - i, fy - j
        return ((a[j, i] * (1 - tz) + a[j, i + 1] * tz) * (1 - ty) + (a[j + 1, i] * (1 - tz) + a[j + 1, i + 1] * tz) * ty)


def box_mean(a, r):
    """Separable box mean of radius r cells (edges clamped)."""
    out = a
    for ax in (0, 1):
        pad = np.pad(out, [(r + 1, r) if k == ax else (0, 0) for k in (0, 1)], mode="edge")
        c = np.cumsum(pad, axis=ax)
        n = out.shape[ax]
        hi = np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=ax)
        lo = np.take(c, np.arange(0, n), axis=ax)
        out = (hi - lo) / (2 * r + 1)
    return out


def shift_filter(a, r, op):
    """Square max / min / mean filter of radius r cells (edges clamped)."""
    out = a.copy() if op != "mean" else np.zeros_like(a)
    pad = np.pad(a, r, mode="edge")
    h, w = a.shape
    if op == "mean":
        k = 0
        for dj in range(-r, r + 1):
            for di in range(-r, r + 1):
                out += pad[r + dj:r + dj + h, r + di:r + di + w]
                k += 1
        return out / k
    f = np.maximum if op == "max" else np.minimum
    tmp = a.copy()
    for di in range(-r, r + 1):
        tmp = f(tmp, pad[r:r + h, r + di:r + di + w])
    pad = np.pad(tmp, r, mode="edge")
    out = tmp.copy()
    for dj in range(-r, r + 1):
        out = f(out, pad[r + dj:r + dj + h, r:r + w])
    return out


class Ref:
    """The surface the pieces bend to: face_x smoothed over ~1.5 m (min-filtered toward the restricted zones), with y
    held below the plateau (the rim roll, not the plateau's back slope)."""

    def __init__(self):
        self.g = Grid(F.FACE_Z[0] - 6.0, F.FACE_Z[1] + 2.0, -4.0, F.PLATEAU_Y + 3.0, 0.5)
        raw = self.g.fill(lambda z, y: F.face_x(min(max(z, F.FACE_Z[0] - 6), F.FACE_Z[1]), min(y, F.PLATEAU_Y - 0.6)))
        self.mean = shift_filter(raw, 3, "mean")
        self.mn = shift_filter(raw, 3, "min")
        zw = self.g.fill(zone_w)
        self.ref = self.mean * (1 - zw) + (self.mn - 0.25) * zw

    def __call__(self, z, y):
        return self.g.sample(self.ref, z, y)


# ============================================================================================== the scans ==
class Piece:
    """A scan LOD mesh as arrays (Blender local frame: +x front, +y along the face, +z up; origin front/middle/bottom)."""

    def __init__(self, me):
        self.name = me.name
        self.co = [v.co.copy() for v in me.vertices]
        self.tris = []
        self.uv = []
        uvl = me.uv_layers[0].data
        for p in me.polygons:
            ls = list(p.loop_indices)
            self.tris.append(tuple(me.loops[li].vertex_index for li in ls))
            self.uv.append(tuple(tuple(uvl[li].uv) for li in ls))
        xs = [c.x for c in self.co]
        ys = [c.y for c in self.co]
        zs = [c.z for c in self.co]
        self.W = max(ys) - min(ys)
        self.H = max(zs) - min(zs)
        self.D = max(xs) - min(xs)
        self.zmin = min(zs)


def load_scans(path):
    with bpy.data.libraries.load(path) as (src, dst):
        dst.meshes = [n for n in src.meshes if n.startswith("scan_")]
    out = {}
    for me in dst.meshes:
        _, key, lod = me.name.split("_")
        out.setdefault(key, {})[lod] = me
    return out


# per kind: (scale range, depth scale range, roll, yaw, pitch, mirror allowed)
KIND = {
    "cliff2": ((0.95, 1.3), (0.8, 1.05), 0.12, 0.05, (-0.12, 0.0), True),
    "cliff1": ((1.1, 1.6), (0.8, 1.1), 0.2, 0.09, (-0.14, 0.0), True),
    "face2": ((1.7, 2.6), (0.8, 1.2), 0.3, 0.16, (-0.15, 0.02), True),
    "boulder1": ((1.4, 2.4), (0.7, 1.0), 3.14, 3.14, (-0.3, 0.3), True),
    "boulder3": ((1.2, 2.0), (0.7, 1.0), 3.14, 3.14, (-0.2, 0.2), True),
}


def choose_kind(z, y, rng):
    zw = zone_w(z, y)
    if y < 2.0:
        pool = (("cliff1", 0.45), ("cliff2", 0.35), ("boulder3", 0.2))
    elif zw > 0.5:
        pool = (("cliff1", 0.4), ("face2", 0.3), ("cliff2", 0.3))
    elif y > 33.0:
        pool = (("cliff2", 0.55), ("face2", 0.25), ("cliff1", 0.2))
    else:
        pool = (("cliff2", 0.62), ("cliff1", 0.24), ("face2", 0.14))
    r = rng.random()
    for k, p in pool:
        r -= p
        if r <= 0:
            return k
    return pool[-1][0]


class Placement:
    def __init__(self, kind, z, y_bottom, rng, ref, piece):
        sr, dr, roll, yaw, pitch, mir = KIND[kind]
        self.kind = kind
        s = rng.uniform(*sr)
        self.scale = (s * rng.uniform(*dr), s * rng.uniform(0.9, 1.1) * (-1 if (mir and rng.random() < 0.5) else 1),
                      s * rng.uniform(0.85, 1.12))
        self.roll = rng.uniform(-roll, roll)
        self.yaw = rng.uniform(-yaw, yaw)
        self.pitch = rng.uniform(*pitch)
        H = piece.H * abs(self.scale[2])
        self.z = z
        self.yc = y_bottom + 0.5 * H
        zw = zone_w(z, self.yc)
        self.push = rng.uniform(-0.3, 0.25) * (1 - zw) - 0.2 * zw
        self.ref0 = ref(z, self.yc)
        self.flip = self.scale[1] < 0

    def matrix(self, piece):
        """local -> Blender world, before the bend: pivot at the piece's front centre."""
        piv = Matrix.Translation((0.0, 0.0, -(piece.zmin + 0.5 * piece.H)))
        S = Matrix.Diagonal((*self.scale, 1.0))
        R = Matrix.Rotation(self.yaw, 4, "Z") @ Matrix.Rotation(self.pitch, 4, "Y") @ Matrix.Rotation(self.roll, 4, "X")
        T = Matrix.Translation(Vb(self.ref0 + self.push, self.z, self.yc))
        return T @ R @ S @ piv

    def world(self, piece, ref):
        M = self.matrix(piece)
        out = []
        for c in piece.co:
            w = M @ c
            gz, gy = -w.y, w.z
            w.x += ref(gz, gy) - self.ref0
            out.append(w)
        return out


def place_pieces(scans, ref, rng, needed, max_pieces=60, log=print):
    """Bottom-up cover of the bare-rock raster `needed` (Grid, bool array) with scan placements."""
    g, need = needed
    covered = np.zeros_like(need, dtype=bool)
    out = []
    lo = {k: Piece(scans[k]["lo"]) for k in KEYS}
    while len(out) < max_pieces:
        open_ = need & ~covered
        # ignore pinholes: a cell whose 8 neighbours are mostly covered is left to the overlap
        nb = sum(np.roll(np.roll(covered, dj, 0), di, 1).astype(int) for dj in (-1, 0, 1) for di in (-1, 0, 1)) - covered
        open_ &= nb < 6
        js, is_ = np.nonzero(open_)
        if len(js) == 0:
            break
        ys = g.ys[js] + rng.random() * 0.0
        k = int(np.argmin(ys + np.array([rng.uniform(0, 1.6) for _ in range(len(js))])))
        z, y = float(g.zs[is_[k]]), float(g.ys[js[k]])
        kind = choose_kind(z, y, rng)
        pc = lo[kind]
        zc = z + rng.uniform(-0.25, 0.25) * pc.W * KIND[kind][0][0]
        pl = Placement(kind, zc, y - rng.uniform(0.6, 1.4), rng, ref, pc)
        out.append(pl)
        # mark what this piece covers: east-facing triangles' (z, y) footprint
        W = pl.world(pc, ref)
        for (a, b, c) in pc.tris:
            pa, pb, pc_ = W[a], W[b], W[c]
            n = (pb - pa).cross(pc_ - pa)
            if pl.flip:
                n = -n
            if n.length < 1e-9 or n.x / n.length < 0.05:
                continue
            P = [(-q.y, q.z) for q in (pa, pb, pc_)]
            i0 = max(0, int(math.floor((min(p[0] for p in P) - g.z0) / g.step)))
            i1 = min(g.nz - 1, int(math.ceil((max(p[0] for p in P) - g.z0) / g.step)))
            j0 = max(0, int(math.floor((min(p[1] for p in P) - g.y0) / g.step)))
            j1 = min(g.ny - 1, int(math.ceil((max(p[1] for p in P) - g.y0) / g.step)))
            (z1, y1), (z2, y2), (z3, y3) = P
            den = (y2 - y3) * (z1 - z3) + (z3 - z2) * (y1 - y3)
            if abs(den) < 1e-9:
                continue
            for j in range(j0, j1 + 1):
                yy = g.ys[j]
                for i in range(i0, i1 + 1):
                    zz = g.zs[i]
                    l1 = ((y2 - y3) * (zz - z3) + (z3 - z2) * (yy - y3)) / den
                    l2 = ((y3 - y1) * (zz - z3) + (z1 - z3) * (yy - y3)) / den
                    if l1 >= -0.02 and l2 >= -0.02 and l1 + l2 <= 1.02:
                        covered[j, i] = True
    log(f"scan pieces placed: {len(out)}; uncovered cells left {int((need & ~covered).sum())} of {int(need.sum())}")
    return out


# ============================================================================================ the assembly ==
class Assembly:
    """Accumulates triangles (Blender coords) with per-corner UV0, a material slot, and builds the mesh."""

    def __init__(self):
        self.v, self.t, self.uv, self.mi = [], [], [], []

    def add(self, verts, tris, uvs, mi):
        b = len(self.v)
        self.v += verts
        for tri, uv in zip(tris, uvs):
            self.t.append((b + tri[0], b + tri[1], b + tri[2]))
            self.uv.append(uv)
            self.mi.append(mi)

    def mesh(self, name, mats, keep=None):
        bm = bmesh.new()
        used = sorted({k for i, t in enumerate(self.t) if keep is None or keep[i] for k in t})
        remap = {}
        for k in used:
            remap[k] = bm.verts.new(self.v[k])
        bm.verts.ensure_lookup_table()
        uv0 = bm.loops.layers.uv.new("UVMap")
        uv2 = bm.loops.layers.uv.new("UV2")
        for i, t in enumerate(self.t):
            if keep is not None and not keep[i]:
                continue
            try:
                f = bm.faces.new([remap[k] for k in t])
            except ValueError:
                continue                     # duplicate face (coincident pieces): drop
            f.material_index = self.mi[i]
            f.smooth = True
            for lp, uv in zip(f.loops, self.uv[i]):
                lp[uv0].uv = uv
                co = lp.vert.co
                lp[uv2].uv = ((-co.y - UV2_Z[0]) / (UV2_Z[1] - UV2_Z[0]), (co.z - UV2_Y[0]) / (UV2_Y[1] - UV2_Y[0]))
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        for m in mats:
            me.materials.append(m)
        me.update()
        return bpy.data.objects.new(name, me)


def chord_out(a, b, c):
    """A flat triangle whose corners are clamped can still bridge the concave groove / alcove in front of face_x (and a
    big closing-cap triangle can cross a zone without a corner in it): test a lattice of points (~0.4 m apart) in the
    restricted zones."""
    zs = (-a.y, -b.y, -c.y)
    z0, z1 = min(zs), max(zs)
    zl = F.LIP["z"]
    if z1 < min(F.CHANNEL_Z_TOP, zl) - GROOVE_BAND - 1.0 - PLUNGE_HALF or z0 > max(F.CHANNEL_Z_TOP, zl) + GROOVE_BAND + 1.0 + PLUNGE_HALF:
        return False
    L = max((a - b).length, (b - c).length, (c - a).length)
    n = max(6, min(40, int(L / 0.25) + 1))
    for i in range(n + 1):
        for j in range(n + 1 - i):
            p = a * (i / n) + b * (j / n) + c * (1 - (i + j) / n)
            z, y = -p.y, p.z
            if restricted(z, y) and p.x > F.face_x(z, y) - 0.25 and p.x > min(
                    F.face_x(z + dz_, y + dy_) for dz_, dy_ in ((0, 0), (0, 0.15), (0, -0.15), (0, 0.3), (0, -0.3),
                                                                 (0.1, 0), (-0.1, 0), (0.2, 0), (-0.2, 0))) - 0.005:
                return True
    return False


def facing_west(a, b, c, flip):
    n = (b - a).cross(c - a)
    if flip:
        n = -n
    return n.length > 1e-12 and n.x / n.length < -0.75


def piece_tris(pl, piece, ref, floor_fn):
    """World vertices (clamped) and the triangles kept (not buried below the floor)."""
    W = pl.world(piece, ref)
    for w in W:
        gz, gy = -w.y, w.z
        lim = limit_x(gz, gy)
        if w.x > lim:
            w.x = lim
    tris, uvs = [], []
    for t, uv in zip(piece.tris, piece.uv):
        if all(W[k].z < floor_fn(W[k].x, -W[k].y) - 0.35 for k in t):
            continue
        if chord_out(W[t[0]], W[t[1]], W[t[2]]) or facing_west(W[t[0]], W[t[1]], W[t[2]], pl.flip):
            continue
        tris.append((t[0], t[2], t[1]) if pl.flip else t)
        uvs.append((uv[0], uv[2], uv[1]) if pl.flip else uv)
    return W, tris, uvs


def _fill(a, b, step):
    n = max(1, int(math.ceil((b - a) / step)))
    return [a + (b - a) * k / n for k in range(n + 1)]


def _thin(lst, lo, hi, gap=0.12):
    out = []
    for v in sorted(round(v, 4) for v in lst if lo <= v <= hi):
        if out and v - out[-1] <= gap:
            continue
        out.append(v)
    return out


STRIP_Z = (min(F.CHANNEL_Z_TOP, F.LIP["z"]) - 4.6, max(F.CHANNEL_Z_TOP, F.LIP["z"]) + 4.6)
STRIP_Y0 = F.LEDGE - 1.2


def base_grids(lod):
    """Two tensor grids of the backing face: a coarse one everywhere (its cells inside the groove strip dropped) and a
    dense one over the groove strip (where the backing face is W2's surface): [(zs, ys, in_strip_cell_rule)]."""
    zA, zB = F.FACE_Z
    yA, yB = F.FACE_Y
    if lod == 0:
        cz, cy = _fill(zA, zB, 1.6), _fill(yA, yB, 1.6)
        sz, sy = _fill(*STRIP_Z, 0.4), _fill(STRIP_Y0, yB, 0.45)
        sy += [h + o for h in F.CASCADE_LEDGES for o in (-0.05, 0.1, 0.25)]
    else:
        cz, cy = _fill(zA, zB, 3.0), _fill(yA, yB, 3.0)
        sz, sy = _fill(*STRIP_Z, 0.9), _fill(STRIP_Y0, yB, 0.9)
        sy += [h + 0.1 for h in F.CASCADE_LEDGES]
    cz += list(STRIP_Z)
    cy += [STRIP_Y0]
    return [(_thin(cz, zA, zB), _thin(cy, yA, yB), "coarse"), (_thin(sz, *STRIP_Z), _thin(sy, STRIP_Y0, yB, 0.08), "strip")]


def in_strip(z, y):
    return STRIP_Z[0] < z < STRIP_Z[1] and y > STRIP_Y0


# =============================================================================================== bake maps ==
def raycast_maps(objs, res_z, res_y, x_from=-90.0):
    """Orthographic raycast from the east over UV2's (z, y) square: front x, normal (Blender), hit, object index."""
    verts, polys, owner = [], [], []
    for oi, ob in enumerate(objs):
        M = ob.matrix_world
        b = len(verts)
        verts += [M @ v.co for v in ob.data.vertices]
        for p in ob.data.polygons:
            polys.append(tuple(b + i for i in p.vertices))
            owner.append((oi, p.material_index))
    bvh = BVHTree.FromPolygons(verts, polys)
    D = np.full((res_y, res_z), np.nan)
    N = np.zeros((res_y, res_z, 3))
    MI = np.full((res_y, res_z), -1, np.int32)
    dz = (UV2_Z[1] - UV2_Z[0]) / res_z
    dy = (UV2_Y[1] - UV2_Y[0]) / res_y
    d = Vector((-1.0, 0.0, 0.0))
    for j in range(res_y):
        y = UV2_Y[0] + (j + 0.5) * dy
        for i in range(res_z):
            z = UV2_Z[0] + (i + 0.5) * dz
            loc, nrm, idx, _ = bvh.ray_cast(Vector((x_from, -z, y)), d, 80.0)
            if loc is not None:
                D[j, i] = loc.x
                N[j, i] = nrm
                MI[j, i] = owner[idx][0] * 100 + owner[idx][1]
    return D, N, MI, bvh


def upsample(a, shape):
    """Bilinear resize of a coarse 2D (or 2D x C) array."""
    h, w = a.shape[:2]
    H, W = shape
    yy = (np.arange(H) + 0.5) * h / H - 0.5
    xx = (np.arange(W) + 0.5) * w / W - 0.5
    y0 = np.clip(np.floor(yy).astype(int), 0, h - 1)
    x0 = np.clip(np.floor(xx).astype(int), 0, w - 1)
    y1 = np.clip(y0 + 1, 0, h - 1)
    x1 = np.clip(x0 + 1, 0, w - 1)
    ty = np.clip(yy - y0, 0, 1)[:, None]
    tx = np.clip(xx - x0, 0, 1)[None, :]
    if a.ndim == 3:
        ty, tx = ty[..., None], tx[..., None]
    return (a[y0][:, x0] * (1 - tx) + a[y0][:, x1] * tx) * (1 - ty) + (a[y1][:, x0] * (1 - tx) + a[y1][:, x1] * tx) * ty


def save_rgb(a, path):
    h, w = a.shape[:2]
    im = bpy.data.images.new("macro_out", w, h, alpha=False, float_buffer=False)
    im.colorspace_settings.name = "Non-Color"
    px = np.ones((h, w, 4), np.float32)
    px[..., :3] = np.clip(a, 0, 1)
    im.pixels.foreach_set(px.ravel())
    im.filepath_raw = path
    im.file_format = "PNG"
    im.save()
    bpy.data.images.remove(im)
