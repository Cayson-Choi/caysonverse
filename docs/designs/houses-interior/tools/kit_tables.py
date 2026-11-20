"""Tables of the houses kit: dining (rect, round), 좌탁 / 상 (low), 소반 (round tray table), coffee tables, desks, workbench,
서안, bedside table, dressing table, kids desk, TV stand + wall TV. Real heights: dining 0.74, low table 0.35, desk 0.74."""
import math
from kit_core import *   # noqa: F401,F403
from kit_core import S
from kit_seating import WOOD, BLK, sqleg, leg


def table_dining_rect(F, w=1.6, d=0.9, h=0.74, tn=None, legs="square", top_th=0.035):
    """원목 식탁: chamfered thick top, apron on all sides, tapered square legs; 4/6/8-seat sizes by w."""
    tn = tn or WOOD["natural"]
    hw, hd = w / 2, d / 2
    rbox(F, -hw, hw, -hd, hd, h - top_th, h, "H_wood_oak", r=0.012, seg=2, tn=tn, grain=(1, 0, 0), tile=1.0)
    ap = 0.08
    for z in (-hd + 0.12, hd - 0.12):
        rbox(F, -hw + 0.1, hw - 0.1, z - 0.012, z + 0.012, h - top_th - ap, h - top_th, "H_wood_oak", r=0.004, seg=1, tn=tn)
    for x in (-hw + 0.12, hw - 0.12):
        rbox(F, x - 0.012, x + 0.012, -hd + 0.12, hd - 0.12, h - top_th - ap, h - top_th, "H_wood_oak", r=0.004, seg=1, tn=tn)
    for (sx, sz) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        sqleg(F, sx * (hw - 0.12), sz * (hd - 0.12), 0.0, h - top_th, 0.065, 0.04, "H_wood_oak", tn)
    col(F, -hw, hw, -hd, hd, h, name="table")


def table_dining_round(F, d=1.1, h=0.74, tn=None, pedestal=True):
    """round table with a turned pedestal and 3 feet (5번 집 4인)."""
    tn = tn or WOOD["natural"]
    r = d / 2
    lathe(F, 0, 0, h - 0.035, [(0, 0), (r - 0.012, 0.0), (r, 0.012), (r, 0.028), (r - 0.012, 0.035), (0, 0.035)], "H_wood_oak", 36, tn=tn)
    if pedestal:
        lathe(F, 0, 0, 0.04, [(0.1, 0.0), (0.06, 0.1), (0.05, 0.3), (0.07, 0.5), (0.1, h - 0.1)], "H_wood_oak", 20, tn=tn)
        for k in range(3):
            a = k * 2 * math.pi / 3 + 0.4
            tube(F, [(0.0, 0.0, 0.05), (0.38 * math.cos(a), 0.38 * math.sin(a), 0.03)], 0.03, "H_wood_oak", 8, tn=tn)
    col(F, -r, r, -r, r, h, name="table")


def table_low(F, w=1.2, d=0.7, h=0.35, tn=None, rim=True):
    """좌탁 / 상: low rectangular table with chunky square legs, a thin apron and a slight lip."""
    tn = tn or (0.85, 0.6, 0.42, 1)
    hw, hd = w / 2, d / 2
    rbox(F, -hw, hw, -hd, hd, h - 0.04, h, "H_wood_oak", r=0.012, seg=2, tn=tn, grain=(1, 0, 0))
    for (sx, sz) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        sqleg(F, sx * (hw - 0.06), sz * (hd - 0.06), 0.0, h - 0.04, 0.055, 0.045, "H_wood_oak", tn)
    for z in (-hd + 0.06, hd - 0.06):
        rbox(F, -hw + 0.09, hw - 0.09, z - 0.01, z + 0.01, h - 0.1, h - 0.04, "H_wood_oak", r=0.004, seg=1, tn=tn)
    for x in (-hw + 0.06, hw - 0.06):
        rbox(F, x - 0.01, x + 0.01, -hd + 0.09, hd - 0.09, h - 0.1, h - 0.04, "H_wood_oak", r=0.004, seg=1, tn=tn)
    col(F, -hw, hw, -hd, hd, h, name="table")


