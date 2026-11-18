# fishing_anims.py — 낚시터(A10) 캐릭터 낚시 동작 9개를 만들고 fishing_anims.glb로 내보낸다.
#
#   "C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" -b art/character/cayson-toy.blend \
#       --python docs/designs/lake-fishing/anim_src/fishing_anims.py -- \
#       --export client/public/models/lake/fishing_anims.glb [--save]
#
# 블렌드 안에도 같은 내용이 텍스트 블록 'fishing_anims'로 들어 있다(--save 때 갱신).
#
# 규칙(설계 6.3 + 기억 노트 character-glb-export):
#  - 기존 'Rig' 뼈대 그대로(뼈 이름이 character.glb와 같다). 메시는 내보내지 않는다(뼈 노드 + 클립만).
#  - 내보내기 전과 블렌드 저장 전에 반드시 pose_position='POSE', 활성 동작 없음, 모든 포즈 뼈를 기본값으로 되돌린다.
#  - 클립 키는 fcurve에 직접 쓴다(키를 넣는 중에 depsgraph가 포즈를 덮어쓰지 않게).
#
# 손에 드는 물건 약속(parts2.py item_frame과 같은 규칙):
#  - 낚싯대 축 = handslot.r 로컬 U_R = (-0.8, 0.6, 0) 정규화, 쥐는 점 GRIP = (0, 0, 0.025) (slot 로컬).
#  - 뜰채 손잡이 축 = handslot.l 로컬 U_L = (0.8, 0.6, 0) 정규화(오른손의 거울상).
#  - 물고기(Fish_Stand_Show·Fish_Release): 두 handslot의 가운데에 가로로(handslot.l → handslot.r 방향 = 몸통 축) 얹는다.
#    Fish_Sit_Lift 끝: 왼손(handslot.l)이 물고기를 쥔다.
#
# 좌표(블렌더 뼈대 공간): +X = 캐릭터 왼쪽, -Y = 앞, +Z = 위. 캐릭터는 -Y를 본다(glTF에서 +Z).

import bpy, math, json, struct, os, sys
from mathutils import Vector, Quaternion, Matrix

FPS = 24
# 낚싯대 쥐는 법(소유자 2026-11-19: "팔과 손이 많이 꺾여 있어", "손에 대가 꿰뚫려 있어"): 대 축 = 손가락 방향(slot +X)에서 손등 쪽(+Z)으로 COCK도만 든 방향
# = 팔뚝 방향 + 살짝 젖힌 손목. (예전 축 (-0.8, 0.6, 0)은 팔뚝에서 66~85도 벗어나 손목이 꺾였다.) 쥐는 점은 대의 뒤끝 0.10 m 앞(손잡이 가운데).
COCK = 10.0
FORE_MAX = 40.0   # 팔뚝은 이보다 가파르게 들지 않는다(팔꿈치가 너무 접히지 않게): 대가 더 가파르면 그만큼 손목을 젖힌다(최대 elev-50도: 80도 대 = 30도)
U_R = Vector((math.cos(math.radians(COCK)), 0.0, math.sin(math.radians(COCK)))).normalized()
U_L = Vector((0.8, 0.6, 0.0)).normalized()
ROD_HAND_AT = -0.10     # 손이 쥔 점의 대 좌표(그립 뿌리 노드 기준, 축 방향 m): 손잡이 뒤끝(-0.338)은 손 뒤 0.24 m, 팔뚝 속에 묻힌다
GRIP = U_R * (-ROD_HAND_AT)   # 뿌리 노드가 놓일 slot 로컬 위치(손 = slot 원점)
X_ = Vector((1, 0, 0)); Y_ = Vector((0, 1, 0)); Z_ = Vector((0, 0, 1))
FING_R = Vector((1, 0, 0))    # 오른손 손가락 방향(slot 로컬 +X)
FING_L = Vector((-1, 0, 0))   # 왼손 손가락 방향(slot 로컬 -X)
BACK = Vector((0, 0, 1))      # 손등(slot 로컬 +Z)

