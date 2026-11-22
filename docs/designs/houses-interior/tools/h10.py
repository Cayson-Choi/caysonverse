"""10번 집 (흰) 난로 오두막 - 장작 난로 거실 + 2층 다락 침실, 계단 C.   blender -b --factory-startup -P art/village/tools/houses/h10.py
1층: 판재(루버) 벽, 무쇠 장작 난로(내화 벽돌 받침 + 연통), 장작 더미·바구니·도끼 그루터기, 가죽 3인 소파, 흔들의자, 통나무 벤치, 체크 러그.
2층: 한쪽 경사 천장(2.9 m), 더블 침대(양쪽 가장자리), 창가 좌석(뒤가 창), 트렁크.
좌석 1층 등 4 · 무 2 / 2층 무 4 (계약 HOUSE_SEAT_PLAN)."""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hb_common as HB  # noqa: E402
import kit_real as KR  # noqa: E402
import kit_shell as SH  # noqa: E402
import hb_pieces as HP  # noqa: E402
import hb_cabin as CB  # noqa: E402
import hb_cafe as CA  # noqa: E402
import kit_core as K  # noqa: E402
import kit_seating as SE  # noqa: E402
import kit_tables as TA  # noqa: E402
import kit_decor as DE  # noqa: E402
import kit_beds as BE  # noqa: E402
import kit_storage as ST  # noqa: E402
from kit_core import PAL  # noqa: E402

PI = math.pi
H = HB.House(10)
PINE_WALL = (1.0, 0.93, 0.82, 1)
WOOD_TRIM = (0.5, 0.34, 0.22, 1)
FLOOR_TN = (0.85, 0.66, 0.5, 1)
LOG_WALL = (0.96, 0.93, 0.86, 1)    # cottage pass: warm linen limewash, oak beams (no more log walls)

# ============================================================================================== floor 1: 난로 거실 ===
win1 = HB.ext_windows(H, 1, w=1.4, style="grid", cols=2, rows=2, drape=("curtain", dict(folds=6, tn=(0.62, 0.3, 0.25, 1), tie=0.4)))
# realism pass 2026-11-17 (refs: unsplash log cabins with a wood stove / a fieldstone fireplace): round-log walls (H_logwall: 9 logs per
# 2.5 m, chinking, checks), a pine board ceiling on exposed timber beams instead of the flat orange louvre box
def cabin_ceiling(F, hole):
    SH.ceiling(F, 10.6, 7.8, 3.7, hole=hole, m="H_wood_pine", tn=(0.9, 0.78, 0.6, 1), lights=((5.3, 1.6), (6.4, 4.2)))
    KR.beams(F, y=3.7, step=1.75, skip=hole, tn=(0.42, 0.28, 0.18, 1))


HB.hb_mats.use_wallpaper(10)
HB.room(H, 1, floor_kind="oak", floor_tn=FLOOR_TN, wall_tn=LOG_WALL, wall_m="H_wallpaper", trim_tn=WOOD_TRIM, casing_tn=WOOD_TRIM, windows=win1, entry=True, bath=dict(wall="front", c=1.0),
        entry_kind="tile_grey", ceiling="custom", ceiling_fn=cabin_ceiling)
HB.entry_hall(H)
HB.stairs(H)

