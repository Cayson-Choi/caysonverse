"""Second half of make_house_textures.py (leather, rattan, hanji, plaster, rug, bamboo, jagae, atlas, leaf)."""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from make_house_textures import OUT, DL, noise, save, srgb, rng


def mk_leather():
    n = 512
    a = noise(n, 60, 15)
    b = noise(n, 60, 16)
    cell = np.minimum(np.abs(a - 0.5), np.abs(b - 0.5)) * 2
    t = 0.62 + 0.22 * np.sqrt(np.clip(cell * 3, 0, 1)) + 0.05 * (noise(n, 8, 17) - 0.5)
    save("T_h_leather.png", np.clip(t, 0, 1))


def mk_rattan():
    """woven cane/rattan basket weave, 0.3 m tile, light straw"""
    n = 512
    yy, xx = np.mgrid[0:n, 0:n]
    p = n / 8
    bx = (xx // (p / 2)).astype(int)
    by = (yy // (p / 2)).astype(int)
    over = ((bx + by) % 2 == 0)
    ph = np.sin(xx * 2 * np.pi / p) * 0.5 + 0.5
    pv = np.sin(yy * 2 * np.pi / p) * 0.5 + 0.5
    straw = srgb("#D9B979")
    lum = np.where(over, 0.55 + 0.45 * ph, 0.55 + 0.45 * pv)
    img = straw[None, None, :] * lum[..., None]
    img *= (0.9 + 0.2 * noise(n, 100, 18))[..., None]
    save("T_h_rattan.png", img)


def mk_paper():
    n = 512
    f = noise(n, 120, 19) * 0.5 + noise(n, 25, 20) * 0.5
    save("T_h_paper.png", srgb("#F3EBD6")[None, None, :] * (0.93 + 0.1 * f)[..., None])


def mk_plaster():
    im = Image.open(os.path.join(DL, "white_plaster_02_diff_1k.jpg")).convert("RGB").resize((1024, 1024))
    a = np.asarray(im, dtype=np.float64) / 255.0
    a = a / a.mean() * 0.86; a = a.mean() + 0.45 * (a - a.mean())
    h = 512
    b = np.roll(np.roll(a, h, 0), h, 1)
    yy, xx = np.mgrid[0:1024, 0:1024] / 1024
    w = np.clip(np.minimum(np.minimum(xx, 1 - xx), np.minimum(yy, 1 - yy)) * 4, 0, 1)[..., None]
    save("T_h_plaster.png", a * w + b * (1 - w))


def mk_rug():
    n = 512
    t = 0.80 + 0.1 * (noise(n, 4, 22) - 0.5) + 0.06 * (noise(n, 200, 21) - 0.5)
    save("T_h_rug.png", np.clip(t, 0, 1))


def mk_bamboo():
    n = 512
    img = np.zeros((n, n, 3))
    sw = n // 32
    for i in range(32):
        c = srgb("#C9A55C") * (0.85 + 0.15 * rng.random())
        img[:, i * sw:(i + 1) * sw] = c
        img[:, i * sw:i * sw + 2] = c * 0.5
    img *= (0.92 + 0.12 * noise(n, 6, 23))[..., None]
    for k in range(4):
        img[k * 128:k * 128 + 3, :] = srgb("#EFE6D2")
    save("T_h_bamboo.png", img)


def mk_jagae():
    """자개 (mother-of-pearl) door panel: black lacquer, vine + peonies, 1:2, explicit UV 0..1"""
    W, H = 512, 1024
    im = Image.new("RGB", (W, H), (14, 10, 10))
    d = ImageDraw.Draw(im)
    r = np.random.default_rng(5)
    pal = [(190, 230, 215), (215, 190, 235), (240, 225, 190), (180, 215, 240), (235, 200, 205)]

    def peony(x, y, rad):
        for ring, sc in ((0, 1.0), (1, 0.62)):
            for k in range(7):
                a = k * 2 * np.pi / 7 + ring * 0.4
                cx, cy = x + np.cos(a) * rad * 0.55 * sc, y + np.sin(a) * rad * 0.55 * sc
                rr = rad * 0.48 * sc
                d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=pal[(k + ring) % 5])
        d.ellipse([x - rad * 0.2, y - rad * 0.2, x + rad * 0.2, y + rad * 0.2], fill=(250, 240, 200))

    pts = [(60 + 390 * (i / 40) + 40 * np.sin(i * 0.7), 960 - 920 * (i / 40) + 30 * np.sin(i * 0.5)) for i in range(41)]
    d.line(pts, fill=(170, 205, 190), width=6)
    for (x, y) in pts[::2]:
        d.ellipse([x - 12, y - 5, x + 12, y + 5], fill=(150, 200, 180))
    for (x, y) in pts[3::7]:
        peony(x, y, 55)
    for k in range(24):
        x, y = r.uniform(30, 480), r.uniform(30, 990)
        d.ellipse([x - 4, y - 4, x + 4, y + 4], fill=(220, 215, 200))
    d.rectangle([12, 12, W - 12, H - 12], outline=(200, 210, 200), width=4)
    im.filter(ImageFilter.GaussianBlur(0.8)).save(os.path.join(OUT, "T_h_jagae.png"))
    print("wrote T_h_jagae.png")


CELLS = ["#F4F1EA", "#E7DDCB", "#C9A06C", "#8E673C", "#4A3022", "#2B2B2E", "#8A8D92", "#D8D5CE",
         "#C8553D", "#E08A3C", "#E6C34A", "#7FA650", "#3F7A4C", "#4F8FB5", "#3A5A9A", "#7B5BA6",
         "#D982A5", "#B64A5A", "#F2D7C7", "#6B4B3A", "#A88F6A", "#DCC9A0", "#9DB8A8", "#F0E6B8",
         "#E8E3D8", "#B8B2A6", "#5E8A8A", "#C97B63", "#EDEAE4", "#2F4B3A", "#74513C", "#BFA77A"]


def mk_atlas():
    """colour atlas 8x8 cells of 32 px: cell i is CELLS[i % 32] (second 32 slightly darker)"""
    n = 256
    img = np.zeros((n, n, 3))
    for i in range(64):
        r_, c_ = divmod(i, 8)
        img[r_ * 32:(r_ + 1) * 32, c_ * 32:(c_ + 1) * 32] = srgb(CELLS[i % 32]) * (1.0 if i < 32 else 0.8)
    save("T_h_atlas.png", img + 0.012 * rng.standard_normal(img.shape))


def mk_leaf():
    n = 256
    img = np.ones((n, n, 3)) * srgb("#4C8A45")[None, None, :]
    yy, xx = np.mgrid[0:n, 0:n]
    vein = np.zeros((n, n), dtype=bool)
    for k in range(1, 8):
        vein |= np.abs((yy - n * 0.11 * k) - np.abs(xx - n / 2) * 0.9) < 1.6
    img *= (0.92 + 0.15 * noise(n, 30, 24))[..., None]
    img[vein] *= 1.18
    img[np.abs(xx - n / 2) < 2.5] = srgb("#8FBF6A")
    save("T_h_leaf.png", img)


def run():
    mk_leather(); mk_rattan(); mk_paper(); mk_plaster(); mk_rug(); mk_bamboo(); mk_jagae(); mk_atlas(); mk_leaf()
