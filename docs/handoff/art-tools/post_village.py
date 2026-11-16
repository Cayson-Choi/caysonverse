"""After bake_village.py (system Python: PIL): the light map PNG -> WebP, copy the shipped files to the client.

  python art/village/tools/post_village.py [--lm-quality 90]
  python art/village/tools/post_village.py --night [--lm-quality 90]   (Task 7A: the night light map only)

Writes art/village/export/village_lm.webp, adds the fountain's crescent to export/village.glb (the repo's
scripts/patch-village-moon.mjs: the node fountain_moon, unlit material M_moon that the game lights with a probe of the
bake's light; bake_village.py leaves it out) and copies village.glb + village_lm.webp to client/public/models/village/.
"""
import json
import os
import shutil
import subprocess
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(os.path.dirname(ROOT))
EXPORT = os.path.join(ROOT, "export")
CLIENT = os.path.join(REPO, "client", "public", "models", "village")


def night(q):
    """The night light map only (Task 7A): work/village_lm_night.png -> export + client village_lm_night.webp."""
    src = os.path.join(ROOT, "work", "village_lm_night.png")
    out = os.path.join(EXPORT, "village_lm_night.webp")
    Image.open(src).convert("RGB").save(out, "WEBP", quality=q, method=6)
    shutil.copy2(out, os.path.join(CLIENT, "village_lm_night.webp"))
    n = os.path.getsize(os.path.join(CLIENT, "village_lm_night.webp"))
    print(f"village_lm_night.webp: {n / 1024 / 1024:.2f} MB")


def patch_moon(glb):
    """The fountain's crescent into the exported GLB (idempotent; fails loudly: without it the plaza has no moon)."""
    script = os.path.join(REPO, "scripts", "patch-village-moon.mjs")
    if not os.path.exists(script):
        sys.exit(f"missing {script} (fix/fix-moon-smooth): the GLB would have no crescent")
    subprocess.run(["node", script, glb], check=True)


def main(argv):
    q = int(argv[argv.index("--lm-quality") + 1]) if "--lm-quality" in argv else 90
    if "--night" in argv:
        night(q)
        return
    os.makedirs(CLIENT, exist_ok=True)
    src = os.path.join(ROOT, "work", "village_lm.png")
    lm = os.path.join(EXPORT, "village_lm.webp")
    Image.open(src).convert("RGB").save(lm, "WEBP", quality=q, method=6)
    patch_moon(os.path.join(EXPORT, "village.glb"))
    for f in ("village.glb", "village_lm.webp"):
        shutil.copy2(os.path.join(EXPORT, f), os.path.join(CLIENT, f))
    sizes = {f: os.path.getsize(os.path.join(CLIENT, f)) for f in ("village.glb", "village_lm.webp")}
    info_p = os.path.join(EXPORT, "village.json")
    if os.path.exists(info_p):
        info = json.load(open(info_p))
        info["shipped"] = sizes
        json.dump(info, open(info_p, "w"), indent=1)
    for f, n in sizes.items():
        print(f"{f}: {n / 1024 / 1024:.2f} MB")


if __name__ == "__main__":
    main(sys.argv[1:])
