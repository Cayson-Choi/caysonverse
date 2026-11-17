"""케이슨 마을 교회 (lot_church, plot_s, door north to the plaza) — the exterior kit (design 3.5, contract 9 B2), pure python on
b2_parts / b1_parts / b1_geom, lot LOCAL frame (x = right hand going in, z = out of the door, y up).

A brand-new white country church after the Norwegian and Swedish wooden churches (Hopen, Dale, Strandebarm, Sandhem):
white-painted clapboard on a granite plinth with crisp corner boards, a dark shingle roof, a square white tower rising from the
front gable with louvred belfry openings (the bell inside) and a slender octagonal spire in dark standing-seam metal with a
copper orb and cross at 22 m, tall pointed lancets in pale sage frames (the same leaded glass as inside), a columned porch with
a pediment over panelled oak double doors, the name board over the porch, benches, two lantern posts and the "환영합니다" board
on the lawn, low lavender and white flowers. Distinct from the 성당: white wood, not stone; lancets, not a rose; a needle spire.
"""
import math

import b1_geom as G
import b1_parts as P
import b2_parts as Q
from b1_geom import Mesh, S

LOT = "lot_church"
SIDING = S("LM_church_paint", G.hexc("FFFFFF"), udir=(0, 1, 0))   # white-painted clapboard: the painted-plank set turned so the boards run level
PINE = S("LM_church_siding", G.hexc("F3E2C6"))         # varnished pine boards (wood_siding): the porch ceiling, the vestibule
TRIM = S("LM_church_paint", G.hexc("FFFFFF"))         # corner boards, cornices, porch (wood_painted)
SAGE = S("LM_church_paint", G.hexc("A9BFA4"))         # window frames: pale sage
ROOF = S("LM_church_roof", G.hexc("9C9EA5"))          # dark slate-grey shingles (roof_shingle)
GRAN = S("LM_church_granite", G.hexc("E4E1DA"))
OAK = S("LM_church_oak", G.hexc("9A6A3E"))
OAK_LT = S("LM_church_oak", G.hexc("D7B88D"))
IRON = S("LM_church_iron", G.hexc("2F3033"))
SPIRE_M = S("LM_church_metal", G.hexc("5E646C"))      # standing-seam metal spire (metal_roof_seam)
COPPER = S("LM_church_copper")
GOLD = S("LM_church_copper", G.hexc("FFE3A0"))
LEAF = S("LM_church_green", G.hexc("9CC46E"))
BOX = S("LM_church_green", G.hexc("7FAF5E"))
PET_W = S("LM_church_green", G.hexc("FFFDF6"))
PET_LAV = S("LM_church_green", G.hexc("9C82D8"))
LAV_STEM = S("LM_church_green", G.hexc("A7B89A"))
PET_PINK = S("LM_church_green", G.hexc("F2A2B8"))
DARK = S("LM_church_paint", G.hexc("4A4440"))           # the dim nave seen through the glass
GLASS = P.GLASS

MATS = {
    "LM_church_siding": {"set": "wood_siding", "rough": 0.85},
    "LM_church_roof": {"set": "roof_shingle"},
    "LM_church_paint": {"set": "wood_painted", "normal": 0.6, "rough": 0.9},
    "LM_church_granite": {"set": "granite_flamed"},
    "LM_church_oak": {"set": "wood_oak", "rough": 0.85},
    "LM_church_iron": {"set": "cast_iron", "metal": True},
    "LM_church_metal": {"set": "metal_roof_seam", "metal": True},
    "LM_church_copper": {"set": "copper_new", "metal": True},
    "LM_church_green": {"set": "grass", "normal": 0.5},
    "M_glass": {"glass": True},
}
PREVIEW = {"PV_grass": {"set": "grass"}, "PV_flags": {"set": "plaza_granite"}}

SX = 4.1            # side wall faces (body x +-4.2)
FZ = 2.9            # front wall face (body z1 = 3)
BZ = -8.0           # back wall: on the footprint's edge (no overhang past it)
EAVE = 6.0
RIDGE = 10.0
RX = 4.45           # roof eave line
TOWER = (-1.4, 1.4, 0.1, 2.94)   # x0, x1, z0, z1 (bell slot at z 1.5)
T1 = 11.0           # top of the clapboard stage
T2 = 13.0           # top of the belfry
SPIRE_TOP = 21.4
WIN_Z = (-1.4, -4.2, -7.0)
WIN_SILL, WIN_H = 2.0, 2.6
DOOR_W, DOOR_H = 2.2, 3.4


