"""Window panorama of the real village from inside a house (design 3.2 / contract 8: house_N_view.webp, top = day, bottom = night).

  blender -b art/village/work/village_authoring.blend -P art/village/tools/houses/render_view.py -- --house N [--samples 48] [--out art/village/work]
  python  art/village/tools/houses/post_view.py N          (day PNG + graded night -> 2048 x 1024 WebP, copied to the client)

The camera stands in the middle of the house at eye height 1.6 m, that house's own mesh (walls, roof, porch) removed, and renders
a full 360 degree equirectangular band (latitude -45 .. +45 degrees, 2048 x 512). IMAGE ORIENTATION (for G): u = 0.5 looks along the
house's LOCAL +z (into the room, away from the front door); u increases toward the visitor's right (local +x), u = 0.75 = +x,
u = 0.25 = -x, u = 0 / 1 = out through the front wall (local -z, the village side the door faces).
"""
import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit_core as K  # noqa: E402
import bake_house as BH  # noqa: E402

HOUSES = {1: (21.0, -42.0, "s"), 2: (-21.0, -42.0, "s"), 3: (29.0, 37.6, "n"), 4: (-31.6, 39.4, "n"), 5: (-47.0, -8.0, "e"),
          6: (42.0, 42.5, "n"), 7: (31.0, -56.0, "s"), 8: (-50.0, 40.0, "e"), 9: (-31.0, -56.0, "s"), 10: (-40.6, 27.0, "e")}
DOOR = {"s": (0.0, 1.0), "n": (0.0, -1.0), "e": (1.0, 0.0), "w": (-1.0, 0.0)}


def main():
    n = BH.arg("--house", 1, int)
    cx, cz, side = HOUSES[n]
    dx, dz = DOOR[side]
    scene = bpy.context.scene
    out = os.path.abspath(BH.arg("--out", K.WORK))
    BH.gpu(scene)
    scene.cycles.samples = BH.arg("--samples", 48, int)
    scene.cycles.use_denoising = True
    # remove the house's own faces
    for name in ("houses", "houses_flowers"):
        ob = bpy.data.objects.get(name)
        if not ob:
            continue
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        kill = []
        for f in bm.faces:
            c = f.calc_center_median()
            gx, gz = c.x, -c.y          # blender (x, -z, y)
            if (gx - cx) ** 2 + (gz - cz) ** 2 < 7.4 ** 2 and c.z > 0.03:
                kill.append(f)
        bmesh.ops.delete(bm, geom=kill, context="FACES")
        bm.to_mesh(ob.data)
        bm.free()
        print("removed", len(kill), "faces of", name)
    for o in bpy.data.objects:
        if o.name.startswith(("col__", "ceil__")) or o.get("cat") in ("collider", "helper"):
            o.hide_render = True
    cd = bpy.data.cameras.new("pano")
    cd.type = "PANO"
    cd.panorama_type = "EQUIRECTANGULAR"
    cd.latitude_min, cd.latitude_max = -math.radians(45), math.radians(45)
    cd.longitude_min, cd.longitude_max = -math.pi, math.pi
    cd.clip_start = 0.1
    cd.clip_end = 600.0
    cam = bpy.data.objects.new("pano", cd)
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.location = (cx, -cz, 1.6)
    cam.rotation_euler = (math.pi / 2, 0, math.atan2(dx, dz))     # looks along -D (into the room)
    scene.render.resolution_x, scene.render.resolution_y = 2048, 512
    scene.render.resolution_percentage = 100
    scene.render.filepath = os.path.join(out, f"house_{n}_view_day.png")
    bpy.ops.render.render(write_still=True)
    print("RENDERED", scene.render.filepath)


main()
