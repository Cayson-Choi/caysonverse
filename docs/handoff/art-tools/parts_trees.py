"""Trees (procedural trunks + alpha-card canopies), planters and flower beds."""
import math
import random

import bpy
from mathutils import Vector

import vlib as U
from vlib import V, MB

L = U.LAYOUT
TREES = []          # (kind, x, z) of every tree inside the walk bounds (budget check)

KINDS = {
    #            leaf material     bark half  trunk_r  fork   limbs  card size   clusters  cards/cluster
    "cherry": dict(m="M_leaf_cherry", bark=0.0, fork=0.36, limbs=5, card=(2.2, 3.0), shell=84, per=4),
    "zelkova": dict(m="M_leaf_green", bark=0.5, fork=0.30, limbs=7, card=(2.4, 3.3), shell=70, per=3),
    "green": dict(m="M_leaf_green", bark=0.5, fork=0.38, limbs=5, card=(1.7, 2.4), shell=24, per=3),
    "young": dict(m="M_leaf_green", bark=0.5, fork=0.45, limbs=4, card=(0.9, 1.3), shell=8, per=3),
    "willow": dict(m="M_leaf_green", bark=0.5, fork=0.35, limbs=6, card=(1.6, 2.4), shell=26, per=3),
    "orchard": dict(m="M_leaf_cherry", bark=0.0, fork=0.42, limbs=4, card=(1.2, 1.6), shell=16, per=3),
}


class Forest:
    """Collects trunks (LM_bark) and canopy cards (M_leaf_*) into two meshes; per-card crown centres for normals."""

    def __init__(self, bark_m="LM_bark"):
        self.bark_m = bark_m
        self.bark = MB()
        self.leaf = MB()
        self.centres = []        # per leaf face: crown centre (Blender Vector)

    def card(self, centre, normal, up, w, h, m, quad, crown_c):
        n = normal.normalized()
        u = (up - n * up.dot(n)).normalized()
        r = n.cross(u).normalized()
        p = [centre - r * w / 2 - u * h * 0.5, centre + r * w / 2 - u * h * 0.5, centre + r * w / 2 + u * h * 0.5,
             centre - r * w / 2 + u * h * 0.5]
        qx, qy = quad % 2, quad // 2
        u0, v0 = qx * 0.5, 1 - (qy + 1) * 0.5
        uvs = [(u0 + 0.003, v0 + 0.003), (u0 + 0.497, v0 + 0.003), (u0 + 0.497, v0 + 0.497), (u0 + 0.003, v0 + 0.497)]
        f = self.leaf.face(p, m, uvs)
        if f is not None:
            self.centres.append(crown_c)

    def finish(self, name, c):
        trunks = self.bark.finish(name + "_trunks", c, auto=False)
        leaves = self.leaf.finish(name + "_leaves", c, cat="leaf", auto=False)
        # shading normals: from the crown centre outward (soft, volumetric canopy shading)
        me = leaves.data
        normals = []
        for p in me.polygons:
            cc = self.centres[p.index] if p.index < len(self.centres) else Vector((0, 0, 0))
            for li in p.loop_indices:
                co = me.vertices[me.loops[li].vertex_index].co
                d = (co - cc)
                d.z *= 0.8
                d = d.normalized() * 0.8 + p.normal * 0.2
                normals.append(d.normalized())
        try:
            me.normals_split_custom_set(normals)
        except Exception as e:
            print("custom normals failed:", e)
        return trunks, leaves


