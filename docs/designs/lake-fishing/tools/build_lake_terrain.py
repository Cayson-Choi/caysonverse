"""Build the 케이슨 낚시터 authoring scene: terrain pieces (seam vertices = the village's), water mesh with depth values,
bank / riprap / gravel / dirt pad, the lane_lake trail, the vegetation (parts_lake_veg.py), the shadow-casting greybox of
the facilities (B's structures.blend replaces it when it exists), night light empties, sun and world.

  blender -b --factory-startup -P art/lake/tools/build_lake_terrain.py -- [--parts terrain,veg] [--seed N]

Needs art/village/layout.json (npx tsx scripts/export-village-layout.ts) for the village's own ground functions, and
art/lake/layout.json (scripts/export-lake-layout.ts). Writes art/lake/work/lake_authoring.blend.
"""
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
LAKE_ROOT = os.path.dirname(HERE)
REPO = os.path.dirname(os.path.dirname(LAKE_ROOT))
VILLAGE_TOOLS = os.path.join(REPO, "art", "village", "tools")
os.environ.setdefault("CV_LAYOUT", os.path.join(REPO, "art", "village", "layout.json"))
sys.path.insert(0, VILLAGE_TOOLS)
sys.path.insert(0, HERE)

import vlib as U  # noqa: E402
from vlib import V, MB  # noqa: E402
import build_village as BV  # noqa: E402  (registers the village's authoring materials in U.MATSPEC)
import parts_nature as PN  # noqa: E402
import lake_geo as G  # noqa: E402

WORK = os.path.join(LAKE_ROOT, "work")
TEXL = os.path.join(WORK, "tex")
os.makedirs(WORK, exist_ok=True)
LAY = G.LAY

U.MATSPEC["LM_rock"]["tint"] = True     # the riprap is darkened with its vertex colour
U.MATSPEC.update({
    "LM_mud": dict(tex=os.path.join(TEXL, "T_mud.png"), tile=2.2, rough=0.95, tint=True, nor="rock_boulder_dry_nor_gl_1k.jpg",
                   nor_strength=0.25),
    "LM_gravel": dict(tex=os.path.join(TEXL, "T_gravel.png"), tile=1.6, rough=0.95, tint=True,
                      nor="rock_boulder_dry_nor_gl_1k.jpg", nor_strength=0.5),
    "M_lakewater": dict(color="#2d3b1f", rough=0.05),
    "LM_dirt": dict(tex=os.path.join(TEXL, "T_dirt.png"), tile=2.0, rough=0.95, tint=True,
                    nor="rock_boulder_dry_nor_gl_1k.jpg", nor_strength=0.25),
})


def arg(name, default=None, cast=str):
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for x in a:
        if x.startswith(name + "="):
            return cast(x.split("=", 1)[1])
    return cast(a[a.index(name) + 1]) if name in a else default


# ------------------------------------------------------------------------------------------------ the seam

X_E = [112.0, 119.0, 126.0, 133.0, 140.0, 147.0, 154.0, 166.0, 178.0, 190.0]     # the village backdrop grid's lines
Z_E = [-70.0 + 7.0 * k for k in range(18)]                                         # -70 .. 49
GROUND_X = [95.5 + 2.5 * k for k in range(7)]                                       # village ground grid, to 110.5
GROUND_Z = [-69.5 + 2.5 * k for k in range(47)]                                     # -69.5 .. 45.5


def ordered_loop():
    """West edge (north to south), south edge (west to east), east, north edge back: one orientation."""
    gh = BV.ground_h
    th = PN.terrain_h
    loop = []
    for z in GROUND_Z[:-1]:
        loop.append((95.5, z, gh(95.5, z)))
    for x in GROUND_X:
        loop.append((x, 45.5, gh(x, 45.5)))
    loop.append((112.0, 45.5, th(112.0, 45.5)))
    loop.append((112.0, 49.0, th(112.0, 49.0)))
    for x in X_E[1:]:
        loop.append((x, 49.0, th(x, 49.0)))
    for z in reversed(Z_E[:-1]):
        loop.append((190.0, z, th(190.0, z)))
    for x in reversed(X_E[:-1]):
        loop.append((x, -70.0, th(x, -70.0)))
    loop.append((112.0, -69.5, th(112.0, -69.5)))
    for x in reversed(GROUND_X[1:]):
        loop.append((x, -69.5, gh(x, -69.5)))
    return loop


