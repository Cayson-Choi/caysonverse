# Scratch mockup of the redesigned memorial hall interior (design phase only; NOT the pipeline).
# Blender coords: X = game x - 300, Y = -game z (north = +Y), Z up. Room x -7.5..7.5, y -6..6, ceiling 4.5.
import bpy, bmesh, math, random, sys, os
from mathutils import Vector

OUT = os.path.dirname(os.path.abspath(__file__))
ATLAS = "D:/Codex/cayson-games/caysonverse/client/public/village/sample-photos/atlas.webp"
FONT = "D:/Codex/cayson-games/caysonverse-village/art/fonts/NotoSansKR-VF.ttf"
VIEWS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["plan", "entrance", "cubby", "lounge"]
QUICK = os.environ.get("MOCK_QUICK") == "1"
rnd = random.Random(7)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
col_ceiling = bpy.data.collections.new("ceiling"); sc.collection.children.link(col_ceiling)

# ---------------------------------------------------------------- materials
def mat(name, color, rough=0.5, metal=0.0, emit=None, estr=0.0, alpha=1.0, trans=0.0, coat=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if coat: b.inputs["Coat Weight"].default_value = coat
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1); b.inputs["Emission Strength"].default_value = estr
    if trans:
        b.inputs["Transmission Weight"].default_value = trans
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        try: m.surface_render_method = "BLENDED"
        except Exception: pass
    return m

def brick_floor(name, c1, c2, scale=(0.18, 1.2)):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tc = nt.nodes.new("ShaderNodeNewGeometry"); mp = nt.nodes.new("ShaderNodeMapping")
    br = nt.nodes.new("ShaderNodeTexBrick")
    br.inputs["Brick Width"].default_value = scale[1]; br.inputs["Row Height"].default_value = scale[0]
    br.inputs["Color1"].default_value = (*c1, 1); br.inputs["Color2"].default_value = (*c2, 1)
    br.inputs["Mortar"].default_value = (c2[0] * .6, c2[1] * .6, c2[2] * .6, 1)
    br.inputs["Scale"].default_value = 1.0; br.inputs["Mortar Size"].default_value = 0.008
    br.offset = 0.37
    nz = nt.nodes.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 40
    mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"; mix.inputs["Factor"].default_value = 0.12
    nt.links.new(tc.outputs["Position"], mp.inputs["Vector"]); nt.links.new(mp.outputs["Vector"], br.inputs["Vector"])
    nt.links.new(br.outputs["Color"], mix.inputs[6]); nt.links.new(nz.outputs["Color"], mix.inputs[7])
    nt.links.new(mix.outputs[2], b.inputs["Base Color"]); b.inputs["Roughness"].default_value = 0.45
    return m

M = dict(
    plaster=mat("plaster", (0.86, 0.84, 0.80), 0.85),
    ceiling=mat("ceiling", (0.90, 0.89, 0.86), 0.9),
    lacquer=mat("lacquer", (0.92, 0.91, 0.88), 0.25, coat=0.3),
    oak=mat("oak", (0.62, 0.45, 0.29), 0.45),
    oak_l=mat("oak_light", (0.76, 0.60, 0.42), 0.5),
    walnut=mat("walnut", (0.30, 0.19, 0.12), 0.4),
    birch=mat("birch", (0.86, 0.74, 0.56), 0.6),
    sage=mat("sage", (0.36, 0.44, 0.38), 0.8),
    brass=mat("brass", (0.83, 0.66, 0.36), 0.3, 1.0),
    alu=mat("alu", (0.70, 0.68, 0.64), 0.35, 1.0),
    glass=mat("glass", (0.85, 0.92, 0.95), 0.03, alpha=0.07),
    fabric=mat("fabric", (0.62, 0.60, 0.56), 0.95),
    fabric2=mat("fabric_cream", (0.86, 0.82, 0.74), 0.95),
    cushion_a=mat("cushion_sage", (0.50, 0.58, 0.48), 0.95),
    cushion_b=mat("cushion_clay", (0.78, 0.52, 0.40), 0.95),
    rug=mat("rug", (0.78, 0.73, 0.65), 1.0),
    black=mat("black", (0.04, 0.04, 0.045), 0.4),
    steel=mat("steel", (0.75, 0.75, 0.76), 0.25, 1.0),
    white=mat("white", (0.95, 0.95, 0.94), 0.4),
    porcelain=mat("porcelain", (0.96, 0.95, 0.93), 0.15, coat=0.6),
    leaf=mat("leaf", (0.16, 0.36, 0.14), 0.6),
    leaf2=mat("leaf2", (0.28, 0.45, 0.18), 0.6),
    trunk=mat("trunk", (0.30, 0.22, 0.15), 0.8),
    grass=mat("grass", (0.30, 0.48, 0.20), 0.9),
    stone=mat("stone", (0.62, 0.60, 0.56), 0.8),
    soil=mat("pot", (0.80, 0.76, 0.70), 0.7),
    cove=mat("cove", (1, 1, 1), 0.5, emit=(1.0, 0.86, 0.66), estr=6.0),
    strip=mat("strip", (1, 1, 1), 0.5, emit=(1.0, 0.82, 0.60), estr=2.5),
    flame=mat("flame", (1, 1, 1), 0.5, emit=(1.0, 0.62, 0.25), estr=25.0),
    screen=mat("screen", (0.1, 0.1, 0.1), 0.2, emit=(0.93, 0.95, 1.0), estr=1.6),
    skyglow=mat("skyglow", (1, 1, 1), 0.5, emit=(0.92, 0.96, 1.0), estr=4.0),
    sel=mat("sel", (1, 1, 1), 0.5, emit=(0.55, 0.45, 1.0), estr=6.0),
    selplate=mat("selplate", (0.29, 0.31, 0.85), 0.5),
    mail=mat("mailbox", (0.80, 0.30, 0.25), 0.5),
    skin=mat("skin", (0.98, 0.84, 0.74), 0.6),
    hair=mat("hair", (0.24, 0.16, 0.12), 0.7),
    shirt=mat("shirt", (0.29, 0.31, 0.85), 0.8),
    shirt2=mat("shirt2", (0.55, 0.36, 0.96), 0.8),
    shirt3=mat("shirt3", (0.92, 0.68, 0.45), 0.8),
    pants=mat("pants", (0.20, 0.22, 0.28), 0.8),
)
M["floor"] = brick_floor("oak_floor", (0.70, 0.54, 0.37), (0.62, 0.46, 0.31))
M["tile_out"] = brick_floor("paving", (0.70, 0.68, 0.64), (0.62, 0.60, 0.57), (0.6, 0.6))
FLOWER = [mat(f"fl{i}", c, 0.6) for i, c in enumerate([(0.95, 0.62, 0.70), (0.98, 0.85, 0.35), (0.97, 0.96, 0.92), (0.75, 0.62, 0.92), (0.95, 0.45, 0.40), (0.62, 0.78, 0.95)])]
URN = [M["porcelain"], mat("urn_pink", (0.93, 0.78, 0.78), 0.2, coat=0.5), mat("urn_mint", (0.74, 0.88, 0.82), 0.2, coat=0.5), M["walnut"], mat("urn_gold", (0.85, 0.70, 0.40), 0.3, 0.8)]
TOY = [mat(f"toy{i}", c, 0.5) for i, c in enumerate([(0.95, 0.30, 0.30), (0.30, 0.55, 0.95), (0.98, 0.80, 0.20), (0.40, 0.80, 0.45)])]

