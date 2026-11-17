"""
케이슨랜드 달빛 회전목마(Moonlight Carousel)의 모델 세 개를 만든다 (Blender, 한 프로세스):

    "C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" --background --python tools/land/make_carousel.py -- <out_dir>

결과(<out_dir>):
  carousel_static.glb   돌아가는 부분 전체: 계단 둘레, 나무 바닥판, 가운데 기둥(거울 패널·금박 기둥), 둥근 차양(남색·크림 쐐기 24장, 금 장식, 스캘럽 가장자리),
                        띠 장식 판, 놋쇠 기둥 24개. 원점은 회전축의 바닥.
  carousel_horse.glb    말 한 마리(안장 자리가 원점, +z 가 앞): 조각한 몸통, 아치 목, 갈기·꼬리, 안장·고삐·가슴띠(금박), 말굽. 칠은 `horse_paint`(흰색 바탕)이고
                        게임이 말마다 색을 곱해요.
  carousel_carriage.glb 마차 하나(두 자리, 가운데 바닥이 원점): 배 모양 몸통, 금 소용돌이 장식, 벨벳 의자.
재질 이름: cr_* (정적), horse_*, car_*. 서브디비전 부풀림 없이 둥근 부분은 UV 구, 각진 부분은 모따기. 외부 자산·AI 없음.
좌표: 게임 좌표 (x 왼쪽, y 위, z 앞) -> 블렌더 (x, -z, y).
"""
import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector

OUT = os.path.abspath(sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.join(os.getcwd(), "out"))
os.makedirs(OUT, exist_ok=True)


def B(x, y, z):
    return Vector((x, -z, y))


def new_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def mat(name, color, metallic=0.0, rough=0.5, coat=0.0, coat_rough=0.06, emit=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    p.inputs["Base Color"].default_value = (color[0], color[1], color[2], 1.0)
    p.inputs["Metallic"].default_value = metallic
    p.inputs["Roughness"].default_value = rough
    for k, v in (("Coat Weight", coat), ("Coat Roughness", coat_rough)):
        if k in p.inputs:
            p.inputs[k].default_value = v
    if emit is not None and "Emission Color" in p.inputs:
        p.inputs["Emission Color"].default_value = (emit[0], emit[1], emit[2], 1.0)
        p.inputs["Emission Strength"].default_value = 1.0
    return m


class Builder:
    def __init__(self, mats):
        self.scene = new_scene()
        self.M = {k: mat(k, *v) if isinstance(v, tuple) else v for k, v in mats.items()}
        self.parts = []

    def _finish(self, obj, mname, bevel=0.0, segs=3):
        obj.data.materials.append(self.M[mname])
        if bevel > 0:
            md = obj.modifiers.new("bev", "BEVEL")
            md.width = bevel
            md.segments = segs
            md.limit_method = "ANGLE"
            md.angle_limit = math.radians(35)
            bpy.context.view_layer.objects.active = obj
            obj.select_set(True)
            bpy.ops.object.modifier_apply(modifier=md.name)
            obj.select_set(False)
        self.parts.append(obj)
        return obj

    def _link(self, name, bm, loc=(0, 0, 0)):
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        obj = bpy.data.objects.new(name, me)
        self.scene.collection.objects.link(obj)
        obj.location = B(*loc)
        return obj

    def box(self, name, size, loc, mname, bevel=0.0, segs=3, rot_y=0.0, rot_x=0.0, taper=None):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co.x *= size[0]
            v.co.y *= size[2]
            v.co.z *= size[1]
        if taper:
            for v in bm.verts:
                if v.co.y < 0:
                    v.co.x *= taper[0]
                    v.co.z *= taper[1]
        obj = self._link(name, bm, loc)
        obj.rotation_euler = (math.radians(rot_x), 0, math.radians(-rot_y))
        return self._finish(obj, mname, bevel, segs)

    def ellipsoid(self, name, center, radii, mname, rot_x=0.0, rot_y=0.0, seg=16, rings=10):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0)
        for v in bm.verts:
            v.co.x *= radii[0]
            v.co.y *= radii[2]
            v.co.z *= radii[1]
        obj = self._link(name, bm, center)
        obj.rotation_euler = (math.radians(rot_x), 0, math.radians(-rot_y))
        return self._finish(obj, mname)

    def cyl(self, name, p0, p1, r0, r1, mname, sides=12, bevel=0.0, cap=True):
        a, b = B(*p0), B(*p1)
        d = b - a
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=cap, segments=sides, radius1=r0, radius2=r1, depth=d.length)
        obj = self._link(name, bm)
        obj.location = (a + b) / 2
        obj.rotation_mode = "QUATERNION"
        obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
        return self._finish(obj, mname, bevel, 2)

    def tube(self, name, pts, r, mname, sides=10, taper_end=None):
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
            if taper_end is not None:
                sp.points[i].radius = 1.0 - (1.0 - taper_end) * i / max(1, len(pts) - 1)
        obj = bpy.data.objects.new(name, cu)
        self.scene.collection.objects.link(obj)
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.convert(target="MESH")
        obj = bpy.context.view_layer.objects.active
        obj.select_set(False)
        return self._finish(obj, mname)

    def disc(self, name, y0, y1, r, mname, sides=48, bevel=0.0):
        return self.cyl(name, (0, y0, 0), (0, y1, 0), r, r, mname, sides, bevel)

    def export(self, filename, smooth_angle=40.0):
        bpy.ops.object.select_all(action="DESELECT")
        for o in self.parts:
            o.select_set(True)
        bpy.context.view_layer.objects.active = self.parts[0]
        bpy.ops.object.join()
        obj = bpy.context.view_layer.objects.active
        obj.name = os.path.splitext(filename)[0]
        try:
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth_angle))
        except Exception:
            bpy.ops.object.shade_smooth()
        bpy.ops.export_scene.gltf(
            filepath=os.path.join(OUT, filename), export_format="GLB", export_apply=True, export_yup=True,
            export_materials="EXPORT", export_cameras=False, export_lights=False,
        )
        tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        print(filename, "triangles:", tris, "parts:", len(self.parts))


