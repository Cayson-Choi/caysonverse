# 본존불 v2, stage B — from the posed CC0 base body (bv2_pose.py) to the sculpted high-poly statue, in the base mesh's own units
# (1.69 m man, face toward -Y; stage C scales it onto the throne):
#   skin (multires 3 + armature, evaluated) -> soften the anatomy into the idealised, full Seokguram body -> elongated earlobes ->
#   robe: a thin clinging shell over the left shoulder (우견편단: right shoulder, arm and chest bare) + a draped lap over the crossed
#   legs (metaball capsules) -> half-closed lids, 육계 -> one voxel union -> carved detail: robe folds parallel to the robe edge,
#   leg folds along the shins, 삼도 neck rings, crisp arched brows, the eye slits, 백호, the faint smile -> 나발 snail curls.
#   blender -b a_pose.blend -P bv2_sculpt.py -- <out.blend> [voxel=0.0016]
import bpy, bmesh, sys, math, time, os
import numpy as np
from mathutils import Vector, Matrix, kdtree
from mathutils.bvhtree import BVHTree

t0 = time.time()
A = sys.argv[sys.argv.index("--") + 1:]
OUT = A[0]
VOX = float(A[1]) if len(A) > 1 else 0.0016
sc = bpy.context.scene
rig = bpy.data.objects["rig"]
body = bpy.data.objects["GEO-body_male_realistic"]


def log(*a):
    print("BV2S", round(time.time() - t0, 1), *a, flush=True)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def mesh_arrays(me):
    n = len(me.vertices)
    co = np.empty(n * 3, np.float64); me.vertices.foreach_get("co", co)
    ed = np.empty(len(me.edges) * 2, np.int64); me.edges.foreach_get("vertices", ed)
    return co.reshape(-1, 3), ed.reshape(-1, 2)


def vnormals(me):
    nr = np.empty(len(me.vertices) * 3, np.float64); me.vertices.foreach_get("normal", nr); return nr.reshape(-1, 3)


def laplace(co, ed, w, it, lam=0.5, mu=-0.53):
    """Taubin smoothing (no shrink) with a per-vertex strength w (0..1)"""
    n = len(co)
    deg = np.bincount(ed.ravel(), minlength=n).astype(np.float64); deg[deg == 0] = 1
    for i in range(it):
        s = np.zeros_like(co)
        np.add.at(s, ed[:, 0], co[ed[:, 1]]); np.add.at(s, ed[:, 1], co[ed[:, 0]])
        d = s / deg[:, None] - co
        co = co + d * (w[:, None] * (lam if i % 2 == 0 else mu))
    return co


def smooth_field(f, ed, it):
    n = len(f); deg = np.bincount(ed.ravel(), minlength=n).astype(np.float64); deg[deg == 0] = 1
    for _ in range(it):
        s = np.zeros(n); np.add.at(s, ed[:, 0], f[ed[:, 1]]); np.add.at(s, ed[:, 1], f[ed[:, 0]])
        f = 0.5 * f + 0.5 * s / deg
    return f


def obj_from(name, me):
    o = bpy.data.objects.new(name, me); sc.collection.objects.link(o); return o


# ---------------- the posed skin ----------------
# two evaluations of the same subdivided topology: the sculpted detail (multires 3) and the smooth base cage (multires 0 +
# Catmull-Clark 3): the idealised body is mostly the smooth one, the hands, ears, nose and lips the detailed one
mr = body.modifiers["Multires"]
# the base cage carries the gym anatomy (pecs, abs, biceps): a plain Laplacian on the cage itself (rest pose, ~1.5 cm edges)
# rounds it into the full, calm Seokguram body; the head and hands are left alone, the shrink is given back along the normals
bme = body.data
bc = np.empty(len(bme.vertices) * 3); bme.vertices.foreach_get("co", bc); bc = bc.reshape(-1, 3)
bed = np.empty(len(bme.edges) * 2, np.int64); bme.edges.foreach_get("vertices", bed); bed = bed.reshape(-1, 2)
bn = np.empty(len(bme.vertices) * 3); bme.vertices.foreach_get("normal", bn); bn = bn.reshape(-1, 3)
gidx = {g.name: g.index for g in body.vertex_groups}
BW = np.zeros((len(bme.vertices), len(gidx)))
for v in bme.vertices:
    for g in v.groups: BW[v.index, g.group] = g.weight
