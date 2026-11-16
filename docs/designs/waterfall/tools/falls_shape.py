"""B1 waterfall: the LOCKED shape (W0, 2026-11-16). Design: docs/designs/waterfall/design.md (sections 4, 7, 8).

Every later chunk builds from these functions and numbers, never from its own copy:
  W1 rock/ground   face_x() (hi-res cliff mesh), terrain_y() (site ground + plateau + flanks), slab/seat/lamp spots
  W2 water         plunge_path(), cascade_path() / channel_*(), pool_*(), outlet_*(), markers
  W4 runtime       numbers only (layout.backdrop.waterfall in shared, falls-contract.json): impact, lip, pool, lamps
  W5 walk/camera   numbers only (layout): pocket, entry, pool keep-out, slabs, seats, cameraWallX
  W6 village       site box hole + SITE EDGE seam (site_edge_points(), waterfall_site_edge.json)

Pure Python (no bpy, no mathutils): the noise below is our own, seeded, so the shape is identical in Blender 5.3, in a
plain `python` and on any machine. Positions come from the village layout (art/village/layout.json, written by
`npx tsx scripts/export-village-layout.ts`); the rock-shape constants are here.

Coordinates: GAME space, metres: x east, z south (north is -z), y up; the falls face east (+x), toward the village.
Blender = (x, -z, y) (see vlib.V). Design-doc blockout local frame: (x + 118, -(z + 78)).

  python falls_shape.py --check                     self-test of the contract (exit 1 on failure)
  python falls_shape.py --export-contract OUT.json  everything W1..W6 need, as plain numbers and sample tables
  blender -b --factory-startup -P falls_shape.py -- --edge-provisional
        writes art/village/work/waterfall_site_edge.json from the CURRENT village terrain (parts_nature.terrain_h)
        with the pocket-flattening rule applied; W6's village rebuild writes the final one in the same format.
"""
import json
import math
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

# =============================================================================================== layout ==


def _find_layout():
    cands = [os.environ.get("CV_LAYOUT"), os.path.join(os.path.dirname(HERE), "layout.json")]
    d = HERE
    for _ in range(8):  # this file is also copied to docs/designs/waterfall/tools/: walk up to the repo root
        cands.append(os.path.join(d, "art", "village", "layout.json"))
        d = os.path.dirname(d)
    for p in cands:
        if p and os.path.exists(p):
            return p
    raise FileNotFoundError("layout.json not found: run `npx tsx scripts/export-village-layout.ts` first (or set CV_LAYOUT)")


LAYOUT_PATH = _find_layout()
L = json.load(open(LAYOUT_PATH, encoding="utf-8"))
WF = L["backdrop"]["waterfall"]
for _k in ("site", "pocket", "entry", "lip", "impact", "pool", "outlet", "slabs", "seats", "lamps", "cameraWall", "options"):
    if _k not in WF:
        raise KeyError(f"layout.backdrop.waterfall.{_k} missing: re-export layout.json from shared (W0 fields)")

SITE = WF["site"]                     # {minX, maxX, minZ, maxZ}: x -140..-100, z -104..-58
POCKET = WF["pocket"]                 # x -106..-95, z -90..-68 (walkable rest area)
ENTRY = WF["entry"]                   # x -95, z -86..-70 (opening in the walk bounds)
LIP = WF["lip"]                       # (-117, 17, -78)
IMPACT = WF["impact"]                 # (-112.87, -0.25, -78)
PLUNGE_SPEED = WF["plungeSpeed"]      # 2.2 m/s
POOL = WF["pool"]
POOL_CX, POOL_CZ = POOL["centre"]["x"], POOL["centre"]["z"]
POOL_RX, POOL_RZ = POOL["radiusX"], POOL["radiusZ"]
WATER_Y = POOL["waterY"]
OUTLET = WF["outlet"]
SLABS = WF["slabs"]
SEATS = WF["seats"]
LAMPS = WF["lamps"]
CAMERA_WALL = WF["cameraWall"]       # [{x, z}] north -> south
OPTIONS = WF["options"]
TOP = float(WF["height"])             # 36: top of the upper cascade (water leaves the plateau here)
LEDGE = float(LIP["y"])               # 17: the main ledge; free plunge below it
FX, FZ = WF["centre"]["x"], WF["centre"]["z"]  # (-118, -78): old backdrop centre, the village ridge's reference

# ================================================================================ shape constants (art) ==
SEED = 1116
G = 9.81
PLATEAU_Y = TOP + 5.0                 # 41: the forested ridge top behind the cliff (= parts_nature.terrain_h ridge)
CASCADE_LEDGES = (20.6, 24.4, 28.0, 31.8)   # treads of the upper cascade between the lip (17) and the top (36)
CASCADE_TREAD = 0.6                   # each ledge steps the channel floor back this much (m)
CASCADE_LEAN = 0.12                   # extra recession of the channel floor per metre of height
CHANNEL_DEPTH = 2.2                   # the groove the upper cascade runs in (m, at its centre)
CHANNEL_HALF = 2.6                    # gaussian half-width of the groove (m): ~5 m wide at half depth
CHANNEL_Z_TOP = FZ - 1.0              # -79: the groove's centre above 22 m; it meets the lip (z -78) below
ALCOVE_DEPTH = 3.0                    # the wet alcove behind the plunge (m, at the pool)
ALCOVE_HALF = 5.5
LIP_PROTRUDE = 1.2
SHEET = 3.7                           # sheet-exfoliation ledges every ~3.7 m ...
SHEET_STEP = 0.45                     # ... each stepping the face back 0.45 m (moss ledges)
BENCHES = ((9.5, 1.2), (27.5, 2.0))  # (height, depth): the rock steps back here (vegetated tiers, ref 09/12)
BLOCK_RELIEF = 2.4                    # each jointed block stands out or in by up to +-1.2 m
CRACK_DEPTH = 1.0                     # joints between blocks
CONCAVE = 0.022                       # plan concavity of the exposed rock (amphitheatre), x += CONCAVE * dz^2
FLANK_START, FLANK_FULL = 12.0, 20.0  # |dz| where the bare rock turns into the wooded slope of the village ridge
FACE_Z = (-98.0, -58.0)               # z range W1 meshes as hi-res cliff (outside: terrain_y only)
FACE_Y = (-2.6, 41.0)                 # y range of the hi-res cliff mesh (below the pool bed .. the plateau; W1 trims at terrain_y)
GULLY_FADE = (-136.0, -128.0)         # the stream bed on the plateau feeding the top fades out westward
EDGE_BLEND = 5.0                      # terrain_y meets the village's seam heights over this band (m)
EDGE_SPACING = 1.0                    # seam vertex spacing along the site box (m); box corners are integers
SHORE_RISE = POOL["keepOut"]          # ground climbs from the waterline (-0.25) to the walk level (0) within keep-out
EDGE_FILE_DEFAULT = os.path.join(os.path.dirname(HERE), "work", "waterfall_site_edge.json") \
    if os.path.basename(os.path.dirname(HERE)) == "village" else None

