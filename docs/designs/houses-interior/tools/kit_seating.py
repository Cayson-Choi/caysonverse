"""Seating of the houses kit: sofas (fabric, L, leather, rattan, floor), armchairs (lounge, rattan, reading, rocking),
bean bag, dining chairs (4 kinds), stools (bar, workshop), ottoman, piano bench, benches, 방석, 보료 + 안석.
Every seat carries its marker (backed | backless | floor). Real sizes: seat top 0.45 m, dining chair 0.45, bar stool 0.65.
"""
import math
from kit_core import *   # noqa: F401,F403
from kit_core import S

WOOD = dict(natural=(1.0, 0.95, 0.85, 1), honey=(0.95, 0.68, 0.42, 1), walnut=(0.5, 0.36, 0.3, 1), dark=(0.33, 0.27, 0.25, 1),
            pine=(1.0, 0.9, 0.7, 1), ash=(0.95, 0.88, 0.8, 1), red=(0.85, 0.5, 0.35, 1))
BLK = (0.1, 0.1, 0.11, 1)


def leg(F, x, z, y0, y1, r0, r1=None, m="H_wood_oak", tn=None, segs=10):
    cyl(F, x, z, y0, y1, r0, m, segs, r2=r1 if r1 is not None else r0, cap=True, tn=tn)


def sqleg(F, x, z, y0, y1, w0, w1=None, m="H_wood_oak", tn=None, splay=(0, 0)):
    """tapered square leg (w0 at the top y1, w1 at the foot y0) with an optional splay (dx, dz at the foot)."""
    w1 = w0 if w1 is None else w1
    a, b = w0 / 2, w1 / 2
    top = [(x - a, z - a, y1), (x + a, z - a, y1), (x + a, z + a, y1), (x - a, z + a, y1)]
    fx, fz = x + splay[0], z + splay[1]
    bot = [(fx - b, fz - b, y0), (fx + b, fz - b, y0), (fx + b, fz + b, y0), (fx - b, fz + b, y0)]
    for i in range(4):
        j = (i + 1) % 4
        c = ((top[i][0] + top[j][0] + bot[i][0] + bot[j][0]) / 4 - x, (top[i][1] + top[j][1] + bot[i][1] + bot[j][1]) / 4 - z, 0)
        gface(F, [top[i], top[j], bot[j], bot[i]], m, (0, 0, 1), 0.9, c, tn=tn)
    gface(F, top, m, (1, 0, 0), 0.9, (0, 0, 1), tn=tn)
    gface(F, bot, m, (1, 0, 0), 0.9, (0, 0, -1), tn=tn)


def welt(F, pts, tn, r=0.006, m="H_fabric"):
    tube(F, pts, r, m, 6, tn=tn, caps=False)


def cushion_seat(F, x0, x1, z0, z1, y0, y1, m, tn, puff=0.012, sag=0.012, r=0.05, tile=None):
    """a loose seat cushion. houses-real pass (owner 2026-11-21, "is this really a new house?"): brand-new cushions — a gently crowned top,
    no sat-in dip (sag is ignored) and no separate welt tube (it cut through the crowned top, the light bake turned those cuts into dark
    scallops along every seat front and the thin tube into a hard dark line)."""
    rbox(F, x0, x1, z0, z1, y0, y1, m, r=r, seg=3, tile=tile or (0.25 if m == "H_leather" else 0.5), tn=tn, puff=min(puff, 0.012), sag=0.0, cuts=4,
         smooth=True, bottom=False)


def back_cushion(F, x0, x1, z, y0, y1, thick, m, tn, tilt=0.2, puff=0.025):
    """interior polish (owner 2026-11-27: "faint dark bars on top of the sofa back cushions, seen from behind"): the crown is capped at
    6 mm. The top of a back cushion is only its 0.2 m thickness; the old 25 mm crown on the 10 cm between its round-overs stood up as a
    ridge with a crease all round it, and from behind it read as a separate darker / lighter bar on every cushion, day and night."""
    rbox(F, x0, x1, z - thick, z, y0, y1, m, r=0.05, seg=3, tile=0.25 if m == "H_leather" else 0.5, tn=tn, puff=min(puff, 0.006), cuts=3, smooth=True,
         tilt=tilt)


_PILLOW_K = [0]


def pillow(F, cx, cz, y0, w, h, th, m, tn, tilt=0.25, yaw=0.0):
    """scatter cushion. layered pass: a house palette (S.pillow_m / S.pillow_tns) gives patterned cushions in its accent colours"""
    if S.pillow_m:
        m = S.pillow_m[_PILLOW_K[0] % len(S.pillow_m)] if isinstance(S.pillow_m, (list, tuple)) else S.pillow_m
    if S.pillow_tns:
        tn = S.pillow_tns[_PILLOW_K[0] % len(S.pillow_tns)]
    _PILLOW_K[0] += 1
    G = F.sub(cx, cz, 0, yaw)
    rbox(G, -w / 2, w / 2, -th / 2, th / 2, y0, y0 + h, m, r=th * 0.35, seg=3, tile=0.4, tn=tn, puff=0.03, cuts=3, smooth=True, tilt=tilt,
         taper=0.0)


# ====================================================================================================== sofas =====
def sofa_fabric(F, w=2.4, d=0.86, seats=3, tn=None, wood_tn=None, pillow_tn=None, m="H_fabric", leg_h=0.13, arm_w=0.16,
                back_h=0.84, mark=True, mark_id=0, low=False):
    """(layered pass 2: 0.86 m deep, was 0.95 — the game's seat click volume reaches 0.67 m behind the seat and 0.25 m round it, so a tap on
    a deeper sofa's backrest from behind fell outside every seat and went to the neighbouring seat: release 4, h7_1_1 -> h7_1_2)
    Low 3-seat fabric sofa (photo 02): slim wood legs, plinth frame, loose seat cushions with sag + welt seams, tilted back
    cushions, rounded arms, two scatter pillows."""
    tn = tn or PAL["sofa_grey"]
    wt = wood_tn or WOOD["walnut"]
    hw, hd = w / 2, d / 2
    for (sx, sz) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        sqleg(F, sx * (hw - 0.1), sz * (hd - 0.1), 0.0, leg_h, 0.05, 0.03, "H_wood_oak", wt, splay=(sx * 0.02, sz * 0.02))
    base_top = 0.30
    rbox(F, -hw, hw, -hd, hd, leg_h, base_top, m, r=0.04, seg=3, tile=0.5, tn=tn, smooth=False)
    # back frame (rear panel) and arms
    rbox(F, -hw, hw, -hd, -hd + 0.14, base_top, back_h - 0.18, m, r=0.05, seg=3, tile=0.5, tn=tn)
    for sgn in (-1, 1):
        x0, x1 = (hw - arm_w, hw) if sgn > 0 else (-hw, -hw + arm_w)
        # houses-real pass 2 (owner 2026-11-22, refs: roll-arm sofas): a padded side panel and a soft roll along its top that scrolls
        # out a little over the side and shows its round end at the front
        rbox(F, x0, x1, -hd, hd - 0.02, base_top, 0.53, m, r=0.035, seg=3, tile=0.5, tn=tn, smooth=True)
        rr = arm_w * 0.6
        cx = (x0 + x1) / 2 + sgn * 0.012
        tube(F, [(cx, -hd + 0.02, 0.53), (cx, hd - 0.005, 0.53)], rr, m, segs=16, tn=tn, caps=True, uv_per_m=2.0)
    inner0, inner1 = -hw + arm_w, hw - arm_w
    sw = (inner1 - inner0) / seats
    sz0 = -hd + 0.14
    ty = 0.46
    for i in range(seats):
        a, b = inner0 + i * sw + 0.004, inner0 + (i + 1) * sw - 0.004
        cushion_seat(F, a, b, sz0 + 0.07, hd - 0.01, base_top, ty, m, tn)
        back_cushion(F, a + 0.005, b - 0.005, sz0 + 0.075, ty - 0.02, back_h, 0.2, m, tn)
        if mark:
            seat(F, mark_id * 10 + i, SEAT_KIND_BACKED, (a + b) / 2, (sz0 + 0.07 + hd) / 2, ty, 0.0, edge=(hd - sz0 - 0.07) / 2,
                 back=(hd - sz0 - 0.07) / 2 - 0.0, width=sw - 0.1, approach=APPROACH_FRONT)
    pt = pillow_tn or PAL["sofa_sage"]
    # layered pass 2 (release 4 seat bug): the scatter cushions sit tucked into the arms, small and leaning back, so a tap on the seat
    # beside an end seat is not caught by a cushion standing over the end seat's cushion (h2_1_6 -> h2_1_5, h7_1_1 -> h7_1_2)
    pillow(F, inner0 + 0.16, sz0 + 0.2, ty, 0.3, 0.3, 0.11, m, pt, tilt=0.5, yaw=0.25)
    pillow(F, inner1 - 0.16, sz0 + 0.2, ty, 0.3, 0.3, 0.11, m, PAL["mustard"], tilt=0.5, yaw=-0.25)
    col(F, -hw, hw, -hd, hd, 0.9, name="sofa")


