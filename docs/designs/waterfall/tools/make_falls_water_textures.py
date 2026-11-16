"""B1 waterfall W2: the two water textures (system Python: numpy + PIL + scipy). Design: docs/designs/waterfall/design.md 5.2.

  python make_falls_water_textures.py [OUT_DIR]        # default art/village/work/tex

  T_falls_flow.png   512^2 RGBA, data (linear, not colour), TILEABLE in u and v, one tile = 4 m x 4 m of water:
        R  streak noise A  long fine streaks running along v (the flow direction), 0..1, mean ~0.5
        G  streak noise B  a different, coarser streak scale (sampled at a different speed than R)
        B  foam clumps     lacy bubble foam in clumps: 1 = foam, 0 = clear water (also used as the foam mound texture)
        A  aeration blotches  soft low-frequency noise 0..1 (breaks the sheet up, drives holes at the edges)
  T_mist_atlas.png   256^2 RGBA, 4 x 4 atlas of 64^2 soft mist puffs (cell k = row k // 4, column k % 4; row 0 on top),
        white-blue colour, alpha = puff density; a 2 px transparent border in each cell (no bleeding between cells).

Both are seeded: the same pixels on every run.
"""
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.spatial import cKDTree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DEFAULT = os.path.join(ROOT, "work", "tex")


def norm01(a, lo=1.0, hi=99.0):
    l, h = np.percentile(a, [lo, hi])
    return np.clip((a - l) / (h - l + 1e-9), 0.0, 1.0)


def spectral_noise(n, seed, su, sv, power=0.0):
    """Periodic Gaussian noise: white noise filtered in frequency space (cycles per tile: su along u (x), sv along v (y)).
    Large su + small sv = streaks that are long in v."""
    rng = np.random.default_rng(seed)
    w = rng.standard_normal((n, n))
    F = np.fft.fft2(w)
    fv = np.fft.fftfreq(n) * n  # rows = v
    fu = np.fft.fftfreq(n) * n  # cols = u
    FU, FV = np.meshgrid(fu, fv)
    filt = np.exp(-((FU / su) ** 2 + (FV / sv) ** 2))
    filt[0, 0] = 0.0
    out = np.fft.ifft2(F * filt).real
    return norm01(out)


def periodic_cells(n, count, seed):
    """F1, F2 distances of `count` random points on a periodic unit tile, as images n x n (units of the tile)."""
    rng = np.random.default_rng(seed)
    pts = rng.random((count, 2))
    tree = cKDTree(pts, boxsize=1.0)
    g = (np.arange(n) + 0.5) / n
    xx, yy = np.meshgrid(g, g)
    d, _ = tree.query(np.stack([xx.ravel(), yy.ravel()], 1), k=2)
    return d[:, 0].reshape(n, n), d[:, 1].reshape(n, n)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def make_flow(n=512):
    # streaks: sharp across u (high su), long along v (low sv). Slight contrast curve so streaks read as filaments.
    r = spectral_noise(n, 101, su=48.0, sv=5.0)
    r = smoothstep(0.18, 0.82, r)
    g = spectral_noise(n, 202, su=18.0, sv=3.0)
    g = smoothstep(0.15, 0.85, g)
    # foam: clumps (blobby low-frequency mask) x lacy bubble pattern (cell rims) at two bubble sizes
    f1, f2 = periodic_cells(n, 900, 303)
    lace = 1.0 - smoothstep(0.0, 0.0105, f2 - f1)            # bright thin rims between bubbles
    f1b, f2b = periodic_cells(n, 260, 404)
    lace_b = 1.0 - smoothstep(0.0, 0.016, f2b - f1b)
    clumps = smoothstep(0.42, 0.66, spectral_noise(n, 505, su=9.0, sv=9.0))
    bubble_fill = smoothstep(0.012, 0.0, f1) * 0.0 + (1.0 - smoothstep(0.0, 0.018, f1)) * 0.55  # a faint disc in each bubble
    foam = np.clip((np.maximum(lace, lace_b * 0.85) + bubble_fill) * clumps + 0.12 * clumps, 0.0, 1.0)
    foam = ndimage.gaussian_filter(foam, 0.6, mode="wrap")
    foam = np.clip(foam * 1.25, 0.0, 1.0)
    a = spectral_noise(n, 606, su=6.0, sv=8.0)
    a = smoothstep(0.1, 0.9, a)
    img = np.stack([r, g, foam, a], -1)
    return Image.fromarray((img * 255 + 0.5).astype(np.uint8), "RGBA")


def fbm_open(n, seed, base=4.0, octaves=4):
    out = np.zeros((n, n))
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        out += amp * spectral_noise(n, seed + o * 17, su=base * 2 ** o, sv=base * 2 ** o) - amp * 0.5
        tot += amp
        amp *= 0.5
    return out / tot + 0.5


def make_mist(cell=64, grid=4):
    n = cell * grid
    atlas = np.zeros((n, n, 4), np.float32)
    col = np.array([0.935, 0.965, 0.985], np.float32)
    rng = np.random.default_rng(77)
    yy, xx = np.mgrid[0:cell, 0:cell].astype(np.float32)
    for k in range(grid * grid):
        r0, c0 = divmod(k, grid)
        # a puff = a few soft lobes (random centres) with a billowy fbm edge
        dens = np.zeros((cell, cell), np.float32)
        for _ in range(3 + rng.integers(0, 3)):
            cx = cell * (0.5 + rng.uniform(-0.14, 0.14))
            cy = cell * (0.5 + rng.uniform(-0.15, 0.15))
            rad = cell * rng.uniform(0.24, 0.36)
            rr = np.hypot(xx - cx, (yy - cy) * rng.uniform(0.85, 1.25)) / rad
            dens = np.maximum(dens, np.clip(1 - rr, 0, 1) ** 1.05)
        nz = fbm_open(cell, 900 + k * 5, base=2.0, octaves=3)
        dens = np.clip(dens * (0.55 + 0.9 * nz) - 0.04, 0, 1)
        dens = ndimage.gaussian_filter(dens, 1.1)
        # border: fade to zero over the outer 6 px so a puff never touches the cell edge
        edge = np.minimum(np.minimum(xx, cell - 1 - xx), np.minimum(yy, cell - 1 - yy))
        dens *= smoothstep(1.0, 9.0, edge)
        dens *= smoothstep(0.5, 0.3, np.hypot(xx - cell / 2, yy - cell / 2) / cell)   # round window: no square cut-off
        dens = np.clip(dens * 0.85, 0, 1)
        shade = 0.93 + 0.07 * (1.0 - yy / cell)           # a touch brighter on top (sky light)
        sl = (slice(r0 * cell, (r0 + 1) * cell), slice(c0 * cell, (c0 + 1) * cell))
        atlas[sl][..., :3] = col[None, None, :] * shade[..., None]
        atlas[sl][..., 3] = dens
    return Image.fromarray((np.clip(atlas, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")


def main(argv):
    out = argv[0] if argv else OUT_DEFAULT
    os.makedirs(out, exist_ok=True)
    make_flow().save(os.path.join(out, "T_falls_flow.png"), optimize=True)
    print("wrote", os.path.join(out, "T_falls_flow.png"))
    make_mist().save(os.path.join(out, "T_mist_atlas.png"), optimize=True)
    print("wrote", os.path.join(out, "T_mist_atlas.png"))


if __name__ == "__main__":
    main(sys.argv[1:])
