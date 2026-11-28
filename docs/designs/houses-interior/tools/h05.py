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
import kit_real as KR  # noqa: E402

PAL = K.PAL
PI = math.pi
H = HC.House(5)
H.pull_body = 0.49        # room for the game's 0.45 m body in front of each dining chair
FX.set_house(5)
P = HA.prop_fn(H)

MINT = (0.82, 0.9, 0.82, 1)        # cottage pass: sage limewash (the mint house)
RED = (0.78, 0.35, 0.33, 1)
NAVY = (0.3, 0.38, 0.55, 1)
GOLD = (0.88, 0.7, 0.3, 1)
GRN = (0.45, 0.6, 0.45, 1)
CREAM = (0.95, 0.92, 0.8, 1)


def face_center(cx, cz, x, z):
    return math.atan2(cx - x, cz - z)


# ================================================================================================ floor 1 ======
# sunroom: two big front windows (wider, nearly to the ceiling), normal side windows, back-left window; the back-right one hides behind stair A
sp1 = HA.spec(H, 1)   # window alignment 2026-11-27: the shell's windows (the sunroom's front glass was 2.4 m wide, 0.5..3.0: the shell's are 1.4 m)
ops = HA.ops_windows(sp1)
HA.merge(ops, dict(front=[dict(s0=4.4, s1=6.2, y0=0.0, y1=2.9)]))
wins, curt = HA.add_windows(sp1, cols=3, rows=2, curtain=("front", "left", "right"), curtain_kw=dict(folds=9, tn=(0.97, 0.97, 0.94, 1)))
H.shell(1, ops=ops, wall_tn=MINT, floor_kind="tile_grey", floor_tn=(1.0, 0.95, 0.85, 1), windows=wins, curtains=curt,
        lights=((2.6, 2.8), (2.6, 5.4), (8.0, 1.8), (8.0, 4.0), (5.3, 1.4)),
        fixtures=[lambda fr: SH.entry_door(fr["front"][0], 4.4, 6.2, 2.9)])
H.stairs()
H.well_shaft()
H.piece(1, "shaft", FX.stair_shaft, 0, 0, 0, 0, hole=H.hole(), cols=False)
H.piece(1, "entry", FX.genkwan, 0, 0, 0, 0, x0=3.6, x1=7.0, depth=1.5, screen=False, tile="tile_grey")
H.piece(1, "tools", DE.basket, 6.7, 1.0, 0.0, 0.0, r=0.2, h=0.3, tn=(0.8, 0.65, 0.45, 1))
P(1, "tpot", "leaf_pot", 6.7, 1.0, 0.3)
H.piece(1, "hooks", FX.wall_hooks, 3.8, 0.01, 1.5, 0.0, n=3, spacing=0.2)

# living group (rattan): sofa faces the front windows, two chairs across a low table, jute rug
H.piece(1, "rug", DE.rug_round, 2.4, 3.6, 0, 0.0, d=2.8, cols=False, tn=(0.85, 0.74, 0.55, 1))
H.piece(1, "sofa", SE.sofa_rattan, 2.4, 4.75, 0, PI, w=1.7, d=0.85, seats=2)
H.piece(1, "coffee", TA.table_coffee_rect, 2.4, 2.5, 0, 0.0, w=1.0, d=0.55)
H.piece(1, "chair", SE.armchair_rattan, 0.95, 3.4, 0, PI / 2)
H.piece(1, "chair", SE.armchair_rattan, 0.95, 1.6, 0, PI / 2)
P(1, "tmag", "magazine", 2.2, 2.5, 0.4, 0.3)
P(1, "tpot2", "leaf_pot", 2.7, 2.55, 0.4)
P(1, "tcup", "teacup", 2.5, 2.4, 0.4)
H.piece(1, "pill", DE.plant_orchid, 2.0, 2.5, 0.4, 0.0, cols=False)
# dining (right): round table, four cane chairs
dx, dz = 8.5, 2.9
H.piece(1, "dtable", TA.table_dining_round, dx, dz, 0, 0.0, d=1.1)
for k in range(4):
    a = k * PI / 2          # (owner 2026-11-17) chairs on the axes: pulled out, each keeps its own front
    x, z = dx + 1.0 * math.cos(a), dz + 1.0 * math.sin(a)
    H.piece(1, "dchair", SE.chair_rattan_dining, x, z, 0, face_center(dx, dz, x, z), **({"pull_body": 0.56} if k in (2, 3) else {}))
