"""Brand-new house exterior sets, third pass (2026-11-27, fix/house-exterior): fully procedural, no third-party pixels.

    python tools/house-ext/make_house_fresh_textures.py [--out client/public/models/village/houses] [--preview <dir>]

The audit (tmpshots/exteriors13) found the second pass's scans looking old: the render's Plaster001 trowel swirls (stretched
4.2x in the shader) read as stains, the sandstone's mossy_sandstone crop repeated as a lichen-blob grid, and the
clay_roof_tiles_03 photo carried straw, soot and broken tones. These three sets are rebuilt here as NEW surfaces:

  render     (LM_render, 2.0 m per tile)  a fine sand-float lime render: sand grain 1-3 mm, a faint float texture, no
             low-frequency cloud at all. A bright neutral; the house's pastel is the vertex colour.
  sandstone  (LM_stone, 1.0 m per tile)   dressed Vosges sandstone: fine sand grain, faint bedding laminae along U and a
             light claw-tooled striation (scharriert) across them, a bright warm neutral; pink / buff is the vertex colour.
  tile       (LM_roof, 2.0 m x 14 rows)   Biberschwanz (beaver-tail) clay tiles, new from the kiln: 11 tiles of 18 cm per
             row, segmental butts, double-lap (each row half a tile over), a slight camber across each tile, crisp edges,
             the butt's shadow on the course below, a fresh range of kiln tones (no soot, no moss, no straw). Each modelled
             course maps rows in pairs (colmar_kit.py): the butt sits at a row's BOTTOM edge in the image.

Everything tiles seamlessly (the noise is made periodic in the frequency domain). Normal maps are OpenGL (+Y up, glTF), with a
512 px copy for the light tier. Sizes and names are the ones house_textures.json already lists, so no other file changes.
"""
import argparse
import os

import numpy as np
from PIL import Image

N = 1024
ROWS = 14
TILES_PER_ROW = 11
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")


