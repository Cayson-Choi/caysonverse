"""Shared Blender helpers for lake gear/fish (chunk C). Geometry is authored in glTF space (x right, y up, z forward)
and converted once by G(): Blender = (gx, -gz, gy), so exported node/vertex coordinates equal the numbers written here."""
import math
import bmesh
import bpy
from mathutils import Vector, Matrix, Quaternion


def G(x, y, z):
    return Vector((x, -z, y))


def Gv(v):
    return G(v[0], v[1], v[2])


def mat(name, color, rough=0.5, metal=0.0, emit=None, emit_strength=0.0, alpha=None):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emit_strength
    if alpha is not None:
        bsdf.inputs["Alpha"].default_value = alpha
    return m


def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def frame(axis, up_hint=Vector((0, 1, 0))):
    """Orthonormal (u, v, w) in glTF space with w = axis."""
    w = Vector(axis).normalized()
    u = up_hint.cross(w)
    if u.length < 1e-4:
        u = Vector((1, 0, 0)).cross(w)
    u.normalize()
    v = w.cross(u)
    return u, v, w


def ring_pts(center, axis, radius, sides, up_hint=Vector((0, 0, 1)), sx=1.0, sy=1.0, phase=0.0):
    u, v, w = frame(axis, up_hint)
    out = []
    for i in range(sides):
        a = phase + 2 * math.pi * i / sides
        out.append(Vector(center) + u * (math.cos(a) * radius * sx) + v * (math.sin(a) * radius * sy))
    return out


def paint(bm, f, col):
    if col is None:
        return
    lay = bm.loops.layers.color.get("Col") or bm.loops.layers.color.new("Col")
    for l in f.loops:
        l[lay] = (*col[:3], 1.0)


def loft(bm, rings, mi=0, cap_a=True, cap_b=True, closed=True, col=None, groups=None):
    """rings: list of lists of glTF-space points (same length). Returns list of verts per ring."""
    lay = bm.verts.layers.deform.verify() if groups is not None else None
    if col is not None:
        bm.loops.layers.color.get('Col') or bm.loops.layers.color.new('Col')
    vr = [[bm.verts.new(G(*p)) for p in ring] for ring in rings]
    n = len(vr[0])
    for a, b in zip(vr[:-1], vr[1:]):
        for i in range(n):
            j = (i + 1) % n
            if not closed and j == 0:
                continue
            try:
                f = bm.faces.new((a[i], a[j], b[j], b[i]))
                f.material_index = mi
                f.smooth = True
                paint(bm, f, col)
            except ValueError:
                pass
    for cap, ring in ((cap_a, vr[0]), (cap_b, vr[-1])):
        if cap and closed:
            try:
                f = bm.faces.new(ring if ring is vr[-1] else ring[::-1])
                f.material_index = mi
                paint(bm, f, col)
            except ValueError:
                pass
    if groups is not None:
        for ring in vr:
            for v in ring:
                for gi, w in groups:
                    v[lay][gi] = w
    return vr


def tube(bm, p0, p1, r0, r1, sides=10, mi=0, caps=(True, True), up_hint=Vector((0, 0, 1)), **kw):
    ax = Vector(p1) - Vector(p0)
    return loft(bm, [ring_pts(p0, ax, r0, sides, up_hint), ring_pts(p1, ax, r1, sides, up_hint)], mi, *caps, **kw)


def profile_tube(bm, p0, p1, prof, sides=10, mi=0, caps=(True, True), up_hint=Vector((0, 0, 1)), **kw):
    """prof: [(t 0..1, radius)] along p0->p1."""
    ax = Vector(p1) - Vector(p0)
    rings = [ring_pts(Vector(p0) + ax * t, ax, r, sides, up_hint) for t, r in prof]
    return loft(bm, rings, mi, *caps, **kw)


def new_obj(name, bm, mats):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def export_glb(path, selection=None, animations=False, **kw):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    objs = selection if selection is not None else list(bpy.context.scene.objects)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    args = dict(filepath=path, export_format="GLB", use_selection=True, export_apply=False, export_yup=True,
                export_animations=animations, export_skins=True, export_morph=False)
    args.update(kw)
    bpy.ops.export_scene.gltf(**args)


def vc_material(name, rough=0.4, metal=0.0):
    """Principled material whose base colour = COLOR_0 ('Col' attribute)."""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    cn = nt.nodes.new("ShaderNodeVertexColor")
    cn.layer_name = "Col"
    nt.links.new(cn.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    return m