# ----------------------------------------------------------------------------------------------- quadtree

X_AXIS = [95.5 + 4.125 * i for i in range(4)] + [112.0 + 3.9 * i for i in range(21)]
Z_AXIS = [-70.0, -69.5] + [-69.5 + (115.0 / 29.0) * i for i in range(1, 30)] + [49.0]
Z_AXIS[-2] = 45.5


def inside_domain(cx, cz):
    return (cx > 112.0) or (-69.5 < cz < 45.5)


def build_cells():
    """Leaf rectangles (x0, x1, z0, z1): refined near the water, the walk limit and the lane."""
    cells = []
    for i in range(len(X_AXIS) - 1):
        for j in range(len(Z_AXIS) - 1):
            x0, x1, z0, z1 = X_AXIS[i], X_AXIS[i + 1], Z_AXIS[j], Z_AXIS[j + 1]
            if inside_domain((x0 + x1) / 2, (z0 + z1) / 2) and not (x1 <= 112.0 and (z1 <= -69.5 or z0 >= 45.5)):
                cells.append((x0, x1, z0, z1))
    cells = np.array(cells, float)
    # (min size to reach, band distance): a cell is split while it is bigger than `size` and within `reach` of the water
    # (size, lo, hi): a cell is split to `size` while it reaches into the signed shore-distance band [lo, hi] (water is negative)
    rules = [(2.0, -13.0, 13.0), (1.0, -4.0, 5.0), (0.5, -1.4, 2.5)]
    done = []
    work = cells
    for size, lo, hi in rules:
        cx = (work[:, 0] + work[:, 1]) / 2
        cz = (work[:, 2] + work[:, 3]) / 2
        diag = np.hypot(work[:, 1] - work[:, 0], work[:, 3] - work[:, 2]) / 2
        s = G.signed_shore(cx, cz)
        inw = G.inside_closed(cx, cz, G.WALK)
        dwalk = G.dist_closed(cx, cz, G.WALK)
        bigger = (np.minimum(work[:, 1] - work[:, 0], work[:, 3] - work[:, 2]) > size * 1.01)
        want = (s + diag > lo) & (s - diag < hi)
        if size >= 1.0:
            want = want | ((dwalk - diag < (1.5 if size == 1.0 else 3.0)) & (s > 0))
        split = bigger & want
        keep = work[~split]
        done.append(keep)
        sp = work[split]
        if len(sp) == 0:
            work = sp
            break
        xm = (sp[:, 0] + sp[:, 1]) / 2
        zm = (sp[:, 2] + sp[:, 3]) / 2
        work = np.vstack([
            np.stack([sp[:, 0], xm, sp[:, 2], zm], 1), np.stack([xm, sp[:, 1], sp[:, 2], zm], 1),
            np.stack([sp[:, 0], xm, zm, sp[:, 3]], 1), np.stack([xm, sp[:, 1], zm, sp[:, 3]], 1)])
    done.append(work)
    return np.vstack([d for d in done if len(d)])


def key(x, z):
    return (int(round(x * 1000)), int(round(z * 1000)))


def terrain_triangles(cells):
    """Triangles (as vertex-key triples) of the leaf cells with the T-junctions closed by the neighbours' vertices."""
    verts = {}
    on_z = {}        # z key -> set of x keys of vertices on that horizontal line
    on_x = {}
    for x0, x1, z0, z1 in cells:
        for x, z in ((x0, z0), (x1, z0), (x1, z1), (x0, z1)):
            k = key(x, z)
            verts[k] = (x, z)
            on_z.setdefault(k[1], set()).add(k[0])
            on_x.setdefault(k[0], set()).add(k[1])
    tris = []
    centres = {}
    for x0, x1, z0, z1 in cells:
        k00, k10, k11, k01 = key(x0, z0), key(x1, z0), key(x1, z1), key(x0, z1)
        bot = sorted(a for a in on_z[k00[1]] if k00[0] < a < k10[0])
        top = sorted((a for a in on_z[k01[1]] if k01[0] < a < k11[0]), reverse=True)
        lef = sorted((a for a in on_x[k00[0]] if k00[1] < a < k01[1]), reverse=True)
        rig = sorted(a for a in on_x[k10[0]] if k10[1] < a < k11[1])
        if not (bot or top or lef or rig):
            tris.append((k00, k10, k11))
            tris.append((k00, k11, k01))
            continue
        ring = [k00] + [(a, k00[1]) for a in bot] + [k10] + [(k10[0], a) for a in rig] + [k11] + \
               [(a, k11[1]) for a in top] + [k01] + [(k00[0], a) for a in lef]
        c = key((x0 + x1) / 2, (z0 + z1) / 2)
        verts[c] = ((x0 + x1) / 2, (z0 + z1) / 2)
        for a, b in zip(ring, ring[1:] + ring[:1]):
            tris.append((a, b, c))
    return verts, tris


