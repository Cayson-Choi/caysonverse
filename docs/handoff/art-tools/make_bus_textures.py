"""Textures for the village bus (마을버스), drawn by script (no photos, no AI): system Python 3 + Pillow + numpy.

  python art/village/tools/make_bus_textures.py [--livery opt1|opt2|opt3] [--out <dir>]

Writes art/village/work/tex_bus/ (or --out):
  bus_base.png  1024^2 sRGB  base colour atlas: livery of both sides, the front face, the rear face, the bumper's
                reflectors, tyre tread and sidewall, the two rims, pictograms, the blank plate, louvres, the wordmark
                decal ("☾ 케이슨 마을" in Jua), colour swatches
  bus_orm.png    512^2       R = clear-coat mask, G = roughness, B = metalness
  bus_emit.png   512^2 sRGB  what glows at night (lamps, LED dots, the lit interior)
  bus_led.png    512x256     the three LED destination signs in amber dots: 케이슨 마을 (front, kerb side), 마을버스 (rear)
  bus_atlas.json the regions (px), swatch cells, and the wordmark decals' placement build_bus.py wordmarks() reads

Livery r4 (2026-11-11, owner: "케이슨 마을에 어울리는 버스 색상과 옆에 뒤에 표시해야지. 이렇게 무늬 들어간거 너무 촌스럽잖아"):
calm, plain bands from the village's palette (no swoosh, no gradient, at most one thin horizontal line), the village's
name on both sides below the windows and on the rear under the rear window (a decal with its own ~450 px/m region:
the side regions are only ~114 px/m), no round badge. Three options in LIVERIES; CHOSEN is the one built.
Fonts: art/village/fonts/Jua-Regular.ttf (SIL OFL, the village UI's display font), C:/Windows/Fonts/malgunbd.ttf (LED).
"""
import argparse
import json
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
CHOSEN = "opt1"                       # the owner's pick: opt1 | opt2 | opt3 (LIVERIES below)
ap.add_argument("--livery", default=CHOSEN)
ap.add_argument("--out", default=None)
ARGS = ap.parse_args()
OUT = ARGS.out or os.path.join(os.path.dirname(HERE), "work", "tex_bus")
os.makedirs(OUT, exist_ok=True)

JUA = os.path.join(os.path.dirname(HERE), "fonts", "Jua-Regular.ttf")      # the village UI's display font (SIL OFL)
LED_FONT = "C:/Windows/Fonts/malgunbd.ttf"                                   # bold gothic, drawn as 1-bit LED dots

N = 1024          # base atlas size
SS = 2            # supersampling for the base canvas
BUS_L = 9.0       # bus length (m), xf = distance from the front face

# ------------------------------------------------------------------------------------------------ liveries --
# body: the panels below the windows, the front below the windscreen, the rear; skirt: the lower band (sides + rear,
# it runs into the headlamp pockets at the front corners); line: one thin horizontal accent line; roofband: the rolled
# roof edge above the black window band (the swatch "ivory"); mark: the wordmark; moon: the crescent before it.
LIVERIES = {
    "opt1": dict(name="달빛 남색", body="#F3F2EE", skirt="#3A3E9C", skirt_top=0.70, line="#8B5CF6", line_h=(0.735, 0.760),
                 roofband="#F3F2EE", roof="#DADCDF", mark="#3A3E9C", moon="#8B5CF6"),
    "opt2": dict(name="숲 초록", body="#2F6B4F", skirt=None, skirt_top=None, line=None, line_h=None,
                 roofband="#F4F2EC", roof="#DADCDF", mark="#F4F2EC", moon="#F4F2EC"),
    "opt3": dict(name="파스텔 민트", body="#B9DECC", skirt="#3E4A5E", skirt_top=0.62, line=None, line_h=None,
                 roofband="#F4F2EC", roof="#DADCDF", mark="#3E4A5E", moon="#3E4A5E"),
}
LV = LIVERIES[ARGS.livery]

# ------------------------------------------------------------------------------------------------ palette --
C = {
    "ivory": LV["roofband"], "green": "#2F5D4A", "amber": "#E0A23C", "black": "#0E1012", "trim": "#151618",
    "bumper": "#2B2E31", "rubber": "#1B1B1C", "roof": LV["roof"], "ac": "#D9DCDD", "alu": "#C9CDD1",
    "chrome": "#E6E8EA", "steel": "#55585B", "under": "#0B0B0C", "well": "#0D0D0E", "floor": "#6E6F6B",
    "wall": "#B9B4A8", "ceiling": "#ECEBE6", "seat_shell": "#7C8084", "seat_blue": "#24418C", "seat_teal": "#1F6E77",
    "seat_yellow": "#D9B526", "pole_yellow": "#E9B526", "pole_orange": "#E2652A", "handle": "#D8D8D2", "red": "#C8231E",
    "lens_clear": "#D6DCE0", "lens_amber": "#E08A1E", "lens_red": "#A8141A", "lens_white": "#E4E6E8",
    "led_warm": "#FFF2DC", "plate": "#E8C230", "mirror": "#2A3036", "dash": "#2A2B2D", "terminal": "#3A3D40",
    "screen": "#1F5068", "step_yellow": "#E5B526", "seal": "#121212", "glass_dark": "#101418", "pocket": "#08090A",
    "amber_dim": "#B87A2A", "grille": "#1E2022", "wiper": "#141516", "hub": "#B9BEC3",
    "reflector": "#D5D9DD", "reflector_flat": "#B4B9BE", "proj_lens": "#1C232A", "nut": "#BFC3C7", "bumper_hi": "#3C4044",
    # bus-ride 2026-11-15: the pink priority seat and the white-grey stanchions
    "seat_pink": "#E48AAE", "pole_white": "#D4D8DB",
    # livery r4: the body, its lower skirt and the accent line (paint)
    "body": LV["body"], "skirt": LV["skirt"] or LV["body"], "line": LV["line"] or LV["body"],
}

