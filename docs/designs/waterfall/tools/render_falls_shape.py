"""W0 check render of the LOCKED waterfall shape (falls_shape.py), not the final art.

  blender -b --factory-startup -P render_falls_shape.py -- [OUT_DIR] [--samples N] [--only NAME]

Builds the site's terrain heightfield, the hi-res cliff face, the pool, the plunge/cascade water lines, slabs, seats and
lamps from falls_shape, plus grey placeholder trees, and renders three views: the rest-area view behind an avatar (S7),
the wide view from the village side, and a plan view with the contract outlines (site, pocket, entry, pool waterline
and keep-out, camera wall, outlet).
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

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = next((a for a in argv if not a.startswith("--") and not a.isdigit()), os.path.join(os.path.dirname(HERE), "work", "falls_w0"))
SAMPLES = int(argv[argv.index("--samples") + 1]) if "--samples" in argv else 96
ONLY = argv[argv.index("--only") + 1] if "--only" in argv else None
os.makedirs(OUT, exist_ok=True)
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
TEX = os.path.join(REPO, "art", "village", "downloads", "tex")
HDRI = os.path.join(REPO, "art", "village", "downloads", "hdri", "kloppenheim_06_puresky_1k.hdr")


def V(x, z, y):
    return (x, -z, y)


bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
random.seed(7)


# ------------------------------------------------------------------------------------------- materials --
def img(name):
    return bpy.data.images.load(os.path.join(TEX, name), check_existing=True)


def rock_mat(name, diff, nor, tint=(1, 1, 1), moss=True, wet_attr=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (0.25, 0.25, 0.25)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    t = nt.nodes.new("ShaderNodeTexImage"); t.image = img(diff); t.projection = "BOX"; t.projection_blend = 0.3
    nt.links.new(mp.outputs["Vector"], t.inputs["Vector"])
    tn = nt.nodes.new("ShaderNodeTexImage"); tn.image = img(nor); tn.image.colorspace_settings.name = "Non-Color"
    tn.projection = "BOX"; tn.projection_blend = 0.3
    nt.links.new(mp.outputs["Vector"], tn.inputs["Vector"])
    nm = nt.nodes.new("ShaderNodeNormalMap"); nm.inputs["Strength"].default_value = 1.4
    nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    hs = nt.nodes.new("ShaderNodeHueSaturation"); hs.inputs["Saturation"].default_value = 0.18
    nt.links.new(t.outputs["Color"], hs.inputs["Color"])
    tintn = nt.nodes.new("ShaderNodeMix"); tintn.data_type = "RGBA"; tintn.blend_type = "MULTIPLY"
    tintn.inputs["Factor"].default_value = 1.0
    tintn.inputs[7].default_value = (*tint, 1)
    nt.links.new(hs.outputs["Color"], tintn.inputs[6])
    col = tintn.outputs[2]
    if wet_attr:  # darken where the attribute "wet" is 1 (behind and beside the water)
        at = nt.nodes.new("ShaderNodeAttribute"); at.attribute_name = "wet"
        mw = nt.nodes.new("ShaderNodeMix"); mw.data_type = "RGBA"; mw.blend_type = "MULTIPLY"
        nt.links.new(at.outputs["Fac"], mw.inputs["Factor"])
        nt.links.new(col, mw.inputs[6]); mw.inputs[7].default_value = (0.42, 0.42, 0.42, 1)
        col = mw.outputs[2]
        rr = nt.nodes.new("ShaderNodeMapRange"); rr.inputs["To Min"].default_value = 0.85; rr.inputs["To Max"].default_value = 0.3
        nt.links.new(at.outputs["Fac"], rr.inputs["Value"]); nt.links.new(rr.outputs["Result"], bsdf.inputs["Roughness"])
    else:
        bsdf.inputs["Roughness"].default_value = 0.85
    if moss:
        geo = nt.nodes.new("ShaderNodeNewGeometry")
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(geo.outputs["Normal"], sep.inputs["Vector"])
        ramp = nt.nodes.new("ShaderNodeMapRange")
        ramp.inputs["From Min"].default_value = 0.6; ramp.inputs["From Max"].default_value = 0.9
        nt.links.new(sep.outputs["Z"], ramp.inputs["Value"])
        mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"
        nt.links.new(ramp.outputs["Result"], mix.inputs["Factor"])
        nt.links.new(col, mix.inputs[6]); mix.inputs[7].default_value = (0.12, 0.19, 0.06, 1)
        col = mix.outputs[2]
    nt.links.new(col, bsdf.inputs["Base Color"])
    return m


def flat(name, rgb, rough=0.9, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*rgb, 1); b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = (*rgb, 1); b.inputs["Emission Strength"].default_value = emit
    return m


ROCK = rock_mat("rock", "rock_face_diff_1k.jpg", "rock_face_nor_gl_1k.jpg", (0.8, 0.8, 0.76), wet_attr=True)
GROUND = rock_mat("ground", "rock_face_diff_1k.jpg", "rock_face_nor_gl_1k.jpg", (0.8, 0.8, 0.76), wet_attr=False)
BED = rock_mat("bed", "river_small_rocks_diff_1k.jpg", "river_small_rocks_nor_gl_1k.jpg", (0.65, 0.68, 0.58), moss=False)
SLAB = rock_mat("slab", "dry_riverbed_rock_diff_1k.jpg", "dry_riverbed_rock_nor_gl_1k.jpg", (0.95, 0.95, 0.93), moss=False)
GRASS = flat("grass", (0.10, 0.20, 0.05))
LEAF = flat("leaf", (0.06, 0.15, 0.04))
LEAF2 = flat("leaf2", (0.11, 0.19, 0.05))
BARK = flat("bark", (0.12, 0.08, 0.05))
AVATAR = flat("avatar", (0.1, 0.25, 0.8), 0.5)
SKIN = flat("skin", (0.9, 0.7, 0.55))
LAMP = flat("lamp", (1.0, 0.70, 0.42), 0.4, emit=3.0)
LINE = {k: flat("line_" + k, c, 0.5, emit=4.0) for k, c in (("site", (1, 1, 1)), ("pocket", (1.0, 0.85, 0.1)), ("entry", (1.0, 0.3, 0.1)),
                                                           ("keep", (1.0, 0.2, 0.6)), ("cam", (0.2, 0.9, 1.0)), ("outlet", (0.3, 0.5, 1.0)))}


def ground_mat():
    """Grass on gentle slopes, rock on steep ones, gravel near the water (attribute 'shore')."""
    m = bpy.data.materials.new("terrain")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    nt.nodes.remove(bsdf)
    # three shaders mixed: grass / rock by slope, then gravel by the 'shore' attribute
    g = nt.nodes.new("ShaderNodeBsdfPrincipled"); g.inputs["Base Color"].default_value = (0.09, 0.17, 0.045, 1); g.inputs["Roughness"].default_value = 0.95
    nzg = nt.nodes.new("ShaderNodeTexNoise"); nzg.inputs["Scale"].default_value = 0.6
    cr = nt.nodes.new("ShaderNodeValToRGB")
    cr.color_ramp.elements[0].color = (0.06, 0.13, 0.035, 1); cr.color_ramp.elements[1].color = (0.13, 0.21, 0.06, 1)
    nt.links.new(nzg.outputs["Fac"], cr.inputs["Fac"]); nt.links.new(cr.outputs["Color"], g.inputs["Base Color"])
    r = nt.nodes.new("ShaderNodeBsdfPrincipled"); r.inputs["Roughness"].default_value = 0.85
    tc = nt.nodes.new("ShaderNodeTexCoord"); mp = nt.nodes.new("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (0.25, 0.25, 0.25)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    t = nt.nodes.new("ShaderNodeTexImage"); t.image = img("rock_face_diff_1k.jpg"); t.projection = "BOX"; t.projection_blend = 0.3
    nt.links.new(mp.outputs["Vector"], t.inputs["Vector"])
    hs = nt.nodes.new("ShaderNodeHueSaturation"); hs.inputs["Saturation"].default_value = 0.18
    nt.links.new(t.outputs["Color"], hs.inputs["Color"]); nt.links.new(hs.outputs["Color"], r.inputs["Base Color"])
    b = nt.nodes.new("ShaderNodeBsdfPrincipled"); b.inputs["Roughness"].default_value = 0.8
    t2 = nt.nodes.new("ShaderNodeTexImage"); t2.image = img("river_small_rocks_diff_1k.jpg"); t2.projection = "BOX"
    mp2 = nt.nodes.new("ShaderNodeMapping"); mp2.inputs["Scale"].default_value = (0.5, 0.5, 0.5)
    nt.links.new(tc.outputs["Object"], mp2.inputs["Vector"]); nt.links.new(mp2.outputs["Vector"], t2.inputs["Vector"])
    nt.links.new(t2.outputs["Color"], b.inputs["Base Color"])
    geo = nt.nodes.new("ShaderNodeNewGeometry"); sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Normal"], sep.inputs["Vector"])
    sl = nt.nodes.new("ShaderNodeMapRange"); sl.inputs["From Min"].default_value = 0.72; sl.inputs["From Max"].default_value = 0.5
    nt.links.new(sep.outputs["Z"], sl.inputs["Value"])
    m1 = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(sl.outputs["Result"], m1.inputs[0]); nt.links.new(g.outputs[0], m1.inputs[1]); nt.links.new(r.outputs[0], m1.inputs[2])
    at = nt.nodes.new("ShaderNodeAttribute"); at.attribute_name = "shore"
    m2 = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(at.outputs["Fac"], m2.inputs[0]); nt.links.new(m1.outputs[0], m2.inputs[1]); nt.links.new(b.outputs[0], m2.inputs[2])
    nt.links.new(m2.outputs[0], out.inputs["Surface"])
    return m


TERRAIN = ground_mat()


def water_mat():
    m = bpy.data.materials.new("pool")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (0.05, 0.22, 0.17, 1)
    bsdf.inputs["Roughness"].default_value = 0.04
    bsdf.inputs["Transmission Weight"].default_value = 0.9
    bsdf.inputs["IOR"].default_value = 1.33
    nz = nt.nodes.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 3.0
    bump = nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.2
    nt.links.new(nz.outputs["Fac"], bump.inputs["Height"]); nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    vol = nt.nodes.new("ShaderNodeVolumeAbsorption")
    vol.inputs["Color"].default_value = (0.25, 0.75, 0.55, 1); vol.inputs["Density"].default_value = 0.8
    nt.links.new(vol.outputs[0], out.inputs["Volume"])
    return m


POOL = water_mat()


def falls_mat():
    m = bpy.data.materials.new("falls")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (0.92, 0.95, 0.97, 1)
    bsdf.inputs["Roughness"].default_value = 0.3
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (6.0, 0.35, 1.0)
    nt.links.new(tc.outputs["UV"], mp.inputs["Vector"])
    nz = nt.nodes.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 6.0; nz.inputs["Detail"].default_value = 8
    nt.links.new(mp.outputs["Vector"], nz.inputs["Vector"])
    sep = nt.nodes.new("ShaderNodeSeparateXYZ"); nt.links.new(tc.outputs["UV"], sep.inputs["Vector"])
    edge = nt.nodes.new("ShaderNodeMath"); edge.operation = "PINGPONG"; edge.inputs[1].default_value = 0.5
    nt.links.new(sep.outputs["X"], edge.inputs[0])
    e2 = nt.nodes.new("ShaderNodeMapRange"); e2.inputs["From Min"].default_value = 0.0; e2.inputs["From Max"].default_value = 0.22
    nt.links.new(edge.outputs[0], e2.inputs["Value"])
    cr = nt.nodes.new("ShaderNodeMapRange"); cr.inputs["From Min"].default_value = 0.33; cr.inputs["From Max"].default_value = 0.6
    nt.links.new(nz.outputs["Fac"], cr.inputs["Value"])
    mul = nt.nodes.new("ShaderNodeMath"); mul.operation = "MULTIPLY"
    nt.links.new(cr.outputs["Result"], mul.inputs[0]); nt.links.new(e2.outputs["Result"], mul.inputs[1])
    nt.links.new(mul.outputs[0], bsdf.inputs["Alpha"])
    bsdf.inputs["Emission Color"].default_value = (0.8, 0.88, 0.95, 1)
    bsdf.inputs["Emission Strength"].default_value = 0.25
    return m


FALLS = falls_mat()


def mesh_obj(name, verts, faces, mat, smooth_=True, attrs=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    sc.collection.objects.link(ob)
    ob.data.materials.append(mat)
    if smooth_:
        for p in me.polygons:
            p.use_smooth = True
    for an, vals in (attrs or {}).items():
        at = me.attributes.new(an, "FLOAT", "POINT")
        for i, v in enumerate(vals):
            at.data[i].value = v
    return ob


def wetness(x, y, z):
    d_ch = abs(z - F.channel_z(y)) if y > F.LEDGE - 0.5 else 99.0
    d_pl = math.hypot(z - F.LIP["z"], 0.0) if y <= F.LEDGE + 0.5 else 99.0
    w = max(math.exp(-(d_ch / 3.2) ** 2), math.exp(-(d_pl / 4.2) ** 2) if y > -1 else 0.0)
    near = math.hypot(x - F.IMPACT["x"], z - F.IMPACT["z"]) - 6.0
    w = max(w, math.exp(-max(0.0, near) / 3.0) * (1.0 if y < 6 else 0.0))
    return min(1.0, w)


# ------------------------------------------------------------------------------------------------ build --
S = F.SITE
STEP = 0.5
nx = int((S["maxX"] - S["minX"]) / STEP)
nz = int((S["maxZ"] - S["minZ"]) / STEP)
H = []
for j in range(nz + 1):
    z = S["minZ"] + j * STEP
    H.append([F.terrain_y(S["minX"] + i * STEP, z) for i in range(nx + 1)])
print("terrain sampled")
tv, tf, shore = [], [], []
for j in range(nz + 1):
    for i in range(nx + 1):
        x, z = S["minX"] + i * STEP, S["minZ"] + j * STEP
        tv.append(V(x, z, H[j][i]))
        sd = F.pool_signed_dist(x, z)
        od, _ = F.outlet_dist(x, z)
        shore.append(max(max(0.0, min(1.0, (2.2 - sd) / 1.6)), max(0.0, min(1.0, (3.2 - od) / 1.4))))
for j in range(nz):
    for i in range(nx):
        x, z = S["minX"] + i * STEP, S["minZ"] + j * STEP
        hs = (H[j][i], H[j][i + 1], H[j + 1][i], H[j + 1][i + 1])
        steep = max(hs) - min(hs) > 1.4 * STEP and F.FACE_Z[0] + 1 <= z <= F.FACE_Z[1] - 1 and abs(z - F.FZ) < F.FLANK_FULL - 1.0
        if steep:
            continue  # the hi-res face covers it
        a = j * (nx + 1) + i
        tf.append((a, a + 1, a + nx + 2, a + nx + 1))
mesh_obj("falls_ground", tv, tf, TERRAIN, attrs={"shore": shore})

# hi-res cliff face (z FACE_Z, y FACE_Y), quads dropped where buried under the floor
FS = 0.25
zs = [F.FACE_Z[0] + FS * k for k in range(int((F.FACE_Z[1] - F.FACE_Z[0]) / FS) + 1)]
ys = [F.FACE_Y[0] + FS * k for k in range(int((F.FACE_Y[1] - F.FACE_Y[0]) / FS) + 1)]
fv, ff, wet, keep = [], [], [], []
for y in ys:
    for z in zs:
        x = F.face_x(z, y)
        fv.append(V(x, z, y))
        wet.append(wetness(x, y, z))
        keep.append(y > F.floor_y(x, z) - 0.4 and abs(z - F.FZ) < F.FLANK_FULL + 0.5)
nzf = len(zs)
for j in range(len(ys) - 1):
    for i in range(nzf - 1):
        a = j * nzf + i
        q = (a, a + 1, a + nzf + 1, a + nzf)
        if any(keep[k] for k in q):
            ff.append(q)
mesh_obj("falls_rock_hi", fv, ff, ROCK, attrs={"wet": wet})
print("face built", len(ff))

# pool water (ellipse disc) clipped to the waterline; thin volume
segs = 64
pv = [V(F.POOL_CX, F.POOL_CZ, F.WATER_Y)] + [V(F.POOL_CX + F.POOL_RX * 1.02 * math.cos(2 * math.pi * k / segs),
                                           F.POOL_CZ + F.POOL_RZ * 1.02 * math.sin(2 * math.pi * k / segs), F.WATER_Y) for k in range(segs)]
pool = mesh_obj("W_falls_pool", pv, [(0, 1 + k, 1 + (k + 1) % segs) for k in range(segs)], POOL)
mod = pool.modifiers.new("solid", "SOLIDIFY"); mod.thickness = 2.4; mod.offset = 1.0 if pool.data.polygons[0].normal.z < 0 else -1.0
# outlet water: ribbon along the polyline
op = F.OUTLET["points"]
ov, of = [], []
samples = []
for a, b in zip(op[:-1], op[1:]):
    for k in range(8):
        t = k / 8
        samples.append((a["x"] + (b["x"] - a["x"]) * t, a["z"] + (b["z"] - a["z"]) * t))
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
mesh_obj("W_falls_outlet", ov, of, POOL, smooth_=False)


def ribbon(name, centres, widths, normal_dir, off=0.0):
    vs, fs = [], []
    for (c, w) in zip(centres, widths):
        for s in (-1, 1):
            vs.append(V(c[0], c[2] + s * w / 2, c[1]))
    n = len(centres) - 1
    for k in range(n):
        a = 2 * k
        fs.append((a, a + 1, a + 3, a + 2))
    ob = mesh_obj(name, vs, fs, FALLS)
    me = ob.data
    uv = me.uv_layers.new(name="UV")
    for p in me.polygons:
        for li in p.loop_indices:
            vi = me.loops[li].vertex_index
            uv.data[li].uv = (vi % 2, (vi // 2) / n * 4 + off)
    return ob


pp = F.plunge_path(40)
ribbon("W_falls_plunge_0", [(x, y, z) for (x, y, z, _) in pp], [F.plunge_width(k / 40) for k in range(41)], None)
for k, st in enumerate(F.SIDE_STRANDS):
    sp = F.plunge_path(40, st["speed"], F.LIP["z"] + st["dz"])
    w0, w1 = st["width"]
    ribbon(f"W_falls_plunge_{k + 1}", [(x, y, z) for (x, y, z, _) in sp], [w0 + (w1 - w0) * i / 40 for i in range(41)], None, off=0.3 * (k + 1))
cp = F.cascade_path(0.25)
ribbon("W_falls_cascade", [(x + 0.18, y, z) for (x, y, z) in cp], [F.channel_width(y) * 0.8 for (_, y, _) in cp], None)
# foam mound at the impact
for k in range(40):
    a = random.uniform(0, 2 * math.pi); r = random.uniform(0.2, 3.4)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=random.uniform(0.3, 0.8), location=V(F.IMPACT["x"] + r * math.cos(a), F.IMPACT["z"] + 1.2 * r * math.sin(a), -0.22),
                                         segments=10, ring_count=6)
    o = bpy.context.object; o.scale.z = 0.25; o.data.materials.append(flat("foam", (0.95, 0.97, 1.0), 0.5))


# slabs, seats, lamps
def slab_obj(s, height, mat, bottom=-0.45):
    segs_ = 28
    c, sn = math.cos(s["yaw"]), math.sin(s["yaw"])
    ring_t, ring_b = [], []
    rng = random.Random(hash(s["id"]) & 0xFFFF)
    for k in range(segs_):
        a = 2 * math.pi * k / segs_
        j = 1.0 + 0.07 * math.sin(3 * a + rng.uniform(0, 6)) + 0.04 * math.sin(7 * a)
        lx, lz = s["radiusX"] * math.cos(a) * j, s["radiusZ"] * math.sin(a) * j
        wx = s["centre"]["x"] + lx * c + lz * sn
        wz = s["centre"]["z"] - lx * sn + lz * c
        ring_t.append(V(wx, wz, height))
        ring_b.append(V(s["centre"]["x"] + (lx * c + lz * sn) * 1.08, s["centre"]["z"] + (-lx * sn + lz * c) * 1.08, bottom))
    vs = ring_t + ring_b + [V(s["centre"]["x"], s["centre"]["z"], height + 0.01)]
    fs = [(len(vs) - 1, k, (k + 1) % segs_) for k in range(segs_)]
    fs += [(k, segs_ + k, segs_ + (k + 1) % segs_, (k + 1) % segs_) for k in range(segs_)]
    ob = mesh_obj(s["id"], vs, fs, mat, smooth_=False)
    b = ob.modifiers.new("bev", "BEVEL"); b.width = 0.08; b.segments = 2
    return ob


for s in F.SLABS:
    slab_obj(s, s["top"], SLAB)
for s in F.SEATS:
    c, sz = s["centre"], s["size"]
    slab_obj({"id": s["id"], "centre": c, "radiusX": sz["x"] / 2 + 0.05, "radiusZ": sz["z"] / 2 + 0.05, "yaw": 0.0}, s["seatTop"], SLAB, bottom=-0.1)
for k, lp in enumerate(F.LAMPS):
    bpy.ops.mesh.primitive_cylinder_add(radius=0.12, depth=0.25, location=V(lp["x"], lp["z"], 0.1))
    bpy.context.object.data.materials.append(LAMP)


# placeholder trees (grey-box, only for scale and framing): plateau and flanks, none in the sight line
def tree(x, z, y, h, kind):
    bpy.ops.mesh.primitive_cylinder_add(radius=0.18 * h / 8, depth=h * 0.5, location=V(x, z, y + h * 0.25), vertices=8)
    bpy.context.object.data.materials.append(BARK)
    if kind == "pine":
        for i in range(3):
            bpy.ops.mesh.primitive_cone_add(radius1=h * (0.28 - i * 0.06), depth=h * 0.45, location=V(x, z, y + h * (0.45 + i * 0.18)), vertices=9)
            bpy.context.object.data.materials.append(LEAF)
    else:
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=h * 0.32, location=V(x, z, y + h * 0.7))
        o = bpy.context.object; o.scale.z = 0.8; o.data.materials.append(LEAF2)


rng = random.Random(11)
for k in range(260):
    x = rng.uniform(S["minX"] + 1, S["maxX"] - 1)
    z = rng.uniform(S["minZ"] + 1, S["maxZ"] - 1)
    y = F.terrain_y(x, z)
    gy = (F.terrain_y(x + 1, z) - y, F.terrain_y(x, z + 1) - y)
    steep = math.hypot(*gy) > 1.0
    bare = abs(z - F.FZ) < F.FLANK_START - 1 and y < F.PLATEAU_Y - 1.5
    if steep and abs(z - F.FZ) < F.FLANK_FULL or bare:
        continue
    if y < 0.6 or F.in_box(x, z, F.POCKET, 2.0) or F.pool_signed_dist(x, z) < 3 or abs(z - F.CHANNEL_Z_TOP) < 4 and y > F.TOP - 2:
        continue
    tree(x, z, y - 0.3, rng.uniform(7, 12), "pine" if (y > 30 or rng.random() < 0.4) else "decid")
# avatar for scale on the front slab: 2.16 m chibi
AX, AZ = -103.4, -77.6
bpy.ops.mesh.primitive_cylinder_add(radius=0.35, depth=1.0, location=V(AX, AZ, 0.75)); bpy.context.object.data.materials.append(AVATAR)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.58, location=V(AX, AZ, 1.83)); bpy.context.object.data.materials.append(SKIN)
# context: the CURRENT village terrain round the site (parts_nature.terrain_h), with the site box left as a hole
import parts_nature as PN  # noqa: E402
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
ctx = mesh_obj("village_context", cv_, cf_, TERRAIN, attrs={"shore": [0.0] * len(cv_)})
for k in range(520):
    x, z = rng.uniform(CX0, -98), rng.uniform(CZ0, CZ1)
    if F.in_box(x, z, S, 1.0) or (x > -100 and -92 < z < -64):
        continue
    y = PN.terrain_h(x, z)
    if math.hypot(PN.terrain_h(x + 1, z) - y, PN.terrain_h(x, z + 1) - y) > 1.2 or y < 0.5:
        continue
    tree(x, z, y - 0.3, rng.uniform(7, 12), "pine" if rng.random() < 0.45 else "decid")


# contract outlines (plan view only; hidden in perspective shots)
lines = []


def polyline(name, pts, mat, y=0.3, closed=False, w=0.18):
    vs, fs = [], []
    seq = pts + ([pts[0]] if closed else [])
    for (x, z) in seq:
        vs.append((x, z))
    verts, faces = [], []
    for k in range(len(vs) - 1):
        (x0, z0), (x1, z1) = vs[k], vs[k + 1]
        ln = math.hypot(x1 - x0, z1 - z0) or 1
        px, pz = -(z1 - z0) / ln * w, (x1 - x0) / ln * w
        b = len(verts)
        verts += [V(x0 - px, z0 - pz, y), V(x0 + px, z0 + pz, y), V(x1 + px, z1 + pz, y), V(x1 - px, z1 - pz, y)]
        faces.append((b, b + 1, b + 2, b + 3))
    ob = mesh_obj(name, verts, faces, mat, smooth_=False)
    lines.append(ob)
    return ob


def box_pts(b):
    return [(b["minX"], b["minZ"]), (b["maxX"], b["minZ"]), (b["maxX"], b["maxZ"]), (b["minX"], b["maxZ"])]


polyline("ln_site", box_pts(S), LINE["site"], y=45, closed=True, w=0.25)
polyline("ln_pocket", box_pts(F.POCKET), LINE["pocket"], y=45, closed=True)
polyline("ln_entry", [(F.ENTRY["x"], F.ENTRY["minZ"]), (F.ENTRY["x"], F.ENTRY["maxZ"])], LINE["entry"], y=45.1, w=0.35)
polyline("ln_pool", [(F.POOL_CX + F.POOL_RX * math.cos(a), F.POOL_CZ + F.POOL_RZ * math.sin(a)) for a in [2 * math.pi * k / 64 for k in range(64)]],
         LINE["outlet"], y=45, closed=True, w=0.1)
kr = F.POOL["keepOut"]
polyline("ln_keep", [(F.POOL_CX + (F.POOL_RX + kr) * math.cos(a), F.POOL_CZ + (F.POOL_RZ + kr) * math.sin(a)) for a in [2 * math.pi * k / 64 for k in range(64)]],
         LINE["keep"], y=45, closed=True, w=0.1)
polyline("ln_cam", [(p["x"], p["z"]) for p in F.CAMERA_WALL], LINE["cam"], y=45)
polyline("ln_outlet", [(p["x"], p["z"]) for p in F.OUTLET["points"]], LINE["outlet"], y=45, w=0.12)

# ------------------------------------------------------------------------------------------- world, render --
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
env = w.node_tree.nodes.new("ShaderNodeTexEnvironment"); env.image = bpy.data.images.load(HDRI)
bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND"); bg.inputs["Strength"].default_value = 0.9
w.node_tree.links.new(env.outputs["Color"], bg.inputs["Color"])
sun = bpy.data.lights.new("sun", "SUN"); sun.energy = 3.2; sun.angle = math.radians(1.5)
so = bpy.data.objects.new("sun", sun); sc.collection.objects.link(so)
so.rotation_euler = Vector((-1.0, 0.45, -0.75)).to_track_quat("-Z", "Y").to_euler()  # morning sun from the east-north-east
try:
    sc.render.engine = "CYCLES"
except TypeError:
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
sc.view_settings.exposure = 0.4
sc.render.image_settings.file_format = "PNG"


def shoot(name, loc, target, lens, ortho=None, show_lines=False):
    if ONLY and ONLY != name:
        return
    for ob in lines:
        ob.hide_render = not show_lines
    cam = bpy.data.cameras.new(name); cam.lens = lens
    if ortho:
        cam.type = "ORTHO"; cam.ortho_scale = ortho
        cam.clip_end = 500
    co = bpy.data.objects.new(name, cam); sc.collection.objects.link(co)
    co.location = loc
    d = Vector(target) - Vector(loc)
    co.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    sc.camera = co
    sc.render.filepath = os.path.join(OUT, name + ".png")
    bpy.ops.render.render(write_still=True)
    print("wrote", sc.render.filepath)


# S7-like: behind the avatar on the slab, looking up-west at the falls
shoot("w0-pool-view", V(-93.5, -74.0, 3.6), V(-115.0, -78.5, 9.5), 18)
# from the village side (beyond the walk bounds' corner), the whole cliff in its gorge
shoot("w0-wide", V(-52.0, -98.0, 8.0), V(-116.0, -78.0, 16.0), 28)
# plan view with the contract outlines: white site, yellow pocket, red entry, blue waterline/outlet, pink keep-out, cyan camera wall
shoot("w0-plan", V(-118.0, -81.0, 120.0), V(-118.0, -81.0001, 0.0), 50, ortho=84, show_lines=True)
