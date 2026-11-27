"""HB COPY of bake_house.py (houses 6-10): the only change is that the window-view bands (objects with cat "view", material M_view, drawn by the game with
house_N_view.webp) are hidden while baking and exported with the GLB. Original docstring follows.

Bake and export one house (houses interior; Blender 5.x, background) -> art/village/export/house_<N>.glb + light maps.

  blender -b art/village/work/house_<N>_authoring.blend -P art/village/tools/houses/bake_house.py -- --house N
          [--size 2048] [--samples 384] [--passes 1] [--out art/village/export] [--nobake] [--cpu]
  blender -b art/village/work/house_<N>_lmprep.blend    -P art/village/tools/houses/bake_house.py -- --house N --night
  python  art/village/tools/houses/post_house.py --house N         (PNG -> WebP 2048 / 1k, copies to the client)

The authoring blend comes from a placement script (house_common.House): meshes with cat "lm" (every kit piece), col__ boxes,
seat__ / light__ / stair__ / door__ / spawn__ empties. Day run:
  1. faces of unlit materials (H_lamp, H_shade, H_glass) move to their own mesh `<N>_fx`; the rest is joined into `house_<N>_lm`
  2. light-map UV ("UV_LM", 2nd set): smart-project islands (60 deg), equal texel density, packed (margin 0.0014 = design 7.3)
     -> saves work/house_<N>_lmprep.blend (the night run reuses exactly these UVs)
  3. Cycles DIFFUSE bake (direct + indirect, no colour) lit by the sun and sky through the openings (glass hidden) and by every
     light__ empty (indoor lamps low in the day) -> L / LM_SCALE as sRGB 8-bit -> work/house_<N>_lm.png   (night: _lm_night.png:
     sun off, dark-blue sky, lamps 2700 K on)
  4. authoring materials -> export materials (LM = albedo texture * vertex tint + the light map in the game; unlit lamp / shade;
     blended glass), Draco GLB with the node empties (col__, seat__, stair__, door__, spawn__ ...), KHR_materials_unlit patch,
     export/house_<N>_seats.json, export/house_<N>.json (budget numbers: triangles, materials, texture size).
Budgets (design 7.2): <= 1.0 MB, <= 45,000 triangles (col__ excluded), <= 24 materials, textures <= 2048.
"""
import json
import math
import os
import struct
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit_core as K  # noqa: E402
import hb_mats  # noqa: E402  (H_wallpaper / H_hanji)

WORK, EXPORT = K.WORK, K.EXPORT
LM_SCALE = 2.0         # the light map stores L / LM_SCALE (the game multiplies back: village convention)
LM_LIFT_DAY, LM_LIFT_NIGHT = 0.08, 0.012
UNLIT = ("H_lamp", "H_shade", "H_glass", "H_mirror")
DAY = dict(sun=(4.8, math.radians(52), math.radians(-30)), sky=0.85, lamp_scale=0.25)   # layered pass: more contrast
NIGHT = dict(sky=(0.02, 0.03, 0.07), lamp_scale=0.13)   # houses-real night mood (owner 2026-11-22): was 1.0 (p50 0.67, 27 % clipped: a washed-out night)


def arg(name, default=None, cast=str):
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for i, x in enumerate(a):
        if x == name:
            if i + 1 < len(a) and not a[i + 1].startswith("--"):
                return cast(a[i + 1])
            return True
    return default


def log(*a):
    print("[bake_house]", *a, flush=True)


def select(objs, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or (objs[0] if objs else None)


def gpu(scene):
    scene.render.engine = "CYCLES"
    if arg("--cpu") or os.environ.get("CV_CPU"):
        scene.cycles.device = "CPU"
        return
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "OPTIX"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == "OPTIX"
        scene.cycles.device = "GPU"
    except Exception as e:
        log("GPU setup failed", e)


# ------------------------------------------------------------------------------------------------ split / join --
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


def split_unlit(ob):
    me = ob.data
    idx = {i for i, m in enumerate(me.materials) if m.name in UNLIT}
    sel = {p.index for p in me.polygons if p.material_index in idx}
    if not sel:
        return None
    new = ob.copy()
    new.data = me.copy()
    for c in ob.users_collection:
        c.objects.link(new)
    for target, keep in ((new, True), (ob, False)):
        bm = bmesh.new()
        bm.from_mesh(target.data)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if (f.index in sel) != keep], context="FACES")
        bm.to_mesh(target.data)
        bm.free()
    new["cat"] = "fx"
    drop_unused_slots(new)
    drop_unused_slots(ob)
    return new


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
    ob["cat"] = objs[0].get("cat", "lm") if objs[0].name else "lm"
    return ob


