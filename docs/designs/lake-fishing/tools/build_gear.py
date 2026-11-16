# build_gear.py - lake_gear.glb: 2-kan rod (8-bone chain, folded/extended), float + chemi light stick, landing net.
#   "C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" -b --python art/lake/tools/build_gear.py -- out.glb
# Authored in glTF space (see lakelib_gear.G). Hand contract: shared/src/village/fishingAnims.ts (ROD_AXIS_R, NET_AXIS_L, GRIP_OFFSET).
#  root nodes: grip (armature; origin = hold point; rod axis = ROD_AXIS_R in node-local, butt behind), float (origin = waterline,
#  children float_top / chemi), net_grip (origin = hold point; handle axis = NET_AXIS_L, hoop normal = local +Z, bag hangs to -Z).
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
from mathutils import Vector, Quaternion
from lakelib_gear import *

U_R = Vector((-0.8, 0.6, 0.0)).normalized()
U_L = Vector((0.8, 0.6, 0.0)).normalized()
GRIP_S = 0.32                      # hold point distance from the butt (m)
LEN = [0.62, 0.60, 0.58, 0.56, 0.54, 0.52, 0.62]   # seg1..seg7 lengths (seg7 includes the 0.12 red tip)
OVERLAP = 0.14
HANDLE = 0.55
FOLD_END = 1.15
C_CARBON = srgb("#14161d"); C_NAVY = srgb("#1c2540"); C_GOLD = srgb("#c9a24a"); C_EVA = srgb("#22252b")
C_EVA2 = srgb("#3a3f48"); C_RED = srgb("#d3261c"); C_SILVER = srgb("#b9bec6")

ext_start = [0.0, HANDLE - OVERLAP]
for i in range(1, 7):
    ext_start.append(ext_start[-1] + LEN[i - 1] - OVERLAP)
fold_start = [0.0] + [FOLD_END - l for l in LEN]
ext_len = ext_start[7] + LEN[6]


def P(s):
    return U_R * (s - GRIP_S)


THICK = 1.5   # readability: everything on the rod is 1.5x thicker than real (chibi avatar, camera 12 m away)


def seg_radius(i, t):
    r0 = (0.0112 - 0.0014 * i) * THICK
    return r0 * (1 - 0.08 * t)


