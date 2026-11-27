"""6번 집 (노랑) 책의 집 - 홈 라이브러리 + 침실, 계단 C.   blender -b --factory-startup -P art/village/tools/houses/h06.py
1층: 천장 높이 책장 벽(왼쪽·뒤, 창을 비켜서), 사다리, 큰 원목 책상 + 의자, 독서 안락의자 2 + 오토만 2, 2인 가죽 소파, 지구본, 스탠드 3.
2층: 더블 침대(양쪽 가장자리), 창가 붙박이 좌석(쿠션, 뒤가 창), 서서 쓰는 책상, 붙박이장, 책 선반.
좌석 1층 등 5 · 무 2 / 2층 무 4 (계약 HOUSE_SEAT_PLAN)."""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hb_common as HB  # noqa: E402
import kit_real as KR  # noqa: E402
import hb_pieces as HP  # noqa: E402
import kit_core as K  # noqa: E402
import kit_shell as SH  # noqa: E402
import kit_seating as SE  # noqa: E402
import kit_tables as TA  # noqa: E402
import kit_decor as DE  # noqa: E402
import kit_beds as BE  # noqa: E402
import kit_storage as ST  # noqa: E402
from kit_core import PAL  # noqa: E402

PI = math.pi
H = HB.House(6)
WALNUT = (0.5, 0.36, 0.3, 1)
CREAM_WALL = (0.98, 0.93, 0.78, 1)          # warm cream paint: the yellow house's library

# ============================================================================================ floor 1: library =====
HB.hb_mats.use_wallpaper(6)
WOOD_TRIM = (0.55, 0.38, 0.26, 1)
win1 = HB.ext_windows(H, 1, w=1.4, style="grid", cols=3, rows=2, drape=("curtain", dict(folds=8, tn=(0.74, 0.6, 0.38, 1))),
                      over={})
HB.room(H, 1, floor_kind="oak", wall_tn=CREAM_WALL, wall_m="H_wallpaper", trim_tn=WOOD_TRIM, casing_tn=WOOD_TRIM, ceil_tn=PAL["white"], windows=win1, entry=True, bath=dict(wall="front", c=1.0))
HB.entry_hall(H)
HB.stairs(H)

# --- walls of books (left wall + back wall, in bays between the windows)
H.piece(1, "shelf_l1", HP.bookwall_lite, 0.17, 0.85, 0, PI / 2, w=1.4, ladder=True, ladder_x=0.45, seed=11)  # window alignment 2026-11-27: the bookwalls stand between the shell's two left windows (were z 0.15..3.25 and 5.0..7.65)      # left wall z 0.15..3.25
H.piece(1, "shelf_l2", HP.bookwall_lite, 0.17, 6.75, 0, PI / 2, w=1.3, seed=21)
H.piece(1, "shelf_l3", HP.bookwall_lite, 0.17, 3.65, 0, PI / 2, w=1.0, seed=27)                                   # left wall z 5.0..7.65
H.piece(1, "shelf_b1", HP.bookwall_lite, 1.1, 7.63, 0, PI, w=1.6, seed=31)  # window alignment 2026-11-27: was x 1.35 w 1.7                                          # back wall x 0.5..2.2
H.piece(1, "shelf_b2", HP.bookwall_lite, 5.1, 7.63, 0, PI, w=2.4, seed=41)                                           # back wall x 3.9..6.3

# --- reading lounge (front left): two leather armchairs facing each other, a low round table, two ottomans, lamp
H.piece(1, "rug_l", DE.rug_rect, 2.2, 2.3, 0, 0.0, w=2.9, d=2.0, cols=False, fringe=False)
H.piece(1, "armchair", SE.armchair_reading, 0.95, 2.1, 0, PI / 2, tn=PAL["leather_tan"])
H.piece(1, "armchair", SE.armchair_reading, 3.4, 2.4, 0, -PI / 2, tn=PAL["leather_tan"])
H.piece(1, "sidetable", TA.table_coffee_round, 2.2, 1.0, 0, 0.0, d=0.62, h=0.5)
H.piece(1, "ottoman", SE.ottoman, 0.95, 4.75, 0, 0.0, tn=PAL["leather_brown"])   # (seat-front pass) a pair at the rug's far edge: the armchairs' fronts stay clear
H.piece(1, "ottoman", SE.ottoman, 2.1, 4.75, 0, 0.0, tn=PAL["leather_brown"])
H.piece(1, "lamp_l", DE.floor_lamp, 0.9, 0.7)

