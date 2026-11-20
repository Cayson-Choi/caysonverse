"""케이슨 마을 학교 교실 + 복도 (lot_school_class, interior area lot:lot_school_class at (410, 0), 15.4 x 7.4, ceiling 3.7) —
the walk-in room kit (design 11, contract 11, `LOT_INTERIORS` SCHOOL_IN), pure python on b1_room / b1_parts / b1_geom.

A dream village classroom (owner 2026-11-17: "들어가서 구경하는데 아주 감동을 받을 정도로 실제와 같지만 … 이런 학교가 있었으면"),
made real (owner 2026-11-20: "학교 내부가 너무 허접하네 좀 실감나게 만들어봐. 그리고 학교에 걸린 그림액자도 너무 허접해 진짜
학생들이 그린 그림같은 걸 걸어두라고"; references: tmpshots/school-real/refs): honey oak floor, sage wainscot under warm cream
walls, oak beams, the sunny wall of tall windows (the real village behind them: windowView), linen curtains on poles;
the green chalkboard with the teacher's chalk (date, weather, today's tasks, sums, a chalk flower) and a tray of chalk, the
ㄱㄴㄷ cards above it, the wall map; the teacher's oak desk with books, a globe (the library's world chart), a pencil pot, an
apple; twelve pupils' desks (beech laminate tops, tubular steel frames, book trays) with moulded ply chairs, open exercise
books and pencils; sixteen children's drawings (school_kidart.mjs: crayon, pencil, felt-tip and paint on real paper, each
signed) pinned on a cork board, taped to the wall, on a string line with pegs over the classroom's open front; the low
cupboard with labelled plastic tubs and picture books, an aquarium, real leafy pot plants and geraniums; the reading corner;
a wall clock, a panel radiator, switches and sockets; the corridor's lockers and its cork board with the timetable.
"""
import math

import b1_geom as G
import b1_parts as P
import b1_room as R
import school_room_dress as SD
from b1_geom import Mesh, S

FLOOR = S("LM_school_floor")                                 # floor_wood
WALL = S("LM_school_render", G.hexc("FFF3DC"))               # stucco_white (the school's own render set): warm, bright
CEIL = S("LM_school_plaster", G.hexc("FFFCF5"))
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
PAPER = S("LM_school_plaster", G.hexc("FFFDF6"))
OAK = S("LM_school_oak", G.hexc("E8D2B0"))                   # wood_oak
OAK_DK = S("LM_school_oak", G.hexc("B48A62"))
BEECH = S("LM_school_oak", G.hexc("F4E8D6"))                 # the pupils' desk tops and chairs: pale beech
BEECH_EDGE = S("LM_school_oak", G.hexc("E6CCA2"))
PLY = S("LM_school_oak", G.hexc("F0DDBB"))
IRON = S("LM_school_iron", G.hexc("3B4A44"))                 # cast_iron (the aquarium stand, the tray brackets)
BRASS = S("LM_school_iron", G.hexc("D9B86A"))
STEEL = S("LM_school_plastic", G.hexc("AEB6B8"))             # powder-coated soft grey frames (the plaster set's fine tooth reads as powder coat)
STEEL_W = S("LM_school_plastic", G.hexc("F4F3EE"))             # white powder coat (radiator, switches)
CHROME = S("LM_school_alu", G.hexc("E4E6E8"))                # aluminium_brushed (valves, pipes, the clock's bezel)
BLACK = S("LM_school_plastic", G.hexc("2A2A2E"))               # glides, end caps
LEAF = S("LM_school_green", G.hexc("7DB45A"))                # grass set: leaves
LEAF_DK = S("LM_school_green", G.hexc("4F8A3C"))
GERAN_LEAF = S("LM_school_green", G.hexc("6E9E4A"))
PET_RED = S("LM_school_paint", G.hexc("E8473F"))
PET_PINK = S("LM_school_paint", G.hexc("F07EB0"))
POT = S("LM_school_floor", G.hexc("E39A70"))                 # terracotta pots (floor set, tinted)
SOIL = S("LM_school_floor", G.hexc("4A3528"))
LINEN = S("LM_school_linen", G.hexc("FFF0CC"))               # fabric_upholstery: butter-cream linen curtains
LINEN_SAGE = S("LM_school_linen", G.hexc("F2F0CC"))
TUB = {"sage": S("LM_school_plastic", G.hexc("9DB5A0")), "blue": S("LM_school_plastic", G.hexc("83AFC0")),
       "cream": S("LM_school_plastic", G.hexc("E9E1CC")), "mustard": S("LM_school_plastic", G.hexc("D5B65D")),
       "coral": S("LM_school_plastic", G.hexc("E39A86"))}
DARK = S("LM_school_plastic", G.hexc("5A5A5E"))
CORK_BACK = S("LM_school_oak", G.hexc("C99A66"))
GLASS = P.GLASS
OPAL = S("M_glass", G.lin(0.95, 0.95, 0.92))