def sofa_2seat(F, **kw):
    kw.setdefault("w", 1.7)
    sofa_fabric(F, seats=2, **kw)


def sofa_L(F, w=2.6, d=0.95, chaise=1.6, tn=None, **kw):
    """L sofa: a 3-seat unit plus a chaise returning toward the front (4 seats, all backed: front approach)."""
    tn = tn or PAL["sofa_beige"]
    sofa_fabric(F, w=w, d=d, seats=3, tn=tn, mark=True, **kw)
    # chaise on the right end: extends forward (+z) by `chaise - d`
    ext = chaise - d
    hw = w / 2
    arm_w = 0.16
    x0, x1 = hw - 0.72 - arm_w, hw - arm_w
    z0, z1 = d / 2, d / 2 + ext
    m = "H_fabric"
    rbox(F, x0 + 0.0, hw, z0 - 0.02, z1, 0.13, 0.30, m, r=0.04, seg=3, tile=0.5, tn=tn)
    cushion_seat(F, x0 + 0.004, x1, z0, z1 - 0.01, 0.30, 0.46, m, tn)
    rbox(F, x1, hw, z0, z1, 0.30, 0.62, m, r=0.07, seg=4, tile=0.5, tn=tn, puff=0.01, cuts=3, smooth=True)
    for (sx, sz) in ((x0 + 0.1, z1 - 0.1), (hw - 0.1, z1 - 0.1)):
        sqleg(F, sx, sz, 0.0, 0.13, 0.05, 0.03, "H_wood_oak", WOOD["walnut"])
    seat(F, 9, SEAT_KIND_BACKED, (x0 + x1) / 2, (z0 + z1) / 2 - 0.1, 0.46, 0.0, edge=(z1 - z0) / 2 + 0.1, back=0.55, width=0.6)
    col(F, x0, hw, z0, z1, 0.62, name="sofa_chaise")


def sofa_leather(F, w=2.1, d=0.86, seats=3, tn=None):   # layered pass 2: 0.86 m deep (see sofa_fabric: the seat click volume)
    """leather sofa (10 번 집, 6번 집): rolled arms, tufting buttons on the back, brown/tan leather, dark wood feet."""
    tn = tn or PAL["leather_brown"]
    # polish3 (owner 2026-11-28, house 6: "가죽 소파가 밋밋"): a deeper hide than the fabric sofas' palette colour, and the grain at half the
    # scale (0.25 m a repeat: at 0.5 m the cells read as a suede mottle)
    tn = tuple(c * 0.78 for c in tn[:3]) + (1,)
    m = "H_leather"
    hw, hd = w / 2, d / 2
    for (sx, sz) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        leg(F, sx * (hw - 0.08), sz * (hd - 0.08), 0.0, 0.1, 0.035, 0.025, "H_wood_oak", WOOD["dark"])
    rbox(F, -hw, hw, -hd, hd, 0.1, 0.30, m, r=0.04, seg=3, tile=0.25, tn=tn)
    rbox(F, -hw, hw, -hd, -hd + 0.20, 0.30, 0.86, m, r=0.08, seg=4, tile=0.25, tn=tn, puff=0.02, cuts=4, smooth=True)
    # rolled arms: horizontal cylinder tops
    for sgn in (-1, 1):
        x = sgn * (hw - 0.1)
        rbox(F, x - 0.1, x + 0.1, -hd + 0.18, hd, 0.30, 0.54, m, r=0.04, seg=2, tile=0.25, tn=tn)
        tube(F, [(x, -hd + 0.18, 0.60), (x, hd - 0.02, 0.60)], 0.095, m, 14, tn=tn, uv_per_m=4.0)
        disc_cap = lathe(F, x, hd - 0.02, 0.0, [(0, 0.60 - 0.0)], m, 6) if False else None
        # arm front scroll
        lathe(F.sub(x, hd - 0.02, 0.60, 0), 0, 0, 0, [(0.0, 0.0), (0.0, 0.0)], m, 6) if False else None
    iw0, iw1 = -hw + 0.2, hw - 0.2
    sw = (iw1 - iw0) / seats
    for i in range(seats):
        a, b = iw0 + i * sw + 0.004, iw0 + (i + 1) * sw - 0.004
        cushion_seat(F, a, b, -hd + 0.24, hd - 0.0, 0.30, 0.46, m, tn, puff=0.016, sag=0.014, r=0.045)
        # tufting buttons on the back
        for bx in (a + sw * 0.25, a + sw * 0.75):
            for by in (0.58, 0.72):
                lathe(F, bx, -hd + 0.205, by - 0.0, [(0.0, 0.0), (0.012, 0.0), (0.012, -0.012), (0.0, -0.012)], m, 8,
                      tn=tuple(c * 0.6 for c in tn[:3]) + (1,)) if False else None
        seat(F, i, SEAT_KIND_BACKED, (a + b) / 2, (-hd + 0.24 + hd) / 2, 0.46, 0.0, edge=(hd + hd - 0.24) / 2, back=(2 * hd - 0.24) / 2,
             width=sw - 0.1)
    for bx in [iw0 + sw * (i + 0.5) for i in range(seats)]:
        for by in (0.60, 0.76):
            for dx in (-0.12, 0.12):
                lathe(F.sub(0, 0, 0, 0), bx + dx, -hd + 0.2, by, [(0, 0.0), (0.014, 0.004), (0.01, 0.014), (0, 0.016)], "H_leather", 8,
                      tn=tuple(c * 0.55 for c in tn[:3]) + (1,)) if False else None
    col(F, -hw, hw, -hd, hd, 0.9, name="sofa_leather")