# ============================================================================================== noise ==
_rng = random.Random(SEED)
_P = list(range(256))
_rng.shuffle(_P)
_P = _P + _P


def _fade(t):
    return t * t * t * (t * (t * 6 - 15) + 10)


def _grad(h, x, y, z):
    h &= 15
    u = x if h < 8 else y
    v = y if h < 4 else (x if h in (12, 14) else z)
    return (u if (h & 1) == 0 else -u) + (v if (h & 2) == 0 else -v)


def noise3(x, y, z):
    """Improved Perlin noise, about -1..1."""
    xi, yi, zi = math.floor(x), math.floor(y), math.floor(z)
    X, Y, Z = xi & 255, yi & 255, zi & 255
    x -= xi
    y -= yi
    z -= zi
    u, v, w = _fade(x), _fade(y), _fade(z)
    A = _P[X] + Y
    AA, AB = _P[A] + Z, _P[A + 1] + Z
    B = _P[X + 1] + Y
    BA, BB = _P[B] + Z, _P[B + 1] + Z

    def lerp(t, a, b):
        return a + t * (b - a)
    return lerp(w, lerp(v, lerp(u, _grad(_P[AA], x, y, z), _grad(_P[BA], x - 1, y, z)),
                        lerp(u, _grad(_P[AB], x, y - 1, z), _grad(_P[BB], x - 1, y - 1, z))),
                lerp(v, lerp(u, _grad(_P[AA + 1], x, y, z - 1), _grad(_P[BA + 1], x - 1, y, z - 1)),
                     lerp(u, _grad(_P[AB + 1], x, y - 1, z - 1), _grad(_P[BB + 1], x - 1, y - 1, z - 1))))


def fbm(x, y, z, octaves=4, lac=2.0, gain=0.5):
    s, a, f, n = 0.0, 1.0, 1.0, 0.0
    for _ in range(octaves):
        s += a * noise3(x * f, y * f, z * f)
        n += a
        a *= gain
        f *= lac
    return s / n


def _hash2(i, j, k=0):
    h = (i * 374761393 + j * 668265263 + k * 2147483647 + SEED * 144269) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return (h ^ (h >> 16)) / 4294967295.0


def worley2(u, v):
    """Cellular noise: (F1, F2, id of the nearest cell's random value in 0..1)."""
    iu, iv = math.floor(u), math.floor(v)
    f1 = f2 = 9.0
    nid = 0.0
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            ci, cj = iu + di, iv + dj
            px = ci + 0.15 + 0.7 * _hash2(ci, cj, 1)
            py = cj + 0.15 + 0.7 * _hash2(ci, cj, 2)
            d = math.hypot(u - px, v - py)
            if d < f1:
                f2, f1, nid = f1, d, _hash2(ci, cj, 3)
            elif d < f2:
                f2 = d
    return f1, f2, nid


def smooth(a, b, x):
    """Smoothstep from a (0) to b (1); a > b runs backwards."""
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def inv_smooth(f):
    """Inverse of smoothstep on 0..1."""
    f = max(0.0, min(1.0, f))
    return 0.5 - math.sin(math.asin(1.0 - 2.0 * f) / 3.0)


# ======================================================================================== the cliff ==

def village_front(a):
    """parts_nature.terrain_h's ridge behind the falls, as the x of its foot (|dz| = a) and its width."""
    return FX + 1.0 + 0.5 * max(0.0, a - 15.0), 4.0 + 1.6 * max(0.0, a - 15.0)


def channel_z(y):
    """Centre z of the upper-cascade groove at height y (meets the lip's z at the lip)."""
    return LIP["z"] + (CHANNEL_Z_TOP - LIP["z"]) * smooth(LEDGE, LEDGE + 5.0, y)


