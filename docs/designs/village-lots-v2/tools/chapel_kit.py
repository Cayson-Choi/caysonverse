"""케이슨 마을 성당 (lot_chapel, plot_ne, door west) — the exterior kit (design 3.2, contract 9 B2), pure python on
b2_parts / b1_parts / b1_geom, lot LOCAL frame (x = right hand going in = south, z = out of the door = west, y up).

A small brand-new Gothic village chapel in honey limestone (Breton / Alsatian chapels, Lower Benefield, Snailwell, Mirna):
a nave 8.7 x 10.6 with stepped buttresses and three tall lancets a side, a deep west portal (three orders on colonnettes,
oak plank doors with wrought-iron strap hinges under a pointed head), a rose window in the gable, a square west tower rising
from the gable with an open belfry (bronze bell) and an octagonal stone spire with corner pinnacles and a copper cross at
21 m, a half-round apse with three small lancets under a slate half-cone, a dark slate roof with stone-coped gables and a
cross on the east gable. Gardens: the south fountain garden (a granite quatrefoil basin, a gravel round, box hedges and
flowers, a bench), the north rose garden (an iron rose arch heavy with roses, a bench), lavender and roses along the walls,
two lantern posts on the forecourt, a glazed notice case and the carved name tablet. No saint's name, no scripture.
"""
import math

import b1_geom as G
import b1_parts as P
import b2_parts as Q
from b1_geom import Mesh, S

LOT = "lot_chapel"
STONE = S("LM_chapel_stone", G.hexc("F6E7C8"))       # honey limestone ashlar (stone_ashlar), freshly dressed
STONE_LT = S("LM_chapel_stone", G.hexc("FFF4DE"))    # mouldings, tracery, copings: a paler, finer cut
ROOF = S("LM_chapel_roof", G.hexc("C9CED6"))         # new natural slate (roof_slate)
GRAN = S("LM_chapel_granite", G.hexc("EEE9E0"))      # flamed granite: steps, the basin, the path flags
OAK = S("LM_chapel_oak", G.hexc("A0703F"))           # oiled oak doors
OAK_LT = S("LM_chapel_oak", G.hexc("D2B48C"))
IRON = S("LM_chapel_iron", G.hexc("3A3A3C"))         # wrought / cast iron, black
COPPER = S("LM_chapel_copper")                       # new copper (copper_new)
BRONZE = S("LM_chapel_copper", G.hexc("E6C9A0"))     # the bell
GOLD = S("LM_chapel_copper", G.hexc("FFE7A6"))       # gilt letters, the cross's orb
GRAVEL = S("LM_chapel_gravel", G.hexc("F2E8D8"))     # warm pale gravel
LEAF = S("LM_chapel_green", G.hexc("9CC46E"))
LEAF_DK = S("LM_chapel_green", G.hexc("6E9E52"))
BOX = S("LM_chapel_green", G.hexc("7FAF5E"))
PET_ROSE = S("LM_chapel_green", G.hexc("F28CA8"))
PET_ROSE2 = S("LM_chapel_green", G.hexc("FFF1F0"))
PET_RED = S("LM_chapel_green", G.hexc("E8505B"))
PET_LAV = S("LM_chapel_green", G.hexc("9C82D8"))
LAV_STEM = S("LM_chapel_green", G.hexc("A7B89A"))
PET_WHITE = S("LM_chapel_green", G.hexc("FFFDF6"))
CORK = S("LM_chapel_stone", G.hexc("E9D8B4"))
WATER = P.GLASS
GLASS = P.GLASS

MATS = {
    # stone_ashlar's honey albedo (mean linear 0.43/0.34/0.23) under the tint read dark brown in game: brightened to the
    # warm cream limestone of the renders and the references (L5v2, owner colour pass)
    "LM_chapel_stone": {"set": "stone_ashlar", "gain": [2.0, 2.15, 2.6]},
    "LM_chapel_roof": {"set": "roof_slate"},
    "LM_chapel_granite": {"set": "granite_flamed"},
    "LM_chapel_oak": {"set": "wood_oak", "rough": 0.85},
    "LM_chapel_iron": {"set": "cast_iron", "metal": True},
    "LM_chapel_gravel": {"set": "gravel"},
    "LM_chapel_copper": {"set": "copper_new", "metal": True},
    "LM_chapel_green": {"set": "grass", "normal": 0.5},
    "M_glass": {"glass": True},
    "M_screen": {"screen": True},
}
PREVIEW = {"PV_grass": {"set": "grass"}, "PV_flags": {"set": "plaza_granite"}}

SX = 4.35            # side wall faces
FZ = 5.3             # west front face
BZ = -5.3            # east wall face
EAVE = 7.5
RIDGE = 12.0
RX = 4.62            # roof eave line (x)
REY = 7.42           # roof eave height
TX = 1.7             # tower half width
TZ0, TZ1 = 2.6, 5.3  # tower depth (the bell slot at z 4.4 is inside its belfry)
T_TOP = 13.6         # top of the tower's plain stage
B_TOP = 16.1         # top of the belfry (the bell hangs at the bell slot's 15.5)
SPIRE = 20.3
APSE_R = 2.85
DOOR_W = 2.4
DOOR_K = 0.6
DOOR_SPRING = 3.6 - Q.apex_of(0.0, DOOR_W, DOOR_K)
DOOR_Z = FZ - 0.5    # the leaves' outer face (deep portal)
ROSE_C = 7.1
ROSE_R = 1.2
WIN_Z = (3.35, 0.0, -3.35)
WIN_SILL, WIN_H = 3.0, 2.6
NIGHT_GLASS = [G.hexc(c) for c in ("FFC46A", "8FB0FF", "FF8A6A", "FFD98A")]


def roof_y(x):
    return RIDGE - (RIDGE - REY) * abs(x) / RX


def build(lot, layout):
    kit = P.Kit(lot)
    kit.mats = dict(MATS)
    kit.mats.update(PREVIEW)
    kit.roof_slabs = []
    nave(kit)
    front(kit)
    tower(kit)
    apse(kit)
    roof(kit)
    gardens(kit)
    ground(kit)
    kit.look = "AgX - Base Contrast"
    return kit


def fr():
    return {
        "front": P.F((0.0, 0.0, FZ), (1, 0, 0), (0, 0, 1)),
        "back": P.F((0.0, 0.0, BZ), (-1, 0, 0), (0, 0, -1)),
        "right": P.F((SX, 0.0, 0.0), (0, 0, -1), (1, 0, 0)),
        "left": P.F((-SX, 0.0, 0.0), (0, 0, 1), (-1, 0, 0)),
    }


# ------------------------------------------------------------------------------------------------ nave --