def sofa_rattan(F, w=1.7, d=0.85, seats=2, tn=None):
    """rattan 2-seat sofa (5번 집 썬룸): round-tube frame, woven cane back/arms, loose cream cushions."""
    tn = tn or PAL["sofa_beige"]
    hw, hd = w / 2, d / 2
    wv = (1, 0.92, 0.8, 1)
    fr = (0.85, 0.7, 0.5, 1)
    for (sx, sz) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        tube(F, [(sx * (hw - 0.04), sz * (hd - 0.04), 0.0), (sx * (hw - 0.04), sz * (hd - 0.04), 0.32)], 0.022, "H_wood_oak", 10, tn=fr)
    # base rails and woven panels
    for z in (-hd + 0.04, hd - 0.04):
        tube(F, [(-hw + 0.04, z, 0.3), (hw - 0.04, z, 0.3)], 0.02, "H_wood_oak", 10, tn=fr)
        tube(F, [(-hw + 0.04, z, 0.15), (hw - 0.04, z, 0.15)], 0.015, "H_wood_oak", 8, tn=fr)
    for x in (-hw + 0.04, hw - 0.04):
        tube(F, [(x, -hd + 0.04, 0.3), (x, hd - 0.04, 0.3)], 0.02, "H_wood_oak", 10, tn=fr)
    rbox(F, -hw + 0.03, hw - 0.03, -hd + 0.03, hd - 0.03, 0.25, 0.30, "H_rattan", r=0.004, seg=1, tile=0.3, tn=wv)
    # back (curved top tube + woven)
    rbox(F, -hw + 0.03, hw - 0.03, -hd, -hd + 0.035, 0.30, 0.82, "H_rattan", r=0.004, seg=1, tile=0.3, tn=wv)
    tube(F, [(-hw + 0.03, -hd + 0.02, 0.84), (hw - 0.03, -hd + 0.02, 0.84)], 0.022, "H_wood_oak", 10, tn=fr)
    for x in (-hw + 0.03, hw - 0.03):
        tube(F, [(x, -hd + 0.02, 0.30), (x, -hd + 0.02, 0.84)], 0.022, "H_wood_oak", 10, tn=fr)
        rbox(F, x - 0.015, x + 0.015, -hd + 0.03, hd - 0.02, 0.30, 0.58, "H_rattan", r=0.004, seg=1, tile=0.3, tn=wv)
        tube(F, [(x, -hd + 0.03, 0.60), (x, hd - 0.03, 0.60)], 0.022, "H_wood_oak", 10, tn=fr)
        tube(F, [(x, hd - 0.03, 0.30), (x, hd - 0.03, 0.6)], 0.022, "H_wood_oak", 10, tn=fr)
    sw = (w - 0.2) / seats
    for i in range(seats):
        a = -hw + 0.07 + i * sw + 0.004
        b = a + sw - 0.008
        cushion_seat(F, a, b, -hd + 0.2, hd - 0.04, 0.30, 0.45, "H_fabric", tn, puff=0.012, sag=0.012)
        back_cushion(F, a, b, -hd + 0.22, 0.43, 0.78, 0.15, "H_fabric", tn, tilt=0.16)
        seat(F, i, SEAT_KIND_BACKED, (a + b) / 2, (-hd + 0.2 + hd - 0.04) / 2, 0.45, 0.0, edge=(hd - 0.04 + hd - 0.2) / 2,
             back=(2 * hd - 0.24) / 2, width=sw - 0.1)
    col(F, -hw, hw, -hd, hd, 0.9, name="sofa_rattan")


def sofa_floor(F, w=1.9, d=0.85, seats=2, tn=None):
    """좌식 소파 (9번 집 2층): sits on the floor, seat 0.18 m, low back; floor posture, approached from the front."""
    tn = tn or PAL["sofa_sage"]
    hw, hd = w / 2, d / 2
    m = "H_fabric"
    rbox(F, -hw, hw, -hd, hd, 0.0, 0.14, m, r=0.04, seg=3, tile=0.5, tn=tn)
    sw = (w - 0.2) / seats
    for i in range(seats):
        a = -hw + 0.1 + i * sw
        b = a + sw
        cushion_seat(F, a + 0.004, b - 0.004, -hd + 0.28, hd - 0.02, 0.14, 0.28, m, tn, puff=0.015, sag=0.015, r=0.05)
        back_cushion(F, a + 0.004, b - 0.004, -hd + 0.30, 0.25, 0.60, 0.26, m, tn, tilt=0.2, puff=0.03)
        seat(F, i, SEAT_KIND_FLOOR, (a + b) / 2, (-hd + 0.28 + hd - 0.02) / 2, 0.28, 0.0, edge=(2 * hd - 0.3) / 2, back=0.3, width=sw - 0.1,
             approach=APPROACH_FRONT, pose=POSE_FLOOR)
    rbox(F, -hw, hw, -hd, -hd + 0.26, 0.14, 0.52, m, r=0.08, seg=3, tile=0.5, tn=tn, puff=0.02, cuts=3, smooth=True)
    for sgn in (-1, 1):
        x0, x1 = (hw - 0.1, hw) if sgn > 0 else (-hw, -hw + 0.1)
        rbox(F, x0, x1, -hd, hd, 0.14, 0.42, m, r=0.045, seg=3, tile=0.5, tn=tn)
    pillow(F, -0.4, -0.1, 0.28, 0.4, 0.4, 0.13, m, PAL["mustard"], tilt=0.3)
    col(F, -hw, hw, -hd, hd, 0.7, name="sofa_floor")


# ================================================================================================= armchairs ====
def armchair_lounge(F, tn=None, wood="walnut", w=0.8, d=0.82):
    """mid-century lounge chair: open wood frame with angled legs, deep seat cushion, tilted back cushion, flat wooden arms."""
    tn = tn or PAL["sofa_sage"]
    wt = WOOD[wood]
    hw, hd = w / 2, d / 2
    for (sx, sz) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        sqleg(F, sx * (hw - 0.05), sz * (hd - 0.06), 0.0, 0.30, 0.045, 0.03, "H_wood_oak", wt, splay=(sx * 0.03, sz * 0.03))
    for sgn in (-1, 1):
        x = sgn * (hw - 0.03)
        rbox(F, x - 0.03, x + 0.03, -hd, hd, 0.28, 0.34, "H_wood_oak", r=0.012, seg=2, grain=(0, 1, 0), tn=wt)
        sqleg(F, x, -hd + 0.06, 0.34, 0.62, 0.04, 0.04, "H_wood_oak", wt)
        sqleg(F, x, hd - 0.14, 0.34, 0.62, 0.04, 0.04, "H_wood_oak", wt)
        rbox(F, x - 0.045, x + 0.045, -hd + 0.0, hd - 0.05, 0.62, 0.67, "H_wood_oak", r=0.02, seg=2, grain=(0, 1, 0), tn=wt)
    rbox(F, -hw + 0.04, hw - 0.04, -hd + 0.04, hd - 0.04, 0.30, 0.34, "H_wood_oak", r=0.008, seg=1, tn=wt)
    cushion_seat(F, -hw + 0.08, hw - 0.08, -hd + 0.2, hd - 0.04, 0.34, 0.46, "H_fabric", tn, puff=0.02, sag=0.014, r=0.05)
    back_cushion(F, -hw + 0.08, hw - 0.08, -hd + 0.24, 0.42, 0.88, 0.16, "H_fabric", tn, tilt=0.28, puff=0.025)
    rbox(F, -hw + 0.04, hw - 0.04, -hd, -hd + 0.03, 0.40, 0.85, "H_wood_oak", r=0.01, seg=1, tn=wt, tilt=0.28)
    seat(F, 0, SEAT_KIND_BACKED, 0, (-hd + 0.2 + hd - 0.04) / 2, 0.46, 0.0, edge=(2 * hd - 0.24) / 2, back=(2 * hd - 0.24) / 2 - 0.02,
         width=w - 0.3)
    col(F, -hw, hw, -hd, hd, 0.9, name="armchair")


