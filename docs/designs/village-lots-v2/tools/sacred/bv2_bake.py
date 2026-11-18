# 본존불 v2, stage C — the sculpt (bv2_sculpt.py) onto a new lotus throne, scaled to the hall's 본존불 anchor, baked to a game mesh:
#   figure: cut flat at the seat, scaled so seat -> 육계 top is FIG_H; the head sits where the 광배 expects it (HEAD_Y behind the
#   throne centre). Throne (직접 모델링): 하대석 drum with a ring of downturned petals (복련), 중대석 drum with pilasters, 상대석 bowl with two
#   rows of upturned double petals (앙련), a beaded rim. A fan of robe pleats falls over the front of the seat (상현좌의 옷자락).
#   Low poly = decimated high (PC ~TRI_PC, phone ~TRI_PHONE, same UVs), bakes: normal (tangent), AO, albedo, + roughness/metal from the
#   material masks (gilt / lapis-black hair) -> <out>/<NAME>_{albedo,normal,orm}.png and <out>/<NAME>.glb (both LOD nodes).
#   blender -b b_hi.blend -P bv2_bake.py -- <out_dir> [normal=4096] [albedo=2048] [orm=1024]
import bpy, bmesh, sys, os, math, time, json
import numpy as np
from mathutils import Vector, Matrix

t0 = time.time()
A = sys.argv[sys.argv.index("--") + 1:]
OUT = os.path.abspath(A[0]); os.makedirs(OUT, exist_ok=True)
TN = int(A[1]) if len(A) > 1 else 4096
TA = int(A[2]) if len(A) > 2 else 2048
TO = int(A[3]) if len(A) > 3 else 1024
NAME = "lotstatue__lot_temple_hall_buddha"
TRI_PC, TRI_PHONE = 40000, 10000
SEAT_BASE = 0.80        # the seat plane in the sculpt's own units (below: the knees' undersides, the fingertips' last cm)
FIG_H = 1.40            # seat -> top of the 육계 (m)
THRONE_H = 0.60         # floor -> seat (m)
HEAD_Y = 0.14           # the head axis this far behind the origin (the 광배 plate's frame)
TY = 0.86               # the throne is a little oval (deep as the crossed legs, not as wide as the knees)
sc = bpy.context.scene
rep = {"name": NAME}


def log(*a):
    print("BV2C", round(time.time() - t0, 1), *a, flush=True)


def sel_only(objs, active=None):
    for o in sc.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


for o in list(sc.objects):
    if o.name not in ("statue_hi", "curls"): bpy.data.objects.remove(o, do_unlink=True)
fig = bpy.data.objects["statue_hi"]; curls = bpy.data.objects["curls"]
gilt = bpy.data.materials["M_gilt"]; hairm = bpy.data.materials["M_hair"]

# ---------------- cut at the seat, scale and place ----------------
bm = bmesh.new(); bm.from_mesh(fig.data)
bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, SEAT_BASE), plane_no=(0, 0, 1), clear_inner=True)
bm.to_mesh(fig.data); bm.free()
co = np.empty(len(fig.data.vertices) * 3); fig.data.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
cc = np.empty(len(curls.data.vertices) * 3); curls.data.vertices.foreach_get("co", cc); cc = cc.reshape(-1, 3)
top = max(co[:, 2].max(), cc[:, 2].max())
S = FIG_H / (top - SEAT_BASE)
# head axis: the hair verts' centre (x, y)
hair = np.load(os.path.join(os.path.dirname(bpy.data.filepath), "b_hi_hair.npy")) if os.path.exists(os.path.join(os.path.dirname(bpy.data.filepath), "b_hi_hair.npy")) else None
head_xy = cc[:, :2].mean(0)
M = Matrix.Translation((-head_xy[0] * S, HEAD_Y - head_xy[1] * S, THRONE_H - SEAT_BASE * S)) @ Matrix.Scale(S, 4)
for o in (fig, curls): o.data.transform(M)
co = np.empty(len(fig.data.vertices) * 3); fig.data.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
cc = np.empty(len(curls.data.vertices) * 3); curls.data.vertices.foreach_get("co", cc); cc = cc.reshape(-1, 3)
rep["scale"] = round(S, 4)
hz = cc[:, 2]
rep["head"] = {"x": 0.0, "y": HEAD_Y, "top": round(float(hz.max()), 3), "hairline": round(float(np.percentile(hz, 3)), 3)}
lap_front = float(co[co[:, 2] < THRONE_H + 0.2, 1].min())
lap_back = float(co[:, 1].max()); half_w = float(np.abs(co[:, 0]).max())
rep["figure"] = {"half_width": round(half_w, 3), "front_y": round(lap_front, 3), "back_y": round(lap_back, 3)}
log("figure", rep)

