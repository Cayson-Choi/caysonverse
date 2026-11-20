"""케이슨 마을 도서관 열람실 — the "dream library" dressing (coordinator review 2026-11-17, owner T13 "건물안에 들어와서 눈을 못 뗄
정도로 정교하고 실제스럽고 입체적으로", "정말 이런 도서관이 있었으면 좋겠다는 감동"), used by library_room_kit.py.

Reference photos (shots/lot_library/SOURCES_lot_library.md): Strahov (honey wood bookcases to a carved cornice, gilt, a
gallery feel), Admont (books in muted leather and vellum), a reading room with a carved wood overmantel and green banker's
lamps, the Biltmore library ladder. What this adds: oak panelling and pilasters, a coffered oak ceiling with plaster
coffers and roses, tall carved bookcases with a dentil cornice and gilt, book runs in real leather / cloth / vellum colours
with varied heights, leaning books, flat stacks, bookends and small treasures; a carved stone fireplace with an oak
overmantel, a real fire (crossed flame cards with emissive gradients, glowing embers, a cast-iron fire basket) and a warm
light; Persian rugs; tufted leather chesterfield armchairs with side tables and lamps; a floor globe; tall plants; brass
chandeliers; a rolling ladder on a brass rail.
"""
import math

import b1_geom as G
import b1_parts as P
import b1_room as R
import library_books as LB
from b1_geom import Mesh, S

X, Z, H = 13.4, 10.4, 5.2

OAK = S("LM_library_oak", G.hexc("C9935C"))        # warm honey oak (panelling, bookcases)
OAK_RICH = S("LM_library_oak", G.hexc("A86F3F"))
OAK_DK = S("LM_library_oak", G.hexc("7C4E2C"))
OAK_LT = S("LM_library_oak", G.hexc("E2C08E"))
PLASTER = S("LM_library_plaster", G.hexc("FADB9C"))      # warm butter-yellow upper walls (as in the reading-room photo)
COFFER = S("LM_library_plaster", G.hexc("FFF0D6"))
BRASS = S("LM_library_brass", G.hexc("F0C870"))
BRASS_DK = S("LM_library_brass", G.hexc("B98A3E"))
GILT = S("LM_library_brass", G.hexc("F7D98A"))
GILT_P = S("LM_library_paint", G.hexc("E8C068"))     # gilt tooling on book spines (painted: keeps the books to two draws)
STONE = S("LM_library_stone", G.hexc("FFF4E2"))
BRICK = S("LM_library_brick", G.hexc("E8C8B8"))
LEATHER = S("LM_library_plaster", G.hexc("B5543A"))  # oxblood leather: the plaster scan's fine pores read as hide (fabric is too dark)
LEATHER_DK = S("LM_library_plaster", G.hexc("6E2A1A"))
VELVET = S("LM_library_fabric", G.hexc("3F6B4E"))
IRON = S("LM_library_paint", G.hexc("2B2B2B"))
PAPER = S("LM_library_plaster", G.hexc("FFFBF0"))
FIRE = S("M_screen")
FLAME = S("M_fire")
PAINT_ATLAS = S("M_painting")
# the paintings atlas (b1_paintings.mjs): pixel cells (x, y, w, h), top-left origin, 1024 x 1024
PAINTING_CELLS = [(0, 0, 1024, 706), (0, 716, 256, 192), (256, 716, 256, 192), (512, 716, 256, 192), (768, 716, 256, 192)]
LEAF = S("LM_library_plaster", G.hexc("6E9E4A"))
LEAF_DK = S("LM_library_plaster", G.hexc("4C7A36"))
POT = S("LM_library_plaster", G.hexc("D98E62"))
GLASS = P.GLASS

# book cloths and leathers: muted, real (Admont / Strahov), with a few brighter modern jackets
BOOKS = ["5A3420", "7A4A2A", "3E2A1E", "6E1E1E", "234A33", "1F2F4F", "E8DCC0", "B08A5A", "5B5F2E", "5C1A2B", "1E4D52", "B8892E",
         "8E2F25", "2E3F5C", "C9B48A", "4A3A2A", "7B5E3A", "A0522D", "2F5D3A", "D8C7A0", "8C6A3E", "3D3D52", "C24A3A", "E0B060"]


# the shelf runs: real books (library_books.py on the spine atlas b1_book_atlas.mjs), 16 kinds of 0.42 m so neighbours rarely
# repeat; the old flat-colour boxes with painted gilt bars (owner 2026-11-20: "책들이 너무 허접해") are gone
RUN_SEEDS = (3, 17, 29, 41, 53, 67, 71, 83, 97, 101, 113, 127, 131, 149, 151, 163)
RUNS = [LB.run(seed) for seed in RUN_SEEDS]
PHONE = False   # the phone LOD (lot_library_reading_phone.glb): the same layout and atlases, lighter geometry (set by library_room_kit.build)


def set_phone(phone):
    """Switches the room's detail level and rebuilds the book runs (the same seeds: the same books in the same places)."""
    global PHONE
    PHONE = phone
    LB.PHONE = phone
    G.LOD = 0.6 if phone else 1.0
    RUNS[:] = [LB.run(seed) for seed in RUN_SEEDS]


# ------------------------------------------------------------------------------------------------ small props (2026-11-20) --

def leafy_plant(m, x, y, z, h=0.3, seed=1, pot=None, leaf=None, leaf_dk=None):
    """A small potted plant (owner 2026-11-20: no blobs): a glazed pot with a rim and soil, arching lance leaves (each folded
    along its midrib, two-sided) from the crown."""
    pot = pot or POT
    leaf = leaf or LEAF
    leaf_dk = leaf_dk or LEAF_DK
    r = h * 0.28
    m.lathe([(r * 0.75, 0.0), (r * 0.82, 0.01), (r, h * 0.36), (r * 1.08, h * 0.38), (r * 1.08, h * 0.42), (r * 0.98, h * 0.42), (r * 0.95, h * 0.39), (0.0, h * 0.39)], 18, pot, x, z, y)
    rg = G.rng(seed)
    base = (x, y + h * 0.39, z)
    for k in range(11):
        a = k * 2.39996 + rg.uniform(-0.2, 0.2)
        L = h * rg.uniform(0.55, 0.85)
        up = rg.uniform(0.55, 1.1)
        d = (math.cos(a), 0.0, math.sin(a))
        side = (-math.sin(a), 0.0, math.cos(a))
        wd = L * 0.16
        pts = []
        for t in (0.0, 0.25, 0.5, 0.75, 1.0):
            reach = L * t
            lift = L * (up * t - 0.75 * t * t)
            pts.append(G.add(base, (d[0] * reach, lift, d[2] * reach)))
        s_ = leaf if k % 2 else leaf_dk
        for i in range(4):
            w0 = wd * math.sin(math.pi * min(1.0, (i / 4) * 1.05 + 0.08))
            w1 = wd * math.sin(math.pi * min(1.0, ((i + 1) / 4) * 1.05 + 0.08)) if i < 3 else 0.0
            a0, a1 = pts[i], pts[i + 1]
            for sg in (-1, 1):
                e0 = G.add(a0, G.add(G.mul(side, sg * w0), (0, -0.25 * w0, 0)))
                e1 = G.add(a1, G.add(G.mul(side, sg * w1), (0, -0.25 * w1, 0)))
                q = [a0, a1, e1, e0] if sg > 0 else [a0, e0, e1, a1]
                if w1 == 0.0:
                    q = [a0, a1, e0] if sg > 0 else [a0, e0, a1]
                m.poly(q, s_, smooth=True)
                m.poly([G.add(pp, (0, -0.002, 0)) for pp in reversed(q)], s_, smooth=True)


