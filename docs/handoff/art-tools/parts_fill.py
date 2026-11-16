"""Village fill (controller feedback on preview2): more scenery houses and a flower kiosk, tree-lined lanes and ring
road, orchards, wildflower meadows, picnic spots, fenced vegetable gardens, lamp posts along the lanes.

Vegetation is GPU-instanced: a variant mesh (built once at the origin) is placed many times as children of an Empty
`inst__<variant>` that share the mesh, which the glTF exporter writes as EXT_mesh_gpu_instancing. Instanced meshes
never use LM_ materials (no unique light-map UVs): their bark is M_bark, their leaves M_leaf_*, both lit by baked
vertex colours (one representative instance per variant is baked).

Every new solid thing gets a col__ box, validated against the lanes, plots, layout colliders, the ring road and the creek.
"""
import math
import random

import bpy
from mathutils import Vector

import vlib as U
from vlib import V, MB

L = U.LAYOUT
EXTRA_BOXES = []        # (node, minX, maxX, minZ, maxZ) of every new col__ box (validation + report)
NEW_BUILDINGS = []      # report: scenery houses / kiosk added here
INSTANCES = {}          # variant -> count
PROBLEMS = []

# Houses 6-10 and the flower kiosk live in layout.json (shared/src/village/villageLayout.ts is the single source since
# Task 7; T7 review m7). parts_buildings.houses builds every layout house (with its col__ box); the fill builds only the
# kiosk, whose kind is not "house". Never list buildings here by hand: a re-exported layout would build them twice.
LAYOUT_HOUSES = [s for s in L["sceneryHouses"] if s["kind"] == "house"]
KIOSK = next(s for s in L["sceneryHouses"] if s["kind"] == "kiosk")


def bounds_of(h):
    cx, cz = h["centre"]["x"], h["centre"]["z"]
    sx, sz = h["size"]["x"], h["size"]["z"]
    return cx - sx / 2, cx + sx / 2, cz - sz / 2, cz + sz / 2


# ------------------------------------------------------------------------------------------ validation --

def _seg_box_dist(ax, az, bx, bz, box):
    x0, x1, z0, z1 = box
    best = 1e9
    n = max(2, int(math.hypot(bx - ax, bz - az) / 0.25))
    for i in range(n + 1):
        t = i / n
        px, pz = ax + (bx - ax) * t, az + (bz - az) * t
        dx = max(x0 - px, 0, px - x1)
        dz = max(z0 - pz, 0, pz - z1)
        best = min(best, math.hypot(dx, dz))
    return best


def lane_clearance(box):
    best = 1e9
    for lane in L["lanes"]:
        for a, b in zip(lane["points"][:-1], lane["points"][1:]):
            best = min(best, _seg_box_dist(a["x"], a["z"], b["x"], b["z"], box) - lane["width"] / 2)
    return best


def overlaps(a, b, m=0.0):
    return a[0] < b[1] + m and b[0] < a[1] + m and a[2] < b[3] + m and b[2] < a[3] + m


def solid_boxes():
    out = [(c["minX"], c["maxX"], c["minZ"], c["maxZ"]) for c in L["colliders"]]
    out += [(b[1], b[2], b[3], b[4]) for b in U.BOXES]
    return out


def problems_for(box, lane_margin=0.5, ring_r=40.0, allow_plots=False):
    p = []
    x0, x1, z0, z1 = box
    if lane_clearance(box) < lane_margin:
        p.append("lane")
    if not allow_plots:
        for pl in L["plots"]:
            b = pl["bounds"]
            if overlaps(box, (b["minX"], b["maxX"], b["minZ"], b["maxZ"]), 0.4):
                p.append("plot " + pl["id"])
    for b in solid_boxes():
        if overlaps(box, b, 0.2):
            p.append("collider")
            break
    nx = min(max(0, x0), x1) if x0 <= 0 <= x1 else (x0 if abs(x0) < abs(x1) else x1)
    nz = min(max(0, z0), z1) if z0 <= 0 <= z1 else (z0 if abs(z0) < abs(z1) else z1)
    if math.hypot(nx, nz) < ring_r:
        p.append("ring")
    if x0 < -94 or x1 > 94 or z0 < -94 or z1 > 94:
        p.append("bounds")
    return p


