"""fish_photo.py - v2 (lake v2, 2026-11-16): the fish wear their REAL photos.

The reference side photos (ref_normalize.py: snout + caudal base registered, SL = SLPX px) ARE the space the shapes were traced in
(fishspec.py: x from the snout, y up from the snout-caudal axis), so a body vertex at (x, Y) is projected straight onto its photo:
the flank, the head, the eye and the median fins (D / A / C, which lie in the mid plane) get the photo's own pixels. The eel's photo
is curled, so its cell is painted in the same projection from its colour ramp.

   python art/lake/tools/fish_photo.py <repo> <outDir>
   -> fish_photo.jpg   3072x1056 colour (4x3 cells of 768x352; cell i = FS.ORDER[i]); body + eye (photo, filled outside the fish)
      fish_photo_fin.jpg 1536x528  median fins: the photo's ray detail on the species' fin colour (the photos' see-through background
                       - aquarium blue, gravel - is taken out); same layout at half size
      fish_photo_n.jpg 1536x528   tangent-space normal map (scales / plates / gill edge from the photo's high-pass detail)
Cell pixel of an SL point: cx = (PAD_TAIL + 1 - x) * S, cy = CH / 2 - Y * S. Swatches at the cell's bottom-left: [0,16) mouth cavity,
[16,32) lips / barbels."""
import os, sys, math
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fishspec as FS
try:            # the image side (PIL / scipy); Blender's Python only needs the layout below
    from PIL import Image, ImageDraw, ImageFilter
    from scipy.ndimage import gaussian_filter
    import ref_normalize as RN
    import fish_paint as FP
except ImportError:
    pass

S = 512                 # px per SL unit in the atlas
PAD_TAIL, PAD_HEAD, HALF_H = 0.42, 0.06, 0.34
CW, CH = 768, 352
AW, AH = CW * 4, CH * 3
SW = 16                 # swatch size
# how much of a fin's colour comes from the painted fin tint (1) vs the photo (0): the photos' backgrounds show through the membranes
FIN_TINT = dict(crucian_carp=0.95, bluegill=0.95, minnow=0.45, prussian_carp=0.85, bass=1.0, carp=1.0, korean_bullhead=1.0,
                catfish=0.95, mirror_carp=0.55, snakehead=0.6, eel=1.0)
# how much of the photo's fine detail (the rays) the painted fin colour keeps: low where the photo's background is busy
FIN_DETAIL = dict(bass=0.35, carp=0.3, korean_bullhead=0.35, bluegill=0.6)
# fin colour lift (hotfix 2026-11-17): a real fin glows a little with the light through it; the darkest painted ones went black
FIN_LIGHT = dict(carp=1.15, mirror_carp=1.15, catfish=1.4, korean_bullhead=1.3, snakehead=1.5, eel=1.4, bluegill=1.3, bass=1.2,
                 prussian_carp=1.05)
# how strongly the drawn scale pattern stands out (hotfix 2026-11-17): lower where the photo's own scales are already sharp
SCALE_RELIEF = dict(carp=0.6, crucian_carp=0.8, prussian_carp=0.8, bluegill=0.7, minnow=0.7, bass=0.6, snakehead=0.5)
EYE = 64                # the painted eye (fish_paint.paint_eye) at the cell's bottom-right: the eye domes wear it
# per-species colour grade of the photo (gain, saturation): the photos were shot under very different light
GRADE = dict(crucian_carp=(1.0, 1.0), bluegill=(0.95, 1.15), minnow=(1.0, 1.05), prussian_carp=(0.92, 1.0), bass=(1.0, 1.05),
             carp=(0.95, 1.0), korean_bullhead=(1.0, 1.0), catfish=(0.95, 1.0), mirror_carp=(0.9, 1.0), snakehead=(1.0, 1.0), eel=(1.0, 1.0))


