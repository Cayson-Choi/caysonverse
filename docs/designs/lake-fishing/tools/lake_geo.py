"""Lake geometry as pure numpy (no Blender): the shoreline, the distance fields and the ground height of the lake zone.

Everything reads art/lake/layout.json (D1's export of shared/src/village/lakeLayout.ts): never retype a coordinate.
Game frame: x east, z south, y up, metres. The walkable floor is exactly y = 0, the water surface y = -0.55.

Seam rule (design 4.1): the lake terrain meets the village on a closed boundary loop; on it the height is the piecewise
linear surface of the village's own vertices (`SEAM` samples, filled in Blender from build_village.ground_h /
parts_nature.terrain_h), so the join is watertight whatever my own vertex spacing is.
"""
import json
import math
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
LAKE_ROOT = os.path.dirname(HERE)
LAY = json.load(open(os.path.join(LAKE_ROOT, "layout.json"), encoding="utf-8"))

WATER_Y = LAY["waterY"]
FLOOR_Y = LAY["floorY"]
RAW_SHORE = np.array([[p["x"], p["z"]] for p in LAY["shore"]], float)
WALK = np.array([[p["x"], p["z"]] for p in LAY["walk"]], float)
AREA = LAY["area"]

BANK_W = 1.5          # the mud bank: waterline -> level ground (m)
BANK_P = 1.8          # profile exponent: y = WATER_Y * (1 - s / BANK_W) ** BANK_P
LR = 14.0             # the rise of the hills past the walk limit / the water (m)
LB = 6.0              # the pull towards the village surface near the seam (m)


# ------------------------------------------------------------------------------------------------ polygons

def chaikin(poly, ratio, n):
    p = np.asarray(poly, float)
    for _ in range(n):
        q = np.roll(p, -1, axis=0)
        a = (1 - ratio) * p + ratio * q
        b = ratio * p + (1 - ratio) * q
        p = np.stack([a, b], axis=1).reshape(-1, 2)
    return p


def resample_closed(poly, step):
    p = np.asarray(poly, float)
    q = np.vstack([p, p[:1]])
    seg = np.hypot(*(q[1:] - q[:-1]).T)
    cum = np.concatenate([[0], np.cumsum(seg)])
    n = max(8, int(round(cum[-1] / step)))
    t = np.linspace(0, cum[-1], n, endpoint=False)
    return np.stack([np.interp(t, cum, q[:, 0]), np.interp(t, cum, q[:, 1])], axis=1)


def dist_closed(px, pz, poly, chunk=3000):
    """Distance of points to the nearest edge of a closed polygon."""
    a = np.asarray(poly, float)
    b = np.roll(a, -1, axis=0)
    d = b - a
    l2 = (d ** 2).sum(1)
    px = np.asarray(px, float).ravel()
    pz = np.asarray(pz, float).ravel()
    out = np.empty(px.shape)
    for i in range(0, len(px), chunk):
        x = px[i:i + chunk, None]
        z = pz[i:i + chunk, None]
        t = np.clip(((x - a[:, 0]) * d[:, 0] + (z - a[:, 1]) * d[:, 1]) / np.maximum(l2, 1e-12), 0, 1)
        dx = x - (a[:, 0] + t * d[:, 0])
        dz = z - (a[:, 1] + t * d[:, 1])
        out[i:i + chunk] = np.sqrt(dx * dx + dz * dz).min(axis=1)
    return out


def inside_closed(px, pz, poly):
    a = np.asarray(poly, float)
    b = np.roll(a, -1, axis=0)
    px = np.asarray(px, float)
    pz = np.asarray(pz, float)
    ins = np.zeros(px.shape, bool)
    for (ax, az), (bx, bz) in zip(a, b):
        if az == bz:
            continue
        cond = (az > pz) != (bz > pz)
        xint = ax + (pz - az) * (bx - ax) / (bz - az)
        ins ^= cond & (px < xint)
    return ins


# ---------------------------------------------------------------------------------------------- the shoreline

SHORE = resample_closed(chaikin(RAW_SHORE, 0.15, 2), 0.9)      # the visual waterline (corners softened)


