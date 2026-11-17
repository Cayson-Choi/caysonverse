"""Side-by-side sheets: a real photograph (left) next to the game asset's renders (right).
    python -E -P compare_sheet.py <out.jpg> <title> <ref.jpg> <render1.png> [<render2.png> ...]
References are public-domain / CC0 museum photographs (SMK, Cleveland, The Met) of the same object or the same kind of
object, so the sheet itself can be committed.
"""
import sys
from PIL import Image, ImageDraw

out, title, ref, *renders = sys.argv[1:]
H = 900
ims = [Image.open(ref).convert("RGB")] + [Image.open(r).convert("RGB") for r in renders]
ims = [im.resize((max(1, int(im.size[0] * H / im.size[1])), H), Image.LANCZOS) for im in ims]
W = sum(im.size[0] for im in ims) + 12 * (len(ims) - 1)
sheet = Image.new("RGB", (W, H + 46), (24, 22, 20))
x = 0
for k, im in enumerate(ims):
    sheet.paste(im, (x, 46))
    d = ImageDraw.Draw(sheet)
    d.text((x + 8, 52), "REAL PHOTO" if k == 0 else f"GAME ASSET {k}", fill=(255, 230, 160))
    x += im.size[0] + 12
ImageDraw.Draw(sheet).text((10, 14), title, fill=(240, 240, 240))
sheet.save(out, quality=88)
print(out, sheet.size)