def roof_y(x):
    return RIDGE - (RIDGE - EAVE + 0.06) * abs(x) / RX


def build(lot, layout):
    kit = P.Kit(lot)
    kit.mats = dict(MATS)
    kit.mats.update(PREVIEW)
    body(kit)
    roof(kit)
    tower(kit)
    porch(kit)
    grounds(kit)
    ground(kit)
    kit.roof_slabs = [{"rect": [-2.2, 2.2, 3.0, 4.8], "minY": 3.62, "topY": 4.9, "what": "porch roof (beam underside 3.62)"}]
    kit.look = "AgX - Base Contrast"
    return kit


def fr():
    return {
        "front": P.F((0.0, 0.0, FZ), (1, 0, 0), (0, 0, 1)),
        "back": P.F((0.0, 0.0, BZ + 0.1), (-1, 0, 0), (0, 0, -1)),
        "right": P.F((SX, 0.0, (FZ + BZ) / 2), (0, 0, -1), (1, 0, 0)),
        "left": P.F((-SX, 0.0, (FZ + BZ) / 2), (0, 0, 1), (-1, 0, 0)),
    }


def body(kit):
    S_, D, Gd = kit.S, kit.D, kit.G
    F = fr()
    half = (FZ - BZ - 0.1) / 2
    zc = (FZ + BZ + 0.1) / 2
    for side in ("right", "left"):
        f = F[side]
        us = [-(z - zc) for z in WIN_Z] if side == "right" else [z - zc for z in WIN_Z]
        holes = [(u - 0.55, u + 0.55, WIN_SILL - 0.05, WIN_SILL + WIN_H + 0.05) for u in us]
        P.wall(S_, f, -half, half, 0.0, EAVE, holes, SIDING)
        for k, u in enumerate(us):
            window(kit, f, u)
        f.box(D, -half, half, 0.0, 0.55, 0.0, 0.1, GRAN, skip=("-w", "-v"))
        f.box(S_, -half - 0.02, half + 0.02, EAVE - 0.28, EAVE, 0.0, 0.06, TRIM, skip=("-w",))
        f.box(S_, -half, half, 0.55, 0.72, 0.0, 0.05, TRIM, skip=("-w",))
        for u in (-half, half):
            a, b = (u, u + 0.2) if u < 0 else (u - 0.2, u)
            f.box(S_, a, b, 0.55, EAVE - 0.28, 0.0, 0.07, TRIM, skip=("-w",))
        # low lavender and white flowers along the wall (walkover height)
        for k in range(int((2 * half - 0.8) / 0.55)):
            u = -half + 0.5 + k * 0.55
            p = f.p(u, 0.0, 0.35)
            if any(abs(u - w) < 0.7 for w in us) and k % 2:
                kit.place("flower_w", FLOWER_W, p[0], 0.0, p[2], u * 3.1)
            else:
                kit.place("lavender", LAVENDER, p[0], 0.0, p[2], u * 2.3)
    # front and back gables
    for name in ("front", "back"):
        f = F[name]
        holes = []
        if name == "front":
            holes = [(-DOOR_W / 2 - 0.12, DOOR_W / 2 + 0.12, 0.0, DOOR_H + 0.12)]
        P.wall(S_, f, -SX, SX, 0.0, EAVE, holes, SIDING)
        f.poly(S_, [(-SX, EAVE, 0.0), (SX, EAVE, 0.0), (0.0, RIDGE - 0.05, 0.0)], SIDING)
        if name == "back":
            f.box(D, -SX - 0.1, SX + 0.1, 0.0, 0.55, 0.0, 0.1, GRAN, skip=("-w", "-v"))
        for u in (-SX, SX):
            a, b = (u, u + 0.2) if u < 0 else (u - 0.2, u)
            f.box(S_, a, b, 0.55, EAVE, 0.0, 0.07, TRIM, skip=("-w",))
        f.box(S_, -SX, SX, EAVE - 0.12, EAVE + 0.06, 0.0, 0.1, TRIM, skip=("-w",))   # the gable's cornice return line
    f = F["front"]
    for (a, b) in ((-SX - 0.1, -DOOR_W / 2 - 0.15), (DOOR_W / 2 + 0.15, SX + 0.1)):
        f.box(D, a, b, 0.0, 0.55, 0.0, 0.1, GRAN, skip=("-w", "-v"))
    # the back gable: a small round window
    fb = F["back"]
    fb.box(D, -0.5, 0.5, 7.3, 8.3, 0.0, 0.04, TRIM)
    fb.box(D, -0.38, 0.38, 7.42, 8.18, 0.04, 0.05, DARK)


