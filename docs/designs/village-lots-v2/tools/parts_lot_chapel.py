"""케이슨 마을 성당 (lot_chapel) — build the kit into its own GLB, check it, render it (Blender 5.3, background).

  blender -b --factory-startup -P docs/designs/village-lots-v2/tools/parts_lot_chapel.py -- --layout <lots.json> \
      --png <decoded PBR pngs> [--out client/public/models/village/lots/lot_chapel.glb] [--report <json>] \
      [--renders <dir>] [--views street,...] [--times day,night] [--res 1280x800] [--samples 16] [--no-export]

`--layout`: `lotsForLayoutJson()` + `LOT_ROOF_SLABS` + `LOT_INTERIORS` as JSON (npx tsx); `--png`: the library's KTX2 sets
decoded to PNG so the renders use the game's textures. Geometry: chapel_kit.py on b2_parts.py / B1's b1_parts.py, b1_geom.py;
Blender side: B1's b1_blender.run (shared, unchanged).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import b1_blender as B  # noqa: E402
import chapel_kit  # noqa: E402

VIEWDEF = {
    # name: (camera local (x, y, z), target local, lens mm) — x = south (right going in), z = west (out of the door), y up
    "street": ((2.0, 1.7, 26.0), (0.0, 8.0, -2.0), 22),
    "corner": ((15.0, 1.8, 19.0), (0.0, 7.5, -2.0), 22),
    "corner_n": ((-15.0, 1.8, 18.0), (0.0, 7.5, -2.0), 22),
    "back": ((10.0, 2.0, -20.0), (0.0, 6.0, -5.0), 22),
    "top": ((-22.0, 22.0, 24.0), (0.0, 6.0, -2.0), 24),
    "entrance": ((0.8, 1.6, 9.5), (0.0, 3.2, 4.0), 22),
    "portal": ((0.4, 1.55, 7.2), (0.0, 2.6, 4.8), 24),
    "rose": ((0.6, 1.7, 12.0), (0.0, 7.4, 5.3), 40),
    "spire": ((5.0, 2.0, 14.0), (0.0, 16.5, 4.4), 30),
    "fountain": ((5.2, 1.6, 2.8), (8.2, 0.6, -1.4), 24),
    "south": ((11.5, 1.6, 6.5), (4.0, 3.5, -1.0), 22),
    "rosearch": ((-8.2, 1.6, 3.6), (-8.2, 2.0, -2.0), 24),
    "north_bench": ((-8.2, 1.15, -3.2), (-8.0, 2.0, 3.0), 26),
    "window": ((6.6, 4.2, 0.6), (4.35, 4.3, 0.0), 30),
    "apse": ((5.5, 1.7, -11.0), (0.0, 4.0, -6.5), 24),
}

if __name__ == "__main__":
    B.run("lot_chapel", chapel_kit, VIEWDEF, "chapel", "chapel")
