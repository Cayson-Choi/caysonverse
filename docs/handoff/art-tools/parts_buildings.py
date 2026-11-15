"""Buildings: five colourful cottages, the café, the memorial hall exterior, the plots (lawns, glowing outlines,
sign posts) and the under-construction library plot (scaffold + tower crane)."""
import math
import random

from mathutils import Vector

import vlib as U
from vlib import V, MB, loc

L = U.LAYOUT
FACING = {"s": 0.0, "n": math.pi, "e": math.pi / 2, "w": -math.pi / 2}     # game yaw: local +z -> that side


class Frame:
    """A local building frame: origin (cx, cz), yaw; local x right, local z toward the front (door side)."""

    def __init__(self, cx, cz, yaw):
        self.cx, self.cz, self.yaw = cx, cz, yaw

    def p(self, lx, lz, y=0.0):
        x, z = loc(self.cx, self.cz, self.yaw, lx, lz)
        return V(x, z, y)

    def xz(self, lx, lz):
        return loc(self.cx, self.cz, self.yaw, lx, lz)

    def n(self, lx, lz, y=0.0):
        """A direction in local terms as a Blender vector."""
        c, s = math.cos(self.yaw), math.sin(self.yaw)
        gx = lx * c + lz * s
        gz = -lx * s + lz * c
        return Vector((gx, -gz, y))

    def box(self, mb, lx, lz, y0, sx, sz, sy, m, tint=None):
        x, z = self.xz(lx, lz)
        return mb.box(x, z, y0, sx, sz, sy, m, yaw=self.yaw, tint=tint)


def wall_feature(mb, F, lx, lz, y0, w, h, normal_l, region, m="A_window_glass", frame_tint=None, frame=True, sill=True,
                 depth=0.04, uvfn=None):
    """A window/door applied on a wall face at local (lx, lz) (centre bottom), facing normal_l = (nx, nz) local."""
    nx, nz = normal_l
    tx, tz = -nz, nx                         # along the wall (right when looking at the face from outside)
    off = 0.02
    cxl, czl = lx + nx * off, lz + nz * off
    a = F.p(cxl - tx * w / 2, czl - tz * w / 2, y0)
    b = F.p(cxl + tx * w / 2, czl + tz * w / 2, y0)
    pts = [a, b, b + Vector((0, 0, h)), a + Vector((0, 0, h))]
    fn = uvfn or (U.glow_uv if m in ("A_window_glass", "M_window") else U.region_uv)
    uvs = [fn(region, 0, 0), fn(region, 1, 0), fn(region, 1, 1), fn(region, 0, 1)]
    mb.face(pts, m, uvs, hint=F.n(nx, nz))
    if m == "M_window":
        U.light("window", F.p(cxl + nx * 0.35, czl + nz * 0.35, y0 + h / 2))
    if frame:
        ft = frame_tint or U.rgba("#F4F2EC")
        fw = 0.08
        for (ox, oy, sw, sh) in ((-w / 2 - fw / 2, 0, fw, h), (w / 2 + fw / 2, 0, fw, h), (0, h, w + 2 * fw, fw)):
            cx = lx + nx * depth / 2 + tx * ox
            cz = lz + nz * depth / 2 + tz * ox
            F_box_oriented(mb, F, cx, cz, y0 + oy, sw, depth + 0.02, sh, (nx, nz), "LM_render", ft)
        if sill:
            cx = lx + nx * 0.06
            cz = lz + nz * 0.06
            F_box_oriented(mb, F, cx, cz, y0 - 0.06, w + 0.2, 0.14, 0.06, (nx, nz), "LM_render", ft)


def F_box_oriented(mb, F, lx, lz, y0, along, across, h, normal_l, m, tint=None):
    """Box whose 'along' size runs along the wall (perpendicular to normal_l)."""
    nx, nz = normal_l
    if abs(nx) > abs(nz):
        F.box(mb, lx, lz, y0, across, along, h, m, tint=tint)
    else:
        F.box(mb, lx, lz, y0, along, across, h, m, tint=tint)


def gable_roof(mb, F, x0, x1, z0, z1, eave_y, pitch_deg, overhang, m, tint, ridge_along_x=True, thick=0.14,
               fascia_tint=None):
    """Two roof planes (with thickness) over the local rectangle; ridge along x (gables at +-x) or along z."""
    t = math.tan(math.radians(pitch_deg))
    if ridge_along_x:
        half = (z1 - z0) / 2 + overhang
        zc = (z0 + z1) / 2
        rise = half * t
        xa, xb = x0 - overhang, x1 + overhang
        for side in (-1, 1):
            e = zc + side * half
            low = [F.p(xa, e, eave_y - overhang * t), F.p(xb, e, eave_y - overhang * t)]
            top = [F.p(xb, zc, eave_y - overhang * t + rise), F.p(xa, zc, eave_y - overhang * t + rise)]
            pts = [low[0], low[1], top[0], top[1]]
            nrm = F.n(0, side, 1.0 / max(t, 0.1))
            mb.face(pts, m, tint=tint, hint=nrm)
            up = Vector((0, 0, thick))
            mb.face([p + up for p in pts], m, tint=tint, hint=nrm)
            # fascia (edge) along the eave
            mb.face([low[0], low[1], low[1] + up, low[0] + up], "LM_render", tint=fascia_tint or U.rgba("#F4F2EC"),
                    hint=F.n(0, side))
        return eave_y - overhang * t + rise
    else:
        half = (x1 - x0) / 2 + overhang
        xc = (x0 + x1) / 2
        rise = half * t
        za, zb = z0 - overhang, z1 + overhang
        for side in (-1, 1):
            e = xc + side * half
            low = [F.p(e, za, eave_y - overhang * t), F.p(e, zb, eave_y - overhang * t)]
            top = [F.p(xc, zb, eave_y - overhang * t + rise), F.p(xc, za, eave_y - overhang * t + rise)]
            pts = [low[0], low[1], top[0], top[1]]
            nrm = F.n(side, 0, 1.0 / max(t, 0.1))
            mb.face(pts, m, tint=tint, hint=nrm)
            up = Vector((0, 0, thick))
            mb.face([p + up for p in pts], m, tint=tint, hint=nrm)
            mb.face([low[0], low[1], low[1] + up, low[0] + up], "LM_render", tint=fascia_tint or U.rgba("#F4F2EC"),
                    hint=F.n(side, 0))
        return eave_y - overhang * t + rise


