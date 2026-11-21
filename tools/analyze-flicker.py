"""Shimmer of a creeping-camera frame set (e2e/probes/shimmer.mjs): python tools/analyze-flicker.py <dir> <tag-prefix> [x0,y0,x1,y1 as fractions]

Per view (files <prefix>...-NN.png): the frames move a fraction of a pixel each, so a sound surface changes smoothly; z-fighting and
under-filtered textures jump. Each frame is aligned to the first by the best whole-image shift (the creep's own drift), then
  flicker = mean over the region of the per-pixel temporal standard deviation of the luma (0..255)
  hot %   = share of the region's pixels whose temporal deviation is over 12
A heat map <view>-heat.png (deviation x8) shows where it crawls.
"""
import sys, glob, os, re
import numpy as np
from PIL import Image

d, pre = sys.argv[1], sys.argv[2]
box = [float(x) for x in sys.argv[3].split(",")] if len(sys.argv) > 3 else [0.0, 0.0, 1.0, 1.0]
views = sorted({re.sub(r"-\d\d\.png$", "", os.path.basename(p)) for p in glob.glob(os.path.join(d, pre + "*-[0-9][0-9].png"))})
for v in views:
    fs = sorted(glob.glob(os.path.join(d, v + "-[0-9][0-9].png")))
    frames = []
    for f in fs:
        im = Image.open(f).convert("L")
        w, h = im.size
        frames.append(np.asarray(im.crop((int(w * box[0]), int(h * box[1]), int(w * box[2]), int(h * box[3]))), dtype=np.float32))
    ref = frames[0]
    al = [ref]
    for fr in frames[1:]:
        best, arg = 1e18, (0, 0)
        for dy in range(-3, 4):
            for dx in range(-3, 4):
                s = np.roll(np.roll(fr, dy, 0), dx, 1)
                e = float(np.abs(s[8:-8, 8:-8] - ref[8:-8, 8:-8]).mean())
                if e < best:
                    best, arg = e, (dy, dx)
        al.append(np.roll(np.roll(fr, arg[0], 0), arg[1], 1))
    st = np.stack(al)[:, 8:-8, 8:-8]
    sd = st.std(axis=0)
    Image.fromarray(np.clip(sd * 8, 0, 255).astype(np.uint8)).save(os.path.join(d, v + "-heat.png"))
    print(f"{v:44s} flicker {sd.mean():6.3f}   hot {100.0 * (sd > 12).mean():6.3f} %   (frames {len(fs)})")
