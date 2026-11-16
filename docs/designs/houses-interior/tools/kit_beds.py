"""Beds and built-in seats of the houses kit. Bed edges carry BACKLESS seat markers (approach 'side': sit on the edge,
facing away from the bed). Real sizes: top of mattress 0.50 m."""
import math
import random
from kit_core import *   # noqa: F401,F403
from kit_core import S
from kit_seating import WOOD, BLK, sqleg, leg, pillow, welt


def _duvet(F, x0, x1, z0, z1, y0, tn, drape=0.16):
    """duvet: soft slab with real drape over the long sides, a puffy top with gentle valleys (cuts + sag + puff) and a folded band."""
    rbox(F, x0 - drape * 0.35, x1 + drape * 0.35, z0, z1, y0 - drape, y0 + 0.07, "H_fabric", r=0.05, seg=3, tile=0.6, tn=tn, puff=0.025,
         sag=0.0, cuts=8, smooth=True)
    # folded top band
    rbox(F, x0 - drape * 0.3, x1 + drape * 0.3, z0 - 0.0, z0 + 0.34, y0 + 0.05, y0 + 0.1, "H_fabric", r=0.025, seg=3, tile=0.6,
         tn=tuple(min(1.0, c * 1.08) for c in tn[:3]) + (1,), puff=0.01, cuts=4, smooth=True)


def bed(F, w=1.6, l=2.05, tn=None, wood="natural", headboard="panel", pillows=2, mark=True, leg_h=0.2, frame_tn=None, head_h=1.05,
        sheet_tn=None):
    """침대: frame + 4 legs + headboard (-z end), mattress with piped edge, duvet (draped), pillows. Seats: both long edges, near the foot."""
    tn = tn or PAL["cream"]
    wt = frame_tn or WOOD[wood]
    hw, hl = w / 2, l / 2
    for (sx, sz) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        sqleg(F, sx * (hw - 0.04), sz * (hl - 0.04), 0.0, leg_h + 0.06, 0.06, 0.045, "H_wood_oak", wt)
    rbox(F, -hw, hw, -hl, hl, leg_h, 0.30, "H_wood_oak", r=0.01, seg=2, tn=wt, grain=(0, 1, 0))
    # headboard
    if headboard == "panel":
        rbox(F, -hw - 0.03, hw + 0.03, -hl - 0.06, -hl, 0.0, head_h, "H_wood_oak", r=0.012, seg=2, tn=wt, grain=(1, 0, 0))
        for k in range(1, 6):
            x = -hw + k * w / 6
            rbox(F, x - 0.004, x + 0.004, -hl, -hl + 0.004, 0.45, head_h - 0.08, "H_wood_oak", r=0.0, seg=1, tn=tuple(c * 0.7 for c in wt[:3]) + (1,))
    elif headboard == "padded":
        rbox(F, -hw - 0.03, hw + 0.03, -hl - 0.1, -hl, 0.2, head_h, "H_fabric", r=0.05, seg=3, tile=0.5, tn=PAL["sofa_grey"], puff=0.02, cuts=5, smooth=True)
        for k in range(1, 4):
            x = -hw + k * w / 4
            rbox(F, x - 0.004, x + 0.004, -hl - 0.004, -hl + 0.0, 0.5, head_h - 0.08, "H_fabric", r=0.0, seg=1, tn=(0.55, 0.55, 0.55, 1))
    # foot board (low)
    rbox(F, -hw, hw, hl - 0.03, hl + 0.01, leg_h, 0.40, "H_wood_oak", r=0.008, seg=2, tn=wt)
    # mattress
    rbox(F, -hw + 0.02, hw - 0.02, -hl + 0.02, hl - 0.04, 0.30, 0.50, "H_fabric", r=0.04, seg=3, tile=0.6, tn=sheet_tn or (0.95, 0.95, 0.92, 1), puff=0.01,
         cuts=4, smooth=True)
    _duvet(F, -hw + 0.03, hw - 0.03, -hl + 0.55, hl - 0.02, 0.50, tn)
    np_ = pillows
    pw = (w - 0.2) / max(np_, 1)
    for i in range(np_):
        x = -hw + 0.1 + pw * (i + 0.5)
        rbox(F, x - pw / 2 + 0.03, x + pw / 2 - 0.03, -hl + 0.1, -hl + 0.56, 0.50, 0.64, "H_fabric", r=0.07, seg=3, tile=0.5,
             tn=PAL["white"], puff=0.04, cuts=5, smooth=True)
    if mark:
        for sgn, name in ((-1, "L"), (1, "R")):
            seat(F, 0 if sgn < 0 else 1, SEAT_KIND_BACKLESS, sgn * (hw - 0.14), hl - 0.55, 0.50, sgn * math.pi / 2, edge=0.14, back=0.0, width=0.6,
                 approach=APPROACH_SIDE, pose=POSE_CHAIR, stand=(sgn * (hw + 0.45), hl - 0.55))
    col(F, -hw - 0.03, hw + 0.03, -hl - 0.1, hl + 0.01, 0.5, name="bed")


