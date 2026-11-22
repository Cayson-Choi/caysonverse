"""케이슨 마을 교회 예배당 (lot_church_nave, interior area lot:lot_church_nave at (440, 40), 7.8 x 10.4, ceiling 7) — the walk-in
room kit (design 11, contract 11, `LOT_INTERIORS` CHURCH_IN), pure python on b2_room / b2_parts / B1's b1_parts, b1_geom.

A calm, light-filled Scandinavian country church, brand-new (owner 2026-11-17: "교회도 마찬가지야", "정말 이런 … 교회가 있었으면"):
soft white board-panelled walls with a sage-grey dado, a warm varnished pine ceiling following the roof up to 7 m, carried
on oak trusses (tie beams, king posts, curved braces), wide pine floorboards, three tall leaded lancets a side (near-clear
glass with an amber-and-blue border, the sky and the garden faint behind it) laying soft sunlight on the floor and the pews,
eight painted pews with oak seats and blue cushions, a raised chancel behind a white turned-baluster rail: the oak communion
table with white linen, two candles and white flowers, the hexagonal oak pulpit with its stair, the simple oak cross on the
east wall under a round window, the hymn board (numbers only), a small oak pipe organ, two brass chandeliers, brass wall
sconces, white hydrangeas. No words, no denomination.
"""
import math

import b1_geom as G
import b1_parts as P
import b2_parts as Q
import b2_room as R2
import flora as F
from b1_geom import Mesh, S

UNIT = "lot_church_nave"
WALL = S("LM_church_paint", G.hexc("FFF8EA"), udir=(0, 1, 0))     # white board panelling (wood_painted, boards upright)
DADO = S("LM_church_paint", G.hexc("C8D2BE"), udir=(0, 1, 0))     # sage-grey dado boards
TRIM = S("LM_church_paint", G.hexc("FFFFFF"))
PAINT_PEW = S("LM_church_paint", G.hexc("F4EEDF"))
PAINT_PEW_DK = S("LM_church_paint", G.hexc("E2D9C4"))
SAGE = S("LM_church_paint", G.hexc("A9BFA4"))
PINE = S("LM_church_pine", G.hexc("F2DDB8"))                       # varnished pine ceiling boards (wood_siding)
FLOOR = S("LM_church_floor", G.hexc("E8D2AE"))                     # wide pine floorboards (floor_wood)
OAK = S("LM_church_oak", G.hexc("B48553"))
OAK_DK = S("LM_church_oak", G.hexc("8A6240"))
OAK_LT = S("LM_church_oak", G.hexc("D6B78C"))
BLUE = S("LM_church_plaster", G.hexc("4F6F9E"))                    # cushions, the pulpit fall, the runner (plaster scan's fine grain)
LINEN = S("LM_church_plaster", G.hexc("FFFDF8"))
LEAF = S("LM_church_plaster", G.hexc("6F9E58"))
PET_W = S("LM_church_plaster", G.hexc("FFFFFF"))
PET_HY = S("LM_church_plaster", G.hexc("E9EEF8"))
WAX = S("LM_church_plaster", G.hexc("FFF8EC"))
BRASS = S("LM_church_brass", G.hexc("E9B85E"))
IRON = S("LM_church_brass", G.hexc("3B3B3E"))
LEAD = S("LM_church_brass", G.hexc("5E6168"))
GLASS = P.GLASS
VIEW = S("M_screen")

MATS = {
    "LM_church_paint": {"set": "wood_painted", "normal": 0.6, "rough": 0.85},
    "LM_church_pine": {"set": "wood_siding", "rough": 0.7},
    "LM_church_floor": {"set": "floor_wood", "rough": 0.75},
    "LM_church_oak": {"set": "wood_oak", "rough": 0.8},
    "LM_church_plaster": {"set": "plaster_painted"},
    "LM_church_brass": {"set": "aluminium_brushed", "rough": 0.42},   # polished brass: a bright dielectric (gold without an environment map)
    "M_glass": {"glass": True},
    "M_screen": {"screen": True},
    "M_fire": {"fire": True},
    "M_lightpool": {"pool": "lot_church_nave_lightpools", "sun": "sun from the west side (the right wall), 40 degrees up (light travels -x, +z a little)"},
}

X, Z, H = 7.8, 10.4, 7.0
WALL_H = 4.8                 # side walls; the ceiling rises from here to the ridge at 7.0
CH_Z = 8.4                   # the chancel step
WIN_Z = (2.95, 5.7, 8.45)
WIN_SILL, WIN_H = 1.7, 2.6
DOORX = 3.9
SUN = G.norm((-0.74, -0.64, 0.2))
PHONE = False


def ceil_y(x):
    """The boarded ceiling: up from the side walls (4.8) to the ridge (7.0) at mid-room."""
    return WALL_H + (H - WALL_H) * (1 - abs(x - X / 2) / (X / 2))


