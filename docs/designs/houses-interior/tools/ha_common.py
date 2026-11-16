"""Helpers shared by h02..h05 (window openings from the outside windows, small props)."""
import math

import kit_fix as FX
import kit_shell as SH

PI = math.pi
# outside window centres on the wall (wall-frame s): front s = x, right s = z, back s = 10.6 - x, left s = 7.8 - z
# exteriorToLocal of the cottage's windows: front x +-2.55 -> 2.68 / 7.92, side z -0.875 -> 4.13, back x -2.2 / 1.8 -> 3.04 / 7.15
STD = dict(front=[2.68, 7.92], left=[7.8 - 4.13], right=[4.13], back=[10.6 - 3.04, 10.6 - 7.15])


def spec(skip=(), width=1.5, extra=None, only=None):
    """standard window spec {wall: [(s_centre, width)]}; skip = [(wall, s_centre)] to drop (hidden behind a stair), extra = additions"""
    out = {}
    for w, lst in STD.items():
        out[w] = [(c, width) for c in lst if not any(sw == w and abs(sc - c) < 0.01 for (sw, sc) in skip)]
    for (w, c, wd) in (extra or []):
        out.setdefault(w, []).append((c, wd))
    return out


def ops_windows(sp, y0=0.95, y1=2.40):
    return {wall: [dict(s0=c - w / 2, s1=c + w / 2, y0=y0, y1=y1) for (c, w) in lst] for wall, lst in sp.items()}


def add_windows(sp, y0=0.95, y1=2.40, style="grid", cols=3, rows=2, curtain=(), curtain_kw=None, window_kw=None):
    wins, curt = [], []
    for wall, lst in sp.items():
        for (c, w) in lst:
            kw = dict(style=style, cols=cols, rows=rows)
            kw.update(window_kw or {})
            wins.append((wall, c - w / 2, c + w / 2, y0, y1, kw))
            if wall in curtain:
                ck = dict(folds=10)
                ck.update(curtain_kw or {})
                curt.append((wall, c - w / 2 - 0.3, c + w / 2 + 0.3, y1 + 0.3, 0.04, ck))
    return wins, curt


def prop_fn(H):
    def P(floor, name, prop, x, z, y, yaw=0.0, **kw):
        H.piece(floor, name, FX.prop, x, z, y, yaw, cols=False, which=prop, **kw)
    return P


def merge(ops, extra):
    """add extra openings {wall: [dict]} to ops and keep them sorted"""
    for w, lst in extra.items():
        ops.setdefault(w, []).extend(lst)
    for w in ops:
        ops[w].sort(key=lambda o: o["s0"])
    return ops


def drop_seat(H, floor, furn="bed", side="min_lz"):
    """a bed against a wall / next to a nightstand keeps only ONE sitting edge (the plan counts one): drop the other of the last
    two `furn` seats of the floor and renumber k / id."""
    seats = [s for s in H.hb.seats if s["floor"] == floor and s["furn"] == furn]
    a, b = seats[-2], seats[-1]
    kill = min((a, b), key=lambda s: s["lz"]) if side == "min_lz" else max((a, b), key=lambda s: s["lz"])
    H.hb.seats.remove(kill)
    k = 0
    for s in H.hb.seats:
        if s["floor"] == floor:
            s["k"] = k
            s["id"] = f"h{H.n}_{floor}_{k}"
            if s["group"].startswith(f"h{H.n}_"):
                s["group"] = s["id"]
            k += 1
