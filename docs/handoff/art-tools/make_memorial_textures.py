# ATLAS_ADD_DONE
"""Albedo textures for the memorial hall interior (system Python: numpy + PIL). Task 8.

  python art/village/tools/make_memorial_textures.py

Writes art/village/work/tex_m/T_m_*.png. Every texture tiles (periodic noise from filtered white noise in the
frequency domain), colours follow the owner-approved concept (concept_hall_v2.py; its linear colours -> sRGB here):
  T_m_floor    light oak planks, 0.2 m wide, random lengths, 2.4 m tile (1024 px)
  T_m_oak      light oak board grain (no seams), 1.0 m tile (1024 px)
  T_m_plaster  warm white plaster from Poly Haven white_plaster_02 (CC0), 2.5 m tile (1024 px)
  T_m_lacquer  white lacquer, a very faint low-frequency cloud, 1.0 m tile (512 px)
  T_m_fabric   light grey woven upholstery, 0.5 m tile (512 px)
  T_m_atlas    8 x 8 cells of small-part colours (64 px each, a little noise), see ATLAS below (512 px)
"""
import json
import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "work", "tex_m")
DL = os.path.join(ROOT, "downloads", "tex")
os.makedirs(OUT, exist_ok=True)


def lin2srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def srgb2lin(c):
    c = np.asarray(c, np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def pnoise(h, w, sy, sx, seed, octaves=1):
    """Periodic smooth noise in 0..1: white noise low-passed by a Gaussian of widths (sy, sx) cycles per tile."""
    rng = np.random.default_rng(seed)
    acc = np.zeros((h, w))
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        n = rng.standard_normal((h, w))
        fy = np.fft.fftfreq(h)[:, None] * h
        fx = np.fft.fftfreq(w)[None, :] * w
        g = np.exp(-((fy / (sy * 2 ** o)) ** 2 + (fx / (sx * 2 ** o)) ** 2))
        r = np.real(np.fft.ifft2(np.fft.fft2(n) * g))
        r = (r - r.mean()) / (r.std() + 1e-9)
        acc += r * amp
        tot += amp
        amp *= 0.5
    acc /= tot
    return np.clip(0.5 + acc * 0.18, 0, 1)


def save(name, rgb_lin):
    img = (lin2srgb(rgb_lin) * 255 + 0.5).astype(np.uint8)
    Image.fromarray(img, "RGB").save(os.path.join(OUT, name))
    print("wrote", name, img.shape, "mean sRGB", img.reshape(-1, 3).mean(0).round(1))


def grain(h, w, seed, along_x=True, rings=34.0, fine=1.0):
    """Wood grain field 0..1 (growth rings warped by noise + fine pores), periodic, grain along x."""
    if not along_x:
        return grain(w, h, seed, True, rings, fine).T
    warp = pnoise(h, w, 3, 0.7, seed, 3)
    v = np.linspace(0, 1, h, endpoint=False)[:, None]
    band = np.sin(2 * np.pi * (v * rings + (warp - 0.5) * 7.0))
    band = 0.5 + 0.5 * np.sign(band) * np.abs(band) ** 0.6
    pores = pnoise(h, w, 260 * fine, 6, seed + 7)
    streak = pnoise(h, w, 90 * fine, 2.5, seed + 11)
    f = 0.55 * band + 0.25 * (streak - 0.5) * 3 + 0.2 * (pores - 0.5) * 4 + 0.5 * 0.45
    return np.clip(f, 0, 1)


def wood_colour(f, light, dark):
    light = np.array(light)
    dark = np.array(dark)
    t = f[..., None]
    return dark + (light - dark) * t


# concept colours (linear, as in concept_hall_v2.py)
FLOOR_L, FLOOR_D = (0.78, 0.62, 0.44), (0.58, 0.43, 0.28)
OAK_L, OAK_D = (0.80, 0.64, 0.45), (0.62, 0.46, 0.30)


def floor():
    N, tile, pw = 1024, 2.4, 0.2
    rows = int(round(tile / pw))
    px = N / tile
    rng = np.random.default_rng(31)
    out = np.zeros((N, N, 3))
    seam = np.ones((N, N))
    g = grain(N, N, 5, True, rings=22.0)
    yy = np.arange(N)
    for r in range(rows):
        y0, y1 = int(round(r * pw * px)), int(round((r + 1) * pw * px))
        # plank joints: random cuts, periodic over the tile (each row's cuts are positions modulo the tile)
        start = rng.uniform(0, tile)
        lengths = []
        while sum(lengths) < tile - 0.5:
            lengths.append(rng.choice([0.6, 0.9, 1.2, 1.5]))
        lengths[-1] += tile - sum(lengths)
        cuts = [(start + sum(lengths[:k])) % tile for k in range(len(lengths))]
        xs = sorted(int(round(c * px)) % N for c in cuts)
        bounds = xs + [xs[0] + N]
        for k in range(len(xs)):
            a, b = bounds[k], bounds[k + 1]
            idx = np.arange(a, b) % N
            shade = rng.normal(1.0, 0.045)
            hue = rng.normal(0.0, 0.015)
            # each plank uses its own slice of the grain field (shifted rows) so neighbours differ
            off = rng.integers(0, N)
            gf = np.roll(g, off, axis=0)[y0:y1][:, idx]
            col = wood_colour(gf, FLOOR_L, FLOOR_D) * shade
            col[..., 0] *= 1 + hue
            col[..., 2] *= 1 - hue
            out[y0:y1][:, idx] = col
            seam[y0:y1, a % N] = 0.55
            seam[y0:y1, (a + 1) % N] = 0.85
        seam[y0 % N, :] = 0.5
        seam[(y0 + 1) % N, :] = 0.82
    out *= seam[..., None]
    # a faint large-scale mottling (worn, real floor)
    out *= (0.96 + 0.08 * pnoise(N, N, 2, 2, 77))[..., None]
    save("T_m_floor.png", out)


def oak():
    N = 1024
    g = grain(N, N, 9, True, rings=30.0)
    col = wood_colour(g, OAK_L, OAK_D)
    col *= (0.97 + 0.06 * pnoise(N, N, 2, 1, 4))[..., None]
    save("T_m_oak.png", col)


def plaster():
    src = os.path.join(DL, "white_plaster_02_diff_1k.jpg")
    a = np.asarray(Image.open(src).convert("RGB"), np.float64) / 255.0
    lum = srgb2lin(a) @ np.array([0.2126, 0.7152, 0.0722])
    v = (lum - lum.mean()) / (lum.std() + 1e-9)
    target = np.array([0.88, 0.87, 0.84])
    col = target * (1 + 0.025 * np.clip(v, -3, 3))[..., None]
    col *= (0.985 + 0.03 * pnoise(1024, 1024, 2, 2, 12))[..., None]
    save("T_m_plaster.png", col)


def lacquer():
    N = 512
    target = np.array([0.88, 0.88, 0.865])   # review 2026-11-14: whiter, neutral (the refs are white lacquer, not cream)
    col = target * (0.985 + 0.03 * pnoise(N, N, 2, 2, 21))[..., None]
    save("T_m_lacquer.png", col)


def fabric():
    N = 512
    y, x = np.mgrid[0:N, 0:N]
    weave = 0.5 + 0.25 * np.sin(x * 2 * np.pi / 4) * np.sin(y * 2 * np.pi / 4)
    slub = pnoise(N, N, 60, 6, 3)
    base = np.array([0.88, 0.88, 0.89])
    col = base * (0.86 + 0.18 * weave + 0.25 * (slub - 0.5))[..., None]
    save("T_m_fabric.png", col)


# small parts: name -> linear colour (cells of the 8 x 8 atlas, row-major)
ATLAS = [
    ("frame_dark", (0.045, 0.047, 0.05)), ("steel", (0.42, 0.42, 0.43)), ("pot_white", (0.80, 0.79, 0.76)),
    ("leaf", (0.06, 0.16, 0.05)), ("leaf2", (0.09, 0.22, 0.07)), ("stem", (0.18, 0.12, 0.07)),
    ("card", (0.90, 0.89, 0.85)), ("ink", (0.03, 0.025, 0.02)), ("rug", (0.50, 0.48, 0.44)),
    ("trim_white", (0.86, 0.86, 0.85)), ("frosted", (0.72, 0.75, 0.76)), ("flower_pink", (0.92, 0.55, 0.62)),
    ("flower_cream", (0.93, 0.88, 0.70)), ("flower_lav", (0.66, 0.58, 0.88)), ("flower_white", (0.92, 0.92, 0.90)),
    ("flower_peach", (0.95, 0.66, 0.45)), ("vase_glass", (0.70, 0.76, 0.74)), ("water", (0.55, 0.62, 0.60)),
    ("book_cover", (0.36, 0.30, 0.24)), ("ceiling_black", (0.02, 0.02, 0.02)), ("soil", (0.10, 0.07, 0.05)),
    ("vent", (0.70, 0.70, 0.69)), ("sign_green", (0.10, 0.45, 0.20)), ("brass", (0.55, 0.42, 0.20)),
    # --- 2026-11-13 hall rebuild (design.md): the rest of the palette of the approved mockup (linear)
    ("sage", (0.17, 0.25, 0.19)), ("walnut", (0.13, 0.075, 0.045)), ("birch", (0.62, 0.50, 0.34)),
    ("cream_fabric", (0.62, 0.58, 0.48)), ("cushion_sage", (0.24, 0.32, 0.22)), ("cushion_clay", (0.50, 0.26, 0.19)),
    ("mail_red", (0.58, 0.13, 0.10)), ("black", (0.03, 0.03, 0.035)), ("white", (0.86, 0.86, 0.84)),
    ("porcelain", (0.88, 0.86, 0.82)), ("alu", (0.40, 0.39, 0.37)), ("photo_warm", (0.60, 0.50, 0.40)),
    ("rug_cream", (0.58, 0.53, 0.45)), ("paper", (0.86, 0.84, 0.76)), ("gold", (0.62, 0.46, 0.18)),
    ("chrysanthemum", (0.88, 0.88, 0.84)), ("clay_pot", (0.52, 0.40, 0.33)), ("trunk_dark", (0.12, 0.08, 0.05)),
    ("sofa_grey", (0.30, 0.29, 0.28)), ("flame", (1.0, 0.72, 0.35)), ("stone", (0.34, 0.33, 0.30)),
    ("sage_light", (0.30, 0.38, 0.30)), ("lamp_shade", (0.80, 0.74, 0.62)),
    # --- 2026-11-15 round 5: real flowers (chrysanthemum eye, green stems and leaves) and the espresso machine
    ("flower_eye", (0.78, 0.55, 0.05)), ("stem_green", (0.13, 0.25, 0.06)), ("leaf_mum", (0.08, 0.20, 0.06)),
    ("steel_bright", (0.66, 0.66, 0.67)), ("coffee", (0.09, 0.045, 0.02)), ("gauge_face", (0.90, 0.89, 0.86)),
    ("led_green", (0.20, 0.75, 0.30)), ("galv", (0.50, 0.52, 0.53)),
]


def atlas():
    N, C = 512, 64
    out = np.zeros((N, N, 3))
    cells = {}
    rng = np.random.default_rng(5)
    for i, (name, c) in enumerate(ATLAS):
        r, k = divmod(i, 8)
        n = pnoise(C, C, 3, 3, 100 + i)
        out[r * C:(r + 1) * C, k * C:(k + 1) * C] = np.array(c) * (0.95 + 0.1 * n)[..., None]
        # UV of the cell centre (v from the bottom)
        cells[name] = [(k + 0.5) * C / N, 1 - (r + 0.5) * C / N]
    save("T_m_atlas.png", out)
    json.dump({"size": N, "cell": C, "cells": cells}, open(os.path.join(OUT, "atlas_m.json"), "w"), indent=1)




SIGN_FONT = "C:/Windows/Fonts/NotoSansKR-VF.ttf"   # Noto Sans KR, SIL OFL 1.1


def _font(size, bold=True):
    from PIL import ImageFont
    f = ImageFont.truetype(SIGN_FONT, size)
    try:
        f.set_variation_by_name("Bold" if bold else "Regular")
    except Exception:
        pass
    return f


def signs():
    """T_m_signs.png: one atlas of the hall's printed signs (brass plaques, the brand wall, the kiosk screen, the
    hall map, the tea corner and flower stand lettering, the mailbox). signs_m.json: name -> [u0, v0, u1, v1] (v from
    the bottom). Text only: no logos, no photos."""
    from PIL import Image, ImageDraw
    SZ = 2048
    img = Image.new("RGB", (SZ, SZ), (255, 255, 255))
    d = ImageDraw.Draw(img)
    regions = {}
    cursor = [0, 0, 0]  # x, y, row height

    def place(name, w, h):
        if cursor[0] + w > SZ:
            cursor[0], cursor[1], cursor[2] = 0, cursor[1] + cursor[2] + 4, 0
        x, y = cursor[0], cursor[1]
        cursor[0] += w + 4
        cursor[2] = max(cursor[2], h)
        regions[name] = [x / SZ, 1 - (y + h) / SZ, (x + w) / SZ, 1 - y / SZ]
        return x, y

    def centered(draw, box, text, font, fill, dy=0):
        x0, y0, x1, y1 = box
        bb = draw.textbbox((0, 0), text, font=font)
        tw, th = bb[2] - bb[0], bb[3] - bb[1]
        draw.text(((x0 + x1 - tw) / 2 - bb[0], (y0 + y1 - th) / 2 - bb[1] + dy), text, font=font, fill=fill)

    def plaque(name, w, h, bg, fg, lines, sizes, border=None, gap=0.0):
        x, y = place(name, w, h)
        d.rectangle([x, y, x + w - 1, y + h - 1], fill=bg)
        if border:
            d.rectangle([x + 6, y + 6, x + w - 7, y + h - 7], outline=border, width=4)
        total = sum(sizes) + gap * (len(lines) - 1)
        yy = y + (h - total) / 2
        for ln, sz in zip(lines, sizes):
            centered(d, (x, yy, x + w, yy + sz), ln, _font(sz), fg)
            yy += sz + gap

    BRASS = (214, 176, 108)
    WALNUT = (62, 40, 28)
    SAGE = (92, 112, 98)
    plaque("zone_a", 512, 160, WALNUT, BRASS, ["A 구역"], [92], border=(150, 120, 70))
    plaque("zone_b", 512, 160, WALNUT, BRASS, ["B 구역"], [92], border=(150, 120, 70))
    plaque("zone_e", 512, 160, WALNUT, BRASS, ["E 구역"], [92], border=(150, 120, 70))
    plaque("niche", 1024, 200, WALNUT, BRASS, ["기억의 자리"], [118], border=(150, 120, 70))
    plaque("brand", 1536, 380, SAGE, BRASS, ["케이슨 마을 추모관", "무지개다리 너머, 작은 마을"], [150, 68], gap=34)
    plaque("tea", 1024, 160, SAGE, (240, 236, 224), ["차 한 잔 하고 가세요"], [84])
    plaque("flowers", 768, 140, (232, 220, 196), (92, 62, 40), ["헌화용 꽃"], [76])
    plaque("mailbox", 384, 120, (150, 40, 32), (250, 244, 232), ["하늘 우체통"], [62])
    plaque("letters", 768, 140, SAGE, (240, 236, 224), ["편지 쓰는 자리"], [76])
    # kiosk screen: a plain search screen
    x, y = place("kiosk", 640, 400)
    d.rectangle([x, y, x + 639, y + 399], fill=(246, 247, 252))
    d.rectangle([x, y, x + 639, y + 92], fill=(75, 79, 216))
    centered(d, (x, y, x + 640, y + 92), "이름으로 찾기", _font(58), (255, 255, 255))
    d.rounded_rectangle([x + 40, y + 140, x + 600, y + 220], radius=40, fill=(255, 255, 255), outline=(180, 184, 220), width=4)
    d.text((x + 76, y + 156), "우리 아이 이름", font=_font(44, False), fill=(150, 154, 180))
    for k, (lbl, c) in enumerate((("호두", (139, 92, 246)),)):
        d.rounded_rectangle([x + 40 + k * 190, y + 270, x + 200 + k * 190, y + 340], radius=22, fill=c)
        centered(d, (x + 40 + k * 190, y + 270, x + 200 + k * 190, y + 340), lbl, _font(38), (255, 255, 255))
    # the hall map (안내도): a plan with the zones named
    w, h = 1280, 560
    x, y = place("map", w, h)
    d.rectangle([x, y, x + w - 1, y + h - 1], fill=(238, 232, 218))
    d.rectangle([x + 4, y + 4, x + w - 5, y + h - 5], outline=(120, 100, 70), width=5)
    centered(d, (x, y + 14, x + w, y + 84), "추모관 안내도", _font(58), (92, 62, 40))
    px, py, pw, ph = x + 90, y + 100, w - 180, h - 150
    d.rectangle([px, py, px + pw, py + ph], fill=(250, 247, 238), outline=(120, 100, 70), width=4)

    def zone(fx0, fy0, fx1, fy1, label, col, sz=34):
        d.rectangle([px + fx0 * pw, py + fy0 * ph, px + fx1 * pw, py + fy1 * ph], fill=col, outline=(150, 130, 100), width=2)
        centered(d, (px + fx0 * pw, py + fy0 * ph, px + fx1 * pw, py + fy1 * ph), label, _font(sz), (70, 52, 36))

    zone(0.0, 0.0, 0.40, 0.09, "봉안함 A", (232, 228, 218))
    zone(0.40, 0.0, 0.60, 0.20, "기억의 자리", (236, 214, 160))
    zone(0.60, 0.0, 1.0, 0.09, "봉안함 B", (232, 228, 218))
    zone(0.94, 0.09, 1.0, 0.62, "E", (220, 196, 150), 26)
    zone(0.04, 0.22, 0.30, 0.40, "편지 테이블", (214, 226, 214))
    zone(0.00, 0.62, 0.32, 1.0, "가족 라운지", (196, 212, 198))
    zone(0.76, 0.66, 0.94, 1.0, "안내 데스크", (226, 206, 170))
    zone(0.33, 0.93, 0.47, 1.0, "차", (210, 222, 210), 26)
    zone(0.53, 0.93, 0.66, 1.0, "헌화", (240, 228, 226), 26)
    zone(0.40, 0.88, 0.60, 1.0, "입구", (200, 206, 230), 30)
    d.rectangle([px + 0.32 * pw, py + 0.3 * ph, px + 0.42 * pw, py + 0.5 * ph], fill=(222, 208, 180))
    d.rectangle([px + 0.58 * pw, py + 0.3 * ph, px + 0.68 * pw, py + 0.5 * ph], fill=(222, 208, 180))
    json.dump({"size": SZ, "regions": regions}, open(os.path.join(OUT, "signs_m.json"), "w"), indent=1)
    img.save(os.path.join(OUT, "T_m_signs.png"))
    print("wrote T_m_signs.png", len(regions), "signs")


def painting():
    """T_m_painting: a soft watercolour of a dog's head over a pastel wash (the lounge's framed picture)."""
    from PIL import Image, ImageDraw, ImageFilter
    N = 512
    img = Image.new("RGB", (N, N), (236, 228, 212))
    d = ImageDraw.Draw(img)
    for i in range(N):
        t = i / N
        d.line([(0, i), (N, i)], fill=(int(226 + 18 * t), int(232 + 6 * t), int(216 - 10 * t)))
    d.ellipse([60, 330, 460, 560], fill=(176, 198, 170))
    d.ellipse([150, 110, 360, 330], fill=(206, 160, 108))
    d.ellipse([105, 120, 190, 270], fill=(150, 108, 72))
    d.ellipse([320, 120, 405, 270], fill=(150, 108, 72))
    d.ellipse([200, 190, 232, 222], fill=(40, 30, 26))
    d.ellipse([280, 190, 312, 222], fill=(40, 30, 26))
    d.ellipse([228, 238, 284, 280], fill=(60, 44, 38))
    img = img.filter(ImageFilter.GaussianBlur(1.6))
    img.save(os.path.join(OUT, "T_m_painting.png"))


if __name__ == "__main__":
    floor()
    oak()
    plaster()
    lacquer()
    fabric()
    atlas()
    signs()
    painting()