def point_ok(x, z, r=0.6, lane_margin=0.4, ring_r=40.5, allow_plots=False):
    return not problems_for((x - r, x + r, z - r, z + r), lane_margin, ring_r, allow_plots)


def add_box(cols, node, box, h):
    pr = problems_for(box, 0.5, 39.6)
    if pr:
        PROBLEMS.append((node, pr))
        print("FILL: skip", node, pr)
        return False
    EXTRA_BOXES.append((node,) + tuple(round(v, 2) for v in box))
    U.collider(cols, node, round(box[0], 2), round(box[1], 2), round(box[2], 2), round(box[3], 2), h)
    return True


# ------------------------------------------------------------------------------------------- instancing --

_VARIANTS = {}


def variant(name, coll_src, build):
    """Build a variant at the origin with a Forest (bark M_bark, leaves M_leaf_*); returns (trunk_mesh, leaf_mesh)."""
    import parts_trees as PT
    if name in _VARIANTS:
        return _VARIANTS[name]
    F = PT.Forest(bark_m="A_bark_inst")
    build(F)
    t, l = F.finish("var_" + name, coll_src)
    meshes = []
    for ob in (t, l):
        if ob is not None and len(ob.data.polygons):
            meshes.append((ob.data, ob.get("cat")))
        if ob is not None:
            bpy.data.objects.remove(ob)
    _VARIANTS[name] = meshes
    return meshes


def place(coll_, name, meshes, transforms):
    """transforms: [(x, z, y, yaw, scale)] -> one Empty per mesh part with linked-duplicate children."""
    INSTANCES[name] = INSTANCES.get(name, 0) + len(transforms)
    for k, (me, cat) in enumerate(meshes):
        root = bpy.data.objects.new(f"inst__{name}_{k}", None)
        root.empty_display_size = 1.0
        root["cat"] = "inst_root"
        coll_.objects.link(root)
        for i, (x, z, y, yaw, s) in enumerate(transforms):
            ob = bpy.data.objects.new(f"{name}_{k}_{i}", me)
            ob.location = V(x, z, y)
            ob.rotation_euler = (0, 0, yaw)
            ob.scale = (s, s, s)
            ob.parent = root
            ob["cat"] = "inst"
            ob["leafcat"] = cat
            if i == 0:
                ob["rep"] = True
            coll_.objects.link(ob)


# ---------------------------------------------------------------------------------------------- build --

