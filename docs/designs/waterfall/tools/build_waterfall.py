"""B1 waterfall, W1: the rock, ground and plant art of the falls site (authoring scene). Round 3 (2026-11-16).

  blender -b --factory-startup -P build_waterfall.py -- [--no-glb]

Reads the LOCKED shape from falls_shape.py (face_x over FACE_Z/FACE_Y, terrain_y minus is_cliff_cell, slabs, seats,
lamps, camera wall) and the columnar joint layout from parts_falls_rock.py, and builds, in GAME coordinates converted
by Vb() = Blender (x, -z, y):

  falls_rock_lod0 / falls_rock_lod1   the cliff: big planar granite blocks with bevelled edges and straight cracks
                                      (coplanar faces merged, then triangulated), UV0 planar 4 m tile, UV2 = the face's
                                      (z, y) square (lightmap AND the macro map T_falls_rock_macro), 'Col' R moss,
                                      G wet, B water-stain streaks, A lichen                               M_falls_rock
  falls_flank_lod0 / _lod1            the wooded slopes either side of the bare rock (forest floor)       M_falls_turf
  falls_ground                        site ground west of the pocket: gravel / turf / boulder-granite by slope
  inst__falls_rock_k (k = 0..6)       the rock kit: talus (column fragments), riprap, river boulders   M_falls_slab
  inst__falls_pebble                  cobbles on the beach                                             M_falls_slab
  inst__falls_tree_k (k = 0..5)       broadleaf trees on the flanks, the rim and the banks   M_falls_bark + M_leaf_green
  falls_slab_n / falls_seat_n|s       the 4 walkable flat rocks (top 0.02-0.04) and the 2 stone seats (top 0.42)
  falls_lamp_n + light__falls_lamp_n  placeholder warm lamps (baked into the night lightmap by W3)
  veg__falls_plants / veg__falls_plants_hi   alpha-cut plant cards (ledges, cracks, banks / flank undergrowth)
                                                                                                    M_leaf_falls_plants
Objects carry extras {"tier": "high"} when the low (iPhone) tier drops them (export_extras on).
Nothing east of the pocket is drawn: the ground east of x -100 belongs to village.glb. Writes
art/village/work/falls_w1.blend (+ falls_w1.glb unless --no-glb) and falls_w1_report.json.
Each authoring material carries ["export"] = the GLB material name, like the village build.
"""
import json
import math
import os
import pickle
import random
import sys

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import falls_shape as F  # noqa: E402
import parts_falls_rock as P  # noqa: E402
from parts_falls_rock import Vb  # noqa: E402

ROOT = os.path.dirname(HERE)
WORK = os.path.join(ROOT, "work")
TEXF = os.path.join(WORK, "tex", "falls")
CACHE = os.path.join(WORK, "falls_w1")
os.makedirs(CACHE, exist_ok=True)
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
NO_GLB = "--no-glb" in argv

S = F.SITE
rng = random.Random(1116)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
COLL = bpy.data.collections.new("waterfall_w1")
sc.collection.children.link(COLL)
SRC = bpy.data.collections.new("falls_kit_src")
COLL.children.link(SRC)
SRC.hide_render = True
SRC.hide_viewport = True


def link(ob, coll=None, cat=None, high_only=False):
    (coll or COLL).objects.link(ob)
    if cat:
        ob["cat"] = cat
    if high_only:
        ob["tier"] = "high"
    return ob


# ============================================================================== cached terrain heights ==
_TC_PATH = os.path.join(CACHE, "terrain_cache.pkl")
_TC = pickle.load(open(_TC_PATH, "rb")) if os.path.exists(_TC_PATH) else {}
_orig_terrain_y = F.terrain_y
_tc_dirty = [0]


def _cached_terrain_y(x, z, use_edge=True):
    k = (round(x, 4), round(z, 4), use_edge)
    v = _TC.get(k)
    if v is None:
        v = _orig_terrain_y(x, z, use_edge)
        _TC[k] = v
        _tc_dirty[0] += 1
    return v


F.terrain_y = _cached_terrain_y        # is_cliff_cell() resolves terrain_y through the module: it is cached too
edge_stamp = os.path.getmtime(F.EDGE_FILE_DEFAULT) if F.EDGE_FILE_DEFAULT and os.path.exists(F.EDGE_FILE_DEFAULT) else 0
if _TC.get("__edge__") != edge_stamp:
    _TC.clear()
    _TC["__edge__"] = edge_stamp


def save_cache():
    if _tc_dirty[0]:
        pickle.dump(_TC, open(_TC_PATH, "wb"))
        _tc_dirty[0] = 0


# ================================================================================================ materials ==
def img(name, cs="sRGB"):
    im = bpy.data.images.load(os.path.join(TEXF, name) if not os.path.isabs(name) else name, check_existing=True)
    im.colorspace_settings.name = cs
    return im


def nodes_of(m):
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    return nt


def N(nt, t, x=0, y=0):
    n = nt.nodes.new(t)
    n.location = (x, y)
    return n


def mix(nt, a, b, fac, blend="MIX"):
    m = N(nt, "ShaderNodeMix")
    m.data_type = "RGBA"
    m.blend_type = blend
    if isinstance(fac, (int, float)):
        m.inputs["Factor"].default_value = fac
    else:
        nt.links.new(fac, m.inputs["Factor"])
    for i, v in ((6, a), (7, b)):
        if isinstance(v, tuple):
            m.inputs[i].default_value = v
        else:
            nt.links.new(v, m.inputs[i])
    return m.outputs[2]


def mapr(nt, val, a, b, c=0.0, d=1.0, clamp=True):
    m = N(nt, "ShaderNodeMapRange")
    m.inputs["From Min"].default_value, m.inputs["From Max"].default_value = a, b
    m.inputs["To Min"].default_value, m.inputs["To Max"].default_value = c, d
    m.clamp = clamp
    nt.links.new(val, m.inputs["Value"])
    return m.outputs["Result"]


def lum_of(nt, color):
    n = N(nt, "ShaderNodeRGBToBW")
    nt.links.new(color, n.inputs[0])
    return n.outputs[0]


def mathn(nt, op, a, b=None):
    m = N(nt, "ShaderNodeMath")
    m.operation = op
    for i, v in ((0, a), (1, b)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            m.inputs[i].default_value = v
        else:
            nt.links.new(v, m.inputs[i])
    return m.outputs[0]


def rgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)


MATS = {}


