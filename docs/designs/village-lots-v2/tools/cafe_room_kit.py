"""케이슨 카페 (lot_cafe_room, the café's hall at (560, 40), 13.6 x 7.8, ceiling 4.3) and its upstairs salon (lot_cafe_upstairs at (590, 40),
13.6 x 13.0, ceiling 3.5) — the walk-in rooms' kit (design 11, `LOT_INTERIORS` CAFE_IN / CAFE_UP, shared/src/village/cafeRoom.ts), pure python
on b1_room / b1_parts / b1_geom and cafe_parts.py.

Owner 2026-11-21: "카페 안이 너무 허접하잖아. 사실적으로 왜 안만들었어. 추모관 수준으로 아주 사실적이고 디테일하게 입체적으로 만들고 빨간색
동그라미 글자 이상해 수정해" and "2층까지 있는데 왜 계단이 없어? 2층까지 만들어서 계단도 만들어". A brand-new Parisian/Alsatian café-
pâtisserie (references: tmpshots/cafe-real/refs): honey oak boards, warm plaster over a sage wainscot, oak beams; the deep-green panelled
counter with its Carrara top and brass foot rail, the curved-glass pastry case full of croissants, tarts, an opéra and macarons, cake
stands under glass cloches; the back bar in white metro tiles with open oak shelves of cups, jars and tins, the two-group espresso machine
and its grinder; two chalk menus and the enamel sign over them, "CAFÉ · PÂTISSERIE" in raised gilt letters, fitted to its board; marble
bistro tables on cast-iron pedestals with Thonet bentwood chairs, bentwood bar stools, a teal velvet banquette under the window, brass
dome and opal globe pendants, framed prints, a wall clock, plants; café curtains on brass rods; and the oak half-turn stair to the salon.
Upstairs: windows on every side (the facade's), linen drapes, a wallpapered salon over a dado, marble tables, a petrol-velvet sofa, wing
chairs, a pâtisserie sideboard with cakes under cloches, a bookcase, brass chandeliers and sconces, the stairwell's balustrade.

Room frame (as every lot room): x across from the left wall as one comes in, z in from the door wall's inside face, y up.
"""
import math

import b1_geom as G
import b1_parts as P
import b1_room as R
import cafe_parts as C
from b1_geom import Mesh, S

STAIR = dict(x0=0.0, x1=2.45, z0=3.85, z1=7.8, ax0=0.05, ax1=1.15, bx0=1.25, bx1=2.35, foot=3.9, landing=6.6, risers=20, riser=0.23, tread=0.3)
STOREY = 4.6
PHONE = False


def mats(unit):
    m = dict(C.MATS)
    m["M_garden"] = R.garden_map("lot_cafe_room")  # (the upstairs shares the café's village panoramas)
    if unit == "lot_cafe_upstairs":
        m["LM_cafe_paper"] = {"set": "wallpaper", "rough": 0.9}
    return m


def build(spec, unit, layout, phone=False):
    global PHONE
    PHONE = phone
    C.PHONE = phone
    G.LOD = 0.55 if phone else 1.0
    kit = P.Kit(None)
    kit.mats = mats(spec["unit"])
    if spec["unit"] == "lot_cafe_room":
        ground(kit, spec)
    else:
        upstairs(kit, spec)
    kit.sun_dir = (-4.0, 0, -9.0)     # the sun out in front of the shop windows (the room's -z), afternoon light across the floor
    kit.sun_elev = 32
    kit.world_strength = 0.16
    kit.look = "AgX - Medium High Contrast"
    kit.exposure = 0.25
    kit.ground = Mesh("ground")
    return kit


# ------------------------------------------------------------------------------------------------ shared shell pieces --

