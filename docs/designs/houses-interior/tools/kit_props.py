"""Small shared props of the houses kit -> houses_props.glb (build_houses_props.py bakes + exports them).

Every prop is ONE mesh, real size, origin at the bottom centre, front +z. All colours come from the 8x8 colour atlas
(H_atlas, make_house_textures.CELLS): S.fuv forces a cell for every face drawn while it is set. Light/AO is baked into one
shared texture by build_houses_props.py, so GPU instancing needs no light map."""
import math
import random
from kit_core import *   # noqa: F401,F403
from kit_core import S
from kit_storage import acell, books_stack


def C(i):
    S.fuv = acell(i)


# the atlas's colours (make_house_textures_b.CELLS), for the glazed props that draw H_glaze tinted instead of an atlas cell (polish4)
CELLS = ["#F4F1EA", "#E7DDCB", "#C9A06C", "#8E673C", "#4A3022", "#2B2B2E", "#8A8D92", "#D8D5CE",
         "#C8553D", "#E08A3C", "#E6C34A", "#7FA650", "#3F7A4C", "#4F8FB5", "#3A5A9A", "#7B5BA6",
         "#D982A5", "#B64A5A", "#F2D7C7", "#6B4B3A", "#A88F6A", "#DCC9A0", "#9DB8A8", "#F0E6B8",
         "#E8E3D8", "#B8B2A6", "#5E8A8A", "#C97B63", "#EDEAE4", "#2F4B3A", "#74513C", "#BFA77A"]


def GZ(i):
    """glazed: no atlas cell, the cell's colour as the vertex tint of H_glaze"""
    S.fuv = None
    return tint(CELLS[i])


def ball(F, x, y, z, r, n=16, rings=7):
    """polish4: 16 sides x 7 rings kept, a little squat like a real apple / orange (polish3's 16 x 6 still read lumpy up close)"""
    prof = [(r * math.sin(math.pi * k / rings), 0.94 * r * (1.0 - math.cos(math.pi * k / rings))) for k in range(rings + 1)]
    prof[0], prof[-1] = (0.0, 0.0), (0.0, 0.94 * 2 * r)
    lathe(F, x, z, y - r, prof, "H_atlas", n, keep=True)


def books3(F):
    S.fuv = None
    books_stack(F, 0, 0, 0.0, 3, seed=11, w=0.2, d=0.15)


def books5(F):
    S.fuv = None
    books_stack(F, 0, 0, 0.0, 5, seed=12, w=0.22, d=0.16)


def book_row(F):
    S.fuv = None
    rnd = random.Random(13)
    x = -0.12
    for i in range(6):
        th = rnd.uniform(0.02, 0.04)
        rbox(F, x, x + th, -0.08, 0.08, 0.0, rnd.uniform(0.2, 0.28), "H_atlas", r=0.0, seg=1, uvc=acell(rnd.choice([2, 3, 8, 9, 11, 13, 14, 16, 20])))
        x += th + 0.001
    rbox(F, x + 0.02, x + 0.045, -0.08, 0.08, 0.0, 0.24, "H_atlas", r=0.0, seg=1, uvc=acell(15), tilt=-0.3)


PLATE = [(0, 0.0), (0.06, 0.0), (0.065, 0.004), (0.11, 0.022), (0.112, 0.026), (0.108, 0.026), (0.065, 0.01), (0, 0.008)]


def plate(F):
    lathe(F, 0, 0, 0.0, PLATE, "H_glaze", 24, tn=GZ(0), keep=True)


def plates_stack(F):
    t = GZ(0)
    for k in range(3):
        lathe(F, 0, 0, k * 0.013, PLATE, "H_glaze", 20, tn=t, keep=True)


def bowl_p(F):
    lathe(F, 0, 0, 0.0, [(0, 0.0), (0.03, 0.0), (0.035, 0.008), (0.07, 0.06), (0.072, 0.065), (0.068, 0.066), (0.035, 0.02), (0, 0.016)], "H_glaze", 32,
          tn=GZ(13), keep=True)


def fruit_bowl(F):
    lathe(F, 0, 0, 0.0, [(0, 0.0), (0.05, 0.0), (0.12, 0.05), (0.13, 0.06), (0.125, 0.062), (0.05, 0.012), (0, 0.01)], "H_glaze", 24, tn=GZ(24), keep=True)
    for (c, x, z, y, r) in ((8, -0.04, 0.0, 0.012, 0.035), (10, 0.04, 0.02, 0.012, 0.03), (9, 0.0, -0.045, 0.014, 0.033), (11, 0.012, 0.0, 0.05, 0.03)):
        C(c)
        ball(F, x, y + r, z, r)


