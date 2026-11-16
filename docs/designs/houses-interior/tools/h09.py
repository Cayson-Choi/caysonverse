"""9번 집 (분홍) 다이닝·홈카페 집 - 대면형 주방 + 8인 식탁 + 홈카페 / 2층 좌식 가족 거실 + 침실, 계단 A.   blender -b --factory-startup -P art/village/tools/houses/h09.py
1층: 왼쪽 벽 주방(양문 냉장고·인덕션·싱크·상부장·후드), 아일랜드 + 바 스툴 3(좌면 0.65), 8인 원목 식탁 + 의자 8, 펜던트, 오른쪽 벽 홈카페(머신·그라인더·머그 선반),
뒤 벽 큰 파티오창(바깥 뒤 창 자리). 2층: 바닥 소파 3, 좌탁, TV 장, 싱글 침대(열린 한 면), 옷장.
좌석 1층 등 8 · 무 3(perch) / 2층 바닥 3 · 무 1 (계약 HOUSE_SEAT_PLAN)."""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hb_common as HB  # noqa: E402
import hb_pieces as HP  # noqa: E402
import hb_cafe as CA  # noqa: E402
import kit_core as K  # noqa: E402
import kit_shell as SH  # noqa: E402
import kit_seating as SE  # noqa: E402
import kit_tables as TA  # noqa: E402
import kit_decor as DE  # noqa: E402
import kit_beds as BE  # noqa: E402
import kit_storage as ST  # noqa: E402
import kit_kitchen as KI  # noqa: E402
from kit_core import PAL  # noqa: E402

PI = math.pi
H = HB.House(9)
BLUSH_WALL = (0.98, 0.9, 0.87, 1)
SHEER = (0.97, 0.95, 0.92, 1)

# ======================================================================================== floor 1: kitchen + dining ==
HB.hb_mats.use_wallpaper(9)
WOOD_TRIM = (0.88, 0.72, 0.56, 1)
patio = dict(c=2.55, w=3.7, y0=0.15, y1=2.5, style="slide", force=True, drape=("curtain", dict(folds=6, tn=SHEER, tie=0.5, over=0.35)))
win1 = HB.ext_windows(H, 1, w=1.5, style="grid", cols=3, rows=2, drape=("curtain", dict(folds=6, tn=SHEER, tie=0.4)), over={("back", 3.03): patio})
HB.room(H, 1, floor_kind="oak", wall_tn=BLUSH_WALL, wall_m="H_wallpaper", trim_tn=WOOD_TRIM, casing_tn=WOOD_TRIM, ceil_tn=PAL["white"], windows=win1, entry=True, bath=dict(wall="left", c=5.8))
HB.entry_hall(H)
HB.stairs(H)

# --- kitchen wall (left): fridge, induction counter + hood, sink counter + wall cabinets
H.piece(1, "fridge", KI.fridge_double, 0.4, 0.75, 0, PI / 2)
H.piece(1, "cook", KI.counter_base, 0.3, 1.72, 0, PI / 2, length=1.0, cook="induction", top="stone")
H.piece(1, "sink", KI.counter_base, 0.3, 2.77, 0, PI / 2, length=1.1, sink=True, top="stone")
H.piece(1, "hood", KI.hood, 0.3, 1.72, 0, PI / 2, cols=False, w=0.8, d=0.5, y0=1.55)
H.piece(1, "upper", KI.upper_cabinets, 0.17, 2.77, 0, PI / 2, cols=False, length=1.1, d=0.34, y0=1.5, h=0.7)
H.piece(1, "kitchenprops", HP.props_table, 0.3, 2.77, 0, PI / 2, cols=False, top=0.9, seed=4, w=0.5)
H.piece(1, "runner", DE.rug_rect, 1.2, 2.2, 0, PI / 2, w=2.0, d=0.75, cols=False, fringe=False, tn=PAL["rug_grey"])
# --- island (stool side faces the room, +x) with 3 bar stools and 3 globe pendants
H.piece(1, "island", KI.island, 2.7, 1.85, 0, PI / 2, w=2.2, d=0.9, overhang=0.3, top="stone")
H.piece(1, "islandprops", HP.props_table, 2.7, 1.85, 0, PI / 2, cols=False, top=0.9, seed=5, w=0.7)
for z in (1.75, 2.3, 2.85):
    H.piece(1, "stool", SE.stool_bar, 3.85, z, 0, -PI / 2, h=0.65)
    H.piece(1, "pendant", DE.pendant_globe, 2.8, z, 3.7, 0.0, cols=False, drop=1.2, r=0.13)