def nave(kit):
    S_, D, Gd = kit.S, kit.D, kit.G
    F = fr()
    for i, side in enumerate(("right", "left")):
        f = F[side]
        us = [-z for z in WIN_Z] if side == "right" else list(WIN_Z)
        holes = [(u - 0.5, u + 0.5, WIN_SILL, WIN_SILL + WIN_H) for u in us]
        P.wall(S_, f, -FZ, FZ, 0.0, EAVE, holes, STONE)
        for k, u in enumerate(us):
            Q.lancet(kit, f, u, WIN_SILL, 1.0, WIN_H, STONE_LT, STONE, glass_seed=10 * i + k, glow="windows",
                     glow_col=NIGHT_GLASS[(i + k) % 4])
        # stepped buttresses: corners and between the bays
        for u in (-4.95, -1.75, 1.75, 4.95):
            Q.buttress(S_, f, u, 0.6, 0.58, 5.8, STONE, offs=2)
        # moulded eaves cornice (a corbel table): a cavetto band and small corbels
        f.box(S_, -FZ - 0.05, FZ + 0.05, EAVE - 0.32, EAVE - 0.05, 0.0, 0.2, STONE_LT, skip=("-w", "+u", "-u"))
        u = -FZ + 0.35
        while u < FZ - 0.2:
            f.box(D, u - 0.07, u + 0.07, EAVE - 0.55, EAVE - 0.32, 0.0, 0.14, STONE_LT, skip=("-w", "+v"))
            u += 0.95
        # chamfered plinth course and the string course under the windows
        f.box(S_, -FZ, FZ, 0.0, 0.5, 0.0, 0.08, STONE, skip=("-w", "-v"))
        f.box(S_, -FZ, FZ, WIN_SILL - 0.24, WIN_SILL - 0.12, 0.0, 0.07, STONE_LT, skip=("-w",))
        # lavender and roses along the wall between the buttresses (inside the body box: x 4.43 .. 4.95)
        for (a, b) in ((-4.6, -2.1), (-1.4, 1.4), (2.1, 4.6)):
            uu = a + 0.25
            while uu < b - 0.15:
                p = f.p(uu, 0.0, 0.33)
                kind = ("rose_bush", ROSE_BUSH) if int(uu * 10) % 3 == 0 else ("lavender", LAVENDER)
                kit.place(kind[0], kind[1], p[0], 0.0, p[2], (uu * 7.3) % 6.28)
                uu += 0.55
            f.box(D, a, b, 0.0, 0.14, 0.12, 0.6, GRAN, skip=("-v", "-w"))   # granite bed edging (kerb)
    # east wall: gable, a small round window above the apse roof, the cross on the apex
    f = F["back"]
    P.wall(S_, f, -SX, SX, 0.0, EAVE, [], STONE)
    f.poly(S_, [(-SX, EAVE, 0), (SX, EAVE, 0), (0.0, RIDGE, 0)], STONE)
    for u in (-3.9, 3.9):
        f.box(S_, u - 0.3, u + 0.3, 0.0, 5.0, 0.0, 0.18, STONE, skip=("-w",))
    f.box(S_, -SX, SX, 0.0, 0.5, 0.0, 0.08, STONE, skip=("-w", "-v"))


def coping(kit, f, x0, y0, x1, y1, w0=-0.18, w1=0.2):
    """A stone coping along a gable rake (from (x0, y0) up to (x1, y1)), 0.24 above the roof surface."""
    D = kit.D
    a = f.p(x0, y0 + 0.12, (w0 + w1) / 2)
    b = f.p(x1, y1 + 0.12, (w0 + w1) / 2)
    kit.S.member(a, b, [(-0.2, -0.12), (0.2, -0.12), (0.2, 0.1), (0.0, 0.18), (-0.2, 0.1)], STONE_LT)


# ------------------------------------------------------------------------------------------------ west front --