# Swatch material values: (clearcoat 0..1, roughness 0..1, metalness 0..1, emissive hex or None, emissive gain)
WARM = (1.0, 0.86, 0.66)
SW = {
    "ivory": (1, 0.32, 0, None, 0), "green": (1, 0.32, 0, None, 0), "amber": (1, 0.32, 0, None, 0),
    "black": (1, 0.26, 0, None, 0), "trim": (0, 0.55, 0, None, 0), "bumper": (0, 0.55, 0, None, 0),
    "rubber": (0, 0.88, 0, None, 0), "roof": (0.4, 0.45, 0, None, 0), "ac": (0.2, 0.42, 0, None, 0),
    "alu": (0, 0.40, 0.85, None, 0), "chrome": (0, 0.1, 1, None, 0), "steel": (0, 0.5, 0.7, None, 0),
    "under": (0, 0.9, 0, None, 0), "well": (0, 0.9, 0, None, 0),
    "floor": (0, 0.8, 0, "#9A9C9E", 0.30), "wall": (0, 0.6, 0, "interior", 0.30),
    "ceiling": (0, 0.6, 0, "#FFFFFF", 0.62), "seat_shell": (0, 0.5, 0, "interior", 0.30),
    "seat_blue": (0, 0.85, 0, "interior", 0.36), "seat_teal": (0, 0.85, 0, "interior", 0.36),
    "seat_yellow": (0, 0.85, 0, "interior", 0.36), "pole_yellow": (0, 0.35, 0, "interior", 0.40),
    "pole_orange": (0, 0.35, 0, "interior", 0.40), "handle": (0, 0.45, 0, "interior", 0.30),
    "red": (0, 0.35, 0, None, 0), "lens_clear": (0, 0.05, 0, "#FFFFFF", 1.0), "lens_amber": (0, 0.08, 0, "#FFA040", 0.8),
    "lens_red": (0, 0.08, 0, "#FF2A20", 0.75), "lens_white": (0, 0.06, 0, None, 0), "amber_dim": (0, 0.1, 0, None, 0),
    "led_warm": (0, 0.4, 0, "#FFE9C8", 1.0), "plate": (0, 0.4, 0, None, 0), "mirror": (0, 0.04, 1, None, 0),
    "dash": (0, 0.7, 0, "interior", 0.18), "terminal": (0, 0.5, 0, "interior", 0.2), "screen": (0, 0.2, 0, "#3AA0D0", 0.5),
    "step_yellow": (0, 0.5, 0, "interior", 0.3), "seal": (0, 0.8, 0, None, 0), "glass_dark": (0, 0.1, 0, None, 0),
    "pocket": (1, 0.14, 0, None, 0), "grille": (0, 0.7, 0, None, 0), "wiper": (0, 0.6, 0, None, 0),
    "hub": (0, 0.36, 0.9, None, 0),
    "reflector": (0, 0.12, 1, "#FFF2DE", 0.55), "reflector_flat": (0, 0.24, 1, None, 0),
    "proj_lens": (1, 0.04, 0, "#FFFFFF", 1.0), "nut": (0, 0.34, 1, None, 0), "bumper_hi": (0, 0.5, 0, None, 0),
    "body": (1, 0.32, 0, None, 0), "skirt": (1, 0.32, 0, None, 0), "line": (1, 0.32, 0, None, 0),
    "seat_pink": (0, 0.85, 0, "interior", 0.36), "pole_white": (0, 0.35, 0.3, "interior", 0.40),
}

# ------------------------------------------------------------------------------------------------ regions --
# (x, y, w, h) in base-atlas px (top-left origin)
R = {
    "side_r": (0, 0, 1024, 160), "side_l": (0, 160, 1024, 160),
    "rear": (0, 320, 512, 256), "front": (512, 320, 512, 160),
    "tread": (0, 576, 256, 32), "wall": (256, 576, 256, 32),
    "ac_louvre": (0, 608, 256, 32), "reflector": (256, 608, 256, 32),
    "rim_f": (0, 640, 128, 128), "rim_r": (128, 640, 128, 128),
    "icon_wheel": (256, 640, 64, 64), "icon_stroller": (320, 640, 64, 64),
    "plate": (448, 640, 64, 32), "roof_grille": (256, 704, 128, 64), "amber_ribs": (384, 704, 64, 64),
    "swatches": (512, 480, 512, 288),
    # bus-ride r2 (2026-11-15): the cabin's textured surfaces (the floor's speckled rubber, the seats' woven cloth in four colours)
    "floor_rub": (512, 768, 256, 108), "seat_cloth": (512, 880, 256, 64), "next_sign": (768, 880, 256, 24),
    # livery r4: the wordmark decal (crescent + 케이슨 마을), ~450 px a metre on the bus; padded in its background colour
    "wordmark": (8, 784, 496, 100),
}
WM_PAD = (0, 768, 512, 136)
# where build_bus.py wordmarks() puts the decal (m): sides below the windows (right: between the front wheel arch and the
# middle door, centred under the window above it, xf 3.05-4.28 (polish r4: 3.73 -> 3.67, the crescent sat ~7 cm from the
# middle door's frame; now ~17 cm, the arch's trim ~0.35 m ahead of the text); left: between the arches), rear under the
# rear window over the engine door; w = width, height from the region's aspect
DECALS = {"side_r": {"xf": 3.67, "h": 0.98, "w": 1.10}, "side_l": {"xf": 4.55, "h": 0.98, "w": 1.10},
          "rear": {"X": 0.0, "h": 1.34, "w": 0.96}, "out": 0.004}
