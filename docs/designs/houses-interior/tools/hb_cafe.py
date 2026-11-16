"""HB house 9 (다이닝·홈카페) pieces: espresso machine, grinder, gooseneck kettle, mug shelf, menu board, single bed with one open side, floor sofa with a seat count.
No brand marks anywhere (plain steel / matte colours)."""
import math
import random

import kit_core as K
from kit_core import PAL
import kit_beds as BE
import kit_seating as SE

STEEL = (0.74, 0.76, 0.78, 1)
DARK = (0.12, 0.12, 0.13, 1)
CREAM = (0.93, 0.9, 0.82, 1)


def espresso_machine(F, tn=None):
    """에스프레소 머신 (무지): cream enamel body with steel trim, a group head with a portafilter, a steam wand, a pressure dial, a drip tray with a grille,
    a cup rail on top and two cups. Front = +z, origin = the middle of the foot on the counter."""
    tn = tn or CREAM
    w, d, h = 0.36, 0.4, 0.38
    hw, hd = w / 2, d / 2
    K.rbox(F, -hw, hw, -hd, hd, 0.04, h, "H_ceramic", r=0.025, seg=2, tn=tn)
    K.rbox(F, -hw - 0.005, hw + 0.005, -hd, hd - 0.02, 0.0, 0.04, "H_metal", r=0.004, seg=1, tn=STEEL)
    K.rbox(F, -hw + 0.02, hw - 0.02, hd - 0.02, hd + 0.1, 0.0, 0.03, "H_metal", r=0.004, seg=1, tn=STEEL)         # drip tray
    for i in range(7):
        K.rbox(F, -hw + 0.04 + i * (w - 0.08) / 6.5, -hw + 0.052 + i * (w - 0.08) / 6.5, hd - 0.0, hd + 0.095, 0.03, 0.036, "H_rubber", r=0.0, seg=1)
    K.rbox(F, -hw + 0.03, hw - 0.03, hd, hd + 0.012, 0.2, 0.3, "H_metal", r=0.004, seg=1, tn=STEEL)               # steel panel
    K.cyl(F, 0, hd + 0.03, 0.17, 0.2, 0.034, "H_metal", segs=14, tn=STEEL)                                          # group head
    K.rbox(F, -0.03, 0.03, hd + 0.01, hd + 0.15, 0.135, 0.17, "H_rubber", r=0.01, seg=1, tn=DARK)                  # portafilter handle
    K.lathe(F, 0, hd + 0.03, 0.135, [(0, 0), (0.034, 0.0), (0.036, 0.03), (0.0, 0.035)], "H_metal", 12, tn=STEEL)
    K.lathe(F, -0.07, hd + 0.014, 0.31, [(0.0, 0.0), (0.03, 0.0), (0.03, 0.006), (0.0, 0.006)], "H_metal", 14, tn=STEEL)   # dial
    K.tube(F, [(hw - 0.05, hd + 0.01, 0.28), (hw - 0.05, hd + 0.09, 0.26), (hw - 0.05, hd + 0.1, 0.17)], 0.005, "H_metal", 6, tn=STEEL)  # steam wand
    K.rbox(F, -hw + 0.03, hw - 0.03, -hd + 0.03, hd - 0.05, h, h + 0.012, "H_metal", r=0.0, seg=1, tn=STEEL)         # cup rail
    for sx in (-1, 1):
        K.tube(F, [(sx * (hw - 0.04), -hd + 0.03, h), (sx * (hw - 0.04), -hd + 0.03, h + 0.02)], 0.004, "H_metal", 4, tn=STEEL)
        cx = sx * 0.08
        K.lathe(F, cx, 0.0, h + 0.012, [(0, 0), (0.03, 0.0), (0.036, 0.025), (0.04, 0.06), (0.034, 0.06), (0.03, 0.01), (0, 0.006)], "H_ceramic", 12, tn=(0.95, 0.94, 0.9, 1))
    K.col(F, -hw, hw, -hd, hd + 0.1, 0.45, name="espresso")


def grinder(F, tn=None):
    """코히 그라인더 (무지): matte base, a clear bean hopper (cone) with beans, a dosing spout and a small tray"""
    tn = tn or (0.18, 0.2, 0.22, 1)
    K.rbox(F, -0.09, 0.09, -0.1, 0.1, 0.0, 0.34, "H_plastic", r=0.02, seg=2, tn=tn)
    K.rbox(F, -0.06, 0.06, 0.1, 0.13, 0.04, 0.12, "H_metal", r=0.004, seg=1, tn=STEEL)
    K.lathe(F, 0, 0, 0.34, [(0.08, 0.0), (0.095, 0.02), (0.105, 0.22), (0.1, 0.23), (0.0, 0.23)], "H_glass", 16, tn=(0.9, 0.92, 0.92, 1))
    K.lathe(F, 0, 0, 0.34, [(0.0, 0.0), (0.075, 0.0), (0.09, 0.12), (0.0, 0.14)], "H_leather", 12, tn=(0.2, 0.12, 0.08, 1))
    K.lathe(F, 0, 0, 0.57, [(0.11, 0.0), (0.11, 0.02), (0.0, 0.025)], "H_plastic", 16, tn=tn)


