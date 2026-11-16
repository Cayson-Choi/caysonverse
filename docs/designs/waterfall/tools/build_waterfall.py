"""B1 waterfall, W1: the rock, ground and plant art of the falls site (authoring scene). Round 4 (2026-11-16):
the cliff is built from photoscanned CC0 rocks (Poly Haven; prep_falls_scans.py -> work/falls_scans.blend).

  blender -b --factory-startup -P prep_falls_scans.py          (once, after the scans are downloaded)
  blender -b --factory-startup -P build_waterfall.py -- [--no-glb] [--debug-maps]

Reads the LOCKED shape from falls_shape.py (face_x over FACE_Z/FACE_Y, terrain_y minus is_cliff_cell, slabs, seats,
lamps, camera wall) and the scan dressing from parts_falls_scan.py, and builds, in GAME coordinates converted by
Vb() = Blender (x, -z, y):

  falls_rock_lod0 / falls_rock_lod1   the cliff: a backing face (face_x exactly in the cascade groove core, 1.6 m behind
                                      the face elsewhere; tiled scan texture, material slot 0 M_falls_rock) dressed with
                                      ~40 decimated scan pieces (namaqualand cliff sections, granite masses, a lichen
                                      rock face; slots 1.. M_falls_scan_<key>, each with its own baked albedo + normal
                                      on UV0), stacked bottom-up, bent to face_x, clamped to the contract, hidden faces
                                      culled. UV2 = the face's (z, y) square (lightmap AND the macro colour map
                                      T_falls_rock_macro: RGB x2, 0.5 = x1). 'Col' R moss (up-facing), G wet. Double-sided.
  falls_flank_lod0 / _lod1            the wooded slopes either side of the bare rock (forest floor)       M_falls_turf
  falls_ground                        site ground west of the pocket: gravel / turf / boulder-granite by slope
  inst__falls_rock_k (k = 0..3)       scan boulders: banks, shallows, talus              M_falls_boulder_<key>
  inst__falls_pebble                  cobbles on the beach                                             M_falls_slab
  inst__falls_tree_k (k = 0..5)       broadleaf trees on the flanks, the rim and the banks   M_falls_bark + M_leaf_green
  falls_slab_n / falls_seat_n|s       the 4 walkable flat rocks (top 0.02-0.04) and the 2 stone seats (top 0.42)
  falls_lamp_n + light__falls_lamp_n  placeholder warm lamps (baked into the night lightmap by W3)
  veg__falls_plants / veg__falls_plants_hi   alpha-cut plant cards (ledges, cracks, bushes, banks / flank undergrowth)
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
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import falls_shape as F  # noqa: E402
import parts_falls_rock as P  # noqa: E402
import parts_falls_scan as SC  # noqa: E402
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
                   streak_k=1.0, lich_k=1.0, macro_bump=False):
    """Stone: colour + normal (UV0: the scan's own baked maps, or the tiled scan texture), optional macro map on UV2
    (RGB colour x2, 0.5 = x1; A relief height -> bump only if macro_bump), and the 'Col' masks: R moss, G wet (darker,
    glossy), B water-stain streaks, A lichen."""
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
    if macro and macro_bump:
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


MACRO = "T_falls_rock_macro.png"          # written by the cliff section below, before the materials are rendered
SCAN_KEYS = ("cliff2", "cliff1", "face2", "boulder1", "boulder3")
M_ROCK = stone_material("M_falls_rock", "M_falls_rock", "scans/T_falls_rock_base_d.png", "scans/T_falls_rock_base_n.png",
                        macro=MACRO, streak_k=0.5, lich_k=0.0, strength=0.9, base_rough=0.82)
M_SCAN = {k: stone_material(f"M_falls_scan_{k}", f"M_falls_scan_{k}", f"scans/T_scan_{k}_d.png", f"scans/T_scan_{k}_n.png",
                            macro=MACRO, streak_k=0.5, lich_k=0.0, strength=1.0, base_rough=0.84) for k in SCAN_KEYS}
for _m in [M_ROCK] + list(M_SCAN.values()):
    _m.use_backface_culling = False      # glTF doubleSided: the few cut scan triangles never open a see-through hole
M_BOULDER = {k: stone_material(f"M_falls_boulder_{k}", f"M_falls_boulder_{k}", f"scans/T_scan_{k}_d.png",
                               f"scans/T_scan_{k}_n.png", moss_col="#4F6A28", base_rough=0.82, strength=1.0)
             for k in ("boulder1", "boulder3", "cliff1")}
M_SLAB = stone_material("M_falls_slab", "M_falls_slab", "scans/T_falls_slab_d.png", "scans/T_falls_rock_base_n.png",
                        moss_col="#4F6A28", base_rough=0.74, strength=0.9)
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
    w = max(math.exp(-(d_ch / 3.6) ** 2), F.smooth(9.0, 3.5, d_pl) * (1.0 if y > -1 else 0.0))
    near = math.hypot(x - F.IMPACT["x"], z - F.IMPACT["z"]) - 5.0
    w = max(w, math.exp(-max(0.0, near) / 3.0) * F.smooth(6.0, 1.0, y))
    w = max(w, F.smooth(1.2, 0.0, y - F.WATER_Y) * 0.9)
    return min(1.0, w)


def flank_z(zc, yc):
    return abs(zc - F.FZ) > 15.2 + 1.0 * F.noise3(zc * 0.12, yc * 0.06, 2.2)


# ======================================================================== the cliff: backing face + scans ==
SCANS = SC.load_scans(os.path.join(WORK, "falls_scans.blend"))
PIECES = {k: {lod: SC.Piece(SCANS[k][lod]) for lod in ("hi", "lo")} for k in SC.KEYS}
print("scan pieces:", {k: (len(PIECES[k]["hi"].tris), len(PIECES[k]["lo"].tris)) for k in SC.KEYS})
REF = SC.Ref()
CLIFF_MATS = [M_ROCK] + [M_SCAN[k] for k in SC.KEYS]
MI_OF = {k: i + 1 for i, k in enumerate(SC.KEYS)}


def rock_needed(z, y):
    """The bare-rock part of the face the scans must cover."""
    if abs(z - F.FZ) > 16.8 or z > SEAM_Z or (flank_z(z, y) and abs(z - F.FZ) > 16.0):
        return False
    if y > F.LEDGE - 0.3 and SC.groove_d(z, y) < SC.GROOVE_CORE + 0.2:
        return False                                   # the groove core: W2's film lies on the backing face
    x = F.face_x(z, y)
    return F.floor_y(x + 0.3, z) - 0.5 < y < F.PLATEAU_Y - 0.3


NEED_G = SC.Grid(F.FACE_Z[0], min(F.FACE_Z[1], SEAM_Z), -2.5, F.PLATEAU_Y, 0.5)
NEED = NEED_G.fill(rock_needed).astype(bool)
PLACEMENTS = SC.place_pieces(SCANS, REF, random.Random(404), (NEED_G, NEED), max_pieces=70)
_kinds = {}
for _p in PLACEMENTS:
    _kinds[_p.kind] = _kinds.get(_p.kind, 0) + 1
print("placements by kind", _kinds)


def assemble_pieces(lod):
    A = SC.Assembly()
    for pl in PLACEMENTS:
        pc = PIECES[pl.kind]["hi" if lod == 0 else "lo"]
        W, tris, uvs = SC.piece_tris(pl, pc, REF, F.floor_y)
        A.add(W, tris, uvs, MI_OF[pl.kind])
    return A


PA = {0: assemble_pieces(0), 1: assemble_pieces(1)}
_tmp = PA[0].mesh("tmp_pieces", CLIFF_MATS)
DP_RES = (160, 175)                                    # 0.25 m
DP, _, _, _ = SC.raycast_maps([_tmp], *DP_RES)
DP_G = (F.FACE_Z[0], F.FACE_Y[0], (F.FACE_Z[1] - F.FACE_Z[0]) / DP_RES[0], (F.FACE_Y[1] - F.FACE_Y[0]) / DP_RES[1])


def dp_at(z, y):
    i = int((z - DP_G[0]) / DP_G[2])
    j = int((y - DP_G[1]) / DP_G[3])
    if 0 <= i < DP_RES[0] and 0 <= j < DP_RES[1]:
        v = DP[j, i]
        return None if np.isnan(v) else float(v)
    return None


def base_hidden(z, y, xb):
    """The backing face at (z, y) is behind thick scan rock all round AND below (the camera looks up from the rest
    area: a gap under an overhang must still show rock, not the void behind the cliff), so it can go."""
    for dz_, dy_ in ((0, 0), (0.6, 0), (-0.6, 0), (0, 0.5), (0, -0.5), (0, -1.0), (0, -1.5), (0, -2.0),
                     (0.6, -1.0), (-0.6, -1.0), (0.6, 0.5), (-0.6, 0.5)):
        d = dp_at(z + dz_, y + dy_)
        if d is None or d < xb + 0.5:
            return False
    return True


def build_base(lod):
    """The backing face (rock, under the scans; exactly face_x in the groove core) and the wooded flank slopes:
    a coarse grid plus a dense strip over the groove (T-junctions at the strip edge lie behind the scans)."""
    verts, keepv = [], []
    rock_q, turf_q, push = [], [], set()
    for zs, ys, kind in SC.base_grids(lod):
        nz, ny = len(zs), len(ys)
        h = (0.4 if lod == 0 else 0.9) if kind == "strip" else (1.6 if lod == 0 else 3.0)
        b0 = len(verts)
        for y in ys:
            for z in zs:
                x = SC.base_x(z, y, h * 1.4, REF, F.smooth(15.0, 17.0, abs(z - F.FZ)))
                verts.append((x, z, y))
                keepv.append(y > F.floor_y(x, z) - 0.35)
        for j in range(ny - 1):
            for i in range(nz - 1):
                a = b0 + j * nz + i
                q = (a, a + 1, a + nz + 1, a + nz)
                if not any(keepv[k] for k in q):
                    continue
                xm = sum(verts[k][0] for k in q) / 4
                zm = sum(verts[k][1] for k in q) / 4
                ym = sum(verts[k][2] for k in q) / 4
                if (kind == "coarse") == SC.in_strip(zm, ym):
                    continue
                if ym > F.PLATEAU_Y + 2.0 or zm > SEAM_Z + 0.45:
                    continue
                if (cliff_at(xm, zm) or SC.core_w(zm, ym) > 0.0) and zm <= SEAM_Z:
                    pass
                elif cliff_at(xm, zm, 1) or ym > F.TOP + 1.0 or zm > SEAM_Z:
                    for k in q:
                        push.add(k)
                else:
                    continue
                if flank_z(zm, ym):
                    turf_q.append(q)
                elif SC.core_w(zm, ym) > 0.0 or not all(base_hidden(verts[k][1], verts[k][2], verts[k][0]) for k in q):
                    rock_q.append(q)
    vb = [Vector(Vb(x - (0.05 if k in push else 0.0), z, y)) for k, (x, z, y) in enumerate(verts)]

    def turf_col(k):
        x, z, y = verts[k]
        n = F.fbm(z * 0.4, y * 0.4, 5.5)
        v_ = 0.8 + 0.5 * n
        return (v_ * 0.95, v_ * 1.02, v_ * 0.82, 1.0)
    used = sorted({k for q in turf_q for k in q})
    remap = {k: i for i, k in enumerate(used)}
    fk = P.mesh_from(f"falls_flank_lod{lod}", [tuple(vb[k]) for k in used], [tuple(remap[k] for k in q) for q in turf_q],
                     M_TURF, uv=[(0, 0)] * len(used), colors=[turf_col(k) for k in used])
    P.orient(fk.data, (1, 0, 0))
    P.planarize(fk.data, 2.0 if lod == 0 else 5.0)
    P.box_uv(fk.data, 3.0)
    link(fk, cat="ground")
    # rock quads -> triangles with a per-face box projection (3 m tile) for the tiled scan texture
    tris, uvs = [], []
    for q in rock_q:
        for t in ((q[0], q[1], q[2]), (q[0], q[2], q[3])):
            p0, p1, p2 = vb[t[0]], vb[t[1]], vb[t[2]]
            n = (p1 - p0).cross(p2 - p0)
            if n.x < 0:
                t = (t[0], t[2], t[1])
                n = -n
            ax = max(range(3), key=lambda k: abs(n[k]))
            uv = []
            for k in t:
                co = vb[k]
                u, v = ((-co.y, co.z) if ax == 0 else (co.x + 0.17, co.z) if ax == 1 else (co.x + 0.53, -co.y))
                uv.append((u / 3.0 + 0.31, v / 3.0))
            tris.append(t)
            uvs.append(tuple(uv))
    return vb, tris, uvs, fk


def cliff_object(lod, keep_pieces=None):
    vb, tris, uvs, fk = BASE[lod]
    A = SC.Assembly()
    A.add(vb, tris, uvs, 0)
    nb = len(A.t)
    pa = PA[lod]
    A.add(pa.v, pa.t, pa.uv, 0)
    A.mi[nb:] = pa.mi
    keep = None
    if keep_pieces is not None:
        keep = [True] * nb + keep_pieces
    return A.mesh(f"falls_rock_lod{lod}", CLIFF_MATS, keep)


print("building cliff...")
BASE = {0: build_base(0), 1: build_base(1)}
FLANK0, FLANK1 = BASE[0][3], BASE[1][3]
_full0 = cliff_object(0)
MAC_RES = (1024, 1024)
D, NRM, MIDX, _ = SC.raycast_maps([_full0], *MAC_RES)
BACKMASK = (NRM[..., 0] < -0.3) & ~np.isnan(D)
BACK_HITS = int(BACKMASK.sum())          # rays from the east meeting a back face
NRM = np.where((NRM[..., 0:1] < 0), -NRM, NRM)
if "--debug-maps" in argv:
    SC.save_rgb(np.stack([BACKMASK * 1.0, (np.nan_to_num(D, nan=-130) + 130) / 20, (MIDX % 100) / 6.0], -1),
                os.path.join(CACHE, "dbg_maps.png"))
MAC_DZ = (F.FACE_Z[1] - F.FACE_Z[0]) / MAC_RES[0]
MAC_DY = (F.FACE_Y[1] - F.FACE_Y[0]) / MAC_RES[1]


def front_x(z, y):
    """x of the drawn rock's front at (z, y) (the raycast from the east), or face_x where nothing was hit."""
    i = int((z - F.FACE_Z[0]) / MAC_DZ)
    j = int((y - F.FACE_Y[0]) / MAC_DY)
    if 0 <= i < MAC_RES[0] and 0 <= j < MAC_RES[1] and not np.isnan(D[j, i]):
        return float(D[j, i])
    return F.face_x(z, y)


# hidden scan triangles: every corner more than 0.4 m (lod1: 0.55 m) behind the front all round (r ~0.8 m) -> dropped
DMIN = SC.shift_filter(np.where(np.isnan(D), -1e9, D), 20, "min")


def tri_hidden(pa, t, margin):
    for k in t:
        v = pa.v[k]
        i = int((-v.y - F.FACE_Z[0]) / MAC_DZ)
        j = int((v.z - F.FACE_Y[0]) / MAC_DY)
        if not (0 <= i < MAC_RES[0] and 0 <= j < MAC_RES[1]):
            return False
        if v.x > DMIN[j, i] - margin:
            return False
    return True


KEEP = {lod: [not tri_hidden(PA[lod], t, 0.4 if lod == 0 else 0.55) for t in PA[lod].t] for lod in (0, 1)}
print("scan tris kept", {lod: (sum(KEEP[lod]), len(KEEP[lod])) for lod in (0, 1)})
for _o in (_tmp, _full0):
    _m = _o.data
    bpy.data.objects.remove(_o)
    bpy.data.meshes.remove(_m)
FACE0 = cliff_object(0, KEEP[0])
FACE1 = cliff_object(1, KEEP[1])
for _o, _n in ((FACE0, "falls_rock_lod0"), (FACE1, "falls_rock_lod1")):
    _o.name = _n
    _o.data.name = _n


def cliff_cols(ob):
    """'Col' masks: R moss on up-facing damp surfaces, G wet; B streak and A lichen live in the macro map now."""
    me = ob.data
    me.update()
    ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    for i, v in enumerate(me.vertices):
        x, z, y = v.co.x, -v.co.y, v.co.z
        n_up = v.normal.z
        wet = wetness(x, y, z)
        damp = 0.35 + 0.65 * F.smooth(18.0, 2.0, y)
        moss = 0.5 * F.smooth(0.65, 0.92, n_up) * damp * (0.55 + 0.45 * F.fbm(z * 0.35, y * 0.35, 2.2))
        moss *= 1.0 - 0.8 * F.smooth(0.55, 0.9, wet) * (1.0 if y > 1.5 else 0.0)
        ca.data[i].color = (min(1.0, max(0.0, moss)), wet, 0.0, 0.0)


for _o in (FACE0, FACE1):
    cliff_cols(_o)
    link(_o, cat="rock")
for _o in (FACE1, FLANK1):
    _o.hide_render = True
    _o.hide_viewport = True
    _o["tier"] = "low"
FACE0["tier"] = "high"
FLANK0["tier"] = "high"
print("face tris", len(FACE0.data.polygons), len(FACE1.data.polygons), len(FLANK0.data.polygons))


# ------------------------------------------------------------------------ the macro colour map (UV2, 1024) --
def coarse(fn, nz=256, ny=256):
    zs = F.FACE_Z[0] + (np.arange(nz) + 0.5) * (F.FACE_Z[1] - F.FACE_Z[0]) / nz
    ys = F.FACE_Y[0] + (np.arange(ny) + 0.5) * (F.FACE_Y[1] - F.FACE_Y[0]) / ny
    return np.array([[fn(z, y) for z in zs] for y in ys])


def build_macro():
    hy, hz = MAC_RES[1], MAC_RES[0]
    hit = ~np.isnan(D)
    Df = np.where(hit, D, np.nanmin(D) if hit.any() else 0.0)
    # cavities: how far a texel lies behind the local crest (r ~0.35 m and ~1 m) -> cracks, joints, hollows
    # concavity (local mean minus the texel; a plain slope gives 0): narrow joints and wider hollows
    cav_s = SC.box_mean(Df, 8) - Df
    cav_l = SC.box_mean(Df, 26) - Df
    crack = np.clip((cav_s - 0.05) / 0.2, 0, 1) * 0.8 + np.clip((cav_l - 0.25) / 0.6, 0, 1) * 0.4
    crack = np.clip(crack, 0, 1)
    n_up = NRM[..., 2]
    n_dn = np.clip(-n_up, 0, 1)
    ledge = np.clip((n_up - 0.62) / 0.25, 0, 1)
    ys = F.FACE_Y[0] + (np.arange(hy) + 0.5) * MAC_DY
    Y = np.repeat(ys[:, None], hz, 1)
    up = SC.upsample
    # low-frequency fields from the shape's own noise (coarse, upsampled)
    wet = up(coarse(lambda z, y: wetness(F.face_x(z, y), y, z), 128, 128), (hy, hz))
    var = up(coarse(lambda z, y: F.fbm(z * 0.09, y * 0.09, 3.7), 128, 128), (hy, hz))
    rust = up(coarse(lambda z, y: F.fbm(z * 0.16 + 7.0, y * 0.12, 8.1), 128, 128), (hy, hz))
    lich = up(coarse(lambda z, y: F.fbm(z * 0.5, y * 0.5, 1.3), 256, 256), (hy, hz))
    stz = up(coarse(lambda z, y: F.fbm(z * 1.3, y * 0.035 + 2.0, 5.9), 384, 96), (hy, hz))
    damp = np.clip(0.35 + 0.65 * np.clip((20.0 - Y) / 16.0, 0, 1) + 0.6 * wet, 0, 1)
    mot = up(coarse(lambda z, y: F.fbm(z * 0.7, y * 0.7, 4.4), 384, 384), (hy, hz))
    M = np.full((hy, hz, 3), 0.5)
    # overall granite variation: lighter / darker patches (two scales), warm rust stains (photo 12: grey, rust-brown)
    M *= (1.0 + 0.30 * var + 0.16 * mot)[..., None]
    rw = np.clip((rust - 0.15) / 0.35, 0, 1)[..., None]
    M *= 1.0 - rw * (1.0 - np.array([1.12, 0.97, 0.80]))
    # pale lichen blotches on the dry upper rock
    lw = (np.clip((lich - 0.25) / 0.25, 0, 1) * (1 - wet) * np.clip((Y - 4.0) / 8.0, 0, 1) * 0.35)[..., None]
    M = M * (1 - lw) + np.array([0.66, 0.66, 0.62]) * lw
    # water stains: dark vertical streaks hanging from the ledges, stronger where it is wet
    sw = (np.clip((stz - 0.0) / 0.3, 0, 1) * (0.4 + 0.5 * wet) * np.clip((Y - 1.0) / 6.0, 0, 1))[..., None]
    M *= 1.0 - sw * (1.0 - np.array([0.62, 0.62, 0.66]))
    # wet: the rock behind and beside the water goes dark purple-brown (photo 05)
    ww = (wet * 0.85)[..., None]
    M *= 1.0 - ww * (1.0 - np.array([0.42, 0.36, 0.39]))
    # cracks and hollows: dark, then green where damp (moss / ferns behind the plant cards)
    cw = crack[..., None]
    M *= 1.0 - cw * 0.5
    gw = (np.clip((crack - 0.25) / 0.75, 0, 1) * (0.25 + 0.75 * damp) * 0.6)[..., None]
    M = M * (1 - gw) + np.array([0.17, 0.27, 0.06]) * gw
    # under overhangs: darker
    M *= (1.0 - 0.35 * n_dn)[..., None]
    # moss on the ledge tops (up-facing), more where damp; the wet zone stays slick and dark
    mw = (ledge * (0.3 + 0.7 * damp) * (1 - 0.6 * np.clip((wet - 0.5) / 0.4, 0, 1)) * 0.75)[..., None]
    M = M * (1 - mw) + np.array([0.20, 0.30, 0.07]) * mw
    M = np.where(hit[..., None], M, 0.5)
    SC.save_rgb(np.clip(M, 0, 1), os.path.join(TEXF, MACRO))
    for im in bpy.data.images:
        if im.filepath and os.path.basename(im.filepath) == MACRO:
            im.reload()
    return crack, ledge


CRACK_MAP, LEDGE_MAP = build_macro()
print("macro written; back-facing hits", BACK_HITS)


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
# the bank / shallows / talus rocks are scan boulders too (instanced): kind -> (scan, LOD, material, size factor)
KIT_SPEC = [("boulder3", "lo", 0.42), ("boulder1", "lo", 0.62), ("boulder3", "hi", 0.42), ("boulder1", "hi", 0.62)]
KIT, KIT_H = [], []
for _k, (_key, _lod, _f) in enumerate(KIT_SPEC):
    _me = SCANS[_key][_lod].copy()
    _me.name = f"falls_kit_{_k}"
    _me.materials.clear()
    _me.materials.append(M_BOULDER[_key])
    _bb = [[min(v.co[i] for v in _me.vertices), max(v.co[i] for v in _me.vertices)] for i in range(3)]
    _c = [(a + b) / 2 for a, b in _bb]
    for _v in _me.vertices:
        _v.co = Vector((_v.co.x - _c[0], _v.co.y - _c[1], _v.co.z - _c[2])) * _f
    _me.update()
    _ca = _me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    for _i, _v in enumerate(_me.vertices):
        _ca.data[_i].color = (0.55 * F.smooth(0.55, 0.9, _v.normal.z), 0.0, 0.0, 0.0)
    for _p_ in _me.polygons:
        _p_.use_smooth = True
    _ob = bpy.data.objects.new(_me.name, _me)
    KIT.append(_ob)
    KIT_H.append(tuple((b - a) / 2 * _f for a, b in _bb))      # Blender half extents (x, y, z-up)
for ob in KIT:
    SRC.objects.link(ob)
KIT_TRIS = {ob.name: sum(len(p.vertices) - 2 for p in ob.data.polygons) for ob in KIT}
print("kit tris", KIT_TRIS)


def kit_dims(kind, s):
    """(half x, half height, half z) of kit `kind` at game-axis scale s = (x, y-up, z)."""
    bx, by, bz = KIT_H[kind]
    return bx * s[0], bz * s[1], by * s[2]


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


def place_bank_rocks(n_bank=44, n_water=9, n_talus=9):
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
        k = rng.choice([0, 0, 0, 1, 1, 2])
        s = rng.uniform(0.45, 1.25)
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
        k = rng.choice([0, 0, 1])
        s = rng.uniform(0.6, 1.1)
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
        x = front_x(z, 0.5) + rng.uniform(1.0, 3.2)
        if in_pocket(x, z, 1.0) or F.pool_signed_dist(x, z) < -0.4:
            continue
        k = rng.choice([0, 1, 1, 2])
        s = rng.uniform(1.0, 2.0)
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
    ob.scale = (scale[0], scale[2], scale[1])          # game-axis scale (x, y-up, z) -> Blender (x, y, z-up)
    ob["cat"] = "inst"
    return ob


roots = {}
for k in range(len(KIT)):
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
    big = max(kit_dims(kind, sc_)) > 0.7 or tag == "talus"
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
while PEBBLES < 110 and tries < 40000:
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


def map_sites(m, thr, rng_, n=20000):
    """(x, z, y) points of the drawn rock front where the bake map m (UV2 raster) exceeds thr, in random order."""
    js, is_ = np.nonzero((m > thr) & ~np.isnan(D))
    idx = list(range(len(js)))
    rng_.shuffle(idx)
    for k in idx[:n]:
        j, i = int(js[k]), int(is_[k])
        z = F.FACE_Z[0] + (i + 0.5) * MAC_DZ
        y = F.FACE_Y[0] + (j + 0.5) * MAC_DY
        yield float(D[j, i]), z, y


# 1. ledges (up-facing rock in the raycast): sedge tufts, small shrubs, ferns, sprays hanging over the edge
#    (photo 12: green on every step)
LEDGE_SITES = []
for (x, z, y) in map_sites(LEDGE_MAP, 0.6, vrng):
    if abs(z - F.FZ) > 16.5 or blocked_by_water(z, y) or y > F.TOP + 2.0 or y < 0.3:
        continue
    if not far_from(LEDGE_SITES, x, z, y, 1.15):
        continue
    LEDGE_SITES.append((x, z, y, 0.0))
    if len(LEDGE_SITES) >= 135:
        break
for i, (x, z, y, dep) in enumerate(LEDGE_SITES):
    PL_ = PLH if i % 3 == 2 else PL           # a third of the ledge plants are high-tier only
    xb = x - min(dep * 0.5, 0.4)
    base = Vector(Vb(xb, z, y + 0.02))
    r = vrng.random()
    if r < 0.38:
        P.grass(PL_, base, vrng.uniform(0.45, 0.85), vrng, n=3, tint=FRESH)
        if vrng.random() < 0.5:
            P.grass(PL_, base + Vector((0.1, vrng.uniform(-0.6, 0.6), 0)), vrng.uniform(0.35, 0.6), vrng, n=2, tint=FRESH)
    elif r < 0.7:
        P.shrub(PL_, base, vrng.uniform(0.9, 1.7), vrng.uniform(0.9, 1.7), vrng, tint=FRESH)
    elif r < 0.85:
        P.fern(PL_, base, vrng.randint(6, 8), vrng.uniform(0.6, 0.95), vrng, tint=FRESH)
    else:
        P.hanging(PL_, Vector(Vb(x + 0.05, z, y + 0.05)), (1, 0, 0), vrng.uniform(0.8, 1.6), vrng, n=3, tint=FRESH)
        P.grass(PL_, base, 0.4, vrng, n=2, tint=FRESH)
# 2. vertical cracks: grass and hanging sprays growing out of the joints (damper, lower rock mostly)
CRACK_SITES = []
for (x, z, y) in map_sites(CRACK_MAP, 0.55, vrng):
    if abs(z - F.FZ) > 16.0 or blocked_by_water(z, y) or y > F.TOP + 1.0 or y < 0.4:
        continue
    if vrng.random() > 0.5 + 0.5 * F.smooth(26.0, 6.0, y):
        continue
    if not far_from(CRACK_SITES, x, z, y, 1.5) or not far_from(LEDGE_SITES, x, z, y, 0.8):
        continue
    CRACK_SITES.append((x, z, y))
    if len(CRACK_SITES) >= 75:
        break
for (x, z, y) in CRACK_SITES:          # high tier only (the low tier keeps the ledges, rim and groove-edge plants)
    if vrng.random() < 0.5:
        P.hanging(PLH, Vector(Vb(x + 0.02, z, y)), (1, 0, 0), vrng.uniform(0.7, 1.3), vrng, n=2, tint=FRESH)
    else:
        P.grass(PLH, Vector(Vb(x - 0.05, z, y)), vrng.uniform(0.35, 0.6), vrng, up=(0.5, 0, 1), n=2, tint=FRESH)
# 2b. cliff bushes: bigger leafy shrubs rooted in the joints and on the steps (photo 12: bushes all over the lower rock,
#     sprays hanging off them); high tier, a few on both tiers
BUSH_SITES = []
for (x, z, y) in map_sites(np.maximum(CRACK_MAP, LEDGE_MAP), 0.5, vrng):
    if abs(z - F.FZ) > 16.0 or blocked_by_water(z, y) or y > F.TOP - 2.0 or y < 1.0:
        continue
    if vrng.random() > 0.35 + 0.65 * F.smooth(30.0, 8.0, y):
        continue
    if any(math.hypot(b[1] - z, b[2] - y) < 2.8 for b in BUSH_SITES):
        continue
    BUSH_SITES.append((x, z, y))
    if len(BUSH_SITES) >= 42:
        break
for i, (x, z, y) in enumerate(BUSH_SITES):
    L_ = PL if i % 4 == 0 else PLH
    base = Vector(Vb(x - 0.15, z, y))
    P.shrub(L_, base, vrng.uniform(1.3, 2.3), vrng.uniform(1.2, 2.0), vrng, up=(0.45, 0, 1), tint=FRESH)
    if vrng.random() < 0.6:
        P.hanging(L_, Vector(Vb(x + 0.1, z + vrng.uniform(-0.6, 0.6), y + 0.1)), (1, 0, 0), vrng.uniform(1.2, 2.2), vrng,
                  n=3, tint=FRESH)
print("cliff bushes", len(BUSH_SITES))
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
    x = front_x(z, min(yr, F.PLATEAU_Y - 0.5))
    RIM.append((x, z, yr))
    P.shrub(PL, Vector(Vb(x - 0.35, z, yr - 0.1)), vrng.uniform(0.9, 1.6), vrng.uniform(0.9, 1.5), vrng,
            up=(0.35, 0, 1), tint=FRESH)
    if vrng.random() < 0.6:
        yh = F.TOP - vrng.uniform(0.0, 1.0)
        P.hanging(PL, Vector(Vb(front_x(z, yh) + 0.05, z, yh)), (1, 0, 0), vrng.uniform(1.2, 2.4), vrng,
                  n=3, tint=FRESH)
# 6. along both edges of the cascade groove: sprays hanging into it, small shrubs on its lips
for side in (-1, 1):
    y = F.LEDGE + 1.5
    while y < F.TOP - 0.5:
        z = F.channel_z(y) + side * vrng.uniform(3.4, 4.4)
        x = front_x(z, y)
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
while len(TREE_SPOTS) < 30 and tries < 6000:
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
# the groove (W2's film) follows face_x: (1) the backing face's own function is face_x there; (2) a raycast of each
# drawn LOD from the east hits within a few cm of face_x (mesh interpolation only); (3) in the restricted zones
# (groove core + band, plunge zone) no vertex of either LOD stands out of face_x
gd_f, gd_m, gd_in, pd, zone_out = 0.0, {0: 0.0, 1: 0.0}, {0: 0.0, 1: 0.0}, 0.0, 0.0
_bvh = {lod: BVHTree.FromPolygons([v.co.copy() for v in ob.data.vertices], [tuple(p.vertices) for p in ob.data.polygons])
        for lod, ob in ((0, FACE0), (1, FACE1))}
for j in range(0, 80):
    y = F.LEDGE + 0.6 + j * (F.TOP - F.LEDGE - 0.6) / 79
    for dz in (-1.6, -0.8, 0.0, 0.8, 1.6):
        z = F.channel_z(y) + dz
        gd_f = max(gd_f, SC.base_x(z, y, 0.4, REF) - F.face_x(z, y))
        for lod in (0, 1):
            hit = _bvh[lod].ray_cast(Vector((-90.0, -z, y)), Vector((-1, 0, 0)), 80.0)
            if hit[0] is not None:
                gd_m[lod] = max(gd_m[lod], hit[0].x - F.face_x(z, y))
                gd_in[lod] = max(gd_in[lod], F.face_x(z, y) - hit[0].x)
for j in range(0, 60):
    y = -0.2 + j * (F.LEDGE - 0.2) / 59
    for dz in [k * 0.25 - 6.0 for k in range(49)]:
        z = F.LIP["z"] + dz
        hit = _bvh[0].ray_cast(Vector((-90.0, -z, y)), Vector((-1, 0, 0)), 80.0)
        if hit[0] is not None:
            pd = max(pd, hit[0].x - F.face_x(z, y))
for ob in (FACE0, FACE1):
    for v in ob.data.vertices:
        gz, gy = -v.co.y, v.co.z
        if SC.restricted(gz, gy):
            zone_out = max(zone_out, v.co.x - F.face_x(gz, gy))
report["groove_max_dev_m"] = round(gd_f, 4)
report["groove_mesh_out_m"] = {f"lod{k}": round(v, 4) for k, v in gd_m.items()}
report["groove_mesh_in_m"] = {f"lod{k}": round(v, 4) for k, v in gd_in.items()}
report["plunge_max_out_m"] = round(pd, 4)
report["zone_max_out_m"] = round(zone_out, 4)
report["backfacing_hits_macro"] = BACK_HITS
if gd_f > 0.001:
    report["fails"].append(f"groove backing face out of face_x by {gd_f:.3f}")
if max(gd_m.values()) > 0.06:
    report["fails"].append(f"groove mesh out of face_x by {max(gd_m.values()):.3f}")
if gd_in[0] > 1.6 or gd_in[1] > 2.5:      # behind is allowed (cut inward); only flag a real hole / notch
    report["fails"].append(f"groove mesh far behind face_x by {gd_in}")
if pd > 0.03:
    report["fails"].append(f"rock out of face_x in the plunge zone by {pd:.3f}")
if zone_out > 0.001:
    report["fails"].append(f"a vertex out of face_x in the groove / plunge zones by {zone_out:.3f}")
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
report["tex"] = {"used": sorted({os.path.relpath(n.image.filepath, TEXF).replace(os.sep, "/") for m in MATS.values()
                                  for n in m.node_tree.nodes if n.type == "TEX_IMAGE" and n.image and n.image.filepath.startswith(TEXF)}),
                 "sizes": {n: list(bpy.data.images[n].size) for n in sorted({n.image.name for m in MATS.values()
                           for n in m.node_tree.nodes if n.type == "TEX_IMAGE" and n.image})}}
report["scan_pieces"] = {"placements": len(PLACEMENTS), "by_kind": _kinds,
                         "tris_lod0": {k: sum(1 for t, kp, mi in zip(PA[0].t, KEEP[0], PA[0].mi) if kp and mi == MI_OF[k]) for k in SC.KEYS},
                         "tris_lod1": {k: sum(1 for t, kp, mi in zip(PA[1].t, KEEP[1], PA[1].mi) if kp and mi == MI_OF[k]) for k in SC.KEYS},
                         "backing_tris": {"lod0": len(BASE[0][1]), "lod1": len(BASE[1][1])}}
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
