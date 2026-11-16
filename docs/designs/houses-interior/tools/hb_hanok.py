"""HB house 8 (한옥풍 대청마루) pieces: 기둥 (pillar with a stone base and a bracket head), 청자 화병 on a plinth, 소반 with an orchid."""
import math
import kit_core as K
from kit_core import PAL


def pillar(F, w=0.24, h=3.5):
    """기둥: a square post with chamfered corners on a stone base (초석) - drawn up to the beam bracket (3.38 m) of ceiling_hanok"""
    wood = (0.42, 0.3, 0.22, 1)
    K.rbox(F, -0.19, 0.19, -0.19, 0.19, 0.0, 0.12, "H_stone", r=0.02, seg=1, tn=(0.7, 0.68, 0.64, 1))
    K.rbox(F, -w / 2, w / 2, -w / 2, w / 2, 0.12, h, "H_wood_oak", r=0.02, seg=1, tn=wood, grain=(0, 0, 1))
    K.col(F, -0.17, 0.17, -0.17, 0.17, 3.7, name="pillar")


def celadon_vase(F, h=0.52):
    """청자 매병: a tall shouldered vase in celadon green with a carved band, on a dark wooden stand; the plinth below is a separate box"""
    c = (0.62, 0.78, 0.7, 1)
    r = h * 0.3
    K.lathe(F, 0, 0, 0.0, [(0, 0), (r * 0.5, 0.0), (r * 0.55, 0.015), (r * 0.75, h * 0.25), (r * 1.0, h * 0.55), (r * 0.9, h * 0.75), (r * 0.45, h * 0.88), (r * 0.36, h * 0.93),
                           (r * 0.42, h), (r * 0.3, h), (r * 0.22, h * 0.93), (0, h * 0.9)], "H_ceramic", 22, tn=c)
    K.lathe(F, 0, 0, h * 0.5, [(r * 1.0, 0.0), (r * 1.012, 0.012), (r * 0.99, 0.024), (r * 0.9, 0.03)], "H_ceramic", 22, tn=(0.5, 0.68, 0.6, 1))


def plinth(F, w=0.42, h=0.7):
    """a dark wooden stand for a vase: slab top, four turned-in legs, a lower shelf"""
    wood = (0.4, 0.28, 0.2, 1)
    K.rbox(F, -w / 2, w / 2, -w / 2, w / 2, h - 0.04, h, "H_wood_dark", r=0.01, seg=1, tn=wood)
    for sx in (-1, 1):
        for sz in (-1, 1):
            K.rbox(F, sx * (w / 2 - 0.04) - 0.025, sx * (w / 2 - 0.04) + 0.025, sz * (w / 2 - 0.04) - 0.025, sz * (w / 2 - 0.04) + 0.025, 0.0, h - 0.04, "H_wood_dark", r=0.004,
                   seg=1, tn=wood, grain=(0, 0, 1))
    K.rbox(F, -w / 2 + 0.03, w / 2 - 0.03, -w / 2 + 0.03, w / 2 - 0.03, 0.2, 0.23, "H_wood_dark", r=0.004, seg=1, tn=wood)
    K.col(F, -w / 2, w / 2, -w / 2, w / 2, h, name="plinth")


def vase_on_plinth(F, h=0.52):
    plinth(F.sub(0, 0, 0, 0))
    celadon_vase(F.sub(0, 0, 0.7, 0), h=h)


# ------------------------------------------------------------------------------------------------ 띠살문 window ----
import kit_shell as SH

_window_orig = SH.window


def window_hanok(W, s0, s1, y0, y1, style="grid", cols=2, rows=2, tn=None, frame_m="H_paint", paper=False):
    """띠살문: dark wood casing and frame, hanji panel drawn with the lamp-shade material (unlit warm ivory in the game and hidden while baking, so
    daylight comes in through it like through real hanji), horizontal 띠살 every 17 cm and verticals every 35 cm. style 'hanok' only."""
    if style != "hanok":
        return _window_orig(W, s0, s1, y0, y1, style=style, cols=cols, rows=rows, tn=tn, frame_m=frame_m, paper=paper)
    wood = (0.4, 0.28, 0.2, 1)
    SH.casing(W, s0, s1, y0, y1, tn=wood)
    K.rbox(W, s0 - 0.09, s1 + 0.09, 0.0, 0.10, y0 - 0.025, y0 + 0.005, "H_wood_dark", r=0.0, seg=1, tn=wood)
    fz0, fz1 = -0.20, -0.10
    fw = 0.06
    for (a, b) in ((s0, s0 + fw), (s1 - fw, s1)):
        K.rbox(W, a, b, fz0, fz1, y0, y1, "H_wood_dark", r=0.0, seg=1, tn=wood, grain=(0, 0, 1))
    K.rbox(W, s0, s1, fz0, fz1, y1 - fw, y1, "H_wood_dark", r=0.0, seg=1, tn=wood)
    K.rbox(W, s0, s1, fz0, fz1, y0, y0 + fw, "H_wood_dark", r=0.0, seg=1, tn=wood)
    ins0, ins1, iy0, iy1 = s0 + fw, s1 - fw, y0 + fw, y1 - fw
    K.gface(W, [(ins0, -0.15, iy0), (ins1, -0.15, iy0), (ins1, -0.15, iy1), (ins0, -0.15, iy1)], "H_shade", (1, 0, 0), 1.0, (0, 1, 0), tn=(1.0, 0.97, 0.9, 1))
    nvert = max(1, int((ins1 - ins0) / 0.35))
    for i in range(1, nvert):
        x = ins0 + (ins1 - ins0) * i / nvert
        K.rbox(W, x - 0.012, x + 0.012, -0.14, -0.105, iy0, iy1, "H_wood_dark", r=0.0, seg=1, tn=wood, grain=(0, 0, 1))
    y = iy0 + 0.17
    while y < iy1 - 0.05:
        K.rbox(W, ins0, ins1, -0.14, -0.105, y - 0.011, y + 0.011, "H_wood_dark", r=0.0, seg=1, tn=wood)
        y += 0.17


SH.window = window_hanok
