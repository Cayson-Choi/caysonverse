"""케이슨 마을 학교 교실 + 복도 (lot_school_class, interior area lot:lot_school_class at (410, 0), 15.4 x 7.4, ceiling 3.7) —
the walk-in room kit (design 11, contract 11, `LOT_INTERIORS` SCHOOL_IN), pure python on b1_room / b1_parts / b1_geom.

A dream village classroom (owner 2026-11-17: "들어가서 구경하는데 아주 감동을 받을 정도로 실제와 같지만 … 이런 학교가 있었으면"): honey oak
floor, sage-green wainscot under warm cream walls, exposed oak beams, a sunny wall of tall windows on the far side with
geraniums on the sills, a fresh green chalkboard with a chalk sun and a flower, the teacher's oak desk with a globe and an
apple, twelve tidy oak desks with open exercise books, a low cupboard under the back windows with books, plants and an
aquarium, children's paintings pinned between the windows, bunting, opal globe pendants; the corridor along the door wall
with pastel lockers, a glazed oak partition and coat hooks. Brand-new, tidy, no words (LOT_SIGN_WORDS only; none in here).
"""
import math

import b1_geom as G
import b1_parts as P
import b1_room as R
from b1_geom import Mesh, S

FLOOR = S("LM_school_floor")                                 # floor_wood
WALL = S("LM_school_render", G.hexc("FFF3DC"))               # stucco_white (the school's own render set): warm, bright              # plaster_painted, warm cream
CEIL = S("LM_school_plaster", G.hexc("FFFCF5"))
BOARD = S("LM_school_plaster", G.hexc("4A7A62"))             # the chalkboard's matt green slate paint
CHALK = S("LM_school_plaster", G.hexc("F4F2EA"))
PAINT = S("LM_school_paint")                                 # wood_painted (white)
SAGE = S("LM_school_paint", G.hexc("A9C3A4"))
BLUE = S("LM_school_paint", G.hexc("A8C8E0"))
MINT = S("LM_school_paint", G.hexc("B8E0C8"))
BUTTER = S("LM_school_paint", G.hexc("F3DE9A"))
PINK = S("LM_school_paint", G.hexc("F2BDC0"))
RED = S("LM_school_paint", G.hexc("D9574A"))
YEL = S("LM_school_paint", G.hexc("F2C94C"))
NAVY = S("LM_school_paint", G.hexc("3E5C8A"))
PAPER = S("LM_school_plaster", G.hexc("FFFDF6"))            # paper: the plaster scan's fine tooth (the painted-board set shows grooves)
OAK = S("LM_school_oak", G.hexc("E8D2B0"))                   # wood_oak
OAK_DK = S("LM_school_oak", G.hexc("B48A62"))
CORK = S("LM_school_oak", G.hexc("C99A66"))
IRON = S("LM_school_iron", G.hexc("3B4A44"))                 # cast_iron, painted dark green-grey (desk frames)
BRASS = S("LM_school_iron", G.hexc("D9B86A"))
LEAF = S("LM_school_green", G.hexc("9CC86E"))                # grass set: leaves
LEAF_DK = S("LM_school_green", G.hexc("6FA84E"))
PET_RED = S("LM_school_green", G.hexc("F25A50"))
PET_PINK = S("LM_school_green", G.hexc("F59AC8"))
POT = S("LM_school_floor", G.hexc("E39A70"))                 # terracotta pots (floor set, tinted)
GLASS = P.GLASS
OPAL = S("M_glass", G.lin(0.95, 0.95, 0.92))

MATS = {
    "LM_school_floor": {"set": "floor_wood"},
    "LM_school_plaster": {"set": "plaster_painted"},
    "LM_school_render": {"set": "stucco_white", "rough": 0.95},
    "LM_school_paint": {"set": "wood_painted", "normal": 0.5},
    "LM_school_oak": {"set": "wood_oak", "rough": 0.85},
    "LM_school_iron": {"set": "cast_iron", "metal": True},
    "LM_school_green": {"set": "grass", "normal": 0.5},
    "M_glass": {"glass": True},
    "M_screen": {"screen": True},
}

X, Z, H = 15.4, 7.4, 3.7


