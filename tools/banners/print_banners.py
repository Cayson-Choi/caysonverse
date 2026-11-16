"""Prints the street-banner art onto fabric: banners_raw.png (render_banners.mjs, 3072 x 3072, 6 x 2 banners of
512 x 1536 = 60 x 180 cm) -> client/public/models/village/street_banners.webp (1536 x 1536) and street_banners_1k.webp
(1024 x 1024, the light tier).

What a real polyester street banner (가로등 현수기) shows up close, put into its colour:
  - ink on fabric: dye never reaches full black or white and is a touch less saturated than the screen art;
  - sun fade: a season outside bleaches it unevenly, more at the top (the sunny side) and in soft blotches;
  - ink grain: the printer's fine speckle;
  - the sewn hems: a 6 cm rod pocket at the top and 4 cm at the bottom (folded fabric, a shade darker, its fold line and a
    double row of stitches), 1 cm side hems with a stitch line;
  - four nickel grommets (tie points) just inside the pockets at the corners.
The weave itself is too fine for the atlas (2.3 mm a texel): the game adds it as a tiling bump map.
Run: python tools/banners/print_banners.py   (needs Pillow, numpy)
"""
import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(REPO, "client", "public", "models", "village")
COLS, ROWS = 6, 2
W, H = 512, 1536           # one banner in the raw render (px)
CM = H / 180.0             # px per cm
rng = np.random.default_rng(20261116)


def smooth_noise(h, w, cell, seed):
    """Low-frequency value noise in 0..1 (bilinear-upsampled random grid)."""
    r = np.random.default_rng(seed)
    gh, gw = h // cell + 2, w // cell + 2
    g = r.random((gh, gw)).astype(np.float32)
    im = Image.fromarray((g * 255).astype(np.uint8)).resize((gw * cell, gh * cell), Image.BICUBIC)
    return np.asarray(im, dtype=np.float32)[:h, :w] / 255.0


def print_one(a, k):
    """One banner (float 0..1, H x W x 3), printed and weathered in place."""
    h, w, _ = a.shape
    yy = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
    # ink on polyester: compressed range, less saturation
    lum = (a * np.array([0.2126, 0.7152, 0.0722], np.float32)).sum(-1, keepdims=True)
    a = lum + (a - lum) * 0.9
    a = 0.035 + a * 0.93
    # sun fade: toward a warm off-white, stronger at the top and in blotches (each banner its own weather)
    fade = 0.05 + 0.07 * (1 - yy) + 0.06 * smooth_noise(h, w, 160, 100 + k)[..., None]
    a = a * (1 - fade) + np.array([0.93, 0.91, 0.86], np.float32) * fade
    # ink grain
    a = a * (1 + (rng.standard_normal((h, w, 1)).astype(np.float32) * 0.018))
    # hems: rod pockets (folded double fabric: a shade darker), fold lines, stitches
    top, bot, side = int(6 * CM), int(4 * CM), int(1 * CM)
    a[:top] *= 0.9
    a[h - bot:] *= 0.9
    a[top - 2:top + 1] *= 0.72
    a[h - bot - 1:h - bot + 2] *= 0.72
    a[:, :side] *= 0.92
    a[:, w - side:] *= 0.92
    stitch = (np.arange(w) // 6) % 2 == 0
    for y in (top + 7, top + 13, h - bot - 8, h - bot - 14):
        a[y, stitch] *= 0.62
    stitch_v = (np.arange(h) // 6) % 2 == 0
    for x in (side + 5, w - side - 6):
        a[stitch_v, x] *= 0.7
    # grommets: nickel rings, 2 cm, 3 cm in from the side, just inside the pockets
    gy = (top + int(3 * CM), h - bot - int(3 * CM))
    gx = (int(3 * CM), w - int(3 * CM))
    ys, xs = np.mgrid[0:h, 0:w]
    for cy in gy:
        for cx in gx:
            d = np.hypot(ys - cy, xs - cx) / CM
            ring = (d > 0.55) & (d < 1.05)
            hole = d <= 0.55
            shade = 0.62 + 0.3 * np.clip((cx - xs + cy - ys) / (CM * 1.4), -1, 1)
            a[ring] = (np.array([0.78, 0.79, 0.8], np.float32) * shade[ring][:, None])
            a[hole] *= 0.35
            shadow = (d >= 1.05) & (d < 1.4)
            a[shadow] *= 0.8
    return np.clip(a, 0, 1)


def main():
    raw = Image.open(os.path.join(HERE, "banners_raw.png")).convert("RGB")
    assert raw.size == (COLS * W, ROWS * H), raw.size
    src = np.asarray(raw, dtype=np.float32) / 255.0
    out = src.copy()
    for r in range(ROWS):
        for c in range(COLS):
            sl = (slice(r * H, (r + 1) * H), slice(c * W, (c + 1) * W))
            out[sl] = print_one(src[sl].copy(), r * COLS + c)
    im = Image.fromarray((out * 255 + 0.5).astype(np.uint8))
    os.makedirs(OUT, exist_ok=True)
    for size, name in ((1536, "street_banners.webp"), (1024, "street_banners_1k.webp")):
        p = os.path.join(OUT, name)
        im.resize((size, size), Image.LANCZOS).save(p, "WEBP", quality=86, method=6)
        print(p, os.path.getsize(p))
    im.resize((1536, 1536), Image.LANCZOS).save(os.path.join(HERE, "banners_printed_preview.png"))


if __name__ == "__main__":
    main()
