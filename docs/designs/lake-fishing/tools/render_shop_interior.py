"""Preview renders of the shop interior (art/shop/shop_interior.blend, saved by build_shop_interior.py): Cycles stills from
fixed eye points, for the reference sheets and quick checks without the game.

  blender -b art/shop/shop_interior.blend -P docs/designs/lake-fishing/tools/render_shop_interior.py -- --out art/shop/preview [--samples 48]"""
import math
import os
import sys

import bpy
from mathutils import Vector

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(ARGV[ARGV.index("--out") + 1]) if "--out" in ARGV else os.path.abspath("art/shop/preview")
SAMPLES = int(ARGV[ARGV.index("--samples") + 1]) if "--samples" in ARGV else 48
os.makedirs(OUT, exist_ok=True)
sc = bpy.context.scene
sc.cycles.samples = SAMPLES
sc.render.resolution_x, sc.render.resolution_y = 1280, 800
sc.view_settings.view_transform = "Standard"
for o in bpy.data.objects:
    if o.type == "MESH":
        o.hide_render = False
cam = bpy.data.cameras.new("pv")
co = bpy.data.objects.new("pv", cam)
sc.collection.objects.link(co)
sc.camera = co


def B(x, y, z):
    return Vector((x, -z, y))


VIEWS = {  # name: (eye game xyz, target game xyz, lens)
    "back_wall": ((102.0, 1.75, -19.9), (102.0, 1.45, -24.3), 20),
    "rods": ((100.6, 1.6, -21.6), (99.1, 1.6, -24.3), 24),
    "pegboard": ((101.4, 1.8, -22.4), (100.9, 1.8, -24.3), 24),
    "west": ((103.5, 1.7, -20.6), (98.2, 1.4, -21.8), 22),
    "east": ((100.5, 1.7, -20.6), (105.8, 1.4, -22.6), 22),
    "counter": ((102.2, 2.1, -21.3), (102.3, 1.3, -20.0), 24),
    "fridge": ((104.0, 1.5, -21.8), (105.4, 1.2, -24.0), 24),
}
for name, (eye, tgt, lens) in VIEWS.items():
    cam.lens = lens
    co.location = B(*eye)
    d = B(*tgt) - B(*eye)
    co.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = os.path.join(OUT, f"{name}.png")
    bpy.ops.render.render(write_still=True)
    print("VIEW", name)
