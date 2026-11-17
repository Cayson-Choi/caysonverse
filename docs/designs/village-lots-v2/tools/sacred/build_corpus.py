# Crucifix corpus for the chapel (no public-domain/CC0 corpus scan was reachable without a login, see SOURCES):
# the HEAD is the real scan of Donatello's crucifix head (SMK KAS1648, public domain), the body is modelled here in
# Blender (skin-modifier armature, subdivided, folded loincloth), the two fused by a voxel remesh. Output: an STL that
# process_statue.py then decimates and bakes like every other statue (surface "bronze").
#   blender -b --factory-startup -P build_corpus.py -- <KAS1648.stl> <out.stl>
import bpy, bmesh, sys, math
from mathutils import Vector, Matrix

src, out = sys.argv[sys.argv.index("--") + 1:][:2]
for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
sc = bpy.context.scene

# ---------- head from the scan ----------
bpy.ops.wm.stl_import(filepath=src)
head = bpy.context.selected_objects[0]; head.name = "head"
me = head.data
bm = bmesh.new(); bm.from_mesh(me)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
zs = [v.co.z for v in bm.verts]; z0, z1 = min(zs), max(zs)
cut = z0 + (z1 - z0) * 0.50     # keep the head and the top of the neck
r = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, cut), plane_no=(0, 0, 1), clear_inner=True)
edges = [e for e in r["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
try: bmesh.ops.holes_fill(bm, edges=edges, sides=0)
except Exception: pass
bm.to_mesh(me); bm.free()
co = [v.co for v in me.vertices]
mn = Vector([min(c[i] for c in co) for i in range(3)]); mx = Vector([max(c[i] for c in co) for i in range(3)])
# head+neck stub: scale so the stub is 0.26 m tall (head ~0.17 m + hair/beard + neck)
s = 0.26 / (mx.z - mn.z)
me.transform(Matrix.Translation(-Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))))
me.transform(Matrix.Scale(s, 4))
head.location = (0.0, 0.0, 0.90)

# ---------- body: skin modifier armature ----------
V = {  # name: (pos, radius x, radius y)
    "pelvis": ((0, 0.0, 0.56), 0.135, 0.095), "waist": ((0, 0.005, 0.68), 0.115, 0.080), "chest": ((0, 0.0, 0.80), 0.150, 0.095),
    "neck": ((0, 0.01, 0.93), 0.050, 0.050),
    "shL": ((0.16, 0.0, 0.87), 0.055, 0.050), "elL": ((0.40, 0.0, 0.965), 0.036, 0.034), "wrL": ((0.60, 0.0, 1.04), 0.026, 0.022),
    "haL": ((0.70, -0.005, 1.075), 0.032, 0.012),
    "hipL": ((0.075, 0.0, 0.52), 0.080, 0.075), "knL": ((0.065, -0.07, 0.29), 0.050, 0.050), "anL": ((0.030, -0.01, 0.06), 0.030, 0.030),
    "ftL": ((0.025, -0.075, 0.0), 0.032, 0.020),
}
for k in list(V):
    if k.endswith("L"):
        p, rx, ry = V[k]; V[k[:-1] + "R"] = ((-p[0], p[1], p[2]), rx, ry)
# crossed feet: the right foot over the left
V["anR"] = ((-0.005, -0.03, 0.08), 0.030, 0.030); V["ftR"] = ((0.0, -0.10, 0.03), 0.032, 0.020)
E = [("pelvis", "waist"), ("waist", "chest"), ("chest", "neck"),
     ("chest", "shL"), ("shL", "elL"), ("elL", "wrL"), ("wrL", "haL"),
     ("chest", "shR"), ("shR", "elR"), ("elR", "wrR"), ("wrR", "haR"),
     ("pelvis", "hipL"), ("hipL", "knL"), ("knL", "anL"), ("anL", "ftL"),
     ("pelvis", "hipR"), ("hipR", "knR"), ("knR", "anR"), ("anR", "ftR")]