ARM_R = ['upperarm.r', 'lowerarm.r', 'wrist.r', 'hand.r', 'handslot.r']
ARM_L = ['upperarm.l', 'lowerarm.l', 'wrist.l', 'hand.l', 'handslot.l']
BODY = ['root', 'hips', 'spine', 'chest', 'head'] + ARM_L + ARM_R + [
    'upperleg.l', 'lowerleg.l', 'foot.l', 'toes.l', 'knee_mid.l',
    'upperleg.r', 'lowerleg.r', 'foot.r', 'toes.r', 'knee_mid.r', 'skirt_lap']

# 클립 이름 → (길이 프레임, 반복?, 내보낼 뼈). 길이는 정수 프레임(내보내기가 정수 프레임까지만 샘플링한다).
CLIPS = {
    'Fish_Sit_Idle':   (96.0, True,  BODY),
    'Fish_Sit_Cast':   (24.0, False, BODY),
    'Fish_Sit_Strike': (10.0, False, BODY),
    'Fish_Sit_Fight':  (48.0, True,  BODY),
    'Fish_Sit_Lift':   (24.0, False, BODY),
    'Fish_Net':        (29.0, False, BODY),
    'Fish_Stand_Show': (60.0, False, BODY),
    'Fish_Release':    (19.0, False, BODY),
    'Carry_Rod':       (25.0, True,  ARM_R),   # 위쪽만: 오른팔 사슬만(걷기·서기 위에 덮는다). 길이 = character.glb Walking_A(25프레임)
}


def rig():
    return bpy.data.objects['Rig']


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


# ------------------------------------------------------------------ 기준 자세(기존 클립에서 한 프레임)
_BASES = {}


def base(action, frame):
    key = (action, float(frame))
    if key in _BASES:
        return _BASES[key]
    r = rig(); ad = r.animation_data_create(); a = bpy.data.actions[action]
    ad.action = a
    try:
        ad.action_slot = a.slots[0]
    except Exception:
        pass
    sc = bpy.context.scene
    f = float(frame)
    sc.frame_set(int(math.floor(f)), subframe=f - math.floor(f))
    out = {pb.name: (pb.location.copy(), pb.rotation_quaternion.copy(), pb.scale.copy()) for pb in r.pose.bones}
    ad.action = None
    _BASES[key] = out
    return out


# ------------------------------------------------------------------ 자세 풀이
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
    """뼈의 뼈대 공간 회전 변화량을 D로 만든다(부모 포즈는 그대로)."""
    pb = rig().pose.bones[name]
    R = rest_q(name)
    pb.rotation_quaternion = R.inverted() @ parent_delta(name).inverted() @ D @ R


def upd():
    bpy.context.view_layer.update()


def qaxis(spec):
    q = Quaternion()
    for axis, deg in spec:
        q = q @ Quaternion(Vector(axis), math.radians(deg))
    return q


def rod(elev, yaw=0.0):
    """낚싯대 방향: elev = 수평 위 각도, yaw + = 캐릭터 왼쪽."""
    e = math.radians(elev); y = math.radians(yaw)
    return Vector((math.sin(y) * math.cos(e), -math.cos(y) * math.cos(e), math.sin(e)))


def frame_rot(a_loc, a_w, b_loc, b_w):
    e1 = a_loc.normalized(); e2 = (b_loc - e1 * b_loc.dot(e1)).normalized(); e3 = e1.cross(e2)
    f1 = a_w.normalized(); f2 = (b_w - f1 * b_w.dot(f1))
    if f2.length < 1e-6:
        f2 = Vector((0, 0, 1)) - f1 * f1.z
    f2.normalize(); f3 = f1.cross(f2)
    E = Matrix((e1, e2, e3)).transposed(); F = Matrix((f1, f2, f3)).transposed()
    return (F @ E.transposed()).to_quaternion()


def chest_space():
    r = rig()
    return r.pose.bones['chest'].head.copy(), delta('chest'), r.data.bones['chest'].head_local.copy()


