"""B1 waterfall, W1: geometry parts for the rock and the plants (called by build_waterfall.py, run inside Blender;
the joint layout and face_x_detailed are pure Python so make_falls_textures.py can use them without Blender).

Everything here is built from falls_shape (imported, never copied). Round 3 (2026-11-16, strong model):

  COLUMNAR JOINT LAYOUT   the face is partitioned into a few big granite blocks: 5 tiers between strong horizontal
                          levels (the pool foot, the 9.6 m bench, the 17 m ledge, the 27.6 m bench, the 36 m top, the
                          rim), each tier cut by long straight vertical joints 2-8 m apart (photo 05), some tiers split
                          again by minor horizontal joints (photo 12's sheet steps). Each block is ONE PLANE fitted to
                          face_x over the block, moved out/in and tilted a little, with a planar chamfer on its edges
                          and a narrow V crack between blocks. No noise inside a block: the fine relief lives in the
                          macro height/normal map (make_falls_textures.py), not in the geometry.
  face_x_detailed         face_x + (block plane - face_x) x weight, clamped: 0.5 m off the camera wall, exactly face_x
                          in the upper-cascade groove (W2's film), only cut inward where the plunge falls.
  block_mesh(kind, seed)  rock kit k = 0..6: broken column fragments (talus), rounded riprap, flat stepping rock,
                          river boulders
  slab_mesh / seat_mesh   the walkable flat rocks and the 2 stone seats (flat tops at the contract heights)
  Leaves + card plants    alpha-cut card foliage on T_falls_foliage (spray / fern / grass / hanging quadrants) and
                          card-crowned broadleaf trees on the village's T_leaf_green (M_leaf_green), outward normals
"""
import bisect
import math
import random

try:
    import bmesh
    import bpy
    from mathutils import Vector
except ImportError:              # system python: layout + face_x_detailed only
    bmesh = bpy = Vector = None

import falls_shape as F

# ================================================================================= columnar joint layout ==
TIERS = (F.FACE_Y[0], 9.6, F.LEDGE, 27.6, F.TOP, F.FACE_Y[1])        # strong horizontal levels (y, m)
MINOR = ((3.0, 6.3), (13.3,), (20.6, 24.4), (31.8,), (38.6,))        # minor joints per tier (active per column)
MINOR_P = (0.12, 0.1, 0.12, 0.15, 0.1)
COL_W = ((1.9, 3.8), (2.2, 4.3), (2.8, 5.6), (3.3, 6.6), (4.5, 8.0))  # column widths per tier (m)
CONTINUE_P = (0.6, 0.92, 0.5, 0.4)                                  # a joint carries on into the tier above
CRACK_D = 0.06            # half-width of the V of a crack (m)
CHAMFER_Z = 0.30          # bevel on a column's vertical edge
CHAMFER_Y = 0.22          # bevel on a block's horizontal edge
PLUNGE_HALF = 7.5
GROOVE_FREE = 2.4         # |z - channel z| from which the blocks show beside the groove (cut inward only below 3.8)         # |z - lip z| inside which the blocks are cut back behind face_x (below the ledge)


class Block:
    __slots__ = ("z0", "z1", "y0", "y1", "zc", "yc", "a", "b", "c", "ez", "ey", "ck_l", "ck_r", "ck_b", "ck_t",
                 "zr", "kr", "yr", "ky",
                 "tier", "col", "lum", "tint")

    def plane(self, z, y):
        """The block's faces: its plane, folded along a vertical ridge (a column's corner: two facets meeting at zr)
        and leaning back above yr (a slab top), without the bevels."""
        x = self.a + self.b * (z - self.zc) + self.c * (y - self.yc)
        if self.kr:
            x -= self.kr * (abs(z - self.zr) - 0.25 * (self.z1 - self.z0))
        if self.ky and y > self.yr:
            x -= self.ky * (y - self.yr)
        return x

    def x(self, z, y):
        """The block's surface x at (z, y) (no weights, no clamps)."""
        x = self.plane(z, y)
        dl, dr = z - self.z0, self.z1 - z
        db, dt = y - self.y0, self.y1 - y
        drop = 0.0
        for d, ck, chamf, e in ((dl, self.ck_l, CHAMFER_Z, self.ez), (dr, self.ck_r, CHAMFER_Z, self.ez),
                                (db, self.ck_b, CHAMFER_Y, self.ey), (dt, self.ck_t, CHAMFER_Y, self.ey)):
            if ck is None or d >= chamf:
                continue
            if d >= CRACK_D:
                dd = e * (chamf - d) / (chamf - CRACK_D)
            else:
                dd = e + ck * (CRACK_D - max(d, 0.0)) / CRACK_D
            drop = max(drop, dd)
        return x - drop


def _solve3(m, r):
    """Solve the 3x3 system m.x = r (Cramer)."""
    def det(a):
        return (a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
                + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]))
    d = det(m)
    out = []
    for k in range(3):
        mk = [row[:] for row in m]
        for i in range(3):
            mk[i][k] = r[i]
        out.append(det(mk) / d)
    return out


def _fit(z0, z1, y0, y1, n=5):
    zc, yc = 0.5 * (z0 + z1), 0.5 * (y0 + y1)
    m = [[0.0] * 3 for _ in range(3)]
    r = [0.0] * 3
    pts = []
    for i in range(n):
        z = z0 + 0.12 + (z1 - z0 - 0.24) * i / (n - 1)
        for j in range(n):
            y = y0 + 0.12 + (y1 - y0 - 0.24) * j / (n - 1)
            x = F.face_x(z, y)
            pts.append((z, y, x))
            v = (1.0, z - zc, y - yc)
            for p in range(3):
                r[p] += v[p] * x
                for q in range(3):
                    m[p][q] += v[p] * v[q]
    a, b, c = _solve3(m, r)
    return zc, yc, a, b, c, pts


_LAYOUT = None