names = list(V)
bm = bmesh.new()
vs = {n: bm.verts.new(V[n][0]) for n in names}
for a, b in E: bm.edges.new((vs[a], vs[b]))
bme = bpy.data.meshes.new("body"); bm.to_mesh(bme); bm.free()
body = bpy.data.objects.new("body", bme); sc.collection.objects.link(body)
sk = body.modifiers.new("skin", "SKIN"); sk.branch_smoothing = 0.6
for i, n in enumerate(names):
    body.data.skin_vertices[0].data[i].radius = (V[n][1], V[n][2])
body.data.skin_vertices[0].data[names.index("pelvis")].use_root = True
sub = body.modifiers.new("sub", "SUBSURF"); sub.levels = 3; sub.render_levels = 3
sm = body.modifiers.new("sm", "CORRECTIVE_SMOOTH"); sm.iterations = 6
bpy.context.view_layer.objects.active = body
for m in ("skin", "sub", "sm"): bpy.ops.object.modifier_apply(modifier=m)

# subtle anatomy: ribcage and abdomen relief by displacement in the torso band
tex = bpy.data.textures.new("ribs", "WOOD"); tex.wood_type = "BANDS"; tex.noise_basis_2 = "SIN"
tex.noise_scale = 0.03; tex.turbulence = 0.0
vg = body.vertex_groups.new(name="torso")
for v in body.data.vertices:
    if 0.70 < v.co.z < 0.86 and v.co.y < 0.02 and abs(v.co.x) < 0.14:
        vg.add([v.index], max(0.0, 1 - abs(v.co.z - 0.78) / 0.08), "REPLACE")
dm = body.modifiers.new("ribs", "DISPLACE"); dm.texture = tex; dm.strength = 0.004; dm.vertex_group = "torso"; dm.texture_coords = "GLOBAL"
bpy.ops.object.modifier_apply(modifier="ribs")

# ---------- loincloth: a draped band with folds and a knot on the right hip ----------
bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=1.0, depth=0.16, location=(0, -0.005, 0.505))
cloth = bpy.context.active_object; cloth.name = "cloth"; cloth.scale = (0.160, 0.115, 1.0)
bpy.ops.object.transform_apply(scale=True)
c_me = cloth.data
for v in c_me.vertices:
    ang = math.atan2(v.co.y + 0.005, v.co.x)
    fold = 0.010 * math.sin(ang * 9 + v.co.z * 40) + 0.006 * math.sin(ang * 23)
    flare = (0.585 - v.co.z) * 0.25  # wider toward the hem
    k = 1.0 + (fold + flare) / 0.14
    v.co.x *= k; v.co.y = (v.co.y + 0.005) * k - 0.005
    if v.co.z < 0.45 and v.co.x > 0.02:  # hem lower on the right (as the scan's period crucifixes)
        v.co.z -= 0.05 * min(1.0, v.co.x / 0.12)
sub = cloth.modifiers.new("sub", "SUBSURF"); sub.levels = 2
sol = cloth.modifiers.new("sol", "SOLIDIFY"); sol.thickness = 0.008
bpy.ops.object.modifier_apply(modifier="sub"); bpy.ops.object.modifier_apply(modifier="sol")
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.045, location=(-0.150, -0.03, 0.55))  # the knot (figure's right)
knot = bpy.context.active_object; knot.scale = (0.8, 0.9, 1.3)
bpy.ops.mesh.primitive_cone_add(radius1=0.04, radius2=0.01, depth=0.16, location=(-0.165, -0.035, 0.45))
tail = bpy.context.active_object; tail.rotation_euler = (0.15, -0.25, 0)

# ---------- fuse ----------
for o in sc.objects: o.select_set(o.type == "MESH")
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
rm = body.modifiers.new("rm", "REMESH"); rm.mode = "VOXEL"; rm.voxel_size = 0.0028; rm.use_smooth_shade = True
bpy.ops.object.modifier_apply(modifier="rm")
sm = body.modifiers.new("sm", "CORRECTIVE_SMOOTH"); sm.iterations = 4; sm.scale = 1.0
bpy.ops.object.modifier_apply(modifier="sm")
print("CORPUS tris", sum(len(p.vertices) - 2 for p in body.data.polygons))
for o in sc.objects: o.select_set(o == body)
bpy.ops.wm.stl_export(filepath=out, export_selected_objects=True, ascii_format=False)