def solve_arm(side, spec, rod_info):
    r = rig(); s = side
    up, lo, wr, ha, sl = (n.replace('.r', '.' + s) for n in ARM_R)
    ch_pos, ch_D, _ = chest_space()
    rel = lambda v: ch_D @ Vector(v)
    dir_rel = spec.get('rel', False)
    tw = lambda v: (ch_D @ Vector(v)) if dir_rel else Vector(v)
    pole = rel(spec.get('pole', (-1 if s == 'r' else 1, 0.4, -0.6)))

    # 목표 손 방향(slot 회전)
    def target_orient(P_slot):
        if 'on_rod' in spec:
            rdir = rod_info['dir']
            a = (U_L if s == 'l' else U_R, rdir)
        else:
            a = spec.get('a')
            if a is not None:
                a = (Vector(a[0]), tw(a[1]))
        b = spec.get('b')
        if b is not None:
            b = (Vector(b[0]), tw(b[1]))
        if a is None:
            return None
        if b is None:
            return (P_slot @ a[0]).rotation_difference(a[1]) @ P_slot
        return frame_rot(a[0], a[1], b[0], b[1])

    def slot_goal():
        if 'on_rod' in spec:
            return rod_info['pos'] + rod_info['dir'] * spec['on_rod'] + rel(spec.get('rod_off', (0, 0, 0)))
        if 's' in spec:
            return ch_pos + rel(spec['s'])
        return None

    W = ch_pos + rel(spec['w']) if 'w' in spec else None
    goal = slot_goal()
    if 'rodal' in spec:
        # 팔꿈치 E(몸 옆 느슨히) -> 손목 W = E + 팔뚝 x (대 방향보다 COCK도 아래): 팔뚝과 대가 거의 나란하다(손목 꺾임 = COCK도)
        S_ = r.pose.bones[up].head.copy()
        L1_ = (r.data.bones[lo].head_local - r.data.bones[up].head_local).length
        L2_ = (r.data.bones[wr].head_local - r.data.bones[lo].head_local).length
        E_ = S_ + (ch_D @ Vector(spec['ua'])).normalized() * L1_
        W = E_ + rod(min(spec['rodal'][0] - COCK, FORE_MAX), spec['rodal'][1]) * L2_
        pole = E_ - S_
        goal = None
    if W is None:
        # 처음 추정: slot 목표에서 손 길이만큼 어깨 쪽으로
        S0 = r.pose.bones[up].head
        W = goal + (S0 - goal).normalized() * 0.16
    iters = 4 if goal is not None else 1
    for _ in range(iters):
        S = r.pose.bones[up].head.copy()
        L1 = (r.data.bones[lo].head_local - r.data.bones[up].head_local).length
        L2 = (r.data.bones[wr].head_local - r.data.bones[lo].head_local).length
        d = W - S
        dl = min(max(d.length, abs(L1 - L2) + 1e-3), (L1 + L2) * 0.995)
        n = d.normalized()
        a_ = (L1 * L1 - L2 * L2 + dl * dl) / (2 * dl)
        h = math.sqrt(max(L1 * L1 - a_ * a_, 0.0))
        p = (pole - n * pole.dot(n)).normalized()
        E = S + n * a_ + p * h
        Wc = S + n * dl
        for bone, t in ((up, E - S), (lo, Wc - E)):
            Dp = parent_delta(bone)
            rest_dir = r.data.bones[bone].matrix_local.to_3x3() @ Vector((0, 1, 0))
            q = rest_dir.rotation_difference(Dp.inverted() @ t.normalized())
            set_delta(bone, Dp @ q)
            upd()
        # 손목은 팔뚝 방향 그대로에서 시작
        set_delta(wr, delta(lo)); upd()
        set_delta(ha, delta(wr)); upd()
        T = target_orient(posed_q(sl))
        if T is not None:
            c = T @ posed_q(sl).inverted()
            half = Quaternion().slerp(c, spec.get('wrist_share', 0.5))
            set_delta(wr, half @ delta(wr)); upd()
            c2 = T @ posed_q(sl).inverted()
            set_delta(ha, c2 @ delta(ha)); upd()
        if goal is None:
            break
        W = W + (goal - r.pose.bones[sl].head)


def rod_state():
    r = rig(); pb = r.pose.bones['handslot.r']
    M = pb.matrix
    return {'pos': M @ GRIP, 'dir': (M.to_3x3() @ U_R).normalized()}


