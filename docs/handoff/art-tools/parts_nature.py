"""Nature: the creek (water, granite rocks, cascades, reeds), the arched footbridge, the pavilion (정자), and the
backdrop outside the walk bounds (forested hills, distant mountains with snow tips, the waterfall cliff, the lake
with its pavilion, the sky dome)."""
import math
import random

import bpy
from mathutils import Vector, noise

import vlib as U
from vlib import V, MB

L = U.LAYOUT


def bv():
    import build_village as BV
    return BV


# ---------------------------------------------------------------------------------------------- rocks --

def rock(mb, x, z, y, sx, sz, sy, seed, m="LM_rock", subdiv=2, yaw=0.0):
    """A rounded granite boulder: a subdivided octahedron-sphere with low-frequency noise, flattened."""
    rng = random.Random(seed)
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    off = Vector((rng.uniform(0, 50), rng.uniform(0, 50), rng.uniform(0, 50)))
    c, s = math.cos(yaw), math.sin(yaw)
    pts = {}
    for v in bm.verts:
        n = v.co.normalized()
        d = 1.0 + 0.22 * noise.noise(n * 1.3 + off) + 0.08 * noise.noise(n * 3.1 + off)
        p = Vector((n.x * sx * d, n.y * sz * d, n.z * sy * d))
        if p.z < 0:
            p.z *= 0.5
        rx = p.x * c - p.y * s
        ry = p.x * s + p.y * c
        pts[v.index] = V(x, z, y) + Vector((rx, ry, p.z))
    for f in bm.faces:
        mb.face([pts[v.index] for v in f.verts], m, smooth=True,
                hint=(sum((pts[v.index] for v in f.verts), Vector()) / len(f.verts)) - V(x, z, y))
    bm.free()


# ---------------------------------------------------------------------------------------------- creek --

CASCADES = (-40.0, 32.0)          # x of the small cascades (water steps down eastward)


def water_level(x):
    BV = bv()
    lv = BV.WATER_Y + 0.12
    for cx in CASCADES:
        if x > cx:
            lv -= 0.14
    return lv


def creek(c, cols):
    BV = bv()
    curve = BV.creek_curve()
    w = MB()
    # water ribbon in pieces between cascades (UV u along the flow, v across: pool half of T_water)
    half = 2.75
    acc = 0.0
    for (x0, z0), (x1, z1) in zip(curve[:-1], curve[1:]):
        seg_len = math.hypot(x1 - x0, z1 - z0)
        y0, y1 = water_level(x0), water_level(x1)
        if y0 != y1:
            # cascade: a short foam drop between the two levels
            xm = next(cx for cx in CASCADES if x0 < cx <= x1)
            zm = BV.creek_z(xm)
            pts = [V(xm, zm - half, y0), V(xm, zm + half, y0), V(xm + 0.6, zm + half, y1), V(xm + 0.6, zm - half, y1)]
            w.face(pts, "A_foam", [(0.5, 1), (1.0, 1), (1.0, 0), (0.5, 0)], hint=Vector((0, 0, 1)))
            y0 = y1
        n0 = Vector((-(z1 - z0), (x1 - x0))).normalized()      # game (x, z) normal of the flow direction
        pts = [V(x0 - n0.x * half, z0 - n0.y * half, y0), V(x1 - n0.x * half, z1 - n0.y * half, y1),
               V(x1 + n0.x * half, z1 + n0.y * half, y1), V(x0 + n0.x * half, z0 + n0.y * half, y0)]
        u0 = (acc % 12.0) / 24.0
        u1 = u0 + seg_len / 24.0
        if u1 > 0.5:
            u0, u1 = u0 - 0.25, u1 - 0.25
        w.face(pts, "M_water", [(u0, 0.02), (u1, 0.02), (u1, 0.47), (u0, 0.47)], hint=Vector((0, 0, 1)))
        acc += seg_len
    w.finish("creek_water", c, cat="water", auto=False)
    # granite boulders: big pale slabs (너럭바위) on the banks and in the water, weirs at the cascades
    rb = MB()
    rng = random.Random(77)
    gap = L["stream"]["bridgeGap"]
    for i in range(64):
        x = rng.uniform(-93, 93)
        if gap["minX"] - 2.5 < x < gap["maxX"] + 2.5:
            continue
        zc = BV.creek_z(x)
        side = rng.choice((-1, 1))
        d = rng.uniform(1.4, 4.2)
        s = rng.uniform(0.6, 1.8) if d > 2.4 else rng.uniform(0.4, 1.1)
        y = water_level(x) - 0.1 if d < 2.6 else BV.ground_h(x, zc + side * d) - s * 0.15
        rock(rb, x, zc + side * d, y, s * rng.uniform(1.0, 1.6), s, s * rng.uniform(0.35, 0.55), 600 + i,
             subdiv=2 if s > 1.0 else 1, yaw=rng.uniform(0, math.pi))
    for cx in CASCADES:
        zc = BV.creek_z(cx)
        for k in range(7):
            zz = zc - 2.9 + k * 0.95
            s = rng.uniform(0.45, 0.75)
            rock(rb, cx + rng.uniform(-0.2, 0.3), zz, water_level(cx) - 0.25, s * 1.2, s, s * 0.6, 700 + k + int(cx),
                 subdiv=1)
    # abutment stones of the bridge
    rb.finish("creek_rocks", c)
    # reeds along both water edges (flora row 3), denser near the bridge and the pavilion
    rd = MB()
    for i in range(520):
        x = rng.uniform(-94, 94)
        if gap["minX"] - 1.0 < x < gap["maxX"] + 1.0:
            continue
        zc = BV.creek_z(x)
        side = rng.choice((-1, 1))
        d = rng.uniform(2.2, 3.6)
        z = zc + side * d
        y = BV.ground_h(x, z) - 0.05
        yaw = rng.uniform(0, math.pi)
        ww, hh = rng.uniform(0.6, 1.1), rng.uniform(0.7, 1.3)
        cy, sy = math.cos(yaw), math.sin(yaw)
        p = [V(x - cy * ww / 2, z + sy * ww / 2, y), V(x + cy * ww / 2, z - sy * ww / 2, y),
             V(x + cy * ww / 2, z - sy * ww / 2, y + hh), V(x - cy * ww / 2, z + sy * ww / 2, y + hh)]
        u0 = rng.uniform(0, 0.7)
        rd.face(p, "M_leaf_flora", [(u0, 0.004), (u0 + 0.3, 0.004), (u0 + 0.3, 0.246), (u0, 0.246)])
    rd.finish("creek_reeds", c, cat="leaf", auto=False)
    bridge(c)
    pavilion(c, L["pavilion"]["centre"]["x"], L["pavilion"]["centre"]["z"], L["pavilion"]["size"]["x"], "pavilion")
    p = L["pavilion"]
    # camera:false in the layout (the camera looks over the pavilion): the box stays below 1.6 m
    U.collider(cols, p["node"], p["bounds"]["minX"], p["bounds"]["maxX"], p["bounds"]["minZ"], p["bounds"]["maxZ"], 1.2)
    for b in L["stream"]["banks"]:
        U.collider(cols, b["node"], b["minX"], b["maxX"], b["minZ"], b["maxZ"], 1.0)