# --- writing desk in front of the back bookcase, chair on the room side, globe, lamp, books
H.piece(1, "desk", TA.desk, 5.1, 6.75, 0, PI, w=1.8, d=0.8, h=0.76)
H.piece(1, "deskchair", SE.chair_desk, 5.3, 5.85, 0, 0.0, tn=PAL["sofa_navy"])
H.piece(1, "desklamp", DE.table_lamp, 4.45, 6.6, 0.76, 0.5)
H.piece(1, "deskprops", HP.props_desk, 5.1, 6.75, 0, PI, cols=False, w=1.8, top=0.76, seed=5)
H.piece(1, "globe", DE.globe, 3.25, 6.5, 0, 0.0)

# --- 2-seat leather sofa facing the room (back to the stairs), table, second floor lamp, plant
H.piece(1, "rug_r", DE.rug_rect, 7.15, 3.9, 0, 0.0, w=2.2, d=1.6, cols=False)
H.piece(1, "sofa", HP.sofa_leather_n, 8.45, 3.9, 0, -PI / 2, n=2, w=1.75, tn=PAL["leather_brown"])
H.piece(1, "side", TA.bedside, 8.85, 5.15, 0, -PI / 2)
H.piece(1, "sidelamp", DE.table_lamp, 8.85, 5.15, 0.55, 0.0)
H.piece(1, "sideprops", HP.props_table, 2.2, 1.0, 0, 0.0, cols=False, top=0.5, seed=9, w=0.5)
H.piece(1, "frame1", DE.frame_art, 3.47, 0.75, 1.45, -PI / 2, cols=False, w=0.6, h=0.45, art=1)
H.piece(1, "clock", DE.wall_clock, 3.47, 1.25, 2.05, -PI / 2, cols=False)
pass  # (cottage pass) removed: H.piece(1, "boots", DE.boots_pair, 4.2, 0.35, 0.0, 0.3, cols
H.piece(1, "lamp_r", DE.floor_lamp, 8.75, 2.65)
H.piece(1, "plant", HP.plant_big, 6.75, 7.2, 0, 0.0, kind="fiddle", h=1.5, leaves=26)  # window alignment 2026-11-27: was x 8.55

# ============================================================================================== floor 2: bedroom ====
win2 = HB.ext_windows(H, 2, w=1.4, style="grid", cols=3, rows=2, drape=("curtain", dict(folds=8, tn=(0.9, 0.86, 0.74, 1))),
                      over={("left", 5.15): dict(drape=("curtain", dict(folds=8, panels=2, tn=(0.9, 0.86, 0.74, 1))))})
HB.room(H, 2, floor_kind="oak", wall_tn=CREAM_WALL, wall_m="H_wallpaper", trim_tn=WOOD_TRIM, casing_tn=WOOD_TRIM, ceil_tn=PAL["white"], windows=win2, bath=dict(wall="front", c=1.0))
H.piece(2, "bed", BE.bed, 5.3, 6.66, 0, PI, w=1.5, l=2.05, headboard="panel", tn=PAL["sage"])
H.piece(2, "bedside", TA.bedside, 4.0, 7.5, 0, PI)
H.piece(2, "bedside", TA.bedside, 6.6, 7.5, 0, PI)
H.piece(2, "lamp", DE.table_lamp, 4.0, 7.5, 0.55, 0.0)
H.piece(2, "lamp", DE.table_lamp, 6.6, 7.5, 0.55, 0.0)
H.piece(2, "rug", DE.rug_rect, 5.3, 5.6, 0, 0.0, w=2.2, d=1.5, cols=False)
H.piece(2, "windowseat", BE.window_seat, 0.3, 5.15, 0, PI / 2, w=1.6, d=0.5)  # window alignment 2026-11-27: under the shell's left window (was z 4.13)
H.piece(2, "wardrobe", ST.wardrobe_builtin, 0.32, 6.85, 0, PI / 2, w=1.7, d=0.6, h=2.4, bays=2)
H.piece(2, "desk", TA.desk, 0.4, 3.65, 0, PI / 2, w=0.9, d=0.55, h=1.0)
H.piece(2, "deskprops", HP.props_desk, 0.4, 3.65, 0, PI / 2, cols=False, w=0.9, top=1.0, seed=12)
H.piece(2, "shelf", HP.bookwall_lite, 9.95, 0.3, 0, 0.0, w=1.1, h=2.0, d=0.3, seed=61)
H.piece(2, "shelf2", HP.bookwall_lite, 0.2, 0.9, 0, PI / 2, w=1.1, h=2.3, d=0.3, seed=71)
H.piece(2, "plant", HP.plant_big, 3.9, 0.6, 0, 0.0, kind="monstera", h=1.15)
H.piece(2, "frame_a", DE.frame_art, 5.3, 7.78, 1.55, PI, cols=False, w=0.9, h=0.62, art=2)
H.piece(2, "frames", DE.frame_family, 4.35, 7.78, 1.5, PI, cols=False)
H.piece(2, "mirror", DE.mirror_round, 8.6, 7.78, 1.5, PI, cols=False, r=0.38)
H.piece(2, "rug_w", DE.rug_rect, 1.9, 4.1, 0, PI / 2, w=1.6, d=1.0, cols=False, fringe=False)

