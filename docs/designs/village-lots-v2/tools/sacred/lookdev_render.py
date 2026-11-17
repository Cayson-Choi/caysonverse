# Look-dev renders for a processed sacred prop: warm interior light, close-up at 1 m and the view from the pews/cushions.
#   blender -b --factory-startup -P lookdev_render.py -- <glb> <out_prefix> <mode> [lod]
# mode: "chapel" (stone floor, cream wall, warm key + cool window fill) | "temple" (wood floor, dark red-brown wall, candle-warm)
# lod: "pc" (default) or "phone" (hides the other LOD node)
import bpy, sys, os, math
from mathutils import Vector

a = sys.argv[sys.argv.index("--") + 1:]
glb, prefix, mode = a[0], a[1], a[2]
lod = a[3] if len(a) > 3 else "pc"
plinth = float(a[4]) if len(a) > 4 else (0.9 if mode == "chapel" else 1.1)
for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
sc = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=os.path.abspath(glb))
objs = [o for o in sc.objects if o.type == "MESH"]
for o in objs:
    is_phone = o.name.endswith("_phone")
    o.hide_render = (lod == "pc") == is_phone
vis = [o for o in objs if not o.hide_render]
if os.environ.get("NO_NM") == "1":
    for o in vis:
        for m in o.data.materials:
            for l in list(m.node_tree.links):
                if l.to_socket.name == "Normal": m.node_tree.links.remove(l)
pts = [o.matrix_world @ Vector(c) for o in vis for c in o.bound_box]
mn = Vector([min(p[i] for p in pts) for i in range(3)]); mx = Vector([max(p[i] for p in pts) for i in range(3)])
H = mx.z - mn.z
for o in vis: o.location.z += plinth
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in vis)


def mat(name, col, rough, metal=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = col; b.inputs["Roughness"].default_value = rough; b.inputs["Metallic"].default_value = metal
    return m


def box(name, loc, size, m):
    bpy.ops.mesh.primitive_cube_add(location=loc); o = sc.objects[-1] if False else bpy.context.active_object
    o.name = name; o.scale = (size[0] / 2, size[1] / 2, size[2] / 2); o.data.materials.append(m); return o


if mode == "chapel":
    floor_m = mat("floor", (0.62, 0.58, 0.52, 1), 0.35); wall_m = mat("wall", (0.55, 0.50, 0.44, 1), 0.85); pl_m = mat("plinth", (0.70, 0.66, 0.60, 1), 0.4)
else:
    floor_m = mat("floor", (0.30, 0.19, 0.11, 1), 0.45); wall_m = mat("wall", (0.36, 0.12, 0.08, 1), 0.7); pl_m = mat("plinth", (0.45, 0.10, 0.06, 1), 0.5)
w = max(mx.x - mn.x, mx.y - mn.y)
box("floor", (0, 0, -0.05), (20, 20, 0.1), floor_m)
box("wall", (0, (mx.y) + 0.6 + w * 0.2, 4), (20, 0.2, 8), wall_m)
if plinth > 0:
    box("plinth", (0, 0, plinth / 2), (w * 1.15, (mx.y - mn.y) * 1.15, plinth), pl_m)

# lights: warm key spot from upper front-left, warm fill, cool window rim from the side, soft ambient
world = bpy.data.worlds.new("w"); sc.world = world; world.use_nodes = True
bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs["Color"].default_value = (0.20, 0.17, 0.13, 1) if mode == "chapel" else (0.30, 0.22, 0.14, 1)
bg.inputs["Strength"].default_value = 0.25


def light(kind, loc, energy, col, size=0.5, aim=None, spot=None):
    ld = bpy.data.lights.new("l", kind); ld.energy = energy; ld.color = col
    if kind == "AREA": ld.size = size
    if kind == "SPOT": ld.spot_size = math.radians(spot or 40); ld.spot_blend = 0.6; ld.shadow_soft_size = size
    lo = bpy.data.objects.new("l", ld); sc.collection.objects.link(lo); lo.location = loc
    tgt = aim or Vector((0, 0, plinth + H * 0.6))
    lo.rotation_euler = (tgt - Vector(loc)).to_track_quat("-Z", "Y").to_euler(); return lo


top = plinth + H
light("SPOT", (-1.6, -2.4, top + 1.6), 520, (1.0, 0.82, 0.62), 0.25, spot=35)
light("AREA", (2.2, -2.0, top * 0.7), 70, (1.0, 0.86, 0.70), 2.0)
light("AREA", (3.5, 0.6, top + 0.5), 220 if mode == "chapel" else 120, (0.80, 0.88, 1.0), 1.5)
if mode == "temple":
    # what a gilt statue really reflects in a hall: the bright doors/paper windows behind the visitor, warm walls
    light("AREA", (0, -5.5, plinth + H * 0.6), 900, (1.0, 0.90, 0.75), 5.0)
    light("AREA", (-3, -2, plinth + H * 1.2), 200, (1.0, 0.75, 0.5), 3.0)
    for x in (-0.6, 0.6):
        light("POINT", (x, -1.0, plinth + 0.2), 25, (1.0, 0.62, 0.30), 0.05)

sc.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
try:
    prefs.compute_device_type = "OPTIX"; prefs.get_devices()
    for d in prefs.devices: d.use = d.type == "OPTIX"
    sc.cycles.device = "GPU"
except Exception: pass
sc.cycles.samples = 96; sc.cycles.use_denoising = True
sc.view_settings.view_transform = "AgX"; sc.view_settings.look = "AgX - Medium High Contrast" if "AgX - Medium High Contrast" in [i.identifier for i in bpy.types.ColorManagedViewSettings.bl_rna.properties["look"].enum_items] else "None"
sc.render.resolution_x, sc.render.resolution_y = 1000, 1250
cd = bpy.data.cameras.new("c"); cam = bpy.data.objects.new("c", cd); sc.collection.objects.link(cam); sc.camera = cam
shots = {
    "close1m": (Vector((0.25, -1.0, plinth + H * 0.82)), Vector((0, 0, plinth + H * 0.80)), 40),
    "face": (Vector((0.0, -1.2, plinth + H * 0.66)), Vector((0, 0, plinth + H * 0.66)), 50),
    "full": (Vector((0.5, -max(2.2, H * 1.9), plinth + H * 0.55)), Vector((0, 0, plinth + H * 0.5)), 40),
    "seat": (Vector((-1.2, -6.0, 1.1 if mode == "chapel" else 0.75)), Vector((0, 0, plinth + H * 0.55)), 50),
}
for tag, (loc, tgt, lens) in shots.items():
    cd.lens = lens; cam.location = loc; cam.rotation_euler = (tgt - loc).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = f"{prefix}_{lod}_{tag}.png"
    bpy.ops.render.render(write_still=True)
print("LOOKDEV", glb, lod, "tris", tris, "H", round(H, 3))