def bridge(c):
    """Wooden arched footbridge over the gap: walkway flat at y ~ 0 (deck rises 0.12 m), the arch is in the curved
    fascia beams below and the handrails above (visual rise 0.5 m)."""
    b = L["bridge"]
    x0, x1 = b["minX"], b["maxX"]                 # -26 .. -22 (4 m wide)
    z0, z1 = b["minZ"] - 1.2, b["maxZ"] + 1.2      # deck runs onto the banks
    mb = MB()
    wood = U.rgba("#D2A47A")
    dark = U.rgba("#B08360")
    n = 16
    def deck_y(t):
        return 0.03 + 0.12 * math.sin(math.pi * t)
    # the deck: one continuous plank surface following the gentle arch (the plank pattern comes from the texture;
    # separate plank boxes would give the light map 1-texel islands that read black)
    for i in range(n):
        t0, t1 = i / n, (i + 1) / n
        za, zb = z0 + t0 * (z1 - z0), z0 + t1 * (z1 - z0)
        q = [V(x0 + 0.05, za, deck_y(t0)), V(x1 - 0.05, za, deck_y(t0)), V(x1 - 0.05, zb, deck_y(t1)),
             V(x0 + 0.05, zb, deck_y(t1))]
        uv = [(0.0, za / 1.2), (2.0, za / 1.2), (2.0, zb / 1.2), (0.0, zb / 1.2)]
        mb.face(q, "LM_wood", uv, tint=wood, hint=Vector((0, 0, 1)))
    # arched fascia beams on both sides: from the abutments (y -0.55) up to the deck (y 0.0)
    for xs in (x0 + 0.02, x1 - 0.02):
        sgn = -1 if xs < (x0 + x1) / 2 else 1
        top, bot = [], []
        for i in range(n + 1):
            t = i / n
            zz = z0 + t * (z1 - z0)
            top.append(V(xs, zz, deck_y(t) - 0.04))
            bot.append(V(xs, zz, -0.55 + 0.5 * math.sin(math.pi * t) ** 0.7))
        for i in range(n):
            for off in (0.0, -0.12 * sgn):
                q = [bot[i] + Vector((off, 0, 0)), bot[i + 1] + Vector((off, 0, 0)), top[i + 1] + Vector((off, 0, 0)),
                     top[i] + Vector((off, 0, 0))]
                mb.face(q, "LM_wood", tint=dark, hint=Vector((sgn if off == 0 else -sgn, 0, 0)))
            mb.face([bot[i], bot[i + 1], bot[i + 1] + Vector((-0.12 * sgn, 0, 0)), bot[i] + Vector((-0.12 * sgn, 0, 0))],
                    "LM_wood", tint=dark, hint=Vector((0, 0, -1)))
        # handrail: posts and an arched top rail (visual rise 0.5 m at mid-span)
        for i in range(0, n + 1, 2):
            t = i / n
            zz = z0 + t * (z1 - z0)
            ytop = deck_y(t) + 0.95 + 0.38 * math.sin(math.pi * t)
            mb.box(xs - 0.05 * sgn, zz, deck_y(t) - 0.05, 0.09, 0.09, ytop - deck_y(t) + 0.05, "LM_wood", tint=wood)
        rail = [V(xs - 0.05 * sgn, z0 + (i / n) * (z1 - z0), deck_y(i / n) + 0.95 + 0.38 * math.sin(math.pi * i / n))
                for i in range(n + 1)]
        mb.tube(rail, [0.055] * (n + 1), "LM_wood", segs=6, tint=wood, uv_v=0.5)
        mid = [V(xs - 0.05 * sgn, z0 + (i / n) * (z1 - z0), deck_y(i / n) + 0.5 + 0.2 * math.sin(math.pi * i / n))
               for i in range(n + 1)]
        mb.tube(mid, [0.03] * (n + 1), "LM_wood", segs=5, tint=wood, uv_v=0.5)
    # stone abutments at both ends
    for zz in (b["minZ"] - 0.6, b["maxZ"] + 0.6):
        mb.box((x0 + x1) / 2, zz, -0.9, x1 - x0 + 0.6, 1.3, 0.92, "LM_stone")
    mb.finish("bridge", c)


