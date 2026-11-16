"""Build the 케이슨 마을 authoring scene from art/village/layout.json (Blender 5.2, background).

  blender -b --factory-startup -P art/village/tools/build_village.py -- [--preview out.png] [--parts a,b,c]
        [--samples N] [--res WxH]

Writes art/village/work/village_authoring.blend (the scene bake_village.py exports) and, with --preview, a Cycles
frame of the plaza overview. Parts (all by default): plaza, road, houses, memorial, plots, creek, trees, backdrop.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vlib as U  # noqa: E402
from vlib import V, MB  # noqa: E402

L = U.LAYOUT
WORK = os.path.join(U.ROOT, "work")
os.makedirs(WORK, exist_ok=True)

NOR = lambda n: n + "_nor_gl_1k.jpg"  # noqa: E731
ROUGH = lambda n: n + "_rough_1k.jpg"  # noqa: E731

# export material -> authoring spec. "uv": world (triplanar, "tile" m) | explicit (set by the builder) | plaza | cell
U.MATSPEC.update({
    "LM_plaza": dict(tex="T_plaza.png", uv="plaza", rough=0.62, nor=NOR("rock_boulder_dry"), nor_scale=50.0,
                     nor_strength=0.35),
    "LM_grass": dict(tex="T_grass.png", tile=3.0, rough=0.92, tint=True, nor=NOR("leafy_grass"), nor_strength=0.5),
    "LM_lawn": dict(tex="T_lawn.png", uv="explicit", rough=0.92, nor=NOR("leafy_grass"), nor_scale=6.0,
                    nor_strength=0.5),
    "LM_stone": dict(tex="T_stone.png", tile=1.6, rough=0.55, nor=NOR("rock_boulder_dry"), nor_strength=0.45),
    "LM_concrete": dict(tex="T_concrete.png", tile=3.0, rough=0.85, nor=NOR("asphalt_04"), nor_strength=0.4),
    "LM_render": dict(tex="T_render.png", tile=2.5, rough=0.88, tint=True, nor=NOR("white_plaster_02"),
                      nor_strength=0.35),
    "LM_wood": dict(tex="T_wood.png", tile=2.0, rough=0.6, tint=True, nor=NOR("wood_planks"), nor_strength=0.4),
    "LM_roof": dict(tex="T_roof.png", tile=2.0, rough=0.5, tint=True, nor=NOR("roof_slates_02"), nor_strength=0.6),
    "LM_rock": dict(tex="T_rock.png", tile=3.0, rough=0.7, nor=NOR("rock_boulder_dry"), nor_strength=0.8),
    "LM_wall": dict(tex="T_wall.png", tile=2.0, rough=0.8, nor=NOR("granite_wall"), nor_strength=0.9),
    "LM_bark": dict(tex="T_bark.png", uv="explicit", rough=0.9),
    "A_bark_inst": dict(export="M_bark", tex="T_bark.png", uv="explicit", rough=0.9),
    "M_waterfall": dict(tex="T_falls.png", uv="explicit", rough=0.2, alpha=True, glow=0.25),
    "LM_atlas": dict(tex="T_atlas.png", uv="explicit", rough=0.5),
    # authoring-only looks that export as LM_atlas (UVs point into the atlas)
    # the fountain's crescent (M_moon in the game: unlit, never light-mapped, lit with a probe fitted to the bake's light
    # on it; bake_village.py leaves it out of the export and post_village.py adds it with scripts/patch-village-moon.mjs);
    # here it still casts its baked shadow
    "A_moon": dict(export="M_moon", tex="T_atlas.png", uv="explicit", rough=0.32, metal=0.0, coat=1.0),
    "A_glass": dict(export="LM_atlas", tex="T_atlas.png", uv="explicit", rough=0.03, coat=1.0),
    "A_glass_clear": dict(export="M_glass", color="#EEF4F6", uv="explicit", rough=0.02, transmission=1.0, ior=1.45),
    "A_metal": dict(export="LM_atlas", tex="T_atlas.png", uv="explicit", rough=0.35, metal=0.8),
    "A_paint": dict(export="LM_atlas", tex="T_atlas.png", uv="explicit", rough=0.25, coat=0.6),
    "M_water": dict(tex="T_water.png", uv="explicit", rough=0.03, albedo_mul="#5E6B6B"),
    "A_foam": dict(export="M_water", tex="T_water.png", uv="explicit", rough=0.15, alpha=True, coat=0.5),
    "M_glow_plot": dict(kind="emit", color="#22D3FF", strength=1.6),
    "M_lamp": dict(kind="emit_tex", tex="T_glow.png", uv="explicit", strength=3.0),
    "M_window": dict(kind="emit_tex", tex="T_glow.png", uv="explicit", strength=1.6),
    "A_window_glass": dict(export="M_window", tex="T_glow.png", uv="explicit", rough=0.04, coat=1.0),
    "M_sky": dict(kind="sky", tex="T_sky.png"),
    "M_leaf_green": dict(tex="T_leaf_green.png", uv="explicit", alpha=True, rough=0.6, translucent=0.3),
    "M_leaf_cherry": dict(tex="T_leaf_cherry.png", uv="explicit", alpha=True, rough=0.6, translucent=0.5, glow=0.18),
    "M_leaf_flora": dict(tex="T_flora.png", uv="explicit", alpha=True, rough=0.65, translucent=0.25),
})

# palette tints for the tintable textures (multiplied with a light texture)
TINT = {
    "pink": "#FFC9D4", "skyblue": "#BFE3FA", "yellow": "#FFE9A6", "white": "#FFFFFF", "mint": "#C4F0DC",
    "wood": "#FFFFFF", "wood_dark": "#8C7466", "wood_red": "#B7685A", "wood_light": "#FFE9D6",
    "roof_grey": "#9AA3AE", "roof_blue": "#7FA3CC", "roof_red": "#C9826F", "roof_green": "#8DB59A",
    "roof_charcoal": "#7E8692", "render_white": "#FFFFFF", "render_grey": "#D9D9DB",
}


def tint(name):
    return U.rgba(TINT[name])


def arg(name, default=None, cast=str):
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for x in a:
        if x.startswith(name + "="):
            return cast(x.split("=", 1)[1])
    return cast(a[a.index(name) + 1]) if name in a else default


# ---------------------------------------------------------------------------------------------- light --

def sun_dir():
    az = math.radians(U.LOOK["sun_azimuth_deg"])     # from north, clockwise (east = 90)
    el = math.radians(U.LOOK["sun_elevation_deg"])
    # direction TO the sun in game coords: north = -z, east = +x
    gx, gz, gy = math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)
    return V(gx, gz, gy).normalized()


def setup_light(scene):
    w = bpy.data.worlds.new("World")
    scene.world = w
    nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputWorld")
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(os.path.join(U.DL, "hdri", U.LOOK["hdri"] + "_2k.hdr"), check_existing=True)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    # rotate the HDRI so its sun sits at the chosen azimuth. Blender equirect: u = 0.5 looks along -Y? we measure:
    # the brightest column u_s maps to the direction atan2(-y, -x) convention: azimuth_blender = (u - 0.5) * 2pi
    # around +Z from -X... computed numerically in build so the HDRI sun lines up with the sun lamp.
    mp.inputs["Rotation"].default_value = (0, 0, hdri_rotation(env.image))
    nt.links.new(tc.outputs["Generated"], mp.inputs["Vector"])
    nt.links.new(mp.outputs[0], env.inputs["Vector"])
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = U.LOOK["sky_strength"]
    nt.links.new(env.outputs["Color"], bg.inputs["Color"])
    # the camera sees the sky at a lower strength than the light it gives (keeps the visible sky blue, not blown out)
    bgc = nt.nodes.new("ShaderNodeBackground")
    bgc.inputs["Strength"].default_value = U.LOOK.get("sky_camera_strength", 1.0)
    nt.links.new(env.outputs["Color"], bgc.inputs["Color"])
    lp = nt.nodes.new("ShaderNodeLightPath")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(lp.outputs["Is Camera Ray"], mix.inputs[0])
    nt.links.new(bg.outputs[0], mix.inputs[1])
    nt.links.new(bgc.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    sd = bpy.data.lights.new("Sun", "SUN")
    sd.energy = U.LOOK["sun_strength"]
    sd.color = U.rgba(U.LOOK["sun_colour"])[:3]
    sd.angle = math.radians(U.LOOK["sun_angle_deg"])
    sun = bpy.data.objects.new("Sun", sd)
    scene.collection.objects.link(sun)
    sun.rotation_mode = "QUATERNION"
    sun.rotation_quaternion = (-sun_dir()).to_track_quat("-Z", "Y")
    return sun


def hdri_rotation(image):
    """Z rotation (radians) for the world mapping so that the HDRI's brightest column points at the sun azimuth.
    Blender equirect lookup: u = atan2(dir.y, -dir.x) / (2 pi) + 0.5."""
    import numpy as np
    w, h = image.size
    px = np.empty(w * h * 4, np.float32)
    image.pixels.foreach_get(px)
    a = px.reshape(h, w, 4)[..., :3] @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    iy, ix = np.unravel_index(np.argmax(a), a.shape)
    u_sun = (ix + 0.5) / w
    phi_sun = (u_sun - 0.5) * 2 * math.pi          # atan2(y, -x) of the HDRI's sun direction (unrotated)
    d = sun_dir()
    phi_target = math.atan2(d.y, -d.x)
    # mapping rotates the lookup vector: lookup = R(rot) * dir, so we need R(rot) * target = sun_dir_hdri
    return phi_sun - phi_target


def setup_render(scene, w=1920, h=1080, samples=128):
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    try:
        prefs.compute_device_type = "OPTIX"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == "OPTIX"
        scene.cycles.device = "GPU"
    except Exception as e:
        print("GPU setup failed:", e)
    c = scene.cycles
    c.samples = samples
    c.use_adaptive_sampling = True
    c.adaptive_threshold = 0.02
    c.use_denoising = True
    try:
        c.denoiser = "OPENIMAGEDENOISE"
    except Exception:
        pass
    c.max_bounces = 6
    c.diffuse_bounces = 3
    c.glossy_bounces = 2
    c.transmission_bounces = 4
    c.transparent_max_bounces = 24
    c.caustics_reflective = False
    c.caustics_refractive = False
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "AgX"
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass
    scene.view_settings.exposure = 0.0
    scene.render.film_transparent = False


def camera(scene, name, eye, target, lens=28.0):
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    cd.sensor_width = 36.0
    cd.clip_start = 0.1
    cd.clip_end = 3000.0
    cam = bpy.data.objects.new(name, cd)
    scene.collection.objects.link(cam)
    cam.location = V(*eye)
    d = V(*target) - V(*eye)
    cam.rotation_mode = "QUATERNION"
    cam.rotation_quaternion = d.to_track_quat("-Z", "Y")
    return cam


# --------------------------------------------------------------------------------------------- ground --

PLAZA_R = L["plaza"]["paving"]["radius"]          # 30
RING_R, RING_W = L["ringRoad"]["radius"], L["ringRoad"]["width"]
R_IN, R_OUT = RING_R - RING_W / 2, RING_R + RING_W / 2     # 31, 37
SIDE_OUT = R_OUT + L["ringRoad"]["sidewalk"]["width"]       # 39
DISC_R = 40.5
GROUND_HALF = 112.0


def creek_curve():
    """Smooth creek centreline (game x, z) through the layout's segment centres; samples every ~1.5 m."""
    segs = L["stream"]["segments"]
    knots = [(segs[0]["minX"] - 30, segs[0]["z"])]
    for s in segs:
        knots.append(((s["minX"] + s["maxX"]) / 2, s["z"]))
    knots.append((segs[-1]["maxX"] + 30, segs[-1]["z"]))
    # Catmull-Rom
    pts = []
    for i in range(len(knots) - 1):
        p0 = knots[max(i - 1, 0)]
        p1, p2 = knots[i], knots[i + 1]
        p3 = knots[min(i + 2, len(knots) - 1)]
        n = max(2, int(abs(p2[0] - p1[0]) / 1.5))
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
                       (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3)
            z = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
                       (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
            pts.append((x, z))
    pts.append(knots[-1])
    return pts


CREEK = None
WATER_Y = -0.55


def creek_z(x):
    global CREEK
    if CREEK is None:
        CREEK = creek_curve()
    for (x0, z0), (x1, z1) in zip(CREEK[:-1], CREEK[1:]):
        if x0 <= x <= x1:
            t = (x - x0) / max(1e-6, x1 - x0)
            return z0 + (z1 - z0) * t
    return CREEK[0][1] if x < CREEK[0][0] else CREEK[-1][1]


def feeder_pts():
    f = L["backdrop"]["waterfall"]["centre"]
    return [(f["x"] + 9.0, f["z"] + 2.0), (-107.0, -58.0), (-104.5, -25.0), (-106.5, 10.0), (-105.0, 42.0),
            (-110.0, 62.0), (-118.0, 70.0)]


def feeder_dist(x, z):
    """Distance to the stream that carries the waterfall's water south to the creek (outside the walk bounds)."""
    best, best_t = 1e9, 0.0
    pts = feeder_pts()
    acc, total = 0.0, sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts[:-1], pts[1:]))
    for a, b in zip(pts[:-1], pts[1:]):
        dx, dz = b[0] - a[0], b[1] - a[1]
        L2 = dx * dx + dz * dz
        t = max(0.0, min(1.0, ((x - a[0]) * dx + (z - a[1]) * dz) / L2))
        d = math.hypot(x - a[0] - t * dx, z - a[1] - t * dz)
        if d < best:
            best, best_t = d, (acc + t * math.sqrt(L2)) / total
        acc += math.sqrt(L2)
    return best, best_t