GOLD = (0.95, 0.66, 0.16)

# ═════════════════════════════ the rotating assembly ═════════════════════════════
S = Builder({
    "cr_stone": ((0.62, 0.6, 0.56), 0.0, 0.8),
    "cr_wood": ((0.52, 0.33, 0.18), 0.0, 0.55, 0.4, 0.2),
    "cr_gold": (GOLD, 0.85, 0.3, 0.5, 0.1),
    "cr_cream": ((0.95, 0.91, 0.82), 0.0, 0.4, 0.8, 0.1),
    "cr_indigo": ((0.08, 0.1, 0.48), 0.1, 0.35, 0.9, 0.06),
    "cr_mirror": ((0.92, 0.95, 1.0), 1.0, 0.04),
    "cr_brass": ((0.9, 0.7, 0.28), 1.0, 0.22),
    "cr_red": ((0.55, 0.06, 0.1), 0.0, 0.6),
    "cr_dark": ((0.07, 0.06, 0.07), 0.0, 0.6),
})
DECK = 0.55
CANOPY = 8.6
APEX = 12.9
# steps and the platform
S.disc("step", 0.0, 0.3, 13.7, "cr_stone", 64, 0.06)
S.disc("deck", 0.3, DECK, 12.5, "cr_wood", 64, 0.05)
S.disc("deck_rim", DECK - 0.02, DECK + 0.12, 12.55, "cr_gold", 64, 0.03)
for r, mn in ((11.4, "cr_gold"), (7.9, "cr_cream"), (5.2, "cr_gold")):
    S.disc(f"deck_inlay_{r}", DECK - 0.005, DECK + 0.012, r, mn, 64)
    S.disc(f"deck_inlay_in_{r}", DECK - 0.002, DECK + 0.016, r - 0.12, "cr_wood", 64)
