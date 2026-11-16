"""Quick BLOCKOUT mockups for the houses-interior design (NOT the production build).

  blender -b --factory-startup -P docs/designs/houses-interior/mockup_rooms.py -- <out_dir> [samples]

Renders three sample rooms at Option-B scale (interior clear 10.6 x 7.8 m, ceiling 3.7 m, door 1.8 x 2.9 m) with a 2.16 m
chibi stand-in for scale:
  mock_h04_1f_ondol.png   house_4 1F  grandparents' ondol anbang (jangpan floor, mother-of-pearl wardrobe, low round table, cushions)
  mock_h01_1f_living.png  house_1 1F  modern living room (sofa, TV wall, oak strip floor, straight stair along the back wall)
  mock_h02_2f_kids.png    house_2 2F  kids' room (bunk bed, desk, toy shelf) next to the stairwell railing
Blender coords: X east, Y north, Z up. Room centre at the origin; the front door is on the south wall (-Y).
"""
import math
import os
import sys

import bpy

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = ARGV[0] if ARGV else os.path.dirname(os.path.abspath(__file__))
SAMPLES = int(ARGV[1]) if len(ARGV) > 1 else 96
HERE = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.normpath(os.path.join(HERE, "..", "..", "..", "art", "village", "downloads", "tex"))

W, D, H = 10.6, 7.8, 3.7          # interior clear width (x), depth (y), ceiling
X0, X1, Y0, Y1 = -W / 2, W / 2, -D / 2, D / 2
WALL = 0.30

# ---------------------------------------------------------------- helpers
MATS = {}


