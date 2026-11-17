"""
케이슨랜드 하늘 등불 바퀴(Sky Lantern Wheel)의 모델을 만든다 (Blender, 한 프로세스):

    "C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" --background --python tools/land/make_wheel.py -- <out_dir>

결과(<out_dir>):
  wheel_rotor.glb    돌아가는 바퀴: 두 겹 테두리(트러스 격자), 강철 살 20개씩, 장력 케이블, 허브 드럼, 금 랜턴 캡. 원점은 허브 중심, 바퀴 면은 x-y, 축은 z.
  wheel_frame.glb    고정부: 양쪽 A자 탑(강철 다리·가로대·X자 보강), 축받이, 발판, 동쪽 승강장(널마루·난간·계단). 원점은 허브 바로 아래 땅.
  wheel_gondola.glb  곤돌라 하나(랜턴 모양 유리 캐빈): 원점은 걸이 축(피벗), 캐빈은 바퀴 면 남쪽 3.2m 바깥에 팔로 매달려요(테두리가 창을 가리지 않게). 4석 한 줄 벤치가 북쪽 벽에 붙어 남쪽(바깥)을 봐요.
좌표: 게임 좌표 (x 동쪽, y 위, z 남쪽) -> 블렌더 (x, -z, y). 바퀴 반지름·허브 높이는 shared/src/land/wheel.ts 와 같아야 해요 (R=22, 허브 y=26).
외부 자산·AI 없음.
"""
import math
import os
import sys

src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "make_carousel.py"), encoding="utf8").read().split("GOLD = (0.95, 0.66, 0.16)")[0]
exec(compile(src, "make_carousel_head", "exec"), globals())

GOLD = (0.95, 0.66, 0.16)
R = 22.0
HUB_Y = 26.0
RIM_Z = 1.9
N_GOND = 8

STEEL = {
    "ws_steel": ((0.9, 0.92, 0.95), 0.35, 0.38, 0.4, 0.15),
    "ws_steel_dark": ((0.55, 0.58, 0.64), 0.6, 0.4),
    "ws_indigo": ((0.08, 0.1, 0.48), 0.1, 0.35, 0.9, 0.06),
    "ws_gold": (GOLD, 0.85, 0.3, 0.5, 0.1),
    "ws_cream": ((0.95, 0.91, 0.82), 0.0, 0.45, 0.6, 0.1),
    "ws_wood": ((0.42, 0.26, 0.13), 0.0, 0.4, 0.7, 0.1),
    "ws_stone": ((0.62, 0.6, 0.56), 0.0, 0.8),
    "ws_lamp": ((1.0, 0.92, 0.7), 0.0, 0.3, 0.0, 0.1, (1.0, 0.8, 0.45)),
}


def circle_pts(r, z, n=96):
    return [(math.sin(i / n * math.tau) * r, math.cos(i / n * math.tau) * r, z) for i in range(n + 1)]


# ═════════════════════════════ the rotor ═════════════════════════════
W = Builder(STEEL)
for z in (-RIM_Z, RIM_Z):
    W.tube(f"rim_{z}", circle_pts(R, z), 0.22, "ws_steel", 10)
    W.tube(f"rim_inner_{z}", circle_pts(R - 2.4, z), 0.13, "ws_steel", 8)
    # the truss lattice between the two rings: alternating diagonals
    n = 48
    for i in range(n):
        a0 = i / n * math.tau
        a1 = (i + 1) / n * math.tau
        r0, r1 = (R, R - 2.4) if i % 2 == 0 else (R - 2.4, R)
        W.cyl(f"lat_{z}_{i}", (math.sin(a0) * r0, math.cos(a0) * r0, z), (math.sin(a1) * r1, math.cos(a1) * r1, z), 0.05, 0.05, "ws_steel_dark", 6)
    # spokes: 20 steel tubes hub -> inner ring; tension cables hub -> rim, offset half a step
    for i in range(20):
        a = i / 20 * math.tau
        W.cyl(f"spoke_{z}_{i}", (math.sin(a) * 1.9, math.cos(a) * 1.9, z), (math.sin(a) * (R - 2.4), math.cos(a) * (R - 2.4), z), 0.085, 0.085, "ws_steel", 8)
        b = a + math.pi / 20
        W.cyl(f"cable_{z}_{i}", (math.sin(b) * 1.9, math.cos(b) * 1.9, z * 0.7), (math.sin(b) * R, math.cos(b) * R, z), 0.025, 0.025, "ws_steel_dark", 4)