def mug_p(F):
    t = GZ(0)
    lathe(F, 0, 0, 0.0, [(0, 0.0), (0.036, 0.0), (0.04, 0.004), (0.042, 0.095), (0.036, 0.095), (0.035, 0.01), (0, 0.008)], "H_glaze", 24, tn=t, keep=True)
    tube(F, [(0.04, 0, 0.075), (0.065, 0, 0.07), (0.065, 0, 0.03), (0.04, 0, 0.02)], 0.005, "H_glaze", 6, tn=t, caps=False)


def teacup(F):
    t = GZ(22)
    # polish3: a teacup on its saucer (it read as a hexagonal nut at 6 sides); polish4: glazed, 28 sides
    lathe(F, 0, 0, 0.0, [(0, 0.0), (0.05, 0.0), (0.062, 0.008), (0.06, 0.01), (0.03, 0.005), (0, 0.004)], "H_glaze", 28, tn=t, keep=True)
    lathe(F, 0, 0, 0.004, [(0, 0.0), (0.02, 0.0), (0.03, 0.012), (0.037, 0.045), (0.035, 0.047), (0.028, 0.014), (0, 0.01)], "H_glaze", 28, tn=t, keep=True)
    tube(F, [(0.034, 0, 0.04), (0.052, 0, 0.036), (0.05, 0, 0.018), (0.032, 0, 0.016)], 0.0035, "H_glaze", 5, tn=t, caps=False)


def teapot(F):
    t = GZ(0)
    lathe(F, 0, 0, 0.0, [(0, 0.0), (0.05, 0.0), (0.066, 0.015), (0.075, 0.04), (0.075, 0.07), (0.062, 0.088), (0.045, 0.095), (0.0, 0.1)], "H_glaze", 22,
          tn=t, keep=True)
    lathe(F, 0, 0, 0.1, [(0, 0.0), (0.012, 0.0), (0.014, 0.015), (0, 0.02)], "H_glaze", 16, tn=t, keep=True)
    tube(F, [(0.07, 0, 0.1), (0.12, 0, 0.1), (0.125, 0, 0.05), (0.075, 0, 0.045)], 0.007, "H_glaze", 8, tn=t, caps=False)
    tube(F, [(-0.07, 0, 0.09), (-0.12, 0, 0.07), (-0.075, 0, 0.035)], 0.007, "H_glaze", 8, tn=t, caps=False)


def kettle(F):
    C(6)
    lathe(F, 0, 0, 0.0, [(0, 0.0), (0.09, 0.0), (0.105, 0.03), (0.1, 0.1), (0.07, 0.16), (0.03, 0.185), (0, 0.19)], "H_atlas", 18)
    C(5)
    tube(F, [(-0.09, 0, 0.14), (0, 0, 0.27), (0.09, 0, 0.14)], 0.009, "H_atlas", 6, caps=False)
    tube(F, [(0.09, 0, 0.1), (0.15, 0, 0.17)], 0.011, "H_atlas", 6)


def cushion_sq(F):
    C(14)
    rbox(F, -0.2, 0.2, -0.06, 0.06, 0.0, 0.4, "H_atlas", r=0.05, seg=3, puff=0.03, cuts=4, smooth=True)


def cushion_round(F):
    C(17)
    lathe(F, 0, 0, 0.0, [(0, 0.0), (0.12, 0.02), (0.18, 0.06), (0.19, 0.09), (0.18, 0.12), (0.12, 0.16), (0, 0.17)], "H_atlas", 22)


def toy_ball(F):
    C(8)
    ball(F, 0, 0.05, 0, 0.05, 14)


def toy_blocks(F):
    for (c, x, z, y, yaw) in ((8, -0.03, 0, 0.0, 0.2), (10, 0.04, 0.01, 0.0, -0.3), (13, 0.0, 0.0, 0.04, 0.5)):
        C(c)
        rbox(F.sub(x, z, 0, yaw), -0.02, 0.02, -0.02, 0.02, y, y + 0.04, "H_atlas", r=0.004, seg=1)


def toy_car(F):
    C(9)
    rbox(F, -0.05, 0.05, -0.025, 0.025, 0.018, 0.045, "H_atlas", r=0.008, seg=2)
    rbox(F, -0.025, 0.03, -0.022, 0.022, 0.045, 0.068, "H_atlas", r=0.01, seg=2)
    C(5)
    for sx in (-0.03, 0.035):
        tube(F, [(sx, -0.03, 0.014), (sx, 0.03, 0.014)], 0.014, "H_atlas", 10)


def teddy(F):
    C(20)
    ball(F, 0, 0.085, 0, 0.075)
    ball(F, 0, 0.19, 0.0, 0.055)
    for sx in (-1, 1):
        ball(F, sx * 0.07, 0.17, 0.0, 0.025)
        ball(F, sx * 0.1, 0.1, 0.01, 0.03)
        ball(F, sx * 0.05, 0.03, 0.05, 0.035)
    C(19)
    ball(F, 0, 0.185, 0.045, 0.02)


