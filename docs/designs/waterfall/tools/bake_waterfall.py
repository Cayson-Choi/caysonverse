"""B1 waterfall, W3: assemble, light-map and export the falls (Blender 5.3, background, Cycles GPU).

  blender -b art/village/work/falls_w1.blend -P art/village/tools/bake_waterfall.py -- \
        [--samples 256] [--size 2048] [--out 1024] [--nobake] [--noexport]
  python art/village/tools/post_waterfall.py            (PNG -> WebP, GLB checks, copy to client/public/models/village)

Reads W1's authoring scene (falls_w1.blend: rock / ground / plants / trees / slabs / seats / lamps, the scan materials)
and W2's water (work/falls_w2/falls_water_high.blend + falls_water_low.blend) and builds the game file
`waterfall.glb` with its day + night light maps:

  1. water: W2's meshes are appended (high tier as is, the low tier's copies get the suffix `_low`, extras tier high /
     low); their authoring materials are replaced by bare ones of the same name (the game draws water with its own
     shaders and textures: nothing of W2's lookdev is shipped). The markers come from the high file.
  2. the scan boulders and the beach cobbles (W1's GPU instances, `inst__falls_rock_k` / `inst__falls_pebble`) are
     realised into two meshes (`falls_boulders`, both tiers; `falls_boulders_hi`, high only) so they are light-mapped
     (contact shadows on the beach). The trees stay GPU instances.
  3. light-map UV: a new, non-overlapping set `UV_LM` (smart project + one pack over every light-mapped mesh, a texel
     weight per part) on falls_rock_lod0/1, falls_flank_lod0/1, falls_ground, slabs, seats, lamp posts, boulders. W1's
     `UV2` (the face's (z, y) projection: overlapping for the stacked scans) stays for the macro colour map only.
     UV order after this: UVMap (TEXCOORD_0 albedo), UV_LM (TEXCOORD_1 -> three `uv1`, the light map's channel, as the
     village), UV2 (TEXCOORD_2 -> three `uv2`, the macro map).
  4. vertex light (COLOR_0) for the alpha-card plants and the tree templates (a Cycles vertex bake reads the cards'
     transparent corners as black: sun visibility by ray cast + a sky term, x 0.8 as the light map; times W1's tint).
  5. day bake: the village bake's own sun and sky (village_lmprep.blend: Sun + World.001), the village's near backdrop
     as a shadow / bounce caster with the site box cut out; Cycles DIFFUSE (direct + indirect) at --size, box-filtered
     to --out, L / 2 + lift 0.10, sRGB -> work/waterfall_lm.png. Night: the village's moon and night sky, two warm
     point lights at light__falls_lamp_1/2 (the lamp glass glows), no lift -> work/waterfall_lm_night.png.
  6. export materials: every material becomes a plain one the glTF exporter writes exactly: base colour = its albedo
     image (UVMap), alpha clip for the cards, emissive texture = the macro map (UV2) on the rock materials (the game
     reads it as the macro, never as light: emissive factor 0 is not written by the exporter, so the strength is 1 and
     the game ignores emissive). Normal maps are dropped (the game's falls are unlit + light-mapped). Images are cut
     to 512 px. Material extras `falls` = stone (vertex masks R moss, G wet) | tint (COLOR_0 multiplies) | card
     (vertex-lit, alpha clip) | bark (vertex-lit) | lamp | water.
  7. Draco GLB with GPU instancing -> work/waterfall.glb + work/falls_w3_report.json. Saves work/falls_w3_lmprep.blend.
"""
import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import falls_shape as F  # noqa: E402

ROOT = os.path.dirname(HERE)
WORK = os.path.join(ROOT, "work")
W2 = os.path.join(WORK, "falls_w2")
LMPREP = os.path.join(WORK, "village_lmprep.blend")
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default, cast=str):
    return cast(argv[argv.index(name) + 1]) if name in argv else default


SAMPLES = arg("--samples", 256, int)
SIZE = arg("--size", 2048, int)
OUT = arg("--out", 1024, int)
NOBAKE = "--nobake" in argv
NOEXPORT = "--noexport" in argv
LM_SCALE = 2.0
LM_LIFT = 0.10
GAME_GAIN = 0.8
TEX_MAX = 512
S = F.SITE
REPORT = {}


def log(*a):
    print("[falls-w3]", *a, flush=True)


sc = bpy.context.scene
COLL = bpy.data.collections["waterfall_w1"]
SRC = bpy.data.collections["falls_kit_src"]


