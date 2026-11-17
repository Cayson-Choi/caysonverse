"""L4 케이슨랜드 정문 (lot_gate) — lots v2 B3 polish (2026-11-17): moved from feat/lot-mart-gate 75ab7df onto gate_base.py (KTX2 PBR
library sets, metre UVs, no grime), the ticket-price boards replaced by a word-free picture map of the park, benches fitted to
the seat boxes. Geometry, positions, colliders, seats and slot names unchanged.

L4 케이슨랜드 정문 (lot_gate) — the grand gate kit, pure python (no bpy). LOCAL frame (contract 1, door side north): x = the
right hand of someone walking in (south) (= world -x), z = out of the front (= world -z, toward the bridge), y up. The gate line is
z -6..-3.4 (world z 92.6..95, the walk bounds' south edge); the plaza z -3.4..6 is walkable; the park lies beyond (z < -6).

Contract 11 (L4 exception, coordinator 2026-11-17): shell <= 4k, detail <= 25k; colliders appended for the wings, the corner
domes, the barrier, the fountain, the planters and the lamp posts. Real composition (refs: SOURCES_lot_mart_gate.md — Everland,
Gyeongju World, Tokyo Disneyland, Universal Studios Florida, Seoul Land ticket entrance, theme-park turnstiles):
- two domed main towers (ashlar shaft, an open belvedere with lanterns, an octagonal drum, a ribbed copper-green dome, a gilded
  finial, 16.5 m) carrying a tall arch and a lit marquee: a navy crest bordered with bulbs, the 3D name "케이슨랜드", a star;
- arcade wings either side: three arched bays each with a ticket window (shutters down, the ticket board), a bulb frieze, a
  cornice and a balustrade with urns; a domed corner tower at each wing's end;
- the closed gate: tall wrought-iron leaves, and in front a belt barrier with a "곧 문을 열어요" stand;
- the plaza: a roundabout fountain (octagonal basin, two-tier bowls, jets, flower corners), two big planters with tiered
  topiary and flowers, four Victorian lamp posts with flag lines (pennants) strung to the towers, two benches;
- beyond the bars (unreachable): the turnstile bank in lanes with stainless rails under a canopy, hedges, topiary trees, flag
  poles, and at a distance the park's Ferris wheel and a coaster's lift hill (`lotdetail__lot_gate_backdrop`).
Night: marquee and arch bulbs, glowing letters, belvedere lanterns, dome uplights, the wings' bulb friezes, lamp globes, the
fountain's underwater lights, the turnstile canopy and the wheel's rim lights.
"""
import math

from gate_base import (BaseKit, GL, GR, LP, Mesh, OK, PL, RF, RN, SC, SE, SS, ST, WD, cell, cquad, cuv, lin, prof_box,
                     prof_round, shrub, soil_disc)

ZB, ZF = -6.0, -3.6       # the gate line: back (park side) / main towers' front
ZW = -3.45                # the wings' front wall (their collider runs to -3.4)
TX0, TX1 = 3.0, 4.4       # main tower x (mirrored)
TCZ = -4.8                # main tower centre z
SPRING, CROWN = 6.4, 7.7  # main arch
ENT = 8.6                 # top of the arch's entablature
WING_H = 5.0
CTX, CTZ, CTR = 9.28, -4.17, 0.72  # corner tower centre (mirrored x) and radius
C_IRON = lin(0.04, 0.05, 0.06)
C_GOLD = lin(0.78, 0.58, 0.20)
C_DOME = lin(0.20, 0.44, 0.38)
C_CREAM = lin(0.92, 0.86, 0.72)
C_RED = lin(0.72, 0.08, 0.08)
C_NAVY = lin(0.07, 0.11, 0.33)
C_LAMP = lin(0.07, 0.16, 0.13)
C_STONE = lin(0.95, 0.93, 0.90)


def ring_pts(cx, cz, r, n, phase=0.0):
    return [(cx + r * math.cos(phase + 2 * math.pi * i / n), cz - r * math.sin(phase + 2 * math.pi * i / n)) for i in range(n)]