MATS = {
    "LM_school_floor": {"set": "floor_wood", "rough": 0.8},
    "LM_school_plaster": {"set": "plaster_painted"},
    "LM_school_render": {"set": "stucco_white", "rough": 0.95},
    "LM_school_paint": {"set": "wood_painted", "normal": 0.5},
    "LM_school_oak": {"set": "wood_oak", "rough": 0.7},
    "LM_school_iron": {"set": "cast_iron", "metal": True},
    "LM_school_plastic": {"set": "plaster_painted", "rough": 0.5, "normal": 0.3},
    "LM_school_alu": {"set": "aluminium_brushed", "metal": True, "rough": 0.6},
    "LM_school_fabric": {"set": "fabric_upholstery", "gain": (2.3, 2.3, 2.3)},
    # the curtains' linen: the fabric set's albedo is dark and warm (its curtains read olive under a cream tint, 2026-11-20 review);
    # this gain (measured off the rendered folds) brings it to cream with the weave kept
    "LM_school_linen": {"set": "fabric_upholstery", "gain": (8.6, 8.9, 11.0)},
    "LM_school_green": {"set": "grass", "normal": 0.5},
    "M_glass": {"glass": True},
    "M_garden": R.garden_map("lot_school_class"),
    # the classroom's own atlas (school_kidart.mjs, procedural: children's drawings, chalk, cards, labels, spines, cork)
    "M_school_art": {"own": "lot_school_class_art", "normal": "lot_school_class_art_normal", "orm": "lot_school_class_art_orm",
                     "note": "procedural (school_kidart.mjs): sixteen children's drawings on paper (crayon, pencil, felt-tip, paint), albedo 4096 x 2896 ETC1S sRGB, normal + ORM (G roughness) 2048 x 1448 UASTC linear"},
    "M_school_print": {"own": "lot_school_class_print", "normal": "lot_school_class_print_normal", "orm": "lot_school_class_print_orm", "vertexColor": True,
                       "note": "procedural (school_kidart.mjs): the chalkboard's chalk, the hangul cards, bin labels, clock dial, timetable, cork, exercise book, tape, paper backs, picture-book spines; albedo 2048 UASTC sRGB, normal + ORM 1024 UASTC linear; COLOR_0 tints the book covers"},
    # the library's world chart, shared (Natural Earth; SOURCES_lot_library.md)
    "M_globe": {"own": "../library/lot_library_globe", "note": "the library's globe chart (Natural Earth land and rivers; SOURCES_lot_library.md)"},
}

X, Z, H = 15.4, 7.4, 3.7
PHONE = False   # the phone LOD (lot_school_class_phone.glb): the same room and atlases, lighter geometry


def build(spec, unit, layout, phone=False):
    global PHONE, BRASS, IRON, CHROME
    PHONE = phone
    SD.PHONE = phone
    if phone:
        # the phone: brass, iron and brushed metal as tinted plastic (three materials, three draw calls fewer)
        BRASS = S("LM_school_plastic", G.hexc("D9B86A"))
        IRON = S("LM_school_plastic", G.hexc("3B4A44"))
        CHROME = S("LM_school_plastic", G.hexc("E4E6E8"))
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
    for x in (4.4, 7.7, 11.0):
        R.window(kit, W["back"], X - x, 0.95, 1.7, 2.3, PAINT, OAK, WALL, cols=2, rows=3)
    R.window(kit, W["right"], 1.2, 0.95, 1.4, 2.3, PAINT, OAK, WALL, cols=2, rows=3)
    R.window(kit, W["right"], 5.0, 0.95, 3.4, 2.3, PAINT, OAK, WALL, cols=4, rows=3)
    for a in (0.7, 3.3, 10.3, 12.9):
        R.window(kit, W["door"], a + 0.9, 2.25, 1.8, 1.05, PAINT, OAK, WALL, cols=3, rows=1, depth=0.3)
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
    for (u, sgn) in ((6.6, 1), (8.8, -1)):
        q = [f.p(u, 0.0, 0.0), f.p(u, 2.9, 0.0), f.p(u, 2.9, -0.12), f.p(u, 0.0, -0.12)]
        if G.dot(G.poly_normal(q), G.mul(f.U, sgn)) < 0:
            q.reverse()
        S_.poly(q, WALL)
    R.wainscot(D, W["back"], 0.0, X, 0.95, SAGE, PAINT)
    R.wainscot(D, W["right"], 2.45, Z, 0.95, SAGE, PAINT)
    R.wainscot(D, W["left"], 0.0, Z - 2.45, 0.95, SAGE, PAINT)
    R.beams(D, X, Z, H, OAK_DK, step=2.2)
    lockers(kit, sol)
    partition(kit)
    board(kit)
    teacher(kit)
    desks(kit, spec)
    back_shelf(kit, sol)
    art(kit)
    seg = 10 if PHONE else 24
    opal = None  # (the globes map the print atlas's blank paper: school_room_dress.school_pendant)
    cord = S("LM_school_fabric", G.hexc("3A3632"))
    for x in (4.0, 8.4, 12.8):
        for z in (3.9, 6.0):
            SD.school_pendant(kit, D, x, z, H, 1.0, PAINT, cord, BRASS, opal, segs=seg)
    for x in (3.0, 12.4):
        SD.school_pendant(kit, D, x, 1.2, H, 0.8, PAINT, cord, BRASS, opal, r=0.15, segs=seg)
    # a round braided welcome rug in the corridor
    for k, (r, c) in enumerate(((1.0, "E7A07A"), (0.82, "F3D9A6"), (0.62, "9CC0A8"), (0.42, "F3D9A6"), (0.22, "E7A07A"))):
        Gd.lathe([(r, 0.0), (r, 0.006 + k * 0.002), (0.0, 0.006 + k * 0.002)], 32 if not PHONE else 16, S("LM_school_fabric", G.hexc(c)), 7.7, 1.3, 0.0)
    clock(kit)
    bunting(kit)
    reading_corner(kit, sol)
    curtains(kit)
    fixtures(kit)
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
            if PHONE:
                D.box(a, b, 0.1, 1.82, 0.06, 0.5, s.u((0, 1, 0)), skip=("-z",))
            else:
                D.cbox(a, b, 0.1, 1.82, 0.06, 0.5, s.u((0, 1, 0)), c=0.01, skip=("-z",))
            for v in ((1.55, 1.6, 1.65) if not PHONE else (1.6,)):
                D.box(a + 0.12, b - 0.12, v, v + 0.018, 0.5, 0.505, s.t(G.mul(s.col, 0.7)))
            Gd.box(a + w / 2 - 0.06, a + w / 2 + 0.06, 1.38, 1.44, 0.5, 0.505, BRASS)
            if PHONE:
                Gd.box(b - 0.066, b - 0.054, 0.99, 1.11, 0.5, 0.509, BRASS, skip=("-z",))
            else:
                for y in (1.0, 1.10):
                    Gd.member((b - 0.06, y, 0.5), (b - 0.06, y, 0.506), G.prof_round(0.0042, 6), BRASS)
                Gd.member((b - 0.06, 0.99, 0.5055), (b - 0.06, 1.11, 0.5055), G.prof_round(0.0048, 6), BRASS, caps=True)
        D.box(x0, x1, 1.82, 1.9, 0.04, 0.5, PAINT)
        for k in range(3):
            px = x0 + 0.6 + k * (x1 - x0 - 1.2) / 2
            SD.leafy_plant(Gd, px, 1.9, 0.28, POT, SOIL, LEAF, LEAF_DK, h=0.36, rg=G.rng(int(px * 10)))


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