def front(kit):
    S_, D, Gd = kit.S, kit.D, kit.G
    f = fr()["front"]
    # the portal: three orders stepping out from the door plane (w -0.5) to the wall face, pointed heads
    spans = [DOOR_W + 0.36 * i for i in range(4)]
    r0 = DOOR_W * DOOR_K
    ks = [(r0 + 0.18 * i) / spans[i] for i in range(4)]
    heads = [Q.pointed(0.0, DOOR_SPRING, spans[i], 8, ks[i]) for i in range(4)]
    out_apex = max(p[1] for p in heads[3])
    holes = [(-spans[3] / 2, spans[3] / 2, 0.0, out_apex), (-ROSE_R - 0.35, ROSE_R + 0.35, ROSE_C - ROSE_R - 0.35, EAVE)]
    P.wall(S_, f, -SX, SX, 0.0, EAVE, holes, STONE)
    Q.head_fill(S_, f, heads[3], out_apex, STONE)
    depth = [-0.5 + 0.5 * i / 3 for i in range(4)]
    for i in range(3):
        wi = depth[i + 1]
        # band face of order i between span i and span i + 1 (jambs + arch)
        for sg in (-1, 1):
            a, b = sorted((sg * spans[i] / 2, sg * spans[i + 1] / 2))
            f.quad(D, a, b, 0.0, DOOR_SPRING, wi, STONE_LT)
            # return face at the inner edge of the order (perpendicular to the wall)
            x = sg * spans[i] / 2
            q = [f.p(x, 0.0, depth[i]), f.p(x, DOOR_SPRING, depth[i]), f.p(x, DOOR_SPRING, wi), f.p(x, 0.0, wi)]
            if G.dot(G.poly_normal(q), G.mul(f.U, -sg)) < 0:
                q.reverse()
            D.poly(q, STONE_LT)
            # a colonnette in the order's outer corner: base, shaft, foliage capital
            cxu = sg * (spans[i + 1] / 2 - 0.07)
            p0 = f.p(cxu, 0.0, wi + 0.0)
            D.lathe([(0.1, 0.0), (0.1, 0.18), (0.065, 0.3)], 6, STONE_LT, p0[0], p0[2] + 0.07, 0.0)
            D.lathe([(0.065, 0.0), (0.065, DOOR_SPRING - 0.62)], 6, STONE_LT, p0[0], p0[2] + 0.07, 0.3)
            D.lathe([(0.065, 0.0), (0.12, 0.2), (0.0, 0.27)], 6, STONE_LT, p0[0], p0[2] + 0.07, DOOR_SPRING - 0.32)
        inner, outer = heads[i], heads[i + 1]
        for k in range(len(inner) - 1):
            a, b, c, d = inner[k], inner[k + 1], outer[k + 1], outer[k]
            f.poly(D, [(a[0], a[1], wi), (b[0], b[1], wi), (c[0], c[1], wi), (d[0], d[1], wi)], STONE_LT)
            q = [f.p(a[0], a[1], depth[i]), f.p(b[0], b[1], depth[i]), f.p(b[0], b[1], wi), f.p(a[0], a[1], wi)]
            mid = G.mul(G.add(q[0], q[1]), 0.5)
            if G.dot(G.poly_normal(q), G.sub(f.p(0.0, DOOR_SPRING, wi), mid)) < 0:
                q.reverse()
            D.poly(q, STONE_LT)
    # outermost order's return (at the wall face) and the hood mould over the portal with carved stops
    hp = Q.pointed(0.0, DOOR_SPRING, spans[3] + 0.1, 10, (r0 + 0.6) / (spans[3] + 0.1))
    Q.arch_ring(D, f, hp, 0.1, 0.0, 0.12, STONE_LT)
    for p in (hp[0], hp[-1]):
        f.box(D, p[0] - 0.09, p[0] + 0.09, p[1] - 0.22, p[1], 0.0, 0.14, STONE_LT)
    # oak plank leaves with strap hinges; a granite threshold step
    Q.plank_door(kit, "lot_chapel_main", 0.0, DOOR_Z, DOOR_W, DOOR_SPRING, DOOR_K, OAK, IRON, 3.6)
    D.box(-1.9, 1.9, 0.0, 0.12, DOOR_Z, FZ + 0.42, GRAN, skip=("-y",))
    # the vestibule behind the doors (seen when they swing): plaster walls, a warm lamp at night
    vz = DOOR_Z - 1.45
    D.box(-1.32, 1.32, 0.0, 3.62, vz, vz + 0.02, STONE.t(G.hexc("D9C7A6")), skip=("-z", "-y", "+y", "-x", "+x"))
    for sg in (-1, 1):
        x = sg * 1.32
        q = [(x, 0.0, vz), (x, 0.0, DOOR_Z), (x, 3.62, DOOR_Z), (x, 3.62, vz)]
        if G.dot(G.poly_normal(q), (-sg, 0, 0)) < 0:
            q.reverse()
        D.poly(q, STONE.t(G.hexc("D9C7A6")))
    D.poly([(-1.32, 3.62, vz), (1.32, 3.62, vz), (1.32, 3.62, DOOR_Z), (-1.32, 3.62, DOOR_Z)], STONE.t(G.hexc("CDB997")))
    # string course across the front, under the rose
    f.box(S_, -SX, -ROSE_R - 0.4, 4.85, 5.0, 0.0, 0.1, STONE_LT, skip=("-w",))
    f.box(S_, ROSE_R + 0.4, SX, 4.85, 5.0, 0.0, 0.1, STONE_LT, skip=("-w",))
    rose(kit, f)
    # quoins: alternating long-and-short at both front corners
    for u in (-SX, SX):
        sg = 1 if u > 0 else -1
        for k in range(12):
            v0 = 0.5 + k * 0.58
            if v0 + 0.5 > EAVE:
                break
            wq = 0.46 if k % 2 == 0 else 0.3
            a, b = (u - wq, u) if sg > 0 else (u, u + wq)
            f.box(S_, a, b, v0, v0 + 0.52, 0.0, 0.025, STONE_LT, skip=("-w",))
    f.box(S_, -SX, SX, 0.0, 0.5, 0.0, 0.08, STONE, skip=("-w", "-v"))
    # the gable pieces either side of the tower, their copings and kneelers
    for sg in (-1, 1):
        pts = [(sg * TX, EAVE, 0.0), (sg * SX, EAVE, 0.0), (sg * TX, roof_y(TX) + 0.15, 0.0)]
        f.poly(S_, pts, STONE)
        coping(kit, f, sg * (SX + 0.05), EAVE - 0.05, sg * TX, roof_y(TX) + 0.1)
    # glazed notice case (empty notice cards) and the carved name tablet with gilt letters
    f.box(Gd, -4.1, -3.1, 1.0, 2.2, 0.0, 0.16, OAK, c=0.012)
    f.box(Gd, -4.02, -3.18, 1.08, 2.12, 0.16, 0.162, CORK)
    f.quad(Gd, -4.02, -3.18, 1.08, 2.12, 0.175, GLASS)
    for (a, b, c0, c1) in ((-3.95, -3.65, 1.7, 1.98), (-3.6, -3.25, 1.62, 1.98), (-3.92, -3.4, 1.18, 1.55)):
        f.quad(Gd, a, b, c0, c1, 0.165, S("LM_chapel_stone", G.hexc("FFFDF5")))
    f.box(Gd, -3.13, -3.11, 1.55, 1.68, 0.16, 0.185, GOLD)
    f.box(D, 3.1, 4.1, 1.78, 2.22, 0.0, 0.05, STONE_LT, c=0.012)
    kit.letters.append(("케이슨 마을 성당", f.p(3.6, 1.93, 0.05), (0, 0, 1), 0.085, 0.012, GOLD, "G"))
    kit.glow("notice").poly([f.p(-4.0, 2.08, 0.17), f.p(-3.2, 2.08, 0.17), f.p(-3.2, 2.11, 0.17), f.p(-4.0, 2.11, 0.17)], GLASS.t(P.LAMP))
    # a lantern bracket over the portal (night)
    p = f.p(0.0, out_apex + 0.55, 0.0)
    D.member(p, G.add(p, (0, 0, 0.35)), G.prof_box(0.04, 0.04), IRON)
    D.box(p[0] - 0.12, p[0] + 0.12, p[1] - 0.42, p[1] - 0.38, p[2] + 0.23, p[2] + 0.47, IRON)
    D.lathe([(0.17, 0.0), (0.0, 0.12)], 4, IRON, p[0], p[2] + 0.35, p[1] - 0.02, phase=math.pi / 4, smooth=False)
    for (dx, dz) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        D.member((p[0] + dx * 0.1, p[1] - 0.38, p[2] + 0.35 + dz * 0.1), (p[0] + dx * 0.12, p[1] - 0.02, p[2] + 0.35 + dz * 0.12), G.prof_box(0.018, 0.018), IRON)
    kit.glow("porch").lathe([(0.0, 0.0), (0.08, 0.04), (0.08, 0.3), (0.0, 0.34)], 6, GLASS.t(P.LAMP), p[0], p[2] + 0.35, p[1] - 0.37)
    kit.lights.append(("point", p[0], p[1] - 0.2, p[2] + 0.35, (1.0, 0.82, 0.58), 90.0))