def build(spec, unit, layout, sacred, phone=False):
    global PHONE
    PHONE = phone
    kit = P.Kit(None)
    kit.mats = dict(MATS)
    kit.sacred = []
    kit.room_lights = []
    kit.pools = Mesh("pools")
    kit.fire = {"candles": Mesh("candles")}
    kit.fire_lights = {"light": (3.9, 1.95, 9.35)}   # above and before the altar: not inside the flowers (it burned them white-orange)
    sol = {s["name"]: s for s in spec["solids"]}
    walls(kit)
    ceiling(kit)
    floor(kit)
    chancel(kit, sol)
    pews(kit, spec)
    organ(kit, sol)
    hymn_board(kit, sol)
    lamps(kit)
    glass(kit)
    kit.sun_dir = (0.966, 0.0, -0.26)
    kit.sun_elev = 40
    kit.sun_energy = 7.0
    kit.world_strength = 0.035
    kit.nightfill = [(3.9, 6.0, 3.2, 4.0, 90.0), (3.9, 6.0, 7.4, 4.0, 90.0)]
    kit.look = "AgX - Base Contrast"
    kit.exposure = 0.45
    kit.haze = (0.2, X - 0.2, 0.0, 6.6, 0.2, Z - 0.2, 0.004)
    kit.dayfill = [(3.9, 6.2, 2.4, 4.0, 150.0), (3.9, 6.2, 5.4, 4.0, 150.0), (3.9, 6.2, 8.6, 4.0, 150.0)]
    kit.phone_skip = {"file": "lot_church_nave_phone.glb", "note": "phone: load lot_church_nave_phone.glb (no small goods, plainer trusses)"}
    if phone:
        kit.G = Mesh("goods")
    return kit


def frames():
    return {
        "door": P.F((0.0, 0.0, 0.0), (1, 0, 0), (0, 0, 1)),
        "back": P.F((X, 0.0, Z), (-1, 0, 0), (0, 0, -1)),
        "left": P.F((0.0, 0.0, Z), (0, 0, -1), (1, 0, 0)),
        "right": P.F((X, 0.0, 0.0), (0, 0, 1), (-1, 0, 0)),
    }


# ------------------------------------------------------------------------------------------------ walls --

def walls(kit):
    S_, D, Gd = kit.S, kit.D, kit.G
    F = frames()
    for side in ("left", "right"):
        f = F[side]
        us = [Z - z for z in WIN_Z] if side == "left" else list(WIN_Z)
        holes = []
        for u in us:
            outer, hole = R2.splayed_lancet(S_, f, u, WIN_SILL, 1.0, WIN_H, 0.3, 0.12, TRIM, TRIM)
            holes.append(hole)
            Q.head_fill(S_, f, outer, hole[3], WALL)
            # the sky and the garden faint behind the near-clear glass (unlit)
            view(S_, f, u, WIN_SILL, 1.0, WIN_H, 0.3)
        R2.arch_wall(S_, f, 0.0, Z, 0.0, lambda u: WALL_H, holes, WALL, step=Z / 4)
        dado(kit, f, 0.0, Z, [h for h in holes])
        f.box(D, 0.0, Z, WALL_H - 0.18, WALL_H, 0.0, 0.08, TRIM, skip=("-w", "-u", "+u"))      # cornice under the ceiling
        # brass candle sconces between the windows (above head height)
        for u in ((us[0] + us[1]) / 2, (us[1] + us[2]) / 2):
            sconce(kit, f, u)
    for name in ("door", "back"):
        f = F[name]
        holes = []
        if name == "door":
            holes = [(DOORX - 1.1, DOORX + 1.1, 0.0, 3.4)]
        else:
            holes = [(X / 2 - 0.62, X / 2 + 0.62, 5.0, 6.24)]
        R2.arch_wall(S_, f, 0.0, X, 0.0, lambda u: ceil_y(u), holes, WALL, step=X / 6)
        dado(kit, f, 0.0, X, holes)
        f.box(D, 0.0, X, WALL_H - 0.18, WALL_H, 0.0, 0.08, TRIM, skip=("-w",))
    door_inside(kit, F["door"])
    oculus(kit, F["back"])


def view(m, f, u, sill, w, h, depth):
    """A soft daylight view 1.2 m behind the glass: pale sky over a green garden line (vertex colours on M_screen)."""
    wv = -depth - 1.2
    u0, u1 = u - w / 2 - 0.5, u + w / 2 + 0.5
    bands = [(sill - 0.6, (0.42, 0.58, 0.3)), (sill + 0.4, (0.5, 0.66, 0.36)), (sill + 0.9, (0.66, 0.8, 0.88)), (sill + h + 0.8, (0.62, 0.78, 0.95))]
    for (va, ca), (vb, cb) in zip(bands, bands[1:]):
        q = [f.p(u0, va, wv), f.p(u1, va, wv), f.p(u1, vb, wv), f.p(u0, vb, wv)]
        m.poly(q, VIEW, cols=[(*ca, 1.0), (*ca, 1.0), (*cb, 1.0), (*cb, 1.0)])


def dado(kit, f, u0, u1, holes):
    """Sage-grey board dado to 1.1 m with a white chair rail and a skirting (flat on the wall: within 6 cm)."""
    D = kit.D
    segs = [(u0, u1)]
    for a, b, c, d in holes:
        if c < 1.1:
            new = []
            for s0, s1 in segs:
                if b <= s0 or a >= s1:
                    new.append((s0, s1))
                else:
                    if a > s0:
                        new.append((s0, a))
                    if b < s1:
                        new.append((b, s1))
            segs = new
    for s0, s1 in segs:
        if s1 - s0 < 0.05:
            continue
        f.box(D, s0, s1, 0.0, 1.1, 0.0, 0.015, DADO, skip=("-w", "-u", "+u"))
        f.box(D, s0, s1, 1.04, 1.12, 0.0, 0.045, TRIM, skip=("-w", "-u", "+u"))
        f.box(D, s0, s1, 0.0, 0.16, 0.0, 0.03, TRIM, skip=("-w", "-u", "+u"))


