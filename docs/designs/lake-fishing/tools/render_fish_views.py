# render_fish_views.py: Blender headless: each species of a lake_fish.glb from side / top / front / 3-4, one PNG per species+view.
#   blender -b --python render_fish_views.py -- in.glb outdir [species,species] [views]
import bpy, sys, math, os
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]
glb, outdir = argv[0], argv[1]
only = argv[2].split(",") if len(argv) > 2 and argv[2] != "all" else None
views = argv[3].split(",") if len(argv) > 3 else ["side", "top", "front", "q34", "back34"]
os.makedirs(outdir, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
sc = bpy.context.scene
try: sc.render.engine = "BLENDER_EEVEE"
except TypeError:
    sc.render.engine = "BLENDER_EEVEE_NEXT"
sc.render.resolution_x, sc.render.resolution_y = 1400, 700
try: sc.eevee.taa_render_samples = 12
except Exception: pass
sc.render.film_transparent = False
w = bpy.data.worlds.new("w"); w.use_nodes = True
bg = w.node_tree.nodes["Background"]; bg.inputs[0].default_value = (0.55, 0.62, 0.68, 1); bg.inputs[1].default_value = 1.1
sc.world = w
for loc, e, rot in (((1.5, -2, 3), 3.0, (0.6, 0.2, 0.5)), ((-2, 2, 1), 1.2, (1.2, 0, -2.2))):
    ld = bpy.data.lights.new("s", "SUN"); ld.energy = e
    lo = bpy.data.objects.new("s", ld); sc.collection.objects.link(lo); lo.rotation_euler = rot
for m in bpy.data.materials:
    if m.name.startswith("M_fin"):
        m.use_backface_culling = False
roots = [o for o in bpy.data.objects if o.name.startswith("fish_") and o.parent is None and not o.name.endswith(("_mesh", "_lod1"))]
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = "ORTHO"; cam.data.ortho_scale = 1.25
# glTF import: +Z (gltf) -> -Y(blender)... nose is gltf +Z = blender -Y; up gltf +Y = blender +Z; width gltf X = blender X
def look(obj, target):
    d = target - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
for r in roots:
    sid = r.name[5:]
    if only and sid not in only: continue
    for o in roots: 
        for c in [o] + list(o.children_recursive): c.hide_render = (o is not r) or c.name.endswith("_lod1")
    ct = r.matrix_world.translation + Vector((0, 0, 0))
    for v in views:
        if v == "side":   cam.location = ct + Vector((3, 0, 0)); cam.data.ortho_scale = 1.2   # camera on +X looking -X: nose (-Y) to the left
        elif v == "top":  cam.location = ct + Vector((0, 0, 3)); cam.data.ortho_scale = 1.2
        elif v == "front": cam.location = ct + Vector((0, -3, 0)); cam.data.ortho_scale = 0.5
        elif v == "q34":  cam.location = ct + Vector((2.0, -1.2, 0.9)); cam.data.ortho_scale = 1.0
        elif v == "back34": cam.location = ct + Vector((-2.0, 1.4, 0.9)); cam.data.ortho_scale = 1.0
        look(cam, ct)
        if v == "top": cam.rotation_euler = (0, 0, math.radians(90))
        sc.render.filepath = os.path.join(outdir, f"{sid}_{v}.png")
        bpy.ops.render.render(write_still=True)
print("DONE")