def ground_h(x, z):
    """Ground height: flat 0 in the walk area, the creek channel, a gentle rise past the walk bounds, and the feeder
    stream's channel west of the bounds."""
    d = abs(z - creek_z(x))
    h = 0.0
    if d < 4.8:
        # cross-section: bank top 0 at 4.8 m, water edge (-0.55) at 2.4 m, bed -1.0 at the centre
        if d > 2.4:
            t = (d - 2.4) / 2.4
            h = WATER_Y + (0 - WATER_Y) * (t * t * (3 - 2 * t))
        else:
            h = WATER_Y - 0.45 * (1 - (d / 2.4) ** 2)
    e = max(abs(x), abs(z)) - 97.0
    if e > 0:
        h += (e / 15.0) ** 2 * 3.0
    if x < -96:
        fd, ft = feeder_dist(x, z)
        if fd < 5.0:
            bed = -0.25 - 0.25 * ft - 0.4 * max(0.0, 1 - (fd / 2.0) ** 2)
            k = 1 - max(0.0, (fd - 2.0) / 3.0)
            k = k * k * (3 - 2 * k)
            h = h * (1 - k) + bed * k
    return h


def build_ground(c):
    """Outer ground grid (LM_grass) with the creek channel; the plaza disc covers r < DISC_R."""
    mb = MB()
    xs = [-GROUND_HALF + i * 2.5 for i in range(int(2 * GROUND_HALF / 2.5) + 1)]
    zs = []
    z = -GROUND_HALF
    while z <= GROUND_HALF + 1e-6:
        zs.append(z)
        near = any(abs(z - s["z"]) < 12 for s in L["stream"]["segments"])
        z += 0.8 if near else 2.5
    zs[-1] = GROUND_HALF
    H = [[ground_h(x, z) for x in xs] for z in zs]
    for j in range(len(zs) - 1):
        for i in range(len(xs) - 1):
            cs = [(xs[i], zs[j]), (xs[i + 1], zs[j]), (xs[i + 1], zs[j + 1]), (xs[i], zs[j + 1])]
            if all(math.hypot(px, pz) < DISC_R - 1.0 for px, pz in cs):
                continue
            pts = [V(xs[i], zs[j], H[j][i]), V(xs[i + 1], zs[j], H[j][i + 1]),
                   V(xs[i + 1], zs[j + 1], H[j + 1][i + 1]), V(xs[i], zs[j + 1], H[j + 1][i])]
            mb.face(pts, "LM_grass", hint=Vector((0, 0, 1)))
    ob = mb.finish("ground_outer", c)
    macro_tint(ob)
    return ob