PHOTO = []
img = bpy.data.images.load(ATLAS) if os.path.exists(ATLAS) else None
for t in range(16):
    m = bpy.data.materials.new(f"photo{t}"); m.use_nodes = True; nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    if img:
        tx = nt.nodes.new("ShaderNodeTexImage"); tx.image = img
        tc = nt.nodes.new("ShaderNodeTexCoord"); mp = nt.nodes.new("ShaderNodeMapping")
        sp = nt.nodes.new("ShaderNodeSeparateXYZ"); cb = nt.nodes.new("ShaderNodeCombineXYZ")
        nt.links.new(tc.outputs["Object"], sp.inputs[0]); nt.links.new(sp.outputs["X"], cb.inputs["X"]); nt.links.new(sp.outputs["Z"], cb.inputs["Y"])
        mp.inputs["Location"].default_value = ((t % 4) * 0.25 + 0.125, (3 - t // 4) * 0.25 + 0.125, 0)
        mp.inputs["Scale"].default_value = (0.25, 0.25, 1)
        nt.links.new(cb.outputs[0], mp.inputs["Vector"]); nt.links.new(mp.outputs["Vector"], tx.inputs["Vector"])
        nt.links.new(tx.outputs["Color"], b.inputs["Base Color"])
        nt.links.new(tx.outputs["Color"], b.inputs["Emission Color"]); b.inputs["Emission Strength"].default_value = 0.25
    b.inputs["Roughness"].default_value = 0.3
    PHOTO.append(m)

# ---------------------------------------------------------------- geometry helpers
_mesh_cache = {}
def link(o, ceiling=False):
    (col_ceiling if ceiling else sc.collection).objects.link(o); return o

def unit_cube():
    if "cube" not in _mesh_cache:
        me = bpy.data.meshes.new("cube"); bm = bmesh.new(); bm.loops.layers.uv.new("UVMap"); bmesh.ops.create_cube(bm, size=1.0, calc_uvs=True); bm.to_mesh(me); bm.free()
        _mesh_cache["cube"] = me
    return _mesh_cache["cube"]

def box(x0, y0, z0, x1, y1, z1, m, bevel=0.0, name="box", ceiling=False):
    """Axis-aligned box from min to max corner."""
    sx, sy, sz = max(abs(x1 - x0), 1e-4), max(abs(y1 - y0), 1e-4), max(abs(z1 - z0), 1e-4)
    loc = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    if bevel:
        me = unit_cube().copy(); me.materials.clear(); me.materials.append(m)
        for v in me.vertices: v.co = (v.co.x * sx, v.co.y * sy, v.co.z * sz)
        o = bpy.data.objects.new(name, me); o.location = loc
        md = o.modifiers.new("bv", "BEVEL"); md.width = min(bevel, sx / 2.2, sy / 2.2, sz / 2.2); md.segments = 3
        return link(o, ceiling)
    return mesh_obj(unit_cube(), loc, m, scale=(sx, sy, sz), name=name, ceiling=ceiling)

def shared(key, build):
    if key not in _mesh_cache: _mesh_cache[key] = build()
    return _mesh_cache[key]

def mesh_obj(me, loc, m=None, rot=(0, 0, 0), scale=(1, 1, 1), name="obj", ceiling=False):
    o = bpy.data.objects.new(name, me); o.location = loc; o.rotation_euler = rot; o.scale = scale
    if m is not None:
        if len(me.materials) == 0: me.materials.append(None)
        o.material_slots[0].link = "OBJECT"; o.material_slots[0].material = m
    return link(o, ceiling)

def cyl_mesh(r=1, d=1, v=24):
    def b():
        me = bpy.data.meshes.new(f"cyl{v}"); bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=v, radius1=1, radius2=1, depth=1); bm.to_mesh(me); bm.free()
        for p in me.polygons: p.use_smooth = True
        return me
    return shared(f"cyl{v}", b)

def sph_mesh(sub=2):
    def b():
        me = bpy.data.meshes.new(f"sph{sub}"); bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1); bm.to_mesh(me); bm.free()
        for p in me.polygons: p.use_smooth = True
        return me
    return shared(f"sph{sub}", b)

def cyl(x, y, z0, r, h, m, v=24, name="cyl", ceiling=False):
    return mesh_obj(cyl_mesh(v=v), (x, y, z0 + h / 2), m, scale=(r, r, h), name=name, ceiling=ceiling)

def sph(x, y, z, r, m, sub=2, name="sph", sz=None):
    return mesh_obj(sph_mesh(sub), (x, y, z), m, scale=(r, r, sz or r), name=name)

def prism_roof():
    def b():
        me = bpy.data.meshes.new("roof"); bm = bmesh.new()
        # gable roof along X, unit width/depth, height 0.5, eaves overhang
        v = [bm.verts.new(p) for p in [(-.5, -.5, 0), (.5, -.5, 0), (.5, .5, 0), (-.5, .5, 0), (-.5, 0, .5), (.5, 0, .5)]]
        # faces: two slopes and two gables, bottom
        bm.faces.new([v[0], v[1], v[5], v[4]]); bm.faces.new([v[3], v[4], v[5], v[2]])
        bm.faces.new([v[0], v[4], v[3]]); bm.faces.new([v[1], v[2], v[5]]); bm.faces.new([v[0], v[3], v[2], v[1]])
        bm.normal_update(); bm.to_mesh(me); bm.free(); return me
    return shared("roof", b)

def text(s, x, y, z, size, m, rot=(math.pi / 2, 0, 0), align="CENTER", extrude=0.004, weight_bold=False):
    cu = bpy.data.curves.new("txt", "FONT"); cu.body = s; cu.size = size; cu.align_x = align; cu.extrude = extrude
    if os.path.exists(FONT): cu.font = bpy.data.fonts.load(FONT, check_existing=True)
    o = bpy.data.objects.new("txt", cu); o.location = (x, y, z); o.rotation_euler = rot; o.data.materials.append(m)
    return link(o)