# --------------------------------------------------------------------------------------------- ground classes

def pad_region(px, pz):
    """The compacted-earth apron of the office and the rental pad (design 4.1): where the dirt material shows."""
    sh = LAY["shop"]
    pad = LAY["rentalPad"]
    # a rounded rectangle in front of (south of) the shop plus the pad's disc and a strip towards the pier mouth
    ax = np.clip(px, sh["minX"] - 1.5, sh["maxX"] + 1.5)
    az = np.clip(pz, sh["maxZ"] - 0.5, sh["maxZ"] + 7.0)
    d_rect = np.hypot(px - ax, pz - az)
    d_pad = np.hypot(px - pad["x"], pz - pad["z"]) - (pad["radius"] + 1.6)
    n = 0.7 * G.vnoise(px * 1.7, pz * 1.7, 5.0)
    return np.minimum(d_rect - 0.2, d_pad) + n


def trail_dist(px, pz):
    pts = np.array([[p["x"], p["z"]] for p in LAY["trail"]["points"]], float)
    a, b = pts[:-1], pts[1:]
    d = b - a
    l2 = (d ** 2).sum(1)
    x = px[:, None]
    z = pz[:, None]
    t = np.clip(((x - a[:, 0]) * d[:, 0] + (z - a[:, 1]) * d[:, 1]) / l2, 0, 1)
    return np.sqrt((x - a[:, 0] - t * d[:, 0]) ** 2 + (z - a[:, 1] - t * d[:, 1]) ** 2).min(1)


GRAVEL_SPOTS = [s for s in LAY["spots"] if s["group"] in ("shore_n", "shore_s")]


def gravel_field(px, pz):
    """Positive where the shore is gravel: around the six 노지 spots (and the pier-root bank)."""
    f = np.full(px.shape, -9.0)
    for sp in GRAVEL_SPOTS:
        a = sp["anchor"]
        d = np.hypot(px - a["x"], pz - a["z"])
        f = np.maximum(f, 3.8 - d)
    # the pier root: a stone-and-gravel apron on both sides of the first deck boards
    f = np.maximum(f, 4.5 - np.hypot((px - 109.0) * 0.8, (pz + 12.0) * 0.6))
    return f + 1.3 * G.vnoise(px * 1.3, pz * 1.3, 11.0)


def class_fields(px, pz, s):
    """Three scalar fields, positive inside their class: mud, dirt, gravel. Priority mud > dirt > gravel > grass. The
    triangles are cut exactly along their zero lines (clip_classes), so the borders are smooth polylines, not stairs."""
    n = 0.30 * G.vnoise(px * 9.0, pz * 9.0, 2.0) + 0.18 * G.vnoise(px * 21.0, pz * 21.0, 8.0)
    fm = (1.25 + n) - s
    pad = pad_region(px, pz)
    td = trail_dist(px, pz)
    fd = np.maximum(-pad, LAY["trail"]["width"] / 2 - 0.1 + 0.25 * n - td)
    fd = np.minimum(fd, s - 1.4)
    fg = np.minimum(gravel_field(px, pz), 5.5 + n - s)
    return fm, fd, fg


