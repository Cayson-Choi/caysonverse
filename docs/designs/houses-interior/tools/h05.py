"""5번 집 (민트) - 썬룸 식물 집. 계단 A (뒷벽 오른쪽). 1층 썬룸 거실 + 식탁, 2층 차실 + 작은 침실.
Room-local coordinates (x 0..10.6 left -> right coming in, z 0..7.8 front -> back, yaw 0 = into the room, pi/2 = +x).

  blender -b --factory-startup -P art/village/tools/houses/h05.py        -> art/village/work/house_5_authoring.blend (+ house_5_cams.json)
"""
import json
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
import kit_fix as FX  # noqa: E402
import ha_common as HA  # noqa: E402

PAL = K.PAL
PI = math.pi
H = HC.House(5)
P = HA.prop_fn(H)

MINT = (0.86, 0.95, 0.9, 1)
RED = (0.78, 0.35, 0.33, 1)
NAVY = (0.3, 0.38, 0.55, 1)
GOLD = (0.88, 0.7, 0.3, 1)
GRN = (0.45, 0.6, 0.45, 1)
CREAM = (0.95, 0.92, 0.8, 1)


def face_center(cx, cz, x, z):
    return math.atan2(cx - x, cz - z)


# ================================================================================================ floor 1 ======
# sunroom: two big front windows (wider, nearly to the ceiling), normal side windows, back-left window; the back-right one hides behind stair A
sp1 = dict(front=[(2.68, 2.4), (7.92, 2.4)], left=[(7.8 - 4.13, 1.5)], right=[(4.13, 1.5)], back=[(10.6 - 3.04, 1.5)])
ops = {w: [dict(s0=c - wd / 2, s1=c + wd / 2, y0=(0.5 if w == "front" else 0.95), y1=(3.0 if w == "front" else 2.4)) for (c, wd) in lst] for w, lst in sp1.items()}
HA.merge(ops, dict(front=[dict(s0=4.4, s1=6.2, y0=0.0, y1=2.9)]))
wins = []
for wall, lst in sp1.items():
    for (c, w) in lst:
        if wall == "front":
            wins.append((wall, c - w / 2, c + w / 2, 0.5, 3.0, dict(style="grid", cols=4, rows=3)))
        else:
            wins.append((wall, c - w / 2, c + w / 2, 0.95, 2.4, dict(style="grid", cols=3, rows=2)))
curt = [("left", 7.8 - 4.13 - 1.0, 7.8 - 4.13 + 1.0, 2.7, 0.04, dict(folds=9, tn=(0.97, 0.97, 0.94, 1))),
        ("right", 4.13 - 1.0, 4.13 + 1.0, 2.7, 0.04, dict(folds=9, tn=(0.97, 0.97, 0.94, 1)))]
H.shell(1, ops=ops, wall_tn=MINT, floor_kind="tile_grey", floor_tn=(1.0, 0.95, 0.85, 1), windows=wins, curtains=curt,
        lights=((2.6, 2.8), (2.6, 5.4), (8.0, 1.8), (8.0, 4.0), (5.3, 1.4)),
        fixtures=[lambda fr: SH.entry_door(fr["front"][0], 4.4, 6.2, 2.9)])
H.stairs()
H.piece(1, "shaft", FX.stair_shaft, 0, 0, 0, 0, hole=H.hole(), cols=False)
H.piece(1, "entry", FX.genkwan, 0, 0, 0, 0, x0=3.6, x1=7.0, depth=1.5, screen=False, tile="tile_grey")
H.piece(1, "tools", DE.basket, 6.7, 1.0, 0.0, 0.0, r=0.2, h=0.3, tn=(0.8, 0.65, 0.45, 1))
P(1, "tpot", "leaf_pot", 6.7, 1.0, 0.3)
H.piece(1, "hooks", FX.wall_hooks, 3.8, 0.01, 1.5, 0.0, n=3, spacing=0.2)