def apply_pose(P):
    """P = {'base': (action, frame), 'rot': {bone: [(axis, deg)]}, 'R': arm, 'L': arm}"""
    r = rig()
    B = base(*P['base'])
    for pb in r.pose.bones:
        l, q, s = B[pb.name]
        pb.location = l; pb.rotation_quaternion = q; pb.scale = s
    upd()
    for bone in ['root', 'hips', 'spine', 'chest', 'head']:
        if bone in P.get('rot', {}):
            pb = r.pose.bones[bone]; R = rest_q(bone)
            pb.rotation_quaternion = R.inverted() @ qaxis(P['rot'][bone]) @ R @ B[bone][1]
            upd()
    rod_info = None
    if P.get('R'):
        solve_arm('r', P['R'], None)
        rod_info = rod_state()
    if P.get('L'):
        solve_arm('l', P['L'], rod_info or rod_state())
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
        out[k] = (la.lerp(lb, t), qa.slerp(qb, t))
    return out


# ------------------------------------------------------------------ 자세 정의
SIT = ('Sit_Chair_Idle', 0)
STAND = ('Idle', 0)


def arm_rod_r(w, elev, yaw=-6.0, pole=(-1, 0.5, -0.7), ua=None):
    """오른손으로 대 쥐기: 팔꿈치는 몸 옆에 느슨하게 내려오고(ua = 위팔 방향, 가슴 공간), 팔뚝이 대와 나란하다(대보다 COCK도 아래).
    `w`·`pole`은 옛 값(무시): 손목 자리는 팔꿈치 + 팔뚝 길이 x 팔뚝 방향으로 정해진다."""
    return {'rodal': (elev, yaw), 'ua': ua or (-0.28, -0.22, -0.90), 'a': (U_R, rod(elev, yaw)), 'b': (BACK, (0, 0, 1))}


def L_lap(w=(0.22, -0.26, -0.30)):
    return {'w': w, 'pole': (1, 0.4, -0.5), 'a': (FING_L, (0.05, -1.0, -0.45)), 'b': (BACK, (0.2, 0.1, 1))}


def sit_idle(elev=30, chest=0.0, head=None, w=(-0.27, -0.33, -0.21), L=None, yaw=-6.0, ua=None):
    rot = {'chest': [((1, 0, 0), chest)]}
    if head:
        rot['head'] = head
    return {'base': SIT, 'rot': rot, 'R': arm_rod_r(w, elev, yaw, ua=ua), 'L': L or L_lap()}


def fight(elev=60, yaw=-12.0, lean=-9.0, twist=0.0, head=None, w=(-0.22, -0.26, -0.08), s_on=-0.30):
    rot = {'spine': [((0, 0, 1), twist), ((1, 0, 0), lean * 0.5)], 'chest': [((1, 0, 0), lean * 0.5)]}
    if head:
        rot['head'] = head
    return {'base': SIT, 'rot': rot, 'R': arm_rod_r(w, elev, yaw, pole=(-1, 0.3, -0.8)),
            'L': {'on_rod': s_on, 'pole': (1, 0.3, -0.8), 'b': (BACK, (0.3, 0, 1))}}


def hold_fish(base_, lift=0.0, fwd=0.0, rot=None, spread=0.18, tilt=0.0):
    """두 손바닥을 위로, 손가락 앞으로: 물고기를 가로로 받쳐 든다(가슴 공간)."""
    z = 0.02 + lift; y = -0.42 + fwd
    tl = math.radians(tilt)
    fing = (0, -math.cos(tl), -math.sin(tl))
    return {'base': base_, 'rot': rot or {},
            'R': {'s': (-spread, y, z), 'rel': True, 'pole': (-1, 0.6, -0.9), 'a': (FING_R, fing), 'b': (BACK, (0.25, 0, -1))},
            'L': {'s': (spread, y, z), 'rel': True, 'pole': (1, 0.6, -0.9), 'a': (FING_L, fing), 'b': (BACK, (-0.25, 0, -1))}}


