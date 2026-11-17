"""케이슨 마을 학교 (lot_school, plot_e, door west) — the kit, pure python on b1_geom / b1_parts, in the lot's LOCAL frame
(contract 1: x = the right hand of someone walking in at the main door, y up, z out of the front; the body is x -8..8,
z -10..-2, the fenced schoolyard z -2..10).

Reference (design 3.1, shots/lot_school/SOURCES_lot_school.md): an English / Alpine village school — a plain two-storey
rendered block with a steep red clay-tile roof, a central cross gable carrying a round clock, a white timber bell cupola with
a bronze bell and a weathervane on the ridge (Bleasdale School, Whitminster), tall white sash windows with small panes and
green shutters, a gabled porch on two posts with the carved name board; a white picket fence round a yard with a timber play
tower and slide, a two-seat swing, a log seesaw and a sandpit (Schleifreisen, Hirschau, Mostec playgrounds). Brand-new.
"""
import math

import b1_geom as G
import b1_parts as P
from b1_geom import Mesh, S

LOT = "lot_school"
# materials (<= 10 in the file): the PBR library sets of LOT_SURFACE_RULES.families.lot_school
RENDER = S("LM_school_render", G.hexc("F4E3B5"))          # butter-yellow render (stucco_white, tinted)
RENDER_TRIM = S("LM_school_render", G.hexc("FBF6EA"))     # cream render bands, quoins, surrounds
ROOM = S("LM_school_render", G.hexc("F3EEE2"))            # the classroom walls seen through the glass
ROOF = S("LM_school_roof", G.hexc("F5E2B4"))              # orange clay tiles (roof_clay_tile), Alsace (owner ref: Colmar)
TIMBER = S("LM_school_paint", G.hexc("6E4030"))           # painted oxblood-brown half-timbering (shell: reads from afar)
GRAN = S("LM_school_granite")                             # flamed granite (granite_flamed)
PAINT = S("LM_school_paint")                              # white painted timber (wood_painted)
GREEN_PAINT = S("LM_school_paint", G.hexc("4E7A5B"))      # sage-green shutters, gate, swing frame
BLUE_PAINT = S("LM_school_paint", G.hexc("4D79A8"))       # the play tower's roof boards
RED_PAINT = S("LM_school_paint", G.hexc("C8553D"))        # seesaw handles, the slide's side boards
YELLOW_PAINT = S("LM_school_paint", G.hexc("E8C04A"))
OAK = S("LM_school_oak", G.hexc("D8C2A2"))                # oiled oak (doors: darker), play timber
BARK = S("LM_school_oak", G.hexc("6E5A48"))
OAK_DOOR = S("LM_school_oak", G.hexc("8C5A36"))
IRON = S("LM_school_iron")                                # black cast iron
BRONZE = S("LM_school_iron", G.hexc("C9A15A"))            # the bell, the weathervane's cock, handles
GOLD = S("LM_school_paint", G.hexc("E6C46A"))             # gilded letters
LEAD = S("LM_school_iron", G.hexc("7D8794"))              # zinc-grey gutters, downpipes
CAP = S("LM_school_roof", G.hexc("6F7A86"))               # the cupola's cap: small tiles glazed slate-grey
STEEL = S("LM_school_iron", G.hexc("D8DCE0"))             # the slide's stainless chute, chains
RUBBER = S("LM_school_rubber")                            # terracotta safety tiles (play_rubber)
RUBBER_G = S("LM_school_rubber", G.hexc("7FAF6A"))        # green safety tiles
SAND = S("LM_school_sand")                                # play sand
LEAF = S("LM_school_green", G.hexc("B5D27E"))             # leaves, hedges (grass set)
LEAF_DK = S("LM_school_green", G.hexc("8DB866"))
PET_RED = S("LM_school_green", G.hexc("F05A5A"))
PET_PINK = S("LM_school_green", G.hexc("F49AC1"))
PET_WHITE = S("LM_school_green", G.hexc("FFF6F0"))
PET_YEL = S("LM_school_green", G.hexc("FFD45A"))
GLASS = P.GLASS

MATS = {
    "LM_school_render": {"set": "stucco_white", "rough": 0.95},
    "LM_school_roof": {"set": "roof_clay_tile"},
    "LM_school_granite": {"set": "granite_flamed"},
    "LM_school_paint": {"set": "wood_painted", "normal": 0.6},
    "LM_school_oak": {"set": "wood_oak", "rough": 0.9},
    "LM_school_iron": {"set": "cast_iron", "metal": True},
    "LM_school_rubber": {"set": "play_rubber"},
    "LM_school_sand": {"set": "sand"},
    "LM_school_green": {"set": "grass", "normal": 0.5},
    "M_glass": {"glass": True},
}
# preview ground only (not exported: vrb2 owns the ground)
PREVIEW = {
    "PV_grass": {"set": "grass"},
    "PV_pavers": {"set": "sidewalk_pavers"},
    "PV_gravel": {"set": "dirt_path"},
}

# heights (design 3.1 / villageLots.ts: eaves 8.4, ridge 12.2, weathervane 16.5)
EAVE = 8.4
RIDGE = 12.2
INSET = 0.10          # wall faces 10 cm inside the body box: plinth, sills, pipes stay inside it
FZ = -2.0 - INSET     # front wall face
BZ = -10.0 + INSET    # back wall face
SX = 8.0 - INSET      # side wall faces at +-SX
PITCH = (RIDGE - EAVE) / 4.0   # 0.95 (43.5 deg)
XG = 2.6              # cross gable half width
GAPEX = 11.5          # cross gable apex
GP = (GAPEX - EAVE) / XG       # its pitch
EAVE_Z = -1.75        # front eave line (roof overhang 0.25 past the body box)
EAVE_Y = RIDGE - PITCH * (EAVE_Z + 6.0)
VERGE = 8.3


def roof_y(z):
    return RIDGE - PITCH * abs(z + 6.0)


def build(lot, layout):
    kit = P.Kit(lot)
    kit.mats = dict(MATS)
    kit.mats.update(PREVIEW)
    body(kit)
    roof(kit)
    cupola(kit)
    clock(kit)
    porch(kit)
    windows(kit)
    yard(kit)
    ground(kit)
    kit.roof_slabs = [{"rect": [-2.2, 2.2, -2.0, -0.3], "minY": 3.3, "topY": 4.95, "what": "porch roof (beam underside 3.30)"}]
    return kit


# ------------------------------------------------------------------------------------------------ body --

def fronts():
    return {
        "front": P.F((0.0, 0.0, FZ), (1, 0, 0), (0, 0, 1)),
        "back": P.F((0.0, 0.0, BZ), (-1, 0, 0), (0, 0, -1)),
        "right": P.F((SX, 0.0, -6.0), (0, 0, -1), (1, 0, 0)),
        "left": P.F((-SX, 0.0, -6.0), (0, 0, 1), (-1, 0, 0)),
    }


GF_SILL, GF_H = 0.95, 2.35       # ground floor windows
FF_SILL, FF_H = 4.95, 2.2        # first floor windows
FRONT_WIN = [-6.5, -3.3, 3.3, 6.5]
BACK_WIN = [-6.5, -3.3, 0.0, 3.3, 6.5]
SIDE_WIN = [-1.9, 1.9]           # u along the side wall (centre at z -6)
WIN_W = 1.3


