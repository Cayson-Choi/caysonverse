"""케이슨 마을 도서관 (lot_library, plot_w, door east) — the kit, pure python on b1_geom / b1_parts, in the lot's LOCAL frame
(contract 1: x = the right hand of someone walking in at the main door, y up, z out of the front; the body is x -10..4,
z -7.5..3.5; the pergola reading garden x 4.4..9.6 on the right = world north; the front apron z 3.5..7.5).

Reference (design 3.3, shots/lot_library/SOURCES_lot_library.md): an English village library / a small Carnegie library —
warm red brick with honey limestone dressings (plinth, bands, quoins, arches with keystones, the door surround), tall
round-arched windows with white glazing bars (Fulbourn), a central pedimented entrance with a carved frieze (Danville
Carnegie), a slate roof with a glazed lantern cupola, two bay windows that are cushioned reading nooks you see through the
glass, a timber pergola with wisteria and benches on the garden side (Hampstead Pergola). Brand-new: crisp joints, clean stone.
"""
import math

import b1_geom as G
import b1_parts as P
from b1_geom import Mesh, S

LOT = "lot_library"
BRICK = S("LM_library_brick")                               # brick_red
STONE = S("LM_library_stone")                               # stone_ashlar (honey limestone)
STONE_L = S("LM_library_stone", G.hexc("FFF8EC"))
SLATE = S("LM_library_roof", G.hexc("F5E2B4"))              # roof_clay_tile, orange (owner 2026-11-17 Colmar reference)
GABLE = S("LM_library_plaster", G.hexc("F8E3BC"))           # the gables' pastel render infill between the timbers
TIMBER = S("LM_library_oak", G.hexc("7A4A33"))              # half-timbering (oak, dark oxblood-brown)
PAINT = S("LM_library_paint")                               # wood_painted (white)
IRONP = S("LM_library_paint", G.hexc("2E3A33"))             # painted cast iron (lamps, gutters, book return): dark green-black
LEADP = S("LM_library_paint", G.hexc("8C96A0"))             # lead-grey painted cap / flashing
GOLD = S("LM_library_paint", G.hexc("E2BE62"))
GREENP = S("LM_library_paint", G.hexc("3F6B52"))
OAK = S("LM_library_oak", G.hexc("E6D2B4"))                 # wood_oak: pergola, shelves, seats
OAK_DOOR = S("LM_library_oak", G.hexc("8E5B37"))
OAK_DK = S("LM_library_oak", G.hexc("B48A62"))
FLOOR = S("LM_library_floor")                               # floor_wood
PLASTER = S("LM_library_plaster", G.hexc("F4EBDD"))         # plaster_painted (rooms behind the glass)
WHITE_R = S("LM_library_plaster", G.hexc("FFFDF8"))          # white painted render: soffits, fascias, the lantern's base
FAB = S("LM_library_fabric")                                # fabric_upholstery (cushions, blankets, book cloth, foliage)
GRAN = S("LM_library_granite")                              # granite_flamed (steps, thresholds, edging)
GLASS = P.GLASS

MATS = {
    "LM_library_brick": {"set": "brick_red"},
    "LM_library_stone": {"set": "stone_ashlar"},
    "LM_library_roof": {"set": "roof_clay_tile"},
    "LM_library_paint": {"set": "wood_painted", "normal": 0.6},
    "LM_library_oak": {"set": "wood_oak", "rough": 0.9},
    "LM_library_floor": {"set": "floor_wood"},
    "LM_library_plaster": {"set": "plaster_painted"},
    "LM_library_fabric": {"set": "fabric_upholstery"},
    "LM_library_granite": {"set": "granite_flamed"},
    "M_glass": {"glass": True},
}
PREVIEW = {
    "PV_grass": {"set": "grass"},
    "PV_pavers": {"set": "brick_red"},
    "PV_gravel": {"set": "gravel"},
    "PV_lane": {"set": "dirt_path"},
}

EAVE = 5.6
RIDGE = 9.6
INSET = 0.10
FZ = 3.5 - INSET        # front wall face
BZ = -7.5 + INSET       # back wall face
LX = -10.0 + INSET      # left (south) wall face
RX = 4.0 - INSET        # right (north, garden) wall face
RZ = -2.0               # ridge line
PITCH = (RIDGE - EAVE) / 5.5
EAVE_Z = 3.75           # front eave (overhang 0.25 past the body)
EAVE_Y = RIDGE - PITCH * (EAVE_Z - RZ)
DOOR_X = -3.0
GX = 2.0                # front gable half width (x -5..-1)
GAPEX = 8.5
GP = (GAPEX - EAVE) / GX


def roof_y(z):
    return RIDGE - PITCH * abs(z - RZ)


# fabric tints: book cloths, cushions, the blanket, foliage
BOOK_COLS = ["7A2E2E", "2F4B6E", "3E6B4A", "8C6A2E", "5A3A62", "B5502F", "2B5C5E", "6B2B3A", "C9A24A", "34495E", "7D5A44", "9B3D3D"]
# foliage and petals on the (light) plaster set: its fine relief reads as leaf mass; fabric is for cloth only
LEAF = S("LM_library_plaster", G.hexc("8FBF63"))
LEAF_DK = S("LM_library_plaster", G.hexc("6FA24E"))
WIST = S("LM_library_plaster", G.hexc("E6D6FA"))
LAV = S("LM_library_plaster", G.hexc("A28CE0"))


def build(lot, layout):
    kit = P.Kit(lot)
    kit.mats = dict(MATS)
    kit.mats.update(PREVIEW)
    body(kit)
    roof(kit)
    cupola(kit)
    entrance(kit)
    windows(kit)
    bays(kit)
    pergola(kit)
    forecourt(kit)
    ground(kit)
    kit.roof_slabs = [{"rect": [4.4, 9.6, -5.9, 3.4], "minY": 2.7, "topY": 3.2, "what": "pergola beams (underside 2.70)"}]
    return kit


def fronts():
    return {
        "front": P.F((0.0, 0.0, FZ), (1, 0, 0), (0, 0, 1)),
        "back": P.F((-3.0, 0.0, BZ), (-1, 0, 0), (0, 0, -1)),
        "right": P.F((RX, 0.0, RZ), (0, 0, -1), (1, 0, 0)),
        "left": P.F((LX, 0.0, RZ), (0, 0, 1), (-1, 0, 0)),
    }


# openings
BAYS = [-7.1, 1.1]           # bay windows (front), opening 2.6 wide, 0 .. 3.3
BAY_OPEN = 2.6
ARCH_W, ARCH_SILL, ARCH_H = 2.3, 0.85, 4.2   # the three big arched windows on the garden side (u along that wall)
ARCH_U = [-3.2, 0.0, 3.2]
LEFT_U = [-3.2, 0.0, 3.2]     # three matching arched windows on the south side
BACK_U = [-5.5, 2.5]          # small arched windows either side of the fireplace chimney (back)