class GateKit(BaseKit):
    INSTANCED = ("bulb", "baluster", "pennant", "turnstile", "lamp", "urn")
    MAXW = {"케이슨랜드": 5.5, "곧 문을 열어요": 0.86}

    # ------------------------------------------------------------------------------------------ kinds --
    def kinds_all(self):
        K = self.kinds
        b = Mesh("bulb")  # a round marquee bulb (origin at its base on the wall, the bulb along +z)
        b.lathe([(0.0, 0.0), (0.04, 0.02), (0.045, 0.05), (0.025, 0.085), (0.0, 0.09)], 6, LP)
        K["bulb"] = b.transformed(lambda p: (p[0], -p[2], p[1]))
        bal = Mesh("baluster")  # a stone baluster 0.62 tall
        bal.lathe([(0.07, 0.0), (0.06, 0.06), (0.04, 0.14), (0.085, 0.3), (0.05, 0.48), (0.07, 0.56), (0.07, 0.62)], 6,
                  GR.tint(C_STONE), cap_top=True)
        K["baluster"] = bal
        pen = Mesh("pennant")  # a triangular pennant hanging from the line (origin at the line), both faces
        q = [(-0.14, 0.0, 0.0), (0.14, 0.0, 0.0), (0.0, -0.32, 0.0)]
        uv = [cuv("flag", 0.0, 1.0), cuv("flag", 1.0, 1.0), cuv("flag", 0.5, 0.0)]
        pen.poly(q, cell("flag"), uv)
        pen.poly(list(reversed(q)), cell("flag"), list(reversed(uv)))
        K["pennant"] = pen
        ts = Mesh("turnstile")  # a stainless tripod turnstile cabinet with its three arms (closed) and a red lane light
        ts.box(-0.14, 0.14, 0.0, 1.0, -0.5, 0.5, SS, skip=("-y",))
        ts.box(-0.15, 0.15, 1.0, 1.03, -0.52, 0.52, PL.tint(lin(0.1, 0.1, 0.12)), skip=("-y",))
        ts.box(-0.1, 0.1, 1.03, 1.05, 0.08, 0.3, PL.tint(lin(0.6, 0.06, 0.05)))
        hub = (0.15, 0.85, 0.15)
        for k in range(3):
            a = k * 2 * math.pi / 3 + 0.3
            ts.member(hub, (hub[0] + 0.5 * max(0.25, math.cos(a)), hub[1] + 0.45 * math.sin(a), hub[2] + 0.04), prof_round(0.018, 5), SS)
        K["turnstile"] = ts
        lamp = Mesh("lamp")  # a Victorian twin-lantern lamp post 3.85 m (base r 0.19 inside its 0.4 m collider)
        g = ST.tint(C_LAMP)
        lamp.lathe([(0.19, 0.0), (0.19, 0.12), (0.15, 0.2), (0.15, 0.55), (0.1, 0.65), (0.075, 0.75)], 8, g)
        lamp.lathe([(0.07, 0.75), (0.055, 3.4), (0.07, 3.48), (0.07, 3.55)], 8, g)
        for sx in (-1, 1):
            lamp.member((0.0, 3.5, 0.0), (sx * 0.45, 3.62, 0.0), prof_round(0.025, 5), g)
            lamp.member((sx * 0.45, 3.62, 0.0), (sx * 0.45, 3.5, 0.0), prof_round(0.015, 4), g)
            lamp.lathe([(0.0, 3.12), (0.13, 3.2), (0.15, 3.33), (0.12, 3.46), (0.0, 3.5)], 8, LP, cx=sx * 0.45)
        lamp.lathe([(0.0, 3.55), (0.06, 3.62), (0.0, 3.85)], 6, SS.tint(C_GOLD))
        K["lamp"] = lamp
        urn = Mesh("urn")  # a stone urn with a flowering shrub (on the balustrade's pedestals)
        urn.lathe([(0.1, 0.0), (0.08, 0.08), (0.2, 0.22), (0.24, 0.36), (0.24, 0.4)], 8, GR.tint(C_STONE))
        shrub(urn, 0.0, 0.34, 0.0, 0.26, 0.38, 0.26, n=7, rings=3, seed=3)
        K["urn"] = urn

    # ---------------------------------------------------------------------------------------- towers --
    def main_tower(self, sx):
        S, D = self.S, self.D
        x0, x1 = (TX0, TX1) if sx > 0 else (-TX1, -TX0)
        z0, z1 = ZB, ZF
        cx, cz = (x0 + x1) / 2, TCZ
        S.box(x0, x1, 0.0, 0.8, z0, z1, GR.tint(lin(0.9, 0.88, 0.85)), skip=("-y",))
        S.box(x0, x1, 0.8, 9.0, z0, z1, SC.u((1, 0, 0)), skip=("-y", "+y"))
        for xq in (x0, x1):  # rusticated quoins on the front corners (granite, flush to 8 mm)
            for k in range(8):
                y = 0.9 + k * 1.0
                w = 0.3 if k % 2 == 0 else 0.2
                xa = xq if xq == x0 else x1 - w
                S.box(xa, xa + w, y, y + 0.9, z1 - 0.02, z1 + 0.008, GR.tint(C_STONE), skip=("-z", "-y"))
        S.box(x0 - 0.1, x1 + 0.1, 9.0, 9.3, z0 - 0.1, z1 + 0.1, GR.tint(C_STONE))
        for (a, b) in ((x0, x0 + 0.3), (x1 - 0.3, x1)):  # belvedere piers (an open stage with a lantern)
            for (c, d) in ((z0, z0 + 0.35), (z1 - 0.35, z1)):
                S.box(a, b, 9.3, 11.6, c, d, SC, skip=("-y", "+y"))
        S.box(x0 - 0.14, x1 + 0.14, 11.6, 12.0, z0 - 0.14, z1 + 0.14, GR.tint(C_STONE))
        D.member((cx, 9.3, cz), (cx, 9.9, cz), prof_round(0.05, 6), ST.tint(C_IRON))
        D.lathe([(0.18, 9.9), (0.25, 10.3), (0.23, 10.7), (0.08, 10.85)], 8, LP, cx=cx, cz=cz)
        self.glow("lanterns").lathe([(0.19, 9.89), (0.26, 10.3), (0.24, 10.71), (0.0, 10.87)], 8, SE.tint((1.0, 0.82, 0.55)), cx=cx, cz=cz)
        self.lights.append(("point_lantern", cx, 10.3, cz, (1.0, 0.8, 0.5), 260))
        # octagonal drum, the ribbed dome (copper-green with gilded ribs), the finial
        r = 0.66
        oct_ = ring_pts(cx, cz, r, 8, math.pi / 8)
        for i in range(8):
            (xa, za), (xb, zb) = oct_[i], oct_[(i + 1) % 8]
            S.poly([(xa, 12.0, za), (xb, 12.0, zb), (xb, 13.0, zb), (xa, 13.0, za)], RN.tint(C_CREAM))
        S.lathe([(r + 0.08, 13.0), (r + 0.08, 13.12)], 8, GR.tint(C_STONE), cx=cx, cz=cz, phase=math.pi / 8)
        prof = [(r + 0.04, 13.12), (r * 0.98, 13.7), (r * 0.86, 14.3), (r * 0.62, 14.85), (r * 0.3, 15.3), (0.0, 15.45)]
        rings = [ring_pts(cx, cz, rr, 16) for rr, _ in prof]
        for k in range(len(prof) - 1):
            for i in range(16):
                j = (i + 1) % 16
                (ax, az), (bx, bz) = rings[k][i], rings[k][j]
                (cx2, cz2), (dx, dz) = rings[k + 1][j], rings[k + 1][i]
                ya, yb = prof[k][1], prof[k + 1][1]
                col = C_DOME if i % 4 else C_GOLD
                pts = [(ax, ya, az), (bx, ya, bz), (cx2, yb, cz2), (dx, yb, dz)]
                if prof[k + 1][0] < 1e-6:
                    pts = pts[:3]
                S.poly(pts, RF.tint(col).u((0, 1, 0)), smooth=True)
        D.lathe([(0.0, 15.44), (0.06, 15.5), (0.04, 15.7), (0.13, 15.85), (0.1, 16.0), (0.03, 16.1), (0.0, 16.5)], 8, SS.tint(C_GOLD), cx=cx, cz=cz)
        self.lights.append(("spot_up", cx, 12.1, cz + 0.9, (1.0, 0.85, 0.6), 250, 0, (cx, 15.0, cz)))
        for xs in (x0 + 0.35, x1 - 0.35):  # in-ground uplights washing the tower face (flush discs)
            D.cyl(xs, z1 + 0.4, 0.09, 0.0, 0.015, 8, SS)
            self.glow("uplights").disc(xs, 0.016, z1 + 0.4, 0.07, 8, SE.tint((1.0, 0.9, 0.7)))
            self.lights.append(("spot_up", xs, 0.1, z1 + 0.4, (1.0, 0.85, 0.6), 500, 0, (xs, 8.0, z1 - 0.05)))
        # a long fabric banner on the plaza face (2.8 .. 7.9 m)
        bx0, bx1 = x0 + 0.28, x1 - 0.28
        D.member((bx0 - 0.06, 7.95, z1 + 0.08), (bx1 + 0.06, 7.95, z1 + 0.08), prof_round(0.022, 5), SS.tint(C_GOLD))
        pts = [(bx0, 3.1, z1 + 0.07), (bx1, 3.1, z1 + 0.07), (bx1, 7.93, z1 + 0.07), (bx0, 7.93, z1 + 0.07)]
        cquad(D, pts, "flag")
        D.poly([pts[0], pts[1], ((bx0 + bx1) / 2, 2.8, z1 + 0.07)][::-1], cell("flag"),
               [cuv("flag", 0, 0), cuv("flag", 1, 0), cuv("flag", 0.5, 0)][::-1])
        # the park map on the tower's inner face under the arch (flush) and a wall lantern
        xi = x0 if sx > 0 else x1
        dx = -1 if sx > 0 else 1
        xm = xi + dx * 0.006
        mp = [(xm, 1.1, z0 + 0.5), (xm, 1.1, z1 - 0.5), (xm, 2.5, z1 - 0.5), (xm, 2.5, z0 + 0.5)]
        cquad(D, mp if sx > 0 else [mp[1], mp[0], mp[3], mp[2]], "park_map", *((0, 0, 1, 1) if sx > 0 else (1, 0, 0, 1)))
        D.member((xi, 4.0, TCZ), (xi + dx * 0.45, 4.0, TCZ), prof_box(0.03, 0.05), ST.tint(C_IRON))
        lx = xi + dx * 0.45
        D.lathe([(0.0, 3.35), (0.1, 3.4), (0.12, 3.65), (0.1, 3.82), (0.03, 3.9)], 6, LP, cx=lx, cz=TCZ)
        self.glow("lanterns").lathe([(0.0, 3.34), (0.11, 3.4), (0.13, 3.65), (0.0, 3.85)], 6, SE.tint((1.0, 0.8, 0.5)), cx=lx, cz=TCZ)
        self.lights.append(("point_lantern", lx, 3.6, TCZ, (1.0, 0.78, 0.5), 70))

    def corner_tower(self, sx):
        """The domed corner tower at the wing's end (round, cream render on a stone base, stone bands, a small dome, a flag)."""
        S, D = self.S, self.D
        cx, cz, r = CTX * sx, CTZ, CTR
        n = 12
        S.lathe([(r + 0.0, 0.0), (r + 0.0, 1.0)], n, SC, cx=cx, cz=cz)
        S.lathe([(r - 0.02, 1.0), (r - 0.02, 7.6)], n, RN.tint(C_CREAM), cx=cx, cz=cz)
        for y in (3.4, 5.5):
            S.lathe([(r + 0.04, y), (r + 0.04, y + 0.18)], n, GR.tint(C_STONE), cx=cx, cz=cz)
        S.lathe([(r + 0.12, 7.6), (r + 0.12, 7.9), (r - 0.02, 7.95)], n, GR.tint(C_STONE), cx=cx, cz=cz)
        prof = [(r - 0.02, 7.95), (r * 0.95, 8.6), (r * 0.72, 9.25), (r * 0.36, 9.7), (0.0, 9.8)]
        for k in range(len(prof) - 1):
            S.lathe([prof[k], prof[k + 1]], n, RF.tint(C_DOME if k % 2 == 0 else C_GOLD).u((0, 1, 0)), cx=cx, cz=cz)
        D.lathe([(0.0, 9.78), (0.05, 9.85), (0.1, 10.0), (0.03, 10.15), (0.0, 10.9)], 6, SS.tint(C_GOLD), cx=cx, cz=cz)
        # narrow arched windows on the plaza side (glass in a flush stone frame); the top one glows at night
        wz = cz + r + 0.002
        for y0 in (2.0, 4.1, 6.0):
            D.poly([(cx - 0.16, y0, wz), (cx + 0.16, y0, wz), (cx + 0.16, y0 + 0.9, wz), (cx, y0 + 1.06, wz), (cx - 0.16, y0 + 0.9, wz)], GL)
            D.box(cx - 0.2, cx + 0.2, y0 - 0.06, y0, wz - 0.01, wz + 0.006, GR.tint(C_STONE))
        self.glow("towers").poly([(cx - 0.14, 6.05, wz + 0.003), (cx + 0.14, 6.05, wz + 0.003), (cx + 0.14, 6.88, wz + 0.003),
                                  (cx, 7.02, wz + 0.003), (cx - 0.14, 6.88, wz + 0.003)], SE.tint((1.0, 0.8, 0.5)))
        D.member((cx, 10.8, cz), (cx, 12.5, cz), prof_round(0.025, 5), SS.tint(lin(0.85, 0.85, 0.85)))
        self.flag(D, cx, 12.4, cz, -1.2 * sx, 0.75)  # B3: the flag flies inward (stays inside the footprint)

    # ------------------------------------------------------------------------------- arch and marquee --
    def arch(self):
        S, D = self.S, self.D
        z0, z1 = ZB + 0.4, ZF - 0.3
        n = 12
        half = TX0
        r = (half ** 2 + (CROWN - SPRING) ** 2) / (2 * (CROWN - SPRING))
        cy = CROWN - r
        prof = [(x, cy + math.sqrt(r * r - x * x)) for x in [-half + 2 * half * i / n for i in range(n + 1)]]
        g = self.glow("marquee")
        for i in range(n):
            (xa, ya), (xb, yb) = prof[i], prof[i + 1]
            S.poly([(xa, ya, z0), (xb, yb, z0), (xb, yb, z1), (xa, ya, z1)], SC.u((0, 0, 1)))
            S.poly([(xa, ya, z1), (xb, yb, z1), (xb, ENT, z1), (xa, ENT, z1)], SC)
            D.poly([(xb, yb, z0), (xa, ya, z0), (xa, ENT, z0), (xb, ENT, z0)], SC)
            D.poly([(xa, ya, z1 + 0.05), (xb, yb, z1 + 0.05), (xb, yb + 0.42, z1 + 0.05), (xa, ya + 0.42, z1 + 0.05)], GR.tint(C_STONE))
        for x, y in prof[1:-1]:  # bulbs along the voussoir band
            self.place("bulb", x, y + 0.21, z1 + 0.05)
            g.lathe([(0.0, -0.05), (0.05, 0.0), (0.0, 0.05)], 4, SE.tint((1.0, 0.82, 0.5)), cx=x, cz=z1 + 0.12, y0=y + 0.21)
        D.box(-0.3, 0.3, CROWN - 0.05, CROWN + 0.75, z1, z1 + 0.14, GR.tint(C_STONE), skip=("-z",))  # keystone
        S.box(-TX0, TX0, ENT, ENT + 0.3, z0 - 0.1, z1 + 0.2, GR.tint(C_STONE), skip=("-y",))  # entablature cornice
        # the marquee crest (navy, gold rim, bulb border), segmental top 11.9 .. 12.8 m, the 3D name
        cz0, cz1 = z1 - 0.32, z1 - 0.04
        yb0 = ENT + 0.3
        k = 10
        w = TX0 - 0.05
        arcs = [(w - 2 * w * i / k, 11.9 + 0.9 * math.cos(math.pi / 2 * (w - 2 * w * i / k) / w)) for i in range(k + 1)]
        outline = [(-w, yb0), (w, yb0)] + arcs
        S.poly([(x, y, cz1) for x, y in outline], ST.tint(C_NAVY))
        D.poly([(x, y, cz0) for x, y in reversed(outline)], ST.tint(C_NAVY))
        for i in range(len(outline)):
            (xa, ya), (xb, yb) = outline[i], outline[(i + 1) % len(outline)]
            q = [(xa, ya, cz0), (xb, yb, cz0), (xb, yb, cz1 + 0.06), (xa, ya, cz1 + 0.06)]
            D.poly(q, SS.tint(C_GOLD))
            D.poly(q[::-1], SS.tint(C_GOLD))
        border = []
        for i in range(len(arcs) - 1):
            (xa, ya), (xb, yb) = arcs[i], arcs[i + 1]
            for t in (0.0, 0.5):
                border.append((xa + (xb - xa) * t, ya + (yb - ya) * t - 0.17))
        for i in range(12):
            border.append((-(w - 0.2) + 2 * (w - 0.2) * i / 11, yb0 + 0.16))
        for i in range(1, 5):
            y = yb0 + 0.16 + (11.75 - yb0 - 0.16) * i / 5
            border += [(-(w - 0.17), y), (w - 0.17, y)]
        for x, y in border:
            self.place("bulb", x, y, cz1)
            g.lathe([(0.0, -0.05), (0.05, 0.0), (0.0, 0.05)], 4, SE.tint((1.0, 0.86, 0.55)), cx=x, cz=cz1 + 0.07, y0=y)
        self.letters.append(("케이슨랜드", "shell", 0.0, 9.6, cz1 + 0.001, 0.0, 1.45, 0.08, lin(0.98, 0.82, 0.38), "letters", (1.0, 0.88, 0.55)))
        star = []
        for i in range(10):
            a = math.pi / 2 + i * math.pi / 5
            rr = 0.55 if i % 2 == 0 else 0.23
            star.append((rr * math.cos(a), 13.2 + rr * math.sin(a)))
        D.poly([(x, y, cz1 + 0.04) for x, y in star], SS.tint(C_GOLD))
        D.poly([(x, y, cz0 - 0.02) for x, y in reversed(star)], SS.tint(C_GOLD))
        g.poly([(x, y, cz1 + 0.045) for x, y in star], SE.tint((1.0, 0.8, 0.35)))
        self.lights.append(("point_arch", 0.0, 10.4, z1 + 1.6, (1.0, 0.85, 0.55), 420))
        self.lights.append(("point_arch", 0.0, 6.0, z1 + 1.2, (1.0, 0.82, 0.5), 180))

    # ------------------------------------------------------------------------------------- the wings --
    def wing(self, sx):
        """Arcade wing (x 4.4 .. 9.6 mirrored): stone plinth, cream render, three arched bays with ticket windows, a bulb
        frieze, a cornice and a balustrade with urns on pedestals."""
        S, D = self.S, self.D
        xa, xb = 4.4, 9.6

        def X(x):
            return x * sx

        def wpoly(pts, m, mesh=None):
            pts = [(X(p[0]), p[1], p[2]) for p in pts]
            (mesh or S).poly(pts if sx > 0 else pts[::-1], m)
        bays = [5.25, 6.55, 7.85]
        bw, top, ra = 1.0, 2.75, 0.5
        edges = [xa]
        for c in bays:
            edges += [c - bw / 2, c + bw / 2]
        edges.append(xb)
        for i in range(0, len(edges), 2):  # piers between the openings, up to the arches' springing
            a, b = edges[i], edges[i + 1]
            wpoly([(a, 0.0, ZW), (b, 0.0, ZW), (b, 0.9, ZW), (a, 0.9, ZW)], SC)
            wpoly([(a, 0.9, ZW), (b, 0.9, ZW), (b, top, ZW), (a, top, ZW)], RN.tint(C_CREAM))
        for c in bays:
            arc = [(c - ra * math.cos(math.pi * t / 8), top + ra * math.sin(math.pi * t / 8)) for t in range(9)]
            for (x1_, y1_), (x2_, y2_) in zip(arc, arc[1:]):
                wpoly([(x1_, y1_, ZW), (x2_, y2_, ZW), (x2_, 3.9, ZW), (x1_, 3.9, ZW)], RN.tint(C_CREAM))
                wpoly([(x2_, y2_, ZW), (x1_, y1_, ZW), (x1_, y1_, ZW - 0.35), (x2_, y2_, ZW - 0.35)], RN.tint(lin(0.85, 0.8, 0.68)))
                k1, k2 = 1.24, 1.24  # a granite archivolt round the arch on the face
                wpoly([(x1_, y1_, ZW + 0.03), (x2_, y2_, ZW + 0.03), (c + (x2_ - c) * k2, top + (y2_ - top) * k2, ZW + 0.03),
                       (c + (x1_ - c) * k1, top + (y1_ - top) * k1, ZW + 0.03)], GR.tint(C_STONE), D)
            for xe, s_ in ((c - bw / 2, 1), (c + bw / 2, -1)):  # straight jambs of the recess
                pts = [(xe, 0.0, ZW), (xe, 0.0, ZW - 0.35), (xe, top, ZW - 0.35), (xe, top, ZW)]
                wpoly(pts if s_ > 0 else pts[::-1], SC)
            # the recess back: stone panel, the ticket window, the counter, the shutter (down), the fanlight, the board
            wpoly([(c - bw / 2, 0.0, ZW - 0.35), (c + bw / 2, 0.0, ZW - 0.35), (c + bw / 2, 0.95, ZW - 0.35), (c - bw / 2, 0.95, ZW - 0.35)], SC, D)
            wpoly([(c - bw / 2, 2.25, ZW - 0.35), (c + bw / 2, 2.25, ZW - 0.35), (c + bw / 2, top, ZW - 0.35), (c - bw / 2, top, ZW - 0.35)], RN.tint(C_CREAM), D)
            arcb = [(c - ra * math.cos(math.pi * t / 8), top + ra * math.sin(math.pi * t / 8)) for t in range(9)]
            wpoly([(x, y, ZW - 0.35) for x, y in arcb], GL, D)
            # the booth room behind the glass (dark, a counter shelf): no daylight through the wing
            wpoly([(c - bw / 2, 0.9, ZW - 1.3), (c + bw / 2, 0.9, ZW - 1.3), (c + bw / 2, top + ra, ZW - 1.3), (c - bw / 2, top + ra, ZW - 1.3)],
                  RN.tint(lin(0.25, 0.22, 0.2)), D)
            for xe, s_ in ((c - bw / 2, 1), (c + bw / 2, -1)):
                pts = [(xe, 0.9, ZW - 0.4), (xe, 0.9, ZW - 1.3), (xe, top + ra, ZW - 1.3), (xe, top + ra, ZW - 0.4)]
                wpoly(pts if s_ > 0 else pts[::-1], RN.tint(lin(0.3, 0.27, 0.24)), D)
            wpoly([(c - bw / 2, top + ra, ZW - 0.4), (c + bw / 2, top + ra, ZW - 0.4), (c + bw / 2, top + ra, ZW - 1.3), (c - bw / 2, top + ra, ZW - 1.3)],
                  RN.tint(lin(0.3, 0.27, 0.24)), D)
            wpoly([(c - bw / 2, 0.95, ZW - 0.4), (c + bw / 2, 0.95, ZW - 0.4), (c + bw / 2, 2.25, ZW - 0.4), (c - bw / 2, 2.25, ZW - 0.4)], GL, D)
            D.box(min(X(c - bw / 2), X(c + bw / 2)), max(X(c - bw / 2), X(c + bw / 2)), 0.92, 0.98, ZW - 0.42, ZW - 0.1, GR.tint(C_STONE))
            for k in range(9):
                y = 0.99 + k * 0.14
                wpoly([(c - bw / 2 + 0.02, y, ZW - 0.3), (c + bw / 2 - 0.02, y, ZW - 0.3), (c + bw / 2 - 0.02, y + 0.13, ZW - 0.28),
                       (c - bw / 2 + 0.02, y + 0.13, ZW - 0.28)], SS.tint(lin(0.6, 0.62, 0.64)), D)
            bd = [(X(c - 0.45), 2.3, ZW - 0.33), (X(c + 0.45), 2.3, ZW - 0.33), (X(c + 0.45), 2.72, ZW - 0.33), (X(c - 0.45), 2.72, ZW - 0.33)]
            # B3 2026-11-17 (owner "그런거 없다": no money): the ticket-price board is gone; a little picture map of the park
            # (no words) hangs in its place over the closed shutter
            cquad(D, bd if sx > 0 else [bd[1], bd[0], bd[3], bd[2]], "park_map", 0.0, 0.28, 1.0, 0.72)
            self.lights.append(("point_booth", X(c), 2.6, ZW + 0.6, (1.0, 0.85, 0.6), 20))
        for xp in (4.6, (bays[0] + bays[1]) / 2, (bays[1] + bays[2]) / 2, 8.45):  # pilasters with bases and capitals
            a, b = sorted((X(xp - 0.17), X(xp + 0.17)))
            c, d = sorted((X(xp - 0.12), X(xp + 0.12)))
            D.box(a, b, 0.0, 0.3, ZW, ZW + 0.04, GR.tint(C_STONE), skip=("-y", "-z"))
            D.box(c, d, 0.3, 3.55, ZW, ZW + 0.04, GR.tint(lin(0.9, 0.87, 0.8)), skip=("-y", "+y", "-z"))
            D.box(a, b, 3.55, 3.7, ZW, ZW + 0.05, GR.tint(C_STONE), skip=("-z",))
        # frieze band with bulbs, cornice, the end walls, the balustrade with urns on pedestals
        wpoly([(xa, 3.9, ZW), (xb, 3.9, ZW), (xb, WING_H, ZW), (xa, WING_H, ZW)], RN.tint(lin(0.62, 0.12, 0.10)))
        for i in range(14):
            x = xa + 0.2 + (xb - xa - 0.4) * i / 13
            self.place("bulb", X(x), 4.45, ZW)
            self.glow("wings").lathe([(0.0, -0.05), (0.05, 0.0), (0.0, 0.05)], 4, SE.tint((1.0, 0.84, 0.5)), cx=X(x), cz=ZW + 0.06, y0=4.45)
        S.box(min(X(xa), X(xb)), max(X(xa), X(xb)), WING_H, WING_H + 0.3, ZB, ZW + 0.05, GR.tint(C_STONE), skip=("-y",))
        wpoly([(xa, 0.0, ZB), (xa, 0.0, ZW), (xa, WING_H, ZW), (xa, WING_H, ZB)][::-1], RN.tint(C_CREAM))   # inner side
        wpoly([(xb, 0.0, ZW), (xb, 0.0, ZB), (xb, WING_H, ZB), (xb, WING_H, ZW)][::-1], RN.tint(C_CREAM))   # outer end
        y0 = WING_H + 0.3
        a, b = sorted((X(xa), X(xb)))
        D.box(a, b, y0, y0 + 0.1, ZW - 0.2, ZW + 0.02, GR.tint(C_STONE))
        D.box(a, b, y0 + 0.72, y0 + 0.82, ZW - 0.22, ZW + 0.04, GR.tint(C_STONE))
        for i in range(17):
            x = xa + 0.25 + (xb - xa - 0.5) * i / 16
            if i % 4 == 0:
                c, d = sorted((X(x - 0.14), X(x + 0.14)))
                D.box(c, d, y0 + 0.1, y0 + 0.9, ZW - 0.24, ZW + 0.03, GR.tint(C_STONE))
                self.place("urn", X(x), y0 + 0.9, ZW - 0.1)
            else:
                self.place("baluster", X(x), y0 + 0.1, ZW - 0.09)

    # ------------------------------------------------------------------------------------- the gate --
    def leaves(self):
        """The closed wrought-iron leaves (x -3..3, z -5.9..-5.7 = col__lot_gate_leaves), crown 3.4 m."""
        d = Mesh("door__lot_gate_main")
        iron = ST.tint(C_IRON)
        zc = -5.8
        for sx in (-1, 1):
            xa, xb = (0.0, 2.98) if sx > 0 else (-2.98, 0.0)
            xo, xi = (xb, xa) if sx > 0 else (xa, xb)
            for x in (xa, xb):
                xm = x + (0.04 if x == min(xa, xb) else -0.04)
                d.member((xm, 0.05, zc), (xm, 3.0 if abs(x) > 1 else 3.28, zc), prof_box(0.08, 0.08), iron)
            for y in (0.12, 1.05, 2.35):
                d.member((xa, y, zc), (xb, y, zc), prof_box(0.06, 0.05), iron)
            for k in range(4):
                t0, t1 = k / 4, (k + 1) / 4
                xA, xB = xo + (xi - xo) * t0, xo + (xi - xo) * t1
                d.member((xA, 2.95 + 0.25 * math.sin(math.pi / 2 * t0), zc), (xB, 2.95 + 0.25 * math.sin(math.pi / 2 * t1), zc),
                         prof_box(0.07, 0.05), iron)
            nb = 18
            for i in range(nb):
                x = xa + 0.11 + (xb - xa - 0.22) * i / (nb - 1)
                t = abs(x - xo) / abs(xi - xo)
                ytop = 2.95 + 0.25 * math.sin(math.pi / 2 * t) + 0.12
                d.member((x, 0.12, zc), (x, ytop, zc), prof_box(0.022, 0.022), iron)
                d.poly([(x - 0.03, ytop, zc + 0.012), (x + 0.03, ytop, zc + 0.012), (x, ytop + 0.12, zc)], SS.tint(C_GOLD))
                d.poly([(x + 0.03, ytop, zc - 0.012), (x - 0.03, ytop, zc - 0.012), (x, ytop + 0.12, zc)], SS.tint(C_GOLD))
            mx = (xa + xb) / 2
            ring = [(mx + 0.42 * math.cos(2 * math.pi * i / 12), 1.7 + 0.42 * math.sin(2 * math.pi * i / 12)) for i in range(12)]
            for i in range(12):
                (x1_, y1_), (x2_, y2_) = ring[i], ring[(i + 1) % 12]
                d.member((x1_, y1_, zc), (x2_, y2_, zc), prof_box(0.04, 0.04), SS.tint(C_GOLD))
            st = []
            for i in range(10):
                a = math.pi / 2 + i * math.pi / 5
                rr = 0.3 if i % 2 == 0 else 0.13
                st.append((mx + rr * math.cos(a), 1.7 + rr * math.sin(a)))
            d.poly([(x, y, zc + 0.03) for x, y in st], SS.tint(C_GOLD))
            d.poly([(x, y, zc - 0.03) for x, y in reversed(st)], SS.tint(C_GOLD))
        for k in range(5):  # chain and padlock where the leaves meet
            y = 1.25 + k * 0.07
            d.member((-0.12, y, zc + 0.05), (0.12, y + 0.035, zc + 0.05), prof_round(0.008, 4), SS.tint(lin(0.5, 0.5, 0.5)))
        d.box(-0.05, 0.05, 1.05, 1.2, zc + 0.04, zc + 0.08, SS.tint(C_GOLD))
        self.doors["lot_gate_main"] = d
        self.sweeps.append(("lot_gate_main", (-3.0, 3.0, 0.05, 3.45, -5.9 - 3.0, -5.7)))

    def barrier(self):
        """The closed barrier in front of the leaves (col__lot_gate_barrier, z -5.45..-4.95): stainless belt stanchions with
        red belts and the central stand "곧 문을 열어요" (3D letters on an enamel board)."""
        D = self.D
        z = -5.2
        posts = [-2.85, -1.95, -1.05, 1.05, 1.95, 2.85]
        for x in posts:
            D.cyl(x, z, 0.16, 0.0, 0.03, 10, ST.tint(C_IRON))
            D.member((x, 0.03, z), (x, 0.98, z), prof_round(0.032, 8), SS)
            D.lathe([(0.04, 0.98), (0.045, 1.02), (0.0, 1.05)], 8, SS.tint(C_GOLD), cx=x, cz=z)
        for a, b in zip(posts, posts[1:]):
            if a < 0 < b:
                continue
            D.box(a + 0.035, b - 0.035, 0.86, 0.91, z - 0.006, z + 0.006, PL.tint(C_RED))
        D.box(-0.98, -0.94, 0.0, 1.62, z - 0.03, z + 0.03, SS.tint(C_GOLD))
        D.box(0.94, 0.98, 0.0, 1.62, z - 0.03, z + 0.03, SS.tint(C_GOLD))
        D.box(-0.94, 0.94, 0.95, 1.6, z - 0.02, z + 0.02, ST.tint(C_NAVY))
        D.box(-0.9, 0.9, 0.99, 1.56, z + 0.02, z + 0.026, ST.tint(lin(0.93, 0.9, 0.8)))
        self.letters.append(("곧 문을 열어요", "detail", 0.0, 1.14, z + 0.026, 0.0, 0.2, 0.01, lin(0.08, 0.12, 0.33), None, None))
        D.box(-0.9, 0.9, 1.42, 1.45, z + 0.02, z + 0.027, SS.tint(C_GOLD))
        D.prop("barrier", (-3.0, 3.0, 0, 1.62, -5.45, -4.95), "solid")

    # ------------------------------------------------------------------------------------- the plaza --
    def fountain(self):
        """The roundabout fountain in col__lot_gate_fountain (x -1.6..1.6, z -0.95..2.5): an octagonal granite basin, water,
        a two-tier fountain with a falling curtain and a jet, flowering corners, underwater lights."""
        D = self.D
        cx, cz = 0.0, (-0.95 + 2.5) / 2
        n = 8
        k = 1.0 / math.cos(math.pi / 8)
        outer = [(cx + 1.58 * k * math.cos(math.pi / 8 + 2 * math.pi * i / n), cz - 1.71 * k * math.sin(math.pi / 8 + 2 * math.pi * i / n))
                 for i in range(n)]
        outer = [(max(-1.6, min(1.6, x)), max(-0.95, min(2.5, z))) for x, z in outer]
        inner = [(cx + (x - cx) * 0.86, cz + (z - cz) * 0.86) for x, z in outer]
        for i in range(n):
            (ax, az), (bx, bz) = outer[i], outer[(i + 1) % n]
            (ix, iz), (jx, jz) = inner[i], inner[(i + 1) % n]
            D.poly([(ax, 0.0, az), (bx, 0.0, bz), (bx, 0.5, bz), (ax, 0.5, az)], GR.tint(C_STONE))
            D.poly([(ax, 0.5, az), (bx, 0.5, bz), (jx, 0.5, jz), (ix, 0.5, iz)][::-1], GR.tint(lin(1.0, 0.98, 0.95)))
            D.poly([(ix, 0.1, iz), (jx, 0.1, jz), (jx, 0.5, jz), (ix, 0.5, iz)][::-1], GR.tint(lin(0.7, 0.72, 0.7)))
        D.poly([(x, 0.1, z) for x, z in inner], GR.tint(lin(0.35, 0.45, 0.5)))
        D.poly([(x, 0.4, z) for x, z in inner], GL)
        D.lathe([(0.32, 0.1), (0.26, 0.45), (0.16, 0.6), (0.14, 1.0)], 10, GR.tint(C_STONE), cx=cx, cz=cz)
        D.lathe([(0.14, 1.0), (0.55, 1.08), (0.82, 1.2), (0.84, 1.28)], 14, GR.tint(C_STONE), cx=cx, cz=cz)
        D.disc(cx, 1.24, cz, 0.78, 14, GL)
        D.lathe([(0.84, 1.24), (0.9, 0.9), (0.95, 0.42)], 14, GL, cx=cx, cz=cz)
        D.lathe([(0.1, 1.24), (0.08, 1.75), (0.12, 1.85)], 8, GR.tint(C_STONE), cx=cx, cz=cz)
        D.lathe([(0.12, 1.85), (0.36, 1.92), (0.45, 2.0), (0.46, 2.06)], 12, GR.tint(C_STONE), cx=cx, cz=cz)
        D.disc(cx, 2.03, cz, 0.42, 12, GL)
        D.lathe([(0.46, 2.03), (0.5, 1.7), (0.55, 1.28)], 12, GL, cx=cx, cz=cz)
        D.lathe([(0.0, 2.03), (0.05, 2.2), (0.02, 2.55), (0.0, 2.7)], 6, GL, cx=cx, cz=cz)
        D.lathe([(0.06, 2.06), (0.08, 2.12), (0.0, 2.3)], 6, SS.tint(C_GOLD), cx=cx, cz=cz)
        for (x, z) in ((-1.33, -0.68), (1.33, -0.68), (-1.33, 2.23), (1.33, 2.23)):  # the corners between octagon and box
            soil_disc(D, x, 0.12, z, 0.2, 0.2)
            shrub(D, x, 0.1, z, 0.22, 0.35, 0.22, n=6, rings=2, seed=int((x + 3) * (z + 3) * 10))
        g = self.glow("fountain")
        for x, z in inner[::2]:
            px, pz = cx + (x - cx) * 0.8, cz + (z - cz) * 0.8
            g.disc(px, 0.402, pz, 0.12, 6, SE.tint((0.6, 0.85, 1.0)))
            self.lights.append(("spot_up", px, 0.35, pz, (0.6, 0.85, 1.0), 120, 0, (cx, 2.4, cz)))
        D.prop("fountain", (-1.6, 1.6, 0, 2.7, -0.95, 2.5), "solid")

    def planters(self):
        D = self.D
        for sx in (-1, 1):
            x0, x1, z0, z1 = (4.2, 5.6, 2.6, 4.0) if sx > 0 else (-5.6, -4.2, 2.6, 4.0)
            D.box(x0, x1, 0.0, 0.62, z0, z1, GR.tint(C_STONE), skip=("-y",))
            cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
            soil_disc(D, cx, 0.63, cz, 0.64, 0.64, n=8)
            shrub(D, cx, 0.6, cz, 0.5, 0.55, 0.5, n=8, rings=3, seed=11 + sx)
            D.member((cx, 1.05, cz), (cx, 2.6, cz), prof_round(0.04, 5), WD.tint(lin(0.4, 0.3, 0.2)))
            for (y, r) in ((1.35, 0.42), (1.95, 0.33), (2.45, 0.24)):
                shrub(D, cx, y - r * 0.6, cz, r, r * 1.3, r, n=8, rings=3, seed=int(y * 10) + sx)
            for k in range(6):
                a = 2 * math.pi * k / 6 + 0.5
                shrub(D, cx + 0.52 * math.cos(a), 0.6, cz - 0.52 * math.sin(a), 0.15, 0.2, 0.15, n=5, rings=2, seed=k + 20)
            D.prop("planter %d" % sx, (x0, x1, 0, 2.7, z0, z1), "solid")

    def lamps_and_flaglines(self):
        D = self.D
        posts = [(-9.5, 4.5), (9.5, 4.5), (-9.5, -1.5), (9.5, -1.5)]
        g = self.glow("lamps")
        for x, z in posts:
            self.place("lamp", x, 0.0, z, yaw=math.pi / 2)  # B3: lanterns along z (inside the footprint)
            for s_ in (-1, 1):
                g.lathe([(0.0, 3.11), (0.14, 3.2), (0.16, 3.33), (0.13, 3.46), (0.0, 3.51)], 6, SE.tint((1.0, 0.88, 0.62)), cx=x, cz=z - s_ * 0.45)
            self.lights.append(("point_lamp", x, 3.3, z, (1.0, 0.85, 0.6), 160))
        # flag lines: from each lamp top to a main tower's belvedere and along each side (pennants hang under them)
        lines = [((-9.5, 3.8, 4.5), (-3.7, 9.2, -3.5)), ((9.5, 3.8, 4.5), (3.7, 9.2, -3.5)),
                 ((-9.5, 3.8, -1.5), (-3.7, 8.4, -3.5)), ((9.5, 3.8, -1.5), (3.7, 8.4, -3.5)),
                 ((-9.5, 3.8, 4.5), (-9.5, 3.8, -1.5)), ((9.5, 3.8, 4.5), (9.5, 3.8, -1.5))]
        for a, b in lines:
            L = math.dist(a, b)
            n = max(6, int(L / 0.5))
            sag = 0.04 * L
            pts = [(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t)
                   for t in [i / n for i in range(n + 1)]]
            for p, q in zip(pts, pts[1:]):
                D.member(p, q, prof_round(0.006, 3), PL.tint(lin(0.15, 0.15, 0.15)))
            yaw = math.atan2(-(b[2] - a[2]), b[0] - a[0])
            for p in pts[1:-1]:
                if min(math.dist(p, a), math.dist(p, b)) > 0.7:
                    self.place("pennant", p[0], p[1], p[2], yaw=yaw)

    def benches(self, seats):
        D = self.D
        for s in seats:
            x, z = s["lx"], s["lz"]
            L, Wd, top = s["length"], 0.44, s["seatTop"]  # B3: inside L5's seat box (length x 2 front edges)
            for xs in (x - L / 2 + 0.1, x + L / 2 - 0.42):
                D.box(xs, xs + 0.32, 0.0, top - 0.06, z - Wd / 2 + 0.03, z + Wd / 2 - 0.03, GR.tint(lin(0.88, 0.86, 0.82)), skip=("-y",))
            for i in range(5):
                za = z - Wd / 2 + i * Wd / 5 + 0.006
                D.box(x - L / 2, x + L / 2, top - 0.06, top, za, za + Wd / 5 - 0.012, OK.tint(lin(0.85, 0.66, 0.48)).u((1, 0, 0)))
            D.prop("bench %s" % s["id"], (x - L / 2, x + L / 2, 0, top, z - Wd / 2, z + Wd / 2), "walkover")

    def flag(self, mesh, x, ytop, z, w, h, n=4):
        pts = [(x + w * t, z + 0.12 * math.sin(t * math.pi * 1.5) * (1 if w > 0 else -1)) for t in [i / n for i in range(n + 1)]]
        for i in range(n):
            (xa, za), (xb, zb) = pts[i], pts[i + 1]
            ta, tb = i / n, (i + 1) / n
            q = [(xa, ytop - h, za), (xb, ytop - h + 0.05 * tb, zb), (xb, ytop, zb), (xa, ytop, za)]
            uv = [cuv("flag", ta, 0), cuv("flag", tb, 0), cuv("flag", tb, 1), cuv("flag", ta, 1)]
            mesh.poly(q, cell("flag"), uv)
            mesh.poly(list(reversed(q)), cell("flag"), list(reversed(uv)))

    # --------------------------------------------------------------------- the park side (beyond the line) --
    def park_side(self):
        D = self.D
        D.poly([(-10.0, 0.012, -6.0), (10.0, 0.012, -6.0), (10.0, 0.012, -13.0), (-10.0, 0.012, -13.0)][::-1], GR.tint(lin(0.78, 0.76, 0.72)))
        zt = -10.6  # the turnstile bank: six lanes, stainless lane rails, a canopy with a bulb fascia
        for x in (-3.75, -2.25, -0.75, 0.75, 2.25, 3.75):
            self.place("turnstile", x, 0.0, zt)
        for x in (-4.5, -3.0, -1.5, 0.0, 1.5, 3.0, 4.5):
            for zz in (zt - 1.4, zt + 0.85):
                D.member((x, 0.0, zz), (x, 1.0, zz), prof_round(0.03, 6), SS)
            D.member((x, 1.0, zt - 1.4), (x, 1.0, zt + 0.85), prof_round(0.025, 6), SS)
            D.member((x, 0.55, zt - 1.4), (x, 0.55, zt + 0.85), prof_round(0.018, 6), SS)
        for x in (-4.75, 4.75):
            for zz in (zt - 1.6, zt + 1.05):
                D.member((x, 0.0, zz), (x, 3.3, zz), prof_round(0.07, 8), ST.tint(C_NAVY))
        D.box(-4.9, 4.9, 3.3, 3.42, zt - 1.8, zt + 1.15, ST.tint(C_NAVY))
        D.box(-4.95, 4.95, 3.0, 3.42, zt + 1.15, zt + 1.21, ST.tint(C_RED))
        g = self.glow("park")
        for i in range(12):
            x = -4.6 + 9.2 * i / 11
            self.place("bulb", x, 3.2, zt + 1.21)
            g.lathe([(0.0, -0.05), (0.05, 0.0), (0.0, 0.05)], 4, SE.tint((1.0, 0.84, 0.5)), cx=x, cz=zt + 1.28, y0=3.2)
        self.lights.append(("point_lamp", 0.0, 3.0, zt, (1.0, 0.9, 0.7), 200))
        for (x0, x1) in ((-10.0, -5.0), (5.0, 10.0)):  # hedges behind the wings
            D.box(x0, x1, 0.0, 0.5, -7.1, -6.25, GR.tint(lin(0.85, 0.83, 0.8)), skip=("-y",))
            soil_disc(D, (x0 + x1) / 2, 0.48, -6.67, (x1 - x0) / 2 - 0.05, 0.38, n=8)
            for k in range(4):
                cxk = x0 + (x1 - x0) * (k + 0.5) / 4
                shrub(D, cxk, 0.45, -6.67, (x1 - x0) / 8 + 0.12, 0.8, 0.48, seed=int(cxk * 7) + 3)
        for x in (-7.2, 7.2):  # topiary trees in round planters
            z = -8.4
            D.lathe([(0.45, 0.0), (0.5, 0.5), (0.55, 0.55)], 10, GR.tint(lin(0.85, 0.83, 0.8)), cx=x, cz=z)
            soil_disc(D, x, 0.5, z, 0.48, 0.48, n=10)
            D.member((x, 0.5, z), (x, 2.6, z), prof_round(0.07, 6), WD.tint(lin(0.45, 0.32, 0.22)))
            shrub(D, x, 2.3, z, 0.8, 1.4, 0.8, n=8, rings=4, seed=int(abs(x) * 13))
        for x in (-6.2, 6.2):  # flag poles
            D.member((x, 0.0, -11.5), (x, 9.0, -11.5), prof_round(0.045, 6), SS.tint(lin(0.85, 0.85, 0.85)))
            D.lathe([(0.0, 9.0), (0.07, 9.06), (0.0, 9.16)], 6, SS.tint(C_GOLD), cx=x, cz=-11.5)
            self.flag(D, x, 8.85, -11.5, 1.7 if x > 0 else -1.7, 1.1, n=5)
        D.prop("park side", (-10, 10, 0, 9.2, -13, -6.02), "beyond")

    def backdrop(self):
        """The park beyond, at a distance (local z -26 .. -36 = world z 115 .. 125): a Ferris wheel (22 m) and a coaster's lift
        hill and drop, silhouettes that tell the gate leads to a real park. Its own mesh (lotdetail__lot_gate_backdrop)."""
        B = Mesh("backdrop")
        steel = ST.tint(lin(0.88, 0.88, 0.9))
        cxw, cyw, czw, R = 13.0, 13.5, -34.0, 11.0
        n = 24
        for side in (-0.6, 0.6):
            pts = [(cxw + R * math.cos(2 * math.pi * i / n), cyw + R * math.sin(2 * math.pi * i / n), czw + side) for i in range(n)]
            for i in range(n):
                B.member(pts[i], pts[(i + 1) % n], prof_box(0.22, 0.22), steel)
            for i in range(0, n, 2):
                B.member((cxw, cyw, czw + side), pts[i], prof_box(0.08, 0.08), steel)
        B.member((cxw, cyw, czw - 1.0), (cxw, cyw, czw + 1.0), prof_round(0.35, 8), steel)
        for i in range(0, n, 2):  # gondolas hanging under the rim points
            a = 2 * math.pi * i / n
            gx, gy = cxw + R * math.cos(a), cyw + R * math.sin(a) - 1.0
            col = (C_RED, lin(0.95, 0.75, 0.1), lin(0.1, 0.35, 0.75))[(i // 2) % 3]
            B.box(gx - 0.6, gx + 0.6, gy - 0.6, gy + 0.5, czw - 0.5, czw + 0.5, PL.tint(col))
        for sx_, sz in ((-4.5, -1.8), (4.5, -1.8), (-4.5, 1.8), (4.5, 1.8)):
            B.member((cxw + sx_, 0.0, czw + sz), (cxw, cyw, czw + sz * 0.4), prof_box(0.3, 0.3), steel)
        g = self.glow("backdrop")
        for i in range(n):
            a = 2 * math.pi * i / n
            for side in (-0.75, 0.75):
                g.lathe([(0.0, -0.12), (0.12, 0.0), (0.0, 0.12)], 4, SE.tint((1.0, 0.8, 0.45) if i % 2 else (0.6, 0.85, 1.0)),
                        cx=cxw + R * math.cos(a), cz=czw + side, y0=cyw + R * math.sin(a))
        track = []  # coaster: a lift hill to 16 m, the crest and the first drop, twin rails, ties and supports
        for i in range(31):
            t = i / 30
            x = -22.0 + 16.0 * t
            if t < 0.6:
                y = 2.0 + 14.0 * (t / 0.6)
            elif t < 0.7:
                y = 16.0 + 0.6 * math.sin(math.pi * (t - 0.6) / 0.1)
            else:
                y = 16.0 - 14.0 * ((t - 0.7) / 0.3) ** 1.4
            track.append((x, y, -27.0 - 3.0 * math.sin(math.pi * t)))
        red = PL.tint(C_RED)
        for k in (-0.5, 0.5):
            for p, q in zip(track, track[1:]):
                B.member((p[0], p[1], p[2] + k), (q[0], q[1], q[2] + k), prof_box(0.14, 0.14), red)
        for i, p in enumerate(track):
            if i % 2 == 0:
                B.member((p[0], p[1] - 0.1, p[2] - 0.6), (p[0], p[1] - 0.1, p[2] + 0.6), prof_box(0.08, 0.1), steel)
            if i % 3 == 0 and p[1] > 2.5:
                B.member((p[0], 0.0, p[2]), (p[0], p[1] - 0.15, p[2]), prof_box(0.25, 0.25), steel)
        self.backdrop_mesh = B


def build(lot):
    kit = GateKit()
    kit.kinds_all()
    kit.main_tower(-1)
    kit.main_tower(1)
    kit.arch()
    kit.wing(-1)
    kit.wing(1)
    kit.corner_tower(-1)
    kit.corner_tower(1)
    kit.leaves()
    kit.barrier()
    kit.fountain()
    kit.planters()
    kit.lamps_and_flaglines()
    kit.benches(lot["seats_local"])
    kit.park_side()
    kit.backdrop()
    return kit
