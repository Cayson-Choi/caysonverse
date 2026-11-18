"""pack_fish_cards.py <card_dir> <out.webp>: card_<id>.png (768x384, render_fish_cards.py card mode) -> fish_cards.webp, 4 x 3 cells of 384 x 192 in FISH_SPECIES order."""
import sys, os
from PIL import Image
IDS = ["crucian_carp", "bluegill", "minnow", "prussian_carp", "bass", "carp", "korean_bullhead", "catfish", "mirror_carp", "snakehead", "eel"]
d, out = sys.argv[1], sys.argv[2]
sheet = Image.new("RGBA", (384 * 4, 192 * 3), (0, 0, 0, 0))
for i, k in enumerate(IDS):
    im = Image.open(os.path.join(d, f"card_{k}.png")).convert("RGBA").resize((384, 192), Image.LANCZOS)
    sheet.paste(im, ((i % 4) * 384, (i // 4) * 192))
sheet.save(out, quality=88, method=6)
print(out, os.path.getsize(out))