def body(kit):
    S_, D = kit.S, kit.D
    F = fronts()
    half_front = SX
    # walls with holes (the shell); the door hole 2.2 x 3.2 in the front
    holes_front = [(u - WIN_W / 2, u + WIN_W / 2, GF_SILL, GF_SILL + GF_H) for u in FRONT_WIN]
    holes_front += [(u - WIN_W / 2, u + WIN_W / 2, FF_SILL, FF_SILL + FF_H) for u in FRONT_WIN]
    holes_front += [(-0.8, 0.8, FF_SILL + 0.15, FF_SILL + FF_H), (-1.1, 1.1, 0.0, 3.2)]
    P.wall(S_, F["front"], -half_front, half_front, 0.0, EAVE, holes_front, RENDER, extra_v=(4.0, 4.25))
    holes_back = [(u - WIN_W / 2, u + WIN_W / 2, GF_SILL, GF_SILL + GF_H) for u in BACK_WIN]
    holes_back += [(u - WIN_W / 2, u + WIN_W / 2, FF_SILL, FF_SILL + FF_H) for u in BACK_WIN]
    P.wall(S_, F["back"], -half_front, half_front, 0.0, EAVE, holes_back, RENDER)
    for side in ("right", "left"):
        holes = [(u - WIN_W / 2, u + WIN_W / 2, GF_SILL, GF_SILL + GF_H) for u in SIDE_WIN]
        holes += [(u - WIN_W / 2, u + WIN_W / 2, FF_SILL, FF_SILL + FF_H) for u in SIDE_WIN]
        P.wall(S_, F[side], -3.9, 3.9, 0.0, EAVE, holes, RENDER)
        # the gable triangle above the eaves, with a round attic window (a framed oculus, glass recessed)
        f = F[side]
        f.poly(S_, [(-3.9, EAVE, 0), (3.9, EAVE, 0), (0.0, RIDGE - 0.1, 0)], RENDER)
        oculus(kit, f, 0.0, 10.05, 0.42)
    # cross gable over the entrance (front wall continues up to the clock gable)
    F["front"].poly(S_, [(-XG, EAVE, 0), (XG, EAVE, 0), (0.0, GAPEX - 0.05, 0)], RENDER)
    # granite plinth (flush with the body box), chamfered top
    for f, a, b in ((F["front"], -8.0, 8.0), (F["back"], -8.0, 8.0), (F["right"], -4.0, 4.0), (F["left"], -4.0, 4.0)):
        segs = [(a, -1.1), (1.1, b)] if f is F["front"] else [(a, b)]
        for s0, s1 in segs:
            f.box(D, s0, s1, 0.0, 0.55, -0.05, INSET, GRAN, skip=("-v", "-w"))
            f.box(D, s0, s1, 0.55, 0.6, -0.05, INSET - 0.03, GRAN, skip=("-v", "-w"))
    # cream storey band and eaves cornice (detail), quoins at the four corners
    for f, a, b in ((F["front"], -SX, SX), (F["back"], -SX, SX), (F["right"], -3.9, 3.9), (F["left"], -3.9, 3.9)):
        f.box(S_, a - 0.04, b + 0.04, 4.0, 4.22, 0.0, 0.07, RENDER_TRIM, skip=("-w",))
        f.box(S_, a - 0.04, b + 0.04, EAVE - 0.38, EAVE - 0.2, 0.0, 0.06, RENDER_TRIM, skip=("-w",))
    for f in (F["front"], F["back"]):
        for u in (-SX, SX):
            sgn = 1 if u > 0 else -1
            for k in range(14):
                v0 = 0.6 + k * 0.53
                if v0 + 0.45 > 4.0:
                    break
                wq = 0.5 if k % 2 == 0 else 0.34
                u0, u1 = (u - wq, u + 0.0) if sgn > 0 else (u, u + wq)
                f.box(S_, u0, u1, v0, v0 + 0.45, 0.0, 0.035, RENDER_TRIM, skip=("-w",))
    # Alsatian half-timbering on the upper storey (front and both ends) and in the three gables (owner 2026-11-17 Colmar ref)
    shut = 0.06 + 0.62
    def opens(us, w=WIN_W):
        return [(u - w / 2 - shut, u + w / 2 + shut, FF_SILL - 0.12, FF_SILL + FF_H + 0.06) for u in us]
    P.fachwerk(S_, F["front"], -SX, SX, 4.22, EAVE - 0.38, TIMBER, opens(FRONT_WIN) + [(-0.95, 0.95, FF_SILL, FF_SILL + FF_H + 0.08)])
    for side in ("left", "right"):
        P.fachwerk(S_, F[side], -3.9, 3.9, 4.22, EAVE - 0.38, TIMBER, opens(SIDE_WIN))
        P.gable_timber(S_, F[side], 0.0, 3.9, EAVE, RIDGE - 0.1, TIMBER, 10.7, skip=(9.6, 10.5))
    P.gable_timber(S_, F["front"], 0.0, XG, EAVE, GAPEX - 0.05, TIMBER, 10.35, skip=(8.3, 10.1))
    # downpipes at the front corners (zinc grey), hoppers under the gutter
    for u in (-7.62, 7.62):
        p0 = F["front"].p(u, 0.12, 0.06)
        p1 = F["front"].p(u, EAVE - 0.35, 0.06)
        D.member(p0, p1, G.prof_round(0.045, 8), LEAD)
        F["front"].box(D, u - 0.1, u + 0.1, EAVE - 0.38, EAVE - 0.18, 0.0, 0.1, LEAD, c=0.01)
        for v in (1.5, 5.5):
            F["front"].box(D, u - 0.06, u + 0.06, v, v + 0.04, 0.0, 0.1, LEAD, skip=("-w",))
    # two render chimneys on the ridge with granite caps and clay pots
    for x in (-5.4, 5.4):
        S_.box(x - 0.42, x + 0.42, roof_y(-6.6) - 0.2, RIDGE + 1.15, -6.75, -5.25, RENDER, skip=("-y",))
        S_.box(x - 0.5, x + 0.5, RIDGE + 1.15, RIDGE + 1.3, -6.83, -5.17, RENDER_TRIM)
        for dz in (-0.3, 0.3):
            S_.lathe([(0.11, 0.0), (0.1, 0.26), (0.13, 0.3), (0.0, 0.3)], 6, ROOF.t(G.hexc("D9825F")), x, -6.0 + dz, RIDGE + 1.3)


def oculus(kit, f, uc, vc, r):
    D = kit.D
    n = 16
    ring = [(uc + r * math.cos(2 * math.pi * i / n), vc + r * math.sin(2 * math.pi * i / n)) for i in range(n)]
    inner = [(uc + (r - 0.1) * math.cos(2 * math.pi * i / n), vc + (r - 0.1) * math.sin(2 * math.pi * i / n)) for i in range(n)]
    for i in range(n):
        j = (i + 1) % n
        f.poly(D, [(ring[i][0], ring[i][1], 0.06), (ring[j][0], ring[j][1], 0.06), (inner[j][0], inner[j][1], 0.06), (inner[i][0], inner[i][1], 0.06)], RENDER_TRIM)
        f.poly(D, [(ring[i][0], ring[i][1], 0.0), (ring[j][0], ring[j][1], 0.0), (ring[j][0], ring[j][1], 0.06), (ring[i][0], ring[i][1], 0.06)], RENDER_TRIM, out=0)
    f.poly(D, [(p[0], p[1], 0.02) for p in inner], GLASS)
    # cross bars (painted)
    D.member(f.p(uc - r + 0.1, vc, 0.03), f.p(uc + r - 0.1, vc, 0.03), G.prof_box(0.03, 0.03), PAINT)
    D.member(f.p(uc, vc - r + 0.1, 0.03), f.p(uc, vc + r - 0.1, 0.03), G.prof_box(0.03, 0.03), PAINT)


# ------------------------------------------------------------------------------------------------ roof --