def body(kit):
    S_, D = kit.S, kit.D
    F = fronts()
    # walls: brick from the ground (the stone plinth stands in front, detail)
    front_holes = [(x - BAY_OPEN / 2, x + BAY_OPEN / 2, 0.0, 3.3) for x in BAYS] + [(DOOR_X - 1.1, DOOR_X + 1.1, 0.0, 3.4)]
    P.wall(S_, F["front"], -10.0 + INSET, 4.0 - INSET, 0.0, EAVE, front_holes, BRICK)
    for side, us in (("right", ARCH_U), ("left", LEFT_U)):
        holes = [(u - ARCH_W / 2, u + ARCH_W / 2, ARCH_SILL, ARCH_SILL + ARCH_H) for u in us]
        P.wall(S_, F[side], -5.4, 5.4, 0.0, EAVE, holes, BRICK)
        for u in us:
            P.arch_spandrels(S_, F[side], u, ARCH_W, ARCH_SILL + ARCH_H - ARCH_W / 2, BRICK)
    back_holes = [(u - 1.0, u + 1.0, 1.0, 3.6) for u in BACK_U]
    P.wall(S_, F["back"], -6.9, 6.9, 0.0, EAVE, back_holes, BRICK)
    for u in BACK_U:
        P.arch_spandrels(S_, F["back"], u, 2.0, 2.6, BRICK)
    # gable ends (left / right) above the eaves: brick triangles with a stone coping line
    for side in ("right", "left"):
        f = F[side]
        f.poly(S_, [(-5.4, EAVE, 0), (5.4, EAVE, 0), (0.0, RIDGE - 0.05, 0)], GABLE)
        roundel(kit, f, 0.0, 7.2, 0.5, glass=True)
        P.gable_timber(D, f, 0.0, 5.4, EAVE, RIDGE - 0.05, TIMBER, 7.95, skip=(6.7, 7.7))
    # the front gable over the entrance (x -5..-1), brick, its stone coping in the roof
    F["front"].poly(S_, [(DOOR_X - GX, EAVE, 0), (DOOR_X + GX, EAVE, 0), (DOOR_X, GAPEX - 0.04, 0)], GABLE)
    roundel(kit, F["front"], DOOR_X, 6.75, 0.42, glass=True)
    P.gable_timber(D, F["front"], DOOR_X, GX, EAVE, GAPEX - 0.04, TIMBER, 7.45, skip=(6.3, 7.2))
    # limestone plinth (flush with the body box), string course at 3.9, eaves band, quoins at the corners
    for f, a, b, skip_door in ((F["front"], -10.0, 4.0, True), (F["back"], -7.0, 7.0, False), (F["right"], -5.5, 5.5, False), (F["left"], -5.5, 5.5, False)):
        segs = [(a, DOOR_X - 1.1), (DOOR_X + 1.1, b)] if skip_door else [(a, b)]
        if f is F["front"]:
            segs = [(a, BAYS[0] - BAY_OPEN / 2), (BAYS[0] + BAY_OPEN / 2, DOOR_X - 1.1), (DOOR_X + 1.1, BAYS[1] - BAY_OPEN / 2), (BAYS[1] + BAY_OPEN / 2, b)]
        for s0, s1 in segs:
            f.box(D, s0, s1, 0.0, 0.6, -0.05, INSET, STONE, skip=("-v", "-w"))
            f.box(D, s0, s1, 0.6, 0.68, -0.05, INSET - 0.04, STONE_L, skip=("-v", "-w"))
    for f, a, b in ((F["front"], -9.9, 3.9), (F["back"], -6.9, 6.9), (F["right"], -5.4, 5.4), (F["left"], -5.4, 5.4)):
        f.box(D, a - 0.04, b + 0.04, EAVE - 0.42, EAVE - 0.18, 0.0, 0.08, STONE_L, skip=("-w",))
    for f, a, b in ((F["front"], -9.9, 3.9), (F["right"], -5.4, 5.4), (F["left"], -5.4, 5.4)):
        if f is F["front"]:
            for s0, s1 in ((a, BAYS[0] - BAY_OPEN / 2 - 0.05), (BAYS[1] + BAY_OPEN / 2 + 0.05, b)):
                f.box(D, s0, s1, 3.85, 4.0, 0.0, 0.06, STONE_L, skip=("-w",))
        else:
            f.box(D, a, b, 3.85, 4.0, 0.0, 0.06, STONE_L, skip=("-w",))
    for f, (ua, ub) in ((F["front"], (-9.9, 3.9)), (F["back"], (-6.9, 6.9))):
        for u in (ua, ub):
            sgn = 1 if u > 0 else -1
            for k in range(9):
                v0 = 0.7 + k * 0.52
                if v0 + 0.44 > EAVE - 0.45:
                    break
                wq = 0.48 if k % 2 == 0 else 0.3
                u0, u1 = (u - wq, u) if (sgn > 0) == (f is F["front"]) else (u, u + wq)
                if f is F["back"]:
                    u0, u1 = (u - wq, u) if sgn > 0 else (u, u + wq)
                f.box(D, u0, u1, v0, v0 + 0.44, 0.0, 0.035, STONE_L, skip=("-w",))
    # the fireplace chimney on the back wall: a brick stack rising through the roof, stone cap, two clay pots
    S_.box(-7.0, -5.6, roof_y(-6.6) - 0.3, RIDGE + 0.9, -7.2, -5.9, BRICK, skip=("-y",))
    D.box(-7.1, -5.5, RIDGE + 0.9, RIDGE + 1.05, -7.3, -5.8, STONE_L)
    for dx in (-6.6, -6.0):
        S_.lathe([(0.12, 0.0), (0.1, 0.3), (0.13, 0.34), (0.0, 0.34)], 6, BRICK.t(G.hexc("E69A7A")), dx, -6.55, RIDGE + 1.05)
    # cast downpipes at the front corners (painted dark green), hoppers
    for u in (-9.62, 3.62):
        p0 = F["front"].p(u, 0.68, 0.055)
        p1 = F["front"].p(u, EAVE - 0.3, 0.055)
        D.member(p0, p1, G.prof_round(0.042, 8), IRONP)
        F["front"].box(D, u - 0.1, u + 0.1, EAVE - 0.4, EAVE - 0.2, 0.0, 0.1, IRONP, skip=("-w",))


def roundel(kit, f, uc, vc, r, glass=False):
    D = kit.D
    n = 16
    ring = [(uc + r * math.cos(2 * math.pi * i / n), vc + r * math.sin(2 * math.pi * i / n)) for i in range(n)]
    inner = [(uc + (r - 0.14) * math.cos(2 * math.pi * i / n), vc + (r - 0.14) * math.sin(2 * math.pi * i / n)) for i in range(n)]
    for i in range(n):
        j = (i + 1) % n
        f.poly(D, [(ring[i][0], ring[i][1], 0.06), (ring[j][0], ring[j][1], 0.06), (inner[j][0], inner[j][1], 0.06), (inner[i][0], inner[i][1], 0.06)], STONE_L)
        f.poly(D, [(ring[i][0], ring[i][1], 0.0), (ring[j][0], ring[j][1], 0.0), (ring[j][0], ring[j][1], 0.06), (ring[i][0], ring[i][1], 0.06)], STONE_L, out=0)
    f.poly(D, [(p[0], p[1], 0.02) for p in inner], GLASS if glass else BRICK.t(G.hexc("D9C2A6")))
    if glass:
        D.member(f.p(uc - r + 0.14, vc, 0.03), f.p(uc + r - 0.14, vc, 0.03), G.prof_box(0.03, 0.03), PAINT)
        D.member(f.p(uc, vc - r + 0.14, 0.03), f.p(uc, vc + r - 0.14, 0.03), G.prof_box(0.03, 0.03), PAINT)
        kit.glow("windows").poly([f.p(p[0], p[1], 0.0) for p in inner], GLASS.t(P.WARM))


