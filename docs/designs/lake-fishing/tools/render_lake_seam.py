"""Renders of the village WITH the lake terrain joined in (the seam check, design 12.8), from the village's authoring scene:

  blender -b art/village/work/village_authoring.blend -P art/lake/tools/render_lake_seam.py -- --out DIR \
      --view name:ex,ey,ez:tx,ty,tz:lens [--view ...] [--night] [--res 1280x720] [--samples 64]

It does what the client's patch (11.1) and the next village bake (11.2) do: cuts the village's ground_outer / backdrop_near /
backdrop_far cells inside parts_lake_cut's holes, removes the old lake disc (backdrop_water faces in the lake zone), the old
pavilion and pier and the backdrop trees inside the zone, and links art/lake/work/lake_authoring.blend's `lake` collection in.
"""
import math
import os
import sys

import bmesh
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
LAKE_ROOT = os.path.dirname(HERE)
REPO = os.path.dirname(os.path.dirname(LAKE_ROOT))
os.environ.setdefault("CV_LAYOUT", os.path.join(REPO, "art", "village", "layout.json"))
sys.path.insert(0, os.path.join(REPO, "art", "village", "tools"))
sys.path.insert(0, HERE)
import vlib as U  # noqa: E402
from vlib import V  # noqa: E402
import parts_lake_cut as LC  # noqa: E402


def args():
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def getall(name):
    a = args()
    return [a[i + 1] for i, x in enumerate(a) if x == name and i + 1 < len(a)]


def get(name, default=None):
    r = getall(name)
    return r[0] if r else default


def cut_mesh(ob, drop):
    """Delete the faces for which drop(xmin, xmax, zmin, zmax, cx, cz) is true (game coordinates; the object has identity transform)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    kill = []
    for f in bm.faces:
        xs = [v.co.x for v in f.verts]
        zs = [-v.co.y for v in f.verts]
        if drop(min(xs), max(xs), min(zs), max(zs), sum(xs) / len(xs), sum(zs) / len(zs)):
            kill.append(f)
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bm.to_mesh(ob.data)
    bm.free()
    return len(kill)


def patch_village():
    n = {}
    in_zone = lambda cx, cz: 95.5 <= cx <= 190.0 and -70.0 <= cz <= 49.0
    for ob in bpy.data.objects:
        if ob.type != "MESH":
            continue
        if ob.name.startswith("ground_outer"):
            n[ob.name] = cut_mesh(ob, lambda x0, x1, z0, z1, cx, cz: LC.in_ground_hole(x0, x1, z0, z1))
        elif ob.name.startswith("backdrop_near") or ob.name.startswith("backdrop_far"):
            n[ob.name] = cut_mesh(ob, lambda x0, x1, z0, z1, cx, cz: LC.in_backdrop_hole(x0, x1, z0, z1))
        elif ob.name.startswith("backdrop_water"):
            n[ob.name] = cut_mesh(ob, lambda x0, x1, z0, z1, cx, cz: in_zone(cx, cz))
    gone = []
    for ob in list(bpy.data.objects):
        if ob.name.startswith(("lake_pavilion", "lake_pier")):
            gone.append(ob.name)
            bpy.data.objects.remove(ob)
    trees = 0
    for ob in list(bpy.data.objects):
        if ob.get("cat") == "inst" and LC.far_forest_exclusion(ob.location.x, -ob.location.y) and ob.name.startswith("far_"):
            bpy.data.objects.remove(ob)
            trees += 1
    print("PATCH faces removed", n, "objects", gone, "far trees", trees)


def link_lake():
    path = os.path.join(LAKE_ROOT, "work", "lake_authoring.blend")
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.collections = ["lake"]
    col = dst.collections[0]
    bpy.context.scene.collection.children.link(col)
    # the lake blend's occluder greybox is a shadow caster for bakes; for pictures show it as the stand-in structures
    return col


def main():
    scene = bpy.context.scene
    patch_village()
    link_lake()
    out = get("--out", os.path.join(LAKE_ROOT, "work", "renders"))
    os.makedirs(out, exist_ok=True)
    w, h = (int(v) for v in get("--res", "1280x720").split("x"))
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.cycles.samples = int(get("--samples", 64))
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    try:
        prefs.compute_device_type = "OPTIX"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == "OPTIX"
        scene.cycles.device = "GPU"
    except Exception as e:
        print("gpu", e)
    scene.view_settings.exposure = float(get("--exposure", 0.0))
    if "--night" in args():
        import bake_lake as BL
        BL.setup_night(scene)
        scene.view_settings.exposure = float(get("--exposure", 0.8))
    for o in bpy.data.objects:
        if o.get("cat") == "collider":
            o.hide_render = True
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
