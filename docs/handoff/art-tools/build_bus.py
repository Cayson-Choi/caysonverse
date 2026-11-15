"""The village bus (마을버스) — a 9 m low-floor midibus modelled by script (Blender 5.2, background). No generators, no
photos in the textures, no maker, company or route; the only lettering is the village's own name (livery r4).

  blender -b --factory-startup -P art/village/tools/build_bus.py -- [--out <glb>] [--renders <dir>] [--noao] [--blend <file>]
  (--tex <dir> anywhere on the command line reads another texture set instead of art/village/work/tex_bus)

Proportions follow the research sheet (scratchpad villagebus/research/bus_spec_ko.md; a 9,045 mm low-floor midibus's
dimension drawing read on a mm grid): 9.0 m long, 2.49 m wide, roof 3.05 m (3.28 on the roof air conditioner),
wheelbase 4.40, overhangs 2.35 / 2.25, 275/70R22.5 tyres (956 mm), front single and rear twin wheels, two passenger doors
on the right (+x: the kerb side, the shelter's side in the village), rabbit-ear mirrors, roof AC, two hatches.

Axes: Blender X = the bus's right (doors), +Y = forward, Z = up; the origin is the middle of the footprint on the ground
(the game's +x, -z and +y: the village puts it at busStop.bus.centre facing north). "xf" is the distance back from the
front face, "h" the height.

Body: horizontal outline rings (a rounded rectangle per height: tumblehome, the raked and bowed windscreen, the roof's
rolled edges) lofted bottom to top and capped with a crowned roof; windows, doors and the windscreen are openings in
the loft with real frame returns and inset glass; wheel arches are radial panels with a trim, a wheel well and mud
flaps. Then the parts: bumpers, lamps, mirrors, wipers, plates, wheels (tyres with tread and sidewall, rims with nuts),
roof AC / hatches / vent, side markers, and the cabin seen through the glass (floor and steps, seats, poles, rails and
hand straps, ceiling with LED strips, the driver's place).

Materials (4 draw calls): M_bus (the atlas: base colour, ORM = clear coat / roughness / metalness, emissive),
M_bus_glass (tinted, see-through), M_bus_led (the destination signs), M_bus_ground (a quad on the road round the bus,
5 cm up: its map's red is the ambient occlusion the bus casts on the road (its contact shadow), green the low beams'
pool ahead at night). Ambient occlusion is baked into
COLOR_0, one value per vertex (so the exporter can merge the corners of smooth surfaces).

Bus review r2 (2026-11-11): the lower front rebuilt on its own plan (front_plan / fp): recessed headlamp pockets with a
bezel, a silver housing, chrome reflector bowls, a projector lens, an amber indicator, a fog lamp and an LED strip; a
raised DRL band with LED dots; a moulded bumper with a black lip, an air intake and a tow-hook cover; the plate on a
holder. Moulded seats, deeper wheels (hub flange, hex nuts, a proud hub cap), tyres with a rim-protector ridge.
Bus review r3 (2026-11-11): the cabin's walls no longer stand through the rounded front corners (CABIN_FRONT); the
headlamp pocket as on the real bus (two round lamps stacked in glossy black); the rear bumper is the lowest thing at the
back and runs out into the sides; round door stickers; the ground quad lifted over the road.
Bus review r4 (2026-11-11): no long shadow from the day bake's sun (it fell 9 m across the verge onto the plaza): the
ground quad keeps the contact shadow alone (within 0.5 m of the body, inside the road's kerbs) and, at night, a modest
pool of the low beams ahead; the kerb-side mirror pulled back behind the front face (the rabbit ears' heads are covered
by colliders of their own in the game's walk geometry: shared villageLayout busMirrorColliders).
Livery r4 (2026-11-11, the owner's pick 1안 "달빛 남색"): plain bands drawn by make_bus_textures.py (pearl white body,
navy skirt to 0.70 m, one violet line, white roof band); "☾ 케이슨 마을" in Jua (art/village/fonts, SIL OFL) as thin
decals 4 mm proud of the paint on both sides and the rear (wordmarks(); kept out of the AO bake and given the AO of the
paint behind them, decal_ao()); the LED signs read 케이슨 마을 (front, kerb side) and 마을버스 (rear).
Textures: art/village/work/tex_bus (make_bus_textures.py).
"""
import bisect
import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TEXB = os.path.join(ROOT, "work", "tex_bus")
if "--tex" in sys.argv:
    TEXB = sys.argv[sys.argv.index("--tex") + 1]
ATL = json.load(open(os.path.join(TEXB, "bus_atlas.json"), encoding="utf-8"))
REPO = "D:/Codex/cayson-games/caysonverse-carts"


def arg(name, default=None):
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return a[a.index(name) + 1] if name in a else default


def flag(name):
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return name in a


OUT = arg("--out", os.path.join(ROOT, "export", "village_bus.glb"))
RENDERS = arg("--renders")
BLEND = arg("--blend", os.path.join(ROOT, "work", "village_bus.blend"))


def log(*a):
    print("[bus]", *a, flush=True)


# ============================================================================================ dimensions ==
L = 9.0
HALF = L / 2
RS, RF, RR = 0.22, 0.44, 0.42          # roll radii: sides, front cap, rear cap
RCF, RCR = 0.25, 0.20                  # plan-view corner radii, front and rear
MOULD = 0.012                          # the bottom moulding stands proud by this much
WHEEL_R, WHEEL_Z = 0.478, 0.470
AXLES = (2.35, 6.75)                   # xf of the axles
ARCH_R, ARCH_BOX, ARCH_TOP = 0.58, 0.80, 1.12
TOP = 3.02                             # where the rolled edges meet the roof
RAKE = math.tan(math.radians(6))

# Bus-ride 2026-11-15: the body is TALLER, the footprint (9.0 x 2.5 m: the lane, the kerb and the centre line) is not. A standing
# chibi avatar is 2.52 m to the head and 3.03 m to the hat on the 0.34 floor, the old ceiling was 2.50. Everything above the
# sill (1.28) is built as before, in "old" heights, and its vertices are remapped when each part is finished: the window band
# 1.28..2.20 becomes 1.28..2.75, the band up to the roof edge 2.20..3.02 becomes 2.75..3.45, above it a plain lift (the roof
# pods top 3.75). Mirrors keep their height (head height), the destination signs and the roof kit are lifted rigidly.
HK = [(0.0, 0.0), (1.28, 1.28), (2.20, 2.75), (3.02, 3.45), (6.0, 6.43)]


def HN(h):
    """Old height -> new height."""
    for (a0, b0), (a1, b1) in zip(HK[:-1], HK[1:]):
        if h <= a1:
            return b0 + (h - a0) * (b1 - b0) / (a1 - a0)
    return h + HK[-1][1] - HK[-1][0]


def HO(h):
    """New height -> old height."""
    for (a0, b0), (a1, b1) in zip(HK[:-1], HK[1:]):
        if h <= b1:
            return a0 + (h - b0) * (a1 - a0) / (b1 - b0)
    return h - HK[-1][1] + HK[-1][0]


def Yof(xf):
    return HALF - xf


def W(h):
    """Half width of the body at height h (tumblehome above the waist, the rolled roof edge)."""
    if h < 0.383:
        return 1.245 + MOULD
    if h <= 1.28:
        return 1.245
    if h <= 2.45:
        return 1.245 - 0.030 * (h - 1.28) / 1.17
    if h <= 2.80:
        return 1.215 - 0.010 * (h - 2.45) / 0.35
    dz = min(h - 2.80, RS)
    return 1.205 - (RS - math.sqrt(RS * RS - dz * dz))


def F(h):
    """xf of the front face (the corners' tangent line): upright below the windscreen, 6 deg rake, then the cap's roll."""
    if h < 0.383:
        return 0.03 - MOULD
    if h <= 1.05:
        return 0.03
    if h <= 2.58:
        return 0.03 + RAKE * (h - 1.05)
    f0 = 0.03 + RAKE * 1.53
    dz = min(h - 2.58, RF)
    return f0 + RF - math.sqrt(RF * RF - dz * dz)


def R(h):
    """xf of the rear face: the bumper level furthest back, leaning forward going up, then the rear roll."""
    if h < 0.383:
        return 8.97 + MOULD
    if h <= 0.60:
        return 8.97
    if h <= 2.60:
        return 8.97 - 0.20 * (h - 0.60) / 2.0
    dz = min(h - 2.60, RR)
    return 8.77 - (RR - math.sqrt(RR * RR - dz * dz))


def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def BOWF(h):
    """How far the middle of the front stands ahead of its corners (the windscreen's curve in plan)."""
    b = 0.06 + 0.02 * smoothstep(0.95, 1.3, h)
    if h > 2.58:
        b *= 1 - 0.5 * (min(h, TOP) - 2.58) / (TOP - 2.58)
    return b


BOWR = 0.03

# Rings: every height an opening, a panel edge or a texture band needs, then the rolled edges.
HS = [0.25, 0.38, 0.385, 0.50, 0.65, 0.80, 0.95, 1.05, 1.12, 1.28, 1.60, 1.95, 2.20, 2.25, 2.31, 2.45, 2.55, 2.58,
      2.66, 2.74, 2.80, 2.86, 2.91, 2.95, 2.985, 3.005, TOP]

# Side stations (xf): window, door, pillar and arch edges.
WIN_R = [(1.55, 2.95), (3.05, 4.28), (5.82, 7.50), (7.60, 8.45)]
WIN_L = [(0.40, 1.50), (1.55, 2.95), (3.05, 4.55), (4.65, 6.00), (6.10, 7.50), (7.60, 8.45)]
DOORS = [(0.40, 1.49), (4.35, 5.75)]
ARCH_TOP_ST = [1.75, 1.95, 2.15, 2.35, 2.55, 2.75, 2.95]


def arch_stations(c):
    return [c - ARCH_BOX] + [c + d for d in (-0.6, -0.4, -0.2, 0.0, 0.2, 0.4, 0.6)] + [c + ARCH_BOX]


def stations(wins, extra):
    s = set(extra)
    for a, b in wins:
        s.update((a, b))
    for c in AXLES:
        s.update(arch_stations(c))
    return sorted(round(x, 4) for x in s)


ST_R = stations(WIN_R + DOORS, [0.40, 3.70, 8.05])
ST_L = stations(WIN_L, [0.40, 3.80, 5.30, 8.05])
NCF, NF, NCR, NB = 6, 14, 5, 10


def outline(h, w=None, f=None, r=None, rcf=RCF, rcr=RCR, bf=None, br=BOWR):
    """The body's plan outline at height h: points (X, xf, seg, param, nX, nY) in a fixed order (clockwise from above):
    right side front->rear, rear-right corner, rear, rear-left corner, left side rear->front, front-left corner, front,
    front-right corner. (nX, nY) is the outward normal in Blender's XY."""
    w = W(h) if w is None else w
    f = F(h) if f is None else f
    r = R(h) if r is None else r
    bf = BOWF(h) if bf is None else bf
    rcf = min(rcf, w)
    rcr = min(rcr, w)
    ce, cs = f + rcf, r - rcr
    pts = []
    for xf in [ce] + ST_R:
        pts.append((w, min(max(xf, ce), cs), "R", xf, 1.0, 0.0))
    for k in range(NCR):
        a = k / NCR * math.pi / 2
        pts.append(((w - rcr) + rcr * math.cos(a), cs + rcr * math.sin(a), "RR", a, math.cos(a), -math.sin(a)))
    ew = w - rcr
    for k in range(NB):
        X = ew - 2 * ew * k / NB
        u = math.pi * X / (2 * ew) if ew > 1e-6 else 0.0
        xf = r + br * math.cos(u) ** 2
        d = -br * math.sin(2 * u) * (math.pi / (2 * ew) if ew > 1e-6 else 0)   # dxf/dX
        n = Vector((-d, -1.0)).normalized()    # rear: -Y (xf grows backward, Y = HALF - xf)
        pts.append((X, xf, "B", X, n.x, n.y))
    for k in range(NCR):
        a = math.pi / 2 * (1 - k / NCR)
        pts.append((-(w - rcr) - rcr * math.cos(a), cs + rcr * math.sin(a), "RL", a, -math.cos(a), -math.sin(a)))
    for xf in [cs] + list(reversed(ST_L)):
        pts.append((-w, min(max(xf, ce), cs), "L", xf, -1.0, 0.0))
    for k in range(NCF):
        a = k / NCF * math.pi / 2
        pts.append((-(w - rcf) - rcf * math.cos(a), ce - rcf * math.sin(a), "FL", a, -math.cos(a), math.sin(a)))
    ew = w - rcf
    for k in range(NF):
        X = -ew + 2 * ew * k / NF
        u = math.pi * X / (2 * ew) if ew > 1e-6 else 0.0
        xf = f - bf * math.cos(u) ** 2
        d = bf * math.sin(2 * u) * (math.pi / (2 * ew) if ew > 1e-6 else 0)    # dxf/dX
        n = Vector((d, 1.0)).normalized()
        pts.append((X, xf, "F", X, n.x, n.y))
    for k in range(NCF):
        a = math.pi / 2 * (1 - k / NCF)
        pts.append(((w - rcf) + rcf * math.cos(a), ce - rcf * math.sin(a), "FR", a, math.cos(a), math.sin(a)))
    return pts


def surface(h, seg, param, out=0.0):
    """A point on the body (and its outward normal) at height h: seg 'F' with X, 'FR'/'FL' with the corner angle,
    'R'/'L' with xf, 'B' with X, 'RR'/'RL' with the angle. `out` pushes it along the normal."""
    w, f, r, bf = W(h), F(h), R(h), BOWF(h)
    if seg == "F":
        ew = w - RCF
        u = math.pi * param / (2 * ew)
        xf = f - bf * math.cos(u) ** 2
        d = bf * math.sin(2 * u) * math.pi / (2 * ew)
        n = Vector((d, 1.0, 0)).normalized()
        p = Vector((param, Yof(xf), h))
    elif seg in ("FR", "FL"):
        s = 1 if seg == "FR" else -1
        a = param
        X = s * ((w - RCF) + RCF * math.cos(a))
        xf = f + RCF - RCF * math.sin(a)
        n = Vector((s * math.cos(a), math.sin(a), 0))
        p = Vector((X, Yof(xf), h))
    elif seg in ("R", "L"):
        s = 1 if seg == "R" else -1
        n = Vector((s, 0, 0))
        p = Vector((s * w, Yof(param), h))
    elif seg == "B":
        ew = w - RCR
        u = math.pi * param / (2 * ew)
        xf = r + BOWR * math.cos(u) ** 2
        d = -BOWR * math.sin(2 * u) * math.pi / (2 * ew)
        n = Vector((-d, -1.0, 0)).normalized()
        p = Vector((param, Yof(xf), h))
    else:  # RR / RL
        s = 1 if seg == "RR" else -1
        a = param
        X = s * ((w - RCR) + RCR * math.cos(a))
        xf = r - RCR + RCR * math.sin(a)
        n = Vector((s * math.cos(a), -math.sin(a), 0))
        p = Vector((X, Yof(xf), h))
    return p + n * out, n


# ================================================================================================ atlas ==
NA = ATL["size"]
REG = ATL["regions"]


def apx(px, py):
    return (px / NA, 1.0 - py / NA)


def rpx(region, px, py, m=1.5):
    """Atlas px clamped 1.5 px inside a region's edges: bilinear filtering never reads the neighbour."""
    x0, y0, w, hh = REG[region]
    return apx(min(max(px, x0 + m), x0 + w - m), min(max(py, y0 + m), y0 + hh - m))


def cell(name):
    c = ATL["cells"][name]
    return apx(c[0], c[1])


def side_uv(right, xf, h):
    reg = "side_r" if right else "side_l"
    x0, y0, w, hh = REG[reg]
    lo, hi = ATL["side_h"]
    return rpx(reg, x0 + min(max(xf, 0), L) / L * w, y0 + (hi - min(max(h, lo), hi)) / (hi - lo) * hh)


def front_uv(X, h):
    x0, y0, w, hh = REG["front"]
    lo, hi = ATL["front_h"]
    hw = ATL["half_w"]
    return rpx("front", x0 + (hw - X) / (2 * hw) * w, y0 + (hi - min(max(h, lo), hi)) / (hi - lo) * hh)


def rear_uv(X, h):
    x0, y0, w, hh = REG["rear"]
    lo, hi = ATL["rear_h"]
    hw = ATL["half_w"]
    return rpx("rear", x0 + (X + hw) / (2 * hw) * w, y0 + (hi - min(max(h, lo), hi)) / (hi - lo) * hh)


def reflector_uv(X, h):
    x0, y0, w, hh = REG["reflector"]
    lo, hi = ATL["bumper_r_h"]
    hw = ATL["half_w"]
    return rpx("reflector", x0 + (min(max(X, -hw), hw) + hw) / (2 * hw) * w, y0 + (hi - min(max(h, lo), hi)) / (hi - lo) * hh)


