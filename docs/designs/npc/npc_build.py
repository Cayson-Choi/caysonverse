# npc_build.py — 마을 NPC 3명(버스 기사·마을 안내원·낚시터 대여점 주인; 추모관 안내는 owner 2026-11-17에 뺐다)의 전용 옷·모자·소품과 동작을 만들어 npc.glb로 내보낸다.
#
#   "C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" -b art/character/cayson-toy.blend \
#       --python docs/designs/npc/npc_build.py -- --export client/public/models/npc.glb [--render <dir>] [--badge <png>]
#
# 블렌드는 저장하지 않는다(이 스크립트가 매번 처음부터 만든다). 원본 블렌드의 툴킷 텍스트 블록
# (toykit → toykit2 → parts2 → poke_test → stage2b)을 한 이름공간에 실행해 기존 부품과 같은 방식으로 만든다.
#
# 규칙(기억 노트 character-glb-export + 낚시 동작 fishing_anims.py와 같은 방식):
#  - 기존 'Rig' 뼈대 그대로(뼈 이름·순서가 character.glb와 같다): 클라이언트가 같은 Skeleton에 묶는다.
#  - NPC 부품 메시는 character.glb의 부품과 같은 이름 규칙(<slot>__npc_<id>)이고 고정색 재질만 쓴다(틴트 없음).
#    이 이름들은 character.manifest의 slots에 없으므로 조립실·옷장에 나오지 않는다(shared/src/village/npcLooks.ts).
#  - 내보내기 전과 끝에 반드시 pose_position='POSE', 활성 동작 없음, 모든 포즈 뼈 기본값.
#  - 내보낸 뒤 각 클립의 샘플러 출력이 실제로 바뀌는지 검사한다(얼어붙은 T-포즈 방지).
#
# 좌표(블렌더 뼈대 공간): +X = 캐릭터 왼쪽, -Y = 앞, +Z = 위. 캐릭터는 -Y를 본다(glTF에서 +Z).

import bpy, bmesh, math, os, sys, json, struct
from mathutils import Vector, Quaternion, Matrix

ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default=None):
    return ARGV[ARGV.index(name) + 1] if name in ARGV else default

NS = globals()
for _t in ('toykit', 'toykit2', 'parts2', 'poke_test', 'stage2b'):
    exec(compile(bpy.data.texts[_t].as_string(), _t, 'exec'), NS)

BLEND_DIR = os.path.dirname(bpy.data.filepath)
for im in bpy.data.images:   # 얼굴 텍스처가 옛 경로(D:/Codex/...)를 가리킨다: 블렌드 옆 textures/로
    if im.filepath and not os.path.exists(bpy.path.abspath(im.filepath)):
        cand = os.path.join(BLEND_DIR, 'textures', os.path.basename(im.filepath))
        if os.path.exists(cand):
            im.filepath = cand; im.reload()

FPS = 24

# ------------------------------------------------------------------ 재질(고정색, glTF baseColorFactor)
def hexc(h):
    return hex_lin(h)

def nmat(name, hx, rough=0.5):
    return material(name, hexc(hx), rough)

def M():
    return dict(
        sky=nmat('npc_shirt_sky', '#B9D6EE', 0.55),     # 기사 셔츠: 옅은 하늘색
        navy=nmat('npc_navy', '#22305A', 0.5),          # 기사 넥타이·바지·견장·모자
        gold=nmat('npc_gold', '#D9AE45', 0.3),
        white=nmat('npc_white', '#F5F5F1', 0.45),       # 흰 장갑·셔츠
        black=nmat('npc_black', '#17181C', 0.35),       # 모자 챙·띠, 리본
        silver=nmat('npc_silver', '#C3C8CF', 0.3),      # 명찰
        red=nmat('npc_red', '#D9262E', 0.5),            # 안내원 조끼·모자
        cream=nmat('npc_cream', '#F7F3EA', 0.55),       # 안내원 셔츠
        slate=nmat('npc_slate', '#3B4250', 0.55),       # 안내원 바지
        suit=nmat('npc_suit', '#2A2D35', 0.9),          # 추모관 정장(무광 모직, 어두운 홀에서도 주름·깃이 보이게 아주 검지는 않게)
        suit_lapel=nmat('npc_suit_lapel', '#31343D', 0.9),
        pocket_sq=nmat('npc_pocket_sq', '#FBFBF8', 0.8),
        olive_mesh=nmat('npc_olive_mesh', '#5E5F35', 0.8),
        reflect=nmat('npc_reflect', '#D9DEE3', 0.3),
        lure=nmat('npc_lure', '#E2462F', 0.3),
        zipper=nmat('npc_zipper', '#2A2B22', 0.4),
        beige_dark=nmat('npc_beige_dark', '#A8956C', 0.85),
        tie=nmat('npc_tie', '#0F1013', 0.4),
        wood=nmat('npc_board', '#8A5A35', 0.55),        # 클립보드 판
        paper=nmat('npc_paper', '#FBFBF7', 0.6),
        ink=nmat('npc_ink', '#4B4FD8', 0.5),            # 안내지의 마을색 줄
        lanyard=nmat('npc_lanyard', '#2F3B8F', 0.5),
        olive=nmat('npc_olive', '#6B6B3A', 0.6),        # 낚시 조끼
        olive_dark=nmat('npc_olive_dark', '#45462A', 0.6),
        brass=nmat('npc_brass', '#B08A3E', 0.35),
        towel=nmat('npc_towel', '#F4F2EC', 0.7),
        towel_blue=nmat('npc_towel_blue', '#3E6FB8', 0.6),
        shirt_grey=nmat('npc_shirt_grey', '#9AA7B4', 0.6),
        khaki=nmat('npc_khaki', '#5B5446', 0.6),
        beige=nmat('npc_beige', '#CDBB93', 0.65),
    )

# ------------------------------------------------------------------ 공통
def copy_part(src, name, mats, slot, pid):
    """기존 부품을 복사(같은 지오메트리·가중치)하고 재질만 바꾼다."""
    s = bpy.data.objects[src]
    old = bpy.data.objects.get(name)
    if old: bpy.data.objects.remove(old, do_unlink=True)
    ob = s.copy(); ob.data = s.data.copy(); ob.name = name; ob.data.name = name
    coll().objects.link(ob)
    ob.data.materials.clear()
    for m in mats: ob.data.materials.append(m)
    for p in ob.data.polygons: p.material_index = 0
    for k in list(ob.keys()): del ob[k]
    tag(ob, slot, pid, False)
    return ob

def inflate(ob, d):
    me = ob.data
    me.update()
    for v in me.vertices: v.co += v.normal * d

def join_into(dst, srcs):
    with bpy.context.temp_override(active_object=dst, object=dst, selected_objects=[dst] + srcs, selected_editable_objects=[dst] + srcs):
        bpy.ops.object.join()
    return dst

def gloves(name, mat, d=0.007, cut=0.700):
    """흰 장갑: 손 메시(가중치째)에서 손목 바깥(|x| > cut)만 남겨 d만큼 부풀린 껍데기 + 손목 둘레의 접힌 단."""
    g = copy_part('body__hands', name, [mat], 'top', 'gloves')
    bm = bmesh.new(); bm.from_mesh(g.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if abs(v.co.x) < cut], context='VERTS')
    bm.to_mesh(g.data); bm.free()
    inflate(g, d)
    cuffs = []
    for s in (1, -1):
        vs = [g.matrix_world @ v.co for v in g.data.vertices if s * v.co.x > 0 and abs(v.co.x) < cut + 0.02]
        if not vs: continue
        c = sum(vs, Vector()) / len(vs)
        r = max(math.hypot(v.y - c.y, v.z - c.z) for v in vs)
        b = torus_bm(r + 0.004, 0.012, segs=24, rsegs=8)
        b = xform(b, Matrix.Translation((s * (cut + 0.010), c.y, c.z)) @ Matrix.Rotation(math.radians(90), 4, 'Y'))
        cob = new_obj(name + ('_cuff_l' if s > 0 else '_cuff_r'), b, [mat])
        skin(cob, rigid='wrist.' + ('l' if s > 0 else 'r'))
        cuffs.append(cob)
    join_into(g, cuffs)
    return g

def flare(bm, z0, z1, k_out, zf, kf):
    """모자 크라운: z0 위를 바깥으로 벌리고(위로 갈수록 k_out까지), zf 위의 둥근 꼭대기는 kf로 눌러 납작하게(머리를 뚫지 않게 zf는 머리 꼭대기 위)."""
    for v in bm.verts:
        if v.co.z <= z0: continue
        t = smoothstep(z0, z1, v.co.z)
        rx, ry = v.co.x - HC.x, v.co.y - HC.y
        v.co.x = HC.x + rx * (1 + k_out * t); v.co.y = HC.y + ry * (1 + k_out * t)
        if v.co.z > zf: v.co.z = zf + (v.co.z - zf) * kf
    return bm

def disc_bm(r, t, segs=20):
    """앞(-Y)을 보는 납작한 원판."""
    b = ellipsoid_bm(r, t / 2, r, segs=segs, rings=8)
    return b

def i_mark_bm(h=0.07):
    """안내 표시 'i'(점 + 기둥), 앞(-Y)을 보는 납작한 조각."""
    stem = poly_slab_bm([(-0.011 * h / 0.07, -h / 2), (0.011 * h / 0.07, -h / 2), (0.011 * h / 0.07, h * 0.18), (-0.011 * h / 0.07, h * 0.18)], depth=0.006, bulge=0.001, round_k=1)
    dot = move_bm(ellipsoid_bm(0.013 * h / 0.07, 0.003, 0.013 * h / 0.07, segs=12, rings=6), (0, 0, h * 0.36))
    return merge_bms([stem, dot])

def orient_front(bm, nrm, center, spin=0.0):
    """앞(-Y)을 보며 만든 조각을 법선 nrm 방향으로 세워 center에 둔다(위는 되도록 +Z)."""
    n = Vector(nrm).normalized()
    q = Vector((0, -1, 0)).rotation_difference(n)
    up = q @ Vector((0, 0, 1))
    zp = Vector((0, 0, 1)) - n * n.dot(Vector((0, 0, 1)))
    if zp.length > 1e-6:
        ang = up.angle(zp.normalized())
        if up.cross(zp.normalized()).dot(n) < 0: ang = -ang
        q = Quaternion(n, ang) @ q
    q = Quaternion(n, spin) @ q
    return xform(bm, Matrix.Translation(Vector(center)) @ q.to_matrix().to_4x4())

def surf(bvh, origin, direction):
    hit, nrm, idx, dist = bvh.ray_cast(Vector(origin), Vector(direction).normalized(), 5.0)
    if hit is None: return None, None
    n = nrm.normalized()
    if n.dot(Vector(direction)) > 0: n = -n
    return hit, n

