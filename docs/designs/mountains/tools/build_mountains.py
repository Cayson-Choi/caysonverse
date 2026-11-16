"""
B6 distant mountains (2026-11-16): layered ridge rings round 케이슨 마을, generated procedurally and shipped as a small
runtime asset the client builds its mesh from (no village.glb rebake needed).

Output (client/public/models/village/):
  mountains.v1.bin   the ridge grid: per layer, per (azimuth column, row) the radius and height of a vertex (uint16)
  mountains.v1.webp  the colour atlas: one horizontal strip per layer, u = azimuth (north = 0, clockwise, wraps),
                     v = the row parameter t (0 = foot of the face, 1 = crest). Lit albedo, NO haze (the runtime adds the
                     aerial perspective and the time-of-day tint, client/src/village/mountains.ts).
Preview (--preview DIR): an equirectangular panorama from the plaza with a constant day haze, for quick iteration.

Usage:  python -I docs/designs/mountains/tools/build_mountains.py [--out client/public/models/village] [--preview DIR]

Coordinates are the game's (three.js): x east, y up, z south; azimuth clockwise from north (-z): x = r sin(az), z = -r cos(az).

The shape (real Korean valley views, art/village/refs/mountains/): several overlapping ridgelines that recede into haze.
Each layer is a ring: its crest line is a rounded fractal profile on the circle (peaks, saddles, long undulating
ridges, no jagged triangles); its crest wanders in and out (spurs); its face rises from the foot (t = 0, ground level,
hidden behind the layer in front) with an S profile, cut by ravines that run down the face. The colour bake samples the
same surface at texture resolution (finer ravines and the forest's crowns only in the texture), lights it with the
village's baked afternoon sun (az 70°, 28° up) and a sky ambient, and adds granite outcrops near crests and on steep
spurs, pine/deciduous patches, and the crowns' shading on the near layers.
"""
import argparse, json, math, os, struct, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))

SUN_AZ, SUN_EL = 70.0, 28.0          # the village's baked afternoon sun (dayNightBlend.ts DAY_SUN_DIRECTION)
LOW_AZ = 70.0                        # the valley opens east-north-east (over the lake, toward the sunset glow): lower ridges there

# Layers, near to far. R: crest radius (m) and its wander; Rin: the foot; H: crest height range (m, above y = 0);
# segs x rows: the mesh grid; tex: atlas rows; crowns: the forest's crown size in the texture (m), 0 = none.
LAYERS = [
    dict(name="near", Rin=215.0, R=410.0, dR=70.0, H=(34.0, 92.0), segs=768, rows=10, tex=352, crowns=5.0, rough=2.2, west=0.3, seed=11, freq=5.0, ravine=0.20),
    dict(name="mid", Rin=380.0, R=660.0, dR=95.0, H=(70.0, 165.0), segs=512, rows=8, tex=208, crowns=8.0, rough=3.0, west=0.18, seed=23, freq=4.2, ravine=0.17),
    dict(name="far", Rin=600.0, R=940.0, dR=95.0, H=(120.0, 245.0), segs=320, rows=6, tex=128, crowns=0.0, rough=2.0, seed=37, freq=3.6, ravine=0.14),
    dict(name="farthest", Rin=900.0, R=1255.0, dR=55.0, H=(160.0, 320.0), segs=256, rows=5, tex=96, crowns=0.0, rough=1.5, seed=53, freq=3.0, ravine=0.10),
]
ATLAS_W = 4096
PAD = 8                              # atlas rows between strips (mip bleeding)
BASE_Y = 1.0                         # the foot of every face (under the village's own backdrop hills at r 215..255)
H_STEP = 0.05                        # metres per uint16 step (radius and height)
H_OFFSET = -100.0                    # height = H_OFFSET + q * H_STEP


# ------------------------------------------------------------------------------------------------ noise --

