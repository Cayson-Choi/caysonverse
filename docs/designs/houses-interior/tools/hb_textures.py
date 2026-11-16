"""HB texture fixes (system Python: numpy + PIL): replaces the kit's speckled leather with a calm, low-contrast one.

  python art/village/tools/houses/hb_textures.py        -> art/village/work/tex_h/T_h_leather.png (512, tiles)

Soft broad mottling (hide variation) + a fine, low-contrast pebble grain + a few worn crease lines; mean ~0.66 so the vertex tint
colours it brown / tan / black without the confetti look of the first version."""
import os
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "work", "tex_h")


def noise(n, scale, seed):
    r = np.random.default_rng(seed)
    f = np.fft.fft2(r.standard_normal((n, n)))
    k = np.sqrt(np.fft.fftfreq(n)[:, None] ** 2 + np.fft.fftfreq(n)[None, :] ** 2) * n
    f *= np.exp(-(k / scale) ** 2)
    o = np.real(np.fft.ifft2(f))
    return (o - o.min()) / (o.max() - o.min() + 1e-9)


def leather():
    n = 512
    broad = noise(n, 5, 31) - 0.5
    mid = noise(n, 14, 32) - 0.5
    a, b = noise(n, 48, 33), noise(n, 48, 34)
    pebble = np.sqrt(np.clip(np.minimum(np.abs(a - 0.5), np.abs(b - 0.5)) * 2 * 3, 0, 1))
    t = 0.66 + 0.16 * broad + 0.05 * mid + 0.035 * (pebble - 0.5)
    yy, xx = np.mgrid[0:n, 0:n] / n
    for (ax, ay, ang, ln) in ((0.2, 0.3, 0.3, 0.5), (0.7, 0.6, -0.5, 0.45), (0.45, 0.85, 0.1, 0.4)):
        d = np.abs((xx - ax) * np.sin(ang) - (yy - ay) * np.cos(ang))
        along = np.abs((xx - ax) * np.cos(ang) + (yy - ay) * np.sin(ang)) < ln / 2
        t -= 0.05 * np.exp(-(d / 0.006) ** 2) * along
    img = (np.clip(t, 0, 1)[..., None] * np.array([1.0, 0.98, 0.96]) * 255 + 0.5).astype(np.uint8)
    Image.fromarray(img).save(os.path.join(OUT, "T_h_leather.png"))
    print("wrote T_h_leather.png")


if __name__ == "__main__":
    leather()
