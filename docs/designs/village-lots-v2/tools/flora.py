"""Real flowers, leaves, cushions, bells and drums for the walk-in rooms (pure python on b1_geom; interiors realism pass
2026-11-21, owner: "모든 건물의 내부를 ... 사실적이고 디테일하고 입체적이지 않은 것은 모두 수정해").

Before this, the rooms' flowers were clusters of low spheres (church, chapel, library mantel) or flat diamonds (대웅전): from a
metre they read as blobs. Here every bloom is built from its own petals as thin curved two-sided surfaces (smooth normals,
cupped across, curled along, a colour gradient from the base to the tip in COLOR_0), on real stems with folded leaves:

  rose(), lily(), hydrangea(), lotus(), peony(), chrysanthemum(), leaf(), stem()

and the soft goods / small instruments the rooms had as boxes:

  pillow()  a puffy cushion (superellipsoid with a tufted dip and a piped seam), bolster(), bell(), drum()

Every function writes into a b1_geom.Mesh with a surface `s` (material + base tint). The texture is sampled from a tiny UV patch
(`flat_uv`): a petal or wax has no grain to show, so its look comes from the shape, the light and the vertex colours.
`G.LOD` (the phone files) thins the petal counts and the sections.
"""
import math

import b1_geom as G

# ------------------------------------------------------------------------------------------------ helpers --


def lod(n, lo=3):
    return max(lo, int(round(n * min(1.0, G.LOD))))


