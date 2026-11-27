"""케이슨 카페 — the café's furniture and goods (pure python on b1_geom / b1_parts), shared by the ground-floor room and the upstairs
salon (cafe_room_kit.py). Built after real European café / pâtisserie interiors (research 2026-11-21, tmpshots/cafe-real/refs: Parisian
and Alsatian salons de thé, a La Marzocco Linea two-group machine, a Mazzer grinder, curved-glass pastry cases, Thonet No.14 bentwood
chairs and bar stools, Carrara-topped bistro tables on cast-iron pedestals, brass dome and opal globe pendants, chalk menus, open oak
back-bar shelves of cups and jars, upholstered banquettes, a wooden half-turn stair), brand-new and clean (village style: a foreign
fairytale village, real textures, no weathering).

Everything with a picture on it (marble, the menus, the pastries, labels, prints, the gauge) maps the café's own atlas `M_cafe_art`
(cafe_art.mjs; cells in cafe_art_atlas.json); the rest are the PBR library's sets with COLOR_0 tints.
"""
import json
import math
import os

import b1_geom as G
import b1_parts as P
from b1_geom import Mesh, S

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "cafe_art_atlas.json"), encoding="utf-8") as _f:
    ATLAS = json.load(_f)
AW, AH = ATLAS["size"]
CELLS = ATLAS["cells"]
PHONE = False


def seg(pc, phone=None):
    """Round sections: fewer on the phone."""
    return (phone if phone is not None else max(6, int(pc * 0.5))) if PHONE else pc


# ------------------------------------------------------------------------------------------------ surfaces --

def hx(h):
    return G.hexc(h)


ART = S("M_cafe_art")
FLOOR = S("LM_cafe_floor")
PLASTER = S("LM_cafe_plaster", hx("F5EBDC"))
CEIL = S("LM_cafe_plaster", hx("FBF5EA"))
OAK = S("LM_cafe_oak", hx("E2C29A"))            # natural oak (treads, shelves, beams' faces)
OAK_DK = S("LM_cafe_oak", hx("9C6E48"))         # stained oak (beams, frames, the stair's rail)
BEECH = S("LM_cafe_oak", hx("7A4A2C"))          # bentwood: steam-bent beech in a walnut stain
PAINT = S("LM_cafe_paint", hx("F3EEE3"))        # cream painted joinery (risers, window frames inside, skirting)
SAGE = S("LM_cafe_paint", hx("7E9A86"))         # the wainscot
GREEN = S("LM_cafe_paint", hx("3D6A55"))        # the counter's panelled front, the sign's frame
DARK = S("LM_cafe_paint", hx("2A2C2E"))         # window frames, toe kicks
CHROME = S("LM_cafe_metal", hx("E9ECEF"))       # stainless / chrome (aluminium_brushed, metal)
STEEL_DK = S("LM_cafe_metal", hx("7B8085"))
BRASS = S("LM_cafe_metal", hx("E2BE72"))        # brass: the brushed set (metal) tinted gold, it takes the room's reflection
GILT = S("LM_cafe_metal", hx("F0CF86"))
IRON = S("LM_cafe_iron", hx("2F3133"))          # black cast iron
BLACK = S("LM_cafe_paint", hx("1C1C1E"))
TILE = S("LM_cafe_tile", hx("FAF8F2"))          # metro tiles behind the back bar
VELVET = S("LM_cafe_fabric", hx("2F5A50"))      # deep teal velvet (banquette)
VELVET_UP = S("LM_cafe_fabric", hx("1F4F5A"))   # the salon's sofa: petrol blue
MUSTARD = S("LM_cafe_fabric", hx("C99A3A"))     # wing chairs
LINEN = S("LM_cafe_fabric", hx("F5EEDF"))       # curtains
LEAF = S("LM_cafe_leaf", hx("6FA052"))
# the vases' petals (flora.py): their own smooth plaster material so the game gives them a flower's translucent fill (LotRoom.tsx
# `_petal`), as the church's altar flowers (props round 3, 2026-11-27); their colour is the vertex colour (base-to-tip gradient)
PETAL = S("LM_cafe_petal")
LEAF_DK = S("LM_cafe_leaf", hx("3E7A38"))
TERRA = S("LM_cafe_plaster", hx("C8734A"))      # terracotta pots
SOIL = S("LM_cafe_floor", hx("3A2A20"))
WALLPAPER = S("LM_cafe_paper", hx("E8EFE6"))    # the salon's walls above the dado
GLASS = S("M_glass")
GARDEN = S("M_garden")
LAMP = P.LAMP
GLOW = P.GLASS.t(P.LAMP)

MATS = {
    "LM_cafe_floor": {"set": "floor_wood", "rough": 0.75},
    "LM_cafe_plaster": {"set": "plaster_painted"},
    "LM_cafe_oak": {"set": "wood_oak", "rough": 0.6},
    "LM_cafe_paint": {"set": "wood_painted", "normal": 0.4, "rough": 0.7},
    "LM_cafe_metal": {"set": "aluminium_brushed", "metal": True, "rough": 0.28},
    "LM_cafe_iron": {"set": "cast_iron", "metal": True, "rough": 0.55},
    "LM_cafe_tile": {"set": "tile_white", "rough": 0.5},
    "LM_cafe_fabric": {"set": "fabric_upholstery", "gain": (2.6, 2.6, 2.6)},
    "LM_cafe_leaf": {"set": "grass", "normal": 0.5},
    "LM_cafe_petal": {"set": "plaster_painted", "rough": 0.6},
    "M_glass": {"glass": True},
    "M_cafe_art": {"own": "lot_cafe_room_art", "normal": "lot_cafe_room_art_normal", "orm": "lot_cafe_room_art_orm", "vertexColor": True,
                   "note": "procedural (cafe_art.mjs): marble, chalk menus, the sign's enamel, gauge, latte, pastries, beans, labels, spines, clock, prints; COLOR_0 tints the glaze / matte cells (cups, macarons, jars). Albedo 2048 UASTC sRGB, normal + ORM 1024 UASTC linear"},
}


# ------------------------------------------------------------------------------------------------ atlas mapping --

def cuv(cell, inset=2.0, sub=None):
    """A cell -> (u0, u1, v0 bottom, v1 top) in Blender UV; `sub` = (fx0, fy0, fx1, fy1) a part of the cell (top-left origin)."""
    c = CELLS[cell]
    x, y, w, h = c["x"], c["y"], c["w"], c["h"]
    if sub:
        x, y, w, h = x + w * sub[0], y + h * sub[1], w * (sub[2] - sub[0]), h * (sub[3] - sub[1])
    x0, x1 = (x + inset) / AW, (x + w - inset) / AW
    y0, y1 = (y + inset) / AH, (y + h - inset) / AH
    return x0, x1, 1.0 - y1, 1.0 - y0


