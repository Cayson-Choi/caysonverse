"""The village's crosswalk signals — ONE signal unit modelled by script (Blender 5.2, background).

  blender -b --factory-startup -P art/village/tools/build_signals.py -- [--out <glb>] [--renders <dir>] [--lit <state>]

The unit is a Korean mid-block signal post as the traffic-signal manual and the marking/LED standards draw it (research:
scratchpad xwalk/research/spec.md, photos c03 (pedestrian head on a galvanised post), n05 (horizontal head hung from a long
cantilever arm over the lane), c07/c09, drawings o01-o04, o12, o13, o14):
  * a galvanised steel post on a concrete footing and a base flange, tapering from 216 mm to 165 mm, 6.2 m;
  * a cantilever arm (89 -> 76 mm tube, 3.6 m) at 5.75 m over the lane, with a clamp collar at the post;
  * a horizontal 3-lens vehicle head (red, amber, green; 1065 x 355 x 220 mm housing, 300 mm lenses, open visors 240 mm,
    tilted 3 deg down) hung under the arm, lens bottom 5.0 m above the road, facing the approaching traffic (+z);
  * a vertical 3-cell pedestrian head (355 x 710 housing + 355 count-down cell, 300 mm lenses, square U visors tapering to
    40 mm at the bottom, 4 deg down; the red standing figure on top, the green walking figure below it, the count-down
    display under it) on two brackets on the post's side, bottom at 2.1 m, facing across the road (-x), with the blue plate
    over it; no back plates, as on most real heads.
Heads are drawn HEAD_SCALE times life size (the village's avatars are chibi; the bus is life size).

Local frame of the unit (game axes: x east, y up, z south): the post at the origin, the arm toward -x, the vehicle head
over x = -2.85 facing +z, the pedestrian head facing -x. The game places one unit at each corner of a crossing and turns the
inner one half a turn (shared/src/village/crossings.ts).

Meshes the game switches by name (everything else is the fixed body):
  lens_red / lens_amber / lens_green          the vehicle lenses (materials M_lens_red, M_lens_amber, M_lens_green)
  ped_fig_stop / ped_fig_walk                 the two pedestrian figures (M_ped_stop, M_ped_walk)
  countdown_screen                            the count-down cell's display (M_countdown, the game draws the digits)
Their materials are glTF materials whose emissive the game turns up to light a lamp. The rest: sig_zinc (post, arm),
sig_black (housings, visors, brackets), sig_plate (the blue plate), sig_concrete (footing).
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TEX = os.path.join(ROOT, "work", "tex_signals")
EXPORT = os.path.join(ROOT, "export")
# review r2: the village scene was 307.7 k triangles against its 300 k budget with the signals at 3.9 k each: round parts get
# about a third of the segments (at least 8) (a 12-gon post of 0.1 m radius is round at the distances the game looks from)
SEG_SCALE = 0.35


def arg(name, default=None):
    if name in sys.argv:
        return sys.argv[sys.argv.index(name) + 1]
    return default


OUT = arg("--out", os.path.join(EXPORT, "village_signals.glb"))
RENDERS = arg("--renders")
LIT = arg("--lit")  # preview only: which lamps glow in the renders (e.g. "red", "green")

HEAD_SCALE = 1.2
S = HEAD_SCALE


# --------------------------------------------------------------------------------------------- mesh builder --
class Part:
    """Triangles/quads in game axes (x east, y up, z south); converted to Blender's Z-up on creation."""

    def __init__(self, name, mat):
        self.name, self.mat = name, mat
        self.v, self.f = [], []
        self.flat = False  # True: open single quads (plates) keep their winding

    def vert(self, p):
        self.v.append(tuple(p))
        return len(self.v) - 1

    def quad(self, a, b, c, d):
        self.f.append((a, b, c, d))

    def tri(self, a, b, c):
        self.f.append((a, b, c))

    def face(self, pts):
        ids = [self.vert(p) for p in pts]
        self.f.append(tuple(ids))

    # --- primitives, in game axes ---------------------------------------------------------------------------
    def box(self, c, size, bevel=0.0, rot=None):
        """Axis-aligned box about centre c (rot = 3x3 Matrix applied about c)."""
        hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
        pts = [(sx * hx, sy * hy, sz * hz) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
        ids = []
        for p in pts:
            q = Vector(p)
            if rot is not None:
                q = rot @ q
            ids.append(self.vert((c[0] + q.x, c[1] + q.y, c[2] + q.z)))
        # index = sx*4 + sy*2 + sz  (0/1 for -1/+1)
        i = lambda sx, sy, sz: ids[sx * 4 + sy * 2 + sz]
        self.quad(i(0, 0, 0), i(0, 0, 1), i(0, 1, 1), i(0, 1, 0))  # -x
        self.quad(i(1, 0, 0), i(1, 1, 0), i(1, 1, 1), i(1, 0, 1))  # +x
        self.quad(i(0, 0, 0), i(1, 0, 0), i(1, 0, 1), i(0, 0, 1))  # -y
        self.quad(i(0, 1, 0), i(0, 1, 1), i(1, 1, 1), i(1, 1, 0))  # +y
        self.quad(i(0, 0, 0), i(0, 1, 0), i(1, 1, 0), i(1, 0, 0))  # -z
        self.quad(i(0, 0, 1), i(1, 0, 1), i(1, 1, 1), i(0, 1, 1))  # +z

    def tube(self, p0, p1, r0, r1=None, seg=20, caps=True):
        """A (tapered) cylinder from p0 to p1."""
        seg = max(8, int(round(seg * SEG_SCALE)))
        r1 = r0 if r1 is None else r1
        a, b = Vector(p0), Vector(p1)
        ax = (b - a).normalized()
        ref = Vector((0, 1, 0)) if abs(ax.y) < 0.9 else Vector((1, 0, 0))
        u = ax.cross(ref).normalized()
        w = ax.cross(u).normalized()
        ring0, ring1 = [], []
        for k in range(seg):
            t = 2 * math.pi * k / seg
            d = u * math.cos(t) + w * math.sin(t)
            ring0.append(self.vert(a + d * r0))
            ring1.append(self.vert(b + d * r1))
        for k in range(seg):
            n = (k + 1) % seg
            self.quad(ring0[k], ring0[n], ring1[n], ring1[k])
        if caps:
            c0, c1 = self.vert(a), self.vert(b)
            for k in range(seg):
                n = (k + 1) % seg
                self.tri(c0, ring0[n], ring0[k])
                self.tri(c1, ring1[k], ring1[n])

    def to_object(self, parent):
        me = bpy.data.meshes.new(self.name)
        verts = [(x, -z, y) for (x, y, z) in self.v]  # game -> Blender (Z up, -Y = south)
        me.from_pydata(verts, [], self.f)
        me.update()
        if not self.flat:
            bm = bmesh.new()
            bm.from_mesh(me)
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)  # outward, per closed shell
            bm.to_mesh(me)
            bm.free()
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.collection.objects.link(ob)
        ob.parent = parent
        ob.data.materials.append(self.mat)
        return ob


