# Sacred props built around the sourced images (Blender, headless, one process):
#   blender -b --factory-startup -P build_props.py -- <glass_dir> <taenghwa_dir> <out_dir>
# Writes (PNG textures inside; ktx2_glb.mjs converts them to KTX2):
#   lotglass__lot_chapel_nave_<id>.glb   3 figurative lancets (1.0 x 2.6 m) and the rose (2.4 m, with 3D stone tracery)
#   lotglass__lot_church_nave_clear.glb  the church's plain lancet (no figures)
#   lotart__lot_temple_hall_taenghwa.glb the 후불탱화 (3.6 m wide) in a red-lacquered frame with a silk border
#   lotprop__lot_church_nave_cross.glb   plain oak cross (1.0 x 1.8 m)
#   lotprop__lot_chapel_nave_station.glb one Station of the Cross (oak cross on a moulded oak plaque) + 14 numeral meshes I..XIV
# Every object faces -Y (Blender) = +Z in glTF: hang it on a wall whose room side looks along +Z, or rotate.
# Wood / stone / iron carry the library set name in the material (M_pbr_wood_oak, M_pbr_stone_ashlar, M_pbr_cast_iron) and
# metre-scaled UVs; the loader swaps in pbrLibrary.getPbrSet(<set>) (the GLB keeps only a plain fallback colour for them).
import bpy, bmesh, sys, os, math, json
from mathutils import Vector, Matrix

GLASS, TANG, OUT = [os.path.abspath(p) for p in sys.argv[sys.argv.index("--") + 1:][:3]]
os.makedirs(OUT, exist_ok=True)
report = {}


def reset():
    for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes): bpy.data.meshes.remove(m)


def lib_mat(set_id, col, rough=0.6, metal=0.0):
    name = f"M_pbr_{set_id}"
    m = bpy.data.materials.get(name)
    if m: return m
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = col; b.inputs["Roughness"].default_value = rough; b.inputs["Metallic"].default_value = metal
    return m


def tex_mat(name, folder, stem, emissive=False, alpha=False):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; L = nt.links
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")

    def img(kind, srgb):
        p = os.path.join(folder, f"{stem}_{kind}.png")
        if not os.path.exists(p): return None
        im = bpy.data.images.load(p); im.colorspace_settings.name = "sRGB" if srgb else "Non-Color"
        n = nt.nodes.new("ShaderNodeTexImage"); n.image = im; return n
    c = img("color", True); L.new(c.outputs["Color"], b.inputs["Base Color"])
    if emissive:
        L.new(c.outputs["Color"], b.inputs["Emission Color"]); b.inputs["Emission Strength"].default_value = 1.0
    n = img("normal", False)
    if n:
        nm = nt.nodes.new("ShaderNodeNormalMap"); L.new(n.outputs["Color"], nm.inputs["Color"]); L.new(nm.outputs[0], b.inputs["Normal"])
    o = img("orm", False)
    if o:
        sp = nt.nodes.new("ShaderNodeSeparateColor"); L.new(o.outputs["Color"], sp.inputs[0])
        L.new(sp.outputs[1], b.inputs["Roughness"]); L.new(sp.outputs[2], b.inputs["Metallic"])
    return m


def obj_from_bm(name, bm, mat=None):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
    if mat: me.materials.append(mat)
    return o


def box_uv_metres(o):
    """cube-project UVs in metres (for library sets that tile per metre)"""
    me = o.data
    if not me.uv_layers: me.uv_layers.new(name="UVMap")
    uv = me.uv_layers[0].data
    for p in me.polygons:
        n = p.normal; ax = max(range(3), key=lambda i: abs(n[i]))
        for li in p.loop_indices:
            co = o.matrix_world @ me.vertices[me.loops[li].vertex_index].co
            u, v = [(co.y, co.z), (co.x, co.z), (co.x, co.y)][ax]
            uv[li].uv = (u, v)


def bevel_box(name, size, loc, mat, bevel=0.012, seg=2):
    bpy.ops.mesh.primitive_cube_add(location=loc); o = bpy.context.active_object; o.name = name
    o.scale = (size[0] / 2, size[1] / 2, size[2] / 2); bpy.ops.object.transform_apply(scale=True)
    bv = o.modifiers.new("bv", "BEVEL"); bv.width = bevel; bv.segments = seg; bv.limit_method = "ANGLE"
    bpy.ops.object.modifier_apply(modifier="bv")
    o.data.materials.append(mat); box_uv_metres(o); return o


def export(path, objs):
    for o in bpy.context.scene.objects: o.select_set(o in objs)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
                              export_image_format="AUTO", export_materials="EXPORT")
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs if o.type == "MESH")
    report[os.path.basename(path)] = {"tris": tris, "bytes": os.path.getsize(path)}