def armchair_reading(F, tn=None):
    """독서 안락의자 (6번 집): deep upholstered armchair with rolled arms, wooden bun feet, leather."""
    tn = tn or PAL["leather_tan"]
    m = "H_leather"
    hw, hd = 0.45, 0.46
    for (sx, sz) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        lathe(F, sx * (hw - 0.07), sz * (hd - 0.07), 0.0, [(0, 0), (0.03, 0.0), (0.04, 0.02), (0.03, 0.07), (0.0, 0.08)], "H_wood_oak", 10,
              tn=WOOD["dark"])
    rbox(F, -hw, hw, -hd, hd, 0.07, 0.30, m, r=0.04, seg=3, tile=0.5, tn=tn)
    rbox(F, -hw, hw, -hd, -hd + 0.16, 0.30, 0.9, m, r=0.08, seg=4, tile=0.5, tn=tn, puff=0.02, cuts=4, smooth=True, tilt=0.12)
    for sgn in (-1, 1):
        x = sgn * (hw - 0.08)
        rbox(F, x - 0.08, x + 0.08, -hd + 0.1, hd, 0.30, 0.5, m, r=0.04, seg=2, tile=0.5, tn=tn)
        tube(F, [(x, -hd + 0.12, 0.57), (x, hd - 0.02, 0.57)], 0.085, m, 12, tn=tn, uv_per_m=2.0)
    cushion_seat(F, -hw + 0.16, hw - 0.16, -hd + 0.2, hd - 0.02, 0.30, 0.46, m, tn, puff=0.016, sag=0.012, r=0.05)
    seat(F, 0, SEAT_KIND_BACKED, 0, (-hd + 0.2 + hd) / 2, 0.46, 0.0, edge=(2 * hd - 0.2) / 2, back=(2 * hd - 0.2) / 2, width=0.5)
    col(F, -hw, hw, -hd, hd, 0.95, name="armchair")


def armchair_rattan(F, tn=None):
    """rattan 1-seat chair with a rounded back and a cushion (5번 집)."""
    tn = tn or PAL["sofa_beige"]
    fr = (0.85, 0.7, 0.5, 1)
    wv = (1, 0.92, 0.8, 1)
    hw, hd = 0.36, 0.38
    for (sx, sz) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        tube(F, [(sx * (hw - 0.03), sz * (hd - 0.03), 0.0), (sx * (hw - 0.05), sz * (hd - 0.03), 0.4)], 0.02, "H_wood_oak", 10, tn=fr)
    rbox(F, -hw + 0.02, hw - 0.02, -hd + 0.02, hd - 0.02, 0.34, 0.39, "H_rattan", r=0.004, seg=1, tile=0.3, tn=wv)
    # round back: arc of woven panel
    n = 12
    for i in range(n):
        a0 = math.pi * 0.15 + (math.pi * 0.7) * i / n
        a1 = math.pi * 0.15 + (math.pi * 0.7) * (i + 1) / n
        r = 0.34
        P = lambda a, y: (math.cos(a) * r * 1.05, -hd + 0.04 - math.sin(a) * r * 0.0 + (-math.sin(a) * 0.04), y)
        x0, x1 = math.cos(a0) * r * 1.0, math.cos(a1) * r * 1.0
        zz0, zz1 = -hd + 0.03 - 0.10 * math.sin(a0), -hd + 0.03 - 0.10 * math.sin(a1)
        gface(F, [(x0, zz0, 0.39), (x1, zz1, 0.39), (x1, zz1, 0.86), (x0, zz0, 0.86)], "H_rattan", (1, 0, 0), 0.3, (0, 1, 0), tn=wv)
        gface(F, [(x0, zz0, 0.39), (x1, zz1, 0.39), (x1, zz1, 0.86), (x0, zz0, 0.86)], "H_rattan", (1, 0, 0), 0.3, (0, -1, 0), tn=wv)
    tube(F, [(math.cos(math.pi * (0.15 + 0.7 * i / n)) * 0.34, -hd + 0.03 - 0.10 * math.sin(math.pi * (0.15 + 0.7 * i / n)), 0.86)
             for i in range(n + 1)], 0.02, "H_wood_oak", 8, tn=fr)
    cushion_seat(F, -hw + 0.04, hw - 0.04, -hd + 0.12, hd - 0.03, 0.39, 0.47, "H_fabric", tn, puff=0.012, sag=0.01, r=0.035)
    back_cushion(F, -hw + 0.1, hw - 0.1, -hd + 0.15, 0.44, 0.78, 0.12, "H_fabric", tn, tilt=0.2)
    seat(F, 0, SEAT_KIND_BACKED, 0, 0.0, 0.47, 0.0, edge=0.35, back=0.3, width=0.5)
    col(F, -hw, hw, -hd - 0.08, hd, 0.9, name="armchair")


def rocking_chair(F, tn=None):
    """흔들의자 (10번 집, doesn't move): curved runners, slatted back, wooden seat with a cushion."""
    tn = tn or (0.8, 0.55, 0.4, 1)
    hw, hd = 0.30, 0.34
    for sgn in (-1, 1):
        x = sgn * hw
        pts = [(x, -0.48 + 0.96 * t, 0.025 + 0.06 * (2 * t - 1) ** 2 * 1.0) for t in [i / 14 for i in range(15)]]
        tube(F, pts, 0.018, "H_wood_oak", 8, tn=tn)
        tube(F, [(x, -0.28, 0.07), (x, -0.28, 0.40)], 0.02, "H_wood_oak", 8, tn=tn)
        tube(F, [(x, 0.30, 0.07), (x, 0.30, 0.64)], 0.02, "H_wood_oak", 8, tn=tn)
        tube(F, [(x, -0.28, 0.40), (x, -0.36, 1.02)], 0.02, "H_wood_oak", 8, tn=tn)
        tube(F, [(x, 0.0, 0.62), (x, 0.30, 0.64)], 0.018, "H_wood_oak", 8, tn=tn)
        tube(F, [(x, -0.25, 0.60), (x, 0.02, 0.62)], 0.018, "H_wood_oak", 8, tn=tn)
    rbox(F, -hw - 0.02, hw + 0.02, -0.3, 0.34, 0.40, 0.44, "H_wood_oak", r=0.012, seg=2, tn=tn)
    for z0 in (-0.0,):
        pass
    for k in range(5):
        y = 0.55 + 0.1 * k
        rbox(F, -hw, hw, -0.30 - 0.06 * (y - 0.44) / 0.5 - 0.01, -0.30 - 0.06 * (y - 0.44) / 0.5 + 0.012, y, y + 0.07, "H_wood_oak", r=0.006,
             seg=1, tn=tn)
    rbox(F, -hw + 0.03, hw - 0.03, -0.28, 0.30, 0.44, 0.49, "H_fabric", r=0.02, seg=2, tile=0.5, tn=PAL["rug_red"], puff=0.01, cuts=3, smooth=True)
    seat(F, 0, SEAT_KIND_BACKED, 0, 0.02, 0.49, 0.0, edge=0.3, back=0.3, width=0.5)
    col(F, -0.34, 0.34, -0.5, 0.5, 1.0, name="rocker")


