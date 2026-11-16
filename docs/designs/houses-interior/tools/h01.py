"""1번 집 (분홍) - 젊은 부부의 모던 집. 계단 A. 1층 거실 + 오픈 주방, 2층 부부 침실 + 서재 코너.
All positions ROOM-LOCAL (x 0..10.6 left -> right coming in, z 0..7.8 front -> back wall, yaw 0 = into the room, pi/2 = toward +x).

  blender -b --factory-startup -P art/village/tools/houses/h01.py        -> art/village/work/house_1_authoring.blend (+ house_1_cams.json)
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
import kit_kitchen as KI  # noqa: E402
import kit_fix as FX  # noqa: E402

PAL = K.PAL
PI = math.pi
H = HC.House(1)

WALL1 = (0.96, 0.955, 0.95, 1)          # cool white-greige
FLOOR_TN = (0.97, 0.96, 0.95, 1)
WALL2 = (0.97, 0.90, 0.88, 1)           # blush (분홍 집)

# window openings (exteriorToLocal of the outside windows; the right-back one hides behind stair A and is left out)
# wall frames: front s = x, right s = z, back s = 10.6 - x, left s = 7.8 - z
GW0, GW1 = 0.95, 2.40       # sill / head of the 1F windows
W1 = dict(front=[(2.68, 1.5), (7.92, 1.5)], left=[(7.8 - 4.13, 1.5)], right=[(4.13, 1.5)], back=[(10.6 - 3.04, 1.5)])


def ops_windows(spec, y0=GW0, y1=GW1):
    out = {}
    for wall, lst in spec.items():
        out[wall] = [dict(s0=c - w / 2, s1=c + w / 2, y0=y0, y1=y1) for (c, w) in lst]
    return out


def add_windows(spec, y0=GW0, y1=GW1, style="grid", cols=3, rows=2, curtain=()):
    wins, curt = [], []
    for wall, lst in spec.items():
        for (c, w) in lst:
            wins.append((wall, c - w / 2, c + w / 2, y0, y1, dict(style=style, cols=cols, rows=rows)))
            if wall in curtain:
                curt.append((wall, c - w / 2 - 0.3, c + w / 2 + 0.3, y1 + 0.3, 0.04, dict(folds=10)))
    return wins, curt


# ================================================================================================ floor 1 ======
ops = ops_windows(W1)
ops["front"].append(dict(s0=4.4, s1=6.2, y0=0.0, y1=2.9))                 # entry door
ops["left"].append(dict(s0=7.8 - 1.55, s1=7.8 - 0.65, y0=0.0, y1=2.13))   # bathroom door (left wall, front)
ops["left"].sort(key=lambda o: o["s0"])
ops["front"].sort(key=lambda o: o["s0"])
wins, curt = add_windows(W1, curtain=("left", "back"))
H.shell(1, ops=ops, wall_tn=WALL1, floor_tn=FLOOR_TN, windows=wins, curtains=curt,
        lights=((2.6, 2.6), (2.6, 5.4), (5.3, 1.6), (8.3, 1.8), (8.3, 3.8)),
        fixtures=[lambda fr: SH.entry_door(fr["front"][1] if False else fr["front"][0], 4.4, 6.2, 2.9),
                  lambda fr: SH.bath_door(fr["left"][0], 7.8 - 1.55, 7.8 - 0.65, 2.1)])
H.stairs()
H.piece(1, "shaft", FX.stair_shaft, 0, 0, 0, 0, hole=H.hole(), cols=False)
H.piece(1, "entry", FX.genkwan, 0, 0, 0, 0, x0=3.6, x1=7.0, depth=1.5, screen_x=6.9)    # tile + 귀틀 + glass screen
H.piece(1, "shoes", ST.shoe_cabinet, 3.9, 0.17, 0.0, 0.0, w=0.8)

# living (left): sofa faces the TV wall (back wall), armchair across the coffee table
H.piece(1, "rug", DE.rug_rect, 2.5, 5.0, 0, 0.0, w=2.6, d=1.8, cols=False, tn=PAL["rug_cream"], border_tn=PAL["rug_grey"], fringe=False)
H.piece(1, "sofa", SE.sofa_fabric, 2.7, 2.95, 0, 0.0, w=2.4, tn=PAL["sofa_grey"], pillow_tn=PAL["mustard"])
H.piece(1, "coffee", TA.table_coffee_round, 2.5, 5.3, 0, 0.0)
H.piece(1, "armchair", SE.armchair_lounge, 0.7, 4.6, 0, PI / 2 + 0.25)
H.piece(1, "lamp", DE.floor_lamp, 0.75, 2.5)
H.piece(1, "tvstand", TA.tv_stand, 1.35, 7.55, 0, PI, w=1.55)
H.piece(1, "tv", TA.tv_wall, 1.35, 7.78, 1.0, PI, w=1.3, cols=False)
H.piece(1, "plant", FX.plant_monstera_full, 0.5, 6.5)
H.piece(1, "plant2", FX.plant_rubber_full, 4.35, 7.45)
H.piece(1, "art", DE.frame_art, 0.04, 6.0, 1.45, PI / 2, w=0.7, h=0.5, art=1, cols=False)
H.piece(1, "art2", DE.frame_art, 5.3, 0.04, 1.75, 0.0, w=0.55, h=0.7, art=2, cols=False)     # beside the entry door? (above the door frame at 2.9 is too high) -> left of it

# kitchen (right): sink under the front window, cooktop run on the right wall, fridge in the corner, dining table
H.piece(1, "sinkrun", KI.counter_base, 8.4, 0.31, 0, 0.0, length=2.6, d=0.6, sink=True, top="stone")
H.piece(1, "cookrun", KI.counter_base, 10.28, 2.1, 0, -PI / 2, length=2.6, d=0.6, cook="induction", top="stone")
H.piece(1, "fridge", KI.fridge, 10.2, 0.4, 0, -PI / 2, w=0.7)
H.piece(1, "hood", KI.hood, 10.35, 2.1, 0, -PI / 2)
H.piece(1, "dtable", TA.table_dining_rect, 7.7, 3.3, 0, 0.0, w=1.5, d=0.85)
for i, (x, z, yw) in enumerate(((7.25, 2.35, 0.0), (8.15, 2.35, 0.0), (7.25, 4.25, PI), (8.15, 4.25, PI))):
    H.piece(1, "dchair", SE.chair_dining_upholstered, x, z, 0, yw)
H.piece(1, "pendant", DE.pendant_bar, 7.7, 3.3, 2.7, 0.0, w=1.2, drop=1.0, n=2, cols=False)


# small things (kit props): lived-in
def P(floor, name, prop, x, z, y, yaw=0.0, **kw):
    H.piece(floor, name, FX.prop, x, z, y, yaw, cols=False, which=prop, **kw)


P(1, "mag", "magazine", 2.35, 5.25, 0.385, 0.4)
P(1, "cvase", "vase_small", 2.65, 5.4, 0.385)
P(1, "cbooks", "books3", 2.2, 5.4, 0.385, 0.3)
P(1, "tvvase", "vase_small", 0.75, 7.55, 0.45)
P(1, "tvframe", "frame_small", 2.05, 7.55, 0.45, PI)
P(1, "tvbooks", "books5", 1.6, 7.6, 0.45, PI)
P(1, "fruit", "fruit_bowl", 7.7, 3.3, 0.74)
P(1, "candle", "candle", 7.25, 3.3, 0.74)
P(1, "candle", "candle", 8.15, 3.3, 0.74)
P(1, "kettle", "kettle", 9.35, 0.3, 0.9)
P(1, "board", "cutting_board", 7.5, 0.3, 0.9)
P(1, "mugk", "mug_p", 8.95, 0.35, 0.9)
P(1, "pan", "pan", 10.25, 2.1, 0.9, -PI / 2)
P(1, "board", "cutting_board", 10.3, 1.35, 0.9, -PI / 2)
P(1, "plates", "plates_stack", 10.3, 2.95, 0.9)
P(1, "kcup", "teacup", 7.95, 0.4, 0.9)
P(1, "boots", "boots_pair", 6.55, 0.55, 0.0, 0.3) if False else None
H.piece(1, "cushion", DE.basket, 3.6, 1.0, 0.0, 0.0, r=0.22, h=0.3, cols=False) if False else None

# ================================================================================================ floor 2 ======
W2 = dict(front=[(2.68, 1.5), (7.92, 1.5)], left=[(7.8 - 4.13, 1.5)], right=[(4.13, 1.5)], back=[(10.6 - 3.04, 1.5)])
ops2 = ops_windows(W2)
ops2["front"].append(dict(s0=4.2, s1=5.1, y0=0.0, y1=2.13))              # bathroom door
ops2["front"].sort(key=lambda o: o["s0"])
wins2, curt2 = add_windows(W2, curtain=("left", "right", "back", "front"))
H.shell(2, ops=ops2, wall_tn=WALL2, floor_tn=FLOOR_TN, windows=wins2, curtains=curt2, floor_kind="oak",
        lights=((2.4, 3.2), (8.2, 2.4), (8.2, 5.0)),
        fixtures=[lambda fr: SH.bath_door(fr["front"][0], 4.2, 5.1, 2.1)])
H.piece(2, "rug", DE.rug_rect, 2.2, 2.3, 0, PI / 2, w=2.2, d=1.6, cols=False, tn=PAL["rug_cream"], border_tn=PAL["blush"], fringe=False)
H.piece(2, "bed", BE.bed_queen, 1.1, 2.3, 0, PI / 2, tn=PAL["blush"])
H.piece(2, "bedside", TA.bedside, 0.28, 0.85, 0, PI / 2)
H.piece(2, "bedside", TA.bedside, 0.28, 3.45, 0, PI / 2)
H.piece(2, "lamp", DE.table_lamp, 0.28, 0.85, 0.55, 0.0, cols=False)
H.piece(2, "lamp", DE.table_lamp, 0.28, 3.45, 0.55, 0.0, cols=False)
H.piece(2, "wardrobe", ST.wardrobe_builtin, 1.2, 7.5, 0, PI, w=2.1, bays=2)
H.piece(2, "dressing", TA.dressing_table, 9.4, 0.3, 0, 0.0)
H.piece(2, "stool", SE.ottoman, 9.4, 1.1, 0, PI, w=0.5, d=0.42)
H.piece(2, "bookcase", ST.bookcase, 6.2, 0.2, 0, 0.0, w=1.0, h=1.9, shelves=4)
H.piece(2, "desk", TA.desk, 10.2, 4.15, 0, -PI / 2, w=1.4)
H.piece(2, "deskchair", SE.chair_desk, 9.35, 4.15, 0, PI / 2)
H.piece(2, "rug2", DE.rug_round, 7.4, 3.0, 0, 0.0, d=1.8, cols=False, tn=PAL["sage"])
H.piece(2, "plant", FX.plant_olive_full, 6.0, 5.6)
H.piece(2, "lamp2", DE.floor_lamp, 9.9, 5.4)

H.piece(1, "mirror", DE.mirror_round, 3.9, 0.04, 1.55, 0.0, r=0.28, cols=False)
H.piece(1, "clock", DE.wall_clock, 10.56, 3.0, 1.9, -PI / 2, cols=False)
H.piece(2, "art", DE.frame_art, 0.04, 2.3, 1.7, PI / 2, w=1.0, h=0.7, art=2, cols=False)
H.piece(2, "mirror", DE.mirror_round, 7.4, 0.04, 1.4, 0.0, r=0.35, cols=False)
H.piece(2, "basket", DE.basket, 2.8, 7.4, 0.0, 0.0, r=0.25, h=0.45)
H.piece(2, "plant2", FX.plant_monstera_full, 5.9, 0.5)
H.piece(2, "console", TA.tv_stand, 8.0, 7.55, 0, PI, w=1.4, d=0.35, h=0.8)
P(2, "nbooks", "books3", 0.28, 0.85, 0.55, 0.5)
P(2, "ncandle", "candle", 0.3, 3.5, 0.55)
P(2, "dbooks", "books5", 10.25, 3.6, 0.74, PI)
P(2, "dmug", "mug_p", 10.2, 4.7, 0.74)
P(2, "dframe", "frame_small", 10.4, 3.9, 0.74, -PI / 2)
P(2, "dmag", "magazine", 10.0, 4.3, 0.74, 0.5)
H.piece(2, "dlamp", DE.table_lamp, 10.3, 3.45, 0.74, 0.0, cols=False)

H.piece(1, "view", FX.view_band, 0, 0, 0, 0, cols=False, seats=False, house=1)
H.piece(2, "view", FX.view_band, 0, 0, 0, 0, cols=False, seats=False, house=1)

problems = H.finish()

CAMS = [
    dict(name="1f_entry", floor=1, eye=[5.3, 0.45, 1.3], look=[4.6, 5.5, 1.2], lens=16),
    dict(name="1f_living", floor=1, eye=[5.7, 2.3, 1.25], look=[1.2, 5.6, 1.0], lens=16),
    dict(name="1f_kitchen", floor=1, eye=[5.9, 5.0, 1.3], look=[9.6, 1.3, 1.0], lens=16),
    dict(name="1f_stair", floor=1, eye=[4.7, 1.9, 1.3], look=[8.6, 6.8, 2.0], lens=16),
    dict(name="2f_bed", floor=2, eye=[7.3, 3.5, 1.3], look=[0.4, 1.9, 0.9], lens=16),
    dict(name="2f_study", floor=2, eye=[4.5, 1.2, 1.3], look=[10.0, 4.3, 1.0], lens=16),
    dict(name="2f_well", floor=2, eye=[2.6, 2.6, 1.3], look=[7.8, 7.0, 0.2], lens=16),
]
json.dump(CAMS, open(os.path.join(K.WORK, "house_1_cams.json"), "w"), indent=1)
H.save(os.path.join(K.WORK, "house_1_authoring.blend"))
