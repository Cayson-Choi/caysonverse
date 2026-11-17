"""Waterfall B1 blockout render (design doc only). Local frame: +X = east (toward the village), Z up.
Cliff face near x = 0, plunge pool centre x = +7, player deck x = +12..+18. Matches game: local x = game x + 118 - 0,
local y = -(game z + 78)."""
import bpy, math, random, sys, os
from mathutils import Vector, noise

ROOT = r"D:\ClaudeCode\caysonverse-falls"
TEX = os.path.join(ROOT, r"art\village\downloads\tex")
HDRI = os.path.join(ROOT, r"art\village\downloads\hdri\kloppenheim_06_puresky_1k.hdr")
OUT = os.path.join(ROOT, r"docs\designs\waterfall")

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
random.seed(3)

# ---------------------------------------------------------------- materials
def img(name):
    return bpy.data.images.load(os.path.join(TEX, name), check_existing=True)

def rock_mat(name, diff, nor, tint=(1, 1, 1), wet=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (0.16, 0.16, 0.16)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    t = nt.nodes.new("ShaderNodeTexImage"); t.image = img(diff); t.projection = "BOX"; t.projection_blend = 0.3
    nt.links.new(mp.outputs["Vector"], t.inputs["Vector"])
    tn = nt.nodes.new("ShaderNodeTexImage"); tn.image = img(nor); tn.image.colorspace_settings.name = "Non-Color"
    tn.projection = "BOX"; tn.projection_blend = 0.3
    nt.links.new(mp.outputs["Vector"], tn.inputs["Vector"])
    nm = nt.nodes.new("ShaderNodeNormalMap"); nm.inputs["Strength"].default_value = 1.6
    nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    # moss on up-facing ledges: geometry normal z
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Normal"], sep.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeMapRange")
    ramp.inputs["From Min"].default_value = 0.55; ramp.inputs["From Max"].default_value = 0.85
    nt.links.new(sep.outputs["Z"], ramp.inputs["Value"])
    mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"
    tintn = nt.nodes.new("ShaderNodeMix"); tintn.data_type = "RGBA"; tintn.blend_type = "MULTIPLY"
    tintn.inputs["Factor"].default_value = 1.0
    tintn.inputs[7].default_value = (*tint, 1)
    hs = nt.nodes.new("ShaderNodeHueSaturation"); hs.inputs["Saturation"].default_value = 0.18
    nt.links.new(t.outputs["Color"], hs.inputs["Color"])
    nt.links.new(hs.outputs["Color"], tintn.inputs[6])
    nt.links.new(ramp.outputs["Result"], mix.inputs["Factor"])
    nt.links.new(tintn.outputs[2], mix.inputs[6])
    mix.inputs[7].default_value = (0.13, 0.20, 0.06, 1)
    nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.35 if wet else 0.85
    return m

ROCK = rock_mat("rock_face", "rock_face_diff_1k.jpg", "rock_face_nor_gl_1k.jpg", tint=(0.78, 0.78, 0.74))
WET = rock_mat("rock_wet", "rock_face_diff_1k.jpg", "rock_face_nor_gl_1k.jpg", tint=(0.42, 0.42, 0.40), wet=True)
BOULDER = rock_mat("boulder", "rock_boulder_dry_diff_1k.jpg", "rock_boulder_dry_nor_gl_1k.jpg", tint=(0.9, 0.9, 0.88))
SLAB = rock_mat("slab", "dry_riverbed_rock_diff_1k.jpg", "dry_riverbed_rock_nor_gl_1k.jpg")
BED = rock_mat("bed", "river_small_rocks_diff_1k.jpg", "river_small_rocks_nor_gl_1k.jpg", tint=(0.6, 0.65, 0.55))