def mini_globe(m, x, y, z, r=0.085):
    """A desk globe on a brass stand: the room's own chart (M_globe, the floor globe's map) on a tilted sphere, a meridian ring."""
    m.lathe([(0.0, 0.0), (0.055, 0.0), (0.06, 0.012), (0.045, 0.022), (0.012, 0.03), (0.009, 0.06), (0.0, 0.06)], 20, BRASS, x, z, y)
    cy = y + 0.06 + r + 0.01
    tilt = math.radians(23)
    chart = S("M_globe")

    def surf(u, v):
        lon = (u - 0.5) * math.tau + math.radians(10)
        lat = (v - 0.5) * math.pi
        px = r * math.cos(lat) * math.sin(lon)
        py = r * math.sin(lat)
        pz = r * math.cos(lat) * math.cos(lon)
        return (x + px * math.cos(tilt) - py * math.sin(tilt), cy + px * math.sin(tilt) + py * math.cos(tilt), z + pz)
    nu, nv = 24, 12
    for j in range(nv):
        v0, v1 = j / nv, (j + 1) / nv
        for i in range(nu):
            u0, u1 = i / nu, (i + 1) / nu
            if j == 0:
                uv = [((u0 + u1) / 2, v0), (u1, v1), (u0, v1)]
            elif j == nv - 1:
                uv = [(u0, v0), (u1, v0), ((u0 + u1) / 2, v1)]
            else:
                uv = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
            m.poly([surf(u, v) for u, v in uv], chart, uv=uv, smooth=True)
    ring = []
    for k in range(25):
        a = -math.pi / 2 + math.pi * k / 24
        q = ((r + 0.008) * math.cos(a), (r + 0.008) * math.sin(a))  # in the axis frame: (out along -x, up the axis)
        ax = (-math.sin(tilt), math.cos(tilt))  # the axis direction in x-y
        nx = (math.cos(tilt), math.sin(tilt))   # perpendicular in x-y
        ring.append((x - nx[0] * q[0] + ax[0] * q[1], cy - nx[1] * q[0] + ax[1] * q[1], z))
    for a_, b_ in zip(ring, ring[1:]):
        m.member(a_, b_, G.prof_box(0.006, 0.01), BRASS)
    m.member((x, y + 0.055, z), ring[0], G.prof_round(0.005, 6), BRASS)


# ------------------------------------------------------------------------------------------------ walls & ceiling --

def panelling(m, f, u0, u1, v0, v1, holes=()):
    """Raised-and-fielded oak panelling on a wall stretch (flat on the wall, within 5 cm): stiles and rails, fielded panels
    with bevelled edges, a skirting and a moulded top rail; skips openings."""
    f.box(m, u0, u1, v0, v0 + 0.18, 0.0, 0.035, OAK_DK, skip=("-w",))
    f.box(m, u0, u1, v1 - 0.12, v1, 0.0, 0.05, OAK_RICH, skip=("-w",))
    f.box(m, u0, u1, v0 + 0.18, v1 - 0.12, 0.0, 0.012, OAK, skip=("-w", "-v", "+v", "-u", "+u"))
    pw = 0.7
    n = max(1, int(round((u1 - u0) / pw)))
    rows = [(v0 + 0.3, v0 + 0.95), (v0 + 1.1, v1 - 0.25)] if v1 - v0 > 1.6 else [(v0 + 0.3, v1 - 0.25)]
    for k in range(n):
        a = u0 + (u1 - u0) * k / n + 0.09
        b = u0 + (u1 - u0) * (k + 1) / n - 0.09
        if any(h[0] - 0.05 < (a + b) / 2 < h[1] + 0.05 for h in holes):
            continue
        for (r0, r1) in rows:
            if r1 - r0 < 0.2:
                continue
            # the field (raised, bevelled): a frustum of 4 bevel quads and a flat face
            q0 = [(a, r0), (b, r0), (b, r1), (a, r1)]
            q1 = [(a + 0.05, r0 + 0.05), (b - 0.05, r0 + 0.05), (b - 0.05, r1 - 0.05), (a + 0.05, r1 - 0.05)]
            f.poly(m, [(u, v, 0.03) for u, v in q1], OAK_LT)
            for i in range(4):
                j = (i + 1) % 4
                f.poly(m, [(q0[i][0], q0[i][1], 0.014), (q0[j][0], q0[j][1], 0.014), (q1[j][0], q1[j][1], 0.03), (q1[i][0], q1[i][1], 0.03)], OAK)


def coffered_ceiling(m, kit):
    """Oak beams both ways (a 2.1 x 2.2 m grid), each coffer a recessed plaster panel with an oak bed moulding and a carved
    rose in the middle; a deep crown cornice with dentils round the room."""
    xs = [0.0] + [1.05 + 2.2 * k for k in range(6) if 1.05 + 2.2 * k < X] + [X]
    zs = [0.0] + [1.05 + 2.1 * k for k in range(5) if 1.05 + 2.1 * k < Z] + [Z]
    dep = 0.2
    for x in xs[1:-1]:
        m.box(x - 0.11, x + 0.11, H - dep, H, 0.0, Z, OAK_RICH, skip=("+y", "-z", "+z"))
    for z in zs[1:-1]:
        for (a, b) in zip(xs, xs[1:]):
            a2, b2 = a + (0.11 if a > 0 else 0.0), b - (0.11 if b < X else 0.0)
            m.box(a2, b2, H - dep, H, z - 0.11, z + 0.11, OAK_RICH, skip=("+y", "-x", "+x"))
    for (a, b) in zip(xs, xs[1:]):
        for (c, d) in zip(zs, zs[1:]):
            a2, b2 = a + (0.11 if a > 0 else 0.15), b - (0.11 if b < X else 0.15)
            c2, d2 = c + (0.11 if c > 0 else 0.15), d - (0.11 if d < Z else 0.15)
            # bed moulding inside the coffer
            for (p0, p1, q0, q1) in (() if PHONE else ((a2, b2, c2, c2 + 0.05), (a2, b2, d2 - 0.05, d2), (a2, a2 + 0.05, c2, d2), (b2 - 0.05, b2, c2, d2))):
                m.box(p0, p1, H - 0.08, H - 0.0, q0, q1, OAK, skip=("+y",))
            cx, cz = (a2 + b2) / 2, (c2 + d2) / 2
            m.lathe([(0.2, 0.0), (0.16, -0.03), (0.08, -0.05), (0.0, -0.06)], 12, COFFER.t(G.hexc("FFF6E2")), cx, cz, H - 0.001)
    # crown cornice with dentils
    W = R.walls(X, Z)
    for f, L in ((W["door"], X), (W["back"], X), (W["left"], Z), (W["right"], Z)):
        f.box(m, 0.0, L, H - dep - 0.2, H - dep - 0.05, 0.0, 0.12, OAK_RICH, skip=("-w",))
        f.box(m, 0.0, L, H - dep - 0.05, H - dep, 0.0, 0.2, OAK, skip=("-w",))
        u = 0.05
        while u < L - 0.05:
            f.box(m, u, u + 0.04, H - dep - 0.27, H - dep - 0.2, 0.0, 0.06, OAK, skip=("-w",))
            u += 0.09 if not PHONE else 0.18   # (the phone: every other dentil, twice as wide a gap)