bws = lambda *ns: sum(BW[:, gidx[n]] for n in ns)
cs_w = np.clip(bws("pelvis", "spine", "chest") + 1.0 * bws("uarm.L", "uarm.R", "farm.L", "farm.R", "clav.L", "clav.R") + 0.7 * bws("thigh.L", "thigh.R", "shin.L", "shin.R"), 0, 1)
cs_w *= (1 - np.clip(bws("head", "hand.L", "hand.R", "foot.L", "foot.R") * 1.5, 0, 1))
cs_w = smooth_field(cs_w, bed, 3)
bc0 = bc.copy()
bc = laplace(bc, bed, cs_w * 0.95, 30, lam=0.5, mu=0.5)   # (pass 2/3, owner: "몸을 더 둥글고 넉넉하게", "더 다듬어": no pecs, no biceps)
shrink = np.sum((bc - bc0) * bn, axis=1)          # how far each cage vertex sank along its normal
shrink = smooth_field(shrink, bed, 6)
bc = bc - bn * (shrink * 1.0)[:, None]
# ---- the right hand's mudra (owner's reference v2, "오른손 중지와 엄지를 다시 한번 확인해봐"): the thumb tip and the middle-finger tip
# meet in a small ring, the index points straight up, the ring and little fingers stand up gently curved. Bent on the base cage in
# the rest pose (the A-pose hand hangs with its palm toward the thigh, +X, fingers down -Z), so the multires detail follows the bends.
def mudra(bc, bed):
    R_HAND = (bc[:, 0] < -0.33) & (bc[:, 2] < 0.875) & (bc[:, 2] > 0.68)
    KN = 0.775                                  # below this line the base cage's four fingers are separate branches of the mesh
    fing = R_HAND & (bc[:, 2] < KN)
    # connected components of the finger verts (edges inside the set)
    idx = np.where(fing)[0]; pos = -np.ones(len(bc), np.int64); pos[idx] = np.arange(len(idx))
    par = np.arange(len(idx))
    def find(a):
        while par[a] != a:
            par[a] = par[par[a]]; a = par[a]
        return a
    for a, b in bed:
        if pos[a] >= 0 and pos[b] >= 0:
            ra, rb = find(pos[a]), find(pos[b])
            if ra != rb: par[ra] = rb
    roots = np.array([find(i) for i in range(len(idx))])
    comps = [idx[roots == r] for r in np.unique(roots)]
    comps = [c for c in comps if len(c) > 12]
    comps.sort(key=lambda c: bc[c, 1].mean())          # front (-Y, by the thumb) -> back: index, middle, ring, little
    log("mudra fingers", [len(c) for c in comps], [round(float(bc[c, 1].mean()), 3) for c in comps])
    if len(comps) != 4:
        return bc
    out = bc.copy()
    palm = np.array([1.0, 0.0, 0.0])                    # the palm faces +X in the rest pose
    tips = {}

    # the fingers held together (the reference): close the A-pose splay about the palm normal at each knuckle, toward the middle
    tops = []
    for c in comps:
        P = bc[c]; tops.append((P[P[:, 2] > KN - 0.012].mean(0), P[np.argmin(P[:, 2])]))
    mid_dir = np.mean([(t - k) / np.linalg.norm(t - k) for k, t in tops], 0); mid_dir /= np.linalg.norm(mid_dir)
    for (k_, t_), c, close in zip(tops, comps, (0.85, 0.6, 0.85, 0.9)):
        d_ = (t_ - k_) / np.linalg.norm(t_ - k_)
        ang = np.arctan2(np.dot(np.cross(d_, mid_dir), palm), np.dot(d_, mid_dir)) * close
        Rm = np.array(Matrix.Rotation(float(ang), 3, Vector(palm)))
        ext = np.where(R_HAND & (np.abs(bc[:, 1] - bc[c, 1].mean()) < 0.0135) & (bc[:, 2] >= KN) & (bc[:, 2] < KN + 0.026) & (bc[:, 0] < -0.385))[0]
        allv = np.concatenate([c, ext]); piv = k_ + (k_ - t_) / np.linalg.norm(t_ - k_) * 0.018
        tt = (bc[allv] - piv) @ d_
        w = np.clip(tt / 0.02, 0, 1)
        Xr = (bc[allv] - piv) @ Rm.T + piv
        bc[allv] = bc[allv] * (1 - w[:, None]) + Xr * w[:, None]
    out = bc.copy()

    def bend(c, angles, name):
        # the finger's axis: from its knuckle (top) to its tip (lowest point)
        P = bc[c]
        top = P[P[:, 2] > KN - 0.012].mean(0) if (P[:, 2] > KN - 0.012).any() else P[np.argmax(P[:, 2])]
        tip = P[np.argmin(P[:, 2])]
        # extend the finger's set up to the knuckle so the MCP bends the base of the finger smoothly
        ext = np.where(R_HAND & (np.abs(bc[:, 1] - P[:, 1].mean()) < 0.0135) & (bc[:, 2] >= KN) & (bc[:, 2] < KN + 0.026) & (bc[:, 0] < -0.385))[0]
        allv = np.concatenate([c, ext])
        ax = tip - top; ax /= np.linalg.norm(ax)
        mcp = top - ax * 0.018                          # the knuckle itself sits ~2 cm above the cut
        L = np.linalg.norm(tip - mcp)
        joints = [(0.0, angles[0]), (0.45, angles[1]), (0.74, angles[2])]
        X = out[allv].copy()
        jp = [mcp + ax * (t * L) for t, _ in joints]
        tip_p = tip.copy()
        for j, (tj, aj) in enumerate(joints):
            if aj == 0: continue
            k = np.cross(ax, palm); k /= np.linalg.norm(k)        # flexion axis: curls the finger toward the palm
            th = np.radians(aj)
            Rm = np.array(Matrix.Rotation(th, 3, Vector(k)))
            tt = (X - jp[j]) @ ax / L
            w = np.clip((tt + 0.04) / 0.08, 0, 1); w = w * w * (3 - 2 * w)
            Xr = (X - jp[j]) @ Rm.T + jp[j]
            X = X * (1 - w[:, None]) + Xr * w[:, None]
            # the later joints and the tip ride along
            for jj in range(j + 1, len(jp)): jp[jj] = (jp[jj] - jp[j]) @ Rm.T + jp[j]
            tip_p = (tip_p - jp[j]) @ Rm.T + jp[j]
            ax = (Rm @ ax); ax /= np.linalg.norm(ax)
        out[allv] = X
        tips[name] = tip_p
        return tip_p

    bend(comps[0], (0, 0, 0), "index")
    mid_tip = bend(comps[1], (52, 72, 34), "middle")
    bend(comps[2], (4, 7, 4), "ring")
    bend(comps[3], (6, 9, 6), "little")
    # the thumb: from its base by the wrist to its tip, swung across the palm until its tip meets the middle fingertip
    th_tip = np.array([-0.369, -0.179, 0.806]); th_base = np.array([-0.372, -0.135, 0.852])
    seg = th_tip - th_base; Lt = np.linalg.norm(seg); sd = seg / Lt
    q = bc - th_base; tpar = q @ sd / Lt
    rad = np.linalg.norm(q - np.outer(tpar * Lt, sd), axis=1)
    thumb = R_HAND & (tpar > -0.05) & (tpar < 1.25) & (rad < 0.020) & (bc[:, 1] < -0.145)
    want = (mid_tip + np.array([0.004, -0.004, 0.0])) - th_base
    rot = Vector(sd).rotation_difference(Vector(want / np.linalg.norm(want))).to_matrix()
    Rt = np.array(rot)
    w = np.clip((tpar - 0.0) / 0.35, 0, 1); w = w * w * (3 - 2 * w)
    X = bc[thumb]
    Xr = (X - th_base) @ Rt.T + th_base
    # stretch a little along the new direction if the tip falls short of the middle fingertip
    stretch = max(0.0, min(0.25, np.linalg.norm(want) / Lt - 1))
    sd2 = want / np.linalg.norm(want)
    Xr = Xr + np.outer(((Xr - th_base) @ sd2) * stretch * w[thumb], sd2)
    out[thumb] = X * (1 - w[thumb][:, None]) + Xr * w[thumb][:, None]
    log("mudra thumb verts", int(thumb.sum()), "gap", round(float(np.linalg.norm(want) - Lt), 4), "middle tip", np.round(mid_tip, 3))
    return out


bc = mudra(bc, bed)
bme.vertices.foreach_set("co", bc.ravel()); bme.update()
mr.levels = 0
ss = body.modifiers.new("ss", "SUBSURF"); ss.levels = 3; ss.render_levels = 3
bpy.ops.object.select_all(action="DESELECT")
while body.modifiers[1].name != "ss":
    body.modifiers.move(body.modifiers.find("ss"), 1)