def stone_material(name, export, tex, nor, moss_col="#4A5E26", base_rough=0.8, strength=1.0, macro=None,
                   streak_k=1.0, lich_k=1.0):
    """Stone: tiled colour + normal (UV0), optional macro map on UV2 (RGB colour x2, A relief height -> bump), and the
    'Col' masks: R moss, G wet (darker, glossy), B water-stain streaks, A lichen."""
    m = bpy.data.materials.new(name)
    m["export"] = export
    m.use_nodes = True
    nt = nodes_of(m)
    out = N(nt, "ShaderNodeOutputMaterial", 1700, 0)
    bs = N(nt, "ShaderNodeBsdfPrincipled", 1400, 0)
    uv = N(nt, "ShaderNodeUVMap", -1000, 0)
    uv.uv_map = "UVMap"
    t = N(nt, "ShaderNodeTexImage", -700, 250)
    t.image = img(tex)
    t.interpolation = "Cubic"
    nt.links.new(uv.outputs[0], t.inputs["Vector"])
    tn = N(nt, "ShaderNodeTexImage", -700, -250)
    tn.image = img(nor, "Non-Color")
    nt.links.new(uv.outputs[0], tn.inputs["Vector"])
    nm = N(nt, "ShaderNodeNormalMap", -400, -250)
    nm.inputs["Strength"].default_value = strength
    nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
    normal = nm.outputs[0]
    col = t.outputs["Color"]
    if macro:
        uv2 = N(nt, "ShaderNodeUVMap", -1000, -600)
        uv2.uv_map = "UV2"
        mt = N(nt, "ShaderNodeTexImage", -700, -600)
        mt.image = img(macro, "Non-Color")
        mt.interpolation = "Cubic"
        nt.links.new(uv2.outputs[0], mt.inputs["Vector"])
        col = mix(nt, col, mt.outputs["Color"], 1.0, "MULTIPLY")
        col = mix(nt, col, (2.0, 2.0, 2.0, 1.0), 1.0, "MULTIPLY")
        bump = N(nt, "ShaderNodeBump", -150, -500)
        bump.inputs["Strength"].default_value = 1.0
        bump.inputs["Distance"].default_value = 0.3
        nt.links.new(mt.outputs["Alpha"], bump.inputs["Height"])
        nt.links.new(normal, bump.inputs["Normal"])
        normal = bump.outputs[0]
    nt.links.new(normal, bs.inputs["Normal"])
    vc = N(nt, "ShaderNodeVertexColor", -1000, -900)
    vc.layer_name = "Col"
    sp = N(nt, "ShaderNodeSeparateColor", -750, -900)
    nt.links.new(vc.outputs["Color"], sp.inputs["Color"])
    R, G, B, A = sp.outputs[0], sp.outputs[1], sp.outputs[2], vc.outputs["Alpha"]
    # water-stain streaks: dark, slightly cool
    col = mix(nt, col, (0.035, 0.038, 0.042, 1), mathn(nt, "MULTIPLY", B, 0.75 * streak_k))
    # lichen: pale grey patches, not where it is wet
    dry = mathn(nt, "SUBTRACT", 1.0, G)
    lich_w = mapr(nt, A, 0.55, 0.85)
    col = mix(nt, col, (0.66, 0.66, 0.6, 1), mathn(nt, "MULTIPLY", mathn(nt, "MULTIPLY", lich_w, dry), 0.45 * lich_k))
    # moss: yellow-green, keeps the stone's relief by multiplying the stone luminance in
    tl = lum_of(nt, t.outputs["Color"])
    mm = N(nt, "ShaderNodeMix")
    mm.data_type = "RGBA"
    mm.blend_type = "MULTIPLY"
    mm.inputs["Factor"].default_value = 1.0
    mm.inputs[6].default_value = rgb(moss_col)
    cc = N(nt, "ShaderNodeCombineColor")
    lt = mapr(nt, tl, 0.1, 0.7, 0.6, 1.4)
    for k in range(3):
        nt.links.new(lt, cc.inputs[k])
    nt.links.new(cc.outputs[0], mm.inputs[7])
    mossc = mm.outputs[2]
    col = mix(nt, col, mossc, mathn(nt, "MINIMUM", mathn(nt, "MULTIPLY", R, 0.95), 1.0))
    # wet: darker, glossier
    col = mix(nt, col, (0.30, 0.31, 0.33, 1), mathn(nt, "MULTIPLY", G, 1.0), "MULTIPLY")
    nt.links.new(col, bs.inputs["Base Color"])
    rough = mapr(nt, G, 0.0, 1.0, base_rough, 0.3)
    nt.links.new(rough, bs.inputs["Roughness"])
    nt.links.new(bs.outputs[0], out.inputs["Surface"])
    MATS[name] = m
    return m


def tinted_material(name, export, tex, nor, strength=0.9, rough=0.9):
    """Ground: texture x 'Col' tint (RGB)."""
    m = bpy.data.materials.new(name)
    m["export"] = export
    m.use_nodes = True
    nt = nodes_of(m)
    out = N(nt, "ShaderNodeOutputMaterial", 900, 0)
    bs = N(nt, "ShaderNodeBsdfPrincipled", 600, 0)
    uv = N(nt, "ShaderNodeUVMap", -700, 0)
    uv.uv_map = "UVMap"
    t = N(nt, "ShaderNodeTexImage", -400, 100)
    t.image = img(tex)
    nt.links.new(uv.outputs[0], t.inputs["Vector"])
    vc = N(nt, "ShaderNodeVertexColor", -400, -150)
    vc.layer_name = "Col"
    col = mix(nt, t.outputs["Color"], vc.outputs["Color"], 1.0, "MULTIPLY")
    nt.links.new(col, bs.inputs["Base Color"])
    tn = N(nt, "ShaderNodeTexImage", -400, -350)
    tn.image = img(nor, "Non-Color")
    nt.links.new(uv.outputs[0], tn.inputs["Vector"])
    nm = N(nt, "ShaderNodeNormalMap", -100, -350)
    nm.inputs["Strength"].default_value = strength
    nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs[0], bs.inputs["Normal"])
    bs.inputs["Roughness"].default_value = rough
    nt.links.new(bs.outputs[0], out.inputs["Surface"])
    MATS[name] = m
    return m


def card_material(name, export, tex_path, translucent=0.3, rough=0.6, bright=1.0):
    """Alpha-cut card foliage (glTF MASK, double-sided at runtime): texture x 'Col', some light through the leaves."""
    m = bpy.data.materials.new(name)
    m["export"] = export
    m.use_nodes = True
    nt = nodes_of(m)
    out = N(nt, "ShaderNodeOutputMaterial", 1100, 0)
    bs = N(nt, "ShaderNodeBsdfPrincipled", 500, 100)
    uv = N(nt, "ShaderNodeUVMap", -600, 0)
    uv.uv_map = "UVMap"
    t = N(nt, "ShaderNodeTexImage", -300, 100)
    t.image = bpy.data.images.load(tex_path, check_existing=True)
    t.interpolation = "Linear"
    nt.links.new(uv.outputs[0], t.inputs["Vector"])
    vc = N(nt, "ShaderNodeVertexColor", -300, -150)
    vc.layer_name = "Col"
    col = mix(nt, t.outputs["Color"], vc.outputs["Color"], 1.0, "MULTIPLY")
    if bright != 1.0:       # authoring renders only: the village bakes the leaves' light into COLOR_0 (brighter in game)
        col = mix(nt, col, (bright, bright, bright, 1.0), 1.0, "MULTIPLY")
    nt.links.new(col, bs.inputs["Base Color"])
    bs.inputs["Roughness"].default_value = rough
    bs.inputs["Specular IOR Level"].default_value = 0.25
    tr = N(nt, "ShaderNodeBsdfTranslucent", 500, -250)
    nt.links.new(col, tr.inputs["Color"])
    mx = N(nt, "ShaderNodeMixShader", 750, 0)
    mx.inputs[0].default_value = translucent
    nt.links.new(bs.outputs[0], mx.inputs[1])
    nt.links.new(tr.outputs[0], mx.inputs[2])
    # alpha clip at 0.5 (what the runtime's alphaTest does)
    cut = mathn(nt, "GREATER_THAN", t.outputs["Alpha"], 0.5)
    tp = N(nt, "ShaderNodeBsdfTransparent", 750, -250)
    mx2 = N(nt, "ShaderNodeMixShader", 950, 0)
    nt.links.new(cut, mx2.inputs[0])
    nt.links.new(tp.outputs[0], mx2.inputs[1])
    nt.links.new(mx.outputs[0], mx2.inputs[2])
    nt.links.new(mx2.outputs[0], out.inputs["Surface"])
    m.use_backface_culling = False
    try:
        m.surface_render_method = "DITHERED"
    except Exception:  # noqa: BLE001
        pass
    MATS[name] = m
    return m


def bark_material():
    m = bpy.data.materials.new("M_falls_bark")
    m["export"] = "M_falls_bark"
    m.use_nodes = True
    nt = nodes_of(m)
    out = N(nt, "ShaderNodeOutputMaterial", 600, 0)
    bs = N(nt, "ShaderNodeBsdfPrincipled", 300, 0)
    uv = N(nt, "ShaderNodeUVMap", -600, 0)
    uv.uv_map = "UVMap"
    t = N(nt, "ShaderNodeTexImage", -300, 100)
    t.image = bpy.data.images.load(os.path.join(WORK, "tex", "T_bark.png"), check_existing=True)
    nt.links.new(uv.outputs[0], t.inputs["Vector"])
    vc = N(nt, "ShaderNodeVertexColor", -300, -150)
    vc.layer_name = "Col"
    nt.links.new(mix(nt, t.outputs["Color"], vc.outputs["Color"], 1.0, "MULTIPLY"), bs.inputs["Base Color"])
    bs.inputs["Roughness"].default_value = 0.9
    nt.links.new(bs.outputs[0], out.inputs["Surface"])
    MATS["M_falls_bark"] = m
    return m