def remap(m, n0, cell, tint=(1.0, 1.0, 1.0), sub=None, swap=False):
    """Moves the UVs of polygons m.polys[n0:] into `cell` (their own UV range normalised to it) and sets their tint."""
    new = m.polys[n0:]
    if not new:
        return
    us = [u for p in new for u, _ in p.uv]
    vs = [v for p in new for _, v in p.uv]
    ua, ub, va, vb = min(us), max(us), min(vs), max(vs)
    du, dv = (ub - ua) or 1.0, (vb - va) or 1.0
    u0, u1, v0, v1 = cuv(cell, sub=sub)
    for p in new:
        if swap:
            p.uv = [(u0 + (u1 - u0) * (v - va) / dv, v0 + (v1 - v0) * (u - ua) / du) for u, v in p.uv]
        else:
            p.uv = [(u0 + (u1 - u0) * (u - ua) / du, v0 + (v1 - v0) * (v - va) / dv) for u, v in p.uv]
        p.mat = ART.mat
        p.col = [(tint[0], tint[1], tint[2], 1.0)] * len(p.pts)


def planar(m, n0, cell, cx, cz, r, tint=(1.0, 1.0, 1.0)):
    """Polygons m.polys[n0:] mapped top-down (x, z) onto a disc cell of radius r round (cx, cz)."""
    u0, u1, v0, v1 = cuv(cell)
    for p in m.polys[n0:]:
        p.uv = [(u0 + (u1 - u0) * ((q[0] - cx) / (2 * r) + 0.5), v0 + (v1 - v0) * (0.5 - (q[2] - cz) / (2 * r))) for q in p.pts]
        p.mat = ART.mat
        p.col = [(tint[0], tint[1], tint[2], 1.0)] * len(p.pts)


def card(m, a, b, c, d, cell, tint=(1.0, 1.0, 1.0), sub=None):
    """A quad a (bottom-left) b (bottom-right) c (top-right) d (top-left) showing `cell`."""
    u0, u1, v0, v1 = cuv(cell, sub=sub)
    m.poly([a, b, c, d], ART, uv=[(u0, v0), (u1, v0), (u1, v1), (u0, v1)], cols=[(tint[0], tint[1], tint[2], 1.0)] * 4)


def glaze(m, n0, tint):
    remap(m, n0, "glaze", tint)


def matte(m, n0, tint):
    remap(m, n0, "matte", tint)


# ------------------------------------------------------------------------------------------------ small shapes --

def rrect(x0, x1, z0, z1, r, n=4):
    """A rounded rectangle outline (CCW seen from above: x right, -z up)."""
    out = []
    for (cx, cz, a0) in ((x1 - r, z1 - r, 0.0), (x1 - r, z0 + r, -math.pi / 2), (x0 + r, z0 + r, -math.pi), (x0 + r, z1 - r, math.pi / 2)):
        for k in range(n + 1):
            a = a0 - (math.pi / 2) * k / n
            out.append((cx + r * math.cos(a), cz - r * math.sin(a)))
    return out


def soft_box(m, x0, x1, y0, y1, z0, z1, s, r=0.04, n=3, skip_bottom=True):
    """A cushion-like box: rounded in plan and at the top edge (a pillowed slab)."""
    n = 2 if PHONE else n
    ol = rrect(x0, x1, z0, z1, min(r, (x1 - x0) / 2.2, (z1 - z0) / 2.2), n)
    # rings: the side up to y1 - r, then the top edge rounding inward
    rings = []
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    steps = [(0.0, y0), (0.0, y1 - r)] + [(r * (1 - math.cos(math.pi / 2 * k / n)), y1 - r + r * math.sin(math.pi / 2 * k / n)) for k in range(1, n + 1)]
    for inset, y in steps:
        ring = []
        for (x, z) in ol:
            dx, dz = x - cx, z - cz
            l = math.hypot(dx, dz) or 1.0
            ring.append((x - dx / l * inset, y, z - dz / l * inset))
        rings.append(ring)
    k = len(ol)
    for a, b in zip(rings[:-1], rings[1:]):
        for i in range(k):
            j = (i + 1) % k
            m.poly([a[i], a[j], b[j], b[i]], s, smooth=True)
    top = list(rings[-1])
    if G.poly_normal(top)[1] < 0:
        top.reverse()
    m.poly(top, s, smooth=True)
    if not skip_bottom:
        bot = list(rings[0])
        if G.poly_normal(bot)[1] > 0:
            bot.reverse()
        m.poly(bot, s)


def disc(m, cx, cy, cz, r, s, n, up=True):
    pts = [(cx + r * math.cos(2 * math.pi * i / n), cy, cz - r * math.sin(2 * math.pi * i / n)) for i in range(n)]
    if not up:
        pts.reverse()
    m.poly(pts, s)


def cup(m, x, y, z, r=0.042, h=0.065, tint=(0.98, 0.97, 0.94), saucer=True, coffee=True, yaw=0.0):
    """A café cup on its saucer: a glazed porcelain bowl (rim lip, foot), a handle loop, latte art in it."""
    n = seg(14, 9)
    n0 = len(m.polys)
    if saucer:
        m.lathe([(0.0, 0.0), (0.045, 0.0), (0.05, 0.004), (0.072, 0.010), (0.074, 0.014), (0.05, 0.009), (0.0, 0.009)], n, S("LM_cafe_paint"), x, z, y)
        y += 0.009
    m.lathe([(0.0, 0.0), (r * 0.55, 0.0), (r * 0.62, 0.008), (r * 0.9, h * 0.35), (r, h * 0.8), (r * 1.02, h), (r * 0.92, h), (r * 0.85, h * 0.75), (0.0, h * 0.72)], n, S("LM_cafe_paint"), x, z, y)
    glaze(m, n0, tint)
    c, s_ = math.cos(yaw), math.sin(yaw)
    hx0 = (x + c * r * 0.95, z - s_ * r * 0.95)
    path = [(hx0[0] + c * 0.022 * math.sin(math.pi * k / 6), y + h * 0.75 - h * 0.5 * k / 6, hx0[1] - s_ * 0.022 * math.sin(math.pi * k / 6)) for k in range(7)]
    n1 = len(m.polys)
    m.tube(path, 0.0045, 5, S("LM_cafe_paint"))
    glaze(m, n1, tint)
    if coffee:
        n2 = len(m.polys)
        disc(m, x, y + h * 0.72 + 0.001, z, r * 0.85, S("LM_cafe_paint"), n)
        planar(m, n2, "latte", x, z, r * 0.85)


