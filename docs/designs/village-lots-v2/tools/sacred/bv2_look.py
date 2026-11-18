# 본존불 v2 — quick review renders of a .blend (or a GLB): views around the visible meshes, one PNG each + a contact sheet.
#   blender -b <file.blend> -P bv2_look.py -- <out_prefix> [views=front,q34,side,back] [engine=WB|CY] [size=700] [focus=all|face|hands]
import bpy, sys, math, os
from mathutils import Vector
a = sys.argv[sys.argv.index("--") + 1:]
PRE = a[0]; VIEWS = (a[1] if len(a) > 1 else "front,q34,side,back").split(","); ENG = a[2] if len(a) > 2 else "WB"
SIZE = int(a[3]) if len(a) > 3 else 700; FOCUS = a[4] if len(a) > 4 else "all"
sc = bpy.context.scene
if PRE.endswith("@glb"):
    pass
objs = [o for o in sc.objects if o.type == "MESH" and o.visible_get() and not o.name.endswith("_phone")]
for o in sc.objects:
    if o.type == "MESH" and o.name.endswith("_phone"): o.hide_render = True
dg = bpy.context.evaluated_depsgraph_get()
pts = []
for o in objs:
    oe = o.evaluated_get(dg); m = oe.to_mesh()
    mw = o.matrix_world
    vs = m.vertices
    step = max(1, len(vs) // 20000)
    pts += [mw @ vs[i].co for i in range(0, len(vs), step)]
    oe.to_mesh_clear()
mn = Vector([min(p[i] for p in pts) for i in range(3)]); mx = Vector([max(p[i] for p in pts) for i in range(3)])
c = (mn + mx) / 2; ext = max(mx - mn)
if FOCUS.startswith("box:"):
    x0, y0, z0, x1, y1, z1 = map(float, FOCUS[4:].split("/")); c = Vector(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)); ext = max(x1 - x0, y1 - y0, z1 - z0)
cam_d = bpy.data.cameras.new("c"); cam_d.type = "ORTHO"; cam_d.ortho_scale = ext * 1.08
cam = bpy.data.objects.new("lookcam", cam_d); sc.collection.objects.link(cam); sc.camera = cam
DIRS = {"front": (0, -1, 0.05), "q34": (-0.7, -0.7, 0.12), "q34r": (0.7, -0.7, 0.12), "side": (-1, 0, 0.05), "sider": (1, 0, 0.05), "back": (0, 1, 0.05),
        "top": (0, -0.2, 1), "low": (0, -1, -0.25), "high": (0, -1, 0.5)}
sc.render.resolution_x = SIZE; sc.render.resolution_y = SIZE; sc.render.film_transparent = False
if ENG == "WB":
    try: sc.render.engine = "BLENDER_WORKBENCH"
    except TypeError as e: print(e)
    sh = sc.display.shading; sh.light = "MATCAP" if os.environ.get("MATCAP") else "STUDIO"; sh.color_type = "SINGLE"; sh.single_color = (0.78, 0.6, 0.32)
    sh.show_cavity = True; sh.cavity_type = "BOTH"; sh.show_shadows = False; sh.show_specular_highlight = True
    if os.environ.get("MATCOL"): sh.color_type = "MATERIAL"
else:
    try: sc.render.engine = "CYCLES"
    except TypeError as e: print(e)
    sc.cycles.samples = 48; sc.cycles.device = "CPU"; sc.cycles.use_denoising = True
    w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND"); bg.inputs["Color"].default_value = (0.25, 0.2, 0.16, 1); bg.inputs["Strength"].default_value = 0.6
    for nm, loc, en, sz in (("key", (-2.5, -3.5, 4), 900, 2.5), ("fill", (3, -2.5, 2), 300, 3), ("rim", (1, 3, 3.5), 500, 2)):
        ld = bpy.data.lights.new(nm, "AREA"); ld.energy = en * (ext / 2) ** 2; ld.size = sz * ext / 2
        lo = bpy.data.objects.new(nm, ld); sc.collection.objects.link(lo); lo.location = c + Vector(loc) * ext / 2
        lo.rotation_euler = (c - lo.location).to_track_quat("-Z", "Y").to_euler()
outs = []
for v in VIEWS:
    d = Vector(DIRS[v]).normalized()
    cam.location = c + d * ext * 3; cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    cam_d.clip_end = ext * 10
    sc.render.filepath = os.path.abspath(f"{PRE}_{v}.png"); bpy.ops.render.render(write_still=True); outs.append(sc.render.filepath)
print("BV2LOOK", outs)
