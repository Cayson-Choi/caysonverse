"""Build every piece of the houses kit, render a preview image per piece and save the kit preview .blend.

  blender -b --factory-startup -P art/village/tools/houses/build_kit_preview.py -- [--pieces a,b] [--res 640] [--no-render]
         [--engine eevee|cycles] [--samples 32] [--out art/village/work/kit]

Writes  <out>/<piece>.png,  <out>/kit_preview.blend (pieces on a grid, with seat__/col__/light__ empties),
<out>/kit_stats.json (triangles, materials per piece). make_kit_sheets.py (system Python) makes the contact sheets and the
side-by-side sheets with the reference photos.
"""
import importlib
import json
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import kit_core as K  # noqa: E402

MODULES = ["kit_shell", "kit_seating", "kit_tables", "kit_beds", "kit_storage", "kit_kitchen", "kit_decor", "kit_props", "kit_demo"]


def arg(name, default=None, cast=str):
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for i, x in enumerate(a):
        if x.startswith(name + "="):
            return cast(x.split("=", 1)[1])
        if x == name:
            return cast(a[i + 1]) if i + 1 < len(a) and not a[i + 1].startswith("--") else True
    return default


def setup_world(scene):
    w = bpy.data.worlds.new("W")
    scene.world = w
    nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputWorld")
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(os.path.join(K.DL, "hdri", "kloppenheim_06_puresky_2k.hdr"), check_existing=True)
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = 0.6
    nt.links.new(env.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs[0], out.inputs["Surface"])


def setup_render(scene, res, engine, samples):
    ok = False
    if engine == "cycles":
        scene.render.engine = "CYCLES"
        scene.cycles.samples = samples
        scene.cycles.use_denoising = True
        try:
            prefs = bpy.context.preferences.addons["cycles"].preferences
            prefs.compute_device_type = "OPTIX"
            prefs.get_devices()
            for d in prefs.devices:
                d.use = d.type == "OPTIX"
            scene.cycles.device = "GPU"
        except Exception as e:
            print("gpu", e)
    else:
        for k in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
            try:
                scene.render.engine = k
                ok = True
                break
            except TypeError:
                continue
        try:
            scene.eevee.taa_render_samples = samples
        except Exception:
            pass
    scene.render.resolution_x = scene.render.resolution_y = res
    scene.view_settings.view_transform = "AgX"
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass


def add_light(scene):
    sd = bpy.data.lights.new("sun", "SUN")
    sd.energy = 3.0
    sd.angle = math.radians(8)
    so = bpy.data.objects.new("sun", sd)
    scene.collection.objects.link(so)
    so.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
    fd = bpy.data.lights.new("fill", "AREA")
    fd.energy = 120
    fd.size = 4
    fo = bpy.data.objects.new("fill", fd)
    scene.collection.objects.link(fo)
    fo.location = (3, 4, 3)
    fo.rotation_euler = (math.radians(55), 0, math.radians(35))


def bbox(ob):
    pts = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return mn, mx


def aim(cam, target, eye):
    cam.location = eye
    cam.rotation_mode = "QUATERNION"
    cam.rotation_quaternion = (target - eye).to_track_quat("-Z", "Y")