def pavilion(c, cx, cz, size, name, roof_tint="#5B5F66", floor_y=0.55):
    """정자: raised wooden floor, red-brown pillars, railing, a dark tiled hip roof with upturned eaves."""
    mb = MB()
    hs = size / 2 - 0.35
    wood = U.rgba("#9E6B4A")
    pillar = U.rgba("#8E3B27")
    # stone footings + floor
    for sx in (-1, 1):
        for sz in (-1, 1):
            mb.box(cx + sx * hs, cz + sz * hs, 0.0, 0.5, 0.5, 0.3, "LM_stone")
    mb.box(cx, cz, floor_y - 0.12, 2 * hs + 0.5, 2 * hs + 0.5, 0.14, "LM_wood", tint=wood)
    for k in range(4):
        mb.box(cx, cz, 0.3, 2 * hs + 0.3, 0.16, floor_y - 0.42, "LM_wood", tint=wood) if k == 0 else None
    # pillars (round, red-brown) and beams
    for sx in (-1, 1):
        for sz in (-1, 1):
            mb.lathe(cx + sx * hs, cz + sz * hs, [(0.15, 0.3), (0.13, 3.0)], "LM_wood", segs=10, tint=pillar)
    for (bx, bz, lx, lz) in ((cx, cz - hs, 2 * hs + 0.4, 0.22), (cx, cz + hs, 2 * hs + 0.4, 0.22),
                             (cx - hs, cz, 0.22, 2 * hs + 0.4), (cx + hs, cz, 0.22, 2 * hs + 0.4)):
        mb.box(bx, bz, 2.75, lx, lz, 0.3, "LM_wood", tint=pillar)
    # dancheong band under the eaves (atlas)
    for (ax, az, bx, bz, nx, nz) in ((cx - hs, cz + hs + 0.12, cx + hs, cz + hs + 0.12, 0, 1),
                                     (cx + hs, cz - hs - 0.12, cx - hs, cz - hs - 0.12, 0, -1),
                                     (cx + hs + 0.12, cz + hs, cx + hs + 0.12, cz - hs, 1, 0),
                                     (cx - hs - 0.12, cz - hs, cx - hs - 0.12, cz + hs, -1, 0)):
        pts = [V(ax, az, 2.75), V(bx, bz, 2.75), V(bx, bz, 3.05), V(ax, az, 3.05)]
        mb.face(pts, "A_paint", [U.region_uv("dancheong", 0, 0), U.region_uv("dancheong", 4, 0),
                                 U.region_uv("dancheong", 4, 1), U.region_uv("dancheong", 0, 1)],
                hint=V(nx, nz) - V(0, 0))
    # railing (gyeja-nan) on three sides at the floor edge
    for (sx, sz) in ((0, 1), (1, 0), (-1, 0)):
        if sz:
            mb.box(cx, cz + sz * (hs + 0.15), floor_y + 0.45, 2 * hs, 0.06, 0.06, "LM_wood", tint=pillar)
        else:
            mb.box(cx + sx * (hs + 0.15), cz, floor_y + 0.45, 0.06, 2 * hs, 0.06, "LM_wood", tint=pillar)
    # roof: four curved planes from the eaves (overhang 1.2, corners turned up) to a short ridge
    ov = 1.25
    E = hs + ov
    ye, yr = 3.05, 5.0
    ridge = 0.6
    nseg, nt = 10, 6
    def roof_pt(side, u, t):
        # side 0..3; u in [-1, 1] along the eave; t 0 (eave) .. 1 (ridge)
        e = E * (1 - t) + ridge * t
        along = u * (E * (1 - t) + ridge * t)
        up = abs(u) ** 3 * 0.45 * (1 - t)
        y = ye + (yr - ye) * (t ** 1.7) + up
        if side == 0:
            return V(cx + along, cz + e, y)
        if side == 1:
            return V(cx + e, cz - along, y)
        if side == 2:
            return V(cx - along, cz - e, y)
        return V(cx - e, cz + along, y)
    rt = U.rgba(roof_tint)
    for side in range(4):
        for i in range(nseg):
            for j in range(nt):
                u0, u1 = -1 + 2 * i / nseg, -1 + 2 * (i + 1) / nseg
                t0, t1 = j / nt, (j + 1) / nt
                q = [roof_pt(side, u0, t0), roof_pt(side, u1, t0), roof_pt(side, u1, t1), roof_pt(side, u0, t1)]
                fc = sum(q, Vector()) / 4
                mb.face(q, "LM_roof", tint=rt, smooth=True, hint=fc - V(cx, cz, ye - 3))
                mb.face(q[::-1], "LM_wood", tint=U.rgba("#6E4A36"), smooth=True, hint=V(cx, cz, ye - 3) - fc)
    mb.box(cx, cz, yr - 0.05, 2 * ridge + 0.4, 0.35, 0.3, "LM_roof", tint=U.rgba("#45484E"))
    mb.finish(name, c)