def macro_tint(ob):
    """Low-frequency colour variation on the grass (vertex colour 'Col', exported as COLOR_0): breaks the 3 m tiling."""
    from mathutils import noise
    me = ob.data
    col = me.color_attributes["Col"].data
    for p in me.polygons:
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            w = noise.noise(Vector((co.x * 0.01, co.y * 0.01, 9.0))) * 25.0
            n1 = noise.noise(Vector((co.x * 0.035 + w * 0.02, co.y * 0.035, 0.5)))
            n2 = noise.noise(Vector((co.x * 0.12, co.y * 0.12, 3.5)))
            k = 0.92 + 0.16 * n1 + 0.06 * n2
            dry = max(0.0, noise.noise(Vector((co.x * 0.018 + 3.0, co.y * 0.018, 7.0))) - 0.1) * 1.4
            col[li].color = (min(1, k * (1 + 0.22 * dry)), min(1, k * (1 + 0.04 * dry)), min(1, k * (1 - 0.25 * dry)), 1.0)


def build_lanes(c):
    """Concrete lanes (LM_concrete) from the plaza disc's edge to each plot, the memorial door and the bridge."""
    mb = MB()
    y = 0.018
    for lane in L["lanes"]:
        pts = lane["points"]
        hw = lane["width"] / 2
        for a, b in zip(pts[:-1], pts[1:]):
            ax, az, bx, bz = a["x"], a["z"], b["x"], b["z"]
            L_ = math.hypot(bx - ax, bz - az)
            ux, uz = (bx - ax) / L_, (bz - az) / L_
            # clip to outside the disc (r > DISC_R - 1.2)
            n = max(1, int(L_ / 2.0))
            for i in range(n):
                t0, t1 = i / n, (i + 1) / n
                x0, z0 = ax + (bx - ax) * t0, az + (bz - az) * t0
                x1, z1 = ax + (bx - ax) * t1, az + (bz - az) * t1
                if math.hypot(x1, z1) < DISC_R - 1.2 and math.hypot(x0, z0) < DISC_R - 1.2:
                    continue
                e0 = 0.3 if i == n - 1 else 0.0
                x1e, z1e = x1 + ux * e0, z1 + uz * e0
                q = [V(x0 - uz * hw, z0 + ux * hw, y), V(x1e - uz * hw, z1e + ux * hw, y),
                     V(x1e + uz * hw, z1e - ux * hw, y), V(x0 + uz * hw, z0 - ux * hw, y)]
                mb.face(q, "LM_concrete", hint=Vector((0, 0, 1)))
    return mb.finish("lanes", c)


