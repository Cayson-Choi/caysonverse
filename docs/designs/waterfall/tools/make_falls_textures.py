"""B1 waterfall, W1 (rock side): the textures of the site's stone, ground and plants (CC0 sets in downloads/).

  python make_falls_textures.py [rock|macro|foliage|ground ...]    (system python with PIL + numpy + scipy; no Blender)

Writes art/village/work/tex/falls/:
  T_falls_rock.png       1024  tiled granite grain (UV0, 4 m tile): rock_boulder_dry, desaturated light grey, flattened
                               at large scale (the macro map carries the big value changes), biotite / feldspar speckle
  T_falls_rock_n.png     1024  its normal (GL)
  T_falls_rock_macro.png 1024  cliff MACRO map on UV2 (the face's (z, y) square, one texel ~4 cm), made from the SAME
                               joint layout as the geometry (parts_falls_rock.layout()):
                                 RGB = colour multiplier, 0.5 = x1 (albedo = tile x RGB x 2): per-block value, lichen
                                       (pale grey / yellow-green), black water streaks down from ledges and the rim,
                                       rust streaks under joints, crack and bevel darkening, moss on ledge tops and in
                                       damp cracks, the black wet zone round the plunge and the groove
                                 A   = fine relief height (0.5 = 0; 1 unit = 0.3 m): secondary fracture facets inside
                                       each block, chips, crack grooves
  T_falls_rock_macro_n.png 1024 normal (GL, UV2 tangent space) of that relief, for the runtime (Blender uses A + bump)
  T_falls_slab.png / _n  1024  slabs, seats, boulders: rock_boulder_dry, lighter, water-worn
  T_falls_gravel.png / _n 1024 banks and the rest-area path: river_small_rocks
  T_falls_turf.png / _n  1024  flank and plateau ground: leafy_grass darkened (forest floor)
  T_falls_foliage.png    1024  RGBA 2x2 alpha-cut plant atlas, each drawn with its base at the bottom centre:
                               TL spray (broadleaf shrub twig), TR fern frond, BL grass / sedge clump, BR hanging spray
                               (drawn from the top edge down); colour bled into the transparent texels
(W3 converts these to WebP and picks the sizes per quality tier; the water textures belong to W2.)
"""
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "downloads", "tex")
DL = os.path.join(ROOT, "downloads")
OUT = os.path.join(ROOT, "work", "tex", "falls")
os.makedirs(OUT, exist_ok=True)


def load(name, src=SRC):
    return np.asarray(Image.open(os.path.join(src, name)).convert("RGB"), dtype=np.float32) / 255.0


def save(arr, name, size=1024):
    a = np.clip(arr, 0, 1)
    mode = "RGBA" if a.shape[2] == 4 else "RGB"
    im = Image.fromarray((a * 255 + 0.5).astype(np.uint8), mode)
    if im.size != (size, size):
        im = im.resize((size, size), Image.LANCZOS)
    im.save(os.path.join(OUT, name))
    print("wrote", name, im.size)


def desat(a, s, gain=1.0, tint=(1, 1, 1), gamma=1.0):
    lum = (a * np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)).sum(axis=2, keepdims=True)
    out = lum + (a - lum) * s
    out = np.power(np.clip(out, 0, 1), gamma) * gain
    return out * np.array(tint, dtype=np.float32)


def flatten(a, k=0.8, blur=40):
    """Pull the large-scale brightness toward its mean (the tile must not show blotches at 4 m)."""
    low = ndimage.gaussian_filter(a, (blur, blur, 0), mode="wrap")
    return np.clip(a - low * k + low.mean(axis=(0, 1), keepdims=True) * k, 0, 1)


def vnoise(shape, cell, seed, order=3):
    """Smooth value noise (-1..1) of feature size `cell` texels."""
    rng = np.random.default_rng(seed)
    h, w = shape
    gh, gw = int(h / cell) + 4, int(w / cell) + 4
    g = rng.uniform(-1, 1, (gh, gw)).astype(np.float32)
    z = ndimage.zoom(g, (cell, cell), order=order)
    oy, ox = int(cell), int(cell)
    return z[oy:oy + h, ox:ox + w]


