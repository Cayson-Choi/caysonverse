"""Bake and export the 케이슨 마을 model (Blender 5.2, background).

  blender -b art/village/work/village_authoring.blend -P art/village/tools/bake_village.py -- \
        [--samples 384] [--size 2048] [--leafsamples 64] [--bdsamples 128] [--nobake]
  blender -b art/village/work/village_lmprep.blend -P art/village/tools/bake_village.py -- --night [--samples 512]
  python art/village/tools/post_village.py --night        (night PNG -> client/public/models/village/village_lm_night.webp)

Day run (default):
  1. split every light-mapped mesh: faces whose export material is not LM_* move to a non-LM mesh
  2. light-map UV ("UV_LM", 2nd set) packed over all LM meshes, with a texel-density weight per object
     -> saves work/village_lmprep.blend (a later night bake reuses exactly these UVs)
  3. Cycles DIFFUSE bake (direct + indirect, no colour) -> L / LM_SCALE as sRGB 8-bit -> export/village_lm.webp
  4. vertex-colour lighting for alpha-card foliage and instanced vegetation (one representative per variant)
  5. the backdrop (hills, ranges, waterfall cliff) baked COMBINED (with haze) into its own texture (M_backdrop)
  6. authoring materials -> export materials (LM_* textured + light map; M_* never light-mapped)
  7. merge by category and 80 m cell, export a Draco GLB with GPU instancing, patch it (KHR_materials_unlit,
     alpha modes), copy village.glb + village_lm.webp to client/public/models/village/
  The village bus (cat "occluder", parts_props.bus_occluder: export/village_bus.glb from build_bus.py) is in the scene
  for every bake (its shadow on the road and the shelter) but neither light-mapped nor exported: the game loads
  village_bus.glb on its own and lights it live.
  The fountain's crescent (cat "moon") is in the scene for every bake (its shadow) but neither light-mapped nor exported:
  post_village.py adds it to the GLB with scripts/patch-village-moon.mjs (material M_moon, unlit: the game lights it with
  a probe fitted to this bake's light on it, villageModelPrep.ts MOON_PROBE; re-fit it with fit_moon_probe.py when the
  sun, the sky or NIGHT change).
Night run (--night, Task 7A): loads village_lmprep.blend, turns the sun into a cool moon (SSE, 42 deg), sets a flat
dark-blue night world, leaves only the lamp/window/plot-outline emitters on and puts point lights at the light__* empties
(setup_night), bakes work/village_lm_night.png on the same UV_LM (no baked ambient lift); post_village.py --night makes
the WebP the game loads beside the day map.
Later changes made without a full re-bake (the plaza carts taken out, the box bus replaced by the 9 m bus, col__bus
moved, T_plaza redrawn) are carried into the saved work/village_lmprep.blend and work/village_export.blend by
sync_village_work.py, so a night re-bake or a re-export starts from what the game ships (bus review r3, 2026-11-11).
"""
import json
import math
import os
import shutil
import struct
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vlib as U  # noqa: E402

ROOT = U.ROOT
WORK = os.path.join(ROOT, "work")
EXPORT = os.path.join(ROOT, "export")
REPO = os.path.dirname(os.path.dirname(ROOT))
CLIENT = os.path.join(REPO, "client", "public", "models", "village")
os.makedirs(EXPORT, exist_ok=True)
LM_SCALE = 2.0            # the light map stores L / LM_SCALE; the game uses lightMapIntensity = 1.6 * PI (0.8 L)
LM_LIFT = 0.10            # ambient lift added to every light-map texel (see bake_lightmap)
GAME_GAIN = 0.8           # what the game shows of a baked light value (albedo * L * 0.8): backdrop and foliage match it
CELL = 80.0

