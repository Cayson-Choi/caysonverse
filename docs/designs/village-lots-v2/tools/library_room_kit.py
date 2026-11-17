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
    "M_painting": {"own": "lot_library_reading_paintings", "note": "public-domain landscapes (Constable, Hobbema, Corot, Ruisdael): SOURCES_lot_library.md"},
    "M_fire": {"fire": True},
}

X, Z, H = 13.4, 10.4, 5.2
BAYS = [(1.4, 3.8), (9.6, 12.0)]
BOOK_COLS = ["7A2E2E", "2F4B6E", "3E6B4A", "8C6A2E", "5A3A62", "B5502F", "2B5C5E", "6B2B3A", "C9A24A", "34495E", "7D5A44", "9B3D3D", "D8CBB0", "4A6B8C"]


def book_run(seed, length=0.42, hmin=0.22, hmax=0.31):
    """A run of real-looking books (spines +z, origin = the run's left end, base y 0): spine face, top page block, one side."""
    m = Mesh("books")
    rg = G.rng(seed)
    x = 0.0
    while x < length - 0.02:
        w = min(rg.uniform(0.022, 0.048), length - x)
        h = rg.uniform(hmin, hmax)
        d = rg.uniform(0.17, 0.23)
        col = G.hexc(BOOK_COLS[rg.randrange(len(BOOK_COLS))])
        s = S("LM_library_paint", col)  # cloth-bound covers: the bright painted set takes the colours truly (fabric is too dark)
        m.poly([(x, 0.0, 0.0), (x + w, 0.0, 0.0), (x + w, h, 0.0), (x, h, 0.0)], s)
        m.poly([(x, h, 0.0), (x + w, h, 0.0), (x + w, h, -d), (x, h, -d)], PAPER.t(G.hexc("F3EAD6")))
        m.poly([(x + w, 0.0, 0.0), (x + w, 0.0, -d), (x + w, h, -d), (x + w, h, 0.0)], s.t(G.mul(col, 0.75)))
        if rg.random() < 0.5:
            m.poly([(x + 0.003, h * 0.8, 0.002), (x + w - 0.003, h * 0.8, 0.002), (x + w - 0.003, h * 0.84, 0.002), (x + 0.003, h * 0.84, 0.002)], BRASS)
        x += w + rg.uniform(0.0, 0.003)
    return m


RUNS = [book_run(s) for s in (3, 17, 29, 41)]


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
    def WOOL(c):  # wool pile: the plaster scan's fine relief carries the dyes truly (fabric is too dark)
        return S("LM_library_plaster", G.hexc(c))
    DR.rug(Gd, 6.7, 8.1, 4.4, 2.3, WOOL("7E3226"), WOOL("2A3249"), WOOL("CDB48A"))
    DR.rug(Gd, 6.7, 3.9, 1.0, 4.2, WOOL("6E2A22"), WOOL("2A3249"), WOOL("CDB48A"))
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
    # the view through the fanlight
    R.window  # (the fanlight shows the porch's lantern light: a warm screen)
    f.quad(S_, 5.6, 7.8, 2.8, 3.4, -0.6, S("M_screen"))


