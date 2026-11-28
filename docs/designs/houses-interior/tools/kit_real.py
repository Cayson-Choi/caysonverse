"""Realism pass (2026-11-17): the everyday things a lived-in Korean home has that the first kit left out. Local frame like every kit
piece: x = right, z = the piece's front (yaw 0 = facing into the room), y up; the back of a wall piece is at z = 0 unless noted.

  aircon_stand    스탠드 에어컨 (타워형): white body, two round fan grilles behind a smoked front, top display; collider
  aircon_wall     벽걸이 에어컨 (bedrooms): slim white body high on a wall, louvre line; no collider (above heads)
  settop          셋톱박스 + 공유기 (on a TV console): a black box with a status light, a white router with two antennas
  soundbar        사운드바 under a TV
  throw_draped    a throw blanket over a sofa back / arm (fabric with fold ridges)
  throw_folded    a folded blanket (bed foot, ottoman, basket)
  dish_rack       식기 건조대 on a counter: steel tray, wire uprights, plates, cups
  rice_cooker     전기밥솥
  microwave       전자레인지
  water_purifier  정수기 (counter top)
  slippers        실내화 pairs (entry)
  stone_fireplace fieldstone chimney breast to the ceiling, firebox with logs and glow, timber mantel, raised hearth (10번 집)
  wall_beams      exposed ceiling beams (log cabin)
  wall_shelf_deco a floating shelf with books / a plant / a frame for an empty wall
  laundry_basket, umbrella_stand, wall_outlet_strip  small lived-in details
"""
import math
import random

from mathutils import Vector

from kit_core import PAL, bar, col, cyl, gface, lathe, light, rbox

WHITE = (0.93, 0.93, 0.92, 1)
OFFWHITE = (0.88, 0.87, 0.85, 1)
BLACK = (0.06, 0.06, 0.065, 1)
STEEL = (0.72, 0.73, 0.74, 1)


def aircon_stand(F, tn=None):
    """스탠드 에어컨 (tower): 0.36 x 0.33 x 1.85 m, the shape of the common Korean tower units (no brand): rounded white body, a darker
    front band with two round fan openings, a slim display strip, a recessed base."""
    tn = tn or WHITE
    w, d, h = 0.36, 0.33, 1.85
    hw, hd = w / 2, d / 2
    rbox(F, -hw + 0.02, hw - 0.02, -hd + 0.02, hd - 0.02, 0.0, 0.06, "H_plastic", r=0.01, seg=1, tn=(0.55, 0.55, 0.56, 1))
    rbox(F, -hw, hw, -hd, hd, 0.06, h, "H_plastic", r=0.05, seg=2, tn=tn)
    # front: a soft grey band with two round grilles (concentric discs), a vertical vent slot below
    rbox(F, -hw + 0.03, hw - 0.03, hd - 0.004, hd + 0.006, 0.86, 1.72, "H_plastic", r=0.02, seg=1, tn=(0.8, 0.81, 0.82, 1))
    for yc in (1.2, 1.5):
        for (r, dz, c) in ((0.115, 0.008, (0.32, 0.33, 0.35, 1)), (0.085, 0.011, (0.2, 0.21, 0.22, 1)), (0.03, 0.014, (0.75, 0.76, 0.77, 1))):
            pts = [(r * math.cos(2 * math.pi * i / 16), hd + dz, yc + r * math.sin(2 * math.pi * i / 16)) for i in range(16)]
            gface(F, pts, "H_plastic", (1, 0, 0), 0.5, (0, 1, 0), tn=c)
    rbox(F, -0.05, 0.05, hd - 0.002, hd + 0.008, 0.25, 0.8, "H_plastic", r=0.01, seg=1, tn=(0.62, 0.63, 0.64, 1))
    rbox(F, -0.06, 0.06, hd, hd + 0.008, 1.76, 1.79, "H_screen", r=0.0, seg=1)
    rbox(F, -0.012, 0.012, hd + 0.008, hd + 0.01, 1.77, 1.78, "H_lamp", r=0.0, seg=1)
    col(F, -hw, hw, -hd, hd, h, name="aircon")


def aircon_wall(F, w=0.9, tn=None):
    """벽걸이 에어컨: body 0.9 x 0.3 (h) x 0.22 (d), lower louvre, a tiny display; mounted with its back at z = 0, bottom at y = 0."""
    tn = tn or WHITE
    hw = w / 2
    rbox(F, -hw, hw, 0.0, 0.2, 0.06, 0.3, "H_plastic", r=0.03, seg=2, tn=tn, bottom=True)
    rbox(F, -hw + 0.03, hw - 0.03, 0.06, 0.205, 0.0, 0.06, "H_plastic", r=0.01, seg=1, tn=(0.8, 0.8, 0.8, 1), bottom=True)
    rbox(F, -hw + 0.04, hw - 0.04, 0.17, 0.215, 0.02, 0.045, "H_plastic", r=0.008, seg=1, tn=(0.9, 0.9, 0.9, 1), bottom=True)
    rbox(F, hw - 0.12, hw - 0.06, 0.2, 0.204, 0.2, 0.22, "H_screen", r=0.0, seg=1)


def settop(F, tn=None):
    """셋톱박스 + 공유기 on a console top (y = 0 = the top)."""
    rbox(F, -0.22, 0.0, -0.08, 0.08, 0.0, 0.04, "H_rubber", r=0.004, seg=1)
    rbox(F, -0.05, -0.04, 0.08, 0.082, 0.015, 0.025, "H_lamp", r=0.0, seg=1)
    rbox(F, 0.06, 0.24, -0.06, 0.07, 0.0, 0.035, "H_plastic", r=0.006, seg=1, tn=WHITE)
    for x in (0.08, 0.22):
        bar(F, (x, -0.05, 0.03), (x, -0.06, 0.2), 0.012, 0.008, "H_plastic", tn=WHITE)


def soundbar(F, w=0.9):
    rbox(F, -w / 2, w / 2, -0.05, 0.05, 0.0, 0.065, "H_rubber", r=0.012, seg=2)
    rbox(F, -w / 2 + 0.02, w / 2 - 0.02, 0.05, 0.052, 0.008, 0.057, "H_fabric", r=0.0, seg=1, tn=(0.12, 0.12, 0.13, 1))


def throw_draped(F, w=0.55, drop_front=0.35, drop_back=0.25, top_d=0.2, tn=None, folds=3):
    """a throw over the top of a sofa back (local y = 0 = the top of the back, z = 0 its middle, front = +z): a soft top with two
    hanging sides, fold ridges down the front drape."""
    tn = tn or PAL["cream"]
    hw = w / 2
    rbox(F, -hw, hw, -top_d / 2, top_d / 2, -0.01, 0.02, "H_fabric", r=0.012, seg=2, tn=tn, puff=0.006)
    rbox(F, -hw * 0.96, hw * 0.98, top_d / 2, top_d / 2 + 0.025, -drop_front, 0.01, "H_fabric", r=0.01, seg=1, tn=tn, tilt=-0.08)
    rbox(F, -hw * 0.94, hw * 0.92, -top_d / 2 - 0.025, -top_d / 2, -drop_back, 0.01, "H_fabric", r=0.01, seg=1, tn=tn)
    for i in range(folds):
        x = -hw + (i + 0.7) * w / (folds + 0.4)
        bar(F, (x, top_d / 2 + 0.03, 0.0), (x + 0.02, top_d / 2 + 0.035, -drop_front + 0.04), 0.025, 0.012, "H_fabric", tn=tn)
    # fringe line at the hem
    rbox(F, -hw * 0.96, hw * 0.98, top_d / 2 + 0.005, top_d / 2 + 0.03, -drop_front - 0.025, -drop_front, "H_fabric", r=0.0, seg=1,
         tn=tuple(c * 0.85 for c in tn[:3]) + (1,))


