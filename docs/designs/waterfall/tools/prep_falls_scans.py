"""B1 waterfall W1 round 4: prepare the photoscanned CC0 rocks (Poly Haven) for the cliff build.

  blender -b --factory-startup -P prep_falls_scans.py -- [--only KEY,KEY] [--no-bake]

Reads art/village/downloads/scans/<asset>/ (glTF 1k, downloaded by hand from https://api.polyhaven.com, sources in
downloads/scans/sources.json; untrusted data: only the glTF geometry + its textures are imported, nothing executed).
For every model it:
  1. imports the scan, joins it, applies transforms, turns the cliff sections so their open back faces west (front +X
     in Blender = game east) and puts the origin on the front plane (x), the bottom (z) and the middle (y);
  2. decimates two LODs (collapse; hi / lo triangle targets below), triangulated, fresh smart-UV layout on hi
     (lo keeps hi's UVs through the collapse);
  3. bakes, high scan -> hi: the colour (scan albedo x its own AO^0.6) and a tangent-space normal map (GL, +Y) that
     carries the relief the decimation removed plus the scan's own fine normal map;
  4. grades the baked colour toward the granite of refs 12 / 05 (keeps part of the chroma, lighter grey-tan), resizes
     and writes work/tex/falls/scans/T_scan_<key>_d.png / _n.png;
and the tileable scanned texture (lichen_rock) becomes T_falls_rock_base_d/_n.png (cliff backing, slabs, cobbles).
Writes work/falls_scans.blend (meshes scan_<key>_hi / scan_<key>_lo) and work/falls_scans_report.json.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SCANS = os.path.join(ROOT, "downloads", "scans")
WORK = os.path.join(ROOT, "work")
TEXS = os.path.join(WORK, "tex", "falls", "scans")
os.makedirs(TEXS, exist_ok=True)
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ONLY = set(argv[argv.index("--only") + 1].split(",")) if "--only" in argv else None
NO_BAKE = "--no-bake" in argv

# key: (asset id, turn about Z (deg) so the front faces +X, hi tris, lo tris, texture size, grade)
# grade: (chroma kept, target mean sRGB luminance, warm tint (r, g, b) multipliers)
ASSETS = {
    "cliff2": ("namaqualand_cliff_02", 90.0, 720, 200, 1024, (0.34, 0.40, (0.99, 1.0, 0.96))),
    "cliff1": ("namaqualand_cliff_01", 90.0, 480, 120, 1024, (0.34, 0.40, (0.99, 1.0, 0.96))),
    "face2": ("rock_face_02", 90.0, 300, 80, 512, (0.5, 0.40, (1.0, 1.0, 0.97))),
    "boulder1": ("boulder_01", 0.0, 300, 90, 512, (0.42, 0.40, (0.99, 1.0, 0.96))),
    "boulder3": ("namaqualand_boulder_03", 0.0, 260, 80, 512, (0.33, 0.44, (0.99, 1.0, 0.96))),
}


def import_scan(asset):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    d = os.path.join(SCANS, asset)
    f = next(os.path.join(d, n) for n in os.listdir(d) if n.endswith(".gltf"))
    bpy.ops.import_scene.gltf(filepath=f)
    obs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    for o in bpy.context.scene.objects:
        o.select_set(o in obs)
    bpy.context.view_layer.objects.active = obs[0]
    if len(obs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    for o in list(bpy.context.scene.objects):
        if o is not ob and o.type != "MESH":
            bpy.data.objects.remove(o)
    ob.parent = None
    ob.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # glTF splits vertices at every UV seam: weld them, or the collapse cannot cross the seams
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def orient(ob, turn):
    me = ob.data
    me.transform(Matrix.Rotation(math.radians(turn), 4, "Z"))
    xs = sorted(v.co.x for v in me.vertices)
    zmin = min(v.co.z for v in me.vertices)
    ys = [v.co.y for v in me.vertices]
    # front plane: the area-weighted median x of the east-facing surface (the bulk of the face: its knobs stand out
    # of it, its joints go in)
    if turn:
        fr = sorted((p.center.x, p.area) for p in me.polygons if p.normal.x > 0.5)
        tot, acc, fx = sum(a for _, a in fr), 0.0, 0.0
        for x_, a in fr:
            acc += a
            if acc >= 0.5 * tot:
                fx = x_
                break
    else:
        fx = 0.5 * (xs[0] + xs[-1])
    me.transform(Matrix.Translation((-fx, -0.5 * (min(ys) + max(ys)), -zmin)))
    me.update()


def decimate(src, name, tris):
    me = src.data.copy()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    n = sum(len(p.vertices) - 2 for p in me.polygons)
    md = ob.modifiers.new("dec", "DECIMATE")
    md.decimate_type = "COLLAPSE"
    md.ratio = min(1.0, tris / max(1, n))
    md.use_collapse_triangulate = True
    tri = ob.modifiers.new("tri", "TRIANGULATE")
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.scene.objects:
        o.select_set(o is ob)
    bpy.ops.object.modifier_apply(modifier="dec")
    bpy.ops.object.modifier_apply(modifier="tri")
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def high_material_for_bake(ob):
    """The scan's own material: base colour = albedo x AO^0.6 (ARM red), normal map kept."""
    m = ob.data.materials[0]
    nt = m.node_tree
    bs = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    texs = [n for n in nt.nodes if n.type == "TEX_IMAGE" and n.image]
    diff = next(n for n in texs if "diff" in n.image.name.lower() or "diff" in n.image.filepath.lower())
    arm = next((n for n in texs if "arm" in n.image.name.lower() or "arm" in n.image.filepath.lower()), None)
    col = diff.outputs["Color"]
    if arm is not None:
        sp = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(arm.outputs["Color"], sp.inputs["Color"])
        pw = nt.nodes.new("ShaderNodeMath")
        pw.operation = "POWER"
        nt.links.new(sp.outputs[0], pw.inputs[0])
        pw.inputs[1].default_value = 0.6
        mx = nt.nodes.new("ShaderNodeMix")
        mx.data_type = "RGBA"
        mx.blend_type = "MULTIPLY"
        mx.inputs["Factor"].default_value = 1.0
        nt.links.new(col, mx.inputs[6])
        nt.links.new(pw.outputs[0], mx.inputs[7])
        col = mx.outputs[2]
    nt.links.new(col, bs.inputs["Base Color"])
    bs.inputs["Metallic"].default_value = 0.0
    for l in list(nt.links):          # metallic must be 0 for the colour bake
        if l.to_socket == bs.inputs["Metallic"]:
            nt.links.remove(l)
    return m


