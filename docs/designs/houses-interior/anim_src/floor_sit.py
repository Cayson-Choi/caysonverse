# floor_sit.py — 바닥 앉기(양반다리) 동작 3개를 만든다: Sit_Floor_Down / Sit_Floor_Idle / Sit_Floor_StandUp.
#
#   "C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" -b art/character/cayson-toy.blend \
#       --python docs/designs/houses-interior/anim_src/floor_sit.py -- --export art/character/export/character.glb [--save] [--sheet <dir>]
#
# 규칙(기억 노트 character-glb-export, 2026-11-09 사고):
#  - 내보내기 전·블렌드 저장 전에 반드시 pose_position='POSE', 활성 동작 없음, 모든 포즈 뼈를 기본값으로(reset_pose).
#  - 내보내는 동작은 character.glb에 원래 있던 13개 + 새 3개뿐(낚시 동작 등 블렌드의 다른 동작은 NLA 줄에 올리지 않는다).
#  - 클립 키는 fcurve에 직접 쓴다(키를 넣는 중에 depsgraph가 포즈를 덮어쓰지 않게).
#  - 몸에 무게가 없는 IK·컨트롤 뼈 18개(kneeIK, handIK, control-*, IK-*, heelIK, elbowIK)의 동작 채널은 내보낸 GLB에서 뺀다
#    (런타임이 쓰지 않는 죽은 데이터. Blender 내보내기는 클립마다 뼈 44개 x 3채널을 다 써서 클립당 JSON 만 ~12 KB다.
#    예산 4,718,592 B 안에 새 동작 3개를 넣으려면 필요). 블렌드와 몸 메시·스킨·그림은 바이트 그대로다.
#
# 좌표(뼈대 공간): +X = 캐릭터 왼쪽, -Y = 앞, +Z = 위. 모델은 -Y를 본다(glTF에서 +Z).
# 자세: 방석 위 양반다리. 엉덩이 맨 아래가 root 바닥(0)에 오고(그래서 방석 높이 seatY만큼 올리면 된다), 손은 무릎 위.

import bpy, math, os, sys, json, struct
from mathutils import Vector, Quaternion, Matrix

FPS = 24
LIB_TEXTS = ['toykit', 'toykit2', 'parts2', 'poke_test', 'stage2b']
NEW_CLIPS = ['Sit_Floor_Down', 'Sit_Floor_Idle', 'Sit_Floor_StandUp']
# 몸에 무게가 없어 런타임이 안 쓰는 뼈(동작 데이터를 내보내지 않는다)
DEAD_BONES = ['kneeIK.l', 'kneeIK.r', 'heelIK.l', 'heelIK.r', 'IK-foot.l', 'IK-foot.r', 'IK-toe.l', 'IK-toe.r',
              'control-toe-roll.l', 'control-toe-roll.r', 'control-heel-roll.l', 'control-heel-roll.r',
              'control-foot-roll.l', 'control-foot-roll.r', 'elbowIK.l', 'elbowIK.r', 'handIK.l', 'handIK.r']
KEY_BONES = ['root', 'hips', 'spine', 'chest', 'head', 'skirt_lap',
             'upperarm.l', 'lowerarm.l', 'wrist.l', 'hand.l', 'handslot.l',
             'upperarm.r', 'lowerarm.r', 'wrist.r', 'hand.r', 'handslot.r',
             'upperleg.l', 'knee_mid.l', 'lowerleg.l', 'foot.l', 'toes.l',
             'upperleg.r', 'knee_mid.r', 'lowerleg.r', 'foot.r', 'toes.r']


def rig():
    return bpy.data.objects['Rig']