def gable_wall(mb, F, xa, xb, z, y0, rise, normal_z, m, tint):
    """Triangle gable infill over a wall segment (local x from xa to xb at local z), apex at the centre."""
    xc = (xa + xb) / 2
    pts = [F.p(xa, z, y0), F.p(xb, z, y0), F.p(xc, z, y0 + rise)]
    mb.face(pts, m, tint=tint, hint=F.n(0, normal_z))


def gable_wall_x(mb, F, x, za, zb, y0, rise, normal_x, m, tint):
    zc = (za + zb) / 2
    pts = [F.p(x, za, y0), F.p(x, zb, y0), F.p(x, zc, y0 + rise)]
    mb.face(pts, m, tint=tint, hint=F.n(normal_x, 0))


# --------------------------------------------------------------------------------------------- houses --

HOUSE_ROOF = {"pink": "roof_charcoal", "skyblue": "roof_grey", "yellow": "roof_blue", "white": "roof_charcoal",
              "mint": "roof_grey"}


def house(mb, fl, h, seed, F_shrub=None):
    """Two-storey pastel cottage (8 x 6 footprint): gable roof, front porch with its own gable, white trims,
    flower boxes, some warm lit windows (M_window), shrubs at the porch corners."""
    import build_village as BV
    import parts_trees as PT
    rng = random.Random(seed)
    F = Frame(h["centre"]["x"], h["centre"]["z"], FACING[h["doorSide"]])
    w_x, d_z = (h["size"]["x"], h["size"]["z"]) if h["doorSide"] in "ns" else (h["size"]["z"], h["size"]["x"])
    hx = w_x / 2 - 0.45
    zb, zf = -d_z / 2 + 0.15, d_z / 2 - 1.5            # body back / front (porch in front of zf)
    wall_h = 5.4
    col = BV.tint(h["colour"])
    trim = U.rgba("#FBFAF6")
    roof_t = BV.tint(HOUSE_ROOF.get(h["colour"], "roof_grey"))
    F.box(mb, 0, (zb + zf) / 2, 0.0, 2 * hx + 0.1, zf - zb + 0.1, 0.4, "LM_stone")
    F.box(mb, 0, (zb + zf) / 2, 0.4, 2 * hx, zf - zb, wall_h - 0.4, "LM_render", tint=col)
    for sx in (-1, 1):
        for zz in (zb, zf):
            F.box(mb, sx * (hx - 0.05), zz + (0.05 if zz == zb else -0.05), 0.4, 0.14, 0.14, wall_h - 0.4,
                  "LM_render", tint=trim)
    # belt course between the floors
    F.box(mb, 0, (zb + zf) / 2, 2.95, 2 * hx + 0.08, zf - zb + 0.08, 0.14, "LM_render", tint=trim)
    gable_roof(mb, F, -hx, hx, zb, zf, wall_h, 38, 0.5, "LM_roof", roof_t)
    rise = (zf - zb) / 2 * math.tan(math.radians(38))
    for sx in (-1, 1):
        gable_wall_x(mb, F, sx * hx, zb, zf, wall_h, rise, sx, "LM_render", col)
        wall_feature(mb, F, sx * hx, (zb + zf) / 2, wall_h + 0.25, 0.7, 0.75, (sx, 0), "window_lit", m="M_window",
                     sill=False, uvfn=U.glow_uv)
    # porch: deck, posts, cross gable, rail, steps
    pg_x = 1.75
    zp = d_z / 2 - 0.15
    F.box(mb, 0, zf + (zp - zf) / 2, 0.0, 2 * hx - 0.5, zp - zf, 0.4, "LM_wood", tint=BV.tint("wood_light"))
    for sx in (-1, 1):
        F.box(mb, sx * (pg_x - 0.12), zp - 0.12, 0.4, 0.15, 0.15, 2.5, "LM_render", tint=trim)
    gable_roof(mb, F, -pg_x, pg_x, zf - 0.6, zp, 2.95, 40, 0.25, "LM_roof", roof_t, ridge_along_x=False)
    gable_wall(mb, F, -pg_x, pg_x, zp - 0.05, 2.9, pg_x * math.tan(math.radians(40)), 1, "LM_render", trim)
    for sx in (-1, 1):
        F.box(mb, sx * (pg_x + 0.95), zp - 0.1, 1.2, 1.7, 0.07, 0.07, "LM_render", tint=trim)
        for k in range(6):
            F.box(mb, sx * (pg_x + 0.18 + k * 0.3), zp - 0.1, 0.4, 0.05, 0.05, 0.8, "LM_render", tint=trim)
    for k in range(2):
        F.box(mb, 0, zp + 0.15 + k * 0.28, 0.0, 1.6, 0.3, 0.28 - k * 0.14, "LM_stone")
    wall_feature(mb, F, 0, zf, 0.4, 1.0, 2.15, (0, 1), "door", m="A_paint", sill=False)
    # ground floor windows (glass, flower boxes), upper floor windows (some lit)
    for sx in (-1, 1):
        wall_feature(mb, F, sx * 2.55, zf, 1.05, 1.05, 1.3, (0, 1), "window")
        F.box(mb, sx * 2.55, zf + 0.15, 0.78, 1.15, 0.24, 0.22, "LM_wood", tint=BV.tint("wood_dark"))
        x0, z0 = F.xz(sx * 2.55 - 0.52, zf + 0.17)
        x1, z1 = F.xz(sx * 2.55 + 0.52, zf + 0.17)
        row = rng.choice([0, 1, 2])
        fl.face([V(x0, z0, 0.98), V(x1, z1, 0.98), V(x1, z1, 1.32), V(x0, z0, 1.32)], "M_leaf_flora",
                [(0.1, 1 - (row + 1) * 0.25), (0.45, 1 - (row + 1) * 0.25), (0.45, 1 - row * 0.25), (0.1, 1 - row * 0.25)])
    for lx in (-2.55, 0.0, 2.55):
        if rng.random() < 0.55:
            wall_feature(mb, F, lx, zf, 3.45, 1.0, 1.25, (0, 1), "window_lit", m="M_window", uvfn=U.glow_uv)
        else:
            wall_feature(mb, F, lx, zf, 3.45, 1.0, 1.25, (0, 1), "window")
    for sx in (-1, 1):
        wall_feature(mb, F, sx * hx, (zb + zf) / 2 - 0.2, 1.05, 1.05, 1.3, (sx, 0), "window")
        if rng.random() < 0.5:
            wall_feature(mb, F, sx * hx, (zb + zf) / 2 - 0.2, 3.45, 1.0, 1.2, (sx, 0), "window_lit", m="M_window",
                         uvfn=U.glow_uv)
        else:
            wall_feature(mb, F, sx * hx, (zb + zf) / 2 - 0.2, 3.45, 1.0, 1.2, (sx, 0), "window")
    for xx in (-2.2, 1.8):
        wall_feature(mb, F, xx, zb, 1.05, 1.05, 1.3, (0, -1), "window")
        wall_feature(mb, F, xx, zb, 3.45, 1.0, 1.2, (0, -1), "window")
    mb.cell = "brick"
    F.box(mb, hx * 0.55, (zb + zf) / 2 - 0.5, wall_h + 0.8, 0.55, 0.55, 2.7, "A_paint")
    mb.cell = None
    # shrubs at the porch corners (inside the footprint)
    if F_shrub is not None:
        for sx in (-1, 1):
            px, pz = F.xz(sx * (w_x / 2 - 0.55), d_z / 2 - 0.55)
            PT.shrub(F_shrub, px, pz, 0.9, 0.55, seed + sx)
    return F


