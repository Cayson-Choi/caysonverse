"""After bake_waterfall.py (system Python: PIL): the falls' light maps PNG -> WebP, budget checks, copy to the client.

  python art/village/tools/post_waterfall.py [--day-quality 82] [--night-quality 76]

Writes client/public/models/village/waterfall.glb, waterfall_lm.webp, waterfall_lm_night.webp and prints the sizes
against the design's budget (GLB <= 1.6 MB, both light maps <= 400 KB). Exits 1 when a budget is broken.
"""
import json
import os
import shutil
import struct
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(os.path.dirname(ROOT))
WORK = os.path.join(ROOT, "work")
CLIENT = os.path.join(REPO, "client", "public", "models", "village")
GLB_MAX = int(1.6 * 1024 * 1024)
LM_MAX = 400 * 1024


def arg(argv, name, default):
    return int(argv[argv.index(name) + 1]) if name in argv else default


def glb_info(path):
    b = open(path, "rb").read()
    jl = struct.unpack_from("<I", b, 12)[0]
    j = json.loads(b[20:20 + jl])
    images = {i.get("name", "?"): j["bufferViews"][i["bufferView"]]["byteLength"] for i in j.get("images", [])}
    return {"bytes": len(b), "images": len(images), "image_bytes": sum(images.values()), "meshes": len(j["meshes"]),
            "materials": len(j["materials"])}


def main(argv):
    os.makedirs(CLIENT, exist_ok=True)
    out = {}
    for name, q in (("waterfall_lm", arg(argv, "--day-quality", 82)), ("waterfall_lm_night", arg(argv, "--night-quality", 76))):
        dst = os.path.join(CLIENT, name + ".webp")
        Image.open(os.path.join(WORK, name + ".png")).convert("RGB").save(dst, "WEBP", quality=q, method=6)
        out[name + ".webp"] = os.path.getsize(dst)
    shutil.copy2(os.path.join(WORK, "waterfall.glb"), os.path.join(CLIENT, "waterfall.glb"))
    out["waterfall.glb"] = os.path.getsize(os.path.join(CLIENT, "waterfall.glb"))
    info = glb_info(os.path.join(CLIENT, "waterfall.glb"))
    rep_p = os.path.join(WORK, "falls_w3_report.json")
    rep = json.load(open(rep_p)) if os.path.exists(rep_p) else {}
    rep["shipped"] = out
    rep["glb"] = info
    json.dump(rep, open(rep_p, "w"), indent=1)
    fails = []
    if out["waterfall.glb"] > GLB_MAX:
        fails.append(f"waterfall.glb {out['waterfall.glb']} > {GLB_MAX}")
    lm = out["waterfall_lm.webp"] + out["waterfall_lm_night.webp"]
    if lm > LM_MAX:
        fails.append(f"light maps {lm} > {LM_MAX}")
    for k, v in out.items():
        print(f"{k}: {v / 1024:.0f} KB")
    print("glb:", info, "tris:", rep.get("tris"))
    if fails:
        print("BUDGET:", "; ".join(fails))
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1:])
