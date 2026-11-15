"""Room shell of the houses kit: floors, walls with openings (real 0.30 m reveals), crown moulding, baseboards,
window / door casings, windows (grid, 창호 sliding, 띠살문, picture), bathroom door, glass 중문, entry double door,
curtains, bamboo blinds. All pieces draw into the current mesh (kit_core.begin) in the frame given.

Wall frame convention (wall_frames): local x runs ALONG the wall, local z points INTO the room, origin at the wall's
start on the floor; the wall face is the plane z = 0 and the wall mass lies at z < 0 (thickness WALL_T).
"""
import math
from kit_core import *   # noqa: F401,F403
from kit_core import S, Frame


def wall_frames(F, W, D):
    """front (entry, z=0), right (x=W), back (z=D), left (x=0) frames and their lengths"""
    return {
        "front": (F.sub(0, 0, 0, 0.0), W),
        "right": (F.sub(W, 0, 0, -math.pi / 2), D),
        "back": (F.sub(W, D, 0, math.pi), W),
        "left": (F.sub(0, D, 0, math.pi / 2), D),
    }


# ----------------------------------------------------------------------------------------------- floors ---------
def floor(F, x0, x1, z0, z1, kind="oak", tn=None):
    """walking surface at y = 0 (thin slab below it is not drawn)."""
    if kind in ("oak", "dark"):
        m = "H_floor_oak" if kind == "oak" else "H_floor_dark"
        gface(F, [(x0, z0, 0), (x1, z0, 0), (x1, z1, 0), (x0, z1, 0)], m, (1, 0, 0), 2.4, (0, 0, 1), tn=tn)
    elif kind == "jangpan":
        gface(F, [(x0, z0, 0), (x1, z0, 0), (x1, z1, 0), (x0, z1, 0)], "H_jangpan", (1, 0, 0), 1.0, (0, 0, 1), tn=tn)
        # 장판 sheet seams: the sheets (0.91 m rolls) overlap, one edge a hair higher, a soft darker line
        z = z0 + 0.91
        while z < z1 - 0.2:
            rbox(F, x0, x1, z - 0.004, z + 0.012, 0.0, 0.003, "H_jangpan", r=0.0015, seg=1, tn=(0.8, 0.7, 0.45, 1))
            z += 0.91
    elif kind in ("tile_grey", "tile_white"):
        m = "H_" + kind
        gface(F, [(x0, z0, 0), (x1, z0, 0), (x1, z1, 0), (x0, z1, 0)], m, (1, 0, 0), 1.2 if kind == "tile_grey" else 1.0,
              (0, 0, 1), tn=tn)
    elif kind == "maru":
        # 우물마루: long frames (장귀틀) every 0.9 m running along z, short panels (청판) laid between them along x
        xx = x0
        k = 0
        while xx < x1 - 0.01:
            xe = min(x1, xx + 0.9)
            rbox(F, xx, xx + 0.1, z0, z1, -0.02, 0.0, "H_wood_oak", r=0.006, seg=1, grain=(0, 1, 0), tn=(0.75, 0.6, 0.45, 1))
            zz = z0
            j = 0
            while zz < z1 - 0.01:
                ze = min(z1, zz + 0.16)
                rbox(F, xx + 0.1, xe, zz, ze, -0.03, -0.004, "H_wood_oak", r=0.003, seg=1, grain=(1, 0, 0),
                     tn=(0.85 - 0.05 * ((j + k) % 3), 0.7, 0.55, 1))
                zz = ze
                j += 1
            xx = xe
            k += 1
        rbox(F, x1 - 0.1, x1, z0, z1, -0.02, 0.0, "H_wood_oak", r=0.006, seg=1, grain=(0, 1, 0), tn=(0.75, 0.6, 0.45, 1))


def threshold(F, x0, x1, z, depth=0.12, tn=None):
    """귀틀: the 3 cm wooden edge where tile meets floor (the walking plane stays at y = 0)."""
    rbox(F, x0, x1, z, z + depth, 0.0, 0.03, "H_wood_walnut", r=0.01, seg=2, tn=tn or (0.8, 0.8, 0.8, 1))


# ----------------------------------------------------------------------------------------------- walls ----------
def _wall_panels(W, length, h, ops, m, tn, t=WALL_T, y0=0.0):
    """inner face + reveals. ops: [dict(s0, s1, y0, y1)] sorted by s0 (openings do not overlap)."""
    ops = sorted(ops, key=lambda o: o["s0"])
    s = 0.0
    for o in ops:
        if o["s0"] > s + 1e-4:
            gface(W, [(s, 0, y0), (o["s0"], 0, y0), (o["s0"], 0, h), (s, 0, h)], m, (1, 0, 0), 2.5, (0, 0, 1), tn=tn)
        # below / above the opening
        if o["y0"] > y0 + 1e-4:
            gface(W, [(o["s0"], 0, y0), (o["s1"], 0, y0), (o["s1"], 0, o["y0"]), (o["s0"], 0, o["y0"])], m, (1, 0, 0), 2.5,
                  (0, 0, 1), tn=tn)
        if o["y1"] < h - 1e-4:
            gface(W, [(o["s0"], 0, o["y1"]), (o["s1"], 0, o["y1"]), (o["s1"], 0, h), (o["s0"], 0, h)], m, (1, 0, 0), 2.5,
                  (0, 0, 1), tn=tn)
        # reveals (jambs, sill, head), depth t
        gface(W, [(o["s0"], 0, o["y0"]), (o["s0"], -t, o["y0"]), (o["s0"], -t, o["y1"]), (o["s0"], 0, o["y1"])], m,
              (0, 1, 0), 2.5, (1, 0, 0), tn=tn)
        gface(W, [(o["s1"], 0, o["y0"]), (o["s1"], -t, o["y0"]), (o["s1"], -t, o["y1"]), (o["s1"], 0, o["y1"])], m,
              (0, 1, 0), 2.5, (-1, 0, 0), tn=tn)
        gface(W, [(o["s0"], 0, o["y1"]), (o["s1"], 0, o["y1"]), (o["s1"], -t, o["y1"]), (o["s0"], -t, o["y1"])], m,
              (1, 0, 0), 2.5, (0, 0, -1), tn=tn)
        if o["y0"] > y0 + 1e-4:
            gface(W, [(o["s0"], 0, o["y0"]), (o["s1"], 0, o["y0"]), (o["s1"], -t, o["y0"]), (o["s0"], -t, o["y0"])], m,
                  (1, 0, 0), 2.5, (0, 0, 1), tn=tn)
        s = o["s1"]
    if s < length - 1e-4:
        gface(W, [(s, 0, y0), (length, 0, y0), (length, 0, h), (s, 0, h)], m, (1, 0, 0), 2.5, (0, 0, 1), tn=tn)