def roof(kit):
    S_, D, Gd = kit.S, kit.D, kit.G
    T = 0.16  # roof thickness at the edges (fascia)
    EZ = EAVE_Z
    EY = EAVE_Y
    BACK_Y = roof_y(-10.0)
    xg = (GAPEX - EY) / GP  # the cross gable's verge where it meets the main eave
    # main front slope with the cross gable's notch, main back slope (no overhang past the body: footprint edge)
    valley_top = (0.0, GAPEX, -6.0 + (RIDGE - GAPEX) / PITCH)
    front = [(-VERGE, EY, EZ), (-xg, EY, EZ), valley_top, (xg, EY, EZ), (VERGE, EY, EZ), (VERGE, RIDGE, -6.0), (-VERGE, RIDGE, -6.0)]
    S_.poly(front, ROOF)
    S_.poly([(VERGE, BACK_Y, -10.0), (-VERGE, BACK_Y, -10.0), (-VERGE, RIDGE, -6.0), (VERGE, RIDGE, -6.0)], ROOF)
    # cross gable roof planes
    gz = -1.6
    S_.poly([(0.0, GAPEX, gz), (-xg, EY, gz), (-xg, EY, EZ), valley_top], ROOF)
    S_.poly([(xg, EY, gz), (0.0, GAPEX, gz), valley_top, (xg, EY, EZ)], ROOF)
    # undersides (soffits) and fascias, verge boards (painted white), barge boards on the gables
    S_.poly([(-VERGE, EY - T, EZ), (VERGE, EY - T, EZ), (VERGE, EY - T, FZ), (-VERGE, EY - T, FZ)], PAINT)  # front soffit faces down
    S_.box(-VERGE, VERGE, EY - T - 0.06, EY + 0.02, EZ - 0.03, EZ, PAINT, skip=("-y", "+y", "-z"))  # fascia
    for sx in (-1, 1):
        x = sx * VERGE
        # verge (barge) boards following the slopes, both faces
        for (za, ya, zb, yb) in ((EZ, EY, -6.0, RIDGE), (-6.0, RIDGE, -10.0, BACK_Y)):
            q = [(x, ya - 0.24, za), (x, yb - 0.24, zb), (x, yb + 0.02, zb), (x, ya + 0.02, za)]
            q2 = [(x - sx * 0.05, ya - 0.24, za), (x - sx * 0.05, yb - 0.24, zb), (x - sx * 0.05, yb + 0.02, zb), (x - sx * 0.05, ya + 0.02, za)]
            if G.dot(G.poly_normal(q), (sx, 0, 0)) < 0:
                q.reverse()
            if G.dot(G.poly_normal(q2), (-sx, 0, 0)) < 0:
                q2.reverse()
            S_.poly(q, PAINT)
            S_.poly(q2, PAINT)
            # underside of the verge overhang
            S_.poly([(x, ya - 0.24, za), (x - sx * 0.4, ya - 0.24, za), (x - sx * 0.4, yb - 0.24, zb), (x, yb - 0.24, zb)] if sx > 0 else
                   [(x - sx * 0.4, ya - 0.24, za), (x, ya - 0.24, za), (x, yb - 0.24, zb), (x - sx * 0.4, yb - 0.24, zb)], PAINT)
    # back eave: a fascia on the footprint line (no overhang), gutter tucked behind it
    S_.box(-VERGE, VERGE, BACK_Y - 0.26, BACK_Y + 0.02, -10.0, -9.96, PAINT, skip=("+z", "-y", "+y"))
    # cross gable barge boards with a carved drop (finial) at the apex
    for sx in (-1, 1):
        a = (sx * xg, EY, gz)
        b = (0.0, GAPEX, gz)
        S_.member(G.add(a, (0, -0.12, 0.02)), G.add(b, (0, -0.12, 0.02)), G.prof_box(0.05, 0.26), PAINT)
    D.lathe([(0.05, 0.0), (0.07, 0.25), (0.04, 0.45), (0.06, 0.6), (0.0, 0.75)], 8, PAINT, 0.0, gz + 0.05, GAPEX - 0.7)
    # half-round zinc gutter along the front eave (two pieces round the cross gable's eave)
    for (x0, x1) in ((-VERGE, VERGE),):
        path = [(x0, EY - 0.1, EZ + 0.08), (x1, EY - 0.1, EZ + 0.08)]
        D.member(path[0], path[1], [(0.075 * math.cos(math.pi + math.pi * i / 6), 0.075 * math.sin(math.pi + math.pi * i / 6)) for i in range(7)] + [(0.07, 0.0), (0.0, -0.06), (-0.07, 0.0)], LEAD)
    # ridge tiles (instanced): half-round clay cappings along the main and cross ridges
    rt = Mesh("ridge_tile")
    prof = [(0.13 * math.cos(math.pi * i / 4), 0.1 * math.sin(math.pi * i / 4) - 0.02) for i in range(5)]
    rt.member((0.0, 0.0, -0.205), (0.0, 0.0, 0.205), prof + [(-0.13, -0.03), (0.13, -0.03)], ROOF.t(G.hexc("E7967A")))
    x = -VERGE + 0.21
    while x < VERGE - 0.1:
        if abs(x) > 0.95:
            kit.place("ridge", rt, x, RIDGE + 0.02, -6.0, math.pi / 2)
        x += 0.4
    z = gz + 0.21
    while z < valley_top[2] - 0.1:
        kit.place("ridge", rt, 0.0, GAPEX + 0.02, z, 0.0)
        z += 0.4
    # the roof tiles' lower edge: a row of tile noses on the front eave (structure, small)
    D.box(-VERGE, VERGE, EY - 0.02, EY + 0.04, EZ, EZ + 0.04, ROOF.t(G.hexc("C76D4F")))
    # snow-guard-free brand-new roof; two small dormer-free roof lights? no: the cupola carries the look


