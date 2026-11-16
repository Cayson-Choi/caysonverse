"""B1 waterfall W2: contact sheets from the look-dev renders (system Python + PIL).

  python sheet_falls_water.py [WORK_DIR] [OUT_DIR]     # default art/village/work/falls_w2 and docs/designs/waterfall/w2

  w2-compare.png   reference photo | W2 render pairs (05 Jikso | s8, 04 Guryong | cascade, 12 Yongchu | foam/pool, 12 | wide)
  w2-flow-strip.png  6 frames of the s8 look-dev animation (1/12 s apart) + 6 of the pool-level view
  w2-flow.gif      the same 12 frames as a looping GIF (play it to judge the flow)
  w2-textures.png  T_falls_flow channels (R, G, B, A) and the mist atlas
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.dirname(HERE)
REPO = os.path.dirname(os.path.dirname(ART))
WORK = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ART, "work", "falls_w2")
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(REPO, "docs", "designs", "waterfall", "w2")
REFS = os.path.join(ART, "refs", "waterfall")
os.makedirs(OUT, exist_ok=True)


def font(n):
    for p in ("C:/Windows/Fonts/malgun.ttf", "C:/Windows/Fonts/arial.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, n)
    return ImageFont.load_default()


def fit(im, w, h):
    im = im.convert("RGB")
    s = max(w / im.width, h / im.height)
    im = im.resize((int(im.width * s + 0.5), int(im.height * s + 0.5)), Image.LANCZOS)
    x, y = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((x, y, x + w, y + h))


def label(im, text):
    d = ImageDraw.Draw(im)
    f = font(20)
    w = d.textlength(text, font=f)
    d.rectangle((0, 0, w + 16, 32), fill=(0, 0, 0))
    d.text((8, 4), text, fill=(255, 255, 255), font=f)
    return im


def compare():
    pairs = [("05_jikso_byeonsan_a.jpg", "05 직소폭포 (변산)", "w2-s8.png", "W2 폭포 아래에서 올려다봄 (S8)"),
             ("04_guryong_jiri.jpg", "04 구룡폭포 (지리산) 계단 물", "w2-cascade.png", "W2 위 단 계단 물 (확대)"),
             ("12_yongchu_hamyang.jpg", "12 용추폭포 (함양) 소와 물줄기", "w2-foam.png", "W2 소와 거품 (물가)"),
             ("12_yongchu_hamyang.jpg", "12 용추폭포 (함양)", "w2-wide.png", "W2 멀리서 (임시 바위)")]
    W, H = 640, 400
    sheet = Image.new("RGB", (W * 2, H * len(pairs)), (20, 20, 20))
    for i, (r, rl, o, ol) in enumerate(pairs):
        sheet.paste(label(fit(Image.open(os.path.join(REFS, r)), W, H), rl), (0, i * H))
        sheet.paste(label(fit(Image.open(os.path.join(WORK, o)), W, H), ol), (W, i * H))
    sheet.save(os.path.join(OUT, "w2-compare.png"), optimize=True)


def strips():
    rows = []
    for name in ("s8", "foam"):
        fr = [Image.open(os.path.join(WORK, "anim", f"{name}_{k:02d}.png")).convert("RGB") for k in range(12)]
        pick = fr[0:12:2]
        w, h = 320, 180
        row = Image.new("RGB", (w * 6, h))
        for i, im in enumerate(pick):
            row.paste(label(im.resize((w, h), Image.LANCZOS), f"t = {i * 2}/12 s"), (i * w, 0))
        rows.append(row)
        if name == "s8":
            fr_s8 = fr
    sheet = Image.new("RGB", (rows[0].width, sum(r.height for r in rows)))
    y = 0
    for r in rows:
        sheet.paste(r, (0, y))
        y += r.height
    sheet.save(os.path.join(OUT, "w2-flow-strip.png"), optimize=True)
    # GIF: s8 and foam side by side
    fs = [Image.open(os.path.join(WORK, "anim", f"foam_{k:02d}.png")).convert("RGB") for k in range(12)]
    gif = []
    for a, b in zip(fr_s8, fs):
        g = Image.new("RGB", (a.width * 2, a.height))
        g.paste(a, (0, 0))
        g.paste(b, (a.width, 0))
        gif.append(g.resize((g.width * 3 // 4, g.height * 3 // 4), Image.LANCZOS).quantize(128))
    gif[0].save(os.path.join(OUT, "w2-flow.gif"), save_all=True, append_images=gif[1:], duration=83, loop=0, optimize=True)


def textures():
    tex = os.path.join(ART, "work", "tex")
    f = Image.open(os.path.join(tex, "T_falls_flow.png"))
    chans = f.split()
    sheet = Image.new("RGB", (256 * 5 + 256, 256), (30, 30, 30))
    for i, c in enumerate(chans):
        sheet.paste(c.resize((256, 256), Image.LANCZOS).convert("RGB"), (256 * i, 0))
    m = Image.open(os.path.join(tex, "T_mist_atlas.png"))
    bg = Image.new("RGBA", m.size, (40, 80, 120, 255))
    bg.alpha_composite(m)
    sheet.paste(bg.convert("RGB"), (256 * 4, 0))
    sheet = sheet.crop((0, 0, 256 * 5, 256))
    d = ImageDraw.Draw(sheet)
    for i, t in enumerate(("T_falls_flow R", "G", "B (foam)", "A (aeration)", "T_mist_atlas")):
        d.text((6 + 256 * i, 4), t, fill=(255, 255, 0), font=font(16))
    sheet.save(os.path.join(OUT, "w2-textures.png"), optimize=True)


if __name__ == "__main__":
    for fn in (compare, strips, textures):
        try:
            fn()
            print("ok", fn.__name__)
        except FileNotFoundError as e:
            print("skip", fn.__name__, e)