class Frame:
    """A head's frame: canonical local (x right, y up, z out of the face) -> game axes."""

    def __init__(self, origin, forward, up=(0, 1, 0), tilt_deg=0.0):
        f = Vector(forward).normalized()
        u = Vector(up).normalized()
        r = u.cross(f).normalized()
        # tilt: the face looks down by tilt_deg (rotate f and u about r)
        if tilt_deg:
            q = Matrix.Rotation(math.radians(tilt_deg), 3, r)
            f, u = q @ f, q @ u
        self.o, self.r, self.u, self.f = Vector(origin), r, u, f

    def p(self, x, y, z):
        q = self.o + self.r * x + self.u * y + self.f * z
        return (q.x, q.y, q.z)

    def box(self, part, c, size):
        """Box with the frame's orientation, centre c in local coordinates."""
        rot = Matrix(((self.r.x, self.u.x, self.f.x), (self.r.y, self.u.y, self.f.y), (self.r.z, self.u.z, self.f.z)))
        o = self.p(*c)
        part.box(o, size, rot=rot)

    def prism(self, part, poly, z0, z1):
        """Extrude a 2D polygon (x, y in the local frame, counter-clockwise seen from +z) from z0 to z1."""
        n = len(poly)
        a = [part.vert(self.p(x, y, z0)) for x, y in poly]
        b = [part.vert(self.p(x, y, z1)) for x, y in poly]
        part.f.append(tuple(reversed(a)))
        part.f.append(tuple(b))
        for k in range(n):
            m = (k + 1) % n
            part.quad(a[k], a[m], b[m], b[k])

    def prism_zy(self, part, poly, x0, x1):
        """Extrude a polygon given as (z, y) pairs in the local frame from x = x0 to x1."""
        n = len(poly)
        a = [part.vert(self.p(x0, y, z)) for z, y in poly]
        b = [part.vert(self.p(x1, y, z)) for z, y in poly]
        part.f.append(tuple(reversed(a)))
        part.f.append(tuple(b))
        for k in range(n):
            m = (k + 1) % n
            part.quad(a[k], a[m], b[m], b[k])

    def disc(self, part, c, r, z0, z1, seg=28, r1=None):
        """A (tapered) cylinder along the frame's z: radius r at z0, r1 at z1."""
        part.tube(self.p(c[0], c[1], z0), self.p(c[0], c[1], z1), r, r if r1 is None else r1, seg=seg)

    def hood_arc(self, part, c, z0, length, r_in, t, half_deg=145, seg=24):
        """Open visor of a round lens: a tube of radius r_in (thickness t), open for the lower (180-half)*2 degrees."""
        outer, inner = [], []
        seg = max(10, int(round(seg * SEG_SCALE)))
        for k in range(seg + 1):
            a = math.radians(-half_deg + 2 * half_deg * k / seg)  # from the top (angle 0 = +y)
            for ring, r in ((outer, r_in + t), (inner, r_in)):
                x = c[0] + r * math.sin(a)
                y = c[1] + r * math.cos(a)
                ring.append((part.vert(self.p(x, y, z0)), part.vert(self.p(x, y, z0 + length))))
        for k in range(seg):
            (o0a, o0b), (o1a, o1b) = outer[k], outer[k + 1]
            (i0a, i0b), (i1a, i1b) = inner[k], inner[k + 1]
            part.quad(o0a, o1a, o1b, o0b)  # outer skin
            part.quad(i0a, i0b, i1b, i1a)  # inner skin
            part.quad(o0b, o1b, i1b, i0b)  # front rim
            part.quad(o0a, i0a, i1a, o1a)  # back rim
        for ring in (0, seg):  # the two cut ends
            (oa, ob), (ia, ib) = outer[ring], inner[ring]
            if ring == 0:
                part.quad(oa, ob, ib, ia)
            else:
                part.quad(oa, ia, ib, ob)