def area_light(name, loc, size, energy, color=(1, .9, .78), rot=(0, 0, 0), sx=None):
    ld = bpy.data.lights.new(name, "AREA"); ld.energy = energy; ld.color = color
    if sx: ld.shape = "RECTANGLE"; ld.size = sx; ld.size_y = size
    else: ld.size = size
    o = bpy.data.objects.new(name, ld); o.location = loc; o.rotation_euler = rot; return link(o)

def point_light(loc, energy, color=(1, .85, .65), radius=0.05):
    ld = bpy.data.lights.new("pt", "POINT"); ld.energy = energy; ld.color = color; ld.shadow_soft_size = radius
    o = bpy.data.objects.new("pt", ld); o.location = loc; return link(o)

def spot(loc, energy, size=0.6, color=(1, .88, .72)):
    ld = bpy.data.lights.new("spot", "SPOT"); ld.energy = energy; ld.color = color; ld.spot_size = size; ld.spot_blend = 0.6; ld.shadow_soft_size = 0.05
    o = bpy.data.objects.new("spot", ld); o.location = loc; return link(o)

# ---------------------------------------------------------------- shell
W, D, H = 7.5, 6.0, 4.5
box(-W, -D, -0.05, W, D, 0, M["floor"], name="floor")
box(-W - .2, -D, 0, -W, D, H, M["plaster"], name="wall_w_full") if False else None
# west wall with a big garden window y -5.2..0.6, sill 0.7, head 3.0
WIN = (-5.2, 0.6, 0.7, 3.0)
box(-W - .2, -D, 0, -W, WIN[0], H, M["plaster"]); box(-W - .2, WIN[1], 0, -W, D, H, M["plaster"])
box(-W - .2, WIN[0], 0, -W, WIN[1], WIN[2], M["plaster"]); box(-W - .2, WIN[0], WIN[3], -W, WIN[1], H, M["plaster"])
box(-W - .05, WIN[0], WIN[2] - .04, -W + .18, WIN[1], WIN[2], M["oak"], bevel=.01)  # sill
for i in range(5):
    y = WIN[0] + i * (WIN[1] - WIN[0]) / 4
    box(-W - .12, y - .03, WIN[2], -W - .06, y + .03, WIN[3], M["alu"])
box(-W - .12, WIN[0], WIN[3] - .05, -W - .06, WIN[1], WIN[3], M["alu"]); box(-W - .12, WIN[0], 2.25, -W - .06, WIN[1], 2.29, M["alu"])
box(-W - .1, WIN[0], WIN[2], -W - .09, WIN[1], WIN[3], M["glass"])
# north & east walls
box(-W, D, 0, W, D + .2, H, M["plaster"]); box(W, -D, 0, W + .2, D, H, M["plaster"])
# south wall with door opening x -1.1..1.1, h 2.7
box(-W, -D - .2, 0, -1.1, -D, H, M["plaster"]); box(1.1, -D - .2, 0, W, -D, H, M["plaster"]); box(-1.1, -D - .2, 2.7, 1.1, -D, H, M["plaster"])
# baseboards
for (a, b2, c, d) in [(-W, -D, -W + .015, D), (-W, D - .015, W, D), (W - .015, -D, W, D), (-W, -D, -1.1, -D + .015), (1.1, -D, W, -D + .015)]:
    box(a, b2, 0, c, d, .09, M["oak"])
# ceiling: flat with a perimeter cove soffit and a skylight over the memorial niche
box(-W, -D, H, W, 2.6, H + .1, M["ceiling"], ceiling=True); box(-W, 2.6, H, -1.6, D, H + .1, M["ceiling"], ceiling=True)
box(1.6, 2.6, H, W, D, H + .1, M["ceiling"], ceiling=True); box(-1.6, 5.3, H, 1.6, D, H + .1, M["ceiling"], ceiling=True)
for (a, b2, c, d) in [(-1.62, 2.58, -1.55, 5.32), (1.55, 2.58, 1.62, 5.32), (-1.62, 2.58, 1.62, 2.65), (-1.62, 5.25, 1.62, 5.32)]:
    box(a, b2, H - .35, c, d, H, M["plaster"], ceiling=True)
box(-1.6, 2.6, H + .9, 1.6, 5.3, H + .92, M["skyglow"], ceiling=True)  # sky seen through the skylight
for (a, b2, c, d) in [(-W, -D, W, -D + .35), (-W, D - .7, W, D), (-W, -D, -W + .35, D), (W - .35, -D, W, D)]:
    box(a, b2, H - .32, c, d, H - .28, M["ceiling"], ceiling=True)
for (a, b2, c, d) in [(-W + .35, -D + .35, W - .35, -D + .37), (-W + .35, D - .72, W - .35, D - .7), (-W + .35, -D + .35, -W + .37, D - .7), (W - .37, -D + .35, W - .35, D - .7)]:
    box(a, b2, H - .28, c, d, H - .26, M["cove"], ceiling=True)
# oak slat feature over the lounge
for i in range(26):
    x = -7.1 + i * 0.16
    box(x, -5.6, H - .55, x + .06, -1.0, H - .45, M["oak_l"], ceiling=True)
# downlights
for (x, y) in [(-4, 3), (4, 3), (4, 0), (-4, 0), (0, -2), (0, -4.5), (4.8, -4), (-5.5, -3.3), (-3.2, -3.3), (5, 1.8)]:
    cyl(x, y, H - .012, .07, .01, M["cove"], ceiling=True)
    spot((x, y, H - .03), 70)

# ---------------------------------------------------------------- cubby walls
CELL, FR, DEP, UD, PL, ROWS = 0.4, 0.025, 0.36, 0.39, 0.12, 8
PITCH = CELL + FR
NAMES = ["콩이", "보리", "초코", "마루", "두부", "별이", "코코", "나비", "호두", "까미", "몽이", "하루"]