def houses(c, cols):
    import parts_trees as PT
    mb = MB()
    fl = MB()
    FS = PT.Forest()
    for i, h in enumerate([s for s in L["sceneryHouses"] if s["kind"] == "house"]):
        # seeds: houses 1-5 as in Task 6; houses 6-10 keep the seed parts_fill gave them before they moved into the layout
        house(mb, fl, h, 60 + i if i < 5 else sum(map(ord, h["id"])), F_shrub=FS)
        b = h["bounds"]
        U.collider(cols, h["node"], b["minX"], b["maxX"], b["minZ"], b["maxZ"], 8.5)
        # garden border around the house (low flowers just outside the footprint)
        x0, x1, z0, z1 = b["minX"], b["maxX"], b["minZ"], b["maxZ"]
        PT.flower_patch(fl, lambda px, pz, x0=x0, x1=x1, z0=z0, z1=z1: not (x0 < px < x1 and z0 < pz < z1),
                        (x0 - 0.7, x1 + 0.7, z0 - 0.7, z1 + 0.7), 0.0, 6.0, [0, 1, 2], 70 + i, h=(0.25, 0.4))
    mb.finish("houses", c)
    fl.finish("houses_flowers", c, cat="leaf", auto=False)
    FS.finish("house_shrubs", c)


# ----------------------------------------------------------------------------------------------- café --