def rose(kit, f):
    """The west rose (2.4 m glass): a moulded stone ring, a splayed reveal, 12 cusped spokes round a central oculus, the
    glass and its jewel panel behind; it glows at night."""
    S_, D = kit.S, kit.D
    n = 24
    R0 = ROSE_R + 0.35
    uc, vc = 0.0, ROSE_C
    cir = [(uc + R0 * math.cos(2 * math.pi * i / n), vc + R0 * math.sin(2 * math.pi * i / n)) for i in range(n)]
    # fill between the ring and the square hole (the hole spans up to the eave; the gable pieces and the tower face above)
    top = EAVE
    for i in range(n):
        j = (i + 1) % n
        a, b = cir[i], cir[j]
        def sq(p):
            dx, dy = p[0] - uc, p[1] - vc
            m = max(abs(dx), abs(dy)) or 1.0
            return (uc + dx * R0 / m, vc + dy * R0 / m)
        sa, sb = sq(a), sq(b)
        sa = (sa[0], min(sa[1], top))
        sb = (sb[0], min(sb[1], top))
        if a[1] > top + 1e-6 and b[1] > top + 1e-6:
            continue
        pa, pb = (a[0], min(a[1], top)), (b[0], min(b[1], top))
        f.poly(S_, [(pa[0], pa[1], 0), (pb[0], pb[1], 0), (sb[0], sb[1], 0), (sa[0], sa[1], 0)], STONE)
    # moulded ring proud of the wall, the splay into the glass
    ring_o = [(uc + (R0 + 0.12) * math.cos(2 * math.pi * i / n), vc + (R0 + 0.12) * math.sin(2 * math.pi * i / n)) for i in range(n)]
    gl = [(uc + ROSE_R * math.cos(2 * math.pi * i / n), vc + ROSE_R * math.sin(2 * math.pi * i / n)) for i in range(n)]
    for i in range(n):
        j = (i + 1) % n
        f.poly(D, [(cir[i][0], cir[i][1], 0.1), (cir[j][0], cir[j][1], 0.1), (ring_o[j][0], ring_o[j][1], 0.1), (ring_o[i][0], ring_o[i][1], 0.1)], STONE_LT)
        f.poly(D, [(ring_o[i][0], ring_o[i][1], 0.0), (ring_o[j][0], ring_o[j][1], 0.0), (ring_o[j][0], ring_o[j][1], 0.1), (ring_o[i][0], ring_o[i][1], 0.1)], STONE_LT, out=0)
        q = [f.p(cir[i][0], cir[i][1], 0.1), f.p(cir[j][0], cir[j][1], 0.1), f.p(gl[j][0], gl[j][1], -0.32), f.p(gl[i][0], gl[i][1], -0.32)]
        mid = G.mul(G.add(q[0], q[1]), 0.5)
        if G.dot(G.poly_normal(q), G.sub(f.p(uc, vc, 0.0), mid)) < 0:
            q.reverse()
        S_.poly(q, STONE_LT)
    f.poly(S_, [(p[0], p[1], -0.32) for p in gl], GLASS)
    # jewel panel: rings of cells
    rg = G.rng(77)
    for ring_i, (ra, rb) in enumerate(((0.0, 0.3), (0.34, 0.72), (0.76, 1.17))):
        cells = 1 if ra == 0 else (12 if ring_i == 1 else 24)
        for c in range(cells):
            a0 = 2 * math.pi * c / cells + 0.02
            a1 = 2 * math.pi * (c + 1) / cells - 0.02
            col = (*G.mul(Q.JEWEL[(c + ring_i * 3) % 6 if ring_i else 4], 0.3), 1.0)
            if ra == 0:
                pts = [f.p(uc + rb * math.cos(2 * math.pi * k / 10), vc + rb * math.sin(2 * math.pi * k / 10), -0.36) for k in range(10)]
                D.poly(pts, S("M_screen"), cols=[col] * 10)
                continue
            pts = [f.p(uc + ra * math.cos(a0), vc + ra * math.sin(a0), -0.36), f.p(uc + ra * math.cos(a1), vc + ra * math.sin(a1), -0.36),
                   f.p(uc + rb * math.cos(a1), vc + rb * math.sin(a1), -0.36), f.p(uc + rb * math.cos(a0), vc + rb * math.sin(a0), -0.36)]
            D.poly(pts, S("M_screen"), cols=[col] * 4)
    # tracery: 12 spokes, an inner ring and the cusped outer ring (stone, 9 cm square)
    for c in range(12):
        a = 2 * math.pi * c / 12
        D.member(f.p(uc + 0.32 * math.cos(a), vc + 0.32 * math.sin(a), -0.27), f.p(uc + ROSE_R * math.cos(a), vc + ROSE_R * math.sin(a), -0.27), G.prof_box(0.08, 0.08), STONE_LT)
    for rr in (0.32, 0.74):
        ring = [f.p(uc + rr * math.cos(2 * math.pi * k / 24), vc + rr * math.sin(2 * math.pi * k / 24), -0.27) for k in range(25)]
        D.tube(ring, 0.045, 4, STONE_LT)
    # night glow (warm-jewel)
    g = kit.glow("rose")
    cols = [G.hexc(c) for c in ("FFB45A", "7FA6FF", "FF7A6A", "FFD98A")]
    for c in range(12):
        a0 = 2 * math.pi * c / 12
        a1 = 2 * math.pi * (c + 1) / 12
        g.poly([f.p(uc, vc, -0.4), f.p(uc + ROSE_R * math.cos(a0), vc + ROSE_R * math.sin(a0), -0.4), f.p(uc + ROSE_R * math.cos(a1), vc + ROSE_R * math.sin(a1), -0.4)][::-1], GLASS.t(cols[c % 4]))
    p = f.p(uc, vc, -1.2)
    kit.lights.append(("point", p[0], p[1], p[2], (1.0, 0.75, 0.5), 60.0))


# ------------------------------------------------------------------------------------------------ tower + spire --

