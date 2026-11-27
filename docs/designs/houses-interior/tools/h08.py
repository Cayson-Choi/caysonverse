"""8번 집 (하늘) 한옥풍 대청마루 집 - 1층 대청마루 + 2층 다락방, 계단 D.   blender -b --factory-startup -P art/village/tools/houses/h08.py
1층: 우물마루 바닥, 노출 대들보 + 서까래, 기둥 4, 띠살문 창, 반닫이 2 + 족자 + 청자 화병, 좌탁 + 방석 4, 툇마루형 평상(2), 병풍, 한지 등 3.
2층 다락: 한쪽 경사 천장 + 판재 벽, 천창, 매트리스 소파(2) + 빈백 2, 별 줄조명.
좌석 1층 바닥 4 · 무 2 / 2층 바닥 2 · 등 2 (계약 HOUSE_SEAT_PLAN)."""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hb_common as HB  # noqa: E402
import kit_real as KR  # noqa: E402
import kit_shell as SH  # noqa: E402
import hb_pieces as HP  # noqa: E402
import hb_hanok as HK  # noqa: E402
import kit_core as K  # noqa: E402
import kit_seating as SE  # noqa: E402
import kit_tables as TA  # noqa: E402
import kit_decor as DE  # noqa: E402
import kit_beds as BE  # noqa: E402
import kit_storage as ST  # noqa: E402
from kit_core import PAL  # noqa: E402

PI = math.pi
H = HB.House(8)
HANJI = (0.84, 0.91, 0.93, 1)      # cottage pass: duck-egg blue limewash (the sky house)
WOODS = (0.36, 0.26, 0.2, 1)

# =========================================================================================== floor 1: 대청마루 =====
HB.hb_mats.use_wallpaper(8)
WOOD_TRIM = (0.38, 0.27, 0.2, 1)
win1 = HB.ext_windows(H, 1, w=1.5, y0=0.5, y1=2.45, style="grid", cols=3, rows=2, drape=("curtain", dict(folds=6, tn=(0.86, 0.9, 0.92, 1), tie=0.4)), over={})
HB.room(H, 1, floor_kind="oak", wall_tn=HANJI, wall_m="H_wallpaper", trim_tn=WOOD_TRIM, windows=win1, entry=True, bath=dict(wall="right", c=1.0),
        ceiling="custom", ceiling_fn=lambda F, hole: (SH.ceiling(F, 10.6, 7.8, 3.7, hole=hole, m="H_plaster", tn=(0.97, 0.96, 0.93, 1), lights=((2.4, 1.4), (5.3, 3.9), (8.2, 1.4), (2.4, 5.2), (8.2, 5.2))), KR.beams(F, y=3.7, step=1.75, skip=hole, tn=(0.62, 0.48, 0.34, 1))))
HB.entry_hall(H)
HB.stairs(H)
for (px, pz) in ((3.3, 2.6), (7.3, 2.6), (3.3, 5.2), (7.3, 5.2)):
    pass  # (cottage pass) removed: H.piece(1, "pillar", HK.pillar, px, pz, 0, 0.0)