def build_rod():
    arm = bpy.data.armatures.new("rod_rig")
    ob = bpy.data.objects.new("grip", arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    for i in range(8):
        eb = arm.edit_bones.new(f"rod{i}")
        s0 = ext_start[i]
        s1 = ext_start[i + 1] if i < 7 else ext_start[7] + LEN[6]
        if i == 0:
            s1 = ext_start[1] + 0.02
        eb.head = Gv(P(s0)); eb.tail = Gv(P(s1))
        eb.align_roll(G(0, 0, 1))   # bone local +Z = hand-back direction; bend = rotation about local X
        if i:
            eb.parent = arm.edit_bones[f"rod{i-1}"]
    bpy.ops.object.mode_set(mode="OBJECT")

    bm = bmesh.new()
    W = lambda i: [(i, 1.0)]
    # handle (EVA): butt cap, soft swell, finger grooves, metal collar
    prof = [(t, r * THICK) for t, r in [(0.0, 0.0), (0.004, 0.012), (0.03, 0.0150), (0.30, 0.0178), (0.52, 0.0186), (0.62, 0.0176), (0.88, 0.0160), (0.94, 0.0170), (1.0, 0.0150)]]
    profile_tube(bm, P(0), P(HANDLE), prof, 12, caps=(False, True), col=C_EVA, groups=W(0))
    for a, b in ((0.18, 0.20), (0.40, 0.42), (0.60, 0.62), (0.76, 0.78)):
        tube(bm, P(a * HANDLE), P(b * HANDLE), 0.0189 * THICK, 0.0189 * THICK, 12, col=C_EVA2, groups=W(0))
    tube(bm, P(0.0), P(0.04), 0.0125 * THICK, 0.0125 * THICK, 12, col=C_GOLD, groups=W(0))             # butt ring
    tube(bm, P(HANDLE - 0.05), P(HANDLE - 0.025), 0.0175 * THICK, 0.0175 * THICK, 12, col=C_GOLD, groups=W(0))
    # telescoping carbon segments + joint rings
    for i in range(1, 8):
        s0 = ext_start[i]; s1 = s0 + LEN[i - 1]
        col = C_CARBON if i % 2 else C_NAVY
        body_end = s1 - (0.12 if i == 7 else 0.0)
        r_a = seg_radius(i, 0); r_b = seg_radius(i, 1) * (1 if i < 7 else 0.78)
        tube(bm, P(s0), P(body_end), r_a, r_b, 10, col=col, groups=W(i))
        if i < 7:
            re = seg_radius(i, 1) + 0.001           # gold joint ring at the front end of every segment
            tube(bm, P(s1 - 0.02), P(s1), re, re, 10, col=C_GOLD, groups=W(i))
            tube(bm, P(s1 - 0.06), P(s1 - 0.045), re, re, 10, col=C_RED, groups=W(i))
        else:
            tube(bm, P(body_end), P(s1), r_b, 0.0009, 8, col=C_RED, groups=W(7))
            # line eye: small ring at the very tip
            c = P(s1)
            u, v, w = frame(U_R, Vector((0, 0, 1)))
            n = 8; rr = 0.0045
            for k in range(n):
                a0 = 2 * math.pi * k / n; a1 = 2 * math.pi * (k + 1) / n
                p0 = c + v * (math.sin(a0) * rr + rr) + u * (math.cos(a0) * rr)
                p1 = c + v * (math.sin(a1) * rr + rr) + u * (math.cos(a1) * rr)
                tube(bm, p0, p1, 0.0010, 0.0010, 4, col=C_SILVER, groups=W(7), caps=(False, False))
    m = vc_material("M_rod", rough=0.32, metal=0.25)
    rod = new_obj("rod_mesh", bm, [m])
    for i in range(8):
        rod.vertex_groups.new(name=f"rod{i}")
    rod.parent = ob
    rod.modifiers.new("Armature", "ARMATURE").object = ob
    tip = bpy.data.objects.new("rod_tip", None)
    tip.empty_display_size = 0.02
    bpy.context.scene.collection.objects.link(tip)
    tip.parent = ob; tip.parent_type = "BONE"; tip.parent_bone = "rod7"
    tip.location = (0, 0, 0)      # bone-parent space origin = bone TAIL
    return ob, rod, tip


def pose_all(ob, loc=None, bend=None):
    for pb in ob.pose.bones:
        pb.rotation_mode = "XYZ"
        pb.location = (0, 0, 0); pb.rotation_euler = (0, 0, 0)
    for i, v in (loc or {}).items():
        ob.pose.bones[f"rod{i}"].location = (0, v, 0)
    for i, a in (bend or {}).items():
        ob.pose.bones[f"rod{i}"].rotation_euler = (a, 0, 0)


def key(ob, frame_):
    for pb in ob.pose.bones:
        pb.keyframe_insert("location", frame=frame_, group=pb.name)
        pb.keyframe_insert("rotation_euler", frame=frame_, group=pb.name)


def fold_loc(progress):
    """progress[i] 0 = folded, 1 = extended: local-Y offset relative to the parent bone."""
    d = [0.0] * 8
    for i in range(1, 8):
        d[i] = (fold_start[i] - ext_start[i]) * (1 - progress[i])
    return {i: d[i] - d[i - 1] for i in range(1, 8)}


def bend_set(total_deg):
    w = [0, 0.4, 0.55, 0.75, 1.0, 1.3, 1.6, 1.8]
    s = sum(w)
    return {i: -math.radians(total_deg) * w[i] / s for i in range(1, 8)}


def make_actions(ob):
    ob.animation_data_create()
    acts = {}

    def clip(name, frames):
        a = bpy.data.actions.new(name)
        a.use_fake_user = True
        ob.animation_data.action = a
        for f, (loc, bend) in frames:
            pose_all(ob, loc, bend)
            key(ob, f)
        ob.animation_data.action = None
        acts[name] = a
    ext = {i: 1.0 for i in range(1, 8)}; fold = {i: 0.0 for i in range(1, 8)}
    clip("Rod_Folded", [(0, (fold_loc(fold), None)), (1, (fold_loc(fold), None))])
    clip("Rod_Extended", [(0, (None, None)), (1, (None, None))])
    ext_frames = []
    for f in range(0, 15):
        pr = {}
        for i in range(1, 8):
            st = (7 - i) * 0.9; t = min(max((f - st) / 7.0, 0.0), 1.0)
            pr[i] = t * t * (3 - 2 * t)
        ext_frames.append((f, (fold_loc(pr), None)))
    clip("Rod_Extend", ext_frames)
    clip("Rod_Bend_Idle", [(0, (None, bend_set(8))), (1, (None, bend_set(8)))])
    clip("Rod_Bend_Fight", [(0, (None, bend_set(55))), (1, (None, bend_set(55)))])
    pose_all(ob)
    return acts


def build_float():
    bm = bmesh.new()
    C_B = srgb("#16181c"); C_W = srgb("#ece8dc"); C_Y = srgb("#f2c218"); C_G = srgb("#2aa84a"); C_R2 = srgb("#e8362a")
    up = Vector((0, 0, 1)); Y = lambda y: Vector((0, y, 0))
    r = 0.0058
    tube(bm, Y(0.150), Y(0.200), r, r * 0.95, 10, col=C_R2, up_hint=up, caps=(False, False))
    tube(bm, Y(0.200), Y(0.205), r * 0.95, r * 0.95, 10, col=C_W, up_hint=up, caps=(False, False))
    tube(bm, Y(0.205), Y(0.250), r * 0.95, r * 0.9, 10, col=C_Y, up_hint=up, caps=(False, False))
    tube(bm, Y(0.250), Y(0.255), r * 0.9, r * 0.9, 10, col=C_W, up_hint=up, caps=(False, False))
    tube(bm, Y(0.255), Y(0.290), r * 0.9, r * 0.9, 10, col=C_G, up_hint=up, caps=(False, False))
    tube(bm, Y(0.286), Y(0.300), 0.0070, 0.0070, 10, col=C_B, up_hint=up, caps=(True, False))
    tube(bm, Y(0.050), Y(0.150), 0.0058, r, 10, col=C_W, up_hint=up, caps=(False, False))
    prof = [(0.0, 0.0030), (0.2, 0.0062), (0.55, 0.0092), (0.85, 0.0086), (1.0, 0.0050)]
    profile_tube(bm, Y(-0.16), Y(0.050), prof, 10, col=C_B, up_hint=up, caps=(True, False))
    tube(bm, Y(-0.03), Y(0.0), 0.0093, 0.0093, 10, col=C_W, up_hint=up, caps=(False, False))
    tube(bm, Y(-0.20), Y(-0.16), 0.0010, 0.0030, 6, col=C_SILVER, up_hint=up)
    rr = 0.0045
    for k in range(10):
        a0 = 2 * math.pi * k / 10; a1 = 2 * math.pi * (k + 1) / 10
        tube(bm, Vector((rr * math.cos(a0), -0.205 - rr, rr * math.sin(a0))),
             Vector((rr * math.cos(a1), -0.205 - rr, rr * math.sin(a1))), 0.0007, 0.0007, 4, col=C_SILVER, caps=(False, False))
    m = vc_material("M_float", rough=0.35)
    fl = new_obj("float_mesh", bm, [m])
    root = bpy.data.objects.new("float", None)
    bpy.context.scene.collection.objects.link(root)
    fl.parent = root
    bm = bmesh.new()
    tube(bm, Y(0.296), Y(0.346), 0.0042, 0.0042, 10, up_hint=up)
    mc = mat("M_chemi", srgb("#5fe024"), rough=0.3, emit=srgb("#4cff1a"), emit_strength=1.2)
    ch = new_obj("chemi", bm, [mc])
    ch.parent = root
    top = bpy.data.objects.new("float_top", None)
    top.empty_display_size = 0.02
    bpy.context.scene.collection.objects.link(top)
    top.parent = root
    top.location = G(0, 0.346, 0)
    return root


def build_net():
    bm = bmesh.new()
    N = Vector((0, 0, 1)); A = U_L
    S = A.cross(N).normalized()
    C_AL = srgb("#a7adb6"); C_RUB = srgb("#1d2024"); C_FR = srgb("#8f959e"); C_NET = srgb("#1f4a2c")
    H0, H1 = -0.35, 1.15; R = 0.25; depth = 0.38
    Pn = lambda s: A * s
    tube(bm, Pn(H0), Pn(H0 + 0.03), 0.014, 0.017, 10, col=C_RUB)
    tube(bm, Pn(H0 + 0.03), Pn(0.22), 0.017, 0.0165, 10, col=C_RUB)
    tube(bm, Pn(0.22), Pn(0.235), 0.0185, 0.0185, 10, col=C_FR)
    tube(bm, Pn(0.235), Pn(H1), 0.0165, 0.0145, 10, col=C_AL)
    for s in (0.62, 0.90):
        tube(bm, Pn(s - 0.01), Pn(s + 0.01), 0.0140, 0.0140, 10, col=C_FR)
    Cc = Pn(H1 + R)
    n = 28
    ring = [Cc + A * (-math.cos(2 * math.pi * k / n) * R) + S * (math.sin(2 * math.pi * k / n) * R) for k in range(n + 1)]
    for k in range(n):
        tube(bm, ring[k], ring[k + 1], 0.0150, 0.0150, 6, col=C_FR, caps=(False, False))
    tube(bm, Pn(H1 - 0.04), Pn(H1 + 0.04), 0.0175, 0.0175, 10, col=C_FR)
    nm, nl = 16, 5

    def pt(a, lam):
        return Cc + A * (-math.cos(a) * R * math.cos(lam)) + S * (math.sin(a) * R * math.cos(lam)) - N * (depth * math.sin(lam))
    grid = [[pt(2 * math.pi * k / nm, (math.pi / 2) * j / nl * 0.999) for k in range(nm)] for j in range(nl + 1)]
    sr = 0.0040
    for k in range(nm):
        for j in range(nl):
            tube(bm, grid[j][k], grid[j + 1][k], sr, sr, 4, col=C_NET, caps=(False, False))
    for j in range(1, nl + 1):
        for k in range(nm):
            tube(bm, grid[j][k], grid[j][(k + 1) % nm], sr, sr, 4, col=C_NET, caps=(False, False))
    m = vc_material("M_net", rough=0.7)
    ob = new_obj("net_mesh", bm, [m])
    root = bpy.data.objects.new("net_grip", None)
    bpy.context.scene.collection.objects.link(root)
    ob.parent = root
    return root


def count_tris(objs):
    d = {}
    for o in objs:
        if o.type == "MESH":
            me = o.data
            me.calc_loop_triangles()
            d[o.name] = len(me.loop_triangles)
    return d


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = argv[0] if argv else "lake_gear.glb"
    reset_scene()
    rod_ob, rod_mesh, tip = build_rod()
    acts = make_actions(rod_ob)
    build_float()
    build_net()
    ad = rod_ob.animation_data
    for name, a in acts.items():
        tr = ad.nla_tracks.new(); tr.name = name
        tr.strips.new(name, 0, a)
        tr.mute = True
    ad.action = None
    pose_all(rod_ob)
    rod_ob.data.pose_position = "POSE"
    tris = count_tris(bpy.data.objects)
    print("TRIS", tris, "TOTAL", sum(tris.values()))
    print("ROD extended length", ext_len, "folded", FOLD_END)
    export_glb(out, selection=list(bpy.context.scene.objects), animations=True, export_animation_mode="NLA_TRACKS",
               export_optimize_animation_size=True, export_reset_pose_bones=True)
    print("EXPORTED", out, os.path.getsize(out))
    if "--save" in argv:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(out), "lake_gear.blend"))


main()