def shore_deviation():
    """Largest distance of the visual waterline from the collider polygon (m)."""
    return float(dist_closed(SHORE[:, 0], SHORE[:, 1], RAW_SHORE).max())


def signed_shore(px, pz):
    """Signed distance to the waterline: negative in the water."""
    d = dist_closed(px, pz, SHORE)
    return np.where(inside_closed(px, pz, SHORE), -d, d)


# ------------------------------------------------------------------------------------------- the seam loop

SEAM = []        # filled by set_seam(): ordered closed loop of (x, z, h)


def set_seam(loop):
    global SEAM
    SEAM = [tuple(map(float, p)) for p in loop]


def domain_polygon():
    """The terrain's outline (the notch at x = 112 included) as the loop of SEAM points' (x, z)."""
    return np.array([[x, z] for x, z, _ in SEAM], float)


def boundary_height(x, z, tol=1e-6):
    """Height on the seam loop at (x, z) if the point lies on it, else None."""
    n = len(SEAM)
    for i in range(n):
        x0, z0, h0 = SEAM[i]
        x1, z1, h1 = SEAM[(i + 1) % n]
        dx, dz = x1 - x0, z1 - z0
        l2 = dx * dx + dz * dz
        if l2 == 0:
            continue
        t = ((x - x0) * dx + (z - z0) * dz) / l2
        if -tol <= t <= 1 + tol and abs((x - x0) * dz - (z - z0) * dx) / math.sqrt(l2) < tol * 10:
            return h0 + (h1 - h0) * min(1.0, max(0.0, t))
    return None


def seam_field(px, pz):
    """Smooth height field that equals the seam heights on the loop (inverse-distance weights of the samples,
    densified along each segment so the interpolation follows the piecewise-linear edge)."""
    pts = []
    n = len(SEAM)
    for i in range(n):
        x0, z0, h0 = SEAM[i]
        x1, z1, h1 = SEAM[(i + 1) % n]
        m = max(1, int(math.hypot(x1 - x0, z1 - z0) / 1.5))
        for k in range(m):
            t = k / m
            pts.append((x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, h0 + (h1 - h0) * t))
    b = np.array(pts)
    px = np.asarray(px, float).ravel()
    pz = np.asarray(pz, float).ravel()
    out = np.empty(px.shape)
    for i in range(0, len(px), 2500):
        x = px[i:i + 2500, None]
        z = pz[i:i + 2500, None]
        d2 = (x - b[:, 0]) ** 2 + (z - b[:, 1]) ** 2 + 0.25
        w = 1.0 / d2 ** 1.5
        out[i:i + 2500] = (w * b[:, 2]).sum(1) / w.sum(1)
    return out


# --------------------------------------------------------------------------------------------------- noise

def vnoise(x, z, seed=0.0):
    """Cheap smooth value noise from sines (deterministic, numpy only), roughly in [-1, 1]."""
    a = np.sin(x * 0.173 + seed) * np.cos(z * 0.131 - seed * 0.7)
    b = np.sin(x * 0.071 - z * 0.093 + seed * 1.9) * 0.8
    c = np.sin(x * 0.311 + z * 0.287 + seed * 0.3) * 0.45 * np.cos(x * 0.113 - z * 0.157)
    d = np.sin(x * 0.67 - z * 0.59 + seed * 2.3) * 0.22
    return (a + b + c + d) / 2.2