def bunting(kit):
    """Cotton bunting: two strings crossing above the board end (overhead, 2.7–3.2 m), each tied at the walls and to a hook at
    the crossing, sagging between; cloth pennants with folded hems over the string, a little billow, white running stitches."""
    # (on the linen material: the plain fabric set's dark warm albedo muddied the pennants' colours)
    cols = [S("LM_school_linen", G.hexc(c)) for c in ("D8483C", "EFC23A", "5C96CC", "7CC08E", "EE90AC", "F6E2A8")]
    rg = G.rng(13)
    hook = (3.05, 3.2, 5.15)
    for (a, b) in (((0.1, 3.18, 3.0), (6.0, 3.18, 7.3)), ((0.1, 3.18, 7.3), (6.0, 3.18, 3.0))):
        SD.bunting_line(kit.G, [a, hook, b], 0.22, 6 if PHONE else 7, cols, S("LM_school_linen", G.hexc("F4EEE0")), PAPER, rg, stitches=not PHONE)


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


PINS = [S("LM_school_plastic", G.hexc(c)) for c in ("E2453C", "2F6FD0", "F2C230", "3FA35A", "F2F2EE")]


def board(kit):
    """The chalkboard on the left wall (solid board: x 0..0.12, z 3..7): an oak frame, the slate face (the atlas's chalkboard:
    the teacher's chalk — the date, the weather, today's tasks, sums, a chalk house and flower — over a faint eraser haze),
    an oak chalk tray with chalk sticks and a felt eraser; above it the ㄱㄴㄷ cards (taped, a little uneven) and the wall map."""
    D, Gd = kit.D, kit.G
    f = R.walls(X, Z)["left"]
    f.box(D, 0.4, 4.4, 0.85, 2.3, 0.0, 0.05, OAK_DK, c=0.008, skip=("-w",))
    c0, c1, t0, t1 = SD.uvr("chalkboard", inset=2)
    q = [f.p(0.48, 0.93, 0.0552), f.p(4.32, 0.93, 0.0552), f.p(4.32, 2.22, 0.0552), f.p(0.48, 2.22, 0.0552)]
    SD.face(D, q, [(c0, t0), (c1, t0), (c1, t1), (c0, t1)], s=SD.PRINT, want=(1, 0, 0))
    # the tray: a shelf with a raised front lip on two brackets
    f.box(D, 0.45, 4.35, 0.84, 0.86, 0.05, 0.13, OAK_DK, c=0.004, skip=("-w",))
    f.box(D, 0.45, 4.35, 0.86, 0.885, 0.118, 0.13, OAK_DK, c=0.003)
    for u in (0.9, 2.4, 3.9):
        f.box(D, u - 0.015, u + 0.015, 0.76, 0.84, 0.05, 0.11, IRON)
    for (u, l, c) in ((1.1, 0.08, CHALK), (1.25, 0.06, CHALK), (1.42, 0.075, S("LM_school_plaster", G.hexc("F6DF8A"))), (1.56, 0.05, S("LM_school_plaster", G.hexc("F4B8C6"))), (2.9, 0.07, CHALK)):
        Gd.member(f.p(u, 0.869, 0.085), f.p(u + l, 0.869, 0.09), G.prof_round(0.0055, 6), c, caps=True)
    # the felt eraser: a wooden back and a grey felt pad
    f.box(Gd, 3.5, 3.66, 0.86, 0.885, 0.06, 0.11, OAK, c=0.004)
    f.box(Gd, 3.505, 3.655, 0.885, 0.905, 0.062, 0.108, S("LM_school_fabric", G.hexc("8C8C90")))
    # the ㄱㄴㄷ cards above the board
    U = (0, 0, -1)
    N = (1, 0, 0)
    rg = G.rng(31)
    cw = 3.84 / 14
    for k in range(14):
        u = 0.48 + cw * (k + 0.5)
        o = f.p(u, 2.55 + rg.uniform(-0.01, 0.01), 0.0)
        cn, Ur, Vr = SD.sheet(Gd, o, U, N, cw - 0.012, 0.36, "hangul", rot=math.radians(rg.uniform(-1.5, 1.5)), rg=rg, curl=0.002, nu=1, nv=1, sub=(k / 14, 0, (k + 1) / 14, 1))
        SD.tape(Gd, G.add(cn["tl"], G.add(G.mul(Ur, 0.03), G.mul(Vr, -0.006))), U, N, rg.uniform(-0.2, 0.2), l=0.045, w=0.018)
    world_map(kit, f, 1.0, 3.8, 2.86, 3.46)


