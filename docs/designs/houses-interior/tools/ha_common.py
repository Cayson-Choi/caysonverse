"""Helpers shared by h02..h05 (window openings from the outside windows, small props)."""
import math

import kit_fix as FX
import kit_shell as SH

PI = math.pi
import ext_openings as EO

# window alignment (owner 2026-11-27): the room's windows are the shell's (exterior_windows.json, the Colmar shells), not the old
# cottage's (front 2.68 / 7.92, one side window at z 4.13, back 3.04 / 7.15). Wall frame s: front s = x, right s = z, back s = 10.6 - x,
# left s = 7.8 - z.


def spec(H, floor, skip=(), extra=None):
    """the shell's windows of this floor as {wall: [(s_centre, width, y0, y1)]}, minus the ones the stair stands in front of and any
    skip = [(wall, at)] (`at` = interior x on front / back, z on the sides, as exterior_windows.json gives it)"""
    import hb_common as HB
    out = {}
    for (wall, at, w, y0, y1, kind) in EO.openings(H.n, floor):
        if any(sw == wall and abs(sa - at) < 0.01 for (sw, sa) in skip):
            continue
        if HB.stair_blocks(H, wall, at, w):
            print(f"WINDOWS house {H.n} floor {floor}: {wall} {at} left out (the stair stands there)")
            continue
        out.setdefault(wall, []).append((EO.wall_s(wall, at), w, y0, y1))
    for (w, c, wd, y0, y1) in (extra or []):
        out.setdefault(w, []).append((c, wd, y0, y1))
    for w in ("front", "back", "left", "right"):
        out.setdefault(w, [])
        out[w].sort()
    return out


def ops_windows(sp):
    return {wall: [dict(s0=c - w / 2, s1=c + w / 2, y0=y0, y1=y1) for (c, w, y0, y1) in lst] for wall, lst in sp.items()}


def add_windows(sp, style="grid", cols=3, rows=2, curtain=(), curtain_kw=None, window_kw=None):
    wins, curt = [], []
    for wall, lst in sp.items():
        for (c, w, y0, y1) in lst:
            kw = dict(style=style, cols=cols, rows=rows)
            kw.update(window_kw or {})
            wins.append((wall, c - w / 2, c + w / 2, y0, y1, kw))
            if wall in curtain:
                ck = dict(folds=10)
                ck.update(curtain_kw or {})
                curt.append((wall, c - w / 2 - 0.3, c + w / 2 + 0.3, min(y1 + 0.3, 3.45), 0.04, ck))
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