# ------------------------------------------------------------------------------------------------ bookcases --

def bookcases(kit, sol):
    """Tall oak bookcases on stacks_w / stacks_e / stacks_b (0.4 deep against the walls, to a carved cornice at 3.3 m): a
    plinth, fluted pilasters with gilt capitals between bays, eight shelves with moulded fronts, a dentil cornice and a gilt
    crest over every other bay; the shelves full of books (instanced runs), flat stacks, bookends and treasures."""
    D, Gd = kit.D, kit.G
    rg = G.rng(77)
    last = [-1]
    shelves = [0.14 + k * 0.385 for k in range(8)]
    top = 3.3
    for name, wall in (("stacks_w", "w"), ("stacks_e", "e"), ("stacks_b", "b")):
        r = sol[name]["rect"]
        segs = [(r["x0"], 5.25), (8.15, r["x1"])] if wall == "b" else [(r["z0"], r["z1"])]
        for (s0, s1) in segs:
            L = s1 - s0
            n = max(1, int(round(L / 0.95)))
            bw = L / n

            def box(a0, a1, y0, y1, d0, d1, s, skip=(), m=D):
                if wall == "w":
                    m.box(d0, d1, y0, y1, a0, a1, s, skip=skip)
                elif wall == "e":
                    m.box(X - d1, X - d0, y0, y1, a0, a1, s, skip=skip)
                else:
                    m.box(a0, a1, y0, y1, Z - d1, Z - d0, s, skip=skip)
            box(s0, s1, 0.0, 0.14, 0.0, 0.43, OAK_DK)
            box(s0, s1, 0.1, top, 0.0, 0.02, OAK_DK)
            box(s0 - 0.02, s1 + 0.02, top, top + 0.1, 0.0, 0.46, OAK_RICH)
            box(s0 - 0.04, s1 + 0.04, top + 0.1, top + 0.16, 0.0, 0.5, OAK)
            u = s0 + 0.02
            while u < s1 - 0.04:
                box(u, u + 0.035, top - 0.07, top, 0.43, 0.47, OAK)
                u += 0.08
            for k in range(n + 1):
                a = s0 + k * bw
                box(max(s0, a - 0.035), min(s1, a + 0.035), 0.14, top, 0.0, 0.42, OAK_RICH, skip=("-y",))
                for fl in (-0.015, 0.015):
                    box(a + fl - 0.006, a + fl + 0.006, 0.3, top - 0.25, 0.42, 0.435, OAK_LT)
                box(max(s0, a - 0.045), min(s1, a + 0.045), top - 0.22, top - 0.12, 0.0, 0.445, GILT)
            for k in range(n):
                a0, a1 = s0 + k * bw + 0.035, s0 + (k + 1) * bw - 0.035
                if k % 2 == 0:
                    # gilt crest over the bay: a scrolled shell (a fan of gilded petals)
                    mid = (a0 + a1) / 2
                    for j in range(7):
                        ang = math.pi * (j + 0.5) / 7
                        p0 = (mid, top + 0.16)
                        p1 = (mid - 0.22 * math.cos(ang), top + 0.16 + 0.2 * math.sin(ang))
                        if wall == "w":
                            D.member((0.47, p0[1], p0[0]), (0.47, p1[1], p1[0]), G.prof_box(0.025, 0.012), GILT)
                        elif wall == "e":
                            D.member((X - 0.47, p0[1], p0[0]), (X - 0.47, p1[1], p1[0]), G.prof_box(0.025, 0.012), GILT)
                        else:
                            D.member((p0[0], p0[1], Z - 0.47), (p1[0], p1[1], Z - 0.47), G.prof_box(0.025, 0.012), GILT)
                for y in shelves:
                    box(a0, a1, y - 0.028, y, 0.02, 0.41, OAK)
                    box(a0, a1, y - 0.045, y - 0.028, 0.39, 0.415, OAK_RICH)
                    if y > 2.95:
                        continue
                    t = a0 + 0.01
                    while t < a1 - 0.43:
                        if rg.random() < 0.06:
                            treasure(Gd, wall, t + 0.21, y, rg)
                        else:
                            idx = rg.randrange(len(RUNS))
                            if idx == last[0]:
                                idx = (idx + 1 + rg.randrange(len(RUNS) - 1)) % len(RUNS)
                            last[0] = idx
                            place_on(kit, wall, "books_%d" % idx, RUNS[idx], t, y)
                        t += 0.43
    # the brass ladder rail along the east stacks (the rolling ladder's hooks hang on it)
    r = sol["stacks_e"]["rect"]
    D.member((X - 0.5, 3.12, r["z0"] + 0.1), (X - 0.5, 3.12, r["z1"] - 0.1), G.prof_round(0.02, 10), BRASS)
    for z in (r["z0"] + 0.1, (r["z0"] + r["z1"]) / 2, r["z1"] - 0.1):
        D.member((X - 0.5, 3.12, z), (X - 0.42, 3.12, z), G.prof_round(0.014, 6), BRASS)


def place_on(kit, wall, kind, mesh, t, y):
    if wall == "w":
        kit.place(kind, mesh, 0.41, y, t + 0.42, math.pi / 2)
    elif wall == "e":
        kit.place(kind, mesh, X - 0.41, y, t, -math.pi / 2)
    else:
        kit.place(kind, mesh, t + 0.42, y, Z - 0.41, math.pi)


def treasure(m, wall, t, y, rg):
    """A small treasure in a shelf gap: a celadon vase, a brass candlestick, a little framed picture or a potted fern."""
    if wall == "w":
        x, z = 0.24, t
    elif wall == "e":
        x, z = X - 0.24, t
    else:
        x, z = t, Z - 0.24
    k = rg.randrange(4)
    if k == 0:
        m.lathe([(0.0, 0.0), (0.05, 0.0), (0.075, 0.08), (0.05, 0.18), (0.03, 0.22), (0.04, 0.25), (0.0, 0.25)], 18, S("LM_library_paint", G.hexc(("9FC2B0", "D9B98E", "7E9BB8")[rg.randrange(3)])), x, z, y)
    elif k == 1:
        m.lathe([(0.05, 0.0), (0.045, 0.02), (0.012, 0.05), (0.015, 0.18), (0.03, 0.2), (0.0, 0.2)], 16, BRASS, x, z, y)
        m.lathe([(0.012, 0.0), (0.012, 0.09), (0.0, 0.09)], 12, PAPER, x, z, y + 0.2)
    elif k == 2:
        m.lathe([(0.06, 0.0), (0.07, 0.09), (0.0, 0.09)], 16, POT, x, z, y)
        for a in range(7):
            ang = a * 0.9
            m.member((x, y + 0.08, z), (x + 0.12 * math.cos(ang), y + 0.16, z + 0.12 * math.sin(ang)), G.prof_box(0.03, 0.006), LEAF)
    else:
        mini_globe(m, x, y, z)


# ------------------------------------------------------------------------------------------------ fireplace --