def bake(high, low, size, key, reach):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 4
    sc.render.bake.use_selected_to_active = True
    sc.render.bake.cage_extrusion = reach
    sc.render.bake.max_ray_distance = reach * 2.5
    sc.render.bake.margin = 8
    out = {}
    for kind in ("DIFFUSE", "NORMAL"):
        im = bpy.data.images.new(f"bk_{key}_{kind}", size, size, alpha=False, float_buffer=False)
        if kind == "NORMAL":
            im.colorspace_settings.name = "Non-Color"
        m = bpy.data.materials.new(f"bk_{key}_{kind}")
        m.use_nodes = True
        tn = m.node_tree.nodes.new("ShaderNodeTexImage")
        tn.image = im
        m.node_tree.nodes.active = tn
        low.data.materials.clear()
        low.data.materials.append(m)
        for o in sc.objects:
            o.select_set(o in (high, low))
        bpy.context.view_layer.objects.active = low
        if kind == "DIFFUSE":
            sc.render.bake.use_pass_direct = False
            sc.render.bake.use_pass_indirect = False
            sc.render.bake.use_pass_color = True
            bpy.ops.object.bake(type="DIFFUSE")
        else:
            sc.render.bake.normal_space = "TANGENT"
            bpy.ops.object.bake(type="NORMAL")
        p = os.path.join(TEXS, f"_raw_{key}_{kind.lower()}.png")
        im.filepath_raw = p
        im.file_format = "PNG"
        im.save()
        out[kind] = p
    low.data.materials.clear()
    return out


