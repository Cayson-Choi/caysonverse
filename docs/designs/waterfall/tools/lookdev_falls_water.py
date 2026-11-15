"""B1 waterfall W2 look-dev: renders the W2 water meshes (parts_falls_water.py) over a STAND-IN rock/ground built from
falls_shape (not W1's art) to judge the water shapes and the flow motion. The node shaders here are Cycles approximations of
the runtime contract (design 5.2): two-phase scroll of T_falls_flow by COLOR_0 G speed on the plunge, a two-phase flow map from
COLOR_0 RG on the cascade, ripple rings on the pool. W4 writes the real three.js shaders.

  blender -b --factory-startup -P lookdev_falls_water.py -- [--out DIR] [--samples N] [--shots a,b,..] [--anim] [--tier high|low]

shots: s7 (rest area view), s8 (front slab, close), s9 (side), cascade (upper cascade close-up), foam (pool level), wide
--anim: renders 12 frames of the s8 view at 1/12 s steps to OUT/anim/ and writes OUT/flow_strip.png (a 6-frame strip).
"""
import json
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import falls_shape as F  # noqa: E402
import parts_falls_water as PW  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ART = os.path.dirname(HERE)
OUT = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(ART, "work", "falls_w2")
SAMPLES = int(argv[argv.index("--samples") + 1]) if "--samples" in argv else 64
SHOTS = argv[argv.index("--shots") + 1].split(",") if "--shots" in argv else ["s7", "s8", "s9", "cascade", "foam", "wide"]
TIER = argv[argv.index("--tier") + 1] if "--tier" in argv else "high"
TEXDIR = os.path.join(ART, "work", "tex")
DL = os.path.join(ART, "downloads", "tex")
HDRI = os.path.join(ART, "downloads", "hdri", "kloppenheim_06_puresky_1k.hdr")
os.makedirs(OUT, exist_ok=True)


def V(x, z, y):
    return (x, -z, y)


bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene


def img(path, data=False):
    im = bpy.data.images.load(path, check_existing=True)
    if data:
        im.colorspace_settings.name = "Non-Color"
    return im


# -------------------------------------------------------------------------------------------- stand-in rock --
def rock_mat():
    m = bpy.data.materials.new("rock")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (0.25, 0.25, 0.25)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    t = nt.nodes.new("ShaderNodeTexImage"); t.image = img(os.path.join(DL, "rock_face_diff_1k.jpg")); t.projection = "BOX"; t.projection_blend = 0.3
    nt.links.new(mp.outputs["Vector"], t.inputs["Vector"])
    hs = nt.nodes.new("ShaderNodeHueSaturation"); hs.inputs["Saturation"].default_value = 0.18
    nt.links.new(t.outputs["Color"], hs.inputs["Color"])
    at = nt.nodes.new("ShaderNodeAttribute"); at.attribute_name = "wet"
    mw = nt.nodes.new("ShaderNodeMix"); mw.data_type = "RGBA"; mw.blend_type = "MULTIPLY"
    nt.links.new(at.outputs["Fac"], mw.inputs["Factor"])
    nt.links.new(hs.outputs["Color"], mw.inputs[6]); mw.inputs[7].default_value = (0.42, 0.42, 0.42, 1)
    geo = nt.nodes.new("ShaderNodeNewGeometry"); sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Normal"], sep.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeMapRange"); ramp.inputs["From Min"].default_value = 0.6; ramp.inputs["From Max"].default_value = 0.9
    nt.links.new(sep.outputs["Z"], ramp.inputs["Value"])
    mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"
    nt.links.new(ramp.outputs["Result"], mix.inputs["Factor"])
    nt.links.new(mw.outputs[2], mix.inputs[6]); mix.inputs[7].default_value = (0.12, 0.19, 0.06, 1)
    nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.8
    return m


def gravel_mat():
    m = bpy.data.materials.new("gravel")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tc = nt.nodes.new("ShaderNodeTexCoord"); mp = nt.nodes.new("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (0.5, 0.5, 0.5)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    t = nt.nodes.new("ShaderNodeTexImage"); t.image = img(os.path.join(DL, "river_small_rocks_diff_1k.jpg")); t.projection = "BOX"
    nt.links.new(mp.outputs["Vector"], t.inputs["Vector"])
    nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.8
    return m


def flat(name, rgb, rough=0.9):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*rgb, 1); b.inputs["Roughness"].default_value = rough
    return m


