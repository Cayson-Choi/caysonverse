"""B1 waterfall, W1: the rock and ground art of the falls site (authoring scene).

  blender -b --factory-startup -P build_waterfall.py -- [--no-glb] [--quick]

Reads the LOCKED shape from falls_shape.py (face_x over FACE_Z/FACE_Y, terrain_y minus is_cliff_cell, slabs, seats,
lamps, camera wall) and builds, in GAME coordinates converted by Vb() = Blender (x, -z, y):

  falls_rock_lod0 / falls_rock_lod1   the cliff (face_x + fracture relief), UV0 planar 4 m tile, UV2 lightmap square,
                                      'Col' R moss, G wet, B water-stain streaks, A lichen          M_falls_rock
  falls_ground                        site ground west of the camera wall's pocket: gravel/turf/rock by slope (3 slots)
  inst__falls_rock_k (k = 0..5)       the rock kit: jointed blocks on the cliff, bank riprap, talus (linked duplicates)
  falls_slab_n / falls_seat_n|s       the 4 walkable flat rocks (top 0.02-0.04) and the 2 stone seats (top 0.42)
  falls_lamp_n + light__falls_lamp_n  placeholder warm lamps (baked into the night lightmap by W3)
  veg__falls_*                        leaf clumps, ferns, moss cushions, grass, overhanging branches   M_leaf_green

Nothing west of the camera wall is shared with the village: the ground east of the pocket (x > -100) belongs to
village.glb. Writes art/village/work/falls_w1.blend (+ falls_w1.glb unless --no-glb) and falls_w1_report.json.
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
QUICK = "--quick" in argv          # coarse terrain cache only (iteration)

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


def link(ob, coll=None, cat=None):
    (coll or COLL).objects.link(ob)
    if cat:
        ob["cat"] = cat
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


def mixsep(nt, color):
    """Luminance of a colour socket (RGB to BW)."""
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


def stone_material(name, export, tex, nor, tile_note, tint=(1, 1, 1, 1), moss_col="#34471F", base_rough=0.82, strength=1.1):
    """Stone from a colour + normal texture and the 'Col' masks: R moss, G wet, B streaks, A lichen."""
    m = bpy.data.materials.new(name)
    m["export"] = export
    m.use_nodes = True
    nt = nodes_of(m)
    out = N(nt, "ShaderNodeOutputMaterial", 1500, 0)
    bs = N(nt, "ShaderNodeBsdfPrincipled", 1200, 0)
    uv = N(nt, "ShaderNodeUVMap", -900, 0)
    uv.uv_map = "UVMap"
    t = N(nt, "ShaderNodeTexImage", -600, 200)
    t.image = img(tex)
    t.interpolation = "Cubic"
    nt.links.new(uv.outputs[0], t.inputs["Vector"])
    tn = N(nt, "ShaderNodeTexImage", -600, -200)
    tn.image = img(nor, "Non-Color")
    nt.links.new(uv.outputs[0], tn.inputs["Vector"])
    nm = N(nt, "ShaderNodeNormalMap", -300, -200)
    nm.inputs["Strength"].default_value = strength
    nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs[0], bs.inputs["Normal"])
    vc = N(nt, "ShaderNodeVertexColor", -900, -400)
    vc.layer_name = "Col"
    sp = N(nt, "ShaderNodeSeparateColor", -650, -400)
    nt.links.new(vc.outputs["Color"], sp.inputs["Color"])
    R, G, B, A = sp.outputs[0], sp.outputs[1], sp.outputs[2], vc.outputs["Alpha"]
    col = mix(nt, t.outputs["Color"], tint, 1.0, "MULTIPLY")
    # water-stain streaks: dark, slightly cool
    col = mix(nt, col, (0.03, 0.034, 0.04, 1), mathn(nt, "MULTIPLY", B, 1.0))
    # lichen: pale yellow-grey patches, not where it is wet
    lich = mathn(nt, "MULTIPLY", A, mathn(nt, "SUBTRACT", 1.0, G))
    col = mix(nt, col, (0.50, 0.49, 0.33, 1), mathn(nt, "MULTIPLY", lich, 0.55))
    # moss: dark green, keeps the stone's relief by multiplying the stone luminance in
    lum = mix(nt, (0.20, 0.30, 0.10, 1), t.outputs["Color"], 0.35, "MULTIPLY")
    mossc = mix(nt, rgb(moss_col), lum, 0.35, "MULTIPLY")
    tl = mathn(nt, "ADD", mathn(nt, "MULTIPLY", mixsep(nt, t.outputs["Color"]), 1.0), 0.0)
    mfac = mathn(nt, "MULTIPLY", R, mapr(nt, tl, 0.18, 0.62, 1.25, 0.35))
    col = mix(nt, col, mossc, mathn(nt, "MULTIPLY", mfac, 0.95))
    # wet: darker, glossier
    col = mix(nt, col, (0.26, 0.27, 0.28, 1), mathn(nt, "MULTIPLY", G, 0.7), "MULTIPLY")
    nt.links.new(col, bs.inputs["Base Color"])
    rough = mapr(nt, G, 0.0, 1.0, base_rough, 0.28)
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


def leaf_material():
    m = bpy.data.materials.new("M_leaf_green")
    m["export"] = "M_leaf_green"
    m.use_nodes = True
    nt = nodes_of(m)
    out = N(nt, "ShaderNodeOutputMaterial", 900, 0)
    bs = N(nt, "ShaderNodeBsdfPrincipled", 500, 0)
    uv = N(nt, "ShaderNodeUVMap", -600, 0)
    uv.uv_map = "UVMap"
    t = N(nt, "ShaderNodeTexImage", -300, 100)
    t.image = bpy.data.images.load(os.path.join(WORK, "tex", "T_leaf_green.png"), check_existing=True)
    nt.links.new(uv.outputs[0], t.inputs["Vector"])
    vc = N(nt, "ShaderNodeVertexColor", -300, -150)
    vc.layer_name = "Col"
    col = mix(nt, t.outputs["Color"], vc.outputs["Color"], 1.0, "MULTIPLY")
    nt.links.new(col, bs.inputs["Base Color"])
    bs.inputs["Roughness"].default_value = 0.7
    bs.inputs["Specular IOR Level"].default_value = 0.2
    nt.links.new(bs.outputs[0], out.inputs["Surface"])
    m.use_backface_culling = False
    MATS["M_leaf_green"] = m
    return m


M_ROCK = stone_material("M_falls_rock", "M_falls_rock", "T_falls_rock.png", "T_falls_rock_n.png", "4 m", tint=(1.0, 1.0, 1.0, 1))
M_SLAB = stone_material("M_falls_slab", "M_falls_slab", "T_falls_slab.png", "T_falls_slab_n.png", "3 m", moss_col="#3A5224", base_rough=0.78)
M_GROUND = tinted_material("M_falls_ground", "M_falls_ground", "T_falls_gravel.png", "T_falls_gravel_n.png", 1.0, 0.88)
M_TURF = tinted_material("M_falls_turf", "M_falls_turf", "T_falls_turf.png", "T_falls_turf_n.png", 0.7, 0.95)
M_LEAF = leaf_material()
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
MAX_STEP_Z = 0.8


def face_axes(lod):
    if lod == 0:
        zs = list(F.FACE_Z[0] + (-90.0 - F.FACE_Z[0]) * k / 10 for k in range(10))
        zs += list(-90.0 + 24.0 * k / 68 for k in range(69))
        zs += list(-66.0 + (F.FACE_Z[1] + 66.0) * k / 10 for k in range(11))
        ys = [F.FACE_Y[0] + k * (0.0 - F.FACE_Y[0]) / 4 for k in range(4)]
        ys += [k * 0.3 for k in range(0, 34)]                         # 0 .. 9.9
        ys += [10.0 + k * 0.45 for k in range(0, 27)]                 # 10 .. 21.7
        ys += [22.0 + k * 0.9 for k in range(0, 22)]                  # 22 .. 40.9
        ys += [F.FACE_Y[1]]
    else:
        zs = [F.FACE_Z[0] + (F.FACE_Z[1] - F.FACE_Z[0]) * k / 44 for k in range(45)]
        ys = [F.FACE_Y[0], -1.0, 0.0] + [k * 0.85 for k in range(1, 22)] + [19.0 + k * 1.4 for k in range(0, 16)] + [F.FACE_Y[1]]
        ys = sorted(set(round(y, 3) for y in ys))
    return zs, ys


SEAM_Z = -62.0       # south of this z the ground blends to the village seam (terrain_y), so the terrain mesh covers it
# 1-m cell map of the steep ground (is_cliff_cell, contract): terrain skips these, the face covers them
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
    w = max(math.exp(-(d_ch / 3.0) ** 2), math.exp(-(d_pl / 4.0) ** 2) * (1.0 if y > -1 else 0.0))
    # spray zone: low rock around the impact stays wet to about 8 m out
    near = math.hypot(x - F.IMPACT["x"], z - F.IMPACT["z"]) - 5.0
    w = max(w, math.exp(-max(0.0, near) / 3.5) * F.smooth(7.0, 1.5, y))
    # the splash line: water level +- 1 m
    w = max(w, F.smooth(1.4, 0.0, y - F.WATER_Y) * 0.9)
    return min(1.0, w)


def build_face(lod):
    zs, ys = face_axes(lod)
    nz, ny = len(zs), len(ys)
    X = [[P.face_x_detailed(z, y) for z in zs] for y in ys]
    verts, keepv = [], []
    for j, y in enumerate(ys):
        for i, z in enumerate(zs):
            x = X[j][i]
            verts.append((x, z, y))
            keepv.append(y > F.floor_y(x, z) - 0.35)
    # quads: kept where over the floor and in a cliff cell (one cell of overlap, pushed 5 cm into the rock)
    faces, push = [], set()
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
                continue                       # the last metres before the south edge follow the seam heights: terrain mesh
            if cliff_at(xm, zm) and zm <= SEAM_Z:
                faces += P._tri_split(verts, *q)
            elif cliff_at(xm, zm, 1) or ym > F.TOP + 1.0 or zm > SEAM_Z:
                for k in q:
                    push.add(k)
                faces += P._tri_split(verts, *q)
    # cavity + normals on the grid
    cols, uv0, uv2 = [], [], []
    wall_ok = True
    for j, y in enumerate(ys):
        for i, z in enumerate(zs):
            k = j * nz + i
            x = X[j][i]
            xl, xr = X[j][max(i - 1, 0)], X[j][min(i + 1, nz - 1)]
            xd, xu = X[max(j - 1, 0)][i], X[min(j + 1, ny - 1)][i]
            dz = zs[min(i + 1, nz - 1)] - zs[max(i - 1, 0)]
            dy = ys[min(j + 1, ny - 1)] - ys[max(j - 1, 0)]
            Xz, Xy = (xr - xl) / dz, (xu - xd) / dy
            nlen = math.sqrt(1 + Xz * Xz + Xy * Xy)
            n_up = -Xy / nlen
            cav = 0.5 * (xl + xr) - x + 0.5 * (xd + xu) - x         # > 0: a recess
            wet = wetness(x, y, z)
            nzn = F.fbm(z * 0.55, y * 0.55, 2.2)
            moss = F.smooth(0.25, 0.6, n_up) * (0.45 + 0.6 * nzn) + F.smooth(0.05, 0.4, cav) * (0.45 + 0.5 * nzn)
            moss += 0.45 * wet * F.smooth(8.0, 0.0, y) * (0.4 + 0.6 * max(0.0, nzn))
            moss += 0.18 * F.smooth(0.1, 0.5, F.fbm(z * 0.22, y * 0.2, 7.7)) * F.smooth(14.0, 3.0, y)
            moss *= 1.0 - 0.75 * F.smooth(0.55, 0.9, wet) * (1.0 if y > 2 else 0.0)
            # water-stain streaks: long vertical dark runs under ledges, strongest in wet zones and the upper rock
            sk = F.fbm(z * 1.1, y * 0.035 + 3.3, 1.7)
            sk2 = F.noise3(z * 0.8, y * 0.09, 5.2)
            streak = F.smooth(-0.02, 0.22, sk) * (0.55 + 0.45 * F.smooth(-0.2, 0.35, sk2)) + 0.40 * wet + 0.30 * F.smooth(0.1, 0.45, F.fbm(z * 0.12, y * 0.1, 3.3))
            streak *= 1.0 - 0.35 * F.smooth(0.2, 0.7, n_up)
            lich = F.smooth(0.18, 0.5, F.fbm(z * 0.7 + 4, y * 0.7, 9.1)) * (1.0 - wet) * 0.8
            if lod == 1:
                lich *= 0.8
            cols.append((min(1.0, moss), wet, min(1.0, streak), lich))
            uv0.append((z * 0.25 + 0.31, y * 0.25))
            uv2.append(((z - F.FACE_Z[0]) / (F.FACE_Z[1] - F.FACE_Z[0]), (y - F.FACE_Y[0]) / (F.FACE_Y[1] - F.FACE_Y[0])))
    vb = []
    for k, (x, z, y) in enumerate(verts):
        vb.append(Vb(x - (0.05 if k in push else 0.0), z, y))

    def flank(tri):
        zc = sum(verts[k][1] for k in tri) / 3
        yc = sum(verts[k][2] for k in tri) / 3
        return abs(zc - F.FZ) > 15.2 + 1.0 * F.noise3(zc * 0.12, yc * 0.06, 2.2)

    def sub(name, tris, mat, colfn, sharp):
        used = sorted({k for t in tris for k in t})
        remap = {k: i for i, k in enumerate(used)}
        ob = P.mesh_from(name, [vb[k] for k in used], [tuple(remap[k] for k in t) for t in tris], mat,
                         uv=[uv0[k] for k in used], uv2=[uv2[k] for k in used], colors=[colfn(k) for k in used])
        P.orient(ob.data, (1, 0, 0))
        P.sharpen(ob.data, sharp)
        return ob

    def turf_col(k):
        x, z, y = verts[k]
        n = F.fbm(z * 0.4, y * 0.4, 5.5)
        v_ = 0.8 + 0.5 * n
        return (v_ * 0.95, v_ * 1.02, v_ * 0.82, 1.0)
    rock_t = [t for t in faces if not flank(t)]
    turf_t = [t for t in faces if flank(t)]
    ob = sub(f"falls_rock_lod{lod}", rock_t, M_ROCK, lambda k: cols[k], 62)
    link(ob, cat="rock")
    fk = sub(f"falls_flank_lod{lod}", turf_t, M_TURF, turf_col, 70)
    link(fk, cat="ground")
    return ob, fk


print("building cliff...")
FACE0, FLANK0 = build_face(0)
FACE1, FLANK1 = build_face(1)
for _o in (FACE1, FLANK1):
    _o.hide_render = True
    _o.hide_viewport = True
print("face tris", len(FACE0.data.polygons), len(FACE1.data.polygons), len(FLANK0.data.polygons))

# =============================================================================================== terrain ==


def tensor_axes():
    xs = [S["minX"] + 2.0 * k for k in range(0, 8)]                       # -140 .. -126 at 2 m
    xs += [-126.0 + 0.5 * k for k in range(0, 53)]                         # -126 .. -100 at 0.5 m
    zs = [S["minZ"] + 1.0 * k for k in range(0, 5)]                        # -104 .. -100 at 1 m
    zs += [-100.0 + 0.5 * k for k in range(0, 85)]                         # -100 .. -58 at 0.5 m
    return xs, zs


def ground_class(x, z):
    """(gravel weight, turf weight) at a ground point: gravel round the water, the outlet and the rest area."""
    sd = F.pool_signed_dist(x, z)
    od, _ = F.outlet_dist(x, z)
    g = max(F.smooth(4.8, 1.0, sd), F.smooth(3.4, 1.0, od - F.OUTLET["width"] / 2))
    pb = F.POCKET
    inpk = F._box_dist(x, z, pb)
    g = max(g, F.smooth(2.0, 0.0, inpk) * F.smooth(-98.2, -102.5, -x) * 0.0 + F.smooth(2.0, 0.0, inpk) * 0.85 * F.smooth(-99.6, -103.0, x))
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
    # per-face class: rock where steep (the flank), gravel near water / rest area, turf elsewhere
    ob = bpy.data.objects.new("falls_ground", me)
    me.materials.append(M_GROUND)
    me.materials.append(M_TURF)
    me.materials.append(M_ROCK)
    me.update()
    P.orient(me, (0, 0, 1))
    mi = []
    for p in me.polygons:
        c = p.center
        gx, gz = c.x, -c.y
        n = p.normal
        g = ground_class(gx, gz)
        if n.z < 0.45:
            mi.append(2)
        elif g > 0.5:
            mi.append(0)
        else:
            mi.append(1)
    me.polygons.foreach_set("material_index", mi)
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    # UVs per loop by face class / axis, colours per vertex
    uv0 = me.uv_layers.new(name="UVMap")
    uv2 = me.uv_layers.new(name="UV2")
    for p in me.polygons:
        mid = p.material_index
        n = p.normal
        ax = max(range(3), key=lambda k: abs(n[k]))
        tile = {0: 2.0, 1: 3.0, 2: 4.0}[mid]
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
        wet = F.smooth(1.6, 0.0, sd - 0.0) * 0.85
        nzv = F.fbm(gx * 0.5, gz * 0.5, 4.4)
        cs = cls_of_vertex.get(i, {1})
        if 2 in cs:                                     # rock masks: R moss, G wet, B streak, A lichen
            moss = F.smooth(-0.1, 0.5, F.fbm(gx * 0.3, gz * 0.3 + gy * 0.2, 7.7)) * 0.7
            cols.data[i].color = (min(1.0, moss + wet * 0.4), wet, 0.0, max(0.0, nzv) * 0.7)
        elif 0 in cs:                                   # gravel tint: darker + greener when wet, warm variation
            v_ = 0.78 + 0.28 * nzv
            k = 1.0 - 0.45 * wet
            cols.data[i].color = (v_ * k, v_ * k * 1.01, v_ * k * 0.96, 1.0)
        else:                                           # turf tint
            v_ = 0.8 + 0.4 * nzv
            sh = 1.0 - 0.3 * F.smooth(6.0, 0.0, abs(gz - F.FZ) - 12.0)
            cols.data[i].color = (v_ * 0.95, v_ * 1.02, v_ * 0.82, 1.0)
    link(ob, cat="ground")
    return ob


print("building terrain...")
GROUND = build_terrain()
print("ground tris", len(GROUND.data.polygons) * 2)

# ============================================================================================= rock kit ==
KIT = [P.block_mesh(k, 100 + k, M_ROCK) for k in range(6)]
for ob in KIT:
    SRC.objects.link(ob)
KIT_TRIS = {ob.name: sum(len(p.vertices) - 2 for p in ob.data.polygons) for ob in KIT}
print("kit tris", KIT_TRIS)

INST = []        # (kind, loc_game(x,z,y), yaw, tilt, scale(sx,sy,sz), tag)


def kit_dims(kind, s):
    hx, hy, hz = P.KIT[kind]["h"]
    return hx * s[0], hy * s[1], hz * s[2]


def blocked_by_water(z, y):
    if y > F.LEDGE - 1.0:
        return abs(z - F.channel_z(y)) < F.CHANNEL_HALF + 1.8
    return abs(z - F.LIP["z"]) < 7.2 and y < F.LEDGE + 1.5


def shelves(z, y0=0.8, y1=34.0, step=0.15, depth=0.28):
    """Heights at z where the face steps back going up (a ledge to rest a block on)."""
    out = []
    y = y0
    prev = P.face_x_detailed(z, y)
    while y < y1:
        a = P.face_x_detailed(z, y - 0.05)
        b = P.face_x_detailed(z, y + 0.7)
        if b < a - depth:
            out.append((y, a - b))
        y += step
    return out


def wall_clear(kind, loc, yaw, tilt, scale):
    ob = KIT[kind]
    for p in P.block_world_points(ob, Vector(Vb(*loc)), yaw, tilt, scale):
        gx, gz = p.x, -p.y
        if gx > F.camera_wall_x(gz) - 0.4:
            return False
    return True


def place_cliff_blocks(n_shelf=14, n_knuckle=8):
    placed = []
    kinds_w = [(0, 0.34), (1, 0.22), (2, 0.06), (3, 0.28), (5, 0.10)]

    def pick():
        r = rng.random()
        acc = 0
        for k, w in kinds_w:
            acc += w
            if r <= acc:
                return k
        return 2
    tries = 0
    while len([p for p in placed if p[5] == "ledge"]) < n_shelf and tries < 900:
        tries += 1
        z = F.FZ + rng.uniform(-11.5, 11.5)
        sh = shelves(z)
        if not sh:
            continue
        y, depth = rng.choice(sh)
        if blocked_by_water(z, y):
            continue
        kind = pick()
        s = rng.uniform(1.25, 2.1)
        sc_ = (s * rng.uniform(0.9, 1.15), s * rng.uniform(0.85, 1.15), s * rng.uniform(0.9, 1.2))
        hx, hy, hz = kit_dims(kind, sc_)
        if abs(z - F.FZ) > 9 and hz > 1.5:
            continue
        prot = rng.uniform(0.2, 0.6)
        yc = y + hy * 0.82
        xf = P.face_x_detailed(z, y + 0.1) + prot
        loc = (xf - hx, z, yc)
        yaw = rng.uniform(-0.3, 0.3)
        tilt = rng.uniform(-0.1, 0.12)
        if any(math.hypot(p[1][1] - z, p[1][2] - yc) < (hz + p[7]) * 0.9 for p in placed):
            continue
        if not wall_clear(kind, loc, yaw, tilt, sc_):
            continue
        placed.append((kind, loc, yaw, tilt, sc_, "ledge", None, hz))
    tries = 0
    while len([p for p in placed if p[5] == "knuckle"]) < n_knuckle and tries < 900:
        tries += 1
        z = F.FZ + rng.uniform(-12.5, 12.5)
        y = rng.uniform(1.5, 36.0)
        if blocked_by_water(z, y) or y > F.TOP - 1.0 and abs(z - F.FZ) > 9:
            continue
        kind = rng.choice([1, 0, 0, 3, 3])
        s = rng.uniform(1.1, 1.8)
        sc_ = (s, s * rng.uniform(0.85, 1.2), s * rng.uniform(0.85, 1.2))
        hx, hy, hz = kit_dims(kind, sc_)
        prot = rng.uniform(0.12, 0.4)
        xf = P.face_x_detailed(z, y) + prot
        loc = (xf - hx, z, y)
        yaw = rng.uniform(-0.45, 0.45)
        tilt = rng.uniform(-0.2, 0.2)
        if any(math.hypot(p[1][1] - z, p[1][2] - y) < (hz + p[7]) * 0.85 for p in placed):
            continue
        if not wall_clear(kind, loc, yaw, tilt, sc_):
            continue
        placed.append((kind, loc, yaw, tilt, sc_, "knuckle", None, hz))
    return placed


def place_flank_rocks(n=24):
    """Boulders and outcrops poking out of the wooded slopes beside the bare rock (they hide the rock/turf seam)."""
    out = []
    tries = 0
    while len(out) < n and tries < 800:
        tries += 1
        side = rng.choice([-1, 1])
        z = F.FZ + side * rng.choice([rng.uniform(13.0, 17.5), rng.uniform(14.0, 16.5), rng.uniform(11.5, 19.0)])
        y = rng.uniform(0.8, 30.0)
        x = P.face_x_detailed(z, y)
        kind = rng.choice([4, 2, 1, 3, 0, 4])
        s = rng.uniform(0.9, 1.6)
        sc_ = (s * rng.uniform(0.9, 1.2), s * rng.uniform(0.8, 1.1), s * rng.uniform(0.9, 1.2))
        hx, hy, hz = kit_dims(kind, sc_)
        loc = (x - hx * 0.55, z, y + hy * 0.05)
        yaw = rng.uniform(-0.6, 0.6)
        tilt = rng.uniform(-0.1, 0.25)
        if any(math.hypot(p_[1][1] - z, p_[1][2] - y) < (hz + p_[7]) * 0.9 for p_ in out):
            continue
        if not wall_clear(kind, loc, yaw, tilt, sc_):
            continue
        out.append((kind, loc, yaw, tilt, sc_, "flank", None, hz))
    return out


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


def place_bank_rocks(n_bank=24, n_water=8, n_talus=9):
    out = []
    # shore boulders on the north, west and south sides of the pool (the east shore is the rest area: slabs, gravel only)
    tries = 0
    while len(out) < n_bank and tries < 3000:
        tries += 1
        a = rng.uniform(0, 2 * math.pi)
        r_edge = F._pool_radius_dir(F.POOL_CX + math.cos(a), F.POOL_CZ + math.sin(a))
        sd = rng.uniform(-0.6, 2.4)
        # point at signed distance sd from the waterline along the ellipse normal (approx via radial scaling)
        x = F.POOL_CX + (F.POOL_RX * math.cos(a)) * 1.0
        z = F.POOL_CZ + (F.POOL_RZ * math.sin(a)) * 1.0
        nx_, nz_ = math.cos(a) / F.POOL_RX, math.sin(a) / F.POOL_RZ
        nl = math.hypot(nx_, nz_)
        x += nx_ / nl * sd
        z += nz_ / nl * sd
        if in_pocket(x, z, 0.8) or not F.in_box(x, z, S, -1.0):
            continue
        od, _ = F.outlet_dist(x, z)
        if od < F.OUTLET["width"] / 2 + 1.0:
            continue
        if abs(z - F.LIP["z"]) < 3.6 and x > F.LIP["x"] - 1:      # the plunge's footing: foam, not stones
            continue
        if cliff_at(x, z, 1) and sd > 1.0:
            continue
        k = rng.choice([4, 4, 4, 2, 0, 5])
        s = rng.uniform(0.38, 0.95)
        sc_ = (s * rng.uniform(0.85, 1.2), s * rng.uniform(0.7, 1.1), s * rng.uniform(0.85, 1.2))
        hx, hy, hz = kit_dims(k, sc_)
        if any(math.hypot(o[1][0] - x, o[1][2] - z) < (max(hx, hz) + max(kit_dims(o[0], o[4])[0], kit_dims(o[0], o[4])[2])) * 0.7 for o in out):
            continue
        gy = F.floor_y(x, z)
        yc = gy + hy * 0.55
        out.append((k, (x, yc, z), rng.uniform(0, 6.28), rng.uniform(-0.15, 0.15), sc_, "bank", sd, 0))
    # in the shallows: rocks just breaking the surface
    tries, cnt = 0, 0
    while cnt < n_water and tries < 2000:
        tries += 1
        a = rng.uniform(0, 2 * math.pi)
        f = rng.uniform(0.35, 0.92)
        x = F.POOL_CX + F.POOL_RX * f * math.cos(a)
        z = F.POOL_CZ + F.POOL_RZ * f * math.sin(a)
        if math.hypot(x - F.IMPACT["x"], z - F.IMPACT["z"]) < 5.2 or in_pocket(x, z, 0.5):
            continue
        k = rng.choice([4, 4, 2])
        s = rng.uniform(0.32, 0.6)
        sc_ = (s * 1.1, s * 0.9, s * 1.1)
        hx, hy, hz = kit_dims(k, sc_)
        bed = F.pool_bed_y(x, z)
        top = F.WATER_Y + rng.choice([0.28, 0.18, -0.12])
        yc = top - hy * 0.85
        if any(math.hypot(o[1][0] - x, o[1][2] - z) < 1.8 for o in out):
            continue
        out.append((k, (x, yc, z), rng.uniform(0, 6.28), rng.uniform(-0.2, 0.2), sc_, "shallow", 0, 0))
        cnt += 1
    # talus: blocks fallen at the cliff foot, mostly on the north and south sides of the plunge
    tries, cnt = 0, 0
    while cnt < n_talus and tries < 1500:
        tries += 1
        z = F.FZ + rng.choice([-1, 1]) * rng.uniform(6.5, 12.5)
        x = P.face_x_detailed(z, 0.5) + rng.uniform(0.0, 2.6)
        if in_pocket(x, z, 1.0) or F.pool_signed_dist(x, z) < -0.2:
            continue
        k = rng.choice([2, 3, 1, 0])
        s = rng.uniform(0.55, 1.0)
        sc_ = (s, s * rng.uniform(0.7, 1.0), s * rng.uniform(0.8, 1.1))
        hx, hy, hz = kit_dims(k, sc_)
        if any(math.hypot(o[1][0] - x, o[1][2] - z) < 2.0 for o in out):
            continue
        gy = F.floor_y(x, z)
        out.append((k, (x, gy + hy * 0.5, z), rng.uniform(0, 6.28), rng.uniform(-0.25, 0.25), sc_, "talus", 0, 0))
        cnt += 1
    return out


CLIFF_BLOCKS = place_cliff_blocks()
CLIFF_BLOCKS += place_flank_rocks()
BANK_ROCKS = place_bank_rocks()


def new_inst(kind, x, z, y, yaw, tilt, scale, tag, idx):
    ob = bpy.data.objects.new(f"falls_rock_{kind}_{tag}_{idx}", KIT[kind].data)
    ob.location = Vb(x, z, y)
    ob.rotation_euler = (0.0, tilt, yaw)
    ob.scale = scale
    ob["cat"] = "inst"
    return ob


roots = {}
for k in range(6):
    r = bpy.data.objects.new(f"inst__falls_rock_{k}", None)
    r.empty_display_size = 1.0
    r["cat"] = "inst_root"
    link(r)
    roots[k] = r
count = 0
for (kind, loc, yaw, tilt, sc_, tag, _a, _b) in CLIFF_BLOCKS:
    ob = new_inst(kind, loc[0], loc[1], loc[2], yaw, tilt, sc_, tag, count)
    ob.parent = roots[kind]
    link(ob)
    count += 1
for (kind, loc, yaw, tilt, sc_, tag, _a, _b) in BANK_ROCKS:
    ob = new_inst(kind, loc[0], loc[2], loc[1], yaw, tilt, sc_, tag, count)
    ob.parent = roots[kind]
    link(ob)
    count += 1
INST_COUNT = count
INST_TRIS = sum(KIT_TRIS[f'falls_kit_{k}'] for (k, *_r) in CLIFF_BLOCKS + BANK_ROCKS)
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
for k, lp in enumerate(F.LAMPS):
    bm = bmesh.new()
    gy = 0.0
    # stone post (octagonal, slightly tapered) + glass lantern + cap
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=8, radius1=0.17, radius2=0.12, depth=0.38,
                          matrix=__import__("mathutils").Matrix.Translation((0, 0, 0.19)))
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
                          matrix=__import__("mathutils").Matrix.Translation((0, 0, 0.66)))
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

# pebbles: a few small rounded stones on the gravel round the slabs and the shore (shared mesh, 80 triangles)
bm = bmesh.new()
bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
for v in bm.verts:
    n = v.co.normalized()
    v.co = Vector((n.x * 1.25, n.y * 0.95, max(n.z, -0.3) * 0.62)) * (1 + 0.12 * F.noise3(n.x * 3, n.y * 3, n.z * 3))
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
while PEBBLES < 36 and tries < 4000:
    tries += 1
    x = rng.uniform(S["minX"] + 15, -99.5)
    z = rng.uniform(-92.0, -66.0)
    sd = F.pool_signed_dist(x, z)
    if sd < 0.5 or sd > 6.0 or on_slab_or_seat(x, z, 0.3):
        continue
    if cliff_at(x, z, 1) or F.outlet_dist(x, z)[0] < F.OUTLET["width"] / 2 + 0.3:
        continue
    gy = F.floor_y(x, z) if x < -105 else 0.0
    s = rng.uniform(0.07, 0.17)
    ob = bpy.data.objects.new(f"pebble_{PEBBLES}", pe)
    ob.location = Vb(x, z, gy + 0.01)
    ob.rotation_euler = (rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), rng.uniform(0, 6.28))
    ob.scale = (s, s, s)
    ob.parent = pebble_root
    ob["cat"] = "inst"
    link(ob)
    PEBBLES += 1
PEBBLE_TRIS = PEBBLES * len(pe.polygons)

# ================================================================================================== plants ==
VEG = {}


def veg(name):
    if name not in VEG:
        VEG[name] = P.Leaves()
    return VEG[name]


def ground_at(x, z):
    return F.terrain_y(x, z)


vrng = random.Random(77)
# 1. bushes and ferns on the cliff's benches and ledges (cracks and tiers; photo 12 / 09)
bench_sites = []
for _ in range(900):
    z = F.FZ + vrng.uniform(-13.0, 13.0)
    sh = shelves(z, 1.2, 36.0, 0.2, 0.45)
    if not sh:
        continue
    y, dep = vrng.choice(sh)
    if blocked_by_water(z, y) or abs(z - F.LIP["z"]) < 7.2 and y < F.LEDGE + 1.5:
        continue
    x = P.face_x_detailed(z, y + 0.12) - 0.1 - vrng.uniform(0.0, 0.25)
    if any(math.hypot(b[1] - z, b[2] - y) < 2.4 for b in bench_sites):
        continue
    bench_sites.append((x, z, y + 0.05, dep))
    if len(bench_sites) >= 9:
        break
nb = 0
for (x, z, y, dep) in bench_sites:
    if nb % 4 == 3:
        P.fern(veg("fern"), Vb(x, z, y), 7, vrng.uniform(0.7, 1.1), vrng)
    else:
        P.leaf_clump(veg("bush"), Vb(x, z, y), vrng.uniform(0.8, 1.3), vrng.uniform(0.9, 1.5), 42, vrng)
    nb += 1
# 2. the foot of the cliff and the banks: ferns, bush clumps, moss on boulders, grass tufts
bank_spots = []
tries = 0
while len(bank_spots) < 6 and tries < 2500:
    tries += 1
    a = vrng.uniform(0, 2 * math.pi)
    nx_, nz_ = math.cos(a) / F.POOL_RX, math.sin(a) / F.POOL_RZ
    nl = math.hypot(nx_, nz_)
    x = F.POOL_CX + F.POOL_RX * math.cos(a) + nx_ / nl * vrng.uniform(1.2, 4.5)
    z = F.POOL_CZ + F.POOL_RZ * math.sin(a) + nz_ / nl * vrng.uniform(1.2, 4.5)
    if in_pocket(x, z, 1.2) or not F.in_box(x, z, S, -1.5) or cliff_at(x, z, 1):
        continue
    if F.outlet_dist(x, z)[0] < F.OUTLET["width"] / 2 + 1.8:
        continue
    if abs(z - F.LIP["z"]) < 4.0 and x > F.LIP["x"] - 2:
        continue
    if any(math.hypot(b[0] - x, b[1] - z) < 3.0 for b in bank_spots):
        continue
    bank_spots.append((x, z))
for i, (x, z) in enumerate(bank_spots):
    y = ground_at(x, z)
    if i % 3 == 0 and i < 4:
        P.fern(veg("fern"), Vb(x, z, y), 7, vrng.uniform(0.7, 1.15), vrng)
    else:
        P.leaf_clump(veg("bush"), Vb(x, z, y), vrng.uniform(0.8, 1.3), vrng.uniform(0.8, 1.4), 40, vrng)
    P.Leaves.cushion(veg("moss"), Vb(x + 0.5, z + 0.3, y), vrng.uniform(0.25, 0.4), vrng)
# moss cushions on the shore boulders' tops
for (kind, loc, yaw, tilt, sc_, tag, _a, _b) in BANK_ROCKS:
    if tag in ("bank", "talus") and vrng.random() < 0.5:
        hx, hy, hz = kit_dims(kind, sc_)
        P.Leaves.cushion(veg("moss"), Vb(loc[0], loc[2], loc[1] + hy * 0.85), vrng.uniform(0.18, 0.32), vrng)
# grass tufts on the turf at the edge of the gravel, and along the flank
gt = 0
tries = 0
while gt < 38 and tries < 4000:
    tries += 1
    x = vrng.uniform(S["minX"] + 14, -99.6)
    z = vrng.uniform(-100.0, -58.5)
    if cliff_at(x, z, 1) or in_pocket(x, z, 0.0) or F.pool_signed_dist(x, z) < 1.2:
        continue
    if F.outlet_dist(x, z)[0] < F.OUTLET["width"] / 2 + 0.6 or on_slab_or_seat(x, z, 0.5):
        continue
    g = ground_class(x, z)
    if not (0.15 < g < 0.75 or (g <= 0.15 and vrng.random() < 0.35)):
        continue
    P.grass_tuft(veg("grass"), Vb(x, z, ground_at(x, z)), vrng.randint(5, 7), vrng.uniform(0.35, 0.7), vrng)
    gt += 1
# 3. hardwood branches hanging over the rim, away from the groove (photos 12, 05)
BR = []
for zc in (F.FZ - 8.5, F.FZ + 7.0, F.FZ - 4.2):
    y = F.TOP + 4.0
    xr = P.face_x_detailed(zc, y - 1.0)
    base = Vb(xr - 2.2, zc, F.plateau_y(xr - 2.2, zc) - 0.2)
    P.branch(veg("branch"), base, (1.0, vrng.uniform(-0.25, 0.25), 0.15), vrng.uniform(3.4, 4.6), vrng, leaf_n=26)
    BR.append(zc)

VEG_OBS = []
for name, lv in VEG.items():
    ob = lv.mesh(f"veg__falls_{name}", M_LEAF)
    link(ob, cat="leaf")
    VEG_OBS.append(ob)
VEG_TRIS = sum(lv.tris() for lv in VEG.values())
print("veg tris", VEG_TRIS, {k: v.tris() for k, v in VEG.items()})

# ============================================================================================ validation ==
report = {"fails": []}


def tri_count(obs):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in obs if o.type == "MESH")


worst_wall = 1e9
for v in FACE0.data.vertices:
    worst_wall = min(worst_wall, F.camera_wall_x(-v.co.y) - v.co.x)
for (kind, loc, yaw, tilt, sc_, tag, _a, _b) in CLIFF_BLOCKS:
    for p in P.block_world_points(KIT[kind], Vector(Vb(*loc)), yaw, tilt, sc_):
        worst_wall = min(worst_wall, F.camera_wall_x(-p.y) - p.x)
report["worst_wall_gap_m"] = round(worst_wall, 3)
if worst_wall < 0.3:
    report["fails"].append(f"rock closer than 0.3 m to the camera wall ({worst_wall:.2f})")
# slabs and seats: flat tops at the contract heights
for s, ob in zip(F.SLABS, SLABS):
    zmax = max(v.co.z for v in ob.data.vertices)
    report[f"{s['id']}_top"] = round(zmax, 4)
    if not (0.0 <= zmax <= 0.06):
        report["fails"].append(f"{s['id']} top {zmax}")
for s, ob in zip(F.SEATS, SEATS):
    zmax = max(v.co.z for v in ob.data.vertices)
    report[f"{s['id']}_top"] = round(zmax, 4)
    if abs(zmax - s["seatTop"]) > 0.03:
        report["fails"].append(f"{s['id']} top {zmax}")
# the pocket's walkable ground (visible mesh) stays at the walk level
bad = 0
for v in GROUND.data.vertices:
    gx, gz = v.co.x, -v.co.y
    if F.walk_surface_ok(gx, gz) and F.slab_at(gx, gz) is None and abs(v.co.z) > 0.06:
        bad += 1
report["pocket_ground_bad_verts"] = bad
if bad:
    report["fails"].append(f"{bad} pocket ground vertices off the walk level")
# nothing out of the site box
mx = -1e9
for ob in COLL.objects:
    if ob.type == "MESH" and ob.get("cat") in ("rock", "ground"):
        for v in ob.data.vertices:
            mx = max(mx, v.co.x)
report["max_x_cliff_ground"] = round(mx, 3)
report["tris"] = {
    "cliff_lod0": tri_count([FACE0]), "cliff_lod1": tri_count([FACE1]), "flank_lod0": tri_count([FLANK0]), "flank_lod1": tri_count([FLANK1]), "ground": tri_count([GROUND]),
    "kit_instances": INST_COUNT, "kit_instance_tris": INST_TRIS, "kit_meshes": KIT_TRIS,
    "slabs_seats": tri_count(SLABS + SEATS), "lamps": LAMP_TRIS, "pebbles": PEBBLE_TRIS, "veg": VEG_TRIS,
}
high = tri_count([FACE0]) + tri_count([FLANK0]) + tri_count([GROUND]) + INST_TRIS + tri_count(SLABS + SEATS) + LAMP_TRIS + PEBBLE_TRIS + VEG_TRIS
report["tris_total_w1_high"] = high
report["tex"] = {"files": sorted(os.listdir(TEXF)), "sizes": "1024x1024 (rock, slab, gravel, turf) colour+normal"}
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
    sel = [o for o in COLL.objects if o.type in ("MESH", "EMPTY") and not (o.get("cat") == "rock" and o.name.endswith("lod1") and False)]
    for o in sel:
        o.select_set(True)
    bpy.context.view_layer.objects.active = FACE0
    glb = os.path.join(WORK, "falls_w1.glb")
    kw = dict(filepath=glb, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
              export_texcoords=True, export_normals=True, export_materials="EXPORT", export_image_format="WEBP",
              export_image_quality=80, export_animations=False, export_cameras=False, export_lights=False,
              export_extras=False, export_skins=False, export_morph=False, export_vertex_color="MATERIAL",
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
    except Exception as e:
        print("GLB export failed:", e)