def wall(W, length, h=CEILING_HEIGHT, ops=(), m="H_plaster", tn=None, base=True, crown=True, base_h=0.10,
         base_tn=None, crown_tn=None):
    """one inner wall with openings, baseboard (걸레받이) and crown moulding; ops: list of dict(s0, s1, y0, y1)."""
    _wall_panels(W, length, h, list(ops), m, tn)
    if base:
        doors = sorted([o for o in ops if o["y0"] <= 0.001], key=lambda o: o["s0"])
        s = 0.0
        segs = []
        for o in doors:
            segs.append((s, o["s0"]))
            s = o["s1"]
        segs.append((s, length))
        for (a, b) in segs:
            if b - a < 0.05:
                continue
            btn = base_tn or PAL["paint_white"]
            rbox(W, a, b, 0.0, 0.016, 0.0, base_h, "H_paint", r=0.004, seg=1, tn=btn, grain=(1, 0, 0))
            rbox(W, a, b, 0.0, 0.010, base_h, base_h + 0.018, "H_paint", r=0.004, seg=1, tn=btn)
    if crown:
        ctn = crown_tn or PAL["paint_white"]
        rbox(W, 0, length, 0.0, 0.05, h - 0.05, h, "H_paint", r=0.006, seg=1, tn=ctn)
        rbox(W, 0, length, 0.0, 0.085, h - 0.025, h, "H_paint", r=0.006, seg=1, tn=ctn)
        rbox(W, 0, length, 0.0, 0.02, h - 0.10, h - 0.05, "H_paint", r=0.004, seg=1, tn=ctn)


def ceiling(F, W, D, h=CEILING_HEIGHT, hole=None, m="H_plaster", tn=None, lights=((2.6, 3.9), (7.9, 3.9)), beams=False):
    """flat ceiling at y = h with an optional rectangular hole (x0, x1, z0, z1) for the stairwell, with 0.3 m reveals,
    plus recessed downlights. beams = 대들보 구조 not here (see maru_beams)."""
    def slab(x0, x1, z0, z1):
        if x1 - x0 < 1e-3 or z1 - z0 < 1e-3:
            return
        gface(F, [(x0, z0, h), (x1, z0, h), (x1, z1, h), (x0, z1, h)], m, (1, 0, 0), 2.5, (0, 0, -1), tn=tn)
    if hole is None:
        slab(0, W, 0, D)
    else:
        hx0, hx1, hz0, hz1 = hole
        slab(0, hx0, 0, D)
        slab(hx1, W, 0, D)
        slab(hx0, hx1, 0, hz0)
        slab(hx0, hx1, hz1, D)
        t = FLOOR_HEIGHT - h
        for (a, b, c, d, hint) in ((hx0, hz0, hx0, hz1, (1, 0, 0)), (hx1, hz0, hx1, hz1, (-1, 0, 0)),
                                   (hx0, hz0, hx1, hz0, (0, 1, 0)), (hx0, hz1, hx1, hz1, (0, -1, 0))):
            gface(F, [(a, b, h), (c, d, h), (c, d, h + t), (a, b, h + t)], m, (1, 0, 0), 2.5, hint, tn=tn)
        # fascia board round the hole
        for (a, b, c, d) in ((hx0, hz0, hx0, hz1), (hx1, hz0, hx1, hz1), (hx0, hz0, hx1, hz0), (hx0, hz1, hx1, hz1)):
            pass
    for (lx, lz) in lights:
        if hole and hole[0] - 0.3 < lx < hole[1] + 0.3 and hole[2] - 0.3 < lz < hole[3] + 0.3:
            continue
        cyl(F, lx, lz, h - 0.012, h - 0.0, 0.085, "H_paint", segs=20, tn=PAL["paint_white"], cap=False)
        disc(F, lx, lz, h - 0.012, 0.075, "H_lamp", segs=20, down=True)
        light(F, "downlight", lx, lz, h - 0.05, 30.0, "#FFE2B8")


# ------------------------------------------------------------------------------------ casings & windows ---------
def casing(W, s0, s1, y0, y1, top_extra=0.0, w=0.075, th=0.016, tn=None, bottom=False):
    """flat architrave boards round an opening on the room side (z 0..th)."""
    tn = tn or PAL["paint_white"]
    rbox(W, s0 - w, s0, 0.0, th, y0 - (w if bottom else 0), y1 + w, "H_paint", r=0.003, seg=1, grain=(0, 0, 1), tn=tn)
    rbox(W, s1, s1 + w, 0.0, th, y0 - (w if bottom else 0), y1 + w, "H_paint", r=0.003, seg=1, grain=(0, 0, 1), tn=tn)
    rbox(W, s0 - w - 0.012, s1 + w + 0.012, 0.0, th + 0.01, y1, y1 + w, "H_paint", r=0.004, seg=1, tn=tn)
    if bottom:
        rbox(W, s0, s1, 0.0, th, y0 - w, y0, "H_paint", r=0.003, seg=1, tn=tn)