def grass_tufts(c):
    """Grass and wildflower tufts on the outer ground (soft, no colliders), avoiding lanes, plots and the creek."""
    import random
    import parts_trees as PT
    rng = random.Random(55)
    mb = MB()
    plots = [p["bounds"] for p in L["plots"]]
    def ok(x, z):
        if math.hypot(x, z) < SIDE_OUT + 1.5:
            return False
        if abs(z - creek_z(x)) < 5.5:
            return False
        for b in plots:
            if b["minX"] - 0.5 < x < b["maxX"] + 0.5 and b["minZ"] - 0.5 < z < b["maxZ"] + 0.5:
                return False
        for h in L["sceneryHouses"]:
            b = h["bounds"]
            if b["minX"] - 1 < x < b["maxX"] + 1 and b["minZ"] - 1 < z < b["maxZ"] + 1:
                return False
        for lane in L["lanes"]:
            for a, b in zip(lane["points"][:-1], lane["points"][1:]):
                dx, dz = b["x"] - a["x"], b["z"] - a["z"]
                t = max(0, min(1, ((x - a["x"]) * dx + (z - a["z"]) * dz) / (dx * dx + dz * dz)))
                if math.hypot(x - a["x"] - t * dx, z - a["z"] - t * dz) < lane["width"] / 2 + 0.8:
                    return False
        return True
    n = 0
    while n < 30:
        x, z = rng.uniform(-90, 90), rng.uniform(-90, 90)
        if not ok(x, z):
            continue
        n += 1
        rows = [3, 3, rng.choice([0, 1, 2])]
        rad = rng.uniform(1.2, 2.4)
        PT.flower_patch(mb, lambda px, pz, x=x, z=z, rad=rad: math.hypot(px - x, pz - z) < rad and ok(px, pz),
                        (x - rad, x + rad, z - rad, z + rad), 0.0, 3.5, rows, rng.randrange(1 << 30), h=(0.25, 0.45),
                        w=(0.5, 0.8))
    return mb.finish("grass_tufts", c, cat="leaf", auto=False)


def build_plaza_disc(c):
    """Polar disc r < DISC_R with the T_plaza texture (paving, road, sidewalk), 1 cm above the grid."""
    mb = MB()
    rings = [0.0, 3.0, 6.0, 8.0, 10.5, 13.0, 16.0, 19.0, 22.0, 25.0, 28.0, 30.0, 31.0, 34.0, 37.0, 39.0, DISC_R]
    segs = 160
    y = 0.01
    for j in range(len(rings) - 1):
        r0, r1 = rings[j], rings[j + 1]
        for i in range(segs):
            a0, a1 = 2 * math.pi * i / segs, 2 * math.pi * (i + 1) / segs
            if r0 == 0:
                pts = [V(0, 0, y), V(r1 * math.cos(a0), r1 * math.sin(a0), y), V(r1 * math.cos(a1), r1 * math.sin(a1), y)]
            else:
                pts = [V(r0 * math.cos(a0), r0 * math.sin(a0), y), V(r1 * math.cos(a0), r1 * math.sin(a0), y),
                       V(r1 * math.cos(a1), r1 * math.sin(a1), y), V(r0 * math.cos(a1), r0 * math.sin(a1), y)]
            mb.face(pts, "LM_plaza", hint=Vector((0, 0, 1)))
    return mb.finish("plaza_disc", c)


