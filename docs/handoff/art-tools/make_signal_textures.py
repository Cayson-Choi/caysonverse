"""Textures for build_signals.py (system Python: PIL). Our own lettering only (Jua, SIL OFL):
  T_sig_plate.png   512x192  blue plate over the pedestrian head, white text "보행자 신호기" (like the blue plate of the
                             standard pedestrian-actuated signal, no real wording of any authority)
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "work", "tex_signals")
FONT = os.path.join(ROOT, "fonts", "Jua-Regular.ttf")
os.makedirs(OUT, exist_ok=True)

im = Image.new("RGB", (512, 192), (21, 88, 176))
d = ImageDraw.Draw(im)
d.rounded_rectangle((6, 6, 505, 185), 14, outline=(238, 244, 250), width=5)
f = ImageFont.truetype(FONT, 92)
t = "보행자 신호기"
w = d.textlength(t, font=f)
d.text(((512 - w) / 2, 96), t, font=f, fill=(255, 255, 255), anchor="lm")
im.save(os.path.join(OUT, "T_sig_plate.png"))
print("wrote", OUT)
