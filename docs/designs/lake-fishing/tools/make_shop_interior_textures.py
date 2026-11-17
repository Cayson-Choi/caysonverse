"""Textures of the fishing shop's interior (lake_shop_interior.glb, build_shop_interior.py).

  python docs/designs/lake-fishing/tools/make_shop_interior_textures.py [--cc0 art/shop/cc0] [--out art/shop/tex]

Inputs: ambientCG CC0 sets (1K-JPG, unzipped to art/shop/cc0/<id>/; see docs/licenses.md) and the catch photo rendered by
render_shop_photo.py. Outputs (art/ is not committed; the GLB carries them):

  floor.png wall.png wainscot.png ceiling.png wood.png peg.png   tiling surfaces. The game draws them unlit with the baked
                                                                 light in COLOR_0, so the CC0 sets' AO and normal relief are
                                                                 folded into the albedo here ("pre-shaded"): the tile joints,
                                                                 the grain and the plaster's trowel marks read without a
                                                                 normal map.
  atlas.png + atlas.json                                         the props atlas (2048 x 2048, RGBA: the landing net's mesh is
                                                                 cut out): lure / worm / float packs, bait bags, labels, the
                                                                 price board, clock, photo, ruler, and colour swatches (rod
                                                                 blanks with a painted gloss stripe, cork, EVA, metals,
                                                                 plastics). atlas.json maps each key to (u0, v0, u1, v1) in
                                                                 Blender UV space (v up).

No brands, logos or real business names: every word printed here is a generic Korean / English product word."""
import argparse
import json
import math
import os
import random

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
ap = argparse.ArgumentParser()
ap.add_argument("--cc0", default=os.path.join(REPO, "art", "shop", "cc0"))
ap.add_argument("--out", default=os.path.join(REPO, "art", "shop", "tex"))
A = ap.parse_args()
os.makedirs(A.out, exist_ok=True)
FONT_DIR = os.path.join(os.environ.get("WINDIR", "C:/Windows"), "Fonts")
KR_B = os.path.join(FONT_DIR, "malgunbd.ttf")
KR = os.path.join(FONT_DIR, "malgun.ttf")
rng = random.Random(7)
nrng = np.random.default_rng(7)


def font(size, bold=True):
    return ImageFont.truetype(KR_B if bold else KR, size)


def cc0(asset, kind):
    p = os.path.join(A.cc0, asset, f"{asset}_1K-JPG_{kind}.jpg")
    return Image.open(p) if os.path.exists(p) else None


def hexc(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def noise(w, h, scale, seed, octaves=4):
    """Value noise in 0..1 (bilinear-upsampled random grids, summed octaves)."""
    g = np.random.default_rng(seed)
    out = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        cw, ch = max(2, int(w / scale * 2 ** o)), max(2, int(h / scale * 2 ** o))
        a = (g.random((ch, cw)) * 255).astype(np.uint8)
        im = Image.fromarray(a).resize((w, h), Image.BICUBIC)
        out += np.asarray(im, np.float32) / 255 * amp
        tot += amp
        amp *= 0.5
    return out / tot


def preshade(asset, size, tint=None, relief=0.35, ao_amt=1.0, rot=0):
    """CC0 colour x AO x the normal map's relief under a light from above-left (flat = 1.0), optionally tinted."""
    col = np.asarray(cc0(asset, "Color").convert("RGB").resize((size, size), Image.LANCZOS), np.float32) / 255
    nrm = cc0(asset, "NormalGL")
    shade = np.ones((size, size), np.float32)
    if nrm is not None:
        n = np.asarray(nrm.convert("RGB").resize((size, size), Image.LANCZOS), np.float32) / 255 * 2 - 1
        L = np.array([-0.35, 0.55, 0.76], np.float32)
        L /= np.linalg.norm(L)
        lam = np.clip((n * L).sum(-1), 0, 1) / L[2]
        shade *= 1 - relief + relief * lam
    ao = cc0(asset, "AmbientOcclusion")
    if ao is not None:
        a = np.asarray(ao.convert("L").resize((size, size), Image.LANCZOS), np.float32) / 255
        shade *= 1 - ao_amt + ao_amt * a
    out = col * shade[..., None]
    if tint is not None:
        lum = out.mean(-1, keepdims=True)
        t = np.array(tint, np.float32) / 255
        out = lum / max(1e-3, float(col.mean())) * t * 0.5 + out * 0.5
    img = Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8))
    return img.rotate(rot, expand=False) if rot else img


def to_arr(img):
    return np.asarray(img.convert("RGB"), np.float32) / 255


def from_arr(a):
    return Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))


def seamless_strokes(img, n, col, alpha, wmin, wmax, lmin, lmax, seed, curve=0.6):
    """Scuffs / scratches drawn with wrap-around so the tile stays seamless."""
    r = random.Random(seed)
    W, H = img.size
    lay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    for _ in range(n):
        x, y = r.uniform(0, W), r.uniform(0, H)
        a = r.uniform(0, math.tau)
        ln = r.uniform(lmin, lmax)
        pts = []
        for k in range(8):
            a += r.uniform(-curve, curve) * 0.3
            pts.append((x, y))
            x += math.cos(a) * ln / 8
            y += math.sin(a) * ln / 8
        w = r.uniform(wmin, wmax)
        c = (*col, int(255 * alpha * r.uniform(0.5, 1)))
        for ox in (-W, 0, W):
            for oy in (-H, 0, H):
                d.line([(p[0] + ox, p[1] + oy) for p in pts], fill=c, width=max(1, int(w)))
    lay = lay.filter(ImageFilter.GaussianBlur(0.6))
    base = img.convert("RGBA")
    base.alpha_composite(lay)
    return base.convert("RGB")


