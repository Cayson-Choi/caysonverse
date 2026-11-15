"""Textures for the village (system Python: numpy + PIL + scipy). Everything here is either a CC0 Poly Haven
texture (downloads/tex, downloads/leaves, downloads/hdri) resampled/tinted, or drawn procedurally by this script.

  python art/village/tools/make_textures.py [name ...]      # default: all

Writes art/village/work/tex/*.png:
  T_plaza.png      2048^2  albedo of the plaza + ring road disc, x,z in [-PLAZA_HALF, PLAZA_HALF] (top view, +x right,
                           +z (south) down): radial granite paving, fountain surround, verge, asphalt with edge lines and
                           crosswalks, kerbs, sidewalk pavers, lanes, grass beyond.
  T_lawn.png       1024^2  an 18 x 18 m mowed lawn with stripes (plots).
  T_leaf_green.png 1024^2  RGBA 2x2 leaf-cluster cards (island_tree_01 leaf sprites, CC0) for tree canopies / shrubs.
  T_leaf_cherry.png 1024^2 RGBA 2x2 cherry blossom cluster cards (procedural petals + leaf sprites).
  T_flora.png      1024^2  RGBA 4 rows: flower strips (pink, yellow, purple) and reeds / grass.
  T_atlas.png      2048^2  details atlas (windows, glass, doors, bus, awning, banners, moon, flat colour cells).
  T_water.png      1024^2  RGBA water: left half pool/creek surface, right half foam/jets.
  T_sky.png        2048x1024 sky dome (equirect, elevation -10..90 deg) from the CC0 HDRI.
Plus copies of the Poly Haven tiling textures used as-is (grass, stone, ...), resized to 1024.
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DL = os.path.join(ROOT, "downloads")
OUT = os.path.join(ROOT, "work", "tex")
LAYOUT = json.load(open(os.path.join(ROOT, "layout.json"), encoding="utf-8"))
os.makedirs(OUT, exist_ok=True)
RNG = np.random.default_rng(7)

PLAZA_HALF = 40.0          # T_plaza covers [-40, 40] m
GRASS_TILE = 3.0           # LM_grass world tiling (m per texture repeat): T_plaza samples grass the same way
TILES = {
    # export name: (Poly Haven diffuse file, world metres per repeat, brightness, saturation)
    "grass": ("leafy_grass_diff_1k.jpg", GRASS_TILE, 1.08, 1.12),
    "stone": ("rock_boulder_dry_diff_1k.jpg", 1.6, 1.10, 0.55),
    "concrete": ("asphalt_04_diff_1k.jpg", 3.0, 1.06, 0.6),
    "render": ("white_plaster_02_diff_1k.jpg", 2.5, 1.38, 0.18),
    "wood": ("wood_planks_diff_1k.jpg", 2.0, 1.0, 1.0),
    "roof": ("roof_slates_02_diff_1k.jpg", 2.0, 1.0, 0.6),
    "rock": ("rock_boulder_dry_diff_1k.jpg", 3.0, 1.0, 0.8),
    "wall": ("stone_wall_diff_1k.jpg", 2.4, 1.12, 0.8),
    "asphalt": ("clean_asphalt_diff_1k.jpg", 4.0, 1.25, 0.5),
    "pavers": ("concrete_pavers_diff_1k.jpg", 2.0, 1.15, 0.35),
}


def grass_tex(bright=1.0):
    """leafy_grass is brown-green: regrade it toward a lush, mown-lawn green while keeping its detail."""
    g = load(TILES["grass"][0], 1024)
    L = g @ np.array([0.30, 0.55, 0.15])
    L = L / L.mean()
    green = np.array([0.31, 0.44, 0.17]) * bright
    out = green[None, None] * (0.55 + 0.45 * L[..., None]) * 0.8 + g * 0.2 * np.array([0.8, 1.0, 0.7])
    return np.clip(out, 0, 1)


def load(name, size=None):
    p = os.path.join(DL, "tex", name)
    im = Image.open(p).convert("RGB")
    if size:
        im = im.resize((size, size), Image.LANCZOS)
    return np.asarray(im, np.float32) / 255.0


def save(a, name, mode=None):
    a = np.clip(a, 0, 1)
    im = Image.fromarray((a * 255 + 0.5).astype(np.uint8), mode)
    im.save(os.path.join(OUT, name))
    print("wrote", name, im.size)


def adjust(a, bright=1.0, sat=1.0):
    g = a.mean(-1, keepdims=True)
    return np.clip((g + (a - g) * sat) * bright, 0, 1)


def sample(tex, x, y, tile):
    """Bilinear-free nearest sample of a tiling texture at world coords (metres)."""
    h, w, _ = tex.shape
    u = ((x / tile) % 1.0) * w
    v = ((y / tile) % 1.0) * h
    return tex[v.astype(int) % h, u.astype(int) % w]


def hash01(*ints):
    h = np.uint64(1469598103934665603)
    out = np.full(np.shape(ints[0]), h, dtype=np.uint64)
    for i in ints:
        out ^= np.asarray(i).astype(np.int64).astype(np.uint64) + np.uint64(0x9E3779B97F4A7C15)
        out *= np.uint64(1099511628211)
        out ^= out >> np.uint64(29)
    return (out % np.uint64(10007)).astype(np.float64) / 10007.0


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def fbm(shape, scale, octaves=4, seed=0):
    """Smooth value noise in [0,1] (zoom of random grids)."""
    rng = np.random.default_rng(seed)
    h, w = shape
    acc = np.zeros(shape, np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        n = max(2, int(scale * 2 ** o))
        g = rng.random((n + 1, n + 1)).astype(np.float32)
        z = ndimage.zoom(g, (h / n, w / n), order=3)[:h, :w]
        acc += amp * z
        tot += amp
        amp *= 0.5
    return np.clip(acc / tot, 0, 1)


# ----------------------------------------------------------------------------------------- tiling copies --

def tiles():
    small = {"render", "concrete", "rock", "wall", "asphalt", "pavers"}
    for k, (f, _tile, b, s) in TILES.items():
        a = grass_tex() if k == "grass" else adjust(load(f, 1024), b, s)
        if k == "render":
            # clean white render: keep the fine grain, drop the dark blotches (contrast 0.35 around a near-white mean)
            a = np.clip((a - a.mean((0, 1))) * 0.35 + np.array([0.90, 0.89, 0.86]), 0, 1)
        if k in small:
            a = np.asarray(Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).resize((512, 512), Image.LANCZOS),
                           np.float32) / 255.0
        save(a, f"T_{k}.png")
    # bark atlas: left half sakura, right half zelkova (u wraps once around a trunk inside its half)
    sak = adjust(load("sakura_bark_diff_1k.jpg", 1024), 1.05, 0.8)
    zel = adjust(load("japanese_zelkova_bark_diff_1k.jpg", 1024), 1.0, 0.8)
    bark = np.concatenate([sak[::2, ::4], zel[::2, ::4]], axis=1)
    save(bark, "T_bark.png")


# ------------------------------------------------------------------------------------------------ plaza --

def lane_mask(X, Z, width_pad=0.0):
    """Distance to the nearest lane centreline minus its half width (<0 inside a lane)."""
    d = np.full(X.shape, 1e9, np.float32)
    for lane in LAYOUT["lanes"]:
        pts = lane["points"]
        hw = lane["width"] / 2 + width_pad
        for a, b in zip(pts[:-1], pts[1:]):
            ax, az, bx, bz = a["x"], a["z"], b["x"], b["z"]
            dx, dz = bx - ax, bz - az
            L2 = dx * dx + dz * dz
            t = np.clip(((X - ax) * dx + (Z - az) * dz) / L2, 0, 1)
            px, pz = ax + t * dx, az + t * dz
            dd = np.hypot(X - px, Z - pz) - hw
            d = np.minimum(d, dd)
    return d


def lane_dirs():
    """(angle of each lane where it leaves the paving, half-width) for the crosswalks."""
    out = []
    for lane in LAYOUT["lanes"]:
        a = lane["points"][0]
        out.append((math.atan2(a["z"], a["x"]), lane["width"] / 2, lane["id"]))
    return out


# ---- crosswalks (xwalk fix 2026-11-13): ONE straight zebra per crossing, perpendicular to the ring road ------------------
XW_RING_R = 34.0           # the ring road's middle (road 31..37)
XW_WIDTH = 4.0             # along the road (bar length): the 4 m minimum of the traffic-marking rules
XW_BAR = 0.5               # bar width (45-50 cm), each bar parallel to the traffic, bars stacked across the road
XW_GAP = 0.55              # gap between bars
XW_BARS = 5                # 5 bars + 4 gaps = 4.7 m of the road's 6 m, 0.65 m clear of each kerb
XW_GAP_PAD = 0.3           # edge / centre lines break this far beyond the crosswalk's ends
# review r3 (2026-11-13): lane_plot_e meets the ring 8 m south of the signalised crossing (lane_bus), right where the bus
# stands at the stop line waiting for its green; a real road has no unsignalised crosswalk next to a signalised one, and no
# vehicle waits on one. Its walkers use the signalised crossing (plaza -> lane_bus zebra -> sidewalk), so it gets none.
XW_SKIP = {"lane_plot_e"}


def crossings():
    """[(id, angle, half)] where each lane's first leg crosses the ring road's middle (R = 34). The crosswalk is centred
    there and runs along the radial direction (perpendicular to the road, never along the lane's own direction: that was
    what made two bands cross each other in a V where an oblique lane meets the curve)."""
    out = []
    for lane in LAYOUT["lanes"]:
        if lane["id"] in XW_SKIP:
            continue
        a, b = lane["points"][0], lane["points"][1]
        dx, dz = b["x"] - a["x"], b["z"] - a["z"]
        A = dx * dx + dz * dz
        B = 2 * (a["x"] * dx + a["z"] * dz)
        C = a["x"] ** 2 + a["z"] ** 2 - XW_RING_R ** 2
        t = (-B + math.sqrt(B * B - 4 * A * C)) / (2 * A)
        px, pz = a["x"] + t * dx, a["z"] + t * dz
        out.append((lane["id"], math.atan2(pz, px), XW_WIDTH / 2))
    return out


def crosswalk_mask(X, Z, px_m, sub=3):
    """Anti-aliased coverage of every crosswalk's bars (polar: bars are arcs, parallel to the road's edge lines) and of the
    break the edge / centre lines make (|tangential| < half + pad)."""
    zebra = np.zeros(X.shape, np.float32)
    for _id, ang, half in crossings():
        for iy in range(sub):
            for ix in range(sub):
                xs = X + (ix + 0.5 - sub / 2) * px_m / sub
                zs = Z + (iy + 0.5 - sub / 2) * px_m / sub
                r = np.hypot(xs, zs)
                d = (np.arctan2(zs, xs) - ang + np.pi) % (2 * np.pi) - np.pi
                tang = d * XW_RING_R
                r0 = XW_RING_R - (XW_BARS * XW_BAR + (XW_BARS - 1) * XW_GAP) / 2
                u = r - r0
                k = np.floor(u / (XW_BAR + XW_GAP))
                inbar = (u >= 0) & (k < XW_BARS) & ((u - k * (XW_BAR + XW_GAP)) < XW_BAR)
                zebra += (inbar & (np.abs(tang) < half)).astype(np.float32) / (sub * sub)
    return zebra


def crosswalk_gap(X, Z):
    """True where the road's edge / centre lines must break for a crosswalk."""
    gap = np.zeros(X.shape, bool)
    r = np.hypot(X, Z)
    th = np.arctan2(Z, X)
    for _id, ang, half in crossings():
        d = (th - ang + np.pi) % (2 * np.pi) - np.pi
        gap |= (np.abs(d * XW_RING_R) < half + XW_GAP_PAD) & (r > 30.0) & (r < 38.0)
    return gap