def soban(F, d=0.46, h=0.30, tn=None):
    """둥근 밥상 (소반): a round tray top with a raised rim on a carved pedestal with three curved feet."""
    tn = tn or (0.65, 0.42, 0.28, 1)
    r = d / 2
    lathe(F, 0, 0, h - 0.04, [(0, 0.0), (r, 0.0), (r, 0.035), (r - 0.012, 0.035), (r - 0.014, 0.012), (0, 0.012)], "H_wood_oak", 32, tn=tn)
    lathe(F, 0, 0, 0.09, [(0.06, 0.0), (0.035, 0.05), (0.03, 0.12), (0.05, h - 0.13)], "H_wood_oak", 14, tn=tn)
    for k in range(3):
        a = k * 2 * math.pi / 3 + 0.6
        pts = [(0.03 * math.cos(a), 0.03 * math.sin(a), 0.11), (0.1 * math.cos(a), 0.1 * math.sin(a), 0.07), (0.17 * math.cos(a), 0.17 * math.sin(a), 0.0)]
        tube(F, pts, [0.022, 0.02, 0.018], "H_wood_oak", 8, tn=tn)
    col(F, -r, r, -r, r, h, name="table")


def table_coffee_round(F, d=0.9, h=0.38, tn=None):
    """원형 커피테이블 (1번 집): walnut top, wide drum base with a slight taper."""
    tn = tn or WOOD["walnut"]
    r = d / 2
    lathe(F, 0, 0, h - 0.045, [(0, 0), (r - 0.015, 0.0), (r, 0.015), (r, 0.03), (r - 0.012, 0.045), (0, 0.045)], "H_wood_oak", 36, tn=tn)
    lathe(F, 0, 0, 0.0, [(0.26, 0.0), (0.27, 0.02), (0.22, h * 0.6), (0.2, h - 0.045)], "H_wood_oak", 28, tn=tn)
    col(F, -r, r, -r, r, h, name="table")


def table_coffee_rect(F, w=1.1, d=0.6, h=0.4, tn=None, shelf=True):
    """rectangular coffee table with a lower shelf and thin legs."""
    tn = tn or WOOD["natural"]
    hw, hd = w / 2, d / 2
    rbox(F, -hw, hw, -hd, hd, h - 0.03, h, "H_wood_oak", r=0.008, seg=2, tn=tn)
    for (sx, sz) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        sqleg(F, sx * (hw - 0.05), sz * (hd - 0.05), 0.0, h - 0.03, 0.04, 0.03, "H_wood_oak", tn, splay=(sx * 0.02, sz * 0.015))
    if shelf:
        rbox(F, -hw + 0.07, hw - 0.07, -hd + 0.07, hd - 0.07, 0.12, 0.145, "H_wood_oak", r=0.004, seg=1, tn=tn)
    col(F, -hw, hw, -hd, hd, h, name="table")


