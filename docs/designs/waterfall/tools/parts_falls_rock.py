"""B1 waterfall, W1: geometry parts for the rock and the plants (called by build_waterfall.py, run inside Blender).

Everything here is built from falls_shape (imported, never copied): the cliff is face_x() plus a fracture detail
field, clamped so the shape contract still holds (the plunge and the upper-cascade film W2 wraps, the camera wall).

  facet_detail / face_x_detailed   fractured-granite relief added on the W0 height field (planar facets, cracks, sheet joints)
  block_mesh(kind, seed)           a jointed granite block (rock kit k = 0..5): convex hull of a chamfered box, re-split
  slab_mesh / seat_mesh            the walkable flat rocks and the 2 stone seats (flat tops at the contract heights)
  leaf_clump / fern / grass_tuft   real leaf geometry (no cards): volumetric bush, fern fronds, grass blades, moss cushions
"""
import math
import random

import bmesh
import bpy
from mathutils import Vector

import falls_shape as F

# ============================================================================================== noise ==


def _cell_worley(u, v, seed):
    """Cellular noise with the nearest cell's centre: (f1, f2, id01, cx, cy)."""
    iu, iv = math.floor(u), math.floor(v)
    best = [9.0, 9.0, 0.0, 0.0, 0.0]
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            ci, cj = iu + di, iv + dj
            px = ci + 0.1 + 0.8 * F._hash2(ci, cj, seed)
            py = cj + 0.1 + 0.8 * F._hash2(ci, cj, seed + 1)
            d = math.hypot(u - px, v - py)
            if d < best[0]:
                best[1] = best[0]
                best[0], best[2], best[3], best[4] = d, F._hash2(ci, cj, seed + 2), px, py
            elif d < best[1]:
                best[1] = d
    return best


def facet_detail(z, y):
    """Granite jointing relief (m, + = out of the rock) at (z, y), round 2:
      - tall columns (cells ~2.8 m wide, ~14 m tall): each a flat plane, pushed out or in as a whole, separated by deep
        sharp vertical joints (photo 05);
      - stepped horizontal sheet joints every ~2.2 m: the face tilts back a little then jumps (photo 12);
      - a second, smaller set of planar facets (~1.1 x 2.2 m) with their own cracks.
    Almost no smooth noise: large flat faces, hard edges, shadowed cracks. Range about -1.6 .. +0.5."""
    wz = z + 0.35 * F.noise3(z * 0.17, y * 0.05, 3.1)
    wy = y + 0.5 * F.noise3(z * 0.1, y * 0.1, 8.7)
    f1, f2, cid, cx, cy = _cell_worley(wz / 2.8, wy / 14.0, 11)
    off = (cid - 0.5) * 0.9
    tz = (F._hash2(int(cx * 9), int(cy * 9), 4) - 0.5) * 0.22
    plane = off + tz * (wz / 2.8 - cx) * 2.8
    crack = math.exp(-((f2 - f1) / 0.05)) * 1.0
    # sheet joints
    sq = wy / 2.2 + 0.7 * F.noise3(z * 0.09, 0.7, 4.4)
    k = math.floor(sq)
    fr = sq - k
    sheet = -0.45 * fr ** 1.6 + (F._hash2(k, int(cid * 977), 6) - 0.5) * 0.30
    # smaller facets
    g1, g2, gid, gx, gy = _cell_worley(wz / 1.1, wy / 2.2, 31)
    sub = (gid - 0.5) * 0.28 + (F._hash2(int(gx * 5), int(gy * 5), 2) - 0.5) * 0.12 * (g1 * 2)
    crack2 = math.exp(-((g2 - g1) / 0.07)) * 0.28
    return plane + sheet + sub - crack - crack2 + 0.012 * F.noise3(z * 2.3, y * 2.3, 6.6)


def detail_weight(z, y):
    """How much of the fracture relief applies at (z, y): full on the bare rock, none in the upper-cascade groove
    (W2 wraps the film on the plain face_x), none out of the rock on and beside the plunge."""
    a = abs(z - F.FZ)
    w = F.smooth(F.FLANK_FULL, F.FLANK_START + 2.0, a) * 0.85 + 0.15 * F.smooth(F.FLANK_FULL + 2.0, F.FLANK_FULL - 2.0, a)
    if y > F.LEDGE - 0.6:
        dz = abs(z - F.channel_z(y))
        w *= F.smooth(F.CHANNEL_HALF + 0.2, F.CHANNEL_HALF + 2.6, dz)
    return w