# ---------------------------------------------------------------------------------------------------- tiling surfaces
def make_floor():
    # 300 mm white ceramic tiles (the references' shop floors), 1024 px = 2.4 m: warm grey grime in the joints, scuffs, a
    # light dirt cloud, each tile a slightly different white
    img = preshade("Tiles107", 1024, relief=0.5, ao_amt=1.0)
    a = to_arr(img)
    t = 1024 / 8
    tile_var = np.ones((1024, 1024, 1), np.float32)
    for i in range(8):
        for j in range(8):
            tile_var[int(j * t):int((j + 1) * t), int(i * t):int((i + 1) * t)] = 0.94 + 0.08 * rng.random()
    a = a * tile_var
    a *= np.array([0.96, 0.94, 0.9], np.float32)  # aged warm white
    dirt = noise(1024, 1024, 160, 11)
    a *= (1 - 0.06 * np.clip((dirt - 0.5) * 3, 0, 1))[..., None]
    # grime in the joints: the grid lines (every 128 px), warm grey
    jm = np.zeros((1024, 1024), np.float32)
    for k in range(9):
        c = int(k * t) % 1024
        for dx in (-3, -2, -1, 0, 1, 2):
            jm[:, (c + dx) % 1024] = 1
            jm[(c + dx) % 1024, :] = 1
    jm = np.asarray(Image.fromarray((jm * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.5)), np.float32) / 255
    jm *= 0.5 + 0.5 * noise(1024, 1024, 60, 12)
    a = a * (1 - 0.45 * jm[..., None]) + np.array([0.36, 0.32, 0.27]) * 0.45 * jm[..., None]
    img = from_arr(a)
    img = seamless_strokes(img, 120, (60, 52, 44), 0.18, 1, 3, 20, 90, 3)  # shoe scuffs
    img = seamless_strokes(img, 40, (40, 36, 30), 0.3, 1, 2, 6, 25, 4)  # black rubber marks
    img.save(os.path.join(A.out, "floor.png"))


def make_wall():
    # painted plaster, 1024 px = 2.0 m: a cream emulsion over trowelled plaster, a few faint stains and hairline cracks
    img = preshade("PaintedPlaster017", 1024, tint=hexc("#efeae0"), relief=0.5, ao_amt=0)
    a = to_arr(img)
    st = noise(1024, 1024, 220, 21)
    a *= (1 - 0.035 * np.clip((st - 0.5) * 4, 0, 1))[..., None]
    a *= np.array([1.0, 0.99, 0.965], np.float32)
    img = from_arr(a)
    img = seamless_strokes(img, 4, (120, 110, 95), 0.15, 1, 1, 60, 180, 5, curve=2.0)
    img.save(os.path.join(A.out, "wall.png"))


def make_wainscot():
    # vertical tongue-and-groove boards (varnished pine gone honey-brown), 1024 px = 1.0 m wide: 8 boards, V-grooves
    img = preshade("Wood087", 1024, relief=0.4, rot=90)
    a = to_arr(img)
    a = a * np.array([0.82, 0.62, 0.4], np.float32) * 1.05
    bw = 128
    for i in range(8):
        a[:, i * bw:(i + 1) * bw] *= 0.9 + 0.16 * rng.random()
        x = i * bw
        for dx, f in ((-2, 0.75), (-1, 0.45), (0, 0.35), (1, 0.55), (2, 0.85), (3, 1.08)):
            a[:, (x + dx) % 1024] *= f
    grime = np.linspace(0, 1, 1024, dtype=np.float32)[:, None, None]  # darker toward the floor (v down = image bottom)
    a *= 1 - 0.12 * grime ** 3
    img = from_arr(a)
    img = seamless_strokes(img, 50, (40, 26, 14), 0.25, 1, 2, 10, 60, 6)  # knocks and scratches
    img.save(os.path.join(A.out, "wainscot.png"))


def make_ceiling():
    # 300 mm mineral fibre ceiling tiles (석고 텍스), 512 px = 1.2 m, gone a little yellow, a water stain
    img = preshade("OfficeCeiling001", 512, relief=0.5)
    a = to_arr(img) * np.array([0.97, 0.95, 0.88], np.float32)
    pin = nrng.random((512, 512)) < 0.05  # the pinholes
    a[pin] *= 0.82
    st = noise(512, 512, 140, 31)
    a *= (1 - 0.1 * np.clip((st - 0.62) * 6, 0, 1))[..., None] * np.array([1, 0.98, 0.93])[None, None]
    from_arr(a).save(os.path.join(A.out, "ceiling.png"))


def make_wood():
    # the counter top and the shop's shelves: dark varnished hardwood worn pale by elbows and coins, 1024 px = 1.0 m
    img = preshade("Wood066", 1024, relief=0.45)
    a = to_arr(img) * 1.08
    wear = noise(1024, 1024, 300, 41)
    pale = np.clip((wear - 0.55) * 3, 0, 1)[..., None]
    a = a * (1 - 0.3 * pale) + np.array([0.62, 0.45, 0.3]) * 0.3 * pale
    img = from_arr(a)
    img = seamless_strokes(img, 220, (205, 175, 140), 0.22, 1, 1, 15, 120, 8, curve=0.2)  # fine scratches through the varnish
    img = seamless_strokes(img, 30, (30, 18, 10), 0.3, 1, 2, 8, 40, 9)
    # two cup rings
    d = ImageDraw.Draw(img, "RGBA")
    for (x, y, r) in ((300, 700, 46), (720, 260, 40)):
        d.ellipse((x - r, y - r, x + r, y + r), outline=(40, 25, 14, 70), width=4)
    img.save(os.path.join(A.out, "wood.png"))