def desk(F, w=1.4, d=0.65, h=0.74, tn=None, drawers=True):
    """책상: top with rounded corners, a 3-drawer pedestal on the left, a slim panel leg on the right, drawer pulls."""
    tn = tn or WOOD["natural"]
    hw, hd = w / 2, d / 2
    rbox(F, -hw, hw, -hd, hd, h - 0.03, h, "H_wood_oak", r=0.01, seg=2, tn=tn, grain=(1, 0, 0))
    rbox(F, hw - 0.04, hw, -hd + 0.03, hd - 0.03, 0.0, h - 0.03, "H_wood_oak", r=0.004, seg=1, tn=tn, grain=(0, 0, 1))
    rbox(F, -hw + 0.0, -hw + 0.45, -hd + 0.02, hd - 0.04, 0.0, h - 0.03, "H_wood_oak", r=0.006, seg=1, tn=tn)
    if drawers:
        for k in range(3):
            y0 = 0.05 + k * 0.215
            rbox(F, -hw + 0.02, -hw + 0.43, hd - 0.042, hd - 0.02, y0, y0 + 0.2, "H_wood_oak", r=0.004, seg=1, tn=tuple(c * 0.94 for c in tn[:3]) + (1,))
            rbox(F, -hw + 0.18, -hw + 0.27, hd - 0.02, hd - 0.005, y0 + 0.16, y0 + 0.175, "H_metal", r=0.003, seg=1, tn=BLK)
    rbox(F, -hw + 0.45, hw - 0.04, -hd + 0.02, -hd + 0.04, 0.25, h - 0.03, "H_wood_oak", r=0.004, seg=1, tn=tn)       # modesty panel
    col(F, -hw, hw, -hd, hd, h, name="desk")


def workbench(F, w=1.8, d=0.8, h=0.9, tn=None):
    """공방 작업대: 8 cm thick butcher-block top, heavy legs with a lower shelf, a vise at the corner, a few tools."""
    tn = tn or (0.9, 0.7, 0.5, 1)
    hw, hd = w / 2, d / 2
    rbox(F, -hw, hw, -hd, hd, h - 0.08, h, "H_wood_oak", r=0.008, seg=2, tn=tn, grain=(1, 0, 0), tile=0.8)
    n = int(d / 0.08)
    for i in range(1, n):
        z = -hd + i * d / n
        rbox(F, -hw, hw, z - 0.0012, z + 0.0012, h - 0.08, h - 0.0, "H_wood_dark", r=0.0, seg=1, tn=(0.5, 0.4, 0.3, 1), skip=("+z", "-z")) if False else None
    for (sx, sz) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        rbox(F, sx * (hw - 0.1) - 0.05, sx * (hw - 0.1) + 0.05, sz * (hd - 0.1) - 0.05, sz * (hd - 0.1) + 0.05, 0.0, h - 0.08, "H_wood_oak", r=0.006,
             seg=1, tn=tn, grain=(0, 0, 1))
    for x in (-hw + 0.1, hw - 0.1):
        for y in (0.3,):
            rbox(F, x - 0.025, x + 0.025, -hd + 0.1, hd - 0.1, y, y + 0.08, "H_wood_oak", r=0.004, seg=1, tn=tn)
    rbox(F, -hw + 0.1, hw - 0.1, -hd + 0.1, hd - 0.1, 0.3, 0.33, "H_wood_oak", r=0.004, seg=1, tn=tn)
    rbox(F, hw - 0.28, hw - 0.12, hd - 0.2, hd - 0.04, h, h + 0.09, "H_metal", r=0.006, seg=1, tn=(0.25, 0.3, 0.28, 1))
    rbox(F, hw - 0.27, hw - 0.13, hd + 0.0, hd + 0.05, h - 0.03, h + 0.09, "H_metal", r=0.006, seg=1, tn=(0.25, 0.3, 0.28, 1))
    col(F, -hw, hw, -hd, hd, h, name="workbench")