def clip_classes(poly):
    """poly: list of (x, z, h, fm, fd, fg) convex. Returns [(class, polygon)] after cutting along the three zero lines."""
    pieces = [(0, poly)]       # (bitmask of fields known positive/negative not needed: classify at the end)
    out = [poly]
    for k in (3, 4, 5):
        nxt = []
        for pg in out:
            vals = [v[k] for v in pg]
            if min(vals) >= 0 or max(vals) <= 0:
                nxt.append(pg)
                continue
            pos, neg = [], []
            m = len(pg)
            for i in range(m):
                a, b = pg[i], pg[(i + 1) % m]
                (pos if a[k] >= 0 else neg).append(a)
                if (a[k] >= 0) != (b[k] >= 0):
                    t = a[k] / (a[k] - b[k])
                    c = tuple(a[j] + (b[j] - a[j]) * t for j in range(6))
                    c = c[:k] + (0.0,) + c[k + 1:]
                    pos.append(c)
                    neg.append(c)
            for q in (pos, neg):
                if len(q) >= 3:
                    nxt.append(q)
        out = nxt
    res = []
    for pg in out:
        cx = sum(v[3] for v in pg) / len(pg)
        cd = sum(v[4] for v in pg) / len(pg)
        cg = sum(v[5] for v in pg) / len(pg)
        cls = 1 if cx > 0 else 3 if cd > 0 else 2 if cg > 0 else 0
        res.append((cls, pg))
    return res


# ------------------------------------------------------------------------------------------------ build

def build_terrain(coll):
    cells = build_cells()
    verts, tris = terrain_triangles(cells)
    keys = list(verts.keys())
    idx = {k: i for i, k in enumerate(keys)}
    P = np.array([verts[k] for k in keys], float)
    fields = G.shore_fields(P[:, 0], P[:, 1])
    H = G.height(P[:, 0], P[:, 1], fields)
    # exact seam: boundary vertices take the village's piecewise-linear surface
    nb = 0
    dom = G.domain_polygon()
    near = G.dist_closed(P[:, 0], P[:, 1], dom) < 1e-4
    for i in np.nonzero(near)[0]:
        bh = G.boundary_height(P[i, 0], P[i, 1])
        if bh is not None:
            H[i] = bh
            nb += 1
    print(f"terrain: {len(cells)} cells, {len(keys)} vertices, {len(tris)} triangles, {nb} seam vertices")
    S = fields[0]
    FM, FD, FG = class_fields(P[:, 0], P[:, 1], S)
    groups = {0: MB(), 1: MB(), 2: MB(), 3: MB()}
    names = {0: "LM_grass", 1: "LM_mud", 2: "LM_gravel", 3: "LM_dirt"}
    up = Vector((0, 0, 1))
    npieces = 0
    for t in tris:
        ids = [idx[k] for k in t]
        poly = [(P[i][0], P[i][1], H[i], FM[i], FD[i], FG[i]) for i in ids]
        for cls, pg in clip_classes(poly):
            if cls == 0 or True:
                # lake bottom (under the water) is mud
                pass
            if sum(v[2] for v in pg) / len(pg) < G.WATER_Y + 0.02:
                cls = 1
            for j in range(1, len(pg) - 1):
                tri = (pg[0], pg[j], pg[j + 1])
                groups[cls].face([V(v[0], v[1], v[2]) for v in tri], names[cls], hint=up, smooth=True)
                npieces += 1
    print("terrain faces after material cuts:", npieces)
    objs = {}
    for c, mb in groups.items():
        if mb.bm.faces:
            ob = mb.finish(f"lake_ground_{['grass', 'mud', 'gravel', 'dirt'][c]}", coll)
            objs[c] = ob
    return objs, (P, H, idx)


