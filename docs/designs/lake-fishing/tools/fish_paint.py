"""fish_paint.py - paints the fish atlases with PIL/numpy (no Blender needed), driven by the same shape data (fishspec.py)
so that the gill-cover edge, gape, lateral line and scale rows land exactly where the geometry has them.
   python art/lake/tools/fish_paint.py <dir>/fish_atlas.jpg      -> fish_atlas.jpg (2048x768) + fish_fins.png (1024x432)
Body atlas: 4x3 cells of 512x256. Body side view x0..511, y0..191 (u = U0 - U1 * x: tail left, snout right; v = back (row 0) ..
belly (row 191), mirrored on both flanks; u > 0.987 = lips / mouth cavity). Eye 64x64 at (400,192), barbel swatch at (64,192).
Fin atlas: 4x3 cells of 256x144, each with three 256x48 bands A (spiny / median), B (soft / caudal), C (paired / red);
24 rays across u, base at the bottom row of a band, tip at the top. Alpha = membrane cut between the ray tips."""
import math
import numpy as np
import fishspec as FS

CW, CH, BH = 512, 256, 192
ATLAS_W, ATLAS_H = 2048, 768
EYE_X, EYE_Y = 400, 192
BARB_X, BARB_Y = 64, 192
NRAY = 24
FCW, FBH = 256, 48
FIN_W, FIN_H = 1024, 432