def layout():
    """The joint layout: {"tiers": [(y0, y1, cuts[z...], cols[[Block...] per column])], "blocks": [Block]}."""
    global _LAYOUT
    if _LAYOUT is not None:
        return _LAYOUT
    rng = random.Random(F.SEED * 7 + 3)
    zA, zB = F.FACE_Z
    tiers, blocks = [], []
    prev_cuts = []
    for t in range(len(TIERS) - 1):
        y0, y1 = TIERS[t], TIERS[t + 1]
        wlo, whi = COL_W[t]
        cuts = []
        # joints carried on from the tier below (long straight cracks through several tiers)
        carried = [c for c in prev_cuts if rng.random() < (CONTINUE_P[t - 1] if t > 0 else 0)]
        z = zA
        while True:
            nxt = [c for c in carried if c > z + wlo * 0.7]
            step = rng.uniform(wlo, whi)
            cand = z + step
            if nxt and nxt[0] < cand + wlo * 0.5:
                cand = nxt[0]
            if cand > zB - wlo * 0.6:
                break
            cuts.append(round(cand, 3))
            z = cand
        prev_cuts = cuts
        edges = [zA] + cuts + [zB]
        cols = []
        for ci in range(len(edges) - 1):
            cz0, cz1 = edges[ci], edges[ci + 1]
            joints = [y0] + [m for m in MINOR[t] if rng.random() < MINOR_P[t]] + [y1]
            col = []
            for k in range(len(joints) - 1):
                b = Block()
                b.z0, b.z1, b.y0, b.y1 = cz0, cz1, joints[k], joints[k + 1]
                b.tier, b.col = t, ci
                zc, yc, a, bz, cy, pts = _fit(cz0, cz1, b.y0, b.y1)
                b.zc, b.yc = zc, yc
                # move each block out or in as a whole and tilt it a little: the columns stand at different depths
                big = rng.random() < 0.16
                b.a = a + (rng.uniform(-0.55, 0.45) if big else rng.uniform(-0.12, 0.12)) * (1.0 if t < 4 else 0.5)
                b.b = bz + rng.uniform(-0.06, 0.06)
                b.c = cy + rng.uniform(-0.03, 0.05)
                w_ = cz1 - cz0
                b.kr, b.zr = 0.0, zc
                if w_ > 1.6 and rng.random() < 0.65:
                    b.kr = rng.uniform(0.07, 0.28)
                    b.zr = round(cz0 + w_ * rng.uniform(0.3, 0.7), 3)
                b.ky, b.yr = 0.0, b.y1
                h_ = b.y1 - b.y0
                if t >= 2 and h_ > 2.5 and rng.random() < 0.25:
                    b.ky = rng.uniform(0.2, 0.45)
                    b.yr = round(b.y0 + h_ * rng.uniform(0.45, 0.75), 3)
                # below the ledge beside the plunge: push the plane behind face_x (cut inward only)
                if b.y0 < F.LEDGE + 1.5 and min(abs(cz0 - F.LIP["z"]), abs(cz1 - F.LIP["z"]),
                                                0 if cz0 < F.LIP["z"] < cz1 else 99) < PLUNGE_HALF:
                    worst = max(b.plane(pz, py) - px for (pz, py, px) in pts
                                if abs(pz - F.LIP["z"]) < PLUNGE_HALF and py < F.LEDGE + 0.4) \
                        if any(abs(pz - F.LIP["z"]) < PLUNGE_HALF and py < F.LEDGE + 0.4 for (pz, py, px) in pts) else 0.0
                    if worst > -0.05:
                        b.a -= worst + 0.05
                b.ez = rng.uniform(0.0, 0.08) if rng.random() < 0.8 else rng.uniform(0.1, 0.22)
                b.ey = rng.uniform(0.0, 0.08)
                b.lum = rng.uniform(-1.0, 1.0)
                b.tint = rng.uniform(-1.0, 1.0)
                col.append(b)
                blocks.append(b)
            cols.append(col)
        tiers.append((y0, y1, cuts, cols))
    # cracks: depth per joint (shared by the two blocks on either side), none on the outer edge of the face
    def ckz(z, t):
        return 0.1 + 0.7 * F._hash2(int(round(z * 100)), t, 41) ** 1.5
    for (y0, y1, cuts, cols) in tiers:
        for ci, col in enumerate(cols):
            for k, b in enumerate(col):
                b.ck_l = ckz(b.z0, b.tier) if ci > 0 else None
                b.ck_r = ckz(b.z1, b.tier) if ci < len(cols) - 1 else None
                b.ck_b = 0.12 + 0.25 * F._hash2(int(round(b.y0 * 100)), int(round(b.zc * 10)), 43) if b.y0 > F.FACE_Y[0] + 0.1 else None
                b.ck_t = 0.12 + 0.25 * F._hash2(int(round(b.y1 * 100)), int(round(b.zc * 10)), 43) if b.y1 < F.FACE_Y[1] - 0.1 else None
    # long columns: across the 17 m ledge (no bench there) a column whose two joints both carry on is ONE block
    # (same plane, no horizontal joint), away from the plunge
    lower = {(b.z0, b.z1): b for b in blocks if b.tier == 1 and abs(b.y1 - F.LEDGE) < 1e-6}
    for b in blocks:
        if b.tier != 2 or abs(b.y0 - F.LEDGE) > 1e-6:
            continue
        lo = lower.get((b.z0, b.z1))
        if lo is None or min(abs(b.z0 - F.LIP["z"]), abs(b.z1 - F.LIP["z"])) < PLUNGE_HALF + 1.0 or b.z0 < F.LIP["z"] < b.z1:
            continue
        if rng.random() > 0.92:
            continue
        b.b, b.c = lo.b, lo.c
        b.a = lo.a + lo.c * (b.yc - lo.yc) + lo.b * (b.zc - lo.zc)
        b.kr, b.zr = lo.kr, lo.zr
        if lo.kr:
            b.a += 0.0
        lo.ky = 0.0
        lo.ck_t = None
        b.ck_b = None
        b.ez, b.lum, b.tint = lo.ez, lo.lum, lo.tint
    _LAYOUT = {"tiers": tiers, "blocks": blocks}
    return _LAYOUT


