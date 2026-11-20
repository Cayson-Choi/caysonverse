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
import kit_real as KR  # noqa: E402

PAL = K.PAL
PI = math.pi
H = HC.House(2)
H.sill_n = 0           # layered pass 2: flower jugs on sills (triangle budget)
H.pull_body = 0.53        # a 1.06 m aisle between the table and its row of chairs: the middle chair is reached from in front
FX.set_house(2)
P = HA.prop_fn(H)

WALL1 = (0.86, 0.92, 0.97, 1)       # cottage pass: sky-blue limewash (the sky house)
WALL2 = (0.9, 0.94, 0.97, 1)        # paler sky upstairs
SKY = (0.62, 0.78, 0.9, 1)
BLUE = (0.45, 0.62, 0.8, 1)
YEL = (0.95, 0.8, 0.35, 1)
RED = (0.85, 0.42, 0.35, 1)
GRN = (0.55, 0.75, 0.5, 1)

def SOFA4(F, **kw):
    """(seat-front pass) a straight four-seat sofa instead of the L: the corner seat faced its own chaise"""
    SE.sofa_fabric(F, seats=4, **kw)


SOFA4.__name__ = "sofa_fabric"

# ================================================================================================ floor 1 ======
sp1 = HA.spec(skip=[("back", 10.6 - 3.04)])
ops = HA.ops_windows(sp1)
HA.merge(ops, dict(front=[dict(s0=4.4, s1=6.2, y0=0.0, y1=2.9)], right=[dict(s0=0.7, s1=1.6, y0=0.0, y1=2.13)]))
wins, curt = HA.add_windows(sp1, curtain=("right", "back", "left"))
H.shell(1, ops=ops, wall_tn=WALL1, windows=wins, curtains=curt, floor_tn=(0.96, 0.95, 0.94, 1),
        lights=((2.4, 2.0), (2.6, 5.0), (5.3, 1.8), (8.2, 2.2), (8.6, 5.4)),
        fixtures=[lambda fr: SH.entry_door(fr["front"][0], 4.4, 6.2, 2.9),
                  lambda fr: SH.bath_door(fr["right"][0], 0.7, 1.6, 2.1)])
H.stairs()
H.well_shaft()
H.piece(1, "shaft", FX.stair_shaft, 0, 0, 0, 0, hole=H.hole(), cols=False)
H.piece(1, "entry", FX.genkwan, 0, 0, 0, 0, x0=3.6, x1=7.0, depth=1.5, screen_x=6.9)
H.piece(1, "shoes", ST.shoe_cabinet, 7.75, 0.17, 0.0, 0.0, w=1.0)
H.piece(1, "mirror", DE.mirror_round, 3.9, 0.04, 1.5, 0.0, r=0.26, cols=False)

# kitchen (left front): double fridge in the corner, sink run under the window, gas range run on the left wall
H.piece(1, "fridge", KI.fridge_double, 0.56, 0.5, 0.0, 0.0)
H.piece(1, "sinkrun", KI.counter_base, 2.75, 0.31, 0, 0.0, length=3.0, d=0.6, sink=True, top="oak", door_tn=(0.78, 0.86, 0.92, 1))
H.piece(1, "gasrun", KI.counter_base, 0.31, 2.0, 0, PI / 2, length=2.2, d=0.6, cook="gas", top="oak", door_tn=(0.78, 0.86, 0.92, 1))
H.piece(1, "hood", KI.hood, 0.26, 2.0, 0, PI / 2)
H.piece(1, "upper", KI.upper_cabinets, 3.78, 0.17, 0, 0.0, length=0.95, door_tn=(0.78, 0.86, 0.92, 1))
H.piece(1, "upper", KI.upper_cabinets, 1.6, 0.17, 0, 0.0, length=0.9, door_tn=(0.78, 0.86, 0.92, 1))
P(1, "kettle", "kettle", 1.75, 0.3, 0.9)
P(1, "mug", "mug_p", 3.2, 0.4, 0.9)
pass  # (cottage pass) removed: P(1, "pan", "pan", 0.3, 1.8, 0.9, PI / 2)
P(1, "plates", "plates_stack", 0.3, 1.2, 0.9)
P(1, "bowl", "bowl_p", 2.3, 2.75, 0.74)
# dining: long table, bench on the kitchen side (2), three chairs opposite, a high chair at the end
H.piece(1, "dtable", TA.table_dining_rect, 2.9, 2.8, 0, 0.0, w=2.0, d=0.9)
H.piece(1, "bench", SE.bench_dining, 9.4, 0.4, 0, 0.0, l=1.5)   # (cottage pass) a hall bench by the front wall: the dining side by the counters left no way in
for x in (1.9, 2.6, 3.3):
    H.piece(1, "dchair", SE.chair_dining_wood, x + 0.3, 3.7, 0, PI)