def tower(kit):
    S_, D = kit.S, kit.D
    f = fr()["front"]
    # the tower's front: the facade carried up from the eave (rose head hole) to the belfry floor
    P.wall(S_, f, -TX, TX, EAVE, T_TOP, [(-ROSE_R - 0.35, ROSE_R + 0.35, EAVE, ROSE_C + ROSE_R + 0.35)], STONE)
    # the rose fill above the eave
    n = 24
    R0 = ROSE_R + 0.35
    cir = [(R0 * math.cos(2 * math.pi * i / n), ROSE_C + R0 * math.sin(2 * math.pi * i / n)) for i in range(n)]
    for i in range(n):
        j = (i + 1) % n
        a, b = cir[i], cir[j]
        if a[1] < EAVE - 1e-6 and b[1] < EAVE - 1e-6:
            continue

        def sq(p):
            dx, dy = p[0], p[1] - ROSE_C
            m = max(abs(dx), abs(dy)) or 1.0
            return (dx * R0 / m, ROSE_C + dy * R0 / m)
        sa, sb = sq(a), sq(b)
        pa, pb = (a[0], max(a[1], EAVE)), (b[0], max(b[1], EAVE))
        sa = (sa[0], max(sa[1], EAVE))
        sb = (sb[0], max(sb[1], EAVE))
        f.poly(S_, [(pa[0], pa[1], 0), (pb[0], pb[1], 0), (sb[0], sb[1], 0), (sa[0], sa[1], 0)], STONE)
    # sides (from the roof surface) and the back (a pentagon over the ridge)
    for sg in (-1, 1):
        x = sg * TX
        y0 = roof_y(TX) - 0.05
        q = [(x, y0, TZ0), (x, y0, TZ1), (x, T_TOP, TZ1), (x, T_TOP, TZ0)]
        if G.dot(G.poly_normal(q), (sg, 0, 0)) < 0:
            q.reverse()
        S_.poly(q, STONE)
    q = [(TX, roof_y(TX) - 0.05, TZ0), (-TX, roof_y(TX) - 0.05, TZ0), (-TX, T_TOP, TZ0), (TX, T_TOP, TZ0)]
    S_.poly(q, STONE)
    S_.poly([(-TX, roof_y(TX) - 0.05, TZ0 + 0.001), (TX, roof_y(TX) - 0.05, TZ0 + 0.001), (0.0, RIDGE + 0.05, TZ0 + 0.001)][::-1], STONE)
    # corner clasping pilasters, a band under the belfry
    for (x, z) in ((-TX, TZ1), (TX, TZ1), (-TX, TZ0), (TX, TZ0)):
        if z < TZ1:
            S_.box(x - 0.14, x + 0.14, roof_y(TX) - 0.05, B_TOP, z - 0.14, z + 0.14, STONE_LT)
        else:
            S_.box(x - 0.14, x + 0.14, EAVE, B_TOP, z - 0.14, z + 0.0, STONE_LT, skip=("-z",))
    S_.box(-TX - 0.12, TX + 0.12, T_TOP - 0.18, T_TOP, TZ0 - 0.12, TZ1 + 0.08, STONE_LT)
    belfry(kit)
    # cornice and the octagonal spire with corner pinnacles, the copper orb and cross
    S_.box(-TX - 0.18, TX + 0.18, B_TOP, B_TOP + 0.28, TZ0 - 0.18, TZ1 + 0.14, STONE_LT)
    cx, cz = 0.0, (TZ0 + TZ1) / 2
    rr = 0.98
    S_.lathe([(rr, 0.0), (rr * 0.9, 0.35), (0.07, SPIRE - B_TOP - 0.28 - 0.1), (0.0, SPIRE - B_TOP - 0.28)], 8, STONE, cx, cz, B_TOP + 0.28,
             phase=math.pi / 8, smooth=False)
    # spire bands (a moulding every 1.1 m)
    for yb in (1.1, 2.2):
        r = rr * 0.9 - (rr * 0.9 - 0.07) * (yb - 0.35) / (SPIRE - B_TOP - 0.38)
        S_.lathe([(r + 0.04, 0.0), (r + 0.04, 0.08), (r, 0.1)], 8, STONE_LT, cx, cz, B_TOP + 0.28 + yb, phase=math.pi / 8, smooth=False)
    for (x, z) in ((-TX + 0.05, TZ0 + 0.05), (TX - 0.05, TZ0 + 0.05), (-TX + 0.05, TZ1 - 0.05), (TX - 0.05, TZ1 - 0.05)):
        S_.box(x - 0.2, x + 0.2, B_TOP + 0.28, B_TOP + 1.1, z - 0.2, z + 0.2, STONE_LT, skip=("-y",))
        S_.box(x - 0.24, x + 0.24, B_TOP + 1.1, B_TOP + 1.2, z - 0.24, z + 0.24, STONE_LT)
        S_.lathe([(0.27, 0.0), (0.0, 1.25)], 4, STONE_LT, x, z, B_TOP + 1.2, phase=math.pi / 4, smooth=False)
        D.sphere(x, B_TOP + 2.48, z, 0.07, STONE_LT, n=6, rings=3)
    y = SPIRE
    D.sphere(cx, y + 0.06, cz, 0.1, GOLD, n=8, rings=5)
    D.box(cx - 0.03, cx + 0.03, y + 0.12, y + 0.7, cz - 0.03, cz + 0.03, COPPER)
    D.box(cx - 0.2, cx + 0.2, y + 0.44, y + 0.5, cz - 0.03, cz + 0.03, COPPER)
    for (x0, y0) in ((-0.2, y + 0.47), (0.2, y + 0.47), (0.0, y + 0.7)):
        D.sphere(cx + x0, y0, cz, 0.035, GOLD, n=6, rings=3)


def belfry(kit):
    """The open belfry (T_TOP .. B_TOP): walls 0.3 thick with paired pointed openings front and back and one each side, the
    bronze bell on its oak headstock inside, a soft lamp at night."""
    S_, D = kit.S, kit.D
    t = 0.3
    faces = {
        "front": (P.F((0.0, 0.0, TZ1), (1, 0, 0), (0, 0, 1)), TX, [(-0.42, 0.55), (0.42, 0.55)]),
        "back": (P.F((0.0, 0.0, TZ0), (-1, 0, 0), (0, 0, -1)), TX, [(-0.42, 0.55), (0.42, 0.55)]),
        "right": (P.F((TX, 0.0, (TZ0 + TZ1) / 2), (0, 0, -1), (1, 0, 0)), (TZ1 - TZ0) / 2, [(0.0, 0.62)]),
        "left": (P.F((-TX, 0.0, (TZ0 + TZ1) / 2), (0, 0, 1), (-1, 0, 0)), (TZ1 - TZ0) / 2, [(0.0, 0.62)]),
    }
    sill, top = T_TOP + 0.35, B_TOP - 0.45
    for name, (f, half, ops) in faces.items():
        holes = [(u - w / 2, u + w / 2, sill, top) for u, w in ops]
        P.wall(S_, f, -half, half, T_TOP, B_TOP, holes, STONE)
        # the inner face (seen through the openings), facing into the belfry
        fi = P.F(f.p(0.0, 0.0, -t), f.U, G.mul(f.W, -1))
        for (u0, u1, v0, v1) in _wall_cells(-half + t, half - t, T_TOP, B_TOP, holes):
            fi.quad(D, u0, u1, v0, v1, 0.0, STONE.t(G.hexc("D8C6A2")), out=1)
        for u, w in ops:
            k = 1.0
            sp = top - Q.apex_of(0.0, w, k)
            pts = Q.pointed(u, sp, w, 6, k)
            Q.head_fill(S_, f, pts, top, STONE)
            Q.head_fill(D, fi, [(-p[0], p[1]) for p in reversed(pts)], top, STONE.t(G.hexc("D8C6A2")))
            for (ua, sg) in ((u - w / 2, 1), (u + w / 2, -1)):
                q = [f.p(ua, sill, 0), f.p(ua, sp, 0), f.p(ua, sp, -t), f.p(ua, sill, -t)]
                if G.dot(G.poly_normal(q), G.mul(f.U, sg)) < 0:
                    q.reverse()
                D.poly(q, STONE_LT)
            for a, b in zip(pts, pts[1:]):
                q = [f.p(a[0], a[1], 0), f.p(b[0], b[1], 0), f.p(b[0], b[1], -t), f.p(a[0], a[1], -t)]
                mid = G.mul(G.add(q[0], q[1]), 0.5)
                if G.dot(G.poly_normal(q), G.sub(f.p(u, sp, 0), mid)) < 0:
                    q.reverse()
                D.poly(q, STONE_LT)
            q = [f.p(u - w / 2, sill, 0), f.p(u + w / 2, sill, 0), f.p(u + w / 2, sill, -t), f.p(u - w / 2, sill, -t)]
            if G.poly_normal(q)[1] < 0:
                q.reverse()
            D.poly(q, STONE_LT)
            Q.arch_ring(D, f, pts, 0.08, 0.0, 0.05, STONE_LT)
        if len(ops) == 2:
            # the colonnette between the paired openings
            p = f.p(0.0, sill, -t / 2)
            D.lathe([(0.07, 0.0), (0.07, top - sill - 0.6), (0.11, top - sill - 0.45), (0.0, top - sill - 0.44)], 8, STONE_LT, p[0], p[2], sill)
    # belfry floor and the bell
    D.box(-TX + t, TX - t, T_TOP, T_TOP + 0.05, TZ0 + t, TZ1 - t, OAK_LT)
    cx, cz = 0.0, (TZ0 + TZ1) / 2
    yb = 15.5
    D.lathe([(0.0, -0.38), (0.36, -0.38), (0.4, -0.34), (0.33, -0.2), (0.24, 0.05), (0.21, 0.22), (0.1, 0.3), (0.0, 0.31)], 14, BRONZE, cx, cz, yb)
    D.box(cx - 0.75, cx + 0.75, yb + 0.31, yb + 0.47, cz - 0.1, cz + 0.1, OAK)
    for sg in (-1, 1):
        D.box(cx + sg * 0.78 - 0.07, cx + sg * 0.78 + 0.07, T_TOP + 0.05, yb + 0.5, cz - 0.07, cz + 0.07, OAK)
    D.sphere(cx, yb - 0.36, cz, 0.06, IRON, n=6, rings=3)
    kit.glow("belfry").sphere(cx, T_TOP + 0.4, cz, 0.12, GLASS.t(P.LAMP), n=6, rings=3)
    kit.lights.append(("point", cx, T_TOP + 0.5, cz, (1.0, 0.82, 0.55), 70.0))


