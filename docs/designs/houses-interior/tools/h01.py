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
import kit_real as KR  # noqa: E402

PAL = K.PAL
PI = math.pi
H = HC.House(1)
H.sill_n = 1           # layered pass 2: flower jugs on sills (triangle budget)
H.pull_body = 0.52        # the dining chairs keep ~1 m clear in front (the game stands a 0.45 m body there)
H.fire_d = (0.3, 0.22)    # layered pass: a shallow chimney breast + hearth (0.52 m) keeps the 8th entry arrival spot free
H.endtables = False       # layered pass: an end table by the sofa takes the 8th arrival spot at the entry (arrivalSpot test)
FX.set_house(1)

WALL1 = (0.97, 0.89, 0.87, 1)          # cottage pass: blush limewash (the pink house)
FLOOR_TN = (0.97, 0.96, 0.95, 1)
WALL2 = (0.98, 0.92, 0.9, 1)            # paler blush upstairs

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
wins, curt = add_windows(W1, curtain=("left", "right", "back"))
H.shell(1, ops=ops, wall_tn=WALL1, floor_tn=FLOOR_TN, windows=wins, curtains=curt,
        lights=((2.6, 2.6), (2.6, 5.4), (5.3, 1.6), (8.3, 1.8), (8.3, 3.8)),
        fixtures=[lambda fr: SH.entry_door(fr["front"][1] if False else fr["front"][0], 4.4, 6.2, 2.9),
                  lambda fr: SH.bath_door(fr["left"][0], 7.8 - 1.55, 7.8 - 0.65, 2.1)])
H.stairs()
H.well_shaft()
H.piece(1, "shaft", FX.stair_shaft, 0, 0, 0, 0, hole=H.hole(), cols=False)
H.piece(1, "entry", FX.genkwan, 0, 0, 0, 0, x0=3.6, x1=7.0, depth=1.5, screen_x=6.9)    # tile + 귀틀 + glass screen
H.piece(1, "shoes", ST.shoe_cabinet, 3.9, 0.17, 0.0, 0.0, w=0.8)

# living (left): sofa faces the TV wall (back wall), armchair across the coffee table
H.piece(1, "rug", DE.rug_rect, 2.5, 5.0, 0, 0.0, w=3.0, d=2.1, cols=False, tn=PAL["rug_cream"], border_tn=PAL["rug_grey"], fringe=False)
H.piece(1, "sofa", SE.sofa_fabric, 2.7, 2.95, 0, 0.0, w=2.4, tn=PAL["sofa_grey"], pillow_tn=PAL["mustard"])
H.piece(1, "coffee", TA.table_coffee_rect, 2.5, 5.25, 0, 0.0, w=0.9, d=0.55)   # inside the old round table's footprint: the stair-foot arrivals need that floor
H.piece(1, "armchair", SE.armchair_lounge, 0.7, 4.6, 0, PI / 2 + 0.25)
H.piece(1, "lamp", DE.floor_lamp, 0.75, 2.5)
H.piece(1, "tvstand", TA.tv_stand, 2.4, 7.55, 0, PI, w=1.8)
H.piece(1, "tv", TA.tv_wall, 2.4, 7.78, 0.95, PI, w=1.45, cols=False)
H.piece(1, "plant", FX.plant_monstera_full, 0.5, 6.5)
H.piece(1, "plant2", FX.plant_rubber_full, 4.35, 7.45)
H.piece(1, "art", DE.frame_art, 0.04, 6.0, 1.45, PI / 2, w=0.7, h=0.5, art=1, cols=False)
H.piece(1, "art2", DE.frame_art, 6.65, 0.04, 1.75, 0.0, w=0.5, h=0.65, art=2, cols=False)     # (realism pass) was at x 5.3 — hanging in the glass of the entry door (x 4.4..6.2)