# ------------------------------------------------------------------ v2(owner 2026-11-16 "절대로 허접해 보이면 안되고 디테일을 잘 살리도록 해"): 옷감·바느질·단추
# 옷감 재질: 정점색(부품의 색) × 흰 바탕, 타일 노멀 맵(울 능직·면 평직·폴리 립스톱·메시·타월·캔버스), 무광 거칠기.
# 단단한 것(단추·금속·리본·명찰·챙)은 그대로 고정색 재질(클라이언트가 합친 메시로 그린다).
FABRIC_OF = {
    'npc_shirt_sky': 'cotton', 'npc_navy': 'wool', 'npc_white': 'cotton', 'npc_red': 'poly', 'npc_cream': 'cotton',
    'npc_suit': 'wool', 'npc_tie': 'wool', 'npc_lanyard': 'poly', 'npc_olive': 'poly', 'npc_olive_dark': 'poly',
    'npc_olive_mesh': 'mesh', 'npc_towel': 'terry', 'npc_towel_blue': 'terry', 'npc_shirt_grey': 'cotton', 'npc_beige': 'canvas',
    'npc_beige_dark': 'canvas', 'npc_suit_lapel': 'wool', 'npc_pocket_sq': 'cotton',
}
# 옷감별 (거칠기, 노멀 세기, 타일 한 칸의 길이 m)
FABRIC = {
    'wool': (0.93, 0.55, 0.050), 'cotton': (0.86, 0.45, 0.045), 'poly': (0.62, 0.45, 0.060),
    'mesh': (0.80, 0.90, 0.050), 'terry': (0.97, 0.85, 0.060), 'canvas': (0.90, 0.60, 0.050),
}
FAB_DIR = None

def fabric_material(kind):
    name = 'npcfab_' + kind
    m = bpy.data.materials.get(name)
    if m: return m
    rough, strength, _ = FABRIC[kind]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = 0.0
    col = nt.nodes.new('ShaderNodeVertexColor'); col.layer_name = 'Col'
    nt.links.new(col.outputs['Color'], bsdf.inputs['Base Color'])
    img = bpy.data.images.load(os.path.join(FAB_DIR, 'fab_%s_n.jpg' % kind), check_existing=True)
    img.colorspace_settings.name = 'Non-Color'
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img
    uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'UVMap'
    nt.links.new(uvn.outputs['UV'], tex.inputs['Vector'])
    nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = strength
    nt.links.new(tex.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    return m

def base_color_of(mat):
    b = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    return tuple(b.inputs['Base Color'].default_value)

def fabricize(ob):
    """부품의 옷감 면을 옷감 재질로(색은 정점색 'Col'), UV는 세계 크기 상자 투영(타일 한 칸 = FABRIC의 길이)."""
    me = ob.data
    mats = [s.material for s in ob.material_slots]
    if not any(m and m.name in FABRIC_OF for m in mats): return
    col = me.color_attributes.get('Col') or me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    if not me.uv_layers: me.uv_layers.new(name='UVMap')
    uv = me.uv_layers[0]; uv.name = 'UVMap'
    new_slots = []; slot_of = {}
    def slot(m):
        if m.name not in slot_of:
            slot_of[m.name] = len(new_slots); new_slots.append(m)
        return slot_of[m.name]
    me.update()
    assign = []
    for p in me.polygons:
        src = mats[p.material_index]
        kind = FABRIC_OF.get(src.name) if src else None
        c = base_color_of(src) if src else (1, 1, 1, 1)
        for li in p.loop_indices:
            col.data[li].color = (c[0], c[1], c[2], 1.0)
        if kind:
            tile = FABRIC[kind][2]
            for li in p.loop_indices:
                vx = me.vertices[me.loops[li].vertex_index]
                n = vx.normal; ax = max(range(3), key=lambda i: abs(n[i]))
                a, b = [(1, 2), (0, 2), (0, 1)][ax]
                uv.data[li].uv = (vx.co[a] / tile, vx.co[b] / tile)
            assign.append(slot(fabric_material(kind)))
        else:
            assign.append(slot(src))   # 단단한 면의 UV는 그대로(명찰 그림이 쓴다)
    me.materials.clear()
    for m in new_slots: me.materials.append(m)
    for p, i in zip(me.polygons, assign): p.material_index = i
    me.color_attributes.active_color = col
    print('FABRIC', ob.name, [m.name for m in new_slots])

def weights_from_cloth(top, mat_names):
    """명찰처럼 나중에 붙인 단단한 조각이 옷 표면과 같이 움직이게: 그 조각의 정점마다 가장 가까운 옷 정점의 뼈 가중치를 그대로 쓴다
    (가슴 뼈에만 묶으면 숨쉬기·인사 때 옷이 앞으로 나와 조각이 옷 속에 묻힌다)."""
    from mathutils.kdtree import KDTree
    me = top.data
    idx = {i for i, s_ in enumerate(top.material_slots) if s_.material and s_.material.name in mat_names}
    mine = set()
    for p_ in me.polygons:
        if p_.material_index in idx: mine.update(p_.vertices)
    others = [v for v in me.vertices if v.index not in mine]
    kd = KDTree(len(others))
    for k, v in enumerate(others): kd.insert(v.co, k)
    kd.balance()
    for vi in mine:
        v = me.vertices[vi]
        _, k, _ = kd.find(v.co)
        src = others[k]
        for g in list(v.groups): top.vertex_groups[g.group].remove([vi])
        for g in src.groups: top.vertex_groups[g.group].add([vi], g.weight, 'REPLACE')

def badge_card(top, img, p, n, w, h, lift, name, mat_name):
    """명찰 앞면: 텍스처를 붙인 얇은 판(가슴에 단단히). top에 합친다."""
    card = bmesh.new()
    uvn = top.data.uv_layers[0].name if len(top.data.uv_layers) else 'UVMap'
    uv = card.loops.layers.uv.new(uvn)
    vs = [card.verts.new((x, 0, z)) for x, z in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2))]
    f = card.faces.new(vs)
    for loop, (u, v) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uv].uv = (u, v)
    if f.normal.y > 0: f.normal_flip()
    card = orient_front(card, n, p + n * lift)
    bmat = material(mat_name, (1, 1, 1, 1), 0.5, image=img)
    nt = bmat.node_tree
    uvnode = nt.nodes.get('UVN') or nt.nodes.new('ShaderNodeUVMap'); uvnode.name = 'UVN'; uvnode.uv_map = uvn
    nt.links.new(uvnode.outputs['UV'], nt.nodes['Tex'].inputs['Vector'])
    cob = new_obj(name, card, [bmat])
    skin(cob, rigid='chest')
    join_into(top, [cob])

def visor_bm(zb, off, L=0.12, droop_deg=38, span_deg=72, thick=0.012, nu=24, nv=5):
    """정모 챙: 띠 아래 머리 둘레에서 앞으로 나와 아래로 휘는 얇은 껍데기(옆으로 갈수록 짧게). 정면에서도 면으로 보인다."""
    def P(u, v, lower=False):
        az = math.radians(lerp(-span_deg, span_deg, u))
        base = head_ring_pt(az, zb, off)
        radial = Vector((base.x - HC.x, base.y - HC.y, 0)).normalized()
        l = L * (math.cos(az * 90 / span_deg * math.pi / 180) ** 0.6)
        t = v
        dro = math.radians(droop_deg) * (0.35 + 0.65 * t)
        p = base + radial * (l * t * math.cos(dro)) + Vector((0, 0, -l * t * math.sin(dro) - 0.004))
        if lower: p += Vector((0, 0, -thick))
        return p
    return grid_solid_bm(lambda u, v: P(u, v), nu, nv, closed_u=False, thick=lambda u, v: P(u, v, True))

def crown_bm(zb, ztop, off, flare_k=0.04, round_r=0.05, segs=48, rows=14, inner=0.012):
    """벙거지 크라운: 머리 둘레(zb)에서 거의 곧게 올라가 위가 살짝 넓고, 꼭대기는 둥근 모서리의 납작한 판(부드러운 면 모자)."""
    def ring_r(az, z, o):
        p = head_ring_pt(az, zb, o)
        return Vector((p.x - HC.x, p.y - HC.y, 0)).length
    H = ztop - zb
    def P(u, v, o):
        az = 2 * math.pi * u
        r0 = ring_r(az, zb, o) * (1 + flare_k * v)
        # 옆면(곧게) → 둥근 모서리 → 윗면(가운데로)
        side = H - round_r
        s_len = side + round_r * math.pi / 2 + r0 - round_r
        d = v * s_len
        if d <= side:
            r, z = r0, zb + d
        elif d <= side + round_r * math.pi / 2:
            a = (d - side) / round_r
            r, z = r0 - round_r + round_r * math.cos(a), zb + side + round_r * math.sin(a)
        else:
            r, z = max(0.0, r0 - round_r - (d - side - round_r * math.pi / 2)), ztop
        dirv = Vector((math.sin(az), -math.cos(az), 0))
        return Vector((HC.x, HC.y, 0)) + dirv * r + Vector((0, 0, z))
    return grid_solid_bm(lambda u, v: P(u, v, off), segs, rows, closed_u=True, thick=lambda u, v: P(u, v, off - inner) - Vector((0, 0, inner)) * (1 if v > 0.6 else 0))

def vest_shirt(x0=0.28):
    """조끼 안의 셔츠: shirt_base와 같되 소매가 어깨 바깥(x0)에서 시작해 조끼 어깨선을 뚫고 나오지 않는다."""
    pr, trunk = trunk_from(TEE_PROF, 1.0, segs=24, step=0.05)   # 조끼 밑이라 대부분 가려진다: 가볍게
    sleeves = sleeve_bms(r=0.147, x0=x0, segs=20)
    cuffs = sleeve_cuff_bm(0.415, 0.143, 0.024, rr=0.016)
    collar = collar_bm(R=0.150, r=0.046, z=1.228)
    cb = merge_bms([trunk.copy(), collar_bm(R=0.150, r=0.046, z=1.228)])
    bv = bvh_of_bms([cb])[0]; cb.free()
    flaps = collar_flaps_bm(bv)
    parts = [grp(setmat(trunk, 0), 1)] + [grp(setmat(x, 0), 2) for x in sleeves + cuffs] + [grp(setmat(collar, 0), 3)] + [grp(setmat(f, 0), 3) for f in flaps]
    return pr, trunk, parts

def stitch_ring_bm(pts, r=0.0022):
    """바느질 줄: 표면 위 아주 가는 관(고리)."""
    return tube_bm(pts + [pts[0]], [r] * (len(pts) + 1), segs=3, capn=0)