def tree(F, x, z, kind, H, R, seed, trunk_r=None, y0=0.0, lean=0.0):
    k = KINDS[kind]
    rng = random.Random(seed)
    trunk_r = trunk_r or {"cherry": 0.13, "zelkova": 0.7, "green": 0.14, "young": 0.05, "willow": 0.2,
                          "orchard": 0.08}[kind]
    base = V(x, z, y0)
    fork_h = H * k["fork"]
    la = rng.uniform(0, 2 * math.pi)
    leanv = Vector((math.cos(la), math.sin(la), 0)) * (lean or (0.06 if kind != "zelkova" else 0.1)) * fork_h
    pts = [base + Vector((0, 0, -0.15)), base + Vector((0, 0, fork_h * 0.35)) + leanv * 0.3,
           base + Vector((0, 0, fork_h * 0.7)) + leanv * 0.7, base + Vector((0, 0, fork_h)) + leanv]
    rad = [trunk_r * 1.25, trunk_r * 1.0, trunk_r * 0.92, trunk_r * 0.8]
    if kind == "zelkova":                              # buttressed base
        rad[0] = trunk_r * 1.5
    seg = 10 if kind == "zelkova" else 7
    F.bark.tube(pts, rad, F.bark_m, segs=seg, uv_u=0.5, uv_v=0.35 / max(0.2, trunk_r * 2), uv_off=(k["bark"], 0))
    fork = pts[-1]
    crown_c = base + Vector((0, 0, fork_h + (H - fork_h) * 0.5)) + leanv
    crown_h = (H - fork_h) * 0.6
    clusters = []
    nl = k["limbs"]
    for i in range(nl):
        az = 2 * math.pi * i / nl + rng.uniform(-0.3, 0.3)
        el = math.radians(rng.uniform(30, 58) if kind != "willow" else rng.uniform(40, 65))
        if kind == "zelkova":
            el = math.radians(rng.uniform(28, 50))
        d = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
        Lb = R * rng.uniform(0.75, 0.95) / max(0.35, math.cos(el))
        Lb = min(Lb, (H - fork_h) * 1.1)
        p0 = fork - Vector((0, 0, 0.1))
        p1 = p0 + d * Lb * 0.35
        p2 = p0 + d * Lb * 0.7 + Vector((0, 0, Lb * 0.06))
        p3 = p0 + d * Lb + Vector((0, 0, -Lb * 0.05 if kind != "willow" else -Lb * 0.12))
        r0 = trunk_r * 0.55
        F.bark.tube([p0, p1, p2, p3], [r0, r0 * 0.7, r0 * 0.45, 0.02], F.bark_m, segs=5, uv_u=0.5, uv_v=1.2,
                    uv_off=(k["bark"], 0))
        clusters += [p3, p2]
        for j in range(2):
            t = rng.uniform(0.45, 0.8)
            q0 = p1.lerp(p2, t) if t < 0.6 else p2.lerp(p3, t - 0.5)
            az2 = az + rng.uniform(-0.9, 0.9)
            el2 = el + rng.uniform(-0.2, 0.4)
            d2 = Vector((math.cos(az2) * math.cos(el2), math.sin(az2) * math.cos(el2), math.sin(el2)))
            q1 = q0 + d2 * Lb * 0.45
            F.bark.tube([q0, (q0 + q1) / 2, q1], [r0 * 0.3, r0 * 0.18, 0.012], F.bark_m, segs=4, uv_u=0.5, uv_v=1.5,
                        uv_off=(k["bark"], 0))
            clusters.append(q1)
    # silhouette shell points on the crown ellipsoid (upper part fuller)
    for i in range(k["shell"]):
        u = rng.uniform(-0.35, 1.0)
        th = rng.uniform(0, 2 * math.pi)
        rr = math.sqrt(max(0, 1 - u * u))
        p = crown_c + Vector((math.cos(th) * rr * R * 0.92, math.sin(th) * rr * R * 0.92, u * crown_h * 0.9))
        clusters.append(p)
    cmin, cmax = k["card"]
    for p in clusters:
        out = (p - crown_c)
        out.z *= 0.6
        if out.length < 1e-3:
            out = Vector((0, 0, 1))
        out.normalize()
        for j in range(k["per"]):
            n = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.6, 1))) + out * (
                1.8 if kind in ("cherry", "orchard") else 0.8)
            up = out * 0.6 + Vector((0, 0, 0.9)) + Vector((rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4), 0))
            if kind == "willow":
                up = Vector((0, 0, -1)) + out * 0.3
            s = rng.uniform(cmin, cmax)
            jitter = Vector((rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), rng.uniform(-0.2, 0.2))) * s
            F.card(p + jitter, n, up, s, s, k["m"], rng.randrange(3 if kind == "cherry" else 4), crown_c)
    if kind in ("cherry", "orchard"):
        # fallen petals: flat cards of the petal-scatter quadrant around the trunk
        for j in range(5):
            a = rng.uniform(0, 2 * math.pi)
            rr = rng.uniform(0.6, R * 0.9)
            pc = base + Vector((math.cos(a) * rr, -math.sin(a) * rr, 0.015 if y0 < 0.1 else 0.0))
            s = rng.uniform(1.2, 2.0)
            F.card(pc, Vector((0, 0, 1)), Vector((math.cos(a), math.sin(a), 0)), s, s, k["m"], 3, pc)
    inside = abs(x) <= 95 and abs(z) <= 95
    if inside:
        TREES.append((kind, x, z))