def cupola(kit):
    """A white timber bell cupola on the ridge: a square base saddled on the roof, four open round-arched bell openings with
    balustrades, corner pilasters, a moulded cornice, a lead-grey ogee cap, a bronze bell inside, a ball finial and a
    weathervane with a cockerel and an arrow (no letters)."""
    D = kit.D
    cz = -6.0
    b = 0.8          # half width
    y0 = RIDGE - 0.75
    y1 = RIDGE + 0.55  # base top
    y2 = y1 + 1.55     # bell stage top
    # base (painted boards) saddled on the ridge
    S_ = kit.S
    S_.box(-b - 0.05, b + 0.05, y0, y1, cz - b - 0.05, cz + b + 0.05, PAINT.u((0, 1, 0)), skip=("-y",))
    S_.box(-b - 0.12, b + 0.12, y1, y1 + 0.12, cz - b - 0.12, cz + b + 0.12, PAINT)
    # bell stage: corner posts (pilasters), arches on four faces, balustrade rails
    for sx in (-1, 1):
        for sz in (-1, 1):
            S_.box(sx * b - 0.13, sx * b + 0.13, y1 + 0.12, y2, cz + sz * b - 0.13, cz + sz * b + 0.13, PAINT, skip=("-y", "+y"))
    for k, (U, W) in enumerate((((1, 0, 0), (0, 0, 1)), ((-1, 0, 0), (0, 0, -1)), ((0, 0, -1), (1, 0, 0)), ((0, 0, 1), (-1, 0, 0)))):
        f = P.F((W[0] * b, 0.0, cz + W[2] * b), U, W)
        # arch head panel above the opening (spandrels filled)
        f.box(D, -b + 0.13, b - 0.13, y2 - 0.32, y2, -0.05, 0.05, PAINT)
        pts = G.arch_pts(0.0, y2 - 0.62, 2 * (b - 0.13), 10)
        for i in range(len(pts) - 1):
            a, c = pts[i], pts[i + 1]
            f.poly(D, [(a[0], a[1], 0.05), (c[0], c[1], 0.05), (c[0], y2 - 0.32, 0.05), (a[0], y2 - 0.32, 0.05)], PAINT)
            f.poly(D, [(a[0], a[1], -0.05), (c[0], c[1], -0.05), (c[0], a[1], 0.05), (a[0], a[1], 0.05)], PAINT, out=0)
        # keystone
        f.box(D, -0.08, 0.08, y2 - 0.42, y2 - 0.22, 0.05, 0.09, PAINT, c=0.01)
        # balustrade: rail + turned balusters
        f.box(D, -b + 0.13, b - 0.13, y1 + 0.12, y1 + 0.2, -0.05, 0.05, PAINT)
        f.box(D, -b + 0.13, b - 0.13, y1 + 0.52, y1 + 0.6, -0.06, 0.06, PAINT, c=0.01)
        for i in range(5):
            u = -b + 0.3 + i * (2 * b - 0.6) / 4
            f.box(D, u - 0.025, u + 0.025, y1 + 0.2, y1 + 0.52, -0.025, 0.025, PAINT, skip=("-v", "+v"))
    # cornice
    S_.box(-b - 0.2, b + 0.2, y2, y2 + 0.1, cz - b - 0.2, cz + b + 0.2, PAINT)
    S_.box(-b - 0.26, b + 0.26, y2 + 0.1, y2 + 0.22, cz - b - 0.26, cz + b + 0.26, PAINT, skip=("-y",))
    # ogee cap (lead grey), square in plan (4 sides, 45-degree phase), a ball and the weathervane
    prof = [(b + 0.24, 0.0), (b + 0.12, 0.12), (b - 0.05, 0.35), (0.55, 0.62), (0.32, 0.86), (0.16, 1.02), (0.07, 1.1), (0.0, 1.12)]
    S_.lathe([(r * math.sqrt(2), y) for r, y in prof], 4, CAP, 0.0, cz, y2 + 0.22, phase=math.pi / 4, smooth=False)
    yc = y2 + 1.34
    D.lathe([(0.05, 0.0), (0.05, 0.1), (0.0, 0.1)], 6, BRONZE, 0.0, cz, yc - 0.02)
    D.sphere(0.0, yc + 0.18, cz, 0.12, BRONZE, n=10, rings=6)
    D.member((0.0, yc + 0.28, cz), (0.0, 16.48, cz), G.prof_round(0.018, 6), IRON)
    # compass cross (arms only, no letters) and the vane: arrow + cockerel silhouette (extruded)
    ya = yc + 0.6
    D.member((-0.42, ya, cz), (0.42, ya, cz), G.prof_round(0.012, 5), IRON)
    D.member((0.0, ya, cz - 0.42), (0.0, ya, cz + 0.42), G.prof_round(0.012, 5), IRON)
    yv = 16.05
    D.member((-0.55, yv, cz), (0.62, yv, cz), G.prof_box(0.015, 0.02), BRONZE)
    tail = [(-0.62, yv - 0.1), (-0.42, yv), (-0.62, yv + 0.12), (-0.5, yv + 0.12), (-0.35, yv + 0.02), (-0.35, yv - 0.02), (-0.5, yv - 0.1)]
    head = [(0.62, yv), (0.5, yv + 0.07), (0.53, yv), (0.5, yv - 0.07)]
    cock = [(-0.25, yv + 0.04), (0.18, yv + 0.04), (0.26, yv + 0.12), (0.3, yv + 0.3), (0.36, yv + 0.36), (0.3, yv + 0.42), (0.22, yv + 0.38),
            (0.18, yv + 0.26), (0.05, yv + 0.2), (-0.12, yv + 0.22), (-0.2, yv + 0.36), (-0.3, yv + 0.42), (-0.28, yv + 0.24)]
    fr = (( 0.0, 0.0, cz), (1, 0, 0), (0, 1, 0))
    for outline in (tail, head, cock):
        D.slab([(u, v - 0.0) for u, v in outline], ((0.0, 0.0, cz + 0.012), (1, 0, 0), (0, 1, 0)), 0.024, BRONZE)
    # the bronze bell hanging in the bell stage (slot bell at y 13.4), its yoke and headstock
    by = 13.4
    D.lathe([(0.0, by + 0.32), (0.12, by + 0.31), (0.17, by + 0.22), (0.2, by + 0.0), (0.26, by - 0.18), (0.3, by - 0.24), (0.29, by - 0.27), (0.0, by - 0.25)][::-1], 12, BRONZE, 0.0, cz, 0.0)
    D.member((-b + 0.13, by + 0.42, cz), (b - 0.13, by + 0.42, cz), G.prof_box(0.1, 0.12), OAK)
    D.member((0.0, by + 0.32, cz), (0.0, by + 0.42, cz), G.prof_box(0.08, 0.05), IRON)
    D.sphere(0.0, by - 0.2, cz, 0.06, IRON, n=6, rings=3)
    g = kit.glow("cupola")
    g.lathe([(0.0, 0.0), (0.5, 0.02), (0.5, 1.2), (0.0, 1.22)], 6, GLASS.t(G.lin(1.0, 0.82, 0.6)), 0.0, cz, y1 + 0.25)
    kit.lights.append(("point", 0.0, y1 + 0.9, cz, (1.0, 0.82, 0.6), 60.0))


def clock(kit):
    """The round clock in the cross gable (slot clock at y 9.2): a cream render roundel, a black iron bezel, a white enamelled
    face with 12 raised bronze hour batons and 48 minute dots, two hands (their own nodes are the game's: the static hands here
    show 10:10 until the wiring turns them)."""
    D = kit.D
    f = fronts()["front"]
    cy = 9.2
    n = 20
    def ring(r0, r1, w0, w1, s):
        for i in range(n):
            a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
            p = lambda r, a, w: (r * math.cos(a), cy + r * math.sin(a), w)
            f.poly(D, [p(r1, a0, w1), p(r1, a1, w1), p(r0, a1, w1), p(r0, a0, w1)], s)
            f.poly(D, [p(r1, a0, w0), p(r1, a1, w0), p(r1, a1, w1), p(r1, a0, w1)], s, out=0)
    ring(0.66, 0.9, 0.0, 0.05, RENDER_TRIM)
    ring(0.6, 0.68, 0.0, 0.1, IRON)
    face = [(0.6 * math.cos(2 * math.pi * i / n), cy + 0.6 * math.sin(2 * math.pi * i / n), 0.07) for i in range(n)]
    f.poly(D, face, PAINT.t(G.hexc("FFFDF6")))
    for i in range(12):
        a = 2 * math.pi * i / 12
        c, s = math.cos(a), math.sin(a)
        r0, r1 = 0.43, 0.55
        w = 0.035 if i % 3 else 0.055
        q = [(r0 * c - w * s, cy + r0 * s + w * c), (r1 * c - w * s, cy + r1 * s + w * c), (r1 * c + w * s, cy + r1 * s - w * c), (r0 * c + w * s, cy + r0 * s - w * c)]
        f.poly(D, [(u, v, 0.085) for u, v in q], IRON)
    # hands at 10:10
    for (ang, L, wd) in ((math.radians(90 + 60 + 5), 0.33, 0.035), (math.radians(90 - 60), 0.5, 0.022)):
        c, s = math.cos(ang), math.sin(ang)
        q = [(-0.08 * c - wd * s, cy - 0.08 * s + wd * c), (L * c, cy + L * s), (-0.08 * c + wd * s, cy - 0.08 * s - wd * c)]
        f.poly(D, [(u, v, 0.095) for u, v in q], IRON)
    f.box(D, -0.03, 0.03, cy - 0.03, cy + 0.03, 0.07, 0.11, BRONZE)
    g = kit.glow("clock")
    g.poly([f.p(0.58 * math.cos(2 * math.pi * i / 20), cy + 0.58 * math.sin(2 * math.pi * i / 20), 0.072) for i in range(20)], GLASS.t(G.lin(1.0, 0.95, 0.85)))
    # a small cream hood moulding over the clock
    f.box(D, -1.0, 1.0, cy + 0.95, cy + 1.05, 0.0, 0.14, RENDER_TRIM, c=0.02)