def select(objs, active=None):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or (objs[0] if objs else None)


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


# ============================================================================================ 1. water ==
WATER = bpy.data.collections.new("falls_water")
sc.collection.children.link(WATER)
water_mats = {}


def bare_material(name):
    if name in water_mats:
        return water_mats[name]
    m = bpy.data.materials.new(name + "__w3")
    m["export"] = name
    m["falls"] = "water"
    m.use_nodes = True
    water_mats[name] = m
    return m


for tier in ("high", "low"):
    path = os.path.join(W2, f"falls_water_{tier}.blend")
    with bpy.data.libraries.load(path) as (src, dst):
        dst.objects = list(src.objects)
    for o in dst.objects:
        if o is None:
            continue
        base = o.name.split(".")[0]
        if o.type == "EMPTY":
            if tier == "high":
                WATER.objects.link(o)
                o.name = base
            else:
                bpy.data.objects.remove(o)
            continue
        WATER.objects.link(o)
        o.name = base if tier == "high" else base + "_low"
        o.data.name = o.name
        o["tier"] = tier
        o["cat"] = "water"
        mats = [bare_material(m.name.split(".")[0]) if m else None for m in o.data.materials]
        o.data.materials.clear()
        for m in mats:
            o.data.materials.append(m)
        if o.data.color_attributes:
            o.data.color_attributes.active_color = o.data.color_attributes[0]
for m in list(bpy.data.materials):
    if m.users == 0:
        bpy.data.materials.remove(m)
WATER_OBJS = [o for o in WATER.objects if o.type == "MESH"]
log("water", [(o.name, tris(o)) for o in WATER_OBJS])

# ========================================================================= 2. realise boulders + cobbles ==
def realise(objs, name, tier):
    if not objs:
        return None
    made = []
    for o in objs:
        me = o.data.copy()
        me.transform(o.matrix_world)
        n = bpy.data.objects.new(o.name + "__r", me)
        COLL.objects.link(n)
        made.append(n)
    select(made)
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    ob["cat"] = "rock"
    ob.select_set(False)
    if tier:
        ob["tier"] = tier
    elif "tier" in ob:
        del ob["tier"]
    return ob


inst = [o for o in COLL.objects if o.get("cat") == "inst" and o.parent and o.parent.name.startswith(("inst__falls_rock", "inst__falls_pebble"))]
BOULDERS = realise([o for o in inst if o.get("tier") != "high"], "falls_boulders", None)
BOULDERS_HI = realise([o for o in inst if o.get("tier") == "high"], "falls_boulders_hi", "high")
# the trees too (draw calls: 6 templates x 2 materials as instances -> 2 meshes x 2 materials; and each tree gets its
# own vertex light, shadows included, instead of one per template)
tree_inst = [o for o in COLL.objects if o.type == "MESH" and o.parent and o.parent.name.startswith("inst__falls_tree")]
TREES = realise([o for o in tree_inst if o.get("tier") != "high"], "falls_trees", None)
TREES_HI = realise([o for o in tree_inst if o.get("tier") == "high"], "falls_trees_hi", "high")
for t in (TREES, TREES_HI):
    if t:
        t["cat"] = "tree"
for o in inst + tree_inst:
    bpy.data.objects.remove(o)
for r in [o for o in COLL.objects if o.name.startswith(("inst__falls_rock", "inst__falls_pebble", "inst__falls_tree")) and o.type == "EMPTY"]:
    bpy.data.objects.remove(r)
# the walkable slabs and the seats are one mesh (one draw), the lamp posts another, the lamp glass a third
STONES = realise([o for o in COLL.objects if o.type == "MESH" and o.name.startswith(("falls_slab_", "falls_seat_"))], "falls_stones", None)
STONES["cat"] = "slab"
LAMPS = realise([o for o in COLL.objects if o.type == "MESH" and o.name.startswith(("falls_lamp_0", "falls_lamp_1", "falls_lamp_cap_"))], "falls_lamps", None)
GLASS = realise([o for o in COLL.objects if o.type == "MESH" and o.name.startswith("falls_lamp_glass_")], "falls_lamp_glass", None)
for o in [o for o in COLL.objects if o.type == "MESH" and o.name.startswith(("falls_slab_", "falls_seat_", "falls_lamp_"))
          and o not in (STONES, LAMPS, GLASS)]:
    bpy.data.objects.remove(o)