# living group (rattan): sofa faces the front windows, two chairs across a low table, jute rug
H.piece(1, "rug", DE.rug_round, 2.4, 3.9, 0, 0.0, d=2.8, cols=False, tn=(0.85, 0.74, 0.55, 1))
H.piece(1, "sofa", SE.sofa_rattan, 2.4, 4.75, 0, PI, w=1.7, d=0.85, seats=2)
H.piece(1, "coffee", TA.table_coffee_rect, 2.4, 3.55, 0, 0.0, w=1.0, d=0.55)
H.piece(1, "chair", SE.armchair_rattan, 0.95, 3.5, 0, PI / 2)
H.piece(1, "chair", SE.armchair_rattan, 3.75, 3.5, 0, -PI / 2)
P(1, "tmag", "magazine", 2.2, 3.55, 0.4, 0.3)
P(1, "tpot2", "leaf_pot", 2.7, 3.6, 0.4)
P(1, "tcup", "teacup", 2.5, 3.4, 0.4)
H.piece(1, "pill", DE.plant_orchid, 2.0, 3.5, 0.4, 0.0, cols=False)
# dining (right): round table, four cane chairs
dx, dz = 8.0, 2.8
H.piece(1, "dtable", TA.table_dining_round, dx, dz, 0, 0.0, d=1.1)
for k in range(4):
    a = k * PI / 2 + PI / 4
    x, z = dx + 0.85 * math.cos(a), dz + 0.85 * math.sin(a)
    H.piece(1, "dchair", SE.chair_rattan_dining, x, z, 0, face_center(dx, dz, x, z))
H.piece(1, "pend", DE.pendant_globe, dx, dz, 2.6, 0.0, drop=1.1, r=0.16, cols=False)
P(1, "fruit", "fruit_bowl", dx, dz, 0.74)
P(1, "dcup", "teacup", dx - 0.3, dz + 0.1, 0.74)
P(1, "dcup", "teacup", dx + 0.3, dz - 0.1, 0.74)
# plants: eight big ones, four hanging, window-sill pots, potting basket with soil-stained tools
H.piece(1, "monstera", FX.plant_monstera_full, 0.7, 0.6, leaves=30)
H.piece(1, "olive", FX.plant_olive_full, 3.9, 0.55)
H.piece(1, "rubber", FX.plant_rubber_full, 6.75, 0.6)
H.piece(1, "monstera", FX.plant_monstera_full, 9.8, 0.6, seed=9, leaves=28)
H.piece(1, "olive", FX.plant_olive_full, 0.6, 6.8, seed=11)
H.piece(1, "rubber", FX.plant_rubber_full, 4.4, 7.15, seed=3)
H.piece(1, "palm", FX.plant_palm, 9.0, 4.5)
H.piece(1, "monstera", FX.plant_monstera_full, 0.65, 5.3, seed=12)
for (x, z, s) in ((1.7, 0.45, 5), (3.4, 0.45, 6), (7.2, 0.45, 7), (8.7, 0.45, 8)):
    H.piece(1, "hang", DE.plant_hanging, x, z, 3.7, 0.0, seed=s, drop=0.9, cols=False)
for x in (1.4, 3.2, 7.1, 8.7):
    P(1, "sillpot", "leaf_pot", x, 0.14, 0.5)
H.piece(1, "stand", TA.table_coffee_round, 5.0, 7.45, 0, 0.0, d=0.45, h=0.6)
H.piece(1, "orchid", DE.plant_orchid, 5.0, 7.45, 0.6, 0.0, cols=False)
H.piece(1, "snake", DE.plant_snake, 7.2, 0.7) if False else None
H.piece(1, "art", DE.frame_art, 0.04, 6.3, 1.6, PI / 2, w=0.8, h=0.6, art=1, cols=False)
H.piece(1, "clock", DE.wall_clock, 10.56, 2.2, 1.9, -PI / 2, cols=False)

# ================================================================================================ floor 2 ======
sp2 = HA.spec(skip=[("back", 10.6 - 7.15)])
ops2 = HA.ops_windows(sp2, y0=0.8, y1=2.3)
HA.merge(ops2, dict(front=[dict(s0=4.4, s1=5.3, y0=0.0, y1=2.13)]))
wins2 = [(w, c - wd / 2, c + wd / 2, 0.8, 2.3, dict(style="ttisal")) for w, lst in sp2.items() for (c, wd) in lst]
H.shell(2, ops=ops2, wall_tn=(0.95, 0.93, 0.84, 1), floor_kind="maru", floor_tn=(0.95, 0.85, 0.72, 1), windows=wins2,
        lights=((3.2, 2.6), (3.2, 5.2), (8.0, 2.4), (7.8, 4.8)),
        fixtures=[lambda fr: SH.bath_door(fr["front"][0], 4.4, 5.3, 2.1)])
