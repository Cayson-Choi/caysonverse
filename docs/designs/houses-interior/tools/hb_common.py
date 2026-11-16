"""HB (houses 6-10) helpers on top of house_common.House: the whole room shell with the contract's windows, entry hall (tile, 귀틀,
partitions, glass 중문, floating shoe cabinet), closed bathroom door, alternative ceilings (beams, attic slope), an audit of colliders
against windows / each other, and the review-view list written next to the authoring blend.

    import hb_common as HB
    H = HB.House(6)
    HB.room(H, 1, floor_kind="oak", windows=HB.ext_windows(H, 1, style=...), entry=True, bath=dict(wall="back", c=1.1))
    ...
    HB.done(H, VIEWS)

Local coordinates everywhere (x 0..10.6 left -> right from the door, z 0..7.8 door wall -> back wall, yaw 0 = into the room).
Wall coordinate `c` of an opening: the local x on the front / back walls, the local z on the left / right walls.
"""
import json
import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import house_common as HC  # noqa: E402
import kit_core as K  # noqa: E402
from kit_core import PAL  # noqa: E402
import kit_shell as SH  # noqa: E402
import kit_storage as ST  # noqa: E402
import hb_pieces as HP  # noqa: E402,F401  (patches the heavy kit pieces with lighter ones)
import hb_mats  # noqa: E402,F401

W_, D_ = 10.6, 7.8
PI = math.pi
CEIL = K.CEILING_HEIGHT


class House(HC.House):
    pass


# ----------------------------------------------------------------------------------------------- wall coordinates ---
def wall_s(wall, c):
    """position along the wall's own frame of a local coordinate c (x for front/back, z for left/right)"""
    return {"front": c, "right": c, "back": W_ - c, "left": D_ - c}[wall]


def wall_pt(wall, c, depth=0.0):
    """room-local (x, z) of the point on a wall's room face at coordinate c, `depth` metres into the room"""
    return {"front": (c, depth), "back": (c, D_ - depth), "left": (depth, c), "right": (W_ - depth, c)}[wall]


def wall_yaw(wall):
    """local yaw of a piece standing against the wall, facing into the room"""
    return {"front": 0.0, "back": PI, "left": PI / 2, "right": -PI / 2}[wall]


# ------------------------------------------------------------------------------------------------- exterior windows --
EXT_FRONT_1 = (2.68, 7.92)           # exteriorToLocal of the ground floor's front windows (+-2.55)
EXT_FRONT_2 = (2.68, 5.3, 7.92)      # first floor: -2.55, 0, +2.55
EXT_SIDE = 4.13                      # side windows (z -0.875)
EXT_BACK = (3.03, 7.15)              # back windows (-2.2, 1.8)


def stair_blocks(H, wall, c, w):
    """True if the stair footprint stands against that wall where the window would be (then the window is left out)"""
    f = H.plan["footprint"]
    a0, a1 = c - w / 2 - 0.15, c + w / 2 + 0.15
    if wall == "back":
        return f["maxZ"] > D_ - 0.9 and a0 < f["maxX"] and a1 > f["minX"]
    if wall == "right":
        return f["maxX"] > W_ - 0.9 and a0 < f["maxZ"] and a1 > f["minZ"]
    if wall == "left":
        return f["minX"] < 0.9 and a0 < f["maxZ"] and a1 > f["minZ"]
    return False


def ext_windows(H, floor, w=1.5, y0=0.9, y1=2.5, style="grid", cols=3, rows=2, drape=("curtain", {}), skip=(), only=None, over=None):
    """the contract's windows of this floor as spec dicts (wall, c, w, y0, y1, style, ...), minus the ones the stair stands in front of.
    skip = [(wall, c)] to leave out, only = [(wall, c)] to keep only these, over = {(wall, c): dict(...)} per-window overrides."""
    cand = []
    for c in (EXT_FRONT_1 if floor == 1 else EXT_FRONT_2):
        cand.append(("front", c))
    cand += [("left", EXT_SIDE), ("right", EXT_SIDE)]
    for c in EXT_BACK:
        cand.append(("back", c))
    out = []
    for (wall, c) in cand:
        if (wall, c) in skip or (only is not None and (wall, c) not in only):
            continue
        spec = dict(wall=wall, c=c, w=w, y0=y0, y1=y1, style=style, cols=cols, rows=rows, drape=drape)
        spec.update((over or {}).get((wall, c), {}))
        if spec.get("force") or not stair_blocks(H, wall, spec["c"], spec["w"]):
            out.append(spec)
    return out