# ------------------------------------------------------------------------------------------------ roof --

def roof(kit):
    S_, D = kit.S, kit.D
    EZ, EY = EAVE_Z, EAVE_Y
    BACK_Y = roof_y(-7.5)
    xl, xr = -10.0, 4.0          # verges flush with the body box (left = footprint edge); right gets a 0.25 overhang
    xr2 = 4.25
    xg = (GAPEX - EY) / GP       # where the front gable's planes meet the main eave
    valley_top = (DOOR_X, GAPEX, RZ + (RIDGE - GAPEX) / PITCH)
    front = [(xl, EY, EZ), (DOOR_X - xg, EY, EZ), valley_top, (DOOR_X + xg, EY, EZ), (xr2, EY, EZ), (xr2, RIDGE, RZ), (xl, RIDGE, RZ)]
    S_.poly(front, SLATE)
    S_.poly([(xr2, BACK_Y, -7.5), (xl, BACK_Y, -7.5), (xl, RIDGE, RZ), (xr2, RIDGE, RZ)], SLATE)
    gz = EZ + 0.1
    S_.poly([(DOOR_X, GAPEX, gz), (DOOR_X - xg, EY, gz), (DOOR_X - xg, EY, EZ), valley_top], SLATE)
    S_.poly([(DOOR_X + xg, EY, gz), (DOOR_X, GAPEX, gz), valley_top, (DOOR_X + xg, EY, EZ)], SLATE)
    # front gable stone coping (parapet-style, on the verges)
    for sx in (-1, 1):
        a = (DOOR_X + sx * (xg + 0.05), EY - 0.05, gz + 0.02)
        b = (DOOR_X, GAPEX + 0.08, gz + 0.02)
        D.member(a, b, G.prof_box(0.06, 0.3), STONE_L)
    D.lathe([(0.1, 0.0), (0.12, 0.08), (0.06, 0.2), (0.1, 0.32), (0.0, 0.45)], 6, STONE_L, DOOR_X, gz + 0.02, GAPEX + 0.12)
    # fascia + soffit (white) at the front eave, gutters (painted cast iron ogee) front and back
    S_.box(xl, xr2, EY - 0.2, EY + 0.02, EZ - 0.03, EZ, WHITE_R, skip=("-y", "+y", "-z"))
    S_.poly([(xl, EY - 0.2, EZ), (xr2, EY - 0.2, EZ), (xr2, EY - 0.2, FZ), (xl, EY - 0.2, FZ)], WHITE_R)
    S_.box(xl, xr2, BACK_Y - 0.24, BACK_Y + 0.02, -7.5, -7.46, WHITE_R, skip=("+z", "-y", "+y"))
    D.member((xl, EY - 0.1, EZ + 0.07), (xr2, EY - 0.1, EZ + 0.07), [(0.07 * math.cos(math.pi + math.pi * i / 5), 0.07 * math.sin(math.pi + math.pi * i / 5)) for i in range(6)] + [(0.07, 0.03), (-0.07, 0.03)], IRONP)
    # verge: left gable flush (stone coping on the gable wall), right gable overhang with white barge boards
    for (za, ya, zb, yb) in ((EZ, EY, RZ, RIDGE), (RZ, RIDGE, -7.5, BACK_Y)):
        za2 = max(za, -7.45) if za < -7 else za
        zb2 = max(zb, -7.45)
        D.member((xl + 0.17, ya + 0.02 - (0.0 if za2 == za else PITCH * 0.05), za2), (xl + 0.17, yb + 0.02 + (PITCH * 0.05 if zb2 != zb else 0.0), zb2), G.prof_box(0.3, 0.1), STONE_L)
        q = [(xr2, ya - 0.24, za), (xr2, yb - 0.24, zb), (xr2, yb + 0.02, zb), (xr2, ya + 0.02, za)]
        if G.poly_normal(q)[0] < 0:
            q.reverse()
        S_.poly(q, WHITE_R)
        S_.poly([(xr, ya - 0.24, za), (xr2, ya - 0.24, za), (xr2, yb - 0.24, zb), (xr, yb - 0.24, zb)], WHITE_R)
    # ridge: lead-grey roll along the ridge (structure)
    D.member((xl, RIDGE + 0.04, RZ), (xr2, RIDGE + 0.04, RZ), [(0.08 * math.cos(math.pi * i / 4), 0.07 * math.sin(math.pi * i / 4)) for i in range(5)], SLATE.t(G.hexc("7E8A96")))
    # two small slate-hung dormers? no: the lantern carries the roofline


def cupola(kit):
    """The lantern cupola on the ridge over the entrance axis (top 11.5): a square slate-hung base, an octagonal glazed lantern
    with white posts, a lead-grey ogee cap, a gilded ball finial. At night the lantern glows (the reading room's light)."""
    S_, D = kit.S, kit.D
    cx, cz = DOOR_X, RZ
    S_.box(cx - 0.75, cx + 0.75, RIDGE - 0.6, RIDGE + 0.45, cz - 0.75, cz + 0.75, WHITE_R, skip=("-y",))
    S_.box(cx - 0.85, cx + 0.85, RIDGE + 0.45, RIDGE + 0.55, cz - 0.85, cz + 0.85, WHITE_R)
    n = 8
    r = 0.62
    y0, y1 = RIDGE + 0.55, RIDGE + 1.45
    for i in range(n):
        a0 = 2 * math.pi * i / n + math.pi / 8
        a1 = 2 * math.pi * (i + 1) / n + math.pi / 8
        p0 = (cx + r * math.cos(a0), cz - r * math.sin(a0))
        p1 = (cx + r * math.cos(a1), cz - r * math.sin(a1))
        S_.poly([(p0[0], y0, p0[1]), (p1[0], y0, p1[1]), (p1[0], y1, p1[1]), (p0[0], y1, p0[1])][::-1], GLASS)
        D.member((p0[0], y0, p0[1]), (p0[0], y1, p0[1]), G.prof_box(0.06, 0.06), PAINT)
        D.member((p0[0], y0 + 0.5, p0[1]), (p1[0], y0 + 0.5, p1[1]), G.prof_box(0.025, 0.03), PAINT)
    S_.lathe([(r + 0.12, 0.0), (r + 0.12, 0.1), (r + 0.04, 0.12), (0.0, 0.12)], 8, WHITE_R, cx, cz, y1, phase=math.pi / 8, smooth=False)
    S_.lathe([(r + 0.05, 0.0), (r - 0.05, 0.12), (0.32, 0.32), (0.16, 0.48), (0.07, 0.6), (0.0, 0.62)], 8, SLATE.t(G.hexc("8E9AA6")), cx, cz, y1 + 0.12, phase=math.pi / 8)
    D.sphere(cx, 11.32, cz, 0.1, GOLD, n=8, rings=5)
    D.member((cx, 11.4, cz), (cx, 11.5, cz), G.prof_round(0.015, 5), GOLD)
    g = kit.glow("lantern")
    g.lathe([(0.0, 0.0), (r - 0.06, 0.02), (r - 0.06, 0.85), (0.0, 0.88)], 8, GLASS.t(P.WARM), cx, cz, y0 + 0.02)
    kit.lights.append(("point", cx, y0 + 0.5, cz, (1.0, 0.82, 0.55), 80.0))


