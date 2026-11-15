"""Bake and export the memorial hall interior (케이슨 마을 Task 8, rebuilt 2026-11-13; Blender 5.2, background).

  blender -b art/village/work/memorial_authoring.blend -P art/village/tools/bake_memorial.py -- [--samples 1024] [--size 2048]
  blender -b art/village/work/memorial_lmprep.blend   -P art/village/tools/bake_memorial.py -- --night [--samples 768]
  python art/village/tools/post_memorial.py          (light map PNGs -> WebP, seats/anchors JSON, copies the shipped files to the client)

Day run: bakes the day light map and exports memorial.glb + work/../export/memorial_seats.json (the seat__ markers).
Night run (--night): loads the day run's memorial_lmprep.blend (the same UV_LM), turns the sun and skylight off, the sky
dark blue, the cove and downlights down, leaves the LED rows, the niche spot, the lamp and the garden lamps on, and bakes
work/memorial_lm_night.png. The game blends the two maps with the village clock (client/src/village/hallNight.ts).

  1. light-map UV ("UV_LM", 2nd set) packed over every cat "lm" mesh with a texel weight per object ("lmw")
  2. Cycles DIFFUSE bake (direct + indirect) lit by the hall's own lights only: 12 downlight spots, the skylight
     area light, one warm area light under every LED row, and the sky through the three windows (the garden card and
     the window glass are hidden for the bake). Stored as L / 2 (sRGB 8-bit), like the village (bake_village.py
     LM_SCALE): the game multiplies by lightMapIntensity 1.6 pi. A small ambient lift keeps deep corners off black.
  3. authoring materials -> export materials (LM_* = albedo texture + light map; M_* unlit)
  4. join the light-mapped meshes into one node (hall_lm) and the rest into hall_fx; LED strips stay GPU instances;
     col__* boxes, anchor__cubby_* empties and ceil__hall export as nodes. Draco, KHR_materials_unlit.
"""
import json
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vlib as U  # noqa: E402
import bake_village as BV  # noqa: E402

WORK = os.path.join(U.ROOT, "work")
EXPORT = os.path.join(U.ROOT, "export")
TEXM = os.path.join(WORK, "tex_m")
LM_LIFT = 0.06

TEXTURES = {
    "LM_floor": "T_m_floor.png", "LM_plaster": "T_m_plaster.png", "LM_lacquer": "T_m_lacquer.png",
    "LM_oak": "T_m_oak.png", "LM_fabric": "T_m_fabric.png", "LM_atlas": "T_m_atlas.png", "M_garden": "T_m_garden.png",
    "LM_signs": "T_m_signs.png", "LM_painting": "T_m_painting.png",
    # round 6: the white lacquer cubby interiors, unlit with their own shared light texture (bake_cubby.py, day | night)
    "M_cubby_in": "T_m_cubby_in.png",
}
VERTEX_COLOUR = {"LM_fabric", "LM_plaster", "LM_oak"}
FLAT = {"M_lamp": ("#FFE6C8", 1.0), "M_skylight": ("#F6F9FF", 1.0), "M_glass": ("#E8F0F2", 0.16), "M_alu": ("#D2CFC8", 1.0),
        # the east bank's cubby doors (round 5): their own glass, which the game shades as reflective glass (memorialModelPrep.ts)
        "M_glass_e": ("#E8F0F2", 0.16),
        # the flower stand's petals (round 5): unlit, white times the shaded petal colour in the vertex colour
        "M_petal": ("#FFFFFF", 1.0)}
FLAT_VERTEX_COLOUR = {"M_petal"}


def arg(name, default=None, cast=str):
    return BV.arg(name, default, cast)


def export_materials():
    out = {}
    for name in list(TEXTURES) + list(FLAT):
        old = bpy.data.materials.get(name)
        if old:
            old.name = name + "__src"
        m = bpy.data.materials.new(name)
        nt = m.node_tree
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        o = nt.nodes.new("ShaderNodeOutputMaterial")
        b = nt.nodes.new("ShaderNodeBsdfPrincipled")
        b.inputs["Metallic"].default_value = 0.0
        b.inputs["Roughness"].default_value = 1.0
        nt.links.new(b.outputs[0], o.inputs["Surface"])
        if name in FLAT:
            col, alpha = FLAT[name]
            b.inputs["Base Color"].default_value = U.rgba(col)
            if name in FLAT_VERTEX_COLOUR:
                ca = nt.nodes.new("ShaderNodeVertexColor")
                ca.layer_name = "Col"
                nt.links.new(ca.outputs["Color"], b.inputs["Base Color"])
            if alpha < 1.0:
                b.inputs["Alpha"].default_value = alpha
        else:
            img = bpy.data.images.load(os.path.join(TEXM, TEXTURES[name]), check_existing=True)
            img.colorspace_settings.name = "sRGB"
            t = nt.nodes.new("ShaderNodeTexImage")
            t.image = img
            uvn = nt.nodes.new("ShaderNodeUVMap")
            uvn.uv_map = "UVMap"
            nt.links.new(uvn.outputs[0], t.inputs["Vector"])
            col = t.outputs["Color"]
            if name in VERTEX_COLOUR:
                ca = nt.nodes.new("ShaderNodeVertexColor")
                ca.layer_name = "Col"
                mix = nt.nodes.new("ShaderNodeMix")
                mix.data_type = "RGBA"
                mix.blend_type = "MULTIPLY"
                mix.inputs["Factor"].default_value = 1.0
                nt.links.new(col, mix.inputs[6])
                nt.links.new(ca.outputs["Color"], mix.inputs[7])
                col = mix.outputs[2]
            nt.links.new(col, b.inputs["Base Color"])
        out[name] = m
    return out


