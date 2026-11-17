"""마을 절 (lot_temple, plot_nw, door east to the lane) — the kit, pure python on b1_geom / b1_parts / temple_parts, in the lot's
LOCAL frame (contract 1: x = the right hand of someone walking in through the 일주문, y up, z out of the front toward the lane;
the 돌담 encloses x -12..12, z -13..12.9, the 일주문 stands at z 12.2, the 대웅전 and its 기단 fill x -6.5..6.5, z -11.5..-3).

Reference (design 2 / 3.4, shots/lot_temple/SOURCES_lot_temple.md): a small new mountain temple — the 일주문 (two pillars, a
맞배 roof on 다포 brackets, the "케이슨산" board), a granite path past a 석등 to a three-bay 대웅전 on a dressed-granite 기단
(배흘림 columns in 석간주, 머리초 beams, 다포 brackets, 꽃살문 doors, 겹처마 with 서까래 and 부연, a 팔작 roof of even dark 기와
with corner lift and 취두), a three-storey granite 석탑, a 범종각 with a bronze bell, a lotus pond with a granite rim and a little
arched stone bridge, four Korean red pines (소나무), granite benches; all inside a granite 돌담 under a 기와 coping. Brand-new:
fresh 단청, crisp granite, clean 마사토. No 卍, no scripture, no real temple's name.
"""
import math

import b1_geom as G
import b1_parts as P
import temple_parts as T
from b1_geom import Mesh, S
from temple_atlas import ruv

LOT = "lot_temple"
GIWA = S("LM_temple_giwa")                                  # roof_giwa
GIWA_RIDGE = S("LM_temple_giwa", G.hexc("8E949C"))          # ridge tiles a little darker / bluer
DAN = S("LM_temple_dancheong")                              # dancheong_wood (atlas)
PINE = S("LM_temple_pine")                                  # wood_pine_natural
GRAN = S("LM_temple_granite", G.hexc("F2EFEA"))             # granite_flamed (기단, 석탑, 석등, 박석)
GRAN_W = S("LM_temple_granite", G.hexc("FFFFFF"))
WALLS = S("LM_temple_wall")                                 # stone_wall_korean (돌담, 석축)
ROCK = S("LM_temple_rock")                                  # rock (pond stones, pine bark)
BARK = S("LM_temple_rock", G.hexc("C9805E"))                # the red upper bark of a 소나무
BARK_LO = S("LM_temple_rock", G.hexc("8C7A6C"))
GROUND = S("LM_temple_ground", G.hexc("F4E9D6"))            # dirt_path: raked 마사토
GREEN = S("LM_temple_green")                                # grass set: pine needle pads, lotus leaves, clipped beds
NEEDLE = S("LM_temple_green", G.hexc("5F8C52"))
NEEDLE_DK = S("LM_temple_green", G.hexc("35583A"))
NEEDLE_UP = S("LM_temple_green", G.hexc("86B068"))
LOTUS_LEAF = S("LM_temple_green", G.hexc("9CCB6E"))
BRONZE = S("LM_temple_bronze", G.hexc("C89A5C"))            # cast_iron (metal) tinted to fresh bronze
IRON = S("LM_temple_bronze", G.hexc("3A3A3E"))
GLASS = P.GLASS                                             # M_glass (also the pond's water)
GOLD_LETTER = S("LM_temple_pine", G.hexc("F2C55A"))         # gilded carved letters

MATS = {
    "LM_temple_giwa": {"set": "roof_giwa", "normal": 1.6},
    "LM_temple_dancheong": {"set": "dancheong_wood"},
    "LM_temple_pine": {"set": "wood_pine_natural"},
    "LM_temple_granite": {"set": "granite_flamed"},
    "LM_temple_wall": {"set": "stone_wall_korean"},
    "LM_temple_rock": {"set": "rock"},
    "LM_temple_ground": {"set": "dirt_path", "normal": 0.6},
    "LM_temple_green": {"set": "grass", "normal": 0.7},
    "LM_temple_bronze": {"set": "cast_iron", "metal": True, "rough": 0.55},
    "M_glass": {"glass": True},
}
PREVIEW = {"PV_grass": {"set": "grass"}, "PV_lane": {"set": "sidewalk_pavers"}}

# the 대웅전 (columns): x +-5.9, z -4.9 .. -10.9; the 기단 x -6.5..6.5, z -11.5..-4.2 (0.9 high), steps to z -3.0
HX, HZ, HCZ = 5.9, 3.0, -7.9
KIDAN = 0.9
COL_TOP = 4.6
FRONT_Z = HCZ + HZ          # -4.9
COLS_X = (-5.9, -1.9, 1.9, 5.9)
COLS_Z = (-4.9, -7.9, -10.9)
CHANG = (4.12, 4.4)         # 창방 y
PYEONG = (4.4, 4.6)         # 평방 y
EAVE_Y = 5.42               # roof surface at the middle of the eaves
RIDGE_Y = 9.95


def build(lot, layout):
    kit = P.Kit(lot)
    kit.mats = dict(MATS)
    kit.mats.update(PREVIEW)
    kit.kinds_cache = {}
    walls(kit)
    courtyard(kit)
    iljumun(kit)
    hall(kit)
    bell_pavilion(kit)
    pagoda(kit, -5.0, 2.5)
    lantern(kit, 0.0, 1.7)
    pond(kit)
    pines(kit)
    benches(kit)
    ground(kit)
    kit.look = "AgX - Base Contrast"
    kit.sun_dir = (6.0, 0.0, 8.0)
    return kit


def place(kit, kind, maker, x, y, z, yaw):
    if kind not in kit.kinds:
        kit.kinds[kind] = maker()
        kit.inst[kind] = []
    kit.inst[kind].append((x, y, z, yaw))


# ------------------------------------------------------------------------------------------------ 돌담 --

def wall_run(kit, x0, x1, z0, z1):
    """A 1.5 m granite 돌담 (body inset 5 cm inside its collider) under a small 기와 coping that fills the collider."""
    S_, D = kit.S, kit.D
    along_x = (x1 - x0) > (z1 - z0)
    if along_x:
        S_.box(x0, x1, 0.0, 1.45, z0 + 0.05, z1 - 0.05, WALLS.u((1, 0, 0)), skip=("-y", "+y"))
        zc = (z0 + z1) / 2
        for sg in (1, -1):
            ze = zc + sg * (z1 - z0) / 2
            q = [(x0, 1.45, ze), (x1, 1.45, ze), (x1, 1.78, zc), (x0, 1.78, zc)]
            T.opoly(S_, q, GIWA.u((1, 0, 0)), (0, 1, sg))
            T.opoly(S_, [(x0, 1.4, ze), (x1, 1.4, ze), (x1, 1.45, ze), (x0, 1.45, ze)], GIWA, (0, 0, sg))
        S_.cbox(x0, x1, 1.72, 1.88, zc - 0.07, zc + 0.07, GIWA_RIDGE, c=0.02)
        for xe, sg in ((x0, -1), (x1, 1)):
            T.opoly(S_, [(xe, 1.45, z0), (xe, 1.45, z1), (xe, 1.78, zc)], GIWA, (sg, 0, 0))
    else:
        S_.box(x0 + 0.05, x1 - 0.05, 0.0, 1.45, z0, z1, WALLS.u((0, 0, 1)), skip=("-y", "+y"))
        xc = (x0 + x1) / 2
        for sg in (1, -1):
            xe = xc + sg * (x1 - x0) / 2
            q = [(xe, 1.45, z0), (xe, 1.45, z1), (xc, 1.78, z1), (xc, 1.78, z0)]
            T.opoly(S_, q, GIWA.u((0, 0, 1)), (sg, 1, 0))
            T.opoly(S_, [(xe, 1.4, z0), (xe, 1.4, z1), (xe, 1.45, z1), (xe, 1.45, z0)], GIWA, (sg, 0, 0))
        S_.cbox(xc - 0.07, xc + 0.07, 1.72, 1.88, z0, z1, GIWA_RIDGE, c=0.02)
        for ze, sg in ((z0, -1), (z1, 1)):
            T.opoly(S_, [(x0, 1.45, ze), (x1, 1.45, ze), (xc, 1.78, ze)], GIWA, (0, 0, sg))
    # a granite footing course (walkover height)
    if along_x:
        D.box(x0, x1, 0.0, 0.18, z0 + 0.03, z1 - 0.03, GRAN.u((1, 0, 0)), skip=("-y",))
    else:
        D.box(x0 + 0.03, x1 - 0.03, 0.0, 0.18, z0, z1, GRAN.u((0, 0, 1)), skip=("-y",))