# the central column: a drum with mirror panels between gilded pilasters, a gilded cap
S.disc("column", DECK, CANOPY, 1.7, "cr_cream", 24, 0.04)
S.disc("column_base", DECK, DECK + 0.7, 2.1, "cr_gold", 24, 0.05)
S.disc("column_cap", CANOPY - 0.9, CANOPY, 2.35, "cr_gold", 24, 0.05)
for k in range(12):
    a = (k + 0.5) / 12 * math.tau
    x, z = math.sin(a) * 1.72, -math.cos(a) * 1.72
    S.box(f"mirror_{k}", (0.95, 5.2, 0.05), (x, DECK + 3.6, z), "cr_mirror", 0.01, 2, rot_y=-math.degrees(a))
    S.box(f"mirror_frame_{k}", (1.05, 5.3, 0.04), (x * 0.995, DECK + 3.6, z * 0.995), "cr_gold", 0.012, 2, rot_y=-math.degrees(a))
    a2 = k / 12 * math.tau
    S.cyl(f"pilaster_{k}", (math.sin(a2) * 1.75, DECK + 0.7, -math.cos(a2) * 1.75), (math.sin(a2) * 1.75, CANOPY - 0.9, -math.cos(a2) * 1.75), 0.1, 0.1, "cr_gold", 10)
# the rounding board: a band under the canopy rim, painted panels in gilded frames
S.disc("band", CANOPY - 1.25, CANOPY, 13.15, "cr_indigo", 64, 0.02)
S.disc("band_trim_top", CANOPY - 0.07, CANOPY + 0.1, 13.28, "cr_gold", 64, 0.03)
S.disc("band_trim_bottom", CANOPY - 1.3, CANOPY - 1.18, 13.25, "cr_gold", 64, 0.03)
for k in range(24):
    a = (k + 0.5) / 24 * math.tau
    x, z = math.sin(a) * 13.2, -math.cos(a) * 13.2
    S.box(f"panel_{k}", (1.7, 0.78, 0.06), (x, CANOPY - 0.62, z), "cr_cream" if k % 2 else "cr_red", 0.015, 2, rot_y=-math.degrees(a))
    S.box(f"panel_frame_{k}", (1.84, 0.92, 0.04), (x * 0.998, CANOPY - 0.62, z * 0.998), "cr_gold", 0.02, 2, rot_y=-math.degrees(a))
    # a scalloped flap hanging below the band
    S.ellipsoid(f"scallop_{k}", (math.sin(a) * 13.15, CANOPY - 1.4, -math.cos(a) * 13.15), (0.74, 0.34, 0.14), "cr_gold" if k % 2 else "cr_cream", seg=10, rings=6, rot_y=-math.degrees(a))
# the canopy: 24 wedges, alternating indigo and cream, rising from the rim to the apex
for k in range(24):
    a0 = k / 24 * math.tau
    a1 = (k + 1) / 24 * math.tau
    bm = bmesh.new()
    rim_r = 13.4
    inner = []
    pts = [
        (0, APEX, 0),
        (math.sin(a0) * rim_r, CANOPY + 0.1, -math.cos(a0) * rim_r),
        (math.sin(a1) * rim_r, CANOPY + 0.1, -math.cos(a1) * rim_r),
    ]
    vs = [bm.verts.new(B(*p)) for p in pts]
    # a slightly convex wedge: add a midpoint of the rim pushed outward
    mid = (math.sin((a0 + a1) / 2) * (rim_r + 0.2), CANOPY + 0.0, -math.cos((a0 + a1) / 2) * (rim_r + 0.2))
    vm = bm.verts.new(B(*mid))
    bm.faces.new([vs[0], vs[1], vm])
    bm.faces.new([vs[0], vm, vs[2]])
    obj = S._link(f"wedge_{k}", bm)
    # thicken into a shell
    sol = obj.modifiers.new("sol", "SOLIDIFY")
    sol.thickness = 0.1
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    obj.data.materials.append(S.M["cr_indigo" if k % 2 == 0 else "cr_cream"])
    bpy.ops.object.modifier_apply(modifier="sol")
    obj.select_set(False)
    S.parts.append(obj)
    # a gilded rib along the wedge's seam
    S.cyl(f"rib_{k}", (0, APEX, 0), (math.sin(a0) * (rim_r + 0.05), CANOPY + 0.12, -math.cos(a0) * (rim_r + 0.05)), 0.07, 0.1, "cr_gold", 8)