DENSITY = {  # light-map texel density weight per object (name prefix); default 0.7. Thin parts (bench slats, rails,
             # posts) need >= 3 texels across or they read black, so small props get high weights.
    "plaza_disc": 1.0, "kerbs": 0.8, "fountain": 1.25, "benches": 3.0, "planters": 1.4, "lamps": 1.4,
    "banners": 1.2, "ground_outer": 0.3, "lanes": 0.42, "plot_lawns": 0.42, "houses": 1.0, "fill_buildings": 1.0,
    "cafe": 1.1, "memorial": 1.1, "bus_shelter": 1.5, "trees_": 0.55, "creek_rocks": 0.55,
    "stone_walls": 0.8, "bridge": 2.2, "pavilion": 1.2, "lake_pavilion": 0.25, "lake_pier": 0.2, "plot_props": 1.6,
    "lane_lamps": 1.0, "house_shrubs": 0.5,
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


def export_name(m):
    return m.get("export", m.name.split("__src")[0]) if m else "LM_atlas"


def is_lm(m):
    return export_name(m).startswith("LM_")


def log(*a):
    print("[bake]", *a, flush=True)


def gpu(scene):
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    try:
        prefs.compute_device_type = "OPTIX"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == "OPTIX"
        scene.cycles.device = "GPU"
    except Exception as e:
        log("GPU setup failed", e)


def select(objs, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or (objs[0] if objs else None)


# ---------------------------------------------------------------------------------------------- split --

def split_nonlm(ob):
    """Faces whose export material is not LM_* move into a new object (cat 'nonlm'); unused slots are dropped."""
    me = ob.data
    idx = {i for i, m in enumerate(me.materials) if not is_lm(m)}
    sel = [p.index for p in me.polygons if p.material_index in idx]
    new = None
    if sel:
        new = ob.copy()
        new.data = me.copy()
        for c in ob.users_collection:
            c.objects.link(new)
        for target, keep in ((new, True), (ob, False)):
            bm = bmesh.new()
            bm.from_mesh(target.data)
            s = set(sel)
            bmesh.ops.delete(bm, geom=[f for f in bm.faces if (f.index in s) != keep], context="FACES")
            bm.to_mesh(target.data)
            bm.free()
        new.name = ob.name + "_nonlm"
        new["cat"] = "nonlm"
        drop_unused_slots(new)
    drop_unused_slots(ob)
    return new


def drop_unused_slots(ob):
    me = ob.data
    used = sorted({p.material_index for p in me.polygons})
    if len(used) == len(me.materials):
        return
    mats = [me.materials[i] for i in used]
    remap = {old: new for new, old in enumerate(used)}
    idx = [remap[p.material_index] for p in me.polygons]
    me.materials.clear()
    for m in mats:
        me.materials.append(m)
    me.polygons.foreach_set("material_index", idx)


# ------------------------------------------------------------------------------------------ light map --

def density(ob):
    for k, v in DENSITY.items():
        if ob.name.startswith(k):
            return v
    return 0.7


def lightmap_uv(objs, margin=0.003):
    for o in objs:
        me = o.data
        if "UV_LM" not in me.uv_layers:
            me.uv_layers.new(name="UV_LM")
        me.uv_layers.active = me.uv_layers["UV_LM"]
    select(objs)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=margin, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    for o in objs:
        f = density(o)
        uv = o.data.uv_layers["UV_LM"].data
        co = np.empty(len(uv) * 2, np.float32)
        uv.foreach_get("uv", co)
        uv.foreach_set("uv", co * f)
    select(objs)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(rotate=True, margin_method="FRACTION", margin=margin, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")


class BakeMaterialState:
    """Temporarily make every material bake-friendly: no metal, no transmission, no coat; emitters off (day) or on
    (night). Restored afterwards."""

    def __init__(self, emit_on=False):
        self.saved = []
        for m in bpy.data.materials:
            if not m.node_tree:
                continue
            for n in m.node_tree.nodes:
                if n.type == "BSDF_PRINCIPLED":
                    for k, v in (("Metallic", 0.0), ("Transmission Weight", 0.0), ("Coat Weight", 0.0)):
                        if not n.inputs[k].is_linked:
                            self.saved.append((n.inputs[k], n.inputs[k].default_value))
                            n.inputs[k].default_value = v
                    if not emit_on and not n.inputs["Emission Strength"].is_linked:
                        self.saved.append((n.inputs["Emission Strength"], n.inputs["Emission Strength"].default_value))
                        n.inputs["Emission Strength"].default_value = 0.0
                elif n.type == "EMISSION" and not emit_on:
                    self.saved.append((n.inputs["Strength"], n.inputs["Strength"].default_value))
                    n.inputs["Strength"].default_value = 0.0

    def restore(self):
        for sock, v in self.saved:
            sock.default_value = v


def bake_lightmap(scene, objs, size, samples, out_png, emit_on=False, lift=LM_LIFT):
    img = bpy.data.images.new("LM_bake", size, size, alpha=False, float_buffer=True)
    added = []
    for m in {m for o in objs for m in o.data.materials if m}:
        nt = m.node_tree
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = img
        n.name = "__bake__"
        for x in nt.nodes:
            x.select = False
        n.select = True
        nt.nodes.active = n
        added.append((m, n))
    state = BakeMaterialState(emit_on)
    for o in objs:
        o.data.uv_layers.active = o.data.uv_layers["UV_LM"]
    select(objs)
    scene.cycles.samples = samples
    scene.render.bake.margin = 8
    scene.render.bake.margin_type = "EXTEND"
    log(f"baking light map {size}^2, {samples} samples, {len(objs)} objects")
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, margin=8, use_clear=True,
                        target="IMAGE_TEXTURES", use_selected_to_active=False)
    state.restore()
    for m, n in added:
        m.node_tree.nodes.remove(n)
    for o in objs:
        o.data.uv_layers.active = o.data.uv_layers["UVMap"]
    px = np.empty(size * size * 4, np.float32)
    img.pixels.foreach_get(px)
    a = px.reshape(size, size, 4)[..., :3].copy()
    # light denoise: 3x3 binomial on lit texels only
    k = np.array([0.25, 0.5, 0.25], np.float32)
    b = a.copy()
    for ax in (0, 1):
        b = sum(np.roll(b, s, axis=ax) * w for s, w in zip((-1, 0, 1), k))
    lum = b @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    nz = lum[lum > 1e-4]
    stats = {"p05": float(np.percentile(nz, 5)), "p50": float(np.percentile(nz, 50)),
             "p95": float(np.percentile(nz, 95)), "p99": float(np.percentile(nz, 99)),
             "clipped_pct": float((b.max(-1) > LM_SCALE).mean() * 100)}
    # ambient lift: a little sky bounce everywhere so shadowed and occluded texels never go black in the game
    # (the unlit game look has no ambient term of its own)
    b = b + lift * np.array([0.92, 0.96, 1.0], np.float32)
    enc = np.clip(b / LM_SCALE, 0, 1)
    enc = np.where(enc <= 0.0031308, enc * 12.92, 1.055 * np.power(enc, 1 / 2.4) - 0.055)
    save_png(enc, out_png)
    bpy.data.images.remove(img)
    return stats


def save_png(rgb, path):
    h, w, _ = rgb.shape
    out = bpy.data.images.new("tmp_out", w, h, alpha=False)
    out.colorspace_settings.name = "Non-Color"
    o4 = np.ones((h, w, 4), np.float32)
    o4[..., :3] = rgb
    out.pixels.foreach_set(o4.ravel())
    out.filepath_raw = path
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(out)


# ------------------------------------------------------------------------------- vertex colour lighting --

def sun_vector():
    sun = next((o for o in bpy.data.objects if o.type == "LIGHT" and o.data.type == "SUN"), None)
    return (sun.matrix_world.to_3x3() @ Vector((0, 0, 1))).normalized() if sun else Vector((0.5, 0.3, 0.4)).normalized()


def _bvh(objs):
    from mathutils.bvhtree import BVHTree
    verts, polys = [], []
    for o in objs:
        mw = o.matrix_world
        base = len(verts)
        verts += [mw @ v.co for v in o.data.vertices]
        polys += [[base + i for i in p.vertices] for p in o.data.polygons]
    return BVHTree.FromPolygons(verts, polys) if polys else None


def vertex_light(solid, foliage, reps, sun_lin=1.7, sky_up=0.85, sky_side=0.55):
    """Lighting of the alpha-card foliage into the 'Col' attribute (what the game multiplies the leaf texture by).

    A Cycles bake to vertex colours samples the card corners, which are transparent in the leaf texture, so it reads
    black. Instead: sun = max(0, n . sun) visibility-tested against the solid scene (buildings, ground, backdrop) and
    softened where other foliage stands between the card and the sun (canopy self-shadow); sky = hemisphere term by the
    shading normal (the crown-outward custom normals), dimmed under foliage. Scaled like the light map (x 0.8)."""
    sun = sun_vector()
    bs = _bvh(solid)
    bf = _bvh(foliage)
    up = Vector((0, 0, 1))
    for o in foliage + reps:
        me = o.data
        if "Col" not in me.color_attributes:
            me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
        col = me.color_attributes["Col"]
        me.color_attributes.active_color = col
        normals = [Vector(n.vector) for n in me.corner_normals]
        flora = any(m and export_name(m) == "M_leaf_flora" for m in me.materials)
        is_rep = o.get("cat") == "inst"
        mw = o.matrix_world if not is_rep else None
        out = np.ones((len(me.loops), 4), np.float32)
        # per-card colour variation on blossoms (subtle: brightness and a white-to-deep-pink shift)
        tint = np.ones((len(me.loops), 3), np.float32)
        cherry = [i for i, m in enumerate(me.materials) if m and export_name(m) == "M_leaf_cherry"]
        if cherry:
            for p in me.polygons:
                if p.material_index in cherry:
                    h1 = ((p.index * 2654435761) % 1000) / 1000.0
                    h2 = ((p.index * 40503 + 17) % 997) / 997.0
                    tint[list(p.loop_indices)] = (0.93 + 0.12 * h1, (0.93 + 0.12 * h1) * (0.95 + 0.09 * h2),
                                                  (0.93 + 0.12 * h1) * (0.97 + 0.06 * h2))
        for li, lp in enumerate(me.loops):
            co = me.vertices[lp.vertex_index].co
            p = (mw @ co) if mw is not None else co
            n = normals[li]
            if flora:
                n = (n * 0.3 + up).normalized()
            ndl = max(0.0, n.dot(sun))
            vis = 1.0
            if not is_rep:
                start = p + sun * 0.2 + n * 0.05
                if bs is not None and bs.ray_cast(start, sun, 400.0)[0] is not None:
                    vis = 0.0
                elif bf is not None:
                    hit = bf.ray_cast(start + sun * 0.15, sun, 9.0)
                    if hit[0] is not None:
                        vis = 0.5
            sky = sky_side + (sky_up - sky_side) * max(0.0, n.z)
            if not is_rep and bf is not None and bf.ray_cast(p + up * 0.35, up, 6.0)[0] is not None:
                sky *= 0.78
            L = sun_lin * (0.15 + 0.85 * ndl) * vis + sky
            out[li, :3] = (L * GAME_GAIN, L * GAME_GAIN * 0.99, L * GAME_GAIN * 0.97)
        out[:, :3] = np.clip(out[:, :3] * tint, 0.0, 1.0)
        col.data.foreach_set("color", out.ravel())
    log(f"vertex light on {len(foliage)} foliage meshes + {len(reps)} instanced variants")


# --------------------------------------------------------------------------------------------- backdrop --

BD_WEIGHT = {"backdrop_near": 1.0, "waterfall_cliff": 2.2, "backdrop_far": 0.32}


def bake_backdrop(scene, objs, size, samples, out_png):
    for o in objs:
        o.data.uv_layers.active = o.data.uv_layers["UVMap"]
    select(objs)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(70), island_margin=0.002, area_weight=0.0, correct_aspect=True,
                             scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    for o in objs:
        f = next((v for k, v in BD_WEIGHT.items() if o.name.startswith(k)), 0.5)
        uv = o.data.uv_layers["UVMap"].data
        co = np.empty(len(uv) * 2, np.float32)
        uv.foreach_get("uv", co)
        uv.foreach_set("uv", co * f)
    select(objs)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(rotate=True, margin_method="FRACTION", margin=0.002, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")
    img = bpy.data.images.new("BD_bake", size, size, alpha=False, float_buffer=True)
    added = []
    for m in {m for o in objs for m in o.data.materials if m}:
        n = m.node_tree.nodes.new("ShaderNodeTexImage")
        n.image = img
        for x in m.node_tree.nodes:
            x.select = False
        n.select = True
        m.node_tree.nodes.active = n
        added.append((m, n))
    scene.cycles.samples = samples
    scene.render.bake.margin = 6
    log(f"baking backdrop {size}^2, {samples} samples")
    bpy.ops.object.bake(type="COMBINED", pass_filter={"DIRECT", "INDIRECT", "DIFFUSE", "EMIT"}, margin=6,
                        use_clear=True, target="IMAGE_TEXTURES", use_selected_to_active=False)
    for m, n in added:
        m.node_tree.nodes.remove(n)
    px = np.empty(size * size * 4, np.float32)
    img.pixels.foreach_get(px)
    a = np.clip(px.reshape(size, size, 4)[..., :3] * GAME_GAIN, 0, 1)
    a = np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(a, 1 / 2.4) - 0.055)
    save_png(a, out_png)
    bpy.data.images.remove(img)


# ------------------------------------------------------------------------------------------- materials --

TEXTURES = {
    "LM_plaza": "T_plaza.png", "LM_grass": "T_grass.png", "LM_lawn": "T_lawn.png", "LM_stone": "T_stone.png",
    "LM_concrete": "T_concrete.png", "LM_render": "T_render.png", "LM_wood": "T_wood.png", "LM_roof": "T_roof.png",
    "LM_rock": "T_rock.png", "LM_wall": "T_wall.png", "LM_bark": "T_bark.png", "LM_atlas": "T_atlas.png",
    "M_water": "T_water.png", "M_waterfall": "T_falls.png", "M_lamp": "T_glow.png", "M_window": "T_glow.png",
    "M_sky": "T_sky.png", "M_backdrop": None, "M_leaf_green": "T_leaf_green.png", "M_leaf_cherry": "T_leaf_cherry.png",
    "M_leaf_flora": "T_flora.png", "M_bark": "T_bark.png", "M_glass": "T_glass.png",
}
VERTEX_COLOUR = {"LM_render", "LM_wood", "LM_roof", "LM_grass", "M_leaf_green", "M_leaf_cherry", "M_leaf_flora", "M_bark"}
ALPHA = {"M_leaf_green", "M_leaf_cherry", "M_leaf_flora", "M_water", "M_waterfall", "M_glass"}
FLAT = {"M_glow_plot": "#22D3FF"}


def export_materials(backdrop_png):
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
            b.inputs["Base Color"].default_value = U.rgba(FLAT[name])
        else:
            path = backdrop_png if name == "M_backdrop" else os.path.join(U.TEX, TEXTURES[name])
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


def convert(ob, EM):
    me = ob.data
    names = [export_name(m) for m in me.materials]
    uniq = []
    for n in names:
        if n not in uniq:
            uniq.append(n)
    idx = [uniq.index(names[p.material_index]) for p in me.polygons]
    me.materials.clear()
    for n in uniq:
        me.materials.append(EM[n])
    me.polygons.foreach_set("material_index", idx)


# --------------------------------------------------------------------------------------------- merging --

def join(objs, name):
    objs = [o for o in objs if o.type == "MESH" and len(o.data.polygons)]
    if not objs:
        return None
    select(objs)
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def cell_of(ob):
    mw = ob.matrix_world
    c = sum((mw @ Vector(b) for b in ob.bound_box), Vector()) / 8
    return int(math.floor((c.x + 120) / CELL)), int(math.floor((-c.y + 120) / CELL))


def split_by_cells(ob, base):
    """Split a merged mesh into 80 m cells by face centre (frustum culling in the game)."""
    me = ob.data
    keys = {}
    for p in me.polygons:
        c = p.center
        k = (int(math.floor((c.x + 120) / CELL)), int(math.floor((-c.y + 120) / CELL)))
        keys.setdefault(k, []).append(p.index)
    if len(keys) <= 1:
        return [ob]
    out = []
    for k, faces in sorted(keys.items()):
        new = ob.copy()
        new.data = me.copy()
        for c in ob.users_collection:
            c.objects.link(new)
        bm = bmesh.new()
        bm.from_mesh(new.data)
        s = set(faces)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in s], context="FACES")
        bm.to_mesh(new.data)
        bm.free()
        new.name = f"{base}_{k[0]}{k[1]}"
        new.data.name = new.name
        drop_unused_slots(new)
        out.append(new)
    bpy.data.objects.remove(ob)
    return out


