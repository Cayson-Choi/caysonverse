"""케이슨 마을 도서관 열람실 (lot_library_reading, interior area lot:lot_library_reading at (470, 0), 13.4 x 10.4, ceiling 5.2)
— the walk-in room kit (design 11, contract 11, `LOT_INTERIORS` LIBRARY_IN), pure python on b1_room / b1_parts / b1_geom.

A dream village reading room (owner 2026-11-17: "햇살 가득한 도서관, 높은 책장, 사다리, 독서등, 창가 자리"): oak bookcases full of
books on three walls under arched clerestory windows, a stone fireplace with a lit fire, a painting and candlesticks on the
mantel and two wingback armchairs, two long oak reading tables with green banker's lamps and open books, the two bay-window
nooks (deep cushioned seats, bolsters, a folded blanket, piled books, a little lamp) that the street sees from outside, the
librarian's oak counter with a bell and a date stamp, a card catalogue, a book trolley, a rolling ladder on a brass rail,
oak beams and brass lanterns. Brand-new, tidy; no words (LOT_SIGN_WORDS only; none in here).
"""
import math

import b1_geom as G
import b1_parts as P
import b1_room as R
import library_books as LB
import library_room_dress as DR
from b1_geom import Mesh, S

FLOOR = S("LM_library_floor")                                 # floor_wood
WALL = S("LM_library_plaster", G.hexc("FBF1DE"))              # plaster_painted, warm cream
CEIL = S("LM_library_plaster", G.hexc("FFFBF2"))
PAINT = S("LM_library_paint")                                 # wood_painted (window frames)
OAK = S("LM_library_oak", G.hexc("D9B88E"))                   # wood_oak, honey (bookcases, tables)
OAK_DK = S("LM_library_oak", G.hexc("9C6E48"))
OAK_LT = S("LM_library_oak", G.hexc("EDDCC0"))
STONE = S("LM_library_stone", G.hexc("FFF6E6"))               # stone_ashlar (fireplace)
SOOT = S("LM_library_plaster", G.hexc("4A4440"))
BRICK = S("LM_library_brick")                                 # the firebox's back (new, clean)
FAB = S("LM_library_fabric")
VELVET_G = FAB.t(G.hexc("4F7D62"))
VELVET_R = FAB.t(G.hexc("B9655A"))
CUSH_1 = S("LM_library_plaster", G.hexc("F4E6C8"))           # linen cushions (the plaster set's fine grain reads as heavy linen)
CUSH_2 = S("LM_library_plaster", G.hexc("A9C6E4"))
CUSH_3 = S("LM_library_plaster", G.hexc("F0C46A"))
RUG = FAB.t(G.hexc("A9514A"))
RUG2 = S("LM_library_plaster", G.hexc("EBD6AA"))
BRASS = S("LM_library_paint", G.hexc("E0BE6A"))
GREEN_GLASS = S("M_glass", G.lin(0.2, 0.55, 0.32))
LEAF = S("LM_library_plaster", G.hexc("8DBE62"))
LEAF_DK = S("LM_library_plaster", G.hexc("6A9E4C"))
POT = S("LM_library_plaster", G.hexc("E3A27C"))
PAPER = S("LM_library_plaster", G.hexc("FFFCF4"))
FIRE = S("M_screen")
GLASS = P.GLASS

MATS = {
    "LM_library_floor": {"set": "floor_wood"},
    "LM_library_plaster": {"set": "plaster_painted"},
    "LM_library_paint": {"set": "wood_painted", "normal": 0.5},
    "LM_library_oak": {"set": "wood_oak", "rough": 0.85},
    "LM_library_stone": {"set": "stone_ashlar"},
    "LM_library_brick": {"set": "brick_red"},
    "LM_library_fabric": {"set": "fabric_upholstery"},
    "LM_library_brass": {"set": "aluminium_brushed", "metal": True, "rough": 0.7},
    "M_glass": {"glass": True},
    "M_screen": {"screen": True},
    "M_garden": R.GARDEN_MAP,
    "M_globe": {"own": "lot_library_globe", "note": "Natural Earth land and rivers; SOURCES_lot_library.md"},
    "M_painting": {"own": "lot_library_reading_paintings", "note": "public-domain landscapes (Constable, Hobbema, Corot, Ruisdael): SOURCES_lot_library.md"},
    "M_fire": {"fire": True},
    # the books' spine atlas and the rugs (b1_book_atlas.mjs: procedural, no cover art, no titles), owner 2026-11-20
    "M_books": {"own": "lot_library_reading_books", "normal": "lot_library_reading_books_normal", "orm": "lot_library_reading_books_orm",
                "vertexColor": True, "note": "procedural spine atlas (b1_book_atlas.mjs): albedo 2048 UASTC sRGB; normal + ORM (G roughness, B metal: the gilt) 1024 UASTC linear; COLOR_0 tints the side boards"},
    "M_rugs": {"own": "lot_library_reading_rugs", "note": "procedural Persian-style rugs (b1_book_atlas.mjs), 2048 UASTC sRGB"},
}

X, Z, H = 13.4, 10.4, 5.2
BAYS = [(1.4, 3.8), (9.6, 12.0)]
BOOK_COLS = ["7A2E2E", "2F4B6E", "3E6B4A", "8C6A2E", "5A3A62", "B5502F", "2B5C5E", "6B2B3A", "C9A24A", "34495E", "7D5A44", "9B3D3D", "D8CBB0", "4A6B8C"]




