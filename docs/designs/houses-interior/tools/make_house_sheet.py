"""Contact sheets of a house's eye-level renders (system Python, PIL).

  python make_house_sheet.py N [--ref 02_modern_living[,05_kids_room]] [--out docs/designs/houses-interior/review] [--cols 3] [--w 640]

Writes <out>/h<N>_day.jpg, h<N>_night.jpg (every camera of work/house_N_cams.json, labelled) and, with --ref, h<N>_compare.jpg: day renders
next to the reference-photo sheets (art/village/refs/houses/sheet_<ref>.jpg) of the categories this house is built from.
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))      # art/village
REPO = os.path.dirname(os.path.dirname(ROOT))
REND = os.path.join(ROOT, "work", "hrender")


def font(sz):
    for f in ("C:/Windows/Fonts/malgunbd.ttf", "C:/Windows/Fonts/malgun.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(f, sz)
        except Exception:
            pass
    return ImageFont.load_default()


def grid(imgs, labels, cols, w):
    h = int(w * 9 / 16)
    rows = (len(imgs) + cols - 1) // cols
    S = Image.new("RGB", (cols * w, rows * h), (20, 20, 22))
    d = ImageDraw.Draw(S)
    for i, (im, lb) in enumerate(zip(imgs, labels)):
        x, y = (i % cols) * w, (i // cols) * h
        S.paste(im.resize((w, h), Image.LANCZOS), (x, y))
        d.rectangle([x, y, x + 150, y + 22], fill=(0, 0, 0))
        d.text((x + 6, y + 2), lb, fill=(255, 255, 255), font=font(15))
    return S


def main():
    a = sys.argv[1:]
    n = int(a[0])
    opt = lambda k, dflt=None: a[a.index(k) + 1] if k in a else dflt
    out = opt("--out", os.path.join(REPO, "docs", "designs", "houses-interior", "review"))
    cols = int(opt("--cols", 3))
    w = int(opt("--w", 640))
    os.makedirs(out, exist_ok=True)
    cams = json.load(open(os.path.join(ROOT, "work", f"house_{n}_cams.json"), encoding="utf-8"))
    day = None
    for tag in ("day", "night"):
        imgs, labels = [], []
        for c in cams:
            p = os.path.join(REND, f"h{n}_{c['name']}_{tag}.png")
            if os.path.exists(p):
                imgs.append(Image.open(p).convert("RGB"))
                labels.append(c["name"])
        if not imgs:
            continue
        S = grid(imgs, labels, cols, w)
        S.save(os.path.join(out, f"h{n}_{tag}.jpg"), quality=86)
        if tag == "day":
            day = S
        print("wrote", f"h{n}_{tag}.jpg", S.size)
    refs = opt("--ref")
    if refs and day is not None:
        rs = [Image.open(os.path.join(REPO, "art", "village", "refs", "houses", f"sheet_{r}.jpg")).convert("RGB") for r in refs.split(",")]
        rw = int(day.height * 1.0 * sum(r.width / r.height for r in rs) / len(rs))
        parts = [day]
        for r in rs:
            hh = day.height // len(rs)
            parts.append(r.resize((int(r.width * hh / r.height), hh), Image.LANCZOS))
        rwid = max(p.width for p in parts[1:])
        C = Image.new("RGB", (day.width + rwid, day.height), (255, 255, 255))
        C.paste(day, (0, 0))
        y = 0
        for p in parts[1:]:
            C.paste(p, (day.width, y))
            y += p.height
        C.save(os.path.join(out, f"h{n}_compare.jpg"), quality=86)
        print("wrote", f"h{n}_compare.jpg", C.size)


main()
