"""Kitchen modules of the houses kit: counter runs (base cabinets + worktop, optional sink with faucet, optional tile
backsplash), wall cabinets, hood, induction cooktop, gas range with cast-iron pots, fridges (no logos), island with bar overhang.
Counter frame: local -z is the wall side, +z the cook side; worktop height 0.90, depth 0.60."""
import math
from kit_core import *   # noqa: F401,F403
from kit_core import S
from kit_seating import WOOD, BLK
from kit_storage import bowl, mug, dish

STEEL = (0.82, 0.83, 0.84, 1)


BRASS = (0.78, 0.6, 0.32, 1)


def _handle_bar(F, x, z, y, length=0.16, vertical=False):
    """cottage pass: short brass bar pulls (shaker hardware)"""
    length = min(length, 0.11)
    if vertical:
        rbox(F, x - 0.007, x + 0.007, z, z + 0.022, y - length / 2, y + length / 2, "H_metal", r=0.004, seg=1, tn=BRASS)
    else:
        rbox(F, x - length / 2, x + length / 2, z, z + 0.022, y - 0.007, y + 0.007, "H_metal", r=0.004, seg=1, tn=BRASS)


def _handle_bar_old(F, x, z, y, length=0.16, vertical=False):
    if vertical:
        rbox(F, x - 0.006, x + 0.006, z, z + 0.02, y - length / 2, y + length / 2, "H_metal", r=0.003, seg=1, tn=STEEL)
    else:
        rbox(F, x - length / 2, x + length / 2, z, z + 0.02, y - 0.006, y + 0.006, "H_metal", r=0.003, seg=1, tn=STEEL)


