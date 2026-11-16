"""houses_contract.py — the house-interior CONTRACT for Blender scripts (P0, 2026-11-16).

The single source of truth is shared/src/village/houseAreas.ts; this module only reads its JSON copy
(docs/designs/houses-interior/contract.json, written by `npx tsx scripts/export-house-contract.ts`) and gives the build scripts
the few helpers every chunk must use the same way: local -> world coordinates, the node names, collider boxes, seat markers and
the place markers (pads, spawns, ceiling helpers). K copies it next to its kit (art/village/tools/houses/houses_contract.py, or
imports it from here with sys.path); HA / HB build each house through `HouseBuild`. Do not change the rules here: change
houseAreas.ts, re-export the JSON, and tell every chunk.

Coordinates (see houseAreas.ts):
  LOCAL  x 0..10.6 left -> right as seen coming in, z 0..7.8 entrance wall -> back wall, y up; local yaw 0 faces local +z.
  WORLD  game coords (x east, z south, y up): x = originX + lx, z = originZ - lz; world yaw = pi - local yaw.
  BLENDER  Vector((x, -z, y)) (vlib.V); an empty's rotation_euler.z = world yaw makes its glTF +z face the game yaw.
"""
import json
import math
import os

try:  # Blender
    import bmesh
    import bpy
    from mathutils import Vector
except ImportError:  # plain Python (tests, tools)
    bpy = None

HERE = os.path.dirname(os.path.abspath(__file__))
CONTRACT_PATH = os.environ.get("CV_HOUSE_CONTRACT", os.path.join(HERE, "contract.json"))
C = json.load(open(CONTRACT_PATH, encoding="utf-8"))
ROOM = C["room"]
STAIR = C["stair"]
HOUSES = {h["n"]: h for h in C["houses"]}
SEAT_FURN_KIND = C["seat"]["furn"]
SEAT_EXTRAS = C["seat"]["extras"]


def house(n):
    return HOUSES[n]


def origin(n, floor):
    o = HOUSES[n]["origin"][str(floor)]
    return o["x"], o["z"]


def l2w(n, floor, lx, lz):
    """Local room point -> world (game) x, z."""
    ox, oz = origin(n, floor)
    return round(ox + lx, 6), round(oz - lz, 6)


def yaw_l2w(local_yaw):
    """Local yaw (0 = into the room, pi/2 = the visitor's right) -> game yaw. Its own inverse."""
    a = math.pi - local_yaw
    while a > math.pi:
        a -= 2 * math.pi
    while a <= -math.pi:
        a += 2 * math.pi
    return a


def V(x, z, y=0.0):
    """Game point -> Blender vector (same as vlib.V)."""
    return Vector((x, -z, y))


# ------------------------------------------------------------------------------------------------ node names --
def n_floor(n, f):
    return f"floor__h{n}_{f}"


def n_col(n, f, label):
    return f"col__h{n}_{f}_{label}"


def n_seat(n, f, k):
    return f"seat__h{n}_{f}_{k}"


def n_ceil(n, f):
    return f"ceil__h{n}_{f}"


def seat_kind(furn):
    return SEAT_FURN_KIND[furn]


def seat_pose(furn, y):
    kind = SEAT_FURN_KIND[furn]
    if kind == "floor":
        return "floor"
    return "perch" if y >= C["seat"]["heights"]["perch"]["min"] - 1e-6 else "chair"


def seat_approach(kind, back, both):
    if kind == "backed":
        return "front"
    if kind == "backless":
        return "any" if both else "front"
    return "front" if back > 0 else "any"


