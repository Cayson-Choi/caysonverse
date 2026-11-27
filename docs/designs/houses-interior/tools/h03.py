"""3번 집 (노랑) - 농가 부엌집. 계단 C (오른쪽 옆벽, 앞 -> 뒤). 1층 큰 시골 부엌(뒷벽 싱크대, 6인 원목 식탁, 창가 평상), 2층 손님방 + 작은 거실.
Room-local coordinates (x 0..10.6 left -> right coming in, z 0..7.8 front -> back, yaw 0 = into the room, pi/2 = +x).

  blender -b --factory-startup -P art/village/tools/houses/h03.py        -> art/village/work/house_3_authoring.blend (+ house_3_cams.json)
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
H = HC.House(3)
H.pull_body = 0.53        # a 1.06 m aisle between the table and its row of chairs: the middle chair is reached from in front
FX.set_house(3)
P = HA.prop_fn(H)

WALL1 = (0.98, 0.92, 0.72, 1)      # cottage pass: butter-yellow limewash (the yellow house)
WALL2 = (0.96, 0.92, 0.82, 1)
CREAM = (0.97, 0.94, 0.86, 1)
WOODC = (0.72, 0.5, 0.32, 1)

# ================================================================================================ floor 1 ======
sp1 = HA.spec(H, 1)            # the shell's windows; the ones stair C (right wall) stands in front of are left out
ops = HA.ops_windows(sp1)
HA.merge(ops, dict(front=[dict(s0=4.4, s1=6.2, y0=0.0, y1=2.9), dict(s0=9.3, s1=10.2, y0=0.0, y1=2.13)]))
wins, curt = HA.add_windows(sp1, curtain=("left",), window_kw=dict(cols=2, rows=2), curtain_kw=dict(folds=9, tn=(0.95, 0.88, 0.7, 1)))
H.shell(1, ops=ops, wall_tn=WALL1, windows=wins, curtains=curt, floor_kind="oak", floor_tn=(0.95, 0.78, 0.6, 1),
        lights=((2.6, 2.4), (5.3, 5.0), (8.0, 2.6), (3.0, 6.0), (7.5, 5.8)),
        fixtures=[lambda fr: SH.entry_door(fr["front"][0], 4.4, 6.2, 2.9),
                  lambda fr: SH.bath_door(fr["front"][0], 9.3, 10.2, 2.1)])
H.stairs()
H.well_shaft()
H.piece(1, "shaft", FX.stair_shaft, 0, 0, 0, 0, hole=H.hole(), cols=False)
H.piece(1, "entry", FX.genkwan, 0, 0, 0, 0, x0=3.6, x1=7.0, depth=1.5, screen=False, tile="tile_grey")
pass  # (cottage pass) removed: H.piece(1, "boots", DE.boots_pair, 6.35, 0.65, 0.0, 0.25, co
H.piece(1, "basket", DE.basket, 3.85, 1.15, 0.0, 0.0, r=0.24, h=0.35, tn=(0.85, 0.7, 0.45, 1))
pass  # (cottage pass) removed: H.piece(1, "garlic", DE.garlic_braid, 6.45, 0.09, 1.6, 0.0, 
H.piece(1, "hooks", FX.wall_hooks, 3.85, 0.01, 1.5, 0.0, n=3, spacing=0.22)

# kitchen run on the back wall: fridge, sink under the window, gas range, hood, upper cabinets; dish cabinet by the second window
H.piece(1, "fridge", KI.fridge_double, 0.52, 7.4, 0.0, PI)
H.piece(1, "sinkrun", KI.counter_base, 3.04, 7.5, 0, PI, length=4.08, d=0.6, sink=True, top="oak", door_tn=CREAM, tile_back=False)
H.piece(1, "gasrun", KI.counter_base, 5.7, 7.5, 0, PI, length=1.2, d=0.6, cook="gas", top="oak", door_tn=CREAM)
H.piece(1, "hood", KI.hood, 5.7, 7.55, 0, PI)
H.piece(1, "upper", KI.upper_cabinets, 1.4, 7.63, 0, PI, length=0.7, door_tn=CREAM)  # window alignment 2026-11-27: was x 1.65 l 1.2
H.piece(1, "upper", KI.upper_cabinets, 4.45, 7.63, 0, PI, length=1.1, door_tn=CREAM)
H.piece(1, "dishes", ST.cabinet_glass, 0.22, 3.65, 0, PI / 2, w=1.1)  # window alignment 2026-11-27: was x 8.55 (the back-right window)
P(1, "kettle", "kettle", 1.4, 7.55, 0.9)
P(1, "bowl", "bowl_p", 4.35, 7.5, 0.9)
P(1, "plates", "plates_stack", 4.7, 7.5, 0.9)
pass  # (cottage pass) removed: P(1, "pan", "pan", 5.88, 7.5, 0.9, PI)
P(1, "pot", "kettle", 5.45, 7.5, 0.9)
# left wall: dish cabinet in the front corner, kimchi fridge
H.piece(1, "cabinet", ST.mungap, 0.2, 1.1, 0, PI / 2, w=0.9)
H.piece(1, "kimchi", KI.fridge_kimchi, 0.4, 6.45, 0, PI / 2)  # window alignment 2026-11-27: was z 2.35
P(1, "kbasket", "leaf_pot", 0.35, 6.45, 1.1)
# the table: six different farm chairs
H.piece(1, "dtable", TA.table_dining_rect, 5.3, 5.05, 0, PI / 2, w=1.9, d=0.95, legs="square")
for i, x in enumerate((4.7, 5.3, 5.9)):
    H.piece(1, "fchair", SE.chair_farm, 4.6, 4.45 + 0.6 * i, 0, PI / 2, variant=i)
for i, x in enumerate((4.7, 5.3, 5.9)):
    H.piece(1, "fchair", SE.chair_farm, 6.0, 4.45 + 0.6 * i, 0, -PI / 2, variant=i + 3)
for i, x in enumerate((4.75, 5.3, 5.85)):
    H.piece(1, "pend", DE.pendant_dome, 5.3, 4.45 + 0.6 * i, 3.7, 0.0, drop=1.5, r=0.2, cols=False)
P(1, "fruit", "fruit_bowl", 5.3, 5.05, 0.74)
P(1, "kcups", "mug_p", 5.05, 4.5, 0.74)
P(1, "kcups", "mug_p", 5.55, 5.6, 0.74)
P(1, "kplate", "plate", 5.05, 5.65, 0.74)
P(1, "kplate", "plate", 5.55, 4.45, 0.74)
P(1, "kteapot", "teapot", 5.3, 5.4, 0.74)
# window platform (평상) with cushions
H.piece(1, "pyeong", SE.pyeongsang, 2.6, 0.58, 0, 0.0, w=1.8, d=1.0)
H.piece(1, "pcush", DE.basket, 1.95, 0.62, 0.36, 0.0, r=0.17, h=0.12, tn=(0.9, 0.65, 0.45, 1), cols=False)
P(1, "ptea", "teapot", 3.1, 0.55, 0.36)
P(1, "pcup", "teacup", 3.3, 0.7, 0.36)
P(1, "pbook", "books3", 2.3, 0.4, 0.36, 0.5)
# right front: chest with kitchen things, plants on the windowsill side
H.piece(1, "chest", ST.banndaji, 7.55, 0.3, 0, 0.0, w=0.95)
P(1, "chbasket", "leaf_pot", 7.35, 0.3, 0.85)
P(1, "chjar", "vase_small", 7.85, 0.3, 0.85)
pass  # (cottage pass) removed the monstera: the east chairs need the floor
H.piece(1, "art", DE.frame_art, 9.1, 0.04, 1.6, 0.0, w=0.5, h=0.4, art=2, cols=False) if False else None

# ================================================================================================ floor 2 ======
sp2 = HA.spec(H, 2)
ops2 = HA.ops_windows(sp2)
HA.merge(ops2, dict(front=[dict(s0=6.2, s1=7.0, y0=0.0, y1=2.13)]))
wins2, curt2 = HA.add_windows(sp2, curtain=("left", "back", "front"), curtain_kw=dict(folds=9, tn=(0.95, 0.88, 0.7, 1)))
H.shell(2, ops=ops2, wall_tn=WALL2, windows=wins2, curtains=curt2, floor_kind="oak", floor_tn=(0.95, 0.88, 0.8, 1),
        lights=((2.4, 2.4), (2.6, 5.0), (6.0, 3.6), (6.2, 6.0)),
        fixtures=[lambda fr: SH.bath_door(fr["front"][0], 6.2, 7.0, 2.1)])
# guest area (left): quilt chest + pile, low table with two floor cushions, low bookshelf
H.piece(2, "closet", ST.wardrobe_wood, 0.3, 0.9, 0, PI / 2, w=1.2)
pass  # (cottage pass) removed: H.piece(2, "futon", FX.futon_stack, 0.5, 2.2, 0, PI / 2, w=1
H.piece(2, "rug", DE.rug_rect, 2.5, 4.6, 0, 0.0, w=2.2, d=1.9, cols=False, tn=(0.86, 0.72, 0.55, 1), border_tn=(0.6, 0.4, 0.3, 1), fringe=False)
H.piece(2, "table", TA.table_low, 2.6, 4.6, 0, 0.0, w=1.2, d=0.7)
H.piece(2, "cush", SE.bangseok, 2.6, 3.8, 0, 0.0, tn=PAL["rug_red"])
H.piece(2, "cush", SE.bangseok, 2.6, 5.4, 0, PI, tn=PAL["sofa_navy"])
H.piece(2, "tea", DE.tea_set, 2.6, 4.6, 0.35, 0.0, cols=False)
P(2, "tbook", "books3", 2.1, 4.5, 0.35, 0.4)
H.piece(2, "lowshelf", ST.bookcase, 1.3, 7.6, 0, PI, w=1.2, h=1.0, shelves=2)
P(2, "shelfvase", "vase_small", 1.0, 7.65, 1.0)
H.piece(2, "orchid", DE.plant_orchid, 1.65, 7.65, 1.0, cols=False)
# sitting corner (right of the guest area): two-seat sofa between the front windows
H.piece(2, "sofa", SE.sofa_2seat, 4.85, 1.35, 0, 0.0, w=1.7, tn=(0.85, 0.7, 0.4, 1), pillow_tn=(0.55, 0.65, 0.5, 1))
H.piece(2, "plant", FX.plant_palm, 7.3, 5.4)
H.piece(2, "lamp", DE.floor_lamp, 6.75, 0.5)  # window alignment 2026-11-27: the sofa stands clear of the shell's upstairs patio door (was z 0.55, lamp x 6.0)
H.piece(2, "art", DE.frame_art, 3.2, 0.04, 1.65, 0.0, w=0.6, h=0.45, art=1, cols=False)
H.piece(2, "art", DE.frame_art, 0.04, 4.3, 1.8, PI / 2, w=0.5, h=0.65, art=2, cols=False) if False else None
H.piece(2, "clock", DE.wall_clock, 0.04, 6.4, 1.9, PI / 2, cols=False)
H.piece(2, "basket", DE.basket, 6.9, 2.6, 0.0, 0.0, r=0.25, h=0.35, tn=(0.85, 0.7, 0.45, 1))

# ---- realism pass 2026-11-17 (refs: rural kitchens on Naver blogs, Jeju farmhouse dining): the counter's daily things, appliances ---------
pass  # (cottage pass) removed: H.piece(1, "rack", KR.dish_rack, 3.95, 7.47, 0.9, PI, cols=F
pass  # (cottage pass) removed: H.piece(1, "rice", KR.rice_cooker, 1.85, 7.47, 0.9, PI, cols
pass  # (cottage pass) removed: H.piece(1, "purif", KR.water_purifier, 2.25, 7.52, 0.9, PI, 
pass  # (cottage pass) removed: H.piece(1, "micro", KR.microwave, 8.55, 7.55, 1.75, PI, cols
H.piece(1, "mats", KR.placemats, 5.3, 5.05, 0.745, PI / 2, cols=False, spots=[(-0.6, -0.27, 0.0), (0.0, -0.27, 0.0), (0.6, -0.27, 0.0), (-0.6, 0.27, 0.0), (0.0, 0.27, 0.0), (0.6, 0.27, 0.0)],
        tn=(0.72, 0.62, 0.48, 1))
pass  # (cottage pass) removed: H.piece(1, "aircon", KR.aircon_stand, 0.35, 5.05, 0, PI / 2)
pass  # (cottage pass) removed: H.piece(1, "slippers", KR.slippers, 4.0, 1.75, 0.0, 0.0, col
pass  # (cottage pass) removed: H.piece(1, "umbrella", KR.umbrella_stand, 6.75, 1.2, 0.0, 0.
pass  # (cottage pass) removed: H.piece(2, "aircon", KR.aircon_wall, 1.2, 7.8, 2.25, PI, col
H.piece(2, "tvstand", TA.tv_stand, 5.1, 7.55, 0, PI, w=1.4, tn=(0.62, 0.45, 0.3, 1))
H.piece(2, "tv", TA.tv_wall, 5.1, 7.78, 0.95, PI, w=1.2, cols=False)
pass  # (cottage pass) removed: H.piece(2, "settop", KR.settop, 4.6, 7.55, 0.45, PI, cols=Fa
H.piece(2, "rug2", DE.rug_rect, 4.85, 3.3, 0, 0.0, w=2.0, d=1.4, cols=False, tn=(0.82, 0.74, 0.6, 1), border_tn=(0.55, 0.42, 0.3, 1), fringe=False)
H.piece(2, "coffee", TA.table_coffee_rect, 4.85, 3.45, 0, 0.0, w=1.0, d=0.5)
P(2, "cmag", "magazine", 4.6, 2.7, 0.4, 0.3)
P(2, "cfruit", "fruit_bowl", 5.05, 2.75, 0.4)
pass  # (houses-real 2: a flat board over the new rolled arm) removed: H.piece(2, "throw", KR.throw_draped, 4.05, 0.55, 0.62, -PI / 2, cols=False, w=0.45, top_d=0.16, drop_front=0.34, drop_back=0.12, tn=(0.72, 0.5, 0.35, 1))
H.piece(2, "drawers", KR.chest_drawers, 7.6, 0.3, 0, 0.0, w=1.0, tn=(0.7, 0.52, 0.36, 1))
P(2, "drframe", "frame_small", 7.4, 0.3, 0.875, 0.0)
P(2, "drbooks", "books3", 7.85, 0.3, 0.875, 0.3)
pass  # (cottage pass) removed: H.piece(2, "purifier", KR.air_purifier, 8.6, 1.0)

# ---- dream show-home styling (owner 2026-11-17): fresh flowers, styled tables, lamps and sconces, a console vignette --------
H.piece(1, "flowers", KR.flower_vase, 5.3, 5.55, 0.745, 0.0, cols=False, tn=(0.98, 0.84, 0.35, 1), kind="tulip", h=0.28)
H.piece(2, "cstyle", KR.coffee_styling, 4.85, 3.45, 0.4, 0.0, cols=False, tn=(0.95, 0.82, 0.45, 1))

H.piece(1, "view", FX.view_band, 0, 0, 0, 0, cols=False, seats=False, house=3)
H.piece(2, "view", FX.view_band, 0, 0, 0, 0, cols=False, seats=False, house=3)

H.piece(2, "part_a", FX.part_wall, 3.8, 0.0, 0, -PI / 2, length=6.0, openings=[(3.4, 5.2, 2.6)], tn=WALL2)
H.piece(2, "tpend", DE.pendant_dome, 2.5, 4.6, 3.7, 0.0, drop=1.5, r=0.2, cols=False)
H.piece(2, "spend", DE.pendant_globe, 6.0, 2.5, 3.7, 0.0, drop=1.5, r=0.16, cols=False)

problems = H.finish()

CAMS = [
    dict(name="1f_entry", floor=1, eye=[5.3, 0.45, 1.3], look=[4.8, 5.5, 1.2], lens=16),
    dict(name="1f_kitchen", floor=1, eye=[7.4, 2.6, 1.3], look=[2.6, 7.4, 1.1], lens=16),
    dict(name="1f_table", floor=1, eye=[2.4, 2.3, 1.25], look=[6.2, 5.3, 0.9], lens=16),
    dict(name="1f_window", floor=1, eye=[6.2, 3.3, 1.3], look=[1.6, 0.4, 0.7], lens=16),
    dict(name="2f_guest", floor=2, eye=[1.0, 1.3, 1.3], look=[2.8, 5.2, 0.6], lens=16),
    dict(name="2f_sofa", floor=2, eye=[6.2, 5.6, 1.3], look=[4.6, 0.6, 0.8], lens=16),
    dict(name="2f_well", floor=2, eye=[6.6, 2.2, 1.3], look=[9.8, 6.0, 0.2], lens=16),
]
json.dump(CAMS, open(os.path.join(K.WORK, "house_3_cams.json"), "w"), indent=1)
H.save(os.path.join(K.WORK, "house_3_authoring.blend"))