def arch_outline(W, H, n_arc=24):
    """lancet outline (x across, z up), bottom-left first, counter-clockwise; equilateral pointed arch"""
    spring = H - W * 0.866
    pts = [(-W / 2, 0), (W / 2, 0), (W / 2, spring)]
    # right arc: centre at left jamb (-W/2, spring), radius W, from angle 0 to 60 deg
    for k in range(1, n_arc + 1):
        a = math.radians(60) * k / n_arc
        pts.append((-W / 2 + W * math.cos(a), spring + W * math.sin(a)))
    for k in range(1, n_arc):
        a = math.radians(120) + math.radians(60) * k / n_arc
        pts.append((W / 2 + W * math.cos(a), spring + W * math.sin(a)))
    pts.append((-W / 2, spring))
    return pts


iron = lib_mat("cast_iron", (0.06, 0.06, 0.065, 1), 0.45, 0.8)
lead = bpy.data.materials.new("M_lead"); lead.use_nodes = True
lb = next(n for n in lead.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
lb.inputs["Base Color"].default_value = (0.09, 0.09, 0.10, 1); lb.inputs["Roughness"].default_value = 0.5; lb.inputs["Metallic"].default_value = 0.4
stone = lib_mat("stone_ashlar", (0.80, 0.76, 0.68, 1), 0.7)
oak = lib_mat("wood_oak", (0.45, 0.30, 0.17, 1), 0.5)


def lancet(unit, wid, W=1.0, H=2.6, rows=6):
    reset()
    pts = arch_outline(W, H)
    bm = bmesh.new()
    vs = [bm.verts.new((x, 0.0, z)) for x, z in pts]
    f = bm.faces.new(vs); bmesh.ops.triangulate(bm, faces=[f])
    uvl = bm.loops.layers.uv.new("UVMap")
    for face in bm.faces:
        for l in face.loops: l[uvl].uv = (l.vert.co.x / W + 0.5, l.vert.co.z / H)
    for face in bm.faces:
        if face.normal.y > 0: face.normal_flip()
    m = tex_mat("M_glass_stained", GLASS, wid, emissive=True)
    g = obj_from_bm(f"lotglass__{unit}_{wid}", bm, m)
    parts = [g]
    # saddle bars (inside face) at the panel joints
    spring = H - W * 0.866
    for k in range(1, rows):
        z = H * k / rows
        half = W / 2 if z <= spring else max(0.05, (W * math.sqrt(max(0, 1 - ((z - spring) / W) ** 2)) - W / 2))
        bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.007, depth=2 * half, location=(0, -0.012, z), rotation=(0, math.pi / 2, 0))
        b = bpy.context.active_object; b.name = f"{g.name}_bar{k}"; b.data.materials.append(iron); box_uv_metres(b); parts.append(b)
    # perimeter came: a thin lead strip around the opening
    bm = bmesh.new()
    ring = [bm.verts.new((x, -0.004, z)) for x, z in pts]
    edges = [bm.edges.new((ring[i], ring[(i + 1) % len(ring)])) for i in range(len(ring))]
    r = bmesh.ops.extrude_edge_only(bm, edges=edges)
    for v in [e for e in r["geom"] if isinstance(e, bmesh.types.BMVert)]: v.co.y = 0.004
    fr = obj_from_bm(f"{g.name}_came", bm, lead)
    sol = fr.modifiers.new("s", "SOLIDIFY"); sol.thickness = 0.018; sol.offset = 0
    bpy.context.view_layer.objects.active = fr; bpy.ops.object.modifier_apply(modifier="s")
    parts.append(fr)
    for p in parts[1:]: p.parent = g
    export(os.path.join(OUT, f"lotglass__{unit}_{wid}.glb"), parts)


for wid in ("glass_lancet_virgin", "glass_lancet_nativity", "glass_lancet_assumption"):
    lancet("lot_chapel_nave", wid)
lancet("lot_church_nave", "glass_church_clear")