def cafe(c, cols):
    import build_village as BV
    h = next(s for s in L["sceneryHouses"] if s["kind"] == "cafe")
    b = h["bounds"]
    F = Frame(h["centre"]["x"], h["centre"]["z"], FACING[h["doorSide"]])     # front faces west
    mb = MB()
    fl = MB()
    # local: front +z (west). Footprint along x (= z world) 9 m wide, along z (= x world) 12 m deep
    W = h["size"]["z"]           # 9 (local x)
    D = h["size"]["x"]           # 12 (local z)
    zb, zf = -D / 2 + 0.1, D / 2 - 4.6           # building back / front; terrace in front
    hx = W / 2 - 0.2
    wood = BV.tint("wood")
    F.box(mb, 0, (zb + zf) / 2, 0.0, 2 * hx + 0.1, zf - zb + 0.1, 0.25, "LM_stone")
    F.box(mb, 0, (zb + zf) / 2, 0.25, 2 * hx, zf - zb, 3.35, "LM_wood", tint=U.rgba("#D9A77A"))
    # vertical slat rhythm on the front between windows
    for k in range(24):
        lx = -hx + 0.15 + k * (2 * hx - 0.3) / 23
        F.box(mb, lx, zf + 0.03, 0.25, 0.05, 0.06, 3.35, "LM_wood", tint=U.rgba("#B98457"))
    # pitched roof, ridge along x, dark metal
    gable_roof(mb, F, -hx, hx, zb, zf, 3.6, 22, 0.5, "LM_roof", BV.tint("roof_charcoal"), fascia_tint=U.rgba("#5A4636"))
    for sx in (-1, 1):
        gable_wall_x(mb, F, sx * hx, zb, zf, 3.6, (zf - zb) / 2 * math.tan(math.radians(22)), sx, "LM_wood",
                     U.rgba("#D9A77A"))
    # big front windows + glass door, awnings
    for lx in (-2.6, 2.6):
        wall_feature(mb, F, lx, zf + 0.06, 0.6, 2.6, 2.1, (0, 1), "glass", frame_tint=U.rgba("#3A3D42"), sill=False)
    wall_feature(mb, F, 0, zf + 0.06, 0.25, 1.3, 2.4, (0, 1), "door_glass", frame_tint=U.rgba("#3A3D42"), sill=False)
    for lx, wdt in ((-2.6, 3.0), (2.6, 3.0), (0, 1.7)):
        # sloped striped awning, 1.1 m out, with a valance
        a0 = F.p(lx - wdt / 2, zf + 0.08, 3.05)
        a1 = F.p(lx + wdt / 2, zf + 0.08, 3.05)
        b1 = F.p(lx + wdt / 2, zf + 1.2, 2.6)
        b0 = F.p(lx - wdt / 2, zf + 1.2, 2.6)
        uv = [U.region_uv("awning", 0, 0.15), U.region_uv("awning", 1, 0.15), U.region_uv("awning", 1, 1),
              U.region_uv("awning", 0, 1)]
        mb.face([a0, a1, b1, b0], "A_paint", [uv[3], uv[2], uv[1], uv[0]], hint=F.n(0, 1, 2))
        mb.face([a0, a1, b1, b0][::-1], "A_paint", [uv[3], uv[2], uv[1], uv[0]][::-1], hint=F.n(0, -1, -2))
        v0 = b0 - Vector((0, 0, 0.25))
        v1 = b1 - Vector((0, 0, 0.25))
        uvv = [U.region_uv("awning", 0, 0), U.region_uv("awning", 1, 0), U.region_uv("awning", 1, 0.15),
               U.region_uv("awning", 0, 0.15)]
        mb.face([v0, v1, b1, b0], "A_paint", uvv, hint=F.n(0, 1))
    # side windows
    for sx in (-1, 1):
        wall_feature(mb, F, sx * hx, (zb + zf) / 2, 0.9, 2.0, 1.4, (sx, 0), "glass", frame_tint=U.rgba("#3A3D42"))
    # blank sign board above the door
    sb = [F.p(-1.4, zf + 0.12, 3.05), F.p(1.4, zf + 0.12, 3.05), F.p(1.4, zf + 0.12, 3.55), F.p(-1.4, zf + 0.12, 3.55)]
    mb.face(sb, "A_paint", [U.region_uv("sign", 0, 0), U.region_uv("sign", 1, 0), U.region_uv("sign", 1, 1),
                            U.region_uv("sign", 0, 1)], hint=F.n(0, 1))
    # terrace deck, edge planters, parasols, tables, chairs
    zt0, zt1 = zf, D / 2 - 0.05
    F.box(mb, 0, (zt0 + zt1) / 2, 0.0, W - 0.1, zt1 - zt0, 0.12, "LM_wood", tint=U.rgba("#C9A27C"))
    for sx in (-1, 1):
        F.box(mb, sx * (W / 2 - 0.3), (zt0 + zt1) / 2, 0.12, 0.45, zt1 - zt0 - 0.2, 0.5, "LM_wood",
              tint=BV.tint("wood_dark"))
        x0, z0 = F.xz(sx * (W / 2 - 0.3), zt0 + 0.2)
        x1, z1 = F.xz(sx * (W / 2 - 0.3), zt1 - 0.2)
        for kk in range(3):
            t0, t1 = kk / 3, (kk + 1) / 3
            p = [V(x0 + (x1 - x0) * t0, z0 + (z1 - z0) * t0, 0.6), V(x0 + (x1 - x0) * t1, z0 + (z1 - z0) * t1, 0.6),
                 V(x0 + (x1 - x0) * t1, z0 + (z1 - z0) * t1, 1.0), V(x0 + (x1 - x0) * t0, z0 + (z1 - z0) * t0, 1.0)]
            row = (kk + (sx > 0)) % 3
            fl.face(p, "M_leaf_flora", [(0.05, 1 - (row + 1) * 0.25), (0.6, 1 - (row + 1) * 0.25),
                                        (0.6, 1 - row * 0.25), (0.05, 1 - row * 0.25)])
    for (lx, lz) in ((-2.4, zt0 + 1.4), (2.4, zt0 + 1.4), (0.0, zt0 + 3.1)):
        cx, cz = F.xz(lx, lz)
        mb.cell = "table_white"
        mb.lathe(cx, cz, [(0.32, 0.12), (0.06, 0.15), (0.04, 0.72), (0.42, 0.74), (0.42, 0.78), (0.0, 0.78)], "A_paint",
                 segs=14, y0=0.0)
        mb.cell = "metal_grey"
        mb.lathe(cx, cz, [(0.03, 0.78), (0.03, 2.25)], "A_metal", segs=6)
        mb.cell = None
        # parasol canopy: 8 segments, coral/cream
        segs = 8
        for k in range(segs):
            a0, a1 = 2 * math.pi * k / segs, 2 * math.pi * (k + 1) / segs
            top = V(cx, cz, 2.55)
            e0 = V(cx + 1.4 * math.cos(a0), cz + 1.4 * math.sin(a0), 2.05)
            e1 = V(cx + 1.4 * math.cos(a1), cz + 1.4 * math.sin(a1), 2.05)
            u = (k % 2) / 2 + 0.25
            uv = [U.region_uv("parasol", u, 0.9), U.region_uv("parasol", u - 0.1, 0.1), U.region_uv("parasol", u + 0.1, 0.1)]
            mb.face([top, e0, e1], "A_paint", uv, hint=Vector((0, 0, 1)))
            mb.face([top, e1, e0], "A_paint", [uv[0], uv[2], uv[1]], hint=Vector((0, 0, -1)))
        for k in range(3):
            a = 2 * math.pi * k / 3 + 0.4
            chx, chz = cx + 0.75 * math.cos(a), cz + 0.75 * math.sin(a)
            yaw = math.atan2(cx - chx, cz - chz)
            mb.box(chx, chz, 0.12, 0.42, 0.42, 0.34, "LM_wood", yaw=yaw, tint=BV.tint("wood_dark"))
            bx, bz = loc(chx, chz, yaw, 0, -0.2)
            mb.box(bx, bz, 0.46, 0.42, 0.05, 0.42, "LM_wood", yaw=yaw, tint=BV.tint("wood_dark"))
    mb.finish("cafe", c)
    fl.finish("cafe_flowers", c, cat="leaf", auto=False)
    U.collider(cols, h["node"], b["minX"], b["maxX"], b["minZ"], b["maxZ"], 5.0)


