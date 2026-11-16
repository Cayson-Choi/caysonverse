"""Review r3 (2026-11-13, fix/crosswalk-signals): remove the old parked bus's baked shadow from the road's light maps (day
and night). The bus is its own moving model (village_bus.glb) but the village's bake still had its shadow, and a blue tint
in it, at the stop: a dark blob on the empty road while the bus was away. Texels of LM_plaza in the sector round the stop
(angle -0.40..0.02 rad, R 31.2..37) whose light is darker than what the road gets on both sides of the sector at the same
radius take that light instead (feathered, lightened and given the neighbours' hue; the night's brighter lamp pools stay). System Python.

  node scripts/village-lm-uvmap.mjs client/public/models/village/village.glb <dir>/lmmap.bin
  python post_lightmap_busbay.py <dir> <village_lm.webp> <out_lossless.webp>       (and the same for village_lm_night.webp)
  then re-encode <out_lossless.webp> as WebP quality 90, method 6 (the shipped maps' own setting: same size, mean error 0.7/255)
"""
import sys, numpy as np
from PIL import Image
from scipy import ndimage
S, src, dst = sys.argv[1], sys.argv[2], sys.argv[3]
N = 2048
raw = np.fromfile(S + '/lmmap.bin', np.float32); X = raw[:N*N].reshape(N, N); Z = raw[N*N:].reshape(N, N)
lm = np.asarray(Image.open(src).convert('RGB'), np.float32)
R = np.nan_to_num(np.hypot(X, Z), nan=0.0); A = np.nan_to_num(np.arctan2(Z, X), nan=9.0)
cov = np.isfinite(X)
A0, A1, BAND = -0.40, 0.02, 0.06
R0, R1, DR = 31.2, 37.0, 0.3
nb = int(np.ceil((R1 - R0) / DR))
def band_mean(lo, hi):
    out = np.zeros((nb, 3), np.float32)
    for i in range(nb):
        m = cov & (A >= lo) & (A < hi) & (R >= R0 + i * DR - 0.15) & (R < R0 + (i + 1) * DR + 0.15)
        out[i] = np.median(lm[m], axis=0)
    return out
left, right = band_mean(A0 - BAND, A0), band_mean(A1, A1 + BAND)
sec = cov & (A >= A0) & (A < A1) & (R >= R0) & (R < R1)
bi = np.clip(((R - R0) / DR).astype(int), 0, nb - 1)
t = np.clip((A - A0) / (A1 - A0), 0, 1)
exp = left[bi] * (1 - t[..., None]) + right[bi] * t[..., None]
lum = lm.mean(2); elum = exp.mean(2)
# darker than its neighbours (the shadow), or bluer (the sky's light in the shadow: same brightness, a blue cast)
blue = (lm[..., 2] - lm[..., 0]) - (exp[..., 2] - exp[..., 0])
shadow = sec & ((lum < elum * 0.94) | (blue > 6))
# grow into the shadow's soft edge, then feather over 2 px
grown = ndimage.binary_dilation(shadow, iterations=2) & sec
w = ndimage.gaussian_filter(grown.astype(np.float32), 1.0) * grown
w = np.clip(w * 1.5, 0, 1)
# lighten the shadow and take the neighbours' hue; never darken a lamp's pool (warm, brighter: kept as it is)
fix = np.where((lum > elum * 1.06)[..., None], lm, np.maximum(lm, exp) * 0 + exp * np.maximum(1.0, (lum / np.maximum(elum, 1))[..., None]))
out = lm * (1 - w[..., None]) + fix * w[..., None]
print(src.split('/')[-1], 'sector px', int(sec.sum()), 'shadow px', int(shadow.sum()), 'max change', float(np.abs(out - lm).max()))
Image.fromarray(np.clip(out.round(), 0, 255).astype(np.uint8)).save(dst, 'WEBP', lossless=True)