def _face_raw(z, y):
    dz = z - FZ
    a = abs(dz)
    dzp = z - LIP["z"]
    wb = smooth(FLANK_START, FLANK_FULL, a)        # 0 = bare rock, 1 = the village ridge's wooded slope
    # --- bare granite: concave in plan, sheet ledges, a slight lean, the rim rolling into the plateau
    sheet_q = y / SHEET + 0.8 * noise3(z * 0.07, 0.31, 1.7)
    x_rock = (CONCAVE * a * a - 0.035 * y - SHEET_STEP * math.floor(sheet_q)
              - 3.5 * smooth(TOP, PLATEAU_Y, y) - 25.0 * max(0.0, y - PLATEAU_Y))
    # vertical jointing: tall blocks (~6 m wide, ~18 m tall), each pushed out or in as a whole, cracks between
    f1, f2, cid = worley2(z * 0.17, y * 0.055)
    blocks = (cid - 0.5) * BLOCK_RELIEF - CRACK_DEPTH * math.exp(-(f2 - f1) / 0.06)
    n1 = fbm(z * 0.06, y * 0.05, 2.2) * 2.0
    n2 = noise3(z * 0.45, y * 0.45, 5.1) * 0.3
    alcove = -ALCOVE_DEPTH * math.exp(-(dzp / ALCOVE_HALF) ** 2) * max(0.0, 1.0 - y / LEDGE) ** 0.7 if y < LEDGE else 0.0
    lip = LIP_PROTRUDE * math.exp(-((y - LEDGE) / 0.9) ** 2) * math.exp(-(dzp / 6.0) ** 2)
    # the upper cascade's groove: deeper and stepped (treads at CASCADE_LEDGES), cut through the rim at the top
    g = math.exp(-((z - channel_z(y)) / CHANNEL_HALF) ** 2)
    cv = smooth(LEDGE + 0.2, LEDGE + 1.0, y)
    steps = -CASCADE_LEAN * max(0.0, y - LEDGE) - sum(CASCADE_TREAD * smooth(h - 0.05, h + 0.25, y) for h in CASCADE_LEDGES)
    chan = g * cv * (-CHANNEL_DEPTH + steps) - g * 3.0 * max(0.0, y - TOP)
    # two big benches (tiers with shrubs and moss): none in the groove, the lower one not beside the plunge
    w_up = 1.0 - math.exp(-((z - CHANNEL_Z_TOP) / (CHANNEL_HALF + 1.5)) ** 2)
    w_lo = 1.0 - math.exp(-(dzp / 4.5) ** 2)
    benches = -sum(d * smooth(yb - 0.3, yb + 0.5, y) * (w_up if yb > LEDGE else w_lo) for yb, d in BENCHES)
    rock = x_rock + blocks + n1 + n2 + alcove + lip + chan + benches
    # --- wooded slope (the village ridge profile), lumpy
    front, width = village_front(a)
    x_v = front - width * inv_smooth(y / PLATEAU_Y) - 25.0 * max(0.0, y - PLATEAU_Y) + 0.6 * fbm(z * 0.08, y * 0.08, 7.7)
    return rock, x_v, wb


def _calibrate():
    rock, _, _ = _face_raw(LIP["z"], LIP["y"])
    return LIP["x"] - rock


C0 = _calibrate()


def face_x(z, y):
    """x of the rock face at (z, y): rock is WEST of it (x < face_x). Valid for z in the site, y in FACE_Y.
    Bare granite near the falls (|z - FZ| < 12), turning into the village ridge's wooded slope by |z - FZ| = 20."""
    rock, x_v, wb = _face_raw(z, y)
    return (rock + C0) * (1.0 - wb) + x_v * wb


def column_top(x, z, y_lo=FACE_Y[0], y_hi=PLATEAU_Y + 3.0):
    """Top of the rock under (x, z) (the highest y with x < face_x), or None if no rock there."""
    step = 0.5
    y = y_hi
    while y >= y_lo:
        if x < face_x(z, y):
            lo, hi = y, y + step
            for _ in range(14):
                m = 0.5 * (lo + hi)
                if x < face_x(z, m):
                    lo = m
                else:
                    hi = m
            return min(lo, y_hi)
        y -= step
    return None


# ========================================================================================== the water ==

SIDE_STRANDS = ({"dz": -2.6, "speed": 1.5, "width": (0.9, 1.8)}, {"dz": 2.9, "speed": 1.2, "width": (0.7, 1.4)})


def plunge_path(n=40, speed=None, z=None):
    """A plunge centreline: [(x, y, z, t_seconds)] from the ledge to the pool surface (a parabola). The main sheet
    (default) leaves the lip; a side strand (z = LIP z + dz) leaves the rock face at its own z, 0.15 m out."""
    v = PLUNGE_SPEED if speed is None else speed
    zz = LIP["z"] if z is None else z
    x0 = LIP["x"] if z is None else face_x(zz, LEDGE) + 0.15
    drop = LIP["y"] - WATER_Y
    T = math.sqrt(2.0 * drop / G)
    out = []
    for k in range(n + 1):
        t = T * k / n
        out.append((x0 + v * t, LIP["y"] - 0.5 * G * t * t, zz, t))
    return out


def plunge_width(f):
    """Main sheet width at fraction f (0 lip .. 1 pool): 3.4 -> 5.2 m; two side strands (see contract)."""
    return 3.4 + (5.2 - 3.4) * f


def cascade_path(dy=0.25):
    """The upper cascade's floor line: [(x, y, z)] from the top (TOP) down to the lip, on the groove's floor."""
    out = []
    y = TOP
    while y >= LEDGE - 1e-9:
        z = channel_z(y)
        out.append((face_x(z, y), y, z))
        y -= dy
    return out


def channel_width(y):
    """Wetted width of the upper cascade at height y: ~4 m at the top widening to ~5 m at the lip."""
    return 4.0 + 1.0 * (1.0 - (y - LEDGE) / (TOP - LEDGE))


def pool_q(x, z):
    """Normalised ellipse radius of the waterline (1 = waterline)."""
    return math.hypot((x - POOL_CX) / POOL_RX, (z - POOL_CZ) / POOL_RZ)


def _pool_radius_dir(x, z):
    dx, dz = x - POOL_CX, z - POOL_CZ
    th = math.atan2(dz, dx)
    return (POOL_RX * POOL_RZ) / math.hypot(POOL_RZ * math.cos(th), POOL_RX * math.sin(th))


def pool_signed_dist(x, z):
    """Approximate distance to the waterline (m): negative inside the pool."""
    return (pool_q(x, z) - 1.0) * _pool_radius_dir(x, z)