# ------------------------------------------------------------------------------------------- memorial --

def memorial(c, cols):
    """The memorial hall exterior on plot_n: a low white-render volume with warm wood slats, a glazed bay (west) and a
    glazed entrance lobby, both with real depth: clear glass (M_glass) in dark aluminium mullions, a warm-lit room
    behind (lit niche wall and ceiling on M_window, light-oak floor), a cantilevered canopy over the door pad, a planted
    roof edge, a stone forecourt and young trees on the lawn. The south face keeps the layout's door recess."""
    import build_village as BV
    import parts_trees as PT
    ex = L["memorial"]["exterior"]
    fp = ex["footprint"]
    x0, x1, z0, z1 = fp["minX"], fp["maxX"], fp["minZ"], fp["maxZ"]     # -7..7, -64..-52
    mb = MB()
    fl = MB()
    FS = PT.Forest()
    H = 4.3
    white = BV.tint("render_white")
    wood = U.rgba("#F2C08A")
    oak = U.rgba("#F6DDBB")
    zr = next(cl for cl in ex["colliders"] if cl["id"] == "memorial_back")["maxZ"]       # recess back -53.2
    zb = -56.0           # back of the glazed bay
    zl = -56.2           # back of the entrance lobby
    gx0, gx1 = -6.4, -2.2  # glazed bay opening (x)
    gy0, gy1 = 0.45, 3.95
    mb.box(0, (z0 + z1) / 2, 0.0, x1 - x0 + 0.2, z1 - z0 + 0.2, 0.3, "LM_stone")
    # west block: solid back, glazed bay in front (end walls, roof slab), white render
    mb.box(-4.3, (z0 + zb) / 2, 0.3, 5.4, zb - z0, H - 0.3, "LM_render", tint=white)
    mb.box((x0 + gx0) / 2, (zb + z1) / 2, 0.3, gx0 - x0, z1 - zb, H - 0.3, "LM_render", tint=white)
    mb.box((gx1 - 1.6) / 2, (zb + z1) / 2, 0.3, -1.6 - gx1, z1 - zb, H - 0.3, "LM_render", tint=white)
    mb.box((gx0 + gx1) / 2, (zb + z1) / 2, gy1, gx1 - gx0, z1 - zb, H - gy1, "LM_render", tint=white)
    mb.box((gx0 + gx1) / 2, z1 - 0.15, 0.3, gx1 - gx0, 0.3, gy0 - 0.3, "LM_stone")
    # east block: solid, with slats and a lit band behind them
    mb.box(4.3, (z0 + z1) / 2, 0.3, 5.4, z1 - z0, H - 0.3, "LM_render", tint=white)
    # centre: solid back, the entrance lobby behind the recess, a lintel over both
    mb.box(0, (z0 + zl) / 2, 0.3, 3.2, zl - z0, H - 0.3, "LM_render", tint=white)
    mb.box(0, (zl + z1) / 2, 3.35, 3.2, z1 - zl, H - 3.35, "LM_render", tint=white)

    def room(xa, xb, za, zback, ya, yb, region_wall):
        """Interior surfaces seen through the glass: floor (light oak, light-mapped), lit back wall and ceiling."""
        mb.face([V(xa, za, ya + 0.01), V(xb, za, ya + 0.01), V(xb, zback, ya + 0.01), V(xa, zback, ya + 0.01)], "LM_wood",
                tint=oak, hint=Vector((0, 0, 1)))
        mb.face([V(xa, zback + 0.01, ya), V(xb, zback + 0.01, ya), V(xb, zback + 0.01, yb), V(xa, zback + 0.01, yb)],
                "M_window", U.quad_uvs(U.glow_uv, region_wall), hint=Vector((0, -1, 0)))
        mb.face([V(xa, za, yb - 0.01), V(xb, za, yb - 0.01), V(xb, zback, yb - 0.01), V(xa, zback, yb - 0.01)],
                "M_window", U.quad_uvs(U.glow_uv, "ceiling_lit"), hint=Vector((0, 0, -1)))
        U.light("window", V((xa + xb) / 2, (za + zback) / 2, yb - 0.3))

    room(gx0, gx1, z1 - 0.3, zb, 0.3, gy1, "interior")
    room(-1.6, 1.6, zr, zl, 0.3, 3.35, "interior")

    def glazing(xa, xb, z, ya, yb, mullions, transom=None, face=Vector((0, -1, 0))):
        """Clear glass panes between dark aluminium mullions, with a head, a sill and an optional transom."""
        xs = [xa + (xb - xa) * i / mullions for i in range(mullions + 1)]
        for a, b in zip(xs[:-1], xs[1:]):
            mb.face([V(a, z, ya), V(b, z, ya), V(b, z, yb), V(a, z, yb)], "A_glass_clear",
                    [(0, 0), (1, 0), (1, 1), (0, 1)], hint=face)
        mb.cell = "frame_dark"
        for x in xs:
            mb.box(x, z - 0.03, ya, 0.07, 0.12, yb - ya, "A_metal")
        for y in (ya - 0.04, yb) + ((transom,) if transom else ()):
            mb.box((xa + xb) / 2, z - 0.03, y, xb - xa + 0.07, 0.12, 0.07, "A_metal")
        mb.cell = None

    glazing(gx0, gx1, z1 - 0.06, gy0, gy1 - 0.02, 4, transom=3.0)
    glazing(-1.6, 1.6, zr + 0.02, 0.32, 3.33, 4, transom=2.55)
    # parapet, roof deck, planted roof edge (sedum strip + low clipped shrubs)
    for (bx, bz, sx, sz) in ((0, z0 + 0.1, x1 - x0, 0.2), (0, z1 - 0.1, x1 - x0, 0.2), (x0 + 0.1, (z0 + z1) / 2, 0.2, z1 - z0),
                             (x1 - 0.1, (z0 + z1) / 2, 0.2, z1 - z0)):
        mb.box(bx, bz, H, sx, sz, 0.45, "LM_render", tint=white)
    mb.box(0, (z0 + z1) / 2, H, x1 - x0 - 0.4, z1 - z0 - 0.4, 0.05, "LM_concrete")
    k = 0
    for (bx, bz, sx, sz) in ((0, z1 - 0.75, x1 - x0 - 0.4, 1.1), (0, z0 + 0.75, x1 - x0 - 0.4, 1.1),
                             (x0 + 0.75, (z0 + z1) / 2, 1.1, z1 - z0 - 2.6), (x1 - 0.75, (z0 + z1) / 2, 1.1, z1 - z0 - 2.6)):
        mb.box(bx, bz, H + 0.05, sx, sz, 0.32, "LM_grass")
        n = int(max(sx, sz) / 0.95)
        for i in range(n):
            t = (i + 0.5) / n - 0.5
            px = bx + (t * sx if sx > sz else 0.0)
            pz = bz + (t * sz if sz > sx else 0.0)
            PT.shrub(FS, px, pz, 0.55, 0.38, 900 + k, y0=H + 0.37)
            k += 1
    # warm wood slat cladding on the south façade (east block) and the bay's west pier
    for k in range(int(4.9 / 0.13)):
        lx = 1.75 + 0.07 + k * 0.13
        mb.box(lx, z1 + 0.04, 0.3, 0.06, 0.08, H - 0.3, "LM_wood", tint=wood)
    for k in range(int(0.55 / 0.13)):
        lx = -6.95 + k * 0.13
        mb.box(lx, z1 + 0.04, 0.3, 0.06, 0.08, H - 0.3, "LM_wood", tint=wood)
    pts = [V(1.75, z1 + 0.005, 0.35), V(6.95, z1 + 0.005, 0.35), V(6.95, z1 + 0.005, H - 0.15), V(1.75, z1 + 0.005, H - 0.15)]
    mb.face(pts, "M_window", U.quad_uvs(U.glow_uv, "interior"), hint=Vector((0, -1, 0)))
    U.light("window", V(4.3, z1 + 0.6, 2.0))
    # side walls: long window bands (lit interior)
    for sx in (-1, 1):
        for zz in (-61.5, -57.5):
            wall_feature(mb, Frame(0, 0, 0), sx * 7.0, zz, 0.7, 3.4, 2.8, (sx, 0), "interior", m="M_window",
                         frame_tint=U.rgba("#3A3D42"), sill=False, uvfn=U.glow_uv)
    # recess soffit in warm wood
    mb.box(0, (zr + z1) / 2, 3.3, 3.2, z1 - zr, 0.05, "LM_wood", tint=wood)
    # cantilevered entrance canopy (white slab, wood soffit) projecting over the door pad
    mb.box(0, z1 + 1.15, 3.35, 7.6, 2.5, 0.28, "LM_render", tint=white)
    mb.box(0, z1 + 1.15, 3.33, 7.4, 2.4, 0.03, "LM_wood", tint=wood)
    # forecourt, a low stone bench, the blank name plaque, planted strips
    mb.box(0, -50.6, 0.0, 7.0, 3.2, 0.03, "LM_stone")
    mb.box(-4.8, -50.4, 0.0, 2.2, 0.55, 0.45, "LM_stone")
    U.collider(cols, "col__memorial_bench", -5.95, -3.65, -50.73, -50.07, 0.5)
    mb.cell = "frame_dark"
    mb.box(4.4, z1 + 0.15, 0.3, 2.2, 0.1, 0.5, "A_paint")
    mb.cell = None
    for (xa, xb) in ((-6.8, -1.9), (1.9, 6.8)):
        PT.flower_patch(fl, lambda px, pz, xa=xa, xb=xb: xa < px < xb and -51.95 < pz < -51.55,
                        (xa, xb, -51.95, -51.55), 0.02, 30.0, [0, 2, 3], 950 + int(xa), h=(0.3, 0.45), w=(0.4, 0.7))
    for cl in ex["colliders"]:
        U.collider(cols, cl["node"], cl["minX"], cl["maxX"], cl["minZ"], cl["maxZ"], H)
    mb.finish("memorial", c)
    fl.finish("memorial_planting", c, cat="leaf", auto=False)
    FS.finish("memorial_roof_shrubs", c)
    # young trees (수목장 rows) on the lawn: both sides and the back
    trees = []
    for zz in (-51.5, -56.0, -60.5):
        trees += [(-8.2, zz, 2.9), (8.2, zz, 2.7)]
    for xx in (-6.0, -2.0, 2.0, 6.0):
        trees.append((xx, -65.6, 2.6))
    PT.memorial_trees(c, trees)


