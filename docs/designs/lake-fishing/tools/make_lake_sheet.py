"""12.8 comparison sheet for the facilities: real photo (art/village/refs/lake) next to our render, per row.
python make_lake_sheet.py <renders dir> <refs dir> <out.jpg>"""
import sys
from PIL import Image, ImageDraw, ImageFont
rd, refs, out = sys.argv[1:4]
village_refs = refs + "/.."
PAIRS = [
    ("좌대 (수상 방갈로)", refs + "/02_jwadae_a.jpg", None, "jwadae_a"),
    ("좌대 방갈로 · 통나무 벽 · 주황 지붕", refs + "/03_pier_a.jpg", None, "jwadae_a_close"),
    ("좌대 난간 · 구명환 · 부력통", refs + "/02_jwadae_c.jpg", None, "pier_walk"),
    ("잔교 (방부목 데크 · 낚시 자리)", refs + "/03_pier_b.jpg", None, "pier_side"),
    ("관리소 · 대여점", refs + "/04_office_d.jpg", None, "office"),
    ("관리소 창구 안쪽 (진짜 형상)", refs + "/10_rod_rack_a.jpg", None, "office_window"),
    ("낚싯대 거치대 · 자판기 · 수거함", refs + "/10_rod_rack_b.jpg", None, "props"),
    ("정자", village_refs + "/stream_bridge_pavilion.jpg", (676, 720, 982, 968), "pavilion"),
    ("낚시의자 + 받침틀 (T자 끝)", refs + "/03_pier_covered_booths.jpg", None, "pier_t"),
]
W, H = 760, 475
font = ImageFont.truetype("C:/Windows/Fonts/malgun.ttf", 22)
sheet = Image.new("RGB", (W * 2 + 30, (H + 44) * len(PAIRS) + 10), (243, 239, 234))
d = ImageDraw.Draw(sheet)
for i, (title, photo, crop, name) in enumerate(PAIRS):
    y = 10 + i * (H + 44)
    d.text((14, y + 6), f"{title}   [왼쪽: 실제 사진 / 오른쪽: 우리 모델 ({name})]", fill=(40, 40, 60), font=font)
    p = Image.open(photo).convert("RGB")
    if crop: p = p.crop(crop)
    p.thumbnail((W, H)); sheet.paste(p, (10 + (W - p.width) // 2, y + 40 + (H - p.height) // 2))
    r = Image.open(f"{rd}/{name}.png").convert("RGB"); r.thumbnail((W, H)); sheet.paste(r, (W + 20, y + 40))
sheet.save(out, quality=88)
print("sheet", out, sheet.size)