# ------------------------------------------------------------------------------------------------ materials --
def material(name, color, rough=0.6, metal=0.0, emissive=None, image=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emissive is not None:
        bsdf.inputs["Emission Color"].default_value = (*emissive, 1)
        bsdf.inputs["Emission Strength"].default_value = 1.0
    if image:
        tex = m.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(image)
        m.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return m


def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)


MAT = {}


def make_materials():
    MAT["zinc"] = material("M_sig_zinc", srgb("#A9AFB3"), 0.46, 0.7)
    MAT["black"] = material("M_sig_black", srgb("#0E1013"), 0.6, 0.05)  # review r2: a true black (Pantone 426), it read brown in daylight
    MAT["concrete"] = material("M_sig_concrete", srgb("#9A9893"), 0.9, 0.0)
    MAT["plate"] = material("M_sig_plate", (1, 1, 1), 0.5, 0.0, image=os.path.join(TEX, "T_sig_plate.png"))
    # lenses: the dark glass shows its colour a little when off; the game turns the emissive up when on
    MAT["red"] = material("M_lens_red", srgb("#4A0F15"), 0.18, 0.0)
    MAT["amber"] = material("M_lens_amber", srgb("#4D3409"), 0.18, 0.0)
    MAT["green"] = material("M_lens_green", srgb("#0A3A24"), 0.18, 0.0)
    MAT["ped_stop"] = material("M_ped_stop", srgb("#2E0C0F"), 0.4, 0.0)
    MAT["ped_walk"] = material("M_ped_walk", srgb("#0B2E1B"), 0.4, 0.0)
    MAT["countdown"] = material("M_countdown", srgb("#0B0C0E"), 0.3, 0.0)
    MAT["lens_back"] = material("M_sig_lensback", srgb("#08090B"), 0.25, 0.0)


