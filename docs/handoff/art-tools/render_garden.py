"""The garden seen through the memorial hall's west windows (Task 8; Blender 5.2, background).

  blender -b --factory-startup -P art/village/tools/render_garden.py -- [--samples 256]
  python art/village/tools/post_memorial.py --garden       (-> work/tex_m/T_m_garden.png, compensated for the game's tone curve)

Renders a small memorial-park garden west of the hall (lawn, a pale stone path, a clipped boxwood hedge with azaleas,
rows of young memorial trees (수목장), a stand of birches, forested hills and a far blue ridge, the Poly Haven
kloppenheim_06 sky) from the room's centre onto the plane of the backdrop card (build_memorial.py GARDEN: x = 291,
z -14..14, y -1.5..7.5), so the card shows the right perspective from the middle of the room.
Writes work/tex_m/garden_raw.png (AgX display image).
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vlib as U  # noqa: E402
from vlib import V  # noqa: E402

OUT = os.path.join(U.ROOT, "work", "tex_m")
GARDEN = dict(x=291.0, z0=-14.0, z1=14.0, y0=-1.5, y1=7.5)
EYE = (300.0, 0.0, 1.5)
GROUND_Y = -0.25


def arg(name, default=None, cast=str):
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for x in a:
        if x.startswith(name + "="):
            return cast(x.split("=", 1)[1])
    return cast(a[a.index(name) + 1]) if name in a else default


def pbr(name, colour, rough=0.8, tex=None, tile=2.0, nor=None, noise=0.0, sss=0.0):
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Roughness"].default_value = rough
    tc = nt.nodes.new("ShaderNodeTexCoord")
    if tex:
        mp = nt.nodes.new("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (1 / tile, 1 / tile, 1 / tile)
        nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = bpy.data.images.load(os.path.join(U.DL, "tex", tex), check_existing=True)
        t.projection = "BOX"
        t.projection_blend = 0.2
        nt.links.new(mp.outputs[0], t.inputs["Vector"])
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        nt.links.new(t.outputs["Color"], mix.inputs[6])
        mix.inputs[7].default_value = (*colour, 1)
        nt.links.new(mix.outputs[2], b.inputs["Base Color"])
        if nor:
            nm = nt.nodes.new("ShaderNodeNormalMap")
            ni = nt.nodes.new("ShaderNodeTexImage")
            ni.image = bpy.data.images.load(os.path.join(U.DL, "tex", nor), check_existing=True)
            ni.image.colorspace_settings.name = "Non-Color"
            ni.projection = "BOX"
            nt.links.new(mp.outputs[0], ni.inputs["Vector"])
            nt.links.new(ni.outputs["Color"], nm.inputs["Color"])
            nt.links.new(nm.outputs[0], b.inputs["Normal"])
    elif noise > 0:
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = 3.0
        nz.inputs["Detail"].default_value = 8.0
        nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].color = (*[c * (1 - noise) for c in colour], 1)
        ramp.color_ramp.elements[1].color = (*[min(1, c * (1 + noise)) for c in colour], 1)
        nt.links.new(nz.outputs["Fac"], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
        bump = nt.nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.6
        nz2 = nt.nodes.new("ShaderNodeTexNoise")
        nz2.inputs["Scale"].default_value = 40.0
        nz2.inputs["Detail"].default_value = 4.0
        nt.links.new(tc.outputs["Object"], nz2.inputs["Vector"])
        nt.links.new(nz2.outputs["Fac"], bump.inputs["Height"])
        nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    else:
        b.inputs["Base Color"].default_value = (*colour, 1)
    if sss:
        b.inputs["Subsurface Weight"].default_value = sss
    return m


def obj_from_bm(name, bm, mat, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = smooth
    ob = bpy.data.objects.new(name, me)
    me.materials.append(mat)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def blob(name, centre, radii, mat, seed, rough=0.35, subdiv=3):
    """A lumpy ellipsoid (shrub, crown, hill): an icosphere displaced by noise."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    rng = random.Random(seed)
    ph = [rng.uniform(0, 100) for _ in range(6)]
    for v in bm.verts:
        d = v.co.normalized()
        n = (math.sin(d.x * 3.1 + ph[0]) * math.sin(d.y * 2.7 + ph[1]) * math.sin(d.z * 3.3 + ph[2])
             + 0.5 * math.sin(d.x * 7.3 + ph[3]) * math.sin(d.y * 6.1 + ph[4]) * math.sin(d.z * 8.2 + ph[5]))
        v.co = Vector((d.x * radii[0], d.y * radii[1], d.z * radii[2])) * (1 + rough * n)
    ob = obj_from_bm(name, bm, mat)
    ob.location = centre
    return ob