class Noise:
    """2D gradient (Perlin) noise, vectorised; fbm and ridged sums; seamless circle sampling."""

    def __init__(self, seed):
        rng = np.random.default_rng(seed)
        self.p = np.concatenate([rng.permutation(256)] * 2)
        a = rng.uniform(0, 2 * np.pi, 256)
        self.g = np.stack([np.cos(a), np.sin(a)], -1)

    def __call__(self, x, y):
        xi, yi = np.floor(x).astype(np.int64), np.floor(y).astype(np.int64)
        xf, yf = x - xi, y - yi
        xi &= 255
        yi &= 255
        p, g = self.p, self.g

        def grad(ix, iy, dx, dy):
            h = p[p[ix] + iy]
            return g[h, 0] * dx + g[h, 1] * dy
        u = xf * xf * xf * (xf * (xf * 6 - 15) + 10)
        v = yf * yf * yf * (yf * (yf * 6 - 15) + 10)
        n00 = grad(xi, yi, xf, yf)
        n10 = grad(xi + 1, yi, xf - 1, yf)
        n01 = grad(xi, yi + 1, xf, yf - 1)
        n11 = grad(xi + 1, yi + 1, xf - 1, yf - 1)
        return ((n00 * (1 - u) + n10 * u) * (1 - v) + (n01 * (1 - u) + n11 * u) * v) * 1.41

    def fbm(self, x, y, octaves=5, gain=0.5, lac=2.03):
        s, a, f, norm = 0.0, 1.0, 1.0, 0.0
        for o in range(octaves):
            s = s + a * self(x * f + o * 17.3, y * f - o * 9.1)
            norm += a
            a *= gain
            f *= lac
        return s / norm

    def ridged(self, x, y, octaves=4, gain=0.5, lac=2.1):
        s, a, f, norm = 0.0, 1.0, 1.0, 0.0
        for o in range(octaves):
            s = s + a * (1 - np.abs(self(x * f + o * 31.7, y * f + o * 5.3)))
            norm += a
            a *= gain
            f *= lac
        return s / norm


def circ(n, theta, radius, fn="fbm", **kw):
    """Noise on a circle of `radius` (in noise units) at angle theta: wraps seamlessly at 2π."""
    return getattr(n, fn)(np.cos(theta) * radius + 100.0, np.sin(theta) * radius - 50.0, **kw)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def az_diff(theta_deg, ref):
    d = np.abs((theta_deg - ref + 180.0) % 360.0 - 180.0)
    return d


# -------------------------------------------------------------------------------------------- the shape --

