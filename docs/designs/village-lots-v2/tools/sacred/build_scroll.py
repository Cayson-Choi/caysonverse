# The side-wall hanging scroll of the daeungjeon: a CC0 painting (make_scroll.py) hung from a lacquered roller with gilt knobs,
# a bottom rod with knobs, a cord and two small tassels. Origin = bottom centre, the painting faces glTF +Z (Blender -Y).
#   blender -b --factory-startup -P build_scroll.py -- <scroll_dir> <out.glb>
import bpy, sys, os, math

a = sys.argv[sys.argv.index("--") + 1:]
SD, OUT = os.path.abspath(a[0]), os.path.abspath(a[1])
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
sc = bpy.context.scene
NAME = "lotart__lot_temple_hall_scroll"
im = bpy.data.images.load(os.path.join(SD, "scroll_color.png"))
w, h = im.size
Wm = 0.96
Hm = Wm * h / w


def pbr(name, base=None, rough=0.5, metal=0.0, maps=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    if maps:
        def tex(kind, srgb):
            t = nt.nodes.new("ShaderNodeTexImage")
            t.image = bpy.data.images.load(os.path.join(SD, "scroll_%s.png" % kind))
            t.image.colorspace_settings.name = "sRGB" if srgb else "Non-Color"
            return t
        c = tex("color", True)
        nt.links.new(c.outputs["Color"], b.inputs["Base Color"])
        nm = tex("normal", False)
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(nm.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs[0], b.inputs["Normal"])
        o = tex("orm", False)
        sp = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(o.outputs["Color"], sp.inputs[0])
        nt.links.new(sp.outputs[1], b.inputs["Roughness"])
        nt.links.new(sp.outputs[2], b.inputs["Metallic"])
        grp = bpy.data.node_groups.get("glTF Material Output")
        if grp is None:
            grp = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
            grp.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
        gn = nt.nodes.new("ShaderNodeGroup")
        gn.node_tree = grp
        nt.links.new(sp.outputs[0], gn.inputs["Occlusion"])
    else:
        b.inputs["Base Color"].default_value = base
        b.inputs["Roughness"].default_value = rough
        b.inputs["Metallic"].default_value = metal
    return m


paint = pbr("M_scroll_paint", maps=True)
lac = pbr("M_scroll_lacquer", (0.38, 0.05, 0.035, 1), 0.38)
gilt = pbr("M_scroll_gilt", (1.0, 0.70, 0.27, 1), 0.34, 0.55)
cord = pbr("M_scroll_cord", (0.80, 0.15, 0.10, 1), 0.6)
parts = []
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, Hm / 2), rotation=(math.pi / 2, 0, 0))
p = bpy.context.active_object
p.scale = (Wm, Hm, 1)
bpy.ops.object.transform_apply(scale=True, rotation=True)
for poly in p.data.polygons:
    for li in poly.loop_indices:
        co = p.data.vertices[p.data.loops[li].vertex_index].co
        p.data.uv_layers[0].data[li].uv = (co.x / Wm + 0.5, co.z / Hm)
if p.data.polygons[0].normal.y > 0:
    p.data.flip_normals()
p.data.materials.append(paint)
parts.append(p)


def cyl(name, r, length, loc, mat, axis="x", seg=24):
    bpy.ops.mesh.primitive_cylinder_add(vertices=seg, radius=r, depth=length, location=loc, rotation=(0, math.pi / 2, 0) if axis == "x" else (0, 0, 0))
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    parts.append(o)
    return o


def ball(r, loc, mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10, radius=r, location=loc)
    o = bpy.context.active_object
    o.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    parts.append(o)


Y = 0.012   # roller centre sits just in front of the paper plane (toward the viewer = Blender -Y)
cyl("roller_top", 0.018, Wm + 0.06, (0, -Y, Hm + 0.012), lac)
cyl("rod_bottom", 0.024, Wm + 0.08, (0, -Y, -0.012), lac)
for sx in (-1, 1):
    cyl("cap", 0.026, 0.03, (sx * (Wm / 2 + 0.06), -Y, Hm + 0.012), gilt)
    ball(0.032, (sx * (Wm / 2 + 0.08), -Y, Hm + 0.012), gilt)
    cyl("capb", 0.032, 0.03, (sx * (Wm / 2 + 0.065), -Y, -0.012), gilt)
    ball(0.04, (sx * (Wm / 2 + 0.09), -Y, -0.012), gilt)
for sx in (-1, 1):  # the hanging cord: a V up to a gilt ring above the roller
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.004, depth=0.34, location=(sx * 0.1, -Y, Hm + 0.17))
    o = bpy.context.active_object
    o.rotation_euler = (0, sx * math.radians(16.5), 0)
    o.data.materials.append(cord)
    parts.append(o)
bpy.ops.mesh.primitive_torus_add(major_radius=0.025, minor_radius=0.006, major_segments=20, minor_segments=6, location=(0, -Y, Hm + 0.36), rotation=(math.pi / 2, 0, 0))
o = bpy.context.active_object
o.data.materials.append(gilt)
parts.append(o)
for sx in (-0.2, 0.2):  # tassels from the bottom rod
    cyl("tcord", 0.004, 0.18, (sx, -Y - 0.002, -0.12), cord, axis="z", seg=8)
    bpy.ops.mesh.primitive_cone_add(vertices=14, radius1=0.028, radius2=0.004, depth=0.16, location=(sx, -Y - 0.002, -0.29))
    o = bpy.context.active_object
    o.rotation_euler = (math.pi, 0, 0)
    o.data.materials.append(cord)
    bpy.ops.object.shade_smooth()
    parts.append(o)
for o in sc.objects:
    o.select_set(o in parts)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
ob = bpy.context.active_object
ob.name = NAME
ph = ob.copy()
ph.data = ob.data.copy()
ph.name = NAME + "_phone"
sc.collection.objects.link(ph)
for o in sc.objects:
    o.select_set(False)
bpy.context.view_layer.objects.active = ph
ph.select_set(True)
d = ph.modifiers.new("dec", "DECIMATE")
d.ratio = 0.5
d.use_collapse_triangulate = True
bpy.ops.object.modifier_apply(modifier="dec")
for o in sc.objects:
    o.select_set(o.name in (NAME, NAME + "_phone"))
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_apply=True, export_yup=True, export_materials="EXPORT", export_normals=True, export_extras=False)
print("SCROLL", round(Wm, 3), round(Hm, 3), "tris", sum(len(q.vertices) - 2 for q in ob.data.polygons))