# ------------------------------------------------------------------ 1. 버스 기사
def build_driver(m):
    # 웃옷: 옅은 하늘색 셔츠 + 남색 넥타이 + 견장(금줄) + 가슴 주머니 + 은색 명찰 + 흰 장갑
    pr, trunk, shirt = shirt_base()
    parts = []
    bv = bvh_of_bms([trunk])
    knot = poly_slab_bm([(-0.046, 0.0), (0.046, 0.0), (0.030, -0.066), (-0.030, -0.066)], depth=0.034, bulge=0.010, round_k=2)
    knot = stick(knot, bv[0], (0, -1.5, 1.175), (0, 1, 0), lift=0.020)
    def blade(u, v):
        w = lerp(0.056, 0.110, smoothstep(0.0, 0.85, v))
        if v > 0.88: w *= max(0.0, (1 - (v - 0.88) / 0.12)) ** 0.9
        return (lerp(-w / 2, w / 2, u), lerp(1.115, 0.70, v))
    bl = front_slab_bm(bv, blade, 4, 18, 0.016, 0.006, puff=0.004)
    clip = front_slab_bm(bv, lambda u, v: (lerp(-0.045, 0.045, u), lerp(0.93, 0.95, v)), 3, 2, 0.026, 0.014)
    parts += [grp(setmat(knot, 1), 3), grp(setmat(bl, 1), 1), grp(setmat(clip, 2), 1)]
    # 가슴 주머니(왼쪽 가슴 = +X)와 덮개, 단추
    for s in (1,):
        pk = front_slab_bm(bv, lambda u, v: (s * 0.165 + lerp(-0.065, 0.065, u), lerp(0.86, 0.98, v)), 5, 4, 0.008, 0.002, puff=0.006)
        fl = front_slab_bm(bv, lambda u, v: (s * 0.165 + lerp(-0.070, 0.070, u), lerp(0.96, 1.005, v)), 5, 2, 0.016, 0.008, puff=0.003)
        bt = stick_on(button_bm(0.011, 0.008), bv[0], (s * 0.165, 0, 0.975), (0, 1, 0), lift=0.018)
        parts += [lay(grp(setmat(pk, 0), 1), 2), lay(grp(setmat(fl, 0), 1), 2), grp(setmat(bt, 0), 1)]
    # 은색 명찰(오른쪽 가슴 = -X)
    plate = front_slab_bm(bv, lambda u, v: (-0.165 + lerp(-0.062, 0.062, u), lerp(0.945, 0.985, v)), 4, 2, 0.014, 0.006)
    stripe = front_slab_bm(bv, lambda u, v: (-0.165 + lerp(-0.058, 0.058, u), lerp(0.953, 0.962, v)), 4, 1, 0.017, 0.010)
    parts += [grp(setmat(plate, 3), 1), grp(setmat(stripe, 1), 1)]
    # 단추 줄(앞여밈, 넥타이 아래로 보이는 것만)
    for z in (0.64, 0.565):
        parts.append(grp(setmat(stick_on(button_bm(0.012, 0.008), bv[0], (0.0, 0, z), (0, 1, 0), lift=0.008), 3), 1))
    # 앞단(플래킷) 두 줄 바느질
    for dx in (-0.022, 0.022):
        pp, nn = project_path(bv, [Vector((dx, -0.8, z)) for z in (0.70, 0.64, 0.58, 0.52)], 0.004, axis_c=lambda q: (q.x, 0.0, q.z))
        parts.append(grp(setmat(tube_bm(pp, [0.0022] * len(pp), segs=5, capn=1), 0), 1))
    # 견장: 어깨 위 남색 판 + 금줄 두 개 + 단추
    for s in (1, -1):
        pad = rbox_bm(0.20, 0.085, 0.022, 0.010, cuts=3)
        pad = xform(pad, Matrix.Translation((s * 0.300, 0.0, 1.262)) @ Matrix.Rotation(math.radians(-s * 13), 4, 'Y'))
        parts.append(grp(setmat(pad, 1), 2))
        for k, dx in enumerate((0.055, 0.085)):
            st = rbox_bm(0.010, 0.088, 0.008, 0.003, cuts=1)
            st = xform(st, Matrix.Translation((s * (0.300 + dx), 0.0, 1.262 + 0.015 - dx * math.tan(math.radians(13)))) @ Matrix.Rotation(math.radians(-s * 13), 4, 'Y'))
            parts.append(grp(setmat(st, 2), 2))
        btn = move_bm(ellipsoid_bm(0.015, 0.015, 0.008, segs=10, rings=5), (s * 0.215, 0.0, 1.290))
        parts.append(grp(setmat(btn, 2), 2))
    # 벨트(셔츠 밑단 위, 바지 허리와 만나는 곳)
    a_, b_ = prof_at(pr, 0.505)
    belt = se_ring_bm(0.505, a_ + 0.006, b_ + 0.006, 2.5, 0.010, 0.022, segs=56, rsegs=8)
    buckle = stick_on(rbox_bm(0.060, 0.012, 0.040, 0.006, cuts=2), bv[0], (0.0, 0, 0.505), (0, 1, 0), lift=0.020)
    parts += [grp(setmat(belt, 4), 1), grp(setmat(buckle, 3), 1)]
    top = finish_top('top__npc_driver', 'npc_driver', parts, [m['sky'], m['navy'], m['gold'], m['silver'], m['black']], target=2100, dec_parts=shirt)
    g = gloves('_npc_driver_gloves', m['white'])
    join_into(top, [g])
    tag(top, 'top', 'npc_driver', False)
    # 모자: 남색 정모 — 위가 넓은 크라운, 검은 띠, 검은 챙, 금 끈, 금 휘장(바퀴 모양, 글자·로고 없음)
    zb = RIM + 0.004
    dome = flare(dome_bm(zb, 0.070, segs=44, rows=14, top_extra=0.0), zb + 0.07, zb + 0.24, 0.14, 2.19, 0.35)
    band = ring_follow_bm(zb + 0.040, 0.076, 0.010, 0.040, segs=56, rsegs=8)
    front = head_ring_pt(0.0, zb + 0.004, 0.074)
    visor = visor_bm(zb + 0.002, 0.080, L=0.115, droop_deg=40, span_deg=70)
    cord = []
    for k in range(13):
        az = math.radians(lerp(-55, 55, k / 12))
        cord.append(head_ring_pt(az, zb + 0.012, 0.090))
    cord = tube_bm(cord, [0.008] * len(cord), segs=8, capn=2)
    tmpb = merge_bms([dome.copy(), band.copy()]); hb = bvh_of_bms([tmpb])[0]; tmpb.free()
    p, n = surf(hb, (0, -1.5, zb + 0.040), (0, 1, 0))
    emb = []
    if p is not None:
        ring = torus_bm(0.034, 0.008, segs=20, rsegs=6)
        ring = xform(ring, Matrix.Rotation(math.radians(90), 4, 'X'))
        spokes = []
        for k in range(6):
            a = math.pi * k / 3
            sp = rbox_bm(0.006, 0.006, 0.056, 0.002, cuts=1)
            spokes.append(xform(sp, Matrix.Rotation(a, 4, 'Y')))
        hub = ellipsoid_bm(0.012, 0.006, 0.012, segs=10, rings=5)
        wing = []
        for s in (1, -1):
            w_ = poly_slab_bm([(s * 0.040, 0.004), (s * 0.095, 0.020), (s * 0.090, 0.004), (s * 0.075, -0.010), (s * 0.040, -0.012)], depth=0.006, bulge=0.002, round_k=1)
            wing.append(w_)
        e = merge_bms([ring, hub] + spokes + wing)
        emb = [orient_front(e, n, p + n * 0.012)]
        finish_hat('hat__npc_driver_cap', 'npc_driver_cap',
               [setmat(dome, 0), setmat(band, 1), setmat(visor, 1), setmat(cord, 2)] + [setmat(x, 2) for x in emb],
               [m['navy'], m['black'], m['gold']], target=1150)