def smoothstep(a, b, x):
    t = np.clip((np.asarray(x, float) - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ----------------------------------------------------------------------------------------------- the ground

def shore_fields(px, pz):
    """s (signed distance to the waterline, + on land), walk-polygon distance."""
    s = signed_shore(px, pz)
    inw = inside_closed(px, pz, WALK)
    dwo = np.where(inw, 0.0, dist_closed(px, pz, WALK))
    return s, inw, dwo


def height(px, pz, fields=None):
    """The ground height at the points (arrays); the lake bottom is under the water."""
    px = np.asarray(px, float).ravel()
    pz = np.asarray(pz, float).ravel()
    s, inw, dwo = fields if fields is not None else shore_fields(px, pz)
    s_out = np.maximum(s, 0.0)
    r_in = np.maximum(-s, 0.0)
    bank = WATER_Y * (1 - np.clip(s_out / BANK_W, 0, 1)) ** BANK_P
    # uneven bank: ledges and ruts of the falling water level (only on the unwalkable band, <= 6 cm)
    bank = bank + (0.055 * vnoise(px * 5.3, pz * 5.3, 21.0) + 0.03 * vnoise(px * 13.0, pz * 13.0, 4.0)) * (s_out > 0) * (1 - np.clip(s_out / BANK_W, 0, 1))
    # the lake bottom: shallow at the edge (0.05 m under the water at 1 m), 3 m in the middle
    k = np.clip(r_in / 22.0, 0, 1)
    bottom = -3.0 * (0.3 * k + 0.7 * k * k * (3 - 2 * k)) + 0.06 * vnoise(px, pz, 3.0) * smoothstep(0, 4, r_in)
    # the land beyond the walkable ground: rises towards the village surface
    e = np.minimum(dwo, s_out)
    S = seam_field(px, pz) if SEAM else np.zeros_like(px)
    domain = domain_polygon() if SEAM else None
    db = dist_closed(px, pz, domain) if domain is not None else np.full(px.shape, 99.0)
    wr = smoothstep(0.0, LR, e)
    wb = (1 - smoothstep(0.0, LB, db)) * smoothstep(0.0, 2.2, e)
    w = np.minimum(1.0, wr + wb)
    undul = 0.9 * vnoise(px * 1.0, pz * 1.0, 7.0) + 0.12 * vnoise(px * 2.2, pz * 2.2, 1.0)
    hill = S * w + undul * smoothstep(1.0, 9.0, e) * (1 - wb)
    land = bank + np.where(e > 0, hill, 0.0) * (s_out > 0)
    h = np.where(s < 0, WATER_Y + bottom, land)
    # the 3 cm of settling under the walkable ground is zero: exactly the floor where one walks
    flat = inw & (s_out >= BANK_W)
    h = np.where(flat, 0.0, h)
    return h


def height_fn_scalar():
    def f(x, z):
        return float(height(np.array([x]), np.array([z]))[0])
    return f


# ------------------------------------------------------------------------------------------ cached fields

class Raster:
    """Signed shore distance s and the walk-polygon distance on a 0.5 m raster over the lake zone, for the many point
    queries of the vegetation placement (the exact functions cost ~3 ms a call)."""
    X0, X1, Z0, Z1, STEP = 94.0, 191.0, -71.0, 50.0, 0.5
    _s = _inw = _dwo = None

    @classmethod
    def build(cls):
        if cls._s is not None:
            return
        xs = np.arange(cls.X0, cls.X1, cls.STEP)
        zs = np.arange(cls.Z0, cls.Z1, cls.STEP)
        gx, gz = np.meshgrid(xs, zs)
        px, pz = gx.ravel(), gz.ravel()
        cls._s = signed_shore(px, pz).reshape(gx.shape)
        cls._inw = inside_closed(px, pz, WALK).reshape(gx.shape)
        cls._dwo = np.where(cls._inw, 0.0, dist_closed(px, pz, WALK).reshape(gx.shape))

    @classmethod
    def _idx(cls, x, z):
        i = np.clip(((np.asarray(z) - cls.Z0) / cls.STEP).astype(int), 0, cls._s.shape[0] - 1)
        j = np.clip(((np.asarray(x) - cls.X0) / cls.STEP).astype(int), 0, cls._s.shape[1] - 1)
        return i, j

    @classmethod
    def s(cls, x, z):
        cls.build()
        i, j = cls._idx(x, z)
        return cls._s[i, j]

    @classmethod
    def inwalk(cls, x, z):
        cls.build()
        i, j = cls._idx(x, z)
        return cls._inw[i, j]

    @classmethod
    def dwo(cls, x, z):
        cls.build()
        i, j = cls._idx(x, z)
        return cls._dwo[i, j]