def water_mat():
    m = bpy.data.materials.new("pool")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (0.05, 0.22, 0.17, 1)
    bsdf.inputs["Roughness"].default_value = 0.04
    bsdf.inputs["Transmission Weight"].default_value = 0.85
    bsdf.inputs["IOR"].default_value = 1.33
    nz = nt.nodes.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 3.0
    bump = nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.25
    nt.links.new(nz.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    # emerald absorption
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    vol = nt.nodes.new("ShaderNodeVolumeAbsorption")
    vol.inputs["Color"].default_value = (0.25, 0.75, 0.55, 1); vol.inputs["Density"].default_value = 0.9
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
    bsdf.inputs["Subsurface Weight"].default_value = 0.2
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (6.0, 0.35, 1.0)
    nt.links.new(tc.outputs["UV"], mp.inputs["Vector"])
    nz = nt.nodes.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 6.0; nz.inputs["Detail"].default_value = 8
    nt.links.new(mp.outputs["Vector"], nz.inputs["Vector"])
    # alpha: streaks + edge fade (uv.x 0..1 across)
    sep = nt.nodes.new("ShaderNodeSeparateXYZ"); nt.links.new(tc.outputs["UV"], sep.inputs["Vector"])
    edge = nt.nodes.new("ShaderNodeMath"); edge.operation = "PINGPONG"; edge.inputs[1].default_value = 0.5
    nt.links.new(sep.outputs["X"], edge.inputs[0])
    edge2 = nt.nodes.new("ShaderNodeMapRange"); edge2.inputs["From Min"].default_value = 0.0; edge2.inputs["From Max"].default_value = 0.22
    nt.links.new(edge.outputs[0], edge2.inputs["Value"])
    cr = nt.nodes.new("ShaderNodeMapRange"); cr.inputs["From Min"].default_value = 0.35; cr.inputs["From Max"].default_value = 0.62
    nt.links.new(nz.outputs["Fac"], cr.inputs["Value"])
    mul = nt.nodes.new("ShaderNodeMath"); mul.operation = "MULTIPLY"
    nt.links.new(cr.outputs["Result"], mul.inputs[0]); nt.links.new(edge2.outputs["Result"], mul.inputs[1])
    vc = nt.nodes.new("ShaderNodeAttribute"); vc.attribute_name = "dens"
    mul2 = nt.nodes.new("ShaderNodeMath"); mul2.operation = "MULTIPLY"
    nt.links.new(mul.outputs[0], mul2.inputs[0]); nt.links.new(vc.outputs["Fac"], mul2.inputs[1])
    nt.links.new(mul2.outputs[0], bsdf.inputs["Alpha"])
    bsdf.inputs["Emission Color"].default_value = (0.8, 0.88, 0.95, 1)
    bsdf.inputs["Emission Strength"].default_value = 0.25
    return m
FALLS = falls_mat()

def flat(name, rgb, rough=0.9):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*rgb, 1); b.inputs["Roughness"].default_value = rough
    return m
GRASS = flat("grass", (0.10, 0.22, 0.05))
LEAF = flat("leaf", (0.06, 0.16, 0.04))
LEAF2 = flat("leaf2", (0.12, 0.20, 0.05))
BARK = flat("bark", (0.12, 0.08, 0.05))
AVATAR = flat("avatar", (0.1, 0.25, 0.8), 0.5)
FOAM = flat("foam", (0.95, 0.97, 1.0), 0.5)