def plaza():
    N = 2048
    px = 2 * PLAZA_HALF / N
    c = (np.arange(N) + 0.5) * px - PLAZA_HALF
    X, Z = np.meshgrid(c, c)            # row = z (south down), col = x
    R = np.hypot(X, Z)
    TH = np.arctan2(Z, X)
    granite = adjust(load("rock_boulder_dry_diff_1k.jpg", 1024), 1.0, 0.35)
    gmean = granite.mean((0, 1))
    granite = (granite - gmean) * 0.5 + np.array([0.86, 0.82, 0.77])      # light warm granite, contrast kept low
    asphalt = adjust(load("clean_asphalt_diff_1k.jpg", 1024), 1.0, 0.4)
    asphalt = (asphalt - asphalt.mean((0, 1))) * 1.6 + np.array([0.27, 0.27, 0.28])
    pavers = adjust(load("concrete_pavers_diff_1k.jpg", 1024), 1.0, 0.3)
    pavers = (pavers - pavers.mean((0, 1))) * 0.9 + np.array([0.66, 0.63, 0.59])
    grass = grass_tex()
    out = np.zeros((N, N, 3), np.float32)

    # --- radial paving r < 30: rings of setts; ring width 0.6, stone length ~0.9 m along the ring
    ring_w = 0.6
    ring = np.floor(R / ring_w)
    seg_n = np.maximum(8, np.round(2 * np.pi * (ring + 0.5) * ring_w / 0.9))
    seg = np.floor((TH + np.pi) / (2 * np.pi) * seg_n + 0.5 * (ring % 2))
    tone = hash01(ring, seg)
    g = sample(granite, X, Z, 1.6)
    stone = g * (0.93 + 0.12 * tone)[..., None]
    # joints: radial distance to ring edge, tangential distance to segment edge
    fr = R / ring_w - ring
    jr = np.minimum(fr, 1 - fr) * ring_w
    ft = (TH + np.pi) / (2 * np.pi) * seg_n + 0.5 * (ring % 2)
    ft = ft - np.floor(ft)
    jt = np.minimum(ft, 1 - ft) * (2 * np.pi * np.maximum(R, 0.1) / seg_n)
    joint = np.minimum(jr, jt)
    jfac = 1 - 0.30 * (1 - smoothstep(0.0, px * 0.9, joint))
    stone = stone * jfac[..., None]
    # accent: 16 radial spokes of warm darker granite from r 8 to 29.4, two darker bands
    spoke = np.abs(((TH + np.pi) / (2 * np.pi) * 16 + 0.5) % 1 - 0.5) * (2 * np.pi * R / 16)
    is_spoke = (spoke < 0.32) & (R > 8.6) & (R < 29.4)
    band = ((R > 12.6) & (R < 13.2)) | ((R > 21.0) & (R < 21.6)) | ((R > 29.4) & (R < 30.0))
    warm = np.array([0.80, 0.70, 0.62])
    dark = np.array([0.55, 0.52, 0.50])
    stone = np.where(is_spoke[..., None], stone * 0.72 + warm * 0.26, stone)
    # mosaic ring r 8.6..12.6: alternating warm / cool stones (reads from the overview as a rosette)
    mos = (R > 8.6) & (R < 12.6)
    alt = ((ring + seg) % 2) == 0
    stone = np.where((mos & alt)[..., None], stone * 0.78 + np.array([0.78, 0.66, 0.58]) * 0.2, stone)
    stone = np.where((mos & ~alt)[..., None], stone * 0.9 + np.array([0.70, 0.72, 0.76]) * 0.08, stone)
    stone = np.where(band[..., None], g * 0.3 + dark * 0.7 * (0.95 + 0.1 * tone)[..., None], stone)
    # fountain surround ring r 6..8: charcoal granite blocks
    sur_seg = np.floor((TH + np.pi) / (2 * np.pi) * 64)
    sur_ring = np.floor((R - 6.0) / 1.0)
    st2 = hash01(sur_seg, sur_ring + 50)
    sur = g * 0.30 + np.array([0.40, 0.38, 0.37]) * (0.9 + 0.2 * st2)[..., None]
    fs = (TH + np.pi) / (2 * np.pi) * 64
    fs = np.minimum(fs - np.floor(fs), 1 - (fs - np.floor(fs))) * (2 * np.pi * R / 64)
    fr2 = (R - 6.0) - np.floor(R - 6.0)
    sj = np.minimum(np.minimum(fr2, 1 - fr2), fs)
    sur = sur * (1 - 0.35 * (1 - smoothstep(0, px * 0.9, sj)))[..., None]
    stone = np.where(((R >= 6.0) & (R < 8.0))[..., None], sur, stone)
    out[:] = stone

    # --- verge 30..31: light kerb edge, grass strip, road kerb
    gr = sample(grass, X, Z, GRASS_TILE)
    verge = (R >= 30.0) & (R < 31.0)
    out = np.where(verge[..., None], gr, out)
    kerb_c = sample(granite, X, Z, 1.6) * 0.9
    out = np.where(((R >= 30.0) & (R < 30.22))[..., None], kerb_c, out)
    out = np.where(((R >= 30.84) & (R < 31.0))[..., None], kerb_c * 0.95, out)

    # --- road 31..37
    road = (R >= 31.0) & (R < 37.0)
    asp = sample(asphalt, X, Z, 4.0)
    wear = fbm((N, N), 24, 4, seed=3)
    asp = asp * (0.92 + 0.16 * wear)[..., None]
    # tyre polish in each lane (slightly lighter/darker streaks)
    for rc in (32.6, 35.4):
        asp = asp * (1 + 0.05 * np.exp(-((R - rc) / 0.45) ** 2))[..., None]
    out = np.where(road[..., None], asp, out)
    paint = np.array([0.93, 0.93, 0.90])
    paint_noise = 0.85 + 0.15 * fbm((N, N), 60, 2, seed=5)
    def put_paint(mask, col=paint, a=0.95):
        nonlocal out
        m = (mask * a * paint_noise)[..., None]
        out = out * (1 - m) + np.asarray(col) * m
    edge = ((R > 31.22) & (R < 31.38)) | ((R > 36.62) & (R < 36.78))
    # gaps in the edge lines where lanes cross (crosswalks take over)
    lm = lane_mask(X, Z, 0.4)
    xgap = crosswalk_gap(X, Z)
    put_paint(edge & ~xgap)
    # dashed centre line (3 m dash, 4 m gap); none through the bus bay, where the parked bus straddles it (bus review
    # r2: a dash's end stuck out from under the 9 m bus's rear bumper as a short yellow stub)
    # review r2 (2026-11-13): the parked bus moved to (34.1, -6.5), x 32.85..35.35, z -11..-2 (shared villageLayout.ts busStop);
    # layout.json here is older than that, so the box is fixed in this script
    bb = {"minX": 32.85, "maxX": 35.35, "minZ": -11.0, "maxZ": -2.0}
    bay_zone = (X > bb["minX"] - 0.5) & (X < bb["maxX"] + 0.5) & (Z > bb["minZ"] - 1.2) & (Z < bb["maxZ"] + 1.2)
    s_arc = (TH + np.pi) * 34.0
    centre = (np.abs(R - 34.0) < 0.075) & ((s_arc % 7.0) < 3.0) & (lm > 0.6) & ~bay_zone & ~xgap
    put_paint(centre, (0.95, 0.80, 0.25), 0.9)
    # crosswalks: one straight zebra per crossing (crosswalk_mask), perpendicular to the road; nothing else is painted
    put_paint(crosswalk_mask(X, Z, px) * road, paint, 0.92)
    # review r2: the yellow dashed bus-bay box is gone (the owner: only the crosswalks are painted on the road, besides the
    # edge and centre lines); the bus simply stops on the outer lane

    # --- kerb + sidewalk 37..39
    out = np.where(((R >= 37.0) & (R < 37.18))[..., None], kerb_c, out)
    sw = (R >= 37.18) & (R < 39.0)
    pv = sample(pavers, X, Z, 2.0) * (0.95 + 0.1 * fbm((N, N), 30, 3, seed=9))[..., None]
    out = np.where(sw[..., None], pv, out)
    out = np.where(((R >= 38.86) & (R < 39.0))[..., None], kerb_c * 0.9, out)

    # --- beyond 39: grass (same tiling as LM_grass, seamless with the outer ground)
    out = np.where((R >= 39.0)[..., None], gr, out)

    # --- lanes (concrete) outside the paving: on the verge, the sidewalk and beyond
    conc = adjust(load(TILES["concrete"][0], 1024), TILES["concrete"][2], TILES["concrete"][3])
    lc = sample(conc, X, Z, TILES["concrete"][1])
    lane_in = (lm < 0) & ((R >= 30.22) & (R < 30.84) | (R >= 39.0))
    out = np.where(lane_in[..., None], lc, out)
    edge_soft = (lm >= 0) & (lm < 0.25) & (R >= 39.0)
    out = np.where(edge_soft[..., None], out * 0.85 + lc * 0.15, out)

    # --- soft grime near kerbs and the fountain
    grime = np.exp(-((R - 37.1) / 0.25) ** 2) * 0.10 + np.exp(-((R - 30.9) / 0.2) ** 2) * 0.08
    grime += np.exp(-((R - 8.0) / 0.15) ** 2) * 0.1
    out = out * (1 - grime)[..., None]
    save(out, "T_plaza.png")