# ------------------------------------------------------------------------------------------------ the unit --
POST_H = 6.2
ARM_Y = 5.75
ARM_L = 3.6
HEAD_X = -2.85  # the vehicle head's centre (over the lane)
VEH_BOTTOM = 5.0
PED_BOTTOM = 2.1


def build_post(parts):
    zinc, conc = parts["zinc"], parts["concrete"]
    # footing, flange, bolts, taper
    conc.tube((0, 0, 0), (0, 0.10, 0), 0.26, 0.24, seg=24)
    zinc.tube((0, 0.10, 0), (0, 0.14, 0), 0.19, 0.19, seg=24)
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        zinc.tube((0.15 * math.cos(a), 0.14, 0.15 * math.sin(a)), (0.15 * math.cos(a), 0.19, 0.15 * math.sin(a)), 0.016, 0.016, seg=8)
    zinc.tube((0, 0.14, 0), (0, 0.55, 0), 0.118, 0.110, seg=24)  # base sleeve
    zinc.tube((0, 0.55, 0), (0, POST_H, 0), 0.108, 0.082, seg=24)
    zinc.tube((0, POST_H, 0), (0, POST_H + 0.06, 0), 0.082, 0.05, seg=24)
    zinc.tube((0, POST_H + 0.06, 0), (0, POST_H + 0.1, 0), 0.05, 0.0, seg=24)
    # clamp bands (the photo's strapped joints)
    for y in (1.2, 2.4, 3.6, 4.8):
        zinc.tube((0, y, 0), (0, y + 0.05, 0), 0.113 - 0.005 * (y - 1.2) / 3.6 * 6, 0.113 - 0.005 * (y - 1.2) / 3.6 * 6, seg=24)
    # arm: collar, tapered tube, end cap, a brace
    zinc.tube((0, ARM_Y - 0.12, 0), (0, ARM_Y + 0.12, 0), 0.128, 0.128, seg=24)  # collar on the post
    zinc.tube((-0.05, ARM_Y, 0), (-ARM_L, ARM_Y, 0), 0.0445, 0.038, seg=18)
    zinc.tube((-ARM_L, ARM_Y, 0), (-ARM_L - 0.03, ARM_Y, 0), 0.038, 0.0, seg=18)
    # a short brace from the post's top part to the arm (the manual's mast arm drawing)
    zinc.tube((0, ARM_Y + 0.55, 0), (-1.25, ARM_Y + 0.03, 0), 0.022, 0.022, seg=10)