def bay(kit, f, a, b):
    """A bay-window reading nook (contract seats lot_library_nook_1/2: the cushion's front edge at z 0.6, seat top 0.48):
    a canted glazed alcove 0.95 m deep beyond the wall, its oak window seat from the glass to z 0.6 with a deep cushion,
    bolsters, scatter cushions, a folded blanket, piled books and a little lamp; small shelves in the alcove's cheeks."""
    D, S_, Gd = kit.D, kit.S, kit.G
    zb = -0.95
    cant = 0.5
    A, B, C, Dd = (a, 0.0), (a + cant, zb), (b - cant, zb), (b, 0.0)
    # alcove floor, ceiling (3.3), the reveal of the opening
    S_.poly([(a, 0.0, 0.0), (b, 0.0, 0.0), (C[0], 0.0, zb), (B[0], 0.0, zb)][::-1], FLOOR)
    S_.poly([(a, 3.3, 0.0), (b, 3.3, 0.0), (C[0], 3.3, zb), (B[0], 3.3, zb)], CEIL)
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
        S_.poly(gq, GLASS)
        # view beyond the glass
        out = G.mul(inward, -1.6)
        vq = [G.add((p[0], 0.0, p[1]), out), G.add((q[0], 0.0, q[1]), out), G.add((q[0], 4.0, q[1]), out), G.add((p[0], 4.0, p[1]), out)]
        if G.dot(G.poly_normal(vq), inward) < 0:
            vq.reverse()
        bands = [(0.0, (0.45, 0.66, 0.32)), (0.9, (0.36, 0.56, 0.28)), (1.7, (0.62, 0.78, 0.9)), (4.0, (0.48, 0.68, 0.92))]
        for (va, ca), (vb, cb) in zip(bands, bands[1:]):
            qq = [G.add((p[0], va, p[1]), out), G.add((q[0], va, q[1]), out), G.add((q[0], vb, q[1]), out), G.add((p[0], vb, p[1]), out)]
            cols = [(*ca, 1.0), (*ca, 1.0), (*cb, 1.0), (*cb, 1.0)]
            if G.dot(G.poly_normal(qq), inward) < 0:
                qq.reverse()
                cols = [cols[3], cols[2], cols[1], cols[0]]
            S_.poly(qq, S("M_screen"), cols=cols)
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
        Gd.member((x, 0.6, -0.5), (x, 0.6, 0.45), G.prof_round(0.11, 10), s, caps=True)
    for k, (dx, s) in enumerate(((-0.45, CUSH_3), (0.05, VELVET_R), (0.5, CUSH_3))):
        cx = (a + b) / 2 + dx
        P.pillow(Gd, cx, 0.7, zb + 0.24, 0.46, 0.42, 0.15, s, tilt=-0.22)
    Gd.cbox(b - 0.85, b - 0.35, 0.48, 0.55, 0.15, 0.5, VELVET_G, c=0.02)
    Gd.cbox(b - 0.83, b - 0.37, 0.55, 0.58, 0.17, 0.48, VELVET_G.t(G.hexc("6E9A80")), c=0.01)
    rg = G.rng(int(a * 10))
    for k in range(5):
        c = G.hexc(BOOK_COLS[rg.randrange(len(BOOK_COLS))])
        Gd.box(a + 0.45 + 0.01 * k, a + 0.75 - 0.01 * k, 0.48 + 0.035 * k, 0.515 + 0.035 * k, 0.1, 0.33, S("LM_library_paint", c))
    lx, lz = (B[0] + 0.25), zb + 0.35
    Gd.lathe([(0.08, 0.0), (0.08, 0.02), (0.012, 0.04), (0.012, 0.4)], 8, BRASS, lx, lz, 0.48)
    Gd.lathe([(0.15, 0.0), (0.08, 0.17), (0.0, 0.18)], 10, FAB.t(G.hexc("F5E9CC")), lx, lz, 0.82)
    kit.glow("nooks").lathe([(0.0, 0.0), (0.13, 0.02), (0.07, 0.15), (0.0, 0.16)], 6, P.GLASS.t(P.LAMP), lx, lz, 0.83)
    kit.lights.append(("point", lx, 0.9, lz + 0.1, (1.0, 0.82, 0.58), 30.0))
    kit.dayfill.append(((a + b) / 2, 2.8, -0.3, 1.5, 40.0))
    P.potted_plant(Gd, (C[0] - 0.25, 0.48, zb + 0.3), POT, LEAF, 0.3)


