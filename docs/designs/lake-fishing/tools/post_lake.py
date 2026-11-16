"""After bake_lake.py / render_lake_refl.py (system Python, PIL): the PNGs -> WebP inside the design's budgets, then copy the shipped
files to client/public/models/lake/.

  python art/lake/tools/post_lake.py [--lm-quality 90]      (quality is the starting point; it is lowered until a file fits)

Budgets (design 10): lake.glb <= 3.0 MB, lake_lm.webp <= 350 KB, lake_lm_night.webp <= 300 KB, each reflection panorama <= 60 KB;
(F follow-up) lake_structures_lm.webp <= 250 KB, lake_structures_lm_night.webp <= 200 KB (1024 x 1024: GPU memory), lake_structures.glb <= 1.5 MB (65 unique meshes for the chairs etc.: B had 0.9 MB).
"""
import json
import os
import shutil
import sys

from PIL import Image

LAKE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(os.path.dirname(LAKE))
WORK = os.path.join(LAKE, "work")
EXPORT = os.path.join(LAKE, "export")
CLIENT = os.path.join(REPO, "client", "public", "models", "lake")

BUDGET = {"lake.glb": 3.0 * 1024 * 1024, "lake_lm.webp": 350 * 1024, "lake_lm_night.webp": 300 * 1024,
          "lake_refl_day.webp": 60 * 1024, "lake_refl_night.webp": 60 * 1024,
          "lake_structures_lm.webp": 250 * 1024, "lake_structures_lm_night.webp": 200 * 1024, "lake_structures.glb": 1.5 * 1024 * 1024}
SOURCES = {"lake_lm.webp": "lake_lm.png", "lake_lm_night.webp": "lake_lm_night.png",
           "lake_refl_day.webp": "lake_refl_day.png", "lake_refl_night.webp": "lake_refl_night.png",
           "lake_structures_lm.webp": "structures_lm.png", "lake_structures_lm_night.webp": "structures_lm_night.png"}


def fill_below_horizon(im):
    """The reflection panorama's lower half is the lake bed seen through the (hidden) water: never looked up (the shader clamps the
    reflected direction to the upper half), but the mip blur at the horizon would drag it in. Replace it by the horizon row, blurred."""
    import numpy as np
    a = np.asarray(im).astype(np.float32)
    h = a.shape[0] // 2
    row = a[h - 6:h - 1].mean(axis=0)                                   # a few rows above the horizon (u, rgb)
    k = np.ones(41, np.float32) / 41
    row = np.stack([np.convolve(np.pad(row[:, c], 20, mode="wrap"), k, mode="valid") for c in range(3)], axis=1)
    a[h:] = row[None, :, :]
    return Image.fromarray(a.clip(0, 255).astype("uint8"))


def to_webp(src, dst, limit, q0):
    im = Image.open(src).convert("RGB")
    if "refl" in os.path.basename(src):
        im = fill_below_horizon(im)
    q = q0
    while True:
        im.save(dst, "WEBP", quality=q, method=6)
        n = os.path.getsize(dst)
        if n <= limit or q <= 20:
            return q, n
        q -= 3


def main(argv):
    q0 = int(argv[argv.index("--lm-quality") + 1]) if "--lm-quality" in argv else 90
    os.makedirs(CLIENT, exist_ok=True)
    rows = []
    for out, png in SOURCES.items():
        p = os.path.join(WORK, png)
        if not os.path.exists(p):
            print("skip (no source)", png)
            continue
        dst = os.path.join(EXPORT, out)
        q, n = to_webp(p, dst, BUDGET[out], q0 if "lm" in out else 82)
        shutil.copy2(dst, os.path.join(CLIENT, out))
        rows.append((out, n, q))
    glb = os.path.join(EXPORT, "lake.glb")
    if os.path.exists(glb):
        shutil.copy2(glb, os.path.join(CLIENT, "lake.glb"))
        rows.append(("lake.glb", os.path.getsize(glb), None))
    sglb = os.path.join(WORK, "structures_lm.glb")        # export_lake_structures.py (B's model + the facilities' light-map UVs)
    if os.path.exists(sglb):
        dst = os.path.join(EXPORT, "lake_structures.glb")
        shutil.copy2(sglb, dst)
        shutil.copy2(dst, os.path.join(CLIENT, "lake_structures.glb"))
        rows.append(("lake_structures.glb", os.path.getsize(dst), None))
    for name, n, q in rows:
        lim = BUDGET[name]
        print(f"{name:22s} {n / 1024:8.1f} KB  (budget {lim / 1024:7.0f} KB){'' if q is None else f'  q={q}'}  {'OK' if n <= lim else 'OVER'}")
    info_p = os.path.join(EXPORT, "lake.json")
    if os.path.exists(info_p):
        info = json.load(open(info_p))
        info["shipped"] = {name: n for name, n, _ in rows}
        json.dump(info, open(info_p, "w"), indent=1)


if __name__ == "__main__":
    main(sys.argv[1:])