# ------------------------------------------------------------------------------------------------------ floor / shell --
def _subtract(rects, cut):
    cx0, cx1, cz0, cz1 = cut
    out = []
    for (x0, x1, z0, z1) in rects:
        if cx1 <= x0 or cx0 >= x1 or cz1 <= z0 or cz0 >= z1:
            out.append((x0, x1, z0, z1))
            continue
        if cx0 > x0:
            out.append((x0, cx0, z0, z1))
        if cx1 < x1:
            out.append((cx1, x1, z0, z1))
        mx0, mx1 = max(x0, cx0), min(x1, cx1)
        if cz0 > z0:
            out.append((mx0, mx1, z0, cz0))
        if cz1 < z1:
            out.append((mx0, mx1, cz1, z1))
    return out


ENTRY_RECT = (3.6, 7.0, 0.0, 1.5)


def draw_floor(F, floor, kind, hole, entry, tn=None, entry_kind="tile_grey", extra=()):
    cuts = [] + list(extra)
    if floor == 1 and entry:
        cuts.append(ENTRY_RECT)
    if floor == 2 and hole:
        cuts.append(hole)
    rects = [(0.0, W_, 0.0, D_)]
    for c in cuts:
        rects = _subtract(rects, c)
    for (x0, x1, z0, z1) in rects:
        if x1 - x0 > 1e-3 and z1 - z0 > 1e-3:
            SH.floor(F, x0, x1, z0, z1, kind, tn=tn)
    if floor == 1 and entry:
        x0, x1, z0, z1 = ENTRY_RECT
        SH.floor(F, x0, x1, z0, z1, entry_kind)
        # 귀틀: the 3 cm board where tile meets the floor (walking plane stays 0)
        SH.threshold(F, x0, x1, z1, depth=0.10)
        for xs in (x0 - 0.10, x1):
            K.rbox(F, xs, xs + 0.10, z0, z1 + 0.10, 0.0, 0.03, "H_wood_walnut", r=0.008, seg=2, tn=(0.8, 0.8, 0.8, 1))
    if floor == 2 and hole:
        hx0, hx1, hz0, hz1 = hole
        for (a, b, c, d, hint) in ((hx0, hz0, hx0, hz1, (1, 0, 0)), (hx1, hz0, hx1, hz1, (-1, 0, 0)), (hx0, hz0, hx1, hz0, (0, 1, 0)),
                                   (hx0, hz1, hx1, hz1, (0, -1, 0))):
            K.gface(F, [(a, b, 0), (c, d, 0), (c, d, -0.3), (a, b, -0.3)], "H_plaster", (1, 0, 0), 2.5, hint, tn=tn or PAL["white"])