LAVENDER = Q.lavender_kind("lavender", LAV_STEM, PET_LAV)
FLOWER_W = Q.flower_low_kind("flower_w", LEAF, PET_W)
FLOWER_P = Q.flower_low_kind("flower_p", LEAF, PET_PINK)


def window(kit, f, u):
    """A pointed lancet in the clapboard: a flat white casing with a pointed head and a sill, pale sage sash and glazing bars,
    the glass and the dim nave behind; it glows warm at night."""
    S_, D = kit.S, kit.D
    w, sill, h = 1.1, WIN_SILL - 0.05, WIN_H + 0.1
    sp = sill + h - Q.apex_of(0.0, w, 1.0)
    pts = Q.pointed(u, sp, w, 6, 1.0)
    Q.head_fill(S_, f, pts, sill + h, SIDING)
    d = 0.16
    for (ua, sg) in ((u - w / 2, 1), (u + w / 2, -1)):
        q = [f.p(ua, sill, 0), f.p(ua, sp, 0), f.p(ua, sp, -d), f.p(ua, sill, -d)]
        if G.dot(G.poly_normal(q), G.mul(f.U, sg)) < 0:
            q.reverse()
        S_.poly(q, TRIM)
    for a, b in zip(pts, pts[1:]):
        q = [f.p(a[0], a[1], 0), f.p(b[0], b[1], 0), f.p(b[0], b[1], -d), f.p(a[0], a[1], -d)]
        mid = G.mul(G.add(q[0], q[1]), 0.5)
        if G.dot(G.poly_normal(q), G.sub(f.p(u, sp, 0), mid)) < 0:
            q.reverse()
        S_.poly(q, TRIM)
    outline = [(u - w / 2, sill), (u + w / 2, sill)] + list(reversed(pts))
    f.poly(S_, [(a, b, -d) for a, b in outline], GLASS)
    f.poly(D, [(a, b, -d - 0.5) for a, b in outline], DARK)
    # the casing: flat boards with a pointed head and a hood, a sloped sill on brackets
    f.box(D, u - w / 2 - 0.14, u - w / 2, sill, sp, 0.0, 0.035, TRIM, skip=("-w", "-v", "+v"))
    f.box(D, u + w / 2, u + w / 2 + 0.14, sill, sp, 0.0, 0.035, TRIM, skip=("-w", "-v", "+v"))
    Q.arch_ring(D, f, pts, 0.14, 0.0, 0.035, TRIM)
    hp = Q.pointed(u, sp, w + 0.36, 6, 1.0)
    Q.arch_ring(D, f, hp, 0.06, 0.0, 0.07, TRIM, side=False)
    f.box(D, u - w / 2 - 0.2, u + w / 2 + 0.2, sill - 0.07, sill, -0.02, 0.09, TRIM)
    for du in (-w / 2, w / 2):
        f.box(D, u + du - 0.04, u + du + 0.04, sill - 0.24, sill - 0.07, 0.0, 0.07, TRIM)
    # sage sash and glazing bars (a diamond-free plain lattice: 2 x 4 panes)
    f.box(D, u - w / 2 + 0.02, u + w / 2 - 0.02, sill + 0.02, sill + 0.09, -d, -d + 0.04, SAGE)
    D.member(f.p(u, sill + 0.09, -d + 0.02), f.p(u, sp + Q.apex_of(0, w, 1.0) - 0.05, -d + 0.02), G.prof_box(0.035, 0.035), SAGE)
    for k in range(1, 4):
        v = sill + (sp - sill) * k / 4
        D.member(f.p(u - w / 2, v, -d + 0.02), f.p(u + w / 2, v, -d + 0.02), G.prof_box(0.035, 0.03), SAGE)
    Q.arch_ring(D, f, [(p[0], p[1] - 0.005) for p in pts], -0.05, -d, -d + 0.04, SAGE, side=False)
    g = kit.glow("windows")
    f.poly(g, [(a, b, -d - 0.04) for a, b in outline], GLASS.t(P.WARM))
    p = f.p(u, sp, -d - 1.0)
    kit.lights.append(("point", p[0], p[1], p[2], (1.0, 0.8, 0.55), 30.0))