def fireplace(kit):
    """A carved limestone fireplace in the back bookcases (x 5.25..8.15): fluted pilasters on plinths, scrolled corbels, a
    frieze with a carved garland (relief), a moulded mantel shelf; a clean brick firebox with a cast-iron fire basket, oak
    logs with pale end grain, a glowing ember bed and a real fire: five flame tongues of three crossed emissive cards each,
    white-gold at the heart to orange and deep red at the tips; a brass fender; an oak overmantel with a gilt-framed oil
    landscape; candlesticks, a carriage clock and flowers on the mantel."""
    D, Gd = kit.D, kit.G
    x0, x1 = 5.35, 8.05
    zf = Z - 0.55
    cx = (x0 + x1) / 2
    D.box(x0 - 0.2, x1 + 0.2, 0.0, 0.1, zf - 0.55, Z, STONE, skip=("-y",))        # hearth slab
    for (a, b) in ((x0, x0 + 0.5), (x1 - 0.5, x1)):
        D.box(a, b, 0.1, 0.32, zf - 0.06, Z, STONE)                                   # pilaster plinths
        D.box(a + 0.06, b - 0.06, 0.32, 1.3, zf, Z, STONE)
        for k in range(4):
            u = a + 0.12 + k * (b - a - 0.24) / 3
            D.box(u - 0.018, u + 0.018, 0.4, 1.22, zf - 0.025, zf, STONE.t(G.hexc("EFE2CA")))
        D.box(a + 0.02, b - 0.02, 1.3, 1.42, zf - 0.05, Z, STONE)                     # capitals
        # scrolled corbel under the mantel
        for j in range(5):
            t0, t1 = j / 5, (j + 1) / 5
            y0, y1 = 1.42 + 0.22 * t0, 1.42 + 0.22 * t1
            dz0, dz1 = 0.05 + 0.1 * math.sin(t0 * math.pi / 2), 0.05 + 0.1 * math.sin(t1 * math.pi / 2)
            D.box(a + 0.08, b - 0.08, y0, y1, zf - max(dz0, dz1), Z, STONE)
    D.box(x0 + 0.5, x1 - 0.5, 1.3, 1.64, zf, Z, STONE)                              # frieze
    # carved garland on the frieze: a swag of leaves (raised lumps) and rosettes
    for k in range(13):
        t = k / 12
        gx = x0 + 0.62 + t * (x1 - x0 - 1.24)
        gy = 1.55 - 0.1 * math.sin(math.pi * t)
        D.sphere(gx, gy, zf - 0.01, 0.035, STONE.t(G.hexc("F2E6CF")), n=6, rings=4, sy=0.8)
    D.cbox(x0 - 0.12, x1 + 0.12, 1.64, 1.72, zf - 0.2, Z, STONE, c=0.03)          # mantel shelf
    D.box(x0 - 0.06, x1 + 0.06, 1.62, 1.64, zf - 0.14, Z, STONE.t(G.hexc("F0E3CB")))
    # firebox: brick back and cheeks, a soot-free new interior, lintel shadow
    fx0, fx1 = x0 + 0.5, x1 - 0.5
    D.box(fx0, fx1, 0.1, 1.3, Z - 0.06, Z - 0.02, BRICK)
    for x, sgn in ((fx0, 1), (fx1, -1)):
        q = [(x, 0.1, zf), (x, 1.3, zf), (x + sgn * 0.15, 1.3, Z - 0.06), (x + sgn * 0.15, 0.1, Z - 0.06)]
        if G.poly_normal(q)[0] * sgn < 0:
            q.reverse()
        D.poly(q, BRICK)
    D.poly([(fx0, 1.3, zf), (fx1, 1.3, zf), (fx1 - 0.15, 1.3, Z - 0.06), (fx0 + 0.15, 1.3, Z - 0.06)], S("LM_library_plaster", G.hexc("3A332E")))
    # the fire basket (cast iron) with andirons topped by brass balls
    bz = Z - 0.32
    for x in (cx - 0.38, cx + 0.38):
        D.member((x, 0.1, bz + 0.2), (x, 0.42, bz + 0.2), G.prof_box(0.03, 0.03), IRON)
        D.sphere(x, 0.46, bz + 0.2, 0.045, BRASS, n=8, rings=5)
    for k in range(6):
        x = cx - 0.32 + k * 0.128
        D.member((x, 0.2, bz + 0.16), (x, 0.2, bz - 0.12), G.prof_box(0.018, 0.018), IRON)
    D.member((cx - 0.36, 0.2, bz + 0.16), (cx + 0.36, 0.2, bz + 0.16), G.prof_box(0.02, 0.02), IRON)
    # ember bed and logs
    for (a, b) in (((cx - 0.4, 0.27, bz + 0.05), (cx + 0.38, 0.29, bz - 0.04)), ((cx - 0.3, 0.33, bz - 0.08), (cx + 0.32, 0.31, bz + 0.07)), ((cx - 0.15, 0.39, bz + 0.02), (cx + 0.2, 0.4, bz - 0.02))):
        Gd.member(a, b, G.prof_round(0.06, 8), OAK_DK.t(G.hexc("5A3A26")))
    soft_fire(kit, cx, 0.26, bz)
    kit.lights.append(("point", cx, 0.55, bz - 0.35, (1.0, 0.55, 0.22), 70.0))
    kit.lights.append(("point", cx, 0.4, zf - 1.2, (1.0, 0.6, 0.3), 90.0))
    kit.dayfill.append((cx, 0.8, zf - 0.8, 0.8, 30.0))
    # brass fender
    D.member((x0 + 0.45, 0.2, zf - 0.32), (x1 - 0.45, 0.2, zf - 0.32), G.prof_round(0.022, 8), BRASS)
    for x in (x0 + 0.45, x1 - 0.45):
        D.member((x, 0.1, zf - 0.32), (x, 0.2, zf - 0.32), G.prof_round(0.018, 6), BRASS)
        D.member((x, 0.2, zf - 0.32), (x, 0.2, zf), G.prof_round(0.018, 6), BRASS)
    # overmantel: oak panelled chimney breast to the cornice, a gilt-framed landscape, a carved crest
    D.box(x0 + 0.05, x1 - 0.05, 1.72, H - 0.42, zf + 0.12, Z, OAK_RICH, skip=("+z",))
    f = P.F((cx, 0.0, zf + 0.12), (1, 0, 0), (0, 0, -1))  # facing -z, but U must be the viewer's right: viewer looks +z
    f = P.F((cx, 0.0, zf + 0.12), (-1, 0, 0), (0, 0, -1))
    panelling(D, f, -1.3, 1.3, 1.72, H - 0.42)
    painting(D, f, -0.98, 0.98, 2.38, 3.73, 0, frame=0.16)
    kit.lights.append(("spot", cx, 4.1, zf - 0.4, (1.0, 0.86, 0.66), 60.0))
    # on the mantel
    for x in (x0 + 0.1, x1 - 0.1):
        Gd.lathe([(0.07, 0.0), (0.06, 0.02), (0.018, 0.06), (0.025, 0.2), (0.012, 0.32), (0.04, 0.34), (0.0, 0.35)], 18, BRASS, x, zf - 0.08, 1.72)
        Gd.lathe([(0.014, 0.0), (0.014, 0.16), (0.0, 0.16)], 12, PAPER, x, zf - 0.08, 2.07)
    Gd.cbox(cx - 0.17, cx + 0.17, 1.72, 2.0, zf - 0.14, zf + 0.02, BRASS, c=0.012)
    Gd.sphere(cx, 1.86, zf - 0.142, 0.09, PAPER, n=12, rings=5, sy=0.12)
    for (x, c) in ((cx - 0.75, "9FC2B0"), (cx + 0.75, "E0C49A")):
        Gd.lathe([(0.0, 0.0), (0.06, 0.0), (0.08, 0.1), (0.045, 0.2), (0.05, 0.24), (0.0, 0.24)], 18, S("LM_library_paint", G.hexc(c)), x, zf - 0.08, 1.72)
        for j in range(6):
            a = j * 1.05
            Gd.sphere(x + 0.06 * math.cos(a), 2.05 + 0.04 * (j % 2), zf - 0.08 + 0.06 * math.sin(a), 0.045, S("LM_library_plaster", G.hexc(("F7B9C8", "FFFFFF", "F5D06A")[j % 3])), n=6, rings=4)