def hill_tint(ob, is_grass):
    """Vertex colour 'Col' (multiplies the texture): the village's macro tint on the grass, a wetter and darker tone near the
    water, the forest floor's deeper green on the hills. Reads world positions (objects keep identity transforms)."""
    me = ob.data
    col = me.color_attributes["Col"].data
    n = len(me.loops)
    co = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    li = np.empty(n, np.int32)
    me.loops.foreach_get("vertex_index", li)
    X = co[li, 0]
    Z = -co[li, 1]
    Y = co[li, 2]
    S = G.signed_shore(X.astype(float), Z.astype(float))
    e = np.minimum(np.where(G.inside_closed(X, Z, G.WALK), 0.0, G.dist_closed(X, Z, G.WALK)), np.maximum(S, 0))
    # (vectorised noise replacement: sines, cheaper than 100k mathutils calls)
    k1 = 0.92 + 0.12 * G.vnoise(X * 0.9, Z * 0.9, 0.5) + 0.07 * G.vnoise(X * 3.3, Z * 3.3, 3.5)
    dry = np.clip(G.vnoise(X * 0.5, Z * 0.5, 7.0) * 0.6 + 0.1, 0, 1)
    r, g, b = k1 * (1 + 0.2 * dry), k1 * (1 + 0.03 * dry), k1 * (1 - 0.22 * dry)
    hillk = G.smoothstep(1.0, 9.0, e)
    # the forest floor: darker, bluer green (the village's backdrop reads as a canopy there)
    r = r * (1 - 0.5 * hillk)
    g = g * (1 - 0.36 * hillk)
    b = b * (1 - 0.46 * hillk)
    # wet bank
    wet = 1 - G.smoothstep(0.0, 1.6, np.abs(S)) * 1.0
    wet = np.where(S > -3, wet, 0)
    r = r * (1 - 0.30 * wet)
    g = g * (1 - 0.27 * wet)
    b = b * (1 - 0.22 * wet)
    out = np.stack([r, g, b, np.ones_like(r)], 1)
    out[:, :3] = np.clip(out[:, :3], 0, 1)
    # sRGB-encode like vlib._to_layer (a byte colour layer stores sRGB)
    enc = np.where(out[:, :3] <= 0.0031308, out[:, :3] * 12.92, 1.055 * np.power(out[:, :3], 1 / 2.4) - 0.055)
    out[:, :3] = enc
    col.foreach_set("color", out.astype(np.float32).ravel())


# ---------------------------------------------------------------------------------------------------- water

WATER_RING_SPACING = 2.0


def water_rings(offs):
    """Rings of the water outline offset by each d (negative = into the lake): the same index on every ring is the same
    outline point moved along its normal and corrected onto the exact contour of the distance field, so consecutive rings
    form clean quad strips."""
    base = G.resample_closed(G.SHORE, WATER_RING_SPACING)
    prev = np.roll(base, 1, axis=0)
    nxt = np.roll(base, -1, axis=0)
    t = nxt - prev
    t /= np.maximum(np.hypot(t[:, 0], t[:, 1]), 1e-9)[:, None]
    nrm = np.stack([t[:, 1], -t[:, 0]], 1)
    probe = base[0] + nrm[0] * 0.5
    if G.inside_closed(np.array([probe[0]]), np.array([probe[1]]), G.SHORE)[0]:
        nrm = -nrm
    rings = []
    for d in offs:
        p = base + nrm * d
        for _ in range(5):
            s = G.signed_shore(p[:, 0], p[:, 1])
            p = p + nrm * np.clip(d - s, -2.0, 2.0)[:, None]
        rings.append(p)
    return rings


def build_water(coll):
    """The water surface: the outline 0.5 m past the waterline (hidden under the bank) as quad-strip rings towards the
    middle, which is fanned. Vertices carry the depth: COLOR_0 = (depth / 3.5, 1 - depth / 1.2 (clamped, the shallows),
    0). UV0 = world metres / 16."""
    offs = [0.5, -0.2, -0.9, -1.8, -3.2, -5.2, -8.0, -12.0, -17.0]
    rings = water_rings(offs)
    mb = MB()
    up = Vector((0, 0, 1))

    def depth_of(p):
        h = G.height(p[:, 0], p[:, 1])
        return np.maximum(0.0, G.WATER_Y - h)
    depths = [depth_of(r) for r in rings]

    def vert(r, d, i):
        x, z = r[i]
        dep = d[i]
        return (x, z, (min(1.0, dep / 3.5), 1 - min(1.0, dep / 1.2), 0.0, 1.0))

    n = len(rings[0])
    quads = 0

    def emit(vs):
        f = mb.face([V(v[0], v[1], G.WATER_Y) for v in vs], "M_lakewater", [(v[0] / 16.0, v[1] / 16.0) for v in vs], hint=up)
        if f is not None:
            for lp, v in zip(f.loops, vs):
                lp[mb.col] = U._to_layer(v[2])
    for a, da, b, db in zip(rings[:-1], depths[:-1], rings[1:], depths[1:]):
        for i in range(n):
            j = (i + 1) % n
            emit([vert(a, da, i), vert(a, da, j), vert(b, db, j), vert(b, db, i)])
            quads += 1
    last = rings[-1]
    cen = last.mean(axis=0)
    dc = depth_of(np.array([cen]))[0]
    cv = (cen[0], cen[1], (min(1.0, dc / 3.5), 1 - min(1.0, dc / 1.2), 0.0, 1.0))
    for i in range(n):
        emit([vert(last, depths[-1], i), vert(last, depths[-1], (i + 1) % n), cv])
    ob = mb.finish("lake_water", coll, cat="water", auto=False)
    print("water faces", len(ob.data.polygons))
    return ob