def region_uv(name, s, t):
    """(s, t) in 0..1 across a region, t = 0 at its top."""
    x0, y0, w, hh = REG[name]
    return rpx(name, x0 + s * w, y0 + t * hh, m=1.0)


def led_uv(kind, s, t):
    x0, y0, w, hh = ATL["led"][kind]
    lw, lh = ATL["led_size"]
    return ((x0 + s * w) / lw, 1.0 - (y0 + t * hh) / lh)


# ============================================================================================ mesh parts ==
BODY, GLASS, LED, GROUND = 0, 1, 2, 3
PARTS = []


class Part:
    def __init__(self, name, rm="stretch"):
        self.name = name
        self.rm = rm
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")

    def v(self, co):
        return self.bm.verts.new(co)

    def face(self, verts, uvs, mat=BODY, smooth=False):
        if len({id(v) for v in verts}) < 3:
            return None
        try:
            f = self.bm.faces.new(verts)
        except ValueError:
            return None
        f.material_index = mat
        f.smooth = smooth
        if callable(uvs):
            for l in f.loops:
                l[self.uv].uv = uvs(l.vert.co)
        elif isinstance(uvs, str):
            c = cell(uvs)
            for l in f.loops:
                l[self.uv].uv = c
        else:
            for l, uv in zip(f.loops, uvs):
                l[self.uv].uv = uv
        return f

    def poly(self, cos, uvs, mat=BODY, smooth=False):
        return self.face([self.v(Vector(c)) for c in cos], uvs, mat, smooth)

    def box(self, centre, size, uvs="black", mat=BODY, rot=None, faces=None):
        """Box: centre, size (x, y, z), optional rotation matrix (3x3); `faces` maps '+x','-x',... to a swatch."""
        c = Vector(centre)
        hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
        M = rot or Matrix.Identity(3)
        P = lambda x, y, z: c + M @ Vector((x * hx, y * hy, z * hz))
        quads = {
            "+x": [P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1)],
            "-x": [P(-1, 1, -1), P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1)],
            "+y": [P(1, 1, -1), P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1)],
            "-y": [P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1)],
            "+z": [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)],
            "-z": [P(-1, 1, -1), P(1, 1, -1), P(1, -1, -1), P(-1, -1, -1)],
        }
        for k, q in quads.items():
            u = (faces or {}).get(k, uvs)
            if u is None:
                continue
            self.poly(q, u, mat)

    def bevel_box(self, centre, size, width, segs=2, uvs="black", mat=BODY, rot=None, uv_fn=None):
        """A box with rounded edges (bmesh bevel), smooth shaded. uv_fn(co_local, normal_local) -> uv overrides."""
        tmp = bmesh.new()
        bmesh.ops.create_cube(tmp, size=1.0)
        for v in tmp.verts:
            v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
        bmesh.ops.bevel(tmp, geom=list(tmp.edges), offset=width, segments=segs, profile=0.5, affect="EDGES",
                        clamp_overlap=True)
        tmp.normal_update()
        M = rot or Matrix.Identity(3)
        c = Vector(centre)
        vmap = {v: self.v(c + M @ v.co) for v in tmp.verts}
        for f in tmp.faces:
            n = f.normal.copy()
            if uv_fn:
                uvl = [uv_fn(l.vert.co, n) for l in f.loops]
            else:
                uvl = uvs
            self.face([vmap[l.vert] for l in f.loops], uvl, mat, smooth=True)
        tmp.free()

    def lathe(self, centre, axis, profile, segs, uv_fn, mat=BODY, smooth=True, phase=0.0, close_start=False):
        """Revolve profile [(a, r)] (a along `axis`, r away from it) about the axis through `centre`.
        uv_fn(pi, sj, a, r, phi, base_sj, base_pi) -> uv for each loop corner (base_*: the face's first segment / row)."""
        ax = Vector(axis).normalized()
        ref = Vector((0, 0, 1)) if abs(ax.z) < 0.9 else Vector((1, 0, 0))
        e1 = ax.cross(ref).normalized()
        e2 = ax.cross(e1).normalized()
        c = Vector(centre)
        grid = []
        for i, (a, r) in enumerate(profile):
            row = []
            for j in range(segs):
                phi = phase + 2 * math.pi * j / segs
                row.append(self.v(c + ax * a + (e1 * math.cos(phi) + e2 * math.sin(phi)) * r))
            grid.append(row)
        for i in range(len(profile) - 1):
            for j in range(segs):
                j2 = (j + 1) % segs
                vs = [grid[i][j], grid[i][j2], grid[i + 1][j2], grid[i + 1][j]]
                corners = [(i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j)]
                uvs = [uv_fn(pi, sj, profile[pi][0], profile[pi][1], phase + 2 * math.pi * sj / segs, j, i)
                       for pi, sj in corners]
                f = self.face(vs, uvs, mat, smooth)
        return grid

    def tube(self, pts, radius, sides, uvs, mat=BODY, caps=True):
        """Sweep a circle along a polyline (parallel transport)."""
        pts = [Vector(p) for p in pts]
        tang = []
        for i in range(len(pts)):
            a = pts[max(i - 1, 0)]
            b = pts[min(i + 1, len(pts) - 1)]
            tang.append((b - a).normalized())
        ref = Vector((0, 0, 1)) if abs(tang[0].z) < 0.9 else Vector((1, 0, 0))
        n = tang[0].cross(ref).normalized()
        rings = []
        for i, p in enumerate(pts):
            if i:
                axis = tang[i - 1].cross(tang[i])
                if axis.length > 1e-6:
                    ang = tang[i - 1].angle(tang[i])
                    n = Matrix.Rotation(ang, 3, axis.normalized()) @ n
            b = tang[i].cross(n).normalized()
            rings.append([self.v(p + (n * math.cos(2 * math.pi * k / sides) + b * math.sin(2 * math.pi * k / sides)) * radius)
                          for k in range(sides)])
        for i in range(len(pts) - 1):
            for k in range(sides):
                k2 = (k + 1) % sides
                self.face([rings[i][k], rings[i + 1][k], rings[i + 1][k2], rings[i][k2]], uvs, mat, smooth=True)
        if caps:
            self.face(list(reversed(rings[0])), uvs, mat)
            self.face(rings[-1], uvs, mat)

    def disc(self, centre, normal, radius, segs, uvs, mat=BODY, out=0.0):
        n = Vector(normal).normalized()
        ref = Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((1, 0, 0))
        e1 = n.cross(ref).normalized()
        e2 = n.cross(e1).normalized()
        c = Vector(centre) + n * out
        ring = [c + (e1 * math.cos(2 * math.pi * k / segs) + e2 * math.sin(2 * math.pi * k / segs)) * radius for k in range(segs)]
        f = self.poly(ring, uvs, mat)
        if f and f.normal.dot(n) < 0:
            f.normal_flip()
        return f

    def finish(self, weld=0.0, sharp_deg=None):
        bm = self.bm
        # the taller body (HN): stretch the upper bands, lift rigidly, or keep the heights as written
        if self.rm == "stretch":
            for v in bm.verts:
                v.co.z = HN(v.co.z)
        elif self.rm == "shift" and len(bm.verts):
            zm = sum(v.co.z for v in bm.verts) / len(bm.verts)
            d = HN(zm) - zm
            for v in bm.verts:
                v.co.z += d
        if weld:
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=weld)
            bmesh.ops.dissolve_degenerate(bm, dist=weld, edges=bm.edges)
        bm.normal_update()
        if sharp_deg is not None:
            lim = math.radians(sharp_deg)
            for e in bm.edges:
                if len(e.link_faces) == 2:
                    f1, f2 = e.link_faces
                    if f1.material_index != f2.material_index or f1.normal.angle(f2.normal, 0) > lim:
                        e.smooth = False
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        for m in MATS:
            me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me)
        COLL.objects.link(ob)
        PARTS.append(ob)
        return ob


def orient_to(f, target_dir):
    """Flip a face so its normal points along target_dir."""
    if f is not None:
        f.normal_update()
        if f.normal.dot(target_dir) < 0:
            f.normal_flip()


# ============================================================================================ the shell ==

def in_iv(a, b, ivs, eps=1e-4):
    for k, (lo, hi) in enumerate(ivs):
        if a >= lo - eps and b <= hi + eps:
            return k
    return None


def classify(seg, p0, p1, lo, hi):
    """What the body face between outline params p0..p1 (xf, angle or X) and heights lo..hi is."""
    e = 1e-4
    if seg in ("R", "L"):
        a, b = min(p0, p1), max(p0, p1)
        if b - a < 1e-6:
            return ("skip",)
        if seg == "R":
            k = in_iv(a, b, DOORS)
            if k is not None and hi <= 2.20 + e:
                return ("open", f"door_{k}")
        wins = WIN_R if seg == "R" else WIN_L
        k = in_iv(a, b, wins)
        if k is not None and lo >= 1.28 - e and hi <= 2.45 + e:
            return ("open", f"win_{seg}{k}")
        if hi <= ARCH_TOP + e:
            for c in AXLES:
                if a >= c - ARCH_BOX - e and b <= c + ARCH_BOX + e:
                    return ("arch",)
        if hi <= 1.28 + e:
            return ("side",)
        if hi <= 2.80 + e:
            return ("sw", "black")
        return ("sw", "ivory")
    if seg in ("FR", "FL", "F"):
        glassy = seg == "F" or min(p0, p1) >= math.radians(30) - e
        if lo >= 1.05 - e and hi <= 2.25 + e and glassy:
            return ("open", "windscreen")
        if seg == "F" and lo >= 2.31 - e and hi <= 2.55 + e:
            return ("open", "sign")
        if hi <= 1.05 + e:
            return ("front",)
        if hi <= 2.55 + e:
            return ("sw", "black")
        return ("sw", "ivory")
    # rear
    if seg == "B" and lo >= 1.95 - e and hi <= 2.55 + e:
        return ("open", "rear_win")
    return ("rear",)


OPEN_DEPTH = {"windscreen": 0.022, "sign": 0.03, "rear_win": 0.02, "door_0": 0.09, "door_1": 0.09}


def build_shell():
    P = Part("bus_shell")
    rings = [outline(h) for h in HS]
    n = len(rings[0])
    V = [[P.v(Vector((p[0], Yof(p[1]), h))) for p in ring] for ring, h in zip(rings, HS)]

    def uv_for(kind, right, co):
        X, Y, h = co.x, co.y, co.z
        xf = HALF - Y
        if kind == "side":
            return side_uv(right, xf, h)
        if kind == "front":
            return front_uv(X, h)
        return rear_uv(X, h)

    opens = {}
    for k in range(len(HS) - 1):
        for i in range(n):
            i2 = (i + 1) % n
            seg = rings[k][i][2]
            seg2 = rings[k][i2][2]
            p0, p1 = rings[k][i][3], rings[k][i2][3]
            if seg2 != seg:
                # the last edge of a segment runs onto the next one's first point: use the next point's position
                if seg in ("R", "L"):
                    p1 = rings[k][i2][1] if seg2 in ("RR", "FL") else p1
                    p1 = rings[k][i2][1]
                elif seg in ("FR", "FL", "RR", "RL"):
                    p1 = 0.0 if seg in ("FR", "RL") else math.pi / 2
                elif seg in ("F", "B"):
                    p1 = rings[k][i2][0]
            c = classify(seg, p0, p1, HS[k], HS[k + 1])
            quad = [V[k][i], V[k + 1][i], V[k + 1][i2], V[k][i2]]
            if c[0] in ("skip", "arch"):
                continue
            if c[0] == "open":
                opens.setdefault(c[1], []).append((k, i))
                continue
            if c[0] == "sw":
                P.face(quad, c[1], smooth=True)
            else:
                right = seg in ("R", "FR", "RR") or (seg in ("F", "B") and rings[k][i][0] > 0)
                P.face(quad, lambda co, kind=c[0], right=right: uv_for(kind, right, co), smooth=True)

    # openings: inset glass (or nothing, for doors) and frame returns
    normals = [[Vector((p[4], p[5], 0)) for p in ring] for ring in rings]
    for oid, faces in opens.items():
        depth = OPEN_DEPTH.get(oid, 0.012)
        fset = set(faces)
        inner = {}

        def iv(k, i):
            if (k, i) not in inner:
                inner[(k, i)] = P.v(V[k][i].co - normals[k][i] * depth)
            return inner[(k, i)]
        cen = Vector((0, 0, 0))
        for k, i in faces:
            cen += (V[k][i].co + V[k + 1][(i + 1) % n].co) / 2
        cen /= len(faces)
        for k, i in faces:
            i2 = (i + 1) % n
            # no tinted pane over the front destination sign (bus review r3: under the windscreen's tint and its sky
            # reflection the LEDs read as faint dots on a grey panel by day; a sign's cover is clear glass)
            if not oid.startswith("door") and oid != "sign":
                f = P.face([iv(k, i), iv(k + 1, i), iv(k + 1, i2), iv(k, i2)], "glass_dark", mat=GLASS, smooth=True)
            for (a, b, nb) in (((k, i), (k, i2), (k - 1, i)), ((k + 1, i2), (k + 1, i), (k + 1, i)),
                               ((k + 1, i), (k, i), (k, (i - 1) % n)), ((k, i2), (k + 1, i2), (k, i2))):
                if nb in fset:
                    continue
                va, vb = V[a[0]][a[1]], V[b[0]][b[1]]
                if (va.co - vb.co).length < 1e-6:
                    continue
                f = P.face([va, vb, iv(*b), iv(*a)], "black", smooth=False)
                if f:
                    mid = (va.co + vb.co) / 2
                    orient_to(f, (cen - mid))
    P.rings = rings
    P.V = V
    P.opens = opens
    return P


def build_roof_cap(P):
    """Crowned roof inside the top ring: inset rings rising 35 mm to a spine."""
    top = P.V[-1]
    w0, f0, r0 = W(TOP), F(TOP), R(TOP)
    prev = top
    for d in (0.10, 0.28, 0.55, w0):
        z = TOP + 0.035 * (1 - (1 - d / w0) ** 2)
        ring = outline(TOP, w=max(w0 - d, 0.0), f=f0 + d, r=r0 - d, rcf=max(RCF - d, 0.0), rcr=max(RCR - d, 0.0),
                       bf=BOWF(TOP) * (1 - d / w0), br=BOWR * (1 - d / w0))
        cur = [P.v(Vector((p[0], Yof(p[1]), z))) for p in ring]
        n = len(cur)
        for i in range(n):
            i2 = (i + 1) % n
            P.face([prev[i], cur[i], cur[i2], prev[i2]], "roof", smooth=True)
        prev = cur


def arch_panels(P):
    """Each wheel arch: radial panel from the arch to the box edge, trim, wheel well and inner plate, mud flap."""
    for side in (1, -1):
        sts = ST_R if side == 1 else ST_L
        for c in AXLES:
            box_hs = [h for h in HS if h <= ARCH_TOP + 1e-6]
            x0, x1 = c - ARCH_BOX, c + ARCH_BOX
            top_st = sorted([s for s in sts if x0 - 1e-6 <= s <= x1 + 1e-6], reverse=True)
            path = [(x1, h) for h in box_hs] + [(s, ARCH_TOP) for s in top_st[1:-1]] + [(x0, h) for h in reversed(box_hs)]
            th0 = -math.asin((WHEEL_Z - 0.25) / ARCH_R)
            th1 = math.pi - th0
            ths = []
            for (xf, h) in path:
                t = math.atan2(h - WHEEL_Z, xf - c)
                if t < -math.pi / 2:
                    t += 2 * math.pi
                ths.append(min(max(t, th0), th1))
            for i in range(1, len(ths)):
                ths[i] = max(ths[i], ths[i - 1])
            ths[0], ths[-1] = th0, th1
            X = lambda h: side * W(h)
            pv = [P.v(Vector((X(h), Yof(xf), h))) for xf, h in path]
            arc = [(c + ARCH_R * math.cos(t), WHEEL_Z + ARCH_R * math.sin(t)) for t in ths]
            av = [P.v(Vector((X(h), Yof(xf), h))) for xf, h in arc]
            right = side == 1
            for i in range(len(path) - 1):
                f = P.face([pv[i], pv[i + 1], av[i + 1], av[i]], lambda co: side_uv(right, HALF - co.y, co.z), smooth=True)
                orient_to(f, Vector((side, 0, 0)))
            # trim: a 40 mm lip standing 6 mm proud
            K = 28
            tr = [th0 + (th1 - th0) * k / K for k in range(K + 1)]
            inn = [Vector((side * (1.245 + 0.006), Yof(c + ARCH_R * math.cos(t)), WHEEL_Z + ARCH_R * math.sin(t))) for t in tr]
            outr = [Vector((side * (1.245 + 0.006), Yof(c + (ARCH_R + 0.045) * math.cos(t)), WHEEL_Z + (ARCH_R + 0.045) * math.sin(t))) for t in tr]
            back = [Vector((side * 1.245, Yof(c + (ARCH_R + 0.045) * math.cos(t)), WHEEL_Z + (ARCH_R + 0.045) * math.sin(t))) for t in tr]
            for k in range(K):
                f = P.poly([inn[k], outr[k], outr[k + 1], inn[k + 1]], "bumper", smooth=True)
                orient_to(f, Vector((side, 0, 0)))
                f = P.poly([outr[k], back[k], back[k + 1], outr[k + 1]], "bumper", smooth=True)
                orient_to(f, (outr[k] - Vector((outr[k].x, Yof(c), WHEEL_Z))))
            # wheel well: the arch carried 0.32 m inboard, closed by a plate
            depth = 0.34
            wo = [Vector((side * 1.245, Yof(c + ARCH_R * math.cos(t)), WHEEL_Z + ARCH_R * math.sin(t))) for t in tr]
            wi = [Vector((side * (1.245 - depth), p.y, p.z)) for p in wo]
            for k in range(K):
                f = P.poly([wo[k], wo[k + 1], wi[k + 1], wi[k]], "well", smooth=True)
                orient_to(f, Vector((0, Yof(c), WHEEL_Z)) - (wo[k] + wo[k + 1]) / 2 + Vector((side * 1.245, 0, 0)) - Vector((side * 1.245, 0, 0)))
            ctr = Vector((side * (1.245 - depth), Yof(c), WHEEL_Z))
            for k in range(K):
                f = P.poly([ctr, wi[k], wi[k + 1]], "well")
                orient_to(f, Vector((side, 0, 0)))
            f = P.poly([ctr, wi[-1], wi[0]], "well")
            orient_to(f, Vector((side, 0, 0)))
            # mud flap behind the wheel
            P.box((side * (1.245 - 0.17), Yof(c + 0.60), 0.40), (0.30, 0.012, 0.42), "rubber")


