"""Shared Blender helpers for the village build (authoring scene) and export.

Coordinates: layout.json is game space (x east, z south, y up). Blender is (X, Y, Z) = (x, -z, y). Every builder here
takes GAME coordinates and converts once, in V(). Meshes are built in world space (objects keep identity transforms),
except col__ boxes (unit cube + location/scale, as the collider extractor expects).

Material model (see build_village.py MATS):
  - every authoring material carries ["export"] = the GLB material it becomes (LM_* lightmapped, M_* not);
  - UV0 ("UVMap") is written here at build time and is the texture UV of the export material;
  - tintable LM materials multiply their texture by the "Col" colour attribute (exported as COLOR_0).
"""
import json
import math
import os
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEX = os.path.join(ROOT, "work", "tex")
DL = os.path.join(ROOT, "downloads")
LAYOUT = json.load(open(os.environ.get("CV_LAYOUT") or os.path.join(ROOT, "layout.json"), encoding="utf-8"))
LOOK = json.load(open(os.path.join(ROOT, "tools", "look.json"), encoding="utf-8"))
ATLAS = json.load(open(os.path.join(TEX, "atlas.json"), encoding="utf-8")) if os.path.exists(os.path.join(TEX, "atlas.json")) else None
GLOWMAP = json.load(open(os.path.join(TEX, "glow.json"), encoding="utf-8")) if os.path.exists(os.path.join(TEX, "glow.json")) else None


BOXES = []           # every col__ box created: (node, minX, maxX, minZ, maxZ)
LIGHTS = []          # (kind, Blender position) -> light__<kind>_<n> empties (a later night bake places lights there)


def light(kind, pos):
    LIGHTS.append((kind, pos.copy()))


def make_light_empties(coll_):
    counts = {}
    for kind, pos in LIGHTS:
        counts[kind] = counts.get(kind, 0) + 1
        e = bpy.data.objects.new(f"light__{kind}_{counts[kind]}", None)
        e.empty_display_type = "SPHERE"
        e.empty_display_size = 0.15
        e.location = pos
        e["cat"] = "light"
        coll_.objects.link(e)
    return counts


def V(x, z, y=0.0):
    return Vector((x, -z, y))


def _lin2srgb(c):
    c = max(0.0, min(1.0, c))
    return c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def _to_layer(t):
    """A bmesh loop colour layer of a byte colour attribute takes sRGB-encoded values (reading the attribute back
    gives linear): encode the linear tint so the stored colour is the intended one."""
    return (_lin2srgb(t[0]), _lin2srgb(t[1]), _lin2srgb(t[2]), t[3] if len(t) > 3 else 1.0)


def rgba(h, a=1.0):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    lin = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return (lin[0], lin[1], lin[2], a)


# ------------------------------------------------------------------------------------------ materials --

_MATS = {}
MATSPEC = {}          # filled by build_village.py: name -> dict


def img(name, colorspace="sRGB"):
    p = name if os.path.isabs(name) else os.path.join(TEX, name)
    if not os.path.exists(p):
        p2 = os.path.join(DL, "tex", name)
        p = p2 if os.path.exists(p2) else p
    im = bpy.data.images.load(p, check_existing=True)
    im.colorspace_settings.name = colorspace
    return im


def _node(nt, t, loc=(0, 0)):
    n = nt.nodes.new(t)
    n.location = loc
    return n