def candle(F):
    """a pillar candle on a small brass dish: 18 sides, a slightly melted, dished top, a black wick (polish3: was a 6-sided prism)"""
    C(2)
    lathe(F, 0, 0, 0.0, [(0, 0.0), (0.04, 0.0), (0.046, 0.006), (0.044, 0.008), (0.032, 0.004), (0, 0.004)], "H_atlas", 18, keep=True)
    C(23)
    lathe(F, 0, 0, 0.004, [(0, 0.0), (0.03, 0.0), (0.03, 0.092), (0.028, 0.098), (0.02, 0.095), (0.0, 0.093)], "H_atlas", 24, keep=True)
    C(5)
    tube(F, [(0, 0, 0.096), (0.001, 0, 0.108)], 0.0012, "H_atlas", 4, caps=True)


def vase_small(F):
    lathe(F, 0, 0, 0.0, [(0, 0.0), (0.04, 0.0), (0.058, 0.025), (0.07, 0.06), (0.07, 0.1), (0.056, 0.135), (0.04, 0.16), (0.025, 0.2), (0.03, 0.22),
                         (0.024, 0.215), (0, 0.18)], "H_glaze", 28, tn=GZ(13), keep=True)


def leaf_pot(F):
    from kit_decor import leaf
    C(22)
    lathe(F, 0, 0, 0.0, [(0, 0.0), (0.05, 0.0), (0.075, 0.1), (0.08, 0.12), (0.07, 0.12)], "H_atlas", 14)
    C(12)
    rnd = random.Random(3)
    for k in range(9):
        a = k * 2.4
        leaf(F, (0, 0, 0.11), (math.cos(a), math.sin(a), rnd.uniform(0.3, 1.0)), 0.13, 0.07, droop=0.3, segs=3)


def cutting_board(F):
    C(2)
    rbox(F, -0.15, 0.15, -0.1, 0.1, 0.0, 0.02, "H_atlas", r=0.008, seg=2)
    C(11)
    rbox(F, -0.05, 0.04, -0.03, 0.02, 0.02, 0.026, "H_atlas", r=0.002, seg=1)


def frame_small(F):
    """a small standing picture frame (shelf, sideboard): a real painting in a slim frame on a short back strut."""
    import kit_paint as KP
    rbox(F, -0.012, 0.012, -0.06, 0.02, 0.0, 0.11, "H_wood_oak", r=0.002, seg=1, tn=(0.35, 0.25, 0.16, 1))
    KP.framed(F.sub(0, 0.02, 0.0, 0), 0.16, 0.2, frame_tn=(0.5, 0.34, 0.2, 1), mat=False)


def magazine(F):
    C(24)
    rbox(F, -0.1, 0.1, -0.14, 0.14, 0.0, 0.006, "H_atlas", r=0.0, seg=1)
    C(8)
    rbox(F, -0.095, 0.095, -0.1, 0.1, 0.006, 0.0066, "H_atlas", r=0.0, seg=1)


def pan(F):
    C(5)
    lathe(F, 0, 0, 0.0, [(0, 0.0), (0.09, 0.0), (0.11, 0.045), (0.105, 0.047), (0.09, 0.012), (0, 0.01)], "H_atlas", 20)
    rbox(F, 0.1, 0.3, -0.012, 0.012, 0.03, 0.045, "H_atlas", r=0.004, seg=1)


def glass_cup(F):
    C(24)
    lathe(F, 0, 0, 0.0, [(0, 0.0), (0.03, 0.0), (0.036, 0.1), (0.033, 0.1), (0.028, 0.008), (0, 0.006)], "H_atlas", 24, keep=True)


PROPS = [("books3", books3), ("books5", books5), ("book_row", book_row), ("plate", plate), ("plates_stack", plates_stack), ("bowl", bowl_p),
         ("fruit_bowl", fruit_bowl), ("mug", mug_p), ("teacup", teacup), ("teapot", teapot), ("kettle", kettle), ("cushion_sq", cushion_sq),
         ("cushion_round", cushion_round), ("toy_ball", toy_ball), ("toy_blocks", toy_blocks), ("toy_car", toy_car), ("teddy", teddy), ("candle", candle),
         ("vase_small", vase_small), ("leaf_pot", leaf_pot), ("cutting_board", cutting_board), ("frame_small", frame_small), ("magazine", magazine),
         ("pan", pan), ("glass_cup", glass_cup)]


def _mk(fn):
    def f(F):
        S.fuv = None
        fn(F)
        S.fuv = None
    return f


PIECES = [dict(name="prop_" + n, fn=_mk(fn), group="props", ref=None, cam=dict(az=30, el=25, dist=1.8)) for n, fn in PROPS]