def lane_crossings():
    """Angles (radians, game atan2(z, x)) and half-widths where lanes cross the ring (for kerb gaps)."""
    out = []
    for lane in L["lanes"]:
        pts = lane["points"]
        for a, b in zip(pts[:-1], pts[1:]):
            for rr in (R_IN, R_OUT, SIDE_OUT):
                # sample the segment for the ring crossing
                n = 200
                for k in range(n):
                    t0, t1 = k / n, (k + 1) / n
                    x0, z0 = a["x"] + (b["x"] - a["x"]) * t0, a["z"] + (b["z"] - a["z"]) * t0
                    x1, z1 = a["x"] + (b["x"] - a["x"]) * t1, a["z"] + (b["z"] - a["z"]) * t1
                    if (math.hypot(x0, z0) - rr) * (math.hypot(x1, z1) - rr) <= 0:
                        out.append((rr, math.atan2(z0, x0), lane["width"] / 2 + 0.6))
                        break
    return out


def build_kerbs(c):
    """Low granite kerbs along the road edges (0.1 m), with gaps where lanes cross (dropped kerbs)."""
    mb = MB()
    gaps = lane_crossings()
    for (r0, r1, hgt) in ((R_IN - 0.16, R_IN, 0.10), (R_OUT, R_OUT + 0.18, 0.10), (PLAZA_R, PLAZA_R + 0.22, 0.04)):
        rr = (r0 + r1) / 2
        segs = 320
        for i in range(segs):
            a0, a1 = 2 * math.pi * i / segs, 2 * math.pi * (i + 1) / segs
            am = (a0 + a1) / 2
            skip = False
            for (gr, ga, ghw) in gaps:
                if abs(gr - rr) < 3.0:
                    da = math.atan2(math.sin(am - ga), math.cos(am - ga))
                    if abs(da) * rr < ghw:
                        skip = True
            if skip and hgt > 0.05:
                continue
            p = [V(r0 * math.cos(a0), r0 * math.sin(a0), 0.01), V(r1 * math.cos(a0), r1 * math.sin(a0), 0.01),
                 V(r1 * math.cos(a1), r1 * math.sin(a1), 0.01), V(r0 * math.cos(a1), r0 * math.sin(a1), 0.01)]
            q = [x + Vector((0, 0, hgt)) for x in p]
            mb.face(q, "LM_stone", hint=Vector((0, 0, 1)))
            mb.face([p[0], p[3], q[3], q[0]], "LM_stone", hint=V(-math.cos(am), -math.sin(am)) - V(0, 0))
            mb.face([p[1], p[2], q[2], q[1]], "LM_stone", hint=V(math.cos(am), math.sin(am)) - V(0, 0))
    return mb.finish("kerbs", c)


# ------------------------------------------------------------------------------------------- fountain --

MOON_MESH = dict(n_arc=120, n_ring=32, arc_bunch=0.5, inset=0.05)


