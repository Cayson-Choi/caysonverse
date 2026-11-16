"""BLOCKOUT of house 1 (both floors) for chunk G — boxes in the right places, every contract node (P0, 2026-11-16).

  blender -b --factory-startup -P docs/designs/houses-interior/blockout_house.py -- [--out <house_1.glb>] [--render <dir>] [--samples N]

Not the art: plain boxes and cylinders with flat materials, so G can wire the whole game flow (keypad -> floor 1 -> stair -> floor 2
-> seats -> exit) before HA ships the real house_1.glb at the same path with the same node names. Built only through
houses_contract.py (contract.json, from shared/src/village/houseAreas.ts): world coordinates, floor groups floor__h1_1/2, col__
boxes, seat__ markers with extras, stair__/door__/spawn__ places, ceil__ helpers. Default output:
client/public/models/village/houses/house_1.glb. With --render it also writes plan and eye-level PNGs (markers drawn).
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import houses_contract as HC  # noqa: E402

REPO = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    return ARGV[ARGV.index(name) + 1] if name in ARGV else default


OUT = arg("--out", os.path.join(REPO, "client", "public", "models", "village", "houses", "house_1.glb"))
RENDER = arg("--render")
SAMPLES = int(arg("--samples", "48"))
N = 1
ROOM = HC.ROOM
W, D, H, T = ROOM["width"], ROOM["depth"], ROOM["ceiling"], ROOM["wall"]
STAIR = HC.STAIR
SP = HC.C["stairPlans"][HC.house(N)["stair"]]
HB = HC.HouseBuild(N)

# ------------------------------------------------------------------------------------------------ materials --
COLORS = {
    "M_wall": (0.86, 0.84, 0.80), "M_ceiling": (0.93, 0.92, 0.90), "M_oak": (0.62, 0.45, 0.30), "M_tile": (0.55, 0.55, 0.54),
    "M_fabric": (0.55, 0.57, 0.60), "M_wood_dark": (0.30, 0.20, 0.14), "M_wood_light": (0.78, 0.64, 0.46),
    "M_white": (0.92, 0.92, 0.90), "M_black": (0.05, 0.05, 0.05), "M_rug": (0.80, 0.70, 0.62), "M_accent": (0.90, 0.60, 0.66),
    "M_bed": (0.95, 0.94, 0.92), "M_plant": (0.25, 0.45, 0.22), "M_glass": (0.55, 0.75, 0.90), "M_brass": (0.80, 0.62, 0.30),
}
MATS = {}


def mat(name):
    if name not in MATS:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        p = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        p.inputs["Base Color"].default_value = (*COLORS[name], 1.0)
        p.inputs["Roughness"].default_value = 0.15 if name == "M_glass" else 0.7
        if name == "M_glass":
            p.inputs["Alpha"].default_value = 0.25
        MATS[name] = m
    return MATS[name]


# -------------------------------------------------------------------------------------------- mesh builder --
BMS = {}  # (floor, material) -> bmesh


def bm_for(f, m):
    key = (f, m)
    if key not in BMS:
        BMS[key] = bmesh.new()
    return BMS[key]


def P(f, lx, lz, y):
    """Local point of floor f -> Blender vector."""
    x, z = HC.l2w(N, f, lx, lz)
    return HC.V(x, z, y)


def box(f, x0, x1, z0, z1, y0, y1, m):
    bm = bm_for(f, m)
    xs, zs, ys = (min(x0, x1), max(x0, x1)), (min(z0, z1), max(z0, z1)), (min(y0, y1), max(y0, y1))
    v = [bm.verts.new(P(f, xs[i & 1], zs[(i >> 1) & 1], ys[(i >> 2) & 1])) for i in range(8)]
    for q in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
        bm.faces.new([v[i] for i in q])


def cyl(f, cx, cz, y0, y1, r, m, seg=16):
    c = P(f, cx, cz, (y0 + y1) / 2)
    bmesh.ops.create_cone(bm_for(f, m), cap_ends=True, segments=seg, radius1=r, radius2=r, depth=y1 - y0,
                          matrix=Matrix.Translation(c))


def ball(f, cx, cz, y, r, m):
    bmesh.ops.create_uvsphere(bm_for(f, m), u_segments=12, v_segments=8, radius=r, matrix=Matrix.Translation(P(f, cx, cz, y)))


def beam(f, a, b, w, h, m):
    """A box from local point a=(x, z, y) to b, w wide and h high (sloped handrails)."""
    A, B = P(f, a[0], a[1], a[2]), P(f, b[0], b[1], b[2])
    d = (B - A).normalized()
    s = d.cross(Vector((0, 0, 1)))
    s = s.normalized() if s.length > 1e-6 else Vector((1, 0, 0))
    u = s.cross(d).normalized()
    bm = bm_for(f, m)
    v = [bm.verts.new((B if i & 1 else A) + s * (w / 2 if i & 2 else -w / 2) + u * (h / 2 if i & 4 else -h / 2)) for i in range(8)]
    for q in ((0, 2, 6, 4), (1, 5, 7, 3), (0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6)):
        bm.faces.new([v[i] for i in q])


# ------------------------------------------------------------------------------------------------ the shell --
def wall(f, side, openings):
    """A wall outside the clear rectangle on `side` (front z<0, back z>D, left x<0, right x>W) with openings
    (a0, a1, y0, y1, fill): fill 'glass' (window), 'door_glass' (front door), 'door' (closed bathroom door), None (open)."""
    L = W if side in ("front", "back") else D
    cuts = sorted(openings)
    t0, t1 = {"front": (-T, 0), "back": (D, D + T), "left": (-T, 0), "right": (W, W + T)}[side]

    def piece(a0, a1, y0, y1, m="M_wall", inset=0.0, thick=None):
        if a1 - a0 < 1e-4 or y1 - y0 < 1e-4:
            return
        lo, hi = (t0, t1) if thick is None else ((t0 + t1) / 2 - thick / 2, (t0 + t1) / 2 + thick / 2)
        if side in ("front", "back"):
            box(f, a0, a1, lo, hi, y0, y1, m)
        else:
            box(f, lo, hi, a0, a1, y0, y1, m)

    a = -T if side in ("front", "back") else 0.0
    for (a0, a1, y0, y1, fill) in cuts:
        piece(a, a0, 0, H)
        piece(a0, a1, 0, y0)
        piece(a0, a1, y1, H)
        # frame
        for (b0, b1) in ((a0 - 0.06, a0), (a1, a1 + 0.06)):
            piece(b0, b1, y0, y1, "M_white", thick=T + 0.04)
        piece(a0 - 0.06, a1 + 0.06, y1, y1 + 0.06, "M_white", thick=T + 0.04)
        if fill == "glass":
            piece(a0, a1, y0, y0 + 0.04, "M_white", thick=T + 0.08)   # sill
            piece(a0, a1, y0, y1, "M_glass", thick=0.02)
        elif fill == "door_glass":
            piece(a0, a1, y0, y1, "M_glass", thick=0.03)
            piece((a0 + a1) / 2 - 0.02, (a0 + a1) / 2 + 0.02, y0, y1, "M_black", thick=0.06)
        elif fill == "door":
            piece(a0, a1, y0, y1, "M_wood_light", thick=0.05)
        a = a1
    piece(a, L + (T if side in ("front", "back") else 0.0), 0, H)


def floor_slab(f, hole=None):
    """Floor top at y 0 (0.3 m slab), skirting; with `hole` (local rect) cut out."""
    def slab(x0, x1, z0, z1):
        if x1 - x0 > 1e-4 and z1 - z0 > 1e-4:
            box(f, x0, x1, z0, z1, -0.3, 0.0, "M_oak")
    if hole is None:
        slab(0, W, 0, D)
    else:
        slab(0, W, 0, hole["minZ"])
        slab(0, W, hole["maxZ"], D)
        slab(0, hole["minX"], hole["minZ"], hole["maxZ"])
        slab(hole["maxX"], W, hole["minZ"], hole["maxZ"])
    for (x0, x1, z0, z1) in ((0, W, 0, 0.015), (0, W, D - 0.015, D), (0, 0.015, 0, D), (W - 0.015, W, 0, D)):
        box(f, x0, x1, z0, z1, 0.0, 0.09, "M_white")


def ceiling(f, hole=None):
    def slab(x0, x1, z0, z1):
        if x1 - x0 > 1e-4 and z1 - z0 > 1e-4:
            box(f, x0, x1, z0, z1, H, H + 0.25, "M_ceiling")
    if hole is None:
        slab(0, W, 0, D)
    else:
        slab(0, W, 0, hole["minZ"])
        slab(0, W, hole["maxZ"], D)
        slab(0, hole["minX"], hole["minZ"], hole["maxZ"])
        slab(hole["maxX"], W, hole["minZ"], hole["maxZ"])
    for (x0, x1, z0, z1) in ((0, W, 0, 0.06), (0, W, D - 0.06, D), (0, 0.06, 0, D), (W - 0.06, W, 0, D)):
        box(f, x0, x1, z0, z1, H - 0.08, H, "M_white")


def stair_steps(f, i_from, y_shift):
    """Treads i_from..15 of the floor-1 stair as solid blocks from y 0 (plus y_shift), white risers, oak treads."""
    fp, climb = SP["footprint"], SP["climb"]
    for i in range(i_from, STAIR["treads"]):
        top = (i + 1) * STAIR["riser"] + y_shift
        bottom = y_shift
        a, b = i * STAIR["tread"], (i + 1) * STAIR["tread"]
        if climb["x"] < 0:
            x0, x1, z0, z1 = fp["maxX"] - b, fp["maxX"] - a, fp["minZ"], fp["maxZ"]
        elif climb["x"] > 0:
            x0, x1, z0, z1 = fp["minX"] + a, fp["minX"] + b, fp["minZ"], fp["maxZ"]
        else:
            x0, x1, z0, z1 = fp["minX"], fp["maxX"], fp["minZ"] + a, fp["minZ"] + b
        box(f, x0, x1, z0, z1, bottom, top - 0.04, "M_white")
        box(f, x0, x1, z0, z1, top - 0.04, top, "M_oak")


def stair_rail_1f():
    """Floor 1: the handrail on the stair's open (room) side, sloped, with posts."""
    fp, climb = SP["footprint"], SP["climb"]
    pts = []
    for i in range(0, STAIR["treads"], 2):
        top = (i + 1) * STAIR["riser"]
        a = (i + 0.5) * STAIR["tread"]
        if climb["x"] < 0:
            p = (fp["maxX"] - a, fp["minZ"] + 0.05)
        elif climb["x"] > 0:
            p = (fp["minX"] + a, fp["minZ"] + 0.05)
        else:
            p = (fp["minX"] + 0.05, fp["minZ"] + a) if fp["minX"] > W / 2 else (fp["maxX"] - 0.05, fp["minZ"] + a)
        if i >= 2:
            box(1, p[0] - 0.02, p[0] + 0.02, p[1] - 0.02, p[1] + 0.02, top, top + STAIR["railHeight"], "M_black")
        pts.append((p[0], p[1], top + STAIR["railHeight"]))
    beam(1, pts[1], pts[-1], 0.05, 0.05, "M_wood_dark")


