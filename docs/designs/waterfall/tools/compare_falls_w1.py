"""W1 side-by-side sheets: real reference photo (left) next to the same framing in our render (right).

  python compare_falls_w1.py [RENDER_DIR] [OUT_DIR]      (system python with PIL)

Photos live in art/village/refs/waterfall/ (git-ignored, study only; sources in SOURCES.md there).
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REFS = os.path.join(ROOT, "refs", "waterfall")
RDIR = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "work", "falls_w1_render_cycles")
OUT = sys.argv[2] if len(sys.argv) > 2 else RDIR
os.makedirs(OUT, exist_ok=True)
FONT = ImageFont.truetype("C:/Windows/Fonts/malgun.ttf", 22)
SMALL = ImageFont.truetype("C:/Windows/Fonts/malgun.ttf", 16)
H = 640


def fit(im, h=H):
    return im.resize((int(im.width * h / im.height), h), Image.LANCZOS)


def sheet(name, pairs, title):
    """pairs: [(ref file, ref label, render file, render label)]"""
    rows = []
    for rf, rl, gf, gl in pairs:
        a = fit(Image.open(os.path.join(REFS, rf)).convert("RGB"))
        b = fit(Image.open(os.path.join(RDIR, gf)).convert("RGB"))
        row = Image.new("RGB", (a.width + b.width + 30, H + 40), (24, 24, 28))
        row.paste(a, (10, 36))
        row.paste(b, (a.width + 20, 36))
        d = ImageDraw.Draw(row)
        d.text((12, 6), rl, font=SMALL, fill=(230, 230, 230))
        d.text((a.width + 22, 6), gl, font=SMALL, fill=(255, 210, 140))
        rows.append(row)
    w = max(r.width for r in rows)
    sh = Image.new("RGB", (w, 44 + sum(r.height for r in rows)), (24, 24, 28))
    ImageDraw.Draw(sh).text((12, 8), title, font=FONT, fill=(255, 255, 255))
    y = 44
    for r in rows:
        sh.paste(r, (0, y))
        y += r.height
    sh.save(os.path.join(OUT, name), quality=90)
    print("wrote", os.path.join(OUT, name))


sheet("w1-compare-day-1.jpg", [
    ("12_yongchu_hamyang.jpg", "참고 12 용추폭포(함양): 이끼 낀 회색 턱 절벽, 홈 속 물줄기, 둥근 자갈 기슭", "day_photo12.png", "W1 낮 — 쉼터 눈높이에서 본 전체 (물·아바타는 자리 표시)"),
    ("05_jikso_byeonsan_a.jpg", "참고 05 직소폭포(변산): 세로로 갈라진 어두운 벽, 물 뒤 젖은 검은 면", "day_s8_front_slab.png", "W1 낮 — 앞 너럭바위(S8)에서 올려다본 모습"),
], "B1 폭포 W1 바위·땅 — 실제 사진과 나란히 (낮)")
sheet("w1-compare-day-2.jpg", [
    ("04_guryong_jiri.jpg", "참고 04 구룡폭포(지리산): 둥근 화강암 너럭바위, 소 가장자리 바위", "day_bank.png", "W1 낮 — 자갈 기슭·너럭바위·소 가장자리 바위"),
    ("09_sambuyeon_a.jpg", "참고 09 삼부연폭포(철원): 각진 턱, 숲 속 바위 절벽", "day_cliff_mid.png", "W1 낮 — 남쪽 벽: 절리 덩어리, 턱, 틈의 식물"),
], "B1 폭포 W1 바위·땅 — 실제 사진과 나란히 (낮, 가까이)")
if os.path.exists(os.path.join(RDIR, "night_s8_front_slab.png")):
    sheet("w1-compare-night.jpg", [
        ("12_yongchu_hamyang.jpg", "참고 12 (낮 사진만 있음: 밤 구도 참고용)", "night_s8_front_slab.png", "W1 밤 — 앞 너럭바위(S8), 따뜻한 등 2개 (자리 표시 조명)"),
        ("04_guryong_jiri.jpg", "참고 04", "night_s7_rest_area.png", "W1 밤 — 쉼터 가운데(S7)에서 등과 너럭바위"),
    ], "B1 폭포 W1 — 밤 (등 2개는 자리 표시, 라이트맵은 W3)")