def room(H, floor, floor_kind="oak", wall_tn=None, floor_tn=None, windows=(), entry=False, bath=None, doors=(), lights=((2.6, 3.9), (7.9, 3.9)),
         ceiling="flat", ceiling_fn=None, fixtures=(), entry_kind="tile_grey", wall_m="H_plaster", floor_extra=(), extra_ops=None, ceil_tn=None,
         wall_h_fn=None, trim_tn=None, casing_tn=None):
    """the room shell of a floor: floors (with the entry tile / stairwell hole), 4 walls with every opening, windows + curtains, entry door,
    bathroom door; the ceiling by `ceiling` ('flat' | 'none' | callable(F) via ceiling_fn). Returns the piece object."""
    ops = {"front": [], "right": [], "back": [], "left": []}
    for k, v in (extra_ops or {}).items():
        ops[k] += v
    if entry and floor == 1:
        ops["front"].append(dict(s0=4.4, s1=6.2, y0=0.0, y1=2.9))
    if bath:
        bw = bath.get("w", 0.9)
        ops[bath["wall"]].append(dict(s0=wall_s(bath["wall"], bath["c"]) - (bw / 2 if bath["wall"] in ("front", "right") else bw / 2),
                                      s1=wall_s(bath["wall"], bath["c"]) + bw / 2, y0=0.0, y1=2.16))
    for d in doors:
        ops[d["wall"]].append(dict(s0=wall_s(d["wall"], d["c"]) - d["w"] / 2, s1=wall_s(d["wall"], d["c"]) + d["w"] / 2, y0=0.0, y1=d.get("h", 2.6)))
    for w_ in windows:
        s = wall_s(w_["wall"], w_["c"])
        ops[w_["wall"]].append(dict(s0=s - w_["w"] / 2, s1=s + w_["w"] / 2, y0=w_["y0"], y1=w_["y1"]))
    hole = H.hole()
    wall_tn = wall_tn or PAL["white"]

    def fn(F):
        fr = SH.wall_frames(F, W_, D_)
        draw_floor(F, floor, floor_kind, hole, entry, floor_tn, entry_kind, floor_extra)
        if ceiling == "flat":
            SH.ceiling(F, W_, D_, CEIL, hole=hole if floor == 1 else None, m=wall_m, tn=ceil_tn or wall_tn, lights=lights)
        elif ceiling_fn:
            ceiling_fn(F, hole if floor == 1 else None)
        for k, (Wf, ln) in fr.items():
            SH.wall(Wf, ln, CEIL, ops.get(k, []), m=wall_m, tn=wall_tn, base_tn=trim_tn, crown_tn=trim_tn)
        if entry and floor == 1:
            SH.entry_door(fr["front"][0], 4.4, 6.2, 2.9)
        for w_ in windows:
            Wf = fr[w_["wall"]][0]
            s = wall_s(w_["wall"], w_["c"])
            SH.window(Wf, s - w_["w"] / 2, s + w_["w"] / 2, w_["y0"], w_["y1"], style=w_["style"], cols=w_.get("cols", 3), rows=w_.get("rows", 2),
                      paper=w_.get("paper", False), tn=w_.get("tn", casing_tn))
            kind, kw = w_.get("drape") or (None, {})
            if kind == "curtain":
                kw = dict(kw)
                over = kw.pop("over", 0.28)
                tie = kw.pop("tie", 0.42)            # width of each gathered panel (open curtains); 0 = drawn shut
                a0, a1 = s - w_["w"] / 2 - over, s + w_["w"] / 2 + over
                if tie:
                    kw["gap"] = max(0.0, (a1 - a0) / 2 - tie)
                    kw.setdefault("folds", 6)
                SH.curtain(Wf, a0, a1, w_["y1"] + 0.25, 0.04, **kw)
            elif kind == "blind":
                SH.blind_bamboo(Wf, s - w_["w"] / 2 + 0.05, s + w_["w"] / 2 - 0.05, w_["y1"] - 0.02, w_["y0"] + 0.3, **kw)
            elif kind == "vblind":
                SH.vertical_blind(Wf, s - w_["w"] / 2 - 0.1, s + w_["w"] / 2 + 0.1, w_["y1"] + 0.12, w_["y0"] - 0.35, **kw)
        if bath:
            bw = bath.get("w", 0.9)
            s = wall_s(bath["wall"], bath["c"])
            SH.bath_door(fr[bath["wall"]][0], s - bw / 2, s + bw / 2, h=2.1, tn=casing_tn, handle_left=bath.get("handle_left", False))
        for fx in fixtures:
            fx(fr)

    ob = H.piece(floor, "shell", fn)
    H.windows = getattr(H, "windows", {1: [], 2: []})
    H.windows[floor] = list(windows)
    return ob


def stairs(H):
    """H.stairs() with a finished underside: the soffit under the treads is a wood board ceiling (H_plaster is aliased to wood while the stair is drawn),
    the 2F opening gets a wood fascia and a skirting round the shaft, and the shaft below is plastered with a wood floor at -4.0"""
    HP.MAT_ALIAS["H_plaster"] = "H_wood_pine"
    try:
        H.stairs()
    finally:
        HP.MAT_ALIAS.pop("H_plaster", None)
    x0, x1, z0, z1 = H.hole()

    def fn(F):
        t = PAL["white"]
        wood = (0.62, 0.42, 0.28, 1)
        e = 0.015
        for (a, b, c, d, hint) in ((x0 + e, z0 + e, x0 + e, z1 - e, (1, 0, 0)), (x1 - e, z0 + e, x1 - e, z1 - e, (-1, 0, 0)),
                                   (x0 + e, z0 + e, x1 - e, z0 + e, (0, 1, 0)), (x0 + e, z1 - e, x1 - e, z1 - e, (0, -1, 0))):
            K.gface(F, [(a, b, -0.3), (c, d, -0.3), (c, d, -4.0), (a, b, -4.0)], "H_wood_pine", (1, 0, 0), 1.0, hint, tn=wood)
        K.gface(F, [(x0 + e, z0 + e, -4.0), (x1 - e, z0 + e, -4.0), (x1 - e, z1 - e, -4.0), (x0 + e, z1 - e, -4.0)], "H_floor_oak", (0, 1, 0), 2.4, (0, 0, 1))
        # fascia + a nosing board along every edge of the hole (the stair's own rail side keeps its newels, the boards run under them)
        for (a, b, c, d) in ((x0, z0, x0 + 0.05, z1), (x1 - 0.05, z0, x1, z1), (x0, z0, x1, z0 + 0.05), (x0, z1 - 0.05, x1, z1)):
            K.rbox(F, a - 0.02, c + 0.02, b - 0.02, d + 0.02, -0.0, 0.012, "H_wood_oak", r=0.0, seg=1, tn=wood)
            K.rbox(F, a - 0.02, c + 0.02, b - 0.02, d + 0.02, -0.3, -0.0, "H_wood_oak", r=0.0, seg=1, tn=(0.5, 0.34, 0.22, 1), skip=("+y",)) if False else None
    return H.piece(2, "well_shaft", fn, 0, 0, cols=False)


