"""Stained glass from public-domain (CC0) museum photographs -> game textures + light-transmission maps.

    python -I make_glass.py <src_dir> <out_dir>

For every window in WINDOWS: compose the panel (photo, optionally set into a grisaille field), mask it to a lancet
(pointed arch) or a rose, find the lead came in the photo (thin dark lines) and add the window's own came grid,
then write
  <id>_color.png     sRGB, the glass as seen from inside against daylight (cleaned, brand-new, came = dark lead)
  <id>_normal.png    tangent normal: rounded lead came + the slight ripple of hand-blown glass
  <id>_orm.png       R = 1, G = roughness (glass 0.06, came 0.55), B = metal (came 0.35)
  <id>_mask.png      1 = glass/came inside the opening, 0 = outside (the stone frame / wall)
  <id>_transmit.png  linear RGB transmittance for the lightmap bake (L6): coloured light pools on floor and pews
No AI and no generated imagery: every coloured texel comes from the museum photograph.
"""
import sys, os, json, math
import numpy as np
from PIL import Image, ImageFilter, ImageEnhance, ImageDraw
from scipy import ndimage as ndi

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)


def load(name):
    return Image.open(os.path.join(SRC, name)).convert("RGB")


def crop_frac(im, box):
    w, h = im.size
    return im.crop((int(box[0] * w), int(box[1] * h), int(box[2] * w), int(box[3] * h)))


def cover(im, W, H):
    """scale + centre-crop to exactly W x H"""
    s = max(W / im.size[0], H / im.size[1])
    im = im.resize((max(W, round(im.size[0] * s)), max(H, round(im.size[1] * s))), Image.LANCZOS)
    x = (im.size[0] - W) // 2; y = (im.size[1] - H) // 2
    return im.crop((x, y, x + W, y + H))


def lancet_mask(W, H, spring=None):
    """pointed (equilateral) arch on top of a rectangle"""
    m = Image.new("L", (W, H), 0); d = ImageDraw.Draw(m)
    r = W  # equilateral arch: centres at the opposite jamb
    spring = spring if spring is not None else int(W * 0.866)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    a = np.zeros((H, W), bool)
    a[spring:, :] = True
    top = yy < spring
    c1 = (xx - 0) ** 2 + (yy - spring) ** 2 <= r * r
    c2 = (xx - (W - 1)) ** 2 + (yy - spring) ** 2 <= r * r
    a |= top & c1 & c2
    return a


def clean(im, sat=1.12, contrast=1.06, bright=1.0):
    """brand-new glass: lift the museum photo a little (no grime look), keep its real colours"""
    im = ImageEnhance.Color(im).enhance(sat)
    im = ImageEnhance.Contrast(im).enhance(contrast)
    im = ImageEnhance.Brightness(im).enhance(bright)
    return im.filter(ImageFilter.UnsharpMask(radius=2, percent=40, threshold=3))


def came_from_photo(rgb, line_px):
    """lead lines = locally dark, thin structures"""
    lum = rgb.astype(np.float32).mean(2) / 255.0
    local = ndi.uniform_filter(lum, size=line_px * 9)
    dark = (lum < 0.16) | (lum < local * 0.42)
    dark = ndi.binary_opening(dark, iterations=1)
    # keep thin connected networks, drop isolated specks (painted detail stays as paint)
    lab, n = ndi.label(dark)
    sizes = ndi.sum(dark, lab, range(1, n + 1))
    keep = np.zeros(n + 1, bool); keep[1:] = sizes > (line_px * 40)
    return keep[lab]


def grid_came(W, H, rows, line_px):
    g = np.zeros((H, W), bool)
    for k in range(1, rows):
        y = int(H * k / rows); g[max(0, y - line_px):y + line_px, :] = True
    return g