# ---------------- the lotus throne ----------------
parts = []


def mesh_obj(name, verts, faces, mat=gilt, smooth=True):
    me = bpy.data.meshes.new(name); me.from_pydata(verts, [], faces); me.update(); me.materials.append(mat)
    o = bpy.data.objects.new(name, me); sc.collection.objects.link(o)
    if smooth: me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    parts.append(o); return o


def lathe(name, prof, seg=96, mat=gilt, ngon=0):
    """a solid of revolution from (r, z) pairs (bottom -> top), capped; ngon > 0 makes it an n-sided (octagonal) drum"""
    verts, faces = [], []
    for i in range(seg):
        t = 2 * math.pi * i / seg
        k = 1.0
        if ngon:
            a = (t + math.pi / ngon) % (2 * math.pi / ngon) - math.pi / ngon
            k = math.cos(math.pi / ngon) / math.cos(a)
        for r, z in prof: verts.append((r * k * math.cos(t), r * k * math.sin(t), z))
    n = len(prof)
    for i in range(seg):
        j = (i + 1) % seg
        for k_ in range(n - 1): faces.append((i * n + k_, j * n + k_, j * n + k_ + 1, i * n + k_ + 1))
    verts.append((0, 0, prof[0][1])); verts.append((0, 0, prof[-1][1])); c0, c1 = len(verts) - 2, len(verts) - 1
    for i in range(seg):
        j = (i + 1) % seg
        faces.append((j * n, i * n, c0)); faces.append((i * n + n - 1, j * n + n - 1, c1))
    return mesh_obj(name, verts, faces, mat, smooth=False)


def bev(o, w=0.006, seg=2, ang=35):
    sel_only([o]); m = o.modifiers.new("b", "BEVEL"); m.width = w; m.segments = seg; m.limit_method = "ANGLE"; m.angle_limit = math.radians(ang)
    bpy.ops.object.modifier_apply(modifier=m.name)
    ws = o.modifiers.new("wn", "WEIGHTED_NORMAL"); ws.keep_sharp = True; bpy.ops.object.modifier_apply(modifier=ws.name)


Z0, Z1, Z2, Z3 = 0.0, 0.13, 0.25, 0.36       # floor, top of the 하대석 drum, top of the 복련 band, top of the 중대석
# 하대석: an octagonal plinth with a step and a moulding
o = lathe("hadae", [(0.70, 0.0), (0.70, 0.05), (0.68, 0.06), (0.68, 0.10), (0.64, 0.115), (0.62, Z1)], seg=64, ngon=8); bev(o, 0.008)
# 복련 band core
o = lathe("bokryeon_core", [(0.60, Z1), (0.60, Z1 + 0.02), (0.50, Z2 - 0.01), (0.44, Z2)], seg=96)
# 중대석: a drum with a moulding top and bottom
o = lathe("jungdae", [(0.46, Z2), (0.46, Z2 + 0.018), (0.40, Z2 + 0.03), (0.40, Z3 - 0.03), (0.46, Z3 - 0.018), (0.48, Z3)], seg=96); bev(o, 0.004)
# 상대석 bowl: flares from the drum to the seat, the petals sit on its outside
o = lathe("sangdae_bowl", [(0.44, Z3), (0.50, Z3 + 0.06), (0.62, Z3 + 0.15), (0.70, THRONE_H - 0.035), (0.72, THRONE_H - 0.02), (0.72, THRONE_H)], seg=128); bev(o, 0.004)