def underbody():
    P = Part("bus_under")
    z = 0.30
    for (a, b, xw) in ((0.10, 1.72, 1.20), (2.98, 6.12, 1.20), (7.38, 8.85, 1.20), (1.72, 2.98, 0.72), (6.12, 7.38, 0.62)):
        f = P.poly([(-xw, Yof(a), z), (xw, Yof(a), z), (xw, Yof(b), z), (-xw, Yof(b), z)], "under")
        orient_to(f, Vector((0, 0, -1)))
    # axles, a battery / tank box between them
    for c in AXLES:
        P.tube([(-0.9, Yof(c), WHEEL_Z), (0.9, Yof(c), WHEEL_Z)], 0.06, 8, "steel", caps=False)
    P.box((0, Yof(4.6), 0.20), (1.5, 2.2, 0.16), "under")   # bus-ride r2: below the cabin floor (0.34); at 0.31-0.49 its top came up through it as a dark patch
    return P.finish(sharp_deg=40)


# ============================================================================================== details ==

def bumpers():
    P = Part("bus_bumpers")
    # front: a moulded bumper swept along the lower front's plan (front_plan) from xf 0.39 on the door side round the
    # front to xf 0.45 on the left: a black lower lip that juts out, a step, the dark grey face, a rolled top; in the
    # middle a recessed air intake with two slats; a tow-hook cover; end caps against the body.
    rows = [(0.250, 0.012), (0.254, 0.046), (0.268, 0.068), (0.296, 0.068), (0.306, 0.053), (0.330, 0.053),
            (0.343, 0.063), (0.355, 0.064), (0.357, 0.064), (0.403, 0.065), (0.405, 0.065), (0.425, 0.065),
            (0.448, 0.053), (0.463, 0.020), (0.470, 0.0)]
    LIP = 4               # rows below this index are the black lip
    SLOT = (7, 10)        # rows SLOT[0]+1 .. SLOT[1]-1 recess in the intake
    SW = 0.48             # the intake's half width (s)
    s_r, s_l = s_side(0.39), s_side(0.45)
    cols = set()
    s = -s_l
    while s < s_r:
        cols.add(round(s, 4))
        s += 0.08 if abs(s) < 0.85 else 0.03
    cols |= {-s_l, s_r, -SW - 0.012, -SW, SW, SW + 0.012}
    cols = sorted(cols)
    inside = lambda s: abs(s) < SW + 1e-6

    def bp(s, h, out=0.0):
        """fp on the body face's plan (h 0.40) at height h: below 0.383 the plan is the moulding's, 12 mm out."""
        p, n = fp(s, 0.40, out)
        return Vector((p.x, p.y, h)), n

    def out_of(ci, ri):
        o = rows[ri][1]
        if inside(cols[ci]) and SLOT[0] < ri < SLOT[1]:
            o = 0.030
        return o
    g = [[P.v(bp(cols[ci], rows[ri][0], out_of(ci, ri))[0]) for ci in range(len(cols))] for ri in range(len(rows))]
    for ri in range(len(rows) - 1):
        for ci in range(len(cols) - 1):
            mid_s = (cols[ci] + cols[ci + 1]) / 2
            if ri < LIP:
                c = "trim"
            elif SLOT[0] <= ri < SLOT[1] and abs(mid_s) < SW:
                c = "grille" if SLOT[0] < ri < SLOT[1] - 1 else "trim"
            elif SLOT[0] < ri < SLOT[1] - 1 and SW < abs(mid_s) < SW + 0.012:
                c = "trim"
            else:
                c = "bumper"
            f = P.face([g[ri][ci], g[ri][ci + 1], g[ri + 1][ci + 1], g[ri + 1][ci]], c, smooth=True)
            orient_to(f, bp(mid_s, 0.4)[1] + Vector((0, 0, -0.3 if ri < 2 else 0)))
    # end caps: the profile closed against the body
    for ci, want in ((0, -1), (len(cols) - 1, 1)):
        vs = [g[ri][ci] for ri in range(len(rows))]
        f = P.face(vs, "trim")
        orient_to(f, bp(cols[ci] + want * 0.01, 0.36)[0] - bp(cols[ci], 0.36)[0])
    # two slats across the intake
    for h in (0.371, 0.389):
        pts = [bp(x, h, 0.045)[0] for x in np.linspace(-SW + 0.01, SW - 0.01, 17)]
        P.tube(pts, 0.0045, 4, "trim")
    # tow-hook cover on the face, right of the intake
    M, t, n = fp_frame(0.66, 0.40)
    p, _ = bp(0.66, 0.385, 0.066)
    P.bevel_box(p, (0.12, 0.008, 0.075), 0.004, 1, "bumper_hi", rot=M)
    # rear: swept along the rear's plan (h 0.44) from xf 8.25 on one side round the back to the other, with the
    # reflectors on its back face. Bus review r3: it is the lowest thing at the back (its lower lip at the body's
    # bottom, 0.25, covering the moulding; r2 stopped at 0.315 and a band of green showed under it), and on the sides it
    # runs out into the body (its depth fades to nothing over the first 0.32 m) instead of ending as a box standing 40
    # mm proud.
    profr = [(0.250, 0.0), (0.254, 0.022), (0.268, 0.036), (0.30, 0.040), (0.44, 0.044), (0.545, 0.032), (0.562, 0.0)]
    hp = 0.44
    cs = R(hp) - RCR
    side_x = [8.25, 8.33, 8.41, 8.49, 8.57, 8.65, 8.72]
    path = [("R", xf) for xf in side_x]
    path += [("RR", math.pi / 2 * k / 6) for k in range(7)]
    ew = W(hp) - RCR
    path += [("B", ew - 2 * ew * k / 12) for k in range(1, 12)]
    path += [("RL", math.pi / 2 * (6 - k) / 6) for k in range(7)]
    path += [("L", xf) for xf in reversed(side_x)]
    taper = lambda seg, prm: smoothstep(8.25, 8.57, prm) if seg in ("R", "L") else 1.0
    base = [surface(hp, seg, prm) for seg, prm in path]
    rows_r = []
    for (h, o) in profr:
        rows_r.append([P.v(Vector((p.x + n.x * o * taper(*sp), p.y + n.y * o * taper(*sp), h)))
                       for (p, n), sp in zip(base, path)])
    for r in range(len(rows_r) - 1):
        for i in range(len(rows_r[0]) - 1):
            f = P.face([rows_r[r][i], rows_r[r + 1][i], rows_r[r + 1][i + 1], rows_r[r][i + 1]],
                       lambda co: reflector_uv(co.x, co.z), smooth=True)
            mid = (base[i][1] + base[i + 1][1]).normalized()
            orient_to(f, mid + Vector((0, 0, -0.4 if r == 0 else 0)))
    return P


def lamp(P, h, seg, param, radius, lens, ring="chrome", dome=0.012, segs=14, out=0.0):
    p, n = surface(h, seg, param, out)
    P.lathe(p, n, [(0.0, radius * 1.18), (0.006, radius * 1.18), (0.008, radius), (0.008 + dome * 0.6, radius * 0.7),
                   (0.008 + dome, 0.0)],
            segs, lambda pi, sj, a, r, phi, b, bi: cell(ring if bi < 2 else lens), smooth=True)
    return p, n


# ------------------------------------------------------------------ the lower front's plan (bus review r2) --
# Below the windscreen the front is a vertical extrusion of one plan curve (W, F and BOWF are constant from 0.383 to
# 0.95 m): a point there is (s, h), s the arc length from the front's middle round the corner onto the side, so the
# headlamp pockets, the DRL band and the bumper are laid out on it like on a flat sheet.
_PLAN = {}


def front_plan(h):
    """The right half of the body's plan outline at height h, from the front's middle round the corner onto the side
    (to xf 0.70): (points, outward normals, arc lengths). s is about X across the front; the corner is s 1.0 .. 1.39."""
    key = round(h, 4)
    if key in _PLAN:
        return _PLAN[key]
    w, f, bf = W(h), F(h), BOWF(h)
    ew = w - RCF
    pts, nrm = [], []
    for k in range(61):
        X = ew * k / 60
        u = math.pi * X / (2 * ew)
        xf = f - bf * math.cos(u) ** 2
        d = bf * math.sin(2 * u) * math.pi / (2 * ew)
        pts.append(Vector((X, Yof(xf), h)))
        nrm.append(Vector((d, 1.0, 0)).normalized())
    for k in range(1, 31):
        a = math.pi / 2 * (1 - k / 30)
        pts.append(Vector((ew + RCF * math.cos(a), Yof(f + RCF - RCF * math.sin(a)), h)))
        nrm.append(Vector((math.cos(a), math.sin(a), 0)))
    for k in range(1, 13):
        xf = f + RCF + (0.70 - f - RCF) * k / 12
        pts.append(Vector((w, Yof(xf), h)))
        nrm.append(Vector((1, 0, 0)))
    s = [0.0]
    for i in range(1, len(pts)):
        s.append(s[-1] + (pts[i] - pts[i - 1]).length)
    _PLAN[key] = (pts, nrm, s)
    return _PLAN[key]


def fp(s, h, out=0.0):
    """A point on the lower front and its outward normal, by arc length s from the middle (s < 0: the left half)."""
    pts, nrm, ss = front_plan(h)
    a = abs(s)
    i = min(max(bisect.bisect_right(ss, a) - 1, 0), len(ss) - 2)
    t = (a - ss[i]) / max(ss[i + 1] - ss[i], 1e-9)
    p = pts[i].lerp(pts[i + 1], t)
    n = nrm[i].lerp(nrm[i + 1], t).normalized()
    if s < 0:
        p = Vector((-p.x, p.y, p.z))
        n = Vector((-n.x, n.y, n.z))
    return p + n * out, n


def fp_frame(s, h):
    """Unit tangent (growing s), outward normal and up at (s, h): the columns of a local frame (3x3)."""
    p0, _ = fp(s - 0.002, h)
    p1, _ = fp(s + 0.002, h)
    t = (p1 - p0).normalized()
    _, n = fp(s, h)
    up = Vector((0, 0, 1))
    return Matrix(((t.x, n.x, 0.0), (t.y, n.y, 0.0), (t.z, n.z, 1.0))), t, n


def s_of_X(X, h=0.6):
    """Arc length where the right half's outline reaches X (on the front or round the corner)."""
    pts, nrm, ss = front_plan(h)
    for i in range(len(pts) - 1):
        if pts[i].x <= X <= pts[i + 1].x + 1e-9:
            t = (X - pts[i].x) / max(pts[i + 1].x - pts[i].x, 1e-9)
            return ss[i] + t * (ss[i + 1] - ss[i])
    return ss[-1]


def s_side(xf, h=0.6):
    """Arc length of a point on the side, xf behind the front face (behind the corner)."""
    pts, nrm, ss = front_plan(h)
    return ss[90] + (xf - (F(h) + RCF))


def oface(P, verts, uvs, want, mat=BODY, smooth=True):
    """A face turned so that its normal points along `want` (the AO bake and the shading read the normal)."""
    f = P.face(verts, uvs, mat, smooth)
    orient_to(f, want)
    return f


def rounded_poly(V, r, counts, arc_n=4):
    """A convex polygon V [(s, h)] (counter-clockwise) with corners rounded by r, sampled: arc_n steps round each corner,
    counts[k] steps along the straight part of edge k (V[k] -> V[k+1]). Same counts -> corresponding points."""
    n = len(V)
    V = [Vector((a, b)) for a, b in V]
    corners = []
    for k in range(n):
        A, B, C = V[k - 1], V[k], V[(k + 1) % n]
        u1 = (B - A).normalized()
        u2 = (C - B).normalized()
        phi = math.acos(max(-1.0, min(1.0, u1.dot(u2))))
        t = r * math.tan(phi / 2)
        ti, to = B - u1 * t, B + u2 * t
        cen = ti + Vector((-u1.y, u1.x)) * r
        a0 = math.atan2(ti.y - cen.y, ti.x - cen.x)
        a1 = math.atan2(to.y - cen.y, to.x - cen.x)
        while a1 < a0:
            a1 += 2 * math.pi
        corners.append((ti, to, cen, a0, a1))
    out = []
    for k in range(n):
        ti, to, cen, a0, a1 = corners[k]
        for j in range(arc_n + 1):
            a = a0 + (a1 - a0) * j / arc_n
            out.append((cen.x + r * math.cos(a), cen.y + r * math.sin(a)))
        nxt = corners[(k + 1) % n][0]
        for j in range(1, counts[k]):
            q = to.lerp(nxt, j / counts[k])
            out.append((q.x, q.y))
    return out


def inset_poly(V, d):
    """A convex polygon's edges moved d inward (counter-clockwise polygon): the new corners."""
    n = len(V)
    V = [Vector((a, b)) for a, b in V]
    lines = []
    for k in range(n):
        A, B = V[k], V[(k + 1) % n]
        u = (B - A).normalized()
        nin = Vector((-u.y, u.x))
        lines.append((A + nin * d, u))
    out = []
    for k in range(n):
        p1, u1 = lines[k - 1]
        p2, u2 = lines[k]
        den = u1.x * u2.y - u1.y * u2.x
        t = ((p2.x - p1.x) * u2.y - (p2.y - p1.y) * u2.x) / den
        q = p1 + u1 * t
        out.append((q.x, q.y))
    return out


def ring_band(P, side, A, B, outA, outB, uvs, facing="out"):
    """Quads between two corresponding (s, h) loops A and B, at heights outA and outB off the surface; each faces the
    surface's normal ("out") or the loop's middle ("in": an inner wall)."""
    va = [P.v(fp(side * s, h, outA)[0]) for s, h in A]
    vb = [P.v(fp(side * s, h, outB)[0]) for s, h in B]
    cs = sum(s for s, h in A) / len(A)
    ch = sum(h for s, h in A) / len(A)
    mid = fp(side * cs, ch, 0.01)[0]
    n = len(A)
    for i in range(n):
        j = (i + 1) % n
        a, b = A[i], A[j]
        if facing == "in":
            fc = (va[i].co + va[j].co + vb[i].co + vb[j].co) / 4
            want = mid - fc
        else:
            want = fp(side * (a[0] + b[0]) / 2, (a[1] + b[1]) / 2)[1]
        oface(P, [va[i], va[j], vb[j], vb[i]], uvs, want)


def patch_grid(P, side, s0, s1, h0, h1, ns, nh, out_fn, uv_fn, smooth=True):
    """A grid over (s, h) [s0..s1] x [h0..h1], lifted off the surface by out_fn(u, v), uv_fn(u, v) -> uv; faces out."""
    g = []
    for j in range(nh + 1):
        v = j / nh
        row = []
        for i in range(ns + 1):
            u = i / ns
            row.append(P.v(fp(side * (s0 + (s1 - s0) * u), h0 + (h1 - h0) * v, out_fn(u, v))[0]))
        g.append(row)
    for j in range(nh):
        for i in range(ns):
            uvs = [uv_fn(i / ns, j / nh), uv_fn((i + 1) / ns, j / nh), uv_fn((i + 1) / ns, (j + 1) / nh), uv_fn(i / ns, (j + 1) / nh)]
            if callable(uvs[0]) or isinstance(uvs[0], str):
                uvs = uvs[0]
            want = fp(side * (s0 + (s1 - s0) * (i + 0.5) / ns), h0 + (h1 - h0) * (j + 0.5) / nh)[1]
            oface(P, [g[j][i], g[j][i + 1], g[j + 1][i + 1], g[j + 1][i]], uvs, want, smooth=smooth)


