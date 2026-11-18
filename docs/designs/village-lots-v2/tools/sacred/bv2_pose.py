# 본존불 v2, stage A — pose Blender Studio's CC0 "Human Base Meshes" realistic male (GEO-body_male_realistic, multires 3) into
# full lotus (결가부좌) with the earth-touching hands (항마촉지인) through an armature, and bake the posed mesh.
#   blender -b <human_base_meshes_bundle.blend> -P bv2_pose.py -- <out.blend>
# Units: the base mesh's own metres (1.69 m tall, centred on x = 0, face toward -Y). Stage B (bv2_sculpt.py) scales and sculpts.
import bpy, sys, math
from mathutils import Vector, Matrix, Quaternion

OUT = sys.argv[sys.argv.index("--") + 1]
body = bpy.data.objects["GEO-body_male_realistic"]
eyes = [bpy.data.objects[f"GEO-body_male_realistic.eye.{s}"] for s in "LR"]
keep = {body.name, "Foot - Realistic"} | {e.name for e in eyes}
for o in list(bpy.data.objects):
    if o.name not in keep: bpy.data.objects.remove(o, do_unlink=True)
sc = bpy.context.scene
for o in [body, bpy.data.objects["Foot - Realistic"]] + eyes:
    if o.name not in sc.collection.objects: sc.collection.objects.link(o)
for c in list(bpy.data.collections): bpy.data.collections.remove(c)
dx = -body.location.x
body.location.x = 0.0
for e in eyes: e.parent = None; e.matrix_world = Matrix.Translation((dx, 0, 0)) @ e.matrix_world
bpy.context.view_layer.update()

V = Vector
# rest joints (A-pose, measured from the mesh: front x/z and side y/z scatter plots)
J = {
    "pelvis": (V((0, 0.0, 0.93)), V((0, 0.0, 1.10))),
    "spine": (V((0, 0.0, 1.10)), V((0, 0.01, 1.28))),
    "chest": (V((0, 0.01, 1.28)), V((0, 0.01, 1.43))),
    "neck": (V((0, 0.01, 1.43)), V((0, -0.005, 1.53))),
    "head": (V((0, -0.005, 1.53)), V((0, -0.005, 1.69))),
}
for s, k in (("L", 1), ("R", -1)):
    J[f"clav.{s}"] = (V((k * 0.03, -0.01, 1.41)), V((k * 0.17, 0.0, 1.405)))
    J[f"uarm.{s}"] = (V((k * 0.18, 0.0, 1.40)), V((k * 0.28, 0.02, 1.10)))
    J[f"farm.{s}"] = (V((k * 0.28, 0.02, 1.10)), V((k * 0.355, -0.01, 0.86)))
    J[f"hand.{s}"] = (V((k * 0.355, -0.01, 0.86)), V((k * 0.40, -0.03, 0.74)))
    J[f"thigh.{s}"] = (V((k * 0.09, 0.0, 0.93)), V((k * 0.10, -0.015, 0.50)))
    J[f"shin.{s}"] = (V((k * 0.10, -0.015, 0.50)), V((k * 0.12, 0.03, 0.09)))
    J[f"foot.{s}"] = (V((k * 0.12, 0.03, 0.09)), V((k * 0.13, -0.15, 0.02)))
PARENT = {"spine": "pelvis", "chest": "spine", "neck": "chest", "head": "neck"}
for s in "LR":
    PARENT.update({f"clav.{s}": "chest", f"uarm.{s}": f"clav.{s}", f"farm.{s}": f"uarm.{s}", f"hand.{s}": f"farm.{s}",
                   f"thigh.{s}": "pelvis", f"shin.{s}": f"thigh.{s}", f"foot.{s}": f"shin.{s}"})

arm_d = bpy.data.armatures.new("rig"); rig = bpy.data.objects.new("rig", arm_d); sc.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig; rig.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
for n, (h, t) in J.items():
    b = arm_d.edit_bones.new(n); b.head = h; b.tail = t; b.roll = 0
for n, p in PARENT.items():
    arm_d.edit_bones[n].parent = arm_d.edit_bones[p]
    arm_d.edit_bones[n].use_connect = False
bpy.ops.object.mode_set(mode="OBJECT")