def seoan(F, w=0.95, d=0.45, h=0.32, tn=None):
    """서안 (사랑방): low writing desk with a rounded-end top plank, two side-board legs with a cut-out, a small drawer."""
    tn = tn or (0.7, 0.45, 0.3, 1)
    hw, hd = w / 2, d / 2
    rbox(F, -hw, hw, -hd, hd, h - 0.035, h, "H_wood_oak", r=0.012, seg=2, tn=tn, grain=(1, 0, 0))
    for sx in (-1, 1):
        x = sx * (hw - 0.08)
        rbox(F, x - 0.018, x + 0.018, -hd + 0.03, hd - 0.03, 0.0, h - 0.035, "H_wood_oak", r=0.006, seg=1, tn=tn, grain=(0, 0, 1))
        # curved lower cut-out foot suggestion
        rbox(F, x - 0.03, x + 0.03, -hd + 0.03, hd - 0.03, 0.0, 0.03, "H_wood_oak", r=0.006, seg=1, tn=tn)
    rbox(F, -hw + 0.1, hw - 0.1, hd - 0.05, hd - 0.03, h - 0.12, h - 0.04, "H_wood_oak", r=0.004, seg=1, tn=tn)
    rbox(F, -0.05, 0.05, hd - 0.03, hd - 0.015, h - 0.095, h - 0.08, "H_metal", r=0.003, seg=1, tn=(0.7, 0.55, 0.3, 1))
    col(F, -hw, hw, -hd, hd, h, name="table")


def bedside(F, w=0.45, d=0.4, h=0.55, tn=None):
    """협탁: a small table with a drawer and a shelf on four tapered legs."""
    tn = tn or WOOD["natural"]
    hw, hd = w / 2, d / 2
    rbox(F, -hw, hw, -hd, hd, h - 0.03, h, "H_wood_oak", r=0.008, seg=2, tn=tn)
    for (sx, sz) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        sqleg(F, sx * (hw - 0.03), sz * (hd - 0.03), 0.0, h - 0.03, 0.035, 0.025, "H_wood_oak", tn, splay=(sx * 0.01, sz * 0.01))
    rbox(F, -hw + 0.03, hw - 0.03, -hd + 0.03, hd - 0.03, 0.15, 0.18, "H_wood_oak", r=0.004, seg=1, tn=tn)
    rbox(F, -hw + 0.03, hw - 0.03, -hd + 0.03, hd - 0.02, h - 0.2, h - 0.03, "H_wood_oak", r=0.004, seg=1, tn=tuple(c * 0.95 for c in tn[:3]) + (1,))
    rbox(F, -0.05, 0.05, hd - 0.02, hd - 0.005, h - 0.12, h - 0.105, "H_metal", r=0.003, seg=1, tn=(0.7, 0.6, 0.4, 1))
    col(F, -hw, hw, -hd, hd, h, name="table")


def dressing_table(F, w=1.0, d=0.45, h=0.74, tn=None):
    """화장대: desk with a drawer, a frameless round mirror on the wall side, a few bottles."""
    tn = tn or (1.0, 0.95, 0.9, 1)
    hw, hd = w / 2, d / 2
    rbox(F, -hw, hw, -hd, hd, h - 0.03, h, "H_paint", r=0.008, seg=2, tn=tn)
    for (sx, sz) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        sqleg(F, sx * (hw - 0.04), sz * (hd - 0.04), 0.0, h - 0.03, 0.04, 0.028, "H_wood_oak", WOOD["natural"], splay=(sx * 0.02, sz * 0.015))
    rbox(F, -0.3, 0.3, -hd + 0.02, hd - 0.02, h - 0.17, h - 0.03, "H_paint", r=0.004, seg=1, tn=tn)
    rbox(F, -0.05, 0.05, hd - 0.02, hd - 0.005, h - 0.11, h - 0.095, "H_metal", r=0.003, seg=1, tn=(0.8, 0.7, 0.4, 1))
    # round mirror
    lathe(F.sub(0, -hd + 0.03, 0, 0), 0, 0, 0, [(0, 0)], "H_glass", 4) if False else None
    mir = F.sub(0, -hd + 0.02, h + 0.55, 0)
    for rr in (0.31,):
        n = 36
        pts = [(rr * math.cos(2 * math.pi * i / n), 0.0, rr * math.sin(2 * math.pi * i / n)) for i in range(n)]
        gface(mir, pts, "H_metal", (1, 0, 0), 1.0, (0, 1, 0), tn=(0.9, 0.85, 0.7, 1))
        pts2 = [(0.29 * math.cos(2 * math.pi * i / n), 0.004, 0.29 * math.sin(2 * math.pi * i / n)) for i in range(n)]
        gface(mir, pts2, "H_mirror", (1, 0, 0), 1.0, (0, 1, 0))
    for (x, hh) in ((-0.3, 0.12), (-0.2, 0.09), (0.3, 0.1)):
        lathe(F, x, 0.02, h, [(0, 0), (0.025, 0.0), (0.028, hh * 0.6), (0.012, hh), (0.012, hh + 0.03), (0, hh + 0.03)], "H_ceramic", 12,
              tn=(0.9, 0.8, 0.8, 1))
    col(F, -hw, hw, -hd, hd, h, name="table")