# ------------------------------------------------------------------------------------------- backdrop --

def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


LAKE = L["backdrop"]["lake"]
FALL = L["backdrop"]["waterfall"]


def lake_d(x, z):
    """Signed-ish distance to the lake ellipse (negative inside)."""
    cx, cz = LAKE["centre"]["x"], LAKE["centre"]["z"]
    rx, rz = LAKE["size"]["x"] / 2, LAKE["size"]["z"] / 2
    q = math.hypot((x - cx) / rx, (z - cz) / rz)
    return (q - 1.0) * min(rx, rz)


def terrain_h(x, z):
    BV = bv()
    d = max(abs(x), abs(z)) - 97.0
    r = math.hypot(x, z)
    h = BV.ground_h(x, z) if d <= 15 else 3.0 + min(d - 15, 120) * 0.05
    if d > 15:
        # near forested hills: low and rounded (<= ~8 deg seen from the plaza); a far mountain range with snow
        # tops (r 650..1050, <= ~9 deg), kept low toward the sunset (east-north-east, over the lake)
        az = math.degrees(math.atan2(x, -z)) % 360
        daz = min(abs(az - U.LOOK["sun_azimuth_deg"]), 360 - abs(az - U.LOOK["sun_azimuth_deg"]))
        low = 1 - 0.8 * math.exp(-(daz / 38.0) ** 2)
        n1 = noise.fractal(Vector((x * 0.0075, z * 0.0075, 0.3)), 0.9, 2.0, 4)
        hills = max(0.0, 16 + 16 * n1) * smooth(25, 180, d) * (0.4 + 0.6 * low)
        n3 = noise.fractal(Vector((x * 0.0034, z * 0.0034, 4.1)), 1.0, 2.0, 3)
        mid = max(0.0, 28 + 26 * n3) * smooth(230, 470, r) * (0.45 + 0.55 * low)
        h += mid
        n2 = noise.ridged_multi_fractal(Vector((x * 0.0017, z * 0.0017, 1.7)), 1.1, 2.0, 4, 1.0, 2.0)
        mount = (max(0.0, n2) ** 1.25 * 125 + 14) * smooth(620, 880, r) * low
        h += hills + mount
    # the lake basin (east), kept low with a meadow shore
    ld = lake_d(x, z)
    if ld < 40:
        k = smooth(40, 4, ld)
        h = h * (1 - k) + (-1.4 if ld < 0 else 0.15 * ld / 4 if ld < 4 else 0.3) * k
    # the forested ridge behind the waterfall cliff (west-north-west): steep only right behind the cliff
    fx, fz = FALL["centre"]["x"], FALL["centre"]["z"]
    dz = abs(z - fz)
    if dz < 85 and x < fx + 40:
        front = fx + 1.0 + 0.5 * max(0.0, dz - 15.0)
        k = smooth(front, front - 4.0 - 1.6 * max(0.0, dz - 15.0), x) * smooth(85, 35, dz)
        h = max(h, (FALL["height"] + 5) * k + h * (1 - k))
    return h