SIDE_H = (0.25, 1.30)      # side regions: h range (bottom .. top)
FRONT_H = (0.25, 1.10)
REAR_H = (0.30, 3.05)
BUMPER_R_H = (0.32, 0.56)
HALF_W = 1.25              # front/rear regions span X -1.25 .. 1.25
CELL = 32


def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def paint_at(hh):
    """The livery's swatch name at height hh (sides and rear)."""
    if LV["line"] and LV["line_h"][0] <= hh <= LV["line_h"][1]:
        return "line"
    if LV["skirt"] and hh <= LV["skirt_top"]:
        return "skirt"
    return "body"


def lum(rgb):
    return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255.0


def seam_rgb(name):
    """A panel seam on a paint: a darker line of the same colour."""
    c = hexrgb(C[name])
    return shade(c, 0.55 if lum(c) < 0.4 else 0.74)


# ------------------------------------------------------------------------------------------------ canvases --
class Canvas:
    """Three layers drawn together: base (sRGB), orm (cc, rough, metal) and emissive, all at N*SS."""

    def __init__(self):
        S = N * SS
        self.base = Image.new("RGB", (S, S), hexrgb("#808080"))
        self.orm = Image.new("RGB", (S, S), (0, 140, 0))
        self.emit = Image.new("RGB", (S, S), (0, 0, 0))
        self.db = ImageDraw.Draw(self.base)
        self.do = ImageDraw.Draw(self.orm)
        self.de = ImageDraw.Draw(self.emit)

    def mat(self, name):
        cc, ro, me, em, gain = SW[name]
        orm = (int(cc * 255), int(ro * 255), int(me * 255))
        base = hexrgb(C[name])
        if em is None:
            e = (0, 0, 0)
        elif em == "interior":
            e = tuple(int(min(255, base[i] * WARM[i] * gain)) for i in range(3))
        else:
            e = tuple(int(min(255, v * gain)) for v in hexrgb(em))
        return base, orm, e

    def poly(self, pts, name, base=None, emit=None):
        b, o, e = self.mat(name)
        pts = [(x * SS, y * SS) for x, y in pts]
        self.db.polygon(pts, fill=base or b)
        self.do.polygon(pts, fill=o)
        self.de.polygon(pts, fill=emit or e)

    def rect(self, x0, y0, x1, y1, name, base=None, emit=None):
        self.poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], name, base, emit)

    def ellipse(self, cx, cy, rx, ry, name, base=None, emit=None):
        b, o, e = self.mat(name)
        box = [(cx - rx) * SS, (cy - ry) * SS, (cx + rx) * SS, (cy + ry) * SS]
        self.db.ellipse(box, fill=base or b)
        self.do.ellipse(box, fill=o)
        self.de.ellipse(box, fill=emit or e)

    def line(self, pts, width_px, rgb, orm=None):
        pts = [(x * SS, y * SS) for x, y in pts]
        self.db.line(pts, fill=rgb, width=max(1, int(round(width_px * SS))))
        if orm:
            self.do.line(pts, fill=orm, width=max(1, int(round(width_px * SS))))

    def darken(self, x0, y0, x1, y1, k):
        """Multiply the base colour of a rectangle by k (a recess in whatever paint is there)."""
        box = (int(round(x0 * SS)), int(round(y0 * SS)), int(round(x1 * SS)), int(round(y1 * SS)))
        a = np.asarray(self.base.crop(box)).astype(np.float32) * k
        self.base.paste(Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)), box[:2])


def shade(rgb, k):
    return tuple(int(max(0, min(255, c * k))) for c in rgb)


cv = Canvas()


def bands(x0, x1, ymap, h_lo, h_hi):
    """The livery's horizontal paint bands over x0..x1 between heights h_lo..h_hi (ymap: height -> px)."""
    cv.rect(x0, ymap(h_hi), x1, ymap(h_lo), "body")
    if LV["skirt"]:
        cv.rect(x0, ymap(min(LV["skirt_top"], h_hi)), x1, ymap(h_lo), "skirt")
    if LV["line"]:
        cv.rect(x0, ymap(LV["line_h"][1]), x1, ymap(LV["line_h"][0]), "line")


# ---------------------------------------------------------------------------------------------- the sides --