def canvas(m, f, u0, u1, v0, v1, w):
    """An oil landscape in raised paint layers with soft vertex-colour gradients (sky to a warm horizon, layered hills
    fading with distance, a lake catching the sky, a village with a church, a tree in the foreground)."""
    du, dv = u1 - u0, v1 - v0
    PL = S("LM_library_plaster", (1.0, 1.0, 1.0))

    def P_(a, b):
        return (u0 + a * du, v0 + b * dv)

    def L(pts, cols, dz):
        f.poly(m, [(pt[0], pt[1], w + dz) for pt in pts], PL)
        q = m.polys[-1]
        lo = min(pp[1] for pp in q.pts)
        hi = max(pp[1] for pp in q.pts)
        c0, c1 = G.hexc(cols[0]), G.hexc(cols[1])
        q.col = [(*G.lerp(c0, c1, (pt[1] - lo) / (hi - lo) if hi > lo + 1e-6 else 0.0), 1.0) for pt in q.pts]
    L([P_(0, 0), P_(1, 0), P_(1, 1), P_(0, 1)], ("F7D9A8", "5E8FC4"), 0.0)
    for (cxp, cyp, rr) in ((0.22, 0.82, 0.05), (0.28, 0.85, 0.07), (0.35, 0.83, 0.05), (0.66, 0.9, 0.05), (0.72, 0.88, 0.06), (0.78, 0.9, 0.04)):
        L([P_(cxp + rr * math.cos(2 * math.pi * k / 12), cyp + rr * 1.2 * math.sin(2 * math.pi * k / 12)) for k in range(12)], ("F4E3CF", "FFFFFF"), 0.002)
    L([P_(0, 0.3), P_(1, 0.3), P_(1, 0.55), P_(0.85, 0.6), P_(0.7, 0.56), P_(0.5, 0.64), P_(0.3, 0.58), P_(0.12, 0.62), P_(0, 0.57)], ("8DA7B8", "A9BDCB"), 0.003)
    L([P_(0, 0.18), P_(1, 0.18), P_(1, 0.42), P_(0.75, 0.5), P_(0.55, 0.44), P_(0.32, 0.52), P_(0.1, 0.45), P_(0, 0.48)], ("5E8A4E", "8FB06A"), 0.004)
    L([P_(0.18, 0.2), P_(0.68, 0.18), P_(0.74, 0.28), P_(0.22, 0.3)], ("9CC3DE", "D9E6EE"), 0.005)
    L([P_(0, 0), P_(1, 0), P_(1, 0.2), P_(0.6, 0.24), P_(0.3, 0.19), P_(0, 0.24)], ("4C6E35", "7A9A4A"), 0.006)
    for (hx, hw_, hh, roof) in ((0.62, 0.05, 0.06, "B5523C"), (0.69, 0.04, 0.05, "9E4A36"), (0.56, 0.035, 0.045, "B5523C")):
        L([P_(hx, 0.3), P_(hx + hw_, 0.3), P_(hx + hw_, 0.3 + hh), P_(hx, 0.3 + hh)], ("E8DCC8", "F7F0E2"), 0.007)
        L([P_(hx - 0.006, 0.3 + hh), P_(hx + hw_ + 0.006, 0.3 + hh), P_(hx + hw_ / 2, 0.3 + hh + 0.035)], (roof, roof), 0.008)
    L([P_(0.75, 0.3), P_(0.79, 0.3), P_(0.79, 0.42), P_(0.75, 0.42)], ("EFE6D4", "FFFFFF"), 0.007)
    L([P_(0.745, 0.42), P_(0.795, 0.42), P_(0.77, 0.52)], ("7A8A9A", "9AAABA"), 0.008)
    L([P_(0.12, 0.08), P_(0.135, 0.08), P_(0.135, 0.4), P_(0.12, 0.4)], ("4A3424", "6A4C34"), 0.007)
    for (ox, oy, rr) in ((0.127, 0.5, 0.08), (0.09, 0.44, 0.06), (0.16, 0.45, 0.065), (0.125, 0.58, 0.055)):
        L([P_(ox + rr * math.cos(2 * math.pi * k / 12), oy + rr * 1.4 * math.sin(2 * math.pi * k / 12)) for k in range(12)], ("3E6A30", "6E9A48"), 0.008)


# ------------------------------------------------------------------------------------------------ furniture --

def chesterfield(m, cx, cz, yaw):
    """A tufted oxblood leather chesterfield armchair facing +z (local), 0.86 x 0.86: rolled arms, a deep-buttoned back and
    arm fronts, a plump seat cushion, turned bun feet, brass studs along the arm fronts."""
    a = Mesh("chesterfield")
    w, d = 0.43, 0.43
    a.cbox(-w, w, 0.12, 0.42, -d, d, LEATHER, c=0.05)
    # seat cushion
    a.cbox(-w + 0.13, w - 0.13, 0.42, 0.53, -d + 0.2, d - 0.02, LEATHER, c=0.05)
    # back with tufting (a grid of buttons and lumps)
    a.cbox(-w, w, 0.42, 0.98, -d, -d + 0.2, LEATHER, c=0.06)
    for i in range(5):
        for j in range(3):
            bx = -w + 0.12 + i * (2 * w - 0.24) / 4 + (0.04 if j % 2 else 0.0)
            by = 0.6 + j * 0.13
            if bx < w - 0.08:
                a.sphere(bx, by, -d + 0.205, 0.012, LEATHER_DK, n=5, rings=3)
                a.sphere(bx + 0.05, by + 0.06, -d + 0.2, 0.05, LEATHER, n=6, rings=3, sy=0.9)
    # rolled arms
    for sx in (-1, 1):
        x = sx * (w - 0.07)
        a.cbox(x - 0.07, x + 0.07, 0.42, 0.66, -d, d, LEATHER, c=0.05)
        a.member((x + sx * 0.0, 0.68, -d), (x + sx * 0.0, 0.68, d), G.prof_round(0.09, 12), LEATHER, caps=True)
        for k in range(7):
            a.sphere(x + sx * 0.0, 0.5 + k * 0.025, d + 0.003, 0.007, BRASS, n=4, rings=2)
    # back roll
    a.member((-w, 0.98, -d + 0.1), (w, 0.98, -d + 0.1), G.prof_round(0.1, 12), LEATHER, caps=True)
    for sx in (-1, 1):
        for sz in (-1, 1):
            a.lathe([(0.04, 0.0), (0.05, 0.05), (0.035, 0.1), (0.045, 0.12)], 16, OAK_DK, sx * (w - 0.08), sz * (d - 0.08), 0.0)
    m.extend(G.moved(a, cx, 0.0, cz, yaw))