M_ROCK = stone_material("M_falls_rock", "M_falls_rock", "T_falls_rock.png", "T_falls_rock_n.png",
                        macro="T_falls_rock_macro.png", streak_k=0.5, lich_k=0.4, strength=0.8)
M_SLAB = stone_material("M_falls_slab", "M_falls_slab", "T_falls_slab.png", "T_falls_slab_n.png", moss_col="#4F6A28",
                        base_rough=0.74, strength=0.9)
M_GROUND = tinted_material("M_falls_ground", "M_falls_ground", "T_falls_gravel.png", "T_falls_gravel_n.png", 1.0, 0.88)
M_TURF = tinted_material("M_falls_turf", "M_falls_turf", "T_falls_turf.png", "T_falls_turf_n.png", 0.7, 0.95)
M_LEAF = card_material("M_leaf_green", "M_leaf_green", os.path.join(WORK, "tex", "T_leaf_green.png"), 0.3, bright=1.45)
M_PLANT = card_material("M_leaf_falls_plants", "M_leaf_falls_plants", os.path.join(TEXF, "T_falls_foliage.png"), 0.35, bright=1.2)
M_BARK = bark_material()
M_LAMP = bpy.data.materials.new("M_falls_lamp")
M_LAMP["export"] = "M_falls_lamp"
M_LAMP.use_nodes = True
_nt = nodes_of(M_LAMP)
_o = N(_nt, "ShaderNodeOutputMaterial", 400, 0)
_e = N(_nt, "ShaderNodeEmission", 100, 0)
_e.inputs["Color"].default_value = rgb("#FFB46B")
_e.inputs["Strength"].default_value = 3.0
_nt.links.new(_e.outputs[0], _o.inputs["Surface"])

# ============================================================================================ face grids ==
SEAM_Z = -62.0       # south of this z the ground blends to the village seam (terrain_y), so the terrain mesh covers it
CLIFF = {}
for xi in range(int(S["minX"]), int(S["maxX"])):
    for zi in range(int(S["minZ"]), int(S["maxZ"])):
        if F.FACE_Z[0] <= zi <= F.FACE_Z[1]:
            CLIFF[(xi, zi)] = F.is_cliff_cell(float(xi), float(zi))
save_cache()
print("cliff cells:", sum(CLIFF.values()))


def cliff_at(x, z, grow=0):
    cx, cz = math.floor(x), math.floor(z)
    for di in range(-grow, grow + 1):
        for dj in range(-grow, grow + 1):
            if CLIFF.get((cx + di, cz + dj)):
                return True
    return False


def wetness(x, y, z):
    d_ch = abs(z - F.channel_z(y)) if y > F.LEDGE - 0.5 else 99.0
    d_pl = abs(z - F.LIP["z"]) if y <= F.LEDGE + 0.5 else 99.0
    w = max(math.exp(-(d_ch / 3.6) ** 2), F.smooth(7.5, 3.0, d_pl) * (1.0 if y > -1 else 0.0))
    near = math.hypot(x - F.IMPACT["x"], z - F.IMPACT["z"]) - 5.0
    w = max(w, math.exp(-max(0.0, near) / 3.0) * F.smooth(6.0, 1.0, y))
    w = max(w, F.smooth(1.2, 0.0, y - F.WATER_Y) * 0.9)
    return min(1.0, w)


def flank_z(zc, yc):
    return abs(zc - F.FZ) > 15.2 + 1.0 * F.noise3(zc * 0.12, yc * 0.06, 2.2)


def build_face(lod):
    zs, ys, zk, yk = P.grid_lines(lod)
    nz, ny = len(zs), len(ys)
    X = [[P.face_x_detailed(z, y) for z in zs] for y in ys]
    verts, keepv = [], []
    for j, y in enumerate(ys):
        for i, z in enumerate(zs):
            x = X[j][i]
            verts.append((x, z, y))
            keepv.append(y > F.floor_y(x, z) - 0.35)
    rock_q, turf_q, push = [], [], set()
    for j in range(ny - 1):
        for i in range(nz - 1):
            a = j * nz + i
            q = (a, a + 1, a + nz + 1, a + nz)
            if not any(keepv[k] for k in q):
                continue
            xm = sum(verts[k][0] for k in q) / 4
            zm = sum(verts[k][1] for k in q) / 4
            ym = sum(verts[k][2] for k in q) / 4
            if ym > F.PLATEAU_Y + 2.0 or zm > SEAM_Z + 0.45:
                continue
            if cliff_at(xm, zm) and zm <= SEAM_Z:
                pass
            elif cliff_at(xm, zm, 1) or ym > F.TOP + 1.0 or zm > SEAM_Z:
                for k in q:
                    push.add(k)
            else:
                continue
            (turf_q if flank_z(zm, ym) else rock_q).append(q)
    cols, uv0, uv2 = [], [], []
    for j, y in enumerate(ys):
        for i, z in enumerate(zs):
            x = X[j][i]
            xl, xr = X[j][max(i - 1, 0)], X[j][min(i + 1, nz - 1)]
            xd, xu = X[max(j - 1, 0)][i], X[min(j + 1, ny - 1)][i]
            dz = zs[min(i + 1, nz - 1)] - zs[max(i - 1, 0)]
            dy = ys[min(j + 1, ny - 1)] - ys[max(j - 1, 0)]
            Xz, Xy = (xr - xl) / dz, (xu - xd) / dy
            nlen = math.sqrt(1 + Xz * Xz + Xy * Xy)
            n_up = -Xy / nlen
            cav = 0.5 * (xl + xr) - x + 0.5 * (xd + xu) - x
            wet = wetness(x, y, z)
            nzn = F.fbm(z * 0.35, y * 0.35, 2.2)
            # moss: up-facing ledges and recesses on the damp lower rock and near the water (the macro map paints
            # the ledge tops and cracks in detail; this mask is the broad, runtime-tunable part)
            damp = 0.35 + 0.65 * F.smooth(18.0, 2.0, y)
            moss = (F.smooth(0.35, 0.75, n_up) * 0.7 + F.smooth(0.08, 0.4, cav) * 0.5) * damp * (0.6 + 0.4 * nzn)
            moss += 0.55 * wet * F.smooth(6.0, 0.0, y) * (0.5 + 0.5 * max(0.0, nzn))
            moss *= 1.0 - 0.8 * F.smooth(0.55, 0.9, wet) * (1.0 if y > 1.5 else 0.0)
            streak = 0.45 * wet + 0.2 * F.smooth(0.15, 0.5, F.fbm(z * 0.9, y * 0.05 + 3.3, 1.7)) * F.smooth(6.0, 20.0, y)
            ln_ = F.fbm(z * 0.3 + 4, y * 0.3, 2.9)
            lich = (0.6 + 0.3 * F.smooth(0.0, 0.4, ln_)) * F.smooth(-0.1, 0.25, ln_) * (1.0 - wet)
            cols.append((min(1.0, max(0.0, moss)), wet, min(1.0, streak), lich))
            uv0.append((z * 0.25 + 0.31, y * 0.25))
            uv2.append(((z - F.FACE_Z[0]) / (F.FACE_Z[1] - F.FACE_Z[0]), (y - F.FACE_Y[0]) / (F.FACE_Y[1] - F.FACE_Y[0])))
    vb = [Vb(x - (0.05 if k in push else 0.0), z, y) for k, (x, z, y) in enumerate(verts)]
    # where there is no block relief (groove, rim roll, flank blends) the bevel / crack-side lines carry nothing:
    # dissolve them there so the curved parts keep only their fill resolution
    drop = set()
    for j, y in enumerate(ys):
        for i, z in enumerate(zs):
            if P.detail_weight(z, y) < 0.999 and (zk[z] == 0 or yk[y] == 0 or (yk[y] == 1 and abs(z - F.FZ) > 8.0)):
                drop.add(j * nz + i)

    def sub(name, quads, mat, colfn, angle, sharp):
        used = sorted({k for q in quads for k in q})
        remap = {k: i for i, k in enumerate(used)}
        ob = P.mesh_from(name, [vb[k] for k in used], [tuple(remap[k] for k in q) for q in quads], mat,
                         uv=[uv0[k] for k in used], uv2=[uv2[k] for k in used], colors=[colfn(k) for k in used])
        P.orient(ob.data, (1, 0, 0))
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bm.verts.ensure_lookup_table()
        dv = [bm.verts[remap[k]] for k in used if k in drop and not bm.verts[remap[k]].is_boundary]
        bmesh.ops.dissolve_verts(bm, verts=dv, use_face_split=False, use_boundary_tear=False)
        bm.to_mesh(ob.data)
        bm.free()
        P.planarize(ob.data, angle)
        P.box_uv(ob.data, 4.0 if mat is M_ROCK else 3.0)
        P.sharpen(ob.data, sharp)
        return ob

    def turf_col(k):
        x, z, y = verts[k]
        n = F.fbm(z * 0.4, y * 0.4, 5.5)
        v_ = 0.8 + 0.5 * n
        return (v_ * 0.95, v_ * 1.02, v_ * 0.82, 1.0)
    ob = sub(f"falls_rock_lod{lod}", rock_q, M_ROCK, lambda k: cols[k], 0.5 if lod == 0 else 2.0, 28)
    link(ob, cat="rock")
    fk = sub(f"falls_flank_lod{lod}", turf_q, M_TURF, turf_col, 2.0 if lod == 0 else 5.0, 70)
    link(fk, cat="ground")
    return ob, fk