def sconce(kit, f, u):
    D = kit.D
    p = f.p(u, 2.55, 0.0)
    f.box(D, u - 0.06, u + 0.06, 2.4, 2.72, 0.0, 0.02, BRASS)
    arm_end = f.p(u, 2.62, 0.24)
    D.tube([f.p(u, 2.5, 0.02), f.p(u, 2.48, 0.14), arm_end], 0.012, 5, BRASS)
    D.lathe([(0.0, 0.0), (0.055, 0.02), (0.06, 0.035), (0.0, 0.03)], 8, BRASS, arm_end[0], arm_end[2], arm_end[1])
    D.lathe([(0.017, 0.0), (0.017, 0.14), (0.0, 0.145)], 6, WAX, arm_end[0], arm_end[2], arm_end[1] + 0.03)
    R2.candle_flame(kit.fire["candles"], arm_end[0], arm_end[1] + 0.175, arm_end[2], 0.045, 0.012, seed=int(u * 13))
    kit.room_lights.append(("point", arm_end[0], arm_end[1] + 0.25, arm_end[2], (1.0, 0.78, 0.5), 18.0))


def door_inside(kit, f):
    """The panelled oak double doors seen from inside, in a white moulded architrave."""
    S_, D = kit.S, kit.D
    d = 0.25
    for (ua, sg) in ((DOORX - 1.1, 1), (DOORX + 1.1, -1)):
        q = [f.p(ua, 0.0, 0.0), f.p(ua, 3.4, 0.0), f.p(ua, 3.4, -d), f.p(ua, 0.0, -d)]
        if G.dot(G.poly_normal(q), G.mul(f.U, sg)) < 0:
            q.reverse()
        S_.poly(q, TRIM)
    q = [f.p(DOORX - 1.1, 3.4, 0.0), f.p(DOORX + 1.1, 3.4, 0.0), f.p(DOORX + 1.1, 3.4, -d), f.p(DOORX - 1.1, 3.4, -d)]
    if G.poly_normal(q)[1] > 0:
        q.reverse()
    S_.poly(q, TRIM)
    f.quad(D, DOORX - 1.1, DOORX + 1.1, 0.0, 3.4, -d, OAK.u((0, 1, 0)))
    for (a, b) in ((DOORX - 1.04, DOORX - 0.04), (DOORX + 0.04, DOORX + 1.04)):
        for (v0, v1) in ((0.2, 1.3), (1.45, 3.2)):
            f.box(D, a + 0.1, b - 0.1, v0, v1, -d, -d + 0.025, OAK_LT.u((0, 1, 0)), c=0.008)
    f.box(D, DOORX - 0.02, DOORX + 0.02, 0.0, 3.38, -d, -d + 0.02, OAK_DK)
    for uc in (DOORX - 0.14, DOORX + 0.14):
        f.box(D, uc - 0.015, uc + 0.015, 1.0, 1.22, -d, -d + 0.03, BRASS)
    # architrave
    f.box(D, DOORX - 1.26, DOORX - 1.1, 0.0, 3.56, 0.0, 0.05, TRIM, skip=("-w",))
    f.box(D, DOORX + 1.1, DOORX + 1.26, 0.0, 3.56, 0.0, 0.05, TRIM, skip=("-w",))
    f.box(D, DOORX - 1.32, DOORX + 1.32, 3.4, 3.66, 0.0, 0.07, TRIM, skip=("-w",))


def oculus(kit, f):
    """The round window over the cross: a white moulded ring, the leaded clear glass, the sky behind."""
    S_, D = kit.S, kit.D
    uc, vc, r = X / 2, 5.62, 0.62
    R2.circle_fill(S_, f, uc, vc, r - 0.04, 0.62, WALL)
    ring = [f.p(uc + (r + 0.02) * math.cos(2 * math.pi * k / 28), vc + (r + 0.02) * math.sin(2 * math.pi * k / 28), 0.03) for k in range(29)]
    D.tube(ring, 0.05, 5, TRIM)
    f.poly(S_, [(uc + (r - 0.04) * math.cos(-2 * math.pi * k / 24), vc + (r - 0.04) * math.sin(-2 * math.pi * k / 24), -0.15) for k in range(24)], GLASS)
    f.poly(S_, [(uc + (r + 0.4) * math.cos(-2 * math.pi * k / 12), vc + (r + 0.4) * math.sin(-2 * math.pi * k / 12), -1.0) for k in range(12)], VIEW)
    sk = S_.polys[-1]
    sk.col = [(0.66, 0.8, 0.96, 1.0)] * len(sk.pts)
    for k in range(4):
        a = math.pi / 4 * k
        D.member(f.p(uc - (r - 0.05) * math.cos(a), vc - (r - 0.05) * math.sin(a), -0.13), f.p(uc + (r - 0.05) * math.cos(a), vc + (r - 0.05) * math.sin(a), -0.13),
                 G.prof_box(0.02, 0.02), LEAD)
    ring2 = [f.p(uc + 0.24 * math.cos(2 * math.pi * k / 16), vc + 0.24 * math.sin(2 * math.pi * k / 16), -0.13) for k in range(17)]
    D.tube(ring2, 0.012, 4, LEAD)


