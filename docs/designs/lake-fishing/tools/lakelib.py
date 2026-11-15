"""Mesh helpers for the lake facilities (chunk B). Everything is built in GAME coordinates (x east, z south, y up, metres,
the walking floor y = 0, the water y = -0.55) and converted once to Blender (X, Y, Z) = (x, -z, y). The two frames are both
right handed, so faces wound counter-clockwise seen from outside stay that way.

Colours are written per corner into a FLOAT_COLOR attribute "Col" (exported as COLOR_0) and multiply the white base colour of
the five shared materials, so a whole facility is a handful of draw calls.
"""
import bpy
import bmesh
import math
import os
import random
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
FONT_JUA = None
for cand in (os.path.join(HERE, "..", "..", "village", "fonts", "Jua-Regular.ttf"), os.path.join(HERE, "fonts", "Jua-Regular.ttf"), os.environ.get("LAKE_FONT", "")):
    if cand and os.path.exists(cand):
        FONT_JUA = os.path.abspath(cand)
        break


def V(x, z, y=0.0):
    return Vector((x, -z, y))


def _lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexc(h, a=1.0):
    h = h.lstrip("#")
    return (_lin(int(h[0:2], 16) / 255), _lin(int(h[2:4], 16) / 255), _lin(int(h[4:6], 16) / 255), a)


def mulc(c, f):
    return (min(1.0, c[0] * f), min(1.0, c[1] * f), min(1.0, c[2] * f), c[3])


def jit(rng, c, amt=0.08):
    f = 1.0 + (rng.random() * 2 - 1) * amt
    return mulc(c, f)


# --------------------------------------------------------------------------------------------------- frames


class F:
    """A local frame on the ground: origin (x, y, z) in game coordinates, yaw = game yaw (0 faces +z, pi/2 faces +x).
    Local +z is the facing, local +x is the same turn of east, local +y is up (same convention as lakeLayout offsetAt)."""

    def __init__(self, x=0.0, y=0.0, z=0.0, yaw=0.0):
        self.x, self.y, self.z, self.yaw = x, y, z, yaw
        self.c, self.s = math.cos(yaw), math.sin(yaw)

    def g(self, lx, ly, lz):
        return (self.x + lx * self.c + lz * self.s, self.y + ly, self.z - lx * self.s + lz * self.c)

    def p(self, lx, ly, lz):
        gx, gy, gz = self.g(lx, ly, lz)
        return Vector((gx, -gz, gy))

    def sub(self, lx, ly, lz, dyaw=0.0):
        gx, gy, gz = self.g(lx, ly, lz)
        return F(gx, gy, gz, self.yaw + dyaw)


WORLD = F()

# --------------------------------------------------------------------------------------------------- materials

MATS = {}
TEXDIR = os.environ.get("LAKE_TEX") or os.path.join(HERE, "..", "work", "tex")
# key: roughness, metal, optional texture file, tile size in metres (u, v), random UV offset per face
MAT_SPEC = {
    "matte": dict(rough=0.85, metal=0.0),
    "wood": dict(rough=0.75, metal=0.0, tex="grain", tile=(0.7, 0.7), jitter=True),
    "paint": dict(rough=0.45, metal=0.0, tex="paint", tile=(1.2, 1.2), jitter=True),
    "metal": dict(rough=0.4, metal=0.85, tex="metal", tile=(0.8, 0.8), jitter=True),
    "log": dict(rough=0.9, metal=0.0, tex="log_wall", tile=(1.0, 0.68)),
    "siding": dict(rough=0.75, metal=0.0, tex="siding", tile=(1.1, 1.1)),
    "tile": dict(rough=0.8, metal=0.0, tex="tile", tile=(1.4, 1.4), jitter=True),
    "concrete": dict(rough=0.9, metal=0.0, tex="concrete", tile=(1.5, 1.5), jitter=True),
    "fabric": dict(rough=0.95, metal=0.0, tex="fabric", tile=(0.2, 0.2)),
    "sign": dict(rough=0.55, metal=0.0, tex="signs", tile=(1.0, 1.0), explicit=True),
    "glass": dict(rough=0.05, metal=0.0, alpha=0.12, tint=(0.8, 0.9, 0.92)),
    "emit": dict(rough=0.5, metal=0.0, emit=((1.0, 0.86, 0.55), 3.0)),
    "emit_white": dict(rough=0.5, metal=0.0, emit=((1.0, 1.0, 0.97), 2.2)),
}