def cell_origin(i):
    return (i % 4) * CW, (i // 4) * CH


def fin_origin(i, variant):
    return (i % 4) * FCW, (i // 4) * 3 * FBH + "ABC".index(variant) * FBH


def hexc(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


sm = FS.smoothstep


def noise(w, h, scale, seed):
    from PIL import Image
    r = np.random.RandomState(seed)
    n = r.rand(max(2, h // scale + 2), max(2, w // scale + 2)).astype(np.float32)
    im = Image.fromarray((n * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
    return np.asarray(im, dtype=np.float32) / 255.0


def mix(col, m, c, a=1.0):
    m = (np.clip(m, 0, 1) * a)[..., None]
    return col * (1 - m) + hexc(c) * m


def ramp(stops, t):
    out = np.zeros(t.shape + (3,), np.float32)
    for k in range(3):
        out[..., k] = np.interp(t, [s[0] for s in stops], [hexc(s[1])[k] for s in stops])
    return out


class Field:
    """per-texel geometry of a body cell: x (SL), Y (side height), yn (0 belly..1 back), arc (surface distance from the back)."""
    def __init__(self, sp):
        y, xg = np.mgrid[0:BH, 0:CW].astype(np.float64)
        self.u = (xg + 0.5) / CW; self.v = (y + 0.5) / BH
        self.x = np.clip((FS.U0 - self.u) / FS.U1, 0.0, FS.X_END)
        th = self.v * math.pi
        X, Y, yc, top, bot, w = FS.section(sp, self.x, th)
        self.X, self.Y, self.top, self.bot, self.w = X, Y, top, bot, w
        self.yn = (Y - bot) / np.maximum(top - bot, 1e-6)
        seg = np.hypot(np.diff(X, axis=0), np.diff(Y, axis=0))
        self.arc = np.vstack([np.zeros((1, CW)), np.cumsum(seg, axis=0)])
        self.lat = np.abs(X) / np.maximum(w, 1e-6)
        self.mouth = self.u > 0.987


def scales(F, sp, nsc, rows_half, seed):
    """reticulated scale pattern: returns (rim, centre) masks. Scale rows are aligned on the lateral line."""
    ll = FS.pchip(sp["LL"], F.x)
    # arc position of the lateral line in each column
    dY = np.abs(F.Y - ll)
    jl = np.argmin(np.where(F.v < 0.6, dY, 9), axis=0)
    arc_ll = F.arc[jl, np.arange(CW)]
    depth = F.arc[-1, :]
    sx = 1.0 / nsc
    sy = (depth / 2) / (rows_half * 1.0)
    a = (F.arc - arc_ll[None, :]) / sy[None, :] + 0.5
    row = np.floor(a)
    fu = (F.x / sx + 0.5 * (row % 2)) % 1.0
    fv = a - row
    d = np.hypot((fu - 0.25) / 0.8, (fv - 0.5) / 0.62)
    rim = np.exp(-(((d - 0.95) / 0.12) ** 2))
    cen = 1 - sm(0.0, 0.8, d)
    # pores on the lateral-line row
    pore = np.exp(-(((fu - 0.55) / 0.12) ** 2 + ((fv - 0.5) / 0.18) ** 2)) * (row == 0)
    head = sm(-0.01, 0.03, F.x - FS.op_edge(sp, F.yn))           # no scales on the head
    k = head
    return rim * k, cen * k, pore * k


def head_marks(col, F, sp, P):
    xe = FS.op_edge(sp, F.yn)
    win = sm(0.04, 0.14, F.yn) * (1 - sm(0.8, 0.94, F.yn))
    edge = np.exp(-(((F.x - xe - 0.002) / 0.0045) ** 2)) * win
    col = mix(col, edge, P.get("op_edge", "#1c1a12"), 0.42)
    plate = sm(xe + 0.002, xe - 0.01, F.x) * sm(xe - 0.13, xe - 0.06, F.x) * win
    col = col * (1 + 0.03 * plate[..., None])
    pre = np.exp(-(((F.x - (xe - 0.055 - 0.02 * (F.yn - 0.4))) / 0.004) ** 2)) * sm(0.05, 0.2, F.yn) * (1 - sm(0.55, 0.7, F.yn))
    col = mix(col, pre, P.get("op_edge", "#1c1a12"), 0.22)
    gx, gy, gd, gw = sp["GAPE"]; my = sp["MOUTH"]["y"]
    dist, t = FS.seg_dist(F.x, F.Y, 0.0, my, gx, gy)
    gape = np.exp(-((dist / (0.55 * gw)) ** 2)) * sm(0.2, 0.5, F.lat)
    col = mix(col, gape, "#120c0a", 0.85)
    lipz = np.exp(-(((dist - 1.5 * gw) / (0.9 * gw)) ** 2)) * sm(0.2, 0.5, F.lat) * (1 - t)
    col = mix(col, lipz, P.get("lip", "#c8b8a0"), 0.35)
    ex, ey, er = sp["EYE"]
    de = np.hypot(F.x - ex, F.Y - ey)
    col = mix(col, np.exp(-(((de - er * 1.12) / (er * 0.25)) ** 2)) * sm(0.3, 0.6, F.lat), P.get("orbit", "#2a2418"), 0.35)
    nos = np.exp(-((np.hypot(F.x - ex * 0.55, F.Y - (ey + er * 0.55)) / (er * 0.28)) ** 2)) * sm(0.2, 0.5, F.lat)
    col = mix(col, nos, "#14100a", 0.7)
    # head top a touch darker, snout tip
    col = col * (1 - 0.12 * sm(0.0, 0.25, xe - F.x)[..., None] * sm(0.55, 0.9, F.yn)[..., None])
    # lips + mouth cavity
    lipm = (F.u > 0.987) & (F.u <= 0.993)
    col[lipm] = hexc(P.get("lip", "#c8b8a0"))
    col[F.u > 0.993] = hexc("#2a1414")
    return col


def paint_body(key, i):
    sp = FS.SPECIES[key]; P = PAINT[key]; F = Field(sp)
    seed = 100 + 7 * i
    yn = F.yn
    col = ramp(P["ramp"], 1 - yn)
    n1 = noise(CW, BH, 22, seed); n2 = noise(CW, BH, 5, seed + 1)
    col *= (0.93 + 0.14 * n1[..., None]) * (0.97 + 0.06 * n2[..., None])
    if sp["SCALES"]:
        nsc, rh = sp["SCALES"]
        rim, cen, pore = scales(F, sp, nsc, rh, seed)
        st = P.get("scale_rim", 0.35)
        col = col * (1 - st * (rim - 0.22)[..., None]) + P.get("scale_sheen", 14) * (cen - 0.3)[..., None]
        col = mix(col, pore, P.get("pore", "#2a2a1c"), 0.6)
    else:
        ll = FS.pchip(sp["LL"], F.x)
        m = np.exp(-(((F.Y - ll) / 0.0035) ** 2)) * sm(FS.op_edge(sp, 0.5), FS.op_edge(sp, 0.5) + 0.03, F.x)
        col = mix(col, m, P.get("pore", "#2a2a1c"), 0.25)
    for fn in P.get("marks", []):
        col = fn(col, F, seed)
    col = head_marks(col, F, sp, P)
    return np.clip(col, 0, 255)


def paint_eye(P):
    from PIL import Image, ImageDraw
    S = 64
    im = Image.new("RGB", (S, S), tuple(int(c) for c in hexc(P.get("orbit", "#2a2418"))))
    d = ImageDraw.Draw(im)
    d.ellipse((4, 4, S - 5, S - 5), fill=tuple(int(c) for c in hexc(P["iris_out"])))
    d.ellipse((7, 7, S - 8, S - 8), fill=tuple(int(c) for c in hexc(P["iris"])))
    pr = P.get("pupil", 0.6)
    r0 = 32 * pr
    d.ellipse((32 - r0, 32 - r0, 31 + r0, 31 + r0), fill=(6, 6, 8))
    d.ellipse((24, 20, 30, 26), fill=(230, 230, 228))
    return np.asarray(im, dtype=np.float32)


def paint_fin(key, i, variant):
    P = PAINT[key]; FP = P["fin"][variant]
    y, x = np.mgrid[0:FBH, 0:FCW].astype(np.float32)
    u = (x + 0.5) / FCW; t = 1 - (y + 0.5) / FBH
    base, tip = hexc(FP[0]), hexc(FP[1])
    ray_c = hexc(FP[2]) if len(FP) > 2 else base * 0.6
    ph = (u * NRAY) % 1.0; k = np.floor(u * NRAY)
    ray = np.exp(-(((ph - 0.5) / 0.11) ** 2))
    col = base[None, None, :] * (1 - t[..., None]) + tip[None, None, :] * t[..., None]
    col = col * (1 - 0.18 * sm(0.6, 1.0, t)[..., None])
    # segmented rays (branching joints)
    joints = 0.85 + 0.15 * (np.sin(t * 60) > 0.6)
    col = col * (1 - ray[..., None] * 0.35) + ray_c * ray[..., None] * 0.35 * joints[..., None]
    nz = noise(FCW, FBH, 16, 300 + i * 3 + "ABC".index(variant))
    for fn in P.get("finmarks", {}).get(variant, []):
        col = fn(col, u, t, k)
    style = FP[3] if len(FP) > 3 else "soft"
    if style == "spiny":
        cut = 0.80 + 0.08 * nz - 0.16 * (1 - ray)
    else:
        cut = 0.955 + 0.03 * nz - 0.045 * (1 - ray)
    alpha = np.where(t < cut, 1.0, 0.0)
    alpha = np.where((ray > 0.35) & (t < np.minimum(cut + 0.035, 0.985)), 1.0, alpha)
    if style == "spine" or (len(FP) > 4 and FP[4]):
        sp_m = k == 0                                            # first ray = stout serrated spine
        thick = np.exp(-(((ph - 0.5) / 0.28) ** 2)) * sp_m
        col = col * (1 - 0.6 * thick[..., None]) + hexc("#2a2416") * 0.6 * thick[..., None]
        teeth = sp_m & (ph > 0.7) & (ph < 0.95) & ((np.floor(t * 18) % 2) == 0) & (t > 0.15)
        alpha = np.where((thick > 0.3) & (t < 0.995), 1.0, alpha)
        alpha = np.where(teeth, 1.0, alpha)
        col[teeth] = hexc("#2a2416")
    alpha = np.where(t > 0.995, 0.0, alpha)
    return np.concatenate([np.clip(col, 0, 255), (alpha * 255)[..., None]], axis=2)


# ---- marks ---------------------------------------------------------------------------------------------
def vbars(n, c, a, x0, x1, width, yn0=0.15, yn1=0.95, wob=0.0):
    def f(col, F, seed):
        m = np.zeros_like(F.x)
        for k in range(n):
            xc = x0 + (x1 - x0) * (k + 0.5) / n + wob * np.sin(F.yn * 6 + k * 1.7)
            m = np.maximum(m, np.exp(-(((F.x - xc) / width) ** 2)))
        m *= sm(yn0, yn0 + 0.12, F.yn) * (1 - sm(yn1 - 0.1, yn1, F.yn))
        return mix(col, m, c, a)
    return f


def band(c, a, yfun, wd, x0, x1, blotch=0.0, seed=0):
    def f(col, F, s):
        yc = np.interp(F.x, *zip(*yfun)) if isinstance(yfun, list) else yfun
        m = np.exp(-(((F.Y - yc) / wd) ** 2)) * sm(x0, x0 + 0.04, F.x) * (1 - sm(x1 - 0.03, x1, F.x))
        if blotch:
            nz = noise(CW, BH, 10, seed)
            m = m * (1 - blotch + blotch * sm(0.35, 0.6, nz)) * (1 + 0.6 * np.exp(-((((F.Y - yc) / (wd * 1.8)) ** 2))) * sm(0.55, 0.7, nz))
        return mix(col, m, c, a)
    return f


def blotches(c, a, density, size, seed, yn0=0.2, x0=0.0, x1=1.03):
    def f(col, F, s):
        n = noise(CW, BH, size, seed)
        m = sm(1 - density, 1 - density + 0.07, n) * sm(yn0, yn0 + 0.12, F.yn) * sm(x0, x0 + 0.03, F.x) * (1 - sm(x1 - 0.03, x1, F.x))
        return mix(col, m, c, a)
    return f


def spots(c, a, n, rad, seed, yn0=0.3, yn1=0.95, x0=0.1, x1=0.95):
    def f(col, F, s):
        r = np.random.RandomState(seed)
        m = np.zeros_like(F.x)
        for _ in range(n):
            cx = r.uniform(x0, x1); cy = r.uniform(yn0, yn1); rr = rad * r.uniform(0.6, 1.4)
            m = np.maximum(m, 1 - sm(rr * 0.6, rr, np.hypot(F.x - cx, (F.yn - cy) * 0.25)))
        return mix(col, m, c, a)
    return f


def region(c, a, x0, x1, yn0, yn1, soft=0.04):
    def f(col, F, s):
        m = sm(x0 - soft, x0, F.x) * (1 - sm(x1, x1 + soft, F.x)) * sm(yn0 - soft * 2, yn0, F.yn) * (1 - sm(yn1, yn1 + soft * 2, F.yn))
        return mix(col, m, c, a)
    return f


def ear_flap(c="#08080a"):
    def f(col, F, s):
        sp = FS.SPECIES["bluegill"]
        xe = FS.op_edge(sp, 0.62)
        m = 1 - sm(0.6, 1.0, np.hypot((F.x - (xe - 0.005)) / 0.035, (F.yn - 0.64) / 0.12))
        return mix(col, m, c, 0.95)
    return f


def cheek_lines(c, a, eye, n=3, length=0.12, slope=-0.25, gap=0.012):
    def f(col, F, s):
        ex, ey, er = eye
        m = np.zeros_like(F.x)
        for k in range(n):
            y0 = ey - er * 0.2 - k * gap
            yl = y0 + slope * (F.x - ex)
            m = np.maximum(m, np.exp(-(((F.Y - yl) / 0.0035) ** 2)) * sm(ex + er * 0.8, ex + er * 1.2, F.x) * (1 - sm(ex + length, ex + length + 0.02, F.x)))
        return mix(col, m, c, a)
    return f


def mirror_scales(seed):
    def f(col, F, s):
        r = np.random.RandomState(seed)
        nz = noise(CW, BH, 14, seed + 3)
        out = col
        pts = []
        for k in range(11):                                     # dorsal row along the base of the dorsal fin
            pts.append((0.3 + 0.062 * k + r.uniform(-0.012, 0.012), 0.86 + r.uniform(-0.05, 0.04), r.uniform(0.026, 0.042), r.uniform(0.06, 0.09)))
        for k in range(9):                                      # lateral-line row of big plates
            pts.append((0.3 + 0.07 * k, 0.52 + r.uniform(-0.05, 0.05), 0.045, 0.11))
        for _ in range(8):                                      # scattered
            pts.append((r.uniform(0.3, 0.85), r.uniform(0.25, 0.75), r.uniform(0.03, 0.045), r.uniform(0.07, 0.1)))
        for cx, cy, rx, ry in pts:
            d = np.hypot((F.x - cx) / rx, (F.yn - cy) / ry) + 0.45 * (nz - 0.5)
            rim = sm(0.8, 0.97, d) * (1 - sm(0.97, 1.08, d)) * 0.6
            inner = 1 - sm(0.0, 0.95, d)
            out = out * (1 - 0.45 * rim[..., None]) + sm(0.0, 0.25, inner)[..., None] * (hexc("#d8cc98") - out) * 0.5
        return out
    return f


def finspot(c, a, u0, u1, t0, t1):
    def f(col, u, t, k):
        m = sm(u0, u0 + 0.05, u) * (1 - sm(u1 - 0.05, u1, u)) * sm(t0, t0 + 0.1, t) * (1 - sm(t1 - 0.1, t1, t))
        return mix(col, m, c, a)
    return f


def finbars(c, a, n):
    def f(col, u, t, k):
        m = (np.sin(t * n * math.pi + u * 3) > 0.55).astype(np.float32) * 0.8
        return mix(col, m, c, a)
    return f


CARP_FIN = lambda b, tp, r: (b, tp, r, "soft", True)
PAINT = {
    "crucian_carp": dict(ramp=[(0, "#3e3c22"), (0.22, "#6e6634"), (0.45, "#ab9a56"), (0.7, "#cfc088"), (1, "#e8e0c4")],
                         scale_rim=0.32, scale_sheen=12, pore="#3a3622", op_edge="#2a2618", lip="#a89c70", orbit="#4a4630",
                         iris="#c8a64a", iris_out="#8a7a3a",
                         fin=dict(A=CARP_FIN("#a49c6c", "#8a8460", "#5a5638"), B=("#a49c6c", "#7e7856", "#5a5638"), C=("#c8bc8a", "#b0a678", "#7a7250"))),
    "bluegill": dict(ramp=[(0, "#3a4426"), (0.25, "#5c6a34"), (0.5, "#8a8c46"), (0.72, "#c49a3a"), (1, "#e88a2e")],
                     marks=[vbars(7, "#3a3a46", 0.38, 0.32, 0.92, 0.022, 0.25, 0.95, 0.01),
                            region("#e47a24", 0.45, 0.12, 0.6, 0.0, 0.32), ear_flap(),
                            cheek_lines("#4a6a9a", 0.45, (0.15, 0.038, 0.033), 3, 0.1, -0.35, 0.014)],
                     scale_rim=0.22, scale_sheen=10, pore="#2c3020", op_edge="#1e2214", lip="#7a7a50", orbit="#2a3018",
                     iris="#2a2a26", iris_out="#9a4a2a", pupil=0.5,
                     fin=dict(A=("#6a6a4a", "#4a4a36", "#2a2a20", "spiny"), B=("#6c6a4c", "#4c4a3a", "#2c2c22"), C=("#b0a070", "#c8bc90", "#7a6a4a")),
                     finmarks=dict(B=[finspot("#101010", 0.7, 0.0, 0.25, 0.05, 0.6)])),
    "minnow": dict(ramp=[(0, "#4a5a58"), (0.25, "#6e7e80"), (0.5, "#b4bcbc"), (0.75, "#dcdcd6"), (1, "#f2f0ea")],
                   marks=[vbars(10, "#3a8a9a", 0.62, 0.3, 0.95, 0.018, 0.22, 0.8, 0.008),
                          vbars(9, "#e0907a", 0.35, 0.335, 0.92, 0.012, 0.25, 0.75),
                          region("#e8a090", 0.3, 0.0, 0.25, 0.1, 0.5)],
                   scale_rim=0.2, scale_sheen=10, pore="#3a4a4a", op_edge="#3a3a40", lip="#c09890", orbit="#6a6a70",
                   iris="#d8d0b0", iris_out="#c88a3a",
                   fin=dict(A=("#8a8a8a", "#d8b0a0", "#5a5a5a"), B=("#a8a8a0", "#c8c4b8", "#7a7a70"), C=("#e89070", "#f0c0a0", "#c86a4a"))),
    "prussian_carp": dict(ramp=[(0, "#3c4034"), (0.22, "#646650"), (0.45, "#a4a28a"), (0.7, "#c8c6b2"), (1, "#e8e6da")],
                          scale_rim=0.3, scale_sheen=12, pore="#3a3a2c", op_edge="#2a2a20", lip="#a8a490", orbit="#4a4a3a",
                          iris="#d8c070", iris_out="#9a8a50",
                          fin=dict(A=CARP_FIN("#9a9686", "#6a685c", "#4a4840"), B=("#8a8678", "#4e4c44", "#3a3a32"), C=("#c8b8a8", "#b8a698", "#7a706a"))),
    "bass": dict(ramp=[(0, "#2c3a1e"), (0.22, "#4c5c30"), (0.45, "#8a9460"), (0.62, "#c6caa4"), (1, "#eef0e4")],
                 marks=[band("#1e2814", 0.62, [(0.3, 0.045), (0.55, 0.035), (0.8, 0.02), (1.03, 0.005)], 0.017, 0.3, 1.03, 0.6, 77),
                        blotches("#26301a", 0.3, 0.32, 18, 11, 0.62, 0.3), cheek_lines("#2a321c", 0.4, (0.13, 0.046, 0.021), 2, 0.17, -0.12, 0.016)],
                 scale_rim=0.18, scale_sheen=8, pore="#20281a", op_edge="#1a2210", lip="#56603a", orbit="#2a321c",
                 iris="#7a3a1e", iris_out="#c8642a", pupil=0.5,
                 fin=dict(A=("#6a7448", "#4a5434", "#2e3620", "spiny"), B=("#76804e", "#5a643c", "#3a4228"), C=("#a0a476", "#c8c8a8", "#7a7e58"))),
    "carp": dict(ramp=[(0, "#3c3018"), (0.22, "#6a5426"), (0.45, "#a8843a"), (0.68, "#c8aa5e"), (1, "#e8d8a4")],
                 marks=[region("#c8a070", 0.25, 0.25, 1.0, 0.0, 0.18)],
                 scale_rim=0.5, scale_sheen=18, pore="#3a2a12", op_edge="#2a2010", lip="#b89878", orbit="#4a3a20",
                 iris="#d0a840", iris_out="#8a6a2a",
                 fin=dict(A=CARP_FIN("#6a5a38", "#3e3424", "#2a2214"), B=("#6a5a3a", "#5a3a2a", "#2a2214"), C=("#b8784a", "#a85a32", "#6a3a1a"))),
    "korean_bullhead": dict(ramp=[(0, "#3a3010"), (0.25, "#6a5a1e"), (0.5, "#c0a038"), (0.72, "#d8c060"), (1, "#ece0a8")],
                            marks=[blotches("#2a220c", 0.75, 0.42, 26, 21, 0.3, 0.12),
                                   vbars(3, "#2a220c", 0.55, 0.45, 0.95, 0.04, 0.35, 1.0, 0.02),
                                   band("#e8d070", 0.45, 0.02, 0.012, 0.25, 1.0)],
                            pore="#3a3010", op_edge="#2a220c", lip="#a89050", orbit="#3a3010",
                            iris="#c8c0a0", iris_out="#5a5020", pupil=0.6,
                            fin=dict(A=("#8a7a30", "#4a3c14", "#2a2208", "soft", True), B=("#8a7a30", "#3a3010", "#2a2208"), C=("#9a8a40", "#6a5a24", "#3a3010"))),
    "catfish": dict(ramp=[(0, "#2e2a14"), (0.25, "#4a4220"), (0.5, "#6e6430"), (0.68, "#a49a68"), (1, "#e2dcc4")],
                    marks=[blotches("#1e1a0a", 0.55, 0.4, 20, 31, 0.35), blotches("#8a8250", 0.3, 0.25, 9, 41, 0.3)],
                    pore="#2a2614", op_edge="#1e1a0a", lip="#8a8058", orbit="#2a2410",
                    iris="#c8c8a0", iris_out="#6a6440", pupil=0.6,
                    fin=dict(A=("#5a5228", "#3a3418", "#20200c"), B=("#6a6030", "#4a4220", "#2a2410"), C=("#7a7038", "#5a5228", "#3a3418"))),
    "mirror_carp": dict(ramp=[(0, "#2e2a1a"), (0.22, "#4e4628"), (0.45, "#8a7a48"), (0.68, "#b8a474"), (1, "#e8dcb4")],
                        marks=[mirror_scales(77), region("#c8a878", 0.2, 0.25, 1.0, 0.0, 0.2)],
                        pore="#3a3218", op_edge="#2a2414", lip="#b09070", orbit="#3a3220",
                        iris="#c8a040", iris_out="#7a5a28",
                        fin=dict(A=CARP_FIN("#5a5034", "#3a3424", "#221e14"), B=("#c8682a", "#a8401a", "#6a2a10"), C=("#d0702e", "#b84c1e", "#7a3010"))),
    "snakehead": dict(ramp=[(0, "#2a2216"), (0.3, "#4e4028"), (0.55, "#7a6844"), (0.75, "#a8966c"), (1, "#d8cba8")],
                      marks=[blotches("#1a160c", 0.85, 0.58, 13, 51, 0.12, 0.0), blotches("#3a2e18", 0.6, 0.45, 7, 53, 0.1, 0.0), spots("#c8b68a", 0.3, 40, 0.012, 61, 0.3, 0.95, 0.05, 1.0),
                             band("#14140c", 0.6, [(0.07, 0.015), (0.3, -0.005)], 0.006, 0.08, 0.3),
                             band("#14140c", 0.5, [(0.07, -0.004), (0.3, -0.03)], 0.005, 0.1, 0.3)],
                      scale_rim=0.18, scale_sheen=6, pore="#22221a", op_edge="#16160e", lip="#8a8064", orbit="#22221a",
                      iris="#c8a040", iris_out="#5a4a20", pupil=0.55,
                      fin=dict(A=("#4a4a36", "#2e2e22", "#16160e"), B=("#4e4c38", "#2c2c20", "#16160e"), C=("#7a7658", "#5a5640", "#2e2e22")),
                      finmarks=dict(B=[finbars("#1a1a10", 0.45, 5)])),
    "eel": dict(ramp=[(0, "#22261a"), (0.3, "#3a4026"), (0.5, "#6a6a38"), (0.65, "#b8b06a"), (1, "#e8e2b0")],
                pore="#2a2a18", op_edge="#1a1a10", lip="#8a8458", orbit="#22261a",
                iris="#c8c090", iris_out="#5a5a30", pupil=0.55,
                fin=dict(A=("#3a3e26", "#2a2e1c", "#1a1c10"), B=("#40442a", "#5a5a34", "#22261a"), C=("#6a6a3a", "#8a8650", "#3a3e26"))),
}


def paint_atlas(path):
    from PIL import Image
    import os
    atlas = np.zeros((ATLAS_H, ATLAS_W, 3), np.float32) + 96
    fins = np.zeros((FIN_H, FIN_W, 4), np.float32)
    for i, k in enumerate(FS.ORDER):
        P = PAINT[k]; ox, oy = cell_origin(i)
        atlas[oy:oy + BH, ox:ox + CW] = paint_body(k, i)
        atlas[oy + EYE_Y:oy + EYE_Y + 64, ox + EYE_X:ox + EYE_X + 64] = paint_eye(P)
        atlas[oy + BARB_Y:oy + BARB_Y + 64, ox + BARB_X:ox + BARB_X + 64] = hexc(P.get("lip", "#b0a080"))
        atlas[oy + BARB_Y:oy + BARB_Y + 64, ox:ox + 64] = hexc("#2a1414")
        for v in "ABC":
            fx, fy = fin_origin(i, v)
            fins[fy:fy + FBH, fx:fx + FCW] = paint_fin(k, i, v)
    Image.fromarray(np.clip(atlas, 0, 255).astype(np.uint8)).save(path, quality=74, optimize=True)
    fp = os.path.join(os.path.dirname(path), "fish_fins.png")
    im = Image.fromarray(np.clip(fins, 0, 255).astype(np.uint8), "RGBA")
    im.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(fp, optimize=True)
    return path


ORDER = FS.ORDER

if __name__ == "__main__":
    import sys
    print(paint_atlas(sys.argv[1] if len(sys.argv) > 1 else "fish_atlas.jpg"))