def stacks(kit, sol):
    """Oak bookcases on the solids stacks_w / stacks_e / stacks_b (0.38 deep against the walls, 2.6 high): plinth, uprights
    every ~0.9 m, seven shelves, a crown moulding with a brass rail for the ladder; full of books (instanced runs), now and then
    a plant, a vase or bookends, so the shelves look curated, not stamped. The fireplace sits in the middle of the back run."""
    D, Gd = kit.D, kit.G
    rg = G.rng(77)
    shelves = [0.12 + k * 0.355 for k in range(7)]
    for name, wall in (("stacks_w", "w"), ("stacks_e", "e"), ("stacks_b", "b")):
        r = sol[name]["rect"]
        if wall == "b":
            segs = [(r["x0"], 5.55), (7.85, r["x1"])]
        elif wall == "w":
            segs = [(r["z0"], r["z1"])]
        else:
            segs = [(r["z0"], r["z1"])]
        for (s0, s1) in segs:
            L = s1 - s0
            n = max(1, int(round(L / 0.9)))
            bw = L / n
            # frame in (along, depth) per wall
            def box(a0, a1, y0, y1, d0, d1, s, skip=()):
                if wall == "w":
                    D.box(d0, d1, y0, y1, a0, a1, s, skip=skip)
                elif wall == "e":
                    D.box(X - d1, X - d0, y0, y1, a0, a1, s, skip=skip)
                else:
                    D.box(a0, a1, y0, y1, Z - d1, Z - d0, s, skip=skip)
            box(s0, s1, 0.0, 0.1, 0.0, 0.4, OAK_DK)
            box(s0, s1, 2.45, 2.6, 0.0, 0.42, OAK)
            box(s0 - 0.02, s1 + 0.02, 2.56, 2.62, 0.0, 0.46, OAK_DK)
            box(s0, s1, 0.1, 2.45, 0.0, 0.02, OAK_DK)
            for k in range(n + 1):
                a = s0 + k * bw
                box(max(s0, a - 0.022), min(s1, a + 0.022), 0.1, 2.45, 0.0, 0.38, OAK, skip=("-y",))
            for k in range(n):
                a0, a1 = s0 + k * bw + 0.022, s0 + (k + 1) * bw - 0.022
                for y in shelves:
                    box(a0, a1, y - 0.022, y, 0.02, 0.38, OAK)
                    if y > 2.3:
                        continue
                    t = a0 + 0.01
                    while t < a1 - 0.43:
                        if rg.random() < 0.07:
                            # a curated gap: a small plant or a vase
                            c = (t + 0.2, y, 0.22)
                            px, pz = ((c[2], t + 0.2) if wall == "w" else (X - c[2], t + 0.2) if wall == "e" else (t + 0.2, Z - c[2]))
                            if rg.random() < 0.5:
                                P.potted_plant(Gd, (px, y, pz), POT, LEAF, 0.26)
                            else:
                                Gd.lathe([(0.0, 0.0), (0.06, 0.0), (0.08, 0.08), (0.05, 0.18), (0.04, 0.22), (0.0, 0.22)], 8, S("LM_library_paint", G.hexc(("8FB8C9", "E8C5A0", "B9C8A6")[rg.randrange(3)])), px, pz, y)
                            t += 0.43
                            continue
                        kind = rg.randrange(len(RUNS))
                        if wall == "w":
                            kit.place("books_%d" % kind, RUNS[kind], 0.38, y, t + 0.42, math.pi / 2)
                        elif wall == "e":
                            kit.place("books_%d" % kind, RUNS[kind], X - 0.38, y, t, -math.pi / 2)
                        else:
                            kit.place("books_%d" % kind, RUNS[kind], t + 0.42, y, Z - 0.38, math.pi)
                        t += 0.43
        # the brass ladder rail along the east stacks' crown
    r = sol["stacks_e"]["rect"]
    D.member((X - 0.46, 2.4, r["z0"] + 0.1), (X - 0.46, 2.4, r["z1"] - 0.1), G.prof_round(0.018, 8), BRASS)
    for z in (r["z0"] + 0.1, (r["z0"] + r["z1"]) / 2, r["z1"] - 0.1):
        D.member((X - 0.46, 2.4, z), (X - 0.38, 2.4, z), G.prof_round(0.012, 5), BRASS)


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
        Gd.lathe([(0.06, 0.0), (0.05, 0.02), (0.015, 0.05), (0.02, 0.2), (0.035, 0.22), (0.0, 0.23)], 8, BRASS, x, zf + 0.15, 1.63)
        Gd.lathe([(0.012, 0.0), (0.012, 0.15), (0.0, 0.15)], 6, PAPER, x, zf + 0.15, 1.86)
    Gd.cbox(6.55, 6.85, 1.63, 1.86, zf + 0.06, zf + 0.22, BRASS, c=0.01)
    Gd.sphere(6.7, 1.77, zf + 0.055, 0.075, PAPER, n=10, rings=5, sy=0.15)
    for (x, c) in ((6.05, "8FB8C9"), (7.35, "E8C5A0")):
        Gd.lathe([(0.0, 0.0), (0.05, 0.0), (0.07, 0.07), (0.04, 0.16), (0.0, 0.16)], 8, S("LM_library_paint", G.hexc(c)), x, zf + 0.15, 1.63)
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
            m.lathe([(0.045, 0.0), (0.035, 0.08), (0.045, 0.12), (0.03, 0.3), (0.035, 0.5), (0.045, 0.56), (0.045, h - 0.15)], 8, OAK, x, z, 0.0)
    return m


def bankers_lamp(m, x, z, y):
    m.lathe([(0.08, 0.0), (0.08, 0.02), (0.02, 0.04), (0.012, 0.3)], 8, BRASS, x, z, y)
    m.member((x - 0.18, y + 0.33, z), (x + 0.18, y + 0.33, z), G.prof_round(0.06, 10), GREEN_GLASS)
    m.member((x - 0.18, y + 0.33, z), (x + 0.18, y + 0.33, z), G.prof_round(0.062, 10), S("LM_library_paint", G.hexc("2F6B47")))