def decorate(cx, cy, z_floor, yaw, mood):
    """Fill one cubby (centre of the opening cx, cy; floor height z_floor; yaw: facing direction 0 = -Y? see caller)."""
    fx, fy = math.sin(yaw), -math.cos(yaw)   # facing vector into the room
    ax, ay = math.cos(yaw), math.sin(yaw)    # along the wall
    def at(u, w):  # u along, w depth (positive = toward back)
        return cx + ax * u - fx * w, cy + ay * u - fy * w
    rz = yaw
    # house housing (birch, gabled roof) with a gold plate
    hx, hy = at(-0.05 + rnd.uniform(-.02, .02), 0.17)
    box_rot = mesh_obj(unit_cube(), (hx, hy, z_floor + 0.085), M["birch"], rot=(0, 0, rz), scale=(.2, .17, .17), name="house")
    mesh_obj(prism_roof(), (hx, hy, z_floor + 0.17), M["birch"] if mood % 3 else M["walnut"], rot=(0, 0, rz), scale=(.235, .2, .16), name="roof")
    px, py = at(-0.05, 0.17 - 0.087)
    mesh_obj(unit_cube(), (px, py, z_floor + 0.05), M["brass"], rot=(0, 0, rz), scale=(.11, .004, .035), name="plate")
    # photo frame on a stand, angled slightly
    fx2, fy2 = at(0.12, 0.08)
    mesh_obj(unit_cube(), (fx2, fy2, z_floor + 0.085), M["oak"] if mood % 2 else M["white"], rot=(0.12, 0, rz), scale=(.11, .012, .14), name="frame")
    fx3, fy3 = at(0.12, 0.072)
    mesh_obj(unit_cube(), (fx3, fy3, z_floor + 0.088), PHOTO[rnd.randrange(16)], rot=(0.12, 0, rz), scale=(.085, .002, .11), name="photo")
    # flowers in a small vase
    if mood % 4 != 3:
        vx, vy = at(-0.155, 0.06)
        cyl(vx, vy, z_floor, .022, .07, M["glass"] if mood % 2 else M["porcelain"], v=12)
        fm = FLOWER[rnd.randrange(len(FLOWER))]; fm2 = FLOWER[rnd.randrange(len(FLOWER))]
        for k in range(5):
            a = k * 1.3
            sph(vx + .035 * math.cos(a), vy + .035 * math.sin(a), z_floor + .1 + .02 * (k % 2), .028, fm if k % 2 else fm2, sub=1)
        sph(vx, vy, z_floor + .085, .03, M["leaf2"], sub=1, sz=.02)
    # LED candle
    if mood % 3 != 1:
        lx, ly = at(0.03, 0.04)
        cyl(lx, ly, z_floor, .016, .045, M["porcelain"], v=12)
        sph(lx, ly, z_floor + .055, .007, M["flame"], sub=1, sz=.012)
    # toy / treat
    if mood % 5 in (0, 2):
        tx, ty = at(0.16, 0.25)
        sph(tx, ty, z_floor + .035, .035, TOY[rnd.randrange(4)], sub=2)
    # name card on the front lip
    nx, ny = at(0.0, -0.005)
    mesh_obj(unit_cube(), (nx, ny, z_floor - 0.006), M["white"], rot=(0, 0, rz), scale=(.12, .003, .018), name="namecard")

def cubby_bank(x0, y0, along, cols, yaw, finish, glass_doors, fill, nameplates=True, highlight=None):
    """A bank of `cols` x ROWS cubbies whose opening plane starts at (x0, y0) and runs along `along` (+X or -Y).
    The unit sits behind the opening plane toward the wall."""
    run = cols * PITCH + FR
    top = PL + ROWS * PITCH + FR
    fx, fy = math.sin(yaw), -math.cos(yaw)   # into the room
    ax, ay = along
    def P(u, w):
        return x0 + ax * u - fx * w, y0 + ay * u - fy * w
    def slab(u0, u1, w0, w1, z0, z1, m, bev=0.0):
        a = P(u0, w0); b2 = P(u1, w1)
        return box(min(a[0], b2[0]), min(a[1], b2[1]), z0, max(a[0], b2[0]), max(a[1], b2[1]), z1, m, bevel=bev)
    fm = M["lacquer"] if finish == "lacquer" else M["oak_l"]
    inner = M["white"] if finish == "lacquer" else M["birch"]
    slab(0, run, 0.0, UD, 0, PL, M["oak"] if finish == "lacquer" else M["walnut"])        # plinth
    slab(0, run, DEP, UD, PL, top, inner)                                               # back panel
    for c in range(cols + 1):
        u = c * PITCH; slab(u, u + FR, 0, DEP, PL, top, fm)
    for r in range(ROWS + 1):
        z = PL + r * PITCH; slab(0, run, 0, DEP, z, z + FR, fm)
        if r < ROWS:  # warm LED strip under each shelf
            slab(0.01, run - 0.01, 0.015, 0.03, z + PITCH - .004, z + PITCH, M["strip"])
    slab(-0.02, run + 0.02, -0.02, UD, top, top + 0.06, M["oak"], bev=.005)                     # cornice
    rows_done = 0
    for c in range(cols):
        for r in range(ROWS):
            u = FR + c * PITCH + CELL / 2
            cx, cy = P(u, 0.0)
            zf = PL + FR + r * PITCH
            mood = rnd.randrange(60)
            if highlight == (r, c):
                a = P(u - CELL / 2 - .012, -0.002); b2 = P(u + CELL / 2 + .012, -0.01)
                for (z0, z1) in [(zf - .012, zf), (zf + CELL, zf + CELL + .012)]:
                    box(min(a[0], b2[0]), min(a[1], b2[1]), z0, max(a[0], b2[0]), max(a[1], b2[1]), z1, M["sel"])
                for uu in (u - CELL / 2 - .012, u + CELL / 2):
                    a2 = P(uu, -0.002); b3 = P(uu + .012, -0.01)
                    box(min(a2[0], b3[0]), min(a2[1], b3[1]), zf, max(a2[0], b3[0]), max(a2[1], b3[1]), zf + CELL, M["sel"])
                pl = P(u, -0.004); mesh_obj(unit_cube(), (pl[0], pl[1] + 0.0, zf + CELL / 2), M["selplate"], scale=(.3, .004, .13))
                text("+ 우리 아이\n모시기", pl[0], pl[1] - .006, zf + CELL / 2 + .01, .04, M["white"])
            elif rnd.random() < fill[r]:
                decorate(cx, cy, zf, yaw, mood)
            if glass_doors:
                a = P(u - CELL / 2 + .004, -0.004); b2 = P(u + CELL / 2 - .004, -0.012)
                box(min(a[0], b2[0]), min(a[1], b2[1]), zf + .004, max(a[0], b2[0]), max(a[1], b2[1]), zf + CELL - .004, M["glass"])
                k = P(u + CELL / 2 - .04, -0.014); cyl(k[0], k[1], zf + .17, .008, .06, M["brass"], v=8)
    return run, top

