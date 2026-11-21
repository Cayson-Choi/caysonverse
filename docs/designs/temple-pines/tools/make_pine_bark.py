"""Korean red pine (소나무, Pinus densiflora) bark textures for the temple yard's pines (2026-11-21).

    python -I docs/designs/temple-pines/tools/make_pine_bark.py <out dir>

Two seamless (tileable both ways) bark tiles, colour + OpenGL normal map, grown here (no photo: the repo had no pine bark; the
village's `plates` photo is a zelkova's grey bark), matched to reference photos of temple pines (Myogaksa, Yeongtapsa, Songbulam;
Commons close-ups of P. densiflora bark):
  - `pine_bark`: the upper trunk and limbs: thin papery plates 5-9 cm wide, 10-18 cm tall, peeling in layers (terraces), fresh
    layers salmon / cinnamon orange, the outer ones duller orange-brown with a grey bloom, thin dark cracks between plates;
  - `pine_base`: the old lower trunk: thick grey-brown blocky plates 12-20 cm wide, 25-40 cm tall, split across, deep
    reddish-brown fissures between them.
One tile is ~1.07 m square of bark (treeKit's barkTube: a tile is one circumference of a 0.17 m trunk wide). Writes
pine_bark_c1024.jpg / c512, pine_bark_n512.jpg / n256, pine_base_c1024.jpg / c512, pine_base_n512.jpg / n256.
"""
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

N = 1024
yy, xx = np.meshgrid(np.arange(N) / N, np.arange(N) / N, indexing="ij")  # [0,1) tile coordinates; y down the image


def periodic_noise(rng, octaves, base=2, amp=1.0, gain=0.55):
    """Smooth periodic noise: sums of sines with integer wave numbers (tiles exactly)."""
    out = np.zeros((N, N), np.float32)
    a = amp
    f = base
    for _ in range(octaves):
        for _k in range(4):
            kx = rng.integers(-f, f + 1)
            ky = rng.integers(-f, f + 1)
            if kx == 0 and ky == 0:
                kx = f
            ph = rng.random() * 2 * math.pi
            out += a * np.sin(2 * math.pi * (kx * xx + ky * yy) + ph).astype(np.float32)
        a *= gain
        f *= 2
    return out / 4


def voronoi(rng, gx, gy, wx, wy, aspect, jitter=0.85):
    """Periodic Voronoi on a gx x gy jittered grid, the coordinates warped by (wx, wy); distance with y scaled by `aspect`
    (plates taller than wide). Returns F1, F2 (in x-cell units) and the nearest cell's id."""
    px = (np.arange(gx)[None, :] + 0.5 + (rng.random((gy, gx)) - 0.5) * jitter) / gx
    py = (np.arange(gy)[:, None] + 0.5 + (rng.random((gy, gx)) - 0.5) * jitter) / gy
    X = (xx + wx) % 1.0
    Y = (yy + wy) % 1.0
    cx = np.floor(X * gx).astype(int)
    cy = np.floor(Y * gy).astype(int)
    f1 = np.full((N, N), 1e9, np.float32)
    f2 = np.full((N, N), 1e9, np.float32)
    idc = np.zeros((N, N), np.int32)
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            ix = cx + ox
            iy = cy + oy
            sx = np.floor_divide(ix, gx)
            sy = np.floor_divide(iy, gy)
            ixm = ix % gx
            iym = iy % gy
            qx = px[iym, ixm] + sx
            qy = py[iym, ixm] + sy
            dx = (X - qx) * gx
            dy = (Y - qy) * gx * aspect
            d = np.sqrt(dx * dx + dy * dy).astype(np.float32)
            closer = d < f1
            f2 = np.where(closer, f1, np.minimum(f2, d))
            idc = np.where(closer, iym * gx + ixm, idc)
            f1 = np.where(closer, d, f1)
    return f1, f2, idc


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def srgb(hexes):
    return np.array([[int(h[i : i + 2], 16) / 255 for i in (1, 3, 5)] for h in hexes], np.float32)


def blur(a, r):
    """A periodic box blur (two passes ~ a soft tent)."""
    for _ in range(2):
        a = sum(np.roll(a, k, 0) for k in range(-r, r + 1)) / (2 * r + 1)
        a = sum(np.roll(a, k, 1) for k in range(-r, r + 1)) / (2 * r + 1)
    return a


def normal_map(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    # OpenGL: +x right, +y up the picture (rows run down, so the up-gradient is -dy)
    nx = -dx * strength
    ny = dy * strength
    nz = np.ones_like(h)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / l, ny / l, nz / l], -1) * 0.5 + 0.5


def value_noise(rng, freq_x, freq_y=None):
    """Periodic value noise (a random lattice, wrapped, smoothstep-interpolated): -1..1."""
    fy = freq_y or freq_x
    g = rng.random((fy, freq_x)).astype(np.float32) * 2 - 1
    X = xx * freq_x
    Y = yy * fy
    x0 = np.floor(X).astype(int)
    y0 = np.floor(Y).astype(int)
    tx = X - x0
    ty = Y - y0
    tx = tx * tx * (3 - 2 * tx)
    ty = ty * ty * (3 - 2 * ty)
    x1 = (x0 + 1) % freq_x
    y1 = (y0 + 1) % fy
    x0 %= freq_x
    y0 %= fy
    a = g[y0, x0] * (1 - tx) + g[y0, x1] * tx
    b = g[y1, x0] * (1 - tx) + g[y1, x1] * tx
    return a * (1 - ty) + b * ty


