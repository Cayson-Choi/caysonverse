# An ORIGINAL 본존불 (Shakyamuni seated in the earth-touching mudra on a lotus throne), sculpted procedurally for this project
# (owner 2026-11-18: "니가 멋지게 불상을 제작해도 돼"). Not a scan, no outside model: metaball sculpt -> voxel union -> fold / face
# carving by displacement -> two high-poly STLs that process_statue.py decimates and bakes (normal / AO / gilt) for the game:
#   buddha_body.stl    the throne (two rows of lotus petals, drum), the legs, torso and arms with the robe folds
#   buddha_detail.stl  the head (face, ears, crown knot, snail curls) and both hands: a finer voxel, a UV atlas of their own
# Frame: metres, Z up, the figure faces Blender -Y (glTF +Z after export), origin = bottom centre of the throne.
#   blender -b --factory-startup -P build_buddha.py -- <out_dir>
import bpy, bmesh, sys, os, math
import numpy as np
from mathutils import Vector, Euler

OUT = os.path.abspath(sys.argv[sys.argv.index("--") + 1])
os.makedirs(OUT, exist_ok=True)
sc = bpy.context.scene
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
K = 0.573  # a metaball element of radius 1, stiffness 2, threshold 0.6 reaches 0.573 x its size


def mball(name, res):
    mb = bpy.data.metaballs.new(name)
    mb.resolution = res
    mb.render_resolution = res
    mb.threshold = 0.6
    ob = bpy.data.objects.new(name, mb)
    sc.collection.objects.link(ob)
    return mb, ob


def ell(mb, c, h, rot=(0, 0, 0), neg=False, stiff=2.0):
    """an ellipsoid element with half extents h = (hx, hy, hz) at c"""
    e = mb.elements.new(type="ELLIPSOID")
    e.co = c
    e.radius = 1.0
    e.size_x, e.size_y, e.size_z = h[0] / K, h[1] / K, h[2] / K
    e.stiffness = stiff
    e.use_negative = neg
    e.rotation = Euler(rot).to_quaternion()
    return e


def chain(mb, a, b, ha, hb, n=6, side=None):
    """ellipsoids along a -> b, half extents from ha to hb (limbs)"""
    a, b = Vector(a), Vector(b)
    for i in range(n + 1):
        t = i / n
        p = a.lerp(b, t)
        h = tuple(ha[k] * (1 - t) + hb[k] * t for k in range(3))
        ell(mb, tuple(p), h)


def to_mesh(ob, name):
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.convert(target="MESH")
    o = bpy.context.active_object
    o.name = name
    return o


def smooth_ridge(phi, p=0.6):
    """a crisp raised fold ridge in 0..1 from a phase (rounded crest, tight valley)"""
    return 1.0 - np.abs(np.sin(np.pi * phi)) ** p


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def displace(o, fn):
    me = o.data
    n = len(me.vertices)
    co = np.empty(n * 3, np.float64)
    me.vertices.foreach_get("co", co)
    co = co.reshape(n, 3)
    nr = np.empty(n * 3, np.float64)
    me.vertices.foreach_get("normal", nr)
    nr = nr.reshape(n, 3)
    d = fn(co[:, 0], co[:, 1], co[:, 2], nr)
    co += nr * d[:, None]
    me.vertices.foreach_set("co", co.ravel())
    me.update()


# ---------------------------------------------------------------------------------------------------- the body
mb, mo = mball("body", 0.009)
ell(mb, (0, 0.02, 0.98), (0.30, 0.21, 0.17))
ell(mb, (0, 0.0, 1.17), (0.34, 0.23, 0.22))
ell(mb, (0, 0.0, 1.36), (0.37, 0.21, 0.14))
for sx in (-1, 1):
    ell(mb, (sx * 0.37, 0.0, 1.40), (0.105, 0.105, 0.10))
ell(mb, (0, -0.01, 1.52), (0.070, 0.070, 0.06))
# the lap (crossed legs under the robe), knees, front hem
ell(mb, (0, -0.14, 0.76), (0.60, 0.34, 0.15))
for sx in (-1, 1):
    ell(mb, (sx * 0.54, -0.22, 0.82), (0.22, 0.24, 0.14))
