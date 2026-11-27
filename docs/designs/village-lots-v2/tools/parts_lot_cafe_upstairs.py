"""케이슨 카페 2층 살롱 (lot_cafe_upstairs) — the walk-in room GLB (Blender 5.3, background).

  blender -b --factory-startup -t 4 -P docs/designs/village-lots-v2/tools/parts_lot_cafe_upstairs.py -- --layout <cafe_layout.json>       --png <decoded PBR pngs + the café atlas> [--lightmap <dir>] [--lm-size 2048] [--phone] [--renders <dir>] [--views ...]

`--layout`: cafe_layout.mjs (CAFE_LOT + LOT_INTERIORS). Geometry: cafe_room_kit.py / cafe_parts.py on b1_room.py; Blender side: b1_blender.run_room.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import b1_blender as B  # noqa: E402
import cafe_room_kit  # noqa: E402

VIEWDEF = {
    "stairtop": ((2.4, 1.6, 2.2), (9.0, 1.2, 9.0), 20),
    "front": ((7.0, 1.6, 9.5), (7.0, 1.4, 0.0), 20),
    "sofa": ((7.5, 1.5, 4.8), (13.4, 0.8, 5.0), 22),
    "sideboard": ((6.3, 1.5, 9.8), (6.3, 1.0, 13.0), 26),
    "well": ((3.0, 1.6, 3.0), (1.0, -1.5, 6.0), 22),
}

if __name__ == "__main__":
    B.run_room("lot_cafe_upstairs", cafe_room_kit, VIEWDEF, "cafe_up", "cafe")