# ------------------------------------------------------------------------------------------------ porch --

def porch(kit):
    D, S_ = kit.D, kit.S
    f = fronts()["front"]
    # door opening: oak architrave, a fanlight-less head (porch beam above), granite threshold; the vestibule behind
    dz = FZ - 0.22   # the leaves' outer face
    P.double_door(kit, "lot_school_main", 0.0, dz, 2.2, 3.2, OAK_DOOR, PAINT, BRONZE)
    for u0, u1 in ((-1.1, -1.1), (1.1, 1.1)):
        pass
    # reveals of the door hole
    for (u, sgn) in ((-1.1, 1), (1.1, -1)):
        q = [f.p(u, 0.0, 0.0), f.p(u, 3.2, 0.0), f.p(u, 3.2, -0.3), f.p(u, 0.0, -0.3)]
        if G.dot(G.poly_normal(q), G.mul(f.U, sgn)) < 0:
            q.reverse()
        D.poly(q, RENDER)
    q = [f.p(-1.1, 3.2, 0.0), f.p(1.1, 3.2, 0.0), f.p(1.1, 3.2, -0.3), f.p(-1.1, 3.2, -0.3)]
    if G.poly_normal(q)[1] > 0:
        q.reverse()
    D.poly(q, RENDER)
    # architrave (painted, moulded) round the door
    f.box(D, -1.32, -1.1, 0.0, 3.42, 0.0, 0.06, PAINT, c=0.012, skip=("-w",))
    f.box(D, 1.1, 1.32, 0.0, 3.42, 0.0, 0.06, PAINT, c=0.012, skip=("-w",))
    f.box(D, -1.32, 1.32, 3.2, 3.42, 0.0, 0.06, PAINT, c=0.012, skip=("-w",))
    f.box(D, -1.1, 1.1, 0.0, 0.02, -0.3, 0.1, GRAN)
    # vestibule behind the leaves (seen when they open): floor, side walls, back wall with an inner glazed door
    vz0, vz1 = FZ - 0.3, FZ - 2.6
    D.box(-1.55, 1.55, -0.05, 0.0, vz1, vz0, OAK.t(G.hexc("B98A5E")), skip=("-y",))
    for x, sgn in ((-1.55, 1), (1.55, -1)):
        q = [(x, 0.0, vz0), (x, 0.0, vz1), (x, 3.6, vz1), (x, 3.6, vz0)]
        if G.dot(G.poly_normal(q), (sgn, 0, 0)) < 0:
            q.reverse()
        D.poly(q, ROOM)
    D.poly([(-1.55, 0.0, vz1), (1.55, 0.0, vz1), (1.55, 3.6, vz1), (-1.55, 3.6, vz1)], ROOM)
    D.poly([(-1.55, 3.6, vz0), (1.55, 3.6, vz0), (1.55, 3.6, vz1), (-1.55, 3.6, vz1)][::-1], ROOM)
    D.box(-0.75, 0.75, 0.0, 2.6, vz1, vz1 + 0.05, OAK_DOOR)
    D.box(-0.6, 0.6, 1.2, 2.45, vz1 + 0.05, vz1 + 0.06, GLASS)
    g = kit.glow("porch")
    g.poly([(-1.4, 0.3, vz1 + 0.02), (1.4, 0.3, vz1 + 0.02), (1.4, 3.3, vz1 + 0.02), (-1.4, 3.3, vz1 + 0.02)], GLASS.t(P.WARM))
    # porch: granite landing (walk-over), two painted posts on granite bases (in their collider squares), beams, a gabled
    # roof of clay tiles with a pediment that carries the carved oak name board "케이슨 마을 학교"
    D.cbox(-2.2, 2.2, 0.0, 0.03, -2.0, -0.3, GRAN, c=0.01, skip=("-y",))
    for x in (-1.6, 1.6):
        D.cbox(x - 0.15, x + 0.15, 0.0, 0.32, -0.75, -0.45, GRAN, c=0.02, skip=("-y",), label="porch post", kind="solid")
        D.cbox(x - 0.1, x + 0.1, 0.32, 3.2, -0.7, -0.5, PAINT.u((0, 1, 0)), c=0.015)
        D.cbox(x - 0.14, x + 0.14, 3.15, 3.3, -0.74, -0.46, PAINT, c=0.015)
        # curved brackets to the beam
        for sgn in (-1, 1):
            D.member((x + sgn * 0.1, 2.85, -0.6), (x + sgn * 0.42, 3.3, -0.6), G.prof_box(0.06, 0.08), PAINT)
        # side beam from the post back to the wall
        D.box(x - 0.08, x + 0.08, 3.3, 3.55, FZ, -0.45, PAINT)
    D.cbox(-2.2, 2.2, 3.3, 3.58, -0.72, -0.48, PAINT, c=0.015)       # front beam (underside 3.30 = the roof slab minY)
    # porch roof: eaves at y 3.62 (x = +-2.2), ridge 4.72 at x 0, from the wall back to z -0.3
    ry0, ry1 = 3.62, 4.72
    S_.poly([(-2.2, ry0, -0.3), (0.0, ry1, -0.3), (0.0, ry1, FZ), (-2.2, ry0, FZ)], ROOF)
    S_.poly([(0.0, ry1, -0.3), (2.2, ry0, -0.3), (2.2, ry0, FZ), (0.0, ry1, FZ)], ROOF)
    # roof underside (painted boarding) and pediment
    D.poly([(-2.2, ry0 - 0.1, -0.3), (-2.2, ry0 - 0.1, FZ), (0.0, ry1 - 0.1, FZ), (0.0, ry1 - 0.1, -0.3)], PAINT)
    D.poly([(0.0, ry1 - 0.1, -0.3), (0.0, ry1 - 0.1, FZ), (2.2, ry0 - 0.1, FZ), (2.2, ry0 - 0.1, -0.3)], PAINT)
    D.poly([(-2.2, 3.58, -0.32), (2.2, 3.58, -0.32), (0.0, ry1 - 0.05, -0.32)], PAINT)
    for sx in (-1, 1):
        D.member((sx * 2.25, ry0 - 0.12, -0.26), (0.0, ry1 - 0.12, -0.26), G.prof_box(0.05, 0.22), PAINT)
    # the name board (oak) in the pediment; letters raised 4 cm (LOT_SIGN_WORDS: "케이슨 마을 학교")
    D.cbox(-1.1, 1.1, 3.66, 4.14, -0.32, -0.28, GREEN_PAINT, c=0.01)
    kit.letters.append(("케이슨 마을 학교", (0.0, 3.79, -0.28), (0, 0, 1), 0.24, 0.03, GOLD, "D"))
    # a lantern under the porch roof (night glow) on a short chain
    D.member((0.0, ry1 - 0.12, -1.15), (0.0, 3.9, -1.15), G.prof_round(0.012, 5), IRON)
    D.cbox(-0.13, 0.13, 3.52, 3.9, -1.28, -1.02, IRON, c=0.01)
    kit.glow("porch").lathe([(0.0, 0.0), (0.1, 0.02), (0.1, 0.32), (0.0, 0.34)], 6, GLASS.t(P.LAMP), 0.0, -1.15, 3.54)
    kit.lights.append(("point", 0.0, 3.7, -1.15, (1.0, 0.84, 0.6), 80.0))
    # bench seats against the front wall (contract seats lot_school_bench_1/2)
    for i, x in enumerate((-5.0, 5.0)):
        P.park_bench(kit.G, x, -1.725, 0.0, 1.8, OAK, IRON, "bench_%d" % (i + 1))
    # low flower beds by the porch (walk-over height) with box edging
    for x0, x1 in ((-3.0, -2.25), (2.25, 3.0)):
        D.cbox(x0, x1, 0.0, 0.16, -2.0, -1.55, GRAN, c=0.015, skip=("-y",))
        D.box(x0 + 0.04, x1 - 0.04, 0.0, 0.15, -1.96, -1.59, SAND.t(G.hexc("6B5040")), skip=("-y",))
        P.flowers_row(kit, P.F((0, 0, -1.775), (1, 0, 0), (0, 0, 1)), x0 + 0.08, x1 - 0.06, 0.15, 0.0, LOW, seed=int(x0 * 10), step=0.12)