# ------------------------------------------------------------------------------------------ GLB patching --

def patch_glb(path):
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
        elif name in ("M_water", "M_waterfall", "M_glass", "M_glass_e"):
            m["alphaMode"] = "BLEND"
            m["doubleSided"] = name == "M_waterfall"
        else:
            m.pop("alphaMode", None)
            m.pop("alphaCutoff", None)
            if name in ("M_bark",):
                m["doubleSided"] = False
    js["extensionsUsed"] = sorted(used)
    raw = json.dumps(js, separators=(",", ":")).encode("utf-8")
    raw += b" " * ((4 - len(raw) % 4) % 4)
    chunks[0][1] = raw
    out = bytearray(struct.pack("<III", magic, ver, 0))
    for ctype, body in chunks:
        out += struct.pack("<II", len(body), ctype) + body
    struct.pack_into("<I", out, 8, len(out))
    open(path, "wb").write(bytes(out))
    return js


# ------------------------------------------------------------------------------------------------ night --

# The night look (Task 7A). The game's night key light comes from the same moon (client/src/village/dayNightBlend.ts
# NIGHT_MOON), so the players' live shadows fall like the baked ones.
NIGHT = {
    "moon_azimuth_deg": 150.0,      # SSE: behind-right of the spawn camera (which looks north), the scene front-lit
    "moon_elevation_deg": 42.0,
    "moon_strength": 0.30,          # W/m^2 (the day sun is 4.8)
    "moon_colour": (0.62, 0.72, 1.0),
    "moon_angle_deg": 1.5,
    "sky": (0.028, 0.040, 0.085),   # the night sky's radiance (uniform world)
    "power": {"lamp": 300.0, "window": 80.0, "fountain": 50.0},
    "colour": {"lamp": (1.0, 0.74, 0.44), "window": (1.0, 0.78, 0.52), "fountain": (0.70, 0.86, 1.0)},
    "emitters": ("M_lamp", "M_window", "M_glow_plot"),   # the only emitters left on at night
    "lift": 0.0,                    # no baked ambient lift at night: the game adds its own moonlit ambient
}


