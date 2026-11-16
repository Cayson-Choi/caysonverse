"""Bake and export the 케이슨 낚시터 (lake.glb), Blender 5.3 background. Reuses the village's own bake code (bake_village.py:
light-map UV packing, the Cycles diffuse bake, the night light setup, vertex lighting of foliage), so the lake is lit exactly
like the village: same sun / HDRI / sky (look.json), the same GAME_GAIN and ambient lift, the same moon and lamp lights.

  blender -b art/lake/work/lake_authoring.blend -P art/lake/tools/bake_lake.py -- [--size 2048] [--samples 256]
  blender -b art/lake/work/lake_lmprep.blend    -P art/lake/tools/bake_lake.py -- --night [--samples 384]
  python art/lake/tools/post_lake.py [--lm-quality 88]            (PNG -> WebP, patch the GLB, copy to client/public/models/lake)

Day run: split non-LM faces, light-map UV (UV_LM) over the ground + rocks + trail + the water, Cycles DIFFUSE bake of the sun
and sky with every plant, tree, hut, deck and the office casting shadows (shadow casters 'occluder' are never exported:
art/lake/work/structures.blend of chunk B replaces the greybox when it exists), vertex lighting of the instanced
vegetation (one representative per variant), export materials, merge, Draco GLB with GPU instancing.
What the GLB holds: `lake_ground` (LM_grass / LM_mud / LM_gravel / LM_dirt / LM_rock, UV0 texture, UV1 light map, COLOR_0 tint),
`lake_water` (M_lakewater: COLOR_0 = depth data, UV0 = world metres / 16, UV1 = the light map for the shadows on the water) and
the instances `inst__lake_*` (always) / `inst__lakehi_*` (PC tier only).
"""
import json
import math
import os
import struct
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
LAKE_ROOT = os.path.dirname(HERE)
REPO = os.path.dirname(os.path.dirname(LAKE_ROOT))
os.environ.setdefault("CV_LAYOUT", os.path.join(REPO, "art", "village", "layout.json"))
sys.path.insert(0, os.path.join(REPO, "art", "village", "tools"))
sys.path.insert(0, HERE)

import vlib as U  # noqa: E402
import bake_village as BK  # noqa: E402

WORK = os.path.join(LAKE_ROOT, "work")
EXPORT = os.path.join(LAKE_ROOT, "export")
os.makedirs(EXPORT, exist_ok=True)
GAME_GAIN = BK.GAME_GAIN
BK.DENSITY.update({"lake_ground_grass": 0.34, "lake_ground_mud": 0.6, "lake_ground_gravel": 0.5, "lake_ground_dirt": 0.7,
                   "lake_rocks": 1.2, "lake_trail": 0.9, "lake_water": 0.16})
log = BK.log
arg = BK.arg
flag = BK.flag


def setup_night(scene):
    BK.setup_night(scene)


# --------------------------------------------------------------------------------------------- plant light

def plant_light(reps):
    """Light of the instanced reeds, grass, cattails and daisies into 'Col' (the build wrote the albedo there): sun by
    |n . sun| (the blades are thin and translucent), the sky hemisphere, darker at the root (the clump's self-occlusion),
    scaled like the light map (GAME_GAIN). One representative per variant is enough: the instances share the mesh."""
    sun = BK.sun_vector()
    up = Vector((0, 0, 1))
    for o in reps:
        me = o.data
        col = me.color_attributes["Col"]
        sway = me.attributes["_sway"].data if "_sway" in me.attributes else None
        n = len(me.loops)
        alb = np.empty(n * 4, np.float32)
        col.data.foreach_get("color", alb)
        alb = alb.reshape(n, 4)
        sw = np.zeros(len(me.vertices), np.float32)
        if sway is not None:
            sway.foreach_get("value", sw)
        out = alb.copy()
        for p in me.polygons:
            nrm = Vector(p.normal)
            ndl = abs(nrm.dot(sun))
            for li in p.loop_indices:
                v = me.loops[li].vertex_index
                ao = 0.5 + 0.5 * min(1.0, max(0.0, sw[v] / 0.45)) ** 0.7
                L = 1.7 * (0.3 + 0.7 * ndl) * 0.85 + 0.55 + 0.3 * max(0.0, up.dot(sun))
                L *= ao
                out[li, :3] = np.clip(alb[li, :3] * L * GAME_GAIN * 0.62, 0.0, 1.0)
        col.data.foreach_set("color", out.ravel())
    log(f"plant light on {len(reps)} variant meshes")


# ------------------------------------------------------------------------------------------------ materials