# ---------------------------------------------------------------------------------------- flower beds --

def flower_patch(mb, inside, bbox, y, density, rows, seed, h=(0.32, 0.48), w=(0.55, 0.85)):
    """Fill a region with crossed flower-strip cards (T_flora rows). inside(x, z) -> bool; bbox (x0, x1, z0, z1)."""
    rng = random.Random(seed)
    x0, x1, z0, z1 = bbox
    area = (x1 - x0) * (z1 - z0)
    n = int(area * density)
    for i in range(n):
        x, z = rng.uniform(x0, x1), rng.uniform(z0, z1)
        if not inside(x, z):
            continue
        row = rows[rng.randrange(len(rows))]
        yaw = rng.uniform(0, math.pi)
        ww = rng.uniform(*w)
        hh = rng.uniform(*h)
        tilt = rng.uniform(-0.35, 0.35)
        c, s = math.cos(yaw), math.sin(yaw)
        ax, az = x - c * ww / 2, z + s * ww / 2
        bx, bz = x + c * ww / 2, z - s * ww / 2
        # tilt the top edge sideways (perpendicular to the strip)
        tx, tz = s * hh * tilt, c * hh * tilt
        p = [V(ax, az, y), V(bx, bz, y), V(bx + tx, bz + tz, y + hh), V(ax + tx, az + tz, y + hh)]
        u0 = rng.uniform(0, 0.7)
        u1 = u0 + 0.3 * ww / 0.7
        v0 = 1 - (row + 1) * 0.25 + 0.004
        v1 = 1 - row * 0.25 - 0.004
        mb.face(p, "M_leaf_flora", [(u0, v0), (u1, v0), (u1, v1), (u0, v1)])


def planter(mb, fl, x, z, seed, r=1.5, rows=(0, 1, 2)):
    mb.lathe(x, z, [(r, 0.0), (r, 0.36), (r + 0.03, 0.42), (r - 0.05, 0.46), (r - 0.2, 0.44), (r - 0.2, 0.38)],
             "LM_stone", segs=28)
    mb.cell = "soil"
    mb.lathe(x, z, [(r - 0.2, 0.38), (0.0, 0.38)], "A_paint", segs=20, smooth=False)
    mb.cell = None
    flower_patch(fl, lambda px, pz: 0.3 < math.hypot(px - x, pz - z) < r - 0.25, (x - r, x + r, z - r, z + r), 0.38,
                 9.0, list(rows), seed, h=(0.28, 0.42))