def side(region, right):
    x0, y0, w, h = R[region]
    px = lambda xf: x0 + xf / BUS_L * w
    py = lambda hh: y0 + (SIDE_H[1] - hh) / (SIDE_H[1] - SIDE_H[0]) * h
    bands(x0, x0 + w, py, SIDE_H[0], SIDE_H[1])
    # the front: the headlight pockets and the DRL band wrap round the corner onto the side (the skirt ends in them)
    cv.poly([(px(0), py(0.42)), (px(0.37), py(0.42)), (px(0.31), py(0.87)), (px(0), py(0.87))], "pocket")
    cv.rect(px(0), py(1.0), px(0.30), py(0.88), "black")
    # protective moulding along the bottom
    cv.rect(x0, py(0.385), x0 + w, y0 + h, "bumper")

    # the rear service hatch only (the mid-side hatches went: the wordmark sits there, and fewer lines read calmer)
    def hatch(a, b, lo, hi):
        steps = 24
        for xa in (a, b):
            for k in range(steps):
                hh0 = lo + (hi - lo) * k / steps
                hh1 = lo + (hi - lo) * (k + 1) / steps
                cv.line([(px(xa), py(hh0)), (px(xa), py(hh1))], 0.9, seam_rgb(paint_at((hh0 + hh1) / 2)))
        for hh in (lo, hi):
            cv.line([(px(a), py(hh)), (px(b), py(hh))], 0.9, seam_rgb(paint_at(hh)))
    hatch(7.62, 8.72, 0.42, 1.20)
    if right:
        # rear cooling grille (door side): dark frame and louvres
        gx0, gx1, gh0, gh1 = 7.86, 8.43, 0.56, 1.13
        cv.rect(px(gx0), py(gh1), px(gx1), py(gh0), "grille")
        for k in range(11):
            hh = gh0 + 0.03 + k * (gh1 - gh0 - 0.06) / 10
            cv.line([(px(gx0 + 0.02), py(hh)), (px(gx1 - 0.02), py(hh))], 1.3, (78, 82, 86))


side("side_r", True)
side("side_l", False)

# ---------------------------------------------------------------------------------------------- the front --
x0, y0, w, h = R["front"]
fx = lambda X: x0 + (HALF_W - X) / (2 * HALF_W) * w
fy = lambda hh: y0 + (FRONT_H[1] - hh) / (FRONT_H[1] - FRONT_H[0]) * h
cv.rect(x0, y0, x0 + w, y0 + h, "body")
cv.rect(x0, fy(0.45), x0 + w, y0 + h, "bumper")
for s in (1, -1):
    cv.poly([(fx(s * 1.26), fy(0.42)), (fx(s * 0.90), fy(0.42)), (fx(s * 0.99), fy(0.87)), (fx(s * 1.26), fy(0.87))], "pocket")
cv.rect(x0, fy(1.0), x0 + w, fy(0.88), "black")
# (the DRL's LED dots are geometry: build_bus.py drl_band)
# the plate's recess
cv.darken(fx(0.235), fy(0.70), fx(-0.235), fy(0.44), 0.84)
cv.line([(fx(0.235), fy(0.70)), (fx(-0.235), fy(0.70))], 1.2, seam_rgb("body"))

# ---------------------------------------------------------------------------------------------- the rear --
x0, y0, w, h = R["rear"]
rx_ = lambda X: x0 + (X + HALF_W) / (2 * HALF_W) * w
ry_ = lambda hh: y0 + (REAR_H[1] - hh) / (REAR_H[1] - REAR_H[0]) * h
bands(x0, x0 + w, ry_, REAR_H[0], REAR_H[1])
# black gloss panel round the rear window
cv.rect(rx_(-1.30), ry_(2.82), rx_(1.30), ry_(1.50), "black")
# engine door: its seam, and two banks of louvres kept low (the wordmark goes between them and the black panel)
ed = (-0.80, 0.80, 0.80, 1.50)
for (Xa, ha, Xb, hb) in ((ed[0], ed[2], ed[1], ed[2]), (ed[0], ed[3], ed[1], ed[3])):
    cv.line([(rx_(Xa), ry_(ha) - 0.5), (rx_(Xb), ry_(hb) - 0.5)], 1.0, seam_rgb(paint_at(ha + 0.01)))
for X in (ed[0], ed[1]):
    for k in range(14):
        hh0 = ed[2] + (ed[3] - ed[2]) * k / 14
        hh1 = ed[2] + (ed[3] - ed[2]) * (k + 1) / 14
        cv.line([(rx_(X), ry_(hh0)), (rx_(X), ry_(hh1))], 1.0, seam_rgb(paint_at((hh0 + hh1) / 2)))
for X0 in (-0.62, 0.12):
    for k in range(5):
        hh = 0.93 + k * 0.05
        cv.rect(rx_(X0), ry_(hh + 0.009), rx_(X0 + 0.5), ry_(hh - 0.009), "grille")
        cv.line([(rx_(X0), ry_(hh - 0.011)), (rx_(X0 + 0.5), ry_(hh - 0.011))], 0.8, shade(hexrgb(C[paint_at(hh)]), 1.05))
# lamp housings at both corners
for s in (1, -1):
    cv.rect(rx_(s * 1.06), ry_(1.33), rx_(s * 1.26), ry_(0.72), "pocket")
# plate recess
cv.darken(rx_(-0.235), ry_(0.88), rx_(0.235), ry_(0.63), 0.82)

# ---------------------------------------------------------------------------------------- bumper reflectors --
x0, y0, w, h = R["reflector"]
bxr = lambda X: x0 + (X + HALF_W) / (2 * HALF_W) * w
byr = lambda hh: y0 + (BUMPER_R_H[1] - hh) / (BUMPER_R_H[1] - BUMPER_R_H[0]) * h
cv.rect(x0, y0, x0 + w, y0 + h, "bumper")
# polish r4 (2026-11-11): plain red rectangular reflectors, the same size and place (the red/yellow diagonal stripes were
# the last pattern on the bus; the owner finds patterns tacky). A reflector, not a lamp: no glow at night.
for s in (1, -1):
    a, b = sorted((s * 0.72, s * 1.14))
    lo, hi = 0.38, 0.50
    cv.rect(bxr(a), byr(hi), bxr(b), byr(lo), "lens_red", emit=(0, 0, 0))

