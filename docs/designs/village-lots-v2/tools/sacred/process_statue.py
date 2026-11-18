# Sacred-art statue processor (B2s/B3s): real 3D scan (STL) -> game GLB with PC + phone LOD, baked normal / AO from the
# full-resolution scan, and a baked PBR surface (marble, gilt, bronze ...). One Blender, headless, run once per statue:
#
#   blender -b --factory-startup -P process_statue.py -- <job.json>
#
# job.json: {
#   "src": "art/sacred/src/smk/KAS225_bruges_madonna.stl", "out_dir": "art/sacred/build/mary", "name": "lotstatue__lot_chapel_nave_mary",
#   "rot_deg": [0, 0, 0],          # applied to the raw scan first (Blender Z up, the statue's face toward -Y)
#   "crop_z": [0.0, 1.0],          # keep this fraction of the (rotated) height, bottom..top (cuts display slabs, labels)
#   "height_m": 1.35,              # final height (metres) after the crop
#   "tri_pc": 14000, "tri_phone": 5000,
#   "tex": {"normal": 2048, "albedo": 1024, "orm": 1024},
#   "surface": "marble" | "gilt" | "bronze" | "painted_wood" | "photo" | "scan" (keep the scan's own textured
#              materials: bake its colour; roughness/metal from the colour, gold leaf -> metal; "scan_rough", "scan_gold")
#   "src" may be .stl, .glb/.gltf or .obj; "keep_largest" (default true for STL only) drops loose pieces
#   "hair_above": 0.86,            # gilt only: fraction of height above which the head hair is painted lapis (Korean 나발)
#   "hair_radius": 0.16,           #   ... within this radius (fraction of height) of the head axis
#   "smooth": 0                    # Laplacian smoothing iterations on the high-poly (weathered stone -> freshly carved)
# }
# Writes <out_dir>/<name>.glb (PNG textures inside; ktx2_glb.mjs swaps them to KTX2) and <out_dir>/report.json.
import bpy, bmesh, sys, os, json, math, time
from mathutils import Vector, Matrix

t0 = time.time()
job = json.load(open(sys.argv[sys.argv.index("--") + 1], encoding="utf-8"))
OUT = os.path.abspath(job["out_dir"]); os.makedirs(OUT, exist_ok=True)
NAME = job["name"]
rep = {"name": NAME, "src": job["src"]}


def log(*a):
    print("[statue]", f"{time.time() - t0:6.1f}s", *a, flush=True)


for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
sc = bpy.context.scene

# ---------------- import + clean ----------------
SRC = os.path.abspath(job["src"]); ext = os.path.splitext(SRC)[1].lower()
if ext == ".stl":
    bpy.ops.wm.stl_import(filepath=SRC)
elif ext in (".glb", ".gltf"):
    bpy.ops.import_scene.gltf(filepath=SRC)        # textured photogrammetry (Sketchfab CC0 downloads)
elif ext == ".obj":
    bpy.ops.wm.obj_import(filepath=SRC)
else:
    raise SystemExit(f"unsupported source {ext}")
meshes = [o for o in sc.objects if o.type == "MESH"]
for o in meshes:  # unparent keeping the world transform (glTF parents carry the Y-up rotation and the scan's scale)
    mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
for o in sc.objects: o.select_set(o in meshes)
bpy.context.view_layer.objects.active = meshes[0]
# bake every imported transform (glTF nodes carry scale/rotation) and join into one high-poly
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
if len(meshes) > 1: bpy.ops.object.join()
hi = bpy.context.view_layer.objects.active
for o in [o for o in sc.objects if o.type != "MESH"]: bpy.data.objects.remove(o, do_unlink=True)
hi.parent = None
hi.name = "high"
rep["src_materials"] = [m.name for m in hi.data.materials if m]
rx, ry, rz = [math.radians(a) for a in job.get("rot_deg", [0, 0, 0])]
hi.rotation_mode = "XYZ"  # glTF imports use quaternions
hi.rotation_euler = (rx, ry, rz)
bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)

me = hi.data
bm = bmesh.new(); bm.from_mesh(me)
size0 = max((Vector(v.co) for v in bm.verts), key=lambda c: c.length).length
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=size0 * 1e-6)
# keep the largest connected piece (drops engraved title plates, scan debris); textured scans may opt out
if job.get("keep_largest", ext == ".stl"):
    bm.verts.ensure_lookup_table()
    seen = set(); best = None
    for v in bm.verts:
        if v.index in seen: continue
        comp = []; stack = [v]; seen.add(v.index)
        while stack:
            x = stack.pop(); comp.append(x)
            for e in x.link_edges:
                y = e.other_vert(x)
                if y.index not in seen:
                    seen.add(y.index); stack.append(y)
        if best is None or len(comp) > len(best): best = comp
    keep = set(x.index for x in best)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.index not in keep], context="VERTS")