# cross ties between the rims
for i in range(60):
    a = i / 60 * math.tau
    W.cyl(f"tie_{i}", (math.sin(a) * R, math.cos(a) * R, -RIM_Z), (math.sin(a) * R, math.cos(a) * R, RIM_Z), 0.06, 0.06, "ws_steel_dark", 6)
# the hub: a drum, flanges with bolts, the axle, gold lantern caps
W.cyl("hub_drum", (0, 0, -2.1), (0, 0, 2.1), 1.45, 1.45, "ws_steel", 24)
for z in (-2.1, 2.1):
    W.cyl(f"hub_flange_{z}", (0, 0, z - 0.1), (0, 0, z + 0.1), 2.15, 2.15, "ws_steel_dark", 24)
    for k in range(12):
        a = k / 12 * math.tau
        W.ellipsoid(f"bolt_{z}_{k}", (math.sin(a) * 1.8, math.cos(a) * 1.8, z + (0.14 if z > 0 else -0.14)), (0.07, 0.07, 0.07), "ws_gold", seg=6, rings=4)
    W.ellipsoid(f"hub_cap_{z}", (0, 0, z * 1.55), (0.95, 0.95, 0.55), "ws_gold", seg=16, rings=8)
W.cyl("axle", (0, 0, -3.3), (0, 0, 5.8), 0.45, 0.45, "ws_steel_dark", 16)
# the gondola pivots: a gold boss at each rim, on the two rims, and the hanger axle between them
for g in range(N_GOND):
    a = g / N_GOND * math.tau + math.pi  # g = 0 is at the bottom at rest (step 0)
    # (the gondola at the bottom at step 0 is the one whose angle is pi from the top: see wheel.ts bottomGondola)
for g in range(N_GOND):
    a = g / N_GOND * math.tau
    px, py = math.sin(a) * R, math.cos(a) * R
    W.cyl(f"hanger_axle_{g}", (px, py, -RIM_Z - 0.15), (px, py, RIM_Z + 0.15), 0.1, 0.1, "ws_gold", 10)
    for z in (-RIM_Z - 0.15, RIM_Z + 0.15):
        W.ellipsoid(f"pivot_boss_{g}_{z}", (px, py, z), (0.32, 0.32, 0.18), "ws_gold", seg=10, rings=6)
W.export("wheel_rotor.glb", 50.0)

# ═════════════════════════════ the fixed frame ═════════════════════════════
F = Builder(STEEL)
LEG_X = 11.0
ZN, ZS = -2.75, 4.9  # the two A-frames: the north one close behind the rims, the south one beyond the gondolas (which hang at z 2.3..4.1)
for z in (ZN, ZS):
    for sx in (-1, 1):
        F.cyl(f"leg_{z}_{sx}", (sx * LEG_X, 0.2, z), (sx * 0.9, HUB_Y - 0.6, z), 0.62, 0.42, "ws_steel", 14)
        F.box(f"foot_{z}_{sx}", (1.9, 0.5, 1.9), (sx * LEG_X, 0.25, z), "ws_stone", 0.05, 2)
        F.cyl(f"foot_collar_{z}_{sx}", (sx * LEG_X, 0.5, z), (sx * LEG_X, 1.4, z), 0.75, 0.62, "ws_indigo", 14)
    for h in (6.0, 12.0, 18.0):
        t = h / (HUB_Y - 0.6)
        x = LEG_X + (0.9 - LEG_X) * t
        F.cyl(f"brace_{z}_{h}", (-x, h, z), (x, h, z), 0.18, 0.18, "ws_steel", 8)
    for sx in (-1, 1):
        for (h0, h1) in ((0.6, 6.0), (6.0, 12.0), (12.0, 18.0)):
            t0, t1 = h0 / (HUB_Y - 0.6), h1 / (HUB_Y - 0.6)
            x0 = LEG_X + (0.9 - LEG_X) * t0
            x1 = LEG_X + (0.9 - LEG_X) * t1
            F.cyl(f"xbrace_{z}_{sx}_{h0}", (sx * x0, h0, z), (-sx * x1, h1, z), 0.1, 0.1, "ws_steel_dark", 6)
    F.cyl(f"bearing_{z}", (0, HUB_Y, z - 0.35), (0, HUB_Y, z + 0.35), 0.95, 0.95, "ws_gold", 20)
    F.cyl(f"bearing_plate_{z}", (0, HUB_Y, z - 0.45), (0, HUB_Y, z + 0.45), 0.6, 0.6, "ws_steel_dark", 16)
