"""Review renders of a house (houses interior; Blender 5.x background, Cycles): eye-height views of each room, day or night.

  blender -b art/village/work/house_N_authoring.blend -P art/village/tools/houses/render_house.py -- --house N --tag day|night
          [--views art/village/work/house_N_views.json] [--samples 64] [--res 1280] [--only name1,name2] [--out art/village/work/review]

views.json = [{"name": "f1_entry", "floor": 1, "eye": [lx, lz, ly], "look": [lx, lz, ly], "lens": 20, "room": "..."}] in ROOM-LOCAL metres
(the contract's frame: x 0..10.6 left -> right as seen from the door, z 0..7.8 door wall -> back wall). Windows show the house's
real-village panorama (work/pano/house_N_pano_{day,night}.png) on a cylinder round each floor, like the game will.
Lights: the same sun / sky / light__ empties as the bake (bake_house.setup_lights), day lamps low, night lamps on.
"""
import json
import math
import os
import sys

import bpy
import bmesh

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import kit_core as K  # noqa: E402
import house_common as HC  # noqa: E402
import bake_house as BH  # noqa: E402


def arg(name, default=None, cast=str):
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for i, x in enumerate(a):
        if x == name:
            return cast(a[i + 1]) if i + 1 < len(a) and not a[i + 1].startswith("--") else True
    return default


def pano_band(n, floor, tag):
    path = os.path.join(K.WORK, "pano", f"house_{n}_pano_{tag}.png")
    if not os.path.exists(path):
        return None
    ox, oz = HC.HCT.origin(n, floor)
    cx, cy = ox + 5.3, 3.9 - oz
    R, segs = 13.0, 96
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    top, bot = 2.0 + R, 2.0 - R
    for i in range(segs):
        a0, a1 = 2 * math.pi * i / segs, 2 * math.pi * (i + 1) / segs
        # angle a measured from north (+Y) towards east (+X); u = 0.5 + a / 2pi (wrapped so that north is the image centre)
        pts = []
        for a in (a0, a1):
            pts.append((cx + R * math.sin(a), cy + R * math.cos(a)))
        vs = [bm.verts.new((pts[0][0], pts[0][1], bot)), bm.verts.new((pts[1][0], pts[1][1], bot)),
              bm.verts.new((pts[1][0], pts[1][1], top)), bm.verts.new((pts[0][0], pts[0][1], top))]
        f = bm.faces.new(vs)
        for lp, (aa, v) in zip(f.loops, ((a0, 0), (a1, 0), (a1, 1), (a0, 1))):
            u = 0.5 + aa / (2 * math.pi)       # image repeats: 0.5 = north (the image centre), 1.0 = south, 1.5 = north again
            lp[uv].uv = (u, v)
    me = bpy.data.meshes.new(f"pano_{floor}")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(f"pano_{floor}", me)
    bpy.context.scene.collection.objects.link(ob)
    m = bpy.data.materials.new("PanoMat")
    nt = m.node_tree
    for x in list(nt.nodes):
        nt.nodes.remove(x)
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = bpy.data.images.load(path, check_existing=True)
    t.extension = "REPEAT"
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Strength"].default_value = 1.0
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(t.outputs["Color"], e.inputs["Color"])
    nt.links.new(e.outputs[0], o.inputs["Surface"])
    me.materials.append(m)
    ob.visible_diffuse = ob.visible_glossy = ob.visible_shadow = False
    return ob


def main():
    n = arg("--house", 0, int)
    tag = arg("--tag", "day")
    night = tag == "night"
    samples = arg("--samples", 64, int)
    res = arg("--res", 1280, int)
    out = os.path.abspath(arg("--out", os.path.join(K.WORK, "review")))
    os.makedirs(out, exist_ok=True)
    views = json.load(open(arg("--views", os.path.join(K.WORK, f"house_{n}_views.json")), encoding="utf-8"))
    only = arg("--only")
    if only:
        views = [v for v in views if v["name"] in only.split(",")]
    sc = bpy.context.scene
    BH.gpu(sc)
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 8
    sc.cycles.transmission_bounces = 8
    sc.render.resolution_x = res
    sc.render.resolution_y = int(res * 9 / 16)
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.exposure = arg("--exposure", 0.0, float)
    try:
        sc.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass
    for m in bpy.data.materials:        # thin glass: a single plane must not refract
        if m.name == "H_glass" and m.node_tree:
            for nd in m.node_tree.nodes:
                if nd.type == "BSDF_PRINCIPLED":
                    nd.inputs["IOR"].default_value = 1.0
    for m in bpy.data.materials:        # hanji panels / lamp shades (H_shade) are baked as openings (the game draws them unlit): let light through here too
        if m.name in ("H_shade", "H_hanji") and m.node_tree:
            nt = m.node_tree
            mout = next(nd for nd in nt.nodes if nd.type == "OUTPUT_MATERIAL")
            src = mout.inputs["Surface"].links[0].from_node
            tr = nt.nodes.new("ShaderNodeBsdfTransparent")
            mx = nt.nodes.new("ShaderNodeMixShader")
            mx.inputs["Fac"].default_value = 0.5
            nt.links.new(tr.outputs[0], mx.inputs[1])
            nt.links.new(src.outputs[0], mx.inputs[2])
            nt.links.new(mx.outputs[0], mout.inputs["Surface"])
    for o in bpy.data.objects:
        if o.name.startswith((K.COL_PREFIX, "ceil__")) or o.get("cat") == "view":
            o.hide_render = True
    BH.setup_lights(sc, night)
    if night:      # a hint of moonlight so the window panes read as night rather than black
        sd = bpy.data.lights.new("moon", "SUN")
        sd.energy = 0.25
        sd.color = (0.6, 0.7, 1.0)
        mo = bpy.data.objects.new("moon", sd)
        sc.collection.objects.link(mo)
        mo.rotation_euler = (math.radians(50), 0, math.radians(35))
    for f in (1, 2):
        if any(v["floor"] == f for v in views):
            pano_band(n, f, tag)
    cd = bpy.data.cameras.new("rc")
    cd.sensor_width = 36
    co = bpy.data.objects.new("rc", cd)
    sc.collection.objects.link(co)
    sc.camera = co
    from mathutils import Vector
    for v in views:
        ox, oz = HC.HCT.origin(n, v["floor"])
        def W(p):
            return Vector((ox + p[0], p[1] - oz, p[2]))
        co.location = W(v["eye"])
        d = W(v["look"]) - co.location
        co.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        cd.lens = v.get("lens", 20)
        sc.render.filepath = os.path.join(out, f"h{n}_{v['name']}_{tag}.png")
        bpy.ops.render.render(write_still=True)
        print("RENDERED", sc.render.filepath, flush=True)


main()
