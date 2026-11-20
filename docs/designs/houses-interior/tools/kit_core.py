"""Shared core of the houses-interior furniture kit (Blender 5.x background scripts, game coordinates).

Every kit piece is a function  piece(F, **params)  that draws into the current mesh (begin()/end()) in the local
frame F = Frame(x, z, y0, yaw): local +z is the piece's FRONT, local x runs across it, local y is up, origin = the
middle of its footprint on the floor. Game coords are glTF coords (x east, z south, y up); Blender = (x, -z, y).
Yaw 0 faces +z (south); yaw rotates +z toward +x (east), the same as vlib / the memorial scripts.

Seats, colliders and lights register themselves in the current piece; end() returns the Blender object and keeps the
registries so a driver (kit preview, h01..h10 placement scripts) can turn them into seat__ / col__ / light__ empties.
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

# =====================================================================================================================
# CONTRACT CONSTANTS -- keep every name/format in this block so it is easy to align with P0's contract later.
# (design.md 6.2 / 7.2; P0 may change them: edit here only.)
# =====================================================================================================================
SEAT_PREFIX = "seat__"            # + <prefix>_<k> (+ _face<n|s|e|w>)  e.g. seat__h01_1_3__face s
SEAT_NAME_FMT = "{prefix}_{k}_face{face}"
COL_PREFIX = "col__"              # + <prefix>_<k>
LIGHT_PREFIX = "light__"
SEAT_KIND_BACKED, SEAT_KIND_BACKLESS, SEAT_KIND_FLOOR = "backed", "backless", "floor"
APPROACH_FRONT, APPROACH_ANY, APPROACH_SIDE = "front", "any", "side"       # extras.approach
POSE_CHAIR, POSE_FLOOR, POSE_PERCH = "chair", "floor", "perch"             # extras.pose
SEAT_EXTRA_KEYS = ("furn", "kind", "pose", "approach", "yaw", "edge", "back", "width", "group", "both", "exitTurn", "lean")   # contract: 12 glTF extras
NODE_PREFIX_PIECE = "kit__"       # object name of a preview piece
STAIR_STEPS, STAIR_RISE, STAIR_RUN, STAIR_WIDTH = 17, 0.235, 0.34, 1.3     # 17 x 0.235 = 3.995 m ~ 4.0 m
FLOOR_HEIGHT, CEILING_HEIGHT, WALL_T = 4.0, 3.7, 0.30
SEAT_HEIGHT = 0.45
# =====================================================================================================================

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))          # art/village
TEXH = os.path.join(ROOT, "work", "tex_h")
DL = os.path.join(ROOT, "downloads")
WORK = os.path.join(ROOT, "work")
EXPORT = os.path.join(ROOT, "export")


def V(x, z, y=0.0):
    return Vector((x, -z, y))


def lin(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)


def _l2s(c):
    c = max(0.0, min(1.0, c))
    return c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def tint(h):
    """vertex-colour tint from a #RRGGBB (linear, as the shader multiplies it)"""
    return lin(h)


# tints used by several pieces (linear)
WHITE = (1, 1, 1, 1)
PAL = {k: lin(v) for k, v in dict(
    sofa_grey="#C9C5BC", sofa_beige="#DCD0BC", sofa_sage="#9DAD98", sofa_navy="#44546E", sofa_rust="#B8644A",
    leather_brown="#7A4A2E", leather_tan="#A9763F", leather_black="#2A2523", cream="#F3EDE0", white="#F5F4F0",
    wood_light="#E8D3A8", wood_mid="#C8955B", wood_dark="#7B5236", paint_white="#EFEDE8", paint_black="#262626",
    rug_cream="#E9E2D2", rug_grey="#9C9893", rug_red="#9A4B3D", rug_blue="#4A6685", sage="#8CA38B", mustard="#D6A83A",
    blush="#E8B8B0", sky="#9DC3DE", terracotta="#C0694A", jangpan="#FFFFFF").items()}