# kitchen (right): sink under the front window, cooktop run on the right wall, fridge in the corner, dining table
H.piece(1, "sinkrun", KI.counter_base, 8.4, 0.31, 0, 0.0, length=2.6, d=0.6, sink=True, top="stone")
H.piece(1, "cookrun", KI.counter_base, 10.28, 2.1, 0, -PI / 2, length=2.6, d=0.6, cook="induction", top="stone")
H.piece(1, "fridge", KI.fridge, 10.2, 0.4, 0, -PI / 2, w=0.7)
H.piece(1, "hood", KI.hood, 10.35, 2.1, 0, -PI / 2)
H.piece(1, "dtable", TA.table_dining_rect, 8.14, 2.9, 0, PI / 2, w=1.4, d=0.5)   # turned: the stair foot keeps its floor (arrivals)
for i, (x, z, yw) in enumerate(((7.4, 2.5, PI / 2), (7.4, 3.3, PI / 2), (8.88, 2.5, -PI / 2), (8.88, 3.3, -PI / 2))):
    H.piece(1, "dchair", SE.chair_dining_upholstered, x, z, 0, yw)
H.piece(1, "pendant", DE.pendant_bar, 8.15, 2.9, 3.7, PI / 2, w=1.2, drop=1.5, n=2, cols=False)


# small things (kit props): lived-in
def P(floor, name, prop, x, z, y, yaw=0.0, **kw):
    H.piece(floor, name, FX.prop, x, z, y, yaw, cols=False, which=prop, **kw)


# ---- realism pass 2026-11-17: what a lived-in Korean home has (refs: LG homestyle living rooms, tower aircon review photo) -------------
pass  # (cottage pass) removed: H.piece(1, "aircon", KR.aircon_stand, 1.15, 7.6, 0, PI)   # 
pass  # (cottage pass) removed: H.piece(1, "settop", KR.settop, 1.75, 7.55, 0.45, PI, cols=F
H.piece(1, "soundbar", KR.soundbar, 2.4, 7.5, 0.45, PI, cols=False, w=0.95)
pass  # (houses-real 2: a flat board over the new rolled arm) removed: H.piece(1, "throw", KR.throw_draped, 3.82, 3.0, 0.62, PI / 2, cols=False, w=0.5, top_d=0.16, drop_front=0.36, drop_back=0.12, tn=(0.85, 0.8, 0.7, 1))
H.piece(1, "sideboard", TA.tv_stand, 2.68, 0.25, 0, 0.0, w=1.5, d=0.4, h=0.62, tn=(0.86, 0.84, 0.8, 1))
H.piece(1, "sblamp", DE.table_lamp, 2.15, 0.25, 0.62, 0.0, cols=False)
P(1, "sbframe", "frame_small", 2.95, 0.22, 0.62, 0.0)
P(1, "sbbooks", "books3", 3.2, 0.25, 0.62, 0.2)
H.piece(1, "side", TA.bedside, 0.42, 5.35, 0, PI / 2)
P(1, "sidemug", "mug_p", 0.42, 5.35, 0.55)
pass  # (cottage pass) removed: H.piece(1, "purifier", KR.air_purifier, 0.45, 1.0)
H.piece(1, "uppers_a", KI.upper_cabinets, 10.43, 1.25, 0, -PI / 2, cols=False, length=0.8)
H.piece(1, "uppers_b", KI.upper_cabinets, 10.43, 2.95, 0, -PI / 2, cols=False, length=0.8)
pass  # (cottage pass) removed: H.piece(1, "rack", KR.dish_rack, 7.45, 0.33, 0.9, 0.0, cols=
pass  # (cottage pass) removed: H.piece(1, "purifierk", KR.water_purifier, 7.88, 0.28, 0.9, 
pass  # (cottage pass) removed: H.piece(1, "rice", KR.rice_cooker, 9.05, 0.33, 0.9, 0.0, col
pass  # (cottage pass) removed: H.piece(1, "micro", KR.microwave, 10.3, 3.05, 0.9, -PI / 2, 
H.piece(1, "mats", KR.placemats, 8.15, 2.9, 0.745, PI / 2, cols=False, spots=[(-0.4, -0.22, 0.0), (0.4, -0.22, 0.0), (-0.4, 0.22, 0.0), (0.4, 0.22, 0.0)])
pass  # (cottage pass) removed: H.piece(1, "slippers", KR.slippers, 6.6, 1.75, 0.0, 0.0, col
pass  # (cottage pass) removed: H.piece(1, "umbrella", KR.umbrella_stand, 6.7, 0.35, 0.0, 0.