# --- back wall: two 반닫이 with 청자 화병 and 족자
H.piece(1, "banndaji", KR.chest_drawers, 4.5, 7.55, 0, PI)
H.piece(1, "banndaji", KR.chest_drawers, 5.58, 7.55, 0, PI)
H.piece(1, "vase", HK.celadon_vase, 4.5, 7.55, 0.85, 0.0, cols=False, h=0.42)
pass  # (cottage pass) removed: H.piece(1, "scroll", ST.scroll_hanging, 4.5, 7.79, 1.15, PI,
pass  # (cottage pass) removed: H.piece(1, "scroll", ST.scroll_hanging, 5.58, 7.79, 1.15, PI
H.piece(1, "tea", DE.tea_set, 5.58, 7.55, 0.85, 0.0, cols=False)
# --- 병풍 + 평상 (right side)
pass  # (cottage pass) removed: H.piece(1, "screen", ST.folding_screen, 8.6, 7.55, 0, PI, pa
H.piece(1, "pyeongsang", SE.pyeongsang, 9.93, 6.5, 0, -PI / 2, w=1.8, d=1.0, h=0.38)
# --- 좌탁 + 방석 4 around the table (cushions face the table)
H.piece(1, "sang", TA.table_low, 9.5, 3.9, 0, 0.0, w=1.2, d=0.7, h=0.35)
H.piece(1, "sangprops", HP.props_table, 9.5, 3.9, 0, 0.0, cols=False, top=0.35, seed=3, w=0.9)
H.piece(1, "cushion", SE.bangseok, 9.2, 3.12, 0, 0.0, tn=PAL["rug_red"])
H.piece(1, "cushion", SE.bangseok, 9.8, 3.12, 0, 0.0, tn=PAL["sofa_navy"])
H.piece(1, "cushion", SE.bangseok, 9.2, 4.68, 0, PI, tn=PAL["sofa_navy"])
H.piece(1, "cushion", SE.bangseok, 9.8, 4.68, 0, PI, tn=PAL["rug_red"])
pass  # (cottage pass) removed: H.piece(1, "lantern", DE.hanji_lantern, 9.5, 3.9, 3.9, 0.0, 
pass  # (cottage pass) removed: H.piece(1, "lantern", DE.hanji_lantern, 5.3, 2.6, 3.5, 0.0, 
pass  # (cottage pass) removed: H.piece(1, "lantern", DE.hanji_lantern, 5.3, 5.2, 3.5, 0.0, 
# --- left zone: 서안, 문갑, orchid on a 소반, plinth with a big 청자
H.piece(1, "seoan", TA.seoan, 2.5, 7.45, 0, 0.0)
H.piece(1, "seoanprops", HP.props_table, 2.5, 7.45, 0, 0.0, cols=False, top=0.32, seed=5, w=0.7)
H.piece(1, "mungap", ST.mungap, 10.43, 2.2, 0, -PI / 2)   # moved off the stair foot (art round 2): the way from the entry corner to the 2F pad is open
H.piece(1, "soban", TA.soban, 6.4, 7.4, 0, 0.0)
H.piece(1, "orchid", DE.plant_orchid, 6.4, 7.4, 0.3, 0.0, cols=False)
H.piece(1, "vase_big", HK.vase_on_plinth, 3.62, 7.2, 0, 0.0, h=0.55)
H.piece(1, "frame", DE.frame_art, 10.57, 2.2, 1.5, -PI / 2, cols=False, w=0.55, h=0.8, art=2)
H.piece(1, "clock", DE.wall_clock, 8.6, 7.79, 2.15, PI, cols=False)
H.piece(1, "snake", DE.plant_snake, 9.3, 0.5, 0, 0.0)
H.piece(1, "tea2", DE.tea_set, 9.93, 6.1, 0.38, -PI / 2, cols=False)
H.piece(1, "branch", DE.vase_branch, 10.43, 2.2, 0.6, 0.0, cols=False, h=0.4)

# --- night fill (art round 2): the lanterns alone left the 대청마루 black at night; six soft warm bake-only lights under the beams stand for
# the hanji lanterns' glow bouncing round the hall (no geometry)
def _fill(F):
    for (lx, lz) in ((2.4, 1.0), (5.3, 3.9), (8.2, 1.0), (8.2, 6.4), (5.3, 6.6), (2.4, 5.2)):
        K.light(F, "fill", lx, lz, 3.0, 50.0, "#FFD9A8")


H.piece(1, "fill", _fill, 0, 0, 0, 0.0, cols=False)

# ================================================================================================ floor 2: 다락 =====
win2 = HB.ext_windows(H, 2, w=1.4, y0=0.9, y1=2.45, style="grid", cols=2, rows=2, drape=("curtain", dict(folds=6, tn=(0.95, 0.9, 0.8, 1), tie=0.35)))
HB.room(H, 2, floor_kind="oak", wall_tn=(0.96, 0.9, 0.8, 1), wall_m="H_paint", trim_tn=(0.7, 0.52, 0.36, 1), casing_tn=(0.7, 0.52, 0.36, 1), ceil_tn=PAL["white"], windows=win2, bath=dict(wall="front", c=9.9),
        ceiling="custom", ceiling_fn=lambda F, hole: HB.ceiling_slope(F, hole, side="right", run=3.4, low=2.9, skylight=(8.4, 9.5, 2.8, 3.8)))
