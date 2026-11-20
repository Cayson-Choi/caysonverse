"""케이슨 카페 홀 (lot_cafe_room) — the walk-in room GLB (Blender 5.3, background).

  blender -b --factory-startup -t 4 -P docs/designs/village-lots-v2/tools/parts_lot_cafe_room.py -- --layout <cafe_layout.json>       --png <decoded PBR pngs + the café atlas> [--lightmap <dir>] [--lm-size 2048] [--phone] [--renders <dir>] [--views ...]

`--layout`: cafe_layout.mjs (CAFE_LOT + LOT_INTERIORS). Geometry: cafe_room_kit.py / cafe_parts.py on b1_room.py; Blender side: b1_blender.run_room.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import b1_blender as B  # noqa: E402
import cafe_room_kit  # noqa: E402

VIEWDEF = {
    # room frame (x across from the left wall coming in, z in from the door wall, y up)
    "door": ((6.8, 1.6, 0.6), (8.0, 1.3, 7.0), 20),
    "counter": ((8.6, 1.45, 3.9), (8.6, 1.2, 6.5), 26),
    "machine": ((9.5, 1.35, 6.3), (9.5, 1.25, 7.5), 30),
    "case": ((8.2, 1.4, 4.75), (8.2, 1.2, 5.8), 32),
    "sign": ((9.2, 2.2, 3.0), (9.2, 3.4, 7.8), 26),
    "tables": ((12.6, 1.6, 4.5), (3.5, 1.0, 2.0), 20),
    "banquette": ((10.2, 1.4, 1.2), (13.4, 0.8, 2.6), 22),
    "stair": ((5.2, 1.6, 2.0), (1.0, 2.2, 6.0), 20),
}

if __name__ == "__main__":
    B.run_room("lot_cafe_room", cafe_room_kit, VIEWDEF, "cafe_room", "cafe")