# north wall: two banks of 14 columns either side of a central memorial niche (2.525 m)
NORTH_Y = D - UD                       # opening plane y = 5.61
BANK = 14 * PITCH + FR                 # 5.975
NICHE = 14 * PITCH * 2 + FR * 2        # whole run 14.475 like today's 34 columns
x_left = 7.11 - (2 * BANK + 2.525)
fill_rows = [0.35, 0.55, 0.75, 0.85, 0.8, 0.6, 0.4, 0.25]
cubby_bank(x_left, NORTH_Y, (1, 0), 14, 0.0, "lacquer", False, fill_rows, highlight=(3, 11))
niche_x0 = x_left + BANK; niche_x1 = niche_x0 + 2.525
cubby_bank(niche_x1, NORTH_Y, (1, 0), 14, 0.0, "lacquer", False, fill_rows)
# east wall: oak cubbies with glass doors, 18 columns from the north corner southwards
EAST_X = W - UD
cubby_bank(EAST_X, NORTH_Y, (0, -1), 18, math.pi / 2 * -1 + math.pi, "oak", True, [0.3, 0.5, 0.7, 0.8, 0.7, 0.5, 0.3, 0.2]) if False else None
cubby_bank(EAST_X, NORTH_Y, (0, -1), 18, -math.pi / 2, "oak", True, [0.3, 0.5, 0.7, 0.8, 0.7, 0.5, 0.3, 0.2])
# zone signs on the cornice
text("A 구역", x_left + BANK / 2, NORTH_Y - .03, 3.67, .11, M["brass"])
text("B 구역", niche_x1 + BANK / 2, NORTH_Y - .03, 3.67, .11, M["brass"])

# ---------------------------------------------------------------- memorial niche (기억의 자리)
nx0, nx1, top_n = niche_x0, niche_x1, 3.52
box(nx0, D - .05, 0, nx1, D, H, M["oak_l"])
for i in range(16):  # vertical oak slats on the niche back
    x = nx0 + .06 + i * (nx1 - nx0 - .12) / 15
    box(x - .025, D - .12, 0, x + .025, D - .05, 3.4, M["oak"])
# arch: spandrel box minus a cylinder
sp = box(nx0, NORTH_Y, 2.35, nx1, D - .12, top_n + .06, M["lacquer"], bevel=.004, name="spandrel")
cut = cyl((nx0 + nx1) / 2, (NORTH_Y + D) / 2, 0, 1.18, 1, M["lacquer"], v=64, name="archcut")
cut.rotation_euler = (math.pi / 2, 0, 0); cut.location = ((nx0 + nx1) / 2, (NORTH_Y + D) / 2, 2.35); cut.scale = (1.18, 1.18, 1.2)
bm_ = sp.modifiers.new("arch", "BOOLEAN"); bm_.object = cut; bm_.operation = "DIFFERENCE"; cut.hide_render = True; cut.hide_viewport = True
area_light("niche_light", ((nx0 + nx1) / 2, D - .4, 3.3), 1.6, 120, rot=(0, 0, 0))
# altar console with a big photo, chrysanthemums, LED candles
ac = (nx0 + nx1) / 2
box(ac - 1.0, D - .62, 0, ac + 1.0, D - .12, .78, M["walnut"], bevel=.01)
box(ac - 1.04, D - .66, .78, ac + 1.04, D - .08, .82, M["oak_l"], bevel=.006)
box(ac - .34, D - .3, .82, ac + .34, D - .25, 1.68, M["walnut"], bevel=.01)     # big frame
box(ac - .29, D - .315, .88, ac + .29, D - .30, 1.62, PHOTO[5])
text("기억의 자리", ac, NORTH_Y - .02, 3.0, .12, M["brass"])
for k in range(9):
    sph(ac - .5 + k * .125, D - .5, .86, .05, M["porcelain"] if k % 3 else FLOWER[2], sub=2)
    sph(ac - .45 + k * .11, D - .42, .9, .045, FLOWER[2], sub=2)
for k in range(5):
    x = ac - .85 + k * .07 if k < 3 else ac + .7 + (k - 3) * .08
    cyl(x, D - .55, .82, .025, .09 + .03 * (k % 2), M["porcelain"], v=12); sph(x, D - .55, .93 + .03 * (k % 2), .009, M["flame"], sub=1, sz=.016)
for s in (-1, 1):
    cyl(ac + s * .78, D - .35, .82, .06, .22, M["glass"], v=16)
    for k in range(6):
        sph(ac + s * .78 + .06 * math.cos(k), D - .35 + .06 * math.sin(k), 1.12 + .05 * (k % 3), .04, FLOWER[2], sub=1)
# kneeling step / flower tray
box(ac - .7, D - 1.05, 0, ac + .7, D - .75, .12, M["oak_l"], bevel=.01)

# ---------------------------------------------------------------- furniture builders
def bench(x, y, length, yaw_axis="x", back=False):
    # oak bench 0.42 deep, seat top 0.45, two slab legs
    if yaw_axis == "x":
        box(x - length / 2, y - .21, .40, x + length / 2, y + .21, .45, M["oak"], bevel=.01)
        for s in (-1, 1):
            box(x + s * (length / 2 - .2) - .03, y - .18, 0, x + s * (length / 2 - .2) + .03, y + .18, .40, M["walnut"])
    else:
        box(x - .21, y - length / 2, .40, x + .21, y + length / 2, .45, M["oak"], bevel=.01)
        for s in (-1, 1):
            box(x - .18, y + s * (length / 2 - .2) - .03, 0, x + .18, y + s * (length / 2 - .2) + .03, .40, M["walnut"])

def sofa_run(x0, y0, x1, y1, back_side, fabric, arms=(True, True)):
    """A sofa body between corners; back_side in 'N','S','E','W' is where the backrest is."""
    box(x0, y0, .08, x1, y1, .26, fabric, bevel=.03)                      # base
    for (a, b2, c, d) in [(x0 + .05, y0 + .05, x0 + .1, y0 + .1), (x1 - .1, y0 + .05, x1 - .05, y0 + .1), (x0 + .05, y1 - .1, x0 + .1, y1 - .05), (x1 - .1, y1 - .1, x1 - .05, y1 - .05)]:
        box(a, b2, 0, c, d, .08, M["walnut"])
    bt = .2
    if back_side == "S": box(x0, y0, .26, x1, y0 + bt, .82, fabric, bevel=.05); sx0, sy0, sx1, sy1 = x0, y0 + bt, x1, y1
    if back_side == "N": box(x0, y1 - bt, .26, x1, y1, .82, fabric, bevel=.05); sx0, sy0, sx1, sy1 = x0, y0, x1, y1 - bt
    if back_side == "W": box(x0, y0, .26, x0 + bt, y1, .82, fabric, bevel=.05); sx0, sy0, sx1, sy1 = x0 + bt, y0, x1, y1
    if back_side == "E": box(x1 - bt, y0, .26, x1, y1, .82, fabric, bevel=.05); sx0, sy0, sx1, sy1 = x0, y0, x1 - bt, y1
    return sx0, sy0, sx1, sy1

def cushions(sx0, sy0, sx1, sy1, n, axis, fabric):
    for i in range(n):
        if axis == "x":
            a = sx0 + (sx1 - sx0) * i / n; b2 = sx0 + (sx1 - sx0) * (i + 1) / n
            box(a + .01, sy0, .26, b2 - .01, sy1, .43, fabric, bevel=.045)
        else:
            a = sy0 + (sy1 - sy0) * i / n; b2 = sy0 + (sy1 - sy0) * (i + 1) / n
            box(sx0, a + .01, .26, sx1, b2 - .01, .43, fabric, bevel=.045)