def build_vehicle_head(parts):
    """Horizontal head, centre over HEAD_X, facing +z, 3 deg down."""
    black = parts["black"]
    fr = Frame((HEAD_X, VEH_BOTTOM + 0.355 * S / 2, 0), (0, 0, 1), tilt_deg=3.0)
    W, H, D = 1.065 * S, 0.355 * S, 0.22 * S
    # housing: three cells joined, a slim waist between lenses
    fr.box(black, (0, 0, -D / 2), (W, H, D))
    fr.box(black, (0, 0, 0.004), (W * 0.985, H * 0.94, 0.012))  # a lip on the face
    cell = 0.355 * S
    for i, name in enumerate(("red", "amber", "green")):
        cx = (i - 1) * cell
        r = 0.150 * S
        # bezel ring + recessed lens disc + the dark lens back behind it
        fr.disc(black, (cx, 0), r + 0.014 * S, 0.0, 0.016, seg=28)
        lens = parts["lens_" + name]
        fr.disc(lens, (cx, 0), r, 0.016, 0.022, seg=28, r1=r * 0.94)  # slightly domed face
        fr.disc(parts["lens_back"], (cx, 0), r * 0.98, 0.012, 0.017, seg=28)
        # open visor, 240 mm long, open below
        fr.hood_arc(black, (cx, 0), 0.0, 0.24 * S, r + 0.018 * S, 0.012 * S, half_deg=140)
    # two hangers from the arm (short tubes) and a pair of clamps
    for dx in (-0.40 * S, 0.40 * S):
        black.tube((HEAD_X + dx, VEH_BOTTOM + H + 0.01, 0), (HEAD_X + dx, ARM_Y - 0.04, 0), 0.022, 0.022, seg=10)
        black.tube((HEAD_X + dx, ARM_Y - 0.06, 0), (HEAD_X + dx, ARM_Y + 0.06, 0), 0.05, 0.05, seg=14)
    # a bracket plate behind the head
    fr.box(black, (0, H / 2 + 0.01, -D / 2), (0.34 * S, 0.02, D * 0.8))


def figure_stop(fr, part, z0, z1):
    """Standing figure: head, torso, arms, legs; 240 mm tall at S, centred at the cell centre."""
    k = S

    def rect(x0, y0, x1, y1):
        fr.prism(part, [(x0 * k, y0 * k), (x1 * k, y0 * k), (x1 * k, y1 * k), (x0 * k, y1 * k)], z0, z1)

    def disc(cx, cy, r, n=12):
        fr.prism(part, [(cx * k + r * k * math.cos(2 * math.pi * i / n), cy * k + r * k * math.sin(2 * math.pi * i / n)) for i in range(n)], z0, z1)

    disc(0, 0.097, 0.024)
    rect(-0.030, -0.006, 0.030, 0.068)  # torso
    rect(-0.056, -0.012, -0.034, 0.062)  # arms
    rect(0.034, -0.012, 0.056, 0.062)
    rect(-0.029, -0.120, -0.003, -0.004)  # legs
    rect(0.003, -0.120, 0.029, -0.004)


def figure_walk(fr, part, z0, z1):
    """Walking figure: head, leaning torso, striding legs, swinging arms."""
    k = S

    def bar(p0, p1, w):
        (x0, y0), (x1, y1) = p0, p1
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy)
        nx, ny = -dy / L * w / 2, dx / L * w / 2
        pts = [(x0 + nx, y0 + ny), (x0 - nx, y0 - ny), (x1 - nx, y1 - ny), (x1 + nx, y1 + ny)]
        fr.prism(part, [(x * k, y * k) for x, y in pts], z0, z1)

    def disc(cx, cy, r, n=12):
        fr.prism(part, [((cx + r * math.cos(2 * math.pi * i / n)) * k, (cy + r * math.sin(2 * math.pi * i / n)) * k) for i in range(n)], z0, z1)

    disc(0.012, 0.098, 0.024)
    bar((0.0, 0.075), (-0.004, -0.004), 0.052)  # torso
    bar((0.006, 0.062), (0.052, 0.012), 0.020)  # front arm
    bar((-0.006, 0.062), (-0.050, 0.018), 0.020)  # back arm
    bar((0.004, -0.004), (0.050, -0.120), 0.028)  # front leg
    bar((-0.004, -0.004), (-0.052, -0.116), 0.028)  # back leg
    bar((0.050, -0.114), (0.066, -0.118), 0.016)  # front foot


def _shift(fr, dx, dy):
    """A frame like fr moved by (dx, dy) in its own plane."""
    n = Frame(fr.p(dx, dy, 0.0), fr.f)
    n.r, n.u, n.f = fr.r.copy(), fr.u.copy(), fr.f.copy()
    return n


