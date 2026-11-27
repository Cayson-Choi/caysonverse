"""Red pine (소나무) needle cards for the temple pines, rendered from real 3D needles in Blender (2026-11-21).

    blender -b -t 4 --factory-startup -P docs/designs/temple-pines/tools/render_pine_needles.py -- <out dir>

Builds shoots of Pinus densiflora as geometry (a woody shoot, the needles in pairs, 8-12 cm, thin three-sided blades, fanning
forward and out round the last 12-15 cm of each shoot, a bud at the tip) and renders two cells with a transparent film:
  - `spray` (512 x 512): a branchlet seen from above: a twig from the cell's bottom middle with 6-8 shoots fanned out flat, their
    needle tufts overlapping: a piece of a horizontal needle pad (the pad's TOP face);
  - `tuft`  (512 x 512): the same from the side: the tufts standing up like brushes along a level twig (a pad's rim / its silhouette).
The light is a soft sky and a weak sun from above, so the inside of a tuft is darker than its tips (the needles shade one another).
Writes needles_spray.png and needles_tuft.png (RGBA); compose_pine_atlas.py packs them.
"""
import math
import random
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "."
R = random.Random(2117)


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, rgb, rough=0.6, sss=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Roughness"].default_value = rough
    return m


def needle_mesh(bm, base: Vector, d: Vector, length: float, width: float, colour_layer, col):
    """A thin three-sided needle from `base` along `d`, tapering to a point, slightly curved."""
    d = d.normalized()
    side = d.cross(Vector((0, 0, 1)))
    if side.length < 0.1:
        side = d.cross(Vector((1, 0, 0)))
    side.normalize()
    up = side.cross(d).normalized()
    sag = Vector((0, 0, -1)) * length * 0.06
    rings = []
    for i, t in enumerate((0.0, 0.5)):
        c = base + d * (length * t) + sag * (t * t)
        w = width * (1 - t * 0.35)
        ring = []
        for k in range(3):
            a = k * 2 * math.pi / 3
            ring.append(bm.verts.new(c + (side * math.cos(a) + up * math.sin(a)) * w))
        rings.append(ring)
    tip = bm.verts.new(base + d * length + sag)
    faces = []
    for k in range(3):
        k1 = (k + 1) % 3
        faces.append(bm.faces.new((rings[0][k], rings[0][k1], rings[1][k1], rings[1][k])))
        faces.append(bm.faces.new((rings[1][k], rings[1][k1], tip)))
    for f in faces:
        for loop in f.loops:
            # the tip lighter / yellower than the sheath end
            t = (loop.vert.co - base).dot(d) / length
            loop[colour_layer] = (col[0] * (0.75 + 0.4 * t), col[1] * (0.8 + 0.35 * t), col[2] * (0.85 + 0.2 * t), 1)


def tube(bm, pts, r0, r1, sides, colour_layer, col):
    rings = []
    for i, p in enumerate(pts):
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        side = d.cross(Vector((0, 0, 1)))
        if side.length < 0.1:
            side = d.cross(Vector((1, 0, 0)))
        side.normalize()
        up = side.cross(d).normalized()
        r = r0 + (r1 - r0) * i / (len(pts) - 1)
        rings.append([bm.verts.new(p + (side * math.cos(a) + up * math.sin(a)) * r) for a in (k * 2 * math.pi / sides for k in range(sides))])
    for a, b in zip(rings, rings[1:]):
        for k in range(sides):
            f = bm.faces.new((a[k], a[(k + 1) % sides], b[(k + 1) % sides], b[k]))
            for loop in f.loops:
                loop[colour_layer] = (*col, 1)


def shoot(bm, cl, start: Vector, d: Vector, length: float, needles: int, spread: float, lift: float):
    """A shoot: its woody axis, then needle pairs round its last part fanning forward and out, a bud at the tip."""
    d = d.normalized()
    pts = [start + d * (length * i / 6) + Vector((0, 0, lift * (i / 6) ** 2 * length)) for i in range(7)]
    tube(bm, pts, 0.0045, 0.003, 5, cl, (0.3, 0.26, 0.14))
    tip = pts[-1]
    bud = [tip + (pts[-1] - pts[-2]).normalized() * 0.018 * i for i in range(3)]
    tube(bm, bud, 0.005, 0.0015, 5, cl, (0.45, 0.28, 0.17))
    axis = (pts[-1] - pts[-3]).normalized()
    for n in range(needles):
        t = 0.45 + 0.55 * (n / needles) ** 0.7
        i = min(5, int(t * 6))
        u = t * 6 - i
        p = pts[i].lerp(pts[i + 1], u)
        az = n * 2.39996 + R.random() * 0.4
        side = axis.cross(Vector((0, 0, 1)))
        if side.length < 0.1:
            side = axis.cross(Vector((1, 0, 0)))
        side.normalize()
        up = side.cross(axis).normalized()
        ring = side * math.cos(az) + up * math.sin(az)
        # the needles lean forward along the shoot, more open lower down, the youngest at the tip almost along it
        open_ = spread * (1.1 - 0.55 * t) * (0.8 + 0.4 * R.random())
        nd = (axis * math.cos(open_) + ring * math.sin(open_)).normalized()
        L = (0.08 + 0.04 * R.random()) * (0.85 + 0.25 * t)
        g = 0.75 + 0.5 * R.random()
        col = (0.15 * g, 0.25 * g, 0.075 * g) if R.random() > 0.2 else (0.2 * g, 0.27 * g, 0.09 * g)
        # a pair from one sheath, splayed a little
        tw = ring.cross(nd).normalized() * 0.08
        needle_mesh(bm, p, (nd + tw), L, 0.0024, cl, col)
        needle_mesh(bm, p, (nd - tw), L * (0.94 + 0.1 * R.random()), 0.0024, cl, col)