def throw_folded(F, w=0.5, d=0.32, layers=3, tn=None):
    tn = tn or PAL["cream"]
    t = 0.022
    for i in range(layers):
        k = 1 - i * 0.03
        rbox(F, -w / 2 * k, w / 2 * k, -d / 2 * k, d / 2 * k, i * t, (i + 1) * t, "H_fabric", r=0.009, seg=1, tn=tn, puff=0.003)
    rbox(F, w / 2 - 0.004, w / 2 + 0.012, -d / 2, d / 2, 0.0, layers * t, "H_fabric", r=0.01, seg=1, tn=tuple(c * 0.92 for c in tn[:3]) + (1,))


def dish_rack(F, w=0.46, d=0.3):
    """식기 건조대 on a counter (y = 0 = the counter top): steel drip tray, wire uprights, 4 plates on edge, 2 cups, a cutlery cup."""
    hw, hd = w / 2, d / 2
    rbox(F, -hw, hw, -hd, hd, 0.0, 0.025, "H_metal", r=0.01, seg=1, tn=STEEL)
    for x in (-hw + 0.02, hw - 0.02):
        for z in (-hd + 0.02, hd - 0.02):
            bar(F, (x, z, 0.02), (x, z, 0.2), 0.008, 0.008, "H_metal", tn=STEEL)
    for z in (-hd + 0.02, hd - 0.02):
        bar(F, (-hw + 0.02, z, 0.2), (hw - 0.02, z, 0.2), 0.008, 0.008, "H_metal", tn=STEEL)
    for i in range(4):
        x = -hw + 0.07 + i * 0.045
        rbox(F, x - 0.006, x + 0.006, -0.11, 0.11, 0.03, 0.25, "H_ceramic", r=0.011, seg=1, tn=(0.97, 0.96, 0.93, 1) if i % 2 else (0.85, 0.88, 0.9, 1))
    for (x, z) in ((0.12, -0.07), (0.15, 0.07)):
        cyl(F, x, z, 0.03, 0.13, 0.04, "H_ceramic", segs=10, tn=(0.95, 0.94, 0.9, 1) if x < 0.13 else (0.55, 0.62, 0.7, 1))
    cyl(F, hw - 0.03, -hd + 0.03, 0.025, 0.14, 0.035, "H_metal", segs=8, tn=STEEL, cap=False)
    for k in range(3):
        bar(F, (hw - 0.03 + 0.01 * (k - 1), -hd + 0.03, 0.08), (hw - 0.03 + 0.015 * (k - 1), -hd + 0.035, 0.2), 0.008, 0.004, "H_metal", tn=(0.9, 0.9, 0.9, 1))


def rice_cooker(F, tn=None):
    """전기밥솥: rounded body (r 0.14), a domed lid, a front handle and display, a steam cap."""
    tn = tn or (0.92, 0.91, 0.9, 1)
    lathe(F, 0, 0, 0.0, [(0.0, 0.0), (0.12, 0.0), (0.14, 0.03), (0.145, 0.15), (0.14, 0.2), (0.0, 0.2)], "H_plastic", 14, tn=tn)
    lathe(F, 0, 0, 0.2, [(0.142, 0.0), (0.13, 0.04), (0.08, 0.07), (0.0, 0.075)], "H_plastic", 14, tn=(0.35, 0.33, 0.33, 1))
    rbox(F, -0.05, 0.05, 0.12, 0.155, 0.08, 0.15, "H_screen", r=0.01, seg=1)
    rbox(F, -0.035, -0.005, 0.155, 0.157, 0.11, 0.13, "H_lamp", r=0.0, seg=1)
    bar(F, (-0.06, 0.13, 0.215), (0.06, 0.13, 0.215), 0.025, 0.02, "H_plastic", tn=(0.3, 0.3, 0.3, 1))
    cyl(F, 0.0, -0.04, 0.27, 0.285, 0.02, "H_plastic", segs=8, tn=(0.6, 0.6, 0.6, 1))


def microwave(F, tn=None):
    """전자레인지 (counter top): white body, dark glass door, a control strip on the right."""
    tn = tn or WHITE
    rbox(F, -0.25, 0.25, -0.18, 0.18, 0.0, 0.29, "H_plastic", r=0.012, seg=1, tn=tn)
    rbox(F, -0.23, 0.11, 0.18, 0.186, 0.03, 0.26, "H_screen", r=0.006, seg=1)
    rbox(F, 0.13, 0.23, 0.18, 0.184, 0.03, 0.26, "H_plastic", r=0.0, seg=1, tn=(0.75, 0.75, 0.76, 1))
    rbox(F, 0.155, 0.205, 0.184, 0.187, 0.21, 0.24, "H_screen", r=0.0, seg=1)


def water_purifier(F, tn=None):
    """정수기 (counter top): slim upright body, a top bevel, a faucet nozzle and a drip tray."""
    tn = tn or WHITE
    rbox(F, -0.085, 0.085, -0.2, 0.18, 0.0, 0.42, "H_plastic", r=0.03, seg=2, tn=tn)
    bar(F, (0.0, 0.17, 0.33), (0.0, 0.25, 0.31), 0.03, 0.03, "H_metal", tn=STEEL)
    rbox(F, -0.06, 0.06, 0.12, 0.27, 0.0, 0.02, "H_metal", r=0.006, seg=1, tn=(0.5, 0.5, 0.52, 1))
    rbox(F, -0.04, 0.04, 0.18, 0.183, 0.36, 0.4, "H_screen", r=0.0, seg=1)


def slippers(F, pairs=2, tn=None, spread=0.32):
    """실내화 pairs side by side (toes at +z): a sole and a puffy strap each."""
    cols_ = [tn or (0.55, 0.6, 0.66, 1), (0.82, 0.72, 0.62, 1), (0.6, 0.62, 0.55, 1)]
    for p in range(pairs):
        c = cols_[p % len(cols_)]
        for s in (-1, 1):
            x = (p - (pairs - 1) / 2) * spread + s * 0.06
            rbox(F, x - 0.045, x + 0.045, -0.12, 0.13, 0.0, 0.022, "H_rubber", r=0.011, seg=1, tn=(0.9, 0.9, 0.9, 1))
            rbox(F, x - 0.047, x + 0.047, 0.0, 0.1, 0.02, 0.05, "H_fabric", r=0.011, seg=1, tn=c)


def umbrella_stand(F):
    cyl(F, 0, 0, 0.0, 0.45, 0.1, "H_metal", segs=12, tn=(0.25, 0.26, 0.27, 1), cap=False, bottom=True)
    for (dx, dz, c) in ((0.03, 0.02, (0.15, 0.2, 0.35, 1)), (-0.03, -0.01, (0.6, 0.15, 0.15, 1))):
        bar(F, (dx, dz, 0.05), (dx * 1.6, dz * 1.6, 0.85), 0.035, 0.035, "H_fabric", tn=c)
        bar(F, (dx * 1.6, dz * 1.6, 0.85), (dx * 1.6 + 0.03, dz * 1.6, 0.92), 0.015, 0.015, "H_wood_dark", tn=(0.4, 0.25, 0.15, 1))


def laundry_basket(F, tn=None):
    tn = tn or (0.85, 0.8, 0.7, 1)
    lathe(F, 0, 0, 0.0, [(0.0, 0.0), (0.2, 0.0), (0.23, 0.45), (0.0, 0.45)], "H_rattan", 14, tn=tn)
    rbox(F, -0.16, 0.12, -0.12, 0.14, 0.42, 0.5, "H_fabric", r=0.03, seg=1, tn=(0.85, 0.88, 0.92, 1), puff=0.02)
    col(F, -0.23, 0.23, -0.23, 0.23, 0.5, name="basket")