def clip_poses():
    """클립 이름 → [(프레임, 자세 dict 또는 캡처된 포즈)]"""
    C = {}
    # 1) 앉아서 기다리기(반복 4 s): 숨쉬기, 대 끝 살짝 까딱, 가끔 고개
    C['Fish_Sit_Idle'] = [
        (0, sit_idle()),
        (24, sit_idle(elev=36, chest=-1.5, yaw=-10.0, ua=(-0.26, -0.32, -0.88))),
        (44, sit_idle(elev=30, chest=0.5, yaw=-4.0, head=[((0, 0, 1), 14), ((1, 0, 0), 3)])),
        (60, sit_idle(elev=26, chest=0.5, yaw=-2.0, ua=(-0.30, -0.12, -0.92), head=[((0, 0, 1), 12), ((1, 0, 0), 4)])),
        (74, sit_idle(elev=35, chest=-1.5, yaw=-9.0, ua=(-0.26, -0.30, -0.89), head=[((0, 0, 1), -4)])),
        (96, sit_idle()),
    ]
    # 2) 던지기(1.0 s): 대를 뒤로 세웠다가 앞으로 흔들어 채비를 내려놓는다(민장대)
    C['Fish_Sit_Cast'] = [
        (0, sit_idle()),
        (6, sit_idle(elev=72, chest=-7, w=(-0.33, -0.24, -0.04), yaw=-20)),
        (9, sit_idle(elev=80, chest=-8, w=(-0.34, -0.22, -0.02), yaw=-24)),
        (13, sit_idle(elev=44, chest=4, w=(-0.29, -0.38, -0.10), yaw=-10)),
        (16, sit_idle(elev=26, chest=7, w=(-0.27, -0.40, -0.18))),
        (20, sit_idle(elev=30, chest=2, w=(-0.27, -0.35, -0.20))),
        (24, sit_idle()),
    ]
    # 3) 챔질(0.4 s): 손목으로 짧고 힘 있게
    C['Fish_Sit_Strike'] = [
        (0, sit_idle()),
        (2.5, sit_idle(elev=58, chest=-5, w=(-0.27, -0.29, -0.11))),
        (4.5, sit_idle(elev=72, chest=-9, w=(-0.25, -0.27, -0.07),
                       L={'w': (0.16, -0.30, -0.22), 'pole': (1, 0.4, -0.6), 'a': (FING_L, (-0.3, -1, 0)), 'b': (BACK, (0.3, 0, 1))})),
        (10, fight(elev=62)),
    ]
    # 4) 버티기(반복 2 s): 대를 높이 세우고 몸을 뒤로, 좌우로 끌림
    C['Fish_Sit_Fight'] = [
        (0, fight(elev=62)),
        (10, fight(elev=55, yaw=-30, lean=-3, twist=-9, head=[((0, 0, 1), -10)])),
        (16, fight(elev=58, yaw=-26, lean=-8, twist=-7, head=[((0, 0, 1), -8)])),
        (24, fight(elev=68, yaw=-12, lean=-13, twist=0)),
        (34, fight(elev=55, yaw=8, lean=-3, twist=8, head=[((0, 0, 1), 8)])),
        (40, fight(elev=59, yaw=4, lean=-8, twist=6, head=[((0, 0, 1), 6)])),
        (48, fight(elev=62)),
    ]
    # 5) 들어 올리기(1.0 s): 작은 고기를 대로 들어 올려 왼손으로 잡는다
    lift_hi = {'base': SIT, 'rot': {'chest': [((1, 0, 0), -9)]}, 'R': arm_rod_r((-0.35, -0.22, 0.00), 78, -32, pole=(-1, 0.3, -0.8)),
               'L': {'w': (0.14, -0.40, -0.16), 'pole': (1, 0.2, -0.8), 'a': (FING_L, (-0.2, -1, 0.3)), 'b': (BACK, (0.3, 0, 1))}}
    catch = {'base': SIT, 'rot': {'chest': [((1, 0, 0), 4)], 'head': [((1, 0, 0), 8)]},
             'R': arm_rod_r((-0.35, -0.22, -0.02), 76, -32, pole=(-1, 0.3, -0.8)),
             'L': {'w': (0.10, -0.44, -0.15), 'pole': (1, 0.2, -0.8), 'a': (FING_L, (-0.3, -1, 0.1)), 'b': (BACK, (0.6, 0, 0.8))}}
    bring = {'base': SIT, 'rot': {'chest': [((1, 0, 0), 0)], 'head': [((1, 0, 0), 10), ((0, 0, 1), 6)]},
             'R': arm_rod_r((-0.33, -0.25, -0.05), 70, -28, pole=(-1, 0.3, -0.8)),
             'L': {'w': (0.12, -0.36, -0.17), 'pole': (1, 0.3, -0.8), 'a': (FING_L, (-0.5, -1, 0.2)), 'b': (BACK, (0.6, 0, 0.8))}}
    C['Fish_Sit_Lift'] = [
        (0, fight(elev=62)),
        (8, lift_hi),
        (13, catch),
        (18, bring),
        (24, bring),
    ]
    # 6) 뜰채(1.2 s): 오른손은 대를 높이, 왼손 뜰채를 앞 물속으로 넣었다가 떠서 당긴다
    def net(elev_net, yaw_net, w, lean, rod_el=74):
        return {'base': SIT, 'rot': {'spine': [((1, 0, 0), lean * 0.5)], 'chest': [((1, 0, 0), lean * 0.5)]},
                'R': arm_rod_r((-0.35, -0.22, -0.02), rod_el, -34, pole=(-1, 0.3, -0.8)),
                'L': {'w': w, 'pole': (1, 0.3, -0.8), 'a': (U_L, rod(elev_net, yaw_net)), 'b': (BACK, (0.6, 0, 0.8))}}
    C['Fish_Net'] = [
        (0, net(-5, 14, (0.24, -0.30, -0.18), -4)),
        (9, net(-38, 10, (0.22, -0.40, -0.17), 9)),
        (14, net(-42, 8, (0.22, -0.42, -0.18), 11)),
        (20, net(-12, 6, (0.24, -0.38, -0.12), 4)),
        (25, net(28, 8, (0.26, -0.28, -0.06), -6)),
        (29, net(32, 8, (0.26, -0.27, -0.05), -7)),
    ]
    # 7) 일어나 두 손으로 받쳐 들고 보여 주기(2.5 s): 0~19 프레임은 Sit_Chair_StandUp의 다리·엉덩이
    show = []
    for f in range(0, 20):
        t = f / 19.0
        P = hold_fish(('Sit_Chair_StandUp', f), lift=-0.10 * (1 - t), fwd=0.0)
        show.append((f, P))
    show += [
        (26, hold_fish(STAND, lift=0.06, fwd=-0.04, rot={'head': [((1, 0, 0), 6)]})),
        (34, hold_fish(STAND, lift=0.08, fwd=-0.06, rot={'spine': [((0, 0, 1), -12)], 'head': [((1, 0, 0), 4), ((0, 0, 1), -6)]}, tilt=-6)),
        (44, hold_fish(STAND, lift=0.08, fwd=-0.06, rot={'spine': [((0, 0, 1), 12)], 'head': [((1, 0, 0), 4), ((0, 0, 1), 6)]}, tilt=-6)),
        (52, hold_fish(STAND, lift=0.07, fwd=-0.05, rot={'head': [((1, 0, 0), -4)]})),
        (60, hold_fish(STAND, lift=0.06, fwd=-0.04)),
    ]
    C['Fish_Stand_Show'] = show
    # 8) 놓아주기(0.8 s): 몸을 숙여 물에 내려놓고 손을 편 뒤 일어선다
    C['Fish_Release'] = [
        (0, hold_fish(STAND, lift=0.06, fwd=-0.04)),
        (7, hold_fish(STAND, lift=-0.10, fwd=-0.12, rot={'spine': [((1, 0, 0), 20)], 'chest': [((1, 0, 0), 12)], 'head': [((1, 0, 0), 6)]}, tilt=20)),
        (11, hold_fish(STAND, lift=-0.14, fwd=-0.14, spread=0.21, rot={'spine': [((1, 0, 0), 22)], 'chest': [((1, 0, 0), 13)], 'head': [((1, 0, 0), 6)]}, tilt=45)),
        (19, {'base': STAND}),
    ]
    # 9) 접은 대를 어깨에 메기(반복, 오른팔만): 손은 오른 어깨 앞, 대는 뒤-위-바깥으로
    def carry(dz):
        # 대는 앞-위로 비스듬히(대 끝이 앞으로): 팔뚝과 나란히 쥔 손목(옛 자세는 대를 뒤로 메어 손목이 120도 꺾였다)
        return {'base': STAND, 'R': arm_rod_r(None, 46 + dz * 400, -16, ua=(-0.22, -0.10 + dz * 12, -0.95))}
    C['Carry_Rod'] = [(0, carry(0)), (6.25, carry(-0.012)), (12.5, carry(0)), (18.75, carry(-0.012)), (25, carry(0))]
    return C