# ---- realism pass 2026-11-17 (refs: homify / library.re.kr home libraries): appliances and the lived-in things ------------------------
pass  # (cottage pass) removed: H.piece(1, "aircon", KR.aircon_stand, 9.0, 0.2, 0, 0.0)
H.piece(1, "drawers", KR.chest_drawers, 7.92, 0.3, 0, 0.0, w=1.2, h=0.74, rows=3, tn=(0.55, 0.38, 0.26, 1))
H.piece(1, "drlamp", DE.table_lamp, 7.5, 0.3, 0.765, 0.0, cols=False)
H.piece(1, "drprops", HP.props_table, 8.15, 0.3, 0, 0.0, cols=False, top=0.765, seed=13, w=0.6)
pass  # (cottage pass) removed: H.piece(1, "purifier", KR.air_purifier, 7.4, 7.3)
pass  # (cottage pass) removed: H.piece(1, "slippers", KR.slippers, 6.55, 1.15, 0.0, -PI / 2
H.piece(1, "throw", KR.throw_folded, 3.0, 3.6, 0.42, -0.2, cols=False, w=0.45, d=0.3, layers=2, tn=(0.6, 0.65, 0.55, 1)) if False else None
pass  # (cottage pass) removed: H.piece(2, "aircon", KR.aircon_wall, 5.3, 0.0, 2.3, 0.0, col
H.piece(2, "throw", KR.throw_folded, 5.3, 6.0, 0.56, 0.0, cols=False, w=1.35, d=0.42, layers=2, tn=(0.8, 0.72, 0.55, 1))
pass  # (cottage pass) removed: H.piece(2, "purifier", KR.air_purifier, 7.3, 7.45)
H.piece(2, "dressing", TA.dressing_table, 6.6, 0.3, 0, 0.0)  # window alignment 2026-11-27: was x 6.3
pass  # (cottage pass) removed: H.piece(2, "laundry", KR.laundry_basket, 1.0, 7.4)

# ---- dream show-home styling (owner 2026-11-17): fresh flowers, styled tables, lamps and sconces, a console vignette --------
H.piece(1, "flowers", KR.flower_vase, 8.35, 0.3, 0.765, 0.0, cols=False, tn=(0.86, 0.5, 0.4, 1), kind="rose", h=0.24)
H.piece(1, "cstyle", KR.coffee_styling, 2.2, 1.0, 0.5, 0.0, cols=False, tn=(0.85, 0.55, 0.42, 1))
H.piece(2, "sconce", KR.wall_sconce, 4.0, 7.8, 1.5, PI, cols=False)
H.piece(2, "sconce", KR.wall_sconce, 6.6, 7.8, 1.5, PI, cols=False)

VIEWS = [
    dict(name="f1_entry", floor=1, eye=[5.3, 0.55, 1.35], look=[4.2, 5.5, 1.35], lens=17),
    dict(name="f1_lounge", floor=1, eye=[4.9, 3.6, 1.2], look=[1.2, 2.2, 1.0], lens=20),
    dict(name="f1_desk", floor=1, eye=[2.4, 4.4, 1.3], look=[5.5, 7.0, 1.3], lens=20),
    dict(name="f1_sofa", floor=1, eye=[4.8, 1.9, 1.3], look=[8.8, 4.2, 1.0], lens=20),
    dict(name="f1_stair", floor=1, eye=[6.4, 5.4, 1.3], look=[10.3, 2.2, 1.5], lens=18),
    dict(name="f2_stairtop", floor=2, eye=[6.0, 6.7, 1.3], look=[9.4, 4.2, 1.0], lens=18),
    dict(name="f2_bed", floor=2, eye=[4.6, 1.4, 1.3], look=[5.3, 7.2, 1.0], lens=20),
    dict(name="f2_seat", floor=2, eye=[5.5, 3.6, 1.2], look=[0.4, 4.1, 0.8], lens=20),
]

HB.done(H, VIEWS)