def face_x_detailed(z, y):
    """face_x + fracture detail, clamped: never closer than 0.5 m to the camera wall, never out of the rock where
    the plunge or its side strands fall (|z - lip z| < 6.5, y below the ledge)."""
    base = F.face_x(z, y)
    d = facet_detail(z, y) * detail_weight(z, y)
    # fade the relief out at the very top and bottom of the mesh so the seams with the plateau and the bed are clean
    d *= F.smooth(F.FACE_Y[0], F.FACE_Y[0] + 1.5, y) * F.smooth(F.PLATEAU_Y + 1.5, F.PLATEAU_Y - 3.5, y)
    if abs(z - F.LIP["z"]) < 6.5 and y < F.LEDGE + 0.4:
        d = min(d, 0.0)
    cap = F.camera_wall_x(z) - 0.5 - base
    return base + min(d, cap)


# ====================================================================================== grid and meshes ==


def make_bm_from_grid(xs_fn, zs, ys, keep=None):
    """A structured grid over (z, y) -> bmesh quads. xs_fn(z, y) -> x. keep(i, j, pts) may drop a quad."""
    nz = len(zs)
    verts = []
    for y in ys:
        for z in zs:
            verts.append((xs_fn(z, y), z, y))
    return verts, nz


def _tri_split(verts, a, b, c, d):
    """Split quad (a, b, c, d) along the shorter 3D diagonal -> two triangles."""
    pa, pb, pc, pd = (Vector((verts[k][0], -verts[k][1], verts[k][2])) for k in (a, b, c, d))
    if (pa - pc).length <= (pb - pd).length:
        return [(a, b, c), (a, c, d)]
    return [(a, b, d), (b, c, d)]


def mesh_from(name, verts_bl, faces, mat=None, uv=None, uv2=None, colors=None, smooth=True, normals_by_angle=None):
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


# ======================================================================================== rock kit ==