print("building cliff...")
FACE0, FLANK0 = build_face(0)
FACE1, FLANK1 = build_face(1)
for _o in (FACE1, FLANK1):
    _o.hide_render = True
    _o.hide_viewport = True
    _o["tier"] = "low"
FACE0["tier"] = "high"
FLANK0["tier"] = "high"
print("face tris", len(FACE0.data.polygons), len(FACE1.data.polygons), len(FLANK0.data.polygons))

# =============================================================================================== terrain ==


def tensor_axes():
    xs = [S["minX"] + 2.0 * k for k in range(0, 7)]                       # -140 .. -128 at 2 m
    xs += [-126.0 + 1.0 * k for k in range(0, 12)]                         # -126 .. -115 at 1 m (plateau, cliff foot)
    xs += [-114.0 + 0.5 * k for k in range(0, 29)]                         # -114 .. -100 at 0.5 m (pool, banks)
    zs = [S["minZ"] + 1.0 * k for k in range(0, 12)]                       # -104 .. -93 at 1 m
    zs += [-92.0 + 0.5 * k for k in range(0, 56)]                          # -92 .. -64.5 at 0.5 m
    zs += [-64.0 + 1.0 * k for k in range(0, 7)]                           # -64 .. -58 at 1 m
    return xs, zs


def ground_class(x, z):
    """gravel weight at a ground point: gravel round the water, the outlet and the rest area."""
    sd = F.pool_signed_dist(x, z)
    od, _ = F.outlet_dist(x, z)
    g = max(F.smooth(4.8, 1.0, sd), F.smooth(3.4, 1.0, od - F.OUTLET["width"] / 2))
    inpk = F._box_dist(x, z, F.POCKET)
    g = max(g, F.smooth(2.0, 0.0, inpk) * 0.85 * F.smooth(-99.6, -103.0, x))
    g += 0.45 * F.fbm(x * 0.35, z * 0.35, 6.1) * (1 if g > 0.05 else 0)
    return g