def bed_queen(F, **kw):
    bed(F, w=1.6, l=2.1, **kw)


def bed_single(F, **kw):
    kw.setdefault("headboard", "panel")
    bed(F, w=0.98, l=2.0, pillows=1, **kw)


def bunk_bed(F, tn=None, wood="pine"):
    """2층 침대 (5번 방): 4 posts, lower and upper mattress, upper guard rail on three sides, side ladder with 5 rungs; sit on the lower edge."""
    tn = tn or PAL["sky"]
    wt = WOOD[wood]
    w, l = 1.0, 2.0
    hw, hl = w / 2, l / 2
    ph = 1.75
    for (sx, sz) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        rbox(F, sx * (hw + 0.0) - 0.035, sx * (hw + 0.0) + 0.035, sz * (hl) - 0.035, sz * (hl) + 0.035, 0.0, ph, "H_wood_oak", r=0.008, seg=2, tn=wt, grain=(0, 0, 1))
    for y0 in (0.22, 1.1):
        for sx in (-1, 1):
            rbox(F, sx * hw - 0.02, sx * hw + 0.02, -hl, hl, y0, y0 + 0.15, "H_wood_oak", r=0.006, seg=1, tn=wt, grain=(0, 1, 0))
        for sz in (-1, 1):
            rbox(F, -hw, hw, sz * hl - 0.02, sz * hl + 0.02, y0, y0 + 0.15, "H_wood_oak", r=0.006, seg=1, tn=wt)
        rbox(F, -hw + 0.02, hw - 0.02, -hl + 0.02, hl - 0.02, y0 + 0.12, y0 + 0.30, "H_fabric", r=0.04, seg=3, tile=0.6, tn=(0.95, 0.95, 0.92, 1), puff=0.01, cuts=3, smooth=True)
        _duvet(F, -hw + 0.03, hw - 0.03, -hl + 0.45, hl - 0.03, y0 + 0.3, tn, drape=0.1)
        rbox(F, -hw + 0.12, hw - 0.12, -hl + 0.08, -hl + 0.5, y0 + 0.3, y0 + 0.38, "H_fabric", r=0.05, seg=3, tile=0.5, tn=PAL["white"], puff=0.03, cuts=4, smooth=True)
    # upper guard rails (3 sides) with balusters
    gy = 1.1 + 0.3
    for sx in (-1, 1):
        rbox(F, sx * hw - 0.02, sx * hw + 0.02, -hl, hl - 0.6, gy + 0.2, gy + 0.3, "H_wood_oak", r=0.006, seg=1, tn=wt, grain=(0, 1, 0))
        rbox(F, sx * hw - 0.015, sx * hw + 0.015, -hl, hl - 0.6, gy + 0.05, gy + 0.09, "H_wood_oak", r=0.004, seg=1, tn=wt, grain=(0, 1, 0))
    rbox(F, -hw, hw, -hl - 0.02, -hl + 0.02, gy + 0.2, gy + 0.3, "H_wood_oak", r=0.006, seg=1, tn=wt)
    for k in range(1, 8):
        z = -hl + k * (l - 0.6) / 8
        for sx in (-1, 1):
            tube(F, [(sx * hw, z, gy + 0.09), (sx * hw, z, gy + 0.2)], 0.008, "H_wood_oak", 6, tn=wt, caps=False)
    # ladder at the foot-side of the +x long side
    for z in (hl - 0.42, hl - 0.05):
        rbox(F, hw + 0.04 - 0.015, hw + 0.04 + 0.015, z - 0.02, z + 0.02, 0.0, 1.45, "H_wood_oak", r=0.006, seg=1, tn=wt, grain=(0, 0, 1))
    for k in range(5):
        y = 0.25 + k * 0.25
        rbox(F, hw + 0.03, hw + 0.05, hl - 0.42, hl - 0.05, y, y + 0.035, "H_wood_oak", r=0.006, seg=1, tn=wt)
    seat(F, 0, SEAT_KIND_BACKLESS, -(hw - 0.14), hl - 0.5, 0.52, -math.pi / 2, edge=0.14, back=0.0, width=0.6, approach=APPROACH_SIDE, stand=(-(hw + 0.45), hl - 0.5))
    col(F, -hw - 0.03, hw + 0.1, -hl - 0.03, hl + 0.03, 1.75, name="bunk")