FLOWERS = []
LOW = []


def _flowers():
    global FLOWERS
    FLOWERS = [("fl_red", P.flower_kind("fl_red", PET_RED, LEAF_DK, 0.2, 0.07)),
               ("fl_pink", P.flower_kind("fl_pink", PET_PINK, LEAF_DK, 0.2, 0.07)),
               ("fl_white", P.flower_kind("fl_white", PET_WHITE, LEAF, 0.18, 0.065))]
    LOW.extend([("lo_red", P.flower_kind("lo_red", PET_RED, LEAF_DK, 0.1, 0.05)),
                ("lo_yel", P.flower_kind("lo_yel", PET_YEL, LEAF_DK, 0.1, 0.05))])


_flowers()


# ------------------------------------------------------------------------------------------------ windows --

def windows(kit):
    F = fronts()
    common = dict(paint=PAINT, stone=GRAN, wall_s=RENDER, room_s=ROOM)
    # (Colmar pass, L5v2: every street-side window with its shutters, and a deeper cream surround round each: the
    # ground floor's shutters stand outside a 0.18 m surround, the first floor's outside a 0.12 m one)
    gf = dict(surround=(0.18, RENDER_TRIM), shutters=(GREEN_PAINT, 0.6), shutter_gap=0.2)
    ff = dict(surround=(0.12, RENDER_TRIM), shutters=(GREEN_PAINT, 0.6), shutter_gap=0.14, box=(GREEN_PAINT, FLOWERS))
    for u in FRONT_WIN:
        P.sash_window(kit, F["front"], u, GF_SILL, WIN_W, GF_H, cols=2, rows=3, plant=(ROOF.t(G.hexc("D9825F")), LEAF), **gf, **common)
        P.sash_window(kit, F["front"], u, FF_SILL, WIN_W, FF_H, cols=2, rows=3, **ff, **common)
    # the centre first-floor window over the porch: round-headed, a pair of sashes
    P.sash_window(kit, F["front"], 0.0, FF_SILL + 0.15, 1.6, FF_H - 0.15, cols=3, rows=3, arch=True, surround=(0.12, RENDER_TRIM), box=(GREEN_PAINT, FLOWERS), **common)
    for u in BACK_WIN:
        P.sash_window(kit, F["back"], u, GF_SILL, WIN_W, GF_H, cols=2, rows=3, surround=(0.14, RENDER_TRIM), lights=False, **common)
        P.sash_window(kit, F["back"], u, FF_SILL, WIN_W, FF_H, cols=2, rows=3, surround=(0.12, RENDER_TRIM), lights=False, **common)
    for side in ("left", "right"):
        for u in SIDE_WIN:
            P.sash_window(kit, F[side], u, GF_SILL, WIN_W, GF_H, cols=2, rows=3, lights=False, **gf, **common)
            P.sash_window(kit, F[side], u, FF_SILL, WIN_W, FF_H, cols=2, rows=3, lights=False, **ff, **common)


# ------------------------------------------------------------------------------------------------ yard --

def picket_kind():
    m = Mesh("picket")
    w, t, h = 0.075, 0.022, 1.0
    out = [(-w / 2, 0.0), (w / 2, 0.0), (w / 2, h - 0.06), (0.0, h), (-w / 2, h - 0.06)]
    m.slab(out, ((0.0, 0.0, t / 2), (1, 0, 0), (0, 1, 0)), t, PAINT.u((0, 1, 0)))
    # front and back only (+ the two sloped top faces): a 2.2 cm board's long edges never read at fence distance
    m.polys = [p for p in m.polys if abs(G.poly_normal(p.pts)[0]) < 0.9 and G.poly_normal(p.pts)[1] > -0.9]
    return m


def fence_run(kit, a, b, label):
    """A white picket fence from a to b (local x, z), centred in its collider band: posts every <= 2.4 m (rounded tops),
    two rails on the inner side, pickets every 0.13 m on the rails' outer face. Band = 0.12 m."""
    D = kit.D
    pk = picket_kind()
    L = math.dist(a, b)
    d = ((b[0] - a[0]) / L, (b[1] - a[1]) / L)
    n = (d[1], -d[0])  # left normal
    yaw = math.atan2(d[0], d[1]) - math.pi / 2
    nposts = max(1, int(math.ceil(L / 2.4)))
    for i in range(nposts + 1):
        t = min(L, i * L / nposts)
        x, z = a[0] + d[0] * t, a[1] + d[1] * t
        x = min(max(x, a[0] if d[0] >= 0 else b[0]), b[0] if d[0] >= 0 else a[0])
        D.box(x - 0.035, x + 0.035, 0.0, 1.1, z - 0.035, z + 0.035, PAINT.u((0, 1, 0)), skip=("-y",))
        D.lathe([(0.045, 0.0), (0.05, 0.04), (0.0, 0.1)], 5, PAINT, x, z, 1.1)
    for y in (0.28, 0.78):
        p0 = (a[0] - n[0] * 0.0, y, a[1] - n[1] * 0.0)
        D.member((a[0] + n[0] * 0.0, y, a[1] + n[1] * 0.0), (b[0], y, b[1]), G.prof_box(0.02, 0.07), PAINT)
    t = 0.07
    while t < L - 0.05:
        x, z = a[0] + d[0] * t, a[1] + d[1] * t
        kit.place("picket", pk, x + n[0] * 0.022, 0.03, z + n[1] * 0.022, yaw)
        t += 0.18
    kit.extra_props.append((label, (min(a[0], b[0]) - 0.06, max(a[0], b[0]) + 0.06, 0.0, 1.15, min(a[1], b[1]) - 0.06, max(a[1], b[1]) + 0.06), "solid"))