def pool_bed_y(x, z):
    """Pool bed height inside the waterline: 0.3 m deep 1 m in, 2.2 m deep in the middle."""
    d_in = max(0.0, -pool_signed_dist(x, z))
    depth = POOL["edgeDepth"] * smooth(0.0, 1.0, d_in) + (POOL["depth"] - POOL["edgeDepth"]) * smooth(1.0, 6.0, d_in)
    return WATER_Y - depth


def _seg_dist(px, pz, a, b):
    dx, dz = b["x"] - a["x"], b["z"] - a["z"]
    L2 = dx * dx + dz * dz
    t = max(0.0, min(1.0, ((px - a["x"]) * dx + (pz - a["z"]) * dz) / L2))
    return math.hypot(px - a["x"] - t * dx, pz - a["z"] - t * dz), t, math.sqrt(L2)


def outlet_dist(x, z):
    """(distance to the outlet centreline, fraction 0..1 along it)."""
    pts = OUTLET["points"]
    total = sum(math.hypot(b["x"] - a["x"], b["z"] - a["z"]) for a, b in zip(pts[:-1], pts[1:]))
    best, best_f, acc = 1e9, 0.0, 0.0
    for a, b in zip(pts[:-1], pts[1:]):
        d, t, ln = _seg_dist(x, z, a, b)
        if d < best:
            best, best_f = d, (acc + t * ln) / total
        acc += ln
    return best, best_f


def outlet_water_y(f):
    y0, y1 = OUTLET["waterY"]
    return y0 + (y1 - y0) * f


# ========================================================================================= the ground ==

def camera_wall_x(z):
    """x of the camera wall at z (interpolated; held flat beyond its ends)."""
    w = CAMERA_WALL
    if z <= w[0]["z"]:
        return w[0]["x"]
    for a, b in zip(w[:-1], w[1:]):
        if z <= b["z"]:
            return a["x"] + (b["x"] - a["x"]) * (z - a["z"]) / (b["z"] - a["z"])
    return w[-1]["x"]


def in_box(x, z, b, grow=0.0):
    return b["minX"] - grow <= x <= b["maxX"] + grow and b["minZ"] - grow <= z <= b["maxZ"] + grow


def _box_dist(x, z, b):
    dx = max(b["minX"] - x, 0.0, x - b["maxX"])
    dz = max(b["minZ"] - z, 0.0, z - b["maxZ"])
    return math.hypot(dx, dz)


def slab_local(s, x, z):
    c, sn = math.cos(s["yaw"]), math.sin(s["yaw"])
    dx, dz = x - s["centre"]["x"], z - s["centre"]["z"]
    # yaw about +y: the slab's local x axis is (cos, -sin) in (x, z)
    lx = dx * c - dz * sn
    lz = dx * sn + dz * c
    return math.hypot(lx / s["radiusX"], lz / s["radiusZ"])


def slab_at(x, z, inset=0.0):
    """The slab whose footprint (shrunk by `inset` m) holds (x, z), or None."""
    for s in SLABS:
        r = min(s["radiusX"], s["radiusZ"])
        if slab_local(s, x, z) <= max(0.0, 1.0 - inset / r):
            return s
    return None


def walk_surface_ok(x, z):
    """Contract for W5: may a standing player's centre be here? (in the pocket, out of the pool's keep-out, unless on
    a slab; not in the outlet). Body radius is W5's business (shared PLAYER_RADIUS 0.4)."""
    if not in_box(x, z, POCKET):
        return False
    if slab_at(x, z) is not None:
        return True
    if pool_signed_dist(x, z) < POOL["keepOut"]:
        return False
    d, _ = outlet_dist(x, z)
    return d > OUTLET["width"] / 2 + 1.0


def floor_y(x, z):
    """The canyon floor (no rock, no edge blend): pool bed, shore, pocket at 0, outlet, gentle lumps elsewhere."""
    sd = pool_signed_dist(x, z)
    if sd < 0.0:
        y = pool_bed_y(x, z)
    else:
        y = WATER_Y + (0.0 - WATER_Y) * smooth(0.0, SHORE_RISE, sd)
        # lumps (gravel mounds, roots) away from the walk area and the shore
        pw = smooth(2.0, 0.0, _box_dist(x, z, POCKET))
        y += 0.45 * (0.5 + 0.5 * fbm(x * 0.09, z * 0.09, 3.3)) * smooth(SHORE_RISE, 4.0, sd) * (1.0 - pw)
    d, f = outlet_dist(x, z)
    hw = OUTLET["width"] / 2
    if d < hw + 1.5:
        wy = outlet_water_y(f)
        bed = wy - 0.12 - 0.3 * max(0.0, 1.0 - (d / hw) ** 2)
        k = smooth(hw + 1.5, hw, d)
        y = min(y, y * (1 - k) + bed * k) if sd >= 0 else y
    return y


def plateau_y(x, z):
    """The plateau top behind the rim, with the gully that feeds the upper cascade."""
    y = PLATEAU_Y - 0.6 * abs(fbm(x * 0.05, z * 0.05, 9.1))
    d = abs(z - CHANNEL_Z_TOP)
    bed = TOP + 0.03 * max(0.0, (face_x(CHANNEL_Z_TOP, TOP) - x))
    k = smooth(GULLY_FADE[0], GULLY_FADE[1], x) * smooth(CHANNEL_HALF * 0.8 + 3.0, CHANNEL_HALF * 0.8, d)
    return y * (1 - k) + min(y, bed) * k


# --------------------------------------------------------------------------- the seam with village.glb --