def build(spec, unit, layout):
    kit = P.Kit(None)
    kit.mats = dict(MATS)
    sol = {s["name"]: s for s in spec["solids"]}
    holes = {
        "door": [(6.6, 8.8, 0.0, 2.9)] + [(a, a + 1.8, 2.25, 3.3) for a in (0.7, 3.3, 10.3, 12.9)],
        "back": [(X - x - 0.85, X - x + 0.85, 0.95, 3.25) for x in (4.4, 7.7, 11.0)],
        "right": [(0.5, 1.9, 0.95, 3.25), (3.3, 6.7, 0.95, 3.25)],
    }
    W = R.box_room(kit, X, Z, H, WALL, FLOOR, CEIL, holes)
    S_, D, Gd = kit.S, kit.D, kit.G
    # windows: the sunny back wall (3), the right wall (corridor 1 + a wide classroom pair), clerestories over the lockers
    for x in (4.4, 7.7, 11.0):
        R.window(kit, W["back"], X - x, 0.95, 1.7, 2.3, PAINT, OAK, WALL, cols=2, rows=3)
    R.window(kit, W["right"], 1.2, 0.95, 1.4, 2.3, PAINT, OAK, WALL, cols=2, rows=3)
    R.window(kit, W["right"], 5.0, 0.95, 3.4, 2.3, PAINT, OAK, WALL, cols=4, rows=3)
    for a in (0.7, 3.3, 10.3, 12.9):
        R.window(kit, W["door"], a + 0.9, 2.25, 1.8, 1.05, PAINT, OAK, WALL, cols=3, rows=1, depth=0.3)
    # the door (closed leaves seen from inside: the exit) — glazed sage double door with brass handles, architrave
    f = W["door"]
    for (a, b) in ((6.62, 7.69), (7.71, 8.78)):
        f.box(D, a, b, 0.0, 2.88, -0.12, -0.06, SAGE.u((0, 1, 0)))
        f.box(D, a + 0.12, b - 0.12, 1.25, 2.7, -0.06, -0.055, GLASS)
        f.box(D, a + 0.12, b - 0.12, 0.2, 1.1, -0.06, -0.03, SAGE)
        hx = b - 0.1 if a < 7.7 else a + 0.1
        f.box(D, hx - 0.015, hx + 0.015, 1.0, 1.15, -0.06, -0.01, BRASS)
    f.box(D, 6.45, 6.6, 0.0, 3.05, 0.0, 0.04, PAINT, skip=("-w",))
    f.box(D, 8.8, 8.95, 0.0, 3.05, 0.0, 0.04, PAINT, skip=("-w",))
    f.box(D, 6.45, 8.95, 2.9, 3.05, 0.0, 0.04, PAINT, skip=("-w",))
    # the doorway's reveal
    for (u, sgn) in ((6.6, 1), (8.8, -1)):
        q = [f.p(u, 0.0, 0.0), f.p(u, 2.9, 0.0), f.p(u, 2.9, -0.12), f.p(u, 0.0, -0.12)]
        if G.dot(G.poly_normal(q), G.mul(f.U, sgn)) < 0:
            q.reverse()
        S_.poly(q, WALL)
    # wainscot on the classroom walls (sage), skirting everywhere
    R.wainscot(D, W["back"], 0.0, X, 0.95, SAGE, PAINT)
    R.wainscot(D, W["right"], 2.45, X - 0.0 if False else Z, 0.95, SAGE, PAINT)
    R.wainscot(D, W["left"], 0.0, Z - 2.45, 0.95, SAGE, PAINT)
    R.beams(D, X, Z, H, OAK_DK, step=2.2)
    lockers(kit, sol)
    partition(kit)
    board(kit)
    teacher(kit)
    desks(kit, spec)
    back_shelf(kit, sol)
    art(kit)
    for x in (4.0, 8.4, 12.8):
        for z in (3.9, 6.0):
            R.pendant(kit, D, x, z, H, 1.0, OPAL, BRASS, "globe")
    for z in (0.9, 1.6):
        pass
    for x in (3.0, 12.4):
        R.pendant(kit, D, x, 1.2, H, 0.8, OPAL, BRASS, "globe")
    # a round braided welcome rug in the corridor
    for k, (r, c) in enumerate(((1.0, "E7A07A"), (0.82, "F3D9A6"), (0.62, "9CC0A8"), (0.42, "F3D9A6"), (0.22, "E7A07A"))):
        Gd.lathe([(r, 0.0), (r, 0.006 + k * 0.002), (0.0, 0.006 + k * 0.002)], 24, S("LM_school_paint", G.hexc(c)), 7.7, 1.3, 0.0)
    clock(kit)
    bunting(kit)
    reading_corner(kit, sol)
    curtains(kit)
    kit.sun_elev = 30
    kit.world_strength = 0.14
    kit.look = "AgX - Medium High Contrast"
    kit.exposure = 0.3
    kit.haze = (0.3, X - 0.3, 0.0, H - 0.2, 2.6, Z - 0.3, 0.003)
    plants(kit)
    kit.ground = Mesh("ground")
    return kit


def lockers(kit, sol):
    """Pastel steel-look lockers (painted timber) along the corridor wall: 12 a side, vents, brass number plates (blank), round
    handles, a top cornice; coat hooks with a hat shelf above the left run; potted plants on top."""
    D, Gd = kit.D, kit.G
    cols = [BLUE, MINT, BUTTER, PINK]
    for name in ("lockers_l", "lockers_r"):
        r = sol[name]["rect"]
        x0, x1 = r["x0"], r["x1"]
        n = int(round((x1 - x0) / 0.45))
        w = (x1 - x0) / n
        D.box(x0, x1, 0.0, 0.1, 0.06, 0.46, PAINT.t(G.hexc("D8D2C6")), skip=("-y",))
        for k in range(n):
            a = x0 + k * w + 0.008
            b = a + w - 0.016
            s = cols[k % 4]
            D.cbox(a, b, 0.1, 1.82, 0.06, 0.5, s.u((0, 1, 0)), c=0.01, skip=("-z",))
            for v in (1.55, 1.6, 1.65):
                D.box(a + 0.12, b - 0.12, v, v + 0.018, 0.5, 0.505, s.t(G.mul(s.col, 0.7)))
            Gd.box(a + w / 2 - 0.06, a + w / 2 + 0.06, 1.38, 1.44, 0.5, 0.505, BRASS)
            Gd.lathe([(0.0, 0.0), (0.022, 0.0), (0.022, 0.025), (0.0, 0.03)], 6, BRASS, b - 0.06, 0.0, 0.0)
            Gd.member((b - 0.06, 1.05, 0.49), (b - 0.06, 1.05, 0.509), G.prof_round(0.018, 6), BRASS)
        D.box(x0, x1, 1.82, 1.9, 0.04, 0.5, PAINT)
        for k in range(3):
            px = x0 + 0.6 + k * (x1 - x0 - 1.2) / 2
            P.potted_plant(Gd, (px, 1.9, 0.28), POT, LEAF, 0.4)