def _load_np(path):
    import numpy as np
    im = bpy.data.images.load(path, check_existing=False)
    im.colorspace_settings.name = "Non-Color"          # raw bytes, no colour transform
    w, h = im.size
    a = np.empty(w * h * 4, np.float32)
    im.pixels.foreach_get(a)
    bpy.data.images.remove(im)
    return a.reshape(h, w, 4)[..., :3].copy()


def _save_np(a, path, size):
    import numpy as np
    h, w = a.shape[:2]
    im = bpy.data.images.new("tmp_out", w, h, alpha=False, float_buffer=False)
    im.colorspace_settings.name = "Non-Color"
    px = np.ones((h, w, 4), np.float32)
    px[..., :3] = np.clip(a, 0, 1)
    im.pixels.foreach_set(px.ravel())
    if w != size:
        im.scale(size, size)
    im.filepath_raw = path
    im.file_format = "PNG"
    im.save()
    bpy.data.images.remove(im)


def grade_arr(a, keep, target, tint):
    import numpy as np
    lum = a @ np.array([0.299, 0.587, 0.114], np.float32)
    miss = lum < 0.004                      # bake misses (the closing caps, far from any scanned surface): dark grey
    a = np.where(miss[..., None], np.float32(0.0), a)
    a = lum[..., None] + keep * (a - lum[..., None])
    a = a * np.array(tint, np.float32)
    ok = lum > 0.02
    m = float(np.median(lum[ok])) if ok.any() else 0.4
    a = np.clip(a * (target / max(m, 1e-3)), 0, 1)
    # fill the misses with shifted copies of the baked rock (the skirt faces then still read as rock), a bit darker
    h, w = miss.shape
    todo = miss.copy()
    for dy, dx in ((h // 3, w // 5), (h // 2, w // 2), (h // 5, 2 * w // 3), (2 * h // 3, w // 3), (h // 7, w // 9),
                   (3 * h // 4, 3 * w // 4), (h // 9, w // 2), (h // 2, w // 7)):
        cand = np.roll(a, (dy, dx), (0, 1))
        cm = np.roll(miss, (dy, dx), (0, 1))
        put = todo & ~cm
        a[put] = cand[put] * 0.82
        todo &= ~put
    a[todo] = np.array([0.24, 0.235, 0.225], np.float32)
    return a


def grade(raw_d, raw_n, key, size, g):
    keep, target, tint = g
    _save_np(grade_arr(_load_np(raw_d), keep, target, tint), os.path.join(TEXS, f"T_scan_{key}_d.png"), size)
    _save_np(_load_np(raw_n), os.path.join(TEXS, f"T_scan_{key}_n.png"), size)


REPORT = {"assets": {}}
keep_meshes = []
for key, (asset, turn, hi_t, lo_t, size, g) in ASSETS.items():
    if ONLY and key not in ONLY:
        continue
    print("== scan", key, asset)
    src = import_scan(asset)
    orient(src, turn)
    hi = decimate(src, f"scan_{key}_hi", hi_t)
    if turn:
        # the cliff scans are open shells (no back, no bottom): close them, or every overhang shows its inside
        # (a skirt straight back from every open edge to a plane behind the scan, then that planar outline filled: a
        # plain fill of the curved rim would cut across the front)
        import bmesh
        bm = bmesh.new()
        bm.from_mesh(hi.data)
        bm.verts.ensure_lookup_table()
        xback = min(v.co.x for v in bm.verts) - 0.3
        bnd = [e for e in bm.edges if e.is_boundary]
        twin = {}
        for e in bnd:
            for v in e.verts:
                if v not in twin:
                    twin[v] = bm.verts.new((xback, v.co.y, v.co.z))
        for e in bnd:
            f = e.link_faces[0]
            # the edge's direction in its face's loop; the skirt runs the other way round
            lp = next(l for l in f.loops if l.edge == e)
            a, b = lp.vert, lp.link_loop_next.vert
            try:
                bm.faces.new((b, a, twin[a], twin[b]))
            except ValueError:
                pass
        back = [e for e in bm.edges if e.is_boundary]
        bmesh.ops.holes_fill(bm, edges=back, sides=0)
        bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])
        bm.normal_update()
        bm.to_mesh(hi.data)
        bm.free()
        for p in hi.data.polygons:
            p.use_smooth = True
    # fresh UVs on hi (the scan's atlas does not survive a 1:100 collapse); lo is collapsed from hi and keeps them
    for o in bpy.context.scene.objects:
        o.select_set(o is hi)
    bpy.context.view_layer.objects.active = hi
    while hi.data.uv_layers:
        hi.data.uv_layers.remove(hi.data.uv_layers[0])
    hi.data.uv_layers.new(name="UVMap")
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.006, area_weight=0.0, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode="OBJECT")
    lo = decimate(hi, f"scan_{key}_lo", lo_t)
    dims = [max(v.co[i] for v in src.data.vertices) - min(v.co[i] for v in src.data.vertices) for i in range(3)]
    reach = max(0.05, 0.03 * max(dims))
    if not NO_BAKE:
        high_material_for_bake(src)
        raw = bake(src, hi, 2048 if size >= 1024 else 1024, key, reach)
        grade(raw["DIFFUSE"], raw["NORMAL"], key, size, g)
    REPORT["assets"][key] = {"asset": asset, "dims_m": [round(d, 2) for d in dims],
                             "src_tris": sum(len(p.vertices) - 2 for p in src.data.polygons),
                             "hi_tris": len(hi.data.polygons), "lo_tris": len(lo.data.polygons), "tex": size}
    # keep the two LOD meshes: written to a library file at the end
    for o in (hi, lo):
        o.data.name = o.name
        path = os.path.join(WORK, "falls_scans_parts", o.name + ".blend")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        bpy.data.libraries.write(path, {o.data}, fake_user=True)
        keep_meshes.append(path)
    print(REPORT["assets"][key])