def build_terrain():
    xs, zs = tensor_axes()
    nx, nz = len(xs), len(zs)
    H = [[F.terrain_y(x, z) for x in xs] for z in zs]
    save_cache()
    verts = [Vb(x, z, H[j][i]) for j, z in enumerate(zs) for i, x in enumerate(xs)]
    quads = []
    for j in range(nz - 1):
        for i in range(nx - 1):
            xm, zm = (xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2
            if cliff_at(xm, zm) and zm <= SEAM_Z:
                continue
            a = j * nx + i
            quads.append((a, a + 1, a + nx + 1, a + nx))
    me = bpy.data.meshes.new("falls_ground")
    me.from_pydata(verts, [], quads)
    me.update()
    ob = bpy.data.objects.new("falls_ground", me)
    me.materials.append(M_GROUND)
    me.materials.append(M_TURF)
    me.materials.append(M_SLAB)
    me.update()
    P.orient(me, (0, 0, 1))
    mi = []
    for p in me.polygons:
        c = p.center
        gx, gz = c.x, -c.y
        n = p.normal
        g = ground_class(gx, gz)
        if n.z < 0.45 and abs(gz - F.FZ) < 15.0 and c.z < F.PLATEAU_Y - 1.0:
            mi.append(2)                                  # steep rock among the bare granite only
        elif g > 0.5:
            mi.append(0)
        else:
            mi.append(1)                                  # forest floor (also the steep wooded flanks)
    me.polygons.foreach_set("material_index", mi)
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    uv0 = me.uv_layers.new(name="UVMap")
    uv2 = me.uv_layers.new(name="UV2")
    for p in me.polygons:
        mid = p.material_index
        n = p.normal
        ax = max(range(3), key=lambda k: abs(n[k]))
        tile = {0: 2.0, 1: 3.0, 2: 3.0}[mid]
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if ax == 2:
                u, v = co.x, co.y
            elif ax == 0:
                u, v = co.y, co.z
            else:
                u, v = co.x, co.z
            uv0.data[li].uv = (u / tile, v / tile)
            uv2.data[li].uv = ((co.x - S["minX"]) / (S["maxX"] - S["minX"]), (-co.y - S["minZ"]) / (S["maxZ"] - S["minZ"]))
    cols = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    cls_of_vertex = {}
    for p, m_ in zip(me.polygons, mi):
        for vi in p.vertices:
            cls_of_vertex.setdefault(vi, set()).add(m_)
    for i, v in enumerate(me.vertices):
        gx, gz, gy = v.co.x, -v.co.y, v.co.z
        sd = F.pool_signed_dist(gx, gz)
        wet = F.smooth(1.6, 0.0, sd) * 0.85
        nzv = F.fbm(gx * 0.5, gz * 0.5, 4.4)
        cs = cls_of_vertex.get(i, {1})
        if 2 in cs:                                     # rock masks: R moss, G wet, B streak, A lichen
            moss = F.smooth(-0.1, 0.5, F.fbm(gx * 0.3, gz * 0.3 + gy * 0.2, 7.7)) * 0.7
            cols.data[i].color = (min(1.0, moss + wet * 0.4), wet, 0.0, max(0.0, nzv) * 0.7)
        elif 0 in cs:                                   # gravel tint: darker + greener when wet, warm variation
            v_ = 0.8 + 0.25 * nzv
            k = 1.0 - 0.45 * wet
            cols.data[i].color = (v_ * k, v_ * k * 1.01, v_ * k * 0.96, 1.0)
        else:                                           # forest floor tint
            v_ = 0.8 + 0.35 * nzv
            cols.data[i].color = (v_ * 0.95, v_ * 1.02, v_ * 0.82, 1.0)
    link(ob, cat="ground")
    return ob


print("building terrain...")
GROUND = build_terrain()
print("ground tris", len(GROUND.data.polygons) * 2)

# ray casts onto the built surfaces (plants and trees sit on what is drawn)
_bv, _bp = [], []
for ob in (FACE0, FLANK0, GROUND):
    off = len(_bv)
    _bv += [v.co.copy() for v in ob.data.vertices]
    _bp += [tuple(off + i for i in p.vertices) for p in ob.data.polygons]
BVH = BVHTree.FromPolygons(_bv, _bp)


def surface_down(x, z, top=60.0):
    """(Blender point, normal) of the first surface under (x, z) from above, or None."""
    hit = BVH.ray_cast(Vector((x, -z, top)), Vector((0, 0, -1)))
    if hit[0] is None:
        return None
    n = hit[1] if hit[1].z > 0 else -hit[1]
    return hit[0], n


# ============================================================================================= rock kit ==
KIT = [P.block_mesh(k, 100 + k, M_SLAB) for k in range(7)]
for ob in KIT:
    SRC.objects.link(ob)
KIT_TRIS = {ob.name: sum(len(p.vertices) - 2 for p in ob.data.polygons) for ob in KIT}
print("kit tris", KIT_TRIS)


def kit_dims(kind, s):
    hx, hy, hz = P.KIT[kind]["h"]
    return hx * s[0], hy * s[1], hz * s[2]


def blocked_by_water(z, y):
    if y > F.LEDGE - 1.0:
        return abs(z - F.channel_z(y)) < F.CHANNEL_HALF + 1.8
    return abs(z - F.LIP["z"]) < 7.2 and y < F.LEDGE + 1.5


def in_pocket(x, z, grow=0.9):
    return F.in_box(x, z, F.POCKET, grow)


def on_slab_or_seat(x, z, r):
    if F.slab_at(x, z, -r) is not None:
        return True
    for s in F.SEATS:
        c, sz = s["centre"], s["size"]
        if abs(x - c["x"]) < sz["x"] / 2 + r + 0.3 and abs(z - c["z"]) < sz["z"] / 2 + r + 0.3:
            return True
    return False


def place_bank_rocks(n_bank=44, n_water=9, n_talus=12):
    out = []
    tries = 0
    while len(out) < n_bank and tries < 4000:
        tries += 1
        a = rng.uniform(0, 2 * math.pi)
        sd = rng.uniform(-0.7, 2.6)
        x = F.POOL_CX + F.POOL_RX * math.cos(a)
        z = F.POOL_CZ + F.POOL_RZ * math.sin(a)
        nx_, nz_ = math.cos(a) / F.POOL_RX, math.sin(a) / F.POOL_RZ
        nl = math.hypot(nx_, nz_)
        x += nx_ / nl * sd
        z += nz_ / nl * sd
        if in_pocket(x, z, 0.8) or not F.in_box(x, z, S, -1.0):
            continue
        od, _ = F.outlet_dist(x, z)
        if od < F.OUTLET["width"] / 2 + 1.0:
            continue
        if abs(z - F.LIP["z"]) < 3.6 and x > F.LIP["x"] - 1:
            continue
        if cliff_at(x, z, 1) and sd > 1.0:
            continue
        k = rng.choice([6, 6, 6, 6, 4, 4, 5])
        s = rng.uniform(0.32, 0.85)
        sc_ = (s * rng.uniform(0.85, 1.2), s * rng.uniform(0.7, 1.05), s * rng.uniform(0.85, 1.2))
        hx, hy, hz = kit_dims(k, sc_)
        if any(math.hypot(o[1][0] - x, o[1][2] - z) < (max(hx, hz) + max(kit_dims(o[0], o[4])[0], kit_dims(o[0], o[4])[2])) * 0.72 for o in out):
            continue
        gy = F.floor_y(x, z)
        out.append((k, (x, gy + hy * 0.45, z), rng.uniform(0, 6.28), rng.uniform(-0.15, 0.15), sc_, "bank", sd, 0))
    tries, cnt = 0, 0
    while cnt < n_water and tries < 2000:
        tries += 1
        a = rng.uniform(0, 2 * math.pi)
        f = rng.uniform(0.35, 0.92)
        x = F.POOL_CX + F.POOL_RX * f * math.cos(a)
        z = F.POOL_CZ + F.POOL_RZ * f * math.sin(a)
        if math.hypot(x - F.IMPACT["x"], z - F.IMPACT["z"]) < 5.2 or in_pocket(x, z, 0.5):
            continue
        k = rng.choice([6, 6, 4])
        s = rng.uniform(0.32, 0.6)
        sc_ = (s * 1.1, s * 0.9, s * 1.1)
        hx, hy, hz = kit_dims(k, sc_)
        top = F.WATER_Y + rng.choice([0.28, 0.18, -0.12])
        yc = top - hy * 0.85
        if any(math.hypot(o[1][0] - x, o[1][2] - z) < 1.8 for o in out):
            continue
        out.append((k, (x, yc, z), rng.uniform(0, 6.28), rng.uniform(-0.2, 0.2), sc_, "shallow", 0, 0))
        cnt += 1
    # talus: broken column pieces fallen at the cliff foot, mostly beside the plunge
    tries, cnt = 0, 0
    while cnt < n_talus and tries < 2500:
        tries += 1
        z = F.FZ + rng.choice([-1, 1]) * rng.uniform(6.0, 14.5)
        x = P.face_x_detailed(z, 0.5) + rng.uniform(1.2, 3.6)
        if in_pocket(x, z, 1.0) or F.pool_signed_dist(x, z) < -0.4:
            continue
        k = rng.choice([2, 3, 1, 0, 0])
        s = rng.uniform(0.5, 1.05)
        sc_ = (s, s * rng.uniform(0.7, 1.0), s * rng.uniform(0.8, 1.1))
        hx, hy, hz = kit_dims(k, sc_)
        if any(math.hypot(o[1][0] - x, o[1][2] - z) < 2.0 for o in out):
            continue
        gy = F.floor_y(x, z)
        out.append((k, (x, gy + hy * 0.25, z), rng.uniform(0, 6.28), rng.uniform(-0.12, 0.12), sc_, "talus", 0, 0))
        cnt += 1
    return out


BANK_ROCKS = place_bank_rocks()


def new_inst(kind, x, z, y, yaw, tilt, scale, tag, idx):
    ob = bpy.data.objects.new(f"falls_rock_{kind}_{tag}_{idx}", KIT[kind].data)
    ob.location = Vb(x, z, y)
    ob.rotation_euler = (0.0, tilt, yaw)
    ob.scale = scale
    ob["cat"] = "inst"
    return ob


roots = {}
for k in range(7):
    r = bpy.data.objects.new(f"inst__falls_rock_{k}", None)
    r.empty_display_size = 1.0
    r["cat"] = "inst_root"
    link(r)
    roots[k] = r
INST_COUNT = 0
INST_TRIS = 0
INST_TRIS_LOW = 0
for (kind, loc, yaw, tilt, sc_, tag, _a, _b) in BANK_ROCKS:
    ob = new_inst(kind, loc[0], loc[2], loc[1], yaw, tilt, sc_, tag, INST_COUNT)
    ob.parent = roots[kind]
    big = max(sc_) > 0.6 or tag == "talus"
    link(ob, high_only=not big)
    INST_COUNT += 1
    INST_TRIS += KIT_TRIS[f"falls_kit_{kind}"]
    INST_TRIS_LOW += KIT_TRIS[f"falls_kit_{kind}"] if big else 0
print("kit instances", INST_COUNT, "tris", INST_TRIS)

# ============================================================================ slabs, seats, lamps, gravel ==
SLABS = []
for k, s in enumerate(F.SLABS):
    ob = P.slab_mesh(s, M_SLAB, k + 1)
    link(ob, cat="slab")
    SLABS.append(ob)
SEATS = []
for k, s in enumerate(F.SEATS):
    ob = P.seat_mesh(s, M_SLAB, k + 1)
    link(ob, cat="seat")
    SEATS.append(ob)

LAMP_TRIS = 0
_M = __import__("mathutils").Matrix
for k, lp in enumerate(F.LAMPS):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=8, radius1=0.17, radius2=0.12, depth=0.38,
                          matrix=_M.Translation((0, 0, 0.19)))
    stone = bpy.data.meshes.new(f"falls_lamp_{k}")
    bm.to_mesh(stone)
    bm.free()
    so = bpy.data.objects.new(f"falls_lamp_{k}", stone)
    stone.materials.append(M_SLAB)
    stone.uv_layers.new(name="UVMap")
    so.location = Vb(lp["x"], lp["z"], 0.0)
    link(so, cat="lamp")
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * 0.2, v.co.y * 0.2, v.co.z * 0.22 + 0.49))
    glass = bpy.data.meshes.new(f"falls_lamp_glass_{k}")
    bm.to_mesh(glass)
    bm.free()
    gob = bpy.data.objects.new(f"falls_lamp_glass_{k}", glass)
    glass.materials.append(M_LAMP)
    gob.location = Vb(lp["x"], lp["z"], 0.0)
    link(gob, cat="lamp")
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=8, radius1=0.17, radius2=0.04, depth=0.12,
                          matrix=_M.Translation((0, 0, 0.66)))
    cap = bpy.data.meshes.new(f"falls_lamp_cap_{k}")
    bm.to_mesh(cap)
    bm.free()
    cob = bpy.data.objects.new(f"falls_lamp_cap_{k}", cap)
    cap.materials.append(M_SLAB)
    cap.uv_layers.new(name="UVMap")
    cob.location = Vb(lp["x"], lp["z"], 0.0)
    link(cob, cat="lamp")
    em = bpy.data.objects.new(f"light__falls_lamp_{k + 1}", None)
    em.empty_display_type = "SPHERE"
    em.empty_display_size = 0.15
    em.location = Vb(lp["x"], lp["z"], 0.49)
    link(em, cat="light")
    LAMP_TRIS += sum(len(m.polygons) for m in (stone, glass, cap))

