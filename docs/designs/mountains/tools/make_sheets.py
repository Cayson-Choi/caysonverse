"""
Comparison sheets for the distant mountains: reference photos (art/village/refs/mountains/) above game screenshots
(e2e/mountains-look.mjs output), labelled. Usage: python make_sheets.py <shots dir> <tag> <out dir>
"""
import os, sys
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
REFS = os.path.join(REPO, "art", "village", "refs", "mountains")
shots, tag, out = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(out, exist_ok=True)
try:
    FONT = ImageFont.truetype("C:/Windows/Fonts/malgun.ttf", 22)
except OSError:
    FONT = ImageFont.load_default()

def tile(path, w, h, label, crop=None):
    im = Image.open(path).convert("RGB")
    if crop:
        W, H = im.size
        im = im.crop((0, int(H * crop[0]), W, int(H * crop[1])))
    r = max(w / im.width, h / im.height)
    im = im.resize((int(im.width * r + 0.5), int(im.height * r + 0.5)))
    x, y = (im.width - w) // 2, (im.height - h) // 2
    im = im.crop((x, y, x + w, y + h))
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, min(w, 12 + 12 * len(label)), 32), fill=(0, 0, 0))
    d.text((6, 3), label, fill=(255, 255, 255), font=FONT)
    return im

def sheet(name, refs, views, cols=3, w=640, h=300):
    rows = [refs, views]
    S = Image.new("RGB", (cols * w, sum(((len(r) + cols - 1) // cols) for r in rows) * h), "white")
    y = 0
    for r in rows:
        for k, (p, label, crop) in enumerate(r):
            S.paste(tile(p, w, h, label, crop), ((k % cols) * w, y + (k // cols) * h))
        y += ((len(r) + cols - 1) // cols) * h
    S.save(os.path.join(out, name), quality=88)
    print(os.path.join(out, name))

R = lambda f, lab: (os.path.join(REFS, f), lab, None)
V = lambda f, lab: (os.path.join(shots, f), lab, (0.18, 0.62))
for time, tl in (("1230", "낮 12:30"), ("0800", "아침 08:00"), ("1630", "오후 16:30"), ("1715", "노을 17:15"), ("2100", "밤 21:00")):
    if not os.path.exists(os.path.join(shots, f"{tag}-desktop-{time}-plaza-0.png")):
        continue
    sheet(f"sheet-{time}.jpg",
          [R("ref03.jpg", "실제: 소백산 능선(겹친 능선)"), R("ref13.jpg", "실제: 하회마을 원경"), R("ref04.jpg", "실제: 소백산 원경")],
          [V(f"{tag}-desktop-{time}-plaza-0.png", f"게임 광장→북 {tl}"), V(f"{tag}-desktop-{time}-plaza-180.png", f"게임 광장→남 {tl}"),
           V(f"{tag}-desktop-{time}-plaza-270.png", f"게임 광장→서 {tl}"),
           V(f"{tag}-desktop-{time}-falls-310.png", f"게임 폭포 쪽(서북서) {tl}"),
           V(f"{tag}-desktop-{time}-lake-80.png", f"게임 호수 쪽(동) {tl}"),
           V(f"{tag}-desktop-{time}-plaza-90.png", f"게임 광장→동 {tl}")])

# before / after (the same views at noon) when a "before" shots dir is given (e2e/mountains-look.mjs --tag=before)
if len(sys.argv) > 4:
    bdir = sys.argv[4]
    pairs = []
    for az, lab in ((0, "북"), (180, "남"), (270, "서"), (90, "동")):
        b = os.path.join(bdir, f"before-desktop-1230-plaza-{az}.png")
        a = os.path.join(shots, f"{tag}-desktop-1230-plaza-{az}.png")
        if os.path.exists(b) and os.path.exists(a):
            pairs += [(b, f"전: 광장→{lab} 낮", (0.18, 0.62)), (a, f"후: 광장→{lab} 낮", (0.18, 0.62))]
    if pairs:
        sheet("before-after-1230.jpg", pairs[0::2], pairs[1::2], cols=4, w=480, h=230)