def wall_shelf_deco(F, w=1.0, shelf_y=1.45, tn=None, seed=0):
    y = shelf_y
    """a floating oak shelf (back at z = 0) with a few books, a small plant and a framed photo: fills an empty wall."""
    tn = tn or (0.8, 0.62, 0.42, 1)
    rbox(F, -w / 2, w / 2, 0.0, 0.22, y, y + 0.035, "H_wood_oak", r=0.004, seg=1, tn=tn, bottom=True)
    x = -w / 2 + 0.06
    book_cols = [(0.55, 0.2, 0.18, 1), (0.2, 0.3, 0.45, 1), (0.85, 0.8, 0.7, 1), (0.3, 0.45, 0.35, 1), (0.9, 0.6, 0.3, 1)]
    for i in range(5 + seed % 3):
        bw = 0.025 + 0.01 * ((i * 7 + seed) % 3)
        bh = 0.17 + 0.04 * ((i * 5 + seed) % 3)
        rbox(F, x, x + bw, 0.03, 0.2, y + 0.035, y + 0.035 + bh, "H_paint", r=0.002, seg=1, tn=book_cols[(i + seed) % 5])
        x += bw + 0.003
    cyl(F, w / 2 - 0.12, 0.11, y + 0.035, y + 0.13, 0.055, "H_terracotta", segs=10, tn=(0.75, 0.45, 0.32, 1))
    for k in range(5):
        a = k * 2 * math.pi / 5
        bar(F, (w / 2 - 0.12, 0.11, y + 0.12), (w / 2 - 0.12 + 0.09 * math.cos(a), 0.11 + 0.07 * math.sin(a), y + 0.24), 0.04, 0.008, "H_leaf",
            tn=(0.45, 0.65, 0.4, 1))
    rbox(F, 0.05, 0.22, 0.04, 0.06, y + 0.035, y + 0.26, "H_wood_dark", r=0.004, seg=1, tn=(0.2, 0.15, 0.12, 1), tilt=0.15)
    rbox(F, 0.07, 0.2, 0.06, 0.063, y + 0.06, y + 0.24, "H_atlas", r=0.0, seg=1)


def split_log(F, a, b, r, seed=0, split=False, segs=9):
    """a firewood log between local points a and b (x, z, y): an irregular round with bark sides (H_bark), sawn ends with growth rings
    (H_endgrain, the disc fills the texture square), optionally split lengthwise (a flat pale face of fresh wood). houses-real pass."""
    rnd = random.Random(seed)
    A, B = Vector(a), Vector(b)
    t = (B - A).normalized()
    e1 = t.cross(Vector((0, 0, 1)))
    if e1.length < 1e-4:
        e1 = Vector((1, 0, 0))
    e1.normalize()
    e2 = e1.cross(t).normalized()
    roll = rnd.uniform(0, 2 * math.pi)
    flat_y = -0.15 * r
    pts2 = []
    for k in range(segs):
        rk = r * rnd.uniform(0.86, 1.08)
        a_ = roll + 2 * math.pi * k / segs
        px, py = math.cos(a_) * rk, math.sin(a_) * rk
        pts2.append((px, max(py, flat_y) if split else py))
    RA = [tuple(A + e1 * p[0] + e2 * p[1]) for p in pts2]
    RB = [tuple(B + e1 * p[0] + e2 * p[1]) for p in pts2]
    L = (B - A).length
    tn = (0.92 + 0.12 * rnd.random(), 0.88 + 0.1 * rnd.random(), 0.82 + 0.1 * rnd.random(), 1)
    per = 0.0
    for k in range(segs):
        k2 = (k + 1) % segs
        seg = math.hypot(pts2[k2][0] - pts2[k][0], pts2[k2][1] - pts2[k][1])
        flat = split and pts2[k][1] <= flat_y + 1e-6 and pts2[k2][1] <= flat_y + 1e-6
        n = e1 * ((pts2[k][0] + pts2[k2][0]) / 2) + e2 * ((pts2[k][1] + pts2[k2][1]) / 2)
        if flat:
            gface(F, [RA[k], RA[k2], RB[k2], RB[k]], "H_wood_oak", tuple(t), 0.6, tuple(n), tn=(1.0, 0.86, 0.66, 1))
        else:
            u0, u1 = per / 0.35, (per + seg) / 0.35
            gface(F, [RA[k], RA[k2], RB[k2], RB[k]], "H_bark", None, 1.0, tuple(n), uv=[(u0, 0), (u1, 0), (u1, L / 0.35), (u0, L / 0.35)], tn=tn)
        per += seg
    rmax = max(math.hypot(*p) for p in pts2) * 1.02
    for R, sgn in ((RA, -1), (RB, 1)):
        uv = [(0.5 + 0.5 * p[0] / rmax, 0.5 + 0.5 * p[1] / rmax) for p in pts2]
        gface(F, R, "H_endgrain", None, 1.0, tuple(t * sgn), uv=uv, tn=(1.0, 0.96, 0.9, 1))