def partition(kit):
    """The glazed oak partition between corridor and classroom (solids partition_l / partition_r) with a transom over the open
    middle; full-height panes with a mid rail."""
    D = kit.D
    z0, z1 = 2.3, 2.45
    for (x0, x1) in ((0.0, 2.6), (12.8, X)):
        D.box(x0, x1, 0.0, 0.12, z0, z1, OAK_DK)
        D.box(x0, x1, H - 0.12, H, z0, z1, OAK_DK)
        n = 2
        for k in range(n + 1):
            x = x0 + (x1 - x0) * k / n
            xa, xb = max(x0, x - 0.05), min(x1, x + 0.05)
            D.box(xa, xb, 0.12, H - 0.12, z0, z1, OAK_DK)
        D.box(x0, x1, 1.0, 1.08, z0, z1, OAK_DK)
        D.box(x0, x1, 0.12, H - 0.12, (z0 + z1) / 2 - 0.004, (z0 + z1) / 2 + 0.004, GLASS)
    # the transom beam over the open front of the classroom (above head height)
    D.box(2.6, 12.8, 3.15, H, z0, z1, OAK_DK, skip=("+y",))


def board(kit):
    """The chalkboard on the left wall (solid board: x 0..0.12, z 3..7): oak frame, matt green slate face, chalk ledge with
    chalk sticks and a felt eraser, a chalk sun, a flower and a little house drawn on it (no words), a pull-down map roll
    above. Bunting is hung separately."""
    D, Gd = kit.D, kit.G
    f = R.walls(X, Z)["left"]
    # u = Z - z: the board z 3..7 -> u 0.4..4.4
    f.box(D, 0.4, 4.4, 0.85, 2.3, 0.0, 0.05, OAK_DK, skip=("-w",))
    f.box(D, 0.48, 4.32, 0.93, 2.22, 0.05, 0.055, BOARD, skip=("-w",))
    f.box(D, 0.45, 4.35, 0.86, 0.9, 0.05, 0.11, OAK_DK, skip=("-w",))
    for (u, l) in ((1.1, 0.08), (1.25, 0.06), (1.4, 0.07)):
        Gd.member(f.p(u, 0.915, 0.08), f.p(u + l, 0.915, 0.08), G.prof_round(0.006, 5), CHALK)
    f.box(Gd, 3.5, 3.72, 0.9, 0.95, 0.06, 0.1, NAVY)  # felt eraser
    # chalk drawings (raised 1 mm chalk strokes): a sun with rays, a flower, a house with a door
    w = 0.0565

    def stroke(a, b):
        D.member(f.p(a[0], a[1], w), f.p(b[0], b[1], w), G.prof_box(0.012, 0.002), CHALK)
    cx, cy, r = 1.1, 1.85, 0.16
    for k in range(10):
        stroke((cx + r * math.cos(2 * math.pi * k / 10), cy + r * math.sin(2 * math.pi * k / 10)), (cx + r * math.cos(2 * math.pi * (k + 1) / 10), cy + r * math.sin(2 * math.pi * (k + 1) / 10)))
        stroke((cx + (r + 0.05) * math.cos(2 * math.pi * k / 10), cy + (r + 0.05) * math.sin(2 * math.pi * k / 10)), (cx + (r + 0.13) * math.cos(2 * math.pi * k / 10), cy + (r + 0.13) * math.sin(2 * math.pi * k / 10)))
    hx, hy = 2.5, 1.05
    for a, b in (((hx, hy), (hx + 0.6, hy)), ((hx + 0.6, hy), (hx + 0.6, hy + 0.45)), ((hx + 0.6, hy + 0.45), (hx, hy + 0.45)), ((hx, hy + 0.45), (hx, hy)),
                 ((hx - 0.05, hy + 0.45), (hx + 0.3, hy + 0.75)), ((hx + 0.3, hy + 0.75), (hx + 0.65, hy + 0.45)), ((hx + 0.22, hy), (hx + 0.22, hy + 0.25)),
                 ((hx + 0.22, hy + 0.25), (hx + 0.38, hy + 0.25)), ((hx + 0.38, hy + 0.25), (hx + 0.38, hy))):
        stroke(a, b)
    fx, fy = 3.7, 1.05
    stroke((fx, fy), (fx, fy + 0.5))
    for k in range(6):
        a = 2 * math.pi * k / 6
        stroke((fx + 0.05 * math.cos(a), fy + 0.6 + 0.05 * math.sin(a)), (fx + 0.13 * math.cos(a), fy + 0.6 + 0.13 * math.sin(a)))
    stroke((fx, fy + 0.2), (fx + 0.12, fy + 0.3))
    # map roll above the board (overhead)
    world_map(kit, f, 1.0, 3.8, 2.45, 3.45)