def fbm(rng, f, octaves, gain=0.5, stretch=1):
    """Fractal value noise; `stretch` > 1 runs the features up the trunk (fibres, streaks)."""
    out = np.zeros((N, N), np.float32)
    a = 1.0
    tot = 0.0
    for _ in range(octaves):
        out += a * value_noise(rng, f, max(1, f // stretch))
        tot += a
        a *= gain
        f *= 2
    return out / tot


def relief(h, strength):
    """The light a surface of height `h` catches from the upper left (soft, baked: the bark reads at a distance too)."""
    n = normal_map(h, strength) * 2 - 1
    l = np.array([-0.45, 0.55, 0.7], np.float32)
    l /= np.linalg.norm(l)
    return np.clip(n @ l, 0, 1)


def upper(rng):
    """Thin flaky plates of the upper trunk: orange-red under a patchy grey-brown outer layer, ragged edges, fibrous."""
    wx = 0.03 * fbm(rng, 4, 3) + 0.006 * fbm(rng, 32, 3)
    wy = 0.04 * fbm(rng, 4, 3) + 0.006 * fbm(rng, 32, 3)
    f1, f2, cid = voronoi(rng, 15, 8, wx, wy, 0.5)
    edge = f2 - f1 + 0.03 * fbm(rng, 64, 2)
    crack = 1 - smooth(0.0, 0.05, edge)
    lip = smooth(0.0, 0.3, edge)
    # the peeling scales: a finer, ragged Voronoi; each scale one layer of the bark (0 the outer grey .. 2 fresh orange)
    sx = wx * 1.5 + 0.004 * fbm(rng, 64, 2)
    sy = wy * 1.3 + 0.004 * fbm(rng, 64, 2)
    g1, g2, sid = voronoi(rng, 40, 24, sx, sy, 0.6, 0.95)
    sedge = g2 - g1 + 0.025 * fbm(rng, 96, 2)
    lay_r = rng.random(40 * 24 + 1).astype(np.float32)
    plate_r = rng.random(15 * 8 + 1).astype(np.float32)
    # vertical bands where the grey outer scales still cling (the reference trunks: grey scaly streaks on orange)
    band = smooth(-0.15, 0.35, fbm(rng, 6, 3, 0.55, 3) + 0.25 * (plate_r[cid] - 0.5))
    layer_f = lay_r[sid] * 2.2 + 0.9 * (1 - band) + 0.05
    layer = np.clip(np.floor(layer_f), 0, 2)
    scale_edge = 1 - smooth(0.0, 0.035, sedge)
    fibre = fbm(rng, 48, 3, 0.55, 6)
    grain = fbm(rng, 96, 3)
    h = 0.5 * lip + 0.2 * (2 - layer) / 2 + 0.05 * fibre + 0.03 * grain - 0.06 * scale_edge * (layer < 2) - 0.5 * crack
    # colours: fresh (layer 2) cinnamon / salmon orange, middle rusty orange, outer grey-brown scales
    fresh = srgb(["#C9714A"])[0]
    mid = srgb(["#A8583A"])[0]
    outer = srgb(["#8C6A58"])[0]
    crackc = srgb(["#3B241B"])[0]
    c = np.where((layer == 2)[..., None], fresh, np.where((layer == 1)[..., None], mid, outer))
    # within a scale: the colour drifts (no flat cells), streaky along the fibres
    drift = 0.5 * fbm(rng, 24, 3) + 0.5 * fibre
    c = c * (1 + 0.16 * drift[..., None])
    warm = srgb(["#D48A5E"])[0]
    wk = np.clip(0.35 * (fbm(rng, 12, 3) + 0.3), 0, 0.5)[..., None] * (layer > 0)[..., None]
    c = c * (1 - wk) + warm * wk
    c = c * (0.9 + 0.2 * plate_r[cid])[..., None] * (1 + 0.07 * grain[..., None])
    c = c * (0.86 + 0.28 * ((lay_r[sid] * 7.31) % 1.0))[..., None]
    # the edge of an outer scale: a thin light rim (lifted), its shadow on the layer below
    c = c * (1 - 0.28 * scale_edge * (layer < 2))[..., None]
    c = c * (1 - 0.85 * crack[..., None]) + crackc * (0.85 * crack[..., None])
    lit = relief(h, 26.0)
    c = c * (0.72 + 0.38 * lit)[..., None]
    cav = smooth(-0.4, 0.5, h - blur(h, 6))
    c = c * (0.8 + 0.2 * cav)[..., None]
    return np.clip(c, 0, 1), h


def base(rng):
    """The old lower trunk: thick grey-brown scaly plates, blocky, deep reddish-brown fissures."""
    wx = 0.035 * fbm(rng, 4, 3) + 0.008 * fbm(rng, 24, 3)
    wy = 0.02 * fbm(rng, 3, 3) + 0.006 * fbm(rng, 24, 3)
    f1, f2, cid = voronoi(rng, 7, 3, wx, wy, 0.38, 0.8)
    edge = f2 - f1 + 0.05 * fbm(rng, 48, 3)
    fissure = 1 - smooth(0.0, 0.28, edge)
    deep = 1 - smooth(0.0, 0.08, edge)
    g1, g2, sid = voronoi(rng, 12, 9, wx * 1.3, wy + 0.01 * fbm(rng, 6, 2), 1.6, 0.9)
    split = (1 - smooth(0.0, 0.06, g2 - g1 + 0.03 * fbm(rng, 64, 2))) * smooth(0.1, 0.35, edge)
    k1, k2, fid = voronoi(rng, 44, 28, wx * 2.0 + 0.004 * fbm(rng, 96, 2), wy * 2.0, 0.7, 0.95)
    fl_r = rng.random(44 * 28 + 1).astype(np.float32)
    flake_edge = 1 - smooth(0.0, 0.04, k2 - k1 + 0.02 * fbm(rng, 128, 2))
    plate_r = rng.random(7 * 3 + 1).astype(np.float32)
    block_r = rng.random(12 * 9 + 1).astype(np.float32)
    grain = fbm(rng, 64, 4)
    fibre = fbm(rng, 32, 3, 0.55, 5)
    h = 1.0 - 1.05 * fissure ** 1.3 - 0.3 * split + 0.18 * (fl_r[fid] - 0.5) - 0.1 * flake_edge + 0.07 * grain + 0.04 * fibre
    top = srgb(["#8A8077"])[0]
    top2 = srgb(["#6E6258"])[0]
    warm = srgb(["#8E5840"])[0]
    furrow = srgb(["#5E3A2A"])[0]
    deepc = srgb(["#2A1913"])[0]
    k = (0.5 * block_r[sid] + 0.5 * smooth(-0.5, 0.5, fbm(rng, 16, 3)))[..., None]
    c = top * (1 - k) + top2 * k
    warm_k = (np.clip((fl_r[fid] - 0.74) * 3.0, 0, 1) * 0.65 + 0.55 * fissure * (1 - deep))[..., None]
    c = c * (1 - warm_k) + warm * warm_k
    c = c * (1 - fissure[..., None] * 0.5) + furrow * (fissure[..., None] * 0.5)
    c = c * (1 - 0.9 * deep[..., None]) + deepc * (0.9 * deep[..., None])
    c = c * (0.9 + 0.2 * plate_r[cid])[..., None] * (1 + 0.13 * grain[..., None] + 0.06 * fibre[..., None])
    c = c * (0.84 + 0.3 * fl_r[fid])[..., None] * (1 - 0.3 * flake_edge - 0.25 * split)[..., None]
    lit = relief(h, 30.0)
    c = c * (0.7 + 0.4 * lit)[..., None]
    cav = smooth(-0.5, 0.5, h - blur(h, 8))
    c = c * (0.78 + 0.22 * cav)[..., None]
    return np.clip(c, 0, 1), h


def save(out: Path, name: str, col, h, strength):
    """The village's bark-photo convention (make_veg_textures.py): linear values relative to the tile's own mean, x 0.5 (the
    vertex colour, the bark's mean colour / 0.5, carries the colour; the texture the pattern). Prints the mean (sRGB)."""
    lin = np.where(col <= 0.04045, col / 12.92, ((col + 0.055) / 1.055) ** 2.4)
    m = lin.reshape(-1, 3).mean(0)
    rel = np.clip(lin / m * 0.5, 0, 1)
    img = Image.fromarray((rel * 255 + 0.5).astype(np.uint8), "RGB")
    img.save(out / f"{name}_c1024.jpg", quality=88, optimize=True)
    img.resize((512, 512), Image.LANCZOS).save(out / f"{name}_c512.jpg", quality=88, optimize=True)
    nrm = normal_map(h, strength)
    nimg = Image.fromarray((nrm * 255 + 0.5).astype(np.uint8), "RGB")
    nimg.resize((512, 512), Image.LANCZOS).save(out / f"{name}_n512.jpg", quality=88, optimize=True)
    nimg.resize((256, 256), Image.LANCZOS).save(out / f"{name}_n256.jpg", quality=88, optimize=True)
    # a preview in colour (not shipped)
    Image.fromarray((col * 255 + 0.5).astype(np.uint8), "RGB").save(out / f"preview_{name}.jpg", quality=88)
    srgb_m = np.where(m <= 0.0031308, m * 12.92, 1.055 * m ** (1 / 2.4) - 0.055)
    print(name, "mean", "#%02X%02X%02X" % tuple(int(v * 255 + 0.5) for v in srgb_m))


def main():
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    c, h = upper(np.random.default_rng(1127))
    save(out, "pine_bark", c, h, 26.0)
    c, h = base(np.random.default_rng(2045))
    save(out, "pine_base", c, h, 40.0)


if __name__ == "__main__":
    main()
