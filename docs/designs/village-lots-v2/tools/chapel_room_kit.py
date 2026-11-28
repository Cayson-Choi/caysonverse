"""케이슨 마을 성당 안 (lot_chapel_nave, interior area lot:lot_chapel_nave at (440, 0), 9.4 x 13.4, vault 9) — the walk-in room
kit (design 11, contract 11, `LOT_INTERIORS` CHAPEL_IN), pure python on b2_room / b2_parts / B1's b1_parts, b1_geom.

A real small Gothic chapel, brand-new (owner 2026-11-17: "진짜 성당에 들어와서 실사 사진을 보는 것 같은", "새것"): honey limestone
walls, a quadripartite rib vault in three bays (honey ribs, gilt bosses, cream webs) springing from clustered shafts on
carved corbels; three figurative lancets on the sunny south side (Virgin and Child, Nativity, Assumption — real medieval glass,
CC0) laying coloured light on the floor, three grisaille lancets on the north side; a pointed chancel arch on half-columns;
the sanctuary up two marble steps behind a marble communion rail, in a five-sided apse with a deep blue star-spangled vault:
the marble altar with its linen and candles, the gilt tabernacle on its gradine with the red sanctuary lamp, the carved
crucifix (a real 16th-c. scan) on the apse wall between two grisaille lancets, the ambo, two tall brass candlesticks, white
flowers; 성모상 (a real marble scan) on the left side altar under a gilt canopy, blue niche with stars, votive candles and
roses; a saint on the right side altar; a second saint in a niche by the door; ten oak pews with carved ends, cushions and
folded kneelers on a cream-and-dove marble floor with a crimson aisle runner; the holy-water stoup, an oak confessional, the
Stations of the Cross round the walls; the oak organ gallery over the door with two pipe towers either side of the rose
window; two brass chandeliers. No words, no scripture, no names.
"""
import math

import b1_geom as G
import b1_parts as P
import b2_parts as Q
import b2_room as R2
import flora as F
import props_fine as PF
from b1_geom import Mesh, S

UNIT = "lot_chapel_nave"
STONE = S("LM_chapel_stone", G.hexc("F6E2C2"))        # honey limestone (stone_ashlar)
STONE_LT = S("LM_chapel_stone", G.hexc("FCEDD6"))     # ribs, shafts, mouldings: finer, paler
STONE_DK = S("LM_chapel_stone", G.hexc("DCC29C"))
WEB = S("LM_chapel_plaster", G.hexc("FBF3E4"))       # vault webs: warm lime-wash (plaster_painted)
BLUE = S("LM_chapel_plaster", G.hexc("2B4D9A"))      # the apse vault and Mary's niche: deep ultramarine
LINEN = S("LM_chapel_plaster", G.hexc("FFFDF8"))
MARBLE = S("LM_chapel_floor", G.hexc("FBF6EC"))        # polished white limestone / marble (plaster_painted: fine, even grain)
MARBLE_DOVE = S("LM_chapel_floor", G.hexc("C9B9A0"))   # warm dove-grey
MARBLE_ROSE = S("LM_chapel_floor", G.hexc("EBCDB8"))
OAK = S("LM_chapel_oak", G.hexc("B98A5A"))            # new oiled oak
OAK_DK = S("LM_chapel_oak", G.hexc("8E6440"))
OAK_LT = S("LM_chapel_oak", G.hexc("D8B88E"))
CRIMSON = S("LM_chapel_plaster", G.hexc("A3202D"))    # velvet cushions, kneelers, the runner (the plaster scan's fine relief takes dyes truly)
RED_CLOTH = S("LM_chapel_plaster", G.hexc("B5283A"))
GOLD = S("LM_chapel_brass", G.hexc("F5C866"))          # gilt / polished brass (aluminium_brushed as metal, tinted)
BRASS = S("LM_chapel_brass", G.hexc("E9B85E"))
TIN = S("LM_chapel_brass", G.hexc("E6E8EA"))           # organ pipes
WAX = S("LM_chapel_plaster", G.hexc("FFF8EC"))
LEAF = S("LM_chapel_plaster", G.hexc("6F9E58"))
PET_W = S("LM_chapel_plaster", G.hexc("FFFFFF"))
PET_ROSE = S("LM_chapel_plaster", G.hexc("F4A9BC"))
PET_CREAM = S("LM_chapel_plaster", G.hexc("FFF1D6"))
BOOK_RED = S("LM_chapel_plaster", G.hexc("8C1D24"))
GLASS = P.GLASS
FLAME = S("M_fire")

MATS = {
    "LM_chapel_stone": {"set": "stone_ashlar"},
    "LM_chapel_plaster": {"set": "plaster_painted"},
    "LM_chapel_floor": {"set": "plaster_painted", "rough": 0.3, "normal": 0.25},
    "LM_chapel_oak": {"set": "wood_oak", "rough": 0.8},
    "LM_chapel_brass": {"set": "aluminium_brushed", "rough": 0.42},   # polished brass / gilt: a bright dielectric (reads as gold without an environment map)
    "M_glass": {"glass": True},
    "M_fire": {"fire": True},
    "M_lightpool": {"pool": "lot_chapel_nave_lightpools", "sun": "sun from the south-south-west, 38 degrees up (light travels -x, +z)"},
}

X, Z, H = 9.4, 13.4, 9.0
NZ = 10.2                 # the chancel wall's face (the nave is z 0 .. 10.2)
CXR = 4.7
YS = 4.0                  # vault springing
CROWN = 8.95
BAYS = [(0.0, 3.4), (3.4, 6.8), (6.8, 10.2)]
WIN_Z = (1.7, 5.1, 8.5)   # the lancets sit in the bays' lunettes
WIN_SILL, WIN_H = 3.0, 2.6
APSE_C = (4.7, 10.6)
APSE_R = 2.8
APSE_N = 5
ARCH_X0, ARCH_X1 = 1.6, 7.8
ARCH_SPRING = 3.8
ARCH_K = 0.62
LOFT_Y = 3.95             # gallery floor underside
LOFT_Z = 2.1
ROSE_C = 7.1
DOOR_K = 0.6
DOOR_SPRING = 3.6 - Q.apex_of(0.0, 2.4, DOOR_K)
STATIONS_Z = (8.9, 7.8, 6.7, 5.6, 4.5, 3.4, 2.3)
SUN = G.norm((-0.761, -0.616, 0.204))   # light travelling: from the south (right wall), a little from the west


def prof(s, span, rise):
    """A pointed (two-centred) arch's height above its springing at s in 0..span (rise = its height at mid-span)."""
    h = span / 2
    r = (rise * rise + h * h) / (2 * h)
    s = min(max(s, 0.0), span)
    if s > h:
        s = span - s
    return math.sqrt(max(r * r - (s - r) ** 2, 0.0))


def y_across(x):
    return YS + prof(x, X, CROWN - YS)


def y_along(zl):
    return YS + prof(zl, 3.4, CROWN - YS)


PHONE = False


def build(spec, unit, layout, sacred, phone=False):
    """The room; `phone` = the phone LOD (lot_chapel_nave_phone.glb, contract 11: 55k / 35 draws): no small goods (flowers,
    stars, votive glasses' rims...), coarser vault, station plaques without their numerals, the lancets' saddle bars without
    the lead cames, a simple stone rose tracery instead of the carved one, the door-niche saint not loaded."""
    global PHONE
    PHONE = phone
    if phone:
        G.LOD = 0.75   # (2026-11-28: the phone's round sections at 3/4 of the PC's sides, min 8: its budget with the finer candles)
    kit = P.Kit(None)
    kit.mats = dict(MATS)
    kit.sacred = []
    kit.room_lights = []
    kit.pools = Mesh("pools")
    kit.fire = {"candles": Mesh("candles")}
    kit.fire_lights = {"light": (4.7, 1.6, 11.9)}
    sol = {s["name"]: s for s in spec["solids"]}
    walls(kit)
    vault(kit)
    chancel(kit)
    apse(kit)
    floor(kit)
    sanctuary(kit, sol)
    side_altars(kit, sol)
    pews(kit, spec)
    font_confessional(kit, sol)
    loft_organ(kit)
    chandeliers(kit)
    stations(kit)
    glass(kit)
    # renders: a soft sun through the south glass, warm haze for the shafts, the church's own lamps (on by day too)
    kit.sun_dir = (0.966, 0.0, -0.259)
    kit.sun_elev = 38
    kit.world_strength = 0.07
    kit.nightfill = [(4.7, 7.4, 3.4, 5.0, 110.0), (4.7, 7.4, 7.0, 5.0, 110.0), (4.7, 6.0, 11.4, 3.0, 70.0)]
    kit.dayfill = [(4.7, 7.6, 3.2, 5.0, 160.0), (4.7, 7.6, 7.4, 5.0, 160.0), (4.7, 6.0, 11.6, 3.5, 90.0)]
    kit.sun_energy = 9.0
    kit.look = "AgX - Medium High Contrast"
    kit.exposure = 0.55
    kit.haze = (0.2, X - 0.2, 0.0, 8.6, 0.2, Z - 0.3, 0.006)
    kit.phone_skip = {"file": "lot_chapel_nave_phone.glb", "note": "phone: load lot_chapel_nave_phone.glb (same nodes, colliders, seats and placements; no goods, coarser vault, plain rose tracery) and the *_phone sacred files; skip placements with phone=false"}
    if phone:
        kit.G = Mesh("goods")
    return kit