# -------------------------------------------------------------------------------------------------- tyres --
x0, y0, w, h = R["tread"]
TREAD_RUBBER = (54, 54, 56)
cv.rect(x0, y0, x0 + w, y0 + h, "rubber", base=TREAD_RUBBER)
# shoulder blocks at both edges, every 8 px round the tyre, with a dark slot between them
for k in range(0, w, 8):
    for (va, vb) in ((0.0, 0.13), (0.87, 1.0)):
        cv.rect(x0 + k + 5.5, y0 + va * h, x0 + k + 8, y0 + vb * h, "rubber", base=(16, 16, 17))
# four circumferential grooves
for v in (0.22, 0.41, 0.59, 0.78):
    cv.rect(x0, y0 + (v - 0.035) * h, x0 + w, y0 + (v + 0.035) * h, "rubber", base=(9, 9, 10))
# sipes across the ribs
for k in range(0, w, 8):
    for (va, vb) in ((0.15, 0.19), (0.26, 0.38), (0.45, 0.56), (0.63, 0.75), (0.82, 0.86)):
        cv.line([(x0 + k + 2, y0 + va * h), (x0 + k + 3.5, y0 + vb * h)], 0.7, (22, 22, 23))
x0, y0, w, h = R["wall"]
# t = 0 at the tread's shoulder, 1 at the rim (build_bus.py tyre_uv)
cv.rect(x0, y0, x0 + w, y0 + h, "rubber", base=(44, 44, 46))
for k in range(0, w, 8):                                   # shoulder's buttress notches
    cv.rect(x0 + k + 5, y0, x0 + k + 7.5, y0 + 0.13 * h, "rubber", base=(18, 18, 19))
cv.rect(x0, y0 + 0.13 * h, x0 + w, y0 + 0.17 * h, "rubber", base=(26, 26, 27))   # the shoulder's edge
cv.rect(x0, y0 + 0.30 * h, x0 + w, y0 + 0.56 * h, "rubber", base=(56, 56, 58))   # smooth band (no lettering)
cv.rect(x0, y0 + 0.56 * h, x0 + w, y0 + 0.60 * h, "rubber", base=(28, 28, 29))
cv.rect(x0, y0 + 0.74 * h, x0 + w, y0 + 0.90 * h, "rubber", base=(66, 66, 68))   # rim protector ridge
cv.rect(x0, y0 + 0.90 * h, x0 + w, y0 + h, "rubber", base=(24, 24, 25))


def rim(region, dished):
    x0, y0, w, h = R[region]
    cx, cy = x0 + w / 2, y0 + h / 2
    k = w / (2 * 0.29)
    cv.rect(x0, y0, x0 + w, y0 + h, "rubber")
    cv.ellipse(cx, cy, 0.286 * k, 0.286 * k, "alu")
    cv.ellipse(cx, cy, 0.262 * k, 0.262 * k, "alu", base=shade(hexrgb(C["alu"]), 0.80))   # the rim's well
    cv.ellipse(cx, cy, 0.250 * k, 0.250 * k, "alu", base=shade(hexrgb(C["alu"]), 0.97 if not dished else 0.9))
    ring, hole = (0.222, 0.025) if not dished else (0.212, 0.031)
    for i in range(10):
        a = 2 * math.pi * (i + 0.5) / 10
        hx, hy = cx + ring * k * math.cos(a), cy + ring * k * math.sin(a)
        cv.ellipse(hx, hy, (hole + 0.004) * k, (hole + 0.004) * k, "alu", base=shade(hexrgb(C["alu"]), 0.7))
        cv.ellipse(hx, hy, hole * k, hole * k, "under")
    if not dished:
        cv.ellipse(cx, cy, 0.190 * k, 0.190 * k, "alu", base=shade(hexrgb(C["alu"]), 0.72))  # the flange's step
        cv.ellipse(cx, cy, 0.184 * k, 0.184 * k, "alu", base=shade(hexrgb(C["alu"]), 0.92))  # the hub flange
    cv.ellipse(cx, cy, 0.12 * k, 0.12 * k, "hub")
    cv.ellipse(cx, cy, 0.068 * k, 0.068 * k, "hub", base=shade(hexrgb(C["hub"]), 0.88))     # the cap's face


rim("rim_f", False)
rim("rim_r", True)

# ----------------------------------------------------------------------------------------------- pictograms --


def icon_bg(region):
    x0, y0, w, h = R[region]
    cv.rect(x0, y0, x0 + w, y0 + h, "glass_dark")
    cv.ellipse(x0 + w / 2, y0 + h / 2, w * 0.47, h * 0.47, "ivory", base=(255, 255, 255))
    cv.ellipse(x0 + w / 2, y0 + h / 2, w * 0.43, h * 0.43, "plate", base=hexrgb("#1E5BB8"))
    return x0, y0, w, h