class Layer:
    def __init__(self, spec):
        self.s = spec
        self.n = Noise(spec["seed"])
        self.n2 = Noise(spec["seed"] + 1000)

    def crest(self, theta):
        """Crest radius and height at azimuth theta (radians from north, clockwise)."""
        s, n = self.s, self.n
        f = s["freq"]
        # the crest's radius wanders (spurs reaching forward, bays set back)
        rc = s["R"] + s["dR"] * circ(n, theta, f * 0.55, "fbm", octaves=3)
        # the profile: long undulating ridges (fbm) with a few higher massifs (ridged, low frequency), rounded tops
        big = circ(n, theta, f * 0.45, "fbm", octaves=2)                      # massifs
        mid = circ(self.n2, theta, f, "fbm", octaves=5, gain=0.42)            # the ridgeline's undulation
        peaks = circ(n, theta, f * 1.3, "ridged", octaves=3)                   # rounded peaks between saddles
        shape = 0.5 + 0.55 * big + 0.42 * mid + 0.28 * (peaks - 0.62)
        shape = np.clip(shape, 0.0, 1.25)
        # rounded tops: compress the highest part a little (Korean ridges are rounded, not spiky)
        shape = np.where(shape > 0.85, 0.85 + (shape - 0.85) * 0.6, shape)
        lo, hi = s["H"]
        deg = np.degrees(theta) % 360.0
        low = 1 - 0.42 * np.exp(-(az_diff(deg, LOW_AZ) / 42.0) ** 2)          # the valley's open side
        hc = (lo + (hi - lo) * shape) * low
        # behind the waterfall (west-north-west): the near ranges stand higher, above the falls' wooded plateau
        hc = hc * (1 + s.get("west", 0.0) * np.exp(-(az_diff(deg, 280.0) / 38.0) ** 2))
        # the forest on the crest (near layers): a fine bumpy line, crowns against the sky
        if s["crowns"] > 0:
            k = 2 * np.pi * s["R"] / s["crowns"]
            hc = hc + s["crowns"] * 0.28 * (0.5 + 0.5 * circ(self.n2, theta, k / (2 * np.pi), "fbm", octaves=2))
        return rc, hc

    def surface(self, theta, t, fine=False):
        """World (x, y, z) of the face at azimuth theta and row parameter t (0 foot .. 1 crest); arrays broadcast."""
        s = self.s
        rc, hc = self.crest(theta)
        rin = s["Rin"] + 0.25 * (rc - s["R"])
        r = rin + (rc - rin) * t
        # S profile: gentle foothills, steep middle, rounded top
        prof = 0.5 - 0.5 * np.cos(np.pi * np.clip(t, 0, 1) ** 0.82)
        # ravines down the face: V-shaped grooves (|noise| near 0), meandering with t; vanish at the crest and foot
        f = s["freq"] * 1.3
        warp = 0.18 * self.n(np.cos(theta) * f * 0.5 + 3.0, np.sin(theta) * f * 0.5 + t * 1.5)
        g1 = np.abs(self.n(np.cos(theta) * f + warp, np.sin(theta) * f + t * 0.45))
        rav = (1 - smoothstep(0.0, 0.42, g1)) * 0.75
        if fine:
            f2 = f * 3.1
            g2 = np.abs(self.n2(np.cos(theta) * f2 + warp * 1.6, np.sin(theta) * f2 + t * 1.3))
            rav = rav + (1 - smoothstep(0.0, 0.25, g2)) * 0.28
        env = np.sin(np.pi * np.clip(t, 0, 1)) ** 0.9
        y = BASE_Y + (hc - BASE_Y) * prof - s["ravine"] * hc * rav * env
        if fine:
            # small relief (rocky knolls, terraces of the slope)
            y = y + s["rough"] * self.n.fbm(theta * s["R"] / 18.0, t * (rc - rin) / 18.0, octaves=3) * env
        x = r * np.sin(theta)
        z = -r * np.cos(theta)
        return x, y, z


# ------------------------------------------------------------------------------------------ colour bake --

def srgb(hex_):
    return np.array([int(hex_[i:i + 2], 16) / 255.0 for i in (1, 3, 5)])


PINE = srgb("#2A3C24")
DECID = srgb("#4F6A34")
FRESH = srgb("#6B8442")
ROCK = srgb("#9A968A")
SOIL = srgb("#7E7458")


