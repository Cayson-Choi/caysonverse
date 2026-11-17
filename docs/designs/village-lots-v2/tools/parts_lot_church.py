"""케이슨 마을 교회 (lot_church) — build the kit into its own GLB, check it, render it (Blender 5.3, background).

  blender -b --factory-startup -P docs/designs/village-lots-v2/tools/parts_lot_church.py -- --layout <lots.json> \
      --png <decoded PBR pngs> [--out client/public/models/village/lots/lot_church.glb] [--report <json>] \
      [--renders <dir>] [--views street,...] [--times day,night] [--res 1280x800] [--samples 16] [--no-export]

Geometry: church_kit.py on b2_parts.py / B1's b1_parts.py, b1_geom.py; Blender side: B1's b1_blender.run (shared, unchanged).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import b1_blender as B  # noqa: E402
import church_kit  # noqa: E402

VIEWDEF = {
    # name: (camera local (x, y, z), target local, lens mm) — z = out of the door (north, the plaza), y up
    "street": ((2.0, 1.7, 26.0), (0.0, 8.5, -2.0), 22),
    "corner": ((14.0, 1.8, 17.0), (0.0, 8.0, -2.5), 22),
    "corner_l": ((-14.0, 1.8, 17.0), (0.0, 8.0, -2.5), 22),
    "back": ((9.0, 2.0, -20.0), (0.0, 6.0, -4.0), 22),
    "top": ((-20.0, 22.0, 24.0), (0.0, 7.0, -2.0), 24),
    "entrance": ((0.8, 1.6, 9.0), (0.0, 3.0, 3.0), 22),
    "porch": ((0.5, 1.55, 6.6), (0.0, 2.6, 2.9), 24),
    "steeple": ((5.0, 2.0, 12.0), (0.0, 15.0, 1.5), 26),
    "bench": ((-7.0, 1.2, 7.5), (-7.0, 0.7, 4.3), 28),
    "notice": ((6.5, 1.5, 9.5), (6.5, 1.4, 6.4), 30),
    "window": ((6.5, 2.6, -2.0), (4.1, 3.4, -4.2), 30),
}

if __name__ == "__main__":
    B.run("lot_church", church_kit, VIEWDEF, "church", "church")