# ------------------------------------------------------------------------------------------------ entrance --

def entrance(kit):
    """The pedimented stone frontispiece: Tuscan pilasters (projecting 8 cm, inside the body box) either side of panelled oak
    double doors with a fanlight, an entablature with the carved frieze "케이슨 마을 도서관" (slot nameplate at 4.3), a
    triangular pediment, granite steps-free threshold (walk plane y 0), carriage lamps; the vestibule behind the leaves."""
    D, S_ = kit.D, kit.S
    f = fronts()["front"]
    dz = FZ - 0.24
    P.double_door(kit, "lot_library_main", DOOR_X, dz, 2.2, 3.4, OAK_DOOR, PAINT, GOLD)
    # door reveals (stone)
    for (u, sgn) in ((DOOR_X - 1.1, 1), (DOOR_X + 1.1, -1)):
        q = [f.p(u, 0.0, 0.0), f.p(u, 3.4, 0.0), f.p(u, 3.4, -0.3), f.p(u, 0.0, -0.3)]
        if G.dot(G.poly_normal(q), G.mul(f.U, sgn)) < 0:
            q.reverse()
        D.poly(q, STONE)
    q = [f.p(DOOR_X - 1.1, 3.4, 0.0), f.p(DOOR_X + 1.1, 3.4, 0.0), f.p(DOOR_X + 1.1, 3.4, -0.3), f.p(DOOR_X - 1.1, 3.4, -0.3)]
    if G.poly_normal(q)[1] > 0:
        q.reverse()
    D.poly(q, STONE)
    # pilasters with bases and capitals
    for u in (DOOR_X - 1.55, DOOR_X + 1.55):
        f.box(D, u - 0.28, u + 0.28, 0.0, 3.55, 0.0, 0.08, STONE_L, skip=("-w",))
        f.box(D, u - 0.34, u + 0.34, 0.0, 0.35, 0.0, 0.1, STONE_L, c=0.02, skip=("-w", "-v"))
        f.box(D, u - 0.34, u + 0.34, 3.55, 3.75, 0.0, 0.1, STONE_L, c=0.02, skip=("-w",))
        for k in range(3):
            uu = u - 0.16 + k * 0.16
            f.box(D, uu - 0.03, uu + 0.03, 0.45, 3.45, 0.08, 0.095, STONE_L, skip=("-w", "-v", "+v"))
    # entablature with the frieze board and the carved letters (sunk look: a recessed panel with raised letters)
    f.box(D, DOOR_X - 1.95, DOOR_X + 1.95, 3.75, 4.75, 0.0, 0.1, STONE_L, skip=("-w",))
    f.box(D, DOOR_X - 2.05, DOOR_X + 2.05, 4.75, 4.9, 0.0, 0.16, STONE_L, c=0.02, skip=("-w",))
    f.box(D, DOOR_X - 1.75, DOOR_X + 1.75, 4.08, 4.52, 0.1, 0.105, STONE.t(G.hexc("E9D8BE")), skip=("-w",))
    kit.letters.append(("케이슨 마을 도서관", (DOOR_X, 4.17, FZ + 0.105), (0, 0, 1), 0.25, 0.03, GOLD, "D"))
    # pediment (triangle, stone), its raking cornices
    ped = [(DOOR_X - 2.05, 4.9), (DOOR_X + 2.05, 4.9), (DOOR_X, 5.75)]
    f.poly(D, [(u, v, 0.1) for u, v in ped], STONE_L)
    for sx in (-1, 1):
        D.member(f.p(DOOR_X + sx * 2.15, 4.92, 0.13), f.p(DOOR_X, 5.82, 0.13), G.prof_box(0.06, 0.14), STONE_L)
    # fanlight in the door head: the door is 3.4 high; the top 0.6 of the opening is a glazed fanlight over a transom
    # (part of the leaves' glazed top panels) — a radial bar ornament on the inside of the head
    # vestibule behind the doors (floor, walls, inner glazed doors, glow)
    vz0, vz1 = FZ - 0.32, FZ - 2.5
    D.box(DOOR_X - 1.45, DOOR_X + 1.45, -0.05, 0.0, vz1, vz0, FLOOR, skip=("-y",))
    for x, sgn in ((DOOR_X - 1.45, 1), (DOOR_X + 1.45, -1)):
        q = [(x, 0.0, vz0), (x, 0.0, vz1), (x, 3.8, vz1), (x, 3.8, vz0)]
        if G.dot(G.poly_normal(q), (sgn, 0, 0)) < 0:
            q.reverse()
        D.poly(q, PLASTER)
    D.poly([(DOOR_X - 1.45, 0.0, vz1), (DOOR_X + 1.45, 0.0, vz1), (DOOR_X + 1.45, 3.8, vz1), (DOOR_X - 1.45, 3.8, vz1)], PLASTER)
    D.poly([(DOOR_X - 1.45, 3.8, vz0), (DOOR_X + 1.45, 3.8, vz0), (DOOR_X + 1.45, 3.8, vz1), (DOOR_X - 1.45, 3.8, vz1)][::-1], PLASTER)
    D.box(DOOR_X - 0.8, DOOR_X + 0.8, 0.0, 2.7, vz1, vz1 + 0.05, OAK_DOOR)
    D.box(DOOR_X - 0.65, DOOR_X + 0.65, 0.9, 2.55, vz1 + 0.05, vz1 + 0.06, GLASS)
    kit.glow("windows").poly([(DOOR_X - 1.4, 0.2, vz1 + 0.02), (DOOR_X + 1.4, 0.2, vz1 + 0.02), (DOOR_X + 1.4, 3.6, vz1 + 0.02), (DOOR_X - 1.4, 3.6, vz1 + 0.02)], GLASS.t(P.WARM))
    D.cbox(DOOR_X - 1.1, DOOR_X + 1.1, 0.0, 0.02, FZ - 0.3, FZ + 0.1, GRAN, c=0.005)
    # carriage lamps on brackets either side of the door (above 2.2 m)
    for u in (DOOR_X - 2.25, DOOR_X + 2.25):
        p = f.p(u, 2.75, 0.0)
        D.member(f.p(u, 2.75, 0.02), f.p(u, 2.75, 0.28), G.prof_box(0.03, 0.03), IRONP)
        c = f.p(u, 2.55, 0.28)
        D.box(c[0] - 0.11, c[0] + 0.11, c[1] - 0.18, c[1] - 0.15, c[2] - 0.11, c[2] + 0.11, IRONP)
        D.lathe([(0.11 * math.sqrt(2), 0.0), (0.0, 0.14)], 4, IRONP, c[0], c[2], c[1] + 0.2, phase=math.pi / 4, smooth=False)
        for (dx, dz2) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            D.member((c[0] + dx * 0.1, c[1] - 0.15, c[2] + dz2 * 0.1), (c[0] + dx * 0.1, c[1] + 0.2, c[2] + dz2 * 0.1), G.prof_box(0.018, 0.018), IRONP)
        kit.glow("lamps").lathe([(0.0, 0.0), (0.08, 0.02), (0.08, 0.3), (0.0, 0.32)], 6, GLASS.t(P.LAMP), c[0], c[2], c[1] - 0.14)
        D.lathe([(0.0, 0.0), (0.085, 0.02), (0.085, 0.3), (0.0, 0.32)], 6, GLASS, c[0], c[2], c[1] - 0.145)
        kit.lights.append(("point", c[0], c[1], c[2] + 0.1, (1.0, 0.85, 0.6), 60.0))