def kids_desk(F, w=1.0, d=0.55, h=0.6, tn=None):
    """아이 책상: low desk with a pastel painted side panel and a shelf."""
    tn = tn or WOOD["pine"]
    hw, hd = w / 2, d / 2
    rbox(F, -hw, hw, -hd, hd, h - 0.03, h, "H_wood_oak", r=0.01, seg=2, tn=tn)
    for sx in (-1, 1):
        rbox(F, sx * (hw - 0.025) - 0.018, sx * (hw - 0.025) + 0.018, -hd + 0.03, hd - 0.03, 0.0, h - 0.03, "H_paint", r=0.005, seg=1, tn=PAL["sky"], grain=(0, 0, 1))
    rbox(F, -hw + 0.05, hw - 0.05, -hd + 0.02, -hd + 0.04, 0.2, h - 0.03, "H_paint", r=0.004, seg=1, tn=PAL["sky"])
    rbox(F, -hw + 0.05, hw - 0.05, -hd + 0.0, -hd + 0.2, 0.3, 0.32, "H_wood_oak", r=0.003, seg=1, tn=tn)
    col(F, -hw, hw, -hd, hd, h, name="desk")


def tv_stand(F, w=1.8, d=0.4, h=0.45, tn=None):
    """TV 장식장: low cabinet with 3 doors (two sliding panels + an open niche), tapered legs, a cable hole."""
    tn = tn or WOOD["walnut"]
    hw, hd = w / 2, d / 2
    for sx in (-1, 1):
        sqleg(F, sx * (hw - 0.08), -hd + 0.06, 0.0, 0.1, 0.04, 0.03, "H_wood_oak", tn, splay=(sx * 0.02, 0))
        sqleg(F, sx * (hw - 0.08), hd - 0.06, 0.0, 0.1, 0.04, 0.03, "H_wood_oak", tn, splay=(sx * 0.02, 0))
    rbox(F, -hw, hw, -hd, hd, 0.1, h, "H_wood_oak", r=0.008, seg=2, tn=tn, grain=(1, 0, 0))
    w3 = w / 3
    for i in range(3):
        a = -hw + i * w3 + 0.012
        b = -hw + (i + 1) * w3 - 0.012
        if i == 1:
            rbox(F, a, b, hd - 0.03, hd, 0.13, h - 0.03, "H_screen", r=0.0, seg=1, tn=(0.2, 0.2, 0.2, 1))
            continue
        rbox(F, a, b, hd - 0.0, hd + 0.018, 0.13, h - 0.03, "H_wood_oak", r=0.004, seg=1, tn=tuple(c * 1.1 for c in tn[:3]) + (1,), grain=(0, 0, 1))
        rbox(F, (a + b) / 2 - 0.1, (a + b) / 2 + 0.1, hd + 0.018, hd + 0.03, h - 0.12, h - 0.105, "H_metal", r=0.003, seg=1, tn=(0.15, 0.15, 0.15, 1))
    col(F, -hw, hw, -hd, hd, h, name="tv_stand")