# ------------------------------------------------------------------ 2. 마을 안내원
def build_guide(m, badge_img):
    # 웃옷: 크림 셔츠 + 빨간 안내 조끼(V 앞, 흰 테, 주머니) + 가슴 'i' 표시 + 등 큰 'i' 원 + 목걸이 명찰 "안내원"
    pr, trunk, sparts = vest_shirt()
    rows = [r for r in resample_prof(scaled_prof(TEE_PROF, 1.0), 0.03) if 0.47 <= r[0] <= 1.17 and r[1] > 1e-6]
    def gap(z): return 0.060 + 0.12 * smoothstep(0.78, 1.17, z)
    def V(u, v, k):
        z = lerp(0.470, 1.170, v)
        a_, b_ = prof_at(rows, z)
        a_ *= k; b_ *= k
        g = min(0.95, gap(z) / a_)
        th0 = -math.pi / 2 + math.asin(g)
        th = th0 + u * (2 * math.pi - 2 * math.asin(g))
        x, y = se(th, a_, b_, 2.5)
        return Vector((x, y, z))
    KV = lambda v, k: k + 0.040 * smoothstep(0.62, 1.0, v)   # 어깨 쪽은 소매 윗부분을 덮도록 더 부풀린다
    vest = grid_solid_bm(lambda u, v: V(u, v, KV(v, 1.055)), 48, 13, closed_u=False, thick=lambda u, v: V(u, v, KV(v, 1.020)))
    vb = bvh_of_bms([vest])
    parts = []
    rim = []
    for s in (1, -1):
        pts = [V(0.0 if s > 0 else 1.0, v / 12, KV(v / 12, 1.040)) for v in range(12)]
        rim.append(grp(setmat(tube_bm(pts, [0.013] * len(pts), segs=8, capn=2), 4), 1))
    a_, b_ = prof_at(rows, 0.475)
    hemrows = [V(u / 40, 0.0, 1.040) for u in range(41)]
    rim.append(grp(setmat(tube_bm(hemrows, [0.012] * len(hemrows), segs=8, capn=2), 4), 1))
    toprow = [V(u / 48, 1.0, KV(1.0, 1.040)) for u in range(49)]
    rim.append(grp(setmat(tube_bm(toprow, [0.014] * len(toprow), segs=8, capn=2), 4), 1))
    for s in (1, -1):   # 진동 둘레(소매가 나오는 곳) 바이어스: 셔츠 소매와 조끼가 만나는 선을 깔끔하게
        ring = xform(torus_bm(0.150, 0.016, segs=32, rsegs=8), Matrix.Translation((s * 0.318, 0.0, 1.107)) @ Matrix.Rotation(math.radians(90), 4, 'Y'))
        rim.append(grp(setmat(ring, 1), 2))   # 조끼색: 소매와 만나는 선이 흰 줄로 튀지 않게
    # 아래 주머니 두 개(덮개 + 흰 테)
    for s in (1, -1):
        zc, w, h = 0.64, 0.15, 0.13
        pk = front_slab_bm(vb, lambda u, v, s=s: (s * 0.175 + lerp(-w / 2, w / 2, u), zc + lerp(-h / 2, h / 2, v)), 6, 5, 0.010, 0.002, puff=0.010)
        flap = front_slab_bm(vb, lambda u, v, s=s: (s * 0.175 + lerp(-w / 2 - 0.008, w / 2 + 0.008, u), zc + h / 2 + lerp(-0.038, 0.004, v)), 6, 2, 0.022, 0.010, puff=0.004)
        parts += [lay(grp(setmat(pk, 1), 1), 2), lay(grp(setmat(flap, 1), 1), 2)]
    # 반사 띠(은회색, 위아래 가는 빨간 테 사이): 허리 높이로 앞 양쪽과 등에
    for zc in (0.735,):
        for sgn in (1, -1):
            band_f = front_slab_bm(vb, lambda u, v, sgn=sgn: (sgn * lerp(0.085, 0.29, u), zc + lerp(-0.020, 0.020, v)), 10, 2, 0.008, 0.003)
            parts.append(lay(grp(setmat(band_f, 5), 1), 2))
        band_b = front_slab_bm(vb, lambda u, v: (lerp(-0.29, 0.29, u), zc + lerp(-0.020, 0.020, v)), 18, 2, 0.008, 0.003, direction=Vector((0, -1, 0)))
        parts.append(lay(grp(setmat(band_b, 5), 1), 2))
    # 왼쪽 가슴(+X) 흰 원 + 빨간 i
    p, n = surf(vb[0], (0.19, -1.5, 0.96), (0, 1, 0))
    if p is not None:
        parts.append(grp(setmat(orient_front(disc_bm(0.050, 0.010), n, p + n * 0.010), 4), 1))
        parts.append(grp(setmat(orient_front(i_mark_bm(0.062), n, p + n * 0.018), 1), 1))
    # 등: 큰 흰 원 + 빨간 i
    p, n = surf(vb[0], (0.0, 1.5, 0.86), (0, -1, 0))
    if p is not None:
        parts.append(grp(setmat(orient_front(disc_bm(0.120, 0.012), n, p + n * 0.010), 4), 1))
        parts.append(grp(setmat(orient_front(i_mark_bm(0.150), n, p + n * 0.020), 1), 1))
    # 목걸이 끈(남색): 목 뒤에서 앞으로 내려와 가슴 가운데 명찰로
    bvs = bvh_of_bms([trunk] + [collar_bm(R=0.150, r=0.046, z=1.228)])
    lan = []
    for s in (1, -1):
        path = [Vector((s * x, -0.6, z)) for x, z in ((0.120, 1.205), (0.100, 1.150), (0.075, 1.090), (0.050, 1.030), (0.030, 0.985))]
        pp, nn = project_path(bvs, path, 0.012, axis_c=lambda q: (q.x, 0.0, q.z))
        lan.append(grp(setmat(flat_strip_bm(pp, nn, 0.020, 0.006, rsegs=6), 2), 3))
    neck = []
    for k in range(17):
        az = math.radians(lerp(-120, 120, k / 16)) + math.pi
        neck.append(Vector((0.165 * math.sin(az), -0.01 - 0.150 * math.cos(az) * -1, 1.215)))
    lan.append(grp(setmat(tube_bm(neck, [0.010] * len(neck), segs=6, capn=2), 2), 3))
    # 명찰 판(흰 테두리) — 앞면은 텍스처 카드(따로, 아래 badge_card)
    p, n = surf(bvs[0], (0.0, -1.5, 0.905), (0, 1, 0))
    holder = None
    if p is not None:
        holder = orient_front(rbox_bm(0.150, 0.012, 0.112, 0.012, cuts=3), n, p + n * 0.016)
        clipb = orient_front(rbox_bm(0.028, 0.010, 0.024, 0.004, cuts=1), n, p + n * 0.018 + Vector((0, 0, 0.066)))
        lan += [grp(setmat(holder, 4), 3), grp(setmat(clipb, 3), 3)]
    body = [lay(grp(setmat(trunk, 0), 1), 1)] + [setmat(b, 0) for b in sparts if b is not trunk] + [lay(grp(setmat(vest, 1), 1), 2)]
    # 줄이지 않는다(target을 넉넉히): 줄이면 조끼의 열린 가장자리가 톱니처럼 깨진다
    top = finish_top('top__npc_guide', 'npc_guide', parts + rim + lan, [m['cream'], m['red'], m['lanyard'], m['silver'], m['white'], m['reflect']], target=3900, dec_parts=body)
    # 명찰 카드: 텍스처(“안내원”)를 붙인 얇은 판. 한 메시라 별도 그리기 1회.
    if p is not None and badge_img is not None:
        card = bmesh.new()
        uvn = top.data.uv_layers[0].name if len(top.data.uv_layers) else 'UVMap'
        uv = card.loops.layers.uv.new(uvn)
        w, h = 0.128, 0.090
        vs = [card.verts.new((x, 0, z)) for x, z in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2))]
        f = card.faces.new(vs)
        for loop, (u, v) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            loop[uv].uv = (u, v)
        # 앞이 -Y를 보게(법선 -Y)
        if f.normal.y > 0: f.normal_flip()
        card = orient_front(card, n, p + n * 0.0235)
        bmat = material('npc_badge', (1, 1, 1, 1), 0.5, image=badge_img)
        nt = bmat.node_tree
        uvnode = nt.nodes.get('UVN') or nt.nodes.new('ShaderNodeUVMap'); uvnode.name = 'UVN'; uvnode.uv_map = uvn
        nt.links.new(uvnode.outputs['UV'], nt.nodes['Tex'].inputs['Vector'])
        cob = new_obj('top__npc_guide_badge', card, [bmat])
        skin(cob, rigid='chest')
        tag(cob, 'top', 'npc_guide', False)
        join_into(top, [cob])
        tag(top, 'top', 'npc_guide', False)
        print('GUIDE UV', [l.name for l in top.data.uv_layers])
    # 모자: 빨간 면 안내원 모자(서울 '움직이는 관광안내소' 모자처럼) — 부드러운 크라운에 가운데 접힘, 챙은 넓고 옆이 살짝 올라감,
    # 흰 띠와 바느질 줄, 앞 흰 원 'i'
    zb = RIM + 0.004
    crown = crown_bm(zb, 2.225, 0.075, flare_k=-0.02, round_r=0.13)
    for v in crown.verts:                       # 위 가운데 앞뒤로 살짝 눌린 접힘(카우보이 모자 결)
        if v.co.z > 2.17:
            v.co.z -= 0.028 * math.exp(-((v.co.x - HC.x) / 0.07) ** 2) * smoothstep(2.17, 2.22, v.co.z)
    def ringr(az):
        q = head_ring_pt(az, zb, 0.075)
        return Vector((q.x - HC.x, q.y - HC.y, 0)).length
    def brimP(u, v, lower=False):
        az = 2 * math.pi * u
        r0 = ringr(az) - 0.004
        L = 0.165 + 0.020 * math.cos(az) ** 2
        side = abs(math.sin(az))
        dro = math.radians(lerp(8, 18, v)) * (1 - 0.9 * side)
        lift = 0.030 * side * v ** 1.6         # 옆은 살짝 올라간 챙
        d = Vector((math.sin(az), -math.cos(az), 0))
        p_ = Vector((HC.x, HC.y, zb + 0.006)) + d * (r0 + L * v * math.cos(dro)) + Vector((0, 0, -L * v * math.sin(dro) + lift))
        if lower: p_ += Vector((0, 0, -0.014))
        return p_
    brim = grid_solid_bm(lambda u, v: brimP(u, v), 48, 6, closed_u=True, thick=lambda u, v: brimP(u, v, True))
    band = ring_follow_bm(zb + 0.040, 0.080, 0.012, 0.030, segs=48, rsegs=8)
    stitches = [setmat(stitch_ring_bm([brimP(k / 48, f_) + Vector((0, 0, 0.0025)) for k in range(48)]), 1) for f_ in (0.35, 0.70)]
    tmpb = merge_bms([crown.copy(), band.copy()]); hb = bvh_of_bms([tmpb])[0]; tmpb.free()
    p2, n2 = surf(hb, (0, -1.5, zb + 0.085), (0, 1, 0))
    em = []
    if p2 is not None:
        em = [setmat(orient_front(disc_bm(0.046, 0.010), n2, p2 + n2 * 0.006), 1), setmat(orient_front(i_mark_bm(0.058), n2, p2 + n2 * 0.013), 0)]
    finish_hat('hat__npc_guide_hat', 'npc_guide_hat', [setmat(crown, 0), setmat(brim, 0), setmat(band, 1)] + stitches + em, [m['red'], m['white']], target=1300)
    # 손에 드는 것: 클립보드(나무 판 + 은색 집게 + 안내지, 마을색 줄) — 오른손
    U, S, F = Vector((-1, 0, 0)), Vector((0, 0, 1)), Vector((0, 1, 0))
    Mx = frame_mat(U, S, F, GRIP)
    H, Wd, T = 0.30, 0.22, 0.012
    cz = -(H / 2 - 0.04); cy = (Wd / 2 - 0.06)
    board = move_bm(rbox_bm(T, Wd, H, 0.006, cuts=3), (0.010, cy, cz))
    paper = move_bm(rbox_bm(0.004, Wd - 0.030, H - 0.050, 0.002, cuts=2), (0.010 + T / 2 + 0.001, cy, cz - 0.012))
    clipm = move_bm(rbox_bm(0.016, 0.090, 0.030, 0.006, cuts=2), (0.010 + T / 2 + 0.004, cy, cz + H / 2 - 0.030))
    lines = []
    for k in range(5):
        lines.append(move_bm(rbox_bm(0.002, Wd - 0.070 - (0.04 if k % 2 else 0), 0.012, 0.001, cuts=1), (0.010 + T / 2 + 0.0035, cy - (0.02 if k % 2 else 0), cz + 0.060 - k * 0.040)))
    parts_i = [(setmat(board, 0), Mx), (setmat(paper, 1), Mx), (setmat(clipm, 2), Mx)] + [(setmat(l_, 3), Mx) for l_ in lines]
    W_ = slot_M()
    bms = [xform(b, W_ @ Mm) for b, Mm in parts_i]
    it = finish2('item__npc_clipboard', merge_bms(bms), [m['wood'], m['paper'], m['silver'], m['ink']], 'item', 'npc_clipboard', rigid='handslot.r')
    tag(it, 'item', 'npc_clipboard', False)

# ------------------------------------------------------------------ 3. 추모관 안내
SUIT_PROF = [(0.440, 0, 0), (0.440, 0.33, 0.275), (0.445, 0.385, 0.322), (0.455, 0.392, 0.328), (0.48, 0.388, 0.324),
             (0.53, 0.372, 0.306), (0.58, 0.358, 0.291), (0.64, 0.350, 0.284), (0.70, 0.346, 0.279)] + [r for r in TEE_PROF if r[0] >= 0.76]

def long_sleeve_weights(co, g, d):
    """긴소매 재킷: 몸통은 coat_weights, 소매(grp2)는 어깨에서 위팔 → 팔꿈치 → 아래팔·손목으로 이어진다."""
    if g == 2:
        side = 'l' if co.x > 0 else 'r'
        k = smoothstep(0.16, 0.30, abs(co.x))
        arm = segw(co, ['upperarm.' + side, 'lowerarm.' + side, 'wrist.' + side])
        return mixw((1 - k, {'chest': 1.0}), (k, arm))
    return coat_weights(co, g, d)