def plate(m, x, y, z, r, tint=(0.98, 0.97, 0.94)):
    n0 = len(m.polys)
    m.lathe([(0.0, 0.0), (r * 0.6, 0.0), (r * 0.65, 0.004), (r * 0.95, 0.012), (r, 0.016), (r * 0.94, 0.016), (r * 0.62, 0.008), (0.0, 0.008)], seg(18, 10), S("LM_cafe_paint"), x, z, y)
    glaze(m, n0, tint)
    return y + 0.008


# ------------------------------------------------------------------------------------------------ food --

def croissant(m, x, y, z, yaw=0.0, L=0.075, R=0.026, choc=False):
    """A croissant: a crescent whose section swells and narrows in lobes (the rolled triangle's turns), flattened underneath; the
    atlas's laminated crust (seven bands) along it. (choc: a pain au chocolat — a straight roll, squarer, two dark seams.)"""
    nt = 10 if PHONE else 18
    ns = 6 if PHONE else 10
    c, s_ = math.cos(yaw), math.sin(yaw)
    rings = []
    for i in range(nt + 1):
        t = i / nt
        if choc:
            px, pz = (t - 0.5) * L * 2.0, 0.0
            tx, tz = 1.0, 0.0
            rad = R * (0.75 + 0.25 * math.sin(math.pi * t) ** 0.3)
        else:
            a = -1.1 + 2.2 * t                       # the crescent's arc
            px, pz = math.sin(a) * L, -math.cos(a) * L * 0.55 + L * 0.35
            tx, tz = math.cos(a), math.sin(a) * 0.55
            lobe = 1 + 0.16 * abs(math.sin(t * math.pi * 5))
            rad = R * max(0.18, math.sin(math.pi * t) ** 0.65) * lobe
        tl = math.hypot(tx, tz)
        tx, tz = tx / tl, tz / tl
        nx, nz = -tz, tx                              # sideways in plan
        ring = []
        for k in range(ns):
            b = 2 * math.pi * k / ns
            cb, sb = math.cos(b), math.sin(b)
            hgt = rad * (0.82 if sb > 0 else 0.25) * sb  # domed on top, flat underneath
            wx = px + nx * rad * cb * (1.15 if choc else 1.0)
            wz = pz + nz * rad * cb * (1.15 if choc else 1.0)
            ring.append((x + wx * c + wz * s_, y + rad * 0.25 + hgt, z - wx * s_ + wz * c))
        rings.append(ring)
    n0 = len(m.polys)
    for i in range(nt):
        A, B = rings[i], rings[i + 1]
        for k in range(ns):
            j = (k + 1) % ns
            m.poly([A[k], A[j], B[j], B[k]], ART, uv=[(i / nt, k / ns), (i / nt, (k + 1) / ns), ((i + 1) / nt, (k + 1) / ns), ((i + 1) / nt, k / ns)], smooth=True)
    remap(m, n0, "croissant", (1.0, 1.0, 1.0) if not choc else (0.94, 0.86, 0.78))


def tart(m, x, y, z, r, top="tart_fruit", h=0.022):
    """A tartlet: the fluted pâte sucrée ring (atlas crust), its rim, the filling's top (glazed fruit / torched meringue)."""
    n = seg(20, 12)
    n0 = len(m.polys)
    m.lathe([(r * 0.92, 0.0), (r, h * 0.9), (r * 0.97, h), (r * 0.88, h * 0.92)], n, ART, x, z, y)
    remap(m, n0, "tart_crust")
    n1 = len(m.polys)
    dome = [(r * 0.88, h * 0.92), (r * 0.7, h * 1.08), (r * 0.35, h * 1.2), (0.0, h * 1.24)]
    m.lathe(dome, n, ART, x, z, y)
    planar(m, n1, top, x, z, r * 0.9)


def cake(m, x, y, z, r, h, top, side_tint, cut=False):
    """A whole entremets on its gold board: smooth glazed side (tinted), the atlas top; `cut`: a slice taken out shows the layers."""
    n = seg(24, 12)
    n0 = len(m.polys)
    m.lathe([(r + 0.012, 0.0), (r + 0.012, 0.003), (0.0, 0.003)], n, ART, x, z, y)
    remap(m, n0, "glaze", (0.85, 0.68, 0.32))
    y += 0.003
    if not cut:
        n1 = len(m.polys)
        m.lathe([(r, 0.0), (r, h * 0.96), (r * 0.97, h)], n, ART, x, z, y)
        remap(m, n1, "glaze", side_tint)
        n2 = len(m.polys)
        disc(m, x, y + h, z, r * 0.97, ART, n)
        planar(m, n2, top, x, z, r)
        return
    # 300 degrees of the cake and the two cut faces
    a0, a1 = math.radians(20), math.radians(340)
    k = n
    ring_b = [(x + r * math.cos(a0 + (a1 - a0) * i / k), y, z - r * math.sin(a0 + (a1 - a0) * i / k)) for i in range(k + 1)]
    ring_t = [(p[0], y + h, p[2]) for p in ring_b]
    n1 = len(m.polys)
    for i in range(k):
        m.poly([ring_b[i], ring_b[i + 1], ring_t[i + 1], ring_t[i]], ART, smooth=True)
    remap(m, n1, "glaze", side_tint)
    n2 = len(m.polys)
    top_pts = [(x, y + h, z)] + ring_t
    m.poly(list(reversed(top_pts)) if G.poly_normal(top_pts)[1] < 0 else top_pts, ART)
    planar(m, n2, top, x, z, r)
    for a, flip in ((a0, False), (a1, True)):
        e = (x + r * math.cos(a), z - r * math.sin(a))
        q = [(x, y, z), (e[0], y, e[1]), (e[0], y + h, e[1]), (x, y + h, z)]
        if flip:
            q = [q[1], q[0], q[3], q[2]]
        mid = ((x + e[0]) / 2, (z + e[1]) / 2)
        n3 = len(m.polys)
        out = (math.cos(a + (math.pi / 2 if not flip else -math.pi / 2)), -math.sin(a + (math.pi / 2 if not flip else -math.pi / 2)))
        if G.dot(G.poly_normal(q), (out[0], 0, out[1])) < 0:
            q.reverse()
        m.poly(q, ART)
        u0, u1, v0, v1 = cuv("cake_side")
        P_ = m.polys[n3]
        P_.uv = [(u0 + (u1 - u0) * (0 if math.hypot(p[0] - x, p[2] - z) < 1e-6 else 1), v0 + (v1 - v0) * ((p[1] - y) / h)) for p in P_.pts]


