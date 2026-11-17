"""B3 (lots v2: 마을 절) — paint the `dancheong_wood` atlas (albedo, normal, roughness, AO, metal) for the PBR library.

    python docs/designs/village-lots-v2/tools/temple_dancheong.py <repo>/art/materials/src/local_dancheong_atlas <hinoki normal png>

Hand-made from observation of real 사찰 단청 (general forms only: 연화머리초, 휘, 계풍 비단무늬, 서까래·부연 마구리, 우물반자 연화,
공포 초엽, 수미단 모란, 운문, 금단청 넝쿨): fresh colours (양록·뇌록·삼청·군청·주홍·장단·황·분홍·백·먹), nothing faded. No 卍, no
letters. Layout: temple_atlas.py. The wood under the paint: Poly Haven `hinoki_planks` normal (CC0), the same source as the
library's `wood_pine_natural`. Writes albedo.png, normal.png, rough.png, ao.png, metal.png and source.json (provider "local")
so scripts/build-materials.mjs encodes it like any other set.
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from temple_atlas import ATLAS_PX, BANDS, TILES  # noqa: E402

N = ATLAS_PX
SS = 2  # supersampling


def c(r, g, b):
    return np.array([r, g, b], np.float32) / 255.0


WHITE = c(246, 242, 232)
BLACK = c(30, 28, 28)
LOK = c(66, 140, 112)        # 뇌록/녹청 field
YANG = c(40, 146, 76)        # 양록
HAYEOP = c(30, 88, 56)       # 하엽
SAM = c(78, 166, 206)        # 삼청
GUN = c(32, 62, 150)         # 군청
JU = c(218, 62, 38)          # 주홍
JANG = c(232, 116, 48)       # 장단
SEOK = c(132, 50, 36)        # 석간주
PINK = c(240, 158, 160)      # 분홍
HWANG = c(244, 196, 52)      # 황
GOLD = c(222, 176, 84)       # 금박
RED = c(170, 34, 30)         # 주칠 (lacquer red)
PAINT = c(232, 228, 218)     # neutral paint for tinting

# material classes for the ORM: 0 paint, 1 gold leaf, 2 lacquer, 3 paper
PAINT_M, GOLD_M, LACQ_M, PAPER_M = 0, 1, 2, 3


class Canvas:
    """A region painted at SS x resolution: colour, height (relief) and a material class per pixel."""

    def __init__(self, w, h):
        self.w, self.h = w * SS, h * SS
        self.col = np.zeros((self.h, self.w, 3), np.float32)
        self.hgt = np.zeros((self.h, self.w), np.float32)
        self.mat = np.zeros((self.h, self.w), np.uint8)
        yy, xx = np.mgrid[0:self.h, 0:self.w].astype(np.float32)
        self.x = (xx + 0.5) / SS   # pixel units of the final atlas
        self.y = (yy + 0.5) / SS

    def put(self, mask, col, h=None, mat=None):
        self.col[mask] = col
        if h is not None:
            self.hgt[mask] = h
        if mat is not None:
            self.mat[mask] = mat

    def fill(self, col, mat=PAINT_M):
        self.col[:] = col
        self.mat[:] = mat

    def rect(self, x0, y0, x1, y1, col, h=None, mat=None):
        m = (self.x >= x0) & (self.x < x1) & (self.y >= y0) & (self.y < y1)
        self.put(m, col, h, mat)

    def disc(self, cx, cy, r, col, h=None, mat=None, r0=0.0):
        d = np.hypot(self.x - cx, self.y - cy)
        self.put((d < r) & (d >= r0), col, h, mat)

    def polar(self, cx, cy):
        return np.hypot(self.x - cx, self.y - cy), np.arctan2(self.y - cy, self.x - cx)

    def petals(self, cx, cy, n, r_in, r_out, cols, phase=0.0, sharp=0.75, outline=WHITE, ow=1.6, h=None, mat=None):
        """n pointed lotus petals between r_in and r_out; `cols` a list of colours graded from the base to the tip (휘)."""
        d, a = self.polar(cx, cy)
        seg = 2 * math.pi / n
        t = np.abs(((a - phase) % seg) - seg / 2) / (seg / 2)       # 0 at the petal's axis, 1 between petals
        edge = r_in + (r_out - r_in) * np.clip(1 - t, 0, 1) ** sharp
        inside = (d >= r_in * 0.6) & (d < edge)
        k = np.clip((d - r_in * 0.6) / np.maximum(edge - r_in * 0.6, 1e-3), 0, 0.999)
        idx = (k * len(cols)).astype(int)
        for i, cc in enumerate(cols):
            self.put(inside & (idx == i), cc, h, mat)
        if outline is not None:
            self.put((d < edge) & (d > edge - ow) & (d >= r_in * 0.6), outline)

    def rings(self, cx, cy, spec):
        """Concentric rings from the outside in: [(radius, colour)]."""
        for r, col in spec:
            self.disc(cx, cy, r, col)

    def line_h(self, y, w, col, x0=0, x1=None):
        self.rect(x0, y - w / 2, x1 if x1 is not None else self.w / SS, y + w / 2, col)

    def line_v(self, x, w, col, y0=0, y1=None):
        self.rect(x - w / 2, y0, x + w / 2, y1 if y1 is not None else self.h / SS, col)

    def stroke(self, pts, w, col, h=None, mat=None):
        """A thick polyline (round joins)."""
        m = np.zeros((self.h, self.w), bool)
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            dx, dy = bx - ax, by - ay
            L2 = dx * dx + dy * dy or 1e-6
            t = np.clip(((self.x - ax) * dx + (self.y - ay) * dy) / L2, 0, 1)
            px, py = ax + t * dx, ay + t * dy
            m |= np.hypot(self.x - px, self.y - py) < w / 2
        self.put(m, col, h, mat)

    def ellipse(self, cx, cy, rx, ry, ang, col, h=None, mat=None):
        ca, sa = math.cos(ang), math.sin(ang)
        dx, dy = self.x - cx, self.y - cy
        u = (dx * ca + dy * sa) / rx
        v = (-dx * sa + dy * ca) / ry
        self.put(u * u + v * v < 1, col, h, mat)

    def noise(self, amount, seed, scale=1.0):
        rng = np.random.default_rng(seed)
        n = rng.normal(0, 1, (self.h // 4 + 2, self.w // 4 + 2)).astype(np.float32)
        n = np.array(Image.fromarray(n).resize((self.w, self.h), Image.BICUBIC))
        self.col *= (1 + amount * n * scale)[..., None]

    def down(self):
        col = self.col.reshape(self.h // SS, SS, self.w // SS, SS, 3).mean((1, 3))
        hgt = self.hgt.reshape(self.h // SS, SS, self.w // SS, SS).mean((1, 3))
        mat = self.mat[::SS, ::SS]
        return col, hgt, mat


# ------------------------------------------------------------------------------------------------ motifs --

def rosette(cv, cx, cy, R, warm=True):
    """연화머리초 rosette: green leaf petals (녹화), lotus petals graded 휘, a yellow seed-pod ring, a red heart."""
    cv.petals(cx, cy, 8, R * 0.55, R * 1.0, [HAYEOP, YANG, c(120, 196, 120)], phase=math.pi / 8, sharp=0.6, outline=WHITE, ow=1.8, h=0.3)
    lot = [JU, c(232, 108, 96), PINK, c(250, 214, 210)] if warm else [GUN, SAM, c(160, 210, 232), c(226, 240, 246)]
    lot = lot[::-1]
    cv.petals(cx, cy, 8, R * 0.32, R * 0.8, lot, phase=0.0, sharp=0.7, outline=WHITE, ow=1.6, h=0.45)
    cv.rings(cx, cy, [(R * 0.36, BLACK), (R * 0.33, WHITE), (R * 0.3, HWANG), (R * 0.22, JANG), (R * 0.14, JU), (R * 0.06, WHITE)])
    for k in range(8):  # the seed pod dots
        a = k * math.pi / 4 + math.pi / 8
        cv.disc(cx + math.cos(a) * R * 0.26, cy + math.sin(a) * R * 0.26, R * 0.025, JU)


def hwi_band(cv, x0, x1, y0, y1, cols, vertical=True):
    """휘: parallel stripes graded white -> light -> dark, separated by white and black lines."""
    n = len(cols)
    for i, col in enumerate(cols):
        if vertical:
            a = x0 + (x1 - x0) * i / n
            b = x0 + (x1 - x0) * (i + 1) / n
            cv.rect(a, y0, b, y1, col, h=0.2)
        else:
            a = y0 + (y1 - y0) * i / n
            b = y0 + (y1 - y0) * (i + 1) / n
            cv.rect(x0, a, x1, b, col, h=0.2)


def arcs(cv, cx, cy, r0, r1, cols, xmin, xmax, ymin, ymax):
    """Concentric arc stripes (the 휘 tail of a 머리초) clipped to a box."""
    d = np.hypot(cv.x - cx, cv.y - cy)
    box = (cv.x >= xmin) & (cv.x < xmax) & (cv.y >= ymin) & (cv.y < ymax)
    n = len(cols)
    for i, col in enumerate(cols):
        a = r0 + (r1 - r0) * i / n
        b = r0 + (r1 - r0) * (i + 1) / n
        cv.put(box & (d >= a) & (d < b), col, 0.2)


def scroll(cv, cx, cy, r, turns, w, col, mat=PAINT_M, h=0.4, phase=0.0, sgn=1):
    pts = []
    for i in range(48):
        t = i / 47
        a = phase + sgn * t * turns * 2 * math.pi
        rr = r * (1 - 0.8 * t)
        pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr))
    cv.stroke(pts, w, col, h, mat)


# ------------------------------------------------------------------------------------------------ bands --

def band_beam(w, h, field, warm, seed):
    """A beam side: 머리초 at both ends, 계풍 field between (a light 비단무늬 brocade), white and black edge lines."""
    cv = Canvas(w, h)
    cv.fill(field)
    # brocade lattice in the field: small four-petal flowers on a diamond grid
    step = h * 0.62
    for j in range(-1, 3):
        for i in range(int(w / step) + 2):
            x = i * step + (step / 2 if j % 2 else 0)
            y = h * 0.5 + (j - 0.5) * step * 0.55
            if x < 470 or x > w - 470:
                continue
            for k in range(4):
                a = k * math.pi / 2 + math.pi / 4
                cv.ellipse(x + math.cos(a) * h * 0.06, y + math.sin(a) * h * 0.06, h * 0.06, h * 0.028, a, c(214, 236, 214) if warm else c(220, 234, 246), h=0.15)
            cv.disc(x, y, h * 0.03, HWANG)
    cv.noise(0.035, seed)
    for side in (0, 1):
        def X(v):
            return v if side == 0 else w - v
        def R(a, b):
            return (min(X(a), X(b)), max(X(a), X(b)))
        # the end band (휘 stripes across the beam)
        a, b = R(0, 30)
        hwi_band(cv, a, b, 0, h, [GUN, SAM, WHITE, JU, BLACK] if side == 0 else [BLACK, JU, WHITE, SAM, GUN])
        # the 머리초 ground
        a, b = R(30, 440)
        cv.rect(a, 0, b, h, GUN if warm else HAYEOP)
        # the 휘 tail arcs, half rosettes top and bottom (반엽), the main rosette
        arcs(cv, X(150), h / 2, h * 0.5, h * 1.25, [WHITE, SAM, GUN, BLACK, WHITE, PINK, JU, BLACK], *R(150, 440), 0, h)
        for yy in (0, h):
            rosette(cv, X(330), yy, h * 0.4, warm=not warm)
        rosette(cv, X(150), h / 2, h * 0.47, warm=warm)
        # the 계풍 border
        for k, (d, col) in enumerate(((440, WHITE), (448, BLACK), (456, HWANG), (464, BLACK), (470, WHITE))):
            a, b = R(d, d + 8)
            cv.rect(a, 0, b, h, col, h=0.25)
    # edge lines (분선) along the beam
    for y, col in ((3, WHITE), (8, BLACK), (h - 3, WHITE), (h - 8, BLACK)):
        cv.line_h(y, 4, col)
    return cv


def band_rafter(w, h, field, ends, seed):
    cv = Canvas(w, h)
    cv.fill(field)
    cv.noise(0.03, seed)
    hwi_band(cv, 0, 230, 0, h, ends)
    cv.rect(230, 0, 240, h, WHITE)
    cv.rect(240, 0, 246, h, BLACK)
    for y, col in ((2, WHITE), (h - 2, WHITE)):
        cv.line_h(y, 3, col, 0, 246)
    return cv


def band_column_head(w, h, seed):
    """주의초: a band of 휘 at the top, hanging lotus pendants (repeat 4x) dropping into 석간주."""
    cv = Canvas(w, h)
    cv.fill(SEOK)
    hwi_band(cv, 0, w, 0, h * 0.22, [WHITE, SAM, GUN, BLACK], vertical=False)
    cv.rect(0, h * 0.22, w, h * 0.26, WHITE)
    per = w / 4
    for k in range(8):
        x = (k + 0.5) * per / 2
        big = k % 2 == 0
        L = h * (0.7 if big else 0.5)
        # a downward pointed pendant: graded petal shape
        for i, col in enumerate([GUN, SAM, WHITE] if big else [HAYEOP, YANG, WHITE]):
            s = 1 - i * 0.28
            m = (np.abs(cv.x - x) < (per * 0.18 * s) * np.clip(1 - (cv.y - h * 0.26) / (L * s), 0, 1) ** 0.7) & (cv.y > h * 0.26) & (cv.y < h * 0.26 + L * s)
            cv.put(m, col, 0.3)
        cv.disc(x, h * 0.3, per * 0.05, JU)
    cv.noise(0.03, seed)
    return cv


def band_paint(w, h, seed):
    cv = Canvas(w, h)
    cv.fill(PAINT)
    cv.noise(0.03, seed, 1.0)
    return cv


# ------------------------------------------------------------------------------------------------ tiles --

def tile_rafter_end(n, seed):
    cv = Canvas(n, n)
    cv.fill(BLACK)
    c0 = n / 2
    cv.rings(c0, c0, [(n * 0.5, BLACK), (n * 0.47, WHITE), (n * 0.44, GUN), (n * 0.38, SAM), (n * 0.33, WHITE)])
    cv.petals(c0, c0, 8, n * 0.12, n * 0.33, [c(250, 214, 210), PINK, c(232, 108, 96), JU], sharp=0.65, outline=WHITE, ow=2.0, h=0.4)
    cv.rings(c0, c0, [(n * 0.13, WHITE), (n * 0.11, HWANG), (n * 0.07, JANG), (n * 0.03, JU)])
    cv.noise(0.02, seed)
    return cv


def tile_buyeon_end(n, seed):
    cv = Canvas(n, n)
    cv.fill(YANG)
    cv.rect(n * 0.04, n * 0.04, n * 0.96, n * 0.96, WHITE)
    cv.rect(n * 0.08, n * 0.08, n * 0.92, n * 0.92, HAYEOP)
    cv.rect(n * 0.12, n * 0.12, n * 0.88, n * 0.88, YANG)
    c0 = n / 2
    for k in range(5):  # 매화점: five plum dots round a centre dot
        a = -math.pi / 2 + k * 2 * math.pi / 5
        cv.disc(c0 + math.cos(a) * n * 0.17, c0 + math.sin(a) * n * 0.17, n * 0.1, WHITE, h=0.3)
        cv.disc(c0 + math.cos(a) * n * 0.17, c0 + math.sin(a) * n * 0.17, n * 0.06, PINK, h=0.35)
    cv.disc(c0, c0, n * 0.08, HWANG, h=0.4)
    cv.disc(c0, c0, n * 0.03, JU, h=0.4)
    cv.noise(0.02, seed)
    return cv


def tile_coffer(n, seed):
    """우물반자 panel: a 군청 ground graded to 삼청 round a big 8-petal lotus, 녹화 corners, white and gold rings."""
    cv = Canvas(n, n)
    c0 = n / 2
    d, a = cv.polar(c0, c0)
    cv.fill(HAYEOP)
    cv.rect(n * 0.03, n * 0.03, n * 0.97, n * 0.97, WHITE)
    cv.rect(n * 0.05, n * 0.05, n * 0.95, n * 0.95, GUN)
    k = np.clip(d / (n * 0.48), 0, 1)
    m = (cv.x > n * 0.05) & (cv.x < n * 0.95) & (cv.y > n * 0.05) & (cv.y < n * 0.95)
    cv.col[m] = (SAM * (1 - k[m])[..., None] ** 0.6 + GUN * (k[m])[..., None] ** 0.6) / ((1 - k[m]) ** 0.6 + k[m] ** 0.6)[..., None]
    for (cx, cy) in ((0, 0), (n, 0), (0, n), (n, n)):  # corner quarter flowers
        cv.petals(cx, cy, 8, n * 0.05, n * 0.2, [HAYEOP, YANG, c(150, 210, 140)], sharp=0.6, outline=WHITE, ow=2, h=0.3)
        cv.disc(cx, cy, n * 0.06, JU, h=0.35)
    cv.rings(c0, c0, [(n * 0.43, GOLD), (n * 0.415, WHITE), (n * 0.405, GUN)])
    cv.put((d < n * 0.43) & (d > n * 0.415), GOLD, mat=GOLD_M)
    cv.petals(c0, c0, 8, n * 0.2, n * 0.4, [YANG, c(120, 196, 120), c(200, 236, 200)], phase=math.pi / 8, sharp=0.6, outline=WHITE, ow=2.2, h=0.35)
    cv.petals(c0, c0, 8, n * 0.12, n * 0.31, [JU, c(232, 108, 96), PINK, c(252, 226, 222)][::-1], sharp=0.7, outline=WHITE, ow=2.2, h=0.45)
    cv.rings(c0, c0, [(n * 0.13, WHITE), (n * 0.115, GOLD), (n * 0.09, HWANG), (n * 0.06, JANG), (n * 0.025, JU)])
    cv.put((d < n * 0.115) & (d > n * 0.09), GOLD, mat=GOLD_M)
    cv.noise(0.02, seed)
    return cv


def tile_bracket(n, seed):
    """공포 첨차 face: 양록 ground, paired 초엽 scrolls graded white -> 삼청 -> 군청 with black and white lines, a lotus heart."""
    cv = Canvas(n, n)
    cv.fill(YANG)
    cv.noise(0.03, seed)
    for (cx, cy, r, sgn, ph) in ((0.27, 0.42, 0.2, 1, 0.0), (0.73, 0.42, 0.2, -1, math.pi), (0.14, 0.78, 0.12, -1, 1.0), (0.86, 0.78, 0.12, 1, 2.2),
                                 (0.14, 0.16, 0.1, 1, 2.6), (0.86, 0.16, 0.1, -1, 0.4)):
        for w, col in ((0.11, BLACK), (0.09, WHITE), (0.07, GUN), (0.045, SAM), (0.018, WHITE)):
            scroll(cv, cx * n, cy * n, r * n, 0.9, w * n * r / 0.2, col, sgn=sgn, phase=ph)
    cv.petals(n * 0.5, n * 0.68, 6, n * 0.05, n * 0.16, [JU, c(232, 108, 96), PINK, c(252, 226, 222)][::-1], phase=-math.pi / 2, sharp=0.7, outline=WHITE, ow=2, h=0.4)
    cv.disc(n * 0.5, n * 0.68, n * 0.05, HWANG, h=0.45)
    cv.disc(n * 0.5, n * 0.68, n * 0.02, JU, h=0.45)
    for y in (n * 0.03, n * 0.97):
        cv.line_h(y, n * 0.02, WHITE)
    for x in (n * 0.03, n * 0.97):
        cv.line_v(x, n * 0.02, WHITE)
    return cv


def tile_sumidan(n, seed):
    """수미단 panel: carved peony and lotus in relief, painted on 주칠 with gold edges (a real carved panel's colours)."""
    cv = Canvas(n, n)
    cv.fill(RED, LACQ_M)
    cv.rect(0, 0, n, n * 0.06, GOLD, h=0.5, mat=GOLD_M)
    cv.rect(0, n * 0.94, n, n, GOLD, h=0.5, mat=GOLD_M)
    cv.rect(0, 0, n * 0.04, n, GOLD, h=0.5, mat=GOLD_M)
    cv.rect(n * 0.96, 0, n, n, GOLD, h=0.5, mat=GOLD_M)
    rng = np.random.default_rng(seed)
    # vine and leaves
    scroll(cv, n * 0.5, n * 0.55, n * 0.36, 0.9, n * 0.03, c(46, 120, 64), h=0.6)
    for k in range(9):
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(n * 0.18, n * 0.4)
        cx, cy = n * 0.5 + math.cos(a) * r, n * 0.55 + math.sin(a) * r * 0.8
        cv.ellipse(cx, cy, n * 0.085, n * 0.035, a + 0.6, c(36, 112, 60), h=0.7)
        cv.ellipse(cx, cy, n * 0.06, n * 0.018, a + 0.6, c(80, 160, 90), h=0.8)
    # the peony
    c0, c1 = n * 0.5, n * 0.5
    cv.petals(c0, c1, 10, n * 0.1, n * 0.3, [c(252, 220, 226), c(244, 170, 186), c(214, 84, 112), c(176, 40, 74)][::-1], sharp=0.35, outline=GOLD, ow=2.5, h=0.9)
    cv.petals(c0, c1, 8, n * 0.06, n * 0.2, [c(252, 230, 234), c(240, 160, 180), c(206, 70, 100)][::-1], phase=0.3, sharp=0.4, outline=GOLD, ow=2.0, h=1.0)
    cv.rings(c0, c1, [(n * 0.07, HWANG), (n * 0.04, JANG)])
    # two small lotus buds
    for (x, y) in ((n * 0.18, n * 0.2), (n * 0.82, n * 0.22)):
        cv.petals(x, y, 6, n * 0.03, n * 0.09, [c(250, 230, 226), PINK, JU], sharp=0.7, outline=GOLD, ow=1.6, h=0.8)
    cv.put(cv.mat == GOLD_M, GOLD)
    return cv


def tile_cloud(n, seed):
    """운문: clouds of graded scrolls (white -> 삼청 -> 군청, black line) on 주칠, gold dots."""
    cv = Canvas(n, n)
    cv.fill(RED, LACQ_M)
    rng = np.random.default_rng(seed)
    for (cx, cy, r) in ((0.27, 0.27, 0.24), (0.76, 0.24, 0.2), (0.58, 0.7, 0.27), (0.16, 0.76, 0.17), (0.92, 0.7, 0.14)):
        cx, cy, r = cx * n, cy * n, r * n
        for k in range(5):
            a = k * 2 * math.pi / 5 + rng.uniform(0, 0.4)
            px, py = cx + math.cos(a) * r * 0.6, cy + math.sin(a) * r * 0.45
            for w_, col in ((0.62, BLACK), (0.58, WHITE), (0.5, SAM), (0.34, GUN), (0.16, WHITE)):
                cv.disc(px, py, r * w_ * 0.65, col, h=0.5)
        for w_, col in ((0.95, BLACK), (0.9, WHITE), (0.78, SAM), (0.55, GUN), (0.25, WHITE)):
            cv.ellipse(cx, cy, r * w_, r * w_ * 0.62, 0.0, col, h=0.6)
    for k in range(40):
        cv.disc(rng.uniform(0, n), rng.uniform(0, n), n * 0.008, GOLD, h=0.3, mat=GOLD_M)
    return cv


def tile_gold_scroll(n, seed):
    """금단청 넝쿨: gilded vine scrolls on 주칠 lacquer (닫집 frames, 수미단 rails)."""
    cv = Canvas(n, n)
    cv.fill(RED, LACQ_M)
    for j in range(3):
        for i in range(3):
            cx, cy = (i + 0.5) / 3, (j + 0.5) / 3
            sgn = 1 if (i + j) % 2 else -1
            ph = (i * 1.3 + j * 2.1)
            scroll(cv, cx * n, cy * n, n * 0.14, 1.15, n * 0.022, GOLD, mat=GOLD_M, h=0.6, sgn=sgn, phase=ph)
            for k in range(4):
                a = ph + k * 1.6
                cv.ellipse(cx * n + math.cos(a) * n * 0.1, cy * n + math.sin(a) * n * 0.1, n * 0.035, n * 0.014, a + 0.8, GOLD, h=0.6, mat=GOLD_M)
            cv.disc(cx * n, cy * n, n * 0.02, GOLD, h=0.7, mat=GOLD_M)
    for t in (0.02, 0.98):
        cv.stroke([(0, n * t), (n, n * t)], n * 0.02, GOLD, h=0.5, mat=GOLD_M)
    return cv


def tile_lotus_paper(n, seed):
    """연등 paper: overlapping lotus petals (pink graded to white), rows offset, paper fibres."""
    cv = Canvas(n, n)
    cv.fill(c(252, 236, 236), PAPER_M)
    rows = 6
    for j in range(rows + 1):
        for i in range(7):
            x = (i + (0.5 if j % 2 else 0)) * n / 6
            y = n - j * n / rows
            for k, col in enumerate((c(226, 90, 120), c(240, 140, 160), c(250, 196, 206), c(254, 236, 238))):
                s = 1 - k * 0.22
                m = (np.abs(cv.x - x) < (n / 12) * s * np.clip((y - cv.y) / (n / rows * 1.4 * s), 0, 1) ** 0.5 * np.clip(1 - (y - cv.y) / (n / rows * 1.4 * s), 0, 1) ** 0.3 * 2.2) & (cv.y < y) & (cv.y > y - n / rows * 1.4 * s)
                cv.put(m, col, 0.2, PAPER_M)
    cv.noise(0.04, seed)
    return cv


def tile_kkotsal(n, seed):
    """빗꽃살: a diagonal lattice (raised, fresh 석간주-red wood) with four-petal flowers at every crossing (green, red, white
    graded), 창호지 showing in the openings. 6 x 6 crossings per tile (one door panel)."""
    cv = Canvas(n, n)
    cv.fill(c(246, 238, 220), PAPER_M)
    cv.hgt[:] = -0.6
    k = 6
    p = n / k
    d1 = np.abs(((cv.x + cv.y) / p) % 1 - 0.5)
    d2 = np.abs(((cv.x - cv.y) / p) % 1 - 0.5)
    bar = (d1 > 0.40) | (d2 > 0.40)
    cv.put(bar, c(150, 66, 44), 0.6, PAINT_M)
    for j in range(k + 1):
        for i in range(k + 1):
            for (x, y) in ((i * p, j * p), ((i + 0.5) * p, (j + 0.5) * p)):
                cv.petals(x, y, 4, p * 0.08, p * 0.4, [c(40, 126, 72), c(110, 186, 120), c(226, 246, 226)], phase=math.pi / 4, sharp=0.5, outline=None, h=0.9)
                cv.petals(x, y, 4, p * 0.05, p * 0.27, [JU, PINK, c(252, 230, 226)], phase=0, sharp=0.5, outline=None, h=1.0)
                cv.disc(x, y, p * 0.07, HWANG, h=1.0)
    m = (cv.x < n * 0.03) | (cv.x > n * 0.97) | (cv.y < n * 0.03) | (cv.y > n * 0.97)
    cv.put(m, c(150, 66, 44), 0.7, PAINT_M)
    cv.noise(0.02, seed)
    return cv


def tile_hanji(w, h, seed):
    cv = Canvas(w, h)
    cv.fill(c(248, 242, 228), PAPER_M)
    cv.noise(0.05, seed, 1.0)
    return cv


# ------------------------------------------------------------------------------------------------ main --

def main():
    out = sys.argv[1]
    wood_n = sys.argv[2]
    os.makedirs(out, exist_ok=True)
    col = np.zeros((N, N, 3), np.float32)
    hgt = np.zeros((N, N), np.float32)
    mat = np.zeros((N, N), np.uint8)

    def place(region, cv):
        u0, v0, u1, v1 = region
        x0, y0 = int(round(u0 * N)), int(round((1 - v1) * N))
        cc, hh, mm = cv.down()
        col[y0:y0 + cc.shape[0], x0:x0 + cc.shape[1]] = cc
        hgt[y0:y0 + cc.shape[0], x0:x0 + cc.shape[1]] = hh
        mat[y0:y0 + cc.shape[0], x0:x0 + cc.shape[1]] = mm

    def size(r):
        return int(round((r[2] - r[0]) * N)), int(round((r[3] - r[1]) * N))

    w, h = size(BANDS["beam_a"]); place(BANDS["beam_a"], band_beam(w, h, LOK, True, 1))
    w, h = size(BANDS["beam_b"]); place(BANDS["beam_b"], band_beam(w, h, c(70, 150, 186), False, 2))
    w, h = size(BANDS["rafter"]); place(BANDS["rafter"], band_rafter(w, h, YANG, [BLACK, WHITE, GUN, SAM, WHITE, JU, BLACK], 3))
    w, h = size(BANDS["buyeon"]); place(BANDS["buyeon"], band_rafter(w, h, SAM, [BLACK, WHITE, YANG, HAYEOP, WHITE, JANG, BLACK], 4))
    w, h = size(BANDS["column_head"]); place(BANDS["column_head"], band_column_head(w, h, 5))
    w, h = size(BANDS["paint"]); place(BANDS["paint"], band_paint(w, h, 6))
    w, h = size(TILES["hanji"]); place(TILES["hanji"], tile_hanji(w, h, 30))
    makers = {"rafter_end": tile_rafter_end, "buyeon_end": tile_buyeon_end, "kkotsal": tile_kkotsal, "coffer": tile_coffer, "bracket": tile_bracket,
              "sumidan": tile_sumidan, "cloud": tile_cloud, "gold_scroll": tile_gold_scroll, "lotus_paper": tile_lotus_paper}
    for i, (name, fn) in enumerate(makers.items()):
        r = TILES[name]
        place(r, fn(size(r)[0], 10 + i))
    # the unused strip (v 0.18..0.5 is all bands; 0.5..1 tiles) — nothing left blank
    col = np.clip(col, 0, 1)
    Image.fromarray((col * 255 + 0.5).astype(np.uint8)).save(os.path.join(out, "albedo.png"))
    # normal: the wood grain under the paint + the paint's relief (lines, carved panels)
    wn = np.asarray(Image.open(wood_n).convert("RGB").resize((N, N), Image.LANCZOS), np.float32) / 255.0 * 2 - 1
    hb = np.array(Image.fromarray(hgt).resize((N // 2, N // 2), Image.BILINEAR).resize((N, N), Image.BILINEAR))
    gy, gx = np.gradient(hb)
    k = 6.0
    nx = wn[..., 0] * 0.55 - gx * k
    ny = wn[..., 1] * 0.55 + gy * k
    nz = np.maximum(wn[..., 2], 0.2)
    L = np.sqrt(nx * nx + ny * ny + nz * nz)
    nrm = np.stack([nx / L, ny / L, nz / L], -1) * 0.5 + 0.5
    Image.fromarray((nrm * 255 + 0.5).astype(np.uint8)).save(os.path.join(out, "normal.png"))
    rough = np.where(mat == GOLD_M, 0.32, np.where(mat == LACQ_M, 0.42, np.where(mat == PAPER_M, 0.85, 0.6))).astype(np.float32)
    rough += (np.random.default_rng(7).normal(0, 0.03, (N, N))).astype(np.float32)
    Image.fromarray((np.clip(rough, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(out, "rough.png"))
    ao = 1 - 0.35 * np.clip(hb.max() * 0 + (np.array(Image.fromarray(hgt).resize((N // 8, N // 8), Image.BILINEAR).resize((N, N), Image.BILINEAR)) - hgt), 0, 1)
    Image.fromarray((np.clip(ao, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(out, "ao.png"))
    metal = np.where(mat == GOLD_M, 1.0, 0.0).astype(np.float32)
    Image.fromarray((metal * 255).astype(np.uint8)).save(os.path.join(out, "metal.png"))
    src = {"provider": "local", "asset": "dancheong_atlas", "page": "https://github.com/Cayson-Choi/caysonverse/blob/main/docs/designs/village-lots-v2/tools/temple_dancheong.py",
           "license": "CC0 1.0 Universal",  # own work (lots v2 B3), dedicated CC0; the wood grain normal is Poly Haven hinoki_planks (CC0)
           "files": {"albedo": "albedo.png", "normal": "normal.png", "rough": "rough.png", "ao": "ao.png", "metal": "metal.png"},
           "sourceFiles": [], "authors": ["caysonverse lots v2 B3"]}
    with open(os.path.join(out, "source.json"), "w", encoding="utf-8") as f:
        json.dump(src, f, indent=2)
    print("wrote", out)


if __name__ == "__main__":
    main()