def s2l(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def l2s(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def band_noise(rng, lo, hi, shape=(N, N), aniso=(1.0, 1.0)):
    """Periodic noise whose features are between `lo` and `hi` pixels (wavelength), unit std. `aniso` stretches (x, y)."""
    h, w = shape
    white = rng.standard_normal(shape)
    fy = np.fft.fftfreq(h)[:, None] * aniso[1]
    fx = np.fft.fftfreq(w)[None, :] * aniso[0]
    f = np.sqrt(fx * fx + fy * fy) + 1e-9
    wl = 1.0 / f
    filt = np.exp(-0.5 * (np.log(wl / np.sqrt(lo * hi)) / (0.5 * np.log(hi / lo) + 0.35)) ** 2)
    out = np.real(np.fft.ifft2(np.fft.fft2(white) * filt))
    return (out - out.mean()) / (out.std() + 1e-9)


def height_to_normal(h, strength):
    """Height (1 = up) -> OpenGL tangent normal in 0..1 (x right, y up in the image), wrapping."""
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    dy = (np.roll(h, 1, 0) - np.roll(h, -1, 0)) * 0.5
    v = np.stack([-dx * strength, -dy * strength, np.ones_like(h)], -1)
    v /= np.linalg.norm(v, axis=-1, keepdims=True)
    return v * 0.5 + 0.5


LUMA = np.array([0.2126, 0.7152, 0.0722])


# ───────────────────────────────────────── render ─────────────────────────────────────────
def set_render():
    rng = np.random.default_rng(1127)
    sand = band_noise(rng, 1.2, 3.0)                       # 2-6 mm sand grains (2 mm / px)
    grit = band_noise(rng, 3.0, 7.0)
    flt = band_noise(rng, 18.0, 60.0, aniso=(1.0, 1.6))    # the float's faint arcs, 4-12 cm
    # sparse coarser grains standing proud
    spark = rng.random((N, N))
    proud = (spark > 0.9965).astype(float)
    proud = np.real(np.fft.ifft2(np.fft.fft2(proud) * np.fft.fft2(np.pad(np.ones((2, 2)), ((0, N - 2), (0, N - 2))))))
    h = sand * 0.55 + grit * 0.35 + flt * 0.10 + proud * 0.9
    # albedo: a bright neutral lime white, the grain's cavities a touch darker; NO low-frequency variation
    lum = 0.80 * (1 + sand * 0.018 + grit * 0.012 + flt * 0.006 - np.clip(-h, 0, None) * 0.012)
    alb = l2s(np.clip(lum, 0, 1))[..., None].repeat(3, -1)
    nor = height_to_normal(h, 0.55)
    rou = np.clip(0.90 + sand * 0.025 - proud * 0.05, 0.75, 0.98)
    return alb, nor, rou


# ───────────────────────────────────────── sandstone ─────────────────────────────────────────
def set_sandstone():
    rng = np.random.default_rng(2711)
    grain = band_noise(rng, 1.0, 2.5)                      # ~1-2.5 mm sand (1 mm / px)
    fine = band_noise(rng, 2.5, 6.0)
    lam = band_noise(rng, 30.0, 120.0, aniso=(0.06, 1.0))  # bedding laminae, long along U
    lam2 = band_noise(rng, 6.0, 18.0, aniso=(0.15, 1.0))
    # claw-tooled striation: fine parallel strokes across the bedding, every ~6 mm, each stroke's depth wandering
    xs = np.arange(N)[None, :]
    wander = band_noise(rng, 40.0, 200.0) * 2.0
    stroke = 0.5 + 0.5 * np.cos(2 * np.pi * (xs + wander) / 6.4)
    depth = 0.55 + 0.45 * band_noise(rng, 60.0, 240.0, aniso=(1.0, 0.3))
    tool = (stroke ** 3) * np.clip(depth, 0, 1.4)
    h = grain * 0.45 + fine * 0.35 + lam2 * 0.15 - tool * 0.55
    lum = 0.62 * (1 + grain * 0.045 + fine * 0.03 + lam * 0.03 + lam2 * 0.015 - tool * 0.03)
    base = np.array([1.0, 0.94, 0.86])
    alb = l2s(np.clip(lum[..., None] * base, 0, 1))
    nor = height_to_normal(h, 0.9)
    rou = np.clip(0.84 + grain * 0.03 + tool * 0.03, 0.7, 0.97)
    return alb, nor, rou


# ───────────────────────────────────────── beaver-tail tiles ─────────────────────────────────────────
def set_tile():
    rng = np.random.default_rng(1811)
    H = W = N
    rh = H / ROWS
    tw = W / TILES_PER_ROW
    # a fresh kiln range of natural-red clay (linear): orange-red to a slightly deeper red, all clean
    clay = np.array([[0.53, 0.135, 0.058], [0.50, 0.125, 0.052], [0.58, 0.155, 0.066], [0.47, 0.118, 0.052],
                     [0.555, 0.15, 0.07], [0.515, 0.14, 0.064]])
    alb = np.zeros((H, W, 3))
    hgt = np.zeros((H, W))
    rou = np.zeros((H, W))
    sand = band_noise(rng, 1.0, 2.5)
    face = band_noise(rng, 6.0, 30.0)
    xx = np.arange(W, dtype=float)
    for r in range(ROWS):
        y0, y1 = int(round(r * rh)), int(round((r + 1) * rh))
        ys = np.arange(y0, y1, dtype=float)
        t = (ys - y0) / (y1 - y0)                           # 0 at the row's top (under the course above), 1 at the butt
        off = (r % 2) * tw * 0.5
        for k in range(TILES_PER_ROW + 1):
            xa = (off + k * tw) % W
            cols = (xx - xa) % W
            sel = cols < tw
            u = (cols[sel] / tw) * 2 - 1                    # -1 .. 1 across the tile
            gap = np.abs(u) > 1 - 2.2 / tw                  # ~1.1 px joint each side
            arc = 1 - 0.20 * u ** 2                         # the segmental butt (row fraction; 1 = the row's bottom)
            inside = (t[:, None] <= arc[None, :]) & ~gap[None, :]
            c = clay[rng.integers(len(clay))] * (1 + rng.normal(0, 0.035))
            c = c * np.array([1, 1 + rng.normal(0, 0.03), 1 + rng.normal(0, 0.04)])
            # camber across the tile and a gentle rise to the butt; edges eased
            camber = 1 - u ** 2
            ease_side = np.clip((1 - np.abs(u)) / 0.07, 0, 1)
            dist_butt = np.clip((arc[None, :] - t[:, None]) * (y1 - y0) / 2.5, 0, 1)   # px to the butt edge, eased
            body_h = 0.62 + 0.10 * camber[None, :] + 0.10 * t[:, None]
            body_h = body_h * (0.55 + 0.45 * np.minimum(ease_side[None, :], dist_butt))
            shade = 0.93 + 0.07 * camber[None, :] + 0.03 * t[:, None]
            # a kiln flash: one side or end of the tile a little warmer / deeper (new tiles vary like this, cleanly)
            fx, fy = rng.normal(0, 0.05), rng.normal(0, 0.04)
            shade = shade * (1 + fx * u[None, :] + fy * (t[:, None] - 0.5))
            col = c[None, None, :] * shade[..., None]
            under = c[None, None, :] * 0.30                 # the course below, in the butt's shadow
            sub_a = alb[y0:y1]
            sub_a[:, sel] = np.where(inside[..., None], col, under)
            sub_h = hgt[y0:y1]
            sub_h[:, sel] = np.where(inside, body_h, 0.10)
            sub_r = rou[y0:y1]
            sub_r[:, sel] = np.where(inside, 0.68 + rng.normal(0, 0.025), 0.85)
        # the butt of the course above shades this row's top
        sh = np.clip(1 - np.arange(y1 - y0) / (rh * 0.30), 0, 1) ** 1.7
        alb[y0:y1] *= (1 - 0.50 * sh)[:, None, None]
        hgt[y0:y1] -= (0.20 * sh)[:, None]
    # fired-clay surface: fine sand-faced grain, a faint face texture, a few darker iron specks (clean, not soot)
    speck = (rng.random((H, W)) > 0.9985).astype(float)
    alb *= (1 + sand[..., None] * 0.07 + face[..., None] * 0.035 - speck[..., None] * 0.18)
    alb = l2s(np.clip(alb, 0, 1))
    nor = height_to_normal(hgt * 1.0 + sand * 0.012 + face * 0.006, 7.0)
    rou = np.clip(rou + sand * 0.02, 0.5, 0.95)
    return alb, nor, rou


def save(out, name, alb, nor, rou, preview=None):
    os.makedirs(out, exist_ok=True)
    stats = {}
    for kind, a, mode, q in (("albedo", alb, "RGB", 86), ("normal", nor, "RGB", 84), ("rough", rou, "L", 72)):
        img = Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8), mode)
        img.save(os.path.join(out, f"house_{name}_{kind}.webp"), "WEBP", quality=q, method=6)
        if kind == "normal":
            img.resize((512, 512), Image.LANCZOS).save(os.path.join(out, f"house_{name}_normal_512.webp"), "WEBP", quality=88, method=6)
        if preview:
            os.makedirs(preview, exist_ok=True)
            img.save(os.path.join(preview, f"{name}_{kind}.png"))
    lin = s2l(alb)
    stats["mean_lum_lin"] = float((lin @ LUMA).mean())
    return stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "client", "public", "models", "village", "houses"))
    ap.add_argument("--preview", default=None)
    ap.add_argument("--only", default="render,sandstone,tile")
    a = ap.parse_args()
    sets = {"render": set_render, "sandstone": set_sandstone, "tile": set_tile}
    for name in a.only.split(","):
        print(name, save(a.out, name, *sets[name](), preview=a.preview))


if __name__ == "__main__":
    main()