pass  # (cottage pass) removed: H.piece(1, "highchair", FX.high_chair, 3.95, 3.35, 0, -PI / 
H.piece(1, "pendant", DE.pendant_bar, 2.9, 2.8, 3.7, 0.0, w=1.6, drop=1.5, n=3, cols=False)
P(1, "fruit", "fruit_bowl", 2.9, 2.8, 0.74)
P(1, "cup1", "mug_p", 2.2, 2.5, 0.74)
P(1, "cup2", "mug_p", 3.6, 3.1, 0.74)
P(1, "plate1", "plate", 2.5, 3.05, 0.74)
P(1, "plate2", "plate", 3.3, 2.55, 0.74)

# living / play room (right): L sofa faces the TV on the back wall, play mat with toys and baskets
H.piece(1, "sofa", SOFA4, 8.0, 3.7, 0, 0.0, w=2.9, tn=PAL["sofa_sage"], pillow_tn=PAL["mustard"])
H.piece(1, "mat", DE.rug_check, 8.9, 6.2, 0, 0.0, w=2.2, d=1.3, cols=False, a_tn=SKY, b_tn=YEL)
H.piece(1, "tvstand", TA.tv_stand, 9.3, 7.55, 0, PI, w=1.6)
H.piece(1, "tv", TA.tv_wall, 9.3, 7.78, 1.0, PI, w=1.3, cols=False)
pass  # (cottage pass) the toy chest gave its wall to the console vignette
# (realism pass) the six primary-colour baskets read as toys on the floor: two muted fabric bins, the rest on a low white toy shelf
for i, (x, z, tn_) in enumerate(((10.15, 1.8, (0.85, 0.8, 0.72, 1)), (10.25, 6.0, (0.7, 0.75, 0.78, 1)))):
    H.piece(1, "basket", DE.basket, x, z, 0.0, 0.0, r=0.2, h=0.26, tn=tn_)
pass  # (cottage pass) removed: P(1, "ball", "toy_ball", 8.2, 6.0, 0.014)
pass  # (cottage pass) removed: P(1, "blocks", "toy_blocks", 9.3, 6.4, 0.014, 0.5)
pass  # (cottage pass) removed: P(1, "car", "toy_car", 8.6, 5.8, 0.014, 1.1)
pass  # (cottage pass) removed: P(1, "blocks", "toy_blocks", 7.7, 6.35, 0.014, 2.0)
P(1, "tvf", "frame_small", 8.7, 7.6, 0.45, PI)
for i, x in enumerate((8.95, 9.5, 10.05)):
    H.piece(1, "kidart", DE.frame_art, x, 0.04, 1.5 + 0.06 * (i % 2), 0.0, w=0.4, h=0.5, art=i, cols=False)
H.piece(1, "plant", FX.plant_monstera_full, 6.65, 7.4)
H.piece(1, "lamp", DE.floor_lamp, 6.3, 4.55)
H.piece(1, "sofa_pic", DE.frame_art, 10.56, 6.0, 1.5, -PI / 2, w=0.6, h=0.45, art=3, cols=False)

# ================================================================================================ floor 2 ======
sp2 = HA.spec()
ops2 = HA.ops_windows(sp2)
HA.merge(ops2, dict(front=[dict(s0=6.2, s1=7.1, y0=0.0, y1=2.13)]))
wins2, curt2 = HA.add_windows(sp2, curtain=("left", "right", "back", "front"))
H.shell(2, ops=ops2, wall_tn=WALL2, windows=wins2, curtains=curt2, floor_tn=(0.96, 0.95, 0.94, 1),
        lights=((2.2, 2.2), (3.4, 4.6), (8.4, 2.0), (8.6, 5.2)),
        fixtures=[lambda fr: SH.bath_door(fr["front"][0], 6.2, 7.1, 2.1)])