def teacher(kit):
    """The teacher's oak desk (solid teacher_desk x 1.2..2, z 4.4..6, 0.78): a rounded, bevelled top, a three-drawer pedestal
    with brass pulls, a modesty panel to the class, a tucked-in chair; on it a globe (the library's chart), picture books between
    bookends, a pot of coloured pencils, a pile of exercise books, an apple, a little brass bell and a pot plant."""
    D, Gd = kit.D, kit.G
    x0, x1, z0, z1 = 1.2, 2.0, 4.4, 6.0
    SD.top_slab(D, x0, x1, z0, z1, 0.75, 0.78, 0.03, OAK.u((0, 0, 1)), OAK)
    D.cbox(x0 + 0.03, x1 - 0.03, 0.04, 0.75, z1 - 0.48, z1 - 0.03, OAK, c=0.01, skip=("-y",))
    for k in range(3):
        y = 0.08 + k * 0.22
        D.cbox(x0 + 0.015, x0 + 0.035, y, y + 0.2, z1 - 0.46, z1 - 0.05, OAK, c=0.004)
        Gd.member((x0 + 0.015, y + 0.12, z1 - 0.3), (x0 - 0.0045, y + 0.12, z1 - 0.3), G.prof_round(0.0035, 6), BRASS)
        Gd.member((x0 - 0.0045, y + 0.12, z1 - 0.31), (x0 - 0.0045, y + 0.12, z1 - 0.2), G.prof_round(0.0045, 6), BRASS, caps=True)
        Gd.member((x0 + 0.015, y + 0.12, z1 - 0.21), (x0 - 0.0045, y + 0.12, z1 - 0.21), G.prof_round(0.0035, 6), BRASS)
    for z in (z0 + 0.04,):
        D.cbox(x0 + 0.03, x0 + 0.08, 0.0, 0.75, z - 0.025, z + 0.025, OAK, c=0.006)
        D.cbox(x1 - 0.08, x1 - 0.03, 0.0, 0.75, z - 0.025, z + 0.025, OAK, c=0.006)
    D.cbox(x1 - 0.05, x1 - 0.02, 0.2, 0.75, z0 + 0.04, z1 - 0.48, OAK, c=0.005)
    for (zz) in (z0 + 0.04, z1 - 0.03):
        for xx in (x0 + 0.055, x1 - 0.055):
            D.box(xx - 0.02, xx + 0.02, 0.0, 0.01, zz - 0.02, zz + 0.02, BLACK)
    ch = R.chair_kind("tchair", OAK, OAK_DK)
    D.extend(G.moved(ch, 1.48, 0.0, 4.8, math.pi / 2))
    # on the desk
    gx, gz = 1.62, 5.72
    Gd.lathe([(0.0, 0.0), (0.08, 0.0), (0.085, 0.012), (0.06, 0.022), (0.016, 0.034), (0.012, 0.06), (0.0, 0.06)], 16, OAK_DK, gx, gz, 0.78)
    SD.globe(Gd, gx, 0.78 + 0.06 + 0.13, gz, 0.12, OAK_DK, BRASS)
    rg = G.rng(77)
    for (bz) in (4.47,):
        Gd.box(1.32, 1.52, 0.78, 0.94, bz - 0.006, bz, BRASS)
    u = 4.48
    while u < 4.82:
        w = rg.uniform(0.012, 0.03)
        SD.book(Gd, 1.53, 0.78, u, w, rg.uniform(0.2, 0.26), rg.uniform(0.16, 0.2), rg.randrange(24), axis="xp")
        u += w + 0.002
    Gd.box(1.32, 1.52, 0.78, 0.94, u + 0.002, u + 0.008, BRASS)
    # a pile of exercise books (covers in pastel card, the page edges showing)
    for k, c in enumerate(("F2BDC0", "A8C8E0", "B8E0C8", "F3DE9A", "F2BDC0", "D6C6E8")):
        y = 0.78 + k * 0.007
        Gd.cbox(1.62, 1.86, y, y + 0.007, 4.96 + rg.uniform(-0.01, 0.01), 5.13 + rg.uniform(-0.01, 0.01), S("LM_school_paint", G.hexc(c)), c=0.0015)
    Gd.sphere(1.85, 0.825, 4.6, 0.042, S("LM_school_paint", G.hexc("C8302A")), n=12, rings=8)
    Gd.member((1.85, 0.862, 4.6), (1.856, 0.885, 4.6), G.prof_round(0.0035, 4), OAK_DK)
    Gd.lathe([(0.0, 0.0), (0.035, 0.0), (0.036, 0.1), (0.032, 0.1), (0.031, 0.006), (0.0, 0.006)], 12, S("LM_school_plastic", G.hexc("6FA6D6")), 1.4, 5.15, 0.78)
    for k in range(7):
        a = k * 0.9
        base = (1.4 + 0.012 * math.cos(a), 0.79, 5.15 + 0.012 * math.sin(a))
        tip = (1.4 + 0.03 * math.cos(a), 0.95 + 0.02 * (k % 3), 5.15 + 0.03 * math.sin(a))
        SD.pencil(Gd, base, tip, S("LM_school_paint", G.hexc(("E2453C", "F2C230", "2F6FD0", "3FA35A", "F08A2F", "8A5AB0", "2A2A2E")[k])), S("LM_school_oak", G.hexc("E8C9A0")), BLACK)
    Gd.lathe([(0.05, 0.0), (0.045, 0.06), (0.02, 0.09), (0.008, 0.14), (0.015, 0.16)], 12, BRASS, 1.8, 5.32, 0.78)
    SD.leafy_plant(Gd, 1.42, 0.78, 5.5, POT, SOIL, LEAF, LEAF_DK, h=0.26, rg=G.rng(5))


