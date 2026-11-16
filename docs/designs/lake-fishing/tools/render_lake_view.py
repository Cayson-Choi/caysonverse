"""Render views of the lake authoring scene (Cycles, GPU) in game coordinates.

  blender -b art/lake/work/lake_authoring.blend -P art/lake/tools/render_lake_view.py -- --out DIR \
      --view name:ex,ey,ez:tx,ty,tz:lens [--view ...] [--night] [--res 1280x720] [--samples 64] [--exposure 0]

The village's sun/HDRI (look.json) is the day light; --night uses the bake's moon, dark sky and the lights at the light__* empties.
Game coords: (x east, y up, z south). Eye/target are "x,y,z" with y UP (like three.js).
"""
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(HERE))), "art", "village", "tools"))
os.environ.setdefault("CV_LAYOUT", os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(HERE))), "art", "village", "layout.json"))
import vlib as U  # noqa: E402
from vlib import V  # noqa: E402


def args():
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def getall(name):
    a = args()
    return [a[i + 1] for i, x in enumerate(a) if x == name and i + 1 < len(a)]


def get(name, default=None):
    r = getall(name)
    return r[0] if r else default


def night_setup(scene):
    import bake_lake as BL
    BL.setup_night(scene)


def main():
    scene = bpy.context.scene
    out = get("--out", os.path.join(os.path.dirname(HERE), "work", "renders"))
    os.makedirs(out, exist_ok=True)
    w, h = (int(v) for v in get("--res", "1280x720").split("x"))
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.cycles.samples = int(get("--samples", 64))
    scene.view_settings.exposure = float(get("--exposure", 0.0))
    if "--night" in args():
        night_setup(scene)
        scene.view_settings.exposure = float(get("--exposure", 0.6))
    for o in bpy.data.objects:
        if o.get("cat") == "collider":
            o.hide_render = True
    prefs = bpy.context.preferences.addons["cycles"].preferences
    try:
        prefs.compute_device_type = "OPTIX"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == "OPTIX"
        scene.cycles.device = "GPU"
    except Exception as e:
        print("gpu", e)
    for spec in getall("--view"):
        name, eye, tgt, lens = spec.split(":")
        e = [float(v) for v in eye.split(",")]
        t = [float(v) for v in tgt.split(",")]
        cd = bpy.data.cameras.new(name)
        cd.lens = float(lens)
        cd.sensor_width = 36
        cd.clip_start = 0.05
        cd.clip_end = 4000
        cam = bpy.data.objects.new(name, cd)
        scene.collection.objects.link(cam)
        cam.location = V(e[0], e[2], e[1])
        d = V(t[0], t[2], t[1]) - V(e[0], e[2], e[1])
        cam.rotation_mode = "QUATERNION"
        cam.rotation_quaternion = d.to_track_quat("-Z", "Y")
        scene.camera = cam
        scene.render.filepath = os.path.join(out, name + ("_night" if "--night" in args() else "") + ".png")
        bpy.ops.render.render(write_still=True)
        print("RENDERED", scene.render.filepath)


main()