# cobbles: small water-worn stones on the beach round the pool (shared mesh, 80 triangles)
bm = bmesh.new()
bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
for v in bm.verts:
    n = v.co.normalized()
    v.co = Vector((n.x * 1.25, n.y * 0.95, max(n.z, -0.3) * 0.62)) * (1 + 0.1 * F.noise3(n.x * 2, n.y * 2, n.z * 2))
pe = bpy.data.meshes.new("falls_pebble")
bm.to_mesh(pe)
bm.free()
pe.materials.append(M_SLAB)
uvl = pe.uv_layers.new(name="UVMap")
for p in pe.polygons:
    for li in p.loop_indices:
        co = pe.vertices[pe.loops[li].vertex_index].co
        uvl.data[li].uv = (co.x * 0.5 + 0.3, co.y * 0.5 + 0.7)
ca = pe.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
for i, v in enumerate(pe.vertices):
    ca.data[i].color = (0.0, 0.2 * F.smooth(0.0, -0.4, v.co.z), 0.0, 0.0)
pe.shade_smooth()
pebble_root = bpy.data.objects.new("inst__falls_pebble", None)
pebble_root["cat"] = "inst_root"
link(pebble_root)
PEBBLES = 0
tries = 0
prng = random.Random(55)
while PEBBLES < 220 and tries < 40000:
    tries += 1
    x = prng.uniform(S["minX"] + 10, -99.5)
    z = prng.uniform(-93.0, -63.0)
    sd = F.pool_signed_dist(x, z)
    if sd < -0.3 or sd > 6.0 or on_slab_or_seat(x, z, 0.25):
        continue
    if cliff_at(x, z, 1) or F.outlet_dist(x, z)[0] < F.OUTLET["width"] / 2 + 0.2:
        continue
    if abs(z - F.LIP["z"]) < 3.0 and x > F.LIP["x"] - 2:
        continue
    if prng.random() > F.smooth(6.0, 0.5, sd) * 3.0:
        continue
    pocket = in_pocket(x, z, 0.3)
    s_ = prng.uniform(0.07, 0.14) if pocket else prng.uniform(0.14, 0.36)
    gy = F.floor_y(x, z) if x < -105 else 0.0
    sink = 0.45 if pocket else 0.3
    ob = bpy.data.objects.new(f"pebble_{PEBBLES}", pe)
    ob.location = Vb(x, z, gy - s_ * 0.62 * sink)
    ob.rotation_euler = (prng.uniform(-0.3, 0.3), prng.uniform(-0.3, 0.3), prng.uniform(0, 6.28))
    ob.scale = (s_, s_ * prng.uniform(0.8, 1.2), s_)
    ob.parent = pebble_root
    ob["cat"] = "inst"
    ob["tier"] = "high"
    link(ob)
    PEBBLES += 1
PEBBLE_TRIS = PEBBLES * len(pe.polygons)

# ================================================================================================== plants ==
vrng = random.Random(77)
PL = P.Leaves()          # ledges, cracks, banks (both tiers)
PLH = P.Leaves()         # flank undergrowth (high tier only)
FRESH = (0.95, 1.0, 0.85)


def far_from(pts, x, z, y, d):
    return all(math.hypot(p[1] - z, p[2] - y) >= d or abs(p[0] - x) > 3 for p in pts)


# 1. ledges: sedge tufts, small shrubs, ferns, sprays hanging over the edge (photo 12: green in every step)
LEDGE_SITES = []
for (x, z, y, dep) in sorted(P.ledges(), key=lambda t: vrng.random()):
    if abs(z - F.FZ) > 16.0 or blocked_by_water(z, y) or y > F.TOP + 0.5:
        continue
    if not far_from(LEDGE_SITES, x, z, y, 1.3):
        continue
    LEDGE_SITES.append((x, z, y, dep))
    if len(LEDGE_SITES) >= 72:
        break
for i, (x, z, y, dep) in enumerate(LEDGE_SITES):
    xb = x - min(dep * 0.5, 0.4)
    base = Vector(Vb(xb, z, y + 0.02))
    r = vrng.random()
    if r < 0.38:
        P.grass(PL, base, vrng.uniform(0.45, 0.85), vrng, n=3, tint=FRESH)
        if vrng.random() < 0.5:
            P.grass(PL, base + Vector((0.1, vrng.uniform(-0.6, 0.6), 0)), vrng.uniform(0.35, 0.6), vrng, n=2, tint=FRESH)
    elif r < 0.7:
        P.shrub(PL, base, vrng.uniform(0.6, 1.25), vrng.uniform(0.7, 1.3), vrng, tint=FRESH)
    elif r < 0.85:
        P.fern(PL, base, vrng.randint(6, 8), vrng.uniform(0.6, 0.95), vrng, tint=FRESH)
    else:
        P.hanging(PL, Vector(Vb(x + 0.05, z, y + 0.05)), (1, 0, 0), vrng.uniform(0.8, 1.6), vrng, n=3, tint=FRESH)
        P.grass(PL, base, 0.4, vrng, n=2, tint=FRESH)
# 2. vertical cracks: grass and hanging sprays growing out of the joints (damper, lower rock mostly)
CRACK_SITES = []
for (x, z, y) in sorted(P.cracks(), key=lambda t: vrng.random()):
    if abs(z - F.FZ) > 15.0 or blocked_by_water(z, y) or y > F.TOP - 1.0:
        continue
    if vrng.random() > 0.35 + 0.65 * F.smooth(22.0, 4.0, y):
        continue
    if not far_from(CRACK_SITES, x, z, y, 2.2):
        continue
    CRACK_SITES.append((x, z, y))
    if len(CRACK_SITES) >= 30:
        break
for (x, z, y) in CRACK_SITES:
    if vrng.random() < 0.5:
        P.hanging(PL, Vector(Vb(x + 0.02, z, y)), (1, 0, 0), vrng.uniform(0.7, 1.3), vrng, n=2, tint=FRESH)
    else:
        P.grass(PL, Vector(Vb(x - 0.05, z, y)), vrng.uniform(0.35, 0.6), vrng, up=(0.5, 0, 1), n=2, tint=FRESH)
# 3. the banks and the cliff foot: ferns at the foot, sedge along the shore, shrubs at the beach's edge
BANK_SITES = []
tries = 0
while len(BANK_SITES) < 46 and tries < 6000:
    tries += 1
    x = vrng.uniform(S["minX"] + 12, -100.5)
    z = vrng.uniform(-101.0, -59.5)
    sd = F.pool_signed_dist(x, z)
    if sd < 0.15 or sd > 9.0 or in_pocket(x, z, 0.8) or on_slab_or_seat(x, z, 0.5):
        continue
    if F.outlet_dist(x, z)[0] < F.OUTLET["width"] / 2 + 0.3 or (abs(z - F.LIP["z"]) < 4.0 and x > F.LIP["x"] - 2):
        continue
    hit = surface_down(x, z)
    if hit is None or hit[1].z < 0.6:
        continue
    if any(math.hypot(b[0] - x, b[1] - z) < 1.6 for b in BANK_SITES):
        continue
    BANK_SITES.append((x, z, hit[0]))