def _wall_cells(u0, u1, v0, v1, holes):
    us = sorted({u0, u1} | {min(max(a, u0), u1) for h in holes for a in h[:2]})
    vs = sorted({v0, v1} | {min(max(b, v0), v1) for h in holes for b in h[2:]})
    out = []
    for i in range(len(us) - 1):
        for j in range(len(vs) - 1):
            cu, cv = (us[i] + us[i + 1]) / 2, (vs[j] + vs[j + 1]) / 2
            if us[i + 1] - us[i] < 1e-4 or vs[j + 1] - vs[j] < 1e-4:
                continue
            if any(a0 < cu < a1 and b0 < cv < b1 for a0, a1, b0, b1 in holes):
                continue
            out.append((us[i], us[i + 1], vs[j], vs[j + 1]))
    return out


# ------------------------------------------------------------------------------------------------ apse --

def apse(kit):
    S_, D = kit.S, kit.D
    n = 7
    cz = BZ
    H = 6.0
    def pt(i, r=APSE_R):
        a = math.pi * i / n
        return (r * math.cos(a), cz - r * math.sin(a))
    for i in range(n):
        a, b = pt(i), pt(i + 1)
        o = P.F((a[0], 0.0, a[1]), G.norm((b[0] - a[0], 0, b[1] - a[1])), G.norm(G.cross((b[0] - a[0], 0, b[1] - a[1]), (0, 1, 0))))
        # ensure W points outward (away from the apse centre)
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        if G.dot(o.W, (mid[0], 0, mid[1] - cz)) < 0:
            o = P.F((b[0], 0.0, b[1]), G.norm((a[0] - b[0], 0, a[1] - b[1])), G.mul(o.W, -1))
        L = math.dist(a, b)
        holes = []
        if i in (1, 3, 5):
            holes = [(L / 2 - 0.25, L / 2 + 0.25, 2.6, 4.6)]
        P.wall(S_, o, 0.0, L, 0.0, H, holes, STONE)
        if holes:
            Q.lancet(kit, o, L / 2, 2.6, 0.5, 2.0, STONE_LT, STONE, glass_seed=40 + i, glow="windows", glow_col=NIGHT_GLASS[i % 4], surround=0.1, hood=False)
        o.box(S_, -0.01, L + 0.01, 0.0, 0.5, 0.0, 0.08, STONE, skip=("-w", "-v"))
        o.box(S_, -0.01, L + 0.01, H - 0.3, H - 0.05, 0.0, 0.16, STONE_LT, skip=("-w",))
    for i in (2, 5):
        a = math.pi * i / n
        u = (math.cos(a), 0, -math.sin(a))
        p = G.add((0, 0, cz), G.mul(u, APSE_R))
        f = P.F(p, G.norm(G.cross((0, 1, 0), u)), u)
        Q.buttress(S_, f, 0.0, 0.42, 0.34, 4.6, STONE, offs=2)
    # the half-cone roof (slate) from the eave ring to the east wall
    R = APSE_R + 0.2
    apex = (0.0, 8.3, cz)
    for i in range(n):
        a0, a1 = math.pi * i / n, math.pi * (i + 1) / n
        p0 = (R * math.cos(a0), H - 0.05, cz - R * math.sin(a0))
        p1 = (R * math.cos(a1), H - 0.05, cz - R * math.sin(a1))
        q = [p0, p1, apex]
        if G.poly_normal(q)[1] < 0:
            q.reverse()
        S_.poly(q, ROOF.u(G.norm(G.sub(p1, p0))))
        q2 = [p0, p1, (p1[0] * APSE_R / R, H - 0.25, cz + (p1[2] - cz) * APSE_R / R), (p0[0] * APSE_R / R, H - 0.25, cz + (p0[2] - cz) * APSE_R / R)]
        if G.poly_normal(q2)[1] > 0:
            q2.reverse()
        S_.poly(q2, STONE_LT)


# ------------------------------------------------------------------------------------------------ roof --

def roof(kit):
    S_, D = kit.S, kit.D
    for sg in (-1, 1):
        q = [(sg * RX, REY, BZ - 0.05), (sg * RX, REY, FZ - 0.05), (0.0, RIDGE, FZ - 0.05), (0.0, RIDGE, BZ - 0.05)]
        if G.poly_normal(q)[1] < 0:
            q.reverse()
        S_.poly(q, ROOF.u((0, 0, 1)))
        # soffit under the eave overhang
        q = [(sg * RX, REY - 0.12, BZ), (sg * RX, REY - 0.12, FZ), (sg * SX, REY - 0.12, FZ), (sg * SX, REY - 0.12, BZ)]
        if G.poly_normal(q)[1] > 0:
            q.reverse()
        S_.poly(q, STONE_LT)
        S_.box(min(sg * RX, sg * (RX - 0.04)), max(sg * RX, sg * (RX - 0.04)), REY - 0.14, REY + 0.03, BZ, FZ, STONE_LT, skip=("-z", "+z"))
    # east gable coping and its stone cross; west copings are on the front pieces
    fb = fr()["back"]
    for sg in (-1, 1):
        coping(kit, fb, sg * (SX + 0.05), EAVE - 0.05, 0.0, RIDGE + 0.05)
    p = (0.0, RIDGE + 0.28, BZ)
    S_.box(-0.06, 0.06, p[1], p[1] + 0.95, BZ - 0.06, BZ + 0.06, STONE_LT)
    S_.box(-0.3, 0.3, p[1] + 0.55, p[1] + 0.67, BZ - 0.06, BZ + 0.06, STONE_LT)
    S_.box(-0.16, 0.16, p[1] - 0.05, p[1] + 0.1, BZ - 0.12, BZ + 0.12, STONE_LT)
    # crested ridge tiles (instanced), from the east gable to the tower
    rt = Mesh("ridge_tile")
    rt.member((0.0, 0.0, -0.21), (0.0, 0.0, 0.21), [(-0.17, -0.06), (0.17, -0.06), (0.12, 0.04), (0.0, 0.09), (-0.12, 0.04)], ROOF.t(G.hexc("A9B0BA")))
    z = BZ + 0.25
    while z < TZ0 - 0.2:
        kit.place("ridge", rt, 0.0, RIDGE + 0.02, z, 0.0)
        z += 0.42
    # copper rainwater: half-round gutters on the eaves, two downpipes at the east corners, rain heads
    for sg in (-1, 1):
        x = sg * (RX + 0.05)
        prof = [(0.07 * math.cos(math.pi + math.pi * i / 6), 0.07 * math.sin(math.pi + math.pi * i / 6)) for i in range(7)] + [(0.065, 0.0), (0.0, -0.055), (-0.065, 0.0)]
        D.member((x, REY - 0.08, BZ + 0.05), (x, REY - 0.08, FZ - 0.05), prof, COPPER)
        for zz in (BZ + 0.3, FZ - 0.3):
            D.member((x, 0.15, zz), (x, REY - 0.42, zz), G.prof_round(0.05, 8), COPPER)
            D.box(x - 0.11, x + 0.11, REY - 0.45, REY - 0.2, zz - 0.13, zz + 0.13, COPPER)
            D.member((x, REY - 0.2, zz), (x, REY - 0.1, zz), G.prof_round(0.04, 6), COPPER)
            D.box(x - 0.09, x + 0.09, 0.0, 0.15, zz - 0.09, zz + 0.09, GRAN)


