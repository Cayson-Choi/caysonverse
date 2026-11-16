# make_badge.py — 마을 안내원 목걸이 명찰 앞면 그림(“안내원”). python docs/designs/npc/make_badge.py <out.png>
import sys
from PIL import Image, ImageDraw, ImageFont
W, H = 256, 180
im = Image.new("RGB", (W, H), (250, 250, 246))
d = ImageDraw.Draw(im)
d.rectangle([0, 0, W, 48], fill=(217, 38, 46))
fb = "C:/Windows/Fonts/malgunbd.ttf"
d.ellipse([10, 6, 46, 42], fill=(255, 255, 255))
d.rectangle([25, 20, 31, 36], fill=(217, 38, 46)); d.ellipse([24, 10, 32, 18], fill=(217, 38, 46))
f1 = ImageFont.truetype(fb, 24)
d.text((56, 9), "케이슨 마을", font=f1, fill=(255, 255, 255))
f2 = ImageFont.truetype(fb, 62)
tw = d.textlength("안내원", font=f2)
d.text(((W - tw) / 2, 64), "안내원", font=f2, fill=(34, 38, 60))
d.rectangle([0, H - 10, W, H], fill=(75, 79, 216))
im.save(sys.argv[1], optimize=True)
