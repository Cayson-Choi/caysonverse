"""Textures of the lake facilities (chunk B): grey-scale detail maps (the hue comes from COLOR_0) made from the CC0 sets in
art/village/downloads/tex (zelkova bark, cedar planks, grey roof tiles, concrete) plus small procedural ones (board grain,
log wall, brushed galvanised metal, painted metal with wear, fabric weave), and the lettering atlas (Jua, SIL OFL).
  python make_lake_textures_structures.py   -> art/lake/work/tex/*.png, atlas.json (pixel rects of the signs)"""
import json, os, numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "..", "village", "downloads", "tex"); OUT = os.path.join(ROOT, "work", "tex"); os.makedirs(OUT, exist_ok=True)
FONT = os.path.join(ROOT, "..", "village", "fonts", "Jua-Regular.ttf")
rng = np.random.default_rng(11)

def norm(a, mean=0.86, lo=0.35):
    a = a.astype(np.float32); a = a / max(a.mean(), 1e-6) * mean
    return np.clip(a, lo * 0 + 0.0, 1.0)

def save(name, a, size=512):
    im = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8), "L").resize((size, size), Image.LANCZOS)
    im.convert("RGB").save(os.path.join(OUT, name + ".png"))

def gray_of(fn, size=512):
    im = Image.open(os.path.join(SRC, fn)).convert("L").resize((size, size), Image.LANCZOS)
    return np.asarray(im, np.float32) / 255