# ------------------------------------------------------------------------------------------------ ceiling --

def ceiling(kit):
    """Varnished pine boards from the wall heads up to the ridge (two sloped planes), oak trusses at four bays: a tie beam at
    4.8, a king post, two raking principals hidden in the boards' line, curved braces; a ridge board."""
    S_, D = kit.S, kit.D
    for (xa, xb) in ((0.0, X / 2), (X / 2, X)):
        q = [(xa, ceil_y(xa), 0.0), (xb, ceil_y(xb), 0.0), (xb, ceil_y(xb), Z), (xa, ceil_y(xa), Z)]
        if G.poly_normal(q)[1] > 0:
            q.reverse()
        S_.poly(q, PINE.u((0, 0, 1)))
    D.box(X / 2 - 0.1, X / 2 + 0.1, H - 0.2, H, 0.0, Z, OAK_DK, skip=("+y",))
    for z in (2.2, 4.95, 7.7) if not PHONE else (2.2, 7.7):
        D.cbox(0.0, X, WALL_H - 0.28, WALL_H, z - 0.11, z + 0.11, OAK, c=0.02)         # tie beam
        D.cbox(X / 2 - 0.09, X / 2 + 0.09, WALL_H, H - 0.18, z - 0.09, z + 0.09, OAK, c=0.015)   # king post
        for sg in (-1, 1):
            a = (X / 2 + sg * (X / 2 - 0.05), WALL_H + 0.02, z)
            b = (X / 2 + sg * 0.1, H - 0.22, z)
            D.member(G.add(a, (0, -0.12, 0)), G.add(b, (0, -0.12, 0)), G.prof_box(0.16, 0.18), OAK)
            # a curved brace under the tie beam's end (above head height)
            path = []
            for k in range(7):
                t = k / 6
                ang = math.pi / 2 * t
                px = (0.0 if sg < 0 else X) - sg * (0.95 * (1 - math.cos(ang)))
                py = WALL_H - 0.28 - 0.95 * (1 - math.sin(ang)) * 1.0
                path.append((px + sg * 0.0, py, z))
            D.tube(path, 0.06, 6, OAK)
            # small turned pendant drop at the king post's foot
        D.lathe([(0.05, 0.0), (0.08, 0.06), (0.05, 0.14), (0.0, 0.2)], 8, OAK_DK, X / 2, z, WALL_H - 0.48)
    # moulded crown boards where the slopes meet the walls
    for x in (0.0, X):
        D.box(min(x, x + (0.12 if x == 0 else -0.12)), max(x, x + (0.12 if x == 0 else -0.12)), WALL_H - 0.04, WALL_H + 0.1, 0.0, Z, TRIM)


# ------------------------------------------------------------------------------------------------ floor --

def floor(kit):
    S_, Gd = kit.S, kit.G
    S_.poly([(0.0, 0.0, 0.0), (0.0, 0.0, Z), (X, 0.0, Z), (X, 0.0, 0.0)], FLOOR.u((0, 0, 1)))
    # a soft blue wool runner up the aisle (walkover height)
    Gd.poly([(3.25, 0.008, 0.3), (3.25, 0.008, CH_Z - 0.05), (4.55, 0.008, CH_Z - 0.05), (4.55, 0.008, 0.3)], BLUE.t(G.hexc("5E7DAA")).u((0, 0, 1)))
    for x in (3.3, 4.47):
        Gd.poly([(x, 0.009, 0.3), (x, 0.009, CH_Z - 0.05), (x + 0.03, 0.009, CH_Z - 0.05), (x + 0.03, 0.009, 0.3)], LINEN)


# ------------------------------------------------------------------------------------------------ chancel --