# ---------------------------------------------------------------------------------------- rocks & riprap

def place_riprap(coll):
    """Stone pitching (사석) on the bank at the pier root, a few boulders along the shore, shore stones in the reed beds."""
    import random
    rng = random.Random(404)
    mb = MB()
    mb.tint = (0.36, 0.36, 0.33, 1.0)
    HF = lambda x, z: float(G.height(np.array([x]), np.array([z]))[0])
    # points of the waterline near the pier root: from the smoothed shore polyline
    sh = G.SHORE
    near = [(x, z) for x, z in sh if 104 < x < 122 and -24 < z < 0]
    n = 0
    for x, z in near:
        # two rows on the bank slope, skipping the 3 m where the pier's boards leave the land
        if -14.6 < z < -9.4:
            continue
        for row, off in enumerate((0.15, 0.75)):
            # out from the waterline along the outward normal (west)
            nx, nz = -1.0, 0.0
            px, pz = x + nx * off + rng.uniform(-0.25, 0.25), z + rng.uniform(-0.25, 0.25)
            s = float(G.signed_shore(np.array([px]), np.array([pz]))[0])
            if s < -0.2:
                continue
            sz = rng.uniform(0.28, 0.55) * (1.2 if row == 0 else 0.9)
            PN.rock(mb, px, pz, HF(px, pz) - sz * 0.22, sz * rng.uniform(1.0, 1.6), sz, sz * rng.uniform(0.55, 0.85),
                    900 + n, subdiv=1, yaw=rng.uniform(0, 3.14))
            n += 1
    # rocks along the pier's first boards: a heap on both sides of the pier root
    for side in (-1, 1):
        for k in range(9):
            px = 109.0 + rng.uniform(0, 3.4)
            pz = -12.0 + side * (2.3 + rng.uniform(0, 2.6))
            s = float(G.signed_shore(np.array([px]), np.array([pz]))[0])
            sz = rng.uniform(0.3, 0.6)
            y = HF(px, pz)
            PN.rock(mb, px, pz, y - sz * 0.2, sz * 1.3, sz, sz * 0.7, 950 + k + 20 * side, subdiv=1, yaw=rng.uniform(0, 3))
            n += 1
    # scattered shore stones (sparser, smaller) around the whole waterline, away from the reed beds' interior
    for i in range(0, len(sh), 5):
        x, z = sh[i]
        if rng.random() < 0.45:
            continue
        pr = sh[(i - 1) % len(sh)], sh[(i + 1) % len(sh)]
        tx, tz = pr[1][0] - pr[0][0], pr[1][1] - pr[0][1]
        L_ = math.hypot(tx, tz)
        nx, nz = tz / L_, -tx / L_
        if G.inside_closed(np.array([x + nx * 0.5]), np.array([z + nz * 0.5]), G.SHORE)[0]:
            nx, nz = -nx, -nz
        d = rng.uniform(-0.1, 0.9)
        px, pz = x + nx * d, z + nz * d
        sz = rng.uniform(0.18, 0.45)
        PN.rock(mb, px, pz, HF(px, pz) - sz * 0.3, sz * rng.uniform(1.0, 1.7), sz, sz * rng.uniform(0.5, 0.8), 1100 + i,
                subdiv=1, yaw=rng.uniform(0, 3.14))
        n += 1
    ob = mb.finish("lake_rocks", coll)
    print("rocks", n, "faces", len(ob.data.polygons))
    return ob