def macaron(m, x, y, z, tint, r=0.021):
    n = seg(12, 8)
    for (y0, top) in ((y, False), (y + 0.012, True)):
        n0 = len(m.polys)
        prof = [(r * 0.9, 0.0), (r, 0.004), (r * 0.9, 0.009), (r * 0.5, 0.012), (0.0, 0.013)] if top else [(0.0, 0.0), (r * 0.6, 0.0), (r * 0.95, 0.003), (r, 0.007), (r * 0.92, 0.009)]
        m.lathe(prof, n, ART, x, z, y0)
        matte(m, n0, tint)
    n1 = len(m.polys)
    m.cyl(x, z, r * 0.86, y + 0.008, y + 0.013, n, ART, top=False)
    matte(m, n1, (0.98, 0.95, 0.86))


def eclair(m, x, y, z, yaw, tint=(0.36, 0.2, 0.12), L=0.13, r=0.017):
    n0 = len(m.polys)
    c, s_ = math.cos(yaw), math.sin(yaw)
    a = (x - c * L / 2, y + r * 0.8, z + s_ * L / 2)
    b = (x + c * L / 2, y + r * 0.8, z - s_ * L / 2)
    m.tube([a, G.lerp(a, b, 0.5), b], r, seg(8, 6), ART, caps=True)
    remap(m, n0, "bread", (1.0, 0.92, 0.82))
    n1 = len(m.polys)
    m.tube([G.add(a, (0, r * 0.45, 0)), G.add(b, (0, r * 0.45, 0))], r * 0.7, seg(8, 6), ART, caps=True)
    glaze(m, n1, tint)


def bread_loaf(m, x, y, z, yaw, L=0.3, r=0.045):
    n0 = len(m.polys)
    c, s_ = math.cos(yaw), math.sin(yaw)
    pts = [(x + c * L * (t - 0.5), y + r * 0.75, z - s_ * L * (t - 0.5)) for t in (0.0, 0.08, 0.5, 0.92, 1.0)]
    m.tube(pts, r, seg(10, 6), ART, caps=True)
    remap(m, n0, "bread")


# ------------------------------------------------------------------------------------------------ furniture kinds (instanced) --

def bentwood_chair():
    """A Thonet No.14 bentwood chair facing +z: a round seat (dark-stained beech rim, a woven-look seat panel), four splayed legs
    joined by a bent ring, the back's double loop. Seat top 0.46 m; the whole chair inside x +-0.21, z -0.27..0.21."""
    m = Mesh("chair")
    n = seg(18, 10)
    st = 0.46
    m.lathe([(0.0, st - 0.022), (0.19, st - 0.022), (0.2, st - 0.012), (0.2, st - 0.004), (0.192, st), (0.0, st - 0.002)], n, BEECH, 0.0, 0.0, 0.0)
    m.lathe([(0.2, st - 0.06), (0.205, st - 0.045), (0.2, st - 0.022), (0.19, st - 0.022)], n, BEECH, 0.0, 0.0, 0.0)
    for (fx, fz, bx, bz, top) in ((0.15, 0.13, 0.19, 0.18, st - 0.05), (-0.15, 0.13, -0.19, 0.18, st - 0.05), (0.13, -0.13, 0.17, -0.19, st - 0.05), (-0.13, -0.13, -0.17, -0.19, st - 0.05)):
        m.tube([(bx, 0.0, bz), ((bx + fx) / 2, top * 0.5, (bz + fz) / 2), (fx, top, fz)], 0.014, seg(7, 5), BEECH)
    ring = [(0.165 * math.cos(2 * math.pi * k / 16), 0.2, 0.165 * math.sin(2 * math.pi * k / 16)) for k in range(17)]
    m.tube(ring, 0.009, seg(6, 4), BEECH)
    # the back: the outer loop (rear legs continued up and bent over) and the inner loop
    def loop(w, h0, h1, zb, r):
        pts = []
        for k in range(9):
            a = math.pi * k / 8
            pts.append((-math.cos(a) * w, h1 - (1 - math.sin(a)) * 0.0 + math.sin(a) * 0.06, zb - 0.02 * math.sin(a)))
        path = [(-w, h0, zb + 0.02)] + pts + [(w, h0, zb + 0.02)]
        m.tube(path, r, seg(7, 5), BEECH)
    loop(0.17, st - 0.02, st + 0.4, -0.2, 0.013)
    loop(0.11, st + 0.02, st + 0.26, -0.215, 0.01)
    return m


def bar_stool():
    """A bentwood bar stool: round seat 0.62 m, four splayed legs, a brass foot ring. Inside x/z +-0.21."""
    m = Mesh("stool")
    n = seg(18, 10)
    st = 0.62
    m.lathe([(0.0, st - 0.03), (0.17, st - 0.03), (0.185, st - 0.018), (0.185, st - 0.006), (0.175, st), (0.0, st - 0.002)], n, BEECH, 0, 0, 0)
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        m.tube([(0.2 * math.cos(a), 0.0, 0.2 * math.sin(a)), (0.15 * math.cos(a), st * 0.5, 0.15 * math.sin(a)), (0.12 * math.cos(a), st - 0.03, 0.12 * math.sin(a))], 0.015, seg(7, 5), BEECH)
    ring = [(0.17 * math.cos(2 * math.pi * k / 18), 0.26, 0.17 * math.sin(2 * math.pi * k / 18)) for k in range(19)]
    m.tube(ring, 0.011, seg(6, 4), BRASS)
    return m


def bistro_table(r=0.33, top_h=0.755):
    """A bistro table: Carrara top (the atlas's round marble, a 2.4 cm slab with an eased edge) on a black cast-iron pedestal: a
    turned column, a round foot. Inside x/z +-0.34."""
    m = Mesh("table")
    n = seg(32, 14)
    n0 = len(m.polys)
    m.lathe([(0.0, top_h - 0.024), (r - 0.006, top_h - 0.024), (r, top_h - 0.016), (r, top_h - 0.006), (r - 0.006, top_h), (0.0, top_h)], n, ART, 0, 0, 0)
    planar(m, n0, "marble_round", 0.0, 0.0, r)
    m.lathe([(0.0, 0.0), (0.24, 0.0), (0.24, 0.015), (0.2, 0.03), (0.06, 0.05), (0.04, 0.08), (0.03, 0.12), (0.03, 0.6), (0.045, 0.64), (0.035, 0.67), (0.12, 0.7), (0.14, top_h - 0.026), (0.0, top_h - 0.026)], seg(16, 10), IRON, 0, 0, 0)
    return m