# --- fireplace wall (left): a fieldstone chimney breast to the ceiling, the sofa faces it; firewood, basket, rocking chair
H.piece(1, "fireplace", KR.stone_fireplace, 0.0, 5.9, 0, PI / 2, w=1.9, d=0.55)
H.piece(1, "mantel", KR.mantel_props, 0.33, 5.9, 1.37, PI / 2, cols=False, w=1.7)
H.piece(1, "fpart", DE.frame_art, 0.48, 5.9, 1.95, PI / 2, cols=False, w=0.8, h=0.55, art=1)
H.piece(1, "firewood", DE.firewood_pile, 0.3, 7.38, 0, PI / 2, w=0.7, h=0.6)
pass  # (cottage pass) the log basket stood in front of the sofa end
H.piece(1, "rocker", SE.rocking_chair, 1.6, 7.15, 0, 2.66)   # (realism pass) in the fireplace corner, turned to the fire and the sofa
# --- sofa facing the stove, check rug, coffee table, lamp, side table
H.piece(1, "rug", DE.rug_check, 3.1, 5.9, 0, PI / 2, w=2.4, d=1.8, cols=False)
H.piece(1, "sofa", HP.sofa_leather_n, 3.95, 5.9, 0, -PI / 2, n=3, w=2.1, tn=PAL["leather_brown"])
H.piece(1, "side", TA.bedside, 3.95, 7.5, 0, PI)
H.piece(1, "lamp", DE.table_lamp, 3.95, 7.5, 0.55, 0.0)
# --- log bench (left wall front) + hook board with jackets
H.piece(1, "bench", SE.bench_log, 0.4, 1.2, 0, PI / 2, l=1.4)
H.piece(1, "hooks", CB.hook_board, 3.47, 0.8, 1.6, -PI / 2, cols=False, w=1.0)
pass  # (cottage pass) removed: H.piece(1, "boots", DE.boots_pair, 0.5, 0.4, 0.0, 0.2, cols=
pass  # (cottage pass) removed: H.piece(1, "block", CB.chopping_block, 7.6, 1.0, 0, 0.0)
H.piece(1, "frame1", DE.frame_art, 7.13, 0.75, 1.55, PI / 2, cols=False, w=0.7, h=0.5, art=1)
H.piece(1, "clock", DE.wall_clock, 8.6, 7.79, 2.15, PI, cols=False)
H.piece(1, "snake", DE.plant_snake, 0.5, 3.0, 0, 0.0)
H.piece(1, "lantern", DE.table_lamp, 7.9, 3.2, 0.5, 0.0, cols=False)
H.piece(1, "trunkprops", HP.props_table, 7.9, 3.2, 0.5, 0.0, cols=False, top=0.0, seed=21, w=0.7)
H.piece(1, "bask2", DE.basket, 4.5, 4.55, 0, 0.0, r=0.25, h=0.3)
# --- right zone: bookcase on the back wall, chest, plants
H.piece(1, "case", HP.bookwall_lite, 8.6, 7.63, 0, PI, w=1.0, h=2.0, d=0.3, seed=101)
H.piece(1, "trunk", ST.trunk, 7.9, 3.2, 0, 0.0, w=1.0, d=0.55, h=0.5)
H.piece(1, "plant", HP.plant_big, 5.85, 7.3, 0, 0.0, kind="fiddle", h=1.35, leaves=28)
H.piece(1, "plant2", HP.plant_big, 6.9, 5.2, 0, 0.0, kind="monstera", h=1.0)

# ============================================================================================== floor 2: 다락 침실 ===
win2 = HB.ext_windows(H, 2, w=1.4, style="grid", cols=2, rows=2, drape=("curtain", dict(folds=6, tn=(0.62, 0.3, 0.25, 1), tie=0.4)),
                      over={("left", HB.EXT_SIDE): dict(w=1.7, y0=0.95)})
HB.room(H, 2, floor_kind="oak", floor_tn=FLOOR_TN, wall_tn=LOG_WALL, wall_m="H_wallpaper", trim_tn=WOOD_TRIM, casing_tn=WOOD_TRIM, windows=win2, bath=dict(wall="front", c=1.0),
        ceiling="custom", ceiling_fn=lambda F, hole: HB.ceiling_slope(F, hole, side="left", run=3.4, low=2.9, tn=(1.0, 0.95, 0.85, 1), lights=((6.5, 2.4), (6.5, 5.4))))