def kettle(F, tn=None):
    """gooseneck kettle: steel body, long curved spout, black handle"""
    tn = tn or STEEL
    K.lathe(F, 0, 0, 0.0, [(0, 0), (0.08, 0.0), (0.085, 0.02), (0.075, 0.12), (0.05, 0.14), (0.0, 0.142)], "H_metal", 16, tn=tn)
    K.tube(F, [(0.07, 0.0, 0.06), (0.13, 0.0, 0.1), (0.17, 0.0, 0.2), (0.16, 0.0, 0.22)], 0.009, "H_metal", 7, tn=tn)
    K.tube(F, [(-0.06, 0.0, 0.13), (-0.14, 0.0, 0.16), (-0.12, 0.0, 0.04), (-0.07, 0.0, 0.04)], 0.008, "H_rubber", 6, tn=DARK, caps=False)


def mug_shelf(F, w=1.4, d=0.2, seed=2):
    """벽 선반 (2단) with plain mugs, cups on saucers and a jar of beans; the mugs hang by the handle from hooks on the lower edge"""
    rnd = random.Random(seed)
    wood = (0.95, 0.8, 0.6, 1)
    for r in range(2):
        y = r * 0.36
        K.rbox(F, -w / 2, w / 2, 0.0, d, y, y + 0.035, "H_wood_oak", r=0.0, seg=1, tn=wood, bottom=True)
        for x in (-w / 2 + 0.12, w / 2 - 0.12):
            K.rbox(F, x - 0.01, x + 0.01, 0.0, 0.01, y - 0.15, y, "H_metal", r=0.0, seg=1, tn=DARK)
        n = int((w - 0.2) / 0.14)
        for k in range(n):
            x = -w / 2 + 0.12 + k * 0.14
            c = ((0.95, 0.93, 0.88, 1), (0.85, 0.6, 0.5, 1), (0.6, 0.72, 0.78, 1), (0.9, 0.8, 0.5, 1), (0.4, 0.45, 0.5, 1))[(k + r * 2) % 5]
            if r == 0 or k % 3:
                K.lathe(F, x, d * 0.5, y + 0.035, [(0, 0), (0.035, 0.0), (0.038, 0.09), (0.036, 0.092), (0.0, 0.088)], "H_ceramic", 9, tn=c)
                K.tube(F, [(x + 0.036, d * 0.5, y + 0.075), (x + 0.065, d * 0.5, y + 0.07), (x + 0.065, d * 0.5, y + 0.04), (x + 0.036, d * 0.5, y + 0.035)], 0.005, "H_ceramic", 4, tn=c, caps=False)
    K.lathe(F, w / 2 - 0.12, d * 0.5, 0.395, [(0, 0), (0.05, 0.0), (0.05, 0.16), (0.04, 0.18), (0, 0.18)], "H_glass", 10, tn=(0.9, 0.92, 0.9, 1))


def menu_board(F, w=0.7, h=0.9):
    """a blank slate board in a wooden frame on the wall (no writing): dark panel, frame, a ledge with chalk"""
    K.rbox(F, -w / 2, w / 2, 0.0, 0.03, 0.0, h, "H_wood_oak", r=0.0, seg=1, tn=(0.55, 0.38, 0.26, 1), skip=("-z",))
    K.rbox(F, -w / 2 + 0.04, w / 2 - 0.04, 0.03, 0.034, 0.04, h - 0.04, "H_screen", r=0.0, seg=1, tn=(0.16, 0.19, 0.17, 1), skip=("-z",))
    K.rbox(F, -w / 2 + 0.06, w / 2 - 0.06, 0.03, 0.06, 0.0, 0.015, "H_wood_oak", r=0.0, seg=1, tn=(0.55, 0.38, 0.26, 1))
    K.rbox(F, -0.1, -0.03, 0.04, 0.05, 0.015, 0.025, "H_plaster", r=0.0, seg=1, tn=(0.95, 0.95, 0.9, 1))


def bed_single_n(F, side=-1, **kw):
    """single bed with ONE open long side (the other side is against the wall): one seat on the `side` edge (local x sign), approached from the side"""
    BE.bed(F, w=0.98, l=2.0, pillows=1, mark=False, headboard=kw.pop("headboard", "panel"), **kw)
    hw, hl = 0.49, 1.0
    K.seat(F, 0, K.SEAT_KIND_BACKLESS, side * (hw - 0.14), hl - 0.55, 0.50, side * math.pi / 2, edge=0.14, back=0.0, width=0.6,
           approach=K.APPROACH_SIDE, pose=K.POSE_CHAIR, stand=(side * (hw + 0.45), hl - 0.55))


def sofa_floor_n(F, n=3, w=2.4, **kw):
    SE.sofa_floor(F, w=w, seats=n, **kw)


K.FURN["bed_single_n"] = "bed"
K.FURN["sofa_floor_n"] = "floorsofa"