log("realised: boulders", tris(BOULDERS), "hi", tris(BOULDERS_HI), "trees", tris(TREES), "hi", tris(TREES_HI) if TREES_HI else 0,
    "stones", tris(STONES), "lamps", tris(LAMPS))

# ================================================================================ 3. light-map UV set ==
LM_WEIGHT = {"falls_rock_lod0": 1.0, "falls_rock_lod1": 0.55, "falls_flank_lod0": 0.3, "falls_flank_lod1": 0.2,
             "falls_ground": 0.6, "falls_stones": 1.6, "falls_lamps": 1.0, "falls_boulders": 0.9}
LM_OBJS = [o for o in COLL.objects if o.type == "MESH" and any(o.name.startswith(k) for k in LM_WEIGHT)
           and not o.name.startswith("falls_lamp_glass")]
for o in LM_OBJS:
    o.hide_viewport = False
    o.hide_render = False


def weight(o):
    return max(v for k, v in LM_WEIGHT.items() if o.name.startswith(k))


def lightmap_uv(objs, margin=arg("--margin", 0.002, float)):
    """UV_LM: the scan pieces keep their own atlas islands (photoscan unwraps: few, large, non-overlapping inside a
    piece; the pack separates the pieces that share a scan), everything else (the cliff's backing face, ground, flank,
    slabs, seats, lamps, boulders + cobbles) is smart-projected. Islands are made proportional to their 3D area, then
    weighted per part, then packed together."""
    for o in objs:
        me = o.data
        if "UV_LM" not in me.uv_layers:
            me.uv_layers.new(name="UV_LM")
        co = np.empty(len(me.loops) * 2, np.float32)
        me.uv_layers["UVMap"].data.foreach_get("uv", co)
        me.uv_layers["UV_LM"].data.foreach_set("uv", co)
        me.uv_layers.active = me.uv_layers["UV_LM"]
        keep_scan = o.name.startswith("falls_rock_lod")
        sel = [not (keep_scan and p.material_index > 0) for p in me.polygons]
        me.polygons.foreach_set("select", sel)
    select(objs)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.context.tool_settings.mesh_select_mode = (False, False, True)
    bpy.ops.uv.smart_project(angle_limit=math.radians(arg("--angle", 66.0, float)), island_margin=margin, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode="OBJECT")
    for o in objs:
        uv = o.data.uv_layers["UV_LM"].data
        co = np.empty(len(uv) * 2, np.float32)
        uv.foreach_get("uv", co)
        uv.foreach_set("uv", co * weight(o))
    select(objs)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(rotate=True, scale=True, margin_method="FRACTION", margin=margin,
                            shape_method=arg("--shape", "CONCAVE"))
    bpy.ops.object.mode_set(mode="OBJECT")


def uv_area(objs, layer="UV_LM"):
    a = 0.0
    for o in objs:
        me = o.data
        me.calc_loop_triangles()
        uv = me.uv_layers[layer].data
        for t in me.loop_triangles:
            p0, p1, p2 = (Vector(uv[li].uv) for li in t.loops)
            a += abs((p1 - p0).cross(p2 - p0)) * 0.5
    return a


def reorder_uvs(o):
    """UVMap (TEXCOORD_0), UV_LM (TEXCOORD_1). W1's UV2 is dropped: it is the plane (z, y) over FACE_Z x FACE_Y, which
    the game computes from the world position for the macro map (fallsMaterials.ts MACRO_*), so it costs no bytes."""
    me = o.data
    if "UV2" in me.uv_layers:
        me.uv_layers.remove(me.uv_layers["UV2"])


def overlap_report(objs, res=1024):
    """Share of light-map texels claimed by more than one triangle (rasterised at triangle centroids' footprints)."""
    occ = np.zeros((res, res), np.int32)
    total = 0
    for o in objs:
        me = o.data
        me.calc_loop_triangles()
        uv = me.uv_layers["UV_LM"].data
        for t in me.loop_triangles:
            p = np.array([uv[li].uv[:] for li in t.loops]) * res
            mn = np.floor(p.min(0)).astype(int)
            mx = np.ceil(p.max(0)).astype(int)
            mn = np.clip(mn, 0, res - 1)
            mx = np.clip(mx, 0, res)
            if (mx - mn).min() <= 0:
                continue
            xs, ys = np.meshgrid(np.arange(mn[0], mx[0]) + 0.5, np.arange(mn[1], mx[1]) + 0.5)
            a, b, c = p
            d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(d) < 1e-12:
                continue
            l1 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / d
            l2 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / d
            inside = (l1 >= 0) & (l2 >= 0) & (l1 + l2 <= 1)
            occ[ys[inside].astype(int), xs[inside].astype(int)] += 1
            total += 1
    used = (occ > 0).sum()
    return {"tris": total, "texels_used_pct": round(100 * used / res / res, 1),
            "texels_overlap_pct_of_used": round(100 * (occ > 1).sum() / max(1, used), 3)}