def blocks_at(z, y, eps=1e-4):
    """Blocks whose rectangle holds (z, y) (two or more on a joint line)."""
    L = layout()
    out = []
    for (y0, y1, cuts, cols) in L["tiers"]:
        if y < y0 - eps or y > y1 + eps:
            continue
        ci = bisect.bisect_right(cuts, z)
        for cc in (ci - 1, ci, ci + 1):
            if 0 <= cc < len(cols):
                for b in cols[cc]:
                    if b.z0 - eps <= z <= b.z1 + eps and b.y0 - eps <= y <= b.y1 + eps:
                        out.append(b)
    return out


def block_surface(z, y):
    bs = blocks_at(z, y)
    if not bs:
        return None
    return min(b.x(z, y) for b in bs)


def detail_weight(z, y):
    """How much of the block relief applies at (z, y): full on the bare rock, fading onto the wooded flanks, none in
    the upper-cascade groove (W2 wraps the film on the plain face_x)."""
    a = abs(z - F.FZ)
    w = F.smooth(F.FLANK_FULL - 1.0, F.FLANK_START + 3.0, a) * 0.9 + 0.1 * F.smooth(F.FLANK_FULL + 2.0, F.FLANK_FULL - 2.0, a)
    if y > F.LEDGE - 0.6:
        dz = abs(z - F.channel_z(y))
        w *= F.smooth(GROOVE_FREE, GROOVE_FREE + 1.2, dz)
    w *= F.smooth(F.FACE_Y[0], F.FACE_Y[0] + 1.2, y) * F.smooth(F.PLATEAU_Y + 1.5, F.PLATEAU_Y - 2.5, y)
    return w


def face_x_detailed(z, y):
    """face_x + block relief, clamped: never closer than 0.5 m to the camera wall, never out of the rock where the
    plunge or its side strands fall (|z - lip z| < 6, y below the ledge; ramps to free over 1.5 m)."""
    base = F.face_x(z, y)
    w = detail_weight(z, y)
    cap = F.camera_wall_x(z) - 0.5 - base
    if w <= 0.0:
        return base + min(0.0, cap)
    bx = block_surface(z, y)
    if bx is None:
        return base + min(0.0, cap)
    d = bx - base
    dzp = abs(z - F.LIP["z"])
    if y < F.LEDGE + 1.5 and dzp < PLUNGE_HALF:
        dmax = 4.0 * max(F.smooth(6.0, PLUNGE_HALF, dzp), F.smooth(F.LEDGE + 0.4, F.LEDGE + 1.5, y))
        d = min(d, dmax)
    if y > F.LEDGE - 0.6 and abs(z - F.channel_z(y)) < GROOVE_FREE + 1.4:
        d = min(d, 0.0)                               # beside W2's film: only cut back, never over it
    d *= w
    return base + min(d, cap)


def grid_lines(lod):
    """Structured grid lines of the face mesh: (zs, ys, zkind, ykind). Every crack and joint gets its own lines (so the
    cracks are straight and the bevels planar), plus fill lines where the surface is curved (groove, alcove, flanks).
    kind: 0 = bevel / crack-side offset, 1 = centre-zone fill, 2 = base fill, 3 = crack or joint centre. Where the
    surface is curved (no block relief) the build dissolves the kind-0 lines, and kind-1 rows away from the falls."""
    L = layout()
    zA, zB = F.FACE_Z
    yA, yB = F.FACE_Y
    zl, yl = [], []
    offs_z = (-CRACK_D, CRACK_D, -CHAMFER_Z, CHAMFER_Z) if lod == 0 else (-CHAMFER_Z, CHAMFER_Z)
    offs_y = (-CRACK_D, CRACK_D, -CHAMFER_Y, CHAMFER_Y) if lod == 0 else (-CHAMFER_Y, CHAMFER_Y)
    for (y0, y1, cuts, cols) in L["tiers"]:
        for c in cuts:
            zl.append((c, 3))
            zl += [(c + o, 0) for o in offs_z]
        for col in cols:
            for b in col:
                for yy in (b.y0, b.y1):
                    if yA < yy < yB:
                        yl.append((yy, 3))
                        yl += [(yy + o, 0) for o in offs_y]
                if b.kr and lod == 0:
                    zl.append((b.zr, 3))
                if b.ky and lod == 0:
                    yl.append((b.yr, 3))

    def fill(lst, a, b, step, kind):
        n = max(1, int(math.ceil((b - a) / step)))
        lst += [(a + (b - a) * k / n, kind) for k in range(n + 1)]
    if lod == 0:
        fill(zl, zA, zB, 1.3, 2)
        fill(zl, F.FZ - 6.6, F.FZ + 6.6, 0.45, 2)                 # groove + alcove + plunge ramp
        fill(zl, F.FZ - 21.0, F.FZ - 13.0, 0.9, 2)                # flank blends
        fill(zl, F.FZ + 13.0, min(zB, F.FZ + 21.0), 0.9, 2)
        fill(yl, yA, yB, 1.0, 2)
        fill(yl, yA, F.LEDGE + 1.6, 0.5, 1)                       # alcove
        fill(yl, F.LEDGE - 0.6, F.PLATEAU_Y + 2.6, 0.6, 1)        # groove, rim roll
        yl += [(h + o, 1) for h in F.CASCADE_LEDGES for o in (-0.05, 0.1, 0.25)]
        yl += [(F.LEDGE + o, 1) for o in (-0.9, -0.45, 0.0, 0.45, 0.9)]   # the lip bulge
    else:
        fill(zl, zA, zB, 2.2, 2)
        fill(zl, F.FZ - 6.6, F.FZ + 6.6, 1.0, 2)
        fill(yl, yA, yB, 1.6, 2)
        fill(yl, F.LEDGE - 0.6, F.PLATEAU_Y + 2.6, 1.1, 1)
        yl += [(h + 0.1, 1) for h in F.CASCADE_LEDGES]

    def thin(lst, lo, hi):
        out = []
        for v, k in sorted((round(v, 4), k) for v, k in lst if lo <= v <= hi):
            if out and v - out[-1][0] <= 0.02:
                if k > out[-1][1]:
                    out[-1] = (v, k)
                continue
            out.append((v, k))
        return [v for v, _ in out], {v: k for v, k in out}
    zs, zk = thin(zl, zA, zB)
    ys, yk = thin(yl, yA, yB)
    return zs, ys, zk, yk