# ================================================================================================== materials ====
MATS = {
    "H_plaster": dict(tex="T_h_plaster.png", rough=0.92, tint=True),
    "H_paint": dict(color="#FFFFFF", rough=0.55, tint=True),
    "H_floor_oak": dict(tex="T_h_floor_oak.png", rough=0.42, coat=0.12, tint=True),
    "H_floor_dark": dict(tex="T_h_floor_dark.png", rough=0.4, coat=0.15),
    "H_jangpan": dict(tex="T_h_jangpan.png", rough=0.3, coat=0.3, tint=True),
    "H_tile_white": dict(tex="T_h_tile_white.png", rough=0.25, coat=0.3, tint=True),
    "H_tile_grey": dict(tex="T_h_tile_grey.png", rough=0.4, coat=0.1, tint=True),
    "H_wood_oak": dict(tex="T_h_wood_oak.png", rough=0.5, coat=0.1, tint=True),
    "H_wood_walnut": dict(tex="T_h_wood_walnut.png", rough=0.45, coat=0.15, tint=True),
    "H_wood_pine": dict(tex="T_h_wood_pine.png", rough=0.55, coat=0.05, tint=True),
    "H_wood_dark": dict(tex="T_h_wood_dark.png", rough=0.4, coat=0.2, tint=True),
    "H_fabric": dict(tex="T_h_fabric.png", rough=1.0, tint=True),
    "H_leather": dict(tex="T_h_leather.png", rough=0.45, coat=0.15, tint=True),
    "H_rattan": dict(tex="T_h_rattan.png", rough=0.8, tint=True),
    "H_paper": dict(tex="T_h_paper.png", rough=0.9, glow=0.18),
    "H_bamboo": dict(tex="T_h_bamboo.png", rough=0.7),
    "H_rug": dict(tex="T_h_rug.png", rough=1.0, tint=True),
    "H_lacquer": dict(color="#17110F", rough=0.22, coat=0.6),
    "H_jagae": dict(tex="T_h_jagae.png", rough=0.25, coat=0.5),
    "H_metal": dict(color="#FFFFFF", rough=0.38, metal=0.7, tint=True),
    "H_glass": dict(color="#E8F2F2", rough=0.03, transmission=1.0, ior=1.45),
    "H_mirror": dict(color="#C9D3D6", rough=0.04, metal=1.0),     # mirror glass: opaque, drawn direct (M_mirror / E_H_mirror), the game gives it a room reflection
    "H_ceramic": dict(color="#FFFFFF", rough=0.15, coat=0.5, tint=True),
    "H_lamp": dict(kind="emit", color="#FFE2B8", strength=10.0),
    "H_shade": dict(color="#F2E6CC", rough=0.9, glow=0.0, kind="shade"),
    "H_screen": dict(color="#0B0C0E", rough=0.12, coat=0.4),
    "H_leaf": dict(tex="T_h_leaf.png", rough=0.55, tint=True),
    "H_soil": dict(color="#3A2A20", rough=1.0),
    "H_terracotta": dict(color="#FFFFFF", rough=0.8, tint=True),
    "H_atlas": dict(tex="T_h_atlas.png", rough=0.7),
    "H_plastic": dict(color="#FFFFFF", rough=0.45, tint=True),
    "H_rubber": dict(color="#1D1D1F", rough=0.7),
    "H_stone": dict(color="#8E8B85", rough=0.9, tint=True),
    "H_brick": dict(color="#B4563C", rough=0.9, tint=True),
    "H_floral": dict(tex="T_h_floral.png", rough=0.95, tint=True),   # cottage pass: damask linen (curtains, armchairs, quilts)
    "H_logwall": dict(tex="T_h_logwall.png", rough=0.8, tint=True),   # log cabin walls (10번 집): realism pass
    "H_rock": dict(tex="T_h_stone.png", rough=0.9, tint=True),      # fieldstone (fireplace, chimney breast): realism pass
    "H_check": dict(tex="T_h_check.png", rough=1.0, tint=True),     # layered pass: woven gingham / check linen (armchairs, cushions, curtains)
}
_M = {}


def _img(name, cs="sRGB"):
    p = name if os.path.isabs(name) else os.path.join(TEXH, name)
    im = bpy.data.images.load(p, check_existing=True)
    im.colorspace_settings.name = cs
    return im


# layered pass: the game material is unlit albedo (texture x vertex tint): white-tinted untextured materials are the same thing in the GLB
UNLIT_SAME = {"H_terracotta": "H_paint", "H_metal": "H_paint", "H_ceramic": "H_paint", "H_plastic": "H_paint"}

ALIAS = {"H_screen": "H_rubber", "H_soil": "H_rubber", "H_plastic": "H_ceramic", "H_wood_walnut": "H_wood_dark"}   # HA: <= 24 materials per house