def chancel(kit, sol):
    S_, D, Gd = kit.S, kit.D, kit.G
    fire = kit.fire["candles"]
    r = sol["chancel"]["rect"]
    x0, x1, z0, z1 = r["x0"], r["x1"], r["z0"], r["z1"]
    # the platform: pine boards on an oak-nosed step (0.3), covering the chancel solid
    D.box(x0, x1, 0.0, 0.3, z0, z1, FLOOR.u((1, 0, 0)), skip=("-y", "+z"))
    D.box(x0, x1, 0.27, 0.31, z0, z0 + 0.06, OAK, skip=("-y",))
    # communion rail: white turned balusters, an oak top rail, a gap at the middle; kneeling cushion strip
    bal = Mesh("baluster")
    bal.lathe([(0.04, 0.0), (0.04, 0.05), (0.025, 0.1), (0.045, 0.25), (0.025, 0.4), (0.035, 0.46), (0.0, 0.47)], 6, TRIM)
    zr = z0 + 0.2
    for (a, b) in ((x0 + 0.3, 3.3), (4.5, x1 - 0.3)):
        D.box(a, b, 0.3, 0.36, zr - 0.06, zr + 0.06, TRIM)
        D.cbox(a - 0.03, b + 0.03, 0.83, 0.9, zr - 0.08, zr + 0.08, OAK, c=0.015)
        x = a + 0.1
        while x < b - 0.06:
            kit.place("baluster", bal, x, 0.36, zr, 0.0)
            x += 0.18
        for x in (a, b):
            D.cbox(x - 0.05, x + 0.05, 0.3, 0.83, zr - 0.05, zr + 0.05, TRIM, c=0.012)
    # the communion table: oak with a carved apron and turned legs, white linen, two brass candlesticks, white flowers
    tx0, tx1, tz0, tz1 = 2.9, 4.9, 9.35, 10.05
    for x in (tx0 + 0.07, tx1 - 0.07):
        for z in (tz0 + 0.07, tz1 - 0.07):
            D.lathe([(0.05, 0.0), (0.05, 0.1), (0.035, 0.2), (0.05, 0.42), (0.035, 0.7), (0.045, 0.78), (0.0, 0.79)], 8, OAK, x, z, 0.3)
    D.cbox(tx0 + 0.03, tx1 - 0.03, 0.95, 1.09, tz0 + 0.03, tz1 - 0.03, OAK, c=0.012)
    D.cbox(tx0 - 0.05, tx1 + 0.05, 1.09, 1.14, tz0 - 0.05, tz1 + 0.05, OAK_DK, c=0.012)
    # white linen: the top cloth (flat, a soft rolled edge) and a frontal falling in soft folds with a gilt-thread hem
    k0 = len(D.polys)
    D.cbox(tx0 - 0.04, tx1 + 0.04, 1.14, 1.152, tz0 - 0.04, tz1 + 0.04, LINEN, c=0.005)
    F.flat_from(D, k0)
    F.drape(D, tx0 + 0.3, tx1 - 0.3, 0.84, 1.15, tz0 - 0.045, LINEN, folds=6, depth=0.01, face=-1,
            hem=S("LM_church_brass", G.hexc("F2CE7A")), seed=3)
    for x in (tx0 + 0.3, tx1 - 0.3):
        D.lathe([(0.07, 0.0), (0.068, 0.012), (0.06, 0.02), (0.03, 0.045), (0.022, 0.07), (0.03, 0.1), (0.02, 0.13),
                 (0.02, 0.22), (0.032, 0.235), (0.05, 0.255), (0.052, 0.268), (0.02, 0.272), (0.0, 0.272)], 16, BRASS, x, 9.75, 1.15)
        F.candle(D, x, 1.422, 9.75, 0.019, 0.3, WAX)
        R2.candle_flame(fire, x, 1.732, 9.75, 0.045, 0.011, seed=int(x * 10))
    bouquet(Gd, 3.9, 1.15, 9.75, 0.35)
    D.cbox(3.62, 4.18, 1.15, 1.2, 9.48, 9.62, S("LM_church_plaster", G.hexc("2F3E5E")), c=0.008)   # a closed book (blue cloth)
    # an oak reredos behind the table: a panelled dado with three pointed arches and a moulded cresting, a soft blue
    # arched panel above it framing the cross
    reredos(kit)
    # the cross on the east wall (the sacred builder's oak cross, merged), a soft light on it
    R2.merge_prop(D, "lotprop__lot_church_nave_cross", (X / 2, 2.35, Z - 0.035), math.pi, {"M_pbr_wood_oak": OAK.t(G.hexc("A8774A"))})
    kit.room_lights.append(("spot", X / 2, 5.6, 6.6, (1.0, 0.9, 0.76), 260.0, (X / 2, 3.2, Z), 26))
    kit.room_lights.append(("point", X / 2, 1.95, 9.35, (1.0, 0.72, 0.45), 8.0))
    # the pulpit: hexagonal oak drum on a turned stem, a stair of four treads from the chancel, a blue fall, a book rest
    pulpit(kit, 1.2, 9.1)
    # flower stands with white hydrangeas either side
    for x in (0.75, 7.05):
        D.lathe([(0.15, 0.0), (0.12, 0.05), (0.05, 0.12), (0.04, 0.85), (0.15, 0.92), (0.0, 0.94)], 8, OAK, x, 10.0, 0.3)
        hydrangea(Gd, x, 1.24, 10.0)