# tie beams between the two A-frames at the feet and half way up
for sx in (-1, 1):
    F.cyl(f"tie_foot_{sx}", (sx * LEG_X, 0.9, ZN), (sx * LEG_X, 0.9, ZS), 0.16, 0.16, "ws_steel", 8)
    F.cyl(f"tie_mid_{sx}", (sx * 6.2, 12.0, ZN), (sx * 6.2, 12.0, ZS), 0.12, 0.12, "ws_steel_dark", 6)
# the boarding platform on the east side, level with the gondola's floor, next to the cabin's east end: plinth, plank deck, rails, steps on the south side
DECK_Y = 0.95
PX0, PX1, PZ0, PZ1 = 2.1, 10.0, 0.9, 5.5
cx, cz = (PX0 + PX1) / 2, (PZ0 + PZ1) / 2
F.box("plat_base", (PX1 - PX0, DECK_Y - 0.1, PZ1 - PZ0), (cx, (DECK_Y - 0.1) / 2, cz), "ws_stone", 0.04, 2)
F.box("plat_deck", (PX1 - PX0, 0.1, PZ1 - PZ0), (cx, DECK_Y - 0.05, cz), "ws_wood", 0.02, 2)
F.box("plat_trim", (PX1 - PX0 + 0.3, 0.08, PZ1 - PZ0 + 0.3), (cx, DECK_Y - 0.1, cz), "ws_gold", 0.02, 2)
for i in range(9):
    x = PX0 + 0.3 + i * 0.9
    for z in (PZ0 + 0.1, PZ1 - 0.1):
        if z > 3 and 5.0 < x < 8.6:
            continue  # the opening to the steps
        F.cyl(f"rail_post_{i}_{z}", (x, DECK_Y, z), (x, DECK_Y + 1.0, z), 0.04, 0.04, "ws_gold", 6)
        F.ellipsoid(f"rail_ball_{i}_{z}", (x, DECK_Y + 1.05, z), (0.07, 0.07, 0.07), "ws_gold", seg=6, rings=4)
F.cyl("rail_top_n", (PX0 + 0.3, DECK_Y + 1.0, PZ0 + 0.1), (PX1 - 0.3, DECK_Y + 1.0, PZ0 + 0.1), 0.03, 0.03, "ws_gold", 6)
F.cyl("rail_top_s1", (PX0 + 0.3, DECK_Y + 1.0, PZ1 - 0.1), (5.0, DECK_Y + 1.0, PZ1 - 0.1), 0.03, 0.03, "ws_gold", 6)
F.cyl("rail_top_s2", (8.6, DECK_Y + 1.0, PZ1 - 0.1), (PX1 - 0.3, DECK_Y + 1.0, PZ1 - 0.1), 0.03, 0.03, "ws_gold", 6)
F.cyl("rail_top_e", (PX1 - 0.3, DECK_Y + 1.0, PZ0 + 0.1), (PX1 - 0.3, DECK_Y + 1.0, PZ1 - 0.1), 0.03, 0.03, "ws_gold", 6)
F.box("steps_a", (3.4, 0.25, 0.9), (6.8, 0.65, PZ1 + 0.45), "ws_stone", 0.02, 1)
F.box("steps_b", (3.4, 0.25, 0.9), (6.8, 0.38, PZ1 + 1.35), "ws_stone", 0.02, 1)
F.box("steps_c", (3.4, 0.25, 0.9), (6.8, 0.13, PZ1 + 2.25), "ws_stone", 0.02, 1)
F.cyl("lamp_post", (PX1 - 0.4, DECK_Y, cz), (PX1 - 0.4, DECK_Y + 3.2, cz), 0.07, 0.05, "ws_indigo", 8)
F.ellipsoid("lamp_globe", (PX1 - 0.4, DECK_Y + 3.4, cz), (0.28, 0.28, 0.28), "ws_lamp", seg=10, rings=8)
F.export("wheel_frame.glb", 50.0)