def mesh_obj(name, verts, faces, mat, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    sc.collection.objects.link(ob)
    ob.data.materials.append(mat)
    if smooth:
        for p in me.polygons: p.use_smooth = True
    return ob

# ---------------------------------------------------------------- cliff (heightfield along x)
TOP = 36.0          # total height (layout.backdrop.waterfall.height)
LEDGE = 17.0        # main free plunge from this ledge to the pool (upper part: stepped cascade)
W = 70.0
NU, NV = 160, 110

def cliff_x(y, z):
    """x of the rock face at (y, z): a ~34 m wide granite outcrop in a wooded gorge (flanks come forward as slopes),
    vertical joints + sheet exfoliation, an alcove behind the plunge, a cut channel above the ledge."""
    ay = abs(y)
    gorge = 0.03 * y * y + 0.0009 * ay ** 3           # flanks swing forward (east): ~ +22 m at |y| = 30
    flank = max(0.0, ay - 12.0) * 1.7 * max(0.0, 1 - z / (TOP + 6))  # flanks are wooded slopes (~50 deg), not walls
    rim = -4.0 * max(0.0, z - TOP) ** 1.5             # the top rolls over into the forested ridge
    vn = noise.voronoi(Vector((y * 0.16, z * 0.05, 0.3)), distance_metric="DISTANCE", exponent=2.5)
    joints = vn[0][0] * 2.6                           # tall blocks: vertical jointing (granite)
    sheet = 0.5 * math.floor(z / 3.7 + 0.8 * noise.noise(Vector((y * 0.07, 0.0, 1.0))))
    n1 = noise.fractal(Vector((y * 0.06, z * 0.05, 2.2)), 0.9, 2.0, 4) * 2.4
    n2 = noise.noise(Vector((y * 0.45, z * 0.45, 5.1))) * 0.35
    lean = -0.15 * z
    alc = -3.0 * math.exp(-(y / 5.5) ** 2) * max(0.0, 1 - z / LEDGE) ** 0.7
    chan = -2.4 * math.exp(-((y - 1.0) / 3.5) ** 2) * (1.0 if z > LEDGE - 0.5 else 0.0)
    lip = 1.2 * math.exp(-((z - LEDGE) / 0.9) ** 2) * math.exp(-(y / 6.0) ** 2)
    return gorge + flank + rim + joints + sheet * 0.5 + n1 + n2 + lean + alc + chan + lip

verts, faces = [], []
for j in range(NV + 1):
    z = -1.5 + (TOP + 9) * j / NV
    for i in range(NU + 1):
        y = -W / 2 + W * i / NU
        verts.append((cliff_x(y, z), y, z))
for j in range(NV):
    for i in range(NU):
        a = j * (NU + 1) + i
        faces.append((a, a + 1, a + NU + 2, a + NU + 1))
cliff = mesh_obj("cliff", verts, faces, ROCK)
# top: forested plateau going back west
pv = [(cliff_x(-W / 2, TOP + 3.5) - 0, -W / 2, TOP + 3.5), (cliff_x(W / 2, TOP + 3.5), W / 2, TOP + 3.5), (-60, W / 2, TOP + 8), (-60, -W / 2, TOP + 8)]

# wet rock behind the falls: a slightly offset copy of the central strip
wv, wf = [], []
NW = 40
for j in range(NV + 1):
    z = -1.5 + (TOP + 9) * j / NV
    for i in range(NW + 1):
        y = -9 + 18 * i / NW
        wv.append((cliff_x(y, z) + 0.06, y, z))
for j in range(NV):
    for i in range(NW):
        a = j * (NW + 1) + i
        wf.append((a, a + 1, a + NW + 2, a + NW + 1))
mesh_obj("wet", wv, wf, WET)

# ---------------------------------------------------------------- water
def ribbon(name, pts_fn, n, width_fn, dens_fn, off=0.0):
    vs, fs, dens = [], [], []
    for k in range(n + 1):
        t = k / n
        c, side = pts_fn(t)
        w = width_fn(t)
        for s in (-1, 1):
            vs.append(tuple(c + side * (s * w / 2)))
            dens.append(dens_fn(t))
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
    at = me.attributes.new("dens", "FLOAT", "POINT")
    for i, d in enumerate(dens): at.data[i].value = d
    return ob

# main plunge: leaves the ledge lip with v0 ~ 2.2 m/s -> parabola, widens and breaks up as it falls
lip_x = cliff_x(0, LEDGE) + 0.3
def plunge(yc, v0, w0, w1, name, d0=1.0):
    def P(t):
        z = LEDGE - t * (LEDGE + 0.3)
        tt = math.sqrt(2 * max(0.0, LEDGE - z) / 9.81)
        x = lip_x + v0 * tt
        return Vector((x, yc + 0.3 * math.sin(t * 5), z)), Vector((0, 1, 0))
    return ribbon(name, P, 40, lambda t: w0 + (w1 - w0) * t, lambda t: d0 * (1.0 - 0.25 * t))
plunge(0.0, 2.2, 3.4, 5.2, "plunge_main")
plunge(-2.6, 1.5, 0.9, 1.8, "plunge_side_a", 0.75)
plunge(2.9, 1.2, 0.7, 1.4, "plunge_side_b", 0.6)
# upper cascade: a sheet hugging the stepped rock (offset from the face), TOP -> LEDGE
def casc(yc, w, name, d0=0.9):
    def P(t):
        z = TOP + 2.0 - t * (TOP + 2.0 - LEDGE - 0.3)
        return Vector((cliff_x(yc, z) + 0.25, yc, z)), Vector((0, 1, 0))
    return ribbon(name, P, 60, lambda t: w * (0.8 + 0.4 * t), lambda t: d0)
casc(1.0, 3.0, "cascade_main")
casc(-1.5, 1.2, "cascade_b", 0.6)

# pool: ellipse 8 x 11 (rx along x, rz along y), centre x +7
def disc(name, cx, cy, rx, ry, z, mat, segs=48):
    vs = [(cx, cy, z)] + [(cx + rx * math.cos(2 * math.pi * i / segs), cy + ry * math.sin(2 * math.pi * i / segs), z) for i in range(segs)]
    fs = [(0, 1 + i, 1 + (i + 1) % segs) for i in range(segs)]
    return mesh_obj(name, vs, fs, mat)
pool = disc("pool", 6.5, 0, 8.5, 11, -0.25, POOL)
# give the pool a thin volume (solidify) so absorption reads
mod = pool.modifiers.new("solid", "SOLIDIFY"); mod.thickness = 2.2
# bed under the pool
bed = disc("bed", 6.5, 0, 9.5, 12, -2.4, BED)
# foam: rings of small flattened spheres at the impact point
impact_x = lip_x + 2.2 * math.sqrt(2 * LEDGE / 9.81)
for k in range(46):
    a = random.uniform(0, 2 * math.pi); r = random.uniform(0.2, 3.6)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=random.uniform(0.35, 0.9), location=(impact_x + r * math.cos(a), r * math.sin(a) * 1.2, -0.2), segments=10, ring_count=6)
    o = bpy.context.object; o.scale.z = 0.25; o.data.materials.append(FOAM)