TEXTURES = {
    "LM_grass": os.path.join(U.TEX, "T_grass.png"), "LM_rock": os.path.join(U.TEX, "T_rock.png"),
    "LM_mud": os.path.join(WORK, "tex", "T_mud.png"), "LM_gravel": os.path.join(WORK, "tex", "T_gravel.png"),
    "LM_dirt": os.path.join(WORK, "tex", "T_dirt.png"),
    "M_leaf_green": os.path.join(U.TEX, "T_leaf_green.png"), "M_bark": os.path.join(U.TEX, "T_bark.png"),
    "M_plant": None, "M_lakewater": None,
}
VERTEX_COLOUR = {"LM_rock", "LM_grass", "LM_mud", "LM_gravel", "LM_dirt", "M_leaf_green", "M_bark"}
TINT_ONLY = {"M_plant", "M_lakewater"}      # base colour is the vertex colour itself
ALPHA = {"M_leaf_green"}


def export_materials():
    out = {}
    for name, path in TEXTURES.items():
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
        if name in TINT_ONLY:
            ca = nt.nodes.new("ShaderNodeVertexColor")
            ca.layer_name = "Col"
            nt.links.new(ca.outputs["Color"], b.inputs["Base Color"])
        else:
            img = bpy.data.images.load(path, check_existing=True)
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
            if name in ALPHA:
                nt.links.new(t.outputs["Alpha"], b.inputs["Alpha"])
        out[name] = m
    return out


# ------------------------------------------------------------------------------------------------ GLB patch

def patch_glb(path, extras=None):
    data = open(path, "rb").read()
    magic, ver, length = struct.unpack_from("<III", data, 0)
    off = 12
    chunks = []
    while off < length:
        clen, ctype = struct.unpack_from("<II", data, off)
        chunks.append([ctype, data[off + 8: off + 8 + clen]])
        off += 8 + clen
    js = json.loads(chunks[0][1].decode("utf-8"))
    used = set(js.get("extensionsUsed", []))
    used.add("KHR_materials_unlit")
    for m in js.get("materials", []):
        name = m.get("name", "")
        m.setdefault("extensions", {})["KHR_materials_unlit"] = {}
        pbr = m.setdefault("pbrMetallicRoughness", {})
        pbr.pop("metallicRoughnessTexture", None)
        pbr["metallicFactor"] = 0.0
        pbr["roughnessFactor"] = 1.0
        m.pop("emissiveTexture", None)
        m.pop("emissiveFactor", None)
        m.pop("normalTexture", None)
        if name.startswith("M_leaf_"):
            m["alphaMode"] = "MASK"
            m["alphaCutoff"] = 0.5
            m["doubleSided"] = True
        elif name == "M_plant":
            m["doubleSided"] = True
            m.pop("alphaMode", None)
        elif name == "M_lakewater":
            m["alphaMode"] = "BLEND"
            m["doubleSided"] = False
        else:
            m.pop("alphaMode", None)
            m.pop("alphaCutoff", None)
    js["extensionsUsed"] = sorted(used)
    if extras:
        js.setdefault("scenes", [{}])[0]["extras"] = extras
    raw = json.dumps(js, separators=(",", ":")).encode("utf-8")
    raw += b" " * ((4 - len(raw) % 4) % 4)
    chunks[0][1] = raw
    out = bytearray(struct.pack("<III", magic, ver, 0))
    for ctype, body in chunks:
        out += struct.pack("<II", len(body), ctype) + body
    struct.pack_into("<I", out, 8, len(out))
    open(path, "wb").write(bytes(out))
    return js


# ------------------------------------------------------------------------------------------------- main

def tri_budget():
    """Triangles drawn when everything is visible (instances counted), the always-visible tier, and the mesh data."""
    tot = lo = data = 0
    for o in bpy.data.objects:
        if o.type != "MESH" or o.get("cat") in ("collider", "occluder", "moon"):
            continue
        n = sum(len(p.vertices) - 2 for p in o.data.polygons)
        if o.get("cat") == "inst":
            tot += n
            if "lakehi_" not in o.name:
                lo += n
        elif o.get("cat") not in ("inst_root",):
            tot += n
            lo += n
            data += n
    return {"drawn_tris_hi": tot, "drawn_tris_lo": lo, "unique_mesh_tris": data}