def tile_noise(h, w, sy, sx, oct=4):
    out = np.zeros((h, w), np.float32); amp = 1.0; tot = 0
    for o in range(oct):
        gh, gw = max(2, int(h / sy) * 2 ** o), max(2, int(w / sx) * 2 ** o)
        g = rng.random((gh, gw)).astype(np.float32)
        im = Image.fromarray((g * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
        out += np.asarray(im, np.float32) / 255 * amp; tot += amp; amp *= 0.5
    return out / tot

# board grain: streaks along v (rows), knots
g = tile_noise(512, 512, 256, 6, 5)
g = 0.55 + 0.45 * (g - g.min()) / (g.max() - g.min())
for _ in range(7):
    cy, cx = rng.integers(40, 470), rng.integers(30, 480)
    yy, xx = np.mgrid[0:512, 0:512]
    d = ((yy - cy) / 26.0) ** 2 + ((xx - cx) / 9.0) ** 2
    g *= 1 - 0.35 * np.exp(-d)
save("grain", norm(g, 0.9))
# log wall: 4 logs per tile (tile = 1.0 m wide x 0.68 m high), bark streaks from zelkova bark
bark = gray_of("japanese_zelkova_bark_diff_1k.jpg", 512); bark = (bark - bark.min()) / (bark.max() - bark.min() + 1e-6)
streak = tile_noise(512, 512, 24, 160, 4)
w = np.zeros((512, 512), np.float32)
for i in range(4):
    y0 = i * 128; t = (np.arange(128) + 0.5) / 128
    prof = np.sin(np.pi * t) ** 0.55
    prof = 0.28 + 0.72 * prof
    w[y0:y0 + 128, :] = prof[:, None]
tex = w * (0.62 + 0.38 * streak) * (0.8 + 0.25 * np.roll(bark, 37, 0))
for i in range(4):
    tex[i * 128:i * 128 + 3, :] *= 0.25
save("log_wall", norm(tex, 0.95))
save("siding", norm(np.rot90(gray_of("japanese_cedar_planks_diff_1k.jpg")), 0.9))
save("tile", norm(gray_of("grey_roof_tiles_diff_1k.jpg"), 0.95))
save("concrete", norm(gray_of("smooth_concrete_floor_diff_1k.jpg"), 0.9))
# brushed galvanised metal
m = tile_noise(512, 512, 512, 4, 4) * 0.5 + tile_noise(512, 512, 2, 64, 2) * 0.5
save("metal", norm(0.7 + 0.3 * m, 0.92))
# painted metal / plastic with wear: soft noise, a few scratches and edge darkening
p = 0.85 + 0.15 * tile_noise(512, 512, 64, 64, 4)
im = Image.fromarray((p * 255).astype(np.uint8)); dr = ImageDraw.Draw(im)
for _ in range(60):
    x, y = rng.integers(0, 512, 2); dr.line([x, y, x + rng.integers(-60, 60), y + rng.integers(-60, 60)], fill=int(205 + rng.integers(0, 40)), width=1)
save("paint", norm(np.asarray(im.filter(ImageFilter.GaussianBlur(0.6)), np.float32) / 255, 0.92))
# fabric weave
yy, xx = np.mgrid[0:512, 0:512]
wv = 0.72 + 0.14 * np.sin(xx * 2 * np.pi / 4) * np.sin(yy * 2 * np.pi / 4) + 0.1 * tile_noise(512, 512, 128, 128, 2)
save("fabric", norm(wv, 0.92))

# --- lettering atlas
f = lambda s: ImageFont.truetype(FONT, int(s))
A = Image.new("RGB", (2048, 1024), (255, 255, 255)); d = ImageDraw.Draw(A); rects = {}
BLUE, INK, RED = (37, 99, 201), (31, 58, 138), (194, 59, 46)
def dotted(d, parts, cx, cy, size, fill):
    # text with "·" drawn as a dot (the font has none)
    fn = f(size); segs = [p.strip() for p in parts.split("·")]
    ws = [d.textlength(s, font=fn) for s in segs]; gap = size * 0.7
    tot = sum(ws) + gap * (len(segs) - 1); x = cx - tot / 2
    for i, s in enumerate(segs):
        d.text((x, cy), s, font=fn, fill=fill, anchor="lm"); x += ws[i]
        if i < len(segs) - 1:
            r = size * 0.07; d.ellipse([x + gap / 2 - r, cy - r, x + gap / 2 + r, cy + r], fill=fill); x += gap
def board(name, x, y, w, h, bg, border, lines, bw=14):
    rects[name] = [x, y, w, h]; d.rectangle([x, y, x + w - 1, y + h - 1], fill=border); d.rectangle([x + bw, y + bw, x + w - 1 - bw, y + h - 1 - bw], fill=bg)
    for text, frac, size, col in lines: dotted(d, text, x + w / 2, y + h * frac, size, col)
P = json.load(open(os.path.join(ROOT, "layout.json"), encoding="utf-8"))["params"]
board("office", 0, 0, 1540, 308, (241, 239, 232), BLUE, [(P["officeSignText"], 0.52, 170, INK)])
board("rental", 0, 312, 1568, 118, (241, 239, 232), BLUE, [(P["rentalSignText"], 0.52, 78, INK)], 8)
board("welcome", 0, 440, 728, 266, (44, 74, 56), (107, 63, 39), [(P["signText"], 0.5, 120, (228, 220, 203))])
board("info", 740, 440, 476, 350, (241, 239, 232), BLUE, [("이용 안내", 0.16, 58, (255, 255, 255)), ("낚싯대는 무료로", 0.4, 40, INK), ("빌려드려요", 0.52, 40, INK), ("배스·블루길은 수거함에", 0.68, 33, RED), ("쓰레기는 되가져가요", 0.84, 36, INK)])
d.rectangle([740 + 14, 440 + 14, 740 + 476 - 15, 440 + 14 + 70], fill=BLUE); dotted(d, "이용 안내", 740 + 238, 440 + 50, 58, (255, 255, 255))
board("bin", 1230, 440, 384, 276, (241, 239, 232), BLUE, [("외래어종 수거함", 0.34, 52, INK), ("배스 · 블루길", 0.68, 50, RED)], 10)
A.save(os.path.join(OUT, "signs.png")); json.dump(rects, open(os.path.join(OUT, "atlas.json"), "w"))
print("textures ok", sorted(os.listdir(OUT)))
