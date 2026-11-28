"""대웅전 안 (lot_temple_hall, interior area lot:lot_temple_hall at (410, 40), 11.4 x 7.4, ceiling 6) — the walk-in room kit
(design 11, contract 11, `LOT_INTERIORS` TEMPLE_IN), pure python on b1_geom / temple_parts.

A real 대웅전 that takes the breath away (owner 2026-11-17: "건물안에 들어와서 눈을 못 뗄 정도로 정교하고 실제스럽고 입체적으로"):
a polished 우물마루 of pale pine with darker 귀틀, ten 배흘림 wall columns in 석간주 with 주의초, 머리초 beams round the walls
carrying 다포 brackets inside, a 빗반자 and a coffered 우물반자 of 연화 panels; the front wall all 꽃살 doors and windows
(carved 빗꽃살 lattice with flower bosses in front of glowing 창호지); the 수미단 of carved and painted peony panels in gilt
frames under the three figures (본존불 and two 협시보살: the B3s real scans, placed by `lotstatue__` markers), the 후불탱화
behind them (`lotart__` marker), an ornate gilt 닫집 hanging over the 본존불 (bracketed canopy, tiered roofs, a carved valance,
a coffered 보개, bead tassels); the 공양상 (brass candlesticks with candles burning, an incense burner with three sticks,
two vases of lotus and peony, two raised plates of fruit), a small bell and a 법고 drum at the sides, rows of pink and white
연등 hanging from the ceiling, twelve 방석. Brand-new, tidy, softly warm. No 卍, no letters, no scripture.

Materials: dancheong_wood (atlas: 단청, 꽃살, 연등 paper, gilt; the bronze and brass are its gold-leaf strip, metal), wood_pine_natural
(floor, 목탁), fabric_upholstery (방석), M_screen (창호지 daylight, candle flames).
"""
import math

import b1_geom as G
import b1_parts as P
import flora as F
import temple_parts as T
from b1_geom import Mesh, S
from temple_atlas import ruv

DAN = S("LM_temple_dancheong")
# the offering vases' petals: their own material (the same dancheong set, on its flat painted strip) so the game gives them a
# flower's translucent fill (LotRoom.tsx `_petal`): lit only by the hall's lamps and its low fill they read dusty grey-pink
# (props round 3, 2026-11-27 — the church altar flowers' fix, e9a67ec0)
PETAL = S("LM_temple_petal")
PINE = S("LM_temple_pine")
PINE_DK = S("LM_temple_pine", G.hexc("B98A62"))
FAB = S("LM_temple_fabric")
SCREEN = S("M_screen")

MATS = {
    "LM_temple_dancheong": {"set": "dancheong_wood"},
    "LM_temple_petal": {"set": "dancheong_wood", "rough": 0.6},
    "LM_temple_pine": {"set": "wood_pine_natural", "rough": 0.7},
    "LM_temple_fabric": {"set": "fabric_upholstery"},
    "M_screen": {"screen": True},
    "M_glass": {"glass": True},
}

X, Z, H = 11.4, 7.4, 6.0
COLS_X = (0.0, 3.8, 7.6, 11.4)
WALL_TOP = 3.9            # 창방 underside
CHANG = (3.9, 4.2)
PYEONG = (4.2, 4.36)
FLAT_Y = 5.82             # 우물반자
PAPER_DAY = (1.0, 0.95, 0.84)

# the sacred props' places (contract 11: `lotstatue__<unit>_<name>`; the files: client/public/models/village/lots/sacred/)
SACRED = [
    {"node": "lotstatue__lot_temple_hall_buddha", "file": "sacred/lotstatue__lot_temple_hall_buddha.glb", "phone": "sacred/lotstatue__lot_temple_hall_buddha_phone.glb",
     "at": (5.7, 1.1, 6.4), "yaw": math.pi, "mirror": False},
    {"node": "lotstatue__lot_temple_hall_buddha_halo", "file": "sacred/lotstatue__lot_temple_hall_buddha_halo.glb", "phone": "sacred/lotstatue__lot_temple_hall_buddha_halo_phone.glb",
     "at": (5.7, 1.1, 6.4), "yaw": math.pi, "mirror": False},
    {"node": "lotstatue__lot_temple_hall_bodhisattva_l", "file": "sacred/lotstatue__lot_temple_hall_bodhisattva.glb", "phone": "sacred/lotstatue__lot_temple_hall_bodhisattva_phone.glb",
     "at": (3.55, 1.1, 6.45), "yaw": math.pi, "mirror": False},
    {"node": "lotstatue__lot_temple_hall_bodhisattva_r", "file": "sacred/lotstatue__lot_temple_hall_bodhisattva.glb", "phone": "sacred/lotstatue__lot_temple_hall_bodhisattva_phone.glb",
     "at": (7.85, 1.1, 6.45), "yaw": math.pi, "mirror": True},
    {"node": "lotart__lot_temple_hall_taenghwa", "file": "sacred/lotart__lot_temple_hall_taenghwa.glb", "phone": "sacred/lotart__lot_temple_hall_taenghwa_phone.glb",
     "at": (5.7, 2.15, 7.17), "yaw": math.pi, "mirror": False},
    {"node": "lotart__lot_temple_hall_scroll_l", "file": "sacred/lotart__lot_temple_hall_scroll.glb", "phone": "sacred/lotart__lot_temple_hall_scroll_phone.glb",
     "at": (1.85, 1.3, 7.36), "yaw": math.pi, "mirror": False},
    {"node": "lotart__lot_temple_hall_scroll_r", "file": "sacred/lotart__lot_temple_hall_scroll.glb", "phone": "sacred/lotart__lot_temple_hall_scroll_phone.glb",
     "at": (9.55, 1.3, 7.36), "yaw": math.pi, "mirror": True},
]


def gold(m, sub=None):
    """Re-map a part to the atlas's gold-leaf strip (dancheong_wood is metal there): brass, bronze, gilt."""
    for p in (sub or m).polys:
        p.uv = [ruv("gold_scroll", 0.1 + 0.8 * ((u * 0.37) % 1.0), 0.98) for (u, v) in p.uv]
        p.mat = "LM_temple_dancheong"
        p.col = [(1.0, 1.0, 1.0, 1.0)] * len(p.pts)
    return m


def painted(m, col, region="paint"):
    """Re-map a part to a flat painted region (tinted)."""
    for p in m.polys:
        p.uv = [ruv(region, 0.2 + 0.6 * ((u * 0.5) % 1.0), 0.2 + 0.6 * ((v * 0.5) % 1.0)) for (u, v) in p.uv]
        p.mat = "LM_temple_dancheong"
        p.col = [(col[0], col[1], col[2], 1.0)] * len(p.pts)
    return m


