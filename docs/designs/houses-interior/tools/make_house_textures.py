"""Albedo textures for the houses-interior kit (system Python: numpy + PIL).

  python art/village/tools/houses/make_house_textures.py

Writes art/village/work/tex_h/T_h_*.png. All tile. Wood grain is derived from the CC0 Poly Haven
japanese_cedar_planks luminance (downloads/tex), plaster from white_plaster_02; the rest is procedural.
Greyish albedos are tinted by the vertex colour in the material (tint=True), colour ones are used as they are.
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "work", "tex_h")
DL = os.path.join(ROOT, "downloads", "tex")
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(20261116)


def l2s(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def save(name, arr):
    a = np.clip(arr, 0, 1)
    if a.ndim == 2:
        a = np.stack([a] * 3, -1)
    Image.fromarray((a * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, name))
    print("wrote", name, a.shape[:2])


def noise(n, scale, seed=None):
    """periodic filtered noise 0..1, feature size ~ n/scale px"""
    r = np.random.default_rng(seed) if seed is not None else rng
    w = r.standard_normal((n, n))
    f = np.fft.fft2(w)
    fx = np.fft.fftfreq(n)[:, None]
    fy = np.fft.fftfreq(n)[None, :]
    k = np.sqrt(fx ** 2 + fy ** 2) * n
    f *= np.exp(-(k / scale) ** 2)
    o = np.real(np.fft.ifft2(f))
    o = (o - o.min()) / (o.max() - o.min() + 1e-9)
    return o


def cedar_grain(n=1024):
    """luminance of the CC0 cedar planks, normalised to mean 0.5; grain runs along x (u)"""
    im = Image.open(os.path.join(DL, "japanese_cedar_planks_diff_1k.jpg")).convert("L").resize((n, n))
    a = np.asarray(im, dtype=np.float64) / 255.0
    a = np.rot90(a)      # source grain is vertical -> horizontal
    a = a - a.mean() + 0.5
    # make it tile: cross-fade halves
    h = n // 2
    b = np.roll(np.roll(a, h, 0), h, 1)
    yy, xx = np.mgrid[0:n, 0:n] / n
    wgt = np.minimum(np.minimum(xx, 1 - xx), np.minimum(yy, 1 - yy)) * 2
    wgt = np.clip(wgt * 2, 0, 1)
    return a * wgt + b * (1 - wgt)


def wood(base, dark, grain, contrast=1.0):
    g = np.clip((grain - 0.5) * contrast + 0.5, 0, 1)
    base = np.array(base)
    dark = np.array(dark)
    c = dark[None, None, :] + (base - dark)[None, None, :] * g[..., None]
    return c


def hexc(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]) ** 2.2   # to linear-ish then back below


def srgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])


def mk_wood():
    g = cedar_grain(1024)
    ln = noise(1024, 6, 1) * 0.25
    for name, base, dark in (("oak", "#C9A06C", "#8E673C"), ("walnut", "#6B4430", "#3A2418"), ("pine", "#E2C690", "#B58F58"),
                             ("dark", "#4A3022", "#24150E")):
        c = wood(srgb(base), srgb(dark), np.clip(g + ln - 0.12, 0, 1), 1.5)
        save(f"T_h_wood_{name}.png", c)


def mk_floor():
    """oak floor boards: 0.12 m wide, 0.9..1.8 m long, 2.4 m tile (1024 px: 5 px = 1.2 cm)"""
    n = 1024
    g = cedar_grain(n)
    img = np.zeros((n, n, 3))
    bw = int(n * 0.12 / 2.4)
    y = 0
    base, dark = srgb("#C7A06E"), srgb("#8D6A40")
    rows = n // bw + 1
    for r in range(rows):
        x = int(rng.integers(0, n))
        while x < n + 1500:
            ln = int(rng.uniform(0.9, 1.8) / 2.4 * n)
            tone = rng.uniform(0.82, 1.1)
            sh = int(rng.integers(0, n))
            for yy in range(y, min(y + bw, n)):
                for xs, xe in ((x, x + ln),):
                    xs0, xe0 = xs % n, xe % n
                    cols = np.arange(xs, xe) % n
                    gg = g[(yy + sh) % n, (cols + sh) % n]
                    c = dark[None, :] + (base - dark)[None, :] * np.clip((gg - 0.5) * 1.5 + 0.5, 0, 1)[:, None]
                    c = c * tone
                    img[yy, cols] = c
                    # end-joint dark line
                    img[yy, cols[0]] = c[0] * 0.45
                    img[yy, cols[-1]] = c[-1] * 0.45
            x += ln
        # seam line between boards
        img[y % n, :] *= 0.5
        y += bw
    img *= 0.95 + 0.1 * noise(n, 40)[..., None]
    save("T_h_floor_oak.png", img)
    # darker walnut / ash variant for tint-free use
    save("T_h_floor_dark.png", img * np.array([0.62, 0.55, 0.5]))


def mk_jangpan():
    """장판: yellow-ochre vinyl, faint woven-paper pattern, soft blotches"""
    n = 1024
    base = srgb("#D8B04A")
    f = 0.5 + 0.18 * (noise(n, 5, 7) - 0.5) * 2
    yy, xx = np.mgrid[0:n, 0:n]
    weave = 0.5 + 0.5 * np.sin(xx * 2 * np.pi / 16) * np.sin(yy * 2 * np.pi / 16)
    streak = noise(n, 90, 8)
    lum = 0.93 + 0.07 * weave + 0.12 * (f - 0.5) + 0.12 * (streak - 0.5)
    c = base[None, None, :] * lum[..., None]
    c[..., 2] *= 0.9 + 0.1 * noise(n, 20, 9)
    save("T_h_jangpan.png", c)


def mk_tiles():
    n = 1024
    # white subway-ish square tiles 10 cm on a 1 m tile => 10 x 10, grout 3 px
    t = np.ones((n, n, 3)) * 0.93
    cell = n // 10
    gl = noise(n, 60, 11)
    for i in range(10):
        for j in range(10):
            tone = 0.95 + 0.05 * rng.random()
            t[i * cell:(i + 1) * cell, j * cell:(j + 1) * cell] = tone
    for k in range(10):
        t[k * cell:k * cell + 3, :] = 0.62
        t[:, k * cell:k * cell + 3] = 0.62
    # bevel shading at tile edges
    t *= (0.97 + 0.04 * gl)[..., None]
    save("T_h_tile_white.png", t)
    # grey floor tile 30 cm on 1.2 m tile (4 x 4), speckled
    n2 = 1024
    c = n2 // 4
    g = np.ones((n2, n2, 3)) * 0.55
    sp = noise(n2, 200, 12) * 0.2 + noise(n2, 25, 13) * 0.12
    for i in range(4):
        for j in range(4):
            g[i * c:(i + 1) * c, j * c:(j + 1) * c] = 0.52 + 0.06 * rng.random()
    g += (sp - 0.16)[..., None]
    for k in range(4):
        g[k * c:k * c + 4, :] = 0.25
        g[:, k * c:k * c + 4] = 0.25
    save("T_h_tile_grey.png", g)


def mk_fabric():
    n = 512
    yy, xx = np.mgrid[0:n, 0:n]
    wv = 0.5 + 0.25 * np.sin(xx * 2 * np.pi / 6) * 0.6 + 0.25 * np.sin(yy * 2 * np.pi / 6) * 0.6
    slub = noise(n, 70, 14)
    t = 0.78 + 0.10 * (wv - 0.5) + 0.07 * (slub - 0.5) + 0.03 * rng.standard_normal((n, n))
    save("T_h_fabric.png", t)


if __name__ == "__main__":
    import make_house_textures_b as B
    mk_wood(); mk_floor(); mk_jangpan(); mk_tiles(); mk_fabric()
    B.run()