def flat_uv(n, at=(0.31, 0.27)):
    """A tiny patch of the set (2 mm across): smooth colour, the vertex colours carry the gradient."""
    return [(at[0] + 0.002 * (k % 2), at[1] + 0.002 * ((k // 2) % 2)) for k in range(n)]


def _rgba(c, a=1.0):
    return (c[0], c[1], c[2], a)


def _mixc(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def two_sided(m, pts, s, uv, cols, smooth=True):
    """A face and its back, the back 0.3 mm behind (the exporter welds coincident vertices: a shared vertex would average
    the two faces' normals to nothing)."""
    m.poly(pts, s, uv=uv, smooth=smooth, cols=cols)
    n = G.poly_normal(pts)
    back = [G.sub(p, G.mul(n, 0.0003)) for p in pts]
    m.poly(list(reversed(back)), s, uv=list(reversed(uv)), smooth=smooth, cols=list(reversed(cols)) if cols else None)


def surface(m, P, nu, nv, s, colfn=None, double=True, uv_at=(0.31, 0.27)):
    """A parametric sheet P(u, v) (u, v in 0..1) as nu x nv smooth quads; colfn(u, v) -> linear RGB (default: the tint).
    Collapsed corners (a pointed tip) become triangles. `double`: both faces (a petal is seen from both sides)."""
    grid = [[P(i / nu, j / nv) for j in range(nv + 1)] for i in range(nu + 1)]
    for i in range(nu):
        for j in range(nv):
            idx = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
            pts, cols = [], []
            for (a, b) in idx:
                p = grid[a][b]
                if pts and math.dist(p, pts[-1]) < 1e-7:
                    continue
                pts.append(p)
                cols.append(_rgba(colfn(a / nu, b / nv) if colfn else s.col))
            if len(pts) > 3 and math.dist(pts[0], pts[-1]) < 1e-7:
                pts.pop()
                cols.pop()
            if len(pts) < 3:
                continue
            uv = flat_uv(len(pts), uv_at)
            if double:
                two_sided(m, pts, s, uv, cols)
            else:
                m.poly(pts, s, uv=uv, smooth=True, cols=cols)


def basis(d):
    """An orthonormal (d, side, up) frame for a direction d."""
    d = G.norm(d)
    up = (0, 1, 0) if abs(d[1]) < 0.95 else (1, 0, 0)
    side = G.norm(G.cross(d, up))
    up2 = G.cross(side, d)
    return d, side, up2


def petal(m, base, out, length, width, s, rise=0.0, fall=0.6, cup=0.35, roll=0.0, tip=0.85, shape="rose",
          c0=None, c1=None, nu=4, nv=4, twist=0.0, ruffle=0.0, seed=0):
    """One petal from `base`, its blade leaving in the horizontal direction `out` (unit, y ignored) at `rise` radians above
    the horizon and bending down by `fall` radians to its tip (negative: curving up / inward). `cup` (0..1): the edges lift
    toward the flower's centre; `roll`: the tip's edges roll back (rose, peony). `shape`: rose (broad, rounded tip),
    lance (lily, lotus: pointed), strap (chrysanthemum ray). Colours: c0 at the base, c1 at the tip."""
    o = G.norm((out[0], 0.0, out[2]))
    side = (-o[2], 0.0, o[0])
    rg = G.rng(seed)
    nv = lod(nv, 2)
    nu = lod(nu, 2)
    # the centreline in the (o, y) plane: angle from the horizon goes rise -> rise - fall
    steps = 10
    line = [base]
    ang = []
    p = base
    for k in range(steps):
        t = (k + 0.5) / steps
        a = rise - fall * (t ** 1.4)
        ang.append(a)
        p = G.add(p, G.add(G.mul(o, math.cos(a) * length / steps), (0.0, math.sin(a) * length / steps, 0.0)))
        line.append(p)

    def width_at(v):
        if shape == "lance":
            return width * (math.sin(math.pi * min(1.0, 0.08 + v)) ** 0.9) * (1.0 - 0.35 * v)
        if shape == "lotus":
            return width * (math.sin(math.pi * min(1.0, 0.04 + 0.96 * v)) ** 0.55) * (1.0 - 0.15 * v)
        if shape == "strap":
            return width * (0.55 + 0.45 * math.sin(math.pi * min(1.0, 0.25 + 0.8 * v))) * (1.0 if v < 0.9 else (1.0 - v) * 10 * 0.7 + 0.3)
        # rose / peony: narrow claw, broad rounded blade
        return width * (0.25 + 0.75 * math.sin(math.pi * min(1.0, 0.1 + 0.62 * v)) ** 0.8) * (1.0 if v < tip else max(0.05, 1.0 - (v - tip) / (1.0 - tip)) ** 0.5)

    def P(u, v):
        k = v * steps
        i = min(steps - 1, int(k))
        f = k - i
        c = G.add(G.mul(line[i], 1 - f), G.mul(line[i + 1], f))
        a = ang[min(steps - 1, i)]
        nrm = (-math.sin(a) * o[0], math.cos(a), -math.sin(a) * o[2])   # the blade's upper face normal
        x = (u - 0.5) * 2.0
        w = width_at(v)
        tw = twist * v
        sd = G.add(G.mul(side, math.cos(tw)), G.mul(nrm, math.sin(tw)))
        q = G.add(c, G.mul(sd, x * w * 0.5))
        lift = cup * w * 0.5 * (x * x) * (1.0 - 0.4 * v)
        lift -= roll * w * 0.5 * (x * x) * max(0.0, (v - 0.55) / 0.45) ** 1.5
        if ruffle:
            lift += ruffle * w * 0.5 * math.sin(7.0 * x + seed) * v * v
        return G.add(q, G.mul(nrm, lift))

    c0 = c0 or s.col
    c1 = c1 or s.col
    surface(m, P, nu, nv, s, colfn=lambda u, v: _mixc(c0, c1, min(1.0, v * 1.15)))


def stem(m, a, b, r, s, bend=(0.0, 0.0, 0.0), n=5):
    """A stem from a to b, bowed by `bend` at its middle."""
    mid = G.add(G.mul(G.add(a, b), 0.5), bend)
    path = []
    for k in range(5):
        t = k / 4
        p = G.add(G.add(G.mul(a, (1 - t) ** 2), G.mul(mid, 2 * t * (1 - t))), G.mul(b, t * t))
        path.append(p)
    m.tube(path, r, lod(n, 3), s)


def leaf(m, base, out, length, width, s, rise=0.5, fall=0.9, fold=0.25, c0=None, c1=None, seed=0):
    """A leaf blade (elliptic, pointed) with a folded midrib, arching out from `base`; two-sided."""
    petal(m, base, out, length, width, s, rise=rise, fall=fall, cup=fold, shape="lance", c0=c0, c1=c1, nu=2, nv=5, seed=seed)


# ------------------------------------------------------------------------------------------------ blooms --


def rose(m, c, r, s, col, open_=0.6, seed=0, centre_dk=0.75):
    """A rose of radius r at c (the bloom's base): a tight spiral bud in the middle, petals opening outward ring by ring."""
    rg = G.rng(seed)
    n = lod(13, 7)
    golden = math.radians(137.5)
    dk = _mixc((0.0, 0.0, 0.0), col, centre_dk)
    for i in range(n):
        k = i / (n - 1)
        a = i * golden + rg.uniform(-0.15, 0.15)
        o = (math.cos(a), 0.0, math.sin(a))
        base = G.add(c, (o[0] * r * 0.12 * k, r * 0.08 * (1 - k), o[2] * r * 0.12 * k))
        L = r * (0.55 + 0.5 * k)
        rise = math.radians(84 - (62 * open_) * k ** 1.2)
        petal(m, base, o, L, L * (0.95 + 0.35 * k), s, rise=rise, fall=(-0.35 + 1.1 * k) * open_, cup=0.75 - 0.35 * k,
              roll=0.25 * k, c0=dk, c1=col, nu=4, nv=4, seed=seed + i)


def peony(m, c, r, s, col, seed=0):
    """A full peony: many ruffled, cupped petals in loose rings round a darker middle."""
    rg = G.rng(seed)
    n = lod(18, 9)
    golden = math.radians(137.5)
    dk = _mixc((0.9, 0.85, 0.5), col, 0.55)
    for i in range(n):
        k = i / (n - 1)
        a = i * golden + rg.uniform(-0.2, 0.2)
        o = (math.cos(a), 0.0, math.sin(a))
        L = r * (0.5 + 0.55 * k)
        petal(m, G.add(c, (o[0] * r * 0.1 * k, 0.0, o[2] * r * 0.1 * k)), o, L, L * 1.2, s,
              rise=math.radians(86 - 50 * k), fall=-0.2 + 0.7 * k, cup=0.9 - 0.3 * k, ruffle=0.2, c0=dk, c1=col, nu=4, nv=3, seed=seed + i)


def lily(m, c, r, s, col, throat=None, out=(0.0, 1.0, 0.0), seed=0, stamen_s=None):
    """An open lily (Easter / casablanca): six long pointed tepals flaring and curling back, six stamens and a style."""
    throat = throat or _mixc((0.75, 0.85, 0.45), col, 0.55)
    rg = G.rng(seed)
    for i in range(6):
        a = 2 * math.pi * i / 6 + (0.5 if i % 2 else 0.0) * 0.0 + rg.uniform(-0.1, 0.1)
        o = (math.cos(a), 0.0, math.sin(a))
        petal(m, c, o, r, r * (0.42 if i % 2 else 0.36), s, rise=math.radians(62), fall=1.7, cup=0.45, shape="lance",
              c0=throat, c1=col, nu=3, nv=lod(6, 4), seed=seed + i)
    ss = stamen_s or s
    for i in range(6):
        a = 2 * math.pi * (i + 0.5) / 6
        tip = G.add(c, (math.cos(a) * r * 0.35, r * 0.62, math.sin(a) * r * 0.35))
        stem(m, c, tip, 0.0018, ss.t(_mixc(col, (0.7, 0.8, 0.5), 0.5)), n=3)
        m.cbox(tip[0] - 0.006, tip[0] + 0.006, tip[1], tip[1] + 0.004, tip[2] - 0.002, tip[2] + 0.002, ss.t(G.hexc("B5652A")), c=0.0015)
    stem(m, c, G.add(c, (0.0, r * 0.7, 0.0)), 0.0025, ss.t(G.hexc("C9D79A")), n=3)


def lily_bud(m, c, d, length, s, col):
    """A closed lily bud: a long six-ribbed spindle pointing along d."""
    d, side, up = basis(d)
    prof = [(0.0, 0.0), (0.008, 0.15), (0.016, 0.55), (0.012, 0.85), (0.0, 1.0)]
    nseg = 6
    for k in range(len(prof) - 1):
        for i in range(nseg):
            pts = []
            for (kk, ii) in ((k, i), (k, i + 1), (k + 1, i + 1), (k + 1, i)):
                rr = prof[kk][0] * length / 0.11 * (1.0 + 0.12 * (ii % 2))
                a = 2 * math.pi * ii / nseg
                pts.append(G.add(G.add(c, G.mul(d, prof[kk][1] * length)), G.add(G.mul(side, rr * math.cos(a)), G.mul(up, rr * math.sin(a)))))
            if math.dist(pts[0], pts[1]) < 1e-7:
                pts = pts[1:]
            elif math.dist(pts[2], pts[3]) < 1e-7:
                pts = pts[:3]
            cols = [_rgba(_mixc((0.65, 0.8, 0.5), col, 0.6))] * len(pts)
            m.poly(list(reversed(pts)), s, uv=flat_uv(len(pts)), smooth=True, cols=cols)


def hydrangea(m, c, r, s, col, seed=0, col2=None):
    """A hydrangea head: a dome of four-petalled florets on short pedicels, each petal a small cupped two-sided blade."""
    rg = G.rng(seed)
    col2 = col2 or _mixc(col, (0.8, 0.9, 0.75), 0.25)
    n = lod(90, 30)
    for i in range(n):
        # florets spread over the upper dome (fibonacci sphere, upper 70%)
        y = 1.0 - 0.75 * (i + 0.5) / n
        rr = math.sqrt(max(0.0, 1 - y * y))
        a = i * math.radians(137.5)
        d = (rr * math.cos(a), y, rr * math.sin(a))
        p = G.add(c, G.mul(d, r * rg.uniform(0.88, 1.0)))
        cc = _mixc(col, col2, rg.uniform(0.0, 1.0))
        fd, sd, ud = basis(d)
        rot = rg.uniform(0, math.pi / 2)
        for k in range(4):
            aa = rot + k * math.pi / 2
            o = G.add(G.mul(sd, math.cos(aa)), G.mul(ud, math.sin(aa)))
            # a petal lying on the dome: a lance blade tilted out from the floret centre
            L = r * (0.23 if G.LOD >= 1 else 0.33)
            base = p
            tipp = G.add(G.add(p, G.mul(o, L)), G.mul(d, L * 0.15))
            w = L * 0.85
            sideo = G.norm(G.cross(d, o))
            mid = G.add(G.mul(G.add(base, tipp), 0.5), G.mul(d, L * 0.12))
            t1 = G.add(G.mul(G.add(mid, tipp), 0.5), G.mul(d, -L * 0.04))
            pts = [base, G.add(mid, G.mul(sideo, w * 0.5)), G.add(t1, G.mul(sideo, w * 0.3)), tipp, G.add(t1, G.mul(sideo, -w * 0.3)), G.add(mid, G.mul(sideo, -w * 0.5))]
            cols = [_rgba(_mixc(cc, (0.85, 0.9, 0.7), 0.35))] + [_rgba(cc)] * 5
            if G.dot(G.poly_normal(pts), d) < 0:
                pts.reverse()
                cols.reverse()
            two_sided(m, pts, s, flat_uv(6), cols, smooth=False)


def chrysanthemum(m, c, r, s, col, seed=0, centre=None):
    """A white 국화 (spray mum): rings of narrow strap rays curving out and down round a domed green-yellow middle."""
    rg = G.rng(seed)
    centre = centre or G.hexc("D8C85A")
    rings = [(lod(14, 8), 0.55, 1.0), (lod(11, 6), 0.75, 0.6), (lod(8, 5), 0.88, 0.25)]
    for j, (n, rise_deg_k, Lk) in enumerate(rings):
        for i in range(n):
            a = 2 * math.pi * (i + 0.5 * j) / n + rg.uniform(-0.08, 0.08)
            o = (math.cos(a), 0.0, math.sin(a))
            petal(m, c, o, r * Lk, r * 0.28, s, rise=math.radians(15 + 70 * (1 - rise_deg_k) * 0 + 60 * j / 2), fall=0.55 - 0.2 * j,
                  cup=0.5, shape="strap", c0=_mixc(col, (0.85, 0.9, 0.7), 0.3), c1=col, nu=2, nv=3, seed=seed + 31 * j + i)
    m.sphere(c[0], c[1] + r * 0.05, c[2], r * 0.2, s.t(centre), n=lod(8, 5), rings=3, sy=0.6)


def lotus(m, c, r, s, col_tip, col_base=(1.0, 0.97, 0.94), seed=0, open_=0.7):
    """A lotus: three rings of broad pointed cupped petals (white at the base, the tint at the tip), a flat-topped
    seed pod in the middle with a ring of yellow stamens."""
    rg = G.rng(seed)
    for j, (n, rise, L, ph) in enumerate(((8, 38, 1.0, 0.0), (8, 58, 0.9, 0.5), (6, 76, 0.75, 0.25))):
        for i in range(lod(n, 5)):
            a = 2 * math.pi * (i + ph) / lod(n, 5) + rg.uniform(-0.08, 0.08)
            o = (math.cos(a), 0.0, math.sin(a))
            petal(m, c, o, r * L, r * L * 0.75, s, rise=math.radians(rise + (1 - open_) * 30), fall=-0.3, cup=1.1, shape="lotus",
                  c0=col_base, c1=col_tip, nu=3, nv=4, seed=seed + 17 * j + i)
    m.lathe([(r * 0.08, 0.0), (r * 0.17, r * 0.22), (r * 0.18, r * 0.27), (0.0, r * 0.28)], lod(10, 6), s.t(G.hexc("C8D06A")), c[0], c[2], c[1] + r * 0.05)
    for i in range(lod(14, 7)):
        a = 2 * math.pi * i / lod(14, 7)
        p0 = G.add(c, (math.cos(a) * r * 0.16, r * 0.12, math.sin(a) * r * 0.16))
        p1 = G.add(c, (math.cos(a) * r * 0.24, r * 0.3, math.sin(a) * r * 0.24))
        stem(m, p0, p1, 0.002, s.t(G.hexc("F2C94A")), n=3)


def lotus_bud(m, c, r, s, col_tip, col_base=(1.0, 0.97, 0.94), seed=0):
    """A closed lotus bud: five petals wrapped into a pointed egg."""
    for i in range(5):
        a = 2 * math.pi * i / 5
        o = (math.cos(a), 0.0, math.sin(a))
        petal(m, G.add(c, (-o[0] * r * 0.1, 0.0, -o[2] * r * 0.1)), o, r * 1.4, r * 1.1, s, rise=math.radians(80), fall=-0.55, cup=1.0,
              shape="lotus", c0=col_base, c1=col_tip, nu=3, nv=4, seed=seed + i)


def babys_breath(m, c, r, s, seed=0, n=40):
    """A cloud of tiny white 안개꽃 florets on thin wiry branches."""
    rg = G.rng(seed)
    for i in range(lod(n, 12)):
        d = G.norm((rg.uniform(-1, 1), rg.uniform(0.2, 1.0), rg.uniform(-1, 1)))
        p = G.add(c, G.mul(d, r * rg.uniform(0.4, 1.0)))
        stem(m, G.add(c, G.mul(d, r * 0.15)), p, 0.0012, s.t(G.hexc("8FA57A")), n=3)
        m.sphere(p[0], p[1], p[2], rg.uniform(0.004, 0.006), s.t((0.98, 0.98, 0.96)), n=5, rings=3)


# ------------------------------------------------------------------------------------------------ soft goods --


def superellipsoid(m, c, rx, ry, rz, s, e_v=0.5, e_h=0.25, n=20, rings=10, yaw=0.0, dip=0.0, flat_bottom=True, colfn=None, uvscale=1.0):
    """A superellipsoid (a rounded box: e -> 0 square, 1 round) at c with half sizes rx, ry, rz. `dip`: a tufted dimple in
    the top's middle (fraction of ry). The bottom flattens onto the floor (a cushion sits)."""
    n = lod(n, 10)
    rings = lod(rings, 6)
    cy, sy_ = math.cos(yaw), math.sin(yaw)

    def sp(a, e):
        ca = math.cos(a)
        return math.copysign(abs(ca) ** e, ca)

    def pt(i, j):
        lat = -math.pi / 2 + math.pi * j / rings
        lon = 2 * math.pi * i / n
        cl = sp(lat, e_v)
        sl = math.copysign(abs(math.sin(lat)) ** e_v, math.sin(lat))
        x = rx * cl * sp(lon, e_h)
        z = rz * cl * math.copysign(abs(math.sin(lon)) ** e_h, math.sin(lon))
        y = ry * sl
        if dip and sl > 0:
            rr = math.hypot(x / rx, z / rz)
            y -= dip * ry * math.exp(-(rr / 0.28) ** 2) * sl
        if flat_bottom and y < -ry * 0.82:
            y = -ry * 0.82
        return (c[0] + x * cy + z * sy_, c[1] + y + ry * 0.82, c[2] - x * sy_ + z * cy)

    grid = [[pt(i, j) for j in range(rings + 1)] for i in range(n + 1)]
    for i in range(n):
        for j in range(rings):
            q = [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]]
            pts = []
            for p in q:
                if not pts or math.dist(p, pts[-1]) > 1e-7:
                    pts.append(p)
            if len(pts) > 3 and math.dist(pts[0], pts[-1]) < 1e-7:
                pts.pop()
            if len(pts) < 3:
                continue
            uv = [((i / n) * 2 * (rx + rz) * uvscale, (j / rings) * 2 * ry * uvscale + (k * 0.0)) for k, _ in enumerate(pts)]
            uv = [(((i + (1 if k in (1, 2) else 0)) / n) * 2 * (rx + rz) * uvscale, ((j + (1 if k in (2, 3) else 0)) / rings) * 2 * ry * uvscale) for k in range(len(pts))]
            cols = None
            if colfn:
                cols = [_rgba(colfn(p)) for p in pts]
            cen = (c[0], c[1] + ry * 0.82 - (ry * 0.4 if j < rings / 2 else 0.0), c[2])
            mid = tuple(sum(p[k] for p in pts) / len(pts) for k in range(3))
            if G.dot(G.poly_normal(pts), G.sub(mid, cen)) < 0:
                pts, uv = list(reversed(pts)), list(reversed(uv))
                cols = list(reversed(cols)) if cols else None
            m.poly(pts, s, uv=uv, smooth=True, cols=cols)
    return pt


def pillow(m, cx, y0, cz, w, d, h, s, yaw=0.0, piping=None, tuft=None, dip=0.22, e_h=0.22, e_v=0.55):
    """A square floor cushion / seat pad (w x d, h thick) at (cx, y0, cz): puffed top, rounded sides, a piped seam all
    round at its waist, and a covered button sunk in the tufted middle."""
    c = (cx, y0, cz)
    superellipsoid(m, c, w / 2, h / 2, d / 2, s, e_v=e_v, e_h=e_h, n=24, rings=10, yaw=yaw, dip=dip)
    cy, sy_ = math.cos(yaw), math.sin(yaw)
    if piping is not None:
        ring = []
        k = lod(28, 14)
        for i in range(k + 1):
            lon = 2 * math.pi * i / k
            ca, sa = math.cos(lon), math.sin(lon)
            x = w / 2 * 1.005 * math.copysign(abs(ca) ** e_h, ca)
            z = d / 2 * 1.005 * math.copysign(abs(sa) ** e_h, sa)
            ring.append((cx + x * cy + z * sy_, y0 + h / 2 * 0.82, cz - x * sy_ + z * cy))
        m.tube(ring, max(0.004, h * 0.06), lod(6, 4), piping)
    if tuft is not None:
        ytop = y0 + h / 2 * 0.82 + h / 2 * (1 - dip)
        m.sphere(cx, ytop + 0.002, cz, max(0.012, w * 0.035), tuft, n=lod(8, 5), rings=4, sy=0.55)


def bolster(m, a, b, r, s, piping=None):
    """A round bolster from a to b: a padded cylinder with rounded, gathered ends and piped rims."""
    d, side, up = basis(G.sub(b, a))
    L = math.dist(a, b)
    n = lod(16, 8)
    prof = [(0.0, 0.0), (r * 0.55, r * 0.05), (r * 0.9, r * 0.18), (r, r * 0.4)]
    prof = prof + [(r * 1.02, L / 2)] + [(rr, L - yy) for (rr, yy) in reversed(prof)]
    rings = []
    for rr, yy in prof:
        cc = G.add(a, G.mul(d, yy))
        rings.append([G.add(cc, G.add(G.mul(side, rr * math.cos(2 * math.pi * i / n)), G.mul(up, rr * math.sin(2 * math.pi * i / n)))) for i in range(n)])
    vacc = 0.0
    for k in range(len(rings) - 1):
        A, B = rings[k], rings[k + 1]
        dv = math.hypot(prof[k + 1][0] - prof[k][0], prof[k + 1][1] - prof[k][1])
        for i in range(n):
            j = (i + 1) % n
            q = [A[i], A[j], B[j], B[i]]
            pts = []
            for p in q:
                if not pts or math.dist(p, pts[-1]) > 1e-7:
                    pts.append(p)
            if len(pts) > 3 and math.dist(pts[0], pts[-1]) < 1e-7:
                pts.pop()
            if len(pts) < 3:
                continue
            uv = [(2 * math.pi * r * i / n, vacc), (2 * math.pi * r * (i + 1) / n, vacc), (2 * math.pi * r * (i + 1) / n, vacc + dv), (2 * math.pi * r * i / n, vacc + dv)][:len(pts)]
            mid = tuple(sum(p[k] for p in pts) / len(pts) for k in range(3))
            axis_pt = G.add(a, G.mul(d, G.dot(G.sub(mid, a), d)))
            if G.dot(G.poly_normal(pts), G.sub(mid, axis_pt)) < 0:
                pts, uv = list(reversed(pts)), list(reversed(uv))
            m.poly(pts, s, uv=uv, smooth=True)
        vacc += dv
    if piping is not None:
        for yy in (r * 0.4, L - r * 0.4):
            cc = G.add(a, G.mul(d, yy))
            ring = [G.add(cc, G.add(G.mul(side, r * 1.0 * math.cos(2 * math.pi * i / n)), G.mul(up, r * 1.0 * math.sin(2 * math.pi * i / n)))) for i in range(n + 1)]
            m.tube(ring, r * 0.05, 4, piping)


# ------------------------------------------------------------------------------------------------ instruments --


def bell_profile(h, r):
    """A Korean temple bell's section (범종 type), bottom (the lip) to top (the crown): a gently waisted body that swells
    to a thick lip, a raised 하대 band near the bottom and a 상대 band under the shoulder."""
    return [(r * 0.86, 0.0), (r * 0.96, h * 0.01), (r * 1.0, h * 0.05), (r * 1.0, h * 0.12), (r * 0.965, h * 0.135),
            (r * 0.93, h * 0.2), (r * 0.9, h * 0.4), (r * 0.88, h * 0.6), (r * 0.88, h * 0.74), (r * 0.91, h * 0.76),
            (r * 0.91, h * 0.86), (r * 0.86, h * 0.88), (r * 0.78, h * 0.95), (r * 0.6, h * 0.99), (0.0, h * 1.0)]


def bell(m, cx, y0, cz, h, r, s, boss_s=None, n=28):
    """A bronze temple bell hanging with its lip at y0: lathed body with bands, the inside (a darker hollow), four 유곽
    panels of nine bosses round the shoulder, a lotus 당좌 striking boss, and the hook loop (용뉴) on the crown."""
    n = lod(n, 14)
    prof = bell_profile(h, r)
    m.lathe(prof, n, s, cx, cz, y0)
    # the inside: a slightly smaller hollow, seen from below
    inner = [(rr * 0.9, yy * 0.9) for (rr, yy) in prof if yy < h * 0.95]
    inner = [(rr, yy) for (rr, yy) in inner]
    ins = G.Mesh("bell_in")
    ins.lathe(inner, n, s.t(_mixc(s.col, (0, 0, 0), 0.55)), cx, cz, y0)
    for p in ins.polys:
        p.pts.reverse()
        p.uv.reverse()
        p.col.reverse()
    m.extend(ins)
    bs = boss_s or s
    # 유곽: four panels with 3 x 3 bosses round the shoulder
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        for i in range(3):
            for j in range(3):
                aa = a + (i - 1) * 0.15
                yy = y0 + h * (0.62 + 0.065 * j)
                rr = r * 0.885
                px, pz = cx + rr * math.cos(aa), cz - rr * math.sin(aa)
                m.sphere(px, yy, pz, r * 0.035, bs, n=lod(6, 4), rings=3)
    # 당좌: two lotus bosses at the striking height (front and back)
    for a in (math.pi / 2, -math.pi / 2):
        px, pz = cx + r * 0.905 * math.cos(a), cz - r * 0.905 * math.sin(a)
        o = (math.cos(a), 0.0, -math.sin(a))
        fd, sd, ud = basis(o)
        for i in range(8):
            aa = 2 * math.pi * i / 8
            q0 = (px, y0 + h * 0.32, pz)
            dd = G.add(G.mul(sd, math.cos(aa)), G.mul(ud, math.sin(aa)))
            tipp = G.add(q0, G.mul(dd, r * 0.16))
            sideo = G.cross(o, dd)
            mid = G.add(G.mul(G.add(q0, tipp), 0.5), G.mul(o, r * 0.02))
            pts = [G.add(q0, G.mul(o, r * 0.01)), G.add(mid, G.mul(sideo, r * 0.045)), tipp, G.add(mid, G.mul(sideo, -r * 0.045))]
            if G.dot(G.poly_normal(pts), o) < 0:
                pts.reverse()
            m.poly(pts, bs, uv=flat_uv(4), smooth=False)
        m.sphere(px + o[0] * r * 0.02, y0 + h * 0.32, pz + o[2] * r * 0.02, r * 0.05, bs, n=lod(8, 5), rings=4)
    # the crown's hook: a loop
    loop = [(cx + 0.0, y0 + h * 1.0, cz)]
    for i in range(9):
        a = math.pi * i / 8
        loop.append((cx + r * 0.22 * math.cos(a), y0 + h * (1.02 + 0.22 * math.sin(a)), cz))
    loop.append((cx - 0.0, y0 + h * 1.0, cz))
    m.tube(loop, r * 0.05, lod(6, 4), s)


def drum(m, cx, cy, cz, r, L, wood_s, hide_s, stud_s, axis="x", n=28):
    """A 법고 drum lying with its heads facing ±axis: a barrel of staves bulging at the middle, painted; the cowhide heads
    stretched over the rims with a row of brass studs nailing them round each edge."""
    n = lod(n, 14)
    if axis == "x":
        d = (1.0, 0.0, 0.0)
    else:
        d = (0.0, 0.0, 1.0)
    fd, sd, ud = basis(d)
    prof = [(r * 0.97, -L / 2), (r * 1.0, -L / 2 + 0.02), (r * 1.09, -L * 0.2), (r * 1.12, 0.0), (r * 1.09, L * 0.2), (r * 1.0, L / 2 - 0.02), (r * 0.97, L / 2)]
    c = (cx, cy, cz)
    rings = []
    for rr, t in prof:
        cc = G.add(c, G.mul(fd, t))
        rings.append([G.add(cc, G.add(G.mul(sd, rr * math.cos(2 * math.pi * i / n)), G.mul(ud, rr * math.sin(2 * math.pi * i / n)))) for i in range(n)])
    v = 0.0
    for k in range(len(rings) - 1):
        dv = math.dist(rings[k][0], rings[k + 1][0])
        for i in range(n):
            j = (i + 1) % n
            q = [rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]]
            if G.dot(G.poly_normal(q), G.sub(q[0], G.add(c, G.mul(fd, G.dot(G.sub(q[0], c), fd))))) < 0:
                q.reverse()
            u0 = 2 * math.pi * r * i / n
            u1 = 2 * math.pi * r * (i + 1) / n
            m.poly(q, wood_s, uv=[(u0, v), (u1, v), (u1, v + dv), (u0, v + dv)], smooth=True)
        v += dv
    # heads: a slightly domed disc each end
    for sgn in (-1, 1):
        cc = G.add(c, G.mul(fd, sgn * L / 2))
        apex = G.add(cc, G.mul(fd, sgn * r * 0.03))
        ring = rings[0] if sgn < 0 else rings[-1]
        for i in range(n):
            j = (i + 1) % n
            tri = [apex, ring[i], ring[j]]
            if G.dot(G.poly_normal(tri), G.mul(fd, sgn)) < 0:
                tri.reverse()
            st = [(0.5, 0.5)] + [(0.5 + 0.5 * math.cos(2 * math.pi * ii / n), 0.5 + 0.5 * math.sin(2 * math.pi * ii / n)) for ii in (i, j)]
            m.poly(tri, hide_s, uv=[(a * r * 2, b * r * 2) for a, b in st], smooth=True)
        # studs round the rim, set just behind the head's edge on the barrel
        ns = lod(24, 12)
        for i in range(ns):
            a = 2 * math.pi * (i + 0.5) / ns
            p = G.add(G.add(c, G.mul(fd, sgn * (L / 2 - 0.035))), G.add(G.mul(sd, r * 1.005 * math.cos(a)), G.mul(ud, r * 1.005 * math.sin(a))))
            m.sphere(p[0], p[1], p[2], r * 0.028, stud_s, n=5, rings=3, sy=1.0)


# ------------------------------------------------------------------------------------------------ cloth, wax --


def flat_from(m, start, at=(0.31, 0.27)):
    """Give the polygons added since `start` a flat UV patch (wax, porcelain, linen: no grain to show)."""
    for p in m.polys[start:]:
        p.uv = flat_uv(len(p.pts), at)


def drape(m, x0, x1, y0, y1, z, s, folds=7, depth=0.014, face=-1, hem=None, seed=0):
    """A hanging cloth (an altar frontal / a table cloth's fall) from y1 down to y0 across x0..x1 in the plane z, facing
    `face` (-1: -z). Soft vertical folds that deepen toward the hem, a slightly flared hem line; flat UVs."""
    rg = G.rng(seed)
    ph = [rg.uniform(0, 6.28) for _ in range(3)]
    nu = lod(folds * 4, 12)
    nv = 4

    def P(u, v):
        x = x0 + (x1 - x0) * u
        y = y1 - (y1 - y0) * v
        dz = depth * (0.35 + 0.65 * v) * (0.5 + 0.5 * math.sin(2 * math.pi * folds * u + ph[0]))
        dz += depth * 0.3 * v * math.sin(2 * math.pi * (folds * 0.5) * u + ph[1])
        y -= 0.006 * v * math.sin(2 * math.pi * folds * u + ph[2])
        return (x, y, z + face * dz)

    start = len(m.polys)
    grid = [[P(i / nu, j / nv) for j in range(nv + 1)] for i in range(nu + 1)]
    for i in range(nu):
        for j in range(nv):
            q = [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]]
            if G.poly_normal(q)[2] * face < 0:
                q.reverse()
            m.poly(q, s, smooth=True)
    flat_from(m, start)
    if hem is not None:
        path = [G.add(grid[i][nv], (0.0, 0.004, face * 0.002)) for i in range(nu + 1)]
        m.tube(path, 0.004, 4, hem)


def candle(m, x, y, z, r, h, s, drip=True):
    """A clean church candle: a smooth wax cylinder with a softly rounded, slightly hollowed top and a black wick."""
    start = len(m.polys)
    m.lathe([(r, 0.0), (r, h - 0.006), (r * 0.96, h - 0.0015), (r * 0.8, h - 0.001), (r * 0.5, h - 0.004), (0.0, h - 0.005)], lod(16, 10), s, x, z, y)
    flat_from(m, start)
    m.member((x, y + h - 0.006, z), (x, y + h + 0.01, z), G.prof_round(0.0012, 4), s.t((0.03, 0.03, 0.03)))