def partition(H, floor, name, wall, c0, c1, at, gaps=(), m="H_wallpaper", tn=None, trim=(0.62, 0.42, 0.28, 1), t=0.12, h=CEIL):
    """interior wall: runs along x (wall='x': z = at, x from c0 to c1) or along z (wall='z': x = at, z from c0 to c1), 12 cm thick, full height, with doorways
    `gaps` = [(g0, g1)] (>= 1.6 m wide, no leaf - a wood door frame instead). Colliders part_<name>_<i> per segment. Wallpaper on both faces, wood skirting + crown."""
    tn = tn or PAL["white"]
    segs, c = [], c0
    for (g0, g1) in sorted(gaps):
        if g0 > c:
            segs.append((c, g0))
        c = g1
    if c < c1:
        segs.append((c, c1))

    def fn(F):
        for i, (a, b) in enumerate(segs):
            if wall == "x":
                K.rbox(F, a, b, at - t / 2, at + t / 2, 0.0, h, m, r=0.0, seg=1, tn=tn, skip=("-y",))
                for sz in (-1, 1):
                    K.rbox(F, a, b, at + sz * (t / 2 + 0.008) - 0.008, at + sz * (t / 2 + 0.008) + 0.008, 0.0, 0.10, "H_wood_oak", r=0.0, seg=1, tn=trim)
                    K.rbox(F, a, b, at + sz * (t / 2 + 0.02) - 0.02, at + sz * (t / 2 + 0.02) + 0.02, h - 0.07, h, "H_wood_oak", r=0.0, seg=1, tn=trim)
                K.col(F, a, b, at - t / 2, at + t / 2, h, name=f"part_{name}_{i}")
            else:
                K.rbox(F, at - t / 2, at + t / 2, a, b, 0.0, h, m, r=0.0, seg=1, tn=tn, skip=("-y",))
                for sx in (-1, 1):
                    K.rbox(F, at + sx * (t / 2 + 0.008) - 0.008, at + sx * (t / 2 + 0.008) + 0.008, a, b, 0.0, 0.10, "H_wood_oak", r=0.0, seg=1, tn=trim)
                    K.rbox(F, at + sx * (t / 2 + 0.02) - 0.02, at + sx * (t / 2 + 0.02) + 0.02, a, b, h - 0.07, h, "H_wood_oak", r=0.0, seg=1, tn=trim)
                K.col(F, at - t / 2, at + t / 2, a, b, h, name=f"part_{name}_{i}")
        # door frame (jamb boards + head) in every doorway
        for (g0, g1) in gaps:
            hd = 2.45
            if wall == "x":
                for (a, b) in ((g0 - 0.05, g0), (g1, g1 + 0.05)):
                    K.rbox(F, a, b, at - t / 2 - 0.01, at + t / 2 + 0.01, 0.0, hd, "H_wood_oak", r=0.0, seg=1, tn=trim, grain=(0, 0, 1))
                K.rbox(F, g0 - 0.05, g1 + 0.05, at - t / 2 - 0.01, at + t / 2 + 0.01, hd, hd + 0.08, "H_wood_oak", r=0.0, seg=1, tn=trim)
                K.rbox(F, g0, g1, at - t / 2, at + t / 2, hd + 0.08, h, m, r=0.0, seg=1, tn=tn, skip=("-y",))
            else:
                for (a, b) in ((g0 - 0.05, g0), (g1, g1 + 0.05)):
                    K.rbox(F, at - t / 2 - 0.01, at + t / 2 + 0.01, a, b, 0.0, hd, "H_wood_oak", r=0.0, seg=1, tn=trim, grain=(0, 0, 1))
                K.rbox(F, at - t / 2 - 0.01, at + t / 2 + 0.01, g0 - 0.05, g1 + 0.05, hd, hd + 0.08, "H_wood_oak", r=0.0, seg=1, tn=trim)
                K.rbox(F, at - t / 2, at + t / 2, g0, g1, hd + 0.08, h, m, r=0.0, seg=1, tn=tn, skip=("-y",))
    return H.piece(floor, "part_" + name, fn, 0, 0)