def make_peg():
    # brown hardboard pegboard, 6 mm holes on a 25 mm grid, 512 px = 0.4 m (16 x 16 holes)
    S = 512
    base = noise(S, S, 30, 51, 5)
    fib = noise(S, S, 6, 52, 2)
    c = np.array([0.5, 0.36, 0.23], np.float32)
    a = c[None, None] * (0.88 + 0.16 * base[..., None] + 0.06 * fib[..., None])
    img = from_arr(a)
    d = ImageDraw.Draw(img)
    p = S / 16
    r = p * 0.12
    for i in range(16):
        for j in range(16):
            x, y = (i + 0.5) * p, (j + 0.5) * p
            d.ellipse((x - r - 1.2, y - r - 1.2, x + r + 1.2, y + r + 1.2), fill=(150, 112, 78))  # the punched rim, lighter
            d.ellipse((x - r, y - r, x + r, y + r), fill=(22, 16, 12))
            d.ellipse((x - r, y - r + r * 0.6, x + r, y + r), fill=(10, 8, 6))
    img.save(os.path.join(A.out, "peg.png"))


# ---------------------------------------------------------------------------------------------------- props atlas
ATLAS = 2048
items = []  # (key, w, h, draw(img_rgba) -> None)


def item(key, w, h):
    def deco(fn):
        items.append((key, w, h, fn))
        return fn
    return deco


def grad(w, h, c0, c1, horizontal=False):
    t = np.linspace(0, 1, w if horizontal else h, dtype=np.float32)
    if horizontal:
        t = t[None, :, None]
    else:
        t = t[:, None, None]
    a = np.array(c0, np.float32) * (1 - t) + np.array(c1, np.float32) * t
    a = np.broadcast_to(a, (h, w, 3))
    return Image.fromarray(a.astype(np.uint8)).convert("RGBA")


def text_c(d, xy, s, f, fill, anchor="mm", stroke=0, stroke_fill=None):
    d.text(xy, s, font=f, fill=fill, anchor=anchor, stroke_width=stroke, stroke_fill=stroke_fill)


def barcode(d, x, y, w, h, seed):
    r = random.Random(seed)
    d.rectangle((x - 3, y - 3, x + w + 3, y + h + 8), fill=(250, 250, 250))
    xx = x
    while xx < x + w:
        bw = r.choice((1, 1, 2, 3))
        if r.random() < 0.55:
            d.rectangle((xx, y, xx + bw - 1, y + h), fill=(10, 10, 10))
        xx += bw + r.choice((1, 1, 2))


def hang_hole(d, cx, y, w=34, h=12, col=(60, 46, 34)):
    d.rounded_rectangle((cx - w / 2, y - h / 2, cx + w / 2, y + h / 2), radius=h / 2, fill=col)
    d.rounded_rectangle((cx - w / 2 + 2, y - h / 2 + 2, cx + w / 2 - 2, y + h / 2 - 1), radius=h / 2, fill=(26, 20, 15))


def draw_minnow(lay, cx, cy, L, back, belly, seed, angle=0.0):
    """A hard minnow lure: a tapered body (dark back to pale belly), scale dots, a 3D eye, a clear lip, two treble hooks."""
    r = random.Random(seed)
    W = int(L * 1.6)
    H = int(L * 0.7)
    lur = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(lur)
    ox, oy = W * 0.2, H * 0.5
    bh = L * 0.2
    body = []
    for k in range(41):
        t = k / 40
        x = ox + t * L
        half = bh * (math.sin(math.pi * min(1, t * 1.05)) ** 0.6) * (1 - 0.35 * t)
        body.append((x, oy - half))
    for k in range(40, -1, -1):
        t = k / 40
        x = ox + t * L
        half = bh * (math.sin(math.pi * min(1, t * 1.05)) ** 0.6) * (1 - 0.35 * t)
        body.append((x, oy + half * 0.9))
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).polygon(body, fill=255)
    yy = (np.arange(H, dtype=np.float32) - oy) / bh  # -1 at the back, +1 at the belly
    tb = np.clip((yy + 0.6) / 1.2, 0, 1)[:, None, None]
    ga = np.array(back, np.float32) * (1 - tb) + np.array(belly, np.float32) * tb
    hl = np.exp(-((yy + 0.2) ** 2) / 0.03)[:, None, None] * 90  # the shine along the flank
    ga = np.clip(np.broadcast_to(ga + hl, (H, W, 3)), 0, 255)
    g = Image.fromarray(ga.astype(np.uint8)).convert("RGBA")
    sd = ImageDraw.Draw(g)
    for _ in range(int(L * 1.2)):  # scales
        x, y = r.uniform(ox + L * 0.2, ox + L * 0.95), r.uniform(oy - bh * 0.6, oy + bh * 0.4)
        sd.ellipse((x, y, x + 2, y + 2), outline=(255, 255, 255, 90))
    lur.paste(g, (0, 0), mask)
    d = ImageDraw.Draw(lur)
    ex, ey, er = ox + L * 0.12, oy - bh * 0.15, max(2.5, L * 0.045)
    d.ellipse((ex - er, ey - er, ex + er, ey + er), fill=(240, 220, 60), outline=(30, 30, 30))
    d.ellipse((ex - er * 0.5, ey - er * 0.5, ex + er * 0.5, ey + er * 0.5), fill=(10, 10, 10))
    d.ellipse((ex - er * 0.4, ey - er * 0.6, ex - er * 0.05, ey - er * 0.25), fill=(255, 255, 255))
    d.polygon([(ox + 1, oy + bh * 0.05), (ox - L * 0.16, oy + bh * 0.75), (ox - L * 0.08, oy + bh * 0.95), (ox + L * 0.06, oy + bh * 0.4)], fill=(230, 235, 240, 120), outline=(255, 255, 255, 160))
    for hx in (ox + L * 0.38, ox + L * 0.88):  # treble hooks
        d.line((hx, oy + bh * 0.85, hx, oy + bh * 1.4), fill=(70, 70, 75), width=2)
        for s in (-1, 1):
            d.arc((hx - 7 + s * 4, oy + bh * 1.25, hx + 7 + s * 4, oy + bh * 1.75), 0, 180, fill=(70, 70, 75), width=2)
    lur = lur.rotate(angle, resample=Image.BICUBIC, expand=True)
    W, H = lur.size
    lay.alpha_composite(lur, (int(cx - W / 2), int(cy - H / 2)))