class HouseBuild:
    """Registry of one house: colliders, seats and the contract's place markers, in LOCAL coordinates per floor.

    Typical use (an h0N.py script):
        hb = HouseBuild(1)
        hb.col(1, "sofa", 2.95, 3.9, 2.7, 5.1, 0.85)                  # local box, height
        hb.seat(1, "sofa", 3.5, 3.4, 0.43, -math.pi / 2, edge=0.38, back=0.25, width=0.72, lean=0.26)
        hb.walls(); hb.stairwell_colliders()
        hb.emit()                                                     # creates col__/seat__/stair__/door__/spawn__/ceil__ objects
    Visible meshes go under hb.floor_root(f) (identity empties floor__h<N>_<F>), never at the root.
    """

    def __init__(self, n):
        self.n = n
        self.h = HOUSES[n]
        self.cols = []    # (floor, label, minX, maxX, minZ, maxZ, height) local
        self.seats = []   # dicts (local), see seat()
        self._roots = {}

    # -- registry --------------------------------------------------------------------------------------------
    def col(self, floor, label, x0, x1, z0, z1, height):
        """A collider box in local coordinates. height >= 1.6 makes it a camera box (walls, wardrobes, bookcases)."""
        assert floor in (1, 2) and label.replace("_", "").isalnum() and label == label.lower(), label
        self.cols.append((floor, label, min(x0, x1), max(x0, x1), min(z0, z1), max(z0, z1), height))

    def seat(self, floor, furn, lx, lz, y, local_yaw, edge, back=0.0, width=0.6, both=False, exit_turn=0.0, lean=0.0, group=None):
        """A seat marker at the middle of the seat surface (local x, z; y = surface height), facing local_yaw (local).
        kind / pose / approach follow from furn, y, back and both (houseAreas.ts rules)."""
        kind = SEAT_FURN_KIND[furn]
        k = sum(1 for s in self.seats if s["floor"] == floor)
        sid = f"h{self.n}_{floor}_{k}"
        self.seats.append(dict(id=sid, floor=floor, k=k, furn=furn, kind=kind, pose=seat_pose(furn, y),
                               approach=seat_approach(kind, back, both), lx=lx, lz=lz, y=y, local_yaw=local_yaw,
                               edge=edge, back=back, width=width, group=group or sid, both=both, exitTurn=exit_turn,
                               lean=lean))
        return sid

    def walls(self, height=None):
        """The four walls of both floors as colliders, outside the clear rectangle (thickness ROOM.wall)."""
        t, W, D = ROOM["wall"], ROOM["width"], ROOM["depth"]
        h = height or ROOM["ceiling"]
        for f in (1, 2):
            self.col(f, "wall_front", -t, W + t, -t, 0.0, h)
            self.col(f, "wall_back", -t, W + t, D, D + t, h)
            self.col(f, "wall_left", -t, 0.0, 0.0, D, h)
            self.col(f, "wall_right", W, W + t, 0.0, D, h)

    def stair_plan(self):
        return C["stairPlans"][self.h["stair"]]

    def stair_colliders(self):
        """Floor 1: the stair in two boxes (the low first 4 treads, 1.0 m, not a camera box; the rest up to the ceiling).
        Floor 2: the stairwell (hole + its rail) as one 1.0 m box over the footprint (the landing side stays open)."""
        p = self.stair_plan()
        f = p["footprint"]
        cut = STAIR["tread"] * 4
        cx, cz = p["climb"]["x"], p["climb"]["z"]
        if cx < 0:      # A: foot at maxX
            low, high = (f["maxX"] - cut, f["maxX"], f["minZ"], f["maxZ"]), (f["minX"], f["maxX"] - cut, f["minZ"], f["maxZ"])
        elif cx > 0:    # B: foot at minX
            low, high = (f["minX"], f["minX"] + cut, f["minZ"], f["maxZ"]), (f["minX"] + cut, f["maxX"], f["minZ"], f["maxZ"])
        else:           # C, D: foot at minZ
            low, high = (f["minX"], f["maxX"], f["minZ"], f["minZ"] + cut), (f["minX"], f["maxX"], f["minZ"] + cut, f["maxZ"])
        assert cz >= 0
        self.col(1, "stair_low", *low, 1.0)
        self.col(1, "stair_high", *high, ROOM["ceiling"])
        self.col(2, "stairwell", f["minX"], f["maxX"], f["minZ"], f["maxZ"], 1.0)

    # -- Blender ------------------------------------------------------------------------------------------------
    def floor_root(self, floor):
        """The identity empty every visible mesh of this floor is parented to (floor__h<N>_<F>)."""
        if floor not in self._roots:
            e = bpy.data.objects.new(n_floor(self.n, floor), None)
            e["cat"] = "floor"
            bpy.context.scene.collection.objects.link(e)
            self._roots[floor] = e
        return self._roots[floor]

    def emit(self, coll=None):
        """Create every contract node: col__ boxes, seat__ empties (custom props = glTF extras), the pads, spawns and ceilings."""
        coll = coll or bpy.context.scene.collection
        made = []
        me = _unit_cube()
        for (f, label, x0, x1, z0, z1, h) in self.cols:
            ax, az = l2w(self.n, f, x0, z0)
            bx, bz = l2w(self.n, f, x1, z1)
            ob = bpy.data.objects.new(n_col(self.n, f, label), me)
            ob.location = V((ax + bx) / 2, (az + bz) / 2, h / 2)
            ob.scale = (abs(bx - ax), abs(bz - az), h)
            ob["cat"] = "collider"
            ob.hide_render = True
            ob.display_type = "WIRE"
            coll.objects.link(ob)
            made.append(ob)
        for s in self.seats:
            x, z = l2w(self.n, s["floor"], s["lx"], s["lz"])
            yaw = yaw_l2w(s["local_yaw"])
            e = bpy.data.objects.new(n_seat(self.n, s["floor"], s["k"]), None)
            e.empty_display_type = "ARROWS"
            e.empty_display_size = 0.25
            e.location = V(x, z, s["y"])
            e.rotation_euler = (0.0, 0.0, yaw)
            e["cat"] = "seat"
            extras = dict(furn=s["furn"], kind=s["kind"], pose=s["pose"], approach=s["approach"], yaw=round(yaw, 6),
                          edge=s["edge"], back=s["back"], width=s["width"], group=s["group"], both=int(bool(s["both"])),
                          exitTurn=s["exitTurn"], lean=s["lean"])
            assert set(extras) == set(SEAT_EXTRAS), sorted(set(extras) ^ set(SEAT_EXTRAS))
            for k, v in extras.items():
                e[k] = v
            coll.objects.link(e)
            made.append(e)
        p = self.h["places"]
        for name, spot in ((f"stair__h{self.n}_up", p["upPad"]), (f"stair__h{self.n}_down", p["downPad"]),
                           (f"door__h{self.n}_exit", p["exitPad"]), (f"spawn__h{self.n}_in", p["spawnIn"]),
                           (f"spawn__h{self.n}_2", p["spawnUp"]), (f"spawn__h{self.n}_1s", p["spawnDown"])):
            e = bpy.data.objects.new(name, None)
            e.empty_display_type = "SINGLE_ARROW" if name.startswith("spawn") else "CIRCLE"
            e.empty_display_size = spot.get("radius", 0.4)
            e.location = V(spot["x"], spot["z"], 0.0)
            e.rotation_euler = (0.0, 0.0, spot["yaw"])
            e["cat"] = "place"
            coll.objects.link(e)
            made.append(e)
        for f in (1, 2):
            b = self.h["bounds"][str(f)]
            ob = bpy.data.objects.new(n_ceil(self.n, f), me)
            ob.location = V((b["minX"] + b["maxX"]) / 2, (b["minZ"] + b["maxZ"]) / 2, ROOM["ceiling"] + 0.05)
            ob.scale = (b["maxX"] - b["minX"], b["maxZ"] - b["minZ"], 0.1)
            ob["cat"] = "helper"
            ob.hide_render = True
            ob.display_type = "WIRE"
            coll.objects.link(ob)
            made.append(ob)
        return made

    def check(self):
        """Contract checks that need no GLB: seat counts per floor and kind, keep-clear zones free of colliders."""
        problems = []
        for f in (1, 2):
            want = self.h["seats"][str(f)]
            got = {}
            for s in self.seats:
                if s["floor"] == f:
                    got[s["kind"]] = got.get(s["kind"], 0) + 1
            if got != want:
                problems.append(f"floor {f}: seats {got} != plan {want}")
            for zone in self.h["keepClear"][str(f)]:
                zb = zone["box"]
                for (cf, label, x0, x1, z0, z1, h) in self.cols:
                    if cf == f and not label.startswith("wall_") and x0 < zb["maxX"] and zb["minX"] < x1 and z0 < zb["maxZ"] and zb["minZ"] < z1:
                        problems.append(f"floor {f}: col {label} reaches into {zone['name']}")
        return problems


def _unit_cube():
    me = bpy.data.meshes.get("__unit_cube")
    if me is None:
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        me = bpy.data.meshes.new("__unit_cube")
        bm.to_mesh(me)
        bm.free()
    return me