def tree(i, x, z, h, crown, leaf_mats, bark, rng):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.07 * h / 3, radius2=0.04 * h / 3, depth=h)
    ob = obj_from_bm(f"trunk_{i}", bm, bark)
    ob.location = V(x, z, GROUND_Y + h / 2)
    for k in range(rng.randint(4, 7)):
        off = Vector((rng.uniform(-0.5, 0.5), rng.uniform(-0.5, 0.5), rng.uniform(-0.3, 0.5))) * crown
        blob(f"crown_{i}_{k}", V(x, z, GROUND_Y + h) + off, (crown * rng.uniform(0.55, 0.8),) * 2 + (crown * rng.uniform(0.5, 0.7),),
             rng.choice(leaf_mats), i * 31 + k, rough=0.3)


def birch(i, x, z, h, leaf, rng):
    bark = pbr(f"birch_bark_{i}", (0.85, 0.84, 0.80), 0.7)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.09, radius2=0.03, depth=h)
    ob = obj_from_bm(f"birch_{i}", bm, bark)
    ob.location = V(x, z, GROUND_Y + h / 2)
    ob.rotation_euler = (rng.uniform(-0.05, 0.05), rng.uniform(-0.05, 0.05), 0)
    for k in range(9):
        t = 0.45 + 0.55 * k / 8
        off = Vector((rng.uniform(-0.9, 0.9), rng.uniform(-0.9, 0.9), 0))
        blob(f"bcrown_{i}_{k}", V(x, z, GROUND_Y + h * t) + off, (rng.uniform(0.7, 1.1),) * 2 + (rng.uniform(0.6, 0.9),), leaf,
             i * 97 + k, rough=0.35, subdiv=2)