# ------------------------------------------------------------------------------------------------ gardens --

LAVENDER = Q.lavender_kind("lavender", LAV_STEM, PET_LAV)
ROSE_BUSH = Q.rose_kind("rose_bush", LEAF_DK, PET_ROSE)
FLOWER_W = Q.flower_low_kind("flower_w", LEAF, PET_WHITE)
FLOWER_P = Q.flower_low_kind("flower_p", LEAF, PET_ROSE)
ROSE_CLUMP = Q.rose_cluster_kind("rose_clump", LEAF_DK, LEAF, PET_ROSE, PET_ROSE2)
ROSE_CLUMP_S = Q.rose_cluster_kind("rose_clump_s", LEAF_DK, LEAF, PET_ROSE, PET_RED).transformed(lambda p: (p[0] * 0.75, p[1], p[2] * 0.75), "rose_clump_s")
BOX_BALL = Q.box_ball_kind("box_ball", BOX, LEAF_DK)


def gardens(kit):
    D, Gd = kit.D, kit.G
    # forecourt: granite flag path and the two lantern posts
    for k in range(6):
        z0 = FZ + 0.45 + k * 0.45
        if z0 > 8.45:
            break
        Gd.box(-1.6, 1.6, 0.0, 0.03, z0 + 0.008, min(z0 + 0.44, 8.48), GRAN.o((k * 0.37, k * 0.21)), skip=("-y",))
    for sg, lbl in ((-1, "lamp_1"), (1, "lamp_2")):
        P.lantern_post(kit, D, sg * 2.8, 7.35, 3.2, IRON, GLASS, lbl)
    # forecourt beds (low): box edging and white flowers
    for sg in (-1, 1):
        x0, x1 = sorted((sg * 1.9, sg * 4.6))
        Q.hedge_low(Gd, x0, x1, 5.7, 5.95, BOX, 0.26)
        Q.scatter(kit, "flower_w", FLOWER_W, x0 + 0.1, x1 - 0.1, 6.0, 6.9, 0.78, 300 + sg)
    # south: the fountain garden — a gravel round, a box-hedge ring with gaps, flowers, the bench facing the fountain
    fc = (8.2, -1.2)
    _gravel_disc(Gd, fc[0], fc[1], 2.3, 20)
    _gravel_path(Gd, (5.4, 3.0), (7.2, 0.6), 1.2)
    rg = G.rng(61)
    for k in range(30):
        ang = 2 * math.pi * (k + 0.5) / 30
        if 1.75 <= ang <= 2.45 or 4.25 <= ang <= 5.17:
            continue
        kit.place("box_ball", BOX_BALL, fc[0] + 2.58 * math.cos(ang), 0.0, fc[1] + 2.58 * math.sin(ang), rg.uniform(0, 6.28))
    Q.scatter(kit, "flower_p", FLOWER_P, 9.9, 11.6, -3.6, 1.6, 0.8, 311)
    Q.scatter(kit, "flower_w", FLOWER_W, 5.5, 6.6, -4.6, -2.8, 0.8, 312)
    fountain(kit, fc)
    P.park_bench(D, 8.2, -3.975, 0.0, 1.8, OAK_LT, IRON, "bench_1")
    # north: the rose garden — a gravel path from the forecourt under the rose arch to the bench
    _gravel_path(Gd, (-5.4, 3.0), (-8.2, 0.2), 1.3)
    _gravel_path(Gd, (-8.2, 0.2), (-8.2, -3.2), 1.6)
    rose_arch(kit, -9.6, -6.8, -1.05)
    P.park_bench(D, -8.2, -3.975, 0.0, 1.8, OAK_LT, IRON, "bench_2")
    for (x0, x1, z0, z1, seed) in ((-11.7, -9.9, -4.5, 1.5, 320), (-6.5, -5.3, -4.6, -1.6, 321), (-11.6, -9.4, 1.9, 4.2, 322)):
        Q.hedge_low(Gd, x0, x1, z0 - 0.22, z0, BOX, 0.26)
        Q.scatter(kit, "flower_p" if seed % 2 else "flower_w", FLOWER_P if seed % 2 else FLOWER_W, x0 + 0.1, x1 - 0.1, z0 + 0.1, z1 - 0.1, 0.86, seed)
    kit.extra_props.append(("bench_1", (7.3, 9.1, 0.0, 0.95, -4.25, -3.7), "solid"))


def _gravel_disc(m, cx, cz, r, n):
    pts = [(cx + r * math.cos(-2 * math.pi * i / n), 0.025, cz + r * math.sin(-2 * math.pi * i / n)) for i in range(n)]
    if G.poly_normal(pts)[1] < 0:
        pts.reverse()
    m.poly(pts, GRAVEL)


def _gravel_path(m, a, b, w):
    d = G.norm((b[0] - a[0], 0, b[1] - a[1]))
    s = (d[2] * w / 2, 0, -d[0] * w / 2)
    q = [(a[0] + s[0], 0.02, a[1] + s[2]), (b[0] + s[0], 0.02, b[1] + s[2]), (b[0] - s[0], 0.02, b[1] - s[2]), (a[0] - s[0], 0.02, a[1] - s[2])]
    if G.poly_normal(q)[1] < 0:
        q.reverse()
    m.poly(q, GRAVEL)