def desks(kit, spec):
    """Twelve pupils' desks (solids desk_1..12) and chairs (seats lot_school_chair_1..12, facing the board = -x) — the
    references' beech-and-steel classroom furniture; on each desk an open exercise book with a child's 받아쓰기 and a pencil,
    a pencil case or an eraser on some."""
    Gd = kit.G
    dk = SD.pupil_desk(BEECH, BEECH_EDGE, STEEL, PLY, BLACK)
    # the chairs' frames in four soft powder-coat colours (sage, sky, butter, coral), as in many new primary classrooms
    chs = [SD.pupil_chair(BEECH, S("LM_school_plastic", G.hexc(c)), BLACK, S("LM_school_plastic", G.hexc("C9CCCF"))) for c in (("8FB79A", "86B4D6", "E9C55E", "E58F7A") if not PHONE else ("86B4D6",))]
    rg = G.rng(4)
    covers = [S("LM_school_paint", G.hexc(c)) for c in ("F2BDC0", "A8C8E0", "B8E0C8", "F3DE9A", "D6C6E8")]
    for s in spec["solids"]:
        if not s["name"].startswith("desk_"):
            continue
        r = s["rect"]
        cx, cz = (r["x0"] + r["x1"]) / 2, (r["z0"] + r["z1"]) / 2
        kit.place("desk", dk, cx, 0.0, cz, 0.0)
        yaw = -math.pi / 2 + rg.uniform(-0.12, 0.12)
        bx, bz = cx + 0.06, cz + rg.uniform(-0.12, 0.12)
        SD.exercise_book(Gd, bx, 0.72, bz, yaw, covers[rg.randrange(len(covers))], rg)
        px = cx + 0.2
        pz = bz + rg.uniform(-0.25, -0.15) if bz > cz else bz + rg.uniform(0.15, 0.25)
        if not PHONE:
            SD.pencil(Gd, (px - 0.01, 0.7255, pz - 0.08), (px + 0.005, 0.7255, pz + 0.08), S("LM_school_paint", G.hexc(("F2C230", "3FA35A", "E2453C")[rg.randrange(3)])), S("LM_school_oak", G.hexc("E8C9A0")), BLACK)
        if rg.random() < 0.45:
            ez = cz - 0.3 if bz > cz - 0.05 else cz + 0.3
            Gd.cbox(cx - 0.06, cx + 0.14, 0.72, 0.755, ez - 0.035, ez + 0.035, S("LM_school_fabric", G.hexc(("4A6FA5", "C85A7A", "5E9A6A", "E0A040")[rg.randrange(4)])), c=0.012)
        elif rg.random() < 0.5:
            Gd.cbox(cx - 0.12, cx - 0.08, 0.72, 0.732, cz - 0.3, cz - 0.27, S("LM_school_paint", G.hexc("F4F2EC")), c=0.003)
    for i, s in enumerate(spec["seats"]):
        jit = rg.uniform(-0.035, 0.035)
        kit.place("pchair_%d" % (i % len(chs)), chs[i % len(chs)], s["x"], 0.0, s["z"], -math.pi / 2 + jit)


def back_shelf(kit, sol):
    """The low white cupboard under the back windows (solid shelf_back): an oak top, open cubbies — two of every three with
    tapered plastic tubs (rolled rims, finger recesses, laminated labels: 크레파스, 색연필, 가위, 풀, 색종이, 물감, 블록, 공책), the
    third with picture books (spines from the atlas); on top real pot plants, the aquarium, a wooden toy house and a jar of
    crayons."""
    D, Gd = kit.D, kit.G
    r = sol["shelf_back"]["rect"]
    x0, x1, z0, z1 = r["x0"], r["x1"], r["z0"], r["z1"]
    D.box(x0, x1, 0.0, 0.86, z1 - 0.085, z1 - 0.06, PAINT.t(G.hexc("BAAA93")), skip=("-y", "+z", "+y"))
    D.box(x0, x1, 0.0, 0.12, z0 + 0.035, z1 - 0.085, PAINT, skip=("-y", "+z"))
    D.box(x0, x1, 0.43, 0.46, z0 + 0.015, z1 - 0.085, PAINT, skip=("+z",))
    SD.top_slab(D, x0, x1, z0, z1 - 0.06, 0.86, 0.9, 0.012, OAK.u((1, 0, 0)), OAK)
    n = int((x1 - x0) / 0.6)
    w = (x1 - x0) / n
    tubs = ["sage", "blue", "cream", "mustard", "coral"]
    rg = G.rng(9)
    for k in range(n + 1):
        x = x0 + k * w
        for lo, hi in ((0.12, 0.43), (0.46, 0.86)):
            D.box(max(x0, x - 0.014), min(x1, x + 0.014), lo, hi, z0 + 0.015, z1 - 0.085, PAINT, skip=("-y", "+y", "+z"))
    lab = 0
    for k in range(n):
        a = x0 + k * w
        for bottom in (0.12, 0.46):
            if k % 3 != 1:
                SD.plastic_bin(Gd, a + 0.045, a + w - 0.045, bottom + 0.002, bottom + 0.25, z0 + 0.035, z1 - 0.1, TUB[tubs[(k * 3 + int(bottom * 10)) % 5]], lab % 8, rg, DARK)
                lab += 3
            else:
                SD.book_run(Gd, a + 0.02, a + w - 0.03, bottom, z0 + 0.03, 0.28, rg, axis="z", hmin=0.2, hmax=0.29)
    # aquarium
    ax0, ax1 = 6.9, 7.7
    D.box(ax0, ax1, 0.9, 0.93, z0 + 0.05, z1 - 0.1, OAK_DK)
    Gd.box(ax0 + 0.02, ax1 - 0.02, 0.93, 1.3, z0 + 0.07, z1 - 0.12, GLASS)
    Gd.box(ax0 + 0.03, ax1 - 0.03, 0.93, 1.22, z0 + 0.08, z1 - 0.13, S("M_glass", G.lin(0.55, 0.8, 0.85)))
    Gd.box(ax0 + 0.03, ax1 - 0.03, 0.93, 0.97, z0 + 0.08, z1 - 0.13, S("LM_school_paint", G.hexc("E8D8B0")))
    Gd.box(ax0 + 0.01, ax1 - 0.01, 1.3, 1.32, z0 + 0.06, z1 - 0.11, BLACK)
    for k in range(5):
        fx = ax0 + 0.15 + k * 0.12
        fy = 1.02 + 0.05 * (k % 3)
        Gd.slab([(0.0, 0.0), (0.05, 0.02), (0.07, 0.0), (0.05, -0.02), (-0.025, 0.0)], ((fx, fy, z0 + 0.18), (1, 0, 0), (0, 1, 0)), 0.01, (YEL, RED, BLUE)[k % 3])
    for k in range(3):
        Gd.member((ax0 + 0.2 + k * 0.2, 0.97, z0 + 0.2), (ax0 + 0.22 + k * 0.2, 1.15, z0 + 0.2), G.prof_round(0.01, 4), LEAF)
    for px in (3.2, 5.2, 9.6, 12.6, 14.3):
        SD.leafy_plant(Gd, px, 0.9, z0 + 0.22, POT, SOIL, LEAF, LEAF_DK, h=0.28, rg=G.rng(int(px * 10)))
    hx = 10.8
    Gd.cbox(hx - 0.15, hx + 0.15, 0.9, 1.1, z0 + 0.08, z0 + 0.3, BUTTER, c=0.01)
    Gd.lathe([(0.21, 0.0), (0.0, 0.14)], 4, RED, hx, z0 + 0.19, 1.1, phase=math.pi / 4, smooth=False)
    Gd.lathe([(0.05, 0.0), (0.05, 0.12), (0.0, 0.12)], 12, GLASS, 8.6, z0 + 0.2, 0.9)
    for k in range(6):
        Gd.member((8.6 + 0.02 * math.cos(k), 0.92, z0 + 0.2 + 0.02 * math.sin(k)), (8.6 + 0.03 * math.cos(k), 1.06, z0 + 0.2 + 0.03 * math.sin(k)), [(0.0045 * math.cos(math.pi / 4 * i), 0.0045 * math.sin(math.pi / 4 * i)) for i in range(8)],
                  (RED, YEL, BLUE, MINT, PINK, NAVY)[k])


