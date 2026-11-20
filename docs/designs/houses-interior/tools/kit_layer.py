"""Layered pass (2026-11-17, coordinator: "one beige tone ... no focal point ... big empty walls"): focal points and dressed walls.
Local frame like every kit piece: x = right, z = the piece's front (yaw 0 = facing into the room), y up; the back of a wall piece is at z = 0.

  art_print        a framed picture: landscape / sea / botanical / still life / soft abstract in flat colour shapes (atlas cells)
  gallery_wall     a group of framed prints of mixed sizes on a common centre line
  mirror_framed    an arched, framed wall mirror
  book_row         a cheap row of books (spine + top faces)
  bookcase_built   a built-in bookcase wall: painted cupboards below, shelves full of books above, cornice
  dresser_crockery a country dresser: painted base, open plate rack with plates on edge and jugs
"""
import math
import random

from kit_core import cyl, col, gface, lathe, rbox

BRASS = (0.78, 0.6, 0.32, 1)


def _acell(i):
    r, c = divmod(i % 64, 8)
    return ((c + 0.5) / 8, 1 - (r + 0.5) / 8)


def _poly(F, pts, cell, z):
    gface(F, [(x, z, y) for (x, y) in pts], "H_atlas", None, 1.0, (0, 1, 0), uv=[_acell(cell)] * len(pts))


def _sh(tn, k):
    return tuple(min(1.0, c * k) for c in tn[:3]) + (1,)


def art_print(F, w=0.5, h=0.65, kind="landscape", seed=0, frame_tn=None, mat=True):
    """a framed picture on a wall (back at z = 0, bottom edge at y = 0): since 2026-11-20 a real public-domain painting in a moulded frame
    (kit_paint.py); `kind` and `seed` are kept for the old call sites. The old flat colour polygons overlapped and z-fought."""
    import kit_paint as KP
    KP.framed(F, w, h, frame_tn=frame_tn or (0.45, 0.3, 0.18, 1), mat=mat)


def gallery_wall(F, w=2.0, seed=0, frame_tn=None):
    """framed prints of mixed sizes (back at z = 0, the group's bottom at y = 0, ~0.9 m tall): a big piece flanked by pairs."""
    kinds = ["landscape", "botanical", "still", "sea", "abstract", "botanical", "landscape"]
    frames = [frame_tn or (0.45, 0.3, 0.18, 1), (0.08, 0.08, 0.085, 1), (0.62, 0.46, 0.2, 1)]
    if w >= 1.9:
        layout = [(0.0, 0.08, 0.62, 0.8), (-0.62, 0.48, 0.42, 0.42), (-0.62, 0.0, 0.42, 0.4), (0.62, 0.5, 0.42, 0.4), (0.62, 0.02, 0.42, 0.42)]
        if w >= 2.6:
            layout += [(-1.08, 0.24, 0.32, 0.42), (1.08, 0.22, 0.32, 0.44)]
    elif w >= 1.3:
        layout = [(0.0, 0.06, 0.5, 0.66), (-0.48, 0.2, 0.34, 0.42), (0.48, 0.2, 0.34, 0.42)]
    else:
        fw = min(0.6, w - 0.1)
        layout = [(0.0, 0.0, fw, min(0.8, fw * 1.3))]
    ext = 2 * max(abs(cx) + fw / 2 for (cx, by, fw, fh) in layout)
    k = min(1.22 if w >= 1.9 else 1.12, w / ext)          # a gallery sized for the 3.7 m rooms, never wider than its wall
    layout = [(cx * k, by * k, fw * k, fh * k) for (cx, by, fw, fh) in layout]
    for i, (cx, by, fw, fh) in enumerate(layout):
        art_print(F.sub(cx, 0.0, by, 0.0), w=fw, h=fh, kind=kinds[(i + seed) % len(kinds)], seed=seed * 7 + i,
                  frame_tn=frames[(i + seed) % len(frames)], mat=fw > 0.36)


def mirror_framed(F, w=0.7, h=0.95, tn=None, arched=True):
    """a framed wall mirror (back at z = 0, bottom at y = 0): a gilt frame with an arched top, a pale silvered glass"""
    tn = tn or (0.68, 0.52, 0.26, 1)
    n = 10
    top = ([(w / 2 * math.cos(math.pi * i / n), h - w / 2 + w / 2 * math.sin(math.pi * i / n)) for i in range(n + 1)] if arched
           else [(w / 2, h), (-w / 2, h)])
    outline = [(-w / 2, 0.0), (w / 2, 0.0)] + top
    k = (w / 2 - 0.05) / (w / 2)
    inner = [(x * k, 0.05 + y * (h - 0.1) / h) for (x, y) in outline]
    gface(F, [(x, 0.03, y) for (x, y) in outline], "H_wood_oak", (1, 0, 0), 1.0, (0, 1, 0), tn=tn)
    gface(F, [(x, 0.034, y) for (x, y) in inner], "H_mirror", (1, 0, 0), 1.0, (0, 1, 0))
    for i in range(len(outline)):
        (ax, ay), (bx, by) = outline[i], outline[(i + 1) % len(outline)]
        mx, my = (ax + bx) / 2, (ay + by) / 2
        gface(F, [(ax, 0.0, ay), (bx, 0.0, by), (bx, 0.03, by), (ax, 0.03, ay)], "H_wood_oak", (1, 0, 0), 1.0, (mx, 0.0, my - h / 2), tn=tn)