# ------------------------------------------------------------------ 4. 낚시터 대여점 주인 (owner 2026-11-16 "낚시대 대여점에도 안에 낚시대 관리하는 캐릭터")
def build_shopkeeper(m):
    # 웃옷: 회청색 셔츠 + 주머니 많은 국방색 낚시 조끼(가슴 작은 주머니 2줄 + 아래 큰 주머니, 덮개·단추, D링) + 목에 두른 수건(흰 바탕, 끝에 파란 줄)
    pr, trunk, sparts = vest_shirt()
    rows = [r for r in resample_prof(scaled_prof(TEE_PROF, 1.0), 0.03) if 0.47 <= r[0] <= 1.17 and r[1] > 1e-6]
    def gap(z): return 0.010 + 0.15 * smoothstep(0.98, 1.16, z)   # 지퍼로 닫힌 앞(목 아래만 V로 벌어짐)
    def V(u, v, k):
        z = lerp(0.470, 1.160, v)
        a_, b_ = prof_at(rows, z)
        a_ *= k; b_ *= k
        g = min(0.95, gap(z) / a_)
        th0 = -math.pi / 2 + math.asin(g)
        th = th0 + u * (2 * math.pi - 2 * math.asin(g))
        x, y = se(th, a_, b_, 2.5)
        return Vector((x, y, z))
    KV = lambda v, k: k + 0.040 * smoothstep(0.62, 1.0, v)
    vest = grid_solid_bm(lambda u, v: V(u, v, KV(v, 1.060)), 48, 13, closed_u=False, thick=lambda u, v: V(u, v, KV(v, 1.022)))
    vb = bvh_of_bms([vest])
    parts = []
    for s in (1, -1):
        pts = [V(0.0 if s > 0 else 1.0, v / 12, KV(v / 12, 1.044)) for v in range(12)]
        parts.append(grp(setmat(tube_bm(pts, [0.012] * len(pts), segs=8, capn=2), 2), 1))
    hemrows = [V(u / 40, 0.0, 1.044) for u in range(41)]
    parts.append(grp(setmat(tube_bm(hemrows, [0.011] * len(hemrows), segs=8, capn=2), 2), 1))
    toprow = [V(u / 48, 1.0, KV(1.0, 1.044)) for u in range(49)]
    parts.append(grp(setmat(tube_bm(toprow, [0.013] * len(toprow), segs=8, capn=2), 2), 1))
    for s in (1, -1):
        ring = xform(torus_bm(0.150, 0.015, segs=32, rsegs=8), Matrix.Translation((s * 0.318, 0.0, 1.107)) @ Matrix.Rotation(math.radians(90), 4, 'Y'))
        parts.append(grp(setmat(ring, 2), 2))
    pockets = [(0.185, 0.96, 0.10, 0.085), (0.185, 0.84, 0.12, 0.09), (0.175, 0.635, 0.15, 0.13)]
    for s in (1, -1):
        for (x0, zc, w, h) in pockets:
            pk = front_slab_bm(vb, lambda u, v, s=s, x0=x0, zc=zc, w=w, h=h: (s * x0 + lerp(-w / 2, w / 2, u), zc + lerp(-h / 2, h / 2, v)), 4, 3, 0.012, 0.002, puff=0.012)
            fl = front_slab_bm(vb, lambda u, v, s=s, x0=x0, zc=zc, w=w, h=h: (s * x0 + lerp(-w / 2 - 0.008, w / 2 + 0.008, u), zc + h / 2 + lerp(-0.034, 0.004, v)), 4, 2, 0.024, 0.010, puff=0.004)
            bt = stick_on(button_bm(0.011, 0.008), vb[0], (s * x0, 0, zc + h / 2 - 0.018), (0, 1, 0), lift=0.030)
            parts += [lay(grp(setmat(pk, 1), 1), 2), lay(grp(setmat(fl, 1), 1), 2), grp(setmat(bt, 3), 1)]
    p, n = surf(vb[0], (0.10, -1.5, 1.07), (0, 1, 0))
    if p is not None:
        ring = torus_bm(0.020, 0.005, segs=14, rsegs=5)
        parts.append(grp(setmat(orient_front(xform(ring, Matrix.Rotation(math.radians(90), 4, 'X')), n, p + n * 0.020), 4), 1))
    bvs = bvh_of_bms([trunk, vest])
    neck = []
    for k in range(25):
        az = 2 * math.pi * k / 24
        neck.append(Vector((0.170 * math.sin(az), -0.005 - 0.155 * math.cos(az), 1.205 + 0.015 * math.cos(az))))
    towel = [grp(setmat(tube_bm(neck, [0.034] * len(neck), segs=10, capn=0), 0), 3)]
    for s in (1, -1):
        path = [Vector((s * x, -0.6, z)) for x, z in ((0.095, 1.200), (0.112, 1.130), (0.122, 1.050), (0.128, 0.970), (0.132, 0.890), (0.134, 0.845))]
        pp, nn = project_path(bvs, path, 0.048, axis_c=lambda q: (q.x, 0.0, q.z))
        towel.append(grp(setmat(flat_strip_bm(pp, nn, 0.092, 0.020, rsegs=6), 0), 3))
        for k, dz in enumerate((-0.010, -0.034)):
            tip = [pp[-1] + Vector((0, 0, dz + 0.007)), pp[-1] + Vector((0, 0, dz - 0.007))]
            towel.append(grp(setmat(flat_strip_bm(tip, [nn[-1], nn[-1]], 0.096, 0.024, rsegs=6), 5), 3))
    # 지퍼: 가운데 두 줄 테이프 + 이(번갈아) + 손잡이
    zf = []
    tb = bvh_of_bms([trunk])[0]
    for k in range(46):
        z = lerp(0.49, 1.02, k / 45)
        q, nq = surf(tb, ((0.004 if k % 2 else -0.004), -1.5, z), (0, 1, 0))
        if q is not None:
            zf.append(grp(setmat(orient_front(poly_slab_bm([(-0.005, -0.003), (0.005, -0.003), (0.005, 0.003), (-0.005, 0.003)], depth=0.005), nq, q + nq * 0.030), 7), 1))
    for sx in (-0.013, 0.013):
        tp = front_slab_bm(bvh_of_bms([trunk]), lambda u, v, sx=sx: (sx + lerp(-0.007, 0.007, u), lerp(0.48, 1.03, v)), 2, 16, 0.027, 0.020)
        zf.append(lay(grp(setmat(tp, 7), 1), 2))
    q, nq = surf(tb, (0.0, -1.5, 1.00), (0, 1, 0))
    if q is not None:
        zf.append(grp(setmat(orient_front(rbox_bm(0.016, 0.006, 0.040, 0.004, cuts=1), nq, q + nq * 0.036 + Vector((0, 0, -0.022))), 3), 3))
    # 루어 한 개(왼쪽 가슴, 작은 물고기 모양 + 은색 립 + 고리)
    q, nq = surf(vb[0], (0.075, -1.5, 1.035), (0, 1, 0))
    if q is not None:
        lb = xform(ellipsoid_bm(0.034, 0.010, 0.013, segs=14, rings=7), Matrix.Rotation(math.radians(-20), 4, 'Y'))
        lip = move_bm(xform(ellipsoid_bm(0.010, 0.004, 0.008, segs=8, rings=4), Matrix.Rotation(math.radians(-20), 4, 'Y')), (-0.036, 0, -0.010))
        ring_ = move_bm(xform(torus_bm(0.008, 0.002, segs=10, rsegs=4), Matrix.Rotation(math.radians(90), 4, 'X')), (0.010, 0, -0.022))
        zf.append(grp(setmat(orient_front(lb, nq, q + nq * 0.022), 8), 3))
        zf.append(grp(setmat(orient_front(merge_bms([lip, ring_]), nq, q + nq * 0.022), 4), 3))
    for b in sparts: setmat(b, 6)
    body = [lay(grp(setmat(trunk, 6), 1), 1)] + [b for b in sparts if b is not trunk] + [lay(grp(setmat(vest, 1), 1), 2)]
    # 등 위쪽은 메시 판(통풍), 그 아래 가로 이음선
    for f in vest.faces:
        c = f.calc_center_median()
        if c.y > 0.06 and c.z > 0.80: f.material_index = 9
    seam = [V(u / 30, (0.80 - 0.47) / 0.69, 1.064) for u in range(31)]
    seam = [q_ for q_ in seam if q_.y > 0.04]
    if len(seam) > 2: zf.append(grp(setmat(tube_bm(seam, [0.004] * len(seam), segs=6, capn=1), 2), 1))
    finish_top('top__npc_shopkeeper', 'npc_shopkeeper', parts + towel + zf,
               [m['towel'], m['olive'], m['olive_dark'], m['brass'], m['silver'], m['towel_blue'], m['shirt_grey'], m['zipper'], m['lure'], m['olive_mesh']],
               target=4200, dec_parts=body)
    # 모자: 부드러운 면 벙거지(coordinator 3차: 낮고 둥근 크라운, 챙은 사방 15~25° 아래로, 머리 위에 얹혀 눈썹·안경·눈이 챙 아래로 다 보이게)
    # — 띠는 머리카락 선(1.84)보다 높은 1.95에 얹고, 크라운은 머리+머리카락 꼭대기(2.20) 바로 위 2.235까지만. 챙 0.13(머리 너비 1 m 기준
    # 실제 벙거지 챙 6~7 cm 비율). 위는 살짝 처진(가운데가 내려앉은) 부드러운 면.
    zb = 1.95
    crown = crown_bm(zb, 2.235, 0.074, flare_k=0.025, round_r=0.11)
    for v in crown.verts:   # 꼭대기 가운데가 살짝 내려앉은 부드러운 면
        if v.co.z > 2.20:
            rr = math.hypot(v.co.x - HC.x, v.co.y - HC.y)
            v.co.z -= 0.012 * math.exp(-(rr / 0.20) ** 2)
    def ringr(az):
        q = head_ring_pt(az, zb, 0.074)
        return Vector((q.x - HC.x, q.y - HC.y, 0)).length
    def brimP(u, v, lower=False):
        az = 2 * math.pi * u
        r0 = ringr(az) - 0.004
        L = 0.150 + 0.008 * math.cos(az) ** 2
        dro = math.radians(lerp(15, 25, v))
        d = Vector((math.sin(az), -math.cos(az), 0))
        p = Vector((HC.x, HC.y, zb + 0.004)) + d * (r0 + L * v * math.cos(dro)) + Vector((0, 0, -L * v * math.sin(dro)))
        if lower: p += Vector((0, 0, -0.013))
        return p
    brim = grid_solid_bm(lambda u, v: brimP(u, v), 48, 6, closed_u=True, thick=lambda u, v: brimP(u, v, True))
    stitches = []
    for f_ in (0.30, 0.55, 0.80):
        pts = [brimP(k / 48, f_) + Vector((0, 0, 0.0025)) for k in range(48)]
        stitches.append(setmat(stitch_ring_bm(pts), 1))
    for dz in (0.045,):
        pts = []
        for k in range(48):
            az = 2 * math.pi * k / 48
            r = ringr(az) * (1 + 0.025 * (dz / 0.285)) + 0.003
            pts.append(Vector((HC.x + math.sin(az) * r, HC.y - math.cos(az) * r, zb + dz)))
        stitches.append(setmat(stitch_ring_bm(pts), 1))
    holes = []
    for s_ in (1, -1):
        az = s_ * math.pi / 2
        r = ringr(az) * 1.02 + 0.004
        q = Vector((HC.x + math.sin(az) * r, HC.y - math.cos(az) * r, zb + 0.09))
        nrm = Vector((math.sin(az), -math.cos(az), 0))
        holes.append(orient_front(xform(torus_bm(0.010, 0.0035, segs=12, rsegs=4), Matrix.Rotation(math.radians(90), 4, 'X')), nrm, q))
    finish_hat('hat__npc_shop_hat', 'npc_shop_hat', [setmat(crown, 0), setmat(brim, 0)] + stitches + [setmat(h_, 2) for h_ in holes],
               [m['beige'], m['beige_dark'], m['brass']], target=1150)