def finish(win_id, rgb, mask, came, px_per_m, meta):
    H, W = mask.shape
    lw = max(2, int(0.011 * px_per_m))  # lead came ~ 11 mm face
    # outer came along the opening edge
    edge = mask & ~ndi.binary_erosion(mask, iterations=lw)
    came = (came | edge) & mask
    came = ndi.binary_dilation(came, iterations=max(0, lw // 3))
    # colour: glass from the photo, came = dark grey lead
    col = rgb.astype(np.float32) / 255.0
    lead = np.array([0.10, 0.10, 0.11], np.float32)
    col[came] = lead
    col[~mask] = 0.0
    # normal: rounded came profile from the distance transform, + soft glass ripple
    dist = ndi.distance_transform_edt(came).astype(np.float32)
    h_came = np.clip(dist / max(1.0, lw * 0.9), 0, 1)
    h_came = np.sin(h_came * math.pi / 2) * 1.0
    rng = np.random.default_rng(7)
    ripple = ndi.gaussian_filter(rng.standard_normal((H, W)).astype(np.float32), 6) * 6.0
    hgt = h_came * 2.2 + ripple * 0.06 * (~came)
    gy, gx = np.gradient(hgt)
    nx, ny, nz = -gx, gy, np.ones_like(gx)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz); nrm = np.stack([nx / ln, ny / ln, nz / ln], -1) * 0.5 + 0.5
    nrm[~mask] = (0.5, 0.5, 1.0)
    orm = np.zeros((H, W, 3), np.float32); orm[..., 0] = 1.0
    orm[..., 1] = np.where(came, 0.55, 0.06); orm[..., 2] = np.where(came, 0.35, 0.0)
    # transmittance (linear): the glass colour; painted shading darkens; came and frame block
    lin = np.where(col <= 0.04045, col / 12.92, ((col + 0.055) / 1.055) ** 2.4)
    tr = lin * mask[..., None] * (~came)[..., None]
    tr = tr / max(1e-6, np.percentile(tr[mask & ~came], 99)) * 0.9
    tr = np.clip(tr, 0, 1)

    def save(a, name, mode="RGB"):
        Image.fromarray(np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8), mode).save(os.path.join(OUT, f"{win_id}_{name}.png"))

    save(col, "color"); save(nrm, "normal"); save(orm, "orm")
    save(mask.astype(np.float32), "mask", "L")
    t_small = Image.fromarray(np.clip(tr * 255 + 0.5, 0, 255).astype(np.uint8)).resize((W // 4, H // 4), Image.LANCZOS)
    t_small.save(os.path.join(OUT, f"{win_id}_transmit.png"))
    meta.update({"id": win_id, "px": [W, H], "px_per_m": px_per_m, "came_pct": round(100 * float(came[mask].mean()), 1),
                 "mean_transmit": [round(float(x), 3) for x in tr[mask].mean(0)]})
    return meta


# ---------------- windows ----------------
LANCET_W, LANCET_H = 1.0, 2.6          # metres (game opening; builders scale uniformly)
PX = 1024 / LANCET_W                  # 1024 x 2662 -> stored 1024 x 2560 after the arch fit (power-of-two height below)
W, H = 1024, 2662
WINDOWS = []


def lancet_from(win_id, name, box, rows=6, field=None, field_box=None, inset=None, sat=1.12, bright=1.0, src_meta=None):
    im = clean(crop_frac(load(name), box), sat=sat, bright=bright)
    if inset:  # figurative panel set into a grisaille field (as real windows combine them)
        fld = clean(crop_frac(load(field), field_box), sat=1.0, bright=1.05)
        tile = cover(fld, W, int(W * fld.size[1] / fld.size[0]))
        canvas = Image.new("RGB", (W, H))
        for y in range(0, H, tile.size[1]): canvas.paste(tile, (0, y))
        pw = int(W * inset[2]); ph = int(pw * im.size[1] / im.size[0])
        canvas.paste(im.resize((pw, ph), Image.LANCZOS), (int(W * inset[0]), int(H * inset[1])))
        im = canvas
    else:
        im = cover(im, W, H)
    rgb = np.asarray(im)
    mask = lancet_mask(W, H)
    came = came_from_photo(rgb, 3) | grid_came(W, H, rows, 2)
    WINDOWS.append(finish(win_id, rgb, mask, came, PX, {"kind": "lancet", "size_m": [LANCET_W, LANCET_H], "source": src_meta}))


lancet_from("glass_lancet_virgin", "met_467933.jpg", (0.035, 0.015, 0.965, 0.985), rows=6,
            src_meta="Met 1987.? / objectID 467933, Stained Glass Panel with the Virgin and Child, 1430-35, CC0")
# (Saint Roch panel 463582 dropped: its banner carries the saint's name, and names are not allowed)
lancet_from("glass_lancet_nativity", "met_463649.jpg", (0.03, 0.02, 0.97, 0.98), rows=6, field="met_470299.jpg",
            field_box=(0.02, 0.02, 0.98, 0.98), inset=(0.04, 0.30, 0.92),
            src_meta="Met objectID 463649 Nativity (15th c.) set in Met objectID 470299 grisaille (ca. 1320-30), both CC0")
lancet_from("glass_lancet_assumption", "met_198995.jpg", (0.02, 0.01, 0.98, 0.99), rows=6, field="met_470299.jpg",
            field_box=(0.02, 0.02, 0.98, 0.98), inset=(0.04, 0.27, 0.92),
            src_meta="Met objectID 198995 Assumption of the Virgin (ca. 1505-10) set in Met objectID 470299 grisaille, both CC0")


# ---------------- rose window ----------------
def rose(win_id, D=2048):
    R = D / 2; cx = cy = R
    yy, xx = np.mgrid[0:D, 0:D].astype(np.float32)
    r = np.hypot(xx - cx, yy - cy); th = (np.arctan2(yy - cy, xx - cx) + 2 * np.pi) % (2 * np.pi)
    mask = r < R * 0.985
    canvas = np.zeros((D, D, 3), np.float32)
    # field: deep blue + red ground glass sampled from the photographs' backgrounds (real glass colour), mottled
    virgin = clean(load("met_467933.jpg"), sat=1.15)
    nat = clean(load("met_463649.jpg"), sat=1.15)
    blue = np.asarray(cover(crop_frac(nat, (0.50, 0.62, 0.62, 0.80)), 64, 64)).reshape(-1, 3).mean(0) / 255  # Mary's robe glass
    blue = np.array([0.10, 0.22, 0.66])  # cobalt ground (matched by eye to the robe glass of 463649; the photo crop was mixed with paint)
    red = np.array([0.62, 0.10, 0.08])
    gold = np.asarray(cover(crop_frac(nat, (0.06, 0.02, 0.30, 0.20)), 64, 64)).reshape(-1, 3).mean(0) / 255
    rng = np.random.default_rng(3)
    mott = ndi.gaussian_filter(rng.standard_normal((D, D)).astype(np.float32), 9) * 1.8 + 1
    canvas[:] = blue[None, None, :] * np.clip(mott, 0.75, 1.2)[..., None]
    # centre: the Virgin and Child (head and shoulders) in a roundel
    c_r = R * 0.30
    head = cover(crop_frac(virgin, (0.12, 0.06, 0.88, 0.48)), int(2 * c_r), int(2 * c_r))
    hx = int(cx - c_r); hy = int(cy - c_r); ha = np.asarray(head).astype(np.float32) / 255
    sub = (slice(hy, hy + ha.shape[0]), slice(hx, hx + ha.shape[1]))
    inner = (r[sub] < c_r)
    canvas[sub][inner] = ha[inner]
    # 12 petals: figures and angels from the composite English window and the Assumption, alternating
    comp = clean(load("met_463580.jpg"), sat=1.12)
    assum = clean(load("met_198995.jpg"), sat=1.12)
    cols = [0.035, 0.225, 0.415, 0.605, 0.79]
    A = [crop_frac(assum, b) for b in [(0.02, 0.05, 0.36, 0.40), (0.62, 0.05, 0.98, 0.40), (0.0, 0.42, 0.40, 0.80),
                                         (0.60, 0.42, 1.0, 0.80), (0.30, 0.0, 0.70, 0.45), (0.30, 0.45, 0.70, 0.95)]]
    N = [crop_frac(nat, b) for b in [(0.0, 0.0, 0.35, 0.35), (0.62, 0.15, 1.0, 0.55), (0.30, 0.25, 0.70, 0.75)]]
    C = [crop_frac(comp, (cols[k], 0.17, cols[k] + 0.17, 0.42)) for k in (1, 2, 3)]
    figs = [A[0], N[0], A[1], C[0], A[2], N[1], A[3], C[1], A[4], N[2], A[5], C[2]]
    p_r0, p_r1 = R * 0.36, R * 0.80
    petal_w = 2 * np.pi / 12
    for k in range(12):
        a0 = k * petal_w - np.pi / 2
        a_c = a0 + petal_w / 2
        pcx = cx + math.cos(a_c) * (p_r0 + p_r1) / 2; pcy = cy + math.sin(a_c) * (p_r0 + p_r1) / 2
        prad = (p_r1 - p_r0) / 2 * 0.98
        tile = cover(figs[k % len(figs)], int(prad * 1.7), int(prad * 2.5))
        tile = tile.rotate(-math.degrees(a_c + np.pi / 2), expand=True, resample=Image.BICUBIC)
        ta = np.asarray(tile).astype(np.float32) / 255
        tx = int(pcx - ta.shape[1] / 2); ty = int(pcy - ta.shape[0] / 2)
        # petal shape: lancet-ish lobe between the radii, narrower than the sector
        d_ang = np.abs(((th - a_c + np.pi) % (2 * np.pi)) - np.pi)
        lobe = (r > p_r0) & (r < p_r1) & (d_ang * r < (prad * 0.62) * np.sin(np.clip((r - p_r0) / (p_r1 - p_r0), 0, 1) * np.pi) ** 0.35)
        ys, xs = np.nonzero(lobe)
        sel = (ys >= ty) & (ys < ty + ta.shape[0]) & (xs >= tx) & (xs < tx + ta.shape[1])
        ys, xs = ys[sel], xs[sel]
        canvas[ys, xs] = ta[ys - ty, xs - tx]
    # outer ring: 24 small roundels alternating red and gold glass
    o_r = R * 0.905; s_r = R * 0.065
    for k in range(24):
        a = k * 2 * np.pi / 24
        dx = xx - (cx + math.cos(a) * o_r); dy = yy - (cy + math.sin(a) * o_r)
        m = dx * dx + dy * dy < s_r * s_r
        canvas[m] = (red if k % 2 else np.clip(gold / max(1e-3, gold.max()) * 0.95, 0, 1)) * np.clip(mott[m], 0.8, 1.15)[:, None]
    rgb = np.clip(canvas * 255, 0, 255).astype(np.uint8)
    # came: photo lead lines inside the figures + the tracery outlines (stone tracery itself is the 3D mesh)
    came = came_from_photo(rgb, 3)
    ring = lambda rad, w: np.abs(r - rad) < w
    lw = 3
    came |= ring(c_r, lw) | ring(p_r0, lw) | ring(p_r1, lw) | ring(R * 0.84, lw)
    for k in range(24):
        a = k * 2 * np.pi / 24
        came |= np.abs(np.hypot(xx - (cx + math.cos(a) * o_r), yy - (cy + math.sin(a) * o_r)) - s_r) < lw
    for k in range(12):
        a = k * petal_w - np.pi / 2
        d_line = np.abs((xx - cx) * math.sin(a) - (yy - cy) * math.cos(a))
        came |= (d_line < lw) & (r > p_r0) & (r < p_r1) & (((xx - cx) * math.cos(a) + (yy - cy) * math.sin(a)) > 0)
    WINDOWS.append(finish(win_id, rgb, mask, came, D / 2.4, {"kind": "rose", "size_m": [2.4, 2.4],
                    "source": "Met CC0: 467933 Virgin and Child (centre), 463580 Composite Window of English Stained Glass and 198995 Assumption (petals), ground colours sampled from 467933/463649"}))


rose("glass_rose")


# ---------------- church: clear / simple glass, no figures ----------------
def church_simple(win_id):
    w2, h2 = 1024, 2662
    g = clean(load("met_470299.jpg"), sat=0.55, bright=1.12)  # grisaille quarries, desaturated to near-clear
    tile = cover(crop_frac(g, (0.05, 0.05, 0.95, 0.95)), w2, int(w2 * 0.87))
    canvas = Image.new("RGB", (w2, h2))
    for y in range(0, h2, tile.size[1]): canvas.paste(tile, (0, y))
    rgb = np.asarray(canvas).astype(np.float32)
    rgb = rgb * 0.75 + 255 * 0.25 * np.array([0.98, 0.97, 0.92])  # mostly clear, faintly warm
    # a thin border of amber and soft blue (a common plain-glass chapel border)
    m = lancet_mask(w2, h2)
    inner = ndi.binary_erosion(m, iterations=60)
    band = m & ~inner
    yy = np.arange(h2)[:, None].repeat(w2, 1)
    amber = np.array([214, 160, 70.0]); sky = np.array([120, 160, 205.0])
    rgb[band] = np.where(((yy[band] // 120) % 2 == 0)[:, None], amber, sky)
    rgb = np.clip(rgb, 0, 255).astype(np.uint8)
    came = came_from_photo(rgb, 3) | (np.abs(ndi.distance_transform_edt(m) - 60) < 2)
    WINDOWS.append(finish(win_id, rgb, m, came, w2 / 1.0, {"kind": "lancet", "size_m": [1.0, 2.6],
                    "source": "Met objectID 470299 Window with Grisaille Decoration (ca. 1320-30), CC0, desaturated to near-clear + plain amber/blue border"}))


church_simple("glass_church_clear")
json.dump(WINDOWS, open(os.path.join(OUT, "glass.json"), "w"), indent=1)
print(json.dumps(WINDOWS, indent=1))
