"""Cubby props for the memorial hall (케이슨 마을 Task 8; Blender 5.2, background) -> export/memorial_props.glb.

  blender -b --factory-startup -P art/village/tools/build_props.py -- [--samples 512] [--size 1024]
  python art/village/tools/post_memorial.py            (copies memorial_props.glb to the client)

Nine props, ONE mesh (one node) each, real size, origin at the bottom centre, the front facing +z (glTF), so Task 9 can
draw each kind as one InstancedMesh at the cubby anchors:
  prop__urn_wood      light-oak cylinder urn with a lid           (d 12 cm, h 17 cm)
  prop__urn_ceramic   white ceramic urn with a domed lid and knob  (d 12 cm, h 19 cm)
  prop__photo_frame   oak frame on an easel leg; the picture is its own material slot M_photo (UV 0..1, the runtime
                      sets each pet's photo)                       (12 x 15 cm)
  prop__house_frame   the little house-shaped wooden frame         (24 x 28 cm)
  prop__tealight      LED tealight, the flame in M_flame           (d 3.8 cm)
  prop__plush_bear    a small sitting plush bear                   (h 15 cm)
  prop__flowers       artificial flowers in a little cup           (h 13 cm)
  prop__stone_jar     glass jar (M_jar_glass, see-through) of memorial stones with a cork lid (h 10 cm)
  prop__name_card     folded name card; its front face is M_name (UV 0..1, the runtime writes the name)  (9 x 4 cm)
Their light is baked into the shared texture (M_props: a Cycles DIFFUSE bake, colour + direct + indirect, under a warm
LED strip in a white cubby with the room light from the front), so they read like the light-mapped hall in the unlit
game. M_photo, M_name, M_flame and M_jar_glass are unlit flat materials the runtime may replace.
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
from vlib import MB, V  # noqa: E402
import build_memorial as BM  # noqa: E402
import bake_village as BV  # noqa: E402

WORK = os.path.join(U.ROOT, "work")
EXPORT = os.path.join(U.ROOT, "export")
TEXM = os.path.join(WORK, "tex_m")

U.MATSPEC.update({
    "P_oak": dict(tex=BM.T("T_m_oak.png"), uv="explicit", rough=0.45),
    "P_ceramic": dict(color="#DEDAD2", rough=0.15),
    "P_card": dict(color="#F5F2EA", rough=0.7),
    "P_plush": dict(color="#C9A07A", rough=1.0),
    "P_plush_light": dict(color="#E8D3BA", rough=1.0),
    "P_dark": dict(color="#2A211C", rough=0.5),
    "P_leaf": dict(color="#55803F", rough=0.6),
    "P_pink": dict(color="#F2B8C6", rough=0.6),
    "P_cream": dict(color="#F6E7B8", rough=0.6),
    "P_lav": dict(color="#C9B8EE", rough=0.6),
    "P_white": dict(color="#F7F6F2", rough=0.6),
    "P_cork": dict(color="#B88B5C", rough=0.9),
    "P_stone_a": dict(color="#8FC3D9", rough=0.2),
    "P_stone_b": dict(color="#E9E9F0", rough=0.2),
    "P_stone_c": dict(color="#E6A9BD", rough=0.2),
    "P_stone_d": dict(color="#A7D3B0", rough=0.2),
    "M_photo": dict(color="#9A9A9A", rough=0.4),
    "M_name": dict(color="#F5F2EA", rough=0.7),
    "M_flame": dict(kind="emit", color="#FFB060", strength=8.0),
    "M_jar_glass": dict(color="#EEF4F4", rough=0.02, transmission=1.0, ior=1.45),
})
UNBAKED = {"M_photo", "M_name", "M_flame", "M_jar_glass"}
OAK_UP = (0, 0, 1)


def arg(name, default=None, cast=str):
    return BM.arg(name, default, cast)


def lathe_y(mb, profile, m, segs=32, grain=None, uv=None, x=0.0, z=0.0):
    BM.lathe(mb, x, z, 0.0, profile, m, segs=segs, grain=grain, uv=uv)


def blob(mb, cx, cz, y, r, m, sy=1.0, sx=1.0, sz=1.0, segs=12, rings=8):
    prof = [(r * math.sin(math.pi * k / rings), -r * sy * math.cos(math.pi * k / rings)) for k in range(rings + 1)]
    prof[0] = (0.0, prof[0][1])
    prof[-1] = (0.0, prof[-1][1])
    rings_pts = []
    for (rr, yy) in prof:
        rings_pts.append([(cx + rr * sx * math.cos(2 * math.pi * i / segs), cz + rr * sz * math.sin(2 * math.pi * i / segs), y + yy)
                          for i in range(segs)])
    for j in range(len(prof) - 1):
        for i in range(segs):
            i2 = (i + 1) % segs
            a, b, c, d = rings_pts[j][i], rings_pts[j][i2], rings_pts[j + 1][i2], rings_pts[j + 1][i]
            mid = [(a[k] + b[k] + c[k] + d[k]) / 4 for k in range(3)]
            hint = (mid[0] - cx, mid[1] - cz, mid[2] - y)
            pts = [a, c, d] if prof[j][0] == 0 else ([a, b, c] if prof[j + 1][0] == 0 else [a, b, c, d])
            f = BM.gface(mb, pts, m, hint=hint)
            if f is not None:
                f.smooth = True


# ------------------------------------------------------------------------------------------------- props --

def urn_wood(mb):
    lathe_y(mb, [(0.0, 0.0), (0.058, 0.0), (0.06, 0.003), (0.06, 0.145), (0.055, 0.15), (0.0, 0.15)], "P_oak", 40, grain=OAK_UP)
    lathe_y(mb, [(0.0, 0.149), (0.062, 0.149), (0.063, 0.152), (0.063, 0.166), (0.06, 0.17), (0.0, 0.171)], "P_oak", 40, grain=OAK_UP)


def urn_ceramic(mb):
    lathe_y(mb, [(0.0, 0.0), (0.05, 0.0), (0.054, 0.006), (0.058, 0.05), (0.058, 0.11), (0.054, 0.14), (0.046, 0.155),
                 (0.0, 0.155)], "P_ceramic", 40)
    lathe_y(mb, [(0.0, 0.153), (0.05, 0.153), (0.051, 0.158), (0.045, 0.168), (0.02, 0.172), (0.0, 0.173)], "P_ceramic", 40)
    blob(mb, 0, 0, 0.183, 0.024, "P_ceramic", sy=0.55, segs=20)


def photo_frame(mb):
    w, h, d, b = 0.12, 0.15, 0.012, 0.013
    tilt = math.radians(9)

    def P(x, y, zz):   # in the frame's plane (x across, y up the frame, zz toward the viewer), leaned back by tilt
        return (x, zz * math.cos(tilt) - y * math.sin(tilt) + 0.012, y * math.cos(tilt) + zz * math.sin(tilt))
    for (x0, x1, y0, y1) in ((-w / 2, w / 2, 0, b), (-w / 2, w / 2, h - b, h), (-w / 2, -w / 2 + b, b, h - b), (w / 2 - b, w / 2, b, h - b)):
        # front, back, outer edges of each bar
        for zz, hint in ((d / 2, 1), (-d / 2, -1)):
            BM.gface(mb, [P(x0, y0, zz), P(x1, y0, zz), P(x1, y1, zz), P(x0, y1, zz)], "P_oak",
                     grain=(1, 0, 0) if y1 - y0 < 0.02 else (0, 0, 1), hint=(0, hint * math.cos(tilt), hint * math.sin(tilt)))
        for (pa, pb, hint) in (((x0, y0), (x1, y0), (0, -1)), ((x1, y0), (x1, y1), (1, 0)), ((x1, y1), (x0, y1), (0, 1)),
                               ((x0, y1), (x0, y0), (-1, 0))):
            hy = hint[1]
            BM.gface(mb, [P(pa[0], pa[1], -d / 2), P(pb[0], pb[1], -d / 2), P(pb[0], pb[1], d / 2), P(pa[0], pa[1], d / 2)],
                     "P_oak", grain=(1, 0, 0), hint=(hint[0], -hy * math.sin(tilt), hy * math.cos(tilt)))
    # the picture (own slot, UV 0..1) a little behind the front
    f = BM.gface(mb, [P(-w / 2 + b, b, 0.002), P(w / 2 - b, b, 0.002), P(w / 2 - b, h - b, 0.002), P(-w / 2 + b, h - b, 0.002)],
                 "M_photo", hint=(0, math.cos(tilt), math.sin(tilt)))
    for lp, uv in zip(f.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        lp[mb.uv].uv = uv
    f[mb.explicit] = 1
    # back panel and easel leg
    BM.gface(mb, [P(-w / 2 + b, b, -0.002), P(w / 2 - b, b, -0.002), P(w / 2 - b, h - b, -0.002), P(-w / 2 + b, h - b, -0.002)],
             "P_card", hint=(0, -math.cos(tilt), -math.sin(tilt)), uv=(0.5, 0.5))
    top = P(0, h * 0.6, -d / 2)
    BM.rbox(mb, 0, top[1] - 0.045, 0.0, 0.03, 0.006, top[2], "P_oak", r=0.001, seg=1, grain=OAK_UP)


def house_frame(mb):
    W, Hw, Hp, t, d = 0.24, 0.18, 0.28, 0.012, 0.02
    BM.rbox(mb, 0, 0, 0.0, W, d, t, "P_oak", r=0.002, seg=1, grain=(1, 0, 0))
    for s in (-1, 1):
        BM.rbox(mb, s * (W / 2 - t / 2), 0, t, t, d, Hw - t, "P_oak", r=0.002, seg=1, grain=OAK_UP)
    # roof: two slanted sticks from the wall tops to the peak (built as boxes along the slope)
    for s in (-1, 1):
        x0, y0 = s * (W / 2), Hw
        x1, y1 = 0.0, Hp
        L = math.hypot(x1 - x0, y1 - y0)
        ang = math.atan2(y1 - y0, x1 - x0)
        ux, uy = (x1 - x0) / L, (y1 - y0) / L
        nx, ny = -uy, ux
        if ny < 0:
            nx, ny = -nx, -ny
        pts = []
        for (a, bb) in ((0, 0), (L, 0), (L, t), (0, t)):
            pts.append((x0 + ux * a + nx * bb - nx * t, y0 + uy * a + ny * bb - ny * t))
        for zz, hz in ((d / 2, 1), (-d / 2, -1)):
            BM.gface(mb, [(p[0], zz, p[1]) for p in pts], "P_oak", grain=(ux, 0, uy), hint=(0, hz, 0))
        for i in range(4):
            pa, pb = pts[i], pts[(i + 1) % 4]
            ex, ey = pb[0] - pa[0], pb[1] - pa[1]
            mx, my = (pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2
            cx_, cy_ = sum(p[0] for p in pts) / 4, sum(p[1] for p in pts) / 4
            BM.gface(mb, [(pa[0], -d / 2, pa[1]), (pb[0], -d / 2, pb[1]), (pb[0], d / 2, pb[1]), (pa[0], d / 2, pa[1])], "P_oak",
                     grain=(ux, 0, uy), hint=(mx - cx_, 0, my - cy_))


def tealight(mb):
    lathe_y(mb, [(0.0, 0.0), (0.019, 0.0), (0.019, 0.022), (0.016, 0.024), (0.015, 0.02), (0.0, 0.02)], "P_white", 24)
    lathe_y(mb, [(0.0, 0.021), (0.004, 0.026), (0.0045, 0.034), (0.0, 0.046)], "M_flame", 10)


def plush_bear(mb):
    m, ml = "P_plush", "P_plush_light"
    blob(mb, 0, 0, 0.045, 0.045, m, sy=1.0, sz=0.9)                      # body
    blob(mb, 0, 0.005, 0.112, 0.036, m)                                  # head
    blob(mb, 0, 0.034, 0.104, 0.015, ml, sy=0.8)                         # muzzle
    blob(mb, 0, 0.047, 0.108, 0.005, "P_dark", segs=8, rings=5)          # nose
    for s in (-1, 1):
        blob(mb, s * 0.026, -0.002, 0.143, 0.013, m, sz=0.6)                 # ears
        blob(mb, s * 0.014, 0.031, 0.121, 0.0045, "P_dark", segs=8, rings=5)  # eyes
        blob(mb, s * 0.042, 0.012, 0.055, 0.017, m, sy=1.4)                  # arms
        blob(mb, s * 0.025, 0.035, 0.016, 0.018, m, sz=1.4)                  # legs
        blob(mb, s * 0.025, 0.058, 0.016, 0.011, ml, sz=0.4)                 # foot pads
    blob(mb, 0, 0.03, 0.05, 0.024, ml, sz=0.5)                           # belly


def flowers(mb):
    rng = random.Random(4)
    lathe_y(mb, [(0.0, 0.0), (0.026, 0.0), (0.032, 0.05), (0.029, 0.05), (0.0, 0.045)], "P_ceramic", 24)
    cols = ["P_pink", "P_cream", "P_lav", "P_white", "P_pink", "P_white", "P_cream"]
    for k in range(8):
        a = k * 2.4
        r = 0.012 + 0.03 * rng.random()
        x, z = r * math.cos(a), r * math.sin(a) + 0.005
        y = 0.08 + 0.05 * rng.random()
        BM.rbox(mb, x * 0.5, z * 0.5, 0.045, 0.003, 0.003, y - 0.045, "P_leaf", r=0, grain=OAK_UP)
        blob(mb, x, z, y, rng.uniform(0.013, 0.019), cols[k % len(cols)], sy=0.75, segs=10, rings=6)
    for k in range(6):
        a = k * 1.05 + 0.3
        x, z = 0.035 * math.cos(a), 0.035 * math.sin(a)
        blob(mb, x, z, 0.07, 0.016, "P_leaf", sx=1.3, sz=0.5, sy=0.25, segs=8, rings=4)


def stone_jar(mb):
    rng = random.Random(9)
    lathe_y(mb, [(0.0, 0.0), (0.028, 0.0), (0.03, 0.004), (0.03, 0.078), (0.024, 0.084), (0.0, 0.084)], "M_jar_glass", 28)
    lathe_y(mb, [(0.0, 0.082), (0.022, 0.082), (0.023, 0.1), (0.0, 0.1)], "P_cork", 20)
    for k in range(26):
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(0, 0.02)
        blob(mb, r * math.cos(a), r * math.sin(a), 0.008 + 0.0024 * k, 0.007, rng.choice(["P_stone_a", "P_stone_b", "P_stone_c", "P_stone_d"]),
             sy=0.7, segs=8, rings=5)


def name_card(mb):
    w, h = 0.09, 0.04
    lean = math.radians(18)
    top = (0.0, h * math.cos(lean))
    front = [(-w / 2, h * math.sin(lean), 0.0), (w / 2, h * math.sin(lean), 0.0), (w / 2, 0.0, top[1]), (-w / 2, 0.0, top[1])]
    back = [(-w / 2, -h * math.sin(lean), 0.0), (w / 2, -h * math.sin(lean), 0.0), (w / 2, 0.0, top[1]), (-w / 2, 0.0, top[1])]
    f = BM.gface(mb, front, "M_name", hint=(0, math.cos(lean), math.sin(lean)))
    for lp, uv in zip(f.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        lp[mb.uv].uv = uv
    f[mb.explicit] = 1
    BM.gface(mb, back, "P_card", hint=(0, -math.cos(lean), math.sin(lean)), uv=(0.5, 0.5))
    # thickness on the inner faces (seen from below never; skip) and the two side triangles
    for s in (-1, 1):
        BM.gface(mb, [(s * w / 2, h * math.sin(lean), 0.0), (s * w / 2, -h * math.sin(lean), 0.0), (s * w / 2, 0.0, top[1])], "P_card",
                 hint=(s, 0, 0), uv=(0.5, 0.5))


PROPS = [("urn_wood", urn_wood), ("urn_ceramic", urn_ceramic), ("photo_frame", photo_frame), ("house_frame", house_frame),
         ("tealight", tealight), ("plush_bear", plush_bear), ("flowers", flowers), ("stone_jar", stone_jar),
         ("name_card", name_card)]


def build():
    c = U.coll("props")
    objs = []
    for name, fn in PROPS:
        mb = MB()
        fn(mb)
        o = mb.finish("prop__" + name, c, cat="prop", auto=True)
        objs.append(o)
    return objs


def bake_stage(objs):
    """A long white cubby shelf: floor, back, ceiling; a warm LED strip under the top board at the front; the room's light
    (a big soft warm-white panel) from the front."""
    st = U.coll("stage")
    mb = MB()
    n = len(objs)
    x0, x1 = -0.3, n * 0.4 + 0.1
    for (pts, hint) in ((((x0, -0.2, 0), (x1, -0.2, 0), (x1, 0.18, 0), (x0, 0.18, 0)), (0, 0, 1)),
                        (((x0, -0.2, 0), (x1, -0.2, 0), (x1, -0.2, 0.4), (x0, -0.2, 0.4)), (0, 1, 0)),
                        (((x0, -0.2, 0.4), (x1, -0.2, 0.4), (x1, 0.18, 0.4), (x0, 0.18, 0.4)), (0, 0, -1))):
        BM.gface(mb, list(pts), "P_ceramic", hint=hint, uv=(0.5, 0.5))
    stage = mb.finish("stage", st, cat="stage")
    for i, o in enumerate(objs):
        o.location = V(i * 0.4, 0, 0)
    ld = bpy.data.lights.new("strip", "AREA")
    ld.shape = "RECTANGLE"
    ld.size, ld.size_y = x1 - x0, 0.012
    ld.energy = 1.1 * (x1 - x0)
    ld.color = (1.0, 0.86, 0.70)
    lo = bpy.data.objects.new("strip", ld)
    lo.location = V((x0 + x1) / 2, 0.145, 0.393)
    st.objects.link(lo)
    ld = bpy.data.lights.new("room", "AREA")
    ld.shape = "RECTANGLE"
    ld.size, ld.size_y = x1 - x0 + 2, 2.0
    ld.energy = 180.0
    ld.color = (1.0, 0.92, 0.82)
    lo = bpy.data.objects.new("room", ld)
    lo.location = V((x0 + x1) / 2, 2.2, 1.2)
    d = (V((x0 + x1) / 2, 0, 0.1) - lo.location)
    lo.rotation_mode = "QUATERNION"
    lo.rotation_quaternion = d.to_track_quat("-Z", "Y")
    st.objects.link(lo)
    scene = bpy.context.scene
    w = bpy.data.worlds.new("pw")
    scene.world = w
    bg = next(nn for nn in w.node_tree.nodes if nn.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (0.9, 0.88, 0.85, 1)
    bg.inputs["Strength"].default_value = 0.35
    return stage


def bake(objs, size, samples):
    scene = bpy.context.scene
    BV.gpu(scene)
    # atlas UV for the baked faces (UV_P), packed over all props
    for o in objs:
        me = o.data
        me.uv_layers.new(name="UV_P")
        me.uv_layers.active = me.uv_layers["UV_P"]
    BV.select(objs)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(55), island_margin=0.004, area_weight=0.0, correct_aspect=True,
                             scale_to_bounds=False)
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(rotate=True, margin_method="FRACTION", margin=0.004, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")
    img = bpy.data.images.new("P_bake", size, size, alpha=False, float_buffer=True)
    added = []
    for m in {m for o in objs for m in o.data.materials if m}:
        nt = m.node_tree
        nd = nt.nodes.new("ShaderNodeTexImage")
        nd.image = img
        for x in nt.nodes:
            x.select = False
        nd.select = True
        nt.nodes.active = nd
        added.append((m, nd))
    state = BV.BakeMaterialState(emit_on=False)
    scene.cycles.samples = samples
    BV.select(objs)
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT", "COLOR"}, margin=6, use_clear=True,
                        target="IMAGE_TEXTURES", use_selected_to_active=False)
    state.restore()
    for m, nd in added:
        m.node_tree.nodes.remove(nd)
    import numpy as np
    px = np.empty(size * size * 4, np.float32)
    img.pixels.foreach_get(px)
    a = px.reshape(size, size, 4)[..., :3]
    # what the game shows: lit albedo x 0.8 (bake_village GAME_GAIN), encoded sRGB
    a = np.clip(a * BV.GAME_GAIN, 0, 1)
    a = np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(a, 1 / 2.4) - 0.055)
    out = os.path.join(TEXM, "T_m_props.png")
    BV.save_png(a, out)
    return out


def export(objs, tex):
    # export materials
    mats = {}
    def flat(name, col, alpha=1.0, image=None):
        m = bpy.data.materials.new(name + "_x")
        nt = m.node_tree
        for nd in list(nt.nodes):
            nt.nodes.remove(nd)
        o = nt.nodes.new("ShaderNodeOutputMaterial")
        b = nt.nodes.new("ShaderNodeBsdfPrincipled")
        b.inputs["Roughness"].default_value = 1.0
        nt.links.new(b.outputs[0], o.inputs["Surface"])
        if image:
            t = nt.nodes.new("ShaderNodeTexImage")
            t.image = bpy.data.images.load(image, check_existing=True)
            nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
        else:
            b.inputs["Base Color"].default_value = U.rgba(col)
        b.inputs["Alpha"].default_value = alpha
        return m
    for nm in ("M_props", "M_photo", "M_name", "M_flame", "M_jar_glass"):
        if bpy.data.materials.get(nm):
            bpy.data.materials[nm].name = nm + "__src"
    mats["M_props"] = flat("M_props", None, image=tex)
    mats["M_photo"] = flat("M_photo", "#9A9A9A")
    mats["M_name"] = flat("M_name", "#F5F2EA")
    mats["M_flame"] = flat("M_flame", "#FFC27A")
    mats["M_jar_glass"] = flat("M_jar_glass", "#EAF3F3", alpha=0.28)
    for o in objs:
        me = o.data
        uvp = me.uv_layers["UV_P"].data
        uv0 = me.uv_layers["UVMap"].data
        names = [m.name.replace("__src", "") for m in me.materials]
        for p in me.polygons:
            if names[p.material_index] not in UNBAKED:
                for li in p.loop_indices:
                    uv0[li].uv = uvp[li].uv
        me.uv_layers.remove(me.uv_layers["UV_P"])
        uniq = []
        for n_ in names:
            e = n_ if n_ in UNBAKED else "M_props"
            if e not in uniq:
                uniq.append(e)
        idx = [uniq.index(names[p.material_index] if names[p.material_index] in UNBAKED else "M_props") for p in me.polygons]
        me.materials.clear()
        for e in uniq:
            me.materials.append(mats[e])
        me.polygons.foreach_set("material_index", idx)
        if "Col" in me.color_attributes:
            me.color_attributes.remove(me.color_attributes["Col"])
        o.location = (0, 0, 0)
    for m in list(mats.values()):
        m.name = m.name[:-2]
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, "memorial_props.blend"), copy=True)
    glb = os.path.join(EXPORT, "memorial_props.glb")
    BV.select(objs)
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
                              export_texcoords=True, export_normals=False, export_materials="EXPORT",
                              export_image_format="WEBP", export_image_quality=85, export_animations=False,
                              export_cameras=False, export_lights=False, export_extras=False, export_vertex_color="NONE",
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6)
    js = BV.patch_glb(glb)
    js = patch_json(glb, see_through=("M_jar_glass",))
    print("[props] EXPORTED", glb, os.path.getsize(glb), [m.get("name") for m in js.get("materials", [])])


def patch_json(path, see_through=()):
    """Second pass over the GLB's JSON chunk: the jar glass blends (alpha 0.28)."""
    import json
    import struct
    data = open(path, "rb").read()
    magic, ver, length = struct.unpack_from("<III", data, 0)
    off, chunks = 12, []
    while off < length:
        clen, ctype = struct.unpack_from("<II", data, off)
        chunks.append([ctype, data[off + 8: off + 8 + clen]])
        off += 8 + clen
    js = json.loads(chunks[0][1].decode("utf-8"))
    for m in js.get("materials", []):
        if m.get("name") in see_through:
            m["alphaMode"] = "BLEND"
    raw = json.dumps(js, separators=(",", ":")).encode("utf-8")
    raw += b" " * ((4 - len(raw) % 4) % 4)
    chunks[0][1] = raw
    out = bytearray(struct.pack("<III", magic, ver, 0))
    for ctype, body in chunks:
        out += struct.pack("<II", len(body), ctype) + body
    struct.pack_into("<I", out, 8, len(out))
    open(path, "wb").write(bytes(out))
    return js


def main():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    objs = build()
    stage = bake_stage(objs)
    tex = bake(objs, arg("--size", 1024, int), arg("--samples", 512, int))
    bpy.data.objects.remove(stage)
    export(objs, tex)


if __name__ == "__main__":
    main()