def mesh_obj(name, verts, faces, mat, attrs=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    sc.collection.objects.link(ob)
    ob.data.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = True
    for an, vals in (attrs or {}).items():
        at = me.attributes.new(an, "FLOAT", "POINT")
        for i, v in enumerate(vals):
            at.data[i].value = v
    return ob


def wetness(x, y, z):
    d_ch = abs(z - F.channel_z(y)) if y > F.LEDGE - 0.5 else 99.0
    d_pl = abs(z - F.LIP["z"]) if y <= F.LEDGE + 0.5 else 99.0
    w = max(math.exp(-(d_ch / 3.2) ** 2), math.exp(-(d_pl / 4.2) ** 2) if y > -1 else 0.0)
    near = math.hypot(x - F.IMPACT["x"], z - F.IMPACT["z"]) - 6.0
    return min(1.0, max(w, math.exp(-max(0.0, near) / 3.0) * (1.0 if y < 6 else 0.0)))


def build_standin():
    cache = os.path.join(OUT, "standin_cache.json")
    S = F.SITE
    STEP = 0.5
    nx, nz = int((S["maxX"] - S["minX"]) / STEP), int((S["maxZ"] - S["minZ"]) / STEP)
    if os.path.exists(cache):
        H = json.load(open(cache))
    else:
        H = [[F.terrain_y(S["minX"] + i * STEP, S["minZ"] + j * STEP) for i in range(nx + 1)] for j in range(nz + 1)]
        json.dump(H, open(cache, "w"))
    tv, tf = [], []
    for j in range(nz + 1):
        for i in range(nx + 1):
            tv.append(V(S["minX"] + i * STEP, S["minZ"] + j * STEP, H[j][i]))
    for j in range(nz):
        for i in range(nx):
            z = S["minZ"] + j * STEP
            hs = (H[j][i], H[j][i + 1], H[j + 1][i], H[j + 1][i + 1])
            if max(hs) - min(hs) > 1.4 * STEP and F.FACE_Z[0] + 1 <= z <= F.FACE_Z[1] - 1 and abs(z - F.FZ) < F.FLANK_FULL - 1.0:
                continue
            a = j * (nx + 1) + i
            tf.append((a, a + 1, a + nx + 2, a + nx + 1))
    rock = rock_mat()
    mesh_obj("standin_ground", tv, tf, rock, attrs={"wet": [0.0] * len(tv)})
    FS = 0.25
    zs = [F.FACE_Z[0] + FS * k for k in range(int((F.FACE_Z[1] - F.FACE_Z[0]) / FS) + 1)]
    ys = [F.FACE_Y[0] + FS * k for k in range(int((F.FACE_Y[1] - F.FACE_Y[0]) / FS) + 1)]
    fv, ff, wet, keep = [], [], [], []
    fcache = os.path.join(OUT, "standin_face.json")
    FX = json.load(open(fcache)) if os.path.exists(fcache) else [[F.face_x(z, y) for z in zs] for y in ys]
    if not os.path.exists(fcache):
        json.dump(FX, open(fcache, "w"))
    for jy, y in enumerate(ys):
        for iz, z in enumerate(zs):
            x = FX[jy][iz]
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
    mesh_obj("standin_face", fv, ff, rock, attrs={"wet": wet})
    # the pool bed shows through the shallow water: gravel disc under the pool, following pool_bed_y
    rings, segs = (0.0, 0.3, 0.6, 0.8, 0.92, 1.0, 1.05), 40
    bv = [V(F.POOL_CX, F.POOL_CZ, F.pool_bed_y(F.POOL_CX, F.POOL_CZ))]
    for q in rings[1:]:
        for k in range(segs):
            th = 2 * math.pi * k / segs
            x, z = F.POOL_CX + q * F.POOL_RX * math.cos(th), F.POOL_CZ + q * F.POOL_RZ * math.sin(th)
            bv.append(V(x, z, min(F.pool_bed_y(x, z), F.floor_y(x, z)) - 0.02))
    bf = [(0, 1 + (k + 1) % segs, 1 + k) for k in range(segs)]
    for r in range(len(rings) - 2):
        a0, a1 = 1 + r * segs, 1 + (r + 1) * segs
        for k in range(segs):
            k2 = (k + 1) % segs
            bf.append((a0 + k, a0 + k2, a1 + k2, a1 + k))
    mesh_obj("standin_poolbed", bv, bf, gravel_mat())
    # slabs for scale + an avatar (2.16 m)
    slab = flat("slab", (0.55, 0.55, 0.53))
    for s in F.SLABS:
        bpy.ops.mesh.primitive_cylinder_add(radius=1.0, depth=0.5, vertices=24, location=V(s["centre"]["x"], s["centre"]["z"], s["top"] - 0.25))
        o = bpy.context.object
        o.scale = (s["radiusX"], s["radiusZ"], 1.0)
        o.rotation_euler[2] = -s["yaw"]
        o.data.materials.append(slab)
    AX, AZ = -103.4, -77.6
    bpy.ops.mesh.primitive_cylinder_add(radius=0.35, depth=1.0, location=V(AX, AZ, 0.75)); bpy.context.object.data.materials.append(flat("avatar", (0.1, 0.25, 0.8), 0.5))
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.58, location=V(AX, AZ, 1.83)); bpy.context.object.data.materials.append(flat("skin", (0.9, 0.7, 0.55)))