# ═════════════════════════════ a gondola ═════════════════════════════
# Origin = the pivot on the wheel's rim line. The cabin hangs 3.2 m SOUTH of the wheel plane on an arm (the rim trusses are then behind the
# riders, never across the window line), its long side facing south (open glass), one four-seat bench along its north wall.
G = Builder({
    "g_gold": (GOLD, 0.85, 0.3, 0.5, 0.1),
    "g_indigo": ((0.08, 0.1, 0.48), 0.1, 0.35, 0.9, 0.06),
    "g_cream": ((0.95, 0.91, 0.82), 0.0, 0.45, 0.6, 0.1),
    "g_wood": ((0.42, 0.26, 0.13), 0.0, 0.4, 0.7, 0.1),
    "g_velvet": ((0.52, 0.05, 0.1), 0.0, 0.6, 0.0, 0.1),
    "g_steel": ((0.6, 0.62, 0.68), 0.6, 0.4),
    "g_glass": ((0.85, 0.93, 1.0), 0.0, 0.05),
    "g_lamp": ((1.0, 0.92, 0.7), 0.0, 0.3, 0.0, 0.1, (1.0, 0.8, 0.45)),
})
CZ = 3.2  # the cabin's centre, south of the pivot
GX, GZ = 2.0, 0.9  # half sizes (x along the wheel plane, z across)
TOP = -0.75
FLOOR = -3.1
G.box("floor", (2 * GX, 0.12, 2 * GZ), (0, FLOOR, CZ), "g_wood", 0.02, 2)
G.box("plinth", (2 * GX + 0.12, 0.34, 2 * GZ + 0.12), (0, FLOOR - 0.2, CZ), "g_indigo", 0.04, 2)
G.box("plinth_trim", (2 * GX + 0.2, 0.06, 2 * GZ + 0.2), (0, FLOOR - 0.02, CZ), "g_gold", 0.02, 2)
for sx in (-1, 1):
    for sz in (-1, 1):
        G.cyl(f"post_{sx}_{sz}", (sx * GX, FLOOR, CZ + sz * GZ), (sx * GX, TOP, CZ + sz * GZ), 0.035, 0.035, "g_gold", 8)
        G.ellipsoid(f"post_ball_{sx}_{sz}", (sx * GX, TOP + 0.05, CZ + sz * GZ), (0.1, 0.1, 0.1), "g_gold", seg=8, rings=6)
# (no mid posts: the south glass is one open pane)
G.box("rail_s", (2 * GX, 0.035, 0.035), (0, FLOOR + 0.95, CZ + GZ), "g_gold", 0.01, 1)
G.box("rail_w", (0.035, 0.035, 2 * GZ), (-GX, FLOOR + 0.95, CZ), "g_gold", 0.01, 1)
G.box("rail_e", (0.035, 0.035, 2 * GZ), (GX, FLOOR + 0.95, CZ), "g_gold", 0.01, 1)
H_GLASS = TOP - FLOOR - 0.2
for (nm, size, loc) in (
    ("glass_s", (2 * GX - 0.1, H_GLASS, 0.02), (0, (TOP + FLOOR) / 2, CZ + GZ)),
    ("glass_w", (0.02, H_GLASS, 2 * GZ - 0.1), (-GX, (TOP + FLOOR) / 2, CZ)),
    ("glass_e", (0.02, H_GLASS, 2 * GZ - 0.1), (GX, (TOP + FLOOR) / 2, CZ)),
):
    G.box(nm, size, loc, "g_glass")