def book_row(F, x0, x1, y, depth=0.24, hmax=0.3, seed=1, tns=None):
    """a row of books (spines toward +z): spine and top faces only, varied height / thickness / colour, now and then a small vase"""
    rnd = random.Random(seed)
    tns = tns or [(0.45, 0.08, 0.07, 1), (0.08, 0.13, 0.3, 1), (0.1, 0.22, 0.13, 1), (0.62, 0.48, 0.28, 1), (0.82, 0.76, 0.64, 1),
                  (0.25, 0.14, 0.08, 1), (0.55, 0.28, 0.1, 1), (0.16, 0.16, 0.18, 1), (0.68, 0.36, 0.32, 1), (0.88, 0.84, 0.74, 1)]
    x = x0
    while x < x1 - 0.03:
        if rnd.random() < 0.05 and x < x1 - 0.3:
            lathe(F, x + 0.06, depth * 0.5, y, [(0.0, 0.0), (0.04, 0.0), (0.05, 0.08), (0.02, 0.14), (0.0, 0.14)], "H_ceramic", 6,
                  tn=rnd.choice([(0.9, 0.88, 0.82, 1), (0.4, 0.55, 0.6, 1)]))
            x += 0.14
            continue
        th = rnd.uniform(0.022, 0.045)
        hh = rnd.uniform(0.62, 1.0) * hmax
        rbox(F, x, x + th - 0.002, depth * 0.1, depth, y, y + hh, "H_paint", r=0.0, seg=1, tn=rnd.choice(tns), skip=("-z", "-y", "-x"))
        x += th


def bookcase_built(F, w=2.0, h=2.6, d=0.36, tn=None, seed=4, cupboard=0.8):
    """a built-in bookcase wall (back at z = 0): painted panelled cupboards below with brass knobs, open shelves above full of books
    with a few styled shelves, a cornice at the top."""
    tn = tn or (0.95, 0.94, 0.9, 1)
    hw = w / 2
    bays = max(1, int(round(w / 0.9)))
    bw = w / bays
    rbox(F, -hw, hw, 0.0, d, 0.0, 0.08, "H_paint", r=0.0, seg=1, tn=_sh(tn, 0.85), skip=("-z",))
    rbox(F, -hw, hw, 0.0, d + 0.02, cupboard - 0.03, cupboard, "H_wood_oak", r=0.0, seg=1, tn=(0.55, 0.4, 0.28, 1), skip=("-z",))
    gface(F, [(-hw, 0.02, cupboard), (hw, 0.02, cupboard), (hw, 0.02, h - 0.12), (-hw, 0.02, h - 0.12)], "H_paint", (1, 0, 0), 1.0, (0, 1, 0),
          tn=_sh(tn, 0.72))
    for i in range(bays + 1):
        x = -hw + i * bw
        rbox(F, max(-hw, x - 0.02), min(hw, x + 0.02), 0.02, d, 0.08, h - 0.12, "H_paint", r=0.0, seg=1, tn=tn, skip=("-z",))
    for i in range(bays):
        xa, xb = -hw + i * bw + 0.02, -hw + (i + 1) * bw - 0.02
        rbox(F, xa, xb, d - 0.02, d, 0.08, cupboard - 0.03, "H_paint", r=0.0, seg=1, tn=tn, skip=("-z",))
        for k in range(2):
            pa, pb = (xa + 0.06, (xa + xb) / 2 - 0.03) if k == 0 else ((xa + xb) / 2 + 0.03, xb - 0.06)
            rbox(F, pa, pb, d, d + 0.008, 0.16, cupboard - 0.1, "H_paint", r=0.0, seg=1, tn=_sh(tn, 0.9), skip=("-z", "-y"))
            cyl(F, (xa + xb) / 2 + (-0.05 if k == 0 else 0.05), d + 0.02, 0.5, 0.52, 0.012, "H_metal", segs=6, tn=BRASS)
        n = max(1, int((h - 0.12 - cupboard) / 0.36))
        gap = (h - 0.12 - cupboard) / n
        for k in range(n):
            y = cupboard + k * gap
            if k > 0:
                rbox(F, xa, xb, 0.02, d - 0.01, y, y + 0.025, "H_paint", r=0.0, seg=1, tn=tn, skip=("-z",))
            if (k + i) % 4 == 3:
                lathe(F, xa + 0.13, d * 0.55, y + 0.025, [(0.0, 0.0), (0.05, 0.0), (0.07, 0.1), (0.03, 0.2), (0.035, 0.24), (0.0, 0.24)],
                      "H_ceramic", 8, tn=(0.42, 0.56, 0.62, 1))
                rbox(F, xb - 0.3, xb - 0.05, 0.04, 0.06, y + 0.025, y + 0.29, "H_wood_oak", r=0.0, seg=1, tn=(0.3, 0.22, 0.15, 1), tilt=0.1)
                book_row(F, xa + 0.26, xb - 0.33, y + 0.025, depth=d - 0.06, hmax=min(0.3, gap - 0.06), seed=seed * 31 + i * 7 + k)
            else:
                book_row(F, xa + 0.01, xb - 0.01, y + 0.025, depth=d - 0.06, hmax=min(0.31, gap - 0.05), seed=seed * 31 + i * 7 + k)
    rbox(F, -hw - 0.03, hw + 0.03, 0.0, d + 0.05, h - 0.12, h, "H_paint", r=0.0, seg=1, tn=tn, skip=("-z",))
    col(F, -hw - 0.03, hw + 0.03, 0.0, d + 0.05, h, name="bookcase", camera=True)


