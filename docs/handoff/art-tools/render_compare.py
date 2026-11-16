"""Comparison frames (Blender 5.2, background).

  blender -b art/village/work/village_authoring.blend -P art/village/tools/render_compare.py -- --mode cycles
  blender -b art/village/work/village_export.blend    -P art/village/tools/render_compare.py -- --mode lm

cycles: the authoring scene in Cycles (AgX, 24-35 mm) from 4 cameras -> compare/raw/<frame>.png
lm:     the exported scene as the game draws it (unlit: albedo x baked light map x 1.6 on LM_*, albedo x vertex light on
        foliage, M_* textures as they are) -> compare/raw/<frame>_lm.exr; compare.py tone-maps it like three.js (ACES).
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vlib as U  # noqa: E402
from vlib import V  # noqa: E402

RAW = os.path.join(U.ROOT, "compare", "raw")
os.makedirs(RAW, exist_ok=True)

FRAMES = {
    # name: (eye (x, z, y), target (x, z, y), lens mm)
    "plaza_spawn": ((0.0, 14.0, 1.6), (0.0, 0.0, 3.2), 24.0),
    "plaza_overview": ((9.0, 50.0, 16.0), (0.0, -8.0, 0.0), 26.0),
    "creek_bridge": ((-13.0, 89.0, 3.2), (-24.5, 75.0, 0.2), 28.0),
    "memorial": ((-8.5, -45.0, 2.4), (1.0, -57.0, 2.4), 24.0),
}


def arg(name, default=None, cast=str):
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for x in a:
        if x.startswith(name + "="):
            return cast(x.split("=", 1)[1])
    return cast(a[a.index(name) + 1]) if name in a else default


def camera(scene, name, eye, target, lens):
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    cd.sensor_width = 36.0
    cd.clip_start = 0.1
    cd.clip_end = 3000.0
    cam = bpy.data.objects.new(name, cd)
    scene.collection.objects.link(cam)
    cam.location = V(*eye)
    d = V(*target) - V(*eye)
    cam.rotation_mode = "QUATERNION"
    cam.rotation_quaternion = d.to_track_quat("-Z", "Y")
    return cam


def gpu(scene, samples):
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "OPTIX"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == "OPTIX"
    scene.cycles.device = "GPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.transparent_max_bounces = 32
    scene.render.resolution_x, scene.render.resolution_y = 1920, 1080


# ------------------------------------------------------------------------------------------------- lm --

LM_GAIN = 1.6


def lm_materials(lm_png):
    lm_img = bpy.data.images.load(lm_png, check_existing=True)
    lm_img.colorspace_settings.name = "sRGB"
    vc = {"LM_render", "LM_wood", "LM_roof", "LM_grass", "M_leaf_green", "M_leaf_cherry", "M_leaf_flora", "M_bark"}
    for m in bpy.data.materials:
        if not m.node_tree or "__src" in m.name:
            continue
        name = m.name
        if not (name.startswith("LM_") or name.startswith("M_")):
            continue
        nt = m.node_tree
        tex = next((n for n in nt.nodes if n.type == "TEX_IMAGE"), None)
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        flat = bsdf.inputs["Base Color"].default_value[:] if bsdf else (1, 1, 1, 1)
        keep = tex.name if tex is not None else None
        for n in list(nt.nodes):
            if n.name != keep:
                nt.nodes.remove(n)
        tex = nt.nodes.get(keep) if keep else None
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        em = nt.nodes.new("ShaderNodeEmission")
        if tex is not None:
            uvn = nt.nodes.new("ShaderNodeUVMap")
            uvn.uv_map = "UVMap"
            nt.links.new(uvn.outputs[0], tex.inputs["Vector"])
            col = tex.outputs["Color"]
        else:
            em.inputs["Color"].default_value = flat
            col = None
        if col is not None and name in vc:
            ca = nt.nodes.new("ShaderNodeVertexColor")
            ca.layer_name = "Col"
            mul = nt.nodes.new("ShaderNodeMix")
            mul.data_type = "RGBA"
            mul.blend_type = "MULTIPLY"
            mul.inputs["Factor"].default_value = 1.0
            nt.links.new(col, mul.inputs[6])
            nt.links.new(ca.outputs["Color"], mul.inputs[7])
            col = mul.outputs[2]
        if col is not None and name.startswith("LM_"):
            lmt = nt.nodes.new("ShaderNodeTexImage")
            lmt.image = lm_img
            luv = nt.nodes.new("ShaderNodeUVMap")
            luv.uv_map = "UV_LM"
            nt.links.new(luv.outputs[0], lmt.inputs["Vector"])
            mul2 = nt.nodes.new("ShaderNodeMix")
            mul2.data_type = "RGBA"
            mul2.blend_type = "MULTIPLY"
            mul2.inputs["Factor"].default_value = 1.0
            nt.links.new(col, mul2.inputs[6])
            nt.links.new(lmt.outputs["Color"], mul2.inputs[7])
            col = mul2.outputs[2]
            em.inputs["Strength"].default_value = LM_GAIN
        if col is not None:
            nt.links.new(col, em.inputs["Color"])
        if tex is not None and name in ("M_leaf_green", "M_leaf_cherry", "M_leaf_flora", "M_water", "M_waterfall", "M_glass"):
            tr = nt.nodes.new("ShaderNodeBsdfTransparent")
            mix = nt.nodes.new("ShaderNodeMixShader")
            if name.startswith("M_leaf"):
                rnd = nt.nodes.new("ShaderNodeMath")
                rnd.operation = "GREATER_THAN"
                rnd.inputs[1].default_value = 0.5
                nt.links.new(tex.outputs["Alpha"], rnd.inputs[0])
                nt.links.new(rnd.outputs[0], mix.inputs[0])
            else:
                nt.links.new(tex.outputs["Alpha"], mix.inputs[0])
            nt.links.new(tr.outputs[0], mix.inputs[1])
            nt.links.new(em.outputs[0], mix.inputs[2])
            nt.links.new(mix.outputs[0], out.inputs["Surface"])
        else:
            nt.links.new(em.outputs[0], out.inputs["Surface"])


def aces_png(exr, png, exposure=1.0):
    """three.js ACESFilmicToneMapping (r150+) + sRGB output, applied to the linear render."""
    import numpy as np
    img = bpy.data.images.load(exr)
    w, h = img.size
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    c = a.reshape(h, w, 4)[..., :3] * (exposure / 0.6)
    m_in = np.array([[0.59719, 0.35458, 0.04823], [0.07600, 0.90834, 0.01566], [0.02840, 0.13383, 0.83777]], np.float32)
    m_out = np.array([[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]],
                     np.float32)
    c = c @ m_in.T
    num = c * (c + 0.0245786) - 0.000090537
    den = c * (0.983729 * c + 0.4329510) + 0.238081
    c = np.clip((num / den) @ m_out.T, 0, 1)
    c = np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)
    out = bpy.data.images.new("aces", w, h, alpha=False)
    out.colorspace_settings.name = "Non-Color"
    o4 = np.ones((h, w, 4), np.float32)
    o4[..., :3] = c
    out.pixels.foreach_set(o4.ravel())
    out.filepath_raw = png
    out.file_format = "PNG"
    out.save()


def main():
    scene = bpy.context.scene
    mode = arg("--mode", "cycles")
    only = arg("--frames")
    names = only.split(",") if only else list(FRAMES)
    if mode == "cycles":
        gpu(scene, arg("--samples", 256, int))
        scene.view_settings.view_transform = "AgX"
        try:
            scene.view_settings.look = "AgX - Medium High Contrast"
        except Exception:
            pass
        for n in names:
            eye, tgt, lens = FRAMES[n]
            scene.camera = camera(scene, "cam_" + n, eye, tgt, lens)
            scene.render.image_settings.file_format = "PNG"
            scene.render.filepath = os.path.join(RAW, n + ".png")
            bpy.ops.render.render(write_still=True)
            print("RENDERED", scene.render.filepath, flush=True)
    else:
        gpu(scene, arg("--samples", 48, int))
        scene.cycles.use_denoising = False
        lm_materials(os.path.join(U.ROOT, "work", "village_lm.png"))
        for o in bpy.data.objects:
            if o.name.startswith("col__"):
                o.hide_render = True
            if o.type == "LIGHT":
                o.hide_render = True
            if o.name == "village_sky":
                o.visible_camera = True
        if scene.world:
            for nd in scene.world.node_tree.nodes:
                if nd.type == "BACKGROUND":
                    nd.inputs["Strength"].default_value = 0.0
        scene.cycles.max_bounces = 0
        scene.view_settings.view_transform = "Standard"
        scene.view_settings.look = "None"
        scene.render.image_settings.file_format = "OPEN_EXR"
        scene.render.image_settings.color_depth = "32"
        for n in names:
            eye, tgt, lens = FRAMES[n]
            scene.camera = camera(scene, "cam_" + n, eye, tgt, lens)
            scene.render.filepath = os.path.join(RAW, n + "_lm.exr")
            bpy.ops.render.render(write_still=True)
            aces_png(scene.render.filepath, os.path.join(RAW, n + "_lm.png"), arg("--exposure", 1.0, float))
            print("RENDERED", scene.render.filepath, flush=True)


if __name__ == "__main__":
    main()
