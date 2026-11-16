"""2번 집 (하늘) - 아이 둘 가족의 집. 계단 B (뒷벽 왼쪽, 서 -> 동). 1층 주방 + 식탁(왼쪽) + 거실 겸 놀이방(오른쪽), 2층 아이 방 + 부부 침실.
Room-local coordinates (x 0..10.6 left -> right coming in, z 0..7.8 front -> back, yaw 0 = into the room, pi/2 = +x).

  blender -b --factory-startup -P art/village/tools/houses/h02.py        -> art/village/work/house_2_authoring.blend (+ house_2_cams.json)
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
import ha_common as HA  # noqa: E402

PAL = K.PAL
PI = math.pi
H = HC.House(2)
P = HA.prop_fn(H)

WALL1 = (0.97, 0.97, 0.95, 1)
WALL2 = (0.86, 0.93, 0.98, 1)       # sky blue (하늘 집) kids' floor
SKY = (0.62, 0.78, 0.9, 1)
BLUE = (0.45, 0.62, 0.8, 1)
YEL = (0.95, 0.8, 0.35, 1)
RED = (0.85, 0.42, 0.35, 1)
GRN = (0.55, 0.75, 0.5, 1)

# ================================================================================================ floor 1 ======
sp1 = HA.spec(skip=[("back", 10.6 - 3.04)])
ops = HA.ops_windows(sp1)
HA.merge(ops, dict(front=[dict(s0=4.4, s1=6.2, y0=0.0, y1=2.9)], right=[dict(s0=0.7, s1=1.6, y0=0.0, y1=2.13)]))
wins, curt = HA.add_windows(sp1, curtain=("right", "back"))
H.shell(1, ops=ops, wall_tn=WALL1, windows=wins, curtains=curt, floor_tn=(0.96, 0.95, 0.94, 1),
        lights=((2.4, 2.0), (2.6, 5.0), (5.3, 1.8), (8.2, 2.2), (8.6, 5.4)),
        fixtures=[lambda fr: SH.entry_door(fr["front"][0], 4.4, 6.2, 2.9),
                  lambda fr: SH.bath_door(fr["right"][0], 0.7, 1.6, 2.1)])
H.stairs()
H.piece(1, "shaft", FX.stair_shaft, 0, 0, 0, 0, hole=H.hole(), cols=False)
H.piece(1, "entry", FX.genkwan, 0, 0, 0, 0, x0=3.6, x1=7.0, depth=1.5, screen_x=6.9)
H.piece(1, "shoes", ST.shoe_cabinet, 7.75, 0.17, 0.0, 0.0, w=1.0)
H.piece(1, "mirror", DE.mirror_round, 3.9, 0.04, 1.5, 0.0, r=0.26, cols=False)

# kitchen (left front): double fridge in the corner, sink run under the window, gas range run on the left wall
H.piece(1, "fridge", KI.fridge_double, 0.56, 0.5, 0.0, 0.0)
H.piece(1, "sinkrun", KI.counter_base, 2.75, 0.31, 0, 0.0, length=3.0, d=0.6, sink=True, top="oak", door_tn=(0.78, 0.86, 0.92, 1))
H.piece(1, "gasrun", KI.counter_base, 0.31, 2.0, 0, PI / 2, length=2.2, d=0.6, cook="gas", top="oak", door_tn=(0.78, 0.86, 0.92, 1))
H.piece(1, "hood", KI.hood, 0.2, 2.0, 0, PI / 2)
H.piece(1, "upper", KI.upper_cabinets, 3.78, 0.17, 0, 0.0, length=0.95, door_tn=(0.78, 0.86, 0.92, 1))
H.piece(1, "upper", KI.upper_cabinets, 1.6, 0.17, 0, 0.0, length=0.9, door_tn=(0.78, 0.86, 0.92, 1))
P(1, "kettle", "kettle", 1.75, 0.3, 0.9)
P(1, "board", "cutting_board", 3.6, 0.3, 0.9, 0.2)
P(1, "mug", "mug_p", 3.2, 0.4, 0.9)
P(1, "pan", "pan", 0.3, 1.8, 0.9, PI / 2)
P(1, "plates", "plates_stack", 0.3, 2.6, 0.9)
P(1, "bowl", "bowl_p", 2.35, 0.45, 0.9)
# dining: long table, bench on the kitchen side (2), three chairs opposite, a high chair at the end
H.piece(1, "dtable", TA.table_dining_rect, 2.6, 3.3, 0, 0.0, w=2.0, d=0.9)
H.piece(1, "bench", SE.bench_dining, 2.6, 2.28, 0, 0.0, l=1.5)
for x in (1.9, 2.6, 3.3):
    H.piece(1, "dchair", SE.chair_dining_wood, x, 4.2, 0, PI)
H.piece(1, "highchair", FX.high_chair, 3.95, 3.35, 0, -PI / 2)
H.piece(1, "pendant", DE.pendant_bar, 2.6, 3.3, 2.7, 0.0, w=1.6, drop=1.0, n=3, cols=False)
P(1, "fruit", "fruit_bowl", 2.6, 3.3, 0.74)
P(1, "cup1", "mug_p", 1.9, 3.0, 0.74)
P(1, "cup2", "mug_p", 3.3, 3.6, 0.74)
P(1, "plate1", "plate", 2.2, 3.55, 0.74)
P(1, "plate2", "plate", 3.0, 3.05, 0.74)

# living / play room (right): L sofa faces the TV on the back wall, play mat with toys and baskets
H.piece(1, "sofa", SE.sofa_L, 8.0, 3.7, 0, 0.0, w=2.6, chaise=1.6, tn=PAL["sofa_sage"], pillow_tn=PAL["mustard"])
H.piece(1, "coffee", TA.table_coffee_rect, 7.5, 5.15, 0, 0.0, w=1.0, d=0.55)
H.piece(1, "mat", DE.rug_check, 8.9, 6.2, 0, 0.0, w=2.2, d=1.3, cols=False, a_tn=SKY, b_tn=YEL)
H.piece(1, "tvstand", TA.tv_stand, 9.3, 7.55, 0, PI, w=1.6)
H.piece(1, "tv", TA.tv_wall, 9.3, 7.78, 1.0, PI, w=1.3, cols=False)
H.piece(1, "toychest", ST.trunk, 10.3, 2.6, 0, -PI / 2, w=0.9, d=0.45, h=0.4)
for i, (x, z, tn_) in enumerate(((10.1, 1.75, RED), (9.5, 1.75, BLUE), (10.2, 5.5, GRN), (7.0, 6.9, YEL), (7.0, 6.35, SKY), (9.75, 4.9, RED))):
    H.piece(1, "basket", DE.basket, x, z, 0.0, 0.0, r=0.2, h=0.26, tn=tn_)
P(1, "ball", "toy_ball", 8.2, 6.0, 0.014)
P(1, "blocks", "toy_blocks", 9.3, 6.4, 0.014, 0.5)
P(1, "car", "toy_car", 8.6, 5.8, 0.014, 1.1)
P(1, "blocks", "toy_blocks", 7.7, 6.35, 0.014, 2.0)
P(1, "cmag", "magazine", 7.35, 5.1, 0.4, 0.3)
P(1, "cbook", "books3", 7.7, 5.2, 0.4, 0.8)
P(1, "tvf", "frame_small", 8.7, 7.6, 0.45, PI)
for i, x in enumerate((8.95, 9.5, 10.05)):
    H.piece(1, "kidart", DE.frame_art, x, 0.04, 1.5 + 0.06 * (i % 2), 0.0, w=0.4, h=0.5, art=i, cols=False)
H.piece(1, "plant", FX.plant_monstera_full, 6.65, 7.4)
H.piece(1, "lamp", DE.floor_lamp, 6.9, 3.2)
H.piece(1, "sofa_pic", DE.frame_art, 10.56, 6.0, 1.5, -PI / 2, w=0.6, h=0.45, art=3, cols=False)

# ================================================================================================ floor 2 ======
sp2 = HA.spec()
ops2 = HA.ops_windows(sp2)
HA.merge(ops2, dict(front=[dict(s0=5.9, s1=6.8, y0=0.0, y1=2.13)]))
wins2, curt2 = HA.add_windows(sp2, curtain=("left", "right"))
H.shell(2, ops=ops2, wall_tn=WALL2, windows=wins2, curtains=curt2, floor_tn=(0.96, 0.95, 0.94, 1),
        lights=((2.2, 2.2), (3.4, 4.6), (8.4, 2.0), (8.6, 5.2)),
        fixtures=[lambda fr: SH.bath_door(fr["front"][0], 5.9, 6.8, 2.1)])
# kids' room (left)
H.piece(2, "bunk", BE.bunk_bed, 1.2, 1.4, 0, PI / 2, tn=SKY)
H.piece(2, "desk", TA.kids_desk, 3.9, 0.3, 0, 0.0, w=1.0)
H.piece(2, "desk", TA.kids_desk, 5.0, 0.3, 0, 0.0, w=1.0)
H.piece(2, "dchair", SE.chair_desk, 3.9, 1.0, 0, PI)
H.piece(2, "dchair", SE.chair_desk, 5.0, 1.0, 0, PI)
H.piece(2, "toybox", DE.basket, 0.4, 5.5, 0.0, 0.0, r=0.28, h=0.4, tn=RED)
H.piece(2, "rug", DE.rug_round, 2.8, 3.7, 0, 0.0, d=2.0, cols=False, tn=PAL["rug_cream"])
H.piece(2, "bean", SE.bean_bag, 3.4, 5.0, 0, 0.0, tn=(0.9, 0.55, 0.45, 1))
H.piece(2, "plant", FX.plant_fern, 2.0, 6.0) if False else None
H.piece(2, "art", DE.frame_art, 0.04, 3.0, 1.55, PI / 2, w=0.6, h=0.8, art=1, cols=False)
H.piece(2, "lamp", DE.floor_lamp, 4.3, 5.2)
H.piece(2, "basket", DE.basket, 1.0, 3.0, 0.0, 0.0, r=0.22, h=0.28, tn=YEL)
H.piece(2, "basket", DE.basket, 4.2, 3.8, 0.0, 0.0, r=0.2, h=0.26, tn=BLUE)
P(2, "blocks", "toy_blocks", 3.0, 3.4, 0.014, 0.9)
P(2, "dbooks", "books3", 3.9, 0.35, 0.6, 0.2)
P(2, "dbooks", "books5", 5.1, 0.35, 0.6, 1.2)
P(2, "dframe", "frame_small", 4.45, 0.3, 0.6, 0.0)
# parents' room (right)
H.piece(2, "rug2", DE.rug_rect, 9.0, 2.0, 0, PI / 2, w=2.3, d=1.7, cols=False, tn=PAL["rug_cream"], border_tn=SKY, fringe=False)
H.piece(2, "bed", BE.bed, 9.45, 2.0, 0, -PI / 2, w=1.45, l=2.05, tn=(0.62, 0.74, 0.85, 1))
H.piece(2, "bedside", TA.bedside, 10.3, 0.85, 0, -PI / 2)
H.piece(2, "bedside", TA.bedside, 10.3, 3.15, 0, -PI / 2)
H.piece(2, "tlamp", DE.table_lamp, 10.3, 0.85, 0.55, 0.0, cols=False)
H.piece(2, "tlamp", DE.table_lamp, 10.3, 3.15, 0.55, 0.0, cols=False)
H.piece(2, "wardrobe", ST.wardrobe_builtin, 9.25, 7.52, 0, PI, w=2.3, bays=2)
H.piece(2, "bookcase", ST.bookcase, 9.5, 0.2, 0, 0.0, w=0.9, h=1.9, shelves=4)
H.piece(2, "mirror", DE.mirror_round, 7.9, 0.04, 1.45, 0.0, r=0.3, cols=False)
H.piece(2, "art", DE.frame_art, 10.56, 2.0, 1.75, -PI / 2, w=1.0, h=0.7, art=2, cols=False)
H.piece(2, "dresser", TA.tv_stand, 7.0, 7.55, 0, PI, w=1.2, d=0.42, h=0.85) if False else None
P(2, "nbook", "books3", 10.3, 3.15, 0.55, 0.4)
P(2, "ncup", "mug_p", 10.3, 0.85, 0.55, 0.0) if False else None

problems = H.finish()

CAMS = [
    dict(name="1f_entry", floor=1, eye=[5.3, 0.45, 1.3], look=[4.0, 5.5, 1.2], lens=16),
    dict(name="1f_kitchen", floor=1, eye=[5.2, 3.0, 1.3], look=[1.4, 1.0, 1.1], lens=16),
    dict(name="1f_living", floor=1, eye=[5.0, 1.5, 1.25], look=[9.4, 5.8, 0.9], lens=16),
    dict(name="1f_stair", floor=1, eye=[7.0, 5.0, 1.3], look=[2.0, 6.9, 1.5], lens=16),
    dict(name="2f_kids", floor=2, eye=[5.9, 3.4, 1.3], look=[1.0, 1.4, 0.9], lens=16),
    dict(name="2f_parents", floor=2, eye=[5.6, 5.2, 1.3], look=[10.0, 2.2, 0.9], lens=16),
    dict(name="2f_well", floor=2, eye=[8.0, 4.8, 1.3], look=[2.6, 7.0, 0.2], lens=16),
]
json.dump(CAMS, open(os.path.join(K.WORK, "house_2_cams.json"), "w"), indent=1)
H.save(os.path.join(K.WORK, "house_2_authoring.blend"))