def plant_pot(m, x, z, r, h, kind="fig", seed=1):
    """A terracotta pot (rim, foot) with a leafy plant: a fiddle-leaf fig, a pothos trailing, or a palm."""
    rg = G.rng(seed)
    n = seg(18, 10)
    ph = min(0.42, r * 1.3)
    m.lathe([(0.0, 0.0), (r * 0.72, 0.0), (r * 0.78, 0.02), (r * 0.94, ph - 0.05), (r, ph - 0.05), (r, ph), (r * 0.9, ph), (r * 0.88, ph - 0.03), (0.0, ph - 0.03)], n, TERRA, x, z, 0.0)
    disc(m, x, ph - 0.035, z, r * 0.86, SOIL, n)
    if kind == "fig":
        trunk = [(x, ph - 0.04, z), (x + 0.02, ph + (h - ph) * 0.35, z - 0.01), (x - 0.01, h - 0.25, z + 0.02)]
        m.tube(trunk, 0.018, 5, OAK_DK)
        cnt = 9 if PHONE else 18
        for k in range(cnt):
            t = k / cnt
            a = k * 2.399
            yy = ph + (h - ph) * (0.3 + 0.7 * t)
            stem = (x + 0.02 * math.cos(a), yy, z + 0.02 * math.sin(a))
            fiddle(m, stem, a, 0.2 + 0.08 * rg.random(), 0.075, 0.03 + 0.04 * rg.random(), LEAF if k % 3 else LEAF_DK)
    elif kind == "palm":
        cnt = 7 if PHONE else 12
        for k in range(cnt):
            a = k * 2.0 + rg.random()
            L = (h - ph) * (0.7 + 0.3 * rg.random())
            base = (x, ph, z)
            mid = (x + math.cos(a) * L * 0.3, ph + L * 0.75, z + math.sin(a) * L * 0.3)
            tip = (x + math.cos(a) * L * 0.6, ph + L * 0.8, z + math.sin(a) * L * 0.6)
            m.tube([base, mid, tip], 0.006, 4, LEAF_DK)
            for q in range(6 if PHONE else 10):
                t = 0.35 + 0.6 * q / 10
                p = G.lerp(mid, tip, t) if t > 0.5 else G.lerp(base, mid, t * 2)
                for sgn in (-1, 1):
                    side = (math.cos(a + sgn * 1.2) * 0.09, -0.04, math.sin(a + sgn * 1.2) * 0.09)
                    q2 = G.add(p, side)
                    w = G.mul(G.norm(G.cross(G.sub(q2, p), (0, 1, 0))), 0.012)
                    m.poly([G.sub(p, w), G.add(p, w), q2], LEAF)
                    m.poly([G.add(p, w), G.sub(p, w), q2], LEAF)
    else:  # pothos trailing over the rim
        cnt = 6 if PHONE else 10
        for k in range(cnt):
            a = 2 * math.pi * k / cnt
            path = [(x + math.cos(a) * r * 0.6, ph + 0.05, z + math.sin(a) * r * 0.6), (x + math.cos(a) * r * 1.1, ph + 0.02, z + math.sin(a) * r * 1.1),
                    (x + math.cos(a) * r * 1.2, ph - 0.25 - 0.2 * rg.random(), z + math.sin(a) * r * 1.2)]
            m.tube(path, 0.004, 4, LEAF_DK)
            for q in range(4 if PHONE else 7):
                p = G.lerp(path[1], path[2], q / 7) if q else path[1]
                heart(m, p, a + q, 0.045, LEAF if q % 2 else LEAF_DK)


def fiddle(m, stem, angle, length, width, rise, leaf):
    """A fiddle-leaf fig leaf with its petiole: a folded midrib, the blade's edges curling down (b1_room.fiddle_leaf's shape)."""
    import b1_room as R
    R.fiddle_leaf(m, stem, angle, length, width, rise, leaf)


def heart(m, p, a, s, leaf):
    """A small heart-shaped pothos leaf hanging off its vine (two-sided)."""
    d = (math.cos(a), 0.0, math.sin(a))
    side = (-d[2], 0.0, d[0])
    tip = G.add(p, G.add(G.mul(d, s * 0.5), (0, -s, 0)))
    l = G.add(p, G.add(G.mul(side, s * 0.45), (0, -s * 0.3, 0)))
    r = G.add(p, G.add(G.mul(side, -s * 0.45), (0, -s * 0.3, 0)))
    m.poly([p, l, tip, r], leaf)
    m.poly([p, r, tip, l], leaf)


# ------------------------------------------------------------------------------------------------ the bar --