def mat(name):
    name = ALIAS.get(name, name)
    if name in _M:
        return _M[name]
    sp = MATS[name]
    m = bpy.data.materials.new(name)
    m["export"] = name
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    N = nt.nodes.new
    out = N("ShaderNodeOutputMaterial")
    kind = sp.get("kind", "pbr")
    if kind == "emit":
        e = N("ShaderNodeEmission")
        e.inputs["Color"].default_value = lin(sp["color"])
        e.inputs["Strength"].default_value = sp.get("strength", 6.0)
        nt.links.new(e.outputs[0], out.inputs["Surface"])
        _M[name] = m
        return m
    b = N("ShaderNodeBsdfPrincipled")
    col = None
    if "tex" in sp:
        uv = N("ShaderNodeUVMap")
        uv.uv_map = "UVMap"
        t = N("ShaderNodeTexImage")
        t.image = _img(sp["tex"])
        nt.links.new(uv.outputs[0], t.inputs["Vector"])
        col = t.outputs["Color"]
    else:
        b.inputs["Base Color"].default_value = lin(sp.get("color", "#808080"))
    if sp.get("tint"):
        ca = N("ShaderNodeVertexColor")
        ca.layer_name = "Col"
        mx = N("ShaderNodeMix")
        mx.data_type = "RGBA"
        mx.blend_type = "MULTIPLY"
        mx.inputs["Factor"].default_value = 1.0
        if col is not None:
            nt.links.new(col, mx.inputs[6])
        else:
            mx.inputs[6].default_value = lin(sp.get("color", "#FFFFFF"))
        nt.links.new(ca.outputs["Color"], mx.inputs[7])
        col = mx.outputs[2]
    if col is not None:
        nt.links.new(col, b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = sp.get("rough", 0.6)
    b.inputs["Metallic"].default_value = sp.get("metal", 0.0)
    if "coat" in sp:
        b.inputs["Coat Weight"].default_value = sp["coat"]
        b.inputs["Coat Roughness"].default_value = 0.08
    if sp.get("transmission"):
        b.inputs["Transmission Weight"].default_value = sp["transmission"]
        b.inputs["IOR"].default_value = sp.get("ior", 1.45)
    if sp.get("glow") and col is not None:
        nt.links.new(col, b.inputs["Emission Color"])
        b.inputs["Emission Strength"].default_value = sp["glow"]
    if kind == "shade":
        b.inputs["Emission Color"].default_value = lin("#FFE9C2")
        b.inputs["Emission Strength"].default_value = 1.4
    nt.links.new(b.outputs[0], out.inputs["Surface"])
    _M[name] = m
    return m


# ===================================================================================================== frame ======
class Frame:
    """Local frame (x, z, y, yaw). Plain frames are in game (world) coordinates. A frame with ref = (originX, originZ) is in the
    CONTRACT's room-local coordinates (houses_contract.l2w: world x = originX + lx, z = originZ - lz; world yaw = pi - local yaw):
    the points it returns are world points, the local ones are available through loc()."""

    def __init__(self, x=0.0, z=0.0, y=0.0, yaw=0.0, ref=None):
        self.x, self.z, self.y, self.yaw, self.ref = x, z, y, yaw, ref
        self.c, self.s = math.cos(yaw), math.sin(yaw)

    def loc(self, lx, lz):
        """the point in this frame's parent space (room-local for contract frames, world for plain ones)"""
        return (self.x + lx * self.c + lz * self.s, self.z - lx * self.s + lz * self.c)

    def p(self, lx, lz, ly=0.0):
        gx, gz = self.loc(lx, lz)
        if self.ref:
            return (self.ref[0] + gx, self.ref[1] - gz, self.y + ly)
        return (gx, gz, self.y + ly)

    def d(self, lx, lz, ly=0.0):
        dx, dz = lx * self.c + lz * self.s, -lx * self.s + lz * self.c
        return (dx, -dz, ly) if self.ref else (dx, dz, ly)

    def sub(self, lx=0.0, lz=0.0, ly=0.0, yaw=0.0):
        gx, gz = self.loc(lx, lz)
        return Frame(gx, gz, self.y + ly, self.yaw + yaw, self.ref)

    def wyaw(self, rel=0.0):
        """world (game) yaw of this frame's front turned by `rel`"""
        a = self.yaw + rel
        return math.pi - a if self.ref else a


# ====================================================================================================== state ======
class _State:
    mb = None
    name = None
    seats = []
    cols = []
    lights = []
    objs = []
    furn = None       # contract furniture kind of the piece being drawn (seat markers)
    fuv = None        # forced atlas uv (props): every face takes this colour cell and the H_atlas material
    remap = {}        # layered pass: material swaps for the piece being drawn (e.g. an armchair's H_fabric -> H_check)
    pillow_m = None   # layered pass: scatter-cushion material / tints of the house palette
    pillow_tns = None


S = _State()


class MB:
    def __init__(self):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.col = self.bm.loops.layers.color.new("Col")
        self.ex = self.bm.faces.layers.int.new("uvx")
        self.mats = []

    def mi(self, n):
        n = S.remap.get(n, n)
        n = UNLIT_SAME.get(n, n)
        if n not in self.mats:
            self.mats.append(n)
        return self.mats.index(n)

    def face(self, gpts, m, uvs=None, hint=None, smooth=False, tn=None):
        """gpts: game points (x, z, y); hint: game normal (nx, nz, ny); tn: vertex tint"""
        pts = [V(*p) for p in gpts]
        if hint is not None:
            h = Vector((hint[0], -hint[1], hint[2]))
            n = Vector((0, 0, 0))
            for i in range(len(pts)):
                a, b = pts[i], pts[(i + 1) % len(pts)]
                n.x += (a.y - b.y) * (a.z + b.z)
                n.y += (a.z - b.z) * (a.x + b.x)
                n.z += (a.x - b.x) * (a.y + b.y)
            if n.dot(h) < 0:
                pts = pts[::-1]
                if uvs is not None:
                    uvs = uvs[::-1]
        vs = [self.bm.verts.new(p) for p in pts]
        try:
            f = self.bm.faces.new(vs)
        except ValueError:
            for v in vs:
                if not v.link_faces:
                    self.bm.verts.remove(v)
            return None
        f.material_index = self.mi(m)
        f.smooth = smooth
        t = tn or WHITE
        t = tuple(_l2s(c) for c in t[:3]) + (1.0,)
        for i, lp in enumerate(f.loops):
            lp[self.col] = t
            if uvs is not None:
                lp[self.uv].uv = uvs[i]
        f[self.ex] = 1 if uvs is not None else 0
        return f

    def finish(self, name):
        me = bpy.data.meshes.new(name)
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=0.0004)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        for n in self.mats:
            me.materials.append(mat(n))
        ob = bpy.data.objects.new(name, me)
        _auto_uv(ob)
        return ob