def walls(kit):
    wall_run(kit, -12.0, -2.3, 12.5, 12.9)
    wall_run(kit, 2.3, 12.0, 12.5, 12.9)
    wall_run(kit, -12.0, -11.6, -13.0, 12.5)
    wall_run(kit, 11.6, 12.0, -13.0, 12.5)
    wall_run(kit, -11.6, 11.6, -13.0, -12.6)


# ------------------------------------------------------------------------------------------------ 마당 --

def courtyard(kit):
    """Raked 마사토 over the whole court (walkover, 1 cm) and the granite 박석 paths: the axis from the 일주문 to the 석등,
    a paved court round it to the hall's steps, branches to the 범종각, the pagoda and the pond-side bench."""
    D = kit.D
    # the court minus the pond's box (the pond sets its own rim and the ground round it)
    y = 0.012
    for (a, b, c, d) in ((-11.6, 11.6, -12.6, 3.0), (-11.6, 11.6, 9.0, 12.5), (-11.6, 4.0, 3.0, 9.0), (10.0, 11.6, 3.0, 9.0)):
        T.opoly(D, [(a, y, c), (b, y, c), (b, y, d), (a, y, d)], GROUND, (0, 1, 0))
    rg = G.rng(41)
    D.box(-1.3, 1.3, 0.0, 0.18, 12.45, 12.95, GRAN.u((1, 0, 0)), skip=("-y",))  # the threshold stone in the gate

    def paving(x0, x1, z0, z1, sx=0.75, sz=0.5):
        z = z0
        row = 0
        while z < z1 - 0.05:
            h = min(sz * rg.uniform(0.85, 1.15), z1 - z)
            x = x0 - (sx * 0.5 if row % 2 else 0.0)
            while x < x1 - 0.05:
                w = sx * rg.uniform(0.8, 1.25)
                a, b = max(x, x0), min(x + w, x1)
                if b - a > 0.12:
                    y = 0.035 + rg.uniform(-0.004, 0.004)
                    col = G.mul(GRAN.col, rg.uniform(0.9, 1.04))
                    T.opoly(D, [(a + 0.012, y, z + 0.012), (b - 0.012, y, z + 0.012), (b - 0.012, y, z + h - 0.012), (a + 0.012, y, z + h - 0.012)], GRAN.t(col), (0, 1, 0))
                x += w
            z += h
            row += 1
    paving(-1.0, 1.0, 3.3, 12.45)            # the axis
    paving(-2.6, 2.6, -3.0, 0.9)             # the court before the steps
    paving(-2.6, -0.8, 0.9, 3.3)
    paving(0.8, 2.6, 0.9, 3.3)
    paving(-9.0, -2.6, -2.3, -1.3)           # to the 범종각
    paving(-9.6, -8.6, -6.6, -2.3)
    paving(2.6, 6.2, 0.2, 1.3, 0.7, 0.45)    # to the pond bench


# ------------------------------------------------------------------------------------------------ 일주문 --

def iljumun(kit):
    S_, D = kit.S, kit.D
    zc = 12.2
    for x in (-2.0, 2.0):
        D.cbox(x - 0.3, x + 0.3, 0.0, 0.22, zc - 0.3, zc + 0.3, GRAN, c=0.03, skip=("-y",))
        T.column(D, DAN, x, zc, 0.22, 4.15, r=0.25, n=10, head=0.4, entasis=True)
    # 창방, 평방 over both pillars (the ends run out past the pillars as on a real 일주문)
    T.beam(D, DAN, (-2.95, 3.72, zc), (2.95, 3.72, zc), 0.3, 0.38, "beam_a")
    T.beam(D, DAN, (-3.05, 4.1, zc), (3.05, 4.1, zc), 0.4, 0.2, "beam_b", top=True)
    # 다포 brackets on the 평방 (front and back faces both show them)
    for x in (-2.0, -0.67, 0.67, 2.0):
        place(kit, "gongpo_s", lambda: T.gongpo_kind(DAN, 0.72), x, 4.3, zc, 0.0)
        place(kit, "gongpo_s", lambda: T.gongpo_kind(DAN, 0.72), x, 4.3, zc, math.pi)
    # the 맞배 roof: eaves 0.8 out on both sides (inside the footprint), lifted ends, barge boards
    r = T.Roof(0.0, zc - 0.15, 3.2, 0.1, 0.72, 5.25, 6.35, 3.6, lift=0.25, bow=0.0, kind="matbae", nt=5, ns=8)
    r.surface(S_, GIWA.u((1, 0, 0)))
    r.eave_edge(S_, GIWA, DAN.t(T.LOK), 5.15, depth=0.18)
    r.ridges(S_, GIWA_RIDGE, DAN.t(T.WHITE), GIWA_RIDGE)
    for sx in (-1, 1):
        # gable boards (박공) and the closed gable triangle under them
        ts = [k / 6 for k in range(7)]
        for sz in (-1, 1):
            pts = [(sx * 3.62, r.y_at(t) + 0.02, zc - 0.1 + sz * r.Ze * (1 - t)) for t in ts]
            for a, b in zip(pts, pts[1:]):
                D.member(a, b, G.prof_box(0.06, 0.3), DAN.t(T.SEOK))
        tri = [(sx * 3.5, 4.88, zc - 0.85), (sx * 3.5, 4.88, zc + 0.65), (sx * 3.5, 6.25, zc - 0.1)]
        T.opoly(S_, tri, DAN.t(T.SEOK), (sx, 0, 0), [ruv("paint", 0.2, 0.2), ruv("paint", 0.4, 0.2), ruv("paint", 0.3, 0.8)])
    for (x, y, z, yaw, f) in r.eave_points(0.36, 0.15):
        place(kit, "rafter", lambda: T.rafter_kind(DAN), x, y - 0.42, z - math.cos(yaw) * 0.32, yaw)
        place(kit, "makse", lambda: T.makse_kind(GIWA), x, y - 0.2, z + math.cos(yaw) * 0.01, yaw)
    # the 현판 "케이슨산": a dark board in a gilt-carved frame hung on the front over the 창방
    zp = zc + 0.36
    D.cbox(-0.95, 0.95, 4.05, 4.85, zp - 0.04, zp + 0.02, DAN.t(T.NAVY), c=0.015)
    frame = [((-1.05, 3.95), (1.05, 4.05)), ((-1.05, 4.85), (1.05, 4.95)), ((-1.05, 4.05), (-0.95, 4.85)), ((0.95, 4.05), (1.05, 4.85))]
    for (a, b) in frame:
        T.apoly(D, [(a[0], a[1], zp + 0.05), (b[0], a[1], zp + 0.05), (b[0], b[1], zp + 0.05), (a[0], b[1], zp + 0.05)], DAN, "gold_scroll", [(0, 0), (1, 0), (1, 0.2), (0, 0.2)], out=(0, 0, 1))
        D.box(a[0], b[0], a[1], b[1], zp - 0.04, zp + 0.05, DAN.t(T.SEOK), skip=("+z",))
    kit.letters.append(("케이슨산", (0.0, 4.26, zp + 0.02), (0, 0, 1), 0.36, 0.035, GOLD_LETTER, "D"))
    # a small lamp under the gate roof (night)
    kit.lights.append(("point", 0.0, 3.4, zc, (1.0, 0.82, 0.6), 60.0))


# ------------------------------------------------------------------------------------------------ 대웅전 --