def dresser_crockery(F, w=1.5, d=0.46, tn=None, seed=2):
    """a country dresser (back at z = 0): a painted base with cupboards, an open plate rack above with plates on edge and jugs on top."""
    rnd = random.Random(seed)
    tn = tn or (0.62, 0.72, 0.68, 1)
    hw = w / 2
    wood = (0.6, 0.44, 0.3, 1)
    rbox(F, -hw, hw, 0.0, d, 0.0, 0.86, "H_paint", r=0.0, seg=1, tn=tn, skip=("-z",))
    rbox(F, -hw - 0.02, hw + 0.02, 0.0, d + 0.03, 0.86, 0.9, "H_wood_oak", r=0.0, seg=1, tn=wood, skip=("-z",))
    for i in range(3):
        xa, xb = -hw + 0.05 + i * (w - 0.1) / 3, -hw + 0.05 + (i + 1) * (w - 0.1) / 3
        rbox(F, xa + 0.01, xb - 0.01, d, d + 0.01, 0.62, 0.8, "H_paint", r=0.0, seg=1, tn=_sh(tn, 0.92), skip=("-z", "-y"))
        rbox(F, xa + 0.01, xb - 0.01, d, d + 0.01, 0.1, 0.56, "H_paint", r=0.0, seg=1, tn=_sh(tn, 0.92), skip=("-z", "-y"))
        cyl(F, (xa + xb) / 2, d + 0.02, 0.7, 0.72, 0.013, "H_metal", segs=6, tn=BRASS)
    dr = 0.24
    for sx in (-1, 1):
        rbox(F, sx * hw - (0.03 if sx > 0 else 0.0), sx * hw + (0.03 if sx < 0 else 0.0), 0.0, dr, 0.9, 2.2, "H_paint", r=0.0, seg=1, tn=tn, skip=("-z",))
    gface(F, [(-hw, 0.01, 0.9), (hw, 0.01, 0.9), (hw, 0.01, 2.2), (-hw, 0.01, 2.2)], "H_paint", (1, 0, 0), 1.0, (0, 1, 0), tn=_sh(tn, 0.8))
    rbox(F, -hw - 0.04, hw + 0.04, 0.0, dr + 0.06, 2.2, 2.28, "H_paint", r=0.0, seg=1, tn=tn, skip=("-z",))
    plates = [(0.95, 0.95, 0.92, 1), (0.42, 0.56, 0.72, 1), (0.95, 0.95, 0.92, 1), (0.8, 0.5, 0.42, 1)]
    for k, y in enumerate((1.25, 1.65, 2.0)):
        rbox(F, -hw + 0.03, hw - 0.03, 0.0, dr, y, y + 0.022, "H_paint", r=0.0, seg=1, tn=tn, skip=("-z",))
        if k < 2:
            r_ = 0.12 if k == 0 else 0.1
            x = -hw + 0.06 + r_
            while x < hw - 0.06 - r_:
                n = 10
                gface(F.sub(x, 0.06, y + 0.022 + r_, 0.0), [(r_ * math.cos(2 * math.pi * i / n), 0.0, r_ * math.sin(2 * math.pi * i / n)) for i in range(n)],
                      "H_ceramic", (1, 0, 0), 1.0, (0, 1, 0), tn=rnd.choice(plates))
                x += 2 * r_ + 0.03
            rbox(F, -hw + 0.03, hw - 0.03, 0.08, 0.1, y + 0.05, y + 0.07, "H_wood_oak", r=0.0, seg=1, tn=wood)
        else:
            for j in range(4):
                xm = -hw + 0.2 + j * (w - 0.4) / 3
                lathe(F, xm, dr * 0.5, y + 0.022, [(0.0, 0.0), (0.05, 0.0), (0.06, 0.1), (0.04, 0.16), (0.045, 0.19), (0.0, 0.19)], "H_ceramic", 8,
                      tn=rnd.choice(plates))
    col(F, -hw, hw, 0.0, d + 0.03, 2.28, name="dresser", camera=True)
