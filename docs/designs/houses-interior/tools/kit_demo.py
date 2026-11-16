"""Whole-room demo scenes of the kit (not shipped): the 1번 집 living room with the stair A from the mock-up's camera, and a
4번 집 ondol room, used for the side-by-side checks against the reference photos."""
import math
from kit_core import *   # noqa: F401,F403
from kit_core import S
import kit_shell as SH
import kit_seating as SE
import kit_tables as TA
import kit_decor as DE
import kit_storage as ST
import kit_kitchen as KI
import kit_beds as BE


def living_stairs(F):
    """1번 집 1F: living room + stair A (back wall, right) - same camera as docs/designs/houses-interior/mock_h01_1f_living.png"""
    W, D = 10.6, 7.8
    hole = (5.06, 10.5, 6.4, 7.7)
    ops = {"back": [dict(s0=W - 4.7, s1=W - 1.3, y0=0.9, y1=2.5)], "front": [dict(s0=1.4, s1=4.4, y0=0.9, y1=2.5)]}
    fr = SH.room_shell(F, W, D, ops=ops, hole=hole, floor_kind="oak", lights=((2.6, 3.9), (7.9, 2.4), (3.0, 6.0)))
    Wb = fr["back"][0]
    SH.window(Wb, W - 4.7, W - 1.3, 0.9, 2.5, style="grid", cols=3, rows=2)
    SH.curtain(Wb, W - 4.95, W - 1.05, 2.7, 0.04, folds=10)
    Wf = fr["front"][0]
    SH.window(Wf, 1.4, 4.4, 0.9, 2.5, style="grid", cols=3, rows=2)
    SH.vertical_blind(Wf, 1.2, 4.6, 2.62, 0.5)
    st = F.sub(10.5, 7.05, 0, -math.pi / 2)
    SH.stairs(st, wall_side="right", open_low=4)
    SE.sofa_fabric(F.sub(5.2, 4.9, 0, math.pi), w=2.4)
    TA.table_coffee_round(F.sub(5.2, 3.3, 0, 0))
    DE.rug_rect(F.sub(5.2, 3.7, 0, 0), w=2.4, d=1.7)
    SE.armchair_lounge(F.sub(8.4, 4.0, 0, -math.pi / 2 - 0.4))
    DE.floor_lamp(F.sub(7.2, 5.4, 0, 0))
    TA.tv_stand(F.sub(0.3, 3.4, 0, math.pi / 2))
    TA.tv_wall(F.sub(0.06, 3.4, 1.1, math.pi / 2))
    DE.plant_monstera(F.sub(0.5, 1.4, 0, 0))
    DE.plant_rubber(F.sub(0.55, 6.2, 0, 0))
    DE.frame_art(F.sub(1.8, 7.78, 1.4, math.pi), art=1)


def ondol_room(F):
    """4번 집 1F ondol room: 장판, 자개장, 소반 + 방석 4, 병풍, 창호지 창"""
    W, D = 6.0, 5.0
    ops = {"back": [dict(s0=1.5, s1=4.5, y0=0.8, y1=2.2)]}
    fr = SH.room_shell(F, W, D, ops=ops, floor_kind="jangpan", wall_tn=(0.95, 0.9, 0.78, 1), lights=((3.0, 2.5),))
    Wb = fr["back"][0]
    SH.window(Wb, 1.5, 4.5, 0.8, 2.2, style="slide", paper=True)
    ST.wardrobe_jagae(F.sub(5.5, 1.0, 0, -math.pi / 2))
    TA.soban(F.sub(3.0, 2.8, 0, 0))
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        SE.bangseok(F.sub(3.0 + 0.62 * math.cos(a), 2.8 + 0.62 * math.sin(a), 0, a + math.pi / 2), tn=PAL["rug_red"] if k % 2 else PAL["sofa_navy"])
    ST.folding_screen(F.sub(1.5, 0.35, 0, 0))
    DE.frame_family(F.sub(3.0, 4.98, 1.6, math.pi))
    DE.wall_clock(F.sub(4.2, 4.98, 1.8, math.pi))
    DE.calendar_wall(F.sub(1.8, 4.98, 1.4, math.pi))


PIECES = [
    dict(name="demo_living_stairs", fn=living_stairs, group="demo", ref="08_stairs_2f",
         cam=dict(eye=(10.2, 0.9, 2.2), look=(6.2, 6.6, 1.5), lens=19, res=(1280, 720))),
    dict(name="demo_living_stairs_b", fn=living_stairs, group="demo", ref="08_stairs_2f",
         cam=dict(eye=(1.2, 1.2, 2.2), look=(8.0, 6.4, 1.6), lens=19, res=(1280, 720))),
    dict(name="demo_ondol", fn=ondol_room, group="demo", ref="01_ondol_room",
         cam=dict(eye=(0.3, 0.3, 1.7), look=(4.0, 4.0, 0.8), lens=18, res=(1280, 720))),
]