def ensure_face_textures():
    """얼굴 그림(face_*.png)은 블렌드 밖 파일이다. 원래 경로(다른 PC)가 없으면 <블렌드 폴더>/textures/ 에서 찾는다.
    없으면 얼굴 없는 GLB가 나가므로 멈춘다(character.glb 안의 PNG를 art/character/textures/ 로 꺼내 두면 된다)."""
    base = os.path.join(os.path.dirname(bpy.data.filepath), 'textures')
    for im in bpy.data.images:
        if im.source != 'FILE' or not im.name.startswith('face_'):
            continue
        if im.size[0] > 0 and os.path.exists(bpy.path.abspath(im.filepath)):
            continue
        alt = os.path.join(base, im.name if im.name.endswith('.png') else im.name + '.png')
        if not os.path.exists(alt):
            raise RuntimeError('face texture missing: ' + im.name + ' (looked in ' + base + ')')
        im.filepath = alt
        im.reload()


def reset_pose(r=None):
    """CRITICAL: 포즈 위치 POSE, 활성 동작 없음, 모든 포즈 뼈 기본값(rest)."""
    r = r or rig()
    r.data.pose_position = 'POSE'
    ad = r.animation_data
    if ad:
        ad.action = None
    for pb in r.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()


def upd():
    bpy.context.view_layer.update()


def rest_q(name):
    return rig().data.bones[name].matrix_local.to_quaternion()


def posed_q(name):
    return rig().pose.bones[name].matrix.to_quaternion()


def delta(name):
    return posed_q(name) @ rest_q(name).inverted()


def parent_delta(name):
    p = rig().data.bones[name].parent
    return delta(p.name) if p else Quaternion()


def set_delta(name, D):
    """뼈의 뼈대 공간 회전 변화량을 D로 만든다(부모 포즈는 이미 정해져 있어야 한다)."""
    pb = rig().pose.bones[name]
    R = rest_q(name)
    pb.rotation_quaternion = R.inverted() @ parent_delta(name).inverted() @ D @ R


def qaxis(spec):
    q = Quaternion()
    for axis, deg in spec:
        q = q @ Quaternion(Vector(axis), math.radians(deg))
    return q


def frame_rot(a_loc, a_w, b_loc, b_w):
    """a_loc→a_w, b_loc→b_w(a와 수직 성분만)로 보내는 회전."""
    e1 = a_loc.normalized(); e2 = (b_loc - e1 * b_loc.dot(e1)).normalized(); e3 = e1.cross(e2)
    f1 = a_w.normalized(); f2 = (b_w - f1 * b_w.dot(f1))
    if f2.length < 1e-6:
        f2 = Vector((0, 0, 1)) - f1 * f1.z
    f2.normalize(); f3 = f1.cross(f2)
    E = Matrix((e1, e2, e3)).transposed(); F = Matrix((f1, f2, f3)).transposed()
    return (F @ E.transposed()).to_quaternion()


def bone_dir(name):
    b = rig().data.bones[name]
    return (b.tail_local - b.head_local).normalized()


FRONT = Vector((0, -1, 0))
UP = Vector((0, 0, 1))


def aim_bone(name, direction, front):
    """뼈의 길이 방향을 direction으로, 뼈의 앞(-Y)을 front 쪽으로."""
    set_delta(name, frame_rot(bone_dir(name), Vector(direction), FRONT, Vector(front)))
    upd()


# ------------------------------------------------------------------ 팔 두 마디 풀이(손목 위치 + 폴 벡터)
def solve_arm(side, W, pole, finger, back):
    r = rig(); s = side
    up, lo, wr, ha, sl = ('upperarm.' + s, 'lowerarm.' + s, 'wrist.' + s, 'hand.' + s, 'handslot.' + s)
    S = r.pose.bones[up].head.copy()
    L1 = (r.data.bones[lo].head_local - r.data.bones[up].head_local).length
    L2 = (r.data.bones[wr].head_local - r.data.bones[lo].head_local).length
    d = Vector(W) - S
    dl = min(max(d.length, abs(L1 - L2) + 1e-3), (L1 + L2) * 0.995)
    n = d.normalized()
    a_ = (L1 * L1 - L2 * L2 + dl * dl) / (2 * dl)
    h = math.sqrt(max(L1 * L1 - a_ * a_, 0.0))
    p = (Vector(pole) - n * Vector(pole).dot(n)).normalized()
    E = S + n * a_ + p * h
    Wc = S + n * dl
    for bone, t in ((up, E - S), (lo, Wc - E)):
        Dp = parent_delta(bone)
        rest_dir = r.data.bones[bone].matrix_local.to_3x3() @ Vector((0, 1, 0))
        q = rest_dir.rotation_difference(Dp.inverted() @ t.normalized())
        set_delta(bone, Dp @ q)
        upd()
    set_delta(wr, delta(lo)); upd()
    set_delta(ha, delta(wr)); upd()
    # 손: 손가락 방향(slot 로컬 FING)과 손등 방향을 맞춘다
    FING = Vector((1, 0, 0)) if s == 'r' else Vector((-1, 0, 0))
    BACK = Vector((0, 0, 1))
    T = frame_rot(FING, Vector(finger), BACK, Vector(back))
    c = T @ posed_q(sl).inverted()
    half = Quaternion().slerp(c, 0.5)
    set_delta(wr, half @ delta(wr)); upd()
    c2 = T @ posed_q(sl).inverted()
    set_delta(ha, c2 @ delta(ha)); upd()