def backdrop(c):
    BV = bv()
    backdrop_materials()
    # --- terrain grid around the walk area (hole inside the ground grid)
    def axis():
        out = []
        x = -1100.0
        while x < 1100.0:
            out.append(x)
            ax = abs(x)
            x += 28.0 if ax > 440 else 20.0 if ax > 260 else 12.0 if ax > 150 else 7.0
        out.append(1100.0)
        return out
    xs = axis()
    zs = axis()
    H = [[terrain_h(x, z) for x in xs] for z in zs]
    near, far = MB(), MB()
    G = BV.GROUND_HALF
    for j in range(len(zs) - 1):
        for i in range(len(xs) - 1):
            x0, x1, z0, z1 = xs[i], xs[i + 1], zs[j], zs[j + 1]
            if max(abs(x0), abs(x1)) <= G + 0.01 and max(abs(z0), abs(z1)) <= G + 0.01:
                continue
            pts = [V(x0, z0, H[j][i]), V(x1, z0, H[j][i + 1]), V(x1, z1, H[j + 1][i + 1]), V(x0, z1, H[j + 1][i])]
            r = math.hypot((x0 + x1) / 2, (z0 + z1) / 2)
            (near if r < 320 else far).face(pts, "BD_terrain", hint=Vector((0, 0, 1)), smooth=True)
    near.finish("backdrop_near", c, cat="backdrop", auto=False)
    far.finish("backdrop_far", c, cat="backdrop", auto=False)

    # --- the ground grid edge (|x| or |z| = G) meets the terrain exactly: ground_h(G) == terrain_h(G) (d = 15)
    # --- waterfall cliff: a concave rock wall facing east, a falling ribbon, a plunge pool
    fx, fz = FALL["centre"]["x"], FALL["centre"]["z"]
    Wd, Ht = FALL["size"]["x"] + 10, FALL["height"] + 4
    cl = MB()
    nu, nv = 40, 30

    def face_x(u, v):
        zz = fz + u * Wd / 2
        ledge = 0.9 * math.floor(v * 7.0 + 0.4 * noise.noise(Vector((zz * 0.08, 1.0, 3.0)))) / 7.0
        nn = (noise.noise(Vector((zz * 0.10, v * 3.0, 2.2))) * 2.4 + noise.noise(Vector((zz * 0.33, v * 8.0, 5.1))) * 1.0
              + noise.noise(Vector((zz * 0.9, v * 22.0, 8.3))) * 0.35)
        return fx + 2.0 + 7.0 * u * u - 3.5 * v + nn - ledge * 2.2 + 1.5 * abs(u) ** 3
    grid = []
    for j in range(nv + 1):
        row = []
        for i in range(nu + 1):
            u = -1 + 2 * i / nu
            v = j / nv
            row.append(V(face_x(u, v), fz + u * Wd / 2, -0.8 + v * (Ht + 4)))
        grid.append(row)
    for j in range(nv):
        for i in range(nu):
            q = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]]
            cl.face(q, "BD_rock", smooth=True, hint=Vector((1, 0, 0)))
    rng = random.Random(5)
    for k in range(26):
        u = rng.uniform(-1, 1)
        zz = fz + u * Wd / 2
        rock(cl, face_x(u, 0) + rng.uniform(1.5, 9), zz, -0.3, rng.uniform(1.2, 3.2), rng.uniform(1.0, 2.6),
             rng.uniform(0.8, 1.8), 800 + k, m="BD_rock", subdiv=2, yaw=rng.uniform(0, 3))
    cl.finish("waterfall_cliff", c, cat="backdrop", auto=False)
    wf = MB()
    for k, (uc, ww) in enumerate(((-0.06, 4.2), (0.22, 2.0))):
        n = 24
        for j in range(n):
            v0, v1 = j / n, (j + 1) / n
            def P(v, side, uc=uc, ww=ww):
                spread = ww / 2 * (1 + 0.5 * (1 - v))
                zz = fz + uc * Wd / 2 + side * spread
                u = (zz - fz) / (Wd / 2)
                return V(face_x(u, v) + 0.45 + 0.6 * (1 - v) ** 2, zz, -0.4 + v * (Ht + 3.8))
            q = [P(v0, -1), P(v0, 1), P(v1, 1), P(v1, -1)]
            wf.face(q, "M_waterfall", [(0.0, v0 * 3), (0.5, v0 * 3), (0.5, v1 * 3), (0.0, v1 * 3)], hint=Vector((1, 0, 0)))
    # foam at the plunge
    pc_x = face_x(0, 0) + 3.0
    ring = [V(pc_x + 3.2 * math.cos(2 * math.pi * i / 16), fz + 3.8 * math.sin(2 * math.pi * i / 16), -0.12) for i in range(16)]
    wf.face(ring, "A_foam", [(0.75 + 0.24 * math.cos(2 * math.pi * i / 16), 0.5 + 0.45 * math.sin(2 * math.pi * i / 16))
                             for i in range(16)], hint=Vector((0, 0, 1)))
    # mist at the base: soft billboards (M_waterfall, mist half of T_falls), crossed
    for k in range(5):
        mx = pc_x + 1.0 + k * 0.9
        mz = fz + (k - 2) * 2.2
        for a in (0.0, math.pi / 2, math.pi / 4):
            ca, sa = math.cos(a), math.sin(a)
            r = 3.2 + 0.4 * k
            q = [V(mx - ca * r, mz + sa * r, -0.2), V(mx + ca * r, mz - sa * r, -0.2),
                 V(mx + ca * r, mz - sa * r, 2.0 * r - 0.2), V(mx - ca * r, mz + sa * r, 2.0 * r - 0.2)]
            wf.face(q, "M_waterfall", [(0.5, 0.0), (1.0, 0.0), (1.0, 1.0), (0.5, 1.0)])
    # the feeder stream from the plunge pool to the creek (outside the walk bounds)
    BV2 = bv()
    pts = BV2.feeder_pts()
    acc = 0.0
    total = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts[:-1], pts[1:]))
    for a, b in zip(pts[:-1], pts[1:]):
        n = max(1, int(math.hypot(b[0] - a[0], b[1] - a[1]) / 2.0))
        for i in range(n):
            t0, t1 = i / n, (i + 1) / n
            x0, z0 = a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0
            x1, z1 = a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1
            sl = math.hypot(x1 - x0, z1 - z0)
            nx, nz = -(z1 - z0) / sl, (x1 - x0) / sl
            f0 = (acc + math.hypot(x0 - a[0], z0 - a[1])) / total
            f1 = (acc + math.hypot(x1 - a[0], z1 - a[1])) / total
            y0, y1 = -0.2 - 0.23 * f0, -0.2 - 0.23 * f1
            hw = 1.6
            q = [V(x0 - nx * hw, z0 - nz * hw, y0), V(x1 - nx * hw, z1 - nz * hw, y1), V(x1 + nx * hw, z1 + nz * hw, y1),
                 V(x0 + nx * hw, z0 + nz * hw, y0)]
            u0 = ((f0 * total) % 12.0) / 24.0
            u1 = u0 + sl / 24.0
            if u1 > 0.5:
                u0, u1 = u0 - 0.25, u1 - 0.25
            wf.face(q, "M_water", [(u0, 0.1), (u1, 0.1), (u1, 0.4), (u0, 0.4)], hint=Vector((0, 0, 1)))
        acc += math.hypot(b[0] - a[0], b[1] - a[1])
    # plunge pool and the lake surface
    def disc(cx_, cz_, rx, rz, y, segs, uvs_scale):
        for i in range(segs):
            a0, a1 = 2 * math.pi * i / segs, 2 * math.pi * (i + 1) / segs
            pts = [V(cx_, cz_, y), V(cx_ + rx * math.cos(a0), cz_ + rz * math.sin(a0), y),
                   V(cx_ + rx * math.cos(a1), cz_ + rz * math.sin(a1), y)]
            uv = [(0.25, 0.5), (0.25 + 0.24 * math.cos(a0), 0.5 + 0.48 * math.sin(a0)),
                  (0.25 + 0.24 * math.cos(a1), 0.5 + 0.48 * math.sin(a1))]
            wf.face(pts, "M_water", uv, hint=Vector((0, 0, 1)))
    disc(fx + 7, fz, 8, 11, -0.2, 32, 1)
    lc = LAKE["centre"]
    disc(lc["x"], lc["z"], LAKE["size"]["x"] / 2 + 3, LAKE["size"]["z"] / 2 + 3, -0.35, 64, 1)
    wf.finish("backdrop_water", c, cat="water", auto=False)
    # lake pavilion on a short pier
    lp = LAKE["pavilion"]
    pavilion(c, lp["centre"]["x"], lp["centre"]["z"], lp["size"]["x"], "lake_pavilion", floor_y=0.7)
    pier = MB()
    for i in range(int((lp["centre"]["x"] - 3 - 96) / 0.18)):
        xx = 96 + i * 0.18
        pier.box(xx, lp["centre"]["z"], 0.45, 0.15, 1.8, 0.06, "LM_wood", tint=U.rgba("#A67C5A"))
    pier.finish("lake_pier", c)
    # --- sky dome (M_sky): u = azimuth from north clockwise, v = elevation -10..90 deg
    sky = MB()
    Rk = 1400.0
    segs, rings = 64, 20
    for j in range(rings):
        e0, e1 = -10 + 100 * j / rings, -10 + 100 * (j + 1) / rings
        for i in range(segs):
            a0, a1 = 2 * math.pi * i / segs, 2 * math.pi * (i + 1) / segs
            def P(a, e):
                er = math.radians(e)
                gx, gz = math.sin(a) * math.cos(er) * Rk, -math.cos(a) * math.cos(er) * Rk
                return V(gx, gz, math.sin(er) * Rk - 60)
            q = [P(a0, e0), P(a1, e0), P(a1, e1), P(a0, e1)]
            uv = [(i / segs, (e0 + 10) / 100), ((i + 1) / segs, (e0 + 10) / 100), ((i + 1) / segs, (e1 + 10) / 100),
                  (i / segs, (e1 + 10) / 100)]
            sky.face(q, "M_sky", uv, hint=-(sum(q, Vector()) / 4))
    dome = sky.finish("sky_dome", c, cat="sky", auto=False)
    dome.visible_camera = False
    dome.visible_diffuse = False
    dome.visible_glossy = False
    dome.visible_shadow = False
    dome.visible_transmission = False
    dome.visible_volume_scatter = False