# --- long dining table, 8 chairs (3 + 3 + 2), bar pendant, rug
H.piece(1, "rug", DE.rug_rect, 8.0, 4.32, 0, 0.0, w=3.6, d=2.3, cols=False, fringe=False, tn=PAL["rug_cream"])
H.piece(1, "table", TA.table_dining_rect, 8.0, 4.32, 0, 0.0, w=2.6, d=1.0, h=0.74)
for x in (7.15, 8.0, 8.85):
    H.piece(1, "dchair", SE.chair_dining_wood, x, 3.2, 0, 0.0)
    H.piece(1, "dchair", SE.chair_dining_wood, x, 5.44, 0, PI)
H.piece(1, "dchair", SE.chair_dining_upholstered, 6.35, 4.32, 0, PI / 2)
H.piece(1, "dchair", SE.chair_dining_upholstered, 9.65, 4.32, 0, -PI / 2)
H.piece(1, "tableprops", HP.props_table, 8.0, 4.32, 0, 0.0, cols=False, top=0.74, seed=7, w=1.8)
H.piece(1, "pendant", DE.pendant_bar, 8.0, 4.32, 3.7, 0.0, cols=False, w=2.0, drop=1.15, n=3)
# --- home café counter on the right wall: machine, grinder, kettle, mug shelf, blank menu board
H.piece(1, "cafe", KI.counter_base, 10.3, 1.7, 0, -PI / 2, length=2.5, top="stone", tile_back=True)
H.piece(1, "espresso", CA.espresso_machine, 10.28, 2.25, 0.9, -PI / 2, cols=False)
H.piece(1, "grinder", CA.grinder, 10.3, 1.5, 0.9, -PI / 2, cols=False)
H.piece(1, "kettle", CA.kettle, 10.25, 0.95, 0.9, -PI / 2, cols=False)
H.piece(1, "mugs", CA.mug_shelf, 10.6, 1.7, 1.45, -PI / 2, cols=False, w=1.5, d=0.2)
H.piece(1, "menu", CA.menu_board, 9.7, 0.0, 1.15, 0.0, cols=False, w=0.7, h=0.9)
# --- plants, frames, clock
H.piece(1, "plant", HP.plant_big, 4.65, 6.9, 0, 0.0, kind="monstera", h=1.25)
H.piece(1, "hang", DE.plant_hanging, 1.3, 6.7, 3.7, 0.0, cols=False, drop=1.0)
H.piece(1, "hang", DE.plant_hanging, 3.9, 6.7, 3.7, 0.0, cols=False, drop=0.8, seed=8)
H.piece(1, "clock", DE.wall_clock, 3.47, 0.8, 2.2, -PI / 2, cols=False)