def plaza_trees(c, cols):
    F = Forest()
    mb = MB()
    fl = MB()
    # cherries in round planters around the paving
    angs = [-118, -62, -16, 40, 65, 138]
    for i, deg in enumerate(angs):
        a = math.radians(deg)
        x, z = 19.0 * math.cos(a), 19.0 * math.sin(a)
        planter(mb, fl, x, z, 50 + i, rows=((0, 2), (0, 1), (2, 1))[i % 3])
        tree(F, x, z, "cherry", 6.2 + (i % 3) * 0.4, 3.0, 100 + i, y0=0.38)
        U.collider(cols, f"col__planter_{i + 1}", round(x - 1.55, 2), round(x + 1.55, 2), round(z - 1.55, 2),
                   round(z + 1.55, 2), 0.5)
    # fountain corner beds: flowers
    hw = 5.95
    flower_patch(fl, lambda px, pz: math.hypot(px, pz) > 6.25 and abs(px) < hw - 0.15 and abs(pz) < hw - 0.15,
                 (-6, 6, -6, 6), 0.30, 14.0, [0, 1, 2], 7, h=(0.3, 0.45))
    # zelkova with its round deck (평상)
    zc = L["plaza"]["zelkova"]["centre"]
    zx, zz = zc["x"], zc["z"]
    R = L["plaza"]["zelkova"]["deck"]["diameter"] / 2
    deck = [(R - 0.02, 0.0), (R - 0.02, 0.40), (R, 0.42), (R, 0.46), (0.95, 0.46), (0.95, 0.30)]
    mb.lathe(zx, zz, deck, "LM_wood", segs=8, smooth=False, tint=U.rgba("#B98A6A"))
    # plank lines: thin dark gaps as a second ring of boards
    mb.lathe(zx, zz, [(R - 0.25, 0.465), (R - 0.27, 0.47), (1.05, 0.47), (1.0, 0.465)], "LM_wood", segs=8, smooth=False,
             tint=U.rgba("#C79B78"))
    tree(F, zx, zz, "zelkova", 13.5, 8.5, 7, trunk_r=0.62)
    U.collider(cols, L["plaza"]["zelkova"]["collider"]["node"], zx - R, zx + R, zz - R, zz + R, 0.5)
    mb.finish("planters", c)
    fl.finish("flowers_plaza", c, cat="leaf", auto=False)
    F.finish("trees_plaza", c)


def village_trees(c, cols):
    """Trees outside the plaza: along the bridge lane, around houses, creek willows, between the plots."""
    F = Forest()
    spots = [
        # (kind, x, z, H, R)
        ("cherry", -13.5, 36.0, 6.0, 2.9), ("cherry", -15.5, 44.5, 6.4, 3.0), ("cherry", -27.5, 52.0, 6.0, 2.8),
        ("cherry", -20.0, 58.0, 5.8, 2.7),
        
        ("green", 35.5, 41.5, 8.0, 3.4), ("cherry", 23.0, 42.5, 5.8, 2.7),
        ("green", -35.0, 42.0, 8.4, 3.5), ("cherry", -31.0, 46.5, 5.6, 2.6), ("green", -52.0, -14.0, 8.0, 3.3),
        ("cherry", -51.5, -1.0, 6.0, 2.8), ("green", 54.5, -6.5, 8.6, 3.5), ("cherry", 55.0, -19.5, 6.2, 2.8),
        ("green", 70.0, -15.0, 9.0, 3.8), ("green", 74.0, 2.0, 8.0, 3.4), ("green", -70.0, -12.0, 9.2, 3.8),
        ("green", -73.0, 0.0, 8.2, 3.4), ("green", 30.0, -62.0, 9.0, 3.8), ("green", -30.0, -62.0, 8.6, 3.6),
        ("green", 60.0, 45.0, 9.0, 3.8), ("green", -60.0, 45.0, 8.8, 3.7), ("cherry", 18.0, 62.0, 6.0, 2.8),
        ("cherry", 70.0, 30.0, 6.0, 2.8), ("cherry", -72.0, 30.0, 6.2, 2.8), ("green", 80.0, -45.0, 9.0, 3.6),
        ("green", -80.0, -48.0, 9.0, 3.6), ("green", 45.0, -70.0, 8.8, 3.6), ("green", -46.0, -70.0, 8.8, 3.6),
    ]
    for i, (kind, x, z, H, R) in enumerate(spots):
        tree(F, x, z, kind, H, R, 300 + i)
    # creek willows on the banks (non-walkable band)
    for i, (x, z) in enumerate([(-60.0, 66.6), (-10.0, 70.0), (38.0, 71.0), (70.0, 68.0)]):
        tree(F, x, z, "willow", 8.5, 3.6, 400 + i)
    F.finish("trees_village", c)