NPC_PARTS = ['top__npc_driver', 'hat__npc_driver_cap',
             'top__npc_guide', 'hat__npc_guide_hat', 'item__npc_clipboard',
             'top__npc_shopkeeper', 'hat__npc_shop_hat']

def build_parts(badge_path):
    rest()
    m = M()
    img = None
    if badge_path and os.path.exists(badge_path):
        img = bpy.data.images.load(os.path.abspath(badge_path), check_existing=True)
        img.name = 'npc_badge'
        print('BADGE', img.filepath, img.size[:], img.has_data)
    build_driver(m)
    build_guide(m, img)
    build_shopkeeper(m)
    global FAB_DIR
    FAB_DIR = os.path.join(os.path.dirname(os.path.abspath(badge_path)), 'fabrics')
    for nm in NPC_PARTS:
        ob = bpy.data.objects[nm]
        limit_influences(ob, 4)
        fabricize(ob)
        print('PART', nm, len(ob.data.vertices), 'verts', [s.material.name for s in ob.material_slots])
    rest()

# ------------------------------------------------------------------ 미리보기 렌더
LOOKS = {
    'driver': ['body__head', 'body__hands', 'bottom__pants', 'face__smile', 'hair__short__hat', 'hat__npc_driver_cap', 'top__npc_driver', 'bottom__pants', 'shoes__dress'],
    'guide': ['body__head', 'body__hands', 'bottom__pants', 'face__smile', 'hair__ponytail__hat', 'hat__npc_guide_hat', 'top__npc_guide', 'bottom__pants', 'shoes__sneakers', 'item__npc_clipboard'],
    'shop': ['body__head', 'body__hands', 'bottom__pants', 'face__glasses', 'hair__short__hat', 'hat__npc_shop_hat', 'top__npc_shopkeeper', 'bottom__pants', 'shoes__boots'],
}
LOOK_COLORS = {
    'driver': dict(skin='#F5C9A0', hair='#2B2420', shoes='#1B1B1F', bottom='#22305A'),
    'guide': dict(skin='#FFDCC2', hair='#4A3226', shoes='#F7F7F2', bottom='#3B4250'),
    'shop': dict(skin='#E0A47A', hair='#3A3430', shoes='#3F5A3A', bottom='#5B5446'),
}

def look_colors(k):
    c = LOOK_COLORS[k]
    set_color('mat_tint_bottom', c.get('bottom', '#333333'))
    set_color('mat_skin', c['skin']); set_color('mat_tint_hair', c['hair']); set_color('mat_tint_shoes', c['shoes'])

def render(path, names, action=None, frame=0, view='full_34', res=420):
    show(names)
    s = bpy.data.objects.get('Seat')
    if s: s.hide_render = True
    if action: pose(action, frame)
    else: rest()
    aim(view)
    sc = bpy.context.scene
    sc.render.resolution_x = res; sc.render.resolution_y = res; sc.render.resolution_percentage = 100
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)

def render_parts(outdir):
    os.makedirs(outdir, exist_ok=True)
    VIEWS['npc_front'] = ((0, -1, 0.10), (0, 0.0, 1.10), 4.4)
    VIEWS['npc_back'] = ((0.2, 1, 0.12), (0, 0.0, 1.10), 4.4)
    VIEWS['npc_chest'] = ((0.25, -1, 0.10), (0, -0.1, 1.00), 2.3)
    for k, names in LOOKS.items():
        look_colors(k)
        for v in ('npc_front', 'full_34', 'npc_back', 'npc_chest'):
            render(os.path.join(outdir, '%s_%s.png' % (k, v)), names, 'Idle', 0, v)
    rest()


# ------------------------------------------------------------------ 동작(클립)
# 자세 풀이는 낚시 동작 스크립트(fishing_anims.py)의 것을 그대로 빌려 쓴다(같은 뼈대, 같은 팔 IK).
FL = {'__name__': 'fishing_lib'}
_fish_src = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lake-fishing', 'anim_src', 'fishing_anims.py')
exec(compile(open(_fish_src, encoding='utf8').read(), 'fishing_anims', 'exec'), FL)

FING_R = FL['FING_R']; FING_L = FL['FING_L']; BACK = FL['BACK']
CLIP_BONES = FL['BODY']

# 운전대(버스 모형 기준, build_bus.py cabin(): 운전석 seat(P, 1.02, -0.62, 0.34), 운전대 고리 중심 (-0.62, Yof(0.70), 1.08),
# 반지름 0.22, 기울기 0.5 rad). 아바타 뼈대 공간으로 옮겨 손이 잡을 점을 정한다. 뿌리(root)는 앉기 자세처럼 엉덩이 앞 0.397,
# 높이는 쿠션 윗면 - SIT_POSE.contactY. 클라이언트 npcLooks.ts의 BUS_DRIVER_SEAT가 같은 숫자를 쓴다(테스트가 맞춰 본다).
DRIVE = dict(
    # 마을버스 v3(feat/bus-v3 3927e48, build_bus.py driver_place()): 노드 bus_driver_sit = 앉은 사람의 뿌리 자리(바닥 위, 좌석 중심 앞 0.53),
    # bus_steering_wheel = 운전대 중심(hub), 고리 반지름 0.22, 수평에서 35° 뒤로 기운 면(로컬 +Z = 기둥 축, 기사 쪽).
    root_ahead=3.71,          # bus_driver_sit(버스 가운데에서 앞으로, m)
    root_h=0.34 + 0.452 - 0.39,   # 바닥 0.34 + 쿠션 0.452 - SIT_POSE.contactY: 엉덩이가 쿠션 위에
    wheel_ahead=3.94, wheel_h=1.30, wheel_r=0.22, wheel_from_horizontal=math.radians(35),
)

def wheel_axes():
    """아바타 뼈대 공간의 운전대 축: far = 고리 면 안에서 앞쪽(기사에게서 먼 쪽), toward = 면의 법선(기사 쪽 위), 둘 다 단위."""
    t = DRIVE['wheel_from_horizontal']
    far = Vector((0, -math.cos(t), math.sin(t)))
    toward = Vector((0, math.sin(t), math.cos(t)))
    return far, toward

def wheel_point(a_deg, rim_off=0.0):
    """운전대 고리 위 a도(0 = 기사의 오른쪽, 90 = 먼 쪽, 기사 쪽에서 보아 반시계 = 왼쪽으로 돌리는 쪽) 점을 아바타 뼈대 공간으로.
    아바타는 -Y를 보고, 캐릭터 오른쪽 = -X = 버스 문 쪽."""
    d = DRIVE
    far, _ = wheel_axes()
    hub = Vector((0, -(d['wheel_ahead'] - d['root_ahead']), d['wheel_h'] - d['root_h']))
    a = math.radians(a_deg); r = d['wheel_r'] + rim_off
    return hub + Vector((-r * math.cos(a), 0, 0)) + far * (r * math.sin(a))

def place_rot(bone, spec):
    r = FL['rig'](); pb = r.pose.bones[bone]; R = FL['rest_q'](bone)
    pb.rotation_quaternion = R.inverted() @ FL['qaxis'](spec) @ R @ pb.rotation_quaternion
    FL['upd']()

def chest_rel(goal):
    ch_pos, ch_D, _ = FL['chest_space']()
    return tuple(ch_D.inverted() @ (Vector(goal) - ch_pos))

def drive_pose(theta=0.0, head=None, lean=4.0, breathe=0.0):
    """앉아서 두 손으로 운전대(10시·2시)를 잡는다. theta: 운전대를 돌린 각(+ = 왼쪽으로)."""
    r = FL['rig'](); FL['reset_pose'](r)
    B = FL['base']('Sit_Chair_Idle', 0)
    for pb in r.pose.bones:
        l, q, sc = B[pb.name]; pb.location = l; pb.rotation_quaternion = q; pb.scale = sc
    FL['upd']()
    # 등을 세우고(앉기 자세는 뒤로 기댄다) 살짝 앞으로, 숨쉬기
    place_rot('spine', [((1, 0, 0), SPINE_UP + lean * 0.5)])
    place_rot('chest', [((1, 0, 0), CHEST_UP + lean * 0.5 + breathe)])
    place_rot('head', (head or []) + [((1, 0, 0), HEAD_UP)])
    # 다리: 허벅지를 아래로 내려 무릎이 운전대 아래로 가게, 정강이는 페달 쪽으로
    for s in ('l', 'r'):
        place_rot('upperleg.' + s, [((1, 0, 0), THIGH_DOWN)])
        place_rot('lowerleg.' + s, [((1, 0, 0), -12)])
        place_rot('foot.' + s, [((1, 0, 0), -14)])
    far, toward = wheel_axes()
    for side, a0, F in (('l', 190.0, FING_L), ('r', -10.0, FING_R)):
        a = a0 + theta
        g = wheel_point(a)
        radial = (wheel_point(a, 0.05) - g).normalized()
        # 손가락은 고리를 위에서 감싸 아래·안쪽으로, 손등은 바깥·위로
        spec = {'s': chest_rel(g), 'pole': (1 if side == 'l' else -1, 0.3, -0.9),
                'a': (F, tuple(-toward * 0.75 - radial * 0.35)), 'b': (BACK, tuple(radial * 0.7 + toward * 0.5)), 'wrist_share': 0.5}
        FL['solve_arm'](side, spec, None)
        miss = (FL['rig']().pose.bones['handslot.' + side].head - g).length
        DRIVE_MISS[0] = max(DRIVE_MISS[0], miss)
    return FL['capture']()

