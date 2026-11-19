"""Fishing lake facilities (chunk B of docs/designs/lake-fishing/design.md): pier, T-end, floating walkways, two 좌대 with
log bungalows, the office / rental shop, rod rack, vending machine, bins, signs, pavilion, benches, picnic tables, 30 fishing
chairs with rod stands, lamps -- with `col__lake_*` colliders, `seat__lake_*` seat markers and `spot__*` markers that match
shared/src/village/lakeLayout.ts (art/lake/layout.json) exactly.

  blender -b --factory-startup -P art/lake/tools/parts_lake_structures.py -- [--blend art/lake/work/structures.blend]
          [--glb client/public/models/lake/lake_structures.glb] [--no-preview]

Numbers are read from layout.json (never retyped); look is by hand from the reference photos in art/village/refs/lake
(02_jwadae_*, 03_pier_*, 04_office_*, 10_rod_rack_*). No brands, no logos, no phone numbers: lettering is the village's own
name from LAKE_PARAMS. The parts live in structures_*.py next to this file; this is the assembler.
"""
import json
import math
import os
import random
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import lakelib as L  # noqa: E402
from lakelib import F, WORLD, MB, V, box, boxw, tube, tubew, hexc, jit, mulc  # noqa: E402

ROOT = os.environ.get("LAKE_ROOT") or os.path.dirname(HERE)
LAYOUT = json.load(open(os.environ.get("LAKE_LAYOUT") or os.path.join(ROOT, "layout.json"), encoding="utf-8"))
ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    return ARGV[ARGV.index(name) + 1] if name in ARGV else default


# ---------------------------------------------------------------------------------------------------- palette
P = dict(
    deck=hexc("#8b6b47"), deck_dark=hexc("#6f5237"), joist=hexc("#5a4330"), beam=hexc("#4e3a2a"),
    galv=hexc("#a9aeb2"), galv_dark=hexc("#7d8286"), black=hexc("#1c1d20"), rubber=hexc("#222325"),
    drum=hexc("#1f58b4"), drum_dark=hexc("#174790"), white=hexc("#ece9e1"), cream=hexc("#e4dccb"),
    chair_fab=hexc("#2e4d38"), chair_fab2=hexc("#36573f"), chair_frame=hexc("#2a2c2f"),
    log=hexc("#b45a27"), log_dark=hexc("#97481d"), roof_or=hexc("#cf6c2d"), roof_or_dark=hexc("#a9541f"),
    clad=hexc("#a27244"), clad_dark=hexc("#876035"), trim=hexc("#b4b9bd"), roof_blue=hexc("#2e69ae"), door_blue=hexc("#2563c9"),
    concrete=hexc("#8d8b85"), plate=hexc("#6e7378"), sign_white=hexc("#f1efe8"), sign_ink=hexc("#1f3a8a"),
    tile=hexc("#44484c"), tile_light=hexc("#55595d"), pav_wood=hexc("#6b3f27"), pav_beam=hexc("#7a4a2c"), stone=hexc("#9a978f"),
    lamp_pole=hexc("#6a4a30"), lamp_shade=hexc("#e9e5db"), red=hexc("#c23b2e"), green_pallet=hexc("#2f9d70"),
    bin_blue=hexc("#1d4fa8"), vend_body=hexc("#26303c"), wood_light=hexc("#c9a574"), floor_in=hexc("#8f7757"), wall_in=hexc("#e2dccb"),
)

ATLAS = json.load(open(os.path.join(ROOT, "work", "tex", "atlas.json"), encoding="utf-8"))


def sign_face(mb, fr, x0, x1, y0, y1, lz, name):
    """A lettered board front: one quad textured from the sign atlas (work/tex/signs.png) -- no glyph geometry."""
    px, py, w, h = ATLAS[name]
    u0, u1, v1, v0 = px / 2048, (px + w) / 2048, 1 - py / 1024, 1 - (py + h) / 1024
    mb.quad_uv(fr.p(x0, y0, lz), fr.p(x1, y0, lz), fr.p(x1, y1, lz), fr.p(x0, y1, lz), [(u0, v0), (u1, v0), (u1, v1), (u0, v1)], (1, 1, 1, 1), "sign")


COLL = None   # collection of meshes
MARK = None   # collection of empties and colliders


def lay(key):
    return LAYOUT[key]


def deckbox(i):
    return next(d for d in LAYOUT["decks"] if d["id"] == i)


# ---------------------------------------------------------------------------------------------------- decks


class Deck(MB):
    """Cut the rim boards, piers and joists from the same stock as the walking surface."""
    def finish(self, collection=None, name=None):
        timber = set()
        for i, (indices, mat, smooth, uv) in enumerate(self.faces):
            if mat != "wood":
                continue
            timber.update(indices)
            pts = [self.v[k] for k in indices]
            x, z, y = ([p[0] for p in pts], [-p[1] for p in pts], [p[2] for p in pts])
            dx, dz = max(x) - min(x), max(z) - min(z)
            along, across = (x, z) if dx >= dz else (z, x)
            cross = across if max(y) - min(y) < 0.002 else y
            uv = [((a - min(along)) / 1.4 + 0.17, 1 - (s - min(cross)) / 1.4 - 0.31) for a, s in zip(along, cross)]
            self.faces[i] = (indices, "deck", smooth, uv)
        for i in timber:
            r, g, b, a = self.col[i]
            self.col[i] = (min(1, 2.49 * r), min(1, 4.05 * g), min(1, 7.1 * b), a)
        return super().finish(collection, name)


