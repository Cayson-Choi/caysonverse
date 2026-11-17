"""
케이슨랜드 별똥별 급행의 열차 한 칸을 만든다 (Blender, 한 프로세스):

    "C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" --background --python tools/land/make_coaster_car.py -- <out_dir>

결과: <out_dir>/coaster_car.glb (재질 이름: car_paint, car_gold, car_white, car_chrome, car_pad, car_dark, car_rubber) 와
<out_dir>/coaster_car_ao.png (한 장의 AO 굽기, 첫 번째 UV).

차 공간(게임): +z 앞, +y 위, +x 왼쪽, 원점은 레일 중심선. 길이 약 2.9 m, 폭 약 2.0 m. 좌석 윗면은 y 0.52, 눈은 0.52 + 0.86
(shared/land/coaster.ts SEAT_TOP, EYE_ABOVE_SEAT). 블렌더 좌표로는 (x, -z, y).

모양: 모서리를 모두 모따기한 깔끔한 패널 선체와 뾰족한 코, 날카로운 도색 줄무늬(별 금색 + 흰 가는 줄), 크롬 몰딩, 옆 바퀴 조립체,
차 색으로 성형한 유리섬유 시트 쉘 + 따로 붙은 검은 패딩 머리받침과 방석, 패딩 안전바와 손잡이. 곡면 부풀림(서브디비전)은 쓰지 않는다.
"""
import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector

OUT = os.path.abspath(sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.join(os.getcwd(), "out"))
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def B(x, y, z):
    """game (x left, y up, z forward) -> blender (x, -z, y)"""
    return Vector((x, -z, y))


# ───────────────────────────── materials ─────────────────────────────
def mat(name, color, metallic=0.0, rough=0.5, coat=0.0, coat_rough=0.05):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    p.inputs["Base Color"].default_value = (color[0], color[1], color[2], 1.0)
    p.inputs["Metallic"].default_value = metallic
    p.inputs["Roughness"].default_value = rough
    for k, v in (("Coat Weight", coat), ("Coat Roughness", coat_rough)):
        if k in p.inputs:
            p.inputs[k].default_value = v
    return m


M = {
    "car_paint": mat("car_paint", (0.08, 0.10, 0.52), 0.35, 0.26, 1.0, 0.04),
    "car_gold": mat("car_gold", (0.95, 0.62, 0.12), 0.7, 0.28, 0.6),
    "car_white": mat("car_white", (0.92, 0.9, 0.86), 0.0, 0.35, 0.8),
    "car_chrome": mat("car_chrome", (0.86, 0.87, 0.9), 1.0, 0.13),
    "car_pad": mat("car_pad", (0.025, 0.025, 0.03), 0.0, 0.62),
    "car_dark": mat("car_dark", (0.07, 0.07, 0.09), 0.2, 0.45),
    "car_rubber": mat("car_rubber", (0.02, 0.02, 0.022), 0.0, 0.85),
}

parts = []


def finish(obj, mname, bevel=0.0, segs=3, smooth=True):
    obj.data.materials.append(M[mname])
    if bevel > 0:
        md = obj.modifiers.new("bev", "BEVEL")
        md.width = bevel
        md.segments = segs
        md.limit_method = "ANGLE"
        md.angle_limit = math.radians(35)
        md.harden_normals = False
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.modifier_apply(modifier=md.name)
        obj.select_set(False)
    parts.append(obj)
    return obj