def setup_night(scene):
    """Night variant of the bake light (Task 7A): the sun becomes a cool moon from the south-south-east, the world a
    flat dark-blue night sky, only the lamps, windows and plot outlines emit (the sky dome is invisible to the bake as
    in the day run; the backdrop's haze emission and the blossoms' and falls' glow go off), and a point light sits at
    every light__* empty (lamps warm, windows warm and softer, fountain cool). The lamp posts and their glass, and the
    water, cast no shadow for these lights: the lantern is closed below by its metal plate, which would leave a dark
    disc under every lamp, and the fountain's jets would cut its pool into wedges."""
    for o in bpy.data.objects:
        if o.type == "LIGHT" and o.data.type == "SUN":
            az = math.radians(NIGHT["moon_azimuth_deg"])
            el = math.radians(NIGHT["moon_elevation_deg"])
            d = Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el))).normalized()
            o.rotation_mode = "QUATERNION"
            o.rotation_quaternion = (-d).to_track_quat("-Z", "Y")
            o.data.energy = NIGHT["moon_strength"]
            o.data.color = NIGHT["moon_colour"]
            o.data.angle = math.radians(NIGHT["moon_angle_deg"])
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
    # emitters: only the night lights stay on (linked strengths too, e.g. the backdrop's haze)
    for m in bpy.data.materials:
        if not m.node_tree or m.name in NIGHT["emitters"]:
            continue
        for n in m.node_tree.nodes:
            sock = n.inputs["Emission Strength"] if n.type == "BSDF_PRINCIPLED" else (
                n.inputs["Strength"] if n.type == "EMISSION" else None)
            if sock is None:
                continue
            for link in list(sock.links):
                m.node_tree.links.remove(link)
            sock.default_value = 0.0
    for o in bpy.data.objects:
        if o.type == "MESH" and (o.name in ("lamps", "lane_lamps", "lamp_glass", "lane_lamp_glass") or o.get("cat") == "water"):
            o.visible_shadow = False
    n_lights = {}
    for e in [o for o in bpy.data.objects if o.name.startswith("light__")]:
        kind = e.name.split("__")[1].rsplit("_", 1)[0]
        ld = bpy.data.lights.new(e.name + "_L", "POINT")
        ld.energy = NIGHT["power"].get(kind, 50.0)
        ld.color = NIGHT["colour"].get(kind, (1, 1, 1))
        ld.shadow_soft_size = 0.15
        lo = bpy.data.objects.new(e.name + "_L", ld)
        lo.location = e.matrix_world.translation
        scene.collection.objects.link(lo)
        n_lights[kind] = n_lights.get(kind, 0) + 1
    log("night lights", n_lights)