def tv_wall(F, w=1.45, h=0.84, tn=None):
    """wall-mounted flat TV (no brand): thin black panel, bezel, a slim stand-by light, thin mount."""
    rbox(F, -w / 2, w / 2, 0.0, 0.04, 0.0, h, "H_rubber", r=0.01, seg=2, tn=(1, 1, 1, 1))
    rbox(F, -w / 2 + 0.012, w / 2 - 0.012, 0.04, 0.043, 0.012, h - 0.012, "H_screen", r=0.0, seg=1)
    rbox(F, -w / 4, w / 4, -0.025, 0.0, h * 0.3, h * 0.7, "H_rubber", r=0.004, seg=1)


def tv_cabinet_audio(F, w=1.2, d=0.4, h=0.55):
    """오디오 장 + 스피커 2 (7번 집): walnut shelf unit with a turntable-like top, two speaker boxes."""
    tn = WOOD["walnut"]
    rbox(F, -w / 2, w / 2, -d / 2, d / 2, 0.0, h, "H_wood_oak", r=0.008, seg=2, tn=tn)
    for z, y in ((d / 2 - 0.0, 0.0),):
        pass
    for (y0, y1) in ((0.05, 0.25), (0.28, h - 0.04)):
        rbox(F, -w / 2 + 0.03, w / 2 - 0.03, d / 2 - 0.1, d / 2 + 0.004, y0, y1, "H_screen", r=0.0, seg=1, tn=(0.3, 0.3, 0.3, 1))
    for sx in (-1, 1):
        x = sx * (w / 2 + 0.3)
        rbox(F, x - 0.16, x + 0.16, -0.16, 0.16, 0.0, 0.8, "H_wood_oak", r=0.01, seg=2, tn=tn)
        lathe(F.sub(x, 0.16, 0.55, 0), 0, 0, 0, [(0, 0)], "H_rubber", 6) if False else None
        sp = F.sub(x, 0.16, 0.0, 0)
        lathe(sp.sub(0, 0, 0, 0), 0, 0, 0, [(0.0, 0)], "H_rubber", 6) if False else None
        for (yy, rr) in ((0.55, 0.09), (0.28, 0.12)):
            lathe(Frame(*F.p(x, 0.16, yy), F.yaw), 0, 0, 0, [(0, 0)], "H_rubber", 4) if False else None
            n = 20
            pts = [(x + rr * math.cos(2 * math.pi * i / n), 0.162, yy + rr * math.sin(2 * math.pi * i / n)) for i in range(n)]
            gface(F, pts, "H_rubber", (1, 0, 0), 1.0, (0, 1, 0), tn=(0.5, 0.5, 0.5, 1))
    col(F, -w / 2 - 0.5, w / 2 + 0.5, -0.2, d / 2, 0.8, name="audio")