def bake(layer, rows, idx):
    s = layer.s
    W = ATLAS_W
    theta = (np.arange(W) + 0.5) / W * 2 * np.pi
    t = (np.arange(rows) + 0.5) / rows
    TH, T = np.meshgrid(theta, t)                 # (rows, W); row 0 = foot
    x, y, z = layer.surface(TH, T, fine=True)
    # tangents by finite differences of the same surface (normals of the fine relief)
    e_t, e_th = 0.5 / rows, 0.5 / W * 2 * np.pi
    xa, ya, za = layer.surface(TH + e_th, T, fine=True)
    xb, yb, zb = layer.surface(TH, T + e_t, fine=True)
    du = np.stack([xa - x, ya - y, za - z], -1)
    dv = np.stack([xb - x, yb - y, zb - z], -1)
    nrm = np.cross(dv, du)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True) + 1e-9
    # face the viewer (the ring's inside): the normal must point toward the centre / up
    inward = -np.stack([np.sin(TH), np.zeros_like(TH), -np.cos(TH)], -1)
    flip = np.sign(np.sum(nrm * (inward + np.array([0, 0.3, 0])), -1, keepdims=True))
    nrm *= np.where(flip == 0, 1, flip)
    up = nrm[..., 1]
    sun = np.array([math.sin(math.radians(SUN_AZ)) * math.cos(math.radians(SUN_EL)), math.sin(math.radians(SUN_EL)),
                    -math.cos(math.radians(SUN_AZ)) * math.cos(math.radians(SUN_EL))])
    ndl = np.clip(np.sum(nrm * sun, -1), 0, 1)
    # surface coordinates in metres (for patches and crowns)
    rc, hc = layer.crest(TH)
    su = TH * s["R"]                                    # along the ring
    sv = T * np.hypot(rc - s["Rin"], hc)                # up the face (slope length)
    n, n2 = layer.n, layer.n2
    # forest mix: pine (dark) / deciduous (fresh spring green) in patches; pines more on ridges and crests
    patch = 0.5 + 0.5 * n2.fbm(su / 140.0, sv / 140.0, octaves=4)
    ridge_k = smoothstep(0.55, 1.0, T)
    pine_k = np.clip(patch * 1.2 - 0.25 + 0.25 * ridge_k, 0, 1)
    fresh_k = smoothstep(0.68, 0.9, 0.5 + 0.5 * n.fbm(su / 60.0 + 7, sv / 60.0, octaves=3)) * (1 - pine_k)
    alb = PINE[None, None] * pine_k[..., None] + DECID[None, None] * (1 - pine_k[..., None])
    alb = alb * (1 - fresh_k[..., None]) + FRESH * fresh_k[..., None]
    # rock: granite outcrops on steep spurs and near crests, sparse; a little bare soil on the steepest bits
    steep = 1 - up
    rk = n.ridged(su / 45.0 + 50, sv / 30.0, octaves=3)
    rock_k = smoothstep(0.86, 0.96, rk * (0.75 + 0.5 * steep) + 0.18 * ridge_k) * (0.4 + 0.6 * smoothstep(0.25, 0.6, steep))
    if idx >= 2:
        rock_k = rock_k * 0.6
    alb = alb * (1 - rock_k[..., None]) + ROCK * rock_k[..., None]
    soil_k = smoothstep(0.55, 0.75, steep) * 0.35 * (1 - rock_k)
    alb = alb * (1 - soil_k[..., None]) + SOIL * soil_k[..., None]
    # crowns (near layers): jittered cells in surface metres; each a dome lit from the sun, dark gaps between
    shade = np.ones_like(T)
    if s["crowns"] > 0:
        c = s["crowns"]
        gu, gv = su / c, sv / c
        iu, iv = np.floor(gu), np.floor(gv)
        best = np.full(gu.shape, 9.0)
        bdx = np.zeros_like(gu)
        bdy = np.zeros_like(gu)
        bid = np.zeros_like(gu)
        for oy in (-1, 0, 1):
            for ox in (-1, 0, 1):
                cu, cv = iu + ox, iv + oy
                h = np.sin(cu * 127.1 + cv * 311.7) * 43758.5453
                jx = h - np.floor(h)
                h2 = np.sin(cu * 269.5 + cv * 183.3) * 43758.5453
                jy = h2 - np.floor(h2)
                dx = cu + 0.15 + 0.7 * jx - gu
                dy = cv + 0.15 + 0.7 * jy - gv
                d = dx * dx + dy * dy
                m = d < best
                best = np.where(m, d, best)
                bdx = np.where(m, dx, bdx)
                bdy = np.where(m, dy, bdy)
                bid = np.where(m, jx * 0.6 + jy * 0.4, bid)
        dist = np.sqrt(best) / 0.62                       # 0 centre .. ~1 edge of a crown
        dome = np.sqrt(np.clip(1 - dist * dist, 0, 1))
        # the crown's lit side: toward the sun along the ring (sun on the right of a face seen from the centre or not)
        side = np.sign(np.sin(np.radians(SUN_AZ)) * np.cos(TH) - (-np.cos(np.radians(SUN_AZ))) * np.sin(TH) * -1)
        lit = 0.7 + 0.3 * np.clip(-bdx * side * 1.6 + bdy * 0.9, -1, 1)
        shade = np.where(dist < 1.0, (0.55 + 0.45 * dome) * lit, 0.42)
        shade = shade * (0.88 + 0.24 * bid)              # crown-to-crown variation
        shade = shade * (1 - rock_k) + rock_k * (0.9 + 0.2 * n.fbm(su / 3.0, sv / 3.0, octaves=2))
        alb = alb * (0.94 + 0.12 * bid[..., None] * (1 - rock_k[..., None]))
    # light: sky ambient (more on up-facing) + the afternoon sun
    light = 0.40 + 0.16 * up + 0.78 * ndl
    col = alb * (light * shade)[..., None]
    # near layers: a little more colour (the photos' near ridges read green, not grey, through the light haze)
    if idx <= 1:
        g = col.mean(-1, keepdims=True)
        col = (g + (col - g) * 1.25) * 1.06
    # far layers: softer, less contrast (their relief is broad); never pure black
    if idx >= 2:
        g = col.mean(-1, keepdims=True)
        col = g + (col - g) * 0.85
    col = np.clip(col, 0.02, 1.0)
    img = (col[::-1] * 255 + 0.5).astype(np.uint8)  # image row 0 = top = crest (texture v up = t)
    return img