def art(kit):
    """The children's drawings (school_kidart.mjs): six pinned on a cork board at the board end of the back wall, two taped in
    the gap between the windows and the class timetable in the other, four taped at the reading-corner end, three on a string
    line with wooden pegs under the transom over the classroom's open front (another drawing on each back, for the corridor),
    one on the easel; the corridor's cork board with four more. Pins and tape as in the references; every sheet a little
    crooked, the lower corners lifting."""
    Gd = kit.G
    W = R.walls(X, Z)
    fb = W["back"]
    rg = G.rng(2026)
    # the cork board (x 0.35 .. 2.4 on the back wall)
    u0, u1 = X - 2.4, X - 0.35
    d = SD.cork_board(Gd, fb, u0, u1, 1.15, 2.2, OAK, CORK_BACK)
    names = ["family", "rainbow", "cat", "dog", "fountain", "me"]
    cu = (u0 + u1) / 2
    for i, nm in enumerate(names):
        u = cu + (i % 3 - 1) * 0.64 + rg.uniform(-0.03, 0.03)
        v = (1.9 if i < 3 else 1.44) + rg.uniform(-0.02, 0.02)
        SD.drawing_on_wall(Gd, fb, u, v, nm, rg, how="pins", pin_s=PINS, wall_w=d)
    # the gaps between the windows
    SD.drawing_on_wall(Gd, fb, X - 6.05 + 0.02, 2.12, "flowers", rg, how="tape")
    SD.drawing_on_wall(Gd, fb, X - 6.05 - 0.02, 1.62, "butterfly", rg, how="tape")
    tt = SD.drawing_on_wall(Gd, fb, X - 9.35, 1.86, "timetable", rg, how="pins", pin_s=PINS, w=0.4, h=0.537)
    # the reading-corner end
    for i, nm in enumerate(["coaster", "appletree", "lake", "dino"]):
        u = (1.15 if i % 2 == 0 else 2.5) + rg.uniform(-0.04, 0.04)
        v = (2.34 if i < 2 else 1.78) + rg.uniform(-0.03, 0.03)
        SD.drawing_on_wall(Gd, fb, u, v, nm, rg, how="tape")
    # the string line under the transom (classroom side), three sheets back to back
    a, b = (9.15, 3.11, 2.475), (12.55, 3.11, 2.475)
    SD.string_line(Gd, a, b, 0.07, [(0.2, "bus", "family"), (0.5, "night", "cat"), (0.8, "handprints", "coaster")], rg,
                   S("LM_school_fabric", G.hexc("F1E9D6")), S("LM_school_oak", G.hexc("E6C9A0")), CHROME)
    # the corridor's cork board (left wall, z 0.35 .. 2.15) with four drawings
    fl = W["left"]
    u0, u1 = Z - 2.2, Z - 0.3
    d = SD.cork_board(Gd, fl, u0, u1, 1.0, 2.1, OAK, CORK_BACK)
    for i, nm in enumerate(["rainbow", "me", "dino", "butterfly"]):
        u = (u0 + u1) / 2 + (-0.45 if i % 2 == 0 else 0.45) + rg.uniform(-0.03, 0.03)
        v = (1.8 if i < 2 else 1.32) + rg.uniform(-0.02, 0.02)
        SD.drawing_on_wall(Gd, fl, u, v, nm, rg, how="pins", pin_s=PINS, wall_w=d)