def mat(name):
    """Authoring material by name (created from MATSPEC on first use)."""
    if name in _MATS:
        return _MATS[name]
    spec = MATSPEC[name]
    m = bpy.data.materials.new(name)
    m["export"] = spec.get("export", name)
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = _node(nt, "ShaderNodeOutputMaterial", (900, 0))
    kind = spec.get("kind", "pbr")
    if kind == "emit":
        em = _node(nt, "ShaderNodeEmission", (600, 0))
        em.inputs["Color"].default_value = rgba(spec["color"])
        em.inputs["Strength"].default_value = spec.get("strength", 4.0)
        nt.links.new(em.outputs[0], out.inputs["Surface"])
    elif kind == "emit_tex":
        em = _node(nt, "ShaderNodeEmission", (600, 0))
        tex = _node(nt, "ShaderNodeTexImage", (200, 0))
        tex.image = img(spec["tex"])
        uv = _node(nt, "ShaderNodeUVMap", (0, 0))
        uv.uv_map = "UVMap"
        nt.links.new(uv.outputs[0], tex.inputs["Vector"])
        nt.links.new(tex.outputs["Color"], em.inputs["Color"])
        em.inputs["Strength"].default_value = spec.get("strength", 3.0)
        nt.links.new(em.outputs[0], out.inputs["Surface"])
    elif kind == "sky":
        em = _node(nt, "ShaderNodeEmission", (600, 0))
        tex = _node(nt, "ShaderNodeTexImage", (200, 0))
        tex.image = img(spec["tex"])
        nt.links.new(tex.outputs["Color"], em.inputs["Color"])
        nt.links.new(em.outputs[0], out.inputs["Surface"])
    else:
        bsdf = _node(nt, "ShaderNodeBsdfPrincipled", (500, 0))
        uv = _node(nt, "ShaderNodeUVMap", (-600, 0))
        uv.uv_map = "UVMap"
        col_out = None
        if "tex" in spec:
            tex = _node(nt, "ShaderNodeTexImage", (-300, 100))
            tex.image = img(spec["tex"])
            tex.interpolation = "Linear"
            nt.links.new(uv.outputs[0], tex.inputs["Vector"])
            col_out = tex.outputs["Color"]
            if spec.get("alpha"):
                nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
                try:
                    m.surface_render_method = "DITHERED"
                except Exception:
                    pass
        else:
            bsdf.inputs["Base Color"].default_value = rgba(spec.get("color", "#808080"))
        if spec.get("tint") and col_out is not None:
            ca = _node(nt, "ShaderNodeVertexColor", (-300, -150))
            ca.layer_name = "Col"
            mul = _node(nt, "ShaderNodeMix", (100, 50))
            mul.data_type = "RGBA"
            mul.blend_type = "MULTIPLY"
            mul.inputs["Factor"].default_value = 1.0
            nt.links.new(col_out, mul.inputs[6])
            nt.links.new(ca.outputs["Color"], mul.inputs[7])
            col_out = mul.outputs[2]
        if col_out is not None:
            if spec.get("albedo_mul"):
                mm = _node(nt, "ShaderNodeMix", (250, 50))
                mm.data_type = "RGBA"
                mm.blend_type = "MULTIPLY"
                mm.inputs["Factor"].default_value = 1.0
                nt.links.new(col_out, mm.inputs[6])
                mm.inputs[7].default_value = rgba(spec["albedo_mul"])
                col_out = mm.outputs[2]
            nt.links.new(col_out, bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = spec.get("rough", 0.7)
        bsdf.inputs["Metallic"].default_value = spec.get("metal", 0.0)
        if "coat" in spec:
            bsdf.inputs["Coat Weight"].default_value = spec["coat"]
            bsdf.inputs["Coat Roughness"].default_value = 0.05
        if spec.get("transmission"):
            bsdf.inputs["Transmission Weight"].default_value = spec["transmission"]
            bsdf.inputs["IOR"].default_value = spec.get("ior", 1.33)
        if spec.get("glow") and col_out is not None:
            nt.links.new(col_out, bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = spec["glow"]
        if spec.get("translucent"):
            # leaves / petals: some light through (subsurface-ish without the cost)
            bsdf.inputs["Subsurface Weight"].default_value = 0.0
            tr = _node(nt, "ShaderNodeBsdfTranslucent", (500, -300))
            if col_out is not None:
                nt.links.new(col_out, tr.inputs["Color"])
            mix = _node(nt, "ShaderNodeMixShader", (750, 0))
            mix.inputs[0].default_value = spec["translucent"]
            nt.links.new(bsdf.outputs[0], mix.inputs[1])
            nt.links.new(tr.outputs[0], mix.inputs[2])
            if spec.get("alpha"):
                tp = _node(nt, "ShaderNodeBsdfTransparent", (750, -250))
                mix2 = _node(nt, "ShaderNodeMixShader", (850, 0))
                nt.links.new(tex.outputs["Alpha"], mix2.inputs[0])
                nt.links.new(tp.outputs[0], mix2.inputs[1])
                nt.links.new(mix.outputs[0], mix2.inputs[2])
                nt.links.new(mix2.outputs[0], out.inputs["Surface"])
            else:
                nt.links.new(mix.outputs[0], out.inputs["Surface"])
        else:
            nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
        if spec.get("nor"):
            nm = _node(nt, "ShaderNodeNormalMap", (200, -300))
            nm.inputs["Strength"].default_value = spec.get("nor_strength", 0.6)
            nimg = _node(nt, "ShaderNodeTexImage", (-300, -350))
            nimg.image = img(spec["nor"], "Non-Color")
            mapping_scale = spec.get("nor_scale", 1.0)
            if mapping_scale != 1.0:
                mp = _node(nt, "ShaderNodeMapping", (-450, -350))
                mp.inputs["Scale"].default_value = (mapping_scale, mapping_scale, 1)
                nt.links.new(uv.outputs[0], mp.inputs["Vector"])
                nt.links.new(mp.outputs[0], nimg.inputs["Vector"])
            else:
                nt.links.new(uv.outputs[0], nimg.inputs["Vector"])
            nt.links.new(nimg.outputs["Color"], nm.inputs["Color"])
            nt.links.new(nm.outputs[0], bsdf.inputs["Normal"])
        if spec.get("bump_noise"):
            tc = _node(nt, "ShaderNodeTexCoord", (-600, -500))
            nz = _node(nt, "ShaderNodeTexNoise", (-300, -550))
            nz.inputs["Scale"].default_value = spec["bump_noise"]
            nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
            bp = _node(nt, "ShaderNodeBump", (200, -500))
            bp.inputs["Strength"].default_value = spec.get("bump_strength", 0.2)
            nt.links.new(nz.outputs["Fac"], bp.inputs["Height"])
            nt.links.new(bp.outputs[0], bsdf.inputs["Normal"])
    _MATS[name] = m
    return m


# ------------------------------------------------------------------------------------------ mesh build --

class MB:
    """A bmesh being filled in world space (game coords in, Blender out). Faces get a material by name; UVs are
    written per face with an explicit (u, v) list or by world projection later (auto_uv)."""

    def __init__(self):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.col = self.bm.loops.layers.color.new("Col")
        self.explicit = self.bm.faces.layers.int.new("uvx")
        self.mats = []
        self.tint = (1.0, 1.0, 1.0, 1.0)
        self.cell = None                 # atlas cell name: faces without explicit UVs get this cell's UV

    def mi(self, name):
        if name not in self.mats:
            self.mats.append(name)
        return self.mats.index(name)

    def face(self, pts, m, uvs=None, smooth=False, tint=None, hint=None):
        """pts are Blender Vectors (use V()). hint: a direction the face normal must point along (flips if not)."""
        if hint is not None:
            n = Vector((0, 0, 0))
            for i in range(len(pts)):
                a, b = pts[i], pts[(i + 1) % len(pts)]
                n.x += (a.y - b.y) * (a.z + b.z)
                n.y += (a.z - b.z) * (a.x + b.x)
                n.z += (a.x - b.x) * (a.y + b.y)
            if n.dot(hint) < 0:
                pts = pts[::-1]
                if uvs is not None:
                    uvs = uvs[::-1]
        if uvs is None and self.cell is not None:
            uvs = [cell(self.cell)] * len(pts)
        vs = [self.bm.verts.new(p) for p in pts]
        try:
            f = self.bm.faces.new(vs)
        except ValueError:
            return None
        f.material_index = self.mi(m)
        f.smooth = smooth
        t = _to_layer(tint or self.tint)
        for i, lp in enumerate(f.loops):
            lp[self.col] = t
            if uvs is not None:
                lp[self.uv].uv = uvs[i]
        f[self.explicit] = 1 if uvs is not None else 0
        return f

    def box(self, cx, cz, y0, sx, sz, sy, m, yaw=0.0, uvs_fn=None, tint=None, skip_bottom=True, top_m=None):
        """Axis box in game coords: centre (cx, cz) on the ground plane, bottom y0, sizes sx (x), sz (z), sy (height),
        turned by yaw (game yaw: rotation about +y, yaw 0 faces +z)."""
        c, s = math.cos(yaw), math.sin(yaw)
        def P(lx, lz, ly):
            # local x along the box's x, local z along its z; game yaw rotates +z toward +x
            gx = cx + lx * c + lz * s
            gz = cz - lx * s + lz * c
            return V(gx, gz, y0 + ly)
        hx, hz = sx / 2, sz / 2
        p = [P(-hx, -hz, 0), P(hx, -hz, 0), P(hx, hz, 0), P(-hx, hz, 0),
             P(-hx, -hz, sy), P(hx, -hz, sy), P(hx, hz, sy), P(-hx, hz, sy)]
        faces = [(4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        if not skip_bottom:
            faces.append((3, 2, 1, 0))
        out = []
        ctr = sum(p, Vector()) / 8
        for k, f in enumerate(faces):
            pts = [p[i] for i in f]
            fc = sum(pts, Vector()) / 4
            mm = top_m if (k == 0 and top_m) else m
            out.append(self.face(pts, mm, tint=tint, hint=fc - ctr))
        return out

    def quad(self, a, b, c, d, m, uvs=None, tint=None, smooth=False, hint=None):
        return self.face([a, b, c, d], m, uvs, tint=tint, smooth=smooth, hint=hint)

    def lathe(self, cx, cz, profile, m, segs=32, y0=0.0, smooth=True, uv_mode=None, tint=None, a0=0.0, a1=2 * math.pi,
              close=True):
        """Surface of revolution about the vertical axis at (cx, cz); profile = [(r, y), ...] bottom to top."""
        rings = []
        n = segs if close else segs + 1
        for (r, y) in profile:
            ring = []
            for i in range(n):
                a = a0 + (a1 - a0) * i / segs
                ring.append(V(cx + r * math.cos(a), cz + r * math.sin(a), y0 + y))
            rings.append(ring)
        L = 0.0
        acc = [0.0]
        for i in range(1, len(profile)):
            L += math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1])
            acc.append(L)
        for j in range(len(profile) - 1):
            dr = profile[j + 1][0] - profile[j][0]
            dy = profile[j + 1][1] - profile[j][1]
            for i in range(segs):
                am = a0 + (a1 - a0) * (i + 0.5) / segs
                radial = Vector((math.cos(am), -math.sin(am), 0))
                hint = radial * dy + Vector((0, 0, -dr))
                i2 = (i + 1) % n if close else i + 1
                pts = [rings[j][i], rings[j][i2], rings[j + 1][i2], rings[j + 1][i]]
                if uv_mode is not None:
                    u0, u1 = uv_mode[0] * i / segs, uv_mode[0] * (i + 1) / segs
                    v0, v1 = acc[j] * uv_mode[1], acc[j + 1] * uv_mode[1]
                    uvs = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
                else:
                    uvs = None
                # profile points with r == 0 make degenerate quads -> triangles
                if profile[j][0] == 0 or profile[j + 1][0] == 0:
                    tri = [pts[0], pts[1], pts[2], pts[3]]
                    if profile[j][0] == 0:
                        tri = [pts[0], pts[2], pts[3]]
                        uv3 = None if uvs is None else [uvs[0], uvs[2], uvs[3]]
                    else:
                        tri = [pts[0], pts[1], pts[2]]
                        uv3 = None if uvs is None else uvs[:3]
                    self.face(tri, m, uv3, smooth=smooth, tint=tint, hint=hint)
                else:
                    self.face(pts, m, uvs, smooth=smooth, tint=tint, hint=hint)
        return rings

    def tube(self, path, radii, m, segs=6, smooth=True, uv_v=1.0, uv_u=1.0, tint=None, cap_end=False, uv_region=None,
             uv_off=(0.0, 0.0)):
        """Tube along a list of Blender-space points with a radius per point (tapered branches, jets, poles)."""
        rings = []
        n = len(path)
        for i, p in enumerate(path):
            t = (path[min(i + 1, n - 1)] - path[max(i - 1, 0)]).normalized()
            up = Vector((0, 0, 1)) if abs(t.z) < 0.95 else Vector((1, 0, 0))
            x = t.cross(up).normalized()
            y = t.cross(x).normalized()
            ring = [p + (x * math.cos(2 * math.pi * k / segs) + y * math.sin(2 * math.pi * k / segs)) * radii[i]
                    for k in range(segs)]
            rings.append(ring)
        L = [0.0]
        for i in range(1, n):
            L.append(L[-1] + (path[i] - path[i - 1]).length)
        faces = []
        for i in range(n - 1):
            for k in range(segs):
                k2 = (k + 1) % segs
                pts = [rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]]
                u0, u1 = uv_u * k / segs, uv_u * (k + 1) / segs
                v0, v1 = L[i] * uv_v, L[i + 1] * uv_v
                uvs = [(u0 + uv_off[0], v0 + uv_off[1]), (u1 + uv_off[0], v0 + uv_off[1]),
                       (u1 + uv_off[0], v1 + uv_off[1]), (u0 + uv_off[0], v1 + uv_off[1])]
                if uv_region:
                    uvs = [region_uv(uv_region, u, v) for u, v in uvs]
                fc = sum(pts, Vector()) / 4
                faces.append(self.face(pts, m, uvs, smooth=smooth, tint=tint, hint=fc - (path[i] + path[i + 1]) / 2))
        if cap_end:
            t = (path[-1] - path[-2]).normalized()
            self.face(rings[-1], m, None, tint=tint, hint=t)
        return faces

    def prism(self, poly, y0, y1, m, side_m=None, top=True, tint=None, bottom=False, top_uvs=None):
        """Extrude a 2D polygon (game x, z) from y0 to y1 (any winding)."""
        pts0 = [V(x, z, y0) for x, z in poly]
        pts1 = [V(x, z, y1) for x, z in poly]
        n = len(poly)
        bx = [(p.x, p.y) for p in pts0]
        area = sum(bx[i][0] * bx[(i + 1) % n][1] - bx[(i + 1) % n][0] * bx[i][1] for i in range(n))
        sgn = 1 if area > 0 else -1
        if top:
            self.face(pts1, m, top_uvs, tint=tint, hint=Vector((0, 0, 1)))
        if bottom:
            self.face(pts0, m, tint=tint, hint=Vector((0, 0, -1)))
        for i in range(n):
            j = (i + 1) % n
            dx, dy = bx[j][0] - bx[i][0], bx[j][1] - bx[i][1]
            hint = Vector((dy, -dx, 0)) * sgn
            self.face([pts0[i], pts0[j], pts1[j], pts1[i]], side_m or m, tint=tint, hint=hint)

    def finish(self, name, coll, cat="lm", auto=True, tiles=None):
        me = bpy.data.meshes.new(name)
        if cat not in ("leaf",):
            bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=0.0005)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        for n in self.mats:
            me.materials.append(mat(n))
        ob = bpy.data.objects.new(name, me)
        coll.objects.link(ob)
        ob["cat"] = cat
        if auto:
            auto_uv(ob)
        return ob