def lathe_out(P, centre, axis, profile, segs, cells, radial_rows=()):
    """A lathe (Part.lathe) whose faces are turned to face out: along the axis, or radially out for the rows listed
    in `radial_rows` (side walls). cells: one swatch per profile row."""
    ax = Vector(axis).normalized()
    c = Vector(centre)
    before = len(P.bm.faces)
    P.lathe(c, ax, profile, segs, lambda pi, sj, a, r, phi, b, bi: cell(cells[min(bi, len(cells) - 1)]), smooth=True)
    P.bm.faces.ensure_lookup_table()
    rows = len(profile) - 1
    for k, f in enumerate(P.bm.faces[before:]):
        row = k // segs
        f.normal_update()
        if row in radial_rows:
            fc = f.calc_center_median()
            d = fc - c
            d -= ax * d.dot(ax)
            orient_to(f, d)
        else:
            orient_to(f, ax)


POCKET_H = (0.43, 0.86)


def pocket_corners():
    """The headlamp pocket's trapezoid in (s, h) (right half), counter-clockwise: X 0.905 at the bottom and 0.985 at the
    top on the front, round the corner to xf 0.37 (bottom) / 0.31 (top) on the side (the texture's dark pocket)."""
    h0, h1 = POCKET_H
    return [(s_of_X(0.905), h0), (s_side(0.37), h0), (s_side(0.31), h1), (s_of_X(0.985), h1)]


def headlamp(P, side):
    """One headlamp unit as on the 9 m low-floor midibus (research 15, "headlamp pocket"): a glossy black pocket that
    wraps the corner, a black bezel 20 mm proud round it, and in it two round lamps stacked one above the other: the
    projector headlamp (a chrome reflector bowl, a chrome ring, the lens that lights at night) and below it the
    indicator (a chrome bowl, a clear domed lens over an amber bulb). Bus review r3: the r2 unit (a silver housing with
    two bowls side by side, a ribbed amber strip and a fog lamp) read as a pair of eyes under a brow; the real pocket
    is black with its round lamps one above the other."""
    V = pocket_corners()
    counts = [18, 8, 16, 8]
    outer = rounded_poly(V, 0.045, counts)
    rim = rounded_poly(inset_poly(V, 0.007), 0.038, counts)
    top_in = rounded_poly(inset_poly(V, 0.028), 0.022, counts)
    ring_band(P, side, outer, rim, -0.004, 0.020, "trim")      # outer chamfer (from just inside the skin)
    ring_band(P, side, rim, top_in, 0.020, 0.020, "trim")      # bezel top
    ring_band(P, side, top_in, top_in, 0.020, -0.004, "pocket", facing="in")  # inner wall down to the pocket floor
    # both lamps sit where the corner starts to roll (X ~1.07), looking mostly forward: the axis is the surface's
    # normal turned halfway to the front; their backs reach 30 mm into the pocket floor so no edge floats
    s_l = s_of_X(1.065)
    fwd = Vector((0, 1, 0))
    for h, rr, kind in ((0.672, 0.074, "head"), (0.505, 0.054, "ind")):
        p, n = fp(side * s_l, h, 0.0)
        ax = (n + fwd).normalized()
        if kind == "head":
            # reflector bowl (lit at night), its chrome rim and a step ring, then the projector's ring and lens
            lathe_out(P, p, ax, [(0.002, 0.004), (0.004, rr * 0.42), (0.010, rr * 0.80), (0.018, rr), (0.020, rr * 1.08),
                                 (0.014, rr * 1.16), (-0.030, rr * 1.16)],
                      22, ["reflector", "reflector", "reflector", "chrome", "chrome", "trim"], radial_rows=(5,))
            lathe_out(P, p, ax, [(0.010, 0.050), (0.022, 0.048), (0.022, 0.040)], 22, ["chrome"], radial_rows=(0,))
            lathe_out(P, p, ax, [(0.022, 0.040), (0.030, 0.037), (0.036, 0.026), (0.040, 0.011), (0.0405, 0.0)], 18,
                      ["proj_lens"])
        else:
            # chrome bowl and rim, an amber bulb, a clear domed lens over it (drawn as a thin clear ring: the lens's
            # edge catches the light, its middle shows the bulb)
            lathe_out(P, p, ax, [(0.002, 0.004), (0.004, rr * 0.45), (0.010, rr * 0.82), (0.016, rr), (0.018, rr * 1.10),
                                 (0.012, rr * 1.18), (-0.030, rr * 1.18)],
                      20, ["chrome", "chrome", "chrome", "chrome", "chrome", "trim"], radial_rows=(5,))
            lathe_out(P, p, ax, [(0.004, 0.020), (0.012, 0.019), (0.019, 0.011), (0.021, 0.0)], 12, ["lens_amber"])
            lathe_out(P, p, ax, [(0.016, rr * 0.98), (0.022, rr * 0.80), (0.024, rr * 0.62)], 20, ["lens_white"],
                      radial_rows=())


def drl_band(P):
    """The DRL band as a glossy black strip 7 mm proud across the front and round the corners, its six LED dots a side
    (lit at night) and the plain silver bar in the middle (no badge)."""
    s_end = s_side(0.30, 0.94)
    cols = sorted(set([round(x, 4) for x in np.arange(-s_end, s_end + 1e-6, 0.04)] + [-s_end, s_end]))
    rows = [(0.884, 0.0), (0.890, 0.007), (0.989, 0.007), (0.995, 0.0)]
    taper = lambda s: min(1.0, (s_end - abs(s)) / 0.05)
    g = [[P.v(fp(s, h, o * taper(s))[0]) for s in cols] for h, o in rows]
    for r in range(len(rows) - 1):
        for i in range(len(cols) - 1):
            f = P.face([g[r][i], g[r][i + 1], g[r + 1][i + 1], g[r + 1][i]], "black", smooth=True)
            orient_to(f, fp((cols[i] + cols[i + 1]) / 2, 0.94)[1])
    for side in (1, -1):
        for k in range(6):
            p, n = fp(side * (0.80 + 0.055 * k), 0.94, 0.007)
            lathe_out(P, p, n, [(0.0, 0.021), (0.003, 0.021), (0.004, 0.0165), (0.008, 0.012), (0.0105, 0.0)], 10,
                      ["trim", "lens_clear", "lens_clear", "lens_clear"], radial_rows=(0,))
    M, t, n = fp_frame(0.0, 0.94)
    p, _ = fp(0.0, 0.94, 0.013)
    P.bevel_box(p, (0.60, 0.012, 0.034), 0.005, 2, "chrome", rot=M)


def front_details(P):
    for side in (1, -1):
        headlamp(P, side)
    drl_band(P)
    for s, seg in ((1, "FR"), (-1, "FL")):
        # side indicator on the corner, above the pocket
        lamp(P, 0.80, seg, math.radians(14), 0.022, "lens_amber", segs=10)
    # number plate (blank) on its black holder
    M, t, n = fp_frame(0.0, 0.57)
    p, _ = fp(0.0, 0.57, 0.006)
    P.bevel_box(p, (0.48, 0.012, 0.26), 0.006, 1, "trim", rot=M)
    p, _ = fp(0.0, 0.57, 0.016)
    P.box(p, (0.44, 0.008, 0.22), "plate", rot=M,
          faces={"+y": lambda co: region_uv("plate", min(max((0.22 - (co - p).dot(t) * 1.0 - 0.0) / 0.44, 0), 1),
                                            min(max((0.68 - co.z) / 0.22, 0), 1))})
    # clearance LED strips on the cap's top corners
    for s in (1, -1):
        h = 2.95
        p, n = surface(h, "F", s * 0.70, -0.004)
        P.box(p, (0.16, 0.05, 0.030), "lens_clear")
    # wipers parked almost upright on the glass
    for xp in (0.30, -0.52):
        pts = []
        for k in range(9):
            t_ = k / 8 * 0.98
            ang = math.radians(78)
            X = xp - t_ * math.cos(ang)
            h = 1.09 + t_ * math.sin(ang)
            p, n = surface(h, "F", X, -0.022 + 0.016)
            pts.append(p)
        P.tube(pts, 0.010, 4, "wiper")
        d = (pts[-1] - pts[0]).normalized()
        sd = d.cross(Vector((0, 1, 0))).normalized()
        P.tube([q + sd * 0.028 + Vector((0, 0.004, 0)) for q in pts[1:]], 0.009, 4, "wiper")
        P.disc(pts[0], Vector((0, 1, 0)), 0.03, 8, "trim", out=0.006)


def mirror(P, side, head_h):
    """Rabbit-ear mirror: two black tubes out from the front pillar, forward past the face and hooking down."""
    root_h = 2.40
    xr = 0.44 if side == 1 else 0.36
    wr = W(root_h)
    xo = side * 1.395
    yo = Yof(-0.30)
    for dz in (0.03, -0.03):
        h = root_h + dz
        pts = [(side * (wr - 0.01), Yof(xr), h), (side * (wr + 0.08), Yof(xr - 0.02), h), (side * 1.36, Yof(xr - 0.10), h),
               (xo, Yof(xr - 0.24), h), (xo, Yof(0.0), h), (xo, Yof(-0.20), h)]
        if dz > 0:
            pts += [(xo, yo + 0.04, h - 0.03), (xo, yo, h - 0.09), (xo, yo, head_h + 0.22)]
        else:
            pts += [(xo, yo + 0.035, h - 0.04), (xo, yo + 0.012, h - 0.07)]
        # round the corners
        sm = [Vector(p) for p in pts]
        for _ in range(2):
            out = [sm[0]]
            for a, b in zip(sm[:-1], sm[1:]):
                out += [a.lerp(b, 0.25), a.lerp(b, 0.75)]
            out.append(sm[-1])
            sm = out
        P.tube(sm, 0.016, 6, "trim")
    # head: rounded box, convex glass looking back, amber LED under it
    hc = Vector((side * 1.385, yo, head_h))
    P.bevel_box(hc, (0.23, 0.09, 0.44), 0.035, 2, "trim")
    f = P.poly([hc + Vector((-0.095, -0.047, -0.19)), hc + Vector((0.095, -0.047, -0.19)), hc + Vector((0.095, -0.047, 0.19)),
                hc + Vector((-0.095, -0.047, 0.19))], "mirror")
    orient_to(f, Vector((0, -1, 0)))
    P.box(hc + Vector((side * 0.02, 0.0, -0.228)), (0.12, 0.05, 0.018), "lens_amber")


def aux_mirror(P):
    """The kerb-view mirror on the door side's front corner: in front of the windscreen, behind the front face (bus
    review r4: 0.2 m ahead of it at 2.3 m it overhung the walk space in front of the bus)."""
    hc = Vector((1.02, Yof(0.045), 2.30))
    P.tube([(1.13, Yof(0.225), 2.36), (1.08, Yof(0.13), 2.34), (1.03, Yof(0.075), 2.31)], 0.012, 6, "trim")
    P.bevel_box(hc, (0.20, 0.07, 0.14), 0.025, 2, "trim")
    P.poly([hc + Vector((-0.085, -0.037, -0.055)), hc + Vector((0.085, -0.037, -0.055)), hc + Vector((0.085, -0.037, 0.055)),
            hc + Vector((-0.085, -0.037, 0.055))], "mirror")


def rear_details(P):
    for s, seg in ((1, "RR"), (-1, "RL")):
        # four round lamps stacked at the corner: tail, reverse, indicator, tail
        cosa = (1.13 - (W(1.0) - RCR)) / RCR
        a = math.acos(max(-1, min(1, cosa)))
        for h, lens in ((1.25, "lens_red"), (1.10, "lens_white"), (0.95, "amber_dim"), (0.80, "lens_red")):
            lamp(P, h, seg, a, 0.05, lens, ring="trim")
        # roof-corner red marker
        p, n = surface(2.70, seg, math.radians(60), 0.004)
        P.box(p, (0.03, 0.03, 0.10), "lens_red")
    # third brake light on the rear roll, rear plate
    p, n = surface(2.84, "B", 0.0, 0.006)
    P.box(p, (0.60, 0.02, 0.04), "lens_red")
    # (tilted with the rear face's lean, 0.1 m a metre: upright, its lower edge sank into the body, bus review r3)
    p, n = surface(0.76, "B", 0.0, 0.010)
    P.box((0, p.y + 0.002, 0.76), (0.44, 0.012, 0.22), "plate", rot=Matrix.Rotation(-0.0997, 3, "X"),
          faces={"-y": lambda co: region_uv("plate", (co.x + 0.22) / 0.44, (0.87 - co.z) / 0.22)})


def side_details(P):
    for s, seg in ((1, "R"), (-1, "L")):
        for xf, lens in ((1.64, "lens_amber"), (3.30, "lens_amber"), (4.25 if s == 1 else 4.40, "lens_amber"),
                         (6.0, "lens_amber"), (8.25, "lens_red")):
            P.box((s * (W(0.47) + 0.006), Yof(xf), 0.47), (0.012, 0.08, 0.03), lens)
        P.box((s * (W(0.94) + 0.008), Yof(1.62), 0.94), (0.016, 0.10, 0.045), "lens_amber")
        # rain gutter along the top of the black band
        a, b = 0.75, 8.40
        h = 2.80
        P.box((s * (W(h) + 0.007), Yof((a + b) / 2), h + 0.008), (0.015, b - a, 0.016), "black")
    # emergency door releases beside the doors (kerb side)
    for xf in (1.52, 5.79):
        P.disc((W(1.20) + 0.002, Yof(xf), 1.20), (1, 0, 0), 0.03, 10, "red", out=0.002)


def doors(P):
    """Two-leaf doors in the kerb side's openings: black frames, full-height glass, a rubber seal, hinges; the step."""
    defs = [(DOORS[0], 0.33, 2.19, 0.38, 2.13), (DOORS[1], 0.33, 2.20, 0.40, 2.05)]
    for (a, b), z0, z1, g0, g1 in defs:
        mid = (a + b) / 2
        inset = 0.055
        X = lambda h: W(h) - inset
        for (la, lb) in ((a + 0.005, mid - 0.0125), (mid + 0.0125, b - 0.005)):
            fr = 0.06
            # frame: four quads round the glass, on the leaf plane
            o = [(la, z0), (lb, z0), (lb, z1), (la, z1)]
            ii = [(la + fr, g0), (lb - fr, g0), (lb - fr, g1), (la + fr, g1)]
            V3 = lambda xf, h, d=0.0: Vector((X(h) + d, Yof(xf), h))
            for k in range(4):
                k2 = (k + 1) % 4
                f = P.poly([V3(*o[k]), V3(*o[k2]), V3(*ii[k2]), V3(*ii[k])], "black")
                orient_to(f, Vector((1, 0, 0)))
            # leaf edge thickness
            for xf in (la, lb):
                f = P.poly([V3(xf, z0), V3(xf, z1), V3(xf, z1, -0.03), V3(xf, z0, -0.03)], "black")
            hs = [g0, 1.28, 1.60, 1.95, g1] if g1 > 1.95 else [g0, 1.28, 1.60, g1]
            for h0, h1 in zip(hs[:-1], hs[1:]):
                f = P.poly([V3(la + fr, h0, -0.008), V3(lb - fr, h0, -0.008), V3(lb - fr, h1, -0.008), V3(la + fr, h1, -0.008)],
                           "glass_dark", mat=GLASS)
            # hinges on the outer edge
            for hh in (0.6, 1.25, 1.9):
                ex = la if la < mid else lb
                P.box((X(hh) + 0.008, Yof(ex), hh), (0.016, 0.03, 0.08), "trim")
        # rubber seal between the leaves
        P.box((X(1.2) + 0.006, Yof(mid), (z0 + z1) / 2), (0.014, 0.025, z1 - z0), "seal")
        # aluminium step with a yellow edge, inside the opening
        P.box((1.245 - 0.20, Yof(mid), 0.325), (0.36, b - a - 0.02, 0.03), "alu")
        P.box((1.245 - 0.035, Yof(mid), 0.342), (0.035, b - a - 0.02, 0.006), "step_yellow")
        # amber warning lamps above the inside of the door
        for xf in (a + 0.18, b - 0.18):
            P.box((1.245 - 0.16, Yof(xf), 2.16), (0.06, 0.06, 0.03), "lens_amber")
    # wheelchair / pram pictograms on the middle door's glass
    a, b = DOORS[1]
    # round stickers: a 24-gon cut to the sticker's white edge (bus review r3: a square quad showed the region's dark
    # corners round the round sticker)
    for k, (name, xf) in enumerate((("icon_wheel", a + 0.34), ("icon_stroller", b - 0.34))):
        hc, rad, ru = 0.66, 0.11 * 0.465 / 0.5, 0.465
        x = W(0.6) - 0.055 + 0.004
        ring, uvs = [], []
        for j in range(24):
            t = 2 * math.pi * j / 24
            ring.append((x, Yof(xf) + rad * math.cos(t), hc + rad * math.sin(t)))
            uvs.append(region_uv(name, 0.5 - ru * math.cos(t), 0.5 - ru * math.sin(t)))
        f = P.poly(ring, uvs)
        orient_to(f, Vector((1, 0, 0)))