lightmap_uv(LM_OBJS)
UVONLY = "--uvonly" in argv
if False:
    log("uv area", round(uv_area(LM_OBJS), 3), "islands", sum(len(o.data.polygons) for o in LM_OBJS))
    SIZE = 1024
    img = np.zeros((SIZE, SIZE, 3), np.float32)
    for k, o in enumerate(LM_OBJS):
        c = coverage([o])
        img[c] = ((k * 0.37) % 1, (k * 0.61) % 1, (k * 0.83) % 1)
        log("uv", o.name, round(uv_area([o]), 4))
    save_png(img, os.path.join(WORK, "falls_w3_uv.png"))
    sys.exit(0)
for o in LM_OBJS:
    reorder_uvs(o)
    o.data.uv_layers.active = o.data.uv_layers["UVMap"]
REPORT["lm_objects"] = {o.name: {"tris": tris(o), "uvs": [u.name for u in o.data.uv_layers]} for o in LM_OBJS}
REPORT["lm_uv"] = overlap_report(LM_OBJS)
REPORT["lm_uv"]["uv_area"] = round(uv_area(LM_OBJS), 3)
log("light-map UV", REPORT["lm_uv"])

# ========================================================================= 4. vertex light (cards, trees) ==
# the village bake's sun and sky (appended now: the vertex light needs the sun's direction)
with bpy.data.libraries.load(LMPREP) as (src, dst):
    dst.objects = ["Sun", "backdrop_near"]
    dst.worlds = ["World.001"]
SUN = dst.objects[0]
BACKDROP = dst.objects[1]
sc.collection.objects.link(SUN)
sc.collection.objects.link(BACKDROP)
sc.world = dst.worlds[0]
bpy.context.view_layer.update()
BACKDROP["cat"] = "bake_only"
# cut the site box (+2 m) out of the village's near backdrop: the old cliff and ground there belong to this file now
bm = bmesh.new()
bm.from_mesh(BACKDROP.data)
mw = BACKDROP.matrix_world
cut = []
for f in bm.faces:
    c = mw @ f.calc_center_median()
    gx, gz = c.x, -c.y
    if S["minX"] - 2 <= gx <= S["maxX"] + 2 and S["minZ"] - 2 <= gz <= S["maxZ"] + 2:
        cut.append(f)
bmesh.ops.delete(bm, geom=cut, context="FACES")
bm.to_mesh(BACKDROP.data)
bm.free()
SUN_DIR = (SUN.matrix_world.to_3x3() @ Vector((0, 0, 1))).normalized()
log("sun", tuple(round(v, 3) for v in SUN_DIR), "backdrop faces cut", len(cut))


def world_bvh(objs):
    verts, polys = [], []
    for o in objs:
        dg = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
        me = dg.to_mesh()
        mwo = o.matrix_world
        base = len(verts)
        verts += [mwo @ v.co for v in me.vertices]
        polys += [[base + i for i in p.vertices] for p in me.polygons]
        dg.to_mesh_clear()
    return BVHTree.FromPolygons(verts, polys)


SOLID = world_bvh([o for o in LM_OBJS if o.get("tier") != "low" and not o.name.endswith("lod1")] + [BACKDROP])
CARDS = [o for o in COLL.objects if o.type == "MESH" and (o.name.startswith("veg__") or o.get("cat") == "tree")]
TREE_INST = []
FOLIAGE = world_bvh(CARDS) if CARDS else None