def memorial_trees(c, positions):
    F = Forest()
    for i, (x, z, H) in enumerate(positions):
        tree(F, x, z, "young", H, H * 0.32, 500 + i)
    F.finish("trees_memorial", c)


def shrub(F, x, z, H, R, seed, m="M_leaf_green", y0=0.0):
    """A low bush: a few overlapping leaf cards around (x, H/2), no visible trunk."""
    rng = random.Random(seed)
    cc = V(x, z, y0 + H * 0.5)
    for i in range(12):
        p = cc + Vector((rng.uniform(-R, R) * 0.7, rng.uniform(-R, R) * 0.7, rng.uniform(-H, H) * 0.25))
        out = (p - cc)
        out.z = abs(out.z) + 0.3
        n = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.3, 1))) + out.normalized() * 0.5
        s = rng.uniform(0.8, 1.15) * max(H, R * 1.6)
        F.card(p, n, Vector((0, 0, 1)) + out * 0.3, s, s * 0.9, m, rng.randrange(4), cc)


def far_tree(F, x, z, y, H, seed, m="M_leaf_green"):
    """Backdrop tree: two crossed cards (silhouette on the hills)."""
    rng = random.Random(seed)
    a = rng.uniform(0, math.pi)
    cc = V(x, z, y + H * 0.5)
    for k in range(2):
        aa = a + k * math.pi / 2
        n = Vector((math.cos(aa), math.sin(aa), 0.15))
        F.card(cc, n, Vector((0, 0, 1)), H * rng.uniform(0.75, 0.95), H, m, rng.randrange(4), cc - Vector((0, 0, H * 0.2)))


def lane_dressing(c, cols):
    """Stone walls (돌담) along the bridge lane's last leg and the south plot lane, clipped shrubs along the
    diagonal plot lanes, flower strips on the ring's outer sidewalk edge."""
    import build_village as BV
    mb = MB()
    fl = MB()
    FS = Forest()
    rng = random.Random(1234)
    # stone walls: axis-aligned runs (x = const), 2.6 m off the lane centre, with a gap toward the pavilion
    runs = [(-24 - 2.6, 47.5, 58.5, "w"), (-24 + 2.6, 47.5, 57.5, "e1"), (-24 + 2.6, 62.0, 66.0, "e2"),
            (-24 - 2.6, 61.0, 66.0, "w2"), (-2.6, 40.5, 48.0, "sw"), (2.6, 40.5, 48.0, "se")]
    for (wx, z0, z1, tag) in runs:
        stone_wall(mb, wx, z0, z1, rng)
        U.collider(cols, f"col__stonewall_{tag}", round(wx - 0.35, 2), round(wx + 0.35, 2), round(z0 - 0.1, 2),
                   round(z1 + 0.1, 2), 1.4)
    # clipped round shrubs along the diagonal plot lanes (1 m, small colliders)
    k = 0
    for lane in L["lanes"]:
        if lane["id"] not in ("lane_plot_ne", "lane_plot_nw", "lane_plot_e", "lane_plot_w"):
            continue
        a, b = lane["points"][0], lane["points"][-1]
        dx, dz = b["x"] - a["x"], b["z"] - a["z"]
        Ln = math.hypot(dx, dz)
        ux, uz = dx / Ln, dz / Ln
        for t in [i * 3.2 for i in range(int(Ln / 3.2) + 1)]:
            for side in (-1, 1):
                px = a["x"] + ux * t - uz * side * 2.7
                pz = a["z"] + uz * t + ux * side * 2.7
                if math.hypot(px, pz) < BV.SIDE_OUT + 1.2:
                    continue
                if t > Ln - 2.5:
                    continue
                k += 1
                shrub(FS, px, pz, 0.95, 0.55, 2000 + k)
                U.collider(cols, f"col__shrub_{k}", round(px - 0.45, 2), round(px + 0.45, 2), round(pz - 0.45, 2),
                           round(pz + 0.45, 2), 1.0)
    # flower strip along the ring's outer sidewalk edge (r 39.15 .. 39.95), gaps at the lane crossings
    crossings = [(ang, hw) for (rr, ang, hw) in BV.lane_crossings() if abs(rr - BV.SIDE_OUT) < 0.5]

    def strip(px, pz):
        r = math.hypot(px, pz)
        if not (39.15 < r < 39.95):
            return False
        a = math.atan2(pz, px)
        for (ga, hw) in crossings:
            if abs(math.atan2(math.sin(a - ga), math.cos(a - ga))) * r < hw + 0.6:
                return False
        if abs(px - 38.5) < 3.0 and -9 < pz < 2.5:
            return False
        return True
    flower_patch(fl, strip, (-40, 40, -40, 40), 0.0, 2.2, [0, 1, 2], 4321, h=(0.25, 0.38), w=(0.45, 0.7))
    mb.finish("stone_walls", c)
    fl.finish("flower_strips", c, cat="leaf", auto=False)
    FS.finish("lane_shrubs", c)