def window_bars(P):
    """Inside each side window: the transom between the fixed lower pane and the sliding upper one, and the upper
    panes' meeting rail; the driver's window has its sliding rail."""
    for side, wins in ((1, WIN_R), (-1, WIN_L)):
        for k, (a, b) in enumerate(wins):
            x = side * (W(1.88) - 0.022)
            if side == -1 and k == 0:
                P.box((side * (W(1.8) - 0.022), Yof(0.95), 1.865), (0.008, 0.025, 1.17), "black")
                continue
            P.box((x, Yof((a + b) / 2), 1.88), (0.008, b - a, 0.028), "black")
            if b - a > 1.0:
                m = (a + b) / 2
                P.box((side * (W(2.15) - 0.022), Yof(m), 2.165), (0.008, 0.028, 0.57), "black")


def led_signs(P):
    """The destination signs behind the glass: front (follows the bowed glass), kerb side, rear."""
    K = 12
    for k in range(K):
        x0 = 0.85 - 1.7 * k / K
        x1 = 0.85 - 1.7 * (k + 1) / K
        quad = []
        for (X, h) in ((x0, 2.33), (x1, 2.33), (x1, 2.53), (x0, 2.53)):
            p, n = surface(h, "F", X, -0.055)
            quad.append(p)
        s0, s1 = k / K, (k + 1) / K
        f = P.poly(quad, [led_uv("front", s0, 1), led_uv("front", s1, 1), led_uv("front", s1, 0), led_uv("front", s0, 0)], mat=LED)
        orient_to(f, Vector((0, 1, 0)))
    x = W(2.34) - 0.05
    a, b = 1.55, 2.45
    f = P.poly([(x, Yof(b), 2.25), (x, Yof(a), 2.25), (x, Yof(a), 2.43), (x, Yof(b), 2.43)],
               [led_uv("side", 0, 1), led_uv("side", 1, 1), led_uv("side", 1, 0), led_uv("side", 0, 0)], mat=LED)
    orient_to(f, Vector((1, 0, 0)))
    y = Yof(R(2.43) + BOWR) + 0.06
    f = P.poly([(-0.35, y, 2.33), (0.35, y, 2.33), (0.35, y, 2.53), (-0.35, y, 2.53)],
               [led_uv("rear", 0, 1), led_uv("rear", 1, 1), led_uv("rear", 1, 0), led_uv("rear", 0, 0)], mat=LED)
    orient_to(f, Vector((0, -1, 0)))
    # black backing boxes behind the signs
    P.box((0, Yof(F(2.43) + 0.12), 2.43), (1.8, 0.06, 0.26), "black")
    P.box((W(2.34) - 0.09, Yof(2.0), 2.34), (0.06, 0.94, 0.22), "black")
    P.box((0, y + 0.04, 2.43), (0.76, 0.05, 0.24), "black")


DECAL_OUT = 0.004          # the wordmark decals stand this far proud of the paint (m)


def decal_uv(s, t):
    """(s, t) across the wordmark region: s 0 at the text's left, t 0 at its top."""
    return region_uv("wordmark", s, t)


def wordmarks(P):
    """Livery r4: the village's name (make_bus_textures.py wordmark(): the crescent and 케이슨 마을 in Jua, drawn on the
    paint it sits on, ~450 px a metre) as thin decals on both sides below the windows and on the rear under the rear
    window. Each reads left to right from outside: on the right (door) side the text's left is toward the back, on the
    left side toward the front, on the rear toward -X. The rear decal follows the rear face's lean and bow."""
    D = ATL.get("decals")
    if not D:
        return
    _, _, rw, rh = REG["wordmark"]
    asp = rh / rw
    out = D.get("out", DECAL_OUT)
    for side, key in ((1, "side_r"), (-1, "side_l")):
        d = D[key]
        dw = d["w"]
        dh = dw * asp
        a, b = d["xf"] - dw / 2, d["xf"] + dw / 2
        h0, h1 = d["h"] - dh / 2, d["h"] + dh / 2
        X = side * (W(d["h"]) + out)
        xl, xr = (b, a) if side == 1 else (a, b)
        f = P.poly([(X, Yof(xl), h1), (X, Yof(xr), h1), (X, Yof(xr), h0), (X, Yof(xl), h0)],
                   [decal_uv(0, 0), decal_uv(1, 0), decal_uv(1, 1), decal_uv(0, 1)], smooth=True)
        orient_to(f, Vector((side, 0, 0)))
    d = D["rear"]
    dw = d["w"]
    dh = dw * asp
    h0, h1 = d["h"] - dh / 2, d["h"] + dh / 2
    n = 8
    grid = []
    for h in (h1, h0):
        row = []
        for k in range(n + 1):
            X = d["X"] - dw / 2 + dw * k / n
            p, _ = surface(h, "B", X, out)
            row.append(P.v(p))
        grid.append(row)
    for k in range(n):
        f = P.face([grid[0][k], grid[0][k + 1], grid[1][k + 1], grid[1][k]],
                   [decal_uv(k / n, 0), decal_uv((k + 1) / n, 0), decal_uv((k + 1) / n, 1), decal_uv(k / n, 1)], smooth=True)
        orient_to(f, Vector((0, -1, 0)))


def decal_ao(ob):
    """The decals take the body's ambient occlusion from the paint right behind them (closest point, interpolated over
    that face's welded per-vertex AO), so no rectangle of different shading shows round the wordmark."""
    from mathutils.bvhtree import BVHTree
    from mathutils.interpolate import poly_3d_calc
    if "wordmark" not in REG:
        return
    me = ob.data
    x0, y0, w, hh = REG["wordmark"]
    u0, u1 = x0 / NA - 1e-3, (x0 + w) / NA + 1e-3
    v0, v1 = 1 - (y0 + hh) / NA - 1e-3, 1 - y0 / NA + 1e-3
    uv = np.empty(len(me.loops) * 2, np.float32)
    me.uv_layers["UVMap"].data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    attr = me.color_attributes["AO"]
    a = np.empty(len(me.loops) * 4, np.float32)
    attr.data.foreach_get("color", a)
    a = a.reshape(-1, 4)
    decal, body = [], []
    for p in me.polygons:
        if p.material_index != BODY:
            continue
        lu = uv[p.loop_start:p.loop_start + p.loop_total]
        if ((lu[:, 0] >= u0) & (lu[:, 0] <= u1) & (lu[:, 1] >= v0) & (lu[:, 1] <= v1)).all():
            decal.append(p)
        else:
            body.append(p)
    vert_ao = np.ones(len(me.vertices), np.float32)
    for p in body:
        for li in range(p.loop_start, p.loop_start + p.loop_total):
            vert_ao[me.loops[li].vertex_index] = a[li, 0]
    co = [v.co.copy() for v in me.vertices]
    tree = BVHTree.FromPolygons(co, [list(p.vertices) for p in body])
    for p in decal:
        a[p.loop_start:p.loop_start + p.loop_total, :3] = 1.0
        a[p.loop_start:p.loop_start + p.loop_total, 3] = 1.0
    n = 0
    for p in decal:
        for li in range(p.loop_start, p.loop_start + p.loop_total):
            vi = me.loops[li].vertex_index
            loc, nrm, idx, dist = tree.find_nearest(co[vi], 0.05)
            if idx is None:
                continue
            q = body[idx]
            wts = poly_3d_calc([co[j] for j in q.vertices], loc)
            val = float(sum(wt * vert_ao[j] for wt, j in zip(wts, q.vertices)))
            a[li, 0] = a[li, 1] = a[li, 2] = val
            n += 1
    attr.data.foreach_set("color", a.ravel())
    log("decal AO from the paint behind:", len(decal), "decal faces,", n, "corners")


def roof_kit(P):
    zr = 3.045
    # air conditioner: rounded box, louvred sides, two fan grilles, a sloped front cover
    c = Vector((0, Yof(2.40), zr + 0.115))
    size = (1.90, 2.60, 0.23)

    def ac_uv(co, n):
        if abs(n.x) > 0.7:
            return region_uv("ac_louvre", (co.y / size[1] + 0.5), 1 - (co.z / size[2] + 0.5))
        return cell("ac")
    P.bevel_box(c, size, 0.07, 2, uv_fn=ac_uv)
    for xf in (1.75, 3.05):
        g = Vector((0, Yof(xf), zr + 0.232))
        P.lathe(g, (0, 0, 1), [(0.0, 0.235), (0.018, 0.232), (0.02, 0.215), (0.004, 0.2), (0.004, 0.06), (0.03, 0.05), (0.03, 0.0)],
                20, lambda pi, sj, a, r, phi, b, bi: cell("ac" if bi < 2 else ("grille" if bi < 4 else "steel")), smooth=False)
    f = P.poly([(-0.92, Yof(0.82), zr - 0.01), (0.92, Yof(0.82), zr - 0.01), (0.92, Yof(1.12), zr + 0.20), (-0.92, Yof(1.12), zr + 0.20)], "ac")
    orient_to(f, Vector((0, 1, 1)))
    for s in (1, -1):
        f = P.poly([(s * 0.92, Yof(0.82), zr - 0.01), (s * 0.92, Yof(1.12), zr - 0.01), (s * 0.92, Yof(1.12), zr + 0.20)], "ac")
        orient_to(f, Vector((s, 0, 0)))
    # roof hatches
    for xf in (4.9, 7.0):
        P.bevel_box((0, Yof(xf), zr + 0.03), (0.65, 0.65, 0.06), 0.02, 2, "ac")
        P.box((0, Yof(xf), zr + 0.061), (0.5, 0.5, 0.002), "roof")
    # rear vent grille
    P.bevel_box((0, Yof(8.0), zr + 0.05), (0.9, 0.5, 0.11), 0.03, 2, uv_fn=lambda co, n: (
        region_uv("roof_grille", co.x / 0.9 + 0.5, co.y / 0.5 + 0.5) if n.z > 0.7 else cell("ac")))
    # antennas
    P.bevel_box((0.0, Yof(4.25), zr + 0.04), (0.06, 0.18, 0.08), 0.02, 2, "black")
    P.tube([(-0.45, Yof(0.95), zr - 0.02), (-0.45, Yof(1.0), zr + 0.30)], 0.005, 5, "black")


# ============================================================================================ the cabin ==
# Bus-ride rebuild (2026-11-15). Heights here are FINAL heights (the shell's own are remapped by HN). The cabin is written
# straight into them: ceiling 3.15, 14 passenger seats (1+1, the back row 3), white-grey stanchions with yellow hand bands,
# ceiling rails with ring straps, red stop buttons, an LED next-stop display, card terminals, the wheelchair bay and a
# speckled rubber floor. The poles, strap groups and stop buttons are separate objects (pole_*, strap_*, stop_btn_*): the
# game's rider camera fades the ones that come between it and the avatar. Everything the game walks on or sits on is
# written to export/village_bus_cabin.json (the source of shared/src/village/generated/busCabin.ts).

CABIN_FRONT = 0.32   # where the cabin's flat side linings may start: behind the front corners' roll (F <= 0.054 + RCF)
CEIL = 3.15
FIXTURE_PREFIXES = ("pole_", "strap_", "stop_btn_", "rail_")
CABIN = {"seats": [], "holds": [], "poles": [], "straps": [], "seatBacks": [], "solids": [], "floor": [],
         "ceiling": CEIL, "innerHalfWidth": 1.195, "doors": [list(d) for d in DOORS]}


CLOTH_IDX = {"seat_blue": 0, "seat_teal": 1, "seat_pink": 2, "seat_yellow": 3}


def cloth_uv(fabric, size):
    """UVs for a seat's cloth faces (bus-ride r2): the fabric's woven cell in the atlas's seat_cloth region, the pattern repeating
    four times across the face (the cell itself carries the repeats); a fabric with no cell stays a plain swatch."""
    idx = CLOTH_IDX.get(fabric)
    if idx is None:
        return None

    def fn(co, n):
        if abs(n.z) > 0.5:
            a, b = co.x / size[0], co.y / size[1]
        elif abs(n.y) > 0.5:
            a, b = co.x / size[0], co.z / size[2]
        else:
            a, b = co.y / size[1], co.z / size[2]
        sc = min(max(0.5 + a, 0.04), 0.96)
        tc = min(max(0.5 - b, 0.04), 0.96)
        return region_uv("seat_cloth", (idx + sc) / 4.0, tc)
    return fn


def seat(P, xf, X, floor, face=1, fabric="seat_blue", rot=0.0, w=0.62, folding=False):
    """A bus seat (bus review r2: moulded, not boxes): a pedestal, a rounded grey shell pan and a backrest tilted back,
    fabric cushions on both, and a grab handle over the backrest's top; `face` +1 looks forward (+Y). `w`: shell width."""
    M = Matrix.Rotation(rot, 3, "Z")
    base = Vector((X, Yof(xf), floor))
    T = lambda v: base + M @ Vector(v)
    fy = face
    if not folding:
        P.tube([T((0, 0.02 * fy, 0.0)), T((0, 0.02 * fy, 0.37))], 0.026, 6, "seat_shell", caps=False)
    P.bevel_box(T((0, 0.02 * fy, 0.395)), (w, 0.43, 0.045), 0.018, 1, "seat_shell", rot=M)
    P.bevel_box(T((0, 0.04 * fy, 0.432)), (w - 0.06, 0.37, 0.04), 0.017, 1, fabric, rot=M, uv_fn=cloth_uv(fabric, (w - 0.06, 0.37, 0.04)))
    tilt = Matrix.Rotation(-0.17 * fy, 3, "X")
    R = M @ tilt
    back = T((0, -0.185 * fy, 0.745))
    P.bevel_box(back, (w, 0.045, 0.60), 0.018, 1, "seat_shell", rot=R)
    P.bevel_box(back + R @ Vector((0, 0.035 * fy, -0.02)), (w - 0.03, 0.035, 0.50), 0.015, 1, fabric, rot=R, uv_fn=cloth_uv(fabric, (w - 0.03, 0.035, 0.50)))
    hw = w / 2 - 0.045
    top = [back + R @ Vector(v) for v in ((-hw, 0.0, 0.27), (-hw + 0.01, 0.0, 0.325), (hw - 0.01, 0.0, 0.325), (hw, 0.0, 0.27))]
    P.tube(top, 0.012, 5, "handle")


def seat_entry(sid, xf, X, floor, yaw):
    """Record a seat (and its walk footprint and its back's camera box) for the JSON, in the game's frame."""
    ahead, right = Yof(xf), X
    CABIN["seats"].append({"id": sid, "ahead": round(ahead, 3), "right": round(right, 3), "floor": floor, "yaw": round(yaw, 4), "backed": True})
    # footprint 0.62 across, 0.56 deep, turned by the seat's yaw (Blender rot, CCW about Z: local (x, y) = (right, ahead))
    c, s = math.cos(yaw), math.sin(yaw)
    pts = [(x * c - y * s, x * s + y * c) for x, y in ((-0.31, -0.28), (0.31, -0.28), (0.31, 0.28), (-0.31, 0.28))]
    rights = [right + p[0] for p in pts]
    aheads = [ahead + p[1] for p in pts]
    CABIN["solids"].append({"id": "seat_" + sid, "min": [round(min(aheads), 3), round(min(rights), 3)], "max": [round(max(aheads), 3), round(max(rights), 3)]})
    # the backrest: 0.62 wide, behind the cushion (opposite the facing), 0.12 deep, from the cushion up
    cx, cy = 0.0 * c + 0.20 * s, 0.0 * s - 0.20 * c
    bp = [(cx + x * c - y * s, cy + x * s + y * c) for x, y in ((-0.31, -0.06), (0.31, -0.06), (0.31, 0.06), (-0.31, 0.06))]
    CABIN["seatBacks"].append({"seat": sid, "min": [round(ahead + min(p[1] for p in bp), 3), round(right + min(p[0] for p in bp), 3), round(floor + 0.45, 3)],
                               "max": [round(ahead + max(p[1] for p in bp), 3), round(right + max(p[0] for p in bp), 3), round(floor + 1.12, 3)]})