# --------------------------------------------------------------------------------------------------------- entry hall --
def entry_hall(H, shoe_w=1.3, shoe_side="left", jungmun_open=True):
    """현관: side partitions (x 3.5 / 7.1, 0.1 thick), a transom over the glass 중문 (3-track, stacked open), floating shoe cabinet along
    the left partition, hooks + a small bench-less mat, boots. Colliders: part_entry_l / _r, middoor, shoe cabinet."""
    def fn(F):
        t = PAL["white"]
        for (x0, x1, nm) in ((3.5, 3.6, "part_entry_l"), (7.0, 7.1, "part_entry_r")):
            K.rbox(F, x0, x1, 0.0, 1.5, 0.0, CEIL, "H_plaster", r=0.002, seg=1, tn=t, grain=(0, 0, 1))
            K.col(F, x0, x1, 0.0, 1.5, CEIL, name=nm)
        # skirting on the hall side of the partitions
        K.rbox(F, 3.6, 3.616, 0.0, 1.5, 0.0, 0.10, "H_paint", r=0.003, seg=1, tn=PAL["paint_white"])
        K.rbox(F, 6.984, 7.0, 0.0, 1.5, 0.0, 0.10, "H_paint", r=0.003, seg=1, tn=PAL["paint_white"])
        # transom wall above the 중문 and its glass door (frame in a wall frame at z = 1.5 facing the room)
        K.rbox(F, 3.5, 7.1, 1.45, 1.55, 2.45, CEIL, "H_plaster", r=0.002, seg=1, tn=t)
        Wf = F.sub(3.6, 1.5, 0, 0.0)
        SH.jungmun(Wf, 0.0, 3.4, 2.4)
        K.col(F, 6.3, 7.0, 1.4, 1.6, 2.4, name="middoor")
        # floating shoe cabinet (LED) along the left partition
        G = F.sub(3.6 + 0.16, 0.75 if shoe_w <= 1.3 else 0.8, 0, -PI / 2)
        ST.shoe_cabinet(G, w=shoe_w, d=0.32, h=0.9)
        # hooks + a coat above the cabinet: three brass hooks on a board
        K.rbox(F, 3.6, 3.64, 0.35, 1.2, 1.55, 1.62, "H_wood_oak", r=0.004, seg=1, tn=(0.55, 0.38, 0.26, 1))
        for z in (0.5, 0.78, 1.06):
            K.tube(F, [(3.64, z, 1.585), (3.72, z, 1.585), (3.75, z, 1.62)], 0.006, "H_metal", 6, tn=(0.85, 0.7, 0.4, 1))
        # doormat
        K.rbox(F, 4.7, 5.9, 0.35, 1.0, 0.0, 0.012, "H_rug", r=0.004, seg=1, tn=(0.55, 0.45, 0.35, 1))
    return H.piece(1, "part_entry", fn, 0, 0)


# --------------------------------------------------------------------------------------------------- ceilings ---------
def _downlights(F, pts, h):
    for (lx, lz) in pts:
        K.cyl(F, lx, lz, h - 0.012, h, 0.085, "H_paint", segs=20, tn=PAL["paint_white"], cap=False)
        K.disc(F, lx, lz, h - 0.012, 0.075, "H_lamp", segs=20, down=True)
        K.light(F, "downlight", lx, lz, h - 0.05, 30.0, "#FFE2B8")


