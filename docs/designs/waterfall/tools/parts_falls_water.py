"""B1 waterfall W2: the water meshes (design 5.2, names 7.4). Built ONLY from falls_shape (W0, locked), never a copy.

Pure-Python mesh generators (no bpy needed: `python parts_falls_water.py --stats`) + a Blender builder/exporter:

  blender -b --factory-startup -P parts_falls_water.py -- [--tier high|low] [--out DIR] [--glb]

Objects (game coordinates in the generators; Blender = (x, -z, y) in the builder), all with UV `UVMap` and COLOR_0 (RGBA
float, linear data, one per vertex). Colour channel meaning per object (what the W4 shaders read):

  W_falls_plunge_0   M_falls_water    main sheet = a closed LENS (front skin + back skin, ~0.2..0.55 m thick, 7 columns)
  W_falls_plunge_1   M_falls_water    back film, a thinner, wider, ragged sheet 0.1..0.35 m behind the core (aeration veil)
  W_falls_plunge_2   M_falls_water    the 2 SIDE_STRANDS (rills down the rock for 1.6 m, then free fall), one mesh
        COLOR_0  R air (0 = solid clear water .. 1 = aerated white; grows downward and toward the rim)
                 G speed 0..1 (= speed / speed at the pool; the shader scrolls the streak texture by this)
                 B edge breakup 0 (core) .. 1 (rim), A base opacity
        UV       u 0..1 across, v = metres flowed along the centreline / 4 (so one T_falls_flow tile = 4 m)
  W_falls_cascade    M_falls_cascade  the upper cascade film hugging the groove (CASCADE_OFFSET m off the rock)
        COLOR_0  R,G flow vector in the (u, v) frame: 0.5 + 0.5 * (component along +u (= +z, south), along +v (= down the
                 slope)); its length (<= 1) is the speed (shelves are slow, walls fast); B ledge brink (the water leaves a
                 tread: white, splashing), A opacity (ragged edge fade, fades in over the top metre)
        UV       u 0..1 across (z), v = metres down the centre column / 4
  W_falls_pool       M_water          the pool surface at waterY (q 0..1.01 of the waterline ellipse)
        COLOR_0  R depth 0..1 (= depth / 2.2 m, from falls_shape.pool_bed_y), G ripple weight (1 at the impact point ..
                 0 at 7 m), B shoreline factor (0 inside .. 1 at the waterline), A opacity (0.12 = clear, pebbles visible, at the rim .. 0.95 once ~0.65 m deep).
                 Suggested colours: shallow (0.10, 0.20, 0.12) -> deep dark olive-teal (0.010, 0.055, 0.040), mix by R^0.5
        UV       world-anchored: u = (x - impact x) / 4, v = (z - impact z) / 4 (metres / 4, like the others)
  W_falls_foam       M_falls_foam     lumpy foam heap + ragged apron ring at the impact + 3 foam lines dragged toward the outlet
        COLOR_0  R foam density, G radial phase 0 (centre) .. 1 (outer rim; the shader flows the foam texture outward),
                 B lump height 0..1, A opacity
        UV       heap/apron: planar (x - impact x) / 6 + 0.5, (z - impact z) / 6 + 0.5; lines: u 0..1 across, v metres / 4
  W_falls_outlet     M_water          the outlet stream inside the site (to the south edge)
        COLOR_0  R depth 0.15..0.3, G speed 0.25..0.6, B bank factor 0 (middle) .. 1 (banks), A opacity; UV u across, v metres / 4
  marker__falls_impact, marker__falls_lip   empties (impact point = spray/ripples/sound centre, lip)

Everything is seeded (falls_shape's own noise), so a rebuild gives the same meshes.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import falls_shape as F  # noqa: E402

try:
    import bpy  # noqa: E402
except ImportError:  # plain python: generators + --stats only
    bpy = None

CASCADE_OFFSET = 0.05          # film height above the rock face (m). Design says 3 cm; the exact heightfield is meant, the
                               # decimated W1 mesh can deviate: W3 re-checks (raise to ~0.12 if the LOD0 rock shows through)
RILL_DROP = 1.6                # side strands run down the rock this far above the ledge before they leave it

TIERS = {
    # rows of the plunge, cascade base step (m), cascade columns, pool rings/segs, foam, outlet rows
    "high": dict(plunge_rows=32, cas_dy=0.5, cas_tread=0.12, cas_cols=8, pool_rings=(0.0, 0.2, 0.4, 0.56, 0.7, 0.8, 0.88, 0.94, 0.98, 1.0, 1.012),
                 pool_segs=40, foam_segs=22, outlet_rows=22, strand_cols=5, core_cols=7),
    "low": dict(plunge_rows=18, cas_dy=0.9, cas_tread=0.2, cas_cols=6, pool_rings=(0.0, 0.35, 0.62, 0.82, 0.94, 1.0, 1.012),
                pool_segs=24, foam_segs=14, outlet_rows=12, strand_cols=3, core_cols=5),
}


def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def nz(a, b=0.0, c=0.0):
    return F.noise3(a, b, c)


def sm(a, b, x):
    return F.smooth(a, b, x)


class Mesh:
    def __init__(self, name, mat):
        self.name, self.mat = name, mat
        self.v, self.f, self.uv, self.col = [], [], [], []

    def add_grid(self, rows, cols, fn, flip=False):
        """fn(i, j) -> ((x, y, z), (u, v), (r, g, b, a)); quads (i, j)-(i, j+1)-(i+1, j+1)-(i+1, j)."""
        base = len(self.v)
        for i in range(rows):
            for j in range(cols):
                p, uv, c = fn(i, j)
                self.v.append(p)
                self.uv.append(uv)
                self.col.append(tuple(clamp(k) for k in c))
        for i in range(rows - 1):
            for j in range(cols - 1):
                a = base + i * cols + j
                q = (a, a + 1, a + cols + 1, a + cols)
                self.f.append(q[::-1] if flip else q)
        return base

    def tris(self):
        return sum(len(q) - 2 for q in self.f)

    def merge(self, other):
        base = len(self.v)
        self.v += other.v
        self.uv += other.uv
        self.col += other.col
        self.f += [tuple(i + base for i in q) for q in other.f]


def arc_lengths(pts):
    out, acc = [0.0], 0.0
    for a, b in zip(pts[:-1], pts[1:]):
        acc += math.dist(a, b)
        out.append(acc)
    return out


# ================================================================================================ plunge ==

def _clear_rock(p, gap=0.08):
    x, y, z = p
    if y < F.LEDGE - 0.2:
        x = max(x, F.face_x(z, y) + gap)
    return (x, y, z)


def lens_ribbon(name, centre_pts, widths, cols, thick, back, jag, alpha, seed, speed0, speeds=None, air_bias=0.0, rim_air=0.35, film=False):
    """A sheet along a centreline (game x,y,z per row) with ragged edges. film=False: closed lens (front + back skin sharing the
    rim) so it has thickness seen edge-on; film=True: one thin skin."""
    n = len(centre_pts)
    arcs = arc_lengths(centre_pts)
    vmax = math.sqrt(F.PLUNGE_SPEED ** 2 + 2 * F.G * (F.LEDGE - F.WATER_Y))
    m = Mesh(name, "M_falls_water")
    sd = seed * 7.13
    side_n = lambda k, s: nz(k * 0.41 + s * 13.7 + sd, 0.7, 3.3 + seed)

    def make(skin):
        def fn(i, j):
            f = i / (n - 1)
            s = -1.0 + 2.0 * j / (cols - 1)
            x, y, z = centre_pts[i]
            w = widths[i] * 0.5
            ja = jag(f)
            hw = w * (1.0 + ja * side_n(i, 0 if s < 0 else 1))
            hw *= 1.0 - 0.28 * ja * abs(s) ** 3 * (0.5 + 0.5 * nz(i * 0.9 + sd, s * 2.0, 1.1))   # frayed corners
            zc = z + 0.3 * f * nz(i * 0.21 + sd, 0.2, 8.8)
            bulge = thick(f) * (1.0 - s * s)
            if skin == "front":
                px = x + bulge
            else:
                px = x - back * bulge
            py = y
            if i == n - 1:
                py = y - 0.12                      # the sheet dips into the pool: no gap at the surface
            speed = (speeds[i] if speeds else 0.0)
            air = clamp(air_bias + 0.12 + 0.8 * f ** 1.3 + rim_air * abs(s) ** 2 + 0.18 * nz(i * 0.3 + sd, s, 4.4))
            edge = clamp(0.9 * abs(s) ** 2.4 + 0.15 * (nz(i * 0.5 + sd, s * 3, 6.6) + 1) * abs(s))
            return _clear_rock((px, py, zc + s * hw)), (0.5 + 0.5 * s, arcs[i] / 4.0), (air, speed, edge, alpha(f, s))
        return fn

    m.add_grid(n, cols, make("front"))
    if not film:
        m.add_grid(n, cols, make("back"), flip=True)
    return m


def plunge_meshes(tier):
    T = TIERS[tier]
    n = T["plunge_rows"]
    vmax = math.sqrt(F.PLUNGE_SPEED ** 2 + 2 * F.G * (F.LEDGE - F.WATER_Y))

    def speeds(path, v0):
        out = []
        for (x, y, z, t) in path:
            out.append(clamp(math.sqrt(v0 ** 2 + (F.G * t) ** 2) / vmax))
        return out

    main = F.plunge_path(n)
    sway = lambda f: 0.34 * math.sin(2 * math.pi * 1.15 * f + 0.7) * sm(0.0, 0.35, f) + 0.25 * nz(f * 3.1, 0.4, 6.2) * f
    pts = [(x, y, z + sway(i / n)) for i, (x, y, z, _) in enumerate(main)]
    spd = speeds(main, F.PLUNGE_SPEED)
    wid = [F.plunge_width(i / n) for i in range(n + 1)]
    core = lens_ribbon("W_falls_plunge_0", pts, [w * 0.80 for w in wid], T["core_cols"],
                       thick=lambda f: (0.20 + 0.36 * f) * (0.72 + 0.56 * (0.5 + 0.5 * nz(f * 7.0, 0.3, 2.0))), back=0.55, jag=lambda f: 0.08 + 0.38 * f,
                       alpha=lambda f, s: 0.97, seed=1, speed0=F.PLUNGE_SPEED, speeds=spd)
    # back film: wider, ragged, drifting 0.1..0.35 m behind the core, mostly aerated
    behind = [(x - 0.10 - 0.25 * (i / n), y, z) for i, (x, y, z) in enumerate(pts)]
    film = lens_ribbon("W_falls_plunge_1", behind, [w * 1.12 for w in wid], T["core_cols"], thick=lambda f: 0.12 + 0.12 * f, back=0.0,
                       jag=lambda f: 0.15 + 0.5 * f, alpha=lambda f, s: 0.85 * (1.0 - 0.4 * abs(s) ** 2) * sm(0.0, 0.08, f * 8 + 0.2),
                       seed=2, speed0=F.PLUNGE_SPEED, speeds=spd, air_bias=0.25, rim_air=0.5, film=True)
    # side strands: run down the rock face for RILL_DROP m, then leave it on their own parabola
    strands = None
    for k, st in enumerate(F.SIDE_STRANDS):
        z0 = F.LIP["z"] + st["dz"]
        free = F.plunge_path(max(10, n * 2 // 3), st["speed"], z0)
        rill = []
        m_ = 4
        for r in range(m_):
            y = F.LEDGE + RILL_DROP * (1 - r / m_)
            rill.append((F.face_x(z0, y) + 0.12, y, z0, 0.0))
        full = rill + free
        # time along the strand: the rill part counts as slow
        pts_s = [(x, y, z) for (x, y, z, _) in full]
        sp = [clamp(math.sqrt(st["speed"] ** 2 + (F.G * t) ** 2) / vmax) for (_, _, _, t) in full]
        w0, w1 = st["width"]
        wid_s = [w0 + (w1 - w0) * clamp((i - m_) / max(1, len(full) - m_ - 1)) for i in range(len(full))]
        mm = lens_ribbon("W_falls_plunge_2", pts_s, wid_s, T["strand_cols"], thick=lambda f: 0.12 + 0.18 * f, back=0.5,
                         jag=lambda f: 0.08 + 0.30 * f, alpha=lambda f, s: 0.92 * sm(0.0, 0.16, f + 0.02), seed=3 + k,
                         speed0=st["speed"], speeds=sp, air_bias=0.1)
        if strands is None:
            strands = mm
        else:
            strands.merge(mm)
    # wisps: thin spray ribbons that peel off both edges in the lower half of the fall
    for side in (-1, 1):
        for k in range(3 if tier == "high" else 2):
            i0 = int((0.40 + 0.17 * k + 0.04 * side) * n)
            sub = pts[i0:]
            if len(sub) < 4:
                continue
            ctr = [(x - 0.1, y, z + side * (wid[i0 + i] * 0.40 + (0.05 + 0.05 * k) * i + 0.2)) for i, (x, y, z) in enumerate(sub)]
            ww = [0.22 + 0.45 * i / (len(sub) - 1) for i in range(len(sub))]
            wm = lens_ribbon("W_falls_plunge_2", ctr, ww, 3, thick=lambda f: 0.05, back=0.0, jag=lambda f: 0.3 + 0.4 * f,
                             alpha=lambda f, s: 0.6 * sm(0.0, 0.3, f) * (1.0 - 0.5 * abs(s)), seed=20 + k + 5 * (side > 0),
                             speed0=F.PLUNGE_SPEED, speeds=spd[i0:], air_bias=0.7, rim_air=0.3, film=True)
            strands.merge(wm)
    return [core, film, strands]


# ============================================================================================== cascade ==

def _face_s(z, y, e=0.22):
    """The outermost rock surface within +-e of (z, y): the film bridges the narrow joints instead of dipping into them."""
    return max(F.face_x(z + dz, y + dy) for dz in (-e, 0.0, e) for dy in (-e, 0.0, e))


def cascade_rows(tier):
    T = TIERS[tier]
    ys = set()
    y = F.TOP
    while y > F.LEDGE:
        ys.add(round(y, 3))
        y -= T["cas_dy"]
    for h in F.CASCADE_LEDGES:                           # dense rows over each tread / riser
        yy = h - 0.15
        while yy <= h + 0.5:
            if F.LEDGE < yy < F.TOP:
                ys.add(round(yy, 3))
            yy += T["cas_tread"]
    ys.add(F.TOP)
    ys.add(F.LEDGE)
    out = []
    for y in sorted(ys, reverse=True):
        if not out or out[-1] - y > 0.05:
            out.append(y)
    return out


def cascade_mesh(tier):
    T = TIERS[tier]
    ys = cascade_rows(tier)
    cols = T["cas_cols"]
    nr = len(ys)
    # geometry first (grid of positions), then flow vectors from the surface
    pos = [[None] * cols for _ in range(nr)]
    ss = [-1.0 + 2.0 * j / (cols - 1) for j in range(cols)]
    for i, y in enumerate(ys):
        zc = F.channel_z(y) + 0.45 * nz(y * 0.17, 4.4, 1.0) * sm(F.LEDGE + 1.0, F.LEDGE + 4.0, y)
        half = F.channel_width(y) * 0.5
        neck = 1.0 - 0.22 * sm(F.LEDGE + 3.0, F.LEDGE, y)       # the water gathers into the spout at the lip
        for j, s in enumerate(ss):
            side = 0 if s < 0 else 1
            hw = half * neck * (1.0 + 0.28 * nz(i * 0.7 + side * 9.1, 1.3, 2.2))
            z = zc + s * hw
            x = _face_s(z, y) + CASCADE_OFFSET + 0.12 * (1.0 - s * s) * (0.7 + 0.3 * nz(i * 0.2, j * 0.7, 5.5))
            pos[i][j] = (x, y, z)
    # speed vectors from the local slope (finite differences of the smoothed face)
    e = 0.3
    flow = [[None] * cols for _ in range(nr)]
    for i, y in enumerate(ys):
        for j in range(cols):
            x, _, z = pos[i][j]
            fy = (_face_s(z, y + e) - _face_s(z, y - e)) / (2 * e)
            fz = (_face_s(z + e, y) - _face_s(z - e, y)) / (2 * e)
            nrm = (1.0, -fy, -fz)
            ln = math.sqrt(sum(c * c for c in nrm))
            nrm = tuple(c / ln for c in nrm)
            d = (nrm[1] * nrm[0], -1.0 + nrm[1] * nrm[1], nrm[1] * nrm[2])   # g - (g.n) n, g = (0, -1, 0)
            mag = math.sqrt(sum(c * c for c in d))
            # tangents: down the slope (-dP/dy) and across (dP/dz)
            tv = (-fy, -1.0, 0.0)
            lv = math.sqrt(tv[0] ** 2 + tv[1] ** 2)
            tv = (tv[0] / lv, tv[1] / lv, 0.0)
            tu = (fz, 0.0, 1.0)
            lu = math.sqrt(tu[0] ** 2 + tu[2] ** 2)
            tu = (tu[0] / lu, 0.0, tu[2] / lu)
            along = sum(a * b for a, b in zip(d, tv))
            across = sum(a * b for a, b in zip(d, tu))
            flow[i][j] = (across, along, mag)
    # arc length of the middle column -> v
    mid = cols // 2
    arcs = arc_lengths([pos[i][mid] for i in range(nr)])
    m = Mesh("W_falls_cascade", "M_falls_cascade")

    def fn(i, j):
        s = ss[j]
        across, along, mag = flow[i][j]
        # ledge brink: the surface gets faster going down (a shelf -> a drop)
        up = flow[max(i - 1, 0)][j][2]
        dn = flow[min(i + 1, nr - 1)][j][2]
        brink = clamp((dn - up) * 1.7) * (1.0 - 0.5 * abs(s)) * (0.75 + 0.25 * nz(i * 0.9, j * 0.8, 6.1))
        brink = clamp(brink + 0.18 * (nz(i * 0.7, j * 1.3, 7.7) + 1) * 0.5 * abs(s))
        y = ys[i]
        edge = clamp(1.9 * (1.0 - abs(s) ** 3.0) + 0.5 * nz(i * 0.55, s * 2.0, 9.9) - 0.1)
        tongue = sm(-0.30, 0.10, nz(s * 1.9 + 3.0, y * 0.23, 8.1)) * (1.0 - 0.0) # rock humps split the sheet into tongues
        tongue = 0.12 + 0.88 * tongue if abs(s) < 0.95 and y < F.TOP - 2.0 and y > F.LEDGE + 2.5 else 1.0
        a = edge * sm(F.TOP, F.TOP - 1.2, y) * 0.96 * tongue
        r = 0.5 + 0.5 * clamp(across * 0.5, -1, 1)
        g = 0.5 + 0.5 * clamp(along, -1, 1)
        return pos[i][j], (0.5 + 0.5 * s, arcs[i] / 4.0), (r, g, brink, a)
    # the speed length is carried by the vector length: keep (across, along) scaled by mag already (d is the full vector)
    m.add_grid(nr, cols, fn)
    arcs_of_y = lambda yq: arcs[min(range(nr), key=lambda i: abs(ys[i] - yq))]
    m.merge(cascade_foam(tier, ys, arcs_of_y))
    return m, ys


def cascade_foam(tier, ys, arcs_of_y):
    """White-water chunks where the water lands on the treads: per tread 2-3 separate lumpy heaps of different width, height and
    height-position (never the same spacing), plus a few small chunks between the treads. Merged into W_falls_cascade (B = 1)."""
    m = Mesh("W_falls_cascade", "M_falls_cascade")
    cols = 7 if tier == "high" else 5
    rows = 4 if tier == "high" else 3
    jobs = []
    for n_, h in enumerate(F.CASCADE_LEDGES):
        yb0 = h + 0.28 + 0.35 * nz(n_ * 2.3, 1.1, 0.4)
        nch = 2 + (1 if nz(n_ * 5.1, 0.2, 3.3) > -0.05 else 0)
        for c in range(nch):
            s0 = -0.72 + 1.44 * (c + 0.5) / nch + 0.2 * nz(n_ * 3.7 + c, 0.5, 2.2)
            ws = 0.85 / nch * (0.6 + 0.5 * (0.5 + 0.5 * nz(n_ + c * 2.9, 1.2, 4.4)))
            jobs.append((yb0 + 0.25 * nz(c * 4.1, n_, 5.0), s0, ws, 0.7 + 0.8 * (0.5 + 0.5 * nz(c * 1.7 + n_, 2.2, 6.0))))
    for k, (yy, s0, ws) in enumerate(((22.7, 0.35, 0.22), (26.4, -0.4, 0.25), (30.1, 0.1, 0.2))):
        jobs.append((yy + 0.2 * nz(k, 1, 1), s0, ws, 0.55))
    for jn, (yb, s0, ws, hs) in enumerate(jobs):
        zc = F.channel_z(yb)
        half = F.channel_width(yb) * 0.5 * 0.9
        arc = arcs_of_y(yb)

        def fn(i, j, yb=yb, zc=zc, half=half, arc=arc, jn=jn, s0=s0, ws=ws, hs=hs):
            sl = -1.0 + 2.0 * j / (cols - 1)                      # local -1..1 across this chunk
            s = max(-0.97, min(0.97, s0 + ws * sl))
            d = i / (rows - 1)
            z = zc + s * half
            lump = 0.5 + 0.5 * nz(j * 1.9 + jn * 7, d * 2.0, 3.7)
            depth = hs * 0.95 * (0.35 + 0.65 * lump) * (1.0 - 0.45 * sl * sl)
            x = _face_s(z, yb) + 0.06 + depth * d
            y = yb + hs * 0.55 * math.sin(math.pi * min(1.0, d * 0.9 + 0.12)) * (0.3 + 0.9 * lump) * (1.0 - 0.5 * sl * sl)
            a = clamp(1.7 * (1.0 - abs(sl) ** 2.2)) * sm(1.0, 0.7, d)
            return (x, y, z), (0.5 + 0.5 * s, arc / 4.0 + d * 0.15), (0.5, 0.35, 1.0, a * 0.95)
        m.add_grid(rows, cols, fn)
    return m


# ================================================================================================== pool ==

def pool_mesh(tier):
    T = TIERS[tier]
    rings, segs = T["pool_rings"], T["pool_segs"]
    ix, iz = F.IMPACT["x"], F.IMPACT["z"]
    m = Mesh("W_falls_pool", "M_water")

    def at(q, th):
        return F.POOL_CX + q * F.POOL_RX * math.cos(th), F.POOL_CZ + q * F.POOL_RZ * math.sin(th)

    def vert(q, th):
        x, z = at(q, th)
        d01 = clamp((F.WATER_Y - F.pool_bed_y(x, z)) / F.POOL["depth"]) if q < 1.0 else 0.0
        near = sm(7.0, 0.0, math.hypot(x - ix, z - iz))
        shore = sm(0.88, 1.0, q)
        a = 0.12 + 0.83 * sm(0.0, 0.3, d01)
        return (x, F.WATER_Y, z), ((x - ix) / 4.0, (z - iz) / 4.0), (d01, near, shore, a)
    base = len(m.v)
    p, uv, c = vert(0.0, 0.0)
    m.v.append(p); m.uv.append(uv); m.col.append(c)
    for q in rings[1:]:
        for k in range(segs):
            p, uv, c = vert(q, 2 * math.pi * k / segs)
            m.v.append(p); m.uv.append(uv); m.col.append(tuple(clamp(t) for t in c))
    for k in range(segs):
        m.f.append((0, 1 + (k + 1) % segs, 1 + k))
    for r in range(len(rings) - 2):
        a0, a1 = 1 + r * segs, 1 + (r + 1) * segs
        for k in range(segs):
            k2 = (k + 1) % segs
            m.f.append((a0 + k, a0 + k2, a1 + k2, a1 + k))
    return m


# ================================================================================================= outlet ==

def outlet_mesh(tier):
    T = TIERS[tier]
    pts = [(p["x"], p["z"]) for p in F.OUTLET["points"]]
    # Catmull-Rom through the points
    def cr(p0, p1, p2, p3, t):
        return tuple(0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t ** 3)
                     for a, b, c, d in zip(p0, p1, p2, p3))
    P = [pts[0]] + pts + [pts[-1]]
    per = max(2, T["outlet_rows"] // (len(pts) - 1))
    line = []
    for i in range(1, len(P) - 2):
        for k in range(per):
            line.append(cr(P[i - 1], P[i], P[i + 1], P[i + 2], k / per))
    line.append(pts[-1])
    arcs = [0.0]
    for a, b in zip(line[:-1], line[1:]):
        arcs.append(arcs[-1] + math.dist(a, b))
    total = arcs[-1]
    hw0 = F.OUTLET["width"] / 2 + 0.35
    cols = 5
    m = Mesh("W_falls_outlet", "M_water")

    def fn(i, j):
        s = -1.0 + 2.0 * j / (cols - 1)
        x, z = line[i]
        a, b = line[max(i - 1, 0)], line[min(i + 1, len(line) - 1)]
        dx, dz = b[0] - a[0], b[1] - a[1]
        ln = math.hypot(dx, dz) or 1.0
        px, pz = -dz / ln, dx / ln
        f = arcs[i] / total
        hw = hw0 * (1.0 + 0.10 * nz(i * 0.5, 0.4, 3.1) + 0.12 * f)
        wy = F.outlet_water_y(F.outlet_dist(x, z)[1]) + 0.012
        a_edge = clamp(2.2 * (1.0 - abs(s) ** 2.2))
        a_start = sm(0.0, 1.6, arcs[i])
        return ((x + px * s * hw, wy, min(z + pz * s * hw, F.SITE["maxZ"])), (0.5 + 0.5 * s, arcs[i] / 4.0),
                (0.15 + 0.15 * (1 - s * s), 0.25 + 0.35 * f, abs(s) ** 1.6, a_edge * a_start * 0.92))
    m.add_grid(len(line), cols, fn)
    return m


# ================================================================================================== foam ==

def foam_mesh(tier):
    T = TIERS[tier]
    segs = T["foam_segs"]
    ix, iz = F.IMPACT["x"], F.IMPACT["z"]
    y0 = F.WATER_Y
    m = Mesh("W_falls_foam", "M_falls_foam")
    uvp = lambda x, z: ((x - ix) / 6.0 + 0.5, (z - iz) / 6.0 + 0.5)

    # heap: a lumpy, off-round mound right under the fall, leaning toward the outlet
    DX, DZ = F.OUTLET["points"][0]["x"] - ix, F.OUTLET["points"][0]["z"] - iz
    dl = math.hypot(DX, DZ)
    DX, DZ = DX / dl, DZ / dl                                    # drift direction (toward the outlet)
    RX, RZ = 1.7, 2.7
    rings = (0.0, 0.3, 0.55, 0.78, 0.93, 1.0)

    def heap(i, j):
        q = rings[i]
        th = 2 * math.pi * j / segs
        lump = 0.4 + 1.1 * abs(nz(math.cos(th) * 1.9 + 3.3, math.sin(th) * 1.9, q * 2.6))
        rr = 1.0 + 0.34 * nz(th * 1.7, 2.2, 1.0) + 0.14 * nz(th * 5.3, 1.0, 4.0)
        x = ix + q * RX * rr * math.cos(th) + 0.5 * q * DX
        z = iz + q * RZ * rr * math.sin(th) + 0.5 * q * DZ
        h = 0.5 * (1.0 - q ** 2.0) * lump + 0.05 * (1 - q)
        dens = clamp(0.35 + 0.5 * (1 - q) + 0.35 * nz(x * 1.6, z * 1.6, 2.2))
        return (x, y0 + 0.02 + h, z), uvp(x, z), (dens, q, clamp(h / 0.55), 0.97 * sm(1.0, 0.8, q))
    base = len(m.v)
    for i in range(len(rings)):
        for j in range(segs):
            p, uv, c = heap(i, j)
            m.v.append(p); m.uv.append(uv); m.col.append(tuple(clamp(t) for t in c))
    for i in range(len(rings) - 1):
        for j in range(segs):
            j2 = (j + 1) % segs
            a, b = base + i * segs, base + (i + 1) * segs
            if i == 0:
                m.f.append((a + j, b + j2, b + j))
            else:
                m.f.append((a + j, a + j2, b + j2, b + j))
    # apron: broken-edged foam patch round the impact, densest under the fall, pulled out toward the outlet (no round edge)
    qs = (0.0, 0.3, 0.55, 0.78, 1.0)
    base = len(m.v)
    asegs = segs + 12
    for i, q in enumerate(qs):
        for j in range(asegs):
            th = 2 * math.pi * j / asegs
            c_, s_ = math.cos(th), math.sin(th)
            rag = 1.0 + 0.5 * nz(c_ * 2.8 + 8.0, s_ * 2.8, 4.4) + 0.22 * nz(th * 6.0, 1.0, 2.0)
            along = max(0.0, (c_ * 1.0 / 1.0) * 0.0 + (s_ * DZ + c_ * DX))      # how much this direction points to the outlet
            stretch = 1.0 + 0.85 * along ** 1.5
            rx, rz = 1.5 + q * (3.4 - 1.5) * rag * stretch, 2.4 + q * (4.6 - 2.4) * rag * stretch
            x, z = ix + rx * c_ + 0.9 * q * DX, iz + rz * s_ + 0.9 * q * DZ
            an = 0.5 + 0.5 * nz(x * 1.3 + 4.0, z * 1.3, 3.1)
            a = 0.0 if i == len(qs) - 1 else clamp(0.95 * sm(1.0, 0.2, q) * clamp(0.35 + 1.5 * (an - 0.35 - 0.3 * q)))
            a = max(a, 0.85 * sm(0.62, 0.0, q)) if i < len(qs) - 1 else a      # dense right under the fall: no gap to the heap
            m.v.append((x, y0 + 0.035 + 0.02 * (1 - q), z)); m.uv.append(uvp(x, z))
            m.col.append((clamp((0.85 - 0.6 * q) * (0.6 + 0.7 * an)), clamp(0.4 + 0.6 * q), 0.1, clamp(a)))
    for i in range(len(qs) - 1):
        a, b = base + i * asegs, base + (i + 1) * asegs
        for j in range(asegs):
            j2 = (j + 1) % asegs
            m.f.append((a + j, a + j2, b + j2, b + j))
    # three foam lines dragged toward the outlet (the pool's slow surface current)
    o = F.OUTLET["points"][0]
    for k, (off, w0) in enumerate(((-1.5, 0.7), (0.2, 1.0), (1.4, 0.6))):
        p0 = (ix + 1.7, iz + off)
        p2 = (o["x"] + 0.25 * (k - 1), o["z"] - 0.6)
        pc = (ix + 4.5 + 0.8 * k, iz + 0.55 * (p2[1] - iz) + 0.6 * off)
        rows = 12 if tier == "high" else 7
        line = []
        for r in range(rows + 1):
            t = r / rows
            line.append(tuple((1 - t) ** 2 * a + 2 * (1 - t) * t * b + t * t * c for a, b, c in zip(p0, pc, p2)))
        arcs = [0.0]
        for a, b in zip(line[:-1], line[1:]):
            arcs.append(arcs[-1] + math.dist(a, b))
        cols = 4
        base = len(m.v)
        for r in range(rows + 1):
            t = r / rows
            x, z = line[r]
            a_, b_ = line[max(r - 1, 0)], line[min(r + 1, rows)]
            dx, dz = b_[0] - a_[0], b_[1] - a_[1]
            ln = math.hypot(dx, dz) or 1.0
            px, pz = -dz / ln, dx / ln
            hw = (w0 * (0.5 + 0.9 * math.sin(math.pi * min(1.0, t * 1.15)) ** 0.8) + 0.25) * (1 + 0.25 * nz(r * 0.8 + k * 5, 1.1, 1.9))
            for j in range(cols):
                s = -1 + 2 * j / (cols - 1)
                m.v.append((x + px * s * hw, y0 + 0.03, z + pz * s * hw))
                m.uv.append((0.5 + 0.5 * s, arcs[r] / 4.0))
                m.col.append((clamp(0.8 * (1 - t) ** 0.7), t, 0.0, clamp(0.85 * sm(1.0, 0.7, t) * (1 - 0.55 * abs(s) ** 2.0) * sm(0.0, 0.08, t))))
        for r in range(rows):
            for j in range(cols - 1):
                a = base + r * cols + j
                m.f.append((a, a + 1, a + cols + 1, a + cols))
    return m


# ================================================================================================= assemble ==

def all_meshes(tier="high"):
    meshes = plunge_meshes(tier)
    casc, _ = cascade_mesh(tier)
    meshes += [casc, pool_mesh(tier), foam_mesh(tier), outlet_mesh(tier)]
    return meshes


def orient_up_east(mesh):
    """Face normals toward +x for the vertical sheets, toward +y for the flat ones (the GLB materials are double sided,
    but a consistent winding keeps lighting/normals right)."""
    want = (0.0, 1.0, 0.0) if mesh.name.split("_")[2] in ("pool", "foam", "outlet") else (1.0, 0.0, 0.0)
    votes = 0.0
    for q in mesh.f[::max(1, len(mesh.f) // 40)]:
        a, b, c = (mesh.v[q[0]], mesh.v[q[1]], mesh.v[q[2]])
        u = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
        v = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
        n = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
        votes += sum(x * y for x, y in zip(n, want))
    return votes


def blender_xyz(p):
    return (p[0], -p[2], p[1])


def stats(tier="high"):
    ms = all_meshes(tier)
    tot = 0
    for m in ms:
        print(f"  {m.name:22s} {m.mat:16s} verts {len(m.v):5d}  tris {m.tris():5d}")
        tot += m.tris()
    print(f"  tier {tier}: {len(ms)} meshes, {tot} triangles")
    return tot


def check(tier="high"):
    """Self-test of the meshes against falls_shape (exit 1 on failure): clearance from the rock, film height, sizes, ranges."""
    ms = {m.name: m for m in all_meshes(tier)}
    fails = []

    def ok(c, msg):
        print(("ok   " if c else "FAIL ") + msg)
        if not c:
            fails.append(msg)
    for nm in ("W_falls_plunge_0", "W_falls_plunge_1", "W_falls_plunge_2"):
        m = ms[nm]
        worst = min(p[0] - F.face_x(p[2], p[1]) for p in m.v if p[1] < F.LEDGE - 0.2)
        ok(worst > 0.04, f"{nm}: clears the rock below the ledge (closest {worst:.2f} m)")
        ok(all(F.WATER_Y - 0.2 <= p[1] <= F.LEDGE + RILL_DROP + 0.01 for p in m.v), f"{nm}: between the pool surface and the rill top")
    c = ms["W_falls_cascade"]
    gaps = [p[0] - F.face_x(p[2], p[1]) for p in c.v]
    ok(min(gaps) > 0.0, f"cascade film never inside the rock (min {min(gaps):.3f} m)")
    ok(max(gaps) < 1.6, f"cascade film at most {max(gaps):.2f} m off the face at a joint (it bridges the cracks; median {sorted(gaps)[len(gaps)//2]:.2f} m)")
    near = sorted(gaps)[len(gaps) // 10]
    ok(near >= CASCADE_OFFSET - 0.02, f"90% of the cascade film is >= {CASCADE_OFFSET - 0.02:.2f} m off the face ({near:.3f})")
    for nm, m in ms.items():
        ok(all(0.0 <= k <= 1.0 for col in m.col for k in col), f"{nm}: COLOR_0 within 0..1")
        ok(len(m.v) == len(m.uv) == len(m.col), f"{nm}: one UV and one colour per vertex")
        if nm.startswith("W_falls_p") and nm.endswith(("pool",)):
            ok(all(abs(p[1] - F.WATER_Y) < 1e-9 for p in m.v), "pool surface is flat at waterY")
    pool = ms["W_falls_pool"]
    ok(all(F.pool_q(p[0], p[2]) <= 1.0125 for p in pool.v), "pool surface within 1.2% of the waterline")
    out = ms["W_falls_outlet"]
    ok(all(F.SITE["minX"] <= p[0] <= F.SITE["maxX"] and p[2] <= F.SITE["maxZ"] + 1e-6 for p in out.v), "outlet inside the site box")
    foam = ms["W_falls_foam"]
    ok(all(p[1] >= F.WATER_Y for p in foam.v), "foam above the water")
    ok(all(F.in_box(p[0], p[2], F.SITE) for m in ms.values() for p in m.v), "every vertex inside the site box")
    budget = 6000 if tier == "high" else 3000
    tot = sum(m.tris() for m in ms.values())
    ok(tot <= budget, f"triangles {tot} <= design budget {budget} (6k high / 3k low)")
    return not fails


# ================================================================================================== blender ==

def make_materials():
    mats = {}
    spec = {"M_falls_water": (0.80, 0.90, 0.95, 0.7), "M_falls_cascade": (0.85, 0.92, 0.96, 0.7),
            "M_falls_foam": (0.95, 0.97, 0.98, 0.9), "M_water": (0.06, 0.22, 0.17, 0.85)}
    for name, (r, g, b, a) in spec.items():
        mt = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        mt.use_nodes = True
        bs = next(n for n in mt.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        bs.inputs["Base Color"].default_value = (r, g, b, 1)
        bs.inputs["Alpha"].default_value = a
        bs.inputs["Roughness"].default_value = 0.3
        try:
            mt.surface_render_method = "BLENDED"
        except Exception:
            pass
        mats[name] = mt
    return mats


def to_blender(mesh, collection, mats):
    me = bpy.data.meshes.new(mesh.name)
    me.from_pydata([blender_xyz(p) for p in mesh.v], [], mesh.f)
    me.update()
    uv = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        for li in poly.loop_indices:
            uv.data[li].uv = mesh.uv[me.loops[li].vertex_index]
    ca = me.color_attributes.new("Color", "FLOAT_COLOR", "POINT")
    for i, c in enumerate(mesh.col):
        ca.data[i].color = c
    me.color_attributes.active_color = ca
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(mesh.name, me)
    collection.objects.link(ob)
    ob.data.materials.append(mats[mesh.mat])
    return ob


def build_water(collection, tier="high"):
    """Create all water objects + markers in `collection`; returns {name: object}. Called by build_waterfall.py (W1) too."""
    mats = make_materials()
    out = {}
    for m in all_meshes(tier):
        if orient_up_east(m) < 0:
            m.f = [q[::-1] for q in m.f]
        out[m.name] = to_blender(m, collection, mats)
    for nm, p in (("marker__falls_impact", (F.IMPACT["x"], F.IMPACT["y"], F.IMPACT["z"])), ("marker__falls_lip", (F.LIP["x"], F.LIP["y"], F.LIP["z"]))):
        e = bpy.data.objects.new(nm, None)
        e.empty_display_type = "PLAIN_AXES"
        e.location = blender_xyz(p)
        collection.objects.link(e)
        out[nm] = e
    return out


def export_glb(path, objs):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    kw = dict(filepath=path, export_format="GLB", use_selection=True, export_apply=False, export_yup=True, export_texcoords=True,
              export_normals=True, export_materials="EXPORT", export_cameras=False, export_lights=False)
    props = bpy.ops.export_scene.gltf.get_rna_type().properties
    if "export_vertex_color" in props:
        kw["export_vertex_color"] = "ACTIVE"
    if "export_active_vertex_color_when_no_material" in props:
        kw["export_active_vertex_color_when_no_material"] = True
    kw = {k: v for k, v in kw.items() if k in props}
    bpy.ops.export_scene.gltf(**kw)
    print("exported", path, os.path.getsize(path), "bytes")


def main(argv):
    tier = argv[argv.index("--tier") + 1] if "--tier" in argv else "high"
    if "--check" in argv:
        sys.exit(0 if check("high") and check("low") else 1)
    if "--stats" in argv or bpy is None:
        stats("high")
        stats("low")
        return
    out = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(os.path.dirname(HERE), "work", "falls_w2")
    os.makedirs(out, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    col = bpy.context.scene.collection
    objs = build_water(col, tier)
    stats(tier)
    if "--glb" in argv:
        export_glb(os.path.join(out, "falls_water.glb" if tier == "high" else "falls_water_low.glb"), list(objs.values()))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, f"falls_water_{tier}.blend"))


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
