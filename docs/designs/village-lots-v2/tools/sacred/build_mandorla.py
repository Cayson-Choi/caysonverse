# Modelled 광배 (mandorla: a flame-edged ogive body halo + a lotus-petal head halo) for the 본존불 (B3 re-do, 2026-11-18).
# The scanned statuette's own halo was a thin photogrammetry sheet (lumpy at 2.8 m), so process_statue.py cuts it off ("cut") and this
# builds a clean, crisp, brand-new gilt one in the statue's own frame (origin = bottom centre, face toward Blender -Y = glTF +Z).
#   blender -b --factory-startup -P build_mandorla.py -- <out.glb> [head_x head_y head_z]
# Writes <out.glb> with two mesh nodes: lotstatue__lot_temple_hall_buddha_halo (PC) and ..._halo_phone. Material: one gilt PBR.
import bpy, bmesh, sys, os, math, random
from mathutils import Vector, Matrix

a = sys.argv[sys.argv.index("--") + 1:]
OUT = os.path.abspath(a[0])
HX, HY, HZ = (float(x) for x in a[1:4]) if len(a) >= 4 else (0.0, 0.14, 1.80)
NAME = "lotstatue__lot_temple_hall_buddha_halo"
BACK = 0.30            # the plate sits this far behind the head axis (Blender +Y = behind the figure)
for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
sc = bpy.context.scene
random.seed(7)