dg = bpy.context.evaluated_depsgraph_get()
me_s = bpy.data.meshes.new_from_object(body.evaluated_get(dg), depsgraph=dg)
body.modifiers.remove(ss); mr.levels = 3
dg = bpy.context.evaluated_depsgraph_get()
me = bpy.data.meshes.new_from_object(body.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
me.transform(body.matrix_world); me_s.transform(body.matrix_world)
print("BV2S topo", len(me.vertices), len(me_s.vertices))
names = [g.name for g in body.vertex_groups]
NV = len(me.vertices)
W = np.zeros((NV, len(names)), np.float32)
for v in me.vertices:
    for g in v.groups: W[v.index, g.group] = g.weight
lab = W.argmax(1)
gi = {n: i for i, n in enumerate(names)}
co, ed = mesh_arrays(me)
co_s, _ = mesh_arrays(me_s)
log("skin", NV, "z", co[:, 2].min(), co[:, 2].max())


def bone_deform(name):
    pb = rig.pose.bones[name]
    return rig.matrix_world @ pb.matrix @ pb.bone.matrix_local.inverted() @ rig.matrix_world.inverted()


H = bone_deform("head"); Hi = H.inverted()
Hn = np.array(H); Hin = np.array(Hi)


def to_rest(p):    # posed -> head rest frame (the measured face landmarks live there)
    return p @ Hin[:3, :3].T + Hin[:3, 3]


def from_rest(p):
    return p @ Hn[:3, :3].T + Hn[:3, 3]


wsum = lambda *ns: sum(W[:, gi[n]] for n in ns)
w_head = wsum("head")
w_torso = wsum("pelvis", "spine", "chest")
w_arm = wsum("uarm.L", "uarm.R", "farm.L", "farm.R", "clav.L", "clav.R")
w_hand = wsum("hand.L", "hand.R")
w_leg = wsum("thigh.L", "thigh.R", "shin.L", "shin.R")
w_foot = wsum("foot.L", "foot.R")

# soften: no gym muscles, no six-pack — the Seokguram body is full, smooth and calm (head a little, hands not at all)
R0 = to_rest(co)
fx, fy, fz = R0[:, 0], R0[:, 1], R0[:, 2]
nose = np.exp(-((fx / 0.017) ** 2 + ((fz - 1.546) / 0.028) ** 2)) * smoothstep(-0.10, -0.12, fy)
lips = np.exp(-((fx / 0.028) ** 2 + ((fz - 1.503) / 0.011) ** 2)) * smoothstep(-0.10, -0.12, fy)
ears = smoothstep(0.066, 0.078, np.abs(fx)) * (fy > -0.085)
# (positional blends, not skin weights: a weight edge would leave a step between the two evaluations — a collar, a bracelet)
in_head = smoothstep(1.445, 1.50, fz) * (np.sqrt(fx ** 2 + (fy + 0.01) ** 2) < 0.16)
d_hand = np.zeros(NV)
for s_ in "LR":
    a_ = np.array(rig.matrix_world @ rig.pose.bones[f"hand.{s_}"].head); b_ = np.array(rig.matrix_world @ rig.pose.bones[f"hand.{s_}"].tail)
    ax_ = (b_ - a_) / np.linalg.norm(b_ - a_)
    tp = (co - a_) @ ax_
    rad = np.linalg.norm((co - a_) - np.outer(tp, ax_), axis=1)
    d_hand = np.maximum(d_hand, smoothstep(-0.07, 0.0, tp) * (rad < 0.10) * (tp < 0.25))
detail = np.clip(d_hand + in_head * np.clip(0.15 + 0.85 * nose + 0.6 * lips + 0.9 * ears, 0, 1), 0, 1)
co = co_s + (co - co_s) * detail[:, None]
co = laplace(co, ed, np.clip(w_torso + w_leg + 0.6 * w_arm, 0, 1) * (1 - detail), 40)
# a broad, full chest and shoulders (Seokguram's shoulders ~2.9 face widths): widen the upper torso a little
up = smoothstep(1.05, 1.30, co[:, 2]) * np.clip(w_torso + wsum("clav.L", "clav.R") + 0.6 * w_arm, 0, 1) * (1 - w_head)
co[:, 0] *= 1 + 0.11 * up
# (owner reference: a broad, full, columnar torso under the robe) the whole trunk wider, the waist too
trunk = np.clip(w_torso + 0.5 * wsum("clav.L", "clav.R"), 0, 1) * smoothstep(0.92, 1.0, co[:, 2]) * (1 - w_head) * (1 - np.clip(w_arm * 1.5, 0, 1))
co[:, 0] *= 1 + 0.13 * trunk
co[:, 1] = co[:, 1] + (co[:, 1] - 0.0) * 0.08 * trunk
# the head a touch larger (statue canon), about the top of the neck
piv = np.array(H @ rig.pose.bones["head"].bone.head_local)
Rs = to_rest(co)
w_sc = smoothstep(1.445, 1.50, Rs[:, 2]) * (np.sqrt(Rs[:, 0] ** 2 + (Rs[:, 1] + 0.01) ** 2) < 0.16) * (1 - np.clip(w_hand * 2, 0, 1))
HEAD_K = 0.24     # (owner reference 2026-11-18: a larger head, ~0.28 of the seated figure with the 육계)
FACE_W = 0.10     # the face a fuller, wider oval (pass 2: 0.07 -> 0.10)
co += (w_sc[:, None] * HEAD_K) * (co - piv)
piv_r = to_rest(piv[None, :])[0]


def warp_rest(R_):
    """the head's own growth and the wider face, in the head's rest frame (for the pieces added in that frame)"""
    R_ = piv_r + (R_ - piv_r) * (1 + HEAD_K)
    f = smoothstep(-0.02, -0.07, R_[:, 1]) * smoothstep(1.47, 1.50, R_[:, 2]) * (1 - smoothstep(1.60, 1.64, R_[:, 2]))
    R_[:, 0] *= 1 + FACE_W * f
    return R_


def unwarp_rest(R_):
    """back to the measured landmarks' frame (the carving below is written against the base mesh's own face)"""
    R_ = R_.copy()
    f = smoothstep(-0.02, -0.07, R_[:, 1]) * smoothstep(1.47, 1.50, R_[:, 2]) * (1 - smoothstep(1.60, 1.64, R_[:, 2]))
    R_[:, 0] /= 1 + FACE_W * f
    return piv_r + (R_ - piv_r) / (1 + HEAD_K)

# earlobes: long, as on every Buddha — stretch the ear below its middle downward in the head's rest frame
R = to_rest(co)
ear = (np.abs(R[:, 0]) > 9.0) & (R[:, 1] > -0.075) & (R[:, 1] < 0.005) & (R[:, 2] > 1.50) & (R[:, 2] < 1.60) & (w_head > 0.5)
zc = 1.562
k = np.where(ear & (R[:, 2] < zc), 1.0, 0.0) * smoothstep(0.072, 0.082, np.abs(R[:, 0]))
R[:, 2] = np.where(k > 0, zc - (zc - R[:, 2]) * (1 + 1.5 * k), R[:, 2])
R[:, 0] = np.where(k > 0, R[:, 0] + np.sign(R[:, 0]) * 0.004 * k * smoothstep(zc, zc - 0.03, R[:, 2]), R[:, 0])
co = np.where(ear[:, None], from_rest(R), co)
log("ears", int(ear.sum()))
R = to_rest(co)
fw = w_head * smoothstep(-0.02, -0.07, R[:, 1]) * smoothstep(1.47, 1.50, R[:, 2]) * (1 - smoothstep(1.60, 1.64, R[:, 2]))
R[:, 0] *= 1 + FACE_W * fw
co = np.where((w_head > 0.01)[:, None], from_rest(R), co)
me.vertices.foreach_set("co", co.astype(np.float32).ravel()); me.update()
# pass 2: ample, soft forms — a full chest and broad soft shoulders, rounded arms, a thicker neck (no gym anatomy left)
nrm0 = vnormals(me)
Rn = to_rest(co)
neck_z = smoothstep(1.36, 1.39, Rn[:, 2]) * (1 - smoothstep(1.41, 1.44, Rn[:, 2])) * (np.sqrt(Rn[:, 0] ** 2 + (Rn[:, 1] + 0.01) ** 2) < 0.09)
infl = (0.011 * np.clip(w_torso + wsum("clav.L", "clav.R"), 0, 1) * smoothstep(0.95, 1.15, co[:, 2])
        + 0.006 * np.clip(w_arm, 0, 1) + 0.005 * neck_z) * (1 - np.clip(w_hand * 2, 0, 1)) * (1 - np.clip(w_head - neck_z, 0, 1))
infl = smooth_field(infl, ed, 30)
co = co + nrm0 * infl[:, None]
me.vertices.foreach_set("co", co.astype(np.float32).ravel()); me.update()
log("inflated", float(infl.max()))

# ---------------- robe mask (1 = under the robe) ----------------
x, y, z = co[:, 0], co[:, 1], co[:, 2]
# the robe edge across the chest: from the left of the neck down to under the right arm, sagging a little in the middle
xa, za, xb, zb = 0.075, 1.45, -0.215, 1.10
t_ = np.clip((x - xb) / (xa - xb), 0, 1)
zline = zb + (za - zb) * t_ - 0.045 * np.sin(np.pi * t_)
bare_torso = z > zline
covered = np.clip(w_torso + w_leg + w_foot + wsum("clav.L", "uarm.L", "farm.L"), 0, 1)
covered = np.where(bare_torso & (w_torso + wsum("clav.L") > 0.3), 0.0, covered)
covered = np.where(w_head + wsum("neck") + w_hand + wsum("uarm.R", "farm.R", "clav.R") > 0.5, 0.0, covered)
# the left sleeve ends at the wrist
covered = smooth_field(covered, ed, 6)
cov = covered > 0.5
skin = obj_from("skin", me)


# ---------------- robe shell over the torso and the left arm ----------------
bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
legish = (w_leg + w_foot > 0.5) | (z < 0.93)
keepv = cov & ~legish
bmesh.ops.delete(bm, geom=[f for f in bm.faces if not all(keepv[v.index] for v in f.verts)], context="FACES")
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
rme = bpy.data.meshes.new("robe"); bm.to_mesh(rme); bm.free()
robe = obj_from("robe", rme)
nr = vnormals(rme); rc, red = mesh_arrays(rme)
rc = rc - nr * 0.0025
rme.vertices.foreach_set("co", rc.astype(np.float32).ravel()); rme.update()
sm = robe.modifiers.new("s", "SOLIDIFY"); sm.thickness = 0.0260; sm.offset = 1.0; sm.use_rim = True; sm.use_even_offset = False; sm.use_quality_normals = True
log("robe faces", len(rme.polygons))

# boundary of the robe (its edge line, for the folds that run parallel to it) — on the outer skin of the shell
bm = bmesh.new(); bm.from_mesh(rme); bm.edges.ensure_lookup_table()
edge_pts = []
for e in bm.edges:
    if e.is_boundary:
        for v in e.verts:
            edge_pts.append(Vector(v.co) + v.normal * 0.026)
bm.free()
# only the chest edge drives the chest folds (not the cuff, not the waist cut where the lap takes over)
chest_edge = [p for p in edge_pts if p.z > 1.0 and abs(p.x) < 0.30 and not (p.x > 0.2 and p.z < 1.2)]
cuff = [p for p in edge_pts if p.x > 0.0 and p.z < 1.08 and p.y < -0.1]
log("edge pts", len(edge_pts), "chest", len(chest_edge), "cuff", len(cuff))

# skin under the draped lap: pulled well inside it (no near-tangent skin/lap seams in the voxel union)
dropv = smoothstep(0.3, 0.7, w_leg + w_foot) * smoothstep(1.02, 0.96, z)
nrm_s = vnormals(me)
co_in = co - nrm_s * (0.016 * dropv)[:, None]
# the posed feet (a bad bend in a lotus) fold up into their ankles, deep inside the lap; the CC0 foot below shows the right sole
for s_ in "LR":
    ank = np.array(rig.matrix_world @ rig.pose.bones[f"foot.{s_}"].head)
    wf = np.clip(W[:, gi[f"foot.{s_}"]] * 1.5, 0, 1)
    co_in = co_in + ((ank - co_in) * 0.85) * wf[:, None]
me.vertices.foreach_set("co", co_in.astype(np.float32).ravel()); me.update()
log("skin legs pulled in", int((dropv > 0.5).sum()))

# ---------------- the draped lap: smooth capsules along the crossed legs + a filler under the hands ----------------
mb = bpy.data.metaballs.new("lap"); mb.resolution = 0.006; mb.render_resolution = 0.006; mb.threshold = 0.6
lapo = obj_from("lap_mb", mb)


def capsule(a, b, r):
    a, b = Vector(a), Vector(b)
    el = mb.elements.new(type="CAPSULE"); el.co = (a + b) / 2; el.radius = r; el.size_x = (b - a).length / 2
    el.rotation = Vector((1, 0, 0)).rotation_difference((b - a).normalized()); el.stiffness = 2.0


def ellip(c, s, r=1.0, rot=None):
    el = mb.elements.new(type="ELLIPSOID"); el.co = c; el.radius = r; el.size_x, el.size_y, el.size_z = s; el.stiffness = 2.0
    if rot: el.rotation = rot


pb = rig.pose.bones
P = lambda n, end: rig.matrix_world @ (pb[n].tail if end else pb[n].head)
for s in "LR":
    hip, knee, ank = P(f"thigh.{s}", 0), P(f"thigh.{s}", 1), P(f"shin.{s}", 1)
    capsule(hip + Vector((0, 0.0, -0.01)), knee, 0.135)
    capsule(knee, ank, 0.105)
    capsule(ank, P(f"foot.{s}", 1), 0.075)
ellip((0, -0.17, 0.91), (0.22, 0.14, 0.06), 1.0)
ellip((0, -0.03, 0.93), (0.20, 0.12, 0.08), 1.0)
for s_ in (1, -1):    # the knees: broad and solid under the cloth
    ellip((s_ * 0.33, -0.31, 0.86), (0.10, 0.10, 0.075), 1.0)
dg = bpy.context.evaluated_depsgraph_get()
lme = bpy.data.meshes.new_from_object(lapo.evaluated_get(dg), depsgraph=dg)
bpy.data.objects.remove(lapo); lap = obj_from("lap", lme)
log("lap verts", len(lme.vertices))

# ---------------- lids (half-closed eyes) and the 육계 in the head's rest frame ----------------
def rest_obj(name, prim, loc, scale, rot=(0, 0, 0)):
    if prim == "sphere": bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=1.0)
    o = bpy.context.active_object; o.name = name
    o.data.transform(Matrix.LocRotScale(Vector(loc), Matrix.Rotation(rot[2], 4, "Z").to_quaternion(), Vector(scale)))
    vv = np.empty(len(o.data.vertices) * 3); o.data.vertices.foreach_get("co", vv)
    vv = from_rest(warp_rest(vv.reshape(-1, 3)))
    o.data.vertices.foreach_set("co", vv.astype(np.float32).ravel()); o.data.update()
    o.matrix_world = Matrix()      # (in world coordinates: the BVHs below are built in object space)
    return o