def teacher(kit):
    """The teacher's oak desk (solid teacher_desk x 1.2..2, z 4.4..6, 0.78) with a drawer pedestal, a tucked-in chair, a
    globe on a brass stand, a stack of books, an apple, a pencil pot, a little brass bell and a pot of daisies."""
    D, Gd = kit.D, kit.G
    x0, x1, z0, z1 = 1.2, 2.0, 4.4, 6.0
    D.cbox(x0, x1, 0.74, 0.78, z0, z1, OAK, c=0.012)
    D.cbox(x0 + 0.03, x1 - 0.03, 0.0, 0.74, z1 - 0.48, z1 - 0.03, OAK, c=0.01, skip=("-y",))
    for k in range(3):
        y = 0.08 + k * 0.22
        D.box(x0 + 0.02, x0 + 0.03, y, y + 0.18, z1 - 0.45, z1 - 0.06, OAK_DK)
        Gd.member((x0 - 0.0, y + 0.1, z1 - 0.3), (x0 - 0.0, y + 0.1, z1 - 0.21), G.prof_round(0.008, 5), BRASS)
    for z in (z0 + 0.04,):
        D.box(x0 + 0.03, x0 + 0.08, 0.0, 0.74, z - 0.025, z + 0.025, OAK)
        D.box(x1 - 0.08, x1 - 0.03, 0.0, 0.74, z - 0.025, z + 0.025, OAK)
    D.box(x1 - 0.05, x1 - 0.02, 0.2, 0.74, z0 + 0.04, z1 - 0.48, OAK)  # modesty panel facing the class
    # tucked-in chair (inside the desk's box)
    ch = R.chair_kind("tchair", OAK, OAK_DK)
    D.extend(G.moved(ch, 1.48, 0.0, 4.8, math.pi / 2))
    # on the desk
    gx, gz = 1.6, 5.75
    Gd.lathe([(0.07, 0.0), (0.07, 0.02), (0.015, 0.04), (0.015, 0.12)], 8, BRASS, gx, gz, 0.78)
    Gd.sphere(gx, 1.04, gz, 0.15, BLUE.t(G.hexc("6FA6D6")), n=14, rings=9)
    for (dx, dz, rr) in ((0.05, 0.03, 0.06), (-0.06, -0.02, 0.05), (0.0, -0.08, 0.045)):
        Gd.sphere(gx + dx, 1.04 + 0.08 * (1 if dx > 0 else -0.5), gz + dz, rr, LEAF.t(G.hexc("8EBE6A")), n=6, rings=4, sy=0.35)
    Gd.member((gx - 0.11, 0.9, gz), (gx + 0.11, 1.18, gz), G.prof_round(0.006, 5), BRASS)
    for k, c in enumerate(("C9573F", "3E6B8A", "6E9A5A")):
        Gd.cbox(1.3, 1.62, 0.78 + k * 0.035, 0.81 + k * 0.035, 4.5 + k * 0.01, 4.74 + k * 0.01, PAINT.t(G.hexc(c)), c=0.004)
    Gd.sphere(1.75, 0.83, 4.62, 0.045, RED, n=8, rings=6)
    Gd.member((1.75, 0.87, 4.62), (1.755, 0.9, 4.62), G.prof_round(0.004, 4), OAK_DK)
    Gd.lathe([(0.035, 0.0), (0.035, 0.1), (0.0, 0.1)], 8, BLUE, 1.35, 5.1, 0.78)
    for k in range(4):
        Gd.member((1.35 + 0.01 * k - 0.015, 0.85, 5.1), (1.35 + 0.012 * k - 0.02, 0.97, 5.1 + 0.01 * k), G.prof_round(0.004, 4), (YEL, RED, NAVY, MINT)[k])
    Gd.lathe([(0.05, 0.0), (0.045, 0.06), (0.02, 0.09), (0.008, 0.14), (0.015, 0.16)], 8, BRASS, 1.8, 5.2, 0.78)
    P.potted_plant(Gd, (1.4, 0.78, 5.45), POT, LEAF, 0.26)


def desk_kind():
    """A pupil's desk (0.5 x 0.8): oak top with a pencil groove, a shelf under it, a sage-painted iron frame."""
    m = Mesh("desk")
    m.cbox(-0.25, 0.25, 0.69, 0.72, -0.4, 0.4, OAK.u((0, 0, 1)), c=0.01)
    m.box(-0.22, 0.22, 0.56, 0.575, -0.36, 0.36, OAK_DK, skip=("-y",))
    m.box(0.12, 0.22, 0.575, 0.66, -0.36, -0.35, OAK_DK)
    for z in (-0.36, 0.36):
        m.member((-0.2, 0.0, z), (-0.2, 0.69, z), G.prof_box(0.03, 0.03), IRON)
        m.member((0.2, 0.0, z), (0.2, 0.69, z), G.prof_box(0.03, 0.03), IRON)
        m.member((-0.2, 0.08, z), (0.2, 0.08, z), G.prof_box(0.025, 0.02), IRON)
        m.member((-0.2, 0.56, z), (0.2, 0.56, z), G.prof_box(0.025, 0.02), IRON)
    return m


def desks(kit, spec):
    """Twelve desks (solids desk_1..12) and chairs (seats lot_school_chair_1..12, facing the board = -x), exercise books."""
    Gd = kit.G
    dk = desk_kind()
    chs = [R.chair_kind("chair_y", S("LM_school_paint", G.hexc("F2C94C")), IRON, w=0.42), R.chair_kind("chair_g", S("LM_school_paint", G.hexc("7CC08A")), IRON, w=0.42)]
    rg = G.rng(4)
    for s in spec["solids"]:
        if not s["name"].startswith("desk_"):
            continue
        r = s["rect"]
        cx, cz = (r["x0"] + r["x1"]) / 2, (r["z0"] + r["z1"]) / 2
        kit.place("desk", dk, cx, 0.0, cz, 0.0)
        # an open exercise book and a pencil on each desk; a closed book on some
        a = rg.uniform(-0.15, 0.15)
        bk = Mesh("b")
        bk.box(-0.1, 0.1, 0.72, 0.726, -0.14, 0.14, PAPER)
        bk.box(-0.101, 0.101, 0.716, 0.72, -0.141, 0.141, (BLUE, PINK, MINT, BUTTER)[rg.randrange(4)])
        bk.member((0.0, 0.727, -0.13), (0.0, 0.727, 0.13), G.prof_box(0.003, 0.001), S("LM_school_paint", G.hexc("C8C2B4")))
        Gd.extend(G.moved(bk, cx, 0.0, cz, a))
        Gd.member((cx + 0.15, 0.725, cz - 0.1), (cx + 0.16, 0.725, cz + 0.07), G.prof_round(0.004, 5), YEL)
    for i, s in enumerate(spec["seats"]):
        kit.place(("chair_y", "chair_g")[i % 2], chs[i % 2], s["x"], 0.0, s["z"], -math.pi / 2)


