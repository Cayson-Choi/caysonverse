"""Render comparison views of art/lake/work/structures.blend (EEVEE, background).

  blender -b art/lake/work/structures.blend -P art/lake/tools/render_lake_structures.py -- --out art/lake/work/renders [--only name,name] [--res 1280x800]

Views are written as <name>.png. The list VIEWS is the one the comparison sheet (make_lake_sheet.py) pairs with the photos.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(n, d=None):
    return ARGV[ARGV.index(n) + 1] if n in ARGV else d


def V(x, z, y=0.0):
    return Vector((x, -z, y))


# name: (camera (x, y, z) in game coords, target (x, y, z), lens mm)
VIEWS = {
    "jwadae_a": ((126.0, 3.2, -34.0), (143.0, 1.6, -29.0), 40),
    "jwadae_a_close": ((137.5, 2.3, -22.5), (143.0, 1.8, -29.5), 38),
    "pier_walk": ((107.5, 1.9, -12.0), (128.0, 0.9, -12.0), 32),
    "pier_side": ((116.0, 2.2, -4.5), (124.0, 0.5, -12.0), 38),
    "pier_t": ((131.0, 2.2, -7.0), (144.0, 0.6, -14.0), 34),
    "chairs_close": ((118.0, 1.5, -9.0), (121.0, 0.5, -12.3), 40),
    "office": ((106.5, 2.2, -10.0), (101.5, 2.6, -21.5), 32),
    "office_window": ((102.0, 2.0, -15.5), (102.0, 2.0, -21.5), 34),
    "office_east": ((111.5, 2.0, -17.5), (106.5, 1.5, -22.5), 34),
    "props": ((110.0, 1.7, -17.5), (106.8, 1.1, -22.3), 32),
    "pavilion": ((100.0, 2.6, 24.0), (112.0, 2.4, 33.5), 32),
    "pavilion_in": ((112.0, 1.6, 31.0), (112.0, 2.4, 34.5), 28),
    "benches": ((98.5, 1.6, -0.5), (103.5, 0.6, 5.5), 34),
    "picnic": ((95.5, 1.8, 8.0), (99.5, 0.6, 12.5), 34),
    "lamps": ((115.0, 1.6, -9.0), (125.0, 2.8, -14.5), 34),
    "overview": ((100.0, 12.0, 8.0), (125.0, 0.5, -16.0), 28),
}


def main():
    out = arg("--out", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(bpy.data.filepath))), "work", "renders"))
    os.makedirs(out, exist_ok=True)
    only = arg("--only")
    only = only.split(",") if only else None
    res = [int(v) for v in arg("--res", "1280x800").split("x")]
    sc = bpy.context.scene
    cyc = os.environ.get("LAKE_CYCLES") == "1"
    sc.render.engine = "CYCLES" if cyc else "BLENDER_EEVEE"
    if cyc:
        try:
            pref = bpy.context.preferences.addons["cycles"].preferences
            pref.compute_device_type = "OPTIX" if any(d.type == "OPTIX" for d in pref.get_devices_for_type("OPTIX") or []) else "CUDA"
            pref.get_devices()
            for d in pref.devices:
                d.use = d.type != "CPU"
            sc.cycles.device = "GPU"
        except Exception as e:
            print("cycles gpu setup", e)
        sc.cycles.samples = 48
        sc.cycles.use_denoising = True
        sc.cycles.max_bounces = 6
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = "PNG"
    try:
        sc.eevee.taa_render_samples = 48
    except Exception:
        pass
    try:
        sc.view_settings.view_transform = "Standard"
        sc.view_settings.exposure = -0.9
        sc.view_settings.gamma = 1.0
    except Exception:
        pass
    for o in bpy.data.objects:
        if o.name == "pv_sun":
            o.data.energy = 2.6
    for w in bpy.data.worlds:
        for n in w.node_tree.nodes:
            if n.type == "BACKGROUND":
                n.inputs["Strength"].default_value = 0.55
    for m in bpy.data.materials:
        if m.name == "pv_water":
            b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
            b.inputs["Base Color"].default_value = (0.012, 0.02, 0.008, 1)
            b.inputs["Roughness"].default_value = 0.18
    cam = bpy.data.cameras.new("pv_cam")
    co = bpy.data.objects.new("pv_cam", cam)
    bpy.context.scene.collection.objects.link(co)
    sc.camera = co
    for name, (pos, tgt, lens) in VIEWS.items():
        if only and name not in only:
            continue
        cam.lens = lens
        co.location = V(pos[0], pos[2], pos[1])
        d = V(tgt[0], tgt[2], tgt[1]) - co.location
        co.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        sc.render.filepath = os.path.join(out, name + ".png")
        bpy.ops.render.render(write_still=True)
        print("RENDERED", name)


main()