# -------------------------------------------------------------------------------------------------- light map --
def lightmap_uv(objs, margin=0.002):   # houses-real pass 2: 4 px gaps (were 3; ~15k islands, so not more)
    for ob in objs:
        me = ob.data
        if "UV_LM" not in me.uv_layers:
            me.uv_layers.new(name="UV_LM")
        me.uv_layers.active = me.uv_layers["UV_LM"]
    select(objs)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=margin, area_weight=0.0, correct_aspect=True,
                             scale_to_bounds=False)
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    import uv_compact    # houses-real pass: furniture islands get twice the light-map density of walls and floors
    log("lm islands boosted", uv_compact.boost_small_lm_islands(objs))
    bpy.ops.uv.pack_islands(rotate=True, margin_method="FRACTION", margin=margin, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")


KIND_DAY = {"downlight": 0.5, "lamp": 3.0, "sconce": 3.0, "pendant": 1.6, "fire": 1.2, "led": 1.5}
KIND_NIGHT = {"downlight": 0.05, "lamp": 1.8, "sconce": 1.5, "pendant": 1.0, "fire": 0.45}   # houses-real night mood (owner 2026-11-22: the night room was as bright as day): ceiling downlights low, lamps / sconces / pendants and the fire make warm pools, corners fall dark (was downlight 0.55, pendant 1.2, fire 1.4)   # houses-real: the fire a warm local pool, not a wash (was 1.4)


def setup_lights(scene, night):
    for o in list(bpy.data.objects):
        if o.type == "LIGHT":
            bpy.data.objects.remove(o)
    cfg = NIGHT if night else DAY
    w = bpy.data.worlds.new("HouseWorld")
    scene.world = w
    nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    if night:
        bg.inputs["Color"].default_value = (*cfg["sky"], 1.0)
        bg.inputs["Strength"].default_value = 1.0
    else:
        env = nt.nodes.new("ShaderNodeTexEnvironment")
        env.image = bpy.data.images.load(os.path.join(K.DL, "hdri", "kloppenheim_06_puresky_2k.hdr"), check_existing=True)
        nt.links.new(env.outputs["Color"], bg.inputs["Color"])
        bg.inputs["Strength"].default_value = cfg["sky"]
    nt.links.new(bg.outputs[0], out.inputs["Surface"])
    if not night:
        e, ang, az = cfg["sun"]
        sd = bpy.data.lights.new("sun", "SUN")
        sd.energy = e
        sd.angle = math.radians(1.5)
        so = bpy.data.objects.new("sun", sd)
        scene.collection.objects.link(so)
        so.rotation_euler = (ang, 0, az)
    scale = cfg["lamp_scale"]
    n = 0
    for o in bpy.data.objects:
        if o.type == "EMPTY" and o.name.startswith(K.LIGHT_PREFIX):
            ld = bpy.data.lights.new(o.name, "POINT")
            kind = o.name[len(K.LIGHT_PREFIX):].split("_", 1)[0]
            # layered pass: pools of warm lamp light and softer ceiling fill (not a flat, even wash)
            kk = (KIND_DAY if not night else KIND_NIGHT).get(kind, 1.0)
            ld.energy = float(o.get("watts", 30.0)) * 8.0 * scale * kk
            c = str(o.get("color", "#FFD9A8"))
            ld.color = K.lin(c)[:3]
            ld.shadow_soft_size = 0.12
            lo = bpy.data.objects.new(o.name + "_L", ld)
            lo.location = o.location
            scene.collection.objects.link(lo)
            n += 1
    log("lights", n, "night" if night else "day")


def hanji_mask(obs, size):
    """boolean mask (size x size) of every UV_LM triangle of faces whose material is H_hanji, grown by 3 px (numpy rasterizer, no PIL in Blender)"""
    mk = np.zeros((size, size), bool)
    n = 0
    for ob in obs:
        me = ob.data
        if "UV_LM" not in me.uv_layers:
            continue
        uv = me.uv_layers["UV_LM"].data
        for p in me.polygons:
            m = me.materials[p.material_index] if p.material_index < len(me.materials) else None
            if m is None or m.name != "H_hanji":
                continue
            pts = [(uv[li].uv[0] * size, (1 - uv[li].uv[1]) * size) for li in p.loop_indices]
            for k in range(1, len(pts) - 1):
                tri = (pts[0], pts[k], pts[k + 1])
                xs, ys = [t[0] for t in tri], [t[1] for t in tri]
                x0, x1 = max(0, int(min(xs)) - 3), min(size - 1, int(max(xs)) + 3)
                y0, y1 = max(0, int(min(ys)) - 3), min(size - 1, int(max(ys)) + 3)
                if x1 < x0 or y1 < y0:
                    continue
                gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
                (ax, ay), (bx, by), (cx, cy) = tri
                den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
                if abs(den) < 1e-9:
                    continue
                w1 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / den
                w2 = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / den
                w3 = 1 - w1 - w2
                tol = 3.0 / max(1.0, abs(den) ** 0.5)
                mk[y0:y1 + 1, x0:x1 + 1] |= (w1 >= -tol) & (w2 >= -tol) & (w3 >= -tol)
            n += 1
    log("hanji faces", n)
    return mk if n else None


def make_hanji_transparent():
    for m in bpy.data.materials:
        if m.name == "H_hanji" and m.node_tree:
            nt = m.node_tree
            for nd in list(nt.nodes):
                nt.nodes.remove(nd)
            o = nt.nodes.new("ShaderNodeOutputMaterial")
            t = nt.nodes.new("ShaderNodeBsdfTransparent")
            nt.links.new(t.outputs[0], o.inputs["Surface"])


def bake_lightmap(scene, obs, size, samples, out_png, lift, passes=1, override=None):
    img = bpy.data.images.new("LM_bake", size, size, alpha=False, float_buffer=True)
    added = []
    for m in {m for ob in obs for m in ob.data.materials if m}:
        nt = m.node_tree
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = img
        for x in nt.nodes:
            x.select = False
        n.select = True
        nt.nodes.active = n
        added.append((m, n))
    saved = []
    for m in bpy.data.materials:           # bake-friendly: no metal / coat / transmission / emission glow
        if not m.node_tree:
            continue
        for n in m.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED":
                for k in ("Metallic", "Transmission Weight", "Coat Weight"):
                    if not n.inputs[k].is_linked:
                        saved.append((n.inputs[k], n.inputs[k].default_value))
                        n.inputs[k].default_value = 0.0
    for ob in obs:
        ob.data.uv_layers.active = ob.data.uv_layers["UV_LM"]
    select(obs)
    scene.cycles.samples = samples
    scene.cycles.max_bounces = 8
    scene.cycles.diffuse_bounces = 5
    scene.render.bake.margin = 16
    # houses-real pass 2: a seam texel takes the light of the faces across the seam, not of whichever island lies nearest in the atlas
    # (dark notches and blobs on cushions). Pass 2b (2026-11-27) re-tested EXTEND and 3 px gaps: both smeared dark stripes into wall
    # corners and chimney breasts, so this stays.
    scene.render.bake.margin_type = "ADJACENT_FACES"
    acc = None
    for p in range(passes):
        scene.cycles.seed = 17 + 101 * p
        log(f"bake pass {p + 1}/{passes} {size}^2 {samples} samples")
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, margin=16, use_clear=True, target="IMAGE_TEXTURES",
                            use_selected_to_active=False)
        px = np.empty(size * size * 4, np.float32)
        img.pixels.foreach_get(px)
        a = px.reshape(size, size, 4)[..., :3].copy()
        acc = a if acc is None else acc + a
    a = acc / passes
    for s, v in saved:
        s.default_value = v
    for m, n in added:
        m.node_tree.nodes.remove(n)
    for ob in obs:
        ob.data.uv_layers.active = ob.data.uv_layers["UVMap"]
    k = np.array([0.25, 0.5, 0.25], np.float32)
    b = a
    for ax in (0, 1):
        b = sum(np.roll(b, s, axis=ax) * w for s, w in zip((-1, 0, 1), k))
    lum = b @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    nz = lum[lum > 1e-4]
    stats = dict(p05=float(np.percentile(nz, 5)), p50=float(np.percentile(nz, 50)), p95=float(np.percentile(nz, 95)),
                 clipped_pct=float((b.max(-1) > LM_SCALE).mean() * 100))
    b = b + lift * np.array([0.92, 0.96, 1.0], np.float32)
    if override is not None:
        b[override[0]] = np.array(override[1], np.float32)
    enc = np.clip(b / LM_SCALE, 0, 1)
    enc = np.where(enc <= 0.0031308, enc * 12.92, 1.055 * np.power(enc, 1 / 2.4) - 0.055)
    out = bpy.data.images.new("tmp_out", size, size, alpha=False)
    out.colorspace_settings.name = "Non-Color"
    o4 = np.ones((size, size, 4), np.float32)
    o4[..., :3] = enc
    out.pixels.foreach_set(o4.ravel())
    out.filepath_raw = out_png
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(out)
    bpy.data.images.remove(img)
    return stats