H.piece(2, "rug", DE.rug_check, 5.3, 4.0, 0, 0.0, w=2.6, d=1.8, cols=False)
H.piece(2, "bed", BE.bed_queen, 5.3, 6.64, 0, PI, tn=PAL["rug_red"], headboard="panel")
H.piece(2, "bedside", TA.bedside, 4.0, 7.57, 0, PI)
H.piece(2, "bedside", TA.bedside, 6.6, 7.57, 0, PI)
H.piece(2, "lamp", DE.table_lamp, 4.0, 7.57, 0.55, 0.0)
H.piece(2, "lamp", DE.table_lamp, 6.6, 7.57, 0.55, 0.0)
H.piece(2, "trunk", ST.trunk, 5.3, 5.2, 0, 0.0, w=1.1, d=0.5, h=0.45)
H.piece(2, "windowseat", BE.window_seat, 0.3, 4.13, 0, PI / 2, w=1.6, d=0.5)
H.piece(2, "wardrobe", ST.wardrobe_wood, 0.3, 5.7, 0, PI / 2, w=1.2, d=0.55, h=1.9)
H.piece(2, "plant", HP.plant_big, 3.9, 0.6, 0, 0.0, kind="monstera", h=1.15)
H.piece(2, "pendant", DE.pendant_globe, 5.3, 4.0, 3.7, 0.0, cols=False, drop=1.0, r=0.13)
H.piece(2, "frame", DE.frame_art, 5.3, 7.78, 1.75, PI, cols=False, w=0.8, h=0.55, art=1)
pass  # (cottage pass) removed: H.piece(2, "boots", DE.boots_pair, 7.4, 0.5, 0.0, 0.4, cols=
H.piece(2, "case", HP.bookwall_lite, 6.6, 0.2, 0, 0.0, w=0.95, h=1.1, d=0.3, seed=111, shelves=3)
H.piece(2, "lamp_f", DE.floor_lamp, 0.5, 2.3)
H.piece(2, "rug_w", DE.rug_rect, 1.9, 4.1, 0, PI / 2, w=1.8, d=1.1, cols=False, fringe=False, tn=PAL["rug_red"])
H.piece(2, "clock", DE.wall_clock, 3.5, 7.79, 2.0, PI, cols=False)

# ---- realism pass 2026-11-17: the cabin's lived-in things ------------------------------------------------------------------------
H.piece(1, "throw", KR.throw_draped, 4.38, 5.3, 0.8, -PI / 2, cols=False, w=0.6, top_d=0.16, drop_front=0.3, drop_back=0.42, tn=(0.62, 0.3, 0.25, 1))
H.piece(1, "lamp_f", DE.floor_lamp, 0.5, 2.55)
pass  # (cottage pass) removed: H.piece(1, "slippers", KR.slippers, 6.55, 1.15, 0.0, -PI / 2
H.piece(1, "cstack", KR.throw_folded, 2.9, 7.05, 0.42, 0.3, cols=False, w=0.4, d=0.3, layers=3, tn=(0.75, 0.68, 0.55, 1)) if False else None
H.piece(2, "throw", KR.throw_folded, 5.3, 5.95, 0.56, 0.0, cols=False, w=1.4, d=0.42, layers=2, tn=(0.85, 0.8, 0.7, 1))
H.piece(2, "drawers", KR.chest_drawers, 9.0, 0.3, 0, 0.0, w=0.9, h=0.74, rows=3, tn=(0.6, 0.42, 0.28, 1))

# ---- dream show-home styling (owner 2026-11-17): fresh flowers, styled tables, lamps and sconces, a console vignette --------
H.piece(1, "cstyle", KR.coffee_styling, 7.9, 3.2, 0.5, 0.0, cols=False, tn=(0.78, 0.45, 0.32, 1))
H.piece(2, "sconce", KR.wall_sconce, 4.0, 7.8, 1.5, PI, cols=False)
H.piece(2, "sconce", KR.wall_sconce, 6.6, 7.8, 1.5, PI, cols=False)

VIEWS = [
    dict(name="f1_entry", floor=1, eye=[5.3, 0.55, 1.35], look=[3.5, 6.0, 1.3], lens=17),
    dict(name="f1_stove", floor=1, eye=[5.6, 3.4, 1.2], look=[1.5, 6.4, 1.1], lens=20),
    dict(name="f1_sofa", floor=1, eye=[1.8, 2.2, 1.2], look=[4.2, 6.2, 0.9], lens=20),
    dict(name="f1_right", floor=1, eye=[5.4, 4.0, 1.3], look=[8.8, 6.2, 1.1], lens=20),
    dict(name="f1_stair", floor=1, eye=[6.0, 5.2, 1.3], look=[10.2, 2.4, 1.6], lens=18),
    dict(name="f2_stairtop", floor=2, eye=[6.2, 5.0, 1.3], look=[9.6, 3.6, 1.0], lens=18),
    dict(name="f2_bed", floor=2, eye=[5.3, 1.6, 1.2], look=[5.3, 7.2, 0.9], lens=20),
    dict(name="f2_seat", floor=2, eye=[5.0, 3.0, 1.2], look=[0.3, 4.1, 0.9], lens=20),
]

HB.done(H, VIEWS)