def fbm(shape, cell, seed, oct_=4, gain=0.5):
    out = np.zeros(shape, np.float32)
    amp, tot = 1.0, 0.0
    for o in range(oct_):
        out += vnoise(shape, max(1.5, cell / (2 ** o)), seed + 17 * o) * amp
        tot += amp
        amp *= gain
    return out / tot


def sm(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# ===================================================================================================== rock ==
def rock():
    r = load("rock_boulder_dry_diff_1k.jpg")
    r = flatten(desat(r, 0.28, gain=1.0, tint=(1.02, 1.0, 0.95)), 0.85, 36)
    rng = np.random.default_rng(5)
    h, w = r.shape[:2]
    # granite speckle: biotite (black) and feldspar (white) grains, 1-3 texels (~4-12 mm at a 4 m tile)
    dark = ndimage.gaussian_filter((rng.random((h, w)) < 0.018).astype(np.float32), 0.7) * 3.2
    light = ndimage.gaussian_filter((rng.random((h, w)) < 0.012).astype(np.float32), 0.8) * 2.2
    r = r * (1 - np.clip(dark, 0, 0.75)[..., None]) + np.clip(light, 0, 0.35)[..., None] * 0.9
    save(r, "T_falls_rock.png")
    save(load("rock_boulder_dry_nor_gl_1k.jpg"), "T_falls_rock_n.png")
    s = load("rock_boulder_dry_diff_1k.jpg")
    s = np.rot90(flatten(desat(s, 0.25, gain=0.78, tint=(1.0, 1.0, 0.97)), 0.75, 40)).copy()
    save(s, "T_falls_slab.png")
    save(np.rot90(load("rock_boulder_dry_nor_gl_1k.jpg")).copy() * np.array([1, 1, 1], np.float32), "T_falls_slab_n.png")


def ground():
    g = load("river_small_rocks_diff_1k.jpg")
    save(desat(g, 0.5, gain=1.05, tint=(0.97, 0.98, 0.95)), "T_falls_gravel.png")
    save(load("river_small_rocks_nor_gl_1k.jpg"), "T_falls_gravel_n.png")
    t = load("leafy_grass_diff_1k.jpg")
    save(desat(t, 0.9, gain=0.62, tint=(0.88, 1.0, 0.78)), "T_falls_turf.png")
    save(load("leafy_grass_nor_gl_1k.jpg"), "T_falls_turf_n.png")


# ================================================================================================ macro map ==
def macro(N=1024):
    import falls_shape as F
    import parts_falls_rock as P
    L = P.layout()
    zA, zB = F.FACE_Z
    yA, yB = F.FACE_Y
    # texel centres: column j -> z, row i (top = 0) -> y
    zs = zA + (np.arange(N) + 0.5) / N * (zB - zA)
    ys = yB - (np.arange(N) + 0.5) / N * (yB - yA)
    Z, Y = np.meshgrid(zs, ys)
    tz, ty = (zB - zA) / N, (yB - yA) / N
    # --- per-texel block id and block-local edge distances
    bid = np.full((N, N), -1, np.int32)
    for k, b in enumerate(L["blocks"]):
        m = (Z >= b.z0) & (Z < b.z1) & (Y >= b.y0) & (Y < b.y1)
        bid[m] = k
    B = L["blocks"]
    z0 = np.array([b.z0 for b in B])[bid]
    z1 = np.array([b.z1 for b in B])[bid]
    y0 = np.array([b.y0 for b in B])[bid]
    y1 = np.array([b.y1 for b in B])[bid]
    lum = np.array([b.lum for b in B])[bid]
    tint = np.array([b.tint for b in B])[bid]
    has_l = np.array([b.ck_l is not None for b in B])[bid]
    has_r = np.array([b.ck_r is not None for b in B])[bid]
    has_b = np.array([b.ck_b is not None for b in B])[bid]
    has_t = np.array([b.ck_t is not None for b in B])[bid]
    BIG = 99.0
    dl = np.where(has_l, Z - z0, BIG)
    dr = np.where(has_r, z1 - Z, BIG)
    db = np.where(has_b, Y - y0, BIG)
    dt = np.where(has_t, y1 - Y, BIG)
    dz_e = np.minimum(dl, dr)
    dy_e = np.minimum(db, dt)
    de = np.minimum(dz_e, dy_e)
    # --- weights from the shape: block relief weight (groove = 0), wetness, face x (coarse, upsampled)
    M = 128
    zc = zA + (np.arange(M) + 0.5) / M * (zB - zA)
    yc = yB - (np.arange(M) + 0.5) / M * (yB - yA)
    Wc = np.zeros((M, M), np.float32)
    WETc = np.zeros((M, M), np.float32)
    for i, y in enumerate(yc):
        for j, z in enumerate(zc):
            Wc[i, j] = P.detail_weight(z, y)
            x = F.face_x(z, y)
            d_ch = abs(z - F.channel_z(y)) if y > F.LEDGE - 0.5 else 99.0
            d_pl = abs(z - F.LIP["z"]) if y <= F.LEDGE + 0.5 else 99.0
            w = max(math.exp(-(d_ch / 3.0) ** 2), F.smooth(7.5, 3.0, d_pl) * (1.0 if y > -1 else 0.0))
            near = math.hypot(x - F.IMPACT["x"], z - F.IMPACT["z"]) - 5.0
            w = max(w, math.exp(-max(0.0, near) / 3.0) * F.smooth(6.0, 1.0, y))
            w = max(w, F.smooth(1.2, 0.0, y - F.WATER_Y) * 0.9)
            WETc[i, j] = min(1.0, w)
    up = N / M
    W = np.clip(ndimage.zoom(Wc, up, order=1), 0, 1)
    WET = np.clip(ndimage.zoom(WETc, up, order=1), 0, 1)
    sun = sm(4.0, 18.0, Y) * (1 - WET)        # dry, high rock: lichen country
    # --- ledges: where the block above stands back (x of the plane below at the joint - plane above)
    a_ = np.array([b.a for b in B])[bid]
    bz = np.array([b.b for b in B])[bid]
    cy = np.array([b.c for b in B])[bid]
    zcb = np.array([b.zc for b in B])[bid]
    ycb = np.array([b.yc for b in B])[bid]
    kr = np.array([b.kr for b in B])[bid]
    zr = np.array([b.zr for b in B])[bid]
    ky = np.array([b.ky for b in B])[bid]
    yr = np.array([b.yr for b in B])[bid]
    XP = a_ + bz * (Z - zcb) + cy * (Y - ycb) - kr * (np.abs(Z - zr) - 0.25 * (z1 - z0)) - ky * np.maximum(0, Y - yr)
    sh = int(round(0.35 / ty))
    above = np.roll(XP, sh, axis=0)                        # texel 0.35 m higher (rows go down)
    step = np.clip(XP - above, 0, 2.0) * (dt < 0.35)       # this texel sits just under a joint whose upper block is set back
    ledge_top = (step > 0.18).astype(np.float32)
    ledge_top = ndimage.maximum_filter(ledge_top, size=(int(0.25 / ty), 1))
    # --- noise fields
    n_big = fbm((N, N), 160, 11, 4)
    n_mid = fbm((N, N), 40, 12, 4)
    n_sml = fbm((N, N), 10, 13, 3)
    # value: per block +-7 %, large-scale +-12 %, slightly warmer low down
    val = 0.8 + 0.14 * lum + 0.45 * n_big + 0.22 * n_mid
    val *= 0.72 + 0.28 * sm(0.0, 14.0, Y)                  # the damp lower rock is darker (photo 05)
    warm = 0.06 * tint + 0.08 * fbm((N, N), 90, 14, 3)
    col = np.stack([val * (1.0 + warm), val * (1.0 + 0.2 * warm), val * (1.0 - 0.9 * warm)], -1)
    # lichen: pale grey-white crusts (and some yellow-green) on dry rock, blotchy, 0.2-1.5 m
    lich_f = fbm((N, N), 22, 21, 5, 0.55) + 0.35 * n_big
    lich = sm(0.10, 0.28, lich_f) * (0.35 + 0.65 * sun)
    lich2 = sm(0.22, 0.4, fbm((N, N), 5, 24, 3) + 0.3 * n_mid) * (0.3 + 0.7 * sun) * (1 - lich)
    lich_y = sm(0.25, 0.45, fbm((N, N), 14, 23, 4)) * lich
    col = col * (1 - lich[..., None] * 0.75) + lich[..., None] * 0.75 * np.array([1.42, 1.42, 1.36])
    col = col * (1 - lich2[..., None] * 0.55) + lich2[..., None] * 0.55 * np.array([1.3, 1.3, 1.25])
    col = col * (1 - lich_y[..., None] * 0.35) + lich_y[..., None] * 0.35 * np.array([1.15, 1.22, 0.75])
    # dark biofilm / dark lichen blotches on the damp lower rock
    dk = sm(0.0, 0.28, fbm((N, N), 26, 31, 5, 0.55) + 0.25 * n_big) * (0.5 + 0.5 * sm(18.0, 3.0, Y)) * (1 - 0.7 * lich)
    col *= (1 - 0.55 * dk)[..., None]
    # water streaks: long dark vertical runs from ledge tops, the rim and the cracks, fading downward
    rngs = np.random.default_rng(41)
    streak = np.zeros((N, N), np.float32)
    zcol = fbm((1, N), 3.0, 51, 3)[0]                      # per-column streak intensity (thin stripes)
    zcol2 = fbm((1, N), 9.0, 52, 2)[0]
    jmask = sm(0.1, 0.5, fbm((1, N), 20.0, 53, 2)[0])[None, :]
    src = np.maximum(ledge_top * 0.9, (dt < 0.3).astype(np.float32) * 0.6 * jmask)
    src[:int((yB - F.TOP - 1.0) / ty), :] = np.maximum(src[:int((yB - F.TOP - 1.0) / ty), :], 0.8)   # under the rim
    run = np.zeros((N, N), np.float32)
    acc = np.zeros(N, np.float32)
    decay = math.exp(-ty / 4.5)
    for i in range(N):                                     # top to bottom: streaks start at sources, run down, fade
        acc = np.maximum(acc * decay, src[i])
        run[i] = acc
    str_w = sm(0.12, 0.55, zcol) * sm(-0.3, 0.4, zcol2)
    streak = run * str_w[None, :] * (1 - 0.6 * lich)
    streak = np.maximum(streak, WET * sm(0.0, 0.5, zcol)[None, :] * 0.8)
    col *= (1 - 0.7 * np.clip(streak, 0, 1))[..., None]
    # rust / ochre staining under some joints
    rz = sm(0.35, 0.6, fbm((1, N), 6.0, 61, 3)[0])
    rust = run * rz[None, :] * sm(0.2, 0.5, fbm((N, N), 30, 62, 3)) * (1 - WET)
    col = col * (1 - rust[..., None] * 0.35) + rust[..., None] * 0.35 * np.array([1.15, 0.86, 0.6])
    # wet zone: dark, a little cool (the vertex G mask adds the wet gloss and more darkening at runtime)
    col *= (1 - 0.5 * WET)[..., None]
    # moss: on ledge tops, at the foot, in the damp cracks (dark yellow-green)
    damp = np.clip(0.35 + 0.65 * sm(16.0, 2.0, Y) + 0.5 * WET * sm(6.0, 0.0, Y), 0, 1)
    mn = fbm((N, N), 8, 71, 4)
    moss = np.clip(ledge_top * sm(-0.3, 0.2, mn) * 0.95 + (dz_e < 0.07) * damp * sm(0.0, 0.3, mn) * 0.8
                   + sm(3.5, 0.2, Y) * sm(0.05, 0.35, mn) * (1 - sm(0.8, 1.0, WET)) * 0.9, 0, 1)
    moss *= W ** 0.5
    mossc = np.array([0.42, 0.56, 0.22])
    col = col * (1 - moss[..., None]) + moss[..., None] * mossc * (0.85 + 0.3 * n_sml)[..., None]
    # crack + bevel darkening (ambient occlusion in the joints; the lightmap adds the big shadows)
    ckz = np.array([max(b.ck_l or 0, b.ck_r or 0) for b in B])[bid]
    cky = np.array([max(b.ck_b or 0, b.ck_t or 0) for b in B])[bid]
    kd = np.where(dz_e < dy_e, ckz, cky) / 0.8
    jit = 0.5 + 0.5 * fbm((N, N), 6, 95, 3) * 2.0                 # crack width wobbles along the joint
    cw = 0.02 + 0.08 * np.clip(jit, 0, 1) * (0.4 + 0.6 * np.clip(kd, 0, 1))
    ao = 1 - (0.35 + 0.5 * np.clip(kd, 0, 1)) * sm(cw, 0.0, de) - 0.12 * sm(0.35, 0.05, de)
    # chipped edges: bits broken off the block edges (lighter fresh rock, a little relief in the height below)
    chip = sm(0.3, 0.0, de) * sm(0.15, 0.4, fbm((N, N), 4, 96, 2))
    col = col * (1 - chip[..., None] * 0.25) + chip[..., None] * 0.25 * np.array([1.2, 1.18, 1.12])
    col *= (1 - (1 - ao) * W)[..., None]
    # --- relief height (m): secondary fracture facets per block, chips, crack grooves
    hgt = np.zeros((N, N), np.float32)
    rngh = np.random.default_rng(81)
    for k, b in enumerate(B):
        m = bid == k
        if not m.any():
            continue
        zz, yy = Z[m], Y[m]
        hb = np.zeros(zz.shape, np.float32)
        for _ in range(rngh.integers(3, 7)):
            ang = rngh.uniform(0, math.pi)
            if rngh.random() < 0.6:                          # mostly steep fractures (along the columns) or flat
                ang = rngh.choice([rngh.uniform(1.2, 1.95), rngh.uniform(-0.25, 0.25)])
            nz_, ny_ = math.cos(ang), math.sin(ang)
            pz = rngh.uniform(b.z0, b.z1)
            py = rngh.uniform(b.y0, b.y1)
            dist = (zz - pz) * nz_ + (yy - py) * ny_
            hb += np.where(dist > 0, -dist * rngh.uniform(0.025, 0.085), 0.0)  # the far side leans back a little
            hb -= 0.02 * np.exp(-(dist / 0.025) ** 2) * rngh.uniform(0.3, 1.0)  # a hairline crack on the fracture
        hb -= hb.mean()
        hgt[m] = np.clip(hb, -0.2, 0.2)
    ridged = 1 - np.abs(fbm((N, N), 7, 91, 3))
    hgt += 0.03 * (ridged - 0.7) + 0.012 * fbm((N, N), 2.5, 92, 2)
    hgt -= 0.10 * sm(0.07, 0.0, de)                        # crisp crack grooves
    hgt -= 0.05 * chip
    hgt *= (0.3 + 0.7 * W)
    A = np.clip(0.5 + hgt / 0.3, 0, 1)
    rgb = np.clip(col * 0.5, 0, 1)
    save(np.dstack([rgb, A]), "T_falls_rock_macro.png", N)
    # normal (GL): u = +z (game), v = +y; scale = 1 texel per tz/ty metres
    gz = np.gradient(hgt, axis=1) / tz
    gy = -np.gradient(hgt, axis=0) / ty
    nrm = np.dstack([-gz, -gy, np.ones_like(hgt)])
    nrm /= np.linalg.norm(nrm, axis=2, keepdims=True)
    save(nrm * 0.5 + 0.5, "T_falls_rock_macro_n.png", N)


# ============================================================================================== foliage atlas ==
def leaf_sprites():
    a = np.asarray(Image.open(os.path.join(DL, "leaves", "island_tree_01_leaves_alpha_1k.png")).convert("L"))
    d = np.asarray(Image.open(os.path.join(DL, "leaves", "island_tree_01_leaves_diff_1k.png")).convert("RGB"))
    lab, n = ndimage.label(a > 100)
    out = []
    for sl in ndimage.find_objects(lab):
        h = sl[0].stop - sl[0].start
        w = sl[1].stop - sl[1].start
        if h * w < 2000 or max(h, w) / min(h, w) < 1.5 or (lab[sl] > 0).mean() > 0.82:
            continue
        rgba = np.dstack([d[sl], np.where(lab[sl] > 0, a[sl], 0)]).astype(np.uint8)
        im = Image.fromarray(rgba, "RGBA")
        if w > h:
            im = im.rotate(90, expand=True)
        out.append(im)                                     # stem at the bottom, tip at the top
    print("leaf sprites:", len(out))
    return out


def tint_sprite(im, mul):
    a = np.asarray(im, np.float32).copy()
    a[..., :3] = np.clip(a[..., :3] * np.asarray(mul, np.float32)[None, None, :], 0, 255)
    return Image.fromarray(a.astype(np.uint8), "RGBA")


def put_leaf(card, sp, x, y, length, ang_deg, mul):
    """Paste a leaf sprite with its stem at (x, y), pointing at ang_deg (0 = up, + = clockwise)."""
    k = length / sp.size[1]
    im = sp.resize((max(2, int(sp.size[0] * k)), max(2, int(sp.size[1] * k))), Image.BILINEAR)
    im = tint_sprite(im, mul)
    w, h = im.size
    big = Image.new("RGBA", (h * 2 + 4, h * 2 + 4), (0, 0, 0, 0))
    big.alpha_composite(im, (h + 2 - w // 2, 2))           # stem (bottom of the sprite) at the centre of `big`
    big = big.rotate(-ang_deg, resample=Image.BICUBIC)
    card.alpha_composite(big, (int(x - big.size[0] / 2), int(y - big.size[1] / 2)))


GREENS = [(0.80, 1.08, 0.55), (0.72, 1.0, 0.48), (0.88, 1.12, 0.52), (0.66, 0.92, 0.46), (0.95, 1.12, 0.58)]


def spray_card(S, sprites, rng, hanging=False):
    """A broadleaf twig spray, base at the bottom centre (or hanging from the top centre)."""
    card = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    dr = ImageDraw.Draw(card)
    leaves = []

    def twig(x, y, ang, length, width, depth):
        x2 = x + math.sin(ang) * length
        y2 = y + (math.cos(ang) * length if hanging else -math.cos(ang) * length)
        dr.line((x, y, x2, y2), fill=(86, 70, 48, 255), width=max(1, int(width)))
        n = int(length / (S * 0.035))
        for i in range(1, n + 1):
            t = i / (n + 0.5)
            px, py = x + (x2 - x) * t, y + (y2 - y) * t
            for sgn in (-1, 1):
                a = ang + sgn * rng.uniform(0.6, 1.2)
                leaves.append((rng.random(), px, py, a, depth))
        leaves.append((rng.random(), x2, y2, ang, depth))
        if depth > 0:
            for _ in range(2):
                twig(x + (x2 - x) * rng.uniform(0.35, 0.8), y + (y2 - y) * rng.uniform(0.35, 0.8),
                     ang + rng.choice([-1, 1]) * rng.uniform(0.35, 0.8), length * rng.uniform(0.45, 0.65), width * 0.6, depth - 1)
    y0 = S * 0.02 if hanging else S * 0.99
    for _ in range(3):
        twig(S * 0.5 + rng.uniform(-S * 0.04, S * 0.04), y0, rng.uniform(-0.55, 0.55), S * rng.uniform(0.6, 0.85),
             S * 0.012, 2)
    leaves.sort()
    for depth, x, y, a, d in leaves:
        sp = sprites[rng.integers(len(sprites))]
        L = S * rng.uniform(0.075, 0.115)
        g = GREENS[rng.integers(len(GREENS))]
        sh = 0.55 + 0.55 * depth
        ang = math.degrees(a) + (180 if hanging else 0)
        put_leaf(card, sp, x, y, L, ang, [g[0] * sh, g[1] * sh, g[2] * sh])
    return card


def fern_card(S, rng):
    """A fern frond: rachis from the bottom centre to the top, pinnae pairs (lobed, tapering to the tip)."""
    card = Image.new("RGBA", (S * 2, S * 2), (0, 0, 0, 0))
    dr = ImageDraw.Draw(card)
    S2 = S * 2
    n = 26
    pts = []
    for i in range(n + 1):
        t = i / n
        pts.append((S2 * 0.5 + S2 * 0.06 * math.sin(t * 2.2) , S2 * (0.995 - 0.97 * t)))
    for i in range(3, n):
        t = i / n
        x, y = pts[i]
        L = S2 * 0.42 * math.sin(math.pi * min(1.0, 0.1 + 0.95 * t)) ** 0.9 * (1 - 0.15 * t)
        for sgn in (-1, 1):
            ang = math.radians(62 + 20 * t) * sgn
            base_c = np.array([0.30, 0.52, 0.14]) * rng.uniform(0.85, 1.15) * (0.85 + 0.25 * t)
            nl = max(3, int(L / (S2 * 0.022)))
            for j in range(nl):
                u = j / nl
                px = x + math.sin(ang) * L * u
                py = y - math.cos(ang) * L * u - L * 0.12 * u * u
                r = S2 * 0.013 * (1 - 0.7 * u) + 1.2
                c = tuple(int(255 * min(1, v * (0.85 + 0.3 * rng.random()))) for v in base_c)
                dr.ellipse((px - r * 1.1, py - r * 0.75, px + r * 1.1, py + r * 0.75), fill=c + (255,))
            dr.line((x, y, x + math.sin(ang) * L, y - math.cos(ang) * L - L * 0.12), fill=(70, 100, 40, 255),
                    width=max(1, int(S2 * 0.003)))
    dr.line(pts, fill=(78, 92, 46, 255), width=int(S2 * 0.009))
    return card.resize((S, S), Image.LANCZOS)


def grass_card(S, rng):
    """A clump of grass / sedge blades rising from the bottom centre."""
    card = Image.new("RGBA", (S * 2, S * 2), (0, 0, 0, 0))
    dr = ImageDraw.Draw(card)
    S2 = S * 2
    blades = []
    for i in range(110):
        bx = S2 * 0.5 + rng.normal(0, S2 * 0.07)
        h = S2 * rng.uniform(0.45, 0.97)
        lean = rng.normal(0, 0.35)
        w = S2 * rng.uniform(0.007, 0.014)
        blades.append((rng.random(), bx, h, lean, w))
    blades.sort()
    for depth, bx, h, lean, w in blades:
        n = 8
        left, right = [], []
        for k in range(n + 1):
            t = k / n
            x = bx + lean * h * t * t * 0.6
            y = S2 * 0.995 - h * (t - 0.12 * lean * lean * t * t)
            ww = w * (1 - t) + 0.6
            left.append((x - ww, y))
            right.append((x + ww, y))
        g = np.array([0.36, 0.58, 0.16]) * (0.55 + 0.6 * depth) * rng.uniform(0.85, 1.15)
        if rng.random() < 0.15:
            g = np.array([0.62, 0.62, 0.30]) * (0.7 + 0.4 * depth)
        c = tuple(int(255 * min(1, v)) for v in g)
        dr.polygon(left + right[::-1], fill=c + (255,))
    return card.resize((S, S), Image.LANCZOS)


def fill_rgb(im):
    a = np.asarray(im, np.float32)
    rgb, al = a[..., :3], a[..., 3]
    mask = al > 8
    if mask.any():
        idx = ndimage.distance_transform_edt(~mask, return_distances=False, return_indices=True)
        rgb = rgb[idx[0], idx[1]]
    return Image.fromarray(np.dstack([rgb, al]).astype(np.uint8), "RGBA")


def foliage():
    sprites = leaf_sprites()
    rng = np.random.default_rng(7)
    S = 512
    atlas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    atlas.alpha_composite(spray_card(S * 2, sprites, rng).resize((S, S), Image.LANCZOS), (0, 0))
    atlas.alpha_composite(fern_card(S, rng), (S, 0))
    atlas.alpha_composite(grass_card(S, rng), (0, S))
    atlas.alpha_composite(spray_card(S * 2, sprites, rng, hanging=True).resize((S, S), Image.LANCZOS), (S, S))
    fill_rgb(atlas).save(os.path.join(OUT, "T_falls_foliage.png"))
    print("wrote T_falls_foliage.png")


if __name__ == "__main__":
    jobs = {"rock": rock, "ground": ground, "macro": macro, "foliage": foliage}
    for n in (sys.argv[1:] or list(jobs)):
        jobs[n]()