ell(mb, (0, -0.34, 0.72), (0.45, 0.12, 0.09))
ell(mb, (0, -0.05, 0.90), (0.48, 0.30, 0.10))
# sleeves: the right arm (viewer's left, -x) down over the knee, the left in the lap
chain(mb, (-0.38, 0.02, 1.36), (-0.47, 0.04, 1.08), (0.095, 0.095, 0.095), (0.080, 0.080, 0.080), 5)
chain(mb, (-0.47, 0.04, 1.08), (-0.56, -0.22, 0.95), (0.080, 0.080, 0.080), (0.060, 0.060, 0.060), 6)
chain(mb, (0.38, 0.02, 1.36), (0.45, 0.02, 1.06), (0.095, 0.095, 0.095), (0.080, 0.080, 0.080), 5)
chain(mb, (0.45, 0.02, 1.06), (0.19, -0.24, 0.93), (0.080, 0.080, 0.080), (0.060, 0.060, 0.060), 6)
body = to_mesh(mo, "body_blob")

# the lotus throne: two rows of pointed petals, a drum, moulded rings
parts = [body]


def petal(rad, cz, hx, hy, hz, tilt, ang):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=14, v_segments=10, radius=1.0)
    for v in bm.verts:
        t = (v.co.z + 1) / 2
        v.co.x *= (1 - 0.62 * t * t) * hx
        v.co.y *= hy * (1 - 0.3 * t)
        v.co.z *= hz
    me = bpy.data.meshes.new("petal")
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new("petal", me)
    sc.collection.objects.link(o)
    from mathutils import Matrix
    o.matrix_world = Matrix.Rotation(ang, 4, "Z") @ Matrix.Translation((0, -rad, cz)) @ Matrix.Rotation(math.radians(tilt), 4, "X")
    return o


for i in range(16):
    parts.append(petal(0.50, 0.30, 0.105, 0.05, 0.20, 24, 2 * math.pi * i / 16))
for i in range(12):
    parts.append(petal(0.38, 0.43, 0.105, 0.05, 0.19, 12, 2 * math.pi * (i + 0.5) / 12))
for r0, z0, z1 in ((0.50, 0.0, 0.08), (0.44, 0.08, 0.22), (0.47, 0.50, 0.66)):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=40, radius1=r0, radius2=r0, depth=z1 - z0)
    for v in bm.verts:
        v.co.z += (z0 + z1) / 2
    me = bpy.data.meshes.new("drum")
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new("drum", me)
    sc.collection.objects.link(o)
    parts.append(o)
bpy.ops.object.select_all(action="DESELECT")
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
body = bpy.context.active_object
# the union: a voxel remesh fuses the throne and the figure into one shell
mod = body.modifiers.new("vx", "REMESH")
mod.mode = "VOXEL"
mod.voxel_size = 0.0055
mod.adaptivity = 0.0
bpy.ops.object.modifier_apply(modifier="vx")
mod = body.modifiers.new("sm", "SMOOTH")
mod.factor = 0.5
mod.iterations = 2
bpy.ops.object.modifier_apply(modifier="sm")


def body_folds(x, y, z, n):
    d = np.zeros_like(x)
    front = smoothstep(0.06, -0.06, y)               # the front of the figure
    # the diagonal 가사 band across the chest, from the right hip to the left shoulder (a raised, rounded edge)
    ang = math.radians(35)
    u = x * math.cos(ang) + (z - 1.2) * math.sin(ang)
    band = smoothstep(0.055, 0.0, np.abs(u - 0.02))
    torso = smoothstep(0.95, 1.05, z) * smoothstep(1.52, 1.44, z) * front
    d += 0.010 * band * torso
    # fine vertical pleats of the robe on the chest and belly
    ph = 24.0 * x + 2.5 * (z - 1.2) ** 2
    d += 0.0045 * smooth_ridge(ph) * torso * (1 - band)
    # the neckline: a shallow V
    vline = np.abs(x) * 1.2 + (z - 1.47)
    d += 0.006 * smoothstep(0.03, 0.0, np.abs(vline)) * front * smoothstep(1.35, 1.45, z) * smoothstep(1.55, 1.50, z)
    # the lap: folds that sweep out from the knees in U shapes over the crossed legs and the front of the shins
    lap = smoothstep(0.62, 0.70, z) * smoothstep(1.0, 0.86, z) * smoothstep(0.1, -0.1, y)
    for k in (-1, 1):
        rho = np.hypot(x - k * 0.50, (y + 0.20) * 1.35)
        d += 0.0105 * smooth_ridge(rho * 9.5) * lap * smoothstep(0.56, 0.30, rho)
    rho2 = np.hypot(x * 0.8, (y + 0.40) * 2.0)
    d += 0.008 * smooth_ridge(rho2 * 7.0 + 0.2) * lap * smoothstep(0.7, 0.2, np.abs(x))
    # the sleeves: long soft folds along the arms
    for k in (-1, 1):
        arm = smoothstep(0.17, 0.08, np.hypot(x - k * 0.38, y - 0.02)) * smoothstep(0.92, 1.05, z) * smoothstep(1.40, 1.30, z)
        d += 0.004 * smooth_ridge(14.0 * (z - 1.0) + 3.0 * k * x) * arm
    # moulded petal veins on the lotus
    pet = smoothstep(0.62, 0.55, z) * smoothstep(0.1, 0.2, z)
    ang_p = np.arctan2(y, x)
    d += 0.004 * smooth_ridge(ang_p * 16 / (2 * math.pi) + 0.5, 0.5) * pet
    return d