def mat(name, color, rough=0.6, metal=0.0, tex=None, scale=1.0, emit=None, emit_str=0.0, trans=0.0, coat=0.0, noise=0.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    if coat:
        p.inputs["Coat Weight"].default_value = coat
    if trans:
        p.inputs["Transmission Weight"].default_value = trans
    if emit:
        p.inputs["Emission Color"].default_value = (*emit, 1)
        p.inputs["Emission Strength"].default_value = emit_str
    if tex:
        tc = nt.nodes.new("ShaderNodeTexCoord")
        mp = nt.nodes.new("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (scale, scale, scale)
        im = nt.nodes.new("ShaderNodeTexImage")
        im.image = bpy.data.images.load(os.path.join(TEX, tex + "_diff_1k.jpg"))
        im.projection = "BOX"
        im.projection_blend = 0.2
        nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
        nt.links.new(mp.outputs["Vector"], im.inputs["Vector"])
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        mix.inputs[6].default_value = (*color, 1)
        nt.links.new(im.outputs["Color"], mix.inputs[7])
        nt.links.new(mix.outputs[2], p.inputs["Base Color"])
        nor = os.path.join(TEX, tex + "_nor_gl_1k.jpg")
        if os.path.exists(nor):
            ni = nt.nodes.new("ShaderNodeTexImage")
            ni.image = bpy.data.images.load(nor)
            ni.image.colorspace_settings.name = "Non-Color"
            ni.projection = "BOX"
            nt.links.new(mp.outputs["Vector"], ni.inputs["Vector"])
            nm = nt.nodes.new("ShaderNodeNormalMap")
            nm.inputs["Strength"].default_value = 0.6
            nt.links.new(ni.outputs["Color"], nm.inputs["Color"])
            nt.links.new(nm.outputs["Normal"], p.inputs["Normal"])
    elif noise:
        tc = nt.nodes.new("ShaderNodeTexCoord")
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = 40
        nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.inputs["Factor"].default_value = noise
        mix.inputs[6].default_value = (*color, 1)
        mix.inputs[7].default_value = (color[0] * 0.8, color[1] * 0.8, color[2] * 0.8, 1)
        nt.links.new(nz.outputs["Fac"], mix.inputs["Factor"])
        nt.links.new(mix.outputs[2], p.inputs["Base Color"])
    MATS[name] = m
    return m


def jangpan():
    """Oiled-paper floor (jangpan): warm yellow squares with thin seams, glossy."""
    if "jangpan" in MATS:
        return MATS["jangpan"]
    m = bpy.data.materials.new("jangpan")
    m.use_nodes = True
    nt = m.node_tree
    p = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    p.inputs["Roughness"].default_value = 0.22
    p.inputs["Coat Weight"].default_value = 0.35
    tc = nt.nodes.new("ShaderNodeTexCoord")
    br = nt.nodes.new("ShaderNodeTexBrick")
    br.offset = 0.0
    br.inputs["Color1"].default_value = (0.78, 0.55, 0.20, 1)
    br.inputs["Color2"].default_value = (0.74, 0.50, 0.17, 1)
    br.inputs["Mortar"].default_value = (0.55, 0.36, 0.12, 1)
    br.inputs["Scale"].default_value = 1.1
    br.inputs["Mortar Size"].default_value = 0.004
    br.inputs["Brick Width"].default_value = 0.9
    br.inputs["Row Height"].default_value = 0.9
    nt.links.new(tc.outputs["Object"], br.inputs["Vector"])
    nt.links.new(br.outputs["Color"], p.inputs["Base Color"])
    MATS["jangpan"] = m
    return m


def box(name, cx, cy, z0, sx, sy, sz, m, bevel=0.015, rot=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(cx, cy, z0 + sz / 2))
    o = bpy.context.object
    o.name = name
    o.scale = (sx, sy, sz)
    o.rotation_euler[2] = rot
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        b = o.modifiers.new("bev", "BEVEL")
        b.width = bevel
        b.segments = 3
        b.limit_method = "ANGLE"
    o.data.materials.append(m)
    bpy.ops.object.shade_smooth_by_angle() if hasattr(bpy.ops.object, "shade_smooth_by_angle") else None
    return o


def cyl(name, cx, cy, z0, r, h, m, verts=32, rot_x=0.0, rot_y=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h, location=(cx, cy, z0 + h / 2))
    o = bpy.context.object
    o.name = name
    o.rotation_euler = (rot_x, rot_y, 0)
    o.data.materials.append(m)
    bpy.ops.object.shade_smooth()
    return o


def cushion(name, cx, cy, z0, sx, sy, sz, m, rot=0.0):
    o = box(name, cx, cy, z0, sx, sy, sz, m, bevel=min(sx, sy, sz) * 0.45, rot=rot)
    o.modifiers["bev"].segments = 5
    return o


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()


def shell(floor_mat, wall_mat, ceiling=True, base_mat=None, door=True, windows=(), ceil_void=None):
    """Floor, 4 walls (south wall with the 1.8 x 2.9 door gap), ceiling, baseboards. windows: (wall, centre, width, sill, height)."""
    box("floor", 0, 0, -0.1, W + 2 * WALL, D + 2 * WALL, 0.1, floor_mat, bevel=0)
    if ceiling and not ceil_void:
        box("ceiling", 0, 0, H, W + 2 * WALL, D + 2 * WALL, 0.15, mat("ceil", (0.93, 0.92, 0.89), 0.9), bevel=0)
    elif ceiling:  # leave the stairwell open: ceiling minus the void rectangle (vx0, vx1, vy0, vy1)
        vx0, vx1, vy0, vy1 = ceil_void
        cm = mat("ceil", (0.93, 0.92, 0.89), 0.9)
        xa, xb, ya, yb = X0 - WALL, X1 + WALL, Y0 - WALL, Y1 + WALL
        box("ceil_s", 0, (ya + vy0) / 2, H, xb - xa, vy0 - ya, 0.15, cm, 0)
        if yb > vy1:
            box("ceil_n", 0, (vy1 + yb) / 2, H, xb - xa, yb - vy1, 0.15, cm, 0)
        box("ceil_w", (xa + vx0) / 2, (vy0 + vy1) / 2, H, vx0 - xa, vy1 - vy0, 0.15, cm, 0)
        box("ceil_e", (vx1 + xb) / 2, (vy0 + vy1) / 2, H, xb - vx1, vy1 - vy0, 0.15, cm, 0)
        box("well_lining", (vx0 + vx1) / 2, vy0, H - 0.3, vx1 - vx0, 0.05, 0.45, cm, 0)
    gaps = {"s": [], "n": [], "e": [], "w": []}
    if door:
        gaps["s"].append((0.0, 1.8, 0.0, 2.9))
    for wall, c, wd, sill, hh in windows:
        gaps[wall].append((c, wd, sill, hh))

    def wall_run(wall, length, place):
        # split the wall into solid pieces around its openings
        cuts = sorted(gaps[wall])
        x = -length / 2
        for c, wd, sill, hh in cuts:
            if c - wd / 2 > x:
                place(x, c - wd / 2, 0, H)
            if sill > 0:
                place(c - wd / 2, c + wd / 2, 0, sill)
            place(c - wd / 2, c + wd / 2, sill + hh, H)
            x = c + wd / 2
        if x < length / 2:
            place(x, length / 2, 0, H)

    def ns(y, wall):
        wall_run(wall, W, lambda a, b, z0, z1: box(f"wall_{wall}", (a + b) / 2, y, z0, b - a, WALL, z1 - z0, wall_mat, bevel=0))

    def ew(x, wall):
        wall_run(wall, D, lambda a, b, z0, z1: box(f"wall_{wall}", x, (a + b) / 2, z0, WALL, b - a, z1 - z0, wall_mat, bevel=0))

    ns(Y1 + WALL / 2, "n")
    ns(Y0 - WALL / 2, "s")
    ew(X1 + WALL / 2, "e")
    ew(X0 - WALL / 2, "w")
    bm = base_mat or mat("base", (0.35, 0.22, 0.13), 0.5)
    box("base_n", 0, Y1 - 0.01, 0, W, 0.025, 0.09, bm, bevel=0.004)
    box("base_e", X1 - 0.01, 0, 0, 0.025, D, 0.09, bm, bevel=0.004)
    box("base_w", X0 + 0.01, 0, 0, 0.025, D, 0.09, bm, bevel=0.004)
    # crown moulding
    box("crown_n", 0, Y1 - 0.02, H - 0.07, W, 0.04, 0.07, bm, bevel=0.006)
    box("crown_e", X1 - 0.02, 0, H - 0.07, 0.04, D, 0.07, bm, bevel=0.006)
    box("crown_w", X0 + 0.02, 0, H - 0.07, 0.04, D, 0.07, bm, bevel=0.006)
    return gaps


def window_frame(wall, c, wd, sill, hh, frame_mat, lattice=None, sky=(0.75, 0.85, 1.0), sky_str=2.5, glass=True):
    """Window: frame, sill, mullion, glass, and a bright 'outside' plane behind (mockup only)."""
    t = 0.07
    if wall in ("e", "w"):
        x = X1 if wall == "e" else X0
        sgn = 1 if wall == "e" else -1
        box("win_top", x, c, sill + hh - t, 0.12, wd, t, frame_mat, 0.005)
        box("win_bot", x, c, sill, 0.12, wd, t, frame_mat, 0.005)
        box("win_l", x, c - wd / 2 + t / 2, sill, 0.12, t, hh, frame_mat, 0.005)
        box("win_r", x, c + wd / 2 - t / 2, sill, 0.12, t, hh, frame_mat, 0.005)
        box("win_mid", x, c, sill, 0.10, 0.05, hh, frame_mat, 0.005)
        box("sill", x - sgn * 0.08, c, sill - 0.04, 0.22, wd + 0.12, 0.04, mat("stone_sill", (0.85, 0.83, 0.8), 0.4), 0.006)
        if lattice:
            n = 6
            for i in range(1, n):
                box("lat_v", x - sgn * 0.02, c - wd / 2 + wd * i / n, sill, 0.03, 0.025, hh, frame_mat, 0)
            for j in range(1, 8):
                box("lat_h", x - sgn * 0.02, c, sill + hh * j / 8, 0.03, wd, 0.025, frame_mat, 0)
            box("hanji", x + sgn * 0.01, c, sill, 0.01, wd, hh, lattice, 0)
        elif glass:
            box("glass", x, c, sill, 0.01, wd, hh, mat("glass", (0.9, 0.95, 1.0), 0.02, trans=1.0), 0)
        box("outside", x + sgn * 1.5, c, sill - 0.6, 0.05, wd + 3, hh + 1.5, mat("sky", sky, 1.0, emit=sky, emit_str=sky_str), 0)
    else:
        y = Y1 if wall == "n" else Y0
        sgn = 1 if wall == "n" else -1
        box("win_top", c, y, sill + hh - t, wd, 0.12, t, frame_mat, 0.005)
        box("win_bot", c, y, sill, wd, 0.12, t, frame_mat, 0.005)
        box("win_l", c - wd / 2 + t / 2, y, sill, t, 0.12, hh, frame_mat, 0.005)
        box("win_r", c + wd / 2 - t / 2, y, sill, t, 0.12, hh, frame_mat, 0.005)
        box("win_mid", c, y, sill, 0.05, 0.10, hh, frame_mat, 0.005)
        box("sill", c, y - sgn * 0.08, sill - 0.04, wd + 0.12, 0.22, 0.04, mat("stone_sill", (0.85, 0.83, 0.8), 0.4), 0.006)
        box("glass", c, y, sill, wd, 0.01, hh, mat("glass", (0.9, 0.95, 1.0), 0.02, trans=1.0), 0)
        box("outside", c, y + sgn * 1.5, sill - 0.6, wd + 3, 0.05, hh + 1.5, mat("sky", sky, 1.0, emit=sky, emit_str=sky_str), 0)


def avatar(x, y, rot=0.0, shirt=(0.85, 0.35, 0.3)):
    """2.16 m chibi stand-in: big head (1.0 m), short body. Scale reference only."""
    skin = mat("skin", (0.95, 0.78, 0.66), 0.5)
    hair = mat("hair", (0.18, 0.11, 0.07), 0.45)
    cl = mat("shirt", shirt, 0.7)
    pants = mat("pants", (0.2, 0.25, 0.4), 0.7)
    for s in (-1, 1):
        cyl("leg", x + s * 0.13, y, 0.0, 0.11, 0.42, pants)
    cyl("body", x, y, 0.40, 0.30, 0.62, cl)
    for s in (-1, 1):
        cyl("arm", x + s * 0.38, y, 0.55, 0.08, 0.45, skin)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.56, location=(x, y, 1.58), segments=48, ring_count=24)
    h = bpy.context.object
    h.scale = (1.0, 0.92, 1.0)
    h.data.materials.append(skin)
    bpy.ops.object.shade_smooth()
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.6, location=(x, y + 0.05, 1.70), segments=48, ring_count=24)
    hh = bpy.context.object
    hh.scale = (1.02, 0.95, 0.80)
    hh.data.materials.append(hair)
    bpy.ops.object.shade_smooth()