# --------------------------------------------------------------------------------------------- water shaders --
class NB:
    """Tiny node-builder: every helper returns an output socket."""

    def __init__(self, nt):
        self.nt = nt

    def node(self, t, **kw):
        n = self.nt.nodes.new(t)
        for k, v in kw.items():
            setattr(n, k, v)
        return n

    def _in(self, node, idx, v):
        if hasattr(v, "node"):
            self.nt.links.new(v, node.inputs[idx])
        else:
            node.inputs[idx].default_value = v

    def math(self, op, a, b=None, c=None, clamp=False):
        n = self.node("ShaderNodeMath", operation=op, use_clamp=clamp)
        self._in(n, 0, a)
        if b is not None:
            self._in(n, 1, b)
        if c is not None:
            self._in(n, 2, c)
        return n.outputs[0]

    def mul(self, a, b, clamp=False): return self.math("MULTIPLY", a, b, clamp=clamp)
    def add(self, a, b, clamp=False): return self.math("ADD", a, b, clamp=clamp)
    def sub(self, a, b, clamp=False): return self.math("SUBTRACT", a, b, clamp=clamp)
    def sat(self, a): return self.math("ADD", a, 0.0, clamp=True)
    def mad(self, a, b, c, clamp=False): return self.math("MULTIPLY_ADD", a, b, c, clamp=clamp)

    def ramp(self, v, a, b, clamp=True):
        """map_range from [a, b] to [0, 1]."""
        n = self.node("ShaderNodeMapRange", clamp=clamp)
        self._in(n, 0, v); n.inputs[1].default_value = a; n.inputs[2].default_value = b
        return n.outputs[0]

    def mix(self, fac, a, b):
        n = self.node("ShaderNodeMix", data_type="RGBA")
        self._in(n, 0, fac); self._in(n, 6, a); self._in(n, 7, b)
        return n.outputs[2]


def img_node(nb, path, vec):
    t = nb.node("ShaderNodeTexImage", image=img(path, data=True), interpolation="Linear", extension="REPEAT")
    nb.nt.links.new(vec, t.inputs["Vector"])
    return t


FLOW = os.path.join(TEXDIR, "T_falls_flow.png")
TIMES = []                      # value nodes holding time (seconds); set before each render


def time_node(nb):
    n = nb.node("ShaderNodeValue")
    n.outputs[0].default_value = 0.0
    TIMES.append(n)
    return n.outputs[0]