# ---------------------------------------------------------------------------------------------- plots --

def plots(c, cols):
    lawn = MB()
    glow = MB()
    mb = MB()
    for p in L["plots"]:
        b = p["bounds"]
        x0, x1, z0, z1 = b["minX"], b["maxX"], b["minZ"], b["maxZ"]
        y = 0.02
        pts = [V(x0, z1, y), V(x1, z1, y), V(x1, z0, y), V(x0, z0, y)]
        lawn.face(pts, "LM_lawn", [(0, 0), (1, 0), (1, 1), (0, 1)], hint=Vector((0, 0, 1)))
        if p["id"] == "plot_n":
            continue
        # glowing outline: a raised strip 0.15 wide, 0.1 m inside the plot edge
        inset, wdt, hy = 0.1, 0.15, 0.06
        for (ax, az, bx, bz) in ((x0 + inset, z0 + inset, x1 - inset, z0 + inset + wdt),
                                 (x0 + inset, z1 - inset - wdt, x1 - inset, z1 - inset),
                                 (x0 + inset, z0 + inset + wdt, x0 + inset + wdt, z1 - inset - wdt),
                                 (x1 - inset - wdt, z0 + inset + wdt, x1 - inset, z1 - inset - wdt)):
            glow.box((ax + bx) / 2, (az + bz) / 2, 0.0, bx - ax, bz - az, hy, "M_glow_plot")
        sp = p["signPost"]
        if sp:
            sign_post(mb, sp["x"], sp["z"], FACING[sp["facing"]])
        if p["underConstruction"]:
            construction(mb, p, cols)
    lawn.finish("plot_lawns", c)
    glow.finish("plot_outlines", c, cat="glow", auto=False)
    mb.finish("plot_props", c)