def site_edge_points(spacing=EDGE_SPACING):
    """The hole outline: points every `spacing` m round the site box, counter-clockwise seen from above in game
    space (north edge west->east, east edge north->south, south edge east->west, west edge south->north),
    starting at the north-west corner. Corners appear once."""
    b = SITE
    pts = []

    def run(x0, z0, x1, z1):
        n = int(round(math.hypot(x1 - x0, z1 - z0) / spacing))
        for i in range(n):
            pts.append((round(x0 + (x1 - x0) * i / n, 6), round(z0 + (z1 - z0) * i / n, 6)))
    run(b["minX"], b["minZ"], b["maxX"], b["minZ"])
    run(b["maxX"], b["minZ"], b["maxX"], b["maxZ"])
    run(b["maxX"], b["maxZ"], b["minX"], b["maxZ"])
    run(b["minX"], b["maxZ"], b["minX"], b["minZ"])
    return pts


def pocket_flatten(x, z, h):
    """W6 rule (V5b): the village ground is 0 in the pocket (x -106..-95, z -90..-68) and rises back to its own
    height over 2 m outside it, so the walk surface (y = 0) matches the ground there."""
    k = smooth(2.0, 0.0, _box_dist(x, z, POCKET))
    return h * (1 - k)


class SiteEdge:
    """Heights of the village ground along the hole outline (the seam). Loaded from waterfall_site_edge.json."""

    def __init__(self, path=None):
        path = path or EDGE_FILE_DEFAULT
        self.path = path
        self.ok = bool(path and os.path.exists(path))
        self.sides = None
        if self.ok:
            data = json.load(open(path, encoding="utf-8"))
            pts = data["points"]
            b = SITE
            n, e, s, w = [], [], [], []
            for p in pts:
                if abs(p["z"] - b["minZ"]) < 1e-6:
                    n.append((p["x"], p["y"]))
                if abs(p["x"] - b["maxX"]) < 1e-6:
                    e.append((p["z"], p["y"]))
                if abs(p["z"] - b["maxZ"]) < 1e-6:
                    s.append((p["x"], p["y"]))
                if abs(p["x"] - b["minX"]) < 1e-6:
                    w.append((p["z"], p["y"]))
            self.sides = {k: sorted(v) for k, v in (("n", n), ("e", e), ("s", s), ("w", w))}

    @staticmethod
    def _interp(tab, t):
        if t <= tab[0][0]:
            return tab[0][1]
        for (t0, y0), (t1, y1) in zip(tab[:-1], tab[1:]):
            if t <= t1:
                return y0 + (y1 - y0) * (t - t0) / (t1 - t0)
        return tab[-1][1]

    def height(self, side, t):
        return self._interp(self.sides[side], t)


_EDGE = None


def edge():
    global _EDGE
    if _EDGE is None:
        _EDGE = SiteEdge()
    return _EDGE


def terrain_y(x, z, use_edge=True):
    """The site's ground heightfield (what W1 meshes as `falls_ground` + the rock's top): canyon floor, rock column
    (cliff top, plateau with the gully, wooded flanks), blended to the seam heights within EDGE_BLEND of the box."""
    y = floor_y(x, z)
    top = column_top(x, z)
    if top is not None and top > y:
        y = top
        if top > TOP - 1.0:
            y = min(y, plateau_y(x, z))
    E = edge() if use_edge else None
    if E is not None and E.ok:
        b = SITE
        cands = (("n", z - b["minZ"], x), ("s", b["maxZ"] - z, x), ("w", x - b["minX"], z), ("e", b["maxX"] - x, z))
        # each side's seam height at the projection, weighted by inverse distance (the side a point lies on wins
        # outright), faded in over EDGE_BLEND
        ws, acc, keep = 0.0, 0.0, 1.0
        for side, dist, t in cands:
            w = smooth(EDGE_BLEND, 0.0, dist)
            if w > 0:
                iw = w / (max(dist, 0.0) + 1e-9) ** 2
                ws += iw
                acc += iw * E.height(side, t)
                keep *= (1.0 - w)
        if ws > 0:
            y = y * keep + (acc / ws) * (1.0 - keep)
        # W6: the pocket stays the walk level 0 where the seam blend reaches into it (the village's pocket ramp is
        # 0.13 m at its corners); faded out over the last 0.5 m to the box so the seam heights still hold there
        inside = smooth(0.4, 0.0, _box_dist(x, z, POCKET))
        if inside > 0.0:
            y *= 1.0 - inside * smooth(0.0, 0.5, b["maxX"] - x)
    return y


def is_cliff_cell(x, z, cell=1.0):
    """True where the ground is a steep rock face that W1 covers with the hi-res face mesh instead of terrain."""
    if not (FACE_Z[0] <= z <= FACE_Z[1]):
        return False
    ys = [terrain_y(x + dx, z + dz) for dx in (0.0, cell) for dz in (0.0, cell)]
    return max(ys) - min(ys) > 1.4 * cell and smooth(FLANK_FULL, FLANK_START, abs(z - FZ)) > 0.0


# ============================================================================================ contract ==

GLB_NAMES = {
    "falls_rock_lod0": "cliff, M_falls_rock (UV2 lightmap; vertex colour R moss, G wet, B streaks)",
    "falls_rock_lod1": "cliff far LOD",
    "inst__falls_rock_k": "rock kit instances, k = 0..5",
    "falls_ground": "site ground, banks, gravel (M_falls_ground)",
    "falls_slab_n": "the 4 slabs (M_falls_slab), ids = layout slabs[].id",
    "falls_seat_n|s": "the 2 seat stones (M_falls_slab), ids = layout seats[].id",
    "W_falls_plunge_n": "plunge ribbons (M_falls_water; COLOR_0 R air, G speed, B edge)",
    "W_falls_cascade": "upper cascade film (M_falls_cascade; COLOR_0 RG flow dir, B ledge)",
    "W_falls_pool": "pool surface (M_water; COLOR_0 = depth)",
    "W_falls_foam": "foam mound (M_falls_foam)",
    "W_falls_outlet": "outlet stream in the site (M_water)",
    "veg__falls_*": "vegetation clumps (M_leaf_green)",
    "marker__falls_impact": "impact point (spray, ripples, sound)",
    "marker__falls_lip": "plunge lip",
    "light__falls_lamp_n": "night lamps (layout lamps[], warm 2700 K, baked into the night lightmap only)",
}