# ------------------------------------------------------------------------------------------------ export --
def small_tex(name):
    """the GLB carries a 128 px copy of each albedo (make_house_textures_real.py); the game loads the shared full-size file by the image name"""
    p = os.path.join(K.TEXH, "small", name)
    return p if os.path.exists(p) else os.path.join(K.TEXH, name)


def export_materials():
    out = {}
    for name, sp in K.MATS.items():
        m = bpy.data.materials.new("E_" + name)
        nt = m.node_tree
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        o = nt.nodes.new("ShaderNodeOutputMaterial")
        b = nt.nodes.new("ShaderNodeBsdfPrincipled")
        b.inputs["Metallic"].default_value = 0.0
        b.inputs["Roughness"].default_value = 1.0
        nt.links.new(b.outputs[0], o.inputs["Surface"])
        col = None
        if name == "H_lamp":
            b.inputs["Base Color"].default_value = K.lin("#FFE6C8")
        elif name == "H_shade":
            b.inputs["Base Color"].default_value = K.lin("#FFE9C2")
        elif name == "H_glass":
            b.inputs["Base Color"].default_value = K.lin("#E8F0F2")
            b.inputs["Alpha"].default_value = 0.16
        else:
            if "tex" in sp:
                img = bpy.data.images.load(small_tex(sp["tex"]), check_existing=True)   # realism pass: 128 px in the GLB, the game swaps in /textures/houses/<hi|lo>/
                img.colorspace_settings.name = "sRGB"
                t = nt.nodes.new("ShaderNodeTexImage")
                t.image = img
                uv = nt.nodes.new("ShaderNodeUVMap")
                uv.uv_map = "UVMap"
                nt.links.new(uv.outputs[0], t.inputs["Vector"])
                col = t.outputs["Color"]
            else:
                b.inputs["Base Color"].default_value = K.lin(sp.get("color", "#808080"))
            if sp.get("tint"):
                ca = nt.nodes.new("ShaderNodeVertexColor")
                ca.layer_name = "Col"
                mx = nt.nodes.new("ShaderNodeMix")
                mx.data_type = "RGBA"
                mx.blend_type = "MULTIPLY"
                mx.inputs["Factor"].default_value = 1.0
                if col is not None:
                    nt.links.new(col, mx.inputs[6])
                else:
                    mx.inputs[6].default_value = K.lin(sp.get("color", "#FFFFFF"))
                nt.links.new(ca.outputs["Color"], mx.inputs[7])
                col = mx.outputs[2]
            if col is not None:
                nt.links.new(col, b.inputs["Base Color"])
        out[name] = m
    return out