# ------------------------------------------------------------------------------------------------- lawn --

def lawn():
    N = 1024
    size = 18.0
    c = (np.arange(N) + 0.5) / N * size
    X, Z = np.meshgrid(c, c)
    grass = grass_tex(1.06)
    g = sample(grass, X, Z, GRASS_TILE)
    stripe = np.floor(X / 1.5) % 2
    soft = 0.5 + 0.5 * np.cos(np.pi * ((X / 1.5) % 1))
    k = 1 + np.where(stripe > 0, 0.07, -0.05) * (0.7 + 0.3 * soft)
    tint = np.where(stripe[..., None] > 0, np.array([1.0, 1.03, 0.94]), np.array([0.96, 1.0, 0.96]))
    a = g * k[..., None] * tint
    a = np.asarray(Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).resize((512, 512), Image.LANCZOS),
                   np.float32) / 255.0
    save(a, "T_lawn.png")


# ------------------------------------------------------------------------------------------ leaf cards --

def leaf_sprites():
    a = np.asarray(Image.open(os.path.join(DL, "leaves", "island_tree_01_leaves_alpha_1k.png")).convert("L"))
    d = np.asarray(Image.open(os.path.join(DL, "leaves", "island_tree_01_leaves_diff_1k.png")).convert("RGB"))
    lab, n = ndimage.label(a > 100)
    out = []
    for sl in ndimage.find_objects(lab):
        h = sl[0].stop - sl[0].start
        w = sl[1].stop - sl[1].start
        if h * w < 2000:
            continue
        fill = (lab[sl] > 0).mean()
        if fill > 0.82 or max(h, w) / min(h, w) < 1.5:
            continue                                          # rectangles / strips in the atlas, not leaves
        m = (lab[sl] == lab[sl][lab[sl] > 0][0])
        rgba = np.dstack([d[sl], np.where(lab[sl] > 0, a[sl], 0)]).astype(np.uint8)
        im = Image.fromarray(rgba, "RGBA")
        if w > h:
            im = im.rotate(90, expand=True)
        out.append(im)
    print("leaf sprites:", len(out))
    return out


def tint_sprite(im, mul):
    a = np.asarray(im, np.float32)
    a[..., :3] = np.clip(a[..., :3] * np.asarray(mul)[None, None, :], 0, 255)
    return Image.fromarray(a.astype(np.uint8), "RGBA")