# ------------------------------------------------------------------ 동작 만들기
def write_action(name, keys, bones, length, cyclic):
    old = bpy.data.actions.get(name)
    if old:
        bpy.data.actions.remove(old)
    a = bpy.data.actions.new(name)
    a.use_fake_user = True
    a.use_frame_range = True
    a.frame_start = 0.0; a.frame_end = length
    a.use_cyclic = cyclic
    r = rig()
    r.animation_data.action = a   # fcurve_ensure_for_datablock은 동작이 걸려 있어야 한다(키 쓰는 동안 평가는 안 한다)
    prev = {}
    for b in bones:
        dp_l = f'pose.bones["{b}"].location'; dp_q = f'pose.bones["{b}"].rotation_quaternion'
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
    r.animation_data.action = None
    return a


def build():
    r = rig()
    ad = r.animation_data_create()
    use_nla = ad.use_nla
    ad.use_nla = False   # 손으로 놓는 포즈를 NLA 평가가 덮어쓰지 않게
    reset_pose(r)
    poses = clip_poses()
    for name, (length, cyclic, bones) in CLIPS.items():
        keys = []
        for frame, P in poses[name]:
            reset_pose(r)
            keys.append((frame, apply_pose(P)))
        if cyclic:
            # 반복 클립: 마지막 키 = 첫 키(이음매 없음)
            keys[-1] = (keys[-1][0], keys[0][1])
        write_action(name, keys, bones, length, cyclic)
        print('BUILT', name, len(keys), 'keys', length / FPS, 's')
    ad.use_nla = use_nla
    reset_pose(r)


