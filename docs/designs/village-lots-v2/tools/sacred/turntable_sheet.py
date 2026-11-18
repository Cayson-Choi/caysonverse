"""The owner's six-view reference (front, left side, back, right side, top, bottom) above the same six views of the game asset.
    python turntable_sheet.py <ref.png> <render_prefix> <out.jpg>
render_prefix: <prefix>_{front,sider,back,side,topdown,bottom}.png from bv2_look.py
(the reference's second panel shows the statue's left side: the camera on +X in Blender, "sider").
"""
import sys
from PIL import Image, ImageDraw

ref, pre, out = sys.argv[1:4]
R = Image.open(ref).convert("RGB")
W, H = R.size
top = [R.crop((i * W // 4, 0, (i + 1) * W // 4, int(H * 0.557))) for i in range(4)]
bot = [R.crop((0, int(H * 0.557), W // 2, H)), R.crop((W // 2, int(H * 0.557), W, H))]
views = ["front", "sider", "back", "side", "topdown", "bottom"]
ren = [Image.open(f"{pre}_{v}.png").convert("RGB") for v in views]
CH = 520


def fit(im, h):
    return im.resize((max(1, int(im.width * h / im.height)), h), Image.LANCZOS)


row1 = [fit(im, CH) for im in top] + [fit(im, CH) for im in bot]
row2 = [fit(im, CH) for im in ren]
cols = [max(a.width, b.width) for a, b in zip(row1, row2)]
S = Image.new("RGB", (sum(cols) + 10 * 5, CH * 2 + 70), (40, 38, 36))
x = 0
for k, (a, b) in enumerate(zip(row1, row2)):
    S.paste(a, (x, 30)); S.paste(b, (x, CH + 60)); x += cols[k] + 10
d = ImageDraw.Draw(S)
d.text((8, 8), "OWNER REFERENCE (front, left, back, right, top, bottom)", fill=(255, 230, 160))
d.text((8, CH + 38), "NEW TEMPLE BUDDHA - game LOD0, Blender render, same views", fill=(255, 230, 160))
S.save(out, quality=88)
print(out, S.size)
