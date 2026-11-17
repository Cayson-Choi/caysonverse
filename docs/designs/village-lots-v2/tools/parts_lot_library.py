"""케이슨 마을 도서관 (lot_library) — build the kit into its own GLB, check it, render it (Blender 5.3, background).

  blender -b --factory-startup -P docs/designs/village-lots-v2/tools/parts_lot_library.py -- --layout <lots.json> \
      --png <decoded PBR pngs> [--out client/public/models/village/lots/lot_library.glb] [--report <json>] \
      [--renders <dir>] [--views street,...] [--times day,night] [--res 1280x800] [--samples 16] [--no-export]

Geometry: library_kit.py on b1_parts.py / b1_geom.py; Blender side, checks and export: b1_blender.py.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import b1_blender as B  # noqa: E402
import library_kit  # noqa: E402

VIEWDEF = {
    # name: (camera local (x, y, z), target local, lens mm) — x right of the entrance (north), z out of the front (east), y up
    "street": ((-2.0, 1.7, 22.0), (-3.0, 4.5, 0.0), 24),
    "corner": ((-20.0, 2.0, 16.0), (-3.0, 4.0, -1.0), 22),
    "corner_r": ((18.0, 2.0, 15.0), (-1.0, 4.0, -2.0), 22),
    "garden": ((16.0, 1.7, -2.0), (4.0, 3.0, -2.0), 24),
    "back": ((8.0, 2.0, -24.0), (-3.0, 4.0, -3.0), 22),
    "top": ((20.0, 18.0, 22.0), (-2.0, 3.0, -1.0), 24),
    "entrance": ((-2.6, 1.6, 8.5), (-3.0, 3.0, 3.4), 24),
    "door": ((-2.7, 1.5, 5.6), (-3.0, 1.8, 3.2), 24),
    "frieze": ((-3.0, 2.2, 6.5), (-3.0, 4.4, 3.5), 34),
    "nook_l": ((-7.0, 1.4, 6.0), (-7.1, 0.9, 3.6), 26),
    "nook_r": ((1.2, 1.5, 5.9), (1.1, 0.9, 3.6), 26),
    "nook_close": ((-6.6, 1.25, 5.0), (-7.2, 0.7, 3.4), 24),
    "pergola": ((8.0, 1.6, 6.5), (6.5, 2.3, -2.0), 22),
    "pergola_in": ((5.4, 1.6, 2.6), (7.5, 2.4, -4.5), 20),
    "bench": ((7.0, 1.2, 3.0), (7.0, 0.6, 1.4), 26),
    "arch_win": ((7.0, 1.7, 1.2), (3.9, 2.8, 1.0), 26),
    "book_return": ((-8.6, 1.4, 6.8), (-9.2, 0.8, 5.05), 28),
    "lamp": ((-4.5, 1.6, 8.6), (-5.5, 2.4, 6.75), 28),
    "cupola": ((3.0, 7.0, 9.0), (-3.0, 10.4, -2.0), 40),
}

if __name__ == "__main__":
    B.run("lot_library", library_kit, VIEWDEF, "library", "library")