# ------------------------------------------------------------------ 내보내기 + GLB 정리
def export(path):
    r = rig()
    reset_pose(r)
    sc = bpy.context.scene
    r.name = 'Rig__main'
    fr = r.copy()
    fr.name = 'Rig'
    sc.collection.objects.link(fr)
    fr.animation_data_clear()
    ad = fr.animation_data_create()
    for name in CLIPS:
        tr = ad.nla_tracks.new(); tr.name = name
        tr.strips.new(name, 0, bpy.data.actions[name])
        tr.mute = True
    ad.action = None
    reset_pose(fr)
    vl = bpy.context.view_layer
    for o in vl.objects:
        o.select_set(False)
    fr.hide_set(False); fr.hide_viewport = False; fr.select_set(True)
    vl.objects.active = fr
    os.makedirs(os.path.dirname(path), exist_ok=True)
    w = bpy.context.window_manager.windows[0] if bpy.context.window_manager.windows else None
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_animations=True,
              export_animation_mode='NLA_TRACKS', export_skins=True, export_morph=False, export_apply=False,
              export_yup=True, export_materials='NONE', export_def_bones=False, export_optimize_animation_size=True,
              export_optimize_animation_keep_anim_armature=True, export_reset_pose_bones=True)
    try:
        if w:
            with bpy.context.temp_override(window=w, screen=w.screen):
                bpy.ops.export_scene.gltf(**kw)
        else:
            bpy.ops.export_scene.gltf(**kw)
    finally:
        bpy.data.objects.remove(fr)
        r.name = 'Rig'
        reset_pose(r)
    prune_glb(path)
    return os.path.getsize(path)


def _read_glb(path):
    buf = open(path, 'rb').read()
    jl = struct.unpack_from('<I', buf, 12)[0]
    js = json.loads(buf[20:20 + jl].decode('utf8'))
    bl = struct.unpack_from('<I', buf, 20 + jl)[0]
    bin_ = buf[28 + jl:28 + jl + bl]
    return js, bin_


def _write_glb(path, js, bin_):
    jb = json.dumps(js, separators=(',', ':')).encode('utf8')
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    bin_ += b'\0' * ((4 - len(bin_) % 4) % 4)
    total = 12 + 8 + len(jb) + 8 + len(bin_)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(jb), 0x4E4F534A)); f.write(jb)
        f.write(struct.pack('<II', len(bin_), 0x004E4942)); f.write(bin_)