def build(spec, unit, layout):
    kit = P.Kit(None)
    kit.mats = dict(MATS)
    sol = {s["name"]: s for s in spec["solids"]}
    holes = {
        "door": [(5.6, 7.8, 0.0, 3.4)] + [(a, b, 0.0, 3.3) for a, b in BAYS],
        "left": [(u - 0.8, u + 0.8, 3.5, 4.92) for u in (Z - 3.4, Z - 6.2, Z - 9.0)],
        "right": [(u - 0.8, u + 0.8, 3.5, 4.92) for u in (4.4, 6.9, 9.4)] + [(0.6, 2.4, 0.9, 3.6)],
    }
    W = R.box_room(kit, X, Z, H, DR.PLASTER, FLOOR, DR.COFFER, holes)
    S_, D, Gd = kit.S, kit.D, kit.G
    for u in (Z - 3.4, Z - 6.2, Z - 9.0):
        R.window(kit, W["left"], u, 3.5, 1.6, 1.42, PAINT, DR.OAK_RICH, DR.PLASTER, cols=2, rows=2, arch=True)
    for u in (4.4, 6.9, 9.4):
        R.window(kit, W["right"], u, 3.5, 1.6, 1.42, PAINT, DR.OAK_RICH, DR.PLASTER, cols=2, rows=2, arch=True)
    R.window(kit, W["right"], 1.5, 0.9, 1.8, 2.7, PAINT, DR.OAK_RICH, DR.PLASTER, cols=3, rows=4)
    # oak panelling to 3.45 m on every free wall stretch; oak pilasters on the upper walls between the windows
    for (a, b) in ((0.0, 1.28), (3.92, 5.42), (7.98, 9.48), (12.12, X)):
        DR.panelling(kit.D, W["door"], a, b, 0.0, 3.45)
    DR.panelling(kit.D, W["left"], Z - 1.4, Z, 0.0, 3.45)
    DR.panelling(kit.D, W["right"], 0.0, 0.6, 0.0, 3.45)
    DR.panelling(kit.D, W["right"], 2.4, 3.0, 0.0, 3.45)
    DR.panelling(kit.D, W["right"], 0.6, 2.4, 0.0, 0.85)
    for f, us, L in ((W["left"], (Z - 3.4, Z - 6.2, Z - 9.0), Z), (W["right"], (4.4, 6.9, 9.4), Z), (W["back"], (), X), (W["door"], (), X)):
        edges = sorted([0.0, L] + [u + d for u in us for d in (-0.95, 0.95)])
        for u in edges[1:-1]:
            f.box(kit.D, u - 0.15, u + 0.15, 3.45, 4.75, 0.0, 0.06, DR.OAK_RICH, skip=("-w",))
            f.box(kit.D, u - 0.19, u + 0.19, 4.62, 4.75, 0.0, 0.09, DR.GILT, skip=("-w",))
        f.box(kit.D, 0.0, L, 3.4, 3.5, 0.0, 0.07, DR.OAK_RICH, skip=("-w",))
    door(kit, W["door"])
    for (a, b) in BAYS:
        bay(kit, W["door"], a, b)
    DR.coffered_ceiling(D, kit)
    DR.bookcases(kit, sol)
    DR.fireplace(kit)
    tables(kit, spec, sol)
    librarian(kit, sol)
    catalogue(kit, sol)
    cart(kit, sol)
    DR.ladder(kit, sol)
    # the fireside: two tufted leather chesterfields turned to the fire, side tables with lamps, Persian rugs
    for name, yaw in (("armchair_w", math.pi / 2), ("armchair_e", -math.pi / 2)):
        r = sol[name]["rect"]
        DR.chesterfield(D, (r["x0"] + r["x1"]) / 2, (r["z0"] + r["z1"]) / 2, yaw)
    for name in ("side_table_w", "side_table_e"):
        r = sol[name]["rect"]
        DR.side_table(Gd, kit.glow("lamps"), kit.lights, (r["x0"] + r["x1"]) / 2, (r["z0"] + r["z1"]) / 2)
    # Persian-style rugs from the rugs atlas (knotted pile, abrash, medallion and borders), wool fringes
    FRINGE = S("LM_library_fabric", G.hexc("EFE6D2"))
    LB.rug(Gd, 6.7, 8.1, 4.4, 2.3, "hearth", fringe=FRINGE)
    LB.rug(Gd, 6.7, 3.9, 1.0, 4.2, "runner", along_z=True, fringe=FRINGE)
    r = sol["globe"]["rect"]
    DR.globe(D, (r["x0"] + r["x1"]) / 2, (r["z0"] + r["z1"]) / 2)
    for name in ("plant_1", "plant_2"):
        r = sol[name]["rect"]
        DR.tall_plant(D, (r["x0"] + r["x1"]) / 2, (r["z0"] + r["z1"]) / 2)
    for (x, z) in ((4.5, 5.5), (8.9, 5.5)):
        DR.chandelier(kit, D, x, z, 3.75)
    pictures(kit, W)
    kit.sun_dir = (1.0, 0.0, 0.35)
    kit.sun_elev = 34
    kit.world_strength = 0.16
    kit.look = "AgX - Medium High Contrast"
    kit.exposure = 0.45
    kit.haze = (0.3, X - 0.3, 0.0, H - 0.3, 0.3, Z - 0.3, 0.004)
    kit.ground = Mesh("ground")
    return kit