def rose(unit, wid="glass_rose", D=2.4):
    reset()
    R = D / 2
    bpy.ops.mesh.primitive_circle_add(vertices=128, radius=R * 0.985, fill_type="NGON", location=(0, 0, R), rotation=(math.pi / 2, 0, 0))
    g = bpy.context.active_object; g.name = f"lotglass__{unit}_{wid}"
    bpy.ops.object.transform_apply(rotation=True)
    me = g.data
    bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.triangulate(bm, faces=bm.faces[:])
    uvl = bm.loops.layers.uv.new("UVMap")
    for face in bm.faces:
        if face.normal.y > 0: face.normal_flip()
        for l in face.loops: l[uvl].uv = ((l.vert.co.x + g.location.x) / D + 0.5, (l.vert.co.z) / D + 0.5)
    bm.to_mesh(me); bm.free()
    me.materials.append(tex_mat("M_glass_stained", GLASS, wid, emissive=True))
    parts = [g]
    # stone tracery: rings + 12 spokes + 24 small roundels, square-ish section, standing proud of the glass inside
    def ring(rad, w, depth, segs=96):
        bpy.ops.mesh.primitive_torus_add(major_radius=rad, minor_radius=w / 2, major_segments=segs, minor_segments=6,
                                         location=(0, -depth / 2, R), rotation=(math.pi / 2, 0, 0))
        t = bpy.context.active_object; t.scale = (1, 1, depth / w); bpy.ops.object.transform_apply(scale=True, rotation=True)
        t.data.materials.append(stone); box_uv_metres(t); return t
    c_r, p_r0, p_r1 = R * 0.30, R * 0.36, R * 0.80
    for rad, w, dep in ((c_r + 0.012, 0.05, 0.10), (p_r0 - 0.005, 0.06, 0.12), (p_r1 + 0.01, 0.06, 0.12), (R * 0.84, 0.05, 0.10), (R * 0.985, 0.09, 0.16)):
        parts.append(ring(rad, w, dep))
    for k in range(12):
        a = k * 2 * math.pi / 12 - math.pi / 2
        mid = (p_r0 + p_r1) / 2
        bpy.ops.mesh.primitive_cube_add(location=(math.cos(a) * mid, -0.05, R - math.sin(a) * mid))
        s = bpy.context.active_object; s.scale = ((p_r1 - p_r0) / 2, 0.05, 0.022); s.rotation_euler = (0, a, 0)
        bpy.ops.object.transform_apply(scale=True, rotation=True)
        bv = s.modifiers.new("b", "BEVEL"); bv.width = 0.008; bv.segments = 2; bpy.ops.object.modifier_apply(modifier="b")
        s.data.materials.append(stone); box_uv_metres(s); parts.append(s)
    o_r, s_r = R * 0.905, R * 0.065
    for k in range(24):
        a = k * 2 * math.pi / 24
        bpy.ops.mesh.primitive_torus_add(major_radius=s_r, minor_radius=0.014, major_segments=24, minor_segments=5,
                                         location=(math.cos(a) * o_r, -0.03, R + math.sin(a) * o_r), rotation=(math.pi / 2, 0, 0))
        t = bpy.context.active_object; bpy.ops.object.transform_apply(rotation=True); t.data.materials.append(stone); box_uv_metres(t); parts.append(t)
    # join the tracery into one mesh
    for o in bpy.context.scene.objects: o.select_set(o in parts[1:])
    bpy.context.view_layer.objects.active = parts[1]; bpy.ops.object.join(); tr = bpy.context.active_object; tr.name = f"{g.name}_tracery"
    tr.parent = g
    export(os.path.join(OUT, f"lotglass__{unit}_{wid}.glb"), [g, tr])


rose("lot_chapel_nave")


def taenghwa(unit="lot_temple_hall", Wm=3.6):
    reset()
    im = bpy.data.images.load(os.path.join(TANG, "taenghwa_color.png")); w, h = im.size; Hm = Wm * h / w
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 0), rotation=(math.pi / 2, 0, 0))
    p = bpy.context.active_object; p.name = f"lotart__{unit}_taenghwa"; p.scale = (Wm, Hm, 1); bpy.ops.object.transform_apply(scale=True, rotation=True)
    me = p.data
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co; me.uv_layers[0].data[li].uv = (co.x / Wm + 0.5, co.z / Hm + 0.5)
    if me.polygons[0].normal.y > 0: me.flip_normals()
    me.materials.append(tex_mat("M_taenghwa", TANG, "taenghwa"))
    # silk border (회장) and a red-lacquered frame
    silk = bpy.data.materials.new("M_silk_border"); silk.use_nodes = True
    sb = next(n for n in silk.node_tree.nodes if n.type == "BSDF_PRINCIPLED"); sb.inputs["Base Color"].default_value = (0.10, 0.22, 0.30, 1); sb.inputs["Roughness"].default_value = 0.75
    lac = lib_mat("dancheong_wood", (0.42, 0.06, 0.04, 1), 0.45)
    parts = [p]
    bw = 0.12
    for (sx, sz, x, z) in ((Wm + 2 * bw, bw, 0, Hm / 2 + bw / 2), (Wm + 2 * bw, bw, 0, -Hm / 2 - bw / 2), (bw, Hm, -Wm / 2 - bw / 2, 0), (bw, Hm, Wm / 2 + bw / 2, 0)):
        bpy.ops.mesh.primitive_plane_add(size=1, location=(x, 0.002, z), rotation=(math.pi / 2, 0, 0))
        s = bpy.context.active_object; s.scale = (sx, sz, 1); bpy.ops.object.transform_apply(scale=True, rotation=True)
        if s.data.polygons[0].normal.y > 0: s.data.flip_normals()
        s.data.materials.append(silk); box_uv_metres(s); parts.append(s)
    fw, fd = 0.09, 0.07
    o2 = Wm / 2 + bw + fw / 2; z2 = Hm / 2 + bw + fw / 2
    for (sx, sz, x, z) in ((2 * o2 + fw, fw, 0, z2), (2 * o2 + fw, fw, 0, -z2), (fw, 2 * z2 - fw, -o2, 0), (fw, 2 * z2 - fw, o2, 0)):
        parts.append(bevel_box("frame", (sx, fd, sz), (x, -fd / 2 + 0.01, z), lac, 0.01))
    for q in parts[1:]: q.parent = p
    export(os.path.join(OUT, f"lotart__{unit}_taenghwa.glb"), parts)
    report["taenghwa_size_m"] = [round(Wm + 2 * (bw + fw), 3), round(Hm + 2 * (bw + fw), 3)]