def prune_glb(path):
    """각 클립에서 그 클립의 뼈 목록 밖 트랙(IK·조절 뼈, Carry_Rod의 오른팔 밖)을 빼고 버퍼를 다시 묶는다."""
    js, bin_ = _read_glb(path)
    names = [n.get('name') for n in js['nodes']]
    for anim in js.get('animations', []):
        keep = set(CLIPS[anim['name']][2])
        chans = [c for c in anim['channels'] if names[c['target']['node']] in keep]
        used = sorted({c['sampler'] for c in chans})
        remap = {s: i for i, s in enumerate(used)}
        anim['samplers'] = [anim['samplers'][s] for s in used]
        for c in chans:
            c['sampler'] = remap[c['sampler']]
        anim['channels'] = chans
    used_acc = sorted({s[k] for a in js.get('animations', []) for s in a['samplers'] for k in ('input', 'output')})
    out = bytearray(); views = []; accs = []; amap = {}
    for i in used_acc:
        a = dict(js['accessors'][i]); v = js['bufferViews'][a['bufferView']]
        comp = {5126: 4, 5123: 2, 5125: 4, 5121: 1}[a['componentType']]
        width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
        n = a['count'] * comp * width
        start = v.get('byteOffset', 0) + a.get('byteOffset', 0)
        assert v.get('byteStride') in (None, comp * width)
        while len(out) % 4:
            out.append(0)
        views.append({'buffer': 0, 'byteOffset': len(out), 'byteLength': n})
        out += bin_[start:start + n]
        a['bufferView'] = len(views) - 1; a.pop('byteOffset', None)
        amap[i] = len(accs); accs.append(a)
    for a in js.get('animations', []):
        for s in a['samplers']:
            s['input'] = amap[s['input']]; s['output'] = amap[s['output']]
    js['accessors'] = accs; js['bufferViews'] = views
    js['buffers'] = [{'byteLength': len(out)}]
    # 메시가 없으니 스킨도 필요 없다(역바인드 행렬 접근자도 위에서 빠졌다)
    js.pop('skins', None)
    for n in js['nodes']:
        n.pop('skin', None)
    for k in ('meshes', 'materials', 'textures', 'images', 'samplers'):
        if k in js and not js[k]:
            js.pop(k)
    _write_glb(path, js, bytes(out))


def verify(path):
    """각 클립의 샘플러 출력이 시간에 따라 실제로 바뀌는지(얼어붙은 클립 방지)."""
    js, bin_ = _read_glb(path)
    names = [n.get('name') for n in js['nodes']]

    def floats(i):
        a = js['accessors'][i]; v = js['bufferViews'][a['bufferView']]
        w = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[a['type']]
        st = v.get('byteOffset', 0) + a.get('byteOffset', 0)
        return [struct.unpack_from('<f', bin_, st + 4 * k)[0] for k in range(a['count'] * w)], w
    report = {}
    for anim in js['animations']:
        moving = []; dur = 0.0
        for c in anim['channels']:
            s = anim['samplers'][c['sampler']]
            t, _ = floats(s['input']); dur = max(dur, t[-1])
            v, w = floats(s['output'])
            spread = max((abs(v[i] - v[i % w]) for i in range(w, len(v))), default=0.0)
            if c['target']['path'] == 'rotation' and spread > 0.02:
                moving.append(names[c['target']['node']])
        report[anim['name']] = (round(dur, 3), len(anim['channels']), sorted(set(moving)))
    return report


def store_self_text():
    src = globals().get('__file__')
    if src and os.path.exists(src):
        t = bpy.data.texts.get('fishing_anims') or bpy.data.texts.new('fishing_anims')
        t.clear(); t.write(open(src, encoding='utf8').read())


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    path = argv[argv.index('--export') + 1] if '--export' in argv else None
    build()
    if path:
        size = export(path)
        print('EXPORTED', path, size, 'bytes')
        for k, v in verify(path).items():
            print('VERIFY', k, 'dur', v[0], 'channels', v[1], 'rotating', len(v[2]), v[2])
    r = rig()
    reset_pose(r)
    assert r.data.pose_position == 'POSE' and (r.animation_data is None or r.animation_data.action is None)
    if '--save' in argv:
        store_self_text()
        reset_pose(r)
        bpy.ops.wm.save_mainfile()
        print('SAVED', bpy.data.filepath)


if __name__ == '__main__':
    main()
