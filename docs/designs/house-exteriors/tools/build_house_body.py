"""A8 house body kit (X1) — build the ten houses' shells and body detail into village_houses.glb (Blender 5.3, background).

  blender -b --factory-startup -P docs/designs/house-exteriors/tools/build_house_body.py -- \
      --layout art/village/layout.json --tex client/public/models/village/houses \
      [--windows shared/src/village/generated/exterior_windows.json] [--out client/public/models/village/village_houses.glb] \
      [--table-out <exterior_windows.json>] [--report <json>] [--houses 1,4] [--renders <dir>] [--views street,front,wall,
      window,door,eave,gable] [--times day,night] [--res 1280x800] [--blend <file>]

Geometry: house_kit.py (shell + detail per house, contract 5). Nodes: `houseshell__house_N`, `housedetail__house_N`
(each placed at the footprint's centre, the mesh turned to the house's door side), `slot__house_N_{nameplate,mailbox,sign}`
(empties, world position and the door side's yaw, from layout.json houseExteriors). Materials (contract 5): LM_render,
LM_roof, LM_stone, LM_wood, LM_metal (PBR, the maps are NOT embedded: the game binds house_textures.json's WebP sets by
material name; COLOR_0 = tint x weathering), M_glass, M_window, M_lamp, M_screen. Draco.

The renders use the same maps in Blender (EEVEE), a sky HDRI and a sun (day) or a moonlit sky with the lit windows (night).
"""
import json
import math
import os
import struct
import sys
import time

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import house_kit as K  # noqa: E402
import porch_kit as PK  # noqa: E402  (X2: porches, steps, beds, LPG, gardens, flush decks, owner-slot fittings)

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
LAYOUT = arg("--layout", os.path.join(REPO, "art", "village", "layout.json"))
TEXDIR = arg("--tex", os.path.join(REPO, "client", "public", "models", "village", "houses"))
WINDOWS = arg("--windows", os.path.join(REPO, "shared", "src", "village", "generated", "exterior_windows.json"))
OUT = arg("--out", os.path.join(REPO, "client", "public", "models", "village", "village_houses.glb"))
TABLE_OUT = arg("--table-out")
BOXES_OUT = arg("--boxes-out")
REPORT = arg("--report")
ONLY = arg("--houses")
RENDERS = arg("--renders")
VIEWS = arg("--views", "street,front,wall,window,door,eave,gable").split(",")
TIMES = arg("--times", "day,night").split(",")
RES = tuple(int(v) for v in arg("--res", "1280x800").split("x"))
BLEND = arg("--blend")
ART = arg("--art", os.path.join("D:" + os.sep, "ClaudeCode", "caysonverse", "art", "village"))
NO_EXPORT = "--no-export" in argv
NO_PORCH = "--no-porch" in argv
# the village's flower atlas (village.glb's M_leaf_flora; the game binds that texture, the GLB carries none)
FLORA = arg("--flora", os.path.join(ART, "work", "tex", "T_flora.png"))
T0 = time.time()


def log(*a):
    print("[x1 %6.1fs]" % (time.time() - T0), *a, flush=True)


# ------------------------------------------------------------------------------------------- materials --

def tex_node(nt, path, non_color):
    img = bpy.data.images.load(path, check_existing=True)
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    n = nt.nodes.new("ShaderNodeTexImage")
    n.image = img
    n.interpolation = "Cubic" if False else "Linear"
    return n


