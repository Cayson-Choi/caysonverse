"""케이슨랜드 안내도: the guide map posted at the gate, composed from photos of the REAL park (e2e/probes/park-map-capture.mjs).

  python tools/park-guide-map.py <capture dir> <out dir> [--fonts <dir with Jua-Regular.ttf>]

Writes park_guide_map.webp (2048 x 1152), park_guide_map_1k.webp (1024 x 576, the phone's) and a PNG proof beside the capture.

What is drawn, and from what:
  - the ground, paths, plaza, shops, coaster, trees and the castle wall: the capture's base tiles (an orthographic bird's-eye view from the
    gate's side), joined by their true coordinates and toned like a printed illustration;
  - the four other rides, the gate and the star fountain: their own close-up photos, cut out and set down LARGER than life at their true
    places (a guide map's landmarks are icons: a carousel at true scale would be a dot);
  - numbered badges, the legend with the rides' in-game names, the title, the compass (the game's north is -z: the gate's side, so north
    is DOWN on a map read from the gate), a scale bar and the "현재 위치" pin at the gate.
Everything is placed by the park's own coordinates (shared/src/village/parkArea.ts): RIDES below repeats the sites' numbers.
"""
import json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageChops

cap_dir, out_dir = sys.argv[1], sys.argv[2]
font_dir = sys.argv[sys.argv.index("--fonts") + 1] if "--fonts" in sys.argv else "D:/ClaudeCode/caysonverse/art/village/fonts"
meta = json.load(open(os.path.join(cap_dir, "capture.json")))
PH = math.radians(meta["pitchDeg"])
S, C = math.sin(PH), math.cos(PH)
FR = meta["frame"]

W, H = 2048, 1152
SS = 2  # everything is drawn at twice the size and reduced: clean edges on the lettering and the badges
MAP = (36, 150, W - 36, 150 + 0)  # left, top, right; the bottom follows from the frame's shape
sx0, sx1 = -FR["x1"], -FR["x0"]
sy0, sy1 = FR["z0"] * S, FR["syTop"]
K = (MAP[2] - MAP[0]) / (sx1 - sx0)  # pixels per metre
MAP = (MAP[0], MAP[1], MAP[2], MAP[1] + round((sy1 - sy0) * K))
LEG = (36, MAP[3] + 14, W - 36, H - 30)

JUA = os.path.join(font_dir, "Jua-Regular.ttf")
NOTO = "C:/Windows/Fonts/NotoSansKR-VF.ttf"
def jua(px): return ImageFont.truetype(JUA, int(px * SS))
def noto(px, weight="Bold"):
    f = ImageFont.truetype(NOTO, int(px * SS))
    try: f.set_variation_by_name(weight)
    except Exception: pass
    return f

INK = (38, 44, 92)
PAPER = (246, 238, 220)
GOLD = (214, 168, 62)
# the rides: key (the capture's), number, name (the game's), kind, the badge's colour, the site (x, z), how much larger than life, where the label sits
RIDES = [
    ("coaster", 1, "별똥별 급행", "롤러코스터", (217, 100, 63), (95, 24), None, (0, -1)),
    ("wheel", 2, "하늘 등불 바퀴", "대관람차", (47, 123, 234), (205, -137), 1.3, (0, 1)),
    ("carousel", 3, "달빛 회전목마", "회전목마", (224, 92, 154), (110, -135), 1.75, (0, 1)),
    ("droptower", 4, "구름 낙하탑", "드롭 타워", (139, 92, 246), (-73, -88), 1.0, (0, 1)),
    ("moonboat", 5, "달배", "바이킹", (14, 159, 142), (-90, -146), 1.9, (0, 1)),
]
EXTRAS = [("gate", (40, -186.5), 1.5), ("fountain", (40, -112), 2.2)]

def to_px(x, z, y=0.0):
    """Park metres -> the poster's pixel (the capture's projection)."""
    return MAP[0] + (-x - sx0) * K, MAP[3] - (z * S + y * C - sy0) * K

