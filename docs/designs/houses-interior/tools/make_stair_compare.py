"""Staircase side-by-side (system Python: PIL): real photos of 2-storey house stairs | the design mock-up (railing the owner called wrong)
| the kit stair from the mock-up's viewpoint and from the room side.

  python art/village/tools/houses/make_stair_compare.py [--refs 01,07,04]
Writes art/village/work/kit/sheets/stairs_compare.jpg
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REPO = os.path.dirname(os.path.dirname(ROOT))
REFS = os.path.join(ROOT, "refs", "houses", "08_stairs_2f")
KIT = os.path.join(ROOT, "work", "kit")
MOCK = os.path.join(REPO, "docs", "designs", "houses-interior", "mock_h01_1f_living.png")


def font(sz):
    for f in ("C:/Windows/Fonts/malgun.ttf", "C:/Windows/Fonts/arial.ttf"):
        if os.path.exists(f):
            return ImageFont.truetype(f, sz)
    return ImageFont.load_default()


def fit(im, w, h):
    s = min(w / im.width, h / im.height)
    return im.resize((int(im.width * s), int(im.height * s)), Image.LANCZOS)


def main():
    refs = ["01", "07", "04"]
    if "--refs" in sys.argv:
        refs = sys.argv[sys.argv.index("--refs") + 1].split(",")
    H = 640
    cells = []
    for r in refs:
        p = os.path.join(REFS, f"{r}.jpg")
        if os.path.exists(p):
            cells.append((f"photo {r}", fit(Image.open(p).convert("RGB"), 420, H)))
    cells.append(("design mock-up (rail on the wall side, 4 loose posts)", fit(Image.open(MOCK).convert("RGB"), 1000, H)))
    for n, label in (("demo_living_stairs_b", "kit stair, same side as the mock-up"), ("demo_living_stairs", "kit stair, from the room side (low steps open)")):
        p = os.path.join(KIT, n + ".png")
        if os.path.exists(p):
            cells.append((label, fit(Image.open(p).convert("RGB"), 1000, H)))
    W = sum(c[1].width for c in cells) + 10 * (len(cells) + 1)
    S = Image.new("RGB", (W, H + 50), (255, 255, 255))
    d = ImageDraw.Draw(S)
    x = 10
    for label, im in cells:
        S.paste(im, (x, 44))
        d.text((x, 10), label, fill=(0, 0, 0), font=font(18))
        x += im.width + 10
    out = os.path.join(KIT, "sheets", "stairs_compare.jpg")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    S.save(out, quality=88)
    print(out, S.size)


main()