def hall(kit):
    S_, D = kit.S, kit.D
    # 기단: dressed granite 가구식 (면석 panels between 우주, a 갑석 cap), steps with 소맷돌 at the front
    x0, x1, z0, z1 = -6.5, 6.5, -11.5, -4.2
    S_.cbox(x0, x1, 0.0, KIDAN - 0.12, z0, z1, WALLS.u((1, 0, 0)), c=0.02, skip=("-y",))
    S_.cbox(x0, x1, KIDAN - 0.12, KIDAN, z0, z1 + 0.03, GRAN.u((1, 0, 0)), c=0.025, skip=("-y",))
    for x in [x0 + 0.11 + k * (x1 - x0 - 0.22) / 6 for k in range(7)]:
        D.box(x - 0.09, x + 0.09, 0.0, KIDAN - 0.12, z1, z1 + 0.02, GRAN, skip=("-y", "-z"))
    D.box(x0, x1, 0.0, 0.14, z1, z1 + 0.025, GRAN, skip=("-y", "-z"))
    # steps (4 x 0.225) and the side stones
    for k in range(4):
        zz = -3.0 - k * 0.3
        D.cbox(-1.55, 1.55, 0.0, (k + 1) * 0.225, zz - 0.3, zz, GRAN.u((1, 0, 0)), c=0.015, skip=("-y",))
    for sx in (-1, 1):
        q = [(sx * 1.55, 0.0, -3.0), (sx * 1.55, 0.0, -4.2), (sx * 1.55, KIDAN + 0.08, -4.2), (sx * 1.55, 0.3, -3.0)]
        for xx in (sx * 1.55, sx * 1.83):
            T.opoly(D, [(xx, p[1], p[2]) for p in q], GRAN, (1 if xx * sx > 1.6 else -1, 0, 0) if sx > 0 else (-1 if xx * sx > 1.6 else 1, 0, 0))
        D.poly([(sx * 1.55, 0.3, -3.0), (sx * 1.83, 0.3, -3.0), (sx * 1.83, KIDAN + 0.08, -4.2), (sx * 1.55, KIDAN + 0.08, -4.2)][::(1 if sx < 0 else 1)], GRAN)
        T.opoly(D, [(sx * 1.55, 0.0, -3.0), (sx * 1.83, 0.0, -3.0), (sx * 1.83, 0.3, -3.0), (sx * 1.55, 0.3, -3.0)], GRAN, (0, 0, 1))
    # walls: lime plaster between the columns (sides, back), set 6 cm in from the column line; a dim room behind the doors
    WALL_S = DAN.t(T.CREAM)
    for zz, sg in ((-10.9, -1),):
        q = [(-5.9, KIDAN, zz + 0.06), (5.9, KIDAN, zz + 0.06), (5.9, CHANG[0], zz + 0.06), (-5.9, CHANG[0], zz + 0.06)]
        T.apoly(S_, q, WALL_S, "paint", [(0.05, 0.1), (0.95, 0.1), (0.95, 0.9), (0.05, 0.9)], out=(0, 0, -1))
    for xx, sg in ((-5.9, -1), (5.9, 1)):
        q = [(xx - sg * 0.06, KIDAN, -10.9), (xx - sg * 0.06, KIDAN, -4.9), (xx - sg * 0.06, CHANG[0], -4.9), (xx - sg * 0.06, CHANG[0], -10.9)]
        T.apoly(S_, q, WALL_S, "paint", [(0.05, 0.1), (0.95, 0.1), (0.95, 0.9), (0.05, 0.9)], out=(sg, 0, 0))
    # 인방 (sill / lintel members) on the plastered walls, in 석간주
    for y in (KIDAN + 0.05, 2.35, CHANG[0] - 0.1):
        T.beam(D, DAN, (-5.9, y, -10.84), (5.9, y, -10.84), 0.12, 0.14, "paint", ends=None) if False else None
        D.box(-5.9, 5.9, y, y + 0.14, -10.98, -10.84, DAN.t(T.SEOK), skip=("+z",))
        for xx, sg in ((-5.9, -1), (5.9, 1)):
            a, b = (xx - 0.0, xx + 0.08) if sg > 0 else (xx - 0.08, xx)
            D.box(a, b, y, y + 0.14, -10.9, -4.9, DAN.t(T.SEOK), skip=("-x", "+x") if False else ())
    # front: the dim inside behind the doors, the 머름 and 꽃살 windows in the side bays, transom paper (glows at night)
    inner = [(-5.8, KIDAN + 0.01, -4.95), (5.8, KIDAN + 0.01, -4.95), (5.8, KIDAN + 0.01, -7.5), (-5.8, KIDAN + 0.01, -7.5)]
    T.opoly(D, inner, PINE.u((1, 0, 0)), (0, 1, 0))
    T.apoly(D, [(-5.8, KIDAN, -7.5), (5.8, KIDAN, -7.5), (5.8, CHANG[0], -7.5), (-5.8, CHANG[0], -7.5)], DAN.t(G.hexc("6A4030")), "paint",
            [(0.1, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9)], out=(0, 0, 1))
    glow = kit.glow("doors")
    for (a, b) in ((-5.9, -1.9), (1.9, 5.9)):
        a2, b2 = a + 0.14, b - 0.14
        zf = FRONT_Z
        # 머름 (panelled sill) 0.45 high
        D.cbox(a2, b2, KIDAN, KIDAN + 0.45, zf - 0.08, zf + 0.04, DAN.t(T.SEOK), c=0.012, skip=("-y",))
        # two 꽃살 panels, each in a frame
        mid = (a2 + b2) / 2
        for (u0, u1) in ((a2, mid), (mid, b2)):
            D.box(u0, u1, KIDAN + 0.45, 3.55, zf - 0.04, zf + 0.04, DAN.t(T.SEOK), skip=("+z", "-z"))
            T.apoly(D, [(u0 + 0.07, KIDAN + 0.52, zf + 0.03), (u1 - 0.07, KIDAN + 0.52, zf + 0.03), (u1 - 0.07, 3.48, zf + 0.03), (u0 + 0.07, 3.48, zf + 0.03)],
                    DAN, "kkotsal", [(0, 0), (1, 0), (1, 1), (0, 1)], out=(0, 0, 1))
            for (fa, fb, ya, yb) in ((u0, u0 + 0.07, KIDAN + 0.45, 3.55), (u1 - 0.07, u1, KIDAN + 0.45, 3.55), (u0, u1, KIDAN + 0.45, KIDAN + 0.52), (u0, u1, 3.48, 3.55)):
                D.box(fa, fb, ya, yb, zf - 0.04, zf + 0.06, DAN.t(T.SEOK), skip=("-z",))
        # the transom (광창) of 창호지 under the 창방
        T.apoly(D, [(a2, 3.62, zf + 0.0), (b2, 3.62, zf + 0.0), (b2, CHANG[0] - 0.04, zf + 0.0), (a2, CHANG[0] - 0.04, zf + 0.0)], DAN, "hanji",
                [(0, 0), (1, 0), (1, 1), (0, 1)], out=(0, 0, 1))
        for x in [a2 + (b2 - a2) * k / 6 for k in range(7)]:
            D.box(x - 0.025, x + 0.025, 3.55, CHANG[0] - 0.04, zf, zf + 0.05, DAN.t(T.SEOK), skip=("-z",))
        D.box(a2, b2, 3.55, 3.62, zf - 0.04, zf + 0.06, DAN.t(T.SEOK), skip=("-z",))
        glow.poly([(a2 + 0.02, 3.63, zf + 0.012), (b2 - 0.02, 3.63, zf + 0.012), (b2 - 0.02, CHANG[0] - 0.05, zf + 0.012), (a2 + 0.02, CHANG[0] - 0.05, zf + 0.012)], GLASS.t(P.WARM))
    # the centre bay: door frame, the transom above the doors, the two 꽃살 leaves (hinged at the jambs, turning in)
    zf = FRONT_Z
    for (fa, fb) in ((-1.9 + 0.14, -1.52), (1.52, 1.9 - 0.14)):
        D.box(fa, fb, KIDAN, 4.08, zf - 0.08, zf + 0.06, DAN.t(T.SEOK), skip=("-y",))
    D.box(-1.76, 1.76, KIDAN + 3.12, KIDAN + 3.2, zf - 0.08, zf + 0.06, DAN.t(T.SEOK))
    D.box(-1.76, 1.76, KIDAN - 0.0, KIDAN + 0.06, zf - 0.08, zf + 0.06, DAN.t(T.SEOK))
    T.apoly(D, [(-1.52, KIDAN + 3.2, zf), (1.52, KIDAN + 3.2, zf), (1.52, CHANG[0] - 0.04, zf), (-1.52, CHANG[0] - 0.04, zf)], DAN, "hanji",
            [(0, 0), (1, 0), (1, 1), (0, 1)], out=(0, 0, 1))
    glow.poly([(-1.5, KIDAN + 3.21, zf + 0.012), (1.5, KIDAN + 3.21, zf + 0.012), (1.5, CHANG[0] - 0.05, zf + 0.012), (-1.5, CHANG[0] - 0.05, zf + 0.012)], GLASS.t(P.WARM))
    door_leaves(kit, zf)
    # columns on their 주춧돌
    for x in COLS_X:
        for z in COLS_Z:
            if z == -7.9 and abs(x) < 3:
                continue
            T.plinth_stone(D, GRAN, x, z, 0.62, KIDAN + 0.12) if False else D.cbox(x - 0.31, x + 0.31, KIDAN, KIDAN + 0.12, z - 0.31, z + 0.31, GRAN, c=0.02, skip=("-y",))
            T.column(D, DAN, x, z, KIDAN + 0.12, COL_TOP - 0.46, r=0.25, n=8, head=0.5)
    # 창방 (머리초 beam_a) and 평방 round the top
    for (a, b) in ((-5.9, -1.9), (-1.9, 1.9), (1.9, 5.9)):
        for z in (-4.9, -10.9):
            T.beam(D, DAN, (a, CHANG[0], z), (b, CHANG[0], z), 0.26, CHANG[1] - CHANG[0], "beam_a")
    for x in (-5.9, 5.9):
        for (a, b) in ((-4.9, -7.9), (-7.9, -10.9)):
            T.beam(D, DAN, (x, CHANG[0], a), (x, CHANG[0], b), 0.26, CHANG[1] - CHANG[0], "beam_a")
    T.beam(D, DAN, (-6.2, PYEONG[0], -4.9), (6.2, PYEONG[0], -4.9), 0.36, 0.2, "beam_b", top=True)
    T.beam(D, DAN, (-6.2, PYEONG[0], -10.9), (6.2, PYEONG[0], -10.9), 0.36, 0.2, "beam_b", top=True)
    for x in (-5.9, 5.9):
        T.beam(D, DAN, (x, PYEONG[0], -4.72), (x, PYEONG[0], -11.08), 0.36, 0.2, "beam_b", top=True)
    # 포벽 (the band between the brackets above the 평방), painted 뇌록
    for (q, out) in (([(-6.0, PYEONG[1], -4.92), (6.0, PYEONG[1], -4.92), (6.0, PYEONG[1] + 0.8, -4.92), (-6.0, PYEONG[1] + 0.8, -4.92)], (0, 0, 1)),
                     ([(-6.0, PYEONG[1], -10.88), (6.0, PYEONG[1], -10.88), (6.0, PYEONG[1] + 0.8, -10.88), (-6.0, PYEONG[1] + 0.8, -10.88)], (0, 0, -1)),
                     ([(-5.88, PYEONG[1], -10.9), (-5.88, PYEONG[1], -4.9), (-5.88, PYEONG[1] + 0.8, -4.9), (-5.88, PYEONG[1] + 0.8, -10.9)], (-1, 0, 0)),
                     ([(5.88, PYEONG[1], -10.9), (5.88, PYEONG[1], -4.9), (5.88, PYEONG[1] + 0.8, -4.9), (5.88, PYEONG[1] + 0.8, -10.9)], (1, 0, 0))):
        T.apoly(S_, q, DAN.t(T.LOK), "paint", [(0.1, 0.2), (0.9, 0.2), (0.9, 0.8), (0.1, 0.8)], out=out)
    # 다포: on the columns and two between each pair along the front / back, one between along the sides; the corners turned 45
    yb = PYEONG[1]
    xs = [-5.9, -3.9, -1.9, 0.0, 1.9, 3.9, 5.9]
    for x in xs:
        place(kit, "gongpo", lambda: T.gongpo_kind(DAN), x, yb, -4.9, 0.0 if abs(x) < 5.8 else (math.pi / 4 if x < 0 else -math.pi / 4) * 0 + 0.0)
        place(kit, "gongpo", lambda: T.gongpo_kind(DAN), x, yb, -10.9, math.pi)
    for z in (-6.4, -7.9, -9.4):
        place(kit, "gongpo", lambda: T.gongpo_kind(DAN), -5.9, yb, z, -math.pi / 2)
        place(kit, "gongpo", lambda: T.gongpo_kind(DAN), 5.9, yb, z, math.pi / 2)
    # the 팔작 roof
    r = T.Roof(0.0, HCZ, HX, HZ, 1.76, EAVE_Y, RIDGE_Y, 3.4, lift=0.5, bow=0.16, kind="paljak", nt=7, ns=12)
    kit.hall_roof = r
    r.surface(S_, GIWA.u((1, 0, 0)))
    r.gables(S_, DAN.t(T.SEOK), DAN.t(T.SEOK_DK))
    r.eave_edge(S_, GIWA, DAN.t(T.LOK), PYEONG[1] + 0.95, depth=0.24)
    r.ridges(S_, GIWA_RIDGE, DAN.t(T.WHITE), GIWA_RIDGE)
    for (x, y, z, yaw, f) in r.eave_points(0.44, 0.55):
        cy, sy = math.cos(yaw), math.sin(yaw)
        place(kit, "rafter", lambda: T.rafter_kind(DAN), x - sy * 0.62, y - 0.52, z - cy * 0.62, yaw)
        place(kit, "buyeon", lambda: T.buyeon_kind(DAN), x - sy * 0.12, y - 0.32, z - cy * 0.12, yaw)
        place(kit, "makse", lambda: T.makse_kind(GIWA), x + sy * 0.01, y - 0.24, z + cy * 0.01, yaw)
    # corner fans (선자연): three rafters turned toward each corner
    for sx in (-1, 1):
        for sz in (-1, 1):
            for k, a in enumerate((0.3, 0.55, 0.8)):
                yaw = math.atan2(sx, sz) + (a - 0.55) * 0.6
                p = r.front(sx * (1.0 - 0.06 * (k + 1)), 0.0, sz)
                place(kit, "rafter", lambda: T.rafter_kind(DAN), p[0] - math.sin(yaw) * 0.8, p[1] - 0.5, p[2] - math.cos(yaw) * 0.8, yaw)
    # 현판 "대웅전" over the doors (the hall_plaque slot): a dark board in a gilt 넝쿨 frame, gilt 3D letters
    zp = -4.6
    D.cbox(-1.15, 1.15, 4.62, 5.42, zp - 0.05, zp + 0.02, DAN.t(T.NAVY), c=0.015)
    for (a, b) in (((-1.27, 4.5), (1.27, 4.62)), ((-1.27, 5.42), (1.27, 5.54)), ((-1.27, 4.62), (-1.15, 5.42)), ((1.15, 4.62), (1.27, 5.42))):
        T.apoly(D, [(a[0], a[1], zp + 0.06), (b[0], a[1], zp + 0.06), (b[0], b[1], zp + 0.06), (a[0], b[1], zp + 0.06)], DAN, "gold_scroll", [(0, 0), (1, 0), (1, 0.25), (0, 0.25)], out=(0, 0, 1))
        D.box(a[0], b[0], a[1], b[1], zp - 0.05, zp + 0.06, DAN.t(T.SEOK), skip=("+z",))
    kit.letters.append(("대웅전", (0.0, 4.82, zp + 0.02), (0, 0, 1), 0.4, 0.04, GOLD_LETTER, "D"))
    # night: four small lanterns under the front eaves, the doors' paper glows (above), a soft light inside
    for x in (-3.9, 3.9):
        T.lotus_lamp(kit.G, kit, x, 3.55, -4.1, "eaves", DAN, IRON, r=0.2)
        kit.lights.append(("point", x, 3.5, -4.1, (1.0, 0.75, 0.55), 40.0))
    kit.lights.append(("point", 0.0, 3.0, -6.6, (1.0, 0.78, 0.55), 160.0))


