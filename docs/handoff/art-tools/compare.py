"""Side-by-side comparison sheets (system Python: PIL + numpy).

  python art/village/tools/compare.py

Reads compare/raw/<frame>.png (Cycles) and compare/raw/<frame>_lm.png (the game look) and writes
compare/cmp_<frame>.png: the reference (crop of the owner's style picture or a Korean reference grid) on the left,
our render on the right. Also compare/cmp_lightmap_look.png (Cycles vs the light-mapped game look) and prints the
brightness check (mean relative luminance >= 0.45, p5 >= 0.10) for the game-look frames.
"""
import os

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REFS = os.path.join(ROOT, "refs")
CMP = os.path.join(ROOT, "compare")
RAW = os.path.join(CMP, "raw")

OWNER = "owner_village_style.webp"
SHEETS = {
    # frame: [(reference file, crop box or None, caption)]
    "plaza_spawn": [(OWNER, (430, 140, 840, 390), "owner style picture (crop): moon fountain")],
    "plaza_overview": [(OWNER, None, "owner style picture")],
    "creek_bridge": [(OWNER, (0, 430, 430, 693), "owner style picture (crop): creek + arched bridge"),
                     ("stream_bridge_pavilion.jpg", (30, 320, 990, 860), "Korean creek / bridge / pavilion refs")],
    "memorial": [("memorial_park_exterior.jpg", (1000, 170, 1320, 372), "pet memorial park exterior (ref)"),
                 ("memorial_park_exterior.jpg", (1650, 480, 1968, 712), "pet memorial park exterior (ref)")],
}
H = 1080


def caption(im, text, xy=(16, 12)):
    d = ImageDraw.Draw(im)
    w = 9 * len(text) + 24
    d.rectangle((xy[0] - 8, xy[1] - 6, xy[0] + w, xy[1] + 22), fill=(20, 22, 30))
    d.text(xy, text, fill=(255, 255, 255))


def fit_h(im, h):
    return im.resize((max(1, int(im.width * h / im.height)), h), Image.LANCZOS)


def ref_column(refs, h):
    ims = []
    for f, box, cap in refs:
        im = Image.open(os.path.join(REFS, f)).convert("RGB")
        if box:
            im = im.crop(box)
        ims.append((im, cap))
    each = h // len(ims)
    parts = [fit_h(im, each) for im, _ in ims]
    w = max(p.width for p in parts)
    col = Image.new("RGB", (w, h), (243, 239, 234))
    y = 0
    for p, (_, cap) in zip(parts, ims):
        col.paste(p, ((w - p.width) // 2, y))
        caption(col, "REF: " + cap, (16, y + 12))
        y += each
    return col


def sheet(frame, refs):
    ours = os.path.join(RAW, frame + ".png")
    if not os.path.exists(ours):
        print("missing", ours)
        return None
    right = fit_h(Image.open(ours).convert("RGB"), H)
    caption(right, f"OURS (Cycles, authoring scene): {frame}")
    left = ref_column(refs, H)
    out = Image.new("RGB", (left.width + right.width + 12, H), (243, 239, 234))
    out.paste(left, (0, 0))
    out.paste(right, (left.width + 12, 0))
    path = os.path.join(CMP, f"cmp_{frame}.png")
    out.save(path)
    print("wrote", path)
    return path


def luma(path):
    a = np.asarray(Image.open(path).convert("RGB"), np.float64) / 255.0
    lin = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
    y = lin @ np.array([0.2126, 0.7152, 0.0722])
    return float(y.mean()), float(np.percentile(y, 5))


def main():
    for frame, refs in SHEETS.items():
        sheet(frame, refs)
    pairs = [f for f in SHEETS if os.path.exists(os.path.join(RAW, f + "_lm.png"))]
    if pairs:
        rows = []
        for f in pairs:
            a = fit_h(Image.open(os.path.join(RAW, f + ".png")).convert("RGB"), 540)
            b = fit_h(Image.open(os.path.join(RAW, f + "_lm.png")).convert("RGB"), 540)
            caption(a, f"Cycles: {f}")
            m, p5 = luma(os.path.join(RAW, f + "_lm.png"))
            caption(b, f"game look (baked light map, unlit, ACES): {f}  luma mean {m:.2f} p5 {p5:.2f}")
            row = Image.new("RGB", (a.width + b.width + 12, 540), (243, 239, 234))
            row.paste(a, (0, 0))
            row.paste(b, (a.width + 12, 0))
            rows.append(row)
            print(f"game look {f}: mean {m:.3f} p5 {p5:.3f} -> {'PASS' if m >= 0.45 and p5 >= 0.10 else 'below'}")
        out = Image.new("RGB", (max(r.width for r in rows), sum(r.height for r in rows) + 12 * (len(rows) - 1)),
                        (243, 239, 234))
        y = 0
        for r in rows:
            out.paste(r, (0, y))
            y += r.height + 12
        path = os.path.join(CMP, "cmp_lightmap_look.png")
        out.save(path)
        print("wrote", path)


if __name__ == "__main__":
    main()