def make_materials(texinfo):
    mats = {}
    for name, info in texinfo.items():
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        maps = info["maps"]
        a = tex_node(nt, os.path.join(TEXDIR, maps["albedo"]), False)
        nm = tex_node(nt, os.path.join(TEXDIR, maps["normal"]), True)
        r = tex_node(nt, os.path.join(TEXDIR, maps["rough"]), True)
        ca = nt.nodes.new("ShaderNodeVertexColor")
        ca.layer_name = "Col"
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs[0].default_value = 1.0
        nt.links.new(a.outputs["Color"], mix.inputs[6])
        nt.links.new(ca.outputs["Color"], mix.inputs[7])
        nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nmap.inputs["Strength"].default_value = 1.0
        nt.links.new(nm.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
        nt.links.new(r.outputs["Color"], bsdf.inputs["Roughness"])
        bsdf.inputs["Metallic"].default_value = 0.0
        mats[name] = m
    # glass: dark, glossy, partly see-through (curtains and rooms behind)
    g = bpy.data.materials.new("M_glass")
    g.use_nodes = True
    b = next(n for n in g.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (0.035, 0.042, 0.048, 1)
    b.inputs["Roughness"].default_value = 0.03
    b.inputs["Alpha"].default_value = 0.5
    b.inputs["IOR"].default_value = 1.52
    try:
        g.surface_render_method = "BLENDED"
    except Exception:
        pass
    mats["M_glass"] = g
    w = bpy.data.materials.new("M_window")
    w.use_nodes = True
    b = next(n for n in w.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (0.42, 0.36, 0.28, 1)
    b.inputs["Roughness"].default_value = 0.8
    b.inputs["Emission Color"].default_value = (1.0, 0.62, 0.30, 1)
    b.inputs["Emission Strength"].default_value = 0.0
    mats["M_window"] = w
    l = bpy.data.materials.new("M_lamp")
    l.use_nodes = True
    b = next(n for n in l.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (0.75, 0.85, 1.0, 1)
    b.inputs["Emission Color"].default_value = (0.55, 0.80, 1.0, 1)
    b.inputs["Emission Strength"].default_value = 2.0
    mats["M_lamp"] = l
    s = bpy.data.materials.new("M_screen")
    s.use_nodes = True
    b = next(n for n in s.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (0.05, 0.055, 0.06, 1)
    b.inputs["Roughness"].default_value = 0.7
    b.inputs["Alpha"].default_value = 0.55
    try:
        s.surface_render_method = "BLENDED"
    except Exception:
        pass
    mats["M_screen"] = s
    # X2: flower / vegetable cards (alpha-clipped, double sided, tinted by COLOR_0 like the village's flora)
    f = bpy.data.materials.new("M_leaf_flora")
    f.use_nodes = True
    nt = f.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    if os.path.exists(FLORA):
        t = tex_node(nt, FLORA, False)
        ca = nt.nodes.new("ShaderNodeVertexColor")
        ca.layer_name = "Col"
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs[0].default_value = 1.0
        nt.links.new(t.outputs["Color"], mix.inputs[6])
        nt.links.new(ca.outputs["Color"], mix.inputs[7])
        nt.links.new(mix.outputs[2], b.inputs["Base Color"])
        nt.links.new(t.outputs["Alpha"], b.inputs["Alpha"])
    b.inputs["Roughness"].default_value = 0.65
    try:
        f.surface_render_method = "DITHERED"
    except Exception:
        pass
    f.use_backface_culling = False
    mats["M_leaf_flora"] = f
    return mats


# ------------------------------------------------------------------------------------------------ meshes --

def part_object(part, house, mats):
    """One kit part as a Blender object at the footprint's centre; the mesh in game-local axes turned to the door side."""
    cx, cz = house["centre"]["x"], house["centre"]["z"]
    side = house["doorSide"]
    order = sorted({p.mat for p in part.polys})
    verts, faces, uvs, cols, mi = [], [], [], [], []
    for p in part.polys:
        base = len(verts)
        for (x, y, z) in p.pts:
            wx, wz = K.local_to_world((0.0, 0.0), side, x, z)
            verts.append((wx, -wz, y))
        faces.append(tuple(range(base, base + len(p.pts))))
        uvs.extend(p.uv)
        cols.extend(p.col)
        mi.append(order.index(p.mat))
    me = bpy.data.meshes.new(part.name)
    me.from_pydata(verts, [], faces)
    uvl = me.uv_layers.new(name="UVMap")
    uvl.data.foreach_set("uv", [c for uv in uvs for c in uv])
    ca = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    ca.data.foreach_set("color", [c for col in cols for c in col])
    me.color_attributes.active_color = ca
    for m in order:
        me.materials.append(mats[m])
    me.polygons.foreach_set("material_index", mi)
    me.polygons.foreach_set("use_smooth", [False] * len(faces))
    me.update()
    ob = bpy.data.objects.new(part.name, me)
    ob.location = (cx, -cz, 0.0)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def slot_empties(hx):
    obs = []
    for s in hx["slots"]:
        e = bpy.data.objects.new(s["node"], None)
        e.empty_display_type = "PLAIN_AXES"
        e.empty_display_size = 0.2
        e.location = (s["x"], -s["z"], s["y"])
        e.rotation_euler = (0.0, 0.0, s["yaw"])
        bpy.context.scene.collection.objects.link(e)
        obs.append(e)
    return obs


# ------------------------------------------------------------------------------------------------ export --

def export(path, objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=False, export_yup=True,
                              export_texcoords=True, export_normals=True, export_tangents=False,
                              export_materials="EXPORT", export_image_format="NONE",
                              export_vertex_color="ACTIVE", export_all_vertex_colors=False,
                              export_animations=False, export_cameras=False, export_lights=False, export_extras=False,
                              export_skins=False, export_morph=False,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=10,
                              export_draco_position_quantization=14, export_draco_normal_quantization=10,
                              export_draco_texcoord_quantization=14, export_draco_color_quantization=8,
                              export_draco_generic_quantization=12)
    patch_glb(path)


def patch_glb(path):
    """Glass and the fly screens blend; no textures in the file (the game binds the WebP sets by material name); every
    textured material's PBR factors at 1 (the maps carry the values)."""
    data = open(path, "rb").read()
    clen, _ = struct.unpack_from("<II", data, 12)
    js = json.loads(data[20:20 + clen].decode("utf-8"))
    rest = data[20 + clen:]
    for m in js.get("materials", []):
        pbr = m.setdefault("pbrMetallicRoughness", {})
        for k in ("baseColorTexture", "metallicRoughnessTexture"):
            pbr.pop(k, None)
        m.pop("normalTexture", None)
        m.pop("occlusionTexture", None)
        m.pop("emissiveTexture", None)
        if m["name"] in ("M_glass", "M_screen"):
            m["alphaMode"] = "BLEND"
        else:
            m.pop("alphaMode", None)
        if m["name"].startswith("LM_"):
            pbr["baseColorFactor"] = [1, 1, 1, 1]
            pbr["metallicFactor"] = 0.0
            pbr["roughnessFactor"] = 1.0
        m["doubleSided"] = m["name"] in ("M_screen", "M_leaf_flora")
        if m["name"] == "M_leaf_flora":
            m["alphaMode"] = "MASK"
            m["alphaCutoff"] = 0.5
            pbr["baseColorFactor"] = [1, 1, 1, 1]
            pbr["metallicFactor"] = 0.0
            pbr["roughnessFactor"] = 0.65
        if m["name"] == "M_window":
            m["emissiveFactor"] = [1.0, 0.62, 0.30]
            m.setdefault("extensions", {})["KHR_materials_emissive_strength"] = {"emissiveStrength": 0.0}
            js.setdefault("extensionsUsed", [])
            if "KHR_materials_emissive_strength" not in js["extensionsUsed"]:
                js["extensionsUsed"].append("KHR_materials_emissive_strength")
    for k in ("textures", "images", "samplers"):
        js.pop(k, None)
    js.setdefault("asset", {})["extras"] = {"caysonverse": "village_houses X1 body kit + X2 porch kit", "textures": "houses/house_textures.json",
                                           "flora": "village.glb M_leaf_flora (T_flora)"}
    blob = json.dumps(js, separators=(",", ":")).encode("utf-8")
    blob += b" " * ((4 - len(blob) % 4) % 4)
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(blob) + len(rest)) + struct.pack("<II", len(blob), 0x4E4F534A) + blob + rest
    open(path, "wb").write(out)


# ------------------------------------------------------------------------------------------------ renders --

def setup_world(day, house=None):
    sc = bpy.context.scene
    w = bpy.data.worlds.get("W") or bpy.data.worlds.new("W")
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(os.path.join(ART, "downloads", "hdri", "kloppenheim_06_puresky_2k.hdr"), check_existing=True)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    nt.links.new(tc.outputs["Generated"], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], env.inputs["Vector"])
    mp.inputs["Rotation"].default_value = (0, 0, math.radians(140))
    nt.links.new(env.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 1.0 if day else 0.018
    if not day:
        tint = nt.nodes.new("ShaderNodeMix")
        tint.data_type = "RGBA"
        tint.blend_type = "MULTIPLY"
        tint.inputs[0].default_value = 1.0
        nt.links.new(env.outputs["Color"], tint.inputs[6])
        tint.inputs[7].default_value = (0.35, 0.5, 1.0, 1)
        nt.links.new(tint.outputs[2], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    sun = bpy.data.objects.get("Sun")
    if sun is None:
        sd = bpy.data.lights.new("Sun", "SUN")
        sun = bpy.data.objects.new("Sun", sd)
        sc.collection.objects.link(sun)
    sun.data.energy = 3.6 if day else 0.06
    sun.data.color = (1.0, 0.95, 0.88) if day else (0.55, 0.65, 1.0)
    sun.data.angle = math.radians(0.6)
    # day: the sun from the front-left of the house, 40 degrees up (the front lit, its relief raking); night: the moon
    fx, fz = K.local_to_world((0.0, 0.0), house["doorSide"], -0.55, 1.0) if house else (0.0, 1.0)
    el = math.radians(40 if day else 42)
    d = Vector((fx, -fz, 0)).normalized() * math.cos(el) + Vector((0, 0, math.sin(el)))
    if not day:
        d = Vector((-d.x, -d.y, d.z))
    sun.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    mats = bpy.data.materials
    b = next(n for n in mats["M_window"].node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Emission Strength"].default_value = 0.0 if day else 5.0
    for lo in [o for o in bpy.data.objects if o.name.startswith("winlight")]:
        lo.hide_render = day


def ground(cx, cz):
    me = bpy.data.meshes.new("lawn")
    S = 40
    me.from_pydata([(cx - S, -cz - S, -0.001), (cx + S, -cz - S, -0.001), (cx + S, -cz + S, -0.001), (cx - S, -cz + S, -0.001)], [],
                   [(0, 1, 2, 3)])
    uv = me.uv_layers.new(name="UVMap")
    for i, (x, y) in enumerate([(0, 0), (1, 0), (1, 1), (0, 1)]):
        uv.data[i].uv = (x * S * 0.8, y * S * 0.8)
    m = bpy.data.materials.get("lawn") or bpy.data.materials.new("lawn")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    t = os.path.join(ART, "downloads", "tex", "leafy_grass_")
    a = tex_node(nt, t + "diff_1k.jpg", False)
    r = tex_node(nt, t + "rough_1k.jpg", True)
    nm = tex_node(nt, t + "nor_gl_1k.jpg", True)
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(a.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(r.outputs["Color"], bsdf.inputs["Roughness"])
    nt.links.new(nm.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    me.materials.append(m)
    ob = bpy.data.objects.new("lawn", me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def cam_world(house, p):
    x, z = K.local_to_world((house["centre"]["x"], house["centre"]["z"]), house["doorSide"], p[0], p[2])
    return Vector((x, -z, p[1]))


# mirrored views (house 10's LPG sits on the other corner)
MIRROR_VIEWS = {"lpg"}


VIEWDEF = {
    # name: (camera local (x, y, z), target local, lens mm)
    "street": ((-7.5, 1.6, K.ZF + 13.5), (0.3, 4.9, K.ZC + 1.0), 24),
    "front": ((0.0, 1.6, K.ZF + 15.0), (0.0, 5.2, K.ZF), 26),
    "gable": ((K.HB + 12.0, 1.6, K.ZC + 3.0), (0.0, 5.0, K.ZC), 24),
    "wall": ((-1.75, 1.9, K.ZF + 1.0), (-1.75, 1.0, K.ZF), 30),
    "window": ((-2.75, 1.9, K.ZF + 1.05), (-3.3, 1.75, K.ZF), 26),
    "door": ((0.55, 1.9, K.ZF + 1.15), (0.25, 1.5, K.ZF), 24),
    "eave": ((K.HB + 0.9, 6.7, K.ZF + 1.6), (K.HB + 0.15, 7.9, K.ZF + 0.55), 22),
    "roof": ((-K.HB - 1.5, 9.6, K.ZF + 2.2), (-1.5, 9.4, K.ZC + 1.2), 30),
    # X2 porch views: the porch 3/4 at 6 m, and 1 m close-ups (eye 1.6 m over the lawn or the porch)
    "porch": ((-4.6, 1.75, PK.HZ + 4.2), (0.2, 1.3, K.ZF + 0.6), 26),
    "steps": ((1.15, 1.25, PK.HZ + 1.55), (0.55, 0.08, PK.HZ + 0.25), 26),
    "deck": ((2.6, 1.9, PK.HZ + 0.7), (1.5, 0.28, K.ZF + 0.9), 24),
    "post": ((1.25, 1.9, PK.HZ - 0.55), (2.3, 0.75, 5.155), 24),
    "mailbox": ((-0.95, 1.9, K.ZF + 1.0), (-1.55, 1.42, K.ZF + 0.1), 26),
    "lpg": ((2.6, 1.6, K.ZB - 1.9), (4.2, 0.95, K.ZB - 0.3), 22),
    "garden": ((-4.6, 1.7, K.ZB - 5.4), (-0.4, 0.2, K.ZB - 1.8), 24),
    "bed": ((3.0, 1.85, PK.HZ + 1.1), (4.2, 0.35, K.ZF + 0.9), 24),
    "flush": ((9.6, 1.6, 5.5), (6.6, 0.2, 0.0), 24),
    "back": ((-3.5, 1.7, K.ZB - 5.5), (0.0, 0.6, K.ZB - 0.5), 24),
}


def render_house(house, H, outdir):
    sc = bpy.context.scene
    try:
        sc.render.engine = "BLENDER_EEVEE"
    except TypeError:
        pass
    sc.render.resolution_x, sc.render.resolution_y = RES
    sc.render.image_settings.file_format = "JPEG"
    sc.render.image_settings.quality = 90
    try:
        sc.view_settings.view_transform = "AgX"
        sc.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass
    try:
        ee = sc.eevee
        ee.taa_render_samples = 48
        ee.use_raytracing = True
        ee.use_shadows = True
    except Exception:
        pass
    cam = bpy.data.objects.get("Cam")
    if cam is None:
        cd = bpy.data.cameras.new("Cam")
        cam = bpy.data.objects.new("Cam", cd)
        sc.collection.objects.link(cam)
    sc.camera = cam
    # warm point lights in the lit rooms (night)
    for i, (x, y, z, _) in enumerate(H.lights):
        ld = bpy.data.lights.new("winlight_%s_%d" % (H.id, i), "POINT")
        ld.energy = 90
        ld.color = (1.0, 0.72, 0.45)
        ld.shadow_soft_size = 0.4
        lo = bpy.data.objects.new(ld.name, ld)
        lo.location = cam_world(house, (x, y, z))
        sc.collection.objects.link(lo)
    # X2: the porch lamps' warm pools at night (the game's night light map, X4, bakes them)
    kind = PK.KIND.get(H.id)
    lamps = ([(0.0, 3.35, 4.19)] if kind == "gable" else
             [(-0.65, 3.4, K.ZF + 0.85), (0.65, 3.4, K.ZF + 0.85)] if kind == "canopy" and H.id not in PK.GLASS_CANOPY else
             [(-1.3, 2.3, K.ZF + 0.2), (1.3, 2.3, K.ZF + 0.2)])
    for i, (x, y, z) in enumerate(lamps if not NO_PORCH else []):
        ld = bpy.data.lights.new("winlight_porch_%s_%d" % (H.id, i), "POINT")
        ld.energy = 60
        ld.color = (1.0, 0.75, 0.5)
        ld.shadow_soft_size = 0.06
        lo = bpy.data.objects.new(ld.name, ld)
        lo.location = cam_world(house, (x, y, z))
        sc.collection.objects.link(lo)
    for t in TIMES:
        setup_world(t == "day", house)
        for v in VIEWS:
            p, q, lens = VIEWDEF[v]
            if v in MIRROR_VIEWS and H.id in PK.LPG_MIRROR:
                p, q = (-p[0], p[1], p[2]), (-q[0], q[1], q[2])
            cam.location = cam_world(house, p)
            d = cam_world(house, q) - cam.location
            cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
            cam.data.lens = lens
            cam.data.clip_start = 0.05
            sc.render.filepath = os.path.join(outdir, "%s_%s_%s.jpg" % (H.id, v, t))
            bpy.ops.render.render(write_still=True)
            log("render", sc.render.filepath)


# ------------------------------------------------------------------------------------------------ main --

def main():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    K.load_tex(os.path.join(TEXDIR, "house_textures.json"))
    with open(os.path.join(TEXDIR, "house_textures.json"), encoding="utf-8") as f:
        texinfo = json.load(f)["materials"]
    with open(LAYOUT, encoding="utf-8") as f:
        L = json.load(f)
    with open(WINDOWS, encoding="utf-8") as f:
        table = json.load(f)
    colours = {h["id"]: h["colour"] for h in L["sceneryHouses"]}
    hxs = {h["id"]: h for h in L["houseExteriors"]["houses"]}
    ids = ["house_%d" % n for n in range(1, 11)]
    if ONLY:
        ids = ["house_%s" % n for n in ONLY.split(",")]
    mats = make_materials(texinfo)
    built, objs, report = {}, [], {"houses": {}}
    for i, hid in enumerate(ids):
        H = K.build_house(hid, colours[hid], table["houses"][hid], 1000 + int(hid.split("_")[1]))
        if not NO_PORCH:
            PK.build_porch(H)
        hx = hxs[hid]
        so = part_object(H.shell, hx, mats)
        do = part_object(H.detail, hx, mats)
        objs += [so, do] + slot_empties(hx)
        built[hid] = H
        report["houses"][hid] = {"shell": H.shell.tris(), "detail": H.detail.tris(), "shellMaterials": H.shell.mats(),
                                 "detailMaterials": H.detail.mats()}
        log(hid, "shell", H.shell.tris(), "detail", H.detail.tris())
    report["totalTriangles"] = sum(v["shell"] + v["detail"] for v in report["houses"].values())
    if not NO_EXPORT:
        export(OUT, objs)
        report["glbBytes"] = os.path.getsize(OUT)
        log("wrote", OUT, report["glbBytes"], "bytes")
    if TABLE_OUT:
        houses = {}
        for hid in ["house_%d" % n for n in range(1, 11)]:
            H = built.get(hid)
            if H is None:
                houses[hid] = table["houses"][hid]
                continue
            rows = [K.rect_to_opening(o, r) for (w, r, o) in H.cut]
            # keep the design table's order
            key = lambda d: (d["wall"], d["floor"], round(d["at"], 1))
            want = [key(o) for o in table["houses"][hid]]
            rows.sort(key=lambda d: want.index(key(d)))
            houses[hid] = rows
        with open(TABLE_OUT, "w", encoding="utf-8", newline="\n") as f:
            json.dump({"format": "caysonverse-exterior-windows", "version": 1, "source": "build", "houses": houses}, f, indent=2)
            f.write("\n")
        log("window table", TABLE_OUT)
    if BOXES_OUT:
        # the window boxes' and baskets' soil (world, game axes) for the village vegetation: the 3D geraniums grow there
        out = {}
        for hid in ids:
            H = built[hid]
            hx = hxs[hid]
            c = (hx["centre"]["x"], hx["centre"]["z"])
            rows = []
            for bx in getattr(H, "window_boxes", []):
                p0 = K.local_to_world(c, hx["doorSide"], bx["x0"], bx["z0"])
                p1 = K.local_to_world(c, hx["doorSide"], bx["x1"], bx["z1"])
                rows.append({"x0": round(min(p0[0], p1[0]), 3), "x1": round(max(p0[0], p1[0]), 3), "z0": round(min(p0[1], p1[1]), 3),
                             "z1": round(max(p0[1], p1[1]), 3), "y": round(bx["y"], 3)})
            out[hid] = rows
        with open(BOXES_OUT, "w", encoding="utf-8", newline="\n") as f:
            json.dump({"format": "caysonverse-house-flower-boxes", "version": 1, "houses": out}, f, indent=1)
            f.write("\n")
        log("flower boxes", BOXES_OUT, sum(len(v) for v in out.values()))
    if REPORT:
        with open(REPORT, "w", encoding="utf-8", newline="\n") as f:
            json.dump(report, f, indent=2)
            f.write("\n")
    if BLEND:
        bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    if RENDERS:
        os.makedirs(RENDERS, exist_ok=True)
        hidden = []
        for hid in ids:
            hx, H = hxs[hid], built[hid]
            # one house at a time on its own lawn (the others hidden)
            for o in bpy.data.objects:
                if o.name.startswith(("houseshell__", "housedetail__")):
                    o.hide_render = not o.name.endswith("__" + hid)
            lawn = ground(hx["centre"]["x"], hx["centre"]["z"])
            render_house(hx, H, RENDERS)
            bpy.data.objects.remove(lawn)
            for o in [o for o in bpy.data.objects if o.name.startswith("winlight_")]:
                bpy.data.objects.remove(o)
    log("done")


main()