def fill(c, cols):
    import build_village as BV
    import parts_buildings as PB
    import parts_props as PP
    import parts_trees as PT
    src = U.coll("variants_src", c)
    inst = U.coll("instances", c)
    rng = random.Random(4242)

    # --- the kiosk (layout.json owns its box; it is not validated against itself)
    mb = MB()
    fl = MB()
    kb = KIOSK["bounds"]
    U.collider(cols, KIOSK["node"], kb["minX"], kb["maxX"], kb["minZ"], kb["maxZ"], 3.6)
    kiosk(mb, fl)
    NEW_BUILDINGS.append(dict(id="kiosk", centre=KIOSK["centre"], size=KIOSK["size"], colour="wood",
                              doorSide=KIOSK["doorSide"], node=KIOSK["node"]))
    # --- fenced vegetable gardens behind houses (one col__ box per fenced garden)
    all_houses = LAYOUT_HOUSES
    for h in all_houses:
        g = garden_box(h)
        if g is None:
            continue
        if add_box(cols, f"col__garden_{h['id']}", g, 1.0):
            garden(mb, fl, g, rng)
    # --- picnic spots: a table and two benches
    for i, (x, z) in enumerate(((64, -56), (-64, -56), (-70, 46), (72, -2))):
        box = (x - 1.3, x + 1.3, z - 1.6, z + 1.6)
        if add_box(cols, f"col__picnic_{i + 1}", box, 1.0):
            picnic(mb, x, z)
    mb.finish("fill_buildings", c)
    fl.finish("fill_flowers", c, cat="leaf", auto=False)

    # --- lamp posts along the lanes (thin: no colliders)
    lm = MB()
    lg = MB()
    for lane in L["lanes"]:
        if lane["id"] == "lane_bus":
            continue
        pts = lane["points"]
        acc = 0.0
        for a, b in zip(pts[:-1], pts[1:]):
            Ls = math.hypot(b["x"] - a["x"], b["z"] - a["z"])
            ux, uz = (b["x"] - a["x"]) / Ls, (b["z"] - a["z"]) / Ls
            t = 7.0 - (acc % 14.0)
            while t < Ls:
                px = a["x"] + ux * t - uz * 2.35
                pz = a["z"] + uz * t + ux * 2.35
                if math.hypot(px, pz) > 41.5 and point_ok(px, pz, 0.2, 0.6, 41.0, allow_plots=True):
                    PP.lamp(lm, lg, px, pz, h=4.0)
                t += 14.0
            acc += Ls
    lm.finish("lane_lamps", c)
    ob = lg.finish("lane_lamp_glass", c, cat="lamp", auto=False)
    me = ob.data
    uvl = me.uv_layers["UVMap"].data
    for p in me.polygons:
        for li in p.loop_indices:
            u, v = uvl[li].uv
            uvl[li].uv = U.glow_uv("lamp", min(1, max(0, u)), min(1, max(0, v / 0.4)))

    # --- variants
    street_green = variant("street_green", src, lambda F: PT.tree(F, 0, 0, "green", 6.8, 2.4, 11, trunk_r=0.1))
    street_cherry = variant("street_cherry", src, lambda F: PT.tree(F, 0, 0, "cherry", 5.6, 2.5, 12, trunk_r=0.1))
    orchard_tree = variant("orchard", src, lambda F: PT.tree(F, 0, 0, "orchard", 3.8, 1.8, 13, trunk_r=0.08))
    shrub_v = variant("shrub", src, lambda F: PT.shrub(F, 0, 0, 0.9, 0.6, 14))
    meadows = [variant(f"meadow_{k}", src, lambda F, k=k: meadow_patch(F, k)) for k in range(4)]
    fars = [variant(f"far_{k}", src, lambda F, k=k: PT.far_tree(F, 0, 0, 0, 1.0, 50 + k)) for k in range(3)]

    # --- street trees along every lane (both sides, 3.7 m off the centreline) and the ring road's outer edge
    green_t, cherry_t = [], []
    k = 0
    for lane in L["lanes"]:
        if lane["id"] == "lane_bus":
            continue
        pts = lane["points"]
        for a, b in zip(pts[:-1], pts[1:]):
            Ls = math.hypot(b["x"] - a["x"], b["z"] - a["z"])
            ux, uz = (b["x"] - a["x"]) / Ls, (b["z"] - a["z"]) / Ls
            t = 4.5
            while t < Ls - 2.0:
                for side in (-1, 1):
                    px = a["x"] + ux * t - uz * side * 3.7
                    pz = a["z"] + uz * t + ux * side * 3.7
                    if math.hypot(px, pz) < 42.0 or not point_ok(px, pz, 0.6, 1.2, 41.0):
                        continue
                    if abs(pz - BV.creek_z(px)) < 6.5:
                        continue
                    (cherry_t if lane["id"] in ("lane_bridge", "lane_plot_s", "lane_plot_n") else green_t).append(
                        (px, pz, 0.0, rng.uniform(0, 6.28), rng.uniform(0.85, 1.1)))
                    k += 1
                t += 10.0
    ring_n = 26
    for i in range(ring_n):
        a = 2 * math.pi * (i + 0.5) / ring_n
        px, pz = 41.2 * math.cos(a), 41.2 * math.sin(a)
        if not point_ok(px, pz, 0.6, 1.2, 39.8):
            continue
        if any(math.hypot(px - x, pz - z) < 4.0 for (x, z, *_r) in green_t + cherry_t):
            continue
        (cherry_t if i % 2 else green_t).append((px, pz, 0.0, rng.uniform(0, 6.28), rng.uniform(0.9, 1.1)))
    place(inst, "street_green", street_green, green_t)
    place(inst, "street_cherry", street_cherry, cherry_t)
    PT.TREES.extend([("street", t[0], t[1]) for t in green_t + cherry_t])

    # --- orchards (plum/apple blossom, young trees in rows)
    orch = []
    for (x0, z0, nx, nz) in ((61.0, 34.0, 5, 4), (-80.0, -80.0, 4, 4)):
        for i in range(nx):
            for j in range(nz):
                px, pz = x0 + i * 5.0 + rng.uniform(-0.3, 0.3), z0 + j * 5.0 + rng.uniform(-0.3, 0.3)
                if point_ok(px, pz, 0.6, 1.0, 41.0):
                    orch.append((px, pz, 0.0, rng.uniform(0, 6.28), rng.uniform(0.85, 1.1)))
    place(inst, "orchard", orchard_tree, orch)
    PT.TREES.extend([("orchard", t[0], t[1]) for t in orch])

    # --- wildflower meadow patches (3-4 colours) in the open lawns
    mead = [[] for _ in meadows]
    n = 0
    tries = 0
    while n < 90 and tries < 6000:
        tries += 1
        px, pz = rng.uniform(-90, 90), rng.uniform(-90, 90)
        if math.hypot(px, pz) < 43 or abs(pz - BV.creek_z(px)) < 7.0:
            continue
        if not point_ok(px, pz, 1.6, 0.8, 42.0):
            continue
        mead[n % len(meadows)].append((px, pz, 0.0, rng.uniform(0, 6.28), rng.uniform(0.8, 1.3)))
        n += 1
    for k_, (m_, tr) in enumerate(zip(meadows, mead)):
        place(inst, f"meadow_{k_}", m_, tr)

    # --- loose shrubs along the plot edges (outside the plots), with small colliders
    sh = []
    for pl in L["plots"]:
        b = pl["bounds"]
        for (px, pz) in ((b["minX"] - 1.6, b["minZ"] + 3), (b["maxX"] + 1.6, b["minZ"] + 3),
                         (b["minX"] - 1.6, b["maxZ"] - 3), (b["maxX"] + 1.6, b["maxZ"] - 3)):
            box = (px - 0.5, px + 0.5, pz - 0.5, pz + 0.5)
            if not problems_for(box, 1.0, 41.0) and abs(pz - BV.creek_z(px)) > 6.5:
                if add_box(cols, f"col__bush_{len(sh) + 1}", box, 1.0):
                    sh.append((px, pz, 0.0, rng.uniform(0, 6.28), rng.uniform(0.9, 1.2)))
    place(inst, "shrub", shrub_v, sh)

    # --- backdrop forest (outside the walk bounds), instanced crossed cards: near hills and up the mountain slopes
    import parts_nature as PN
    fx, fz = PN.FALL["centre"]["x"], PN.FALL["centre"]["z"]
    far_tr = [[] for _ in fars]
    placed = 0
    tries = 0
    while placed < 7000 and tries < 90000:
        tries += 1
        if rng.random() < 0.15:
            x, z = rng.uniform(fx - 40, fx + 18), rng.uniform(fz - 70, fz + 70)
        else:
            r = 116 + (rng.random() ** 1.6) * 520
            a = rng.uniform(0, 2 * math.pi)
            x, z = r * math.cos(a), r * math.sin(a)
        if max(abs(x), abs(z)) < 106 or PN.lake_d(x, z) < 8:
            continue
        if abs(z - fz) < 16 and fx - 8 < x < fx + 16:
            continue
        y = PN.terrain_h(x, z)
        if y > 125:
            continue
        rr = math.hypot(x, z)
        H = rng.uniform(7.0, 12.0) * (1.0 + 0.5 * min(1.0, (rr - 116) / 300))
        far_tr[placed % len(fars)].append((x, z, y - 0.6, rng.uniform(0, 6.28), H))
        placed += 1
    for k_, (m_, tr) in enumerate(zip(fars, far_tr)):
        place(inst, f"far_{k_}", m_, tr)
    # the variant sources are not exported
    for o in list(src.objects):
        bpy.data.objects.remove(o)