def clock(kit):
    """A school wall clock over the door (overhead): an oak rim with a rounded front, the atlas dial (numerals, minute marks)
    under a glass, black hands at 10:10 and a red second hand."""
    D = kit.D
    f = R.walls(X, Z)["door"]
    cx, cy = 7.7, 3.32
    n = 32
    for i in range(n):
        a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
        for (r0, r1, w0, w1) in ((0.2, 0.235, 0.06, 0.068), (0.235, 0.25, 0.068, 0.05), (0.25, 0.25, 0.05, 0.0)):
            f.poly(D, [(cx + r0 * math.cos(a0), cy + r0 * math.sin(a0), w0), (cx + r0 * math.cos(a1), cy + r0 * math.sin(a1), w0),
                       (cx + r1 * math.cos(a1), cy + r1 * math.sin(a1), w1), (cx + r1 * math.cos(a0), cy + r1 * math.sin(a0), w1)], OAK_DK, out=1)
        f.poly(D, [(cx + 0.2 * math.cos(a0), cy + 0.2 * math.sin(a0), 0.06), (cx + 0.2 * math.cos(a1), cy + 0.2 * math.sin(a1), 0.06),
                   (cx + 0.2 * math.cos(a1), cy + 0.2 * math.sin(a1), 0.045), (cx + 0.2 * math.cos(a0), cy + 0.2 * math.sin(a0), 0.045)], OAK_DK, out=-1)
    SD.clock_face(D, f, cx, cy, 0.2, 0.045)
    BL = S("LM_school_plastic", G.hexc("1E1E24"))
    for (ang, L, wd, s, w) in ((math.radians(150 - 5), 0.11, 0.011, BL, 0.05), (math.radians(30), 0.16, 0.007, BL, 0.052), (math.radians(-40), 0.17, 0.0025, S("LM_school_plastic", G.hexc("D8302A")), 0.054)):
        c, s_ = math.cos(ang), math.sin(ang)
        f.poly(D, [(cx - 0.03 * c - wd * s_, cy - 0.03 * s_ + wd * c, w), (cx + L * c - wd * 0.4 * s_, cy + L * s_ + wd * 0.4 * c, w),
                   (cx + L * c + wd * 0.4 * s_, cy + L * s_ - wd * 0.4 * c, w), (cx - 0.03 * c + wd * s_, cy - 0.03 * s_ - wd * c, w)], s)
    pts = [(cx + 0.012 * math.cos(2 * math.pi * k / 10), cy + 0.012 * math.sin(2 * math.pi * k / 10), 0.056) for k in range(10)]
    f.poly(D, pts, BL)


def plants(kit):
    """Geraniums (round scalloped leaves, umbels of red and pink flowers) and a herb on the inner window sills."""
    Gd = kit.G
    W = R.walls(X, Z)
    k = 0
    for x in (4.4, 7.7, 11.0):
        u = X - x
        for du in (-0.5, 0.45):
            p = W["back"].p(u + du, 0.95, -0.17)
            SD.leafy_plant(Gd, p[0], p[1], p[2], POT, SOIL, GERAN_LEAF, LEAF_DK, h=0.28, rg=G.rng(40 + k), flowers=3, flower_s=PET_RED if k % 2 else PET_PINK)
            k += 1
    for (u, d) in ((1.2, (0.0,)), (5.0, (-1.2, 0.0, 1.2))):
        for du in d:
            p = W["right"].p(u + du, 0.95, -0.17)
            SD.leafy_plant(Gd, p[0], p[1], p[2], POT, SOIL, GERAN_LEAF, LEAF_DK, h=0.28, rg=G.rng(40 + k), flowers=3, flower_s=PET_RED if k % 2 else PET_PINK)
            k += 1


def reading_corner(kit, sol):
    """The reading corner by the sunny side windows: a low shelf of picture books (the atlas spines) under the window (solid
    reading_shelf), a round rainbow rug, an easel with an unfinished pencil drawing (solid easel), a school globe on a stand
    (solid globe_stand: the library's chart), a tall rubber plant (solid plant_tall)."""
    D, Gd = kit.D, kit.G
    r = sol["reading_shelf"]["rect"]
    x0, x1, z0, z1 = r["x0"], r["x1"], r["z0"], r["z1"]
    case = PAINT.t(G.hexc("F7EBD3"))
    D.box(x1 - 0.035, x1, 0.0, 0.82, z0, z1, PAINT.t(G.hexc("BAAA93")), skip=("-y", "+x", "+y"))
    D.box(x0 + 0.02, x1 - 0.035, 0.0, 0.08, z0, z1, case, skip=("-y", "+x"))
    D.box(x0, x1 - 0.035, 0.41, 0.44, z0, z1, case, skip=("+x",))
    for z in (z0, z1 - 0.032):
        for lo, hi in ((0.08, 0.41), (0.44, 0.82)):
            D.box(x0, x1 - 0.035, lo, hi, z, z + 0.032, case, skip=("-y", "+y", "+x"))
    SD.top_slab(D, x0, x1, z0, z1, 0.82, 0.86, 0.01, OAK.u((0, 0, 1)), OAK)
    rg = G.rng(12)
    for y in (0.08, 0.44):
        SD.book_run(Gd, z0 + 0.04, z1 - 0.06, y, x0 + 0.015, 0.3, rg, axis="x", hmin=0.2, hmax=0.31)
    # three picture books stood up on top, leaning back against the window reveal
    for k, zc in enumerate((z0 + 0.5, z0 + 1.5, z0 + 2.6)):
        SD.book(Gd, x0 + 0.04, 0.86, zc - 0.11, 0.012, 0.27, 0.22, (k * 7 + 3) % 24, axis="x", lean=0.0)
    for k in range(5):
        rr = 1.1 - k * 0.2
        Gd.lathe([(rr, 0.0), (rr, 0.006 + 0.002 * k), (0.0, 0.006 + 0.002 * k)], 40 if not PHONE else 20, S("LM_school_fabric", G.hexc(("E46A5A", "F2A65A", "F5D76E", "8CC08A", "7FA8D8")[k])), 13.0, 4.7, 0.0)
    r = sol["easel"]["rect"]
    ex, ez = (r["x0"] + r["x1"]) / 2, (r["z0"] + r["z1"]) / 2
    for dx in (-0.28, 0.28):
        D.member((ex + dx, 0.0, ez + 0.2), (ex + dx * 0.4, 1.65, ez - 0.02), G.prof_box(0.04, 0.03), OAK)
    D.member((ex, 0.0, ez - 0.28), (ex, 1.6, ez - 0.02), G.prof_box(0.035, 0.03), OAK)
    D.box(ex - 0.34, ex + 0.34, 0.62, 0.66, ez + 0.06, ez + 0.14, OAK)
    D.box(ex - 0.3, ex + 0.3, 0.66, 1.42, ez + 0.08, ez + 0.1, S("LM_school_oak", G.hexc("D9B98C")))
    # (the easel's board faces -z, into the room)
    SD.sheet(Gd, (ex, 1.06, ez + 0.079), (-1, 0, 0), (0, 0, -1), 0.56, 0.395, "spring", rot=math.radians(1.5), rg=rg, curl=0.004)
    for dx in (-0.25, 0.25):
        Gd.box(ex + dx - 0.02, ex + dx + 0.02, 1.235, 1.265, ez + 0.07, ez + 0.08, S("LM_school_oak", G.hexc("E6C9A0")))
    r = sol["globe_stand"]["rect"]
    gx, gz = (r["x0"] + r["x1"]) / 2, (r["z0"] + r["z1"]) / 2
    D.lathe([(0.0, 0.0), (0.24, 0.0), (0.24, 0.03), (0.05, 0.05), (0.035, 0.75), (0.05, 0.78), (0.0, 0.78)], 20, OAK, gx, gz, 0.0)
    SD.globe(Gd, gx, 1.0, gz, 0.2, OAK, BRASS)
    r = sol["plant_tall"]["rect"]
    px, pz = (r["x0"] + r["x1"]) / 2, (r["z0"] + r["z1"]) / 2
    D.lathe([(0.15, 0.0), (0.19, 0.33), (0.20, 0.35), (0.20, 0.38), (0.181, 0.38), (0.179, 0.35)], 16, POT, px, pz)
    D.lathe([(0.179, 0.35), (0, 0.35)], 16, SOIL, px, pz)
    D.member((px, 0.35, pz), (px, 1.60, pz), G.prof_round(0.018, 5), OAK_DK)
    for k in range(18):
        t = k / 17
        length = 0.235 - 0.05 * t + 0.012 * math.sin(k * 1.8)
        R.fiddle_leaf(Gd, (px, 0.57 + t * 1.02, pz), k * 2.40, length, length * 0.30, -0.07 + 0.15 * t, LEAF if k % 2 else LEAF_DK)


