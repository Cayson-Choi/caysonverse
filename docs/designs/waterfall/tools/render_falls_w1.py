"""W1 check renders: the rock/ground art (work/falls_w1.blend) with PLACEHOLDER water, trees and an avatar, day and night.

  blender -b --factory-startup -P render_falls_w1.py -- [OUT_DIR] [--samples N] [--only NAME] [--night-only] [--day-only]

Water (pool, plunge, cascade), foam, trees, sky and lights are stand-ins for W2/W4/W6 so the rock can be judged in
context; only the rock, ground, slabs, seats, lamps and plants come from W1's build.
"""
import math
import os
import random
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import falls_shape as F  # noqa: E402

ROOT = os.path.dirname(HERE)
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv and not argv[0].startswith("--") else os.path.join(ROOT, "work", "falls_w1_render")
SAMPLES = int(argv[argv.index("--samples") + 1]) if "--samples" in argv else 64
ONLY = set(argv[argv.index("--only") + 1].split(",")) if "--only" in argv else None
os.makedirs(OUT, exist_ok=True)
HDRI = os.path.join(ROOT, "downloads", "hdri", "kloppenheim_06_puresky_1k.hdr")
HDRI_N = os.path.join(ROOT, "downloads", "hdri", "qwantani_dusk_2_puresky_1k.hdr")

bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT, "work", "falls_w1.blend"))
sc = bpy.context.scene
S = F.SITE


def V(x, z, y):
    return (x, -z, y)