displace(body, lambda x, y, z, n: body_folds(x, y, z, n))
body.name = "buddha_body"

# ---------------------------------------------------------------------------------------------------- the head and the hands
HC = Vector((0.0, -0.005, 1.72))   # head centre
mb, mo = mball("head", 0.0035)


def E(dx, dy, dz, hx, hy, hz, **kw):
    return ell(mb, (HC.x + dx, HC.y + dy, HC.z + dz), (hx, hy, hz), **kw)


E(0, 0.012, 0.012, 0.090, 0.100, 0.105)            # cranium
E(0, -0.02, -0.012, 0.082, 0.085, 0.095)           # forehead and face
E(0, -0.022, -0.060, 0.060, 0.070, 0.060)          # jaw
E(0, -0.05, -0.095, 0.032, 0.035, 0.028)           # chin
for sx in (-1, 1):
    E(sx * 0.045, -0.05, -0.045, 0.035, 0.040, 0.035)       # cheeks
    E(sx * 0.035, -0.082, 0.026, 0.034, 0.016, 0.008, rot=(0, math.radians(-sx * 8), 0))   # brow ridges
    E(sx * 0.098, 0.0, -0.030, 0.010, 0.024, 0.058)         # long ears
    E(sx * 0.016, -0.093, -0.050, 0.009, 0.012, 0.010)       # nostril wings
E(0, -0.09, -0.020, 0.011, 0.022, 0.035)           # nose bridge
E(0, -0.105, -0.048, 0.014, 0.014, 0.012)          # nose tip
E(0, -0.088, -0.073, 0.028, 0.011, 0.008)          # upper lip
E(0, -0.086, -0.088, 0.024, 0.012, 0.009)          # lower lip
E(0, -0.002, -0.150, 0.052, 0.055, 0.090)          # neck
E(0, 0.012, 0.095, 0.062, 0.066, 0.040)            # the crown knot (육계)
E(0, 0.012, 0.128, 0.030, 0.030, 0.025)
E(0, -0.098, 0.040, 0.005, 0.005, 0.005)           # the urna
head = to_mesh(mo, "head_blob")


def face_carve(x, y, z, n):
    xl, yl, zl = x - HC.x, y - HC.y, z - HC.z
    d = np.zeros_like(x)
    fr = smoothstep(-0.055, -0.085, yl)             # the front of the face
    for sx in (-1, 1):
        ex = sx * 0.036
        dx = xl - ex
        lid = 0.014 - 0.0045 * (1 - np.clip(dx / 0.025, -1, 1) ** 2)   # the downcast eye arc
        w = smoothstep(0.027, 0.020, np.abs(dx))
        d -= 0.0042 * np.exp(-(((zl - lid) / 0.0022) ** 2)) * w * fr                    # the eye slit
        d += 0.0030 * np.exp(-(((zl - lid - 0.0075) / 0.0042) ** 2)) * w * fr           # the lid above it
        d += 0.0022 * np.exp(-(((zl - lid - 0.022) / 0.0040) ** 2)) * w * fr            # the brow
        d -= 0.0016 * np.exp(-(((zl - lid + 0.008) / 0.0040) ** 2)) * w * fr            # the lower lid
    # the mouth: a soft line with the corners lifted, and the philtrum groove
    mouth_z = -0.0805 + 0.004 * (np.abs(xl) / 0.026) ** 2
    d -= 0.0030 * np.exp(-(((zl - mouth_z) / 0.0017) ** 2)) * smoothstep(0.030, 0.022, np.abs(xl)) * fr
    d -= 0.0016 * np.exp(-((xl / 0.0035) ** 2)) * smoothstep(-0.06, -0.075, zl) * smoothstep(-0.085, -0.073, zl) * fr
    # three neck lines
    for zc in (-0.118, -0.134, -0.150):
        d -= 0.0030 * np.exp(-(((zl - zc) / 0.0025) ** 2)) * smoothstep(0.0, -0.02, yl)
    return d