def roof(kit):
    S_, D = kit.S, kit.D
    zf = FZ + 0.35
    zb = BZ
    for sg in (-1, 1):
        q = [(sg * RX, roof_y(RX), zb), (sg * RX, roof_y(RX), zf), (0.0, RIDGE, zf), (0.0, RIDGE, zb)]
        if G.poly_normal(q)[1] < 0:
            q.reverse()
        S_.poly(q, ROOF.u((0, 0, 1)))
        # eave soffit + fascia (white), the verge boards on both gables
        q = [(sg * RX, roof_y(RX) - 0.1, zb), (sg * RX, roof_y(RX) - 0.1, zf), (sg * SX, roof_y(RX) - 0.1, zf), (sg * SX, roof_y(RX) - 0.1, zb)]
        if G.poly_normal(q)[1] > 0:
            q.reverse()
        S_.poly(q, TRIM)
        S_.box(min(sg * RX, sg * (RX - 0.05)), max(sg * RX, sg * (RX - 0.05)), roof_y(RX) - 0.24, roof_y(RX) + 0.02, zb, zf, TRIM, skip=("-z", "+z"))
        for z in (zf, zb + 0.02):
            a = (sg * (RX + 0.02), roof_y(RX) - 0.22, z)
            b = (0.0, RIDGE - 0.2, z)
            S_.member(G.add(a, (0, 0.1, -0.03 if z > 0 else 0.03)), G.add(b, (0, 0.1, -0.03 if z > 0 else 0.03)), G.prof_box(0.06, 0.26), TRIM)
    # the front overhang's underside (seen from the porch) and a ridge board
    S_.box(-0.09, 0.09, RIDGE - 0.02, RIDGE + 0.1, zb, zf, ROOF.t(G.hexc("7D8088")))
    # rain gutters and downpipes (white)
    for sg in (-1, 1):
        x = sg * (RX + 0.05)
        prof = [(0.065 * math.cos(math.pi + math.pi * i / 6), 0.065 * math.sin(math.pi + math.pi * i / 6)) for i in range(7)] + [(0.06, 0.0), (0.0, -0.05), (-0.06, 0.0)]
        D.member((x, roof_y(RX) - 0.12, zb + 0.02), (x, roof_y(RX) - 0.12, zf), prof, TRIM)
        for z in (zb + 0.3, FZ - 0.25):
            D.member((x, 0.1, z), (x, roof_y(RX) - 0.15, z), G.prof_round(0.045, 6), TRIM)