def sign_post(mb, x, z, yaw):
    """Small wooden sign: two posts, a blank light board (runtime text goes on it), a little roof."""
    for lx in (-0.5, 0.5):
        px, pz = loc(x, z, yaw, lx, 0)
        mb.box(px, pz, 0.0, 0.09, 0.09, 1.55, "LM_wood", yaw=yaw, tint=U.rgba("#B07A50"))
    bx, bz = loc(x, z, yaw, 0, 0.05)
    mb.box(bx, bz, 0.75, 1.2, 0.06, 0.7, "LM_wood", yaw=yaw, tint=U.rgba("#C89363"))
    fx, fz = loc(x, z, yaw, 0, 0.085)
    a = loc(x, z, yaw, -0.54, 0.085)
    b = loc(x, z, yaw, 0.54, 0.085)
    pts = [V(a[0], a[1], 0.8), V(b[0], b[1], 0.8), V(b[0], b[1], 1.4), V(a[0], a[1], 1.4)]
    nx, nz = math.sin(yaw), math.cos(yaw)
    mb.face(pts, "A_paint", [U.region_uv("sign", 0.06, 0.1), U.region_uv("sign", 0.94, 0.1),
                             U.region_uv("sign", 0.94, 0.9), U.region_uv("sign", 0.06, 0.9)], hint=V(nx, nz) - V(0, 0))
    rx, rz = loc(x, z, yaw, 0, 0.0)
    mb.box(rx, rz, 1.55, 1.4, 0.3, 0.06, "LM_wood", yaw=yaw, tint=U.rgba("#8C6A52"))