def side_table(m, glow, lights, cx, cz):
    """A round oak side table on a turned pedestal with a brass table lamp (pleated shade), a book and a teacup."""
    m.lathe([(0.26, 0.0), (0.26, 0.03), (0.24, 0.035), (0.0, 0.035)], 16, OAK_RICH, cx, cz, 0.6)
    m.lathe([(0.2, 0.0), (0.18, 0.04), (0.05, 0.08), (0.04, 0.2), (0.06, 0.3), (0.035, 0.45), (0.05, 0.6)], 18, OAK, cx, cz, 0.0)
    lx, lz = cx - 0.07, cz - 0.05
    m.lathe([(0.07, 0.0), (0.06, 0.02), (0.05, 0.08), (0.02, 0.12), (0.012, 0.32)], 18, BRASS, lx, lz, 0.635)
    m.lathe([(0.17, 0.0), (0.11, 0.2), (0.0, 0.205)], 16, S("LM_library_fabric", G.hexc("F2DFB8")), lx, lz, 0.88)
    glow.lathe([(0.0, 0.0), (0.14, 0.02), (0.1, 0.17), (0.0, 0.18)], 16, P.GLASS.t(P.LAMP), lx, lz, 0.885)
    lights.append(("point", lx, 0.98, lz, (1.0, 0.8, 0.55), 35.0))
    m.box(cx + 0.02, cx + 0.2, 0.635, 0.66, cz - 0.02, cz + 0.12, S("LM_library_paint", G.hexc("6E1E1E")))
    m.lathe([(0.0, 0.0), (0.03, 0.0), (0.045, 0.05), (0.0, 0.05)], 18, PAPER, cx + 0.12, cz + 0.17, 0.635)
    m.lathe([(0.065, 0.0), (0.065, 0.006), (0.0, 0.006)], 12, PAPER, cx + 0.12, cz + 0.17, 0.632)


def globe(m, cx, cz):
    """An atlas globe on the oak tripod, with a brass meridian and a continuous longitude/latitude chart."""
    for k in range(3):
        a = k * 2 * math.pi / 3
        m.member((cx + 0.28 * math.cos(a), 0.0, cz + 0.28 * math.sin(a)), (cx + 0.2 * math.cos(a), 0.62, cz + 0.2 * math.sin(a)), G.prof_round(0.022, 6), OAK_RICH)
    m.lathe([(0.34, 0.0), (0.34, 0.03), (0.28, 0.03), (0.28, 0.0)], 20, OAK, cx, cz, 0.62)
    m.member((cx, 0.12, cz), (cx, 0.62, cz), G.prof_round(0.025, 6), OAK_RICH)
    gy = 0.9
    tilt = math.radians(23)
    chart = S("M_globe")
    def surface(u, v):
        # East Asia faces the aisle; the north pole follows the instrument's tilted axis.
        lon = (u - 0.5) * math.tau + math.radians(124)
        lat = (v - 0.5) * math.pi
        x = 0.27 * math.cos(lat) * math.sin(lon)
        y = 0.27 * math.sin(lat)
        z = 0.27 * math.cos(lat) * math.cos(lon)
        return (cx + x * math.cos(tilt) - y * math.sin(tilt), gy + x * math.sin(tilt) + y * math.cos(tilt), cz + z)
    for j in range(16):
        v0, v1 = j / 16, (j + 1) / 16
        for i in range(32):
            u0, u1 = i / 32, (i + 1) / 32
            if j == 0:
                uv = [((u0 + u1) / 2, v0), (u1, v1), (u0, v1)]
            elif j == 15:
                uv = [(u0, v0), (u1, v0), ((u0 + u1) / 2, v1)]
            else:
                uv = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
            m.poly([surface(u, v) for u, v in uv], chart, uv=uv, smooth=True)
    pts = [(cx + 0.3 * math.sin(math.pi * t / 16 * 2) * math.cos(tilt) - 0.3 * math.cos(math.pi * t / 16 * 2) * math.sin(tilt) * 0.0, gy + 0.3 * math.cos(math.pi * t / 16 * 2), cz) for t in range(17)]
    for p, q in zip(pts, pts[1:]):
        m.member(p, q, G.prof_box(0.012, 0.02), BRASS)


def rug(m, cx, cz, w, d, field, border, accent, yaw=0.0):
    """A Persian-style rug: a field, three nested borders, a central medallion with a diamond, corner pieces and fringes,
    all as thin raised layers (walk-over)."""
    r = Mesh("rug")
    def rect_(x0, x1, z0, z1, y, s):
        r.poly([(x0, y, z0), (x0, y, z1), (x1, y, z1), (x1, y, z0)], s)
    hw, hd = w / 2, d / 2
    rect_(-hw, hw, -hd, hd, 0.004, border)
    rect_(-hw + 0.1, hw - 0.1, -hd + 0.1, hd - 0.1, 0.005, accent)
    rect_(-hw + 0.16, hw - 0.16, -hd + 0.16, hd - 0.16, 0.006, border.t(G.mul(border.col, 1.25)))
    rect_(-hw + 0.24, hw - 0.24, -hd + 0.24, hd - 0.24, 0.007, field)
    med = [(0.42 * math.cos(2 * math.pi * k / 16) * (w / 3) / 0.42, 0.008, 0.42 * math.sin(2 * math.pi * k / 16) * (d / 3.2) / 0.42) for k in range(16)]
    r.poly([(p[0], p[1], p[2]) for p in reversed(med)], accent)
    dia = [(0.0, 0.009, -d / 5.5), (w / 7, 0.009, 0.0), (0.0, 0.009, d / 5.5), (-w / 7, 0.009, 0.0)]
    r.poly(list(reversed(dia)), border)
    for sx in (-1, 1):
        for sz in (-1, 1):
            c = [(sx * (hw - 0.24), 0.008, sz * (hd - 0.24)), (sx * (hw - 0.24 - w / 8), 0.008, sz * (hd - 0.24)), (sx * (hw - 0.24), 0.008, sz * (hd - 0.24 - d / 8))]
            if G.poly_normal(c)[1] < 0:
                c.reverse()
            r.poly(c, accent)
    # field motifs: rows of small boteh-like lozenges and stars
    zz = -hd + 0.4
    while zz < hd - 0.4:
        xx = -hw + 0.45
        while xx < hw - 0.45:
            if abs(xx) > w / 6 or abs(zz) > d / 5:
                star = [(xx + 0.05 * math.cos(2 * math.pi * k / 8) * (1.0 if k % 2 else 0.45), 0.0075, zz + 0.05 * math.sin(2 * math.pi * k / 8) * (1.0 if k % 2 else 0.45)) for k in range(8)]
                r.poly(list(reversed(star)), accent)
            xx += 0.32
        zz += 0.3
    # border motif: small diamonds along the inner border
    k = -hw + 0.3
    while k < hw - 0.3:
        for zz in (-hd + 0.13, hd - 0.13):
            dd = [(k, 0.0065, zz - 0.03), (k + 0.03, 0.0065, zz), (k, 0.0065, zz + 0.03), (k - 0.03, 0.0065, zz)]
            r.poly(list(reversed(dd)), field)
        k += 0.18
    for zz in (-hd, hd):
        x = -hw + 0.02
        while x < hw:
            r.member((x, 0.003, zz), (x, 0.003, zz + (0.06 if zz > 0 else -0.06)), G.prof_box(0.008, 0.004), PAPER.t(G.hexc("EFE6D2")))
            x += 0.04
    m.extend(G.moved(r, cx, 0.0, cz, yaw))


