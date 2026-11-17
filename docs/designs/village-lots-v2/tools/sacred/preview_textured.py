# Textured preview of downloaded scans (glTF), front and side, EEVEE: blender -b --factory-startup -P preview_textured.py -- <out_dir> <glb>...
import bpy, sys, os, math
from mathutils import Vector
a = sys.argv[sys.argv.index("--") + 1:]; out, files = a[0], a[1:]
os.makedirs(out, exist_ok=True)
sc = bpy.context.scene
for e in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try: sc.render.engine = e; break
    except TypeError: pass
sc.render.resolution_x, sc.render.resolution_y = 600, 750
for f in files:
    for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(f))
    ms = [o for o in sc.objects if o.type == "MESH"]
    pts = [o.matrix_world @ Vector(c) for o in ms for c in o.bound_box]
    mn = Vector([min(p[i] for p in pts) for i in range(3)]); mx = Vector([max(p[i] for p in pts) for i in range(3)])
    ctr = (mn + mx) / 2; size = (mx - mn).length
    w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
    next(n for n in w.node_tree.nodes if n.type == "BACKGROUND").inputs["Strength"].default_value = 1.2
    ld = bpy.data.lights.new("s", "SUN"); ld.energy = 3; lo = bpy.data.objects.new("s", ld); sc.collection.objects.link(lo); lo.rotation_euler = (0.8, 0.2, -0.6)
    cd = bpy.data.cameras.new("c"); cd.clip_start = size * 0.01; cd.clip_end = size * 10; cam = bpy.data.objects.new("c", cd); sc.collection.objects.link(cam); sc.camera = cam
    name = os.path.splitext(os.path.basename(f))[0]
    for tag, ax in (("front", Vector((0, -1, 0))), ("side", Vector((1, 0, 0))), ("top", Vector((0, 0, 1)))):
        cam.location = ctr + ax * size * 1.4
        cam.rotation_euler = (ctr - cam.location).to_track_quat("-Z", "Y" if tag == "top" else "Y").to_euler()
        sc.render.filepath = os.path.join(out, f"{name}__{tag}.png"); bpy.ops.render.render(write_still=True)
    print("PREV", name, tuple(round(x, 3) for x in (mx - mn)), sum(len(o.data.polygons) for o in ms), [m.name for o in ms for m in o.data.materials][:4])