P(1, "mag", "magazine", 2.3, 5.15, 0.4, 0.4)
P(1, "cvase", "vase_small", 2.75, 5.35, 0.4)
P(1, "cbooks", "books3", 2.25, 5.38, 0.4, 0.3)
P(1, "tvvase", "vase_small", 3.2, 7.55, 0.45)
P(1, "tvbooks", "books5", 2.95, 7.6, 0.45, PI)
P(1, "fruit", "fruit_bowl", 8.15, 2.9, 0.74)
P(1, "candle", "candle", 8.15, 2.45, 0.74)
P(1, "candle", "candle", 8.15, 3.35, 0.74)
P(1, "kettle", "kettle", 9.45, 0.3, 0.9)
pass  # (cottage pass) removed: P(1, "pan", "pan", 10.25, 2.1, 0.9, -PI / 2)
pass  # (cottage pass) removed: P(1, "board", "cutting_board", 10.3, 1.35, 0.9, -PI / 2)
P(1, "plates", "plates_stack", 10.3, 1.0, 0.9)
P(1, "kcup", "teacup", 7.95, 3.15, 0.74)
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
H.piece(2, "bed", BE.bed_queen, 1.15, 2.3, 0, PI / 2, tn=PAL["blush"])
H.piece(2, "bedside", TA.bedside, 0.28, 0.85, 0, PI / 2)
H.piece(2, "bedside", TA.bedside, 0.28, 3.45, 0, PI / 2)
H.piece(2, "lamp", DE.table_lamp, 0.28, 0.85, 0.55, 0.0, cols=False)
H.piece(2, "lamp", DE.table_lamp, 0.28, 3.45, 0.55, 0.0, cols=False)
H.piece(2, "wardrobe", ST.wardrobe_builtin, 1.2, 7.5, 0, PI, w=2.1, bays=2)
H.piece(2, "dressing", TA.dressing_table, 9.4, 0.3, 0, 0.0)
H.piece(2, "stool", SE.ottoman, 9.4, 1.1, 0, PI, w=0.5, d=0.42)
H.piece(2, "bookcase", ST.bookcase, 6.2, 0.2, 0, 0.0, w=1.0, h=1.9, shelves=4)
H.piece(2, "desk", TA.desk, 10.2, 4.15, 0, -PI / 2, w=1.4)
H.piece(2, "deskchair", SE.chair_desk, 9.35, 4.15, 0, PI / 2, pull_body=0.62)
H.piece(2, "rug2", DE.rug_round, 7.4, 3.0, 0, 0.0, d=1.8, cols=False, tn=PAL["sage"])
H.piece(2, "plant", FX.plant_olive_full, 6.0, 5.6)
H.piece(2, "lamp2", DE.floor_lamp, 9.9, 5.4)

H.piece(1, "mirror", DE.mirror_round, 3.9, 0.04, 1.55, 0.0, r=0.28, cols=False)
H.piece(1, "clock", DE.wall_clock, 10.56, 3.0, 1.9, -PI / 2, cols=False)
H.piece(2, "art", DE.frame_art, 0.04, 2.3, 1.7, PI / 2, w=1.0, h=0.7, art=2, cols=False)
H.piece(2, "mirror", DE.mirror_round, 7.4, 0.04, 1.4, 0.0, r=0.35, cols=False)
H.piece(2, "basket", DE.basket, 2.8, 7.4, 0.0, 0.0, r=0.25, h=0.45)
H.piece(2, "plant2", FX.plant_monstera_full, 8.7, 5.2)
# (realism pass) the 2F console stood over the stairwell hole: removed
P(2, "nbooks", "books3", 0.28, 0.85, 0.55, 0.5)
P(2, "ncandle", "candle", 0.3, 3.5, 0.55)
P(2, "dbooks", "books5", 10.25, 3.6, 0.74, PI)
P(2, "dmug", "mug_p", 10.2, 4.7, 0.74)
P(2, "dframe", "frame_small", 10.4, 3.9, 0.74, -PI / 2)
P(2, "dmag", "magazine", 10.0, 4.3, 0.74, 0.5)
H.piece(2, "dlamp", DE.table_lamp, 10.3, 3.45, 0.74, 0.0, cols=False)