# ---------------------------------------------------------------------------------------------------- trail

def build_trail(coll):
    """lane_lake: 2.5 m dirt strip 2 cm above the ground (like the village lanes), irregular edge, crowned section,
    0.5 m steps. From the bus lane's end at (38.5, 1) to the pier's mouth."""
    pts = [(p["x"], p["z"]) for p in LAY["trail"]["points"]]
    # smooth it (Catmull-Rom) so it meanders, then walk it
    out = []
    for i in range(len(pts) - 1):
        p0, p1, p2 = pts[max(i - 1, 0)], pts[i], pts[i + 1]
        p3 = pts[min(i + 2, len(pts) - 1)]
        m = max(2, int(math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 0.5))
        for k in range(m):
            t = k / m
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * ((2 * p1[a]) + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 +
                                   (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3) for a in (0, 1)))
    out.append(pts[-1])
    hw0 = LAY["trail"]["width"] / 2
    mb = MB()
    up = Vector((0, 0, 1))
    acc = 0.0
    rows = []
    for i, (x, z) in enumerate(out):
        a = out[max(i - 1, 0)]
        b = out[min(i + 1, len(out) - 1)]
        tx, tz = b[0] - a[0], b[1] - a[1]
        L_ = math.hypot(tx, tz) or 1.0
        nx, nz = -tz / L_, tx / L_
        if i:
            acc += math.hypot(x - out[i - 1][0], z - out[i - 1][1])
        # width wobbles; the strip fades out (narrows) at the first and last metre
        w = hw0 * (1 + 0.12 * math.sin(acc * 0.9) + 0.08 * math.sin(acc * 2.3 + 1.0))
        e = min(1.0, acc / 2.0, (len(out) - i) * 0.5 / 2.0)
        w *= 0.35 + 0.65 * e
        cols = []
        for f in (-1, -0.5, 0.0, 0.5, 1.0):
            px, pz = x + nx * w * f, z + nz * w * f
            y = 0.02 + 0.018 * (1 - abs(f) ** 2) - (0.02 if abs(f) == 1 else 0.0)
            # follow the terrain where it is not flat (the strip lies on the walkable floor, flat, but be safe)
            cols.append((px, pz, y, f, acc))
        rows.append(cols)
    for r0, r1 in zip(rows[:-1], rows[1:]):
        for k in range(4):
            q = [V(r0[k][0], r0[k][1], r0[k][2]), V(r1[k][0], r1[k][1], r1[k][2]), V(r1[k + 1][0], r1[k + 1][1], r1[k + 1][2]),
                 V(r0[k + 1][0], r0[k + 1][1], r0[k + 1][2])]
            tint = (1.0, 0.98, 0.95, 1.0) if k in (1, 2) else (0.85, 0.85, 0.78, 1.0)
            mb.face(q, "LM_dirt", hint=up, tint=tint)
    ob = mb.finish("lake_trail", coll)
    return ob


# -------------------------------------------------------------------------------------------- occluders