def door_leaves(kit, zf):
    """The two 꽃살 leaves of the centre bay (contract: lot_temple_main, 3 m, swing in): each 1.5 x 3.1 on top of the 기단,
    hinged at the jambs (x -+1.5, z = the wall line), turning inward (to -z)."""
    lw, H, y0 = 1.5, 3.1, KIDAN + 0.04
    leaves = []
    for name, sgn in (("l", 1), ("r", -1)):
        m = Mesh("leaf_" + name)
        x0, x1 = (0.004, lw - 0.004) if sgn > 0 else (-lw + 0.004, -0.004)
        m.box(x0, x1, y0, y0 + H, -0.06, 0.0, DAN.t(T.SEOK), skip=("+z",))
        fr = 0.08
        for (a, b, ya, yb) in ((x0, x0 + fr, y0, y0 + H), (x1 - fr, x1, y0, y0 + H), (x0, x1, y0, y0 + 0.08), (x0, x1, y0 + H - 0.08, y0 + H), (x0, x1, y0 + 0.62, y0 + 0.7)):
            m.box(a, b, ya, yb, -0.03, 0.02, DAN.t(T.SEOK), skip=("-z",))
        # 청판 (lower panel) painted with a cloud panel, 꽃살 above
        T.apoly(m, [(x0 + fr, y0 + 0.08, 0.0), (x1 - fr, y0 + 0.08, 0.0), (x1 - fr, y0 + 0.62, 0.0), (x0 + fr, y0 + 0.62, 0.0)], DAN, "cloud",
                [(0.1, 0.3), (0.9, 0.3), (0.9, 0.7), (0.1, 0.7)], out=(0, 0, 1))
        T.apoly(m, [(x0 + fr, y0 + 0.7, -0.005), (x1 - fr, y0 + 0.7, -0.005), (x1 - fr, y0 + H - 0.08, -0.005), (x0 + fr, y0 + H - 0.08, -0.005)], DAN, "kkotsal",
                [(0, 0), (1, 0), (1, 1), (0, 1)], out=(0, 0, 1))
        # bronze ring pull and hinge straps
        hx = x1 - 0.12 if sgn > 0 else x0 + 0.12
        m.lathe([(0.05, 0.0), (0.05, 0.01), (0.0, 0.015)], 8, BRONZE, hx, 0.025, y0 + 1.25) if False else None
        m.box(hx - 0.04, hx + 0.04, y0 + 1.2, y0 + 1.3, 0.02, 0.035, BRONZE)
        m.tube([(hx, y0 + 1.2, 0.045), (hx + 0.04, y0 + 1.12, 0.05), (hx, y0 + 1.06, 0.05), (hx - 0.04, y0 + 1.12, 0.05), (hx, y0 + 1.2, 0.045)], 0.008, 4, BRONZE)
        for v in (y0 + 0.4, y0 + H - 0.4):
            a, b = (0.0, 0.26) if sgn > 0 else (-0.26, 0.0)
            m.box(a, b, v - 0.03, v + 0.03, 0.02, 0.03, BRONZE)
        leaves.append((name, m, (-sgn * lw, 0.0, zf), sgn))
    kit.doors["lot_temple_main"] = leaves
    kit.sweeps.append(("door lot_temple_main", (-lw - 0.004, lw + 0.004, zf - lw - 0.07, zf - 0.07), KIDAN + H))