def stone_fireplace(F, w=1.9, d=0.55, h=3.7, firebox_w=0.85, firebox_h=0.75, hearth_y=0.2, tn=None, hearth_d=0.45):
    """돌 벽난로: a fieldstone chimney breast floor to ceiling (back at z = 0, front at z = d), a firebox with a soot-black back, split
    logs and a fire glow, a rough timber mantel at 1.25 m, a raised stone hearth in front. Lights: a warm low fire for the bake."""
    tn = tn or (0.93, 0.91, 0.86, 1)      # cottage pass: a painted mantel surround on a plastered chimney breast
    hw = w / 2
    fw = firebox_w / 2
    y0 = hearth_y
    y1 = y0 + firebox_h
    # stone mass: left / right pillars, the part above the opening, the narrowing chimney above the mantel
    rbox(F, -hw, -fw, 0.0, d, 0.0, 1.25, "H_paint", r=0.02, seg=1, tn=tn)
    rbox(F, fw, hw, 0.0, d, 0.0, 1.25, "H_paint", r=0.02, seg=1, tn=tn)
    rbox(F, -fw, fw, 0.0, d, y1, 1.25, "H_paint", r=0.0, seg=1, tn=tn, bottom=True)
    rbox(F, -fw, fw, 0.0, d, 0.0, y0, "H_paint", r=0.0, seg=1, tn=tn)
    rbox(F, -hw + 0.12, hw - 0.12, 0.0, d - 0.08, 1.37, h, "H_paint", r=0.02, seg=1, tn=tn)
    # firebox (houses-real pass 2026-11-21, refs: real wood-burning fireplaces): a lining of new buff firebricks - back wall, splayed
    # sides, brick floor - a dark flue throat at the top back, a cast-iron grate on four legs with split logs (bark, sawn end grain,
    # pale split faces), a bed of embers under it (the game makes them glow and puts the flames, sparks and fire light over them:
    # client/src/village/houseFire.ts), red facing-brick slips round the opening
    bw = fw * 0.66            # the back wall is narrower than the opening: the splayed sides throw the heat into the room
    zb = 0.06 if d < 0.45 else 0.1     # a shallow chimney breast (HA, d 0.3) keeps a usable firebox: the back wall right at the room wall
    zc = (zb + d) / 2                  # the fire bed's centre (client houseFire.ts EMBERS)
    dd = d - zb
    print(f"FIREPLACE d={d:.3f} hearth_d={hearth_d:.3f} bed z={zc:.3f} w={w:.3f} fw={fw:.3f} y0={y0:.3f}")
    gface(F, [(-bw, zb, y0), (bw, zb, y0), (bw, zb, y1), (-bw, zb, y1)], "H_firebrick", (1, 0, 0), 0.96, (0, 1, 0), tn=(0.98, 0.95, 0.92, 1))
    for s in (-1, 1):
        gface(F, [(s * bw, zb, y0), (s * fw, d, y0), (s * fw, d, y1), (s * bw, zb, y1)], "H_firebrick", (0, 1, 0), 0.96, (-s, 0, 0),
              tn=(0.95, 0.92, 0.89, 1))
    gface(F, [(-bw, zb, y0 + 0.002), (bw, zb, y0 + 0.002), (fw, d, y0 + 0.002), (-fw, d, y0 + 0.002)], "H_firebrick", (1, 0, 0), 0.96, (0, 0, 1),
          tn=(0.9, 0.86, 0.82, 1))
    gface(F, [(-bw, zb, y1), (bw, zb, y1), (fw, d, y1), (-fw, d, y1)], "H_firebrick", (1, 0, 0), 0.96, (0, 0, -1), tn=(0.7, 0.66, 0.62, 1))
    gface(F, [(-bw + 0.06, zb + 0.005, y1 - 0.045), (bw - 0.06, zb + 0.005, y1 - 0.045), (bw - 0.04, zb + 0.005, y1 - 0.005),
              (-bw + 0.04, zb + 0.005, y1 - 0.005)], "H_rubber", (1, 0, 0), 1.0, (0, 1, 0))       # the flue throat
    # facing-brick slips round the opening (sides + a soldier course over it), just proud of the surround
    sw = 0.115
    SLIP = (0.8, 0.56, 0.47, 1)
    rbox(F, -fw - sw, -fw, d, d + 0.012, y0, y1, "H_firebrick", r=0.0, seg=1, tn=SLIP, grain=(1, 0, 0), tile=0.96, skip=("-z",))
    rbox(F, fw, fw + sw, d, d + 0.012, y0, y1, "H_firebrick", r=0.0, seg=1, tn=SLIP, grain=(1, 0, 0), tile=0.96, skip=("-z",))
    rbox(F, -fw - sw, fw + sw, d, d + 0.012, y1, y1 + 0.087 * 2, "H_firebrick", r=0.0, seg=1, tn=SLIP, grain=(1, 0, 0), tile=0.96,
         skip=("-z",))
    # ash and embers under the grate (H_lamp below the ember line: the game's coal shader)
    rbox(F, -bw * 0.95, bw * 0.95, zb + 0.05, d - 0.06, y0, y0 + 0.012, "H_paint", r=0.0, seg=1, tn=(0.5, 0.48, 0.46, 1))
    rr = random.Random(int(abs(w * 1000)) + 3)
    for i in range(7):
        for j in range(3):
            cx = -0.27 + i * 0.09 + rr.uniform(-0.025, 0.025)
            cz = zc + (j - 1) * dd * 0.27 + rr.uniform(-0.015, 0.015)
            sx, sz = rr.uniform(0.03, 0.05), min(rr.uniform(0.025, 0.045), dd * 0.16)
            G = F.sub(cx, cz, 0.0, rr.uniform(0, math.pi))
            rbox(G, -sx, sx, -sz, sz, y0 + 0.01, y0 + rr.uniform(0.03, 0.055), "H_lamp", r=0.008, seg=1)
    # cast-iron grate: front rail, five bars that bend up at the back, four short legs
    gz0, gz1, gy = zb + 0.035, d - 0.025, y0 + 0.085
    IRON = (0.11, 0.105, 0.1, 1)
    for k in range(5):
        x = -0.24 + k * 0.12
        bar(F, (x, gz1, gy), (x, gz0, gy), 0.018, 0.018, "H_metal", tn=IRON)
        bar(F, (x, gz0, gy), (x, gz0 - 0.02, gy + 0.14), 0.018, 0.018, "H_metal", tn=IRON)
    bar(F, (-0.27, gz1, gy + 0.01), (0.27, gz1, gy + 0.01), 0.022, 0.03, "H_metal", tn=IRON)
    bar(F, (-0.27, gz0, gy), (0.27, gz0, gy), 0.018, 0.018, "H_metal", tn=IRON)
    for (x, z) in ((-0.25, gz1), (0.25, gz1), (-0.25, gz0), (0.25, gz0)):
        bar(F, (x, z, y0 + 0.01), (x, z, gy), 0.02, 0.02, "H_metal", tn=IRON)
    # split logs on the grate: two along the grate, one across them leaning back, a split half on the right
    lr = min(0.055, dd * 0.2)
    zf, zr = zc + dd * 0.2, zc - dd * 0.2
    split_log(F, (-0.24, zf, gy + lr), (0.23, zf + 0.01, gy + lr * 0.95), lr, seed=1)
    split_log(F, (-0.22, zr, gy + lr * 0.95), (0.25, zr - 0.01, gy + lr * 0.9), lr * 0.92, seed=2)
    split_log(F, (-0.17, zr - 0.01, gy + lr * 2.1), (0.13, zf + 0.01, gy + lr * 2.3), lr * 0.82, seed=3, split=True)
    split_log(F, (0.05, zr, gy + lr * 2.6), (0.21, zf, gy + lr * 2.0), lr * 0.72, seed=4)
    light(F, "fire", 0.0, 0.45, y0 + 0.25, 60.0, "#FF9A4A")
    # mantel: a rough timber beam, a few things on it
    rbox(F, -hw - 0.08, hw + 0.08, 0.0, d + 0.12, 1.25, 1.37, "H_wood_dark", r=0.012, seg=1, tn=(0.42, 0.28, 0.18, 1), bottom=True)
    # hearth: a raised stone slab in front of the opening
    rbox(F, -hw - 0.05, hw + 0.05, d, d + hearth_d, 0.0, hearth_y, "H_hearth", r=0.012, seg=1, tn=(1.0, 1.0, 1.0, 1), tile=0.9)   # houses-real 2: honed slate tiles (refs: Welsh slate hearths)
    # a round wicker log basket on the hearth beside the opening, split logs stacked in it end-on (houses-real pass)
    bx = -(fw + 0.115 + hw) / 2
    bz = d + hearth_d * 0.5
    br = min(0.17, (hw - fw - 0.115) / 2 - 0.02, hearth_d / 2 - 0.03)
    if br > 0.1:
        G = F.sub(bx, bz, 0.0, 0.0)
        lathe(G, 0, 0, hearth_y, [(br * 0.82, 0.0), (br * 0.95, 0.06), (br, 0.2), (br * 1.04, 0.24), (br * 0.96, 0.245), (br * 0.92, 0.03),
                                  (0.0, 0.03)], "H_rattan", 16, tn=(0.84, 0.68, 0.48, 1))
        rl = random.Random(9)
        for k, (px, py) in enumerate(((-0.06, 0.08), (0.05, 0.08), (0.0, 0.17), (-0.09, 0.17), (0.09, 0.16), (-0.04, 0.25), (0.05, 0.25))):
            lr = rl.uniform(0.038, 0.048)
            if abs(px) + lr > br * 0.98:
                continue
            half = math.sqrt(max(br * br - (abs(px) + lr) ** 2, 0.0)) * 0.95 + 0.02   # inside the round basket's chord, ends just proud of the rim
            split_log(G, (px, -half, hearth_y + py), (px + rl.uniform(-0.01, 0.01), half, hearth_y + py + rl.uniform(-0.01, 0.01)), lr,
                      seed=10 + k, split=(k % 3 == 2))
    col(F, -hw - 0.08, hw + 0.08, 0.0, d + hearth_d, h, name="fireplace")


def mantel_props(F, w=1.6, seed=0):
    """on a mantel top (y = 0): two candlesticks, a framed photo, a small clock, a bowl."""
    for x in (-w / 2 + 0.12, w / 2 - 0.12):
        lathe(F, x, 0.0, 0.0, [(0.0, 0.0), (0.04, 0.0), (0.03, 0.02), (0.012, 0.03), (0.012, 0.16), (0.022, 0.17), (0.0, 0.17)], "H_metal", 8,
              tn=(0.55, 0.42, 0.2, 1))
        cyl(F, x, 0.0, 0.17, 0.27, 0.011, "H_paint", segs=6, tn=(0.96, 0.94, 0.88, 1))
    rbox(F, -0.2, 0.02, -0.04, -0.02, 0.0, 0.26, "H_wood_dark", r=0.004, seg=1, tn=(0.25, 0.18, 0.12, 1), tilt=0.12)
    rbox(F, -0.18, 0.0, -0.02, -0.018, 0.03, 0.24, "H_atlas", r=0.0, seg=1)
    lathe(F, 0.25, 0.05, 0.0, [(0.0, 0.0), (0.06, 0.0), (0.09, 0.05), (0.0, 0.05)], "H_ceramic", 10, tn=(0.55, 0.42, 0.32, 1))