def crescent(mb, cx, cz, base_y, height, yaw, m="A_moon"):
    """A polished crescent moon standing upright: outer circle R1, inner circle R2 offset right and up; the band between
    them has an elliptical cross-section all round (u = (1 - cos phi) / 2 across, z = +-T/2 sin phi through), so the rim
    is round, and its thickness T = 0.3 R1 (w / w_max)^0.55 thins with the band's width w to a point at each tip. The
    crescent's plane faces local +z (turned by yaw).

    UV0 runs along the arc tip to tip and across the band by the distance across it, centred (the widest point spans
    the atlas region, a tip only its middle: a full span at every width put the region into the tips' last centimetres,
    where the GPU read a mip level that takes in the cells around the region, a dark dotted line down the tips).

    The same mesh as scripts/patch-village-moon.mjs moonGeometry() in the repo (fix/fix-moon-smooth), which puts it into
    village.glb as the node fountain_moon (material M_moon, unlit; the game lights it with a probe of the bake's light,
    client/src/village/villageModelPrep.ts MOON_PROBE): keep the two in step. The old moon (72 x 8 quads a side, a
    knife-edge rim, light-mapped) showed its 3.5 texels per metre as stepped bands along every edge."""
    R1 = height / 2
    R2 = R1 * 0.80
    off_x, off_y = R1 * 0.42, R1 * 0.10
    tmax = R1 * 0.30
    n_a, n_r, bunch, inset = MOON_MESH["n_arc"], MOON_MESH["n_ring"], MOON_MESH["arc_bunch"], MOON_MESH["inset"]
    c, s = math.cos(yaw), math.sin(yaw)
    cy = base_y + R1
    off_len = math.hypot(off_x, off_y)
    k = (R1 * R1 + off_len * off_len - R2 * R2) / (2 * R1)
    half = math.acos(k / off_len)
    alpha = math.atan2(off_y, off_x)
    th_a, th_b = alpha + half, alpha - half + 2 * math.pi       # the tips (upper, lower): the band runs through 180 deg
    w_max = R1 - (R2 - off_len)

    def inner_r(th):
        b = math.cos(th) * off_x + math.sin(th) * off_y
        return min(R1, b + math.sqrt(b * b - (off_len * off_len - R2 * R2)))

    def arc_frac(t):
        return t - bunch * math.sin(2 * math.pi * t) / (2 * math.pi)

    def world(lx, ly, lz):                            # local (x right, y up, z toward viewer) -> game (x, y, z)
        return (cx + lx * c + lz * s, cy + ly, cz - lx * s + lz * c)

    def local(t, phi):
        th = th_a + (th_b - th_a) * arc_frac(t)
        ri = inner_r(th)
        w = max(0.0, R1 - ri)
        T = tmax * (w / w_max) ** 0.55
        r = ri + w * (1 - math.cos(phi)) / 2
        return r * math.cos(th), r * math.sin(th), T / 2 * math.sin(phi), th, ri, w

    def P(t, phi):
        lx, ly, lz = local(t, phi)[:3]
        return world(lx, ly, lz)

    def centre_line(t):
        _, _, _, th, ri, w = local(t, 0.0)
        rm = ri + w / 2
        return world(rm * math.cos(th), rm * math.sin(th), 0.0)

    def sub(a, b):
        return (a[0] - b[0], a[1] - b[1], a[2] - b[2])

    def cross(a, b):
        return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])

    def norm(a):
        ln = math.sqrt(a[0] ** 2 + a[1] ** 2 + a[2] ** 2)
        return (a[0] / ln, a[1] / ln, a[2] / ln)

    def uv(u, v):
        return U.region_uv("moon", inset + (1 - 2 * inset) * u, inset + (1 - 2 * inset) * v)

    eps = 1e-5
    rings = []                                        # rings[i - 1][j] = (game point, normal, uv), t = i / n_a
    for i in range(1, n_a):
        t = i / n_a
        mid = centre_line(t)
        span = local(t, 0.0)[5] / w_max                # the band's width here, as a share of its widest
        ring = []
        for j in range(n_r):
            phi = 2 * math.pi * j / n_r
            p = P(t, phi)
            n = norm(cross(sub(P(t + eps, phi), P(t - eps, phi)), sub(P(t, phi + eps), P(t, phi - eps))))
            d = sub(p, mid)
            if n[0] * d[0] + n[1] * d[1] + n[2] * d[2] < 0:
                n = (-n[0], -n[1], -n[2])
            ring.append((p, n, uv(arc_frac(t), 0.5 + span * ((1 - math.cos(phi)) / 2 - 0.5))))
        rings.append(ring)
    tips = []
    for t in (0.0, 1.0):
        p = P(t, 0.0)
        tips.append((p, norm(sub(p, centre_line(1 / n_a if t == 0 else 1 - 1 / n_a))), uv(t, 0.5)))

    def tri(a, b, d):
        hint = V(a[1][0] + b[1][0] + d[1][0], a[1][2] + b[1][2] + d[1][2], a[1][1] + b[1][1] + d[1][1]) - V(0, 0)
        mb.face([V(q[0][0], q[0][2], q[0][1]) for q in (a, b, d)], m, [q[2] for q in (a, b, d)], smooth=True, hint=hint)

    for i in range(n_a - 2):
        for j in range(n_r):
            a, b = rings[i][j], rings[i + 1][j]
            d, e = rings[i + 1][(j + 1) % n_r], rings[i][(j + 1) % n_r]
            tri(a, b, d)
            tri(a, d, e)
    for j in range(n_r):
        tri(tips[0], rings[0][j], rings[0][(j + 1) % n_r])
        tri(tips[1], rings[-1][(j + 1) % n_r], rings[-1][j])