def blister_sheen(img, box):
    """The clear blister: a cool grey veil, a bright soft streak and a sharp edge line."""
    x0, y0, x1, y1 = box
    lay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    d.rounded_rectangle(box, radius=14, fill=(225, 235, 245, 24), outline=(255, 255, 255, 170), width=2)
    d.polygon([(x0 + 10, y1 - 30), (x0 + 30, y1 - 30), (x1 - 30, y0 + 22), (x1 - 46, y0 + 22)], fill=(255, 255, 255, 70))
    lay = lay.filter(ImageFilter.GaussianBlur(1.0))
    img.alpha_composite(lay)


LURE = [  # card colours, lure back / belly, name, spec
    ((200, 30, 32), (24, 24, 26), (40, 90, 60), (235, 235, 210), "MINNOW", "90F  9g"),
    ((20, 32, 70), (40, 80, 150), (30, 40, 80), (225, 230, 235), "MINNOW", "110SP 14g"),
    ((240, 200, 30), (30, 30, 30), (210, 90, 30), (250, 235, 200), "CRANK", "60F  7g"),
    ((28, 28, 30), (160, 160, 165), (60, 70, 65), (220, 220, 200), "VIBRATION", "S  12g"),
    ((240, 240, 240), (20, 110, 200), (20, 120, 60), (240, 240, 120), "SHAD", "70S  8g"),
    ((230, 110, 20), (30, 30, 30), (120, 60, 30), (250, 220, 170), "POPPER", "65F  9g"),
    ((30, 120, 70), (240, 240, 230), (100, 120, 40), (240, 230, 180), "MINNOW", "70S  6g"),
    ((120, 20, 40), (240, 190, 60), (180, 40, 50), (250, 220, 220), "SPOON", "#3  10g"),
]
for i, (c0, c1, back, belly, name, spec) in enumerate(LURE):
    @item(f"lure{i}", 192, 320)
    def _lure(img, i=i, c0=c0, c1=c1, back=back, belly=belly, name=name, spec=spec):
        W, H = img.size
        img.paste(grad(W, H, c0, c1), (0, 0))
        d = ImageDraw.Draw(img)
        d.rectangle((0, 0, W, 46), fill=tuple(int(v * 0.55) for v in c0))
        hang_hole(d, W / 2, 20)
        text_c(d, (W / 2, 62), name, font(26), (255, 255, 255), stroke=2, stroke_fill=(0, 0, 0))
        box = (18, 82, W - 18, 262)
        d.rounded_rectangle(box, radius=14, fill=tuple(int(v * 0.4 + 120) for v in c0))
        d.rounded_rectangle((box[0] + 6, box[1] + 6, box[2] - 6, box[3] - 6), radius=10, fill=tuple(int(v * 0.55 + 70) for v in c1))
        draw_minnow(img, W / 2, 172, 118 if name not in ("CRANK", "POPPER", "SPOON") else 92, back, belly, 100 + i, angle=-38)
        blister_sheen(img, box)
        text_c(d, (W / 2, 280), spec, font(20), (255, 255, 255), stroke=1, stroke_fill=(0, 0, 0))
        barcode(d, W - 74, H - 30, 58, 16, i)


WORMS = [((180, 20, 24), (90, 105, 50), "GRUB 3\""), ((20, 20, 22), (150, 80, 40), "WORM 4\""), ((190, 25, 30), (40, 40, 45), "STRAIGHT 5\""),
         ((25, 25, 28), (30, 120, 60), "CRAW 3.5\""), ((200, 30, 30), (210, 160, 60), "SHAD 3\""), ((20, 22, 30), (110, 60, 120), "GRUB 2\"")]
for i, (bag, worm, name) in enumerate(WORMS):
    @item(f"worm{i}", 192, 320)
    def _worm(img, i=i, bag=bag, worm=worm, name=name):
        # a soft-plastic bait bag: a printed zip bag with a clear window, the worms inside (ref03)
        W, H = img.size
        img.paste(grad(W, H, bag, tuple(int(v * 0.6) for v in bag)), (0, 0))
        d = ImageDraw.Draw(img)
        d.rectangle((0, 0, W, 34), fill=(235, 235, 235))
        for x in range(0, W, 6):
            d.line((x, 30, x, 34), fill=(190, 190, 190))
        hang_hole(d, W / 2, 16, col=(150, 150, 150))
        d.rectangle((0, 40, W, 92), fill=(15, 15, 15) if bag[0] > 100 else (200, 30, 30))
        text_c(d, (W / 2, 66), name, font(24), (255, 255, 255))
        win = (16, 104, W - 16, 286)
        d.rounded_rectangle(win, radius=10, fill=(215, 220, 222))
        r = random.Random(200 + i)
        for k in range(6):  # curly-tail worms
            y = 120 + k * 27
            pts = []
            for t in range(18):
                pts.append((26 + t * 8, y + 7 * math.sin(t * 0.7 + k)))
            col = tuple(min(255, int(v * r.uniform(0.85, 1.15))) for v in worm)
            d.line(pts, fill=col, width=11, joint="curve")
            d.ellipse((pts[-1][0] - 8, pts[-1][1] - 10, pts[-1][0] + 12, pts[-1][1] + 10), fill=col)
            for _ in range(10):
                gx, gy = r.choice(pts)
                d.point((gx + r.uniform(-3, 3), gy + r.uniform(-3, 3)), fill=(255, 240, 160))
        blister_sheen(img, win)
        barcode(d, 22, H - 28, 60, 14, 50 + i)
        text_c(d, (W - 50, H - 20), "8 pcs", font(16), (255, 255, 255))