def well_rail_2f():
    """Floor 2: rail round the stairwell except the landing side and edges against a wall."""
    fp, land = SP["footprint"], SP["landing"]
    edges = [("z", fp["minZ"], fp["minX"], fp["maxX"]), ("z", fp["maxZ"], fp["minX"], fp["maxX"]),
             ("x", fp["minX"], fp["minZ"], fp["maxZ"]), ("x", fp["maxX"], fp["minZ"], fp["maxZ"])]
    for (axis, c, a0, a1) in edges:
        if (axis == "z" and (c < 0.15 or c > D - 0.15)) or (axis == "x" and (c < 0.15 or c > W - 0.15)):
            continue
        # cut away the part shared with the landing
        if axis == "x" and abs(c - land["maxX"]) < 1e-6 or axis == "x" and abs(c - land["minX"]) < 1e-6:
            a0, a1 = (a0, min(a1, land["minZ"])) if land["minZ"] > a0 + 1e-6 else (max(a0, land["maxZ"]), a1)
        if a1 - a0 < 0.05:
            continue
        hr = STAIR["railHeight"]
        if axis == "z":
            box(2, a0, a1, c - 0.03, c + 0.03, hr - 0.06, hr, "M_wood_dark")
            k = a0
            while k <= a1 + 1e-6:
                box(2, k - 0.015, k + 0.015, c - 0.015, c + 0.015, 0, hr, "M_black")
                k += 0.12
        else:
            box(2, c - 0.03, c + 0.03, a0, a1, hr - 0.06, hr, "M_wood_dark")
            k = a0
            while k <= a1 + 1e-6:
                box(2, c - 0.015, c + 0.015, k - 0.015, k + 0.015, 0, hr, "M_black")
                k += 0.12
    # the well's walls down to floor 1 (seen looking down)
    box(2, fp["minX"], fp["maxX"], fp["minZ"] - 0.02, fp["minZ"], -4.0, -0.3, "M_wall")
    box(2, fp["minX"], fp["maxX"], fp["maxZ"], fp["maxZ"] + 0.02, -4.0, -0.3, "M_wall")
    box(2, fp["maxX"], fp["maxX"] + 0.02, fp["minZ"], fp["maxZ"], -4.0, -0.3, "M_wall")
    box(2, fp["minX"] - 0.02, fp["minX"], fp["minZ"], fp["maxZ"], -4.0, -0.3, "M_wall")
    box(2, fp["minX"], fp["maxX"], fp["minZ"], fp["maxZ"], -4.02, -4.0, "M_oak")


