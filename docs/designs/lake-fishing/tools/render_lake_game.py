"""A 'game look' preview of the SHIPPED lake.glb (what the client will draw), Blender background, Cycles:
albedo x vertex colour x light map (UV1) x 1.6, shown unlit like the game's basic shader (the file stores L / 2, the game
multiplies by 0.8 * 2: GAME_GAIN), the water as a glossy surface (Fresnel F0 0.02, the green-brown body of design 4.2) that
reflects the baked panorama, the panorama as the sky. It tests the export (Draco, UV1, instancing, vertex colours) and shows the
light of the bake; it is NOT the game's water shader.

  blender -b --factory-startup -P art/lake/tools/render_lake_game.py -- --out DIR [--night] \
      --view name:ex,ey,ez:tx,ty,tz:lens [--view ...] [--res 1280x720] [--samples 48]
"""
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
LAKE = os.path.dirname(HERE)
REPO = os.path.dirname(os.path.dirname(LAKE))
EXPORT = os.path.join(LAKE, "export")


def args():
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def getall(name):
    a = args()
    return [a[i + 1] for i, x in enumerate(a) if x == name and i + 1 < len(a)]


def get(name, default=None):
    r = getall(name)
    return r[0] if r else default


def V(x, z, y):
    return Vector((x, -z, y))


def img(path, srgb=True):
    im = bpy.data.images.load(path, check_existing=True)
    im.colorspace_settings.name = "sRGB" if srgb else "Non-Color"
    return im


def build_material(mat, lm_img, uvs, col_name, is_lm, tinted):
    old_img = None
    if mat.node_tree:
        for n in mat.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image is not None:
                old_img = n.image
                break
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    name = mat.name.split(".")[0]
    if name == "M_lakewater":
        b = nt.nodes.new("ShaderNodeBsdfPrincipled")
        b.inputs["Base Color"].default_value = (0.045, 0.062, 0.03, 1)
        b.inputs["Roughness"].default_value = 0.03
        b.inputs["IOR"].default_value = 1.33
        nt.links.new(b.outputs[0], out.inputs["Surface"])
        return
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    color = None
    if old_img is not None:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = old_img
        uv = nt.nodes.new("ShaderNodeUVMap")
        uv.uv_map = uvs[0]
        nt.links.new(uv.outputs[0], t.inputs["Vector"])
        color = t.outputs["Color"]
        if name.startswith("M_leaf"):
            tr = nt.nodes.new("ShaderNodeBsdfTransparent")
            mix = nt.nodes.new("ShaderNodeMixShader")
            nt.links.new(t.outputs["Alpha"], mix.inputs[0])
            nt.links.new(tr.outputs[0], mix.inputs[1])
            nt.links.new(em.outputs[0], mix.inputs[2])
            nt.links.new(mix.outputs[0], out.inputs["Surface"])
    if col_name and (tinted or color is None):
        vc = nt.nodes.new("ShaderNodeVertexColor")
        vc.layer_name = col_name
        if color is None:
            color = vc.outputs["Color"]
        else:
            m = nt.nodes.new("ShaderNodeMix")
            m.data_type = "RGBA"
            m.blend_type = "MULTIPLY"
            m.inputs["Factor"].default_value = 1.0
            nt.links.new(color, m.inputs[6])
            nt.links.new(vc.outputs["Color"], m.inputs[7])
            color = m.outputs[2]
    if color is None:
        em.inputs["Color"].default_value = (0.5, 0.5, 0.5, 1)
        return
    if is_lm and lm_img is not None and len(uvs) > 1:
        lu = nt.nodes.new("ShaderNodeUVMap")
        lu.uv_map = uvs[1]
        lt = nt.nodes.new("ShaderNodeTexImage")
        lt.image = lm_img
        nt.links.new(lu.outputs[0], lt.inputs["Vector"])
        m = nt.nodes.new("ShaderNodeMix")
        m.data_type = "RGBA"
        m.blend_type = "MULTIPLY"
        m.inputs["Factor"].default_value = 1.0
        nt.links.new(color, m.inputs[6])
        nt.links.new(lt.outputs["Color"], m.inputs[7])
        color = m.outputs[2]
        em.inputs["Strength"].default_value = 1.6      # 2.0 (the file stores L / 2) x 0.8 (the game's gain)
    nt.links.new(color, em.inputs["Color"])


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    night = "--night" in args()
    glb = os.path.join(EXPORT, "lake.glb")
    bpy.ops.import_scene.gltf(filepath=glb)
    lm_img = img(os.path.join(EXPORT, "lake_lm_night.webp" if night else "lake_lm.webp"))
    for ob in bpy.data.objects:
        if ob.type != "MESH":
            continue
        uvs = [u.name for u in ob.data.uv_layers]
        col = ob.data.color_attributes[0].name if len(ob.data.color_attributes) else None
        for slot in ob.material_slots:
            mat = slot.material
            if mat is None:
                continue
            nm = mat.name.split(".")[0]
            build_material(mat, lm_img, uvs, col, nm.startswith("LM_") or nm == "M_lakewater", nm in ("LM_grass", "LM_mud", "LM_gravel", "LM_dirt", "M_bark", "M_plant"))
    # the panorama is the sky (and what the water mirrors)
    pano = img(os.path.join(EXPORT, "lake_refl_night.webp" if night else "lake_refl_day.webp"))
    w = bpy.data.worlds.new("W")
    scene.world = w
    nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = pano
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Rotation"].default_value = (0, 0, math.radians(float(get("--pano-rot", 90))))
    nt.links.new(tc.outputs["Generated"], mp.inputs["Vector"])
    nt.links.new(mp.outputs[0], env.inputs["Vector"])
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = 1.0
    nt.links.new(env.outputs["Color"], bg.inputs["Color"])
    o = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(bg.outputs[0], o.inputs["Surface"])
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
    scene.cycles.samples = int(get("--samples", 48))
    scene.cycles.use_denoising = True
    w_, h_ = (int(v) for v in get("--res", "1280x720").split("x"))
    scene.render.resolution_x, scene.render.resolution_y = w_, h_
    try:
        scene.view_settings.view_transform = "Khronos PBR Neutral"
    except Exception:
        scene.view_settings.view_transform = "Standard"
    scene.view_settings.exposure = math.log2(1.4) + float(get("--exposure", 0.0))
    out = get("--out", os.path.join(LAKE, "work", "renders"))
    os.makedirs(out, exist_ok=True)
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
        scene.render.filepath = os.path.join(out, "game_" + name + ("_night" if night else "") + ".png")
        bpy.ops.render.render(write_still=True)
        print("RENDERED", scene.render.filepath)


main()