def key_alpha(im):
    """RGBA from a photo on the capture's magenta."""
    a = np.asarray(im.convert("RGB"), dtype=np.float32)
    key = a[2:10, 2:10].reshape(-1, 3).mean(0)
    d = np.sqrt(((a - key) ** 2).sum(-1))
    al = np.clip((d - 26.0) / 36.0, 0, 1)
    # the magenta that tints the half-covered edge pixels: pull it toward grey
    sp = (1 - al)[..., None]
    a = a * (1 - sp * 0.7) + a.mean(-1, keepdims=True) * sp * 0.7
    # see-through whites (the drop tower's cloud) come out pink over the key: bright magenta-leaning pixels go back to white-grey
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    pink = (np.minimum(r, b) > 150) & (np.minimum(r, b) - g > 18)
    lift = np.where(pink, np.minimum(r, b) * 0.96, g)
    a = np.dstack([np.where(pink, lift, r), lift, np.where(pink, lift, b)])
    return Image.fromarray(np.dstack([a, al * 255]).astype(np.uint8), "RGBA")

# ── the base: the tiles joined at the capture's own scale, then reduced into the map window ──
mpp = meta["base"][0]["mPerPx"]
bw, bh = round((sx1 - sx0) / mpp), round((sy1 - sy0) / mpp)
base = Image.new("RGB", (bw, bh), PAPER)
for t in meta["base"]:
    im = Image.open(os.path.join(cap_dir, t["file"])).convert("RGB")
    x = round((t["sx"] - t["halfW"] - sx0) / mpp)
    y = round((sy1 - (t["sy"] + t["halfH"])) / mpp)
    base.paste(im, (x, y))
mw, mh = (MAP[2] - MAP[0]) * SS, (MAP[3] - MAP[1]) * SS
base = base.resize((mw, mh), Image.LANCZOS)
# toned like a printed illustration: a touch brighter and richer, the finest photo grain smoothed, a soft dark line where colours meet
arr = np.asarray(base, dtype=np.float32) / 255
grey = arr.mean(-1, keepdims=True)
arr = np.clip((grey + (arr - grey) * 1.22) * 1.06 + 0.02, 0, 1)
base = Image.fromarray((arr * 255).astype(np.uint8)).filter(ImageFilter.MedianFilter(3))
edges = base.convert("L").filter(ImageFilter.FIND_EDGES).filter(ImageFilter.GaussianBlur(0.8))
ink = Image.new("RGB", base.size, (40, 48, 60))
base = Image.composite(ink, base, edges.point(lambda v: min(110, int(v * 1.1))))

poster = Image.new("RGB", (W * SS, H * SS), PAPER)
d = ImageDraw.Draw(poster, "RGBA")
# paper: a faint warm vignette
vg = Image.new("L", (W * SS, H * SS), 0)
ImageDraw.Draw(vg).rectangle((60, 60, W * SS - 60, H * SS - 60), fill=255)
vg = vg.filter(ImageFilter.GaussianBlur(120))
poster = Image.composite(poster, Image.new("RGB", poster.size, (232, 220, 196)), vg)
d = ImageDraw.Draw(poster, "RGBA")
def R(box): return tuple(int(v * SS) for v in box)
mask = Image.new("L", (mw, mh), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, mw - 1, mh - 1), radius=22 * SS, fill=255)
poster.paste(base, (MAP[0] * SS, MAP[1] * SS), mask)

# ── the cut-outs, the far ones first ──
def cutout(key, site, ex):
    r = meta["rides"][key]
    im = key_alpha(Image.open(os.path.join(cap_dir, r["file"])))
    w, h = im.size
    # the site's ground point in the photo
    ax = (-site[0] - r["sx"]) / r["mPerPx"] + w / 2
    ay = h / 2 - (site[1] * S - r["sy"]) / r["mPerPx"]
    bb = im.getchannel("A").point(lambda v: 255 if v > 40 else 0).getbbox()
    im = im.crop(bb)
    ax, ay = ax - bb[0], ay - bb[1]
    sc = ex * K * SS * r["mPerPx"]
    im = im.resize((max(1, round(im.width * sc)), max(1, round(im.height * sc))), Image.LANCZOS)
    return im, ax * sc, ay * sc

