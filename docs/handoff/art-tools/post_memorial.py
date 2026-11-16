"""After the memorial hall's Blender steps (system Python: numpy + PIL). Task 8.

  python art/village/tools/post_memorial.py --garden      work/tex_m/garden_raw.png -> work/tex_m/T_m_garden.png
  python art/village/tools/post_memorial.py --garden-night  the same park at night -> export/memorial_garden_night.webp
  CV_CLIENT=<client/public/models/village> python art/village/tools/post_memorial.py   (2026-11-13: ships memorial.glb, the day,
                                                          night and 1k light maps, the night garden to that folder)
  python art/village/tools/post_memorial.py               work/memorial_lm.png -> export/memorial_lm.webp; copies
                                                          memorial.glb, memorial_lm.webp, memorial_props.glb to the client
  python art/village/tools/post_memorial.py --compare     comparison sheets (refs | our game-look frames) -> compare/

The garden card is unlit in the game and goes through the hall's tone curve (three.js Neutral at exposure 1.4, the
`village` lighting preset), so its texture is the AgX render pushed through the inverse of that curve: what the
player sees through the window is the render as it was.
"""
import os
import shutil
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(os.path.dirname(ROOT))
WORK = os.path.join(ROOT, "work")
EXPORT = os.path.join(ROOT, "export")
CLIENT = os.environ.get("CV_CLIENT") or os.path.join(REPO, "client", "public", "models", "village")
REFS = os.path.join(ROOT, "refs")
CMP = os.path.join(ROOT, "compare")
EXPOSURE = 1.4


def srgb2lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin2srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def neutral(c):
    """three.js NeutralToneMapping (r162+), exposure already applied. c: (..., 3) linear."""
    start, desat = 0.8 - 0.04, 0.15
    x = c.min(-1, keepdims=True)
    offset = np.where(x < 0.08, x - 6.25 * x * x, 0.04)
    c = c - offset
    peak = c.max(-1, keepdims=True)
    d = 1.0 - start
    new_peak = 1.0 - d * d / (peak + d - start)
    comp = c * np.where(peak > start, new_peak / np.maximum(peak, 1e-6), 1.0)
    g = 1.0 - 1.0 / (desat * (peak - new_peak) + 1.0)
    comp = np.where(peak > start, comp * (1 - g) + new_peak * g, comp)
    return comp


def inverse_neutral(target, iters=40):
    x = target.copy()
    for _ in range(iters):
        x = np.clip(x + (target - neutral(x)) * 1.3, 0, 4)
    return x


def garden_night():
    """The park at night: the display image graded to a deep blue-black, a starry sky, warm garden lamps along the hedge; then
    through the same inverse tone curve as the day texture. -> export/memorial_garden_night.webp (2048 px wide)."""
    raw = np.asarray(Image.open(os.path.join(WORK, "tex_m", "garden_raw.png")).convert("RGB"), np.float64) / 255
    lin = srgb2lin(raw)
    h, w, _ = lin.shape
    yy = np.linspace(0, 1, h)[:, None, None]
    lum = lin @ np.array([0.2126, 0.7152, 0.0722])
    sky = ((lin[..., 2] > lin[..., 1] * 1.02) & (yy[..., 0] < 0.66)).astype(np.float64)
    sky = np.clip(np.convolve(sky.ravel(), np.ones(1), "same").reshape(h, w), 0, 1)
    ground = lin * np.array([0.030, 0.045, 0.085])
    zenith = np.array([0.004, 0.008, 0.030])
    horizon = np.array([0.018, 0.030, 0.075])
    skycol = zenith + (horizon - zenith) * np.clip(yy / 0.66, 0, 1) ** 1.6
    out = ground * (1 - sky[..., None]) + skycol * sky[..., None]
    rng = np.random.default_rng(7)
    n = 520
    sx, sy = rng.integers(0, w, n), (rng.random(n) ** 1.7 * 0.55 * h).astype(int)
    for x, y in zip(sx, sy):
        if sky[y, x] > 0.5:
            b = rng.uniform(0.25, 1.0)
            out[y, x] += b
            if b > 0.8 and 1 <= x < w - 1:
                out[y, x - 1:x + 2] += 0.18
    # a crescent moon
    cy, cx, r = int(0.16 * h), int(0.80 * w), int(0.045 * h)
    Y, X = np.mgrid[0:h, 0:w]
    disk = ((X - cx) ** 2 + (Y - cy) ** 2) < r * r
    bite = ((X - cx - 0.55 * r) ** 2 + (Y - cy + 0.15 * r) ** 2) < (0.95 * r) ** 2
    out[disk & ~bite] = np.array([0.95, 0.93, 0.82])
    # garden lamps: warm pools on the grass and bright glass globes
    for fx_ in (0.07, 0.24, 0.43, 0.61, 0.80, 0.94):
        lx, ly = int(fx_ * w), int(0.80 * h)
        d2 = ((X - lx) / (0.07 * w)) ** 2 + ((Y - ly) / (0.07 * h)) ** 2
        out += np.exp(-d2 * 3.6)[..., None] * np.array([0.13, 0.08, 0.03]) * (Y > 0.74 * h)[..., None]
        g = ((X - lx) ** 2 + (Y - int(0.66 * h)) ** 2) < (0.012 * h) ** 2
        out[g] = np.array([1.0, 0.82, 0.5])
        halo = np.exp(-(((X - lx) ** 2 + (Y - int(0.66 * h)) ** 2) / ((0.05 * h) ** 2)))
        out += halo[..., None] * np.array([0.12, 0.07, 0.025])
    disp = np.clip(out, 0, 0.93)
    tex = inverse_neutral(disp) / EXPOSURE
    img = Image.fromarray((lin2srgb(tex) * 255 + 0.5).astype(np.uint8))
    if img.width > 2048:
        img = img.resize((2048, round(img.height * 2048 / img.width)), Image.LANCZOS)
    os.makedirs(EXPORT, exist_ok=True)
    img.save(os.path.join(EXPORT, "memorial_garden_night.webp"), "WEBP", quality=88, method=6)
    img.save(os.path.join(WORK, "tex_m", "T_m_garden_night.png"))
    print("memorial_garden_night.webp", img.size)