def tall_plant(m, cx, cz, h=1.7):
    """A fiddle-leaf fig in a glazed pot: a slim trunk, big leathery leaves (two-sided, slightly cupped)."""
    m.lathe([(0.16, 0.0), (0.2, 0.32), (0.21, 0.36), (0.20, 0.38), (0.182, 0.38), (0.178, 0.345)], 14, S("LM_library_paint", G.hexc("2F5D5A")), cx, cz, 0.0)
    m.lathe([(0.178, 0.345), (0, 0.345)], 14, S("LM_library_plaster", G.hexc("493A2C")), cx, cz)
    root, crown = (cx, 0.345, cz), (cx + 0.035, h - 0.04, cz - 0.022)
    m.member(root, crown, G.prof_round(0.018, 6), OAK_DK)
    rg = G.rng(int(cx * 100 + cz))
    for k in range(16):
        t = k / 15
        stem = G.lerp(root, crown, 0.26 + 0.74 * t)
        length = rg.uniform(0.21, 0.28) * (1.0 - 0.25 * t)
        R.fiddle_leaf(m, stem, k * 2.40 + rg.uniform(-0.12, 0.12), length, length * 0.33,
                      -0.09 + 0.19 * t, LEAF if k % 2 else LEAF_DK)


def chandelier(kit, m, cx, cz, y):
    """A brass chandelier: a ceiling rose, chain, a baluster stem, a ring of eight S-scrolled arms with candle cups, drip
    pans and candle bulbs (night glow), a finial below."""
    m.lathe([(0.12, 0.0), (0.1, -0.04), (0.0, -0.05)], 12, BRASS, cx, cz, H - 0.2)
    for k in range(10):
        yy = H - 0.25 - k * 0.09
        m.lathe([(0.018, 0.0), (0.018, 0.07), (0.0, 0.07)], 12, BRASS, cx, cz, yy - 0.07)
    m.lathe([(0.0, 0.0), (0.05, 0.03), (0.09, 0.12), (0.05, 0.22), (0.035, 0.32), (0.07, 0.4), (0.04, 0.48), (0.03, 0.62)], 12, BRASS, cx, cz, y - 0.25)
    for k in range(8):
        a = 2 * math.pi * k / 8
        c, s = math.cos(a), math.sin(a)
        pts = [(cx + 0.06 * c, y + 0.05, cz + 0.06 * s), (cx + 0.3 * c, y - 0.04, cz + 0.3 * s), (cx + 0.48 * c, y + 0.08, cz + 0.48 * s), (cx + 0.52 * c, y + 0.2, cz + 0.52 * s)]
        m.tube(pts, 0.016, 6, BRASS)
        tx, tz = cx + 0.52 * c, cz + 0.52 * s
        m.lathe([(0.06, 0.0), (0.06, 0.012), (0.03, 0.03), (0.03, 0.07), (0.0, 0.07)], 18, BRASS, tx, tz, y + 0.2)
        m.lathe([(0.016, 0.0), (0.016, 0.12), (0.0, 0.12)], 12, PAPER, tx, tz, y + 0.27)
        kit.glow("chandeliers").sphere(tx, y + 0.43, tz, 0.028, P.GLASS.t(P.LAMP), n=6, rings=4, sy=1.5)
        m.sphere(tx, y + 0.43, tz, 0.03, GLASS, n=6, rings=4, sy=1.5)
    kit.lights.append(("point", cx, y + 0.35, cz, (1.0, 0.82, 0.56), 380.0))
    kit.dayfill.append((cx, y + 0.5, cz, 2.5, 160.0))


def ladder(kit, sol):
    """The rolling library ladder (solid ladder): curved oak stringers, flat treads with brass nosings, brass hooks on the
    rail at the top and two brass wheels at the foot."""
    D = kit.D
    r = sol["ladder"]["rect"]
    zc = (r["z0"] + r["z1"]) / 2
    foot_x, top_x, top_y = r["x0"] + 0.08, X - 0.52, 3.12
    for dz in (-0.24, 0.24):
        pts = [G.lerp((foot_x, 0.08, zc + dz), (top_x, top_y, zc + dz), t / 6) for t in range(7)]
        pts = [(p[0] - 0.04 * math.sin(math.pi * t / 6), p[1], p[2]) for t, p in enumerate(pts)]
        for p, q in zip(pts, pts[1:]):
            D.member(p, q, G.prof_box(0.045, 0.09), OAK_RICH)
        D.member((foot_x - 0.02, 0.06, zc + dz - 0.02), (foot_x - 0.02, 0.06, zc + dz + 0.02), G.prof_round(0.055, 10), BRASS, caps=True)
        D.member((top_x, top_y, zc + dz), (top_x + 0.06, top_y + 0.05, zc + dz), G.prof_round(0.012, 6), BRASS)
        D.member((top_x + 0.06, top_y + 0.05, zc + dz), (top_x + 0.06, top_y - 0.02, zc + dz), G.prof_round(0.012, 6), BRASS)
    for k in range(1, 10):
        t = k / 10
        p = G.lerp((foot_x, 0.08, zc), (top_x, top_y, zc), t)
        D.box(p[0] - 0.09, p[0] + 0.07, p[1] - 0.02, p[1], zc - 0.22, zc + 0.22, OAK_LT)
        D.box(p[0] - 0.1, p[0] - 0.085, p[1] - 0.022, p[1] + 0.003, zc - 0.22, zc + 0.22, BRASS)


