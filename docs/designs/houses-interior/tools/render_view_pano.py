"""Window panorama of a house (houses interior, Blender 5.x background): the REAL village rendered from the house's spot.

  blender -b art/village/work/village_authoring.blend -P art/village/tools/houses/render_view_pano.py -- --house N [--samples 48] [--out art/village/work/pano]

Writes art/village/work/pano/house_N_pano_day.png / _night.png (2048 x 512 each, equirectangular: image centre = world NORTH (-z, the
way the visitor looks when stepping in), left = west, right = east, vertical -45 .. +45 degrees from a point 2.0 m above the house
centre) and house_N_view.png = day on top, night below (2048 x 1024); post_view.py turns it into client/public/models/village/houses/
house_N_view.webp. The house itself (and its porch / garden border) is deleted from the render so the view looks out of its windows.
"""
import math
import os
import sys

import bpy
import bmesh

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
WORK = os.path.join(ROOT, "work")
CENTRE = {6: (42, 42.5), 7: (31, -56), 8: (-50, 40), 9: (-31, -56), 10: (-40.6, 27),
          1: (21, -42), 2: (-21, -42), 3: (29, 37.6), 4: (-31.6, 39.4), 5: (-47, -8)}


def arg(name, default=None, cast=str):
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for i, x in enumerate(a):
        if x == name:
            return cast(a[i + 1]) if i + 1 < len(a) and not a[i + 1].startswith("--") else True
    return default


def cut_house(cx, cz, half=6.6):
    """delete every face of the village meshes named *house* whose centre lies in the house's square (Blender y = -z)"""
    by = -cz
    for ob in bpy.data.objects:
        if ob.type != "MESH" or ob.name.startswith("col__") or ob.get("cat") in ("backdrop", "water", "inst"):
            continue
        if not any(k in ob.name for k in ("house", "flower", "fill_buildings")):
            continue
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        kill = [f for f in bm.faces if abs(f.calc_center_median().x - cx) < half and abs(f.calc_center_median().y - by) < half]
        if kill:
            bmesh.ops.delete(bm, geom=kill, context="FACES")
            bm.to_mesh(ob.data)
        bm.free()


def setup(night, samples):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "OPTIX"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == "OPTIX"
        sc.cycles.device = "GPU"
    except Exception as e:
        print("gpu", e)
    for o in list(bpy.data.objects):
        if o.type == "LIGHT":
            bpy.data.objects.remove(o)
    w = bpy.data.worlds.new("PanoWorld")
    sc.world = w
    nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    if night:
        # dusk-blue gradient: brighter at the horizon
        tc = nt.nodes.new("ShaderNodeTexCoord")
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        nt.links.new(tc.outputs["Generated"], sep.inputs[0])
        mp = nt.nodes.new("ShaderNodeMapRange")
        mp.inputs["From Min"].default_value = 0.5
        mp.inputs["From Max"].default_value = 1.0
        nt.links.new(sep.outputs["Z"], mp.inputs["Value"])
        nt.links.new(mp.outputs["Result"], ramp.inputs["Fac"])
        ramp.color_ramp.elements[0].color = (0.020, 0.034, 0.085, 1)
        ramp.color_ramp.elements[1].color = (0.004, 0.008, 0.032, 1)
        nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
        bg.inputs["Strength"].default_value = 1.0
        moon = bpy.data.lights.new("moon", "SUN")
        moon.energy = 0.8
        moon.color = (0.62, 0.72, 1.0)
        moon.angle = math.radians(1.0)
        mo = bpy.data.objects.new("moon", moon)
        sc.collection.objects.link(mo)
        mo.rotation_euler = (math.radians(50), 0, math.radians(35))
        sc.view_settings.exposure = 0.0
    else:
        env = nt.nodes.new("ShaderNodeTexEnvironment")
        env.image = bpy.data.images.load(os.path.join(ROOT, "downloads", "hdri", "kloppenheim_06_puresky_2k.hdr"), check_existing=True)
        nt.links.new(env.outputs["Color"], bg.inputs["Color"])
        bg.inputs["Strength"].default_value = 1.0
        sd = bpy.data.lights.new("sun", "SUN")
        sd.energy = 4.0
        sd.angle = math.radians(1.5)
        so = bpy.data.objects.new("sun", sd)
        sc.collection.objects.link(so)
        so.rotation_euler = (math.radians(52), 0, math.radians(-30))
    nt.links.new(bg.outputs[0], out.inputs["Surface"])
    sc.view_settings.view_transform = "AgX"
    try:
        sc.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass


def main():
    n = arg("--house", 6, int)
    samples = arg("--samples", 48, int)
    out_dir = os.path.abspath(arg("--out", os.path.join(WORK, "pano")))
    os.makedirs(out_dir, exist_ok=True)
    cx, cz = CENTRE[n]
    cut_house(cx, cz)
    for ob in bpy.data.objects:          # the game's plot outlines are UI, not scenery
        if ob.type == "MESH" and any(m and m.name in ("M_glow_plot",) for m in ob.data.materials):
            ob.hide_render = True
    sc = bpy.context.scene
    cd = bpy.data.cameras.new("pano")
    cd.type = "PANO"
    for attr, val in (("panorama_type", "EQUIRECTANGULAR"), ("latitude_min", math.radians(-45)), ("latitude_max", math.radians(45)),
                      ("longitude_min", -math.pi), ("longitude_max", math.pi)):
        try:
            setattr(cd, attr, val)
        except Exception:
            try:
                setattr(cd.cycles, attr, val)
            except Exception as e:
                print("pano attr", attr, e)
    cd.clip_end = 3000
    co = bpy.data.objects.new("pano", cd)
    sc.collection.objects.link(co)
    co.location = (cx, -cz, 2.0)
    co.rotation_euler = (math.pi / 2, 0, 0)          # looks along +Y = world north (-z)
    sc.camera = co
    sc.render.resolution_x, sc.render.resolution_y = 2048, 512
    sc.render.resolution_percentage = 100
    for night in (False, True):
        setup(night, samples)
        tag = "night" if night else "day"
        # village lamps / windows glow only at night: leave the authoring emission as is
        sc.render.filepath = os.path.join(out_dir, f"house_{n}_pano_{tag}.png")
        bpy.ops.render.render(write_still=True)
        print("PANO", sc.render.filepath, flush=True)


main()