# mist: a volume scatter ellipsoid at the base
bpy.ops.mesh.primitive_uv_sphere_add(radius=1, location=(impact_x + 1.0, 0, 2.5))
mist = bpy.context.object; mist.scale = (6, 7, 4.5)
mm = bpy.data.materials.new("mist"); mm.use_nodes = True
nt = mm.node_tree
for n in list(nt.nodes):
    if n.type == "BSDF_PRINCIPLED": nt.nodes.remove(n)
out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
vs_ = nt.nodes.new("ShaderNodeVolumePrincipled"); vs_.inputs["Density"].default_value = 0.0
tc = nt.nodes.new("ShaderNodeTexCoord"); grad = nt.nodes.new("ShaderNodeTexGradient"); grad.gradient_type = "SPHERICAL"
nt.links.new(tc.outputs["Object"], grad.inputs["Vector"])
nz = nt.nodes.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 2.5
nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
m1 = nt.nodes.new("ShaderNodeMath"); m1.operation = "MULTIPLY"
nt.links.new(grad.outputs["Fac"], m1.inputs[0]); nt.links.new(nz.outputs["Fac"], m1.inputs[1])
m2 = nt.nodes.new("ShaderNodeMath"); m2.operation = "MULTIPLY"; m2.inputs[1].default_value = 0.22
nt.links.new(m1.outputs[0], m2.inputs[0])
nt.links.new(m2.outputs[0], vs_.inputs["Density"])
vs_.inputs["Color"].default_value = (0.95, 0.97, 1, 1)
nt.links.new(vs_.outputs[0], out.inputs["Volume"])
mist.data.materials.append(mm)

# ---------------------------------------------------------------- boulders, slabs (walkable granite on the east bank)
def boulder(x, y, z, sx, sy, sz, seed, mat=BOULDER):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=1, location=(x, y, z))
    o = bpy.context.object; o.scale = (sx, sy, sz); o.rotation_euler.z = seed
    d = o.modifiers.new("d", "DISPLACE")
    t = bpy.data.textures.new(f"vn{seed}", "VORONOI"); t.noise_scale = 0.8
    d.texture = t; d.strength = 0.35
    o.data.materials.append(mat)
    for p in o.data.polygons: p.use_smooth = False
    return o
for k in range(28):
    a = random.uniform(-2.4, 2.4)
    rx, ry = 8.8 + random.uniform(-0.6, 1.5), 11.3 + random.uniform(-0.6, 1.5)
    x, y = 6.5 + rx * math.cos(a), ry * math.sin(a)
    if x > 12.5 and abs(y) < 7: continue  # leave the east bank open for the slabs
    s = random.uniform(0.7, 2.2)
    boulder(x, y, -0.2, s * 1.3, s, s * 0.7, k)
# 너럭바위: low flat granite slabs on the east bank (the player's viewing ledge)
for k, (x, y, sx, sy) in enumerate(((14.5, -1.5, 3.2, 2.6), (15.5, 2.8, 2.6, 2.2), (13.2, 4.5, 1.6, 1.3), (16.8, -4.6, 2.4, 2.0))):
    boulder(x, y, -0.3, sx, sy, 0.55, 100 + k, SLAB)
# ground
mesh_obj("ground", [(18.5, -60, 0.05), (120, -60, 0.05), (120, 60, 0.05), (18.5, 60, 0.05)], [(0, 1, 2, 3)], GRASS, smooth=False)
beach = disc("beach", 9.5, 0, 12.5, 15, -0.45, BED)
for (x, y) in ((10, -14), (12, 13)):
    pass