def convert(ob, EM):
    me = ob.data
    names = [m.name for m in me.materials]
    uniq = []
    for n in names:
        if n not in uniq:
            uniq.append(n)
    idx = [uniq.index(names[p.material_index]) for p in me.polygons]
    me.materials.clear()
    for n in uniq:
        me.materials.append(EM[n])
    me.polygons.foreach_set("material_index", idx)


def patch_glb(path):
    data = open(path, "rb").read()
    magic, ver, length = struct.unpack_from("<III", data, 0)
    off, chunks = 12, []
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
        for k in ("emissiveTexture", "emissiveFactor", "normalTexture"):
            m.pop(k, None)
        if name == "E_H_glass":
            m["alphaMode"] = "BLEND"
        else:
            m.pop("alphaMode", None)
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


def dump_seats(path):
    seats = []
    for o in sorted((o for o in bpy.data.objects if o.name.startswith(K.SEAT_PREFIX)), key=lambda o: o.name):
        d = dict(name=o.name, x=round(o.location.x, 3), z=round(-o.location.y, 3), y=round(o.location.z, 3))
        for k in K.SEAT_EXTRA_KEYS:
            d[k] = o.get(k)
        seats.append(d)
    json.dump({"seats": seats}, open(path, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    log("seats", len(seats), "->", path)
    return len(seats)


def clean_props():
    """export only the contract's custom properties: the 12 extras on seat__ nodes, nothing else"""
    keep = set(K.SEAT_EXTRA_KEYS)
    for o in bpy.data.objects:
        for key in list(o.keys()):
            if o.name.startswith(K.SEAT_PREFIX) and key in keep:
                continue
            try:
                del o[key]
            except Exception:
                pass


def lm_by_floor():
    out = {1: [], 2: []}
    for o in bpy.data.objects:
        if o.type == "MESH" and o.get("cat") == "lm":
            out[int(o.get("floor", 1))].append(o)
    return out


def main():
    scene = bpy.context.scene
    n = arg("--house", 0, int)
    size = arg("--size", 2048, int)
    samples = arg("--samples", 384, int)
    night = bool(arg("--night"))
    hb_mats.use_wallpaper(n)
    DAY["sky"] = arg("--sky", DAY["sky"], float)
    DAY["lamp_scale"] = arg("--lampday", DAY["lamp_scale"], float)
    NIGHT["lamp_scale"] = arg("--lampnight", NIGHT["lamp_scale"], float)
    ns = arg("--nightsky", 0.0, float)      # art round 2: a neutral-warm dark night sky (the default navy tinted the walls round the windows)
    if ns:
        NIGHT["sky"] = (ns, ns * 0.95, ns * 1.1)
    e_, a_, z_ = DAY["sun"]
    DAY["sun"] = (arg("--sun", e_, float), a_, z_)
    out_dir = os.path.abspath(arg("--out", EXPORT))
    os.makedirs(out_dir, exist_ok=True)
    gpu(scene)
    lms, fxs = {}, {}
    if not night:
        for f, objs in lm_by_floor().items():
            for o in objs:
                for m in o.data.materials:
                    m["export"] = m.name
            fx = [x for x in (split_unlit(o) for o in list(objs)) if x]
            lms[f] = join(objs, f"house_{n}_lm_{f}")
            if lms[f]:
                lms[f]["cat"] = "lm"
            fxs[f] = join(fx, f"house_{n}_fx_{f}")
            if fxs[f]:
                fxs[f]["cat"] = "fx"
        lm_list = [o for o in lms.values() if o]
        log("lm triangles", {f: sum(len(p.vertices) - 2 for p in o.data.polygons) for f, o in lms.items() if o})
        lightmap_uv(lm_list)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, f"house_{n}_lmprep.blend"), copy=True)
    else:
        lm_list = [o for o in bpy.data.objects if o.name.startswith(f"house_{n}_lm_")]
        fxs = {int(o.name.rsplit("_", 1)[1]): o for o in bpy.data.objects if o.name.startswith(f"house_{n}_fx_")}
    hidden = [o for o in fxs.values() if o is not None]
    views = [o for o in bpy.data.objects if o.get("cat") == "view"]
    for o in views:
        o.hide_render = True
    for o in bpy.data.objects:
        if o.name.startswith(K.COL_PREFIX):
            o.hide_render = True
    setup_lights(scene, night)
    lm_png = os.path.join(WORK, f"house_{n}_lm_night.png" if night else f"house_{n}_lm.png")
    stats = {}
    for o in hidden:      # glass / lamp shades off for the bake (the sky comes in through the openings)
        o.hide_render = True
    if not arg("--nobake"):
        mask = hanji_mask(lm_list, size)
        make_hanji_transparent()
        ov = (mask, (0.30, 0.215, 0.12) if night else (1.2, 1.15, 1.02)) if mask is not None else None
        stats = bake_lightmap(scene, lm_list, size, samples, lm_png, LM_LIFT_NIGHT if night else LM_LIFT_DAY, arg("--passes", 1, int), override=ov)
        log("light map", "night" if night else "day", stats)
    if night and not arg("--reexport"):     # --reexport (houses-real pass): the lmprep's meshes and UVs exported again, no bake
        return
    for o in hidden:
        o.hide_render = False
    EM = export_materials()
    for o in lm_list + hidden:
        convert(o, EM)
        o.data.uv_layers.active = o.data.uv_layers["UVMap"]
        if o in hidden and "UV_LM" in o.data.uv_layers:
            o.data.uv_layers.remove(o.data.uv_layers["UV_LM"])
        if "Col" in o.data.color_attributes:
            o.data.color_attributes.active_color = o.data.color_attributes["Col"]
    import uv_compact    # houses-real pass: albedo UV islands next to the origin, so Draco's 14-bit texcoords don't smear them
    log("uv0 islands moved", uv_compact.compact_uv0(lm_list))
    for o in bpy.data.objects:
        if o.name.startswith(K.COL_PREFIX):
            o.hide_render = False
    n_seats = dump_seats(os.path.join(out_dir, f"house_{n}_seats.json"))
    for o in list(bpy.data.objects):       # bake-only lights
        if o.name.startswith(K.LIGHT_PREFIX):
            bpy.data.objects.remove(o)
    clean_props()
    keep_nodes = ("floor__", "stair__", "door__", "spawn__", "ceil__", K.COL_PREFIX, K.SEAT_PREFIX)
    nodes = [o for o in bpy.data.objects if o.type == "EMPTY" and o.name.startswith(keep_nodes)]
    cols = [o for o in bpy.data.objects if o.name.startswith(K.COL_PREFIX) or o.name.startswith("ceil__")]
    glb = os.path.join(out_dir, f"house_{n}.glb")
    for o in views:
        o.hide_render = False
    sel = lm_list + hidden + cols + nodes + views
    select(sel, lm_list[0])
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
                              export_texcoords=True, export_normals=False, export_materials="EXPORT", export_image_format="WEBP",
                              export_image_quality=82, export_animations=False, export_cameras=False, export_lights=False,
                              export_extras=True, export_skins=False, export_morph=False, export_vertex_color="MATERIAL",
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
                              export_draco_position_quantization=16, export_draco_normal_quantization=10,
                              export_draco_texcoord_quantization=14, export_draco_color_quantization=10,
                              export_draco_generic_quantization=12)
    js = patch_glb(glb)
    tris = sum(len(p.vertices) - 2 for o in lm_list + hidden for p in o.data.polygons)
    info = dict(glb=glb, bytes=os.path.getsize(glb), triangles=tris, materials=[m.get("name") for m in js.get("materials", [])],
                seats=n_seats, colliders=len(cols), nodes=len(nodes), lightmap=stats,
                budget=dict(bytes_ok=os.path.getsize(glb) <= 1_000_000, tris_ok=tris <= 54000, mats_ok=len(js.get("materials", [])) <= 56))
    json.dump(info, open(os.path.join(out_dir, f"house_{n}.json"), "w", encoding="utf-8"), indent=1)
    log("EXPORTED", glb, info["bytes"], "bytes", tris, "tris", len(info["materials"]), "materials", info["budget"])


if __name__ == "__main__":
    main()