S.ellipsoid("finial_ball", (0, APEX + 0.45, 0), (0.55, 0.55, 0.55), "cr_gold", seg=16, rings=10)
S.cyl("finial_spire", (0, APEX + 0.6, 0), (0, APEX + 2.2, 0), 0.16, 0.02, "cr_gold", 10)
S.ellipsoid("finial_moon", (0.0, APEX + 1.7, 0), (0.0, 0.0, 0.0), "cr_gold", seg=6, rings=4) if False else None
# the poles: brass, from the deck to the canopy, at every seat position
RINGS = ((9.6, 12, 0.0), (6.6, 8, 0.0), (3.8, 2, math.pi / 2))
for r, n, off in RINGS:
    for i in range(n):
        a = i / n * math.tau + off if r != 3.8 else i * math.pi
        S.cyl(f"pole_{r}_{i}", (math.sin(a) * r, DECK, -math.cos(a) * r), (math.sin(a) * r, CANOPY - 0.2, -math.cos(a) * r), 0.045, 0.045, "cr_brass", 10)
        S.disc(f"pole_foot_{r}_{i}", DECK, DECK + 0.08, 0.1, "cr_gold", 12) if False else None
S.export("carousel_static.glb")

# ═════════════════════════════ a horse ═════════════════════════════
H = Builder({
    "horse_paint": ((0.92, 0.9, 0.86), 0.0, 0.35, 0.9, 0.08),
    "horse_gold": (GOLD, 0.85, 0.3, 0.5, 0.1),
    "horse_red": ((0.5, 0.05, 0.09), 0.0, 0.55, 0.3),
    "horse_indigo": ((0.08, 0.1, 0.5), 0.0, 0.5, 0.4),
    "horse_dark": ((0.06, 0.05, 0.05), 0.0, 0.45),
    "horse_mane": ((0.97, 0.93, 0.82), 0.0, 0.55, 0.3),
})
# the body: torso, chest, rump (the saddle point is the origin)
H.ellipsoid("torso", (0, -0.2, 0), (0.3, 0.36, 0.78), "horse_paint", seg=18, rings=12)
H.ellipsoid("chest", (0, -0.12, 0.52), (0.29, 0.38, 0.4), "horse_paint", seg=16, rings=10)
H.ellipsoid("rump", (0, -0.14, -0.52), (0.31, 0.36, 0.4), "horse_paint", seg=16, rings=10)
H.ellipsoid("belly", (0, -0.38, 0.0), (0.26, 0.22, 0.6), "horse_paint", seg=14, rings=8)
# the arched neck and the head
H.cyl("neck_low", (0, 0.05, 0.62), (0, 0.38, 0.8), 0.2, 0.16, "horse_paint", 14)
H.cyl("neck_high", (0, 0.38, 0.8), (0, 0.62, 0.95), 0.16, 0.12, "horse_paint", 14)
H.ellipsoid("head", (0, 0.66, 1.1), (0.13, 0.15, 0.3), "horse_paint", rot_x=38.0, seg=16, rings=10)
H.ellipsoid("muzzle", (0, 0.5, 1.34), (0.1, 0.1, 0.14), "horse_paint", rot_x=38.0, seg=12, rings=8)
H.ellipsoid("nostril_l", (0.05, 0.47, 1.45), (0.025, 0.02, 0.025), "horse_dark", seg=6, rings=4)
H.ellipsoid("nostril_r", (-0.05, 0.47, 1.45), (0.025, 0.02, 0.025), "horse_dark", seg=6, rings=4)
for sx in (-1, 1):
    H.cyl(f"ear_{sx}", (sx * 0.07, 0.8, 0.98), (sx * 0.085, 0.99, 0.95), 0.045, 0.01, "horse_paint", 8)
    H.ellipsoid(f"eye_{sx}", (sx * 0.125, 0.7, 1.15), (0.03, 0.035, 0.035), "horse_dark", seg=8, rings=6)
    H.ellipsoid(f"eye_gold_{sx}", (sx * 0.118, 0.7, 1.15), (0.045, 0.05, 0.05), "horse_gold", seg=8, rings=6)