def vertex_light(o, mwo, shadows, sun_lin=1.7, sky_up=0.85, sky_side=0.55):
    me = o.data
    col = me.color_attributes.get("Col") or me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    # per corner (cards carry the crown-outward normals in their corner normals)
    if col.domain != "CORNER":
        tint = np.ones((len(me.vertices), 4), np.float32)
        col.data.foreach_get("color", tint.ravel())
        tint_c = tint[[lp.vertex_index for lp in me.loops]]
        me.color_attributes.remove(col)
        col = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    else:
        tint_c = np.ones((len(me.loops), 4), np.float32)
        col.data.foreach_get("color", tint_c.ravel())
    me.color_attributes.active_color = col
    normals = [Vector(n.vector) for n in me.corner_normals]
    up = Vector((0, 0, 1))
    n3 = mwo.to_3x3()
    out = np.ones((len(me.loops), 4), np.float32)
    for li, lp in enumerate(me.loops):
        p = mwo @ me.vertices[lp.vertex_index].co
        n = (n3 @ normals[li]).normalized()
        ndl = max(0.0, n.dot(SUN_DIR))
        vis = 1.0
        sky = sky_side + (sky_up - sky_side) * max(0.0, n.z)
        if shadows:
            start = p + SUN_DIR * 0.25 + n * 0.05
            if SOLID.ray_cast(start, SUN_DIR, 400.0)[0] is not None:
                vis = 0.0
            elif FOLIAGE is not None and FOLIAGE.ray_cast(start + SUN_DIR * 0.2, SUN_DIR, 6.0)[0] is not None:
                vis = 0.55
            # the canyon: how much of the sky the vertex sees (5 rays over the upper hemisphere toward the open east)
            seen = 0
            for d in ((0, 0, 1), (0.7, 0, 0.7), (0.5, 0.5, 0.7), (0.5, -0.5, 0.7), (-0.5, 0, 0.85)):
                dv = Vector(d).normalized()
                if SOLID.ray_cast(p + n * 0.1 + dv * 0.2, dv, 120.0)[0] is None:
                    seen += 1
            sky *= 0.45 + 0.55 * seen / 5.0
        L = sun_lin * (0.15 + 0.85 * ndl) * vis + sky
        out[li, :3] = (L * GAME_GAIN, L * GAME_GAIN * 0.99, L * GAME_GAIN * 0.97)
    out[:, :3] = np.clip(out[:, :3] * tint_c[:, :3], 0.0, 1.0)
    col.data.foreach_set("color", out.ravel())


for o in CARDS:
    vertex_light(o, o.matrix_world, True)
log("vertex light", [o.name for o in CARDS])

# ================================================================================ material kinds ==
def kind_of(m):
    nt = m.node_tree
    if m.name.startswith("M_falls_lamp"):
        return "lamp"
    if m.get("falls") == "water":
        return "water"
    types = {n.type for n in nt.nodes}
    if "BSDF_TRANSLUCENT" in types:
        return "card"
    if "bark" in m.name:
        return "bark"
    if "SEPCOLOR" in types or "SEPARATE_COLOR" in types:
        return "stone"
    if "VERTEX_COLOR" in types:
        return "tint"
    return "plain"


def albedo_image(m):
    """The image the base colour starts from (the UVMap-mapped colour texture)."""
    best = None
    for n in m.node_tree.nodes:
        if n.type == "TEX_IMAGE" and n.image and n.image.colorspace_settings.name != "Non-Color":
            if best is None or n.location.y > best.location.y:
                best = n
    return best.image if best else None


def macro_image(m):
    for n in m.node_tree.nodes:
        if n.type == "TEX_IMAGE" and n.image and "macro" in n.image.name.lower():
            return n.image
    return None


for m in bpy.data.materials:
    if m.node_tree and "falls" not in m:
        m["falls"] = kind_of(m)
REPORT["materials"] = {m.name: m["falls"] for m in bpy.data.materials if m.users and "falls" in m}
log("materials", REPORT["materials"])

# ================================================================================================ 5. bake ==
def gpu():
    sc.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    try:
        prefs.compute_device_type = "OPTIX"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == "OPTIX"
        sc.cycles.device = "GPU"
    except Exception as e:  # noqa: BLE001
        log("GPU setup failed", e)


class BakeState:
    def __init__(self, emit_on):
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
                    if not (emit_on and m["falls"] == "lamp") and not n.inputs["Emission Strength"].is_linked:
                        self.saved.append((n.inputs["Emission Strength"], n.inputs["Emission Strength"].default_value))
                        n.inputs["Emission Strength"].default_value = 0.0
                elif n.type == "EMISSION" and not (emit_on and m["falls"] == "lamp"):
                    self.saved.append((n.inputs["Strength"], n.inputs["Strength"].default_value))
                    n.inputs["Strength"].default_value = 0.0

    def restore(self):
        for s, v in self.saved:
            s.default_value = v


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