def espresso_machine(kit, m, x, y, z, yaw=0.0):
    """A two-group lever-less espresso machine in polished stainless (a La Marzocco Linea's proportions: 0.7 w, 0.53 h, 0.56 d on four
    legs): the cup-warmer tray with its rail and cups, the front panel with two group heads, portafilters with black handles and twin
    spouts, a pressure gauge (atlas dial) in a chrome bezel, the keypads, two steam wands, the hot-water tap, the drip tray's grille.
    The machine faces +z of its own frame (yaw turns it)."""
    c, s_ = math.cos(yaw), math.sin(yaw)

    def T(p):
        return (x + p[0] * c + p[2] * s_, y + p[1], z - p[0] * s_ + p[2] * c)

    def box(x0, x1, y0, y1, z0, z1, s, ch=0.006):
        n0 = len(m.polys)
        if ch > 0 and not PHONE:
            m.cbox(x0, x1, y0, y1, z0, z1, s, c=ch)
        else:
            m.box(x0, x1, y0, y1, z0, z1, s)
        for p in m.polys[n0:]:
            p.pts = [T(q) for q in p.pts]

    def tube(path, r, *a, caps=False):
        s = next(v for v in a if isinstance(v, S))
        n = next((v for v in a if isinstance(v, int)), 8)
        n0 = len(m.polys)
        m.tube(path, r, seg(n, 5), s, caps=caps)
        for p in m.polys[n0:]:
            p.pts = [T(q) for q in p.pts]

    def lathe(prof, n, s, cx, cz, y0, cap=False, axis_z=False):
        n0 = len(m.polys)
        m.lathe(prof, seg(n, 8), s, cx, cz, y0, cap_top=cap)
        for p in m.polys[n0:]:
            if axis_z:
                # a lathe turned to face +z (the gauge, the knobs): local (x, y, z) round (cx, y0, cz) -> (x, z, -y)
                p.pts = [T((q[0], y0 + (q[2] - cz), cz + (q[1] - y0))) for q in p.pts]
            else:
                p.pts = [T(q) for q in p.pts]
        return n0

    W, D = 0.35, 0.28
    for lx in (-W + 0.04, W - 0.04):
        for lz in (-D + 0.05, D - 0.06):
            lathe([(0.018, 0.0), (0.022, 0.012), (0.016, 0.06), (0.0, 0.06)], 10, CHROME, lx, lz, 0.0)
    box(-W, W, 0.06, 0.1, -D, D - 0.02, CHROME)                      # the base
    box(-W + 0.02, W - 0.02, 0.06, 0.1, D - 0.02, D + 0.05, STEEL_DK, 0)  # the drip tray
    for k in range(13):
        gx = -W + 0.05 + k * (2 * W - 0.1) / 12
        box(gx - 0.004, gx + 0.004, 0.1, 0.104, D - 0.02, D + 0.045, CHROME, 0)
    box(-W, W, 0.1, 0.42, -D, D - 0.12, CHROME, 0.01)                 # the body
    box(-W - 0.005, W + 0.005, 0.42, 0.45, -D - 0.005, D - 0.115, CHROME, 0.004)
    # the front panel (a step out, the logo strip black)
    box(-W + 0.01, W - 0.01, 0.26, 0.42, D - 0.12, D - 0.06, CHROME, 0.008)
    box(-W + 0.06, W - 0.06, 0.37, 0.4, D - 0.06, D - 0.058, BLACK, 0)
    # cup warmer: a raised grille, a rail, cups upside down
    box(-W + 0.02, W - 0.02, 0.45, 0.455, -D + 0.02, D - 0.14, STEEL_DK, 0)
    rail = [(-W + 0.015, 0.45, D - 0.13), (-W + 0.015, 0.52, D - 0.13), (W - 0.015, 0.52, D - 0.13), (W - 0.015, 0.45, D - 0.13)]
    tube(rail, 0.006, CHROME)
    rail2 = [(-W + 0.015, 0.45, -D + 0.015), (-W + 0.015, 0.52, -D + 0.015), (W - 0.015, 0.52, -D + 0.015), (W - 0.015, 0.45, -D + 0.015)]
    tube(rail2, 0.006, CHROME)
    if not PHONE:
        for i in range(5):
            for j in range(2):
                cx_, cz_ = -0.24 + i * 0.12, -0.13 + j * 0.13
                n0 = len(m.polys)
                m.lathe([(0.0, 0.0), (0.034, 0.0), (0.04, 0.045), (0.028, 0.06), (0.0, 0.06)], seg(12, 8), ART, 0, 0, 0)
                for p in m.polys[n0:]:
                    p.pts = [T((cx_ + q[0], 0.455 + q[1], cz_ + q[2])) for q in p.pts]
                glaze(m, n0, (0.98, 0.97, 0.94))
    # group heads, portafilters
    for gx in (-0.15, 0.15):
        lathe([(0.0, 0.0), (0.04, 0.0), (0.05, 0.02), (0.048, 0.06), (0.03, 0.075), (0.0, 0.075)], 14, CHROME, gx, D - 0.06, 0.19)
        lathe([(0.0, 0.0), (0.042, 0.0), (0.046, 0.012), (0.044, 0.035), (0.0, 0.035)], 14, CHROME, gx, D - 0.06, 0.155)
        for sx in (-0.012, 0.012):
            tube([(gx + sx, 0.155, D - 0.06), (gx + sx, 0.135, D - 0.06)], 0.005, 5, CHROME)
        tube([(gx, 0.17, D - 0.02), (gx + 0.02, 0.165, D + 0.08), (gx + 0.035, 0.16, D + 0.12)], 0.012, BLACK, caps=True)
    # the gauge (atlas dial), its bezel, the keypads, the knobs
    n0 = lathe([(0.0, 0.0), (0.045, 0.0), (0.045, 0.004), (0.0, 0.004)], 18, ART, 0.0, D - 0.058, 0.335, axis_z=True)
    planar_face(m, n0, "gauge")
    lathe([(0.045, 0.0), (0.052, 0.0), (0.052, 0.012), (0.045, 0.012)], 18, CHROME, 0.0, D - 0.058, 0.335, axis_z=True)
    for gx in (-0.15, 0.15):
        box(gx - 0.05, gx + 0.05, 0.3, 0.33, D - 0.06, D - 0.052, BLACK, 0)
        for k in range(4):
            box(gx - 0.042 + k * 0.024, gx - 0.026 + k * 0.024, 0.305, 0.325, D - 0.052, D - 0.046, CHROME, 0)
    for sgn in (-1, 1):
        kx = sgn * (W - 0.05)
        lathe([(0.0, 0.0), (0.022, 0.0), (0.025, 0.03), (0.018, 0.045), (0.0, 0.045)], 12, BLACK, kx, D - 0.06, 0.34, axis_z=True)
        # the steam wands: from the side panel, down at an angle, a tip
        tube([(kx, 0.3, D - 0.04), (kx + sgn * 0.02, 0.29, D + 0.0), (kx + sgn * 0.03, 0.2, D + 0.03), (kx + sgn * 0.035, 0.12, D + 0.045)], 0.006, CHROME)
    tube([(0.07, 0.25, D - 0.06), (0.07, 0.22, D - 0.03), (0.07, 0.17, D - 0.025)], 0.006, CHROME)
    kit.lights.append(("point",) + T((0.0, 0.6, 0.4)) + ((1.0, 0.9, 0.75), 6.0))


def planar_face(m, n0, cell):
    """Polygons m.polys[n0:] that face along one axis: mapped onto `cell` by their bounding box in that plane."""
    new = m.polys[n0:]
    pts = [q for p in new for q in p.pts]
    n = G.poly_normal(new[0].pts)
    ax = max(range(3), key=lambda i: abs(n[i]))
    a, b = [i for i in range(3) if i != ax]
    lo = [min(q[i] for q in pts) for i in range(3)]
    hi = [max(q[i] for q in pts) for i in range(3)]
    u0, u1, v0, v1 = cuv(cell)
    for p in new:
        p.uv = [(u0 + (u1 - u0) * (q[a] - lo[a]) / ((hi[a] - lo[a]) or 1), v0 + (v1 - v0) * (q[b] - lo[b]) / ((hi[b] - lo[b]) or 1)) for q in p.pts]
        p.mat = ART.mat
        p.col = [(1.0, 1.0, 1.0, 1.0)] * len(p.pts)