# the tileable scan (cliff backing, slabs, cobbles): graded like the cliffs, 1024
if not ONLY or "base" in ONLY:
    d = os.path.join(SCANS, "lichen_rock")
    fd = next(os.path.join(d, n) for n in os.listdir(d) if "diff" in n)
    fn = next(os.path.join(d, n) for n in os.listdir(d) if "nor_gl" in n)
    _save_np(grade_arr(_load_np(fd), 0.5, 0.40, (1.02, 1.0, 0.95)), os.path.join(TEXS, "T_falls_rock_base_d.png"), 512)
    _save_np(_load_np(fn), os.path.join(TEXS, "T_falls_rock_base_n.png"), 512)
    # the walk slabs / seats / cobbles: the same scan, lighter, low contrast (its white lichen spots read as snow)
    import numpy as np
    a = grade_arr(_load_np(fd), 0.35, 0.47, (1.0, 1.0, 0.96))
    m = a.reshape(-1, 3).mean(0)
    _save_np(np.clip(m + 0.45 * (a - m), 0, 1), os.path.join(TEXS, "T_falls_slab_d.png"), 512)

# gather the LOD meshes into one library blend
bpy.ops.wm.read_factory_settings(use_empty=True)
pdir = os.path.join(WORK, "falls_scans_parts")
for f in sorted(os.listdir(pdir)):
    with bpy.data.libraries.load(os.path.join(pdir, f)) as (src_, dst):
        dst.meshes = list(src_.meshes)
for me in bpy.data.meshes:
    me.use_fake_user = True
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, "falls_scans.blend"))
rp = os.path.join(WORK, "falls_scans_report.json")
old = json.load(open(rp)) if os.path.exists(rp) else {"assets": {}}
old["assets"].update(REPORT["assets"])
json.dump(old, open(rp, "w"), indent=1)
print(json.dumps(old, indent=1))
