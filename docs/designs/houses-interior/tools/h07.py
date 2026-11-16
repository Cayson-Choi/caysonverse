"""7번 집 (민트) 음악·공방 집 - 음악 거실 + 2층 공방, 계단 B.   blender -b --factory-startup -P art/village/tools/houses/h07.py
1층: 업라이트 피아노 + 벤치(오른쪽 벽), 기타 스탠드 2, 오디오 장 + 스피커 + 턴테이블(왼쪽 벽), 3인 소파 + 암체어, 원형 식탁 + 의자 2, 음반 선반.
2층: 두꺼운 원목 작업대 2, 타공판 공구 벽, 높은 스툴 3(perch), 재료 선반 4, 물레(장식), 작업등.
좌석 1층 등 6 · 무 1 / 2층 무 3 (계약 HOUSE_SEAT_PLAN)."""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hb_common as HB  # noqa: E402
import hb_pieces as HP  # noqa: E402
import hb_music as MU  # noqa: E402
import kit_core as K  # noqa: E402
import kit_seating as SE  # noqa: E402
import kit_tables as TA  # noqa: E402
import kit_decor as DE  # noqa: E402
import kit_storage as ST  # noqa: E402
from kit_core import PAL  # noqa: E402

PI = math.pi
H = HB.House(7)
MINT_WALL = (0.84, 0.94, 0.89, 1)
SHEER = (0.95, 0.96, 0.92, 1)

# ============================================================================================== floor 1: music room ===
HB.hb_mats.use_wallpaper(7)
WOOD_TRIM = (0.78, 0.62, 0.46, 1)
win1 = HB.ext_windows(H, 1, w=1.5, style="grid", cols=3, rows=2, drape=("curtain", dict(folds=6, tn=SHEER, tie=0.4)))
HB.room(H, 1, floor_kind="oak", wall_tn=MINT_WALL, wall_m="H_wallpaper", trim_tn=WOOD_TRIM, casing_tn=WOOD_TRIM, ceil_tn=PAL["white"], windows=win1, entry=True, bath=dict(wall="back", c=9.4))
HB.entry_hall(H)
HB.stairs(H)

# --- listening wall (left): audio cabinet with its two speakers, turntable, frames; guitars in the front-left corner
H.piece(1, "audio", TA.tv_cabinet_audio, 0.24, 2.2, 0, PI / 2, w=1.2, d=0.4, h=0.62)
H.piece(1, "turntable", MU.turntable, 0.22, 2.2, 0.62, PI / 2, cols=False)
H.piece(1, "frame1", DE.frame_art, 0.04, 1.75, 1.45, PI / 2, cols=False, w=0.5, h=0.65, art=0)
H.piece(1, "frame2", DE.frame_art, 0.04, 2.65, 1.45, PI / 2, cols=False, w=0.5, h=0.65, art=2)
H.piece(1, "guitar", MU.guitar_a_frame, 0.35, 0.55, 0, 0.0, wood=0)
H.piece(1, "guitar", MU.guitar_a_frame, 0.97, 0.55, 0, 0.0, wood=1)

# --- conversation: 3-seat sofa facing the audio wall, lounge chair, round table, rug, lamp
H.piece(1, "rug", DE.rug_rect, 2.2, 3.0, 0, PI / 2, w=3.0, d=2.1, cols=False, fringe=True, tn=PAL["rug_blue"])
H.piece(1, "sofa", SE.sofa_fabric, 3.55, 3.05, 0, -PI / 2, w=2.2, tn=PAL["sofa_sage"])
H.piece(1, "armchair", SE.armchair_lounge, 2.3, 5.7, 0, PI, tn=PAL["mustard"])
H.piece(1, "lamp", DE.floor_lamp, 3.0, 5.9)
H.piece(1, "records", MU.record_shelf, 10.4, 0.95, 0, -PI / 2, w=1.3, d=0.36, h=0.78, seed=3)
H.piece(1, "plant_r", HP.plant_big, 10.2, 3.05, 0, 0.0, kind="fiddle", h=1.4, leaves=30)

# --- piano corner (right wall)
H.piece(1, "piano", TA.piano_upright, 10.3, 6.9, 0, -PI / 2)
H.piece(1, "bench", SE.piano_bench, 9.72, 6.9, 0, PI / 2)
H.piece(1, "pianoframe", DE.frame_art, 10.57, 6.9, 1.45, -PI / 2, cols=False, w=0.7, h=0.5, art=1)

# --- dining corner (front right): round table + two chairs, pendant
H.piece(1, "table", TA.table_dining_round, 8.9, 2.4, 0, 0.0, d=1.1)
H.piece(1, "dchair", SE.chair_dining_wood, 7.97, 2.4, 0, PI / 2)
H.piece(1, "dchair", SE.chair_dining_wood, 9.83, 2.4, 0, -PI / 2)
H.piece(1, "tableprops", HP.props_table, 8.9, 2.4, 0, 0.0, cols=False, top=0.74, seed=6, w=0.8)
H.piece(1, "pendant", DE.pendant_dome, 8.9, 2.4, 3.7, 0.0, cols=False, drop=1.05)
H.piece(1, "plant_b", HP.plant_big, 5.98, 7.3, 0, 0.0, kind="monstera", h=1.2)
H.piece(1, "clock", DE.wall_clock, 3.47, 1.2, 2.1, -PI / 2, cols=False)
H.piece(1, "rug2", DE.rug_round, 8.9, 2.4, 0, 0.0, cols=False, d=2.7, tn=PAL["rug_cream"])
H.piece(1, "frames", DE.frame_family, 10.57, 0.95, 1.5, -PI / 2, cols=False)
H.piece(1, "side", TA.bedside, 3.55, 4.45, 0, -PI / 2)
H.piece(1, "sidelamp", DE.table_lamp, 3.55, 4.45, 0.55, 0.0)
H.piece(1, "case", HP.bookwall_lite, 9.5, 0.2, 0, 0.0, w=1.2, h=1.7, d=0.3, seed=33, shelves=5)
H.piece(1, "pend1", DE.pendant_globe, 3.0, 2.6, 3.7, 0.0, cols=False, drop=1.1, r=0.13)
H.piece(1, "pend2", DE.pendant_globe, 3.0, 3.6, 3.7, 0.0, cols=False, drop=1.1, r=0.13)