# ------------------------------------------------------------------ 자세
class Pose:
    """한 자세의 매개변수. 모두 뼈대 공간(도·미터)."""
    def __init__(self, **kw):
        self.hip_drop = 0.329       # 엉덩이 관절을 낮추는 높이
        self.hip_back = 0.06        # 엉덩이를 뒤로 미는 거리
        self.hip_pitch = 0.0        # 골반 숙임(+ = 앞으로)
        self.spine_pitch = 3.0
        self.chest_pitch = 2.0
        self.head_pitch = -2.0
        self.head_yaw = 0.0
        self.breathe = 0.0          # 가슴 들썩임(도)
        # 왼다리(안쪽 · 아래쪽)와 오른다리(바깥쪽 · 위쪽): 허벅지 벌림 yaw(밖으로 +), 내림 pitch(아래로 +)
        self.thigh_l = (36.0, 6.0)
        self.thigh_r = (36.0, -2.0)
        self.shin_l = (-0.70, -0.70, -0.03)   # 방향 벡터(정규화는 알아서)
        self.shin_r = (0.70, -0.70, 0.06)
        self.foot_l = (-14.0, 0.0)            # 발: 발끝 방향 yaw(안쪽 -)·pitch(발끝 내림 +). 발목 → 발바닥은 통째로 돈다
        self.foot_r = (14.0, -2.0)
        self.hand_off = (-0.034, 0.003, 0.143)  # 손목 = 무릎 + 이 값(왼쪽 기준, 오른쪽은 x 부호 반대)
        self.plant = False          # True: 더 낮은 발목이 서 있을 때 발목 높이(0.145)에 오도록 엉덩이 높이를 자동으로 정한다
        self.hand_blend = 1.0       # 0 = 서 있을 때처럼 몸 옆(가슴 기준 상대 위치), 1 = 무릎 위
        for k, v in kw.items():
            setattr(self, k, v)


ANKLE_Z = 0.145


def _min_body_z(outfit=('bottom__pants', 'shoes__sneakers')):
    dg = bpy.context.evaluated_depsgraph_get()
    low = 9.0
    for nme in outfit:
        o = bpy.data.objects[nme]
        o.hide_viewport = False
        oe = o.evaluated_get(dg); me = oe.to_mesh()
        W = oe.matrix_world
        low = min(low, min((W @ v.co).z for v in me.vertices))
        oe.to_mesh_clear()
    return low


def apply(P):
    """포즈를 만들고 capture()를 돌려준다."""
    if getattr(P, 'floor', False):
        # 몸(바지·신발)의 가장 낮은 점이 바닥(0)에 오도록 엉덩이 높이를 정한다
        P = Pose(**P.__dict__); P.floor = False; P.plant = False
        for _ in range(5):
            _apply(P)
            P.hip_drop += _min_body_z()
    if P.plant:
        P2 = Pose(**P.__dict__); P2.plant = False; P2.hip_drop = 0.0
        _apply(P2)
        r = rig()
        z = min(r.pose.bones['foot.l'].head.z, r.pose.bones['foot.r'].head.z)
        P = Pose(**P.__dict__); P.plant = False; P.hip_drop = z - ANKLE_Z
    return _apply(P)