def counter_base(F, length=2.4, d=0.6, top="oak", door_tn=None, sink=False, cook=None, tile_back=True, tile_h=0.6, plinth=0.1, drawers=True):
    """base cabinets with doors (every 0.6 m) + a drawer row, a 4 cm worktop (oak butcher-block or white), optional tile backsplash.
    sink=True cuts a 0.8 m basin (stainless) with a gooseneck faucet; cook='gas'|'induction' puts a hob on the worktop."""
    door_tn = door_tn or PAL["paint_white"]
    hl = length / 2
    top_m, top_tn = ("H_wood_oak", (0.95, 0.8, 0.6, 1)) if top == "oak" else ("H_tile_white", (0.95, 0.95, 0.93, 1))
    if top == "stone":
        top_m, top_tn = "H_stone", (0.8, 0.8, 0.78, 1)
    ph = 0.90
    rbox(F, -hl, hl, -d / 2, d / 2 - 0.03, 0.0, plinth, "H_paint", r=0.002, seg=1, tn=(0.25, 0.25, 0.25, 1))
    rbox(F, -hl, hl, -d / 2, d / 2 - 0.02, plinth, ph - 0.04, "H_paint", r=0.004, seg=1, tn=door_tn)
    n = max(1, int(round(length / 0.6)))
    w = length / n
    for i in range(n):
        x0 = -hl + i * w + 0.004
        x1 = x0 + w - 0.008
        if drawers:
            rbox(F, x0, x1, d / 2 - 0.02, d / 2, ph - 0.04 - 0.16, ph - 0.045, "H_paint", r=0.004, seg=1, tn=door_tn)
            _handle_bar(F, (x0 + x1) / 2, d / 2, ph - 0.04 - 0.09, 0.14)
        rbox(F, x0, x1, d / 2 - 0.02, d / 2, plinth + 0.004, ph - 0.04 - 0.17 if drawers else ph - 0.045, "H_paint", r=0.004, seg=1, tn=door_tn)
        # cottage pass: shaker door, a recessed centre panel framed by 6 cm stiles and rails
        dy1 = ph - 0.04 - 0.17 if drawers else ph - 0.045
        for (a_, b_, c_, e_) in ((x0, x0 + 0.06, plinth + 0.004, dy1), (x1 - 0.06, x1, plinth + 0.004, dy1),
                                 (x0 + 0.06, x1 - 0.06, plinth + 0.004, plinth + 0.064), (x0 + 0.06, x1 - 0.06, dy1 - 0.06, dy1)):
            rbox(F, a_, b_, d / 2, d / 2 + 0.012, c_, e_, "H_paint", r=0.0, seg=1, tn=door_tn, skip=("-z", "-y"))
        _handle_bar(F, x0 + 0.05 if i % 2 == 0 else x1 - 0.05, d / 2, ph - 0.28, 0.2, vertical=True)
    # worktop
    if sink:
        sw = 0.8
        rbox(F, -hl, -sw / 2, -d / 2 - 0.0, d / 2 + 0.02, ph - 0.04, ph, top_m, r=0.006, seg=1, tn=top_tn, grain=(1, 0, 0), tile=0.9)
        rbox(F, sw / 2, hl, -d / 2 - 0.0, d / 2 + 0.02, ph - 0.04, ph, top_m, r=0.006, seg=1, tn=top_tn, grain=(1, 0, 0), tile=0.9)
        rbox(F, -sw / 2, sw / 2, -d / 2, -0.17, ph - 0.04, ph, top_m, r=0.006, seg=1, tn=top_tn, grain=(1, 0, 0), tile=0.9)
        rbox(F, -sw / 2, sw / 2, 0.17, d / 2 + 0.02, ph - 0.04, ph, top_m, r=0.006, seg=1, tn=top_tn, grain=(1, 0, 0), tile=0.9)
        # basin: a steel box below the opening
        # cottage pass: a white fireclay apron (butler) sink, its front standing proud of the doors
        rbox(F, -sw / 2 + 0.0, sw / 2, -0.17, 0.17, ph - 0.2, ph - 0.04, "H_ceramic", r=0.02, seg=2, tn=(0.97, 0.97, 0.95, 1), bottom=True, skip=("+y",))
        rbox(F, -sw / 2 + 0.03, sw / 2 - 0.03, d / 2 - 0.03, d / 2 + 0.035, ph - 0.25, ph + 0.004, "H_ceramic", r=0.02, seg=2, tn=(0.97, 0.97, 0.95, 1))
        # drain + faucet
        lathe(F, -0.18, 0.0, ph - 0.2, [(0, 0.0), (0.03, 0.0), (0.03, 0.004), (0, 0.004)], "H_metal", 10, tn=BLK)
        fx, fz = 0.0, -d / 2 + 0.07
        cyl(F, fx, fz, ph, ph + 0.05, 0.022, "H_metal", 12, tn=BRASS)
        tube(F, [(fx, fz, ph + 0.05), (fx, fz, ph + 0.28), (fx, fz + 0.04, ph + 0.4), (fx, fz + 0.17, ph + 0.38), (fx, fz + 0.2, ph + 0.31)], 0.013, "H_metal", 10, tn=BRASS)
        tube(F, [(fx + 0.03, fz, ph + 0.04), (fx + 0.09, fz, ph + 0.16)], 0.008, "H_metal", 8, tn=STEEL)
    else:
        rbox(F, -hl, hl, -d / 2, d / 2 + 0.02, ph - 0.04, ph, top_m, r=0.006, seg=1, tn=top_tn, grain=(1, 0, 0), tile=0.9)
    if tile_back:
        gface(F, [(-hl, -d / 2 + 0.002, ph), (hl, -d / 2 + 0.002, ph), (hl, -d / 2 + 0.002, ph + tile_h), (-hl, -d / 2 + 0.002, ph + tile_h)],
              "H_tile_white", (1, 0, 0), 1.0, (0, 1, 0))
        rbox(F, -hl, hl, -d / 2, -d / 2 + 0.004, ph + tile_h - 0.004, ph + tile_h + 0.004, "H_paint", r=0.0, seg=1, tn=(0.8, 0.8, 0.8, 1))
    if cook == "induction":
        cooktop_induction(F.sub(0, 0, ph, 0))
    if cook == "gas":
        gas_range(F.sub(0, 0, ph, 0))
    if cook:
        range_front(F, d, ph, plinth)
    col(F, -hl, hl, -d / 2, d / 2 + 0.02, ph, name="counter")