def tower(kit):
    """The white tower from the roof (a clapboard stage with a clock-free round panel), the louvred belfry with the bell and its
    headstock, a moulded cornice with four little corner spires, the octagonal needle spire with a copper orb and cross."""
    S_, D = kit.S, kit.D
    x0, x1, z0, z1 = TOWER
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    y0 = roof_y(x1) - 0.05
    faces = {
        "front": (P.F((cx, 0.0, z1), (1, 0, 0), (0, 0, 1)), (x1 - x0) / 2),
        "back": (P.F((cx, 0.0, z0), (-1, 0, 0), (0, 0, -1)), (x1 - x0) / 2),
        "right": (P.F((x1, 0.0, cz), (0, 0, -1), (1, 0, 0)), (z1 - z0) / 2),
        "left": (P.F((x0, 0.0, cz), (0, 0, 1), (-1, 0, 0)), (z1 - z0) / 2),
    }
    for name, (f, half) in faces.items():
        base = EAVE + 0.1 if name == "front" else y0
        holes = [(-0.55, 0.55, T1 + 0.35, T2 - 0.3)]
        P.wall(S_, f, -half, half, base, T2, holes, SIDING)
        sp = T2 - 0.3 - Q.apex_of(0.0, 1.1, 1.0)
        pts = Q.pointed(0.0, sp, 1.1, 5, 1.0)
        Q.head_fill(S_, f, pts, T2 - 0.3, SIDING)
        # louvre boards (white) in the opening, a dark belfry behind
        for k in range(8):
            v = T1 + 0.45 + k * 0.17
            if v > sp + 0.25:
                break
            D.member(f.p(-0.55, v, -0.1), f.p(0.55, v + 0.0, -0.1), [(-0.07, -0.01), (0.07, 0.04), (0.07, 0.055), (-0.07, 0.005)], TRIM)
        f.poly(D, [(-0.55, T1 + 0.35, -0.4), (0.55, T1 + 0.35, -0.4)] + [(p[0], p[1], -0.4) for p in reversed(pts)], DARK)
        for (ua, sg) in ((-0.55, 1), (0.55, -1)):
            q = [f.p(ua, T1 + 0.35, 0), f.p(ua, sp, 0), f.p(ua, sp, -0.4), f.p(ua, T1 + 0.35, -0.4)]
            if G.dot(G.poly_normal(q), G.mul(f.U, sg)) < 0:
                q.reverse()
            D.poly(q, TRIM)
        Q.arch_ring(D, f, pts, 0.12, 0.0, 0.04, TRIM)
        f.box(D, -0.68, 0.68, T1 + 0.2, T1 + 0.35, 0.0, 0.08, TRIM)
        f.box(S_, -half - 0.06, half + 0.06, T1 - 0.1, T1 + 0.08, 0.0, 0.1, TRIM, skip=("-w",))
        f.box(S_, -half - 0.12, half + 0.12, T2 - 0.05, T2 + 0.22, 0.0, 0.16, TRIM, skip=("-w",))
        for u in (-half, half):
            a, b = (u, u + 0.18) if u < 0 else (u - 0.18, u)
            f.box(S_, a, b, base, T2 - 0.05, 0.0, 0.06, TRIM, skip=("-w",))
        if name == "front":
            # a round louvred oculus in the lower stage
            f.box(D, -0.42, 0.42, 9.3, 10.14, 0.0, 0.05, TRIM)
            f.box(D, -0.32, 0.32, 9.4, 10.04, 0.05, 0.06, DARK)
    # the bell on its oak headstock (seen through the louvres' gaps)
    yb = 11.6
    D.lathe([(0.0, -0.32), (0.3, -0.32), (0.33, -0.28), (0.27, -0.16), (0.2, 0.05), (0.17, 0.18), (0.08, 0.25), (0.0, 0.26)], 12, GOLD.t(G.hexc("E8C99A")), cx, cz, yb)
    D.box(cx - 0.6, cx + 0.6, yb + 0.26, yb + 0.4, cz - 0.08, cz + 0.08, OAK)
    # the spire: an octagon from the cornice to the needle, a moulded collar, four small corner spires, orb and cross
    base = T2 + 0.22
    S_.lathe([(1.12, 0.0), (1.0, 0.25), (0.06, SPIRE_TOP - base - 0.1), (0.0, SPIRE_TOP - base)], 8, SPIRE_M, cx, cz, base, phase=math.pi / 8, smooth=False)
    D.lathe([(1.05, 0.0), (1.08, 0.08), (0.98, 0.16)], 8, TRIM, cx, cz, base + 0.2, phase=math.pi / 8, smooth=False)
    for (x, z) in ((x0 + 0.12, z0 + 0.12), (x1 - 0.12, z0 + 0.12), (x0 + 0.12, z1 - 0.12), (x1 - 0.12, z1 - 0.12)):
        S_.lathe([(0.13, 0.0), (0.0, 1.0)], 4, SPIRE_M, x, z, base, phase=math.pi / 4, smooth=False)
        D.sphere(x, base + 1.04, z, 0.04, COPPER, n=6, rings=3)
    y = SPIRE_TOP
    D.sphere(cx, y + 0.1, cz, 0.12, COPPER, n=10, rings=5)
    D.box(cx - 0.03, cx + 0.03, y + 0.18, y + 0.62, cz - 0.03, cz + 0.03, COPPER)
    D.box(cx - 0.18, cx + 0.18, y + 0.42, y + 0.48, cz - 0.03, cz + 0.03, COPPER)
    kit.glow("belfry").sphere(cx, T1 + 0.5, cz, 0.12, GLASS.t(P.LAMP), n=6, rings=3)
    kit.lights.append(("point", cx, T1 + 0.6, cz, (1.0, 0.82, 0.55), 60.0))


