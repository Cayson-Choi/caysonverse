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

LOD = os.environ.get("CR_LOD") == "1"  # CR_LOD=1: the far level of detail of the horse only (carousel_horse_lod.glb)
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


def bake_ao(obj, rays=40, dist=0.45):
    """Ambient occlusion into a vertex colour (ray casts over each vertex's hemisphere): the body's folds, under the neck, between the legs, under the saddle go darker."""
    import random
    from mathutils import Matrix
    from mathutils.bvhtree import BVHTree
    bpy.context.view_layer.update()
    bvh = BVHTree.FromObject(obj, bpy.context.evaluated_depsgraph_get())
    me = obj.data
    me.calc_normals() if hasattr(me, "calc_normals") else None
    ca = me.color_attributes.new("AO", "BYTE_COLOR", "POINT")
    me.color_attributes.active_color = ca
    rnd = random.Random(7)
    for v in me.vertices:
        n = v.normal.normalized()
        t = n.cross(Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((1, 0, 0))).normalized()
        b = n.cross(t)
        hit = 0
        for _ in range(rays):
            u1, u2 = rnd.random(), rnd.random()
            r = math.sqrt(u1)
            d = (t * (r * math.cos(math.tau * u2)) + b * (r * math.sin(math.tau * u2)) + n * math.sqrt(max(0.0, 1 - u1))).normalized()
            if bvh.ray_cast(v.co + n * 0.006, d, dist)[0] is not None:
                hit += 1
        c = 1.0 - 0.62 * hit / rays
        ca.data[v.index].color = (c, c, c, 1.0)


class Builder:
    def __init__(self, mats):
        self.scene = new_scene()
        self.M = {k: mat(k, *v) if isinstance(v, tuple) else v for k, v in mats.items()}
        self.parts = []
        self.lean = False

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
        if self.lean:
            seg, rings = min(seg, 10), min(rings, 7)
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0)
        for v in bm.verts:
            v.co.x *= radii[0]
            v.co.y *= radii[2]
            v.co.z *= radii[1]
        obj = self._link(name, bm, center)
        obj.rotation_euler = (math.radians(rot_x), 0, math.radians(-rot_y))
        return self._finish(obj, mname)

    def cyl(self, name, p0, p1, r0, r1, mname, sides=12, bevel=0.0, cap=True, flip=False):
        a, b = B(*p0), B(*p1)
        d = b - a
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=cap, segments=sides, radius1=r0, radius2=r1, depth=d.length)
        if flip:
            bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
        obj = self._link(name, bm)
        obj.location = (a + b) / 2
        obj.rotation_mode = "QUATERNION"
        obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
        return self._finish(obj, mname, bevel, 2)

    def tube(self, name, pts, r, mname, sides=10, taper_end=None):
        cu = bpy.data.curves.new(name, "CURVE")
        cu.dimensions = "3D"
        cu.bevel_depth = r
        cu.bevel_resolution = 0 if r <= 0.03 else (1 if r <= 0.07 else 2)
        cu.use_fill_caps = True
        sp = cu.splines.new("NURBS")
        sp.points.add(len(pts) - 1)
        sp.order_u = min(4, len(pts))
        sp.use_endpoint_u = True
        sp.resolution_u = 1 if len(pts) > 20 else 3
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

    def disc(self, name, y0, y1, r, mname, sides=48, bevel=0.0, cap=True, flip=False):
        return self.cyl(name, (0, y0, 0), (0, y1, 0), r, r, mname, sides, bevel, cap, flip)

    def ring(self, name, y, r, tube, mname, n=72):
        pts = [(math.sin(i / n * math.tau) * r, y, -math.cos(i / n * math.tau) * r) for i in range(n + 1)]
        return self.tube(name, pts, tube, mname, 6)

    def export(self, filename, smooth_angle=40.0, ao=False):
        if os.environ.get("CR_COUNT"):
            for o in sorted(self.parts, key=lambda o: -len(o.data.polygons))[:30]:
                try:
                    print("  part", o.name, len(o.data.polygons))
                except ReferenceError:
                    pass
        bpy.ops.object.select_all(action="DESELECT")
        for o in self.parts:
            o.select_set(True)
        bpy.context.view_layer.objects.active = self.parts[0]
        # every part's origin to the world origin first: the joined mesh then keeps the world frame (the game uses the geometry without the node's transform)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        self.scene.cursor.location = (0, 0, 0)
        bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
        bpy.ops.object.join()
        obj = bpy.context.view_layer.objects.active
        obj.name = os.path.splitext(filename)[0]
        try:
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth_angle))
        except Exception:
            bpy.ops.object.shade_smooth()
        if ao:
            bake_ao(obj)
        kw = dict(filepath=os.path.join(OUT, filename), export_format="GLB", export_apply=True, export_yup=True, export_materials="EXPORT", export_cameras=False, export_lights=False)
        if ao:
            kw["export_vertex_color"] = "ACTIVE"
        try:
            bpy.ops.export_scene.gltf(**kw)
        except TypeError:
            kw.pop("export_vertex_color", None)
            bpy.ops.export_scene.gltf(**kw)
        tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        print(filename, "triangles:", tris, "parts:", len(self.parts))