def ceiling_slope(F, hole, side="right", run=3.4, low=2.9, m="H_wood_pine", tn=None, skylight=None, lights=None):
    """attic ceiling: white and flat at 3.7 over most of the room; a plank-clad slope falls from 3.7 to `low` at the `side` wall (left | right)
    over `run` metres, with purlins every 0.5 m. skylight = (x0, x1, z0, z1): a hole in the slope with frame + glass (천창)."""
    tn = tn or (0.96, 0.84, 0.66, 1)
    h = CEIL
    W, D = W_, D_
    right = side == "right"
    xw, xb = (W, W - run) if right else (0.0, run)
    flat = (0.0, W - run) if right else (run, W)
    K.gface(F, [(flat[0], 0, h), (flat[1], 0, h), (flat[1], D, h), (flat[0], D, h)], "H_plaster", (1, 0, 0), 2.5, (0, 0, -1), tn=PAL["white"])

    def yy(x):
        return low + (h - low) * abs(x - xw) / run

    def quad(xa_, xb_, za_, zb_):
        if abs(xb_ - xa_) < 1e-3 or abs(zb_ - za_) < 1e-3:
            return
        K.gface(F, [(xa_, za_, yy(xa_)), (xb_, za_, yy(xb_)), (xb_, zb_, yy(xb_)), (xa_, zb_, yy(xa_))], m, (0, 1, 0), 1.0, (0, 0, -1), tn=tn)

    if skylight:
        sx0, sx1, sz0, sz1 = skylight
        lo, hi = sorted((xw, xb))
        quad(lo, sx0, 0, D)
        quad(sx1, hi, 0, D)
        quad(sx0, sx1, 0, sz0)
        quad(sx0, sx1, sz1, D)
        fw = 0.06
        pp = lambda x, z, dy=0.0: (x, z, yy(x) + dy)
        for (a, b, c, d) in ((sx0, sz0, sx1, sz0 + fw), (sx0, sz1 - fw, sx1, sz1), (sx0, sz0, sx0 + fw, sz1), (sx1 - fw, sz0, sx1, sz1)):
            K.gface(F, [pp(a, b), pp(c, b), pp(c, d), pp(a, d)], "H_paint", (1, 0, 0), 1.0, (0, 0, -1), tn=PAL["paint_white"])
        K.gface(F, [pp(sx0 + fw, sz0 + fw, 0.02), pp(sx1 - fw, sz0 + fw, 0.02), pp(sx1 - fw, sz1 - fw, 0.02), pp(sx0 + fw, sz1 - fw, 0.02)], "H_glass", (1, 0, 0), 1.0, (0, 0, -1))
        xm = (sx0 + sx1) / 2
        K.gface(F, [pp(xm - 0.015, sz0 + fw, 0.0), pp(xm + 0.015, sz0 + fw, 0.0), pp(xm + 0.015, sz1 - fw, 0.0), pp(xm - 0.015, sz1 - fw, 0.0)], "H_paint", (1, 0, 0), 1.0, (0, 0, -1),
                tn=PAL["paint_white"])
    else:
        quad(min(xw, xb), max(xw, xb), 0, D)
    z = 0.5
    while z < D - 0.2:
        if not (skylight and skylight[2] - 0.08 < z < skylight[3] + 0.08):
            K.bar(F, (xw, z, low - 0.025), (xb, z, h - 0.025), 0.07, 0.05, "H_wood_pine", up=(0, 0, 1), tn=(0.8, 0.6, 0.42, 1))
        z += 0.5
    _downlights(F, lights or (((2.0, 2.4), (2.0, 5.4)) if right else ((W - 2.0, 2.4), (W - 2.0, 5.4))), h)


def ceiling_hanok(F, hole, beams_z=(2.6, 5.2), pillars_x=(3.3, 7.3), rafter_gap=0.4):
    """대청 ceiling of house 8: no plastered ceiling - two heavy 대들보 along x (bottom 3.5 m, above the camera limit 3.45), square 서까래 on top
    every `rafter_gap`, dark roof boards above, the walls carried up to 4.0 m. The stairwell hole is left open (no rafters over it)."""
    W, D = W_, D_
    dark = (0.42, 0.3, 0.22, 1)
    mid = (0.55, 0.4, 0.3, 1)
    top = 4.0
    for (a, b, c, d, hint) in ((0, 0, W, 0, (0, 1, 0)), (0, D, W, D, (0, -1, 0)), (0, 0, 0, D, (1, 0, 0)), (W, 0, W, D, (-1, 0, 0))):
        K.gface(F, [(a, b, CEIL), (c, d, CEIL), (c, d, top), (a, b, top)], "H_plaster", (1, 0, 0), 2.5, hint, tn=(0.9, 0.86, 0.76, 1))
    rects = [(0.0, W, 0.0, D)]
    if hole:
        rects = _subtract(rects, hole)
    for (x0, x1, z0, z1) in rects:
        K.gface(F, [(x0, z0, top), (x1, z0, top), (x1, z1, top), (x0, z1, top)], "H_wood_oak", (1, 0, 0), 1.0, (0, 0, -1), tn=(0.85, 0.68, 0.5, 1))
    for bz in beams_z:
        K.rbox(F, 0.0, W, bz - 0.17, bz + 0.17, 3.5, 3.92, "H_wood_oak", r=0.012, seg=1, tn=dark, grain=(1, 0, 0), bottom=True)
    x = 0.3
    while x < W - 0.1:
        if not (hole and hole[0] - 0.05 < x < hole[1] + 0.05):
            K.rbox(F, x - 0.045, x + 0.045, 0.0, D, 3.9, 3.99, "H_wood_oak", r=0.0, seg=1, tn=mid, grain=(0, 1, 0), bottom=True)
        x += rafter_gap
    for bz in beams_z:
        for px in pillars_x:
            K.rbox(F, px - 0.24, px + 0.24, bz - 0.2, bz + 0.2, 3.38, 3.5, "H_wood_oak", r=0.008, seg=1, tn=dark, bottom=True)