gold = bpy.data.materials.new("M_gilt"); gold.use_nodes = True
b = next(n for n in gold.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
b.inputs["Base Color"].default_value = (0.86, 0.50, 0.10, 1); b.inputs["Metallic"].default_value = 0.35; b.inputs["Roughness"].default_value = 0.30
gold_dark = bpy.data.materials.new("M_gilt_deep"); gold_dark.use_nodes = True
b2 = next(n for n in gold_dark.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
b2.inputs["Base Color"].default_value = (0.50, 0.08, 0.04, 1); b2.inputs["Metallic"].default_value = 0.1; b2.inputs["Roughness"].default_value = 0.5  # cinnabar-lacquered field

parts = []


def add_obj(name, verts, faces, mat, thick=0.0, bevel=0.0):
    me = bpy.data.meshes.new(name); me.from_pydata(verts, [], faces); me.update()
    ob = bpy.data.objects.new(name, me); sc.collection.objects.link(ob); me.materials.append(mat)
    bpy.context.view_layer.objects.active = ob
    for o in sc.objects: o.select_set(o is ob)
    if thick:
        m = ob.modifiers.new("s", "SOLIDIFY"); m.thickness = thick; m.offset = 0.0; bpy.ops.object.modifier_apply(modifier=m.name)
    if bevel:
        m = ob.modifiers.new("b", "BEVEL"); m.width = bevel; m.segments = 1; m.limit_method = "ANGLE"; m.angle_limit = math.radians(35)
        bpy.ops.object.modifier_apply(modifier=m.name)
    parts.append(ob); return ob


def tri_fan(pts):
    """a convex-ish polygon (list of (x, z)) as one n-gon in the XZ plane at y = 0 (triangulated by Blender on export)"""
    return [(p[0], 0.0, p[1]) for p in pts], [tuple(range(len(pts)))]


# ---- body aura: ogive outline (x, z) around the figure
Z0, Z1 = 0.95, 2.85        # bottom (hidden behind the lotus) and the flame tip
WMAX = 0.80


def half_w(s, k=1.0):
    return WMAX * k * (math.sin(math.pi * min(max(s, 0.0), 1.0)) ** 0.72) * (1.0 - 0.18 * s)


def outline(k, z0=Z0, z1=Z1, n=64):
    right = [(half_w(i / n, k), z0 + (z1 - z0) * i / n) for i in range(n + 1)]
    left = [(-x, z) for x, z in reversed(right[1:-1])]
    return right + left


def at(pts, y):
    return [(HX + x, HY + BACK + y, z) for x, z in pts]


# plate 1: deep red lacquered field
v, f = tri_fan(outline(0.88)); v = [(HX + x, HY + BACK + 0.0, z) for x, _, z in v]
add_obj("plate", v, f, gold_dark, 0.02, 0.004)
# plate 2: gilt rim band (a ring: outer outline - inner outline), raised
n = 90
o_out = outline(1.0); o_in = outline(0.90)
ring = []
faces = []
for i in range(len(o_out)):
    ring.append(o_out[i])
for i in range(len(o_in)):
    ring.append(o_in[i])
N = len(o_out); M = len(o_in)
for i in range(N):
    faces.append((i, (i + 1) % N, N + (i + 1) % M, N + i))
add_obj("rim", [(HX + x, HY + BACK - 0.012, z) for x, z in ring], faces, gold, 0.05, 0.006)
# a second inner thin ring and a beaded row between them
o_mid = outline(0.80)
ring2 = o_mid + outline(0.77)
M2 = len(o_mid)
faces2 = [(i, (i + 1) % M2, M2 + (i + 1) % M2, M2 + i) for i in range(M2)]
add_obj("rim2", [(HX + x, HY + BACK - 0.006, z) for x, z in ring2], faces2, gold, 0.035, 0.004)


def flame_poly(L, w, sway, curl, seg=22):
    """a flame tongue (x, z) pointing +z from the origin: S-sway, tapering width, hooked tip"""
    left, right = [], []
    for i in range(seg + 1):
        t = i / seg
        cx = sway * math.sin(t * math.pi * 1.5) * t + curl * (t ** 3)
        cz = L * t
        hw = w * (1 - t) ** 0.85 * (1 + 0.25 * math.sin(t * math.pi * 2))
        left.append((cx - hw, cz)); right.append((cx + hw, cz))
    return left + list(reversed(right[:-1]))


def place_poly(poly, ang, px, pz):
    ca, sa = math.cos(ang), math.sin(ang)
    return [(px + x * ca + z * sa, pz - x * sa + z * ca) for x, z in poly]


# flame tongues around the outer edge (pointing outward along the outline normal), big and small alternating
verts_all, faces_all = [], []
NF = 44
samples = []
for i in range(1, NF):
    s = i / NF
    k = 1.02
    x, z = half_w(s, k), Z0 + (Z1 - Z0) * s
    # normal direction of the right outline (outward = +x,+z-ish)
    s2 = min(1, s + 0.01); x2, z2 = half_w(s2, k), Z0 + (Z1 - Z0) * s2
    tx, tz = x2 - x, z2 - z + 1e-9
    nx, nz = tz, -tx
    ln = math.hypot(nx, nz); nx, nz = nx / ln, nz / ln
    samples.append((s, x, z, nx, nz))
for idx, (s, x, z, nx, nz) in enumerate(samples):
    big = idx % 2 == 0
    L = (0.20 if big else 0.13) * (1.0 + 0.7 * (1 - abs(2 * s - 1)) ** 2 * 0.3)
    w = 0.050 if big else 0.034
    # rotate: tongue +z axis -> outward normal, bent upward a little (flames lick up)
    ang_to_n = math.atan2(nx, nz)
    ang = ang_to_n * 0.75
    for sgn in (1, -1):
        poly = flame_poly(L, w, 0.03 * sgn, 0.05 * sgn * (-1), 9)
        px = x * sgn; pzz = z
        ang_s = ang * sgn
        pp = place_poly([(xx * sgn, zz) for xx, zz in poly], ang_s, px, pzz)
        base = len(verts_all)
        verts_all += [(HX + xx, HY + BACK - 0.02, zz) for xx, zz in pp]
        faces_all.append(tuple(range(base, base + len(pp))))
# the top tip: a tall central flame
tip = flame_poly(0.32, 0.075, 0.0, 0.0, 12)
base = len(verts_all)
verts_all += [(HX + xx, HY + BACK - 0.02, Z1 - 0.06 + zz) for xx, zz in tip]
faces_all.append(tuple(range(base, base + len(tip))))
add_obj("flames", verts_all, faces_all, gold, 0.04, 0.005)

# ---- inner flame sweeps: a row of small curled flames inside the rim, pointing up along the sides
v2, f2 = [], []
for sgn in (1, -1):
    for j in range(13):
        s = 0.13 + 0.62 * j / 12
        xx = half_w(s, 0.74) * sgn; zz = Z0 + (Z1 - Z0) * s
        L = 0.17 + 0.05 * math.sin(j * 1.7)
        poly = flame_poly(L, 0.035, 0.02 * sgn, 0.045 * sgn, 7)
        pp = place_poly([(x_ * sgn, z_) for x_, z_ in poly], 0.0, xx, zz)
        base = len(v2); v2 += [(HX + p[0], HY + BACK - 0.03, p[1]) for p in pp]; f2.append(tuple(range(base, base + len(pp))))
add_obj("inner_flames", v2, f2, gold, 0.03, 0.004)


# ---- head halo (두광): a lotus-petal disc around the head, in front of the plate
def ring_curve(name, r, thick, y, mat, z=None):
    cu = bpy.data.curves.new(name, "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = thick; cu.bevel_resolution = 2; cu.resolution_u = 32
    sp = cu.splines.new("POLY"); k = 64; sp.points.add(k - 1)
    for i in range(k):
        t = 2 * math.pi * i / k; sp.points[i].co = (r * math.cos(t), 0.0, r * math.sin(t), 1)
    sp.use_cyclic_u = True
    ob = bpy.data.objects.new(name, cu); sc.collection.objects.link(ob)
    ob.location = (HX, HY + y, HZ if z is None else z)
    bpy.context.view_layer.objects.active = ob
    for o in sc.objects: o.select_set(o is ob)
    bpy.ops.object.convert(target="MESH"); ob = bpy.context.active_object
    ob.data.materials.append(mat); parts.append(ob); return ob


HY2 = HY + BACK - 0.05           # head halo plane (in front of the body plate)
# a cinnabar disc with a gilt boss
bm = bmesh.new(); bmesh.ops.create_circle(bm, cap_ends=True, radius=0.50, segments=64)
me = bpy.data.meshes.new("disc"); bm.to_mesh(me); bm.free()
ob = bpy.data.objects.new("disc", me); sc.collection.objects.link(ob); me.materials.append(gold_dark)
ob.rotation_euler = (math.pi / 2, 0, 0); ob.location = (HX, HY2 + 0.005, HZ); parts.append(ob)
bpy.context.view_layer.objects.active = ob
for o in sc.objects: o.select_set(o is ob)
m = ob.modifiers.new("s", "SOLIDIFY"); m.thickness = 0.03; bpy.ops.object.modifier_apply(modifier=m.name)
for r, t in ((0.50, 0.020), (0.44, 0.012), (0.33, 0.010), (0.205, 0.014)):
    ring_curve(f"ring{r}", r, t, HY2 - 0.02, gold)
# beads between two rings
bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=4, radius=0.0145)
bead = bpy.context.active_object; bead.data.materials.append(gold)
bd = []
for i in range(72):
    t = 2 * math.pi * i / 72
    o = bead.copy(); o.data = bead.data; sc.collection.objects.link(o)
    o.location = (HX + 0.385 * math.cos(t), HY2 - 0.022, HZ + 0.385 * math.sin(t)); bd.append(o)
for o in bd: o.select_set(True)
bpy.context.view_layer.objects.active = bd[0]
for o in sc.objects: o.select_set(o in bd)
bpy.ops.object.join(); parts.append(bpy.context.active_object); bpy.data.objects.remove(bead, do_unlink=True)

# a ring of lotus petals around the disc edge
pv, pf = [], []
NP = 28
for i in range(NP):
    t = 2 * math.pi * i / NP
    nx, nz = math.cos(t), math.sin(t)
    # petal pointing outward: teardrop outline in local (u across, v outward)
    pts = []
    for j in range(9):
        s = j / 8; hw = 0.055 * math.sin(math.pi * min(1, s * 1.05)) ** 0.8 * (1 - 0.15 * s)
        pts.append((hw, 0.50 + 0.14 * s))
    pts = pts + [(-x, z) for x, z in reversed(pts[1:-1])]
    ca, sa = math.cos(t - math.pi / 2), math.sin(t - math.pi / 2)
    base = len(pv)
    for (u, v_) in pts:
        # rotate (u, v) into the XZ plane: outward axis = (cos t, sin t)
        px = u * (-math.sin(t)) + v_ * math.cos(t); pz = u * math.cos(t) + v_ * math.sin(t)
        pv.append((HX + px, HY2 - 0.005, HZ + pz))
    pf.append(tuple(range(base, base + len(pts))))
add_obj("petals", pv, pf, gold, 0.03, 0.005)

# ---- join and export
for o in parts: print("PART", o.name, sum(len(p.vertices) - 2 for p in o.data.polygons))
for o in sc.objects: o.select_set(o in parts)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
ob = bpy.context.active_object; ob.name = NAME
# the plate faces glTF +Z when the face does: normals out toward -Y (Blender), i.e. toward the viewer
bpy.ops.object.shade_smooth()
try:
    ob.data.polygons.foreach_set("use_smooth", [True] * len(ob.data.polygons))
except Exception: pass
mm = ob.modifiers.new("ws", "WEIGHTED_NORMAL"); bpy.ops.object.modifier_apply(modifier=mm.name) if False else None
tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
ph = ob.copy(); ph.data = ob.data.copy(); ph.name = NAME + "_phone"; sc.collection.objects.link(ph)
for o in sc.objects: o.select_set(False)
bpy.context.view_layer.objects.active = ph; ph.select_set(True)
d = ph.modifiers.new("dec", "DECIMATE"); d.ratio = 0.35; d.use_collapse_triangulate = True
bpy.ops.object.modifier_apply(modifier="dec")
for o in sc.objects: o.select_set(o.name in (NAME, NAME + "_phone"))
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
                          export_materials="EXPORT", export_normals=True, export_extras=False)
print("MANDORLA tris", tris, "phone", sum(len(p.vertices) - 2 for p in ph.data.polygons), "bytes", os.path.getsize(OUT))