def walls_frames():
    return {
        "door": P.F((0.0, 0.0, 0.0), (1, 0, 0), (0, 0, 1)),
        "left": P.F((0.0, 0.0, NZ), (0, 0, -1), (1, 0, 0)),
        "right": P.F((X, 0.0, 0.0), (0, 0, 1), (-1, 0, 0)),
        "chancel": P.F((X, 0.0, NZ), (-1, 0, 0), (0, 0, -1)),
    }


# ------------------------------------------------------------------------------------------------ walls --

def walls(kit):
    S_, D, Gd = kit.S, kit.D, kit.G
    F = walls_frames()
    for side in ("left", "right"):
        f = F[side]
        us = [NZ - z for z in WIN_Z] if side == "left" else list(WIN_Z)
        holes = []
        for u in us:
            outer, hole = R2.splayed_lancet(S_, f, u, WIN_SILL, 1.0, WIN_H, 0.32, 0.17, STONE_LT, STONE_LT)
            holes.append(hole)
            Q.head_fill(S_, f, outer, hole[3], STONE)

        def top(u, side=side):
            z = NZ - u if side == "left" else u
            zl = z - 3.4 * min(int(z / 3.4 + 1e-9), 2)
            return y_along(zl)
        R2.arch_wall(S_, f, 0.0, NZ, 0.0, top, holes, STONE, step=0.34)
        # moulded string course under the windows, a low skirting (walkover height)
        f.box(D, 0.0, NZ, WIN_SILL - 0.3, WIN_SILL - 0.18, 0.0, 0.05, STONE_LT, skip=("-w", "-u", "+u"))
        f.box(D, 0.0, NZ, 0.0, 0.22, 0.0, 0.035, STONE_DK, skip=("-w", "-u", "+u"))
        # clustered vault shafts on carved corbels at the bay divisions (above head height: 2.3 .. springing)
        for z in (0.0, 3.4, 6.8, NZ):
            u = NZ - z if side == "left" else z
            shaft(kit, f, u, corner=z in (0.0, NZ))
    # west (door) wall: the door, the rose, the vault's west lunette
    f = F["door"]
    hole_door = (3.5, 5.9, 0.0, 3.6)
    hole_rose = (CXR - 1.38, CXR + 1.38, ROSE_C - 1.38, ROSE_C + 1.38)
    hole_niche = (7.55, 8.45, 1.15, 3.25)
    R2.arch_wall(S_, f, 0.0, X, 0.0, y_across, [hole_door, hole_rose, hole_niche], STONE, step=0.47)
    door_inside(kit, f)
    R2.circle_fill(S_, f, CXR, ROSE_C, 1.38, 1.38, STONE)
    rose_splay(kit, f)
    niche(kit, f, 8.0, 1.25, 0.9, 2.0, 0.42)
    f.box(D, 0.0, 3.4, 0.0, 0.22, 0.0, 0.035, STONE_DK, skip=("-w",))
    f.box(D, 6.0, X, 0.0, 0.22, 0.0, 0.035, STONE_DK, skip=("-w",))


def shaft(kit, f, u, corner=False):
    """A cluster of three slim shafts (one at a corner) from a carved corbel at 2.3 m to a moulded capital at the springing."""
    D = kit.D
    p = f.p(u, 0.0, 0.0)
    W = f.W
    U = f.U
    offs = [0.0] if corner else [-0.13, 0.0, 0.13]
    for k, o in enumerate(offs):
        c = G.add(p, G.add(G.mul(U, o if not corner else 0.0), G.mul(W, 0.1 if k == 1 or corner else 0.075)))
        if corner:
            c = G.add(p, G.add(G.mul(U, 0.09 if u < 1 else -0.09), G.mul(W, 0.09)))
        D.lathe([(0.055, 0.0), (0.055, YS - 0.35 - 2.62)], 6, STONE_LT, c[0], c[2], 2.62)
        D.lathe([(0.055, 0.0), (0.09, 0.16), (0.11, 0.24), (0.11, 0.3), (0.0, 0.31)], 6, STONE_LT, c[0], c[2], YS - 0.35)
    # the corbel: a stepped block with a carved foliage boss
    c = G.add(p, G.mul(W, 0.0))
    a, b = (u - 0.24, u + 0.24) if not corner else ((u, u + 0.26) if u < 1 else (u - 0.26, u))
    f.box(D, a, b, 2.42, 2.62, 0.0, 0.2, STONE_LT, skip=("-w",))
    f.box(D, a + 0.06, b - 0.06, 2.28, 2.42, 0.0, 0.14, STONE_LT, skip=("-w",))
    bc = f.p((a + b) / 2, 2.32, 0.12)
    D.sphere(bc[0], bc[1], bc[2], 0.07, STONE_LT, n=6, rings=3)


def door_inside(kit, f):
    """The west doors seen from inside: a splayed pointed reveal and the two oak leaves (ledges, braces, strap hinges)."""
    S_, D = kit.S, kit.D
    pts = Q.pointed(4.7, DOOR_SPRING, 2.4, 8, DOOR_K)
    Q.head_fill(S_, f, pts, 3.6, STONE)
    d = 0.3
    for (ua, sg) in ((3.5, 1), (5.9, -1)):
        q = [f.p(ua, 0.0, 0.0), f.p(ua, DOOR_SPRING, 0.0), f.p(ua, DOOR_SPRING, -d), f.p(ua, 0.0, -d)]
        if G.dot(G.poly_normal(q), G.mul(f.U, sg)) < 0:
            q.reverse()
        S_.poly(q, STONE_LT.u((0, 1, 0)))
    cen = f.p(4.7, DOOR_SPRING, 0.0)
    for a, b in zip(pts, pts[1:]):
        q = [f.p(a[0], a[1], 0.0), f.p(b[0], b[1], 0.0), f.p(b[0], b[1], -d), f.p(a[0], a[1], -d)]
        mid = G.mul(G.add(q[0], q[1]), 0.5)
        if G.dot(G.poly_normal(q), G.sub(cen, mid)) < 0:
            q.reverse()
        S_.poly(q, STONE_LT)
    outline = [(3.5, 0.0), (5.9, 0.0)] + list(reversed(pts))
    f.poly(D, [(a, b, -d) for a, b in outline], OAK.u((0, 1, 0)))
    # ledges and braces (the back of the plank doors), the meeting stile, ring handles, strap hinges' backs
    for v in (0.45, 1.6, 2.6):
        for (a, b) in ((3.58, 4.66), (4.74, 5.82)):
            f.box(D, a, b, v - 0.08, v + 0.08, -d, -d + 0.035, OAK_DK, skip=("-w",))
    for (a, b) in ((3.58, 4.66), (4.74, 5.82)):
        D.member(f.p(a + 0.05, 0.55, -d + 0.02), f.p(b - 0.05, 1.5, -d + 0.02), G.prof_box(0.1, 0.025), OAK_DK)
        D.member(f.p(a + 0.05, 1.7, -d + 0.02), f.p(b - 0.05, 2.5, -d + 0.02), G.prof_box(0.1, 0.025), OAK_DK)
    f.box(D, 4.68, 4.72, 0.0, 3.45, -d, -d + 0.02, OAK_DK, skip=("-w",))
    for uc in (4.5, 4.9):
        ring = [f.p(uc + 0.07 * math.cos(2 * math.pi * i / 10), 1.0 + 0.07 * math.sin(2 * math.pi * i / 10), -d + 0.04) for i in range(11)]
        D.tube(ring, 0.009, 4, BRASS)
        f.box(D, uc - 0.05, uc + 0.05, 0.98, 1.16, -d, -d + 0.012, BRASS, skip=("-w",))


def rose_splay(kit, f):
    """The rose's splayed stone reveal (the prop's tracery sits 0.2 m into the wall)."""
    S_ = kit.S
    n = 24
    for i in range(n):
        a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
        q = [f.p(CXR + 1.38 * math.cos(a0), ROSE_C + 1.38 * math.sin(a0), 0.0), f.p(CXR + 1.38 * math.cos(a1), ROSE_C + 1.38 * math.sin(a1), 0.0),
             f.p(CXR + 1.23 * math.cos(a1), ROSE_C + 1.23 * math.sin(a1), -0.22), f.p(CXR + 1.23 * math.cos(a0), ROSE_C + 1.23 * math.sin(a0), -0.22)]
        mid = G.mul(G.add(q[0], q[1]), 0.5)
        if G.dot(G.poly_normal(q), G.sub(f.p(CXR, ROSE_C, -0.2), mid)) < 0:
            q.reverse()
        S_.poly(q, STONE_LT)
    ring = [f.p(CXR + 1.48 * math.cos(2 * math.pi * k / 32), ROSE_C + 1.48 * math.sin(2 * math.pi * k / 32), 0.03) for k in range(33)]
    kit.D.tube(ring, 0.06, 5, STONE_LT)