def _smooth_prof(pts, steps=2):
    """Catmull-Rom through a lathe profile (r, y): the end points stay (the axis points), each span gets `steps` points"""
    out = []
    n = len(pts)
    for i in range(n - 1):
        p0, p1, p2, p3 = pts[max(i - 1, 0)], pts[i], pts[i + 1], pts[min(i + 2, n - 1)]
        for k in range(steps):
            t = k / steps
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2
                                    + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3) for j in (0, 1)))
    out.append(pts[-1])
    return [(max(0.0, a), b) for a, b in out]


def bean_bag(F, tn=None, d=0.9):
    """빈백: puffy lathe with a sag on top and a pinched seam, back leaning against the wall side (-z)."""
    tn = tn or PAL["sofa_rust"]
    r = d / 2
    # houses-real pass 2 (owner 2026-11-22, the bean bag read as a faceted rock): round silhouettes - the profiles are smoothed
    # (Catmull-Rom, 2 steps a span) and turned in 40 / 36 segments; the seam piping follows the same 40 steps
    prof = _smooth_prof([(0.0, 0.0), (r * 0.7, 0.01), (r * 0.95, 0.07), (r, 0.18), (r * 0.9, 0.32), (r * 0.62, 0.40), (r * 0.3, 0.38), (0.0, 0.34)])
    lathe(F, 0, 0, 0.0, prof, "H_fabric", 40, tn=tn, tile=0.5)
    # back bulge
    prof2 = _smooth_prof([(0.0, 0.1), (r * 0.5, 0.1), (r * 0.62, 0.35), (r * 0.5, 0.62), (r * 0.25, 0.72), (0.0, 0.7)])
    lathe(F.sub(0, -0.25, 0, 0), 0, 0, 0.0, prof2, "H_fabric", 36, tn=tn, tile=0.5)
    welt(F, [(r * 0.995 * math.cos(a), r * 0.995 * math.sin(a), 0.18) for a in [i * 2 * math.pi / 40 for i in range(41)]], tn, 0.007)
    seat(F, 0, SEAT_KIND_BACKED, 0, 0.05, 0.36, 0.0, edge=0.35, back=0.3, width=0.6)
    col(F, -r, r, -r - 0.2, r, 0.7, name="beanbag")


# ===================================================================================================== chairs ====
def _seat_marker_chair(F, k=0, y=0.45, edge=0.21, back=0.2, backed=True, w=0.4):
    seat(F, k, SEAT_KIND_BACKED if backed else SEAT_KIND_BACKLESS, 0.0, 0.0, y, 0.0, edge=edge, back=back if backed else 0.0, width=w,
         approach=APPROACH_FRONT if backed else APPROACH_ANY)


def chair_dining_wood(F, tn=None, slats=3, seat_tn=None, **kw):
    """wooden dining chair: square tapered legs, rounded seat board, back posts + curved top rail + slats, stretchers."""
    tn = tn or WOOD["natural"]
    s = 0.21
    for (sx, sz) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        sqleg(F, sx * (s - 0.02), sz * (s - 0.02), 0.0, 0.44, 0.04, 0.028, "H_wood_oak", tn)
    rbox(F, -s - 0.01, s + 0.01, -s - 0.01, s + 0.01, 0.41, 0.46, "H_wood_oak", r=0.014, seg=2, tn=tn, grain=(1, 0, 0))
    for z in (-s + 0.02, s - 0.02):
        rbox(F, -s + 0.04, s - 0.04, z - 0.012, z + 0.012, 0.15, 0.2, "H_wood_oak", r=0.004, seg=1, tn=tn)
    for x in (-s + 0.02, s - 0.02):
        rbox(F, x - 0.012, x + 0.012, -s + 0.04, s - 0.04, 0.12, 0.17, "H_wood_oak", r=0.004, seg=1, tn=tn)
    for sx in (-1, 1):
        tube(F, [(sx * (s - 0.03), -s + 0.02, 0.44), (sx * (s - 0.03), -s - 0.02, 0.92)], 0.016, "H_wood_oak", 8, tn=tn)
    rbox(F, -s + 0.0, s - 0.0, -s - 0.03, -s + 0.01, 0.84, 0.93, "H_wood_oak", r=0.012, seg=2, tn=tn)
    for k in range(slats):
        x = -s + 0.07 + k * (2 * s - 0.14) / max(slats - 1, 1)
        rbox(F, x - 0.014, x + 0.014, -s - 0.016, -s + 0.004, 0.50, 0.84, "H_wood_oak", r=0.005, seg=1, tn=tn)
    if seat_tn:
        cushion_seat(F, -s, s, -s + 0.0, s, 0.46, 0.49, "H_fabric", seat_tn, puff=0.006, sag=0.004, r=0.012)
    _seat_marker_chair(F, 0, 0.46 + (0.03 if seat_tn else 0), 0.21, 0.19)
    col(F, -0.25, 0.25, -0.27, 0.25, 0.95, name="chair")


def chair_dining_upholstered(F, tn=None, wood="walnut"):
    """dining chair with an upholstered seat and a curved upholstered back panel, black-ish legs."""
    tn = tn or PAL["sofa_beige"]
    wt = WOOD[wood]
    s = 0.22
    for (sx, sz) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        sqleg(F, sx * (s - 0.025), sz * (s - 0.025), 0.0, 0.42, 0.04, 0.025, "H_wood_oak", wt, splay=(sx * 0.02, sz * 0.02 if sz > 0 else sz * 0.0))
    rbox(F, -s, s, -s, s, 0.38, 0.43, "H_wood_oak", r=0.01, seg=1, tn=wt)
    cushion_seat(F, -s + 0.005, s - 0.005, -s + 0.005, s - 0.005, 0.43, 0.49, "H_fabric", tn, puff=0.012, sag=0.008, r=0.02)
    rbox(F, -s + 0.02, s - 0.02, -s - 0.02, -s + 0.04, 0.52, 0.92, "H_fabric", r=0.03, seg=3, tile=0.5, tn=tn, puff=0.015, cuts=4, smooth=True, tilt=0.08)
    for sx in (-1, 1):
        sqleg(F, sx * (s - 0.03), -s + 0.0, 0.43, 0.56, 0.035, 0.035, "H_wood_oak", wt, splay=(0, -0.02))
    _seat_marker_chair(F, 0, 0.49, 0.22, 0.21, w=0.42)
    col(F, -0.25, 0.25, -0.27, 0.25, 0.95, name="chair")