def grinder(m, x, y, z, yaw=0.0):
    """A commercial burr grinder (a Mazzer's lines): a black base, the steel body, the clear hopper of beans, the dosing spout and fork."""
    n = seg(16, 10)
    m.cbox(x - 0.1, x + 0.1, y, y + 0.06, z - 0.12, z + 0.12, BLACK, c=0.01) if not PHONE else m.box(x - 0.1, x + 0.1, y, y + 0.06, z - 0.12, z + 0.12, BLACK)
    m.cbox(x - 0.085, x + 0.085, y + 0.06, y + 0.36, z - 0.1, z + 0.08, CHROME, c=0.015) if not PHONE else m.box(x - 0.085, x + 0.085, y + 0.06, y + 0.36, z - 0.1, z + 0.08, CHROME)
    m.lathe([(0.0, 0.0), (0.07, 0.0), (0.075, 0.02), (0.0, 0.02)], n, CHROME, x, z - 0.01, y + 0.36)
    n0 = len(m.polys)
    m.lathe([(0.03, 0.0), (0.09, 0.22), (0.0, 0.22)], n, ART, x, z - 0.01, y + 0.38)  # the beans inside
    remap(m, n0, "beans")
    m.lathe([(0.04, 0.0), (0.1, 0.24), (0.105, 0.25), (0.0, 0.26)], n, GLASS, x, z - 0.01, y + 0.38)
    m.box(x - 0.04, x + 0.04, y + 0.16, y + 0.2, z + 0.08, z + 0.14, CHROME)
    m.tube([(x - 0.03, y + 0.12, z + 0.12), (x - 0.03, y + 0.12, z + 0.17)], 0.005, 5, CHROME)
    m.tube([(x + 0.03, y + 0.12, z + 0.12), (x + 0.03, y + 0.12, z + 0.17)], 0.005, 5, CHROME)


def cake_stand(m, x, y, z, r=0.13, h=0.1, cloche=True):
    n = seg(20, 10)
    n0 = len(m.polys)
    m.lathe([(0.0, 0.0), (0.06, 0.0), (0.05, 0.01), (0.018, 0.03), (0.016, h - 0.01), (r, h - 0.005), (r, h), (0.0, h)], n, ART, x, z, y)
    glaze(m, n0, (0.99, 0.98, 0.95))
    if cloche:
        m.lathe([(r * 0.95, 0.0), (r * 0.95, 0.12), (r * 0.8, 0.2), (r * 0.4, 0.24), (0.02, 0.25), (0.02, 0.28), (0.0, 0.285)], n, GLASS, x, z, y + h)
        m.sphere(x, y + h + 0.29, z, 0.016, GLASS, n=8, rings=5)
    return y + h