def _apply(P):
    r = rig()
    reset_pose(r)
    pb = r.pose.bones['hips']
    pb.location = rest_q('hips').inverted() @ Vector((0, P.hip_back, -P.hip_drop))
    set_delta('hips', qaxis([((1, 0, 0), P.hip_pitch)])); upd()
    set_delta('spine', qaxis([((1, 0, 0), P.hip_pitch + P.spine_pitch)])); upd()
    set_delta('chest', qaxis([((1, 0, 0), P.hip_pitch + P.spine_pitch + P.chest_pitch + P.breathe)])); upd()
    set_delta('head', qaxis([((1, 0, 0), P.hip_pitch + P.spine_pitch + P.chest_pitch + P.head_pitch), ((0, 0, 1), P.head_yaw)])); upd()
    for s, thigh, shin, foot in (('l', P.thigh_l, P.shin_l, P.foot_l), ('r', P.thigh_r, P.shin_r, P.foot_r)):
        sg = 1 if s == 'l' else -1
        yaw, pitch = math.radians(thigh[0]), math.radians(thigh[1])
        d = Vector((sg * math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), -math.sin(pitch)))
        aim_bone('upperleg.' + s, d, UP)
        aim_bone('lowerleg.' + s, Vector(shin), UP)
        # 발은 발바닥(toes 뼈, 기본 자세에서 수평)이 기준이다: 통째로 yaw·pitch 만큼 돌린다
        set_delta('foot.' + s, qaxis([((0, 0, 1), foot[0] * (1 if s == 'l' else 1)), ((1, 0, 0), foot[1])])); upd()
        set_delta('toes.' + s, delta('foot.' + s)); upd()
        set_delta('knee_mid.' + s, delta('upperleg.' + s).slerp(delta('lowerleg.' + s), 0.5)); upd()
    set_delta('skirt_lap', delta('hips')); upd()
    for s in 'lr':
        sg = 1 if s == 'l' else -1
        knee = r.pose.bones['lowerleg.' + s].head
        W = knee + Vector((sg * P.hand_off[0], P.hand_off[1], P.hand_off[2]))
        if P.hand_blend < 1.0 and STAND_REL:
            Ws = r.pose.bones['chest'].head + STAND_REL[s]
            W = Ws.lerp(W, P.hand_blend)
        solve_arm(s, W, (sg, 0.5, -0.4), (-sg * 0.25, -1, -0.15), (sg * 0.1, 0, 1))
    upd()
    return capture()


def capture():
    r = rig()
    return {pb.name: (pb.location.copy(), pb.rotation_quaternion.copy()) for pb in r.pose.bones}


def lerp_pose(A, B, t):
    out = {}
    for k in A:
        la, qa = A[k]; lb, qb = B[k]
        if qa.dot(qb) < 0:
            qb = -qb
        out[k] = (la.lerp(lb, t), qa.slerp(qb, t).normalized())
    return out


def stand_pose():
    """서 있는 자세: Idle 첫 프레임(기존 클립에서 그대로)."""
    r = rig(); ad = r.animation_data_create(); a = bpy.data.actions['Idle']
    ad.action = a
    try:
        ad.action_slot = a.slots[0]
    except Exception:
        pass
    bpy.context.scene.frame_set(0)
    out = capture()
    STAND_REL.clear()
    for s in 'lr':
        STAND_REL[s] = r.pose.bones['wrist.' + s].head - r.pose.bones['chest'].head
    ad.action = None
    reset_pose(r)
    return out


STAND_REL = {}