FLOATS = [((255, 70, 20), (255, 230, 0)), ((255, 40, 120), (30, 220, 80)), ((255, 120, 0), (255, 255, 255)), ((230, 20, 20), (255, 210, 0)),
          ((40, 220, 80), (255, 60, 60)), ((255, 90, 0), (40, 40, 40))]
for i, (t0, t1) in enumerate(FLOATS):
    @item(f"float{i}", 64, 384)
    def _float(img, i=i, t0=t0, t1=t1):
        # a long clear sleeve with one 찌 inside: tip bands, a white body, a reed stem; a printed label strip at the top
        W, H = img.size
        img.paste(grad(W, H, (120, 132, 145), (90, 100, 112), horizontal=True), (0, 0))
        d = ImageDraw.Draw(img)
        d.rectangle((0, 0, W, 54), fill=(240, 240, 236))
        hang_hole(d, W / 2, 12, w=22, h=8, col=(170, 170, 170))
        text_c(d, (W / 2, 32), f"{2 + i * 0.5:.1f}g", font(15), (200, 20, 20))
        text_c(d, (W / 2, 47), "부력", font(11, False), (40, 40, 40))
        cx = W / 2
        y = 62
        for k in range(7):  # the tip's bands
            c = t0 if k % 2 == 0 else t1
            d.rectangle((cx - 4, y, cx + 4, y + 12), fill=c)
            y += 12
        d.polygon([(cx - 4, y), (cx + 4, y), (cx + 13, y + 60), (cx + 13, y + 150), (cx, y + 205), (cx - 13, y + 150), (cx - 13, y + 60)], fill=(250, 248, 240))
        d.line((cx - 5, y + 60, cx - 5, y + 150), fill=(255, 255, 255), width=2)
        d.rectangle((cx - 9, y + 70, cx + 9, y + 76), fill=t0)
        d.line((cx, y + 205, cx, H - 12), fill=(150, 110, 60), width=3)
        sheen = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ImageDraw.Draw(sheen).rectangle((6, 56, 12, H - 6), fill=(255, 255, 255, 90))
        img.alpha_composite(sheen.filter(ImageFilter.GaussianBlur(1.5)))


BAIT = [("어분", "붕어 떡밥", (230, 120, 20), (250, 220, 60), "1kg"), ("보리", "곡물 떡밥", (40, 110, 200), (230, 240, 250), "800g"),
        ("글루텐", "찰진 미끼", (240, 220, 40), (200, 30, 30), "300g"), ("집어제", "냄새로 모아요", (40, 150, 70), (250, 240, 200), "500g"),
        ("새우가루", "바닥 떡밥", (210, 40, 40), (255, 210, 120), "700g"), ("옥수수", "곡물 떡밥", (250, 200, 30), (60, 120, 40), "1kg"),
        ("어분", "향 진한", (130, 40, 140), (250, 230, 120), "1kg"), ("콩가루", "부드러운", (240, 240, 230), (40, 120, 200), "600g")]