def beams(F, W=10.6, D=7.8, y=3.7, step=1.3, x0=0.0, skip=None, tn=None, size=(0.16, 0.2)):
    """exposed ceiling beams across the room (along z), the ceiling at y; skip = (x0, x1, z0, z1) a stairwell they stop at."""
    tn = tn or (0.45, 0.3, 0.2, 1)
    bw, bh = size
    x = x0 + step / 2
    while x < W - 0.2:
        segs = [(0.0, D)]
        if skip and skip[0] - bw < x < skip[1] + bw:
            segs = [(0.0, skip[2]), (skip[3], D)]
        for (a, b) in segs:
            if b - a > 0.3:
                rbox(F, x - bw / 2, x + bw / 2, a, b, y - bh, y, "H_wood_dark", r=0.012, seg=1, tn=tn, bottom=True)
        x += step


def air_purifier(F, tn=None):
    """공기청정기: a white cylinder (r 0.15, h 0.62) with a grey mesh band, a top grille and a status ring."""
    tn = tn or WHITE
    cyl(F, 0, 0, 0.0, 0.05, 0.14, "H_plastic", segs=14, tn=(0.6, 0.6, 0.62, 1), cap=False)
    cyl(F, 0, 0, 0.05, 0.42, 0.15, "H_fabric", segs=14, tn=(0.72, 0.73, 0.74, 1), cap=False)
    cyl(F, 0, 0, 0.42, 0.62, 0.15, "H_plastic", segs=14, tn=tn)
    cyl(F, 0, 0, 0.62, 0.625, 0.1, "H_screen", segs=14, cap=True)
    col(F, -0.15, 0.15, -0.15, 0.15, 0.62, name="purifier")


def chest_drawers(F, w=1.0, d=0.45, h=0.85, tn=None, rows=4):
    """서랍장: a body on a plinth, rows of drawers with recessed pulls (back at z = -d/2)."""
    tn = tn or (0.93, 0.92, 0.89, 1)
    hw, hd = w / 2, d / 2
    rbox(F, -hw + 0.02, hw - 0.02, -hd + 0.02, hd - 0.03, 0.0, 0.08, "H_paint", r=0.0, seg=1, tn=(0.3, 0.28, 0.26, 1))
    rbox(F, -hw, hw, -hd, hd - 0.02, 0.08, h, "H_paint", r=0.006, seg=1, tn=tn)
    rbox(F, -hw - 0.01, hw + 0.01, -hd, hd + 0.01, h, h + 0.025, "H_wood_oak", r=0.004, seg=1, tn=(0.82, 0.64, 0.44, 1))
    dh = (h - 0.1) / rows
    for i in range(rows):
        y0 = 0.09 + i * dh
        rbox(F, -hw + 0.015, hw - 0.015, hd - 0.02, hd, y0 + 0.006, y0 + dh - 0.006, "H_paint", r=0.004, seg=1, tn=tn)
        rbox(F, -0.12, 0.12, hd, hd + 0.012, y0 + dh - 0.05, y0 + dh - 0.035, "H_metal", r=0.003, seg=1, tn=(0.75, 0.62, 0.4, 1))
    col(F, -hw, hw, -hd, hd + 0.01, h + 0.025, name="drawers")


def placemats(F, spots, tn=None, table=None, w=0.4, d=0.28):
    """woven linen place mats under each place (spots = [(x, z, yaw)] local, y = 0 = the table top).
    polish3 (owner 2026-11-28, house 1: a mat hung half off the table and read as a laptop or a rug): a thin (2.5 mm) linen mat with a
    stitched hem, pulled in so it lies fully on the top 2 cm inside the edge: table = ("rect", half_w, half_d) or ("round", radius) in
    this piece's frame. A mat that cannot fit is left out."""
    tn = tn or (0.78, 0.72, 0.62, 1)
    hem = tuple(c * 0.8 for c in tn[:3]) + (1,)
    hw, hd = w / 2, d / 2

    def inside(x, z, a):
        if table is None:
            return True
        ca, sa = math.cos(a), math.sin(a)
        for (cx, cz) in ((-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd)):
            lx, lz = x + cx * ca + cz * sa, z - cx * sa + cz * ca      # Frame.loc of the sub-frame (x, z, a)
            if table[0] == "rect" and (abs(lx) > table[1] - 0.02 or abs(lz) > table[2] - 0.02):
                return False
            if table[0] == "round" and math.hypot(lx, lz) > table[1] - 0.02:
                return False
        return True

    placed = []
    for (x, z, a) in spots:
        k = 0
        while not inside(x, z, a) and k < 30:          # slide toward the table's middle, 1 cm at a time
            ln = math.hypot(x, z) or 1.0
            x, z = x - 0.01 * x / ln, z - 0.01 * z / ln
            k += 1
        if not inside(x, z, a) or any(math.hypot(x - px, z - pz) < min(w, d) + 0.02 for (px, pz) in placed):
            continue
        placed.append((x, z))
        G = F.sub(x, z, 0.0, a)
        # the hem: the mat's border band in a deeper shade, the field a hair proud of it (large faces only: a thin stitched strip would be
        # under a light-map texel wide and bake dark)
        rbox(G, -hw, hw, -hd, hd, 0.0005, 0.0028, "H_drape", r=0.0, seg=1, tile=0.3, tn=hem)
        rbox(G, -hw + 0.018, hw - 0.018, -hd + 0.018, hd - 0.018, 0.0028, 0.0032, "H_drape", r=0.0, seg=1, tile=0.3, tn=tn, skip=("-y", "+x", "-x", "+z", "-z"))


def table_runner(F, length=1.2, w=0.32, tn=None):
    """a linen table runner along the table's long axis (x), y = 0 = the top, with a stitched hem (polish3: house 1's narrow table)."""
    tn = tn or (0.86, 0.8, 0.7, 1)
    hem = tuple(c * 0.8 for c in tn[:3]) + (1,)
    hl, hw = length / 2, w / 2
    rbox(F, -hl, hl, -hw, hw, 0.0005, 0.0028, "H_drape", r=0.0, seg=1, tile=0.3, tn=hem)
    rbox(F, -hl + 0.022, hl - 0.022, -hw + 0.022, hw - 0.022, 0.0028, 0.0032, "H_drape", r=0.0, seg=1, tile=0.3, tn=tn, skip=("-y", "+x", "-x", "+z", "-z"))


def electric_fan(F, h=1.05, tn=None):
    """선풍기 (stand fan): round base, telescopic pole, motor housing, a wire guard ring with a hub, 5 translucent-blue blades."""
    tn = tn or (0.92, 0.92, 0.9, 1)
    lathe(F, 0, 0, 0.0, [(0.0, 0.0), (0.17, 0.0), (0.16, 0.04), (0.04, 0.06), (0.0, 0.06)], "H_plastic", 14, tn=tn)
    cyl(F, 0, 0, 0.06, h - 0.2, 0.018, "H_plastic", segs=8, tn=tn, cap=False)
    G = F.sub(0, 0.0, h - 0.1, 0)
    rbox(G, -0.06, 0.06, -0.14, 0.02, -0.07, 0.07, "H_plastic", r=0.04, seg=2, tn=tn)
    r = 0.2
    n = 18
    ring = [(r * math.cos(2 * math.pi * i / n), 0.08, r * math.sin(2 * math.pi * i / n)) for i in range(n)]
    from kit_core import tube
    tube(G, ring + [ring[0]], 0.006, "H_plastic", 4, tn=tn, caps=False)
    for k in range(6):
        a = k * math.pi / 3
        tube(G, [(0, 0.1, 0), (r * math.cos(a), 0.08, r * math.sin(a))], 0.003, "H_plastic", 3, tn=tn, caps=False)
    for k in range(5):
        a = k * 2 * math.pi / 5
        pts = [(0.02 * math.cos(a - 0.5), 0.06, 0.02 * math.sin(a - 0.5)), (0.17 * math.cos(a - 0.3), 0.065, 0.17 * math.sin(a - 0.3)),
               (0.17 * math.cos(a + 0.3), 0.065, 0.17 * math.sin(a + 0.3)), (0.02 * math.cos(a + 0.5), 0.06, 0.02 * math.sin(a + 0.5))]
        gface(G, pts, "H_glass", (1, 0, 0), 0.5, (0, 1, 0))
    col(F, -0.18, 0.18, -0.18, 0.18, h, name="fan")