def coverage(objs):
    """Texels (SIZE^2) whose centre lies in a triangle of objs' UV_LM, grown by one texel."""
    occ = np.zeros((SIZE, SIZE), bool)
    for o in objs:
        me = o.data
        me.calc_loop_triangles()
        uv = np.empty(len(me.loops) * 2, np.float32)
        me.uv_layers["UV_LM"].data.foreach_get("uv", uv)
        uv = uv.reshape(-1, 2) * SIZE
        for t in me.loop_triangles:
            a, b, c = uv[list(t.loops)]
            mn = np.clip(np.floor(np.minimum(np.minimum(a, b), c)).astype(int), 0, SIZE - 1)
            mx = np.clip(np.ceil(np.maximum(np.maximum(a, b), c)).astype(int), 0, SIZE)
            if (mx - mn).min() <= 0:
                continue
            xs, ys = np.meshgrid(np.arange(mn[0], mx[0]) + 0.5, np.arange(mn[1], mx[1]) + 0.5)
            d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(d) < 1e-12:
                continue
            l1 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / d
            l2 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / d
            inside = (l1 >= -1e-4) & (l2 >= -1e-4) & (l1 + l2 <= 1 + 1e-4)
            occ[ys[inside].astype(int), xs[inside].astype(int)] = True
    g = occ.copy()
    for ax in (0, 1):
        for s in (-1, 1):
            g |= np.roll(occ, s, axis=ax)
    return g