def chair_farm(F, tn=None, variant=0):
    """농가 나무 의자: ladder-back / spindle variants in different stains (3번 집: each chair different)."""
    tones = [(0.95, 0.7, 0.45, 1), (0.8, 0.55, 0.4, 1), (0.55, 0.45, 0.35, 1), (1.0, 0.9, 0.75, 1), (0.7, 0.5, 0.4, 1), (0.9, 0.62, 0.4, 1)]
    tn = tn or tones[variant % 6]
    s = 0.2
    for (sx, sz) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        leg(F, sx * (s - 0.01), sz * (s - 0.01), 0.0, 0.43, 0.02, 0.016, "H_wood_oak", tn, segs=8)
    seat_r = 0.014
    rbox(F, -s - 0.02, s + 0.02, -s - 0.02, s + 0.02, 0.41, 0.455, "H_wood_oak", r=0.02, seg=3, tn=tn, grain=(1, 0, 0))
    for x in (-s + 0.01, s - 0.01):
        tube(F, [(x, s - 0.02, 0.18), (x, -s + 0.02, 0.18)], 0.011, "H_wood_oak", 6, tn=tn)
    tube(F, [(-s + 0.01, s - 0.02, 0.18), (s - 0.01, s - 0.02, 0.18)], 0.011, "H_wood_oak", 6, tn=tn)
    for sx in (-1, 1):
        tube(F, [(sx * (s - 0.02), -s + 0.01, 0.455), (sx * (s - 0.02), -s - 0.03, 0.93)], 0.016, "H_wood_oak", 8, tn=tn)
    if variant % 2 == 0:
        for y in (0.58, 0.72, 0.86):
            rbox(F, -s + 0.02, s - 0.02, -s - 0.03 - 0.0, -s + 0.0, y, y + 0.06, "H_wood_oak", r=0.006, seg=1, tn=tn)
    else:
        for k in range(5):
            x = -s + 0.06 + k * (2 * s - 0.12) / 4
            tube(F, [(x, -s + 0.0, 0.455), (x, -s - 0.025, 0.86)], 0.007, "H_wood_oak", 6, tn=tn)
        rbox(F, -s, s, -s - 0.045, -s + 0.005, 0.85, 0.93, "H_wood_oak", r=0.012, seg=2, tn=tn)
    _seat_marker_chair(F, 0, 0.455, 0.22, 0.2)
    col(F, -0.25, 0.25, -0.28, 0.25, 0.95, name="chair")


def chair_rattan_dining(F, tn=None):
    """cane-back dining chair in a round-tube frame (round table 5번 집)."""
    fr = (0.85, 0.7, 0.5, 1)
    s = 0.21
    for (sx, sz) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        tube(F, [(sx * (s - 0.02), sz * (s - 0.02), 0.0), (sx * (s - 0.02), sz * (s - 0.02), 0.44)], 0.014, "H_wood_oak", 8, tn=fr)
    rbox(F, -s, s, -s, s, 0.41, 0.45, "H_wood_oak", r=0.012, seg=2, tn=fr)
    rbox(F, -s + 0.01, s - 0.01, -s + 0.01, s - 0.01, 0.45, 0.47, "H_rattan", r=0.003, seg=1, tile=0.3, tn=(1, 0.92, 0.8, 1))
    for sx in (-1, 1):
        tube(F, [(sx * (s - 0.02), -s + 0.02, 0.45), (sx * (s - 0.02), -s - 0.02, 0.9)], 0.014, "H_wood_oak", 8, tn=fr)
    tube(F, [(-s + 0.02, -s - 0.02, 0.9), (s - 0.02, -s - 0.02, 0.9)], 0.014, "H_wood_oak", 8, tn=fr)
    tube(F, [(-s + 0.02, -s - 0.015, 0.55), (s - 0.02, -s - 0.015, 0.55)], 0.012, "H_wood_oak", 8, tn=fr)
    rbox(F, -s + 0.02, s - 0.02, -s - 0.025, -s - 0.005, 0.55, 0.9, "H_rattan", r=0.003, seg=1, tile=0.3, tn=(1, 0.92, 0.8, 1))
    _seat_marker_chair(F, 0, 0.47, 0.21, 0.2)
    col(F, -0.25, 0.25, -0.27, 0.25, 0.95, name="chair")


def chair_desk(F, tn=None):
    """desk chair (fixed pose, no swivel needed): 5-star base, post, padded seat + back, small arms."""
    tn = tn or PAL["sofa_grey"]
    for k in range(5):
        a = k * 2 * math.pi / 5 + 0.3
        tube(F, [(0, 0, 0.07), (0.28 * math.cos(a), 0.28 * math.sin(a), 0.05)], 0.018, "H_metal", 8, tn=BLK)
        lathe(F, 0.28 * math.cos(a), 0.28 * math.sin(a), 0.0, [(0, 0), (0.028, 0.0), (0.028, 0.05), (0, 0.05)], "H_rubber", 10)
    tube(F, [(0, 0, 0.07), (0, 0, 0.42)], 0.025, "H_metal", 10, tn=BLK)
    cushion_seat(F, -0.24, 0.24, -0.22, 0.24, 0.42, 0.50, "H_fabric", tn, puff=0.015, sag=0.01, r=0.03)
    rbox(F, -0.22, 0.22, -0.27, -0.2, 0.5, 0.92, "H_fabric", r=0.03, seg=3, tile=0.5, tn=tn, puff=0.015, cuts=4, smooth=True, tilt=0.08)
    tube(F, [(0, -0.2, 0.46), (0, -0.25, 0.62)], 0.015, "H_metal", 8, tn=BLK)
    for sx in (-1, 1):
        tube(F, [(sx * 0.24, -0.1, 0.5), (sx * 0.26, -0.05, 0.68), (sx * 0.26, 0.15, 0.68)], 0.012, "H_metal", 8, tn=BLK)
        rbox(F, sx * 0.26 - 0.03, sx * 0.26 + 0.03, 0.02, 0.22, 0.68, 0.71, "H_rubber", r=0.01, seg=2)
    _seat_marker_chair(F, 0, 0.5, 0.24, 0.22, w=0.46)
    col(F, -0.3, 0.3, -0.32, 0.3, 0.95, name="chair")


# ===================================================================================================== stools =====
def stool_bar(F, h=0.65, tn=None, seat_tn=None):
    """바 스툴 (좌면 0.65 m): round padded seat, black metal legs + foot ring at 0.28 m."""
    tn = tn or BLK
    seat_tn = seat_tn or PAL["leather_tan"]
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        tube(F, [(0.14 * math.cos(a), 0.14 * math.sin(a), h - 0.05), (0.2 * math.cos(a), 0.2 * math.sin(a), 0.0)], 0.014, "H_metal", 8, tn=tn)
    ring = [(0.17 * math.cos(a), 0.17 * math.sin(a), 0.27) for a in [i * 2 * math.pi / 24 for i in range(25)]]
    tube(F, ring, 0.011, "H_metal", 6, tn=tn, caps=False)
    lathe(F, 0, 0, h - 0.06, [(0, 0), (0.17, 0.0), (0.18, 0.02), (0.18, 0.045), (0.15, 0.06), (0, 0.06)], "H_leather", 24, tn=seat_tn)
    seat(F, 0, SEAT_KIND_BACKLESS, 0, 0, h, 0.0, edge=0.18, back=0.0, width=0.4, approach=APPROACH_ANY, pose=POSE_PERCH)
    col(F, -0.22, 0.22, -0.22, 0.22, h, name="stool")