for i, (big, small, c0, c1, wgt) in enumerate(BAIT):
    @item(f"bait{i}", 256, 352)
    def _bait(img, i=i, big=big, small=small, c0=c0, c1=c1, wgt=wgt):
        # a 떡밥 bag (ref05): a crimped top seal, a bold name panel, a carp drawing, the weight burst
        W, H = img.size
        img.paste(grad(W, H, c0, tuple(int(v * 0.75) for v in c0)), (0, 0))
        d = ImageDraw.Draw(img)
        for x in range(0, W, 5):
            d.line((x, 0, x, 18), fill=tuple(int(v * 0.7) for v in c0))
        d.rectangle((0, 18, W, 22), fill=tuple(int(v * 0.6) for v in c0))
        d.rounded_rectangle((14, 40, W - 14, 150), radius=16, fill=c1)
        fcol = (20, 20, 20) if sum(c1) > 500 else (255, 255, 255)
        text_c(d, (W / 2, 88), big, font(62 if len(big) <= 2 else 46), c0 if sum(c1) > 500 else (255, 255, 255), stroke=3, stroke_fill=fcol)
        text_c(d, (W / 2, 134), small, font(22), fcol)
        # a carp drawing (body + fins + eye) on a water swirl
        cy = 230
        d.ellipse((30, cy - 50, W - 30, cy + 50), fill=tuple(int(v * 0.85) for v in c0))
        d.ellipse((60, cy - 28, 190, cy + 26), fill=(196, 160, 70))
        d.polygon([(180, cy), (222, cy - 26), (214, cy), (222, cy + 26)], fill=(176, 140, 60))
        d.polygon([(100, cy - 26), (140, cy - 44), (160, cy - 22)], fill=(176, 140, 60))
        d.ellipse((76, cy - 10, 86, cy), fill=(20, 20, 20))
        for k in range(14):
            x, y = 100 + (k % 7) * 12, cy - 12 + (k // 7) * 14
            d.arc((x, y, x + 12, y + 10), 200, 340, fill=(150, 115, 45), width=2)
        d.regular_polygon((W - 50, 300, 34), 12, fill=(255, 240, 0), outline=(200, 30, 30))
        text_c(d, (W - 50, 300), wgt, font(20), (200, 20, 20))
        barcode(d, 20, H - 34, 70, 18, 80 + i)
        r = random.Random(i)
        lay = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ld = ImageDraw.Draw(lay)
        for _ in range(4):  # crinkles of the foil bag
            x = r.uniform(0, W)
            ld.line((x, 20, x + r.uniform(-40, 40), H), fill=(255, 255, 255, 40), width=r.randint(3, 8))
        img.alpha_composite(lay.filter(ImageFilter.GaussianBlur(3)))


@item("can_corn", 256, 96)
def _can(img):
    W, H = img.size
    img.paste(grad(W, H, (40, 120, 50), (30, 90, 40)), (0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle((0, 14, W, H - 14), fill=(250, 210, 40))
    r = random.Random(3)
    for _ in range(90):
        x, y = r.uniform(130, 250), r.uniform(18, H - 18)
        d.ellipse((x, y, x + 9, y + 7), fill=(255, 230, 80), outline=(210, 150, 20))
    text_c(d, (64, H / 2 - 4), "옥수수", font(30), (40, 110, 40))
    text_c(d, (64, H / 2 + 24), "미끼용", font(14, False), (90, 60, 20))


@item("cup_lid", 96, 96)
def _lid(img):
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, 96, 96), fill=(40, 120, 60))
    d.ellipse((4, 4, 92, 92), fill=(60, 150, 80), outline=(30, 90, 40), width=3)
    text_c(d, (48, 48), "지렁이", font(18), (255, 255, 255))


for i, (lc, lbl) in enumerate((((40, 160, 70), "3호"), ((240, 240, 240), "2호"), ((230, 90, 30), "4호"), ((40, 100, 200), "1.5호"))):
    @item(f"spool{i}", 96, 96)
    def _spool(img, lc=lc, lbl=lbl):
        d = ImageDraw.Draw(img)
        d.rectangle((0, 0, 96, 96), fill=(30, 30, 34))
        d.ellipse((2, 2, 94, 94), fill=(30, 30, 34), outline=(120, 120, 125), width=2)
        d.ellipse((14, 14, 82, 82), fill=lc)
        for rr in range(16, 34, 3):
            d.ellipse((48 - rr, 48 - rr, 48 + rr, 48 + rr), outline=tuple(max(0, v - 30) for v in lc), width=1)
        d.ellipse((34, 34, 62, 62), fill=(230, 230, 230))
        text_c(d, (48, 48), lbl, font(14), (20, 20, 20))


@item("board", 640, 448)
def _board(img):
    # the whiteboard price / rental notice, written by hand in marker (blue, red, black), magnets, a ghost of old writing
    W, H = img.size
    a = np.full((H, W, 3), 246, np.float32) - noise(W, H, 120, 61)[..., None] * 10
    img.paste(from_arr(a / 255).convert("RGBA"), (0, 0))
    ghost = Image.new("RGBA", img.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(ghost)
    r = random.Random(9)
    for _ in range(10):
        x, y = r.uniform(40, W - 200), r.uniform(60, H - 40)
        gd.text((x, y), r.choice(["대여", "무료", "09:00", "만석", "입어료", "18:00"]), font=font(34, False), fill=(120, 130, 160, 28))
    img.alpha_composite(ghost.filter(ImageFilter.GaussianBlur(1.5)))
    lay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)

    def hand(x, y, s, size, col, rot=0.0):
        t = Image.new("RGBA", (W, 90), (0, 0, 0, 0))
        ImageDraw.Draw(t).text((10, 10), s, font=font(size), fill=col)
        t = t.rotate(rot, resample=Image.BICUBIC, center=(10, 45))
        lay.alpha_composite(t, (int(x - 10), int(y - 10)))

    blue, red, black = (20, 50, 170, 255), (200, 25, 30, 255), (25, 25, 30, 255)
    hand(W / 2 - 150, 22, "관리소 안내", 46, black, 0.6)
    d.line((40, 92, W - 40, 90), fill=blue, width=4)
    rows = [("낚싯대 대여", "무료", red), ("받침틀 · 뜰채", "같이 드려요", blue), ("떡밥 · 지렁이", "판매해요", blue), ("의자 · 파라솔", "창구에 문의", blue)]
    y = 110
    for k, (a_, b_, c_) in enumerate(rows):
        hand(46, y, a_, 34, black, r.uniform(-0.8, 0.8))
        d.line((300, y + 32, 380, y + 31), fill=(80, 80, 90, 255), width=2)
        hand(395, y, b_, 34, c_, r.uniform(-0.8, 0.8))
        y += 58
    hand(46, y + 6, "※ 반납은 이 창구로!", 30, red, -0.5)
    hand(46, y + 50, "※ 외래어종은 수거함에", 28, blue, 0.4)
    img.alpha_composite(lay)
    d = ImageDraw.Draw(img)
    for (x, y, c) in ((30, 24, (220, 40, 40)), (W - 34, 30, (40, 90, 220)), (W - 60, H - 40, (240, 200, 30))):
        d.ellipse((x - 13, y - 13, x + 13, y + 13), fill=c, outline=tuple(int(v * 0.6) for v in c), width=2)
        d.ellipse((x - 7, y - 9, x - 1, y - 3), fill=(255, 255, 255))


@item("clock", 192, 192)
def _clock(img):
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, 192, 192), fill=(30, 30, 32))
    d.ellipse((4, 4, 188, 188), fill=(248, 247, 242))
    d.ellipse((4, 4, 188, 188), outline=(200, 200, 200), width=2)
    for k in range(60):
        a = k / 60 * math.tau
        r0 = 80 if k % 5 else 72
        d.line((96 + math.sin(a) * r0, 96 - math.cos(a) * r0, 96 + math.sin(a) * 86, 96 - math.cos(a) * 86), fill=(30, 30, 30), width=1 if k % 5 else 3)
    for n in range(1, 13):
        a = n / 12 * math.tau
        text_c(d, (96 + math.sin(a) * 60, 96 - math.cos(a) * 60), str(n), font(20), (25, 25, 25))
    text_c(d, (96, 130), "QUARTZ", font(9, False), (120, 120, 120))