def sun(rot=(math.radians(50), 0, math.radians(-60)), strength=3.0, color=(1.0, 0.95, 0.85)):
    bpy.ops.object.light_add(type="SUN", rotation=rot)
    l = bpy.context.object
    l.data.energy = strength
    l.data.color = color
    l.data.angle = math.radians(2)


def area_light(x, y, z, size, power, color=(1.0, 0.93, 0.82)):
    bpy.ops.object.light_add(type="AREA", location=(x, y, z))
    l = bpy.context.object
    l.data.size = size
    l.data.energy = power
    l.data.color = color


def point_light(x, y, z, power, color=(1.0, 0.8, 0.55), r=0.05):
    bpy.ops.object.light_add(type="POINT", location=(x, y, z))
    l = bpy.context.object
    l.data.energy = power
    l.data.color = color
    l.data.shadow_soft_size = r


def camera(loc, look, lens=20):
    bpy.ops.object.camera_add(location=loc)
    c = bpy.context.object
    d = [look[i] - loc[i] for i in range(3)]
    c.rotation_euler = (math.atan2(math.hypot(d[0], d[1]), -d[2]), 0, math.atan2(d[1], d[0]) - math.pi / 2)
    c.data.lens = lens
    bpy.context.scene.camera = c


def world(color=(0.55, 0.62, 0.72), strength=0.35):
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (*color, 1)
    bg.inputs["Strength"].default_value = strength
    bpy.context.scene.world = w


