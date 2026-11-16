"""Proposed lake layout (design draft, 2026-11-16). Shared by plan_svg.py and blockout.py.
Village frame: x east, z south (-z = north), metres. Walk floor y = 0. Water surface y = -0.55."""
import math

AREA = {"minX": 95.5, "maxX": 186.0, "minZ": -69.5, "maxZ": 45.5}
WATER_Y = -0.55

# shoreline (water edge), clockwise from the north-west
SHORE = [(113, -44), (120, -53), (133, -58), (150, -57), (165, -50), (175, -36), (178, -18), (176, 0),
         (179, 14), (171, 27), (155, 34), (138, 33), (124, 28), (115, 19), (111, 6), (112, -8), (111, -24), (110, -36)]

# walkable ground outside the water (polygon); everything else in AREA is blocked (hills, forest, reeds)
WALK = [(95.5, -66), (152, -66), (152, -58), (157, 34.5), (157, 43), (95.5, 43)]   # outer limit; minus water+0.8 m bank, plus decks

TRAIL = [(38.5, 1.0), (52, 0.2), (66, -6), (80, -9), (95.5, -10), (106, -12)]   # lane_lake, 2.5 m

PIER = {"minX": 106, "maxX": 140, "minZ": -13.5, "maxZ": -10.5}               # 잔교 (deck y 0)
PIER_T = {"minX": 140, "maxX": 146, "minZ": -18, "maxZ": -6}                   # T-end
WALKWAY_A = {"minX": 142.1, "maxX": 143.9, "minZ": -26, "maxZ": -18}            # 부교 to 좌대 A
WALKWAY_B = {"minX": 142.1, "maxX": 143.9, "minZ": -6, "maxZ": 2}
JWADAE_A = {"minX": 139.0, "maxX": 147.0, "minZ": -33, "maxZ": -26}            # 좌대 A (8 x 7)
JWADAE_B = {"minX": 139.0, "maxX": 147.0, "minZ": 2, "maxZ": 9}
HUT_A = {"minX": 141.5, "maxX": 144.5, "minZ": -30.5, "maxZ": -28.0}           # hut on the 좌대 (solid, 3 x 2.5)
HUT_B = {"minX": 141.5, "maxX": 144.5, "minZ": 4.5, "maxZ": 7.0}

SHOP = {"minX": 98.0, "maxX": 106.0, "minZ": -25.0, "maxZ": -19.5}             # 관리소 겸 대여점 (8 x 5.5)
RENTAL_PAD = (102.0, -16.8)                                                     # stand here, window faces south
PAVILION = {"centre": (112.0, 33.5), "size": 6.0}                               # 정자 (south-west shore)

def _spots():
    s = []
    n = 1
    for x in (111, 115, 119, 123, 127, 131, 135):          # pier, both sides (14)
        s.append((f"P{n:02d}", x + 2, -13.5, "n")); n += 1
        s.append((f"P{n:02d}", x + 2, -10.5, "s")); n += 1
    s.append(("P15", 146, -15, "e")); s.append(("P16", 146, -9, "e"))
    s += [("A1", 141, -33, "n"), ("A2", 145, -33, "n"), ("A3", 139, -29.5, "w"), ("A4", 147, -29.5, "e")]
    s += [("B1", 141, 9, "s"), ("B2", 145, 9, "s"), ("B3", 139, 5.5, "w"), ("B4", 147, 5.5, "e")]
    s += [("N1", 115.5, -50.5, "se"), ("N2", 129, -59.5, "s"), ("N3", 142, -60, "s")]
    s += [("S1", 121.5, 30.5, "ne"), ("S2", 133, 35.0, "n"), ("S3", 147, 36.5, "n")]
    return s
SPOTS = _spots()   # 30 = the room's capacity
FACE = {"n": (0, -1), "s": (0, 1), "e": (1, 0), "w": (-1, 0), "ne": (0.7071, -0.7071), "se": (0.7071, 0.7071)}
CAST_M = 6.0       # float lands ~6 m out (rod 3.6 m + line)

BENCHES = [(104.5, -32, "e"), (104.5, 2, "e"), (104.5, 10, "e")]               # backed, face the water
PICNIC = [(99.5, 4.5), (99.5, 12.5)]                                            # backless (either side)
LAMPS = [(110, -15.2), (120, -15.2), (130, -15.2), (140, -19.0), (103, -14.5), (108, 0)]
REEDS = [((112, -40), 4.5), ((123, 24), 6), ((170, -40), 9), ((174, 18), 8), ((112, 12), 3.5), ((160, 32), 6)]

def poly_area(p):
    return 0.5 * abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(p, p[1:] + p[:1])))

def inside(p, poly):
    x, z = p; c = False
    for (x1, z1), (x2, z2) in zip(poly, poly[1:] + poly[:1]):
        if (z1 > z) != (z2 > z) and x < x1 + (z - z1) * (x2 - x1) / (z2 - z1):
            c = not c
    return c

def in_box(p, b):
    return b["minX"] <= p[0] <= b["maxX"] and b["minZ"] <= p[1] <= b["maxZ"]

DECKS = [PIER, PIER_T, WALKWAY_A, WALKWAY_B, JWADAE_A, JWADAE_B]

def check():
    bad = []
    for sid, x, z, f in SPOTS:
        on_deck = any(in_box((x, z), d) for d in DECKS)
        on_land = inside((x, z), WALK) and not inside((x, z), SHORE)
        fx, fz = FACE[f]
        tgt = (x + fx * CAST_M, z + fz * CAST_M)
        if not (on_deck or on_land) or not inside(tgt, SHORE) or any(in_box(tgt, d) for d in DECKS):
            bad.append((sid, on_deck, on_land, tgt))
    # floats at least 3 m apart
    fl = [(sid, x + FACE[f][0] * CAST_M, z + FACE[f][1] * CAST_M) for sid, x, z, f in SPOTS]
    for i in range(len(fl)):
        for j in range(i + 1, len(fl)):
            d = ((fl[i][1] - fl[j][1]) ** 2 + (fl[i][2] - fl[j][2]) ** 2) ** 0.5
            if d < 3.0:
                bad.append(("close", fl[i][0], fl[j][0], round(d, 2)))
    return bad