GOLD = (0.95, 0.66, 0.16)

# ═════════════════════════════ the rotating assembly ═════════════════════════════
S = Builder({
    "cr_stone": ((0.62, 0.6, 0.56), 0.0, 0.8),
    "cr_wood": ((0.52, 0.33, 0.18), 0.0, 0.55, 0.4, 0.2),
    "cr_varnish": ((0.45, 0.27, 0.13), 0.0, 0.35, 0.8, 0.1),
    "cr_gold": (GOLD, 0.85, 0.3, 0.5, 0.1),
    "cr_cream": ((0.95, 0.91, 0.82), 0.0, 0.4, 0.8, 0.1),
    "cr_indigo": ((0.08, 0.1, 0.48), 0.1, 0.35, 0.9, 0.06),
    "cr_mirror": ((0.8, 0.88, 0.97), 0.45, 0.05),
    "cr_sky": ((0.45, 0.68, 0.9), 0.0, 0.5, 0.5, 0.1),
    "cr_rose": ((0.78, 0.2, 0.3), 0.0, 0.5, 0.4, 0.1),
    "cr_green": ((0.2, 0.5, 0.3), 0.0, 0.55),
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
S.disc("deck_rim", DECK - 0.02, DECK + 0.12, 12.55, "cr_gold", 64, 0.03, cap=False)
S.ring("deck_rim_top", DECK + 0.12, 12.5, 0.05, "cr_gold")
for r, mn in ((11.4, "cr_gold"), (7.9, "cr_brass"), (5.2, "cr_gold")):
    S.ring(f"deck_inlay_{r}", DECK + 0.012, r, 0.03, mn)
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
S.disc("band", CANOPY - 1.25, CANOPY, 13.15, "cr_indigo", 64, 0.02, cap=False)
S.disc("band_in", CANOPY - 1.25, CANOPY, 13.1, "cr_indigo", 64, 0.0, cap=False, flip=True)
S.disc("band_trim_top", CANOPY - 0.07, CANOPY + 0.1, 13.28, "cr_gold", 64, 0.03, cap=False)
S.disc("band_trim_bottom", CANOPY - 1.3, CANOPY - 1.18, 13.25, "cr_gold", 64, 0.03, cap=False)
S.disc("band_trim_bottom_in", CANOPY - 1.3, CANOPY - 1.18, 13.2, "cr_gold", 64, 0.0, cap=False, flip=True)
for k in range(24):
    a = (k + 0.5) / 24 * math.tau
    x, z = math.sin(a) * 13.2, -math.cos(a) * 13.2
    S.box(f"panel_{k}", (1.7, 0.78, 0.06), (x, CANOPY - 0.62, z), "cr_cream" if k % 2 else "cr_red", 0.015, 2, rot_y=-math.degrees(a))
    S.box(f"panel_frame_{k}", (1.84, 0.92, 0.04), (x * 0.998, CANOPY - 0.62, z * 0.998), "cr_gold", 0.02, 2, rot_y=-math.degrees(a))
    # a scalloped flap hanging below the band
    S.ellipsoid(f"scallop_{k}", (math.sin(a) * 13.15, CANOPY - 1.4, -math.cos(a) * 13.15), (0.74, 0.34, 0.14), "cr_gold" if k % 2 else "cr_cream", seg=10, rings=6, rot_y=-math.degrees(a))
for k in range(24):
    a = (k + 0.5) / 24 * math.tau
    x, z = math.sin(a) * 13.04, -math.cos(a) * 13.04
    S.box(f"inner_mirror_{k}", (1.5, 0.62, 0.03), (x, CANOPY - 0.62, z), "cr_mirror", 0.01, 2, rot_y=-math.degrees(a))
    S.box(f"inner_frame_{k}", (1.66, 0.78, 0.03), (x * 1.002, CANOPY - 0.62, z * 1.002), "cr_gold", 0.02, 2, rot_y=-math.degrees(a))
# the painted ceiling under the canopy: 24 radial wedges in three rows (sky, cream, rose), gilded rafters, a rosette in each panel
APEX_IN = APEX - 0.55


def ceil_y(r):
    return APEX_IN - (r / 13.0) * (APEX_IN - (CANOPY + 0.02))


ROWS = ((2.5, 5.6), (5.75, 9.1), (9.25, 12.95))
for k in range(24):
    a0 = k / 24 * math.tau + 0.012
    a1 = (k + 1) / 24 * math.tau - 0.012
    for row, (r0, r1) in enumerate(ROWS):
        bm = bmesh.new()
        q = [bm.verts.new(B(math.sin(a) * r, ceil_y(r) - 0.02, -math.cos(a) * r)) for (a, r) in ((a0, r0), (a1, r0), (a1, r1), (a0, r1))]
        bm.faces.new(q[::-1])  # faces down
        obj = S._link(f"ceil_{k}_{row}", bm)
        S._finish(obj, "cr_sky" if (k + row) % 2 == 0 else "cr_cream")
        am = (a0 + a1) / 2
        rm = (r0 + r1) / 2
        cx, cz = math.sin(am) * rm, -math.cos(am) * rm
        yy = ceil_y(rm) - 0.05
        S.cyl(f"rosette_{k}_{row}", (cx, yy - 0.03, cz), (cx, yy, cz), 0.5 + 0.05 * row, 0.5 + 0.05 * row, "cr_gold", 14)
        S.cyl(f"rosette_in_{k}_{row}", (cx, yy - 0.05, cz), (cx, yy - 0.03, cz), 0.36 + 0.04 * row, 0.36 + 0.04 * row, "cr_rose" if (k + row) % 2 else "cr_green", 14)
    # a gilded rafter on the seam
    ra = k / 24 * math.tau
    S.cyl(f"rafter_{k}", (math.sin(ra) * 2.5, ceil_y(2.5) - 0.05, -math.cos(ra) * 2.5), (math.sin(ra) * 13.0, ceil_y(13.0) - 0.05, -math.cos(ra) * 13.0), 0.06, 0.06, "cr_gold", 8)
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
# the poles: thin brass (4.5 cm) with a twisted gilded wire, from the deck to the canopy, at every seat position
RINGS = ((9.6, 12, 0.0), (6.6, 8, 0.0), (3.8, 2, math.pi / 2))
for r, n, off in RINGS:
    for i in range(n):
        a = i / n * math.tau + off if r != 3.8 else i * math.pi
        px, pz = math.sin(a) * r, -math.cos(a) * r
        S.cyl(f"pole_{r}_{i}", (px, DECK, pz), (px, CANOPY - 0.2, pz), 0.022, 0.022, "cr_brass", 8)
        pts = []
        for j in range(61):
            t = j / 60
            ang = t * 9 * math.tau
            pts.append((px + math.cos(ang) * 0.03, DECK + 0.1 + t * (CANOPY - DECK - 0.5), pz + math.sin(ang) * 0.03))
        S.tube(f"pole_wire_{r}_{i}", pts, 0.007, "cr_gold", 4)
S.export("carousel_static.glb")

# ═════════════════════════════ a horse ═════════════════════════════
H = Builder({
    "horse_paint": ((0.92, 0.9, 0.86), 0.0, 0.32, 1.0, 0.05),
    "horse_gold": (GOLD, 0.85, 0.3, 0.5, 0.1),
    "horse_red": ((0.5, 0.05, 0.09), 0.0, 0.5, 0.5, 0.2),
    "horse_indigo": ((0.08, 0.1, 0.5), 0.0, 0.5, 0.4),
    "horse_dark": ((0.06, 0.05, 0.05), 0.0, 0.4, 0.3),
    "horse_mane": ((0.97, 0.93, 0.82), 0.0, 0.5, 0.3),
    "horse_rose": ((0.86, 0.2, 0.3), 0.0, 0.45, 0.4),
    "horse_leaf": ((0.18, 0.5, 0.25), 0.0, 0.5),
    "horse_jewel": ((0.1, 0.45, 0.95), 0.0, 0.08, 1.0, 0.02),
    "horse_mouth": ((0.42, 0.08, 0.1), 0.0, 0.5),
    "horse_tooth": ((0.98, 0.96, 0.9), 0.0, 0.4),
})


H.lean = True


def skin_body(name, verts, edges, mname, sub=2):
    """One smooth organic body from a skeleton: Skin modifier (a radius per joint) then Subdivision Surface. verts: (x, y, z, rx, ry) in game coords."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(B(*v[:3])) for v in verts], edges, [])
    obj = bpy.data.objects.new(name, me)
    H.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    md = obj.modifiers.new("skin", "SKIN")
    md.use_smooth_shade = True
    bpy.ops.object.skin_root_mark() if False else None
    for i, v in enumerate(verts):
        sv = me.skin_vertices[0].data[i]
        sv.radius = (v[3], v[4])
        if i == 0:
            sv.use_root = True
    sd = obj.modifiers.new("sub", "SUBSURF")
    sd.levels = 1 if LOD else sub
    sd.render_levels = 1 if LOD else sub
    bpy.ops.object.modifier_apply(modifier="skin")
    bpy.ops.object.modifier_apply(modifier="sub")
    dm = obj.modifiers.new("dec", "DECIMATE")
    dm.ratio = 0.4 if LOD else 0.42
    bpy.ops.object.modifier_apply(modifier="dec")
    obj.select_set(False)
    obj.data.materials.append(H.M[mname])
    H.parts.append(obj)
    return obj


# the body is one smooth carved volume (Skin + Subdivision): trunk with a deep chest, an arched neck, a long head, four jointed legs
V = [
    (0, 0.0, -0.72, 0.1, 0.12),  # 0 tail root
    (0, -0.06, -0.48, 0.27, 0.3),  # 1 rump
    (0, -0.2, -0.02, 0.25, 0.29),  # 2 barrel
    (0, -0.1, 0.42, 0.26, 0.32),  # 3 chest
    (0, 0.14, 0.62, 0.19, 0.23),  # 4 neck base / withers
    (0, 0.4, 0.78, 0.13, 0.17),  # 5 neck middle (arched)
    (0, 0.62, 0.95, 0.105, 0.13),  # 6 poll
    (0, 0.55, 1.13, 0.1, 0.15),  # 7 cheek (head turns down)
    (0, 0.4, 1.36, 0.072, 0.085),  # 8 muzzle
]
E = [(0, 1), (1, 2), (2, 3), (3, 4), (4, 5), (5, 6), (6, 7), (7, 8)]
for sx in (-1, 1):
    n = len(V)
    x = sx * 0.15
    V += [
        (x, -0.28, 0.46, 0.1, 0.1), (x, -0.6, 0.78, 0.07, 0.07), (x, -0.93, 0.7, 0.045, 0.045),  # foreleg: shoulder, knee (raised), fetlock
        (x * 1.05, -0.3, -0.48, 0.12, 0.12), (x, -0.66, -0.7, 0.07, 0.07), (x, -0.99, -0.5, 0.045, 0.045),  # hind: haunch, hock, fetlock
    ]
    E += [(3, n), (n, n + 1), (n + 1, n + 2), (1, n + 3), (n + 3, n + 4), (n + 4, n + 5)]
skin_body("horse_body", V, E, "horse_paint", 2)
for sx in (-1, 1):
    H.cyl(f"fore_hoof_{sx}", (sx * 0.15, -0.93, 0.7), (sx * 0.15, -1.07, 0.7), 0.055, 0.075, "horse_gold", 14)
    H.cyl(f"hind_hoof_{sx}", (sx * 0.15, -0.99, -0.5), (sx * 0.15, -1.13, -0.5), 0.055, 0.075, "horse_gold", 14)
    # ears (pricked), eyes with a gold lid, nostril
    H.ellipsoid(f"ear_{sx}", (sx * 0.062, 0.79, 0.96), (0.03, 0.058, 0.024), "horse_paint", rot_x=-14.0, seg=10, rings=8)
    if not LOD:
        H.ellipsoid(f"ear_in_{sx}", (sx * 0.062, 0.79, 0.972), (0.018, 0.04, 0.012), "horse_red", rot_x=-12.0, seg=8, rings=6)
    H.ellipsoid(f"eye_{sx}", (sx * 0.1, 0.64, 1.1), (0.028, 0.034, 0.034), "horse_dark", seg=10, rings=8)
    if not LOD:
        H.ellipsoid(f"eye_lid_{sx}", (sx * 0.097, 0.665, 1.1), (0.04, 0.012, 0.045), "horse_gold", seg=10, rings=6)
    if not LOD:
        H.ellipsoid(f"nostril_{sx}", (sx * 0.045, 0.46, 1.4), (0.025, 0.02, 0.025), "horse_dark", seg=8, rings=6)
# the open mouth: a dark red gap with a lower jaw and teeth
if not LOD:
    H.ellipsoid("mouth", (0, 0.34, 1.36), (0.05, 0.03, 0.06), "horse_mouth", seg=10, rings=6)
if not LOD:
    H.ellipsoid("jaw", (0, 0.335, 1.31), (0.06, 0.04, 0.085), "horse_paint", rot_x=-10.0, seg=12, rings=8)
for k in range(0 if LOD else 5):
    H.ellipsoid(f"tooth_{k}", (-0.04 + k * 0.02, 0.366, 1.405), (0.009, 0.014, 0.008), "horse_tooth", seg=5, rings=4)
# the carved mane: flowing locks that run down the crest, curling to one side at the ends
for k in range(3 if LOD else 6):
    f = k / (2 if LOD else 5)
    y0, z0 = 0.62 - f * 0.22, 0.95 - f * 0.3
    side = 0.06 + 0.02 * (k % 2)
    pts = [(0.0, y0 + 0.12, z0 + 0.04), (side * 0.5, y0 + 0.07, z0 - 0.05), (side, y0 - 0.06, z0 - 0.14), (side * 1.6, y0 - 0.16, z0 - 0.15), (side * 1.4, y0 - 0.2, z0 - 0.1)]
    H.tube(f"mane_{k}", pts, 0.05 - 0.01 * f, "horse_mane", 10, taper_end=0.35)
if not LOD:
    H.tube("forelock", [(0, 0.8, 1.08), (0, 0.84, 1.17), (0, 0.76, 1.24), (0.03, 0.64, 1.25)], 0.04, "horse_mane", 8, taper_end=0.3)
# the tail: several flowing locks swept back and down
for k in range(2 if LOD else 4):
    sx = (k - (0.5 if LOD else 1.5)) * 0.1
    H.tube(f"tail_{k}", [(0, 0.0, -0.72), (sx * 0.5, 0.0, -0.95), (sx * 1.4, -0.2, -1.18), (sx * 2.0, -0.55, -1.25), (sx * 2.4, -0.86, -1.16)], 0.07 - abs(k - 1.5) * 0.012, "horse_mane", 10, taper_end=0.25)
# tack: indigo blanket with gold braid, a deep red saddle with high cantle and pommel, gold, roses and jewels
H.ellipsoid("blanket", (0, 0.04, 0.0), (0.33, 0.06, 0.4), "horse_indigo", seg=16, rings=8)
if not LOD:
    H.tube("blanket_braid", [(-0.3, 0.0, -0.3), (-0.34, -0.02, 0.0), (-0.3, 0.0, 0.3)], 0.014, "horse_gold", 6)
if not LOD:
    H.tube("blanket_braid_r", [(0.3, 0.0, -0.3), (0.34, -0.02, 0.0), (0.3, 0.0, 0.3)], 0.014, "horse_gold", 6)
H.ellipsoid("saddle_seat", (0, 0.12, -0.02), (0.22, 0.07, 0.3), "horse_red", seg=16, rings=10)
H.ellipsoid("saddle_cantle", (0, 0.2, -0.27), (0.2, 0.12, 0.07), "horse_red", seg=14, rings=8)
H.ellipsoid("saddle_pommel", (0, 0.22, 0.22), (0.07, 0.11, 0.07), "horse_gold", seg=12, rings=8)
for sx in (() if LOD else (-1, 1)):
    H.cyl(f"stirrup_strap_{sx}", (sx * 0.26, 0.08, 0.0), (sx * 0.3, -0.4, 0.02), 0.014, 0.014, "horse_red", 6)
    H.box(f"stirrup_{sx}", (0.03, 0.02, 0.1), (sx * 0.3, -0.43, 0.02), "horse_gold", 0.006, 2)
if not LOD:
    H.tube("girth", [(-0.3, 0.02, 0.0), (-0.33, -0.3, 0.0), (0, -0.5, 0.0), (0.33, -0.3, 0.0), (0.3, 0.02, 0.0)], 0.03, "horse_red", 8)
if not LOD:
    H.tube("breast_collar", [(-0.24, 0.08, 0.58), (-0.27, -0.2, 0.62), (0, -0.34, 0.72), (0.27, -0.2, 0.62), (0.24, 0.08, 0.58)], 0.035, "horse_gold", 8)
if not LOD:
    H.ellipsoid("collar_jewel", (0, -0.28, 0.745), (0.05, 0.05, 0.04), "horse_jewel", seg=10, rings=8)


def rose(name, c, r=0.045):
    H.ellipsoid(name + "_c", c, (r, r, r), "horse_rose", seg=8, rings=6)
    for j in range(4):
        a = j / 4 * math.tau
        H.ellipsoid(f"{name}_p{j}", (c[0] + math.cos(a) * r * 0.9, c[1] + 0.012, c[2] + math.sin(a) * r * 0.9), (r * 0.6, r * 0.5, r * 0.6), "horse_rose", seg=6, rings=4)


for sx in (() if LOD else (-1, 1)):
    rose(f"rose_blanket_{sx}", (sx * 0.31, 0.06, -0.2))
    rose(f"rose_blanket_f_{sx}", (sx * 0.3, 0.06, 0.2))
    H.ellipsoid(f"leaf_{sx}", (sx * 0.35, 0.05, -0.12), (0.05, 0.015, 0.025), "horse_leaf", seg=6, rings=4)
    H.ellipsoid(f"leaf_f_{sx}", (sx * 0.34, 0.05, 0.12), (0.05, 0.015, 0.025), "horse_leaf", seg=6, rings=4)
if not LOD:
    rose("rose_cantle", (0, 0.3, -0.3), 0.04)
# the bridle: gold straps with a jewelled brow band, cheek straps, a noseband, reins
if not LOD:
    H.tube("bridle_brow", [(-0.108, 0.71, 1.04), (0, 0.745, 1.08), (0.108, 0.71, 1.04)], 0.014, "horse_gold", 6)
if not LOD:
    H.ellipsoid("brow_jewel", (0, 0.745, 1.095), (0.03, 0.03, 0.02), "horse_jewel", seg=8, rings=6)
if not LOD:
    H.tube("bridle_nose", [(-0.08, 0.47, 1.31), (0, 0.45, 1.39), (0.08, 0.47, 1.31)], 0.016, "horse_gold", 6)
if not LOD:
    H.tube("bridle_cheek_l", [(0.108, 0.71, 1.04), (0.125, 0.56, 1.12), (0.08, 0.47, 1.31)], 0.012, "horse_gold", 6)
if not LOD:
    H.tube("bridle_cheek_r", [(-0.108, 0.71, 1.04), (-0.125, 0.56, 1.12), (-0.08, 0.47, 1.31)], 0.012, "horse_gold", 6)
if not LOD:
    H.tube("reins", [(0.09, 0.38, 1.3), (0.15, 0.4, 0.95), (0.12, 0.22, 0.4), (0.1, 0.2, 0.22)], 0.012, "horse_red", 6)
if not LOD:
    H.tube("reins_r", [(-0.09, 0.38, 1.3), (-0.15, 0.4, 0.95), (-0.12, 0.22, 0.4), (-0.1, 0.2, 0.22)], 0.012, "horse_red", 6)
# the pole sleeve (gilded), where the thin brass pole passes through the body
H.cyl("pole_sleeve", (0, 0.5, 0.3), (0, -0.55, 0.3), 0.032, 0.032, "horse_gold", 10)
H.export("carousel_horse_lod.glb" if LOD else "carousel_horse.glb", 85.0, ao=True)

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
