"""TEMPLATE of a house placement script (1번 집 sketch) - contract-compliant: every position is ROOM-LOCAL, colliders and seats go through
houses_contract.HouseBuild (via house_common.House), visible meshes sit under floor__h1_<F>. h01..h10 are built like this.

  blender -b --factory-startup -P art/village/tools/houses/h01_template.py          -> art/village/work/house_1_authoring.blend
  blender -b art/village/work/house_1_authoring.blend -P art/village/tools/houses/bake_house.py -- --house 1 --size 1024 --samples 64
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import house_common as HC  # noqa: E402
import kit_core as K  # noqa: E402
import kit_shell as SH  # noqa: E402
import kit_seating as SE  # noqa: E402
import kit_tables as TA  # noqa: E402
import kit_decor as DE  # noqa: E402
import kit_beds as BE  # noqa: E402
import kit_storage as ST  # noqa: E402

H = HC.House(1)
PI = math.pi

# ---------------------------------------------------------------- floor 1: living room + dining, stair A (back wall, right)
H.shell(1,
        ops={"front": [dict(s0=4.4, s1=6.2, y0=0.0, y1=2.9)], "left": [dict(s0=1.7, s1=4.7, y0=0.9, y1=2.5)]},
        windows=[("left", 1.7, 4.7, 0.9, 2.5, dict(style="grid", cols=3, rows=2))],
        curtains=[("left", 1.45, 4.95, 2.7, 0.04, dict(folds=10))],
        fixtures=[lambda fr: SH.entry_door(fr["front"][0], 4.4, 6.2, 2.9)])
H.stairs()
H.piece(1, "sofa", SE.sofa_fabric, 3.4, 5.2, 0, PI, w=2.4)
H.piece(1, "coffee", TA.table_coffee_round, 3.4, 3.7)
H.piece(1, "rug", DE.rug_rect, 3.4, 4.0, w=2.4, d=1.7, cols=False)
H.piece(1, "armchair", SE.armchair_lounge, 6.9, 4.1, 0, -PI / 2)
H.piece(1, "lamp", DE.floor_lamp, 1.2, 6.6)
H.piece(1, "tvstand", TA.tv_stand, 0.25, 6.0, 0, PI / 2)
H.piece(1, "plant", DE.plant_monstera, 0.6, 0.7)
H.piece(1, "table", TA.table_dining_rect, 8.6, 1.6, 0, 0.0, w=1.5, d=0.85)
for i, (x, z, yw) in enumerate(((8.0, 0.8, 0.0), (9.2, 0.8, 0.0), (8.0, 2.4, PI), (9.2, 2.4, PI))):
    H.piece(1, "dchair", SE.chair_dining_wood, x, z, 0, yw)

# ---------------------------------------------------------------- floor 2: bedroom (the stairwell hole + guard from H.stairs())
H.shell(2, ops={"back": [dict(s0=2.5, s1=5.5, y0=0.9, y1=2.5)]}, windows=[("back", 2.5, 5.5, 0.9, 2.5, dict(style="grid", cols=3, rows=2))])
H.piece(2, "bed", BE.bed_queen, 1.2, 3.6, 0, PI / 2)
H.piece(2, "bedside", TA.bedside, 0.35, 2.3, 0, PI / 2)

problems = H.finish()
H.save(os.path.join(K.WORK, "house_1_authoring.blend"))
