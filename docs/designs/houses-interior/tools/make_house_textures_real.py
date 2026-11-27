"""Photo-real albedo textures for the house interiors (realism pass 2026-11-17; system Python: numpy + PIL).

  python art/village/tools/houses/make_house_textures_real.py [--only id,id]

Sources: CC0 photo-scanned PBR sets (Poly Haven, ambientCG) in art/village/downloads/tex_real/<ph_slug | acg_Id>/ (downloaded by
`--fetch`; licences + URLs in docs/designs/houses-interior/textures-real.md). The game draws the houses UNLIT (KHR_materials_unlit +
the baked light map), so a normal or roughness map would do nothing at run time: the relief is baked INTO the albedo instead —
albedo x (1 + s * (N.L / Nflat.L - 1)) x mix(1, AO, a), a light from the upper left — which gives planks their gaps, fabric its weave,
stone its joints, under any light map.

Every texture is built at its real-world size P (m): the source is tiled a whole number of times (its own scanned size) and resampled.
P = the metres per repeat the kit gives that material (floors 2.4, walls 2.5, furniture ~0.5..1). Colour: the source's detail, the
mean of the old (art-directed) texture, so the kit's vertex tints still give the colours the houses were designed with.

Writes:
  art/village/work/tex_h/T_h_<id>.png          authoring (Blender renders; the light bake ignores colour), the hi size
  art/village/work/tex_h/small/T_h_<id>.png    128 px, embedded in the GLB (what shows for the moment before the shared file is in)
  client/public/textures/houses/hi/T_h_<id>.webp   shared by all ten houses (PC)        hi px
  client/public/textures/houses/lo/T_h_<id>.webp   (phone)                               hi / 2 px
The old textures are kept in work/tex_h_orig (the first run copies them).
"""
import json
import os
import shutil
import sys
import urllib.request
import zipfile

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))                       # art/village
REPO = os.path.dirname(os.path.dirname(ROOT))
DL = os.path.join(ROOT, "downloads", "tex_real")
TEXH = os.path.join(ROOT, "work", "tex_h")
ORIG = os.path.join(ROOT, "work", "tex_h_orig")
SMALL = os.path.join(TEXH, "small")
CLIENT = os.path.join(REPO, "client", "public", "textures", "houses")

# id: source, real size of the source (m; None = read Poly Haven's), output size P (m), hi px, rotate source 90 deg (grain along u),
#     colour mode ("match" = keep hue, match the old mean per channel; "grey" = desaturate to the old mean, for vertex-tinted
#     greys; "keep" = the source's own colour), relief strength, AO amount, extra
SPECS = {
    "floor_oak":   dict(src="ph_herringbone_parquet", P=2.4, px=2048, mode="match", relief=0.6, ao=0.6, mean=(0.78, 0.68, 0.55)),   # cottage pass: herringbone oak
    "floor_oakL":  dict(src="ph_laminate_floor_02", P=2.4, px=2048, mode="match", relief=0.5, ao=0.5, flip=True),
    "floor_dark":  dict(src="ph_dark_wooden_planks", P=2.4, px=2048, mode="match", relief=0.6, ao=0.6),
    "plaster_old": dict(src="ph_plastered_wall_04", P=2.5, px=2048, mode="grey", relief=0.9, ao=0.3, contrast=0.8),
    "wood_oak":    dict(src="ph_oak_veneer_01", P=1.0, px=1024, rot=True, mode="match", relief=0.3, ao=0.2),
    "wood_walnut": dict(src="ph_natural_walnut_veneer", P=1.0, px=1024, mode="match", relief=0.3, ao=0.2),
    "wood_dark":   dict(src="ph_dark_wood", P=1.0, px=1024, mode="match", relief=0.3, ao=0.2),
    "wood_pine":   dict(src="ph_coated_pine_02", P=2.5, px=2048, mode="match", relief=0.6, ao=0.5),
    "tile_white":  dict(src="ph_long_white_tiles", P=0.9, px=1024, rot=True, mode="match", relief=0.7, ao=0.5, mean=(0.93, 0.92, 0.88)),
    "floral":      dict(src="ph_floral_jacquard", S=0.38, P=0.76, px=1024, mode="grey", relief=0.4, ao=0.2, mean=(0.84, 0.83, 0.8), contrast=2.2),
    "fabric":      dict(src="acg_Fabric030", S=0.5, P=0.5, px=1024, mode="grey", relief=0.5, ao=0.35, contrast=0.9),
    "leather":     dict(src="ph_brown_leather", P=0.8, px=1024, mode="grey", relief=0.8, ao=0.4),
    "rattan":      dict(src="acg_Wicker007B", S=0.5, P=0.5, px=1024, mode="match", relief=0.8, ao=0.7),
    "rug":         dict(src="acg_Carpet016", S=1.0, P=0.8, px=1024, mode="grey", relief=0.8, ao=0.5, contrast=1.6),
    "rock":        dict(src="ph_rock_wall_13", P=1.6, px=2048, mode="match", relief=0.7, ao=0.7, mean=(0.6, 0.55, 0.48)),   # (cabin fieldstone, unused since the model-house pass)
    "stone":       dict(src="ph_marble_01", P=1.5, px=2048, mode="grey", relief=0.15, ao=0.1, mean=(0.9, 0.9, 0.89), contrast=1.4),   # model-house pass: quartz / marble slab
}
# procedural ones that stay (pattern art), copied to the client with a fine embossed-paper relief (wallpapers) or as they are
WALLPAPERS = ["wp1", "wp2", "wp3", "wp4", "wp5", "wp_6", "wp_7", "wp_8", "wp_9", "wp_10"]
KEEP = ["jangpan", "paper", "bamboo", "jagae", "leaf", "atlas"]
POLYHAVEN = [s["src"][3:] for s in SPECS.values() if s["src"].startswith("ph_")]
AMBIENTCG = sorted({s["src"][4:] for s in SPECS.values() if s["src"].startswith("acg_")} | {"Wallpaper001A"})