# ------------------------------------------------------------------------------------------------- furniture --
def sofa(f, x0, x1, z0, z1, facing, seats, label):
    """A box sofa: seat 0.43, back 0.85, arms 0.62. facing: local direction of the sitter ('-x', '+x', '-z', '+z')."""
    box(f, x0, x1, z0, z1, 0.0, 0.43, "M_fabric")
    depth_back = 0.27
    if facing == "-x":
        box(f, x1 - depth_back, x1, z0, z1, 0.43, 0.85, "M_fabric")
        box(f, x0, x1, z0, z0 + 0.16, 0.43, 0.62, "M_fabric")
        box(f, x0, x1, z1 - 0.16, z1, 0.43, 0.62, "M_fabric")
    HB.col(f, label, x0, x1, z0, z1, 0.85)


def chair(f, cx, cz, local_yaw, label, seat_y=0.46):
    """A dining / desk chair 0.46 x 0.46, back 0.9, facing local_yaw; registers its collider and backed seat."""
    s = 0.23
    box(f, cx - s, cx + s, cz - s, cz + s, seat_y - 0.05, seat_y, "M_wood_light")
    for dx in (-s + 0.03, s - 0.03):
        for dz in (-s + 0.03, s - 0.03):
            box(f, cx + dx - 0.02, cx + dx + 0.02, cz + dz - 0.02, cz + dz + 0.02, 0, seat_y - 0.05, "M_wood_dark")
    bx, bz = -math.sin(local_yaw) * (s - 0.02), -math.cos(local_yaw) * (s - 0.02)
    if abs(bx) > abs(bz):
        box(f, cx + bx - 0.02, cx + bx + 0.02, cz - s, cz + s, seat_y, 0.9, "M_wood_light")
    else:
        box(f, cx - s, cx + s, cz + bz - 0.02, cz + bz + 0.02, seat_y, 0.9, "M_wood_light")
    HB.col(f, label, cx - s - 0.01, cx + s + 0.01, cz - s - 0.01, cz + s + 0.01, 0.9)
    HB.seat(f, "chair", cx, cz, seat_y, local_yaw, edge=0.23, back=0.21, width=0.46, exit_turn=math.pi, lean=0.1)