def window(W, s0, s1, y0, y1, style="grid", cols=2, rows=2, tn=None, frame_m="H_paint", paper=False):
    """window in an opening (s0..s1, y0..y1) of wall frame W: casing, interior sill (창턱), frame set 0.12 m deep,
    glass, mullions / lattice. style: grid | slide (2-sash sliding) | ttisal (Korean lattice, paper) | picture."""
    tn = tn or PAL["paint_white"]
    casing(W, s0, s1, y0, y1, tn=tn)
    # sill board (projects 4 cm) + apron
    rbox(W, s0 - 0.09, s1 + 0.09, 0.0, 0.10, y0 - 0.025, y0 + 0.005, "H_paint", r=0.006, seg=2, tn=tn)
    rbox(W, s0 - 0.04, s1 + 0.04, 0.0, 0.016, y0 - 0.12, y0 - 0.025, "H_paint", r=0.004, seg=1, tn=tn)
    fz0, fz1 = -0.20, -0.12        # frame block depth (in the reveal)
    fw = 0.055
    ins0, ins1, iy0, iy1 = s0 + fw, s1 - fw, y0 + fw, y1 - fw
    # outer frame (4 bars)
    for (a, b, c, d) in ((s0, s0 + fw, y0, y1), (s1 - fw, s1, y0, y1)):
        rbox(W, a, b, fz0, fz1, c, d, frame_m, r=0.004, seg=1, grain=(0, 0, 1), tn=tn)
    rbox(W, s0, s1, fz0, fz1, y1 - fw, y1, frame_m, r=0.004, seg=1, tn=tn)
    rbox(W, s0, s1, fz0, fz1, y0, y0 + fw, frame_m, r=0.004, seg=1, tn=tn)
    gz = -0.16
    if style == "ttisal":
        # 띠살: horizontal slats + a few verticals, hanji behind
        gface(W, [(ins0, gz - 0.005, iy0), (ins1, gz - 0.005, iy0), (ins1, gz - 0.005, iy1), (ins0, gz - 0.005, iy1)],
              "H_paper", (1, 0, 0), 1.0, (0, 0, 1))
        nvert = max(1, int((ins1 - ins0) / 0.35))
        for i in range(1, nvert):
            x = ins0 + (ins1 - ins0) * i / nvert
            rbox(W, x - 0.012, x + 0.012, -0.14, -0.105, iy0, iy1, "H_wood_dark", r=0.002, seg=1, grain=(0, 0, 1),
                 tn=(0.85, 0.7, 0.55, 1))
        y = iy0 + 0.17
        while y < iy1 - 0.05:
            rbox(W, ins0, ins1, -0.14, -0.105, y - 0.011, y + 0.011, "H_wood_dark", r=0.002, seg=1, tn=(0.85, 0.7, 0.55, 1))
            y += 0.17
        return
    if style == "slide":
        mid = (ins0 + ins1) / 2
        for k, (a, b, zz) in enumerate(((ins0, mid + 0.03, -0.135), (mid - 0.03, ins1, -0.175))):
            fz = (zz - 0.012, zz + 0.012)
            rbox(W, a, a + 0.04, fz[0], fz[1], iy0, iy1, frame_m, r=0.002, seg=1, grain=(0, 0, 1), tn=tn)
            rbox(W, b - 0.04, b, fz[0], fz[1], iy0, iy1, frame_m, r=0.002, seg=1, grain=(0, 0, 1), tn=tn)
            rbox(W, a, b, fz[0], fz[1], iy1 - 0.04, iy1, frame_m, r=0.002, seg=1, tn=tn)
            rbox(W, a, b, fz[0], fz[1], iy0, iy0 + 0.04, frame_m, r=0.002, seg=1, tn=tn)
            gface(W, [(a + 0.04, zz, iy0 + 0.04), (b - 0.04, zz, iy0 + 0.04), (b - 0.04, zz, iy1 - 0.04),
                      (a + 0.04, zz, iy1 - 0.04)], "H_paper" if paper else "H_glass", (1, 0, 0), 1.0, (0, 0, 1))
        return
    # grid / picture: one glass pane + mullions
    gface(W, [(ins0, gz, iy0), (ins1, gz, iy0), (ins1, gz, iy1), (ins0, gz, iy1)], "H_glass", (1, 0, 0), 1.0, (0, 0, 1))
    if style == "grid":
        for i in range(1, cols):
            x = ins0 + (ins1 - ins0) * i / cols
            rbox(W, x - 0.017, x + 0.017, -0.19, -0.12, iy0, iy1, frame_m, r=0.003, seg=1, grain=(0, 0, 1), tn=tn)
        for j in range(1, rows):
            y = iy0 + (iy1 - iy0) * j / rows
            rbox(W, ins0, ins1, -0.19, -0.12, y - 0.017, y + 0.017, frame_m, r=0.003, seg=1, tn=tn)
    # lever handle on the room side of a middle mullion
    hx = (ins0 + ins1) / 2
    rbox(W, hx - 0.01, hx + 0.01, -0.12, -0.085, (iy0 + iy1) / 2 - 0.05, (iy0 + iy1) / 2 + 0.05, "H_metal", r=0.004, seg=1,
         tn=(0.75, 0.75, 0.75, 1))


def door_opening(W, s0, s1, h=2.6, tn=None):
    """doorless opening (>= 1.6 m wide in the design): architrave only; the wall function made the reveal."""
    casing(W, s0, s1, 0.0, h, tn=tn)


def bath_door(W, s0, s1, h=2.1, tn=None, handle_left=False):
    """closed 욕실 door: 2-panel shaker leaf in a frame, lever handle, 3 hinges, threshold. Opening should be s0..s1,
    height h + 0.05 (call wall() with an opening of that size)."""
    tn = tn or PAL["paint_white"]
    casing(W, s0, s1, 0.0, h + 0.03, tn=tn)
    z0, z1 = -0.12, -0.075
    gface(W, [(s0, -0.26, 0), (s1, -0.26, 0), (s1, -0.26, h), (s0, -0.26, h)], "H_paint", (1, 0, 0), 1.0, (0, 0, 1), tn=(0.5, 0.5, 0.5, 1))
    rbox(W, s0 + 0.005, s1 - 0.005, z0, z1, 0.01, h, "H_paint", r=0.004, seg=1, tn=tn)
    pw = (s1 - s0 - 0.20) / 1.0
    for (ya, yb) in ((0.15, 1.0), (1.12, h - 0.15)):
        rbox(W, s0 + 0.1, s1 - 0.1, z1 - 0.002, z1 + 0.008, ya, yb, "H_paint", r=0.003, seg=1, tn=tn)
    hx = s1 - 0.09 if not handle_left else s0 + 0.09
    cyl(W.sub(0, 0, 0), hx, -0.06, 1.0, 1.0 + 0.0, 0.0, "H_metal", segs=4)  # placeholder keeps API stable
    rbox(W, hx - 0.025, hx + 0.025, -0.075, -0.05, 0.99, 1.03, "H_metal", r=0.006, seg=2, tn=(0.8, 0.8, 0.8, 1))
    rbox(W, hx - 0.075 if not handle_left else hx, hx if not handle_left else hx + 0.075, -0.05, -0.03, 1.0, 1.02, "H_metal",
         r=0.006, seg=2, tn=(0.8, 0.8, 0.8, 1))
    for y in (0.25, 1.05, 1.85):
        xx = s0 + 0.012 if not handle_left else s1 - 0.012
        rbox(W, xx - 0.008, xx + 0.008, -0.085, -0.06, y, y + 0.1, "H_metal", r=0.003, seg=1, tn=(0.5, 0.5, 0.5, 1))
    rbox(W, s0, s1, -0.2, 0.0, 0.0, 0.015, "H_wood_walnut", r=0.003, seg=1, tn=(0.8, 0.8, 0.8, 1))


