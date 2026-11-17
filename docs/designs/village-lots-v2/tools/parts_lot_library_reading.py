"""케이슨 마을 도서관 열람실 (lot_library_reading) — the walk-in room GLB (Blender 5.3, background).

  blender -b --factory-startup -P docs/designs/village-lots-v2/tools/parts_lot_library_reading.py -- --layout <lots.json> \
      --png <decoded PBR pngs> [--out client/public/models/village/lots/lot_library_reading.glb] [--report <json>] \
      [--renders <dir>] [--views entry,...] [--times day,night] [--res 1280x800] [--samples 16] [--no-export]

`--layout` must carry `interiors` (LOT_INTERIORS). Geometry: library_room_kit.py on b1_room.py; Blender side: b1_blender.run_room.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import b1_blender as B  # noqa: E402
import library_room_kit  # noqa: E402

VIEWDEF = {
    # interior frame (x across from the left wall, z in from the door wall, y up)
    "entry": ((6.7, 1.6, 1.0), (6.7, 1.6, 9.0), 18),
    "fireplace": ((6.7, 1.6, 5.5), (6.7, 1.6, 10.4), 22),
    "stacks_w": ((7.5, 1.7, 3.0), (0.0, 2.0, 7.0), 20),
    "nook": ((2.6, 1.4, 3.2), (2.6, 0.9, -0.6), 24),
    "nook_seat": ((2.4, 1.05, 0.45), (6.0, 1.2, 6.0), 22),
    "tables": ((11.0, 2.2, 2.8), (6.5, 0.8, 6.0), 22),
    "seat": ((3.27, 1.05, 4.9), (9.0, 1.2, 5.5), 22),
    "ladder": ((9.0, 1.6, 5.0), (13.0, 1.8, 7.5), 22),
    "desk": ((8.0, 1.5, 4.0), (11.0, 0.9, 1.8), 24),
    "up": ((6.7, 1.4, 2.0), (6.7, 4.5, 7.0), 16),
}

if __name__ == "__main__":
    B.run_room("lot_library_reading", library_room_kit, VIEWDEF, "library_reading", "library")
