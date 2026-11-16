"""Comparison frames of the memorial hall as the GAME draws it (Task 8; Blender 5.2, background).

  blender -b art/village/work/memorial_export.blend -P art/village/tools/render_memorial.py -- [--samples 64] [--fill 0.6]
  blender -b art/village/work/memorial_authoring.blend -P art/village/tools/render_memorial.py -- --cycles   (path-traced)

Game look: every LM_* material = albedo x light map x 1.6 (the hub/village recipe: lightMapIntensity 1.6 pi over a light
map that stores L / 2), M_* = their colour or texture as they are (unlit), no lights; then three.js Neutral tone
mapping at exposure 1.4 (the hall's `village` lighting preset) in numpy. The cubbies are dressed like Task 9 will dress
them: `--fill` of them (seed-stable) get props from memorial_props.blend placed at their anchor__cubby_* empties, with
generated placeholder pet portraits and Korean names.
Writes compare/memorial/game_<frame>.png (or cycles_<frame>.png) and prints mean / p5 luminance per frame.
"""
import math
import os
import random
import zlib
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vlib as U  # noqa: E402
from vlib import V  # noqa: E402

WORK = os.path.join(U.ROOT, "work")
OUT = os.path.join(U.ROOT, "compare", "memorial")
os.makedirs(OUT, exist_ok=True)
EXPOSURE = 1.4
LM_GAIN = 1.6
NAMES = ["보리", "구름", "치즈", "까미", "두부", "별이", "콩이", "초코", "루이", "하루", "몽이", "달이", "코코", "사랑이", "모모",
         "탄이", "호두", "밤이", "솜이", "나비"]
FRAMES = {
    "wide": ((296.8, 5.3, 1.62), (302.2, -5.0, 1.55), 17.0),
    "niches": ((301.0, -3.3, 1.5), (301.25, -6.0, 1.25), 30.0),
    "spawn": ((300.0, 5.6, 2.4), (300.0, -3.0, 1.1), 24.0),
}


def arg(name, default=None, cast=str):
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for x in a:
        if x.startswith(name + "="):
            return cast(x.split("=", 1)[1])
    return cast(a[a.index(name) + 1]) if name in a else default


def flag(name):
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return name in a