def piano_upright(F, w=1.5, d=0.62, h=1.2, tn=None):
    """업라이트 피아노: black lacquer case, keyboard with 52 white + black keys, fall board, music stand, pedals, 3 legs/feet."""
    tn = tn or (1, 1, 1, 1)
    hw = w / 2
    rbox(F, -hw, hw, -d / 2 + 0.0, d / 2 - 0.12, 0.08, h, "H_lacquer", r=0.012, seg=2)
    rbox(F, -hw - 0.02, hw + 0.02, -d / 2, d / 2, 0.55, 0.64, "H_lacquer", r=0.01, seg=2)              # key slip level
    rbox(F, -hw - 0.025, hw + 0.025, d / 2 - 0.12 - 0.01, d / 2 - 0.0, 0.64 - 0.1, 0.64, "H_lacquer", r=0.008, seg=1)
    # keyboard
    nk = 36
    kw = (w - 0.1) / nk
    for i in range(nk):
        x = -hw + 0.05 + i * kw
        rbox(F, x + 0.001, x + kw - 0.001, d / 2 - 0.22, d / 2 - 0.0, 0.64, 0.66, "H_ceramic", r=0.002, seg=1, tn=(1, 0.98, 0.93, 1))
    for i in range(nk - 1):
        if (i % 7) in (2, 6):
            continue
        x = -hw + 0.05 + (i + 1) * kw
        rbox(F, x - kw * 0.3, x + kw * 0.3, d / 2 - 0.22, d / 2 - 0.1, 0.66, 0.685, "H_lacquer", r=0.002, seg=1)
    # fall board / music stand / top lid
    rbox(F, -hw + 0.04, hw - 0.04, d / 2 - 0.14, d / 2 - 0.12, 0.69, 0.98, "H_lacquer", r=0.004, seg=1)
    rbox(F, -hw + 0.1, hw - 0.1, d / 2 - 0.2, d / 2 - 0.14, 0.97, 1.02, "H_lacquer", r=0.004, seg=1, tilt=-0.0)
    # legs / base
    for sx in (-1, 1):
        rbox(F, sx * (hw - 0.07) - 0.07, sx * (hw - 0.07) + 0.07, -d / 2 + 0.05, d / 2 - 0.05, 0.0, 0.55, "H_lacquer", r=0.01, seg=2)
    rbox(F, -hw + 0.1, hw - 0.1, d / 2 - 0.25, d / 2 - 0.1, 0.12, 0.55, "H_lacquer", r=0.008, seg=1)
    for x in (-0.12, 0.0, 0.12):
        tube(F, [(x, d / 2 - 0.12, 0.03), (x, d / 2 - 0.12, 0.12)], 0.01, "H_metal", 6, tn=(0.8, 0.7, 0.4, 1))
        rbox(F, x - 0.025, x + 0.025, d / 2 - 0.2, d / 2 - 0.1, 0.02, 0.04, "H_metal", r=0.004, seg=1, tn=(0.8, 0.7, 0.4, 1))
    col(F, -hw, hw, -d / 2, d / 2 + 0.05, h, name="piano")


PIECES = [
    dict(name="table_dining_rect_6", fn=table_dining_rect, kw=dict(w=1.8, d=0.9), group="tables", ref="11_dining", cam=dict(az=35, el=22)),
    dict(name="table_dining_round", fn=table_dining_round, group="tables", ref="18_sunroom", cam=dict(az=35, el=22)),
    dict(name="table_low_sang", fn=table_low, group="tables", ref="10_tea_room", cam=dict(az=35, el=25)),
    dict(name="soban", fn=soban, group="tables", ref="06_grandparents_room", cam=dict(az=35, el=25)),
    dict(name="coffee_round", fn=table_coffee_round, group="tables", ref="02_modern_living", cam=dict(az=35, el=25)),
    dict(name="coffee_rect", fn=table_coffee_rect, group="tables", ref="02_modern_living", cam=dict(az=35, el=25)),
    dict(name="desk", fn=desk, group="tables", ref="04_study", cam=dict(az=35, el=22)),
    dict(name="workbench", fn=workbench, group="tables", ref="13_workshop", cam=dict(az=35, el=22)),
    dict(name="seoan", fn=seoan, group="tables", ref="17_sarangbang", cam=dict(az=35, el=25)),
    dict(name="bedside", fn=bedside, group="tables", ref="15_master_bedroom", cam=dict(az=35, el=22)),
    dict(name="dressing_table", fn=dressing_table, group="tables", ref="15_master_bedroom", cam=dict(az=35, el=18)),
    dict(name="kids_desk", fn=kids_desk, group="tables", ref="05_kids_room", cam=dict(az=35, el=22)),
    dict(name="tv_stand", fn=tv_stand, group="tables", ref="02_modern_living", cam=dict(az=35, el=18)),
    dict(name="tv_wall", fn=tv_wall, group="tables", ref="02_modern_living", cam=dict(az=25, el=10)),
    dict(name="audio_cabinet", fn=tv_cabinet_audio, group="tables", ref="12_hobby_music", cam=dict(az=30, el=18)),
    dict(name="piano_upright", fn=piano_upright, group="tables", ref="12_hobby_music", cam=dict(az=35, el=22)),
]