def render(name):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for dev_type in ("OPTIX", "CUDA"):
            try:
                prefs.compute_device_type = dev_type
                prefs.get_devices()
                if any(d.type == dev_type for d in prefs.devices):
                    for d in prefs.devices:
                        d.use = d.type == dev_type
                    sc.cycles.device = "GPU"
                    break
            except TypeError:
                continue
    except Exception as e:  # CPU fallback
        print("GPU setup failed:", e)
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 1600, 900
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Medium High Contrast" if "AgX - Medium High Contrast" in [
        i.identifier for i in bpy.types.ColorManagedViewSettings.bl_rna.properties["look"].enum_items] else "None"
    sc.render.filepath = os.path.join(OUT, name)
    bpy.ops.render.render(write_still=True)
    print("WROTE", sc.render.filepath)


# ---------------------------------------------------------------- scene A: house_4 1F ondol anbang
def scene_ondol():
    clear()
    wallpaper = mat("wallpaper_cream", (0.90, 0.85, 0.74), 0.85, noise=0.15)
    hanji = mat("hanji", (0.97, 0.94, 0.86), 0.9, emit=(1.0, 0.95, 0.85), emit_str=0.9, trans=0.3)
    wood_dark = mat("wood_dark", (0.42, 0.25, 0.13), 0.45, tex="wood_planks", scale=1.5)
    shell(jangpan(), wallpaper, base_mat=wood_dark, windows=[("w", 0.6, 2.4, 0.75, 1.8), ("n", 2.6, 2.0, 1.0, 1.6)])
    window_frame("w", 0.6, 2.4, 0.75, 1.8, wood_dark, lattice=hanji, sky=(1.0, 0.95, 0.85), sky_str=4)
    window_frame("n", 2.6, 2.0, 1.0, 1.6, mat("pvc_brown", (0.30, 0.2, 0.13), 0.4), sky=(0.7, 0.82, 0.95), sky_str=2)
    # partition between anbang (west) and kitchen (east) with a wide 2.2 m opening and a wood frame
    part = mat("wallpaper_cream", (0.90, 0.85, 0.74))
    box("part_a", 1.2, -2.6, 0, 0.18, 2.6, H, part, 0)
    box("part_b", 1.2, 2.35, 0, 0.18, 3.1, H, part, 0)
    box("part_head", 1.2, -0.2, 2.9, 0.18, 2.2, H - 2.9, part, 0)
    box("jamb_l", 1.2, -1.32, 0, 0.24, 0.06, 2.9, wood_dark, 0.005)
    box("jamb_r", 1.2, 0.92, 0, 0.24, 0.06, 2.9, wood_dark, 0.005)
    box("lintel", 1.2, -0.2, 2.9, 0.24, 2.3, 0.08, wood_dark, 0.005)
    # mother-of-pearl wardrobe (jagaejang) on the north wall
    lac = mat("lacquer_black", (0.02, 0.02, 0.025), 0.15, coat=0.8)
    pearl = mat("pearl", (0.85, 0.88, 0.9), 0.15, metal=0.3, coat=1.0, noise=0.4)
    brass = mat("brass", (0.8, 0.6, 0.3), 0.3, metal=1.0)
    jx, jy = -2.4, Y1 - 0.34
    box("jagae_body", jx, jy, 0.12, 2.6, 0.62, 2.05, lac, 0.02)
    box("jagae_base", jx, jy, 0.0, 2.7, 0.66, 0.12, lac, 0.01)
    box("jagae_crown", jx, jy, 2.17, 2.75, 0.68, 0.08, lac, 0.01)
    for i in range(4):
        dx = jx - 0.975 + i * 0.65
        box("door_panel", dx, jy - 0.315, 0.75, 0.56, 0.02, 1.32, lac, 0.006)
        bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.2, depth=0.01, location=(dx, jy - 0.33, 1.4), rotation=(math.pi / 2, 0, 0))
        e = bpy.context.object
        e.scale = (1.0, 1.7, 1.0)
        e.data.materials.append(pearl)
        cyl("knob", dx + (0.22 if i % 2 == 0 else -0.22), jy - 0.34, 1.35, 0.025, 0.12, brass)
        for k in range(3):
            box("drawer", dx, jy - 0.315, 0.16 + k * 0.19, 0.56, 0.02, 0.16, lac, 0.005)
            cyl("dknob", dx, jy - 0.34, 0.22 + k * 0.19, 0.018, 0.02, brass, rot_x=math.pi / 2)
    # bedding stack (ibul) on the wardrobe's side
    for k, colr in enumerate([(0.75, 0.25, 0.3), (0.25, 0.45, 0.65), (0.9, 0.75, 0.35), (0.4, 0.6, 0.35), (0.85, 0.85, 0.82)]):
        cushion("ibul", -4.55, Y1 - 0.55, 0.02 + k * 0.17, 1.05, 0.75, 0.18, mat(f"silk{k}", colr, 0.45, coat=0.2))
    # boryo + anseok (backed floor seat) along the west wall
    green = mat("silk_green", (0.25, 0.42, 0.28), 0.4, coat=0.3)
    red = mat("silk_red", (0.62, 0.12, 0.12), 0.4, coat=0.3)
    cushion("boryo", X0 + 0.68, -1.9, 0.0, 0.95, 2.1, 0.16, green)
    cushion("anseok", X0 + 0.32, -1.9, 0.12, 0.28, 0.95, 0.75, red)
    cyl("jangchim", X0 + 0.68, -2.8, 0.18, 0.12, 0.6, red, rot_x=0, rot_y=math.pi / 2)
    # low round table (dure-sang) and cushions (bangseok)
    tw = mat("table_wood", (0.45, 0.26, 0.12), 0.35, tex="wood_planks", scale=2.0, coat=0.4)
    tx, ty = -1.7, -0.4
    cyl("dure_top", tx, ty, 0.36, 0.62, 0.04, tw, verts=64)
    cyl("dure_apron", tx, ty, 0.30, 0.56, 0.06, tw, verts=64)
    for a in range(4):
        ang = a * math.pi / 2 + math.pi / 4
        box("dure_leg", tx + 0.42 * math.cos(ang), ty + 0.42 * math.sin(ang), 0.0, 0.06, 0.06, 0.30, tw, 0.008)
    # dishes on the table
    bowl = mat("ceramic", (0.92, 0.92, 0.9), 0.15, coat=0.6)
    for a in range(5):
        ang = a * 2 * math.pi / 5
        cyl("bowl", tx + 0.35 * math.cos(ang), ty + 0.35 * math.sin(ang), 0.40, 0.08, 0.05, bowl)
    cyl("pot", tx, ty, 0.40, 0.13, 0.11, mat("ttukbaegi", (0.28, 0.16, 0.1), 0.6))
    for k, (dx, dy) in enumerate([(0, 1.05), (0, -1.05), (1.05, 0), (-1.05, 0)]):
        cushion("bangseok", tx + dx, ty + dy, 0.0, 0.66, 0.66, 0.10, mat(f"bs{k}", [(0.7, 0.2, 0.25), (0.25, 0.35, 0.6), (0.75, 0.55, 0.2), (0.3, 0.5, 0.35)][k], 0.4, coat=0.2))
    # low TV cabinet + generic TV (no logo) on the south wall, west of the door
    tvc = mat("cab_walnut", (0.35, 0.2, 0.1), 0.4, tex="wood_planks", scale=2)
    box("tv_cab", -3.5, Y0 + 0.3, 0.0, 1.9, 0.5, 0.5, tvc, 0.012)
    box("tv", -3.5, Y0 + 0.3, 0.55, 1.35, 0.08, 0.8, mat("tv_black", (0.01, 0.01, 0.012), 0.1, coat=1.0), 0.01)
    box("tv_stand", -3.5, Y0 + 0.3, 0.5, 0.3, 0.2, 0.05, mat("metal_dark", (0.1, 0.1, 0.1), 0.3, 0.8), 0.005)
    # folding screen (byeongpung): 8 panels, zig-zag, painted silk panels in lacquered frames
    for k in range(7):
        py = -3.55 + k * 0.40
        off = 0.06 if k % 2 else 0.0
        box("bp_frame", X0 + 0.06 + off, py, 0.0, 0.04, 0.40, 1.5, wood_dark, 0.006)
        box("bp_silk", X0 + 0.085 + off, py, 0.12, 0.01, 0.32, 1.25, mat(f"bp{k%3}", [(0.92, 0.88, 0.78), (0.9, 0.86, 0.74), (0.93, 0.9, 0.8)][k % 3], 0.8, noise=0.5), 0)
    # wall clock + family photos
    cyl("clock", -1.7, Y1 - 0.03, 2.75, 0.22, 0.05, mat("clock_wood", (0.4, 0.25, 0.12), 0.4), rot_x=math.pi / 2)
    cyl("clock_face", -1.7, Y1 - 0.06, 2.75, 0.18, 0.01, mat("clock_face", (0.95, 0.93, 0.88), 0.3), rot_x=math.pi / 2)
    for k, (fx, fz, fw, fh) in enumerate([(-0.5, 2.5, 0.55, 0.7), (0.2, 2.6, 0.45, 0.55)]):
        box("frame", fx, Y1 - 0.03, fz, fw, 0.04, fh, mat("frame_gold", (0.7, 0.55, 0.3), 0.3, 0.8), 0.006)
        box("photo", fx, Y1 - 0.055, fz + 0.05, fw - 0.1, 0.01, fh - 0.1, mat(f"photo{k}", (0.55, 0.6, 0.5), 0.6, noise=0.7), 0)
    # kitchen glimpse through the opening (east part)
    sink = mat("cab_cream", (0.88, 0.84, 0.75), 0.4)
    top = mat("counter", (0.55, 0.5, 0.45), 0.3, noise=0.3)
    box("k_base", 3.3, Y1 - 0.33, 0, 3.6, 0.62, 0.86, sink, 0.01)
    box("k_top", 3.3, Y1 - 0.33, 0.86, 3.65, 0.66, 0.04, top, 0.006)
    box("k_upper", 3.3, Y1 - 0.2, 1.75, 3.6, 0.36, 0.75, sink, 0.01)
    box("fridge", X1 - 0.45, 1.2, 0, 0.85, 0.75, 2.0, mat("fridge", (0.85, 0.86, 0.86), 0.25, 0.3), 0.03)
    box("k_table", 3.3, -0.4, 0.72, 1.6, 0.9, 0.05, tw, 0.01)
    for sx in (-0.6, 0.6):
        for sy in (-0.35, 0.35):
            box("k_leg", 3.3 + sx, -0.4 + sy, 0, 0.06, 0.06, 0.72, tw, 0.005)
    # ceiling: round LED fixture + a few ceiling 'banja' battens
    cyl("ceil_led", -1.7, 0, H - 0.08, 0.45, 0.08, mat("led", (1, 1, 1), 0.5, emit=(1.0, 0.96, 0.9), emit_str=6))
    cyl("ceil_led2", 3.3, 0, H - 0.08, 0.35, 0.08, MATS["led"])
    avatar(-0.2, 1.5, shirt=(0.35, 0.55, 0.75))
    world((0.8, 0.85, 0.9), 0.25)
    sun(rot=(math.radians(60), 0, math.radians(-100)), strength=3.5)
    area_light(-1.7, 0, H - 0.2, 1.0, 120)
    area_light(3.3, 0, H - 0.2, 0.8, 60)
    camera((0.7, -3.55, 2.7), (-3.4, 1.6, 0.5), lens=15)
    render("mock_h04_1f_ondol.png")