def ledges(min_depth=0.22, dz=0.7):
    """(x, z, y, depth) points on the tops of the blocks where the block above stands back (plants, moss)."""
    out = []
    L = layout()
    levels = sorted({b.y1 for b in L["blocks"] if F.FACE_Y[0] + 1 < b.y1 < F.TOP + 1.0})
    z = F.FACE_Z[0] + 0.5
    while z < F.FACE_Z[1] - 0.5:
        for yl in levels:
            lo = face_x_detailed(z, yl - 0.35)
            hi = face_x_detailed(z, yl + 0.35)
            if lo - hi > min_depth:
                out.append((lo, z, yl, lo - hi))
        z += dz
    return out


def cracks(step=1.2):
    """(x, z, y) points at the bottom of the vertical joints (plants in the cracks)."""
    out = []
    for (y0, y1, cuts, cols) in layout()["tiers"]:
        for c in cuts:
            y = y0 + 0.6
            while y < y1 - 0.4:
                out.append((face_x_detailed(c, y), c, y))
                y += step
    return out


# ====================================================================================== grid and meshes ==

def _tri_split(verts, a, b, c, d):
    """Split quad (a, b, c, d) along the shorter 3D diagonal -> two triangles."""
    pa, pb, pc, pd = (Vector((verts[k][0], -verts[k][1], verts[k][2])) for k in (a, b, c, d))
    if (pa - pc).length <= (pb - pd).length:
        return [(a, b, c), (a, c, d)]
    return [(a, b, d), (b, c, d)]


def mesh_from(name, verts_bl, faces, mat=None, uv=None, uv2=None, colors=None, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts_bl, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    if mat is not None:
        me.materials.append(mat)
    if uv is not None:
        l = me.uv_layers.new(name="UVMap")
        for p in me.polygons:
            for li in p.loop_indices:
                l.data[li].uv = uv[me.loops[li].vertex_index]
    if uv2 is not None:
        l = me.uv_layers.new(name="UV2")
        for p in me.polygons:
            for li in p.loop_indices:
                l.data[li].uv = uv2[me.loops[li].vertex_index]
    if colors is not None:
        ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
        for i, c in enumerate(colors):
            ca.data[i].color = c
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    return ob


def Vb(x, z, y):
    """game (x, z, y) -> Blender (x, -z, y)."""
    return (x, -z, y)


def box_uv(me, tile=4.0, off=(0.31, 0.0)):
    """UV0 by face: each face projected along its main axis (no stretched texture on the crack walls and steps)."""
    uv = me.uv_layers["UVMap"]
    for p in me.polygons:
        n = p.normal
        ax = max(range(3), key=lambda k: abs(n[k]))
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if ax == 0:
                u, v = -co.y, co.z
            elif ax == 1:
                u, v = co.x + 0.17, co.z
            else:
                u, v = co.x + 0.53, -co.y
            uv.data[li].uv = (u / tile + off[0], v / tile + off[1])


def planarize(me, angle_deg=0.6):
    """Merge the coplanar faces of a grid mesh (the flat block faces and bevels) into n-gons, then triangulate.
    Positions, UVs and the 'Col' masks are linear on the remaining corners."""
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(angle_deg), use_dissolve_boundaries=False,
                             verts=bm.verts[:], edges=bm.edges[:], delimit=set())
    bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method="BEAUTY", ngon_method="BEAUTY")
    bm.to_mesh(me)
    bm.free()
    me.update()


# ======================================================================================== rock kit ==

KIT = {
    # kind: half-sizes (x = out of the cliff, y = up, z = along), label
    0: dict(h=(1.0, 0.5, 1.4), label="flat column fragment"),
    1: dict(h=(0.75, 1.3, 0.7), label="standing column piece"),
    2: dict(h=(0.95, 0.8, 1.0), label="blocky fragment"),
    3: dict(h=(1.25, 0.55, 0.9), label="wedge / leaning flake"),
    4: dict(h=(1.0, 0.7, 1.1), label="rounded riprap boulder"),
    5: dict(h=(1.35, 0.30, 1.10), label="flat stepping rock"),
    6: dict(h=(1.0, 0.72, 1.0), label="rounded river boulder"),
}


def orient(me, target):
    """Flip all faces if, on average, they face away from `target` (Blender-space direction): the exported mesh is
    backface-culled by the runtime, so the winding must be right."""
    t = Vector(target)
    tot = sum(p.normal.dot(t) * p.area for p in me.polygons)
    if tot < 0:
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        me.update()
    return tot >= 0


def sharpen(me, deg):
    """Smooth shading with hard (sharp) edges where the dihedral angle exceeds deg: granite facets keep their creases."""
    bm = bmesh.new()
    bm.from_mesh(me)
    thr = math.radians(deg)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > thr:
            e.smooth = False
    bm.to_mesh(me)
    bm.free()