# ------------------------------------------------------------------------------------------- the grid --

def grid(layer):
    s = layer.s
    N, R = s["segs"], s["rows"]
    theta = np.arange(N) / N * 2 * np.pi
    # rows denser near the crest (the silhouette and the visible upper face)
    t = 1 - (1 - np.linspace(0, 1, R)) ** 1.35
    TH, T = np.meshgrid(theta, t)
    x, y, z = layer.surface(TH, T, fine=False)
    r = np.hypot(x, z)
    return t, r, y


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(REPO, "client", "public", "models", "village"))
    ap.add_argument("--preview", default=None)
    ap.add_argument("--quality", type=int, default=80)
    a = ap.parse_args()
    layers = [Layer(s) for s in LAYERS]
    # ---- atlas
    strips, v0 = [], 0
    meta = []
    total_rows = sum(s["tex"] for s in LAYERS) + PAD * len(LAYERS)
    atlas = np.zeros((total_rows, ATLAS_W, 3), np.uint8)
    for i, L in enumerate(layers):
        rows = L.s["tex"]
        img = bake(L, rows, i)
        top = v0 + PAD // 2
        atlas[top:top + rows] = img
        atlas[v0:top] = img[0]
        atlas[top + rows:top + rows + PAD // 2] = img[-1]
        # v in GL convention (0 = bottom of the image): crest row at the strip's top
        vb = 1 - (top + rows - 0.5) / total_rows        # foot (t = 0)
        vt = 1 - (top + 0.5) / total_rows               # crest (t = 1)
        meta.append((vb, vt))
        v0 += rows + PAD
        print(f"baked {L.s['name']}: {rows} rows")
    os.makedirs(a.out, exist_ok=True)
    tex_path = os.path.join(a.out, "mountains.v1.webp")
    Image.fromarray(atlas).save(tex_path, "WEBP", quality=a.quality, method=6)
    # ---- grid file: magic 'MTN1', u32 layer count; per layer: u32 segs, u32 rows, f32 vFoot, f32 vCrest, f32 hazeBias,
    # rows x f32 t; then segs*rows u16 radius (q * H_STEP), segs*rows u16 height (H_OFFSET + q * H_STEP), row-major (row, seg)
    out = bytearray(b"MTN1")
    out += struct.pack("<I", len(layers))
    tris = 0
    body = bytearray()
    for i, L in enumerate(layers):
        t, r, y = grid(L)
        N, R = L.s["segs"], L.s["rows"]
        out += struct.pack("<IIfff", N, R, meta[i][0], meta[i][1], float(i) / (len(layers) - 1))
        out += np.asarray(t, "<f4").tobytes()
        qr = np.clip(np.round(r / H_STEP), 0, 65535).astype("<u2")
        qy = np.clip(np.round((y - H_OFFSET) / H_STEP), 0, 65535).astype("<u2")
        body += qr.tobytes() + qy.tobytes()
        tris += N * (R - 1) * 2
        el = np.degrees(np.arctan2(y[-1] - 1.6, r[-1]))
        print(f"layer {L.s['name']}: {N}x{R} = {N * (R - 1) * 2} tris; crest r {r[-1].min():.0f}..{r[-1].max():.0f} m, "
              f"h {y[-1].min():.0f}..{y[-1].max():.0f} m, elevation {el.min():.1f}..{el.max():.1f} deg")
    out += body
    bin_path = os.path.join(a.out, "mountains.v1.bin")
    open(bin_path, "wb").write(bytes(out))
    print("tris", tris, "bin", len(out), "bytes", "webp", os.path.getsize(tex_path), "bytes", atlas.shape)
    if a.preview:
        preview(layers, atlas, meta, a.preview)


# ------------------------------------------------------------------------------------------ preview --

def preview(layers, atlas, meta, out_dir, eye=(0.0, 1.6, 14.0)):
    """Equirectangular strip (azimuth 0..360, elevation -2..22°) from the plaza: texel splats with a z-buffer and a day haze."""
    os.makedirs(out_dir, exist_ok=True)
    W, H = 2400, 300
    e0, e1 = -2.0, 22.0
    sky_hz = srgb("#AFC0CF")
    sky_top = srgb("#7FA2C6")
    img = np.zeros((H, W, 3))
    for j in range(H):
        e = e1 - (j + 0.5) / H * (e1 - e0)
        k = smoothstep(0, 20, e)
        img[j] = sky_hz * (1 - k) + sky_top * k
    acc = []
    for i, L in enumerate(layers):
        s = L.s
        rows = s["tex"] * 2
        theta = (np.arange(W * 2) + 0.5) / (W * 2) * 2 * np.pi
        t = (np.arange(rows) + 0.5) / rows
        TH, T = np.meshgrid(theta, t)
        x, y, z = L.surface(TH, T, fine=True)
        top = (1 - meta[i][1]) * atlas.shape[0]
        bot = (1 - meta[i][0]) * atlas.shape[0]
        ry = np.clip((bot + (top - bot) * T).astype(int), 0, atlas.shape[0] - 1)
        rx = np.clip((TH / (2 * np.pi) * ATLAS_W).astype(int), 0, ATLAS_W - 1)
        c = atlas[ry, rx] / 255.0
        dx, dy, dz = x - eye[0], y - eye[1], z - eye[2]
        d = np.sqrt(dx * dx + dy * dy + dz * dz)
        az = (np.degrees(np.arctan2(dx, -dz)) % 360.0)
        el = np.degrees(np.arctan2(dy, np.hypot(dx, dz)))
        px = (az / 360 * W).astype(int) % W
        py = ((e1 - el) / (e1 - e0) * H).astype(int)
        hz = 1 - np.exp(-np.maximum(d - 100, 0) / 760.0)
        valley = (1 - T) ** 1.5 * 0.55
        hz = hz + valley * (1 - hz)
        c = c * (1 - hz[..., None]) + sky_hz * hz[..., None]
        ok = (py >= 0) & (py < H)
        acc.append((py[ok], px[ok], d[ok], c[ok]))
    py = np.concatenate([a[0] for a in acc]); px = np.concatenate([a[1] for a in acc])
    d = np.concatenate([a[2] for a in acc]); c = np.concatenate([a[3] for a in acc])
    o = np.argsort(-d)  # far to near: later writes win
    for k in range(3):
        img[np.clip(py[o] + k, 0, H - 1), px[o]] = c[o]
    im = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))
    im.save(os.path.join(out_dir, "panorama.png"))
    print("preview", os.path.join(out_dir, "panorama.png"))


if __name__ == "__main__":
    main()