def back_shelf(kit, sol):
    """The low white cupboard under the back windows (solid shelf_back): oak top, open cubbies with books and baskets, on top
    plants, an aquarium with little fish, a wooden toy house and a jar of crayons."""
    D, Gd = kit.D, kit.G
    r = sol["shelf_back"]["rect"]
    x0, x1, z0, z1 = r["x0"], r["x1"], r["z0"], r["z1"]
    D.box(x0, x1, 0.0, 0.86, z0 + 0.02, z1 - 0.06, PAINT, skip=("-y",))
    D.cbox(x0, x1, 0.86, 0.9, z0, z1 - 0.06, OAK, c=0.01)
    n = int((x1 - x0) / 0.6)
    w = (x1 - x0) / n
    cols = [BLUE, MINT, BUTTER, PINK, RED, NAVY]
    rg = G.rng(9)
    for k in range(n):
        a = x0 + k * w
        D.box(a + 0.02, a + w - 0.02, 0.1, 0.8, z0 + 0.0, z0 + 0.02, PAINT.t(G.hexc("EFE9DE")))
        if k % 3 != 1:
            Gd.cbox(a + 0.06, a + w - 0.06, 0.12, 0.36, z0 + 0.03, z0 + 0.3, cols[(k * 7) % 6], c=0.02)
            Gd.cbox(a + 0.06, a + w - 0.06, 0.46, 0.7, z0 + 0.03, z0 + 0.3, cols[(k * 5 + 2) % 6], c=0.02)
        else:
            u = a + 0.06
            while u < a + w - 0.08:
                bw = rg.uniform(0.025, 0.05)
                bh = rg.uniform(0.22, 0.3)
                Gd.box(u, u + bw, 0.12, 0.12 + bh, z0 + 0.03, z0 + 0.22, cols[rg.randrange(6)])
                u += bw + 0.004
    # aquarium
    ax0, ax1 = 6.9, 7.7
    D.box(ax0, ax1, 0.9, 0.93, z0 + 0.05, z1 - 0.1, OAK_DK)
    Gd.box(ax0 + 0.02, ax1 - 0.02, 0.93, 1.3, z0 + 0.07, z1 - 0.12, GLASS)
    Gd.box(ax0 + 0.03, ax1 - 0.03, 0.93, 1.22, z0 + 0.08, z1 - 0.13, S("M_glass", G.lin(0.55, 0.8, 0.85)))
    Gd.box(ax0 + 0.03, ax1 - 0.03, 0.93, 0.97, z0 + 0.08, z1 - 0.13, S("LM_school_paint", G.hexc("E8D8B0")))
    for k in range(5):
        fx = ax0 + 0.15 + k * 0.12
        fy = 1.02 + 0.05 * (k % 3)
        Gd.slab([(0.0, 0.0), (0.05, 0.02), (0.07, 0.0), (0.05, -0.02), (0.0, 0.0), (-0.025, 0.018), (-0.025, -0.018)][:4] + [(-0.025, 0.0)], ((fx, fy, z0 + 0.18), (1, 0, 0), (0, 1, 0)), 0.01, (YEL, RED, BLUE)[k % 3])
    for k in range(3):
        Gd.member((ax0 + 0.2 + k * 0.2, 0.97, z0 + 0.2), (ax0 + 0.22 + k * 0.2, 1.15, z0 + 0.2), G.prof_round(0.01, 4), LEAF)
    # plants and the toy house on top
    for px in (3.2, 5.2, 9.6, 12.6, 14.3):
        P.potted_plant(Gd, (px, 0.9, z0 + 0.18), POT, LEAF, 0.34)
    hx = 10.8
    Gd.cbox(hx - 0.15, hx + 0.15, 0.9, 1.1, z0 + 0.08, z0 + 0.3, BUTTER, c=0.01)
    Gd.lathe([(0.21, 0.0), (0.0, 0.14)], 4, RED, hx, z0 + 0.19, 1.1, phase=math.pi / 4, smooth=False)
    Gd.lathe([(0.05, 0.0), (0.05, 0.12), (0.0, 0.12)], 8, GLASS, 8.6, z0 + 0.2, 0.9)
    for k in range(5):
        Gd.member((8.6 + 0.02 * math.cos(k), 0.92, z0 + 0.2 + 0.02 * math.sin(k)), (8.6 + 0.03 * math.cos(k), 1.08, z0 + 0.2 + 0.03 * math.sin(k)), G.prof_round(0.005, 4), cols[k])