def reredos(kit):
    D = kit.D
    f = frames()["back"]
    u0, u1 = X / 2 - 1.5, X / 2 + 1.5
    f.box(D, u0, u1, 0.3, 1.9, 0.0, 0.05, OAK, c=0.012)
    for k in range(3):
        a = u0 + 0.12 + (u1 - u0 - 0.24) * k / 3
        b = u0 + 0.12 + (u1 - u0 - 0.24) * (k + 1) / 3 - 0.06
        pts = Q.pointed((a + b) / 2, 1.35, b - a, 5, 1.0)
        f.poly(D, [(a, 0.45, 0.052), (b, 0.45, 0.052)] + [(p[0], p[1], 0.052) for p in reversed(pts)], OAK_LT)
        Q.arch_ring(D, f, pts, 0.03, 0.05, 0.058, OAK_DK, side=False)
    f.box(D, u0 - 0.05, u1 + 0.05, 1.9, 2.0, 0.0, 0.06, OAK_DK, c=0.012)
    for k in range(9):
        u = u0 + (u1 - u0) * (k + 0.5) / 9
        p = f.p(u, 2.0, 0.03)
        D.lathe([(0.03, 0.0), (0.0, 0.12)], 4, OAK_DK, p[0], p[2], 2.0, phase=math.pi / 4, smooth=False)
    # the soft blue arched panel behind the cross (painted boards), with a thin gilt line
    pts = Q.pointed(X / 2, 3.9, 1.7, 8, 0.75)
    f.poly(D, [(X / 2 - 0.85, 2.05, 0.012), (X / 2 + 0.85, 2.05, 0.012)] + [(p[0], p[1], 0.012) for p in reversed(pts)], S("LM_church_paint", G.hexc("B8CCE0"), udir=(0, 1, 0)))
    Q.arch_ring(D, f, pts, 0.04, 0.0, 0.02, S("LM_church_brass", G.hexc("F2CE7A")), side=False)
    f.box(D, X / 2 - 0.89, X / 2 - 0.85, 2.05, 3.9, 0.0, 0.02, S("LM_church_brass", G.hexc("F2CE7A")))
    f.box(D, X / 2 + 0.85, X / 2 + 0.89, 2.05, 3.9, 0.0, 0.02, S("LM_church_brass", G.hexc("F2CE7A")))


def pulpit(kit, x, z):
    D = kit.D
    y = 0.3
    D.lathe([(0.25, 0.0), (0.2, 0.06), (0.1, 0.14), (0.09, 0.85), (0.3, 1.0), (0.0, 1.0)], 6, OAK, x, z, y, phase=math.pi / 6, smooth=False)
    yb = y + 1.0
    n = 6
    R = 0.45
    for k in range(n):
        a0, a1 = 2 * math.pi * k / n + math.pi / 6, 2 * math.pi * (k + 1) / n + math.pi / 6
        p0 = (x + R * math.cos(a0), z + R * math.sin(a0))
        p1 = (x + R * math.cos(a1), z + R * math.sin(a1))
        if k == 4:
            continue   # the open back toward the stair
        q = [(p0[0], yb, p0[1]), (p1[0], yb, p1[1]), (p1[0], yb + 0.95, p1[1]), (p0[0], yb + 0.95, p0[1])]
        mid = ((p0[0] + p1[0]) / 2 - x, 0, (p0[1] + p1[1]) / 2 - z)
        if G.dot(G.poly_normal(q), mid) < 0:
            q.reverse()
        D.poly(q, OAK)
        D.poly(list(reversed([(p[0] * 0.94 + x * 0.06, p[1], p[2] * 0.94 + z * 0.06) for p in q])), OAK)
        # a raised panel with a pointed arch on each face
        c = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
        out = G.norm((c[0] - x, 0, c[1] - z))
        f = P.F((c[0], 0.0, c[1]), G.norm((p1[0] - p0[0], 0.0, p1[1] - p0[1])), out)
        pts = Q.pointed(0.0, yb + 0.6, 0.3, 4, 1.0)
        f.poly(D, [(-0.15, yb + 0.15, 0.012), (0.15, yb + 0.15, 0.012)] + [(p[0], p[1], 0.012) for p in reversed(pts)], OAK_LT)
    D.lathe([(R + 0.05, 0.0), (R + 0.06, 0.06), (R - 0.02, 0.08)], 6, OAK_DK, x, z, yb + 0.95, phase=math.pi / 6, smooth=False)
    D.lathe([(R - 0.03, 0.0), (R - 0.03, 0.04)], 6, OAK, x, z, yb - 0.02, phase=math.pi / 6, cap_top=True, smooth=False)
    # the book rest facing the nave, with a blue fall
    D.member((x - 0.22, yb + 1.0, z - 0.42), (x + 0.22, yb + 1.0, z - 0.42), G.prof_box(0.04, 0.06), OAK_DK)
    D.box(x - 0.2, x + 0.2, yb + 0.55, yb + 0.95, z - 0.47, z - 0.455, BLUE)
    D.box(x - 0.21, x + 0.21, yb + 0.93, yb + 0.97, z - 0.48, z - 0.44, S("LM_church_brass", G.hexc("E8C27C")))
    # the stair: four oak treads rising from the chancel floor behind it (inside the chancel)
    for k in range(4):
        t0 = z + 0.45 + 0.18 * k
        D.cbox(x - 0.32, x + 0.32, 0.3 + 0.2 * k, 0.3 + 0.2 * (k + 1), min(t0, 10.3), min(t0 + 0.6, 10.38), OAK, c=0.01)