def bake_passes(scene, lms, size, samples, passes, out_png, lift=LM_LIFT):
    """`passes` bakes of `samples` each with different seeds, averaged in linear light (one long GPU bake can trip the
    driver's watchdog; several shorter ones cannot), then the ambient lift and the L / 2 sRGB encoding."""
    import numpy as np
    acc = None
    stats = {}
    for i in range(passes):
        scene.cycles.seed = 17 + i * 101
        part = os.path.join(WORK, f"memorial_lm_pass{i}.png")
        stats = BV.bake_lightmap(scene, lms, size, samples, part, emit_on=False, lift=0.0)
        img = bpy.data.images.load(part)
        img.colorspace_settings.name = "Non-Color"
        px = np.empty(size * size * 4, np.float32)
        img.pixels.foreach_get(px)
        bpy.data.images.remove(img)
        e = px.reshape(size, size, 4)[..., :3]
        lin = np.where(e <= 0.04045, e / 12.92, ((e + 0.055) / 1.055) ** 2.4) * BV.LM_SCALE
        acc = lin if acc is None else acc + lin
        BV.log(f"pass {i + 1}/{passes}")
    b = acc / passes + lift * np.array([0.92, 0.96, 1.0], np.float32)
    enc = np.clip(b / BV.LM_SCALE, 0, 1)
    enc = np.where(enc <= 0.0031308, enc * 12.92, 1.055 * np.power(enc, 1 / 2.4) - 0.055)
    BV.save_png(enc, out_png)
    return stats


def patch(path):
    js = BV.patch_glb(path)
    # M_glass: the village patch makes it BLEND already; the memorial's lights stay opaque and single-sided
    return js


NIGHT = {
    "sky": (0.020, 0.030, 0.070),
    "scale": {"downlight": 0.35, "cove": 0.55, "led": 1.0, "niche": 1.0, "brand": 0.5, "lamp": 1.0},
    "skylight": (0.55, 0.65, 1.0, 14.0),          # colour + energy (day: 300)
    "garden_lamps": [(290.6, 0.4), (290.6, 2.6), (290.6, 4.6)],   # warm lamps in the garden, lighting the room through the window
    "lift": 0.012,
}


def setup_night(scene):
    for o in bpy.data.objects:
        if o.type != "LIGHT":
            continue
        kind = o.get("kind") or ("cove" if o.name.startswith("cove_") else "")
        if kind == "sun":
            o.data.energy = 0.0
        elif kind == "skylight":
            r, g, b, e = NIGHT["skylight"]
            o.data.color = (r, g, b)
            o.data.energy = e
        elif kind in NIGHT["scale"]:
            o.data.energy *= NIGHT["scale"][kind]
    w = bpy.data.worlds.new("NightWorld")
    scene.world = w
    nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Color"].default_value = (*NIGHT["sky"], 1.0)
    bg.inputs["Strength"].default_value = 1.0
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(bg.outputs[0], out.inputs["Surface"])
    for i, (x, z) in enumerate(NIGHT["garden_lamps"]):
        ld = bpy.data.lights.new(f"garden_lamp_{i}", "POINT")
        ld.energy = 90.0
        ld.color = (1.0, 0.74, 0.44)
        ld.shadow_soft_size = 0.25
        lo = bpy.data.objects.new(f"garden_lamp_{i}", ld)
        lo.location = U.V(x, z, 0.9)
        scene.collection.objects.link(lo)