RANGE_TN = [(0.86, 0.84, 0.78, 1)]     # cottage pass: the range cooker's enamel (a house sets its own: KI.RANGE_TN[0] = ...)


def range_front(F, d, ph, plinth, w=0.7):
    """cottage pass: the 0.7 m under the hob is a range cooker — an enamel front with two oven doors (glass windows), a brass towel
    rail, a row of knobs under the hob"""
    tn = RANGE_TN[0]
    hw = w / 2
    rbox(F, -hw, hw, d / 2 - 0.02, d / 2 + 0.03, plinth, ph - 0.03, "H_ceramic", r=0.01, seg=1, tn=tn)
    rbox(F, -hw - 0.01, hw + 0.01, -d / 2, d / 2 + 0.04, ph - 0.035, ph + 0.004, "H_ceramic", r=0.008, seg=1, tn=tn)
    for (x0, x1) in ((-hw + 0.03, -0.015), (0.015, hw - 0.03)):
        rbox(F, x0, x1, d / 2 + 0.03, d / 2 + 0.045, plinth + 0.08, ph - 0.2, "H_ceramic", r=0.008, seg=1, tn=tn)
        rbox(F, x0 + 0.05, x1 - 0.05, d / 2 + 0.045, d / 2 + 0.048, plinth + 0.2, ph - 0.3, "H_screen", r=0.0, seg=1)
    bar(F, (-hw + 0.04, d / 2 + 0.09, ph - 0.16), (hw - 0.04, d / 2 + 0.09, ph - 0.16), 0.016, 0.016, "H_metal", tn=BRASS)
    for k in range(5):
        x = -hw + 0.08 + k * (w - 0.16) / 4
        rbox(F, x - 0.018, x + 0.018, d / 2 + 0.03, d / 2 + 0.06, ph - 0.11, ph - 0.075, "H_metal", r=0.008, seg=1, tn=BRASS)


def cooktop_induction(F, w=0.6, d=0.5):
    """black glass hob: 4 zone rings, a slim control strip, a small bevelled frame (no brand)."""
    rbox(F, -w / 2, w / 2, -d / 2, d / 2, 0.0, 0.008, "H_screen", r=0.003, seg=1)
    for (x, z, r) in ((-0.14, -0.1, 0.09), (0.14, -0.1, 0.07), (-0.14, 0.1, 0.07), (0.14, 0.1, 0.09)):
        pts = [(x + r * math.cos(2 * math.pi * i / 28), z + r * math.sin(2 * math.pi * i / 28), 0.0085) for i in range(28)]
        tube(F, pts + [pts[0]], 0.0015, "H_metal", 4, tn=(0.55, 0.55, 0.55, 1), caps=False)
    rbox(F, -0.1, 0.1, d / 2 - 0.05, d / 2 - 0.035, 0.0082, 0.0092, "H_metal", r=0.0, seg=1, tn=(0.5, 0.5, 0.5, 1))