def planks(mb, rng, x0, x1, z0, z1, run, top=0.0, th=0.04, w=0.14, gap=0.012):
    """Sawn decking with eased arrises and staggered butt joints. The oak grain runs along each board."""
    lo, hi = (z0, z1) if run == "x" else (x0, x1)
    start, end = (x0, x1) if run == "x" else (z0, z1)
    n = int((hi - lo + gap) // (w + gap))
    pitch = (hi - lo) / n
    for i in range(n):
        a = lo + i * pitch
        b = a + pitch - gap
        color = jit(rng, (0.76, 0.80, 0.83, 1), 0.09)
        profile = [(a, -th), (a, -0.006), (a + 0.005, 0), (b - 0.005, 0), (b, -0.006), (b, -th)]
        def point(along, across, height):
            return V(along, across, top + height) if run == "x" else V(across, along, top + height)
        cuts = [start]
        if end - start > 3.8:
            seam = start + (1.6 if i % 2 else 3.2)
            while seam < end - 0.55:
                cuts.append(seam)
                seam += 3.2
        cuts.append(end)
        for j, (left, right) in enumerate(zip(cuts, cuts[1:])):
            u0 = (i * 0.618034 + j * 0.37) % 1
            v0 = (i * 0.414214 + j * 0.27) % 1
            left += 0.004 if j else 0
            right -= 0.004 if j + 1 < len(cuts) - 1 else 0
            for k, (p, q) in enumerate(zip(profile, profile[1:])):
                corners = [(left, *p), (left, *q), (right, *q), (right, *p)]
                if run == "z":
                    corners.reverse()
                pts = [point(*v) for v in corners]
                uv = [(u0 + (l - left) / 1.4, 1 - v0 - (s - a + h) / 1.4) for l, s, h in corners]
                shade = (0.58, 0.91, 1, 0.91, 0.58)[k]
                mb.quad_uv(*pts, uv, mulc(color, shade), "deck")
            for l in (left, right):
                section = profile if ((l == right) == (run == "x")) else profile[::-1]
                pts = [point(l, s, h) for s, h in section]
                uv = [(u0 + (s - a) / 1.4, 1 - v0 - h / 1.4) for s, h in section]
                mb.face(mb.verts(pts, mulc(color, 0.65)), "deck", False, uv)
    boxw(mb, x0, x1, top - th - 0.004, top - th, z0, z1, hexc("#2a2018"), "matte", skip="D")  # the dark seen through the gaps


def drum(mb, rng, cx, cz, axis, length=0.9, r=0.29, cy=-0.57, col=None):
    """A 200 l plastic drum lying on its side, ribbed, with a bung; half under water."""
    col = jit(rng, col or P["drum"], 0.07)
    if axis == "z":
        p0, p1 = (cx, cy, cz - length / 2), (cx, cy, cz + length / 2)
    else:
        p0, p1 = (cx - length / 2, cy, cz), (cx + length / 2, cy, cz)
    tubew(mb, p0, p1, r, col, "paint", sides=10, caps=(True, True))
    for t in (0.5,):
        q0 = tuple(p0[i] + (p1[i] - p0[i]) * (t - 0.02) for i in range(3))
        q1 = tuple(p0[i] + (p1[i] - p0[i]) * (t + 0.02) for i in range(3))
        tubew(mb, q0, q1, r + 0.012, mulc(col, 0.85), "paint", sides=10, caps=(False, False))
    tubew(mb, (cx, cy + r - 0.01, cz), (cx, cy + r + 0.02, cz), 0.05, P["white"], "paint", sides=5)


def railing(mb, a, b, openings=(), y_top=1.17, y_mid=0.6, every=1.9, col=None, post_r=0.024, rail_r=0.021, flange=True):
    """Pipe railing along the ground line a -> b ((x, z) game points). openings = [(t0, t1)] metres from a. Posts sit on
    bolted flanges, the rails are continuous between the posts that hold them."""
    col = col or P["galv"]
    ax, az = a
    bx, bz = b
    ln = math.hypot(bx - ax, bz - az)
    ux, uz = (bx - ax) / ln, (bz - az) / ln
    pos = lambda s: (ax + ux * s, az + uz * s)
    for s0, s1 in L.intervals_minus(0, ln, [tuple(o) for o in openings]):
        n = max(1, math.ceil((s1 - s0) / every))
        for i in range(n + 1):
            x, z = pos(s0 + (s1 - s0) * i / n)
            tubew(mb, (x, 0.0, z), (x, y_top + 0.012, z), post_r, col, "metal", sides=8, caps=(False, False))
            if flange:
                boxw(mb, x - 0.055, x + 0.055, 0.0, 0.012, z - 0.055, z + 0.055, P["galv_dark"], "metal", skip="D")
        px0, pz0 = pos(s0)
        px1, pz1 = pos(s1)
        for y in (y_top, y_mid):
            tubew(mb, (px0, y, pz0), (px1, y, pz1), rail_r, col, "metal", sides=8, caps=(False, False))
        # a ball end on the end posts' top
        for (x, z) in ((px0, pz0), (px1, pz1)):
            L.sphere(mb, WORLD, x, y_top + 0.012, z, post_r * 1.15, col, "metal", seg=6, rings=3)


# ---------------------------------------------------------------------------------------------------- chair / stand


def build_chair(mb):
    """A folding fishing chair at the origin facing +z: tube frame, dark green fabric seat and back, arm rests. Seat top 0.46,
    footprint 0.46 wide, front edge +0.21, back -0.26 (the lakeLayout CHAIR numbers)."""
    r = 0.012
    fr = F()
    fab, fab2, fr_c = P["chair_fab"], P["chair_fab2"], P["chair_frame"]
    for sx in (-1, 1):
        x = 0.215 * sx
        # legs: front pair leans forward, rear pair back
        tube(mb, fr, (x, 0.44, 0.15), (x * 1.04, 0.0, 0.215), r, fr_c, "metal", 4, caps=(False, False))
        tube(mb, fr, (x, 0.44, -0.13), (x * 1.04, 0.0, -0.2), r, fr_c, "metal", 4, caps=(False, False))
        # seat rail
        tube(mb, fr, (x, 0.44, -0.2), (x, 0.44, 0.205), r * 0.9, fr_c, "metal", 4, caps=(False, False))
        # back upright (leans back)
        tube(mb, fr, (x, 0.44, -0.2), (x * 0.96, 0.9, -0.265), r, fr_c, "metal", 4, caps=(False, False))
        # arm rest on a short post
        tube(mb, fr, (x * 1.02, 0.64, -0.235), (x * 1.04, 0.66, 0.13), r * 0.9, fr_c, "metal", 4, caps=(False, False))
        tube(mb, fr, (x * 1.03, 0.44, 0.11), (x * 1.03, 0.66, 0.12), r * 0.8, fr_c, "metal", 4, caps=(False, False))
        box(mb, fr, x * 1.04 - 0.027, x * 1.04 + 0.027, 0.66, 0.685, -0.2, 0.125, P["black"], "paint")
        # front foot caps
        box(mb, fr, x * 1.04 - 0.02, x * 1.04 + 0.02, 0.0, 0.012, 0.19, 0.24, P["black"], "matte")
        box(mb, fr, x * 1.04 - 0.02, x * 1.04 + 0.02, 0.0, 0.012, -0.225, -0.175, P["black"], "matte")
    # cross tubes
    tube(mb, fr, (-0.215, 0.44, 0.205), (0.215, 0.44, 0.205), r * 0.9, fr_c, "metal", 4, caps=(False, False))
    tube(mb, fr, (-0.2, 0.2, 0.17), (0.2, 0.2, 0.17), r * 0.8, fr_c, "metal", 4, caps=(False, False))
    tube(mb, fr, (-0.2, 0.2, -0.16), (0.2, 0.2, -0.16), r * 0.8, fr_c, "metal", 4, caps=(False, False))
    # fabric: a slung seat and a back panel (hexahedra so the back can lean)
    rng = random.Random(3)
    pts = [fr.p(x, y, z) for (x, y, z) in (
        (-0.2, 0.43, -0.19), (0.2, 0.43, -0.19), (-0.2, 0.46, -0.19), (0.2, 0.46, -0.19),
        (-0.2, 0.43, 0.2), (0.2, 0.43, 0.2), (-0.2, 0.46, 0.2), (0.2, 0.46, 0.2))]
    L.hexa(mb, pts, fab, "fabric")
    # back panel from y 0.56 to 0.88, following the uprights' lean (z = -0.2 - 0.065 * (y - 0.44) / 0.46)
    def zb(y):
        return -0.2 - 0.065 * (y - 0.44) / 0.46
    pts = []
    for iz in (0, 1):
        for iy, y in ((0, 0.56), (1, 0.87)):
            for ix, x in ((0, -0.2), (1, 0.2)):
                pts.append((x, y, zb(y) + (0.026 if iz else 0.0)))
    pts = [fr.p(*p) for p in [(p[0], p[1], p[2]) for p in pts]]
    # reorder to bit order (x, y, z)
    order = [0, 1, 2, 3, 4, 5, 6, 7]
    ordered = [None] * 8
    k = 0
    for iz in (0, 1):
        for iy in (0, 1):
            for ix in (0, 1):
                ordered[ix + 2 * iy + 4 * iz] = pts[k]
                k += 1
    L.hexa(mb, ordered, fab2, "fabric")
    # a sewn seam / hem on the back and seat front
    tube(mb, fr, (-0.2, 0.575, zb(0.575) + 0.028), (0.2, 0.575, zb(0.575) + 0.028), 0.004, fab, "matte", 4)


def build_stand(mb):
    """A rod rest (받침틀): black tube frame, a front fork and a rear fork. At the origin facing +z (the water)."""
    r = 0.011
    fr = F()
    k = P["black"]
    # base bar and two feet
    tube(mb, fr, (0, 0.022, -0.11), (0, 0.022, 0.11), r, k, "metal", 4, caps=(False, False))
    for z in (-0.11, 0.11):
        tube(mb, fr, (-0.15, 0.022, z), (0.15, 0.022, z), r, k, "metal", 4, caps=(False, False))
        for sx in (-1, 1):
            box(mb, fr, sx * 0.15 - 0.014, sx * 0.15 + 0.014, 0.0, 0.022, z - 0.014, z + 0.014, P["rubber"], "matte")
    # forks: a pole and a Y of two prongs, a rubber collar
    for z, h in ((0.11, 0.54), (-0.11, 0.44)):
        tube(mb, fr, (0, 0.022, z), (0, h, z), r, k, "metal", 4, caps=(False, False))
        for sx in (-1, 1):
            tube(mb, fr, (0, h, z), (sx * 0.045, h + 0.07, z), r * 0.9, k, "metal", 6, caps=(True, True))
        tube(mb, fr, (-0.044, h + 0.06, z), (0.044, h + 0.06, z), 0.0045, P["rubber"], "matte", 4)
    # a brace between the poles
    tube(mb, fr, (0, 0.2, -0.11), (0, 0.36, 0.11), r * 0.8, k, "metal", 4, caps=(False, False))


def instance(name, data, collection, x, z, yaw, y=0.0):
    ob = bpy.data.objects.new(name, data)
    ob.location = V(x, z, y)
    ob.rotation_euler = (0, 0, yaw)
    collection.objects.link(ob)
    return ob


# ---------------------------------------------------------------------------------------------------- pier & decks


def build_pier(rng):
    d = deckbox("pier")
    mb = Deck("lake_pier")
    x0, x1, z0, z1 = d["minX"], d["maxX"], d["minZ"], d["maxZ"]
    planks(mb, rng, x0, x1, z0, z1, "z")
    # joists run along x, bearers across at every post line, posts into the water
    for z in (z0 + 0.08, z0 + 0.8, (z0 + z1) / 2, z1 - 0.8, z1 - 0.08):
        boxw(mb, x0, x1, -0.19, -0.04, z - 0.035, z + 0.035, P["joist"], "wood")
    xs = [x0 + 1.0 + 2.5 * i for i in range(int((x1 - x0 - 0.5) // 2.5) + 1)]
    for x in xs:
        boxw(mb, x - 0.07, x + 0.07, -0.34, -0.19, z0 + 0.04, z1 - 0.04, P["beam"], "wood")
        for z in (z0 + 0.3, z1 - 0.3):
            tubew(mb, (x, -1.6, z), (x, -0.34, z), 0.057, P["galv"], "metal", sides=8, caps=(False, False))
            tubew(mb, (x, -0.34, z), (x, -0.325, z), 0.075, P["galv_dark"], "metal", sides=10)
        # a pipe tie between each pair just above the water line
        tubew(mb, (x, -0.42, z0 + 0.3), (x, -0.42, z1 - 0.3), 0.024, P["galv_dark"], "metal", sides=6)
    # rim fascia boards on both long sides and the end
    for z in (z0, z1 - 0.04):
        boxw(mb, x0, x1, -0.2, 0.0, z, z + 0.04, P["deck_dark"], "wood", skip="")
    boxw(mb, x0, x0 + 0.04, -0.2, 0.0, z0, z1, P["deck_dark"], "wood")
    # 10 cm kerbs on both fishing sides (no railing there), cut where the rail stands at the mouth
    for z in (z0 + 0.0, z1 - 0.07):
        boxw(mb, 111.0, x1, 0.0, 0.1, z, z + 0.07, P["deck_dark"], "wood")
    # entrance railing, both sides, from the mouth to the first chair
    for z in (z0 + 0.1, z1 - 0.1):
        railing(mb, (x0 + 0.1, z), (111.0, z), ())
    # lifebuoy on the north rail near the mouth
    lifebuoy(mb, 108.4, z0 + 0.12)
    return mb


def lifebuoy(mb, x, z):
    """A red and white ring hung on the rail (a 구명환), facing the walkway side."""
    fr = F(x, 0.0, z)
    L.torus(mb, fr, 0, 0.78, 0.04, 0.27, 0.07, [P["red"], P["white"], P["red"], P["white"]], "paint", axis="z", seg=24, sides=8)
    # a hook on the top rail and a cord
    tube(mb, fr, (0, 1.17, 0.0), (0, 1.07, 0.04), 0.006, P["black"], "metal", 4)
    tube(mb, fr, (0, 1.07, 0.04), (0, 1.0, 0.04), 0.004, P["white"], "matte", 4)


def build_pier_t(rng):
    d = deckbox("pier_t")
    mb = Deck("lake_pier_t")
    x0, x1, z0, z1 = d["minX"], d["maxX"], d["minZ"], d["maxZ"]
    planks(mb, rng, x0, x1, z0, z1, "x")
    for x in (x0 + 0.08, x0 + 1.5, (x0 + x1) / 2, x1 - 1.5, x1 - 0.08):
        boxw(mb, x - 0.035, x + 0.035, -0.19, -0.04, z0, z1, P["joist"], "wood")
    for z in [z0 + 1.0 + 2.5 * i for i in range(5)]:
        boxw(mb, x0 + 0.04, x1 - 0.04, -0.34, -0.19, z - 0.07, z + 0.07, P["beam"], "wood")
        for x in (x0 + 0.3, x1 - 0.3):
            tubew(mb, (x, -1.6, z), (x, -0.34, z), 0.057, P["galv"], "metal", sides=8, caps=(False, False))
            tubew(mb, (x, -0.34, z), (x, -0.325, z), 0.075, P["galv_dark"], "metal", sides=10)
        tubew(mb, (x0 + 0.3, -0.42, z), (x1 - 0.3, -0.42, z), 0.024, P["galv_dark"], "metal", sides=6)
    for x in (x0, x1 - 0.04):
        boxw(mb, x, x + 0.04, -0.2, 0.0, z0, z1, P["deck_dark"], "wood")
    for z in (z0, z1 - 0.04):
        boxw(mb, x0, x1, -0.2, 0.0, z, z + 0.04, P["deck_dark"], "wood")
    # 10 cm kerbs along the east (fishing) edge; pipe railings elsewhere, opened for the pier mouth, the walkways, the chairs
    boxw(mb, x1 - 0.07, x1, 0.0, 0.1, z0, z1, P["deck_dark"], "wood")
    sp = {s["id"]: s for s in LAYOUT["spots"]}
    ch = [sp["P15"]["anchor"]["z"], sp["P16"]["anchor"]["z"]]
    inset = 0.1
    # east edge: opened in front of the two chairs
    railing(mb, (x1 - inset, z0 + inset), (x1 - inset, z1 - inset), [(c - z0 - inset - 0.8, c - z0 - inset + 0.8) for c in ch])
    # west edge: opened at the pier mouth
    pm = deckbox("pier")
    railing(mb, (x0 + inset, z0 + inset), (x0 + inset, z1 - inset), [(pm["minZ"] - z0 - inset, pm["maxZ"] - z0 - inset)])
    # north / south ends: opened at the walkways
    wa, wb = deckbox("walkway_a"), deckbox("walkway_b")
    railing(mb, (x0 + inset, z0 + inset), (x1 - inset, z0 + inset), [(wa["minX"] - x0 - inset, wa["maxX"] - x0 - inset)])
    railing(mb, (x0 + inset, z1 - inset), (x1 - inset, z1 - inset), [(wb["minX"] - x0 - inset, wb["maxX"] - x0 - inset)])
    return mb


def walkway(rng, key):
    d = deckbox(key)
    mb = Deck("lake_" + key)
    x0, x1, z0, z1 = d["minX"], d["maxX"], d["minZ"], d["maxZ"]
    planks(mb, rng, x0, x1, z0, z1, "x", w=0.12)
    n = 8
    pitch = (z1 - z0) / n
    for x in (x0 + 0.08, x1 - 0.08):
        boxw(mb, x - 0.04, x + 0.04, -0.2, -0.04, z0, z1, P["joist"], "wood")
    for i in range(n + 1):
        z = z0 + i * pitch
        boxw(mb, x0 + 0.04, x1 - 0.04, -0.29, -0.2, max(z0, z - 0.05), min(z1, z + 0.05), P["beam"], "wood")
    for i in range(n):
        zc = z0 + (i + 0.5) * pitch
        for xc in ((x0 + x1) / 2 - 0.46, (x0 + x1) / 2 + 0.46):
            drum(mb, rng, xc, zc, "z", length=min(0.9, pitch - 0.05), r=0.27, cy=-0.55)
    for x in (x0, x1 - 0.04):
        boxw(mb, x, x + 0.04, -0.2, 0.0, z0, z1, P["deck_dark"], "wood")
    # hinge plates over both joints
    for z in (z0, z1):
        boxw(mb, x0 + 0.03, x1 - 0.03, 0.0, 0.012, z - 0.22, z + 0.22, P["plate"], "metal", skip="D")
        for dx in (-0.65, -0.2, 0.2, 0.65):
            for dz in (-0.14, 0.14):
                tubew(mb, ((x0 + x1) / 2 + dx, 0.012, z + dz), ((x0 + x1) / 2 + dx, 0.02, z + dz), 0.013, P["galv_dark"], "metal", 6)
    # side railings, continuous, a post at each end
    inset = 0.08
    railing(mb, (x0 + inset, z0 + 0.1), (x0 + inset, z1 - 0.1), [], every=2.0)
    railing(mb, (x1 - inset, z0 + 0.1), (x1 - inset, z1 - 0.1), [], every=2.0)
    return mb


def jwadae(rng, key, hut_key, face_in):
    """A floating platform: board deck on a timber frame over blue drums, pipe railings opened in front of the chairs and at the
    walkway. face_in = 'n' if the walkway joins its north edge (좌대 B), 's' if its south edge (좌대 A)."""
    d = deckbox(key)
    mb = Deck("lake_" + key)
    x0, x1, z0, z1 = d["minX"], d["maxX"], d["minZ"], d["maxZ"]
    planks(mb, rng, x0, x1, z0, z1, "x", w=0.15)
    # frame under the boards: joists along z, edge beams, drums along the edges
    for x in [x0 + 0.1 + i * (x1 - x0 - 0.2) / 8 for i in range(9)]:
        boxw(mb, x - 0.04, x + 0.04, -0.19, -0.04, z0, z1, P["joist"], "wood")
    for z in (z0 + 0.05, z1 - 0.05):
        boxw(mb, x0, x1, -0.29, -0.19, z - 0.06, z + 0.06, P["beam"], "wood")
    for x in (x0 + 0.05, x1 - 0.05):
        boxw(mb, x - 0.06, x + 0.06, -0.29, -0.19, z0, z1, P["beam"], "wood")
    # skirt
    for z in (z0, z1 - 0.04):
        boxw(mb, x0, x1, -0.2, 0.0, z, z + 0.04, P["deck_dark"], "wood")
    for x in (x0, x1 - 0.04):
        boxw(mb, x, x + 0.04, -0.2, 0.0, z0, z1, P["deck_dark"], "wood")
    nx = 8
    px = (x1 - x0) / nx
    for i in range(nx):
        xc = x0 + (i + 0.5) * px
        for zc in (z0 + 0.36, z1 - 0.36):
            drum(mb, rng, xc, zc, "x", length=px - 0.06)
    nz = 6
    pz = (z1 - z0 - 1.4) / nz
    for i in range(nz):
        zc = z0 + 0.7 + (i + 0.5) * pz
        for xc in (x0 + 0.36, x1 - 0.36):
            drum(mb, rng, xc, zc, "z", length=pz - 0.06)
    # tyre fenders hung on the corners
    for (x, z) in ((x0, z0), (x1, z0), (x0, z1), (x1, z1)):
        sx = -1 if x == x0 else 1
        sz = -1 if z == z0 else 1
        L.torus(mb, WORLD, x + sx * 0.01, -0.1, z + sz * 0.01, 0.17, 0.07, P["rubber"], "matte", axis="y", seg=14, sides=6)
    # railings, opened in front of the chairs and at the walkway
    sp = [s for s in LAYOUT["spots"] if s["group"] == key]
    inset = 0.1
    ow = 0.8
    wk = deckbox("walkway_a" if key == "jwadae_a" else "walkway_b")
    edges = {
        "n": ((x0 + inset, z0 + inset), (x1 - inset, z0 + inset), "x"),
        "s": ((x0 + inset, z1 - inset), (x1 - inset, z1 - inset), "x"),
        "w": ((x0 + inset, z0 + inset), (x0 + inset, z1 - inset), "z"),
        "e": ((x1 - inset, z0 + inset), (x1 - inset, z1 - inset), "z"),
    }
    for side, (a, b, ax) in edges.items():
        ops = []
        for s in sp:
            if s["face"] == side:
                c = s["anchor"]["x"] if ax == "x" else s["anchor"]["z"]
                lo = a[0] if ax == "x" else a[1]
                ops.append((c - lo - ow, c - lo + ow))
        if side == face_in:
            lo = a[0]
            ops.append((wk["minX"] - lo - 0.02, wk["maxX"] - lo + 0.02))
        railing(mb, a, b, ops)
    # 10 cm kerb in front of the chairs
    for s in sp:
        ax, az = s["anchor"]["x"], s["anchor"]["z"]
        if s["face"] in "ns":
            zz = z0 if s["face"] == "n" else z1 - 0.07
            boxw(mb, ax - ow, ax + ow, 0.0, 0.1, zz, zz + 0.07, P["deck_dark"], "wood")
        else:
            xx = x0 if s["face"] == "w" else x1 - 0.07
            boxw(mb, xx, xx + 0.07, 0.0, 0.1, az - ow, az + ow, P["deck_dark"], "wood")
    return mb


# ---------------------------------------------------------------------------------------------------- bungalow (log hut)


def corrugated(mb, P0, across, down, period, amp, col, mat):
    """A corrugated sheet: from P0, `across` is the width over the ribs, `down` the length along the slope (ribs run down)."""
    n = max(1, int(round(across.length / period)))
    nu = n * 4
    nrm = across.cross(down).normalized()
    if nrm.z < 0:
        nrm = -nrm

    def fn(u, v):
        return P0 + across * u + down * v + nrm * (amp * math.sin(2 * math.pi * u * n))

    L.surface(mb, fn, nu, 1, col, mat, up=True, smooth=True)


def hut(rng, key):
    h = next(x for x in LAYOUT["huts"] if x["id"] == "hut_" + key[-1])
    mb = MB("lake_hut_" + key[-1])
    x0, x1, z0, z1 = h["minX"], h["maxX"], h["minZ"], h["maxZ"]
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    A = key.endswith("a")
    d = 0.17  # log diameter
    H = 3.0
    ncourse = int(H / (d * 1.03))
    pitch = H / ncourse
    door_wall_z = z0 if A else z1  # the wall with the door (away from the walkway)
    bench_wall_z = z1 if A else z0
    doorx = (cx + 0.45, cx + 1.4)
    winx = (cx - 1.3, cx - 0.2)
    holes_door_wall = [(doorx[0], doorx[1], 0.0, 2.62), (winx[0], winx[1], 1.25, 2.2)]
    holes_end = [(cz - 0.45, cz + 0.45, 1.35, 2.2)]
    rng2 = random.Random(7 if A else 8)

    wall_a = door_wall_z + (d / 2 if A else -d / 2)
    wall_b = bench_wall_z + (-d / 2 if A else d / 2)
    pitch_ang = math.radians(22)
    over = 0.62
    ey = H + 0.05
    ridge_y = ey + math.tan(pitch_ang) * ((z1 - z0) / 2 + over)
    # At the wall (inside the overhang) the soffit sits higher than the outer eave.
    plate_y = ey + math.tan(pitch_ang) * over - 0.04
    # the log walls are flat panels carrying the log-wall texture; only the corner log ends stick out as geometry
    logc = P["log"]
    def wall(frame, a0, a1, holes):
        for (r0, r1, b0, b1) in L.rects_minus((a0, a1, 0.0, plate_y), holes):
            box(mb, frame, r0, r1, b0, b1, -d, 0.0, jit(rng2, logc, 0.05), "log", skip="")
    fdoor = F(0, 0, door_wall_z, 0 if not A else math.pi)
    fbench = F(0, 0, bench_wall_z, math.pi if not A else 0)
    def lxw(xw, fr_):
        return xw if fr_.yaw == 0 else -xw
    hd = [(min(lxw(h_[0], fdoor), lxw(h_[1], fdoor)), max(lxw(h_[0], fdoor), lxw(h_[1], fdoor)), h_[2], h_[3]) for h_ in holes_door_wall]
    wall(fdoor, lxw(x0, fdoor) if fdoor.yaw == 0 else lxw(x1, fdoor), lxw(x1, fdoor) if fdoor.yaw == 0 else lxw(x0, fdoor), hd)
    wall(fbench, lxw(x0, fbench) if fbench.yaw == 0 else lxw(x1, fbench), lxw(x1, fbench) if fbench.yaw == 0 else lxw(x0, fbench), [])
    fw_ = F(x0, 0, cz, -math.pi / 2)
    fe_ = F(x1, 0, cz, math.pi / 2)
    he = [(h_[0] - cz, h_[1] - cz, h_[2], h_[3]) for h_ in holes_end]
    wall(fw_, -(z1 - z0) / 2 + d, (z1 - z0) / 2 - d, he)
    wall(fe_, -(z1 - z0) / 2 + d, (z1 - z0) / 2 - d, he)
    # corner log ends: alternating courses stick out 0.12 m at each corner
    ncourse = int(H / (d * 1.03))
    pitch = H / ncourse
    for i in range(ncourse):
        y = d / 2 + i * pitch
        for sx, xx in ((-1, x0), (1, x1)):
            for sz, zz in ((-1, z0), (1, z1)):
                if i % 2 == 0:
                    tubew(mb, (xx - sx * d / 2, y, zz - sz * d / 2), (xx + sx * 0.12, y, zz - sz * d / 2), d / 2, jit(rng2, logc, 0.1), "wood", 6, caps=(False, True))
                else:
                    tubew(mb, (xx - sx * d / 2, y, zz - sz * d / 2), (xx - sx * d / 2, y, zz + sz * 0.12), d / 2, jit(rng2, P["log_dark"], 0.1), "wood", 6, caps=(False, True))
    # gable ends: textured triangles above the walls
    for xx, sg in ((x0, -1), (x1, 1)):
        a, b, c = V(xx, z0, plate_y), V(xx, z1, plate_y), V(xx, cz, ridge_y - 0.04)
        if sg > 0:
            mb.tri(b, a, c, logc, "log")
        else:
            mb.tri(a, b, c, logc, "log")
    # door + window on the door wall: a frame facing outward (local +z = outward, local x = east on B, west on A)
    fr = F(0, 0, door_wall_z, 0 if not A else math.pi)

    def lx(xw):
        return xw if not A else -xw

    dxa, dxb = sorted((lx(doorx[0]), lx(doorx[1])))
    wxa, wxb = sorted((lx(winx[0]), lx(winx[1])))
    wf = P["white"]
    box(mb, fr, dxa + 0.02, dxb - 0.02, 0.0, 2.58, -0.11, -0.07, wf, "paint")
    box(mb, fr, dxa + 0.14, dxb - 0.14, 1.35, 2.35, -0.068, -0.058, hexc("#cfd6d6"), "paint")
    box(mb, fr, (dxa + dxb) / 2 - 0.14, (dxa + dxb) / 2 + 0.14, 0.35, 1.05, -0.068, -0.058, hexc("#dcd8cd"), "paint")
    hx = dxa + 0.1 if not A else dxb - 0.1
    box(mb, fr, hx - 0.02, hx + 0.02, 1.0, 1.3, -0.07, -0.03, P["black"], "metal")
    for (a, b, c, e) in ((dxa - 0.03, dxa + 0.03, 0, 2.66), (dxb - 0.03, dxb + 0.03, 0, 2.66), (dxa - 0.03, dxb + 0.03, 2.6, 2.66)):
        box(mb, fr, a, b, c, e, -0.13, 0.012, wf, "paint")
    for (a, b, c, e) in ((wxa - 0.04, wxa + 0.03, 1.21, 2.24), (wxb - 0.03, wxb + 0.04, 1.21, 2.24), (wxa - 0.04, wxb + 0.04, 1.21, 1.28), (wxa - 0.04, wxb + 0.04, 2.17, 2.24)):
        box(mb, fr, a, b, c, e, -0.13, 0.012, wf, "paint")
    box(mb, fr, wxa + 0.03, wxb - 0.03, 1.28, 2.17, -0.09, -0.08, P["white"], "glass")
    box(mb, fr, (wxa + wxb) / 2 - 0.02, (wxa + wxb) / 2 + 0.02, 1.28, 2.17, -0.1, -0.07, wf, "paint")
    for xx, yaw in ((x0, -math.pi / 2), (x1, math.pi / 2)):
        fe = F(xx, 0, cz, yaw)
        for (a, b, c, e) in ((-0.49, -0.42, 1.31, 2.24), (0.42, 0.49, 1.31, 2.24), (-0.49, 0.49, 1.31, 1.38), (-0.49, 0.49, 2.17, 2.24)):
            box(mb, fe, a, b, c, e, -0.13, 0.012, wf, "paint")
        box(mb, fe, -0.42, 0.42, 1.38, 2.17, -0.09, -0.08, P["white"], "glass")
        box(mb, fe, -0.02, 0.02, 1.38, 2.17, -0.1, -0.07, wf, "paint")
    L.room(mb, x0 + d, x1 - d, 0.0, H, z0 + d, z1 - d, hexc("#4a3a2c"), "matte")
    # roof: orange corrugated, ridge along x
    ex0, ex1 = x0 - 0.35, x1 + 0.35
    ez0, ez1 = z0 - over, z1 + over
    across = V(ex1, ez0, ey) - V(ex0, ez0, ey)
    corrugated(mb, V(ex0, ez0, ey), across, V(ex0, cz, ridge_y) - V(ex0, ez0, ey), 0.17, 0.014, P["roof_or"], "paint")
    corrugated(mb, V(ex0, cz, ridge_y), across, V(ex0, ez1, ey) - V(ex0, cz, ridge_y), 0.17, 0.014, jit(rng, P["roof_or"], 0.03), "paint")
    for (za, ya, zb, yb) in ((ez0, ey, cz, ridge_y), (cz, ridge_y, ez1, ey)):
        mb.quad(V(ex0, za, ya - 0.05), V(ex0, zb, yb - 0.05), V(ex1, zb, yb - 0.05), V(ex1, za, ya - 0.05), P["roof_or_dark"], "matte")
    mb.quad(V(ex0, ez1, ey - 0.12), V(ex1, ez1, ey - 0.12), V(ex1, ez1, ey + 0.02), V(ex0, ez1, ey + 0.02), P["roof_or_dark"], "paint")
    mb.quad(V(ex1, ez0, ey - 0.12), V(ex0, ez0, ey - 0.12), V(ex0, ez0, ey + 0.02), V(ex1, ez0, ey + 0.02), P["roof_or_dark"], "paint")
    for xx, flip in ((ex0, False), (ex1, True)):
        pts = [(ez0, ey), (cz, ridge_y), (ez1, ey)]
        for (za, ya), (zb, yb) in zip(pts, pts[1:]):
            a, b = V(xx, za, ya + 0.02), V(xx, zb, yb + 0.02)
            c, e = V(xx, zb, yb - 0.1), V(xx, za, ya - 0.1)
            mb.quad(a, b, c, e, P["roof_or_dark"], "paint") if flip else mb.quad(b, a, e, c, P["roof_or_dark"], "paint")
    tubew(mb, (ex0 - 0.02, ridge_y + 0.035, cz), (ex1 + 0.02, ridge_y + 0.035, cz), 0.07, P["roof_or_dark"], "paint", sides=8)
    # eave lamp over the door
    lamp_x = (doorx[0] + doorx[1]) / 2
    lz = door_wall_z + (-0.22 if A else 0.22)
    boxw(mb, lamp_x - 0.08, lamp_x + 0.08, 2.75, 2.93, lz - 0.08, lz + 0.08, P["cream"], "paint")
    boxw(mb, lamp_x - 0.06, lamp_x + 0.06, 2.72, 2.75, lz - 0.06, lz + 0.06, P["white"], "emit_white")
    # porch bench on the walkway side of the bench wall: 2.0 x 0.45, seat top 0.45, under the eave
    bz0 = bench_wall_z + (0.0 if A else -0.45)
    seat_top = 0.45
    for i in range(4):
        zs = bz0 + 0.0125 + i * 0.105
        boxw(mb, cx - 1.0, cx + 1.0, seat_top - 0.035, seat_top, zs, zs + 0.095, jit(rng, P["wood_light"], 0.06), "wood")
    for xx in (cx - 0.9, cx + 0.9):
        boxw(mb, xx - 0.03, xx + 0.03, 0.0, seat_top - 0.035, bz0 + 0.03, bz0 + 0.42, P["pav_wood"], "wood")
    return mb, dict(lamp=(lamp_x, 2.7, lz))


# ---------------------------------------------------------------------------------------------------- office / rental shop


def wall_panels(mb, fr, a0, a1, y0, y1, holes, depth_core=0.12, rng=None, board_h=0.155, pitch=0.168, clad=None, clad_dark=None, boards=True):
    """A wall in frame `fr` (local +z outward, the outer face on lz = 0, thickness 0.16 inward): shiplap boards outside with
    real openings, a core, a cream inner lining. `holes` = (lx0, lx1, y0, y1) in local coordinates."""
    clad = clad or P["clad"]
    clad_dark = clad_dark or P["clad_dark"]
    for (r0, r1, b0, b1) in L.rects_minus((a0, a1, y0, y1), holes):
        box(mb, fr, r0, r1, b0, b1, -0.12, -0.04, hexc("#5a4630"), "matte")
        box(mb, fr, r0, r1, b0, b1, -0.16, -0.12, P["wall_in"], "matte")
    if boards:
        for (r0, r1, b0, b1) in L.rects_minus((a0, a1, y0, y1), holes):
            box(mb, fr, r0, r1, b0, b1, -0.05, 0.0, clad, "siding", skip="")
        n = 0
        boards = False
    if boards:
        n = int(round((y1 - y0) / pitch))
        p = (y1 - y0) / n
        for i in range(n):
            ya = y0 + i * p
            yb = ya + p - 0.012
            cuts = [(h[0], h[1]) for h in holes if h[2] < (ya + yb) / 2 < h[3]]
            for s0, s1 in L.intervals_minus(a0, a1, cuts):
                c = jit(rng, clad if i % 2 == 0 else clad_dark, 0.06)
                box(mb, fr, s0, s1, ya, yb, -0.05, 0.0, c, "wood")
    # reveals lining each opening (silver)
    for (h0, h1, b0, b1) in holes:
        t = 0.035
        box(mb, fr, h0, h1, b1 - t, b1, -0.16, 0.0, P["trim"], "metal")
        if b0 > y0 + 0.01:
            box(mb, fr, h0, h1, b0, b0 + t, -0.16, 0.0, P["trim"], "metal")
        box(mb, fr, h0, h0 + t, b0, b1, -0.16, 0.0, P["trim"], "metal")
        box(mb, fr, h1 - t, h1, b0, b1, -0.16, 0.0, P["trim"], "metal")


def build_office(rng):
    sh = LAYOUT["shop"]
    X0, X1, Z0, Z1 = sh["minX"], sh["maxX"], sh["minZ"], sh["maxZ"]
    cx, cz = (X0 + X1) / 2, (Z0 + Z1) / 2
    mb = MB("lake_office")
    FL = 0.4  # interior floor / plinth top
    WT = 3.6  # wall top
    # plinth (concrete): flush with the footprint, a darker skirt, steps in front of the door
    boxw(mb, X0, X1, 0.0, FL, Z0, Z1, P["concrete"], "concrete", skip="D")
    boxw(mb, X0 - 0.01, X1 + 0.01, 0.0, 0.07, Z0 - 0.01, Z1 + 0.01, mulc(P["concrete"], 0.8), "matte", skip="D")
    # --- south wall (the front): window, door, plate
    south = F(cx, 0, Z1, 0.0)
    win = (-2.0, 2.0, 1.5, 2.7)
    door = (2.6, 3.8, FL, 3.0)
    wall_panels(mb, south, -4.0, 4.0, FL, WT, [win, door], rng=rng)
    north = F(cx, 0, Z0, math.pi)
    wall_panels(mb, north, -4.0, 4.0, FL, WT, [], rng=rng)
    west = F(X0, 0, cz, -math.pi / 2)
    ww = (-0.9, 0.9, 1.7, 2.6)
    wall_panels(mb, west, -2.7, 2.7, FL, WT, [ww], rng=rng)
    east = F(X1, 0, cz, math.pi / 2)
    wall_panels(mb, east, -2.7, 2.7, FL, WT, [], rng=rng)
    # silver corner strips, base and top bands
    for (x, z) in ((X0, Z0), (X1, Z0), (X0, Z1), (X1, Z1)):
        sx = -1 if x == X0 else 1
        sz = -1 if z == Z0 else 1
        boxw(mb, x - (0.07 if sx > 0 else 0.0), x + (0.0 if sx > 0 else 0.07), FL, WT, z - (0.07 if sz > 0 else 0.0), z + (0.0 if sz > 0 else 0.07), P["trim"], "metal")
    for (x0_, x1_, z0_, z1_) in ((X0, X1, Z1 - 0.02, Z1 + 0.012), (X0, X1, Z0 - 0.012, Z0 + 0.02), (X0 - 0.012, X0 + 0.02, Z0, Z1), (X1 - 0.02, X1 + 0.012, Z0, Z1)):
        boxw(mb, x0_, x1_, WT - 0.07, WT, z0_, z1_, P["trim"], "metal")
        boxw(mb, x0_, x1_, FL, FL + 0.09, z0_, z1_, hexc("#5b6066"), "metal")
    # --- south window: aluminium sliding sashes (two panes, two tracks), a counter shelf outside, an inner sill
    fw = south
    t = 0.045
    for (a, b, c, e) in ((-2.0, -1.97 + 0.0, 1.5, 2.7),):
        pass
    for k, (a, b, lz0, lz1) in enumerate(((-2.0, 0.06, -0.075, -0.045), (-0.06, 2.0, -0.125, -0.095))):
        for (xa, xb, ya, yb) in ((a, a + t, 1.5, 2.7), (b - t, b, 1.5, 2.7), (a, b, 1.5, 1.5 + t), (a, b, 2.7 - t, 2.7)):
            box(mb, fw, xa, xb, ya, yb, lz0 - 0.01, lz1, P["trim"], "metal")
        box(mb, fw, a + t, b - t, 1.5 + t, 2.7 - t, lz0 + 0.01, lz0 + 0.017, P["white"], "glass")
    box(mb, fw, 0.0, 0.03, 1.9, 2.3, -0.075, -0.05, P["black"], "metal")  # latch / handle
    box(mb, fw, -2.1, 2.1, 1.5, 1.53, -0.02, 0.0, P["trim"], "metal")  # outer sill
    # counter shelf outside the window (a plank on two brackets)
    box(mb, fw, -2.15, 2.15, 1.51, 1.56, 0.0, 0.42, jit(rng, P["wood_light"], 0.04), "wood")
    for sx in (-1.8, 1.8):
        box(mb, fw, sx - 0.025, sx + 0.025, 1.2, 1.51, 0.0, 0.03, P["black"], "metal")
        tube(mb, fw, (sx, 1.2, 0.03), (sx, 1.51, 0.36), 0.015, P["black"], "metal", 6)
    # --- door: blue leaf with a glass slit, frame, lever, hinges; two steps with chequer plate
    dxa, dxb = door[0], door[1]
    box(mb, fw, dxa + 0.02, dxb - 0.02, FL, 2.98, -0.1, -0.05, P["door_blue"], "paint")
    box(mb, fw, dxb - 0.34, dxb - 0.22, 1.35, 2.5, -0.052, -0.045, hexc("#dfe7ea"), "paint")
    box(mb, fw, dxa + 0.2, dxb - 0.2, 0.7, 1.15, -0.052, -0.046, mulc(P["door_blue"], 0.85), "paint")
    box(mb, fw, dxa + 0.07, dxa + 0.14, 1.05, 1.15, -0.052, 0.0, P["black"], "metal")
    tube(mb, fw, (dxa + 0.1, 1.1, -0.01), (dxa + 0.1 + 0.18, 1.1, 0.03), 0.012, P["galv"], "metal", 6)
    for y in (0.7, 1.7, 2.7):
        tube(mb, fw, (dxb - 0.01, y, -0.05), (dxb - 0.01, y + 0.12, -0.05), 0.012, P["galv_dark"], "metal", 6)
    box(mb, fw, dxa - 0.04, dxb + 0.04, 3.0, 3.06, -0.16, 0.012, P["trim"], "metal")
    box(mb, fw, dxa - 0.04, dxa + 0.0, FL, 3.0, -0.16, 0.012, P["trim"], "metal")
    box(mb, fw, dxb, dxb + 0.04, FL, 3.0, -0.16, 0.012, P["trim"], "metal")
    sx0, sx1 = cx + 2.55, cx + 3.95
    for i, (h, dz) in enumerate(((0.0, 0.5), (0.0, 0.5))):
        pass
    boxw(mb, sx0, sx1, 0.0, 0.2, Z1, Z1 + 0.5, hexc("#5b6066"), "metal", skip="D")
    boxw(mb, sx0 - 0.02, sx1 + 0.02, 0.2, 0.225, Z1 + 0.0, Z1 + 0.52, P["plate"], "metal", skip="D")
    for k in range(7):  # chequer ribs
        boxw(mb, sx0 + 0.05 + k * 0.2, sx0 + 0.15 + k * 0.2, 0.225, 0.235, Z1 + 0.04, Z1 + 0.48, mulc(P["plate"], 1.25), "metal", skip="D")
    boxw(mb, sx0, sx1, FL - 0.0, FL + 0.012, Z1 + 0.0, Z1 + 0.14, P["plate"], "metal", skip="D")  # threshold plate
    # green plastic pallet on the ground at the door (the reference's)
    pal = F(cx + 3.2, 0.0, Z1 + 1.15, 0.0)
    box(mb, pal, -0.55, 0.55, 0.0, 0.03, -0.45, 0.45, P["green_pallet"], "paint")
    for (a, b) in ((-0.55, -0.35), (-0.1, 0.1), (0.35, 0.55)):
        box(mb, pal, a, b, 0.03, 0.12, -0.45, 0.45, P["green_pallet"], "paint")
    box(mb, pal, -0.55, 0.55, 0.12, 0.15, -0.45, 0.45, P["green_pallet"], "paint")
    # --- awning over the window: blue corrugated sheet on two posts, white fascia with the rental sign
    ax0, ax1 = cx - 2.8, cx + 2.8
    za, zb = Z1, Z1 + 1.8
    ya, yb = 3.2, 2.98
    across = V(ax1, za, ya) - V(ax0, za, ya)
    corrugated(mb, V(ax0, za, ya), across, V(ax0, zb, yb) - V(ax0, za, ya), 0.17, 0.016, P["roof_blue"], "paint")
    mb.quad(V(ax0, za, ya - 0.05), V(ax0, zb, yb - 0.05), V(ax1, zb, yb - 0.05), V(ax1, za, ya - 0.05), mulc(P["roof_blue"], 0.7), "matte")
    for x in (ax0 + 0.06, ax1 - 0.06):
        tubew(mb, (x, 3.12, za + 0.02), (x, 2.9, zb - 0.05), 0.03, P["galv"], "metal", 8)
        tubew(mb, (x, 0.0, zb - 0.1), (x, 2.9, zb - 0.1), 0.05, P["galv"], "metal", 10)
        boxw(mb, x - 0.12, x + 0.12, 0.0, 0.015, zb - 0.22, zb + 0.02, P["galv_dark"], "metal", skip="D")
    tubew(mb, (ax0, 2.92, zb - 0.1), (ax1, 2.92, zb - 0.1), 0.03, P["galv"], "metal", 8)
    ffr = F(cx, 0, zb + 0.0, 0.0)
    box(mb, ffr, -2.8, 2.8, 2.58, 3.0, -0.06, 0.0, P["door_blue"], "paint", skip="F")
    sign_face(mb, ffr, -2.8, 2.8, 2.58, 3.0, 0.002, "rental")
    # --- roof (blue corrugated, shallow gable along x), gutter, downspout, vent pipes
    pitch_ang = math.radians(10)
    over = 0.62
    ey = WT - 0.05
    ex0, ex1 = X0 - 0.4, X1 + 0.4
    ez0, ez1 = Z0 - over, Z1 + over
    ridge_y = ey + math.tan(pitch_ang) * ((Z1 - Z0) / 2 + over)
    across = V(ex1, ez0, ey) - V(ex0, ez0, ey)
    corrugated(mb, V(ex0, ez0, ey), across, V(ex0, cz, ridge_y) - V(ex0, ez0, ey), 0.3, 0.025, P["roof_blue"], "paint")
    corrugated(mb, V(ex0, cz, ridge_y), across, V(ex0, ez1, ey) - V(ex0, cz, ridge_y), 0.3, 0.025, jit(rng, P["roof_blue"], 0.02), "paint")
    for (zz0, yy0, zz1, yy1) in ((ez0, ey, cz, ridge_y), (cz, ridge_y, ez1, ey)):
        mb.quad(V(ex0, zz0, yy0 - 0.06), V(ex0, zz1, yy1 - 0.06), V(ex1, zz1, yy1 - 0.06), V(ex1, zz0, yy0 - 0.06), P["trim"], "matte")
    mb.quad(V(ex0, ez1, ey - 0.16), V(ex1, ez1, ey - 0.16), V(ex1, ez1, ey + 0.03), V(ex0, ez1, ey + 0.03), P["trim"], "metal")
    mb.quad(V(ex1, ez0, ey - 0.16), V(ex0, ez0, ey - 0.16), V(ex0, ez0, ey + 0.03), V(ex1, ez0, ey + 0.03), P["trim"], "metal")
    for xx, flip in ((ex0, False), (ex1, True)):
        pts = [(ez0, ey), (cz, ridge_y), (ez1, ey)]
        for (zq0, yq0), (zq1, yq1) in zip(pts, pts[1:]):
            a, b = V(xx, zq0, yq0 + 0.03), V(xx, zq1, yq1 + 0.03)
            c, e = V(xx, zq1, yq1 - 0.14), V(xx, zq0, yq0 - 0.14)
            mb.quad(a, b, c, e, P["trim"], "metal") if flip else mb.quad(b, a, e, c, P["trim"], "metal")
    tubew(mb, (ex0, ridge_y + 0.03, cz), (ex1, ridge_y + 0.03, cz), 0.08, mulc(P["roof_blue"], 0.8), "paint", sides=8)
    # gable end fillers (boards up to the roof) on the two end walls
    for xx, fr_ in ((X0, west), (X1, east)):
        for i in range(6):
            y = WT + i * 0.1
            half = ((ridge_y - 0.1) - (y + 0.1)) / math.tan(pitch_ang)
            half = min(half, 2.75)
            if half < 0.1:
                break
            box(mb, fr_, -half, half, y, y + 0.09, -0.05, 0.0, jit(rng, P["clad"], 0.06), "wood")
    # gutter + downspout on the front
    tubew(mb, (ex0 + 0.05, ey - 0.08, ez1 + 0.04), (ex1 - 0.05, ey - 0.08, ez1 + 0.04), 0.05, P["galv_dark"], "metal", 8)
    tubew(mb, (X0 + 0.12, FL + 0.1, Z1 + 0.04), (X0 + 0.12, ey - 0.08, Z1 + 0.04), 0.04, P["galv_dark"], "metal", 8)
    tubew(mb, (X0 + 0.12, ey - 0.08, ez1 + 0.04), (X0 + 0.12, ey - 0.08, Z1 + 0.04), 0.04, P["galv_dark"], "metal", 8)
    # vent pipes
    for (x, z) in ((cx - 1.8, cz - 0.9), (cx + 1.6, cz - 1.2)):
        yb = ridge_y - math.tan(pitch_ang) * abs(z - cz) - 0.05
        tubew(mb, (x, yb, z), (x, yb + 0.8, z), 0.065, P["galv"], "metal", 10)
        tubew(mb, (x, yb + 0.8, z), (x, yb + 0.95, z), 0.09, P["galv"], "metal", 10, r1=0.012)
        tubew(mb, (x, yb, z), (x, yb + 0.06, z), 0.1, P["galv_dark"], "metal", 10)
    # --- the sign board on the roof's front edge: white board with a blue frame, on short posts and back braces
    sfr = F(cx, 0, Z1 + 0.1, 0.0)
    sy0, sy1 = 3.78, 4.88
    sw = 5.5
    box(mb, sfr, -sw / 2, sw / 2, sy0, sy1, -0.07, 0.0, P["door_blue"], "paint", skip="F")
    sign_face(mb, sfr, -sw / 2, sw / 2, sy0, sy1, 0.002, "office")
    for xx in (-2.4, 0.0, 2.4):
        tube(mb, sfr, (xx, sy0, -0.03), (xx, sy0 - 0.2, -0.03), 0.03, P["galv"], "metal", 8)
        tube(mb, sfr, (xx, sy1 - 0.1, -0.03), (xx, ey + 0.55, -1.4), 0.022, P["galv"], "metal", 8)
    # --- wall lamp beside the door and a sconce on the end wall
    lampx = cx + 2.2
    boxw(mb, lampx - 0.07, lampx + 0.07, 2.62, 2.84, Z1 + 0.0, Z1 + 0.16, P["black"], "metal")
    boxw(mb, lampx - 0.05, lampx + 0.05, 2.62, 2.66, Z1 + 0.02, Z1 + 0.14, P["white"], "emit_white")
    # --- interior: floor, ceiling, shelves with stock, the carp print, a desk, fluorescent lights
    ix0, ix1, iz0, iz1 = X0 + 0.16, X1 - 0.16, Z0 + 0.16, Z1 - 0.16
    boxw(mb, ix0, ix1, FL, FL + 0.03, iz0, iz1, P["floor_in"], "wood", skip="D")
    for k in range(int((ix1 - ix0) / 0.2)):
        boxw(mb, ix0 + k * 0.2 + 0.19, ix0 + k * 0.2 + 0.2, FL + 0.03, FL + 0.032, iz0, iz1, mulc(P["floor_in"], 0.7), "wood", skip="D")
    boxw(mb, ix0, ix1, WT - 0.04, WT, iz0, iz1, P["white"], "matte", skip="U")
    for (x, z) in ((cx - 1.9, cz + 0.2), (cx + 1.9, cz + 0.2)):
        boxw(mb, x - 0.7, x + 0.7, WT - 0.1, WT - 0.04, z - 0.07, z + 0.07, P["white"], "emit_white")
    # the fit-out (shelves of stock, the carp print, the desk with its cash box, ledger and mug) moved to its own model,
    # lake_shop_interior.glb (build_shop_interior.py, 2026-11-17), which lines this room and keeps the counter where the desk was
    return mb


def shelves(mb, rng, xa, xb, zback, FL):
    """A steel shelf unit against the back wall with fishing stock: float boxes, bait tubs, line spools, gloves, hook cards."""
    depth = 0.45
    for x in (xa + 0.03, xb - 0.03):
        boxw(mb, x - 0.03, x + 0.03, FL, 3.1, zback, zback + depth, P["black"], "metal")
    cols = [hexc(c) for c in ("#d9402e", "#f2b632", "#3a8f4f", "#2d6fc0", "#e8e4d6", "#e6742c", "#8c4fb0")]
    for k, y in enumerate((0.95, 1.55, 2.15, 2.75)):
        boxw(mb, xa, xb, y, y + 0.03, zback, zback + depth, P["wood_light"], "wood")
        x = xa + 0.12
        while x < xb - 0.25:
            kind = rng.random()
            z = zback + 0.1 + rng.random() * 0.2
            c = rng.choice(cols)
            if kind < 0.32:  # float box
                w = 0.1 + rng.random() * 0.1
                boxw(mb, x, x + w, y + 0.03, y + 0.1, z, z + 0.16, c, "paint")
                boxw(mb, x + 0.01, x + w - 0.01, y + 0.1, y + 0.104, z + 0.01, z + 0.15, P["white"], "glass")
                x += w + 0.1
            elif kind < 0.55:  # bait tub
                tubew(mb, (x + 0.06, y + 0.03, z + 0.08), (x + 0.06, y + 0.11, z + 0.08), 0.06, P["white"], "paint", 10)
                tubew(mb, (x + 0.06, y + 0.11, z + 0.08), (x + 0.06, y + 0.125, z + 0.08), 0.063, c, "paint", 10)
                x += 0.22
            elif kind < 0.8:  # line spools stacked
                for j in range(2):
                    tubew(mb, (x + 0.05, y + 0.03 + j * 0.045, z + 0.06), (x + 0.05, y + 0.07 + j * 0.045, z + 0.06), 0.045, c, "paint", 10)
                x += 0.2
            else:  # gloves / hook cards: a flat pack
                boxw(mb, x, x + 0.14, y + 0.03, y + 0.045, z, z + 0.2, c, "matte")
                boxw(mb, x + 0.02, x + 0.12, y + 0.045, y + 0.05, z + 0.03, z + 0.17, P["white"], "matte")
                x += 0.26
    # price tags along the board edges (blank white strips)
    for y in (0.95, 1.55, 2.15, 2.75):
        boxw(mb, xa + 0.05, xb - 0.05, y + 0.005, y + 0.03, zback + depth, zback + depth + 0.012, P["white"], "matte")


def carp_print(mb, rng, cx, zback):
    """The big carp print (붕어 탁본) in a dark frame, centred on the back wall: a black ink fish on cream paper."""
    fr = F(cx, 0, zback, math.pi)  # local +z = into the room (south, +z)... frame yaw pi faces north: so mirror: use world box
    z = zback + 0.012
    fw = F(cx, 0, z, 0.0)  # yaw 0: faces south (into the room), local x east
    box(mb, fw, -0.62, 0.62, 1.55, 2.95, 0.0, 0.03, hexc("#3a2a1c"), "wood")
    box(mb, fw, -0.56, 0.56, 1.61, 2.89, 0.03, 0.036, P["sign_white"], "matte")
    ink = hexc("#1b1a18")
    # a fish in profile, nose to the left: outline polygon (local x, y)
    body = [(-0.46, 2.22), (-0.36, 2.36), (-0.2, 2.44), (0.0, 2.46), (0.2, 2.42), (0.34, 2.32), (0.4, 2.25), (0.5, 2.34), (0.52, 2.12), (0.4, 2.2), (0.34, 2.2), (0.2, 2.08), (0.0, 2.02), (-0.2, 2.02), (-0.36, 2.08)]
    pts = [fw.p(x, y, 0.037) for (x, y) in body]
    mb.poly(pts, ink, "matte")
    eye = [fw.p(-0.34 + 0.03 * math.cos(a), 2.26 + 0.03 * math.sin(a), 0.038) for a in [i * math.pi / 3 for i in range(6)]]
    mb.poly(eye, P["sign_white"], "matte")
    # dorsal fin and ruler marks
    mb.poly([fw.p(-0.05, 2.46, 0.037), fw.p(0.15, 2.58, 0.037), fw.p(0.28, 2.43, 0.037)], ink, "matte")
    for k in range(10):
        h = 0.07 if k % 5 == 0 else 0.04
        boxw(mb, cx - 0.5 + k * 0.1, cx - 0.5 + k * 0.1 + 0.008, 1.68, 1.68 + h, z + 0.036, z + 0.038, ink, "matte")


# ---------------------------------------------------------------------------------------------------- props at the office


def prop_box(pid):
    p = next(p for p in LAYOUT["props"] if p["id"] == pid)
    return p["minX"], p["maxX"], p["minZ"], p["maxZ"]


def folded_rod(mb, fr, x, z, h, rng, lean=(0.0, 0.0)):
    """A folded rod standing in a rack: tapered tube, cork grip, a ring band, a tip."""
    base = (x, 0.0, z)
    top = (x + lean[0], h, z + lean[1])
    tube(mb, fr, (x, 0.0, z), (x + lean[0] * 0.2, 0.32, z + lean[1] * 0.2), 0.017, hexc("#c7a87a"), "wood", 8, caps=(True, False))
    tube(mb, fr, (x + lean[0] * 0.2, 0.32, z + lean[1] * 0.2), top, 0.0125, hexc("#b9d92c"), "paint", 8, r1=0.005)
    for t in (0.45, 0.7):
        y = 0.32 + (h - 0.32) * t
        p = (x + lean[0] * (0.2 + 0.8 * t), y, z + lean[1] * (0.2 + 0.8 * t))
        tube(mb, fr, (p[0], p[1] - 0.012, p[2]), (p[0], p[1] + 0.012, p[2]), 0.0145 - 0.007 * t, hexc("#d9402e"), "paint", 8)


def build_rod_rack(rng):
    x0, x1, z0, z1 = prop_box("rod_rack")
    mb = MB("lake_rod_rack")
    fr = F((x0 + x1) / 2, 0, (z0 + z1) / 2, math.pi / 2)  # faces east (+x), the long side along local x (north-south)
    # local x = north (yaw pi/2 gives (cos,-sin) = (0,-1)); the rack is 0.8 along local x? box is 1.2 in x, 0.8 in z
    fr = F((x0 + x1) / 2, 0, (z0 + z1) / 2, 0.0)  # local x = east-west 1.2 wide, local z = depth 0.8 (faces south)
    wood = P["pav_wood"]
    box(mb, fr, -0.6, 0.6, 0.0, 0.1, -0.4, 0.4, hexc("#4b4f55"), "metal")  # base tray
    box(mb, fr, -0.57, 0.57, 0.1, 0.2, -0.37, 0.37, hexc("#3f4348"), "metal", skip="D")
    for sx in (-0.57, 0.57):
        box(mb, fr, sx - 0.035, sx + 0.035, 0.1, 1.5, -0.04, 0.04, wood, "wood")  # end uprights
        for sz in (-0.34, 0.34):
            box(mb, fr, sx - 0.03, sx + 0.03, 0.1, 0.9, sz - 0.03, sz + 0.03, wood, "wood") if False else None
    # two rails with grooves, the lower and the upper
    for y in (0.62, 1.3):
        box(mb, fr, -0.6, 0.6, y, y + 0.05, -0.34, -0.26, wood, "wood")
        box(mb, fr, -0.6, 0.6, y, y + 0.05, 0.26, 0.34, wood, "wood")
        for sz in (-0.3, 0.3):
            box(mb, fr, -0.6, -0.55, y - 0.02, y + 0.07, sz - 0.04, sz + 0.04, wood, "wood")
            box(mb, fr, 0.55, 0.6, y - 0.02, y + 0.07, sz - 0.04, sz + 0.04, wood, "wood")
    for sx in (-0.57, 0.57):
        for sz in (-0.3, 0.3):
            box(mb, fr, sx - 0.03, sx + 0.03, 0.1, 1.38, sz - 0.03, sz + 0.03, wood, "wood")
    # 8 folded rods in two rows
    i = 0
    for sz in (-0.2, 0.2):
        for sx in (-0.42, -0.14, 0.14, 0.42):
            folded_rod(mb, fr, sx, sz, 1.62 + (i % 3) * 0.05, rng, lean=(0.0, 0.03 if sz > 0 else -0.03))
            i += 1
    # a rope tie around the bunch
    for y in (0.62, 1.3):
        tube(mb, fr, (-0.5, y + 0.1, -0.2), (0.5, y + 0.1, -0.2), 0.008, hexc("#d6c08a"), "matte", 4)
    return mb


def build_vending(rng):
    x0, x1, z0, z1 = prop_box("vending")
    mb = MB("lake_vending")
    fr = F((x0 + x1) / 2, 0, z1, 0.0)  # front face on the south side (z1), local +z outward = south
    W = x1 - x0
    D = z1 - z0
    body = P["vend_body"]
    box(mb, fr, -W / 2, W / 2, 0.0, 0.1, -D + 0.05, -0.02, hexc("#15181c"), "paint")
    box(mb, fr, -W / 2, W / 2, 0.1, 2.12, -D, 0.0, body, "paint", skip="")
    # side vents (louvres) on the two flanks
    for sx in (-W / 2 - 0.004, W / 2):
        for k in range(8):
            box(mb, fr, sx, sx + 0.004, 0.3 + k * 0.04, 0.325 + k * 0.04, -0.7, -0.2, mulc(body, 0.6), "matte")
    # front: display glass with the drinks, a column of controls, a pick-up flap
    gx0, gx1, gy0, gy1 = -W / 2 + 0.06, 0.12, 0.62, 1.98
    box(mb, fr, gx0 - 0.02, gx1 + 0.02, gy0 - 0.02, gy1 + 0.02, 0.0, 0.012, hexc("#0f1114"), "paint")
    box(mb, fr, gx0, gx1, gy0, gy1, 0.012, 0.016, P["white"], "glass")
    box(mb, fr, gx0, gx1, gy0, gy1, -0.02, 0.0, hexc("#e9ecef"), "emit_white")  # lit back panel
    cans = [hexc(c) for c in ("#d9402e", "#2d6fc0", "#f2b632", "#3a8f4f", "#e8e4d6", "#8c4fb0", "#e6742c", "#1d9aa6")]
    n = 7
    for k, y in enumerate((1.76, 1.44, 1.12, 0.82)):
        box(mb, fr, gx0, gx1, y, y + 0.02, -0.34, 0.0, hexc("#2b2e33"), "metal")
        crng = random.Random(10 + k)
        for j in range(n):
            x = gx0 + 0.06 + (gx1 - gx0 - 0.1) * j / (n - 1)
            c = crng.choice(cans)
            tube(mb, fr, (x, y + 0.02, -0.12), (x, y + 0.02 + 0.13, -0.12), 0.033, c, "paint", 6)
            tube(mb, fr, (x, y + 0.15, -0.12), (x, y + 0.158, -0.12), 0.028, hexc("#c9ced3"), "metal", 6)
            tube(mb, fr, (x, y + 0.02, -0.12), (x, y + 0.075, -0.12), 0.0335, mulc(c, 0.55), "paint", 6, caps=(False, False))
        for j in range(n):  # price tags: blank white strips on the shelf lip
            x = gx0 + 0.06 + (gx1 - gx0 - 0.1) * j / (n - 1)
            box(mb, fr, x - 0.03, x + 0.03, y, y + 0.02, 0.0, 0.004, P["white"], "matte")
    # column: LED display, keypad, coin and note slots, return
    cx0, cx1 = 0.17, W / 2 - 0.05
    box(mb, fr, cx0, cx1, 1.55, 1.98, 0.0, 0.012, hexc("#202428"), "paint")
    box(mb, fr, cx0 + 0.02, cx1 - 0.02, 1.84, 1.94, 0.012, 0.016, hexc("#4ee27a"), "emit_white")
    for r in range(4):
        for c in range(3):
            bx = cx0 + 0.03 + c * (cx1 - cx0 - 0.04) / 3
            box(mb, fr, bx, bx + 0.035, 1.58 + r * 0.06, 1.63 + r * 0.06, 0.012, 0.02, hexc("#c9ced3"), "metal")
    box(mb, fr, cx0, cx1, 1.18, 1.5, 0.0, 0.012, hexc("#202428"), "paint")
    box(mb, fr, cx0 + 0.03, cx1 - 0.03, 1.4, 1.44, 0.012, 0.02, hexc("#111315"), "metal")  # coin slot
    box(mb, fr, cx0 + 0.03, cx1 - 0.03, 1.28, 1.32, 0.012, 0.02, hexc("#111315"), "metal")  # note slot
    box(mb, fr, cx0 + 0.04, cx1 - 0.04, 1.2, 1.24, 0.012, 0.02, hexc("#c9ced3"), "metal")
    box(mb, fr, gx0 - 0.02, cx1 + 0.0, 0.18, 0.56, 0.0, 0.012, hexc("#0f1114"), "paint")  # pick-up flap well
    box(mb, fr, gx0 + 0.04, gx1 - 0.04, 0.22, 0.52, 0.012, 0.03, hexc("#23262a"), "paint")
    tube(mb, fr, (gx0 + 0.1, 0.5, 0.034), (gx1 - 0.1, 0.5, 0.034), 0.01, P["galv"], "metal", 6)
    # header light box (blank): white panel with a blue band; no wording
    box(mb, fr, -W / 2 + 0.03, W / 2 - 0.03, 1.99, 2.1, 0.0, 0.012, hexc("#e9ecef"), "emit_white")
    box(mb, fr, -W / 2 + 0.03, W / 2 - 0.03, 2.03, 2.07, 0.012, 0.016, hexc("#2d6fc0"), "paint")
    box(mb, fr, -W / 2, W / 2, 2.12, 2.15, -D, 0.01, mulc(body, 0.8), "paint")
    # feet / the lowered grill
    for sx in (-W / 2 + 0.05, W / 2 - 0.05):
        box(mb, fr, sx - 0.04, sx + 0.04, 0.0, 0.025, -D + 0.1, -0.1, P["black"], "matte")
    return mb


def build_bin(rng):
    x0, x1, z0, z1 = prop_box("invasive_bin")
    mb = MB("lake_invasive_bin")
    fr = F((x0 + x1) / 2, 0, z1, 0.0)  # front on the south side
    W, D = x1 - x0, z1 - z0
    blue = P["bin_blue"]
    # tapered plastic body (wider at the top), a flange, a lid with a slot, a hinged flap
    pts = []
    for iz in (0, 1):
        for iy, (y, grow) in enumerate(((0.04, 0.0), (0.9, 0.04))):
            for ix in (0, 1):
                sx = (W / 2 - 0.02 + grow) * (1 if ix else -1)
                zf = (-D + 0.03 - grow) if iz == 0 else (-0.03 + grow)
                pts.append((ix, iy, iz, fr.p(sx, y, zf)))
    ordered = [None] * 8
    for (ix, iy, iz, p) in pts:
        ordered[ix + 2 * iy + 4 * iz] = p
    L.hexa(mb, ordered, blue, "paint")
    for k in range(5):  # moulded ribs on the sides
        box(mb, fr, -W / 2 + 0.0, W / 2, 0.15 + k * 0.17, 0.17 + k * 0.17, -D + 0.01, -0.01, mulc(blue, 0.88), "paint") if False else None
    box(mb, fr, -W / 2, W / 2, 0.9, 0.97, -D, 0.0, mulc(blue, 1.12), "paint")  # lid
    box(mb, fr, -W / 2 + 0.05, W / 2 - 0.05, 0.97, 1.0, -D + 0.08, -0.08, mulc(blue, 1.05), "paint")
    box(mb, fr, -0.3, 0.3, 0.9, 0.97, -0.2, -0.1, hexc("#0c1116"), "matte")  # slot (dark)
    box(mb, fr, -0.34, 0.34, 0.97, 1.0, -0.22, -0.08, hexc("#0c1116"), "matte") if False else None
    # label plate on the front
    sign_face(mb, fr, -0.32, 0.32, 0.36, 0.82, 0.003, "bin")
    # wheels' stub and handle
    for sx in (-W / 2 + 0.12, W / 2 - 0.12):
        box(mb, fr, sx - 0.04, sx + 0.04, 0.0, 0.05, -D + 0.05, -D + 0.12, P["black"], "matte")
    return mb


def build_trash(rng):
    """A round street bin in the gap between rack and vending machine."""
    mb = MB("lake_trash")
    x0, x1, z0, z1 = prop_box("rod_rack")
    v0, v1, vz0, vz1 = prop_box("vending")
    cx, cz = (x0 + x1) / 2 - 0.05, (z1 + vz0) / 2
    tubew(mb, (cx, 0.0, cz), (cx, 0.84, cz), 0.24, hexc("#2f4a3a"), "paint", 14, r1=0.26)
    tubew(mb, (cx, 0.84, cz), (cx, 0.9, cz), 0.275, hexc("#25392d"), "paint", 14)
    boxw(mb, cx - 0.1, cx + 0.1, 0.9, 0.93, cz - 0.1, cz + 0.1, hexc("#111315"), "matte")
    for k in range(3):
        tubew(mb, (cx, 0.12 + k * 0.24, cz), (cx, 0.14 + k * 0.24, cz), 0.256 + k * 0.004, hexc("#25392d"), "paint", 14)
    return mb


def build_nets(rng):
    """Two landing nets hung on pegs on the shop's west wall (09_landing_net_*): long handle, round hoop, a net bag."""
    sh = LAYOUT["shop"]
    mb = MB("lake_nets")
    x = sh["minX"]
    zc0 = sh["minZ"] + 2.0
    boxw(mb, x - 0.05, x, 2.5, 2.58, zc0, zc0 + 2.2, P["pav_wood"], "wood")
    for k, zc in enumerate((sh["minZ"] + 2.7, sh["minZ"] + 3.6)):
        tubew(mb, (x - 0.05, 2.56, zc), (x - 0.2, 2.56, zc), 0.012, P["black"], "metal", 6)
        hx = x - 0.2
        tubew(mb, (hx, 2.56, zc), (hx, 1.12, zc), 0.016, hexc("#2f3a33"), "paint", 8)
        tubew(mb, (hx, 2.56, zc), (hx, 2.5, zc), 0.021, P["black"], "matte", 8)
        ring = F(hx, 0.0, zc, math.pi / 2)  # a hoop in the plane of the wall (local x runs north-south)
        L.torus(mb, ring, 0.0, 0.82, 0.0, 0.3, 0.012, P["galv"], "metal", axis="z", seg=18, sides=5)
        for i in range(12):
            a = 2 * math.pi * i / 12
            tube(mb, ring, (0.3 * math.cos(a), 0.82 + 0.3 * math.sin(a), 0.0), (0.04 * math.cos(a), 0.3, 0.02), 0.004, hexc("#8d9a7a"), "matte", 4)
        for lv, rr in ((0.7, 0.24), (0.56, 0.17), (0.44, 0.11)):
            pts = [ring.p(rr * math.cos(2 * math.pi * i / 12), 0.82 + (lv - 0.82) * 0.5 + rr * math.sin(2 * math.pi * i / 12) * 0.0, 0.0) for i in range(12)]
    return mb


def build_chair_stack(rng):
    """A few folded fishing chairs stacked/leaning on the front wall near the corner."""
    sh = LAYOUT["shop"]
    mb = MB("lake_chair_stack")
    fr = F(sh["minX"] + 0.6, 0.0, sh["maxZ"], 0.0)
    fab = P["chair_fab"]
    for i in range(4):
        z = 0.11 + i * 0.0  # all lean on the wall
        x = -0.12 + i * 0.12
        lean = 0.05
        # a folded chair: a flat slab of fabric and two tubes, leaning with its top touching the wall
        box(mb, fr, x - 0.05, x + 0.05, 0.02, 0.88, 0.02, 0.08, jit(rng, fab, 0.08), "matte")
        for dx in (-0.2, 0.2):
            pass
        tube(mb, fr, (x - 0.045, 0.02, 0.1), (x - 0.045, 0.9, 0.035), 0.011, P["chair_frame"], "metal", 6)
        tube(mb, fr, (x + 0.045, 0.02, 0.1), (x + 0.045, 0.9, 0.035), 0.011, P["chair_frame"], "metal", 6)
    return mb


# ---------------------------------------------------------------------------------------------------- signs


def sign_board(mb, fr, w, h, y0, board_col, frame_col, text_lines, post_h=None, post_dx=None, post_col=None, wood=False):
    """A board on two posts, facing local +z. text_lines = [(string, height_fraction_of_h, colour)] centred top to bottom."""
    post_col = post_col or P["galv"]
    post_dx = post_dx if post_dx is not None else w / 2 - 0.12
    for sx in (-post_dx, post_dx):
        if wood:
            box(mb, fr, sx - 0.07, sx + 0.07, 0.0, y0 + h + 0.25, -0.09, 0.05, P["pav_wood"], "wood")
        else:
            tube(mb, fr, (sx, 0.0, -0.03), (sx, y0 + h + 0.05, -0.03), 0.035, post_col, "metal", 10)
    box(mb, fr, -w / 2, w / 2, y0, y0 + h, 0.0, 0.05, board_col, "wood" if wood else "paint")
    t = 0.045
    for (a, b, c, d) in ((-w / 2, w / 2, y0, y0 + t), (-w / 2, w / 2, y0 + h - t, y0 + h), (-w / 2, -w / 2 + t, y0, y0 + h), (w / 2 - t, w / 2, y0, y0 + h)):
        box(mb, fr, a, b, c, d, -0.005, 0.058, frame_col, "wood" if wood else "paint")
    return None


def build_info_sign(rng):
    mb = MB("lake_info_sign")
    fr = F(99.6, 0.0, -13.7, 0.0)
    w, h, y0 = 1.7, 1.25, 1.0
    sign_board(mb, fr, w, h, y0, P["door_blue"], P["door_blue"], [])
    sign_face(mb, fr, -w / 2, w / 2, y0, y0 + h, 0.052, "info")
    return mb


def build_welcome_sign(rng):
    mb = MB("lake_welcome_sign")
    fr = F(97.3, 0.0, -13.3, -math.pi / 2)
    w, h, y0 = 2.6, 0.95, 1.25
    sign_board(mb, fr, w, h, y0, hexc("#2c4a38"), P["pav_wood"], [], wood=True, post_dx=1.0)
    sign_face(mb, fr, -w / 2, w / 2, y0, y0 + h, 0.052, "welcome")
    return mb


# ---------------------------------------------------------------------------------------------------- benches, picnic tables


def build_bench(mb):
    """A backed park bench, 1.86 long x 0.6 deep, seat top 0.445, facing +z, centred on the origin (lakeLayout BENCH_BOX)."""
    fr = F()
    rng = random.Random(21)
    wood = P["wood_light"]
    L_ = 1.86
    for i in range(4):  # seat slats
        z0 = -0.18 + i * 0.12
        box(mb, fr, -L_ / 2, L_ / 2, 0.41, 0.445, z0, z0 + 0.105, jit(rng, wood, 0.05), "wood")
    for i in range(3):  # backrest slats, leaning back
        y0 = 0.52 + i * 0.12
        zb = -0.24 - (y0 - 0.45) * 0.28
        box(mb, fr, -L_ / 2, L_ / 2, y0, y0 + 0.1, zb, zb + 0.03, jit(rng, wood, 0.05), "wood")
    steel = hexc("#2b2e33")
    for sx in (-0.82, 0.82):
        for sz in (-0.18, 0.26):
            tube(mb, fr, (sx, 0.0, sz), (sx, 0.41, sz), 0.022, steel, "metal", 6)
            box(mb, fr, sx - 0.05, sx + 0.05, 0.0, 0.012, sz - 0.05, sz + 0.05, steel, "metal")
        tube(mb, fr, (sx, 0.41, -0.2), (sx, 0.41, 0.3), 0.018, steel, "metal", 6)
        tube(mb, fr, (sx, 0.41, -0.22), (sx - 0.0, 0.9, -0.31), 0.02, steel, "metal", 6)
        tube(mb, fr, (sx, 0.62, -0.28), (sx, 0.62, 0.22), 0.018, steel, "metal", 6)  # arm rest bar
        tube(mb, fr, (sx, 0.62, 0.22), (sx, 0.41, 0.26), 0.018, steel, "metal", 6)
    for sz in (-0.18, 0.26):
        tube(mb, fr, (-0.82, 0.2, sz), (0.82, 0.2, sz), 0.012, steel, "metal", 6)


def build_picnic(mb):
    """A picnic table, top 0.9 wide x 2.4 long (along z), two bench boards 0.4 deep centred 0.95 either side, seat top 0.45."""
    fr = F()
    rng = random.Random(31)
    wood = hexc("#9a7448")
    for i in range(5):  # table top boards (run along z)
        x0 = -0.45 + i * 0.18
        box(mb, fr, x0, x0 + 0.165, 0.80, 0.84, -1.2, 1.2, jit(rng, wood, 0.06), "wood")
    for sx in (-1, 1):
        for i in range(2):  # bench boards: 2 planks each
            xa = sx * 0.95 - 0.2 + i * 0.2
            box(mb, fr, xa, xa + 0.19, 0.41, 0.45, -1.2, 1.2, jit(rng, wood, 0.06), "wood")
    for sz in (-0.8, 0.8):
        for sx in (-1, 1):
            # an A-frame leg from the table top to the ground beyond the bench
            tube(mb, fr, (sx * 0.3, 0.8, sz), (sx * 1.1, 0.0, sz), 0.04, mulc(wood, 0.8), "wood", 4)
            # bench bearer
            box(mb, fr, sx * 0.95 - 0.19, sx * 0.95 + 0.19, 0.37, 0.41, sz - 0.04, sz + 0.04, mulc(wood, 0.8), "wood")
        box(mb, fr, -0.4, 0.4, 0.76, 0.8, sz - 0.04, sz + 0.04, mulc(wood, 0.8), "wood")  # top bearer
    box(mb, fr, -0.04, 0.04, 0.5, 0.56, -0.8, 0.8, mulc(wood, 0.75), "wood") if False else None


# ---------------------------------------------------------------------------------------------------- pavilion (정자)


def build_pavilion(rng):
    pv = LAYOUT["pavilion"]
    pc = pv["centre"]
    mb = MB("lake_pavilion")
    fr = F(pc["x"], 0.0, pc["z"], 0.0)
    cols = [(sx * 2.85, sz * 2.85) for sx in (-1, 1) for sz in (-1, 1)]
    # floor: low timber maru (top at 0.05) with a stone kerb round it
    for i in range(int(6.0 / 0.16)):
        z0 = -3.0 + i * 0.16
        box(mb, fr, -3.0, 3.0, 0.0, 0.05, z0, z0 + 0.15, jit(rng, hexc("#8a6641"), 0.06), "wood", skip="D")
    for (a, b, c, d) in ((-3.08, 3.08, -3.08, -3.0), (-3.08, 3.08, 3.0, 3.08), (-3.08, -3.0, -3.0, 3.0), (3.0, 3.08, -3.0, 3.0)):
        box(mb, fr, a, b, 0.0, 0.07, c, d, P["stone"], "matte")
    # columns on stone bases, round, tapering a little (entasis)
    for (x, z) in cols:
        tube(mb, fr, (x, 0.05, z), (x, 0.3, z), 0.19, P["stone"], "matte", 12)
        tube(mb, fr, (x, 0.3, z), (x, 3.15, z), 0.15, P["pav_wood"], "wood", 12, r1=0.135)
    # beams: lower tie beams (between the columns, at 2.55) and upper plate beams (3.05) that stick out at the corners
    for z in (-2.85, 2.85):
        box(mb, fr, -3.05, 3.05, 2.45, 2.75, z - 0.1, z + 0.1, P["pav_beam"], "wood")
        box(mb, fr, -3.45, 3.45, 3.05, 3.35, z - 0.12, z + 0.12, P["pav_beam"], "wood")
    for x in (-2.85, 2.85):
        box(mb, fr, x - 0.1, x + 0.1, 2.45, 2.75, -3.05, 3.05, P["pav_beam"], "wood")
        box(mb, fr, x - 0.12, x + 0.12, 3.05, 3.35, -3.45, 3.45, P["pav_beam"], "wood")
    # painted bands on the beams (a muted green and red, plain: no pattern)
    for z in (-2.85, 2.85):
        box(mb, fr, -3.0, 3.0, 2.6, 2.7, z - (0.105 if z < 0 else -0.0), z + (0.0 if z < 0 else 0.105), hexc("#3f6b5a"), "paint")
    # rafters: parallel round poles from the plate beam out to the eaves on each side
    eave = 4.0
    ey = 3.2
    for side in range(4):
        sf = F(pc["x"], 0.0, pc["z"], side * math.pi / 2)
        for k in range(-12, 13):
            x = k * 0.3
            tube(mb, sf, (x, 3.2, 2.9), (x, 3.42, eave - 0.1), 0.04, hexc("#6a432a"), "wood", 4, r1=0.035, caps=(False, False))
    # the roof: a pyramidal tile roof (사모지붕), eaves curling up at the corners, a finial on top
    apex_y = 5.7
    ey0 = 3.6

    def roof_pt(side, u, v, lift=0.0):
        # u across the side (-1..1), v from the apex (0) to the eave (1)
        sf = F(pc["x"], 0.0, pc["z"], side * math.pi / 2)
        half = eave
        z = v * half
        x = u * v * half
        # a concave profile: steep at the top, flattening to the eaves, rising at the corners
        prof = (1 - v) ** 1.7
        y = ey0 + (apex_y - ey0) * prof + 0.34 * (abs(u) ** 2.2) * v ** 2.5
        tile = 0.022 * abs(math.sin(math.pi * x / 0.24)) * (1 if v > 0.04 else 0)
        return sf.p(x, y + tile + lift, z)

    for side in range(4):
        L.surface(mb, lambda u, v, s=side: roof_pt(s, u * 2 - 1, v), 20, 7, P["tile"], "tile", up=True, smooth=False,
                  colfn=lambda i, j: P["tile"] if (i % 2) == 0 else P["tile_light"])
        L.surface(mb, lambda u, v, s=side: roof_pt(s, u * 2 - 1, v, -0.1), 8, 4, hexc("#5a3a26"), "wood", up=False)
        # eave end: a vertical tile face and a row of round end tiles along the edge
        for i in range(24):
            ua, ub = (i / 24) * 2 - 1, ((i + 1) / 24) * 2 - 1
            a, b = roof_pt(side, ua, 1.0), roof_pt(side, ub, 1.0)
            mb.quad(a, b, b - Vector((0, 0, 0.13)), a - Vector((0, 0, 0.13)), P["tile_light"], "matte") if False else None
            sf = F(pc["x"], 0.0, pc["z"], side * math.pi / 2)
            m = (a + b) / 2
            mb.quad(b, a, a + Vector((0, 0, -0.13)), b + Vector((0, 0, -0.13)), hexc("#4c3a30"), "matte")
        # ridge (hip) caps
    for side in range(4):
        for sgn in (1,):
            pts = [roof_pt(side, sgn, j / 10, 0.04) for j in range(11)]
            for a, b in zip(pts, pts[1:]):
                tube_pts = L.tube_pts
                tube_pts(mb, a, b, 0.065, 0.065, P["tile_light"], "matte", 6, (False, False))
    # finial (절병): a short mast with stacked bulbs
    for (y, r) in ((apex_y - 0.02, 0.22), (apex_y + 0.18, 0.15), (apex_y + 0.42, 0.11)):
        L.sphere(mb, fr, 0, y, 0, r, P["tile_light"], "matte", seg=10, rings=5)
    tube(mb, fr, (0, apex_y + 0.5, 0), (0, apex_y + 0.95, 0), 0.03, P["tile_light"], "matte", 8, r1=0.01)
    # the four benches (boards, backless) at 2.55 from the centre: 1.9 x 0.45, seat top 0.45
    for side, (bx, bz, yaw) in {"n": (0, -2.55, 0), "s": (0, 2.55, 0), "e": (2.55, 0, math.pi / 2), "w": (-2.55, 0, math.pi / 2)}.items():
        bf = F(pc["x"] + bx, 0.05, pc["z"] + bz, yaw)
        for k in range(3):
            box(mb, bf, -0.95, 0.95, 0.35, 0.4, -0.225 + k * 0.15, -0.225 + k * 0.15 + 0.14, jit(rng, hexc("#a47c4f"), 0.05), "wood")
        for sx in (-0.8, 0.8):
            box(mb, bf, sx - 0.05, sx + 0.05, 0.0, 0.35, -0.2, 0.2, P["pav_wood"], "wood")
    return mb


# ---------------------------------------------------------------------------------------------------- lamps


def lamp(mb, x, z, arm, pile):
    """A timber lamp post with a round enamel shade hanging from a short bracket. `arm` = (dx, dz) metres from the post to the
    shade. A pile lamp (the layout puts three of them in the water beside the pier) stands on a pile to the lake bed and its
    bracket reaches over the deck edge."""
    wood = P["lamp_pole"]
    top = 3.3
    if pile:
        tubew(mb, (x, -1.7, z), (x, top, z), 0.1, wood, "wood", 8, r1=0.085, caps=(False, False))
        tubew(mb, (x, -0.8, z), (x, -0.4, z), 0.13, mulc(wood, 0.6), "wood", 10)  # a worn collar at the water line
    else:
        boxw(mb, x - 0.14, x + 0.14, 0.0, 0.14, z - 0.14, z + 0.14, P["stone"], "matte", skip="D")
        tubew(mb, (x, 0.14, z), (x, top, z), 0.075, wood, "wood", 8, r1=0.06, caps=(False, False))
        tubew(mb, (x, 0.14, z), (x, 0.5, z), 0.095, mulc(wood, 0.8), "wood", 10, r1=0.075)
    tubew(mb, (x, top + 0.02, z), (x, top + 0.07, z), 0.08, P["galv_dark"], "metal", 10)
    ax, az = x + arm[0], z + arm[1]
    tubew(mb, (x, top - 0.02, z), (ax, top - 0.02, az), 0.035, P["galv_dark"], "metal", 8)
    # diagonal strut
    f = 0.55 if math.hypot(*arm) > 0.6 else 0.7
    tubew(mb, (x, top - 0.55, z), (x + arm[0] * f, top - 0.04, z + arm[1] * f), 0.022, P["galv_dark"], "metal", 6)
    # hanger and shade (an inverted enamel bowl) and the bulb under it
    tubew(mb, (ax, top - 0.02, az), (ax, top - 0.16, az), 0.018, P["galv_dark"], "metal", 6)
    sh = F(ax, top - 0.5, az)
    prof = [(0.31, 0.0), (0.30, 0.05), (0.27, 0.13), (0.21, 0.2), (0.13, 0.25), (0.05, 0.28), (0.0, 0.285)]
    L.lathe(mb, sh, prof, 12, P["lamp_shade"], "paint", inner=True)
    tubew(mb, (ax, top - 0.5, az), (ax, top - 0.5 + 0.0, az), 0.31, P["lamp_shade"], "paint", 18, caps=(False, False)) if False else None
    tubew(mb, (ax, top - 0.51, az), (ax, top - 0.49, az), 0.325, P["black"], "metal", 18, caps=(False, False))
    L.sphere(mb, F(ax, top - 0.5, az), 0, 0.02, 0, 0.09, hexc("#fff1c9"), "emit", seg=10, rings=5)
    return (ax, top - 0.47, az)


def nearest_deck_point(x, z):
    best = None
    for d in LAYOUT["decks"]:
        px = min(max(x, d["minX"]), d["maxX"])
        pz = min(max(z, d["minZ"]), d["maxZ"])
        dd = math.hypot(px - x, pz - z)
        if best is None or dd < best[0]:
            best = (dd, px, pz)
    return best


def build_lamps(rng):
    mb = MB("lake_lamps")
    colliders = {c["id"] for c in LAYOUT["colliders"]}
    lights = []
    for i, lp in enumerate(LAYOUT["lamps"], 1):
        x, z = lp["x"], lp["z"]
        pile = f"lamp_{i}" not in colliders
        if pile:
            dd, px, pz = nearest_deck_point(x, z)
            ux, uz = (px - x) / dd, (pz - z) / dd
            arm = (ux * (dd + 0.35), uz * (dd + 0.35))
        else:
            arm = {1: (0.0, 1.3), 5: (0.0, 1.3), 6: (0.0, -1.2)}.get(i, (0.0, 1.2))
        lights.append((i, lamp(mb, x, z, arm, pile)))
    return mb, lights


# ---------------------------------------------------------------------------------------------------- assembly


FACE_DIR = {"n": (0, -1), "s": (0, 1), "e": (1, 0), "w": (-1, 0), "ne": (0.7071, -0.7071), "se": (0.7071, 0.7071)}


def new_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    for c in list(sc.collection.children):
        sc.collection.children.unlink(c)
    return sc


def collection(name, parent=None):
    c = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(c)
    return c


def build_all():
    global COLL, MARK
    sc = new_scene()
    COLL = collection("lake_structures")
    MARK = collection("lake_markers")
    rng = random.Random(2026)
    objs = {}
    stats = {}

    def add(mb, nm=None):
        ob = mb.finish(COLL, nm)
        stats[ob.name] = mb.tris
        objs[ob.name] = ob
        return ob

    add(build_pier(rng))
    add(build_pier_t(rng))
    add(walkway(rng, "walkway_a"))
    add(walkway(rng, "walkway_b"))
    add(jwadae(rng, "jwadae_a", "hut_a", "s"))
    add(jwadae(rng, "jwadae_b", "hut_b", "n"))
    lights = []
    for key in ("jwadae_a", "jwadae_b"):
        mb, info = hut(rng, key)
        add(mb)
        lights.append(("hut_" + key[-1], info["lamp"]))
    add(build_office(rng))
    add(build_rod_rack(rng))
    add(build_vending(rng))
    add(build_bin(rng))
    add(build_trash(rng))
    add(build_nets(rng))
    add(build_chair_stack(rng))
    add(build_info_sign(rng))
    add(build_welcome_sign(rng))
    add(build_pavilion(rng))
    lmb, lamp_lights = build_lamps(rng)
    add(lmb)
    # --- instanced pieces: chairs and stands (30 each), benches (3), picnic tables (2)
    chair_mb = MB("mesh_fishing_chair")
    build_chair(chair_mb)
    chair_me = chair_mb.finish(None, "mesh_fishing_chair").data
    stand_mb = MB("mesh_rod_stand")
    build_stand(stand_mb)
    stand_me = stand_mb.finish(None, "mesh_rod_stand").data
    for ob in list(bpy.context.scene.collection.objects):
        if ob.name.startswith("mesh_"):
            bpy.data.objects.remove(ob)
    bench_mb = MB("mesh_bench")
    build_bench(bench_mb)
    bench_me = bench_mb.finish(None, "mesh_bench").data
    pic_mb = MB("mesh_picnic")
    build_picnic(pic_mb)
    pic_me = pic_mb.finish(None, "mesh_picnic").data
    for ob in list(bpy.context.scene.collection.objects):
        if ob.name.startswith("mesh_"):
            bpy.data.objects.remove(ob)
    rest = {}
    for s in LAYOUT["spots"]:
        fx, fz = FACE_DIR[s["face"]]
        ax, az = s["anchor"]["x"], s["anchor"]["z"]
        instance("chair_" + s["id"], chair_me, COLL, ax - fx * 0.55, az - fz * 0.55, s["yaw"])
        sx, sz = ax - fx * 0.2, az - fz * 0.2
        instance("stand_" + s["id"], stand_me, COLL, sx, sz, s["yaw"])
        fr = F(sx, 0, sz, s["yaw"])
        rest[s["id"]] = (fr.g(0, 0.55, 0.11), fr.g(0, 0.45, -0.11))
    for b in LAYOUT["benches"]:
        instance(b["id"], bench_me, COLL, b["x"], b["z"], math.pi / 2)
    for t in LAYOUT["picnicTables"]:
        instance(t["id"], pic_me, COLL, t["x"], t["z"], 0.0)
    stats["chair_instance_tris"] = chair_mb.tris
    stats["stand_instance_tris"] = stand_mb.tris
    stats["bench_instance_tris"] = bench_mb.tris
    stats["picnic_instance_tris"] = pic_mb.tris

    # --- markers: col__lake_* boxes (heights are the facilities' real heights), seat__lake_*, spot__*, lights, the shopkeeper
    heights = {"shop": 4.9, "hut_a": 3.9, "hut_b": 3.9, "rod_rack": 1.85, "vending": 2.15, "invasive_bin": 1.0, "porch_a": 0.9, "porch_b": 0.9,
               "bench_1": 0.95, "bench_2": 0.95, "bench_3": 0.95, "picnic_1": 0.85, "picnic_2": 0.85}
    for c in LAYOUT["colliders"]:
        cid = c["id"]
        h = heights.get(cid, 0.45 if "pavilion_bench" in cid else 3.3 if cid.startswith("pavilion_post") else 3.4 if cid.startswith("lamp_") else 1.0)
        L.collider(c["node"], c["minX"], c["maxX"], c["minZ"], c["maxZ"], h, MARK)
    for s in LAYOUT["seats"]:
        props = {k: v for k, v in s.items() if k not in ("node", "other", "x", "z", "seatY") and v is not None}
        props["seatTop"] = s["seatY"]
        props["yawRad"] = s["yaw"]
        if s.get("other"):
            props["otherYaw"] = s["other"]["yaw"]
            props["otherStandX"] = s["other"]["standX"]
            props["otherStandZ"] = s["other"]["standZ"]
        props.pop("yaw", None)
        props["yaw"] = s["yaw"]
        L.empty(s["node"], V(s["x"], s["z"], s["seatY"]), MARK, props, 0.18, "ARROWS")
    for s in LAYOUT["spots"]:
        fr_, rr_ = rest[s["id"]]
        props = dict(group=s["group"], face=s["face"], yaw=s["yaw"], floatX=s["float"]["x"], floatZ=s["float"]["z"],
                     restFrontX=round(fr_[0], 3), restFrontY=fr_[1], restFrontZ=round(fr_[2], 3),
                     restRearX=round(rr_[0], 3), restRearY=rr_[1], restRearZ=round(rr_[2], 3))
        L.empty(s["node"], V(s["anchor"]["x"], s["anchor"]["z"], 0.0), MARK, props, 0.2, "CIRCLE")
    for i, p in lamp_lights:
        L.empty(f"light__lake_lamp_{i}", V(p[0], p[2], p[1]), MARK, dict(cat="light", kind="lamp", color="#ffe2a8", intensity=40, distance=14), 0.15, "SPHERE")
    for nm, p in lights:
        L.empty(f"light__lake_{nm}", V(p[0], p[2], p[1]), MARK, dict(cat="light", kind="eave", color="#fff1d0", intensity=12, distance=6), 0.12, "SPHERE")
    sh = LAYOUT["shop"]
    L.empty("light__lake_shop_inside", V((sh["minX"] + sh["maxX"]) / 2, (sh["minZ"] + sh["maxZ"]) / 2 + 0.2, 3.3), MARK, dict(cat="light", kind="fluorescent", color="#f4f8ff", intensity=25, distance=9), 0.15, "SPHERE")
    L.empty("npc__lake_shopkeeper", V((sh["minX"] + sh["maxX"]) / 2, sh["maxZ"] - 1.4, 0.4), MARK, dict(cat="npc", yaw=0.0, note="stands behind the window, faces south"), 0.3, "SINGLE_ARROW")
    return objs, stats


# ---------------------------------------------------------------------------------------------------- preview scene (never exported)


def preview_scene():
    pv = collection("preview_only")
    shore = LAYOUT["shore"]

    def inside(x, z):
        ins = False
        n = len(shore)
        for i in range(n):
            a, b = shore[i], shore[(i + 1) % n]
            if (a["z"] > z) != (b["z"] > z) and x < a["x"] + (z - a["z"]) * (b["x"] - a["x"]) / (b["z"] - a["z"]):
                ins = not ins
        return ins

    import bmesh
    bm = bmesh.new()
    grass = hexc("#5f7f3c")
    verts = {}

    def vv(x, z, y):
        k = (x, z)
        if k not in verts:
            verts[k] = bm.verts.new(V(x, z, y))
        return verts[k]

    step = 2.0
    for xi in range(int((196 - 70) / step)):
        for zi in range(int((52 + 72) / step)):
            x, z = 70 + xi * step, -72 + zi * step
            c = (x + step / 2, z + step / 2)
            if inside(*c) or inside(x, z) or inside(x + step, z) or inside(x, z + step) or inside(x + step, z + step):
                continue
            bm.faces.new([vv(x, z, -0.03), vv(x, z + step, -0.03), vv(x + step, z + step, -0.03), vv(x + step, z, -0.03)])
    me = bpy.data.meshes.new("pv_land")
    bm.to_mesh(me)
    bm.free()
    land = bpy.data.objects.new("pv_land", me)
    m = bpy.data.materials.new("pv_grass")
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = grass
    b.inputs["Roughness"].default_value = 0.95
    me.materials.append(m)
    pv.objects.link(land)
    # water
    bm = bmesh.new()
    vs = [bm.verts.new(V(p["x"], p["z"], -0.55)) for p in shore]
    f = bm.faces.new(vs[::-1])
    bmesh.ops.triangulate(bm, faces=[f])
    for fc in bm.faces:
        if fc.normal.z < 0:
            fc.normal_flip()
    me = bpy.data.meshes.new("pv_water")
    bm.to_mesh(me)
    bm.free()
    wat = bpy.data.objects.new("pv_water", me)
    m2 = bpy.data.materials.new("pv_water")
    m2.use_nodes = True
    b2 = next(n for n in m2.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b2.inputs["Base Color"].default_value = hexc("#2e3d22")
    b2.inputs["Roughness"].default_value = 0.04
    b2.inputs["Metallic"].default_value = 0.0
    me.materials.append(m2)
    pv.objects.link(wat)
    # a dirt trail and the shop's yard, so the facilities do not float in grass
    # hills / forest masses
    rng = random.Random(5)
    for k in range(40):
        a = math.radians(-60 + k * 3.8)
        x = 150 + math.cos(a) * 62 + rng.uniform(-6, 6)
        z = -10 + math.sin(a) * 62 + rng.uniform(-6, 6)
        if x < 120:
            continue
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=rng.uniform(10, 18), location=V(x, z, rng.uniform(2, 7)))
        o = bpy.context.active_object
        o.scale = (1, 1, rng.uniform(0.7, 1.2))
        mm = bpy.data.materials.new("pv_forest%d" % k)
        mm.use_nodes = True
        bb = next(n for n in mm.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        bb.inputs["Base Color"].default_value = hexc(rng.choice(["#2f4a2a", "#35552d", "#3c5c30", "#2a4326"]))
        bb.inputs["Roughness"].default_value = 1.0
        o.data.materials.append(mm)
        for c in o.users_collection:
            c.objects.unlink(o)
        pv.objects.link(o)
    sh_ = LAYOUT["shop"]
    pl = bpy.data.lights.new("pv_shop_light", "AREA")
    pl.energy = 900
    pl.size = 3.0
    po = bpy.data.objects.new("pv_shop_light", pl)
    po.location = V((sh_["minX"] + sh_["maxX"]) / 2, (sh_["minZ"] + sh_["maxZ"]) / 2 + 0.3, 3.45)
    po.rotation_euler = (math.pi, 0, 0)
    pv.objects.link(po)
    # sky
    w = bpy.data.worlds.new("pv_world")
    w.use_nodes = True
    nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    sky = nt.nodes.new("ShaderNodeTexSky")
    try:
        sky.sky_type = "NISHITA"
        sky.sun_elevation = math.radians(48)
        sky.sun_rotation = math.radians(215)
        sky.sun_disc = False
    except Exception:
        pass
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = 1.0
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(sky.outputs[0], bg.inputs[0])
    nt.links.new(bg.outputs[0], out.inputs[0])
    bpy.context.scene.world = w
    sun = bpy.data.lights.new("pv_sun", "SUN")
    sun.energy = 3.2
    sun.angle = math.radians(5)
    so = bpy.data.objects.new("pv_sun", sun)
    so.rotation_euler = (math.radians(48), 0, math.radians(215))
    pv.objects.link(so)
    return pv


def export_glb(path):
    sel = [o for o in bpy.data.objects if o.name != "" and not o.users_collection[0].name.startswith("preview")]
    bpy.ops.object.select_all(action="DESELECT")
    for o in sel:
        o.select_set(True)
    kw = dict(filepath=path, export_format="GLB", use_selection=True, export_extras=True, export_yup=True, export_apply=False, export_image_format="WEBP")
    try:
        bpy.ops.export_scene.gltf(export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
                                  export_draco_position_quantization=14, export_draco_normal_quantization=10,
                                  export_draco_color_quantization=8, export_draco_generic_quantization=12, **kw)
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)


def main():
    objs, stats = build_all()
    if "--no-preview" not in ARGV:
        preview_scene()
    blend = arg("--blend", os.path.join(ROOT, "work", "structures.blend"))
    os.makedirs(os.path.dirname(blend), exist_ok=True)
    sc = bpy.context.scene
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    total = sum(v for k, v in stats.items() if not k.endswith("instance_tris"))
    inst = (stats["chair_instance_tris"] + stats["stand_instance_tris"]) * 30 + stats["bench_instance_tris"] * 3 + stats["picnic_instance_tris"] * 2
    print("TRIS", json.dumps(stats, indent=1), "TOTAL_MERGED", total, "TOTAL_WITH_INSTANCES", total + inst)
    glb = arg("--glb")
    if glb:
        os.makedirs(os.path.dirname(glb), exist_ok=True)
        export_glb(glb)
        print("GLB", glb, os.path.getsize(glb))


main()