def petal(width, length, thick, n_u=12, n_v=16, up=True, inner=True, tip_curl=0.25):
    """one lotus petal in its own frame: base at the origin, length along +Z, bulging toward +Y (outward); returns verts, faces"""
    vs, fs = [], []
    for j in range(n_v + 1):
        v = j / n_v
        w = width * 0.5 * (math.sin(math.pi * min(1.0, v * 0.92 + 0.06)) ** 0.85) * (1 - 0.25 * v)
        if v > 0.8: w *= 1 - ((v - 0.8) / 0.2) ** 1.5 * 0.92
        for i in range(n_u + 1):
            u = -1 + 2 * i / n_u
            x = u * w
            b = thick * math.sqrt(max(0.0, 1 - u * u)) * (0.35 + 0.65 * math.sin(math.pi * min(1.0, v * 1.05)))
            if inner:      # the double petal: an inner petal raised inside the outer one
                wi = 0.55 * w; vi = (v - 0.12) / 0.72
                if 0 < vi < 1 and abs(x) < wi * math.sin(math.pi * vi) ** 0.8:
                    b += thick * 0.45 * math.sqrt(max(0.0, 1 - (x / max(1e-5, wi * math.sin(math.pi * vi) ** 0.8)) ** 2))
            b += thick * 0.15 * math.exp(-(u / 0.12) ** 2) * v          # the mid-rib
            y = b + tip_curl * thick * 4 * max(0.0, v - 0.75) ** 2 * 16 * 0.25
            vs.append((x, y, v * length))
    for j in range(n_v):
        for i in range(n_u):
            a = j * (n_u + 1) + i
            fs.append((a, a + 1, a + n_u + 2, a + n_u + 1))
    return vs, fs


def ring_of_petals(name, count, r_base, z_base, tilt_deg, width, length, thick, phase=0.0, up=True, sink=0.01):
    allv, allf = [], []
    pv, pf = petal(width, length, thick, up=up)
    for k in range(count):
        t = 2 * math.pi * (k + phase) / count
        # petal frame: outward = radial, length = up (or down) tilted outward
        rad = Vector((math.cos(t), math.sin(t), 0)); tan = Vector((-math.sin(t), math.cos(t), 0))
        tl = math.radians(tilt_deg)
        L_ = (Vector((0, 0, 1)) * math.cos(tl) + rad * math.sin(tl)) * (1 if up else -1)
        L_.normalize()
        N_ = rad - L_ * rad.dot(L_); N_.normalize()
        X_ = tan
        base = Vector((r_base * math.cos(t), r_base * math.sin(t), z_base)) - N_ * sink
        b0 = len(allv)
        for (x, y, z) in pv: allv.append(tuple(base + X_ * x + N_ * y + L_ * z))
        allf += [tuple(b0 + i for i in f) for f in pf]
    o = mesh_obj(name, allv, allf)
    sel_only([o]); m = o.modifiers.new("s", "SOLIDIFY"); m.thickness = 0.006; m.offset = -1; bpy.ops.object.modifier_apply(modifier="s")
    return o


# 앙련 (upturned): a lower row and an upper row offset by half a petal
ring_of_petals("anglyeon_lo", 20, 0.47, Z3 + 0.015, 58, 0.205, 0.20, 0.016)
ring_of_petals("anglyeon_hi", 20, 0.58, Z3 + 0.09, 40, 0.20, 0.17, 0.016, phase=0.5)
# 복련 (downturned): one row round the lower band
ring_of_petals("bokryeon", 18, 0.47, Z2 - 0.005, 62, 0.22, 0.17, 0.016, up=False, sink=0.004)
# 중대석 pilasters
pil = []
for k in range(8):
    t = 2 * math.pi * (k + 0.5) / 8
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0.405 * math.cos(t), 0.405 * math.sin(t), (Z2 + Z3) / 2))
    o = bpy.context.active_object; o.scale = (0.035, 0.05, Z3 - Z2 - 0.05); o.rotation_euler = (0, 0, t)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True); o.data.materials.append(gilt); bev(o, 0.005); parts.append(o)
# a beaded rim under the seat edge
bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=0.011)
bead = bpy.context.active_object
bv = [Vector(v.co) for v in bead.data.vertices]; bf = [tuple(p.vertices) for p in bead.data.polygons]
bpy.data.objects.remove(bead, do_unlink=True)
allv, allf = [], []
nb = 150
for k in range(nb):
    t = 2 * math.pi * k / nb; c = Vector((0.722 * math.cos(t), 0.722 * math.sin(t), THRONE_H - 0.03))
    b0 = len(allv); allv += [tuple(c + q) for q in bv]; allf += [tuple(b0 + i for i in f) for f in bf]
mesh_obj("beads", allv, allf)