DRIVE_MISS = [0.0]

SPINE_UP = 16.0
CHEST_UP = 10.0
THIGH_DOWN = 18.0
HEAD_UP = -16.0

def stand_pose(frame=0, rot=None, R=None, L=None):
    P = {'base': ('Idle', frame), 'rot': rot or {}}
    if R: P['R'] = R
    if L: P['L'] = L
    FL['reset_pose']()
    return FL['apply_pose'](P)

def guide_R(lift=0.0):
    """오른손: 클립보드를 가슴 앞에 세워 든다(손가락 아래, 손등 앞 → 안내지가 앞을 본다)."""
    return {'s': (-0.13, -0.34, -0.14 + lift), 'pole': (-1, 0.5, -0.8), 'a': (FING_R, (0.15, -0.25, -1)), 'b': (BACK, (-0.15, -1, 0.15)), 'wrist_share': 0.5}

def guide_L_wave(tilt):
    t = math.radians(tilt)
    return {'s': (0.44, -0.12, 0.50), 'pole': (1, 0.2, -1), 'a': (FING_L, (math.sin(t), -0.15, math.cos(t))), 'b': (BACK, (0, 1, 0.1)), 'wrist_share': 0.6}

def guide_L_point(k=1.0):
    """왼손을 펴서 옆(광장 쪽)을 가리키는 안내 몸짓."""
    return {'s': (0.42 * k + 0.20 * (1 - k), -0.30, -0.12), 'pole': (1, 0.3, -1), 'a': (FING_L, (0.8, -0.6, -0.05)), 'b': (BACK, (0, 0.2, 1)), 'wrist_share': 0.6}

def fold_hands(dz=0.0):
    """공수: 두 손을 배 앞에 모은다(오른손 위에 왼손이 살짝 겹침)."""
    return dict(
        R={'s': (-0.035, -0.375, -0.30 + dz), 'pole': (-1, 0.4, -1), 'a': (FING_R, (1, -0.15, -0.25)), 'b': (BACK, (0, -1, 0.1)), 'wrist_share': 0.5, 'rel': True},
        L={'s': (0.035, -0.395, -0.285 + dz), 'pole': (1, 0.4, -1), 'a': (FING_L, (-1, -0.15, -0.25)), 'b': (BACK, (0, -1, 0.1)), 'wrist_share': 0.5, 'rel': True})

def hl(yaw, pitch=0.0):
    return [((0, 0, 1), yaw), ((1, 0, 0), pitch)]

# 낚시 대여점 카운터(lake_shop_interior.glb, build_shop_interior.py CTR): 윗면 1.42, 주인 쪽 모서리 z -20.55. 주인의 뿌리는 바닥 0.44,
# z -20.9(npc__lake_shopkeeper) → 윗면은 뿌리 위 0.98, 모서리는 뿌리 앞 0.35. 손(쥔 점)은 윗면 위 3 cm, 모서리 안쪽 0.10~0.12에.
SHOP_COUNTER = dict(top_above_root=1.42 - 0.44, edge_ahead=0.35)

def shop_hand(side, x=0.20, y=-0.455, z=0.085):
    """대여점 주인: 두 손을 카운터 윗면에 얹는다(손바닥 아래, 손가락 앞). s는 가슴 기준(가슴 머리 = 뿌리 위 약 0.97)."""
    sx = 1 if side == 'l' else -1
    return {'s': (sx * x, y, z), 'pole': (sx, 0.3, -1), 'a': (FING_L if side == 'l' else FING_R, (0, -1, -0.35)), 'b': (BACK, (0, 0.1, 1)), 'wrist_share': 0.5}

def shop_wave(tilt):
    t = math.radians(tilt)
    return {'s': (-0.44, -0.12, 0.50), 'pole': (-1, 0.2, -1), 'a': (FING_R, (math.sin(t), -0.15, math.cos(t))), 'b': (BACK, (0, 1, 0.1)), 'wrist_share': 0.6}

def shop_pose(frame=0, head=None, R=None, L=None, lean=3.0):
    rot = {'spine': [((1, 0, 0), lean * 0.6)], 'chest': [((1, 0, 0), lean * 0.4)]}
    if head: rot['head'] = head
    return stand_pose(frame, rot, R or shop_hand('r'), L or shop_hand('l'))

def clip_defs():
    """클립 이름 → (길이 프레임, 반복?, [(프레임, 자세 함수)])"""
    C = {}
    # 운전(8 s 반복): 잔잔한 조향, 왼쪽 거울 → 앞 → 오른쪽 거울 → 앞, 숨쉬기
    C['Npc_Drive'] = (192, True, [
        (0, lambda: drive_pose(0)),
        (22, lambda: drive_pose(5, breathe=1)),
        (44, lambda: drive_pose(-3)),
        (62, lambda: drive_pose(-1, head=hl(36, 2))),
        (82, lambda: drive_pose(1, head=hl(38, 2), breathe=1)),
        (98, lambda: drive_pose(2)),
        (120, lambda: drive_pose(-5, breathe=1)),
        (138, lambda: drive_pose(-2, head=hl(-34, 3))),
        (156, lambda: drive_pose(0, head=hl(-36, 3))),
        (172, lambda: drive_pose(3, breathe=1)),
        (192, lambda: drive_pose(0)),
    ])
    # 왼쪽으로 꺾기·오른쪽으로 꺾기(2 s 반복): 운전대를 크게 돌린 채 살짝씩 고친다, 고개는 도는 쪽으로
    for nm, sg in (('Npc_Drive_Left', 1), ('Npc_Drive_Right', -1)):
        C[nm] = (48, True, [
            (0, lambda sg=sg: drive_pose(sg * 40, head=hl(sg * 14), lean=6)),
            (16, lambda sg=sg: drive_pose(sg * 44, head=hl(sg * 17), lean=6, breathe=1)),
            (32, lambda sg=sg: drive_pose(sg * 37, head=hl(sg * 12), lean=6)),
            (48, lambda sg=sg: drive_pose(sg * 40, head=hl(sg * 14), lean=6)),
        ])
    # 안내원 서 있기(5 s 반복): 클립보드를 가슴 앞에, 둘러보다가 왼손으로 옆을 가리킨다
    C['Npc_Guide_Idle'] = (120, True, [
        (0, lambda: stand_pose(0, {'head': hl(0)}, R=guide_R())),
        (24, lambda: stand_pose(8, {'head': hl(10, -3)}, R=guide_R(0.01))),
        (44, lambda: stand_pose(14, {'head': hl(16, -2), 'spine': [((0, 0, 1), 6)]}, R=guide_R(0.01), L=guide_L_point(0.6))),
        (60, lambda: stand_pose(18, {'head': hl(18, -2), 'spine': [((0, 0, 1), 8)]}, R=guide_R(), L=guide_L_point(1.0))),
        (76, lambda: stand_pose(20, {'head': hl(12, -2), 'spine': [((0, 0, 1), 4)]}, R=guide_R(), L=guide_L_point(0.9))),
        (96, lambda: stand_pose(6, {'head': hl(-8, 0)}, R=guide_R(0.01))),
        (120, lambda: stand_pose(0, {'head': hl(0)}, R=guide_R())),
    ])
    # 안내원 인사(2.5 s, 한 번): 왼손을 들어 흔들고 고개를 갸웃
    C['Npc_Guide_Greet'] = (60, False, [
        (0, lambda: stand_pose(0, {'head': hl(0)}, R=guide_R())),
        (10, lambda: stand_pose(0, {'head': [((0, 1, 0), 6)]}, R=guide_R(0.01), L=guide_L_wave(-18))),
        (20, lambda: stand_pose(0, {'head': [((0, 1, 0), 8)]}, R=guide_R(0.01), L=guide_L_wave(22))),
        (30, lambda: stand_pose(0, {'head': [((0, 1, 0), 8)]}, R=guide_R(0.01), L=guide_L_wave(-20))),
        (40, lambda: stand_pose(0, {'head': [((0, 1, 0), 6)]}, R=guide_R(0.01), L=guide_L_wave(18))),
        (60, lambda: stand_pose(0, {'head': hl(0)}, R=guide_R())),
    ])
    # 낚시터 대여점 주인 서 있기(6 s 반복): 창구 턱에 두 손을 얹고 밖을 내다보다가, 오른손으로 턱을 훔치듯 정리한다
    C['Npc_Shop_Idle'] = (144, True, [
        (0, lambda: shop_pose(0, hl(0, 2))),
        (24, lambda: shop_pose(8, hl(22, 0))),
        (44, lambda: shop_pose(12, hl(26, -2))),
        (64, lambda: shop_pose(16, hl(4, 10), R=shop_hand('r', x=0.06, z=0.085))),
        (76, lambda: shop_pose(18, hl(-2, 12), R=shop_hand('r', x=0.28, z=0.085))),
        (88, lambda: shop_pose(20, hl(2, 12), R=shop_hand('r', x=0.04, z=0.085))),
        (100, lambda: shop_pose(22, hl(-2, 10), R=shop_hand('r', x=0.24, z=0.090))),
        (118, lambda: shop_pose(10, hl(-20, 0))),
        (144, lambda: shop_pose(0, hl(0, 2))),
    ])
    # 낚시터 대여점 주인 인사(2.5 s, 한 번): 오른손을 들어 흔들고 고개를 끄덕인다(대를 빌리거나 돌려줄 때)
    C['Npc_Shop_Wave'] = (60, False, [
        (0, lambda: shop_pose(0, hl(0, 2))),
        (10, lambda: shop_pose(0, hl(0, 8), R=shop_wave(18), lean=2)),
        (20, lambda: shop_pose(0, hl(0, -2), R=shop_wave(-22), lean=2)),
        (30, lambda: shop_pose(0, hl(0, 8), R=shop_wave(20), lean=2)),
        (40, lambda: shop_pose(0, hl(0, 0), R=shop_wave(-18), lean=2)),
        (60, lambda: shop_pose(0, hl(0, 2))),
    ])
    return C

def build_clips():
    r = FL['rig']()
    ad = r.animation_data_create()
    ad.use_nla = False
    FL['reset_pose'](r)
    built = []
    for name, (length, cyclic, keys) in clip_defs().items():
        poses = []
        for frame, fn in keys:
            FL['reset_pose'](r)
            poses.append((frame, fn()))
        if cyclic:
            poses[-1] = (poses[-1][0], poses[0][1])
        FL['write_action'](name, poses, CLIP_BONES, float(length), cyclic)
        built.append(name)
        print('CLIP', name, len(poses), 'keys', length / FPS, 's', 'hand miss %.3f m' % DRIVE_MISS[0] if 'Drive' in name else '')
        if name == 'Npc_Shop_Idle':
            FL['reset_pose'](r); keys[0][1]()
            for sd in ('l', 'r'):
                h = FL['rig']().pose.bones['handslot.' + sd].head
                print('SHOP HAND', sd, 'ahead %.3f' % -h.y, 'up %.3f' % h.z, '(counter top %.2f, edge %.2f ahead)' % (SHOP_COUNTER['top_above_root'], SHOP_COUNTER['edge_ahead']))
        DRIVE_MISS[0] = 0.0
    FL['reset_pose'](r)
    return built