# ------------------------------------------------------------------ 점검: 다리끼리·발끼리 뚫음, 바닥 아래로 내려감
def penetration(outfit=('bottom__pants', 'shoes__sneakers'), zmax_leg=0.32):
    """현재 포즈에서 왼쪽/오른쪽 다리 메쉬(허벅지 아래쪽·신발)의 겹치는 삼각형 쌍 수와 가장 낮은 점."""
    from mathutils.bvhtree import BVHTree
    dg = bpy.context.evaluated_depsgraph_get()
    res = {}
    parts = {}
    for nme in outfit:
        o = bpy.data.objects[nme]
        o.hide_viewport = False
        rest_vs = [v.co.copy() for v in o.data.vertices]
        oe = o.evaluated_get(dg); me = oe.to_mesh()
        W = oe.matrix_world
        vs = [W @ v.co for v in me.vertices]
        for side, sg in (('l', 1), ('r', -1)):
            tris = []
            for poly in me.polygons:
                c = sum((rest_vs[i] for i in poly.vertices), Vector()) / len(poly.vertices)
                if c.x * sg <= 0 or c.z > zmax_leg and nme.startswith('bottom'):
                    continue
                idx = list(poly.vertices)
                for k in range(1, len(idx) - 1):
                    tris.append((idx[0], idx[k], idx[k + 1]))
            parts[(nme, side)] = BVHTree.FromPolygons(vs, tris)
        res[nme + '_minz'] = min(v.z for v in vs)
        oe.to_mesh_clear()
    for a in outfit:
        for b in outfit:
            pa, pb = parts[(a, 'l')], parts[(b, 'r')]
            if a > b:
                continue
            res['overlap %s.l x %s.r' % (a, b)] = len(pa.overlap(pb))
            if a != b:
                res['overlap %s.r x %s.l' % (a, b)] = len(parts[(a, 'r')].overlap(parts[(b, 'l')]))
    return res


# ------------------------------------------------------------------ 자세 값
FINAL = dict()
CROUCH = dict(plant=True, hip_back=0.10, hip_pitch=12.0, spine_pitch=10.0, chest_pitch=8.0, head_pitch=-12.0,
              thigh_l=(8.0, 25.0), thigh_r=(8.0, 25.0), shin_l=(0.0, 0.9, -0.43), shin_r=(0.0, 0.9, -0.43),
              foot_l=(0.0, 0.0), foot_r=(0.0, 0.0))


MID_W = 1.0      # 엉덩이가 내려앉는 순간(K2)의 다리 모양 = 웅크림→최종 사이 비율
MID_DROP = 0.30   # 그때 엉덩이 낮춤(최종 0.329보다 3 cm 위: 마지막에 살짝 내려앉는다)


def mid_legs():
    F, C = Pose(**FINAL), Pose(**CROUCH)
    avg = lambda a, b: tuple(x * MID_W + y * (1 - MID_W) for x, y in zip(a, b))
    nrm = lambda v: tuple(Vector(v).normalized())
    return dict(floor=True, hip_back=0.08, hip_pitch=0.0, spine_pitch=9.0, chest_pitch=5.0, head_pitch=-6.0,
                thigh_l=avg(F.thigh_l, C.thigh_l), thigh_r=avg(F.thigh_r, C.thigh_r),
                shin_l=nrm(avg(F.shin_l, C.shin_l)), shin_r=nrm(avg(F.shin_r, C.shin_r)),
                foot_l=(F.foot_l[0] * 0.4, F.foot_l[1]), foot_r=(F.foot_r[0] * 0.4, F.foot_r[1]))   # 발끝은 마지막에 안으로 모인다


def smooth(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)


DOWN_FRAMES = 24
STAND = dict(hip_drop=0.0, hip_back=0.0, hip_pitch=0.0, spine_pitch=0.0, chest_pitch=0.0, head_pitch=0.0,
             thigh_l=(0.0, 90.0), thigh_r=(0.0, 90.0), shin_l=(0.0, 0.18, -0.98), shin_r=(0.0, 0.18, -0.98),
             foot_l=(0.0, 0.0), foot_r=(0.0, 0.0))
NUM_KEYS = ('hip_back', 'hip_pitch', 'spine_pitch', 'chest_pitch', 'head_pitch')
TUP_KEYS = ('thigh_l', 'thigh_r', 'foot_l', 'foot_r')
VEC_KEYS = ('shin_l', 'shin_r')