def block_mesh(kind, seed, mat):
    """One rock of the kit.
      0-3: a broken granite column fragment: a box with chamfered edges, cut by 2-3 random fracture planes (big flat
           faces, crisp edges; ~60-120 triangles);
      4, 6: a rounded, water-worn boulder (oblate, smooth-shaded subdivided icosphere with low lumps, 80 triangles);
      5: a flat stepping rock (rounded slab).
    UV0 = local box projection, 3.0 m tile, random offset; 'Col' R moss (up-facing), G wet (low), B streak, A lichen."""
    k = KIT[kind]
    rng = random.Random(seed * 977 + kind * 31)
    sx, sy, sz = k["h"]
    bm = bmesh.new()
    if kind in (0, 1, 2, 3):
        ch = 0.14
        pts = []
        for ix in (-1, 1):
            for iy in (-1, 1):
                for iz in (-1, 1):
                    c = Vector((ix * sx, iz * sz, iy * sy))
                    for ax in range(3):
                        p = c.copy()
                        p[ax] -= (ix, iz, iy)[ax] * ch * (sx, sz, sy)[ax] * rng.uniform(0.6, 1.2)
                        pts.append(p)
        vs = [bm.verts.new(p) for p in pts]
        bmesh.ops.convex_hull(bm, input=vs, use_existing_faces=False)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
        for _ in range(3 if kind != 1 else 2):
            n = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.6, 1.0))).normalized()
            ext = abs(n.x) * sx + abs(n.y) * sz + abs(n.z) * sy
            co = n * ext * rng.uniform(0.55, 0.8)
            res = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-5, plane_co=co,
                                         plane_no=n, clear_outer=True)
            cut = [e for e in res["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
            if cut:
                bmesh.ops.holes_fill(bm, edges=cut, sides=0)
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    elif kind in (4, 6):
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
        ph = rng.uniform(0, 40)
        for v in bm.verts:
            n = v.co.normalized()
            lump = 1.0 + 0.10 * F.noise3(n.x * 1.6 + ph, n.y * 1.6, n.z * 1.6) + (0.07 * F.noise3(n.x * 3.3, n.y * 3.3 + ph, n.z * 3.3) if kind == 4 else 0.0)
            flat = 1.0 - 0.25 * max(0.0, -n.z) ** 2          # flatter underside
            v.co = Vector((n.x * sx * lump, n.y * sz * lump, n.z * sy * lump * flat))
    else:
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
        for v in bm.verts:
            n = v.co.normalized()
            top = min(1.0, max(n.z, -0.6))
            v.co = Vector((n.x * sx, n.y * sz, (0.35 if n.z > 0.3 else 1.0) * top * sy * (1.0 + 0.05 * F.noise3(n.x * 2, n.y * 2, 3.3))))
    bm.normal_update()
    me = bpy.data.meshes.new(f"falls_kit_{kind}")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(f"falls_kit_{kind}", me)
    me.materials.append(mat)
    off = (rng.random() * 5, rng.random() * 5)
    uv = me.uv_layers.new(name="UVMap")
    ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    for p in me.polygons:
        n = p.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if ax == 2:
                u, v_ = co.x, co.y
            elif ax == 0:
                u, v_ = co.y, co.z
            else:
                u, v_ = co.x, co.z
            uv.data[li].uv = (u / 3.0 + off[0], v_ / 3.0 + off[1])
    zmin = min(v.co.z for v in me.vertices)
    for i, v in enumerate(me.vertices):
        n = v.normal
        moss = F.smooth(0.55, 0.92, n.z) * (0.35 + 0.45 * F.noise3(v.co.x * 3, v.co.y * 3, 1.1 + kind)) + 0.25 * F.smooth(0.3, 0.0, v.co.z - zmin)
        wet = F.smooth(zmin + 0.45, zmin, v.co.z) * 0.8
        streak = F.smooth(0.5, 0.15, abs(n.z)) * max(0.0, F.fbm(v.co.x * 3.0, v.co.y * 3.0, v.co.z * 0.5 + seed, 3)) * 1.1
        lich = max(0.0, F.noise3(v.co.x * 1.7, v.co.y * 1.7, v.co.z * 1.7 + 9)) * 0.9
        ca.data[i].color = (min(1, moss), min(1, wet), min(1, streak), min(1, lich))
    if kind in (4, 5, 6):
        me.shade_smooth()
    else:
        sharpen(me, 30)
    return ob


def block_world_points(ob_kit, loc, rot_z, rot_y_tilt, scale):
    """The kit's vertices placed in the world (Blender) for validation."""
    from mathutils import Euler, Matrix
    m = Matrix.Translation(loc) @ Euler((0, rot_y_tilt, rot_z)).to_matrix().to_4x4() @ Matrix.Diagonal((scale[0], scale[1], scale[2], 1.0))
    return [m @ v.co for v in ob_kit.data.vertices]


# ====================================================================================== slabs & seats ==

def slab_mesh(s, mat, seed):
    """A flat granite slab: irregular outline (radiusX/radiusZ of the contract, rotated by yaw), flat top at s['top']
    (+-3 mm), rounded broken edge, sides running down into the gravel. Faces ~ 500."""
    rng = random.Random(seed)
    n = 40
    c, sn = math.cos(s["yaw"]), math.sin(s["yaw"])
    ph = [rng.uniform(0, 6.28) for _ in range(4)]
    ring0 = []
    for k in range(n):
        a = 2 * math.pi * k / n
        j = 1.0 + 0.06 * math.sin(2 * a + ph[0]) + 0.05 * math.sin(3 * a + ph[1]) + 0.03 * math.sin(5 * a + ph[2]) + 0.015 * math.sin(9 * a + ph[3])
        ring0.append((s["radiusX"] * math.cos(a) * j, s["radiusZ"] * math.sin(a) * j))

    def w(lx, lz):
        return (s["centre"]["x"] + lx * c + lz * sn, s["centre"]["z"] - lx * sn + lz * c)
    top = s["top"]
    prof = [(0.0, top), (0.55, top), (0.86, top - 0.004), (0.97, top - 0.025), (1.0, top - 0.07), (1.02, top - 0.16), (1.04, -0.55)]
    verts, faces = [], []
    ring_idx = []
    verts.append(Vb(*w(0, 0), top))
    for (sc_, h) in prof[1:]:
        idx = []
        for k in range(n):
            lx, lz = ring0[k]
            nz = F.noise3(lx * 1.3 + seed, lz * 1.3, 1.0) * (0.003 if sc_ <= 0.9 else 0.008)
            x, z = w(lx * sc_, lz * sc_)
            idx.append(len(verts))
            verts.append(Vb(x, z, h + (nz if h > top - 0.1 else 0.0)))
        ring_idx.append(idx)
    for k in range(n):
        faces.append((0, ring_idx[0][k], ring_idx[0][(k + 1) % n]))
    for r in range(len(ring_idx) - 1):
        for k in range(n):
            faces.append((ring_idx[r][k], ring_idx[r + 1][k], ring_idx[r + 1][(k + 1) % n], ring_idx[r][(k + 1) % n]))
    me = bpy.data.meshes.new(s["id"])
    me.from_pydata(verts, [], [tuple(reversed(f)) for f in faces])
    me.update()
    if me.polygons[0].normal.z < 0:
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
    ob = bpy.data.objects.new(s["id"], me)
    me.materials.append(mat)
    uv = me.uv_layers.new(name="UVMap")
    ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    for p in me.polygons:
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uv.data[li].uv = (co.x / 3.0 + 0.37 * seed, co.y / 3.0)
    for i, v in enumerate(me.vertices):
        edge = F.smooth(0.55, 1.0, math.hypot((v.co.x - s["centre"]["x"]) / s["radiusX"], (v.co.y + s["centre"]["z"]) / s["radiusZ"]))
        lich = max(0.0, F.noise3(v.co.x * 1.1, v.co.y * 1.1, 4.4)) * 0.8
        ca.data[i].color = (0.18 * edge, 0.25 * edge, 0.0, lich)
    me.shade_smooth()
    return ob


def seat_mesh(s, mat, seed):
    """A backless stone seat: a hewn-looking granite block (size x z, flat seat at seatTop), broken edges, a little moss."""
    c = s["centre"]
    hx, hz = s["size"]["x"] / 2, s["size"]["z"] / 2
    top = s["seatTop"]
    bot = -0.2
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * 2 * hx, v.co.y * 2 * hz, v.co.z * (top - bot) + (top + bot) / 2))
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=5, use_grid_fill=True)
    for v in bm.verts:
        px, py, pz = v.co.x / hx, v.co.y / hz, (v.co.z - (top + bot) / 2) / ((top - bot) / 2)
        if abs(px) > 0.85 and abs(py) > 0.85:
            k = 0.16
            v.co.x -= math.copysign(k * hx * (abs(px) - 0.85) / 0.15 * 0.5, px)
            v.co.y -= math.copysign(k * hz * (abs(py) - 0.85) / 0.15 * 0.5, py)
        if pz > 0.92 and (abs(px) > 0.7 or abs(py) > 0.7):
            v.co.z -= 0.035 * (max(abs(px), abs(py)) - 0.7) / 0.3
        if pz > 0.9:
            v.co.z += F.noise3(v.co.x * 2.2 + seed, v.co.y * 2.2, 1.7) * 0.006
        else:
            v.co.x += F.noise3(v.co.y * 2.0 + seed, v.co.z * 2.0, 0.3) * 0.05
            v.co.y += F.noise3(v.co.x * 2.0, v.co.z * 2.0 + seed, 5.5) * 0.06
    bm.normal_update()
    me = bpy.data.meshes.new(s["id"])
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(s["id"], me)
    ob.location = (c["x"], -c["z"], 0.0)
    me.materials.append(mat)
    uv = me.uv_layers.new(name="UVMap")
    ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    for p in me.polygons:
        n = p.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            u, v_ = (co.x, co.y) if ax == 2 else ((co.y, co.z) if ax == 0 else (co.x, co.z))
            uv.data[li].uv = (u / 3.0 + 0.2 * seed, v_ / 3.0)
    for i, v in enumerate(me.vertices):
        low = F.smooth(0.15, -0.1, v.co.z)
        ca.data[i].color = (0.35 * low, 0.3 * low, 0.0, max(0.0, F.noise3(v.co.x * 1.5, v.co.y * 1.5, 8.8)) * 0.7)
    sharpen(me, 50)
    return ob