def fetch():
    ua = {"User-Agent": "caysonverse-texture-fetch"}
    for slug in POLYHAVEN:
        d = os.path.join(DL, "ph_" + slug)
        os.makedirs(d, exist_ok=True)
        files = json.loads(urllib.request.urlopen(urllib.request.Request(f"https://api.polyhaven.com/files/{slug}", headers=ua)).read())
        json.dump(files, open(os.path.join(d, "files.json"), "w"))
        for key, fn in (("Diffuse", "diff"), ("nor_gl", "nor"), ("AO", "ao")):
            e = files[key]["2k"]
            e = e.get("jpg") or e.get("png")
            p = os.path.join(d, fn + os.path.splitext(e["url"])[1])
            if not os.path.exists(p):
                open(p, "wb").write(urllib.request.urlopen(urllib.request.Request(e["url"], headers=ua), timeout=120).read())
    for aid in AMBIENTCG:
        d = os.path.join(DL, "acg_" + aid)
        os.makedirs(d, exist_ok=True)
        z = os.path.join(d, "z.zip")
        if not os.path.exists(z):
            open(z, "wb").write(urllib.request.urlopen(urllib.request.Request(f"https://ambientcg.com/get?file={aid}_2K-JPG.zip", headers=ua), timeout=120).read())
        with zipfile.ZipFile(z) as zf:
            for n in zf.namelist():
                if n.endswith(".jpg"):
                    zf.extract(n, d)


def load_set(src):
    d = os.path.join(DL, src)
    if src.startswith("ph_"):
        pick = lambda stem: next(os.path.join(d, f) for f in os.listdir(d) if f.startswith(stem + "."))
        alb, nor, ao = pick("diff"), pick("nor"), pick("ao")
        meta = json.loads(urllib.request.urlopen(urllib.request.Request(f"https://api.polyhaven.com/info/{src[3:]}", headers={"User-Agent": "caysonverse-texture-fetch"})).read()) if not os.path.exists(os.path.join(d, "info.json")) else json.load(open(os.path.join(d, "info.json")))
        json.dump(meta, open(os.path.join(d, "info.json"), "w"))
        size = meta["dimensions"][0] / 1000.0
    else:
        aid = src[4:]
        alb = os.path.join(d, f"{aid}_2K-JPG_Color.jpg")
        nor = os.path.join(d, f"{aid}_2K-JPG_NormalGL.jpg")
        ao = os.path.join(d, f"{aid}_2K-JPG_AmbientOcclusion.jpg")
        ao = ao if os.path.exists(ao) else None
        size = None
    f = lambda p, mode: np.asarray(Image.open(p).convert(mode)).astype(np.float32) / 255.0
    A = f(alb, "RGB")
    N = f(nor, "RGB") * 2 - 1
    O = f(ao, "L") if ao else np.ones(A.shape[:2], np.float32)
    return A, N, O, size