def pendant(kit, m, x, z, H, drop, kind="dome", s=None):
    """A café pendant: a ceiling cup, a braided cord, a brass dome shade (lacquered, cream inside) with a warm bulb, or an opal globe on a
    brass gallery. The night glow shell sits on the bulb / globe."""
    n = seg(24, 12)
    y = H - drop
    m.lathe([(0.0, 0.0), (0.06, 0.0), (0.06, 0.012), (0.045, 0.03), (0.0, 0.03)], n, BRASS, x, z, H - 0.03)
    m.member((x, H - 0.03, z), (x, y + 0.02, z), G.prof_round(0.0035, 5), BLACK)
    if kind == "dome":
        m.lathe([(0.0, 0.0), (0.022, 0.0), (0.03, 0.03)], n, BRASS, x, z, y - 0.01)
        outer = [(0.03, 0.0), (0.07, -0.02), (0.14, -0.08), (0.19, -0.16), (0.205, -0.21), (0.2, -0.215)]
        m.lathe(list(reversed(outer)), n, BRASS, x, z, y + 0.02)
        inner = [(0.198, -0.212), (0.185, -0.16), (0.135, -0.085), (0.065, -0.03), (0.0, -0.025)]
        n0 = len(m.polys)
        m.lathe(inner, n, ART, x, z, y + 0.02)
        matte(m, n0, (0.98, 0.95, 0.88))
        kit.glow("lamps").sphere(x, y - 0.1, z, 0.045, GLOW, n=10, rings=6)
        kit.lights.append(("point", x, y - 0.14, z, (1.0, 0.82, 0.58), 45.0))
    else:
        m.lathe([(0.0, 0.0), (0.04, 0.0), (0.05, 0.03), (0.045, 0.045), (0.0, 0.045)], n, BRASS, x, z, y - 0.02)
        n0 = len(m.polys)
        m.sphere(x, y - 0.16, z, 0.15, ART, n=n, rings=n // 2)
        glaze(m, n0, (1.0, 0.99, 0.96))
        kit.glow("lamps").sphere(x, y - 0.16, z, 0.152, GLOW, n=n, rings=n // 2)
        kit.lights.append(("point", x, y - 0.33, z, (1.0, 0.84, 0.62), 40.0))
    kit.dayfill.append((x, H - 0.3, z, 1.6, 30.0))


def chandelier(kit, m, x, z, H, drop=0.9, arms=6):
    """A brass salon chandelier: a rod, a turned body, S-arms with candle cups and small fabric shades (the salon upstairs)."""
    n = seg(16, 10)
    y = H - drop
    m.lathe([(0.0, 0.0), (0.09, 0.0), (0.09, 0.015), (0.06, 0.04), (0.0, 0.04)], n, BRASS, x, z, H - 0.04)
    m.member((x, H - 0.04, z), (x, y + 0.2, z), G.prof_round(0.008, 6), BRASS)
    m.lathe([(0.0, 0.0), (0.03, 0.02), (0.06, 0.08), (0.05, 0.14), (0.025, 0.18), (0.02, 0.22), (0.0, 0.22)], n, BRASS, x, z, y)
    for k in range(arms):
        a = 2 * math.pi * k / arms
        c, s_ = math.cos(a), math.sin(a)
        R = 0.32
        path = [(x + c * 0.05, y + 0.1, z + s_ * 0.05), (x + c * R * 0.5, y + 0.02, z + s_ * R * 0.5), (x + c * R * 0.9, y + 0.06, z + s_ * R * 0.9), (x + c * R, y + 0.14, z + s_ * R)]
        m.tube(path, 0.007, seg(6, 4), BRASS)
        cx_, cz_ = x + c * R, z + s_ * R
        m.lathe([(0.0, 0.0), (0.025, 0.0), (0.02, 0.02), (0.0, 0.02)], seg(10, 6), BRASS, cx_, cz_, y + 0.14)
        n0 = len(m.polys)
        m.lathe([(0.075, 0.0), (0.04, 0.13), (0.0, 0.13)], seg(12, 8), ART, cx_, cz_, y + 0.17)
        matte(m, n0, (0.98, 0.93, 0.84))
        kit.glow("lamps").lathe([(0.072, 0.0), (0.038, 0.13), (0.0, 0.13)], seg(12, 8), GLOW, cx_, cz_, y + 0.169)
    kit.lights.append(("point", x, y + 0.2, z, (1.0, 0.82, 0.6), 110.0))
    kit.dayfill.append((x, H - 0.3, z, 2.0, 50.0))


def sconce(kit, m, at, out, s=BRASS):
    """A brass wall sconce: a round back plate, a curved arm, a pleated fabric shade (a candle-cup light)."""
    o = G.norm(out)
    p0 = at
    m.lathe([(0.0, 0.0), (0.05, 0.0), (0.05, 0.01), (0.0, 0.012)], seg(12, 8), s, p0[0] + o[0] * 0.005, p0[2] + o[2] * 0.005, p0[1] - 0.05)
    arm = [G.add(p0, G.mul(o, 0.01)), G.add(G.add(p0, G.mul(o, 0.12)), (0, -0.02, 0)), G.add(G.add(p0, G.mul(o, 0.16)), (0, 0.06, 0))]
    m.tube(arm, 0.008, seg(6, 4), s)
    c = arm[-1]
    n0 = len(m.polys)
    m.lathe([(0.08, 0.0), (0.05, 0.14), (0.0, 0.14)], seg(14, 8), ART, c[0], c[2], c[1] + 0.02)
    matte(m, n0, (0.97, 0.9, 0.78))
    kit.glow("lamps").lathe([(0.078, 0.0), (0.048, 0.14), (0.0, 0.14)], seg(14, 8), GLOW, c[0], c[2], c[1] + 0.019)
    kit.lights.append(("point", c[0], c[1] + 0.06, c[2], (1.0, 0.8, 0.58), 18.0))


def curtain(m, f, u0, u1, top, bot, d, s=LINEN, tie=True, folds=None):
    """Linen drapes on a brass rod in front of a window (facade frame f, W into the room is -W of the wall's... f.W points INTO the room
    here: R.walls' frames have W = into the room): two panels gathered to the sides with tie-backs (or a full café curtain when `tie`
    is False). Folds are a sine wave in depth."""
    w = u1 - u0
    rod = [f.p(u0 - 0.12, top + 0.06, d), f.p(u1 + 0.12, top + 0.06, d)]
    m.tube(rod, 0.012, seg(8, 5), BRASS)
    for e, sg_ in ((rod[0], -1), (rod[1], 1)):
        m.sphere(e[0], e[1], e[2], 0.022, BRASS, n=seg(10, 6), rings=6)
    if not tie:
        nf = folds or max(8, int(w / 0.06))
        if PHONE:
            nf = max(6, nf // 2)
        for i in range(nf):
            ua = u0 + w * i / nf
            ub = u0 + w * (i + 1) / nf
            da = d + 0.025 * (i % 2)
            db = d + 0.025 * ((i + 1) % 2)
            q = [f.p(ua, bot, da), f.p(ub, bot, db), f.p(ub, top, db), f.p(ua, top, da)]
            m.poly(q, s, smooth=True)
            m.poly(list(reversed(q)), s, smooth=True)
        return
    pw = 0.32
    for side in (0, 1):
        a = u0 - 0.1 if side == 0 else u1 + 0.1 - pw
        nf = 4 if PHONE else 7
        for i in range(nf):
            ua = a + pw * i / nf
            ub = a + pw * (i + 1) / nf
            for (va, vb, k0, k1) in ((bot, (bot + top) * 0.5 - 0.25, 1.0, 0.7), ((bot + top) * 0.5 - 0.25, top, 0.7, 1.0)):
                # gathered at the tie-back: the panel narrows toward the side
                cu = a + (pw if side == 0 else 0.0)
                pa0 = cu + (ua - cu) * k0
                pb0 = cu + (ub - cu) * k0
                pa1 = cu + (ua - cu) * k1
                pb1 = cu + (ub - cu) * k1
                da = d + 0.035 * (i % 2)
                db = d + 0.035 * ((i + 1) % 2)
                q = [f.p(pa0, va, da), f.p(pb0, va, db), f.p(pb1, vb, db), f.p(pa1, vb, da)]
                m.poly(q, s, smooth=True)
                m.poly(list(reversed(q)), s, smooth=True)
        tb = f.p(a + pw / 2, (bot + top) * 0.5 - 0.25, d + 0.02)
        m.sphere(tb[0], tb[1], tb[2], 0.03, BRASS, n=seg(8, 6), rings=5)


def framed(m, f, uc, vc, w, h, cell, frame_s=GILT, depth=0.03, d0=0.0):
    """A framed print on a wall (frame f, W into the room): a moulded frame and the atlas print behind a glass-less face."""
    u0, u1, v0, v1 = uc - w / 2, uc + w / 2, vc - h / 2, vc + h / 2
    fw = 0.04
    for (a, b, c_, d_) in ((u0 - fw, u1 + fw, v0 - fw, v0), (u0 - fw, u1 + fw, v1, v1 + fw), (u0 - fw, u0, v0, v1), (u1, u1 + fw, v0, v1)):
        f.box(m, a, b, c_, d_, d0, d0 + depth, frame_s, c=0.006 if not PHONE else 0.0, skip=("-w",))
    card(m, f.p(u0, v0, d0 + 0.01), f.p(u1, v0, d0 + 0.01), f.p(u1, v1, d0 + 0.01), f.p(u0, v1, d0 + 0.01), cell)


def book_row(m, x0, x1, y, z0, z1, rg, axis="x"):
    """Books on a shelf: spines (atlas spine cells, 16) facing the room (-z of the shelf's frame when axis is x)."""
    n = 16
    sw = CELLS["spines"]["w"] / n
    x = x0
    while x < x1 - 0.03:
        t = 0.025 + rg.random() * 0.025
        h = 0.18 + rg.random() * 0.08
        k = rg.randrange(n)
        sub = (k / n, 0.0, (k + 1) / n, 1.0)
        if axis == "x":
            m.box(x, x + t, y, y + h, z0 + 0.01, z1, PAINT.t((0.9, 0.86, 0.78)), skip=("-y",))
            u0, u1, v0, v1 = cuv("spines", sub=sub, inset=1)
            m.poly([(x, y, z0), (x + t, y, z0), (x + t, y + h, z0), (x, y + h, z0)], ART, uv=[(u0, v0), (u1, v0), (u1, v1), (u0, v1)])
            m.polys[-1].pts.reverse()
            m.polys[-1].uv.reverse()
        x += t + 0.002