def _auto_uv(ob):
    me = ob.data
    uvl = me.uv_layers["UVMap"].data
    ex = me.attributes.get("uvx")
    exv = [0] * len(me.polygons)
    if ex is not None:
        ex.data.foreach_get("value", exv)
    for p in me.polygons:
        if exv[p.index]:
            continue
        n = p.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uvl[li].uv = (co.x, co.y) if ax == 2 else ((co.y, co.z) if ax == 0 else (co.x, co.z))


def begin(name):
    S.mb = MB()
    S.name = name
    S.seats, S.cols, S.lights = [], [], []


def end(coll=None, link=True):
    ob = S.mb.finish(NODE_PREFIX_PIECE + S.name)
    ob["seats"] = json.dumps(S.seats)
    ob["cols"] = json.dumps(S.cols)
    ob["lights"] = json.dumps(S.lights)
    if coll is not None and link:
        coll.objects.link(ob)
    S.mb = None
    return ob


def tri_count(ob):
    me = ob.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)


# ============================================================================================== primitives ========
def gface(F, pts, m, grain=(1, 0, 0), tile=1.0, hint=None, uv=None, tn=None, smooth=False):
    """Local points (lx, lz, ly). grain = local direction texture-u follows; tile = metres per texture repeat."""
    g = [F.p(*q) for q in pts]
    h = F.d(*hint) if hint is not None else None
    if S.fuv is not None:
        m, uv = "H_atlas", [S.fuv] * len(pts)
    if uv is not None:
        uvs = list(uv)
    elif grain is not None:
        gv = Vector(V(*F.d(*grain)) - V(0, 0, 0)).normalized()
        n = (V(*g[1]) - V(*g[0])).cross(V(*g[2]) - V(*g[1]))
        if n.length < 1e-12 and len(g) > 3:
            n = (V(*g[2]) - V(*g[1])).cross(V(*g[3]) - V(*g[2]))
        n.normalize()
        g2 = n.cross(gv)
        if g2.length < 0.35:          # grain (nearly) along the normal: pick a stable in-plane axis
            gv = Vector((1, 0, 0)) if abs(n.x) < 0.9 else Vector((0, 1, 0))
            g2 = n.cross(gv)
        g2.normalize()
        uvs = [(V(*q).dot(gv) / tile, V(*q).dot(g2) / tile) for q in g]
    else:
        uvs = None
    return S.mb.face(g, m, uvs, h, smooth, tn)


def quad(F, a, b, c, d, m, **kw):
    return gface(F, [a, b, c, d], m, **kw)