# kids' room (left)
H.piece(2, "bunk", BE.bunk_bed, 1.2, 1.4, 0, PI / 2, tn=SKY)
H.piece(2, "desk", TA.kids_desk, 3.9, 0.3, 0, 0.0, w=1.0)
H.piece(2, "desk", TA.kids_desk, 0.3, 3.67, 0, PI / 2, w=1.0)
H.piece(2, "dchair", SE.chair_desk, 3.9, 1.0, 0, PI, pull_body=0.62)
H.piece(2, "dchair", SE.chair_desk, 1.0, 3.67, 0, -PI / 2, pull_body=0.62)
H.piece(2, "toybox", DE.basket, 0.4, 5.5, 0.0, 0.0, r=0.28, h=0.4, tn=RED)
H.piece(2, "rug", DE.rug_round, 2.8, 3.7, 0, 0.0, d=2.0, cols=False, tn=PAL["rug_cream"])
H.piece(2, "bean", SE.bean_bag, 3.0, 4.3, 0, PI, tn=(0.9, 0.55, 0.45, 1))   # (realism pass) faces the room: it faced the stairwell, its stand spot pinched against the hole
H.piece(2, "plant", FX.plant_fern, 2.0, 6.0) if False else None
H.piece(2, "art", DE.frame_art, 0.04, 3.0, 1.55, PI / 2, w=0.6, h=0.8, art=1, cols=False)
H.piece(2, "lamp", DE.floor_lamp, 5.3, 5.2)
H.piece(2, "basket", DE.basket, 4.2, 3.8, 0.0, 0.0, r=0.2, h=0.26, tn=BLUE)
pass  # (cottage pass) removed: P(2, "blocks", "toy_blocks", 3.0, 3.4, 0.014, 0.9)
P(2, "dbooks", "books3", 3.9, 0.35, 0.6, 0.2)
P(2, "dbooks", "books5", 0.35, 3.5, 0.6, 1.2)
P(2, "dframe", "frame_small", 4.45, 0.3, 0.6, 0.0)
# parents' room (right)
H.piece(2, "rug2", DE.rug_rect, 9.0, 2.0, 0, PI / 2, w=2.3, d=1.7, cols=False, tn=PAL["rug_cream"], border_tn=SKY, fringe=False)
H.piece(2, "bed", BE.bed, 9.45, 2.0, 0, -PI / 2, w=1.45, l=2.05, tn=(0.62, 0.74, 0.85, 1))
H.piece(2, "bedside", TA.bedside, 10.3, 0.85, 0, -PI / 2)
H.piece(2, "bedside", TA.bedside, 10.3, 3.15, 0, -PI / 2)
H.piece(2, "tlamp", DE.table_lamp, 10.3, 0.85, 0.55, 0.0, cols=False)
H.piece(2, "tlamp", DE.table_lamp, 10.3, 3.15, 0.55, 0.0, cols=False)
H.piece(2, "wardrobe", ST.wardrobe_builtin, 9.25, 7.49, 0, PI, w=2.3, bays=2)
H.piece(2, "bookcase", ST.bookcase, 9.5, 0.2, 0, 0.0, w=0.9, h=1.9, shelves=4)
H.piece(2, "mirror", DE.mirror_round, 7.9, 0.04, 1.45, 0.0, r=0.3, cols=False)
H.piece(2, "art", DE.frame_art, 10.56, 2.0, 1.75, -PI / 2, w=1.0, h=0.7, art=2, cols=False)
H.piece(2, "dresser", KR.chest_drawers, 10.35, 5.5, 0, -PI / 2, w=1.0)
P(2, "nbook", "books3", 10.3, 3.15, 0.55, 0.4)
P(2, "ncup", "mug_p", 10.3, 0.85, 0.55, 0.0) if False else None