def meadow_patch(F, k):
    """A ~2.6 m wildflower patch: crossed flower-strip cards around the origin (k = colour mix)."""
    rows = [[0, 0, 3], [1, 1, 3], [2, 2, 3], [0, 1, 2, 3]][k]
    rng = random.Random(70 + k)
    for i in range(26):
        a = rng.uniform(0, 2 * math.pi)
        r = math.sqrt(rng.random()) * 1.3
        x, z = r * math.cos(a), r * math.sin(a)
        yaw = rng.uniform(0, math.pi)
        ww, hh = rng.uniform(0.5, 0.8), rng.uniform(0.28, 0.45)
        cy, sy = math.cos(yaw), math.sin(yaw)
        p = [V(x - cy * ww / 2, z + sy * ww / 2, 0), V(x + cy * ww / 2, z - sy * ww / 2, 0),
             V(x + cy * ww / 2, z - sy * ww / 2, hh), V(x - cy * ww / 2, z + sy * ww / 2, hh)]
        row = rows[rng.randrange(len(rows))]
        u0 = rng.uniform(0, 0.7)
        v0, v1 = 1 - (row + 1) * 0.25 + 0.004, 1 - row * 0.25 - 0.004
        F.leaf.face(p, "M_leaf_flora", [(u0, v0), (u0 + 0.3, v0), (u0 + 0.3, v1), (u0, v1)])
        F.centres.append(V(0, 0, -0.5))