tx, tz = 3.2, 3.2
H.piece(2, "rug", DE.rug_rect, tx, tz, 0, 0.0, w=3.0, d=2.6, cols=False, tn=(0.82, 0.78, 0.65, 1), border_tn=(0.45, 0.4, 0.3, 1), fringe=False)
H.piece(2, "table", TA.table_low, tx, tz, 0, 0.0, w=1.4, d=0.8)
for (x, z, tn_) in ((tx - 0.45, tz - 0.85, RED), (tx + 0.45, tz - 0.85, NAVY), (tx - 0.45, tz + 0.85, GOLD), (tx + 0.45, tz + 0.85, GRN)):
    H.piece(2, "cushion", SE.bangseok, x, z, 0, face_center(tx, tz, x, z), tn=tn_)
H.piece(2, "tea", DE.tea_set, tx, tz, 0.35, 0.0, cols=False)
P(2, "tp", "teapot", tx + 0.4, tz + 0.1, 0.35)
P(2, "tc", "teacup", tx - 0.4, tz - 0.15, 0.35)
H.piece(2, "lantern", DE.hanji_lantern, tx, tz, 2.9, 0.0, drop=0.8, cols=False)
H.piece(2, "teacab", ST.mungap, 0.25, 5.7, 0, PI / 2, w=0.9)
H.piece(2, "orchid", DE.plant_orchid, 0.25, 5.5, 0.6, 0.0, cols=False)
H.piece(2, "teabox", DE.tea_set, 0.25, 5.95, 0.6, 0.0, cols=False)
H.piece(2, "scroll", ST.scroll_hanging, 0.04, 5.2, 0.9, PI / 2, cols=False)
H.piece(2, "scroll", ST.scroll_hanging, 0.04, 6.3, 0.9, PI / 2, cols=False)
for (c, wd) in sp2["front"] + [(7.8 - 4.13, 1.5)]:
    pass
H.piece(2, "bamboo", SH.blind_bamboo, 0, 0, 0, 0, cols=False, **{}) if False else None
H.piece(2, "bed", BE.bed_single, 9.5, 1.9, 0, -PI / 2, tn=(0.6, 0.78, 0.7, 1))
HA.drop_seat(H, 2, "bed", "min_lz")
H.piece(2, "bedside", TA.bedside, 10.3, 0.7, 0, -PI / 2)
H.piece(2, "tlamp", DE.table_lamp, 10.3, 0.7, 0.55, 0.0, cols=False)
H.piece(2, "plant", FX.plant_olive_full, 9.8, 5.3, seed=21)
H.piece(2, "plant2", FX.plant_monstera_full, 6.4, 0.6, seed=14)
H.piece(2, "boughs", DE.vase_branch, 8.0, 0.2, 0.0, 0.0, cols=False) if False else None
H.piece(2, "art", DE.frame_art, 10.56, 1.9, 1.7, -PI / 2, w=0.7, h=0.5, art=2, cols=False)
H.piece(2, "tealamp", DE.floor_lamp, 5.8, 5.4)

problems = H.finish()

CAMS = [
    dict(name="1f_entry", floor=1, eye=[5.3, 0.45, 1.3], look=[3.6, 5.5, 1.1], lens=16),
    dict(name="1f_living", floor=1, eye=[5.3, 2.6, 1.25], look=[1.2, 5.0, 0.8], lens=16),
    dict(name="1f_dining", floor=1, eye=[4.8, 5.8, 1.25], look=[8.8, 1.2, 0.9], lens=16),
    dict(name="1f_windows", floor=1, eye=[5.2, 6.0, 1.25], look=[3.4, 0.4, 1.4], lens=16),
    dict(name="2f_tea", floor=2, eye=[6.2, 5.6, 1.2], look=[2.4, 2.2, 0.7], lens=16),
    dict(name="2f_bed", floor=2, eye=[4.8, 4.0, 1.25], look=[10.0, 1.6, 0.9], lens=16),
    dict(name="2f_well", floor=2, eye=[2.4, 2.4, 1.3], look=[7.0, 7.0, 0.2], lens=16),
]
json.dump(CAMS, open(os.path.join(K.WORK, "house_5_cams.json"), "w"), indent=1)
H.save(os.path.join(K.WORK, "house_5_authoring.blend"))