def porch(kit):
    """Two Tuscan columns on granite bases, a beam, a pediment with a white tympanum and a moulded cornice, a beaded board
    ceiling with a lantern, the granite steps and the panelled oak double doors with a pointed fanlight; the name board over it."""
    S_, D, Gd = kit.S, kit.D, kit.G
    zf = 4.75
    for sg in (-1, 1):
        x = sg * 1.6
        D.cbox(x - 0.15, x + 0.15, 0.0, 0.2, 4.3, 4.6, GRAN, c=0.02, skip=("-y",))
        D.lathe([(0.13, 0.0), (0.13, 0.08), (0.11, 0.14), (0.1, 3.0), (0.12, 3.06), (0.15, 3.18), (0.15, 3.25), (0.0, 3.25)], 12, TRIM, x, 4.45, 0.2)
    ybeam = 3.62
    D.cbox(-2.1, 2.1, ybeam, ybeam + 0.32, 3.0, zf, TRIM, c=0.02)
    # the pediment: a gable over the porch (shell), raking cornices, the tympanum
    apex = 4.9
    S_.poly([(-2.2, ybeam + 0.32, zf), (2.2, ybeam + 0.32, zf), (0.0, apex, zf)], TRIM)
    for sg in (-1, 1):
        q = [(sg * 2.25, ybeam + 0.28, 3.0), (sg * 2.25, ybeam + 0.28, zf + 0.06), (0.0, apex + 0.08, zf + 0.06), (0.0, apex + 0.08, 3.0)]
        if G.poly_normal(q)[1] < 0:
            q.reverse()
        S_.poly(q, ROOF.u((0, 0, 1)))
        D.member((sg * 2.24, ybeam + 0.26, zf + 0.05), (0.0, apex + 0.04, zf + 0.05), G.prof_box(0.08, 0.12), TRIM)
    D.poly([(-2.1, ybeam, 3.0), (2.1, ybeam, 3.0), (2.1, ybeam, zf), (-2.1, ybeam, zf)][::-1], PINE.u((0, 0, 1)))
    for k in range(9):
        x = -2.0 + 0.5 * k
        D.box(x - 0.01, x + 0.01, ybeam - 0.012, ybeam, 3.0, zf, PINE.t(G.hexc("D9BF97")))
    # the doors (panelled oak, inward on hinges), a pointed fanlight above them, the surround
    P.double_door(kit, "lot_church_main", 0.0, FZ - 0.05, DOOR_W, DOOR_H, OAK, TRIM, IRON, glass_top=False)
    f = fr()["front"]
    f.box(D, -DOOR_W / 2 - 0.12, -DOOR_W / 2, 0.0, DOOR_H + 0.12, 0.0, 0.05, TRIM, skip=("-w",))
    f.box(D, DOOR_W / 2, DOOR_W / 2 + 0.12, 0.0, DOOR_H + 0.12, 0.0, 0.05, TRIM, skip=("-w",))
    f.box(D, -DOOR_W / 2 - 0.12, DOOR_W / 2 + 0.12, DOOR_H, DOOR_H + 0.12, 0.0, 0.05, TRIM, skip=("-w",))
    # the vestibule behind the door: the doors swing into it
    vz = FZ - 0.05 - 1.4
    D.box(-1.18, 1.18, 0.0, DOOR_H, vz - 0.02, vz, PINE, skip=("-z", "-x", "+x", "-y", "+y"))
    for sg in (-1, 1):
        x = sg * 1.18
        q = [(x, 0.0, vz), (x, 0.0, FZ - 0.05), (x, DOOR_H, FZ - 0.05), (x, DOOR_H, vz)]
        if G.dot(G.poly_normal(q), (-sg, 0, 0)) < 0:
            q.reverse()
        D.poly(q, TRIM.t(G.hexc("E8E2D6")))
    D.poly([(-1.18, DOOR_H, vz), (1.18, DOOR_H, vz), (1.18, DOOR_H, FZ - 0.05), (-1.18, DOOR_H, FZ - 0.05)], TRIM.t(G.hexc("DCD5C8")))
    # granite steps (walkover) in front of the doors and under the porch
    D.box(-2.3, 2.3, 0.0, 0.14, 2.95, zf + 0.1, GRAN, skip=("-y",))
    # the name board over the porch: a white board with gilt 3D letters
    f.box(D, -1.5, 1.5, 5.0, 5.42, 0.0, 0.06, TRIM, c=0.012)
    kit.letters.append(("케이슨 마을 교회", f.p(0.0, 5.1, 0.06), (0, 0, 1), 0.2, 0.025, GOLD, "D"))
    # porch lantern
    kit.glow("porch").sphere(0.0, ybeam - 0.25, 3.9, 0.1, GLASS.t(P.LAMP), n=8, rings=4)
    D.lathe([(0.0, 0.0), (0.14, 0.02), (0.06, 0.16), (0.02, 0.2)], 8, IRON, 0.0, 3.9, ybeam - 0.2)
    D.member((0.0, ybeam - 0.02, 3.9), (0.0, ybeam - 0.2, 3.9), G.prof_round(0.01, 4), IRON)
    kit.lights.append(("point", 0.0, ybeam - 0.3, 3.95, (1.0, 0.84, 0.6), 80.0))
    D.prop("porch_post_1", (-1.75, -1.45, 0.0, 3.6, 4.3, 4.6), "solid")