def jungmun(W, s0, s1, h=2.4):
    """glass 중문: 3-track sliding glass door, left fixed + 2 sliding panels drawn open (stacked), aluminium frames"""
    tn = (0.18, 0.18, 0.19, 1)
    casing(W, s0, s1, 0.0, h, tn=tn)
    wdt = (s1 - s0) / 3.0 + 0.1
    for k in range(3):
        a = s0 + k * ((s1 - s0) - wdt) / 2
        b = a + wdt
        zz = -0.10 - 0.05 * k
        for xx in (a, b - 0.045):
            rbox(W, xx, xx + 0.045, zz - 0.02, zz + 0.02, 0.0, h, "H_metal", r=0.004, seg=1, grain=(0, 0, 1), tn=tn)
        rbox(W, a, b, zz - 0.02, zz + 0.02, h - 0.045, h, "H_metal", r=0.004, seg=1, tn=tn)
        rbox(W, a, b, zz - 0.02, zz + 0.02, 0.0, 0.07, "H_metal", r=0.004, seg=1, tn=tn)
        gface(W, [(a + 0.045, zz, 0.07), (b - 0.045, zz, 0.07), (b - 0.045, zz, h - 0.045), (a + 0.045, zz, h - 0.045)],
              "H_glass", (1, 0, 0), 1.0, (0, 0, 1))
        rbox(W, b - 0.1, b - 0.08, zz + 0.02, zz + 0.045, 1.0, 1.35, "H_metal", r=0.004, seg=1, tn=(0.6, 0.6, 0.6, 1))
    rbox(W, s0, s1, -0.2, -0.0, h, h + 0.06, "H_metal", r=0.004, seg=1, tn=tn)       # head track


def entry_door(W, s0, s1, h=2.9):
    """front glass double door seen from inside: wood frame, 2 leaves with big glass, long pull bars, kick plates"""
    tn = (0.45, 0.30, 0.20, 1)
    casing(W, s0, s1, 0.0, h, tn=PAL["paint_white"])
    mid = (s0 + s1) / 2
    for (a, b) in ((s0 + 0.03, mid - 0.004), (mid + 0.004, s1 - 0.03)):
        zz = -0.14
        for xx in (a, b - 0.09):
            rbox(W, xx, xx + 0.09, zz - 0.03, zz + 0.03, 0.0, h - 0.03, "H_wood_dark", r=0.006, seg=2, grain=(0, 0, 1), tn=tn)
        rbox(W, a, b, zz - 0.03, zz + 0.03, h - 0.15, h - 0.03, "H_wood_dark", r=0.006, seg=2, tn=tn)
        rbox(W, a, b, zz - 0.03, zz + 0.03, 0.0, 0.25, "H_wood_dark", r=0.006, seg=2, tn=tn)
        gface(W, [(a + 0.09, zz, 0.25), (b - 0.09, zz, 0.25), (b - 0.09, zz, h - 0.15), (a + 0.09, zz, h - 0.15)], "H_glass",
              (1, 0, 0), 1.0, (0, 0, 1))
        px = b - 0.16 if a < mid else a + 0.16
        for off in (-0.02, 0.02):
            rbox(W, px + off - 0.011, px + off + 0.011, zz + 0.03, zz + 0.09, 0.9, 1.9, "H_metal", r=0.006, seg=2,
                 tn=(0.82, 0.82, 0.8, 1), grain=(0, 0, 1))
    rbox(W, s0 - 0.01, s1 + 0.01, -0.3, 0.1, 0.0, 0.02, "H_stone", r=0.004, seg=1, tn=(0.6, 0.6, 0.6, 1))


# --------------------------------------------------------------------------------------------- soft furnishings --
def curtain(W, s0, s1, y_top, y_bot, folds=8, z=0.10, amp=0.035, tn=None, m="H_fabric", rod=True, panels=2, gap=0.0):
    """pleated curtain: two panels with sine folds (real geometry), rod with finials + rings. W frame (face z = 0)."""
    tn = tn or PAL["cream"]
    n = 48
    width = s1 - s0
    for pi_ in range(panels):
        a = s0 + pi_ * width / panels
        b = s0 + (pi_ + 1) * width / panels
        if panels == 2:
            if pi_ == 0:
                b -= gap
            else:
                a += gap
        nf = max(2, int(folds / panels))
        cols = []
        for i in range(n + 1):
            u = i / n
            x = a + (b - a) * u
            zz = z + amp * math.sin(u * nf * 2 * math.pi) + 0.004 * math.sin(u * nf * 14)
            cols.append((x, zz))
        for i in range(n):
            (xa, za), (xb, zb) = cols[i], cols[i + 1]
            gface(W, [(xa, za, y_bot), (xb, zb, y_bot), (xb, zb, y_top), (xa, za, y_top)], m, (1, 0, 0), 0.6, (0, 1, 0),
                  tn=tn, smooth=True)
            gface(W, [(xa, za, y_bot), (xb, zb, y_bot), (xb, zb, y_top), (xa, za, y_top)], m, (1, 0, 0), 0.6, (0, -1, 0),
                  tn=tn, smooth=True)
    if rod:
        tube(W, [(s0 - 0.12, z + 0.04, y_top + 0.06), (s1 + 0.12, z + 0.04, y_top + 0.06)], 0.014, "H_metal", 8,
             tn=(0.18, 0.18, 0.18, 1))
        for xx in (s0 - 0.12, s1 + 0.12):
            lathe(W, xx, z + 0.04, y_top + 0.06 - 0.03, [(0, 0), (0.025, 0.0), (0.03, 0.03), (0.02, 0.06), (0, 0.062)], "H_metal",
                  10, tn=(0.18, 0.18, 0.18, 1))
            # (lathe is vertical; the finial is a little knob above the rod end)
        for i in range(10):
            x = s0 + width * (i + 0.5) / 10
            tube(W, [(x - 0.012, z + 0.04, y_top + 0.06), (x, z + 0.04, y_top + 0.02), (x + 0.012, z + 0.04, y_top + 0.06)], 0.004, "H_metal", 6,
                 tn=(0.18, 0.18, 0.18, 1), caps=False)