def cluster_card(size, sprites, n_leaves, leaf_px, palette, seed, twig=(78, 60, 44), blossoms=0, petal=None, blob=False):
    """One leaf cluster on a transparent card: twigs from the bottom centre, leaves (and blossoms) around their tips,
    back layers darker. Drawn at 2x and downsampled."""
    S = size * 2
    rng = np.random.default_rng(seed)
    card = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    dr = ImageDraw.Draw(card)
    # twig skeleton
    tips = []
    def branch(x, y, ang, length, width, depth):
        x2 = x + math.cos(ang) * length
        y2 = y - math.sin(ang) * length
        dr.line((x, y, x2, y2), fill=twig + (255,), width=max(1, int(width)))
        if depth == 0:
            tips.append((x2, y2))
            return
        for k in range(2 if depth > 1 else 3):
            branch(x2, y2, ang + rng.uniform(-0.75, 0.75), length * rng.uniform(0.55, 0.75), width * 0.65, depth - 1)
    if not blob:
        for _ in range(3):
            branch(S * 0.5 + rng.uniform(-S * 0.05, S * 0.05), S * 0.98, math.pi / 2 + rng.uniform(-0.5, 0.5), S * 0.28,
                   S * 0.012, 3)
    # leaves: placed around tips and along the canopy ellipse, sorted back to front (darker first)
    pts = []
    for i in range(n_leaves):
        if blob:
            # a soft round mass: dense centre, feathered edge (radius ~ sqrt for even fill, a few strays outside)
            ang = rng.uniform(0, 2 * math.pi)
            rr = 0.44 * (rng.random() ** 0.62) * (1.0 + 0.12 * math.sin(3 * ang + seed))
            x, y = S * (0.5 + rr * math.cos(ang)), S * (0.5 + rr * 0.92 * math.sin(ang))
            depth = 1.0 - rr / 0.5 * 0.6 + rng.uniform(-0.25, 0.25)
            pts.append((depth, x, y))
            continue
        if rng.random() < 0.7 and tips:
            tx, ty = tips[rng.integers(len(tips))]
            r = rng.normal(0, S * 0.08)
            ang = rng.uniform(0, 2 * math.pi)
            x, y = tx + r * math.cos(ang), ty + r * math.sin(ang)
        else:
            ang = rng.uniform(0, 2 * math.pi)
            rr = math.sqrt(rng.random()) * 0.42
            x, y = S * (0.5 + rr * math.cos(ang)), S * (0.47 + rr * 0.9 * math.sin(ang))
        depth = rng.random()
        pts.append((depth, x, y))
    pts.sort()
    for depth, x, y in pts:
        if blossoms and rng.random() < blossoms:
            r = leaf_px * rng.uniform(0.35, 0.55) * 2
            col = petal[rng.integers(len(petal))]
            shade = 0.88 + 0.16 * depth
            draw_blossom(dr, x, y, r, col, shade, rng)
            continue
        sp = sprites[rng.integers(len(sprites))]
        L = leaf_px * rng.uniform(0.75, 1.25) * 2
        k = L / max(sp.size)
        im = sp.resize((max(2, int(sp.size[0] * k)), max(2, int(sp.size[1] * k))), Image.BILINEAR)
        im = im.rotate(rng.uniform(0, 360), expand=True, resample=Image.BILINEAR)
        base = palette[rng.integers(len(palette))]
        shade = 0.62 + 0.45 * depth
        im = tint_sprite(im, [base[0] * shade, base[1] * shade, base[2] * shade])
        card.alpha_composite(im, (int(x - im.size[0] / 2), int(y - im.size[1] / 2)))
    card = card.resize((size, size), Image.LANCZOS)
    return card


def draw_blossom(dr, x, y, r, col, shade, rng):
    rot = rng.uniform(0, 2 * math.pi)
    c = tuple(int(min(255, v * shade)) for v in col)
    for k in range(5):
        a = rot + k * 2 * math.pi / 5
        px, py = x + math.cos(a) * r * 0.55, y + math.sin(a) * r * 0.55
        dr.ellipse((px - r * 0.5, py - r * 0.5, px + r * 0.5, py + r * 0.5), fill=c + (255,))
    cc = (min(255, int(c[0] * 0.92)), int(c[1] * 0.62), int(c[2] * 0.72))
    dr.ellipse((x - r * 0.22, y - r * 0.22, x + r * 0.22, y + r * 0.22), fill=cc + (255,))
    dr.ellipse((x - r * 0.08, y - r * 0.08, x + r * 0.08, y + r * 0.08), fill=(235, 200, 90, 255))