items = [(k, site, ex) for k, _, _, _, _, site, ex, _ in RIDES if ex] + EXTRAS
for key, site, ex in sorted(items, key=lambda it: -it[1][1]):
    im, ax, ay = cutout(key, site, ex)
    px, py = to_px(*site)
    ox, oy = round(px * SS - ax), round(py * SS - ay)
    al = im.getchannel("A")
    pad = 14 * SS
    big = Image.new("L", (im.width + 2 * pad, im.height + 2 * pad), 0)
    big.paste(al, (pad, pad))
    # a soft shadow on the ground, then a pale halo round the cut-out (a sticker's edge), then the cut-out
    sh = big.filter(ImageFilter.GaussianBlur(7 * SS)).point(lambda v: int(v * 0.45))
    poster.paste((30, 44, 38), (ox - pad + 5 * SS, oy - pad + 8 * SS), sh)
    halo = big.filter(ImageFilter.MaxFilter(2 * SS + 1)).filter(ImageFilter.GaussianBlur(1.2))
    poster.paste((255, 250, 236), (ox - pad, oy - pad), halo)
    poster.paste(im, (ox, oy), im)
d = ImageDraw.Draw(poster, "RGBA")
d.rounded_rectangle(R((MAP[0], MAP[1], MAP[2], MAP[3])), radius=22 * SS, outline=(74, 96, 70), width=3 * SS)

def text_c(xy, s, font, fill, stroke=None, sw=0):
    d.text((xy[0] * SS, xy[1] * SS), s, font=font, fill=fill, anchor="mm", stroke_width=sw * SS, stroke_fill=stroke)

def badge(x, y, n, col, r=21):
    d.ellipse(R((x - r - 4, y - r - 4, x + r + 4, y + r + 4)), fill=(255, 255, 255))
    d.ellipse(R((x - r, y - r, x + r, y + r)), fill=col)
    text_c((x, y + 1), str(n), jua(r * 1.35), (255, 255, 255))

def pill(cx, cy, s, font_px, fg=INK, bg=(255, 252, 242), pad=(13, 7)):
    f = jua(font_px)
    w = d.textlength(s, font=f) / SS
    box = (cx - w / 2 - pad[0], cy - font_px / 2 - pad[1], cx + w / 2 + pad[0], cy + font_px / 2 + pad[1])
    d.rounded_rectangle(R((box[0] + 2, box[1] + 3, box[2] + 2, box[3] + 3)), radius=int((font_px / 2 + pad[1]) * SS), fill=(20, 30, 40, 70))
    d.rounded_rectangle(R(box), radius=int((font_px / 2 + pad[1]) * SS), fill=bg, outline=(*INK, 150), width=SS)
    text_c((cx, cy), s, f, fg)
    return box

# ── the rides' badges and names ──
LABEL_AT = {"coaster": (150, 30, 0), "wheel": (205, -137, 60), "carousel": (110, -135, 13), "droptower": (-73, -88, 104), "moonboat": (-90, -146, 30)}
for key, n, name, kind, col, site, ex, _ in RIDES:
    lx, lz, ly = LABEL_AT[key]
    # over the cut-out's top (its own height, larger than life)
    px, py = to_px(site[0], site[1])
    tx, ty = to_px(lx, lz, ly)
    top = py - (py - ty) * (ex or 1.0) - 26
    if key == "coaster": px, top = tx, ty - 20
    if key == "moonboat": top = py + 30  # under the hull: over it stands the drop tower's foot
    top = max(MAP[1] + 30, top)
    f = jua(25)
    w = d.textlength(name, font=f) / SS
    cx = min(max(px, MAP[0] + w / 2 + 52), MAP[2] - w / 2 - 30)
    pill(cx + 20, top, name, 25)
    badge(cx - w / 2 - 12, top, n, col, r=19)