# ---------------------------------------------------------------- scene B: house_1 1F modern living + stair
def scene_living():
    clear()
    oak = mat("oak_floor", (1.45, 1.15, 0.85), 0.35, tex="wood_planks", scale=0.8, coat=0.15)
    paint = mat("paint_white", (0.93, 0.92, 0.89), 0.85, noise=0.05)
    shell(oak, paint, base_mat=mat("base_white", (0.95, 0.95, 0.93), 0.5),
          windows=[("w", -0.3, 3.2, 0.5, 2.3), ("s", -3.2, 1.8, 0.9, 1.8)], ceil_void=(-1.75, 3.9, Y1 - 1.35, Y1))
    window_frame("w", -0.3, 3.2, 0.5, 2.3, mat("frame_charcoal", (0.12, 0.12, 0.13), 0.4), sky=(0.75, 0.88, 1.0), sky_str=3)
    window_frame("s", -3.2, 1.8, 0.9, 1.8, MATS["frame_charcoal"], sky=(0.75, 0.88, 1.0), sky_str=3)
    # sheer curtains
    sheer = mat("sheer", (0.97, 0.96, 0.93), 0.9, trans=0.6)
    for k in range(9):
        box("sheer_fold", X0 + 0.18, -1.95 + k * 0.42, 0.05, 0.05, 0.22, 3.4, sheer, 0.02)
    box("rail", X0 + 0.18, -0.3, 3.45, 0.04, 3.9, 0.04, MATS["frame_charcoal"], 0)
    # straight stair along the north wall, rising east -> west: 17 risers x 0.235, 16 treads x 0.34, 1.3 m wide
    tread = mat("oak_tread", (0.72, 0.52, 0.32), 0.35, tex="wood_planks", scale=1.2, coat=0.2)
    sx0 = 3.9                                   # first riser at x = 3.9, run toward -x
    for i in range(17):
        z = (i + 1) * 0.235
        x = sx0 - i * 0.34
        box("tread", x - 0.17, Y1 - 0.65, z - 0.045, 0.36, 1.3, 0.045, tread, 0.006)
        box("riser", x - 0.02, Y1 - 0.65, z - 0.235, 0.025, 1.26, 0.19, mat("riser_white", (0.94, 0.94, 0.92), 0.6), 0.003)
    # stringer + glass and steel railing on the open side
    steel = mat("steel_black", (0.06, 0.06, 0.065), 0.35, 0.9)
    L = 16 * 0.34
    st = box("stringer", sx0 - L / 2 - 0.17, Y1 - 1.32, 0.0, L + 0.6, 0.05, 0.3, paint, 0)
    st.rotation_euler[1] = math.atan2(4.0, L)
    st.location.z = 2.0
    for i in range(0, 17, 4):
        x = sx0 - i * 0.34 - 0.17
        z = (i + 1) * 0.235
        box("baluster", x, Y1 - 1.28, z, 0.04, 0.04, 1.05, steel, 0.004)
    hr = box("handrail", sx0 - L / 2 - 0.17, Y1 - 1.28, 0, L + 0.4, 0.05, 0.05, steel, 0.01)
    hr.rotation_euler[1] = math.atan2(4.0, L)
    hr.location.z = 3.05
    # TV wall: slatted oak low cabinet + generic screen (no logo)
    slat = mat("oak_slat", (0.66, 0.46, 0.28), 0.4, tex="wood_planks", scale=2)
    box("tv_cab", 1.0, Y0 + 0.28, 0.12, 3.2, 0.45, 0.42, slat, 0.01)
    for k in range(30):
        box("slat", 1.0 - 1.55 + k * 0.107, Y0 + 0.50, 0.14, 0.05, 0.02, 0.38, slat, 0.003)
    box("tv", 1.0, Y0 + 0.06, 1.15, 1.9, 0.05, 1.08, mat("tv_black", (0.01, 0.01, 0.012), 0.1, coat=1.0), 0.008)
    # sofa (2 seats @ 1.2 m + chaise), seat 0.45, back 0.88
    fab = mat("fabric_grey", (0.62, 0.6, 0.56), 0.95, noise=0.2)
    sxc, syc = 1.0, 1.6
    box("sofa_base", sxc, syc, 0.12, 3.0, 1.0, 0.24, fab, 0.04)
    for k in (-0.75, 0.75):
        cushion("seat", sxc + k, syc - 0.05, 0.34, 1.45, 0.88, 0.13, fab)
        cushion("back", sxc + k, syc + 0.38, 0.40, 1.42, 0.26, 0.52, fab)
    cushion("arm_l", sxc - 1.62, syc, 0.12, 0.26, 1.0, 0.52, fab)
    cushion("arm_r", sxc + 1.62, syc, 0.12, 0.26, 1.0, 0.52, fab)
    for dx in (-1.4, 1.4):
        for dy in (-0.4, 0.4):
            cyl("sofa_foot", sxc + dx, syc + dy, 0, 0.03, 0.12, MATS["steel_black"])
    cushion("pillow", sxc - 1.15, syc + 0.18, 0.5, 0.5, 0.18, 0.45, mat("pillow_mustard", (0.78, 0.58, 0.22), 0.9))
    cushion("pillow2", sxc + 1.1, syc + 0.18, 0.5, 0.5, 0.18, 0.45, mat("pillow_teal", (0.2, 0.45, 0.48), 0.9))
    # rug + coffee table
    box("rug", 1.0, -0.4, 0.0, 3.6, 2.4, 0.015, mat("rug", (0.82, 0.78, 0.7), 1.0, noise=0.3), 0.005)
    tw = mat("walnut", (0.35, 0.2, 0.1), 0.3, tex="wood_planks", scale=2, coat=0.3)
    cyl("coffee", 1.0, -0.2, 0.36, 0.55, 0.05, tw, verts=64)
    cyl("coffee_base", 1.0, -0.2, 0.0, 0.3, 0.36, tw, verts=48)
    # armchair (backed) facing the TV on the east side
    cushion("arm_seat", 3.7, -0.2, 0.3, 0.95, 0.9, 0.16, mat("fabric_olive", (0.42, 0.45, 0.3), 0.9))
    cushion("arm_back", 4.1, -0.2, 0.42, 0.22, 0.9, 0.55, MATS["fabric_olive"], rot=0)
    for dy in (-0.4, 0.4):
        box("arm_side", 3.7, -0.2 + dy, 0.2, 0.9, 0.08, 0.45, tw, 0.01)
    # floor lamp + plant
    cyl("lamp_pole", -1.0, 1.9, 0, 0.02, 1.7, MATS["steel_black"])
    cyl("lamp_shade", -1.0, 1.9, 1.62, 0.22, 0.3, mat("shade", (0.95, 0.92, 0.85), 0.8, emit=(1, 0.85, 0.6), emit_str=2))
    cyl("pot", -4.6, -3.3, 0, 0.28, 0.5, mat("terracotta", (0.6, 0.32, 0.2), 0.8))
    for k in range(9):
        a = k * 0.7
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.28, location=(-4.6 + 0.25 * math.cos(a), -3.3 + 0.25 * math.sin(a), 0.9 + 0.12 * k))
        lf = bpy.context.object
        lf.scale = (1.0, 0.45, 0.12)
        lf.rotation_euler = (0.5, 0.3, a)
        lf.data.materials.append(mat("leaf", (0.15, 0.35, 0.12), 0.5))
    avatar(-1.2, -0.8, shirt=(0.9, 0.55, 0.6))
    cyl("downlight", 1.0, 0.5, H - 0.02, 0.08, 0.02, mat("led", (1, 1, 1), 0.5, emit=(1.0, 0.95, 0.88), emit_str=8))
    world((0.8, 0.86, 0.95), 0.3)
    sun(rot=(math.radians(55), 0, math.radians(-110)), strength=4.0)
    area_light(1.0, 0.5, H - 0.1, 2.0, 160)
    camera((4.6, -3.4, 2.7), (-2.2, 2.2, 1.0), lens=16)
    render("mock_h01_1f_living.png")