def cabin():
    P = Part("bus_cabin", rm="keep")
    wi = 1.195
    z_sill = 1.28

    def floor(a, b, z, wmax=wi):
        """A floor from xf a to b, narrowed to the wheel housings' inner faces over each axle."""
        cuts = sorted({a, b} | {v for c in AXLES for v in (c - 0.64, c + 0.64) if a < v < b})
        for xa, xb in zip(cuts[:-1], cuts[1:]):
            w = 0.895 if any(c - 0.65 <= xa and xb <= c + 0.65 for c in AXLES) else wmax
            nseg = max(1, int(math.ceil((xb - xa) / 1.0)))
            for q in range(nseg):
                ya, yb = Yof(xa + (xb - xa) * q / nseg), Yof(xa + (xb - xa) * (q + 1) / nseg)
                uv = lambda co, ya=ya, yb=yb: region_uv("floor_rub", (co.x + wi) / (2 * wi), (ya - co.y) / (ya - yb))
                f = P.poly([(-w, ya, z), (w, ya, z), (w, yb, z), (-w, yb, z)], uv)
                if f:
                    orient_to(f, Vector((0, 0, 1)))
    floor(0.12, CABIN_FRONT, 0.34, wmax=1.0)
    floor(CABIN_FRONT, 5.85, 0.34)
    floor(5.85, 6.15, 0.545)
    floor(6.15, 8.70, 0.75)
    CABIN["floor"] = [{"xf0": 0.12, "xf1": 5.85, "h": 0.34}, {"xf0": 5.85, "xf1": 6.15, "h": 0.545}, {"xf0": 6.15, "xf1": 8.70, "h": 0.75}]
    for xf, z0, z1 in ((5.85, 0.34, 0.545), (6.15, 0.545, 0.75)):
        f = P.poly([(-wi, Yof(xf), z0), (wi, Yof(xf), z0), (wi, Yof(xf), z1), (-wi, Yof(xf), z1)], "floor")
        orient_to(f, Vector((0, 1, 0)))
        # the yellow nosing on the step's front edge
        P.box((0, Yof(xf) - 0.02, z1 + 0.003), (2 * wi, 0.07, 0.006), "step_yellow")

    def lining(side, a, b, z0):
        x = side * wi
        cuts = sorted({a, b} | {v for c in AXLES for v in (c - ARCH_R - 0.06, c + ARCH_R + 0.06) if a < v < b})
        for xa, xb in zip(cuts[:-1], cuts[1:]):
            over = any(c - ARCH_R - 0.07 <= xa and xb <= c + ARCH_R + 0.07 for c in AXLES)
            lo = max(z0, 1.10) if over else z0
            f = P.poly([(x, Yof(xa), lo), (x, Yof(xb), lo), (x, Yof(xb), z_sill), (x, Yof(xa), z_sill)], "wall")
            orient_to(f, Vector((-side, 0, 0)))
        f = P.poly([(x, Yof(a), z_sill), (x, Yof(b), z_sill), (x + side * 0.04, Yof(b), z_sill), (x + side * 0.04, Yof(a), z_sill)], "wall")
        orient_to(f, Vector((0, 0, 1)))
    for a, b in ((CABIN_FRONT, 0.40), (1.49, 4.35), (5.75, 5.85)):
        lining(1, a, b, 0.34)
    lining(1, 6.15, 8.70, 0.75)
    lining(-1, CABIN_FRONT, 5.85, 0.34)
    lining(-1, 6.15, 8.70, 0.75)
    # rear wall (up to the rear window's lower edge) and the white ceiling with ducts, LED strips and round vents
    zr = HN(1.95)
    f = P.poly([(-wi, Yof(8.70), 0.75), (wi, Yof(8.70), 0.75), (wi, Yof(8.70), zr), (-wi, Yof(8.70), zr)], "wall")
    orient_to(f, Vector((0, 1, 0)))
    f = P.poly([(-1.0, Yof(0.35), CEIL), (1.0, Yof(0.35), CEIL), (1.0, Yof(8.65), CEIL), (-1.0, Yof(8.65), CEIL)], "ceiling")
    orient_to(f, Vector((0, 0, -1)))
    for s in (1, -1):
        P.box((s * 1.09, Yof(4.575), CEIL - 0.03), (0.22, 8.05, 0.10), "ceiling")
        f = P.poly([(s * 0.975, Yof(0.6), CEIL - 0.08), (s * 0.975, Yof(8.6), CEIL - 0.08), (s * 0.975, Yof(8.6), CEIL - 0.06), (s * 0.975, Yof(0.6), CEIL - 0.06)], "led_warm")
        orient_to(f, Vector((-s, 0, -0.3)))
        f = P.poly([(s * 0.36, Yof(1.0), CEIL - 0.005), (s * 0.36, Yof(8.4), CEIL - 0.005), (s * 0.30, Yof(8.4), CEIL - 0.005), (s * 0.30, Yof(1.0), CEIL - 0.005)], "led_warm")
        orient_to(f, Vector((0, 0, -1)))
    for k in range(6):
        P.disc((0, Yof(1.8 + 1.2 * k), CEIL - 0.004), (0, 0, -1), 0.11, 14, "grille")
    for xf in (0.9, 5.05):   # CCTV domes: at the front door and over the middle door
        P.lathe((0.0 if xf < 2 else 0.95, Yof(xf), CEIL), (0, 0, -1), [(0.0, 0.0), (0.02, 0.06), (0.05, 0.075), (0.07, 0.04), (0.075, 0.0)], 12,
                lambda pi, sj, a, r, phi, b, bi: cell("black"), smooth=True)
    # wheel housings (the arch covers); the front ones carry the platform seats
    for s in (1, -1):
        for c, z0 in ((AXLES[0], 0.34), (AXLES[1], 0.75)):
            P.bevel_box((s * 0.745, Yof(c), (z0 + 1.09) / 2), (0.30, 1.28, 1.09 - z0), 0.04, 1, "wall")
            P.box((s * 1.05, Yof(c), 1.075), (0.30, 1.28, 0.03), "wall")
            ahead = Yof(c)
            CABIN["solids"].append({"id": "housing_%s_%d" % ("r" if s > 0 else "l", int(c * 100)),
                                    "min": [round(ahead - 0.64, 3), round(min(s * 0.595, s * 1.195), 3)],
                                    "max": [round(ahead + 0.64, 3), round(max(s * 0.595, s * 1.195), 3)]})
    # dashboard, driver's place (not a passenger seat: behind the partition)
    P.bevel_box((0, Yof(0.34), 0.70), (2.30, 0.42, 0.70), 0.06, 1, "dash")
    P.bevel_box((-0.62, Yof(0.42), 1.07), (0.62, 0.30, 0.12), 0.04, 1, "dash")
    sw = []
    for k in range(13):
        a = 2 * math.pi * k / 12
        sw.append(Vector((-0.62 + 0.22 * math.cos(a), Yof(0.70) + 0.22 * math.sin(a) * math.sin(0.5), 1.08 + 0.22 * math.sin(a) * math.cos(0.5))))
    P.tube(sw, 0.018, 5, "dash", caps=False)
    P.tube([(-0.62, Yof(0.70), 1.08), (-0.62, Yof(0.48), 0.86)], 0.03, 6, "dash")
    seat(P, 1.02, -0.62, 0.34, 1, "seat_shell")
    CABIN["solids"].append({"id": "dash", "min": [round(Yof(0.55), 3), -1.2], "max": [round(Yof(0.0), 3), 1.2]})
    CABIN["solids"].append({"id": "driver_partition", "min": [round(Yof(1.40), 3), -1.2], "max": [round(Yof(0.0), 3), -0.35]})
    # the driver's partition: screen, card terminal and its glass
    P.box((-0.75, Yof(1.32), 1.15), (0.85, 0.02, 0.05), "terminal")
    P.box((-0.33, Yof(1.32), 1.04), (0.03, 0.03, 1.40), "terminal")
    P.poly([(-1.17, Yof(1.32), 0.95), (-0.35, Yof(1.32), 0.95), (-0.35, Yof(1.32), 1.95), (-1.17, Yof(1.32), 1.95)], "glass_dark", mat=GLASS)
    # the card terminals: a post beside the front door and one at the middle door
    for (x, xf, z) in ((0.82, 0.95, 0.34), (0.80, 5.83, 0.34)):
        P.tube([(x, Yof(xf), z), (x, Yof(xf), z + 1.05)], 0.02, 6, "terminal")
        P.bevel_box((x, Yof(xf) - 0.02, z + 1.15), (0.14, 0.09, 0.22), 0.02, 1, "terminal")
        P.box((x, Yof(xf) + 0.026, z + 1.17), (0.09, 0.004, 0.07), "screen")
        CABIN["solids"].append({"id": "fare_%d" % int(xf * 100), "min": [round(Yof(xf) - 0.06, 3), round(x - 0.06, 3)],
                                "max": [round(Yof(xf) + 0.06, 3), round(x + 0.06, 3)]})
    # --- seats: 1+1 up front, the wheelchair bay's two folding seats, the rear pairs and the back row of three
    SEATS = [
        ("L1", 2.35, -0.86, 0.80, 0.0, "seat_teal"),
        ("L2", 3.25, -0.86, 0.34, 0.0, "seat_pink"),       # 임산부 배려석
        ("L3", 4.10, -0.86, 0.34, 0.0, "seat_yellow"),
        ("R1", 2.35, 0.86, 0.80, 0.0, "seat_teal"),
        ("R2", 3.40, 0.86, 0.34, 0.0, "seat_yellow"),
        ("W1", 4.50, -0.93, 0.34, -math.pi / 2, "seat_teal"),
        ("W2", 5.50, -0.93, 0.34, -math.pi / 2, "seat_teal"),
        ("RL1", 6.70, -0.86, 0.86, 0.0, "seat_blue"),
        ("RR1", 6.70, 0.86, 0.86, 0.0, "seat_blue"),
        ("RL2", 7.55, -0.86, 0.75, 0.0, "seat_blue"),
        ("RR2", 7.55, 0.86, 0.75, 0.0, "seat_blue"),
        ("B1", 8.35, -0.80, 0.75, 0.0, "seat_blue"),
        ("B2", 8.35, 0.0, 0.75, 0.0, "seat_blue"),
        ("B3", 8.35, 0.80, 0.75, 0.0, "seat_blue"),
    ]
    for sid, xf, X, fl, rot, fab in SEATS:
        seat(P, xf, X, fl, 1, fab, rot=rot, folding=sid.startswith("W"))
        seat_entry(sid, xf, X, fl, rot)
    # the wheelchair bay: a blue floor marking, a yellow bar at 0.93 m and belt reels on the wall
    P.box((-0.72, Yof(5.05), 0.343), (0.95, 1.30, 0.006), "seat_blue")
    P.box((-1.14, Yof(5.05), 0.93), (0.05, 1.45, 0.04), "step_yellow")
    for xf in (4.12, 5.88):
        P.tube([(-1.12, Yof(xf), 0.34), (-1.12, Yof(xf), 0.93)], 0.02, 6, "step_yellow", caps=False)
    for xf in (4.12, 5.88):
        P.box((-1.16, Yof(xf), 0.55), (0.06, 0.08, 0.16), "black")
    # displays: the front LED next-stop sign, the monitor over the middle door, a route strip along the left wall
    P.box((0.0, Yof(0.62), 2.95), (1.5, 0.05, 0.20), "black")
    ysg = Yof(0.62) - 0.0255
    f = P.poly([(-0.70, ysg, 2.88), (0.70, ysg, 2.88), (0.70, ysg, 3.01), (-0.70, ysg, 3.01)],
               [region_uv("next_sign", 0, 1), region_uv("next_sign", 1, 1), region_uv("next_sign", 1, 0), region_uv("next_sign", 0, 0)])
    if f:
        orient_to(f, Vector((0, -1, 0)))
    P.box((1.165, Yof(5.05), 2.75), (0.06, 0.62, 0.38), "black", faces={"-x": "screen"})
    P.box((-1.185, Yof(4.9), 2.85), (0.02, 6.2, 0.14), "ceiling", faces={"+x": "ivory"})
    # the middle door: a yellow step nose, the exit panel and amber lamps
    P.box((1.0, Yof(5.05), 0.346), (0.34, 1.34, 0.006), "step_yellow")
    P.box((1.16, Yof(5.05), 3.02), (0.07, 1.50, 0.14), "black")     # the door header, flush to the wall
    for xf in (4.50, 5.60):
        P.box((1.1255, Yof(xf), 3.02), (0.004, 0.20, 0.03), "lens_amber")
    CABIN["bounds"] = {"aheadMin": round(Yof(8.70), 3), "aheadMax": round(Yof(0.12), 3), "right": wi}
    return P.finish(sharp_deg=40)


def fixture(name, build_fn):
    """One separate object (pole_*, strap_*, stop_btn_*, rail_*): a Part whose mesh is left out of the body's join."""
    P = Part(name, rm="keep")
    build_fn(P)
    return P.finish(sharp_deg=40)


def stanchions():
    """White-grey vertical stanchions with a yellow hand band, each its own object; ceiling rails; ring straps in groups;
    red stop buttons. Written to CABIN (poles, straps, holds)."""
    poles = [(-0.56, 2.80), (-0.56, 3.68), (0.56, 2.87), (0.56, 3.90), (0.90, 1.55), (0.90, 4.22), (0.90, 5.82),
             (-0.56, 6.25), (0.56, 6.25), (-0.56, 7.12), (0.56, 7.12)]
    for k, (X, xf) in enumerate(poles):
        z0 = 0.34 if xf < 6.0 else 0.75
        CABIN["poles"].append({"name": "pole_%d" % k, "ahead": round(Yof(xf), 3), "right": X, "z0": z0, "z1": CEIL, "r": 0.0175})

        def build(P, X=X, xf=xf, z0=z0):
            P.tube([(X, Yof(xf), z0), (X, Yof(xf), CEIL)], 0.0175, 8, "pole_white", caps=False)
            # the yellow hand band, and flanges at the floor and the ceiling
            P.tube([(X, Yof(xf), z0 + 1.10), (X, Yof(xf), z0 + 1.40)], 0.0205, 8, "step_yellow", caps=False)
            P.tube([(X, Yof(xf), z0), (X, Yof(xf), z0 + 0.012)], 0.045, 10, "pole_white", caps=True)
            P.tube([(X, Yof(xf), CEIL - 0.012), (X, Yof(xf), CEIL)], 0.045, 10, "pole_white", caps=True)
            # a red stop button on the pole's aisle side at shoulder height
            sgn = -1 if X > 0 else 1
            P.bevel_box((X + sgn * 0.03, Yof(xf), 1.55), (0.05, 0.05, 0.08), 0.012, 1, "red")
        fixture("pole_%d" % k, build)
    holds = [(1.15, 0.32, 4), (2.80, -0.14, 0), (3.55, -0.14, 1), (4.15, 0.28, 3), (5.60, 0.34, 6), (6.25, -0.14, 7), (7.12, 0.20, 10)]
    for h, (xf, X, pk) in enumerate(holds):
        fl = 0.34 if xf < 5.85 else 0.75
        CABIN["holds"].append({"id": "H%d" % (h + 1), "ahead": round(Yof(xf), 3), "right": X, "floor": fl, "yaw": 0.0, "pole": "pole_%d" % pk})
    # ceiling rails (one object each side) and ring straps in groups of four
    for s, nm in ((1, "r"), (-1, "l")):
        def rail(P, s=s):
            x = s * 0.60
            P.tube([(x, Yof(1.5), CEIL - 0.01), (x, Yof(1.62), 2.85), (x, Yof(8.0), 2.85), (x, Yof(8.1), CEIL - 0.01)], 0.016, 6, "pole_white", caps=False)
        fixture("rail_%s" % nm, rail)
        for g in range(2):
            xs = [1.9 + 0.5 * (g * 4 + k) for k in range(4)]
            CABIN["straps"].append({"name": "strap_%s_%d" % (nm, g), "ahead": round(Yof(sum(xs) / 4), 3), "right": s * 0.60, "z0": 2.45, "z1": 2.85})

            def build(P, s=s, xs=xs):
                for xf in xs:
                    top = Vector((s * 0.60, Yof(xf), 2.85))
                    P.box(top + Vector((0, 0, -0.10)), (0.025, 0.012, 0.18), "dash")
                    tri = [top + Vector((0, 0.06, -0.31)), top + Vector((0, -0.06, -0.31)), top + Vector((0, 0, -0.40))]
                    P.tube(tri + [tri[0]], 0.011, 5, "handle", caps=False)
            fixture("strap_%s_%d" % (nm, g), build)
    # stop buttons on the window pillars beside the seats
    for k, (xf, X) in enumerate(((2.78, -1.17), (3.62, -1.17), (4.45, -1.17), (6.98, -1.17), (6.98, 1.17), (8.0, 1.17))):
        sgn = 1 if X < 0 else -1
        fl = 0.34 if xf < 5.85 else 0.75

        def build(P, X=X, xf=xf, sgn=sgn, fl=fl):
            P.bevel_box((X + sgn * 0.02, Yof(xf), fl + 1.2), (0.04, 0.05, 0.09), 0.012, 1, "red")
        fixture("stop_btn_%d" % k, build)


# ============================================================================================== wheels ==