def door(kit, f):
    """The double oak doors (closed, seen from inside: the exit) with a fanlight transom, a moulded architrave."""
    D, S_ = kit.D, kit.S
    for (a, b) in ((5.62, 6.69), (6.71, 7.78)):
        f.box(D, a, b, 0.0, 2.75, -0.14, -0.08, OAK_DK.u((0, 1, 0)))
        for (v0, v1) in ((0.2, 1.2), (1.35, 2.55)):
            f.box(D, a + 0.12, b - 0.12, v0, v1, -0.08, -0.06, OAK_DK.u((0, 1, 0)))
        hx = b - 0.1 if a < 6.7 else a + 0.1
        f.box(D, hx - 0.015, hx + 0.015, 1.0, 1.15, -0.08, -0.03, BRASS)
    f.box(D, 5.6, 7.8, 2.75, 2.85, -0.14, -0.05, OAK_DK)
    f.box(D, 5.65, 7.75, 2.85, 3.38, -0.12, -0.11, GLASS)
    for k in range(1, 5):
        u = 5.6 + 2.2 * k / 5
        f.box(D, u - 0.02, u + 0.02, 2.85, 3.38, -0.12, -0.08, PAINT)
    for (u, sgn) in ((5.6, 1), (7.8, -1)):
        q = [f.p(u, 0.0, 0.0), f.p(u, 3.4, 0.0), f.p(u, 3.4, -0.14), f.p(u, 0.0, -0.14)]
        if G.dot(G.poly_normal(q), G.mul(f.U, sgn)) < 0:
            q.reverse()
        S_.poly(q, WALL)
    f.box(D, 5.42, 5.6, 0.0, 3.58, 0.0, 0.05, OAK_DK, skip=("-w",))
    f.box(D, 7.8, 7.98, 0.0, 3.58, 0.0, 0.05, OAK_DK, skip=("-w",))
    f.box(D, 5.42, 7.98, 3.4, 3.58, 0.0, 0.05, OAK_DK, skip=("-w",))
    # The porch lantern's diffuser sits 2 mm behind the glazing and overlaps the jamb and head.
    f.quad(S_, 5.55, 7.85, 2.77, 3.45, -0.122, S("M_screen"))


def bay(kit, f, a, b):
    """A bay-window reading nook (contract seats lot_library_nook_1/2: the cushion's front edge at z 0.6, seat top 0.48):
    a canted glazed alcove 0.95 m deep beyond the wall, its oak window seat from the glass to z 0.6 with a deep cushion,
    bolsters, scatter cushions, a folded blanket, piled books and a little lamp; small shelves in the alcove's cheeks."""
    D, S_, Gd = kit.D, kit.S, kit.G
    zb = -0.95
    cant = 0.5
    A, B, C, Dd = (a, 0.0), (a + cant, zb), (b - cant, zb), (b, 0.0)
    # alcove floor, ceiling (3.3), the reveal of the opening
    footprint = [A, Dd, C, B]  # counter-clockwise seen from above
    S_.poly([(x, 0.0, z) for x, z in footprint], FLOOR)
    S_.poly([(x, 3.3, z) for x, z in reversed(footprint)], CEIL)
    for (p, q) in ((A, B), (B, C), (C, Dd)):
        L = math.dist(p, q)
        d = ((q[0] - p[0]) / L, (q[1] - p[1]) / L)
        inward = (-d[1], 0.0, d[0])  # into the alcove
        # wall panel below the glass and above it (stone base inside: panelled oak)
        for (v0, v1, s) in ((0.0, 0.55, OAK), (3.2, 3.3, PAINT)):
            quad = [(p[0], v0, p[1]), (q[0], v0, q[1]), (q[0], v1, q[1]), (p[0], v1, p[1])]
            if G.dot(G.poly_normal(quad), inward) < 0:
                quad.reverse()
            S_.poly(quad, s)
        gq = [(p[0], 0.55, p[1]), (q[0], 0.55, q[1]), (q[0], 3.2, q[1]), (p[0], 3.2, p[1])]
        S_.poly(gq, R.GARDEN)
        # frames: transom and mullions (white)
        for v in (0.58, 2.5, 3.18):
            D.member((p[0], v, p[1]), (q[0], v, q[1]), G.prof_box(0.06, 0.06), PAINT)
        for t in ((1 / 3, 2 / 3) if L > 1.2 else ()):
            pa = G.lerp((p[0], 0.58, p[1]), (q[0], 0.58, q[1]), t)
            D.member(pa, (pa[0], 3.18, pa[2]), G.prof_box(0.045, 0.05), PAINT)
    for pt in (B, C):
        D.member((pt[0], 0.55, pt[1]), (pt[0], 3.2, pt[1]), G.prof_box(0.1, 0.1), PAINT)
    # the opening's reveal (wall thickness 0 here: the alcove starts at the wall face) and a valance with tie-backs
    f.box(D, a - 0.12, b + 0.12, 3.3, 3.5, 0.0, 0.08, OAK_DK, skip=("-w",))
    # window seat: the oak box from the glass to the seat's front edge (z 0.6)
    seat_front = 0.6
    D.poly([(B[0] + 0.02, 0.42, zb + 0.06), (C[0] - 0.02, 0.42, zb + 0.06), (b - 0.02, 0.42, seat_front), (a + 0.02, 0.42, seat_front)][::-1], OAK)
    D.box(a + 0.02, b - 0.02, 0.0, 0.42, seat_front - 0.03, seat_front, OAK.u((1, 0, 0)), skip=("-y",))
    for k in range(3):
        u0 = a + 0.1 + k * (b - a - 0.2) / 3
        D.box(u0 + 0.04, u0 + (b - a - 0.2) / 3 - 0.04, 0.06, 0.36, seat_front - 0.042, seat_front - 0.03, OAK_DK)
    # the deep cushion (fabric), slightly rounded
    D.cbox(a + 0.05, b - 0.05, 0.42, 0.48, 0.0, seat_front - 0.01, CUSH_1, c=0.025)
    D.cbox(B[0] + 0.05, C[0] - 0.05, 0.42, 0.48, zb + 0.08, 0.0, CUSH_1, c=0.025)
    # bolsters at the ends, scatter cushions against the glass, a folded blanket, books, a little lamp
    for (x, s) in ((a + 0.2, CUSH_2), (b - 0.2, CUSH_2)):
        Gd.member((x, 0.6, -0.5), (x, 0.6, 0.45), G.prof_round(0.11, 18), s, caps=True)
    for k, (dx, s) in enumerate(((-0.45, CUSH_3), (0.05, VELVET_R), (0.5, CUSH_3))):
        cx = (a + b) / 2 + dx
        P.pillow(Gd, cx, 0.7, zb + 0.24, 0.46, 0.42, 0.15, s, tilt=-0.22)
    Gd.cbox(b - 0.85, b - 0.35, 0.48, 0.55, 0.15, 0.5, VELVET_G, c=0.02)
    Gd.cbox(b - 0.83, b - 0.37, 0.55, 0.58, 0.17, 0.48, VELVET_G.t(G.hexc("6E9A80")), c=0.01)
    LB.pile(Gd, a + 0.62, 0.48, 0.22, 0.35, 4, int(a * 10) + 5)
    lx, lz = (B[0] + 0.25), zb + 0.35
    Gd.lathe([(0.08, 0.0), (0.08, 0.02), (0.012, 0.04), (0.012, 0.4)], 16, BRASS, lx, lz, 0.48)
    Gd.lathe([(0.15, 0.0), (0.08, 0.17), (0.0, 0.18)], 18, FAB.t(G.hexc("F5E9CC")), lx, lz, 0.82)
    kit.glow("nooks").lathe([(0.0, 0.0), (0.13, 0.02), (0.07, 0.15), (0.0, 0.16)], 12, P.GLASS.t(P.LAMP), lx, lz, 0.83)
    kit.lights.append(("point", lx, 0.9, lz + 0.1, (1.0, 0.82, 0.58), 30.0))
    kit.dayfill.append(((a + b) / 2, 2.8, -0.3, 1.5, 40.0))
    DR.leafy_plant(Gd, C[0] - 0.25, 0.48, zb + 0.3, 0.3, seed=int(a * 10))