def ceiling_with_hole(m, X, Z, H, hole, s):
    """The ceiling (facing down) minus a rectangle (x0, x1, z0, z1)."""
    xs = sorted({0.0, X, hole[0], hole[1]})
    zs = sorted({0.0, Z, hole[2], hole[3]})
    for i in range(len(xs) - 1):
        for j in range(len(zs) - 1):
            cx, cz = (xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2
            if hole[0] < cx < hole[1] and hole[2] < cz < hole[3]:
                continue
            m.poly([(xs[i], H, zs[j]), (xs[i + 1], H, zs[j]), (xs[i + 1], H, zs[j + 1]), (xs[i], H, zs[j + 1])], s)


def floor_with_hole(m, X, Z, hole, s):
    xs = sorted({0.0, X, hole[0], hole[1]})
    zs = sorted({0.0, Z, hole[2], hole[3]})
    for i in range(len(xs) - 1):
        for j in range(len(zs) - 1):
            cx, cz = (xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2
            if hole[0] < cx < hole[1] and hole[2] < cz < hole[3]:
                continue
            m.poly([(xs[i], 0, zs[j]), (xs[i], 0, zs[j + 1]), (xs[i + 1], 0, zs[j + 1]), (xs[i + 1], 0, zs[j])], s)


def walls_with_holes(kit, X, Z, H, holes, s):
    W = R.walls(X, Z)
    span = {"door": X, "back": X, "left": Z, "right": Z}
    for k, f in W.items():
        P.wall(kit.S, f, 0.0, span[k], 0.0, H, holes.get(k, []), s)
    return W


def wainscot_run(m, f, a, b, h, skip_holes=()):
    """A sage panelled wainscot with an oak cap and a cream skirting along u = a..b, broken by holes (u0, u1)."""
    cuts = [(a, b)]
    for (h0, h1) in skip_holes:
        nxt = []
        for (p, q) in cuts:
            if h1 <= p or h0 >= q:
                nxt.append((p, q))
                continue
            if h0 > p:
                nxt.append((p, h0))
            if h1 < q:
                nxt.append((h1, q))
        cuts = nxt
    for (p, q) in cuts:
        if q - p < 0.12:
            continue
        f.box(m, p, q, 0.0, 0.12, 0.0, 0.025, C.PAINT, skip=("-w",))
        f.box(m, p, q, h - 0.05, h, 0.0, 0.04, C.OAK_DK, skip=("-w",))
        f.box(m, p, q, 0.12, h - 0.05, 0.0, 0.01, C.SAGE, skip=("-w", "-v", "+v", "-u", "+u"))
        n = max(1, int(round((q - p) / 0.7)))
        for k in range(n):
            ua = p + (q - p) * k / n + 0.07
            ub = p + (q - p) * (k + 1) / n - 0.07
            if ub - ua < 0.1:
                continue
            f.box(m, ua, ub, 0.2, h - 0.13, 0.01, 0.022, C.SAGE, c=0.006 if not PHONE else 0.0, skip=("-w",))


def shop_window(kit, f, uc, w, sill, h, transom):
    """A shop window seen from inside: R.window's reveal, frame and glass (the village behind it), three lites, a transom bar."""
    R.window(kit, f, uc, sill, w, h, C.DARK, C.OAK_DK, C.PLASTER, cols=3, rows=1, depth=0.15)
    f.box(kit.D, uc - w / 2 + 0.075, uc + w / 2 - 0.075, transom - 0.03, transom + 0.03, -0.155, -0.1, C.DARK, skip=("-w",))


def stair(kit, yb, enclose_under=True, ceiling=None):
    """The half-turn oak stair (cafeRoom.ts CAFE_STAIR) with its floor at y = yb (0 in the café, -4.6 seen from the salon): treads with
    nosings, cream risers, the landing, the spine wall between the flights (its oak cap the inner handrail), turned balusters and the oak
    rail on flight B's open side and the landing, the panelled enclosure under flight B, a brass handrail on the side wall."""
    S_, D = kit.S, kit.D
    st = STAIR
    r, t = st["riser"], st["tread"]
    n = 10
    lt = 0.06 if not PHONE else 0.0

    def tread(x0, x1, z0, z1, y, nose_dir):
        D.box(x0, x1, y - 0.04, y, z0, z1, C.OAK, kind=None) if PHONE else D.cbox(x0, x1, y - 0.04, y, z0, z1, C.OAK, c=0.008)

    # flight A: up toward +z from the foot (z 3.9) to the landing (z 6.6)
    for k in range(n - 1):
        z0 = st["foot"] + k * t
        y = yb + (k + 1) * r
        S_.box(st["ax0"], st["ax1"], y - r, y - 0.04, z0, z0 + 0.02, C.PAINT, skip=("+y", "-y"))  # riser
        tread(st["ax0"], st["ax1"], z0 - 0.03, z0 + t, y, -1)
        S_.box(st["ax0"], st["ax1"], yb, y - r, z0, z0 + t, C.PAINT, skip=("+y", "-x", "+x", "-z")) if k == 0 else None
    # the landing
    yl = yb + n * r
    S_.box(st["ax0"], st["bx1"], yl - r, yl - 0.04, st["landing"], st["landing"] + 0.02, C.PAINT, skip=("+y", "-y")) if False else None
    D.box(st["ax0"], st["bx1"], yl - 0.04, yl, st["landing"] - 0.03, st["z1"] - 0.05, C.OAK)
    S_.box(st["ax0"], st["bx1"], yl - 0.3, yl - 0.04, st["landing"], st["z1"] - 0.05, C.PAINT, skip=("+y",))
    S_.box(st["ax0"], st["ax1"], yl - r, yl - 0.04, st["landing"] - 0.02, st["landing"], C.PAINT, skip=("+y", "-y"))
    # flight B: up toward -z from the landing to the floor above (z 3.9)
    for k in range(n):
        z1 = st["landing"] - k * t
        y = yl + (k + 1) * r
        S_.box(st["bx0"], st["bx1"], y - r, y - 0.04, z1 - 0.02, z1, C.PAINT, skip=("+y", "-y"))
        tread(st["bx0"], st["bx1"], z1 - t, z1 + 0.03, y, 1)
    # flight B's soffit (seen from under the stair if the enclosure is open): a sloped plaster underside
    zs, ze = st["foot"], st["landing"]
    S_.poly([(st["bx0"], yl - 0.3, ze), (st["bx1"], yl - 0.3, ze), (st["bx1"], yb + STOREY - 0.3, zs), (st["bx0"], yb + STOREY - 0.3, zs)], C.CEIL)
    # the spine wall between the flights (x 1.15..1.25): from the floor up to flight B's treads + 0.9, an oak cap on top
    xs0, xs1 = st["ax1"], st["bx0"]
    segs = 10
    for k in range(segs):
        za = st["foot"] + (st["landing"] - st["foot"]) * k / segs
        zb = st["foot"] + (st["landing"] - st["foot"]) * (k + 1) / segs
        ya = yb + STOREY - (za - st["foot"]) / t * r + 0.9
        yb_ = yb + STOREY - (zb - st["foot"]) / t * r + 0.9
        if ceiling is not None:
            ya, yb_ = min(ya, ceiling), min(yb_, ceiling)
        for x_, out in ((xs0, -1), (xs1, 1)):
            q = [(x_, yb, za), (x_, yb, zb), (x_, yb_, zb), (x_, ya, za)]
            if G.dot(G.poly_normal(q), (out, 0, 0)) < 0:
                q.reverse()
            S_.poly(q, C.PAINT)
        q = [(xs0, ya, za), (xs1, ya, za), (xs1, yb_, zb), (xs0, yb_, zb)]
        if G.poly_normal(q)[1] < 0:
            q.reverse()
        D.poly(q, C.OAK_DK)
    S_.box(xs0, xs1, yb, yb + STOREY + 0.9 if ceiling is None else ceiling, st["foot"] - 0.02, st["foot"], C.PAINT, skip=("-y", "+z"))
    # flight B's open side (x = 2.35 .. 2.45): the closed string, balusters and the rail climbing toward the front; the landing's rail
    xo = st["bx1"] + 0.05
    if enclose_under:
        # the panelled enclosure under flight B: cream panels from the floor up to the string
        for k in range(segs):
            za = st["foot"] + (st["landing"] - st["foot"]) * k / segs
            zb = st["foot"] + (st["landing"] - st["foot"]) * (k + 1) / segs
            ya = yb + STOREY - (za - st["foot"]) / t * r - 0.32
            yb2 = yb + STOREY - (zb - st["foot"]) / t * r - 0.32
            if ceiling is not None:
                ya, yb2 = min(ya, ceiling), min(yb2, ceiling)
            q = [(st["x1"], yb, za), (st["x1"], yb, zb), (st["x1"], yb2, zb), (st["x1"], ya, za)]
            if G.dot(G.poly_normal(q), (1, 0, 0)) < 0:
                q.reverse()
            S_.poly(q, C.PAINT)
        S_.box(st["bx1"], st["x1"], yb, yl - 0.3, st["landing"], st["z1"], C.PAINT, skip=("-y", "+z", "-x"))
        f = P.F((st["x1"], 0.0, st["foot"]), (0, 0, 1), (1, 0, 0))
        for (a, b, top) in ((0.15, 0.95, 2.9), (1.1, 1.85, 2.3), (2.0, 2.6, 1.7), (2.75, 3.8, 1.5)):
            if ceiling is not None and yb + top > ceiling:
                continue
            f.box(D, a, b, yb + 0.2, yb + top - 0.15, 0.0, 0.015, C.SAGE, c=0.005 if not PHONE else 0.0)
        # (a little cupboard door under the stair, with a brass knob)
        f.box(D, 2.8, 3.7, yb + 0.05, yb + 1.45, 0.0, 0.025, C.PAINT, c=0.006 if not PHONE else 0.0)
        p = f.p(2.88, yb + 0.8, 0.04)
        D.sphere(p[0], p[1], p[2], 0.018, C.BRASS, n=8, rings=5)
    # the string on the open side
    for k in range(segs):
        za = st["foot"] + (st["landing"] - st["foot"]) * k / segs
        zb = st["foot"] + (st["landing"] - st["foot"]) * (k + 1) / segs
        ya = yb + STOREY - (za - st["foot"]) / t * r
        yb2 = yb + STOREY - (zb - st["foot"]) / t * r
        D.poly([(st["x1"] + 0.002, ya - 0.33, za), (st["x1"] + 0.002, yb2 - 0.33, zb), (st["x1"] + 0.002, yb2 + 0.03, zb), (st["x1"] + 0.002, ya + 0.03, za)], C.OAK_DK)
    # balusters (two a tread), the handrail and the newel posts
    bal = 0.035
    for k in range(n):
        z1 = st["landing"] - k * t
        y = yl + (k + 1) * r
        for q in ((0.25, ), (0.75, )) if not PHONE else ((0.5, ),):
            zz = z1 - t * q[0]
            if ceiling is not None and y + 0.9 > ceiling and yb == 0:
                continue
            D.lathe([(bal * 0.5, 0.0), (bal * 0.5, 0.06), (bal * 0.65, 0.09), (bal * 0.4, 0.2), (bal * 0.35, 0.65), (bal * 0.55, 0.78), (bal * 0.5, 0.84), (bal * 0.5, 0.86)], C.seg(8, 5), C.PAINT, xo - 0.02, zz, y)
    rail = []
    for k in range(11):
        z_ = st["landing"] - k * t * 0.9 - 0.05
        y_ = yl + (st["landing"] - z_) / t * r + 0.9
        rail.append((xo - 0.02, y_, z_))
    if ceiling is not None and yb == 0:
        rail = [p for p in rail if p[1] < ceiling - 0.05]
    if len(rail) >= 2:
        D.member(rail[0], rail[-1], [(-0.03, -0.03), (0.03, -0.03), (0.035, 0.0), (0.025, 0.03), (-0.025, 0.03), (-0.035, 0.0)], C.OAK_DK)
    # the landing's balustrade (x = 2.4, z 6.6 .. 7.75) and its newel
    for zz in [st["landing"] + 0.1 + 0.15 * k for k in range(8)]:
        D.lathe([(bal * 0.5, 0.0), (bal * 0.65, 0.09), (bal * 0.35, 0.65), (bal * 0.55, 0.78), (bal * 0.5, 0.86)], C.seg(8, 5), C.PAINT, xo - 0.02, zz, yl)
    D.member((xo - 0.02, yl + 0.9, st["landing"] - 0.05), (xo - 0.02, yl + 0.9, st["z1"] - 0.03), [(-0.03, -0.03), (0.03, -0.03), (0.035, 0.0), (0.025, 0.03), (-0.025, 0.03), (-0.035, 0.0)], C.OAK_DK)
    D.cbox(xo - 0.08, xo + 0.04, yl - 0.3, yl + 1.02, st["landing"] - 0.12, st["landing"], C.OAK_DK, c=0.01)
    D.lathe([(0.0, 0.0), (0.06, 0.0), (0.07, 0.03), (0.04, 0.07), (0.0, 0.08)], C.seg(10, 6), C.OAK_DK, xo - 0.02, st["landing"] - 0.06, yl + 1.02)
    # the brass handrail on the side wall along flight A
    hr = [(st["ax0"] + 0.06, yb + 0.9 + (st["foot"] + k * t - st["foot"]) / t * r, st["foot"] + k * t) for k in range(0, 10)]
    D.tube([hr[0], hr[-1]], 0.022, C.seg(10, 6), C.BRASS)
    for p in hr[1::3]:
        D.tube([(st["ax0"], p[1] - 0.07, p[2]), (p[0], p[1] - 0.07, p[2]), (p[0], p[1] - 0.02, p[2])], 0.007, 5, C.BRASS)


# ------------------------------------------------------------------------------------------------ the café (ground floor) --

def ground(kit, spec):
    X, Z, H = 13.6, 7.8, 4.3
    S_, D, Gd = kit.S, kit.D, kit.G
    sol = {s["name"]: s["rect"] for s in spec["solids"]}
    st = STAIR
    # the shell
    floor_with_hole(S_, X, Z, (0, 0, 0, 0), C.FLOOR)
    ceiling_with_hole(S_, X, Z, H, (st["x0"], st["x1"], st["z0"], st["z1"]), C.CEIL)
    front = [(1.55, 4.95, 0.45, 3.35), (8.65, 12.05, 0.45, 3.35), (5.6, 8.0, 0.0, 3.0)]
    side_l = [(Z - 3.5, Z - 1.1, 0.9, 2.7), (Z - 7.7, Z - 5.3, 0.9, 2.7)]       # x = 0 wall, u = Z - z
    side_r = [(1.1, 3.5, 0.9, 2.7), (5.3, 7.7, 0.9, 2.7)]                     # x = X wall, u = z
    back = [(X - 5.85, X - 4.9, 0.0, 2.25)]                                    # the kitchen door (room x 4.9..5.85)
    W = walls_with_holes(kit, X, Z, H, {"door": front, "left": side_l, "right": side_r, "back": back}, C.PLASTER)
    for (a, b, v0, v1) in front[:2]:
        shop_window(kit, W["door"], (a + b) / 2, b - a, v0, v1 - v0, 2.7)
        # the stall riser under the glass: a dark-green panel; café curtains on a brass rod over the lower lites
        W["door"].box(D, a - 0.05, b + 0.05, 0.0, v0, 0.0, 0.03, C.GREEN, skip=("-w",))
        W["door"].box(D, a - 0.06, b + 0.06, v0 - 0.035, v0, -0.02, 0.07, C.OAK_DK)
        C.curtain(D, W["door"], a + 0.08, b - 0.08, 1.75, v0 + 0.08, 0.1, tie=False)
    for (a, b, v0, v1) in side_l + side_r:
        pass
    for f, holes in ((W["left"], side_l), (W["right"], side_r)):
        for (a, b, v0, v1) in holes:
            R.window(kit, f, (a + b) / 2, v0, b - a, v1 - v0, C.DARK, C.OAK_DK, C.PLASTER, cols=2, rows=1, depth=0.15)
            C.curtain(D, f, a, b, v1 + 0.08, v0 + 0.15, 0.09, tie=True)
    # the glass double door (the leaves seen from inside, the village through their glass), oak frame, brass push bars
    f = W["door"]
    for (a, b) in ((5.62, 6.79), (6.81, 7.98)):
        f.box(D, a, b, 0.0, 2.92, -0.07, -0.02, C.DARK, skip=("-w",))
        f.quad(S_, a + 0.1, b - 0.1, 0.3, 2.75, -0.03, C.GARDEN)
        f.box(D, a + 0.1, b - 0.1, 0.12, 0.3, -0.02, -0.01, C.DARK)
        hx = b - 0.12 if a < 6.8 else a + 0.12
        D.tube([f.p(hx, 0.95, 0.06), f.p(hx, 1.45, 0.06)], 0.014, 8, C.BRASS)
        for v in (0.95, 1.45):
            D.tube([f.p(hx, v, -0.02), f.p(hx, v, 0.06)], 0.008, 6, C.BRASS)
    f.box(D, 5.45, 5.6, 0.0, 3.15, 0.0, 0.05, C.OAK_DK, skip=("-w",))
    f.box(D, 8.0, 8.15, 0.0, 3.15, 0.0, 0.05, C.OAK_DK, skip=("-w",))
    f.box(D, 5.45, 8.15, 3.0, 3.15, 0.0, 0.05, C.OAK_DK, skip=("-w",))
    for (u, sgn) in ((5.6, 1), (8.0, -1)):
        q = [f.p(u, 0.0, 0.0), f.p(u, 3.0, 0.0), f.p(u, 3.0, -0.08), f.p(u, 0.0, -0.08)]
        if G.dot(G.poly_normal(q), G.mul(f.U, sgn)) < 0:
            q.reverse()
        S_.poly(q, C.PLASTER)
    # the kitchen door (a panelled oak door with a round port light) in the back wall
    fb = W["back"]
    ua, ub = X - 5.85, X - 4.9
    fb.box(D, ua - 0.08, ub + 0.08, 2.25, 2.35, 0.0, 0.04, C.OAK_DK, skip=("-w",))
    fb.box(D, ua - 0.08, ua, 0.0, 2.25, 0.0, 0.04, C.OAK_DK, skip=("-w",))
    fb.box(D, ub, ub + 0.08, 0.0, 2.25, 0.0, 0.04, C.OAK_DK, skip=("-w",))
    fb.box(D, ua, ub, 0.0, 2.25, -0.04, -0.0, C.OAK_DK)
    fb.box(D, ua + 0.1, ub - 0.1, 0.2, 1.0, 0.0, 0.012, C.OAK, c=0.004)
    D.lathe([(0.15, 0.0), (0.15, 0.03), (0.0, 0.03)], C.seg(20, 10), C.BRASS, 0, 0, 0) if False else None
    pl = fb.p((ua + ub) / 2, 1.65, 0.0)
    for k in range(C.seg(20, 10)):
        a0, a1 = 2 * math.pi * k / C.seg(20, 10), 2 * math.pi * (k + 1) / C.seg(20, 10)
        D.poly([fb.p((ua + ub) / 2, 1.65, 0.002), fb.p((ua + ub) / 2 + 0.16 * math.cos(a0), 1.65 + 0.16 * math.sin(a0), 0.002), fb.p((ua + ub) / 2 + 0.16 * math.cos(a1), 1.65 + 0.16 * math.sin(a1), 0.002)], C.GLASS.t(G.hexc("3A4850")))
    D.tube([fb.p((ua + ub) / 2 + 0.17 * math.cos(2 * math.pi * k / 16), 1.65 + 0.17 * math.sin(2 * math.pi * k / 16), 0.02) for k in range(17)], 0.012, 6, C.BRASS)
    kb = fb.p(ub - 0.1, 1.05, 0.06)
    D.sphere(kb[0], kb[1], kb[2], 0.025, C.BRASS, n=10, rings=6)
    # wainscot: side walls (under the windows), back wall beside the door and under the stair's landing; the front's stall risers above
    wainscot_run(D, W["right"], 0.0, Z, 0.85)
    wainscot_run(D, W["left"], 0.0, Z, 0.85, skip_holes=((0.0, Z - st["foot"] + 0.02),))   # (the stair's side: its own wall string)
    wainscot_run(D, W["back"], X - 5.95, X - 2.45, 0.85, skip_holes=((X - 5.93, X - 4.82),))
    wainscot_run(D, W["door"], 0.0, 1.5, 0.85)
    wainscot_run(D, W["door"], 12.1, X, 0.85)
    # the oak beams across the room (along z), clear of the stairwell; a crown moulding
    for x in (3.4, 5.6, 7.8, 10.0, 12.2):
        D.box(x - 0.09, x + 0.09, H - 0.24, H, 0.0, Z, C.OAK_DK, skip=("+y", "-z", "+z"))
    D.box(st["x1"], st["x1"] + 0.18, H - 0.24, H, st["z0"], st["z1"], C.OAK_DK, skip=("+y", "+z"))
    D.box(0.0, st["x1"] + 0.18, H - 0.24, H, st["z0"] - 0.18, st["z0"], C.OAK_DK, skip=("+y", "-x"))
    # the stairwell above the ceiling: a plaster shaft to the salon's ceiling (seen looking up the stair)
    top = STOREY + 3.5
    for (q, n_) in (([(st["x1"], H, st["z0"]), (st["x1"], H, st["z1"]), (st["x1"], top, st["z1"]), (st["x1"], top, st["z0"])], (-1, 0, 0)),
                    ([(0.0, H, st["z0"]), (st["x1"], H, st["z0"]), (st["x1"], top, st["z0"]), (0.0, top, st["z0"])], (0, 0, 1)),
                    ([(0.0, H, st["z0"]), (0.0, H, st["z1"]), (0.0, top, st["z1"]), (0.0, top, st["z0"])], (1, 0, 0)),
                    ([(0.0, H, st["z1"]), (st["x1"], H, st["z1"]), (st["x1"], top, st["z1"]), (0.0, top, st["z1"])], (0, 0, -1))):
        if G.dot(G.poly_normal(q), n_) < 0:
            q.reverse()
        S_.poly(q, C.PLASTER)
    S_.poly([(0.0, top, st["z0"]), (st["x1"], top, st["z0"]), (st["x1"], top, st["z1"]), (0.0, top, st["z1"])], C.CEIL)
    stair(kit, 0.0, enclose_under=True, ceiling=None)
    counter(kit, sol)
    back_bar(kit, sol)
    banquette(kit, spec)
    seating(kit, spec)
    walls_dress(kit, W, X, Z, H)
    lamps_ground(kit, spec, H)
    for name, kind, h in (("plant_1", "palm", 2.3), ("plant_2", "fig", 1.9), ("plant_3", "fig", 1.9), ("plant_4", "fig", 1.9)):
        r = sol[name]
        cx, cz = (r["x0"] + r["x1"]) / 2, (r["z0"] + r["z1"]) / 2
        C.plant_pot(Gd, cx, cz, min(r["x1"] - r["x0"], r["z1"] - r["z0"]) / 2 - 0.02, h, kind, seed=hash(name) % 1000)
    # a coat stand by the door and a round jute mat inside it
    Gd.lathe([(1.0, 0.0), (1.0, 0.008), (0.0, 0.008)], C.seg(36, 16), S("LM_cafe_fabric", G.hexc("C8B38E")), 6.8, 1.15, 0.0)


def counter(kit, sol):
    """The serving counter (room x 6.96..12.04, z 5.4..6.12, 1.07 m): a deep-green panelled front with raised mouldings, a dark toe kick,
    the Carrara top (the atlas's long marble) with an eased edge, a brass foot rail on brackets; on it the curved-glass pastry case, two
    cake stands under cloches, a jar of macarons, a brass till; the barista's side open shelves."""
    S_, D, Gd = kit.S, kit.D, kit.G
    r = sol["counter"]
    x0, x1, z0, z1 = r["x0"], r["x1"], r["z0"], r["z1"]
    S_.box(x0 + 0.04, x1 - 0.04, 0.0, 0.1, z0 + 0.05, z1, C.BLACK, skip=("-y",))
    S_.box(x0, x1, 0.1, 1.03, z0, z1, C.GREEN, skip=("-y", "+y"))
    # raised panels on the customer side (z0 face)
    n = 7
    pw = (x1 - x0) / n
    for k in range(n):
        a, b = x0 + k * pw + 0.07, x0 + (k + 1) * pw - 0.07
        D.box(a, b, 0.2, 0.93, z0 - 0.012, z0, C.GREEN)
        D.box(a + 0.04, b - 0.04, 0.24, 0.89, z0 - 0.022, z0 - 0.012, C.GREEN)
    D.box(x0, x1, 0.1, 0.16, z0 - 0.015, z0, C.GREEN)
    D.box(x0, x1, 0.97, 1.03, z0 - 0.02, z0, C.GREEN)
    for x in (x0, x1):
        D.box(x - 0.015, x + 0.015, 0.1, 1.03, z0 - 0.02, z1, C.GREEN)
    # the marble top (a 4 cm slab, 3 cm overhang to the customers)
    n0 = len(S_.polys)
    S_.cbox(x0 - 0.04, x1 + 0.04, 1.03, 1.07, z0 - 0.06, z1 + 0.02, C.ART, c=0.008) if not PHONE else S_.box(x0 - 0.04, x1 + 0.04, 1.03, 1.07, z0 - 0.06, z1 + 0.02, C.ART)
    u0, u1, v0, v1 = C.cuv("marble_long")
    for p in S_.polys[n0:]:
        p.uv = [(u0 + (u1 - u0) * (q[0] - (x0 - 0.04)) / (x1 - x0 + 0.08), v0 + (v1 - v0) * (0.15 + 0.7 * (q[2] - (z0 - 0.06)) / (z1 - z0 + 0.08) + 0.1 * (q[1] - 1.03) / 0.04)) for q in p.pts]
        p.mat = C.ART.mat
        p.col = [(1, 1, 1, 1)] * len(p.pts)
    # the brass foot rail on three brackets
    D.tube([(x0 + 0.15, 0.2, z0 - 0.14), (x1 - 0.15, 0.2, z0 - 0.14)], 0.022, C.seg(10, 6), C.BRASS)
    for x in (x0 + 0.3, (x0 + x1) / 2, x1 - 0.3):
        D.tube([(x, 0.2, z0 - 0.14), (x, 0.24, z0 - 0.04), (x, 0.24, z0 - 0.015)], 0.01, 6, C.BRASS)
    for x in (x0 + 0.15, x1 - 0.15):
        D.sphere(x, 0.2, z0 - 0.14, 0.03, C.BRASS, n=8, rings=5)
    y = 1.07
    pastry_case(kit, Gd, 7.15, 9.35, (z0 + z1) / 2, y)
    # cake stands under cloches: an opéra cut, a berry chantilly; a tall jar of macarons; the till
    ys = C.cake_stand(Gd, 9.75, y, 5.75, r=0.13, h=0.11)
    C.cake(Gd, 9.75, ys, 5.75, 0.1, 0.07, "cake_choc", (0.22, 0.12, 0.07), cut=True)
    ys = C.cake_stand(Gd, 10.25, y, 5.72, r=0.13, h=0.16)
    C.cake(Gd, 10.25, ys, 5.72, 0.1, 0.08, "cake_berry", (0.98, 0.96, 0.9))
    Gd.lathe([(0.0, 0.0), (0.075, 0.0), (0.08, 0.02), (0.08, 0.24), (0.06, 0.26), (0.06, 0.28), (0.0, 0.28)], C.seg(16, 10), C.GLASS, 10.75, 5.7, y)
    if not PHONE:
        cols = [(0.96, 0.72, 0.78), (0.78, 0.89, 0.69), (0.96, 0.87, 0.54), (0.78, 0.72, 0.9), (0.95, 0.76, 0.6)]
        for k in range(10):
            C.macaron(Gd, 10.75 + 0.03 * math.cos(k * 2.3), y + 0.02 + (k // 3) * 0.024, 5.7 + 0.03 * math.sin(k * 2.3), cols[k % 5])
    Gd.lathe([(0.0, 0.0), (0.04, 0.0), (0.0, 0.32)], 4, C.BRASS, 10.75, 5.7, y + 0.28) if False else None
    # the till: a small brass-and-oak cash register
    Gd.cbox(11.35, 11.75, y, y + 0.14, 5.55, 5.95, C.OAK_DK, c=0.01)
    Gd.cbox(11.38, 11.72, y + 0.14, y + 0.3, 5.7, 5.94, C.BRASS, c=0.01)
    for k in range(4):
        for j in range(2):
            Gd.box(11.42 + k * 0.075, 11.47 + k * 0.075, y + 0.14, y + 0.16, 5.58 + j * 0.05, 5.62 + j * 0.05, C.PAINT)
    # a bell and a small vase of tulips at the end
    Gd.lathe([(0.0, 0.0), (0.035, 0.0), (0.035, 0.01), (0.03, 0.03), (0.01, 0.05), (0.008, 0.07), (0.0, 0.075)], 12, C.BRASS, 11.9, 5.65, y)
    vase(Gd, 7.12, y, 5.62, (0.9, 0.35, 0.4))


def vase(m, x, y, z, flower):
    n0 = len(m.polys)
    m.lathe([(0.0, 0.0), (0.03, 0.0), (0.04, 0.05), (0.025, 0.12), (0.03, 0.14), (0.0, 0.13)], C.seg(12, 8), C.ART, x, z, y)
    C.glaze(m, n0, (0.36, 0.55, 0.62))
    for k in range(5):
        a = k * 1.3
        tip = (x + 0.05 * math.cos(a), y + 0.27 + 0.03 * math.sin(k), z + 0.05 * math.sin(a))
        m.tube([(x, y + 0.1, z), tip], 0.003, 4, C.LEAF_DK)
        n1 = len(m.polys)
        m.lathe([(0.0, 0.0), (0.014, 0.01), (0.016, 0.035), (0.0, 0.03)], 6, C.ART, tip[0], tip[2], tip[1])
        C.matte(m, n1, flower)


def pastry_case(kit, m, x0, x1, zc, y):
    """The curved-glass pastry case on the counter: a white lacquered base with a brass kick, two glass shelves on steel posts, a bowed
    front glass (quarter round toward the customers), glass ends, a mirror-steel back with sliding doors; inside croissants and pains au
    chocolat on trays, strawberry and lemon tartlets, éclairs, a cut opéra and macarons."""
    d = 0.56
    z0, z1 = zc - d / 2, zc + d / 2
    h = 0.46
    n0 = len(m.polys)
    m.cbox(x0, x1, y, y + 0.09, z0, z1, C.ART, c=0.01) if not PHONE else m.box(x0, x1, y, y + 0.09, z0, z1, C.ART)
    C.glaze(m, n0, (0.97, 0.96, 0.93))
    m.box(x0, x1, y, y + 0.012, z0 - 0.004, z0, C.BRASS)
    yb = y + 0.09
    # the bowed front: a quarter cylinder from the base's front edge up and back to the top
    nseg = 6 if PHONE else 12
    R = 0.32
    cz, cy = z0 + R, yb
    pts = [(cz - R * math.cos(math.pi / 2 * k / nseg), cy + R * math.sin(math.pi / 2 * k / nseg) * (h / R) * 0.95) for k in range(nseg + 1)]
    for k in range(nseg):
        (za, ya), (zb, yb2) = pts[k], pts[k + 1]
        q = [(x0, ya, za), (x1, ya, za), (x1, yb2, zb), (x0, yb2, zb)]
        if G.poly_normal(q)[2] > 0:
            q.reverse()
        m.poly(q, C.GLASS)
        m.poly(list(reversed(q)), C.GLASS)
    ztop = pts[-1][0]
    ytop = pts[-1][1]
    m.poly([(x0, ytop, ztop), (x1, ytop, ztop), (x1, ytop, z1), (x0, ytop, z1)], C.GLASS)
    for x in (x0, x1):
        prof = [(z0, yb)] + pts + [(z1, ytop), (z1, yb)]
        q = [(x, yy, zz) for zz, yy in prof]
        m.poly(q, C.GLASS)
        m.poly(list(reversed(q)), C.GLASS)
        m.tube([(x, yy, zz) for zz, yy in pts], 0.008, 5, C.CHROME)
    m.tube([(x0, ytop, ztop), (x1, ytop, ztop)], 0.008, 5, C.CHROME)
    # (the back stays open: the barista's side, sliding doors left out so the pastries read from the room through two layers of glass)
    m.box(x0, x1, ytop - 0.02, ytop, z1 - 0.04, z1, C.CHROME)
    # the shelf (glass on chrome rails) at mid height, LED strip glow under the top
    ys = yb + 0.19
    m.box(x0 + 0.02, x1 - 0.02, ys, ys + 0.008, z0 + 0.18, z1 - 0.03, C.GLASS)
    kit.glow("lamps").box(x0 + 0.05, x1 - 0.05, ytop - 0.012, ytop - 0.006, z1 - 0.12, z1 - 0.06, C.GLOW)
    kit.lights.append(("point", (x0 + x1) / 2, ytop - 0.05, zc, (1.0, 0.9, 0.75), 8.0))
    # bottom tier: trays of croissants and pains au chocolat, tartlets
    def tray(xa, xb, za, zb, yy):
        n1 = len(m.polys)
        m.box(xa, xb, yy, yy + 0.008, za, zb, C.ART)
        C.glaze(m, n1, (0.95, 0.94, 0.9))
        return yy + 0.008
    yy = tray(x0 + 0.06, x0 + 0.66, z0 + 0.1, z1 - 0.06, yb)
    for i in range(3):
        for j in range(2):
            C.croissant(m, x0 + 0.16 + i * 0.19, yy, z0 + 0.19 + j * 0.16, yaw=0.3 * (i - j), L=0.1, R=0.034)
    yy = tray(x0 + 0.72, x0 + 1.32, z0 + 0.1, z1 - 0.06, yb)
    for i in range(3):
        for j in range(2):
            C.croissant(m, x0 + 0.84 + i * 0.19, yy, z0 + 0.19 + j * 0.16, yaw=0.0, L=0.058, R=0.03, choc=True)
    yy = tray(x0 + 1.38, x1 - 0.06, z0 + 0.1, z1 - 0.06, yb)
    k = 0
    for i in range(3 if PHONE else 5):
        for j in range(2):
            C.tart(m, x0 + 1.46 + i * 0.15, yy, z0 + 0.2 + j * 0.16, 0.068, "tart_fruit" if (i + j) % 2 == 0 else "cake_lemon")
    # upper tier: éclairs, an opéra cut, macarons in rows
    yy = ys + 0.008
    for i in range(3 if PHONE else 5):
        C.eclair(m, x0 + 0.18 + i * 0.1, yy, z1 - 0.15, yaw=math.pi / 2, tint=(0.33, 0.19, 0.11) if i % 2 else (0.95, 0.8, 0.85))
    C.cake(m, x0 + 1.0, yy, z1 - 0.16, 0.09, 0.06, "cake_choc", (0.22, 0.12, 0.07), cut=True)
    if not PHONE:
        cols = [(0.96, 0.72, 0.78), (0.78, 0.89, 0.69), (0.96, 0.87, 0.54), (0.78, 0.72, 0.9), (0.95, 0.76, 0.6), (0.6, 0.42, 0.3)]
        for i in range(12):
            for j in range(2):
                C.macaron(m, x0 + 1.35 + i * 0.05, yy, z1 - 0.2 + j * 0.06, cols[(i // 2) % 6])


def back_bar(kit, sol):
    """The back bar (room x 5.97..12.43, z 7.16..7.8): cream cabinet doors with brass pulls under an oak top (0.94 m), white metro tiles to
    2.5 m, three open oak shelves on brass brackets (cups, saucers, glass jars of beans and biscuits, tea tins, a stack of plates, cake
    domes), the espresso machine and its grinder on the top, a knock box and milk pitchers; the chalk menus and the enamel sign above."""
    S_, D, Gd = kit.S, kit.D, kit.G
    r = sol["back_bar"]
    x0, x1, z0, z1 = r["x0"], r["x1"], r["z0"], r["z1"]
    S_.box(x0, x1, 0.0, 0.1, z0 + 0.04, z1, C.BLACK, skip=("-y", "+z"))
    S_.box(x0, x1, 0.1, 0.9, z0, z1, C.PAINT, skip=("-y", "+z", "+y"))
    n = 6
    pw = (x1 - x0) / n
    for k in range(n):
        a, b = x0 + k * pw + 0.02, x0 + (k + 1) * pw - 0.02
        D.box(a, b, 0.13, 0.87, z0 - 0.02, z0, C.PAINT)
        D.box(a + 0.06, b - 0.06, 0.2, 0.8, z0 - 0.03, z0 - 0.02, C.PAINT)
        hxp = b - 0.07 if k % 2 == 0 else a + 0.07
        D.box(hxp - 0.008, hxp + 0.008, 0.7, 0.8, z0 - 0.05, z0 - 0.03, C.BRASS)
    D.box(x0 - 0.02, x1 + 0.02, 0.9, 0.94, z0 - 0.04, z1, C.OAK, skip=("+z",))
    # the metro tiles (on the wall, 0.94..2.5)
    S_.box(x0, x1, 0.94, 2.5, z1 - 0.012, z1, C.TILE, skip=("+z", "-y", "+y"))
    S_.box(x0, x1, 2.5, 2.56, z1 - 0.03, z1, C.OAK_DK, skip=("+z",))
    # shelves
    rg = G.rng(41)
    for k, ys in enumerate((1.5, 1.88, 2.26)):
        D.cbox(x0 + 0.05, x1 - 0.05, ys - 0.035, ys, z1 - 0.3, z1 - 0.012, C.OAK, c=0.006) if not PHONE else D.box(x0 + 0.05, x1 - 0.05, ys - 0.035, ys, z1 - 0.3, z1 - 0.012, C.OAK)
        for bx in (x0 + 0.3, (x0 + x1) / 2, x1 - 0.3):
            D.tube([(bx, ys - 0.035, z1 - 0.012), (bx, ys - 0.035, z1 - 0.2), (bx, ys - 0.15, z1 - 0.012)], 0.007, 5, C.BRASS)
        x = x0 + 0.15
        while x < x1 - 0.2:
            kind = rg.choice(["cups", "jar", "tin", "plates", "jar", "cups", "bottle"]) if k < 2 else rg.choice(["dome", "jar", "plates", "tin", "jar"])
            if PHONE and rg.random() < 0.35:
                x += 0.25
                continue
            zc = z1 - 0.16
            if kind == "cups":
                for i in range(3):
                    C.cup(Gd, x + i * 0.1, ys, zc, tint=[(0.98, 0.97, 0.94), (0.36, 0.55, 0.62), (0.98, 0.97, 0.94)][i], coffee=False, yaw=math.pi / 2)
                x += 0.36
            elif kind == "jar":
                h = 0.2 + 0.08 * rg.random()
                n0 = len(Gd.polys)
                Gd.lathe([(0.0, 0.0), (0.05, 0.0), (0.05, h * 0.75), (0.0, h * 0.75)], C.seg(12, 8), C.ART, x + 0.06, zc, ys)
                C.remap(Gd, n0, "beans" if rg.random() < 0.6 else "bread")
                Gd.lathe([(0.055, 0.0), (0.058, h - 0.03), (0.04, h), (0.0, h)], C.seg(12, 8), C.GLASS, x + 0.06, zc, ys)
                Gd.lathe([(0.042, 0.0), (0.045, 0.012), (0.0, 0.03)], C.seg(12, 8), C.CHROME, x + 0.06, zc, ys + h)
                lab = rg.randrange(6)
                C.card(Gd, (x + 0.025, ys + h * 0.3, zc - 0.059), (x + 0.095, ys + h * 0.3, zc - 0.059), (x + 0.095, ys + h * 0.55, zc - 0.059), (x + 0.025, ys + h * 0.55, zc - 0.059), "labels", sub=(lab / 6, 0, (lab + 1) / 6, 1))
                Gd.polys[-1].pts.reverse()
                Gd.polys[-1].uv.reverse()
                x += 0.16
            elif kind == "tin":
                for i in range(2):
                    lab = rg.randrange(6)
                    n0 = len(Gd.polys)
                    Gd.lathe([(0.0, 0.0), (0.045, 0.0), (0.045, 0.14), (0.0, 0.14)], C.seg(12, 8), C.ART, x + 0.05 + i * 0.1, zc, ys)
                    C.remap(Gd, n0, "labels", sub=(lab / 6, 0, (lab + 1) / 6, 1))
                x += 0.24
            elif kind == "plates":
                for i in range(6):
                    C.plate(Gd, x + 0.12, ys + i * 0.016, zc, 0.11)
                x += 0.28
            elif kind == "bottle":
                for i in range(2):
                    n0 = len(Gd.polys)
                    Gd.lathe([(0.0, 0.0), (0.035, 0.0), (0.036, 0.2), (0.012, 0.26), (0.012, 0.3), (0.0, 0.3)], C.seg(12, 8), C.ART, x + 0.05 + i * 0.09, zc, ys)
                    C.glaze(Gd, n0, [(0.35, 0.18, 0.12), (0.62, 0.42, 0.15)][i])
                x += 0.22
            elif kind == "dome":
                ysx = C.cake_stand(Gd, x + 0.15, ys, zc, r=0.12, h=0.06)
                C.cake(Gd, x + 0.15, ysx, zc, 0.09, 0.07, rg.choice(["cake_lemon", "cake_berry", "cake_choc"]), (0.98, 0.95, 0.88))
                x += 0.34
            else:
                C.book_row(Gd, x, x + 0.3, ys, zc - 0.1, zc + 0.08, rg)
                x += 0.34
    # the espresso machine (facing the customers, -z), the grinder beside it, a knock box and milk pitchers
    C.espresso_machine(kit, Gd, 9.5, 0.94, (z0 + z1) / 2 - 0.02, yaw=math.pi)
    C.grinder(Gd, 8.55, 0.94, (z0 + z1) / 2, yaw=math.pi)
    Gd.cbox(8.0, 8.2, 0.94, 1.06, z0 + 0.12, z0 + 0.34, C.BLACK, c=0.01) if not PHONE else None
    for k in range(2):
        Gd.lathe([(0.0, 0.0), (0.04, 0.0), (0.045, 0.06), (0.04, 0.12), (0.045, 0.13), (0.0, 0.12)], C.seg(12, 8), C.CHROME, 10.3 + k * 0.12, z0 + 0.2, 0.94)
    for k in range(4):
        C.cup(Gd, 10.65 + k * 0.11, 0.94, z0 + 0.22, tint=(0.98, 0.97, 0.94), coffee=False, yaw=math.pi / 2)
    # the two chalk menus in oak frames, the clock between them, the enamel sign above
    fb = R.walls(13.6, 7.8)["back"]
    X = 13.6
    for (xa, xb, cell) in ((6.25, 7.85, "chalk_coffee"), (10.55, 12.15, "chalk_pastry")):
        ua, ub = X - xb, X - xa
        fb.box(D, ua - 0.05, ub + 0.05, 2.62, 3.47, 0.0, 0.035, C.OAK_DK, c=0.008 if not PHONE else 0.0, skip=("-w",))
        C.card(D, fb.p(ua, 2.66, 0.036), fb.p(ub, 2.66, 0.036), fb.p(ub, 3.43, 0.036), fb.p(ua, 3.43, 0.036), cell)
    clock(kit, D, fb, X - 9.2, 3.05)
    sign(kit, fb, X - 9.2, 3.72)


def clock(kit, m, f, uc, vc, r=0.24):
    """A round station clock: a brass bezel, the atlas's Roman dial, black hands at ten past ten."""
    n = C.seg(28, 14)
    c = f.p(uc, vc, 0.0)
    W = f.W
    def L(prof, s, d0=0.0):
        n0 = len(m.polys)
        m.lathe(prof, n, s, 0, 0, 0)
        for p in m.polys[n0:]:
            p.pts = [G.add(f.p(uc + q[0], vc - q[2], d0 + q[1]), (0, 0, 0)) for q in p.pts]
        return n0
    L([(r + 0.02, 0.0), (r + 0.025, 0.03), (r + 0.01, 0.05), (r - 0.01, 0.05), (r - 0.012, 0.04)], C.BRASS)
    n0 = L([(0.0, 0.0), (r - 0.01, 0.0), (r - 0.01, 0.038), (0.0, 0.038)], C.ART)
    C.planar_face(m, n0 + 0, "clock") if False else None
    face_ = [p for p in m.polys[n0:] if abs(G.poly_normal(p.pts)[0] * W[0] + G.poly_normal(p.pts)[2] * W[2]) > 0.9]
    u0, u1, v0, v1 = C.cuv("clock")
    for p in m.polys[n0:]:
        p.uv = [(u0 + (u1 - u0) * (0.5 + (G.dot(G.sub(q, c), f.U)) / (2 * r)), v0 + (v1 - v0) * (0.5 + (q[1] - vc) / (2 * r))) for q in p.pts]
        p.mat = C.ART.mat
    for (ang, L_, w) in ((math.radians(-60), r * 0.5, 0.012), (math.radians(60), r * 0.72, 0.008)):
        a = f.p(uc, vc, 0.042)
        b = f.p(uc + math.sin(ang) * L_, vc + math.cos(ang) * L_, 0.042)
        m.member(a, b, G.prof_box(w, 0.004), C.BLACK)


def sign(kit, f, uc, vc):
    """The enamel sign over the menus (the circled sign, fixed: owner 2026-11-21 "빨간색 동그라미 글자 이상해 수정해" — the old card's
    "· CAFÉ & PÂ" ran off both ends of its board): a 3.4 x 0.62 m board of deep-green enamel in a moulded oak frame with a gilt pinstripe,
    "CAFÉ · PÂTISSERIE" in raised gilt serif letters (16 cm, 1.2 cm deep: the whole words, fitted with a margin each side), and
    "케이슨 카페 · 마을 빵집" under it; two brass picture lights above."""
    D = kit.D
    w, h = 3.4, 0.62
    u0, u1, v0, v1 = uc - w / 2, uc + w / 2, vc - h / 2, vc + h / 2
    f.box(D, u0 - 0.06, u1 + 0.06, v0 - 0.06, v1 + 0.06, 0.0, 0.03, C.OAK_DK, c=0.01 if not PHONE else 0.0, skip=("-w",))
    C.card(D, f.p(u0, v0, 0.031), f.p(u1, v0, 0.031), f.p(u1, v1, 0.031), f.p(u0, v1, 0.031), "sign")
    out = f.W
    kit.letters.append(("CAFÉ · PÂTISSERIE", f.p(uc, vc - 0.05, 0.031), out, 0.21, 0.014, C.GILT, "D", {"font": "C:/Windows/Fonts/georgiab.ttf", "capital": True}))
    kit.letters.append(("케이슨 카페 · 마을 빵집", f.p(uc, v0 + 0.07, 0.031), out, 0.055, 0.006, C.GILT, "D"))
    for du in (-1.0, 1.0):
        base = f.p(uc + du, v1 + 0.12, 0.0)
        D.tube([base, f.p(uc + du, v1 + 0.16, 0.2), f.p(uc + du, v1 + 0.1, 0.3)], 0.008, 5, C.BRASS)
        hd = f.p(uc + du, v1 + 0.08, 0.3)
        D.member(G.add(hd, G.mul(f.U, -0.16)), G.add(hd, G.mul(f.U, 0.16)), [(-0.03, -0.02), (0.03, -0.02), (0.035, 0.02), (-0.035, 0.02)], C.BRASS)
        kit.lights.append(("spot", hd[0], hd[1] - 0.05, hd[2], (1.0, 0.86, 0.65), 12.0))


def banquette(kit, spec):
    """The teal velvet banquette along the right wall (x 13.05..13.6, z 0.75..3.45): an oak plinth, a deep seat cushion, a buttoned back
    of three rounded panels against the wall, brass studs along the base."""
    D, S_ = kit.D, kit.S
    s = next(q for q in spec["solids"] if q["name"] == "seatfurn_banquette")["rect"]
    x0, x1, z0, z1 = s["x0"], s["x1"], s["z0"], s["z1"]
    S_.box(x0, x1, 0.0, 0.08, z0, z1, C.BLACK, skip=("-y", "+x"))
    S_.box(x0 + 0.03, x1, 0.08, 0.3, z0, z1, C.OAK_DK, skip=("-y", "+x"))
    C.soft_box(D, x0 + 0.01, x1 - 0.08, 0.3, 0.46, z0 + 0.02, z1 - 0.02, C.VELVET, r=0.05)
    seg_n = 3
    sw = (z1 - z0) / seg_n
    for k in range(seg_n):
        za, zb = z0 + k * sw + 0.015, z0 + (k + 1) * sw - 0.015
        # a back panel leaning back 8 degrees: a soft box built upright then sheared toward the wall
        n0 = len(D.polys)
        C.soft_box(D, x1 - 0.18, x1 - 0.03, 0.46, 0.88 + 0.06, za, zb, C.VELVET, r=0.06)
        for p in D.polys[n0:]:
            p.pts = [(q[0] + (q[1] - 0.46) * 0.12, q[1], q[2]) for q in p.pts]
        if not PHONE:
            for i in range(2):
                for j in range(3):
                    bz = za + (zb - za) * (j + 0.5) / 3
                    by = 0.6 + i * 0.2
                    bx = x1 - 0.185 + (by - 0.46) * 0.12
                    D.sphere(bx, by, bz, 0.012, C.VELVET.t(G.hexc("234840")), n=6, rings=4)
    if not PHONE:
        for k in range(int((z1 - z0) / 0.06)):
            D.sphere(x0 + 0.03, 0.27, z0 + 0.03 + k * 0.06, 0.006, C.BRASS, n=5, rings=3)


def seating(kit, spec):
    """The bistro tables (instanced: marble on cast iron), the bentwood chairs at their seats, the bar stools."""
    import cafe_room_kit as K  # noqa
    table = C.bistro_table()
    chair = C.bentwood_chair()
    stool = C.bar_stool()
    yaw = {"in": 0.0, "out": math.pi, "left": -math.pi / 2, "right": math.pi / 2}
    for s in spec["solids"]:
        if s["name"].startswith("table_") or s["name"].startswith("uptable_"):
            r = s["rect"]
            kit.place("table", table, (r["x0"] + r["x1"]) / 2, 0.0, (r["z0"] + r["z1"]) / 2, 0.0)
    for s in spec["seats"]:
        if "chair" in s["id"] and "armchair" not in s["id"]:
            kit.place("chair", chair, s["x"], 0.0, s["z"], yaw[s["faces"]])
        elif "stool" in s["id"]:
            kit.place("stool", stool, s["x"], 0.0, s["z"], yaw[s["faces"]])
    # on the tables: cups of coffee, a croissant on a plate, a little vase
    rg = G.rng(9)
    for s in spec["solids"]:
        if not (s["name"].startswith("table_") or s["name"].startswith("uptable_")):
            continue
        r = s["rect"]
        cx, cz = (r["x0"] + r["x1"]) / 2, (r["z0"] + r["z1"]) / 2
        if PHONE and rg.random() < 0.4:
            continue
        C.cup(kit.G, cx + 0.12, 0.755, cz - 0.08, yaw=rg.random() * 6)
        if rg.random() < 0.6:
            yp = C.plate(kit.G, cx - 0.1, 0.755, cz + 0.07, 0.08)
            C.croissant(kit.G, cx - 0.1, yp, cz + 0.07, yaw=rg.random() * 3) if rg.random() < 0.5 else C.tart(kit.G, cx - 0.1, yp, cz + 0.07, 0.05, rg.choice(["tart_fruit", "cake_lemon"]))
        if not PHONE:
            vase(kit.G, cx, 0.755, cz, rg.choice([(0.95, 0.55, 0.6), (0.98, 0.85, 0.4), (0.9, 0.9, 0.95)]))


def walls_dress(kit, W, X, Z, H):
    """Framed prints, a gilt mirror over the banquette, a mantel clock shelf: on the plaster above the wainscot."""
    D = kit.D
    C.framed(D, W["right"], 2.1, 3.05, 0.7, 0.9, "print_poster") if False else None
    C.framed(D, W["door"], 0.75, 2.0, 0.42, 0.56, "print_lemons")
    C.framed(D, W["door"], 12.85, 2.0, 0.42, 0.56, "print_street")
    C.framed(D, W["right"], 4.5, 1.75, 0.5, 0.66, "print_poster")
    C.framed(D, W["back"], X - 3.25, 1.75, 0.42, 0.56, "print_macarons")
    # wall sconces between the side windows
    C.sconce(kit, D, W["right"].p(4.3, 2.55, 0.0), W["right"].W)
    C.sconce(kit, D, W["door"].p(0.75, 2.75, 0.0), W["door"].W)
    C.sconce(kit, D, W["door"].p(12.85, 2.75, 0.0), W["door"].W)


def lamps_ground(kit, spec, H):
    D = kit.D
    for s in spec["solids"]:
        if s["name"].startswith("table_"):
            r = s["rect"]
            cx, cz = (r["x0"] + r["x1"]) / 2, (r["z0"] + r["z1"]) / 2
            k = int(s["name"].split("_")[1])
            C.pendant(kit, D, cx, cz, H, 1.85, "dome" if k % 2 else "globe")
    for x in (7.8, 9.5, 11.2):
        C.pendant(kit, D, x, 5.76, H, 1.75, "dome")
    C.pendant(kit, D, 13.25, 2.1, H, 1.7, "globe")
    C.pendant(kit, D, 1.2, 2.2, H, 1.6, "globe")


# ------------------------------------------------------------------------------------------------ the salon (upstairs) --

def upstairs(kit, spec):
    X, Z, H = 13.6, 13.0, 3.5
    S_, D, Gd = kit.S, kit.D, kit.G
    st = STAIR
    sol = {s["name"]: s["rect"] for s in spec["solids"]}
    hole = (st["x0"], st["x1"], st["z0"], st["z1"])
    floor_with_hole(S_, X, Z, hole, C.FLOOR)
    S_.poly([(0, H, 0), (X, H, 0), (X, H, Z), (0, H, Z)], C.CEIL)
    win = [(c - 0.8, c + 0.8, 0.9, 2.9) for c in (1.4, 5.0, 8.6, 12.2)]
    side_r = [(c - 0.8, c + 0.8, 0.9, 2.9) for c in (1.4, 4.8, 8.2, 11.6)]          # x = X, u = z
    side_l = [(Z - c - 0.8, Z - c + 0.8, 0.9, 2.9) for c in (1.4, 4.8, 8.2, 11.6)]  # x = 0, u = Z - z
    back = [(X - c - 0.8, X - c + 0.8, 0.9, 2.9) for c in (1.4, 5.0, 8.6, 12.2)]
    holes = {"door": win, "right": side_r, "left": side_l, "back": back}
    # the walls: wallpaper over a cream dado (the plaster set below 0.9, the paper above), the shell's wall faces are the paper
    W = walls_with_holes(kit, X, Z, H, holes, C.WALLPAPER)
    for k, f in W.items():
        for (a, b, v0, v1) in holes[k]:
            R.window(kit, f, (a + b) / 2, v0, b - a, v1 - v0, C.PAINT, C.OAK, C.PLASTER, cols=2, rows=2, depth=0.15)
            C.curtain(D, f, a, b, v1 + 0.08, 0.15, 0.1, tie=True)
    span = {"door": X, "back": X, "left": Z, "right": Z}
    for k, f in W.items():
        skip = []
        if k == "left":
            skip = [(Z - st["z1"], Z - st["z0"] + 0.02)]
        if k == "back":
            skip = [(X - st["x1"] - 0.02, X)]
        wainscot_dado(D, f, 0.0, span[k], 0.88, skip)
        f.box(D, 0.0, span[k], H - 0.12, H, 0.0, 0.07, C.PAINT, skip=("-w",))   # the cornice
    # the stairwell: the stair below (its floor 4.6 m down), the shaft's walls, the balustrade round the hole
    stair(kit, -STOREY, enclose_under=False, ceiling=None)
    for (q, n_) in (([(st["x1"], -STOREY, st["z0"]), (st["x1"], -STOREY, st["z1"]), (st["x1"], 0.0, st["z1"]), (st["x1"], 0.0, st["z0"])], (-1, 0, 0)),
                    ([(0.0, -STOREY, st["z1"]), (st["x1"], -STOREY, st["z1"]), (st["x1"], 0.0, st["z1"]), (0.0, 0.0, st["z1"])], (0, 0, -1)),
                    ([(0.0, -STOREY, st["z0"]), (0.0, -STOREY, st["z1"]), (0.0, 0.0, st["z1"]), (0.0, 0.0, st["z0"])], (1, 0, 0))):
        if G.dot(G.poly_normal(q), n_) < 0:
            q.reverse()
        S_.poly(q, C.PLASTER)
    S_.poly([(0.0, -STOREY, 3.0), (0.0, -STOREY, st["z0"]), (st["x1"], -STOREY, st["z0"]), (st["x1"], -STOREY, 3.0)], C.FLOOR)
    S_.poly([(0.0, -STOREY + 4.3, 3.0), (st["x1"], -STOREY + 4.3, 3.0), (st["x1"], -STOREY + 4.3, st["z0"]), (0.0, -STOREY + 4.3, st["z0"])], C.CEIL)
    # the floor's edge round the hole (an oak nosing) and the balustrade: x = 2.45 (z 3.85..7.8), z = 7.8 (x 0..2.45), z = 3.85 (x 0..1.2)
    D.box(st["x1"], st["x1"] + 0.06, -0.3, 0.02, st["z0"], st["z1"] + 0.06, C.OAK_DK)
    D.box(0.0, st["x1"] + 0.06, -0.3, 0.02, st["z1"], st["z1"] + 0.06, C.OAK_DK)
    D.box(0.0, st["ax1"] + 0.05, -0.3, 0.02, st["z0"] - 0.06, st["z0"], C.OAK_DK)
    rail_prof = [(-0.03, -0.03), (0.03, -0.03), (0.035, 0.0), (0.025, 0.03), (-0.025, 0.03), (-0.035, 0.0)]
    bal = 0.035
    for (a, b) in (((st["x1"] + 0.03, 0.0, st["z0"] + 0.05), (st["x1"] + 0.03, 0.0, st["z1"] + 0.03)), ((0.02, 0.0, st["z1"] + 0.03), (st["x1"] + 0.03, 0.0, st["z1"] + 0.03)),
                   ((0.02, 0.0, st["z0"] - 0.03), (st["ax1"] + 0.03, 0.0, st["z0"] - 0.03))):
        L = math.dist(a, b)
        nb = max(2, int(L / (0.15 if not PHONE else 0.3)))
        for k in range(nb + 1):
            p = G.lerp(a, b, k / nb)
            D.lathe([(bal * 0.5, 0.0), (bal * 0.65, 0.09), (bal * 0.35, 0.6), (bal * 0.55, 0.78), (bal * 0.5, 0.9)], C.seg(8, 5), C.PAINT, p[0], p[2], 0.02)
        D.member(G.add(a, (0, 0.95, 0)), G.add(b, (0, 0.95, 0)), rail_prof, C.OAK_DK)
    for p in ((st["x1"] + 0.03, st["z0"] + 0.05), (st["x1"] + 0.03, st["z1"] + 0.03), (st["ax1"] + 0.03, st["z0"] - 0.03)):
        D.cbox(p[0] - 0.06, p[0] + 0.06, 0.0, 1.05, p[1] - 0.06, p[1] + 0.06, C.OAK_DK, c=0.01)
        D.lathe([(0.0, 0.0), (0.06, 0.0), (0.07, 0.03), (0.04, 0.07), (0.0, 0.08)], C.seg(10, 6), C.OAK_DK, p[0], p[1], 1.05)
    # furniture
    seating(kit, spec)
    sofa(kit, sol["seatfurn_sofa"])
    for a in spec["seats"]:
        if a["id"].startswith("lot_cafe_up_armchair_"):
            wing_chair(kit, a)
    r = sol["lowtable"]
    lt = Mesh("lt")
    Gd.cbox(r["x0"], r["x1"], 0.42, 0.48, r["z0"], r["z1"], C.OAK_DK, c=0.01)
    for (x, z) in ((r["x0"] + 0.05, r["z0"] + 0.05), (r["x1"] - 0.05, r["z0"] + 0.05), (r["x0"] + 0.05, r["z1"] - 0.05), (r["x1"] - 0.05, r["z1"] - 0.05)):
        Gd.lathe([(0.02, 0.0), (0.025, 0.2), (0.02, 0.42)], C.seg(8, 5), C.OAK_DK, x, z, 0.0)
    C.cup(Gd, (r["x0"] + r["x1"]) / 2 - 0.1, 0.48, (r["z0"] + r["z1"]) / 2)
    C.cup(Gd, (r["x0"] + r["x1"]) / 2 + 0.1, 0.48, (r["z0"] + r["z1"]) / 2, tint=(0.36, 0.55, 0.62))
    sideboard(kit, sol["sideboard"])
    bookcase(kit, sol["bookcase"])
    for name, kind, h in (("plant_up_1", "fig", 1.9), ("plant_up_2", "palm", 1.9), ("plant_up_3", "fig", 2.1)):
        r = sol[name]
        C.plant_pot(Gd, (r["x0"] + r["x1"]) / 2, (r["z0"] + r["z1"]) / 2, (r["x1"] - r["x0"]) / 2 - 0.02, h, kind, seed=hash(name) % 1000)
    # a big round rug in the middle, chandeliers, sconces, prints and a gilt mirror
    for k, (rr, c) in enumerate(((2.3, "B9A07A"), (2.15, "E9DCC3"), (1.5, "C9B48E"))):
        Gd.lathe([(rr, 0.0), (rr, 0.006 + 0.001 * k), (0.0, 0.006 + 0.001 * k)], C.seg(48, 20), S("LM_cafe_fabric", G.hexc(c)), 7.6, 6.4, 0.0)
    for (x, z) in ((6.0, 4.0), (8.6, 8.6)):
        C.chandelier(kit, D, x, z, H, 0.95)
    for (f, u) in ((W["door"], 3.2), (W["door"], 10.4), (W["right"], 10.0), (W["back"], 3.2), (W["back"], 10.4)):
        C.sconce(kit, D, f.p(u, 2.2, 0.0), f.W)
    C.framed(D, W["right"], 3.1, 1.95, 0.42, 0.56, "print_macarons")
    C.framed(D, W["right"], 6.5, 1.95, 0.42, 0.56, "print_lemons")
    C.framed(D, W["door"], 6.8, 1.9, 0.5, 0.66, "print_street")
    C.framed(D, W["left"], Z - 6.5, 1.9, 0.5, 0.66, "print_poster")
    mirror(kit, W["back"], X - 10.4, 1.95)


def wainscot_dado(m, f, a, b, h, skip):
    """The salon's dado: cream panels to 0.88 m under an oak rail, a skirting (windows' sills start at 0.9)."""
    cuts = [(a, b)]
    for (h0, h1) in skip:
        nxt = []
        for (p, q) in cuts:
            if h1 <= p or h0 >= q:
                nxt.append((p, q))
                continue
            if h0 > p:
                nxt.append((p, h0))
            if h1 < q:
                nxt.append((h1, q))
        cuts = nxt
    for (p, q) in cuts:
        if q - p < 0.12:
            continue
        f.box(m, p, q, 0.0, 0.14, 0.0, 0.02, C.PAINT, skip=("-w",))
        f.box(m, p, q, 0.14, h - 0.05, 0.0, 0.008, C.PAINT.t(G.hexc("EFE6D4")), skip=("-w", "-v", "+v", "-u", "+u"))
        f.box(m, p, q, h - 0.05, h, 0.0, 0.035, C.OAK_DK, skip=("-w",))
        n = max(1, int(round((q - p) / 0.8)))
        for k in range(n):
            ua = p + (q - p) * k / n + 0.08
            ub = p + (q - p) * (k + 1) / n - 0.08
            if ub - ua > 0.1:
                f.box(m, ua, ub, 0.22, h - 0.14, 0.008, 0.02, C.PAINT.t(G.hexc("EFE6D4")), c=0.005 if not PHONE else 0.0, skip=("-w",))


def sofa(kit, r):
    """The petrol-velvet sofa against the right wall, facing -x: a plinth on turned feet, a deep seat of three cushions, a rolled back and
    rolled arms, two scatter cushions."""
    D, Gd = kit.D, kit.G
    x0, x1, z0, z1 = r["x0"], r["x1"], r["z0"], r["z1"]
    for (x, z) in ((x0 + 0.06, z0 + 0.06), (x0 + 0.06, z1 - 0.06), (x1 - 0.06, z0 + 0.06), (x1 - 0.06, z1 - 0.06)):
        D.lathe([(0.025, 0.0), (0.03, 0.06), (0.02, 0.1)], C.seg(8, 5), C.OAK_DK, x, z, 0.0)
    C.soft_box(D, x0, x1, 0.1, 0.3, z0, z1, C.VELVET_UP, r=0.03)
    n = 3
    w = (z1 - z0 - 0.3) / n
    for k in range(n):
        C.soft_box(D, x0 + 0.02, x1 - 0.15, 0.3, 0.45, z0 + 0.15 + k * w + 0.01, z0 + 0.15 + (k + 1) * w - 0.01, C.VELVET_UP, r=0.05)
    C.soft_box(D, x1 - 0.18, x1, 0.3, 0.85, z0, z1, C.VELVET_UP, r=0.07)
    for zz in (z0, z1 - 0.16):
        C.soft_box(D, x0, x1 - 0.1, 0.3, 0.62, zz, zz + 0.16, C.VELVET_UP, r=0.07)
    for k, c in enumerate(("D8B25E", "E9DCC3")):
        n0 = len(D.polys)
        C.soft_box(D, x1 - 0.3, x1 - 0.16, 0.45, 0.78, z0 + 0.35 + k * (z1 - z0 - 0.9), z0 + 0.75 + k * (z1 - z0 - 0.9), S("LM_cafe_fabric", G.hexc(c)), r=0.06)


def wing_chair(kit, s):
    """A mustard-velvet wing armchair: turned legs, a box seat cushion, the tall back with its wings, rolled arms; facing s['faces']."""
    D = kit.D
    m = Mesh("wing")
    for (x, z) in ((-0.32, 0.26), (0.32, 0.26), (-0.32, -0.36), (0.32, -0.36)):
        m.lathe([(0.025, 0.0), (0.028, 0.06), (0.02, 0.12)], C.seg(8, 5), C.OAK_DK, x, z, 0.0)
    C.soft_box(m, -0.38, 0.38, 0.12, 0.36, -0.4, 0.3, C.MUSTARD, r=0.03)
    C.soft_box(m, -0.3, 0.3, 0.36, 0.44, -0.3, 0.3, C.MUSTARD, r=0.05)
    C.soft_box(m, -0.38, 0.38, 0.36, 1.1, -0.42, -0.26, C.MUSTARD, r=0.07)
    for sx in (-1, 1):
        C.soft_box(m, sx * 0.38 - (0.09 if sx > 0 else 0.0), sx * 0.38 + (0.0 if sx > 0 else 0.09), 0.36, 0.62, -0.3, 0.28, C.MUSTARD, r=0.05)
        C.soft_box(m, sx * 0.38 - (0.08 if sx > 0 else 0.0), sx * 0.38 + (0.0 if sx > 0 else 0.08), 0.62, 1.02, -0.4, -0.12, C.MUSTARD, r=0.05)
    yaw = {"in": 0.0, "out": math.pi, "left": -math.pi / 2, "right": math.pi / 2}[s["faces"]]
    for p in m.polys:
        D.polys.append(G.Poly([G.rot_y(q, yaw, s["x"], 0.0, s["z"]) for q in p.pts], p.uv, p.col, p.mat, p.smooth))


def sideboard(kit, r):
    """The pâtisserie sideboard on the back wall (under the windows): a cream-lacquered cabinet with an oak top, cakes under glass
    cloches, a tiered stand of macarons, a teapot and cups."""
    S_, Gd = kit.S, kit.G
    x0, x1, z0, z1 = r["x0"], r["x1"], r["z0"], r["z1"]
    S_.box(x0, x1, 0.0, 0.8, z0, z1, C.PAINT, skip=("-y", "+z"))
    for k in range(4):
        a, b = x0 + k * (x1 - x0) / 4 + 0.03, x0 + (k + 1) * (x1 - x0) / 4 - 0.03
        kit.D.box(a, b, 0.1, 0.72, z0 - 0.015, z0, C.PAINT)
        kit.D.box(a + 0.05, b - 0.05, 0.16, 0.66, z0 - 0.025, z0 - 0.015, C.PAINT)
        kit.D.sphere((a + b) / 2, 0.6, z0 - 0.04, 0.015, C.BRASS, n=8, rings=5)
    n0 = len(S_.polys)
    S_.cbox(x0 - 0.02, x1 + 0.02, 0.8, 0.84, z0 - 0.03, z1, C.ART, c=0.006) if not PHONE else S_.box(x0 - 0.02, x1 + 0.02, 0.8, 0.84, z0 - 0.03, z1, C.ART)
    C.remap(S_, n0, "marble_green")
    y = 0.84
    for (x, top, h) in ((x0 + 0.5, "cake_berry", 0.08), (x0 + 1.5, "cake_choc", 0.07), (x1 - 0.5, "cake_lemon", 0.06)):
        ys = C.cake_stand(Gd, x, y, (z0 + z1) / 2, r=0.14, h=0.09)
        C.cake(Gd, x, ys, (z0 + z1) / 2, 0.11, h, top, (0.98, 0.95, 0.9) if top != "cake_choc" else (0.22, 0.12, 0.07), cut=(top == "cake_choc"))
    # a three-tier stand of macarons and petits fours
    cx, cz = x0 + 2.6, (z0 + z1) / 2
    Gd.tube([(cx, y, cz), (cx, y + 0.42, cz)], 0.006, 6, C.BRASS)
    cols = [(0.96, 0.72, 0.78), (0.78, 0.89, 0.69), (0.96, 0.87, 0.54), (0.78, 0.72, 0.9), (0.95, 0.76, 0.6)]
    for k, (rr, yy) in enumerate(((0.15, 0.02), (0.11, 0.17), (0.08, 0.31))):
        C.plate(Gd, cx, y + yy, cz, rr)
        if not PHONE:
            cnt = int(2 * math.pi * rr * 0.7 / 0.05)
            for i in range(cnt):
                a = 2 * math.pi * i / cnt
                C.macaron(Gd, cx + math.cos(a) * rr * 0.7, y + yy + 0.008, cz + math.sin(a) * rr * 0.7, cols[(i + k) % 5])
    # a teapot and two cups
    n0 = len(Gd.polys)
    Gd.lathe([(0.0, 0.0), (0.06, 0.0), (0.085, 0.05), (0.08, 0.1), (0.05, 0.13), (0.03, 0.14), (0.035, 0.155), (0.0, 0.16)], C.seg(16, 10), C.ART, x1 - 1.4, (z0 + z1) / 2, y)
    Gd.tube([(x1 - 1.32, y + 0.04, (z0 + z1) / 2), (x1 - 1.27, y + 0.09, (z0 + z1) / 2), (x1 - 1.25, y + 0.13, (z0 + z1) / 2)], 0.01, 6, C.ART)
    C.glaze(Gd, n0, (0.98, 0.97, 0.94))
    for k in range(2):
        C.cup(Gd, x1 - 1.15 + k * 0.14, y, (z0 + z1) / 2 + 0.05, coffee=False)


def bookcase(kit, r):
    """An oak bookcase against the left wall: five shelves of books (atlas spines), a few lying flat, a small plant."""
    S_, Gd = kit.S, kit.G
    x0, x1, z0, z1 = r["x0"], r["x1"], r["z0"], r["z1"]
    S_.box(x0, x1, 0.0, 2.4, z0, z0 + 0.03, C.OAK_DK, skip=("-x",))
    S_.box(x0, x1, 0.0, 2.4, z1 - 0.03, z1, C.OAK_DK, skip=("-x",))
    S_.box(x0, x1, 2.36, 2.4, z0, z1, C.OAK_DK, skip=("-x",))
    rg = G.rng(77)
    for k, y in enumerate((0.0, 0.46, 0.92, 1.38, 1.84)):
        kit.D.box(x0 + 0.02, x1, y, y + 0.03, z0 + 0.03, z1 - 0.03, C.OAK)
        if PHONE and k % 2:
            continue
        zz = z0 + 0.05
        while zz < z1 - 0.1:
            t = 0.025 + rg.random() * 0.025
            h = 0.22 + rg.random() * 0.12
            k2 = rg.randrange(16)
            sub = (k2 / 16, 0.0, (k2 + 1) / 16, 1.0)
            Gd.box(x0 + 0.04, x1 - 0.02, y + 0.03, y + 0.03 + h, zz, zz + t, C.PAINT.t((0.9, 0.86, 0.78)), skip=("-y",))
            u0, u1, v0, v1 = C.cuv("spines", sub=sub, inset=1)
            q = [(x1 - 0.019, y + 0.03, zz + t), (x1 - 0.019, y + 0.03, zz), (x1 - 0.019, y + 0.03 + h, zz), (x1 - 0.019, y + 0.03 + h, zz + t)]
            Gd.poly(q, C.ART, uv=[(u0, v0), (u1, v0), (u1, v1), (u0, v1)])
            zz += t + 0.003


def mirror(kit, f, uc, vc, w=0.9, h=1.2):
    """A gilt overmantel mirror (its glass the room's window glass: the game's glass, a faint reflection)."""
    D = kit.D
    u0, u1, v0, v1 = uc - w / 2, uc + w / 2, vc - h / 2, vc + h / 2
    fw = 0.07
    for (a, b, c_, d_) in ((u0 - fw, u1 + fw, v0 - fw, v0), (u0 - fw, u1 + fw, v1, v1 + fw), (u0 - fw, u0, v0, v1), (u1, u1 + fw, v0, v1)):
        f.box(D, a, b, c_, d_, 0.0, 0.05, C.GILT, c=0.012 if not PHONE else 0.0, skip=("-w",))
    f.box(D, u0, u1, v0, v1, 0.0, 0.012, C.CHROME.t(G.hexc("C9CED2")), skip=("-w",))
    # a cartouche on top
    p = f.p(uc, v1 + fw + 0.06, 0.02)
    D.sphere(p[0], p[1], p[2], 0.07, C.GILT, n=C.seg(10, 6), rings=6, sy=0.6)