def plant(x, y, h=1.6, pot_r=.22):
    cyl(x, y, 0, pot_r, .42, M["soil"], v=24)
    cyl(x, y, .42, .02, h * .55, M["trunk"], v=8)
    for k in range(9):
        a = k * 2.4; rr = .18 + .08 * (k % 3)
        sph(x + rr * math.cos(a), y + rr * math.sin(a), .42 + h * (.45 + .07 * (k % 4)), .2 + .04 * (k % 2), M["leaf"] if k % 2 else M["leaf2"], sub=2)

def chair(x, y, facing, m_seat=None):
    # dining/letter chair: seat 0.46, oak, padded seat; facing = (dx, dy)
    dx, dy = facing
    box(x - .23, y - .23, .42, x + .23, y + .23, .47, m_seat or M["fabric2"], bevel=.015)
    for (a, b2) in [(-.19, -.19), (.19, -.19), (-.19, .19), (.19, .19)]:
        box(x + a - .02, y + b2 - .02, 0, x + a + .02, y + b2 + .02, .42, M["oak"])
    bx, by = x - dx * .21, y - dy * .21
    if dx == 0: box(x - .22, by - .02, .5, x + .22, by + .02, .9, M["oak"], bevel=.01)
    else: box(bx - .02, y - .22, .5, bx + .02, y + .22, .9, M["oak"], bevel=.01)

def figure(x, y, facing_yaw, shirt, sit=False, seat_top=.45):
    """Chibi avatar stand-in: head top 2.16 m standing, ~1.0 m head."""
    c, s = math.cos(facing_yaw), math.sin(facing_yaw)
    fwd = (-s, c)
    if not sit:
        for side in (-1, 1):
            cyl(x + side * .12 * c, y + side * .12 * s, 0, .09, .5, M["pants"], v=12)
        mesh_obj(cyl_mesh(v=24), (x, y, .82), shirt, scale=(.3, .26, .65))
        hz = 1.66
    else:
        bx, by = x - fwd[0] * .15, y - fwd[1] * .15
        mesh_obj(cyl_mesh(v=24), (bx, by, seat_top + .32), shirt, scale=(.3, .26, .6))
        for side in (-1, 1):
            tx, ty = x + side * .12 * c + fwd[0] * .1, y + side * .12 * s + fwd[1] * .1
            mesh_obj(cyl_mesh(v=12), (tx, ty, seat_top + .08), M["pants"], rot=(math.pi / 2, 0, facing_yaw), scale=(.09, .09, .35))
            cyl(tx + fwd[0] * .14, ty + fwd[1] * .14, seat_top - .3, .085, .3, M["pants"], v=12)
        hz = seat_top + 1.12; x, y = bx, by
    sph(x, y, hz, .5, M["skin"], sub=3)
    sph(x - fwd[0] * .06, y - fwd[1] * .06, hz + .1, .52, M["hair"], sub=3, sz=.47)
    for side in (-1, 1):
        sph(x + fwd[0] * .44 + side * .16 * c, y + fwd[1] * .44 + side * .16 * s, hz - .02, .045, M["black"], sub=1)

# ---------------------------------------------------------------- centre: benches facing the niche
bench(ac - 1.45, 2.4, 2.2); bench(ac + 1.45, 2.4, 2.2)
bench(ac - 1.45, 0.9, 2.2); bench(ac + 1.45, 0.9, 2.2)
# runner rug down the aisle
box(ac - .6, -5.5, 0, ac + .6, 4.5, .008, M["rug"])

# east-wall bench (faces the oak cubbies) and a plant
bench(5.6, 1.8, 2.2, "y")
plant(5.9, -1.3, 1.5)

# ---------------------------------------------------------------- reception (south-east)
# L counter: front run along y at x 4.9..5.4, return along x at y -2.3
box(4.9, -5.4, 0, 5.4, -2.3, .98, M["oak_l"], bevel=.01)
for i in range(40):  # fluted front
    y = -5.38 + i * .077
    box(4.87, y, .05, 4.9, y + .05, .96, M["oak"])
box(4.85, -5.45, .98, 5.5, -2.25, 1.02, M["porcelain"], bevel=.006)
box(5.4, -5.4, 0, 6.6, -2.3, .74, M["oak_l"]); box(5.4, -5.4, .74, 6.6, -2.3, .76, M["porcelain"])
box(5.9, -3.9, .76, 6.3, -3.6, .78, M["black"]); box(5.95, -3.88, .78, 6.25, -3.85, 1.0, M["screen"])  # staff monitor
cyl(5.1, -2.7, 1.02, .05, .18, M["glass"], v=12)
for k in range(5): sph(5.1 + .04 * math.cos(k), -2.7 + .04 * math.sin(k), 1.24, .04, FLOWER[k % 3], sub=1)
box(5.0, -4.6, 1.02, 5.3, -4.3, 1.03, M["white"])  # guest book
# brand wall on the east wall behind the desk
box(W - .06, -5.8, 0, W, -2.25, 3.9, M["sage"])
for (x, y) in [(W - .1, -5.6), (W - .1, -2.45)]:
    box(x, y - .03, 1.4, x + .05, y + .03, 3.2, M["brass"])
text("케이슨 마을 추모관", W - .07, -4.02, 2.7, .34, M["brass"], rot=(math.pi / 2, 0, -math.pi / 2))
text("무지개다리 너머, 작은 마을", W - .07, -4.02, 2.25, .17, M["white"], rot=(math.pi / 2, 0, -math.pi / 2))
area_light("brandwash", (W - .9, -4.0, 4.1), 2.4, 60, rot=(math.radians(-35), 0, math.radians(-90)))
# search kiosk
box(3.6, -2.9, 0, 4.0, -2.6, .1, M["walnut"]); box(3.73, -2.8, .1, 3.87, -2.7, 1.05, M["walnut"])
k = box(3.5, -2.78, 1.0, 4.1, -2.72, 1.4, M["black"], bevel=.01); k.rotation_euler = (math.radians(-20), 0, 0)
s_ = box(3.53, -2.80, 1.03, 4.07, -2.785, 1.37, M["screen"]); s_.rotation_euler = (math.radians(-20), 0, 0)
text("이름으로 찾기", 3.8, -3.0, 1.33, .045, M["shirt"], rot=(math.radians(65), 0, 0))
# flower stand (free white chrysanthemums for 헌화) and a hall map on the south wall
box(1.9, -5.95, 0, 3.7, -5.45, .45, M["oak_l"], bevel=.01); box(1.9, -5.95, .45, 3.7, -5.7, .8, M["oak_l"], bevel=.01)
for k2 in range(3):
    bx2 = 2.2 + k2 * .6
    cyl(bx2, -5.55, .45, .12, .22, M["steel"], v=20); cyl(bx2, -5.83, .8, .1, .2, M["steel"], v=20)
    for j in range(9):
        a3 = j * .7
        sph(bx2 + .08 * math.cos(a3), -5.55 + .08 * math.sin(a3), .75 + .04 * (j % 3), .05, M["porcelain"] if j % 2 else FLOWER[2], sub=1)
        sph(bx2 + .07 * math.cos(a3), -5.83 + .07 * math.sin(a3), 1.08 + .04 * (j % 3), .045, FLOWER[[0, 1, 3][k2]], sub=1)
