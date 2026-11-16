"""make_sheets.py - 12.8 comparison sheets: each model render next to its real photo (art/lake/refs/fish, art/village/refs/lake).
   python art/lake/tools/make_sheets.py <repo> <outDir> [fish ids...]   (needs fishviews/ + gearviews/ from viewer/fishsheet.mjs + gearsheet.mjs)
Fish rows: side render (near-orthographic) | the reference photo rotated + scaled + cropped to the SAME scale and side angle
(ref_normalize.py: snout + caudal base registered, total length matched) | the photo with the model's silhouette outline drawn on
it | 3/4 render. With fish ids only those rows are written (sheet_fish_part.png) and the gear sheet is skipped."""
import sys, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
repo = sys.argv[1]; out = sys.argv[2]
sys.path.insert(0, os.path.join(repo, "art/lake/tools"))
import fishspec as FS
import ref_normalize as RN
FONT = ImageFont.truetype("C:/Windows/Fonts/malgun.ttf", 20)
SMALL = ImageFont.truetype("C:/Windows/Fonts/malgun.ttf", 15)
FR = os.path.join(repo, "art/lake/refs/fish"); LR = os.path.join(repo, "art/village/refs/lake")
FV = os.path.join(repo, "art/lake/work/fishviews"); GV = os.path.join(repo, "art/lake/work/gearviews")
H = 300
PX_PER_UNIT = 600 / (2 * 30 * np.tan(np.radians(1.1)))    # side render: 1200x600, camera 30 away, fov 2.2


def fit(path, h=H, maxw=560):
    im = Image.open(path).convert("RGB")
    w = int(im.width * h / im.height)
    im = im.resize((w, h)) if w <= maxw else im.resize((maxw, int(im.height * maxw / im.width)))
    return im