def cell_origin(i):
    return (i % 4) * CW, (i // 4) * CH


def to_px(x, Y):
    return (PAD_TAIL + 1 - np.asarray(x)) * S, CH / 2 - np.asarray(Y) * S


def from_px(px, py):
    return PAD_TAIL + 1 - px / S, (CH / 2 - py) / S


def photo_cell(repo, key):
    im, _ = RN.normalized(repo, key, pad_tail=PAD_TAIL, pad_head=PAD_HEAD, half_h=HALF_H)
    k = S / RN.SLPX
    w, h = round(im.width * k), round(im.height * k)
    im = im.resize((w, h), Image.LANCZOS)
    cell = Image.new("RGB", (CW, CH), (128, 128, 128))
    cell.paste(im, (0, CH // 2 - h // 2))
    return np.asarray(cell, np.float32)


def body_mask(sp, shrink=0.10):
    """1 inside the traced body outline (shrunk toward its middle line), as a float CH x CW array."""
    py, px = np.mgrid[0:CH, 0:CW].astype(np.float64) + 0.5
    x, Y = from_px(px, py)
    inx = (x >= 0.004) & (x <= FS.X_END)
    xc = np.clip(x, 0, FS.X_END)
    top = FS.pchip(sp["TOP"], xc); bot = FS.pchip(sp["BOT"], xc)
    mid = 0.5 * (top + bot); hh = 0.5 * (top - bot) * (1 - shrink)
    return ((np.abs(Y - mid) <= hh) & inx).astype(np.float32)


def fin_polys(sp):
    out = []
    for f in sp["FINS"]:
        if f[0] in ("D", "A"):
            _, _, x0, x1, outline, _ = f
            prof = sp["TOP"] if f[0] == "D" else sp["BOT"]
            base = [(x, float(FS.pchip(prof, x))) for x in np.linspace(x1, x0, 12)]
            out.append(list(outline) + base)
        elif f[0] == "C":
            outline = f[2]
            tp = float(FS.pchip(sp["TOP"], 0.97)); bt = float(FS.pchip(sp["BOT"], 0.97))
            out.append([(0.95, tp)] + list(outline) + [(0.95, bt)])
    return out


def fin_mask(sp):
    im = Image.new("L", (CW, CH), 0)
    d = ImageDraw.Draw(im)
    for poly in fin_polys(sp):
        pts = [tuple(float(v) for v in to_px(x, y)) for x, y in poly]
        d.polygon(pts, fill=255)
    return np.asarray(im, np.float32) / 255.0


def drop_background(img, mask, fins):
    """Pixels of the mask's outer band that look like the photo's background (aquarium blue, gravel, grass, the white sheet) are
    taken out: the traced outline is a few pixels proud of the photo's fish here and there."""
    from scipy.ndimage import binary_dilation, binary_erosion
    out_zone = ~binary_dilation((mask > 0.5) | (fins > 0.5), iterations=6)
    bg = img[out_zone]
    if len(bg) < 50:
        return mask
    # a few background colours (k-means-ish: the quantiles of a coarse colour grid)
    q = (bg // 24).astype(np.int32)
    keys, counts = np.unique(q[:, 0] * 4096 + q[:, 1] * 64 + q[:, 2], return_counts=True)
    top = keys[np.argsort(-counts)[:24]]
    cols = np.stack([top // 4096, (top // 64) % 64, top % 64], -1).astype(np.float32) * 24 + 12
    band = (mask > 0.5) & ~binary_erosion(mask > 0.5, iterations=14)
    bi = np.nonzero(band)
    d = np.min(np.linalg.norm(img[bi][:, None, :] - cols[None], axis=-1), axis=-1)
    bad = np.zeros_like(band)
    bad[bi] = d < 44
    bad = binary_dilation(bad, iterations=2) & band
    return np.where(bad, 0.0, mask).astype(np.float32)


BLUE_BG = {"crucian_carp", "catfish", "mirror_carp"}


def find_eye(photo, sp):
    """The photo's own eye (its dark pupil) near the traced EYE: the model's eye dome is put there (eyes.json) so the photo's eye
    is the dome's texture — the traced eye is off by a few pixels on some photos (two eyes otherwise)."""
    ex, ey, er = sp["EYE"]
    cx, cy = to_px(ex, ey)
    R = int(2.2 * er * S)
    x0, x1 = int(max(0, cx - R)), int(min(CW, cx + R)); y0, y1 = int(max(0, cy - R)), int(min(CH, cy + R))
    lum = photo[y0:y1, x0:x1] @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    # the pupil: darker than its ring (a difference of blurs), near the traced eye (a bowl)
    lb = blur(lum, max(1.0, 0.3 * er * S)) - blur(lum, max(2.0, 1.1 * er * S))
    yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float64)
    score = lb + 40.0 * ((xx - cx) ** 2 + (yy - cy) ** 2) / (R * R)
    j, i = np.unravel_index(np.argmin(score), score.shape)
    px, py = x0 + i + 0.5, y0 + j + 0.5
    x, Y = from_px(px, py)
    return float(x), float(Y)


def fill_outside(img, mask, levels=7):
    """Push the colours inside `mask` outward (pyramid of normalized blurs): background pixels take the nearest fish colour."""
    out = img.copy()
    have = mask.copy()
    num = img * mask[..., None]
    for lv in range(levels):
        r = 2 ** lv
        nb = blur(num, r)
        mb = blur(mask, r)
        est = nb / np.maximum(mb, 1e-4)[..., None]
        take = (have < 0.5) & (mb > 1e-3)
        out[take] = est[take]
        have = np.maximum(have, take.astype(np.float32))
    return out


def grade(img, key):
    g, s = GRADE[key]
    lum = (img @ np.array([0.2126, 0.7152, 0.0722], np.float32))[..., None]
    return np.clip((lum + (img - lum) * s) * g, 0, 255)


def blur(a, r):
    if a.ndim == 3:
        return np.stack([blur(a[..., c], r) for c in range(a.shape[2])], -1)
    return gaussian_filter(a.astype(np.float32), r)


def painted_eel(sp, seed=7):
    """The eel in projection space: its ramp by height on the flank, mottling, the lateral line."""
    py, px = np.mgrid[0:CH, 0:CW].astype(np.float64) + 0.5
    x, Y = from_px(px, py)
    xc = np.clip(x, 0, FS.X_END)
    top = FS.pchip(sp["TOP"], xc); bot = FS.pchip(sp["BOT"], xc)
    yn = np.clip((Y - bot) / np.maximum(top - bot, 1e-6), 0, 1)
    col = FP.ramp([(0, "#1a1d10"), (0.45, "#2c3119"), (0.6, "#4e4f2a"), (0.78, "#a49c5e"), (1, "#ddd4a2")], 1 - yn)
    n1 = FP.noise(CW, CH, 18, seed); n2 = FP.noise(CW, CH, 4, seed + 1)
    col *= (0.9 + 0.2 * n1[..., None]) * (0.96 + 0.08 * n2[..., None])
    ll = FS.pchip(sp["LL"], xc)
    m = np.exp(-(((Y - ll) / 0.0012) ** 2)) * (xc > 0.12)
    col = FP.mix(col, m, "#2a2a18", 0.3)
    return col.astype(np.float32)


def normal_from(img, strength=2.2):
    lum = img @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    hp = lum - blur(lum, 5)
    hp = blur(hp, 0.8)
    gx = np.zeros_like(hp); gy = np.zeros_like(hp)
    gx[:, 1:-1] = (hp[:, 2:] - hp[:, :-2]) * 0.5
    gy[1:-1, :] = (hp[2:, :] - hp[:-2, :]) * 0.5
    k = strength / 255.0 * 8
    # bright = raised: n = (-dh/dx, +dh/dy (image y down -> tangent v up), 1)
    n = np.stack([-gx * k, gy * k, np.ones_like(hp)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return (n * 0.5 + 0.5) * 255


# ---- v2 fins: thin see-through membranes with rays ------------------------------------------------------------------
# Every fin (median and paired) uses the ray-band layout of fish_paint (24 rays across u, base at t = 0, tip at t = 1). Painted
# here because the colour comes from the photo: the median of the photo's pixels inside the species' own median fins (their
# inner half, away from the background showing through), mixed with the hand-tuned fin colours by FIN_TINT.
#   membrane: lighter, more see-through toward the edge; rays: darker, segmented (joints), branching near the tip; the edge:
#   soft and a little frayed; spiny fins: the membrane notched between the spines.
def fin_colours(photo, sp, key):
    if photo is None:
        return None
    fm = fin_mask(sp)
    inner = gaussian_filter(fm, 3) > 0.85
    px = photo[inner]
    if len(px) < 40:
        return None
    return np.median(px, axis=0)


def noise1(n, seed, scale):
    r = np.random.RandomState(seed)
    k = r.rand(int(n / scale) + 3)
    x = np.arange(n) / scale
    i = np.floor(x).astype(int)
    f = x - i
    f = f * f * (3 - 2 * f)
    return k[i] * (1 - f) + k[i + 1] * f


def paint_fin_v2(key, i, variant, photo_col):
    """v3 (owner 2026-11-18: "지느러미를 좀 더 사실적으로"): raised rays (the geometry has them too), a thin membrane between them
    that lets the light through (alpha 0.9 at the base .. 0.7 at the edge, the rays solid), joints and branching tips, a scalloped,
    frayed trailing edge, a stiff serrated leading spine on spiny fins, a fleshy base."""
    P = FP.PAINT[key]; FPv = P["fin"][variant]
    H, W = FP.FBH, FP.FCW
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    u = (x + 0.5) / W; t = 1 - (y + 0.5) / H
    base, tip = FP.hexc(FPv[0]), FP.hexc(FPv[1])
    ray_c = FP.hexc(FPv[2]) if len(FPv) > 2 else base * 0.6
    k = FIN_TINT[key]
    if photo_col is not None:
        base = base * k + photo_col * (1 - k)
        tip = tip * k + photo_col * 1.05 * (1 - k)
        ray_c = ray_c * k + photo_col * 0.6 * (1 - k)
    style = FPv[3] if len(FPv) > 3 else "soft"
    spine = style == "spine" or (len(FPv) > 4 and FPv[4])
    nr = FP.NRAY
    ph = (u * nr) % 1.0
    ri = np.floor(u * nr)
    sd = 300 + i * 3 + "ABC".index(variant)
    ray = np.exp(-(((ph - 0.5) / 0.1) ** 2))
    if style != "spiny":     # soft rays branch in two toward the tip
        br = np.clip((t - 0.45) / 0.3, 0, 1)
        sp2 = 0.17 * br
        ray = np.maximum(ray * (1 - br), np.maximum(np.exp(-(((ph - 0.5 + sp2) / 0.09) ** 2)), np.exp(-(((ph - 0.5 - sp2) / 0.09) ** 2))) * br)
    jn = np.random.RandomState(sd).rand(nr + 1)
    joints = 1 - 0.4 * ((np.sin(t * (44 + 7 * ((ri % 3) - 1)) + jn[ri.astype(int)] * 6) > 0.85) * (t > 0.18))
    per_ray = (0.93 + 0.14 * jn[ri.astype(int)])[..., ]                 # each ray a little lighter / darker than its neighbours
    mem = base[None, None, :] * (1 - t[..., None]) + tip[None, None, :] * t[..., None]
    mem = mem * (0.96 + 0.1 * t[..., None]) * per_ray[..., None]
    mem = mem * (1 + 0.22 * (t * (1 - ray))[..., None])                      # light through the thin membrane: lighter toward the edge
    col = mem * (1 - 0.34 * ray[..., None]) + ray_c[None, None, :] * 0.34 * ray[..., None] * joints[..., None]
    for fn in P.get("finmarks", {}).get(variant, []):
        col = fn(col, u, t, ri)
    # the edge: scalloped (the membrane ends a little before the ray tips) and frayed
    fr = noise1(W, sd, 6.0)[None, :]
    fr2 = noise1(W, sd + 99, 1.7)[None, :]
    notch = 1 - np.exp(-(((ph - 0.5) / 0.3) ** 2))
    edge = 0.94 + 0.04 * fr + 0.015 * fr2 - 0.05 * notch
    if style == "spiny":
        edge = edge - 0.2 * (1 - np.exp(-(((ph - 0.5) / 0.22) ** 2)))
    edge_r = np.minimum(edge + 0.05 + (0.03 if style == "spiny" else 0.0), 0.995)
    soft = lambda e: np.clip((e - t) / 0.06, 0, 1)
    a_mem = (0.95 - 0.17 * t) * soft(edge)
    a_ray = 0.99 * soft(edge_r)
    alpha = a_mem * (1 - ray) + a_ray * ray
    alpha = np.maximum(alpha, 0.97 * np.clip(1 - t / 0.1, 0, 1))     # the fleshy base is solid
    thick = np.zeros_like(t)
    if spine:     # the stiff leading spine: dark, thick, serrated on its trailing edge
        sp_m = (ri == 0).astype(np.float32)
        thick = np.exp(-(((ph - 0.5) / 0.3) ** 2)) * sp_m
        col = col * (1 - 0.55 * thick[..., None]) + FP.hexc("#2a2416") * 0.55 * thick[..., None]
        serr = ((np.sin(t * 150) > 0.35) & (ph > 0.5) & (ph < 0.85)).astype(np.float32) * sp_m
        col = col * (1 + 0.5 * serr[..., None])
        alpha = np.where((thick > 0.3) & (t < 0.995), np.maximum(alpha, 0.98), alpha)
    alpha = np.where(t > 0.997, 0.0, alpha)
    col = col * FIN_LIGHT.get(key, 1.0)
    height = ray * (0.75 + 0.25 * joints) + 0.6 * np.clip(1 - t / 0.12, 0, 1)
    if spine:
        height = np.maximum(height, 1.5 * thick)
    LAST_FIN_HEIGHT[0] = height
    return np.concatenate([np.clip(col, 0, 255), (np.clip(alpha, 0, 1) * 255)[..., None]], axis=2)


LAST_FIN_HEIGHT = [None]


def normal_from_height(h, k):
    gx = np.zeros_like(h); gy = np.zeros_like(h)
    gx[:, 1:-1] = (h[:, 2:] - h[:, :-2]) * 0.5
    gy[1:-1, :] = (h[2:, :] - h[:-2, :]) * 0.5
    n = np.stack([-gx * k, gy * k, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return (n * 0.5 + 0.5) * 255


def scale_height(sp):
    """hotfix 2026-11-17 (owner: "입체적으로 실감나게"): overlapping (imbricate) scales in the cell's photo projection, for the
    normal map — SCALES = (along the lateral line, rows); the anterior scale lies over the one behind it, so the visible part of each
    is its rounded posterior margin. 0 outside the body and on scaleless species."""
    if not sp.get("SCALES"):
        return np.zeros((CH, CW), np.float32)
    n_along, rows = sp["SCALES"]
    p = S / n_along                                     # px between scale columns (SL = S px)
    top = FS.pchip(sp["TOP"], 0.45); bot = FS.pchip(sp["BOT"], 0.45)
    rp = max(p * 0.7, (top - bot) * S / rows)           # px between rows
    r = 0.72 * max(p, rp)
    py, px = np.mgrid[0:CH, 0:CW].astype(np.float64) + 0.5
    col = np.floor(px / p)
    h = np.zeros((CH, CW)); done = np.zeros((CH, CW), bool)
    for dc in (1, 0, -1):                              # the anterior one (the snout is toward +px) first: it lies on top
        c = col + dc
        off = np.where(c % 2 == 1, 0.5 * rp, 0.0)
        cx = (c + 0.5) * p
        for dr in (0, 1, -1):
            ry = np.round((py - off) / rp) + dr
            cy = ry * rp + off
            d = np.hypot(px - cx, py - cy) / r
            cov = (d < 1) & ~done
            # the exposed margin: a dome that rises toward its posterior (tail-side, -px) rim and steps down at the rim
            post = np.clip((cx - px) / r, -1, 1)
            h = np.where(cov, (1 - d ** 2) * 0.55 + 0.45 * np.clip(post, 0, 1), h)
            done |= cov
    m = gaussian_filter(body_mask(sp, shrink=0.04), 2.0)
    return (gaussian_filter(h, 0.7) * m).astype(np.float32)


def paint_fins_v2(repo, out, photos):
    fins = np.zeros((FP.FIN_H, FP.FIN_W, 4), np.float32)
    height = np.zeros((FP.FIN_H, FP.FIN_W), np.float32)
    for i, key in enumerate(FS.ORDER):
        pc = photos.get(key)
        for v in "ABC":
            fx, fy = FP.fin_origin(i, v)
            fins[fy:fy + FP.FBH, fx:fx + FP.FCW] = paint_fin_v2(key, i, v, pc)
            height[fy:fy + FP.FBH, fx:fx + FP.FCW] = LAST_FIN_HEIGHT[0]
    Image.fromarray(np.clip(fins, 0, 255).astype(np.uint8), "RGBA").save(os.path.join(out, "fish_fins.png"), optimize=True)
    # the fins' normal map (hotfix 2026-11-17): the rays catch the light like real ones
    nrm = normal_from_height(gaussian_filter(height, 0.8), 2.2)
    Image.fromarray(np.clip(nrm, 0, 255).astype(np.uint8)).save(os.path.join(out, "fish_fins_n.png"), optimize=True)


def main():
    repo = os.path.abspath(sys.argv[1]); out = sys.argv[2]
    os.makedirs(out, exist_ok=True)
    atlas = np.zeros((AH, AW, 3), np.float32) + 110
    eyes = {}
    fin_cols = {}
    fins = np.zeros((AH, AW, 3), np.float32) + 110
    for i, key in enumerate(FS.ORDER):
        sp = FS.SPECIES[key]; P = FP.PAINT[key]
        ox, oy = cell_origin(i)
        if key == "eel":
            body = painted_eel(sp)
            photo = body
        else:
            photo = grade(photo_cell(repo, key), key)
            bm = drop_background(photo, body_mask(sp), fin_mask(sp))
            if key in BLUE_BG:   # the aquarium's blue where the outline is proud of the fish
                r_, g_, b_ = photo[..., 0], photo[..., 1], photo[..., 2]
                blue = (b_ > r_ + 35) & (b_ > g_ + 15)
                bm = np.where(blue, 0.0, bm).astype(np.float32)
            body = fill_outside(photo, bm)
            eyes[key] = find_eye(photo, sp)
            fin_cols[key] = fin_colours(photo, sp, key)
        # fins: photo ray detail on the painted fin colour, blended by how clean the photo's fins are
        fm = fin_mask(sp)
        fin_photo = fill_outside(photo, fm)
        lum = fin_photo @ np.array([0.2126, 0.7152, 0.0722], np.float32)
        detail = np.clip(lum / np.maximum(blur(lum, 6), 1), 0.55, 1.5)[..., None]
        detail = 1 + (detail - 1) * FIN_DETAIL.get(key, 1.0)
        tint_b = FP.hexc(P["fin"]["B"][0]); tint_tip = FP.hexc(P["fin"]["B"][1])
        tint = tint_b * 0.6 + tint_tip * 0.4
        k = FIN_TINT[key]
        fin = fin_photo * (1 - k) + tint[None, None, :] * detail * k
        # swatches: the mouth cavity and the lips / barbels
        body[CH - SW:CH, 0:SW] = FP.hexc("#2a1414")
        body[CH - SW:CH, SW:2 * SW] = FP.hexc(P.get("lip", "#b0a080"))
        body[CH - EYE - 2:CH - 2, CW - EYE - 2:CW - 2] = FP.paint_eye(P)
        atlas[oy:oy + CH, ox:ox + CW] = body
        fins[oy:oy + CH, ox:ox + CW] = fin
    Image.fromarray(np.clip(atlas, 0, 255).astype(np.uint8)).save(os.path.join(out, "fish_photo.jpg"), quality=82, optimize=True)
    import json
    json.dump(eyes, open(os.path.join(out, "eyes.json"), "w"), indent=1)
    print("eyes (photo vs traced)", {k: (round(v[0], 3), round(v[1], 3), FS.SPECIES[k]["EYE"][:2]) for k, v in eyes.items()})
    half = (AW // 2, AH // 2)
    Image.fromarray(np.clip(fins, 0, 255).astype(np.uint8)).resize(half, Image.LANCZOS).save(os.path.join(out, "fish_photo_fin.jpg"), quality=80, optimize=True)
    paint_fins_v2(repo, out, fin_cols)
    # the normal map: the photo's own fine detail plus (hotfix 2026-11-17) the scale pattern, at full size (the scales are ~10-18 px)
    lum = atlas @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    hp = blur(lum - blur(lum, 5), 0.8) / 255.0 * 2.2   # the old normal_from(strength 2.2)
    sc = np.zeros_like(hp)
    for i, key in enumerate(FS.ORDER):
        ox, oy = cell_origin(i)
        sc[oy:oy + CH, ox:ox + CW] = scale_height(FS.SPECIES[key]) * SCALE_RELIEF.get(key, 1.0)
    nrm = normal_from_height(hp + sc * 0.11, 8.0)
    q34 = (AW * 3 // 4, AH * 3 // 4)   # 3/4 size: the scales stay 8-13 px, the file (WebP in the GLB) stays in budget
    Image.fromarray(np.clip(nrm, 0, 255).astype(np.uint8)).resize(q34, Image.LANCZOS).save(os.path.join(out, "fish_photo_n.jpg"), quality=88, optimize=True)
    print("ok", out)


if __name__ == "__main__":
    main()