for (x, z, p) in BANK_SITES:
    sd = F.pool_signed_dist(x, z)
    foot = cliff_at(x, z, 2)
    r = vrng.random()
    if sd < 1.6 and r < 0.7:
        P.grass(PL, p, vrng.uniform(0.5, 1.0), vrng, n=3, tint=FRESH)          # sedge / reeds at the water (photo 05)
    elif foot and r < 0.6:
        P.fern(PL, p, vrng.randint(7, 9), vrng.uniform(0.8, 1.2), vrng, tint=FRESH)
    elif r < 0.75:
        P.shrub(PL, p, vrng.uniform(0.7, 1.3), vrng.uniform(0.8, 1.4), vrng, tint=FRESH)
    else:
        P.fern(PL, p, vrng.randint(6, 8), vrng.uniform(0.7, 1.0), vrng, tint=FRESH)
# 4. the wooded flanks and the plateau: a dense shrub layer under the trees (high tier; W6's forest continues it)
FLANK_SITES = []
tries = 0
while len(FLANK_SITES) < 95 and tries < 9000:
    tries += 1
    x = vrng.uniform(S["minX"] + 0.5, -100.5)
    z = vrng.uniform(S["minZ"] + 0.5, S["maxZ"] - 0.5)
    dz = abs(z - F.FZ)
    hit = surface_down(x, z)
    if hit is None:
        continue
    p, n = hit
    plateau = p.z > F.PLATEAU_Y - 2.5
    if not (dz > 14.0 or plateau):
        continue
    if F.pool_signed_dist(x, z) < 2.5 or in_pocket(x, z, 2.0) or F.outlet_dist(x, z)[0] < F.OUTLET["width"] / 2 + 1.0:
        continue
    if plateau and abs(z - F.CHANNEL_Z_TOP) < 4.0 and x > -130:
        continue
    if any(math.hypot(b[0] - x, b[1] - z) < 2.1 for b in FLANK_SITES):
        continue
    FLANK_SITES.append((x, z, p, n))
for (x, z, p, n) in FLANK_SITES:
    up = (Vector((0, 0, 1)) * 0.75 + n * 0.25).normalized()
    if vrng.random() < 0.8:
        P.shrub(PLH, p, vrng.uniform(1.0, 1.9), vrng.uniform(1.0, 1.9), vrng, up=up, tint=FRESH)
    else:
        P.fern(PLH, p, vrng.randint(7, 9), vrng.uniform(0.9, 1.3), vrng, up=up, tint=FRESH)

# 5. the rim: shrubs along the top edge, sprays hanging over it (the forest reaches the edge in photos 05 / 12)
RIM = []
zz = F.FACE_Z[0] + 1.0
while zz < F.FACE_Z[1] - 1.0:
    z = zz + vrng.uniform(-0.4, 0.4)
    zz += vrng.uniform(1.3, 2.0)
    if abs(z - F.channel_z(F.TOP)) < 4.2:
        continue
    yr = F.TOP + vrng.uniform(0.6, 2.2)
    x = P.face_x_detailed(z, yr)
    RIM.append((x, z, yr))
    P.shrub(PL, Vector(Vb(x - 0.35, z, yr - 0.1)), vrng.uniform(0.9, 1.6), vrng.uniform(0.9, 1.5), vrng,
            up=(0.35, 0, 1), tint=FRESH)
    if vrng.random() < 0.6:
        yh = F.TOP - vrng.uniform(0.0, 1.0)
        P.hanging(PL, Vector(Vb(P.face_x_detailed(z, yh) + 0.05, z, yh)), (1, 0, 0), vrng.uniform(1.2, 2.4), vrng,
                  n=3, tint=FRESH)
# 6. along both edges of the cascade groove: sprays hanging into it, small shrubs on its lips
for side in (-1, 1):
    y = F.LEDGE + 1.5
    while y < F.TOP - 0.5:
        z = F.channel_z(y) + side * vrng.uniform(3.4, 4.4)
        x = P.face_x_detailed(z, y)
        if vrng.random() < 0.55:
            P.hanging(PL, Vector(Vb(x + 0.05, z, y)), (1, 0, 0), vrng.uniform(1.0, 2.0), vrng, n=2, tint=FRESH)
        else:
            P.shrub(PL, Vector(Vb(x - 0.2, z, y)), vrng.uniform(0.5, 0.9), vrng.uniform(0.6, 1.0), vrng,
                    up=(0.4, 0, 1), tint=FRESH)
        y += vrng.uniform(1.6, 2.8)
print("rim plants", len(RIM))

PLANTS = PL.mesh("veg__falls_plants", M_PLANT)
link(PLANTS, cat="leaf")
PLANTS_HI = PLH.mesh("veg__falls_plants_hi", M_PLANT)
link(PLANTS_HI, cat="leaf", high_only=True)
VEG_TRIS = PL.tris() + PLH.tris()
VEG_TRIS_LOW = PL.tris()
print("plant tris", PL.tris(), PLH.tris())

# 5. trees: broadleaf templates (instanced), on the flanks, along the rim leaning out over the edge, and on the banks
TPL_SPEC = [  # (H, R, lean, shell cards, card size)
    (13.0, 4.8, 0.0, 46, (2.6, 3.6)), (15.5, 5.4, 0.1, 52, (2.8, 3.8)), (11.0, 4.2, 0.0, 40, (2.4, 3.3)),
    (12.5, 5.2, 0.55, 46, (2.6, 3.6)), (10.0, 4.6, 0.75, 40, (2.4, 3.3)), (16.5, 4.6, 0.05, 48, (2.7, 3.7)),
]
TPL = []
for k, (H, R, lean, shell, card) in enumerate(TPL_SPEC):
    lv = P.tree_template(900 + k, H, R, lean, shell, card)
    ob = lv.mesh(f"falls_tree_{k}", [M_BARK, M_LEAF])
    SRC.objects.link(ob)
    TPL.append((ob, lv.tris(), H, R, lean))
print("tree template tris", [t[1] for t in TPL])
TREE_SPOTS = []      # (x, z, base Blender point, template, yaw, scale)


def tree_ok(x, z, r):
    if in_pocket(x, z, 2.5) or F.pool_signed_dist(x, z) < 1.2 or F.outlet_dist(x, z)[0] < F.OUTLET["width"] / 2 + 1.2:
        return False
    if x > -101.5 and -92 < z < -64:
        return False                                   # keep the rest area's view of the falls open
    return all(math.hypot(t[0] - x, t[1] - z) >= r for t in TREE_SPOTS)


# rim: crowns leaning out over the edge, either side of the groove (photos 05 / 12)
for zc in (F.FZ - 13.0, F.FZ - 9.0, F.FZ - 5.2, F.FZ + 4.2, F.FZ + 8.2, F.FZ + 12.0):
    x = F.face_x(zc, F.TOP + 4.5) - vrng.uniform(1.0, 2.0)
    hit = surface_down(x, zc)
    if hit and tree_ok(x, zc, 3.0):
        TREE_SPOTS.append((x, zc, hit[0], vrng.choice([3, 4]), vrng.uniform(-0.35, 0.35), vrng.uniform(0.85, 1.1)))