def niche(kit, f, uc, sill, w, h, depth):
    """A pointed statue niche in a wall (the saint by the door): splayed sides, a blue back with gilt stars, a moulded hood."""
    S_, D = kit.S, kit.D
    sp = sill + h - Q.apex_of(0.0, w, 1.0) + 0.2
    pts = Q.pointed(uc, sp, w, 6, 1.0)
    top = max(p[1] for p in pts)
    Q.head_fill(S_, f, pts, 3.25, STONE)
    f.poly(D, [(uc - w / 2, sill, -depth), (uc + w / 2, sill, -depth)] + [(p[0], p[1], -depth) for p in reversed(pts)], BLUE)
    for (ua, sg) in ((uc - w / 2, 1), (uc + w / 2, -1)):
        q = [f.p(ua, 1.15, 0.0), f.p(ua, sp, 0.0), f.p(ua, sp, -depth), f.p(ua, 1.15, -depth)]
        if G.dot(G.poly_normal(q), G.mul(f.U, sg)) < 0:
            q.reverse()
        S_.poly(q, STONE_LT)
    for a, b in zip(pts, pts[1:]):
        q = [f.p(a[0], a[1], 0.0), f.p(b[0], b[1], 0.0), f.p(b[0], b[1], -depth), f.p(a[0], a[1], -depth)]
        mid = G.mul(G.add(q[0], q[1]), 0.5)
        if G.dot(G.poly_normal(q), G.sub(f.p(uc, sp, 0.0), mid)) < 0:
            q.reverse()
        S_.poly(q, STONE_LT)
    q = [f.p(uc - w / 2, 1.15, 0.0), f.p(uc + w / 2, 1.15, 0.0), f.p(uc + w / 2, 1.15, -depth), f.p(uc - w / 2, 1.15, -depth)]
    if G.poly_normal(q)[1] < 0:
        q.reverse()
    S_.poly(q, MARBLE)
    f.box(D, uc - w / 2 - 0.08, uc + w / 2 + 0.08, 1.15, sill, -depth, 0.0, MARBLE, skip=("-w", "+w"))
    Q.arch_ring(D, f, Q.pointed(uc, sp, w + 0.16, 6, (w + 0.0) / (w + 0.16)), 0.08, 0.0, 0.05, STONE_LT)
    stars(D, f, uc - w / 2 + 0.08, uc + w / 2 - 0.08, sill + 1.5, sp + 0.3, -depth + 0.005, seed=11, count=9)


def stars(m, f, u0, u1, v0, v1, w, seed=0, count=20, r=0.035):
    rg = G.rng(seed)
    for _ in range(count):
        u, v = rg.uniform(u0, u1), rg.uniform(v0, v1)
        pts = []
        for k in range(10):
            a = math.pi / 2 + 2 * math.pi * k / 10
            rr = r if k % 2 == 0 else r * 0.42
            pts.append((u + rr * math.cos(a), v + rr * math.sin(a), w))
        f.poly(m, pts, GOLD)


# ------------------------------------------------------------------------------------------------ vault --

def rib_sweep(m, path, side, s, w=0.18, d=0.22, inward=(4.7, 2.0, None)):
    """A moulded rib along `path` (points on the vault surface): the section hangs inward (toward the room), `side` is the
    rib's horizontal width direction."""
    prof = [(-w / 2, 0.0), (w / 2, 0.0), (w / 2, d * 0.45), (w * 0.22, d * 0.85), (0.0, d), (-w * 0.22, d * 0.85), (-w / 2, d * 0.45)]
    rings = []
    for i, p in enumerate(path):
        a = path[max(i - 1, 0)]
        b = path[min(i + 1, len(path) - 1)]
        t = G.norm(G.sub(b, a))
        n = G.norm(G.cross(t, side))
        tgt = (inward[0], inward[1], inward[2] if inward[2] is not None else p[2])
        if G.dot(n, G.sub(tgt, p)) < 0:
            n = G.mul(n, -1)
        sd = G.norm(G.cross(n, t))
        rings.append([G.add(p, G.add(G.mul(sd, a_), G.mul(n, b_))) for a_, b_ in prof])
    k = len(prof)
    for i in range(len(rings) - 1):
        A, Bq = rings[i], rings[i + 1]
        for j in range(k):
            jj = (j + 1) % k
            q = [A[j], A[jj], Bq[jj], Bq[j]]
            m.poly(q, s, smooth=True)
    # orient: make the faces point away from the rib's axis (fix by checking against the path)
    return rings


def _fix(m, start, centre_fn):
    for p in m.polys[start:]:
        c = G.mul(G.add(G.add(p.pts[0], p.pts[1]), G.add(p.pts[2], p.pts[3] if len(p.pts) > 3 else p.pts[2])), 0.25)
        if G.dot(G.poly_normal(p.pts), G.sub(c, centre_fn(c))) < 0:
            p.pts.reverse()
            p.uv.reverse()
            p.col.reverse()


def vault(kit):
    S_, D = kit.S, kit.D
    nx, nt = (14, 7) if PHONE else (22, 10)
    xs = [X * (0.5 - 0.5 * math.cos(math.pi * i / nx)) for i in range(nx + 1)]
    ts = [0.5 - 0.5 * math.cos(math.pi * j / nt) for j in range(nt + 1)]
    for (z0, z1) in BAYS:
        L = z1 - z0
        grid = [[(x, max(y_across(x), y_along(t * L)), z0 + t * L) for x in xs] for t in ts]
        for j in range(nt):
            for i in range(nx):
                q = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]]
                if G.poly_normal(q)[1] > 0:
                    q.reverse()
                S_.poly(q, WEB, smooth=True)
        # diagonal ribs (the groins), transverse rib at z1 (not at the chancel), wall ribs along the side walls
        for qx in (0, 1):
            for qz in (0, 1):
                path = []
                nk = 8 if PHONE else 12
                for k in range(nk + 1):
                    x = 4.7 * (0.5 - 0.5 * math.cos(math.pi * k / nk))
                    yt = y_across(x)
                    lo, hi = 0.0, L / 2
                    for _ in range(40):
                        mid = (lo + hi) / 2
                        if y_along(mid) < yt:
                            lo = mid
                        else:
                            hi = mid
                    zl = (lo + hi) / 2
                    px = x if qx == 0 else X - x
                    pz = z0 + (zl if qz == 0 else L - zl)
                    path.append((px, yt + 0.01, pz))
                dirv = G.norm((path[-1][0] - path[0][0], 0.0, path[-1][2] - path[0][2]))
                side = (-dirv[2], 0.0, dirv[0])
                start = len(D.polys)
                rib_sweep(D, path, side, STONE_LT)
                _fix(D, start, lambda c, path=path: _nearest(path, c))
        if z1 < NZ - 1e-6:
            path = [(x, y_across(x) + 0.01, z1) for x in xs]
            start = len(D.polys)
            rib_sweep(D, path, (0, 0, 1), STONE_LT, w=0.22, d=0.26)
            _fix(D, start, lambda c, path=path: _nearest(path, c))
        for xw in (0.04, X - 0.04):
            path = [(xw, y_along(t * L) + 0.01, z0 + t * L) for t in ts]
            start = len(D.polys)
            rib_sweep(D, path, (1, 0, 0), STONE_LT, w=0.12, d=0.12)
            _fix(D, start, lambda c, path=path: _nearest(path, c))
        # the gilt boss at the crossing: a rosette
        bz = (z0 + z1) / 2
        D.lathe([(0.0, 0.0), (0.2, 0.02), (0.22, 0.07), (0.15, 0.12), (0.0, 0.14)], 10, GOLD, 4.7, bz, CROWN - 0.33)
        for k in range(8):
            a = 2 * math.pi * k / 8
            D.sphere(4.7 + 0.2 * math.cos(a), CROWN - 0.27, bz + 0.2 * math.sin(a), 0.055, GOLD, n=5, rings=3)
    # west wall rib (formeret over the rose)
    path = [(x, y_across(x) + 0.01, 0.04) for x in xs]
    start = len(D.polys)
    rib_sweep(D, path, (0, 0, 1), STONE_LT, w=0.12, d=0.12)
    _fix(D, start, lambda c, path=path: _nearest(path, c))