def bouquet(m, x, y, z, h):
    """White altar flowers in a low porcelain vase: open lilies, white roses, two lily buds, baby's breath and glossy
    leaves (flora.py: every bloom built from its petals)."""
    k0 = len(m.polys)
    m.lathe([(0.05, 0.0), (0.06, 0.01), (0.075, 0.05), (0.07, 0.11), (0.05, 0.16), (0.058, 0.19), (0.062, 0.2), (0.0, 0.2)], 20, LINEN, x, z, y)
    F.flat_from(m, k0)
    rg = G.rng(int(x * 31 + z))
    top = y + 0.19
    green = LEAF.t(G.hexc("3F6E35"))
    blooms = [("lily", -0.1, 0.27, 0.02, 0.4), ("lily", 0.09, 0.3, -0.02, -0.6), ("lily", 0.0, 0.36, 0.04, 2.0),
              ("rose", -0.05, 0.22, -0.05, 0.0), ("rose", 0.05, 0.21, 0.05, 0.0), ("rose", 0.13, 0.17, 0.0, 0.0), ("rose", -0.14, 0.18, -0.01, 0.0)]
    for kind, dx, dy, dz, tilt in blooms:
        c = (x + dx, top + dy, z + dz)
        F.stem(m, (x + dx * 0.2, top - 0.05, z + dz * 0.2), c, 0.004, green, bend=(dx * 0.3, 0.0, dz * 0.3))
        if kind == "lily":
            F.lily(m, c, 0.085, PET_W, G.hexc("FFFFFF"), throat=G.hexc("E6EDC4"), seed=int(dy * 100) + 7, stamen_s=LEAF)
        else:
            F.rose(m, c, 0.04, PET_W, G.hexc("FBF6EC"), open_=0.55, seed=int(dx * 100) + 50, centre_dk=0.9)
    for (dx, dz, dy) in ((0.06, -0.06, 0.42), (-0.07, 0.05, 0.4)):
        b = (x + dx, top + dy - 0.1, z + dz)
        F.stem(m, (x, top - 0.05, z), b, 0.004, green)
        F.lily_bud(m, b, (dx, 1.0, dz), 0.1, PET_W, G.hexc("FFFFFF"))
    for k in range(9):
        a = 2 * math.pi * k / 9 + rg.uniform(-0.2, 0.2)
        F.leaf(m, (x + 0.03 * math.cos(a), top + rg.uniform(0.02, 0.08), z + 0.03 * math.sin(a)), (math.cos(a), 0, math.sin(a)),
               rg.uniform(0.11, 0.15), 0.04, green, rise=0.7, fall=1.3, c0=G.hexc("2E5A2A"), c1=G.hexc("4F8A3E"), seed=k)
    F.babys_breath(m, (x - 0.02, top + 0.2, z - 0.03), 0.12, LEAF, seed=5, n=28)


def hydrangea(m, x, y, z):
    """A white porcelain urn of hydrangea heads (florets of four petals) with their broad toothed leaves."""
    rg = G.rng(int(x * 17))
    k0 = len(m.polys)
    m.lathe([(0.1, 0.0), (0.12, 0.02), (0.14, 0.06), (0.125, 0.2), (0.14, 0.24), (0.15, 0.26), (0.0, 0.26)], 20, LINEN, x, z, y)
    F.flat_from(m, k0)
    green = LEAF.t(G.hexc("3F6E35"))
    for k, (dx, dy, dz, r) in enumerate(((0.0, 0.42, 0.0, 0.12), (-0.13, 0.36, 0.06, 0.1), (0.12, 0.35, -0.05, 0.1), (0.04, 0.33, 0.14, 0.09), (-0.05, 0.34, -0.13, 0.09))):
        c = (x + dx, y + dy, z + dz)
        F.stem(m, (x + dx * 0.3, y + 0.22, z + dz * 0.3), c, 0.006, green)
        F.hydrangea(m, c, r, PET_HY, G.hexc("F4F6FB"), seed=k + int(x * 10), col2=G.hexc("E3ECF6"))
    for k in range(8):
        a = 2 * math.pi * k / 8 + rg.uniform(-0.2, 0.2)
        F.leaf(m, (x + 0.08 * math.cos(a), y + 0.27, z + 0.08 * math.sin(a)), (math.cos(a), 0, math.sin(a)), 0.16, 0.08, green,
               rise=0.5, fall=1.1, c0=G.hexc("2E5A2A"), c1=G.hexc("5A8F45"), seed=40 + k)


# ------------------------------------------------------------------------------------------------ pews, organ, hymn board --

PEW = R2.pew_kind("pew", 2.6, PAINT_PEW, PAINT_PEW_DK, BLUE, None)


def pews(kit, spec):
    for s in spec["seats"]:
        R2.pew_place(kit, "pew", PEW, s["x"], s["z"])


def organ(kit, sol):
    """A small oak chamber organ against the right wall: a panelled case with the keyboard toward the room, a gilt-capped
    façade of tin pipes above it, its oak bench (inside the organ's box)."""
    D, Gd = kit.D, kit.G
    r = sol["organ"]["rect"]
    x0, x1, z0, z1 = r["x0"], r["x1"], r["z0"], r["z1"]
    cb = x0 + 0.32
    D.cbox(cb, x1 - 0.02, 0.0, 1.25, z0 + 0.02, z1 - 0.02, OAK, c=0.015)
    D.cbox(cb - 0.22, cb, 0.78, 0.86, z0 + 0.06, z1 - 0.06, OAK_DK, c=0.01)                 # key cheek
    D.box(cb - 0.2, cb - 0.02, 0.86, 0.88, z0 + 0.1, z1 - 0.1, LINEN)                         # the keys
    D.box(cb - 0.2, cb - 0.12, 0.88, 0.9, z0 + 0.1, z1 - 0.1, S("LM_church_plaster", G.hexc("2A2622")))
    D.cbox(x0 + 0.02, x0 + 0.3, 0.45, 0.5, z0 + 0.08, z1 - 0.08, OAK, c=0.01)                # bench
    for z in (z0 + 0.12, z1 - 0.12):
        D.box(x0 + 0.06, x0 + 0.26, 0.0, 0.45, z - 0.025, z + 0.025, OAK)
    for k in range(7):
        t = (k + 0.5) / 7
        z = z0 + 0.08 + (z1 - z0 - 0.16) * t
        hh = 0.8 + 0.7 * (1 - abs(2 * t - 1))
        Gd.lathe([(0.01, 0.0), (0.04, 0.16), (0.04, hh), (0.038, hh + 0.01)], 8, S("LM_church_brass", G.hexc("E6E8EA")), x1 - 0.2, z, 1.25)
    D.cbox(x1 - 0.32, x1 - 0.02, 2.85, 2.95, z0, z1, OAK_DK, c=0.012)
    for z in (z0 + 0.02, z1 - 0.02):
        D.box(x1 - 0.3, x1 - 0.05, 1.25, 2.85, z - 0.02, z + 0.02, OAK)


