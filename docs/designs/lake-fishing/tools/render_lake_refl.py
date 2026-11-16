"""The reflection panorama of the lake (design 4.2): a 1024 x 512 equirect picture of what stands around the water, seen from
the middle of the lake just above the surface (1.5 m), day and night. The water shader looks it up by the reflected view direction.

  blender -b art/lake/work/lake_authoring.blend -P art/lake/tools/render_lake_refl.py -- --out art/lake/work [--night] [--samples 96]
  -> lake_refl_day.png / lake_refl_night.png (post_lake.py makes the WebP)

Convention (same as the village's sky dome T_sky): u = azimuth from NORTH clockwise (0 north, 0.25 east, 0.5 south, 0.75 west),
v = elevation (bottom = straight down, 0.5 = horizon, top = zenith). The village's hills and mountains beyond the lake zone come
from a proxy of the backdrop terrain (parts_nature.terrain_h + its procedural BD_terrain material); the village's houses are
not in the picture (far and small).
"""
import math
import os
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
LAKE_ROOT = os.path.dirname(HERE)
REPO = os.path.dirname(os.path.dirname(LAKE_ROOT))
os.environ.setdefault("CV_LAYOUT", os.path.join(REPO, "art", "village", "layout.json"))
sys.path.insert(0, os.path.join(REPO, "art", "village", "tools"))
sys.path.insert(0, HERE)
import vlib as U  # noqa: E402
from vlib import V, MB  # noqa: E402
import build_village as BV  # noqa: E402
import parts_nature as PN  # noqa: E402
import bake_lake as BL  # noqa: E402
import lake_geo as G  # noqa: E402


def args():
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def get(name, default=None):
    a = args()
    return a[a.index(name) + 1] if name in a else default


def proxy_backdrop(coll):
    """The village's hills around the lake zone, as a coarse grid (the lake's own terrain covers the zone)."""
    PN.backdrop_materials()
    def axis():
        out = []
        x = -1100.0
        while x < 1100.0:
            out.append(x)
            ax = abs(x)
            x += 28.0 if ax > 440 else 20.0 if ax > 260 else 12.0 if ax > 150 else 7.0
        out.append(1100.0)
        return out
    xs = [x for x in axis() if -150 <= x or True]
    zs = axis()
    bm = bmesh.new()
    verts = {}
    def vert(i, j):
        k = (i, j)
        if k not in verts:
            x, z = xs[i], zs[j]
            h = PN.terrain_h(x, z)
            # sink the proxy a little near the lake zone: it must never poke through the lake's own terrain
            near = max(0.0, 1.0 - max(0.0, max(95.5 - x, x - 190.0, -70.0 - z, z - 49.0)) / 40.0)
            verts[k] = bm.verts.new(V(x, z, h - 0.6 * near))
        return verts[k]
    for j in range(len(zs) - 1):
        for i in range(len(xs) - 1):
            cx, cz = (xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2
            if 96.0 < cx < 190.0 and -69.5 < cz < 48.5:
                continue
            if math.hypot(cx, cz) > 1500:
                continue
            try:
                bm.faces.new([vert(i, j), vert(i + 1, j), vert(i + 1, j + 1), vert(i, j + 1)])
            except ValueError:
                pass
    me = bpy.data.meshes.new("proxy_backdrop")
    bm.to_mesh(me)
    bm.free()
    me.materials.append(bpy.data.materials["BD_terrain"])
    ob = bpy.data.objects.new("proxy_backdrop", me)
    coll.objects.link(ob)
    for p in me.polygons:
        p.use_smooth = True
    ob["cat"] = "proxy"
    return ob


def main():
    scene = bpy.context.scene
    night = "--night" in args()
    out_dir = get("--out", os.path.join(LAKE_ROOT, "work"))
    root = U.coll("refl_proxy")
    proxy_backdrop(root)
    water = bpy.data.objects.get("lake_water")
    if water:
        water.hide_render = True
    for o in bpy.data.objects:
        if o.get("cat") in ("collider", "occluder"):
            o.hide_render = True   # the pier / huts / office are not part of the sky and shore picture (F, open-water point)
    # a sky dome like the village's is not in the lake scene: the world (HDRI) is the sky
    if night:
        BL.setup_night(scene)
        # lamps and windows as visible glow
        for l in G.LAY["lamps"]:
            bpy.ops.mesh.primitive_uv_sphere_add(radius=0.28, location=V(l["x"], l["z"], 3.3))
            ob = bpy.context.active_object
            m = bpy.data.materials.new("glow_refl")
            m.use_nodes = True
            nt = m.node_tree
            for n in list(nt.nodes):
                nt.nodes.remove(n)
            em = nt.nodes.new("ShaderNodeEmission")
            em.inputs["Color"].default_value = (1.0, 0.72, 0.4, 1.0)
            em.inputs["Strength"].default_value = 90.0
            o = nt.nodes.new("ShaderNodeOutputMaterial")
            nt.links.new(em.outputs[0], o.inputs["Surface"])
            ob.data.materials.append(m)
        scene.view_settings.exposure = 1.3
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
    scene.cycles.samples = int(get("--samples", 96))
    scene.render.resolution_x, scene.render.resolution_y = 1024, 512
    scene.render.resolution_percentage = 100
    cd = bpy.data.cameras.new("refl")
    cd.type = "PANO"
    try:
        cd.panorama_type = "EQUIRECTANGULAR"
    except Exception:
        cd.cycles.panorama_type = "EQUIRECTANGULAR"
    cd.clip_start = 0.05
    cd.clip_end = 6000
    cam = bpy.data.objects.new("refl", cd)
    scene.collection.objects.link(cam)
    # an open-water point (F follow-up): the middle of the reservoir, 16 m from the nearest bank and from every deck, so no deck or
    # railing is in view and the panorama is the sky, the ridges and the forest all round
    cx, cz = 162.0, -14.0
    cam.location = V(cx, cz, G.WATER_Y + 1.5)
    # forward = south (+z game): the picture's centre looks south, its left edge is north
    cam.rotation_mode = "QUATERNION"
    cam.rotation_quaternion = V(0, 1, 0).to_track_quat("-Z", "Y") if False else (Vector((0, -1, 0))).to_track_quat("-Z", "Y")
    scene.camera = cam
    path = os.path.join(out_dir, "lake_refl_%s.png" % ("night" if night else "day"))
    scene.render.filepath = path
    scene.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)
    print("RENDERED", path)


main()