def _nearest(path, c):
    best = min(path, key=lambda p: (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2)
    return best


# ------------------------------------------------------------------------------------------------ chancel + apse --

def chancel(kit):
    S_, D = kit.S, kit.D
    f = walls_frames()["chancel"]
    span = ARCH_X1 - ARCH_X0
    pts = Q.pointed(4.7, ARCH_SPRING, span, 10, ARCH_K)
    apex = max(p[1] for p in pts)
    R2.arch_wall(S_, f, 0.0, X, 0.0, lambda u: y_across(X - u), [(ARCH_X0, ARCH_X1, 0.0, apex)], STONE, step=0.47)
    Q.head_fill(S_, f, pts, apex, STONE)
    # the arch's soffit (0.4 deep) and its jambs, a roll moulding on the face, half-columns with capitals
    d = 0.4
    cen = f.p(4.7, ARCH_SPRING, 0.0)
    for a, b in zip(pts, pts[1:]):
        q = [f.p(a[0], a[1], 0.0), f.p(b[0], b[1], 0.0), f.p(b[0], b[1], -d), f.p(a[0], a[1], -d)]
        mid = G.mul(G.add(q[0], q[1]), 0.5)
        if G.dot(G.poly_normal(q), G.sub(cen, mid)) < 0:
            q.reverse()
        S_.poly(q, STONE_LT)
    for (ua, sg) in ((ARCH_X0, 1), (ARCH_X1, -1)):
        q = [f.p(ua, 0.0, 0.0), f.p(ua, ARCH_SPRING, 0.0), f.p(ua, ARCH_SPRING, -d), f.p(ua, 0.0, -d)]
        if G.dot(G.poly_normal(q), G.mul(f.U, sg)) < 0:
            q.reverse()
        S_.poly(q, STONE_LT)
        x = X - ua
        for zc in (NZ + 0.15, NZ + d - 0.15):
            xx = x + 0.07 if x < 4.7 else x - 0.07
            D.lathe([(0.1, 0.0), (0.1, 0.25), (0.075, 0.32), (0.075, ARCH_SPRING - 0.28), (0.12, ARCH_SPRING - 0.1), (0.14, ARCH_SPRING - 0.02), (0.0, ARCH_SPRING)],
                    8, STONE_LT, xx, zc, 0.0)
    Q.arch_ring(D, f, Q.pointed(4.7, ARCH_SPRING, span + 0.24, 10, (span * ARCH_K + 0.12) / (span + 0.24)), 0.12, 0.0, 0.06, STONE_LT)
    # return walls from the arch's jambs to the apse (z 10.6, x 1.6 .. 1.9 and 7.5 .. 7.8) up to the springing
    for (xa, xb) in ((ARCH_X0, APSE_C[0] - APSE_R), (APSE_C[0] + APSE_R, ARCH_X1)):
        q = [(xa, 0.0, NZ + d), (xb, 0.0, NZ + d), (xb, YS + 0.3, NZ + d), (xa, YS + 0.3, NZ + d)]
        if G.poly_normal(q)[2] > 0:
            q.reverse()
        S_.poly(q, STONE)


def apse_pts():
    cx, cz = APSE_C
    return [(cx + APSE_R * math.cos(math.pi * i / APSE_N), cz + APSE_R * math.sin(math.pi * i / APSE_N)) for i in range(APSE_N + 1)]


APSE_TOP = 7.35


def apse_arch_lining(m):
    """Stone infill between the pointed chancel arch and the narrower elliptical mouth of the half-dome."""
    cx, cz = APSE_C
    outer = Q.pointed(cx, ARCH_SPRING, ARCH_X1 - ARCH_X0, 8, ARCH_K)
    sections = []
    for i, (x, y) in enumerate(outer):
        angle = math.pi * i / 16
        inner = (cx - APSE_R * math.cos(angle), YS + (APSE_TOP - YS) * math.sin(angle), cz)
        # The backing laps behind the moulded soffit and meets the dome's eight existing courses on either side.
        extra_x = -0.05 * math.cos(angle)
        sections.append((inner, (x + extra_x, y + 0.06 * math.sin(angle), cz + 0.012)))
    for (a, b), (c, d) in zip(sections, sections[1:]):
        q = [a, b, d, c]
        if G.poly_normal(q)[2] > 0:
            q.reverse()
        m.poly(q, STONE)


def apse(kit):
    S_, D, Gd = kit.S, kit.D, kit.G
    pts = apse_pts()
    cx, cz = APSE_C
    apse_arch_lining(D)
    for i in range(APSE_N):
        a, b = pts[i], pts[i + 1]
        U = G.norm((b[0] - a[0], 0.0, b[1] - a[1]))
        W = G.norm((cx - (a[0] + b[0]) / 2, 0.0, cz - (a[1] + b[1]) / 2))
        f = P.F((a[0], 0.0, a[1]), U, W)
        Lg = math.dist(a, b)
        # the frame's U runs a -> b; seen from inside the room the viewer's right must be U x up = W ... flip if needed
        if G.dot(G.cross(U, (0, 1, 0)), W) > 0:
            f = P.F((b[0], 0.0, b[1]), G.mul(U, -1), W)
        holes = []
        if i in (1, 3):
            outer, hole = R2.splayed_lancet(S_, f, Lg / 2, 1.3, 1.0, 2.6, 0.3, 0.1, STONE_LT, STONE_LT)
            holes.append(hole)
            Q.head_fill(S_, f, outer, hole[3], STONE)
        R2.arch_wall(S_, f, 0.0, Lg, 0.0, lambda u: YS, holes, STONE, step=Lg / 2)
        f.box(D, 0.0, Lg, 0.0, 0.2, 0.0, 0.03, STONE_DK, skip=("-w", "-u", "+u"))
        f.box(D, 0.0, Lg, YS - 0.12, YS, 0.0, 0.05, STONE_LT, skip=("-w", "-u", "+u"))
    # the half-dome: webs between six ribs (deep blue with gilt stars), springing from the wall top up to the arch
    apex = (cx, APSE_TOP, cz)
    nl = 8
    for i in range(APSE_N):
        a, b = pts[i], pts[i + 1]
        cols = 4
        grid = []
        for l in range(nl + 1):
            th = (math.pi / 2) * l / nl
            row = []
            for c in range(cols + 1):
                t = c / cols
                bx, bz = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
                row.append((cx + (bx - cx) * math.cos(th), YS + (APSE_TOP - YS) * math.sin(th), cz + (bz - cz) * math.cos(th)))
            grid.append(row)
        for l in range(nl):
            for c in range(cols):
                q = [grid[l][c], grid[l][c + 1], grid[l + 1][c + 1], grid[l + 1][c]]
                if l == nl - 1:
                    q = [grid[l][c], grid[l][c + 1], apex]
                mid = G.mul(G.add(q[0], q[1]), 0.5)
                if G.dot(G.poly_normal(q), G.sub((cx, 3.0, cz), mid)) < 0:
                    q.reverse()
                S_.poly(q, BLUE, smooth=True)
        # gilt stars on the web (a little inside it)
        rg = G.rng(500 + i)
        for k in range(9):
            th = rg.uniform(0.15, 1.35)
            t = rg.uniform(0.1, 0.9)
            bx, bz = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
            p = (cx + (bx - cx) * math.cos(th) * 0.985, YS + (APSE_TOP - YS) * math.sin(th) - 0.01, cz + (bz - cz) * math.cos(th) * 0.985)
            nrm = G.norm(G.sub((cx, 3.0, cz), p))
            u = G.norm(G.cross(nrm, (0, 1, 0))) if abs(nrm[1]) < 0.95 else (1, 0, 0)
            v = G.cross(u, nrm)
            star = []
            for j in range(10):
                ang = math.pi / 2 + 2 * math.pi * j / 10
                rr = 0.07 if j % 2 == 0 else 0.03
                star.append(G.add(p, G.add(G.mul(u, rr * math.cos(ang)), G.mul(v, rr * math.sin(ang)))))
            if G.dot(G.poly_normal(star), nrm) < 0:
                star.reverse()
            Gd.poly(star, GOLD)
    for i in range(APSE_N + 1):
        a = pts[i]
        path = [(cx + (a[0] - cx) * math.cos((math.pi / 2) * l / nl) * 0.995, YS + (APSE_TOP - YS) * math.sin((math.pi / 2) * l / nl) - 0.005,
                 cz + (a[1] - cz) * math.cos((math.pi / 2) * l / nl) * 0.995) for l in range(nl + 1)]
        side = G.norm((-(a[1] - cz), 0.0, a[0] - cx))
        start = len(D.polys)
        rib_sweep(D, path, side, STONE_LT, w=0.16, d=0.18, inward=(cx, 3.0, cz))
        _fix(D, start, lambda c, path=path: _nearest(path, c))
    D.lathe([(0.0, 0.0), (0.24, 0.02), (0.26, 0.08), (0.0, 0.14)], 10, GOLD, cx, cz + 0.15, APSE_TOP - 0.2)


# ------------------------------------------------------------------------------------------------ floor --

def floor(kit):
    S_, Gd = kit.S, kit.G
    n_x, n_z = 16, 17
    for i in range(n_x):
        for j in range(n_z):
            x0, x1 = X * i / n_x, X * (i + 1) / n_x
            z0, z1 = NZ * j / n_z, NZ * (j + 1) / n_z
            s = MARBLE if (i + j) % 2 == 0 else MARBLE_DOVE
            S_.poly([(x0, 0.0, z0), (x0, 0.0, z1), (x1, 0.0, z1), (x1, 0.0, z0)], s.o((i * 0.37, j * 0.53)))
    # the crimson runner up the aisle with a gold border
    for (a, b, s, y) in ((4.22, 5.18, CRIMSON, 0.008), (4.27, 4.32, GOLD, 0.0095), (5.08, 5.13, GOLD, 0.0095)):
        Gd.poly([(a, y, 0.35), (a, y, NZ - 0.05), (b, y, NZ - 0.05), (b, y, 0.35)], s.u((0, 0, 1)))


# ------------------------------------------------------------------------------------------------ sanctuary --

def sanctuary(kit, sol):
    S_, D, Gd = kit.S, kit.D, kit.G
    fire = kit.fire["candles"]
    cx, cz = APSE_C
    # two marble steps: the first (0.22) across the arch, then the platform (0.45) over the apse floor
    D.box(ARCH_X0, ARCH_X1, 0.0, 0.22, NZ, NZ + 0.3, MARBLE, skip=("-y", "-x", "+x"))
    D.box(ARCH_X0, ARCH_X1, 0.22, 0.45, NZ + 0.3, NZ + 0.4, MARBLE, skip=("-y", "-x", "+x", "+z"))
    D.box(ARCH_X0, ARCH_X1, 0.0, 0.025, NZ - 0.02, NZ + 0.0, GOLD, skip=("-y",))
    top = [(ARCH_X0, NZ + 0.3), (ARCH_X1, NZ + 0.3), (ARCH_X1, NZ + 0.4)] + [p for p in apse_pts()] + [(ARCH_X0, NZ + 0.4)]
    pts = [(x, 0.45, z) for x, z in top]
    if G.poly_normal(pts)[1] < 0:
        pts.reverse()
    S_.poly(pts, MARBLE_ROSE)
    # a dove-grey marble border inlaid round the altar
    for (x0, x1, z0, z1) in ((3.3, 6.1, 11.15, 11.25), (3.3, 6.1, 12.65, 12.75), (3.3, 3.4, 11.15, 12.75), (6.0, 6.1, 11.15, 12.75)):
        Gd.poly([(x0, 0.452, z0), (x0, 0.452, z1), (x1, 0.452, z1), (x1, 0.452, z0)], MARBLE_DOVE)
    # communion rail: marble balusters under a moulded rail, a gap in the middle
    bal = Mesh("baluster")
    bal.lathe([(0.05, 0.0), (0.05, 0.05), (0.035, 0.1), (0.06, 0.28), (0.035, 0.46), (0.045, 0.52), (0.0, 0.53)], 6 if PHONE else 10, MARBLE)
    for (a, b) in ((ARCH_X0 + 0.15, 4.1), (5.3, ARCH_X1 - 0.15)):
        D.box(a, b, 0.45, 0.52, NZ + 0.32, NZ + 0.48, MARBLE)
        D.cbox(a - 0.02, b + 0.02, 1.05, 1.13, NZ + 0.3, NZ + 0.5, MARBLE, c=0.02)
        x = a + 0.12
        while x < b - 0.08:
            kit.place("baluster", bal, x, 0.52, NZ + 0.4, 0.0)
            x += 0.22
        for x in (a, b):
            D.cbox(x - 0.07, x + 0.07, 0.45, 1.05, NZ + 0.33, NZ + 0.47, MARBLE, c=0.015)
    # the altar: a white marble block with sunk quatrefoil panels, a moulded mensa, the linen with a gold-lace edge
    ax0, ax1, az0, az1 = 3.7, 5.7, 11.55, 12.35
    D.cbox(ax0 + 0.08, ax1 - 0.08, 0.45, 1.36, az0 + 0.08, az1 - 0.08, MARBLE, c=0.02)
    D.cbox(ax0, ax1, 0.45, 0.55, az0, az1, MARBLE, c=0.02)
    D.cbox(ax0 - 0.05, ax1 + 0.05, 1.36, 1.45, az0 - 0.05, az1 + 0.05, MARBLE, c=0.02)
    for k in range(3):
        u = ax0 + 0.08 + (ax1 - ax0 - 0.16) * (k + 0.5) / 3
        quatrefoil(D, u, 0.95, az0 + 0.075, 0.2, GOLD, MARBLE_ROSE)
    D.box(ax0 - 0.04, ax1 + 0.04, 1.45, 1.46, az0 - 0.04, az1 + 0.04, LINEN)
    D.box(ax0 - 0.04, ax1 + 0.04, 1.2, 1.46, az0 - 0.045, az0 - 0.04, LINEN)
    D.box(ax0 - 0.04, ax1 + 0.04, 1.18, 1.21, az0 - 0.05, az0 - 0.04, GOLD)
    # on the altar: four brass candlesticks with lit candles, the closed book on a stand
    for x in (ax0 + 0.15, ax0 + 0.42, ax1 - 0.42, ax1 - 0.15):
        candlestick(D, fire, x, 1.46, (az0 + az1) / 2 + 0.15, 0.32, 0.36)
    # the missal open on an oak book rest (2026-11-28: was a red block on a brass bar)
    at, tilt = PF.book_rest(D, 4.7, 1.46, 11.85, 0.36, 0.22, OAK, tilt=0.3)
    PF.open_book(D, at[0], at[1], at[2], 0.34, 0.24, BOOK_RED, S("LM_chapel_plaster", G.hexc("FBF5E6")), tilt=tilt,
                 ink=S("LM_chapel_plaster", G.hexc("B5ADA0")), lines=6 if PHONE else 9)
    # the gradine and the gilt tabernacle, the red sanctuary lamp on its brass bracket
    D.cbox(3.95, 5.45, 0.45, 1.12, 12.62, 13.15, MARBLE, c=0.02)
    D.cbox(3.9, 5.5, 1.12, 1.18, 12.58, 13.18, MARBLE, c=0.015)
    tabernacle(D, 4.7, 1.18, 12.86)
    # (the gradine's two vases of flowers: the merged sacred props' real-petal bouquets, lotprop__lot_chapel_nave_props (PC; the
    # phone's budget has none). 2026-11-28: the kit's own blob bouquets in the goods, which LotRoom stripped at load, are gone)
    D.member((3.55, 2.05, 13.1), (3.55, 2.05, 12.65), G.prof_box(0.03, 0.03), BRASS)
    lamp_y = 1.62
    D.member((3.55, 2.05, 12.65), (3.55, lamp_y + 0.18, 12.65), G.prof_round(0.006, 4), BRASS)
    Gd.lathe([(0.03, 0.0), (0.055, 0.03), (0.06, 0.12), (0.065, 0.16), (0.0, 0.16)], 16, BRASS, 3.55, 12.65, lamp_y - 0.04)
    R2.glow_disc(fire, 3.55, lamp_y + 0.13, 12.65, 0.06, (1.0, 0.12, 0.08), 0.85, n=8)
    R2.candle_flame(fire, 3.55, lamp_y + 0.12, 12.65, 0.03, 0.009, seed=91)
    kit.room_lights.append(("point", 3.55, lamp_y + 0.25, 12.6, (1.0, 0.25, 0.15), 6.0))
    # two tall brass floor candlesticks before the altar, the ambo (left), the presider's chair (right), flower urns
    for x in (3.25, 6.15):
        candlestick(D, fire, x, 0.45, 11.25, 1.05, 0.42, tall=True)
    ambo(D, 2.45, 11.15)
    chair(D, 6.95, 12.35)
    for (x, z) in ((2.75, 12.55), (6.65, 11.25)):
        urn(D, x, z)   # (its arrangement: the sacred props' flowers_urn, PC)
    # the crucifix (a real 16th-c. carved crucifix, scanned) on the apse wall above the tabernacle
    back = cz + APSE_R * math.cos(math.pi / (2 * APSE_N))   # the middle apse wall's plane
    lo, hi = R2.glb_bounds("lotstatue__lot_chapel_nave_crucifix")
    R2.place(kit, "lotstatue__%s_crucifix" % UNIT, "lotstatue__lot_chapel_nave_crucifix", (4.7, 2.3, back - hi[2] - 0.03), math.pi,
             "십자고상 (carved crucifix, real scan) on the apse wall above the tabernacle")
    # the altar's light: a warm key from the vault, a soft fill, the candle glow (render; in the game L6 bakes them)
    kit.room_lights.append(("spot", 4.7, 7.0, 9.4, (1.0, 0.86, 0.68), 900.0, (4.7, 2.2, 12.6), 34))
    kit.room_lights.append(("spot", 4.7, 6.2, 11.0, (1.0, 0.84, 0.66), 420.0, (4.7, 3.5, 13.2), 28))
    kit.room_lights.append(("point", 4.7, 1.75, 11.95, (1.0, 0.7, 0.42), 14.0))


def quatrefoil(m, u, v, z, r, gold, field):
    """A sunk quatrefoil panel on an altar front (facing -z): a rose-marble field framed by a thin gilt ring of four lobes."""
    pts = []
    for k in range(32):
        a = 2 * math.pi * k / 32
        rr = r * (0.72 + 0.28 * abs(math.cos(2 * a)))
        pts.append((u + rr * math.cos(a), v + rr * math.sin(a), z - 0.003))
    q = list(reversed(pts))
    if G.poly_normal(q)[2] > 0:
        q.reverse()
    m.poly(q, field)
    ring = [(p[0], p[1], z - 0.008) for p in pts] + [(pts[0][0], pts[0][1], z - 0.008)]
    m.tube(ring, 0.012, 4, gold)


def candlestick(m, fire, x, y, z, h, candle, tall=False):
    """A turned brass candlestick (`h` to the drip pan) with a wax candle and a soft flame."""
    if tall:
        m.lathe([(0.17, 0.0), (0.16, 0.04), (0.06, 0.12), (0.04, 0.3), (0.06, 0.36), (0.035, 0.42), (0.03, h - 0.15), (0.05, h - 0.1), (0.035, h - 0.06),
                 (0.11, h - 0.02), (0.11, h), (0.0, h + 0.005)], 12 if PHONE else 18, BRASS, x, z, y)
    else:
        m.lathe([(0.075, 0.0), (0.07, 0.02), (0.03, 0.06), (0.022, h * 0.5), (0.035, h * 0.55), (0.02, h - 0.05), (0.06, h - 0.01), (0.06, h), (0.0, h + 0.003)],
                12 if PHONE else 16, BRASS, x, z, y)
    F.candle(m, x, y + h, z, 0.026 if tall else 0.018, candle + 0.006, WAX)
    R2.candle_flame(fire, x, y + h + candle + 0.012, z, 0.05 if tall else 0.04, 0.012 if tall else 0.01, seed=int(x * 100 + z * 10))


def tabernacle(m, x, y, z):
    """A gilt tabernacle: a moulded base, a box with two doors (a raised cross and a vine border), corner colonnettes, a
    cornice, a small dome with a lantern and a cross."""
    w, d, h = 0.62, 0.48, 0.58
    m.cbox(x - w / 2 - 0.04, x + w / 2 + 0.04, y, y + 0.06, z - d / 2 - 0.04, z + d / 2 + 0.04, GOLD, c=0.01)
    m.cbox(x - w / 2, x + w / 2, y + 0.06, y + 0.06 + h, z - d / 2, z + d / 2, GOLD, c=0.012)
    zf = z - d / 2
    for sx in (-1, 1):
        m.cbox(x + sx * 0.005 if sx > 0 else x - 0.15, x + 0.15 if sx > 0 else x - 0.005, y + 0.12, y + h, zf - 0.012, zf, GOLD.t(G.hexc("FFDFA0")), c=0.004)
    m.box(x - 0.012, x + 0.012, y + 0.2, y + 0.5, zf - 0.024, zf - 0.012, GOLD)
    m.box(x - 0.07, x + 0.07, y + 0.39, y + 0.414, zf - 0.024, zf - 0.012, GOLD)
    for sx in (-1, 1):
        for sz in (-1, 1):
            m.lathe([(0.025, 0.0), (0.025, h - 0.02), (0.035, h)], 12, GOLD, x + sx * (w / 2 + 0.01), z + sz * (d / 2 + 0.01), y + 0.06)
    yt = y + 0.06 + h
    m.cbox(x - w / 2 - 0.05, x + w / 2 + 0.05, yt, yt + 0.06, z - d / 2 - 0.05, z + d / 2 + 0.05, GOLD, c=0.012)
    m.lathe([(0.22, 0.0), (0.21, 0.08), (0.16, 0.18), (0.08, 0.24), (0.04, 0.26), (0.04, 0.32), (0.06, 0.34), (0.0, 0.38)], 20, GOLD, x, z, yt + 0.06)
    m.box(x - 0.008, x + 0.008, yt + 0.44, yt + 0.6, z - 0.008, z + 0.008, GOLD)
    m.box(x - 0.05, x + 0.05, yt + 0.53, yt + 0.546, z - 0.008, z + 0.008, GOLD)


def ambo(m, x, z):
    """An oak ambo (lectern) on the platform: a panelled pedestal with a sunk pointed panel, a sloped desk with a ledge."""
    y = 0.45
    m.cbox(x - 0.32, x + 0.32, y, y + 0.08, z - 0.26, z + 0.26, OAK_DK, c=0.015)
    m.cbox(x - 0.26, x + 0.26, y + 0.08, y + 1.0, z - 0.2, z + 0.2, OAK, c=0.015)
    f = P.F((x, 0.0, z - 0.2), (1, 0, 0), (0, 0, -1))
    pts = Q.pointed(0.0, y + 0.65, 0.3, 4, 1.0)
    f.poly(m, [(-0.15, y + 0.2, 0.004), (0.15, y + 0.2, 0.004)] + [(p[0] * -1, p[1], 0.004) for p in pts], OAK_DK)
    m.member((x - 0.3, y + 1.0, z + 0.22), (x + 0.3, y + 1.0, z + 0.22), G.prof_box(0.04, 0.04), OAK)
    q = [(x - 0.32, y + 1.02, z - 0.24), (x + 0.32, y + 1.02, z - 0.24), (x + 0.32, y + 1.14, z + 0.22), (x - 0.32, y + 1.14, z + 0.22)]
    m.poly(q, OAK)
    m.poly(list(reversed([(p[0], p[1] - 0.03, p[2]) for p in q])), OAK)
    m.box(x - 0.3, x + 0.3, y + 1.0, y + 1.06, z - 0.27, z - 0.24, BRASS)


def chair(m, x, z):
    """The presider's chair: oak with a crimson seat and a pointed back panel (faces the nave)."""
    y = 0.45
    for sx in (-1, 1):
        for sz in (-1, 1):
            m.cbox(x + sx * 0.26 - 0.03, x + sx * 0.26 + 0.03, y, y + (0.62 if sz < 0 else 1.25), z + sz * 0.2 - 0.03, z + sz * 0.2 + 0.03, OAK, c=0.008)
    m.cbox(x - 0.29, x + 0.29, y + 0.42, y + 0.47, z - 0.24, z + 0.24, OAK, c=0.01)
    m.cbox(x - 0.25, x + 0.25, y + 0.47, y + 0.52, z - 0.22, z + 0.2, CRIMSON, c=0.015)
    m.cbox(x - 0.24, x + 0.24, y + 0.6, y + 1.18, z + 0.19, z + 0.23, CRIMSON, c=0.015)
    for sx in (-1, 1):
        m.lathe([(0.03, 0.0), (0.03, 0.01), (0.0, 0.08)], 12, GOLD, x + sx * 0.26, z + 0.2, y + 1.25)


def urn(m, x, z):
    """A brass urn on a marble pedestal (its white-and-cream arrangement is a sacred prop: lotprop__lot_chapel_nave_props)."""
    y = 0.45
    m.lathe([(0.16, 0.0), (0.15, 0.06), (0.1, 0.12), (0.09, 0.62), (0.15, 0.68), (0.16, 0.72), (0.0, 0.72)], 12 if PHONE else 20, MARBLE, x, z, y)
    m.lathe([(0.08, 0.0), (0.12, 0.05), (0.09, 0.14), (0.12, 0.26), (0.16, 0.32), (0.158, 0.33), (0.13, 0.325), (0.0, 0.31)], 12 if PHONE else 20, BRASS, x, z, y + 0.72)


# ------------------------------------------------------------------------------------------------ side altars --

def side_altars(kit, sol):
    S_, D, Gd = kit.S, kit.D, kit.G
    fire = kit.fire["candles"]
    fch = walls_frames()["chancel"]
    for name, statue, xs, blue in (("mary", "mary", (0.2, 1.0), True), ("saint", "saint_a", (8.4, 9.2), False)):
        x0, x1 = xs
        xc = (x0 + x1) / 2
        z0, z1 = 9.5, NZ
        zc = (z0 + z1) / 2
        # a carved limestone pedestal: base, a sunk-panel die, a moulded top (1.05)
        D.cbox(x0 + 0.03, x1 - 0.03, 0.0, 0.18, z0 + 0.06, z1 - 0.01, STONE_LT, c=0.02, skip=("-y",))
        D.cbox(x0 + 0.1, x1 - 0.1, 0.18, 0.92, z0 + 0.13, z1 - 0.04, STONE_LT, c=0.015)
        D.box(x0 + 0.18, x1 - 0.18, 0.3, 0.8, z0 + 0.128, z0 + 0.135, BLUE if blue else MARBLE_ROSE)
        D.cbox(x0 + 0.02, x1 - 0.02, 0.92, 1.05, z0 + 0.04, z1 - 0.01, MARBLE, c=0.02)
        # the wall behind: Mary's blue niche panel with gilt stars and a gilt canopy; the saint's rose-marble panel
        u0, u1 = X - x1, X - x0
        f = fch
        pts = Q.pointed((u0 + u1) / 2, 3.1, u1 - u0 - 0.04, 6, 1.0)
        f.poly(D, [(u0 + 0.02, 1.05, 0.012), (u1 - 0.02, 1.05, 0.012)] + [(p[0], p[1], 0.012) for p in reversed(pts)], BLUE if blue else MARBLE_ROSE)
        Q.arch_ring(D, f, pts, 0.05, 0.0, 0.03, GOLD)
        if blue:
            stars(Gd, f, u0 + 0.08, u1 - 0.08, 2.5, 3.3, 0.016, seed=21, count=8, r=0.03)
        canopy(D, f, (u0 + u1) / 2, u1 - u0, 2.55)
        # what stands on it: the statue (a real marble scan) facing the aisle, flowers, votive candles (Mary)
        yaw = math.pi   # facing straight down the nave (the solid is just the statue's size)
        R2.place(kit, "lotstatue__%s_%s" % (UNIT, name), "lotstatue__lot_chapel_nave_" + statue, (xc, 1.05, zc + 0.02), yaw,
                 "성모상 (Virgin and Child, a real marble scan)" if blue else "성인상 (a saint, real marble scan)")
        # (the side altars' vases: the sacred props' flowers_mary / _saint, PC; 2026-11-28: the kit's blob bouquets are gone)
        if blue:
            # a brass votive rack on the pedestal's front edge: two rows of tealights in red and clear glasses
            D.cbox(x0 + 0.05, x1 - 0.05, 0.9, 0.93, z0, z0 + 0.12, BRASS, c=0.006)
            for row, (y, zz) in enumerate(((0.93, z0 + 0.03), (0.93, z0 + 0.09))):
                for k in range(5):
                    vx = x0 + 0.13 + (x1 - x0 - 0.26) * k / 4
                    R2.glow_disc(fire, vx, y + 0.05, zz, 0.028, (1.0, 0.3, 0.15) if (k + row) % 2 else (1.0, 0.75, 0.45), 0.7, n=6)
                    R2.candle_flame(fire, vx, y + 0.03, zz, 0.028, 0.008, seed=k * 7 + row)
            kit.room_lights.append(("point", xc, 1.15, z0 + 0.05, (1.0, 0.65, 0.35), 12.0))
        kit.room_lights.append(("spot", xc + (2.6 if xc < 4.7 else -2.6), 5.2, zc - 2.6, (1.0, 0.88, 0.72), 260.0, (xc, 1.75, zc), 22))
    # the second saint in the niche by the door (right of the doors, facing the altar end)
    lo, hi = R2.glb_bounds("lotstatue__lot_chapel_nave_saint_b")
    R2.place(kit, "lotstatue__%s_saint_b" % UNIT, "lotstatue__lot_chapel_nave_saint_b", (8.0, 1.25, -hi[2] - 0.01), 0.0,
             "성인상 B (a saint, real marble scan) in the niche by the door", phone=False,
             in_wall=lambda x, z: z < 0.06)
    kit.room_lights.append(("spot", 6.6, 3.6, 2.2, (1.0, 0.86, 0.68), 120.0, (8.0, 1.9, -0.2), 26))


def canopy(m, f, uc, w, y):
    """A gilt Gothic canopy over a statue: a pierced pointed hood on two thin shafts, crocketed pinnacles, a finial."""
    m_ = m
    pts = Q.pointed(uc, y + 0.15, w - 0.1, 6, 1.0)
    for d in (0.02, 0.3):
        Q.arch_ring(m_, f, pts, 0.04, d - 0.02, d, GOLD, side=False)
    apex = max(p[1] for p in pts)
    for sx in (-1, 1):
        u = uc + sx * (w / 2 - 0.06)
        p0 = f.p(u, y, 0.32)
        m_.lathe([(0.02, 0.0), (0.02, 0.35), (0.04, 0.38), (0.0, 0.62)], 6, GOLD, p0[0], p0[2], y - 0.05)
        m_.member(f.p(u, y - 0.05, 0.0), f.p(u, y - 0.05, 0.32), G.prof_box(0.03, 0.03), GOLD)
    p = f.p(uc, apex, 0.16)
    m_.lathe([(0.03, 0.0), (0.02, 0.2), (0.05, 0.24), (0.0, 0.4)], 6, GOLD, p[0], p[2], apex - 0.02)
    m_.box(min(f.p(uc - w / 2 + 0.04, 0, 0)[0], f.p(uc + w / 2 - 0.04, 0, 0)[0]), max(f.p(uc - w / 2 + 0.04, 0, 0)[0], f.p(uc + w / 2 - 0.04, 0, 0)[0]),
           y - 0.08, y - 0.03, min(f.p(0, 0, 0.0)[2], f.p(0, 0, 0.34)[2]), max(f.p(0, 0, 0.0)[2], f.p(0, 0, 0.34)[2]), GOLD)


# ------------------------------------------------------------------------------------------------ pews --

PEW = R2.pew_kind("pew", 3.0, OAK, OAK_DK, CRIMSON, CRIMSON)


def pews(kit, spec):
    for s in spec["seats"]:
        R2.pew_place(kit, "pew", PEW, s["x"], s["z"])


# ------------------------------------------------------------------------------------------------ font + confessional --

def font_confessional(kit, sol):
    D, Gd = kit.D, kit.G
    r = sol["font"]["rect"]
    x, z = (r["x0"] + r["x1"]) / 2, (r["z0"] + r["z1"]) / 2
    D.lathe([(0.17, 0.0), (0.17, 0.06), (0.12, 0.1), (0.08, 0.16), (0.07, 0.7), (0.1, 0.76), (0.16, 0.8), (0.2, 0.9), (0.2, 0.96), (0.17, 0.97),
             (0.12, 0.9), (0.0, 0.89)], 12 if PHONE else 20, MARBLE, x, z)
    D.lathe([(0.0, 0.0), (0.16, 0.0)], 12 if PHONE else 20, GLASS, x, z, 0.93)
    # confessional: an oak booth with a panelled front, the priest's door with a pierced quatrefoil grille and a crimson
    # curtain on the penitent's side, a crested cornice
    c = sol["confessional"]["rect"]
    x0, x1, z0, z1 = c["x0"], c["x1"], c["z0"], c["z1"]
    D.cbox(x0 + 0.02, x1, 0.0, 0.12, z0, z1, OAK_DK, c=0.015, skip=("-y",))
    D.cbox(x0 + 0.02, x1 - 0.1, 0.12, 2.3, z0 + 0.04, z1 - 0.04, OAK, c=0.015)
    f = P.F((x1 - 0.1, 0.0, z1 - 0.04), (0, 0, -1), (1, 0, 0))      # its front faces +x (the aisle side)
    L = z1 - z0 - 0.08
    for (a, b, v0, v1) in ((0.06, L / 2 - 0.03, 0.2, 1.1), (0.06, L / 2 - 0.03, 1.2, 2.2), (L / 2 + 0.03, L - 0.06, 0.2, 2.2)):
        f.box(D, a, b, v0, v1, 0.0, 0.02, OAK_LT, c=0.006)
    pts = Q.pointed(L * 0.75, 1.75, 0.34, 4, 1.0)
    f.poly(D, [(L * 0.75 - 0.17, 1.45, 0.024), (L * 0.75 + 0.17, 1.45, 0.024)] + [(p[0], p[1], 0.024) for p in reversed(pts)], OAK_DK)
    for k in range(4):
        a = math.pi / 2 * k
        p = f.p(L * 0.75 + 0.07 * math.cos(a), 1.72 + 0.07 * math.sin(a), 0.03)
        D.sphere(p[0], p[1], p[2], 0.05, OAK_LT, n=6, rings=3, sy=0.6)
    f.box(D, L / 2 - 0.04, L / 2 + 0.04, 0.12, 2.3, 0.0, 0.04, OAK_DK)
    f.box(D, L * 0.25 - 0.02, L * 0.25 + 0.02, 1.0, 1.12, 0.02, 0.06, BRASS)
    D.cbox(x0, x1, 2.3, 2.42, z0, z1, OAK_DK, c=0.02)
    for k in range(5):
        zz = z0 + 0.1 + (z1 - z0 - 0.2) * k / 4
        D.lathe([(0.04, 0.0), (0.02, 0.1), (0.0, 0.17)], 4, OAK_DK, x1 - 0.06, zz, 2.42, phase=math.pi / 4, smooth=False)


# ------------------------------------------------------------------------------------------------ loft + organ --

def loft_organ(kit):
    S_, D, Gd = kit.S, kit.D, kit.G
    y0, y1 = LOFT_Y, LOFT_Y + 0.22
    # the gallery floor: a coffered oak soffit (beams) and the front beam on two big stone corbels
    D.box(0.0, X, y0, y1, 0.0, LOFT_Z, OAK, skip=("+y",))
    for k in range(1, 6):
        x = X * k / 6
        D.box(x - 0.06, x + 0.06, y0 - 0.14, y0, 0.0, LOFT_Z, OAK_DK, skip=("+y",))
    D.box(0.0, X, y0 - 0.2, y1, LOFT_Z - 0.2, LOFT_Z, OAK_DK, skip=("+y",))
    for x in (0.0, X):
        sg = 1 if x == 0 else -1
        D.box(min(x, x + sg * 0.32), max(x, x + sg * 0.32), y0 - 0.65, y0 - 0.2, LOFT_Z - 0.32, LOFT_Z, STONE_LT)
        D.box(min(x, x + sg * 0.2), max(x, x + sg * 0.2), y0 - 0.95, y0 - 0.65, LOFT_Z - 0.26, LOFT_Z - 0.06, STONE_LT)
    # balustrade: panelled oak with gilt mouldings and a capping rail
    yb0, yb1 = y1, y1 + 1.0
    D.box(0.0, X, yb0, yb1, LOFT_Z - 0.06, LOFT_Z, OAK, skip=("-y",))
    n = 9
    for k in range(n):
        a = X * k / n + 0.12
        b = X * (k + 1) / n - 0.12
        D.cbox(a, b, yb0 + 0.14, yb1 - 0.16, LOFT_Z, LOFT_Z + 0.025, OAK_LT, c=0.008)
        D.box(a + 0.08, b - 0.08, yb0 + 0.24, yb1 - 0.26, LOFT_Z + 0.025, LOFT_Z + 0.03, OAK_DK)
    D.cbox(-0.0, X, yb1, yb1 + 0.08, LOFT_Z - 0.1, LOFT_Z + 0.06, OAK_DK, c=0.02)
    # the organ: two oak towers with gilt cresting either side of the rose, a low positive in the middle, tin pipes
    for (xa, xb) in ((0.55, 2.95), (6.45, 8.85)):
        tower(kit, xa, xb, y1)
    xa, xb = 3.35, 6.05
    D.cbox(xa, xb, y1, y1 + 0.55, 0.3, 1.2, OAK, c=0.02)
    D.cbox(xa - 0.04, xb + 0.04, y1 + 0.55, y1 + 0.62, 0.26, 1.24, OAK_DK, c=0.015)
    pipes(Gd, xa + 0.12, xb - 0.12, y1 + 0.62, 1.15, 0.4, 0.95, 15)
    D.cbox(xa - 0.04, xb + 0.04, y1 + 1.36, y1 + 1.44, 0.95, 1.22, OAK_DK, c=0.015)
    kit.room_lights.append(("point", 4.7, y1 + 1.6, 1.4, (1.0, 0.82, 0.6), 35.0))


def tower(kit, xa, xb, y):
    D, Gd = kit.D, kit.G
    w = xb - xa
    tops = []
    D.cbox(xa, xb, y, y + 0.95, 0.15, 1.05, OAK, c=0.02)
    D.cbox(xa - 0.04, xb + 0.04, y + 0.95, y + 1.03, 0.11, 1.09, OAK_DK, c=0.015)
    # three flats of pipes: tall in the middle, lower either side (under the vault)
    flats = [(xa + 0.05, xa + w * 0.28, 1.45), (xa + w * 0.3, xa + w * 0.7, 2.15), (xa + w * 0.72, xb - 0.05, 1.6)]
    for (a, b, hh) in flats:
        pipes(Gd, a, b, y + 1.03, 0.95, hh * 0.72, hh, 5 if b - a < 0.8 else 7, mid_high=True)
        # side posts, a carved cornice with gilt cresting
        for x in (a - 0.03, b + 0.03):
            D.cbox(x - 0.03, x + 0.03, y + 1.03, y + 1.03 + hh + 0.12, 0.85, 1.0, OAK, c=0.01)
        D.cbox(a - 0.07, b + 0.07, y + 1.03 + hh + 0.12, y + 1.03 + hh + 0.24, 0.8, 1.04, OAK_DK, c=0.015)
        k = 0
        x = a
        while x < b:
            D.lathe([(0.03, 0.0), (0.0, 0.12)], 4, GOLD, x + 0.04, 0.92, y + 1.03 + hh + 0.24, phase=math.pi / 4, smooth=False)
            x += 0.16
            k += 1
        # carved pipe shades (pierced gilt tracery under the cornice): a pointed arcade band
        D.box(a, b, y + 1.03 + hh - 0.05, y + 1.03 + hh + 0.12, 0.93, 0.95, GOLD.t(G.hexc("E7C171")))
    D.cbox(xa, xb, y + 1.03, y + 1.03 + 0.08, 0.15, 0.85, OAK_DK, c=0.01)


def pipes(m, a, b, y, z, hmin, hmax, n, mid_high=False):
    """A flat of tin organ pipes: cylinders with a flattened mouth, foot cones; heights in a smooth curve."""
    for k in range(n):
        t = (k + 0.5) / n
        x = a + (b - a) * t
        hh = hmin + (hmax - hmin) * ((1 - abs(2 * t - 1)) if mid_high else t)
        r = min(0.055, (b - a) / n * 0.42)
        m.lathe([(0.012, 0.0), (r, 0.22), (r, hh), (r * 0.96, hh + 0.01)], 8, TIN, x, z, y)
        m.box(x - r * 0.6, x + r * 0.6, y + 0.24, y + 0.3, z + r * 0.85, z + r * 1.02, TIN.t(G.hexc("B9BEC4")))


# ------------------------------------------------------------------------------------------------ chandeliers --

CHANDELIER = R2.chandelier_kind(BRASS, WAX)


def chandeliers(kit):
    for z in (5.1, 8.5):
        y = 3.55
        kit.place("chandelier", CHANDELIER, 4.7, y, z, 0.0)
        kit.D.member((4.7, y + 0.66, z), (4.7, CROWN - 0.35, z), G.prof_round(0.012, 4), BRASS)
        kit.room_lights.append(("point", 4.7, y + 0.35, z, (1.0, 0.78, 0.52), 160.0, None, 0.4))


# ------------------------------------------------------------------------------------------------ stations + glass --

STATION_MATS = {"M_pbr_wood_oak": OAK, "M_bronze_numeral": S("LM_chapel_brass", G.hexc("C99A5B"))}
IRON = S("LM_chapel_brass", G.hexc("3B3B3E"))
LEAD = S("LM_chapel_brass", G.hexc("5E6168"))
GLASS_HW = {"M_pbr_cast_iron": IRON, "M_lead": LEAD}


def hw(node, mat):
    return not (PHONE and node.endswith("_came"))


def stations(kit):
    """The 14 Stations of the Cross: I near the sanctuary on the left wall, round by the door to XIV on the right — the
    sacred builder's moulded oak plaque with its small cross and the bronze numeral (lotprop__lot_chapel_nave_station.glb),
    merged into the room (one draw for all 14, only the right numeral each), bottom edge 1.4 m, set 1 cm into the wall."""
    spots = [((-0.012, 1.4, z), math.pi / 2, k + 1) for k, z in enumerate(STATIONS_Z)]
    spots += [((X + 0.012, 1.4, z), -math.pi / 2, k + 8) for k, z in enumerate(reversed(STATIONS_Z))]
    for at, yaw, num in spots:
        R2.merge_prop(kit.D, "lotprop__lot_chapel_nave_station", at, yaw, STATION_MATS,
                      keep=lambda node, mat, num=num: "_num_" not in node or (not PHONE and node.endswith("_num_%02d" % num)))


GLASS_ORDER = ("nativity", "assumption", "virgin")   # south lancets from the door to the sanctuary
POOL_CELL = {"virgin": (0.0, 0.0, 0.25, 665 / 1024), "nativity": (0.25, 0.0, 0.5, 665 / 1024), "assumption": (0.5, 0.0, 0.75, 665 / 1024)}


def glass(kit):
    depth = 0.32
    for z, name in zip(WIN_Z, GLASS_ORDER):
        f = "lotglass__lot_chapel_nave_glass_lancet_" + name
        R2.place(kit, "lotglass__%s_%s_%d" % (UNIT, name, WIN_Z.index(z) + 1), f, (X + depth, WIN_SILL, z), -math.pi / 2,
                 "구상 색유리 lancet (%s), south wall" % name, glow=2.0, drawOnly=f)
        R2.merge_prop(kit.D, f, (X + depth, WIN_SILL, z), -math.pi / 2, GLASS_HW, keep=hw)
        win = [(X + depth, WIN_SILL, z - 0.5), (X + depth, WIN_SILL, z + 0.5), (X + depth, WIN_SILL + WIN_H, z + 0.5), (X + depth, WIN_SILL + WIN_H, z - 0.5)]
        R2.light_pool(kit.pools, "M_lightpool", win, SUN, POOL_CELL[name])
    for k, z in enumerate(WIN_Z):
        f = "lotglass__lot_church_nave_glass_church_clear"
        R2.place(kit, "lotglass__%s_grisaille_n%d" % (UNIT, k + 1), f, (-depth, WIN_SILL, z), math.pi / 2, "grisaille lancet, north wall", glow=1.3, drawOnly=f)
        R2.merge_prop(kit.D, f, (-depth, WIN_SILL, z), math.pi / 2, GLASS_HW, keep=hw)
    # the rose over the organ, the two apse lancets either side of the crucifix
    f = "lotglass__lot_chapel_nave_glass_rose"
    R2.place(kit, "lotglass__%s_rose" % UNIT, f, (CXR, ROSE_C - 1.2, -0.22), 0.0, "장미창 (rose window), west wall", glow=1.8, drawOnly=f)
    if PHONE:
        # a plain stone tracery (12 spokes, two rings) in place of the carved one
        D = kit.D
        for c in range(12):
            a = 2 * math.pi * c / 12
            D.member((CXR + 0.3 * math.cos(a), ROSE_C + 0.3 * math.sin(a), -0.17), (CXR + 1.18 * math.cos(a), ROSE_C + 1.18 * math.sin(a), -0.17), G.prof_box(0.07, 0.07), STONE_LT)
        for rr in (0.3, 0.72, 1.18):
            D.tube([(CXR + rr * math.cos(2 * math.pi * k / 20), ROSE_C + rr * math.sin(2 * math.pi * k / 20), -0.17) for k in range(21)], 0.04, 4, STONE_LT)
    else:
        R2.merge_prop(kit.D, f, (CXR, ROSE_C - 1.2, -0.22), 0.0, {"M_pbr_stone_ashlar": STONE_LT}, smooth=True)
    pts = apse_pts()
    cx, cz = APSE_C
    for i in (1, 3):
        a, b = pts[i], pts[i + 1]
        mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        out = G.norm((mx - cx, 0.0, mz - cz))
        at = (mx + out[0] * 0.3, 1.3, mz + out[2] * 0.3)
        f = "lotglass__lot_church_nave_glass_church_clear"
        R2.place(kit, "lotglass__%s_apse_%d" % (UNIT, i), f, at, R2.yaw_facing(-out[0], -out[2]), "grisaille lancet, apse", glow=1.3, drawOnly=f)
        R2.merge_prop(kit.D, f, at, R2.yaw_facing(-out[0], -out[2]), GLASS_HW, keep=hw)