# ============================================================================================== floor 2: workshop ===
win2 = HB.ext_windows(H, 2, w=1.5, style="grid", cols=3, rows=2, drape=None)
HB.room(H, 2, floor_kind="dark", wall_tn=(0.93, 0.93, 0.88, 1), wall_m="H_wallpaper", trim_tn=WOOD_TRIM, casing_tn=WOOD_TRIM, ceil_tn=PAL["white"], windows=win2, bath=dict(wall="front", c=1.0))
# tool wall + main bench (back wall, right)
H.piece(2, "pegboard", MU.pegboard, 9.1, 7.79, 1.0, PI, w=2.3, h=1.1, seed=2)
H.piece(2, "bench", TA.workbench, 9.1, 7.2, 0, PI, w=2.0, d=0.8, h=0.9)
H.piece(2, "benchprops", MU.bench_props, 9.1, 7.2, 0, PI, cols=False, w=2.0, d=0.8, top=0.9, seed=7)
H.piece(2, "stool", SE.stool_wood, 8.45, 6.35, 0, 0.3, h=0.66)
H.piece(2, "stool", SE.stool_wood, 9.75, 6.35, 0, -0.4, h=0.66)
# second bench in the room
H.piece(2, "bench", TA.workbench, 3.0, 3.6, 0, 0.0, w=1.8, d=0.8, h=0.9)
H.piece(2, "benchprops", MU.bench_props, 3.0, 3.6, 0, 0.0, cols=False, w=1.8, d=0.8, top=0.9, seed=11)
H.piece(2, "stool", SE.stool_wood, 3.1, 2.7, 0, 0.2, h=0.66)
H.piece(2, "pendant", DE.pendant_bar, 3.0, 3.6, 3.7, 0.0, cols=False, w=1.4, drop=1.1, n=3)
H.piece(2, "pendant", DE.pendant_bar, 9.1, 6.9, 3.7, 0.0, cols=False, w=1.4, drop=1.1, n=3)
# material shelves on the right wall, potter's wheel on the left
H.piece(2, "mat", MU.shelf_materials, 10.4, 0.95, 0, -PI / 2, w=1.2, d=0.4, h=1.9, seed=4)
H.piece(2, "mat", MU.shelf_materials, 10.4, 2.2, 0, -PI / 2, w=1.2, d=0.4, h=1.9, seed=5)
H.piece(2, "mat", MU.shelf_materials, 10.4, 5.55, 0, -PI / 2, w=1.2, d=0.4, h=1.9, seed=6)
H.piece(2, "mat", MU.shelf_materials, 10.4, 6.8, 0, -PI / 2, w=1.2, d=0.4, h=1.9, seed=8)
H.piece(2, "wheel", MU.potter_wheel, 0.9, 1.5, 0, PI / 2)
H.piece(2, "plant", HP.plant_big, 6.6, 0.6, 0, 0.0, kind="monstera", h=1.1)
H.piece(2, "lumber", MU.lumber_rack, 0.2, 5.6, 0, PI / 2, w=1.2, h=1.7)
H.piece(2, "crates", MU.crate_stack, 0.5, 2.6, 0, 0.0, n=3)
H.piece(2, "crates", MU.crate_stack, 2.2, 0.5, 0, 0.3, n=2, seed=5)
H.piece(2, "clock", DE.wall_clock, 10.57, 3.0, 2.0, -PI / 2, cols=False)
H.piece(2, "frame", DE.frame_art, 0.04, 4.9, 1.6, PI / 2, cols=False, w=0.5, h=0.65, art=1)

VIEWS = [
    dict(name="f1_entry", floor=1, eye=[5.3, 0.55, 1.35], look=[4.4, 5.5, 1.3], lens=17),
    dict(name="f1_listen", floor=1, eye=[5.0, 3.2, 1.2], look=[0.6, 1.9, 0.9], lens=20),
    dict(name="f1_piano", floor=1, eye=[6.3, 3.6, 1.25], look=[10.3, 5.7, 1.0], lens=20),
    dict(name="f1_dining", floor=1, eye=[5.2, 4.6, 1.3], look=[8.8, 1.9, 1.0], lens=20),
    dict(name="f1_stair", floor=1, eye=[5.6, 3.4, 1.3], look=[1.0, 6.2, 1.6], lens=18),
    dict(name="f2_stairtop", floor=2, eye=[8.4, 4.2, 1.3], look=[5.9, 6.9, 1.0], lens=18),
    dict(name="f2_bench", floor=2, eye=[6.0, 4.5, 1.3], look=[9.6, 7.3, 1.2], lens=20),
    dict(name="f2_shop", floor=2, eye=[6.8, 1.2, 1.3], look=[2.0, 4.0, 1.0], lens=20),
]

HB.done(H, VIEWS)