def flat(name, rgb, rough=0.9, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = (*rgb, 1)
        b.inputs["Emission Strength"].default_value = emit
    return m


def mesh_obj(name, verts, faces, mat, smooth_=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    sc.collection.objects.link(ob)
    ob.data.materials.append(mat)
    if smooth_:
        for p in me.polygons:
            p.use_smooth = True
    return ob


PH = []          # placeholder objects (water / trees / avatar)

# ----------------------------------------------------------------------------------------- placeholder water
pm = bpy.data.materials.new("pool")
pm.use_nodes = True
nt = pm.node_tree
b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
b.inputs["Base Color"].default_value = (0.05, 0.22, 0.17, 1)
b.inputs["Roughness"].default_value = 0.04
b.inputs["Transmission Weight"].default_value = 0.92
b.inputs["IOR"].default_value = 1.33
nz = nt.nodes.new("ShaderNodeTexNoise")
nz.inputs["Scale"].default_value = 3.0
bump = nt.nodes.new("ShaderNodeBump")
bump.inputs["Strength"].default_value = 0.12
nt.links.new(nz.outputs["Fac"], bump.inputs["Height"])
nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
o = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
vol = nt.nodes.new("ShaderNodeVolumeAbsorption")
vol.inputs["Color"].default_value = (0.25, 0.75, 0.55, 1)
vol.inputs["Density"].default_value = 0.8
nt.links.new(vol.outputs[0], o.inputs["Volume"])
segs = 72
pv = [V(F.POOL_CX, F.POOL_CZ, F.WATER_Y)] + [V(F.POOL_CX + F.POOL_RX * 1.04 * math.cos(2 * math.pi * k / segs),
                                           F.POOL_CZ + F.POOL_RZ * 1.04 * math.sin(2 * math.pi * k / segs), F.WATER_Y) for k in range(segs)]
pool = mesh_obj("PH_pool", pv, [(0, 1 + k, 1 + (k + 1) % segs) for k in range(segs)], pm)
mod = pool.modifiers.new("solid", "SOLIDIFY")
mod.thickness = 2.4
mod.offset = 1.0 if pool.data.polygons[0].normal.z < 0 else -1.0
PH.append(pool)
# outlet ribbon
op = F.OUTLET["points"]
ov, of = [], []
samples = []
for a, b_ in zip(op[:-1], op[1:]):
    for k in range(8):
        t = k / 8
        samples.append((a["x"] + (b_["x"] - a["x"]) * t, a["z"] + (b_["z"] - a["z"]) * t))
samples.append((op[-1]["x"], op[-1]["z"]))
for n, (x, z) in enumerate(samples):
    x2, z2 = samples[min(n + 1, len(samples) - 1)] if n + 1 < len(samples) else samples[n - 1]
    dx, dz = (x2 - x, z2 - z) if n + 1 < len(samples) else (x - x2, z - z2)
    ln = math.hypot(dx, dz)
    px, pz = -dz / ln, dx / ln
    _, f = F.outlet_dist(x, z)
    wy = F.outlet_water_y(f)
    hw = F.OUTLET["width"] / 2 + 0.2
    ov += [V(x - px * hw, z - pz * hw, wy), V(x + px * hw, z + pz * hw, wy)]
for n in range(len(samples) - 1):
    a = 2 * n
    of.append((a, a + 1, a + 3, a + 2))
PH.append(mesh_obj("PH_outlet", ov, of, pm, smooth_=False))

fm = bpy.data.materials.new("falls")
fm.use_nodes = True
nt = fm.node_tree
bs = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
bs.inputs["Base Color"].default_value = (0.92, 0.95, 0.97, 1)
bs.inputs["Roughness"].default_value = 0.3
tc = nt.nodes.new("ShaderNodeTexCoord")
mp = nt.nodes.new("ShaderNodeMapping")
mp.inputs["Scale"].default_value = (6.0, 0.35, 1.0)
nt.links.new(tc.outputs["UV"], mp.inputs["Vector"])
nz = nt.nodes.new("ShaderNodeTexNoise")
nz.inputs["Scale"].default_value = 6.0
nz.inputs["Detail"].default_value = 8
nt.links.new(mp.outputs["Vector"], nz.inputs["Vector"])
sep = nt.nodes.new("ShaderNodeSeparateXYZ")
nt.links.new(tc.outputs["UV"], sep.inputs["Vector"])
edge = nt.nodes.new("ShaderNodeMath")
edge.operation = "PINGPONG"
edge.inputs[1].default_value = 0.5
nt.links.new(sep.outputs["X"], edge.inputs[0])
e2 = nt.nodes.new("ShaderNodeMapRange")
e2.inputs["From Min"].default_value = 0.0
e2.inputs["From Max"].default_value = 0.22
nt.links.new(edge.outputs[0], e2.inputs["Value"])
cr = nt.nodes.new("ShaderNodeMapRange")
cr.inputs["From Min"].default_value = 0.33
cr.inputs["From Max"].default_value = 0.6
nt.links.new(nz.outputs["Fac"], cr.inputs["Value"])
mul = nt.nodes.new("ShaderNodeMath")
mul.operation = "MULTIPLY"
nt.links.new(cr.outputs["Result"], mul.inputs[0])
nt.links.new(e2.outputs["Result"], mul.inputs[1])
nt.links.new(mul.outputs[0], bs.inputs["Alpha"])
bs.inputs["Emission Color"].default_value = (0.8, 0.88, 0.95, 1)
bs.inputs["Emission Strength"].default_value = 0.25


def ribbon(name, centres, widths, off=0.0):
    vs, fs = [], []
    for (c, w) in zip(centres, widths):
        for s in (-1, 1):
            vs.append(V(c[0], c[2] + s * w / 2, c[1]))
    n = len(centres) - 1
    for k in range(n):
        a = 2 * k
        fs.append((a, a + 1, a + 3, a + 2))
    ob = mesh_obj(name, vs, fs, fm)
    me = ob.data
    uv = me.uv_layers.new(name="UV")
    for p in me.polygons:
        for li in p.loop_indices:
            vi = me.loops[li].vertex_index
            uv.data[li].uv = (vi % 2, (vi // 2) / n * 4 + off)
    PH.append(ob)


pp = F.plunge_path(40)
ribbon("PH_plunge", [(x, y, z) for (x, y, z, _) in pp], [F.plunge_width(k / 40) for k in range(41)])
for k, st in enumerate(F.SIDE_STRANDS):
    sp = F.plunge_path(40, st["speed"], F.LIP["z"] + st["dz"])
    w0, w1 = st["width"]
    ribbon(f"PH_strand{k}", [(x, y, z) for (x, y, z, _) in sp], [w0 + (w1 - w0) * i / 40 for i in range(41)], off=0.3 * (k + 1))
cp = F.cascade_path(0.25)
ribbon("PH_cascade", [(x + 0.2, y, z) for (x, y, z) in cp], [F.channel_width(y) * 0.8 for (_, y, _) in cp])
rr = random.Random(3)
foam_m = flat("foam", (0.92, 0.95, 0.97), 0.6)
import bmesh as _bm  # noqa: E402
for k in range(26):                                   # placeholder foam: low lumpy white mounds round the impact
    a = rr.uniform(0, 2 * math.pi)
    r = rr.uniform(0.0, 2.6)
    bm = _bm.new()
    _bm.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
    for v in bm.verts:
        v.co += v.normal * 0.18 * math.sin(v.co.x * 7 + k) * math.cos(v.co.y * 6 + v.co.z * 5)
    me_ = bpy.data.meshes.new("foam")
    bm.to_mesh(me_)
    bm.free()
    o_ = bpy.data.objects.new("foam", me_)
    o_.location = V(F.IMPACT["x"] + r * math.cos(a), F.IMPACT["z"] + 1.1 * r * math.sin(a), -0.32)
    s_ = rr.uniform(0.45, 1.0)
    o_.scale = (s_, s_ * rr.uniform(0.8, 1.3), s_ * 0.32)
    me_.materials.append(foam_m)
    for p_ in me_.polygons:
        p_.use_smooth = True
    sc.collection.objects.link(o_)
    PH.append(o_)
BARE = "--bare" in argv     # no forest / village context (fast look-dev)
# ------------------------------------------------------------------------- context forest (W6 stand-in, outside the box)
# The site's own trees come from the W1 build (inst__falls_tree_k); round the box we instance the same templates so
# the gorge reads as the forested valley of photos 05 / 12 (W6 brings the village's real forest there).
tr = random.Random(11)
TPL = [bpy.data.objects[n] for n in sorted(o.name for o in bpy.data.objects if o.name.startswith("falls_tree_") and o.name.count("_") == 2)]


def tree(x, z, y, h):
    ob = bpy.data.objects.new("ptree", TPL[tr.randrange(len(TPL))].data)
    s = h / 13.0
    ob.location = V(x, z, y)
    ob.scale = (s, s, s)
    ob.rotation_euler = (0, 0, tr.uniform(0, 6.28))
    sc.collection.objects.link(ob)
    PH.append(ob)


# village context: the current village terrain round the site (hole left for the site box) + trees on it
import parts_nature as PN  # noqa: E402
terr = flat("terr", (0.07, 0.11, 0.035), 0.95)
CX0, CX1, CZ0, CZ1, CS = -220.0, -56.0, -184.0, 26.0, 2.0
cxn, czn = int((CX1 - CX0) / CS), int((CZ1 - CZ0) / CS)
cv_, cf_ = [], []
for j in range(czn + 1):
    for i in range(cxn + 1):
        x, z = CX0 + i * CS, CZ0 + j * CS
        cv_.append(V(x, z, F.pocket_flatten(x, z, PN.terrain_h(x, z))))
for j in range(czn):
    for i in range(cxn):
        x, z = CX0 + i * CS, CZ0 + j * CS
        if S["minX"] <= x and x + CS <= S["maxX"] and S["minZ"] <= z and z + CS <= S["maxZ"]:
            continue
        a = j * (cxn + 1) + i
        cf_.append((a, a + 1, a + cxn + 2, a + cxn + 1))
PH.append(mesh_obj("PH_village", cv_, cf_, terr))
placed = []
for k in range(0 if BARE else 4000):
    if len(placed) >= 900:
        break
    x, z = tr.uniform(CX0, -92), tr.uniform(CZ0, CZ1)
    if F.in_box(x, z, S, 0.5) or (x > -100 and -94 < z < -62):
        continue
    y = PN.terrain_h(x, z)
    if y < 0.4 and x > -100:
        continue
    near = 3.6 if abs(z + 78) < 60 and x > -170 else 5.0
    if any(abs(px - x) < near and abs(pz - z) < near and math.hypot(px - x, pz - z) < near for px, pz in placed[-400:]):
        continue
    placed.append((x, z))
    tree(x, z, F.pocket_flatten(x, z, y) - 0.3, tr.uniform(10, 16))

# avatar for scale: 2.16 m chibi standing on the front slab
AVA = flat("ava", (0.1, 0.25, 0.8), 0.5)
SKIN = flat("skin", (0.9, 0.7, 0.55))


def avatar(x, z, y0=0.04):
    bpy.ops.mesh.primitive_cylinder_add(radius=0.35, depth=1.0, location=V(x, z, y0 + 0.5))
    bpy.context.object.data.materials.append(AVA)
    PH.append(bpy.context.object)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.58, location=V(x, z, y0 + 1.58))
    bpy.context.object.data.materials.append(SKIN)
    PH.append(bpy.context.object)


avatar(-103.4, -77.6)
AVATAR_OBS = PH[-2:]

# ------------------------------------------------------------------------------------------------- render setup
EEVEE = "--eevee" in argv
try:
    sc.render.engine = "CYCLES"
except TypeError:
    pass
if EEVEE:
    for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            sc.render.engine = eng
            break
        except TypeError:
            continue
    try:
        sc.eevee.taa_render_samples = 24
    except Exception:
        pass
sc.cycles.samples = SAMPLES
sc.cycles.use_denoising = True
prefs = bpy.context.preferences.addons["cycles"].preferences
for dev_type in ("OPTIX", "CUDA", "HIP", "ONEAPI"):
    try:
        prefs.compute_device_type = dev_type
        prefs.get_devices()
        if any(d.type == dev_type for d in prefs.devices):
            for d in prefs.devices:
                d.use = True
            sc.cycles.device = "GPU"
            break
    except Exception:
        continue
sc.render.resolution_x, sc.render.resolution_y = 1280, 720
sc.view_settings.view_transform = "AgX"
sc.render.image_settings.file_format = "PNG"
sc.cycles.max_bounces = 6

world = bpy.data.worlds.new("w")
sc.world = world
world.use_nodes = True
env = world.node_tree.nodes.new("ShaderNodeTexEnvironment")
bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
world.node_tree.links.new(env.outputs["Color"], bg.inputs["Color"])
sun = bpy.data.lights.new("sun", "SUN")
sun_o = bpy.data.objects.new("sun", sun)
sc.collection.objects.link(sun_o)
lamp_lights = []
for k, lp in enumerate(F.LAMPS):
    L = bpy.data.lights.new(f"lamp{k}", "POINT")
    L.energy = 0.0
    L.color = (1.0, 0.70, 0.42)
    L.shadow_soft_size = 0.12
    lo = bpy.data.objects.new(f"lamp{k}", L)
    lo.location = V(lp["x"], lp["z"], 0.5)
    sc.collection.objects.link(lo)
    lamp_lights.append(L)
spot = []
for k, lp in enumerate(F.LAMPS):
    sp_ = bpy.data.lights.new(f"lampspot{k}", "SPOT")
    sp_.energy = 0.0
    sp_.color = (1.0, 0.70, 0.42)
    sp_.spot_size = math.radians(70)
    sp_.spot_blend = 0.7
    so = bpy.data.objects.new(f"lampspot{k}", sp_)
    so.location = V(lp["x"], lp["z"], 0.5)
    tgt = Vector(V(lp["aim"]["x"], lp["aim"]["z"], lp["aim"]["y"]))
    so.rotation_euler = (tgt - Vector(so.location)).to_track_quat("-Z", "Y").to_euler()
    sc.collection.objects.link(so)
    spot.append(sp_)


def set_day():
    env.image = bpy.data.images.load(HDRI, check_existing=True)
    bg.inputs["Strength"].default_value = 0.95
    sun.energy = 3.6
    sun.color = (1.0, 0.93, 0.82)
    sun.angle = math.radians(1.6)
    # ENE sun, 38 deg up: the falls face east, so the cliff is lit (design 5.3)
    az, el = math.radians(112), math.radians(40)
    d = Vector((math.cos(el) * math.sin(az), -math.cos(el) * math.cos(az), math.sin(el)))   # points from the scene to the sun
    sun_o.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    sc.view_settings.exposure = 0.0
    for L in lamp_lights + spot:
        L.energy = 0.0


def set_night():
    env.image = bpy.data.images.load(HDRI_N, check_existing=True)
    bg.inputs["Strength"].default_value = 0.14
    sun.energy = 0.0
    sc.view_settings.exposure = 0.9
    for L in lamp_lights:
        L.energy = 90.0
    for L in spot:
        L.energy = 1800.0


def shoot(name, loc, target, lens, night=False, res=(1280, 720), ava=False):
    if ONLY and name not in ONLY:
        return
    (set_night if night else set_day)()
    sc.render.resolution_x, sc.render.resolution_y = res
    for o in AVATAR_OBS:
        o.hide_render = not ava
    cam = bpy.data.cameras.new(name)
    cam.lens = lens
    cam.clip_start = 0.05
    cam.clip_end = 600
    co = bpy.data.objects.new(name, cam)
    sc.collection.objects.link(co)
    co.location = loc
    co.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    sc.camera = co
    sc.render.filepath = os.path.join(OUT, name + ".png")
    bpy.ops.render.render(write_still=True)
    print("wrote", sc.render.filepath)


# the sets of views: photo-matched framings first (design 9.6), then S7 / S8 / far / detail views
day = "--night-only" not in argv
night = "--day-only" not in argv
R43, R32 = (1280, 960), (1280, 854)
if day:
    shoot("day_photo12", V(-96.0, -81.5, 1.7), V(-117.0, -77.5, 12.5), 16, res=R43)        # photo 12: rest area, eye height
    shoot("day_photo05", V(-101.8, -73.6, 0.7), V(-116.5, -80.0, 9.5), 18, res=R32)      # photo 05: low at the pool edge
    shoot("day_s8_front_slab", V(-104.6, -78.8, 2.3), V(-116.0, -78.0, 11.0), 20, ava=True)  # S8: front slab, looking up
    shoot("day_s7_rest_area", V(-100.0, -79.0, 2.6), V(-116.0, -78.5, 13.0), 20, ava=True)   # S7: rest-area middle
    shoot("day_far", V(-62.0, -70.0, 3.0), V(-116.0, -78.0, 16.0), 30)                     # from the village side
    shoot("day_north_side", V(-103.0, -88.5, 2.0), V(-116.0, -80.0, 6.0), 22)              # S9: north end, rock and bank
    shoot("day_rock_close", V(-106.5, -91.0, 2.2), V(-116.5, -91.5, 6.0), 26)              # the cliff's north wall at 10 m
    shoot("day_cliff_mid", V(-104.0, -72.0, 3.0), V(-117.5, -70.0, 9.0), 24)               # the south wall, jointed blocks
    shoot("day_bank", V(-100.0, -70.5, 1.7), V(-108.0, -75.0, 0.3), 24)                    # gravel bank, riprap, plants
if night:
    shoot("night_photo12", V(-96.0, -81.5, 1.7), V(-117.0, -77.5, 12.5), 16, night=True, res=R43)
    shoot("night_s8_front_slab", V(-104.6, -78.8, 2.3), V(-116.0, -78.0, 7.0), 20, night=True, ava=True)
    shoot("night_s7_rest_area", V(-98.0, -79.0, 2.6), V(-112.0, -78.5, 3.0), 22, night=True, ava=True)
for _dbg in [o for o in (ONLY or ()) if o.startswith("dbg_")]:
    ob = bpy.data.objects[_dbg[4:]]
    vs = [ob.matrix_world @ v.co for v in ob.data.vertices]
    c = sum(vs, Vector()) / len(vs)
    c = vs[len(vs) // 3]
    shoot(_dbg, (c.x + 2.0, c.y - 2.5, c.z + 1.0), (c.x, c.y, c.z), 35)