def curtains(kit):
    """Linen curtains beside the windows on oak poles with rings: gathered into soft rounded folds (within 5.5 cm of the wall),
    a stitched hem and a header tape; butter yellow on the back wall, sage on the side wall."""
    W = R.walls(X, Z)
    rg = G.rng(8)
    for f, us, w, cs in ((W["back"], [X - x for x in (4.4, 7.7, 11.0)], 1.7, LINEN), (W["right"], [5.0], 3.4, LINEN_SAGE), (W["right"], [1.2], 1.4, LINEN_SAGE)):
        cs = cs.u((0, 1, 0))
        for u in us:
            for side in (-1, 1):
                a = u + side * (w / 2 + 0.05)
                b = a + side * 0.34
                n = 24 if not PHONE else 12
                folds = rg.uniform(5.5, 7.0)
                ph = rg.uniform(0, 3)
                prev = None
                for i in range(n + 1):
                    t = i / n
                    uu = a + (b - a) * t
                    dep = 0.008 + 0.022 * (1 + math.sin(t * folds * 2 * math.pi + ph))
                    cur = (uu, dep)
                    if prev:
                        for (v0, v1, extra) in ((0.82, 0.88, 0.003), (0.88, 3.24, 0.0), (3.24, 3.33, 0.002)):
                            f.poly(kit.G, [(prev[0], v0, prev[1] + extra), (cur[0], v0, cur[1] + extra), (cur[0], v1, cur[1] + extra), (prev[0], v1, prev[1] + extra)], cs, out=1)
                        # the hem's underside
                        f.poly(kit.G, [(prev[0], 0.82, prev[1] + 0.003), (cur[0], 0.82, cur[1] + 0.003), (cur[0], 0.82, 0.002), (prev[0], 0.82, 0.002)], cs, out=1)
                    prev = cur
                for k in range(7 if not PHONE else 0):
                    uu = a + (b - a) * k / 6
                    f.box(kit.G, uu - 0.004, uu + 0.004, 3.352, 3.41, 0.004, 0.048, BRASS)
            pole0, pole1 = u - w / 2 - 0.45, u + w / 2 + 0.45
            kit.D.member(f.p(pole0, 3.38, 0.025), f.p(pole1, 3.38, 0.025), G.prof_round(0.015, 8), OAK_DK, caps=True)
            for pu in (pole0 + 0.06, pole1 - 0.06):
                kit.D.member(f.p(pu, 3.38, 0.0), f.p(pu, 3.38, 0.025), G.prof_round(0.008, 6), BRASS)
            for (pu, sg) in ((pole0, -1), (pole1, 1)):
                kit.D.sphere(*f.p(pu + sg * 0.02, 3.38, 0.025), 0.024, OAK_DK, n=8, rings=5)


def fixtures(kit):
    """A white panel radiator under the corridor's side window, light switches by the door, socket outlets by the board and in
    the corridor."""
    W = R.walls(X, Z)
    R_ = S("LM_school_plastic", G.hexc("2A2A2E"))
    SD.radiator(kit.D, W["right"], 1.2, 0.16, 1.1, 0.56, STEEL_W, CHROME)
    SD.switch_plate(kit.D, W["door"], 9.15, 1.1, STEEL_W, n=2)
    SD.switch_plate(kit.D, W["left"], Z - 2.62, 1.1, STEEL_W, n=1)
    SD.socket(kit.D, W["left"], 0.25, 0.3, STEEL_W, R_)
    SD.socket(kit.D, W["left"], 5.0, 0.3, STEEL_W, R_)
    SD.socket(kit.D, W["back"], 0.25, 0.3, STEEL_W, R_)