def table(f, x0, x1, z0, z1, h, label, m="M_wood_light"):
    box(f, x0, x1, z0, z1, h - 0.04, h, m)
    for (x, z) in ((x0 + 0.06, z0 + 0.06), (x1 - 0.06, z0 + 0.06), (x0 + 0.06, z1 - 0.06), (x1 - 0.06, z1 - 0.06)):
        box(f, x - 0.03, x + 0.03, z - 0.03, z + 0.03, 0, h - 0.04, "M_wood_dark")
    HB.col(f, label, x0, x1, z0, z1, h)


def plant(f, cx, cz, r, h, label):
    cyl(f, cx, cz, 0, 0.4, r * 0.7, "M_white")
    ball(f, cx, cz, 0.4 + (h - 0.4) * 0.55, r, "M_plant")
    HB.col(f, label, cx - r * 0.75, cx + r * 0.75, cz - r * 0.75, cz + r * 0.75, 0.6)


def floor_1():
    f = 1
    fp = SP["footprint"]
    floor_slab(f)
    box(f, 3.6, 7.0, 0.0, 1.5, 0.0, 0.012, "M_tile")              # 현관 tiles
    box(f, 3.6, 7.0, 1.48, 1.52, 0.0, 0.03, "M_wood_dark")        # 귀틀 (sill)
    ceiling(f, hole=fp)
    win = 0.9, 2.2
    wall(f, "front", [(2.18, 3.18, *win, "glass"), (4.4, 6.2, 0.0, 2.9, "door_glass"), (7.42, 8.42, *win, "glass")])
    wall(f, "back", [(0.6, 1.5, 0.0, 2.1, "door"), (2.53, 3.53, *win, "glass"), (6.65, 7.65, *win, "glass")])
    wall(f, "left", [(3.6, 4.65, *win, "glass")])
    wall(f, "right", [(3.6, 4.65, *win, "glass")])
    # entrance: side partitions, transom over the inner door, the inner glass door stacked open, floating shoe cabinet
    box(f, 3.5, 3.6, 0.0, 1.5, 0.0, H, "M_wall")
    box(f, 7.0, 7.1, 0.0, 1.5, 0.0, H, "M_wall")
    box(f, 3.6, 7.0, 1.45, 1.55, 2.6, H, "M_wall")
    HB.col(f, "part_entry_l", 3.5, 3.6, 0.0, 1.5, H)
    HB.col(f, "part_entry_r", 7.0, 7.1, 0.0, 1.5, H)
    for k in range(3):
        box(f, 6.37 + k * 0.21, 6.4 + k * 0.21, 1.4 + k * 0.03, 1.6 - k * 0.03, 0.0, 2.6, "M_glass")
        box(f, 6.35 + k * 0.21, 6.42 + k * 0.21, 1.43, 1.57, 2.55, 2.6, "M_black")
    HB.col(f, "middoor", 6.35, 7.0, 1.4, 1.6, 2.6)
    box(f, 3.6, 4.05, 0.05, 1.45, 0.25, 1.2, "M_white")
    HB.col(f, "shoe_cabinet", 3.6, 4.05, 0.05, 1.45, 1.2)
    # living: TV wall (left), rug, round coffee table, 3-seat sofa facing the TV, lounge chair, lamp, plants
    box(f, 0.0, 0.45, 2.9, 4.9, 0.0, 0.5, "M_wood_dark")
    HB.col(f, "tv_cabinet", 0.0, 0.45, 2.9, 4.9, 0.5)
    box(f, 0.02, 0.08, 3.2, 4.6, 1.0, 1.82, "M_black")
    box(f, 1.0, 2.7, 2.7, 5.1, 0.0, 0.01, "M_rug")
    cyl(f, 1.6, 3.9, 0.38, 0.42, 0.33, "M_wood_light")
    cyl(f, 1.6, 3.9, 0.0, 0.38, 0.05, "M_black")
    HB.col(f, "coffee_table", 1.27, 1.93, 3.57, 4.23, 0.42)
    sofa(f, 2.95, 3.9, 2.7, 5.1, "-x", 3, "sofa")
    for zc in (3.18, 3.9, 4.62):
        HB.seat(f, "sofa", 3.33, zc, 0.43, -math.pi / 2, edge=0.38, back=0.30, width=0.72, lean=0.26)
    box(f, 1.8, 2.6, 5.5, 6.3, 0.0, 0.42, "M_accent")
    box(f, 1.8, 2.6, 6.05, 6.3, 0.42, 0.85, "M_accent")
    box(f, 1.8, 1.92, 5.5, 6.05, 0.42, 0.6, "M_accent")
    box(f, 2.48, 2.6, 5.5, 6.05, 0.42, 0.6, "M_accent")
    HB.col(f, "lounge_chair", 1.8, 2.6, 5.5, 6.3, 0.85)
    HB.seat(f, "armchair", 2.2, 5.77, 0.42, math.pi, edge=0.27, back=0.28, width=0.56, lean=0.26)
    cyl(f, 0.35, 5.6, 0.0, 1.5, 0.02, "M_black")
    cyl(f, 0.35, 5.6, 1.35, 1.6, 0.16, "M_white")
    HB.col(f, "floor_lamp", 0.2, 0.5, 5.45, 5.75, 1.5)
    plant(f, 0.45, 1.95, 0.3, 1.2, "plant_front")
    plant(f, 4.6, 7.25, 0.3, 1.4, "plant_back")
    # kitchen: L counter (front wall under the window + right wall), fridge, 4-seat table, pendants
    box(f, 7.1, W, 0.0, 0.6, 0.0, 0.86, "M_white")
    box(f, 7.1, W, 0.0, 0.62, 0.86, 0.9, "M_wood_light")
    box(f, 7.6, 8.2, 0.08, 0.5, 0.82, 0.9, "M_black")                # sink
    box(f, 8.6, W, 0.0, 0.35, 1.5, 2.3, "M_white")                    # upper cabinets
    HB.col(f, "counter_front", 7.1, W, 0.0, 0.62, 0.9)
    box(f, 10.0, W, 0.62, 2.6, 0.0, 0.86, "M_white")
    box(f, 9.98, W, 0.62, 2.6, 0.86, 0.9, "M_wood_light")
    box(f, 10.1, 10.5, 1.2, 1.8, 0.9, 0.91, "M_black")                # induction
    box(f, 10.05, W, 1.15, 1.85, 1.6, 2.2, "M_white")                 # hood
    HB.col(f, "counter_right", 9.98, W, 0.62, 2.6, 0.9)
    box(f, 9.9, W, 2.6, 3.4, 0.0, 1.9, "M_white")
    HB.col(f, "fridge", 9.9, W, 2.6, 3.4, 1.9)
    table(f, 7.6, 9.0, 2.2, 3.0, 0.74, "dining_table")
    for xc in (7.95, 8.65):
        chair(f, xc, 1.95, 0.0, f"chair_near_{int(xc * 100)}")
        chair(f, xc, 3.25, math.pi, f"chair_far_{int(xc * 100)}")
    for xc in (7.95, 8.65):
        cyl(f, xc, 2.6, 1.6, H, 0.008, "M_black")
        cyl(f, xc, 2.6, 1.45, 1.6, 0.15, "M_brass")
    # the stair (floor 1)
    stair_steps(f, 0, 0.0)
    stair_rail_1f()


