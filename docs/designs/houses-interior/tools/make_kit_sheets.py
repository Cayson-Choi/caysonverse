"""Contact sheets + side-by-side sheets with the reference photos (system Python: PIL).

  python art/village/tools/houses/make_kit_sheets.py [--only group_or_ref,...]

Reads work/kit/<piece>.png + kit_stats.json (written by build_kit_preview.py) and refs/houses/sheet_<ref>.jpg.
Writes work/kit/sheets/contact_<group>.png (every piece of a group with its name and triangle count) and
work/kit/sheets/compare_<ref>.jpg (the reference photo sheet on the left, the matching kit renders on the right).
"""
import json
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
KIT = os.path.join(ROOT, "work", "kit")
OUT = os.path.join(KIT, "sheets")
REFS = os.path.join(ROOT, "refs", "houses")
os.makedirs(OUT, exist_ok=True)


def font(sz):
    for f in ("C:/Windows/Fonts/malgun.ttf", "C:/Windows/Fonts/arial.ttf"):
        if os.path.exists(f):
            return ImageFont.truetype(f, sz)
    return ImageFont.load_default()


def grid(names, stats, cell=420, cols=4, bg=(245, 243, 238)):
    rows = math.ceil(len(names) / cols)
    W = Image.new("RGB", (cols * cell, rows * (cell + 34)), bg)
    d = ImageDraw.Draw(W)
    f = font(17)
    for i, n in enumerate(names):
        p = os.path.join(KIT, n + ".png")
        if not os.path.exists(p):
            continue
        im = Image.open(p).convert("RGB")
        s = min(cell / im.width, cell / im.height)
        im = im.resize((int(im.width * s), int(im.height * s)), Image.LANCZOS)
        x, y = (i % cols) * cell, (i // cols) * (cell + 34)
        W.paste(im, (x + (cell - im.width) // 2, y))
        st = stats.get(n, {})
        d.text((x + 8, y + cell + 6), f"{n}  {st.get('tris', '?')} tris  seats {st.get('seats', 0)}", fill=(30, 30, 30), font=f)
    return W


def main():
    stats = json.load(open(os.path.join(KIT, "kit_stats.json")))
    only = None
    if "--only" in sys.argv:
        only = sys.argv[sys.argv.index("--only") + 1].split(",")
    groups, refs = {}, {}
    for n, st in stats.items():
        if not os.path.exists(os.path.join(KIT, n + ".png")):
            continue
        groups.setdefault(st.get("group") or "misc", []).append(n)
        if st.get("ref"):
            refs.setdefault(st["ref"], []).append(n)
    for g, names in groups.items():
        if only and g not in only:
            continue
        grid(names, stats).save(os.path.join(OUT, f"contact_{g}.png"))
        print("contact", g, len(names))
    for r, names in refs.items():
        if only and r not in only:
            continue
        rp = os.path.join(REFS, f"sheet_{r}.jpg")
        if not os.path.exists(rp):
            continue
        R = Image.open(rp).convert("RGB")
        H = 900
        R = R.resize((int(R.width * H / R.height), H), Image.LANCZOS)
        cols = 2 if len(names) <= 4 else 3
        cell = 450
        G = grid(names, stats, cell, cols)
        G = G.resize((G.width, G.height))
        h = max(H, G.height)
        S = Image.new("RGB", (R.width + G.width + 10, h + 40), (255, 255, 255))
        S.paste(R, (0, 40))
        S.paste(G, (R.width + 10, 40))
        d = ImageDraw.Draw(S)
        d.text((8, 8), f"reference photos: {r}", fill=(0, 0, 0), font=font(20))
        d.text((R.width + 18, 8), "kit renders", fill=(0, 0, 0), font=font(20))
        S.convert("RGB").save(os.path.join(OUT, f"compare_{r}.jpg"), quality=88)
        print("compare", r, len(names))


main()