KIT = {
    # kind: (sx, sy, sz) half-sizes in local units (x = out of the cliff, y = up, z = along the cliff); bevel facets, sphericity
    0: dict(h=(1.0, 0.45, 1.4), pts=16, sph=0.0, rough=0.010, label="wide ledge slab"),
    1: dict(h=(0.8, 1.35, 0.7), pts=16, sph=0.0, rough=0.010, label="tall angular pillar"),
    2: dict(h=(1.0, 0.85, 1.0), pts=18, sph=0.02, rough=0.010, label="chunky cube-ish block"),
    3: dict(h=(1.3, 0.55, 0.9), pts=20, sph=0.03, rough=0.012, label="wedge / leaning flake"),
    4: dict(h=(1.0, 0.75, 1.1), pts=30, sph=0.28, rough=0.014, label="rounded boulder (riprap)"),
    5: dict(h=(1.35, 0.30, 1.10), pts=18, sph=0.10, rough=0.010, label="flat stepping rock"),
    6: dict(h=(1.0, 0.8, 1.0), pts=40, sph=0.8, rough=0.010, label="rounded river boulder"),
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
    """One jointed granite block: the convex hull of points on a chamfered box (so planar facets with hard edges),
    each face re-split (cuts=1) and nudged by a small rough noise. UV0 = local box projection, 3.0 m tile, random
    offset; vertex colour 'Col' R moss (up-facing), G wet (low), B streak (sides), A lichen. ~350-650 triangles."""
    k = KIT[kind]
    rng = random.Random(seed * 977 + kind * 31)
    sx, sy, sz = k["h"]
    pts = []
    for i in range(k["pts"]):
        d = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1))).normalized()
        c = d / max(abs(d.x), abs(d.y), abs(d.z))                # on the cube surface
        p = c * (1.0 - k["sph"]) + d * k["sph"]
        r = rng.uniform(0.80, 1.02)
        pts.append(Vector((p.x * sx * r, p.y * sy * r, p.z * sz * r)))
    # make sure the extremes exist so the block really has its size
    for ax in range(3):
        for sgn in (-1, 1):
            v = Vector((0, 0, 0))
            v[ax] = sgn * (sx, sy, sz)[ax] * rng.uniform(0.92, 1.0)
            v[(ax + 1) % 3] = rng.uniform(-0.35, 0.35) * (sx, sy, sz)[(ax + 1) % 3]
            v[(ax + 2) % 3] = rng.uniform(-0.35, 0.35) * (sx, sy, sz)[(ax + 2) % 3]
            pts.append(v)
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in pts]
    bmesh.ops.convex_hull(bm, input=vs, use_existing_faces=False)
    bm.verts.ensure_lookup_table()
    # remove stray (interior) verts left by the hull
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=(1 if kind == 6 else 2), use_grid_fill=False)
    for v in bm.verts:
        n = F.noise3(v.co.x * 2.1 + seed, v.co.y * 2.1, v.co.z * 2.1 + kind) * k["rough"]
        v.co += v.normal * n
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
    zmax = max(v.co.z for v in me.vertices)
    for i, v in enumerate(me.vertices):
        # per-vertex mask values in the kit's own frame (z up in Blender): moss on upward-facing, wet low, streaks on the sides
        n = v.normal
        moss = F.smooth(0.55, 0.92, n.z) * (0.55 + 0.45 * F.noise3(v.co.x * 3, v.co.y * 3, 1.1 + kind)) + 0.18 * F.smooth(0.25, 0.0, v.co.z - zmin) * F.smooth(0.3, 0.8, 1 - abs(n.z))
        wet = F.smooth(zmin + 0.5, zmin, v.co.z) * 0.8
        streak = F.smooth(0.5, 0.15, abs(n.z)) * max(0.0, F.fbm(v.co.x * 3.0, v.co.y * 3.0, v.co.z * 0.5 + seed, 3)) * 1.3
        lich = max(0.0, F.noise3(v.co.x * 1.7, v.co.y * 1.7, v.co.z * 1.7 + 9)) * 0.9
        ca.data[i].color = (min(1, moss), min(1, wet), min(1, streak), min(1, lich))
    sharpen(me, 34 if kind != 6 else 80)
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
    rings = []
    for lev in (0.0, 1.0):
        ring = []
        for k in range(n):
            a = 2 * math.pi * k / n
            j = 1.0 + 0.06 * math.sin(2 * a + ph[0]) + 0.05 * math.sin(3 * a + ph[1]) + 0.03 * math.sin(5 * a + ph[2]) + 0.015 * math.sin(9 * a + ph[3])
            # straightish fracture edges: pull to a polygon-ish shape
            r = 1.0 + (j - 1.0) * (1.0 + 0.0 * lev)
            lx, lz = s["radiusX"] * math.cos(a) * r, s["radiusZ"] * math.sin(a) * r
            ring.append((lx, lz))
        rings.append(ring)

    def w(lx, lz):
        return (s["centre"]["x"] + lx * c + lz * sn, s["centre"]["z"] - lx * sn + lz * c)
    top = s["top"]
    # profile levels (outer scale, height): top face flat, rounded shoulder, side down to -0.55 (buried)
    prof = [(0.0, top), (0.55, top), (0.86, top - 0.004), (0.97, top - 0.025), (1.0, top - 0.07), (1.02, top - 0.16), (1.04, -0.55)]
    verts, faces = [], []
    ring_idx = []
    verts.append(Vb(*w(0, 0), top))
    for (sc_, h) in prof[1:]:
        idx = []
        for k in range(n):
            lx, lz = rings[0][k]
            # tiny height noise on the flat top (+-3 mm), more on the shoulder
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
    # fix the winding so normals point up/out (Blender y = -z: our (x, z) ring turns the other way)
    me = bpy.data.meshes.new(s["id"])
    me.from_pydata(verts, [], [tuple(reversed(f)) for f in faces])
    me.update()
    if me.polygons[0].normal.z < 0:
        me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
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
    rng = random.Random(seed)
    c = s["centre"]
    hx, hz = s["size"]["x"] / 2, s["size"]["z"] / 2
    top = s["seatTop"]
    bot = -0.2
    bm = bmesh.new()
    # a box with 3 cuts along its length so the broken-edge noise has something to move
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * 2 * hx, v.co.y * 2 * hz, v.co.z * (top - bot) + (top + bot) / 2))
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=5, use_grid_fill=True)
    # round the vertical and top edges (a soft chamfer by pulling the corner vertices toward the centre)
    for v in bm.verts:
        px, py, pz = v.co.x / hx, v.co.y / hz, (v.co.z - (top + bot) / 2) / ((top - bot) / 2)
        e = max(abs(px), abs(py))
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
# Real leaf geometry. UVs point into a dense, fully opaque patch of T_leaf_green (the tree atlas), jittered per leaf so
# the green varies; vertex colour 'Col' tints (grey 0.7..1.0, a few yellowish).