# ── places ──
for (x, z, s) in [(40, -84, "별빛 분수 광장"), (40, -150, "가게 거리"), (285, -112, "큰길")]:
    px, py = to_px(x, z)
    pill(px, py, s, 19, fg=(70, 60, 40), bg=(255, 248, 226, 235), pad=(10, 5))
# 현재 위치: a red pin on the village side of the gate (the reader stands there)
gx, gy = to_px(40, -197)
gy = min(gy, MAP[3] - 30)
d.polygon([(gx * SS, (gy - 2) * SS), ((gx - 13) * SS, (gy - 34) * SS), ((gx + 13) * SS, (gy - 34) * SS)], fill=(214, 48, 49))
d.ellipse(R((gx - 17, gy - 58, gx + 17, gy - 24)), fill=(214, 48, 49), outline=(255, 255, 255), width=3 * SS)
d.ellipse(R((gx - 6, gy - 47, gx + 6, gy - 35)), fill=(255, 255, 255))
pill(gx + 96, gy - 40, "현재 위치", 23, fg=(255, 255, 255), bg=(214, 48, 49), pad=(13, 6))
pill(gx - 86, gy - 40, "정문", 21, pad=(11, 5))

# ── the compass: the game's north is -z, the gate's side: DOWN on this map ──
cx, cy, cr = MAP[2] - 78, MAP[1] + 84, 46
d.ellipse(R((cx - cr - 8, cy - cr - 8, cx + cr + 8, cy + cr + 8)), fill=(255, 252, 242, 235), outline=(*INK, 180), width=2 * SS)
for ang, ln in [(0, cr), (90, cr * 0.62), (180, cr * 0.62), (270, cr * 0.62)]:
    a = math.radians(ang)
    tip = (cx + math.sin(a) * ln, cy + math.cos(a) * ln)  # ang 0 points DOWN (north)
    l = (cx + math.sin(a + math.pi / 2) * 9, cy + math.cos(a + math.pi / 2) * 9)
    r = (cx + math.sin(a - math.pi / 2) * 9, cy + math.cos(a - math.pi / 2) * 9)
    d.polygon([tuple(v * SS for v in tip), tuple(v * SS for v in l), tuple(v * SS for v in r)], fill=(214, 48, 49) if ang == 0 else INK)
d.ellipse(R((cx - 6, cy - 6, cx + 6, cy + 6)), fill=GOLD)
text_c((cx, cy + cr + 26), "북 N", jua(21), (214, 48, 49), stroke=(255, 252, 242), sw=3)
# east is on the LEFT (the map looks south from the gate)
text_c((cx - cr - 24, cy), "동", jua(17), INK, stroke=(255, 252, 242), sw=3)
text_c((cx + cr + 24, cy), "서", jua(17), INK, stroke=(255, 252, 242), sw=3)
text_c((cx, cy - cr - 20), "남", jua(17), INK, stroke=(255, 252, 242), sw=3)
# the scale bar: 50 m
bx, by = MAP[0] + 34, MAP[3] - 34
d.rectangle(R((bx, by, bx + 50 * K, by + 7)), fill=INK)
d.rectangle(R((bx + 25 * K, by + 1.5, bx + 50 * K - 1.5, by + 5.5)), fill=(255, 252, 242))
text_c((bx + 25 * K, by - 14), "50 m", noto(16), INK, stroke=(255, 252, 242), sw=3)