def build_fountain(c):
    f = L["plaza"]["fountain"]["centre"]
    cx, cz = f["x"], f["z"]
    mb = MB()
    # basin wall ring r 5.4..6.0, coping with a soft roll
    mb.lathe(cx, cz, [(6.0, 0.0), (6.0, 0.42), (6.03, 0.47), (5.98, 0.55), (5.7, 0.58), (5.42, 0.55), (5.4, 0.47),
                      (5.4, 0.3)], "LM_stone", segs=96, smooth=True)
    # basin floor (under the water)
    mb.lathe(cx, cz, [(0.0, 0.05), (5.4, 0.05)][::-1], "LM_stone", segs=64, smooth=False)
    # pedestal (lower tier) r 2.3 rising from the water, a fluted drum with a lip
    mb.lathe(cx, cz, [(2.25, 0.05), (2.25, 0.62), (2.45, 0.68), (2.5, 0.78), (2.3, 0.84), (2.05, 0.82),
                      (1.95, 0.75)], "LM_stone", segs=64, smooth=True)
    # upper bowl on a stem
    mb.lathe(cx, cz, [(0.55, 0.75), (0.45, 1.05), (0.6, 1.3), (1.55, 1.52), (1.62, 1.6), (1.5, 1.64),
                      (1.3, 1.58), (0.75, 1.55), (0.62, 1.62)], "LM_stone", segs=48, smooth=True)
    # plinth for the moon
    mb.lathe(cx, cz, [(0.62, 1.55), (0.62, 1.95), (0.7, 2.0), (0.0, 2.0)], "LM_stone", segs=32, smooth=True)
    stone = mb.finish("fountain_stone", c)
    # crescent moon: 6.2 m tall standing on the plinth, its face turned toward the spawn (south) a little east
    mm = MB()
    crescent(mm, cx, cz, 1.98, 7.4, math.radians(-25))
    moon = mm.finish("fountain_moon", c, cat="moon", auto=False)
    # water: pool surface, tier surfaces, falling sheets, jets
    w = MB()
    def pool_disc(r, y, segs=64):
        for i in range(segs):
            a0, a1 = 2 * math.pi * i / segs, 2 * math.pi * (i + 1) / segs
            pts = [V(cx, cz, y), V(cx + r * math.cos(a0), cz + r * math.sin(a0), y),
                   V(cx + r * math.cos(a1), cz + r * math.sin(a1), y)]
            uvs = [(0.25 + 0.0, 0.5), (0.25 + 0.24 * math.cos(a0), 0.5 + 0.48 * math.sin(a0)),
                   (0.25 + 0.24 * math.cos(a1), 0.5 + 0.48 * math.sin(a1))]
            w.face(pts, "M_water", uvs, hint=Vector((0, 0, 1)))
    pool_disc(5.41, 0.40, 96)
    pool_disc(2.06, 0.80, 48)
    pool_disc(1.52, 1.60, 32)
    # falling water sheets from the bowl lips (foam region: u 0.5..1)
    def sheet(r_top, y_top, r_bot, y_bot, segs=48):
        for i in range(segs):
            a0, a1 = 2 * math.pi * i / segs, 2 * math.pi * (i + 1) / segs
            pts = [V(cx + r_top * math.cos(a0), cz + r_top * math.sin(a0), y_top),
                   V(cx + r_top * math.cos(a1), cz + r_top * math.sin(a1), y_top),
                   V(cx + r_bot * math.cos(a1), cz + r_bot * math.sin(a1), y_bot),
                   V(cx + r_bot * math.cos(a0), cz + r_bot * math.sin(a0), y_bot)]
            u0, u1 = 0.5 + 0.5 * (i % 4) / 4, 0.5 + 0.5 * ((i % 4) + 1) / 4
            w.face(pts, "A_foam", [(u0, 1), (u1, 1), (u1, 0), (u0, 0)],
                   hint=V(math.cos((a0 + a1) / 2), math.sin((a0 + a1) / 2)) - V(0, 0))
    sheet(1.64, 1.62, 1.85, 0.82)
    sheet(2.52, 0.80, 2.75, 0.40)
    # arcing jets from inside the rim toward the pedestal, and upright jets around it
    for k in range(16):
        a = 2 * math.pi * k / 16
        p0 = V(cx + 5.1 * math.cos(a), cz + 5.1 * math.sin(a), 0.42)
        p2 = V(cx + 2.9 * math.cos(a), cz + 2.9 * math.sin(a), 0.45)
        p1 = (p0 + p2) / 2 + Vector((0, 0, 2.6))
        path = U.bez(p0, p1, p2, 12)
        radii = [0.05 + 0.07 * (i / 11) for i in range(12)]
        w.tube(path, radii, "A_foam", segs=6, uv_v=0.25, uv_u=0.5, uv_off=(0.5, 0.0))
    for k in range(8):
        a = 2 * math.pi * k / 8 + 0.2
        b = V(cx + 1.9 * math.cos(a), cz + 1.9 * math.sin(a), 0.80)
        path = [b + Vector((0, 0, h)) for h in (0, 0.9, 1.8, 2.5, 2.9)]
        w.tube(path, [0.035, 0.04, 0.045, 0.06, 0.08], "A_foam", segs=6, uv_v=0.3, uv_u=0.5, uv_off=(0.5, 0.0))
        top = b + Vector((0, 0, 2.9))
        for j in range(6):
            aj = 2 * math.pi * j / 6 + k
            out = Vector((math.cos(aj), -math.sin(aj), 0))
            spray = U.bez(top, top + out * 0.35 + Vector((0, 0, 0.35)), top + out * 0.7 - Vector((0, 0, 1.2)), 6)
            w.tube(spray, [0.05, 0.045, 0.04, 0.03, 0.02, 0.012], "A_foam", segs=4, uv_v=0.5, uv_u=0.5, uv_off=(0.5, 0.0))
    # splash rings where the jets land
    for k in range(16):
        a = 2 * math.pi * k / 16
        px, pz = cx + 2.9 * math.cos(a), cz + 2.9 * math.sin(a)
        ring = [V(px + 0.35 * math.cos(2 * math.pi * i / 8), pz + 0.35 * math.sin(2 * math.pi * i / 8), 0.42)
                for i in range(8)]
        w.face(ring, "A_foam", [(0.5 + 0.25 + 0.2 * math.cos(2 * math.pi * i / 8), 0.5 + 0.4 * math.sin(2 * math.pi * i / 8))
                                for i in range(8)], hint=Vector((0, 0, 1)))
    # underwater uplights under the upright jets (M_lamp, lamp region) and the light empties
    for k in range(8):
        a = 2 * math.pi * k / 8 + 0.2
        lx, lz = cx + 1.9 * math.cos(a), cz + 1.9 * math.sin(a)
        ring = [V(lx + 0.09 * math.cos(2 * math.pi * i / 8), lz + 0.09 * math.sin(2 * math.pi * i / 8), 0.795)
                for i in range(8)]
        w.face(ring, "M_lamp", [U.glow_uv("lamp", 0.5 + 0.4 * math.cos(2 * math.pi * i / 8), 0.5 + 0.4 * math.sin(2 * math.pi * i / 8))
                                for i in range(8)], hint=Vector((0, 0, 1)))
        U.light("fountain", V(lx, lz, 1.0))
    # jets UVs -> foam half of the water texture
    water = w.finish("fountain_water", c, cat="water", auto=False)
    me = water.data
    uvl = me.uv_layers["UVMap"].data
    for p in me.polygons:
        if me.materials[p.material_index].name == "A_foam" and False:
            for li in p.loop_indices:
                u, v = uvl[li].uv
                uvl[li].uv = (0.5 + 0.5 * (u % 1.0), v)
    # corner flower beds filling the collider's corners (|x|,|z| <= 5.95 outside r 6.05)
    beds = MB()
    hw = 5.95
    for sx in (-1, 1):
        for sz in (-1, 1):
            poly = []
            a_start = math.atan2(sz * hw, sx * 0.0)
            # polygon: the arc r=6.05 between the two box edges, then the box corner
            ang0 = math.atan2(sz * math.sqrt(max(0, 6.05 ** 2 - hw ** 2)), sx * hw)   # where r=6.05 meets |x|=hw
            ang1 = math.atan2(sz * hw, sx * math.sqrt(max(0, 6.05 ** 2 - hw ** 2)))
            n = 12
            arc = [(cx + 6.05 * math.cos(ang0 + (ang1 - ang0) * t / n), cz + 6.05 * math.sin(ang0 + (ang1 - ang0) * t / n))
                   for t in range(n + 1)]
            poly = arc + [(cx + sx * hw, cz + sz * hw)]
            beds.prism(poly, 0.0, 0.32, "LM_stone")
            # soil top slightly lower inside
            inner = [(cx + (x - cx) * 0.985, cz + (z - cz) * 0.985) for x, z in poly]
            beds.prism(inner, 0.32, 0.30, "A_paint")
    bobj = beds.finish("fountain_beds", c)
    _cell_uv(bobj, "A_paint", "mulch")
    return [stone, moon, water, bobj]