def garden_box(h):
    """The fenced vegetable garden behind a house (outside its footprint), 6 x 2.6 m."""
    x0, x1, z0, z1 = bounds_of(h) if "bounds" not in h else (h["bounds"]["minX"], h["bounds"]["maxX"],
                                                             h["bounds"]["minZ"], h["bounds"]["maxZ"])
    side = h["doorSide"]
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    if side == "s":
        return (cx - 3, cx + 3, z0 - 3.0, z0 - 0.4)
    if side == "n":
        return (cx - 3, cx + 3, z1 + 0.4, z1 + 3.0)
    if side == "e":
        return (x0 - 3.0, x0 - 0.4, cz - 3, cz + 3)
    return (x1 + 0.4, x1 + 3.0, cz - 3, cz + 3)


def garden(mb, fl, box, rng):
    x0, x1, z0, z1 = box
    mb.cell = "soil"
    mb.box((x0 + x1) / 2, (z0 + z1) / 2, 0.0, x1 - x0 - 0.2, z1 - z0 - 0.2, 0.12, "A_paint")
    mb.cell = None
    # picket fence around (white) with posts
    t = U.rgba("#F4F1EA")
    for (ax, az, bx, bz) in ((x0, z0, x1, z0), (x0, z1, x1, z1), (x0, z0, x0, z1), (x1, z0, x1, z1)):
        Ls = math.hypot(bx - ax, bz - az)
        n = int(Ls / 0.16)
        for i in range(n + 1):
            px, pz = ax + (bx - ax) * i / n, az + (bz - az) * i / n
            mb.box(px, pz, 0.0, 0.05, 0.05, 0.75 if i % 6 else 0.85, "LM_wood", tint=t)
        mb.box((ax + bx) / 2, (az + bz) / 2, 0.55, abs(bx - ax) + 0.05, abs(bz - az) + 0.05, 0.05, "LM_wood", tint=t)
        mb.box((ax + bx) / 2, (az + bz) / 2, 0.25, abs(bx - ax) + 0.05, abs(bz - az) + 0.05, 0.05, "LM_wood", tint=t)
    # vegetable rows (lettuce/cabbage: small green cards)
    long_x = (x1 - x0) > (z1 - z0)
    rows = 4
    for r in range(rows):
        for k in range(14):
            if long_x:
                px = x0 + 0.4 + k * (x1 - x0 - 0.8) / 13
                pz = z0 + 0.45 + r * (z1 - z0 - 0.9) / (rows - 1)
            else:
                pz = z0 + 0.4 + k * (z1 - z0 - 0.8) / 13
                px = x0 + 0.45 + r * (x1 - x0 - 0.9) / (rows - 1)
            for a in (0.0, math.pi / 2):
                c, s = math.cos(a + k), math.sin(a + k)
                p = [V(px - c * 0.22, pz + s * 0.22, 0.12), V(px + c * 0.22, pz - s * 0.22, 0.12),
                     V(px + c * 0.22, pz - s * 0.22, 0.42), V(px - c * 0.22, pz + s * 0.22, 0.42)]
                fl.face(p, "M_leaf_flora", [(0.05, 0.255), (0.2, 0.255), (0.2, 0.33), (0.05, 0.33)])


