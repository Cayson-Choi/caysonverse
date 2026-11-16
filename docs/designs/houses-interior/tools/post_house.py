"""After the Blender bake of a house (system Python: numpy + PIL).

  python art/village/tools/houses/post_house.py --house N [--client]        light-map PNGs -> WebP (2048 and 1k, day + night)
  python art/village/tools/houses/post_house.py --props [--client]          copy houses_props.glb
  python art/village/tools/houses/post_house.py --check                     budget table of every export/house_*.json

Writes to art/village/export/: house_N_lm.webp (day, 2048) / house_N_lm_1k.webp (phone) / house_N_lm_night.webp /
house_N_lm_night_1k.webp. Quality is lowered stepwise until each file meets the design 7.2 limits (2048: <= 450 KB,
1k: <= 230 KB). --client also copies the GLB, the light maps and the seats JSON to client/public/models/village/houses/
(or $CV_CLIENT/houses).
"""
import glob
import json
import os
import shutil
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REPO = os.path.dirname(os.path.dirname(ROOT))
WORK = os.path.join(ROOT, "work")
EXPORT = os.path.join(ROOT, "export")
CLIENT = os.path.join(os.environ.get("CV_CLIENT") or os.path.join(REPO, "client", "public", "models", "village"), "houses")
LIMIT = {2048: 450_000, 1024: 230_000}


def save_webp(img, path, limit):
    for q in (88, 84, 80, 76, 72, 68, 64, 60, 55, 50):
        img.save(path, "WEBP", quality=q, method=6)
        if os.path.getsize(path) <= limit:
            return q
    return 50


def lightmaps(n):
    out = []
    for tag in ("", "_night"):
        src = os.path.join(WORK, f"house_{n}_lm{tag}.png")
        if not os.path.exists(src):
            print("missing", src)
            continue
        im = Image.open(src).convert("RGB")
        for size in (2048, 1024):
            r = im if im.width == size else im.resize((size, size), Image.LANCZOS)
            dst = os.path.join(EXPORT, f"house_{n}_lm{tag}{'' if size == 2048 else '_1k'}.webp")
            q = save_webp(r, dst, LIMIT[size])
            print(os.path.basename(dst), os.path.getsize(dst), "bytes q", q)
            out.append(dst)
    return out


def main():
    a = sys.argv[1:]
    os.makedirs(EXPORT, exist_ok=True)
    files = []
    if "--house" in a:
        n = int(a[a.index("--house") + 1])
        files += lightmaps(n)
        for f in (f"house_{n}.glb", f"house_{n}_seats.json"):
            if os.path.exists(os.path.join(EXPORT, f)):
                files.append(os.path.join(EXPORT, f))
    if "--props" in a:
        files.append(os.path.join(EXPORT, "houses_props.glb"))
    if "--check" in a:
        for j in sorted(glob.glob(os.path.join(EXPORT, "house_*.json"))):
            d = json.load(open(j, encoding="utf-8"))
            if "bytes" not in d:
                continue
            print(os.path.basename(j), d["bytes"], "bytes", d["triangles"], "tris", len(d["materials"]), "mats", d["budget"])
    if "--client" in a:
        os.makedirs(CLIENT, exist_ok=True)
        for f in files:
            if os.path.exists(f):
                shutil.copy(f, CLIENT)
                print("copied", os.path.basename(f), "->", CLIENT)


main()
