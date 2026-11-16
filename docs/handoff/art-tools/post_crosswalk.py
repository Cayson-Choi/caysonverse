"""Crosswalk fix (2026-11-13): make_textures.py plaza() now paints ONE straight zebra per crossing. This builds the WebP that
scripts/patch-village-crosswalks.mjs puts into village.glb in place of its T_plaza image (system Python: PIL + numpy).

  python art/village/tools/post_crosswalk.py --old <T_plaza.png before the fix> --new work/tex/T_plaza.png \
         --glb <client/public/models/village/village.glb> --out <T_plaza_xwalk.webp>

The shipped image is the bake's own T_plaza (WebP, Blender-resampled), not the work PNG, so the new image is
    shipped + (new PNG - old PNG)
which changes exactly the pixels the fix repainted (the ring road's crosswalks and the line breaks) and nothing else.
Review r3: pass --direct (and --old = the PNG from before the first fix) to take the new PNG's pixels in the repainted
area instead of adding the difference, which left a ghost of removed paint.
Then:  node scripts/patch-village-crosswalks.mjs <village.glb> --image <T_plaza_xwalk.webp>
"""
import io, json, struct, sys
import numpy as np
from PIL import Image


def arg(n):
    return sys.argv[sys.argv.index(n) + 1]


def shipped_plaza(glb):
    b = open(glb, "rb").read()
    n = struct.unpack("<I", b[12:16])[0]
    j = json.loads(b[20:20 + n])
    off = 20 + n + 8
    img = next(i for i in j["images"] if i["name"] == "T_plaza")
    bv = j["bufferViews"][img["bufferView"]]
    o = off + bv.get("byteOffset", 0)
    return Image.open(io.BytesIO(b[o:o + bv["byteLength"]])).convert("RGB")


ship = np.asarray(shipped_plaza(arg("--glb")), np.float32)
old = np.asarray(Image.open(arg("--old")).convert("RGB"), np.float32)
new = np.asarray(Image.open(arg("--new")).convert("RGB"), np.float32)
if "--direct" in sys.argv:
    # review r3 (2026-11-13): adding the difference left a ghost where paint was REMOVED (the yellow bus-bay box came back
    # as a blue dashed outline): the shipped image's yellow was not the PNG's yellow, so ship - yellow + asphalt was off.
    # --direct takes the new PNG's own pixels wherever the fix repainted anything (dilated 3 px), and the shipped image
    # elsewhere (the two agree to about 3/255 outside, the WebP's noise). --old is the PNG from BEFORE the first fix, --was
    # the PNGs of the rounds already in the shipped image (their paint must go too where this round removed it).
    from scipy import ndimage
    changed = np.abs(new - old).max(2) > 2
    # and every pixel an earlier round put into the shipped image (--was a.png,b.png: the PNGs those rounds were made from)
    for w in (arg("--was").split(",") if "--was" in sys.argv else []):
        changed |= np.abs(np.asarray(Image.open(w).convert("RGB"), np.float32) - old).max(2) > 2
    mask = ndimage.binary_dilation(changed, iterations=3)
    out = np.where(mask[..., None], new, ship).round().astype(np.uint8)
    print("direct px:", int(mask.sum()))
else:
    out = np.clip(ship + (new - old), 0, 255).round().astype(np.uint8)
Image.fromarray(out).save(arg("--out"), "WEBP", quality=90, method=6)
print("wrote", arg("--out"), "changed px:", int((np.abs(new - old).max(2) > 2).sum()))