def full(d):
    p = Pose(**d)
    return p.__dict__


def blend(A, B, t):
    a, b = full(A), full(B)
    out = dict(a)
    for k in NUM_KEYS:
        out[k] = a[k] + (b[k] - a[k]) * t
    for k in TUP_KEYS:
        out[k] = tuple(x + (y - x) * t for x, y in zip(a[k], b[k]))
    for k in VEC_KEYS:
        v = Vector(a[k]).normalized().lerp(Vector(b[k]).normalized(), t).normalized()
        out[k] = tuple(v)
    return out


def down_frames():
    """Sit_Floor_Down 24프레임: 선 자세 → 웅크림(발은 바닥에 평평) → 엉덩이가 방석에 앉음(65% 지점) → 자리잡기.
    몸 자세는 매 프레임 매개변수로 풀고(엉덩이 높이는 바지·신발의 가장 낮은 점이 바닥에 닿게 자동), 팔만 마지막에 무릎으로 간다."""
    K0 = stand_pose()
    mid = mid_legs()
    # 무릎을 먼저 벌리고 발목은 몸 옆 폭을 지킨다(발끼리 안 겹치게), 그 뒤 발이 앞으로 모인다
    wide = dict(CROUCH, hip_pitch=8.0, spine_pitch=8.0, chest_pitch=6.0, thigh_l=(30.0, 22.0), thigh_r=(30.0, 22.0),
                shin_l=(-0.45, 0.8, -0.4), shin_r=(0.45, 0.8, -0.4))
    keys = [(0, STAND, lambda t: t), (8, CROUCH, smooth), (11, wide, lambda t: t), (16, mid, lambda t: t),
            (24, dict(FINAL), lambda t: 1 - (1 - t) ** 2)]
    out = []
    for f in range(DOWN_FRAMES + 1):
        if f == 0:
            out.append((0, K0)); continue
        for (fa, A, _), (fb, B, e) in zip(keys, keys[1:]):
            if fa <= f <= fb:
                params = blend(A, B, e((f - fa) / (fb - fa)))
                break
        params['floor'] = f < DOWN_FRAMES
        params['hand_blend'] = smooth((f - 3) / 13.0)
        P = Pose(**params)
        if f == DOWN_FRAMES:
            P.hip_drop = Pose(**FINAL).hip_drop
        pose = apply(P)
        out.append((f, pose))
    return out


IDLE_FRAMES = 72


def idle_frames():
    """Sit_Floor_Idle 72프레임(3 s) 반복: 숨쉬기(1.5 s 주기 x2), 고개가 천천히 한 바퀴 두리번."""
    out = []
    for f in range(IDLE_FRAMES + 1):
        ph = 2 * math.pi * f / IDLE_FRAMES
        yaw = 5.0 * math.sin(ph) + 2.0 * math.sin(2 * ph + 1.0)
        out.append((f, apply(Pose(**dict(FINAL, breathe=1.3 * math.sin(2 * ph), head_yaw=yaw, head_pitch=-2.0 + 1.2 * math.sin(ph - 0.6))))))
    out[-1] = (IDLE_FRAMES, out[0][1])   # 이음매 없음
    return out


def write_action(name, keys, bones, length, cyclic):
    old = bpy.data.actions.get(name)
    if old:
        bpy.data.actions.remove(old)
    a = bpy.data.actions.new(name)
    a.use_fake_user = True
    a.use_frame_range = True
    a.frame_start = 0.0; a.frame_end = float(length)
    a.use_cyclic = cyclic
    r = rig()
    r.animation_data.action = a   # fcurve_ensure_for_datablock은 동작이 걸려 있어야 한다
    prev = {}
    for b in bones:
        dp_l = 'pose.bones["%s"].location' % b; dp_q = 'pose.bones["%s"].rotation_quaternion' % b
        fl = [a.fcurve_ensure_for_datablock(r, dp_l, index=i, group_name=b) for i in range(3)]
        fq = [a.fcurve_ensure_for_datablock(r, dp_q, index=i, group_name=b) for i in range(4)]
        for frame, pose in keys:
            l, q = pose[b]
            q = q.normalized()
            if b in prev and prev[b].dot(q) < 0:
                q = -q
            prev[b] = q
            for i in range(3):
                fl[i].keyframe_points.insert(frame, l[i], options={'FAST'})
            for i in range(4):
                fq[i].keyframe_points.insert(frame, q[i], options={'FAST'})
        for fc in fl + fq:
            fc.update()
            for kp in fc.keyframe_points:
                kp.interpolation = 'LINEAR'
    r.animation_data.action = None
    return a


