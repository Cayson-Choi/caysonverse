"""window panorama -> client/public/models/village/houses/house_N_view.webp  (system Python, PIL)

  python art/village/tools/houses/post_view.py --house N

Stacks work/pano/house_N_pano_day.png (top) and _night.png (bottom): 2048 x 1024 WebP (HOUSE_FILES view: day on top, night below).
Projection: equirectangular, image centre = world NORTH (-z, the way a visitor looks stepping in), left = west, right = east, vertical -45 .. +45 degrees
from a point 2.0 m above the house's centre; the house itself is cut out of the render so the view looks out of its windows."""
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REPO = os.path.dirname(os.path.dirname(ROOT))
WORK = os.path.join(ROOT, "work", "pano")
CLIENT = os.path.join(os.environ.get("CV_CLIENT") or os.path.join(REPO, "client", "public", "models", "village"), "houses")


def main():
    n = int(sys.argv[sys.argv.index("--house") + 1])
    day = Image.open(os.path.join(WORK, f"house_{n}_pano_day.png")).convert("RGB")
    night = Image.open(os.path.join(WORK, f"house_{n}_pano_night.png")).convert("RGB")
    out = Image.new("RGB", (2048, 1024))
    out.paste(day.resize((2048, 512), Image.LANCZOS), (0, 0))
    out.paste(night.resize((2048, 512), Image.LANCZOS), (0, 512))
    os.makedirs(CLIENT, exist_ok=True)
    dst = os.path.join(CLIENT, f"house_{n}_view.webp")
    for q in (88, 84, 80, 76, 72, 68, 62, 56):
        out.save(dst, "WEBP", quality=q, method=6)
        if os.path.getsize(dst) <= 450_000:
            break
    print(os.path.basename(dst), os.path.getsize(dst), "bytes q", q)


main()