# ------------------------------------------------------------------------------------------------ windows --

def shelf_fill(depth_books=0.24, shelves=5, step=0.44):
    """Room fill behind a window: an oak bookcase across the back wall, five shelves of 3D books (instanced runs), a
    reading lamp's glow."""
    def fill(kit, f, ru0, ru1, rv0, rv1, wb, wg):
        D = kit.D
        y0 = max(rv0, 0.0)
        top = min(rv1 - 0.05, y0 + 3.6)
        w0, w1 = wb, wb + 0.32
        f.box(D, ru0 + 0.05, ru1 - 0.05, y0, top, w0, w1, OAK_DK, skip=("-w",))  # carcass back
        n = shelves
        for k in range(n + 1):
            v = y0 + 0.08 + k * (top - y0 - 0.16) / n
            f.box(D, ru0 + 0.05, ru1 - 0.05, v - 0.025, v, w0, w1 + 0.02, OAK_DK, skip=("-w", "-u", "+u"))
            if k < n:
                u = ru0 + 0.12
                while u < ru1 - 0.5:
                    p = f.p(u, v, w1 - 0.02)
                    yaw = math.atan2(f.U[0], f.U[2]) - math.pi / 2
                    kit.place("books_%d" % (k % 3), BOOK_RUNS[k % 3], p[0], p[1], p[2], yaw)
                    u += step
        for u in (ru0 + 0.05, ru1 - 0.08):
            f.box(D, u, u + 0.03, y0, top, w0, w1 + 0.02, OAK_DK, skip=("-w", "-v"))
    return fill


def book_run(seed, length=0.42):
    """A run of 3D books standing on a shelf, spines facing +z, origin at the run's left end, base y 0; front face, top,
    one side per book (the back never shows): varied heights, widths and cloth colours (fabric set, tinted)."""
    m = Mesh("books")
    rg = G.rng(seed)
    x = 0.0
    while x < length - 0.02:
        w = min(rg.uniform(0.025, 0.05), length - x)
        h = rg.uniform(0.2, 0.29)
        d = rg.uniform(0.16, 0.21)
        col = G.hexc(BOOK_COLS[rg.randrange(len(BOOK_COLS))])
        s = S("LM_library_paint", col)  # cloth-bound covers: the bright painted set takes the colours truly (fabric is too dark)
        m.poly([(x, 0.0, 0.0), (x + w, 0.0, 0.0), (x + w, h, 0.0), (x, h, 0.0)], s)
        m.poly([(x, h, 0.0), (x + w, h, 0.0), (x + w, h, -d), (x, h, -d)], PLASTER.t(G.hexc("F6EEDC")))

        x += w + rg.uniform(0.0, 0.004)
    return m


BOOK_RUNS = [book_run(11), book_run(23), book_run(37)]


def windows(kit):
    F = fronts()
    common = dict(paint=WHITE_R, stone=STONE_L, wall_s=BRICK, room_s=PLASTER)  # frames in the shell: painted (plaster set, white) to keep 4 shell draws
    for u in ARCH_U:
        P.sash_window(kit, F["right"], u, ARCH_SILL, ARCH_W, ARCH_H, cols=3, rows=4, arch=True, keystone=(0.2, STONE_L), fill=shelf_fill(shelves=4, step=0.5), lights=(u == 0.0), **common)
        arch_ring(kit, F["right"], u, ARCH_SILL + ARCH_H - ARCH_W / 2, ARCH_W)
    for u in LEFT_U:
        P.sash_window(kit, F["left"], u, ARCH_SILL, ARCH_W, ARCH_H, cols=3, rows=4, arch=True, keystone=(0.2, STONE_L), lights=False, **common)
        arch_ring(kit, F["left"], u, ARCH_SILL + ARCH_H - ARCH_W / 2, ARCH_W)
    for u in BACK_U:
        P.sash_window(kit, F["back"], u, 1.0, 2.0, 2.6, cols=2, rows=3, arch=True, keystone=(0.16, STONE_L), lights=False, **common)
        arch_ring(kit, F["back"], u, 2.6, 2.0)


def arch_ring(kit, f, uc, spring, w):
    """A limestone voussoir ring round an arched opening (structure), 0.22 deep band, 0.05 proud."""
    D = kit.D
    r0, r1 = w / 2, w / 2 + 0.24
    n = 9
    for i in range(n):
        a0, a1 = math.pi * i / n, math.pi * (i + 1) / n
        pts = [(uc - r0 * math.cos(a0), spring + r0 * math.sin(a0)), (uc - r1 * math.cos(a0), spring + r1 * math.sin(a0)),
               (uc - r1 * math.cos(a1), spring + r1 * math.sin(a1)), (uc - r0 * math.cos(a1), spring + r0 * math.sin(a1))]
        f.poly(D, [(u, v, 0.05) for u, v in pts], STONE_L if i % 2 == 0 else STONE)
        f.poly(D, [(pts[1][0], pts[1][1], 0.0), (pts[2][0], pts[2][1], 0.0), (pts[2][0], pts[2][1], 0.05), (pts[1][0], pts[1][1], 0.05)], STONE_L, out=0)
    # impost blocks at the springing
    for u in (uc - r0 - 0.12, uc + r0 + 0.12):
        f.box(D, u - 0.14, u + 0.14, spring - 0.18, spring, 0.0, 0.06, STONE_L, skip=("-w",))


# ------------------------------------------------------------------------------------------------ bays (reading nooks) --