def gas_range(F, w=0.6, d=0.5):
    """gas hob: steel plate, 2 burners with grates, 2 knobs on the front rim, a 무쇠솥 (cast iron pot) and a steel pot with lid on top."""
    rbox(F, -w / 2, w / 2, -d / 2, d / 2, 0.0, 0.015, "H_metal", r=0.004, seg=1, tn=STEEL)
    for k, x in enumerate((-0.14, 0.14)):
        lathe(F, x, 0.0, 0.015, [(0.0, 0.0), (0.05, 0.0), (0.05, 0.012), (0.035, 0.016), (0, 0.016)], "H_metal", 14, tn=BLK)
        for a in range(4):
            ang = a * math.pi / 2 + math.pi / 4
            bar(F, (x, 0.0, 0.03), (x + 0.11 * math.cos(ang), 0.11 * math.sin(ang), 0.03), 0.008, 0.008, "H_metal", tn=BLK)
        rbox(F, x - 0.015, x + 0.015, d / 2 - 0.0, d / 2 + 0.03, 0.0, 0.03, "H_metal", r=0.004, seg=1, tn=BLK) if False else None
    for x in (-0.14, 0.14):
        lathe(F, x, d / 2 - 0.02, 0.0, [(0, 0.0), (0.018, 0.0), (0.018, 0.03), (0, 0.03)], "H_metal", 10, tn=BLK)
    # 무쇠솥 on the left burner: squat black iron pot with a heavy domed lid and a knob
    lathe(F, -0.14, 0.0, 0.03, [(0, 0.0), (0.13, 0.0), (0.16, 0.06), (0.165, 0.13), (0.15, 0.135), (0.0, 0.135)], "H_rubber", 24, tn=(0.45, 0.45, 0.47, 1))
    lathe(F, -0.14, 0.0, 0.16, [(0.165, 0.0), (0.17, 0.012), (0.14, 0.05), (0.06, 0.08), (0.0, 0.085)], "H_rubber", 24, tn=(0.5, 0.5, 0.52, 1))
    lathe(F, -0.14, 0.0, 0.24, [(0, 0.0), (0.02, 0.0), (0.022, 0.025), (0, 0.03)], "H_rubber", 10, tn=(0.6, 0.6, 0.6, 1))
    # steel pot with a lid on the right burner and a handle
    lathe(F, 0.14, 0.0, 0.03, [(0, 0.0), (0.095, 0.0), (0.1, 0.01), (0.1, 0.12), (0.0, 0.12)], "H_metal", 20, tn=STEEL)
    lathe(F, 0.14, 0.0, 0.15, [(0.103, 0.0), (0.1, 0.012), (0.04, 0.025), (0, 0.027)], "H_metal", 20, tn=STEEL)
    for s in (-1, 1):
        rbox(F, 0.14 + s * 0.14 - 0.015, 0.14 + s * 0.14 + 0.015, -0.015, 0.015, 0.09, 0.105, "H_rubber", r=0.004, seg=1) if False else None
    rbox(F, 0.25, 0.32, -0.015, 0.015, 0.12, 0.135, "H_rubber", r=0.004, seg=1)


def upper_cabinets(F, length=2.4, d=0.34, y0=1.5, h=0.7, door_tn=None):
    """wall cabinets: flush doors, a slim top gap, bar handles."""
    door_tn = door_tn or PAL["paint_white"]
    hl = length / 2
    rbox(F, -hl, hl, -d / 2, d / 2 - 0.02, y0, y0 + h, "H_paint", r=0.004, seg=1, tn=door_tn)
    n = max(1, int(round(length / 0.6)))
    w = length / n
    for i in range(n):
        x0 = -hl + i * w + 0.004
        x1 = x0 + w - 0.008
        rbox(F, x0, x1, d / 2 - 0.02, d / 2, y0 + 0.004, y0 + h - 0.004, "H_paint", r=0.004, seg=1, tn=door_tn)
        _handle_bar(F, x0 + 0.05 if i % 2 == 0 else x1 - 0.05, d / 2, y0 + 0.14, 0.18, vertical=True)
    col(F, -hl, hl, -d / 2, d / 2, y0 + h, name="upper")