def main():
    only = arg("--pieces")
    res = arg("--res", 640, int)
    out = os.path.abspath(arg("--out", os.path.join(K.WORK, "kit")))
    os.makedirs(out, exist_ok=True)
    scene = bpy.context.scene
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    setup_world(scene)
    setup_render(scene, res, arg("--engine", "eevee"), arg("--samples", 48, int))
    add_light(scene)
    # ground
    gd = bpy.data.meshes.new("ground")
    gd.from_pydata([(-30, -30, -0.001), (30, -30, -0.001), (30, 30, -0.001), (-30, 30, -0.001)], [], [(0, 1, 2, 3)])
    go = bpy.data.objects.new("ground", gd)
    gm = bpy.data.materials.new("gm")
    gm.diffuse_color = (0.62, 0.6, 0.57, 1)
    nt = gm.node_tree
    nt.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.5, 0.48, 0.45, 1)
    nt.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
    gd.materials.append(gm)
    scene.collection.objects.link(go)
    cam_d = bpy.data.cameras.new("cam")
    cam_d.lens = 45
    cam_d.clip_start = 0.05
    cam = bpy.data.objects.new("cam", cam_d)
    scene.collection.objects.link(cam)
    scene.camera = cam

    pieces = []
    for mn in MODULES:
        try:
            mod = importlib.import_module(mn)
        except ModuleNotFoundError:
            print("missing module", mn)
            continue
        for p in getattr(mod, "PIECES", []):
            p = dict(p)
            p["module"] = mn
            pieces.append(p)
    names = only.split(",") if only else None
    coll = bpy.data.collections.new("kit")
    scene.collection.children.link(coll)
    empt = bpy.data.collections.new("kit_empties")
    scene.collection.children.link(empt)
    stats = {}
    objs = []
    for p in pieces:
        if names and p["name"] not in names:
            continue
        K.begin(p["name"])
        K.S.furn = K.FURN.get(getattr(p["fn"], "__name__", ""))
        try:
            p["fn"](K.Frame(0, 0, 0, 0), **p.get("kw", {}))
        except Exception as e:
            import traceback
            traceback.print_exc()
            print("PIECE FAILED", p["name"], e)
            K.S.mb = None
            continue
        ob = K.end(coll)
        ob.hide_render = True
        K.emit_empties(ob, empt, p["name"])
        mats = sorted({m.name for m in ob.data.materials})
        stats[p["name"]] = dict(tris=K.tri_count(ob), mats=mats, ref=p.get("ref"), group=p.get("group"),
                                seats=len(json.loads(ob["seats"])))
        objs.append((p, ob))
        print("built", p["name"], stats[p["name"]]["tris"], "tris", len(mats), "mats", flush=True)
    sp = os.path.join(out, "kit_stats.json")
    allst = json.load(open(sp)) if os.path.exists(sp) else {}
    allst.update(stats)
    json.dump(allst, open(sp, "w"), indent=1)
    for o in bpy.data.objects:
        if o.type == "EMPTY" or o.name.startswith("col__"):
            o.hide_render = True
    if not arg("--no-render"):
        for (p, ob) in objs:
            ob.hide_render = False
            bpy.context.view_layer.update()
            mn, mx = bbox(ob)
            c = (mn + mx) / 2
            size = (mx - mn)
            d = max(size.x, size.y, size.z * 1.2, 0.3)
            cm = p.get("cam", {})
            az = math.radians(cm.get("az", 35))     # 0 = looking at the front (+z game = -Y blender)
            el = math.radians(cm.get("el", 22))
            dist = d * cm.get("dist", 1.9)
            tgt = Vector((c.x, c.y, c.z + cm.get("dz", 0.0))) if "target" not in cm else Vector(cm["target"])
            eye = Vector((tgt.x + math.sin(az) * math.cos(el) * dist, tgt.y - math.cos(az) * math.cos(el) * dist,
                          tgt.z + math.sin(el) * dist))
            if "eye" in cm:
                eye = K.V(*cm["eye"])
                tgt = K.V(*cm["look"])
            go.location.z = cm.get("ground", 0.0)
            cam_d.lens = cm.get("lens", 40)
            aim(cam, tgt, eye)
            scene.render.filepath = os.path.join(out, p["name"] + ".png")
            if "res" in cm:
                scene.render.resolution_x, scene.render.resolution_y = cm["res"]
            else:
                scene.render.resolution_x = scene.render.resolution_y = res
            extra = []
            if p["name"].startswith("demo"):
                for l in json.loads(ob["lights"]):
                    ld = bpy.data.lights.new("l", "POINT")
                    ld.energy = l["watts"] * 6
                    ld.shadow_soft_size = 0.1
                    lo = bpy.data.objects.new("l", ld)
                    lo.location = K.V(l["x"], l["z"], l["y"] - 0.4)
                    scene.collection.objects.link(lo)
                    extra.append(lo)
                ad = bpy.data.lights.new("a", "AREA")
                ad.energy = 800
                ad.size = 5
                ao = bpy.data.objects.new("a", ad)
                ao.location = (c.x, c.y, mx.z - 0.3)
                scene.collection.objects.link(ao)
                extra.append(ao)
            bpy.ops.render.render(write_still=True)
            for e in extra:
                bpy.data.objects.remove(e)
            ob.hide_render = True
            print("rendered", p["name"], flush=True)
    # lay the pieces out on a grid for the saved .blend
    x = 0.0
    row = 0.0
    rowh = 0.0
    for (p, ob) in objs:
        ob.hide_render = False
        mn, mx = bbox(ob)
        w, d_ = mx.x - mn.x, mx.y - mn.y
        if x + w > 40:
            x = 0
            row -= rowh + 1.5
            rowh = 0
        off = Vector((x - mn.x, row - mx.y, 0))
        ob.location = off
        for e in bpy.data.objects:
            pass
        x += w + 1.5
        rowh = max(rowh, d_)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, "kit_preview.blend"))
    print("SAVED kit_preview.blend", len(objs), "pieces")


main()