def art(kit):
    """Children's paintings pinned between the back windows and on the right wall: paper sheets with painted suns, houses,
    trees and flowers in raised colour (thin layers), coloured pins; a cork notice board with a timetable grid (lines only)."""
    Gd = kit.G
    f = R.walls(X, Z)["back"]
    rg = G.rng(21)
    spots = [(X - 1.35, 1.35), (X - 2.65, 1.5), (X - 2.0, 2.15), (X - 1.3, 2.8), (X - 2.7, 2.8), (X - 6.05, 1.45), (X - 6.05, 2.1), (X - 6.05, 2.75),
             (X - 9.35, 1.45), (X - 9.35, 2.1), (X - 9.35, 2.75), (X - 12.7, 1.35), (X - 14.0, 1.6), (X - 13.3, 2.25), (X - 12.6, 2.85), (X - 14.1, 2.85)]
    for (u, v) in spots:
        w, h = 0.6, 0.44
        f.box(Gd, u - w / 2, u + w / 2, v - h / 2, v + h / 2, 0.0, 0.004, PAPER, skip=("-w",))
        kind = rg.randrange(3)
        if kind == 0:
            f.poly(Gd, [(u - 0.14 + 0.1 * math.cos(2 * math.pi * k / 10), v + 0.08 + 0.1 * math.sin(2 * math.pi * k / 10), 0.006) for k in range(10)], YEL)
            f.poly(Gd, [(u - w / 2 + 0.02, v - h / 2 + 0.02, 0.006), (u + w / 2 - 0.02, v - h / 2 + 0.02, 0.006), (u + w / 2 - 0.02, v - 0.06, 0.006), (u - w / 2 + 0.02, v - 0.06, 0.006)], LEAF)
        elif kind == 1:
            f.poly(Gd, [(u - 0.08, v - 0.12, 0.006), (u + 0.08, v - 0.12, 0.006), (u + 0.08, v, 0.006), (u - 0.08, v, 0.006)], PINK)
            f.poly(Gd, [(u - 0.11, v, 0.007), (u + 0.11, v, 0.007), (u, v + 0.1, 0.007)], RED)
            f.poly(Gd, [(u + 0.12 + 0.05 * math.cos(2 * math.pi * k / 8), v + 0.08 + 0.05 * math.sin(2 * math.pi * k / 8), 0.006) for k in range(8)], YEL)
        else:
            f.poly(Gd, [(u - 0.012, v - 0.13, 0.006), (u + 0.012, v - 0.13, 0.006), (u + 0.012, v, 0.006), (u - 0.012, v, 0.006)], OAK_DK)
            f.poly(Gd, [(u + 0.09 * math.cos(2 * math.pi * k / 10), v + 0.05 + 0.08 * math.sin(2 * math.pi * k / 10), 0.007) for k in range(10)], LEAF_DK)
            for k in range(4):
                f.poly(Gd, [(u - 0.15 + k * 0.1 + 0.025 * math.cos(2 * math.pi * j / 6), v - 0.11 + 0.025 * math.sin(2 * math.pi * j / 6), 0.007) for j in range(6)], (RED, PINK, YEL, BLUE)[k])
        for du in (-w / 2 + 0.03, w / 2 - 0.03):
            p = f.p(u + du, v + h / 2 - 0.03, 0.006)
            Gd.sphere(p[0], p[1], p[2], 0.012, (RED, BLUE, YEL)[rg.randrange(3)], n=5, rings=3)
    # cork notice board on the right wall between the corridor window and the classroom pair (u = z 2.6..3.2 is the
    # partition: the board hangs on the classroom side, u 6.85..7.3 is too narrow) -> on the left wall's corridor stretch
    fl = R.walls(X, Z)["left"]
    u0, u1 = Z - 2.15, Z - 0.35
    fl.box(Gd, u0, u1, 1.0, 2.05, 0.0, 0.04, OAK_DK, skip=("-w",))
    fl.box(Gd, u0 + 0.05, u1 - 0.05, 1.05, 2.0, 0.04, 0.045, CORK, skip=("-w",))
    gu0, gu1, gv0, gv1 = u0 + 0.12, u0 + 0.92, 1.25, 1.85
    fl.box(Gd, gu0, gu1, gv0, gv1, 0.045, 0.048, PAPER, skip=("-w",))
    for k in range(1, 5):
        u = gu0 + (gu1 - gu0) * k / 5
        fl.box(Gd, u - 0.003, u + 0.003, gv0 + 0.02, gv1 - 0.02, 0.048, 0.049, NAVY, skip=("-w",))
    for k in range(1, 6):
        v = gv0 + (gv1 - gv0) * k / 6
        fl.box(Gd, gu0 + 0.02, gu1 - 0.02, v - 0.003, v + 0.003, 0.048, 0.049, NAVY, skip=("-w",))
    for k in range(6):
        cu = gu0 + 0.08 + (k % 5) * 0.16
        cv = gv0 + 0.08 + (k // 5) * 0.1 + (k % 3) * 0.1
        fl.box(Gd, cu - 0.05, cu + 0.05, cv - 0.03, cv + 0.03, 0.049, 0.05, (MINT, BUTTER, PINK, BLUE)[k % 4], skip=("-w",))
    for (u, v, c) in ((u1 - 0.45, 1.6, PINK), (u1 - 0.3, 1.25, BUTTER)):
        fl.box(Gd, u - 0.16, u + 0.16, v - 0.12, v + 0.12, 0.045, 0.048, PAPER, skip=("-w",))
        fl.poly(Gd, [(u + 0.07 * math.cos(2 * math.pi * k / 8), v + 0.07 * math.sin(2 * math.pi * k / 8), 0.05) for k in range(8)], c)


def clock(kit):
    """A school wall clock over the board side of the door (overhead): oak rim, white face, hour batons, hands at 10:10."""
    D = kit.D
    f = R.walls(X, Z)["door"]
    cx, cy = 7.7, 3.32
    n = 24
    for i in range(n):
        a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
        f.poly(D, [(cx + 0.24 * math.cos(a0), cy + 0.24 * math.sin(a0), 0.06), (cx + 0.24 * math.cos(a1), cy + 0.24 * math.sin(a1), 0.06),
                   (cx + 0.2 * math.cos(a1), cy + 0.2 * math.sin(a1), 0.06), (cx + 0.2 * math.cos(a0), cy + 0.2 * math.sin(a0), 0.06)], OAK_DK)
        f.poly(D, [(cx + 0.24 * math.cos(a0), cy + 0.24 * math.sin(a0), 0.0), (cx + 0.24 * math.cos(a1), cy + 0.24 * math.sin(a1), 0.0),
                   (cx + 0.24 * math.cos(a1), cy + 0.24 * math.sin(a1), 0.06), (cx + 0.24 * math.cos(a0), cy + 0.24 * math.sin(a0), 0.06)], OAK_DK, out=0)
    f.poly(D, [(cx + 0.2 * math.cos(2 * math.pi * i / n), cy + 0.2 * math.sin(2 * math.pi * i / n), 0.05) for i in range(n)], PAPER)
    for i in range(12):
        a = 2 * math.pi * i / 12
        c, s = math.cos(a), math.sin(a)
        f.box(D, cx + 0.16 * c - 0.006, cx + 0.16 * c + 0.006, cy + 0.16 * s - 0.006, cy + 0.16 * s + 0.006, 0.05, 0.053, NAVY)
    for (ang, L, wd) in ((math.radians(155), 0.1, 0.012), (math.radians(30), 0.16, 0.008)):
        c, s = math.cos(ang), math.sin(ang)
        f.poly(D, [(cx - 0.02 * c - wd * s, cy - 0.02 * s + wd * c, 0.056), (cx + L * c, cy + L * s, 0.056), (cx - 0.02 * c + wd * s, cy - 0.02 * s - wd * c, 0.056)], NAVY)


def bunting(kit):
    """Cotton bunting in a gentle swag across the classroom above the board end (overhead, 2.6–3.1 m)."""
    Gd = kit.G
    cols = [RED, YEL, BLUE, MINT, PINK, BUTTER]
    for (a, b) in (((0.1, 3.1, 3.0), (6.0, 3.1, 7.3)), ((0.1, 3.1, 7.3), (6.0, 3.1, 3.0))):
        n = 14
        pts = [G.lerp(a, b, t / n) for t in range(n + 1)]
        pts = [(p[0], p[1] - 0.35 * math.sin(math.pi * t / n), p[2]) for t, p in enumerate(pts)]
        for p, q in zip(pts, pts[1:]):
            Gd.member(p, q, G.prof_round(0.004, 4), PAPER)
        for t in range(n):
            p, q = pts[t], pts[t + 1]
            m = G.lerp(p, q, 0.5)
            Gd.poly([p, q, (m[0], m[1] - 0.2, m[2])], cols[t % 6])
            Gd.poly([G.add(q, (0.004, 0, 0.004)), G.add(p, (0.004, 0, 0.004)), (m[0] + 0.004, m[1] - 0.2, m[2] + 0.004)], cols[t % 6])


def plants(kit):
    """Geraniums and herbs in terracotta pots on the inner window sills."""
    Gd = kit.G
    W = R.walls(X, Z)
    for x in (4.4, 7.7, 11.0):
        u = X - x
        for du in (-0.5, 0.45):
            p = W["back"].p(u + du, 0.95, -0.17)
            pot_geranium(Gd, p)
    for (u, d) in ((1.2, (0.0,)), (5.0, (-1.2, 0.0, 1.2))):
        for du in d:
            p = W["right"].p(u + du, 0.95, -0.17)
            pot_geranium(Gd, p)


def pot_geranium(m, p):
    x, y, z = p
    m.lathe([(0.055, 0.0), (0.075, 0.12), (0.082, 0.14), (0.0, 0.14)], 8, POT, x, z, y)
    for k in range(5):
        a = k * 2 * math.pi / 5
        m.sphere(x + 0.06 * math.cos(a), y + 0.19, z + 0.06 * math.sin(a), 0.055, LEAF_DK, n=6, rings=3, sy=0.6)
    for k in range(3):
        a = k * 2 * math.pi / 3 + 0.4
        m.sphere(x + 0.05 * math.cos(a), y + 0.28, z + 0.05 * math.sin(a), 0.045, PET_RED if k % 2 else PET_PINK, n=6, rings=4)


def world_map(kit, f, u0, u1, v0, v1):
    """A school wall map of the world above the board (overhead): oak top and bottom rods, a pale-blue ocean, continents in
    soft greens and ochres as raised paper layers, a compass rose; no words."""
    D, Gd = kit.D, kit.G
    f.box(D, u0 - 0.05, u1 + 0.05, v1, v1 + 0.04, 0.0, 0.05, OAK_DK, skip=("-w",))
    f.box(D, u0 - 0.05, u1 + 0.05, v0 - 0.04, v0, 0.0, 0.05, OAK_DK, skip=("-w",))
    f.box(Gd, u0, u1, v0, v1, 0.0, 0.006, S("LM_school_plaster", G.hexc("BFD9EA")), skip=("-w",))
    du, dv = u1 - u0, v1 - v0

    def land(pts, col):
        f.poly(Gd, [(u0 + a * du, v0 + b * dv, 0.008) for a, b in pts], S("LM_school_plaster", G.hexc(col)))
    land([(0.08, 0.62), (0.2, 0.8), (0.3, 0.78), (0.28, 0.6), (0.22, 0.5), (0.18, 0.42), (0.12, 0.5)], "A9C98E")     # north america
    land([(0.24, 0.38), (0.3, 0.36), (0.32, 0.22), (0.27, 0.08), (0.24, 0.2)], "C9D88A")                           # south america
    land([(0.44, 0.62), (0.5, 0.78), (0.6, 0.8), (0.75, 0.82), (0.88, 0.7), (0.82, 0.55), (0.7, 0.52), (0.6, 0.58), (0.5, 0.56)], "D9C98E")  # eurasia
    land([(0.47, 0.5), (0.58, 0.52), (0.6, 0.36), (0.54, 0.18), (0.5, 0.3), (0.45, 0.42)], "E2B97A")              # africa
    land([(0.78, 0.3), (0.88, 0.32), (0.9, 0.2), (0.8, 0.18)], "E8C88A")                                          # australia
    land([(0.82, 0.62), (0.85, 0.66), (0.84, 0.56)], "9EC9A0")
    cx, cy = u0 + 0.92 * du, v0 + 0.15 * dv
    f.poly(Gd, [(cx, cy + 0.12, 0.009), (cx - 0.03, cy, 0.009), (cx, cy - 0.12, 0.009), (cx + 0.03, cy, 0.009)], S("LM_school_plaster", G.hexc("C8553D")))


def reading_corner(kit, sol):
    """The classroom's reading corner by the sunny side windows: a low shelf of picture books under the window (solid
    reading_shelf), a round rainbow rug, an easel with a painting (solid easel), a globe on a stand (solid globe_stand) and a
    tall leafy plant (solid plant_tall)."""
    D, Gd = kit.D, kit.G
    r = sol["reading_shelf"]["rect"]
    x0, x1, z0, z1 = r["x0"], r["x1"], r["z0"], r["z1"]
    D.box(x0, x1, 0.0, 0.82, z0, z1, PAINT.t(G.hexc("F7EBD3")), skip=("-y",))
    D.cbox(x0 - 0.0, x1, 0.82, 0.86, z0, z1, OAK, c=0.01)
    for y in (0.08, 0.44):
        z = z0 + 0.05
        rg = G.rng(int(y * 100))
        while z < z1 - 0.12:
            w = rg.uniform(0.02, 0.04)
            Gd.box(x0 + 0.02, x0 + 0.02 + 0.006, y, y + rg.uniform(0.22, 0.3), z, z + w, (RED, YEL, BLUE, MINT, PINK, NAVY, BUTTER)[rg.randrange(7)])
            # picture books face out on the top shelf
            z += w + 0.003
    for k, zc in enumerate((z0 + 0.5, z0 + 1.5, z0 + 2.6)):
        Gd.box(x0 - 0.0, x0 + 0.02, 0.86, 1.14, zc - 0.13, zc + 0.13, (YEL, BLUE, PINK)[k])
    for k in range(5):
        rr = 1.1 - k * 0.2
        Gd.lathe([(rr, 0.0), (rr, 0.006 + 0.002 * k), (0.0, 0.006 + 0.002 * k)], 28, S("LM_school_paint", G.hexc(("E46A5A", "F2A65A", "F5D76E", "8CC08A", "7FA8D8")[k])), 13.0, 4.7, 0.0)
    r = sol["easel"]["rect"]
    ex, ez = (r["x0"] + r["x1"]) / 2, (r["z0"] + r["z1"]) / 2
    for dx in (-0.28, 0.28):
        D.member((ex + dx, 0.0, ez + 0.2), (ex + dx * 0.4, 1.65, ez - 0.02), G.prof_box(0.04, 0.03), OAK)
    D.member((ex, 0.0, ez - 0.28), (ex, 1.6, ez - 0.02), G.prof_box(0.035, 0.03), OAK)
    D.box(ex - 0.34, ex + 0.34, 0.62, 0.66, ez + 0.06, ez + 0.14, OAK)
    D.box(ex - 0.3, ex + 0.3, 0.66, 1.42, ez + 0.08, ez + 0.1, PAPER)
    for (u, v, rr, c) in ((-0.12, 1.25, 0.08, YEL), (0.1, 1.0, 0.1, LEAF), (-0.05, 0.85, 0.06, RED)):
        D.poly([(ex + u + rr * math.cos(2 * math.pi * k / 10), v + rr * math.sin(2 * math.pi * k / 10), ez + 0.102) for k in range(10)], c)
    D.poly([(ex - 0.28, 0.68, ez + 0.101), (ex + 0.28, 0.68, ez + 0.101), (ex + 0.28, 0.82, ez + 0.101), (ex - 0.28, 0.82, ez + 0.101)], LEAF_DK)
    r = sol["globe_stand"]["rect"]
    gx, gz = (r["x0"] + r["x1"]) / 2, (r["z0"] + r["z1"]) / 2
    D.lathe([(0.24, 0.0), (0.24, 0.03), (0.05, 0.05), (0.035, 0.75), (0.05, 0.78)], 12, OAK, gx, gz, 0.0)
    Gd.sphere(gx, 1.0, gz, 0.2, S("LM_school_paint", G.hexc("7FB2D8")), n=16, rings=10)
    for (dx, dy, dz, rr) in ((0.08, 0.06, 0.12, 0.08), (-0.1, -0.02, 0.13, 0.07), (0.0, 0.1, -0.15, 0.08), (-0.14, 0.08, -0.06, 0.06)):
        Gd.sphere(gx + dx, 1.0 + dy, gz + dz, rr, S("LM_school_paint", G.hexc("A9C98E")), n=7, rings=4, sy=0.35)
    Gd.member((gx - 0.04, 0.8, gz), (gx + 0.04, 1.22, gz), G.prof_round(0.006, 4), BRASS)
    r = sol["plant_tall"]["rect"]
    px, pz = (r["x0"] + r["x1"]) / 2, (r["z0"] + r["z1"]) / 2
    D.lathe([(0.15, 0.0), (0.19, 0.35), (0.2, 0.38), (0.0, 0.38)], 12, POT, px, pz, 0.0)
    for k in range(18):
        a = k * 2.4
        y = 0.6 + k * 0.06
        L = 0.24
        Gd.sphere(px + L * 0.5 * math.cos(a), y, pz + L * 0.5 * math.sin(a), 0.11, LEAF if k % 2 else LEAF_DK, n=6, rings=4, sy=0.5)
    D.member((px, 0.38, pz), (px, 1.6, pz), G.prof_round(0.02, 5), OAK_DK)


def curtains(kit):
    """Soft yellow cotton curtains flat beside the windows (gathered folds within 5 cm of the wall), on oak poles."""
    W = R.walls(X, Z)
    CUR = S("LM_school_render", G.hexc("F8DE8E"))
    for f, us, w in ((W["back"], [X - x for x in (4.4, 7.7, 11.0)], 1.7), (W["right"], [5.0], 3.4), (W["right"], [1.2], 1.4)):
        for u in us:
            for side in (-1, 1):
                a = u + side * (w / 2 + 0.05)
                b = a + side * 0.32
                n = 6
                for i in range(n):
                    t0, t1 = i / n, (i + 1) / n
                    ua, ub = a + (b - a) * t0, a + (b - a) * t1
                    wa, wb = 0.02 + 0.025 * (i % 2), 0.02 + 0.025 * ((i + 1) % 2)
                    f.poly(kit.G, [(ua, 0.8, wa), (ub, 0.8, wb), (ub, 3.32, wb), (ua, 3.32, wa)], CUR, out=1)
            f.box(kit.D, u - w / 2 - 0.45, u + w / 2 + 0.45, 3.36, 3.4, 0.0, 0.05, OAK_DK, skip=("-w",))