def stool_wood(F, h=0.65, tn=None):
    """작업 스툴: round wooden top, 3 splayed legs, ring stretcher."""
    tn = tn or WOOD["pine"]
    for k in range(3):
        a = k * 2 * math.pi / 3 + 0.5
        tube(F, [(0.1 * math.cos(a), 0.1 * math.sin(a), h - 0.03), (0.2 * math.cos(a), 0.2 * math.sin(a), 0.0)], 0.022, "H_wood_oak", 8, tn=tn)
    ring = [(0.16 * math.cos(a), 0.16 * math.sin(a), h * 0.4) for a in [i * 2 * math.pi / 24 for i in range(25)]]
    tube(F, ring, 0.011, "H_wood_oak", 6, tn=tn, caps=False)
    lathe(F, 0, 0, h - 0.045, [(0, 0), (0.16, 0.0), (0.175, 0.012), (0.175, 0.035), (0.16, 0.045), (0, 0.045)], "H_wood_oak", 24, tn=tn)
    seat(F, 0, SEAT_KIND_BACKLESS, 0, 0, h, 0.0, edge=0.17, back=0.0, width=0.4, approach=APPROACH_ANY, pose=POSE_PERCH if h > 0.55 else POSE_CHAIR)
    col(F, -0.22, 0.22, -0.22, 0.22, h, name="stool")


def ottoman(F, w=0.62, d=0.5, tn=None, h=0.42):
    """오토만: padded box with a tray-less top, tapered feet; seat from either side."""
    tn = tn or PAL["leather_tan"]
    m = "H_leather"
    for (sx, sz) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        sqleg(F, sx * (w / 2 - 0.06), sz * (d / 2 - 0.06), 0.0, 0.07, 0.04, 0.025, "H_wood_oak", WOOD["dark"])
    rbox(F, -w / 2, w / 2, -d / 2, d / 2, 0.07, h, m, r=0.05, seg=3, tile=0.5, tn=tn, puff=0.02, cuts=4, smooth=True)
    welt(F, [(-w / 2 + 0.05, d / 2 - 0.0, h - 0.05), (w / 2 - 0.05, d / 2 - 0.0, h - 0.05)], tn)
    seat(F, 0, SEAT_KIND_BACKLESS, 0, 0, h + 0.015, 0.0, edge=d / 2, back=0.0, width=w - 0.1, approach=APPROACH_ANY)
    col(F, -w / 2, w / 2, -d / 2, d / 2, h, name="ottoman")


def piano_bench(F, w=1.0, d=0.36, tn=None):
    """피아노 벤치: padded lid, 4 turned legs, apron; either side."""
    tn = tn or WOOD["dark"]
    for (sx, sz) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        lathe(F, sx * (w / 2 - 0.04), sz * (d / 2 - 0.04), 0.0, [(0.018, 0.0), (0.02, 0.05), (0.014, 0.12), (0.024, 0.2), (0.018, 0.3), (0.03, 0.42)],
              "H_wood_oak", 10, tn=tn)
    rbox(F, -w / 2, w / 2, -d / 2, d / 2, 0.36, 0.42, "H_wood_oak", r=0.01, seg=2, tn=tn)
    rbox(F, -w / 2 + 0.01, w / 2 - 0.01, -d / 2 + 0.01, d / 2 - 0.01, 0.42, 0.48, "H_leather", r=0.02, seg=3, tile=0.5, tn=(0.2, 0.17, 0.16, 1), puff=0.01, cuts=3,
         smooth=True)
    seat(F, 0, SEAT_KIND_BACKLESS, 0, 0, 0.485, 0.0, edge=d / 2, back=0.0, width=w - 0.1, approach=APPROACH_ANY, count=1)
    col(F, -w / 2, w / 2, -d / 2, d / 2, 0.5, name="bench")


def bench_log(F, l=1.4, tn=None):
    """통나무 벤치 (10번 집): half-log seat on two chunky log legs, bark underside."""
    tn = tn or (0.75, 0.55, 0.38, 1)
    tube(F, [(-l / 2, 0, 0.36), (l / 2, 0, 0.36)], 0.12, "H_wood_oak", 16, tn=tn, uv_per_m=1.5)
    rbox(F, -l / 2, l / 2, -0.17, 0.17, 0.4, 0.46, "H_wood_oak", r=0.02, seg=2, tn=tn)
    for sx in (-1, 1):
        cyl(F, sx * (l / 2 - 0.2), 0.0, 0.0, 0.40, 0.1, "H_wood_oak", 14, tn=(0.6, 0.45, 0.32, 1), uvscale=(1.0, 1.0))
    seat(F, 0, SEAT_KIND_BACKLESS, -l / 4, 0, 0.46, 0.0, edge=0.17, back=0.0, width=0.5, approach=APPROACH_ANY)
    seat(F, 1, SEAT_KIND_BACKLESS, l / 4, 0, 0.46, 0.0, edge=0.17, back=0.0, width=0.5, approach=APPROACH_ANY)
    col(F, -l / 2, l / 2, -0.18, 0.18, 0.46, name="bench")


def bench_dining(F, l=1.5, tn=None):
    """식탁 벤치 (2번 집): long plank seat on slab legs with a stretcher, 2 seats, either side."""
    tn = tn or WOOD["natural"]
    rbox(F, -l / 2, l / 2, -0.17, 0.17, 0.42, 0.46, "H_wood_oak", r=0.012, seg=2, tn=tn)
    for sx in (-1, 1):
        rbox(F, sx * (l / 2 - 0.12) - 0.02, sx * (l / 2 - 0.12) + 0.02, -0.15, 0.15, 0.0, 0.42, "H_wood_oak", r=0.008, seg=1, tn=tn, grain=(0, 0, 1))
    rbox(F, -l / 2 + 0.14, l / 2 - 0.14, -0.015, 0.015, 0.18, 0.26, "H_wood_oak", r=0.004, seg=1, tn=tn)
    seat(F, 0, SEAT_KIND_BACKLESS, -l / 4, 0, 0.46, 0.0, edge=0.17, back=0.0, width=0.5, approach=APPROACH_ANY)
    seat(F, 1, SEAT_KIND_BACKLESS, l / 4, 0, 0.46, 0.0, edge=0.17, back=0.0, width=0.5, approach=APPROACH_ANY)
    col(F, -l / 2, l / 2, -0.18, 0.18, 0.46, name="bench")


def pyeongsang(F, w=1.8, d=1.0, h=0.36, tn=None):
    """평상: open slatted wooden platform, 6 legs with side rails; 2 backless seats, either side."""
    tn = tn or WOOD["pine"]
    for sx in (-1, 1):
        for sz in (-1, 0, 1):
            leg(F, sx * (w / 2 - 0.06), sz * (d / 2 - 0.06), 0.0, h - 0.04, 0.035, 0.03, "H_wood_oak", tn, segs=8) if False else \
                rbox(F, sx * (w / 2 - 0.06) - 0.035, sx * (w / 2 - 0.06) + 0.035, sz * (d / 2 - 0.06) - 0.035, sz * (d / 2 - 0.06) + 0.035, 0.0, h - 0.04,
                     "H_wood_oak", r=0.006, seg=1, tn=tn, grain=(0, 0, 1))
    for sz in (-1, 1):
        rbox(F, -w / 2, w / 2, sz * (d / 2 - 0.045) - 0.04, sz * (d / 2 - 0.045) + 0.04, h - 0.1, h - 0.03, "H_wood_oak", r=0.006, seg=1, tn=tn)
    n = int(d / 0.1)
    for i in range(n):
        z = -d / 2 + (i + 0.5) * d / n
        rbox(F, -w / 2, w / 2, z - 0.045, z + 0.045, h - 0.03, h, "H_wood_oak", r=0.006, seg=1, tn=tn, grain=(1, 0, 0))
    seat(F, 0, SEAT_KIND_BACKLESS, -w / 4, 0, h, 0.0, edge=d / 2, back=0.0, width=0.9, approach=APPROACH_ANY, pose=POSE_CHAIR)
    seat(F, 1, SEAT_KIND_BACKLESS, w / 4, 0, h, 0.0, edge=d / 2, back=0.0, width=0.9, approach=APPROACH_ANY, pose=POSE_CHAIR)
    col(F, -w / 2, w / 2, -d / 2, d / 2, h, name="pyeongsang")