# four legs: thigh, knee, cannon, a gold hoof; the forelegs raised and bent, the hind legs set back
for sx in (-1, 1):
    x = sx * 0.17
    H.cyl(f"fore_up_{sx}", (x, -0.3, 0.52), (x, -0.62, 0.8), 0.12, 0.075, "horse_paint", 12)
    H.cyl(f"fore_low_{sx}", (x, -0.62, 0.8), (x, -0.98, 0.7), 0.065, 0.05, "horse_paint", 10)
    H.cyl(f"fore_hoof_{sx}", (x, -0.98, 0.7), (x, -1.08, 0.7), 0.065, 0.075, "horse_gold", 10)
    H.cyl(f"hind_up_{sx}", (x, -0.3, -0.52), (x, -0.68, -0.68), 0.14, 0.08, "horse_paint", 12)
    H.cyl(f"hind_low_{sx}", (x, -0.68, -0.68), (x, -1.03, -0.5), 0.07, 0.05, "horse_paint", 10)
    H.cyl(f"hind_hoof_{sx}", (x, -1.03, -0.5), (x, -1.13, -0.5), 0.065, 0.078, "horse_gold", 10)
# the mane (a ribbon of cream along the crest, with curls) and the tail
H.tube("mane", [(0, 0.1, 0.64), (0, 0.42, 0.78), (0, 0.67, 0.95), (0, 0.8, 1.1)], 0.065, "horse_mane", 10, taper_end=0.5)
for k, (y, z) in enumerate(((0.3, 0.7), (0.5, 0.86), (0.66, 1.0))):
    H.ellipsoid(f"mane_curl_{k}", (0.07, y, z - 0.02), (0.07, 0.1, 0.09), "horse_mane", seg=8, rings=6)
    H.ellipsoid(f"mane_curl_l_{k}", (-0.07, y, z - 0.02), (0.07, 0.1, 0.09), "horse_mane", seg=8, rings=6)
H.tube("forelock", [(0, 0.82, 1.1), (0, 0.78, 1.22), (0, 0.66, 1.26)], 0.04, "horse_mane", 8, taper_end=0.4)
H.tube("tail", [(0, -0.02, -0.82), (0, -0.1, -1.05), (0, -0.36, -1.22), (0, -0.72, -1.2)], 0.1, "horse_mane", 10, taper_end=0.35)
# tack: a blanket, the saddle with a high cantle and pommel (gilded), a girth strap, a breast collar and a bridle
H.box("blanket", (0.62, 0.05, 0.62), (0, 0.095, 0.0), "horse_indigo", 0.02, 2)
H.box("saddle_seat", (0.4, 0.07, 0.46), (0, 0.15, -0.02), "horse_red", 0.03, 3)
H.box("saddle_cantle", (0.4, 0.2, 0.07), (0, 0.24, -0.28), "horse_red", 0.035, 3)
H.box("saddle_pommel", (0.12, 0.14, 0.1), (0, 0.24, 0.24), "horse_gold", 0.035, 3)
H.box("saddle_trim", (0.42, 0.012, 0.48), (0, 0.186, -0.02), "horse_gold", 0.004, 1)
for sx in (-1, 1):
    H.cyl(f"stirrup_strap_{sx}", (sx * 0.27, 0.1, 0.0), (sx * 0.31, -0.38, 0.02), 0.014, 0.014, "horse_red", 6)
    H.box(f"stirrup_{sx}", (0.03, 0.02, 0.1), (sx * 0.31, -0.4, 0.02), "horse_gold", 0.006, 2)
H.tube("girth", [(-0.32, 0.04, 0.0), (-0.34, -0.3, 0.0), (0, -0.52, 0.0), (0.34, -0.3, 0.0), (0.32, 0.04, 0.0)], 0.03, "horse_red", 8)
H.tube("breast_collar", [(-0.3, 0.05, 0.62), (-0.32, -0.28, 0.72), (0, -0.46, 0.78), (0.32, -0.28, 0.72), (0.3, 0.05, 0.62)], 0.035, "horse_gold", 8)
for k, x in enumerate((-0.2, 0.2)):
    H.ellipsoid(f"collar_boss_{k}", (x, -0.1, 0.8), (0.05, 0.05, 0.05), "horse_gold", seg=8, rings=6)