# ------------------------------------------------------------------------------------------------ 범종각 --

def bell_pavilion(kit):
    """범종각: four columns on a low granite platform, a 팔작 roof with brackets, a bronze 범종 hung from the beam (slot bell)."""
    S_, D = kit.S, kit.D
    cx, cz = -9.7, -8.5
    D.cbox(cx - 1.5, cx + 1.5, 0.0, 0.32, cz - 1.5, cz + 1.5, GRAN.u((1, 0, 0)), c=0.02, skip=("-y",))
    hx = 1.25
    for sx in (-1, 1):
        for sz in (-1, 1):
            x, z = cx + sx * hx, cz + sz * hx
            D.cbox(x - 0.22, x + 0.22, 0.32, 0.42, z - 0.22, z + 0.22, GRAN, c=0.015)
            T.column(D, DAN, x, z, 0.42, 3.05, r=0.17, n=8, head=0.35)
    for (a, b) in (((cx - hx, cz - hx), (cx + hx, cz - hx)), ((cx - hx, cz + hx), (cx + hx, cz + hx))):
        T.beam(D, DAN, (a[0] - 0.2, 3.05, a[1]), (b[0] + 0.2, 3.05, b[1]), 0.2, 0.26, "beam_b")
    for (a, b) in (((cx - hx, cz - hx), (cx - hx, cz + hx)), ((cx + hx, cz - hx), (cx + hx, cz + hx))):
        T.beam(D, DAN, (a[0], 3.05, a[1] - 0.2), (b[0], 3.05, b[1] + 0.2), 0.2, 0.26, "beam_b")
    T.beam(D, DAN, (cx - hx, 3.05, cz), (cx + hx, 3.05, cz), 0.22, 0.28, "beam_a")   # the bell beam
    for sx in (-1, 1):
        for sz in (-1, 1):
            place(kit, "gongpo", lambda: T.gongpo_kind(DAN), cx + sx * hx, 3.31, cz + sz * hx, math.atan2(sx, sz))
    r = T.Roof(cx, cz, hx, hx, 0.82, 3.95, 6.05, 0.75, lift=0.35, bow=0.1, kind="paljak", nt=5, ns=6)
    r.surface(S_, GIWA.u((1, 0, 0)))
    r.gables(S_, DAN.t(T.SEOK), DAN.t(T.SEOK_DK))
    r.eave_edge(S_, GIWA, DAN.t(T.LOK), 3.62, depth=0.2)
    r.ridges(S_, GIWA_RIDGE, DAN.t(T.WHITE), GIWA_RIDGE)
    for (x, y, z, yaw, f) in r.eave_points(0.4, 0.4):
        cy, sy = math.cos(yaw), math.sin(yaw)
        place(kit, "rafter", lambda: T.rafter_kind(DAN), x - sy * 0.5, y - 0.45, z - cy * 0.5, yaw)
        place(kit, "makse", lambda: T.makse_kind(GIWA), x + sy * 0.01, y - 0.2, z + cy * 0.01, yaw)
    bell(kit.G, cx, cz, 1.0, 3.05)


def bell(m, cx, cz, y0, beam_y):
    """범종: the Korean bell profile (shoulder, gently swelling body, a lip band), 용뉴 hook with its 음통 tube, four 유곽 with
    nine 유두 each, two 당좌 lotus striking seats, hung on a bronze shackle from the beam."""
    prof = [(0.0, 1.32), (0.27, 1.32), (0.36, 1.27), (0.39, 1.15), (0.4, 0.8), (0.42, 0.35), (0.45, 0.12), (0.46, 0.04), (0.44, 0.0), (0.38, 0.02)]
    m.lathe(prof, 14, BRONZE, cx, cz, y0)
    m.lathe([(0.38, 0.02), (0.36, 0.3)], 14, BRONZE.t(G.hexc("8C6A3C")), cx, cz, y0)  # the inside lip (shadowed)
    for yb in (1.18, 0.2):  # 상대 / 하대 bands
        m.lathe([(0.405 if yb > 1 else 0.452, -0.05), (0.415 if yb > 1 else 0.462, 0.0), (0.405 if yb > 1 else 0.452, 0.06)], 14, BRONZE, cx, cz, y0 + yb)
    m.tube([(cx, y0 + 1.32, cz - 0.08), (cx, y0 + 1.52, cz - 0.1), (cx, y0 + 1.6, cz), (cx, y0 + 1.52, cz + 0.1), (cx, y0 + 1.36, cz + 0.12)], 0.05, 6, BRONZE)
    m.cyl(cx, cz - 0.17, 0.045, y0 + 1.32, y0 + 1.62, 6, BRONZE)
    m.member((cx, y0 + 1.6, cz), (cx, beam_y, cz), G.prof_round(0.03, 5), IRON)
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        nx, nz = math.cos(a), -math.sin(a)
        tx, tz = -nz, nx
        rb = 0.405
        for i in range(3):
            for j in range(3):
                u = (i - 1) * 0.07
                yy = y0 + 0.95 - j * 0.07
                px, pz = cx + nx * rb + tx * u, cz + nz * rb + tz * u
                m.lathe([(0.018, 0.0), (0.012, 0.02), (0.0, 0.03)], 5, BRONZE, 0.0, 0.0, 0.0) if False else None
                m.member((px, yy, pz), (px + nx * 0.03, yy, pz + nz * 0.03), G.prof_round(0.016, 5), BRONZE, caps=True)
        for (du, dv) in ((-0.13, 0.0), (0.13, 0.0)):
            m.member((cx + nx * 0.408 + tx * du, y0 + 0.82, cz + nz * 0.408 + tz * du), (cx + nx * 0.408 + tx * du, y0 + 1.1, cz + nz * 0.408 + tz * du), G.prof_box(0.02, 0.012), BRONZE)
    for a in (0.0, math.pi):
        nx, nz = math.cos(a), -math.sin(a)
        m.lathe([(0.1, 0.0), (0.09, 0.015), (0.04, 0.03), (0.0, 0.032)], 10, BRONZE, 0.0, 0.0, 0.0) if False else None
        c = (cx + nx * 0.425, y0 + 0.5, cz + nz * 0.425)
        ring = [(c[0] + (-nz) * 0.1 * math.cos(2 * math.pi * i / 10), c[1] + 0.1 * math.sin(2 * math.pi * i / 10), c[2] + nx * 0.1 * math.cos(2 * math.pi * i / 10)) for i in range(10)]
        tip = (c[0] + nx * 0.03, c[1], c[2] + nz * 0.03)
        for i in range(10):
            T.opoly(m, [ring[i], ring[(i + 1) % 10], tip], BRONZE, (nx, 0, nz))


# ------------------------------------------------------------------------------------------------ 석탑 / 석등 --