def painting(m, f, u0, u1, v0, v1, cell, frame=0.12):
    """A real painting (a cell of the public-domain atlas) in a deep carved gilt frame: an outer bead, a broad cove, a
    raised ogee, a sight edge stepping down to the canvas (each a mitred ring of members, 3–9 cm proud of the wall)."""
    x, y, w, h = PAINTING_CELLS[cell]
    a0, a1 = x / 1024, (x + w) / 1024
    b1, b0 = 1 - y / 1024, 1 - (y + h) / 1024
    depth0 = 0.05
    pts = [f.p(u0, v0, depth0), f.p(u1, v0, depth0), f.p(u1, v1, depth0), f.p(u0, v1, depth0)]
    m.poly(pts, PAINT_ATLAS, uv=[(a0, b0), (a1, b0), (a1, b1), (a0, b1)])
    # stepped gilt profile: (inset from the canvas edge outward, depth) rings
    steps = [(0.0, 0.065, GILT), (frame * 0.18, 0.085, BRASS_DK), (frame * 0.45, 0.1, GILT), (frame * 0.75, 0.08, GILT), (frame, 0.06, BRASS_DK)]
    for k in range(len(steps) - 1):
        (e0, d0, s0), (e1, d1, _) = steps[k], steps[k + 1]
        ring0 = [(u0 - e0, v0 - e0), (u1 + e0, v0 - e0), (u1 + e0, v1 + e0), (u0 - e0, v1 + e0)]
        ring1 = [(u0 - e1, v0 - e1), (u1 + e1, v0 - e1), (u1 + e1, v1 + e1), (u0 - e1, v1 + e1)]
        for i in range(4):
            j = (i + 1) % 4
            q = [f.p(*ring1[i], d1), f.p(*ring1[j], d1), f.p(*ring0[j], d0), f.p(*ring0[i], d0)]
            if G.dot(G.poly_normal(q), f.W) < 0:
                q.reverse()
            m.poly(q, s0)
    # the sight edge down to the canvas and the outer side down to the wall
    e = 0.0
    ring = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
    for i in range(4):
        j = (i + 1) % 4
        q = [f.p(*ring[i], depth0), f.p(*ring[j], depth0), f.p(*ring[j], 0.065), f.p(*ring[i], 0.065)]
        m.poly(q, BRASS_DK)
    ringo = [(u0 - frame, v0 - frame), (u1 + frame, v0 - frame), (u1 + frame, v1 + frame), (u0 - frame, v1 + frame)]
    for i in range(4):
        j = (i + 1) % 4
        q = [f.p(*ringo[i], 0.0), f.p(*ringo[j], 0.0), f.p(*ringo[j], 0.06), f.p(*ringo[i], 0.06)]
        m.poly(q, GILT)
    # carved corner rosettes
    for (cu, cv) in ((u0 - frame * 0.45, v0 - frame * 0.45), (u1 + frame * 0.45, v0 - frame * 0.45), (u1 + frame * 0.45, v1 + frame * 0.45), (u0 - frame * 0.45, v1 + frame * 0.45)):
        c = f.p(cu, cv, 0.1)
        m.sphere(c[0], c[1], c[2], frame * 0.22, GILT, n=8, rings=4, sy=0.7)


def flame_card(m, base, ang, hgt, wid, lean, seed):
    """One soft flame card: a spine of points up the middle (alpha high, white-gold at the root) and a rim on each side
    (alpha 0) — so the card has no hard silhouette; it tapers and curls to a tip that fades to deep red. UV: x across
    (-1..1), y up (0..1) for the flicker shader."""
    import random
    rg = random.Random(seed)
    n = 9
    ca, sa = math.cos(ang), math.sin(ang)
    spine, left, right = [], [], []
    for i in range(n + 1):
        t = i / n
        y = hgt * t
        curl = lean * t * t + 0.02 * math.sin(t * 5.0 + seed)
        half = wid * (math.sin(math.pi * min(1.0, t * 1.15 + 0.08)) ** 0.8) * (1.0 - 0.55 * t)
        cx = curl
        spine.append((base[0] + cx * ca, base[1] + y, base[2] + cx * sa))
        left.append((base[0] + (cx - half) * ca, base[1] + y, base[2] + (cx - half) * sa))
        right.append((base[0] + (cx + half) * ca, base[1] + y, base[2] + (cx + half) * sa))

    def col(t, a):
        r = 1.0
        g = max(0.12, 0.92 - 0.85 * t)
        b = max(0.0, 0.55 - 1.4 * t)
        return (r * (1.2 - 0.5 * t), g, b, a)
    for i in range(n):
        t0, t1 = i / n, (i + 1) / n
        a0 = 0.9 * (1 - t0 ** 1.6)
        a1 = 0.9 * (1 - t1 ** 1.6)
        for side, sgn in ((left, -1), (right, 1)):
            q = [spine[i], side[i], side[i + 1], spine[i + 1]]
            cols = [col(t0, a0), col(t0, 0.0), col(t1, 0.0), col(t1, a1)]
            uv = [(0.0, t0), (sgn * 1.0, t0), (sgn * 1.0, t1), (0.0, t1)]
            m.poly(q, FLAME, uv=uv, cols=cols)
            m.poly(list(reversed(q)), FLAME, uv=list(reversed(uv)), cols=list(reversed(cols)))


def soft_fire(kit, cx, by, bz):
    """The fire as soft layered cards (owner review: no cut-out silhouette): 14 cards at varied angles, heights and leans
    over the logs, an ember glow under and along the logs, and a warm glow pool on the hearth and the floor in front.
    Its own node `fire__<unit>_hearth` (material M_fire: the flicker hook for L5v2) and `fire__<unit>_light`."""
    fm = Mesh("fire")
    rg = G.rng(19)
    for k in range(14):
        dx = -0.3 + 0.6 * (k / 13) + rg.uniform(-0.04, 0.04)
        hgt = 0.62 * (1.0 - (abs(dx) / 0.36) ** 2) * rg.uniform(0.7, 1.05) + 0.12
        fx = cx + dx
        flame_card(fm, (fx, by, bz + rg.uniform(-0.06, 0.06)), rg.uniform(0, math.pi), hgt, rg.uniform(0.06, 0.1), rg.uniform(-0.06, 0.06), k * 7 + 3)
    # ember glow along the logs' undersides and in the bed (soft, low)
    for k in range(18):
        ex = cx - 0.34 + 0.68 * k / 17
        ez = bz + rg.uniform(-0.1, 0.1)
        r = rg.uniform(0.04, 0.08)
        ring = [(ex + r * math.cos(2 * math.pi * i / 8), by - 0.02 + rg.uniform(0, 0.03), ez + r * 0.6 * math.sin(2 * math.pi * i / 8)) for i in range(8)]
        c = (ex, by + 0.0, ez)
        for i in range(8):
            j = (i + 1) % 8
            fm.poly([c, ring[j], ring[i]], FLAME, uv=[(0, 0), (1, 0), (1, 0)], cols=[(1.0, 0.42, 0.08, 0.95), (0.9, 0.18, 0.03, 0.0), (0.9, 0.18, 0.03, 0.0)])
            fm.poly([c, ring[i], ring[j]], FLAME, uv=[(0, 0), (1, 0), (1, 0)], cols=[(1.0, 0.42, 0.08, 0.95), (0.9, 0.18, 0.03, 0.0), (0.9, 0.18, 0.03, 0.0)])
    # the warm pool on the hearth and floor: a soft radial glow lying on them
    for (y0, r0, rz, a) in ((0.106, 1.0, 0.75, 0.32), (0.006, 1.9, 1.5, 0.18)):
        gc = (cx, y0, bz - 0.55 - (0.0 if y0 > 0.05 else 0.7))
        n = 20
        ring = [(gc[0] + r0 * math.cos(2 * math.pi * i / n), y0, gc[2] + rz * math.sin(2 * math.pi * i / n)) for i in range(n)]
        for i in range(n):
            j = (i + 1) % n
            q = [gc, ring[j], ring[i]]
            if G.poly_normal(q)[1] < 0:
                q = [gc, ring[i], ring[j]]
            fm.poly(q, FLAME, uv=[(0, 0), (1, 0), (1, 0)], cols=[(1.0, 0.55, 0.22, a), (1.0, 0.45, 0.15, 0.0), (1.0, 0.45, 0.15, 0.0)])
    kit.fire = {"hearth": fm}
    kit.fire_lights = {"light": (cx, by + 0.35, bz - 0.15)}