def blind_bamboo(W, s0, s1, y_top, y_bot, z=0.03):
    gface(W, [(s0, z, y_bot), (s1, z, y_bot), (s1, z, y_top), (s0, z, y_top)], "H_bamboo", (1, 0, 0), 0.6, (0, 1, 0))
    rbox(W, s0 - 0.01, s1 + 0.01, z - 0.02, z + 0.03, y_top, y_top + 0.06, "H_wood_dark", r=0.006, seg=1, tn=(0.8, 0.6, 0.45, 1))
    # roll-up cords
    for x in (s0 + 0.15, s1 - 0.15):
        tube(W, [(x, z + 0.008, y_top), (x, z + 0.008, y_bot + 0.2)], 0.003, "H_paint", 5, tn=(0.9, 0.85, 0.7, 1))


def vertical_blind(W, s0, s1, y_top, y_bot, z=0.06, n=None, tn=None):
    tn = tn or PAL["cream"]
    n = n or int((s1 - s0) / 0.12)
    for i in range(n):
        x = s0 + (s1 - s0) * (i + 0.5) / n
        ang = 0.5 * (-1) ** i
        gface(W, [(x - 0.055, z + 0.02 * ang, y_bot), (x + 0.055, z - 0.02 * ang, y_bot), (x + 0.055, z - 0.02 * ang, y_top),
                  (x - 0.055, z + 0.02 * ang, y_top)], "H_fabric", (0, 0, 1), 0.5, (0, 1, 0), tn=tn)
        gface(W, [(x - 0.055, z + 0.02 * ang, y_bot), (x + 0.055, z - 0.02 * ang, y_bot), (x + 0.055, z - 0.02 * ang, y_top),
                  (x - 0.055, z + 0.02 * ang, y_top)], "H_fabric", (0, 0, 1), 0.5, (0, -1, 0), tn=tn)
    rbox(W, s0 - 0.01, s1 + 0.01, z - 0.04, z + 0.05, y_top, y_top + 0.06, "H_metal", r=0.006, seg=1, tn=(0.85, 0.85, 0.85, 1))


# ------------------------------------------------------------------------------------------------ stairs --------
def _stair_y(i):
    return i * (FLOOR_HEIGHT / STAIR_STEPS)