def rbox(F, x0, x1, z0, z1, y0, y1, m, r=0.01, seg=2, grain=(1, 0, 0), tile=1.0, tn=None, bottom=False, puff=0.0,
         sag=0.0, cuts=0, smooth=False, skip=(), tilt=0.0, taper=0.0, uvc=None):
    """Bevelled box between local corners. puff lifts the top near the edges, sag dips its centre (cushions); cuts
    subdivides the box first so puff/sag have vertices to move. skip = face directions to leave out ('+x','-x','+z',
    '-z','+y','-y')."""
    sx, sz, sy = abs(x1 - x0), abs(z1 - z0), abs(y1 - y0)
    if r < 0.0035 and not (puff or sag or cuts):     # HA triangle budget: a bevel under 3.5 mm is invisible, 26 faces instead of 6
        r = 0
    cuts = min(cuts, 3)
    if r < 0.012:
        seg = 1
    elif r < 0.045:                  # realism pass budget: a 4 cm round-over reads round with 2 segments under the light map
        seg = min(seg, 2)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sz, sy), verts=bm.verts)
    r = min(r, sx / 2 - 1e-4, sz / 2 - 1e-4, sy / 2 - 1e-4)
    if r > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=r, segments=seg, affect="EDGES", profile=0.5)
    if cuts:       # only the big top face gets the grid (puff / sag need vertices to move)
        bm.faces.ensure_lookup_table()
        top = [f for f in bm.faces if f.normal.z > 0.99]
        es = list({e for f in top for e in f.edges})
        bmesh.ops.subdivide_edges(bm, edges=es, cuts=cuts, use_grid_fill=True)
    if puff or sag:
        for v in bm.verts:
            if v.co.z > sy / 2 - r * 1.5:
                kx = 1 - (2 * v.co.x / sx) ** 2
                kz = 1 - (2 * v.co.y / sz) ** 2
                k = max(0.0, kx) * max(0.0, kz)
                # puffy edges, a dip in the middle: seat cushions that have been sat on
                v.co.z += puff * (1 - k) ** 0.5 * 0.0 + puff * min(1.0, k * 1.5) - sag * k ** 2
    if taper:       # narrower top (taper = fraction of the half-width removed at the top), for pillows / trays
        for v in bm.verts:
            k = (v.co.z + sy / 2) / sy
            v.co.x *= 1 - taper * k
    if tilt:        # lean the top toward -z (back) about the bottom centre
        ct, st = math.cos(tilt), math.sin(tilt)
        for v in bm.verts:
            pz = v.co.z + sy / 2
            v.co.y, pz = v.co.y * ct - pz * st, v.co.y * st + pz * ct
            v.co.z = pz - sy / 2
    bm.normal_update()
    cx, cz, cy = (x0 + x1) / 2, (z0 + z1) / 2, min(y0, y1)
    sk = {"+x": (1, 0, 0), "-x": (-1, 0, 0), "+z": (0, 1, 0), "-z": (0, -1, 0), "+y": (0, 0, 1), "-y": (0, 0, -1)}
    skv = [sk[k] for k in skip]
    out = []
    for f in bm.faces:
        n = f.normal
        if not bottom and n.z < -0.99:
            continue
        if any(abs(n.x - a) < 0.2 and abs(n.y - b) < 0.2 and abs(n.z - c) < 0.2 for (a, b, c) in skv):
            continue
        pts = [(cx + v.co.x, cz + v.co.y, cy + v.co.z + sy / 2) for v in f.verts]
        o = gface(F, pts, m, grain, tile, (n.x, n.y, n.z), uv=([uvc] * len(pts) if uvc else None), tn=tn, smooth=smooth)
        out.append(o)
    bm.free()
    return out


def lathe(F, cx, cz, y0, profile, m, segs=24, tn=None, tile=1.0, smooth=True, uvscale=None):
    """Surface of revolution, profile [(r, y)] bottom to top; faces with r = 0 become triangles."""
    rmax = max(r for r, _ in profile)
    if rmax < 0.06:                          # realism pass budget: a cup, a knob, a candle -> 8 sides at most read round at reach
        segs = min(segs, max(6, int(segs * 0.45)))
    elif rmax < 0.3:                         # HA triangle budget: small turned parts need fewer segments
        segs = max(8, int(segs * 0.62))
    rings = [[(cx + r * math.cos(2 * math.pi * i / segs), cz + r * math.sin(2 * math.pi * i / segs), y0 + y)
              for i in range(segs)] for (r, y) in profile]
    for j in range(len(profile) - 1):
        for i in range(segs):
            i2 = (i + 1) % segs
            a, b, c2, d = rings[j][i], rings[j][i2], rings[j + 1][i2], rings[j + 1][i]
            am = 2 * math.pi * (i + 0.5) / segs
            dr = profile[j + 1][0] - profile[j][0]
            dy = profile[j + 1][1] - profile[j][1]
            hint = (math.cos(am) * dy, math.sin(am) * dy, -dr)
            if profile[j][0] == 0:
                pts = [a, c2, d]
            elif profile[j + 1][0] == 0:
                pts = [a, b, c2]
            else:
                pts = [a, b, c2, d]
            if uvscale:
                u0, u1 = i / segs * uvscale[0], (i + 1) / segs * uvscale[0]
                v0, v1 = profile[j][1] * uvscale[1], profile[j + 1][1] * uvscale[1]
                uvs = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
                if len(pts) == 3:
                    uvs = [uvs[0], uvs[2], uvs[3]] if profile[j][0] == 0 else uvs[:3]
                gface(F, pts, m, None, tile, hint, uvs, tn, smooth)
            else:
                gface(F, pts, m, (0, 0, 1), tile, hint, None, tn, smooth)


