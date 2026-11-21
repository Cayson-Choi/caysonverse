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


def upper(rng):
    """Thin flaky orange plates."""
    wx = periodic_noise(rng, 3, 2, 0.022) + periodic_noise(rng, 2, 16, 0.004)
    wy = periodic_noise(rng, 3, 2, 0.03) + periodic_noise(rng, 2, 16, 0.004)
    f1, f2, cid = voronoi(rng, 15, 8, wx, wy, 0.5)
    edge = f2 - f1
    crack = 1 - smooth(0.0, 0.07, edge)  # thin dark cracks between plates
    lip = smooth(0.0, 0.22, edge)  # a plate's edge curls a little up from the crack, then flattens
    # the peeling layers: a finer Voronoi, each of its cells one layer deep (0 outer .. 2 fresh), cut by the plates
    g1, g2, sid = voronoi(rng, 38, 22, wx * 1.6 + periodic_noise(rng, 2, 8, 0.006), wy * 1.3, 0.62, 0.95)
    lay_r = rng.random(38 * 22 + 1).astype(np.float32)
    plate_r = rng.random(15 * 8 + 1).astype(np.float32)
    layer = np.floor(lay_r[sid] * 3.0)  # 0, 1, 2
    plate_age = plate_r[cid]
    # a weathered plate keeps more of its outer layer
    layer = np.where(plate_age > 0.62, np.minimum(layer, 1), layer)
    flake_edge = 1 - smooth(0.0, 0.05, g2 - g1)
    grain = periodic_noise(rng, 3, 32, 1.0)
    fine = periodic_noise(rng, 2, 96, 1.0)
    h = 0.55 * lip + 0.22 * (2 - layer) / 2 + 0.05 * grain + 0.025 * fine - 0.08 * flake_edge * (layer < 2) - 0.6 * crack
    h = np.clip(h, -0.6, 1.2)
    # colours: fresh (layer 2) salmon / cinnamon, middle orange, outer duller brown-orange with a grey bloom
    fresh, mid, outer, bloom, crackc = srgb(["#D4875C", "#B8603A", "#8E5038", "#8F8780", "#2C1D17"])
    c = np.where((layer == 2)[..., None], fresh, np.where((layer == 1)[..., None], mid, outer))
    bloom_k = np.clip((plate_age - 0.45) * 1.4, 0, 0.55) * (layer == 0) * smooth(-0.3, 0.6, grain)
    c = c * (1 - bloom_k[..., None]) + bloom * bloom_k[..., None]
    # per-plate tone, the grain, a darker line at the flake edges (their shadow) and in the cracks
    tone = 0.88 + 0.24 * plate_r[cid]
    c = c * tone[..., None] * (1 + 0.1 * grain[..., None] + 0.06 * fine[..., None])
    c = c * (1 - 0.35 * flake_edge * (layer < 2))[..., None]
    c = c * (1 - crack[..., None]) + crackc * crack[..., None]
    # cavity: the lower the surface, the darker
    cav = smooth(-0.4, 0.6, h - blur(h, 6))
    c = c * (0.78 + 0.22 * cav)[..., None]
    return np.clip(c, 0, 1), h


def base(rng):
    """Thick grey-brown blocky plates, deep fissures."""
    wx = periodic_noise(rng, 3, 2, 0.03) + periodic_noise(rng, 2, 12, 0.006)
    wy = periodic_noise(rng, 2, 2, 0.02)
    f1, f2, cid = voronoi(rng, 7, 3, wx, wy, 0.38, 0.8)
    edge = f2 - f1
    fissure = 1 - smooth(0.0, 0.32, edge)  # wide V-shaped furrows
    deep = 1 - smooth(0.0, 0.1, edge)
    # cross splits: the plates broken into blocks (a coarse horizontal Voronoi), shallower than the furrows
    g1, g2, sid = voronoi(rng, 12, 9, wx * 1.3, wy + periodic_noise(rng, 2, 6, 0.01), 1.6, 0.9)
    split = (1 - smooth(0.0, 0.07, g2 - g1)) * smooth(0.1, 0.35, edge)
    flakes1, flakes2, fid = voronoi(rng, 40, 26, wx * 2.0, wy * 2.0, 0.7, 0.95)
    fl_r = rng.random(40 * 26 + 1).astype(np.float32)
    flake_edge = 1 - smooth(0.0, 0.05, flakes2 - flakes1)
    plate_r = rng.random(7 * 3 + 1).astype(np.float32)
    block_r = rng.random(12 * 9 + 1).astype(np.float32)
    grain = periodic_noise(rng, 3, 24, 1.0)
    fine = periodic_noise(rng, 2, 80, 1.0)
    h = 1.0 - 1.1 * fissure ** 1.4 - 0.35 * split + 0.08 * (fl_r[fid] - 0.5) - 0.05 * flake_edge + 0.06 * grain + 0.03 * fine
    top, top2, warm, furrow, deepc = srgb(["#7E736A", "#6A5D53", "#8A5A42", "#5A3526", "#22150F"])
    k = block_r[sid][..., None]
    c = top * (1 - k * 0.6) + top2 * (k * 0.6)
    # where a flake fell off, the reddish under-bark shows; more of it toward the furrow
    warm_k = (np.clip((fl_r[fid] - 0.72) * 3.0, 0, 1) * 0.7 + 0.5 * fissure * (1 - deep))[..., None]
    c = c * (1 - warm_k) + warm * warm_k
    c = c * (1 - fissure[..., None] * 0.55) + furrow * (fissure[..., None] * 0.55)
    c = c * (1 - deep[..., None]) + deepc * deep[..., None]
    c = c * (0.9 + 0.2 * plate_r[cid])[..., None] * (1 + 0.12 * grain[..., None] + 0.07 * fine[..., None])
    c = c * (1 - 0.25 * flake_edge - 0.3 * split)[..., None]
    cav = smooth(-0.5, 0.5, h - blur(h, 8))
    c = c * (0.75 + 0.25 * cav)[..., None]
    return np.clip(c, 0, 1), h


def save(out: Path, name: str, col, h, strength):
    img = Image.fromarray((col * 255 + 0.5).astype(np.uint8), "RGB")
    img.save(out / f"{name}_c1024.jpg", quality=86, optimize=True)
    img.resize((512, 512), Image.LANCZOS).save(out / f"{name}_c512.jpg", quality=86, optimize=True)
    nrm = normal_map(h, strength)
    nimg = Image.fromarray((nrm * 255 + 0.5).astype(np.uint8), "RGB")
    nimg.resize((512, 512), Image.LANCZOS).save(out / f"{name}_n512.jpg", quality=88, optimize=True)
    nimg.resize((256, 256), Image.LANCZOS).save(out / f"{name}_n256.jpg", quality=88, optimize=True)
    mean = col.reshape(-1, 3).mean(0)
    print(name, "mean", "#%02X%02X%02X" % tuple(int(v * 255 + 0.5) for v in mean))


def main():
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    c, h = upper(np.random.default_rng(1127))
    save(out, "pine_bark", c, h, 30.0)
    c, h = base(np.random.default_rng(2045))
    save(out, "pine_base", c, h, 40.0)


if __name__ == "__main__":
    main()