def garden():
    raw = np.asarray(Image.open(os.path.join(WORK, "tex_m", "garden_raw.png")).convert("RGB"), np.float64) / 255
    disp = np.clip(srgb2lin(raw), 0, 0.93)
    tex = inverse_neutral(disp) / EXPOSURE
    img = Image.fromarray((lin2srgb(tex) * 255 + 0.5).astype(np.uint8))
    w, h = img.size
    if w > 2048:
        img = img.resize((2048, round(h * 2048 / w)), Image.LANCZOS)
    img.save(os.path.join(WORK, "tex_m", "T_m_garden.png"))
    err = np.abs(neutral(tex * EXPOSURE) - disp).max()
    print("T_m_garden.png", img.size, "round-trip max error", round(float(err), 4))


def ship(q=90):
    os.makedirs(CLIENT, exist_ok=True)
    day = Image.open(os.path.join(WORK, "memorial_lm.png")).convert("RGB")
    lm = os.path.join(EXPORT, "memorial_lm.webp")
    day.save(lm, "WEBP", quality=q, method=6)
    day.resize((day.width // 2, day.height // 2), Image.LANCZOS).save(os.path.join(EXPORT, "memorial_lm_1k.webp"), "WEBP", quality=q, method=6)
    night_png = os.path.join(WORK, "memorial_lm_night.png")
    if os.path.exists(night_png):
        night = Image.open(night_png).convert("RGB")
        night.save(os.path.join(EXPORT, "memorial_lm_night.webp"), "WEBP", quality=q, method=6)
        night.resize((night.width // 2, night.height // 2), Image.LANCZOS).save(os.path.join(EXPORT, "memorial_lm_night_1k.webp"), "WEBP",
                                                                              quality=q, method=6)
    for f in ("memorial.glb", "memorial_lm.webp", "memorial_lm_1k.webp", "memorial_lm_night.webp", "memorial_lm_night_1k.webp",
              "memorial_garden_night.webp", "memorial_props.glb"):
        src = os.path.join(EXPORT, f)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(CLIENT, f))
            print(f"{f}: {os.path.getsize(src) / 1024 / 1024:.2f} MB")
    seats = os.path.join(EXPORT, "memorial_seats.json")
    if os.path.exists(seats) and os.environ.get("CV_SEATS_OUT"):
        shutil.copy2(seats, os.environ["CV_SEATS_OUT"])
        print("seats ->", os.environ["CV_SEATS_OUT"])


def font(size):
    for f in ("C:/Windows/Fonts/malgun.ttf", "C:/Windows/Fonts/arial.ttf"):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def sheet(name, panels, out):
    """panels: [(image path, caption)] in a row, each scaled to height 720."""
    H = 720
    ims = []
    for p, cap in panels:
        im = Image.open(p).convert("RGB")
        im = im.resize((round(im.width * H / im.height), H), Image.LANCZOS)
        ims.append((im, cap))
    W = sum(i.width for i, _ in ims) + 12 * (len(ims) - 1)
    canvas = Image.new("RGB", (W, H + 44), (24, 24, 26))
    d = ImageDraw.Draw(canvas)
    x = 0
    f = font(22)
    for im, cap in ims:
        canvas.paste(im, (x, 44))
        d.text((x + 8, 10), cap, fill=(235, 235, 235), font=f)
        x += im.width + 12
    canvas.save(out)
    print("sheet", out)


def compare(outdir):
    os.makedirs(outdir, exist_ok=True)
    raw = os.path.join(CMP, "memorial")
    sheet("wide", [(os.path.join(REFS, "approved_concept_hall_wide.png"), "approved concept (v2final3)"),
                   (os.path.join(raw, "game_wide.png"), "memorial.glb, game look (unlit x light map, Neutral 1.4)")],
          os.path.join(outdir, "cmp_hall_wide.png"))
    sheet("niches", [(os.path.join(REFS, "approved_concept_niches.png"), "approved concept (niches)"),
                     (os.path.join(raw, "game_niches.png"), "memorial.glb + memorial_props.glb, game look")],
          os.path.join(outdir, "cmp_niches.png"))
    refs = Image.open(os.path.join(REFS, "columbarium_interior_grid.jpg")).convert("RGB").crop((30, 320, 1950, 640))
    refs.save(os.path.join(outdir, "_ref_strip.png"))
    sheet("refs", [(os.path.join(outdir, "_ref_strip.png"), "real Korean pet 봉안당 interiors (reference search)"),
                   (os.path.join(raw, "game_wide.png"), "ours")], os.path.join(outdir, "cmp_refs.png"))
    for f in ("game_wide.png", "game_niches.png", "cycles_wide.png", "cycles_niches.png"):
        p = os.path.join(raw, f)
        if os.path.exists(p):
            shutil.copy2(p, os.path.join(outdir, f))


if __name__ == "__main__":
    a = sys.argv[1:]
    if "--garden-night" in a:
        garden_night()
    elif "--garden" in a:
        garden()
    elif "--compare" in a:
        compare(a[a.index("--compare") + 1] if len(a) > a.index("--compare") + 1 else os.path.join(CMP, "memorial"))
    else:
        ship()