# weights: Blender's bone heat on the multires base cage
for o in bpy.context.view_layer.objects: o.select_set(False)
body.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type="ARMATURE_AUTO")
empty = [g.name for g in body.vertex_groups if not any(g.index in [x.group for x in v.groups] for v in list(body.data.vertices)[::7])]
print("BV2 groups", len(body.vertex_groups), "sparse/empty:", empty)
mods = [m.type for m in body.modifiers]; print("BV2 mods", mods)
for e in eyes:
    mw = e.matrix_world.copy(); e.parent = rig; e.parent_type = "BONE"; e.parent_bone = "head"; e.matrix_world = mw

# ---- pose targets (bone head -> tail direction) and the roll references
T = {
    "thigh.R": ((-0.36, -0.33, 0.87), ((0, -1, 0), (-0.55, 0, 0.83))),   # (target tail, (rest front, wanted front))
    "shin.R": ((0.02, -0.17, 0.96), ((0, -1, 0), (0, -0.45, 0.9))),
    "foot.R": ((0.24, -0.22, 0.97), ((0, 0, -1), (0, -0.55, 0.83))),     # sole up and toward the viewer
    "thigh.L": ((0.36, -0.33, 0.84), ((0, -1, 0), (0.55, 0, 0.83))),
    "shin.L": ((-0.03, -0.15, 0.87), ((0, -1, 0), (0, -0.3, 0.95))),
    "foot.L": ((-0.24, -0.10, 0.89), ((0, 0, -1), (0, -0.35, 0.94))),
    "uarm.R": ((-0.26, -0.12, 1.13), ((0, -1, 0), (0, -1, 0))),
    "farm.R": ((-0.33, -0.35, 0.975), ((1, 0, 0), (1, 0.4, 0))),
    "hand.R": ((-0.335, -0.43, 0.84), ((1, 0, 0), (0.15, 1, 0.35))),       # palm on the knee, fingers down
    "uarm.L": ((0.24, -0.04, 1.12), ((0, -1, 0), (0, -1, 0))),
    "farm.L": ((0.10, -0.22, 1.0), ((-1, 0, 0), (0, 0, 1))),
    "hand.L": ((-0.07, -0.25, 0.985), ((-1, 0, 0), (0, 0, 1))),           # palm up in the lap
}
HEAD_TILT = math.radians(7)
CHAIN = ["pelvis", "spine", "chest", "neck", "head", "clav.L", "clav.R", "uarm.L", "farm.L", "hand.L", "uarm.R", "farm.R", "hand.R",
         "thigh.L", "shin.L", "foot.L", "thigh.R", "shin.R", "foot.R"]
pose = rig.pose.bones
bpy.context.view_layer.update()
for n in CHAIN:
    pb = pose[n]
    if n == "head":
        pb.rotation_mode = "XYZ"; pb.rotation_euler = (HEAD_TILT, 0, 0)  # local X: nod forward
        bpy.context.view_layer.update(); continue
    if n not in T: continue
    tgt, (rf, wf) = T[n]
    M = pb.matrix.copy()                          # current armature-space matrix (parent already posed)
    head = M.translation.copy()
    cur_dir = (M.to_3x3() @ V((0, 1, 0))).normalized()
    want = (V(tgt) - head).normalized()
    q1 = cur_dir.rotation_difference(want)
    # the rest-space front vector carried along: rest bone matrix maps it; add the parent's pose rotation
    rest = pb.bone.matrix_local.to_3x3()
    pose_rot = M.to_3x3() @ rest.inverted()
    front_now = (q1.to_matrix() @ pose_rot @ V(rf)).normalized()
    wfv = V(wf).normalized()
    a = want
    p1 = (front_now - a * front_now.dot(a)).normalized(); p2 = (wfv - a * wfv.dot(a)).normalized()
    ang = math.atan2(a.dot(p1.cross(p2)), p1.dot(p2))
    q = Quaternion(a, ang) @ q1
    R = q.to_matrix().to_4x4() @ Matrix.Translation(-head)
    pb.matrix = Matrix.Translation(head) @ R @ M
    bpy.context.view_layer.update()
    d = (pb.tail - V(tgt)).length
    print("BV2 pose", n, "tail err", round(d, 3), "roll", round(math.degrees(ang)))

bpy.ops.wm.save_as_mainfile(filepath=OUT)
print("BV2 saved", OUT)
