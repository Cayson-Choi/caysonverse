"""eel_skin.py - the eel's own skin atlas cell (lake_eel_skin.webp), apart from lake_fish.glb so the shared fish file stays untouched.
The body is fish_paint's eel body (gill-cover edge, gape) re-coloured from the aquarium photo of a Japanese eel (Anguilla japonica,
Wikimedia Commons "Anguilla japonica.jpg", CC BY-SA 2.5): olive-brown back, golden flank, pale yellow belly, with the photo's own fine
skin grain (high-pass of its flank) laid over it. The eye / lip swatches are the shipped atlas's (cell of fish_photo in lake_fish.glb).
   python eel_skin.py <fish_photo.webp> <eel_photo.jpg> <out.webp>
The texture is one atlas cell (768 x 352): the client maps the eel's UVs onto it (client/src/lake/eelSkin.ts)."""
import sys
import numpy as np
from PIL import Image, ImageFilter
import fish_paint as FP

RAMP = [(0, "#1e1a0e"), (0.3, "#30281a"), (0.5, "#4c3c1e"), (0.68, "#78602e"), (0.82, "#ae9250"), (1, "#d8c68c")]


def main(fish_photo, eel_photo, out):
    atlas = Image.open(fish_photo).convert("RGB")
    W, H = atlas.size
    cw, ch = W // 4, H // 3
    cell = atlas.crop((2 * cw, 2 * ch, 3 * cw, 3 * ch))          # eel is atlas cell 10 = column 2, row 2
    FP.PAINT["eel"]["ramp"] = RAMP
    body = FP.paint_body("eel", 10)                              # 512 x 192
    bh = round(cw * 0 + ch * 192 / 256)
    body = Image.fromarray(np.clip(body, 0, 255).astype(np.uint8)).resize((cw, bh), Image.BICUBIC)
    b = np.asarray(body).astype(np.float32)
    # the photo's skin grain: the high-pass of the flank's luminance (the smooth wet skin and its faint pores), tiled
    ph = Image.open(eel_photo).convert("L")
    patch = ph.crop((330, 285, 540, 345))
    p = np.asarray(patch).astype(np.float32)
    hp = p - np.asarray(patch.filter(ImageFilter.GaussianBlur(6))).astype(np.float32)
    hp /= max(hp.std(), 1e-3)
    reps = (int(np.ceil(bh / hp.shape[0])) + 1, int(np.ceil(cw / hp.shape[1])) + 1)
    g = np.tile(hp, reps)[:bh, :cw]
    # a second, rotated sample so the tile does not repeat in a row
    g2 = np.tile(hp[::-1, ::-1].T.copy(), (reps[1], reps[0]))[:bh, :cw] if hp.shape[0] == hp.shape[1] else np.roll(g, 37, 1)
    grain = (g * 0.7 + np.roll(g2, 53, 0) * 0.3)
    b = b * (1 + 0.07 * grain[..., None])
    cellnp = np.asarray(cell).astype(np.float32)
    cellnp[:bh] = b
    Image.fromarray(np.clip(cellnp, 0, 255).astype(np.uint8)).save(out, quality=88, method=6)
    print(out, cw, ch)


if __name__ == "__main__":
    main(*sys.argv[1:4])
