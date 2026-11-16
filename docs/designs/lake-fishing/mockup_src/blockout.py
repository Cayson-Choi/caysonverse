"""Quick blockout of the proposed lake (design draft only, NOT the final asset).
blender -b --factory-startup -P blockout.py -- <out_dir>      (env SHOTS=aerial,pier)
Game (x, z, y) -> Blender (x, -z, y)."""
import bpy, bmesh, math, os, sys, random
from mathutils import Vector, noise
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lake_layout as L

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../../.."))
TEX = os.path.join(ROOT, "art/village/downloads/tex")
HDRI = os.path.join(ROOT, "art/village/downloads/hdri/kloppenheim_06_puresky_2k.hdr")
rng = random.Random(3)


def B(x, z, y=0.0):
    return Vector((x, -z, y))


bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene


# ---------------------------------------------------------------- materials
def mat(name, col, rough=0.8, metal=0.0, tex=None, scale=1.0, emit=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bs = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bs.inputs["Base Color"].default_value = (*col, 1)
    bs.inputs["Roughness"].default_value = rough
    bs.inputs["Metallic"].default_value = metal
    if emit:
        bs.inputs["Emission Color"].default_value = (*emit[0], 1)
        bs.inputs["Emission Strength"].default_value = emit[1]
    if tex and os.path.exists(os.path.join(TEX, tex)):
        ti = nt.nodes.new("ShaderNodeTexImage")
        ti.image = bpy.data.images.load(os.path.join(TEX, tex))
        tc = nt.nodes.new("ShaderNodeTexCoord")
        mp = nt.nodes.new("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (scale, scale, scale)
        nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
        nt.links.new(mp.outputs["Vector"], ti.inputs["Vector"])
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        nt.links.new(ti.outputs["Color"], mix.inputs[6])
        mix.inputs[7].default_value = (*[min(1, c * 1.8) for c in col], 1)
        nt.links.new(mix.outputs[2], bs.inputs["Base Color"])
    return m


M = {
    "grass": mat("grass", (0.32, 0.42, 0.22), 0.95, tex="leafy_grass_diff_1k.jpg", scale=0.25),
    "dirt": mat("dirt", (0.42, 0.34, 0.24), 0.95, tex="grass_path_2_diff_1k.jpg", scale=0.3),
    "mud": mat("mud", (0.25, 0.22, 0.16), 0.9),
    "hill": mat("hill", (0.16, 0.24, 0.12), 1.0),
    "deck": mat("deck", (0.55, 0.40, 0.26), 0.8, tex="weathered_planks_diff_1k.jpg", scale=0.5),
    "post": mat("post", (0.25, 0.2, 0.15), 0.9),
    "pipe": mat("pipe", (0.75, 0.76, 0.78), 0.35, 0.8),
    "drum": mat("drum", (0.12, 0.32, 0.62), 0.45),
    "cabin": mat("cabin", (0.80, 0.42, 0.18), 0.7),
    "roof": mat("roof", (0.78, 0.33, 0.12), 0.6),
    "panel": mat("panel", (0.88, 0.89, 0.87), 0.55),
    "blue": mat("blue", (0.10, 0.30, 0.62), 0.5),
    "glass": mat("glass", (0.15, 0.2, 0.22), 0.05),
    "sign": mat("sign", (0.95, 0.95, 0.92), 0.5),
    "reed": mat("reed", (0.48, 0.52, 0.26), 0.9),
    "reedtop": mat("reedtop", (0.45, 0.33, 0.2), 0.9),
    "leaf": mat("leaf", (0.13, 0.27, 0.09), 0.9),
    "bark": mat("bark", (0.22, 0.17, 0.12), 0.9),
    "skin": mat("skin", (0.95, 0.78, 0.65), 0.6),
    "shirt": mat("shirt", (0.20, 0.45, 0.75), 0.7),
    "pants": mat("pants", (0.18, 0.18, 0.22), 0.8),
    "hair": mat("hair", (0.12, 0.08, 0.06), 0.7),
    "rod": mat("rod", (0.08, 0.08, 0.1), 0.3, 0.3),
    "float": mat("float", (0.95, 0.25, 0.08), 0.4, emit=((1, 0.3, 0.05), 0.6)),
    "chair": mat("chair", (0.15, 0.25, 0.18), 0.7),
    "lamp": mat("lamp", (1, 0.9, 0.6), 0.3, emit=((1, 0.85, 0.55), 4)),
    "wood": mat("wood", (0.45, 0.28, 0.16), 0.75),
    "vend": mat("vend", (0.8, 0.12, 0.1), 0.4),
}
water = bpy.data.materials.new("water")
water.use_nodes = True
_bs = next(n for n in water.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
_bs.inputs["Base Color"].default_value = (0.07, 0.10, 0.05, 1)
_bs.inputs["Roughness"].default_value = 0.03
_bs.inputs["IOR"].default_value = 1.33
_nt = water.node_tree
_nz = _nt.nodes.new("ShaderNodeTexNoise")
_nz.inputs["Scale"].default_value = 2.5
_nz.inputs["Detail"].default_value = 6
_bump = _nt.nodes.new("ShaderNodeBump")
_bump.inputs["Strength"].default_value = 0.04
_nt.links.new(_nz.outputs["Fac"], _bump.inputs["Height"])
_nt.links.new(_bump.outputs["Normal"], _bs.inputs["Normal"])


def obj_from_bm(bm, name, m):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    sc.collection.objects.link(ob)
    for mm in (m if isinstance(m, list) else [m]):
        me.materials.append(mm)
    return ob


def box(x0, x1, z0, z1, y0, y1, m, name="box"):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector(((x0 + x1) / 2 + v.co.x * (x1 - x0), -((z0 + z1) / 2 + v.co.y * (z1 - z0)),
                       (y0 + y1) / 2 + v.co.z * (y1 - y0)))
    return obj_from_bm(bm, name, m)


def cyl(x, z, y0, y1, r, m, seg=12, name="cyl", top=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if top is None else top, depth=y1 - y0)
    for v in bm.verts:
        v.co += Vector((x, -z, (y0 + y1) / 2))
    return obj_from_bm(bm, name, m)


def sphere(x, z, y, r, m, sx=1, sy=1, sz=1, name="sph"):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=r)
    for v in bm.verts:
        v.co = Vector((v.co.x * sx + x, v.co.y * sy - z, v.co.z * sz + y))
    ob = obj_from_bm(bm, name, m)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def stick(butt, tip, r0, r1, m, name="stick"):
    d = tip - butt
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=r0, radius2=r1, depth=d.length)
    for v in bm.verts:
        v.co.z += d.length / 2
    ob = obj_from_bm(bm, name, m)
    ob.location = butt
    ob.rotation_mode = "QUATERNION"
    ob.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    return ob


# ---------------------------------------------------------------- terrain
def dist_poly(p, poly):
    best = 1e9
    px, pz = p
    for (ax, az), (bx, bz) in zip(poly, poly[1:] + poly[:1]):
        dx, dz = bx - ax, bz - az
        t = max(0, min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)))
        best = min(best, math.hypot(px - (ax + t * dx), pz - (az + t * dz)))
    return best