def build_occluders(coll):
    """Shadow casters (cat 'occluder': in every bake, never exported). B's art/lake/work/structures.blend replaces this."""
    sp = os.path.join(WORK, "structures.blend")
    if os.path.exists(sp):
        with bpy.data.libraries.load(sp, link=False) as (src, dst):
            dst.objects = [n for n in src.objects]
        n = 0
        for ob in dst.objects:
            if ob is None:
                continue
            if ob.type == "MESH" and not ob.name.startswith(("col__", "seat__", "spot__")):
                ob["cat"] = "occluder"
                coll.objects.link(ob)
                n += 1
        print("structures.blend linked:", n, "objects")
        return
    mb = MB()
    for d in LAY["decks"]:
        cx, cz = (d["minX"] + d["maxX"]) / 2, (d["minZ"] + d["maxZ"]) / 2
        mb.box(cx, cz, -0.22, d["maxX"] - d["minX"], d["maxZ"] - d["minZ"], 0.22, "LM_wood")
        # posts every 2.5 m along the long sides
        if d["maxX"] - d["minX"] > 4 or d["maxZ"] - d["minZ"] > 4:
            if d["maxX"] - d["minX"] >= d["maxZ"] - d["minZ"]:
                xs = np.arange(d["minX"] + 1, d["maxX"], 2.5)
                for x in xs:
                    for z in (d["minZ"] + 0.15, d["maxZ"] - 0.15):
                        mb.box(float(x), z, -2.0, 0.12, 0.12, 1.8, "LM_wood")
    s = LAY["shop"]
    mb.box((s["minX"] + s["maxX"]) / 2, (s["minZ"] + s["maxZ"]) / 2, 0.0, s["maxX"] - s["minX"], s["maxZ"] - s["minZ"], 4.0, "LM_render")
    mb.box((s["minX"] + s["maxX"]) / 2, s["maxZ"] + 0.9, 3.4, s["maxX"] - s["minX"] + 1.0, 1.8, 0.2, "LM_render")
    for h in LAY["huts"]:
        mb.box((h["minX"] + h["maxX"]) / 2, (h["minZ"] + h["maxZ"]) / 2, 0.0, h["maxX"] - h["minX"], h["maxZ"] - h["minZ"], 2.6, "LM_wood")
        mb.box((h["minX"] + h["maxX"]) / 2, (h["minZ"] + h["maxZ"]) / 2, 2.6, h["maxX"] - h["minX"] + 0.6, h["maxZ"] - h["minZ"] + 0.6, 0.6, "LM_roof")
    for l in LAY["lamps"]:
        mb.box(l["x"], l["z"], 0.0, 0.2, 0.2, 3.4, "LM_wood")
    pv = LAY["pavilion"]["centre"]
    mb.box(pv["x"], pv["z"], 3.0, 6.4, 6.4, 0.4, "LM_roof")
    for sx in (-2.85, 2.85):
        for sz in (-2.85, 2.85):
            mb.box(pv["x"] + sx, pv["z"] + sz, 0.0, 0.3, 0.3, 3.0, "LM_wood")
    ob = mb.finish("occluder_greybox", coll, cat="occluder", auto=False)
    return ob


def lights(coll):
    """Night light empties (bake_lake.py puts point lights there): lamps, the office window and porch, the huts' eaves."""
    pos = []
    for i, l in enumerate(LAY["lamps"]):
        U.light("lamp", V(l["x"], l["z"], 3.2))
    s = LAY["shop"]
    cx = (s["minX"] + s["maxX"]) / 2
    for dx in (-2.2, 2.2):
        U.light("window", V(cx + dx, s["maxZ"] + 0.5, 2.3))
    for h in LAY["huts"]:
        c = ((h["minX"] + h["maxX"]) / 2, (h["minZ"] + h["maxZ"]) / 2)
        U.light("window", V(c[0], c[1] + (1.9 if h["id"] == "hut_a" else -1.9), 2.4))
    U.make_light_empties(coll)


# ---------------------------------------------------------------------------------------------------- main

def main():
    scene = bpy.context.scene
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    parts = arg("--parts", "terrain,veg").split(",")
    G.set_seam(ordered_loop())
    dev = G.shore_deviation()
    print(f"visual shoreline deviates at most {dev:.2f} m from the collider polygon; seam loop {len(G.SEAM)} samples")
    root = U.coll("lake")
    BV.setup_light(scene)
    BV.setup_render(scene, samples=arg("--samples", 96, int))
    ground = U.coll("ground", root)
    objs, (P, H, idx) = build_terrain(ground)
    for c, ob in objs.items():
        hill_tint(ob, c == 0)
    water = build_water(U.coll("water", root))
    place_riprap(U.coll("rocks", root))
    build_trail(U.coll("trail", root))
    build_occluders(U.coll("occluder", root))
    if "veg" in parts:
        import parts_lake_veg as VG
        VG.build(U.coll("veg", root), lambda x, z: float(G.height(np.array([x]), np.array([z]))[0]))
    lights(U.coll("lights", root))
    info = {"shore_deviation_m": dev, "seam_samples": len(G.SEAM), "vertices": int(len(P))}
    json.dump(info, open(os.path.join(WORK, "terrain_info.json"), "w"), indent=1)
    out = os.path.join(WORK, "lake_authoring.blend")
    bpy.ops.wm.save_as_mainfile(filepath=out)
    print("SAVED", out)


if __name__ == "__main__":
    main()
