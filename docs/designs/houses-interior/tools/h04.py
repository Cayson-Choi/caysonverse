"""4번 집 (흰) - 할머니 할아버지 댁. 계단 D (왼쪽 옆벽). 1층 온돌 안방 + 작은 부엌, 2층 사랑방.
Room-local coordinates (x 0..10.6 left -> right coming in, z 0..7.8 front -> back, yaw 0 = into the room, pi/2 = +x).

  blender -b --factory-startup -P art/village/tools/houses/h04.py        -> art/village/work/house_4_authoring.blend (+ house_4_cams.json)
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
import kit_storage as ST  # noqa: E402
import kit_kitchen as KI  # noqa: E402
import kit_fix as FX  # noqa: E402
import ha_common as HA  # noqa: E402
import kit_real as KR  # noqa: E402

PAL = K.PAL
PI = math.pi
H = HC.House(4)
FX.set_house(4)
P = HA.prop_fn(H)

WALL1 = (0.96, 0.95, 0.91, 1)          # cottage pass: chalk white with natural oak
RED = (0.78, 0.35, 0.33, 1)
NAVY = (0.3, 0.38, 0.55, 1)
GOLD = (0.88, 0.7, 0.3, 1)
GRN = (0.45, 0.6, 0.45, 1)
DARK = (0.42, 0.28, 0.18, 1)        # dark wood 창호 frames


def face_center(cx, cz, x, z):
    return math.atan2(cx - x, cz - z)          # local yaw that looks from (x, z) at (cx, cz)


def tile_patch(F, x0, x1, z0, z1):
    SH.floor(F.sub(0, 0, 0.004), x0, x1, z0, z1, "tile_white", tn=(0.95, 0.95, 0.93, 1))
    SH.threshold(F, x0, x1, z1)


# ================================================================================================ floor 1 ======
sp1 = HA.spec(skip=[("left", 7.8 - 4.13)])           # stair D against the left wall
ops = HA.ops_windows(sp1, y0=0.8, y1=2.2)
HA.merge(ops, dict(front=[dict(s0=4.4, s1=6.2, y0=0.0, y1=2.9)]))
wins = []
for wall, lst in sp1.items():
    for (c, w) in lst:
        kitchen = wall == "front" and c > 6
        wins.append((wall, c - w / 2, c + w / 2, 0.8, 2.2, dict(style="grid", cols=3, rows=2) if kitchen else dict(style="grid", cols=2, rows=2)))
H.shell(1, ops=ops, wall_tn=WALL1, floor_kind="oak", floor_tn=(0.96, 0.94, 0.9, 1), windows=wins,
        lights=((3.2, 2.8), (3.4, 5.6), (7.8, 2.0), (8.8, 5.6), (5.3, 1.4)),
        fixtures=[lambda fr: SH.entry_door(fr["front"][0], 4.4, 6.2, 2.9)])
H.stairs()
H.well_shaft()
H.piece(1, "shaft", FX.stair_shaft, 0, 0, 0, 0, hole=H.hole(), cols=False)
H.piece(1, "entry", FX.genkwan, 0, 0, 0, 0, x0=3.6, x1=7.0, depth=1.5, screen=False, tile="tile_grey")
H.piece(1, "kitchen_tile", tile_patch, 0, 0, 0, 0, x0=7.0, x1=10.6, z0=0.0, z1=3.6, cols=False)
pass  # (cottage pass) removed: H.piece(1, "slippers", DE.boots_pair, 4.1, 0.7, 0.0, 0.5, co
H.piece(1, "shoes", ST.shoe_cabinet, 3.85, 0.17, 0.0, 0.0, w=0.7)
H.piece(1, "hooks", FX.wall_hooks, 6.65, 0.01, 1.55, 0.0, n=2, spacing=0.2)

# small kitchen (right front)
H.piece(1, "sinkrun", KI.counter_base, 8.0, 0.31, 0, 0.0, length=2.6, d=0.6, sink=True, top="stone", door_tn=(0.92, 0.9, 0.85, 1))
H.piece(1, "fridge", KI.fridge, 10.1, 0.45, 0.0, -PI / 2, w=0.7)
H.piece(1, "gas", KI.counter_base, 10.31, 1.7, 0, -PI / 2, length=1.0, d=0.6, cook="gas", top="stone", door_tn=(0.92, 0.9, 0.85, 1))
H.piece(1, "upper", KI.upper_cabinets, 9.9, 0.17, 0, 0.0, length=0.9, door_tn=(0.92, 0.9, 0.85, 1))
H.piece(1, "dtable", TA.table_dining_rect, 8.9, 2.55, 0, 0.0, w=1.0, d=0.7)
H.piece(1, "kchair", SE.chair_farm, 8.9, 1.85, 0, 0.0, variant=3)
H.piece(1, "kchair", SE.chair_farm, 8.9, 3.25, 0, PI, variant=5)
H.piece(1, "pend", DE.pendant_dome, 8.9, 2.55, 3.7, 0.0, drop=1.5, r=0.18, cols=False)
P(1, "kettle", "kettle", 7.0, 0.3, 0.9)
pass  # (cottage pass) removed: P(1, "pan", "pan", 10.3, 1.55, 0.9, -PI / 2)
P(1, "bowl", "bowl_p", 8.4, 0.35, 0.9)
P(1, "fruit", "fruit_bowl", 8.9, 2.55, 0.74)
P(1, "kcup", "mug_p", 8.6, 2.7, 0.74)
pass  # (cottage pass) removed: H.piece(1, "garlic", DE.garlic_braid, 10.5, 3.2, 1.5, -PI / 
H.piece(1, "plant", DE.plant_snake, 6.75, 2.2)
pass  # (cottage pass) removed: H.piece(1, "screen", ST.folding_screen, 7.7, 3.9, 0, 0.0, pa

# 온돌 안방: soban + four cushions, 보료 + 안석 on the back wall, 자개장 on the right wall, quilts, family photos
cx, cz = 4.6, 4.6          # (realism pass) 0.4 m toward the room: the 보료 came off the back wall (it was 0.4 m inside it)
H.piece(1, "soban", TA.soban, cx, cz, 0, 0.0, d=0.62, h=0.3)
for k, tn_ in enumerate((RED, NAVY, GOLD, GRN)):
    a = k * PI / 2 + PI / 4
    x, z = cx + 0.85 * math.cos(a), cz + 0.85 * math.sin(a)
    H.piece(1, "cushion", SE.bangseok, x, z, 0, face_center(cx, cz, x, z), tn=tn_)
P(1, "stea", "teapot", cx - 0.05, cz, 0.3)
P(1, "scup", "teacup", cx + 0.12, cz + 0.1, 0.3)
P(1, "sfruit", "bowl_p", cx - 0.14, cz + 0.12, 0.3)
H.piece(1, "boryo", SE.boryo, 4.85, 6.88, 0, PI, w=0.9, l=1.8, tn=(0.55, 0.3, 0.3, 1))   # (realism pass) was 0.4 m into the back wall
H.piece(1, "jagae", ST.wardrobe_wood, 10.3, 6.35, 0, -PI / 2, w=1.9)
pass  # (cottage pass) removed: H.piece(1, "futon", FX.futon_stack, 8.5, 7.4, 0, PI, w=1.0, 
H.piece(1, "tvstand", TA.tv_stand, 1.8, 0.25, 0, 0.0, w=0.9, d=0.4, h=0.45)
H.piece(1, "tv", TA.tv_wall, 1.5, 0.08, 0.62, 0.0, w=0.7, cols=False)
P(1, "tvvase", "vase_small", 2.1, 0.25, 0.45)
H.piece(1, "photos", DE.frame_family, 4.1, 7.76, 1.7, PI, cols=False)
H.piece(1, "photos", DE.frame_family, 4.6, 7.76, 1.7, PI, w=0.4, h=0.3, cols=False)
H.piece(1, "clock", DE.wall_clock, 5.3, 7.76, 1.85, PI, cols=False)
pass  # (cottage pass) removed: H.piece(1, "calendar", DE.calendar_wall, 5.8, 7.76, 1.5, PI,
H.piece(1, "plant", DE.plant_snake, 6.6, 6.9)
H.piece(1, "sorug", DE.rug_rect, cx, cz, 0, 0.0, w=2.8, d=2.6, cols=False, tn=(0.9, 0.82, 0.66, 1), border_tn=(0.62, 0.32, 0.3, 1), fringe=False)
H.piece(1, "banndaji", ST.banndaji, 1.95, 7.5, 0, PI, w=0.9)
P(1, "bjar", "vase_small", 1.75, 7.5, 0.85)
P(1, "bbooks", "books3", 2.15, 7.5, 0.85, 0.3)
H.piece(1, "mungap", ST.mungap, 10.3, 4.15, 0, -PI / 2, w=0.9) if False else None
H.piece(1, "lamp", DE.floor_lamp, 6.05, 7.35)
H.piece(1, "basket", DE.basket, 2.4, 6.9, 0.0, 0.0, r=0.24, h=0.3, tn=(0.82, 0.66, 0.45, 1))

# ================================================================================================ floor 2 ======
sp2 = HA.spec(skip=[("left", 7.8 - 4.13)])
ops2 = HA.ops_windows(sp2, y0=0.8, y1=2.2)
HA.merge(ops2, dict(front=[dict(s0=4.4, s1=5.3, y0=0.0, y1=2.13)]))
wins2 = [(w, c - wd / 2, c + wd / 2, 0.8, 2.2, dict(style="grid", cols=2, rows=2)) for w, lst in sp2.items() for (c, wd) in lst]
H.shell(2, ops=ops2, wall_tn=(0.95, 0.94, 0.9, 1), floor_kind="oak", floor_tn=(0.96, 0.94, 0.9, 1), windows=wins2,
        lights=((3.4, 2.4), (6.0, 3.2), (8.0, 5.6), (5.2, 5.6)),
        fixtures=[lambda fr: SH.bath_door(fr["front"][0], 4.4, 5.3, 2.1)])
# 서안 at the back window with a cushion, 문갑 and scrolls, tea table with two cushions
H.piece(2, "seoan", TA.seoan, 7.15, 7.4, 0, 0.0, w=0.95)
H.piece(2, "cushion", SE.bangseok, 7.15, 6.6, 0, 0.0, tn=NAVY)
P(2, "sbooks", "books5", 6.9, 7.4, 0.32, 0.3)
H.piece(2, "mungap", ST.mungap, 5.0, 7.5, 0, PI, w=0.9)
H.piece(2, "orchid", DE.plant_orchid, 4.8, 7.5, 0.6, 0.0, cols=False)
P(2, "mvase", "vase_small", 5.3, 7.5, 0.6)
pass  # (cottage pass) removed: H.piece(2, "scroll", ST.scroll_hanging, 4.2, 7.76, 0.9, PI, 
pass  # (cottage pass) removed: H.piece(2, "scroll", ST.scroll_hanging, 5.8, 7.76, 0.9, PI, 
H.piece(2, "ctable", TA.table_low, 6.0, 3.3, 0, 0.0, w=1.0, d=0.7)
H.piece(2, "tcush", SE.bangseok, 6.0, 2.5, 0, 0.0, tn=RED)
H.piece(2, "tcush", SE.bangseok, 6.0, 4.1, 0, PI, tn=GRN)
H.piece(2, "tea", DE.tea_set, 6.0, 3.3, 0.35, 0.0, cols=False)
pass  # (cottage pass) removed: H.piece(2, "lantern", DE.hanji_lantern, 6.0, 3.3, 2.9, 0.0, 
H.piece(2, "rug", DE.rug_rect, 6.0, 3.3, 0, 0.0, w=2.4, d=2.4, cols=False, tn=(0.8, 0.62, 0.45, 1), border_tn=(0.5, 0.3, 0.25, 1), fringe=False)
pass  # (cottage pass) removed: H.piece(2, "screen", ST.folding_screen, 10.2, 6.5, 0, PI / 2
pass  # (cottage pass) removed: H.piece(2, "books", FX.futon_stack, 9.6, 1.2, 0, 0.0, w=0.9,
H.piece(2, "plant", FX.plant_monstera_full, 9.8, 3.6)
H.piece(2, "photos", DE.frame_family, 10.56, 5.3, 1.6, -PI / 2, cols=False)

# ---- realism pass 2026-11-17 (refs: 노란 장판 villa room with a wall aircon, maisonkorea 자개 furniture): what a grandparents' room has --
pass  # (cottage pass) removed: H.piece(1, "aircon", KR.aircon_wall, 10.6, 6.3, 2.45, -PI / 
pass  # (cottage pass) removed: H.piece(1, "fan", KR.electric_fan, 6.75, 5.9, 0, -PI / 2 - 0
pass  # (cottage pass) removed: H.piece(1, "settop", KR.settop, 1.6, 0.25, 0.45, 0.0, cols=F
pass  # (cottage pass) removed: H.piece(1, "rice", KR.rice_cooker, 9.0, 0.33, 0.9, 0.0, cols
pass  # (cottage pass) removed: H.piece(1, "rack", KR.dish_rack, 7.45, 0.33, 0.9, 0.0, cols=
pass  # (cottage pass) removed: H.piece(1, "kslippers", KR.slippers, 4.0, 1.75, 0.0, 0.0, co
H.piece(1, "throw", KR.throw_folded, 2.25, 7.5, 0.85, 0.0, cols=False, w=0.5, d=0.34, layers=4, tn=(0.75, 0.42, 0.4, 1)) if False else None
pass  # (cottage pass) removed: H.piece(2, "aircon", KR.aircon_wall, 2.2, 0.0, 2.35, 0.0, co
pass  # (cottage pass) removed: H.piece(2, "fan", KR.electric_fan, 8.4, 6.9, 0, PI + 0.5)
H.piece(2, "lowcase", ST.bookcase, 3.15, 7.6, 0, PI, w=1.2, h=0.75, shelves=1)
P(2, "lcvase", "vase_small", 2.75, 7.62, 0.75)
P(2, "lcbooks", "books3", 3.45, 7.62, 0.75, 0.2)
pass  # (cottage pass) removed: H.piece(2, "purifier", KR.air_purifier, 9.9, 0.45)
H.piece(2, "banndaji", ST.banndaji, 10.3, 2.3, 0, -PI / 2, w=0.9)
pass  # (cottage pass) removed: H.piece(2, "bfuton", FX.futon_stack, 10.3, 2.3, 0.85, -PI / 
H.piece(2, "shelf", KR.wall_shelf_deco, 9.0, 7.8, 0.0, PI, cols=False, w=1.2, shelf_y=1.5, seed=4)
pass  # (cottage pass) removed: H.piece(2, "calendar", DE.calendar_wall, 5.3, 7.76, 1.45, PI

# ---- dream show-home styling (owner 2026-11-17): fresh flowers, styled tables, lamps and sconces, a console vignette --------
H.piece(1, "flowers", KR.flower_vase, 9.15, 2.55, 0.745, 0.0, cols=False, tn=(0.95, 0.95, 0.92, 1), kind="hydrangea", h=0.24)
H.piece(1, "vignette", KR.console_vignette, 8.5, 7.8, 0.0, PI, w=1.2, accent=(0.7, 0.8, 0.66, 1))

H.piece(1, "view", FX.view_band, 0, 0, 0, 0, cols=False, seats=False, house=4)
H.piece(2, "view", FX.view_band, 0, 0, 0, 0, cols=False, seats=False, house=4)

H.piece(2, "part_a", FX.part_wall, 2.6, 5.0, 0, 0.0, length=8.0, openings=[(2.0, 4.0, 2.4)], tn=(0.96, 0.9, 0.76, 1), trim_tn=DARK)
pass  # (cottage pass) removed: H.piece(1, "ondolpend", DE.hanji_lantern, 4.6, 5.0, 2.9, 0.0

problems = H.finish()

CAMS = [
    dict(name="1f_entry", floor=1, eye=[5.3, 0.45, 1.3], look=[4.8, 5.5, 1.1], lens=16),
    dict(name="1f_ondol", floor=1, eye=[2.2, 2.4, 1.2], look=[6.0, 6.2, 0.7], lens=16),
    dict(name="1f_back", floor=1, eye=[7.8, 4.4, 1.2], look=[3.6, 7.2, 0.9], lens=16),
    dict(name="1f_kitchen", floor=1, eye=[6.0, 3.4, 1.3], look=[9.6, 0.8, 1.0], lens=16),
    dict(name="2f_sarang", floor=2, eye=[4.2, 1.2, 1.2], look=[7.4, 6.0, 0.6], lens=16),
    dict(name="2f_tea", floor=2, eye=[8.8, 5.6, 1.2], look=[3.5, 2.4, 0.5], lens=16),
    dict(name="2f_well", floor=2, eye=[6.0, 2.6, 1.3], look=[1.2, 5.6, 0.2], lens=16),
]
json.dump(CAMS, open(os.path.join(K.WORK, "house_4_cams.json"), "w"), indent=1)
H.save(os.path.join(K.WORK, "house_4_authoring.blend"))