def fireplace(kit):
    """A carved limestone fireplace in the back stacks (x 5.55..7.85): plinth, jambs, a mantel shelf with candlesticks, a
    carriage clock and two little vases, a clean brick firebox with oak logs and a steady flame (unlit flame cards on
    M_screen: warm colours, they read as fire day and night), a brass fender; the chimney breast above with a landscape
    painting in a gilt frame."""
    D, Gd = kit.D, kit.G
    x0, x1 = 5.55, 7.85
    z1 = Z
    zf = Z - 0.5
    D.box(x0, x1, 0.0, 0.12, zf - 0.25, z1, STONE)                    # hearth
    D.box(x0, x0 + 0.42, 0.12, 1.3, zf, z1, STONE)                     # jambs
    D.box(x1 - 0.42, x1, 0.12, 1.3, zf, z1, STONE)
    D.box(x0, x1, 1.3, 1.55, zf, z1, STONE)                            # lintel
    D.cbox(x0 - 0.1, x1 + 0.1, 1.55, 1.63, zf - 0.08, z1, STONE, c=0.015)  # mantel shelf
    D.box(x0 + 0.42, x1 - 0.42, 0.12, 1.3, Z - 0.05, Z - 0.02, BRICK)   # firebox back
    for x in (x0 + 0.42, x1 - 0.42):
        q = [(x, 0.12, zf), (x, 1.3, zf), (x, 1.3, Z - 0.05), (x, 0.12, Z - 0.05)]
        if G.poly_normal(q)[0] * (1 if x < 6.7 else -1) < 0:
            q.reverse()
        D.poly(q, BRICK)
    D.poly([(x0 + 0.42, 1.3, zf), (x1 - 0.42, 1.3, zf), (x1 - 0.42, 1.3, Z - 0.05), (x0 + 0.42, 1.3, Z - 0.05)], SOOT)
    # the chimney breast above (plaster), up to the ceiling
    D.box(x0 + 0.1, x1 - 0.1, 1.63, H, zf + 0.12, z1, S("LM_library_plaster", G.hexc("F6EBD6")), skip=("+y", "+z"))
    # logs and fire
    for (a, b, y) in (((6.2, 0.22, Z - 0.3), (7.2, 0.22, Z - 0.25), 0), ((6.3, 0.34, Z - 0.22), (7.1, 0.3, Z - 0.32), 1)):
        Gd.member(a, b, G.prof_round(0.07, 7), OAK_DK, caps=True)
    for k, (fx, fh) in enumerate(((6.38, 0.32), (6.52, 0.46), (6.7, 0.62), (6.86, 0.44), (7.02, 0.3))):
        pts = [(fx - 0.1, 0.25), (fx + 0.1, 0.25), (fx + 0.07, 0.25 + fh * 0.35), (fx + 0.03, 0.25 + fh * 0.7), (fx + 0.012 * (k - 2), 0.25 + fh), (fx - 0.04, 0.25 + fh * 0.62), (fx - 0.075, 0.25 + fh * 0.3)]
        for dz in (0.0, 0.03):
            cols = [(1.0, 0.42, 0.08, 1.0)] * 2 + [(1.0, 0.62, 0.18, 1.0), (1.0, 0.82, 0.38, 1.0), (1.0, 0.95, 0.62, 1.0), (1.0, 0.82, 0.38, 1.0), (1.0, 0.62, 0.18, 1.0)]
            Gd.poly([(u, v, Z - 0.28 + dz - 0.01 * k) for u, v in pts], FIRE, cols=cols)
            Gd.poly([(u, v, Z - 0.284 + dz - 0.01 * k) for u, v in reversed(pts)], FIRE, cols=list(reversed(cols)))
    kit.lights.append(("point", 6.7, 0.6, Z - 0.6, (1.0, 0.55, 0.2), 120.0))
    D.member((x0 + 0.45, 0.25, zf - 0.18), (x1 - 0.45, 0.25, zf - 0.18), G.prof_round(0.02, 6), BRASS)
    for x in (x0 + 0.45, x1 - 0.45):
        D.member((x, 0.12, zf - 0.18), (x, 0.25, zf - 0.18), G.prof_round(0.015, 5), BRASS)
    # on the mantel
    for x in (x0 + 0.15, x1 - 0.15):
        Gd.lathe([(0.06, 0.0), (0.05, 0.02), (0.015, 0.05), (0.02, 0.2), (0.035, 0.22), (0.0, 0.23)], 16, BRASS, x, zf + 0.15, 1.63)
        Gd.lathe([(0.012, 0.0), (0.012, 0.15), (0.0, 0.15)], 12, PAPER, x, zf + 0.15, 1.86)
    Gd.cbox(6.55, 6.85, 1.63, 1.86, zf + 0.06, zf + 0.22, BRASS, c=0.01)
    Gd.sphere(6.7, 1.77, zf + 0.055, 0.075, PAPER, n=10, rings=5, sy=0.15)
    for (x, c) in ((6.05, "8FB8C9"), (7.35, "E8C5A0")):
        Gd.lathe([(0.0, 0.0), (0.05, 0.0), (0.07, 0.07), (0.04, 0.16), (0.0, 0.16)], 16, S("LM_library_paint", G.hexc(c)), x, zf + 0.15, 1.63)
    # the painting above: gilt frame, a landscape (sky, hills, a lake, a little church) in raised paint layers
    px0, px1, py0, py1, pz = 5.9, 7.5, 2.2, 3.4, zf + 0.115
    D.box(px0, px1, py0, py1, pz - 0.06, pz, BRASS)
    def layer(pts, col, dz):
        Gd.poly([(u, v, pz - 0.062 - dz) for u, v in pts][::-1], S("LM_library_plaster", G.hexc(col)))
    layer([(px0 + 0.08, py0 + 0.08), (px1 - 0.08, py0 + 0.08), (px1 - 0.08, py1 - 0.08), (px0 + 0.08, py1 - 0.08)], "A9C9E6", 0.0)
    layer([(px0 + 0.08, py0 + 0.08), (px1 - 0.08, py0 + 0.08), (px1 - 0.08, py0 + 0.55), (6.9, py0 + 0.75), (6.4, py0 + 0.6), (px0 + 0.08, py0 + 0.7)], "7FA868", 0.002)
    layer([(px0 + 0.08, py0 + 0.08), (px1 - 0.08, py0 + 0.08), (px1 - 0.08, py0 + 0.3), (px0 + 0.08, py0 + 0.36)], "5E8E54", 0.004)
    layer([(6.1, py0 + 0.22), (6.9, py0 + 0.22), (6.8, py0 + 0.34), (6.2, py0 + 0.36)], "8DB5D9", 0.006)
    layer([(7.0, py0 + 0.5), (7.12, py0 + 0.5), (7.12, py0 + 0.65), (7.06, py0 + 0.78), (7.0, py0 + 0.65)], "F4EEE0", 0.007)
    layer([(px0 + 0.2 + 0.1 * math.cos(2 * math.pi * k / 10), py1 - 0.3 + 0.1 * math.sin(2 * math.pi * k / 10)) for k in range(10)], "FFF1C2", 0.003)
    # a hearth rug and the round rug
    for k, (r, s) in enumerate(((1.6, RUG), (1.35, RUG2), (1.1, RUG))):
        Gd.lathe([(r, 0.0), (r, 0.006 + 0.002 * k), (0.0, 0.006 + 0.002 * k)], 28, s, 6.7, Z - 2.2, 0.0, sx=1.25)