def stone_wall(mb, x, z0, z1, rng, h=1.3, t=0.6):
    """돌담 along z at x: rounded fieldstones in mortar (Poly Haven stone_wall texture on LM_wall). The faces are a
    0.3 m grid pushed in and out by noise (stones bulge, mortar sits back), the wall is battered (wider at the base),
    and a row of rounded capstones sits on top. No tile cap, no bricks."""
    from mathutils import noise
    import parts_nature as PN
    nz = max(2, int((z1 - z0) / 0.3))
    ny = 5
    sides = {}
    for side in (-1, 1):
        grid = []
        for j in range(ny + 1):
            v = j / ny
            y = v * h
            row = []
            for i in range(nz + 1):
                zz = z0 + (z1 - z0) * i / nz
                d = 0.035 * noise.noise(Vector((zz * 2.6, y * 2.6, side * 5.0 + x))) + \
                    0.015 * noise.noise(Vector((zz * 7.0, y * 7.0, 3.0 + side)))
                if i in (0, nz) or j in (0, ny):
                    d *= 0.3
                row.append(V(x + side * (t / 2 + (1 - v) * 0.07 + d), zz, y))
            grid.append(row)
        sides[side] = grid
        for j in range(ny):
            for i in range(nz):
                q = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]]
                mb.face(q, "LM_wall", smooth=True, hint=Vector((side, 0, 0)))
    L_, R_ = sides[-1], sides[1]
    for j in range(ny):
        for col, sgn in ((0, -1), (nz, 1)):
            q = [L_[j][col], R_[j][col], R_[j + 1][col], L_[j + 1][col]]
            mb.face(q, "LM_wall", hint=Vector((0, sgn * -1, 0)))
    for i in range(nz):
        q = [L_[ny][i], L_[ny][i + 1], R_[ny][i + 1], R_[ny][i]]
        mb.face(q, "LM_wall", hint=Vector((0, 0, 1)))
    zz = z0 + 0.2
    k = 0
    while zz < z1 - 0.15:
        s = rng.uniform(0.17, 0.24)
        PN.rock(mb, x + rng.uniform(-0.06, 0.06), zz, h - 0.04, s * 1.25, s, s * 0.75, int(abs(x) * 100 + zz * 10) + k,
                m="LM_wall", subdiv=1, yaw=rng.uniform(0, 3.1))
        zz += s * 1.9
        k += 1


def rock_bump(mb, x, z, y, s, side):
    """A half-buried rounded stone on a wall face (a squashed 6-sided dome facing +-x)."""
    n = 6
    ctr = V(x, z, y)
    tip = ctr + Vector((side * s * 0.35, 0, 0))
    ring = [ctr + Vector((0, -math.cos(2 * math.pi * k / n) * s * 0.55, math.sin(2 * math.pi * k / n) * s * 0.42))
            for k in range(n)]
    for k in range(n):
        k2 = (k + 1) % n
        mb.face([ring[k], ring[k2], tip], "LM_wall", smooth=True, hint=Vector((side, 0, 0)))