# -------------------------------------------------------------------------------------------------------- audit ------
def audit(H):
    """print colliders that overlap each other or stand in front of a window (outside window seats / curtains), so a layout slip shows up"""
    import itertools
    cols = [c for c in H.hb.cols if not c[1].startswith(("wall_", "stair"))]
    n = 0
    for f in (1, 2):
        cs = [c for c in cols if c[0] == f]
        for a, b in itertools.combinations(cs, 2):
            if a[2] < b[3] - 0.01 and b[2] < a[3] - 0.01 and a[4] < b[5] - 0.01 and b[4] < a[5] - 0.01:
                print(f"AUDIT overlap floor {f}: {a[1]} x {b[1]}")
                n += 1
        for w_ in getattr(H, "windows", {}).get(f, []):
            wall, c, ww = w_["wall"], w_["c"], w_["w"]
            for k in cs:
                if k[1] in w_.get("allow", ()) or k[6] < 0.8:
                    continue
                x0, x1, z0, z1 = k[2], k[3], k[4], k[5]
                if wall == "front":
                    hit = z0 < 0.55 and x1 > c - ww / 2 and x0 < c + ww / 2
                elif wall == "back":
                    hit = z1 > D_ - 0.55 and x1 > c - ww / 2 and x0 < c + ww / 2
                elif wall == "left":
                    hit = x0 < 0.55 and z1 > c - ww / 2 and z0 < c + ww / 2
                else:
                    hit = x1 > W_ - 0.55 and z1 > c - ww / 2 and z0 < c + ww / 2
                if hit and not k[1].startswith(("part_",)):
                    print(f"AUDIT window {wall}@{c}: blocked by {k[1]} (floor {f})")
                    n += 1
    print("AUDIT done,", n, "issues")
    return n


def aisle_audit(H, minw=1.3, blocked=0.8):
    """G's rule: click-to-walk fails in aisles narrower than ~1.3 m. Lists (1) pairs of colliders / walls that face each other across a gap of
    [blocked, minw) m (a gap below `blocked` is a closed pocket and fine) and (2) seats whose front strip (0.6 m wide, 1.3 m long) is not clear."""
    import itertools
    n = 0
    for f in (1, 2):
        rects = [(c[1], c[2], c[3], c[4], c[5], c[6]) for c in H.hb.cols if c[0] == f and c[6] >= 0.12]
        for a, b in itertools.combinations(rects, 2):
            for (u0, u1, v0, v1, ax) in (("x", "z"),) and ((a[1], a[2], b[1], b[2], "x"),):
                pass
            # gap along x (they overlap in z) and along z (they overlap in x)
            ovz = min(a[4], b[4]) - max(a[3], b[3])
            ovx = min(a[2], b[2]) - max(a[1], b[1])
            gx = max(a[1], b[1]) - min(a[2], b[2])
            gz = max(a[3], b[3]) - min(a[4], b[4])
            def clear_between(x0, x1, z0, z1):
                return not any(r is not a and r is not b and r[1] < x1 - 1e-6 and r[2] > x0 + 1e-6 and r[3] < z1 - 1e-6 and r[4] > z0 + 1e-6 for r in rects)
            if ovz > 0.3 and blocked <= gx < minw:
                x0, x1 = min(a[2], b[2]), max(a[1], b[1])
                z0, z1 = max(a[3], b[3]), min(a[4], b[4])
                if clear_between(x0, x1, z0, z1):
                    print(f"AISLE floor {f}: x gap {gx:.2f} between {a[0]} and {b[0]}")
                    n += 1
            if ovx > 0.3 and blocked <= gz < minw:
                x0, x1 = max(a[1], b[1]), min(a[2], b[2])
                z0, z1 = min(a[4], b[4]), max(a[3], b[3])
                if clear_between(x0, x1, z0, z1):
                    print(f"AISLE floor {f}: z gap {gz:.2f} between {a[0]} and {b[0]}")
                    n += 1
        for st in H.hb.seats:
            if st["floor"] != f or st["furn"] in ("chair", "barstool", "stool", "cushion", "bench") or st["approach"] == "any":
                continue
            sx, sz, ya = st["lx"], st["lz"], st["local_yaw"]
            fx, fz = math.sin(ya), math.cos(ya)
            px, pz = fz, -fx
            own = [r for r in rects if r[1] - 0.05 <= sx <= r[2] + 0.05 and r[3] - 0.05 <= sz <= r[4] + 0.05]
            bad = None
            d = st["edge"] + 0.1
            while d <= st["edge"] + minw and bad is None:
                for w in (-0.3, 0.0, 0.3):
                    x, z = sx + fx * d + px * w, sz + fz * d + pz * w
                    for r in rects:
                        if r in own or r[0].startswith("wall_"):
                            if r[0].startswith("wall_") and r[1] <= x <= r[2] and r[3] <= z <= r[4]:
                                bad = r[0]
                            continue
                        if r[1] <= x <= r[2] and r[3] <= z <= r[4]:
                            bad = r[0]
                    if not (0 < x < W_ and 0 < z < D_):
                        bad = bad or "wall"
                d += 0.1
            if bad:
                print(f"SEATFRONT floor {f}: {st['id']} {st['furn']} front blocked by {bad} within {minw} m (seat {sx:.2f},{sz:.2f} yaw {ya:.2f} edge {st['edge']})")
                n += 1
    print("AISLE audit done,", n, "issues")
    return n