def bays(kit):
    """Two canted bay windows (colliders bay_l / bay_r: x 3 m, out to z 4.4, camera 4.6): stone base, three lights with
    transoms and white frames, a stone cornice and a slate roof; inside, the reading nook — a cushioned window seat with
    bolsters and a folded blanket, piled books, a brass reading lamp, little shelves in the bay's sides, a bookcase wall
    behind (in the body). Lit at night."""
    S_, D, Gd = kit.S, kit.D, kit.G
    for i, xc in enumerate(BAYS):
        x0, x1 = xc - 1.5, xc + 1.5
        zb, zf = FZ, 4.3        # bay: wall face to front face
        cant = 0.55             # the canted sides' depth along x
        # plan polygon (outer): A (x0, zb) -> B (x0 + cant, zf) -> C (x1 - cant, zf) -> D (x1, zb)
        A, B, C, Dd = (x0 + 0.02, zb), (x0 + cant, zf), (x1 - cant, zf), (x1 - 0.02, zb)
        segs = [(A, B), (B, C), (C, Dd)]
        base_top, win_top, corn_top = 0.62, 3.25, 3.55
        for (p, q) in segs:
            L = math.dist(p, q)
            d = ((q[0] - p[0]) / L, (q[1] - p[1]) / L)
            out = (d[1], 0.0, -d[0])
            # stone base panel
            quad = [(p[0], 0.0, p[1]), (q[0], 0.0, q[1]), (q[0], base_top, q[1]), (p[0], base_top, p[1])]
            if G.dot(G.poly_normal(quad), out) < 0:
                quad.reverse()
            D.poly(quad, STONE)
            # glass (set back 6 cm) and the stone mullion posts at the corners
            inset = (-out[0] * 0.06, 0.0, -out[2] * 0.06)
            gq = [G.add((p[0], base_top, p[1]), inset), G.add((q[0], base_top, q[1]), inset), G.add((q[0], win_top, q[1]), inset), G.add((p[0], win_top, p[1]), inset)]
            if G.dot(G.poly_normal(gq), out) < 0:
                gq.reverse()
            S_.poly(gq, GLASS)
            # frames: sill, head, transom at 2.45, two mullions per light (white), outer frame posts
            sill_a, sill_b = (p[0] + out[0] * 0.03, p[1] + out[2] * 0.03), (q[0] + out[0] * 0.03, q[1] + out[2] * 0.03)
            D.member((sill_a[0], base_top + 0.03, sill_a[1]), (sill_b[0], base_top + 0.03, sill_b[1]), G.prof_box(0.12, 0.07), STONE_L)
            for v in (base_top + 0.08, 2.45, win_top - 0.04):
                a = G.add((p[0], v, p[1]), G.mul(inset, 0.3))
                b = G.add((q[0], v, q[1]), G.mul(inset, 0.3))
                D.member(a, b, G.prof_box(0.06, 0.06 if v != 2.45 else 0.08), PAINT)
            for t in (1 / 3, 2 / 3) if L > 1.2 else ():
                a = G.lerp((p[0], base_top + 0.08, p[1]), (q[0], base_top + 0.08, q[1]), t)
                b = G.lerp((p[0], win_top - 0.04, p[1]), (q[0], win_top - 0.04, q[1]), t)
                D.member(G.add(a, G.mul(inset, 0.3)), G.add(b, G.mul(inset, 0.3)), G.prof_box(0.04, 0.05), PAINT)
            # stone cornice band
            quad = [(p[0] + out[0] * 0.06, win_top, p[1] + out[2] * 0.06), (q[0] + out[0] * 0.06, win_top, q[1] + out[2] * 0.06),
                    (q[0] + out[0] * 0.06, corn_top, q[1] + out[2] * 0.06), (p[0] + out[0] * 0.06, corn_top, p[1] + out[2] * 0.06)]
            if G.dot(G.poly_normal(quad), out) < 0:
                quad.reverse()
            D.poly(quad, STONE_L)
        for pt in (B, C):
            D.member((pt[0], base_top, pt[1]), (pt[0], win_top, pt[1]), G.prof_box(0.12, 0.12), STONE_L)
        # cornice soffit, the slate roof (three hipped planes to the wall at 4.55), lead flashing line
        ring = [(A[0], A[1]), (B[0] + (-0.02 if True else 0), B[1] + 0.02), (C[0], C[1] + 0.02), (Dd[0], Dd[1])]
        top_y = 4.55
        apex_z = FZ
        roof_pts = [(A[0], corn_top, A[1]), (B[0], corn_top, B[1] + 0.06), (C[0], corn_top, C[1] + 0.06), (Dd[0], corn_top, Dd[1])]
        back = [(x0 + 0.5, top_y, apex_z), (x1 - 0.5, top_y, apex_z)]
        S_.poly([roof_pts[0], roof_pts[1], back[0]], SLATE)
        S_.poly([roof_pts[1], roof_pts[2], back[1], back[0]], SLATE)
        S_.poly([roof_pts[2], roof_pts[3], back[1]], SLATE)
        D.poly([roof_pts[0], back[0], back[1], roof_pts[3]][::-1] if False else [roof_pts[3], roof_pts[2], roof_pts[1], roof_pts[0]], STONE_L)
        D.member((back[0][0] - 0.05, top_y + 0.02, apex_z + 0.03), (back[1][0] + 0.05, top_y + 0.02, apex_z + 0.03), G.prof_box(0.1, 0.05), LEADP)
        # a geranium box along the bay's front cornice (above head height, inside the footprint)
        bxz = zf - 0.02
        Gd.box(B[0] + 0.05, C[0] - 0.05, corn_top, corn_top + 0.2, bxz - 0.22, bxz, GREENP, skip=("-y",))
        ff = P.F((0.0, 0.0, bxz - 0.11), (1, 0, 0), (0, 0, 1))
        P.flowers_row(kit, ff, B[0] + 0.12, C[0] - 0.12, corn_top + 0.17, 0.0, GERANIUMS, seed=int(xc * 10) + 3, step=0.19)
        # the nook inside the bay: floor (oak boards), the window seat box with a cushion, two bolsters, scatter cushions,
        # a folded blanket, a stack of books, a brass lamp on the seat's end; the side walls of the bay inside: small shelves
        D.poly([(A[0], 0.02, A[1] - 0.25), (Dd[0], 0.02, Dd[1] - 0.25), (C[0], 0.02, C[1] - 0.08), (B[0], 0.02, B[1] - 0.08)][::-1], FLOOR)
        D.box(B[0] - 0.1, C[0] + 0.1, 0.02, 0.42, FZ - 0.05, zf - 0.1, OAK, skip=("-y",))
        D.cbox(B[0] - 0.08, C[0] + 0.08, 0.42, 0.55, FZ - 0.02, zf - 0.12, S("LM_library_plaster", G.hexc("F4E6C8")), c=0.03)
        for (bx, col) in ((B[0] + 0.12, "6E8FAE"), (C[0] - 0.12, "6E8FAE")):
            D.member((bx, 0.65, FZ + 0.02), (bx, 0.65, zf - 0.18), G.prof_round(0.1, 8), S("LM_library_plaster", G.hexc("A9C6E4")), caps=True)
        for k, (cx, col) in enumerate(((xc - 0.35, "C96F5B"), (xc + 0.25, "E2B95A"))):
            D.cbox(cx - 0.2, cx + 0.2, 0.55, 0.92, zf - 0.32, zf - 0.17, S("LM_library_plaster", G.hexc(col)), c=0.06)
        D.cbox(xc + 0.35, xc + 0.85, 0.55, 0.62, FZ + 0.05, FZ + 0.45, FAB.t(G.hexc("7E9C7A")), c=0.02)
        for k in range(4):
            Gd.box(xc - 0.75 + 0.01 * k, xc - 0.45 + 0.012 * k, 0.55 + k * 0.04, 0.59 + k * 0.04, FZ + 0.12, FZ + 0.34, S("LM_library_paint", G.hexc(BOOK_COLS[(k + i * 3) % 12])))
        # a brass reading lamp standing at the seat's right end (on the floor inside the body, behind the seat)
        lx, lz = C[0] - 0.05, FZ - 0.15
        Gd.lathe([(0.12, 0.0), (0.12, 0.03), (0.02, 0.05), (0.018, 1.25), (0.0, 1.25)], 8, GOLD, lx, lz, 0.02)
        Gd.lathe([(0.18, 0.0), (0.1, 0.2), (0.0, 0.22)], 8, FAB.t(G.hexc("F2E6C9")), lx, lz, 1.2)
        kit.glow("nooks").lathe([(0.0, 0.0), (0.16, 0.02), (0.08, 0.18), (0.0, 0.2)], 6, GLASS.t(P.LAMP), lx, lz, 1.21)
        kit.lights.append(("point", lx, 1.25, lz + 0.1, (1.0, 0.8, 0.55), 35.0))
        kit.dayfill.append((xc, 2.6, FZ - 0.6, 2.5, 60.0))
        # behind the bay: the room (bookcase wall, ceiling, floor, side walls) inside the body
        rb = FZ - 1.25
        D.poly([(x0 - 0.1, 0.0, rb), (x1 + 0.1, 0.0, rb), (x1 + 0.1, 3.6, rb), (x0 - 0.1, 3.6, rb)], PLASTER)
        D.poly([(x0 - 0.1, 3.6, FZ - 0.1), (x1 + 0.1, 3.6, FZ - 0.1), (x1 + 0.1, 3.6, rb), (x0 - 0.1, 3.6, rb)][::-1], PLASTER.t(G.hexc("FBF5EA")))
        D.poly([(x0 - 0.1, 0.0, FZ - 0.1), (x1 + 0.1, 0.0, FZ - 0.1), (x1 + 0.1, 0.0, rb), (x0 - 0.1, 0.0, rb)], FLOOR)
        for (x, sgn) in ((x0 - 0.1, 1), (x1 + 0.1, -1)):
            q = [(x, 0.0, FZ - 0.1), (x, 0.0, rb), (x, 3.6, rb), (x, 3.6, FZ - 0.1)]
            if G.dot(G.poly_normal(q), (sgn, 0, 0)) < 0:
                q.reverse()
            D.poly(q, PLASTER)
        ff = P.F((0.0, 0.0, rb), (1, 0, 0), (0, 0, 1))
        shelf_fill()(kit, ff, x0 + 0.05, x1 - 0.05, 0.0, 3.6, 0.0, 0.0)
        kit.glow("nooks").poly([(x0, 0.2, rb + 0.005), (x1, 0.2, rb + 0.005), (x1, 3.4, rb + 0.005), (x0, 3.4, rb + 0.005)], GLASS.t(P.WARM))
        # the bay's reveal in the wall (sides and head of the 2.6 m opening)
        f = fronts()["front"]
        for (u, sgn) in ((xc - BAY_OPEN / 2, 1), (xc + BAY_OPEN / 2, -1)):
            q = [f.p(u, 0.0, 0.0), f.p(u, 3.3, 0.0), f.p(u, 3.3, -0.1), f.p(u, 0.0, -0.1)]
            if G.dot(G.poly_normal(q), G.mul(f.U, sgn)) < 0:
                q.reverse()
            S_.poly(q, BRICK)