def leaves():
    sprites = leaf_sprites()
    green = [(0.62, 0.86, 0.42), (0.55, 0.80, 0.38), (0.70, 0.92, 0.48), (0.50, 0.72, 0.36), (0.78, 0.95, 0.50)]
    atlas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    for i in range(4):
        c = cluster_card(512, sprites, 1300, 26, green, seed=11 + i)
        atlas.alpha_composite(c, ((i % 2) * 512, (i // 2) * 512))
    atlas = fill_rgb(atlas)
    atlas.save(os.path.join(OUT, "T_leaf_green.png"))
    print("wrote T_leaf_green.png")
    pinks = [(244, 194, 210), (247, 168, 196), (245, 180, 203), (250, 206, 220), (255, 226, 234), (247, 188, 208)]
    leafc = [(0.66, 0.70, 0.42), (0.72, 0.62, 0.40)]
    atlas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    for i in range(3):
        c = cluster_card(512, sprites, 4200, 12, leafc, seed=31 + i, twig=(92, 64, 54), blossoms=0.97, petal=pinks,
                         blob=True)
        atlas.alpha_composite(c, ((i % 2) * 512, (i // 2) * 512))
    # quadrant 3: fallen petals scattered on the ground (dense in the middle, sparse at the edges)
    S2 = 1024
    pet = Image.new("RGBA", (S2, S2), (0, 0, 0, 0))
    dr = ImageDraw.Draw(pet)
    rng = np.random.default_rng(77)
    for i in range(2600):
        rr = abs(rng.normal(0, 0.24)) * S2
        a = rng.uniform(0, 2 * math.pi)
        x, y = S2 / 2 + math.cos(a) * rr, S2 / 2 + math.sin(a) * rr
        if not (8 < x < S2 - 8 and 8 < y < S2 - 8):
            continue
        r = rng.uniform(5, 9)
        col = pinks[rng.integers(len(pinks))]
        sh = rng.uniform(0.9, 1.05)
        dr.ellipse((x - r, y - r * 0.6, x + r, y + r * 0.6), fill=tuple(int(min(255, v * sh)) for v in col) + (255,))
    atlas.alpha_composite(pet.resize((512, 512), Image.LANCZOS), (512, 512))
    atlas = fill_rgb(atlas)
    atlas.save(os.path.join(OUT, "T_leaf_cherry.png"))
    print("wrote T_leaf_cherry.png")


def fill_rgb(im):
    """Bleed colour into transparent texels (no dark fringes when the alpha-clipped card is mipmapped)."""
    a = np.asarray(im, np.float32)
    rgb, al = a[..., :3], a[..., 3]
    mask = al > 8
    if mask.any():
        idx = ndimage.distance_transform_edt(~mask, return_distances=False, return_indices=True)
        rgb = rgb[idx[0], idx[1]]
    out = np.dstack([rgb, al]).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


# --------------------------------------------------------------------------------------------- flora --

def flora():
    """4 rows of 1024 x 256 strips seen from the side: pink/white petunias, yellow/orange marigolds,
    purple/blue salvia and lavender, reeds and grass tufts. Drawn at 2x."""
    W, H = 1024 * 2, 256 * 2
    sprites = leaf_sprites()
    rows = []
    specs = [
        ("petunia", [(236, 92, 160), (250, 240, 246), (224, 60, 120), (246, 150, 196)]),
        ("marigold", [(250, 196, 40), (242, 140, 30), (252, 220, 80), (232, 110, 36)]),
        ("salvia", [(120, 84, 200), (90, 100, 210), (160, 110, 220), (70, 60, 170)]),
        ("reeds", None),
    ]
    for ri, (kind, cols) in enumerate(specs):
        rng = np.random.default_rng(100 + ri)
        im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        dr = ImageDraw.Draw(im)
        if kind == "reeds":
            for i in range(900):
                x = rng.uniform(0, W)
                h = rng.uniform(0.35, 0.98) * H
                bend = rng.normal(0, 30)
                g = rng.uniform(0.75, 1.1)
                c = (int(110 * g), int(150 * g), int(70 * g), 255) if rng.random() < 0.8 else (int(170 * g), int(160 * g), int(100 * g), 255)
                dr.line((x, H, x + bend * 0.5, H - h * 0.5, x + bend, H - h), fill=c, width=int(rng.uniform(2, 5)))
                if rng.random() < 0.08:
                    dr.ellipse((x + bend - 5, H - h - 18, x + bend + 5, H - h + 18), fill=(120, 90, 60, 255))
        else:
            # foliage mass
            for i in range(1400):
                x = rng.uniform(0, W)
                y = H - rng.uniform(0, 0.62) ** 1.3 * H
                sp = sprites[rng.integers(len(sprites))]
                L = rng.uniform(20, 38)
                k = L / max(sp.size)
                s2 = sp.resize((max(2, int(sp.size[0] * k)), max(2, int(sp.size[1] * k))))
                s2 = s2.rotate(rng.uniform(-70, 70), expand=True)
                sh = 0.55 + 0.45 * (1 - (H - y) / H) * 0 + rng.uniform(0, 0.35)
                s2 = tint_sprite(s2, [0.55 * sh, 0.85 * sh, 0.42 * sh])
                im.alpha_composite(s2, (int(x - s2.size[0] / 2), int(y - s2.size[1] / 2)))
            # flower heads in the upper half
            for i in range(700):
                x = rng.uniform(0, W)
                y = H * (0.18 + 0.5 * rng.random() ** 1.6)
                col = cols[rng.integers(len(cols))]
                sh = rng.uniform(0.82, 1.08)
                c = tuple(int(min(255, v * sh)) for v in col)
                if kind == "petunia":
                    r = rng.uniform(12, 20)
                    draw_blossom(dr, x, y, r * 1.6, c, 1.0, rng)
                elif kind == "marigold":
                    r = rng.uniform(10, 17)
                    for k in range(14):
                        a = k * 2 * math.pi / 14
                        dr.ellipse((x + math.cos(a) * r * 0.55 - r * 0.42, y + math.sin(a) * r * 0.55 - r * 0.42,
                                    x + math.cos(a) * r * 0.55 + r * 0.42, y + math.sin(a) * r * 0.55 + r * 0.42), fill=c + (255,))
                    dr.ellipse((x - r * 0.45, y - r * 0.45, x + r * 0.45, y + r * 0.45),
                               fill=(int(c[0] * 0.85), int(c[1] * 0.7), int(c[2] * 0.6), 255))
                else:
                    hgt = rng.uniform(40, 90)
                    dr.line((x, y + hgt, x, y), fill=(80, 110, 60, 255), width=3)
                    for k in range(9):
                        yy = y + k * hgt / 10
                        r = 7 - k * 0.4
                        dr.ellipse((x - r, yy - r, x + r, yy + r), fill=c + (255,))
        rows.append(im.resize((1024, 256), Image.LANCZOS))
    atlas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    for i, r in enumerate(rows):
        atlas.alpha_composite(r, (0, i * 256))
    fill_rgb(atlas).save(os.path.join(OUT, "T_flora.png"))
    print("wrote T_flora.png")


# --------------------------------------------------------------------------------------------- atlas --
# Region table (pixels in the 2048 atlas, origin top-left). bake/build scripts read ATLAS from atlas.json.
ATLAS = {
    "window": (0, 0, 512, 512),          # house window glass (sky reflection, curtain hint)
    "glass": (512, 0, 512, 512),         # memorial curtain wall glass (warm interior + reflection)
    "door": (1024, 0, 256, 512),         # house door (painted wood panel)
    "door_glass": (1280, 0, 256, 512),   # café / memorial glass door
    "moon": (1536, 0, 512, 512),         # pearl gradient for the crescent
    "bus_side": (0, 512, 1024, 256),     # village bus side: white body, teal stripe, window band
    "bus_front": (1024, 512, 256, 256),
    "awning": (1280, 512, 256, 256),     # cream / teal stripes
    "parasol": (1536, 512, 256, 256),    # cream / coral segments
    "banner_a": (1792, 512, 128, 256),   # vertical banner, indigo
    "banner_b": (1920, 512, 128, 256),   # vertical banner, violet
    "sign": (0, 768, 512, 256),          # blank sign board (light wood with frame)
    "shelter": (512, 768, 512, 256),     # bus shelter glass panel
    "net": (1024, 768, 256, 256),        # green construction mesh
    "dancheong": (1280, 768, 512, 128),  # pavilion eave band
    "cells": (0, 1024, 1024, 1024),      # 32 x 32 flat colour cells (32 px each)
}
CELL_COLOURS = {
    "metal_dark": "#2E3136", "metal_grey": "#8A8F96", "steel": "#B9BEC4", "black": "#1A1B1D", "rubber": "#202022",
    "white": "#F2F0EB", "cream": "#EDE3CF", "crane_yellow": "#F2B511", "crane_dark": "#3B3B3B", "scaffold": "#9AA0A6",
    "plank": "#B48A5A", "concrete_light": "#C9C6C0", "soil": "#4A3626", "mulch": "#5C3F2A", "red_brown": "#7E3A26",
    "pillar_red": "#8E3B27", "roof_dark": "#3C4047", "trim_white": "#F4F2EC", "gold": "#D8B45A", "lamp_glass": "#FFF4D6",
    "brick": "#9C5A44", "frame_alu": "#C8CCD0", "frame_dark": "#3A3D42", "glass_dark": "#5E7488", "sign_green": "#2F6B4F",
    "table_white": "#F0EEE8", "chair_wood": "#9C6B43", "teal": "#2E8C8A", "coral": "#E8735F", "indigo": "#4B4FD8",
    "violet": "#8B5CF6", "mint": "#A8DCC8", "pot": "#B5643E", "jar": "#5A3A2A", "paper": "#F6F1E4", "green_dark": "#2F4A2C",
    "headlight": "#E8EEF2", "taillight": "#B8302C", "bus_teal": "#1F8A86", "yellow_line": "#F2C230",
}


def hexrgb(h):
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (1, 3, 5))


def cell_uv():
    """Cell name -> UV (centre) in the atlas (Blender UV: v up)."""
    out = {}
    x0, y0, w, h = ATLAS["cells"]
    for i, k in enumerate(CELL_COLOURS):
        cx, cy = i % 32, i // 32
        px = x0 + cx * 32 + 16
        py = y0 + cy * 32 + 16
        out[k] = (px / 2048.0, 1 - py / 2048.0)
    return out


def atlas():
    S = 2048
    a = np.zeros((S, S, 3), np.float32)
    rng = np.random.default_rng(5)

    def region(name):
        nonlocal xx, yy
        x, y, w, h = ATLAS[name]
        xx = np.linspace(0, 1, w)[None, :]
        yy = np.linspace(0, 1, h)[:, None]
        return slice(y, y + h), slice(x, x + w), w, h
    xx = yy = None

    def grad_v(h, w, top, bottom):
        t = np.linspace(0, 1, h)[:, None, None]
        return np.asarray(top)[None, None] * (1 - t) + np.asarray(bottom)[None, None] * t * np.ones((1, w, 1))

    # window: sky reflection top, darker interior below, soft diagonal sheen, curtain at the sides
    ys, xs, w, h = region("window")
    win = grad_v(h, w, (0.62, 0.74, 0.86), (0.20, 0.25, 0.30))
    sheen = np.exp(-((xx - yy * 0.6 - 0.15) / 0.08) ** 2) * 0.25
    win = win + sheen[..., None]
    cur = ((xx < 0.16) | (xx > 0.84)) & (yy > 0.12)
    win = np.where(cur[..., None], np.array([0.86, 0.82, 0.74]) * (0.85 + 0.15 * np.sin(xx * 90)[..., None]), win)
    a[ys, xs] = win
    # glass curtain wall: reflection of sky/trees on top, warm interior glow lower, mullion shadow lines
    ys, xs, w, h = region("glass")
    gl = grad_v(h, w, (0.55, 0.66, 0.78), (0.32, 0.30, 0.28))
    warm = np.exp(-((yy - 0.72) / 0.18) ** 2) * np.array([0.55, 0.38, 0.18])[None, None]
    trees = (yy < 0.35 + 0.08 * np.sin(xx * 21) * np.cos(xx * 7)) & (yy > 0.18)
    gl = np.where(trees[..., None], gl * 0.65 + np.array([0.18, 0.24, 0.16]), gl) + warm
    a[ys, xs] = gl
    # door: painted wood panel with two inset panels
    ys, xs, w, h = region("door")
    door = np.ones((h, w, 3)) * np.array([0.42, 0.28, 0.18])
    door *= (0.9 + 0.1 * np.sin(np.linspace(0, 60, w))[None, :, None])
    for (py0, py1) in ((0.08, 0.45), (0.52, 0.92)):
        m = (yy > py0) & (yy < py1) & (xx > 0.15) & (xx < 0.85)
        door = np.where(m[..., None], door * 0.85, door)
    a[ys, xs] = door
    ys, xs, w, h = region("door_glass")
    dg = grad_v(h, w, (0.50, 0.60, 0.70), (0.25, 0.24, 0.22))
    dg = np.where(((xx < 0.06) | (xx > 0.94) | (yy < 0.04) | (yy > 0.96))[..., None], np.array([0.25, 0.26, 0.28]), dg)
    a[ys, xs] = dg
    # moon: pearl gradient (u along the crescent, v across): white core, lavender + ice-blue edges
    ys, xs, w, h = region("moon")
    t = xx * np.ones((h, 1))
    v = yy * np.ones((1, w))
    pearl = np.array([0.97, 0.96, 0.98])[None, None] * np.ones((h, w, 1))
    lav = np.array([0.80, 0.76, 0.95])
    ice = np.array([0.74, 0.86, 0.97])
    k1 = (np.sin(t * 6.0) * 0.5 + 0.5) * smoothstep(0.55, 1.0, v)
    k2 = smoothstep(0.6, 1.0, 1 - v) * 0.7
    pearl = pearl * (1 - k1[..., None] * 0.6) + lav * (k1[..., None] * 0.6)
    pearl = pearl * (1 - k2[..., None] * 0.5) + ice * (k2[..., None] * 0.5)
    a[ys, xs] = pearl
    # bus side: white body, teal lower stripe, dark window band with pillars
    ys, xs, w, h = region("bus_side")
    bus = np.ones((h, w, 3)) * np.array([0.95, 0.95, 0.94])
    winband = (yy > 0.12) & (yy < 0.48)
    pillars = ((xx * 8) % 1) < 0.06
    bus = np.where((winband & ~pillars)[..., None], grad_v(h, w, (0.30, 0.40, 0.48), (0.14, 0.17, 0.20)), bus)
    bus = np.where(((yy > 0.62) & (yy < 0.80))[..., None], np.array([0.12, 0.54, 0.52]), bus)
    bus = np.where(((yy > 0.58) & (yy < 0.62))[..., None], np.array([0.55, 0.78, 0.30]), bus)
    bus = np.where((yy > 0.93)[..., None], np.array([0.20, 0.20, 0.21]), bus)
    a[ys, xs] = bus
    ys, xs, w, h = region("bus_front")
    bf = np.ones((h, w, 3)) * np.array([0.95, 0.95, 0.94])
    ws = (yy > 0.06) & (yy < 0.5) & (xx > 0.06) & (xx < 0.94)
    bf = np.where(ws[..., None], grad_v(h, w, (0.45, 0.55, 0.64), (0.16, 0.19, 0.22)), bf)
    bf = np.where(((yy > 0.66) & (yy < 0.8))[..., None], np.array([0.12, 0.54, 0.52]), bf)
    lights = (yy > 0.82) & (yy < 0.9) & ((xx < 0.2) | (xx > 0.8))
    bf = np.where(lights[..., None], np.array([0.95, 0.95, 0.9]), bf)
    a[ys, xs] = bf
    # awning stripes
    ys, xs, w, h = region("awning")
    st = ((xx * 8) % 1) < 0.5
    aw = np.where(st[..., None], np.array([0.94, 0.91, 0.84]), np.array([0.18, 0.55, 0.53])) * np.ones((h, 1, 1))
    aw = np.where((yy > 0.86)[..., None], aw * 0.85, aw)
    a[ys, xs] = aw
    ys, xs, w, h = region("parasol")
    ps = ((xx * 6) % 1) < 0.5
    a[ys, xs] = np.where(ps[..., None], np.array([0.95, 0.92, 0.86]), np.array([0.90, 0.46, 0.38])) * np.ones((h, 1, 1))
    for name, col in (("banner_a", (0.29, 0.31, 0.85)), ("banner_b", (0.55, 0.36, 0.96))):
        ys, xs, w, h = region(name)
        bx = np.linspace(0, 1, w)[None, :]
        by = np.linspace(0, 1, h)[:, None]
        b = np.ones((h, w, 3)) * np.asarray(col)
        b = b * (0.9 + 0.1 * np.sin(bx * 9)[..., None])
        stripe = (by > 0.78) & (by < 0.82)
        b = np.where(stripe[..., None], np.array([0.98, 0.94, 0.82]), b)
        circ = ((bx - 0.5) ** 2 + ((by - 0.35) * 2) ** 2) < 0.06
        b = np.where(circ[..., None], np.array([0.98, 0.95, 0.88]), b)
        a[ys, xs] = b
    ys, xs, w, h = region("sign")
    sx = np.linspace(0, 1, w)[None, :]
    sy = np.linspace(0, 1, h)[:, None]
    wood = np.array([0.72, 0.56, 0.38]) * (0.92 + 0.08 * np.sin(sy * 70 + np.sin(sx * 9) * 2))[..., None]
    board = np.ones((h, w, 3)) * np.array([0.96, 0.95, 0.91])
    frame = (sx < 0.05) | (sx > 0.95) | (sy < 0.09) | (sy > 0.91)
    a[ys, xs] = np.where(frame[..., None], wood, board)
    ys, xs, w, h = region("shelter")
    a[ys, xs] = grad_v(h, w, (0.70, 0.80, 0.86), (0.48, 0.56, 0.62))
    ys, xs, w, h = region("net")
    nx = np.linspace(0, 40, w)[None, :]
    ny = np.linspace(0, 40, h)[:, None]
    mesh = ((nx % 1) < 0.25) | ((ny % 1) < 0.25)
    a[ys, xs] = np.where(mesh[..., None], np.array([0.12, 0.32, 0.20]), np.array([0.22, 0.48, 0.30]))
    ys, xs, w, h = region("dancheong")
    dx = np.linspace(0, 1, w)[None, :]
    dy = np.linspace(0, 1, h)[:, None]
    d = np.ones((h, w, 3)) * np.array([0.25, 0.48, 0.42])
    d = np.where(((dx * 16) % 1 < 0.5)[..., None] & (dy > 0.3)[..., None] & (dy < 0.7)[..., None], np.array([0.75, 0.30, 0.22]), d)
    d = np.where(((dy < 0.12) | (dy > 0.88))[..., None], np.array([0.85, 0.80, 0.65]), d)
    a[ys, xs] = d
    # flat colour cells
    x0, y0, _, _ = ATLAS["cells"]
    for i, (k, hx) in enumerate(CELL_COLOURS.items()):
        cx, cy = i % 32, i // 32
        a[y0 + cy * 32:y0 + cy * 32 + 32, x0 + cx * 32:x0 + cx * 32 + 32] = hexrgb(hx)
    save(a, "T_atlas.png")
    json.dump({"size": S, "regions": ATLAS, "cells": cell_uv()}, open(os.path.join(OUT, "atlas.json"), "w"), indent=1)


# ---------------------------------------------------------------------------------------------- glow --
GLOW = {"lamp": (0, 0, 256, 256), "window_lit": (256, 0, 256, 256), "window": (512, 0, 256, 256),
        "door_glass": (768, 0, 256, 512), "glass_lit": (0, 256, 512, 256), "glass": (0, 512, 512, 256),
        "interior": (512, 512, 512, 256), "ceiling_lit": (512, 768, 256, 256)}


def glow():
    """T_glow: shared by M_lamp (lantern glass) and M_window (every window pane, lit or not; never light-mapped):
    lantern glass, warm lit house windows, day glass with a sky reflection, a glass door, the memorial's lit glass,
    the café's curtain glass."""
    S = 1024
    a = np.zeros((S, S, 3), np.float32)
    def reg(n):
        x, y, w, h = GLOW[n]
        return slice(y, y + h), slice(x, x + w), w, h
    ys, xs, w, h = reg("lamp")
    yy = np.linspace(0, 1, h)[:, None]
    xx = np.linspace(0, 1, w)[None, :]
    a[ys, xs] = np.array([1.0, 0.86, 0.60]) * (0.85 + 0.15 * np.exp(-((xx - 0.5) / 0.3) ** 2))[..., None] * np.ones((h, 1, 1))
    ys, xs, w, h = reg("window_lit")
    yy = np.linspace(0, 1, h)[:, None]
    xx = np.linspace(0, 1, w)[None, :]
    win = np.array([1.0, 0.80, 0.52]) * (0.75 + 0.25 * (1 - yy))[..., None] * np.ones((1, w, 1))
    cur = ((xx < 0.18) | (xx > 0.82))
    win = np.where(cur[..., None], np.array([0.95, 0.85, 0.70]) * (0.8 + 0.2 * np.sin(xx * 80))[..., None], win)
    win = np.where(((np.abs(xx - 0.5) < 0.025) | (np.abs(yy - 0.45) < 0.025))[..., None], np.array([0.85, 0.82, 0.76]), win)
    a[ys, xs] = win
    ys, xs, w, h = reg("glass_lit")
    yy = np.linspace(0, 1, h)[:, None]
    xx = np.linspace(0, 1, w)[None, :]
    g = np.array([0.98, 0.78, 0.50]) * (0.55 + 0.45 * np.exp(-((yy - 0.25) / 0.35) ** 2))[..., None] * np.ones((1, w, 1))
    # niche shelves silhouettes (light oak grid) and a reflection band of sky at the top
    grid = (((xx * 18) % 1) < 0.08) | (((yy * 9) % 1) < 0.08)
    shelves = (yy > 0.2) & (yy < 0.85) & ((xx < 0.35) | (xx > 0.65))
    g = np.where((grid & shelves)[..., None], np.array([0.80, 0.62, 0.42]), g)
    refl = np.clip(1 - yy / 0.18, 0, 1)
    g = g * (1 - refl[..., None] * 0.6) + np.array([0.62, 0.72, 0.82]) * refl[..., None] * 0.6
    a[ys, xs] = g
    # day window: sky reflection on top, soft interior below, a diagonal sheen, curtains at the sides
    def day_glass(w, h, curtains=True, frame=False):
        yy = np.linspace(0, 1, h)[:, None]
        xx = np.linspace(0, 1, w)[None, :]
        t = yy[..., None]
        out = np.array([0.66, 0.78, 0.90]) * (1 - t) + np.array([0.24, 0.29, 0.34]) * t
        out = out * np.ones((1, w, 1))
        sheen = np.exp(-((xx - yy * 0.6 - 0.15) / 0.07) ** 2) * 0.22
        out = out + sheen[..., None]
        trees = (yy > 0.30 + 0.05 * np.sin(xx * 23) * np.cos(xx * 9)) & (yy < 0.42)
        out = np.where(trees[..., None], out * 0.7 + np.array([0.12, 0.17, 0.11]), out)
        if curtains:
            cur = ((xx < 0.15) | (xx > 0.85)) & (yy > 0.1)
            out = np.where(cur[..., None], np.array([0.88, 0.84, 0.76]) * (0.85 + 0.15 * np.sin(xx * 90))[..., None], out)
        if frame:
            fr = (xx < 0.05) | (xx > 0.95) | (yy < 0.03) | (yy > 0.97)
            out = np.where(fr[..., None], np.array([0.24, 0.25, 0.27]), out)
        return out
    ys, xs, w, h = reg("window")
    a[ys, xs] = day_glass(w, h)
    # interior back wall of the memorial: warm lit room, light-oak niche wall with soft LED strips, a bench line
    ys, xs, w, h = reg("interior")
    yy = np.linspace(0, 1, h)[:, None]
    xx = np.linspace(0, 1, w)[None, :]
    room = np.array([0.98, 0.86, 0.66]) * (0.72 + 0.28 * np.exp(-((yy - 0.15) / 0.5) ** 2))[..., None] * np.ones((1, w, 1))
    cells = (((xx * 22) % 1) > 0.1) & (((yy * 7) % 1) > 0.12) & (yy > 0.12) & (yy < 0.82)
    niche = np.array([0.86, 0.70, 0.50]) * (0.85 + 0.15 * np.sin(xx * 140)[..., None])
    room = np.where(cells[..., None], room * 0.55 + niche * 0.45, room * 0.92)
    led = (((yy * 7) % 1) < 0.05) & (yy > 0.12) & (yy < 0.82)
    room = np.where(led[..., None], np.array([1.0, 0.95, 0.82]), room)
    floor = yy > 0.86
    room = np.where(floor[..., None], np.array([0.78, 0.62, 0.44]) * (0.9 + 0.1 * np.sin(xx * 60))[..., None], room)
    a[ys, xs] = room
    ys, xs, w, h = reg("ceiling_lit")
    yy = np.linspace(0, 1, h)[:, None]
    xx = np.linspace(0, 1, w)[None, :]
    spots = np.zeros((h, w))
    for cx in (0.25, 0.75):
        for cy in (0.25, 0.75):
            spots = np.maximum(spots, np.exp(-(((xx - cx) ** 2 + (yy - cy) ** 2) / 0.004)))
    a[ys, xs] = np.array([0.95, 0.90, 0.80])[None, None] * 0.82 + spots[..., None] * np.array([0.05, 0.1, 0.2])
    # the old niche grid on "glass_lit" read as ghost lines: keep a soft warm room only
    ys, xs, w, h = reg("glass_lit")
    yy = np.linspace(0, 1, h)[:, None]
    xx = np.linspace(0, 1, w)[None, :]
    a[ys, xs] = np.array([0.98, 0.80, 0.55]) * (0.6 + 0.4 * np.exp(-((yy - 0.3) / 0.4) ** 2))[..., None] * np.ones((1, w, 1))
    ys, xs, w, h = reg("door_glass")
    a[ys, xs] = day_glass(w, h, curtains=False, frame=True)
    ys, xs, w, h = reg("glass")
    a[ys, xs] = day_glass(w, h, curtains=False)
    save(a, "T_glow.png")
    json.dump({"size": S, "regions": GLOW}, open(os.path.join(OUT, "glow.json"), "w"), indent=1)


# --------------------------------------------------------------------------------------------- water --

def water():
    N = 1024
    a = np.zeros((N, N, 4), np.float32)
    half = N // 2
    yy, xx = np.mgrid[0:N, 0:half].astype(np.float32)
    n1 = fbm((N, half), 8, 4, seed=21)
    n2 = fbm((N, half), 24, 3, seed=22)
    base = np.array([0.16, 0.56, 0.60])
    sky = np.array([0.70, 0.88, 0.92])
    k = np.clip(n1 * 1.2 - 0.3, 0, 1)
    pool = base * (1 - k[..., None] * 0.45) + sky * (k[..., None] * 0.45)
    sparkle = np.clip((n2 - 0.74) / 0.06, 0, 1) * 0.35
    pool = pool + sparkle[..., None] * np.array([1.0, 0.95, 0.85])
    a[:, :half, :3] = pool
    a[:, :half, 3] = 1.0
    # foam / jets: vertical streaks, alpha fading at the tube edges (u) and with streak noise
    yy2, xx2 = np.mgrid[0:N, 0:half].astype(np.float32)
    u = xx2 / half
    streak = fbm((N, half), 6, 3, seed=23)
    streak = ndimage.zoom(streak[:, ::8], (1, 8), order=1)[:, :half]
    edge = np.sin(np.pi * u) ** 0.8
    foam = np.array([0.90, 0.95, 0.98]) * (0.80 + 0.2 * streak[..., None])
    a[:, half:, :3] = foam
    a[:, half:, 3] = np.clip(edge * (0.55 + 0.35 * streak), 0, 1)
    Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").save(os.path.join(OUT, "T_water.png"))
    print("wrote T_water.png")


def glass():
    """T_glass (M_glass, BLEND): clear architectural glass seen from outside: a sky/horizon reflection gradient whose
    opacity grows toward the top (Fresnel-ish), a faint diagonal sheen; the lit interior shows through the low alpha."""
    W, H = 256, 512
    v = np.linspace(0, 1, H)[:, None]
    u = np.linspace(0, 1, W)[None, :]
    col = np.array([0.80, 0.88, 0.95]) * (1 - v[..., None]) + np.array([0.50, 0.58, 0.64]) * v[..., None]
    col = col * np.ones((1, W, 1))
    sheen = np.exp(-((u - v * 0.55 - 0.2) / 0.06) ** 2) * 0.25
    col = np.clip(col + sheen[..., None], 0, 1)
    alpha = 0.22 + 0.32 * (1 - v) ** 1.5 + sheen * 0.6
    a = np.dstack([col, np.broadcast_to(alpha, (H, W))])
    Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").save(os.path.join(OUT, "T_glass.png"))
    print("wrote T_glass.png")


def falls():
    """T_falls (M_waterfall): left half falling water with streaks periodic in v (UV-scroll friendly), right half a
    soft mist puff (radial alpha)."""
    W, H = 512, 512
    a = np.zeros((H, W, 4), np.float32)
    half = W // 2
    rng = np.random.default_rng(31)
    v = np.linspace(0, 1, H, endpoint=False)[:, None]
    u = np.linspace(0, 1, half)[None, :]
    col_phase = rng.uniform(0, 2 * np.pi, (1, half))
    col_amp = ndimage.gaussian_filter1d(rng.uniform(0.3, 1.0, half), 2.0)[None, :]
    streak = np.zeros((H, half), np.float32)
    for k, amp in ((1, 0.5), (2, 0.3), (5, 0.2), (9, 0.12)):
        ph = ndimage.gaussian_filter1d(rng.uniform(0, 2 * np.pi, half), 1.5)[None, :]
        streak += amp * np.sin(2 * np.pi * k * v + ph + col_phase * 0.3)
    streak = 0.5 + 0.5 * streak / 1.1
    edge = np.sin(np.pi * u) ** 0.6
    a[:, :half, :3] = (np.array([0.86, 0.92, 0.96]) * (0.82 + 0.18 * streak)[..., None])
    a[:, :half, 3] = np.clip(edge * (0.55 + 0.4 * streak * col_amp), 0, 1)
    yy, xx = np.mgrid[0:H, 0:half].astype(np.float32)
    r = np.hypot((xx - half / 2) / (half / 2), (yy - H * 0.55) / (H * 0.45))
    mist = np.clip(1 - r, 0, 1) ** 1.8 * (0.75 + 0.25 * fbm((H, half), 6, 3, seed=33))
    a[:, half:, :3] = np.array([0.93, 0.96, 0.98])
    a[:, half:, 3] = mist * 0.55
    Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").save(os.path.join(OUT, "T_falls.png"))
    print("wrote T_falls.png")


# ----------------------------------------------------------------------------------------------- sky --

def read_hdr(path):
    """Radiance .hdr (RLE) reader."""
    with open(path, "rb") as f:
        data = f.read()
    head_end = data.index(b"\n\n") + 2
    rest = data[head_end:]
    line_end = rest.index(b"\n")
    dims = rest[:line_end].split()
    H, W = int(dims[1]), int(dims[3])
    buf = rest[line_end + 1:]
    img = np.zeros((H, W, 4), np.uint8)
    p = 0
    for y in range(H):
        if buf[p] == 2 and buf[p + 1] == 2:
            p += 4
            for c in range(4):
                x = 0
                while x < W:
                    n = buf[p]
                    p += 1
                    if n > 128:
                        n -= 128
                        img[y, x:x + n, c] = buf[p]
                        p += 1
                    else:
                        img[y, x:x + n, c] = np.frombuffer(buf[p:p + n], np.uint8)
                        p += n
                    x += n
        else:
            img[y] = np.frombuffer(buf[p:p + W * 4], np.uint8).reshape(W, 4)
            p += W * 4
    e = img[..., 3].astype(np.int32)
    f = np.where(e > 0, np.ldexp(1.0, e - 136), 0.0)
    return img[..., :3].astype(np.float32) * f[..., None]


def sky(sun_az_deg=None):
    """Equirect HDRI (Poly Haven, CC0) -> sky dome texture: u = azimuth from north (0) clockwise via east (0.25),
    v = elevation from -10 (bottom) to 90 deg (top); display-referred (simple filmic curve), haze toward the horizon.
    The HDRI is rotated so that its sun sits at the scene's sun azimuth."""
    cfg = json.load(open(os.path.join(ROOT, "tools", "look.json")))
    sun_az = cfg["sun_azimuth_deg"] if sun_az_deg is None else sun_az_deg
    hdr = read_hdr(os.path.join(DL, "hdri", cfg["hdri"] + "_2k.hdr"))
    H, W, _ = hdr.shape
    lum = hdr @ np.array([0.2126, 0.7152, 0.0722])
    sy, sx = np.unravel_index(np.argmax(lum), lum.shape)
    hdri_sun_u = sx / W
    OW, OH = 2048, 1024
    u = (np.arange(OW) + 0.5) / OW            # azimuth fraction from north, clockwise (east = 0.25)
    v = (np.arange(OH) + 0.5) / OH
    elev = 90 - v * 100                       # row 0 = zenith ... row OH = -10 deg
    # HDRI column for a world azimuth: the sun column maps to sun_az
    col = ((hdri_sun_u + (u - sun_az / 360.0)) % 1.0) * W
    row = (0.5 - np.radians(elev) / np.pi) * H
    R_, C_ = np.meshgrid(row, col, indexing="ij")
    smp = hdr[np.clip(R_.astype(int), 0, H - 1), C_.astype(int) % W]
    smp = np.minimum(smp, 6.0)
    exposure = cfg.get("sky_exposure", 0.9)
    x = smp * exposure
    disp = x / (1 + x) * 1.25
    disp = np.clip(disp, 0, 1) ** (1 / 2.2)
    haze = np.array(hexrgb(cfg.get("haze", "#D9DCE3")))
    ev = np.broadcast_to(elev[:, None], (OH, OW))
    k = np.clip(1 - (ev + 2) / 14.0, 0, 1) ** 1.5
    disp = disp * (1 - k[..., None] * 0.6) + haze * (k[..., None] * 0.6)
    save(disp, "T_sky.png")


def main(argv):
    jobs = {"tiles": tiles, "plaza": plaza, "lawn": lawn, "leaves": leaves, "flora": flora, "atlas": atlas,
            "water": water, "sky": sky, "glow": glow, "falls": falls, "glass": glass}
    names = argv or list(jobs)
    for n in names:
        jobs[n]()


if __name__ == "__main__":
    main(sys.argv[1:])
