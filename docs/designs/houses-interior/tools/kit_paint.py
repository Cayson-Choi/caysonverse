"""Real paintings in real frames (owner 2026-11-20: "집안에 액자를 모두 찾아서 유명한 화가들의 그림으로 다 집어 넣어").

Every picture in the houses (frame_art, frame_family, frame_small, art_print / gallery_wall) is now one moulded wooden frame (four
mitred-free butt-jointed bars, a stepped profile and a brass inner fillet; no overlapping faces, so nothing z-fights) round ONE canvas
quad that carries a public-domain painting (art/village/tools/houses/paintings.json: Wikimedia Commons PD-Art / CC0 reproductions,
artists who died before 1954) with the painting's own aspect ratio. The canvas is a light-mapped material `H_art_<id>` (texture
`T_h_art_<id>`: a 128 px copy in the GLB, the game swaps in /textures/houses/<hi|lo>/T_h_art_<id>.webp, 2048 px / 1024 px).

A house gets each painting at most once (`pick`): the one whose aspect is nearest the slot's, in a per-house shuffled order.
"""
import json
import math
import os
import random

import kit_core as K
from kit_core import gface, rbox

HERE = os.path.dirname(os.path.abspath(__file__))
PAINTINGS = json.load(open(os.path.join(HERE, "paintings.json"), encoding="utf-8"))
BY_ID = {p["id"]: p for p in PAINTINGS}
for _p in PAINTINGS:
    K.MATS["H_art_" + _p["id"]] = dict(tex=f"T_h_art_{_p['id']}.png", rough=0.55, coat=0.12)

_STATE = {"house": 0, "used": []}


def set_house(n):
    """called by every house script (kit_fix.set_house / hb_mats.use_wallpaper): a new house starts with no painting hung"""
    _STATE["house"] = n
    _STATE["used"] = []


def used():
    return list(_STATE["used"])


def pick(ar, small=False):
    """the unused painting of this house whose aspect (w / h) is nearest `ar`; the order is a per-house shuffle so houses differ"""
    rnd = random.Random(1000 + _STATE["house"])
    order = PAINTINGS[:]
    rnd.shuffle(order)
    free = [p for p in order if p["id"] not in _STATE["used"]] or order
    best = min(free, key=lambda p: abs(math.log(p["aspect"] / ar)) + (0.0 if p["aspect"] > 0 else 9))
    _STATE["used"].append(best["id"])
    return best


def _bar(F, x0, x1, z0, z1, y0, y1, tn, m="H_wood_oak", r=0.0, skip=("-z",)):
    """one flat-faced bar (no bevel, its face on the wall left out: 10 triangles) — the houses' triangle budget (45k) is tight"""
    rbox(F, x0, x1, z0, z1, y0, y1, m, r=r, seg=1, tn=tn, skip=skip)


def framed(F, w=0.5, h=0.65, frame_tn=None, art=None, mat=None, ar_hint=None):
    """a framed painting (back at z = 0, centred on x = 0, bottom edge of the SLOT at y = 0): the painting is fitted into the slot
    (w x h outer size) keeping its own aspect; the frame hugs it. Returns the (outer w, outer h) actually drawn."""
    ft = frame_tn or (0.45, 0.3, 0.18, 1)
    p = BY_ID[art] if art else pick(w / h)
    ar = p["aspect"]
    f = 0.045 if min(w, h) > 0.5 else (0.034 if min(w, h) > 0.3 else 0.022)      # the moulding's width
    fillet = 0.008
    mt = (0.0 if mat is False else (0.035 if min(w, h) > 0.4 else 0.0))            # a narrow cream slip on the big ones only
    # canvas size: contain-fit the painting into the slot's inner box
    iw, ih = w - 2 * (f + fillet + mt), h - 2 * (f + fillet + mt)
    if iw / ih > ar:
        cw, ch = ih * ar, ih
    else:
        cw, ch = iw, iw / ar
    W, H = cw + 2 * (f + fillet + mt), ch + 2 * (f + fillet + mt)
    y0 = (h - H) / 2                                                               # centred in the slot
    d = 0.035 if min(w, h) > 0.3 else 0.022                                        # frame depth
    x0, x1 = -W / 2, W / 2
    yb, yt = y0, y0 + H
    # the outer bars (butt-jointed: top/bottom run the full width, the sides sit between them)
    _bar(F, x0, x1, 0.0, d, yt - f, yt, ft)
    _bar(F, x0, x1, 0.0, d, yb, yb + f, ft)
    _bar(F, x0, x0 + f, 0.0, d, yb + f, yt - f, ft)
    _bar(F, x1 - f, x1, 0.0, d, yb + f, yt - f, ft)
    # a stepped lip: a lighter raised bar round the inner edge of the moulding, then the brass fillet
    lip = tuple(min(1.0, c * 1.25) for c in ft[:3]) + (1,)
    g = f * 0.45
    _bar(F, x0 + f - g, x1 - f + g, d, d + 0.008, yt - f + 0.0, yt - f + g, lip, r=0.0)
    _bar(F, x0 + f - g, x1 - f + g, d, d + 0.008, yb + f - g, yb + f, lip, r=0.0)
    _bar(F, x0 + f - g, x0 + f, d, d + 0.008, yb + f, yt - f, lip, r=0.0)
    _bar(F, x1 - f, x1 - f + g, d, d + 0.008, yb + f, yt - f, lip, r=0.0)
    brass = (0.85, 0.68, 0.36, 1)
    a0, a1, b0, b1 = x0 + f, x1 - f, yb + f, yt - f
    _bar(F, a0, a1, 0.012, d - 0.004, b1 - fillet, b1, brass, m="H_metal", r=0.0)
    _bar(F, a0, a1, 0.012, d - 0.004, b0, b0 + fillet, brass, m="H_metal", r=0.0)
    _bar(F, a0, a0 + fillet, 0.012, d - 0.004, b0 + fillet, b1 - fillet, brass, m="H_metal", r=0.0)
    _bar(F, a1 - fillet, a1, 0.012, d - 0.004, b0 + fillet, b1 - fillet, brass, m="H_metal", r=0.0)
    ix0, ix1, iy0, iy1 = a0 + fillet, a1 - fillet, b0 + fillet, b1 - fillet
    zc = 0.012
    if mt > 0:
        # the cream slip (one quad, behind the canvas' edge: the canvas quad is in front of it and smaller)
        gface(F, [(ix0, zc, iy0), (ix1, zc, iy0), (ix1, zc, iy1), (ix0, zc, iy1)], "H_paint", (1, 0, 0), 1.0, (0, 1, 0), tn=(0.95, 0.93, 0.87, 1))
        ix0, ix1, iy0, iy1 = ix0 + mt, ix1 - mt, iy0 + mt, iy1 - mt
        zc = 0.016
    # the painting: one quad, uv 0..1 over the whole image (flat, light-mapped)
    gface(F, [(ix0, zc, iy0), (ix1, zc, iy0), (ix1, zc, iy1), (ix0, zc, iy1)], "H_art_" + p["id"], None, 1.0, (0, 1, 0),
          uv=[(0, 0), (1, 0), (1, 1), (0, 1)])
    return W, H