def table_kind(L=2.4, W=1.2, h=0.76):
    """An oak reading table (long axis z), thick top with a moulded edge, four turned legs, aprons."""
    m = Mesh("rtable")
    m.cbox(-W / 2, W / 2, h - 0.05, h, -L / 2, L / 2, OAK.u((0, 0, 1)), c=0.015)
    m.box(-W / 2 + 0.08, W / 2 - 0.08, h - 0.15, h - 0.05, -L / 2 + 0.08, L / 2 - 0.08, OAK_DK, skip=("+y",))
    for x in (-W / 2 + 0.1, W / 2 - 0.1):
        for z in (-L / 2 + 0.1, L / 2 - 0.1):
            m.lathe([(0.045, 0.0), (0.035, 0.08), (0.045, 0.12), (0.03, 0.3), (0.035, 0.5), (0.045, 0.56), (0.045, h - 0.15)], 16, OAK, x, z, 0.0)
    return m


def reading_chair(name, w=0.46, back=0.95):
    """An oak reading-room chair facing +z (seat top 0.46, the seat's front edge at +0.22, the back at -0.21, inside the seat's
    contract box): turned front legs, square back legs rising into the back posts, stretchers, a seat with a green leather pad,
    a curved top rail and a splat."""
    m = Mesh(name)
    h = w / 2
    leather = S("LM_library_plaster", G.hexc("3E6B4E"))
    for x in (-h + 0.03, h - 0.03):
        m.lathe([(0.02, 0.0), (0.016, 0.03), (0.021, 0.08), (0.014, 0.2), (0.018, 0.3), (0.022, 0.34), (0.022, 0.42)], 14, OAK_DK, x, 0.18, 0.0)
        m.member((x, 0.0, -0.18), (x, 0.42, -0.18), G.prof_box(0.034, 0.034), OAK_DK)
        m.member((x, 0.42, -0.18), (x, back, -0.205), G.prof_box(0.034, 0.03), OAK_DK)
        m.member((x, 0.14, -0.17), (x, 0.14, 0.17), G.prof_round(0.011, 10), OAK_DK)
    m.member((-h + 0.03, 0.2, 0.0), (h - 0.03, 0.2, 0.0), G.prof_round(0.011, 10), OAK_DK)
    m.cbox(-h, h, 0.4, 0.43, -0.205, 0.22, OAK.u((1, 0, 0)), c=0.01)
    m.cbox(-h + 0.025, h - 0.025, 0.43, 0.46, -0.18, 0.2, leather, c=0.014)
    # the top rail (curved back), a lower rail and the splat between
    for (y, hh) in ((back - 0.1, 0.1), (0.6, 0.05)):
        pts = [(-h + 0.03 + (w - 0.06) * i / 6, y, -0.198 - 0.008 * math.sin(math.pi * i / 6)) for i in range(7)]
        for a, b in zip(pts, pts[1:]):
            m.member(a, b, G.prof_box(0.022, hh), OAK.u((1, 0, 0)))
    m.box(-0.055, 0.055, 0.625, back - 0.15, -0.21, -0.195, OAK.u((0, 1, 0)))
    return m