x0, y0, w, h = icon_bg("icon_wheel")
W_ = (255, 255, 255)
u = w / 64.0
cv.ellipse(x0 + 30 * u, y0 + 15 * u, 4.2 * u, 4.2 * u, "ivory", base=W_)                 # head
cv.line([(x0 + 29 * u, y0 + 21 * u), (x0 + 28 * u, y0 + 35 * u), (x0 + 39 * u, y0 + 35 * u), (x0 + 43 * u, y0 + 46 * u)], 4.0 * u, W_)
cv.line([(x0 + 28 * u, y0 + 27 * u), (x0 + 37 * u, y0 + 27 * u)], 3.2 * u, W_)
b = ImageDraw.Draw(cv.base)
b.arc([(x0 + 15 * u) * SS, (y0 + 28 * u) * SS, (x0 + 39 * u) * SS, (y0 + 52 * u) * SS], 200, 520, fill=W_, width=int(3.2 * u * SS))
x0, y0, w, h = icon_bg("icon_stroller")
u = w / 64.0
b.pieslice([(x0 + 16 * u) * SS, (y0 + 16 * u) * SS, (x0 + 36 * u) * SS, (y0 + 36 * u) * SS], 180, 270, fill=W_)
b.chord([(x0 + 16 * u) * SS, (y0 + 18 * u) * SS, (x0 + 46 * u) * SS, (y0 + 42 * u) * SS], 0, 180, fill=W_)
b.line([(x0 + 46 * u) * SS, (y0 + 30 * u) * SS, (x0 + 50 * u) * SS, (y0 + 18 * u) * SS], fill=W_, width=int(3 * u * SS))
for wx in (22, 40):
    b.ellipse([(x0 + (wx - 4) * u) * SS, (y0 + 43 * u) * SS, (x0 + (wx + 4) * u) * SS, (y0 + 51 * u) * SS], fill=W_)

# --------------------------------------------------------------------------------------------- plate, louvres --
x0, y0, w, h = R["plate"]
cv.rect(x0, y0, x0 + w, y0 + h, "plate")
cv.line([(x0 + 1, y0 + 1), (x0 + w - 1, y0 + 1), (x0 + w - 1, y0 + h - 1), (x0 + 1, y0 + h - 1), (x0 + 1, y0 + 1)], 1.0,
        shade(hexrgb(C["plate"]), 0.6))
for bx in (0.07, 0.93):
    cv.ellipse(x0 + bx * w, y0 + 0.5 * h, 1.2, 1.2, "chrome")
# the owner's number "1004" (xwalk fix 2026-11-13): our own plain digits in the village's display font (Jua), dark on the
# yellow plate, no region code or other lettering; front and rear plates share this region
_pf = ImageFont.truetype(JUA, 100)
_probe = ImageDraw.Draw(Image.new("L", (10, 10)))
_bb = _probe.textbbox((0, 0), "1004", font=_pf)
_pf = ImageFont.truetype(JUA, int(round(100 * min((0.62 * h * SS) / (_bb[3] - _bb[1]), (0.74 * w * SS) / (_bb[2] - _bb[0])))))
_bb = _probe.textbbox((0, 0), "1004", font=_pf)
_tw, _th = _bb[2] - _bb[0], _bb[3] - _bb[1]
cv.db.text((x0 * SS + (w * SS - _tw) / 2 - _bb[0], y0 * SS + (h * SS - _th) / 2 - _bb[1]), "1004", font=_pf, fill=(26, 26, 24))
x0, y0, w, h = R["ac_louvre"]
cv.rect(x0, y0, x0 + w, y0 + h, "ac")
for k in range(12):
    sx = x0 + (k + 0.5) * w / 12
    cv.rect(sx - w / 12 * 0.16, y0 + h * 0.30, sx + w / 12 * 0.16, y0 + h * 0.72, "grille", base=(150, 154, 157))
x0, y0, w, h = R["amber_ribs"]
cv.rect(x0, y0, x0 + w, y0 + h, "amber_dim", base=hexrgb("#E39A2A"))
for k in range(0, w, 6):
    cv.rect(x0 + k, y0, x0 + k + 2, y0 + h, "amber_dim", base=hexrgb("#B66B10"))
    cv.rect(x0 + k + 3, y0, x0 + k + 4, y0 + h, "amber_dim", base=hexrgb("#F6C060"))
x0, y0, w, h = R["roof_grille"]
cv.rect(x0, y0, x0 + w, y0 + h, "grille", base=(70, 73, 76))
for k in range(10):
    yy = y0 + (k + 0.5) * h / 10
    cv.rect(x0 + 4, yy - h / 40, x0 + w - 4, yy + h / 40, "grille", base=(22, 23, 24))


# ----------------------------------------------------------------------------------------------- wordmark --


def crescent_mask(size_px):
    """The fountain's crescent (build_village.py crescent(): outer circle R1, inner R2 = 0.8 R1 offset 0.42 R1 right and
    0.10 R1 up), as an anti-aliased L mask `size_px` tall; returns (mask, width)."""
    k = 4
    R1 = size_px * k / 2.0
    R2 = R1 * 0.80
    ox, oy = R1 * 0.42, -R1 * 0.10
    W_ = int(math.ceil(2 * R1)) + 2
    H_ = int(math.ceil(2 * R1)) + 2
    m = Image.new("L", (W_, H_), 0)
    d = ImageDraw.Draw(m)
    cx, cy = W_ / 2, H_ / 2
    d.ellipse([cx - R1, cy - R1, cx + R1, cy + R1], fill=255)
    d.ellipse([cx + ox - R2, cy + oy - R2, cx + ox + R2, cy + oy + R2], fill=0)
    a = np.asarray(m)
    xs = np.nonzero(a.max(0) > 0)[0]
    m = m.crop((int(xs.min()), 0, int(xs.max()) + 1, H_))
    m = m.resize((max(1, round(m.width / k)), max(1, round(m.height / k))), Image.LANCZOS)
    return m