box(1.9, -5.97, 1.35, 3.7, -5.94, 2.45, M["sage"], bevel=.005)
text("안내도", 2.8, -5.935, 2.22, .12, M["brass"], rot=(math.pi / 2, 0, math.pi))
box(2.05, -5.94, 1.45, 3.55, -5.93, 2.1, M["fabric2"])
text("헌화용 꽃", 2.8, -5.44, .52, .07, M["walnut"], rot=(math.pi / 2, 0, math.pi))
# consultation chairs facing the desk
chair(4.2, -3.6, (1, 0), M["cushion_a"]); chair(4.2, -4.6, (1, 0), M["cushion_a"])

# ---------------------------------------------------------------- auto door (south), frame, mat
for s in (-1, 1):
    box(s * 1.1 - .06, -D - .2, 0, s * 1.1 + .06, -D + .02, 2.7, M["alu"])
box(-1.16, -D - .2, 2.62, 1.16, -D + .04, 2.95, M["alu"])
box(-.4, -D + .03, 2.66, .4, -D + .07, 2.76, M["black"])  # sensor housing
for s in (-1, 1):  # two leaves slid half open
    x0 = s * 0.55
    box(x0 - .55 + s * .45, -D - .12, 0, x0 + .55 + s * .45, -D - .08, 2.6, M["glass"])
    for (a, b2) in [(-.55, -.5), (.5, .55)]:
        box(x0 + s * .45 + a, -D - .13, 0, x0 + s * .45 + b2, -D - .07, 2.6, M["alu"])
    box(x0 - .55 + s * .45, -D - .13, 2.55, x0 + .55 + s * .45, -D - .07, 2.6, M["alu"])
    box(x0 - .55 + s * .45, -D - .13, 0, x0 + .55 + s * .45, -D - .07, .1, M["alu"])
box(-1.0, -5.9, 0, 1.0, -4.8, .012, M["pants"])  # entrance mat
text("케이슨 마을 추모관", 0, -D - .25, 3.15, .2, M["brass"], rot=(math.pi / 2, 0, 0))
# outside the door: forecourt
box(-12, -16, -.06, 12, -6.2, -0.01, M["tile_out"])
for (x, y) in [(-4, -10), (4.5, -11), (-8, -13), (8, -9)]:
    cyl(x, y, 0, .12, 2.2, M["trunk"], v=8); sph(x, y, 3.0, 1.3, M["leaf2"], sub=2)

# ---------------------------------------------------------------- family lounge (south-west)
# long sofa back to the south wall facing north, short return along the west wall below the window
sx = sofa_run(-7.3, -5.95, -4.2, -5.0, "S", M["fabric"])
cushions(*sx, 3, "x", M["fabric"])
sy = sofa_run(-7.3, -5.0, -6.35, -3.1, "W", M["fabric"])
cushions(*sy, 2, "y", M["fabric"])
box(-4.4, -5.95, .26, -4.2, -5.0, .62, M["fabric"], bevel=.04)       # arm
box(-7.3, -3.3, .26, -6.35, -3.1, .62, M["fabric"], bevel=.04)       # arm
for (x, y, m) in [(-6.9, -5.55, M["cushion_a"]), (-5.4, -5.55, M["cushion_b"]), (-6.9, -4.6, M["cushion_b"])]:
    box(x - .22, y - .08, .43, x + .22, y + .08, .82, m, bevel=.07)
box(-5.9, -5.6, .43, -5.0, -5.1, .46, M["cushion_a"])  # throw blanket
box(-7.4, -6.0, 0, -3.9, -2.4, .006, M["rug"])
box(-7.5, -6.0, 0, -4.0, -5.97, 2.9, M["sage"])
box(-6.4, -5.97, 1.25, -5.0, -5.94, 2.25, M["oak"], bevel=.005); box(-6.33, -5.94, 1.32, -5.07, -5.93, 2.18, PHOTO[9])
# coffee table (oak, rounded) and two lounge armchairs facing the sofa
cyl(-5.4, -3.85, .34, .55, .05, M["oak_l"], v=48); cyl(-5.4, -3.85, 0, .35, .34, M["walnut"], v=48)
box(-5.6, -3.95, .39, -5.35, -3.75, .48, M["white"])  # tissue box
cyl(-5.2, -3.8, .39, .04, .1, M["porcelain"], v=12); cyl(-5.1, -3.95, .39, .04, .1, M["porcelain"], v=12)  # cups
for x in (-5.8, -4.5):
    box(x - .38, -2.95, .18, x + .38, -2.25, .42, M["fabric2"], bevel=.06)
    box(x - .38, -2.45, .42, x + .38, -2.2, .85, M["fabric2"], bevel=.08)
    for s in (-1, 1): box(x + s * .38 - .08, -2.95, .18, x + s * .38 + .02 * s, -2.2, .62, M["fabric2"], bevel=.04)
    for (a, b2) in [(-.3, -2.85), (.3, -2.85), (-.3, -2.3), (.3, -2.3)]:
        cyl(x + a, b2, 0, .02, .18, M["walnut"], v=8)