def sm(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def height(x, z):
    p = (x, z)
    dw = dist_poly(p, L.SHORE)
    if L.inside(p, L.SHORE):
        return L.WATER_Y - 0.25 - min(3.0, dw * 0.22)
    if x < 95.5:
        return 0.0
    bank = L.WATER_Y + (0 - L.WATER_Y) * sm(0, 1.8, dw)
    if L.inside(p, L.WALK):
        return min(0.0, bank)
    dk = min(dist_poly(p, L.WALK), max(0.0, dw - 1.5))
    n = noise.noise(Vector((x * 0.04, z * 0.04, 1.3)))
    hill = (14 + 6 * n) * (1 - math.exp(-dk / 16)) + 0.08 * dk * sm(30, 90, dk)
    if dw < 3:
        return bank * (1 - sm(0, 3, dw)) + hill * sm(0, 3, dw)
    return hill


bm = bmesh.new()
xs = [60 + i * 1.5 for i in range(int((250 - 60) / 1.5) + 1)]
zs = [-120 + i * 1.5 for i in range(int((100 + 120) / 1.5) + 1)]
grid = [[bm.verts.new(B(x, z, height(x, z))) for x in xs] for z in zs]
for j in range(len(zs) - 1):
    for i in range(len(xs) - 1):
        f = bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
        cx, cz = (xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2
        hh = height(cx, cz)
        walkish = L.inside((cx, cz), L.WALK) or cx < 95.5
        f.material_index = 0 if (walkish and hh > -0.2) else (2 if hh < -0.05 else 3)
ter = obj_from_bm(bm, "terrain", [M["grass"], M["dirt"], M["mud"], M["hill"]])
for p in ter.data.polygons:
    p.use_smooth = True

bm = bmesh.new()
for a, b in zip(L.TRAIL, L.TRAIL[1:]):
    dx, dz = b[0] - a[0], b[1] - a[1]
    l = math.hypot(dx, dz)
    nx, nz = -dz / l * 1.25, dx / l * 1.25
    vs = [bm.verts.new(B(a[0] + nx, a[1] + nz, 0.02)), bm.verts.new(B(b[0] + nx, b[1] + nz, 0.02)),
          bm.verts.new(B(b[0] - nx, b[1] - nz, 0.02)), bm.verts.new(B(a[0] - nx, a[1] - nz, 0.02))]
    bm.faces.new(vs)
obj_from_bm(bm, "trail", M["dirt"])
box(97.5, 108, -19.5, -13.8, -0.02, 0.015, M["dirt"], "yard")

bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=80)
for v in bm.verts:
    v.co += Vector((143, 12, L.WATER_Y))
obj_from_bm(bm, "water", water)


# ---------------------------------------------------------------- decks
def deck(b, name, floating=False):
    w, d = b["maxX"] - b["minX"], b["maxZ"] - b["minZ"]
    along_x = w > d
    n = int((w if along_x else d) / 0.3)
    for i in range(n):
        if along_x:
            x0 = b["minX"] + i * 0.3
            box(x0 + 0.01, x0 + 0.29, b["minZ"], b["maxZ"], -0.06, 0.0, M["deck"], name)
        else:
            z0 = b["minZ"] + i * 0.3
            box(b["minX"], b["maxX"], z0 + 0.01, z0 + 0.29, -0.06, 0.0, M["deck"], name)
    box(b["minX"], b["maxX"], b["minZ"], b["minZ"] + 0.12, -0.32, -0.06, M["post"])
    box(b["minX"], b["maxX"], b["maxZ"] - 0.12, b["maxZ"], -0.32, -0.06, M["post"])
    if floating:
        x = b["minX"] + 0.5
        while x < b["maxX"] - 0.3:
            for z in (b["minZ"] + 0.6, b["maxZ"] - 0.6, (b["minZ"] + b["maxZ"]) / 2):
                cyl(x, z, -0.85, -0.3, 0.29, M["drum"], 16)
            x += 0.95
    else:
        x = b["minX"] + 1
        while x < b["maxX"]:
            for z in (b["minZ"] + 0.1, b["maxZ"] - 0.1):
                cyl(x, z, -3.0, -0.06, 0.09, M["post"], 8)
            x += 2.5


deck(L.PIER, "pier")
deck(L.PIER_T, "pierT")
for b_ in (L.WALKWAY_A, L.WALKWAY_B):
    deck(b_, "walk", floating=True)
for b_ in (L.JWADAE_A, L.JWADAE_B):
    deck(b_, "jwadae", floating=True)


def rail_box(b, open_sides=()):
    h = 0.75
    edges = {"n": ((b["minX"], b["minZ"]), (b["maxX"], b["minZ"])), "s": ((b["minX"], b["maxZ"]), (b["maxX"], b["maxZ"])),
             "w": ((b["minX"], b["minZ"]), (b["minX"], b["maxZ"])), "e": ((b["maxX"], b["minZ"]), (b["maxX"], b["maxZ"]))}
    for k, (a, c) in edges.items():
        if k in open_sides:
            continue
        l = math.hypot(c[0] - a[0], c[1] - a[1])
        n = max(1, int(l / 1.8))
        for i in range(n + 1):
            t = i / n
            cyl(a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, 0, h, 0.03, M["pipe"], 8)
        for yy in (h, h * 0.5):
            stick(B(a[0], a[1], yy), B(c[0], c[1], yy), 0.025, 0.025, M["pipe"], "rail")


def hut(b, door_side):
    x0, x1, z0, z1 = b["minX"], b["maxX"], b["minZ"], b["maxZ"]
    h = 2.9
    box(x0, x1, z0, z1, 0, h, M["cabin"], "hut")
    for i in range(1, 14):
        box(x0 - 0.03, x1 + 0.03, z0 - 0.03, z1 + 0.03, i * 0.21 - 0.01, i * 0.21 + 0.01, M["post"], "log")
    bm = bmesh.new()
    cz = (z0 + z1) / 2
    ov = 0.45
    p = [B(x0 - ov, z0 - ov, h), B(x1 + ov, z0 - ov, h), B(x1 + ov, cz, h + 1.1), B(x0 - ov, cz, h + 1.1),
         B(x0 - ov, z1 + ov, h), B(x1 + ov, z1 + ov, h)]
    v = [bm.verts.new(q) for q in p]
    bm.faces.new((v[0], v[1], v[2], v[3]))
    bm.faces.new((v[3], v[2], v[5], v[4]))
    r = obj_from_bm(bm, "roof", M["roof"])
    r.modifiers.new("s", "SOLIDIFY").thickness = 0.12
    dz = z1 if door_side == "s" else z0
    box(x0 + 0.9, x1 - 0.9, dz - 0.04, dz + 0.04, 0, 2.3, M["panel"], "door")
    wz = z0 if door_side == "s" else z1
    box(x0 + 0.4, x1 - 0.4, wz - 0.04, wz + 0.04, 1.2, 1.9, M["glass"], "win")


hut(L.HUT_A, "s")
hut(L.HUT_B, "n")
rail_box(L.JWADAE_A, open_sides=("s",))
rail_box(L.JWADAE_B, open_sides=("n",))
for b_ in (L.WALKWAY_A, L.WALKWAY_B):
    rail_box(b_, open_sides=("n", "s"))

# ---------------------------------------------------------------- shop
s = L.SHOP
x0, x1, z0, z1 = s["minX"], s["maxX"], s["minZ"], s["maxZ"]
box(x0, x1, z0, z1, 0, 3.8, M["panel"], "shop")
for i in range(1, 8):
    box(x0 + i * 1.0 - 0.02, x0 + i * 1.0 + 0.02, z1, z1 + 0.04, 0, 3.8, M["pipe"], "panel_joint")
box(x0 - 0.6, x1 + 0.6, z0 - 0.6, z1 + 1.8, 3.8, 4.0, M["blue"], "shop_roof")
for xx in (x0 - 0.4, x1 + 0.4):
    cyl(xx, z1 + 1.6, 0, 3.8, 0.06, M["pipe"], 8)
box(x0 + 0.5, x0 + 4.2, z1, z1 + 0.05, 1.1, 2.5, M["glass"], "counter_window")
box(x0 + 0.4, x0 + 4.3, z1, z1 + 0.6, 1.0, 1.08, M["wood"], "counter")
box(x1 - 2.6, x1 - 1.0, z1, z1 + 0.06, 0, 2.9, M["glass"], "door")
box(x0 + 0.5, x1 - 0.5, z1 + 0.05, z1 + 0.12, 4.05, 5.0, M["sign"], "signboard")
box(x1 + 0.1, x1 + 1.0, z1 - 1.5, z1 - 0.3, 0, 2.0, M["vend"], "vending")
for i in range(8):
    cyl(x0 + 4.6 + i * 0.12, z1 + 0.9, 0, 3.4, 0.015, M["rod"], 6)
box(x0 + 4.4, x0 + 5.6, z1 + 0.7, z1 + 1.1, 0.9, 0.98, M["wood"], "rack")
for k in range(4):
    cyl(x0 + 6.0, z1 + 0.6 + k * 0.03, 0.0, 0.8 + k * 0.04, 0.2, M["chair"], 8)

# ---------------------------------------------------------------- spots, benches, pavilion, lamps
for sid, x, z, f in L.SPOTS:
    fx, fz = L.FACE[f]
    cx, cz = x - fx * 0.7, z - fz * 0.7
    box(cx - 0.3, cx + 0.3, cz - 0.3, cz + 0.3, 0.35, 0.45, M["chair"], "chair")
    for dx in (-0.25, 0.25):
        for dz in (-0.25, 0.25):
            cyl(cx + dx, cz + dz, 0, 0.35, 0.02, M["pipe"], 6)
    bx, bz = cx - fx * 0.3, cz - fz * 0.3
    if f in ("n", "s"):
        box(bx - 0.3, bx + 0.3, bz - 0.03, bz + 0.03, 0.45, 1.05, M["chair"], "back")
    else:
        box(bx - 0.03, bx + 0.03, bz - 0.3, bz + 0.3, 0.45, 1.05, M["chair"], "back")
    cyl(x + fx * 0.1, z + fz * 0.1, -0.1, 0.6, 0.02, M["pipe"], 6)
    tx, tz = x + fx * L.CAST_M, z + fz * L.CAST_M
    cyl(tx, tz, L.WATER_Y - 0.15, L.WATER_Y + 0.28, 0.02, M["float"], 8)

for x, z, f in L.BENCHES:
    box(x - 0.35, x + 0.35, z - 1.2, z + 1.2, 0.45, 0.55, M["wood"], "bench")
    box(x - 0.45, x - 0.38, z - 1.2, z + 1.2, 0.55, 1.1, M["wood"], "bench_back")
    for dz in (-1.0, 1.0):
        box(x - 0.3, x + 0.3, z + dz - 0.05, z + dz + 0.05, 0, 0.45, M["post"])
for x, z in L.PICNIC:
    box(x - 0.6, x + 0.6, z - 1.5, z + 1.5, 0.78, 0.86, M["wood"], "table")
    for dx in (-1.0, 1.0):
        box(x + dx - 0.2, x + dx + 0.2, z - 1.5, z + 1.5, 0.45, 0.52, M["wood"], "seat")
pc = L.PAVILION["centre"]
hs = L.PAVILION["size"] / 2
box(pc[0] - hs, pc[0] + hs, pc[1] - hs, pc[1] + hs, 0.0, 0.5, M["wood"], "pav_floor")
for dx in (-hs + 0.2, hs - 0.2):
    for dz in (-hs + 0.2, hs - 0.2):
        cyl(pc[0] + dx, pc[1] + dz, 0.5, 3.4, 0.14, M["wood"], 10)
bm = bmesh.new()
top = bm.verts.new(B(pc[0], pc[1], 5.0))
cs = [bm.verts.new(B(pc[0] + sx * (hs + 1), pc[1] + sz_ * (hs + 1), 3.4)) for sx, sz_ in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
for i in range(4):
    bm.faces.new((cs[i], cs[(i + 1) % 4], top))
obj_from_bm(bm, "pav_roof", M["roof"])
for x, z in L.LAMPS:
    cyl(x, z, 0, 4.2, 0.06, M["post"], 8)
    sphere(x, z, 4.3, 0.18, M["lamp"])

# ---------------------------------------------------------------- reeds and trees
for (cx, cz), r in L.REEDS:
    for k in range(int(r * r * 9)):
        a = rng.uniform(0, 6.283)
        d = r * math.sqrt(rng.random())
        x, z = cx + math.cos(a) * d, cz + math.sin(a) * d
        hgt = rng.uniform(1.3, 2.3)
        ob = cyl(x, z, L.WATER_Y - 0.1, L.WATER_Y + hgt, 0.012, M["reed"], 4, top=0.002)
        ob.rotation_euler = (rng.uniform(-0.12, 0.12), rng.uniform(-0.12, 0.12), 0)
        if rng.random() < 0.15:
            cyl(x, z, L.WATER_Y + hgt * 0.75, L.WATER_Y + hgt * 0.85, 0.03, M["reedtop"], 6)
placed = tries = 0
while placed < 520 and tries < 20000:
    tries += 1
    x, z = rng.uniform(92, 245), rng.uniform(-118, 98)
    if L.inside((x, z), L.SHORE) or dist_poly((x, z), L.SHORE) < 3 or L.inside((x, z), L.WALK):
        continue
    if x < 96 and -70 < z < 46:
        continue
    y = height(x, z)
    h = rng.uniform(7, 12)
    cyl(x, z, y - 0.3, y + h * 0.45, 0.22, M["bark"], 6)
    sphere(x, z, y + h * 0.62, h * 0.28, M["leaf"], 1, 1, 1.25)
    placed += 1
for x, z in [(99, -40), (100, -50), (104, 22), (98, 28), (100, -62)]:
    cyl(x, z, 0, 5, 0.25, M["bark"], 8)
    sphere(x, z, 7, 3.2, M["leaf"], 1, 1, 1.2)


# ---------------------------------------------------------------- chibi stand-ins (2.16 m tall) with rods
def chibi(x, z, yaw, seated=False, rod_to=None):
    base = 0.45 if seated else 0.0
    sphere(x, z, base + 0.35, 0.33, M["pants"], 1, 1, 1.1)
    sphere(x, z, base + 0.85, 0.36, M["shirt"], 1, 1, 1.2)
    sphere(x, z, base + 1.55, 0.58, M["skin"], 1, 1, 1.0)
    sphere(x, z + 0.02, base + 1.72, 0.6, M["hair"], 1, 1, 0.75)
    if rod_to:
        hx, hz = x + math.sin(yaw) * 0.35, z - math.cos(yaw) * 0.35
        stick(B(hx, hz, base + 0.9), B(*rod_to), 0.02, 0.004, M["rod"], "rod_hand")


for sid, x, z, f in L.SPOTS:
    if sid in ("P05", "P06", "P09", "P13", "A1", "A4", "N2", "S2", "B3"):
        fx, fz = L.FACE[f]
        cx, cz = x - fx * 0.7, z - fz * 0.7
        chibi(cx, cz, math.atan2(fx, -fz), True, (x + fx * 3.4, z + fz * 3.4, 2.2))
chibi(102.5, -16.5, math.pi)
chibi(104, -8, 0.5)

# ---------------------------------------------------------------- world, light, cameras
wd = bpy.data.worlds.new("w")
sc.world = wd
wd.use_nodes = True
env = wd.node_tree.nodes.new("ShaderNodeTexEnvironment")
env.image = bpy.data.images.load(HDRI)
bg = next(n for n in wd.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs["Strength"].default_value = 0.9
wd.node_tree.links.new(env.outputs["Color"], bg.inputs["Color"])
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sc.collection.objects.link(sun)
sun.data.energy = 3.2
sun.rotation_euler = (math.radians(50), 0, math.radians(-130))
sun.data.angle = math.radians(1.5)
try:
    sc.render.engine = "BLENDER_EEVEE"
except TypeError as e:
    print(e)
ee = sc.eevee
for k, v in (("taa_render_samples", 48), ("use_raytracing", True), ("use_shadows", True)):
    if hasattr(ee, k):
        setattr(ee, k, v)
vts = [i.identifier for i in bpy.types.ColorManagedViewSettings.bl_rna.properties["view_transform"].enum_items]
sc.view_settings.view_transform = "AgX" if "AgX" in vts else "Filmic"
sc.render.resolution_x, sc.render.resolution_y = 1600, 900
sc.render.image_settings.file_format = "JPEG"
sc.render.image_settings.quality = 88


def shoot(name, eye, look, lens=24):
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    sc.collection.objects.link(cam)
    cam.location = B(*eye)
    cam.data.lens = lens
    cam.data.clip_end = 3000
    cam.rotation_mode = "QUATERNION"
    cam.rotation_quaternion = (B(*look) - cam.location).to_track_quat("-Z", "Y")
    sc.camera = cam
    sc.render.filepath = os.path.join(OUT, name + ".jpg")
    bpy.ops.render.render(write_still=True)
    print("rendered", sc.render.filepath)


which = os.environ.get("SHOTS", "aerial,pier")
if "aerial" in which:
    shoot("blockout_aerial", (84, 52, 46), (136, -12, -4), 22)
if "pier" in which:
    shoot("blockout_pier", (124.5, -7.0, 3.4), (141, -30, 0.2), 26)