def finish(nb, color, alpha, rough=0.3, emit=0.35, emit_color=None, spec=0.5):
    nt = nb.nt
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    for n in list(nt.nodes):
        if n.type == "BSDF_PRINCIPLED":
            nt.nodes.remove(n)
    b = nb.node("ShaderNodeBsdfPrincipled")
    nt.links.new(color, b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = rough
    b.inputs["Emission Strength"].default_value = emit
    nt.links.new(color, b.inputs["Emission Color"])
    b.inputs["Specular IOR Level"].default_value = spec
    tr = nb.node("ShaderNodeBsdfTransparent")
    mx = nb.node("ShaderNodeMixShader")
    nt.links.new(alpha, mx.inputs[0]); nt.links.new(tr.outputs[0], mx.inputs[1]); nt.links.new(b.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs["Surface"])


def vcol(nb):
    a = nb.node("ShaderNodeAttribute", attribute_name="Color")
    sp = nb.node("ShaderNodeSeparateColor")
    nb.nt.links.new(a.outputs["Color"], sp.inputs["Color"])
    return sp.outputs[0], sp.outputs[1], sp.outputs[2], a.outputs["Alpha"]


def mat_plunge():
    m = bpy.data.materials.new("M_falls_water")
    m.use_nodes = True
    nb = NB(m.node_tree)
    uv = nb.node("ShaderNodeTexCoord").outputs["UV"]
    sep = nb.node("ShaderNodeSeparateXYZ"); nb.nt.links.new(uv, sep.inputs[0])
    u, v = sep.outputs[0], sep.outputs[1]
    R, G, B, A = vcol(nb)
    t = time_node(nb)
    Tc = 0.8
    ph0 = nb.math("FRACT", nb.mul(t, 1.0 / Tc))
    ph1 = nb.math("FRACT", nb.add(nb.mul(t, 1.0 / Tc), 0.5))
    wA = nb.sub(1.0, nb.math("ABSOLUTE", nb.sub(nb.mul(ph0, 2.0), 1.0)))      # weight of phase A (0 at the reset)

    def sample(mult, ph, uoff):
        k = nb.mul(nb.mad(G, 2.4, 0.5), mult * Tc)                            # tiles scrolled per cycle at this speed
        vv = nb.sub(v, nb.mul(k, ph))
        vec = nb.node("ShaderNodeCombineXYZ")
        nb.nt.links.new(nb.add(nb.mul(u, 1.0), uoff), vec.inputs[0]); nb.nt.links.new(vv, vec.inputs[1])
        t_ = img_node(nb, FLOW, vec.outputs[0])
        return t_.outputs["Color"], t_.outputs["Alpha"]

    def chan(col, i):
        s = nb.node("ShaderNodeSeparateColor"); nb.nt.links.new(col, s.inputs["Color"]); return s.outputs[i]
    c1a, a1a = sample(1.0, ph0, 0.0)
    c1b, a1b = sample(1.0, ph1, 0.37)
    c2a, _ = sample(1.7, ph0, 0.61)
    c2b, _ = sample(1.7, ph1, 0.13)
    s1 = nb.add(nb.mul(chan(c1a, 0), wA), nb.mul(chan(c1b, 0), nb.sub(1.0, wA)))
    s2 = nb.add(nb.mul(chan(c2a, 1), wA), nb.mul(chan(c2b, 1), nb.sub(1.0, wA)))
    foam = nb.add(nb.mul(chan(c1a, 2), wA), nb.mul(chan(c1b, 2), nb.sub(1.0, wA)))
    aer = nb.add(nb.mul(a1a, wA), nb.mul(a1b, nb.sub(1.0, wA)))
    dens = nb.add(nb.mul(s1, 0.5), nb.mul(s2, 0.3))
    dens = nb.add(dens, nb.mul(aer, 0.35))
    thr = nb.add(nb.mul(nb.mul(R, R), 0.55), nb.mul(nb.mul(B, B), 0.95))
    cover = nb.ramp(nb.sub(dens, thr), 0.0, 0.3)
    alpha = nb.mul(nb.sat(nb.add(nb.mul(cover, 0.8), 0.2)), A)
    alpha = nb.mul(alpha, nb.sat(nb.mad(B, -0.7, 1.0)))
    whiteness = nb.sat(nb.add(nb.add(0.15, nb.mul(R, 0.55)), nb.add(nb.mul(nb.sub(s1, 0.5), 1.25), nb.mul(foam, nb.mad(R, 0.5, 0.1)))))
    clear = (0.30, 0.46, 0.50, 1)
    white = (0.92, 0.95, 0.97, 1)
    col = nb.mix(whiteness, clear, white)
    finish(nb, col, alpha, rough=0.25, emit=0.08)
    return m


def mat_cascade():
    m = bpy.data.materials.new("M_falls_cascade")
    m.use_nodes = True
    nb = NB(m.node_tree)
    uv = nb.node("ShaderNodeTexCoord").outputs["UV"]
    sep = nb.node("ShaderNodeSeparateXYZ"); nb.nt.links.new(uv, sep.inputs[0])
    u, v = sep.outputs[0], sep.outputs[1]
    R, G, B, A = vcol(nb)
    fx = nb.mul(nb.sub(R, 0.5), 2.0)
    fy = nb.mul(nb.sub(G, 0.5), 2.0)
    t = time_node(nb)
    Tc = 0.7
    ph0 = nb.math("FRACT", nb.mul(t, 1.0 / Tc))
    ph1 = nb.math("FRACT", nb.add(nb.mul(t, 1.0 / Tc), 0.5))
    wA = nb.sub(1.0, nb.math("ABSOLUTE", nb.sub(nb.mul(ph0, 2.0), 1.0)))
    S = 1.7 * Tc

    def sample(ph, off):
        vec = nb.node("ShaderNodeCombineXYZ")
        nb.nt.links.new(nb.add(nb.sub(nb.mul(u, 1.2), nb.mul(nb.mul(fx, ph), S)), off), vec.inputs[0])
        nb.nt.links.new(nb.sub(v, nb.mul(nb.mul(fy, ph), S)), vec.inputs[1])
        t_ = img_node(nb, FLOW, vec.outputs[0])
        s = nb.node("ShaderNodeSeparateColor"); nb.nt.links.new(t_.outputs["Color"], s.inputs["Color"])
        return s.outputs[0], s.outputs[1], s.outputs[2], t_.outputs["Alpha"]
    ra, ga, ba, aa = sample(ph0, 0.0)
    rb, gb, bb, ab = sample(ph1, 0.5)
    w1 = nb.sub(1.0, wA)
    mixs = lambda x, y: nb.add(nb.mul(x, wA), nb.mul(y, w1))
    streak, streak2, foam, aer = mixs(ra, rb), mixs(ga, gb), mixs(ba, bb), mixs(aa, ab)
    dens = nb.add(nb.mul(streak, 0.45), nb.mul(aer, 0.4))
    cover = nb.sat(nb.add(nb.mul(nb.ramp(dens, 0.15, 0.6), 0.55), 0.32))
    heap = nb.mul(B, nb.ramp(nb.add(foam, nb.mul(B, 0.35)), 0.25, 0.6))
    alpha = nb.sat(nb.mul(nb.add(cover, heap), A))
    white = nb.sat(nb.add(nb.add(0.38, nb.mul(B, 0.85)), nb.mul(nb.mul(foam, nb.add(0.4, B)), 0.8)))
    white = nb.sat(nb.add(white, nb.mul(streak2, 0.15)))
    col = nb.mix(white, (0.30, 0.46, 0.50, 1), (0.92, 0.95, 0.97, 1))
    finish(nb, col, alpha, rough=0.3, emit=0.08)
    bump = nb.node("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.8; bump.inputs["Distance"].default_value = 0.08
    nb.nt.links.new(nb.mul(nb.add(foam, streak), nb.add(0.3, B)), bump.inputs["Height"])
    pb = next(n for n in nb.nt.nodes if n.type == "BSDF_PRINCIPLED")
    nb.nt.links.new(bump.outputs[0], pb.inputs["Normal"])
    return m


def mat_foam():
    m = bpy.data.materials.new("M_falls_foam")
    m.use_nodes = True
    nb = NB(m.node_tree)
    uv = nb.node("ShaderNodeTexCoord").outputs["UV"]
    R, G, B, A = vcol(nb)
    t = time_node(nb)
    sc_ = nb.node("ShaderNodeMapping")
    nb.nt.links.new(uv, sc_.inputs["Vector"])
    sc_.inputs["Scale"].default_value = (2.2, 2.2, 1.0)
    off = nb.node("ShaderNodeCombineXYZ")
    nb.nt.links.new(nb.mul(t, 0.07), off.inputs[0]); nb.nt.links.new(nb.mul(t, -0.11), off.inputs[1])
    ad = nb.node("ShaderNodeVectorMath", operation="ADD")
    nb.nt.links.new(sc_.outputs[0], ad.inputs[0]); nb.nt.links.new(off.outputs[0], ad.inputs[1])
    t_ = img_node(nb, FLOW, ad.outputs[0])
    sep = nb.node("ShaderNodeSeparateColor"); nb.nt.links.new(t_.outputs["Color"], sep.inputs["Color"])
    foam = sep.outputs[2]
    dens = nb.sat(nb.add(nb.mul(foam, 1.25), nb.mul(R, 0.5)))
    alpha = nb.mul(nb.sat(nb.ramp(nb.add(dens, nb.mul(R, 0.25)), 0.25, 0.65)), A)
    col = nb.mix(nb.sat(nb.add(0.1, nb.mul(foam, 0.5))), (0.80, 0.88, 0.90, 1), (0.99, 0.995, 1.0, 1))
    finish(nb, col, alpha, rough=0.6, emit=0.3, spec=0.2)
    bump = nb.node("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.9; bump.inputs["Distance"].default_value = 0.08
    nb.nt.links.new(nb.add(foam, nb.mul(R, 0.4)), bump.inputs["Height"])
    pb = next(n for n in nb.nt.nodes if n.type == "BSDF_PRINCIPLED")
    nb.nt.links.new(bump.outputs[0], pb.inputs["Normal"])
    return m


def mat_water():
    m = bpy.data.materials.new("M_water")
    m.use_nodes = True
    nb = NB(m.node_tree)
    nt = nb.nt
    R, G, B, A = vcol(nb)
    t = time_node(nb)
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    for n in list(nt.nodes):
        if n.type == "BSDF_PRINCIPLED":
            nt.nodes.remove(n)
    pos = nb.node("ShaderNodeNewGeometry").outputs["Position"]
    imp = nb.node("ShaderNodeCombineXYZ")
    imp.inputs[0].default_value, imp.inputs[1].default_value, imp.inputs[2].default_value = F.IMPACT["x"], -F.IMPACT["z"], F.IMPACT["y"]
    dist = nb.node("ShaderNodeVectorMath", operation="DISTANCE")
    nt.links.new(pos, dist.inputs[0]); nt.links.new(imp.outputs[0], dist.inputs[1])
    d = dist.outputs["Value"]
    # ripple rings: sin(k r - w t) * exp(-r / R)
    ring = nb.math("SINE", nb.sub(nb.mul(d, 5.5), nb.mul(t, 4.5)))
    decay = nb.math("EXPONENT", nb.mul(d, -0.28))
    ring_h = nb.mul(nb.mul(ring, decay), nb.sat(nb.mad(G, 1.0, 0.1)))
    noise = nb.node("ShaderNodeTexNoise", noise_dimensions="4D", noise_type="FBM")
    nt.links.new(pos, noise.inputs["Vector"]); noise.inputs["Scale"].default_value = 1.6; noise.inputs["Detail"].default_value = 4
    nt.links.new(nb.mul(t, 0.35), noise.inputs["W"])
    h = nb.add(nb.mul(ring_h, 0.55), nb.mul(noise.outputs["Fac"], 0.55))
    bump = nb.node("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.35; bump.inputs["Distance"].default_value = 0.4
    nt.links.new(h, bump.inputs["Height"])
    b = nb.node("ShaderNodeBsdfPrincipled")
    deep = (0.020, 0.115, 0.095, 1)
    shallow = (0.16, 0.36, 0.28, 1)
    col = nb.mix(nb.math("POWER", R, 0.7), shallow, deep)
    nt.links.new(col, b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.06
    b.inputs["Specular IOR Level"].default_value = 0.6
    nt.links.new(bump.outputs[0], b.inputs["Normal"])
    tr = nb.node("ShaderNodeBsdfTransparent")
    mx = nb.node("ShaderNodeMixShader")
    nt.links.new(A, mx.inputs[0]); nt.links.new(tr.outputs[0], mx.inputs[1]); nt.links.new(b.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs["Surface"])
    return m


# ------------------------------------------------------------------------------------------------ scene --
build_standin()
col = sc.collection
objs = PW.build_water(col, TIER)
MATS = {"M_falls_water": mat_plunge(), "M_falls_cascade": mat_cascade(), "M_falls_foam": mat_foam(), "M_water": mat_water()}
for ob in objs.values():
    if ob.type == "MESH":
        ob.data.materials[0] = MATS[ob.data.materials[0].name.split(".")[0]]

w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
env = w.node_tree.nodes.new("ShaderNodeTexEnvironment"); env.image = bpy.data.images.load(HDRI)
bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND"); bg.inputs["Strength"].default_value = 0.9
w.node_tree.links.new(env.outputs["Color"], bg.inputs["Color"])
sun = bpy.data.lights.new("sun", "SUN"); sun.energy = 3.2; sun.angle = math.radians(1.5)
so = bpy.data.objects.new("sun", sun); sc.collection.objects.link(so)
so.rotation_euler = Vector((-1.0, 0.45, -0.75)).to_track_quat("-Z", "Y").to_euler()
sc.render.engine = "CYCLES"
sc.cycles.samples = SAMPLES
sc.cycles.use_denoising = True
sc.cycles.max_bounces = 6
sc.cycles.transparent_max_bounces = 16
prefs = bpy.context.preferences.addons["cycles"].preferences
for dev_type in ("OPTIX", "CUDA", "HIP", "ONEAPI"):
    try:
        prefs.compute_device_type = dev_type
        prefs.get_devices()
        if any(d.type == dev_type for d in prefs.devices):
            for d in prefs.devices:
                d.use = d.type == dev_type
            sc.cycles.device = "GPU"
            break
    except Exception:
        continue
sc.render.resolution_x, sc.render.resolution_y = 1280, 720
sc.view_settings.view_transform = "AgX"
sc.view_settings.exposure = 0.4
sc.render.image_settings.file_format = "PNG"

CAMS = {
    "s7": (V(-100.0, -79.0, 2.0), V(-114.0, -78.5, 11.0), 18),
    "s8": (V(-103.8, -79.0, 1.8), V(-113.5, -78.0, 9.5), 17),
    "s9": (V(-100.0, -88.0, 2.0), V(-113.5, -78.5, 8.0), 24),
    "cascade": (V(-99.0, -73.0, 7.0), V(-117.5, -78.5, 27.0), 42),
    "foam": (V(-104.5, -80.5, 1.4), V(-112.5, -78.0, 0.6), 26),
    "wide": (V(-52.0, -98.0, 8.0), V(-116.0, -78.0, 16.0), 28),
}


def set_time(t):
    for n in TIMES:
        n.outputs[0].default_value = t


def shoot(name, t=0.0, path=None, res=None):
    loc, target, lens = CAMS[name]
    cam = bpy.data.cameras.new(name); cam.lens = lens; cam.clip_end = 600
    co = bpy.data.objects.new(name, cam); sc.collection.objects.link(co)
    co.location = loc
    co.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    sc.camera = co
    set_time(t)
    if res:
        sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.filepath = path or os.path.join(OUT, f"w2-{name}.png")
    bpy.ops.render.render(write_still=True)
    print("wrote", sc.render.filepath)


if "--anim" in argv:
    os.makedirs(os.path.join(OUT, "anim"), exist_ok=True)
    name = argv[argv.index("--anim") + 1] if len(argv) > argv.index("--anim") + 1 and not argv[argv.index("--anim") + 1].startswith("--") else "s8"
    for k in range(12):
        shoot(name, t=k / 12.0, path=os.path.join(OUT, "anim", f"{name}_{k:02d}.png"), res=(640, 360))
else:
    for s in SHOTS:
        shoot(s, t=0.3)