def dump_seats(path):
    keys = ("id", "furn", "kind", "x", "z", "y", "yaw", "edge", "back", "width", "group", "both", "exit_turn", "lean")
    seats = []
    for o in sorted((o for o in bpy.data.objects if o.get("cat") == "seat"), key=lambda o: o.name):
        seats.append({k: (o[k] if not hasattr(o[k], "to_dict") else o[k].to_dict()) for k in keys})
    json.dump({"hall": "M1", "seats": seats}, open(path, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    BV.log("seats", len(seats), "->", path)


def main():
    scene = bpy.context.scene
    BV.gpu(scene)
    size = arg("--size", 2048, int)
    samples = arg("--samples", 1024, int)
    night = BV.flag("--night")
    lms = [o for o in bpy.data.objects if o.type == "MESH" and o.get("cat") == "lm" and len(o.data.polygons)]
    BV.log("light-mapped objects", len(lms), [o.name for o in lms][:12], "...")
    hidden = [o for o in bpy.data.objects if o.get("garden") or o.get("glass") or o.get("cat") in ("door", "probe")]
    if not night:
        BV.DENSITY.clear()
        for o in lms:
            BV.DENSITY[o.name] = float(o.get("lmw", 0.7))
        # round 6: a wider margin (the cubby interiors no longer share the map, so there is room): no bleeding at island edges
        BV.lightmap_uv(lms, margin=0.003)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, "memorial_lmprep.blend"), copy=True)
    else:
        setup_night(scene)
    for o in hidden:
        o.hide_render = True
    for o in bpy.data.objects:
        if o.get("cat") == "collider":
            o.hide_render = True
    lm_png = os.path.join(WORK, "memorial_lm_night.png" if night else "memorial_lm.png")
    stats = {}
    if not BV.flag("--nobake"):
        scene.cycles.max_bounces = 8
        scene.cycles.diffuse_bounces = 5
        lift = NIGHT["lift"] if night else LM_LIFT
        passes = arg("--passes", 1, int)
        if passes <= 1:
            stats = BV.bake_lightmap(scene, lms, size, samples, lm_png, emit_on=False, lift=lift)
        else:
            stats = bake_passes(scene, lms, size, samples, passes, lm_png, lift)
        BV.log("light map", "night" if night else "day", stats)
    if night:
        return
    for o in hidden:
        o.hide_render = False
    EM = export_materials()
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.get("cat") in ("lm", "nonlm")]
    doors = [o for o in bpy.data.objects if o.type == "MESH" and o.get("cat") == "door"]
    inst = [o for o in bpy.data.objects if o.get("cat") in ("inst", "inst_root")]
    inst_meshes = {o.data.name: o for o in inst if o.type == "MESH"}
    seen = set()
    for o in meshes + doors + list(inst_meshes.values()):
        if o.data.name in seen:
            continue
        seen.add(o.data.name)
        BV.convert(o, EM)
    lm_list = [o for o in meshes if o.get("cat") == "lm"]
    fx_list = [o for o in meshes if o.get("cat") == "nonlm"]
    lm_obj = BV.join(lm_list, "hall_lm")
    fx_obj = BV.join(fx_list, "hall_fx")
    exported = [o for o in (lm_obj, fx_obj) if o is not None]
    for o in exported + doors:
        BV.drop_unused_slots(o)
        if not any(m.name.startswith("LM_") for m in o.data.materials) and "UV_LM" in o.data.uv_layers:
            o.data.uv_layers.remove(o.data.uv_layers["UV_LM"])
        o.data.uv_layers.active = o.data.uv_layers["UVMap"]
        if "Col" in o.data.color_attributes:
            o.data.color_attributes.active_color = o.data.color_attributes["Col"]
    for o in inst_meshes.values():
        o.data.uv_layers.active = o.data.uv_layers["UVMap"]
    cols = [o for o in bpy.data.objects if o.get("cat") == "collider"]
    for o in cols:
        o.hide_render = False
    nodes = [o for o in bpy.data.objects if o.get("cat") in ("anchor", "helper")]
    dump_seats(os.path.join(EXPORT, "memorial_seats.json"))
    try:
        bpy.data.orphans_purge(do_recursive=True)
    except Exception:
        pass
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, "memorial_export.blend"), copy=True)
    glb = os.path.join(EXPORT, "memorial.glb")
    BV.select(exported + doors + inst + cols + nodes, exported[0])
    kw = dict(filepath=glb, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
              export_texcoords=True, export_normals=False, export_materials="EXPORT", export_image_format="WEBP",
              export_image_quality=82, export_animations=False, export_cameras=False, export_lights=False,
              export_extras=False, export_skins=False, export_morph=False, export_vertex_color="MATERIAL",
              export_tangents=False, export_gpu_instances=True,
              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
              export_draco_position_quantization=16, export_draco_normal_quantization=10,
              export_draco_texcoord_quantization=14, export_draco_color_quantization=10,
              export_draco_generic_quantization=12)
    bpy.ops.export_scene.gltf(**kw)
    js = patch(glb)
    info = {"glb": glb, "bytes": os.path.getsize(glb), "lightmap_stats": stats,
            "materials": [m.get("name") for m in js.get("materials", [])], "nodes": len(js.get("nodes", [])),
            "meshes": len(js.get("meshes", [])), "extensionsUsed": js.get("extensionsUsed")}
    json.dump(info, open(os.path.join(EXPORT, "memorial.json"), "w"), indent=1)
    BV.log("EXPORTED", glb, info["bytes"], "bytes", info["materials"])


if __name__ == "__main__":
    main()