# =========================================================================================== plants ==
# Alpha-cut cards. T_falls_foliage (make_falls_textures.py) is a 2x2 atlas, each quadrant drawn with its base at the
# bottom centre: spray (broadleaf shrub twig, TL), fern frond (TR), grass/sedge clump (BL), hanging leafy spray (BR).
# Trees use the village's T_leaf_green (2x2 leaf-cluster cards, M_leaf_green), so they match W6's forest round the box.
# Normals are set per vertex (from the plant's centre outward, bent up) so a bush shades as one volume.

FOLIAGE = {"spray": (0.0, 0.5), "fern": (0.5, 0.5), "grass": (0.0, 0.0), "hang": (0.5, 0.0)}


class Leaves:
    """Accumulates card / tube geometry into one mesh (Blender coords). Per-vertex: uv, colour, normal."""

    def __init__(self):
        self.v, self.f, self.uv, self.col, self.nrm, self.fmat = [], [], [], [], [], []

    def _add(self, pts, faces, uvs, cols, nrms=None, mat=0):
        b = len(self.v)
        self.v += [tuple(p) for p in pts]
        self.uv += uvs
        self.col += cols
        self.nrm += nrms if nrms is not None else [None] * len(pts)
        for q in faces:
            self.f.append(tuple(b + i for i in q))
            self.fmat.append(mat)

    def card(self, base, right, up, w, h, cell, tint=(1, 1, 1), nrm=None, bend=0.0, droop=None, segs=1, anchor=0.0,
             cell_size=0.5, mat=0):
        """A card w x h whose bottom centre is `base` (anchor 0; 0.5 = centred), along `up`, bent by `bend` rad per
        segment toward `droop` (default: -up x right). UV: atlas cell (u0, v0) of cell_size."""
        R = Vector(right).normalized()
        U = Vector(up).normalized()
        D = Vector(droop).normalized() if droop is not None else U.cross(R).normalized()
        s = Vector(base) - U * (h * anchor)
        u0, v0 = cell
        pts, uvs, cols, nr = [], [], [], []
        d = U
        for k in range(segs + 1):
            t = k / segs
            for sgn in (-1, 1):
                p = s + R * (sgn * w * 0.5)
                pts.append(p)
                uvs.append((u0 + cell_size * (0.5 + 0.497 * sgn), v0 + cell_size * (0.004 + 0.99 * t)))
                cols.append((tint[0], tint[1], tint[2], 1.0))
                nr.append(Vector(nrm) if nrm is not None else None)
            if k < segs:
                s = s + d * (h / segs)
                ang = bend * (k + 1)
                d = (U * math.cos(ang) + D * math.sin(ang)).normalized()
        faces = [(2 * k, 2 * k + 1, 2 * k + 3, 2 * k + 2) for k in range(segs)]
        self._add(pts, faces, uvs, cols, nr, mat)

    def tube(self, pts, radii, segs, uv_v=1.0, col=(1, 1, 1), mat=0):
        """A tapered tube through pts (bark); UV u around (0..1), v along length * uv_v."""
        rings = []
        verts, uvs, cols = [], [], []
        acc = 0.0
        for i, (p, r) in enumerate(zip(pts, radii)):
            if i > 0:
                acc += (pts[i] - pts[i - 1]).length
            t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            a = t.orthogonal().normalized()
            b = t.cross(a).normalized()
            ring = []
            for k in range(segs + 1):
                th = 2 * math.pi * k / segs
                q = p + (a * math.cos(th) + b * math.sin(th)) * r
                ring.append(len(verts))
                verts.append(q)
                uvs.append((k / segs, acc * uv_v))
                cols.append((col[0], col[1], col[2], 1.0))
            rings.append(ring)
        faces = []
        for i in range(len(rings) - 1):
            for k in range(segs):
                faces.append((rings[i][k], rings[i][k + 1], rings[i + 1][k + 1], rings[i + 1][k]))
        self._add(verts, faces, uvs, cols, None, mat)

    def mesh(self, name, mats):
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(p) for p in self.v], [], self.f)
        me.update()
        for m in (mats if isinstance(mats, (list, tuple)) else [mats]):
            me.materials.append(m)
        me.polygons.foreach_set("material_index", self.fmat)
        uv = me.uv_layers.new(name="UVMap")
        ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
        for p in me.polygons:
            for li in p.loop_indices:
                uv.data[li].uv = self.uv[me.loops[li].vertex_index]
        for i, c in enumerate(self.col):
            ca.data[i].color = c
        for p in me.polygons:
            p.use_smooth = True
        me.update()
        nr = []
        for i, v in enumerate(me.vertices):
            n = self.nrm[i]
            nr.append(tuple(n.normalized()) if n is not None and n.length > 1e-6 else tuple(v.normal))
        try:
            me.normals_split_custom_set_from_vertices(nr)
        except Exception as e:  # noqa: BLE001
            print("custom normals failed:", e)
        ob = bpy.data.objects.new(name, me)
        return ob

    def tris(self):
        return sum(len(f) - 2 for f in self.f)