def view_band(H, floor, R=11.0, segs=48):
    """the window view: a cylinder (radius R) round the floor's middle at eye height, material M_view, UV 0..1 over the DAY half of house_N_view.webp (the game
    shows the night half by moving the UV; u: image centre = north). Named view__h<N>_<F>, parented under floor__h<N>_<F>. A 4 x 4 placeholder image
    is bound; the game binds house_N_view.webp."""
    import bmesh
    ox, oz = HC.HCT.origin(H.n, floor)
    cx, cy = ox + 5.3, 3.9 - oz
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    top, bot = 2.0 + R, 2.0 - R
    for i in range(segs):
        a0, a1 = math.pi + 2 * math.pi * i / segs, math.pi + 2 * math.pi * (i + 1) / segs
        pts = [(cx + R * math.sin(a), cy + R * math.cos(a)) for a in (a0, a1)]
        # inward-facing quad
        vs = [bm.verts.new((pts[1][0], pts[1][1], bot)), bm.verts.new((pts[0][0], pts[0][1], bot)), bm.verts.new((pts[0][0], pts[0][1], top)), bm.verts.new((pts[1][0], pts[1][1], top))]
        f = bm.faces.new(vs)
        for lp, (u, v) in zip(f.loops, (((i + 1) / segs, 0.5), (i / segs, 0.5), (i / segs, 1.0), ((i + 1) / segs, 1.0))):
            lp[uv].uv = (u, v)
    me = bpy.data.meshes.new(f"view__h{H.n}_{floor}")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(f"view__h{H.n}_{floor}", me)
    H.coll.objects.link(ob)
    ob["cat"] = "view"
    ob.parent = H.hb.floor_root(floor)
    m = bpy.data.materials.get("M_view") or bpy.data.materials.new("M_view")
    if not m.node_tree.nodes.get("view_tex"):
        nt = m.node_tree
        for x in list(nt.nodes):
            nt.nodes.remove(x)
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        b = nt.nodes.new("ShaderNodeBsdfPrincipled")
        t = nt.nodes.new("ShaderNodeTexImage")
        t.name = "view_tex"
        img = bpy.data.images.new("view_placeholder", 4, 4)
        t.image = img
        uvn = nt.nodes.new("ShaderNodeUVMap")
        uvn.uv_map = "UVMap"
        nt.links.new(uvn.outputs[0], t.inputs["Vector"])
        nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
        nt.links.new(b.outputs[0], out.inputs["Surface"])
    m["export"] = "M_view"
    me.materials.append(m)
    return ob


def done(H, views, out_name=None):
    problems = H.finish()
    for f in (1, 2):
        view_band(H, f)
    audit(H)
    aisle_audit(H)
    for st in H.hb.seats:
        print("SEAT", st["id"], st["furn"], st["kind"], st["pose"], st["approach"], "at", round(st["lx"], 2), round(st["lz"], 2), "y", st["y"], "both", st["both"])
    tris = {}
    for f in (1, 2):
        t = 0
        for ob in H.lm[f]:
            t += K.tri_count(ob)
        tris[f] = t
    print("TRIS floor1", tris[1], "floor2", tris[2], "total", tris[1] + tris[2])
    big = sorted(((K.tri_count(o), o.name) for f in (1, 2) for o in H.lm[f]), reverse=True)[:12]
    print("BIGGEST", big)
    H.save(os.path.join(K.WORK, f"house_{H.n}_authoring.blend"))
    json.dump(views, open(os.path.join(K.WORK, f"house_{H.n}_views.json"), "w", encoding="utf-8"), indent=1)
    return problems
