"""Side-by-side sheets for the shop interior: game / preview render | real reference photo (art/shop/refs, not committed).

  python docs/designs/lake-fishing/tools/make_shop_sheet.py [--out art/shop/sheets]"""
import argparse
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
ap = argparse.ArgumentParser()
ap.add_argument("--out", default=os.path.join(REPO, "art", "shop", "sheets"))
A = ap.parse_args()
os.makedirs(A.out, exist_ok=True)
S = os.path.join(REPO, "art", "shop")
F = ImageFont.truetype(os.path.join(os.environ.get("WINDIR", "C:/Windows"), "Fonts", "malgunbd.ttf"), 22)
PAIRS = [  # (name, left image, crop box or None, ref, caption)
    ("01_window_day", "shots/pc-12-05-fp-window.png", (0, 60, 1280, 400), "refs/ref09.jpg", "창구 안 (게임, 낮, 1인칭) | 실제 낚시점 낚싯대 진열"),
    ("02_window_night", "shots/pc-21-05-fp-window.png", (0, 60, 1280, 400), "refs/ref02.jpg", "창구 안 (게임, 밤) | 실제 낚시점 진열 벽"),
    ("03_pad_view", "shots/pc-12-02-window.png", (380, 180, 980, 520), "refs/ref01.jpg", "대여 창구 (게임, 3인칭) | 실제 낚시점 매장"),
    ("04_pegboard", "preview/pegboard.png", None, "refs/ref03.jpg", "타공판 루어·웜 (렌더) | 실제 루어 진열"),
    ("05_rods", "preview/rods.png", None, "refs/ref09.jpg", "낚싯대 거치대·가방 (렌더) | 실제 낚싯대·태클박스 진열"),
    ("06_bait_fridge", "preview/fridge.png", None, "refs/ref08.jpg", "떡밥 선반·미끼 냉장고 (렌더) | 실제 미끼 냉장고"),
    ("07_counter", "preview/east.png", None, "refs/ref05.jpg", "카운터·동쪽 벽 (렌더) | 실제 카운터 주변"),
    ("08_floor_gear", "preview/west.png", None, "refs/ref06.jpg", "서쪽 벽·떡밥 상자 (렌더) | 실제 떡밥 바구니 진열"),
    ("10_pad_day", "shots/pc-12-01-pad.png", (330, 150, 1010, 560), "refs/ref03.jpg", "노란 원에서 3인칭 (게임, 낮) | 실제 루어 벽"),
    ("11_pad_night", "shots/pc-21-01-pad.png", (330, 150, 1010, 560), "refs/ref06.jpg", "노란 원에서 3인칭 (게임, 밤) | 실제 떡밥 바구니"),
    ("09_phone", "shots/phone-12-02-window.png", None, "refs/ref04.jpg", "폰 375x812 (게임) | 실제 찌 진열"),
]
H = 520
for name, left, box, ref, cap in PAIRS:
    lp, rp = os.path.join(S, left), os.path.join(S, ref)
    if not (os.path.exists(lp) and os.path.exists(rp)):
        print("skip", name)
        continue
    a = Image.open(lp).convert("RGB")
    if box:
        a = a.crop(box)
    b = Image.open(rp).convert("RGB")
    a = a.resize((int(a.width * H / a.height), H), Image.LANCZOS)
    b = b.resize((int(b.width * H / b.height), H), Image.LANCZOS)
    sheet = Image.new("RGB", (a.width + b.width + 12, H + 44), (24, 24, 28))
    sheet.paste(a, (0, 44))
    sheet.paste(b, (a.width + 12, 44))
    ImageDraw.Draw(sheet).text((10, 8), cap, font=F, fill=(240, 240, 240))
    sheet.save(os.path.join(A.out, f"{name}.jpg"), quality=86)
    print("sheet", name)
