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
    ("12_yongchu_hamyang.jpg", "참고 12 용추폭포(함양): 판상 화강암, 턱마다 초록, 양옆 울창한 활엽수 숲", "day_photo12.png",
     "W1 4차 낮 — 실측 스캔 바위(CC0)로 쌓은 절벽, 쉼터 눈높이(1.7 m) (물·거품은 W2 자리 표시)"),
    ("05_jikso_byeonsan_a.jpg", "참고 05 직소폭포(변산): 큰 세로 절리 기둥, 물 뒤 젖은 어두운 면, 숲", "day_photo05.png",
     "W1 4차 낮 — 소 가장자리 낮은 눈높이에서 떨어지는 곳 쪽으로"),
], "B1 폭포 W1 4차 바위·초목 — 실제 사진과 같은 구도 (낮)")
sheet("w1-compare-day-2.jpg", [
    ("04_guryong_jiri.jpg", "참고 04 구룡폭포(지리산): 둥근 화강암, 소 가장자리 바위", "day_bank.png", "W1 4차 낮 — 자갈 기슭·둥근 바위·풀"),
    ("09_sambuyeon_a.jpg", "참고 09 삼부연폭포(철원): 절리 벽, 틈의 식물", "day_cliff_mid.png", "W1 4차 낮 — 남쪽 벽: 스캔 화강암 덩어리, 틈의 풀·덤불"),
], "B1 폭포 W1 4차 바위·초목 — 가까이 (낮)")
if os.path.exists(os.path.join(RDIR, "night_photo12.png")):
    sheet("w1-compare-night.jpg", [
        ("12_yongchu_hamyang.jpg", "참고 12 (낮 사진만 있음: 구도 참고용)", "night_photo12.png", "W1 4차 밤 — 쉼터 눈높이, 따뜻한 바닥 등 2개 (자리 표시 조명)"),
        ("04_guryong_jiri.jpg", "참고 04", "night_s8_front_slab.png", "W1 4차 밤 — 앞 너럭바위(S8)"),
    ], "B1 폭포 W1 4차 — 밤 (라이트맵은 W3)")