def bake_pass(objs, hidden):
    """One Cycles DIFFUSE bake of objs (others in `hidden` taken out of the scene), float RGB SIZE^2."""
    was = [(h, h.hide_render) for h in hidden]
    for h in hidden:
        h.hide_render = True
    img = bpy.data.images.new("LM_bake", SIZE, SIZE, alpha=False, float_buffer=True)
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
    for o in objs:
        o.data.uv_layers.active = o.data.uv_layers["UV_LM"]
    select(objs)
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = False
    sc.render.bake.margin = 3
    sc.render.bake.margin_type = "EXTEND"
    log(f"bake pass {SIZE}^2 {SAMPLES} spp: {[o.name for o in objs]}")
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, margin=3, use_clear=True,
                        target="IMAGE_TEXTURES", use_selected_to_active=False)
    for m, n in added:
        m.node_tree.nodes.remove(n)
    for o in objs:
        o.data.uv_layers.active = o.data.uv_layers["UVMap"]
    px = np.empty(SIZE * SIZE * 4, np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    for h, v in was:
        h.hide_render = v
    return px.reshape(SIZE, SIZE, 4)[..., :3].copy()


def dilate(a, filled, n):
    for _ in range(n):
        acc = np.zeros_like(a)
        cnt = np.zeros(filled.shape, np.float32)
        for ax in (0, 1):
            for s in (-1, 1):
                acc += np.roll(a * filled[..., None], s, axis=ax)
                cnt += np.roll(filled.astype(np.float32), s, axis=ax)
        grow = (~filled) & (cnt > 0)
        a[grow] = acc[grow] / cnt[grow][:, None]
        filled = filled | grow
    return a


COVER = {}
if UVONLY:
    log("uv area", round(uv_area(LM_OBJS), 3))
    SIZE = 1024
    img = np.zeros((SIZE, SIZE, 3), np.float32)
    for k, o in enumerate(LM_OBJS):
        c = coverage([o])
        img[c] = ((k * 0.37) % 1, (k * 0.61) % 1, (k * 0.83) % 1)
        log("uv", o.name, round(uv_area([o]), 4))
    save_png(img, os.path.join(WORK, "falls_w3_uv.png"))
    sys.exit(0)


def bake(out_png, emit_on, lift):
    state = BakeState(emit_on)
    res = []
    for objs, hidden in PASSES:
        if id(objs) not in COVER:
            COVER[id(objs)] = coverage(objs)
        res.append((bake_pass(objs, hidden), COVER[id(objs)]))
    state.restore()
    a = np.zeros((SIZE, SIZE, 3), np.float32)
    filled = np.zeros((SIZE, SIZE), bool)
    for img, m in res:
        take = m & ~filled
        a[take] = img[take]
        filled |= m
    a = dilate(a, filled, 10)
    # 3x3 binomial inside the islands (light denoise), then a box filter down to OUT
    k = np.array([0.25, 0.5, 0.25], np.float32)
    b = a.copy()
    for ax in (0, 1):
        b = sum(np.roll(b, s, axis=ax) * w for s, w in zip((-1, 0, 1), k))
    a = b
    f = SIZE // OUT
    if f > 1:
        a = a.reshape(OUT, f, OUT, f, 3).mean(axis=(1, 3))
    lum = a @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    nz = lum[lum > 1e-4]
    stats = {"p05": round(float(np.percentile(nz, 5)), 4), "p50": round(float(np.percentile(nz, 50)), 4),
             "p95": round(float(np.percentile(nz, 95)), 4), "clipped_pct": round(float((a.max(-1) > LM_SCALE).mean() * 100), 3),
             "texels_used_pct": round(float(filled.mean() * 100), 1)}
    a = a + lift * np.array([0.92, 0.96, 1.0], np.float32)
    enc = np.clip(a / LM_SCALE, 0, 1)
    enc = np.where(enc <= 0.0031308, enc * 12.92, 1.055 * np.power(enc, 1 / 2.4) - 0.055)
    save_png(enc, out_png)   # same rows as the village: the game reads it with flipY false on glTF UVs
    log("baked", out_png, stats)
    return stats


NIGHT = {"moon_azimuth_deg": 150.0, "moon_elevation_deg": 42.0, "moon_strength": 0.30, "moon_colour": (0.62, 0.72, 1.0),
         "moon_angle_deg": 1.5, "sky": (0.028, 0.040, 0.085), "lamp_power": 220.0, "lamp_colour": (1.0, 0.71, 0.42)}


def setup_night():
    az = math.radians(NIGHT["moon_azimuth_deg"])
    el = math.radians(NIGHT["moon_elevation_deg"])
    d = Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el))).normalized()
    SUN.rotation_mode = "QUATERNION"
    SUN.rotation_quaternion = (-d).to_track_quat("-Z", "Y")
    SUN.data.energy = NIGHT["moon_strength"]
    SUN.data.color = NIGHT["moon_colour"]
    SUN.data.angle = math.radians(NIGHT["moon_angle_deg"])
    w = bpy.data.worlds.new("NightWorld")
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Color"].default_value = (*NIGHT["sky"], 1.0)
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(bg.outputs[0], out.inputs["Surface"])
    n = 0
    for e in [o for o in bpy.data.objects if o.name.startswith("light__falls_lamp")]:
        ld = bpy.data.lights.new(e.name + "_L", "POINT")
        ld.energy = NIGHT["lamp_power"]
        ld.color = NIGHT["lamp_colour"]
        ld.shadow_soft_size = 0.12
        lo = bpy.data.objects.new(e.name + "_L", ld)
        lo.location = e.matrix_world.translation
        sc.collection.objects.link(lo)
        n += 1
    # the lamp's own posts and glass do not shadow their light (a closed lantern would ring a dark disc round it)
    for o in (LAMPS, GLASS):
        o.visible_shadow = False
    log("night: lamps", n)


gpu()
for o in WATER_OBJS:
    o.hide_render = True
for o in COLL.objects:
    if o.type == "MESH" and (o.get("tier") == "low" or o.name.endswith("lod1")) and o not in LM_OBJS:
        o.hide_render = True
# two passes into one map: the high-tier set with the LOD1 meshes out of the scene, then the LOD1 meshes with the
# high-only ones out (each LOD lit as it is drawn, never shadowed by its twin inside it)
LOD1 = [o for o in LM_OBJS if o.name.endswith("lod1")]
HIGH_ONLY = [o for o in list(COLL.objects) if o.type == "MESH" and o.get("tier") == "high" and o.name != "falls_boulders"]
HIGH_ONLY += [o for o in TREE_INST if o.get("tier") == "high"]
PASSES = [([o for o in LM_OBJS if o not in LOD1], LOD1), (LOD1, HIGH_ONLY)]
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, "falls_w3_lmprep.blend"))
if not NOBAKE:
    REPORT["day"] = bake(os.path.join(WORK, "waterfall_lm.png"), False, LM_LIFT)
    setup_night()
    REPORT["night"] = bake(os.path.join(WORK, "waterfall_lm_night.png"), True, 0.0)

