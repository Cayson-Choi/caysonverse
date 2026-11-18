"""Seokguram's face next to the new 본존불's face, cropped to the same frame (top of the 육계 -> just under the chin) and scaled
to the same height, so the proportions can be compared directly.
    python face_compare.py <seokguram_front.jpg> <render_front.png> <out.jpg> <ref_box x0,y0,x1,y1> <render_box x0,y0,x1,y1>
"""
import sys
from PIL import Image, ImageDraw
ref, ren, out = sys.argv[1:4]
rb = [int(v) for v in sys.argv[4].split(",")]; nb = [int(v) for v in sys.argv[5].split(",")]
H = 760
a = Image.open(ref).convert("RGB").crop(rb); b = Image.open(ren).convert("RGB").crop(nb)
a = a.resize((int(a.width * H / a.height), H), Image.LANCZOS); b = b.resize((int(b.width * H / b.height), H), Image.LANCZOS)
S = Image.new("RGB", (a.width + b.width + 20, H + 40), (24, 22, 20)); S.paste(a, (0, 40)); S.paste(b, (a.width + 20, 40))
d = ImageDraw.Draw(S)
d.text((8, 12), "Seokguram main Buddha (Cultural Heritage Administration, KOGL Type 1)  |  new temple Buddha (game LOD0, Blender)  -  same frame: usnisa top to chin", fill=(240, 240, 240))
for k in range(1, 10):     # thirds/ninths guides across both
    y = 40 + H * k // 10; d.line([(0, y), (S.width, y)], fill=(90, 90, 90))
S.save(out, quality=88); print(out, S.size)
