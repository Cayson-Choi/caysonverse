"""T_h_linen: a seamless fine-weave linen albedo for the houses' curtains (owner 2026-11-20: "커튼이 골판지 같아"). Procedural (plain weave,
per-thread slubs, fine fibre noise), near-neutral light grey so the vertex tint gives the house's curtain colour. One tile = 0.6 m
(kit_shell.curtain uses tile 0.6): 256 threads across 2048 px (2.3 mm pitch).

  python art/village/tools/houses/make_linen.py        -> work/tex_h/T_h_linen.png (512) + small/ (128), client hi/ 2048 + lo/ 1024 webp
"""
import os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(HERE))))
rng = np.random.default_rng(7)
N, P = 2048, 8                      # px, thread pitch px
T = N // P                          # threads per side (256)


def smooth_noise(n, k):
    a = rng.normal(0, 1, n)
    f = np.fft.rfft(a)
    f[k:] = 0
    b = np.fft.irfft(f, n)
    return b / (b.std() + 1e-9)


# per-thread brightness along its length (slubs): warp threads run along y, weft along x
warp = np.stack([smooth_noise(N, 28) * 0.05 + rng.normal(0, 0.025) for _ in range(T)])      # (T, N)
weft = np.stack([smooth_noise(N, 28) * 0.05 + rng.normal(0, 0.025) for _ in range(T)])
y, x = np.mgrid[0:N, 0:N]
ci, cj = x // P, y // P                      # thread column / row index
fx = (x % P + 0.5) / P                       # 0..1 across a column
fy = (y % P + 0.5) / P
over = (ci + cj) % 2 == 0                    # warp on top in a checker of crossings
prof_x = np.sin(np.pi * fx) ** 0.8           # a thread is round across its width, dark in the gap between threads
prof_y = np.sin(np.pi * fy) ** 0.8
top = np.where(over, prof_x, prof_y)
shade = 0.74 + 0.20 * top
# along-thread tone
tone = np.where(over, warp[ci, y], weft[cj, x])
img = shade * (1.0 + tone)
img += rng.normal(0, 0.012, (N, N))
img *= 0.98 + 0.03 * np.sin(2 * np.pi * (x + 3 * y) / N)         # a very faint diagonal drift so tiles do not look machine-printed
img = np.clip(img * 1.0, 0, 1)
rgb = (np.stack([img, img * 0.985, img * 0.955], -1) * 255).astype(np.uint8)
im = Image.fromarray(rgb, "RGB")
TEXH = os.path.join(REPO, "art", "village", "work", "tex_h")
CLI = os.path.join(REPO, "client", "public", "textures", "houses")
os.makedirs(os.path.join(TEXH, "small"), exist_ok=True)
im.resize((512, 512), Image.LANCZOS).save(os.path.join(TEXH, "T_h_linen.png"))
im.resize((128, 128), Image.LANCZOS).save(os.path.join(TEXH, "small", "T_h_linen.png"))
im.save(os.path.join(CLI, "hi", "T_h_linen.webp"), quality=88, method=6)
im.resize((1024, 1024), Image.LANCZOS).save(os.path.join(CLI, "lo", "T_h_linen.webp"), quality=88, method=6)
print("linen ok", rgb.mean())