pass  # (cottage pass) removed: H.piece(2, "aircon", KR.aircon_wall, 0.9, 0.0, 2.2, 0.0, col
H.piece(2, "throw", KR.throw_folded, 1.85, 2.3, 0.56, PI / 2, cols=False, w=1.45, d=0.42, layers=2, tn=(0.82, 0.7, 0.62, 1))
H.piece(2, "drawers", KR.chest_drawers, 5.19, 1.2, 0, -PI / 2, w=1.0)
P(2, "drbooks", "books3", 5.19, 0.95, 0.875, -PI / 2)
P(2, "drvase", "vase_small", 5.19, 1.45, 0.875)
pass  # (cottage pass) removed: H.piece(2, "purifier", KR.air_purifier, 0.45, 5.8)
H.piece(2, "shelf", KR.wall_shelf_deco, 10.6, 2.35, 0.0, -PI / 2, cols=False, w=1.1, shelf_y=1.55, seed=3)
pass  # (cottage pass) removed: H.piece(2, "laundry", KR.laundry_basket, 3.45, 7.35)

# ---- dream show-home styling (owner 2026-11-17): fresh flowers, styled tables, lamps and sconces, a console vignette --------
H.piece(1, "flowers", KR.flower_vase, 8.15, 2.65, 0.745, 0.0, cols=False, tn=(0.92, 0.66, 0.72, 1), kind="rose", h=0.24)
H.piece(1, "cstyle", KR.coffee_styling, 2.5, 5.25, 0.4, 0.0, cols=False, tn=(0.9, 0.7, 0.75, 1))
H.piece(1, "vignette", KR.console_vignette, 0.0, 1.5, 0.0, PI / 2, w=1.2, accent=(0.92, 0.7, 0.76, 1))
H.piece(2, "sconce", KR.wall_sconce, 0.0, 0.85, 1.5, PI / 2, cols=False)
H.piece(2, "sconce", KR.wall_sconce, 0.0, 3.45, 1.5, PI / 2, cols=False)

H.piece(1, "view", FX.view_band, 0, 0, 0, 0, cols=False, seats=False, house=1)
H.piece(2, "view", FX.view_band, 0, 0, 0, 0, cols=False, seats=False, house=1)

H.piece(2, "part_a", FX.part_wall, 5.5, 0.0, 0, -PI / 2, length=5.0, openings=[(2.4, 4.2, 2.6)], tn=WALL2)   # (seat-front audit) ends 1.4 m short of the stairwell: a straight way to the landing
H.piece(2, "bedpend", DE.pendant_globe, 3.2, 2.3, 3.7, 0.0, drop=1.5, r=0.16, cols=False)
H.piece(1, "livepend", DE.pendant_dome, 2.5, 5.0, 3.7, 0.0, drop=1.5, r=0.22, cols=False)

problems = H.finish()

CAMS = [
    dict(name="1f_entry", floor=1, eye=[5.3, 0.45, 1.3], look=[4.6, 5.5, 1.2], lens=16),
    dict(name="1f_living", floor=1, eye=[5.7, 2.3, 1.25], look=[1.2, 5.6, 1.0], lens=16),
    dict(name="1f_kitchen", floor=1, eye=[5.9, 5.0, 1.3], look=[9.6, 1.3, 1.0], lens=16),
    dict(name="1f_stair", floor=1, eye=[4.7, 1.9, 1.3], look=[8.6, 6.8, 2.0], lens=16),
    dict(name="2f_bed", floor=2, eye=[7.3, 3.5, 1.3], look=[0.4, 1.9, 0.9], lens=16),
    dict(name="2f_study", floor=2, eye=[6.4, 1.2, 1.3], look=[10.2, 4.3, 1.0], lens=16),
    dict(name="2f_well", floor=2, eye=[7.0, 2.2, 1.3], look=[7.8, 7.0, 0.2], lens=16),
]
json.dump(CAMS, open(os.path.join(K.WORK, "house_1_cams.json"), "w"), indent=1)
H.save(os.path.join(K.WORK, "house_1_authoring.blend"))