def contract():
    lipx = LIP["x"]
    plunge = [dict(x=round(x, 4), y=round(y, 4), z=z, t=round(t, 4)) for (x, y, z, t) in plunge_path(24)]
    casc = [dict(x=round(x, 3), y=round(y, 3), z=round(z, 3)) for (x, y, z) in cascade_path(0.5)]
    prof = [dict(y=round(y, 2), x=round(face_x(LIP["z"], y), 3)) for y in [FACE_Y[0] + 0.5 * k for k in range(int((FACE_Y[1] - FACE_Y[0]) / 0.5) + 1)]]
    rows = []
    for zz in range(int(SITE["minZ"]), int(SITE["maxZ"]) + 1, 2):
        rows.append(dict(z=zz, x_at_y0=round(face_x(zz, 0.0), 3), x_at_ledge=round(face_x(zz, LEDGE), 3), x_at_top=round(face_x(zz, TOP), 3)))
    return {
        "format": "caysonverse-falls-contract",
        "version": 1,
        "locked": "2026-11-16 (W0)",
        "axes": "game space, metres: x east, z south, y up; Blender = (x, -z, y)",
        "source": "art/village/tools/falls_shape.py (copy: docs/designs/waterfall/tools/falls_shape.py); positions from shared villageLayout.ts backdrop.waterfall",
        "layout": WF,
        "heights": {"top": TOP, "ledge": LEDGE, "plateau": PLATEAU_Y, "waterY": WATER_Y,
                    "cascadeLedges": list(CASCADE_LEDGES), "upperCascade": [TOP, LEDGE], "freeFall": LEDGE - WATER_Y},
        "cliff": {"faceZ": list(FACE_Z), "faceY": list(FACE_Y), "bareRockHalfWidth": FLANK_START, "woodedFromHalfWidth": FLANK_FULL,
                  "alcove": {"depth": ALCOVE_DEPTH, "halfWidth": ALCOVE_HALF}, "lipProtrude": LIP_PROTRUDE,
                  "sheet": {"every": SHEET, "step": SHEET_STEP}, "concavity": CONCAVE, "benches": [list(b) for b in BENCHES],
                  "blockRelief": BLOCK_RELIEF, "crackDepth": CRACK_DEPTH,
                  "profileAtLip": prof, "faceByZ": rows},
        "channel": {"zAtLip": LIP["z"], "zTop": CHANNEL_Z_TOP, "depth": CHANNEL_DEPTH, "gaussHalfWidth": CHANNEL_HALF,
                    "wettedWidth": [channel_width(TOP), channel_width(LEDGE)], "tread": CASCADE_TREAD, "lean": CASCADE_LEAN,
                    "floor": casc},
        "plunge": {"speed": PLUNGE_SPEED, "fallSeconds": round(plunge[-1]["t"], 4), "width": [plunge_width(0), plunge_width(1)],
                   "sideStrands": [dict(st, path=[dict(x=round(x, 4), y=round(y, 4), z=z, t=round(t, 4)) for (x, y, z, t) in plunge_path(12, st["speed"], LIP["z"] + st["dz"])]) for st in SIDE_STRANDS],
                   "path": plunge, "impactComputed": {"x": round(plunge[-1]["x"], 4), "y": WATER_Y, "z": LIP["z"]},
                   "lipX": lipx},
        "pool": dict(POOL, bedYCentre=round(pool_bed_y(POOL_CX, POOL_CZ), 4), keepOutRadii=[POOL_RX + POOL["keepOut"], POOL_RZ + POOL["keepOut"]],
                     shoreRise="ground climbs from waterY at the waterline to 0 at keepOut m out"),
        "outlet": OUTLET,
        "site": SITE,
        "seam": {"file": "art/village/work/waterfall_site_edge.json", "spacing": EDGE_SPACING,
                 "order": "CCW from the north-west corner: north edge W->E, east N->S, south E->W, west S->N",
                 "count": len(site_edge_points()), "blend": EDGE_BLEND,
                 "pocketRule": "village ground = 0 inside the pocket, back to its own height 2 m outside (pocket_flatten)"},
        "walk": {"surfaceY": 0.0, "pocket": POCKET, "entry": ENTRY,
                 "rule": "walk_surface_ok(): in the pocket; outside the pool waterline + keepOut unless on a slab; clear of the outlet",
                 "slabs": SLABS, "seats": SEATS, "cameraWall": CAMERA_WALL},
        "lamps": {"spots": LAMPS, "colourK": 2700, "colour": "#FFB46B", "reach": 10.0, "bakedOnly": True},
        "spray": {"centre": IMPACT, "lip": LIP, "mistRise": [3.0, 6.0], "mistDrift": "east (+x)",
                  "rainbow": {"tier": OPTIONS["rainbowTier"], "hours": OPTIONS["rainbowHours"]}},
        "options": OPTIONS,
        "glbNames": GLB_NAMES,
    }


# ============================================================================================== checks ==