CLIP_LOOKS = {'Npc_Drive': 'driver', 'Npc_Drive_Left': 'driver', 'Npc_Drive_Right': 'driver', 'Npc_Guide_Idle': 'guide',
              'Npc_Guide_Greet': 'guide',
              'Npc_Shop_Idle': 'shop', 'Npc_Shop_Wave': 'shop'}

def add_wheel_proxy():
    """미리보기용 운전대·좌석(내보내지 않는다): 버스의 운전대 고리를 아바타 공간에 그린다."""
    pts = [wheel_point(360.0 * k / 24) for k in range(25)]
    bm = tube_bm(pts, [0.018] * len(pts), segs=6, capn=0)
    d = DRIVE
    seat_c = d['root_ahead'] - 0.53                       # v3 좌석 중심
    pan = move_bm(rbox_bm(0.80, 0.50, 0.08, 0.02, cuts=2), (0, -(seat_c - d['root_ahead']), 0.34 + 0.41 - d['root_h']))
    hub = Vector((0, -(d['wheel_ahead'] - d['root_ahead']), d['wheel_h'] - d['root_h']))
    _, toward = wheel_axes()
    col = tube_bm([hub, hub - toward * 0.5], [0.03, 0.03], segs=6, capn=0)
    bm = merge_bms([bm, pan, col])
    ob = bpy.data.objects.get('_wheel_proxy')
    if ob: bpy.data.objects.remove(ob, do_unlink=True)
    me = bpy.data.meshes.new('_wheel_proxy'); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new('_wheel_proxy', me); coll().objects.link(ob)
    ob.data.materials.append(bpy.data.materials['npc_black'])
    return ob

def render_clips(outdir):
    os.makedirs(outdir, exist_ok=True)
    VIEWS['drv_side'] = ((1, -0.05, 0.10), (0, 0.1, 0.95), 4.2)
    VIEWS['drv_front'] = ((0.15, -1, 0.35), (0, 0.1, 0.95), 4.2)
    VIEWS['npc_34'] = ((0.62, -0.78, 0.15), (0, 0.0, 1.05), 4.6)
    wp = add_wheel_proxy()
    r = rig()
    for name, look in CLIP_LOOKS.items():
        look_colors(look)
        a = bpy.data.actions[name]
        L = int(a.frame_range[1])
        frames = [0, L // 3, (2 * L) // 3] if 'Drive' in name else [0, L // 4, L // 2, (3 * L) // 4]
        views = ('drv_side', 'drv_front') if 'Drive' in name else ('npc_34',)
        wp.hide_render = 'Drive' not in name
        for v in views:
            for f in frames:
                show(LOOKS[look] + (['_wheel_proxy'] if 'Drive' in name else []))
                ad = r.animation_data_create(); ad.action = a
                try: ad.action_slot = a.slots[0]
                except Exception: pass
                bpy.context.scene.frame_set(f); bpy.context.view_layer.update()
                aim(v)
                sc = bpy.context.scene
                sc.render.resolution_x = 360; sc.render.resolution_y = 360
                sc.render.filepath = os.path.join(outdir, '%s_%s_%03d.png' % (name, v, f))
                bpy.ops.render.render(write_still=True)
        ad.action = None
    bpy.data.objects.remove(wp, do_unlink=True)
    FL['reset_pose'](r)

# ------------------------------------------------------------------ 내보내기
def export(path, clips):
    r = rig()
    FL['reset_pose'](r)
    ad = r.animation_data_create()
    for t in list(ad.nla_tracks):    # 기본 동작은 character.glb에 있다: 이 파일에는 NPC 동작만(블렌드는 저장하지 않는다)
        ad.nla_tracks.remove(t)
    for name in clips:
        tr = ad.nla_tracks.new(); tr.name = name
        tr.strips.new(name, 0, bpy.data.actions[name]); tr.mute = True
    ad.action = None
    ad.use_nla = True
    FL['reset_pose'](r)
    vl = bpy.context.view_layer
    for o in vl.objects: o.select_set(False)
    for nm in NPC_PARTS:
        o = bpy.data.objects[nm]; o.hide_viewport = False; o.hide_render = False; o.hide_set(False); o.select_set(True)
    r.hide_set(False); r.hide_viewport = False; r.select_set(True)
    vl.objects.active = r
    path = os.path.abspath(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_animations=True,
                              export_animation_mode='NLA_TRACKS', export_skins=True, export_morph=False, export_apply=False,
                              export_yup=True, export_materials='EXPORT', export_def_bones=False,
                              export_optimize_animation_size=True, export_optimize_animation_keep_anim_armature=True,
                              export_reset_pose_bones=True, export_vertex_color='MATERIAL', export_image_format='AUTO', export_frame_step=2)
    FL['reset_pose'](r)
    return os.path.getsize(path)


def slim_glb(path):
    """내보낸 뒤: 텍스처 없는 primitive의 TEXCOORD_0를 빼고(클라이언트가 합칠 때 어차피 버린다) 쓰는 버퍼만 다시 묶는다."""
    js, bin_ = FL['_read_glb'](path)
    mats = js.get('materials', [])
    for me in js.get('meshes', []):
        for pr in me['primitives']:
            mt = mats[pr['material']] if 'material' in pr else {}
            if 'baseColorTexture' not in mt.get('pbrMetallicRoughness', {}) and 'normalTexture' not in mt:
                pr['attributes'].pop('TEXCOORD_0', None)
    used = set()
    for me in js.get('meshes', []):
        for pr in me['primitives']:
            used.update(pr['attributes'].values())
            if 'indices' in pr: used.add(pr['indices'])
    for sk in js.get('skins', []):
        if 'inverseBindMatrices' in sk: used.add(sk['inverseBindMatrices'])
    for an in js.get('animations', []):
        for sa in an['samplers']: used.update((sa['input'], sa['output']))
    acc_map = {}; new_acc = []
    for i in sorted(used):
        acc_map[i] = len(new_acc); new_acc.append(dict(js['accessors'][i]))
    # 뼈 가중치와 정점색은 부호 없는 8비트(정규화)로: float 4개(16 B) → 4 B. glTF가 허용하는 형식이고 three가 그대로 읽는다.
    quant = set()
    for me in js.get('meshes', []):
        for pr in me['primitives']:
            for k in ('WEIGHTS_0', 'COLOR_0'):
                if k in pr['attributes']: quant.add(acc_map[pr['attributes'][k]])
    import array
    out = bytearray(); new_views = []
    def put(chunk, target=None):
        while len(out) % 4: out.append(0)
        v = {'buffer': 0, 'byteOffset': len(out), 'byteLength': len(chunk)}
        if target: v['target'] = target
        out.extend(chunk); new_views.append(v)
        return len(new_views) - 1
    W_ = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
    C_ = {5126: 4, 5123: 2, 5125: 4, 5121: 1}
    for ai, a in enumerate(new_acc):
        v = js['bufferViews'][a['bufferView']]
        w = W_[a['type']]; c = C_[a['componentType']]
        stride = v.get('byteStride') or w * c
        start = v.get('byteOffset', 0) + a.get('byteOffset', 0)
        rows = [bin_[start + i * stride:start + i * stride + w * c] for i in range(a['count'])]
        raw = b''.join(rows)
        a.pop('byteOffset', None)
        if ai in quant and a['componentType'] == 5126:
            fl = array.array('f'); fl.frombytes(raw)
            if a['type'] == 'VEC3':   # 색 RGB → RGBA(4 B 정렬)
                fl4 = array.array('f')
                for i in range(0, len(fl), 3): fl4.extend((fl[i], fl[i + 1], fl[i + 2], 1.0))
                fl = fl4; a['type'] = 'VEC4'
            q = bytearray(max(0, min(255, int(round(x * 255)))) for x in fl)
            # 가중치는 합이 255가 되게 가장 큰 칸에서 맞춘다
            if any(k == 'WEIGHTS_0' for me in js['meshes'] for pr in me['primitives'] for k, vv in pr['attributes'].items() if acc_map.get(vv) == ai):
                for i in range(0, len(q), 4):
                    d = 255 - sum(q[i:i + 4])
                    j = max(range(4), key=lambda t: q[i + t]); q[i + j] = max(0, min(255, q[i + j] + d))
            raw = bytes(q); a['componentType'] = 5121; a['normalized'] = True
            a.pop('min', None); a.pop('max', None)
        a['bufferView'] = put(raw, v.get('target'))
    for im in js.get('images', []):
        if 'bufferView' in im:
            v = js['bufferViews'][im['bufferView']]
            im['bufferView'] = put(bin_[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']])
    for me in js.get('meshes', []):
        for pr in me['primitives']:
            pr['attributes'] = {k: acc_map[v] for k, v in pr['attributes'].items()}
            if 'indices' in pr: pr['indices'] = acc_map[pr['indices']]
    for sk in js.get('skins', []):
        if 'inverseBindMatrices' in sk: sk['inverseBindMatrices'] = acc_map[sk['inverseBindMatrices']]
    for an in js.get('animations', []):
        for sa in an['samplers']: sa['input'] = acc_map[sa['input']]; sa['output'] = acc_map[sa['output']]
    js['accessors'] = new_acc; js['bufferViews'] = new_views; js['buffers'] = [{'byteLength': len(out)}]
    FL['_write_glb'](path, js, bytes(out))
    return os.path.getsize(path)

def verify(path):
    rep = FL['verify'](path)
    js, _ = FL['_read_glb'](path)
    names = [n.get('name') for n in js['nodes']]
    ok = True
    for k, (dur, nch, rot) in rep.items():
        print('VERIFY', k, 'dur', dur, 'channels', nch, 'rotating', len(rot), rot)
        if nch < 10 or len(rot) < 2: ok = False
    print('NODES', len(names), 'MESHES', len(js.get('meshes', [])), 'SKINS', len(js.get('skins', [])), 'IMAGES', len(js.get('images', [])),
          'MATERIALS', [mm['name'] for mm in js.get('materials', [])])
    print('JOINTS', [names[j] for j in js['skins'][0]['joints']])
    return ok


if __name__ == '__main__':
    build_parts(arg('--badge'))
    if arg('--render'):
        render_parts(arg('--render'))
    clips = build_clips()
    if arg('--clipshots'):
        render_clips(arg('--clipshots'))
    if arg('--export'):
        size = export(arg('--export'), clips)
        size = slim_glb(arg('--export'))
        print('EXPORTED', arg('--export'), size, 'bytes')
        assert verify(arg('--export')), 'frozen or empty clip'
    r = rig()
    FL['reset_pose'](r)
    assert r.data.pose_position == 'POSE' and (r.animation_data is None or r.animation_data.action is None)