# ------------------------------------------------------------------------------------------------- main --

def main():
    scene = bpy.context.scene
    gpu(scene)
    scene.cycles.transparent_max_bounces = 24
    size = arg("--size", 2048, int)
    samples = arg("--samples", 384, int)
    if flag("--night"):
        setup_night(scene)
        lms = [o for o in bpy.data.objects if o.get("cat") == "lm"]
        # the emitters were set in setup_night (BakeMaterialState must not zero them again)
        stats = bake_lightmap(scene, lms, size, samples, os.path.join(WORK, "village_lm_night.png"), emit_on=True,
                              lift=NIGHT["lift"])
        log("night light map", stats)
        return
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o.get("cat") not in ("collider",) and len(o.data.polygons) == 0:
            bpy.data.objects.remove(o)
    lms = [o for o in bpy.data.objects if o.type == "MESH" and o.get("cat") == "lm"]
    for o in list(lms):
        split_nonlm(o)
    lms = [o for o in bpy.data.objects if o.type == "MESH" and o.get("cat") == "lm" and len(o.data.polygons)]
    log("light-mapped objects", len(lms))
    lightmap_uv(lms)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, "village_lmprep.blend"), copy=True)
    lm_png = os.path.join(WORK, "village_lm.png")
    stats = {}
    if not flag("--nobake"):
        stats = bake_lightmap(scene, lms, size, samples, lm_png)
        log("light map", stats)
    # foliage vertex lighting: merged leaf meshes, non-LM bark of instanced trees, one representative per variant
    fol = [o for o in bpy.data.objects if o.type == "MESH" and o.get("cat") == "leaf" and len(o.data.polygons)]
    reps = [o for o in bpy.data.objects if o.type == "MESH" and o.get("cat") == "inst" and o.get("rep")]
    bd = [o for o in bpy.data.objects if o.type == "MESH" and o.get("cat") == "backdrop"]
    moon = [o for o in bpy.data.objects if o.type == "MESH" and o.get("cat") in ("moon", "occluder")]
    vertex_light(lms + bd + moon, fol, reps)
    bd_png = os.path.join(WORK, "T_backdrop.png")
    if not flag("--nobake") or not os.path.exists(bd_png):
        bake_backdrop(scene, bd, 2048, arg("--bdsamples", 128, int), bd_png)
    # materials
    EM = export_materials(bd_png)
    # the fountain's crescent (cat "moon") cast its shadow in the bakes and stays out of the export: the game lights it
    # with a probe of this bake's light (MOON_PROBE), and post_village.py puts it into the GLB with the repo's
    # scripts/patch-village-moon.mjs (fix/fix-moon-smooth)
    mesh_objs = [o for o in bpy.data.objects if o.type == "MESH" and o.get("cat") not in ("collider", "moon", "occluder")]
    seen = set()
    for o in mesh_objs:
        if o.data.name in seen:
            continue
        seen.add(o.data.name)
        convert(o, EM)
    # merge: LM by cell, non-LM categories together (leaves by cell)
    groups = {}
    for o in mesh_objs:
        cat = o.get("cat")
        if cat in ("inst", None):
            continue
        key = {"lm": "lm", "nonlm": "fx", "lamp": "fx", "glow": "fx", "water": "water", "leaf": "leaf",
               "sky": "sky", "backdrop": "backdrop"}.get(cat, "fx")
        if key in ("lm", "leaf"):
            cx, cz = cell_of(o)
            key = f"{key}_{cx}{cz}"
        groups.setdefault(key, []).append(o)
    exported = []
    for key, objs in sorted(groups.items()):
        ob = join(objs, "village_" + key)
        if ob is None:
            continue
        drop_unused_slots(ob)
        if key in ("fx", "water"):
            exported += split_by_cells(ob, "village_" + key)
        else:
            exported.append(ob)
    inst = [o for o in bpy.data.objects if o.get("cat") in ("inst", "inst_root")]
    cols = [o for o in bpy.data.objects if o.get("cat") == "collider"]
    lights = [o for o in bpy.data.objects if o.get("cat") == "light"]
    for o in exported:
        # non-LM meshes carry no light-map UV
        if not any(m.name.startswith("LM_") for m in o.data.materials) and "UV_LM" in o.data.uv_layers:
            o.data.uv_layers.remove(o.data.uv_layers["UV_LM"])
        o.data.uv_layers.active = o.data.uv_layers["UVMap"]
        if "Col" in o.data.color_attributes:
            o.data.color_attributes.active_color = o.data.color_attributes["Col"]
    try:
        bpy.data.orphans_purge(do_recursive=True)
    except Exception:
        pass
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, "village_export.blend"), copy=True)
    glb = os.path.join(EXPORT, "village.glb")
    select(exported + inst + cols + lights, exported[0])
    kw = dict(filepath=glb, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
              export_texcoords=True, export_normals=False, export_materials="EXPORT", export_image_format="WEBP",
              export_image_quality=80, export_animations=False, export_cameras=False, export_lights=False,
              export_extras=False, export_skins=False, export_morph=False, export_vertex_color="MATERIAL",
              export_tangents=False, export_gpu_instances=True,
              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
              export_draco_position_quantization=16, export_draco_normal_quantization=10,
              export_draco_texcoord_quantization=14, export_draco_color_quantization=10,
              export_draco_generic_quantization=12)
    bpy.ops.export_scene.gltf(**kw)
    js = patch_glb(glb)
    # light map webp (system PIL is not in Blender: write PNG here, post_village.py converts) -> fallback copy
    info = {
        "glb": glb, "bytes": os.path.getsize(glb), "lightmap_stats": stats, "lm_scale": LM_SCALE,
        "materials": [m.get("name") for m in js.get("materials", [])],
        "nodes": len(js.get("nodes", [])), "meshes": len(js.get("meshes", [])),
        "colliders": [[o.name] + [round(v, 2) for v in (o.location.x - o.scale.x / 2, o.location.x + o.scale.x / 2,
                                                         -o.location.y - o.scale.y / 2, -o.location.y + o.scale.y / 2)]
                      for o in cols],
        "lights": len(lights), "extensionsUsed": js.get("extensionsUsed"),
    }
    json.dump(info, open(os.path.join(EXPORT, "village.json"), "w"), indent=1)
    log("EXPORTED", glb, info["bytes"], "bytes", len(info["materials"]), "materials")


if __name__ == "__main__":
    main()