H.piece(1, "pend", DE.pendant_globe, dx, dz, 3.7, 0.0, drop=1.5, r=0.16, cols=False)
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
pass  # (window alignment: no wall left for it between the chairs and the windows) removed: H.piece(1, "monstera", FX.plant_monstera_full, 0.65, 5.3, seed=12)  # window alignment 2026-11-27: was z 5.3
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
sp2 = HA.spec(H, 2)
ops2 = HA.ops_windows(sp2)
HA.merge(ops2, dict(front=[dict(s0=6.5, s1=7.4, y0=0.0, y1=2.13)]))   # bathroom door (window alignment: was 4.4..5.3, behind the shell's middle window)
wins2 = [(w, c - wd / 2, c + wd / 2, y0, y1, dict(style="grid", cols=2, rows=2)) for w, lst in sp2.items() for (c, wd, y0, y1) in lst]
H.shell(2, ops=ops2, wall_tn=(0.86, 0.91, 0.84, 1), floor_kind="oak", floor_tn=(0.96, 0.94, 0.9, 1), windows=wins2,
        lights=((3.2, 2.6), (3.2, 5.2), (8.0, 2.4), (7.8, 4.8)),
        fixtures=[lambda fr: SH.bath_door(fr["front"][0], 6.5, 7.4, 2.1)])
tx, tz = 3.2, 3.2
H.piece(2, "rug", DE.rug_rect, tx, tz, 0, 0.0, w=3.0, d=2.6, cols=False, tn=(0.82, 0.78, 0.65, 1), border_tn=(0.45, 0.4, 0.3, 1), fringe=False)
H.piece(2, "table", TA.table_low, tx, tz, 0, 0.0, w=1.4, d=0.8)
for (x, z, tn_) in ((tx - 0.45, tz - 0.85, RED), (tx + 0.45, tz - 0.85, NAVY), (tx - 0.45, tz + 0.85, GOLD), (tx + 0.45, tz + 0.85, GRN)):
    H.piece(2, "cushion", SE.bangseok, x, z, 0, face_center(tx, tz, x, z), tn=tn_)
H.piece(2, "tea", DE.tea_set, tx, tz, 0.35, 0.0, cols=False)
P(2, "tp", "teapot", tx + 0.4, tz + 0.1, 0.35)
P(2, "tc", "teacup", tx - 0.4, tz - 0.15, 0.35)
pass  # (cottage pass) removed: H.piece(2, "lantern", DE.hanji_lantern, tx, tz, 2.9, 0.0, dr
H.piece(2, "teacab", ST.mungap, 0.25, 5.7, 0, PI / 2, w=0.9)
H.piece(2, "orchid", DE.plant_orchid, 0.25, 5.5, 0.6, 0.0, cols=False)
H.piece(2, "teabox", DE.tea_set, 0.25, 5.95, 0.6, 0.0, cols=False)
pass  # (cottage pass) removed: H.piece(2, "scroll", ST.scroll_hanging, 0.04, 5.2, 0.9, PI /
pass  # (cottage pass) removed: H.piece(2, "scroll", ST.scroll_hanging, 0.04, 6.3, 0.9, PI /
for (c, wd, _y0, _y1) in sp2["front"]:
    pass
H.piece(2, "bamboo", SH.blind_bamboo, 0, 0, 0, 0, cols=False, **{}) if False else None
H.piece(2, "bed", BE.bed_single, 9.5, 1.9, 0, -PI / 2, tn=(0.6, 0.78, 0.7, 1))
HA.drop_seat(H, 2, "bed", "min_lz")
H.piece(2, "bedside", TA.bedside, 10.3, 0.7, 0, -PI / 2)
H.piece(2, "tlamp", DE.table_lamp, 10.3, 0.7, 0.55, 0.0, cols=False)
H.piece(2, "plant", FX.plant_olive_full, 9.8, 3.75, seed=21)  # window alignment 2026-11-27: was z 5.3
H.piece(2, "plant2", FX.plant_monstera_full, 6.65, 0.6, seed=14)
H.piece(2, "boughs", DE.vase_branch, 8.0, 0.2, 0.0, 0.0, cols=False) if False else None
H.piece(2, "art", DE.frame_art, 10.56, 1.9, 1.7, -PI / 2, w=0.7, h=0.5, art=2, cols=False)
H.piece(2, "tealamp", DE.floor_lamp, 5.8, 5.4)