def wordmark():
    """'☾ 케이슨 마을' in the village UI's display font (Jua), centred in the region on the paint it sits on."""
    bx, by, bw, bh = WM_PAD
    cv.rect(bx, by, bx + bw, by + bh, "body")
    x0, y0, w, h = R["wordmark"]
    ink_h = 0.72 * h * SS                        # the text's ink height (px, supersampled)
    font = ImageFont.truetype(JUA, 100)
    probe = ImageDraw.Draw(Image.new("L", (10, 10)))
    bb = probe.textbbox((0, 0), "케이슨 마을", font=font)
    font = ImageFont.truetype(JUA, int(round(100 * ink_h / (bb[3] - bb[1]))))
    bb = probe.textbbox((0, 0), "케이슨 마을", font=font)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    moon = crescent_mask(int(round(th * 1.04)))
    gap = 0.34 * th
    total = moon.width + gap + tw
    left = x0 * SS + (w * SS - total) / 2
    top = y0 * SS + (h * SS - th) / 2
    mrgb = hexrgb(LV["moon"])
    layer = Image.new("RGB", moon.size, mrgb)
    cv.base.paste(layer, (int(round(left)), int(round(top + th / 2 - moon.height / 2))), moon)
    cv.db.text((left + moon.width + gap - bb[0], top - bb[1]), "케이슨 마을", font=font, fill=hexrgb(LV["mark"]))
    print(f"[tex] wordmark: text {tw / SS:.0f} x {th / SS:.0f} px, total {total / SS:.0f} of {w} px "
          f"({total / SS / w * DECALS['side_r']['w']:.2f} m on a {DECALS['side_r']['w']} m side decal, "
          f"letters {th / SS / h * DECALS['side_r']['w'] * h / w:.3f} m tall)")


wordmark()


# ------------------------------------------------------------------------------- cabin surfaces (bus-ride r2) --
# Real Korean low-floor buses (Aside photos, 2026-11-15): a grey speckled rubber floor, woven patterned seat cloth, a white ceiling.
_rng = np.random.default_rng(1511)


def paste_surface(region, rgb, rough, glow):
    """Write a region's base / orm / emissive at the canvas's supersampled size (rgb: float array h*SS x w*SS x 3)."""
    x0, y0, w, h = R[region]
    a = np.clip(rgb, 0, 255).astype(np.uint8)
    cv.base.paste(Image.fromarray(a), (x0 * SS, y0 * SS))
    cv.orm.paste(Image.new("RGB", (w * SS, h * SS), (0, int(rough * 255), 0)), (x0 * SS, y0 * SS))
    cv.emit.paste(Image.fromarray(np.clip(rgb * glow, 0, 255).astype(np.uint8)), (x0 * SS, y0 * SS))


# floor: cool grey rubber, fine speckle and a few light flecks, a faint stud grid
fw, fh = R["floor_rub"][2] * SS, R["floor_rub"][3] * SS
fl = np.ones((fh, fw, 3), np.float32) * np.array((138, 141, 144), np.float32)
fl += _rng.normal(0, 7.5, (fh, fw, 1))
fleck = _rng.random((fh, fw)) > 0.965
fl[fleck] += 45
dark = _rng.random((fh, fw)) > 0.985
fl[dark] -= 38
yy, xx = np.mgrid[0:fh, 0:fw]
stud = ((xx % 24) < 3) & ((yy % 24) < 3)
fl[stud] += 14
paste_surface("floor_rub", fl, 0.86, 0.30)

# seat cloth: four colours, a woven lattice of small lighter diamonds and dots in a 64 px cell
cw = R["seat_cloth"][3] * SS
cloth = np.zeros((cw, R["seat_cloth"][2] * SS, 3), np.float32)
for i, nm in enumerate(("seat_blue", "seat_teal", "seat_pink", "seat_yellow")):
    base_c = np.array(hexrgb(C[nm]), np.float32)
    cell_a = np.ones((cw, cw, 3), np.float32) * base_c
    y2, x2 = np.mgrid[0:cw, 0:cw]
    u = (x2 / cw * 4) % 1.0
    v = (y2 / cw * 4) % 1.0
    diamond = (abs(u - 0.5) + abs(v - 0.5)) < 0.26
    dots = (np.hypot(u, v) < 0.10) | (np.hypot(u - 1, v) < 0.10) | (np.hypot(u, v - 1) < 0.10) | (np.hypot(u - 1, v - 1) < 0.10)
    light = shade(tuple(base_c), 1.32)
    deep = shade(tuple(base_c), 0.78)
    cell_a[diamond & ~dots] = deep
    cell_a[dots] = light
    cell_a += _rng.normal(0, 3.5, (cw, cw, 1))
    cloth[:, i * cw:(i + 1) * cw] = cell_a
paste_surface("seat_cloth", cloth, 0.9, 0.30)