def pagoda(kit, cx, cz):
    """삼층 석탑 (6.5 m): two-tier granite 기단 with 우주·탱주, three storeys of 탑신 with 우주 and stepped 옥개석 (five steps
    under, lifted corners), and the 상륜부 (노반, 복발, 앙화, 보륜, 보주)."""
    D = kit.D
    g = GRAN

    def sq(w, y0, y1, c=0.02):
        D.cbox(cx - w / 2, cx + w / 2, y0, y1, cz - w / 2, cz + w / 2, g, c=c, skip=("-y",))

    sq(1.96, 0.0, 0.2)
    sq(1.8, 0.2, 0.62)
    sq(1.9, 0.62, 0.72)
    sq(1.42, 0.72, 1.36)
    sq(1.52, 1.36, 1.48)
    for w, y0, y1 in ((1.8, 0.2, 0.62), (1.42, 0.72, 1.36)):
        for sx in (-1, 0, 1):
            for face in (1, -1):
                x = cx + sx * (w / 2 - 0.07) if sx else cx
                D.box(x - 0.06, x + 0.06, y0, y1, cz + face * w / 2 - (0.005 if face > 0 else -0.005) - (0.0 if face > 0 else 0.0), cz + face * (w / 2 + 0.012), g) if face > 0 else \
                    D.box(x - 0.06, x + 0.06, y0, y1, cz - w / 2 - 0.012, cz - w / 2 + 0.005, g)
                z = cz + sx * (w / 2 - 0.07) if sx else cz
                D.box(cx + face * w / 2 - (0.005 if face > 0 else 0.012) * (1 if face > 0 else -1) * 0 + (0.0 if face > 0 else -0.012), cx + face * w / 2 + (0.012 if face > 0 else 0.0), y0, y1, z - 0.06, z + 0.06, g)
    y = 1.48
    for k, (bw, bh, rw, rh) in enumerate(((0.86, 0.78, 1.56, 0.34), (0.72, 0.5, 1.36, 0.31), (0.6, 0.38, 1.16, 0.29))):
        sq(bw, y, y + bh)
        for sx in (-1, 1):
            D.box(cx + sx * bw / 2 - 0.07, cx + sx * bw / 2 + 0.01 * sx, y + 0.02, y + bh - 0.02, cz + bw / 2 - 0.0, cz + bw / 2 + 0.012, g) if sx > 0 else \
                D.box(cx - bw / 2 - 0.01, cx - bw / 2 + 0.07, y + 0.02, y + bh - 0.02, cz + bw / 2, cz + bw / 2 + 0.012, g)
        y += bh
        # 옥개석: five underside steps, then a roof slab whose corners lift
        for s in range(4):
            w = bw + 0.08 + s * (rw - bw - 0.08) / 4
            sq(w, y + s * 0.035, y + (s + 1) * 0.035, c=0.008)
        yb = y + 0.14
        h = rw / 2
        lift = 0.07
        top = y + rh
        corners = [(cx - h, yb + lift, cz - h), (cx + h, yb + lift, cz - h), (cx + h, yb + lift, cz + h), (cx - h, yb + lift, cz + h)]
        mids = [(cx, yb, cz - h), (cx + h, yb, cz), (cx, yb, cz + h), (cx - h, yb, cz)]
        apex = (cx, top, cz)
        under = [(cx - h + 0.05, yb - 0.05, cz - h + 0.05), (cx + h - 0.05, yb - 0.05, cz - h + 0.05), (cx + h - 0.05, yb - 0.05, cz + h - 0.05), (cx - h + 0.05, yb - 0.05, cz + h - 0.05)]
        ring = [corners[0], mids[0], corners[1], mids[1], corners[2], mids[2], corners[3], mids[3]]
        inner = [(cx + (p[0] - cx) * 0.35, top - 0.03, cz + (p[2] - cz) * 0.35) for p in ring]
        for i in range(8):
            j = (i + 1) % 8
            T.opoly(D, [ring[i], ring[j], inner[j], inner[i]], g, ((ring[i][0] + ring[j][0]) / 2 - cx, 1.0, (ring[i][2] + ring[j][2]) / 2 - cz))
            T.opoly(D, [inner[i], inner[j], apex], g, (0, 1, 0))
            ui = under[i // 2] if i % 2 == 0 else None
        for i in range(4):
            j = (i + 1) % 4
            T.opoly(D, [corners[i], mids[i], corners[j] if False else mids[i]], g, (0, 0, 1)) if False else None
            a, b = corners[i], corners[j]
            m_ = mids[i]
            q = [(a[0], a[1] - 0.05, a[2]), (m_[0], m_[1] - 0.05, m_[2]), m_, a]
            T.opoly(D, q, g, (m_[0] - cx, 0, m_[2] - cz))
            q = [(m_[0], m_[1] - 0.05, m_[2]), (b[0], b[1] - 0.05, b[2]), b, m_]
            T.opoly(D, q, g, (m_[0] - cx, 0, m_[2] - cz))
            T.opoly(D, [(a[0], a[1] - 0.05, a[2]), (b[0], b[1] - 0.05, b[2]), (m_[0], m_[1] - 0.05, m_[2])], g, (0, -1, 0))
        T.opoly(D, [(c[0], c[1] - 0.05, c[2]) for c in corners], g, (0, -1, 0))
        y = top - 0.02
    # 상륜부
    D.cbox(cx - 0.24, cx + 0.24, y, y + 0.18, cz - 0.24, cz + 0.24, g, c=0.015)
    D.sphere(cx, y + 0.3, cz, 0.17, g, n=10, rings=6, sy=0.8)
    D.lathe([(0.08, 0.0), (0.2, 0.1), (0.21, 0.16), (0.0, 0.16)], 10, g, cx, cz, y + 0.42)
    D.cyl(cx, cz, 0.03, y + 0.58, 6.38, 6, BRONZE)
    for k in range(5):
        D.lathe([(0.03, 0.0), (0.13 - k * 0.012, 0.03), (0.03, 0.07)], 8, BRONZE, cx, cz, y + 0.7 + k * 0.17)
    D.sphere(cx, 6.42, cz, 0.08, BRONZE, n=8, rings=5, sy=1.2)


def lantern(kit, cx, cz):
    """석등: 지대석, 복련 하대석, an octagonal 간주석, 앙련 상대석, the 화사석 with four light windows (glows at night), an
    octagonal 옥개석 with curled corners, a 보주."""
    D = kit.D
    g = GRAN
    D.cbox(cx - 0.48, cx + 0.48, 0.0, 0.14, cz - 0.48, cz + 0.48, g, c=0.015, skip=("-y",))
    D.lathe([(0.42, 0.0), (0.42, 0.08), (0.36, 0.12), (0.3, 0.2), (0.18, 0.25)], 8, g, cx, cz, 0.14, phase=math.pi / 8)
    # 복련 petals
    for k in range(8):
        a = k * math.pi / 4
        p = (cx + 0.34 * math.cos(a), 0.3, cz - 0.34 * math.sin(a))
        D.sphere(p[0], p[1], p[2], 0.07, g, n=6, rings=3, sy=0.6)
    D.lathe([(0.11, 0.0), (0.1, 0.8)], 8, g, cx, cz, 0.39, phase=math.pi / 8)
    D.lathe([(0.12, 0.0), (0.3, 0.12), (0.34, 0.18), (0.34, 0.22)], 8, g, cx, cz, 1.19, phase=math.pi / 8)
    for k in range(8):
        a = k * math.pi / 4 + math.pi / 8
        D.sphere(cx + 0.25 * math.cos(a), 1.3, cz - 0.25 * math.sin(a), 0.07, g, n=6, rings=3, sy=0.7)
    # 화사석: octagonal chamber, windows on four faces
    r = 0.23
    y0, y1 = 1.41, 1.86
    for k in range(8):
        a0, a1 = k * math.pi / 4 + math.pi / 8, (k + 1) * math.pi / 4 + math.pi / 8
        pa = (cx + r * math.cos(a0), cz - r * math.sin(a0))
        pb = (cx + r * math.cos(a1), cz - r * math.sin(a1))
        out = (math.cos((a0 + a1) / 2), 0, -math.sin((a0 + a1) / 2))
        if k % 2 == 0:
            for (ya, yb) in ((y0, y0 + 0.08), (y1 - 0.08, y1)):
                T.opoly(D, [(pa[0], ya, pa[1]), (pb[0], ya, pb[1]), (pb[0], yb, pb[1]), (pa[0], yb, pa[1])], g, out)
            for (fa, fb) in ((0.0, 0.18), (0.82, 1.0)):
                qa = (pa[0] + (pb[0] - pa[0]) * fa, pa[1] + (pb[1] - pa[1]) * fa)
                qb = (pa[0] + (pb[0] - pa[0]) * fb, pa[1] + (pb[1] - pa[1]) * fb)
                T.opoly(D, [(qa[0], y0 + 0.08, qa[1]), (qb[0], y0 + 0.08, qb[1]), (qb[0], y1 - 0.08, qb[1]), (qa[0], y1 - 0.08, qa[1])], g, out)
        else:
            T.opoly(D, [(pa[0], y0, pa[1]), (pb[0], y0, pb[1]), (pb[0], y1, pb[1]), (pa[0], y1, pa[1])], g, out)
    D.lathe([(0.12, 0.0), (0.12, 0.42)], 8, g.t(G.hexc("5A524A")), cx, cz, 1.43, phase=math.pi / 8)  # the dark inside
    kit.glow("lantern").lathe([(0.0, 0.0), (0.14, 0.04), (0.15, 0.3), (0.0, 0.36)], 8, GLASS.t((1.0, 0.78, 0.48)), cx, cz, 1.46)
    kit.lights.append(("point", cx, 1.62, cz, (1.0, 0.76, 0.45), 90.0))
    # 옥개석
    D.lathe([(0.3, 0.0), (0.46, 0.05), (0.5, 0.1), (0.36, 0.2), (0.12, 0.33), (0.0, 0.36)], 8, g, cx, cz, 1.86, phase=math.pi / 8)
    for k in range(8):
        a = k * math.pi / 4 + math.pi / 8
        D.member((cx + 0.43 * math.cos(a), 1.95, cz - 0.43 * math.sin(a)), (cx + 0.485 * math.cos(a), 2.02, cz - 0.485 * math.sin(a)), G.prof_box(0.06, 0.05), g)
    D.sphere(cx, 2.3, cz, 0.09, g, n=8, rings=5, sy=1.25)
    D.lathe([(0.06, 0.0), (0.09, 0.04), (0.0, 0.06)], 8, g, cx, cz, 2.2)


# ------------------------------------------------------------------------------------------------ 연못 --

def pond(kit):
    """A lotus pond (x 4..10, z 3..9): two lobes round a narrow waist, a granite curb rim, still water a little below the
    court, a dark basin, lotus leaves and pink flowers, a small arched granite bridge over the waist (inside the pond's box)."""
    D = kit.D
    cx, cz = 7.0, 6.0

    def rad(a):
        # two lobes: wider along x, pinched at x = 7
        return 2.55 + 0.35 * math.cos(2 * a) - 0.75 * max(0.0, math.cos(a * 2 + math.pi)) * 0.0

    n = 28
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        rx = 2.75 * (1 - 0.18 * (math.sin(a) ** 2) * (1 if abs(math.cos(a)) < 0.35 else 0))
        rz = 2.55 * (1 - 0.32 * (1 - abs(math.cos(a))) ** 3)
        pts.append((cx + rx * math.cos(a), cz - rz * math.sin(a)))
    # water, basin, rim
    yw = -0.12
    T.opoly(D, [(x, yw, z) for x, z in pts], GLASS.t(G.hexc("1E3A40")), (0, 1, 0))
    T.opoly(D, [(cx + (x - cx) * 0.98, -0.55, cz + (z - cz) * 0.98) for x, z in pts], ROCK.t(G.hexc("4A4E42")), (0, 1, 0))
    for i in range(n):
        j = (i + 1) % n
        a, b = pts[i], pts[j]
        out = ((a[0] + b[0]) / 2 - cx, 0, (a[1] + b[1]) / 2 - cz)
        # basin wall (inside, facing the water)
        T.opoly(D, [(a[0], -0.55, a[1]), (b[0], -0.55, b[1]), (b[0], 0.0, b[1]), (a[0], 0.0, a[1])], WALLS, G.mul(out, -1))
        # curb stones: 0.28 wide, 0.12 proud, tilted joints
        oa = (cx + (a[0] - cx) * 1.1, cz + (a[1] - cz) * 1.1)
        ob = (cx + (b[0] - cx) * 1.1, cz + (b[1] - cz) * 1.1)
        y = 0.12
        T.opoly(D, [(a[0], y, a[1]), (b[0], y, b[1]), (ob[0], y, ob[1]), (oa[0], y, oa[1])], GRAN.t(G.mul(GRAN.col, 0.94 + 0.08 * ((i * 7) % 3) / 2)), (0, 1, 0))
        T.opoly(D, [(oa[0], 0.0, oa[1]), (ob[0], 0.0, ob[1]), (ob[0], y, ob[1]), (oa[0], y, oa[1])], GRAN, out)
        T.opoly(D, [(a[0], -0.02, a[1]), (b[0], -0.02, b[1]), (b[0], y, b[1]), (a[0], y, a[1])], GRAN, G.mul(out, -1))
    # the bridge (홍예): a granite arch slab across the waist, along z at x 7
    bx = 7.0
    zs = [3.95 + (8.05 - 3.95) * k / 8 for k in range(9)]
    prof = [0.1 + 0.32 * math.sin(math.pi * k / 8) for k in range(9)]
    for k in range(8):
        za, zb = zs[k], zs[k + 1]
        ya, yb = prof[k], prof[k + 1]
        T.opoly(D, [(bx - 0.42, ya, za), (bx + 0.42, ya, za), (bx + 0.42, yb, zb), (bx - 0.42, yb, zb)], GRAN.u((1, 0, 0)), (0, 1, 0))
        T.opoly(D, [(bx - 0.42, ya - 0.22, za), (bx + 0.42, ya - 0.22, za), (bx + 0.42, yb - 0.22, zb), (bx - 0.42, yb - 0.22, zb)], GRAN, (0, -1, 0))
        for sx in (-1, 1):
            T.opoly(D, [(bx + sx * 0.42, ya - 0.22, za), (bx + sx * 0.42, yb - 0.22, zb), (bx + sx * 0.42, yb, zb), (bx + sx * 0.42, ya, za)], GRAN, (sx, 0, 0))
            # low granite rails
            D.member((bx + sx * 0.37, ya + 0.0, za), (bx + sx * 0.37, yb + 0.0, zb), [(-0.05, 0.0), (0.05, 0.0), (0.05, 0.16), (-0.05, 0.16)], GRAN)
    # 마사토 between the rim's outer edge and the pond's box
    outer = [(cx + (x - cx) * 1.1, cz + (z - cz) * 1.1) for x, z in pts]
    box = []
    for x, z in outer:
        a = math.atan2(-(z - cz), x - cx)
        ca, sa = math.cos(a), -math.sin(a)
        k = min(3.0 / abs(ca) if abs(ca) > 1e-6 else 1e9, 3.0 / abs(sa) if abs(sa) > 1e-6 else 1e9)
        box.append((cx + ca * k, cz + sa * k))
    for i in range(n):
        j = (i + 1) % n
        T.opoly(D, [(outer[i][0], 0.012, outer[i][1]), (outer[j][0], 0.012, outer[j][1]), (box[j][0], 0.012, box[j][1]), (box[i][0], 0.012, box[i][1])], GROUND, (0, 1, 0))
    for i in range(n):
        # the box's corners (the ring reaches the box edge along rays): fill the triangle round each corner
        j = (i + 1) % n
        a, b = box[i], box[j]
        if abs(a[0] - b[0]) > 1e-6 and abs(a[1] - b[1]) > 1e-6:
            corner = (a[0] if abs(abs(a[0] - cx) - 3.0) < 1e-6 else b[0], a[1] if abs(abs(a[1] - cz) - 3.0) < 1e-6 else b[1])
            T.opoly(D, [(a[0], 0.012, a[1]), (corner[0], 0.012, corner[1]), (b[0], 0.012, b[1])], GROUND, (0, 1, 0))
    rg = G.rng(77)
    leaves = 0
    while leaves < 24:
        a = rg.uniform(0, 2 * math.pi)
        rr = rg.uniform(0.3, 2.2)
        x, z = cx + rr * math.cos(a) * 1.05, cz - rr * math.sin(a) * 0.8
        if abs(x - bx) < 0.75:
            continue
        place(kit, "lotus_leaf", lambda: lotus_leaf_kind(), x, yw + 0.02, z, rg.uniform(0, 6.28))
        leaves += 1
    for (x, z) in ((5.4, 5.2), (6.0, 7.1), (8.4, 4.8), (8.9, 6.9), (5.0, 6.4), (8.2, 7.6)):
        place(kit, "lotus_flower", lambda: lotus_flower_kind(), x, yw + 0.02, z, rg.uniform(0, 6.28))
    # stepping rocks set into the rim (low, walk-over)
    for (x, z, rr) in ((4.3, 3.6, 0.32), (9.7, 8.5, 0.36), (9.8, 3.7, 0.28), (4.2, 8.4, 0.3)):
        D.sphere(x, 0.0, z, rr, ROCK.t(G.hexc("B7AFA4")), n=7, rings=3, sy=0.55)


def lotus_leaf_kind():
    m = Mesh("lotus_leaf")
    n = 9
    r = 0.3
    c = (0.0, 0.035, 0.0)
    ring = []
    for i in range(n + 1):
        a = 0.25 + (2 * math.pi - 0.5) * i / n   # a notch at the stem
        ring.append((r * math.cos(a), 0.0 + 0.025 * math.sin(3 * a), -r * math.sin(a)))
    for i in range(n):
        T.opoly(m, [c, ring[i], ring[i + 1]], LOTUS_LEAF, (0, 1, 0))
    T.opoly(m, [c, ring[-1], ring[0]], LOTUS_LEAF, (0, 1, 0)) if False else None
    return m


def lotus_flower_kind():
    m = Mesh("lotus_flower")
    PINK = S("LM_temple_dancheong", (1.0, 1.0, 1.0))
    for layer, (n, L, up, y) in enumerate(((7, 0.13, 0.9, 0.05), (6, 0.1, 1.25, 0.07))):
        for i in range(n):
            a = 2 * math.pi * (i + layer * 0.5) / n
            d = (math.cos(a), 0.0, -math.sin(a))
            base = (d[0] * 0.03, y, d[2] * 0.03)
            tip = (d[0] * L * 0.7, y + L * up, d[2] * L * 0.7)
            side = (-d[2], 0.0, d[0])
            l = G.add(G.add(base, G.mul(d, L * 0.45)), G.add(G.mul(side, 0.045), (0, L * up * 0.35, 0)))
            rr = G.add(G.add(base, G.mul(d, L * 0.45)), G.add(G.mul(side, -0.045), (0, L * up * 0.35, 0)))
            pts = [base, rr, tip, l]
            T.apoly(m, pts, PINK, "lotus_paper", [(0.45, 0.02), (0.55, 0.02), (0.55, 0.2), (0.45, 0.2)], out=(d[0], 0.3, d[2]))
            T.apoly(m, pts[::-1], PINK, "lotus_paper", [(0.45, 0.2), (0.55, 0.2), (0.55, 0.02), (0.45, 0.02)])
    m.sphere(0.0, 0.08, 0.0, 0.035, S("LM_temple_dancheong", G.hexc("F2C64A")), n=6, rings=3)
    m.member((0.0, -0.1, 0.0), (0.0, 0.06, 0.0), G.prof_round(0.01, 4), LOTUS_LEAF)
    return m


# ------------------------------------------------------------------------------------------------ 소나무 --

def pines(kit):
    """Four Korean red pines (소나무): a trunk rising straight inside its collider to 2.2 m, then leaning and twisting, grey
    plated bark below turning red-orange above, a few long limbs, flat layered needle pads (clouds) high in the crown; every
    pad stays inside the footprint."""
    spec = [((-10.0, 7.8), 6.8, (1.0, -0.25), 11), ((-9.5, -1.2), 7.6, (0.9, 0.35), 12), ((10.0, -4.9), 7.2, (-1.0, 0.3), 13), ((8.6, 10.9), 6.4, (-0.6, -0.8), 14)]
    for (x, z), H, lean, seed in spec:
        pine(kit.D, x, z, H, lean, seed)


def pine(m, x, z, H, lean, seed):
    rg = G.rng(seed)
    ln = G.norm((lean[0], 0.0, lean[1]))
    # the trunk: straight inside its collider to 2.2 m, then a slow S-curve leaning toward `lean`
    path = [(x, -0.05, z), (x, 1.1, z), (x + ln[0] * 0.03, 2.2, z + ln[2] * 0.03)]
    p = path[-1]
    seg = (H - 2.4) / 5
    for k in range(5):
        bend = (0.55, 0.35, 0.1, -0.15, -0.3)[k]
        side = rg.uniform(-0.25, 0.25)
        d = G.norm((ln[0] * bend + side * ln[2], 1.0, ln[2] * bend - side * ln[0]))
        p = G.add(p, G.mul(d, seg))
        path.append(p)
    radii = [0.27, 0.25, 0.23, 0.21, 0.18, 0.15, 0.12, 0.09]
    for k in range(len(path) - 1):
        a, b = path[k], path[k + 1]
        r0, r1 = radii[k], radii[k + 1]
        s = BARK_LO if k < 2 else BARK
        prof_n = 7
        da = G.norm(G.sub(b, a))
        side = G.norm(G.cross(da, (0, 0, 1) if abs(da[2]) < 0.9 else (1, 0, 0)))
        up2 = G.cross(side, da)
        ra = [G.add(a, G.add(G.mul(side, r0 * math.cos(2 * math.pi * i / prof_n)), G.mul(up2, r0 * math.sin(2 * math.pi * i / prof_n)))) for i in range(prof_n)]
        rb = [G.add(b, G.add(G.mul(side, r1 * math.cos(2 * math.pi * i / prof_n)), G.mul(up2, r1 * math.sin(2 * math.pi * i / prof_n)))) for i in range(prof_n)]
        Lseg = math.dist(a, b)
        for i in range(prof_n):
            j = (i + 1) % prof_n
            mid = G.sub(G.mul(G.add(ra[i], ra[j]), 0.5), a)
            T.opoly(m, [ra[i], ra[j], rb[j], rb[i]], s, mid, [(i * 0.35, 0.0), ((i + 1) * 0.35, 0.0), ((i + 1) * 0.35, Lseg), (i * 0.35, Lseg)])
    # branches from the upper trunk, each ending in a needle cloud; a broad cloud crowns the top
    clouds = [(path[-1], 1.25, 0.55)]
    for k in range(7):
        f = 0.3 + 0.1 * k
        i0 = 3 + int(f * 4.99)
        base = G.lerp(path[min(i0, len(path) - 2)], path[min(i0 + 1, len(path) - 1)], (f * 5) % 1)
        az = rg.uniform(0, 2 * math.pi) if k else math.atan2(-ln[2], ln[0])
        az += k * 2.4
        Lb = rg.uniform(0.9, 1.6) * (1.15 - f * 0.5)
        mid = (base[0] + math.cos(az) * Lb * 0.55, base[1] + rg.uniform(0.0, 0.3), base[2] - math.sin(az) * Lb * 0.55)
        end = (base[0] + math.cos(az) * Lb, base[1] + rg.uniform(0.15, 0.45), base[2] - math.sin(az) * Lb)
        m.tube([base, mid, end], 0.06 - k * 0.005, 4, BARK)
        clouds.append((end, rg.uniform(0.75, 1.05) * (1.1 - f * 0.4), rg.uniform(0.3, 0.42)))
    for (c, R, Hh) in clouds:
        cx, cy, cz = c
        R = min(R, 11.85 - abs(cx), 12.85 - abs(cz))
        cy = max(cy, 2.75 + Hh)
        n = 9
        rings = []
        for (rf, yf) in ((0.55, -0.55), (1.0, -0.1), (0.85, 0.35), (0.4, 0.75)):
            ring = []
            for i in range(n):
                a = 2 * math.pi * i / n
                j = rg.uniform(0.8, 1.15)
                ring.append((cx + R * rf * j * math.cos(a), cy + Hh * yf + rg.uniform(-0.04, 0.06), cz - R * rf * j * math.sin(a)))
            rings.append(ring)
        top = (cx, cy + Hh * 0.95, cz)
        bot = (cx, cy - Hh * 0.7, cz)
        cols = [NEEDLE_DK, NEEDLE, NEEDLE_UP, NEEDLE_UP]
        for k in range(3):
            for i in range(n):
                j = (i + 1) % n
                A, B = rings[k], rings[k + 1]
                T.opoly(m, [A[i], A[j], B[j], B[i]], cols[k + 1] if k else cols[0], (A[i][0] - cx, 0.3 * (k - 1), A[i][2] - cz), smooth=True)
        for i in range(n):
            j = (i + 1) % n
            T.opoly(m, [rings[3][i], rings[3][j], top], NEEDLE_UP, (0, 1, 0), smooth=True)
            T.opoly(m, [rings[0][j], rings[0][i], bot], NEEDLE_DK, (0, -1, 0), smooth=True)


# ------------------------------------------------------------------------------------------------ 돌의자 --

def benches(kit):
    """Two granite benches (seat top 0.45, 0.44 deep: inside L5's seat box) on two dressed legs each."""
    D = kit.D
    for (x, z, along) in ((-8.0, 4.2, "z"), (7.0, 1.0, "x")):
        if along == "z":
            D.cbox(x - 0.21, x + 0.21, 0.36, 0.45, z - 0.88, z + 0.88, GRAN.u((0, 0, 1)), c=0.02)
            for dz in (-0.6, 0.6):
                D.cbox(x - 0.16, x + 0.16, 0.0, 0.36, z + dz - 0.1, z + dz + 0.1, GRAN, c=0.015, skip=("-y",))
        else:
            D.cbox(x - 0.88, x + 0.88, 0.36, 0.45, z - 0.21, z + 0.21, GRAN.u((1, 0, 0)), c=0.02)
            for dx in (-0.6, 0.6):
                D.cbox(x + dx - 0.1, x + dx + 0.1, 0.0, 0.36, z - 0.16, z + 0.16, GRAN, c=0.015, skip=("-y",))


# ------------------------------------------------------------------------------------------------ preview ground --

def ground(kit):
    g = kit.ground
    g.poly([(-40, -0.02, -40), (-40, -0.02, 40), (40, -0.02, 40), (40, -0.02, -40)][::-1], S("PV_grass"))
    g.poly([(-30, -0.005, 13.0), (-30, -0.005, 17.0), (30, -0.005, 17.0), (30, -0.005, 13.0)][::-1], S("PV_lane"))