def build(kind):
    me = bpy.data.meshes.new(kind)
    bm = bmesh.new()
    cl = bm.loops.layers.color.new("Col")
    if kind == "spray":
        # a twig up the picture (+y here is the picture's up, the camera above), side twigs off it, each with 2-4 shoots: the
        # tufts overlap into one dense mass (a pad seen from above), a little sky between the shoots near the edge
        twig = [Vector((0.01 * math.sin(i * 1.3), -0.345 + 0.055 * i, 0.0)) for i in range(11)]
        tube(bm, twig, 0.008, 0.004, 6, cl, (0.22, 0.15, 0.11))
        n = 8
        for k in range(n):
            t = k / (n - 1)
            p = twig[0].lerp(twig[-1], 0.18 + 0.8 * t)
            side = -1 if k % 2 else 1
            ang = (0.5 + 0.8 * (1 - t)) * side + (R.random() - 0.5) * 0.25
            d = Vector((math.sin(ang), math.cos(ang), 0.0))
            L = 0.07 + 0.14 * (1 - t) + 0.03 * R.random()
            sub = [p + d * (L * i / 4) for i in range(5)]
            tube(bm, sub, 0.0045, 0.003, 5, cl, (0.24, 0.16, 0.11))
            for j in range(3):
                q = sub[0].lerp(sub[-1], 0.45 + 0.27 * j)
                a2 = ang + (j - 1) * 0.55 + (R.random() - 0.5) * 0.3
                shoot(bm, cl, q, Vector((math.sin(a2), math.cos(a2), 0.08)), 0.05 + 0.03 * R.random(), 95, 1.15, 0.15)
            shoot(bm, cl, sub[-1], d + Vector((0, 0, 0.1)), 0.06, 100, 1.05, 0.15)
        shoot(bm, cl, twig[-1], Vector((0.05, 1, 0.08)), 0.07, 110, 1.0, 0.15)
    else:
        # a level twig along x; shoots rising from it in two rows (depth), each a dense brush of needles pointing up and out
        twig = [Vector((-0.27 + 0.0675 * i, 0, -0.33 + 0.008 * math.sin(i))) for i in range(9)]
        tube(bm, twig, 0.009, 0.006, 6, cl, (0.22, 0.15, 0.11))
        n = 11
        for k in range(n):
            t = k / (n - 1)
            p = twig[0].lerp(twig[-1], 0.04 + 0.92 * t) + Vector((0, (k % 2) * 0.05 - 0.02, 0))
            lean = (t - 0.5) * 0.9 + (R.random() - 0.5) * 0.35
            d = Vector((math.sin(lean), (R.random() - 0.5) * 0.5, math.cos(lean)))
            shoot(bm, cl, p, d, 0.16 + 0.12 * R.random(), 120, 0.8, 0.0)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(kind, me)
    bpy.context.scene.collection.objects.link(ob)
    m = bpy.data.materials.new("needles")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    attr = nt.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Col"
    nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.55
    me.materials.append(m)
    return ob


def render(kind, path):
    clear()
    sc = bpy.context.scene
    try:
        sc.render.engine = "CYCLES"
    except TypeError:
        pass
    sc.cycles.samples = 96
    sc.cycles.use_denoising = True
    sc.render.film_transparent = True
    sc.render.resolution_x = 512
    sc.render.resolution_y = 512
    sc.view_settings.view_transform = "Standard"
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (0.62, 0.7, 0.8, 1)
    bg.inputs["Strength"].default_value = 0.85
    sc.world = world
    build(kind)
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 3.2
    sun.angle = 0.2
    so = bpy.data.objects.new("sun", sun)
    sc.collection.objects.link(so)
    cam = bpy.data.cameras.new("cam")
    cam.type = "ORTHO"
    cam.ortho_scale = 0.72
    co = bpy.data.objects.new("cam", cam)
    sc.collection.objects.link(co)
    sc.camera = co
    if kind == "spray":
        # from above, the picture's bottom at the twig's foot (y = -0.36)
        co.location = (0, 0.0, 2)
        co.rotation_euler = (0, 0, 0)
        so.rotation_euler = (math.radians(25), math.radians(-20), 0)
    else:
        co.location = (0, -2, 0.0)
        co.rotation_euler = (math.radians(90), 0, 0)
        so.rotation_euler = (math.radians(20), math.radians(15), 0)
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


render("spray", f"{OUT}/needles_spray.png")
render("tuft", f"{OUT}/needles_tuft.png")