def cyl(F, cx, cz, y0, y1, r, m, segs=16, r2=None, cap=True, tn=None, bottom=False, uvscale=None):
    r2 = r if r2 is None else r2
    prof = [(r, 0.0), (r2, y1 - y0)]
    if bottom:
        prof = [(0, 0.0)] + prof
    if cap:
        prof = prof + [(0, y1 - y0)]
    lathe(F, cx, cz, y0, prof, m, segs, tn, uvscale=uvscale or (1.0, 1.0))


def tube(F, pts, r, m, segs=8, tn=None, caps=True, uv_per_m=1.0):
    """Round bar along local points (lx, lz, ly); r number or list per point."""
    if max(r if isinstance(r, (int, float)) else max(r) for r in [r]) < 0.045:
        segs = max(4, int(segs * 0.7))
    n = len(pts)
    rs = r if isinstance(r, (list, tuple)) else [r] * n
    rings = []
    P = [Vector(F.p(*q)) for q in pts]
    for i in range(n):
        t = (P[min(i + 1, n - 1)] - P[max(i - 1, 0)]).normalized()
        up = Vector((0, 0, 1)) if abs(t[2]) < 0.95 else Vector((1, 0, 0))
        a = t.cross(up).normalized()
        b = t.cross(a).normalized()
        rings.append([tuple(P[i] + (a * math.cos(2 * math.pi * k / segs) + b * math.sin(2 * math.pi * k / segs)) * rs[i])
                      for k in range(segs)])
    acc = [0.0]
    for i in range(1, n):
        acc.append(acc[-1] + (P[i] - P[i - 1]).length)
    for i in range(n - 1):
        for k in range(segs):
            k2 = (k + 1) % segs
            q = [rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]]
            c0 = sum((Vector(x) for x in q), Vector()) / 4
            mid = (P[i] + P[i + 1]) / 2
            uvs = [(k / segs, acc[i] * uv_per_m), ((k + 1) / segs, acc[i] * uv_per_m),
                   ((k + 1) / segs, acc[i + 1] * uv_per_m), (k / segs, acc[i + 1] * uv_per_m)]
            if S.fuv is not None:
                uvs = [S.fuv] * 4
            S.mb.face(q, "H_atlas" if S.fuv is not None else m, uvs, tuple(c0 - mid), True, tn)
    if caps:
        for end_i, sgn in ((0, -1), (n - 1, 1)):
            t = (P[min(end_i + 1, n - 1)] - P[max(end_i - 1, 0)]).normalized() * sgn
            S.mb.face(rings[end_i], "H_atlas" if S.fuv is not None else m, ([S.fuv] * segs if S.fuv is not None else [(0.5 + 0.5 * math.cos(2 * math.pi * k / segs), 0.5 + 0.5 * math.sin(2 * math.pi * k / segs))
                                       for k in range(segs)]), tuple(t), False, tn)


def bar(F, a, b, w, h, m, up=(0, 0, 1), tn=None, tile=1.0, r=0.0):
    """Rectangular bar between local points a and b, cross-section w (sideways) x h (along `up`, local)."""
    A, B = Vector(a), Vector(b)
    t = (B - A)
    L = t.length
    t.normalize()
    u = Vector(up)
    s = t.cross(u)
    if s.length < 1e-6:
        u = Vector((1, 0, 0))
        s = t.cross(u)
    s.normalize()
    u2 = s.cross(t).normalized()
    corners = []
    for (sa, ua) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        off = s * (sa * w / 2) + u2 * (ua * h / 2)
        corners.append((A + off, B + off))
    faces = [(0, 1), (1, 2), (2, 3), (3, 0)]
    for (i, j) in faces:
        p0, p1 = corners[i], corners[j]
        pts = [tuple(p0[0]), tuple(p1[0]), tuple(p1[1]), tuple(p0[1])]
        nrm = (p0[0] + p1[0] + p0[1] + p1[1]) / 4 - (A + B) / 2
        gface(F, pts, m, grain=tuple(t), tile=tile, hint=tuple(nrm), tn=tn)
    for (pt, sgn) in ((A, -1), (B, 1)):
        pts = [tuple(pt + s * (sa * w / 2) + u2 * (ua * h / 2)) for (sa, ua) in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        gface(F, pts, m, grain=tuple(t), tile=tile, hint=tuple(t * sgn), tn=tn)


def prism(F, poly, y0, y1, m, grain=(1, 0, 0), tile=1.0, tn=None, top=True, bottom=False, side_m=None):
    n = len(poly)
    area = sum(poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1] for i in range(n))
    sg = 1 if area > 0 else -1
    if top:
        gface(F, [(x, z, y1) for x, z in poly], m, grain, tile, (0, 0, 1), tn=tn)
    if bottom:
        gface(F, [(x, z, y0) for x, z in poly], m, grain, tile, (0, 0, -1), tn=tn)
    for i in range(n):
        j = (i + 1) % n
        dx, dz = poly[j][0] - poly[i][0], poly[j][1] - poly[i][1]
        gface(F, [(poly[i][0], poly[i][1], y0), (poly[j][0], poly[j][1], y0), (poly[j][0], poly[j][1], y1),
                  (poly[i][0], poly[i][1], y1)], side_m or m, grain, tile, (dz * sg, -dx * sg, 0), tn=tn)


