"""make_sheets.py - 12.8 comparison sheets: each model render next to its real photo (art/lake/refs/fish, art/village/refs/lake).
   python art/lake/tools/make_sheets.py <repo> <outDir>   (needs fishviews/ + gearviews/ from viewer/fishsheet.mjs + gearsheet.mjs)"""
import sys, os
from PIL import Image, ImageDraw, ImageFont
repo = sys.argv[1]; out = sys.argv[2]
FONT = ImageFont.truetype("C:/Windows/Fonts/malgun.ttf", 20)
SMALL = ImageFont.truetype("C:/Windows/Fonts/malgun.ttf", 15)
FR = os.path.join(repo, "art/lake/refs/fish"); LR = os.path.join(repo, "art/village/refs/lake")
FV = os.path.join(repo, "art/lake/work/fishviews"); GV = os.path.join(repo, "art/lake/work/gearviews")
H = 300

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
    d.text((10 + 2, 52 + H - 20), "모델", font=SMALL, fill=(255, 255, 255))
    return r

def stack(rows, path, cols=1):
    if cols == 1:
        W = max(r.width for r in rows); Hh = sum(r.height for r in rows)
        s = Image.new("RGB", (W, Hh), "white"); y = 0
        for r in rows:
            s.paste(r, (0, y)); y += r.height
    s.save(path); print("wrote", path, s.size)

fish = [
    ("붕어 (crucian_carp)", "crucian_carp", ["01_crucian_a.jpg", "01_crucian_b.jpg"]),
    ("블루길 (bluegill)", "bluegill", ["02_bluegill_a.jpg"]),
    ("피라미 (minnow)", "minnow", ["03_zacco_a.jpg"]),
    ("떡붕어 (prussian_carp)", "prussian_carp", ["04_cuvieri_a.jpg"]),
    ("배스 (bass)", "bass", ["05_bass_a.jpg"]),
    ("잉어 (carp)", "carp", ["06_carp_a.jpg"]),
    ("동자개 (korean_bullhead)", "korean_bullhead", ["07_yellowcatfish_a.jpg"]),
    ("메기 (catfish)", "catfish", ["08_catfish_a.jpg"]),
    ("향어 (mirror_carp)", "mirror_carp", ["09_mirror_a.jpg"]),
    ("가물치 (snakehead)", "snakehead", ["10_snakehead_a.jpg"]),
    ("장어 (eel)", "eel", ["11_eel_a.jpg"]),
]
rows = []
for t, k, refs in fish:
    left = Image.open(f"{FV}/{k}_side.png").convert("RGB").resize((600, 300))
    left2 = Image.open(f"{FV}/{k}_34.png").convert("RGB").resize((600, 300))
    rows.append(row(t, left, [left2] + [fit(f"{FR}/{r}") for r in refs], "왼쪽 둘: 우리 모델(옆·비스듬히), 오른쪽: 실제 사진 (art/lake/refs/fish)"))
stack(rows, f"{out}/sheet_fish.png")

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
stack(rows, f"{out}/sheet_gear.png")