def backdrop_materials():
    """Procedural authoring materials of the backdrop (baked into M_backdrop by bake_village.py)."""
    import vlib as U2
    if "BD_terrain" in bpy.data.materials:
        return
    # terrain: meadow -> forest canopy by height/distance, rock on steep slopes, snow on high peaks
    m = bpy.data.materials.new("BD_terrain")
    m["export"] = "M_backdrop"
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.9
    tc = nt.nodes.new("ShaderNodeTexCoord")
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs[0])
    # crowns: voronoi (F1 distance) at ~7 m -> bumpy canopy; colour variation by a second noise
    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.inputs["Scale"].default_value = 0.28
    nt.links.new(tc.outputs["Object"], vor.inputs["Vector"])
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 0.02
    nz.inputs["Detail"].default_value = 6
    nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
    ramp_f = nt.nodes.new("ShaderNodeValToRGB")
    e = ramp_f.color_ramp.elements
    e[0].position, e[0].color = 0.25, U2.rgba("#1C3319")
    e[1].position, e[1].color = 0.75, U2.rgba("#3F6328")
    # per-crown variation: voronoi cell colour mixed with the large-scale noise -> a canopy of distinct crowns
    vsep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(vor.outputs["Color"], vsep.inputs[0])
    cmix = nt.nodes.new("ShaderNodeMath")
    cmix.operation = "MULTIPLY_ADD"
    cmix.inputs[1].default_value = 0.55
    nt.links.new(vsep.outputs[0], cmix.inputs[0])
    nfac = nt.nodes.new("ShaderNodeMath")
    nfac.operation = "MULTIPLY"
    nfac.inputs[1].default_value = 0.6
    nt.links.new(nz.outputs["Fac"], nfac.inputs[0])
    nt.links.new(nfac.outputs[0], cmix.inputs[2])
    nt.links.new(cmix.outputs[0], ramp_f.inputs["Fac"])
    crown = nt.nodes.new("ShaderNodeMath")
    crown.operation = "POWER"
    crown.inputs[1].default_value = 0.6
    nt.links.new(vor.outputs["Distance"], crown.inputs[0])
    shade = nt.nodes.new("ShaderNodeMix")
    shade.data_type = "RGBA"
    shade.blend_type = "MULTIPLY"
    nt.links.new(crown.outputs[0], shade.inputs["Factor"])
    nt.links.new(ramp_f.outputs["Color"], shade.inputs[6])
    shade.inputs[7].default_value = U2.rgba("#6F7F64")
    # meadow near the village (low height): bright green
    ax = nt.nodes.new("ShaderNodeMath")
    ax.operation = "ABSOLUTE"
    nt.links.new(sep.outputs["X"], ax.inputs[0])
    ay = nt.nodes.new("ShaderNodeMath")
    ay.operation = "ABSOLUTE"
    nt.links.new(sep.outputs["Y"], ay.inputs[0])
    mx = nt.nodes.new("ShaderNodeMath")
    mx.operation = "MAXIMUM"
    nt.links.new(ax.outputs[0], mx.inputs[0])
    nt.links.new(ay.outputs[0], mx.inputs[1])
    meadow_k = nt.nodes.new("ShaderNodeMapRange")
    meadow_k.inputs["From Min"].default_value = 112.0
    meadow_k.inputs["From Max"].default_value = 132.0
    nt.links.new(mx.outputs[0], meadow_k.inputs["Value"])
    mix_m = nt.nodes.new("ShaderNodeMix")
    mix_m.data_type = "RGBA"
    nt.links.new(meadow_k.outputs["Result"], mix_m.inputs["Factor"])
    mix_m.inputs[6].default_value = U2.rgba("#6F8F45")
    nt.links.new(shade.outputs[2], mix_m.inputs[7])
    # rock on steep slopes (normal z), snow above 230 m
    sepn = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Normal"], sepn.inputs[0])
    slope = nt.nodes.new("ShaderNodeMapRange")
    slope.inputs["From Min"].default_value = 0.42
    slope.inputs["From Max"].default_value = 0.30
    nt.links.new(sepn.outputs["Z"], slope.inputs["Value"])
    mix_r = nt.nodes.new("ShaderNodeMix")
    mix_r.data_type = "RGBA"
    high = nt.nodes.new("ShaderNodeMapRange")
    high.inputs["From Min"].default_value = 60.0
    high.inputs["From Max"].default_value = 95.0
    nt.links.new(sep.outputs["Z"], high.inputs["Value"])
    rock_k = nt.nodes.new("ShaderNodeMath")
    rock_k.operation = "MULTIPLY"
    nt.links.new(slope.outputs["Result"], rock_k.inputs[0])
    nt.links.new(high.outputs["Result"], rock_k.inputs[1])
    nt.links.new(rock_k.outputs[0], mix_r.inputs["Factor"])
    nt.links.new(mix_m.outputs[2], mix_r.inputs[6])
    mix_r.inputs[7].default_value = U2.rgba("#4F504C")
    snow = nt.nodes.new("ShaderNodeMapRange")
    snow.inputs["From Min"].default_value = 150.0
    snow.inputs["From Max"].default_value = 162.0
    nt.links.new(sep.outputs["Z"], snow.inputs["Value"])
    mix_s = nt.nodes.new("ShaderNodeMix")
    mix_s.data_type = "RGBA"
    nt.links.new(snow.outputs["Result"], mix_s.inputs["Factor"])
    nt.links.new(mix_r.outputs[2], mix_s.inputs[6])
    mix_s.inputs[7].default_value = U2.rgba("#F2F4F7")
    # aerial perspective: darken the surface and add in-scattered haze with distance (baked into M_backdrop)
    ln = nt.nodes.new("ShaderNodeVectorMath")
    ln.operation = "LENGTH"
    nt.links.new(tc.outputs["Object"], ln.inputs[0])
    hz = nt.nodes.new("ShaderNodeMath")
    hz.operation = "SUBTRACT"
    hz.inputs[1].default_value = 130.0
    nt.links.new(ln.outputs["Value"], hz.inputs[0])
    hz2 = nt.nodes.new("ShaderNodeMath")
    hz2.operation = "DIVIDE"
    hz2.inputs[1].default_value = -650.0
    nt.links.new(hz.outputs[0], hz2.inputs[0])
    hz3 = nt.nodes.new("ShaderNodeMath")
    hz3.operation = "EXPONENT"
    nt.links.new(hz2.outputs[0], hz3.inputs[0])
    fac = nt.nodes.new("ShaderNodeMath")
    fac.operation = "SUBTRACT"
    fac.use_clamp = True
    fac.inputs[0].default_value = 1.0
    nt.links.new(hz3.outputs[0], fac.inputs[1])
    dk = nt.nodes.new("ShaderNodeMix")
    dk.data_type = "RGBA"
    fac_d = nt.nodes.new("ShaderNodeMath")
    fac_d.operation = "MULTIPLY"
    fac_d.inputs[1].default_value = 0.62
    nt.links.new(fac.outputs[0], fac_d.inputs[0])
    nt.links.new(fac_d.outputs[0], dk.inputs["Factor"])
    nt.links.new(mix_s.outputs[2], dk.inputs[6])
    dk.inputs[7].default_value = (0.0, 0.0, 0.0, 1.0)
    dk.inputs["Factor"].default_value = 0.0
    nt.links.new(dk.outputs[2], bsdf.inputs["Base Color"])
    em = nt.nodes.new("ShaderNodeMath")
    em.operation = "MULTIPLY"
    em.inputs[1].default_value = 0.42
    nt.links.new(fac.outputs[0], em.inputs[0])
    bsdf.inputs["Emission Color"].default_value = U2.rgba(U2.LOOK.get("haze", "#E6D9D0"))
    nt.links.new(em.outputs[0], bsdf.inputs["Emission Strength"])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.35
    bump.inputs["Distance"].default_value = 1.0
    nt.links.new(crown.outputs[0], bump.inputs["Height"])
    nt.links.new(bump.outputs[0], bsdf.inputs["Normal"])
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    U2._MATS["BD_terrain"] = m
    # cliff rock: rock texture triplanar-ish via object coords box projection + moss in the crevices
    r = bpy.data.materials.new("BD_rock")
    r["export"] = "M_backdrop"
    nt = r.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.8
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (0.28, 0.28, 0.28)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = U2.img("rock_boulder_dry_diff_1k.jpg")
    tex.projection = "BOX"
    tex.projection_blend = 0.3
    nt.links.new(mp.outputs[0], tex.inputs["Vector"])
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 0.15
    nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
    moss = nt.nodes.new("ShaderNodeMix")
    moss.data_type = "RGBA"
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = 0.55
    mr.inputs["From Max"].default_value = 0.7
    nt.links.new(nz.outputs["Fac"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], moss.inputs["Factor"])
    nt.links.new(tex.outputs["Color"], moss.inputs[6])
    moss.inputs[7].default_value = U2.rgba("#3F5A2C")
    nt.links.new(moss.outputs[2], bsdf.inputs["Base Color"])
    bp = nt.nodes.new("ShaderNodeBump")
    bp.inputs["Strength"].default_value = 0.6
    nt.links.new(tex.outputs["Color"], bp.inputs["Height"])
    nt.links.new(bp.outputs[0], bsdf.inputs["Normal"])
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    U2._MATS["BD_rock"] = r