def prism_v(F, poly, z0, z1, m, tn=None, grain=(1, 0, 0), tile=1.0, side_m=None, front_m=None):
    """extrude a polygon given in the local (x, y) plane (a profile standing up) between local z0 and z1 (back .. front)."""
    n = len(poly)
    area = sum(poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1] for i in range(n))
    sg = 1 if area > 0 else -1
    gface(F, [(x, z1, y) for x, y in poly], front_m or m, grain, tile, (0, 1, 0), tn=tn)
    gface(F, [(x, z0, y) for x, y in poly], m, grain, tile, (0, -1, 0), tn=tn)
    for i in range(n):
        j = (i + 1) % n
        dx, dy = poly[j][0] - poly[i][0], poly[j][1] - poly[i][1]
        gface(F, [(poly[i][0], z0, poly[i][1]), (poly[j][0], z0, poly[j][1]), (poly[j][0], z1, poly[j][1]), (poly[i][0], z1, poly[i][1])],
              side_m or m, grain, tile, (dy * sg, 0, -dx * sg), tn=tn, smooth=True)


def disc(F, cx, cz, y, r, m, segs=24, down=False, tn=None):
    pts = [(cx + r * math.cos(2 * math.pi * i / segs), cz + r * math.sin(2 * math.pi * i / segs), y) for i in range(segs)]
    return gface(F, pts, m, (1, 0, 0), 1.0, (0, 0, -1 if down else 1), tn=tn)


# ================================================================================================= registries ====
def facing_letter(yaw):
    """n|s|e|w of a game yaw (0 = +z = south)"""
    a = (yaw % (2 * math.pi))
    k = int(round(a / (math.pi / 2))) % 4
    return "sewn"[k] if False else ["s", "e", "n", "w"][k]


FURN = {   # kit function name -> contract furn (houses_contract SEAT_FURN_KIND); the seat kind follows from it
    "sofa_fabric": "sofa", "sofa_2seat": "sofa", "sofa_L": "sofa", "sofa_leather": "sofa", "sofa_rattan": "sofa",
    "sofa_floor": "floorsofa", "mattress_sofa": "floorsofa", "armchair_lounge": "armchair", "armchair_reading": "armchair",
    "armchair_rattan": "armchair", "rocking_chair": "armchair", "bean_bag": "beanbag", "chair_dining_wood": "chair",
    "chair_dining_upholstered": "chair", "chair_farm": "chair", "chair_rattan_dining": "chair", "chair_desk": "chair",
    "stool_bar": "barstool", "stool_wood": "stool", "ottoman": "ottoman", "piano_bench": "bench", "bench_log": "bench",
    "bench_dining": "bench", "pyeongsang": "bench", "bed": "bed", "bed_queen": "bed", "bed_single": "bed", "bunk_bed": "bed",
    "window_seat": "windowseat", "bangseok": "cushion", "boryo": "boryo",
}