# ── the title ──
ty = (MAP[1]) / 2 + 6
d.rounded_rectangle(R((MAP[0], 26, MAP[2], MAP[1] - 16)), radius=20 * SS, fill=(39, 53, 143))
d.rounded_rectangle(R((MAP[0] + 7, 33, MAP[2] - 7, MAP[1] - 23)), radius=15 * SS, outline=GOLD, width=2 * SS)
def star(x, y, r, col=GOLD):
    pts = []
    for i in range(10):
        rr = r if i % 2 == 0 else r * 0.42
        a = -math.pi / 2 + i * math.pi / 5
        pts.append(((x + math.cos(a) * rr) * SS, (y + math.sin(a) * rr) * SS))
    d.polygon(pts, fill=col)
title = "케이슨랜드 안내도"
tf = jua(70)
tw = d.textlength(title, font=tf) / SS
text_c((W / 2, ty - 2), title, tf, (250, 244, 228))
star(W / 2 - tw / 2 - 52, ty - 2, 26)
star(W / 2 + tw / 2 + 52, ty - 2, 26)
text_c((MAP[0] + 170, ty), "CAYSONLAND", noto(24), (240, 196, 96))
text_c((MAP[2] - 170, ty), "GUIDE MAP", noto(24), (240, 196, 96))

# ── the legend ──
d.rounded_rectangle(R(LEG), radius=18 * SS, fill=(255, 251, 240), outline=(*INK, 120), width=2 * SS)
n = len(RIDES)
cell = (LEG[2] - LEG[0] - 250 - 250) / n
ly = (LEG[1] + LEG[3]) / 2
text_c((LEG[0] + 86, ly - 16), "놀이기구", jua(30), INK)
text_c((LEG[0] + 86, ly + 22), "번호를 찾아가요", noto(15, "Medium"), (96, 98, 130))
d.line(R((LEG[0] + 170, LEG[1] + 22, LEG[0] + 170, LEG[3] - 22)), fill=(*INK, 90), width=2 * SS)
for i, (key, num, name, kind, col, *_r) in enumerate(RIDES):
    x = LEG[0] + 200 + cell * i
    badge(x + 26, ly, num, col, r=24)
    d.text(((x + 62) * SS, (ly - 15) * SS), name, font=jua(29), fill=INK, anchor="lm")
    d.text(((x + 63) * SS, (ly + 21) * SS), kind, font=noto(16, "Medium"), fill=(96, 98, 130), anchor="lm")

# the legend's last cell: the pin
qx = LEG[2] - 250
d.line(R((qx, LEG[1] + 22, qx, LEG[3] - 22)), fill=(*INK, 90), width=2 * SS)
px_, py_ = qx + 46, ly + 20
d.polygon([(px_ * SS, (py_ - 2) * SS), ((px_ - 12) * SS, (py_ - 32) * SS), ((px_ + 12) * SS, (py_ - 32) * SS)], fill=(214, 48, 49))
d.ellipse(R((px_ - 16, py_ - 54, px_ + 16, py_ - 22)), fill=(214, 48, 49), outline=(255, 255, 255), width=3 * SS)
d.ellipse(R((px_ - 6, py_ - 44, px_ + 6, py_ - 32)), fill=(255, 255, 255))
d.text(((qx + 78) * SS, (ly - 15) * SS), "현재 위치", font=jua(29), fill=(214, 48, 49), anchor="lm")
d.text(((qx + 79) * SS, (ly + 21) * SS), "정문 · 마을 쪽", font=noto(16, "Medium"), fill=(96, 98, 130), anchor="lm")

poster = poster.resize((W, H), Image.LANCZOS)
os.makedirs(out_dir, exist_ok=True)
poster.save(os.path.join(out_dir, "park_guide_map.webp"), quality=90, method=6)
poster.resize((W // 2, H // 2), Image.LANCZOS).save(os.path.join(out_dir, "park_guide_map_1k.webp"), quality=88, method=6)
poster.save(os.path.join(cap_dir, "park_guide_map_proof.png"))
print("map window", MAP, "px per m %.3f" % K, "legend", LEG)
for f in ("park_guide_map.webp", "park_guide_map_1k.webp"):
    print(f, os.path.getsize(os.path.join(out_dir, f)) // 1024, "KB")