def hood(F, w=0.8, d=0.5, y0=1.55, duct_to=3.7):
    """stainless chimney hood: a tapered canopy and a square duct up to the ceiling, a slim light strip."""
    for (x0, x1, z0, z1, ya, yb) in ((-w / 2, w / 2, -d / 2, d / 2 - 0.0, y0, y0 + 0.12), (-0.15, 0.15, -d / 2, -d / 2 + 0.28, y0 + 0.12, duct_to)):
        rbox(F, x0, x1, z0, z1, ya, yb, "H_metal", r=0.006, seg=1, tn=STEEL, bottom=(ya == y0))
    rbox(F, -w / 2 + 0.06, w / 2 - 0.06, d / 2 - 0.15, d / 2 - 0.1, y0 - 0.002, y0 + 0.002, "H_lamp", r=0.0, seg=1)


def fridge(F, w=0.7, d=0.72, h=1.85, doors=2, tn=None):
    """냉장고: 2-door (freezer drawer under a fridge door) in satin steel, vertical bar pulls, a dark side/ top, no logo."""
    tn = tn or STEEL
    hw, hd = w / 2, d / 2
    rbox(F, -hw, hw, -hd, hd - 0.03, 0.0, h, "H_paint", r=0.01, seg=2, tn=(0.55, 0.55, 0.57, 1))
    rbox(F, -hw + 0.01, hw - 0.01, hd - 0.03, hd, 0.0, h * 0.38, "H_metal", r=0.006, seg=1, tn=tn)           # freezer drawer
    rbox(F, -hw + 0.01, hw - 0.01, hd - 0.03, hd, h * 0.385, h - 0.01, "H_metal", r=0.006, seg=1, tn=tn)     # fridge door
    rbox(F, hw - 0.1, hw - 0.075, hd, hd + 0.04, h * 0.45, h * 0.92, "H_metal", r=0.004, seg=1, tn=(0.9, 0.9, 0.9, 1))
    rbox(F, -0.2, 0.2, hd, hd + 0.04, h * 0.3, h * 0.318, "H_metal", r=0.004, seg=1, tn=(0.9, 0.9, 0.9, 1))
    col(F, -hw, hw, -hd, hd + 0.04, h, name="fridge")


def fridge_double(F, w=0.92, d=0.74, h=1.8):
    """양문 냉장고 (3번 집): two tall steel doors side by side, long vertical pulls near the centre, a lower pull-out drawer line."""
    hw, hd = w / 2, d / 2
    rbox(F, -hw, hw, -hd, hd - 0.03, 0.0, h, "H_paint", r=0.01, seg=2, tn=(0.55, 0.55, 0.57, 1))
    for sx in (-1, 1):
        x0, x1 = (sx * 0.004, sx * hw - sx * 0.008) if sx > 0 else (-hw + 0.008, -0.004)
        rbox(F, min(x0, x1), max(x0, x1), hd - 0.03, hd, 0.0, h - 0.01, "H_metal", r=0.006, seg=1, tn=STEEL)
        rbox(F, sx * 0.04 - 0.008, sx * 0.04 + 0.008, hd, hd + 0.04, h * 0.3, h * 0.85, "H_metal", r=0.004, seg=1, tn=(0.9, 0.9, 0.9, 1))
    col(F, -hw, hw, -hd, hd + 0.04, h, name="fridge")


def fridge_kimchi(F, w=0.6, d=0.68, h=1.1):
    """김치냉장고: lid-top style, a hinged upper hatch and a drawer, a pale body."""
    hw, hd = w / 2, d / 2
    rbox(F, -hw, hw, -hd, hd - 0.02, 0.0, h, "H_paint", r=0.012, seg=2, tn=(0.88, 0.88, 0.86, 1))
    rbox(F, -hw + 0.01, hw - 0.01, hd - 0.02, hd, 0.02, h * 0.36, "H_paint", r=0.006, seg=1, tn=(0.8, 0.8, 0.78, 1))
    rbox(F, -hw + 0.01, hw - 0.01, hd - 0.02, hd, h * 0.37, h - 0.02, "H_paint", r=0.006, seg=1, tn=(0.9, 0.9, 0.88, 1))
    rbox(F, -0.12, 0.12, hd, hd + 0.025, h * 0.34, h * 0.355, "H_metal", r=0.003, seg=1, tn=STEEL)
    rbox(F, -0.12, 0.12, hd, hd + 0.025, h * 0.88, h * 0.9, "H_metal", r=0.003, seg=1, tn=STEEL)
    col(F, -hw, hw, -hd, hd + 0.03, h, name="fridge")