# ---------------- the robe falling over the front of the seat (fan of pleats) ----------------
fan_v, fan_f = [], []
NU, NV = 90, 14
TH0, TH1 = math.radians(-90 - 22), math.radians(-90 + 22)
r_in = 0.50
for j in range(NV + 1):
    s_ = j / NV        # 0 at the lap, 1 at the hem below the seat edge
    for i in range(NU + 1):
        u = i / NU; th = TH0 + (TH1 - TH0) * u
        pleat = math.sin(u * math.pi * 9) * 0.010 * (0.2 + 0.8 * s_)
        spread = 1 + 0.12 * s_
        if s_ < 0.5:     # across the top of the seat to its rim
            r = r_in + (0.735 - r_in) * (s_ / 0.5); z = THRONE_H + 0.002 + 0.012 * (1 - s_ / 0.5) ** 2
        else:            # down over the rim
            r = 0.735 + 0.012 * math.sin((s_ - 0.5) / 0.5 * math.pi / 2); z = THRONE_H - 0.085 * ((s_ - 0.5) / 0.5) ** 1.1
        edge = math.sin(math.pi * u) ** 0.35
        z_hem = z + (1 - edge) * 0.05 * s_
        r += pleat
        thc = -math.pi / 2 + (th + math.pi / 2) * spread
        fan_v.append((r * math.cos(thc), r * math.sin(thc), z_hem))
for j in range(NV):
    for i in range(NU):
        a = j * (NU + 1) + i
        fan_f.append((a, a + NU + 1, a + NU + 2, a + 1))
fan = mesh_obj("fan", fan_v, fan_f) if os.environ.get("BV2_FAN") else None
if fan:
    sel_only([fan]); m = fan.modifiers.new("s", "SOLIDIFY"); m.thickness = 0.005; m.offset = 1; bpy.ops.object.modifier_apply(modifier="s")
    m = fan.modifiers.new("ss", "SUBSURF"); m.levels = 1; bpy.ops.object.modifier_apply(modifier="ss")

# ---------------- high poly: figure + curls + throne (+ fan) ----------------
sel_only(parts, parts[0]); bpy.ops.object.join(); throne = bpy.context.active_object; throne.name = "throne_hi"
throne_cy = (lap_front + lap_back) / 2
throne.data.transform(Matrix.Translation((0, throne_cy, 0)) @ Matrix.Diagonal((1, TY, 1, 1)))
rep["throne"] = {"centre_y": round(throne_cy, 3), "rx": 0.72, "ry": round(0.72 * TY, 3)}
log("throne tris", sum(len(p.vertices) - 2 for p in throne.data.polygons))
hi_objs = [fig, curls, throne]
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "c_scene.blend"))

# ---------------- low poly ----------------
def tris(o): return sum(len(p.vertices) - 2 for p in o.data.polygons)


def decimated(src, name, target):
    o = src.copy(); o.data = src.data.copy(); o.name = name; sc.collection.objects.link(o)
    sel_only([o]); d = o.modifiers.new("dec", "DECIMATE"); d.decimate_type = "COLLAPSE"; d.ratio = min(1.0, target / max(1, tris(src))); d.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier="dec"); return o


# the figure gets most of the budget, then the throne; the curls are baked onto the scalp (no geometry of their own)
lo_fig = decimated(fig, "lo_fig", int(TRI_PC * 0.74))
lo_thr = decimated(throne, "lo_thr", int(TRI_PC * 0.26))
sel_only([lo_fig, lo_thr], lo_fig); bpy.ops.object.join(); lo = bpy.context.active_object; lo.name = NAME
rep["pc_tris"] = tris(lo); log("lo", rep["pc_tris"])
# UVs: unwrap a smoothed proxy (calm normals -> large islands), copy back
px_ = lo.copy(); px_.data = lo.data.copy(); sc.collection.objects.link(px_)
sel_only([px_]); sm = px_.modifiers.new("sm", "SMOOTH"); sm.factor = 1.0; sm.iterations = 30; bpy.ops.object.modifier_apply(modifier="sm")
bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004, area_weight=0.0, scale_to_bounds=False)
try: bpy.ops.uv.pack_islands(margin=0.004, rotate=True, shape_method="CONCAVE")
except Exception as ex: log("pack", ex)
bpy.ops.object.mode_set(mode="OBJECT")
uv = np.empty(len(px_.data.loops) * 2, np.float32); px_.data.uv_layers[0].data.foreach_get("uv", uv)
if not lo.data.uv_layers: lo.data.uv_layers.new(name="UVMap")
lo.data.uv_layers[0].data.foreach_set("uv", uv)
lo.data.uv_layers.active = lo.data.uv_layers[0]; lo.data.uv_layers[0].active_render = True
bpy.data.objects.remove(px_, do_unlink=True)
sel_only([lo]); bpy.ops.object.shade_smooth()