def main():
    scene = bpy.context.scene
    BK.gpu(scene)
    scene.cycles.transparent_max_bounces = 24
    size = arg("--size", 2048, int)
    samples = arg("--samples", 256, int)
    if flag("--night"):
        setup_night(scene)
        lms = [o for o in bpy.data.objects if o.get("cat") in ("lm", "lmwater")]
        # the night's shadow casters: the lamp posts must not shade their own light (BK.setup_night handles "lamps")
        stats = BK.bake_lightmap(scene, lms, size, samples, os.path.join(WORK, "lake_lm_night.png"), emit_on=True, lift=BK.NIGHT["lift"])
        log("night light map", stats)
        return
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o.get("cat") not in ("collider",) and len(o.data.polygons) == 0:
            bpy.data.objects.remove(o)
    water = bpy.data.objects["lake_water"]
    water["cat"] = "lmwater"
    # the tiny grass doesn't need to cast shadows (thousands of thin ribbons slow the bake and change nothing)
    for o in bpy.data.objects:
        if o.get("cat") == "inst" and any(k in o.name for k in ("grass", "daisy")):
            o.visible_shadow = False
    lms = [o for o in bpy.data.objects if o.type == "MESH" and o.get("cat") == "lm"]
    for o in list(lms):
        BK.split_nonlm(o)
    lms = [o for o in bpy.data.objects if o.type == "MESH" and o.get("cat") == "lm" and len(o.data.polygons)]
    log("light-mapped objects", len(lms), "+ water")
    BK.lightmap_uv(lms + [water])
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, "lake_lmprep.blend"), copy=True)
    lm_png = os.path.join(WORK, "lake_lm.png")
    stats = {}
    if not flag("--nobake"):
        # the bake's shadow casters: plants and trees are scene objects; water does not shade
        water.visible_shadow = False
        stats = BK.bake_lightmap(scene, lms + [water], size, samples, lm_png)
        water.visible_shadow = True
        log("light map", stats)
    # vertex lighting of the instanced vegetation: trees through the village's own function, the reed-like plants through ours
    reps = [o for o in bpy.data.objects if o.type == "MESH" and o.get("cat") == "inst" and o.get("rep")]
    plants = [o for o in reps if o.get("leafcat") == "plant"]
    trees = [o for o in reps if o.get("leafcat") != "plant"]
    solid = lms + [o for o in bpy.data.objects if o.get("cat") == "occluder"]
    BK.vertex_light(solid, [], trees)
    plant_light(plants)
    EM = export_materials()
    mesh_objs = [o for o in bpy.data.objects if o.type == "MESH" and o.get("cat") not in ("collider", "occluder", "moon")]
    seen = set()
    for o in mesh_objs:
        if o.data.name in seen:
            continue
        seen.add(o.data.name)
        BK.convert(o, EM)
    ground = BK.join([o for o in mesh_objs if o.get("cat") == "lm" and len(o.data.polygons)], "lake_ground")
    water = bpy.data.objects["lake_water"]
    water.data.name = "lake_water"
    exported = [ground, water]
    for o in exported:
        o.data.uv_layers.active = o.data.uv_layers["UVMap"]
        if "Col" in o.data.color_attributes:
            o.data.color_attributes.active_color = o.data.color_attributes["Col"]
    inst = [o for o in bpy.data.objects if o.get("cat") in ("inst", "inst_root")]
    try:
        bpy.data.orphans_purge(do_recursive=True)
    except Exception:
        pass
    budget = tri_budget()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, "lake_export.blend"), copy=True)
    glb = os.path.join(EXPORT, "lake.glb")
    BK.select(exported + inst, ground)
    kw = dict(filepath=glb, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
              export_texcoords=True, export_normals=False, export_materials="EXPORT", export_image_format="WEBP",
              export_image_quality=78, export_animations=False, export_cameras=False, export_lights=False,
              export_extras=False, export_skins=False, export_morph=False, export_vertex_color="MATERIAL",
              export_tangents=False, export_gpu_instances=True, export_attributes=True,
              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
              export_draco_position_quantization=16, export_draco_normal_quantization=10,
              export_draco_texcoord_quantization=14, export_draco_color_quantization=10,
              export_draco_generic_quantization=12)
    bpy.ops.export_scene.gltf(**kw)
    js = patch_glb(glb, extras=lake_extras())
    info = {"glb": glb, "bytes": os.path.getsize(glb), "lightmap_stats": stats, "lm_scale": BK.LM_SCALE, "budget": budget,
            "materials": [m.get("name") for m in js.get("materials", [])], "nodes": len(js.get("nodes", [])),
            "extensionsUsed": js.get("extensionsUsed")}
    json.dump(info, open(os.path.join(EXPORT, "lake.json"), "w"), indent=1)
    log("EXPORTED", glb, info["bytes"], "bytes", budget)


def lake_extras():
    """Numbers E needs, riding in the glTF scene's extras (the lake's constants stay in lakeLayout.ts; these are the art's)."""
    sys.path.insert(0, HERE)
    import lake_geo as G
    return {
        "lake": {
            "waterY": G.WATER_Y, "floorY": G.FLOOR_Y,
            "lightMap": {"scale": BK.LM_SCALE, "uv": "TEXCOORD_1", "gameGain": GAME_GAIN},
            "waterVertexColor": "COLOR_0: r = depth / 3.5 (m), g = 1 - min(1, depth / 1.2) (shallows), b = 0",
            "tiers": "nodes named inst__lakehi_* are PC tier only; inst__lake_* are always drawn",
            "sway": "attribute _sway (0 root .. 1 tip) on inst__lake*_reed/cattail/grass/daisy meshes",
            "seam": {"groundHole": {"minX": 95.5, "maxX": 112.0, "minZ": -69.5, "maxZ": 45.5},
                     "backdropHole": {"minX": 112.0, "maxX": 190.0, "minZ": -70.0, "maxZ": 49.0}},
        }
    }


if __name__ == "__main__":
    main()