def stairs(F, wall_side="left", i_from=1, width=STAIR_WIDTH, treads_m="H_wood_oak", tread_tn=None,
           paint_tn=None, rail="steel", balusters=True, soffit=True, newel_bottom=True, nose=0.03, run=STAIR_RUN,
           steps=STAIR_STEPS, closed_under=False, open_low=0, top_open=0.0):
    """Straight stair, 17 risers x 0.2353 = 4.0 m, 16 treads x 0.34 = 5.44 m, width 1.3 m. Local frame: origin = the
    middle of the first riser's foot on the floor, +z = running up, x across, y up. `wall_side` = 'left' (-x) or
    'right' (+x): that side stands against a wall and gets only a slim wall handrail on brackets; the OPEN side
    gets a skirt stringer (deep side board under the treads), a newel post at the bottom and at the top, black
    steel balusters on every tread (gap < 10 cm) and a wooden handrail parallel to the nosing line 0.9 m above it.
    i_from > 1 draws only the upper steps (the view from the 2F, call with the frame y = -4.0; the contract's wellSteps = 8 -> i_from = 10).
    open_low = the first N treads have NO guard on the open side (stairs A/B: the foot is against a side wall, you step on from the room
    side; contract 4: 3-4 open steps) - the open-side newel, balusters and rail start above them; top_open = metres at the top end
    of the open side left free of rail (stairs C/D: the 2F landing is beside the top tread)."""
    rise = FLOOR_HEIGHT / steps
    hw = width / 2
    wsx = -1 if wall_side == "left" else 1       # sign of x of the wall side
    osx = -wsx                                   # sign of x of the open side
    tt = tread_tn or (0.8, 0.55, 0.4, 1)
    pt = paint_tn or PAL["paint_white"]
    nT = steps - 1                                # treads 1..16 (step 17 = the upper floor)
    stw = 0.045                                    # stringer thickness
    zr = lambda i: (i - 1) * run                   # riser face of step i
    # ---- treads + risers
    for i in range(i_from, steps + 1):
        z = zr(i)
        y = _stair_y(i)
        if i <= nT:
            rbox(F, -hw + stw * 0 + (stw if osx < 0 else 0), hw - (stw if osx > 0 else 0), z - nose, z + run, y - 0.04, y,
                 treads_m, r=0.008, seg=2, grain=(1, 0, 0), tile=0.9, tn=tt, bottom=True)
        # riser board (painted), under the tread above it
        yb = _stair_y(i - 1)
        if i - 1 >= 0:
            rbox(F, -hw + (stw if osx < 0 else 0), hw - (stw if osx > 0 else 0), z - 0.018, z, yb if i > 1 else 0.0, y - 0.04, "H_paint",
                 r=0.002, seg=1, tn=pt) if i <= nT else None
    # step 17: the nosing of the upper floor (a wooden edge board + riser)
    if i_from <= steps:
        yb = _stair_y(steps - 1)
        z = zr(steps)
        rbox(F, -hw, hw, z - 0.018, z + 0.0, yb - 0.04, FLOOR_HEIGHT - 0.04, "H_paint", r=0.002, seg=1, tn=pt)
        rbox(F, -hw, hw, z - nose, z + 0.12, FLOOR_HEIGHT - 0.04, FLOOR_HEIGHT, treads_m, r=0.008, seg=2, grain=(1, 0, 0),
             tile=0.9, tn=tt, bottom=True)
    # ---- stringers: one strip per step (exact sawtooth top flush with the tread tops), sloped underside `deep` below
    slope = rise / run
    zb0 = zr(i_from)

    def stringer(xc, sx, deep, to_floor=False):
        for i in range(i_from, steps + 1):
            za = zr(i) - (nose if i == i_from else 0.0)
            zb = zr(i) + run if i <= nT else zr(i)
            yt = _stair_y(i)
            ya = max(_stair_y(i_from) - deep + (za - zb0) * slope, 0.0)
            yb = max(_stair_y(i_from) - deep + (zb - zb0) * slope, 0.0)
            if to_floor:
                ya = yb = 0.0
            for sgn in (-1, 1):
                x = xc + sgn * sx / 2
                gface(F, [(x, za, ya), (x, zb, yb), (x, zb, yt), (x, za, yt)], "H_paint", (0, 1, 0), 1.0, (sgn, 0, 0), tn=pt)
            gface(F, [(xc - sx / 2, za, yt), (xc + sx / 2, za, yt), (xc + sx / 2, zb, yt), (xc - sx / 2, zb, yt)], "H_paint",
                  (0, 1, 0), 1.0, (0, 0, 1), tn=pt)
            gface(F, [(xc - sx / 2, za, ya), (xc + sx / 2, za, ya), (xc + sx / 2, zb, yb), (xc - sx / 2, zb, yb)], "H_paint",
                  (0, 1, 0), 1.0, (0, -rise, run), tn=pt)
            if i > i_from:
                yp = _stair_y(i - 1)
                gface(F, [(xc - sx / 2, za, yp), (xc + sx / 2, za, yp), (xc + sx / 2, za, yt), (xc - sx / 2, za, yt)], "H_paint",
                      (1, 0, 0), 1.0, (0, -1, 0), tn=pt)
        # the foot and the head of the stringer
        yh = _stair_y(i_from) - deep
        gface(F, [(xc - sx / 2, zr(i_from) - nose, max(yh, 0.0)), (xc + sx / 2, zr(i_from) - nose, max(yh, 0.0)),
                  (xc + sx / 2, zr(i_from) - nose, _stair_y(i_from)), (xc - sx / 2, zr(i_from) - nose, _stair_y(i_from))],
              "H_paint", (1, 0, 0), 1.0, (0, -1, 0), tn=pt)

    stringer(osx * (hw - stw / 2), stw, 0.26, to_floor=closed_under)
    stringer(wsx * (hw - 0.01), 0.02, 0.09)
    # soffit (underside) between the stringers: a sloped board
    if soffit:
        a0 = zr(i_from) - nose
        y_a = max(_stair_y(i_from) - 0.04 - 0.26 + 0.0, 0.0)
        a1 = zr(steps)
        y_b = FLOOR_HEIGHT - 0.26 - 0.04 + 0.0
        gface(F, [(-hw, a0, y_a), (hw, a0, y_a), (hw, a1, y_b), (-hw, a1, y_b)], "H_plaster", (1, 0, 0), 2.5,
              (0, -rise, run), tn=PAL["white"])
    # ---- newels, balusters, handrail on the open side
    ox = osx * (hw - stw / 2)
    nosey = lambda z: None
    def y_line(z):
        # nosing line height at z (between the nosing of step 1 at z = -nose and of step 17 at zr(17) - nose)
        return _stair_y(1) + (z - (zr(1) - nose)) * (rise / run)
    rail_h = 0.90
    ns = 0.085
    z_bot = zr(i_from) - nose + 0.0
    z_top = zr(steps) - nose
    # newel at the top: stands on the stringer at the upper floor edge
    def newel(z, ytop, ybase, top_cap=True):
        rbox(F, ox - ns / 2, ox + ns / 2, z - ns / 2, z + ns / 2, ybase, ytop, "H_wood_oak", r=0.006, seg=2, grain=(0, 0, 1),
             tile=0.9, tn=tt)
        if top_cap:
            rbox(F, ox - ns / 2 - 0.012, ox + ns / 2 + 0.012, z - ns / 2 - 0.012, z + ns / 2 + 0.012, ytop, ytop + 0.025,
                 "H_wood_oak", r=0.008, seg=2, tn=tt)
            lathe(F, ox, z, ytop + 0.025, [(0, 0), (0.03, 0.0), (0.038, 0.02), (0.03, 0.045), (0, 0.055)], "H_wood_oak", 14,
                  tn=tt)
    L = open_low if i_from == 1 else 0
    z_rs = zr(L + 1) - nose + ns / 2 + 0.02 if L else z_bot + ns / 2 + 0.02
    if newel_bottom and i_from == 1:
        zb = z_rs
        newel(zb, y_line(zb) + rail_h + 0.02, 0.0 if not L else _stair_y(L + 1) - 0.45)
    zt = z_top - top_open
    newel(zt, y_line(zt) + rail_h + 0.02, _stair_y(steps) - 0.35 - (0.0 if not top_open else (top_open * rise / run)))
    # handrail: oval/round wood bar on top of the balusters
    zs0 = z_rs if (newel_bottom and i_from == 1) else z_bot
    p0 = (ox, zs0, y_line(zs0) + rail_h)
    p1 = (ox, zt, y_line(zt) + rail_h)
    tube(F, [p0, p1], 0.026, "H_wood_oak", 10, tn=tt, uv_per_m=0.9)
    # a flat under-rail for steel balusters (black)
    bk = (0.14, 0.14, 0.15, 1)
    if balusters:
        for i in range(max(i_from, 1), steps):
            for k in range(4):
                z = zr(i) + run * (k + 0.5) / 4
                if z < zs0 + 0.02 or z > zt - ns / 2 - 0.01:
                    continue
                yb = _stair_y(i)
                yt = y_line(z) + rail_h - 0.026
                rbox(F, ox - 0.007, ox + 0.007, z - 0.007, z + 0.007, yb - 0.0, yt, "H_metal", r=0.001, seg=1, grain=(0, 0, 1),
                     tn=bk)
        # bottom/top rail bars? (steel flat bar under the wooden rail)
        tube(F, [(ox, zs0, y_line(zs0) + rail_h - 0.035), (ox, zt, y_line(zt) + rail_h - 0.035)], 0.007, "H_metal", 6, tn=bk,
             caps=False)
    # ---- wall side: slim wall handrail on brackets (every ~0.95 m)
    wx = wsx * (hw + 0.0 - 0.07)
    wz0 = zr(max(i_from, 1)) + 0.1
    wz1 = zr(steps) - 0.1
    tube(F, [(wx, wz0, y_line(wz0) + rail_h), (wx, wz1, y_line(wz1) + rail_h)], 0.021, "H_wood_oak", 10,
         tn=(0.9, 0.7, 0.5, 1), uv_per_m=0.9)
    z = wz0 + 0.3
    while z < wz1:
        rbox(F, wx - 0.012 if wsx > 0 else wx - 0.012 + (-0.0), wx + 0.012, z - 0.012, z + 0.012, y_line(z) + rail_h - 0.04,
             y_line(z) + rail_h - 0.01, "H_metal", r=0.003, seg=1, tn=bk)
        rbox(F, min(wx, wsx * hw) - 0.0, max(wx, wsx * hw) + 0.0, z - 0.008, z + 0.008, y_line(z) + rail_h - 0.03,
             y_line(z) + rail_h - 0.014, "H_metal", r=0.002, seg=1, tn=bk)
        z += 0.95
    if i_from == 1:
        col(F, -hw, hw, -nose, zr(steps), FLOOR_HEIGHT, name="stair")