# ---------------------------------------------------------------- scene C: house_2 2F kids' room
def scene_kids():
    clear()
    floor = mat("oak_light", (1.5, 1.35, 1.15), 0.35, tex="wood_planks", scale=0.8, coat=0.15)
    paper = mat("wallpaper_mint", (0.80, 0.90, 0.86), 0.85, noise=0.1)
    shell(floor, paper, base_mat=mat("base_white", (0.95, 0.95, 0.93), 0.5), door=False,
          windows=[("e", 0.6, 2.0, 0.9, 1.8), ("n", -2.6, 1.6, 1.1, 1.5)])
    window_frame("e", 0.6, 2.0, 0.9, 1.8, mat("pvc_white", (0.95, 0.95, 0.95), 0.4), sky=(0.75, 0.88, 1.0), sky_str=3)
    window_frame("n", -2.6, 1.6, 1.1, 1.5, MATS["pvc_white"], sky=(0.75, 0.88, 1.0), sky_str=3)
    # stairwell void with railing on the west side (house_2 stair runs along the west wall)
    rail = mat("rail_white", (0.95, 0.95, 0.94), 0.4)
    box("void_floor", X0 + 0.65, -0.9, -0.12, 1.3, 5.5, 0.13, mat("void", (0.05, 0.05, 0.05), 1), 0)
    box("rail_top", X0 + 1.35, -0.9, 1.05, 0.06, 5.5, 0.06, MATS["oak_light"], 0.01)
    for k in range(23):
        box("spindle", X0 + 1.35, -3.6 + k * 0.245, 0, 0.035, 0.035, 1.05, rail, 0.004)
    # partition: kids room is the east 6 m; open doorway 1.6 m to the landing
    box("part_1", 0.4, 2.35, 0, 0.16, 3.1, H, paper, 0)
    box("part_2", 0.4, -2.75, 0, 0.16, 2.3, H, paper, 0)
    box("part_head", 0.4, -0.4, 2.9, 0.16, 2.4, H - 2.9, paper, 0)
    # bunk bed (pine), ladder, guard rails, mattresses
    pine = mat("pine", (0.86, 0.7, 0.5), 0.5, tex="wood_planks", scale=2.5)
    bx, by = 3.85, Y1 - 0.72
    L, Wd = 2.7, 1.3
    for dx in (-L / 2, L / 2):
        for dy in (-Wd / 2, Wd / 2):
            box("post", bx + dx, by + dy, 0, 0.1, 0.1, 2.85, pine, 0.012)
    for z in (0.32, 1.75):
        box("frame_long", bx, by - Wd / 2, z, L, 0.05, 0.14, pine, 0.006)
        box("frame_long2", bx, by + Wd / 2, z, L, 0.05, 0.14, pine, 0.006)
        cushion("mattress", bx, by, z + 0.1, L - 0.08, Wd - 0.08, 0.18, mat("mattress", (0.95, 0.95, 0.95), 0.9))
        cushion("duvet", bx + 0.25, by, z + 0.26, L - 0.6, Wd - 0.06, 0.08, mat("duvet_star", (0.4, 0.55, 0.85), 0.9, noise=0.3))
        cushion("pillow", bx - L / 2 + 0.35, by, z + 0.28, 0.45, 0.7, 0.14, mat("pillow_y", (0.98, 0.85, 0.4), 0.9))
    for k in range(4):
        box("guard", bx + 0.1, by - Wd / 2, 2.05 + k * 0.17, L - 0.6, 0.04, 0.05, pine, 0.005)
    for k in range(6):
        box("rung", bx - L / 2 + 0.35, by - Wd / 2 - 0.25 + 0.0, 0.3 + k * 0.33, 0.42, 0.05, 0.05, pine, 0.005)
    for dx in (-0.21, 0.21):
        box("lad_side", bx - L / 2 + 0.35 + dx, by - Wd / 2 - 0.25, 0, 0.05, 0.05, 2.2, pine, 0.005)
    # desk + backed chair under the window
    wht = mat("desk_white", (0.95, 0.95, 0.94), 0.4)
    box("desk_top", X1 - 0.4, 0.6, 0.74, 0.7, 1.6, 0.04, pine, 0.006)
    box("desk_ped", X1 - 0.4, 1.2, 0, 0.68, 0.4, 0.74, wht, 0.01)
    box("desk_leg", X1 - 0.4, -0.15, 0, 0.6, 0.04, 0.74, wht, 0.004)
    chair = mat("chair_coral", (0.95, 0.5, 0.42), 0.5)
    box("chair_seat", X1 - 1.15, 0.6, 0.44, 0.5, 0.5, 0.05, chair, 0.02)
    box("chair_back", X1 - 1.42, 0.6, 0.6, 0.05, 0.46, 0.4, chair, 0.02)
    for dx in (-0.2, 0.2):
        for dy in (-0.2, 0.2):
            cyl("chair_leg", X1 - 1.15 + dx, 0.6 + dy, 0, 0.018, 0.44, MATS["pine"])
    box("lamp_desk", X1 - 0.35, 1.2, 0.78, 0.12, 0.12, 0.35, mat("lamp_y", (0.98, 0.8, 0.3), 0.4), 0.02)
    # toy shelf with bins (cubbies) on the south wall
    box("shelf", 3.4, Y0 + 0.22, 0, 2.4, 0.42, 1.1, wht, 0.01)
    bins = [(0.95, 0.45, 0.4), (0.4, 0.7, 0.55), (0.45, 0.6, 0.9), (0.98, 0.8, 0.35)]
    for i in range(4):
        for j in range(2):
            box("bin", 3.4 - 0.9 + i * 0.6, Y0 + 0.24, 0.06 + j * 0.52, 0.5, 0.38, 0.42, mat(f"bin{i}{j}", bins[(i + j) % 4], 0.7), 0.02)
    # toys: ball, block tower, plush bear
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.18, location=(2.0, -1.2, 0.18))
    bpy.context.object.data.materials.append(mat("ball", (0.95, 0.25, 0.25), 0.4))
    bpy.ops.object.shade_smooth()
    for k, c in enumerate([(0.9, 0.3, 0.3), (0.3, 0.6, 0.9), (0.95, 0.8, 0.3), (0.4, 0.75, 0.45)]):
        box("block", 2.6, -1.6, k * 0.16, 0.16, 0.16, 0.16, mat(f"blk{k}", c, 0.5), 0.01, rot=k * 0.4)
    # round rug + tent-like canopy corner
    cyl("rug", 2.8, -0.9, 0, 1.3, 0.015, mat("rug_cloud", (0.97, 0.94, 0.86), 1.0), verts=64)
    # stand-in avatar + ceiling light
    avatar(1.5, -0.4, shirt=(0.95, 0.75, 0.3))
    cyl("ceil_led", 2.9, 0, H - 0.08, 0.4, 0.08, mat("led", (1, 1, 1), 0.5, emit=(1.0, 0.96, 0.9), emit_str=6))
    world((0.8, 0.86, 0.95), 0.3)
    sun(rot=(math.radians(55), 0, math.radians(70)), strength=4.0)
    area_light(2.0, 0, H - 0.2, 1.0, 110)
    area_light(-3.0, 0, H - 0.2, 1.0, 60)
    camera((0.85, -3.6, 2.9), (4.6, 1.6, 0.6), lens=14)
    render("mock_h02_2f_kids.png")


os.makedirs(OUT, exist_ok=True)
which = ARGV[2] if len(ARGV) > 2 else "all"
if which in ("all", "ondol"):
    scene_ondol()
if which in ("all", "living"):
    scene_living()
if which in ("all", "kids"):
    scene_kids()