# side table + lamp
cyl(-3.9, -5.6, 0, .22, .55, M["walnut"], v=24); cyl(-3.9, -5.6, .55, .03, .35, M["brass"], v=8)
cyl(-3.9, -5.6, .9, .16, .2, M["fabric2"], v=24); point_light((-3.9, -5.6, 1.0), 25)
plant(-7.05, -2.4, 1.7)
# tea corner on the south wall west of the door
box(-3.6, -5.95, 0, -1.5, -5.4, .88, M["oak_l"], bevel=.006); box(-3.62, -5.97, .88, -1.48, -5.38, .92, M["porcelain"])
box(-3.4, -5.85, .92, -3.05, -5.5, 1.3, M["black"], bevel=.01); box(-3.35, -5.52, 1.0, -3.1, -5.49, 1.15, M["steel"])  # coffee machine
box(-2.0, -5.9, .92, -1.65, -5.55, 1.4, M["white"], bevel=.02); cyl(-1.83, -5.72, 1.4, .1, .32, M["glass"], v=24)   # water dispenser
for k in range(4): cyl(-2.8 + k * .11, -5.62, .92, .04, .1, M["porcelain"], v=12)
for k in range(3): box(-3.6, -5.95, 1.55 + k * .36, -1.5, -5.7, 1.58 + k * .36, M["oak"])
for k in range(6): cyl(-3.4 + k * .3, -5.83, 1.58, .045, .1, M["porcelain"] if k % 2 else M["cushion_a"], v=12)
box(-2.9, -5.9, 1.94, -2.5, -5.7, 2.1, M["fabric2"], bevel=.02)   # folded blankets
box(-2.4, -5.9, 1.94, -2.0, -5.7, 2.05, M["cushion_b"], bevel=.02)
text("차 한 잔 하고 가세요", -2.55, -5.97 + .02, 2.6, .12, M["walnut"], rot=(math.pi / 2, 0, math.pi))
# garden outside the west window
box(-30, -20, -.06, -7.7, 20, -.01, M["grass"])
for (x, y, r) in [(-10, -4, 1.4), (-12.5, 0.5, 1.8), (-9.5, 2.5, 1.0), (-14, -6, 2.0), (-11, -8.5, 1.5)]:
    cyl(x, y, 0, .12, r * 1.6, M["trunk"], v=8); sph(x, y, r * 2.1, r, M["leaf"] if r > 1.4 else M["leaf2"], sub=2)
for k in range(8):
    box(-8.6 - k * .2, -3 + k * .7, -.01, -8.0 - k * .2, -2.6 + k * .7, .02, M["stone"])
for k in range(10):
    sph(-8.2 - rnd.uniform(0, 1.5), -5 + k * .6, .2, .25, FLOWER[k % 6] if k % 2 else M["leaf2"], sub=1)

# ---------------------------------------------------------------- letter table + mailbox (north-west)
box(-6.6, 2.55, .72, -4.6, 3.35, .76, M["oak_l"], bevel=.01)
for (a, b2) in [(-6.5, 2.65), (-4.7, 2.65), (-6.5, 3.25), (-4.7, 3.25)]:
    box(a - .03, b2 - .03, 0, a + .03, b2 + .03, .72, M["walnut"])
for x in (-6.1, -5.1):
    chair(x, 2.15, (0, 1)); chair(x, 3.75, (0, -1))
for k in range(3): box(-6.2 + k * .5, 2.85, .76, -5.95 + k * .5, 3.05, .765, M["white"])
box(-3.7, 3.2, 0, -3.3, 3.5, 1.1, M["mail"], bevel=.03); box(-3.62, 3.18, .85, -3.38, 3.19, .9, M["black"])
text("하늘 우체통", -3.5, 3.17, .62, .05, M["white"], rot=(math.pi / 2, 0, 0))
plant(-7.0, 1.2, 1.4)

# ---------------------------------------------------------------- people for scale
figure(5.95, -3.8, math.radians(90), M["shirt3"])          # guide behind the desk, facing west
figure(-4.3, 4.35, 0.0, M["shirt"])            # visitor at the A cubbies
figure(-5.6, -5.45, 0.0, M["shirt2"], sit=True, seat_top=.43)   # sitter on the sofa
figure(ac - 1.0, 2.35 + .45, 0.0, M["shirt3"], sit=True, seat_top=.45) if False else None

# ---------------------------------------------------------------- world, render
wd = bpy.data.worlds.new("w"); sc.world = wd; wd.use_nodes = True
bg = next(n for n in wd.node_tree.nodes if n.type == "BACKGROUND"); bg.inputs["Color"].default_value = (0.62, 0.76, 0.92, 1); bg.inputs["Strength"].default_value = 1.0
sun = bpy.data.lights.new("sun", "SUN"); sun.energy = 3.2; sun.color = (1, .93, .82); sun.angle = math.radians(2)
so = bpy.data.objects.new("sun", sun); so.rotation_euler = (math.radians(55), 0, math.radians(-115)); link(so)
area_light("window_fill", (-7.3, -2.3, 1.9), 3.0, 260, color=(.9, .95, 1), rot=(0, math.radians(90), 0), sx=5.4)
area_light("skylight", (ac, 3.95, H + .3), 2.5, 500, color=(.95, .97, 1), sx=3.0)
area_light("room_fill", (0, 0, H - .4), 8.0, 150, color=(1, .92, .8))
point_light((ac, 4.6, 1.2), 15, radius=.3)

r = sc.render
r.engine = "BLENDER_EEVEE"
r.resolution_x, r.resolution_y = (960, 540) if QUICK else (1600, 900)
ee = sc.eevee
for attr, val in [("taa_render_samples", 16 if QUICK else 64), ("use_raytracing", True), ("use_shadows", True), ("fast_gi_method", "GLOBAL_ILLUMINATION")]:
    try: setattr(ee, attr, val)
    except Exception as e: print("eevee", attr, e)
try: ee.ray_tracing_options.resolution_scale = "2"
except Exception: pass
try: sc.view_settings.view_transform = "AgX"; sc.view_settings.look = "AgX - Medium High Contrast"
except Exception: pass
sc.view_settings.exposure = 0.0

def cam(name, loc, target, lens=24, ortho=None):
    cd = bpy.data.cameras.new(name); cd.lens = lens; cd.clip_end = 200
    if ortho: cd.type = "ORTHO"; cd.ortho_scale = ortho
    o = bpy.data.objects.new(name, cd); o.location = loc; link(o)
    d = Vector(target) - Vector(loc); o.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return o

CAMS = {
    "entrance": dict(loc=(-2.6, 2.2, 1.9), target=(4.6, -4.2, 1.2), lens=20, exp=-0.6),
    "cubby": dict(loc=(-1.0, 3.25, 1.5), target=(-3.0, 5.6, 1.05), lens=28, exp=-0.5),
    "lounge": dict(loc=(-1.6, 0.4, 2.05), target=(-5.9, -4.4, 0.6), lens=20, exp=-0.6),
    "plan": dict(loc=(0, -.01, 40), target=(0, 0, 0), lens=50, ortho=16.5, exp=0.3),
}
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "mockup.blend"))
for v in VIEWS:
    c = CAMS[v]
    sc.camera = cam("cam_" + v, c["loc"], c["target"], c["lens"], c.get("ortho"))
    col_ceiling.hide_render = (v == "plan")
    sc.view_settings.exposure = c["exp"]
    if v == "plan": r.resolution_x, r.resolution_y = (1100, 900) if not QUICK else (660, 540)
    else: r.resolution_x, r.resolution_y = (960, 540) if QUICK else (1600, 900)
    r.filepath = os.path.join(OUT, f"render_{v}.png")
    bpy.ops.render.render(write_still=True)
    print("RENDERED", v, flush=True)