# ======================================================================================= 6. export materials ==
def export_tree(m):
    kind = m["falls"]
    alb = albedo_image(m)
    mac = macro_image(m) if kind == "stone" else None
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bs.outputs[0], out.inputs["Surface"])
    bs.inputs["Roughness"].default_value = 0.9
    if kind == "lamp":
        bs.inputs["Base Color"].default_value = (1.0, 0.71, 0.42, 1)
    if alb is not None:
        uv = nt.nodes.new("ShaderNodeUVMap")
        uv.uv_map = "UVMap"
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = alb
        nt.links.new(uv.outputs[0], t.inputs["Vector"])
        nt.links.new(t.outputs["Color"], bs.inputs["Base Color"])
        if kind == "card":
            nt.links.new(t.outputs["Alpha"], bs.inputs["Alpha"])
            try:
                m.blend_method = "CLIP"
                m.alpha_threshold = 0.5
            except Exception:  # noqa: BLE001
                pass
            m.use_backface_culling = False
    if mac is not None:
        uv2 = nt.nodes.new("ShaderNodeUVMap")
        uv2.uv_map = "UV2"
        mt = nt.nodes.new("ShaderNodeTexImage")
        mt.image = mac
        nt.links.new(uv2.outputs[0], mt.inputs["Vector"])
        nt.links.new(mt.outputs["Color"], bs.inputs["Emission Color"])
        bs.inputs["Emission Strength"].default_value = 1.0
    return [i for i in (alb, mac) if i is not None]


used_images = set()
for m in bpy.data.materials:
    if m.users and m.node_tree and "falls" in m:
        used_images.update(export_tree(m))
TEX_MAX_BY_NAME = {"T_bark": 256}   # the trunks are small on screen; bytes go to the rock
for im in used_images:
    w, h = im.size
    cap = next((v for k, v in TEX_MAX_BY_NAME.items() if im.name.startswith(k)), TEX_MAX)
    if max(w, h) > cap:
        im.scale(min(w, cap), min(h, cap))
REPORT["images"] = {im.name: list(im.size) for im in used_images}
# glTF material names = the export names (the authoring names may carry suffixes)
for m in list(bpy.data.materials):
    if m.users and "export" in m and m.name != m["export"]:
        other = bpy.data.materials.get(m["export"])
        if other is not None and other != m:
            other.name = other.name + "__old"
        m.name = m["export"]

# ================================================================================================ 7. export ==
for o in list(sc.objects):
    if o.get("cat") == "bake_only" or o.type == "LIGHT" or (o.name.startswith("light__") and o.name.endswith("_L")):
        bpy.data.objects.remove(o)
for o in WATER_OBJS + LM_OBJS + CARDS:
    o.hide_render = False
    o.hide_viewport = False
for o in COLL.objects:
    o.hide_viewport = False
    o.hide_render = False
    o.visible_shadow = True
    o.visible_diffuse = True

REPORT["tris"] = {
    "high": sum(tris(o) for o in list(COLL.objects) + WATER_OBJS if o.type == "MESH" and o.get("cat") != "inst" and o.get("tier") != "low"
                and not o.name.endswith("_low"))
    + sum(tris(o) for o in TREE_INST),
    "low": sum(tris(o) for o in list(COLL.objects) + WATER_OBJS if o.type == "MESH" and o.get("cat") != "inst" and o.get("tier") != "high")
    + sum(tris(o) for o in TREE_INST if o.get("tier") != "high"),
}
log("tris", REPORT["tris"])
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, "falls_w3_export.blend"))
if not NOEXPORT:
    sel = [o for o in list(COLL.objects) + list(WATER.objects) if o.type in ("MESH", "EMPTY")]
    select(sel, active=sel[0])
    glb = os.path.join(WORK, "waterfall.glb")
    kw = dict(filepath=glb, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
              export_texcoords=True, export_normals=False, export_materials="EXPORT", export_image_format="WEBP",
              export_image_quality=70, export_animations=False, export_cameras=False, export_lights=False,
              export_extras=True, export_skins=False, export_morph=False, export_vertex_color="ACTIVE",
              export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True,
              export_tangents=False, export_gpu_instances=True,
              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=10,
              export_draco_position_quantization=14, export_draco_normal_quantization=8,
              export_draco_texcoord_quantization=11, export_draco_color_quantization=8,
              export_draco_generic_quantization=12)
    bpy.ops.export_scene.gltf(**kw)
    REPORT["glb_bytes"] = os.path.getsize(glb)
    log("GLB", glb, REPORT["glb_bytes"])
json.dump(REPORT, open(os.path.join(WORK, "falls_w3_report.json"), "w"), indent=1)
log("done")
