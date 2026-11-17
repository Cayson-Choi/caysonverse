"""마을 절 (lot_temple) — build the kit into its own GLB, check it, render it (Blender 5.3, background).

  blender -b --factory-startup -P docs/designs/village-lots-v2/tools/parts_lot_temple.py -- --layout <lots.json> \
      --png <decoded PBR pngs> [--out client/public/models/village/lots/lot_temple.glb] [--report <json>] \
      [--renders <dir>] [--views street,...] [--times day,night] [--res 1280x800] [--samples 16] [--no-export]

Geometry: temple_kit.py on temple_parts.py / b1_parts.py / b1_geom.py; Blender side: b1_blender.run (shared with B1).
The two granite benches are backless and have no contract collider (contract 3): L5's lotSeatFurnitureBoxes makes their boxes
(seat length x twice the front edge), so the overlap check counts those boxes as solid too.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import b1_blender as B  # noqa: E402
import temple_kit  # noqa: E402

VIEWDEF = {
    # name: (camera local (x, y, z), target local, lens mm) — x right of the 일주문, z out of the front (east, the lane), y up
    "street": ((4.0, 1.7, 24.0), (0.0, 4.5, 0.0), 24),
    "lane_l": ((-16.0, 1.7, 19.0), (-2.0, 4.0, 0.0), 24),
    "gate": ((0.6, 1.6, 17.0), (0.0, 4.2, 11.0), 26),
    "gate_up": ((0.3, 1.5, 14.6), (0.0, 4.6, 12.2), 22),
    "approach": ((0.4, 1.6, 11.0), (0.0, 4.5, -6.0), 22),
    "court": ((6.5, 1.7, 9.5), (-2.0, 3.5, -4.0), 20),
    "hall": ((2.0, 1.6, 2.0), (0.0, 5.0, -7.0), 20),
    "eaves": ((3.5, 1.5, -2.6), (2.0, 5.4, -5.2), 20),
    "doors": ((0.8, 1.6, -1.6), (0.0, 2.6, -4.9), 24),
    "lantern": ((1.6, 1.5, 4.0), (0.0, 1.5, 1.7), 30),
    "pagoda": ((-1.5, 1.6, 6.5), (-5.0, 3.2, 2.5), 24),
    "bell": ((-6.0, 1.6, -4.0), (-9.7, 2.6, -8.5), 22),
    "pond": ((3.0, 1.6, 0.5), (7.2, 0.0, 6.0), 24),
    "pines": ((4.0, 1.6, 6.0), (-9.5, 5.0, -1.0), 20),
    "top": ((-22.0, 24.0, 24.0), (0.0, 2.0, -1.0), 24),
    "corner": ((17.0, 3.0, 18.0), (0.0, 4.0, -2.0), 22),
}


def seat_boxes(lot):
    """L5 lotSeatFurnitureBoxes: length x 2 front edges round each seat with no collider of its own (world AABBs)."""
    import math
    out = []
    for s in lot["seats"]:
        half = s["length"] / 2
        d = s["frontEdge"]
        ca, sa = abs(math.cos(s["yaw"])), abs(math.sin(s["yaw"]))
        hx = half * ca + d * sa
        hz = half * sa + d * ca
        out.append({"id": s["id"], "box": {"minX": s["x"] - hx, "maxX": s["x"] + hx, "minZ": s["z"] - hz, "maxZ": s["z"] + hz}, "camera": False, "cameraHeight": 0})
    return out


_orig = B.overlap_check


def overlap_with_seats(kit, lot):
    lot2 = dict(lot)
    lot2["colliders"] = list(lot["colliders"]) + seat_boxes(lot)
    return _orig(kit, lot2)


B.overlap_check = overlap_with_seats

_build_objects = B.build_objects


def build_objects(lot, kit, mats):
    """B1's objects; a collider box of exactly 1 x 1 x 1 m (the 석등's) would export with no scale (glTF identity is dropped)
    and lose its size for the readers: keep it 0.999 m tall instead (the contract's plan box is unchanged)."""
    objs, report, door_extras = _build_objects(lot, kit, mats)
    for o in objs:
        if o.name.startswith("col__") and all(abs(v - 1.0) < 1e-6 for v in o.scale):
            o.scale = (1.0, 1.0, 0.999)
            o.location = (o.location[0], o.location[1], 0.4995)
    return objs, report, door_extras


B.build_objects = build_objects

if __name__ == "__main__":
    B.run("lot_temple", temple_kit, VIEWDEF, "temple", "temple")