# =============================================================================================== floor seating ====
def bangseok(F, tn=None, d=0.5, th=0.05):
    """방석: square cushion with a stitched border and a tufted centre button, sits on the floor (floor posture)."""
    tn = tn or PAL["rug_red"]
    rbox(F, -d / 2, d / 2, -d / 2, d / 2, 0.0, th, "H_fabric", r=0.02, seg=3, tile=0.4, tn=tn, puff=0.012, cuts=6, smooth=True)
    welt(F, [(-d / 2 + 0.03, d / 2 - 0.03, th - 0.004), (d / 2 - 0.03, d / 2 - 0.03, th - 0.004), (d / 2 - 0.03, -d / 2 + 0.03, th - 0.004),
             (-d / 2 + 0.03, -d / 2 + 0.03, th - 0.004), (-d / 2 + 0.03, d / 2 - 0.03, th - 0.004)], tuple(c * 0.8 for c in tn[:3]) + (1,), 0.004)
    lathe(F, 0, 0, th + 0.004, [(0.0, 0.0), (0.014, 0.0), (0.012, 0.01), (0.0, 0.012)], "H_fabric", 8, tn=tuple(c * 0.7 for c in tn[:3]) + (1,))
    seat(F, 0, SEAT_KIND_FLOOR, 0, 0, th, 0.0, edge=d / 2, back=0.0, width=d, approach=APPROACH_ANY, pose=POSE_FLOOR)


def boryo(F, w=0.9, l=1.8, tn=None):
    """보료 + 안석: a thick folded 보료 mattress with a darker border, a 안석 (low back cushion) at the wall side and a 사방침 (side bolster); floor posture, front only."""
    tn = tn or PAL["rug_red"]
    rbox(F, -w / 2, w / 2, -l / 2 + 0.0, l / 2, 0.0, 0.07, "H_fabric", r=0.03, seg=3, tile=0.5, tn=tn, puff=0.012, cuts=8, smooth=True)
    rbox(F, -w / 2 + 0.05, w / 2 - 0.05, -l / 2 + 0.05, l / 2 - 0.05, 0.065, 0.07, "H_fabric", r=0.0, seg=1, tile=0.5, tn=(0.95, 0.85, 0.5, 1))
    # 안석: a flat low backrest cushion standing against the back (-z end... here the wall side is -z)
    rbox(F, -0.35, 0.35, -l / 2 + 0.06, -l / 2 + 0.22, 0.07, 0.42, "H_fabric", r=0.04, seg=3, tile=0.4, tn=(0.8, 0.6, 0.35, 1), puff=0.02,
         cuts=4, smooth=True, tilt=0.12)
    # 사방침: a small box cushion on the left
    rbox(F, -w / 2 + 0.02, -w / 2 + 0.2, -l / 2 + 0.3, -l / 2 + 0.6, 0.07, 0.30, "H_fabric", r=0.02, seg=2, tile=0.4, tn=(0.8, 0.6, 0.35, 1))
    seat(F, 0, SEAT_KIND_FLOOR, 0.05, -l / 2 + 0.55, 0.07, 0.0, edge=0.3, back=0.35, width=0.7, approach=APPROACH_FRONT, pose=POSE_FLOOR)
    col(F, -w / 2, w / 2, -l / 2, l / 2, 0.1, name="boryo")


PIECES = [
    dict(name="sofa_fabric_3", fn=sofa_fabric, group="seating", ref="02_modern_living", cam=dict(az=35, el=18)),
    dict(name="sofa_L", fn=sofa_L, group="seating", ref="02_modern_living", cam=dict(az=35, el=20)),
    dict(name="sofa_leather_3", fn=sofa_leather, group="seating", ref="06_grandparents_room", cam=dict(az=35, el=18)),
    dict(name="sofa_rattan_2", fn=sofa_rattan, group="seating", ref="18_sunroom", cam=dict(az=35, el=18)),
    dict(name="sofa_floor_2", fn=sofa_floor, group="seating", ref="19_floor_sofa", cam=dict(az=35, el=22)),
    dict(name="armchair_lounge", fn=armchair_lounge, group="seating", ref="02_modern_living", cam=dict(az=35, el=18)),
    dict(name="armchair_reading", fn=armchair_reading, group="seating", ref="04_study", cam=dict(az=35, el=18)),
    dict(name="armchair_rattan", fn=armchair_rattan, group="seating", ref="18_sunroom", cam=dict(az=35, el=18)),
    dict(name="rocking_chair", fn=rocking_chair, group="seating", ref="09_attic", cam=dict(az=50, el=18)),
    dict(name="bean_bag", fn=bean_bag, group="seating", ref="05_kids_room", cam=dict(az=35, el=22)),
    dict(name="chair_dining_wood", fn=chair_dining_wood, group="seating", ref="11_dining", cam=dict(az=35, el=18)),
    dict(name="chair_dining_upholstered", fn=chair_dining_upholstered, group="seating", ref="11_dining", cam=dict(az=35, el=18)),
    dict(name="chair_farm_0", fn=chair_farm, kw=dict(variant=0), group="seating", ref="03_farm_kitchen", cam=dict(az=35, el=18)),
    dict(name="chair_farm_1", fn=chair_farm, kw=dict(variant=1), group="seating", ref="03_farm_kitchen", cam=dict(az=35, el=18)),
    dict(name="chair_rattan_dining", fn=chair_rattan_dining, group="seating", ref="18_sunroom", cam=dict(az=35, el=18)),
    dict(name="chair_desk", fn=chair_desk, group="seating", ref="04_study", cam=dict(az=35, el=18)),
    dict(name="stool_bar", fn=stool_bar, group="seating", ref="11_dining", cam=dict(az=35, el=18)),
    dict(name="stool_wood", fn=stool_wood, group="seating", ref="13_workshop", cam=dict(az=35, el=18)),
    dict(name="ottoman", fn=ottoman, group="seating", ref="04_study", cam=dict(az=35, el=22)),
    dict(name="piano_bench", fn=piano_bench, group="seating", ref="12_hobby_music", cam=dict(az=35, el=20)),
    dict(name="bench_log", fn=bench_log, group="seating", ref="13_workshop", cam=dict(az=35, el=20)),
    dict(name="bench_dining", fn=bench_dining, group="seating", ref="03_farm_kitchen", cam=dict(az=35, el=20)),
    dict(name="pyeongsang", fn=pyeongsang, group="seating", ref="07_hanok_maru", cam=dict(az=35, el=25)),
    dict(name="bangseok", fn=bangseok, group="seating", ref="06_grandparents_room", cam=dict(az=30, el=30)),
    dict(name="boryo_anseok", fn=boryo, group="seating", ref="17_sarangbang", cam=dict(az=35, el=28)),
]
