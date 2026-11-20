"""Prepare the houses' paintings (owner 2026-11-20): public-domain works from Wikimedia Commons (PD-Art / CC0 reproductions).

  python art/village/tools/houses/make_paintings.py <folder of the downloaded <id>.jpg files>

reads paintings_src.json (id, artist, work, year, source URL, licence; the image is <folder>/<id>.jpg), and writes
  - art/village/tools/houses/paintings.json   (id, artist, name, year, aspect, source, license: what the kit and the LICENSE file read)
  - art/village/work/tex_h/T_h_art_<id>.png  (512 px long side: the authoring blend) and tex_h/small/T_h_art_<id>.png (128 px: the GLB)
  - client/public/textures/houses/hi/T_h_art_<id>.webp (2048 px long side, PC) and lo/ (1024 px, phone)
and appends the table to client/public/textures/houses/LICENSE.md.
"""
import json
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(HERE))))
SRC = sys.argv[1]
M = json.load(open(os.path.join(HERE, "paintings_src.json"), encoding="utf-8"))
OUT = []
TEXH = os.path.join(REPO, "art", "village", "work", "tex_h")
CLI = os.path.join(REPO, "client", "public", "textures", "houses")
for d in (TEXH, os.path.join(TEXH, "small"), os.path.join(CLI, "hi"), os.path.join(CLI, "lo")):
    os.makedirs(d, exist_ok=True)


def fit(im, long_side):
    w, h = im.size
    k = long_side / max(w, h)
    return im.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS) if k < 1 else im.copy()


for m in M:
    f = os.path.join(SRC, m["id"] + ".jpg")
    if not os.path.exists(f) or os.path.getsize(f) < 1000:
        print("MISSING", m["id"])
        continue
    im = Image.open(f).convert("RGB")
    w, h = im.size
    name = "T_h_art_" + m["id"]
    fit(im, 512).save(os.path.join(TEXH, name + ".png"))
    fit(im, 128).save(os.path.join(TEXH, "small", name + ".png"))
    fit(im, 2048).save(os.path.join(CLI, "hi", name + ".webp"), quality=84, method=6)
    fit(im, 1024).save(os.path.join(CLI, "lo", name + ".webp"), quality=82, method=6)
    OUT.append(dict(id=m["id"], artist=m["artist"], name=m["name"], year=m["year"], aspect=round(w / h, 4), source=m["source"], license=m["license"]))
    print("ok", m["id"], w, h, round(w / h, 3))
json.dump(OUT, open(os.path.join(HERE, "paintings.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(len(OUT), "paintings")
