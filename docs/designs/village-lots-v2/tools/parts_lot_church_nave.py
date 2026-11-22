"""케이슨 마을 교회 예배당 (lot_church_nave) — the walk-in room GLB (Blender 5.3, background).

  blender -b --factory-startup -P docs/designs/village-lots-v2/tools/parts_lot_church_nave.py -- --layout <lots.json> \
      --png <decoded PBR pngs + the light-pool map> [--sacred-src <art/sacred/build>] [--phone] [--out <glb>] [--report <json>] \
      [--renders <dir>] [--views entry,...] [--times day,night] [--res 1280x800] [--samples 16] [--no-export]

Geometry: church_room_kit.py on b2_room.py / b2_parts.py (and B1's b1_parts.py, b1_geom.py); Blender side: b2_blender.run_room.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import b2_blender as B2  # noqa: E402
import church_room_kit  # noqa: E402

VIEWDEF = {
    "entry": ((3.9, 1.62, 0.8), (3.9, 2.4, 10.4), 20),
    "seat": ((2.15, 1.05, 3.9), (3.9, 2.0, 10.4), 22),
    "chancel": ((3.9, 1.6, 6.9), (3.9, 2.6, 10.4), 24),
    "cross": ((3.9, 1.7, 8.2), (3.9, 3.4, 10.4), 30),
    "pulpit": ((2.9, 1.6, 7.0), (1.2, 1.8, 9.1), 26),
    "window": ((5.2, 1.7, 4.6), (7.8, 3.0, 5.7), 24),
    "ceiling": ((3.9, 1.6, 1.2), (3.9, 6.8, 7.0), 18),
    "door": ((4.6, 1.6, 7.6), (3.9, 2.0, 0.0), 22),
    "hymn": ((3.6, 1.55, 7.075), (0.0, 1.45, 7.075), 22),
    "hymn_pew": ((2.0, 1.2, 4.2), (0.0, 1.45, 7.075), 34),
    "organ": ((5.0, 1.6, 6.2), (7.3, 1.6, 8.0), 26),
}

if __name__ == "__main__":
    B2.run_room("lot_church_nave", church_room_kit, VIEWDEF, "church_nave", "church")
