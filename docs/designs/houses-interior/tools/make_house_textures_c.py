"""HA extra albedo textures (system Python: numpy + PIL): a lighter, less orange oak for the modern floors.
  python art/village/tools/houses/make_house_textures_c.py     -> art/village/work/tex_h/T_h_floor_oakL.png
"""
import os
import numpy as np
from PIL import Image

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "work", "tex_h")
a = np.asarray(Image.open(os.path.join(OUT, "T_h_floor_oak.png")).convert("RGB"), np.float32) / 255
lum = (a @ np.array([0.2126, 0.7152, 0.0722], np.float32))[..., None]
b = lum + (a - lum) * 0.42                       # desaturate
b = np.clip((b - 0.5) * 0.9 + 0.5 + 0.17, 0, 1)      # brighter, a touch flatter
b = b * np.array([1.0, 0.985, 0.95], np.float32)
Image.fromarray((np.clip(b, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, "T_h_floor_oakL.png"))
print("wrote T_h_floor_oakL.png", b.mean((0, 1)).round(3))
