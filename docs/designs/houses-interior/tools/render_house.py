"""Eye-level room renders of a house authoring .blend (before / without the light-map bake), lit like the bake (sun + sky day,
lamps 2700 K night) so the pictures predict the game. Cameras come from work/house_<N>_cams.json written by h0N.py:
  [{"name": "1f_living", "floor": 1, "eye": [lx, lz, y], "look": [lx, lz, y], "lens": 18}, ...]

  blender -b art/village/work/house_N_authoring.blend -P art/village/tools/houses/render_house.py -- --house N
          [--night] [--res 960] [--samples 48] [--only name1,name2] [--out art/village/work/hrender]
Writes <out>/h<N>_<name>_<day|night>.png
"""
import json
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit_core as K  # noqa: E402
import bake_house as BH  # noqa: E402
import house_common as HC  # noqa: E402

HCT = HC.HCT

arg = BH.arg


def main():
    n = arg("--house", 1, int)
    night = bool(arg("--night"))
    res = arg("--res", 960, int)
    samples = arg("--samples", 48, int)
    only = arg("--only")
    out = os.path.abspath(arg("--out", os.path.join(K.WORK, "hrender")))
    os.makedirs(out, exist_ok=True)
    cams = json.load(open(os.path.join(K.WORK, f"house_{n}_cams.json"), encoding="utf-8"))
    scene = bpy.context.scene
    BH.gpu(scene)
    BH.setup_lights(scene, night)
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 8
    scene.cycles.diffuse_bounces = 4
    scene.render.resolution_x = res
    scene.render.resolution_y = int(res * 9 / 16)
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.exposure = 0.0
    for o in bpy.data.objects:
        if o.name.startswith(K.COL_PREFIX) or o.name.startswith("ceil__"):
            o.hide_render = True
    cd = bpy.data.cameras.new("cam")
    cd.clip_start = 0.05
    cam = bpy.data.objects.new("cam", cd)
    scene.collection.objects.link(cam)
    scene.camera = cam
    for c in cams:
        if only and c["name"] not in only.split(","):
            continue
        f = c["floor"]
        ox, oz = HCT.origin(n, f)

        def W(p):
            return K.V(ox + p[0], oz - p[1], p[2])
        eye, look = Vector(W(c["eye"])), Vector(W(c["look"]))
        cam.location = eye
        cam.rotation_mode = "QUATERNION"
        cam.rotation_quaternion = (look - eye).to_track_quat("-Z", "Y")
        cd.lens = c.get("lens", 18)
        scene.render.filepath = os.path.join(out, f"h{n}_{c['name']}_{'night' if night else 'day'}.png")
        bpy.ops.render.render(write_still=True)
        print("RENDERED", scene.render.filepath, flush=True)


main()