# ---------------- bake ----------------
sc.render.engine = "CYCLES"; sc.cycles.device = "CPU"; sc.cycles.samples = 16
lm = bpy.data.materials.new(NAME + "_gilt"); lm.use_nodes = True; lnt = lm.node_tree
lo.data.materials.clear(); lo.data.materials.append(lm)
imgs = {}


def img(kind, size, srgb):
    im = bpy.data.images.new(f"{NAME}_{kind}", size, size, alpha=False, float_buffer=False)
    im.colorspace_settings.name = "sRGB" if srgb else "Non-Color"
    n = lnt.nodes.new("ShaderNodeTexImage"); n.image = im; n.name = kind; imgs[kind] = (im, n); return im


img("normal", TN, False); img("albedo", TA, True); img("ao", TO, False); img("mask", TO, False)
sel_only(hi_objs + [lo], lo)
bk = sc.render.bake; bk.use_selected_to_active = True; bk.cage_extrusion = 0.012; bk.max_ray_distance = 0.03; bk.margin = 16
try: bk.margin_type = "EXTEND"
except Exception: pass


def bake(kind, btype, **kw):
    for k, (im, n) in imgs.items(): n.select = False
    imgs[kind][1].select = True; lnt.nodes.active = imgs[kind][1]
    tb = time.time(); bpy.ops.object.bake(type=btype, **kw); log("baked", kind, f"{time.time() - tb:.0f}s")