def floor_2():
    f = 2
    fp = SP["footprint"]
    floor_slab(f, hole=fp)
    ceiling(f)
    win = 0.9, 2.1
    wall(f, "front", [(2.18, 3.18, *win, "glass"), (4.8, 5.8, *win, "glass"), (7.42, 8.42, *win, "glass")])
    wall(f, "back", [(2.53, 3.53, *win, "glass"), (6.65, 7.65, *win, "glass")])
    wall(f, "left", [(3.6, 4.65, 1.2, 2.1, "glass"), (5.4, 6.3, 0.0, 2.1, "door")])
    wall(f, "right", [(3.6, 4.65, *win, "glass")])
    # the floor-1 stair's top steps seen through the well, the rail round it
    stair_steps(f, STAIR["treads"] - STAIR["wellSteps"], -4.0)
    well_rail_2f()
    # queen bed, headboard on the left wall, nightstands + lamps; edge seats on both long sides
    box(f, 0.0, 2.15, 2.3, 3.95, 0.0, 0.3, "M_wood_light")
    box(f, 0.05, 2.12, 2.33, 3.92, 0.3, 0.5, "M_bed")
    box(f, 0.0, 0.1, 2.25, 4.0, 0.0, 1.1, "M_wood_light")
    for zc in (2.75, 3.5):
        box(f, 0.15, 0.55, zc - 0.3, zc + 0.3, 0.5, 0.62, "M_white")
    box(f, 0.9, 2.12, 2.33, 3.92, 0.5, 0.56, "M_accent")
    HB.col(f, "bed", 0.0, 2.15, 2.3, 3.95, 1.1)
    HB.seat(f, "bed", 1.3, 2.55, 0.5, math.pi, edge=0.25, width=0.6)
    HB.seat(f, "bed", 1.3, 3.7, 0.5, 0.0, edge=0.25, width=0.6)
    for (z0, z1) in ((1.8, 2.25), (4.0, 4.45)):
        box(f, 0.0, 0.45, z0, z1, 0.0, 0.55, "M_wood_dark")
        cyl(f, 0.22, (z0 + z1) / 2, 0.55, 0.85, 0.1, "M_white")
        HB.col(f, f"nightstand_{int(z0 * 10)}", 0.0, 0.45, z0, z1, 0.55)
    # vanity + stool (front wall)
    box(f, 0.9, 1.9, 0.0, 0.45, 0.0, 0.75, "M_white")
    box(f, 1.05, 1.75, 0.0, 0.03, 1.0, 1.8, "M_glass")
    HB.col(f, "vanity", 0.9, 1.9, 0.0, 0.45, 0.75)
    cyl(f, 1.4, 0.8, 0.0, 0.45, 0.2, "M_accent")
    HB.col(f, "stool", 1.2, 1.6, 0.6, 1.0, 0.45)
    HB.seat(f, "stool", 1.4, 0.8, 0.45, 0.0, edge=0.2, width=0.4, both=True)
    # wardrobe (right wall), window desk + chair, bookshelf, rug, plant
    box(f, 10.0, W, 0.2, 2.6, 0.0, 2.4, "M_wood_light")
    for zc in (1.0, 1.8):
        box(f, 9.98, 10.0, zc - 0.005, zc + 0.005, 0.1, 2.3, "M_wood_dark")
    HB.col(f, "wardrobe", 10.0, W, 0.2, 2.6, 2.4)
    table(f, 9.95, W, 3.4, 4.9, 0.74, "desk", "M_white")
    chair(f, 9.45, 4.15, math.pi / 2, "desk_chair")
    box(f, 10.25, W, 5.1, 6.2, 0.0, 1.9, "M_wood_dark")
    HB.col(f, "bookshelf", 10.25, W, 5.1, 6.2, 1.9)
    box(f, 2.4, 4.4, 2.0, 4.3, 0.0, 0.01, "M_rug")
    plant(f, 3.0, 7.35, 0.25, 1.1, "plant")