def watering_can(F, tn=None):
    """물뿌리개: a galvanised can, a long spout, a top handle."""
    tn = tn or (0.62, 0.66, 0.64, 1)
    cyl(F, 0, 0, 0.0, 0.22, 0.09, "H_metal", segs=10, tn=tn)
    bar(F, (0.08, 0.0, 0.05), (0.32, 0.0, 0.26), 0.022, 0.022, "H_metal", tn=tn)
    cyl(F, 0.33, 0.0, 0.25, 0.29, 0.03, "H_metal", segs=8, tn=tn)
    bar(F, (-0.07, 0.0, 0.22), (-0.02, 0.0, 0.32), 0.015, 0.02, "H_metal", tn=tn)
    bar(F, (-0.02, 0.0, 0.32), (0.06, 0.0, 0.3), 0.015, 0.02, "H_metal", tn=tn)


def plant_ladder(F, w=0.7, h=1.4, tn=None, seed=2):
    """a leaning ladder plant stand (back at z = 0): three steps with small pots and trailing leaves."""
    tn = tn or (0.62, 0.45, 0.3, 1)
    for x in (-w / 2, w / 2):
        bar(F, (x, 0.35, 0.0), (x, 0.03, h), 0.035, 0.025, "H_wood_oak", tn=tn)
    for k, y in enumerate((0.35, 0.75, 1.1)):
        z = 0.35 - 0.32 * y / h
        rbox(F, -w / 2, w / 2, z - 0.12, z + 0.1, y, y + 0.025, "H_wood_oak", r=0.0, seg=1, tn=tn, bottom=True)
        for j, xx in enumerate((-w / 4, w / 4)):
            if (k + j + seed) % 3 == 2:
                continue
            cyl(F, xx, z, y + 0.025, y + 0.15, 0.065, "H_terracotta", segs=10, tn=(0.75, 0.45, 0.32, 1) if j else (0.9, 0.88, 0.84, 1))
            for q in range(5):
                a = q * 2.4 + k
                bar(F, (xx, z, y + 0.14), (xx + 0.11 * math.cos(a), z + 0.09 * math.sin(a), y + 0.14 + (0.12 if q % 2 else -0.08)), 0.045, 0.008,
                    "H_leaf", tn=(0.4, 0.62, 0.38, 1))
    col(F, -w / 2 - 0.02, w / 2 + 0.02, 0.0, 0.4, h, name="ladder")


def music_stand(F, tn=None):
    """보면대: tripod legs, a pole, a tilted desk with an open score."""
    tn = tn or (0.12, 0.12, 0.13, 1)
    for k in range(3):
        a = k * 2 * math.pi / 3
        bar(F, (0, 0, 0.35), (0.25 * math.cos(a), 0.25 * math.sin(a), 0.0), 0.012, 0.012, "H_metal", tn=tn)
    bar(F, (0, 0, 0.0), (0, 0, 1.05), 0.016, 0.016, "H_metal", tn=tn)
    G = F.sub(0, 0.0, 1.05, 0)
    rbox(G, -0.25, 0.25, -0.01, 0.01, 0.0, 0.32, "H_metal", r=0.0, seg=1, tn=tn, tilt=0.35)
    rbox(G, -0.23, 0.0, 0.012, 0.016, 0.03, 0.31, "H_paper", r=0.0, seg=1, tilt=0.35)
    rbox(G, 0.0, 0.23, 0.012, 0.016, 0.03, 0.31, "H_paper", r=0.0, seg=1, tilt=0.35)
    col(F, -0.25, 0.25, -0.25, 0.25, 1.4, name="stand")


def shop_vac(F, tn=None):
    """집진기 / 청소기 (workshop): a drum on casters with a hose loop."""
    tn = tn or (0.85, 0.65, 0.15, 1)
    cyl(F, 0, 0, 0.05, 0.55, 0.2, "H_plastic", segs=12, tn=tn)
    cyl(F, 0, 0, 0.55, 0.65, 0.17, "H_plastic", segs=12, tn=(0.15, 0.15, 0.16, 1))
    from kit_core import tube
    tube(F, [(0.17, 0.0, 0.5), (0.35, 0.05, 0.6), (0.38, 0.2, 0.3), (0.25, 0.25, 0.05)], 0.025, "H_rubber", 6, caps=False)
    col(F, -0.2, 0.2, -0.2, 0.2, 0.65, name="vac")


def onggi(F, h=0.55, r=0.24, tn=None, lid=True):
    """옹기 항아리: a dark-brown glazed jar with a wide belly, a rolled rim and a domed lid."""
    tn = tn or (0.32, 0.2, 0.13, 1)
    lathe(F, 0, 0, 0.0, [(0.0, 0.0), (r * 0.62, 0.0), (r * 0.9, h * 0.25), (r, h * 0.55), (r * 0.82, h * 0.85), (r * 0.6, h * 0.95),
                         (r * 0.62, h), (0.0, h)], "H_ceramic", 16, tn=tn)
    if lid:
        lathe(F, 0, 0, h - 0.005, [(r * 0.66, 0.0), (r * 0.5, 0.05), (r * 0.12, 0.08), (0.0, 0.09)], "H_ceramic", 16, tn=tuple(c * 0.85 for c in tn[:3]) + (1,))
    col(F, -r, r, -r, r, h + 0.09, name="jar")


def cushion_stack(F, n=4, w=0.5, tn_list=None):
    """spare 방석 stacked (decor; the sitting 방석 are the bangseok pieces)."""
    tn_list = tn_list or [(0.7, 0.3, 0.28, 1), (0.3, 0.36, 0.52, 1), (0.82, 0.66, 0.3, 1), (0.42, 0.56, 0.42, 1)]
    for i in range(n):
        a = 0.08 * ((i * 37) % 5 - 2)
        G = F.sub(0.01 * ((i * 13) % 3 - 1), 0.0, i * 0.075, a)
        rbox(G, -w / 2, w / 2, -w / 2, w / 2, 0.0, 0.075, "H_fabric", r=0.03, seg=2, tn=tn_list[i % len(tn_list)], puff=0.012, cuts=1)
    col(F, -w / 2, w / 2, -w / 2, w / 2, n * 0.075, name="cushions")


# ---- dream show-home styling (owner 2026-11-17: "와 정말 깔끔하고 이쁘고 세련되다") ------------------------------------------------------
BRASS = (0.78, 0.6, 0.32, 1)


def _petal(F, base, a, L, W, prof, m, tn, tn0=None, nu=3, nv=4, cup=0.35):
    """one petal as a smooth curved sheet: from `base` (local x, z, y) out along the angle a; prof(v) -> (r, y) of its midline relative
    to base (v 0 base .. 1 tip), its width W x sin-shaped, its edges cupped toward the flower's axis by `cup` x half-width."""
    ox, oz = math.cos(a), math.sin(a)
    sx, sz = -oz, ox
    grid = []
    for j in range(nv + 1):
        v = j / nv
        r, y = prof(v)
        hw = 0.5 * W * max(0.12, math.sin(math.pi * min(0.96, 0.08 + 0.92 * v)) ** 0.65)
        row = []
        for i in range(nu + 1):
            u = -1.0 + 2.0 * i / nu
            rr = r - cup * hw * u * u
            row.append((base[0] + ox * rr + sx * u * hw, base[1] + oz * rr + sz * u * hw, base[2] + y))
        grid.append(row)
    for j in range(nv):
        t = (j + 0.5) / nv
        c = tn if tn0 is None else tuple(tn0[k] + (tn[k] - tn0[k]) * min(1.0, t * 1.6) for k in range(3)) + (1,)
        for i in range(nu):
            gface(F, [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]], m, None, 1.0, (ox, oz, 0.2), tn=c, smooth=True)