def build_ped_head(parts):
    """Vertical 3-cell head (stop figure, walk figure, count-down), facing -x, on two brackets at the post's side."""
    black = parts["black"]
    cell = 0.355 * S
    D = 0.22 * S
    top = PED_BOTTOM + 3 * cell
    cx, cz = -0.46, -0.40  # the head's centre (x: depth direction), offset toward the crossing
    # frame: the face looks -x; local x (right) = +z
    fr0 = Frame((cx, PED_BOTTOM + 1.5 * cell, cz), (-1, 0, 0), tilt_deg=4.0)
    fr0.box(black, (0, 0, -D / 2), (cell, 3 * cell, D))  # housing
    for i, n in enumerate(("stop", "walk", "count")):
        y = (1 - i) * cell  # top cell at +cell
        fr0.box(black, (0, y, 0.002), (cell * 0.96, cell * 0.96, 0.012))  # face rim
        fr0.box(parts["lens_back"], (0, y, 0.010), (0.30 * S, 0.30 * S, 0.006))  # the dark lens
        # square U visor: top plate and two sides, 200 mm long at the top tapering to 120 mm at the bottom (as drawn, o13/o14)
        L_top, L_bot, t, hw = 0.22 * S, 0.10 * S, 0.012 * S, cell / 2
        fr0.box(black, (0, y + hw - t / 2, L_top / 2), (cell, t, L_top))
        for sx in (-1, 1):
            xc = sx * (hw - t / 2)
            fr0.prism_zy(black, [(0.0, y + hw), (L_top, y + hw), (L_bot, y - hw), (0.0, y - hw)], xc - t / 2, xc + t / 2)
        fc = _shift(fr0, 0, y)
        if n == "stop":
            figure_stop(fc, parts["ped_stop"], 0.011, 0.020)
        elif n == "walk":
            figure_walk(fc, parts["ped_walk"], 0.011, 0.020)
        else:
            sc = parts["countdown"]  # the count-down display, UV 0..1: the game paints the digits on it
            w = 0.27 * S
            ids = [sc.vert(fr0.p(sx * w / 2, y + sy * w / 2, 0.0135)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
            sc.quad(*ids)
            sc.uvq = [(0, 0), (1, 0), (1, 1), (0, 1)]
    # two brackets from the post to the housing's back, with their clamp bands
    for yy in (PED_BOTTOM + 0.18 * S, top - 0.18 * S):
        black.tube((-0.09, yy, -0.02), (cx + D * 0.7, yy, cz + 0.15), 0.022, 0.022, seg=10)
        black.tube((0.0, yy - 0.05, 0), (0.0, yy + 0.05, 0), 0.118, 0.118, seg=24)
    # review r2: no blue plate. On a real crossing the blue "보행자작동신호기" plate belongs to the push-button signals only
    # (the game has no button), so the head stands without one.
    return
    # the blue plate over the head on a small arm
    plate = parts["plate"]
    pw, ph = 0.56 * S * 0.9, 0.19 * S * 0.9
    py = top + 0.10 * S + ph / 2
    pf = Frame((cx - 0.02, py, cz), (-1, 0, 0))
    black.tube((-0.09, py - 0.05, 0), (cx + 0.10, py - 0.05, cz + 0.12), 0.014, 0.014, seg=8)
    black.tube((0.0, py - 0.10, 0), (0.0, py, 0), 0.118, 0.118, seg=24)
    pf.box(black, (0, 0, -0.012), (pw + 0.02, ph + 0.02, 0.014))
    ids = [plate.vert(pf.p(sx * pw / 2, sy * ph / 2, 0.0)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    plate.quad(*ids)
    plate.uvq = [(0, 0), (1, 0), (1, 1), (0, 1)]


# ------------------------------------------------------------------------------------------------ run --
def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    make_materials()
    root = bpy.data.objects.new("signal_unit", None)
    bpy.context.collection.objects.link(root)
    spec = {
        "zinc": ("sig_zinc", "zinc"),
        "black": ("sig_black", "black"),
        "concrete": ("sig_concrete", "concrete"),
        "plate": ("sig_plate", "plate"),
        "lens_back": ("sig_lensback", "lens_back"),
        "lens_red": ("lens_red", "red"),
        "lens_amber": ("lens_amber", "amber"),
        "lens_green": ("lens_green", "green"),
        "ped_stop": ("ped_fig_stop", "ped_stop"),
        "ped_walk": ("ped_fig_walk", "ped_walk"),
        "countdown": ("countdown_screen", "countdown"),
    }
    parts = {k: Part(n, MAT[m]) for k, (n, m) in spec.items()}
    build_post(parts)
    build_vehicle_head(parts)
    build_ped_head(parts)
    objs = {}
    for k, p in parts.items():
        ob = p.to_object(root)
        objs[k] = ob
        me = ob.data
        uvq = getattr(p, "uvq", None)
        if uvq:
            uv = me.uv_layers.new(name="UVMap")
            for poly in me.polygons:
                for li, vi in zip(poly.loop_indices, poly.vertices):
                    uv.data[li].uv = uvq[p.f[poly.index].index(vi)] if len(uvq) == 4 else (0, 0)
        for poly in me.polygons:
            poly.use_smooth = True
        me.set_sharp_from_angle(angle=math.radians(40))
    return root, objs


def export(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
                              export_texcoords=True, export_normals=True, export_materials="EXPORT", export_image_format="AUTO",
                              export_cameras=False, export_lights=False)


def preview(dirpath, lit):
    """Cycles stills of the unit (not exported): the pedestrian head close, the vehicle head close, the whole post."""
    os.makedirs(dirpath, exist_ok=True)
    sc = bpy.context.scene
    try:
        sc.render.engine = "CYCLES"
        sc.cycles.samples = 24
        sc.cycles.device = "CPU"
    except Exception:
        pass
    sc.render.resolution_x, sc.render.resolution_y = 720, 900
    sc.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
    bg.inputs["Strength"].default_value = 1.1
    sc.world = world
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 4.0
    so = bpy.data.objects.new("sun", sun)
    bpy.context.collection.objects.link(so)
    so.rotation_euler = (math.radians(55), 0, math.radians(-35))
    # ground
    bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, 0))
    bpy.context.object.data.materials.append(material("ground", srgb("#7d8a6a"), 0.9))
    # lit lamps: emissive on in the preview only
    glow = {"red": ("M_lens_red", "#ff2a30", 14), "amber": ("M_lens_amber", "#ffb000", 14), "green": ("M_lens_green", "#30ff80", 14),
            "stop": ("M_ped_stop", "#ff2a30", 14), "walk": ("M_ped_walk", "#30ff80", 14)}
    for key in (lit or "").split(","):
        if key in glow:
            m = bpy.data.materials[glow[key][0]]
            b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
            b.inputs["Emission Color"].default_value = (*srgb(glow[key][1]), 1)
            b.inputs["Emission Strength"].default_value = glow[key][2]
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    bpy.context.collection.objects.link(cam)
    sc.camera = cam

    def shot(name, loc, target, lens=50):
        cam.location = (loc[0], -loc[2], loc[1])
        cam.data.lens = lens
        d = Vector((target[0], -target[2], target[1])) - Vector(cam.location)
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        sc.render.filepath = os.path.join(dirpath, name)
        bpy.ops.render.render(write_still=True)

    shot("ped_front.png", (-4.2, 2.65, -0.4), (-0.46, 2.65, -0.4), 50)
    shot("veh_front.png", (-2.85, 5.25, 7.0), (-2.85, 5.2, 0), 50)
    shot("unit_far.png", (-9.0, 3.4, 8.5), (-1.2, 3.1, 0), 30)
    shot("unit_back.png", (6.5, 4.6, -7.5), (-1.2, 3.8, 0), 32)


if __name__ == "__main__":
    root, objs = build()
    export(OUT)
    print("exported", OUT)
    if RENDERS:
        preview(RENDERS, LIT)