H.piece(2, "rug", DE.rug_round, 5.1, 5.2, 0, 0.0, d=3.2, tn=PAL["rug_cream"])
H.piece(2, "mattress", BE.mattress_sofa, 5.1, 7.25, 0, PI, w=1.9, d=0.95, tn=PAL["sofa_sage"])
H.piece(2, "beanbag", SE.bean_bag, 2.7, 4.7, 0, 1.2, tn=PAL["mustard"])
H.piece(2, "beanbag", SE.bean_bag, 7.5, 4.7, 0, -1.2, tn=PAL["terracotta"])
H.piece(2, "table", TA.table_low, 5.1, 4.9, 0, 0.0, w=1.0, d=0.6, h=0.33)
H.piece(2, "tableprops", HP.props_table, 5.1, 4.9, 0, 0.0, cols=False, top=0.33, seed=9, w=0.8)
H.piece(2, "strings", DE.string_lights, 5.3, 4.4, 3.05, 0.0, cols=False, length=8.2, sag=0.5, n=16)
H.piece(2, "plant", HP.plant_big, 10.0, 0.6, 0, 0.0, kind="fiddle", h=1.3, leaves=28)
H.piece(2, "trunk", ST.trunk, 3.95, 0.35, 0, 0.0)
H.piece(2, "shelf", HP.bookwall_lite, 10.4, 6.85, 0, -PI / 2, w=1.4, h=1.2, d=0.3, seed=81, shelves=3)
H.piece(2, "frame", DE.frame_art, 5.1, 7.78, 1.7, PI, cols=False, w=0.8, h=0.55, art=1)

# ---- realism pass 2026-11-17 (refs: encykorea 우물마루, a brunch hanok interior): the things a lived-in 대청 keeps ---------------------
pass  # (cottage pass) removed: H.piece(1, "onggi", KR.onggi, 7.35, 7.4, 0, 0.0, h=0.55, r=0
pass  # (cottage pass) removed: H.piece(1, "onggi2", KR.onggi, 7.78, 6.95, 0, 0.0, h=0.4, r=
pass  # (cottage pass) removed: H.piece(1, "cstack", KR.cushion_stack, 10.25, 5.0, 0, 0.2, n
pass  # (cottage pass) removed: H.piece(1, "slippers", KR.slippers, 6.55, 1.15, 0.0, -PI / 2
H.piece(2, "throw", KR.throw_folded, 4.55, 7.15, 0.42, PI, cols=False, w=0.5, d=0.34, layers=3, tn=(0.86, 0.8, 0.68, 1))
H.piece(2, "lamp", DE.floor_lamp, 6.55, 7.3)
pass  # (cottage pass) removed: H.piece(2, "purifier", KR.air_purifier, 3.3, 7.3)
H.piece(2, "bookpile", HP.props_table, 2.2, 7.4, 0, 0.0, cols=False, top=0.0, seed=17, w=0.5)

# ---- dream show-home styling (owner 2026-11-17): fresh flowers, styled tables, lamps and sconces, a console vignette --------
H.piece(1, "flowers", KR.flower_vase, 9.5, 3.9, 0.35, 0.0, cols=False, tn=(0.66, 0.72, 0.9, 1), kind="hydrangea", h=0.24)
pass  # (window alignment: no free back wall left for it) removed: H.piece(1, "vignette", KR.console_vignette, 8.6, 7.8, 0.0, PI, w=1.2, accent=(0.66, 0.74, 0.92, 1))

VIEWS = [
    dict(name="f1_entry", floor=1, eye=[5.3, 0.55, 1.35], look=[5.3, 6.0, 1.5], lens=17),
    dict(name="f1_table", floor=1, eye=[5.2, 2.2, 1.15], look=[9.0, 4.0, 0.6], lens=20),
    dict(name="f1_back", floor=1, eye=[5.4, 3.4, 1.3], look=[4.8, 7.6, 1.3], lens=20),
    dict(name="f1_left", floor=1, eye=[6.2, 4.5, 1.3], look=[2.2, 5.0, 1.3], lens=20),
    dict(name="f1_stair", floor=1, eye=[5.6, 3.2, 1.3], look=[1.0, 5.4, 1.8], lens=18),
    dict(name="f2_stairtop", floor=2, eye=[4.6, 4.6, 1.3], look=[1.8, 6.6, 1.0], lens=18),
    dict(name="f2_lounge", floor=2, eye=[5.2, 1.4, 1.1], look=[5.2, 7.0, 0.8], lens=20),
    dict(name="f2_sky", floor=2, eye=[4.2, 5.8, 1.2], look=[9.2, 2.6, 1.6], lens=20),
]

HB.done(H, VIEWS)