def build():
    r = rig()
    ad = r.animation_data_create()
    use_nla = ad.use_nla
    ad.use_nla = False
    reset_pose(r)
    down = down_frames()
    write_action('Sit_Floor_Down', down, KEY_BONES, DOWN_FRAMES, False)
    reset_pose(r)
    # 일어서기 = 앉기를 거꾸로
    up = [(f, down[len(down) - 1 - f][1]) for f in range(len(down))]
    write_action('Sit_Floor_StandUp', up, KEY_BONES, DOWN_FRAMES, False)
    reset_pose(r)
    write_action('Sit_Floor_Idle', idle_frames(), KEY_BONES, IDLE_FRAMES, True)
    ad.use_nla = use_nla
    reset_pose(r)


# ------------------------------------------------------------------ 내보내기
def load_lib():
    """블렌드 안의 제작 스크립트(toykit → toykit2 → parts2 → poke_test → stage2b)를 한 이름공간에 불러온다."""
    ns = {'__name__': 'libns'}
    for n in LIB_TEXTS:
        exec(compile(bpy.data.texts[n].as_string(), n, 'exec'), ns)
    return ns


def _read_glb(path):
    buf = open(path, 'rb').read()
    jl = struct.unpack_from('<I', buf, 12)[0]
    js = json.loads(buf[20:20 + jl].decode('utf8'))
    bl = struct.unpack_from('<I', buf, 20 + jl)[0]
    return js, buf[28 + jl:28 + jl + bl]


def _write_glb(path, js, bin_):
    jb = json.dumps(js, separators=(',', ':')).encode('utf8')
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    bin_ += b'\x00' * ((4 - len(bin_) % 4) % 4)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(jb) + 8 + len(bin_)))
        f.write(struct.pack('<II', len(jb), 0x4E4F534A)); f.write(jb)
        f.write(struct.pack('<II', len(bin_), 0x004E4942)); f.write(bin_)


