"""Lake ground textures (system Python, PIL + numpy): T_mud (wet bank mud), T_gravel (pebbly shore), T_dirt (the lane_lake
dirt trail), T_reedmud. Made from the village's downloaded photo textures (art/village/downloads/tex), tinted so they sit
beside T_grass. Output art/lake/work/tex/T_*.png (512^2, tileable because the sources are)."""
import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
LAKE = os.path.dirname(HERE)
DL = os.path.join(os.path.dirname(LAKE), "village", "downloads", "tex")
OUT = os.path.join(LAKE, "work", "tex")
os.makedirs(OUT, exist_ok=True)


def load(name, size=512):
    return np.asarray(Image.open(os.path.join(DL, name)).convert("RGB").resize((size, size), Image.LANCZOS), np.float32) / 255.0


def save(a, name):
    Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, name))


def grade(a, mul, lift=0.0, sat=1.0):
    g = a @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    a = g[..., None] + (a - g[..., None]) * sat
    return a * np.array(mul, np.float32) + lift


def main():
    soil = load("river_small_rocks_diff_1k.jpg")
    path = load("grass_path_2_diff_1k.jpg")
    # wet mud: the stony soil darkened, a little green, lower contrast
    save(grade(soil, (0.62, 0.62, 0.50), 0.01, 0.85), "T_mud.png")
    # pebbly shore: the same soil lighter and greyer
    save(grade(soil, (0.98, 0.95, 0.88), 0.0, 0.7), "T_gravel.png")
    # dirt trail: the grass-path photo, warmer, a bit lighter
    save(grade(path, (1.05, 0.97, 0.86), 0.0, 1.0), "T_dirt.png")
    print("textures ->", OUT)


if __name__ == "__main__":
    main()
