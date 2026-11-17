"""케이슨 마을 성당 안 (lot_chapel_nave) — the walk-in room GLB (Blender 5.3, background).

  blender -b --factory-startup -P docs/designs/village-lots-v2/tools/parts_lot_chapel_nave.py -- --layout <lots.json> \
      --png <decoded PBR pngs + the light-pool atlas> [--sacred-src <art/sacred/build of feat/lots2-sacred>] \
      [--out client/public/models/village/lots/lot_chapel_nave.glb] [--report <json>] [--renders <dir>] [--views entry,...] \
      [--times day,night] [--res 1280x800] [--samples 16] [--no-export]

`--layout` must carry `interiors` (LOT_INTERIORS). Geometry: chapel_room_kit.py on b2_room.py / b2_parts.py (and B1's
b1_parts.py, b1_geom.py); Blender side: b2_blender.run_room (on B1's b1_blender.py). The light-pool atlas comes from
b2_lightpools.mjs.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import b2_blender as B2  # noqa: E402
import chapel_room_kit  # noqa: E402

VIEWDEF = {
    # interior frame (x across from the left wall going in, z in from the door wall, y up)
    "entry": ((4.7, 1.62, 0.9), (4.7, 2.7, 12.5), 20),
    "aisle": ((4.1, 1.5, 3.2), (4.9, 2.9, 12.8), 24),
    "seat": ((2.55, 1.05, 4.15), (4.5, 2.4, 12.8), 22),
    "altar": ((4.7, 1.6, 9.0), (4.7, 2.6, 13.2), 26),
    "mary": ((2.3, 1.55, 8.3), (0.6, 1.85, 9.9), 30),
    "saint": ((7.1, 1.55, 8.3), (8.8, 1.85, 9.9), 30),
    "crucifix": ((4.7, 1.9, 10.3), (4.7, 3.4, 13.1), 30),
    "glass": ((6.9, 2.3, 4.3), (9.4, 4.3, 5.1), 24),
    "pools": ((7.4, 2.4, 3.0), (3.6, 0.0, 9.0), 22),
    "rose": ((4.7, 1.7, 9.6), (4.7, 6.0, 0.0), 22),
    "vault": ((4.7, 1.6, 2.6), (4.7, 8.9, 7.6), 18),
    "door": ((5.6, 1.6, 6.5), (6.3, 2.3, 0.0), 22),
}

if __name__ == "__main__":
    B2.run_room("lot_chapel_nave", chapel_room_kit, VIEWDEF, "chapel_nave", "chapel")