LEAF_PATCHES = [(0.09, 0.29), (0.81, 0.31), (0.07, 0.26), (0.71, 0.33), (0.79, 0.35), (0.77, 0.83), (0.95, 0.75), (0.13, 0.27)]


class Leaves:
    """Accumulates leaf / blade triangles into one mesh (Blender coords, already world-placed)."""

    def __init__(self):
        self.v, self.f, self.uv, self.col = [], [], [], []

    def _add(self, pts, quads, uvs, cols):
        b = len(self.v)
        self.v += pts
        self.uv += uvs
        self.col += cols
        for q in quads:
            self.f.append(tuple(b + i for i in q))

    def leaf(self, base, d, up, length, width, rng, droop=0.25, tint=None, fold=0.28, st=4):
        """A lanceolate leaf: 4 stations along d (unit), V-folded along the midrib, curling down by `droop`."""
        d = Vector(d).normalized()
        side = d.cross(Vector(up)).normalized()
        if side.length < 1e-4:
            side = Vector((1, 0, 0))
        nrm = side.cross(d).normalized()
        pts, cols, uvs = [], [], []
        pu = LEAF_PATCHES[rng.randrange(len(LEAF_PATCHES))]
        t0 = tint if tint is not None else rng.uniform(0.92, 1.0)
        for i in range(st):
            t = i / (st - 1.0)
            ctr = Vector(base) + d * (length * t) - nrm * (droop * length * t * t)
            wd = width * math.sin(math.pi * min(1.0, 0.12 + 0.88 * t) ** 0.9) * (1.0 if t < 0.98 else 0.2)
            for sgn in (-1, 0, 1):
                p = ctr + side * (sgn * wd * 0.5) + nrm * (fold * wd * (1 - abs(sgn)) * 0.5)
                pts.append((p.x, p.y, p.z))
                uvs.append((pu[0] + 0.03 * sgn * t + rng.uniform(-0.01, 0.01), pu[1] + 0.05 * t))
                g = t0 * (1.0 - 0.12 * t)
                cols.append((g, g, g * 0.95, 1.0))
        quads = []
        for i in range(st - 1):
            a = i * 3
            quads += [(a, a + 1, a + 4, a + 3), (a + 1, a + 2, a + 5, a + 4)]
        self._add(pts, quads, uvs, cols)

    def blade(self, base, d, up, length, width, rng, bend=0.5, tint=None):
        """A grass blade: 3 stations, tapering to a point, bending over in the direction `d`."""
        d = Vector(d).normalized()
        side = d.cross(Vector(up)).normalized()
        if side.length < 1e-4:
            side = Vector((1, 0, 0))
        pu = LEAF_PATCHES[rng.randrange(len(LEAF_PATCHES))]
        t0 = tint if tint is not None else rng.uniform(0.7, 1.05)
        pts, cols, uvs = [], [], []
        for i in range(3):
            t = i / 2.0
            ctr = Vector(base) + Vector(up).normalized() * (length * t * (1 - 0.3 * bend * t)) + d * (length * bend * t * t * 0.7)
            wd = width * (1.0 - t) if i < 2 else 0.0
            for sgn in (-1, 1):
                p = ctr + side * (sgn * wd * 0.5)
                pts.append((p.x, p.y, p.z))
                uvs.append((pu[0] + 0.02 * sgn, pu[1] + 0.04 * t))
                cols.append((t0 * (0.8 + 0.2 * t), t0 * (0.85 + 0.2 * t), t0 * 0.7, 1.0))
        self._add(pts, [(0, 1, 3, 2), (2, 3, 5, 4)], uvs, cols)

    def cushion(self, centre, radius, rng, tint=0.55):
        """A moss cushion: a flattened, lumpy dome (~70 triangles)."""
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
        pu = LEAF_PATCHES[rng.randrange(len(LEAF_PATCHES))]
        ph = rng.uniform(0, 50)
        for v in bm.verts:
            n = v.co.normalized()
            r = radius * (1.0 + 0.28 * F.noise3(n.x * 2.4 + ph, n.y * 2.4, n.z * 2.4))
            v.co = Vector((n.x * r, n.y * r, max(n.z, -0.2) * r * 0.5)) + Vector(centre)
        pts = [(v.co.x, v.co.y, v.co.z) for v in bm.verts]
        bm.verts.ensure_lookup_table()
        quads = [tuple(v.index for v in f.verts) for f in bm.faces]
        uvs = [(pu[0] + 0.05 * math.sin(i), pu[1] + 0.05 * math.cos(i * 1.3)) for i in range(len(pts))]
        cols = [(tint * rng.uniform(0.85, 1.1), tint * rng.uniform(0.95, 1.2), tint * 0.45, 1.0) for _ in pts]
        self._add(pts, quads, uvs, cols)
        bm.free()

    def mesh(self, name, mat):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, [], self.f)
        me.update()
        uv = me.uv_layers.new(name="UVMap")
        ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
        for p in me.polygons:
            for li in p.loop_indices:
                uv.data[li].uv = self.uv[me.loops[li].vertex_index]
        for i, c in enumerate(self.col):
            ca.data[i].color = c
        me.materials.append(mat)
        for p in me.polygons:
            p.use_smooth = True
        ob = bpy.data.objects.new(name, me)
        return ob

    def tris(self):
        return sum(len(f) - 2 for f in self.f)


