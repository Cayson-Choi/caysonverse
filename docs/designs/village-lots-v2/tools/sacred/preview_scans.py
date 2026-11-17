# Blender headless: quick Workbench previews of raw scans (front + 3/4), to choose and orient sources.
# blender -b --factory-startup -P preview_scans.py -- <out_dir> <stl> [<stl> ...]
import bpy, sys, os, math
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]
out, files = argv[0], argv[1:]
os.makedirs(out, exist_ok=True)
sc = bpy.context.scene
sc.render.engine = "BLENDER_WORKBENCH"
sc.display.shading.light = "STUDIO"
sc.display.shading.show_cavity = True
sc.display.shading.cavity_type = "BOTH"
sc.render.resolution_x, sc.render.resolution_y = 640, 800
for f in files:
    for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.wm.stl_import(filepath=f)
    ob = bpy.context.selected_objects[0]
    bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    mn = Vector([min(v[i] for v in bb) for i in range(3)]); mx = Vector([max(v[i] for v in bb) for i in range(3)])
    ctr = (mn + mx) / 2; size = (mx - mn).length
    cam_d = bpy.data.cameras.new("c"); cam = bpy.data.objects.new("c", cam_d); sc.collection.objects.link(cam); sc.camera = cam
    cam_d.lens = 50; cam_d.clip_start = size * 0.01; cam_d.clip_end = size * 10
    name = os.path.splitext(os.path.basename(f))[0]
    for tag, ax in [("front-y", Vector((0, -1, 0))), ("front+y", Vector((0, 1, 0))), ("side+x", Vector((1, 0, 0))), ("top", Vector((0, 0, 1)))]:
        up = Vector((0, 1, 0)) if tag == "top" else Vector((0, 0, 1))
        cam.location = ctr + ax * size * 1.6
        cam.rotation_euler = (ctr - cam.location).to_track_quat("-Z", "Y").to_euler()
        sc.render.filepath = os.path.join(out, f"{name}__{tag}.png")
        bpy.ops.render.render(write_still=True)
    print("DIM", name, tuple(round(x, 2) for x in (mx - mn)), len(ob.data.polygons))