def paint_keep(m, start, region="paint"):
    """flora.py parts on the atlas's flat painted strip, KEEPING their vertex colours (petal gradients, the bell's dark
    hollow): painted() would flatten them to one tint. Petals (PETAL) keep their own material on the same strip."""
    for p in m.polys[start:]:
        p.uv = [ruv(region, 0.5 + 0.004 * (k % 2), 0.5 + 0.004 * ((k // 2) % 2)) for k in range(len(p.pts))]
        p.mat = PETAL.mat if p.mat == PETAL.mat else "LM_temple_dancheong"


def gild_keep(m, start):
    """flora.py parts on the gold-leaf strip (metal), keeping their vertex colours."""
    for i, p in enumerate(m.polys[start:]):
        u = 0.1 + 0.8 * ((i * 0.137) % 1.0)
        p.uv = [ruv("gold_scroll", u + 0.004 * (k % 2), 0.98) for k in range(len(p.pts))]
        p.mat = "LM_temple_dancheong"


def build(spec, unit, layout):
    kit = P.Kit(None)
    kit.mats = dict(MATS)
    kit.sacred = SACRED
    floor(kit)
    walls(kit)
    front_wall(kit)
    columns_beams(kit)
    ceiling(kit)
    sumidan(kit)
    datjip(kit)
    offering(kit)
    side_pieces(kit)
    lanterns(kit)
    cushions(kit, spec)
    # light: the 창호지 front glows with daylight, warm lamps and candles, soft accents on the figures (render only)
    kit.sun_dir = (0.0, 0.0, -1.0)
    kit.sun_elev = 30
    kit.world_strength = 0.12
    kit.look = "AgX - Medium High Contrast"
    kit.exposure = 0.55
    kit.haze = (0.3, X - 0.3, 0.0, H - 0.3, 0.3, Z - 0.3, 0.003)
    for x in (1.9, 5.7, 9.5):
        kit.dayfill.append((x, 2.2, 0.5, 2.5, 160.0))
    kit.dayfill.append((5.7, 5.2, 4.0, 2.0, 90.0))
    for (x, y, z, w) in ((5.7, 4.3, 4.6, 70.0), (3.5, 4.0, 5.0, 35.0), (7.9, 4.0, 5.0, 35.0)):
        kit.dayfill.append((x, y, z, 0.8, w))
    for (x, y, z, c, w) in ((5.7, 4.2, 4.5, (1.0, 0.8, 0.55), 120.0), (2.2, 3.4, 2.5, (1.0, 0.76, 0.5), 90.0), (9.2, 3.4, 2.5, (1.0, 0.76, 0.5), 90.0),
                            (5.7, 3.2, 1.5, (1.0, 0.78, 0.55), 110.0)):
        kit.lights.append(("point", x, y, z, c, w))
    return kit


# ------------------------------------------------------------------------------------------------ floor --

def floor(kit):
    """우물마루: short pale pine boards between long darker 장귀틀 (along x) and 동귀틀 (across), flush."""
    S_ = kit.S
    S_.poly([(0, 0, 0), (0, 0, Z), (X, 0, Z), (X, 0, 0)], PINE.u((0, 0, 1)))
    for z in (0.0, 1.85, 3.7, 5.55, 7.4):
        kit.D.box(0.0, X, 0.0, 0.004, max(0.0, z - 0.07), min(Z, z + 0.07), PINE_DK.u((1, 0, 0)), skip=("-y",))
    for k in range(1, 19):
        x = k * X / 19
        for (a, b) in ((0.07, 1.78), (1.92, 3.63), (3.77, 5.48), (5.62, 7.33)):
            kit.D.box(x - 0.05, x + 0.05, 0.0, 0.003, a, b, PINE_DK.u((0, 0, 1)), skip=("-y",))


# ------------------------------------------------------------------------------------------------ walls --

def wall_face(m, pts, s, region="paint", st=((0.1, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9)), out=None):
    T.apoly(m, pts, s, region, list(st), out=out)


def walls(kit):
    """Side and back walls: a 석간주 skirting board, warm lime plaster, a 중방 rail, the 포벽 band painted with clouds between the
    brackets; the 후불벽 behind the 수미단 in deep red."""
    S_, D = kit.S, kit.D
    plaster = DAN.t(T.CREAM)
    for (x, out) in ((0.0, (1, 0, 0)), (X, (-1, 0, 0))):
        for (z0, z1, y0, y1) in ((0.0, 0.6, 0.0, WALL_TOP), (3.1, Z, 0.0, WALL_TOP), (0.6, 3.1, 0.0, 0.98), (0.6, 3.1, 2.72, WALL_TOP)):
            wall_face(S_, [(x, y0, z0), (x, y0, z1), (x, y1, z1), (x, y1, z0)], plaster, out=out)
        sg = out[0]
        D.box(min(x, x + sg * 0.03), max(x, x + sg * 0.03), 0.0, 0.42, 0.0, Z, DAN.t(T.SEOK))
        D.box(min(x, x + sg * 0.03), max(x, x + sg * 0.03), 1.95, 2.1, 3.1, Z, DAN.t(T.SEOK))
        # painted 별화 panels in the upper wall of the back bay (lotus rosettes in frames), the window in the front bay
        for (z0, z1) in ((4.25, 6.85),):
            wall_face(D, [(x + sg * 0.012, 2.3, z0), (x + sg * 0.012, 2.3, z1), (x + sg * 0.012, 3.75, z1), (x + sg * 0.012, 3.75, z0)], DAN, "coffer",
                      ((0, 0), (1, 0), (1, 1), (0, 1)), out=out)
            for (a, b, c_, d) in ((z0 - 0.06, z0, 2.24, 3.81), (z1, z1 + 0.06, 2.24, 3.81), (z0, z1, 2.24, 2.3), (z0, z1, 3.75, 3.81)):
                D.box(min(x, x + sg * 0.035), max(x, x + sg * 0.035), c_, d, a, b, DAN.t(T.SEOK))
        side_window(kit, x, sg)
        # over the window: a painted band of 공포-scroll panels; under the 창방 of the back bay: a gilt 넝쿨 frieze
        for (z0, z1, y0, y1, reg) in ((0.6, 1.85, 2.85, 3.75, "bracket"), (1.85, 3.1, 2.85, 3.75, "bracket"), (3.96, 7.14, 3.82, 3.9, "gold_scroll")):
            wall_face(D, [(x + sg * 0.012, y0, z0), (x + sg * 0.012, y0, z1), (x + sg * 0.012, y1, z1), (x + sg * 0.012, y1, z0)], DAN, reg,
                      ((0.05, 0.05), (0.95, 0.05), (0.95, 0.95), (0.05, 0.95)) if reg != "gold_scroll" else ((0, 0.45), (1, 0.45), (1, 0.55), (0, 0.55)), out=out)
    # back wall and the 후불벽
    wall_face(S_, [(X, 0, Z), (0, 0, Z), (0, WALL_TOP, Z), (X, WALL_TOP, Z)], plaster, out=(0, 0, -1))
    D.box(0.0, X, 0.0, 0.42, Z - 0.03, Z, DAN.t(T.SEOK))
    D.box(2.9, 8.5, 1.1, WALL_TOP, Z - 0.22, Z - 0.18, DAN.t(T.SEOK_DK), skip=("+z",))
    for (a, b) in ((2.9, 3.0), (8.4, 8.5)):
        D.box(a, b, 1.1, WALL_TOP, Z - 0.26, Z - 0.14, DAN, skip=("+z",))
    # the band above: cloud-painted 포벽 under the 평방 all round
    for (pts, out) in (([(0.02, PYEONG[1], 0.02), (0.02, PYEONG[1], Z - 0.02), (0.02, PYEONG[1] + 0.72, Z - 0.02), (0.02, PYEONG[1] + 0.72, 0.02)], (1, 0, 0)),
                       ([(X - 0.02, PYEONG[1], Z - 0.02), (X - 0.02, PYEONG[1], 0.02), (X - 0.02, PYEONG[1] + 0.72, 0.02), (X - 0.02, PYEONG[1] + 0.72, Z - 0.02)], (-1, 0, 0)),
                       ([(X - 0.02, PYEONG[1], Z - 0.02), (0.02, PYEONG[1], Z - 0.02), (0.02, PYEONG[1] + 0.72, Z - 0.02), (X - 0.02, PYEONG[1] + 0.72, Z - 0.02)], (0, 0, -1)),
                       ([(0.02, PYEONG[1], 0.02), (X - 0.02, PYEONG[1], 0.02), (X - 0.02, PYEONG[1] + 0.72, 0.02), (0.02, PYEONG[1] + 0.72, 0.02)], (0, 0, 1))):
        wall_face(S_, pts, DAN.t(T.LOK), "paint", out=out)


def lattice(kit, m, f, u0, u1, v0, v1, step=0.24, bar=0.024):
    """빗꽃살 seen from inside: diagonal bars (both ways) in a frame, a carved four-petal flower boss at every crossing (instanced),
    glowing 창호지 behind. `f` = the wall frame (W = into the room)."""
    # the paper (M_screen: daylight through 창호지), 6 cm behind the lattice
    q = [f.p(u0, v0, -0.1), f.p(u1, v0, -0.1), f.p(u1, v1, -0.1), f.p(u0, v1, -0.1)]
    cols = [(*PAPER_DAY, 1.0)] * 4
    m.poly(q, SCREEN, cols=cols)
    # bars: lines u = c + v and u = c - v, clipped to the rect; a flower boss on every crossing
    base = u0 - 2 * (v1 - v0) - 4 * step
    cs = [base + k * step for k in range(int((u1 - u0 + 4 * (v1 - v0)) / step) + 10)]
    for sgn in (1, -1):
        for c in cs:
            pts = []
            for v in (v0, v1):
                u = c + sgn * v
                if u0 <= u <= u1:
                    pts.append((u, v))
            for u in (u0, u1):
                v = (u - c) * sgn
                if v0 <= v <= v1:
                    pts.append((u, v))
            pts = sorted(set((round(a_, 5), round(b_, 5)) for a_, b_ in pts))
            if len(pts) >= 2:
                (ua, va), (ub, vb) = pts[0], pts[-1]
                if math.dist((ua, va), (ub, vb)) > 0.05:
                    m.member(f.p(ua, va, -0.06), f.p(ub, vb, -0.06), G.prof_box(bar, 0.035), DAN.t(T.SEOK))
    yaw = math.atan2(f.W[0], f.W[2])
    for c1 in cs:
        for c2 in cs:
            v = (c2 - c1) / 2.0
            u = (c1 + c2) / 2.0
            if u0 + 0.04 < u < u1 - 0.04 and v0 + 0.04 < v < v1 - 0.04:
                p = f.p(u, v, -0.035)
                kit.place("kkot", KKOT, p[0], p[1], p[2], yaw)
    # the frame
    for (a, b, c_, d) in ((u0 - 0.07, u0, v0 - 0.07, v1 + 0.07), (u1, u1 + 0.07, v0 - 0.07, v1 + 0.07), (u0, u1, v0 - 0.07, v0), (u0, u1, v1, v1 + 0.07)):
        f.box(m, a, b, c_, d, -0.12, 0.03, DAN.t(T.SEOK))


def kkot_kind():
    """A carved four-petal flower boss (kind-local: facing +z): green leaves, red-pink petals graded, a gold heart."""
    m = Mesh("kkot")
    for k, (r0, r1, col, ph, y) in enumerate(((0.012, 0.068, G.hexc("3E9A5E"), math.pi / 4, 0.0), (0.01, 0.05, G.hexc("E0584A"), 0.0, 0.006))):
        for i in range(4):
            a = ph + i * math.pi / 2
            d = (math.cos(a), math.sin(a))
            s_ = (-d[1], d[0])
            base = (d[0] * r0, d[1] * r0, y)
            tip = (d[0] * r1, d[1] * r1, y + 0.004)
            l = (d[0] * r1 * 0.55 + s_[0] * r1 * 0.32, d[1] * r1 * 0.55 + s_[1] * r1 * 0.32, y + 0.012)
            r = (d[0] * r1 * 0.55 - s_[0] * r1 * 0.32, d[1] * r1 * 0.55 - s_[1] * r1 * 0.32, y + 0.012)
            T.apoly(m, [base, r, tip, l], DAN.t(col), "paint", [(0.3, 0.3), (0.5, 0.3), (0.5, 0.6), (0.3, 0.6)], out=(0, 0, 1))
    m.sphere(0.0, 0.0, 0.012, 0.016, DAN.t(G.hexc("F2C64A")), n=6, rings=3) if False else None
    T.apoly(m, [(-0.014, -0.014, 0.016), (0.014, -0.014, 0.016), (0.014, 0.014, 0.016), (-0.014, 0.014, 0.016)], DAN.t(G.hexc("F2C64A")), "paint",
            [(0.3, 0.3), (0.5, 0.3), (0.5, 0.6), (0.3, 0.6)], out=(0, 0, 1))
    # the kind's local frame: x right, y up, z out (instances turn with yaw only)
    return m


KKOT = kkot_kind()


def side_window(kit, x, sg):
    """A 꽃살창 in the front bay of each side wall (z 0.6..3.1, sill 1.0)."""
    f = P.F((x, 0.0, 0.0), (0, 0, 1) if sg < 0 else (0, 0, -1), (sg, 0, 0))
    # u along the wall as seen from inside: for the left wall (x = 0, W = +x) U = -z... keep a frame whose u grows with z
    f = P.F((x, 0.0, 0.0 if sg > 0 else 0.0), (0, 0, -1) if sg > 0 else (0, 0, 1), (sg, 0, 0))
    if sg > 0:
        u0, u1 = -3.1, -0.6
    else:
        u0, u1 = 0.6, 3.1
    lattice(kit, kit.D, f, u0, u1, 1.05, 2.65)
    mid = (u0 + u1) / 2
    f.box(kit.D, mid - 0.035, mid + 0.035, 1.05, 2.65, -0.12, 0.03, DAN.t(T.SEOK))


def front_wall(kit):
    """The front (door) wall from inside: three bays of 꽃살 — the two doors of the centre bay (closed: the exit), two pairs of
    windows on a 머름 in the side bays, a 띠살 transom of 창호지 above, all glowing with daylight."""
    D = kit.D
    f = P.F((0.0, 0.0, 0.0), (1, 0, 0), (0, 0, 1))  # u = x, W = +z (into the room)
    for (a, b) in ((0.26, 3.54), (7.86, 11.14)):
        D.box(a, b, 0.0, 0.62, -0.08, 0.03, DAN.t(T.SEOK))
        for (u0, u1) in ((a + 0.1, (a + b) / 2 - 0.04), ((a + b) / 2 + 0.04, b - 0.1)):
            T.apoly(D, [(u0, 0.08, 0.035), (u1, 0.08, 0.035), (u1, 0.54, 0.035), (u0, 0.54, 0.035)], DAN, "cloud", [(0.1, 0.35), (0.9, 0.35), (0.9, 0.65), (0.1, 0.65)], out=(0, 0, 1))
        mid = (a + b) / 2
        lattice(kit, D, f, a + 0.07, mid - 0.04, 0.7, 2.95)
        lattice(kit, D, f, mid + 0.04, b - 0.07, 0.7, 2.95)
        transom(kit, f, a, b)
    # the doors (4.2..7.2)
    lattice(kit, D, f, 4.27, 5.66, 0.75, 2.9)
    lattice(kit, D, f, 5.74, 7.13, 0.75, 2.9)
    for (u0, u1) in ((4.27, 5.66), (5.74, 7.13)):
        f.box(D, u0 - 0.07, u1 + 0.07, 0.05, 0.68, -0.08, 0.03, DAN.t(T.SEOK))
        T.apoly(D, [(u0, 0.12, 0.035), (u1, 0.12, 0.035), (u1, 0.62, 0.035), (u0, 0.62, 0.035)], DAN, "cloud", [(0.1, 0.35), (0.9, 0.35), (0.9, 0.65), (0.1, 0.65)], out=(0, 0, 1))
        hx = u1 - 0.1 if u0 < 5.7 else u0 + 0.1
        g = Mesh("ring")
        g.tube([(hx, 1.45, 0.04), (hx + 0.045, 1.37, 0.045), (hx, 1.29, 0.045), (hx - 0.045, 1.37, 0.045), (hx, 1.45, 0.04)], 0.008, 4, DAN)
        g.box(hx - 0.04, hx + 0.04, 1.43, 1.5, 0.03, 0.045, DAN)
        D.extend(gold(g))
    D.box(4.12, 7.28, 2.97, 3.05, -0.08, 0.04, DAN.t(T.SEOK))
    transom(kit, f, 4.12, 7.28)
    # door posts
    for (a, b) in ((3.54 + 0.0, 3.62), (4.12, 4.2), (7.2, 7.28), (7.78, 7.86)):
        D.box(a, b, 0.0, WALL_TOP, -0.1, 0.04, DAN.t(T.SEOK))
    D.box(3.62, 4.12, 0.0, WALL_TOP, -0.02, 0.0, DAN.t(T.CREAM)) if False else None
    for (a, b) in ((3.62, 4.12), (7.28, 7.78)):
        T.apoly(D, [(a, 0.0, 0.0), (b, 0.0, 0.0), (b, WALL_TOP, 0.0), (a, WALL_TOP, 0.0)], DAN.t(T.CREAM), "paint", [(0.1, 0.1), (0.2, 0.1), (0.2, 0.9), (0.1, 0.9)], out=(0, 0, 1))


def transom(kit, f, a, b):
    """띠살 transom (광창) between y 3.05 and the 창방: vertical slats in groups, 창호지 glowing behind."""
    D = kit.D
    q = [f.p(a, 3.05, -0.1), f.p(b, 3.05, -0.1), f.p(b, WALL_TOP, -0.1), f.p(a, WALL_TOP, -0.1)]
    D.poly(q, SCREEN, cols=[(*PAPER_DAY, 1.0)] * 4)
    n = int((b - a) / 0.09)
    for k in range(1, n):
        u = a + (b - a) * k / n
        f.box(D, u - 0.012, u + 0.012, 3.05, WALL_TOP, -0.08, -0.04, DAN.t(T.SEOK))
    for v in (3.35, 3.62):
        f.box(D, a, b, v - 0.012, v + 0.012, -0.08, -0.03, DAN.t(T.SEOK))
    f.box(D, a, b, 3.0, 3.07, -0.1, 0.03, DAN.t(T.SEOK))


# ------------------------------------------------------------------------------------------------ columns, beams --

def columns_beams(kit):
    D = kit.D
    for x in COLS_X:
        for z in (0.0, Z):
            T.column(D, DAN, x, z, 0.0, CHANG[1] - 0.02, r=0.235, n=10, head=0.55)
    for z in (Z / 2,):
        for x in (0.0, X):
            T.column(D, DAN, x, z, 0.0, CHANG[1] - 0.02, r=0.235, n=10, head=0.55)
    # 창방 (머리초) and 평방 on the walls' inner faces
    for (a, b) in ((0.0, 3.8), (3.8, 7.6), (7.6, X)):
        T.beam(D, DAN, (a, CHANG[0], 0.13), (b, CHANG[0], 0.13), 0.24, CHANG[1] - CHANG[0], "beam_a")
        T.beam(D, DAN, (a, CHANG[0], Z - 0.13), (b, CHANG[0], Z - 0.13), 0.24, CHANG[1] - CHANG[0], "beam_a")
    for x in (0.13, X - 0.13):
        for (a, b) in ((0.0, Z / 2), (Z / 2, Z)):
            T.beam(D, DAN, (x, CHANG[0], a), (x, CHANG[0], b), 0.24, CHANG[1] - CHANG[0], "beam_a")
    for (a, b, z) in ((0.0, X, 0.16), (0.0, X, Z - 0.16)):
        T.beam(D, DAN, (a, PYEONG[0], z), (b, PYEONG[0], z), 0.32, PYEONG[1] - PYEONG[0], "beam_b", ends=None)
    for x in (0.16, X - 0.16):
        T.beam(D, DAN, (x, PYEONG[0], 0.0), (x, PYEONG[0], Z), 0.32, PYEONG[1] - PYEONG[0], "beam_b", ends=None)
    # the inner halves of the 다포 brackets along all four walls
    gp = T.gongpo_kind(DAN, 0.8)
    for x in (0.95, 1.9, 2.85, 4.75, 5.7, 6.65, 8.55, 9.5, 10.45, 0.2, 3.8, 7.6, 11.2):
        for (z, yaw) in ((0.16, 0.0 + math.pi * 0 + 0.0), (Z - 0.16, math.pi)):
            yaw2 = math.pi if z < 1 else 0.0  # the outward tongue points into the room: kind +z = into the room
            kit.place("gongpo", gp, x, PYEONG[1], z, 0.0 if z < 1 else math.pi)
    for z in (1.0, 1.85, 2.75, 4.65, 5.55, 6.4, 3.7):
        kit.place("gongpo", gp, 0.16, PYEONG[1], z, math.pi / 2)
        kit.place("gongpo", gp, X - 0.16, PYEONG[1], z, -math.pi / 2)
    # 대들보: two great painted beams across the hall, front to back, on the columns
    for x in (3.8, 7.6):
        T.beam(D, DAN, (x, 4.55, 0.0), (x, 4.55, Z), 0.36, 0.48, "beam_b")
        T.beam(D, DAN, (x, 5.2, 0.9), (x, 5.2, Z - 0.9), 0.28, 0.32, "beam_a")
        for z in (1.1, Z - 1.1):
            D.cbox(x - 0.12, x + 0.12, 5.03, 5.2, z - 0.18, z + 0.18, DAN.t(T.LOK), c=0.01)


# ------------------------------------------------------------------------------------------------ ceiling --

def ceiling(kit):
    """빗반자 (sloping, painted 비단무늬) from the brackets up to the flat 우물반자: a grid of 연화 coffers in green frames."""
    S_, D = kit.S, kit.D
    x0, x1, z0, z1 = 1.25, X - 1.25, 1.15, Z - 1.15
    y0 = PYEONG[1] + 0.8
    lo = [(0.3, y0, 0.3), (X - 0.3, y0, 0.3), (X - 0.3, y0, Z - 0.3), (0.3, y0, Z - 0.3)]
    hi = [(x0, FLAT_Y, z0), (x1, FLAT_Y, z0), (x1, FLAT_Y, z1), (x0, FLAT_Y, z1)]
    for i in range(4):
        j = (i + 1) % 4
        T.apoly(S_, [lo[i], lo[j], hi[j], hi[i]], DAN, "beam_b", [(0.3, 0.1), (0.7, 0.1), (0.7, 0.9), (0.3, 0.9)], out=(0, -1, 0))
    # the soffit ring between the wall top and the 빗반자 foot
    ring_in = [(0.3, y0, 0.3), (X - 0.3, y0, 0.3), (X - 0.3, y0, Z - 0.3), (0.3, y0, Z - 0.3)]
    ring_out = [(0.0, y0, 0.0), (X, y0, 0.0), (X, y0, Z), (0.0, y0, Z)]
    for i in range(4):
        j = (i + 1) % 4
        T.apoly(S_, [ring_out[i], ring_out[j], ring_in[j], ring_in[i]], DAN.t(T.LOK), "paint", out=(0, -1, 0))
    # coffers
    nx, nz = 14, 8
    dx, dz = (x1 - x0) / nx, (z1 - z0) / nz
    for i in range(nx):
        for j in range(nz):
            a, b = x0 + i * dx, x0 + (i + 1) * dx
            c, d = z0 + j * dz, z0 + (j + 1) * dz
            T.apoly(S_, [(a, FLAT_Y, c), (b, FLAT_Y, c), (b, FLAT_Y, d), (a, FLAT_Y, d)], DAN, "coffer", [(0, 0), (1, 0), (1, 1), (0, 1)], out=(0, -1, 0))
    frame = DAN.t(G.hexc("2E7A58"))
    for i in range(nx + 1):
        x = x0 + i * dx
        D.box(x - 0.035, x + 0.035, FLAT_Y - 0.07, FLAT_Y, z0, z1, frame, skip=("+y",))
    for j in range(nz + 1):
        z = z0 + j * dz
        D.box(x0, x1, FLAT_Y - 0.07, FLAT_Y, z - 0.035, z + 0.035, frame, skip=("+y",))
    # the 우물반자's gilt bosses at the frame crossings
    for i in range(nx + 1):
        for j in range(nz + 1):
            g = Mesh("boss")
            g.box(x0 + i * dx - 0.05, x0 + i * dx + 0.05, FLAT_Y - 0.09, FLAT_Y - 0.07, z0 + j * dz - 0.05, z0 + j * dz + 0.05, DAN, skip=("+y",))
            D.extend(gold(g))


# ------------------------------------------------------------------------------------------------ 수미단 --

def sumidan(kit):
    """The 수미단 (x 2.5..8.9, z 5.6..7.4, 1.1 high): a moulded base, two rows of carved painted peony panels between gilt
    posts on the front and the sides, a band of lotus petals, an overhanging top slab with a gilt 넝쿨 edge."""
    D = kit.D
    x0, x1, z0, z1 = 2.5, 8.9, 5.6, 7.4
    red = DAN.t(G.hexc("A62B22"))
    D.cbox(x0, x1, 0.0, 0.16, z0, z1, red, c=0.02, skip=("-y",))
    D.cbox(x0 + 0.05, x1 - 0.05, 0.16, 0.2, z0 + 0.05, z1, DAN.t(T.SEOK_DK), c=0.01)
    D.box(x0 + 0.08, x1 - 0.08, 0.2, 0.93, z0 + 0.08, z1, red, skip=("-y", "+y"))
    D.cbox(x0 + 0.04, x1 - 0.04, 0.93, 0.98, z0 + 0.04, z1, DAN.t(T.SEOK_DK), c=0.01)
    D.cbox(x0, x1, 0.98, 1.1, z0, z1, red, c=0.015)
    # gilt 넝쿨 on the slab's edges
    for (pts, out) in (([(x0, 0.99, z0 - 0.001), (x1, 0.99, z0 - 0.001), (x1, 1.09, z0 - 0.001), (x0, 1.09, z0 - 0.001)], (0, 0, -1)),
                       ([(x0, 0.02, z0 - 0.001), (x1, 0.02, z0 - 0.001), (x1, 0.14, z0 - 0.001), (x0, 0.14, z0 - 0.001)], (0, 0, -1))):
        T.apoly(D, pts, DAN, "gold_scroll", [(0, 0.3), (6, 0.3), (6, 0.5), (0, 0.5)] if False else [(0, 0.3), (1, 0.3), (1, 0.55), (0, 0.55)], out=out)
    # front panels: 8 columns x 2 rows, gilt posts and rails
    zf = z0 + 0.079
    n = 8
    w = (x1 - x0 - 0.16) / n
    for i in range(n):
        a = x0 + 0.08 + i * w
        for (v0, v1, reg) in ((0.24, 0.52, "gold_scroll"), (0.57, 0.9, "sumidan")):
            T.apoly(D, [(a + 0.045, v0, zf), (a + w - 0.045, v0, zf), (a + w - 0.045, v1, zf), (a + 0.045, v1, zf)], DAN, reg,
                    [(0.03, 0.03), (0.97, 0.03), (0.97, 0.97), (0.03, 0.97)] if reg == "sumidan" else [(0.0, 0.0), (1.0, 0.0), (1.0, 0.5), (0.0, 0.5)], out=(0, 0, -1))
        g = Mesh("post")
        g.box(a - 0.02, a + 0.02, 0.2, 0.93, zf - 0.03, zf, DAN, skip=("+z",))
        D.extend(gold(g))
    for v in (0.2, 0.535, 0.9):
        g = Mesh("rail")
        g.box(x0 + 0.08, x1 - 0.08, v, v + 0.035, zf - 0.03, zf, DAN, skip=("+z",))
        D.extend(gold(g))
    # the sides: two panels each
    for (x, out) in ((x0 + 0.079, (-1, 0, 0)), (x1 - 0.079, (1, 0, 0))):
        for (c, d) in ((z0 + 0.12, 6.45), (6.55, z1 - 0.05)):
            T.apoly(D, [(x, 0.57, c), (x, 0.57, d), (x, 0.9, d), (x, 0.9, c)], DAN, "sumidan", [(0.05, 0.05), (0.95, 0.05), (0.95, 0.95), (0.05, 0.95)], out=out)
            T.apoly(D, [(x, 0.24, c), (x, 0.24, d), (x, 0.52, d), (x, 0.52, c)], DAN, "gold_scroll", [(0, 0), (1, 0), (1, 0.5), (0, 0.5)], out=out)
    # a row of upturned lotus petals (앙련) along the front under the slab
    k = 0
    x = x0 + 0.1
    while x < x1 - 0.1:
        tri = [(x, 0.93, z0 + 0.03), (x + 0.16, 0.93, z0 + 0.03), (x + 0.08, 0.985, z0 + 0.0)]
        T.apoly(D, tri, DAN, "sumidan", [(0.42, 0.5), (0.58, 0.5), (0.5, 0.75)], out=(0, 0.3, -1))
        x += 0.16
    # two lotus seats (연화대 cushions) under the 협시보살 and a low gilt dais under the 본존불
    for (cx, r) in ((3.55, 0.42), (7.85, 0.42)):
        D.lathe([(r, 0.0), (r + 0.02, 0.04), (r - 0.02, 0.09), (0.0, 0.09)], 12, DAN.t(G.hexc("A62B22")), cx, 6.45, 1.1)


# ------------------------------------------------------------------------------------------------ 닫집 --

def datjip(kit):
    """닫집 over the 본존불 (x 3.95..7.45 hung from the ceiling, its back on the 후불벽): a bracketed palace canopy — a coffered
    보개 seen from below with a gilt rim, three tiers of little roofs (the middle one highest) on rows of tiny brackets, a carved
    gilt 낙양 valance with scalloped arches across the front, bead tassels at the corners, cloud panels on the sides."""
    D, Gd = kit.D, kit.G
    x0, x1, z0, z1 = 3.95, 7.45, 5.35, Z - 0.35
    yb, yt = 4.62, 5.05
    # the box: cloud panels round, coffer underneath
    for (pts, out, reg) in (([(x0, yb, z0), (x1, yb, z0), (x1, yt, z0), (x0, yt, z0)], (0, 0, -1), "cloud"),
                            ([(x0, yb, z1), (x0, yb, z0), (x0, yt, z0), (x0, yt, z1)], (-1, 0, 0), "cloud"),
                            ([(x1, yb, z0), (x1, yb, z1), (x1, yt, z1), (x1, yt, z0)], (1, 0, 0), "cloud")):
        T.apoly(D, pts, DAN, reg, [(0.0, 0.25), (1.0, 0.25), (1.0, 0.75), (0.0, 0.75)], out=out)
    T.apoly(D, [(x0, yb, z0), (x1, yb, z0), (x1, yb, z1), (x0, yb, z1)], DAN, "coffer", [(0, 0), (1, 0), (1, 1), (0, 1)], out=(0, -1, 0))
    g = Mesh("rim")
    for (a, b, c, d) in ((x0 - 0.05, x1 + 0.05, z0 - 0.05, z0), (x0 - 0.05, x0, z0, z1), (x1, x1 + 0.05, z0, z1)):
        g.box(a, b, yb - 0.03, yt + 0.02, c, d, DAN)
    D.extend(gold(g))
    # tiny brackets along the top of the box (front and sides)
    gm = T.gongpo_kind(DAN, 0.36)
    xs = [x0 + 0.15 + k * (x1 - x0 - 0.3) / 11 for k in range(12)]
    for x in xs:
        kit.place("gongpo_mini", gm, x, yt, z0 + 0.05, math.pi)
    for z in (z0 + 0.4, z0 + 0.9, z0 + 1.4):
        kit.place("gongpo_mini", gm, x0 + 0.05, yt, z, -math.pi / 2)
        kit.place("gongpo_mini", gm, x1 - 0.05, yt, z, math.pi / 2)
    # three little roofs: the side ones at 5.35, the middle one raised to 5.6 (it reaches into the coffer bay)
    for (cx, hw, ye, yr) in ((x0 + 0.7, 0.55, 5.3, 5.62), (x1 - 0.7, 0.55, 5.3, 5.62), ((x0 + x1) / 2, 0.75, 5.38, 5.8)):
        r = T.Roof(cx, (z0 + z1) / 2 - 0.25, hw, (z1 - z0) / 2 - 0.35, 0.22, ye, yr, hw * 0.5, lift=0.08, bow=0.03, kind="paljak", nt=4, ns=6)
        rm = Mesh("roof")
        r.surface(rm, DAN)
        r.eave_edge(rm, DAN, DAN, ye - 0.15, depth=0.06)
        r.ridges(rm, DAN, DAN, DAN)
        for p in rm.polys:
            p.uv = [ruv("buyeon", 0.3 + 0.4 * ((u * 0.3) % 1.0), 0.2 + 0.6 * ((v * 0.4) % 1.0)) for (u, v) in p.uv]
            p.col = [(1.0, 1.0, 1.0, 1.0)] * len(p.pts)
        D.extend(rm)
        for sx in (-1, 1):
            g = Mesh("finial")
            g.lathe([(0.03, 0.0), (0.05, 0.05), (0.0, 0.16)], 6, DAN, cx + sx * (hw * 0.5 - 0.02), (z0 + z1) / 2 - 0.25, yr + 0.05)
            D.extend(gold(g))
    # 낙양: a carved gilt valance with three scalloped arches across the front, under the box
    nv = Mesh("valance")
    for k in range(3):
        a = x0 + k * (x1 - x0) / 3
        b = a + (x1 - x0) / 3
        pts = [(a, yb, z0 - 0.02)]
        for i in range(13):
            t = i / 12
            u = a + (b - a) * t
            v = yb - 0.32 + 0.24 * (1 - math.sin(math.pi * t) ** 0.6) - 0.06 * math.sin(math.pi * t * 6) ** 2 * (0.3 < t < 0.7)
            pts.append((u, v, z0 - 0.02))
        pts.append((b, yb, z0 - 0.02))
        for i in range(1, len(pts) - 2):
            q = [pts[i], pts[i + 1], (pts[i + 1][0], yb, z0 - 0.02), (pts[i][0], yb, z0 - 0.02)]
            T.apoly(nv, q, DAN, "gold_scroll", [((q[0][0] - a) / (b - a), (q[0][1] - yb + 0.32) / 0.32 * 0.5), ((q[1][0] - a) / (b - a), (q[1][1] - yb + 0.32) / 0.32 * 0.5),
                                                ((q[1][0] - a) / (b - a), 0.5), ((q[0][0] - a) / (b - a), 0.5)], out=(0, 0, -1))
            T.apoly(nv, q[::-1], DAN, "gold_scroll", [(0.5, 0.25)] * 4)
    D.extend(nv)
    # bead tassels (영락) at the front corners and between the arches
    for x in (x0, x0 + (x1 - x0) / 3, x0 + 2 * (x1 - x0) / 3, x1):
        g = Mesh("tassel")
        for k in range(5):
            g.sphere(x, yb - 0.12 - k * 0.07, z0 - 0.05, 0.022, DAN, n=5, rings=3)
        g.lathe([(0.0, 0.0), (0.04, 0.05), (0.02, 0.12), (0.0, 0.13)], 6, DAN, x, z0 - 0.05, yb - 0.62)
        Gd.extend(gold(g))
        Gd.member((x, yb - 0.5, z0 - 0.05), (x, yb - 0.75, z0 - 0.05), G.prof_round(0.02, 4), DAN.t(G.hexc("D8343A")))
    kit.lights.append(("point", (x0 + x1) / 2, yb - 0.25, z0 - 0.4, (1.0, 0.82, 0.56), 60.0))


# ------------------------------------------------------------------------------------------------ 공양상 --

def offering(kit):
    """공양상 (x 4.2..7.2, z 4.9..5.4, 0.85): a red-lacquer table with a gilt apron on carved legs; on it two brass candlesticks
    with burning candles, an incense burner with three sticks, two vases of lotus and peony, two raised plates of fruit."""
    D, Gd = kit.D, kit.G
    x0, x1, z0, z1 = 4.2, 7.2, 4.9, 5.4
    red = DAN.t(G.hexc("A62B22"))
    D.cbox(x0, x1, 0.78, 0.85, z0, z1, red, c=0.012)
    T.apoly(D, [(x0 + 0.04, 0.62, z0 - 0.001), (x1 - 0.04, 0.62, z0 - 0.001), (x1 - 0.04, 0.78, z0 - 0.001), (x0 + 0.04, 0.78, z0 - 0.001)], DAN, "gold_scroll",
            [(0, 0.3), (1, 0.3), (1, 0.6), (0, 0.6)], out=(0, 0, -1))
    D.box(x0 + 0.04, x1 - 0.04, 0.62, 0.78, z0, z1 - 0.04, red, skip=("+y", "-z"))
    for x in (x0 + 0.08, x1 - 0.08):
        for z in (z0 + 0.06, z1 - 0.06):
            D.tube([(x, 0.62, z), (x, 0.3, z), (x + (0.03 if x < 5.7 else -0.03), 0.12, z), (x + (0.06 if x < 5.7 else -0.06), 0.0, z)], 0.035, 6, red)
    yt = 0.85
    # candlesticks + candles + flames
    for x in (4.45, 6.95):
        g = Mesh("candlestick")
        g.lathe([(0.1, 0.0), (0.09, 0.03), (0.035, 0.06), (0.03, 0.2), (0.05, 0.22), (0.025, 0.25), (0.025, 0.4), (0.08, 0.42), (0.07, 0.45), (0.03, 0.46)], 20, DAN, x, 5.15, yt)   # (2026-11-28: 10 sides read as faceted brass)
        D.extend(gold(g))
        cand = Mesh("candle")
        cand.lathe([(0.032, 0.0), (0.032, 0.262), (0.031, 0.27), (0.026, 0.275), (0.016, 0.272), (0.0, 0.271)], 20, DAN, x, 5.15, yt + 0.45)
        D.extend(painted(cand, G.hexc("FFF7E6")))
        D.lathe([(0.0, 0.0), (0.014, 0.025), (0.009, 0.06), (0.0, 0.085)], 10, SCREEN.t((1.0, 0.72, 0.3)), x, 5.15, yt + 0.735)
        for p in D.polys[-30:]:
            p.col = [(1.0, 0.75, 0.32, 1.0)] * len(p.pts)
        kit.lights.append(("point", x, yt + 0.8, 5.15, (1.0, 0.68, 0.32), 18.0))
    # incense burner: a round bronze bowl on three legs, sand, three sticks with glowing tips
    g = Mesh("burner")
    g.lathe([(0.0, 0.05), (0.09, 0.06), (0.13, 0.12), (0.14, 0.18), (0.12, 0.2), (0.13, 0.215)], 24, DAN, 5.7, 5.15, yt)
    for k in range(3):
        a = k * 2 * math.pi / 3
        g.member((5.7 + 0.08 * math.cos(a), yt + 0.07, 5.15 - 0.08 * math.sin(a)), (5.7 + 0.11 * math.cos(a), yt, 5.15 - 0.11 * math.sin(a)), G.prof_round(0.012, 8), DAN)
    for sx in (-1, 1):
        g.tube([(5.7 + sx * 0.12, yt + 0.19, 5.15), (5.7 + sx * 0.17, yt + 0.22, 5.15), (5.7 + sx * 0.17, yt + 0.26, 5.15)], 0.012, 8, DAN)
    D.extend(gold(g))
    D.lathe([(0.0, 0.0), (0.12, 0.0)], 10, DAN.t(G.hexc("D9CCB4")), 5.7, 5.15, yt + 0.195) if False else None
    sand = Mesh("sand")
    sand.poly([(5.7 + 0.12 * math.cos(2 * math.pi * i / 24), yt + 0.195, 5.15 - 0.12 * math.sin(2 * math.pi * i / 24)) for i in range(24)], DAN)
    D.extend(painted(sand, G.hexc("D6C8B0")))
    for k, dx in enumerate((-0.03, 0.0, 0.03)):
        D.member((5.7 + dx, yt + 0.195, 5.15), (5.7 + dx * 1.6, yt + 0.48, 5.15 + 0.01 * k), G.prof_round(0.004, 4), DAN.t(G.hexc("8B3A2A")))
        D.sphere(5.7 + dx * 1.6, yt + 0.485, 5.15 + 0.01 * k, 0.006, SCREEN, n=4, rings=2)
        D.polys[-1].col = [(1.0, 0.4, 0.15, 1.0)] * len(D.polys[-1].pts)
    # vases of lotus and peony
    for x in (5.18, 6.22):
        v = Mesh("vase")
        v.lathe([(0.0, 0.0), (0.06, 0.0), (0.09, 0.05), (0.1, 0.14), (0.07, 0.24), (0.045, 0.3), (0.052, 0.33), (0.062, 0.34), (0.05, 0.335)], 24, DAN, x, 5.12, yt)
        D.extend(painted(v, G.hexc("F4F6F8")))
        b = Mesh("band")
        b.lathe([(0.0968, 0.1), (0.1006, 0.125), (0.0998, 0.15)], 24, DAN, x, 5.12, yt)
        D.extend(painted(b, G.hexc("3C5FA8")))
        bouquet(Gd, x, yt + 0.33, 5.12)
    # fruit on raised plates (고배): apples, pears, oranges stacked
    for x in (4.9, 6.5):
        p = Mesh("plate")
        p.lathe([(0.0, 0.0), (0.07, 0.0), (0.04, 0.03), (0.035, 0.12), (0.15, 0.15), (0.16, 0.17), (0.152, 0.172), (0.0, 0.168)], 24, DAN, x, 5.15, yt)
        D.extend(painted(p, G.hexc("B83A2E")))
        fruit_pile(Gd, x, yt + 0.17, 5.15, 11 if x < 5 else 23)


def bouquet(m, x, y, z):
    """A vase of lotus and peony (owner 2026-11-21: real flowers, not flat diamonds): two open pink lotuses, a white one,
    a closed bud on a tall stem, a deep-pink peony, and broad lotus leaves cupped round the rim (flora.py: every bloom built
    from its own curved petals)."""
    k0 = len(m.polys)
    lod0, G.LOD = G.LOD, 0.7   # (a vase on the offering table, seen from the cushions: fewer petals per ring)
    rg = G.rng(int(x * 100))
    green = DAN.t(G.hexc("4C8A3C"))
    blooms = [("lotus", -0.08, 0.13, 0.03, G.hexc("F08CA8")), ("lotus", 0.08, 0.16, -0.03, G.hexc("F4A2B8")),
              ("lotus_w", 0.0, 0.22, 0.04, G.hexc("FBE3EA")), ("peony", 0.03, 0.1, -0.08, G.hexc("D8466E")),
              ("bud", -0.03, 0.3, -0.02, G.hexc("EE7F9F"))]
    for kind, dx, dy, dz, col in blooms:
        c = (x + dx, y + dy, z + dz)
        F.stem(m, (x + dx * 0.2, y - 0.04, z + dz * 0.2), c, 0.005, green, bend=(dx * 0.3, 0.0, dz * 0.3))
        sd = int(abs(dx) * 1000 + dy * 100)
        if kind == "lotus":
            F.lotus(m, c, 0.1, PETAL, col, seed=sd, open_=0.95)
        elif kind == "lotus_w":
            F.lotus(m, c, 0.09, PETAL, col, col_base=(1.0, 0.99, 0.97), seed=sd, open_=0.8)
        elif kind == "peony":
            F.peony(m, c, 0.075, PETAL, col, seed=sd)
        else:
            F.lotus_bud(m, c, 0.04, PETAL, col, seed=sd)
    # round lotus pads on their own stems, cupped and tilted out over the rim
    for k, (dx, dy, dz, r) in enumerate(((0.12, 0.05, 0.06, 0.085), (-0.12, 0.07, -0.05, 0.08), (0.02, 0.04, 0.12, 0.07))):
        c = (x + dx, y + dy, z + dz)
        F.stem(m, (x, y - 0.04, z), c, 0.004, green)
        F.leaf(m, c, (dx, 0.25, dz), r * 1.6, r * 1.5, green, rise=0.2, fall=0.5, fold=0.05, c0=G.hexc("3A7434"), c1=G.hexc("6FAE55"), seed=60 + k)
    for k in range(4):
        a = 2 * math.pi * k / 4 + rg.uniform(-0.25, 0.25)
        F.leaf(m, (x + 0.03 * math.cos(a), y + rg.uniform(0.0, 0.04), z + 0.03 * math.sin(a)), (math.cos(a), 0, math.sin(a)),
               rg.uniform(0.11, 0.14), 0.07, green, rise=0.55, fall=1.2, c0=G.hexc("2F6A2C"), c1=G.hexc("5E9E4A"), seed=k + int(x * 10))
    paint_keep(m, k0)
    G.LOD = lod0


def fruit_pile(m, x, y, z, seed):
    rg = G.rng(seed)
    kinds = [(G.hexc("C8252A"), 0.042, 0.95), (G.hexc("E8C25A"), 0.044, 1.15), (G.hexc("F08A1C"), 0.04, 0.95)]
    layers = [(0.0, 7, 0.08), (0.075, 4, 0.045), (0.145, 1, 0.0)]
    for (dy, n, rr) in layers:
        for i in range(n):
            a = 2 * math.pi * i / n + rg.uniform(0, 0.4)
            col, r, sy = kinds[(i + int(dy * 100)) % 3]
            f = Mesh("fruit")
            fx, fy, fz = x + rr * math.cos(a), y + dy + r * sy, z - rr * math.sin(a)
            f.sphere(fx, fy, fz, r, DAN, n=14, rings=9, sy=sy)   # (2026-11-28: 8 x 5 read as faceted balls)
            m.extend(painted(f, col))
            if col != G.hexc("F08A1C"):
                # an apple's / a pear's short brown stalk in its dimple
                st = Mesh("stalk")
                st.member((fx, fy + r * sy - 0.004, fz), (fx + 0.004, fy + r * sy + 0.014, fz), G.prof_round(0.0022, 5), DAN)
                m.extend(painted(st, G.hexc("5A3A22")))


# ------------------------------------------------------------------------------------------------ side pieces --

def side_pieces(kit):
    """The small bell (x 0.3..0.9) on a red stand with its striker and a 목탁 on a cushion; the 법고 drum (x 10.5..11.1) on a
    stand, its head painted with a lotus; both on low daises."""
    D = kit.D
    red = DAN.t(G.hexc("A62B22"))
    # the bell stand: two posts and a crossbar, the bell hanging
    cx, cz = 0.6, 6.2
    D.cbox(0.3, 0.9, 0.0, 0.1, 5.8, 6.6, red, c=0.01, skip=("-y",))
    for dz in (-0.33, 0.33):
        D.cbox(cx - 0.03, cx + 0.03, 0.1, 1.18, cz + dz - 0.03, cz + dz + 0.03, red, c=0.008)
    D.cbox(cx - 0.035, cx + 0.035, 1.12, 1.19, cz - 0.38, cz + 0.38, red, c=0.008)
    # a bronze 범종 (flora.bell: banded body, 유곽 bosses, the lotus 당좌, the hook loop) hanging under the crossbar
    k0 = len(D.polys)
    F.bell(D, cx, 0.62, cz, 0.4, 0.17, DAN.t((1.0, 1.0, 1.0)), n=28)
    gild_keep(D, k0)
    # 목탁 on a small cushion beside the stand: a plump silk cushion, the wooden fish-bell (round body, the mouth slit, a
    # little handle loop) and its mallet
    F.pillow(D, 0.6, 0.1, 5.93, 0.42, 0.16, 0.06, FAB.t(G.hexc("8E2E2A")), piping=FAB.t(G.hexc("FFD27A")), dip=0.1)
    wood = PINE.t(G.hexc("B57A46"))
    F.superellipsoid(D, (0.6, 0.152, 5.93), 0.075, 0.058, 0.065, wood, e_v=0.85, e_h=0.85, n=20, rings=10, flat_bottom=True)
    D.cbox(0.535, 0.665, 0.205, 0.215, 5.862, 5.868, PINE.t(G.hexc("3A2414")), c=0.002)
    D.tube([(0.67, 0.19, 5.93), (0.7, 0.215, 5.93), (0.71, 0.25, 5.93), (0.69, 0.27, 5.93), (0.665, 0.262, 5.93)], 0.011, 6, wood)
    D.member((0.4, 0.165, 5.88), (0.53, 0.165, 5.86), G.prof_round(0.007, 6), wood)
    D.sphere(0.395, 0.165, 5.88, 0.017, wood, n=8, rings=5)
    # the 법고 drum on its stand
    cx = 10.8
    D.cbox(10.5, 11.1, 0.0, 0.1, 5.8, 6.6, red, c=0.01, skip=("-y",))
    for dz in (-0.3, 0.3):
        D.cbox(cx - 0.03, cx + 0.03, 0.1, 1.15, cz + dz - 0.03, cz + dz + 0.03, red, c=0.008)
    # the barrel: flora.drum (bulging staves, domed cowhide heads nailed with brass studs); the barrel red lacquer, the
    # heads keep the painted lotus (the atlas's coffer rosette), the studs gilt
    r = 0.24
    yc = 0.8
    k0 = len(D.polys)
    wood_s, hide_s, stud_s = DAN.t(G.hexc("B3392C")), DAN.t(G.hexc("F3E6CC")), DAN.t(G.hexc("FFD27A"))
    F.drum(D, cx, yc, cz, r, 0.42, wood_s, hide_s, stud_s, axis="x", n=28)
    for i, p in enumerate(D.polys[k0:]):
        c = tuple(round(v, 4) for v in p.col[0][:3])
        if c == tuple(round(v, 4) for v in hide_s.col):
            p.uv = [ruv("coffer", u / (2 * r), v / (2 * r)) for (u, v) in p.uv]
            p.col = [(1.0, 1.0, 1.0, 1.0)] * len(p.pts)
            p.mat = "LM_temple_dancheong"
        elif c == tuple(round(v, 4) for v in stud_s.col):
            p.uv = [ruv("gold_scroll", 0.1 + 0.8 * ((i * 0.137) % 1.0) + 0.004 * (k % 2), 0.98) for k in range(len(p.pts))]
            p.col = [(1.0, 1.0, 1.0, 1.0)] * len(p.pts)
            p.mat = "LM_temple_dancheong"
        else:
            p.uv = [ruv("paint", 0.5 + 0.004 * (k % 2), 0.5 + 0.004 * ((k // 2) % 2)) for k in range(len(p.pts))]
            p.mat = "LM_temple_dancheong"
    # the drumsticks resting across the stand's foot
    for dz in (-0.05, 0.05):
        D.member((10.6, 0.115, cz + dz), (11.0, 0.13, cz + dz * 1.4), G.prof_round(0.012, 6), PINE.t(G.hexc("B57A46")))


# ------------------------------------------------------------------------------------------------ 연등 --

def lantern_kind(tint):
    """A 연등 as a real lotus bud: two overlapping rows of curved, pointed petals (ridge down the middle of each), a green calyx
    ring on top, a hanging cord and a paper tassel below."""
    m = Mesh("deung")
    R = 0.19

    def petal_row(n, t1, rad, phase, tcol, ridge):
        for i in range(n):
            a = 2 * math.pi * (i + phase) / n
            rows = 3
            hw0 = math.pi / n * 1.28
            prof = []
            for r_ in range(rows + 1):
                t = r_ / rows * t1
                rr = rad * (math.sin(math.pi * (0.06 + 0.94 * t)) ** 0.8) + 0.004
                yy = -0.34 + 0.58 * t
                hw = hw0 * (math.sin(math.pi * min(1.0, t * 1.02)) ** 0.55)
                prof.append((rr, yy, hw, t))
            for r_ in range(rows):
                (ra, ya, ha, ta), (rb, yb, hb, tb) = prof[r_], prof[r_ + 1]
                for side in (0, 1):
                    def pt(rr, yy, hh, k):
                        # k: -1 left edge, 0 ridge (pushed out), 1 right edge
                        ang = a + k * hh
                        rrr = rr + (ridge if k == 0 else 0.0)
                        return (rrr * math.cos(ang), yy, -rrr * math.sin(ang))
                    ks = (-1, 0) if side == 0 else (0, 1)
                    q = [pt(ra, ya, ha, ks[0]), pt(ra, ya, ha, ks[1]), pt(rb, yb, hb, ks[1]), pt(rb, yb, hb, ks[0])]
                    if ra < 0.01 and ya < -0.3:
                        q = [q[0], q[2], q[3]] if False else q
                    u0 = ((i % 5) + (0.5 * side)) / 5.0
                    stl = [(u0, ta), (u0 + 0.1, ta), (u0 + 0.1, tb), (u0, tb)]
                    T.apoly(m, q, DAN.t(tcol), "lotus_paper", [(min(0.98, a_), 0.04 + 0.9 * b_) for a_, b_ in stl],
                            out=(math.cos(a), 0.0, -math.sin(a)))

    petal_row(12, 0.78, R * 1.0, 0.5, (0.98, 0.9, 0.94), 0.010)       # back row (paler), a touch wider
    petal_row(10, 0.92, R * 0.93, 0.0, tint, 0.014)                    # front row
    m.lathe([(R * 0.30, 0.2), (R * 0.36, 0.23), (R * 0.30, 0.27)], 10, DAN.t(G.hexc("2E7A58")), 0.0, 0.0, 0.0)
    m.member((0.0, 0.26, 0.0), (0.0, FLAT_Y - 3.55, 0.0), G.prof_round(0.004, 3), DAN.t(G.hexc("E8E0D0")))
    m.member((0.0, -0.34, 0.0), (0.0, -0.52, 0.0), G.prof_round(0.012, 4), DAN.t(G.hexc("E8E0D0")))
    m.cbox(-0.012, 0.012, -0.78, -0.52, -0.012, 0.012, DAN.t(G.hexc("D8453A")), c=0.003)
    return m


def lanterns(kit):
    """Rows of 연등 under the ceiling over the cushions (pink and white), hung on thin cords; they glow at night."""
    pink = lantern_kind((1.0, 1.0, 1.0))
    white = lantern_kind((1.0, 0.95, 0.86))
    rg = G.rng(5)
    for j, z in enumerate((0.9, 1.75, 2.6, 3.45, 4.3)):
        for i in range(10):
            x = 1.6 + i * 0.9 + (0.45 if j % 2 else 0.0)
            if x > X - 1.3:
                continue
            if 4.6 < x < 6.8 and j < 4:
                continue  # keep the view from the door to the 본존불 open
            y = 3.55 + rg.uniform(-0.05, 0.05)
            kit.place("deung_pink" if (i + j) % 3 else "deung_white", pink if (i + j) % 3 else white, x, y, z, rg.uniform(0, 6.28))
    for j, z in enumerate((0.9, 1.75, 2.6, 3.45, 4.3)):
        g = kit.glow("lanterns")
        for i in range(0, 10, 3):
            x = 1.6 + i * 0.9 + (0.45 if j % 2 else 0.0)
            if x <= X - 1.3 and not (4.6 < x < 6.8 and j < 4):
                g.sphere(x, 3.53, z, 0.1, S("M_glass").t((1.0, 0.7, 0.6)), n=5, rings=3)


# ------------------------------------------------------------------------------------------------ 방석 --

def cushions(kit, spec):
    """Twelve 방석 (0.66 square, 9 cm, deep red-brown silk with an ochre border and a centre tuft) on the seat spots."""
    m = Mesh("cushion")
    lod0, G.LOD = G.LOD, 0.6   # twelve of them, seen from standing height: a lighter section is enough
    # a real 방석: plump silk, puffed top with the tufted middle, rounded corners, an ochre piped seam round the waist and a
    # covered button (flora.pillow), not a box
    F.pillow(m, 0.0, 0.0, 0.0, 0.66, 0.66, 0.1, FAB.t(G.hexc("D9533F")), piping=FAB.t(G.hexc("FFC96A")), tuft=FAB.t(G.hexc("FFC96A")),
             dip=0.25, e_h=0.18, e_v=0.5)
    G.LOD = lod0
    for s in spec["seats"]:
        kit.place("cushion", m, s["x"], 0.0, s["z"], 0.0)
