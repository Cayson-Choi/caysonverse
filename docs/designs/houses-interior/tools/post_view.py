"""house_N_view_day.png (2048 x 512) -> house_N_view.webp (2048 x 1024: top day, bottom a graded night) in art/village/export and the client.
  python post_view.py N [--client]"""
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REPO = os.path.dirname(os.path.dirname(ROOT))
n = int(sys.argv[1])
day = Image.open(os.path.join(ROOT, "work", f"house_{n}_view_day.png")).convert("RGB")
a = np.asarray(day, np.float32) / 255
lin = a ** 2.2
lum = lin @ np.array([0.2126, 0.7152, 0.0722], np.float32)
night = lin * np.array([0.05, 0.075, 0.16], np.float32) + (lum ** 2)[..., None] * 0.04 + np.array([0.004, 0.007, 0.022], np.float32)
night = np.clip(night, 0, 1) ** (1 / 2.2)
top = (a * 255 + 0.5).astype(np.uint8)
bot = (night * 255 + 0.5).astype(np.uint8)
im = Image.fromarray(np.concatenate([top, bot], 0))
dst = os.path.join(ROOT, "export", f"house_{n}_view.webp")
for q in (86, 80, 74, 68, 60):
    im.save(dst, "WEBP", quality=q, method=6)
    if os.path.getsize(dst) <= 300_000:
        break
print("wrote", dst, os.path.getsize(dst), "bytes q", q)
if "--client" in sys.argv:
    import shutil
    c = os.path.join(REPO, "client", "public", "models", "village", "houses")
    os.makedirs(c, exist_ok=True)
    shutil.copy(dst, c)
    print("copied to", c)