def tables(kit, spec, sol):
    """Two reading tables (solids table_a / table_b) with two banker's lamps each, open books, a vase of flowers; chairs on the
    eight seats (facing the tables)."""
    Gd, D = kit.G, kit.D
    tk = table_kind()
    ck = R.chair_kind("chair", OAK, OAK_DK, w=0.46, back=0.95)
    for name in ("table_a", "table_b"):
        r = sol[name]["rect"]
        cx, cz = (r["x0"] + r["x1"]) / 2, (r["z0"] + r["z1"]) / 2
        kit.place("table", tk, cx, 0.0, cz, 0.0)
        for dz in (-0.6, 0.6):
            bankers_lamp(Gd, cx, cz + dz, 0.76)
            kit.glow("lamps").member((cx - 0.16, 1.07, cz + dz), (cx + 0.16, 1.07, cz + dz), G.prof_round(0.04, 6), P.GLASS.t(P.LAMP))
            kit.lights.append(("point", cx, 1.0, cz + dz, (1.0, 0.85, 0.6), 25.0))
        for (dx, dz, a) in ((-0.3, -0.6, 0.2), (0.32, 0.55, -0.15), (-0.28, 0.65, 0.1)):
            bk = Mesh("ob")
            bk.poly([(-0.16, 0.765, -0.11), (0.0, 0.775, -0.11), (0.0, 0.775, 0.11), (-0.16, 0.765, 0.11)][::-1], PAPER)
            bk.poly([(0.0, 0.775, -0.11), (0.16, 0.765, -0.11), (0.16, 0.765, 0.11), (0.0, 0.775, 0.11)][::-1], PAPER)
            bk.box(-0.165, 0.165, 0.76, 0.765, -0.115, 0.115, FAB.t(G.hexc("7A2E2E")))
            Gd.extend(G.moved(bk, cx + dx, 0.0, cz + dz, a))
        Gd.lathe([(0.0, 0.0), (0.05, 0.0), (0.06, 0.08), (0.03, 0.16), (0.035, 0.2), (0.0, 0.2)], 8, GREEN_GLASS, cx, cz, 0.76)
        for k in range(5):
            a = k * 1.256
            Gd.sphere(cx + 0.06 * math.cos(a), 1.0 + 0.03 * (k % 2), cz + 0.06 * math.sin(a), 0.04, S("LM_library_plaster", G.hexc(("F5A3B5", "FFFFFF", "F7D46A")[k % 3])), n=6, rings=4)
            Gd.member((cx, 0.9, cz), (cx + 0.06 * math.cos(a), 0.99, cz + 0.06 * math.sin(a)), G.prof_round(0.004, 4), LEAF_DK)
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
    D.box(x0 + 0.05, x1 - 0.05, 1.05, 1.052, z0 + 0.2, z1 - 0.1, FAB.t(G.hexc("3F6B52")))
    Gd.lathe([(0.05, 0.0), (0.045, 0.03), (0.02, 0.06), (0.006, 0.09)], 10, BRASS, x0 + 0.3, z0 + 0.35, 1.05)
    Gd.box(x0 + 0.6, x0 + 0.78, 1.05, 1.07, z0 + 0.3, z0 + 0.42, FAB.t(G.hexc("2F4B6E")))
    Gd.lathe([(0.025, 0.0), (0.02, 0.05), (0.008, 0.06), (0.015, 0.12), (0.0, 0.13)], 8, OAK_DK, x0 + 0.68, z0 + 0.36, 1.07)
    for k in range(6):
        c = G.hexc(BOOK_COLS[(k * 5) % len(BOOK_COLS)])
        Gd.box(x0 + 1.0 + 0.01 * (k % 2), x0 + 1.24 + 0.01 * (k % 2), 1.05 + k * 0.032, 1.08 + k * 0.032, z0 + 0.25, z0 + 0.42, S("LM_library_paint", c))
    bankers_lamp(Gd, x1 - 0.5, z0 + 0.5, 1.05)
    kit.glow("lamps").member((x1 - 0.66, 1.36, z0 + 0.5), (x1 - 0.34, 1.36, z0 + 0.5), G.prof_round(0.04, 6), P.GLASS.t(P.LAMP))
    Gd.cbox(x1 - 0.95, x1 - 0.75, 1.05, 1.15, z0 + 0.25, z0 + 0.5, OAK_LT, c=0.008)
    P.potted_plant(Gd, (x0 + 1.6, 1.05, z0 + 0.6), POT, S("LM_library_plaster", G.hexc("9A8FD0")), 0.28)
    ch = R.chair_kind("lchair", OAK, OAK_DK, w=0.46)
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
            D.lathe([(0.03, 0.0), (0.04, 0.1), (0.025, 0.3), (0.035, 0.32)], 6, OAK_DK, x, z, 0.0)
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
        kit.place("books_%d" % (k % 4), RUNS[k % 4], x0 + 0.38, y, z0 + 0.02, -math.pi / 2)
        kit.place("books_%d" % ((k + 1) % 4), RUNS[(k + 1) % 4], x1 - 0.38, y, z1 - 0.02, math.pi / 2)


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
                a.lathe([(0.03, 0.0), (0.035, 0.06), (0.025, 0.12)], 6, OAK_DK, x, z, 0.0)
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
