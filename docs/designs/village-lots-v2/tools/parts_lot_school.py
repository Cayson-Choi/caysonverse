"""케이슨 마을 학교 (lot_school) — build the kit into its own GLB, check it, render it (Blender 5.3, background).

  blender -b --factory-startup -P docs/designs/village-lots-v2/tools/parts_lot_school.py -- --layout <lots.json> \
      --png <decoded PBR pngs> [--out client/public/models/village/lots/lot_school.glb] [--report <json>] \
      [--renders <dir>] [--views street,...] [--times day,night] [--res 1280x800] [--samples 16] [--no-export]

`--layout`: `lotsForLayoutJson()` + `LOT_ROOF_SLABS` as JSON (npx tsx); `--png`: the library's KTX2 sets decoded to PNG
(ktx2png.cjs) so the renders use exactly the game's textures. Geometry: school_kit.py on b1_parts.py / b1_geom.py.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import b1_blender as B  # noqa: E402
import school_kit  # noqa: E402

VIEWDEF = {
    # name: (camera local (x, y, z), target local, lens mm) — x right of the entrance, z out of the front (west), y up
    "street": ((1.5, 1.7, 24.0), (0.0, 6.5, -4.0), 24),
    "corner": ((-17.0, 2.0, 17.0), (0.0, 6.0, -4.0), 22),
    "corner_r": ((17.0, 2.0, 16.0), (0.0, 6.0, -4.0), 22),
    "back": ((12.0, 2.0, -23.0), (0.0, 6.0, -6.0), 22),
    "top": ((-24.0, 20.0, 24.0), (0.0, 4.0, -1.0), 24),
    "yard": ((7.5, 1.6, 8.5), (-2.0, 4.0, -3.0), 20),
    "gate": ((0.6, 1.6, 15.0), (0.0, 2.2, 8.0), 26),
    "entrance": ((0.6, 1.6, 4.5), (0.0, 2.6, -2.0), 22),
    "door": ((0.4, 1.5, 0.9), (0.0, 1.7, -2.3), 22),
    "porch_up": ((0.3, 1.5, 0.2), (0.0, 3.6, -1.2), 18),
    "clock": ((2.0, 3.0, 7.0), (0.0, 10.0, -3.0), 40),
    "cupola": ((5.0, 9.0, 6.0), (0.0, 14.0, -6.0), 45),
    "playground": ((-2.5, 1.6, 7.5), (-9.0, 1.0, 5.0), 22),
    "swing": ((-7.0, 1.4, 6.6), (-8.2, 1.0, 3.2), 26),
    "tower": ((-6.6, 1.5, 9.4), (-9.5, 1.3, 7.6), 24),
    "seesaw": ((8.0, 1.4, 5.8), (8.1, 0.6, 2.9), 28),
    "sandpit": ((5.4, 1.5, 9.6), (5.4, 0.2, 6.5), 26),
    "bench": ((-5.0, 1.2, 0.6), (-5.0, 0.6, -1.8), 26),
    "window": ((3.3, 1.7, -0.3), (3.3, 2.0, -2.1), 26),
    "notice": ((-3.8, 1.5, 11.6), (-3.8, 1.4, 9.35), 30),
}

if __name__ == "__main__":
    B.run("lot_school", school_kit, VIEWDEF, "school", "school")