def _tulip(F, top, col, seed):
    """a tulip head at `top`: six cupped tepals (outer three, inner three turned 60 degrees), the cup closing a little at the lips"""
    rnd = random.Random(seed)
    tn0 = tuple(c * 0.8 for c in col[:3])
    for (rm, L, W, off) in ((0.017, 0.056, 0.036, 0.0), (0.013, 0.052, 0.032, math.pi / 3)):
        for k in range(3):
            a = off + k * 2 * math.pi / 3 + rnd.uniform(-0.12, 0.12)
            _petal(F, top, a, L, W, lambda v, rm=rm, L=L: (0.003 + rm * math.sin(math.pi * min(1.0, 0.1 + 0.85 * v)) ** 0.9, L * v), "H_paint",
                   col, tn0, nu=3, nv=4, cup=0.45)


def _rose(F, top, col, seed, r=0.03):
    """an open garden rose: a tight centre and petals opening ring by ring (golden-angle spiral)"""
    rnd = random.Random(seed)
    n = 9
    tn0 = tuple(c * 0.78 for c in col[:3])
    for i in range(n):
        k = i / (n - 1)
        a = i * 2.39996 + rnd.uniform(-0.1, 0.1)
        L = r * (0.6 + 0.6 * k)
        o = 0.15 + 0.75 * k
        _petal(F, top, a, L, L * (0.95 + 0.4 * k), lambda v, L=L, o=o, k=k: (0.002 + r * 0.1 * k + L * v * (0.25 + 0.6 * o),
               L * v * (1.0 - 0.55 * o) * (1.0 - 0.25 * v * o)), "H_paint", col, tn0, nu=3, nv=3, cup=0.5 - 0.3 * k)


def flower_vase(F, tn=None, kind="hydrangea", h=0.3, glass=False):
    """fresh flowers in a vase (y = 0 = the table top). polish3 (owner 2026-11-28, house 1: crude vase and flowers): a smooth round glazed
    vase (or clear glass), real stems arching out of its mouth, and the blooms built from their petals: tulips (six cupped tepals, long
    blue-green leaves), garden roses (spiral of opening petals, small leaves) or hydrangea mop-heads, in the house's colour."""
    from kit_core import tube
    from kit_decor import leaf
    tn = tn or (0.88, 0.72, 0.82, 1)
    vase_m, vase_tn = ("H_glass", None) if glass else ("H_ceramic", (0.94, 0.93, 0.9, 1))
    mouth = 0.045
    lathe(F, 0, 0, 0.0, [(0.0, 0.0), (0.045, 0.0), (0.058, 0.012), (0.068, h * 0.3), (0.066, h * 0.55), (0.052, h * 0.8), (0.042, h * 0.92),
                         (mouth + 0.004, h), (mouth, h + 0.004), (mouth - 0.006, h - 0.01), (0.0, h * 0.8)], vase_m, 28, tn=vase_tn, keep=True)
    rnd = random.Random(int(tn[0] * 100 + tn[1] * 10))
    green = (0.33, 0.5, 0.28, 1)
    if kind == "hydrangea":
        for i in range(4):
            a = i * 2.4 + rnd.uniform(-0.2, 0.2)
            r = 0.03 + 0.08 * rnd.random()
            top = (math.cos(a) * r, math.sin(a) * r, h + 0.12 + 0.12 * rnd.random())
            tube(F, [(0.0, 0.0, h - 0.02), (top[0] * 0.5, top[1] * 0.5, h + (top[2] - h) * 0.6), top], 0.004, "H_leaf", 4, tn=green, caps=False)
            c = tuple(min(1.0, v * (0.9 + 0.2 * rnd.random())) for v in tn[:3]) + (1,)
            # a mop-head: a low dome of floret clusters (polish3: one fabric-textured blob read as a knitted pom-pom)
            lathe(F, top[0], top[1], top[2] - 0.03, [(0.0, 0.0), (0.05, 0.015), (0.058, 0.04), (0.0, 0.05)], "H_paint", 10, tn=tuple(x * 0.82 for x in c[:3]) + (1,), keep=True)
            for q in range(6):
                qa = q * 1.047 + i
                qr = 0.034 if q else 0.0
                cy = top[2] + (0.012 if q else 0.03)
                cc = tuple(min(1.0, x * (0.95 + 0.1 * ((q * 7 + i) % 3) / 2)) for x in c[:3]) + (1,)
                lathe(F, top[0] + qr * math.cos(qa), top[1] + qr * math.sin(qa), cy - 0.012,
                      [(0.0, 0.0), (0.022, 0.006), (0.026, 0.018), (0.016, 0.03), (0.0, 0.034)], "H_paint", 12, tn=cc, keep=True)
        for k in range(4):
            a = k * 1.7
            leaf(F, (math.cos(a) * 0.03, math.sin(a) * 0.03, h + 0.01), (math.cos(a), math.sin(a), 0.35), 0.11, 0.06, droop=0.25, tn=green, segs=3)
        return
    n = 7 if kind == "tulip" else 6
    for i in range(n):
        a = i * 2.39996 + rnd.uniform(-0.2, 0.2)
        spread = (0.03 + 0.075 * ((i + 0.5) / n) ** 0.7) * (1.0 if kind == "tulip" else 0.8)
        tall = h + (0.2 if kind == "tulip" else 0.12) - 0.08 * (i / n) + rnd.uniform(-0.02, 0.02)
        top = (math.cos(a) * spread, math.sin(a) * spread, tall)
        mid = (math.cos(a) * spread * 0.35, math.sin(a) * spread * 0.35, h + (tall - h) * 0.55)
        st = (math.cos(a) * 0.01, math.sin(a) * 0.01, h - 0.02)
        tube(F, [st, mid, top], 0.0032, "H_leaf", 4, tn=green, caps=False)
        c = tuple(min(1.0, v * (0.92 + 0.12 * rnd.random())) for v in tn[:3]) + (1,)
        if kind == "tulip":
            _tulip(F, (top[0], top[1], top[2] - 0.004), c, i + 3)
        else:
            _rose(F, (top[0], top[1], top[2] - 0.004), c, i + 7, r=0.032 + 0.008 * rnd.random())
            leaf(F, mid, (math.cos(a + 1.1), math.sin(a + 1.1), 0.25), 0.045, 0.026, droop=0.12, tn=(0.3, 0.46, 0.26, 1), segs=2)
    if kind == "tulip":
        for k in range(4):
            a = k * 1.57 + 0.4
            leaf(F, (math.cos(a) * 0.02, math.sin(a) * 0.02, h - 0.01), (math.cos(a), math.sin(a), 1.2), 0.17, 0.034, droop=0.55,
                 tn=(0.42, 0.56, 0.4, 1), segs=4, curl=0.22)