def box(name, size, loc, mname, bevel=0.0, segs=3, rot=(0, 0, 0), taper=None):
    """size/loc in GAME coordinates (x, y, z); taper = (front_scale_x, front_scale_y, z_front_boundary) squeezes the +z end."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= size[0]
        v.co.y *= size[2]  # game z (forward) -> blender -y; the cube is symmetric so sign only matters for taper
        v.co.z *= size[1]
    if taper:
        sx, sz, _ = taper
        for v in bm.verts:
            if v.co.y < 0:  # the front end (blender -y = game +z)
                v.co.x *= sx
                v.co.z *= sz
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    scene.collection.objects.link(obj)
    obj.location = B(*loc)
    obj.rotation_euler = (math.radians(-rot[0]), math.radians(rot[2]), math.radians(rot[1]))
    return finish(obj, mname, bevel, segs)


def cyl(name, p0, p1, r0, r1, mname, sides=16, bevel=0.0):
    a, b = B(*p0), B(*p1)
    d = b - a
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=sides, radius1=r0, radius2=r1, depth=d.length)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    scene.collection.objects.link(obj)
    obj.location = (a + b) / 2
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    return finish(obj, mname, bevel, 2)


def tube(name, pts, r, mname, sides=12):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = r
    cu.bevel_resolution = max(2, sides // 4)
    cu.use_fill_caps = True
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        w = B(*p)
        sp.points[i].co = (w.x, w.y, w.z, 1.0)
    obj = bpy.data.objects.new(name, cu)
    scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.view_layer.objects.active
    obj.select_set(False)
    return finish(obj, mname)


# ───────────────────────────── the hull ─────────────────────────────
box("tub", (1.96, 0.34, 2.72), (0, 0.30, -0.06), "car_paint", 0.07)
box("tub_skirt", (1.9, 0.1, 2.62), (0, 0.12, -0.06), "car_dark", 0.03)
box("nose", (1.9, 0.46, 0.7), (0, 0.4, 1.17), "car_paint", 0.06, 3, taper=(0.42, 0.55, 0))
box("hood", (1.72, 0.34, 0.62), (0, 0.76, 0.86), "car_paint", 0.08, 3, taper=(0.82, 0.7, 0))
box("hood_vent", (0.5, 0.02, 0.2), (0, 0.935, 0.84), "car_dark", 0.008)
box("rear_panel", (1.74, 0.34, 0.1), (0, 0.55, -1.36), "car_paint", 0.04)
for sx in (-1, 1):
    box(f"coaming_{sx}", (0.12, 0.22, 2.1), (sx * 0.93, 0.56, -0.25), "car_paint", 0.04)
    box(f"coaming_trim_{sx}", (0.05, 0.03, 2.08), (sx * 0.93, 0.678, -0.25), "car_chrome", 0.012, 2)
    # a sharp gold flank stripe, a white pinstripe under it, dark panel seams
    box(f"stripe_gold_{sx}", (0.012, 0.075, 2.05), (sx * 0.985, 0.34, -0.15), "car_gold", 0.004, 2)
    box(f"stripe_white_{sx}", (0.012, 0.016, 2.12), (sx * 0.985, 0.255, -0.15), "car_white", 0.003, 2)
    for z in (-0.95, -0.25, 0.45):
        box(f"seam_{sx}_{z}", (0.01, 0.3, 0.012), (sx * 0.985, 0.3, z), "car_dark", 0.002, 1)
    # wheel assemblies: a housing on the hull's lower flank with the wheel half out, an axle cap
    for z in (-0.95, -0.5, 0.55, 0.95):
        box(f"wheel_housing_{sx}_{z}", (0.2, 0.22, 0.3), (sx * 0.74, 0.1, z), "car_dark", 0.035)
        cyl(f"wheel_{sx}_{z}", (sx * 0.52, 0.0, z), (sx * 0.72, 0.0, z), 0.135, 0.135, "car_rubber", 20, 0.012)
        cyl(f"axle_cap_{sx}_{z}", (sx * 0.84, 0.0, z), (sx * 0.87, 0.0, z), 0.05, 0.05, "car_chrome", 12)
box("nose_band", (0.78, 0.045, 0.03), (0, 0.45, 1.5), "car_gold", 0.01, 2)
box("nose_bumper", (0.7, 0.05, 0.05), (0, 0.33, 1.48), "car_chrome", 0.018, 2)
box("floor_mat", (1.62, 0.02, 1.2), (0, 0.485, 0.12), "car_rubber", 0.006, 1)
for i in range(7):
    box(f"mat_rib_{i}", (1.56, 0.012, 0.018), (0, 0.5, -0.4 + i * 0.16), "car_dark", 0.004, 1)
box("coupler", (0.14, 0.1, 0.26), (0, 0.13, 1.6), "car_dark", 0.03)

# ───────────────────────────── seats and lap bars ─────────────────────────────
SEAT_TOP = 0.52
for sx in (-1, 1):
    x = sx * 0.42
    # moulded fibreglass shell in the car colour: a pan and an upright back leaning 7 degrees, edges crisp (small bevels)
    box(f"seat_pan_{sx}", (0.68, 0.1, 0.8), (x, SEAT_TOP - 0.06, -0.22), "car_paint", 0.045)
    box(f"seat_back_{sx}", (0.68, 0.86, 0.11), (x, SEAT_TOP + 0.42, -0.69), "car_paint", 0.05, 3, rot=(7, 0, 0))
    box(f"seat_back_rim_{sx}", (0.7, 0.012, 0.115), (x, SEAT_TOP + 0.855, -0.7), "car_chrome", 0.004, 1, rot=(7, 0, 0))
    # the padded black seat and back inserts
    box(f"pad_seat_{sx}", (0.56, 0.035, 0.66), (x, SEAT_TOP - 0.003, -0.2), "car_pad", 0.016)
    box(f"pad_back_{sx}", (0.52, 0.64, 0.035), (x, SEAT_TOP + 0.4, -0.633), "car_pad", 0.02, 3, rot=(7, 0, 0))
    # the separate padded headrest on two posts
    box(f"headrest_{sx}", (0.34, 0.22, 0.11), (x, SEAT_TOP + 1.0, -0.7), "car_pad", 0.05, 3, rot=(7, 0, 0))
    for dx in (-0.1, 0.1):
        cyl(f"headrest_post_{sx}_{dx}", (x + dx, SEAT_TOP + 0.84, -0.69), (x + dx, SEAT_TOP + 0.93, -0.7), 0.014, 0.014, "car_chrome", 8)
    # the seam line round the shell's front edge
    box(f"shell_seam_{sx}", (0.012, 0.8, 0.004), (x, SEAT_TOP + 0.4, -0.628), "car_dark", 0.001, 1, rot=(7, 0, 0))
    y0 = SEAT_TOP + 0.26
    path = [
        (x - 0.3, 0.44, 0.02), (x - 0.31, 0.6, 0.14), (x - 0.3, y0, 0.3), (x - 0.2, y0 + 0.07, 0.4), (x, y0 + 0.1, 0.43),
        (x + 0.2, y0 + 0.07, 0.4), (x + 0.3, y0, 0.3), (x + 0.31, 0.6, 0.14), (x + 0.3, 0.44, 0.02),
    ]
    tube(f"lap_bar_{sx}", path, 0.03, "car_chrome", 12)
    tube(f"lap_pad_{sx}", path[2:7], 0.085, "car_pad", 16)
    for sg in (-1, 1):
        cyl(f"lap_grip_{sx}_{sg}", (x + sg * 0.3, y0, 0.3), (x + sg * 0.27, y0 + 0.22, 0.42), 0.027, 0.023, "car_rubber", 12, 0.008)
tube("grab_bar", [(-0.8, 0.95, 0.92), (-0.8, 1.06, 0.94), (0, 1.09, 0.97), (0.8, 1.06, 0.94), (0.8, 0.95, 0.92)], 0.024, "car_chrome", 10)

# ───────────────────────────── one object, smooth, UV, AO ─────────────────────────────
bpy.ops.object.select_all(action="DESELECT")
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
car = bpy.context.view_layer.objects.active
car.name = "coaster_car"
try:
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(38))
except Exception:
    bpy.ops.object.shade_smooth()
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004)
bpy.ops.object.mode_set(mode="OBJECT")

SIZE = 1024
img = bpy.data.images.new("car_ao", SIZE, SIZE, alpha=False)
img_nodes = []
for m in car.data.materials:
    nt = m.node_tree
    n = nt.nodes.new("ShaderNodeTexImage")
    n.image = img
    nt.nodes.active = n
    img_nodes.append((m, n))

scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 48
scene.cycles.bake_type = "AO"
bpy.context.view_layer.objects.active = car
car.select_set(True)
try:
    scene.render.bake.margin = 6
    bpy.ops.object.bake(type="AO")
    img.filepath_raw = os.path.join(OUT, "coaster_car_ao.png")
    img.file_format = "PNG"
    img.save_render(img.filepath_raw)
    print("AO baked")
except Exception as e:  # the bake is a refinement; the model still exports
    print("AO bake failed:", e)
for m, n in img_nodes:
    m.node_tree.nodes.remove(n)

bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT, "coaster_car.glb"),
    export_format="GLB",
    export_apply=True,
    export_yup=True,
    export_materials="EXPORT",
    export_cameras=False,
    export_lights=False,
)
tris = sum(len(p.vertices) - 2 for p in car.data.polygons)
print("coaster_car triangles (approx):", tris, "objects joined:", len(parts))