# ---- realism pass 2026-11-17 (refs: ohou.se 아기가 사는 집 거실 / 이층침대 photos): appliances, storage, the small everyday things ---------
pass  # (cottage pass) removed: H.piece(1, "aircon", KR.aircon_stand, 10.42, 0.38, 0, -PI / 
pass  # (cottage pass) removed: H.piece(1, "settop", KR.settop, 8.75, 7.55, 0.45, PI, cols=F
H.piece(1, "soundbar", KR.soundbar, 9.3, 7.5, 0.45, PI, cols=False, w=0.9)
H.piece(1, "toyshelf", ST.toy_shelf, 7.85, 7.6, 0, PI, w=0.9, tn=(0.93, 0.92, 0.9, 1))
pass  # (cottage pass) removed: H.piece(1, "rack", KR.dish_rack, 2.15, 0.33, 0.9, 0.0, cols=
pass  # (cottage pass) removed: H.piece(1, "rice", KR.rice_cooker, 3.7, 0.33, 0.9, 0.0, cols
pass  # (cottage pass) removed: H.piece(1, "micro", KR.microwave, 0.3, 2.85, 0.9, PI / 2, co
H.piece(1, "mats", KR.placemats, 2.9, 2.8, 0.745, 0.0, cols=False, spots=[(-0.7, 0.25, 0.0), (0.0, 0.25, 0.0), (0.7, 0.25, 0.0), (-0.4, -0.25, 0.0), (0.4, -0.25, 0.0)])
pass  # (cottage pass) removed: H.piece(1, "slippers", KR.slippers, 4.0, 1.75, 0.0, 0.0, col
pass  # (cottage pass) removed: H.piece(1, "purifier", KR.air_purifier, 10.35, 4.6)
pass  # (layered pass 2: a folded throw on the end seat caught taps meant for the next seat — release 4, h2_1_6 -> h2_1_5) H.piece(1, "throw", KR.throw_folded, 7.05, 3.85, 0.62, 0.0, cols=False, w=0.4, d=0.3, layers=3, tn=(0.88, 0.84, 0.76, 1))
pass  # (cottage pass) removed: H.piece(2, "aircon", KR.aircon_wall, 0.0, 1.0, 2.35, PI / 2,
pass  # (cottage pass) removed: H.piece(2, "aircon2", KR.aircon_wall, 9.6, 0.0, 2.25, 0.0, c
H.piece(2, "throw", KR.throw_folded, 8.75, 2.0, 0.56, -PI / 2, cols=False, w=1.3, d=0.4, layers=2, tn=(0.9, 0.86, 0.78, 1))
pass  # (cottage pass) removed: H.piece(2, "laundry", KR.laundry_basket, 10.3, 6.5)   # (was
H.piece(2, "shelf", KR.wall_shelf_deco, 4.65, 0.0, 0.0, 0.0, cols=False, w=1.4, shelf_y=1.45, seed=1)

# ---- dream show-home styling (owner 2026-11-17): fresh flowers, styled tables, lamps and sconces, a console vignette --------
H.piece(1, "flowers", KR.flower_vase, 3.3, 2.8, 0.745, 0.0, cols=False, tn=(0.6, 0.74, 0.92, 1), kind="hydrangea", h=0.26)
H.piece(1, "vignette", KR.console_vignette, 10.6, 2.45, 0.0, -PI / 2, w=1.2, accent=(0.62, 0.76, 0.92, 1))
H.piece(2, "sconce", KR.wall_sconce, 10.6, 0.85, 1.5, -PI / 2, cols=False)
H.piece(2, "sconce", KR.wall_sconce, 10.6, 3.15, 1.5, -PI / 2, cols=False)

H.piece(1, "view", FX.view_band, 0, 0, 0, 0, cols=False, seats=False, house=2)
H.piece(2, "view", FX.view_band, 0, 0, 0, 0, cols=False, seats=False, house=2)

H.piece(2, "part_a", FX.part_wall, 5.75, 0.0, 0, -PI / 2, length=6.2, openings=[(2.4, 4.3, 2.6)], tn=WALL2)
H.piece(2, "kidpend", DE.pendant_dome, 2.8, 3.7, 3.7, 0.0, drop=1.5, r=0.2, cols=False)
H.piece(2, "parpend", DE.pendant_globe, 8.4, 3.8, 3.7, 0.0, drop=1.5, r=0.16, cols=False)

problems = H.finish()

CAMS = [
    dict(name="1f_entry", floor=1, eye=[5.3, 0.45, 1.3], look=[4.0, 5.5, 1.2], lens=16),
    dict(name="1f_kitchen", floor=1, eye=[5.2, 3.0, 1.3], look=[1.4, 1.0, 1.1], lens=16),
    dict(name="1f_living", floor=1, eye=[5.0, 1.5, 1.25], look=[9.4, 5.8, 0.9], lens=16),
    dict(name="1f_stair", floor=1, eye=[7.0, 5.0, 1.3], look=[2.0, 6.9, 1.5], lens=16),
    dict(name="2f_kids", floor=2, eye=[5.9, 3.4, 1.3], look=[1.0, 1.4, 0.9], lens=16),
    dict(name="2f_parents", floor=2, eye=[8.2, 5.6, 1.3], look=[10.3, 1.8, 0.9], lens=16),
    dict(name="2f_well", floor=2, eye=[8.0, 4.8, 1.3], look=[2.6, 7.0, 0.2], lens=16),
]
json.dump(CAMS, open(os.path.join(K.WORK, "house_2_cams.json"), "w"), indent=1)
H.save(os.path.join(K.WORK, "house_2_authoring.blend"))