def check(verbose=True):
    fails = []

    def ok(cond, msg):
        if not cond:
            fails.append(msg)
        elif verbose:
            print("ok  ", msg)

    # 1. the lip is where the layout says, and it sticks out (water leaves the rock cleanly)
    ok(abs(face_x(LIP["z"], LIP["y"]) - LIP["x"]) < 1e-9, f"face at the lip = layout lip x {LIP['x']}")
    ok(all(face_x(LIP["z"], LIP["y"] - d) < LIP["x"] - 0.4 for d in (1.5, 3.0, 6.0, 10.0, 16.0)),
       "under the lip the rock is >= 0.4 m behind it (overhang + alcove)")
    # 2. the plunge parabola ends at the layout's impact, inside the pool, and clears the rock all the way down
    path = plunge_path(60)
    ix = path[-1][0]
    ok(abs(ix - IMPACT["x"]) < 0.01 and abs(path[-1][1] - IMPACT["y"]) < 1e-9, f"plunge meets the pool at x {ix:.3f} (layout {IMPACT['x']})")
    ok(pool_q(IMPACT["x"], IMPACT["z"]) < 0.5, "impact well inside the pool")
    ok(all(px - face_x(pz, py) > 0.25 for (px, py, pz, _) in path if py < LEDGE - 0.5), "the plunge clears the rock face by > 0.25 m")
    for st in SIDE_STRANDS:
        sp = plunge_path(40, st["speed"], LIP["z"] + st["dz"])
        m = min(px - face_x(pz, py) for (px, py, pz, _) in sp if py < LEDGE - 0.5)
        ok(m > 0.1, f"side strand dz {st['dz']} clears the rock (min {m:.2f} m)")
    # 3. the upper cascade: floor continuous, always below-and-behind going up, inside the groove
    casc = cascade_path(0.25)
    ok(all(b[0] <= a[0] + 0.35 for a, b in zip(casc[1:], casc[:-1])), "cascade floor never overhangs by > 0.35 m going down")
    shelf = max(c2[0] - c[0] for c, c2 in zip(casc[:-1], casc[1:]))  # going down: how far a tread steps out
    ok(shelf < 3.5, f"cascade treads (the basin shelf above the lip included) step out < 3.5 m (max {shelf:.2f})")
    top_x = face_x(CHANNEL_Z_TOP, TOP)
    rim_x = face_x(CHANNEL_Z_TOP + 6.0, TOP)
    ok(top_x < rim_x - 1.0, f"the groove is cut into the rim at the top ({top_x:.2f} behind {rim_x:.2f})")
    # 4. the pool
    ok(abs(pool_bed_y(POOL_CX, POOL_CZ) - (WATER_Y - POOL["depth"])) < 1e-6, "pool depth 2.2 m in the middle")
    ok(abs((WATER_Y - pool_bed_y(POOL_CX + POOL_RX - 1.0, POOL_CZ)) - POOL["edgeDepth"]) < 0.02, "pool 0.3 m deep 1 m inside the waterline")
    # 5. the walk pocket: flat, rock-free, reachable from the entry
    bad, n = [], 0
    xs = [POCKET["minX"] + 0.25 * i for i in range(int((POCKET["maxX"] - POCKET["minX"]) / 0.25) + 1)]
    zs = [POCKET["minZ"] + 0.25 * j for j in range(int((POCKET["maxZ"] - POCKET["minZ"]) / 0.25) + 1)]
    for x in xs:
        for z in zs:
            if walk_surface_ok(x, z) and x <= SITE["maxX"]:
                n += 1
                y = terrain_y(x, z)
                s = slab_at(x, z)
                if s is None and abs(y) > 0.06:
                    bad.append((x, z, round(y, 3)))
    ok(n > 400 and not bad, f"pocket ground (inside the site) is the walk level 0 +-0.06 at {n} sample points {bad[:4]}")
    ok(all(face_x(z, y) < POCKET["minX"] - 4.0 for z in zs for y in (0.0, 1.0, 2.2)), "no rock reaches into the pocket below head height")
    ok(all(walk_surface_ok(ENTRY["x"] - 0.5, z) for z in [ENTRY["minZ"] + 0.5 * k for k in range(int((ENTRY["maxZ"] - ENTRY["minZ"]) / 0.5) + 1)]),
       "the whole entry is walkable")
    # 6. slabs, seats, lamps
    for s in SLABS:
        c = s["centre"]
        ok(in_box(c["x"], c["z"], POCKET) and in_box(c["x"], c["z"], SITE) and 0.0 <= s["top"] <= 0.06,
           f"{s['id']}: in the pocket and the site, top {s['top']} at the walk level")
        ok(pool_signed_dist(c["x"] + s["radiusX"] * 0.5, c["z"]) > 0.0, f"{s['id']}: its east half is on the shore")
    front = min(SLABS, key=lambda s: s["centre"]["x"] - s["radiusX"])
    fx = front["centre"]["x"] - front["radiusX"] * math.cos(front["yaw"])
    ok(-104.9 <= fx <= -104.2, f"front slab's lip at x {fx:.2f} (design: ~ -104.5 = the water's edge)")
    ok(pool_q(fx + 0.1, front["centre"]["z"]) < 1.0, "the front slab overhangs the water")
    for s in SEATS:
        c, sz = s["centre"], s["size"]
        corners = [(c["x"] + sx * sz["x"] / 2, c["z"] + sz_ * sz["z"] / 2) for sx in (-1, 1) for sz_ in (-1, 1)]
        ok(all(in_box(x, z, POCKET) and in_box(x, z, SITE) for x, z in corners), f"{s['id']}: inside the pocket and the site")
        ok(all(pool_signed_dist(x - 0.9, z) > POOL["keepOut"] for x, z in corners), f"{s['id']}: room to stand west of it, clear of the keep-out")
        ok(all(slab_at(x, z) is None for x, z in corners) and all(slab_at(c["x"], c["z"] + t) is None for t in (-0.9, 0, 0.9)),
           f"{s['id']}: not on a slab")
        ok(c["x"] + sz["x"] / 2 + 0.9 <= POCKET["maxX"], f"{s['id']}: room to stand east of it")
    for lp in LAMPS:
        sd = pool_signed_dist(lp["x"], lp["z"])
        ok(0.0 < sd < POOL["keepOut"] + 0.25, f"lamp ({lp['x']}, {lp['z']}) on the shore stones ({sd:.2f} m from the waterline)")
    ok(len(LAMPS) == OPTIONS["nightLamps"] == 2, "2 night lamps")
    # 7. the camera wall: the cliff and flanks below 22 m stay >= 0.5 m west of it (W1's rock kit must too)
    ok(CAMERA_WALL[0]["z"] <= FACE_Z[0] and CAMERA_WALL[-1]["z"] >= FACE_Z[1] and all(b["z"] > a["z"] for a, b in zip(CAMERA_WALL[:-1], CAMERA_WALL[1:])),
       "camera wall runs north to south over the whole hi-res face")
    worst = min(camera_wall_x(z) - face_x(z, y) for z in [FACE_Z[0] + 0.5 * k for k in range(int((FACE_Z[1] - FACE_Z[0]) / 0.5) + 1)]
                for y in [-0.5 + 0.25 * k for k in range(91)])
    ok(worst >= 0.4, f"rock face stays west of the camera wall (closest {worst:.2f} m)")
    ok(all(camera_wall_x(z) < POCKET["minX"] - 3.0 for z in [POCKET["minZ"] + k for k in range(int(POCKET["maxZ"] - POCKET["minZ"]) + 1)]),
       "the camera wall leaves >= 3 m behind the pocket for the camera")
    # 8. the outlet and the seam
    pts = OUTLET["points"]
    ok(pool_q(pts[0]["x"], pts[0]["z"]) < 1.0 and abs(pts[-1]["z"] - SITE["maxZ"]) < 1e-9, "outlet starts in the pool and leaves at the site's south edge")
    ok(OUTLET["waterY"][0] == WATER_Y and OUTLET["waterY"][1] <= OUTLET["waterY"][0], "outlet water runs downhill from the pool level")
    ok(all(walk_surface_ok(x, POCKET["maxZ"] - 0.3) or pool_signed_dist(x, POCKET["maxZ"] - 0.3) < POOL["keepOut"] or x > SITE["maxX"]
           for x in xs), "the outlet stays out of the pocket")
    E = edge()
    if E.ok:
        err = max(abs(terrain_y(x, z) - E.height(*(("n", x) if abs(z - SITE["minZ"]) < 1e-9 else ("s", x) if abs(z - SITE["maxZ"]) < 1e-9
                                                  else ("w", z) if abs(x - SITE["minX"]) < 1e-9 else ("e", z))))
                  for x, z in site_edge_points(4.0))
        ok(err < 1e-6, f"terrain meets the seam heights exactly on the box ({E.path})")
    else:
        print("skip seam check: no waterfall_site_edge.json (run the --edge-provisional Blender step)")
    ok(len(site_edge_points()) == 2 * int((SITE["maxX"] - SITE["minX"]) + (SITE["maxZ"] - SITE["minZ"])), "seam: one point per metre, corners once")
    if fails:
        print("\nFAILED:")
        for f in fails:
            print("  ", f)
    return not fails