def photo_image(seed, w=160, h=200):
    """A placeholder pet portrait (soft painted dog or cat on a gradient), like the concept's."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    top = rng.uniform(0.35, 0.85, 3)
    bot = rng.uniform(0.25, 0.65, 3)
    t = (yy / h)[..., None]
    img = top * (1 - t) + bot * t
    furs = [(0.55, 0.36, 0.2), (0.92, 0.88, 0.8), (0.12, 0.1, 0.09), (0.6, 0.6, 0.6), (0.85, 0.55, 0.25), (0.75, 0.6, 0.42)]
    fur = np.array(furs[rng.integers(0, len(furs))])
    cat = rng.random() < 0.4
    cx, cy = w * rng.uniform(0.44, 0.56), h * 0.46

    def ell(x0, y0, rx, ry):
        return ((xx - x0) / rx) ** 2 + ((yy - y0) / ry) ** 2 < 1
    body = ell(cx, h * 0.98, w * 0.42, h * 0.32)
    head = ell(cx, cy, w * 0.25, h * 0.2)
    if cat:
        e1 = (yy > cy - h * 0.34) & (yy < cy - h * 0.08) & (np.abs(xx - (cx - w * 0.15)) < (yy - (cy - h * 0.34)) * 0.45)
        e2 = (yy > cy - h * 0.34) & (yy < cy - h * 0.08) & (np.abs(xx - (cx + w * 0.15)) < (yy - (cy - h * 0.34)) * 0.45)
    else:
        e1 = ell(cx - w * 0.24, cy + h * 0.02, w * 0.08, h * 0.16)
        e2 = ell(cx + w * 0.24, cy + h * 0.02, w * 0.08, h * 0.16)
    img[body | head | e1 | e2] = fur * rng.uniform(0.9, 1.05)
    if not cat:
        img[e1 | e2] = fur * 0.7
    img[ell(cx, cy + h * 0.08, w * 0.11, h * 0.07)] = np.clip(fur * 1.25, 0, 1)
    for ex in (-1, 1):
        img[ell(cx + ex * w * 0.09, cy - h * 0.02, w * 0.028, h * 0.024)] = (0.04, 0.03, 0.03)
    img[ell(cx, cy + h * 0.06, w * 0.035, h * 0.022)] = (0.05, 0.04, 0.04)
    for _ in range(3):
        img = (img + np.roll(img, 1, 0) + np.roll(img, -1, 0) + np.roll(img, 1, 1) + np.roll(img, -1, 1)) / 5
    rgba = np.concatenate([np.clip(img, 0, 1), np.ones((h, w, 1))], axis=2)[::-1].astype(np.float32)
    im = bpy.data.images.new(f"photo_{seed}", w, h)
    im.pixels.foreach_set(rgba.ravel())
    im.pack()
    return im


def emission_mat(name, colour=None, image=None, uv="UVMap", strength=1.0, alpha=None):
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = strength
    if image is not None:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = image
        u = nt.nodes.new("ShaderNodeUVMap")
        u.uv_map = uv
        nt.links.new(u.outputs[0], t.inputs["Vector"])
        nt.links.new(t.outputs["Color"], em.inputs["Color"])
    else:
        em.inputs["Color"].default_value = colour
    if alpha is not None:
        tr = nt.nodes.new("ShaderNodeBsdfTransparent")
        mx = nt.nodes.new("ShaderNodeMixShader")
        mx.inputs[0].default_value = alpha
        nt.links.new(tr.outputs[0], mx.inputs[1])
        nt.links.new(em.outputs[0], mx.inputs[2])
        nt.links.new(mx.outputs[0], out.inputs["Surface"])
    else:
        nt.links.new(em.outputs[0], out.inputs["Surface"])
    return m


def game_materials(lm_img):
    """Turn the export materials into what three draws (unlit)."""
    for m in list(bpy.data.materials):
        if not m.node_tree or "__src" in m.name:
            continue
        nt = m.node_tree
        name = m.name
        if not (name.startswith("LM_") or name.startswith("M_")):
            continue
        tex = next((n for n in nt.nodes if n.type == "TEX_IMAGE"), None)
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        flat = tuple(bsdf.inputs["Base Color"].default_value) if bsdf else (1, 1, 1, 1)
        alpha = bsdf.inputs["Alpha"].default_value if bsdf else 1.0
        img = tex.image if tex else None
        vc = any(n.type == "VERTEX_COLOR" for n in nt.nodes)
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        em = nt.nodes.new("ShaderNodeEmission")
        col = None
        if img is not None:
            t = nt.nodes.new("ShaderNodeTexImage")
            t.image = img
            u = nt.nodes.new("ShaderNodeUVMap")
            u.uv_map = "UVMap"
            nt.links.new(u.outputs[0], t.inputs["Vector"])
            col = t.outputs["Color"]
        else:
            em.inputs["Color"].default_value = flat
        if col is not None and vc:
            ca = nt.nodes.new("ShaderNodeVertexColor")
            ca.layer_name = "Col"
            mul = nt.nodes.new("ShaderNodeMix")
            mul.data_type = "RGBA"
            mul.blend_type = "MULTIPLY"
            mul.inputs["Factor"].default_value = 1.0
            nt.links.new(col, mul.inputs[6])
            nt.links.new(ca.outputs["Color"], mul.inputs[7])
            col = mul.outputs[2]
        if name.startswith("LM_"):
            lt = nt.nodes.new("ShaderNodeTexImage")
            lt.image = lm_img
            lu = nt.nodes.new("ShaderNodeUVMap")
            lu.uv_map = "UV_LM"
            nt.links.new(lu.outputs[0], lt.inputs["Vector"])
            mul2 = nt.nodes.new("ShaderNodeMix")
            mul2.data_type = "RGBA"
            mul2.blend_type = "MULTIPLY"
            mul2.inputs["Factor"].default_value = 1.0
            nt.links.new(col, mul2.inputs[6])
            nt.links.new(lt.outputs["Color"], mul2.inputs[7])
            col = mul2.outputs[2]
            em.inputs["Strength"].default_value = LM_GAIN
        if col is not None:
            nt.links.new(col, em.inputs["Color"])
        if alpha < 0.999:
            tr = nt.nodes.new("ShaderNodeBsdfTransparent")
            mx = nt.nodes.new("ShaderNodeMixShader")
            mx.inputs[0].default_value = alpha
            nt.links.new(tr.outputs[0], mx.inputs[1])
            nt.links.new(em.outputs[0], mx.inputs[2])
            nt.links.new(mx.outputs[0], out.inputs["Surface"])
        else:
            nt.links.new(em.outputs[0], out.inputs["Surface"])


def dress_cubbies(fill, game):
    """Place the props at the anchors like Task 9: `fill` of the cubbies, seed-stable."""
    path = os.path.join(WORK, "memorial_props.blend")
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n.startswith("prop__")]
    protos = {o.name[len("prop__"):]: o for o in dst.objects if o is not None}
    if game:
        # the props file's materials are already the unlit export ones: show them as the game would
        for o in protos.values():
            for slot in o.material_slots:
                m = slot.material
                if m and not m.get("_done"):
                    nt = m.node_tree
                    b = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
                    t = next((n for n in nt.nodes if n.type == "TEX_IMAGE"), None)
                    a = b.inputs["Alpha"].default_value if b else 1.0
                    new = emission_mat(m.name + "_g", colour=tuple(b.inputs["Base Color"].default_value) if b else (1, 1, 1, 1),
                                       image=t.image if t else None, alpha=a if a < 0.999 else None,
                                       strength=1.0)
                    new["_done"] = True
                    slot.material = new
    photos = [photo_image(100 + i) for i in range(18)]
    photo_mats = [emission_mat(f"ph_{i}", image=im) if game else None for i, im in enumerate(photos)]
    if not game:
        for i, im in enumerate(photos):
            m = bpy.data.materials.new(f"ph_{i}")
            b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
            t = m.node_tree.nodes.new("ShaderNodeTexImage")
            t.image = im
            m.node_tree.links.new(t.outputs["Color"], b.inputs["Base Color"])
            photo_mats[i] = m
    ink = emission_mat("ink_g", colour=(0.03, 0.025, 0.02, 1)) if game else None
    font = bpy.data.fonts.load("C:/Windows/Fonts/malgun.ttf", check_existing=True)
    coll = bpy.data.collections.new("dressing")
    bpy.context.scene.collection.children.link(coll)
    count = 0
    anchors = [o for o in bpy.data.objects if o.name.startswith("anchor__cubby_")]
    for a in sorted(anchors, key=lambda o: o.name):
        rng = random.Random(zlib.crc32(a.name.encode()))
        if rng.random() > fill:
            continue
        count += 1
        yaw = a.rotation_euler.z
        loc = a.matrix_world.translation
        gx, gz, gy = loc.x, -loc.y, loc.z
        fx, fz = math.sin(yaw), math.cos(yaw)
        sx, sz = fz, -fx     # the viewer's right (along the run)
        floor = gy - 0.2

        def put(kind, u, w, dy=0.0, turn=0.0, photo=None):
            p = protos[kind]
            ob = bpy.data.objects.new(f"{kind}_{a.name}", p.data)
            ob.location = V(gx + sx * u - fx * w, gz + sz * u - fz * w, floor + dy)
            ob.rotation_euler = (0, 0, yaw + turn)
            coll.objects.link(ob)
            if photo is not None:
                for i, slot in enumerate(p.material_slots):
                    if slot.material and slot.material.name.startswith("M_photo"):
                        ob.material_slots[i].link = "OBJECT"
                        ob.material_slots[i].material = photo
            return ob
        k = rng.random()
        put("urn_wood" if k < 0.55 else "urn_ceramic", rng.uniform(-0.1, -0.05), 0.2, turn=rng.uniform(-0.3, 0.3))
        if rng.random() < 0.85:
            put("photo_frame", rng.uniform(0.06, 0.09), 0.14, turn=rng.uniform(-0.15, 0.05), photo=photo_mats[count % len(photo_mats)])
        if rng.random() < 0.35:
            put("house_frame", rng.uniform(-0.03, 0.03), 0.3)
        if rng.random() < 0.55:
            put("flowers", rng.uniform(0.11, 0.15), 0.08, turn=rng.uniform(-1, 1))
        if rng.random() < 0.3:
            put("plush_bear", rng.uniform(-0.15, -0.12), 0.1, turn=rng.uniform(-0.4, 0.2))
        elif rng.random() < 0.5:
            put("tealight", rng.uniform(-0.15, -0.11), 0.06)
        if rng.random() < 0.2:
            put("stone_jar", rng.uniform(0.0, 0.04), 0.27)
        if rng.random() < 0.7:
            nx = rng.uniform(-0.06, 0.02)
            card = put("name_card", nx, 0.03)
            cu = bpy.data.curves.new(f"nt_{a.name}", "FONT")
            cu.body = NAMES[count % len(NAMES)]
            cu.font = font
            cu.size = 0.017
            cu.align_x = "CENTER"
            cu.align_y = "CENTER"
            t = bpy.data.objects.new(f"nt_{a.name}", cu)
            lean = math.radians(18)
            # on the card's front face, 1 mm out
            cxp, czp = gx + sx * nx - fx * 0.03, gz + sz * nx - fz * 0.03
            t.location = V(cxp + fx * (0.04 * math.sin(lean) * 0.5 + 0.001), czp + fz * (0.04 * math.sin(lean) * 0.5 + 0.001),
                           floor + 0.02 * math.cos(lean))
            t.rotation_euler = (math.pi / 2 - lean, 0, yaw)
            t.data.materials.append(ink if game else bpy.data.materials.get("P_dark"))
            coll.objects.link(t)
    print("dressed cubbies", count, "of", len(anchors))


def neutral(c):
    start, desat = 0.76, 0.15
    x = c.min(-1, keepdims=True)
    offset = np.where(x < 0.08, x - 6.25 * x * x, 0.04)
    c = c - offset
    peak = c.max(-1, keepdims=True)
    d = 1.0 - start
    new_peak = 1.0 - d * d / (peak + d - start)
    comp = c * np.where(peak > start, new_peak / np.maximum(peak, 1e-6), 1.0)
    g = 1.0 - 1.0 / (desat * (peak - new_peak) + 1.0)
    return np.where(peak > start, comp * (1 - g) + new_peak * g, comp)


def tone(exr, png):
    img = bpy.data.images.load(exr)
    w, h = img.size
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    c = neutral(np.clip(a.reshape(h, w, 4)[..., :3], 0, None) * EXPOSURE)
    lum = c @ np.array([0.2126, 0.7152, 0.0722])
    s = np.clip(c, 0, 1)
    s = np.where(s <= 0.0031308, s * 12.92, 1.055 * np.power(s, 1 / 2.4) - 0.055)
    srgb_l = s @ np.array([0.2126, 0.7152, 0.0722])
    out = bpy.data.images.new("t", w, h, alpha=False)
    out.colorspace_settings.name = "Non-Color"
    o4 = np.ones((h, w, 4), np.float32)
    o4[..., :3] = s
    out.pixels.foreach_set(o4.ravel())
    out.filepath_raw = png
    out.file_format = "PNG"
    out.save()
    print(f"LUMA {os.path.basename(png)}: mean sRGB luma {srgb_l.mean():.3f}, p5 {np.percentile(srgb_l, 5):.3f}, "
          f"linear mean {lum.mean():.3f}")


def camera(scene, name, eye, target, lens):
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    cd.sensor_width = 36.0
    cd.clip_start = 0.05
    cd.clip_end = 300
    cam = bpy.data.objects.new(name, cd)
    scene.collection.objects.link(cam)
    cam.location = V(*eye)
    d = V(*target) - V(*eye)
    cam.rotation_mode = "QUATERNION"
    cam.rotation_quaternion = d.to_track_quat("-Z", "Y")
    return cam


def main():
    scene = bpy.context.scene
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
    res = arg("--res", "1920x1080")
    scene.render.resolution_x, scene.render.resolution_y = (int(v) for v in res.split("x"))
    scene.render.resolution_percentage = 100
    cyc = flag("--cycles")
    for o in bpy.data.objects:
        if o.name.startswith("col__"):
            o.hide_render = True
    dress_cubbies(arg("--fill", 0.6, float), game=not cyc)
    only = arg("--frames")
    names = only.split(",") if only else list(FRAMES)
    if cyc:
        scene.cycles.samples = arg("--samples", 256, int)
        scene.cycles.use_denoising = True
        scene.view_settings.view_transform = "AgX"
        try:
            scene.view_settings.look = "AgX - Medium High Contrast"
        except Exception:
            pass
        for n in names:
            eye, tgt, lens = FRAMES[n]
            scene.camera = camera(scene, "cam_" + n, eye, tgt, lens)
            scene.render.image_settings.file_format = "PNG"
            scene.render.filepath = os.path.join(OUT, f"cycles_{n}.png")
            bpy.ops.render.render(write_still=True)
        return
    lm = bpy.data.images.load(os.path.join(WORK, "memorial_lm.png"), check_existing=True)
    lm.colorspace_settings.name = "sRGB"
    game_materials(lm)
    for o in bpy.data.objects:
        if o.type == "LIGHT":
            o.hide_render = True
    if scene.world:
        for nd in scene.world.node_tree.nodes:
            if nd.type == "BACKGROUND":
                nd.inputs["Strength"].default_value = 0.0
    scene.cycles.samples = arg("--samples", 48, int)
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 4
    scene.cycles.transparent_max_bounces = 16
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.render.image_settings.file_format = "OPEN_EXR"
    scene.render.image_settings.color_depth = "32"
    for n in names:
        eye, tgt, lens = FRAMES[n]
        scene.camera = camera(scene, "cam_" + n, eye, tgt, lens)
        exr = os.path.join(OUT, f"game_{n}.exr")
        scene.render.filepath = exr
        bpy.ops.render.render(write_still=True)
        tone(exr, os.path.join(OUT, f"game_{n}.png"))


if __name__ == "__main__":
    main()