def wall_sconce(F, tn=None):
    """a brass wall light with a pleated linen shade (back at z = 0, the arm's foot at y = 0): glows, lit for the bake (warm)."""
    tn = tn or (0.97, 0.93, 0.85, 1)
    rbox(F, -0.04, 0.04, 0.0, 0.012, -0.08, 0.08, "H_metal", r=0.004, seg=1, tn=BRASS)
    bar(F, (0.0, 0.01, 0.0), (0.0, 0.18, 0.08), 0.014, 0.014, "H_metal", tn=BRASS)
    lathe(F, 0.0, 0.18, 0.06, [(0.1, 0.0), (0.06, 0.16)], "H_shade", 12, tn=tn)
    lathe(F, 0.0, 0.18, 0.06, [(0.06, 0.16), (0.1, 0.0)], "H_shade", 12, tn=tn)
    lathe(F, 0.0, 0.18, 0.08, [(0.0, 0.0), (0.025, 0.02), (0.02, 0.06), (0.0, 0.07)], "H_lamp", 8)
    light(F, "sconce", 0.0, 0.25, 0.12, 22.0, "#FFD6A0")


def coffee_styling(F, tn=None, w=0.5):
    """on a coffee / side table top (y = 0): a wooden tray with a candle and a small bud vase, two stacked art books"""
    tn = tn or (0.85, 0.7, 0.75, 1)
    rbox(F, -0.2, 0.2, -0.13, 0.13, 0.0, 0.02, "H_wood_oak", r=0.006, seg=1, tn=(0.55, 0.38, 0.25, 1))
    rbox(F, -0.18, 0.18, -0.11, 0.11, 0.004, 0.025, "H_wood_oak", r=0.0, seg=1, tn=(0.6, 0.42, 0.28, 1), skip=("-y",))
    cyl(F, -0.08, 0.0, 0.02, 0.1, 0.04, "H_paint", segs=10, tn=(0.97, 0.95, 0.9, 1))
    lathe(F, 0.08, 0.0, 0.02, [(0.0, 0.0), (0.035, 0.0), (0.04, 0.05), (0.015, 0.12), (0.02, 0.14), (0.0, 0.14)], "H_ceramic", 10, tn=tn)
    for k, (c, dy) in enumerate((((0.3, 0.38, 0.45, 1), 0.0), ((0.88, 0.85, 0.78, 1), 0.035))):
        rbox(F, w / 2 - 0.05 - 0.28, w / 2 - 0.05, -0.12 + 0.01 * k, 0.1 + 0.01 * k, dy, dy + 0.035, "H_paint", r=0.004, seg=1, tn=c) if w > 0.5 else None


def open_shelves(F, w=1.2, y0=1.45, tn=None):
    """open oak shelves (back at z = 0) on brass brackets, styled: stacks of plates, bowls, jars and mugs in a row, a small plant"""
    tn = tn or (0.72, 0.55, 0.38, 1)
    for k, y in enumerate((y0, y0 + 0.4)):
        rbox(F, -w / 2, w / 2, 0.0, 0.26, y, y + 0.035, "H_wood_oak", r=0.004, seg=1, tn=tn, bottom=True)
        for x in (-w / 2 + 0.12, w / 2 - 0.12):
            bar(F, (x, 0.0, y - 0.15), (x, 0.2, y - 0.005), 0.014, 0.014, "H_metal", tn=BRASS)
        x = -w / 2 + 0.12
        if k == 0:
            for j in range(3):
                cyl(F, x + 0.12 * j * 1.1, 0.13, y + 0.035, y + 0.035 + 0.06 + 0.012 * j, 0.11 - 0.012 * j, "H_ceramic", segs=12,
                    tn=(0.96, 0.95, 0.92, 1) if j % 2 == 0 else (0.75, 0.82, 0.86, 1))
            for j in range(4):
                xm = 0.05 + j * 0.12
                cyl(F, xm, 0.12, y + 0.035, y + 0.135, 0.04, "H_ceramic", segs=8, tn=(0.96, 0.95, 0.92, 1))
        else:
            for j in range(3):
                xm = -w / 2 + 0.15 + j * 0.16
                cyl(F, xm, 0.12, y + 0.035, y + 0.215, 0.055, "H_glass", segs=8)
                cyl(F, xm, 0.12, y + 0.215, y + 0.235, 0.05, "H_wood_oak", segs=8, tn=(0.6, 0.45, 0.3, 1))
            lathe(F, w / 2 - 0.2, 0.12, y + 0.035, [(0.0, 0.0), (0.06, 0.0), (0.07, 0.11), (0.0, 0.11)], "H_terracotta", 8, tn=(0.78, 0.5, 0.36, 1))
            for q in range(5):
                a = q * 1.3
                bar(F, (w / 2 - 0.2, 0.12, y + 0.14), (w / 2 - 0.2 + 0.1 * math.cos(a), 0.12 + 0.08 * math.sin(a), y + 0.24), 0.04, 0.006, "H_leaf",
                    tn=(0.4, 0.6, 0.35, 1))


def console_vignette(F, w=1.2, tn=None, accent=None):
    """an entrance / living-room vignette against a wall (back at z = 0): a slim oak console, a round brass mirror above, a pair of
    linen-shaded lamps, fresh flowers, a stack of books with a bowl — styled like a magazine shoot."""
    tn = tn or (0.72, 0.55, 0.38, 1)
    accent = accent or (0.86, 0.72, 0.78, 1)
    h, d = 0.78, 0.34
    rbox(F, -w / 2, w / 2, 0.0, d, h - 0.04, h, "H_wood_oak", r=0.008, seg=1, tn=tn)
    rbox(F, -w / 2 + 0.06, w / 2 - 0.06, 0.02, d - 0.02, 0.12, 0.15, "H_wood_oak", r=0.004, seg=1, tn=tn)
    for sx in (-1, 1):
        for zz in (0.04, d - 0.04):
            bar(F, (sx * (w / 2 - 0.05), zz, 0.0), (sx * (w / 2 - 0.05), zz, h - 0.04), 0.035, 0.035, "H_wood_oak", tn=tn)
    G = F.sub(0, 0.0, 1.55, 0)
    n = 24
    ring = [(0.36 * math.cos(2 * math.pi * i / n), 0.02, 0.36 * math.sin(2 * math.pi * i / n)) for i in range(n)]
    from kit_core import tube
    tube(G, ring + [ring[0]], 0.016, "H_metal", 6, tn=BRASS, caps=False)
    gface(G, [(0.35 * math.cos(2 * math.pi * i / n), 0.0, 0.35 * math.sin(2 * math.pi * i / n)) for i in range(n)], "H_wood_oak", (1, 0, 0), 1.0, (0, 1, 0), tn=(0.32, 0.22, 0.14, 1))
    gface(G, [(0.335 * math.cos(2 * math.pi * i / n), 0.0185, 0.335 * math.sin(2 * math.pi * i / n)) for i in range(n)], "H_mirror", (1, 0, 0), 1.0, (0, 1, 0))
    for sx in (-1, 1):
        x = sx * (w / 2 - 0.16)
        lathe(F, x, d / 2, h, [(0.0, 0.0), (0.06, 0.0), (0.08, 0.06), (0.05, 0.2), (0.015, 0.26), (0.015, 0.32)], "H_ceramic", 10, tn=(0.95, 0.94, 0.9, 1))
        lathe(F, x, d / 2, h + 0.3, [(0.11, 0.0), (0.08, 0.16)], "H_shade", 12, tn=(0.97, 0.94, 0.87, 1))
        lathe(F, x, d / 2, h + 0.3, [(0.08, 0.16), (0.11, 0.0)], "H_shade", 12, tn=(0.97, 0.94, 0.87, 1))
        light(F, "lamp", x, d / 2, h + 0.38, 22.0, "#FFD6A0")
    flower_vase(F.sub(0.0, d / 2, h, 0.0), tn=accent, kind="hydrangea", h=0.26)
    rbox(F, 0.15, 0.4, 0.06, 0.28, h, h + 0.04, "H_paint", r=0.004, seg=1, tn=(0.3, 0.36, 0.42, 1)) if w >= 1.2 else None
    rbox(F, 0.16, 0.39, 0.07, 0.27, h + 0.04, h + 0.075, "H_paint", r=0.004, seg=1, tn=(0.9, 0.86, 0.78, 1)) if w >= 1.2 else None
    col(F, -w / 2, w / 2, 0.0, d, h, name="console")