def yard(kit):
    D, Gd = kit.D, kit.G
    # fences (contract colliders fence_n / fence_s / fence_fl / fence_fr), centred in their 0.12 bands
    fence_run(kit, (-10.94, -1.46), (-10.94, 9.94), "fence:n")
    fence_run(kit, (10.94, -1.46), (10.94, 9.94), "fence:s")
    fence_run(kit, (-10.94, 9.94), (-2.66, 9.94), "fence:fl")
    fence_run(kit, (2.66, 9.94), (10.94, 9.94), "fence:fr")
    # the gate arch over the 5.2 m opening: two square gate posts (in the fence bands) and an arched board with the name
    for x in (-2.65, 2.65):
        D.cbox(x - 0.05, x + 0.05, 0.0, 2.95, 9.89, 9.99, GREEN_PAINT.u((0, 1, 0)), c=0.01, skip=("-y",))
        D.sphere(x, 3.0, 9.94, 0.05, GREEN_PAINT, n=8, rings=4)
    pts = G.arch_pts(0.0, 2.55, 5.3, 14, rise=0.35)
    for i in range(len(pts) - 1):
        (u0, v0), (u1, v1) = pts[i], pts[i + 1]
        D.member((u0, v0, 9.94), (u1, v1, 9.94), G.prof_box(0.05, 0.12), GREEN_PAINT)
    D.member((-2.65, 2.45, 9.94), (2.65, 2.45, 9.94), G.prof_box(0.05, 0.06), GREEN_PAINT)
    for i in range(1, 12):
        u = -2.65 + 5.3 * i / 12
        top = max(v for (uu, v) in pts if abs(uu - u) < 0.3) if any(abs(uu - u) < 0.3 for uu, _ in pts) else 2.7
        D.member((u, 2.45, 9.94), (u, top - 0.05, 9.94), G.prof_round(0.012, 5), GREEN_PAINT)
    D.cbox(-1.25, 1.25, 2.62, 2.88, 9.9, 9.98, PAINT, c=0.01)
    kit.letters.append(("케이슨 마을 학교", (0.0, 2.67, 9.98), (0, 0, 1), 0.17, 0.025, GREEN_PAINT, "G"))
    # lamps in the fence line (inside fence_fl / fence_fr bands)
    P.lantern_post(kit, D, -6.4, 9.94, 3.3, IRON, GLASS, "fence:fl lamp", glow_part="lamps", arm=(0.0, -0.55))
    P.lantern_post(kit, D, 6.4, 9.94, 3.3, IRON, GLASS, "fence:fr lamp", glow_part="lamps", arm=(0.0, -0.55))
    # two young lime trees (contract colliders tree_1 / tree_2, appended by B1) and clipped box hedges with low flowers inside
    # the front fence, either side of the gate
    # (coordinator review 2026-11-17: no hand-made blob trees) the two yard trees are the village's own vegetation: the
    # "green" broadleaf kind of client/src/village/veg (treeSkeleton TREE_KINDS), grown at runtime by createVegetation; the
    # lot file carries only their spots (asset.extras.vegetation) and the trunks' colliders tree_1 / tree_2
    kit.vegetation = [{"kind": "green", "lx": 9.6, "lz": 6.6, "H": 5.0, "R": 1.3, "seed": 910},
                      {"kind": "green", "lx": -5.6, "lz": 8.6, "H": 4.6, "R": 1.2, "seed": 911}]
    for (x0, x1) in ((-6.9, -3.2), (3.2, 9.0)):
        D.cbox(x0, x1, 0.0, 0.3, 9.5, 9.8, LEAF_DK, c=0.05, skip=("-y",), label="hedge", kind="walkover")
    swings(kit)
    play_tower(kit)
    seesaw(kit)
    sandpit(kit)
    notice(kit)


def swings(kit):
    """A two-seat swing (collider swings x -10.4..-6, z 2..4.4): green-painted timber A-frames, a top beam along x, chains and
    rubber seats (slots swing_1/2 at x -8.9 / -7.5, z 3.2, seat 0.45), terracotta safety tiles under it."""
    D = kit.D
    z = 3.2
    x0, x1 = -10.2, -6.2
    top = 2.35
    for x in (x0, x1):
        for sz in (-1, 1):
            D.member((x, 0.0, z + sz * 1.08), (x, top, z), G.prof_box(0.11, 0.11), OAK)
        D.member((x, 0.9, z - 0.7), (x, 0.9, z + 0.7), G.prof_box(0.08, 0.06), OAK)
    D.member((x0 - 0.12, top + 0.06, z), (x1 + 0.12, top + 0.06, z), G.prof_box(0.12, 0.14), OAK)
    for xs in (-8.9, -7.5):
        for dx in (-0.21, 0.21):
            D.member((xs + dx, top, z), (xs + dx, 0.47, z), G.prof_box(0.012, 0.012), STEEL)
            D.box(xs + dx - 0.03, xs + dx + 0.03, top - 0.06, top, z - 0.03, z + 0.03, IRON)
        D.cbox(xs - 0.25, xs + 0.25, 0.44, 0.48, z - 0.09, z + 0.09, IRON.t(G.hexc("2A2A2A")), c=0.012)
    D.cbox(-10.38, -6.02, 0.0, 0.035, 1.6, 4.8, RUBBER, c=0.008, skip=("-y",), label="swing pad", kind="walkover")


def play_tower(kit):
    """A timber play tower with a blue roof and a stainless slide (collider climber x -10.4..-7, z 6.4..9.2): four posts, a
    deck at 1.2 m with railings, a ladder on the -z side, the slide down the +x side (slot slide at x -8.7, z 7.8)."""
    D = kit.D
    x0, x1, z0, z1 = -10.3, -8.8, 7.0, 8.55
    deck = 1.2
    for x in (x0 + 0.06, x1 - 0.06):
        for z in (z0 + 0.06, z1 - 0.06):
            D.cbox(x - 0.055, x + 0.055, 0.0, 2.35, z - 0.055, z + 0.055, OAK.u((0, 1, 0)), c=0.01, skip=("-y",))
    D.cbox(x0, x1, deck - 0.06, deck, z0, z1, OAK.t(G.hexc("D2AC80")), c=0.01)
    # rails and balusters on the -x and +z sides, a climbing net? (no: a panel with a round window) on -x
    for (a, b) in (((x0 + 0.06, z1 - 0.06), (x1 - 0.06, z1 - 0.06)), ((x0 + 0.06, z0 + 0.06), (x0 + 0.06, z1 - 0.06))):
        D.member((a[0], deck + 0.7, a[1]), (b[0], deck + 0.7, b[1]), G.prof_box(0.05, 0.08), OAK)
        L = math.dist(a, b)
        for i in range(1, 9):
            t = i / 9
            x, z = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
            D.member((x, deck, z), (x, deck + 0.7, z), G.prof_box(0.04, 0.04), OAK)
    # side panels in painted colours on the ladder side (+x of the ladder)
    D.cbox(x0 + 0.1, x1 - 0.1, deck + 0.05, deck + 0.6, z0 + 0.01, z0 + 0.04, YELLOW_PAINT, c=0.008)
    # pyramid roof (blue painted boards) with a little finial flag pole
    ry = 2.35
    D.lathe([(1.15 * math.sqrt(2) / 1.0 * 0.78, 0.0), (0.0, 0.75)], 4, BLUE_PAINT, (x0 + x1) / 2, (z0 + z1) / 2, ry, phase=math.pi / 4, smooth=False)
    D.lathe([(0.8, 0.0), (0.8, 0.06), (0.0, 0.06)], 4, BLUE_PAINT, (x0 + x1) / 2, (z0 + z1) / 2, ry - 0.06, phase=math.pi / 4, smooth=False)
    D.member(((x0 + x1) / 2, ry + 0.7, (z0 + z1) / 2), ((x0 + x1) / 2, ry + 1.05, (z0 + z1) / 2), G.prof_round(0.015, 5), IRON)
    D.slab([(0.0, 0.0), (0.26, -0.08), (0.0, -0.16)], (((x0 + x1) / 2, ry + 1.03, (z0 + z1) / 2), (1, 0, 0), (0, 1, 0)), 0.01, RED_PAINT)
    # ladder on the -z side: two stringers from the deck edge down to z 6.5, rungs
    for x in (-9.85, -9.25):
        D.member((x, 0.0, 6.5), (x, deck + 0.75, z0 + 0.02), G.prof_box(0.05, 0.1), OAK)
    for i in range(1, 6):
        t = i / 6
        y = deck * t
        z = 6.5 + (z0 - 6.5) * t
        D.member((-9.85, y, z), (-9.25, y, z), G.prof_round(0.022, 6), OAK)
    # slide: from the deck's +x edge at z 7.8 down to x -7.1, side boards red, stainless chute, run-out at 0.3
    zc = 7.8
    sx0, sx1 = x1, -7.12
    pts = []
    for i in range(9):
        t = i / 8
        x = sx0 + (sx1 - sx0) * t
        y = deck - (deck - 0.3) * (3 * t * t - 2 * t * t * t) if t < 0.85 else 0.3
        pts.append((x, y))
    for i in range(len(pts) - 1):
        (xa, ya), (xb, yb) = pts[i], pts[i + 1]
        D.poly([(xa, ya, zc - 0.22), (xa, ya, zc + 0.22), (xb, yb, zc + 0.22), (xb, yb, zc - 0.22)], STEEL)
        D.poly([(xa, ya - 0.02, zc + 0.22), (xa, ya - 0.02, zc - 0.22), (xb, yb - 0.02, zc - 0.22), (xb, yb - 0.02, zc + 0.22)], STEEL)
        for sz in (-1, 1):
            q = [(xa, ya - 0.03, zc + sz * 0.25), (xb, yb - 0.03, zc + sz * 0.25), (xb, yb + 0.22, zc + sz * 0.25), (xa, ya + 0.22, zc + sz * 0.25)]
            if G.dot(G.poly_normal(q), (0, 0, sz)) < 0:
                q.reverse()
            D.poly(q, RED_PAINT)
            q2 = [(p[0], p[1], zc + sz * 0.22) for p in q]
            q2.reverse()
            D.poly(q2, RED_PAINT)
            D.poly([(xa, ya + 0.22, zc + sz * 0.22), (xb, yb + 0.22, zc + sz * 0.22), (xb, yb + 0.22, zc + sz * 0.25), (xa, ya + 0.22, zc + sz * 0.25)][:: (1 if sz > 0 else -1)], RED_PAINT)
    for x in (-7.3,):
        for sz in (-1, 1):
            D.member((x, 0.0, zc + sz * 0.2), (x, 0.28, zc + sz * 0.2), G.prof_box(0.05, 0.05), OAK)
    # green safety tiles under the tower and the slide's run-out
    D.cbox(-10.38, -7.02, 0.0, 0.035, 6.42, 9.18, RUBBER_G, c=0.008, skip=("-y",), label="tower pad", kind="walkover")