def grounds(kit):
    D, Gd = kit.D, kit.G
    for sg, lbl in ((-1, "lamp_1"), (1, "lamp_2")):
        P.lantern_post(kit, D, sg * 3.45, 6.35, 3.0, IRON, GLASS, lbl)
    for sg, lbl in ((-1, "bench_1"), (1, "bench_2")):
        P.park_bench(D, sg * 7.0, 4.5, 0.0, 1.8, TRIM, IRON, lbl)
    # the "환영합니다" board on two posts (inside 5.8 .. 7.2 x 6.3 .. 6.55), white with gilt letters
    x0, x1 = 5.85, 7.15
    for x in (x0 + 0.08, x1 - 0.08):
        D.cbox(x - 0.05, x + 0.05, 0.0, 1.95, 6.37, 6.47, TRIM, c=0.01)
    D.cbox(x0, x1, 1.0, 1.85, 6.33, 6.5, TRIM, c=0.015)
    D.cbox(x0 + 0.06, x1 - 0.06, 1.06, 1.79, 6.5, 6.52, SAGE, c=0.004)
    D.box(x0 - 0.06, x1 + 0.06, 1.85, 1.92, 6.31, 6.53, TRIM)
    kit.letters.append(("환영합니다", (6.5, 1.35, 6.52), (0, 0, 1), 0.16, 0.02, GOLD, "D"))
    # low beds: lavender and white flowers either side of the porch, box edging (walkover)
    for sg in (-1, 1):
        a, b = sorted((sg * 2.6, sg * 4.0))
        Q.hedge_low(Gd, a, b, 3.1, 3.3, BOX, 0.24)
        Q.scatter(kit, "flower_w", FLOWER_W, a + 0.1, b - 0.1, 3.4, 4.3, 0.5, 410 + sg)
        Q.scatter(kit, "flower_p", FLOWER_P, a + 0.1, b - 0.1, 4.35, 5.0, 0.55, 420 + sg)


def ground(kit):
    g = kit.ground
    g.poly([(-30, -0.002, -30), (-30, -0.002, 30), (30, -0.002, 30), (30, -0.002, -30)], S("PV_grass", G.hexc("B9CF8A")))
    g.poly([(-2.4, 0.0, 3.0), (-2.4, 0.0, 14), (2.4, 0.0, 14), (2.4, 0.0, 3.0)], S("PV_flags", G.hexc("F2EBDF")))