def _green(rng, base=(1.0, 1.0, 1.0), var=0.12):
    k = rng.uniform(1.0 - var, 1.0)
    y = rng.uniform(-0.06, 0.06)
    return (min(1.0, base[0] * k * (1 + y)), min(1.0, base[1] * k), min(1.0, base[2] * k * (1 - y)))


def shrub(Lv, centre, radius, height, rng, n=None, up=(0, 0, 1), cell="spray", tint=(1, 1, 1)):
    """A leafy shrub: n spray cards rising from the base in a dome (crossed, tilted outward), sizes ~ radius."""
    c = Vector(centre)
    U = Vector(up).normalized()
    n = n or max(5, int(4 + radius * 5))
    for i in range(n):
        a = 2 * math.pi * i / n + rng.uniform(-0.4, 0.4)
        out = Vector((math.cos(a), math.sin(a), 0.0))
        tilt = rng.uniform(0.25, 0.9)
        d = (U * math.cos(tilt) + out * math.sin(tilt)).normalized()
        R = d.cross(Vector((0, 0, 1)) if abs(d.z) < 0.95 else Vector((1, 0, 0))).normalized()
        R = (R * math.cos(rng.uniform(-0.5, 0.5)) + d.cross(R) * math.sin(rng.uniform(-0.5, 0.5))).normalized()
        s = rng.uniform(0.75, 1.15) * max(radius * 1.2, height)
        base = c + out * rng.uniform(0.0, radius * 0.35) - U * 0.08
        nrm = out * 0.75 + U * 0.65
        Lv.card(base, R, d, s * rng.uniform(0.85, 1.05), s, FOLIAGE[cell], _green(rng, tint), nrm=nrm,
                bend=rng.uniform(0.0, 0.35), droop=out - U * 0.3, segs=2)
    # a few cards across the top so the dome is closed from above
    for i in range(max(2, n // 4)):
        a = rng.uniform(0, 2 * math.pi)
        R = Vector((math.cos(a), math.sin(a), 0))
        F_ = Vector((-math.sin(a), math.cos(a), 0))
        s = rng.uniform(0.8, 1.1) * radius * 1.3
        base = c + U * height * rng.uniform(0.35, 0.6) - F_ * s * 0.45
        Lv.card(base, R, (F_ + U * rng.uniform(0.2, 0.5)).normalized(), s, s, FOLIAGE[cell], _green(rng, tint),
                nrm=U, segs=1)


def fern(Lv, centre, n_fronds, size, rng, up=(0, 0, 1), tint=(1, 1, 1)):
    """A fern: arching fronds (2-segment bent cards of the fern quadrant) radiating from the crown."""
    c = Vector(centre)
    U = Vector(up).normalized()
    for k in range(n_fronds):
        a = 2 * math.pi * k / n_fronds + rng.uniform(-0.3, 0.3)
        out = Vector((math.cos(a), math.sin(a), 0.0))
        el = rng.uniform(0.35, 0.9)
        d = (U * math.sin(el) + out * math.cos(el)).normalized()
        R = d.cross(out if abs(d.dot(out)) < 0.99 else Vector((0, 0, 1))).normalized()
        if R.length < 1e-3:
            R = Vector((-out.y, out.x, 0))
        R = out.cross(U).normalized() if out.cross(U).length > 1e-3 else R
        ln = size * rng.uniform(0.75, 1.15)
        Lv.card(c, R, d, ln * 0.42, ln, FOLIAGE["fern"], _green(rng, tint, 0.18), nrm=U * 0.8 + out * 0.5,
                bend=rng.uniform(0.25, 0.5), droop=out * 0.4 - U, segs=3)


def grass(Lv, centre, h, rng, up=(0, 0, 1), n=3, tint=(1, 1, 1)):
    """A grass / sedge clump: n crossed cards of the grass quadrant, standing on the ground."""
    c = Vector(centre)
    U = Vector(up).normalized()
    a0 = rng.uniform(0, math.pi)
    for k in range(n):
        a = a0 + math.pi * k / n
        R = Vector((math.cos(a), math.sin(a), 0))
        lean = Vector((rng.uniform(-0.15, 0.15), rng.uniform(-0.15, 0.15), 0))
        hh = h * rng.uniform(0.8, 1.15)
        Lv.card(c - U * 0.03, R, (U + lean).normalized(), hh * 1.1, hh, FOLIAGE["grass"], _green(rng, tint, 0.15),
                nrm=U * 0.9 + R.cross(U) * 0.2, segs=1)


def hanging(Lv, anchor, out, length, rng, n=3, tint=(1, 1, 1)):
    """Leafy sprays hanging out of a crack or over a ledge edge (hanging quadrant), drooping down along the rock."""
    c = Vector(anchor)
    O = Vector(out).normalized()
    for k in range(n):
        side = Vector((-O.y, O.x, 0)).normalized() * rng.uniform(-0.5, 0.5)
        R = Vector((-O.y, O.x, 0)).normalized()
        d = (Vector((0, 0, -1)) + O * rng.uniform(0.15, 0.45)).normalized()
        L_ = length * rng.uniform(0.75, 1.2)
        # the hanging quadrant is drawn tip-down from its top edge: anchor = 1 puts the card's top at the crack
        Lv.card(c + side * L_ * 0.3 + O * 0.05, R, Vector((0, 0, 1)), L_ * 0.7, L_, FOLIAGE["hang"],
                _green(rng, tint), nrm=O * 0.8 + Vector((0, 0, 0.4)), anchor=1.0, segs=1)


def tree_template(seed, H, R, lean=0.0, cards_n=None, card=(2.0, 2.9)):
    """A broadleaf tree at the origin (Blender coords): tapered trunk + limbs (bark, mat 0) and a full crown of
    leaf-cluster cards (T_leaf_green quadrants, mat 1). `lean` tilts the crown toward +x (over a rim, toward the light).
    ~360-480 triangles."""
    rng = random.Random(seed)
    Lv = Leaves()
    trunk_r = 0.022 * H + rng.uniform(-0.02, 0.04)
    fork_h = H * rng.uniform(0.32, 0.45)
    lv = Vector((lean, rng.uniform(-0.15, 0.15), 0.0))
    pts = [Vector((0, 0, -0.6)), Vector((0, 0, fork_h * 0.4)) + lv * fork_h * 0.15, Vector((0, 0, fork_h * 0.75)) + lv * fork_h * 0.45,
           Vector((0, 0, fork_h)) + lv * fork_h * 0.8]
    Lv.tube(pts, [trunk_r * 1.35, trunk_r, trunk_r * 0.88, trunk_r * 0.75], 6, uv_v=0.35, mat=0,
            col=(0.85, 0.82, 0.8))
    fork = pts[-1]
    crown_c = fork + Vector((lean * (H - fork_h) * 0.45, 0, (H - fork_h) * 0.45))
    crown_h = (H - fork_h) * 0.55
    clusters = []
    nl = rng.randint(5, 7)
    for i in range(nl):
        az = 2 * math.pi * i / nl + rng.uniform(-0.35, 0.35)
        el = math.radians(rng.uniform(28, 62))
        d = Vector((math.cos(az) * math.cos(el) + lean * 0.5, math.sin(az) * math.cos(el), math.sin(el))).normalized()
        Lb = R * rng.uniform(0.7, 1.0) / max(0.45, math.cos(el))
        Lb = min(Lb, (H - fork_h) * 1.0)
        p0 = fork - Vector((0, 0, 0.1))
        p1 = p0 + d * Lb * 0.5 + Vector((0, 0, Lb * 0.05))
        p2 = p0 + d * Lb + Vector((0, 0, -Lb * 0.06))
        r0 = trunk_r * 0.55
        Lv.tube([p0, p1, p2], [r0, r0 * 0.55, 0.03], 4, uv_v=1.0, mat=0, col=(0.85, 0.82, 0.8))
        clusters += [p2, p1.lerp(p2, 0.6)]
    shell = cards_n or 36
    for i in range(shell):
        u = rng.uniform(-0.45, 1.0)
        th = rng.uniform(0, 2 * math.pi)
        rr = math.sqrt(max(0.0, 1 - u * u)) * rng.uniform(0.75, 1.0)
        clusters.append(crown_c + Vector((math.cos(th) * rr * R, math.sin(th) * rr * R, u * crown_h)))
    cmin, cmax = card
    for p in clusters:
        out = p - crown_c
        out.z *= 0.6
        if out.length < 1e-3:
            out = Vector((0, 0, 1))
        out.normalize()
        for j in range(2):
            n = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.5, 1))) + out * 0.9
            n.normalize()
            upv = out * 0.5 + Vector((0, 0, 0.9)) + Vector((rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4), 0))
            upv = (upv - n * upv.dot(n)).normalized()
            rv = n.cross(upv).normalized()
            s = rng.uniform(cmin, cmax)
            jit = Vector((rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), rng.uniform(-0.2, 0.2))) * s
            q = rng.randrange(4)
            cell = ((q % 2) * 0.5, 1 - (q // 2 + 1) * 0.5)
            shade = rng.uniform(0.86, 1.0) * (0.8 + 0.2 * max(0.0, (p - crown_c).z / max(crown_h, 1e-3) * 0.5 + 0.5))
            nn = (p + jit - crown_c)
            nn.z *= 0.8
            nn = nn.normalized() * 0.8 + n * 0.2
            Lv.card(p + jit, rv, upv, s, s, cell, (shade, shade, shade * 0.97), nrm=nn, anchor=0.5, mat=1)
    return Lv