# ------------------------------------------------------------------------------------------------ pergola garden --

def pergola(kit):
    """The reading garden's pergola (posts = colliders pergola_1..4; roof slab x 4.4..9.6, z -5.9..3.4, beams' underside
    2.70): four stone-based oak posts, two main beams along z, rafters across every 0.55 m with shaped ends, wisteria
    climbing two posts and hanging along the rafters (foliage + lilac racemes), festoon lights; two backed benches."""
    D, Gd = kit.D, kit.G
    posts = [(4.65, -5.65), (9.35, -5.65), (4.65, 3.15), (9.35, 3.15)]
    for (x, z) in posts:
        D.cbox(x - 0.15, x + 0.15, 0.0, 0.45, z - 0.15, z + 0.15, STONE_L, c=0.02, skip=("-y",), label="pergola post", kind="solid")
        D.cbox(x - 0.1, x + 0.1, 0.45, 2.7, z - 0.1, z + 0.1, OAK.u((0, 1, 0)), c=0.015)
    for x in (4.65, 9.35):
        D.cbox(x - 0.09, x + 0.09, 2.7, 2.98, -5.85, 3.35, OAK, c=0.015)
    z = -5.75
    while z <= 3.3:
        D.box(4.42, 9.58, 2.98, 3.18, z - 0.04, z + 0.04, OAK)
        z += 0.55
    for x in (4.65, 9.35):
        for sz in (-1, 1):
            D.member((x, 2.25, sz * 0.0 + (-5.65 if sz < 0 else 3.15) + (0.55 if sz < 0 else -0.55)), (x, 2.75, -5.65 if sz < 0 else 3.15), G.prof_box(0.07, 0.07), OAK)
    # wisteria: trunks twining up the two garden-side posts, foliage masses along the rafters, hanging racemes
    rg = G.rng(5)
    for (x, z) in ((9.35, -5.65), (9.35, 3.15)):
        path = [(x + 0.13 * math.cos(t * 2.2), 0.0 + t * 2.8, z + 0.13 * math.sin(t * 2.2)) for t in [i / 8 for i in range(9)]]
        D.tube(path, 0.035, 5, OAK_DK)
    for k in range(26):
        cx = 5.0 + (k % 4) * 1.35 + rg.uniform(-0.3, 0.3)
        cz = -5.5 + (k // 4) * 1.45 + rg.uniform(-0.3, 0.3)
        if cz > 3.1:
            continue
        kit.S.sphere(cx, 3.2, cz, rg.uniform(0.5, 0.7), LEAF if k % 2 else LEAF_DK, n=6, rings=3, sy=0.38)  # shell: plaster set, reads from afar
    rac = Mesh("raceme")
    rac.lathe([(0.0, 0.0), (0.06, 0.07), (0.08, 0.2), (0.05, 0.36), (0.0, 0.46)], 5, WIST)
    rac = rac.transformed(lambda p: (p[0], -p[1], p[2]))
    rac.polys = [type(q)(list(reversed(q.pts)), list(reversed(q.uv)), q.col, q.mat, q.smooth) for q in rac.polys]
    for k in range(56):
        cx = rg.uniform(4.9, 9.3)
        cz = rg.uniform(-5.5, 3.0)
        kit.place("raceme", rac, cx, 2.96, cz, rg.uniform(0, 6.28))
    # festoon lights between the main beams (night): bulbs as glow, a thin cable
    for k in range(5):
        zc = -4.8 + k * 1.95
        pts = [(4.75 + 4.5 * t, 2.62 - 0.22 * math.sin(math.pi * t), zc) for t in [i / 8 for i in range(9)]]
        for a, b in zip(pts, pts[1:]):
            Gd.member(a, b, G.prof_round(0.006, 4), IRONP)
        g = kit.glow("pergola")
        for p in pts[1:-1]:
            g.sphere(p[0], p[1] - 0.05, p[2], 0.035, GLASS.t(P.LAMP), n=5, rings=3)
        kit.lights.append(("point", 7.0, 2.4, zc, (1.0, 0.82, 0.55), 40.0))
    # benches (contract seats lot_library_bench_1/2, facing out +z)
    for i, zc in enumerate((-2.6, 1.6)):
        P.park_bench(Gd, 7.0, zc, 0.0, 1.8, OAK, IRONP, "bench_%d" % (i + 1))
    # low lavender borders along the pergola's garden edge (walk-over height)
    for (z0, z1) in ((-5.4, -3.2), (-1.8, 0.9)):
        D.cbox(9.7, 9.95, 0.0, 0.12, z0, z1, GRAN, c=0.01, skip=("-y",), label="edging", kind="walkover")
        zz = z0 + 0.15
        while zz < z1 - 0.1:
            kit.place("lavender", LAV_KIND, 9.82, 0.12, zz, rg.uniform(0, 6.28))
            zz += 0.24


def lavender_kind():
    m = Mesh("lavender")
    m.lathe([(0.1, 0.0), (0.13, 0.06), (0.09, 0.12), (0.0, 0.14)], 5, LEAF_DK)
    for (dx, dz) in ((0.04, 0.0), (-0.03, 0.03), (0.0, -0.04)):
        m.member((dx, 0.1, dz), (dx * 1.5, 0.16, dz * 1.5), G.prof_round(0.012, 4), LAV)
    return m


LAV_KIND = lavender_kind()
GERANIUMS = [("ger_red", P.flower_kind("ger_red", S("LM_library_plaster", G.hexc("F2503F")), LEAF_DK, 0.22, 0.075)),
             ("ger_pink", P.flower_kind("ger_pink", S("LM_library_plaster", G.hexc("F590C6")), LEAF_DK, 0.22, 0.075))]


# ------------------------------------------------------------------------------------------------ forecourt --

def forecourt(kit):
    """The front: two lamp posts (colliders lamp_1/2), the book return box (collider book_return) with its gold letters,
    the notice board on the wall by the right corner (slot notice), low clipped box hedges and lavender under the
    windows (walk-over height)."""
    D, Gd = kit.D, kit.G
    for i, x in enumerate((-5.5, -0.5)):
        P.lantern_post(kit, D, x, 6.75, 3.0, IRONP, GLASS, "lamp_%d" % (i + 1))
    # book return: a painted cast box on a plinth with a hooded brass slot, the words on its face
    bx, bz = -9.2, 5.05
    D.cbox(bx - 0.28, bx + 0.28, 0.0, 0.12, bz - 0.23, bz + 0.23, GRAN, c=0.015, skip=("-y",), label="book_return", kind="solid")
    D.cbox(bx - 0.25, bx + 0.25, 0.12, 1.1, bz - 0.2, bz + 0.2, GREENP, c=0.02)
    D.lathe([(0.25 * math.sqrt(2), 0.0), (0.0, 0.16)], 4, GREENP, bx, bz, 1.1, phase=math.pi / 4, smooth=False)
    D.cbox(bx - 0.17, bx + 0.17, 0.86, 0.94, bz + 0.2, bz + 0.25, GOLD, c=0.01)
    kit.letters.append(("책 반납함", (bx, 0.62, bz + 0.2), (0, 0, 1), 0.07, 0.008, GOLD, "G"))
    # the wrought-iron bracket sign by the door (Alsatian enseigne): a scrolled bracket at 3.3 m, an oval oak board with a
    # gilded open book in relief, hanging above head height
    f0 = fronts()["front"]
    su = DOOR_X + 2.35
    D.member(f0.p(su, 3.45, 0.02), f0.p(su, 3.45, 0.95), G.prof_box(0.03, 0.04), IRONP)
    D.member(f0.p(su, 2.95, 0.02), f0.p(su, 3.45, 0.6), G.prof_box(0.025, 0.025), IRONP)
    pts = [(0.0, 3.0 + 0.32 * math.sin(2 * math.pi * k / 14)) for k in range(14)]
    oval = [(0.36 * math.cos(2 * math.pi * k / 14), 2.95 + 0.26 * math.sin(2 * math.pi * k / 14)) for k in range(14)]
    c = f0.p(su, 0.0, 0.62)
    Gd.slab([(w0, v) for w0, v in oval], ((c[0], 0.0, c[2]), (0, 0, 1), (0, 1, 0)), 0.04, OAK_DOOR)
    for sx in (-1, 1):
        Gd.member((c[0] + sx * 0.03, 3.45, c[2] - 0.2), (c[0] + sx * 0.03, 3.21, c[2] - 0.2), G.prof_round(0.008, 4), IRONP)
        Gd.member((c[0] + sx * 0.03, 3.45, c[2] + 0.2), (c[0] + sx * 0.03, 3.21, c[2] + 0.2), G.prof_round(0.008, 4), IRONP)
        # the open book: two gilded pages each side of the board, raised
        for side in (-1, 1):
            Gd.slab([(sx * 0.02, 2.88), (sx * 0.2, 2.92), (sx * 0.2, 3.08), (sx * 0.02, 3.04)], ((c[0] + side * 0.035, 0.0, c[2]), (0, 0, 1), (0, 1, 0)), 0.012, GOLD)
    # clipped bay-tree topiaries in square oak planters either side of the door (colliders topiary_1 / topiary_2)
    for i, tx in enumerate((-4.7, -1.3)):
        tz = 3.8
        D.cbox(tx - 0.24, tx + 0.24, 0.0, 0.5, tz - 0.24, tz + 0.24, GREENP, c=0.02, skip=("-y",), label="topiary_%d" % (i + 1), kind="solid")
        D.box(tx - 0.2, tx + 0.2, 0.5, 0.52, tz - 0.2, tz + 0.2, FLOOR.t(G.hexc("6B4F3A")), skip=("-y",))
        D.member((tx, 0.5, tz), (tx, 1.35, tz), G.prof_round(0.025, 5), OAK_DK)
        kit.S.sphere(tx, 1.55, tz, 0.24, LEAF_DK, n=8, rings=6)
        for k in range(4):
            Gd.sphere(tx + 0.17 * math.cos(k * 1.57), 1.48 + 0.08 * (k % 2), tz + 0.17 * math.sin(k * 1.57), 0.06, S("LM_library_plaster", G.hexc("F4F1E8")), n=5, rings=3)
    # notice board on the wall (right of the right bay): glazed oak case, blank notices
    f = fronts()["front"]
    f.box(Gd, 2.75, 3.65, 1.0, 2.2, 0.0, 0.08, OAK_DOOR, skip=("-w",))
    f.box(Gd, 2.82, 3.58, 1.07, 2.13, 0.08, 0.085, PLASTER.t(G.hexc("D8E4D4")), skip=("-w",))
    for (u, v, w, h) in ((2.9, 1.6, 0.24, 0.3), (3.2, 1.7, 0.28, 0.24), (2.95, 1.15, 0.3, 0.3), (3.3, 1.2, 0.2, 0.32)):
        f.box(Gd, u, u + w, v, v + h, 0.085, 0.088, PLASTER.t(G.hexc("FFFDF6")), skip=("-w",))
    f.quad(Gd, 2.8, 3.6, 1.05, 2.15, 0.095, GLASS)
    # low box hedges and lavender between bays and door (front beds), walk-over height
    for (x0, x1) in ((-9.85, -8.75), (-5.55, -5.02), (-0.98, -0.45), (2.75, 3.85)):
        if x0 > 2.0:
            continue
        D.cbox(x0, x1, 0.0, 0.28, FZ + 0.12, FZ + 0.42, LEAF_DK, c=0.05, skip=("-y",), label="hedge", kind="walkover")


def ground(kit):
    g = kit.ground
    g.poly([(-40, -0.01, -40), (-40, -0.01, 40), (40, -0.01, 40), (40, -0.01, -40)][::-1], S("PV_grass"))
    g.poly([(-10.0, 0.0, 3.5), (-10.0, 0.0, 7.5), (10.0, 0.0, 7.5), (10.0, 0.0, 3.5)][::-1], S("PV_pavers"))
    g.poly([(4.0, 0.0, -7.5), (4.0, 0.0, 3.5), (10.0, 0.0, 3.5), (10.0, 0.0, -7.5)][::-1], S("PV_gravel"))
    g.poly([(-40, 0.002, 7.5), (-40, 0.002, 12.0), (40, 0.002, 12.0), (40, 0.002, 7.5)][::-1], S("PV_lane"))
