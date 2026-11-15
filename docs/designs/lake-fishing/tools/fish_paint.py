"""fish_paint.py - paints the 2048x768 fish atlas (4x3 cells of 512x256) with PIL/numpy. No Blender needed.
Cell layout: body side view x0..511,y0..191 (u = tail->snout, v = back(top row)->belly(bottom row)); fin strip x0..383,y196..251
(bottom = fin base, top = fin tip); eye x400..463,y192..255.  Species recipes are tuned against art/lake/refs/fish/*."""
import numpy as np

CW, CH = 512, 256
BH = 192


def hexc(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def noise(w, h, scale, seed):
    from PIL import Image
    r = np.random.RandomState(seed)
    n = r.rand(max(2, h // scale + 2), max(2, w // scale + 2)).astype(np.float32)
    im = Image.fromarray((n * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
    return np.asarray(im, dtype=np.float32) / 255.0


def gradient(spec, v):
    """spec: [(v, color)] sorted; v array 0 (back) .. 1 (belly)."""
    out = np.zeros(v.shape + (3,), np.float32)
    stops = spec
    for c in range(3):
        out[..., c] = np.interp(v, [s[0] for s in stops], [s[1][c] for s in stops])
    return out


def paint_body(sp, seed):
    S = sp
    y, x = np.mgrid[0:BH, 0:CW].astype(np.float32)
    u = x / (CW - 1); v = y / (BH - 1)
    col = gradient([(0.0, hexc(S["back"])), (0.42, hexc(S["side"])), (0.62, hexc(S["side2"] if "side2" in S else S["side"])), (1.0, hexc(S["belly"]))], v)
    n1 = noise(CW, BH, 24, seed); n2 = noise(CW, BH, 6, seed + 1)
    col *= (0.9 + 0.2 * n1[..., None]) * (0.96 + 0.08 * n2[..., None])
    sc = S.get("scale")
    if sc:                                  # (size_px_x, size_px_y, strength)
        sx, sy, st = sc
        uu = x / sx; vv = y / sy
        row = np.floor(vv); uu = uu + 0.5 * (row % 2)
        fu = uu % 1.0; fv = vv % 1.0
        d = np.hypot(fu - 0.5, (fv - 0.15) * 0.9)
        edge = smooth(0.34, 0.6, d)
        shade = 1.0 - st * edge + st * 0.35 * (1 - smooth(0.0, 0.5, d))
        # scales fade out toward head
        shade = 1 + (shade - 1) * (1 - smooth(0.80, 0.95, u))[...]
        col *= shade[..., None]
    for fn in S.get("marks", []):
        col = fn(col, x, y, u, v)
    # operculum edge + mouth line + gill darkening
    if not S.get("no_head", False):
        og = smooth(0.74, 0.76, u) * (1 - smooth(0.76, 0.78, u))
        col *= (1 - 0.14 * og[..., None])
        head = smooth(0.76, 0.80, u)
        col = col * (1 - 0.0 * head[..., None])
        ml = np.exp(-(((v - S.get("mouth_v", 0.58)) / 0.018) ** 2)) * smooth(0.93, 0.97, u)
        col *= (1 - 0.8 * ml[..., None])
    return np.clip(col, 0, 255)


def paint_fin(sp, seed):
    h, w = 56, 384
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    f = 1 - y / (h - 1)                       # 0 base .. 1 tip
    base = hexc(sp["fin_base"]); tip = hexc(sp["fin_tip"]); ray = hexc(sp["fin_ray"])
    col = base[None, None, :] * (1 - f[..., None]) + tip[None, None, :] * f[..., None]
    rays = 0.5 + 0.5 * np.cos(x * 2 * np.pi / 7.0)
    col = col * (1 - 0.35 * rays[..., None]) + ray * 0.0
    col *= (0.9 + 0.2 * noise(w, h, 8, seed + 5)[..., None])
    edge = smooth(0.9, 1.0, f)
    col = col * (1 - 0.25 * edge[..., None]) + hexc(sp.get("fin_edge", sp["fin_tip"])) * 0.25 * edge[..., None]
    return np.clip(col, 0, 255)


def paint_eye(sp):
    from PIL import Image, ImageDraw
    S = 64
    im = Image.new("RGB", (S, S), tuple(int(c) for c in hexc(sp["body_eye_ring"])))
    d = ImageDraw.Draw(im)
    ring = tuple(int(c) for c in hexc(sp["eye_ring"]))
    d.ellipse((6, 6, S - 7, S - 7), fill=ring)
    d.ellipse((16, 16, S - 17, S - 17), fill=(8, 8, 10))
    d.ellipse((38, 20, 46, 28), fill=(235, 235, 235))
    return np.asarray(im, dtype=np.float32)


# ---- marks ---------------------------------------------------------------------------------------------
def lateral_line(col, x, y, u, v, c="#3b3a2c", a=0.35, vv=0.46):
    m = np.exp(-(((v - vv) / 0.012) ** 2)) * smooth(0.12, 0.3, u) * (1 - smooth(0.74, 0.78, u))
    return col * (1 - a * m[..., None]) + hexc(c) * a * m[..., None]


def bars(n, c, a, u0, u1, v0=0.1, v1=0.8, width=0.022, wobble=0.0):
    def f(col, x, y, u, v):
        m = np.zeros_like(u)
        for i in range(n):
            uc = u0 + (u1 - u0) * (i + 0.5) / n + wobble * np.sin(v * 7 + i)
            m = np.maximum(m, np.exp(-(((u - uc) / width) ** 2)))
        m *= smooth(v0, v0 + 0.08, v) * (1 - smooth(v1 - 0.08, v1, v))
        return col * (1 - a * m[..., None]) + hexc(c) * a * m[..., None]
    return f


def hstripe(vc, wd, c, a, u0=0.1, u1=0.78):
    def f(col, x, y, u, v):
        m = np.exp(-(((v - vc) / wd) ** 2)) * smooth(u0, u0 + 0.06, u) * (1 - smooth(u1 - 0.05, u1, u))
        return col * (1 - a * m[..., None]) + hexc(c) * a * m[..., None]
    return f


def blotches(c, a, density, size, seed, vmax=0.7, u0=0.1, u1=0.9):
    def f(col, x, y, u, v):
        n = noise(CW, BH, size, seed)
        m = smooth(1 - density, 1 - density + 0.06, n) * (1 - smooth(vmax - 0.1, vmax, v)) * smooth(u0, u0 + 0.05, u) * (1 - smooth(u1 - 0.05, u1, u))
        return col * (1 - a * m[..., None]) + hexc(c) * a * m[..., None]
    return f


def spots(c, a, n, rad, seed, vmin=0.1, vmax=0.7, u0=0.12, u1=0.86):
    def f(col, x, y, u, v):
        r = np.random.RandomState(seed)
        m = np.zeros_like(u)
        for _ in range(n):
            cu = r.uniform(u0, u1) * CW; cv = r.uniform(vmin, vmax) * BH
            rr = rad * r.uniform(0.6, 1.4)
            m = np.maximum(m, 1 - smooth(rr * 0.6, rr, np.hypot(x - cu, y - cv)))
        return col * (1 - a * m[..., None]) + hexc(c) * a * m[..., None]
    return f


def opercle_spot(c="#0d0d10", a=0.95):
    def f(col, x, y, u, v):
        m = 1 - smooth(0.02, 0.05, np.hypot((u - 0.80) * 2.0, (v - 0.40) * 1.0))
        return col * (1 - a * m[..., None]) + hexc(c) * a * m[..., None]
    return f


def belly_blush(c, a, u0=0.55, u1=1.0):
    def f(col, x, y, u, v):
        m = smooth(0.62, 0.85, v) * smooth(u0, u0 + 0.15, u) * (1 - smooth(u1 - 0.0, u1 + 0.01, u))
        return col * (1 - a * m[..., None]) + hexc(c) * a * m[..., None]
    return f


def mirror_scales(seed):
    def f(col, x, y, u, v):
        r = np.random.RandomState(seed)
        out = col
        for _ in range(26):
            cu = r.uniform(0.18, 0.80) * CW; cv = r.uniform(0.12, 0.62) * BH
            rx = r.uniform(24, 44); ry = r.uniform(18, 30)
            d = np.hypot((x - cu) / rx, (y - cv) / ry)
            rim = smooth(0.7, 1.0, d) * (1 - smooth(1.0, 1.15, d))
            inner = 1 - smooth(0.0, 1.0, d)
            out = out * (1 - 0.09 * rim[..., None]) + 4 * inner[..., None]
        return out
    return f


SPECIES = {
    "crucian_carp": dict(back="#6e6a3c", side="#a49a5c", side2="#bdb683", belly="#e0dcc0", scale=(12, 11, 0.13),
                         marks=[lambda c, x, y, u, v: lateral_line(c, x, y, u, v, "#4a4630", 0.3)],
                         fin_base="#8a8450", fin_tip="#4e4c34", fin_ray="#3a3826", fin_edge="#26241a",
                         eye_ring="#c9a548", body_eye_ring="#77703f", mouth_v=0.62),
    "bluegill": dict(back="#4d5a2e", side="#7f8b3a", side2="#c2a43a", belly="#e08a2c", scale=(11, 10, 0.12),
                     marks=[bars(7, "#2d3a22", 0.35, 0.18, 0.74, 0.0, 0.62, 0.02), opercle_spot(), belly_blush("#e7762a", 0.35, 0.5)],
                     fin_base="#8d7d3a", fin_tip="#5a5a34", fin_ray="#3c3c24", fin_edge="#2b2b1c",
                     eye_ring="#d84a2a", body_eye_ring="#6a7436", mouth_v=0.55),
    "minnow": dict(back="#5d6a56", side="#aeb8ae", side2="#cdd6cf", belly="#f0f0e6", scale=(9, 8, 0.10),
                   marks=[bars(8, "#3d8fa0", 0.55, 0.22, 0.72, 0.18, 0.72, 0.022), hstripe(0.42, 0.04, "#34687a", 0.35, 0.1, 0.8),
                          belly_blush("#e8864a", 0.35, 0.3, 0.8)],
                   fin_base="#e2915a", fin_tip="#c8c0a8", fin_ray="#9a7a5a", fin_edge="#f0e0c0",
                   eye_ring="#d8d8d8", body_eye_ring="#9aa89a", mouth_v=0.50),
    "prussian_carp": dict(back="#7c6a34", side="#b5984c", side2="#cdb97a", belly="#ece4c4", scale=(12, 11, 0.13),
                             marks=[lambda c, x, y, u, v: lateral_line(c, x, y, u, v, "#5a4a24", 0.3)],
                             fin_base="#a89a62", fin_tip="#6a6240", fin_ray="#4a4630", fin_edge="#403a24",
                             eye_ring="#d6b050", body_eye_ring="#88743a", mouth_v=0.6),
    "bass": dict(back="#3f4a2a", side="#7c8450", side2="#c9cdb0", belly="#eef0e2", scale=(10, 9, 0.10),
                 marks=[hstripe(0.40, 0.045, "#22281a", 0.55, 0.10, 0.80), blotches("#2a3320", 0.25, 0.28, 30, 11, 0.55)],
                 fin_base="#7c8450", fin_tip="#3f4a2a", fin_ray="#2a3320", fin_edge="#d8dcc0",
                 eye_ring="#c0482a", body_eye_ring="#5a6636", mouth_v=0.60, no_head=False),
    "carp": dict(back="#5e4a22", side="#a78238", side2="#c8a85a", belly="#ead9a0", scale=(16, 13, 0.16),
                 marks=[], fin_base="#9a6a3a", fin_tip="#6a4a2a", fin_ray="#4a321c", fin_edge="#3c2814",
                 eye_ring="#d9b24a", body_eye_ring="#80622e", mouth_v=0.68),
    "korean_bullhead": dict(back="#5b5226", side="#a1892f", side2="#c9ad45", belly="#e9dba0", scale=None,
                           marks=[blotches("#2b2512", 0.55, 0.30, 34, 21, 0.75), hstripe(0.26, 0.05, "#e8d98a", 0.45, 0.14, 0.78),
                                  bars(3, "#2b2512", 0.35, 0.30, 0.70, 0.0, 0.9, 0.04)],
                           fin_base="#8a7a30", fin_tip="#3c3414", fin_ray="#2a2410", fin_edge="#1c180a",
                           eye_ring="#c8c0a0", body_eye_ring="#5b5226", mouth_v=0.52),
    "catfish": dict(back="#3a3214", side="#5c4e1e", side2="#8c7a38", belly="#c8b878", scale=None,
                    marks=[blotches("#251f0c", 0.5, 0.35, 30, 31, 0.7), blotches("#a89c52", 0.25, 0.22, 14, 41, 0.9)],
                    fin_base="#6a5a24", fin_tip="#2a220c", fin_ray="#201a0a", fin_edge="#4a3e1a",
                    eye_ring="#d8d0a0", body_eye_ring="#3a3214", mouth_v=0.55),
    "mirror_carp": dict(back="#4a4326", side="#8b7a3c", side2="#b5a15a", belly="#e8dba8", scale=None,
                         marks=[mirror_scales(77)], fin_base="#b06a38", fin_tip="#a8441e", fin_ray="#6a2a10", fin_edge="#5a2410",
                         eye_ring="#d8b04c", body_eye_ring="#6e5e30", mouth_v=0.68),
    "snakehead": dict(back="#2e2e22", side="#5b5a3c", side2="#a39a74", belly="#e0d6ae", scale=(8, 7, 0.10),
                      marks=[blotches("#1a1a12", 0.7, 0.34, 26, 51, 0.8), spots("#d9cfa0", 0.35, 18, 7, 61, 0.1, 0.5, 0.1, 0.7),
                             hstripe(0.40, 0.03, "#14140c", 0.45, 0.75, 0.97)],
                      fin_base="#4a4a2e", fin_tip="#26261a", fin_ray="#1a1a10", fin_edge="#c8bd90",
                      eye_ring="#caa44a", body_eye_ring="#34342a", mouth_v=0.50),
    "eel": dict(back="#3a3e22", side="#5d6232", side2="#9a9246", belly="#e2d890", scale=None,
                marks=[blotches("#262a16", 0.3, 0.3, 40, 71, 0.6)],
                fin_base="#4e5228", fin_tip="#2a2e18", fin_ray="#1e2210", fin_edge="#a89c52",
                eye_ring="#b8b070", body_eye_ring="#3a3e22", mouth_v=0.52),
}
ORDER = list(SPECIES)


def cell_origin(i):
    return (i % 4) * CW, (i // 4) * CH


def paint_atlas(path):
    from PIL import Image
    atlas = np.zeros((CH * 3, CW * 4, 3), np.float32) + 128
    for i, k in enumerate(ORDER):
        sp = SPECIES[k]; ox, oy = cell_origin(i)
        seed = 100 + i * 7
        atlas[oy:oy + BH, ox:ox + CW] = paint_body(sp, seed)
        fin = paint_fin(sp, seed)
        atlas[oy + 196:oy + 252, ox:ox + 384] = fin
        atlas[oy + 192:oy + 256, ox + 400:ox + 464] = paint_eye(sp)
        atlas[oy + 192:oy + 196, ox:ox + 384] = fin[0:1]
    Image.fromarray(np.clip(atlas, 0, 255).astype(np.uint8)).save(path, quality=88)
    return path


if __name__ == "__main__":
    import sys
    print(paint_atlas(sys.argv[1] if len(sys.argv) > 1 else "fish_atlas.png"))