def s2l(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def l2s(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def relief(A, N, O, s, a):
    L = np.array([-0.45, 0.55, 0.70], np.float32)
    L /= np.linalg.norm(L)
    nn = N / (np.linalg.norm(N, axis=2, keepdims=True) + 1e-6)
    shade = (nn @ L) / L[2]
    k = 1 + s * (shade - 1)
    occ = 1 - a * (1 - O)
    return A * np.clip(k * occ, 0.2, 1.6)[..., None]


def tile_to(img, n, px, resample=Image.LANCZOS):
    """img (H, W, C float) tiled n x n, resampled to px"""
    t = np.tile(img, (n, n, 1)) if img.ndim == 3 else np.tile(img, (n, n))
    if t.ndim == 2:
        return np.asarray(Image.fromarray(t.astype(np.float32), mode="F").resize((px, px), resample))
    ch = [np.asarray(Image.fromarray(t[..., i].astype(np.float32), mode="F").resize((px, px), resample)) for i in range(t.shape[2])]
    return np.stack(ch, -1)


def old_mean(name):
    p = os.path.join(ORIG, f"T_h_{name}.png")
    if not os.path.exists(p):
        return None
    a = np.asarray(Image.open(p).convert("RGB")).astype(np.float32) / 255.0
    return s2l(a).reshape(-1, 3).mean(0)


def save_all(name, srgb):
    """srgb float (px, px, 3) -> authoring png, 128 px png, client hi / lo webp"""
    im = Image.fromarray((np.clip(srgb, 0, 1) * 255 + 0.5).astype(np.uint8))
    im.save(os.path.join(TEXH, f"T_h_{name}.png"), optimize=False, compress_level=3)
    im.resize((128, 128 * im.height // im.width), Image.LANCZOS).save(os.path.join(SMALL, f"T_h_{name}.png"))
    for tag, div in (("hi", 1), ("lo", 2)):
        out = im if div == 1 else im.resize((im.width // div, im.height // div), Image.LANCZOS)
        out.save(os.path.join(CLIENT, tag, f"T_h_{name}.webp"), quality=76 if tag == "hi" else 76, method=6)
    print("wrote", name, im.size, os.path.getsize(os.path.join(CLIENT, "hi", f"T_h_{name}.webp")) // 1024, "KB hi")


def build(name, sp):
    A, N, O, size = load_set(sp["src"])
    S = sp.get("S") or size
    if sp.get("rot"):
        A, O = np.rot90(A), np.rot90(O)
        N = np.rot90(N)
        N = np.stack([-N[..., 1], N[..., 0], N[..., 2]], -1)      # the tangent frame turns with the image
    if sp.get("flip"):
        A, N, O = A[:, ::-1], N[:, ::-1] * np.array([-1, 1, 1], np.float32), O[:, ::-1]
    n = max(1, int(round(sp["P"] / S)))
    lin = s2l(A)
    if sp.get("contrast"):                                          # scans of near-flat surfaces: lift the detail a little
        m = lin.mean((0, 1), keepdims=True)
        lin = m + (lin - m) * sp["contrast"]
    lin = relief(lin, N, O, sp["relief"], sp["ao"])
    mode = sp["mode"]
    target = np.array(sp["mean"], np.float32) if sp.get("mean") else old_mean(name)
    if mode == "grey":
        y = lin @ np.array([0.2126, 0.7152, 0.0722], np.float32)
        lin = np.repeat(y[..., None], 3, -1) * 0.85 + lin * 0.15
    if mode in ("match", "grey") and target is not None:
        tl = s2l(target) if sp.get("mean") else target
        # luminance detail of the scan on the old mean colour, plus half of the scan's own local hue shifts (knots, grain colour)
        w = np.array([0.2126, 0.7152, 0.0722], np.float32)
        y = lin @ w + 1e-5
        my = y.mean()
        mc = lin.reshape(-1, 3).mean(0) / my
        chroma = (lin / y[..., None]) / mc
        lin = tl[None, None, :] * (y / my)[..., None] * (1 + 0.5 * (np.clip(chroma, 0.5, 2.0) - 1))
    if sp.get("lift"):
        lin = lin * sp["lift"]
    out = tile_to(l2s(lin), n, sp["px"])
    save_all(name, out)


def emboss_wallpaper(name):
    """keep the house's paper pattern; add a fine embossed vinyl / silk-paper relief (ambientCG Wallpaper001A normal, 0.5 m tile)"""
    src = os.path.join(ORIG, f"T_h_{name}.png")
    pat = np.asarray(Image.open(src).convert("RGB")).astype(np.float32) / 255.0
    px = 2048
    big = np.stack([np.asarray(Image.fromarray(pat[..., i], mode="F").resize((px, px), Image.BICUBIC)) for i in range(3)], -1)
    d = os.path.join(DL, "acg_Wallpaper001A")
    N = np.asarray(Image.open(os.path.join(d, "Wallpaper001A_2K-JPG_NormalGL.jpg")).convert("RGB")).astype(np.float32) / 255.0 * 2 - 1
    Nt = tile_to(N, 5, px)                                           # 2.5 m wall tile / 0.5 m paper grain
    lin = relief(s2l(big), Nt, np.ones((px, px), np.float32), 0.6, 0.0)
    save_all(name, l2s(lin))


def copy_keep(name):
    im = Image.open(os.path.join(ORIG, f"T_h_{name}.png")).convert("RGB")
    a = np.asarray(im).astype(np.float32) / 255.0
    save_all(name, a)


def log_wall():
    """통나무 벽 (10번 집): 9 round logs per 2.5 m of wall height, peeled honey-pine with the oak scan's grain running along each log,
    rounded shading (the logs' curve), light chinking between them with a dark shadow line, a few checks (drying cracks)."""
    px = 2048
    A, N, O, size = load_set("ph_coated_pine_02")
    grain = tile_to(s2l(A) @ np.array([0.2126, 0.7152, 0.0722], np.float32), 2, px)
    grain = grain / grain.mean()
    rng = np.random.default_rng(1017)
    v = (np.arange(px) + 0.5) / px * 9.0
    i = np.floor(v).astype(int)
    t = v - i
    out = np.zeros((px, px, 3), np.float32)
    base = np.array([0.62, 0.42, 0.24], np.float32)
    chink = np.array([0.62, 0.58, 0.5], np.float32)
    tone = 0.88 + 0.24 * rng.random(9)
    shift = rng.integers(0, px, 9)
    for k in range(9):
        rows = i == k
        g = np.roll(grain, shift[k], axis=1)[rows]
        tt = t[rows][:, None]
        curve = (0.42 + 0.58 * np.sin(np.pi * np.clip((tt - 0.05) / 0.9, 0, 1)) ** 0.6)
        col = base[None, None, :] * tone[k] * g[..., None] * curve[..., None]
        edge = ((tt < 0.05) | (tt > 0.95))[..., None]
        line = ((np.abs(tt - 0.05) < 0.008) | (np.abs(tt - 0.95) < 0.008))[..., None]
        col = np.where(edge, chink[None, None, :] * (0.85 + 0.15 * g[..., None]), col)
        col = np.where(line, col * 0.35, col)
        out[rows] = col
    for _ in range(14):                                                # checks: thin dark splits along a log
        k = rng.integers(0, 9)
        y = int((k + 0.3 + 0.4 * rng.random()) / 9 * px)
        x0 = rng.integers(0, px)
        ln = rng.integers(120, 420)
        xs = (np.arange(ln) + x0) % px
        ys = (y + np.round(3 * np.sin(np.arange(ln) / 37.0))).astype(int)
        out[ys, xs] *= 0.45
    save_all("logwall", l2s(out))


def porcelain(name, base_mean, grout):
    """large-format polished porcelain (model-house pass 2026-11-17): marble-look 600 x 1200 mm slabs (2 x 4 in a 2.4 m repeat), a 2 mm
    grout line, each slab its own cut of the marble (shifted / mirrored), a faint polish sheen band"""
    px = 2048
    A, N, O, size = load_set("ph_marble_01")
    y = s2l(A) @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    y = y / y.mean()
    y = 1 + (y - 1) * 1.3
    out = np.zeros((px, px), np.float32)
    sw, sh = px // 2, px // 4                      # 1.2 m x 0.6 m
    rng = np.random.default_rng(len(name))
    big = np.asarray(Image.fromarray(y.astype(np.float32), mode="F").resize((px, px), Image.BICUBIC))
    for i in range(2):
        for j in range(4):
            ox, oy = rng.integers(0, px), rng.integers(0, px)
            cut = np.roll(np.roll(big, ox, 1), oy, 0)[:sh, :sw]
            if rng.random() < 0.5:
                cut = cut[:, ::-1]
            out[j * sh:(j + 1) * sh, i * sw:(i + 1) * sw] = cut * (0.97 + 0.06 * rng.random())
    g = max(2, px // 1200)                         # ~2 mm
    for i in range(3):
        out[:, max(0, i * sw - g // 2):i * sw + g // 2 + 1] = grout
    for j in range(5):
        out[max(0, j * sh - g // 2):j * sh + g // 2 + 1, :] = grout
    lin = np.stack([out] * 3, -1) * np.array(base_mean, np.float32)[None, None, :]
    save_all(name, l2s(lin))


def plain_wallpaper(name):
    """model-house pass: plain silk wallpaper (no printed pattern), the embossed vinyl grain only — the walls' tint gives the colour"""
    px = 2048
    d = os.path.join(DL, "acg_Wallpaper001A")
    N = np.asarray(Image.open(os.path.join(d, "Wallpaper001A_2K-JPG_NormalGL.jpg")).convert("RGB")).astype(np.float32) / 255.0 * 2 - 1
    Nt = tile_to(N, 5, px)
    base = np.full((px, px, 3), 0.86, np.float32)
    lin = relief(base, Nt, np.ones((px, px), np.float32), 0.45, 0.0)
    save_all(name, l2s(lin))


def cottage_wall(name, seed=0):
    """cottage pass 2026-11-17 (European show-home cottages): a 3.7 m wall repeat (the walls map v = y / 3.7 from the floor) — limewash
    plaster above, painted panel moulding (wainscot) below a chair rail at 0.92 m: raised frames 0.62 m wide with a bevel lit from the upper
    left, a tonal panel field. Grey-white; the house's wall tint gives the colour."""
    px = 2048
    A, N, O, size = load_set("ph_plastered_wall")
    lim = s2l(A) @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    lim = tile_to((lim / lim.mean())[..., None], 2, px)[..., 0]
    lim = 1 + (lim - 1) * 0.8
    Nn = tile_to(N, 2, px)
    base = np.stack([lim * 0.86] * 3, -1)
    out = relief(base, Nn, np.ones((px, px), np.float32), 0.35, 0.0)
    ppm = px / 3.7
    row = lambda y: int(round(px - 1 - y * ppm))          # image row of height y (the image bottom = the floor)
    col = lambda x: int(round(x * ppm)) % px
    paint = 0.8
    r0, r1 = row(0.92), px
    out[r0:r1] = paint * (0.985 + 0.015 * Nn[r0:r1, :, 1:2])
    # chair rail band (geometry adds the real rail; the paint line under it)
    out[row(0.95):row(0.9)] = paint * 1.04
    # panels: 0.62 m wide, 0.06 m stiles, between 0.16 and 0.84 m
    def frame(x0, x1, y0, y1, w=0.035):
        for (a, b, c, d, k) in ((x0, x1, y1 - w, y1, 1.10), (x0, x1, y0, y0 + w, 0.86), (x0, x0 + w, y0, y1, 1.07), (x1 - w, x1, y0, y1, 0.9)):
            ra, rb = row(d), row(c)
            ca, cb = col(a), col(b)
            if cb <= ca:
                continue
            out[ra:rb, ca:cb] = paint * k
    x = 0.04
    while x + 0.62 < 3.7 - 0.02:
        frame(x, x + 0.62, 0.16, 0.84)
        x += 0.62 + 0.06
    save_all(name, l2s(out))


def encaustic(name):
    """cottage pass: patterned cement tiles (0.2 m, 6 x 6 in a 1.2 m repeat) for entries and kitchens: a four-petal motif in slate
    blue-grey on chalk white with a terracotta-dust border, matt, slightly uneven pigment, 2 mm joints"""
    px = 2048
    t = px // 6
    yy, xx = np.mgrid[0:t, 0:t].astype(np.float32) / t - 0.5
    r = np.hypot(xx, yy)
    ang = np.arctan2(yy, xx)
    petal = (r < 0.36 * (0.55 + 0.45 * np.abs(np.cos(2 * ang)))) & (r > 0.06)
    ring = (np.abs(r - 0.08) < 0.03)
    corner = (np.minimum(np.abs(xx), np.abs(yy)) > 0.42)
    diag = (np.abs(np.abs(xx) - np.abs(yy)) < 0.025) & (r > 0.4)
    chalk = np.array([0.82, 0.8, 0.74], np.float32)
    slate = np.array([0.25, 0.32, 0.38], np.float32)
    terra = np.array([0.55, 0.32, 0.22], np.float32)
    tile = np.ones((t, t, 3), np.float32) * chalk
    tile[petal] = slate
    tile[ring] = terra
    tile[corner | diag] = terra
    rng = np.random.default_rng(7)
    out = np.zeros((px, px, 3), np.float32)
    for i in range(6):
        for j in range(6):
            k = 0.95 + 0.08 * rng.random()
            out[j * t:(j + 1) * t, i * t:(i + 1) * t] = tile * k
    noise = np.asarray(Image.fromarray((rng.random((256, 256)) * 255).astype(np.uint8)).resize((px, px), Image.BICUBIC)).astype(np.float32) / 255
    out *= (0.94 + 0.08 * noise)[..., None]
    g = 4
    for i in range(7):
        out[:, max(0, i * t - g // 2):i * t + g // 2] = 0.5
        out[max(0, i * t - g // 2):i * t + g // 2, :] = 0.5
    save_all(name, l2s(s2l(out)))


def check(name="check"):
    """layered pass: woven gingham / check linen, grey-white so the vertex tint colours it — 10 checks a repeat, the crossing squares
    darkest, a fine weave relief from the linen scan"""
    px = 1024
    A, N, O, size = load_set(SPECS["fabric"]["src"])
    Nn = tile_to(N, 3, px)
    n = 10
    u = (np.arange(px) * n // px) % 2
    a = u[None, :].astype(np.float32)
    b = u[:, None].astype(np.float32)
    v = 0.9 - 0.1 * a - 0.1 * b + 0.02 * a * b          # layered pass 2: a soft tonal check, not a loud plaid
    # a thin white overcheck line between the squares (a woven check, not a printed one)
    edge = ((np.arange(px) * n) % px) < 6
    v = np.where(edge[None, :] | edge[:, None], np.minimum(v + 0.04, 0.95), v)
    base = np.stack([v] * 3, -1).astype(np.float32)
    lin = relief(s2l(base), Nn, np.ones((px, px), np.float32), 0.5, 0.0)
    save_all(name, l2s(lin))


def main():
    if "--fetch" in sys.argv:
        fetch()
    only = None
    if "--only" in sys.argv:
        only = set(sys.argv[sys.argv.index("--only") + 1].split(","))
    if not os.path.exists(ORIG):
        shutil.copytree(TEXH, ORIG)
    for d in (SMALL, os.path.join(CLIENT, "hi"), os.path.join(CLIENT, "lo")):
        os.makedirs(d, exist_ok=True)
    for name, sp in SPECS.items():
        if only is None or name in only:
            build(name, sp)
    for name in WALLPAPERS:
        if only is None or name in only:
            cottage_wall(name)             # cottage pass (was emboss_wallpaper: the houses' printed patterns)
    if only is None or "plaster" in only:
        cottage_wall("plaster")
    if only is None or "tile_grey" in only:
        encaustic("tile_grey")
    for name in KEEP:
        if only is None or name in only:
            copy_keep(name)
    if only is None or "logwall" in only:
        log_wall()
    if only is None or "check" in only:
        check("check")


if __name__ == "__main__":
    main()