def _cell_uv(ob, mname, cellname):
    me = ob.data
    uvl = me.uv_layers["UVMap"].data
    u = U.cell(cellname)
    for p in me.polygons:
        if me.materials[p.material_index].name == mname:
            for li in p.loop_indices:
                uvl[li].uv = u


# ----------------------------------------------------------------------------------------------- main --

def main():
    import parts_props as PP
    import parts_trees as PT
    import parts_buildings as PB
    import parts_nature as PN
    scene = bpy.context.scene
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    parts = (arg("--parts", "plaza,road,houses,memorial,plots,creek,trees,fill,backdrop")).split(",")
    root = U.coll("village")
    cols = U.coll("colliders", root)
    setup_light(scene)
    setup_render(scene, samples=arg("--samples", 128, int))
    built = {}
    if "plaza" in parts:
        c = U.coll("plaza", root)
        build_plaza_disc(c)
        build_ground(c)
        build_lanes(c)
        grass_tufts(c)
        build_kerbs(c)
        build_fountain(c)
        PP.benches(c, cols)
        PP.lamps(c)
        PP.banners(c)
        # camera:false in the layout (the camera looks over the fountain): keep the box below 1.6 m
        U.collider(cols, L["plaza"]["fountain"]["collider"]["node"], -6, 6, -6, 6, 1.0)
    if "road" in parts:
        c = U.coll("road", root)
        PP.bus_stop(c, cols)
    if "trees" in parts:
        c = U.coll("trees", root)
        PT.plaza_trees(c, cols)
    if "houses" in parts:
        c = U.coll("houses", root)
        PB.houses(c, cols)
        PB.cafe(c, cols)
    if "memorial" in parts:
        c = U.coll("memorial", root)
        PB.memorial(c, cols)
    if "plots" in parts:
        c = U.coll("plots", root)
        PB.plots(c, cols)
    if "creek" in parts:
        c = U.coll("creek", root)
        PN.creek(c, cols)
    if "trees" in parts:
        c = U.coll("trees2", root)
        PT.village_trees(c, cols)
        PT.lane_dressing(c, cols)
        PP.plaza_details(U.coll("plaza_details", root), cols)
    if "fill" in parts:
        import parts_fill as PF
        c = U.coll("fill", root)
        PF.fill(c, cols)
        PF.tree_boxes(cols)
    if "backdrop" in parts:
        c = U.coll("backdrop", root)
        PN.backdrop(c)
    U.make_light_empties(U.coll("lights", root))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, "village_authoring.blend"))
    prev = arg("--preview")
    if prev:
        res = arg("--res", "1920x1080")
        w, h = (int(v) for v in res.split("x"))
        scene.render.resolution_x, scene.render.resolution_y = w, h
        eye = tuple(float(v) for v in arg("--eye", "-28,135,60").split(","))
        tgt = tuple(float(v) for v in arg("--target", "2,-8,18").split(","))
        cam = camera(scene, "cam_preview", eye, tgt, lens=arg("--lens", 20.0, float))
        scene.camera = cam
        scene.render.filepath = prev
        bpy.ops.render.render(write_still=True)
        print("PREVIEW", prev)
    spawn = arg("--spawnview")
    if spawn:
        sp = L["spawn"]
        cam = camera(scene, "cam_spawn", (sp["x"], sp["z"], 1.6), (0.0, 0.0, 3.2), lens=arg("--spawnlens", 24.0, float))
        scene.camera = cam
        scene.render.filepath = spawn
        bpy.ops.render.render(write_still=True)
        print("SPAWNVIEW", spawn)


if __name__ == "__main__":
    main()
