"""B3 (lots v2: 케이슨랜드 정문 polish) — the gate's own atlas `lot_gate_goods` (1024 px, four 512 px cells, gate_base.CELLS):
the pennant / banner star flag, the flower-bed foliage and the soil (the L4 cells of feat/lot-mart-gate 75ab7df, upscaled), and a
new storybook picture map of the park with NO words (a castle, a Ferris wheel, a carousel, a coaster, a lake with a boat, paths,
trees and flowers) for the plaques in the arcade bays where the ticket-price boards were.

    python docs/designs/village-lots-v2/tools/gate_goods.py <l4 mg_goods_albedo.webp> <out png>
"""
import math
import random
import sys

from PIL import Image, ImageDraw, ImageFilter

S = 2  # supersampling


def park_map(n=512):
    W = n * S
    im = Image.new("RGB", (W, W), (124, 186, 104))
    d = ImageDraw.Draw(im)
    rg = random.Random(7)
    # a cream frame with a navy line (an enamel board)
    d.rectangle([0, 0, W - 1, W - 1], fill=(250, 241, 214))
    d.rectangle([14 * S, 14 * S, W - 14 * S, W - 14 * S], fill=(30, 52, 110))
    d.rectangle([20 * S, 20 * S, W - 20 * S, W - 20 * S], fill=(124, 186, 104))
    # meadow texture
    for _ in range(900):
        x, y = rg.uniform(20, n - 20) * S, rg.uniform(20, n - 20) * S
        r = rg.uniform(2, 5) * S
        c = rg.choice([(112, 176, 96), (136, 196, 112), (118, 182, 98)])
        d.ellipse([x - r, y - r, x + r, y + r], fill=c)
    # the lake
    d.ellipse([60 * S, 300 * S, 230 * S, 440 * S], fill=(86, 160, 214))
    d.ellipse([80 * S, 318 * S, 210 * S, 420 * S], fill=(110, 182, 230))
    d.polygon([(150 * S, 372 * S), (176 * S, 372 * S), (168 * S, 384 * S), (156 * S, 384 * S)], fill=(250, 250, 250))  # a swan boat
    d.ellipse([170 * S, 362 * S, 180 * S, 372 * S], fill=(250, 250, 250))
    # paths
    path = [(256, 495), (256, 400), (200, 300), (256, 230), (330, 170), (400, 120), (256, 230), (150, 180), (100, 120)]
    for a, b in zip(path, path[1:]):
        d.line([(a[0] * S, a[1] * S), (b[0] * S, b[1] * S)], fill=(244, 222, 170), width=16 * S)
    d.ellipse([226 * S, 200 * S, 286 * S, 260 * S], fill=(244, 222, 170))
    # the castle (pink walls, blue cone roofs, a gold flag)
    cx, base = 256, 150
    d.rectangle([(cx - 60) * S, (base - 40) * S, (cx + 60) * S, (base + 30) * S], fill=(246, 196, 208))
    for tx, th in ((cx - 60, 80), (cx - 20, 110), (cx + 20, 110), (cx + 60, 80)):
        d.rectangle([(tx - 13) * S, (base - th + 25) * S, (tx + 13) * S, (base + 30) * S], fill=(250, 214, 224))
        d.polygon([((tx - 18) * S, (base - th + 26) * S), ((tx + 18) * S, (base - th + 26) * S), (tx * S, (base - th - 20) * S)], fill=(70, 110, 200))
        d.line([(tx * S, (base - th - 20) * S), (tx * S, (base - th - 34) * S)], fill=(90, 70, 50), width=2 * S)
        d.polygon([(tx * S, (base - th - 34) * S), ((tx + 12) * S, (base - th - 30) * S), (tx * S, (base - th - 26) * S)], fill=(244, 196, 60))
    d.rectangle([(cx - 12) * S, (base + 5) * S, (cx + 12) * S, (base + 30) * S], fill=(120, 70, 60))
    d.pieslice([(cx - 12) * S, (base - 7) * S, (cx + 12) * S, (base + 17) * S], 180, 360, fill=(120, 70, 60))
    # the Ferris wheel
    wx, wy, wr = 410, 280, 62
    d.ellipse([(wx - wr) * S, (wy - wr) * S, (wx + wr) * S, (wy + wr) * S], outline=(230, 70, 70), width=6 * S)
    for k in range(12):
        a = 2 * math.pi * k / 12
        d.line([(wx * S, wy * S), ((wx + wr * math.cos(a)) * S, (wy + wr * math.sin(a)) * S)], fill=(250, 250, 250), width=2 * S)
        px, py = wx + wr * math.cos(a), wy + wr * math.sin(a)
        d.ellipse([(px - 8) * S, (py - 6) * S, (px + 8) * S, (py + 10) * S], fill=rg.choice([(244, 196, 60), (90, 170, 230), (240, 120, 150), (120, 200, 120)]))
    d.polygon([((wx - 30) * S, (wy + wr + 20) * S), (wx * S, wy * S), ((wx + 30) * S, (wy + wr + 20) * S)], outline=(230, 70, 70), width=4 * S)
    # the carousel (a striped tent)
    kx, ky = 110, 250
    d.ellipse([(kx - 46) * S, (ky + 10) * S, (kx + 46) * S, (ky + 34) * S], fill=(250, 240, 220))
    for k in range(8):
        x0 = kx - 46 + k * 11.5
        d.polygon([(x0 * S, (ky + 20) * S), ((x0 + 11.5) * S, (ky + 20) * S), (kx * S, (ky - 34) * S)], fill=(230, 70, 70) if k % 2 else (250, 250, 250))
    d.line([(kx * S, (ky - 34) * S), (kx * S, (ky - 48) * S)], fill=(244, 196, 60), width=3 * S)
    # the coaster track
    pts = [(300 + 18 * t, 470 - 40 * math.sin(t * 0.9) - 30 * math.sin(t * 2.1)) for t in [i * 0.25 for i in range(42)]]
    pts = [(min(x, 480), y) for x, y in pts]
    d.line([(x * S, y * S) for x, y in pts], fill=(240, 160, 40), width=5 * S)
    for x, y in pts[::4]:
        d.line([(x * S, y * S), (x * S, 490 * S)], fill=(150, 150, 160), width=2 * S)
    # trees and flowers
    for _ in range(46):
        x, y = rg.uniform(30, n - 30), rg.uniform(30, n - 30)
        if (abs(x - 256) < 70 and y < 200) or ((x - 145) ** 2 / 85 ** 2 + (y - 370) ** 2 / 70 ** 2 < 1) or (abs(x - 410) < 75 and abs(y - 290) < 80):
            continue
        r = rg.uniform(9, 15)
        d.ellipse([(x - r) * S, (y - r + 4) * S, (x + r) * S, (y + r + 4) * S], fill=(70, 130, 70))
        d.ellipse([(x - r) * S, (y - r) * S, (x + r) * S, (y + r) * S], fill=rg.choice([(80, 150, 80), (96, 166, 88), (246, 176, 196)]))
    for _ in range(140):
        x, y = rg.uniform(26, n - 26), rg.uniform(26, n - 26)
        d.ellipse([(x - 2.5) * S, (y - 2.5) * S, (x + 2.5) * S, (y + 2.5) * S], fill=rg.choice([(250, 220, 80), (250, 250, 250), (240, 120, 150)]))
    # a little red "you are here" pin at the gate (bottom middle)
    d.ellipse([244 * S, 466 * S, 268 * S, 490 * S], fill=(220, 50, 50))
    d.ellipse([251 * S, 473 * S, 261 * S, 483 * S], fill=(250, 250, 250))
    return im.resize((n, n), Image.LANCZOS)


def main():
    src = Image.open(sys.argv[1]).convert("RGB")
    W = src.width  # 1024: 256 px cells, (u, v) with v up from the bottom row
    c = W // 4

    def cell(u0, v0):
        x, y = int(u0 * W), int((1 - v0) * W) - c
        return src.crop((x, y, x + c, y + c)).resize((512, 512), Image.LANCZOS).filter(ImageFilter.UnsharpMask(1.2, 60, 2))
    out = Image.new("RGB", (1024, 1024))
    # gate_base.CELLS: flag (0, 0), foliage (0.5, 0), soil (0, 0.5), park_map (0.5, 0.5) — v up from the bottom
    out.paste(cell(0.0, 0.0), (0, 512))
    out.paste(cell(0.25, 0.0), (512, 512))
    out.paste(cell(0.5, 0.0), (0, 0))
    out.paste(park_map(512), (512, 0))
    out.save(sys.argv[2])
    print("wrote", sys.argv[2])


if __name__ == "__main__":
    main()
