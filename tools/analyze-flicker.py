"""Frame-to-frame high-frequency change of a camera pan: python tools/analyze-flicker.py <dir> <tag-prefix>. For each view the mean |frame_i - frame_i-1| of the
high-pass (image minus 9x9 blur) on the lower-middle region; a surface that only drifts scores low, z-fighting / shimmer scores high."""
import sys, glob, os, re
import numpy as np
from PIL import Image, ImageFilter
d, pre = sys.argv[1], sys.argv[2]
views = sorted({re.sub(r"-\d\d\.png$", "", os.path.basename(p)) for p in glob.glob(os.path.join(d, pre + "*-[0-9][0-9].png"))})
for v in views:
    fs = sorted(glob.glob(os.path.join(d, v + "-[0-9][0-9].png")))
    hp = []
    for f in fs:
        im = Image.open(f).convert("L")
        w, h = im.size
        im = im.crop((int(w * .15), int(h * .35), int(w * .85), int(h * .95)))
        a = np.asarray(im, dtype=np.float32); b = np.asarray(im.filter(ImageFilter.GaussianBlur(4)), dtype=np.float32)
        hp.append(a - b)
    diffs = [float(np.abs(hp[i] - hp[i - 1]).mean()) for i in range(1, len(hp))]
    print(f"{os.path.basename(v):40s} flicker {np.mean(diffs):6.2f}  (frames {len(fs)})")
