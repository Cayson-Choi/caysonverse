"""케이슨 마을 학교 교실 + 복도 (lot_school_class) — the walk-in room GLB (Blender 5.3, background).

  blender -b --factory-startup -P docs/designs/village-lots-v2/tools/parts_lot_school_class.py -- --layout <lots.json> \
      --png <decoded PBR pngs> [--out client/public/models/village/lots/lot_school_class.glb] [--report <json>] \
      [--renders <dir>] [--views entry,...] [--times day,night] [--res 1280x800] [--samples 16] [--no-export]

`--layout` must carry `interiors` (LOT_INTERIORS). Geometry: school_room_kit.py on b1_room.py; Blender side: b1_blender.run_room.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import b1_blender as B  # noqa: E402
import school_room_kit  # noqa: E402

VIEWDEF = {
    # interior frame (x across from the left wall, z in from the door wall, y up)
    "entry": ((7.7, 1.6, 0.9), (6.0, 1.4, 6.0), 18),
    "board": ((11.0, 1.55, 5.0), (0.0, 1.5, 5.0), 22),
    "windows": ((3.0, 1.6, 3.0), (11.0, 1.8, 7.4), 18),
    "seat": ((4.15, 1.05, 3.6), (0.0, 1.4, 5.0), 24),
    "corridor": ((14.6, 1.6, 1.4), (2.0, 1.4, 0.6), 20),
    "desk": ((3.2, 1.5, 6.6), (1.6, 0.9, 5.2), 26),
    "aquarium": ((7.3, 1.35, 5.9), (7.3, 1.1, 7.2), 28),
    "art": ((9.0, 1.7, 5.0), (12.6, 2.0, 7.4), 24),
}

if __name__ == "__main__":
    B.run_room("lot_school_class", school_room_kit, VIEWDEF, "school_class", "school")