# ---- realism pass 2026-11-17 (refs: ohou.se plant rooms, a tea room with floor seating, a wicker sunroom): the gardener's things -------
H.piece(1, "can", KR.watering_can, 6.25, 1.05, 0.0, 0.4, cols=False)
H.piece(2, "ladder", KR.plant_ladder, 0.0, 3.65, 0, PI / 2, w=0.7, h=1.4)  # window alignment 2026-11-27: was z 2.1
pass  # (cottage pass) removed: H.piece(1, "aircon", KR.aircon_stand, 1.75, 7.55, 0, PI)
H.piece(1, "throw", KR.throw_draped, 2.4, 5.1, 0.78, PI, cols=False, w=0.5, top_d=0.12, drop_front=0.32, drop_back=0.2, tn=(0.88, 0.85, 0.76, 1)) if False else None
H.piece(1, "mats", KR.placemats, dx, dz, 0.74, 0.0, cols=False, table=("round", 0.55), spots=[(0.33, 0.0, PI / 2), (-0.33, 0.0, PI / 2), (0.0, 0.33, 0.0), (0.0, -0.33, 0.0)],
        tn=(0.82, 0.76, 0.6, 1))
pass  # (cottage pass) removed: H.piece(1, "slippers", KR.slippers, 4.0, 1.75, 0.0, 0.0, col
pass  # (cottage pass) removed: H.piece(2, "aircon", KR.aircon_wall, 1.45, 7.8, 2.4, PI, col
H.piece(2, "wardrobe", ST.wardrobe_wood, 7.53, 1.05, 0, PI / 2, w=1.2, d=0.55, h=1.9)
H.piece(2, "throw", KR.throw_folded, 8.85, 1.9, 0.56, -PI / 2, cols=False, w=0.9, d=0.4, layers=2, tn=(0.8, 0.86, 0.8, 1))
pass  # (cottage pass) removed: H.piece(2, "purifier", KR.air_purifier, 6.8, 6.0)

# ---- dream show-home styling (owner 2026-11-17): fresh flowers, styled tables, lamps and sconces, a console vignette --------
H.piece(1, "flowers", KR.flower_vase, 8.65, 2.9, 0.74, 0.0, cols=False, tn=(0.96, 0.96, 0.92, 1), kind="tulip", h=0.26, glass=True)
H.piece(1, "cstyle", KR.coffee_styling, 2.4, 2.5, 0.4, 0.0, cols=False, tn=(0.62, 0.74, 0.58, 1))

H.piece(1, "view", FX.view_band, 0, 0, 0, 0, cols=False, seats=False, house=5)
H.piece(2, "view", FX.view_band, 0, 0, 0, 0, cols=False, seats=False, house=5)

H.piece(2, "part_a", FX.part_wall, 7.2, 0.0, 0, -PI / 2, length=4.9, openings=[(3.0, 4.8, 2.6)], tn=(0.95, 0.93, 0.84, 1))   # ends short of the stairwell: a straight way to the landing
H.piece(2, "bedpend", DE.pendant_globe, 8.8, 3.2, 3.7, 0.0, drop=1.5, r=0.16, cols=False)

problems = H.finish()

CAMS = [
    dict(name="1f_entry", floor=1, eye=[5.3, 0.45, 1.3], look=[3.6, 5.5, 1.1], lens=16),
    dict(name="1f_living", floor=1, eye=[5.3, 2.6, 1.25], look=[1.2, 5.0, 0.8], lens=16),
    dict(name="1f_dining", floor=1, eye=[4.8, 5.8, 1.25], look=[8.8, 1.2, 0.9], lens=16),
    dict(name="1f_windows", floor=1, eye=[5.2, 6.0, 1.25], look=[3.4, 0.4, 1.4], lens=16),
    dict(name="2f_tea", floor=2, eye=[6.6, 4.2, 1.2], look=[2.4, 2.2, 0.7], lens=16),
    dict(name="2f_bed", floor=2, eye=[4.8, 4.0, 1.25], look=[10.0, 1.6, 0.9], lens=16),
    dict(name="2f_well", floor=2, eye=[2.4, 2.4, 1.3], look=[7.0, 7.0, 0.2], lens=16),
]
json.dump(CAMS, open(os.path.join(K.WORK, "house_5_cams.json"), "w"), indent=1)
H.save(os.path.join(K.WORK, "house_5_authoring.blend"))