def prune_dead_channels(path):
    """내보낸 GLB에서 몸에 무게가 없는 IK·컨트롤 뼈의 동작 채널을 모든 클립에서 빼고, 안 쓰는 접근자·버퍼뷰를 정리한다.
    (Blender 내보내기는 NLA 클립마다 뼈 44개 x 3채널을 전부 쓴다: JSON 만 클립당 ~12 KB. 메시·스킨·그림은 바이트 그대로.)"""
    js, bin_ = _read_glb(path)
    names = [n.get('name') for n in js['nodes']]
    dead = set(DEAD_BONES)
    removed = 0
    for anim in js['animations']:
        keep = [c for c in anim['channels'] if names[c['target']['node']] not in dead]
        removed += len(anim['channels']) - len(keep)
        used = sorted({c['sampler'] for c in keep})
        remap = {o: i for i, o in enumerate(used)}
        anim['samplers'] = [anim['samplers'][o] for o in used]
        for c in keep:
            c['sampler'] = remap[c['sampler']]
        anim['channels'] = keep
    # 접근자 사용처 다시 세기
    used_acc = set()
    for m in js['meshes']:
        for pr in m['primitives']:
            used_acc.update(pr['attributes'].values())
            if 'indices' in pr:
                used_acc.add(pr['indices'])
    for sk in js.get('skins', []):
        if 'inverseBindMatrices' in sk:
            used_acc.add(sk['inverseBindMatrices'])
    for anim in js['animations']:
        for sm in anim['samplers']:
            used_acc.update((sm['input'], sm['output']))
    acc_order = sorted(used_acc)
    amap = {o: i for i, o in enumerate(acc_order)}
    used_views = {js['accessors'][i]['bufferView'] for i in acc_order}
    used_views.update(im['bufferView'] for im in js.get('images', []) if 'bufferView' in im)
    view_order = sorted(used_views)
    vmap = {o: i for i, o in enumerate(view_order)}
    out = bytearray(); views = []
    for o in view_order:
        v = dict(js['bufferViews'][o])
        while len(out) % 4:
            out.append(0)
        start = v.get('byteOffset', 0)
        v['byteOffset'] = len(out)
        out += bin_[start:start + v['byteLength']]
        views.append(v)
    accs = []
    for o in acc_order:
        a = dict(js['accessors'][o]); a['bufferView'] = vmap[a['bufferView']]
        accs.append(a)
    for m in js['meshes']:
        for pr in m['primitives']:
            pr['attributes'] = {k: amap[v] for k, v in pr['attributes'].items()}
            if 'indices' in pr:
                pr['indices'] = amap[pr['indices']]
    for sk in js.get('skins', []):
        if 'inverseBindMatrices' in sk:
            sk['inverseBindMatrices'] = amap[sk['inverseBindMatrices']]
    for anim in js['animations']:
        for sm in anim['samplers']:
            sm['input'] = amap[sm['input']]; sm['output'] = amap[sm['output']]
    for im in js.get('images', []):
        if 'bufferView' in im:
            im['bufferView'] = vmap[im['bufferView']]
    js['accessors'] = accs; js['bufferViews'] = views
    js['buffers'] = [{'byteLength': len(out)}]
    _write_glb(path, js, bytes(out))
    return removed


def export(path, strip=True):
    lib = load_lib()
    r = rig()
    reset_pose(r)
    ad = r.animation_data_create()
    have = {t.name for t in ad.nla_tracks}
    for name in NEW_CLIPS:
        if name not in have:
            tr = ad.nla_tracks.new(); tr.name = name
            tr.strips.new(name, 0, bpy.data.actions[name])
            tr.mute = True
    clips = list(lib['ACTIONS']) + NEW_CLIPS
    # 내보내는 줄은 정확히 이 동작들뿐이어야 한다(낚시 동작 등은 NLA에 없어야 한다)
    extra = sorted({t.name for t in ad.nla_tracks} - set(clips))
    assert not extra, 'unexpected NLA tracks would be exported: %s' % extra
    size = lib['export_glb'](path)
    if strip:
        print('PRUNED dead channels', prune_dead_channels(path))
        size = os.path.getsize(path)
    reset_pose(r)
    assert r.data.pose_position == 'POSE' and (r.animation_data is None or r.animation_data.action is None)
    return size


def store_self_text():
    src = open(__file__, encoding='utf8').read() if '__file__' in globals() else None
    if src is None:
        return
    t = bpy.data.texts.get('floor_sit') or bpy.data.texts.new('floor_sit')
    t.clear(); t.write(src)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ensure_face_textures()
    build()
    r = rig()
    if '--export' in argv:
        path = argv[argv.index('--export') + 1]
        size = export(path, strip='--keep-dead' not in argv)
        print('EXPORTED', path, size, 'bytes')
    reset_pose(r)
    assert r.data.pose_position == 'POSE' and (r.animation_data is None or r.animation_data.action is None)
    if '--save' in argv:
        # 블렌드에는 새 동작(Sit_Floor_*)과 이 스크립트(텍스트 블록)를 남긴다. 내보내기와 같은 실행에서는 저장하지 않는다.
        assert '--export' not in argv, 'save and export in separate runs (export strips dead channels)'
        store_self_text()
        for name in NEW_CLIPS:
            a = bpy.data.actions[name]; a.use_fake_user = True
        reset_pose(r)
        bpy.ops.wm.save_mainfile()
        print('SAVED', bpy.data.filepath)


if __name__ == '__main__':
    main()