def hymn_board(kit, sol):
    """The hymn board between the 2nd and 3rd west windows: an oak board with a pointed top, a navy plate and gilt 3D Korean
    letters: the header "오늘의 찬송" and three rows, the hymn number (새찬송가, large, gilt) and its title (smaller, cream)."""
    D = kit.D
    zc, hw = 7.075, 0.8                       # centred between the windows (their midpoint, like the painting opposite)
    z0, z1 = zc - hw, zc + hw
    y0, ys, body = 0.72, 2.05, 0.06            # bottom, springing line of the point, oak frame width
    D.cbox(0.0, 0.04, y0, ys, z0, z1, OAK, c=0.01)
    D.box(0.04, 0.048, y0 + body, ys, z0 + body, z1 - body, S("LM_church_plaster", G.hexc("2F3E5E")))
    f = P.F((0.0, 0.0, zc), (0, 0, -1), (1, 0, 0))     # u = the viewer's right (-z), w = out of the wall (+x)
    navy = S("LM_church_plaster", G.hexc("2F3E5E"))
    rise = 0.28                                 # a shallow gable: the sconce above the board sits at 2.4 m
    f.poly(D, [(-hw, ys, 0.04), (0.0, ys + rise, 0.04), (hw, ys, 0.04)], OAK)
    f.poly(D, [(-hw + body, ys, 0.048), (0.0, ys + rise - 0.075, 0.048), (hw - body, ys, 0.048)], navy)
    gilt = S("LM_church_brass", G.hexc("F2CE7A"))
    cream = S("LM_church_plaster", G.hexc("FFF4D6"))

    def at(u, y):
        return (0.048, y, zc - u)

    def text(s, u, y, size, surf, align):
        kit.letters.append((s, at(u, y), (1, 0, 0), size, 0.008, surf, "D", {"align": align}))

    text("오늘의 찬송", 0.0, 2.0, 0.1, gilt, "CENTER")
    f.box(D, -0.62, 0.62, 1.9, 1.915, 0.048, 0.054, gilt)                      # gilt rule under the header
    for k, (num, title) in enumerate((("79장", "주 하나님 지으신"), ("288장", "예수를 나의 구주"), ("305장", "나 같은 죄인"))):
        y = 1.66 - k * 0.3
        text(num, -0.2, y, 0.13, gilt, "RIGHT")
        text(title, -0.1, y, 0.08, cream, "LEFT")


# ------------------------------------------------------------------------------------------------ lamps + glass --

CHANDELIER = R2.chandelier_kind(BRASS, WAX, arms=8, r=0.5)


def lamps(kit):
    for z in (3.6, 6.9):
        y = 3.3
        kit.place("chandelier", CHANDELIER, X / 2, y, z, 0.0)
        kit.D.member((X / 2, y + 0.66, z), (X / 2, H - 0.2, z), G.prof_round(0.012, 4), BRASS)
        kit.room_lights.append(("point", X / 2, y + 0.35, z, (1.0, 0.8, 0.55), 110.0, None, 0.4))


GLASS_HW = {"M_pbr_cast_iron": IRON, "M_lead": LEAD}
POOL_CELL = (0.0, 0.0, 196 / 512, 510 / 512)


def glass(kit):
    f = "lotglass__lot_church_nave_glass_church_clear"
    depth = 0.3
    for side, xg, yaw in (("w", X + depth, -math.pi / 2), ("e", -depth, math.pi / 2)):
        for k, z in enumerate(WIN_Z):
            R2.place(kit, "lotglass__%s_%s%d" % (UNIT, side, k + 1), f, (xg, WIN_SILL, z), yaw, "leaded lancet (near-clear, amber and blue border)",
                     glow=1.1, drawOnly=f)
            R2.merge_prop(kit.D, f, (xg, WIN_SILL, z), yaw, GLASS_HW, keep=lambda node, mat: not (PHONE and node.endswith("_came")))
            if side == "w":
                win = [(xg, WIN_SILL, z - 0.5), (xg, WIN_SILL, z + 0.5), (xg, WIN_SILL + WIN_H, z + 0.5), (xg, WIN_SILL + WIN_H, z - 0.5)]
                R2.light_pool(kit.pools, "M_lightpool", win, SUN, POOL_CELL)