def wheels():
    """Tyres (275/70R22.5: a rounded shoulder, a rim-protector ridge, the tread band) and steel wheels: the front one
    with ten hand holes in its dish, a raised hub flange carrying ten hex nuts and the axle's conical hub cap standing
    about 70 mm proud (bus review r2); the rear twins' outer wheel dished in, its nuts and cap at the bottom."""
    P = Part("bus_wheels")
    tyre = [(-0.100, 0.290), (-0.122, 0.300), (-0.129, 0.311), (-0.124, 0.322), (-0.134, 0.355), (-0.138, 0.398),
            (-0.133, 0.435), (-0.122, 0.458), (-0.104, 0.474), (-0.085, 0.478), (0.085, 0.478), (0.104, 0.474),
            (0.122, 0.458), (0.133, 0.435), (0.138, 0.398), (0.134, 0.355), (0.124, 0.322), (0.129, 0.311),
            (0.122, 0.300), (0.100, 0.290)]
    TREAD = 9      # profile index of the tread band's start
    SEG = 32
    REP = 8        # tread texture repeats round the tyre

    def tyre_uv(s, segs):
        rep_ = max(1, segs // REP)

        def f(pi, sj, a, r, phi, base, bi):
            u0 = ((base % rep_) + (sj - base)) / rep_
            if bi == TREAD:
                return region_uv("tread", u0, (a * s + 0.085) / 0.17)
            ri = (r - 0.29) / (0.478 - 0.29)
            return region_uv("wall", u0, 1 - ri)
        return f

    def tyre_at(X, Y, outward, segs=SEG):
        prof = [(a * outward, r) for a, r in tyre]
        P.lathe((X, Y, WHEEL_Z), (1, 0, 0), prof, segs, tyre_uv(outward, segs), smooth=True)

    def rim_uv(region):
        return lambda pi, sj, a, r, phi, base, bi: region_uv(region, 0.5 + r * math.cos(phi) / 0.58, 0.5 - r * math.sin(phi) / 0.58)

    def rim_at(X, Y, s, dished):
        if not dished:
            prof = [(0.100, 0.290), (0.114, 0.289), (0.118, 0.281), (0.106, 0.268), (0.090, 0.252), (0.086, 0.232),
                    (0.086, 0.200), (0.092, 0.193), (0.106, 0.188), (0.108, 0.128), (0.113, 0.120), (0.150, 0.100),
                    (0.180, 0.083), (0.196, 0.066), (0.2035, 0.045), (0.2055, 0.020), (0.206, 0.0)]
        else:
            prof = [(0.100, 0.290), (0.112, 0.288), (0.112, 0.276), (0.080, 0.258), (0.020, 0.235), (-0.025, 0.200),
                    (-0.035, 0.140), (-0.035, 0.112), (0.010, 0.108), (0.040, 0.090), (0.052, 0.040), (0.054, 0.0)]
        reg = "rim_f" if not dished else "rim_r"
        P.lathe((X, Y, WHEEL_Z), (s, 0, 0), prof, 32, rim_uv(reg), smooth=True)
        # ten hex nuts on the hub flange (front) or the dish's bottom (rear)
        an = (0.107 if not dished else -0.034)
        for k in range(10):
            phi = 2 * math.pi * (k + 0.5) / 10 + 0.31
            c = Vector((X + s * an, Y + 0.1675 * math.cos(phi), WHEEL_Z + 0.1675 * math.sin(phi)))
            P.lathe(c, (s, 0, 0), [(0.0, 0.021), (0.024, 0.021), (0.029, 0.013), (0.030, 0.0)], 6,
                    lambda *a: cell("nut"), smooth=False)

    for s in (1, -1):
        y = Yof(AXLES[0])
        tyre_at(s * 1.040, y, s)
        rim_at(s * 1.040, y, s, False)
        y = Yof(AXLES[1])
        tyre_at(s * 1.0805, y, s)
        rim_at(s * 1.0805, y, s, True)
        tyre_at(s * 0.7745, y, s, segs=24)
        P.disc((s * (0.7745 + 0.10), y, WHEEL_Z), (s, 0, 0), 0.29, 16, "steel")
        # hub drum behind the front wheel
        P.lathe((s * 0.88, Yof(AXLES[0]), WHEEL_Z), (s, 0, 0), [(0.0, 0.2), (0.06, 0.2), (0.06, 0.0)], 12, lambda *a: cell("steel"))
    return P.finish(sharp_deg=45)


# =========================================================================================== materials ==

def image(name, colorspace):
    im = bpy.data.images.load(os.path.join(TEXB, name), check_existing=True)
    im.colorspace_settings.name = colorspace
    return im


def make_materials():
    mats = []
    # M_bus
    m = bpy.data.materials.new("M_bus")
    m.use_nodes = True
    m.use_backface_culling = False
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tb = nt.nodes.new("ShaderNodeTexImage")
    tb.image = image("bus_base.png", "sRGB")
    to = nt.nodes.new("ShaderNodeTexImage")
    to.image = image("bus_orm.png", "Non-Color")
    te = nt.nodes.new("ShaderNodeTexImage")
    te.image = image("bus_emit.png", "sRGB")
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(tb.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(to.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    nt.links.new(te.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 1.0
    for t in (tb, to, te):
        t.interpolation = "Linear"
    mats.append(m)
    # M_bus_glass
    g = bpy.data.materials.new("M_bus_glass")
    g.use_nodes = True
    g.use_backface_culling = False
    b = next(n for n in g.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (0.020, 0.028, 0.032, 1)
    b.inputs["Roughness"].default_value = 0.04
    b.inputs["Metallic"].default_value = 0.0
    b.inputs["Alpha"].default_value = 0.45
    try:
        g.surface_render_method = "BLENDED"
    except Exception:
        pass
    mats.append(g)
    # M_bus_led
    e = bpy.data.materials.new("M_bus_led")
    e.use_nodes = True
    nt = e.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tl = nt.nodes.new("ShaderNodeTexImage")
    tl.image = image("bus_led.png", "sRGB")
    tl.interpolation = "Linear"
    b.inputs["Base Color"].default_value = (0.01, 0.01, 0.01, 1)
    b.inputs["Roughness"].default_value = 0.5
    nt.links.new(tl.outputs["Color"], b.inputs["Emission Color"])
    b.inputs["Emission Strength"].default_value = 1.0
    mats.append(e)
    # M_bus_ground: the contact shadow's map as its base colour (ground_shadow bakes it; the game draws it black
    # through that map)
    gr = bpy.data.materials.new("M_bus_ground")
    gr.use_nodes = True
    nt = gr.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tg = nt.nodes.new("ShaderNodeTexImage")
    tg.interpolation = "Linear"
    nt.links.new(tg.outputs["Color"], b.inputs["Base Color"])
    nt.nodes.active = tg
    mats.append(gr)
    return mats


# ============================================================================================== assemble ==

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    global COLL, MATS
    COLL = bpy.data.collections.new("bus")
    bpy.context.scene.collection.children.link(COLL)
    MATS = make_materials()


def build():
    reset()
    shell = build_shell()
    build_roof_cap(shell)
    arch_panels(shell)
    shell_ob = shell.finish(weld=1e-5, sharp_deg=32)
    underbody()
    D = Part("bus_details")
    front_details(D)
    rear_details(D)
    side_details(D)
    doors(D)
    window_bars(D)
    D.finish(sharp_deg=40)
    DK = Part("bus_details_keep", rm="keep")      # the mirrors stay at head height (colliders: busBody.ts BUS_MIRRORS)
    mirror(DK, 1, 2.00)
    mirror(DK, -1, 1.75)
    aux_mirror(DK)
    DK.finish(sharp_deg=40)
    DL = Part("bus_details_led", rm="shift")
    led_signs(DL)
    DL.finish(sharp_deg=40)
    DR = Part("bus_details_roof", rm="shift")
    roof_kit(DR)
    DR.finish(sharp_deg=40)
    bumpers().finish(sharp_deg=40)
    cabin()
    stanchions()
    wheels()
    WM = Part("bus_decals")      # livery r4: the wordmark decals (joined after the AO bake)
    wordmarks(WM)
    WM.finish(sharp_deg=40)
    for o in PARTS:
        tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
        log(f"part {o.name}: {len(o.data.polygons)} faces, {tris} tris")
    return PARTS


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


CABIN_CELLS = ("floor", "wall", "ceiling", "seat_shell", "seat_blue", "seat_teal", "seat_yellow", "seat_pink", "pole_white", "pole_yellow",
               "pole_orange", "handle", "dash", "terminal")
CABIN_DARK = 0.6


def bake_ao(ob, samples=96):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "OPTIX"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == "OPTIX"
        scene.cycles.device = "GPU"
    except Exception as e:  # noqa: BLE001
        log("GPU setup failed", e)
    if scene.world is None:
        scene.world = bpy.data.worlds.new("W")
    scene.world.light_settings.distance = 0.7
    scene.cycles.samples = samples
    # the ground occludes too
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
    ground = bpy.context.active_object
    me = ob.data
    attr = me.color_attributes.new("AO", "FLOAT_COLOR", "CORNER")
    me.color_attributes.active_color = attr
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    # glass would shut the cabin's light out: bake without it
    glass_faces = [p.index for p in me.polygons if p.material_index == GLASS]
    log("baking AO", len(me.polygons), "faces")
    bpy.ops.object.bake(type="AO", target="VERTEX_COLORS", use_clear=True, margin=0)
    bpy.data.objects.remove(ground)
    a = np.empty(len(me.loops) * 4, np.float32)
    attr.data.foreach_get("color", a)
    a = a.reshape(-1, 4)
    ao = a[:, 0].copy()
    # light, not black: 0.28 + 0.72 ao
    v = 0.28 + 0.72 * np.clip(ao, 0, 1)
    mat_of_loop = np.empty(len(me.loops), np.int32)
    for p in me.polygons:
        mat_of_loop[p.loop_start:p.loop_start + p.loop_total] = p.material_index
    v[mat_of_loop != BODY] = 1.0
    # the cabin: lit only through its tinted windows (the game's live light reaches it unshadowed), so its surfaces
    # carry a darker occlusion than the body's
    uv = np.empty(len(me.loops) * 2, np.float32)
    me.uv_layers["UVMap"].data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    inside = np.zeros(len(me.loops), bool)
    for name in CABIN_CELLS:
        c = np.array(cell(name), np.float32)
        inside |= np.abs(uv - c).max(1) < 1e-4
    v[inside] *= CABIN_DARK
    log("cabin loops darkened", int(inside.sum()))
    a[:, 0] = a[:, 1] = a[:, 2] = v
    a[:, 3] = 1.0
    attr.data.foreach_set("color", a.ravel())
    log("AO baked: mean", float(v.mean()), "p05", float(np.percentile(v, 5)))


GROUND_X = (-2.6, 2.6)      # the ground quad (m, bus axes): the body's half width (1.26) and its contact shadow (0.5 m),
                            # wide enough for the low beams' pool ahead
GROUND_Y = (-5.2, 11.4)     # along: the contact shadow behind the rear, the pool to 6.8 m ahead of the front
GROUND_SIZE = (GROUND_X[1] - GROUND_X[0], GROUND_Y[1] - GROUND_Y[0])
GROUND_PX = (128, 416)      # its map (px): about 4 cm a texel (a soft shadow and a soft pool)
GROUND_AO = 0.7             # how far the road "sees" the bus (m): the darkness hugs the body
CONTACT_REACH = 0.5         # bus review r4: the contact shadow is gone 0.5 m out from the body's outline
GROUND_Z = 0.05             # the game's ground decals' height (villageModelPrep VILLAGE_GROUND_DECAL), over every ground
                            # layer: the road (plaza disc 0.01), the paving rings, the lawns, the forecourt (0.03). Bus
                            # review r3: at 0 the road hid it from most views, at 0.02 the paving rings still did
LAYOUT = json.load(open(os.path.join(ROOT, "layout.json"), encoding="utf-8"))
BUS_AT = (LAYOUT["busStop"]["bus"]["centre"]["x"], LAYOUT["busStop"]["bus"]["centre"]["z"])
ROAD = LAYOUT["ringRoad"]   # the ring road's asphalt: radius +- width / 2 round its centre, a 0.1 m kerb on both edges
KERB_CLEAR = (0.15, 0.40)   # the quad's shadow and light fade out between these distances from a kerb's road face


def road_mask(X, Y):
    """1 on the ring road's asphalt, fading to 0 before either kerb (bus review r4: the kerbs and the verge stand over
    the 5 cm quad and cut whatever crossed them). Bus axes: the game's x = BUS_AT.x + X, z = BUS_AT.z - Y (nose north)."""
    gx = BUS_AT[0] + X - ROAD["centre"]["x"]
    gz = BUS_AT[1] - Y - ROAD["centre"]["z"]
    r = np.hypot(gx, gz)
    inner = ROAD["radius"] - ROAD["width"] / 2
    outer = ROAD["radius"] + ROAD["width"] / 2
    a, b = KERB_CLEAR
    t_in = np.clip((r - inner - a) / (b - a), 0, 1)
    t_out = np.clip((outer - r - a) / (b - a), 0, 1)
    return (t_in * t_in * (3 - 2 * t_in)) * (t_out * t_out * (3 - 2 * t_out))


def outline_distance(X, Y):
    """How far outside the body's plan outline a point is (m; 0 inside): a rounded rectangle round the lower body, the
    bumpers included (half width 1.26, front bumper 4.60, rear 4.56, corners 0.25)."""
    hx, rc = 1.26, 0.25
    front, rear = HALF + 0.10, HALF + 0.06
    cy = np.where(Y > 0, front, rear)
    qx = np.abs(X) - (hx - rc)
    qy = np.abs(Y) - (cy - rc)
    out = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) - rc
    return np.maximum(out, 0)


def ground_glow(X, Y):
    """The low beams' pool on the road ahead at night (bus review r4: a modest pool, in the spirit of the street lamps'):
    a soft oval from the bumper to about 6 m out, brightest 2-3 m ahead, about 1.4 m half width widening ahead; inside the
    road (road_mask). 0..1 over the quad's texels (bus axes, metres); the game scales and colours it."""
    d = Y - (HALF + 0.10)                                         # ahead of the bumper
    start = np.clip(d / 0.9, 0, 1)
    start = start * start * (3 - 2 * start)
    along = np.exp(-((d - 2.6) / 2.1) ** 2) * start
    w = 1.35 + 0.16 * np.maximum(d, 0)
    across = np.exp(-1.6 * (X / w) ** 2)
    pool = np.where(d > 0, along * across, 0.0)
    pool /= max(float(pool.max()), 1e-6)
    return np.clip(pool, 0, 1) * road_mask(X, Y)


def weld_ao(ob):
    """One AO value per vertex on the body's faces (the mean of its corners'): the bake samples every corner on its own,
    so the corners of a smooth surface round one vertex differed by noise and the exporter could not merge them (bus
    review r2: 302 KB of Draco for 25k triangles). Glass, signs and the ground quad keep 1.0."""
    me = ob.data
    attr = me.color_attributes["AO"]
    n = len(me.loops)
    a = np.empty(n * 4, np.float32)
    attr.data.foreach_get("color", a)
    a = a.reshape(-1, 4)
    vi = np.empty(n, np.int32)
    me.loops.foreach_get("vertex_index", vi)
    mat = np.empty(n, np.int32)
    for p in me.polygons:
        mat[p.loop_start:p.loop_start + p.loop_total] = p.material_index
    body = mat == BODY
    sums = np.bincount(vi[body], weights=a[body, 0], minlength=len(me.vertices))
    cnt = np.bincount(vi[body], minlength=len(me.vertices))
    mean = (sums / np.maximum(cnt, 1)).astype(np.float32)
    a[body, 0] = a[body, 1] = a[body, 2] = mean[vi[body]]
    a[~body, :3] = 1.0
    a[:, 3] = 1.0
    attr.data.foreach_set("color", a.ravel())
    log("AO welded per vertex:", int(body.sum()), "body corners,", len(me.vertices), "vertices")


def ground_shadow(samples=256):
    """The darkness the bus puts on the road under and round it (bus review r2: the village's light map is about 0.5 m a
    texel there, so the bus looked set on the road): ambient occlusion baked from the road up onto a quad round the
    footprint, the bus the only occluder, then kept to CONTACT_REACH round the body's outline and to the road (bus review
    r4: no long sun shadow across the verge onto the plaza; the contact shadow alone, like the houses' and the benches').
    Written as the M_bus_ground map (sRGB-encoded so that the game's decode gives the values themselves): red the
    darkness, green the night's low-beam pool (ground_glow), blue unused. Returns the quad (material GROUND)."""
    scene = bpy.context.scene
    (x0, x1), (y0, y1), z = GROUND_X, GROUND_Y, GROUND_Z
    me = bpy.data.meshes.new("bus_ground")
    me.from_pydata([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new(name="UVMap")
    corner = {0: (0.0, 0.0), 1: (1.0, 0.0), 2: (1.0, 1.0), 3: (0.0, 1.0)}
    for l in me.loops:
        uv.data[l.index].uv = corner[l.vertex_index]
    # its only material while baking: the bake (use_clear) clears the active image of EVERY material on the object,
    # which with the bus's slots would wipe bus_base / bus_led in memory; the join maps it to the bus's GROUND slot
    me.materials.append(MATS[GROUND])
    me.polygons[0].material_index = 0
    me.polygons[0].use_smooth = False
    q = bpy.data.objects.new("bus_ground", me)
    COLL.objects.link(q)
    w, h = GROUND_PX
    bake_img = bpy.data.images.new("bus_ground_bake", w, h, alpha=False, float_buffer=True)
    bake_img.colorspace_settings.name = "Non-Color"
    nt = MATS[GROUND].node_tree
    tex = next(n for n in nt.nodes if n.type == "TEX_IMAGE")
    tex.image = bake_img
    nt.nodes.active = tex
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.world.light_settings.distance = GROUND_AO
    bpy.ops.object.select_all(action="DESELECT")
    q.select_set(True)
    bpy.context.view_layer.objects.active = q
    bpy.ops.object.bake(type="AO", target="IMAGE_TEXTURES", use_clear=True, margin=2)
    px = np.array(bake_img.pixels[:], np.float32).reshape(h, w, 4)
    dark = 1.0 - np.clip(px[..., 0], 0, 1)
    # soften the bake's noise (two 3x3 box passes) and drop the faint tail
    for _ in range(2):
        p = np.pad(dark, 1, mode="edge")
        dark = sum(p[1 + dy:h + 1 + dy, 1 + dx:w + 1 + dx] for dy in (-1, 0, 1) for dx in (-1, 0, 1)) / 9.0
    dark = np.clip((dark - 0.04) / 0.96, 0, 1)
    xs = (np.arange(w) + 0.5) / w * GROUND_SIZE[0]
    ys = (np.arange(h) + 0.5) / h * GROUND_SIZE[1]
    gx, gy = np.meshgrid(GROUND_X[0] + xs, GROUND_Y[0] + ys)      # pixel rows run along +Y
    # gone CONTACT_REACH out from the outline (a smooth fall), and before the kerbs
    od = outline_distance(gx, gy)
    t = np.clip(od / CONTACT_REACH, 0, 1)
    reach = (1 - t) * (1 - t) * (1 + 2 * t)                         # 1 - smoothstep
    road = road_mask(gx, gy)
    dark = dark * reach * road
    white = ground_glow(gx, gy)
    ex = np.minimum(xs, GROUND_SIZE[0] - xs)[None, :]
    ey = np.minimum(ys, GROUND_SIZE[1] - ys)[:, None]
    edge = np.clip(np.minimum(ex, ey) / 0.3, 0, 1)
    fade = edge * edge * (3 - 2 * edge)                             # the quad's own edge never shows
    dark = dark * fade
    white = white * fade
    enc = lambda a: np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(np.clip(a, 0, 1), 1 / 2.4) - 0.055)
    out = bpy.data.images.new("bus_ground", w, h, alpha=False)
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., 0] = enc(dark)
    rgba[..., 1] = enc(white)
    rgba[..., 2] = 0.0
    out.pixels.foreach_set(rgba.ravel())
    path = os.path.join(TEXB, "bus_ground.png")
    out.filepath_raw = path
    out.file_format = "PNG"
    out.save()
    out.reload()
    tex.image = out
    bpy.data.images.remove(bake_img)
    ring = (od > 0.0) & (od < 0.05)
    off = road < 1e-3
    log("ground shadow baked:", w, "x", h, "max darkness", round(float(dark.max()), 3),
        "| at the outline (0-5 cm out) mean", round(float(dark[ring].mean()), 3) if ring.any() else -1,
        "| 0.25 m out mean", round(float(dark[(od > 0.23) & (od < 0.27)].mean()), 3),
        "| beyond", CONTACT_REACH, "m max", round(float(dark[od >= CONTACT_REACH].max()), 4),
        "| off the road max", round(float(dark[off].max()), 4) if off.any() else 0.0,
        "| glow max", round(float(white.max()), 3), "glow off the road max", round(float(white[off].max()), 4) if off.any() else 0.0,
        "->", path)
    return q


def export(ob, path, extra=()):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    for e in extra:
        e.select_set(True)
    bpy.context.view_layer.objects.active = ob
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
                              export_texcoords=True, export_normals=True, export_tangents=False,
                              export_materials="EXPORT", export_image_format="WEBP", export_image_quality=90,
                              export_vertex_color="ACTIVE", export_all_vertex_colors=False,
                              export_animations=False, export_cameras=False, export_lights=False, export_extras=False,
                              export_skins=False, export_morph=False,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=10,
                              export_draco_position_quantization=14, export_draco_normal_quantization=10,
                              export_draco_texcoord_quantization=12, export_draco_color_quantization=8,
                              export_draco_generic_quantization=12)
    patch_glb(path)
    log("wrote", path, os.path.getsize(path), "bytes")


def patch_glb(path):
    """Glass: alphaMode BLEND (a little of the cabin shows through); the materials stay double-sided."""
    import struct
    data = open(path, "rb").read()
    magic, ver, total = struct.unpack_from("<III", data, 0)
    clen, ctype = struct.unpack_from("<II", data, 12)
    js = json.loads(data[20:20 + clen].decode("utf-8"))
    rest = data[20 + clen:]
    for m in js.get("materials", []):
        if m.get("name") == "M_bus_glass":
            m["alphaMode"] = "BLEND"
            m["doubleSided"] = True
            pbr = m.setdefault("pbrMetallicRoughness", {})
            pbr["baseColorFactor"] = [0.020, 0.028, 0.032, 0.45]
            pbr["metallicFactor"] = 0.0
            pbr["roughnessFactor"] = 0.04
        if m.get("name") in ("M_bus", "M_bus_led"):
            m["doubleSided"] = m.get("name") == "M_bus"
            m.pop("alphaMode", None)
        if m.get("name") == "M_bus_ground":
            m["alphaMode"] = "BLEND"
            m["doubleSided"] = False
            pbr = m.setdefault("pbrMetallicRoughness", {})
            pbr["metallicFactor"] = 0.0
            pbr["roughnessFactor"] = 1.0
    js.setdefault("asset", {})["extras"] = {"made": "caysonverse art/village/tools/build_bus.py (procedural, no AI)"}
    jb = json.dumps(js, separators=(",", ":")).encode("utf-8")
    jb += b" " * ((4 - len(jb) % 4) % 4)
    out = struct.pack("<III", magic, ver, 12 + 8 + len(jb) + len(rest)) + struct.pack("<II", len(jb), ctype) + jb + rest
    open(path, "wb").write(out)


# =============================================================================================== renders ==

def preview_materials():
    """Blender-side look for the check renders: AO colour times the base colour, the ORM's red as clear coat."""
    m = MATS[0]
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tb = next(n for n in nt.nodes if n.type == "TEX_IMAGE" and n.image.name.startswith("bus_base"))
    to = next(n for n in nt.nodes if n.type == "TEX_IMAGE" and n.image.name.startswith("bus_orm"))
    ca = nt.nodes.new("ShaderNodeVertexColor")
    ca.layer_name = "AO"
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs[0].default_value = 1.0
    nt.links.new(tb.outputs["Color"], mul.inputs[6])
    nt.links.new(ca.outputs["Color"], mul.inputs[7])
    nt.links.new(mul.outputs[2], bsdf.inputs["Base Color"])
    sep = next(n for n in nt.nodes if n.type == "SEPARATE_COLOR")
    nt.links.new(sep.outputs["Red"], bsdf.inputs["Coat Weight"])
    bsdf.inputs["Coat Roughness"].default_value = 0.06
    bsdf.inputs["Emission Strength"].default_value = 0.0
    g = MATS[1]
    b = next(n for n in g.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Alpha"].default_value = 0.55
    b.inputs["Base Color"].default_value = (0.03, 0.04, 0.045, 1)
    gr = MATS[GROUND]
    nt = gr.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tg = next(n for n in nt.nodes if n.type == "TEX_IMAGE")
    b.inputs["Base Color"].default_value = (0, 0, 0, 1)
    for l in list(nt.links):
        if l.to_socket == b.inputs["Base Color"]:
            nt.links.remove(l)
    mul = nt.nodes.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    mul.inputs[1].default_value = 0.85
    sp = nt.nodes.new("ShaderNodeSeparateColor")      # red: the darkness (green / blue: the night's light pools)
    nt.links.new(tg.outputs["Color"], sp.inputs["Color"])
    nt.links.new(sp.outputs["Red"], mul.inputs[0])
    nt.links.new(mul.outputs[0], b.inputs["Alpha"])


def render_views(out_dir, ob):
    os.makedirs(out_dir, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 64
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 1280, 800
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Base Contrast" if "AgX - Base Contrast" in [i.identifier for i in bpy.types.ColorManagedViewSettings.bl_rna.properties["look"].enum_items] else "None"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("W")
    w = scene.world
    w.use_nodes = True
    nt = w.node_tree
    for n in list(nt.nodes):
        if n.type != "OUTPUT_WORLD":
            nt.nodes.remove(n)
    sky = nt.nodes.new("ShaderNodeTexSky")
    try:
        sky.sky_type = "NISHITA"
    except Exception:
        pass
    try:
        sky.sun_elevation = math.radians(32)
        sky.sun_rotation = math.radians(200)
    except Exception:
        pass
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = 0.22
    nt.links.new(sky.outputs[0], bg.inputs[0])
    out = next(n for n in nt.nodes if n.type == "OUTPUT_WORLD")
    nt.links.new(bg.outputs[0], out.inputs[0])
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 2.6
    scene.view_settings.exposure = -0.4
    sun.angle = math.radians(2)
    so = bpy.data.objects.new("sun", sun)
    so.rotation_euler = (math.radians(55), 0, math.radians(200))
    scene.collection.objects.link(so)
    bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 0, 0))
    gr = bpy.context.active_object
    gm = bpy.data.materials.new("asphalt")
    gm.use_nodes = True
    gb = next(n for n in gm.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    gb.inputs["Base Color"].default_value = (0.09, 0.09, 0.095, 1)
    gb.inputs["Roughness"].default_value = 0.9
    gr.data.materials.append(gm)
    cam_d = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_d)
    scene.collection.objects.link(cam)
    scene.camera = cam

    def shot(name, loc, target, lens=35, ortho=None):
        cam.location = Vector(loc)
        d = Vector(target) - Vector(loc)
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        if ortho:
            cam_d.type = "ORTHO"
            cam_d.ortho_scale = ortho
        else:
            cam_d.type = "PERSP"
            cam_d.lens = lens
        scene.render.filepath = os.path.join(out_dir, name + ".png")
        bpy.ops.render.render(write_still=True)
        log("render", scene.render.filepath)

    shot("front34", (7.5, 10.5, 1.9), (0.2, 0.6, 1.35), 32)
    shot("side", (16.0, 0.0, 1.5), (0.0, 0.0, 1.5), 50, ortho=10.2)
    shot("rear34", (-7.0, -10.5, 2.0), (-0.1, -0.8, 1.35), 32)
    shot("front", (0.0, 30.0, 1.62), (0.0, 0.0, 1.62), 50, ortho=3.9)
    shot("rear", (0.0, -30.0, 1.62), (0.0, 0.0, 1.62), 50, ortho=3.9)
    shot("front_close", (2.6, 8.2, 1.25), (0.3, 4.2, 1.15), 35)
    shot("side_l", (-16.0, 0.0, 1.5), (0.0, 0.0, 1.5), 50, ortho=10.2)
    shot("top34", (9.0, 9.0, 8.0), (0.0, 0.0, 1.5), 35)
    if flag("--interior"):
        cam_d.clip_start = 0.05
        shot("in_back", (0.15, Yof(1.0), 2.1), (0.0, Yof(8.0), 1.6), 24)
        shot("in_front", (0.0, Yof(8.1), 2.2), (0.0, Yof(1.0), 1.7), 24)
        shot("in_left", (0.55, Yof(4.1), 1.9), (-1.2, Yof(4.5), 1.6), 26)
        shot("in_right", (-0.5, Yof(3.0), 1.9), (1.2, Yof(3.4), 1.6), 26)
        shot("in_mid", (0.0, Yof(5.0), 2.3), (0.0, Yof(7.5), 1.2), 24)
        shot("in_door", (-0.3, Yof(2.4), 2.1), (0.9, Yof(5.0), 1.5), 24)


def split_by_material(ob):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    for p in ob.data.polygons:
        p.select = p.material_index != BODY
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    return [o for o in bpy.context.scene.objects if o.type == "MESH" and o.name.startswith("village_bus.")]


def lift_cabin_ao(ob):
    """The baked occlusion of the cabin's upward faces (floor, treads, cushions) is raised: the roof over it made the low floor a
    dark brown in the game (visual review r1), where a real bus's floor is lit by its ceiling lights and its windows."""
    me = ob.data
    attr = me.color_attributes.get("AO")
    if attr is None:
        return
    a = np.empty(len(me.loops) * 4, np.float32)
    attr.data.foreach_get("color", a)
    a = a.reshape(-1, 4)
    n = 0
    for p in me.polygons:
        c = p.center
        if p.normal.z > 0.5 and abs(c.x) < 1.19 and abs(c.y) < 4.45 and 0.3 < c.z < 1.2:
            n += 1
            for li in range(p.loop_start, p.loop_start + p.loop_total):
                a[li, :3] = np.maximum(a[li, :3], 0.88)
    attr.data.foreach_set("color", a.ravel())
    log("cabin upward faces lifted:", n)


def ceiling_up(ob):
    """The cabin's ceiling is lit as if it faced up (bus-ride r2, visual review r1: by day the game's hemisphere light gives a
    downward face the GREEN of the grass, and the white ceiling read as a khaki one): its loops' normals are set to +Z, so the
    sky's colour and the sun light it as they light the roof, and it reads white as in the real buses."""
    me = ob.data
    nrm = [Vector(c.vector) for c in me.corner_normals]
    n = 0
    for p in me.polygons:
        c = p.center
        if p.normal.z < -0.7 and 2.9 < c.z < 3.2 and abs(c.x) < 1.25 and abs(c.y) < 4.6:
            n += 1
            for li in range(p.loop_start, p.loop_start + p.loop_total):
                nrm[li] = Vector((0.0, 0.0, 1.0))
    me.normals_split_custom_set(nrm)
    log("ceiling polygons lit from above:", n)


def main():
    parts = build()
    decals = [o for o in parts if o.name.startswith("bus_decals")]
    fixtures = [o for o in parts if o.name.startswith(FIXTURE_PREFIXES)]
    parts = [o for o in parts if not o.name.startswith("bus_decals") and o not in fixtures]
    body = join(parts, "village_bus")
    me = body.data
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    log("joined:", len(me.polygons), "faces,", tris, "triangles,", len(me.vertices), "verts")
    if not flag("--noao"):
        others = split_by_material(body)
        for o in others + decals + fixtures:
            o.hide_render = True
        bake_ao(body)
        for o in others + decals + fixtures:
            o.hide_render = False
        ground = ground_shadow()
        body = join([body] + others + [ground], "village_bus")
        me = body.data
        attr = me.color_attributes["AO"]
        me.color_attributes.active_color = attr
        a = np.empty(len(me.loops) * 4, np.float32)
        attr.data.foreach_get("color", a)
        a = a.reshape(-1, 4)
        mat_of_loop = np.empty(len(me.loops), np.int32)
        for p in me.polygons:
            mat_of_loop[p.loop_start:p.loop_start + p.loop_total] = p.material_index
        a[mat_of_loop != BODY] = 1.0
        attr.data.foreach_set("color", a.ravel())
        weld_ao(body)
        if decals:
            body = join([body] + decals, "village_bus")
            me = body.data
            me.color_attributes.active_color = me.color_attributes["AO"]
            decal_ao(body)
    else:
        if decals:
            body = join([body] + decals, "village_bus")
            me = body.data
        attr = me.color_attributes.new("AO", "FLOAT_COLOR", "CORNER")
        me.color_attributes.active_color = attr
        a = np.ones(len(me.loops) * 4, np.float32)
        attr.data.foreach_set("color", a)
    # the cabin's separate fixtures (poles, rails, strap groups, stop buttons): a flat cabin occlusion, so the game's material
    # (which multiplies by COLOR_0) treats them as the cabin's other things
    for o in fixtures:
        attr = o.data.color_attributes.new("AO", "FLOAT_COLOR", "CORNER")
        o.data.color_attributes.active_color = attr
        v = 0.28 + 0.72 * 0.5
        attr.data.foreach_set("color", np.tile(np.array([v, v, v, 1.0], np.float32), len(o.data.loops)))
    lift_cabin_ao(body)
    ceiling_up(body)
    cabin_json = os.path.join(os.path.dirname(OUT), "village_bus_cabin.json")
    with open(cabin_json, "w", encoding="utf-8") as fh:
        json.dump(CABIN, fh, ensure_ascii=False, indent=1)
    log("wrote", cabin_json)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    export(body, OUT, fixtures)
    if RENDERS:
        preview_materials()
        render_views(RENDERS, body)


main()
