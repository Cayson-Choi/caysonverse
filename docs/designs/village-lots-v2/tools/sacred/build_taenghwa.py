# The 후불탱화 (rear-altar painting) of the daeungjeon, re-done 2026-11-18: the same CC0 painting at 3072 px (make_taenghwa.py), in a
# silk border (회장), a thin gilt bead against the painting, a red-lacquered frame with a moulded profile, gilt corner brackets and a
# gilt top cornice. Reuses build_props.py's helpers (executed from that file, so the two stay one set of conventions).
#   blender -b --factory-startup -P build_taenghwa.py -- <taenghwa_dir> <out.glb>
import bpy, bmesh, sys, os, math, json

HERE = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[sys.argv.index("--") + 1:]
TANG, OUTGLB = os.path.abspath(args[0]), os.path.abspath(args[1])
# pull build_props.py's helpers (everything up to the first prop) with its argv convention
sys.argv = sys.argv[:sys.argv.index("--") + 1] + [TANG, TANG, os.path.dirname(OUTGLB)]
src = open(os.path.join(HERE, "build_props.py"), encoding="utf-8").read().split("\n")
exec("\n".join(src[:92]))


def gilt_mat():
    m = bpy.data.materials.new("M_gilt_frame")
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (0.86, 0.50, 0.10, 1)
    b.inputs["Metallic"].default_value = 0.35
    b.inputs["Roughness"].default_value = 0.3
    return m


def taenghwa(unit="lot_temple_hall", Wm=3.6):
    reset()
    im = bpy.data.images.load(os.path.join(TANG, "taenghwa_color.png"))
    w, h = im.size
    Hm = Wm * h / w
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 0), rotation=(math.pi / 2, 0, 0))
    p = bpy.context.active_object
    p.name = "lotart__%s_taenghwa" % unit
    p.scale = (Wm, Hm, 1)
    bpy.ops.object.transform_apply(scale=True, rotation=True)
    me = p.data
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            me.uv_layers[0].data[li].uv = (co.x / Wm + 0.5, co.z / Hm + 0.5)
    if me.polygons[0].normal.y > 0:
        me.flip_normals()
    me.materials.append(tex_mat("M_taenghwa", TANG, "taenghwa"))
    silk = bpy.data.materials.new("M_silk_border")
    silk.use_nodes = True
    sb = next(n for n in silk.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    sb.inputs["Base Color"].default_value = (0.08, 0.20, 0.30, 1)
    sb.inputs["Roughness"].default_value = 0.72
    sb.inputs["Sheen Weight"].default_value = 0.6
    lac = lib_mat("dancheong_wood", (0.42, 0.06, 0.04, 1), 0.45)
    gilt = gilt_mat()
    parts = [p]
    bw = 0.12
    for (sx, sz, x, z) in ((Wm + 2 * bw, bw, 0, Hm / 2 + bw / 2), (Wm + 2 * bw, bw, 0, -Hm / 2 - bw / 2), (bw, Hm, -Wm / 2 - bw / 2, 0), (bw, Hm, Wm / 2 + bw / 2, 0)):
        bpy.ops.mesh.primitive_plane_add(size=1, location=(x, 0.002, z), rotation=(math.pi / 2, 0, 0))
        s = bpy.context.active_object
        s.scale = (sx, sz, 1)
        bpy.ops.object.transform_apply(scale=True, rotation=True)
        if s.data.polygons[0].normal.y > 0:
            s.data.flip_normals()
        s.data.materials.append(silk)
        box_uv_metres(s)
        parts.append(s)
    # a thin gilt bead against the painting's edge
    gb = 0.018
    for (sx, sz, x, z) in ((Wm + gb, gb, 0, Hm / 2 + gb / 2), (Wm + gb, gb, 0, -Hm / 2 - gb / 2), (gb, Hm, -Wm / 2 - gb / 2, 0), (gb, Hm, Wm / 2 + gb / 2, 0)):
        parts.append(bevel_box("bead", (sx, 0.022, sz), (x, -0.008, z), gilt, 0.006))
    # the lacquered frame: two stepped layers
    fw, fd = 0.09, 0.07
    o2 = Wm / 2 + bw + fw / 2
    z2 = Hm / 2 + bw + fw / 2
    for (sx, sz, x, z) in ((2 * o2 + fw, fw, 0, z2), (2 * o2 + fw, fw, 0, -z2), (fw, 2 * z2 - fw, -o2, 0), (fw, 2 * z2 - fw, o2, 0)):
        parts.append(bevel_box("frame", (sx, fd, sz), (x, -fd / 2 + 0.01, z), lac, 0.014, 3))
    fw2, fd2 = 0.04, 0.025
    o3 = o2 + fw / 2 + fw2 / 2 - 0.01
    z3 = z2 + fw / 2 + fw2 / 2 - 0.01
    for (sx, sz, x, z) in ((2 * o3 + fw2, fw2, 0, z3), (2 * o3 + fw2, fw2, 0, -z3), (fw2, 2 * z3 - fw2, -o3, 0), (fw2, 2 * z3 - fw2, o3, 0)):
        parts.append(bevel_box("frame2", (sx, fd2, sz), (x, -fd - fd2 / 2 + 0.02, z), lac, 0.008, 2))
    # gilt corner brackets (a block with a boss) and a gilt cornice along the top
    for sx in (-1, 1):
        for sz in (-1, 1):
            parts.append(bevel_box("corner", (0.2, 0.03, 0.2), (sx * (o2 - 0.01), -fd - 0.005, sz * (z2 - 0.01)), gilt, 0.02, 3))
            bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10, radius=0.045, location=(sx * (o2 - 0.01), -fd - 0.035, sz * (z2 - 0.01)))
            bo = bpy.context.active_object
            bo.data.materials.append(gilt)
            box_uv_metres(bo)
            parts.append(bo)
    parts.append(bevel_box("cornice", (2 * o3 + 0.2, 0.08, 0.05), (0, -0.03, z3 + 0.05), gilt, 0.012, 3))
    parts.append(bevel_box("cornice_lac", (2 * o3 + 0.1, 0.05, 0.05), (0, -0.01, z3 + 0.02), lac, 0.01, 2))
    for q in parts[1:]:
        q.parent = p
    export(OUTGLB, parts)
    report["taenghwa_size_m"] = [round(Wm + 2 * (bw + fw), 3), round(Hm + 2 * (bw + fw), 3)]


taenghwa()
print("TAENGHWA", json.dumps(report))