# the north wall (towards the wheel): an indigo panelled wall with gilt frames, the bench against it
G.box("wall_n", (2 * GX - 0.1, H_GLASS, 0.06), (0, (TOP + FLOOR) / 2, CZ - GZ), "g_indigo", 0.02, 2)
for x in (-1.0, 1.0):
    G.box(f"panel_frame_{x}", (1.6, 1.5, 0.03), (x, FLOOR + 1.35, CZ - GZ + 0.04), "g_gold", 0.02, 2)
G.box("door_handle", (0.06, 0.22, 0.04), (GX + 0.06, FLOOR + 1.15, CZ), "g_gold", 0.01, 1)
# the roof: a gable (ridge along x), gilt ridge and finials, a lantern globe
for sz in (-1, 1):
    G.box(f"roof_{sz}", (2 * GX + 0.5, 0.09, 1.5), (0, TOP + 0.38, CZ + sz * 0.72), "g_indigo", 0.02, 2, rot_x=sz * 24.0)
G.cyl("ridge", (-GX - 0.25, TOP + 0.75, CZ), (GX + 0.25, TOP + 0.75, CZ), 0.07, 0.07, "g_gold", 8)
for sx in (-1, 1):
    G.ellipsoid(f"finial_{sx}", (sx * (GX + 0.3), TOP + 0.78, CZ), (0.1, 0.1, 0.1), "g_gold", seg=8, rings=6)
G.cyl("eave_s", (-GX - 0.25, TOP + 0.02, CZ + GZ + 0.25), (GX + 0.25, TOP + 0.02, CZ + GZ + 0.25), 0.05, 0.05, "g_gold", 6)
G.cyl("eave_n", (-GX - 0.25, TOP + 0.02, CZ - GZ - 0.25), (GX + 0.25, TOP + 0.02, CZ - GZ - 0.25), 0.05, 0.05, "g_gold", 6)
G.ellipsoid("lantern_globe", (0, TOP + 0.95, CZ), (0.17, 0.17, 0.17), "g_lamp", seg=10, rings=8)
# the hanger: an arm from the pivot out over the cabin, two rods down to the roof ridge
G.cyl("arm", (0, 0.0, 0), (0, 0.0, CZ), 0.09, 0.09, "g_gold", 8)
for sx in (-1, 1):
    G.cyl(f"rod_{sx}", (sx * 0.9, TOP + 0.75, CZ), (0, 0.0, CZ), 0.05, 0.05, "g_steel", 8)
G.cyl("rod_c", (0, 0.0, CZ), (0, TOP + 0.95, CZ), 0.05, 0.05, "g_steel", 8)
G.ellipsoid("pivot_ring", (0, 0.0, 0), (0.17, 0.17, 0.17), "g_gold", seg=10, rings=6)
# the cabin's own light and bulbs along the eaves
G.ellipsoid("cabin_bulb", (0, TOP - 0.2, CZ), (0.12, 0.12, 0.12), "g_lamp", seg=8, rings=6)
for k in range(9):
    G.ellipsoid(f"eave_bulb_{k}", (-GX + k * (2 * GX / 8), TOP - 0.02, CZ + GZ + 0.2), (0.06, 0.06, 0.06), "g_lamp", seg=6, rings=4)
# the bench: a velvet cushion and a low back along the north wall, gold buttons
G.box("bench_base", (2 * GX - 0.2, 0.4, 0.5), (0, FLOOR + 0.26, CZ - 0.5), "g_wood", 0.02, 1)
G.box("cushion", (2 * GX - 0.2, 0.14, 0.52), (0, FLOOR + 0.5, CZ - 0.5), "g_velvet", 0.04, 2)
G.box("back", (2 * GX - 0.2, 0.55, 0.12), (0, FLOOR + 0.9, CZ - 0.78), "g_velvet", 0.05, 2)
for k in range(8):
    G.ellipsoid(f"button_{k}", (-1.75 + k * 0.5, FLOOR + 0.95, CZ - 0.71), (0.03, 0.03, 0.03), "g_gold", seg=6, rings=4)
G.export("wheel_gondola.glb", 50.0, ao=True)