def bankers_lamp(m, x, z, y):
    """A banker's lamp: a round brass base with mouldings, a turned stem, the harp arm, a half-cylinder cased-glass shade (green
    outside, opal white inside, closed ends with brass rims), a pull chain. The glow tube under the shade is the caller's."""
    m.lathe([(0.085, 0.0), (0.085, 0.008), (0.078, 0.014), (0.07, 0.03), (0.03, 0.04), (0.016, 0.05), (0.012, 0.22), (0.016, 0.235), (0.012, 0.25), (0.012, 0.27), (0.0, 0.27)], 24, BRASS, x, z, y)
    m.member((x, y + 0.26, z), (x, y + 0.3, z), G.prof_round(0.008, 8), BRASS)
    m.member((x - 0.05, y + 0.3, z), (x + 0.05, y + 0.3, z), G.prof_round(0.006, 8), BRASS)
    r, half, yc = 0.072, 0.17, y + 0.33
    outer = S("LM_library_paint", G.hexc("1E5A36"))
    inner = PAPER.t(G.hexc("FFF8E8"))
    n = 14
    angs = [math.radians(-105 + 210 * i / n) for i in range(n + 1)]
    for i in range(n):
        a0, a1 = angs[i], angs[i + 1]
        p = lambda xx, a, rr: (x + xx, yc + rr * math.cos(a), z + rr * math.sin(a))
        m.poly([p(-half, a0, r), p(-half, a1, r), p(half, a1, r), p(half, a0, r)], outer, smooth=True)
        m.poly([p(-half, a0, r - 0.003), p(half, a0, r - 0.003), p(half, a1, r - 0.003), p(-half, a1, r - 0.003)], inner, smooth=True)
    for sx in (-1, 1):
        cap = [(sx * half, yc + r * math.cos(a), z + r * math.sin(a)) for a in angs]
        cap.append((sx * half, yc - 0.01, z))
        cap = [(x + q[0], q[1], q[2]) for q in cap]
        if G.dot(G.poly_normal(cap), (sx, 0, 0)) < 0:
            cap.reverse()
        m.poly(cap, outer)
        m.poly(list(reversed([(q[0] - sx * 0.002, q[1], q[2]) for q in cap])), inner)
        for i in range(0, n, 2):
            a0, a1 = angs[i], angs[min(n, i + 2)]
            m.member((x + sx * (half + 0.002), yc + (r + 0.002) * math.cos(a0), z + (r + 0.002) * math.sin(a0)),
                     (x + sx * (half + 0.002), yc + (r + 0.002) * math.cos(a1), z + (r + 0.002) * math.sin(a1)), G.prof_round(0.004, 5), BRASS)
    # the pull chain
    for k in range(7):
        m.sphere(x + 0.04, yc - 0.06 - k * 0.012, z + 0.03, 0.004, BRASS, n=6, rings=3)
    m.sphere(x + 0.04, yc - 0.06 - 7 * 0.012, z + 0.03, 0.008, BRASS, n=8, rings=4)


def bouquet(m, cx, y, cz, seed):
    """A glass vase of flowers: a cased-glass vase, stems arching out, cupped blooms (roses and tulips) and leaves."""
    m.lathe([(0.0, 0.0), (0.045, 0.0), (0.06, 0.05), (0.058, 0.1), (0.035, 0.17), (0.03, 0.2), (0.038, 0.22), (0.0, 0.22)], 20, GREEN_GLASS, cx, cz, y)
    rg = G.rng(seed)
    cols = ("F2A0B4", "FFFFFF", "F7D46A", "E8607A", "F6C7D4")
    for k in range(9):
        a = k * 2.39996 + rg.uniform(-0.3, 0.3)
        out = rg.uniform(0.03, 0.11)
        top = (cx + out * math.cos(a), y + rg.uniform(0.33, 0.44), cz + out * math.sin(a))
        mid = (cx + out * 0.4 * math.cos(a), y + 0.26, cz + out * 0.4 * math.sin(a))
        m.member((cx, y + 0.12, cz), mid, G.prof_round(0.0035, 5), LEAF_DK)
        m.member(mid, top, G.prof_round(0.003, 5), LEAF_DK)
        col = S("LM_library_plaster", G.hexc(cols[k % len(cols)]))
        if k % 3 == 0:
            # a tulip: a tall closed cup
            m.lathe([(0.0, 0.0), (0.012, 0.004), (0.02, 0.02), (0.019, 0.04), (0.012, 0.052), (0.0, 0.045)], 12, col, top[0], top[2], top[1])
        else:
            # a rose: an open cup with rolled petals, a darker heart
            m.lathe([(0.0, 0.0), (0.014, 0.004), (0.026, 0.016), (0.03, 0.028), (0.024, 0.032), (0.012, 0.026), (0.0, 0.03)], 14, col, top[0], top[2], top[1], phase=rg.uniform(0, 1))
        for sg in (-1, 1):
            b = a + sg * 0.9
            l0 = G.lerp((cx, y + 0.12, cz), mid, 0.7)
            tip = (l0[0] + 0.07 * math.cos(b), l0[1] + 0.02, l0[2] + 0.07 * math.sin(b))
            side = (-math.sin(b) * 0.014, 0.0, math.cos(b) * 0.014)
            q = [l0, G.add(G.lerp(l0, tip, 0.5), side), tip, G.sub(G.lerp(l0, tip, 0.5), side)]
            m.poly(q, LEAF, smooth=True)
            m.poly(list(reversed(q)), LEAF, smooth=True)