# ======================================================================================= blender step ==

def write_provisional_edge(out_path=None):
    """Inside Blender: sample the CURRENT village terrain (parts_nature.terrain_h) on the hole outline, apply the
    pocket rule, and write the seam file. W6's rebuild replaces it with the same format from the new village."""
    sys.path.insert(0, HERE)
    os.environ.setdefault("CV_LAYOUT", LAYOUT_PATH)
    import parts_nature as PN  # noqa: E402  (bpy, mathutils)
    out_path = out_path or EDGE_FILE_DEFAULT
    pts = []
    for x, z in site_edge_points():
        pts.append({"x": x, "z": z, "y": round(pocket_flatten(x, z, PN.terrain_h(x, z)), 4)})
    data = {"format": "caysonverse-falls-site-edge", "version": 1, "provisional": True,
            "note": "village ground heights on the waterfall site box; written by falls_shape.py --edge-provisional "
                    "(current terrain_h + pocket rule). The village rebuild (W6) writes the final file, same format.",
            "site": SITE, "spacing": EDGE_SPACING, "order": "CCW from the north-west corner", "points": pts}
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1)
    print("wrote", out_path, len(pts), "points")
    return out_path


def compute_camera_wall(step=2.0, margin=0.5, y_max=22.0):
    """The camera wall from the locked face: per z (FACE_Z, every `step` m), the face's most eastern x over
    y -0.5..y_max within +-1 m of z, plus `margin`, rounded up to 0.1 m. Paste into villageLayout.ts (cameraWall)."""
    out = []
    z = FACE_Z[0]
    while z <= FACE_Z[1] + 1e-9:
        m = max(face_x(z + dz, y) for dz in (-1.0, -0.5, 0.0, 0.5, 1.0) for y in [-0.5 + 0.25 * k for k in range(int((y_max + 0.5) / 0.25) + 1)])
        out.append({"x": math.ceil((m + margin) * 10 - 1e-9) / 10, "z": z})
        z += step
    return out


def main(argv):
    if "--camera-wall" in argv:
        for p in compute_camera_wall():
            print(f"          pt({p['x']:g}, {p['z']:g}),")
    if "--edge-provisional" in argv:
        i = argv.index("--edge-provisional")
        write_provisional_edge(argv[i + 1] if len(argv) > i + 1 and not argv[i + 1].startswith("--") else None)
    if "--export-contract" in argv:
        out = argv[argv.index("--export-contract") + 1]
        with open(out, "w", encoding="utf-8") as f:
            json.dump(contract(), f, indent=1, ensure_ascii=False)
            f.write("\n")
        print("wrote", out)
    if "--check" in argv:
        sys.exit(0 if check() else 1)


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