displace(head, face_carve)
# the snail-shell curls (나발): rows of small beads over the cranium and the crown knot, from a level hairline up
cr = [(HC + Vector((0, 0.012, 0.012)), (0.090, 0.100, 0.105), 0.050), (HC + Vector((0, 0.012, 0.095)), (0.062, 0.066, 0.040), 0.082)]
curls = []
bm = bmesh.new()
cy_axis = HC.y + 0.012
for cen, rad, zmin in cr:
    lat = math.radians(8)
    while lat < math.pi / 2:
        r_xy = (rad[0] + rad[1]) / 2 * math.cos(lat)
        n = max(1, int(2 * math.pi * r_xy / 0.0125))
        for i in range(n):
            lon = 2 * math.pi * (i + 0.5 * (int(lat * 40) % 2)) / n
            p = Vector((cen.x + rad[0] * math.cos(lat) * math.cos(lon), cen.y + rad[1] * math.cos(lat) * math.sin(lon), cen.z + rad[2] * math.sin(lat)))
            if p.z - HC.z < zmin:
                continue
            m = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.0072)
            for v in m["verts"]:
                v.co += p
        lat += 0.0125 / ((rad[0] + rad[1] + rad[2]) / 3)
    # (the bm accumulates all beads)
me = bpy.data.meshes.new("curls")
bm.to_mesh(me)
bm.free()
cu = bpy.data.objects.new("curls", me)
sc.collection.objects.link(cu)
# the hands
mb, mo = mball("hands", 0.0032)
# right hand hangs over the knee, fingers down; left hand lies in the lap, palm up
ell(mb, (-0.548, -0.285, 0.895), (0.013, 0.036, 0.050))                        # palm
for j in range(4):
    yj = -0.285 + (j - 1.5) * 0.0165
    for k in range(3):
        ell(mb, (-0.55 - 0.001 * k, yj - 0.006 * k, 0.835 - 0.034 * k), (0.0072, 0.0075, 0.016), stiff=3.0)
ell(mb, (-0.540, -0.325, 0.880), (0.011, 0.016, 0.026), rot=(math.radians(-25), 0, 0))
ell(mb, (-0.535, -0.345, 0.850), (0.009, 0.012, 0.020), rot=(math.radians(-35), 0, 0))
ell(mb, (0.13, -0.265, 0.925), (0.046, 0.050, 0.012))                          # palm
for j in range(4):
    yj = -0.265 + (j - 1.5) * 0.0165
    for k in range(3):
        ell(mb, (0.085 - 0.034 * k, yj - 0.003 * k, 0.925 - 0.002 * k), (0.016, 0.0075, 0.0072), stiff=3.0)
ell(mb, (0.15, -0.318, 0.930), (0.020, 0.014, 0.010), rot=(0, 0, math.radians(30)))
ell(mb, (0.12, -0.335, 0.930), (0.016, 0.011, 0.009), rot=(0, 0, math.radians(35)))
hands = to_mesh(mo, "hands_blob")
from mathutils import Matrix
HS = Matrix.Translation(HC) @ Matrix.Scale(1.14, 4) @ Matrix.Translation(-HC)
for o_ in (head, cu):
    o_.data.transform(HS)
    o_.data.update()
bpy.ops.object.select_all(action="DESELECT")
for o in (head, cu, hands):
    o.select_set(True)
bpy.context.view_layer.objects.active = head
bpy.ops.object.join()
detail = bpy.context.active_object
detail.name = "buddha_detail"
# smooth shading only matters for the exports' normals
for o in (body, detail):
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.shade_smooth()
    path = os.path.join(OUT, o.name + ".stl")
    bpy.ops.wm.stl_export(filepath=path, export_selected_objects=True)
    print("BUDDHA", o.name, len(o.data.polygons), "faces", [round(v, 3) for v in (min(v.co.z for v in o.data.vertices), max(v.co.z for v in o.data.vertices))])