def tables(kit, spec, sol):
    """Two reading tables (solids table_a / table_b) with two banker's lamps each, open books, a vase of flowers; chairs on the
    eight seats (facing the tables)."""
    Gd, D = kit.G, kit.D
    tk = table_kind()
    ck = reading_chair("chair", w=0.46, back=0.95)
    for name in ("table_a", "table_b"):
        r = sol[name]["rect"]
        cx, cz = (r["x0"] + r["x1"]) / 2, (r["z0"] + r["z1"]) / 2
        kit.place("table", tk, cx, 0.0, cz, 0.0)
        for dz in (-0.6, 0.6):
            bankers_lamp(Gd, cx, cz + dz, 0.76)
            kit.glow("lamps").member((cx - 0.16, 1.07, cz + dz), (cx + 0.16, 1.07, cz + dz), G.prof_round(0.04, 6), P.GLASS.t(P.LAMP))
            kit.lights.append(("point", cx, 1.0, cz + dz, (1.0, 0.85, 0.6), 25.0))
        for k, (dx, dz, a) in enumerate(((-0.3, -0.6, 0.2 + math.pi / 2), (0.32, 0.55, -0.15 - math.pi / 2), (-0.28, 0.65, 0.1 + math.pi / 2))):
            LB.open_book(Gd, cx + dx, 0.76, cz + dz, a, int(cx * 10) + k)
        LB.pile(Gd, cx + 0.35, 0.76, cz - 0.15, 0.4, 3, int(cx * 10) + 7, hmax=0.25)
        bouquet(Gd, cx, 0.76, cz, int(cx * 100))
    yaw = {"right": math.pi / 2, "left": -math.pi / 2}
    for s in spec["seats"]:
        if s["id"].startswith("lot_library_chair"):
            kit.place("chair", ck, s["x"], 0.0, s["z"], yaw[s["faces"]])


def librarian(kit, sol):
    """The librarian's oak counter (solid librarian_desk x 9.6..12, z 1.6..2.4, 1.05): panelled front to the room, a leather
    writing top, a brass bell, a date stamp on its ink pad, a stack of returned books, a banker's lamp, a little card box
    and a pot of lavender; the librarian's chair tucked behind."""
    D, Gd = kit.D, kit.G
    r = sol["librarian_desk"]["rect"]
    x0, x1, z0, z1 = r["x0"], r["x1"], r["z0"], r["z1"]
    D.box(x0, x1, 0.0, 1.0, z0, z1, OAK, skip=("-y",))
    D.cbox(x0 - 0.0, x1, 1.0, 1.05, z0, z1, OAK_DK, c=0.012)
    n = 4
    for k in range(n):
        a = x0 + 0.08 + k * (x1 - x0 - 0.16) / n
        b = a + (x1 - x0 - 0.16) / n - 0.08
        D.box(a, b, 0.15, 0.88, z0 - 0.0, z0 + 0.02, OAK_DK)
    for k in range(n):
        a = x0 + 0.08 + k * (x1 - x0 - 0.16) / n
        b = a + (x1 - x0 - 0.16) / n - 0.08
        D.box(a, b, 0.15, 0.88, z1 - 0.02, z1, OAK_DK)
        D.box(a + 0.03, b - 0.03, 0.18, 0.85, z1 - 0.01, z1 + 0.0, OAK_LT.t(G.hexc("D8B47E")))
    for (za, zb_) in ((z0 - 0.0, z0 + 0.025), (z1 - 0.025, z1)):
        D.box(x0, x1, 0.0, 0.1, za, zb_, OAK_DK)
    D.box(x0 + 0.05, x1 - 0.05, 1.05, 1.052, z0 + 0.2, z1 - 0.1, FAB.t(G.hexc("3F6B52")))
    Gd.lathe([(0.05, 0.0), (0.045, 0.03), (0.02, 0.06), (0.006, 0.09)], 18, BRASS, x0 + 0.3, z0 + 0.35, 1.05)
    Gd.box(x0 + 0.6, x0 + 0.78, 1.05, 1.07, z0 + 0.3, z0 + 0.42, FAB.t(G.hexc("2F4B6E")))
    Gd.lathe([(0.025, 0.0), (0.02, 0.05), (0.008, 0.06), (0.015, 0.12), (0.0, 0.13)], 16, OAK_DK, x0 + 0.68, z0 + 0.36, 1.07)
    LB.pile(Gd, x0 + 1.12, 1.05, z0 + 0.34, 0.0, 6, 911, hmax=0.24, spin=0.12)
    bankers_lamp(Gd, x1 - 0.5, z0 + 0.5, 1.05)
    kit.glow("lamps").member((x1 - 0.66, 1.36, z0 + 0.5), (x1 - 0.34, 1.36, z0 + 0.5), G.prof_round(0.04, 6), P.GLASS.t(P.LAMP))
    Gd.cbox(x1 - 0.95, x1 - 0.75, 1.05, 1.15, z0 + 0.25, z0 + 0.5, OAK_LT, c=0.008)
    DR.leafy_plant(Gd, x0 + 1.6, 1.05, z0 + 0.5, 0.26, seed=5, leaf=S("LM_library_plaster", G.hexc("8E84C8")), leaf_dk=S("LM_library_plaster", G.hexc("6A9E4C")))
    ch = reading_chair("lchair", w=0.46, back=0.9)
    D.extend(G.moved(ch, (x0 + x1) / 2, 0.0, z1 - 0.26, math.pi).transformed(lambda p: (p[0], p[1], min(p[2], z1 - 0.005))))


def catalogue(kit, sol):
    """A card catalogue cabinet (solid catalogue): 4 x 6 small drawers with brass pulls and card holders, on turned legs."""
    D, Gd = kit.D, kit.G
    r = sol["catalogue"]["rect"]
    x0, x1, z0, z1 = r["x0"], r["x1"], r["z0"], r["z1"]
    z1 = z1 - 0.02
    D.cbox(x0, x1, 0.32, 1.3, z0, z1 - 0.012, OAK, c=0.012)
    for x in (x0 + 0.06, x1 - 0.06):
        for z in (z0 + 0.06, z1 - 0.06):
            D.lathe([(0.03, 0.0), (0.04, 0.1), (0.025, 0.3), (0.035, 0.32)], 12, OAK_DK, x, z, 0.0)
    cols, rows = 4, 6
    for i in range(cols):
        for j in range(rows):
            a = x0 + 0.04 + i * (x1 - x0 - 0.08) / cols
            b = a + (x1 - x0 - 0.08) / cols - 0.015
            y0 = 0.38 + j * 0.15
            D.box(a, b, y0, y0 + 0.13, z1 - 0.012, z1, OAK_LT)
            Gd.box((a + b) / 2 - 0.04, (a + b) / 2 + 0.04, y0 + 0.08, y0 + 0.11, z1, z1 + 0.004, BRASS)
            Gd.member(((a + b) / 2 - 0.025, y0 + 0.05, z1), ((a + b) / 2 + 0.025, y0 + 0.05, z1), G.prof_round(0.008, 5), BRASS)


