"""Packs the two rendered needle cells (render_pine_needles.py) into the temple pines' needle atlas (2026-11-21).

    python docs/designs/temple-pines/tools/compose_pine_atlas.py <dir with needles_spray.png, needles_tuft.png> <out dir>

Cells left to right: spray (a pad's top), tuft (a pad's rim). Pixels under the transparent part carry their cell's mean colour
(no dark fringe where the mip levels blend the edge in). Writes pine_needles_1024.webp (PC) and pine_needles_512.webp (phone).
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

src = Path(sys.argv[1])
out = Path(sys.argv[2])
cells = [np.asarray(Image.open(src / f"needles_{n}.png").convert("RGBA"), np.float32) / 255 for n in ("spray", "tuft")]
atlas = np.zeros((512, 1024, 4), np.float32)
for i, c in enumerate(cells):
    a = c[..., 3:4]
    # the film stores straight alpha; the mean colour of the covered pixels fills the rest
    mean = (c[..., :3] * a).sum((0, 1)) / max(a.sum(), 1e-3)
    rgb = np.where(a > 0.02, c[..., :3], mean)
    atlas[:, i * 512 : (i + 1) * 512, :3] = rgb
    atlas[:, i * 512 : (i + 1) * 512, 3:4] = a
img = Image.fromarray((np.clip(atlas, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")
img.save(out / "pine_needles_1024.webp", quality=90, method=6)
img.resize((512, 256), Image.LANCZOS).save(out / "pine_needles_512.webp", quality=90, method=6)
for n in ("pine_needles_1024.webp", "pine_needles_512.webp"):
    print(n, (out / n).stat().st_size)