def seesaw(kit):
    """A log seesaw (collider x 6.4..9.8, z 2.6..3.2): an oak pivot trestle, a round oak beam tilted 8 degrees, red handles,
    rubber tyre bumpers under the ends."""
    D = kit.D
    zc, xc = 2.9, 8.1
    D.cbox(xc - 0.25, xc + 0.25, 0.0, 0.42, zc - 0.25, zc + 0.25, OAK, c=0.02, skip=("-y",))
    tilt = math.radians(8)
    L = 1.62
    a = (xc - L * math.cos(tilt), 0.55 - L * math.sin(tilt), zc)
    b = (xc + L * math.cos(tilt), 0.55 + L * math.sin(tilt), zc)
    D.member(a, b, G.prof_round(0.12, 10), OAK.t(G.hexc("C59A6C")), caps=True)
    for t in (0.12, 0.88):
        p = G.lerp(a, b, t)
        D.member((p[0], p[1] + 0.1, zc - 0.13), (p[0], p[1] + 0.32, zc - 0.13), G.prof_round(0.02, 6), RED_PAINT)
        D.member((p[0], p[1] + 0.1, zc + 0.13), (p[0], p[1] + 0.32, zc + 0.13), G.prof_round(0.02, 6), RED_PAINT)
        D.member((p[0], p[1] + 0.32, zc - 0.13), (p[0], p[1] + 0.32, zc + 0.13), G.prof_round(0.02, 6), RED_PAINT)
    for x in (6.6, 9.6):
        D.lathe([(0.14, 0.0), (0.2, 0.04), (0.2, 0.12), (0.14, 0.16)], 10, IRON.t(G.hexc("2B2B2B")), x, zc, 0.0)


def sandpit(kit):
    """A sandpit with a chunky oak edge you can sit on (walk-over height 0.28), clean sand, a bucket and spade."""
    D = kit.G
    x0, x1, z0, z1 = 3.6, 7.2, 5.0, 8.0
    w = 0.14
    for (a0, a1, b0, b1) in ((x0, x1, z0, z0 + w), (x0, x1, z1 - w, z1), (x0, x0 + w, z0 + w, z1 - w), (x1 - w, x1, z0 + w, z1 - w)):
        D.cbox(a0, a1, 0.0, 0.28, b0, b1, OAK, c=0.02, skip=("-y",), label="sandpit edge", kind="walkover")
    D.box(x0 + w, x1 - w, 0.0, 0.2, z0 + w, z1 - w, SAND, skip=("-y",))
    # a few gentle mounds of sand
    Gd = kit.G
    for (x, z, r) in ((4.6, 6.0, 0.4), (6.2, 7.1, 0.5)):
        Gd.lathe([(r, 0.0), (r * 0.6, 0.04), (0.0, 0.06)], 10, SAND, x, z, 0.2)
    # bucket and spade (red / yellow paint)
    Gd.lathe([(0.0, 0.0), (0.06, 0.0), (0.075, 0.09), (0.07, 0.09), (0.055, 0.01)], 8, RED_PAINT, 5.2, 6.6, 0.2)
    Gd.member((5.5, 0.22, 6.3), (5.75, 0.25, 6.1), G.prof_box(0.02, 0.02), YELLOW_PAINT)
    Gd.box(5.38, 5.52, 0.2, 0.22, 6.32, 6.48, YELLOW_PAINT)


def notice(kit):
    """The school notice board by the gate (collider notice x -4.6..-3, z 9.2..9.5): two oak posts, a glazed oak case with a
    little pitched roof, pinned notices (blank paper, no words), facing the lane (+z)."""
    D = kit.G
    zc = 9.35
    for x in (-4.45, -3.15):
        D.cbox(x - 0.05, x + 0.05, 0.0, 1.95, zc - 0.05, zc + 0.05, OAK.u((0, 1, 0)), c=0.01, skip=("-y",))
    D.cbox(-4.5, -3.1, 0.85, 1.85, zc - 0.07, zc + 0.08, OAK, c=0.012)
    D.box(-4.42, -3.18, 0.93, 1.77, zc + 0.04, zc + 0.05, PAINT.t(G.hexc("CFE0D2")))
    for (x, y, w, h) in ((-4.3, 1.45, 0.28, 0.22), (-3.92, 1.5, 0.22, 0.3), (-3.55, 1.38, 0.3, 0.24), (-4.2, 1.08, 0.24, 0.2), (-3.75, 1.02, 0.3, 0.2)):
        kit.G.box(x, x + w, y, y + h, zc + 0.05, zc + 0.056, PAINT.t(G.hexc("FFFDF5")), skip=("-z",))
    D.box(-4.44, -3.16, 0.91, 1.79, zc + 0.075, zc + 0.08, GLASS)
    D.poly([(-4.6, 1.85, zc + 0.15), (-3.0, 1.85, zc + 0.15), (-3.0, 2.0, zc), (-4.6, 2.0, zc)], OAK_DOOR)
    D.poly([(-3.0, 1.85, zc - 0.15), (-4.6, 1.85, zc - 0.15), (-4.6, 2.0, zc), (-3.0, 2.0, zc)], OAK_DOOR)


# ------------------------------------------------------------------------------------------------ preview ground --

def ground(kit):
    """The render's ground (not exported): lawn round the lot, the yard as vrb2 will lay it (fine paving, rubber pads are in
    the model), the lane in front."""
    g = kit.ground
    LAWN = S("PV_grass")
    PAVE = S("PV_pavers")
    LANE = S("PV_gravel")
    g.poly([(-30, -0.01, -30), (-30, -0.01, 30), (30, -0.01, 30), (30, -0.01, -30)][::-1], LAWN)
    g.poly([(-10.9, 0.0, -2.0), (-10.9, 0.0, 9.9), (10.9, 0.0, 9.9), (10.9, 0.0, -2.0)][::-1], PAVE)
    g.poly([(-2.6, 0.001, 9.9), (-2.6, 0.001, 16.0), (2.6, 0.001, 16.0), (2.6, 0.001, 9.9)][::-1], PAVE)
    g.poly([(-30, 0.002, 12.0), (-30, 0.002, 16.0), (30, 0.002, 16.0), (30, 0.002, 12.0)][::-1], LANE)