def picnic(mb, x, z):
    w = U.rgba("#C39A6E")
    mb.box(x, z, 0.72, 1.8, 0.8, 0.05, "LM_wood", tint=w)
    for sx in (-0.7, 0.7):
        mb.box(x + sx, z, 0.0, 0.08, 0.7, 0.72, "LM_wood", tint=w)
    for sz in (-1.0, 1.0):
        mb.box(x, z + sz, 0.42, 1.8, 0.32, 0.05, "LM_wood", tint=w)
        for sx in (-0.7, 0.7):
            mb.box(x + sx, z + sz, 0.0, 0.08, 0.3, 0.42, "LM_wood", tint=w)


def kiosk(mb, fl):
    """A small timber flower kiosk with a striped awning and flower buckets, facing west."""
    import parts_buildings as PB
    F = PB.Frame(KIOSK["centre"]["x"], KIOSK["centre"]["z"], PB.FACING[KIOSK["doorSide"]])
    W, D = KIOSK["size"]["z"], KIOSK["size"]["x"]          # local width 3 (along world z), depth 4 (along world x)
    F.box(mb, 0, -0.3, 0.0, W - 0.1, D - 1.0, 0.15, "LM_stone")
    F.box(mb, 0, -0.5, 0.15, W - 0.2, D - 1.6, 2.6, "LM_wood", tint=U.rgba("#CFA27A"))
    PB.gable_roof(mb, F, -(W - 0.2) / 2, (W - 0.2) / 2, -D / 2 + 0.3, D / 2 - 1.3, 2.75, 30, 0.3, "LM_roof",
                  U.rgba("#8C939E"), ridge_along_x=False)
    PB.wall_feature(mb, F, 0, D / 2 - 1.3, 0.9, 2.0, 1.4, (0, 1), "glass")
    a0, a1 = F.p(-1.4, D / 2 - 1.25, 2.4), F.p(1.4, D / 2 - 1.25, 2.4)
    b1, b0 = F.p(1.4, D / 2 - 0.2, 2.0), F.p(-1.4, D / 2 - 0.2, 2.0)
    uv = [U.region_uv("awning", 0, 1), U.region_uv("awning", 1, 1), U.region_uv("awning", 1, 0.15),
          U.region_uv("awning", 0, 0.15)]
    mb.face([a0, a1, b1, b0], "A_paint", uv, hint=F.n(0, 1, 2))
    mb.face([a0, a1, b1, b0][::-1], "A_paint", uv[::-1], hint=F.n(0, -1, -2))
    # flower stand: a stepped shelf with buckets of flowers
    for k in range(2):
        F.box(mb, 0, D / 2 - 0.55 + 0.0, 0.15 + k * 0.35, 2.4, 0.45 - k * 0.15, 0.35, "LM_wood", tint=U.rgba("#9C6B43"))
    for i in range(6):
        lx = -1.0 + i * 0.4
        x, z = F.xz(lx, D / 2 - 0.5)
        for a in (0.0, math.pi / 2):
            c, s = math.cos(a), math.sin(a)
            row = i % 3
            p = [V(x - c * 0.22, z + s * 0.22, 0.85), V(x + c * 0.22, z - s * 0.22, 0.85),
                 V(x + c * 0.22, z - s * 0.22, 1.25), V(x - c * 0.22, z + s * 0.22, 1.25)]
            fl.face(p, "M_leaf_flora", [(0.3, 1 - (row + 1) * 0.25), (0.5, 1 - (row + 1) * 0.25), (0.5, 1 - row * 0.25),
                                        (0.3, 1 - row * 0.25)])