taenghwa()


def cross(name, Wc, Hc, beam, depth, arm_z, mat, bevel=0.012, base=None):
    reset()
    v = bevel_box(name, (beam, depth, Hc), (0, 0, Hc / 2), mat, bevel)
    h = bevel_box(name + "_arm", (Wc, depth, beam), (0, 0, arm_z), mat, bevel)
    parts = [v, h]
    if base:  # moulded edge strips (a carved cross, not two planks)
        for (sx, sz, x, z) in ((beam + 0.03, 0.04, 0, Hc - 0.02), (0.04, beam + 0.03, -Wc / 2 + 0.02, arm_z), (0.04, beam + 0.03, Wc / 2 - 0.02, arm_z)):
            parts.append(bevel_box(name + "_cap", (sx, depth + 0.02, sz), (x, 0, z), mat, 0.008))
    for o in bpy.context.scene.objects: o.select_set(o in parts)
    bpy.context.view_layer.objects.active = v; bpy.ops.object.join(); o = bpy.context.active_object; o.name = name
    return o


o = cross("lotprop__lot_church_nave_cross", 1.0, 1.8, 0.10, 0.07, 1.30, oak, 0.015)
export(os.path.join(OUT, "lotprop__lot_church_nave_cross.glb"), [o])
# Station of the Cross: moulded oak plaque + small oak cross + bronze numeral (14 numeral meshes, pick one per station)
reset()
bronze = bpy.data.materials.new("M_bronze_numeral"); bronze.use_nodes = True
bb = next(n for n in bronze.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
bb.inputs["Base Color"].default_value = (0.62, 0.45, 0.24, 1); bb.inputs["Metallic"].default_value = 0.9; bb.inputs["Roughness"].default_value = 0.35
pl = bevel_box("lotprop__lot_chapel_nave_station", (0.36, 0.035, 0.50), (0, 0, 0.25), oak, 0.012, 3)
inner = bevel_box("st_inner", (0.28, 0.02, 0.42), (0, -0.02, 0.25), oak, 0.008, 2)
cv = bevel_box("st_cross_v", (0.035, 0.03, 0.30), (0, -0.045, 0.29), oak, 0.006)
ch = bevel_box("st_cross_h", (0.18, 0.03, 0.035), (0, -0.045, 0.36), oak, 0.006)
for o in bpy.context.scene.objects: o.select_set(o in (pl, inner, cv, ch))
bpy.context.view_layer.objects.active = pl; bpy.ops.object.join(); pl = bpy.context.active_object
parts = [pl]
ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV"]
for i, rn in enumerate(ROMAN, 1):
    bpy.ops.object.text_add(location=(0, -0.034, 0.075), rotation=(math.pi / 2, 0, 0))
    t = bpy.context.active_object; t.data.body = rn; t.data.align_x = "CENTER"; t.data.size = 0.055; t.data.extrude = 0.004
    t.data.bevel_depth = 0.0008
    bpy.ops.object.convert(target="MESH"); t = bpy.context.active_object; t.name = f"lotprop__lot_chapel_nave_station_num_{i:02d}"
    t.data.materials.clear(); t.data.materials.append(bronze); t.parent = pl; parts.append(t)
export(os.path.join(OUT, "lotprop__lot_chapel_nave_station.glb"), parts)
json.dump(report, open(os.path.join(OUT, "props_report.json"), "w"), indent=1)
print("PROPS", json.dumps(report))