H.tube("bridle_brow", [(-0.125, 0.82, 1.06), (0, 0.85, 1.1), (0.125, 0.82, 1.06)], 0.014, "horse_gold", 6)
H.tube("bridle_nose", [(-0.115, 0.6, 1.27), (0, 0.58, 1.34), (0.115, 0.6, 1.27)], 0.016, "horse_gold", 6)
H.tube("bridle_cheek_l", [(0.125, 0.82, 1.06), (0.135, 0.66, 1.14), (0.115, 0.6, 1.27)], 0.012, "horse_gold", 6)
H.tube("bridle_cheek_r", [(-0.125, 0.82, 1.06), (-0.135, 0.66, 1.14), (-0.115, 0.6, 1.27)], 0.012, "horse_gold", 6)
H.tube("reins", [(0.1, 0.55, 1.28), (0.16, 0.45, 0.9), (0.12, 0.25, 0.35), (0.1, 0.2, 0.2)], 0.012, "horse_red", 6)
H.tube("reins_r", [(-0.1, 0.55, 1.28), (-0.16, 0.45, 0.9), (-0.12, 0.25, 0.35), (-0.1, 0.2, 0.2)], 0.012, "horse_red", 6)
# the pole sleeve (gilded), where the brass pole passes through the body
H.cyl("pole_sleeve", (0, 0.5, 0.3), (0, -0.55, 0.3), 0.07, 0.07, "horse_gold", 10)
H.export("carousel_horse.glb", 55.0)

# ═════════════════════════════ a carriage ═════════════════════════════
C = Builder({
    "car_paint": ((0.08, 0.1, 0.5), 0.2, 0.3, 1.0, 0.05),
    "car_gold": (GOLD, 0.85, 0.3, 0.5, 0.1),
    "car_red": ((0.52, 0.05, 0.1), 0.0, 0.55, 0.2),
    "car_cream": ((0.95, 0.91, 0.82), 0.0, 0.4, 0.8, 0.1),
    "car_dark": ((0.06, 0.05, 0.06), 0.0, 0.5),
})
# the hull: a long low boat, swept up at both ends; origin at the middle of the floor, +z forward (the travel), the seats side by side
C.box("hull_floor", (1.5, 0.12, 2.3), (0, 0.18, 0), "car_paint", 0.05)
C.box("hull_side_l", (0.1, 0.42, 2.2), (0.72, 0.38, 0), "car_paint", 0.04)
C.box("hull_side_r", (0.1, 0.42, 2.2), (-0.72, 0.38, 0), "car_paint", 0.04)
C.box("hull_back", (1.54, 0.7, 0.1), (0, 0.5, -1.12), "car_paint", 0.05)
C.box("hull_front", (1.34, 0.5, 0.1), (0, 0.42, 1.14), "car_paint", 0.05)
for sx in (-1, 1):
    C.box(f"rail_{sx}", (0.07, 0.07, 2.2), (sx * 0.72, 0.6, 0), "car_gold", 0.025)
    C.box(f"stripe_{sx}", (0.012, 0.05, 2.1), (sx * 0.775, 0.34, 0), "car_gold", 0.004, 2)
# swan-neck scrolls at the front and a shell back, in gilded tube
C.tube("scroll_front", [(0, 0.5, 1.15), (0, 0.9, 1.4), (0, 1.15, 1.25), (0, 1.1, 1.0), (0, 0.95, 1.05)], 0.05, "car_gold", 10)
C.tube("scroll_back", [(0, 0.6, -1.15), (0, 1.1, -1.35), (0, 1.5, -1.2), (0, 1.55, -0.95)], 0.05, "car_gold", 10)
C.ellipsoid("shell_back", (0, 1.0, -1.1), (0.7, 0.5, 0.14), "car_cream", seg=16, rings=8)
for sx in (-1, 1):
    # a bench seat each: a velvet cushion and a back (tufted with gold buttons)
    x = sx * 0.38
    C.box(f"cushion_{sx}", (0.62, 0.14, 0.8), (x, 0.55, 0.05), "car_red", 0.05)
    C.box(f"seat_back_{sx}", (0.62, 0.6, 0.12), (x, 0.9, -0.38), "car_red", 0.06)
    for k in range(3):
        C.ellipsoid(f"button_{sx}_{k}", (x - 0.2 + k * 0.2, 0.95, -0.31), (0.025, 0.025, 0.025), "car_gold", seg=6, rings=4)
C.export("carousel_carriage.glb", 50.0)