# flanks and the plateau behind
tries = 0
while len(TREE_SPOTS) < 44 and tries < 6000:
    tries += 1
    x = vrng.uniform(S["minX"] + 1.0, -100.5)
    z = vrng.uniform(S["minZ"] + 0.5, S["maxZ"] - 0.5)
    hit = surface_down(x, z)
    if hit is None:
        continue
    p, n = hit
    dz = abs(z - F.FZ)
    plateau = p.z > F.PLATEAU_Y - 2.5
    if not (dz > 14.5 or plateau or (F.pool_signed_dist(x, z) > 2.0 and p.z < 1.5 and dz > 11.5)):
        continue
    if plateau and abs(z - F.CHANNEL_Z_TOP) < 3.5 and x > -131:
        continue
    if not tree_ok(x, z, 5.2 if plateau else 4.6):
        continue
    k = vrng.choice([0, 1, 2, 5, 0, 2]) if plateau or dz > 18 else vrng.choice([0, 2, 3, 4])
    yaw = vrng.uniform(-0.6, 0.6) if k in (3, 4) else vrng.uniform(0, 6.28)
    TREE_SPOTS.append((x, z, p, k, yaw, vrng.uniform(0.8, 1.15)))
tree_roots = {}
TREE_TRIS = 0
TREE_TRIS_LOW = 0
for k in range(len(TPL)):
    r = bpy.data.objects.new(f"inst__falls_tree_{k}", None)
    r["cat"] = "inst_root"
    link(r)
    tree_roots[k] = r
for i, (x, z, p, k, yaw, s) in enumerate(TREE_SPOTS):
    ob = bpy.data.objects.new(f"falls_tree_{k}_{i}", TPL[k][0].data)
    ob.location = p
    ob.rotation_euler = (0.0, 0.0, yaw)
    ob.scale = (s, s, s)
    ob.parent = tree_roots[k]
    low = i % 4 == 0
    link(ob, cat="tree", high_only=not low)
    TREE_TRIS += TPL[k][1]
    TREE_TRIS_LOW += TPL[k][1] if low else 0
print("trees", len(TREE_SPOTS), "tris", TREE_TRIS)

# ============================================================================================ validation ==
report = {"fails": []}


def tri_count(obs):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in obs if o.type == "MESH")


worst_wall = 1e9
for ob in (FACE0, FACE1):
    for v in ob.data.vertices:
        worst_wall = min(worst_wall, F.camera_wall_x(-v.co.y) - v.co.x)
report["worst_wall_gap_m"] = round(worst_wall, 3)
if worst_wall < 0.5 - 1e-3:
    report["fails"].append(f"rock closer than 0.5 m to the camera wall ({worst_wall:.3f})")
# the groove (W2's film) follows face_x exactly; under the ledge beside the plunge the rock is never out of face_x
gd, pd = 0.0, 0.0
for j in range(0, 80):
    y = F.LEDGE + 0.6 + j * (F.TOP - F.LEDGE - 0.6) / 79
    for dz in (-1.6, -0.8, 0.0, 0.8, 1.6):
        z = F.channel_z(y) + dz
        gd = max(gd, abs(P.face_x_detailed(z, y) - F.face_x(z, y)))
for j in range(0, 60):
    y = -0.2 + j * (F.LEDGE - 0.2) / 59
    for dz in [k * 0.25 - 6.0 for k in range(49)]:
        z = F.LIP["z"] + dz
        pd = max(pd, P.face_x_detailed(z, y) - F.face_x(z, y))
report["groove_max_dev_m"] = round(gd, 4)
report["plunge_max_out_m"] = round(pd, 4)
if gd > 0.02:
    report["fails"].append(f"groove off face_x by {gd:.3f}")
if pd > 0.001:
    report["fails"].append(f"rock out of face_x in the plunge zone by {pd:.3f}")
for s, ob in zip(F.SLABS, SLABS):
    zmax = max(v.co.z for v in ob.data.vertices)
    report[f"{s['id']}_top"] = round(zmax, 4)
    if not (0.02 - 0.003 <= zmax <= 0.04 + 0.003):
        report["fails"].append(f"{s['id']} top {zmax}")
for s, ob in zip(F.SEATS, SEATS):
    zmax = max(v.co.z for v in ob.data.vertices)
    report[f"{s['id']}_top"] = round(zmax, 4)
    if abs(zmax - s["seatTop"]) > 0.03:
        report["fails"].append(f"{s['id']} top {zmax}")
bad = 0
for v in GROUND.data.vertices:
    gx, gz = v.co.x, -v.co.y
    if F.walk_surface_ok(gx, gz) and F.slab_at(gx, gz) is None and abs(v.co.z) > 0.06:
        bad += 1
report["pocket_ground_bad_verts"] = bad
if bad:
    report["fails"].append(f"{bad} pocket ground vertices off the walk level")
mx = -1e9
for ob in COLL.objects:
    if ob.type == "MESH" and ob.get("cat") in ("rock", "ground"):
        for v in ob.data.vertices:
            mx = max(mx, v.co.x)
report["max_x_cliff_ground"] = round(mx, 3)
T = {
    "cliff_lod0": tri_count([FACE0]), "cliff_lod1": tri_count([FACE1]), "flank_lod0": tri_count([FLANK0]),
    "flank_lod1": tri_count([FLANK1]), "ground": tri_count([GROUND]),
    "kit_instances": INST_COUNT, "kit_instance_tris": INST_TRIS, "kit_meshes": KIT_TRIS,
    "slabs_seats": tri_count(SLABS + SEATS), "lamps": LAMP_TRIS, "pebbles": PEBBLE_TRIS,
    "plants": PL.tris(), "plants_hi": PLH.tris(), "trees": len(TREE_SPOTS), "tree_tris": TREE_TRIS,
    "tree_templates": [t[1] for t in TPL],
}
report["tris"] = T
high = T["cliff_lod0"] + T["flank_lod0"] + T["ground"] + INST_TRIS + T["slabs_seats"] + LAMP_TRIS + PEBBLE_TRIS + VEG_TRIS + TREE_TRIS
low = T["cliff_lod1"] + T["flank_lod1"] + T["ground"] + INST_TRIS_LOW + T["slabs_seats"] + LAMP_TRIS + VEG_TRIS_LOW + TREE_TRIS_LOW
report["tris_total_w1_high"] = high
report["tris_total_w1_low"] = low
if high > 66000:
    report["fails"].append(f"high tier {high} > 66k")
if low > 24000:
    report["fails"].append(f"low tier {low} > 24k")
report["tex"] = {"files": sorted(os.listdir(TEXF)),
                 "sizes": "1024x1024: rock (+n), rock macro RGBA on UV2 (+n), slab (+n), gravel (+n), turf (+n), foliage RGBA"}
report["joint_layout"] = {"blocks": len(P.layout()["blocks"]), "tiers": [round(t, 2) for t in P.TIERS]}
print(json.dumps(report, indent=1))
json.dump(report, open(os.path.join(WORK, "falls_w1_report.json"), "w"), indent=1)
save_cache()

# =============================================================================================== save/export ==
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, "falls_w1.blend"))
if not NO_GLB:
    for _o in (FACE1, FLANK1):
        _o.hide_viewport = False
    for o in bpy.context.scene.objects:
        o.select_set(False)
    sel = [o for o in COLL.objects if o.type in ("MESH", "EMPTY")]
    for o in sel:
        o.select_set(True)
    bpy.context.view_layer.objects.active = FACE0
    glb = os.path.join(WORK, "falls_w1.glb")
    kw = dict(filepath=glb, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
              export_texcoords=True, export_normals=True, export_materials="EXPORT", export_image_format="WEBP",
              export_image_quality=80, export_animations=False, export_cameras=False, export_lights=False,
              export_extras=True, export_skins=False, export_morph=False, export_vertex_color="MATERIAL",
              export_tangents=False, export_gpu_instances=True,
              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
              export_draco_position_quantization=14, export_draco_normal_quantization=10,
              export_draco_texcoord_quantization=12, export_draco_color_quantization=8,
              export_draco_generic_quantization=12)
    try:
        bpy.ops.export_scene.gltf(**kw)
        print("GLB", glb, os.path.getsize(glb), "bytes")
        report["glb_bytes"] = os.path.getsize(glb)
        json.dump(report, open(os.path.join(WORK, "falls_w1_report.json"), "w"), indent=1)
    except Exception as e:  # noqa: BLE001
        print("GLB export failed:", e)