def stair_guard_2f(F, wall_side="left", width=STAIR_WIDTH, length=(STAIR_STEPS - 1) * STAIR_RUN, tread_tn=None, landing=0.0):
    """Upper-floor guard round the stairwell hole: frame y = 0 is the upper floor. Open side: balusters every 8.5 cm
    under a wooden handrail 0.9 m high from the bottom end newel to the top newel (where the stair rail arrives at
    the same height), and an end guard across the low end. Also the hole's floor edge board (fascia) and the floor
    slab reveal. Local z runs as in stairs() (the stair top is at z = length)."""
    hw = width / 2
    osx = 1 if wall_side == "left" else -1
    tt = tread_tn or (0.8, 0.55, 0.4, 1)
    bk = (0.14, 0.14, 0.15, 1)
    ox = osx * (hw - 0.0225)
    full = length
    length = length - landing          # stairs C/D: the 2F landing beside the top tread stays free of guard
    ns = 0.085
    h = 0.90
    for z in (0.05 + ns / 2, length - ns / 2 - 0.0):
        rbox(F, ox - ns / 2, ox + ns / 2, z - ns / 2, z + ns / 2, 0.0, h + 0.02, "H_wood_oak", r=0.006, seg=2, grain=(0, 0, 1),
             tile=0.9, tn=tt)
        rbox(F, ox - ns / 2 - 0.012, ox + ns / 2 + 0.012, z - ns / 2 - 0.012, z + ns / 2 + 0.012, h + 0.02, h + 0.045,
             "H_wood_oak", r=0.008, seg=2, tn=tt)
    tube(F, [(ox, 0.05 + ns / 2, h), (ox, length - ns / 2, h)], 0.026, "H_wood_oak", 10, tn=tt, uv_per_m=0.9)
    n = int((length - 0.4) / 0.085)
    for k in range(1, n):
        z = 0.05 + ns + k * (length - ns - 0.05 - 0.3) / n
        rbox(F, ox - 0.007, ox + 0.007, z - 0.007, z + 0.007, 0.0, h - 0.02, "H_metal", r=0.001, seg=1, grain=(0, 0, 1), tn=bk)
    tube(F, [(ox, 0.05 + ns / 2, 0.06), (ox, length - ns / 2, 0.06)], 0.008, "H_metal", 6, tn=bk, caps=False)
    # end guard across the low end of the hole
    zE = 0.05 + ns / 2
    xs0, xs1 = -osx * (hw - 0.0225), ox
    tube(F, [(xs0, zE, h), (xs1, zE, h)], 0.026, "H_wood_oak", 10, tn=tt, uv_per_m=0.9)
    nn = int(abs(xs1 - xs0) / 0.085)
    for k in range(1, nn):
        x = xs0 + (xs1 - xs0) * k / nn
        rbox(F, x - 0.007, x + 0.007, zE - 0.007, zE + 0.007, 0.0, h - 0.02, "H_metal", r=0.001, seg=1, grain=(0, 0, 1), tn=bk)
    rbox(F, min(xs0, xs1) - 0.04, max(xs0, xs1) + 0.04, 0.0 - 0.02, 0.05, -0.0, 0.1, "H_paint", r=0.004, seg=1, tn=PAL["paint_white"])
    # fascia: the slab edge board along the open side of the hole
    rbox(F, ox + osx * 0.0 - 0.025, ox + 0.025, 0.0, full, 0.0, 0.02, "H_wood_oak", r=0.004, seg=1, grain=(0, 1, 0), tn=tt)
    col(F, ox - 0.05, ox + 0.05, 0.0, full, 1.0, name="stair_guard")


def room_shell(F, W=10.6, D=7.8, h=CEILING_HEIGHT, ops=None, hole=None, floor_kind="oak", wall_tn=None, floor_tn=None, lights=((2.6, 3.9), (7.9, 3.9)),
               skip=(), floor_hole=None):
    """One whole room: floor, ceiling (optional stairwell hole), four walls with their openings, baseboards, crown mouldings.
    ops = {"front"|"right"|"back"|"left": [dict(s0, s1, y0, y1)]} in each wall's own frame (wall_frames); returns the frames so
    the caller can place windows / doors / curtains with the same coordinates."""
    ops = ops or {}
    fr = wall_frames(F, W, D)
    wall_tn = wall_tn or PAL["white"]
    if "floor" not in skip:
        if floor_hole is None:
            floor(F, 0, W, 0, D, floor_kind, tn=floor_tn)
        else:                      # the upper floor: the stairwell hole is cut out of it (+ the slab's edge faces down 0.3 m)
            hx0, hx1, hz0, hz1 = floor_hole
            for (a, b, c, d) in ((0, hx0, 0, D), (hx1, W, 0, D), (hx0, hx1, 0, hz0), (hx0, hx1, hz1, D)):
                if b - a > 1e-3 and d - c > 1e-3:
                    floor(F, a, b, c, d, floor_kind, tn=floor_tn)
            for (a, b, c, d, hint) in ((hx0, hz0, hx0, hz1, (1, 0, 0)), (hx1, hz0, hx1, hz1, (-1, 0, 0)), (hx0, hz0, hx1, hz0, (0, 1, 0)),
                                       (hx0, hz1, hx1, hz1, (0, -1, 0))):
                gface(F, [(a, b, 0), (c, d, 0), (c, d, -0.3), (a, b, -0.3)], "H_plaster", (1, 0, 0), 2.5, hint, tn=wall_tn)
    ceiling(F, W, D, h, hole=hole, tn=wall_tn, lights=lights)
    for k, (Wf, ln) in fr.items():
        wall(Wf, ln, h, ops.get(k, []), tn=wall_tn)
    return fr