lids = []
for s in (1, -1):
    # the upper lid is a long, gently swelling almond that reaches out toward the temple
    # the long Buddha earlobe: a thick rounded tab hanging from the ear
    lids.append(rest_obj(f"lobe{s}", "sphere", (s * 0.0805, -0.031, 1.522), (0.0065, 0.0125, 0.026), (0, 0, s * math.radians(12))))
for s in (1, -1):    # fill the whole socket (reaching just past the lid line, so no thin gap is left) (an eyeball leaves a thin gap that the voxel union turns into a pit)
    lids.append(rest_obj(f"socket{s}", "sphere", (s * 0.0310, -0.1105, 1.5765), (0.0240, 0.0235, 0.0165), (0, 0, s * math.radians(-6))))
ush = rest_obj("ushnisha", "sphere", (0.0, -0.006, 1.664), (0.058, 0.060, 0.068))     # a tall 육계 dome
# the gold jewels: 계주 on top of the 육계, and a small one at the front of the hairline
jew = [rest_obj("jewel_top", "sphere", (0.0, -0.006, 1.738), (0.0115, 0.0115, 0.0110)),
       rest_obj("jewel_front", "sphere", (0.0, -0.0655, 1.672), (0.0105, 0.0055, 0.0085))]

FOOT = bpy.data.objects.get("Foot - Realistic")
feet = []
if FOOT is not None:
    FOOT.modifiers[0].levels = 1
    fme = bpy.data.meshes.new_from_object(FOOT.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    fme.transform(FOOT.matrix_world)
    fc = np.array([v.co for v in fme.vertices]); cen = Vector((fc[:, 0].mean(), fc[:, 1].mean(), fc[:, 2].min()))
    fme.transform(Matrix.Translation(-cen))
    Tt = Vector((1, -0.22, -0.04)).normalized(); Sn = Vector((0, -0.40, 0.92)); Sn = (Sn - Tt * Sn.dot(Tt)).normalized()
    Bx = Tt.cross(Sn)    # local x = (-y_local) x (-z_local) image
    Mf = Matrix((( Bx.x, -Tt.x, -Sn.x), (Bx.y, -Tt.y, -Sn.y), (Bx.z, -Tt.z, -Sn.z))).to_4x4()
    Mf.translation = Vector((0.205, -0.205, 1.008))
    fme.transform(Mf)
    feet.append(obj_from("foot_r", fme))
    FOOT.hide_render = True; FOOT.hide_set(True); FOOT.hide_viewport = True

# ---------------- one voxel union ----------------
for o in sc.objects: o.select_set(False)
parts = [skin, robe, lap] + lids + [ush] + jew + feet
for o in parts:
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    for m in list(o.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)
bpy.context.view_layer.objects.active = skin
src = {}
for o in parts:   # BVHs of every source piece, before the join (to label the union surface)
    src[o.name] = BVHTree.FromObject(o, bpy.context.evaluated_depsgraph_get())
skin_bvh = src["skin"]
skin_me_copy = skin.data.copy()
for o in sc.objects: o.select_set(o in parts)
bpy.context.view_layer.objects.active = skin
bpy.ops.object.join()
U = bpy.context.active_object; U.name = "statue_hi"
rm = U.modifiers.new("vox", "REMESH"); rm.mode = "VOXEL"; rm.voxel_size = VOX; rm.adaptivity = 0.0; rm.use_smooth_shade = True
bpy.ops.object.modifier_apply(modifier="vox")
cs = U.modifiers.new("cs", "CORRECTIVE_SMOOTH"); cs.iterations = 3; cs.smooth_type = "SIMPLE"; cs.use_only_smooth = True
bpy.ops.object.modifier_apply(modifier="cs")
um = U.data
uco, ued = mesh_arrays(um); un = vnormals(um)
log("union verts", len(uco))

# ---------------- label the union surface by its nearest source ----------------
NU = len(uco)
dist = {k: np.full(NU, 9.0) for k in src}
for i in range(NU):
    p = Vector(uco[i])
    for k, b in src.items():
        h = b.find_nearest(p, 0.03)
        if h[0] is not None: dist[k][i] = h[3]
log("labelled")
# skin-part weights at the union vertices: from the nearest skin vertex
kd = kdtree.KDTree(NV)
for i, p in enumerate(co): kd.insert(p, i)
kd.balance()
near = np.array([kd.find(Vector(p))[1] for p in uco])
UW = W[near]
uw = lambda *ns: sum(UW[:, gi[n]] for n in ns)
is_robe = (dist["robe"] < dist["skin"] - 0.0005)
is_lap = (dist["lap"] < np.minimum(dist["skin"], dist["robe"]) + 0.001) & (uco[:, 2] < 1.06)
log("robe", int(is_robe.sum()), "lap", int(is_lap.sum()))
# the face, on the uniform union mesh: a plain (shrinking) Laplacian melts the brow ridge, the frown and the deep sockets into one
# calm, full mask; the nose, lips and ears are held back
R1 = unwarp_rest(to_rest(uco))
gx, gy, gz = R1[:, 0], R1[:, 1], R1[:, 2]
g_nose = np.exp(-((gx / 0.019) ** 4 + ((gz - 1.548) / 0.032) ** 4)) * smoothstep(-0.10, -0.125, gy)
g_lips = np.exp(-((gx / 0.030) ** 4 + ((gz - 1.503) / 0.013) ** 4)) * smoothstep(-0.10, -0.125, gy)
g_ears = smoothstep(0.068, 0.080, np.abs(gx)) * (gy > -0.085)
g_head = np.sqrt(gx ** 2 + (gy + 0.01) ** 2 + (gz - 1.57) ** 2) < 0.15
fsU = g_head * (uw("head") > 0.3) * np.clip(1 - 0.0 * g_nose - 0.0 * g_lips - 0.95 * g_ears, 0, 1) * smoothstep(-0.02, -0.07, gy) * smoothstep(1.435, 1.46, gz) * (1 - smoothstep(1.63, 1.66, gz))
fsU = smooth_field(fsU, ued, 6)
_c0 = uco.copy()
# (on the face's own vertices only: a few hundred passes are cheap there)
sel = np.where(fsU > 0.002)[0]
remap = -np.ones(len(uco), np.int64); remap[sel] = np.arange(len(sel))
e_in = ued[(remap[ued[:, 0]] >= 0) & (remap[ued[:, 1]] >= 0)]
sub = laplace(uco[sel], remap[e_in], fsU[sel], 650, lam=0.5, mu=0.5)
uco[sel] = sub
# a light general clean-up of voxel steps (not the hands, not the face features)
uco = laplace(uco, ued, 0.6 * (1 - np.clip(uw("hand.L", "hand.R") * 2, 0, 1)) * (1 - fsU), 4)
# the half-closed eyes: inside the long almond the face takes a much smoother copy of itself (no socket, no lid rims, no
# eyeball), swelling a little — the broad, calm upper lid of Seokguram; the slit is carved below
ref = laplace(uco[sel], remap[e_in], smoothstep(0.05, 0.4, fsU[sel]), 1400, lam=0.5, mu=0.5)   # (the patch rim stays put)
nref = np.zeros_like(ref)
Rsel = R1[sel]
for s_ in (1, -1):
    ex_ = s_ * Rsel[:, 0]
    e2_ = ((ex_ - 0.0335) / 0.0255) ** 2 + ((Rsel[:, 2] - 1.5775) / 0.0165) ** 2
    we = smoothstep(1.6, 0.6, e2_)
    tgt = ref
    dd = np.linalg.norm(tgt - uco[sel], axis=1)
    log("eye fill", s_, int((we > 0.5).sum()), "mean", float(dd[we > 0.5].mean()), "max", float(dd[we > 0.5].max()), "ref y", float(to_rest(ref[we > 0.5])[:, 1].mean()), "cur y", float(to_rest(uco[sel][we > 0.5])[:, 1].mean()))
    uco[sel] = uco[sel] * (1 - we[:, None]) + tgt * we[:, None]
log("face smooth", int((fsU > 0.5).sum()), "mean move", float(np.linalg.norm(uco - _c0, axis=1)[fsU > 0.5].mean()))
um.vertices.foreach_set("co", uco.astype(np.float32).ravel()); um.update(); un = vnormals(um)
disp = np.zeros(NU)


def ridge(t):
    """stepped Seokguram fold: a crisp rise, a long soft fall (period 1)"""
    u = t - np.floor(t)
    return smoothstep(0.0, 0.18, u) * (1 - smoothstep(0.30, 1.0, u))


# chest / left arm folds: parallel to the robe edge (the cloth hangs from the left shoulder)
def dist_to(pts, q):
    k = kdtree.KDTree(len(pts))
    for i, p in enumerate(pts): k.insert(p, i)
    k.balance()
    return np.array([k.find(Vector(p))[2] for p in q])


rob_i = np.where(is_robe & ~is_lap)[0]
de = dist_to(chest_edge, uco[rob_i])
back_ = smoothstep(-0.02, 0.04, uco[rob_i, 1])
reach = 0.15 + 0.17 * back_
amp = 0.0024 * smoothstep(0.006, 0.02, de) * (1 - smoothstep(reach - 0.05, reach, de)) * smoothstep(1.02, 1.12, uco[rob_i, 2])
disp[rob_i] += amp * (ridge(de / 0.024) - 0.35)
# across the belly (the reference's front): near-horizontal folds, rising a little toward the left side
zb = uco[rob_i, 2] - 0.05 * np.clip(uco[rob_i, 0] + 0.05, 0, None)
belly = (1 - back_) * smoothstep(0.96, 1.02, uco[rob_i, 2]) * (1 - smoothstep(1.22, 1.28, zb)) * smoothstep(0.012, 0.03, de) * (1 - smoothstep(0.11, 0.16, de) * 0)
disp[rob_i] += 0.0026 * belly * (ridge(zb / 0.021) - 0.35) * smoothstep(0.10, 0.15, de)
# the folded-back edge itself: a rolled band right at the edge
disp[rob_i] += 0.0024 * np.exp(-((de - 0.0075) / 0.0045) ** 2)    # the hem: a rolled, clearly raised band along the robe edge
disp[rob_i] -= 0.0010 * np.exp(-((de - 0.0155) / 0.0025) ** 2)    # and the small fold line just inside it
if cuff:
    dc = dist_to(cuff, uco[rob_i])
    disp[rob_i] += 0.0011 * (ridge(dc / 0.022) - 0.35) * (1 - smoothstep(0.035, 0.06, dc)) * smoothstep(0.004, 0.012, dc)

# lap folds: run along the shins, curving into the middle (angle around each shin axis, twisted along it)
lap_i = np.where(is_lap)[0]
best = np.full(len(lap_i), 9.0); phase = np.zeros(len(lap_i)); fade = np.zeros(len(lap_i))
for s, bn_ in [(s_, b_) for s_ in "LR" for b_ in ("shin", "thigh")]:
    a = np.array(P(f"{bn_}.{s}", 0)); b = np.array(P(f"{bn_}.{s}", 1))
    ax = (b - a) / np.linalg.norm(b - a); L = np.linalg.norm(b - a)
    q = uco[lap_i] - a; tpar = q @ ax; perp = q - np.outer(tpar, ax); dperp = np.linalg.norm(perp, axis=1)
    ref = np.cross(ax, [0, 0, 1.0]); ref /= np.linalg.norm(ref); ref2 = np.cross(ax, ref)
    ang = np.arctan2(perp @ ref2, perp @ ref)
    better = dperp < best
    best = np.where(better, dperp, best)
    phase = np.where(better, ang / (2 * np.pi) * 7 + tpar / L * 1.1, phase)
    fade = np.where(better, smoothstep(-0.05, 0.12, tpar) * (1 - smoothstep(L * 0.85, L * 1.1, tpar)), fade)
top = smoothstep(0.86, 0.95, uco[lap_i, 2])
disp[lap_i] += 0.0050 * fade * top * (ridge(phase) - 0.35)

# ---- the head: neck rings, brows, eye slits, 백호, smile (head rest frame)
Rr = unwarp_rest(to_rest(uco))
xh, yh, zh = Rr[:, 0], Rr[:, 1], Rr[:, 2]
headish = (uw("head", "neck") > 0.4) & ~is_robe
# 삼도: three creases round the neck, dipping toward the front
neck = (zh > 1.38) & (zh < 1.49) & (uw("neck", "head", "chest") > 0.3) & ~is_robe
phi = np.arctan2(xh, -(yh + 0.0))
for k_, z0 in enumerate((1.456, 1.441, 1.426)):
    zz = z0 - 0.006 * np.cos(phi) ** 2 * (np.cos(phi) > 0)
    g = np.exp(-((zh - zz) / 0.0011) ** 2) * smoothstep(-0.4, 0.2, np.cos(phi))
    roll_ = np.exp(-((zh - zz - 0.0025) / 0.0022) ** 2) * smoothstep(-0.4, 0.2, np.cos(phi))
    disp += neck * (-0.0006 * g + 0.0003 * roll_) * (0 if os.environ.get("BV2_NONECK") else 1)
face = headish & (yh < -0.07)
for s in (1, -1):
    ex = s * xh
    # the brow: one crisp, high arch from the nose bridge out toward the temple (a fine raised edge, not a shelf)
    u = (ex - 0.034) / 0.031
    arc = 1.5925 + 0.0105 * (1 - u ** 2)
    m = face & (np.abs(u) < 1.0)
    edge = np.exp(-((zh - arc) / 0.0016) ** 2) * (1 - smoothstep(0.75, 1.0, np.abs(u)))
    disp += m * (0.0009 * edge + 0.0005 * smoothstep(-0.002, 0.003, zh - arc) * np.exp(-((zh - arc) / 0.012) ** 2))
    # the half-closed eye: a broad, softly swelling upper lid and one fine downcast slit along its lower edge
    v = (ex - 0.0335) / 0.0185
    disp += face * 0.0010 * np.exp(-(((ex - 0.0335) / 0.017) ** 2 + ((zh - 1.5755) / 0.0085) ** 2))
    zs = 1.5700 + 0.0016 * (1 - v ** 2) - 0.0010 * v * (v > 0)
    taper = np.clip(1 - v ** 2, 0, 1) ** 0.6
    disp -= face * 0.0011 * taper * np.exp(-((zh - zs) / 0.0007) ** 2)
    disp += face * 0.00035 * taper * np.exp(-((zh - zs - 0.0013) / 0.0009) ** 2)     # the lid's lower rim catches the light
    # full, soft cheeks and a round jaw (the gentle oval)
    disp += face * 0.0030 * np.exp(-(((ex - 0.036) / 0.016) ** 2 + ((zh - 1.522) / 0.018) ** 2))
    disp += face * 0.0004 * np.exp(-(((ex - 0.045) / 0.012) ** 2 + ((zh - 1.505) / 0.012) ** 2))
    # the nose's soft wings (no flare)
    disp += face * 0.0008 * np.exp(-(((ex - 0.0080) / 0.0035) ** 2 + ((zh - 1.5390) / 0.0030) ** 2))   # the nose's small wings
# the idealised nose: one straight ridge from the brows to a soft, rounded tip
tn = np.clip((1.592 - zh) / (1.592 - 1.539), 0, 1)
wn = 0.0042 + 0.0050 * tn
disp += face * 0.0105 * tn ** 1.15 * np.exp(-np.abs(xh / wn) ** 3) * smoothstep(1.5335, 1.5410, zh)
disp += face * 0.0004 * np.exp(-((xh / 0.0045) ** 2 + ((zh - 1.5425) / 0.0030) ** 2))   # a small, refined tip
# a small, full mouth with a faint smile: the parting line rises at its corners, a bowed upper lip, a full lower lip
axm = np.abs(xh)
zm = 1.5040 + 0.0016 * (axm / 0.0175) ** 2
inm = (axm < 0.0185)
disp -= face * inm * 0.0012 * np.exp(-((zh - zm) / 0.0007) ** 2) * (1 - smoothstep(0.014, 0.0185, axm))
disp += face * 0.0012 * np.exp(-((xh / 0.0145) ** 2 + ((zh - 1.5072) / 0.0024) ** 2)) * (1 - 0.35 * np.exp(-(xh / 0.003) ** 2))
disp += face * 0.0016 * np.exp(-((xh / 0.0130) ** 2 + ((zh - 1.5008) / 0.0028) ** 2))
disp -= face * 0.0006 * np.exp(-((xh / 0.012) ** 2 + ((zh - 1.4945) / 0.0018) ** 2))       # the soft hollow under the lower lip
disp += face * 0.0009 * np.exp(-((xh / 0.015) ** 2 + ((zh - 1.486) / 0.008) ** 2))        # a soft, rounded chin
for s in (1, -1):
    dmc = np.sqrt((s * xh - 0.0195) ** 2 + (zh - 1.5068) ** 2)
    disp -= face * 0.0006 * np.exp(-(dmc / 0.0022) ** 2)                                    # the smile's tucked corners
# 백호: a small round boss between the brows
dur = np.sqrt(xh ** 2 + (zh - 1.6000) ** 2)
disp += face * 0.0022 * np.sqrt(np.clip(1 - (dur / 0.0036) ** 2, 0, 1))
uco = uco + un * disp[:, None]
um.vertices.foreach_set("co", uco.astype(np.float32).ravel()); um.update()
log("carved")

# ---------------- hair region: the scalp above the hairline + the 육계 ----------------
phi_h = np.arctan2(xh, -(yh + 0.015))     # 0 at the front
ad = np.abs(phi_h)
hairline = np.where(ad < 1.2, 1.629 - 0.024 * smoothstep(0.35, 1.2, ad), 1.605 - 0.07 * smoothstep(1.2, 2.6, ad))
near_head = np.sqrt(xh ** 2 + (yh + 0.01) ** 2 + (zh - 1.60) ** 2) < 0.15
hair = (headish & near_head & (zh > hairline)) | (dist["ushnisha"] < 0.0012)
log("hair verts", int(hair.sum()))
# the cap stands a little proud of the brow along one even line (a clean edge for the curls to sit behind)
capd = (headish & near_head) * smoothstep(hairline - 0.0004, hairline + 0.0016, zh) * 0.0011
uco = uco + un * capd[:, None]
um.vertices.foreach_set("co", uco.astype(np.float32).ravel()); um.update()

# materials: gilt + hair (lapis-black)
def mat(name, col, metal, rough):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = col + (1,); b.inputs["Metallic"].default_value = metal; b.inputs["Roughness"].default_value = rough
    return m


gilt = mat("M_gilt", (0.80, 0.52, 0.16), 0.9, 0.30)
hairm = mat("M_hair", (0.004, 0.004, 0.005), 0.0, 0.85)       # matte black curls (owner reference)
greenm = mat("M_paint_green", (0.06, 0.30, 0.14), 0.0, 0.55)    # painted brows, moustache line
redm = mat("M_paint_red", (0.55, 0.035, 0.03), 0.0, 0.45)       # painted lips
um.materials.clear()
for m_ in (gilt, hairm, greenm, redm): um.materials.append(m_)
pv = np.empty(len(um.polygons) * 4, np.int64)
# polygons are quads from the voxel remesher
lt = np.empty(len(um.loops), np.int64); um.loops.foreach_get("vertex_index", lt)
ls = np.empty(len(um.polygons), np.int64); um.polygons.foreach_get("loop_start", ls)
mi = hair[lt[ls]].astype(np.int64)
# the jewels are gold, not hair
for jn in ("jewel_top", "jewel_front"):
    mi[(dist[jn] < np.minimum(dist["ushnisha"], dist["skin"]) + 0.0003)[lt[ls]]] = 0
# painted features (the reference: green brows and moustache line, red lips) on the face's own polygons
pc_ = np.empty(len(um.polygons) * 3); um.polygons.foreach_get("center", pc_); pc_ = pc_.reshape(-1, 3)
Rp = unwarp_rest(to_rest(pc_)); px_, py_, pz_ = Rp[:, 0], Rp[:, 1], Rp[:, 2]
fp = (py_ < -0.08) & (np.sqrt(px_ ** 2 + (pz_ - 1.55) ** 2) < 0.09) & (mi == 0)
ex_ = np.abs(px_); u_ = (ex_ - 0.034) / 0.031
brow = fp & (np.abs(u_) < 0.92) & (np.abs(pz_ - (1.5925 + 0.0105 * (1 - u_ ** 2)) - 0.0010) < 0.00105 * (1 - 0.5 * np.abs(u_)))
zmu = 1.5135 - 0.0042 * np.clip((ex_ - 0.003) / 0.015, 0, 1)
must = fp & (ex_ > 0.0035) & (ex_ < 0.0185) & (np.abs(pz_ - zmu) < 0.00075)
tuft = fp & (((px_ / 0.0035) ** 2 + ((pz_ - 1.4935) / 0.0022) ** 2) < 1)
lips = fp & (((px_ / 0.0150) ** 2 + ((pz_ - 1.5040) / 0.0043) ** 2) < 1)
mi[brow | must | tuft] = 2; mi[lips] = 3
log("paint polys", int(brow.sum()), int(must.sum()), int(tuft.sum()), int(lips.sum()))
um.polygons.foreach_set("material_index", mi)
np.save(OUT.replace(".blend", "_hair.npy"), hair)

# ---------------- 나발: snail-shell curls over the hair (separate high-poly pieces, baked onto the cap) ----------------
hv = np.where(hair)[0]
order = np.argsort(-uco[hv, 2])
pick = []
kd2 = kdtree.KDTree(len(hv) + 1)
chosen = kdtree.KDTree(4000); nchosen = 0
SP = 0.0118
pts_c = []
grid = {}
hl_ok = ((zh > hairline + 0.004) | (dist["ushnisha"] < 0.0012)) & (dist["jewel_top"] > 0.0095) & (dist["jewel_front"] > 0.0075)
# neat rows (the reference): rows that follow the hairline over the skull, then rows of latitude round the 육계
def try_add(idx, min_d):
    if dist["jewel_top"][idx] < 0.0095 or dist["jewel_front"][idx] < 0.0075: return False
    p = uco[idx]; key = tuple((p // SP).astype(int))
    for dx_ in (-1, 0, 1):
        for dy_ in (-1, 0, 1):
            for dz_ in (-1, 0, 1):
                for q in grid.get((key[0] + dx_, key[1] + dy_, key[2] + dz_), ()):
                    if np.sum((uco[q] - p) ** 2) < min_d * min_d: return False
    grid.setdefault(key, []).append(idx); pts_c.append(idx); return True


on_ush = dist["ushnisha"] < 0.0015
skull = hair & ~on_ush & near_head
vrow = zh - hairline
for r_ in range(14):
    vt = 0.0060 + r_ * SP * 0.88
    band = np.where(skull & (np.abs(vrow - vt) < 0.0016))[0]
    if len(band) == 0: break
    band = band[np.argsort(phi_h[band])]
    last = None
    for idx in band:
        if last is not None and np.sum((uco[idx] - uco[last]) ** 2) < SP * SP: continue
        if try_add(idx, SP * 0.86): last = idx
Ru = unwarp_rest(to_rest(uco))
lat = np.arctan2(Ru[:, 2] - 1.664, np.sqrt(Ru[:, 0] ** 2 + (Ru[:, 1] + 0.006) ** 2))
lon = np.arctan2(Ru[:, 0], -(Ru[:, 1] + 0.006))
ushv = np.where(on_ush & hair)[0]
for r_ in range(8):
    lt_ = -0.15 + r_ * 0.19
    band = ushv[np.abs(lat[ushv] - lt_) < 0.035]
    if len(band) == 0: continue
    band = band[np.argsort(lon[band])]; last = None
    for idx in band:
        if last is not None and np.sum((uco[idx] - uco[last]) ** 2) < SP * SP: continue
        if try_add(idx, SP * 0.86): last = idx
log("rows", len(pts_c))
for idx in hv[order]:
    if not hl_ok[idx]: continue
    p = uco[idx]
    key = tuple((p // SP).astype(int))
    ok = True
    for dx_ in (-1, 0, 1):
        for dy_ in (-1, 0, 1):
            for dz_ in (-1, 0, 1):
                for q in grid.get((key[0] + dx_, key[1] + dy_, key[2] + dz_), ()):
                    if np.sum((uco[q] - p) ** 2) < (SP * 0.95) ** 2: ok = False; break
                if not ok: break
            if not ok: break
        if not ok: break
    if ok:
        grid.setdefault(key, []).append(idx); pts_c.append(idx)
log("curls", len(pts_c))
# one curl: a domed bead with a spiral groove (a snail shell seen from above)
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=10, radius=1.0)
for v in bm.verts:
    c = v.co
    if c.z < -0.2:
        c.z = -0.2
    r = math.hypot(c.x, c.y); th = math.atan2(c.y, c.x)
    c.x *= 0.0064; c.y *= 0.0064; c.z = c.z * 0.0056 + 0.0008
cme = bpy.data.meshes.new("curl"); bm.to_mesh(cme); bm.free(); cme.materials.append(hairm)
cb = bmesh.new()
cv = [Vector(v.co) for v in cme.vertices]; cf = [tuple(p.vertices) for p in cme.polygons]
allv = []; allf = []
rng = np.random.default_rng(3)
for idx in pts_c:
    p = Vector(uco[idx]); n = Vector(un[idx]).normalized()
    q = n.to_track_quat("Z", "Y") @ Matrix.Rotation(rng.uniform(0, 6.28), 3, "Z").to_quaternion()
    Mx = Matrix.LocRotScale(p - n * 0.0006, q, Vector((1, 1, 1)) * rng.uniform(0.92, 1.06))
    base = len(allv)
    allv += [Mx @ c for c in cv]; allf += [tuple(base + i for i in f) for f in cf]
cm = bpy.data.meshes.new("curls"); cm.from_pydata(allv, [], allf); cm.update(); cm.materials.append(hairm)
curls = obj_from("curls", cm)
for p in curls.data.polygons: p.use_smooth = True
U.data.polygons.foreach_set("use_smooth", [True] * len(U.data.polygons))

# keep the rig/base for reference but hide them
for o in (rig, body) + tuple(bpy.data.objects[n] for n in ("GEO-body_male_realistic.eye.L", "GEO-body_male_realistic.eye.R")):
    o.hide_render = True; o.hide_set(True)
bpy.ops.wm.save_as_mainfile(filepath=OUT)
log("saved", OUT)