def main():
    scene = bpy.context.scene
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    rng = random.Random(3)
    # sky + sun (the village's look.json sun: ENE, low; it front-lights the garden seen looking west)
    w = bpy.data.worlds.new("G")
    scene.world = w
    nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(os.path.join(U.DL, "hdri", "kloppenheim_06_puresky_2k.hdr"))
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = 1.4
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(env.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs[0], out.inputs["Surface"])
    sd = bpy.data.lights.new("Sun", "SUN")
    sd.energy = 3.6
    sd.color = (1.0, 0.92, 0.80)
    sd.angle = math.radians(2.0)
    sun = bpy.data.objects.new("Sun", sd)
    scene.collection.objects.link(sun)
    az, el = math.radians(215), math.radians(34)
    d = V(math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)) - V(0, 0, 0)
    sun.rotation_mode = "QUATERNION"
    sun.rotation_quaternion = (-d).to_track_quat("-Z", "Y")

    import build_village  # noqa: F401  (fills vlib.MATSPEC with the village's leaf and bark materials)
    import parts_trees as PT
    lawn = pbr("lawn", (0.62, 0.95, 0.36), 0.95, tex="leafy_grass_diff_1k.jpg", tile=2.5, nor="leafy_grass_nor_gl_1k.jpg")
    path_m = pbr("path", (0.95, 0.93, 0.88), 0.7, tex="precast_stone_paving_diff_1k.jpg", tile=2.0,
                 nor="precast_stone_paving_nor_gl_1k.jpg")
    hill = pbr("hill", (0.05, 0.11, 0.04), 0.95, noise=0.4)
    ridge = pbr("ridge", (0.24, 0.32, 0.38), 1.0, noise=0.1)

    def flat(name, x0, x1, z0, z1, y, mat):
        bm = bmesh.new()
        vs = [bm.verts.new(V(*q)) for q in ((x0, z0, y), (x1, z0, y), (x1, z1, y), (x0, z1, y))]
        bm.faces.new(vs)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        ob = obj_from_bm(name, bm, mat, smooth=False)
        if ob.data.polygons[0].normal.z < 0:
            ob.data.flip_normals()
        return ob
    flat("ground", 100.0, 295.0, -150.0, 150.0, GROUND_Y, lawn)
    flat("path", 286.9, 288.3, -60.0, 60.0, GROUND_Y + 0.01, path_m)
    hills = []
    for k, (hx, hz, rx, rz, ry) in enumerate([(185, -40, 40, 30, 18), (175, 10, 45, 35, 24), (190, 50, 35, 30, 16),
                                              (160, -10, 50, 60, 30)]):
        hills.append(blob(f"hill_{k}", V(hx, hz, GROUND_Y - ry * 0.25), (rx, rz, ry), hill, 40 + k, rough=0.08, subdiv=4))
    for k, (hx, hz, rx, rz, ry) in enumerate([(60, -60, 80, 80, 45), (40, 30, 90, 80, 55), (70, 110, 70, 60, 40)]):
        blob(f"ridge_{k}", V(hx, hz, GROUND_Y - ry * 0.35), (rx, rz, ry), ridge, 70 + k, rough=0.06, subdiv=4)
    coll = scene.collection
    F = PT.Forest(bark_m="LM_bark")
    # clipped hedge (dense low leaf cards) with flowering shrubs in front
    for k in range(60):
        z = -30 + k * 1.0
        PT.shrub(F, 289.7 + rng.uniform(-0.1, 0.1), z, 0.75, 0.7, 500 + k, y0=GROUND_Y)
        if rng.random() < 0.35:
            PT.shrub(F, 290.5, z + rng.uniform(-0.4, 0.4), 0.45, 0.45, 900 + k, m="M_leaf_flora", y0=GROUND_Y)
    # rows of young memorial trees (수목장)
    for row, x in enumerate((282.0, 277.0, 272.0, 267.0, 262.0)):
        for k in range(-8, 9):
            z = k * 3.6 + (1.8 if row % 2 else 0) + rng.uniform(-0.25, 0.25)
            h = rng.uniform(2.6, 3.4)
            PT.tree(F, x + rng.uniform(-0.3, 0.3), z, "young", h, h * 0.3, 300 + row * 40 + k, y0=GROUND_Y)
    # big broadleaves and cherries behind the field
    for k in range(22):
        x = rng.uniform(232, 252)
        z = rng.uniform(-45, 45)
        h = rng.uniform(7, 11)
        PT.tree(F, x, z, "green" if k % 5 else "zelkova", h, h * 0.4, 700 + k, y0=GROUND_Y)
    # forest on the hills: crossed cards dropped onto the hill surfaces
    from mathutils.bvhtree import BVHTree
    dg = bpy.context.evaluated_depsgraph_get()
    trees_far = PT.Forest(bark_m="LM_bark")
    for hob in hills:
        bvh = BVHTree.FromObject(hob, dg)
        mw = hob.matrix_world
        inv = mw.inverted()
        for k in range(900):
            gx, gz = rng.uniform(110, 235), rng.uniform(-90, 90)
            o = inv @ V(gx, gz, 200)
            d = (inv.to_3x3() @ Vector((0, 0, -1))).normalized()
            hit = bvh.ray_cast(o, d)
            if hit[0] is None:
                continue
            wp = mw @ hit[0]
            PT.far_tree(trees_far, gx, gz, wp.z - 1.0, rng.uniform(7, 11), 5000 + k)
    F.finish("garden", coll)
    trees_far.finish("garden_far", coll)

    # camera: from the room centre, image plane parallel to the card
    G = GARDEN
    dist = EYE[0] - G["x"]
    width = G["z1"] - G["z0"]
    height = G["y1"] - G["y0"]
    cd = bpy.data.cameras.new("gcam")
    cd.sensor_fit = "HORIZONTAL"
    cd.sensor_width = 36.0
    cd.lens = 36.0 / 2 / ((width / 2) / dist)
    cd.shift_y = (((G["y0"] + G["y1"]) / 2) - EYE[2]) / width
    cd.shift_x = -(((G["z0"] + G["z1"]) / 2) - EYE[1]) / width
    cd.clip_start = 0.1
    cd.clip_end = 2000
    cam = bpy.data.objects.new("gcam", cd)
    scene.collection.objects.link(cam)
    cam.location = V(*EYE[:2], EYE[2])
    tgt = V(EYE[0] - 10, EYE[1], EYE[2])
    cam.rotation_mode = "QUATERNION"
    cam.rotation_quaternion = (tgt - cam.location).to_track_quat("-Z", "Y")
    scene.camera = cam
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    try:
        prefs.compute_device_type = "OPTIX"
        prefs.get_devices()
        for dv in prefs.devices:
            dv.use = dv.type == "OPTIX"
        scene.cycles.device = "GPU"
    except Exception as e:
        print("gpu", e)
    scene.cycles.samples = arg("--samples", 256, int)
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 2800
    scene.render.resolution_y = int(round(2800 * height / width))
    scene.view_settings.view_transform = "AgX"
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass
    scene.view_settings.exposure = 0.0
    # aerial perspective: a little mist pass is not available in the plain render; use the compositor-free look
    os.makedirs(OUT, exist_ok=True)
    scene.render.filepath = os.path.join(OUT, "garden_raw.png")
    bpy.ops.render.render(write_still=True)
    print("WROTE", scene.render.filepath)


if __name__ == "__main__":
    main()