def mattress_sofa(F, w=1.9, d=0.95, tn=None):
    """다락 매트리스 소파: a low mattress on a pallet-like frame with two back bolsters; floor posture, front only."""
    tn = tn or PAL["sofa_beige"]
    hw, hd = w / 2, d / 2
    rbox(F, -hw, hw, -hd, hd, 0.0, 0.1, "H_wood_oak", r=0.006, seg=1, tn=WOOD["pine"])
    for k in range(5):
        x = -hw + (k + 0.5) * w / 5
        rbox(F, x - 0.02, x + 0.02, -hd, hd, 0.1, 0.14, "H_wood_oak", r=0.004, seg=1, tn=WOOD["pine"]) if False else None
    rbox(F, -hw + 0.02, hw - 0.02, -hd + 0.02, hd - 0.02, 0.1, 0.32, "H_fabric", r=0.05, seg=3, tile=0.6, tn=tn, puff=0.012, cuts=5, smooth=True)
    for i in range(2):
        x0 = -hw + 0.1 + i * (w - 0.2) / 2
        rbox(F, x0 + 0.02, x0 + (w - 0.2) / 2 - 0.02, -hd + 0.02, -hd + 0.26, 0.3, 0.7, "H_fabric", r=0.06, seg=3, tile=0.5, tn=PAL["sofa_sage"], puff=0.03, cuts=4,
             smooth=True, tilt=0.2)
        seat(F, i, SEAT_KIND_FLOOR, x0 + (w - 0.2) / 4, 0.05, 0.30, 0.0, edge=0.4, back=0.3, width=0.7, approach=APPROACH_FRONT, pose=POSE_FLOOR)
    col(F, -hw, hw, -hd, hd, 0.7, name="mattress")


def window_seat(F, w=1.6, d=0.5, h=0.45, tn=None):
    """창가 붙박이 좌석: built-in wooden bench with a storage drawer front and a long cushion; the window is behind it (-z) so it is approached from the front only."""
    tn = tn or PAL["sofa_beige"]
    rbox(F, -w / 2, w / 2, -d / 2, d / 2, 0.0, h - 0.07, "H_paint", r=0.006, seg=1, tn=PAL["paint_white"])
    for k in range(2):
        x = -w / 2 + (k + 0.5) * w / 2
        rbox(F, x - w / 4 + 0.03, x + w / 4 - 0.03, d / 2 - 0.0, d / 2 + 0.012, 0.06, h - 0.1, "H_paint", r=0.004, seg=1, tn=PAL["paint_white"])
        rbox(F, x - 0.05, x + 0.05, d / 2 + 0.012, d / 2 + 0.025, h - 0.18, h - 0.165, "H_metal", r=0.003, seg=1, tn=(0.7, 0.6, 0.4, 1))
    rbox(F, -w / 2, w / 2, -d / 2, d / 2 + 0.01, 0.0, 0.05, "H_paint", r=0.004, seg=1, tn=(0.4, 0.4, 0.4, 1))
    cushion_ = rbox(F, -w / 2 + 0.01, w / 2 - 0.01, -d / 2 + 0.01, d / 2 - 0.0, h - 0.07, h + 0.03, "H_fabric", r=0.03, seg=3, tile=0.5, tn=tn, puff=0.012, sag=0.008, cuts=8, smooth=True)
    for sgn in (-1, 1):
        pillow(F, sgn * (w / 2 - 0.2), -d / 2 + 0.15, h + 0.03, 0.4, 0.38, 0.12, "H_fabric", PAL["sofa_sage"] if sgn < 0 else PAL["mustard"], tilt=0.3)
    seat(F, 0, SEAT_KIND_BACKLESS, -w / 4, 0.0, h + 0.03, 0.0, edge=d / 2, back=0.0, width=0.7, approach=APPROACH_FRONT)
    seat(F, 1, SEAT_KIND_BACKLESS, w / 4, 0.0, h + 0.03, 0.0, edge=d / 2, back=0.0, width=0.7, approach=APPROACH_FRONT)
    col(F, -w / 2, w / 2, -d / 2, d / 2 + 0.02, h + 0.05, name="window_seat")


def seat_marker_only(F):
    pass


from kit_seating import cushion_seat  # noqa: E402,F401

PIECES = [
    dict(name="bed_queen", fn=bed_queen, group="beds", ref="15_master_bedroom", cam=dict(az=35, el=22)),
    dict(name="bed_double_padded", fn=bed, kw=dict(w=1.4, l=2.05, headboard="padded", tn=PAL["rug_blue"]), group="beds", ref="15_master_bedroom", cam=dict(az=35, el=22)),
    dict(name="bed_single", fn=bed_single, group="beds", ref="05_kids_room", cam=dict(az=35, el=22)),
    dict(name="bunk_bed", fn=bunk_bed, group="beds", ref="05_kids_room", cam=dict(az=40, el=18)),
    dict(name="mattress_sofa", fn=mattress_sofa, group="beds", ref="09_attic", cam=dict(az=35, el=25)),
    dict(name="window_seat", fn=window_seat, group="beds", ref="18_sunroom", cam=dict(az=30, el=20)),
]