def loc(cx, cz, yaw, lx, lz):
    """Game point at local offset (lx along the object's x, lz along its facing +z) from (cx, cz) turned by yaw."""
    c, s = math.cos(yaw), math.sin(yaw)
    return cx + lx * c + lz * s, cz - lx * s + lz * c


def region_uv(region, u, v):
    """Map (u, v) in 0..1 into an atlas region (name)."""
    x, y, w, h = ATLAS["regions"][region]
    S = ATLAS["size"]
    return ((x + u * w) / S, 1 - (y + (1 - v) * h) / S)


def glow_uv(region, u, v):
    x, y, w, h = GLOWMAP["regions"][region]
    S = GLOWMAP["size"]
    return ((x + u * w) / S, 1 - (y + (1 - v) * h) / S)


def quad_uvs(fn, region):
    return [fn(region, 0, 0), fn(region, 1, 0), fn(region, 1, 1), fn(region, 0, 1)]


def cell(name):
    return tuple(ATLAS["cells"][name])


def auto_uv(ob):
    """World-projected UV0 for faces without explicit UVs: triplanar by the face normal, tile from MATSPEC."""
    me = ob.data
    uvl = me.uv_layers["UVMap"].data
    ex = me.attributes.get("uvx")
    exv = [0] * len(me.polygons)
    if ex is not None:
        ex.data.foreach_get("value", exv)
    for p in me.polygons:
        if exv[p.index]:
            continue
        mname = me.materials[p.material_index].name
        spec = MATSPEC.get(mname, {})
        mode = spec.get("uv", "world")
        if mode == "cell":
            u = cell(spec["cell"])
            for li in p.loop_indices:
                uvl[li].uv = u
            continue
        if mode == "plaza":
            for li in p.loop_indices:
                co = me.vertices[me.loops[li].vertex_index].co
                uvl[li].uv = ((co.x + 40.0) / 80.0, (co.y + 40.0) / 80.0)
            continue
        tile = spec.get("tile", 2.0)
        n = p.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if ax == 2:
                uvl[li].uv = (co.x / tile, co.y / tile)
            elif ax == 0:
                uvl[li].uv = (co.y / tile, co.z / tile)
            else:
                uvl[li].uv = (co.x / tile, co.z / tile)


def collider(coll, name, minX, maxX, minZ, maxZ, height=2.0):
    """col__ box: unit cube, location = centre, scale = size (unrotated, no parent)."""
    me = bpy.data.meshes.get("__unit_cube")
    if me is None:
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        me = bpy.data.meshes.new("__unit_cube")
        bm.to_mesh(me)
        bm.free()
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    cx, cz = (minX + maxX) / 2, (minZ + maxZ) / 2
    ob.location = V(cx, cz, height / 2)
    ob.scale = (maxX - minX, maxZ - minZ, height)
    ob["cat"] = "collider"
    BOXES.append((name, minX, maxX, minZ, maxZ))
    ob.hide_render = True
    ob.display_type = "WIRE"
    return ob


def coll(name, parent=None):
    c = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if c.name not in (parent or bpy.context.scene.collection).children:
        (parent or bpy.context.scene.collection).children.link(c)
    return c


def bez(p0, p1, p2, n):
    return [(p0 * (1 - t) ** 2 + p1 * 2 * t * (1 - t) + p2 * t * t) for t in [i / (n - 1) for i in range(n)]]