def seat(F, k, kind, lx, lz, ly=SEAT_HEIGHT, yaw=0.0, edge=0.2, back=0.0, width=0.5, approach=None, pose=POSE_CHAIR,
         count=1, stand=None, furn=None, lean=None, exit_turn=0.0):
    """Seat marker. (lx, lz, ly) = the middle of the seat surface, yaw = which way a sitter faces (relative to the piece),
    edge = distance forward to the front edge, back = distance back to the backrest face (0 if none), width along the seat.
    approach: front (backed) | any (backless) | side. stand = local (x, z) of the stand-up spot (default: in front of the
    front edge). The record keeps both the world values and the room-local ones: house_common feeds the LOCAL ones to
    HouseBuild.seat (the contract's only way to register a seat)."""
    approach = approach or (APPROACH_FRONT if kind in (SEAT_KIND_BACKED,) else APPROACH_ANY)
    x, z, y = F.p(lx, lz, ly)
    llx, llz = F.loc(lx, lz)
    wy = F.wyaw(yaw)
    fx, fz = math.sin(wy), math.cos(wy)
    if stand is None:
        sx, sz = x + fx * (edge + 0.5), z + fz * (edge + 0.5)
    else:
        sx, sz, _ = F.p(stand[0], stand[1], 0)
    if lean is None:
        lean = 0.22 if (kind == SEAT_KIND_BACKED and back > 0) else 0.0
    S.seats.append(dict(k=k, kind=kind, x=round(x, 3), z=round(z, 3), y=round(y, 3), yaw=round(wy, 4),
                        face=facing_letter(wy), approach=approach, pose=pose, frontEdge=round(edge, 3),
                        back=round(back, 3), width=round(width, 3), standX=round(sx, 3), standZ=round(sz, 3),
                        count=count, furn=furn or S.furn, lx=round(llx, 4), lz=round(llz, 4), local_yaw=round(F.yaw + yaw, 5),
                        lean=lean, exitTurn=exit_turn, both=int(kind == SEAT_KIND_BACKLESS and approach == APPROACH_ANY)))


def col(F, lx0, lx1, lz0, lz1, h, name="furn", camera=False):
    xs, zs, lxs, lzs = [], [], [], []
    for (a, b) in ((lx0, lz0), (lx1, lz0), (lx1, lz1), (lx0, lz1)):
        gx, gz, _ = F.p(a, b, 0)
        xs.append(gx)
        zs.append(gz)
        px, pz = F.loc(a, b)
        lxs.append(px)
        lzs.append(pz)
    S.cols.append(dict(name=name, minX=round(min(xs), 3), maxX=round(max(xs), 3), minZ=round(min(zs), 3),
                       maxZ=round(max(zs), 3), h=h, camera=camera, lminX=round(min(lxs), 3), lmaxX=round(max(lxs), 3),
                       lminZ=round(min(lzs), 3), lmaxZ=round(max(lzs), 3)))


def light(F, kind, lx, lz, ly, watts=40.0, color="#FFD9A8"):
    x, z, y = F.p(lx, lz, ly)
    S.lights.append(dict(kind=kind, x=round(x, 3), z=round(z, 3), y=round(y, 3), watts=watts, color=color))


def emit_empties(ob, coll, prefix):
    """seat__ / col__ / light__ empties for a placed piece object (kit preview, house scripts)."""
    for s in json.loads(ob["seats"]):
        nm = SEAT_PREFIX + SEAT_NAME_FMT.format(prefix=prefix, k=s["k"], face=s["face"])
        e = bpy.data.objects.new(nm, None)
        e.empty_display_type = "ARROWS"
        e.empty_display_size = 0.15
        e.location = V(s["x"], s["z"], s["y"])
        e.rotation_euler = (0, 0, s["yaw"])
        ex = dict(furn=s["furn"] or "chair", kind=s["kind"], pose=s["pose"], approach=s["approach"], yaw=s["yaw"], edge=s["frontEdge"],
                  back=s["back"], width=s["width"], group=nm, both=int(s["both"]), exitTurn=s["exitTurn"], lean=s["lean"])
        for key in SEAT_EXTRA_KEYS:
            e[key] = ex[key]
        e["cat"] = "seat"
        coll.objects.link(e)
    for i, c in enumerate(json.loads(ob["cols"])):
        me = bpy.data.meshes.get("__unit_cube")
        if me is None:
            bm = bmesh.new()
            bmesh.ops.create_cube(bm, size=1.0)
            me = bpy.data.meshes.new("__unit_cube")
            bm.to_mesh(me)
            bm.free()
        e = bpy.data.objects.new(f"{COL_PREFIX}{prefix}_{i}", me)
        e.location = V((c["minX"] + c["maxX"]) / 2, (c["minZ"] + c["maxZ"]) / 2, c["h"] / 2)
        e.scale = (c["maxX"] - c["minX"], c["maxZ"] - c["minZ"], c["h"])
        e.display_type = "WIRE"
        e.hide_render = True
        e["camera"] = int(c["camera"])
        coll.objects.link(e)
    for i, l in enumerate(json.loads(ob["lights"])):
        e = bpy.data.objects.new(f"{LIGHT_PREFIX}{l['kind']}_{prefix}_{i}", None)
        e.empty_display_type = "SPHERE"
        e.empty_display_size = 0.1
        e.location = V(l["x"], l["z"], l["y"])
        e["watts"] = l["watts"]
        e["color"] = l["color"]
        coll.objects.link(e)