def construction(mb, p, cols):
    """plot_w (library): concrete frame under construction in the west part of the plot, scaffold with green
    mesh, a yellow tower crane. The plot centre stays free (sign + walk-on)."""
    b = p["bounds"]
    x0, x1 = b["minX"] + 0.8, b["minX"] + 4.8            # -64.2 .. -60.2
    z0, z1 = b["minZ"] + 1.8, b["maxZ"] - 1.8            # 7.8 .. 22.2
    # foundation slab
    mb.box((x0 + x1) / 2, (z0 + z1) / 2, 0.0, x1 - x0, z1 - z0, 0.25, "LM_concrete")
    # columns and two floor slabs (white concrete frame), part of the second floor
    for xi in range(3):
        for zi in range(5):
            cx = x0 + 0.4 + xi * (x1 - x0 - 0.8) / 2
            cz = z0 + 0.4 + zi * (z1 - z0 - 0.8) / 4
            mb.box(cx, cz, 0.25, 0.35, 0.35, 6.6 if zi < 3 else 3.4, "LM_concrete")
    mb.box((x0 + x1) / 2, (z0 + z1) / 2, 3.4, x1 - x0, z1 - z0, 0.3, "LM_concrete")
    mb.box((x0 + x1) / 2, z0 + (z1 - z0) * 0.3, 6.6, x1 - x0, (z1 - z0) * 0.6, 0.3, "LM_concrete")
    # scaffold: tubes on the east (plot-centre) side and the north/south ends
    mb.cell = "scaffold"
    sx = x1 + 0.9
    for k in range(9):
        zz = z0 + k * (z1 - z0) / 8
        for dx in (0.0, 0.8):
            mb.box(sx + dx, zz, 0.0, 0.06, 0.06, 7.6, "A_metal")
    for lvl in range(5):
        y = 0.4 + lvl * 1.8
        for dx in (0.0, 0.8):
            mb.box(sx + dx, (z0 + z1) / 2, y, 0.05, z1 - z0, 0.05, "A_metal")
        if lvl > 0:
            mb.box(sx + 0.4, (z0 + z1) / 2, y - 0.04, 0.85, z1 - z0, 0.04, "A_paint")
    mb.cell = None
    # green safety mesh on the upper scaffold (one face each way)
    for side in (1, -1):
        xx = sx + 0.85 + side * 0.01
        pts = [V(xx, z0, 3.8), V(xx, z1, 3.8), V(xx, z1, 7.6), V(xx, z0, 7.6)]
        mb.face(pts, "A_paint", [U.region_uv("net", 0, 0), U.region_uv("net", 4, 0), U.region_uv("net", 4, 1),
                                 U.region_uv("net", 0, 1)], hint=Vector((side, 0, 0)))
    # site props: pallets, pipe stack, cement bags
    mb.cell = "plank"
    mb.box(x0 + 1.2, z1 - 1.0, 0.25, 1.2, 1.0, 0.14, "A_paint")
    mb.box(x0 + 1.2, z1 - 1.0, 0.39, 1.0, 0.8, 0.5, "A_paint")
    mb.cell = None
    # tower crane: lattice mast (box + cross-brace faces), slewing unit, jib toward the plot centre, counter-jib
    mx, mz = x0 + 1.0, z0 + 1.2
    Hm = 21.0
    mb.cell = "crane_yellow"
    for (dx, dz) in ((-0.8, -0.8), (0.8, -0.8), (0.8, 0.8), (-0.8, 0.8)):
        mb.box(mx + dx * 0.95, mz + dz * 0.95, 0.0, 0.14, 0.14, Hm, "A_paint")
    for lvl in range(int(Hm / 1.6)):
        y = lvl * 1.6
        for (ax, az, bx, bz) in ((-0.76, -0.76, 0.76, -0.76), (0.76, -0.76, 0.76, 0.76), (0.76, 0.76, -0.76, 0.76),
                                 (-0.76, 0.76, -0.76, -0.76)):
            p0 = V(mx + ax, mz + az, y)
            p1 = V(mx + bx, mz + bz, y + 1.6)
            mb.tube([p0, p1], [0.04, 0.04], "A_paint", segs=4, smooth=False)
            mb.box(mx + (ax + bx) / 2, mz + (az + bz) / 2, y, abs(bx - ax) + 0.08, abs(bz - az) + 0.08, 0.06, "A_paint")
    # jib: triangular lattice reaching east over the plot, counter-jib west
    jy = Hm + 0.4
    mb.box(mx, mz, Hm, 2.0, 2.0, 1.0, "A_paint")
    mb.cell = "white"
    mb.box(mx + 0.9, mz - 1.0, Hm + 0.2, 1.3, 1.2, 1.4, "A_paint")       # cab
    mb.cell = "crane_yellow"
    jl, cjl = 24.0, 8.0
    for (zz, yy) in ((mz - 0.5, jy), (mz + 0.5, jy), (mz, jy + 1.1)):
        mb.box(mx + jl / 2, zz, yy, jl, 0.12, 0.12, "A_paint")
        mb.box(mx - cjl / 2, zz, yy, cjl, 0.12, 0.12, "A_paint")
    for k in range(int(jl / 1.5)):
        xx = mx + k * 1.5
        mb.tube([V(xx, mz - 0.5, jy), V(xx + 0.75, mz, jy + 1.1), V(xx + 1.5, mz + 0.5, jy)], [0.035, 0.035, 0.035],
                "A_paint", segs=4, smooth=False)
    # A-frame (tower head) and pendant lines
    mb.tube([V(mx, mz, Hm + 1.0), V(mx, mz, Hm + 6.5)], [0.12, 0.08], "A_paint", segs=4, smooth=False)
    mb.cell = "steel"
    mb.tube([V(mx, mz, Hm + 6.5), V(mx + jl * 0.7, mz, jy + 1.1)], [0.025, 0.025], "A_metal", segs=4, smooth=False)
    mb.tube([V(mx, mz, Hm + 6.5), V(mx - cjl, mz, jy + 1.1)], [0.025, 0.025], "A_metal", segs=4, smooth=False)
    # hook line + block
    hxp = mx + 14.0
    mb.tube([V(hxp, mz, jy), V(hxp, mz, 9.5)], [0.015, 0.015], "A_metal", segs=4, smooth=False)
    mb.cell = "crane_yellow"
    mb.box(hxp, mz, 9.0, 0.35, 0.25, 0.5, "A_paint")
    mb.cell = "concrete_light"
    for k in range(3):
        mb.box(mx - cjl + 1.0 + k * 1.1, mz, jy - 1.4, 1.0, 1.2, 1.4, "A_paint")
    mb.cell = None
    U.collider(cols, "col__construction", round(x0 - 0.2, 2), round(sx + 1.0, 2), round(z0 - 0.2, 2),
               round(z1 + 0.2, 2), 8.0)
