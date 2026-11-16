"""The framed "big catch" photo for the fishing shop's wall (lake_shop_interior.glb): the game's own crucian carp (붕어) from
lake_fish.glb lying on a white measuring board on damp grass, shot from above like an angler's phone photo. No people.

  blender -b -P docs/designs/lake-fishing/tools/render_shop_photo.py -- --out art/shop/tex/catch_photo.png [--fish fish_crucian_carp]

Feeds make_shop_interior_textures.py (the photo goes into the props atlas, framed and printed)."""
import math
import os
import random
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    return ARGV[ARGV.index(name) + 1] if name in ARGV else default


OUT = os.path.abspath(arg("--out", os.path.join(REPO, "art", "shop", "tex", "catch_photo.png")))
FISH = arg("--fish", "fish_crucian_carp")
os.makedirs(os.path.dirname(OUT), exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=os.path.join(REPO, "client", "public", "models", "lake", "lake_fish.glb"))
fish = bpy.data.objects[FISH]
for o in list(bpy.data.objects):
    keep = o == fish or o.parent == fish
    if not keep:
        bpy.data.objects.remove(o, do_unlink=True)
fish.location = (0, 0, 0)
fish.rotation_mode = "XYZ"
bpy.context.view_layer.update()
# lay the fish on its side on the board: find its long axis and its height
mesh = [o for o in bpy.data.objects if o.type == "MESH"][0]
pts = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
size = hi - lo
print("fish bbox", size)
# glTF import: +Y up in Blender = +Z. The fish's flank faces +-x or +-y; roll it 90 deg about its long axis so a flank faces up
long_axis = 0 if size.x >= size.y else 1
if long_axis == 0:
    fish.rotation_euler = (math.radians(90), 0, 0)
else:
    fish.rotation_euler = (0, math.radians(90), math.radians(90))
bpy.context.view_layer.update()
pts = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
L = max(hi.x - lo.x, hi.y - lo.y)
s = 0.32 / L  # a 32 cm 붕어
fish.scale = (s, s, s)
bpy.context.view_layer.update()
pts = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
fish.location -= Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z - 0.036))
if hi.y - lo.y > hi.x - lo.x:
    fish.rotation_euler.z += math.radians(90)


def mat(name, col, rough=0.6, tex=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*col, 1.0)
    b.inputs["Roughness"].default_value = rough
    if tex:
        nt = m.node_tree
        noise = nt.nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = tex[0]
        noise.inputs["Detail"].default_value = 12
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].color = (*tex[1], 1)
        ramp.color_ramp.elements[1].color = (*tex[2], 1)
        nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    return m


# damp grass: many thin blades on a dark soil plane
bpy.ops.mesh.primitive_plane_add(size=1.4, location=(0, 0, -0.001))
ground = bpy.context.object
ground.data.materials.append(mat("soil", (0.05, 0.06, 0.03), 0.9, (60, (0.03, 0.04, 0.02), (0.1, 0.12, 0.05))))
rng = random.Random(4)
import bmesh  # noqa: E402

bm = bmesh.new()
for _ in range(9000):
    x, y = rng.uniform(-0.7, 0.7), rng.uniform(-0.45, 0.45)
    if abs(x - 0.02) < 0.27 and abs(y + 0.02) < 0.09:
        continue
    a = rng.uniform(0, math.tau)
    ln = rng.uniform(0.03, 0.08)
    w = 0.0025
    d = Vector((math.cos(a), math.sin(a), 0))
    n = Vector((-d.y, d.x, 0))
    z = rng.uniform(0.0, 0.02)
    v = [bm.verts.new(Vector((x, y, z)) + n * w), bm.verts.new(Vector((x, y, z)) - n * w), bm.verts.new(Vector((x, y, z + 0.006)) + d * ln)]
    bm.faces.new(v)
me = bpy.data.meshes.new("grass")
bm.to_mesh(me)
gr = bpy.data.objects.new("grass", me)
sc.collection.objects.link(gr)
gr.data.materials.append(mat("blade", (0.09, 0.2, 0.04), 0.7, (30, (0.05, 0.12, 0.02), (0.22, 0.32, 0.08))))
# the measuring board: white plastic with a black cm scale, a raised stop at the head
bpy.ops.mesh.primitive_cube_add(size=1, location=(0.02, -0.02, 0.018))
board = bpy.context.object
board.scale = (0.52, 0.16, 0.036)
board.data.materials.append(mat("board", (0.85, 0.84, 0.8), 0.4))
bpy.ops.mesh.primitive_cube_add(size=1, location=(-0.24, -0.02, 0.05))
stop = bpy.context.object
stop.scale = (0.02, 0.16, 0.05)
stop.data.materials.append(mat("stop", (0.75, 0.62, 0.1), 0.4))
for i in range(50):
    x = -0.23 + i * 0.01
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, -0.085 if i % 5 else -0.08, 0.0365))
    t = bpy.context.object
    t.scale = (0.0015, 0.02 if i % 5 else 0.03, 0.001)
    t.data.materials.append(mat("tick", (0.02, 0.02, 0.02), 0.5))
# camera: overhead, a little tilted, 4:3
cam = bpy.data.cameras.new("cam")
cam.lens = 30
co = bpy.data.objects.new("cam", cam)
sc.collection.objects.link(co)
co.location = (0.03, -0.32, 0.5)
co.rotation_euler = (math.radians(32), 0, 0)
sc.camera = co
sun = bpy.data.lights.new("sun", "SUN")
sun.energy = 3.2
sun.angle = math.radians(8)
so = bpy.data.objects.new("sun", sun)
sc.collection.objects.link(so)
so.rotation_euler = (math.radians(35), math.radians(-20), math.radians(30))
world = bpy.data.worlds.new("w")
sc.world = world
world.use_nodes = True
bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs["Color"].default_value = (0.55, 0.62, 0.7, 1)
bg.inputs["Strength"].default_value = 0.9
try:
    sc.render.engine = "CYCLES"
except TypeError:
    pass
sc.cycles.samples = 48
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for t in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = t
            prefs.get_devices()
            if any(d.type == t for d in prefs.devices):
                for d in prefs.devices:
                    d.use = d.type == t
                sc.cycles.device = "GPU"
                break
        except TypeError:
            continue
except Exception as e:  # noqa: BLE001
    print("gpu?", e)
sc.render.resolution_x, sc.render.resolution_y = 480, 360
sc.view_settings.view_transform = "Standard"
sc.view_settings.look = "None"
sc.render.filepath = OUT
sc.render.image_settings.file_format = "PNG"
bpy.ops.render.render(write_still=True)
print("PHOTO", OUT)
