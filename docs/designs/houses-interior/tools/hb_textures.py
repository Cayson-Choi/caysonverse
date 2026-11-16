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


def save_gray(name, t):
    img = (np.clip(t, 0, 1)[..., None] * np.array([1.0, 1.0, 1.0]) * 255 + 0.5).astype(np.uint8)
    Image.fromarray(img).save(os.path.join(OUT, name))
    print("wrote", name)


def wallpapers():
    """subtle 벽지 tiles (512 px = 0.9 m), light grey so the vertex tint colours them: 6 pinstripe + tone-on-tone damask, 7 small diamonds, 8 hanji fibre, 9 tiny sprigs"""
    n = 512
    yy, xx = np.mgrid[0:n, 0:n] / n
    base = 0.93 + 0.03 * (noise(n, 40, 41) - 0.5)
    # 6: pinstripes every 1/8 + a soft ogee diamond
    t = base.copy()
    t -= 0.05 * (np.abs(((xx * 8) % 1) - 0.5) > 0.47)
    og = np.abs(np.sin(xx * np.pi * 4) * np.sin(yy * np.pi * 4))
    t -= 0.03 * (og > 0.8)
    save_gray("T_h_wp_6.png", t)
    # 7: small diamonds
    d = np.abs(((xx * 8) % 1) - 0.5) + np.abs(((yy * 8) % 1) - 0.5)
    t = base - 0.045 * (d < 0.18) + 0.02 * ((d > 0.2) & (d < 0.26))
    save_gray("T_h_wp_7.png", t)
    # 8: hanji fibres
    f = noise(n, 90, 43) * 0.5 + noise(n, 25, 44) * 0.5
    t = 0.9 + 0.1 * (f - 0.5) * 2
    for k in range(60):
        r = np.random.default_rng(k)
        x0, y0, ang, ln = r.random(), r.random(), r.random() * 3.14, 0.05 + 0.1 * r.random()
        for s_ in np.linspace(0, ln, 20):
            ix, iy = int(((x0 + np.cos(ang) * s_) % 1) * n), int(((y0 + np.sin(ang) * s_) % 1) * n)
            t[iy, ix] -= 0.06
    save_gray("T_h_wp_8.png", t)
    # 9: tiny sprigs on a half-drop grid
    t = base.copy()
    for gx in range(6):
        for gy in range(6):
            cx, cy = (gx + 0.5 * (gy % 2) + 0.25) / 6, (gy + 0.5) / 6
            dd = np.sqrt(((xx - cx + 0.5) % 1 - 0.5) ** 2 + ((yy - cy + 0.5) % 1 - 0.5) ** 2)
            t -= 0.07 * (dd < 0.012) + 0.04 * ((dd > 0.02) & (dd < 0.03) & (np.abs(xx - cx) < 0.03))
    save_gray("T_h_wp_9.png", t)
    save_gray("T_h_wp_10.png", base)


if __name__ == "__main__":
    leather()
    wallpapers()