def leaf_clump(Lv, centre, radius, height, n, rng, up=(0, 0, 1)):
    """A bush: n leaves radiating from the centre, longer and flatter at the bottom, reaching up and out."""
    c = Vector(centre)
    for i in range(n):
        a = rng.uniform(0, 2 * math.pi)
        e = rng.uniform(0.05, 1.1)                      # elevation of the leaf's direction (rad)
        d = Vector((math.cos(a) * math.cos(e), math.sin(a) * math.cos(e), math.sin(e)))
        r0 = rng.uniform(0.0, radius * 0.35)
        base = c + Vector((math.cos(a) * r0, math.sin(a) * r0, rng.uniform(0.0, height * 0.35)))
        ln = rng.uniform(0.35, 0.8) * max(radius, height * 0.6)
        Lv.leaf(base, d, (0, 0, 1), ln, ln * rng.uniform(0.7, 0.95), rng, droop=rng.uniform(0.2, 0.6), st=3)


def fern(Lv, centre, n_fronds, size, rng):
    """A fern: arching fronds, each with leaflet pairs along the rachis."""
    c = Vector(centre)
    for k in range(n_fronds):
        a = 2 * math.pi * k / n_fronds + rng.uniform(-0.3, 0.3)
        out = Vector((math.cos(a), math.sin(a), 0))
        ln = size * rng.uniform(0.7, 1.15)
        elev0 = rng.uniform(0.55, 1.1)
        pairs = 9
        prev = c
        for i in range(1, pairs + 1):
            t = i / pairs
            e = elev0 - 1.6 * t * t * (0.6 + 0.4 * rng.random())
            pos = c + out * (ln * t * 0.9) + Vector((0, 0, ln * 0.7 * math.sin(max(0.0, 1.0 - t) * elev0 * 1.4) * t * 1.2 - ln * 0.35 * t * t))
            tang = (pos - prev)
            tang = tang.normalized() if tang.length > 1e-6 else out
            side = tang.cross(Vector((0, 0, 1)))
            side = side.normalized() if side.length > 1e-6 else Vector((1, 0, 0))
            w = ln * 0.32 * math.sin(math.pi * min(1.0, 0.15 + 0.85 * t)) ** 0.8
            for sgn in (-1, 1):
                d = (side * sgn * 0.9 + tang * 0.55 + Vector((0, 0, -0.18))).normalized()
                Lv.leaf(pos, d, (0, 0, 1), w, w * 0.30, rng, droop=0.15, fold=0.1, tint=rng.uniform(0.7, 1.0), st=2)
            prev = pos


def grass_tuft(Lv, centre, n, h, rng):
    c = Vector(centre)
    for i in range(n):
        a = rng.uniform(0, 2 * math.pi)
        base = c + Vector((math.cos(a) * rng.uniform(0, h * 0.12), math.sin(a) * rng.uniform(0, h * 0.12), 0))
        Lv.blade(base, (math.cos(a), math.sin(a), 0), (rng.uniform(-0.25, 0.25), rng.uniform(-0.25, 0.25), 1), h * rng.uniform(0.6, 1.0), h * 0.07, rng, bend=rng.uniform(0.3, 1.0))