@item("photo", 260, 204)
def _photo(img):
    W, H = img.size
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, W, H), fill=(250, 248, 240))
    p = os.path.join(A.out, "catch_photo.png")
    if os.path.exists(p):
        ph = Image.open(p).convert("RGBA").resize((W - 20, H - 44), Image.LANCZOS)
        img.alpha_composite(ph, (10, 10))
    t = Image.new("RGBA", (W, 40), (0, 0, 0, 0))
    ImageDraw.Draw(t).text((14, 4), "붕어 32cm  월척!", font=font(22, False), fill=(30, 40, 140))
    img.alpha_composite(t.rotate(1.0, resample=Image.BICUBIC), (0, H - 36))


@item("ruler", 640, 80)
def _ruler(img):
    # the fish-measuring board's face: white with a black cm scale 0-60, numbers every 5 cm, a yellow head stop
    W, H = img.size
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, W, H), fill=(242, 242, 236))
    d.rectangle((0, 0, 26, H), fill=(240, 196, 30))
    for k in range(61):
        x = 30 + k * (W - 44) / 60
        ln = 34 if k % 10 == 0 else (24 if k % 5 == 0 else 14)
        d.line((x, H - 4, x, H - 4 - ln), fill=(15, 15, 15), width=2 if k % 5 == 0 else 1)
        if k % 5 == 0 and k:
            text_c(d, (x, 16), str(k), font(16), (15, 15, 15))
    d.line((26, H - 4, W, H - 4), fill=(15, 15, 15), width=2)


@item("ledger", 256, 176)
def _ledger(img):
    W, H = img.size
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, W, H), fill=(248, 245, 232))
    d.line((W / 2, 0, W / 2, H), fill=(170, 160, 140), width=3)
    r = random.Random(12)
    for side in (0, 1):
        x0 = 10 + side * W / 2
        for k in range(10):
            y = 16 + k * 15
            d.line((x0, y, x0 + W / 2 - 20, y), fill=(160, 190, 220), width=1)
            x = x0 + 4
            while x < x0 + r.uniform(60, W / 2 - 24):  # a hand's scrawl
                w = r.uniform(4, 12)
                d.line((x, y - 3, x + w, y - 6 + r.uniform(-2, 2)), fill=(40, 40, 70), width=1)
                x += w + r.uniform(1, 4)
    d.line((W / 2 + 14, 4, W / 2 + 14, H), fill=(230, 120, 120), width=1)


@item("calendar", 192, 272)
def _cal(img):
    W, H = img.size
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, W, H), fill=(250, 250, 246))
    p = os.path.join(A.out, "catch_photo.png")
    if os.path.exists(p):
        ph = Image.open(p).convert("RGBA").crop((60, 40, 420, 300)).resize((W - 16, 110), Image.LANCZOS)
        img.alpha_composite(ph, (8, 8))
    text_c(d, (W / 2, 136), "11", font(26), (200, 30, 30))
    for k in range(30):
        x, y = 16 + (k + 3) % 7 * 26, 160 + (k + 3) // 7 * 22
        text_c(d, (x + 4, y + 6), str(k + 1), font(12, False), (200, 30, 30) if (k + 3) % 7 == 0 else (40, 40, 40))


@item("nosmoke", 128, 128)
def _nosmoke(img):
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, 128, 128), fill=(250, 250, 250))
    d.rectangle((44, 60, 100, 72), fill=(40, 40, 40))
    d.rectangle((92, 60, 100, 72), fill=(230, 120, 30))
    d.ellipse((10, 10, 118, 118), outline=(210, 20, 20), width=10)
    d.line((30, 30, 98, 98), fill=(210, 20, 20), width=10)
    text_c(d, (64, 108), "금연", font(14), (210, 20, 20))


@item("extinguisher", 96, 160)
def _ext(img):
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, 96, 160), fill=(200, 22, 22))
    d.rectangle((10, 30, 86, 130), fill=(250, 250, 245))
    text_c(d, (48, 56), "소화기", font(18), (200, 20, 20))
    text_c(d, (48, 84), "ABC", font(16), (20, 20, 20))
    for k in range(4):
        d.line((18, 100 + k * 7, 78, 100 + k * 7), fill=(120, 120, 120))


@item("net", 256, 256)
def _net(img):
    # the landing net's knotless mesh, cut out (alpha): dark green nylon diamonds
    W, H = img.size
    d = ImageDraw.Draw(img)
    s = 32
    col = (30, 52, 40, 255)
    for k in range(-H, W + H, s):
        d.line((k, 0, k + H, H), fill=col, width=3)
        d.line((k, H, k + H, 0), fill=col, width=3)


@item("grille", 128, 128)
def _grille(img):
    d = ImageDraw.Draw(img)
    for r in range(8, 64, 7):
        d.ellipse((64 - r, 64 - r, 64 + r, 64 + r), outline=(225, 228, 230, 255), width=2)
    for k in range(16):
        a = k / 16 * math.tau
        d.line((64, 64, 64 + math.cos(a) * 63, 64 + math.sin(a) * 63), fill=(225, 228, 230, 255), width=2)
    d.ellipse((50, 50, 78, 78), fill=(220, 225, 230, 255))


def swatch(key, base, var=0.04, gloss=None, stripes=None, grain=None):
    @item(key, 64, 64)
    def _s(img, base=base, var=var, gloss=gloss, stripes=stripes, grain=grain):
        W, H = img.size
        n = noise(W, H, 16, hash(key) % 1000, 3)
        a = np.array(base, np.float32)[None, None] / 255 * (1 - var + 2 * var * n[..., None])
        if grain is not None:
            a *= (1 - grain + grain * noise(W, H, 3, hash(key) % 997, 2))[..., None]
        if stripes is not None:  # wound line on a spool: fine bands across v
            a *= (0.85 + 0.15 * (np.sin(np.arange(H) * stripes) > 0))[:, None, None]
        if gloss is not None:
            # a cylinder's u runs round it, u = 0.5 faces the window: a sharp highlight there, darker rims at the sides
            u = (np.arange(W) + 0.5) / W
            core = np.exp(-((u - 0.5) ** 2) / 0.0012) * gloss
            soft = np.exp(-((u - 0.5) ** 2) / 0.02) * gloss * 0.35
            rim = 1 - 0.35 * np.abs(np.sin(u * math.tau))
            a = a * rim[None, :, None] + (core + soft)[None, :, None]
        img.paste(from_arr(a).convert("RGBA"), (0, 0))