def island(F, w=2.4, d=0.9, overhang=0.3, top="stone", door_tn=None):
    """아일랜드: base cabinets on the cook side, a 4 cm worktop with a 0.30 m bar overhang on the stool side (+z), 2 legs."""
    door_tn = door_tn or (0.8, 0.82, 0.78, 1)
    hw = w / 2
    cd = d - overhang
    rbox(F, -hw, hw, -d / 2, -d / 2 + cd, 0.0, 0.1, "H_paint", r=0.002, seg=1, tn=(0.25, 0.25, 0.25, 1))
    rbox(F, -hw, hw, -d / 2, -d / 2 + cd, 0.1, 0.86, "H_paint", r=0.004, seg=1, tn=door_tn)
    n = int(round(w / 0.6))
    ww = w / n
    for i in range(n):
        x0 = -hw + i * ww + 0.005
        x1 = x0 + ww - 0.01
        rbox(F, x0, x1, -d / 2 - 0.018, -d / 2, 0.11, 0.85, "H_paint", r=0.004, seg=1, tn=door_tn)
    m, tn = ("H_stone", (0.78, 0.78, 0.75, 1)) if top == "stone" else ("H_wood_oak", (0.95, 0.8, 0.6, 1))
    rbox(F, -hw - 0.02, hw + 0.02, -d / 2 - 0.02, d / 2, 0.86, 0.9, m, r=0.006, seg=1, tn=tn, grain=(1, 0, 0), tile=1.0)
    for sx in (-1, 1):
        rbox(F, sx * (hw - 0.04) - 0.025, sx * (hw - 0.04) + 0.025, d / 2 - 0.06, d / 2 - 0.01, 0.0, 0.86, "H_wood_oak", r=0.004, seg=1, tn=(0.9, 0.85, 0.8, 1), grain=(0, 0, 1))
    col(F, -hw - 0.02, hw + 0.02, -d / 2 - 0.02, d / 2, 0.9, name="island")


PIECES = [
    dict(name="counter_sink_oak", fn=counter_base, kw=dict(length=2.4, sink=True), group="kitchen", ref="03_farm_kitchen", cam=dict(az=-20, el=15, dist=1.7)),
    dict(name="counter_gas_tile", fn=counter_base, kw=dict(length=1.8, cook="gas"), group="kitchen", ref="03_farm_kitchen", cam=dict(az=20, el=18, dist=1.8)),
    dict(name="counter_induction_white", fn=counter_base, kw=dict(length=1.8, cook="induction", top="stone"), group="kitchen", ref="02_modern_living", cam=dict(az=20, el=18, dist=1.8)),
    dict(name="upper_cabinets", fn=upper_cabinets, group="kitchen", ref="03_farm_kitchen", cam=dict(az=20, el=5, dist=1.7)),
    dict(name="hood", fn=hood, group="kitchen", ref="03_farm_kitchen", cam=dict(az=20, el=10, dist=1.6)),
    dict(name="fridge", fn=fridge, group="kitchen", ref="03_farm_kitchen", cam=dict(az=30, el=10, dist=1.6)),
    dict(name="fridge_double", fn=fridge_double, group="kitchen", ref="03_farm_kitchen", cam=dict(az=30, el=10, dist=1.6)),
    dict(name="fridge_kimchi", fn=fridge_kimchi, group="kitchen", ref="03_farm_kitchen", cam=dict(az=30, el=15, dist=1.7)),
    dict(name="island", fn=island, group="kitchen", ref="11_dining", cam=dict(az=30, el=22, dist=1.7)),
]