bake("normal", "NORMAL", normal_space="TANGENT")
sc.cycles.samples = 48
bake("ao", "AO")
bk.use_pass_direct = False; bk.use_pass_indirect = False; bk.use_pass_color = True
sc.cycles.samples = 4
# (the diffuse colour of a metal is base x (1 - metallic): bake the colour with the metal off)
for m_ in (gilt, hairm):
    next(n for n in m_.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Metallic"].default_value = 0.0
bake("albedo", "DIFFUSE", pass_filter={"COLOR"})
# material mask (1 = hair): emission bake of the high poly's materials
saved = {}
for m_, val in ((gilt, 0.0), (hairm, 1.0)):
    nt = m_.node_tree; out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    saved[m_.name] = out.inputs["Surface"].links[0].from_socket
    em = nt.nodes.new("ShaderNodeEmission"); em.inputs["Color"].default_value = (val, val, val, 1); nt.links.new(em.outputs[0], out.inputs["Surface"])
bake("mask", "EMIT")


def px(im):
    a = np.empty(im.size[0] * im.size[1] * 4, np.float32); im.pixels.foreach_get(a); return a.reshape(im.size[1], im.size[0], 4)


ao = px(imgs["ao"][0])[..., 0]; mk = px(imgs["mask"][0])[..., 0]
orm = np.ones((TO, TO, 4), np.float32)
orm[..., 0] = np.clip(0.30 + 0.70 * ao, 0, 1)
orm[..., 1] = 0.30 * (1 - mk) + 0.72 * mk
orm[..., 2] = 0.90 * (1 - mk)
oi = bpy.data.images.new(f"{NAME}_orm", TO, TO, alpha=False); oi.colorspace_settings.name = "Non-Color"; oi.pixels.foreach_set(orm.ravel())
# albedo: the AO in the folds (gold leaf reads darker in a crease even under an even light)
al = px(imgs["albedo"][0])
aoA = np.array(bpy.data.images[f"{NAME}_ao"].pixels[:], np.float32).reshape(TO, TO, 4)[..., 0]
k = TA // TO
aoU = np.repeat(np.repeat(aoA, k, 0), k, 1)
# (in the hall's flat light the plain leaf read pale and plastic next to the scan's photographed gilt: a deeper, warmer leaf and
# real depth in the folds — the scan's albedo had p10 ~70/255, ours had ~180)
mkU = np.repeat(np.repeat(mk, k, 0), k, 1)
tint = np.array([0.97, 0.90, 0.76], np.float32)
al[..., :3] *= (0.45 + 0.55 * aoU)[..., None] * (tint * (1 - mkU[..., None]) + mkU[..., None])
imgs["albedo"][0].pixels.foreach_set(al.ravel())
rep["metal_mean"] = float(orm[..., 2].mean()); rep["hair_pct"] = round(100 * float((mk > 0.5).mean()), 2)
# normal: flatten ray misses
nrm = px(imgs["normal"][0]); bad = (nrm[..., 2] * 2 - 1) < 0.30; nrm[bad] = (0.5, 0.5, 1.0, 1.0); imgs["normal"][0].pixels.foreach_set(nrm.ravel())
rep["normal_fixed_pct"] = round(100 * float(bad.mean()), 2)
for kind, im in (("albedo", imgs["albedo"][0]), ("normal", imgs["normal"][0]), ("orm", oi), ("ao", imgs["ao"][0])):
    im.filepath_raw = os.path.join(OUT, f"{NAME}_{kind}.png"); im.file_format = "PNG"
    im.save()
for m_ in (gilt, hairm):
    nt = m_.node_tree; out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"); nt.links.new(saved[m_.name], out.inputs["Surface"])

# ---------------- the game material ----------------
for n in list(lnt.nodes):
    if n.type != "OUTPUT_MATERIAL": lnt.nodes.remove(n)
P = lnt.nodes.new("ShaderNodeBsdfPrincipled"); LL = lnt.links
LL.new(P.outputs[0], next(n for n in lnt.nodes if n.type == "OUTPUT_MATERIAL").inputs["Surface"])


def load(kind, srgb):
    im = bpy.data.images.load(os.path.join(OUT, f"{NAME}_{kind}.png")); im.colorspace_settings.name = "sRGB" if srgb else "Non-Color"
    n = lnt.nodes.new("ShaderNodeTexImage"); n.image = im; return n


a_ = load("albedo", True); LL.new(a_.outputs["Color"], P.inputs["Base Color"])
nm = load("normal", False); nmap = lnt.nodes.new("ShaderNodeNormalMap"); LL.new(nm.outputs["Color"], nmap.inputs["Color"]); LL.new(nmap.outputs[0], P.inputs["Normal"])
om = load("orm", False); sp = lnt.nodes.new("ShaderNodeSeparateColor"); LL.new(om.outputs["Color"], sp.inputs[0])
LL.new(sp.outputs[1], P.inputs["Roughness"]); LL.new(sp.outputs[2], P.inputs["Metallic"])
grp = bpy.data.node_groups.get("glTF Material Output")
if grp is None:
    grp = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree"); grp.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
gn = lnt.nodes.new("ShaderNodeGroup"); gn.node_tree = grp; LL.new(sp.outputs[0], gn.inputs["Occlusion"])

# ---------------- phone LOD (same UVs and maps) ----------------
ph = lo.copy(); ph.data = lo.data.copy(); ph.name = NAME + "_phone"; sc.collection.objects.link(ph)
sel_only([ph]); d = ph.modifiers.new("dec", "DECIMATE"); d.decimate_type = "COLLAPSE"; d.ratio = TRI_PHONE / rep["pc_tris"]; d.use_collapse_triangulate = True; d.delimit = {"UV"}
bpy.ops.object.modifier_apply(modifier="dec")
rep["phone_tris"] = tris(ph); log("phone", rep["phone_tris"])
for o in hi_objs: o.hide_render = True; o.hide_set(True)
sel_only([lo, ph], lo)
glb = os.path.join(OUT, f"{NAME}.glb")
bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=True, export_apply=True, export_yup=True, export_image_format="AUTO",
                          export_tangents=False, export_normals=True, export_texcoords=True, export_materials="EXPORT", export_extras=False)
co = np.array([v.co for v in lo.data.vertices]); rep["dims_m"] = [round(float(x), 3) for x in (co.max(0) - co.min(0))]
rep["min"] = [round(float(x), 3) for x in co.min(0)]; rep["max"] = [round(float(x), 3) for x in co.max(0)]
rep["glb_bytes"] = os.path.getsize(glb); rep["seconds"] = round(time.time() - t0)
json.dump(rep, open(os.path.join(OUT, "report.json"), "w"), indent=1)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, f"{NAME}.blend"))
log("done", json.dumps(rep))