# =============================================================================================== floor 2: family =====
win2 = HB.ext_windows(H, 2, w=1.4, style="grid", cols=3, rows=2, drape=("curtain", dict(folds=6, tn=(0.95, 0.88, 0.84, 1), tie=0.4)))
HB.room(H, 2, floor_kind="oak", wall_tn=(0.97, 0.88, 0.86, 1), wall_m="H_wallpaper", trim_tn=WOOD_TRIM, casing_tn=WOOD_TRIM, ceil_tn=PAL["white"], windows=win2, bath=dict(wall="left", c=2.6))
HB.partition(H, 2, "bedroom", "x", 0.0, 4.0, 5.1, gaps=[(2.0, 3.7)], tn=(0.97, 0.88, 0.86, 1), trim=WOOD_TRIM)
H.piece(2, "rug", DE.rug_rect, 8.6, 2.2, 0, PI / 2, w=3.0, d=2.2, cols=False, fringe=True, tn=PAL["rug_cream"])
H.piece(2, "sofa", CA.sofa_floor_n, 7.25, 2.2, 0, PI / 2, n=3, w=2.4, tn=PAL["sofa_sage"])
H.piece(2, "table", TA.table_low, 9.4, 2.2, 0, PI / 2, w=1.0, d=0.6, h=0.33)
H.piece(2, "tableprops", HP.props_table, 9.4, 2.2, 0, PI / 2, cols=False, top=0.33, seed=11, w=0.7)
H.piece(2, "tv", TA.tv_stand, 10.38, 2.2, 0, -PI / 2, w=1.8, d=0.4, h=0.45)
H.piece(2, "tvwall", TA.tv_wall, 10.57, 2.2, 1.0, -PI / 2, cols=False, w=1.2, h=0.7)
H.piece(2, "bed", CA.bed_single_n, 0.6, 6.75, 0, PI, side=-1, tn=PAL["blush"])
H.piece(2, "bedside", TA.bedside, 1.5, 7.57, 0, PI)
H.piece(2, "lamp", DE.table_lamp, 1.5, 7.57, 0.55, 0.0)
H.piece(2, "wardrobe", ST.wardrobe_wood, 0.3, 1.0, 0, PI / 2, w=1.2, d=0.55, h=1.9)
H.piece(2, "plant", HP.plant_big, 3.9, 0.6, 0, 0.0, kind="fiddle", h=1.35, leaves=28)
H.piece(2, "lamp_f", DE.floor_lamp, 5.9, 3.7)
H.piece(2, "case", HP.bookwall_lite, 6.6, 0.2, 0, 0.0, w=0.95, h=1.6, d=0.3, seed=93, shelves=4)
H.piece(2, "case2", HP.bookwall_lite, 10.45, 5.6, 0, -PI / 2, w=1.2, h=1.3, d=0.3, seed=95, shelves=3)
H.piece(2, "basket", DE.basket, 6.3, 3.9, 0, 0.0)
H.piece(2, "clock", DE.wall_clock, 3.03, 7.79, 2.0, PI, cols=False)
H.piece(2, "rug_bed", DE.rug_rect, 2.0, 6.3, 0, PI / 2, w=1.6, d=0.9, cols=False, fringe=False, tn=PAL["blush"])
H.piece(2, "plant2", HP.plant_big, 9.4, 5.9, 0, 0.0, kind="monstera", h=1.0)

VIEWS = [
    dict(name="f1_entry", floor=1, eye=[5.3, 0.55, 1.35], look=[3.0, 5.5, 1.3], lens=17),
    dict(name="f1_kitchen", floor=1, eye=[5.2, 3.0, 1.3], look=[0.7, 2.0, 1.1], lens=20),
    dict(name="f1_dining", floor=1, eye=[3.8, 5.2, 1.3], look=[8.0, 3.8, 0.9], lens=20),
    dict(name="f1_cafe", floor=1, eye=[6.4, 3.0, 1.3], look=[10.3, 1.5, 1.1], lens=20),
    dict(name="f1_patio", floor=1, eye=[7.0, 3.0, 1.3], look=[2.5, 7.4, 1.3], lens=20),
    dict(name="f2_stairtop", floor=2, eye=[8.0, 4.2, 1.3], look=[4.6, 6.8, 1.0], lens=18),
    dict(name="f2_living", floor=2, eye=[4.2, 2.8, 1.2], look=[9.8, 2.2, 0.8], lens=20),
    dict(name="f2_bed", floor=2, eye=[4.8, 4.4, 1.3], look=[0.7, 6.4, 0.8], lens=20),
]

HB.done(H, VIEWS)