def row(title, left, rights, note=""):
    imgs = [left] + rights
    W = sum(i.width for i in imgs) + 10 * (len(imgs) + 1)
    r = Image.new("RGB", (W, H + 56), "white")
    d = ImageDraw.Draw(r)
    d.text((10, 4), title, font=FONT, fill="black")
    d.text((10, 30), note, font=SMALL, fill=(90, 90, 90))
    x = 10
    for k, i in enumerate(imgs):
        r.paste(i, (x, 52 + (H - i.height) // 2)); x += i.width + 10
    return r


def stack(rows, path, cols=1):
    W = max(r.width for r in rows); Hh = sum(r.height for r in rows)
    s = Image.new("RGB", (W, Hh), "white"); y = 0
    for r in rows:
        s.paste(r, (0, y)); y += r.height
    s.save(path); print("wrote", path, s.size)


def model_mask(im):
    a = np.asarray(im.convert("RGB")).astype(int)
    bg = a[2, 2]
    return np.abs(a - bg).sum(2) > 18


def photo_matched(key, size=(1200, 600)):
    """reference photo rotated/scaled/cropped so that it overlays the side render 1:1 (same TL in px, same axis)."""
    sp = FS.SPECIES[key]; TLs = FS.tl(sp); yo = FS.yoff(sp)
    img, (ox, oy) = RN.normalized(repo, key, pad_tail=TLs - 1 + 0.25, pad_head=0.25, half_h=0.5)
    f = PX_PER_UNIT / (RN.SLPX * TLs)
    img = img.resize((int(img.width * f), int(img.height * f)), Image.LANCZOS)
    cx = (ox + RN.SLPX * (1 - TLs / 2)) * f; cy = (oy - yo * RN.SLPX) * f
    o = Image.new("RGB", size, (255, 255, 255))
    o.paste(img, (int(round(size[0] / 2 - cx)), int(round(size[1] / 2 - cy))))
    return o


def outline_on(photo, mask, color=(0, 230, 255)):
    m = Image.fromarray((mask * 255).astype(np.uint8))
    edge = np.asarray(m.filter(ImageFilter.FIND_EDGES)) > 0
    edge = np.asarray(Image.fromarray((edge * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))) > 0
    a = np.asarray(photo).copy(); a[edge] = color
    return Image.fromarray(a)


def crop_box(mask, pad=24):
    ys, xs = np.nonzero(mask)
    return (max(0, xs.min() - pad), max(0, ys.min() - pad), min(mask.shape[1], xs.max() + pad), min(mask.shape[0], ys.max() + pad))


fish = [
    ("붕어 (crucian_carp)", "crucian_carp"), ("블루길 (bluegill)", "bluegill"), ("피라미 (minnow)", "minnow"),
    ("떡붕어 (prussian_carp)", "prussian_carp"), ("배스 (bass)", "bass"), ("잉어 (carp)", "carp"),
    ("동자개 (korean_bullhead)", "korean_bullhead"), ("메기 (catfish)", "catfish"), ("향어 (mirror_carp)", "mirror_carp"),
    ("가물치 (snakehead)", "snakehead"), ("장어 (eel)", "eel"),
]
only = sys.argv[3:]
rows = []
for t, k in fish:
    if only and k not in only:
        continue
    side = Image.open(f"{FV}/{k}_side.png").convert("RGB")
    mask = model_mask(side)
    ph = photo_matched(k)
    box = crop_box(mask)
    bw = box[2] - box[0]; bh = box[3] - box[1]
    hh = max(bh, int(bw * 0.45)); cy = (box[1] + box[3]) // 2
    box = (box[0], max(0, cy - hh // 2), box[2], min(600, cy + hh // 2))
    a = side.crop(box); b = ph.crop(box); c = outline_on(ph, mask).crop(box)
    sc = H / a.height
    a, b, c = [im.resize((int(im.width * sc), H)) for im in (a, b, c)]
    if a.width > 620:
        sc2 = 620 / a.width
        a, b, c = [im.resize((620, int(im.height * sc2))) for im in (a, b, c)]
    d = fit(f"{FV}/{k}_34.png", maxw=600)
    rows.append(row(t, a, [b, c, d], "같은 크기·같은 옆 각도: 모델 옆 | 사진(회전·크기 맞춤) | 사진 위에 모델 윤곽(하늘색) | 모델 비스듬히"))
stack(rows, os.path.join(out, "sheet_fish.png" if not only else "sheet_fish_part.png"))
if only:
    sys.exit(0)

G = lambda n: Image.open(f"{GV}/{n}.png").convert("RGB")
def gfit(n, h=H):
    im = G(n); return im.resize((int(im.width * h / im.height), h))
L = lambda n: fit(f"{LR}/{n}")
rows = [
    row("낚싯대 — 접힌 길이 1.15 m (거치대 사진과)", gfit("rod_folded"), [gfit("rod_joint"), L("10_rod_rack_a.jpg"), L("10_rod_rack_b.jpg")], "7마디 텔레스코픽: 마디 끝 금색 링, 손잡이 EVA"),
    row("낚싯대 — 편 길이 3.6 m, 손에 든 모습 (앉은 낚시 사진과)", gfit("hold_rod_front"), [gfit("rod_handle"), gfit("rod_extended"), L("05_angler_rest_b.jpg")], "손잡이(쥐는 곳)와 초릿대 끝(붉은 칠 + 줄 고리)"),
    row("찌 + 케미 (찌 사진과)", gfit("float"), [gfit("float_tip"), L("08_float_a.jpg"), L("08_float_b.jpg"), L("07_night_chemi_a.jpg")], "찌톱 3색 띠(1.6배), 맨 위 케미 발광 막대"),
    row("뜰채 (뜰채 사진과)", gfit("net"), [gfit("net_hold"), L("09_landing_net_a.jpg"), L("09_landing_net_b.jpg")], "지름 50 cm 테 + 망, 손잡이 1.5 m"),
    row("들어 보이기 자세 (대물 사진과)", gfit("show_front"), [gfit("carry_rod_front"), L("11_carp_trophy_hold.jpg"), L("11_carp_closeup.jpg")], "두 손으로 가로로 받쳐 든 잉어 60 cm / 접은 대를 어깨에 멘 걷기"),
]
stack(rows, os.path.join(out, "sheet_gear.png"))