def _hedge_ring(m, c, r0, r1, s, gaps=()):
    n = 28
    for i in range(n):
        a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
        mid = (a0 + a1) / 2
        if any(g0 <= mid <= g1 for g0, g1 in gaps):
            continue
        h = 0.27
        pts_o = [(c[0] + r1 * math.cos(a), c[1] + r1 * math.sin(a)) for a in (a0, a1)]
        pts_i = [(c[0] + r0 * math.cos(a), c[1] + r0 * math.sin(a)) for a in (a0, a1)]
        top = [(pts_o[0][0], h, pts_o[0][1]), (pts_o[1][0], h, pts_o[1][1]), (pts_i[1][0], h, pts_i[1][1]), (pts_i[0][0], h, pts_i[0][1])]
        if G.poly_normal(top)[1] < 0:
            top.reverse()
        m.poly(top, s)
        for (p, q_, out) in ((pts_o[0], pts_o[1], 1), (pts_i[1], pts_i[0], -1)):
            quad = [(p[0], 0.0, p[1]), (q_[0], 0.0, q_[1]), (q_[0], h, q_[1]), (p[0], h, p[1])]
            mid_p = ((p[0] + q_[0]) / 2 - c[0], 0, (p[1] + q_[1]) / 2 - c[1])
            if G.dot(G.poly_normal(quad), G.mul(mid_p, out)) < 0:
                quad.reverse()
            m.poly(quad, s)


def fountain(kit, c):
    """A granite quatrefoil basin (rim 0.45) with a fluted pedestal, an upper bowl and a copper spout (inside the fountain
    collider 7..9.4 x -2.4..0); the water is glass-smooth; an underwater lamp glows at night."""
    D, Gd = kit.D, kit.G
    cx, cz = c
    n = 32
    def lobe(a, r):
        return r * (0.86 + 0.14 * abs(math.cos(2 * a)))
    outer = [(cx + lobe(2 * math.pi * i / n, 1.12) * math.cos(2 * math.pi * i / n), cz + lobe(2 * math.pi * i / n, 1.12) * math.sin(2 * math.pi * i / n)) for i in range(n)]
    inner = [(cx + lobe(2 * math.pi * i / n, 0.94) * math.cos(2 * math.pi * i / n), cz + lobe(2 * math.pi * i / n, 0.94) * math.sin(2 * math.pi * i / n)) for i in range(n)]
    for i in range(n):
        j = (i + 1) % n
        for (p, q_, y0, y1, out) in ((outer[i], outer[j], 0.0, 0.45, 1), (inner[j], inner[i], 0.12, 0.45, -1)):
            quad = [(p[0], y0, p[1]), (q_[0], y0, q_[1]), (q_[0], y1, q_[1]), (p[0], y1, p[1])]
            mid = ((p[0] + q_[0]) / 2 - cx, 0, (p[1] + q_[1]) / 2 - cz)
            if G.dot(G.poly_normal(quad), G.mul(mid, out)) < 0:
                quad.reverse()
            D.poly(quad, GRAN)
        top = [(outer[i][0], 0.45, outer[i][1]), (outer[j][0], 0.45, outer[j][1]), (inner[j][0], 0.45, inner[j][1]), (inner[i][0], 0.45, inner[i][1])]
        if G.poly_normal(top)[1] < 0:
            top.reverse()
        D.poly(top, GRAN)
    pts = [(p[0], 0.12, p[1]) for p in inner]
    if G.poly_normal(pts)[1] < 0:
        pts.reverse()
    D.poly(pts, GRAN.t(G.hexc("B9C7C9")))
    pts = [(p[0], 0.36, p[1]) for p in inner]
    if G.poly_normal(pts)[1] < 0:
        pts.reverse()
    D.poly(pts, WATER)
    D.lathe([(0.24, 0.0), (0.2, 0.1), (0.12, 0.2), (0.11, 0.85), (0.16, 0.95), (0.42, 1.08), (0.46, 1.16), (0.4, 1.18), (0.0, 1.12)], 12, GRAN, cx, cz, 0.12)
    D.lathe([(0.08, 0.0), (0.06, 0.25), (0.1, 0.3), (0.0, 0.42)], 8, GRAN, cx, cz, 1.24)
    D.member((cx, 1.5, cz), (cx, 1.62, cz), G.prof_round(0.025, 6), COPPER)
    D.sphere(cx, 1.64, cz, 0.04, COPPER, n=6, rings=3)
    kit.glow("fountain").lathe([(0.0, 0.0), (0.6, 0.0)], 10, GLASS.t(G.hexc("BFE4FF")), cx, cz, 0.14)
    kit.lights.append(("point", cx, 0.5, cz, (0.8, 0.9, 1.0), 25.0))
    D.prop("fountain", (cx - 1.13, cx + 1.13, 0.0, 1.7, cz - 1.13, cz + 1.13), "solid")


def rose_arch(kit, xa, xb, z):
    """An iron rose arch (two slim legs in their 0.3 m collider boxes, a round head) covered in climbing roses: leafy clumps
    and blooms tight round the legs below 2.2 m, generous over the head."""
    D, Gd = kit.D, kit.G
    cx = (xa + xb) / 2
    r = (xb - xa) / 2
    spring = 2.25
    path = [(xa, 0.0, z), (xa, spring, z)] + [(cx - r * math.cos(math.pi * i / 10), spring + r * math.sin(math.pi * i / 10), z) for i in range(1, 10)] + [(xb, spring, z), (xb, 0.0, z)]
    for dz in (-0.07, 0.07):
        D.tube([(p[0], p[1], p[2] + dz) for p in path], 0.016, 5, IRON)
    for k in range(1, 9):
        y = 0.25 * k
        for x in (xa, xb):
            D.member((x, y, z - 0.07), (x, y, z + 0.07), G.prof_round(0.01, 4), IRON)
    for x in (xa, xb):
        D.box(x - 0.06, x + 0.06, 0.0, 0.06, z - 0.1, z + 0.1, GRAN)
    rg = G.rng(51)
    # climbing roses: leafy clumps with blooms tight round the legs below 2.2 m (inside the 0.3 m collider boxes), a generous
    # garland over the head (instanced clumps, each turned and sized a little differently)
    for x in (xa, xb):
        y = 0.35
        while y < 2.1:
            kit.place("rose_clump_s", ROSE_CLUMP_S, x + rg.uniform(-0.02, 0.02), y, z, rg.uniform(0, 6.28))
            y += 0.3
    for i in range(1, 16):
        a = math.pi * i / 16
        px, py = cx - r * math.cos(a), spring + r * math.sin(a)
        kit.place("rose_clump", ROSE_CLUMP, px + rg.uniform(-0.04, 0.04), py + rg.uniform(0.0, 0.06), z + rg.uniform(-0.06, 0.06), rg.uniform(0, 6.28))
    D.prop("arbor_1", (xa - 0.15, xa + 0.15, 0.0, 2.2, z - 0.15, z + 0.15), "solid")
    D.prop("arbor_2", (xb - 0.15, xb + 0.15, 0.0, 2.2, z - 0.15, z + 0.15), "solid")


def ground(kit):
    """Render-only ground (vrb2 owns the real one): lawn, the forecourt flags and the lane."""
    g = kit.ground
    g.poly([(-30, -0.002, -30), (-30, -0.002, 30), (30, -0.002, 30), (30, -0.002, -30)], S("PV_grass", G.hexc("B9CF8A")))
    g.poly([(-4.5, 0.0, 5.5), (-4.5, 0.0, 14), (4.5, 0.0, 14), (4.5, 0.0, 5.5)], S("PV_flags", G.hexc("F2EBDF")))