def branch(Lv, start, direction, length, rng, leaf_n=26, droop=0.8):
    """An overhanging hardwood branch (stem made of a few thin tapered quads + leaves along it, hanging toward the water)."""
    s = Vector(start)
    d = Vector(direction).normalized()
    prev = s
    pts = []
    for i in range(6):
        t = i / 5.0
        p = s + d * (length * t) + Vector((0, 0, -droop * length * t * t * 0.6 + 0.12 * length * math.sin(t * 3.0)))
        pts.append(p)
    # stem: thin double triangles
    for i in range(5):
        a, b = pts[i], pts[i + 1]
        w = 0.07 * (1 - i / 6.0)
        side = (b - a).cross(Vector((0, 0, 1))).normalized() * w
        pu = (0.5, 0.97)
        Lv._add([(a - side).to_tuple(), (a + side).to_tuple(), (b + side * 0.8).to_tuple(), (b - side * 0.8).to_tuple()],
                [(0, 1, 2, 3)], [pu] * 4, [(0.28, 0.2, 0.15, 1.0)] * 4)
    for j in range(leaf_n):
        t = rng.uniform(0.25, 1.0)
        i = min(4, int(t * 5))
        p = pts[i] + (pts[i + 1] - pts[i]) * (t * 5 - i)
        a = rng.uniform(0, 2 * math.pi)
        dd = Vector((math.cos(a) * 0.8, math.sin(a) * 0.8, -rng.uniform(0.05, 0.5))) + d * 0.2
        ln = rng.uniform(0.35, 0.6)
        Lv.leaf(p, dd, (0, 0, 1), ln, ln * 0.42, rng, droop=0.25)


def canopy_tree(Lv_leaf, Lv_bark, x, z, y, h, rng, spread=1.0):
    """A placeholder broadleaf crown for the site box: a trunk (tapered 6-sided prism) and 4-5 lumpy leaf masses
    (80 triangles each) whose UVs sit in a dense opaque patch of T_leaf_green; vertex colour varies the green."""
    base = Vector((x, -z, y))
    # trunk
    top = base + Vector((rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4), h * 0.62))
    n = 6
    r0, r1 = 0.22 * h / 8, 0.12 * h / 8
    vs, fs, uv, col = [], [], [], []
    for ring, (c, r) in enumerate(((base - Vector((0, 0, 0.4)), r0), (top, r1))):
        for i in range(n):
            a = 2 * math.pi * i / n
            vs.append((c.x + r * math.cos(a), c.y + r * math.sin(a), c.z))
            uv.append((0.22 + 0.01 * i / n, 0.46))
            col.append((0.55, 0.45, 0.4, 1.0))
    for i in range(n):
        fs.append((i, (i + 1) % n, n + (i + 1) % n, n + i))
    Lv_bark._add(vs, fs, uv, col)
    for k in range(4):
        a = rng.uniform(0, 6.28)
        rr = rng.uniform(0.0, 0.2) * h * spread
        c = top + Vector((math.cos(a) * rr, math.sin(a) * rr, h * rng.uniform(-0.05, 0.3)))
        rad = h * rng.uniform(0.2, 0.3)
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
        ph = rng.uniform(0, 30)
        pts, uvs, cols = [], [], []
        shade = rng.uniform(0.75, 1.0)
        for v in bm.verts:
            nn = v.co.normalized()
            r_ = rad * (1.0 + 0.22 * F.noise3(nn.x * 2 + ph, nn.y * 2, nn.z * 2))
            p = c + Vector((nn.x * r_, nn.y * r_, nn.z * r_ * 0.8))
            pts.append((p.x, p.y, p.z))
            uvs.append((0.085 + 0.012 * nn.x, 0.285 + 0.012 * nn.z))
            g = shade * (0.65 + 0.35 * (0.5 + 0.5 * nn.z))
            cols.append((g * 0.92, g, g * 0.75, 1.0))
        bm.verts.ensure_lookup_table()
        Lv_leaf._add(pts, [tuple(v.index for v in f.verts) for f in bm.faces], uvs, cols)
        bm.free()