def build():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    floor_1()
    floor_2()
    HB.walls()
    HB.stair_colliders()
    problems = HB.check()
    if problems:
        raise SystemExit("CONTRACT FAIL:\n  " + "\n  ".join(problems))
    for (f, m), bm in sorted(BMS.items()):
        me = bpy.data.meshes.new(f"h{N}_{f}_{m}")
        bm.normal_update()
        bm.to_mesh(me)
        bm.free()
        me.materials.append(mat(m))
        ob = bpy.data.objects.new(f"mesh__h{N}_{f}_{m[2:].lower()}", me)
        bpy.context.scene.collection.objects.link(ob)
        ob.parent = HB.floor_root(f)
    HB.emit()


def export():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=False, export_apply=True, export_yup=True,
                              export_texcoords=False, export_normals=True, export_materials="EXPORT", export_animations=False,
                              export_cameras=False, export_lights=False, export_extras=True, export_skins=False,
                              export_morph=False, export_draco_mesh_compression_enable=True,
                              export_draco_mesh_compression_level=6)
    info = {"glb": OUT, "bytes": os.path.getsize(OUT), "seats": len(HB.seats), "colliders": len(HB.cols)}
    print("BLOCKOUT", json.dumps(info))


# ---------------------------------------------------------------------------------------------------- render --
def render():
    os.makedirs(RENDER, exist_ok=True)
    sc = bpy.context.scene
    try:
        sc.render.engine = "CYCLES"
    except TypeError:
        pass
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    try:
        sc.cycles.device = "GPU"
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for t in ("OPTIX", "CUDA"):
            try:
                prefs.compute_device_type = t
                prefs.get_devices()
                for d in prefs.devices:
                    d.use = True
                break
            except Exception:
                continue
    except Exception:
        sc.cycles.device = "CPU"
    sc.view_settings.view_transform = "AgX"
    w = bpy.data.worlds.new("w")
    sc.world = w
    w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (0.65, 0.78, 0.95, 1)
    bg.inputs["Strength"].default_value = 1.2
    # glass lets light through in the render
    for m in MATS.values():
        if m.name == "M_glass":
            p = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
            p.inputs["Transmission Weight"].default_value = 1.0
    # ceiling lights
    for f in (1, 2):
        for (lx, lz) in ((2.0, 2.2), (2.0, 5.6), (5.3, 3.9), (8.6, 2.2), (8.6, 5.0)):
            ld = bpy.data.lights.new("l", "AREA")
            ld.energy = 140
            ld.size = 0.8
            lo = bpy.data.objects.new("l", ld)
            lo.location = P(f, lx, lz, H - 0.05)
            sc.collection.objects.link(lo)
    # markers drawn for the plan views (not exported: export already ran)
    marker_mats = {"backed": (1.0, 0.45, 0.1), "backless": (0.1, 0.8, 0.3), "floor": (0.6, 0.3, 0.9)}
    for s in HB.seats:
        col = marker_mats[s["kind"]]
        mm = bpy.data.materials.new("mk")
        mm.use_nodes = True
        e = next(n for n in mm.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        e.inputs["Emission Color"].default_value = (*col, 1)
        e.inputs["Emission Strength"].default_value = 3.0
        e.inputs["Base Color"].default_value = (*col, 1)
        bpy.ops.mesh.primitive_cone_add(radius1=0.16, radius2=0.0, depth=0.4, location=P(s["floor"], s["lx"], s["lz"], s["y"] + 0.2))
        cone = bpy.context.object
        yaw = HC.yaw_l2w(s["local_yaw"])
        cone.rotation_euler = (math.pi / 2, 0, yaw)   # tip along the facing
        cone.data.materials.append(mm)
    pm = bpy.data.materials.new("pad")
    pm.use_nodes = True
    e = next(n for n in pm.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    e.inputs["Emission Color"].default_value = (0.2, 0.6, 1.0, 1)
    e.inputs["Emission Strength"].default_value = 3.0
    p = HC.house(N)["places"]
    for key in ("upPad", "downPad", "exitPad"):
        sp = p[key]
        bpy.ops.mesh.primitive_torus_add(major_radius=sp["radius"], minor_radius=0.03, location=HC.V(sp["x"], sp["z"], 0.05))
        bpy.context.object.data.materials.append(pm)
    # a 2.16 m chibi stand-in at the entrance spawn and at the floor-2 arrival
    for key in ("spawnIn", "spawnUp"):
        sp = p[key]
        bpy.ops.mesh.primitive_cylinder_add(radius=0.3, depth=1.1, location=HC.V(sp["x"], sp["z"], 0.55))
        bpy.context.object.data.materials.append(mat("M_accent"))
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.5, location=HC.V(sp["x"], sp["z"], 1.66))
        bpy.context.object.data.materials.append(mat("M_accent"))

    def shoot(name, f, eye, look, lens=18, ortho=None, hide_ceiling=False, res=(1600, 900)):
        hidden = []
        if hide_ceiling:
            for o in bpy.data.objects:
                if o.type == "MESH" and ("ceiling" in o.name or o.name.endswith("_wall")):
                    o.hide_render = True
                    hidden.append(o)
        cam_d = bpy.data.cameras.new(name)
        cam = bpy.data.objects.new(name, cam_d)
        sc.collection.objects.link(cam)
        cam.location = P(f, *eye) if len(eye) == 3 else eye
        tgt = P(f, *look)
        cam.rotation_euler = (tgt - cam.location).to_track_quat("-Z", "Y").to_euler()
        if ortho:
            cam_d.type = "ORTHO"
            cam_d.ortho_scale = ortho
        else:
            cam_d.lens = lens
        cam_d.clip_end = 200
        sc.camera = cam
        sc.render.resolution_x, sc.render.resolution_y = res
        sc.render.filepath = os.path.join(RENDER, name + ".png")
        bpy.ops.render.render(write_still=True)
        for o in hidden:
            o.hide_render = False
        print("RENDER", sc.render.filepath)

    shoot("h1_1f_plan", 1, (5.3, 3.9, 14.0), (5.3, 3.9001, 0.0), ortho=12.5, hide_ceiling=True, res=(1600, 1200))
    shoot("h1_2f_plan", 2, (5.3, 3.9, 14.0), (5.3, 3.9001, 0.0), ortho=12.5, hide_ceiling=True, res=(1600, 1200))
    shoot("h1_1f_entry", 1, (5.3, 1.9, 2.3), (4.0, 5.5, 0.9), lens=16)
    shoot("h1_1f_kitchen", 1, (9.9, 4.9, 2.4), (4.0, 2.0, 0.6), lens=16)
    shoot("h1_2f_landing", 2, (4.4, 7.4, 2.3), (4.0, 2.5, 0.5), lens=16)
    shoot("h1_2f_well", 2, (2.6, 5.6, 2.6), (8.0, 7.0, -1.2), lens=18)


build()
export()
if RENDER:
    render()