for k, c in (("rod_black", (22, 22, 26)), ("rod_navy", (20, 30, 70)), ("rod_wine", (90, 20, 30)), ("rod_green", (20, 60, 40)), ("rod_white", (220, 220, 215)),
             ("rod_grey", (70, 72, 76)), ("rod_gold", (150, 110, 40))):
    swatch(k, c, 0.02, gloss=0.75)
swatch("chrome", (150, 155, 160), 0.02, gloss=1.0)
swatch("gunmetal", (60, 62, 68), 0.03, gloss=0.5)
swatch("gold", (190, 150, 60), 0.03, gloss=0.6)
swatch("cork", (196, 150, 100), 0.25, grain=0.35)
swatch("eva_black", (34, 34, 36), 0.08, grain=0.3)
swatch("eva_grey", (95, 95, 98), 0.08, grain=0.3)
swatch("rubber", (28, 28, 30), 0.05)
for k, c in (("pl_black", (30, 30, 33)), ("pl_white", (232, 232, 226)), ("pl_blue", (30, 90, 190)), ("pl_red", (200, 30, 30)), ("pl_orange", (235, 110, 20)),
             ("pl_yellow", (240, 200, 30)), ("pl_green", (40, 140, 70)), ("pl_pink", (230, 70, 150)), ("pl_teal", (70, 170, 180)), ("pl_clear", (200, 210, 215)),
             ("pl_grey", (130, 132, 136))):
    swatch(k, c, 0.04, gloss=0.25)
swatch("cooler_white", (236, 236, 230), 0.03)
swatch("cooler_blue", (40, 110, 200), 0.03)
swatch("cooler_red", (210, 40, 36), 0.03)
swatch("steel", (150, 154, 158), 0.06)
swatch("steel_dark", (80, 84, 88), 0.06)
swatch("galv", (170, 172, 172), 0.12)
swatch("wire_white", (225, 225, 220), 0.03)
swatch("felt", (30, 34, 40), 0.1, grain=0.3)
swatch("cardboard", (170, 130, 85), 0.08, grain=0.2)
swatch("card_white", (240, 238, 230), 0.03)
swatch("fridge", (238, 240, 240), 0.02)
swatch("fridge_in", (215, 222, 228), 0.03)
swatch("fan_blue", (120, 180, 220), 0.03, gloss=0.25)
swatch("line_green", (40, 160, 70), 0.05, stripes=1.6)
swatch("line_white", (235, 235, 230), 0.05, stripes=1.6)
swatch("line_orange", (240, 110, 30), 0.05, stripes=1.6)
swatch("thread_red", (190, 20, 30), 0.05, stripes=2.2)
swatch("thread_gold", (200, 160, 50), 0.05, stripes=2.2)
swatch("nylon_green", (40, 70, 50), 0.1)
swatch("canvas_blue", (40, 70, 140), 0.08, grain=0.2)
swatch("canvas_green", (50, 80, 50), 0.08, grain=0.2)
swatch("parasol", (40, 90, 60), 0.05)
swatch("parasol_b", (230, 220, 190), 0.05)
swatch("ext_red", (200, 22, 22), 0.03, gloss=0.4)
swatch("alu", (190, 192, 195), 0.04, gloss=0.3)
swatch("dark", (14, 14, 16), 0.02)
swatch("paper", (248, 246, 238), 0.02)
swatch("glass_jar", (205, 220, 220), 0.03, gloss=0.6)
swatch("wood_light", (190, 150, 105), 0.12, grain=0.4)
swatch("wood_dark", (90, 60, 38), 0.12, grain=0.4)
swatch("cash_tray", (60, 64, 70), 0.04)
swatch("coin", (180, 170, 150), 0.1)
swatch("note_green", (150, 180, 140), 0.08)
swatch("note_blue", (150, 170, 200), 0.08)


def pack_atlas():
    order = sorted(items, key=lambda it: (-it[2], -it[1]))
    pad = 6
    x = y = 0
    row_h = 0
    rects = {}
    atlas = Image.new("RGBA", (ATLAS, ATLAS), (0, 0, 0, 0))
    for key, w, h, fn in order:
        if x + w + pad > ATLAS:
            x = 0
            y += row_h + pad
            row_h = 0
        assert y + h <= ATLAS, ("atlas full", key)
        img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        if key not in ("net", "grille"):
            img.paste((128, 128, 128, 255), (0, 0, w, h))
        fn(img)
        # bleed the edge pixels into the padding (mip maps must not pull in the neighbour)
        big = img.resize((w + 2 * pad // 2, h + 2 * pad // 2), Image.NEAREST)
        atlas.paste(big, (x, y))
        atlas.paste(img, (x + pad // 2, y + pad // 2))
        x0, y0 = x + pad // 2, y + pad // 2
        inset = 0.5
        rects[key] = [(x0 + inset) / ATLAS, 1 - (y0 + h - inset) / ATLAS, (x0 + w - inset) / ATLAS, 1 - (y0 + inset) / ATLAS]
        x += w + pad
        row_h = max(row_h, h)
    print("atlas used rows up to", y + row_h, "of", ATLAS)
    atlas.save(os.path.join(A.out, "atlas.png"))
    json.dump(rects, open(os.path.join(A.out, "atlas.json"), "w"), indent=1)


make_floor()
make_wall()
make_wainscot()
make_ceiling()
make_wood()
make_peg()
pack_atlas()
print("TEXTURES", A.out)