# the next-stop display inside, over the windscreen (1.4 m x 0.13 m): amber dots on black in the body's own atlas (the LED
# material's three destination signs are a contract of their own: every face looks out of the body)
def next_stop_sign():
    from PIL import ImageFont as _IF
    cols, rows = 128, 12
    for sz in range(14, 7, -1):
        ft = _IF.truetype(LED_FONT, sz)
        im = Image.new("L", (cols, rows), 0)
        d = ImageDraw.Draw(im)
        d.fontmode = "1"
        txt = "다음 정류장 케이슨 마을"
        bb = d.textbbox((0, 0), txt, font=ft)
        tw, th = bb[2] - bb[0], bb[3] - bb[1]
        if tw <= cols - 2 and th <= rows:
            d.text(((cols - tw) // 2 - bb[0], (rows - th) // 2 - bb[1]), txt, font=ft, fill=255)
            break
    mask = np.asarray(im) > 127
    x0, y0, w, h = R["next_sign"]
    cv.rect(x0, y0, x0 + w, y0 + h, "black", base=(12, 10, 8), emit=(0, 0, 0))
    for r in range(rows):
        for c in range(cols):
            cx, cy = x0 + (c + 0.5) * 2, y0 + (r + 0.5) * 2
            on = mask[r, c]
            cv.ellipse(cx, cy, 0.85, 0.85, "led_warm", base=(255, 179, 71) if on else (46, 34, 20), emit=(255, 179, 71) if on else (0, 0, 0))


next_stop_sign()
# ----------------------------------------------------------------------------------------------- swatches --
sx0, sy0, sw, sh = R["swatches"]
cols = sw // CELL
cells = {}
for i, name in enumerate(SW.keys()):
    cx, cy = sx0 + (i % cols) * CELL, sy0 + (i // cols) * CELL
    cv.rect(cx, cy, cx + CELL, cy + CELL, name)
    cells[name] = [cx + CELL / 2, cy + CELL / 2]
assert len(SW) <= cols * (sh // CELL)

# ---------------------------------------------------------------------------------------------- write out --
base = cv.base.resize((N, N), Image.LANCZOS)
orm = cv.orm.resize((N // 2, N // 2), Image.LANCZOS)
emit = cv.emit.resize((N // 2, N // 2), Image.LANCZOS)
base.save(os.path.join(OUT, "bus_base.png"))
orm.save(os.path.join(OUT, "bus_orm.png"))
emit.save(os.path.join(OUT, "bus_emit.png"))

# ------------------------------------------------------------------------------------- LED destination signs --
# r4: the signs read the village's name (front, kerb side) and 마을버스 (rear) in amber dots: a bold gothic drawn 1-bit
# at the sign's dot rows (the size that fits), each dot a soft round LED.
LED_W, LED_H = 512, 256
PITCH = 4
led = np.zeros((LED_H, LED_W, 3), np.float32)
led[:] = (7, 7, 7)
AMBER = np.array((255, 179, 71), np.float32)
OFF = np.array((30, 26, 22), np.float32)


def dot(px, py, col):
    """One LED: a soft round dot in a PITCH x PITCH cell."""
    for y in range(PITCH):
        for x in range(PITCH):
            r = math.hypot(x + 0.5 - PITCH / 2, y + 0.5 - PITCH / 2) / (PITCH / 2)
            k = max(0.0, 1.0 - r * r * 0.85)
            yy, xx = py + y, px + x
            if 0 <= yy < LED_H and 0 <= xx < LED_W:
                led[yy, xx] = np.maximum(led[yy, xx], col * k)


def led_text(txt, cols, rows, max_size=None):
    """`txt` as 1-bit dots, the largest bold size that fits cols x rows (a dot's margin left and right); malgun bold
    hints to one-dot strokes at 17 px, so the front stays at 16 (two-dot strokes, as a bus's bold LED face)."""
    for sz in range(max_size or rows + 2, 7, -1):
        ft = ImageFont.truetype(LED_FONT, sz)
        im = Image.new("L", (cols, rows), 0)
        d = ImageDraw.Draw(im)
        d.fontmode = "1"
        bb = d.textbbox((0, 0), txt, font=ft)
        tw, th = bb[2] - bb[0], bb[3] - bb[1]
        if tw <= cols - 2 and th <= rows:
            d.text(((cols - tw) // 2 - bb[0], (rows - th) // 2 - bb[1]), txt, font=ft, fill=255)
            print(f"[tex] LED '{txt}': size {sz}, {tw} x {th} dots of {cols} x {rows}")
            return np.asarray(im) > 127
    raise SystemExit(f"LED text does not fit: {txt}")


def sign(x0, y0, cols, rows, mask):
    for r in range(rows):
        for c in range(cols):
            dot(x0 + c * PITCH, y0 + r * PITCH, AMBER if mask[r, c] else OFF)


sign(0, 0, 128, 16, led_text("케이슨 마을", 128, 16, max_size=16))      # front: 1.7 m x 0.2 m
sign(0, 72, 67, 13, led_text("케이슨 마을", 67, 13))       # kerb side: 0.9 m x 0.18 m
sign(0, 136, 53, 15, led_text("마을버스", 53, 15))         # rear: 0.7 m x 0.2 m
Image.fromarray(np.clip(led, 0, 255).astype(np.uint8)).save(os.path.join(OUT, "bus_led.png"))

LED = {"front": [0, 0, 128 * PITCH, 16 * PITCH], "side": [0, 72, 67 * PITCH, 13 * PITCH], "rear": [0, 136, 53 * PITCH, 15 * PITCH]}
json.dump({"size": N, "regions": R, "cells": cells, "cell": CELL, "side_h": SIDE_H, "front_h": FRONT_H, "rear_h": REAR_H,
           "bumper_r_h": BUMPER_R_H, "half_w": HALF_W, "bus_l": BUS_L, "led": LED, "led_size": [LED_W, LED_H],
           "decals": DECALS, "livery": {k: v for k, v in LV.items()}},
          open(os.path.join(OUT, "bus_atlas.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print("[tex] wrote", OUT, "livery", ARGS.livery, LV["name"])