# ------------------------------------------------------------------------------------------ preview pieces ----
def _wall_demo(F, style="grid", curtain_kind="curtain", W_=3.2, paper=False):
    Wf = F.sub(-W_ / 2, -0.0, 0, 0)
    ops = [dict(s0=0.9, s1=2.3, y0=0.9, y1=2.3)]
    wall(Wf, W_, 3.0, ops, tn=PAL["white"])
    window(Wf, 0.9, 2.3, 0.9, 2.3, style=style, paper=paper)
    if curtain_kind == "curtain":
        curtain(Wf, 0.55, 2.65, 2.55, 0.05)
    floor(F, -W_ / 2, W_ / 2, 0, 1.6, "oak")


def _floor_samples(F, kind="jangpan"):
    floor(F, -1.5, 1.5, -1.0, 1.0, kind)
    if kind == "jangpan":
        wall(F.sub(-1.5, -1.0, 0, 0), 3.0, 1.2, [], tn=PAL["cream"], crown=False)


def _door_demo(F, kind="bath"):
    Wf = F.sub(-1.5, 0, 0, 0)
    if kind == "bath":
        wall(Wf, 3.0, 3.0, [dict(s0=1.0, s1=1.95, y0=0.0, y1=2.13)], tn=PAL["white"])
        bath_door(Wf, 1.0, 1.95, 2.1)
    elif kind == "jungmun":
        wall(Wf, 3.0, 3.0, [dict(s0=0.3, s1=2.7, y0=0.0, y1=2.4)], tn=PAL["white"])
        jungmun(Wf, 0.3, 2.7, 2.4)
    else:
        wall(Wf, 3.0, 3.1, [dict(s0=0.6, s1=2.4, y0=0.0, y1=2.9)], tn=PAL["white"])
        entry_door(Wf, 0.6, 2.4, 2.9)
    floor(F, -1.5, 1.5, 0, 1.5, "oak")


def _stairs_demo(F, kind="1f"):
    if kind == "1f":
        stairs(F.sub(0, -2.7, 0, 0), wall_side="left", open_low=4)
        wall(F.sub(-0.67, 6.0, 0, math.pi / 2 * 1.0 * 0 + math.pi / 2), 8.7, 4.2, [], tn=PAL["white"], crown=False, base=True)
        floor(F, -1.8, 1.8, -2.9, 2.8, "oak")
    else:
        stairs(F.sub(0, -2.7, -FLOOR_HEIGHT, 0), wall_side="left", i_from=10)
        stair_guard_2f(F.sub(0, -2.7, 0, 0), wall_side="left")
        # the upper floor around the hole
        gface(F, [(-2.2, -2.7 - 0.8, 0), (-0.65, -2.7 - 0.8, 0), (-0.65, 2.74, 0), (-2.2, 2.74, 0)], "H_floor_oak", (1, 0, 0), 2.4,
              (0, 0, 1))
        gface(F, [(0.65, -2.7 - 0.8, 0), (2.2, -2.7 - 0.8, 0), (2.2, 2.74, 0), (0.65, 2.74, 0)], "H_floor_oak", (1, 0, 0), 2.4,
              (0, 0, 1))
        gface(F, [(-0.65, 2.74, 0), (0.65, 2.74, 0), (0.65, 4.2, 0), (-0.65, 4.2, 0)], "H_floor_oak", (1, 0, 0), 2.4, (0, 0, 1))
        gface(F, [(-0.65, -3.5, 0), (0.65, -3.5, 0), (0.65, -2.7, 0), (-0.65, -2.7, 0)], "H_floor_oak", (1, 0, 0), 2.4, (0, 0, 1))
        wall(F.sub(-0.67, 5.0, 0, math.pi / 2), 8.7, 2.8, [], tn=PAL["white"], crown=False)


PIECES = [
    dict(name="stairs_1f", fn=_stairs_demo, kw=dict(kind="1f"), ref="08_stairs_2f", cam=dict(az=55, el=14, dist=1.15, dz=0.6)),
    dict(name="stairs_2f_view", fn=_stairs_demo, kw=dict(kind="2f"), ref="08_stairs_2f", cam=dict(az=50, el=40, dist=1.1, ground=-4.2)),
    dict(name="floor_jangpan", fn=_floor_samples, kw=dict(kind="jangpan"), ref="01_ondol_room", cam=dict(az=20, el=35, dist=1.5)),
    dict(name="floor_oak", fn=_floor_samples, kw=dict(kind="oak"), ref="02_modern_living", cam=dict(az=20, el=35, dist=1.5)),
    dict(name="floor_tile", fn=_floor_samples, kw=dict(kind="tile_grey"), ref="16_genkwan", cam=dict(az=20, el=35, dist=1.5)),
    dict(name="floor_maru", fn=_floor_samples, kw=dict(kind="maru"), ref="07_hanok_maru", cam=dict(az=20, el=35, dist=1.5, ground=-0.2)),
    dict(name="window_grid_curtain", fn=_wall_demo, kw=dict(), ref="02_modern_living", cam=dict(az=15, el=10, dist=1.5, dz=0.0)),
    dict(name="window_slide_paper", fn=_wall_demo, kw=dict(style="slide", curtain_kind=None, paper=True), ref="01_ondol_room", cam=dict(az=15, el=10, dist=1.5)),
    dict(name="window_ttisal", fn=_wall_demo, kw=dict(style="ttisal", curtain_kind=None), ref="07_hanok_maru", cam=dict(az=15, el=10, dist=1.5)),
    dict(name="door_bath", fn=_door_demo, kw=dict(kind="bath"), ref="14_bathroom", cam=dict(az=15, el=10, dist=1.6)),
    dict(name="door_jungmun", fn=_door_demo, kw=dict(kind="jungmun"), ref="16_genkwan", cam=dict(az=15, el=10, dist=1.6)),
    dict(name="door_entry", fn=_door_demo, kw=dict(kind="entry"), ref="16_genkwan", cam=dict(az=15, el=10, dist=1.6)),
]
