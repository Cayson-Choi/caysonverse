"""Chapel crucifix from a CC0 museum photograph (The Met 466395, Crucifix, oak with polychromy):
segment the crucifix from the studio background, split the oak cross from the carved corpus, and write
  crucifix_color.png   the photograph cropped to the crucifix (gently freshened: no grime look)
  crucifix_height.png  16-bit height: the cross a 5 cm slab, the corpus a rounded carved body standing proud of it
  crucifix_mask.png
build_relief.py turns these into a mesh; process_statue.py ("surface": "photo") bakes it like the scanned statues.
    python -E -P make_crucifix_relief.py <met_466395.jpg> <out_dir>
"""
import sys, os
import numpy as np
from PIL import Image, ImageEnhance
from scipy import ndimage as ndi

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
full = Image.open(src).convert("RGB")
FW, FH = full.size
S = 4  # work at 1/4 for segmentation
img = full.resize((FW // S, FH // S), Image.LANCZOS)
r = np.asarray(img).astype(np.float32); C = r.max(2) - r.min(2); L = r.mean(2)
H, W = L.shape; yy, xx = np.mgrid[0:H, 0:W]
band = (xx < 30) | (xx > W - 30) | (yy < 30) | (yy > H - 30)
A = np.stack([np.ones_like(xx), xx, yy, xx * xx, yy * yy, xx * yy], -1).reshape(-1, 6).astype(np.float64)
coef, *_ = np.linalg.lstsq(A[band.ravel()], L.ravel()[band.ravel()], rcond=None)
Lbg = (A @ coef).reshape(H, W)
m = (C > 9) | (L < Lbg - 45)
m = ndi.binary_opening(m, iterations=1); m = ndi.binary_closing(m, iterations=2)
holes = ndi.binary_fill_holes(m) & ~m; hl, hn = ndi.label(holes); hs = ndi.sum(holes, hl, range(1, hn + 1))
m |= np.isin(hl, 1 + np.where(hs < 400)[0])
lab, n = ndi.label(m); sz = ndi.sum(m, lab, range(1, n + 1)); m = lab == (1 + np.argmax(sz))
# cross bars (measured on the full image: vertical bar x 1456..1682, horizontal bar y 490..716)
vx0, vx1, hy0, hy1 = 1456 // S, 1682 // S, 490 // S, 716 // S
rect = np.zeros_like(m); rect[:, vx0:vx1 + 1] = True; rect[hy0:hy1 + 1, :] = True
rect &= m
wood = np.median(r[rect & ~ndi.binary_dilation(~rect, iterations=6)], 0)
diff = np.abs(r - wood).sum(2)
corpus = (m & ~rect) | (rect & (diff > 38))
corpus = ndi.binary_opening(corpus, iterations=2)
# rows where the body covers the vertical bar edge to edge (torso, head): the whole bar width there is corpus
for y in range(H):
    if corpus[y, max(0, vx0 - 2)] and corpus[y, min(W - 1, vx1 + 2)] and not (hy0 <= y <= hy1):
        corpus[y, vx0:vx1 + 1] = True
corpus = ndi.binary_closing(corpus, iterations=3)
outside = corpus & ~ndi.binary_dilation(rect, structure=np.ones((1, 15), bool))
outside = ndi.binary_opening(outside, iterations=2)
y_last = np.nonzero(outside.any(1))[0].max()
corpus[y_last + 6:, :] &= ~ndi.binary_dilation(rect, structure=np.ones((1, 15), bool))[y_last + 6:, :]  # below the feet the bar is bare wood
print("feet row", y_last, "of", H)
lab, n = ndi.label(corpus); sz = ndi.sum(corpus, lab, range(1, n + 1)); corpus = lab == (1 + np.argmax(sz))
corpus = ndi.binary_fill_holes(corpus)
# heights in metres for a 1.52 m tall original (process_statue rescales uniformly)
px_m = 1.52 / (np.ptp(np.nonzero(m)[0]) + 1)
d = ndi.distance_transform_edt(corpus) * px_m
h_c = np.sqrt(np.clip(d / 0.07, 0, 1)) * 0.10  # torso ~10 cm proud, limbs rounder and lower by their width
lum = ndi.gaussian_filter(L, 1.0) / 255.0
detail = (lum - ndi.gaussian_filter(lum, 6)) * 0.03 * corpus
h = np.where(rect, 0.05, 0.0) + np.where(corpus, 0.05 + h_c + detail, 0.0)
# cross edges: a chamfer so the slab is not a cut-out
dc = ndi.distance_transform_edt(rect & ~corpus) * px_m
h = np.where(rect & ~corpus, 0.05 * np.clip(dc / 0.012, 0.5, 1.0), h)
h *= m
ys, xs = np.nonzero(m); y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
h = h[y0:y1, x0:x1]; mm = m[y0:y1, x0:x1]
Image.fromarray(np.clip(h / 0.2 * 65535, 0, 65535).astype(np.uint16)).save(os.path.join(out, "crucifix_height.png"))
Image.fromarray((mm * 255).astype(np.uint8)).save(os.path.join(out, "crucifix_mask.png"))
col = full.crop((x0 * S, y0 * S, x1 * S, y1 * S))
# push object colour outward over the background so the relief edges never pick up the grey studio wall
ca = np.asarray(col).astype(np.uint8).copy()
inner = np.asarray(Image.fromarray((ndi.binary_erosion(mm, iterations=2) * 255).astype(np.uint8)).resize(col.size, Image.NEAREST)) > 127
_, (iy, ix) = ndi.distance_transform_edt(~inner, return_indices=True)
ca = ca[iy, ix]
col = Image.fromarray(ca)
col = ImageEnhance.Color(col).enhance(1.10); col = ImageEnhance.Brightness(col).enhance(1.06); col = ImageEnhance.Contrast(col).enhance(1.04)
col = col.resize((1024, int(1024 * col.size[1] / col.size[0]) // 4 * 4), Image.LANCZOS)
col.save(os.path.join(out, "crucifix_color.png"))
print("relief", h.shape, "aspect w/h", round((x1 - x0) / (y1 - y0), 4), "px_m", px_m, "height range", float(h.max()))
