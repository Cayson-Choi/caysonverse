"""Textures for build_busstop.py (system Python: PIL + numpy). Our own lettering only (Jua, SIL OFL), no real route,
company or brand:
  T_stop_map.png    512x768  the route light box on the shelter's back wall: "마을버스 1004", a ring-road diagram with the
                             stop marked, "10분마다 출발 · 한 바퀴 3분"
  T_stop_bis.png    512x256  the arrival display on the roof fascia (amber dots on black): "1004 10분마다"
  T_stop_sign.png   256x512  the stop sign: blue disc with a bus pictogram over a blue plate "케이슨 마을" / "1004"
  T_pad.png         512x512  the waiting pad's pavers (tileable, 0.4 m per paver, 2 m per repeat)
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "work", "tex_busstop")
JUA = os.path.join(ROOT, "fonts", "Jua-Regular.ttf")
os.makedirs(OUT, exist_ok=True)
F = lambda n: ImageFont.truetype(JUA, n)
BLUE = (21, 96, 178)
WHITE = (246, 249, 252)


def center_text(d, xy, text, font, fill):
    d.text(xy, text, font=font, fill=fill, anchor="mm")


# --- route light box ----------------------------------------------------------------------------------------------
im = Image.new("RGB", (512, 768), (244, 247, 250))
d = ImageDraw.Draw(im)
d.rectangle((0, 0, 511, 150), fill=BLUE)
center_text(d, (256, 52), "마을버스", F(64), WHITE)
center_text(d, (256, 112), "1004", F(70), (255, 214, 64))
# the ring road with the stop marked
cx, cy, r = 256, 380, 150
d.ellipse((cx - r - 22, cy - r - 22, cx + r + 22, cy + r + 22), fill=(222, 228, 236))
d.ellipse((cx - r + 22, cy - r + 22, cx + r - 22, cy + r - 22), fill=(244, 247, 250))
d.arc((cx - r, cy - r, cx + r, cy + r), 0, 360, fill=BLUE, width=10)
d.ellipse((cx - 28, cy - 28, cx + 28, cy + 28), fill=(160, 200, 235))  # the fountain
for ang in range(0, 360, 90):  # the lanes
    a = np.deg2rad(ang)
    d.line((cx + (r + 22) * np.cos(a), cy + (r + 22) * np.sin(a), cx + (r + 70) * np.cos(a), cy + (r + 70) * np.sin(a)), fill=(150, 160, 172), width=8)
sx, sy = cx + r * np.cos(np.deg2rad(-9.5)), cy + r * np.sin(np.deg2rad(-9.5))
d.ellipse((sx - 20, sy - 20, sx + 20, sy + 20), fill=(236, 80, 60), outline=WHITE, width=5)
center_text(d, (sx - 8, sy + 50), "정류장", F(34), (200, 50, 40))
center_text(d, (256, 600), "케이슨 마을 정류장", F(46), (30, 40, 56))
d.rectangle((40, 640, 472, 644), fill=BLUE)
center_text(d, (256, 690), "10분마다 출발", F(40), (60, 70, 86))
center_text(d, (256, 738), "한 바퀴 약 3분", F(34), (60, 70, 86))
im.save(os.path.join(OUT, "T_stop_map.png"))

# --- arrival display (dot matrix) ---------------------------------------------------------------------------------
base = Image.new("L", (128, 64), 0)
bd = ImageDraw.Draw(base)
bd.text((64, 18), "1004", font=F(30), fill=255, anchor="mm")
bd.text((64, 46), "10분마다", font=F(22), fill=255, anchor="mm")
a = np.asarray(base, np.float32) / 255
big = np.zeros((256, 512, 3), np.float32)
for y in range(64):
    for x in range(128):
        v = a[y, x]
        cxp, cyp = x * 4 + 2, y * 4 + 2
        yy, xx = np.ogrid[cyp - 2:cyp + 2, cxp - 2:cxp + 2]
        col = np.array([1.0, 0.62, 0.12]) * (0.12 + 0.88 * v)
        big[cyp - 2:cyp + 2, cxp - 2:cxp + 2] = col
Image.fromarray((np.clip(big, 0, 1) * 255).astype(np.uint8)).save(os.path.join(OUT, "T_stop_bis.png"))

# --- stop sign (one blue plate: ring with a bus pictogram over the name and number) -------------------------------
sg = Image.new("RGB", (256, 512), BLUE)
d = ImageDraw.Draw(sg)
d.rounded_rectangle((4, 4, 251, 507), 18, outline=WHITE, width=6)
d.ellipse((30, 30, 226, 226), outline=WHITE, width=8)
d.rounded_rectangle((62, 78, 194, 168), 14, fill=WHITE)
d.rectangle((70, 90, 186, 126), fill=BLUE)
d.line((128, 90, 128, 126), fill=WHITE, width=5)
d.rectangle((70, 136, 186, 143), fill=BLUE)
for wx in (86, 170):
    d.ellipse((wx - 13, 158, wx + 13, 184), fill=WHITE, outline=BLUE, width=5)
center_text(d, (128, 290), "케이슨 마을", F(42), WHITE)
d.rectangle((40, 334, 216, 338), fill=WHITE)
center_text(d, (128, 420), "1004", F(84), (255, 214, 64))
sg.save(os.path.join(OUT, "T_stop_sign.png"))

# --- pavers -------------------------------------------------------------------------------------------------------
rng = np.random.default_rng(11)
N = 512
pv = np.zeros((N, N, 3), np.float32)
cell = N // 5  # 5 pavers per 2 m: 0.4 m
for j in range(5):
    for i in range(5):
        tone = 0.60 + 0.06 * rng.random()
        pv[j * cell:(j + 1) * cell, i * cell:(i + 1) * cell] = np.array([tone * 0.96, tone * 0.98, tone * 1.0])
noise = rng.normal(0, 0.018, (N, N, 1))
pv = np.clip(pv + noise, 0, 1)
for k in range(5):
    pv[k * cell:k * cell + 3, :] *= 0.72
    pv[:, k * cell:k * cell + 3] *= 0.72
Image.fromarray((pv * 255).astype(np.uint8)).save(os.path.join(OUT, "T_pad.png"))
print("wrote", OUT)