# crop by height fraction
zs = [v.co.z for v in bm.verts]; zmin, zmax = min(zs), max(zs)
c0, c1 = job.get("crop_z", [0.0, 1.0])
if c0 > 0 or c1 < 1:
    for frac, keep_above in ((c0, True), (c1, False)):
        if (keep_above and frac <= 0) or (not keep_above and frac >= 1): continue
        z = zmin + (zmax - zmin) * frac
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        r = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, z), plane_no=(0, 0, 1), clear_inner=keep_above, clear_outer=not keep_above)
        # close the cut so the bake has a floor
        edges = [e for e in r["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
        if edges:
            try: bmesh.ops.holes_fill(bm, edges=edges, sides=0)
            except Exception as ex: log("hole fill skipped", ex)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
bm.to_mesh(me); bm.free()

# normalise: base centred at the origin, z from 0, height = height_m
co = [hi.matrix_world @ v.co for v in me.vertices]
mn = Vector([min(c[i] for c in co) for i in range(3)]); mx = Vector([max(c[i] for c in co) for i in range(3)])
s = job["height_m"] / (mx.z - mn.z)
me.transform(Matrix.Translation(Vector((-(mn.x + mx.x) / 2, -(mn.y + mx.y) / 2, -mn.z))))
me.transform(Matrix.Scale(s, 4))
if job.get("mirror_x"):
    me.transform(Matrix.Scale(-1, 4, (1, 0, 0))); me.flip_normals()
me.update()
H = job["height_m"]
if job.get("smooth", 0):
    m = hi.modifiers.new("smooth", "LAPLACIANSMOOTH"); m.iterations = job["smooth"]; m.lambda_factor = 0.4; m.use_volume_preserve = True
    bpy.ops.object.modifier_apply(modifier=m.name)
if job.get("cut"):
    # [{"y_gt": 0.28, "z_gt": 0.7}, ...]: drop the vertices inside each box (metres after normalising) -
    # e.g. the scan's own mandorla, replaced by a modelled one; then loose bits below "min_piece_frac" of the vertices go
    bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
    for c in job["cut"]:
        # every key is a bound, all ANDed: x_gt / x_lt / y_gt / y_lt / z_gt / z_lt (metres, after normalising)
        def hit(v, c=c):
            for k, lim in c.items():
                ax = "xyz".index(k[0])
                if k.endswith("_gt") and not v.co[ax] > lim: return False
                if k.endswith("_lt") and not v.co[ax] < lim: return False
            return True
        kill = [v for v in bm.verts if hit(v)]
        bmesh.ops.delete(bm, geom=kill, context="VERTS")
    bm.verts.ensure_lookup_table(); seen = set(); comps = []
    for v in bm.verts:
        if v.index in seen: continue
        comp = []; stack = [v]; seen.add(v.index)
        while stack:
            x = stack.pop(); comp.append(x)
            for e in x.link_edges:
                y = e.other_vert(x)
                if y.index not in seen: seen.add(y.index); stack.append(y)
        comps.append(comp)
    big = max(len(c) for c in comps)
    drop = [v for c in comps if len(c) < big * job.get("min_piece_frac", 0.02) for v in c]
    bmesh.ops.delete(bm, geom=drop, context="VERTS")
    bm.to_mesh(me); bm.free(); me.update()
if job.get("max_edge"):
    # photogrammetry bridges a fold with hair-thin, very long triangles that draw as a light line across the robe: drop faces with an edge
    # longer than this (metres, after normalising); the loose bits that leaves are dropped like the "cut" ones
    bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
    lim = job["max_edge"]
    long_f = [f for f in bm.faces if max(e.calc_length() for e in f.edges) > lim]
    rep["long_faces_dropped"] = len(long_f)
    bmesh.ops.delete(bm, geom=long_f, context="FACES_ONLY")
    bm.to_mesh(me); bm.free(); me.update()
co = [v.co for v in me.vertices]
dims = [max(c[i] for c in co) - min(c[i] for c in co) for i in range(3)]
rep["dims_m"] = [round(d, 3) for d in dims]
rep["high_tris"] = sum(len(p.vertices) - 2 for p in me.polygons)
log("high", rep["high_tris"], "tris dims", rep["dims_m"])
bpy.ops.object.shade_smooth()

# ---------------- low poly (PC) ----------------
lo = hi.copy(); lo.data = hi.data.copy(); lo.name = NAME; sc.collection.objects.link(lo)
for o in sc.objects: o.select_set(False)
bpy.context.view_layer.objects.active = lo; lo.select_set(True)
d = lo.modifiers.new("dec", "DECIMATE"); d.decimate_type = "COLLAPSE"
d.ratio = min(1.0, job["tri_pc"] / max(1, rep["high_tris"])); d.use_collapse_triangulate = True
bpy.ops.object.modifier_apply(modifier="dec")
# UVs: unwrap a heavily smoothed proxy (same topology, calm normals -> few large islands), then copy the UVs back
px_ = lo.copy(); px_.data = lo.data.copy(); sc.collection.objects.link(px_)
for o in sc.objects: o.select_set(False)
bpy.context.view_layer.objects.active = px_; px_.select_set(True)
sm = px_.modifiers.new("sm", "SMOOTH"); sm.factor = 1.0; sm.iterations = job.get("uv_smooth", 40)
bpy.ops.object.modifier_apply(modifier="sm")
bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(job.get("uv_angle", 70)), island_margin=0.006, area_weight=0.0, scale_to_bounds=False)
try: bpy.ops.uv.pack_islands(margin=0.006, rotate=True, shape_method="CONCAVE")
except Exception as ex: log("pack", ex)
bpy.ops.object.mode_set(mode="OBJECT")
if not lo.data.uv_layers: lo.data.uv_layers.new(name="UVMap")
import numpy as _np
_uv = _np.empty(len(px_.data.loops) * 2, _np.float32); px_.data.uv_layers[0].data.foreach_get("uv", _uv)
lo.data.uv_layers[0].data.foreach_set("uv", _uv)
rep["uv_islands_hint"] = len(px_.data.polygons)
bpy.data.objects.remove(px_, do_unlink=True)
for o in sc.objects: o.select_set(False)
bpy.context.view_layer.objects.active = lo; lo.select_set(True)
bpy.ops.object.shade_smooth()
rep["pc_tris"] = sum(len(p.vertices) - 2 for p in lo.data.polygons)
log("pc", rep["pc_tris"])

# ---------------- bake setup ----------------
sc.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
dev = "CPU"
for t in ("OPTIX", "CUDA"):
    try:
        prefs.compute_device_type = t; prefs.get_devices()
        if any(x.type == t for x in prefs.devices):
            for x in prefs.devices: x.use = (x.type == t)
            dev = "GPU"; break
    except Exception: pass
if os.environ.get("CV_CPU") == "1": dev = "CPU"
sc.cycles.device = dev
sc.cycles.samples = 32
log("device", dev, prefs.compute_device_type)

surf = job.get("surface", "marble")
hm = bpy.data.materials.new("surf"); hm.use_nodes = True; nt = hm.node_tree
bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
L = nt.links
tc = nt.nodes.new("ShaderNodeTexCoord")
sep = nt.nodes.new("ShaderNodeSeparateXYZ"); L.new(tc.outputs["Object"], sep.inputs[0])


def noise(scale, detail=6, rough=0.55, dist=0.0, vec=None):
    n = nt.nodes.new("ShaderNodeTexNoise"); n.inputs["Scale"].default_value = scale
    n.inputs["Detail"].default_value = detail; n.inputs["Roughness"].default_value = rough
    n.inputs["Distortion"].default_value = dist
    L.new((vec or tc.outputs["Object"]), n.inputs["Vector"]); return n


def ramp(src, stops):
    r = nt.nodes.new("ShaderNodeValToRGB"); el = r.color_ramp.elements
    el[0].position, el[0].color = stops[0][0], stops[0][1]
    el[1].position, el[1].color = stops[-1][0], stops[-1][1]
    for p, c in stops[1:-1]:
        e = el.new(p); e.color = c
    L.new(src, r.inputs[0]); return r


def mathn(op, a, b=None, val=None):
    m = nt.nodes.new("ShaderNodeMath"); m.operation = op
    (L.new(a, m.inputs[0]) if not isinstance(a, (int, float)) else m.inputs[0].__setattr__("default_value", a))
    if b is not None: (L.new(b, m.inputs[1]) if not isinstance(b, (int, float)) else m.inputs[1].__setattr__("default_value", b))
    return m


geo = nt.nodes.new("ShaderNodeNewGeometry")
cav = ramp(geo.outputs["Pointiness"], [(0.44, (0, 0, 0, 1)), (0.5, (1, 1, 1, 1)), (0.56, (1, 1, 1, 1))])  # 0 in crevices
metal_val = 0.0
if surf == "marble":
    # polished Carrara: warm white, faint grey veining, a little tone variation; crevices a touch warmer/darker
    vein = noise(1.6 / H, 8, 0.6, 3.0)
    w = nt.nodes.new("ShaderNodeTexWave"); w.wave_type = "BANDS"; w.inputs["Scale"].default_value = 0.9 / H
    w.inputs["Distortion"].default_value = 9.0; w.inputs["Detail"].default_value = 6
    L.new(vein.outputs["Color"], w.inputs["Vector"])
    vr = ramp(w.outputs["Fac"], [(0.0, (0.80, 0.80, 0.80, 1)), (0.03, (0.93, 0.93, 0.93, 1)), (1.0, (1, 1, 1, 1))])
    tone = ramp(noise(3.0 / H, 4, 0.5).outputs["Fac"], [(0.3, (0.885, 0.865, 0.83, 1)), (0.7, (0.93, 0.915, 0.885, 1))])
    mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"; mix.blend_type = "MULTIPLY"; mix.inputs["Factor"].default_value = 1.0
    L.new(tone.outputs["Color"], mix.inputs[6]); L.new(vr.outputs["Color"], mix.inputs[7])
    cm = nt.nodes.new("ShaderNodeMix"); cm.data_type = "RGBA"; cm.blend_type = "MIX"
    L.new(cav.outputs["Color"], cm.inputs["Factor"]); cm.inputs[6].default_value = (0.70, 0.66, 0.60, 1); L.new(mix.outputs[2], cm.inputs[7])
    base = cm.outputs[2]
    rr = ramp(noise(6.0 / H, 3).outputs["Fac"], [(0.3, (0.30, 0.30, 0.30, 1)), (0.7, (0.42, 0.42, 0.42, 1))]); rough = rr.outputs["Color"]
elif surf in ("gilt", "bronze"):
    if surf == "gilt":
        hi_c, lo_c = tuple(job.get("gilt_hi", (1.0, 0.75, 0.33))) + (1,), tuple(job.get("gilt_lo", (0.84, 0.55, 0.20))) + (1,)       # burnished 개금 leaf / matte leaf in hollows (warm, not brass)
        r0, r1 = 0.34, 0.52
    else:
        hi_c, lo_c = (0.78, 0.56, 0.36, 1), (0.42, 0.28, 0.16, 1)       # new warm statuary bronze
        r0, r1 = 0.30, 0.50
    var = ramp(noise(14.0 / H, 5, 0.6).outputs["Fac"], [(0.35, lo_c), (0.65, hi_c)])
    cm = nt.nodes.new("ShaderNodeMix"); cm.data_type = "RGBA"; cm.blend_type = "MIX"
    L.new(cav.outputs["Color"], cm.inputs["Factor"]); cm.inputs[6].default_value = lo_c; L.new(var.outputs["Color"], cm.inputs[7])
    base = cm.outputs[2]
    rr = ramp(noise(20.0 / H, 4).outputs["Fac"], [(0.3, (r0, r0, r0, 1)), (0.7, (r1, r1, r1, 1))])
    rcm = nt.nodes.new("ShaderNodeMix"); rcm.data_type = "RGBA"; L.new(cav.outputs["Color"], rcm.inputs["Factor"])
    rcm.inputs[6].default_value = (r1 + 0.1,) * 3 + (1,); L.new(rr.outputs["Color"], rcm.inputs[7]); rough = rcm.outputs[2]
    metal_val = job.get("metal", 0.82)  # < 1: gilt keeps a little diffuse so it reads gold under baked light, not black
    if surf == "gilt" and job.get("hair_above"):
        # lapis-painted hair curls (나발) and the usnisa: z above a line, near the head axis
        hz = job["hair_above"] * H; hr = job.get("hair_radius", 0.16) * H
        hx, hy = job.get("head_xy", [0.0, 0.0])
        zabove = mathn("GREATER_THAN", sep.outputs["Z"], hz)
        dx = mathn("SUBTRACT", sep.outputs["X"], hx); dy = mathn("SUBTRACT", sep.outputs["Y"], hy)
        rr2 = mathn("ADD", mathn("POWER", dx.outputs[0], 2.0).outputs[0], mathn("POWER", dy.outputs[0], 2.0).outputs[0])
        inside = mathn("LESS_THAN", rr2.outputs[0], hr * hr)
        hair = mathn("MULTIPLY", zabove.outputs[0], inside.outputs[0])
        if job.get("hair_face_y") is not None:
            # leave the forehead below the hairline curve gilt: hair starts lower at the back/sides than at the front
            pass
        lap = nt.nodes.new("ShaderNodeMix"); lap.data_type = "RGBA"; L.new(hair.outputs[0], lap.inputs["Factor"])
        L.new(base, lap.inputs[6]); lap.inputs[7].default_value = (0.006, 0.009, 0.022, 1); base = lap.outputs[2]
        hr_r = nt.nodes.new("ShaderNodeMix"); hr_r.data_type = "RGBA"; L.new(hair.outputs[0], hr_r.inputs["Factor"])
        L.new(rough, hr_r.inputs[6]); hr_r.inputs[7].default_value = (0.90, 0.90, 0.90, 1); rough = hr_r.outputs[2]
        mt = mathn("MULTIPLY", mathn("SUBTRACT", 1.0, hair.outputs[0]).outputs[0], metal_val); metal_out = mt.outputs[0]
    else:
        metal_out = None
elif surf == "photo":
    # a photographed (CC0) object projected straight onto its own relief from the front (-Y): u = x across, v = z up
    pim = bpy.data.images.load(os.path.abspath(job["photo"])); pim.colorspace_settings.name = "sRGB"
    pt = nt.nodes.new("ShaderNodeTexImage"); pt.image = pim; pt.extension = "EXTEND"
    Wm = H * job["photo_aspect"]
    u = mathn("ADD", mathn("DIVIDE", sep.outputs["X"], Wm).outputs[0], 0.5)
    v = mathn("DIVIDE", sep.outputs["Z"], H)
    cmb = nt.nodes.new("ShaderNodeCombineXYZ"); L.new(u.outputs[0], cmb.inputs[0]); L.new(v.outputs[0], cmb.inputs[1])
    L.new(cmb.outputs[0], pt.inputs["Vector"])
    # faces that turn away from the camera of the photo (relief sides) get the object's own dark side colour, not streaks
    nsep = nt.nodes.new("ShaderNodeSeparateXYZ"); L.new(geo.outputs["Normal"], nsep.inputs[0])
    facing = mathn("ABSOLUTE", nsep.outputs["Y"])
    fr = ramp(facing.outputs[0], [(0.35, (0, 0, 0, 1)), (0.65, (1, 1, 1, 1))])
    side = nt.nodes.new("ShaderNodeMix"); side.data_type = "RGBA"; L.new(fr.outputs["Color"], side.inputs["Factor"])
    side.inputs[6].default_value = tuple(job.get("side_color", [0.22, 0.13, 0.07])) + (1,); L.new(pt.outputs["Color"], side.inputs[7])
    base = side.outputs[2]
    rr = ramp(noise(30.0 / H, 3).outputs["Fac"], [(0.3, (0.50, 0.50, 0.50, 1)), (0.7, (0.62, 0.62, 0.62, 1))]); rough = rr.outputs["Color"]
else:  # painted_wood: ivory gesso polychrome (fallback single tone)
    base_n = ramp(noise(8.0 / H, 4).outputs["Fac"], [(0.3, (0.80, 0.74, 0.64, 1)), (0.7, (0.86, 0.80, 0.70, 1))]); base = base_n.outputs["Color"]
    rr = ramp(noise(10.0 / H, 3).outputs["Fac"], [(0.3, (0.45, 0.45, 0.45, 1)), (0.7, (0.6, 0.6, 0.6, 1))]); rough = rr.outputs["Color"]

L.new(base, bsdf.inputs["Base Color"])
L.new(rough, bsdf.inputs["Roughness"])
if surf in ("gilt", "bronze") and job.get("hair_above") and surf == "gilt":
    L.new(metal_out, bsdf.inputs["Metallic"])
else:
    bsdf.inputs["Metallic"].default_value = metal_val
if surf != "scan":  # "scan": keep the photogrammetry's own textured materials and bake their colour
    hi.data.materials.clear(); hi.data.materials.append(hm)
else:
    # the DIFFUSE colour pass is base colour x (1 - metallic): make the scan's materials dielectric for the bake.
    # Photogrammetry often comes "unlit" (emission): rebuild such a material as Principled(base colour = its image).
    for m in hi.data.materials:
        if not (m and m.node_tree): continue
        mnt = m.node_tree
        if not any(n.type == "BSDF_PRINCIPLED" for n in mnt.nodes):
            tex_n = next((n for n in mnt.nodes if n.type == "TEX_IMAGE"), None)
            out_n = next((n for n in mnt.nodes if n.type == "OUTPUT_MATERIAL"), None)
            pb = mnt.nodes.new("ShaderNodeBsdfPrincipled")
            if tex_n: mnt.links.new(tex_n.outputs["Color"], pb.inputs["Base Color"])
            if out_n:
                for l in list(out_n.inputs["Surface"].links): mnt.links.remove(l)
                mnt.links.new(pb.outputs[0], out_n.inputs["Surface"])
            log("rebuilt unlit material", m.name)
        for n in m.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED":
                for l in list(n.inputs["Metallic"].links): m.node_tree.links.remove(l)
                n.inputs["Metallic"].default_value = 0.0

# separate maps baked into 3 images on the low poly
lm = bpy.data.materials.new(NAME + "_mat"); lm.use_nodes = True; lnt = lm.node_tree
lo.data.materials.clear(); lo.data.materials.append(lm)
imgs = {}


def img(kind, size, srgb):
    im = bpy.data.images.new(f"{NAME}_{kind}", size, size, alpha=False, float_buffer=False)
    im.colorspace_settings.name = "sRGB" if srgb else "Non-Color"
    n = lnt.nodes.new("ShaderNodeTexImage"); n.image = im; n.name = kind
    imgs[kind] = (im, n); return im


tex = job.get("tex", {"normal": 2048, "albedo": 1024, "orm": 1024})
img("normal", tex["normal"], False); img("albedo", tex["albedo"], True)
img("ao", tex["orm"], False); img("rough", tex["orm"], False); img("metal", tex["orm"], False)

for o in sc.objects: o.select_set(False)
hi.select_set(True); lo.select_set(True); bpy.context.view_layer.objects.active = lo
bk = sc.render.bake
bk.use_selected_to_active = True
bk.cage_extrusion = job.get('cage', 0.008) * H
bk.max_ray_distance = job.get('ray', 0.016) * H
bk.margin = 24
try: bk.margin_type = 'EXTEND'
except Exception: pass
bk.use_clear = True


def bake(kind, btype, **kw):
    for k, (im, n) in imgs.items(): n.select = False
    imgs[kind][1].select = True; lnt.nodes.active = imgs[kind][1]
    tb = time.time()
    bpy.ops.object.bake(type=btype, **kw)
    log("baked", kind, f"{time.time() - tb:.0f}s")


bake("normal", "NORMAL", normal_space="TANGENT")
sc.cycles.samples = 64
bake("ao", "AO")
sc.cycles.samples = 8
bk.use_pass_direct = False; bk.use_pass_indirect = False; bk.use_pass_color = True
bake("albedo", "DIFFUSE", pass_filter={"COLOR"})

import numpy as np


def _box(a, k):
    """mean filter (k x k) on an H x W x C array, edge-clamped, via summed-area table"""
    pad = k // 2
    b = np.pad(a, ((pad + 1, pad), (pad + 1, pad), (0, 0)), mode="edge").astype(np.float64)
    c = b.cumsum(0).cumsum(1)
    return ((c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)).astype(np.float32)


if surf == "scan" and job.get("clean", True):
    # "brand-new" (owner 2026-11-17 "새것 같아야 해"): pull dark grime, cracks and chips up to the local colour, lift the paint
    asz = tex["albedo"]
    A = np.empty(asz * asz * 4, np.float32); imgs["albedo"][0].pixels.foreach_get(A); A = A.reshape(asz, asz, 4)
    rgb = A[..., :3]
    loc = _box(rgb, job.get("clean_window", 21))
    lum = rgb.mean(2, keepdims=True); llum = loc.mean(2, keepdims=True)
    dark = np.clip((llum * job.get("clean_dark", 0.78) - lum) / np.maximum(llum * 0.25, 1e-3), 0, 1)
    rgb = rgb * (1 - dark) + loc * dark
    grey = rgb.mean(2, keepdims=True)
    rgb = grey + (rgb - grey) * job.get("fresh_sat", 1.15)
    rgb = np.clip(rgb * job.get("fresh_gain", 1.08), 0, 1)
    A[..., :3] = rgb; imgs["albedo"][0].pixels.foreach_set(A.ravel())
    rep["cleaned_pct"] = round(100 * float((dark > 0.5).mean()), 2)
if surf == "scan" and job.get("regions"):
    # region masks baked from object position (e.g. the oak cross behind the corpus), then recoloured fresh
    asz = tex["albedo"]
    saved = [m for m in hi.data.materials]
    for reg in job["regions"]:
        mm = bpy.data.materials.new("mask"); mm.use_nodes = True; mt_ = mm.node_tree
        for n in list(mt_.nodes):
            if n.type != "OUTPUT_MATERIAL": mt_.nodes.remove(n)
        tc2 = mt_.nodes.new("ShaderNodeTexCoord"); sp2 = mt_.nodes.new("ShaderNodeSeparateXYZ"); mt_.links.new(tc2.outputs["Object"], sp2.inputs[0])
        # box in fractions of the height: {"x": [lo, hi], "y": [lo, hi], "z": [lo, hi]} (missing axis = unbounded)
        acc = None
        for ax in ("x", "y", "z"):
            if ax not in reg: continue
            lo_, hi_ = reg[ax]
            g1 = mt_.nodes.new("ShaderNodeMath"); g1.operation = "GREATER_THAN"; mt_.links.new(sp2.outputs[ax.upper()], g1.inputs[0]); g1.inputs[1].default_value = lo_ * H
            g2 = mt_.nodes.new("ShaderNodeMath"); g2.operation = "LESS_THAN"; mt_.links.new(sp2.outputs[ax.upper()], g2.inputs[0]); g2.inputs[1].default_value = hi_ * H
            m2 = mt_.nodes.new("ShaderNodeMath"); m2.operation = "MULTIPLY"; mt_.links.new(g1.outputs[0], m2.inputs[0]); mt_.links.new(g2.outputs[0], m2.inputs[1])
            if acc is not None:
                m3 = mt_.nodes.new("ShaderNodeMath"); m3.operation = "MULTIPLY"; mt_.links.new(acc, m3.inputs[0]); mt_.links.new(m2.outputs[0], m3.inputs[1]); acc = m3.outputs[0]
            else:
                acc = m2.outputs[0]
        em2 = mt_.nodes.new("ShaderNodeEmission"); mt_.links.new(acc, em2.inputs["Color"])
        mt_.links.new(em2.outputs[0], next(n for n in mt_.nodes if n.type == "OUTPUT_MATERIAL").inputs["Surface"])
        for i in range(len(hi.data.materials)): hi.data.materials[i] = mm
        img("mask_" + reg["name"], asz, False)
        bake("mask_" + reg["name"], "EMIT")
        for i, m in enumerate(saved): hi.data.materials[i] = m
    A = np.empty(asz * asz * 4, np.float32); imgs["albedo"][0].pixels.foreach_get(A); A = A.reshape(asz, asz, 4)
    for reg in job["regions"]:
        M = np.empty(asz * asz * 4, np.float32); imgs["mask_" + reg["name"]][0].pixels.foreach_get(M); M = M.reshape(asz, asz, 4)[..., :1]
        lum = A[..., :3].mean(2, keepdims=True); detail = lum / np.maximum(_box(lum, 31), 1e-3)
        fresh = np.array(reg["color"], np.float32)[None, None, :] * (1 + (detail - 1) * reg.get("keep_detail", 0.5))
        A[..., :3] = A[..., :3] * (1 - M) + np.clip(fresh, 0, 1) * M
    imgs["albedo"][0].pixels.foreach_set(A.ravel())
if surf != "scan":
    bake("rough", "ROUGHNESS")
    # metallic: route the metal value through emission for a bake
    em = nt.nodes.new("ShaderNodeEmission"); mo = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    old = mo.inputs["Surface"].links[0].from_socket
    if surf == "gilt" and job.get("hair_above"):
        L.new(metal_out, em.inputs["Color"])
    else:
        em.inputs["Color"].default_value = (metal_val,) * 3 + (1,)
    L.new(em.outputs[0], mo.inputs["Surface"])
    bake("metal", "EMIT")
    L.new(old, mo.inputs["Surface"])

# pack ORM (R = AO, G = roughness, B = metallic)
size = tex["orm"]


def px(im):
    a = np.empty(im.size[0] * im.size[1] * 4, np.float32); im.pixels.foreach_get(a); return a.reshape(-1, 4)


ao = px(imgs["ao"][0])
if surf == "scan":
    # roughness / metal from the scan's own colour: gold leaf (warm, saturated, bright) reads as metal, the rest as
    # painted wood / stone. Albedo is sampled down to the ORM size.
    A = px(imgs["albedo"][0]); asz = tex["albedo"]; k = max(1, asz // size)
    A = A.reshape(asz, asz, 4)[::k, ::k].reshape(-1, 4)
    r_, g_, b_ = A[:, 0], A[:, 1], A[:, 2]
    mx_ = np.maximum(np.maximum(r_, g_), b_); mn_ = np.minimum(np.minimum(r_, g_), b_)
    sat = (mx_ - mn_) / np.maximum(mx_, 1e-4)
    warm = (r_ >= g_) & (g_ >= b_) & ((g_ - b_) / np.maximum(r_ - b_, 1e-4) > 0.3)
    gold = np.clip((sat - 0.30) / 0.2, 0, 1) * np.clip((mx_ - 0.12) / 0.15, 0, 1) * warm * job.get("scan_gold", 1.0)
    base_r = job.get("scan_rough", 0.6)
    ro = np.repeat((base_r * (1 - gold) + 0.36 * gold)[:, None], 4, 1)
    mt = np.repeat((job.get("scan_gold_metal", 0.75) * gold)[:, None], 4, 1)
    rep["gold_pct"] = round(100 * float((gold > 0.5).mean()), 1)
else:
    ro, mt = px(imgs["rough"][0]), px(imgs["metal"][0])
orm = bpy.data.images.new(f"{NAME}_orm", size, size, alpha=False); orm.colorspace_settings.name = "Non-Color"
o4 = np.ones((size * size, 4), np.float32)
o4[:, 0] = np.clip(0.25 + 0.75 * ao[:, 0], 0, 1)   # keep crevices from going black under the game's own AO/lightmap
o4[:, 1] = ro[:, 0]; o4[:, 2] = mt[:, 0]
orm.pixels.foreach_set(o4.ravel())
rep["metal_mean"] = float(mt[:, 0].mean()); rep["ao_mean"] = float(ao[:, 0].mean())

# normal clean-up: texels whose tangent normal tips past ~70 deg are ray misses into undercuts -> flatten them
nrm = px(imgs["normal"][0]); nz = nrm[:, 2] * 2 - 1
bad = nz < 0.35
nrm[bad, 0] = 0.5; nrm[bad, 1] = 0.5; nrm[bad, 2] = 1.0
imgs["normal"][0].pixels.foreach_set(nrm.ravel()); rep["normal_fixed_pct"] = round(100 * float(bad.mean()), 2)
for kind, im in (("albedo", imgs["albedo"][0]), ("normal", imgs["normal"][0]), ("orm", orm)):
    im.filepath_raw = os.path.join(OUT, f"{NAME}_{kind}.png"); im.file_format = "PNG"; im.save()

# final game material
for n in list(lnt.nodes):
    if n.type != "OUTPUT_MATERIAL": lnt.nodes.remove(n)
P = lnt.nodes.new("ShaderNodeBsdfPrincipled"); LL = lnt.links
LL.new(P.outputs[0], next(n for n in lnt.nodes if n.type == "OUTPUT_MATERIAL").inputs["Surface"])


def load(kind, srgb):
    im = bpy.data.images.load(os.path.join(OUT, f"{NAME}_{kind}.png")); im.colorspace_settings.name = "sRGB" if srgb else "Non-Color"
    n = lnt.nodes.new("ShaderNodeTexImage"); n.image = im; return n


a = load("albedo", True); LL.new(a.outputs["Color"], P.inputs["Base Color"])
nm = load("normal", False); nmap = lnt.nodes.new("ShaderNodeNormalMap"); LL.new(nm.outputs["Color"], nmap.inputs["Color"]); LL.new(nmap.outputs[0], P.inputs["Normal"])
om = load("orm", False); sp = lnt.nodes.new("ShaderNodeSeparateColor"); LL.new(om.outputs["Color"], sp.inputs[0])
LL.new(sp.outputs[1], P.inputs["Roughness"]); LL.new(sp.outputs[2], P.inputs["Metallic"])
# glTF exporter picks up occlusion from a "glTF Material Output" group's Occlusion socket
grp = bpy.data.node_groups.get("glTF Material Output")
if grp is None:
    grp = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
    grp.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
gn = lnt.nodes.new("ShaderNodeGroup"); gn.node_tree = grp; LL.new(sp.outputs[0], gn.inputs["Occlusion"])

# ---------------- phone LOD (UVs preserved, shares the textures) ----------------
ph = lo.copy(); ph.data = lo.data.copy(); ph.name = NAME + "_phone"; sc.collection.objects.link(ph)
for o in sc.objects: o.select_set(False)
bpy.context.view_layer.objects.active = ph; ph.select_set(True)
d = ph.modifiers.new("dec", "DECIMATE"); d.decimate_type = "COLLAPSE"; d.ratio = job["tri_phone"] / max(1, rep["pc_tris"])
d.use_collapse_triangulate = True; d.delimit = {"UV"}
bpy.ops.object.modifier_apply(modifier="dec")
rep["phone_tris"] = sum(len(p.vertices) - 2 for p in ph.data.polygons)
log("phone", rep["phone_tris"])

# ---------------- export ----------------
bpy.data.objects.remove(hi, do_unlink=True)
for o in sc.objects: o.select_set(o.name in (NAME, NAME + "_phone"))
glb = os.path.join(OUT, f"{NAME}.glb")
bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
                          export_image_format="AUTO", export_tangents=False, export_normals=True, export_texcoords=True,
                          export_materials="EXPORT", export_extras=False)
rep["glb_bytes"] = os.path.getsize(glb); rep["seconds"] = round(time.time() - t0)
json.dump(rep, open(os.path.join(OUT, "report.json"), "w"), indent=1)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, f"{NAME}.blend"))
log("done", json.dumps(rep))
