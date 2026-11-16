"""ref_normalize.py - rotate/scale/crop each reference photo so the fish lies on a horizontal axis, head RIGHT,
standard length (snout tip -> caudal base) = SLPX px. Used both for tracing profiles (grid overlay) and for the
comparison sheet (photo at the same scale and side angle as the model render).
   python art/lake/tools/ref_normalize.py <repo> [grid]
Points are in the 1000-px-wide display coordinates of the photo (x right, y down)."""
import sys, os, math
from PIL import Image, ImageDraw, ImageFont

REFS = {   # id: (file, snout(x,y), caudal base(x,y), tail tip x beyond base in SL units used for crop)
    "crucian_carp": ("01_crucian_side.jpg", (975, 385), (195, 215)),
    "bluegill": ("02_bluegill_side.jpg", (840, 292), (205, 285)),
    "minnow": ("03_zacco_side.jpg", (962, 574), (195, 468)),
    "prussian_carp": ("04_cuvieri_side.jpg", (42, 410), (800, 410)),
    "bass": ("05_bass_side2.jpg", (68, 250), (800, 170)),
    "carp": ("06_carp_side.jpg", (920, 455), (182, 372)),
    "korean_bullhead": ("07_bullhead_side.jpg", (75, 330), (835, 300)),
    "catfish": ("08_catfish_side.jpg", (52, 348), (858, 333)),
    "mirror_carp": ("09_mirror_side.jpg", (960, 240), (205, 213)),
    "snakehead": ("10_snakehead_side.jpg", (15, 130), (860, 122)),
    "eel": ("11_eel_side.jpg", (90, 195), (700, 172), 1612),   # curled eel: axis from the straight front part, SL from the path length
}
SLPX = 800


def normalized(repo, key, pad_tail=0.42, pad_head=0.06, half_h=0.36):
    f, sn, cb = REFS[key][:3]
    slen = REFS[key][3] if len(REFS[key]) > 3 else None
    im = Image.open(os.path.join(repo, "art/lake/refs/fish", f)).convert("RGB")
    k = im.width / 1000.0
    sx, sy = sn[0] * k, sn[1] * k; bx, by = cb[0] * k, cb[1] * k
    if sx < bx:                                   # head left in the photo: mirror so the head is on the right
        im = im.transpose(Image.FLIP_LEFT_RIGHT); sx = im.width - sx; bx = im.width - bx
    L = math.hypot(sx - bx, sy - by)
    if slen:                                      # extend the axis to the given standard length (display px)
        k2 = slen * k / L; bx = sx + (bx - sx) * k2; by = sy + (by - sy) * k2; L = slen * k
    s = SLPX / L
    # angle of tail->snout vector; rotate so it points +x
    ang = math.degrees(math.atan2(sy - by, sx - bx))
    big = im.resize((int(im.width * s), int(im.height * s)), Image.LANCZOS)
    cx, cy = (sx + bx) / 2 * s, (sy + by) / 2 * s
    rot = big.rotate(ang, center=(cx, cy), resample=Image.BICUBIC, expand=False, fillcolor=(255, 255, 255))
    # snout ends up at (cx + SLPX/2, cy), base at (cx - SLPX/2, cy)
    W = int(SLPX * (1 + pad_tail + pad_head)); H = int(SLPX * half_h * 2)
    x0 = cx - SLPX / 2 - SLPX * pad_tail; y0 = cy - H / 2
    out = Image.new("RGB", (W, H), (255, 255, 255))
    canvas = Image.new("RGB", (rot.width + 2 * W, rot.height + 2 * H), (255, 255, 255)); canvas.paste(rot, (W, H))
    out.paste(canvas.crop((int(x0) + W, int(y0) + H, int(x0) + 2 * W, int(y0) + 2 * H)), (0, 0))
    return out, (int(SLPX * pad_tail), H // 2)   # pixel of the caudal base (axis origin)


def grid(img, origin):
    d = ImageDraw.Draw(img)
    F = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 13)
    ox, oy = origin
    for i in range(-8, 22):
        x = ox + i * SLPX * 0.05
        c = (255, 0, 0) if i % 2 == 0 else (255, 210, 0)
        d.line([(x, 0), (x, img.height)], fill=c)
        if i % 2 == 0: d.text((x + 2, 2), "%.1f" % (1 - i * 0.05), fill=(255, 0, 0), font=F)   # distance from snout in SL
    for j in range(-14, 15):
        y = oy + j * SLPX * 0.025
        c = (0, 90, 255) if j == 0 else ((255, 0, 0) if j % 2 == 0 else (255, 210, 0))
        d.line([(0, y), (img.width, y)], fill=c)
        if j % 2 == 0: d.text((2, y + 1), "%+.2f" % (-j * 0.025), fill=(255, 0, 0), font=F)
    return img


if __name__ == "__main__":
    repo = sys.argv[1]
    out = os.path.join(repo, "art/lake/work/trace")
    os.makedirs(out, exist_ok=True)
    for k in (sys.argv[3:] or REFS):
        im, o = normalized(repo, k)
        im.save(os.path.join(out, "norm_%s.jpg" % k), quality=88)
        if len(sys.argv) > 2 and sys.argv[2] == "grid":
            grid(im, o).save(os.path.join(out, "grid_%s.jpg" % k), quality=88)
    print("ok")