# ------------------------------------------------------------------------------------------- trunk boxes --

def door_points():
    """Points in front of every door (house, café, kiosk, memorial) that a trunk box must keep clear of."""
    pts = []
    for h in L["sceneryHouses"]:
        cx, cz = h["centre"]["x"], h["centre"]["z"]
        sx, sz = h["size"]["x"], h["size"]["z"]
        off = {"s": (0, sz / 2 + 1.0), "n": (0, -sz / 2 - 1.0), "e": (sx / 2 + 1.0, 0), "w": (-sx / 2 - 1.0, 0)}[h["doorSide"]]
        pts.append((cx + off[0], cz + off[1], 2.0))
    pad = L["memorial"]["exterior"]["doorPad"]
    pts.append((pad["centre"]["x"], pad["centre"]["z"], pad["radius"] + 1.2))
    arr = L["memorial"]["exterior"]["arrival"]
    pts.append((arr["x"], arr["z"], 1.6))
    return pts


TRUNK_BOXES = []
TRUNK_SKIPPED = []


def tree_boxes(cols):
    """A 0.5 x 0.5 m col__tree_<n> box (1.2 m high: not a camera box) at every tree trunk inside the walk bounds,
    instanced trees included (a box cannot be instanced, so these are plain boxes). Trees already inside a solid box
    (planters, the zelkova deck, creek banks) need none. A box that would narrow a lane, block a door front or touch
    another collider is skipped and listed."""
    import parts_trees as PT
    doors = door_points()
    n = 0
    for kind, x, z in PT.TREES:
        box = (x - 0.25, x + 0.25, z - 0.25, z + 0.25)
        if any(b[1] - 0.05 <= x <= b[2] + 0.05 and b[3] - 0.05 <= z <= b[4] + 0.05 for b in U.BOXES):
            continue
        why = []
        if lane_clearance(box) < 0.5:
            why.append("lane")
        for (dx, dz, r) in doors:
            if math.hypot(max(box[0] - dx, 0, dx - box[1]), max(box[2] - dz, 0, dz - box[3])) < r:
                why.append("door")
        for b in U.BOXES:
            if overlaps(box, (b[1], b[2], b[3], b[4]), 0.3):
                why.append("collider " + b[0])
                break
        if why:
            TRUNK_SKIPPED.append((kind, round(x, 2), round(z, 2), why))
            print("TRUNK: skip", kind, round(x, 2), round(z, 2), why)
            continue
        n += 1
        node = f"col__tree_{n}"
        U.collider(cols, node, round(box[0], 2), round(box[1], 2), round(box[2], 2), round(box[3], 2), 1.2)
        TRUNK_BOXES.append((node, kind, round(x, 2), round(z, 2)))
    print("TRUNK boxes", len(TRUNK_BOXES), "skipped", len(TRUNK_SKIPPED))