# trees (blockout): pines on the plateau and the flanks, deciduous by the pool
def tree(x, y, z, h, kind):
    bpy.ops.mesh.primitive_cylinder_add(radius=0.18 * h / 8, depth=h * 0.5, location=(x, y, z + h * 0.25), vertices=8)
    bpy.context.object.data.materials.append(BARK)
    if kind == "pine":
        for i in range(3):
            bpy.ops.mesh.primitive_cone_add(radius1=h * (0.28 - i * 0.06), depth=h * 0.45, location=(x, y, z + h * (0.45 + i * 0.18)), vertices=9)
            bpy.context.object.data.materials.append(LEAF)
    else:
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=h * 0.32, location=(x, y, z + h * 0.7))
        o = bpy.context.object; o.scale.z = 0.8; o.data.materials.append(LEAF2)
for k in range(70):
    y = random.uniform(-34, 34); x = random.uniform(-40, cliff_x(y, TOP) - 2)
    if abs(y) < 5 and x > -10: continue
    tree(x, y, TOP + 3.5 + (-x) * 0.06, random.uniform(7, 12), "pine")
for k in range(90):
    sgn = random.choice((-1, 1)); y = sgn * random.uniform(15, 34); z = random.uniform(0, TOP + 2)
    tree(cliff_x(y, z) - 0.5, y, z - 0.5, random.uniform(6, 11), "decid" if k % 3 else "pine")
for k in range(30):
    y = random.uniform(-15, 15)
    if abs(y - 1) < 4.5: continue
    zz = TOP + random.uniform(2, 7); tree(cliff_x(y, zz) - 0.5, y, zz - 0.4, random.uniform(6, 10), "decid")

# avatar for scale: 2.16 m chibi (capsule + big head)
bpy.ops.mesh.primitive_cylinder_add(radius=0.35, depth=1.0, location=(14.8, -1.0, 0.5 + 0.25))
bpy.context.object.data.materials.append(AVATAR)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.58, location=(14.8, -1.0, 1.58 + 0.25))
bpy.context.object.data.materials.append(flat("skin", (0.9, 0.7, 0.55)))

# ---------------------------------------------------------------- world, light, cameras
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
env = w.node_tree.nodes.new("ShaderNodeTexEnvironment"); env.image = bpy.data.images.load(HDRI)
bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND"); bg.inputs["Strength"].default_value = 0.9
w.node_tree.links.new(env.outputs["Color"], bg.inputs["Color"])
sun = bpy.data.lights.new("sun", "SUN"); sun.energy = 3.2; sun.angle = math.radians(1.5)
so = bpy.data.objects.new("sun", sun); sc.collection.objects.link(so)
so.rotation_euler = Vector((-1.0, 0.45, -0.75)).to_track_quat("-Z", "Y").to_euler()  # morning sun from the east (the face looks east)

try:
    sc.render.engine = "CYCLES"
except TypeError:
    pass
sc.cycles.samples = int(os.environ.get("CV_SAMPLES", "96"))
sc.cycles.use_denoising = True
prefs = bpy.context.preferences.addons["cycles"].preferences
for dev_type in ("OPTIX", "CUDA", "HIP", "ONEAPI"):
    try:
        prefs.compute_device_type = dev_type
        prefs.get_devices()
        if any(d.type == dev_type for d in prefs.devices):
            for d in prefs.devices: d.use = True
            sc.cycles.device = "GPU"
            break
    except Exception:
        continue
sc.render.resolution_x, sc.render.resolution_y = 1280, 720
sc.view_settings.view_transform = "AgX"
sc.view_settings.exposure = 0.4
sc.render.image_settings.file_format = "PNG"

def shoot(name, loc, target, lens):
    cam = bpy.data.cameras.new(name); cam.lens = lens
    co = bpy.data.objects.new(name, cam); sc.collection.objects.link(co)
    co.location = loc
    d = Vector(target) - Vector(loc)
    co.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    sc.camera = co
    sc.render.filepath = os.path.join(OUT, name + ".png")
    bpy.ops.render.render(write_still=True)
    print("wrote", sc.render.filepath)

# 1) third-person player view from the granite slabs (avatar in frame), looking up-west at the falls
shoot("blockout-pool-view", (24.5, -4.0, 3.6), (3, 0.5, 9.5), 18)
# 2) wide view from the village edge (game x -95 = local +23 ... further back at +45), whole cliff
shoot("blockout-wide", (66, 20, 8), (2, 0, 16), 28)