def material(key):
    if key in MATS:
        return MATS[key]
    sp = MAT_SPEC[key]
    m = bpy.data.materials.new("M_lake_" + key)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = sp["rough"]
    bsdf.inputs["Metallic"].default_value = sp["metal"]
    if "emit" in sp:
        col, strength = sp["emit"]
        bsdf.inputs["Base Color"].default_value = (0.02, 0.02, 0.02, 1)
        bsdf.inputs["Emission Color"].default_value = (*col, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    elif "tint" in sp:
        bsdf.inputs["Base Color"].default_value = (*sp["tint"], 1.0)
        bsdf.inputs["Alpha"].default_value = sp["alpha"]
        try:
            m.surface_render_method = "BLENDED"
        except Exception:
            pass
        try:
            m.blend_method = "BLEND"
        except Exception:
            pass
    else:
        ca = nt.nodes.new("ShaderNodeVertexColor")
        ca.layer_name = "Col"
        if "tex" in sp:
            tx = nt.nodes.new("ShaderNodeTexImage")
            tx.image = bpy.data.images.load(os.path.abspath(os.path.join(TEXDIR, sp["tex"] + ".png")), check_existing=True)
            tx.image.colorspace_settings.name = "sRGB"
            mix = nt.nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mix.inputs["Factor"].default_value = 1.0
            nt.links.new(ca.outputs["Color"], mix.inputs["A"])
            nt.links.new(tx.outputs["Color"], mix.inputs["B"])
            nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
        else:
            nt.links.new(ca.outputs["Color"], bsdf.inputs["Base Color"])
    if "tint" not in sp:
        m.use_backface_culling = True
    MATS[key] = m
    return m


MAT_ORDER = list(MAT_SPEC.keys())


# --------------------------------------------------------------------------------------------------- mesh builder


class MB:
    """Accumulates faces; finish() turns them into one object with a material slot per material used."""

    def __init__(self, name, ao_under=0.62):
        self.name = name
        self.v = []
        self.col = []
        self.faces = []  # (idx tuple, matkey, smooth)
        self.ao_under = ao_under
        self.tris = 0

    def verts(self, pts, col):
        base = len(self.v)
        for p in pts:
            self.v.append((p.x, p.y, p.z))
            c = col
            if self.ao_under < 1.0 and p.z < -0.06:
                c = mulc(col, self.ao_under)
            self.col.append(c)
        return list(range(base, base + len(pts)))

    def face(self, idx, mat="matte", smooth=False, uv=None):
        self.faces.append((tuple(idx), mat, smooth, uv))
        self.tris += len(idx) - 2

    def quad_uv(self, p0, p1, p2, p3, uvs, col, mat="sign"):
        self.face(self.verts([p0, p1, p2, p3], col), mat, False, uvs)

    def quad(self, p0, p1, p2, p3, col, mat="matte"):
        self.face(self.verts([p0, p1, p2, p3], col), mat)

    def tri(self, p0, p1, p2, col, mat="matte"):
        self.face(self.verts([p0, p1, p2], col), mat)

    def poly(self, pts, col, mat="matte"):
        self.face(self.verts(pts, col), mat)

    def finish(self, collection=None, name=None):
        name = name or self.name
        me = bpy.data.meshes.new(name)
        keys = [k for k in MAT_ORDER if any(f[1] == k for f in self.faces)]
        sp = MAT_SPEC
        for k in keys:
            me.materials.append(material(k))
        me.from_pydata([tuple(v) for v in self.v], [], [f[0] for f in self.faces])
        for poly, f in zip(me.polygons, self.faces):
            poly.material_index = keys.index(f[1])
            poly.use_smooth = f[2]
        attr = me.attributes.new("Col", "FLOAT_COLOR", "CORNER")
        flat = []
        for lp in me.loops:
            c = self.col[lp.vertex_index]
            flat.extend((c[0], c[1], c[2], c[3]))
        attr.data.foreach_set("color", flat)
        # UV0: box projection in metres / tile size (random offset per face for grainy materials), or explicit
        uvl = me.uv_layers.new(name="UVMap")
        for poly, f in zip(me.polygons, self.faces):
            key = keys[poly.material_index]
            spec = sp[key]
            if f[3] is not None:
                for li, uv in zip(poly.loop_indices, f[3]):
                    uvl.data[li].uv = uv
                continue
            n = poly.normal
            ax = max(range(3), key=lambda k: abs(n[k]))
            tu, tv = spec.get("tile", (1.0, 1.0))
            ox = oy = 0.0
            if spec.get("jitter"):
                h = (poly.index * 2654435761) & 0xFFFFFFFF
                ox, oy = (h & 0xFFFF) / 65535.0, (h >> 16) / 65535.0
            for li in poly.loop_indices:
                c = me.vertices[me.loops[li].vertex_index].co
                if ax == 2:
                    u, v = c.x, c.y
                elif ax == 0:
                    u, v = c.y, c.z
                else:
                    u, v = c.x, c.z
                uvl.data[li].uv = (u / tu + ox, v / tv + oy)
        me.update()
        ob = bpy.data.objects.new(name, me)
        (collection or bpy.context.scene.collection).objects.link(ob)
        # UV1: a lightmap layout, non-overlapping inside this object (A packs the objects into the atlas)
        try:
            lm = me.uv_layers.new(name="UVMap_LM")
            me.uv_layers.active = lm
            bpy.context.view_layer.objects.active = ob
            for o in bpy.context.view_layer.objects:
                o.select_set(False)
            ob.select_set(True)
            bpy.ops.object.mode_set(mode="EDIT")
            bpy.ops.mesh.select_all(action="SELECT")
            bpy.ops.uv.lightmap_pack(PREF_CONTEXT="ALL_FACES", PREF_PACK_IN_ONE=True, PREF_NEW_UVLAYER=False, PREF_BOX_DIV=18, PREF_MARGIN_DIV=0.1)
            bpy.ops.object.mode_set(mode="OBJECT")
            me.uv_layers.active = me.uv_layers["UVMap"]
        except Exception as e:  # keep going without the second set
            print("LM UV failed", name, e)
            try:
                bpy.ops.object.mode_set(mode="OBJECT")
            except Exception:
                pass
        return ob


# --------------------------------------------------------------------------------------------------- primitives

BOX_FACES = {
    "R": (1, 3, 7, 5),  # +x
    "L": (0, 4, 6, 2),  # -x
    "U": (2, 6, 7, 3),  # +y
    "D": (0, 1, 5, 4),  # -y
    "F": (4, 5, 7, 6),  # +z
    "B": (0, 2, 3, 1),  # -z
}


def hexa(mb, pts, col, mat="matte", skip=""):
    """A hexahedron from 8 world (Blender) points indexed bit0 = x, bit1 = y, bit2 = z of its own box."""
    for k, ix in BOX_FACES.items():
        if k in skip:
            continue
        mb.face(mb.verts([pts[i] for i in ix], col), mat)


def box(mb, fr, x0, x1, y0, y1, z0, z1, col, mat="matte", skip=""):
    pts = [fr.p(x1 if i & 1 else x0, y1 if i & 2 else y0, z1 if i & 4 else z0) for i in range(8)]
    hexa(mb, pts, col, mat, skip)


def boxw(mb, x0, x1, y0, y1, z0, z1, col, mat="matte", skip=""):
    """A box in plain game coordinates."""
    box(mb, WORLD, x0, x1, y0, y1, z0, z1, col, mat, skip)


def _basis(a):
    a = a.normalized()
    h = Vector((0, 0, 1)) if abs(a.z) < 0.9 else Vector((1, 0, 0))
    u = a.cross(h).normalized()
    w = a.cross(u)  # u x w = a
    return u, w, a


def tube_pts(mb, P0, P1, r0, r1, col, mat="metal", sides=8, caps=(True, True), smooth=True):
    """A (tapered) tube between two Blender points."""
    a = P1 - P0
    if a.length < 1e-6:
        return
    u, w, ah = _basis(a)
    ring0, ring1 = [], []
    for i in range(sides):
        t = 2 * math.pi * i / sides
        d = u * math.cos(t) + w * math.sin(t)
        ring0.append(P0 + d * r0)
        ring1.append(P1 + d * r1)
    i0 = mb.verts(ring0, col)
    i1 = mb.verts(ring1, col)
    for i in range(sides):
        j = (i + 1) % sides
        mb.face((i0[i], i0[j], i1[j], i1[i]), mat, smooth)
    if caps[0] and r0 > 0:
        mb.face(tuple(reversed(mb.verts(ring0, col))), mat)
    if caps[1] and r1 > 0:
        mb.face(tuple(mb.verts(ring1, col)), mat)


def tube(mb, fr, p0, p1, r0, col, mat="metal", sides=8, r1=None, caps=(True, True), smooth=True):
    tube_pts(mb, fr.p(*p0), fr.p(*p1), r0, r0 if r1 is None else r1, col, mat, sides, caps, smooth)


def tubew(mb, p0, p1, r0, col, mat="metal", sides=8, r1=None, caps=(True, True), smooth=True):
    tube(mb, WORLD, p0, p1, r0, col, mat, sides, r1, caps, smooth)


def disc(mb, fr, cx, cy, cz, r, h, col, mat="matte", sides=16, axis="y", smooth=True):
    if axis == "y":
        tube(mb, fr, (cx, cy, cz), (cx, cy + h, cz), r, col, mat, sides, smooth=smooth)
    elif axis == "z":
        tube(mb, fr, (cx, cy, cz), (cx, cy, cz + h), r, col, mat, sides, smooth=smooth)
    else:
        tube(mb, fr, (cx, cy, cz), (cx + h, cy, cz), r, col, mat, sides, smooth=smooth)


def sphere(mb, fr, cx, cy, cz, r, col, mat="matte", seg=12, rings=6, sy=1.0, smooth=True):
    pts = []
    rows = []
    for j in range(rings + 1):
        v = math.pi * j / rings
        ring = []
        for i in range(seg):
            t = 2 * math.pi * i / seg
            ring.append(fr.p(cx + r * math.sin(v) * math.cos(t), cy + r * sy * math.cos(v), cz + r * math.sin(v) * math.sin(t)))
        rows.append(mb.verts(ring, col))
    for j in range(rings):
        for i in range(seg):
            k = (i + 1) % seg
            a, b, c, d = rows[j][i], rows[j][k], rows[j + 1][k], rows[j + 1][i]
            # outward (the pole rows collapse: skip degenerate triangles)
            if j == 0:
                mb.face((a, c, d), mat, smooth)
            elif j == rings - 1:
                mb.face((a, b, c), mat, smooth)
            else:
                mb.face((a, d, c, b), mat, smooth)


def torus(mb, fr, cx, cy, cz, R, r, cols, mat="matte", axis="z", seg=20, sides=8):
    """A ring in the plane normal to `axis` ('z': the ring stands facing +z). `cols` = a colour or a list of colours by quarter."""
    rings = []
    for i in range(seg):
        t = 2 * math.pi * i / seg
        cdir = (math.cos(t), math.sin(t))
        ring = []
        for j in range(sides):
            s = 2 * math.pi * j / sides
            rr = R + r * math.cos(s)
            if axis == "z":
                ring.append(fr.p(cx + rr * cdir[0], cy + rr * cdir[1], cz + r * math.sin(s)))
            else:
                ring.append(fr.p(cx + rr * cdir[0], cy + r * math.sin(s), cz + rr * cdir[1]))
        rings.append(ring)
    for i in range(seg):
        k = (i + 1) % seg
        col = cols[(i * len(cols)) // seg] if isinstance(cols, list) else cols
        i0 = mb.verts(rings[i], col)
        i1 = mb.verts(rings[k], col)
        for j in range(sides):
            m = (j + 1) % sides
            mb.face((i0[j], i1[j], i1[m], i0[m]) if axis == "z" else (i0[j], i0[m], i1[m], i1[j]), mat, True)


# ---------------------------------------------------------------------------------------------------- walls with holes


def rects_minus(rect, holes):
    """rect (a0, a1, b0, b1) minus the holes: a list of rects that tile what remains (splits along b rows, then a)."""
    a0, a1, b0, b1 = rect
    bs = sorted({b0, b1} | {min(max(h[2], b0), b1) for h in holes} | {min(max(h[3], b0), b1) for h in holes})
    out = []
    for lo, hi in zip(bs, bs[1:]):
        if hi - lo < 1e-6:
            continue
        mid = (lo + hi) / 2
        cut = sorted([(max(h[0], a0), min(h[1], a1)) for h in holes if h[2] < mid < h[3] and h[1] > a0 and h[0] < a1])
        x = a0
        for c0, c1 in cut:
            if c0 > x + 1e-6:
                out.append((x, c0, lo, hi))
            x = max(x, c1)
        if x < a1 - 1e-6:
            out.append((x, a1, lo, hi))
    return out


def intervals_minus(a0, a1, cuts):
    out = []
    x = a0
    for c0, c1 in sorted(cuts):
        if c1 <= a0 or c0 >= a1:
            continue
        if c0 > x + 1e-6:
            out.append((x, min(c0, a1)))
        x = max(x, c1)
    if x < a1 - 1e-6:
        out.append((x, a1))
    return out


# ---------------------------------------------------------------------------------------------------- text

_FONT = None


def _glyphs(s):
    """The mesh of a string in the Hangul font (Jua, SIL OFL): (mesh, xmin, xmax, ymin, ymax, zmin, zmax)."""
    global _FONT
    if _FONT is None and FONT_JUA:
        _FONT = bpy.data.fonts.load(FONT_JUA)
    cu = bpy.data.curves.new("t", "FONT")
    cu.body = s
    if _FONT:
        cu.font = _FONT
    cu.size = 1.0
    cu.extrude = 0.0
    cu.resolution_u = 1
    cu.fill_mode = "FRONT"
    cu.align_x = "LEFT"
    cu.align_y = "BOTTOM"
    ob = bpy.data.objects.new("t", cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    return me, min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)


def text(mb, fr, s, cx, cy, lz, col, fit_w=None, max_h=None, size=1.0, depth=0.012, mat="matte", align="CENTER"):
    """Lettering as real geometry on a vertical plane of the frame (reads left to right along local +x, faces local +z).
    The Hangul font is Jua (SIL OFL), the same family as the village bus's wordmark. Jua has no middle dot, so a "·" is drawn
    as a small round dot between the two pieces. Returns (width, height)."""
    parts = [p.strip() for p in s.split("·")]
    glyphs = [_glyphs(p) for p in parts if p]
    dot_d, gap = 0.13, 0.32  # em units
    widths = [g[2] - g[1] for g in glyphs]
    total = sum(widths) + (len(glyphs) - 1) * (dot_d + 2 * gap)
    y0 = min(g[3] for g in glyphs)
    y1 = max(g[4] for g in glyphs)
    h = y1 - y0
    sc = size
    if fit_w:
        sc = fit_w / total
    if max_h and h * sc > max_h:
        sc = max_h / h
    x = -total / 2 if align == "CENTER" else 0.0
    ymid = (y0 + y1) / 2
    for gi, (me, xmin, xmax, ymin, ymax, zmin, zmax) in enumerate(glyphs):
        for poly in me.polygons:
            if poly.normal.z < 0.5:
                continue
            pts = []
            for vidx in poly.vertices:
                co = me.vertices[vidx].co
                z = lz + 0.004
                pts.append(fr.p(cx + (x + (co.x - xmin)) * sc, cy + (co.y - ymid) * sc, z))
            mb.face(mb.verts(pts, col), mat)
        bpy.data.meshes.remove(me)
        x += widths[gi]
        if gi < len(glyphs) - 1:
            cxm = x + gap + dot_d / 2
            ring = [fr.p(cx + (cxm + dot_d / 2 * math.cos(a)) * sc, cy + (0.0 + 0.0) + (dot_d / 2 * math.sin(a) + (ymid - ymid)) * sc - 0.0, lz + 0.004) for a in [2 * math.pi * k / 10 for k in range(10)]]
            mb.face(mb.verts(ring, col), mat)
            x += dot_d + 2 * gap
    return total * sc, h * sc


# ---------------------------------------------------------------------------------------------------- empties / colliders


def empty(name, pos, collection, props=None, size=0.2, kind="PLAIN_AXES"):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = kind
    e.empty_display_size = size
    e.location = pos
    for k, v in (props or {}).items():
        e[k] = v
    collection.objects.link(e)
    return e


_UNIT = None


def collider(name, minX, maxX, minZ, maxZ, height, collection):
    """col__ box: a unit cube with location = centre and scale = size, no rotation, no parent (as scripts/extract-colliders.ts wants)."""
    global _UNIT
    if _UNIT is None:
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        _UNIT = bpy.data.meshes.new("__unit_cube")
        bm.to_mesh(_UNIT)
        bm.free()
    ob = bpy.data.objects.new(name, _UNIT)
    ob.location = V((minX + maxX) / 2, (minZ + maxZ) / 2, height / 2)
    ob.scale = (maxX - minX, maxZ - minZ, height)
    ob["cat"] = "collider"
    ob.display_type = "WIRE"
    ob.hide_render = True
    collection.objects.link(ob)
    return ob


# ---------------------------------------------------------------------------------------------------- surfaces


def room(mb, x0, x1, y0, y1, z0, z1, col, mat="matte", skip=""):
    """A box seen from inside (inward faces), in game coordinates."""
    pts = [V(x1 if i & 1 else x0, z1 if i & 4 else z0, y1 if i & 2 else y0) for i in range(8)]
    for k, ix in BOX_FACES.items():
        if k in skip:
            continue
        mb.face(mb.verts([pts[i] for i in reversed(ix)], col), mat)


def surface(mb, fn, nu, nv, col, mat="matte", up=True, smooth=False, colfn=None):
    """A grid surface: fn(u, v) -> Blender point for u, v in [0, 1]. Wound so the normal points up (or down, up=False)."""
    pts = [[fn(i / nu, j / nv) for j in range(nv + 1)] for i in range(nu + 1)]
    for i in range(nu):
        for j in range(nv):
            a, b, c, d = pts[i][j], pts[i + 1][j], pts[i + 1][j + 1], pts[i][j + 1]
            n = (b - a).cross(d - a)
            q = [a, b, c, d]
            if (n.z > 0) != up:
                q = [a, d, c, b]
            cc = colfn(i, j) if colfn else col
            mb.face(mb.verts(q, cc), mat, smooth)


def lathe(mb, fr, profile, seg, col, mat="matte", inner=False, smooth=True):
    """A surface of revolution about the frame's up axis; profile = [(radius, height)] bottom to top. inner=True also draws the
    inside (a thin shell, so a shade seen from below is not empty)."""
    rings = []
    for (r, y) in profile:
        rings.append([fr.p(r * math.cos(2 * math.pi * i / seg), y, r * math.sin(2 * math.pi * i / seg)) for i in range(seg)])
    ids = [mb.verts(r, col) for r in rings]
    for k in range(len(rings) - 1):
        for i in range(seg):
            j = (i + 1) % seg
            a, b, c, d = ids[k][i], ids[k][j], ids[k + 1][j], ids[k + 1][i]
            if profile[k + 1][0] < 1e-6:
                mb.face((a, b, c), mat, smooth)
            elif profile[k][0] < 1e-6:
                mb.face((a, b, d), mat, smooth) if False else mb.face((a, c, d), mat, smooth)
            else:
                mb.face((a, b, c, d), mat, smooth)
    if inner:
        ins = [[fr.p((r - 0.012) * math.cos(2 * math.pi * i / seg), y - 0.012, (r - 0.012) * math.sin(2 * math.pi * i / seg)) for i in range(seg)] for (r, y) in profile]
        ids2 = [mb.verts(r, mulc(col, 0.8)) for r in ins]
        for k in range(len(rings) - 1):
            for i in range(seg):
                j = (i + 1) % seg
                a, b, c, d = ids2[k][i], ids2[k][j], ids2[k + 1][j], ids2[k + 1][i]
                if profile[k + 1][0] < 1e-6:
                    mb.face((a, c, b), mat, smooth)
                else:
                    mb.face((a, d, c, b), mat, smooth)