def cart(kit, sol):
    """A three-tier oak book trolley on brass castors (solid book_cart) with returned books."""
    D, Gd = kit.D, kit.G
    r = sol["book_cart"]["rect"]
    x0, x1, z0, z1 = r["x0"] + 0.02, r["x1"] - 0.02, r["z0"] + 0.02, r["z1"] - 0.02
    for y in (0.15, 0.5, 0.85):
        D.box(x0, x1, y, y + 0.025, z0, z1, OAK)
    for x in (x0 + 0.02, x1 - 0.02):
        for z in (z0 + 0.02, z1 - 0.02):
            D.member((x, 0.06, z), (x, 0.98, z), G.prof_round(0.016, 6), OAK_DK)
            D.sphere(x, 0.04, z, 0.035, BRASS, n=6, rings=3)
    D.member((x0 + 0.02, 0.98, z0 + 0.02), (x0 + 0.02, 0.98, z1 - 0.02), G.prof_round(0.016, 6), BRASS)
    for k, y in enumerate((0.175, 0.525)):
        kit.place("books_%d" % (k % 4), DR.RUNS[k % 4], x0 + 0.38, y, z0 + 0.02, -math.pi / 2)
        kit.place("books_%d" % ((k + 1) % 4), DR.RUNS[(k + 1) % 4], x1 - 0.38, y, z1 - 0.02, math.pi / 2)


def ladder(kit, sol):
    """The rolling library ladder hooked on the brass rail of the east stacks (solid ladder): two oak stiles, round rungs,
    brass hooks at the top, castors at the foot."""
    D = kit.D
    r = sol["ladder"]["rect"]
    zc = (r["z0"] + r["z1"]) / 2
    foot_x, top_x = r["x0"] + 0.06, X - 0.48
    for dz in (-0.22, 0.22):
        D.member((foot_x, 0.05, zc + dz), (top_x, 2.42, zc + dz), G.prof_box(0.05, 0.07), OAK)
        D.sphere(foot_x, 0.04, zc + dz, 0.04, BRASS, n=6, rings=3)
        D.member((top_x, 2.42, zc + dz), (top_x + 0.04, 2.36, zc + dz), G.prof_round(0.012, 5), BRASS)
    for k in range(1, 9):
        t = k / 9
        p = G.lerp((foot_x, 0.05, zc), (top_x, 2.42, zc), t)
        D.member((p[0], p[1], zc - 0.22), (p[0], p[1], zc + 0.22), G.prof_round(0.018, 6), OAK_DK)


def armchairs(kit, sol):
    """Two wingback armchairs by the fire (solids armchair_w / armchair_e, slot armchair_nook), velvet, buttoned backs, turned
    feet, a cushion and a throw; a little round side table with a cup and a book next to the west one."""
    Gd, D = kit.G, kit.D
    for name, s, yaw in (("armchair_w", VELVET_G, math.pi / 2), ("armchair_e", VELVET_R, -math.pi / 2)):
        r = sol[name]["rect"]
        cx, cz = (r["x0"] + r["x1"]) / 2, (r["z0"] + r["z1"]) / 2
        a = Mesh("arm")
        a.cbox(-0.38, 0.38, 0.12, 0.42, -0.36, 0.36, s, c=0.04)
        a.cbox(-0.33, 0.33, 0.42, 0.52, -0.3, 0.32, CUSH_1 if s is VELVET_R else s.t(G.hexc("6B9A7E")), c=0.04)
        a.cbox(-0.38, 0.38, 0.42, 1.05, -0.38, -0.2, s, c=0.05)
        for x in (-0.38, 0.38):
            a.cbox(x - 0.07 if x > 0 else x, x if x > 0 else x + 0.07, 0.42, 0.66, -0.3, 0.36, s, c=0.03)
            a.cbox(x - 0.09 if x > 0 else x, x if x > 0 else x + 0.09, 0.66, 1.0, -0.38, -0.12, s, c=0.04)
        for x in (-0.3, 0.3):
            for z in (-0.3, 0.3):
                a.lathe([(0.03, 0.0), (0.035, 0.06), (0.025, 0.12)], 12, OAK_DK, x, z, 0.0)
        a.cbox(-0.2, 0.2, 0.52, 0.82, -0.2, -0.08, CUSH_3, c=0.05)
        D.extend(G.moved(a, cx, 0.0, cz, yaw))
    # a little stack of books on the floor beside the west chair (walk-over height)
    r = sol["armchair_w"]["rect"]
    for k in range(4):
        Gd.box(r["x0"] + 0.06 + 0.01 * k, r["x0"] + 0.3 - 0.01 * k, 0.03 * k, 0.03 * k + 0.03, r["z0"] + 0.02, r["z0"] + 0.06 + 0.12, S("LM_library_paint", G.hexc(BOOK_COLS[k * 3])))


def pictures(kit, W):
    """Four small public-domain landscapes (Constable, Hobbema, Corot, Ruisdael) in deep gilt frames on the upper walls."""
    for (f, u, cell) in ((W["door"], 4.6, 1), (W["door"], 8.7, 2), (W["door"], 0.65, 3), (W["door"], 12.75, 4)):
        DR.painting(kit.D, f, u - 0.42, u + 0.42, 3.78, 4.41, cell, frame=0.09)
