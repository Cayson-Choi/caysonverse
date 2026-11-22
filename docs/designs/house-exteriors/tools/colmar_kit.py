"""A8 houses, the Colmar redesign (owner 2026-11-17, the Petite Venise photo: "이런 동화 같은 집의 느낌이 나면 좋겠다고";
"실제 주택과 똑같을 필요는 없고 비슷한 동화같은 느낌이면서 실제 건물 같은 느낌이 나야해"; every house brand new).

Ten original Alsatian half-timbered houses (colombage) on the A8 contract's body: the footprint, the body 11.2 x 8.4, the
plinth, the storeys (ground floor +0.30, 4.0 each, wall top 8.30), the door and every opening of the window table stay
exactly where they were (interiors 1:1). What changes is the dress:

  - a sandstone plinth (Vosges sandstone, pink or buff), plastered ground floors (some with sandstone quoins) or a timber
    frame from the ground; the upper floor and the gables in a real 3D timber frame: sole plates, wall plates, corner posts,
    posts beside the windows' shutters, sill and head rails, St Andrew crosses under the windows, Mann figures (a post with
    braces like arms and legs) and braces in the blank bays, collar beams, king posts and braces in the gables. Posts stand
    4.5 cm proud of the plaster, rails 4 cm, braces 3.5 cm (no coplanar faces);
  - jettied upper floors (22 cm) on four houses: the upper front wall stands out on a moulded sill beam over joist ends;
  - steep beaver-tail (Biberschwanz) clay tile roofs, modelled course by course (each course a texture row): gable to the
    street on five houses (45 degrees), eaves to the street with two dormers on the other five (50 degrees), barge boards,
    half-round zinc gutters and round down pipes, a plastered chimney with a sandstone cap;
  - small-paned painted casement windows (two leaves, three panes each), board shutters in the house's paint colour on
    iron strap hinges, sandstone sills, flower boxes with red and pink geraniums (planting cards the game grows into 3D
    plants), iron-and-oak plank doors with a glazed top behind a wrought-iron grille, a sandstone surround with a keystone,
    hanging baskets and a wrought-iron hanging sign on some houses.

Bright cheerful infill colours (the house's plaster tint) and paint colours are per house (COLORS below). The shell keeps
the walls, timber frame, glass, roof (with dormers), chimney; the detail keeps the windows' joinery, shutters, boxes,
sills, door, gutters, pipes, signs and baskets. `H.solids` lists the detail's solid parts (local AABBs) for the clipping
check (check_colmar.py).
"""
import math

import house_kit as K
from house_kit import (FL, HB, HD, INTERIOR_W, STOREY, T_WALL, UP, VT as _VT, WT, ZB, ZC, ZF, Poly, Wall, add, box, cross,
                       face, lin, mul, norm, opening_rect, reveal, sc, sub, wall_pieces)

JETTY = 0.22
TIMBER_POST, TIMBER_RAIL, TIMBER_BRACE = 0.045, 0.040, 0.035   # how far proud of the plaster
ROOF_T = 0.20
EAVE_SIDE = 0.55
RAKE_C = 0.40

# per house: colours (sRGB hex) and the house's character; `ref` = which reference photos it draws its vocabulary from
COLORS = {
    "house_1": dict(shutter_style="board", infill="#F2B9C2", ground="#F2B9C2", beam="#4A3326", shutter="#4E7A55", frame="#F4F1EA", tile="orange",
                    stone="pink", roof="front", jetty=False, ground_style="quoins", pattern="cross", dormers=0, sign=False,
                    baskets=True, door="#5B3A27"),
    "house_2": dict(shutter_style="louvre", infill="#A9CBE3", ground="#A9CBE3", beam="#6E2C22", shutter="#F2EFE8", frame="#F4F1EA", tile="red",
                    stone="buff", roof="side", jetty=True, ground_style="plaster", pattern="mann", dormers=2, sign=True,
                    baskets=False, door="#6B4A33"),
    "house_3": dict(shutter_style="louvre", infill="#F6DC8C", ground="#F6DC8C", beam="#4A3326", shutter="#5D7D96", frame="#F4F1EA", tile="orange",
                    stone="pink", roof="front", jetty=False, ground_style="timber", pattern="mann", dormers=0, sign=False,
                    baskets=True, door="#4E3122"),
    "house_4": dict(shutter_style="board", infill="#BFD3B4", ground="#BFD3B4", beam="#5A4636", shutter="#8A3A2E", frame="#F4F1EA", tile="red",
                    stone="buff", roof="side", jetty=False, ground_style="plaster", pattern="cross", dormers=2, sign=False,
                    baskets=True, door="#5B3A27"),
    "house_5": dict(shutter_style="louvre", infill="#F4AE95", ground="#F4AE95", beam="#4A3326", shutter="#4E6E8E", frame="#F4F1EA", tile="orange",
                    stone="pink", roof="side", jetty=False, ground_style="quoins", pattern="brace", dormers=2, sign=False,
                    baskets=False, door="#6B4A33"),
    "house_6": dict(shutter_style="board", infill="#EBC06E", ground="#EBC06E", beam="#6E2C22", shutter="#3F6B55", frame="#F4F1EA", tile="red",
                    stone="buff", roof="front", jetty=False, ground_style="plaster", pattern="cross", dormers=0, sign=True,
                    baskets=True, door="#5B3A27"),
    "house_7": dict(shutter_style="louvre", infill="#CDBCE0", ground="#CDBCE0", beam="#4A3326", shutter="#F2EFE8", frame="#F4F1EA", tile="orange",
                    stone="pink", roof="front", jetty=False, ground_style="timber", pattern="brace", dormers=0, sign=False,
                    baskets=False, door="#4E3122"),
    "house_8": dict(shutter_style="board", infill="#9FCBCF", ground="#9FCBCF", beam="#4A3326", shutter="#B44A3A", frame="#F4F1EA", tile="orange",
                    stone="buff", roof="side", jetty=False, ground_style="quoins", pattern="mann", dormers=2, sign=False,
                    baskets=True, door="#5B3A27"),
    "house_9": dict(shutter_style="louvre", infill="#E9A4B4", ground="#F3E7D3", beam="#5A4636", shutter="#5D7D96", frame="#F4F1EA", tile="red",
                    stone="pink", roof="front", jetty=False, ground_style="plaster", pattern="mann", dormers=0, sign=False,
                    baskets=True, door="#6B4A33"),
    "house_10": dict(shutter_style="board", infill="#F4ECDB", ground="#F4ECDB", beam="#7A2E25", shutter="#3F6B55", frame="#F4F1EA", tile="red",
                     stone="pink", roof="side", jetty=True, ground_style="plaster", pattern="cross", dormers=2, sign=True,
                     baskets=False, door="#4E3122"),
}
STONE = {"pink": "#E9B6A2", "buff": "#E8D6B8"}
TILE = {"orange": "#FFFFFF", "red": "#E6C7BE"}
IRON = "#2A2A2C"
ZINC = "#A7ACB0"


def P_(H, wall, u, y, d=0.0):
    return wall.P(u, y, d)


class Colmar:
    def __init__(self, H):
        self.H = H
        self.c = COLORS[H.id]
        self.sh, self.de = H.shell, H.detail
        self.rng = H.rng
        self.infill = lin(self.c["infill"])
        self.ground = lin(self.c["ground"])
        self.beamc = lin(self.c["beam"])
        self.shutter = lin(self.c["shutter"])
        self.frame = lin(self.c["frame"])
        self.stone = lin(STONE[self.c["stone"]])
        self.tile = lin(TILE[self.c["tile"]])
        self.side = self.c["roof"] == "side"          # eaves to the street (ridge along x)
        self.J = JETTY if self.c["jetty"] else 0.0
        self.pitch = math.radians(50.0 if self.side else 45.0)
        self.tan = math.tan(self.pitch)
        # the roof's span: half across the ridge (S), along the ridge from a0 to a1
        if self.side:
            # a jettied house's roof spans the upper floor (front wall 0.22 further out): centre and half-span move by J/2
            self.S = HD + self.J / 2
            self.zc_r = ZC + self.J / 2
            self.a0, self.a1 = -HB, HB
        else:
            self.S = HB
            self.zc_r = ZC
            self.a0, self.a1 = ZB, ZF + self.J
        self.y_ridge_u = WT + self.S * self.tan
        self.vt = ROOF_T / math.cos(self.pitch)
        H.solids = []
        H.colmar = self
        H.ridge_top = self.y_ridge_u + self.vt

    # ------------------------------------------------------------------------------------------ helpers --
    def reg(self, name, x0, x1, y0, y1, z0, z1):
        self.H.solids.append(dict(name=name, box=(min(x0, x1), max(x0, x1), min(y0, y1), max(y0, y1), min(z0, z1), max(z0, z1))))

    def reg_wall_box(self, name, W, u0, u1, y0, y1, d0, d1):
        a = W.P(u0, y0, d0)
        b = W.P(u1, y1, d1)
        self.reg(name, a[0], b[0], a[1], b[1], a[2], b[2])

    def walls(self):
        """The wall planes: front 1F / 2F (jettied), back, left, right; side walls of a jettied house reach 0.22 further
        forward upstairs."""
        J = self.J
        return {
            "front": Wall((0, 1), (0.0, ZF)),
            "front2": Wall((0, 1), (0.0, ZF + J)),
            "back": Wall((0, -1), (0.0, ZB)),
            "left": Wall((-1, 0), (-HB, ZC)),
            "right": Wall((1, 0), (HB, ZC)),
        }

    # ----------------------------------------------------------------------------------------- the plinth --
    def plinth(self):
        sh, de = self.sh, self.de
        po = K.PLINTH_OUT
        x0, x1, z0, z1 = -HB - po, HB + po, ZB - po, ZF + po
        ch = 0.02
        st = self.stone
        for (a, b, n) in (((x0, z1), (x1, z1), (0, 0, 1)), ((x1, z1), (x1, z0), (1, 0, 0)), ((x1, z0), (x0, z0), (0, 0, -1)),
                          ((x0, z0), (x0, z1), (-1, 0, 0))):
            nx, nz = n[0], n[2]
            ea = norm((b[0] - a[0], 0, b[1] - a[1]))
            face(sh, [(a[0], -0.05, a[1]), (b[0], -0.05, b[1]), (b[0], FL - ch, b[1]), (a[0], FL - ch, a[1])], "granite", st, n, uax=ea)
            ia = (a[0] - nx * ch + ea[0] * ch, a[1] - nz * ch + ea[2] * ch)
            ib = (b[0] - nx * ch - ea[0] * ch, b[1] - nz * ch - ea[2] * ch)
            face(sh, [(a[0], FL - ch, a[1]), (b[0], FL - ch, b[1]), (ib[0], FL, ib[1]), (ia[0], FL, ia[1])], "granite", st, (nx, 1, nz),
                 uax=ea)
            wa = (a[0] - nx * po + ea[0] * po, a[1] - nz * po + ea[2] * po)
            wb = (b[0] - nx * po - ea[0] * po, b[1] - nz * po - ea[2] * po)
            face(sh, [(ia[0], FL, ia[1]), (ib[0], FL, ib[1]), (wb[0], FL, wb[1]), (wa[0], FL, wa[1])], "granite", st, UP, uax=ea)
            # dressed blocks: joints every ~0.8 m (detail)
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            m = max(2, int(round(L / 0.8)))
            for k in range(1, m):
                s = L * k / m
                px, pz = a[0] + ea[0] * s + nx * 0.001, a[1] + ea[2] * s + nz * 0.001
                jw = 0.003
                face(de, [(px - ea[0] * jw, -0.02, pz - ea[2] * jw), (px + ea[0] * jw, -0.02, pz + ea[2] * jw),
                          (px + ea[0] * jw, FL - ch, pz + ea[2] * jw), (px - ea[0] * jw, FL - ch, pz - ea[2] * jw)], "granite",
                     mul(st, 0.55), n, uax=UP)

    # ------------------------------------------------------------------------------------- timber framing --
    def beam(self, W, u0, u1, y0, y1, proud, part=None, faces="flrtu"):
        """An upright or level beam on wall W: front face + the edges (out to `proud`)."""
        part = part or self.sh
        W.box(part, u0, u1, y0, y1, -proud, 0.0, "oak", self.beamc, faces=faces.replace("b", ""), along="y" if y1 - y0 > u1 - u0 else "u")

    def brace(self, W, a, b, width=0.15, proud=TIMBER_BRACE, part=None):
        """A diagonal beam from point a (u, y) to b, its ends cut level (they butt onto rails): front + two long sides."""
        part = part or self.sh
        (ua, ya), (ub, yb) = a, b
        if abs(yb - ya) < 1e-4:
            return
        dx = ub - ua
        L = math.hypot(dx, yb - ya)
        sin = abs(yb - ya) / L
        hw = width / 2 / max(sin, 0.25)          # half its horizontal width
        pts = [(ua - hw, ya), (ua + hw, ya), (ub + hw, yb), (ub - hw, yb)]
        d = -proud
        tint = self.beamc
        ax = norm(W.dirv(nu=dx, ny=yb - ya))
        face(part, [W.P(u, y, d) for (u, y) in pts], "oak", tint, W.N, uax=ax)
        # the two long sides
        for (p0, p1, sgn) in ((pts[0], pts[3], -1), (pts[1], pts[2], 1)):
            q = [W.P(p0[0], p0[1], d), W.P(p1[0], p1[1], d), W.P(p1[0], p1[1], 0.0), W.P(p0[0], p0[1], 0.0)]
            nrm = W.dirv(nu=sgn * (yb - ya), ny=-sgn * dx)
            face(part, q, "oak", mul(tint, 0.85), nrm, uax=ax)

    def frame_zone(self, W, u0, u1, y0, y1, openings, pattern, top_plate=True, sole=True):
        """A storey's timber frame on one wall: sole plate, wall plate, corner posts, posts at the shutters' outer edges,
        sill / head rails, St Andrew crosses under the windows, Mann figures or braces in the blank bays."""
        bw = 0.18
        rh = 0.16
        ys0 = y0 + (rh if sole else 0.0)
        ys1 = y1 - (rh if top_plate else 0.0)
        if sole:
            self.beam(W, u0, u1, y0, y0 + rh, TIMBER_RAIL, faces="flru")
        if top_plate:
            self.beam(W, u0, u1, y1 - rh, y1, TIMBER_RAIL, faces="flru")
        # posts: corners + each opening's shutter edges
        cols = [(u0, u0 + bw), (u1 - bw, u1)]
        ops = sorted(openings)
        for (ou0, ou1, ov0, ov1, sw) in ops:
            cols.append((ou0 - sw - bw, ou0 - sw))
            cols.append((ou1 + sw, ou1 + sw + bw))
        cols = sorted((max(u0, a), min(u1, b)) for (a, b) in cols if b > u0 + 0.05 and a < u1 - 0.05)
        merged = []
        for c in cols:
            if merged and c[0] < merged[-1][1] + 0.35:
                merged[-1] = (merged[-1][0], max(merged[-1][1], c[1]))
            else:
                merged.append(c)
        for (a, b) in merged:
            self.beam(W, a, b, ys0, ys1, TIMBER_POST, faces="flr")
        # rails round each opening
        for (ou0, ou1, ov0, ov1, sw) in ops:
            la = max(u0, ou0 - sw)
            lb = min(u1, ou1 + sw)
            if ov0 - rh > ys0 + 0.05:
                self.beam(W, la, lb, ov0 - rh, ov0, TIMBER_RAIL, faces="fu")
                # under the window: a St Andrew cross, or two braces leaning out (Mann pattern), or studs
                ya, yb = ys0, ov0 - rh
                if yb - ya > 0.3:
                    if pattern in ("cross", "mann"):
                        self.brace(W, (ou0, ya), (ou1, yb), 0.13)
                        self.brace(W, (ou1, ya), (ou0, yb), 0.13)
                    else:
                        for f in (0.33, 0.67):
                            uu = ou0 + (ou1 - ou0) * f
                            self.beam(W, uu - 0.07, uu + 0.07, ya, yb, TIMBER_BRACE, faces="flr")
            if ov1 + rh < ys1 - 0.05:
                self.beam(W, la, lb, ov1, ov1 + rh, TIMBER_RAIL, faces="fu")
                if ys1 - (ov1 + rh) > 0.45:
                    um = (ou0 + ou1) / 2
                    self.beam(W, um - 0.07, um + 0.07, ov1 + rh, ys1, TIMBER_BRACE, faces="flr")
        # blank bays between posts: braces / Mann figures
        for (a, b), (c, d) in zip(merged[:-1], merged[1:]):
            bay0, bay1 = b, c
            wbay = bay1 - bay0
            if wbay < 0.35:
                continue
            if any(o[0] - o[4] < bay1 - 0.01 and o[1] + o[4] > bay0 + 0.01 for o in ops):
                continue                                   # a window's bay (shutters), done above
            h = ys1 - ys0
            if pattern == "mann" and wbay > 0.9:
                um = (bay0 + bay1) / 2
                self.beam(W, um - 0.09, um + 0.09, ys0, ys1, TIMBER_POST - 0.004, faces="flr")
                self.brace(W, (bay0 + 0.02, ys0), (um - 0.09, ys0 + h * 0.55))
                self.brace(W, (bay1 - 0.02, ys0), (um + 0.09, ys0 + h * 0.55))
                self.brace(W, (um - 0.09, ys0 + h * 0.45), (bay0 + 0.02, ys1))
                self.brace(W, (um + 0.09, ys0 + h * 0.45), (bay1 - 0.02, ys1))
            elif pattern == "cross" and wbay > 0.6:
                self.brace(W, (bay0, ys0), (bay1, ys1))
                self.brace(W, (bay1, ys0), (bay0, ys1))
            else:
                # one brace leaning toward the nearer corner of the wall
                if (bay0 + bay1) / 2 < (u0 + u1) / 2:
                    self.brace(W, (bay0, ys0), (bay1, ys1))
                else:
                    self.brace(W, (bay1, ys0), (bay0, ys1))

    def gable_frame(self, W, half, y0, openings):
        """The gable triangle's frame: the wall plate's rafter-line beams under the barge boards, a collar beam (two on a
        tall gable), a king post, braces from it, posts beside the attic windows."""
        tan = self.tan
        yr = y0 + half * tan
        bw = 0.18

        def edge(u):
            return yr - abs(u) * tan
        # the rafter-line beams: a band along each sloping edge (front face + inner edge)
        for s in (-1, 1):
            pts = [(s * half, y0), (0.0, yr), (0.0, yr - bw / math.cos(self.pitch)), (s * (half - bw / math.sin(self.pitch) * 0.0 - 0.0)
                                                                                   , y0 - 0.0)]
            # as a quad: outer edge on the roof line, inner edge bw below it
            o0, o1 = (s * half, y0), (0.0, yr)
            dv = bw / math.cos(self.pitch)
            q = [(o0[0], o0[1]), (o1[0], o1[1]), (o1[0], o1[1] - dv), (o0[0] - s * dv / tan, o0[1])]
            face(self.sh, [W.P(u, y, -TIMBER_RAIL) for (u, y) in q], "oak", self.beamc, W.N, uax=norm(W.dirv(nu=-s * half, ny=yr - y0)))
            # the inner edge's face
            a, b = q[3], q[2]
            face(self.sh, [W.P(a[0], a[1], -TIMBER_RAIL), W.P(b[0], b[1], -TIMBER_RAIL), W.P(b[0], b[1], 0), W.P(a[0], a[1], 0)], "oak",
                 mul(self.beamc, 0.8), W.dirv(nu=s * -1.0, ny=-1.0 / tan), uax=norm(W.dirv(nu=-s * half, ny=yr - y0)))
        H = yr - y0
        collars = [y0 + H * 0.42] if H < 4.5 else [y0 + H * 0.33, y0 + H * 0.64]
        for yc in collars:
            hw = (yr - yc - 0.16) / tan
            self.beam(W, -hw, hw, yc, yc + 0.16, TIMBER_RAIL, faces="fu")
        # king post from the top collar to the apex region
        ytop = yr - 0.25
        self.beam(W, -0.09, 0.09, collars[-1] + 0.16, ytop, TIMBER_POST, faces="flr")
        # posts beside openings and braces in the lower band
        yb = collars[0]
        cols = []
        for (ou0, ou1, ov0, ov1, sw) in openings:
            if ov0 < yb:
                cols += [ou0 - sw - bw, ou1 + sw]
        for u in cols:
            if abs(u) + bw < (yr - yb) / tan:
                self.beam(W, u, u + bw, y0, yb, TIMBER_POST, faces="flr")
        # braces from the collar's ends down to the wall plate (inside the triangle)
        hw0 = (yr - yb) / tan
        for s in (-1, 1):
            a = (s * (hw0 - 0.25), yb)
            b = (s * (hw0 * 0.45), y0)
            if not any(o[0] - o[4] < max(a[0], b[0]) and o[1] + o[4] > min(a[0], b[0]) and o[2] < yb for o in openings):
                self.brace(W, b, a)
        # the upper braces (king post to the top collar)
        ycu = collars[-1] + 0.16
        hwu = (yr - ycu) / tan
        for s in (-1, 1):
            self.brace(W, (s * 0.09, ytop - 0.6), (s * hwu * 0.6, ycu))

    # ----------------------------------------------------------------------------------------- the walls --
    def body(self):
        H = self.H
        sh = self.sh
        Wd = self.walls()
        J = self.J
        by_wall = {"front": [], "back": [], "left": [], "right": []}
        for o in H.windows:
            by_wall[o["wall"]].append(o)
        lit = H.lit
        attic = []          # attic windows in gables (not in the table)
        self.window_boxes = []
        for wname in ("front", "back", "left", "right"):
            ops1, ops2 = [], []                      # (rect, opening) per storey
            for o in sorted(by_wall[wname], key=lambda q: (q["floor"], q["at"])):
                r = opening_rect(o)
                (ops1 if r[2] < FL + STOREY else ops2).append((r, o))
            gable = (wname in ("left", "right")) if self.side else (wname in ("front", "back"))
            W1 = Wd[wname]
            W2 = Wd["front2"] if (wname == "front" and J > 0) else W1
            # storey spans along the wall (u); a jettied house's side walls run 0.22 further forward upstairs
            if wname in ("front", "back"):
                sp1 = sp2 = (-HB, HB)
            else:
                lo, hi = ZB - ZC, ZF - ZC
                sp1 = (lo, hi) if wname == "left" else (-hi, -lo)
                hi2 = hi + J
                sp2 = (lo, hi2) if wname == "left" else (-hi2, -lo)
            # ---- openings: windows and the door (contract 7: the table's rectangles)
            for (r, o) in ops1:
                if o["kind"] == "door":
                    self.door(W1, r, o)
                else:
                    self.window(W1, wname, r, o, 1, (wname, o["floor"], round(o["at"], 2)) in lit)
            for (r, o) in ops2:
                self.window(W2, wname, r, o, 2, (wname, o["floor"], round(o["at"], 2)) in lit)
            # ---- gable triangle attic windows
            gops = []
            if gable:
                if wname in ("front", "back"):
                    for u in (-1.5, 1.5):
                        gops.append((u - 0.38, u + 0.38, WT + 0.75, WT + 1.85))
                    gops.append((-0.3, 0.3, WT + 3.0, WT + 3.75))
                else:
                    gops.append((-0.42, 0.42, WT + 0.7, WT + 1.75))
                Wg = W2 if wname == "front" else W1
                for g in gops:
                    self.window(Wg, wname, g, None, 3, False)
            # ---- the plaster, storey by storey (shell)
            uo = self.rng.random()
            r1 = [r for (r, o) in ops1]
            r2 = [r for (r, o) in ops2]
            self.plaster(W1, sp1, FL, FL + STOREY, r1, self.ground, uo)
            if gable:
                half = (sp2[1] - sp2[0]) / 2
                mid = (sp2[0] + sp2[1]) / 2
                yr = WT + half * self.tan
                tan = self.tan

                def ext(v, mid=mid, half=half, yr=yr):
                    if v <= WT + 1e-9:
                        return (mid - half, mid + half)
                    k = max(0.0, (yr - v) / tan)
                    return (mid - k, mid + k)
                wall_pieces(sh, W2, ext, FL + STOREY, r2 + gops, "render", self.infill, ybreaks=[WT, yr], uoff=uo)
            else:
                self.plaster(W2, sp2, FL + STOREY, WT, r2, self.infill, uo)
            # ---- timber frames
            self.Wcur = W2
            sw2 = [(r[0], r[1], r[2], r[3], self.shutter_w(r, wname)) for r in r2]
            self.frame_zone(W2, sp2[0], sp2[1], FL + STOREY, WT, sw2, self.c["pattern"])
            if gable:
                half = (sp2[1] - sp2[0]) / 2
                gsw = [(g[0], g[1], g[2], g[3], 0.0) for g in gops]
                self.Wcur = W2
                self.gable_frame_on(W2, (sp2[0] + sp2[1]) / 2, half, gsw)
            gs = self.c["ground_style"]
            if gs == "timber":
                self.Wcur = W1
                ops = []
                for (r, o) in ops1:
                    if o["kind"] == "door":
                        ops.append((r[0] - 0.24, r[1] + 0.24, r[2], r[3] + 0.32, 0.0))
                    else:
                        ops.append((r[0], r[1], r[2], r[3], self.shutter_w(r, wname)))
                self.frame_zone(W1, sp1[0], sp1[1], FL, FL + STOREY, ops, self.c["pattern"], top_plate=False, sole=False)
            elif gs == "quoins" and wname in ("front", "back"):
                self.quoins(W1, sp1, wname)
            # a jetty's sill beam and joist ends along the front
            if wname == "front" and J > 0:
                self.jetty_front()
        # ---- rooms seen through the glass (as the body kit)
        room = mul(lin(H.spec["room"]), 0.55)
        xa, xb, za, zb = -HB + T_WALL, HB - T_WALL, ZB + T_WALL, ZF - T_WALL
        for (ya, yb) in ((FL + 0.005, FL + 3.7), (FL + STOREY + 0.005, FL + STOREY + 3.7)):
            face(sh, [(xa, ya, za), (xb, ya, za), (xb, ya, zb), (xa, ya, zb)], "oak", mul(lin("#C8A27C"), 0.9), UP)
            face(sh, [(xa, yb, za), (xb, yb, za), (xb, yb, zb), (xa, yb, zb)], "render", mul(room, 1.05), (0, -1, 0), scale=0.5)
            face(sh, [(xa, ya, za), (xb, ya, za), (xb, yb, za), (xa, yb, za)], "render", room, (0, 0, 1), scale=0.5)
            face(sh, [(xa, ya, zb), (xb, ya, zb), (xb, yb, zb), (xa, yb, zb)], "render", room, (0, 0, -1), scale=0.5)
            face(sh, [(xa, ya, za), (xa, ya, zb), (xa, yb, zb), (xa, yb, za)], "render", mul(room, 0.92), (1, 0, 0), scale=0.5)
            face(sh, [(xb, ya, za), (xb, ya, zb), (xb, yb, zb), (xb, yb, za)], "render", mul(room, 0.92), (-1, 0, 0), scale=0.5)

    def gable_frame_on(self, W, mid, half, openings):
        """gable_frame about the wall's middle `mid` (side walls are centred on the body's middle, u = 0 there)."""
        if abs(mid) > 1e-6:
            Wm = Wall(W.n, (W.o[0] + W.t[0] * mid, W.o[1] + W.t[1] * mid))
            ops = [(o[0] - mid, o[1] - mid, o[2], o[3], o[4]) for o in openings]
            self.Wcur = Wm
            self.gable_frame(Wm, half, WT, ops)
        else:
            self.gable_frame(W, half, WT, openings)

    def plaster(self, W, span, y0, y1, rects, tint, uo):
        wall_pieces(self.sh, W, span, y0, rects, "render", tint, ybreaks=[y1], uoff=uo)
        # close the band's top if the next storey's wall starts elsewhere: handled by the caller (jetty soffit)
        # cap the piece at y1 by giving wall_pieces a blocking rectangle above (it stops at the highest break)

    def shutter_w(self, r, wname):
        """The width of one shutter leaf of an opening (0 = no shutters): the front windows and the back's upper floor (the
        LPG cage, the gas pipe and the meters stand by the back's ground floor)."""
        w = r[1] - r[0]
        if (wname == "front" or (wname == "back" and r[2] > FL + STOREY)) and w <= 1.5:
            return w / 2 + 0.02
        return 0.0

    def quoins(self, W, span, wname):
        """Sandstone quoins on the ground floor's corners: alternating long and short blocks, 3 cm proud (shell)."""
        sh = self.sh
        st = self.stone
        y = FL
        k = 0
        while y < FL + STOREY - 0.25:
            h = 0.30
            L = 0.42 if k % 2 == 0 else 0.26
            for (u, sgn) in ((span[0], 1), (span[1], -1)):
                ua, ub = sorted((u, u + sgn * L))
                W.box(sh, ua, ub, y + 0.006, y + h - 0.006, -0.03, 0.0, "granite", st, faces="fu" + ("r" if sgn > 0 else "l"),
                      along="u")
            y += h
            k += 1

    def jetty_front(self):
        """The jetty: a moulded oak sill beam under the upper front wall, the joist ends below it (every 0.55 m), the
        soffit between the two walls (shell)."""
        sh = self.sh
        J = self.J
        y = FL + STOREY
        b = self.beamc
        # soffit under the overhang
        face(sh, [(-HB - 0.0, y - 0.20, ZF), (HB, y - 0.20, ZF), (HB, y - 0.20, ZF + J + 0.03), (-HB, y - 0.20, ZF + J + 0.03)],
             "timber_cladding", lin("#E9E2D6"), (0, -1, 0), uax=(1, 0, 0))
        # the sill beam (front + bottom), 0.20 tall, 3 cm proud of the upper wall
        box(sh, -HB - 0.03, HB + 0.03, y - 0.20, y + 0.02, ZF + J - 0.05, ZF + J + 0.03, "oak", b, skip=("back", "top"), along="x")
        # joist ends (detail would pop; they are the jetty's look from the street: shell)
        n = int((2 * HB) / 0.55)
        for k in range(n + 1):
            x = -HB + 0.15 + k * (2 * HB - 0.3) / n
            box(sh, x - 0.07, x + 0.07, y - 0.40, y - 0.20, ZF, ZF + J - 0.02, "oak", mul(b, 0.92), skip=("back", "top"), along="z")
        # close the side walls' step under the jetty (the side wall's upper part starts at y; below it the plaster stops at ZF)
        for sx in (-1, 1):
            x = sx * HB
            face(sh, [(x, y - 0.20, ZF), (x, y - 0.20, ZF + J), (x, y + 0.02, ZF + J), (x, y + 0.02, ZF)], "oak", mul(b, 0.85),
                 (sx, 0, 0), uax=(0, 0, 1))

    # ---------------------------------------------------------------------------------------- windows --
    def window(self, W, wname, r, o, storey, lit):
        """A painted wooden casement window: reveal, two leaves of three panes (glass in the shell), the frame, mullion and
        glazing bars (detail), a sandstone sill, board shutters on strap hinges, a flower box of geraniums."""
        H = self.H
        sh, de = self.sh, self.de
        u0, u1, v0, v1 = r
        w, h = u1 - u0, v1 - v0
        jett = (W.o[1] - ZF) if wname == "front" else 0.0
        depth = T_WALL + max(0.0, jett)
        tint = self.ground if storey == 1 else self.infill
        reveal(sh, W, r, depth, tint)
        fr = self.frame
        fw = 0.065
        d0, d1 = 0.08, 0.17
        fc = (d0 + d1) / 2
        W.box(de, u0, u0 + fw, v0, v1, d0, d1, "pvc_frame", fr, faces="fr", along="y")
        W.box(de, u1 - fw, u1, v0, v1, d0, d1, "pvc_frame", fr, faces="fl", along="y")
        W.box(de, u0 + fw, u1 - fw, v1 - fw, v1, d0, d1, "pvc_frame", fr, faces="fu", along="u")
        W.box(de, u0 + fw, u1 - fw, v0, v0 + fw, d0, d1, "pvc_frame", fr, faces="ft", along="u")
        gi0, gi1 = u0 + fw, u1 - fw
        b0, b1 = v0 + fw, v1 - fw
        leaves = 2 if w > 0.7 else 1
        lw = (gi1 - gi0) / leaves
        sf = 0.05
        rows = 3 if h > 1.2 else 2
        for k in range(leaves):
            a, b = gi0 + k * lw, gi0 + (k + 1) * lw
            W.box(de, a, a + sf, b0, b1, fc - 0.02, fc + 0.02, "pvc_frame", fr, faces="fr", along="y")
            W.box(de, b - sf, b, b0, b1, fc - 0.02, fc + 0.02, "pvc_frame", fr, faces="fl", along="y")
            W.box(de, a + sf, b - sf, b1 - sf, b1, fc - 0.02, fc + 0.02, "pvc_frame", fr, faces="fu", along="u")
            W.box(de, a + sf, b - sf, b0, b0 + sf + 0.02, fc - 0.02, fc + 0.02, "pvc_frame", fr, faces="ft", along="u")
            # glazing bars: rows - 1 level bars (front + top edge)
            for j in range(1, rows):
                yy = b0 + sf + (b1 - b0 - 2 * sf) * j / rows
                W.box(de, a + sf, b - sf, yy - 0.014, yy + 0.014, fc - 0.035, fc - 0.005, "pvc_frame", fr, faces="f", along="u")
            W.quad(sh, [(a + sf, b0 + sf, fc), (b - sf, b0 + sf, fc), (b - sf, b1 - sf, fc), (a + sf, b1 - sf, fc)], "M_glass",
                   (1, 1, 1, 1), uvs=[(0, 0), (1, 0), (1, 1), (0, 1)])
            # a brass-ish espagnolette handle on the meeting stile
            if leaves == 2 and k == 0:
                hu = b - sf * 0.5
                ym = (b0 + b1) / 2
                W.box(de, hu - 0.012, hu + 0.012, ym - 0.07, ym + 0.07, fc - 0.05, fc - 0.02, "metal_painted", lin("#B89A5A"),
                      faces="fltru", along="y")
        # the room behind: curtains (lace, short) and the night card
        if o is not None:
            ct = lin(self.rng.choice(["#FAF7F0", "#F6F1E6", "#FFFDF8"]))
            K.curtain(H, W, (u0 + u1) / 2, w, v0, h, depth + 0.12, ct, wname != "front")
            if lit:
                dl = depth + 0.45
                W.quad(sh, [(u0 - 0.2, v0 - 0.05, dl), (u1 + 0.2, v0 - 0.05, dl), (u1 + 0.2, v1 + 0.05, dl), (u0 - 0.2, v1 + 0.05, dl)],
                       "M_window", (1, 1, 1, 1), uvs=[(0, 0), (1, 0), (1, 1), (0, 1)])
                H.lights.append(W.P((u0 + u1) / 2, v0 + h * 0.55, depth + 0.9) + ("window",))
            H.cut.append((wname, r, o))
        # sandstone sill (6 cm, 8 cm proud, a drip groove)
        if o is None or o["kind"] == "window":
            W.box(de, u0 - 0.08, u1 + 0.08, v0 - 0.06, v0, -0.08, d0, "granite", self.stone, faces="frltu", along="u")
            self.reg_wall_box("sill", W, u0 - 0.08, u1 + 0.08, v0 - 0.072, v0, -0.08, 0.0)
        # sandstone head (a lintel stone over the opening, 3 cm proud) on plastered ground floors
        if storey == 1 and self.c["ground_style"] != "timber":
            W.box(sh, u0 - 0.10, u1 + 0.10, v1, v1 + 0.18, -0.03, 0.0, "granite", self.stone, faces="ftlru", along="u")
        sw = self.shutter_w(r, wname) if o is not None else 0.0
        if sw > 0:
            self.shutters(W, r, sw, storey)
        if o is not None and self.wants_box(wname, r, storey):
            self.flower_box(W, r)

    def board_shutter(self, W, a, b, bottom, top, front, back):
        """Three edge-jointed boards. The middle board is pierced right through, with a visible sawn edge."""
        de = self.de
        width = (b - a) / 3
        for i in range(3):
            x0 = a + i * width + (0.002 if i else 0)
            x1 = a + (i + 1) * width - (0.002 if i != 2 else 0)
            colour = mul(self.shutter, (0.98, 1.05, 0.94)[i])
            W.box(de, x0, x1, bottom, top, front, back, "timber_cladding", colour, faces="lr", along="y")
            if i != 1:
                W.box(de, x0, x1, bottom, top, front, back, "timber_cladding", colour, faces="f", along="y")
                continue
            cx, cy = (x0 + x1) / 2, top - 0.33
            radius = min(0.067, width * 0.42)
            # At each x fraction, lower and upper sawn contours of the heart.
            profile = [(-1, 0.18, 0.18), (-0.83, -0.13, 0.61), (-0.53, -0.47, 0.83),
                       (-0.25, -0.76, 0.74), (0, -1.06, 0.43), (0.25, -0.76, 0.74),
                       (0.53, -0.47, 0.83), (0.83, -0.13, 0.61), (1, 0.18, 0.18)]
            for lo, hi in [(x0, cx - radius), (cx + radius, x1)]:
                W.box(de, lo, hi, bottom, top, front, back, "timber_cladding", colour, faces="f", along="y")
            def timber(points, tint, hint):
                face(de, [W.P(*p) for p in points], "timber_cladding", tint, hint, uax=UP,
                     origin=W.P(cx, bottom, front), uoff=0.23, voff=0.0)
            for left, right in zip(profile, profile[1:]):
                x, y, h = cx + left[0]*radius, cy + left[1]*radius, cy + left[2]*radius
                xx, yy, hh = cx + right[0]*radius, cy + right[1]*radius, cy + right[2]*radius
                timber([(x,bottom,front), (xx,bottom,front), (xx,yy,front), (x,y,front)], colour, W.N)
                timber([(x,h,front), (xx,hh,front), (xx,top,front), (x,top,front)], colour, W.N)
                for y0, y1, direction in [(y, yy, UP), (h, hh, (0,-1,0))]:
                    timber([(x,y0,front), (xx,y1,front), (xx,y1,back), (x,y0,back)], mul(colour, 0.68), direction)

    def shutters(self, W, r, sw, storey):
        """Two shutters folded back flat beside the window, 5 cm out (over the timber), in the house's paint: board shutters
        (vertical boards, a heart cut-out near the top, two black strap hinges) or louvred ones (horizontal slats in a raised
        frame, two hinges) — both seen in Colmar and Eguisheim (refs 05, 06, 08); a holdback on the wall."""
        de = self.de
        u0, u1, v0, v1 = r
        pt = self.shutter
        dsh0, dsh1 = -0.085, -0.055
        # louvred leaves with real slats on the street side; the back's are plain boards (budget)
        louvre = self.c.get("shutter_style") == "louvre" and W.n == (0, 1)
        for (a, b, side) in ((u0 - sw, u0 - 0.01, -1), (u1 + 0.01, u1 + sw, 1)):
            if louvre:
                # a louvred leaf: two stiles and three rails (front + edges), between them real slats — one 45-degree board
                # every 10 cm, each a single angled quad, over the leaf's dark back (the shadow seen between the slats)
                W.box(de, a, b, v0 - 0.01, v1 + 0.01, dsh0, dsh1, "timber_cladding", pt, faces="lr", along="y")
                for (ua, ub) in ((a, a + 0.065), (b - 0.065, b)):
                    W.box(de, ua, ub, v0 - 0.01, v1 + 0.01, dsh0 - 0.004, dsh0 + 0.02, "timber_cladding", mul(pt, 1.04), faces="f", along="y")
                ym = (v0 + v1) / 2
                for (ya, yb) in ((v0 - 0.01, v0 + 0.07), (ym - 0.035, ym + 0.035), (v1 - 0.07, v1 + 0.01)):
                    W.box(de, a + 0.065, b - 0.065, ya, yb, dsh0 - 0.004, dsh0 + 0.02, "timber_cladding", mul(pt, 1.04), faces="ftu",
                          along="u")
                W.quad(de, [(a + 0.065, v0, dsh1 - 0.002), (b - 0.065, v0, dsh1 - 0.002), (b - 0.065, v1, dsh1 - 0.002),
                            (a + 0.065, v1, dsh1 - 0.002)], "timber_cladding", mul(pt, 0.12), (0, 0, -1), uax=W.T)
                for (ya, yb) in ((v0 + 0.07, ym - 0.035), (ym + 0.035, v1 - 0.07)):
                    nsl = max(1, int((yb - ya) / 0.10))
                    for k in range(nsl):
                        y0s = ya + (yb - ya) * k / nsl
                        y1s = y0s + (yb - ya) / nsl
                        # front edge low and out, back edge high and in: rain runs off outward, the light catches the tops
                        # a 50-degree slat: from its front edge (2 cm proud of the frame) up and back to the leaf's back, 6 cm of
                        # its 10 cm pitch; the dark back shows in the rest (the louvre's stripes of light and shadow)
                        W.quad(de, [(a + 0.065, y0s, dsh0 - 0.02), (b - 0.065, y0s, dsh0 - 0.02), (b - 0.065, y0s + 0.06, dsh1 - 0.004),
                                    (a + 0.065, y0s + 0.06, dsh1 - 0.004)], "timber_cladding", mul(pt, 1.0),
                               (0, 0.75, -0.66), uax=W.T)
            elif storey == 1 and W.n == (0, 1):
                # The former leaf and heart each drew one grain offset. Keep the UV variation
                # of the rest of the house independent of the number of boards in this leaf.
                de.rng.random()
                de.rng.random()
                after_leaf = de.rng.getstate()
                self.board_shutter(W, a, b, v0 - 0.01, v1 + 0.01, dsh0, dsh1)
                de.rng.setstate(after_leaf)
            else:
                W.box(de, a, b, v0 - 0.01, v1 + 0.01, dsh0, dsh1, "timber_cladding", pt, faces="flr", along="y")
                # a heart cut-out (a dark diamond-and-lobes shape through the board)
                cu, cy = (a + b) / 2, v1 - 0.32
                pts = [(cu, cy - 0.07, dsh0 - 0.001), (cu + 0.06, cy + 0.01, dsh0 - 0.001), (cu + 0.035, cy + 0.06, dsh0 - 0.001),
                       (cu, cy + 0.03, dsh0 - 0.001), (cu - 0.035, cy + 0.06, dsh0 - 0.001), (cu - 0.06, cy + 0.01, dsh0 - 0.001)]
                face(de, [W.P(*q) for q in pts], "timber_cladding", mul(pt, 0.12), W.N, uax=W.T)
            for yy in (v0 + 0.18, v1 - 0.18):
                ha, hb = (b - 0.34, b - 0.01) if side < 0 else (a + 0.01, a + 0.34)
                W.box(de, ha, hb, yy - 0.018, yy + 0.018, dsh0 - 0.016, dsh0 - (0.012 if louvre else 0.0), "metal_painted",
                      lin(IRON), faces="flrtu" if storey == 1 and W.n == (0, 1) else "f", along="u")
            self.reg_wall_box("shutter", W, a, b, v0 - 0.01, v1 + 0.01, dsh0 - 0.022, 0.0)

    def wants_box(self, wname, r, storey):
        """Flower boxes under the street-facing windows, except where the porch is (a deck house's bench and rail beside the
        ground-floor windows, a gable porch's roof under the upper middle window) and the patio doors."""
        if wname != "front":
            return wname == "back" and storey == 2 and self.rng.random() < 0.5
        if r[3] - r[2] > 2.2:
            return False
        kind = K_KIND.get(self.H.id)
        uc = (r[0] + r[1]) / 2
        if storey == 1 and kind == "deck":
            return False
        if storey == 2 and kind == "gable" and abs(uc) < 1.0:
            return False
        return True

    def flower_box(self, W, r):
        """A planted window box on two iron brackets under the sill: a painted board box 0.20 deep, 0.20 tall, soil, and the
        geraniums' planting cards (M_leaf_flora, the petunia / pink row: the game grows them as 3D plants, in the box bed
        listed in H.window_boxes for the vegetation)."""
        de = self.de
        u0, u1, v0, v1 = r
        a, b = u0 + 0.03, u1 - 0.03
        yt = v0 - 0.10
        yb = yt - 0.20
        d0, d1 = -0.30, -0.09
        boxc = mul(self.shutter, 1.0) if self.rng.random() < 0.6 else lin("#B5653E")      # painted, or terracotta-red
        W.box(de, a, b, yb, yt, d0, d1, "timber_cladding", boxc, faces="flrtu"[:0] + "flru", along="u")
        # the box's top edge (a rim) and the soil
        W.box(de, a, b, yt - 0.02, yt, d0, d0 + 0.02, "timber_cladding", mul(boxc, 0.9), faces="t", along="u")
        W.quad(de, [(a + 0.02, yt - 0.03, d0 + 0.02), (b - 0.02, yt - 0.03, d0 + 0.02), (b - 0.02, yt - 0.03, d1),
                    (a + 0.02, yt - 0.03, d1)], "granite", lin("#4A3A2E"), (0, 1, 0))
        # brackets
        for uu in (a + 0.15, b - 0.15):
            W.box(de, uu - 0.012, uu + 0.012, yb - 0.12, yb, d1 - 0.02, d1, "metal_painted", lin(IRON), faces="flr", along="y")
            self.brace(W, (uu, yb - 0.12), (uu, yb - 0.11), 0.02, part=de) if False else None
            W.box(de, uu - 0.012, uu + 0.012, yb - 0.012, yb, d0 + 0.03, d1, "metal_painted", lin(IRON), faces="flru", along="d")
        self.reg_wall_box("flowerbox", W, a, b, yb - 0.12, yt + 0.32, d0, 0.0)
        # planting cards: one per ~0.3 m, the pink / red row (row 0), leaning out a little
        n = max(3, int(round((b - a) / 0.22)))
        reds = ["#E5323C", "#F0506E", "#D8283A", "#F27AA0"]
        for k in range(n):
            uu = a + 0.1 + (b - a - 0.2) * (k + 0.5) / n
            dd = (d0 + d1) / 2
            p = W.P(uu, yt - 0.03, dd)
            self.card(p, 0.26, 0.30, W, lin(self.rng.choice(reds)))
        # the bed for the 3D plants (world mapping is the build's: local AABB of the soil, its top)
        pa, pb = W.P(a + 0.02, yt - 0.03, d0 + 0.02), W.P(b - 0.02, yt - 0.03, d1)
        self.window_boxes.append(dict(x0=min(pa[0], pb[0]), x1=max(pa[0], pb[0]), z0=min(pa[2], pb[2]), z1=max(pa[2], pb[2]),
                                      y=yt - 0.03, plant="window", out=(W.n[0], W.n[1])))

    def card(self, p, w, h, W, tint, row=0):
        """A flower card standing on point p across the wall's direction (M_leaf_flora, T_flora row `row`)."""
        t = W.T
        ax, az = p[0] - t[0] * w / 2, p[2] - t[2] * w / 2
        bx, bz = p[0] + t[0] * w / 2, p[2] + t[2] * w / 2
        lean = 0.06
        ox, oz = W.N[0] * lean, W.N[2] * lean
        pts = [(ax, p[1], az), (bx, p[1], bz), (bx + ox, p[1] + h, bz + oz), (ax + ox, p[1] + h, az + oz)]
        u0 = self.rng.uniform(0.0, 0.7)
        u1 = u0 + 0.3 * w / 0.7
        vb = 1 - (row + 1) * 0.25 + 0.004
        vt = vb + 0.242
        self.de.polys.append(Poly(pts, "M_leaf_flora", [(u0, vb), (u1, vb), (u1, vt), (u0, vt)], [tint] * 4, "flora"))

    # ------------------------------------------------------------------------------------------- the door --
    def door(self, W, r, o):
        """An oak door pair (the contract's 1.8 x 2.9 opening and leaves): raised-panel lower halves, a glazed top behind a
        wrought-iron grille, black strap hinges, a ring pull, the keypad lock kept; a sandstone surround with a keystone."""
        H = self.H
        sh, de = self.sh, self.de
        u0, u1, v0, v1 = r
        reveal(sh, W, r, T_WALL, self.ground)
        oak = lin(self.c["door"])
        leaf = mul(oak, 1.0)
        jw = 0.07
        d0, d1 = 0.08, 0.20
        W.box(de, u0, u0 + jw, v0, v1, d0, d1, "oak", oak, faces="fr", along="y")
        W.box(de, u1 - jw, u1, v0, v1, d0, d1, "oak", oak, faces="fl", along="y")
        W.box(de, u0 + jw, u1 - jw, v1 - jw, v1, d0, d1, "oak", oak, faces="fu", along="u")
        W.box(de, u0, u1, v0 - 0.02, v0 + 0.015, -0.04, d1 + 0.05, "granite", self.stone, faces="ft", along="u")
        uc = (u0 + u1) / 2
        top = v1 - jw
        dd = 0.14
        f = dd - 0.028                            # the leaves' outer face
        for k, (a, b) in enumerate(((u0 + jw, uc - 0.004), (uc + 0.004, u1 - jw))):
            st = 0.12
            W.box(de, a, a + st, v0 + 0.015, top - 0.004, dd - 0.028, dd + 0.028, "oak", leaf, faces="frl", along="y")
            W.box(de, b - st, b, v0 + 0.015, top - 0.004, dd - 0.028, dd + 0.028, "oak", leaf, faces="flr", along="y")
            W.box(de, a + st, b - st, top - 0.004 - 0.14, top - 0.004, dd - 0.028, dd + 0.028, "oak", leaf, faces="fu", along="u")
            W.box(de, a + st, b - st, v0 + 0.015, v0 + 0.20, dd - 0.028, dd + 0.028, "oak", leaf, faces="ft", along="u")
            ym = v0 + 1.55
            W.box(de, a + st, b - st, ym - 0.06, ym + 0.06, dd - 0.028, dd + 0.028, "oak", leaf, faces="ftu", along="u")
            # the lower panel: board-filled, 1 cm back, with a raised field
            W.quad(sh, [(a + st, v0 + 0.20, dd - 0.018), (b - st, v0 + 0.20, dd - 0.018), (b - st, ym - 0.06, dd - 0.018),
                        (a + st, ym - 0.06, dd - 0.018)], "oak", mul(leaf, 0.92), (0, 0, -1), uax=UP)
            W.box(de, a + st + 0.06, b - st - 0.06, v0 + 0.30, ym - 0.16, dd - 0.034, dd - 0.018, "oak", mul(leaf, 1.05),
                  faces="fltru", along="y")
            # the glazed top behind a wrought-iron grille (bars + a scroll ring)
            W.quad(sh, [(a + st, ym + 0.06, dd), (b - st, ym + 0.06, dd), (b - st, top - 0.144, dd), (a + st, top - 0.144, dd)],
                   "M_glass", (1, 1, 1, 1), uvs=[(0, 0), (1, 0), (1, 1), (0, 1)])
            for j in range(1, 4):
                uu = a + st + (b - a - 2 * st) * j / 4
                W.box(de, uu - 0.008, uu + 0.008, ym + 0.06, top - 0.144, f - 0.022, f - 0.006, "metal_painted", lin(IRON),
                      faces="flr", along="y")
            yg = (ym + 0.06 + top - 0.144) / 2
            W.box(de, a + st, b - st, yg - 0.008, yg + 0.008, f - 0.024, f - 0.008, "metal_painted", lin(IRON), faces="ftu",
                  along="u")
            # strap hinges on the hinge side (3 straps)
            for yy in (v0 + 0.35, v0 + 1.45, top - 0.30):
                ha, hb = (a + 0.01, a + 0.48) if k == 0 else (b - 0.48, b - 0.01)
                W.box(de, ha, hb, yy - 0.025, yy + 0.025, f - 0.006, f, "metal_painted", lin(IRON), faces="ftu", along="u")
            # the ring pull at the meeting stile
            hu = uc - 0.20 if k == 0 else uc + 0.20
            W.box(de, hu - 0.04, hu + 0.04, v0 + 1.0, v0 + 1.08, f - 0.012, f, "metal_painted", lin(IRON), faces="fltru", along="u")
        # the digital lock (kept: the game's keypad) on the right leaf
        lu = uc + 0.60
        lf = f
        satin = lin("#3A3A3C")
        W.box(de, lu - 0.05, lu + 0.05, v0 + 0.98, v0 + 1.38, lf - 0.035, lf, "metal_painted", satin, faces="fltru", along="y")
        for rr in range(4):
            for col in (-1, 0, 1):
                ku, kv = lu + col * 0.022, v0 + 1.11 + rr * 0.035
                W.quad(de, [(ku - 0.007, kv - 0.007, lf - 0.038), (ku + 0.007, kv - 0.007, lf - 0.038),
                            (ku + 0.007, kv + 0.007, lf - 0.038), (ku - 0.007, kv + 0.007, lf - 0.038)], "M_lamp", (1, 1, 1, 1),
                       uvs=[(0.5, 0.5)] * 4)
        # the sandstone surround: jambs with a chamfer face, a lintel with a cornice and a keystone (shell: seen from far)
        st = self.stone
        jw2 = 0.20
        # the jambs stand 3 cm proud and 3 cm clear of the opening, so the leaves (opening to 95 degrees) with their lock keep 5 cm
        for (a, b) in ((u0 - jw2 - 0.05, u0 - 0.05), (u1 + 0.05, u1 + jw2 + 0.05)):
            W.box(sh, a, b, v0, v1, -0.025, 0.0, "granite", st, faces="flrt", along="y")
        W.box(sh, u0 - jw2 - 0.04, u1 + jw2 + 0.04, v1, v1 + 0.14, -0.06, 0.0, "granite", st, faces="flrtu", along="u")
        W.box(sh, u0 - jw2 - 0.08, u1 + jw2 + 0.08, v1 + 0.14, v1 + 0.19, -0.10, 0.0, "granite", mul(st, 1.04), faces="flrtu", along="u")
        W.box(sh, uc - 0.11, uc + 0.11, v1 - 0.02, v1 + 0.185, -0.085, -0.06, "granite", mul(st, 0.96), faces="flrtu", along="y")
        if K_KIND.get(H.id) == "deck" and self.J == 0:
            self.door_arch(W, u0 - jw2, u1 + jw2, v1 + 0.19)
        H.cut.append(("front", r, o))
        self.reg_wall_box("door_jamb", W, u0 - jw2 - 0.05, u0 - 0.05, v0, v1, -0.025, 0.0)
        self.reg_wall_box("door_jamb", W, u1 + 0.05, u1 + jw2 + 0.05, v0, v1, -0.025, 0.0)
        self.reg_wall_box("door_lintel", W, u0 - jw2 - 0.08, u1 + jw2 + 0.08, v1, v1 + 0.19, -0.10, 0.0)

    def door_arch(self, W, a, b, y0):
        """A segmental sandstone arch over the door's cornice (Eguisheim / Colmar doorways, refs 12, 26, 27): an oak tympanum
        with a carved sunburst (radial boards), a ring of nine voussoirs 5 cm proud, a keystone."""
        sh = self.sh
        st = self.stone
        uc = (a + b) / 2
        R = (b - a) / 2
        rise = 0.55
        n = 9
        oak = lin(self.c["door"])
        ring_w = 0.20
        prev = None
        for k in range(n + 1):
            t = math.pi * k / n
            pu, py = uc - R * math.cos(t), y0 + rise * math.sin(t)
            qu, qy = uc - (R + ring_w) * math.cos(t), y0 + (rise + ring_w) * math.sin(t)
            if prev is not None:
                (pu0, py0, qu0, qy0) = prev
                W.quad(sh, [(pu0, py0, -0.05), (pu, py, -0.05), (qu, qy, -0.05), (qu0, qy0, -0.05)], "granite",
                       mul(st, 1.0 if k % 2 else 0.95), (0, 0, -1), uax=(1, 0, 0))
                W.quad(sh, [(qu0, qy0, -0.05), (qu, qy, -0.05), (qu, qy, 0.0), (qu0, qy0, 0.0)], "granite", mul(st, 0.85),
                       (-(qu + qu0) / 2 + uc, (qy + qy0) / 2 - y0, 0), uax=(1, 0, 0))
                # the tympanum's radial boards (oak, 1 cm proud of the plaster)
                W.quad(sh, [(uc, y0, -0.01), (pu0, py0, -0.01), (pu, py, -0.01)], "oak", mul(oak, 0.9 + 0.1 * (k % 2)), (0, 0, -1),
                       uax=(1, 0, 0))
            prev = (pu, py, qu, qy)
        W.box(sh, uc - 0.10, uc + 0.10, y0 + rise - 0.05, y0 + rise + ring_w + 0.04, -0.075, -0.05, "granite", mul(st, 1.05),
              faces="flrtu", along="y")
        self.reg_wall_box("door_arch", W, a - ring_w, b + ring_w, y0, y0 + rise + ring_w + 0.04, -0.075, 0.0)

    # ------------------------------------------------------------------------------------------- the roof --
    def map(self, a, b, y):
        """Roof coordinates (a along the ridge, b across it from the ridge line) to the local (x, y, z)."""
        return (a, y, self.zc_r + b) if self.side else (b, y, a)

    def roof(self):
        """The beaver-tail tile roof: courses (each a texture row with its own offset, a 2.5 cm lip at every butt), the
        barge boards, eave and rake soffits, a mortared ridge of half-round ridge tiles; detail: the half-round zinc gutters,
        round down pipes, hooks."""
        sh, de = self.sh, self.de
        S = self.S
        tan = self.tan
        cp, sp = math.cos(self.pitch), math.sin(self.pitch)
        eave = EAVE_SIDE
        ext = S + eave
        a0 = self.a0 - RAKE_C
        a1 = self.a1 + RAKE_C
        y_e_t = WT - eave * tan + self.vt                      # the slab top at the eave edge
        L = ext / cp
        info = K.TEX["LM_roof"]
        e, rows, um = info["exposure_m"], info["rows"], info["u_m"]
        lip = 0.025
        e = e * 2                                              # a modelled lip every second course (budget); rows mapped in pairs
        self.dormer_cuts = []
        for s in (-1, 1):
            def Pt(t, a, lift=0.0, s=s):
                b = s * (ext - t * cp)
                y = y_e_t + t * sp
                return self.map(a, b + s * sp * lift, y + cp * lift)
            nrm = self.map(0.0, s * sp, cp)
            nrm = (nrm[0], cp, nrm[2]) if not self.side else (0.0, cp, s * sp)
            if not self.side:
                nrm = (s * sp, cp, 0.0)
            n = int(math.ceil((L - 0.03) / e))
            for k in range(n):
                t0, t1 = k * e, min(L, (k + 1) * e)
                rr = self.rng.randrange(rows - 1)
                vb, vt = 1 - (rr + 2) / rows, 1 - rr / rows
                vt = vb + (vt - vb) * (t1 - t0) / e
                uo = self.rng.random()
                lp = lip if k > 0 else lip * 1.6
                A0, A1 = Pt(t0, a0, lp), Pt(t0, a1, lp)
                B0, B1 = Pt(t1, a0), Pt(t1, a1)
                uv = [(a0 / um + uo, vb), (a1 / um + uo, vb), (a1 / um + uo, vt), (a0 / um + uo, vt)]
                face(sh, [A0, A1, B1, B0], "shingle", self.tile, nrm, uvs=uv)
                C0, C1 = Pt(t0, a0, 0.0 if k > 0 else -self.vt), Pt(t0, a1, 0.0 if k > 0 else -self.vt)
                rv = vb + 4.0 / 1024
                down = self.map(0.0, s * cp, -sp) if self.side else (s * cp, -sp, 0.0)
                if self.side:
                    down = (0.0, -sp, s * cp)
                face(sh, [C0, C1, A1, A0], "shingle", mul(self.tile, 0.7), down,
                     uvs=[(a0 / um + uo, vb), (a1 / um + uo, vb), (a1 / um + uo, rv), (a0 / um + uo, rv)])
            # eave soffit (painted boards) from the wall to the fascia, the fascia / barge board at the eave (timber)
            # the eave soffit along the roof's underside (painted boards), wall to fascia, in two strips
            wall_b = s * S
            yu = lambda b: WT - (abs(b) - S) * tan
            for (b0_, b1_) in ((wall_b, wall_b + s * eave * 0.5), (wall_b + s * eave * 0.5, wall_b + s * eave)):
                q = [self.map(self.a0, b0_, yu(b0_)), self.map(self.a1, b0_, yu(b0_)), self.map(self.a1, b1_, yu(b1_)),
                     self.map(self.a0, b1_, yu(b1_))]
                face(sh, q, "timber_cladding", lin("#F1EDE4"), (0, -1, 0), uax=(1, 0, 0) if self.side else (0, 0, 1))
            be = s * ext
            q = [self.map(a0, be, y_e_t - self.vt - 0.04), self.map(a1, be, y_e_t - self.vt - 0.04), self.map(a1, be, y_e_t),
                 self.map(a0, be, y_e_t)]
            outward = (0, 0, s) if self.side else (s, 0, 0)
            face(sh, q, "oak", self.beamc, outward, uax=(1, 0, 0) if self.side else (0, 0, 1))
            self.gutter(s, ext, a0, a1, y_e_t)
        # the rakes: barge boards over the gable ends (oak in the beam colour), the rake soffit
        for (aa, sg) in ((a0, -1), (a1, 1)):
            for s in (-1, 1):
                p0 = self.map(aa, 0.0, self.y_ridge_u - 0.05)
                p1 = self.map(aa, 0.0, self.y_ridge_u + self.vt + 0.06)
                p2 = self.map(aa, s * ext, y_e_t + 0.06)
                p3 = self.map(aa, s * ext, y_e_t - self.vt - 0.06)
                face(sh, [p0, p1, p2, p3], "oak", self.beamc, (sg, 0, 0) if self.side else (0, 0, sg),
                     uax=norm(sub(p2, p1)))
                aw = self.a0 if sg < 0 else self.a1
                q0 = self.map(aw, 0.0, self.y_ridge_u - 0.05)
                q1 = self.map(aa, 0.0, self.y_ridge_u - 0.05)
                q2 = self.map(aa, s * ext, y_e_t - self.vt)
                q3 = self.map(aw, s * ext, y_e_t - self.vt)
                face(sh, [q0, q1, q2, q3], "timber_cladding", lin("#F1EDE4"), (0, -1, 0), uax=norm(sub(q2, q1)))
        # ridge: half-round ridge tiles on a mortar bed (8 facets, per 0.4 m a lap ring)
        yc = self.y_ridge_u + self.vt + lip
        rr_ = 0.12
        nseg = 6
        for k in range(nseg):
            t0, t1 = math.pi * k / nseg, math.pi * (k + 1) / nseg
            c0 = (rr_ * math.cos(t0), rr_ * math.sin(t0))
            c1 = (rr_ * math.cos(t1), rr_ * math.sin(t1))
            q = [self.map(a0 - 0.03, c0[0], yc + c0[1] * 0.8), self.map(a1 + 0.03, c0[0], yc + c0[1] * 0.8),
                 self.map(a1 + 0.03, c1[0], yc + c1[1] * 0.8), self.map(a0 - 0.03, c1[0], yc + c1[1] * 0.8)]
            mid = (math.cos((t0 + t1) / 2), math.sin((t0 + t1) / 2))
            face(sh, q, "shingle", mul(self.tile, 0.9), (0, mid[1], mid[0]) if self.side else (mid[0], mid[1], 0),
                 uax=(1, 0, 0) if self.side else (0, 0, 1), scale=0.5)
        # mortar bed lines each side (white lime)
        for s in (-1, 1):
            q = [self.map(a0, s * rr_, yc - 0.01), self.map(a1, s * rr_, yc - 0.01), self.map(a1, s * (rr_ + 0.05), yc - 0.05),
                 self.map(a0, s * (rr_ + 0.05), yc - 0.05)]
            face(sh, q, "render", lin("#EEE8DC"), (0, 1, s) if self.side else (s, 1, 0), uax=(1, 0, 0) if self.side else (0, 0, 1))
        self.ridge_y = yc + rr_ * 0.8

    def gutter(self, s, ext, a0, a1, y_e_t):
        """A half-round zinc gutter on hooks at the eave, its two round down pipes (to the beds at the front, to sandstone
        splash blocks elsewhere)."""
        de = self.de
        z = lin(ZINC)
        R = 0.075
        b_in = s * (ext + 0.01)
        yc = y_e_t - 0.05
        segs = 5
        prev = None
        for k in range(segs + 1):
            t = math.pi * k / segs
            bb = b_in + s * R * (1 - math.cos(t))
            yy = yc - R * math.sin(t)
            if prev is not None:
                q = [self.map(a0 - 0.02, prev[0], prev[1]), self.map(a1 + 0.02, prev[0], prev[1]), self.map(a1 + 0.02, bb, yy),
                     self.map(a0 - 0.02, bb, yy)]
                cen = self.map(0, b_in + s * R, yc)
                mid = self.map(0, (prev[0] + bb) / 2, (prev[1] + yy) / 2)
                face(de, q, "metal_painted", z, sub(mid, cen), uax=(1, 0, 0) if self.side else (0, 0, 1))
                face(de, list(reversed(q)), "metal_painted", mul(z, 0.6), sub(cen, mid), uax=(1, 0, 0) if self.side else (0, 0, 1))
            prev = (bb, yy)
        # bead on the outer lip
        # down pipes near both ends of this eave
        wall_b = s * self.S
        pb = wall_b + s * 0.12
        for aa in ((self.a0 + 0.30), (self.a1 - 0.30)):
            if self.H.id == "house_3" and not self.side and s > 0 and aa > ZC:
                continue                     # house 3's side deck (a walkable flush deck) runs along the +x wall's front half
            top = self.map(aa, b_in + s * R, yc - R)
            kick = self.map(aa, b_in + s * R, yc - R - 0.18)
            drop = abs((b_in + s * R) - pb)
            wallp = self.map(aa, pb, yc - R - 0.18 - drop)
            # front pipes of an eave-front house end in the porch beds' soil; the others on a splash block
            front = self.side and s > 0
            yend = 0.27 if front else 0.18
            bot = self.map(aa, pb, yend)
            pts = [top, kick, wallp, bot]
            if front and self.J > 0:
                yj = FL + STOREY - 0.45
                pts = [top, kick, wallp, self.map(aa, pb, yj), self.map(aa, pb - self.J, yj - self.J), self.map(aa, pb - self.J, yend)]
            if not front:
                pts.append(self.map(aa, pb + s * 0.12, 0.08))
            self.round_tube(pts, 0.04, z, n=6)
            for yy in (1.0, 2.6, 4.2, 5.8):
                if yy < wallp[1] - 0.2:
                    c = self.map(aa, pb, yy)
                    box(de, c[0] - 0.05, c[0] + 0.05, yy, yy + 0.03, c[2] - 0.05, c[2] + 0.05, "metal_painted", mul(z, 1.05), along="x")
            lo = self.map(aa, pb - s * 0.12, 0.0)
            hi = self.map(aa, pb + s * 0.12, wallp[1])
            self.reg("downpipe", lo[0] - 0.06, hi[0] + 0.06, 0.0, hi[1], lo[2] - 0.06, hi[2] + 0.06)
            if not front:
                c = self.map(aa, pb + s * 0.35, 0.0)
                box(de, c[0] - 0.22, c[0] + 0.22, -0.02, 0.05, c[2] - 0.22, c[2] + 0.22, "granite", self.stone, skip=("bot",))

    def round_tube(self, pts, r, tint, n=8):
        de = self.de
        rings = []
        for i, p in enumerate(pts):
            a = pts[max(i - 1, 0)]
            b = pts[min(i + 1, len(pts) - 1)]
            t = norm(sub(b, a))
            ref = (1.0, 0.0, 0.0) if abs(t[0]) < 0.9 else (0.0, 0.0, 1.0)
            u = norm(cross(t, ref))
            v = cross(t, u)
            rings.append([add(p, add(sc(u, r * math.cos(2 * math.pi * k / n)), sc(v, r * math.sin(2 * math.pi * k / n)))) for k in range(n)])
        for i in range(len(pts) - 1):
            for k in range(n):
                k2 = (k + 1) % n
                q = [rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]]
                c = sc(add(add(q[0], q[1]), add(q[2], q[3])), 0.25)
                m = sc(add(pts[i], pts[i + 1]), 0.5)
                face(de, q, "metal_painted", tint, sub(c, m), uax=norm(sub(pts[i + 1], pts[i])))

    def roof_y(self, b):
        """The roof's tile surface height at distance |b| from the ridge line."""
        return self.y_ridge_u + self.vt - abs(b) * self.tan

    # ------------------------------------------------------------------------------------------- dormers --
    def dormers(self):
        """Two gabled dormers on the street slope of an eave-front house (a small plastered front with a timber frame
        edge, a two-leaf window, tile cheeks and a little tile roof)."""
        if not self.side or self.c["dormers"] <= 0:
            return
        sh, de = self.sh, self.de
        tan = self.tan
        for xc in (-2.6, 2.6):
            w = 1.25
            hw = w / 2
            b_front = self.S - 1.15                      # the dormer face's distance from the ridge line (on the front slope)
            zf = self.zc_r + b_front
            yb = self.roof_y(b_front) - 0.05             # its sill on the tiles
            yt = yb + 1.30                               # its wall top
            pitch = math.radians(48)
            yr = yt + hw * math.tan(pitch)
            # the back: where the dormer's ridge meets the main roof
            b_back = (self.y_ridge_u + self.vt - yr) / tan
            zb = self.zc_r + b_back
            Wf = Wall((0, 1), (xc, zf))
            # front wall (plaster with an opening) and its frame edge
            op = (-0.38, 0.38, yb + 0.22, yb + 1.12)

            def ext(v, hw=hw, yt=yt, yr=yr):
                if v <= yt:
                    return (-hw, hw)
                k = max(0.0, (yr - v) / math.tan(pitch))
                return (-k, k)
            wall_pieces(sh, Wf, ext, yb, [op], "render", self.infill, ybreaks=[yt, yr], uoff=self.rng.random())
            Wf.box(sh, -hw, -hw + 0.14, yb, yt, -0.04, 0.0, "oak", self.beamc, faces="flr", along="y")
            Wf.box(sh, hw - 0.14, hw, yb, yt, -0.04, 0.0, "oak", self.beamc, faces="flr", along="y")
            Wf.box(sh, -hw, hw, yb, yb + 0.14, -0.04, 0.0, "oak", self.beamc, faces="ftu", along="u")
            # cheeks (tile-hung) from the front down the slope to the roof
            for sx in (-1, 1):
                x = xc + sx * hw
                pts = [(x, yb, zf), (x, yt, zf), (x, yt, zb), ]
                # the cheek's bottom edge runs along the roof surface from the front sill back to where yt meets the roof
                b_meet = (self.y_ridge_u + self.vt - yt) / tan
                pts = [(x, yb, zf), (x, yt, zf), (x, yt, self.zc_r + b_meet)]
                face(sh, pts, "shingle", mul(self.tile, 0.95), (sx, 0, 0), uax=(0, 0, -1))
            # its roof: two slopes from the front (with a 0.25 overhang) back to the main roof
            zo = zf + 0.25
            for sx in (-1, 1):
                eave_x = xc + sx * (hw + 0.15)
                ye = yt - 0.15 * math.tan(pitch)
                q = [(xc, yr + 0.05, zo), (xc, yr + 0.05, zb), (eave_x, ye, zb - (yr - ye) / tan * 0.0 + 0.0), (eave_x, ye, zo)]
                # pull the eave's back corner down to the main roof
                b_e = (self.y_ridge_u + self.vt - ye) / tan
                q[2] = (eave_x, ye, self.zc_r + b_e)
                face(sh, q, "shingle", self.tile, (sx * math.sin(pitch), math.cos(pitch), 0), uax=(0, 0, -1), scale=0.5)
                # barge board at the front
                face(sh, [(xc, yr + 0.05, zo), (eave_x, ye, zo), (eave_x, ye - 0.16, zo), (xc, yr - 0.11, zo)], "oak", self.beamc,
                     (0, 0, 1), uax=(1, 0, 0))
            # its window, and a dark attic behind it (no sky seen through the glass)
            self.window(Wf, "dormer", op, None, 3, False)
            Wf.quad(sh, [(-0.55, yb, 0.75), (0.55, yb, 0.75), (0.55, yt + 0.2, 0.75), (-0.55, yt + 0.2, 0.75)], "render",
                    mul(lin(self.H.spec["room"]), 0.35), (0, 0, -1), scale=0.5)

    # ------------------------------------------------------------------------------------------- chimney --
    def chimney(self):
        sh = self.sh
        if self.side:
            cx, cz = HB * 0.45, self.zc_r - 0.8
            b = cz - self.zc_r
        else:
            cx, cz = -1.0, ZB + 2.2
            b = cx
        s = 0.36
        y0 = self.roof_y(abs(b) + s) - 0.3
        y1 = self.y_ridge_u + self.vt + 0.9
        box(sh, cx - s, cx + s, y0, y1, cz - s, cz + s, "render", self.infill, skip=("bot", "top"), along="y")
        box(sh, cx - s - 0.06, cx + s + 0.06, y1, y1 + 0.10, cz - s - 0.06, cz + s + 0.06, "granite", self.stone, skip=("bot",))
        # a little tile hood on two stone piers
        for dx in (-0.25, 0.25):
            box(sh, cx + dx - 0.06, cx + dx + 0.06, y1 + 0.10, y1 + 0.38, cz - 0.06, cz + 0.06, "granite", self.stone, skip=("bot",))
        for sx in (-1, 1):
            face(sh, [(cx, y1 + 0.55, cz - 0.3), (cx, y1 + 0.55, cz + 0.3), (cx + sx * 0.42, y1 + 0.36, cz + 0.3),
                      (cx + sx * 0.42, y1 + 0.36, cz - 0.3)], "shingle", self.tile, (sx * 0.5, 1, 0), uax=(0, 0, 1), scale=0.5)

    # --------------------------------------------------------------------------------- signs, baskets --
    def sign(self):
        """A wrought-iron hanging sign on the front's right corner, between the floors: a scrolled bracket and a pretzel-
        shaped iron plate (Alsace's bakers' sign; no lettering)."""
        if not self.c["sign"]:
            return
        de = self.de
        W = Wall((0, 1), (0.0, ZF))
        u = HB - 0.62
        y = FL + STOREY - 0.75
        iron = lin(IRON)
        W.box(de, u - 0.05, u + 0.05, y - 0.15, y + 0.15, -0.015, 0.0, "metal_painted", iron, faces="fltru", along="y")
        W.box(de, u - 0.015, u + 0.015, y + 0.10, y + 0.13, -0.85, -0.015, "metal_painted", iron, faces="fltu", along="d")
        # the scroll brace under the arm
        pts = [W.P(u, y - 0.12, -0.015), W.P(u, y - 0.05, -0.25), W.P(u, y + 0.04, -0.50), W.P(u, y + 0.10, -0.70)]
        self.round_tube(pts, 0.009, iron, n=4)
        # the sign: a pretzel silhouette as an iron plate (two loops + a twist), hung on two rings
        cx, cy, cd = u, y - 0.18, -0.55
        for (du, dy, rr) in ((-0.09, 0.0, 0.10), (0.09, 0.0, 0.10), (0.0, -0.12, 0.08)):
            n = 10
            ring = []
            for k in range(n + 1):
                t = 2 * math.pi * k / n
                ring.append(W.P(cx + du + rr * math.cos(t), cy + dy + rr * math.sin(t), cd))
            self.round_tube(ring, 0.012, lin("#B3874A"), n=4)
        for dd in (-0.65, -0.45):
            self.round_tube([W.P(u, y + 0.10, dd), W.P(u, y - 0.08, dd)], 0.006, iron, n=4)
        self.reg_wall_box("sign", W, u - 0.25, u + 0.25, y - 0.42, y + 0.15, -0.88, 0.0)

    def baskets(self):
        """Hanging baskets of trailing geraniums on scrolled iron brackets: one each side of the front door (every house), and
        at the front corners beside the ground-floor windows (some houses)."""
        de = self.de
        W = Wall((0, 1), (0.0, ZF))
        iron = lin(IRON)
        # (not on the canopy houses: the door hood's brackets stand there)
        spots = [] if K_KIND.get(self.H.id) == "canopy" else [(-1.45, FL + 2.95), (1.45, FL + 2.95)]
        if self.c["baskets"]:
            spots += [(u, FL + 2.75) for u in (-(HB - 0.62), HB - 0.62) if not (u > 0 and self.c["sign"])]
        for (u, y) in spots:
            W.box(de, u - 0.03, u + 0.03, y - 0.08, y + 0.08, -0.012, 0.0, "metal_painted", iron, faces="fltru", along="y")
            W.box(de, u - 0.01, u + 0.01, y + 0.04, y + 0.06, -0.45, -0.012, "metal_painted", iron, faces="ftu", along="d")
            # chains and the basket (a coir-lined iron bowl)
            yb = y - 0.45
            for (du, dd) in ((-0.12, -0.33), (0.12, -0.33), (0.0, -0.45)):
                self.round_tube([W.P(u, y + 0.04, -0.40), W.P(u + du, yb + 0.12, dd)], 0.004, iron, n=3)
            n = 8
            r_top, r_bot = 0.16, 0.08
            for k in range(n):
                a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
                q = [W.P(u + r_top * math.cos(a0), yb + 0.12, -0.33 + r_top * math.sin(a0)),
                     W.P(u + r_top * math.cos(a1), yb + 0.12, -0.33 + r_top * math.sin(a1)),
                     W.P(u + r_bot * math.cos(a1), yb - 0.04, -0.33 + r_bot * math.sin(a1)),
                     W.P(u + r_bot * math.cos(a0), yb - 0.04, -0.33 + r_bot * math.sin(a0))]
                c = W.P(u, yb + 0.04, -0.33)
                m = sc(add(add(q[0], q[1]), add(q[2], q[3])), 0.25)
                face(de, q, "timber_cladding", lin("#7A5A3A"), sub(m, c), uax=UP)
            # trailing geranium cards (two crossed) and the bed for the 3D plants
            p = W.P(u, yb + 0.10, -0.33)
            Wx = Wall((1, 0), (0.0, 0.0))
            self.card(p, 0.34, 0.30, W, lin("#E5323C"))
            self.card(p, 0.34, 0.30, Wx, lin("#F0506E"))
            self.window_boxes.append(dict(x0=p[0] - 0.14, x1=p[0] + 0.14, z0=p[2] - 0.14, z1=p[2] + 0.14, y=yb + 0.10, plant="pot",
                                          out=None))
            self.reg_wall_box("basket", W, u - 0.2, u + 0.2, yb - 0.05, y + 0.1, -0.52, 0.0)


K_KIND = {"house_1": "gable", "house_2": "deck", "house_3": "canopy", "house_4": "canopy", "house_5": "gable",
          "house_6": "gable", "house_7": "gable", "house_8": "canopy", "house_9": "deck", "house_10": "deck"}


def build(H):
    """Dress house H (house_kit.House, its windows from the table) as a Colmar house: shell + detail."""
    C = Colmar(H)
    C.plinth()
    C.body()
    C.roof()
    C.dormers()
    C.chimney()
    C.sign()
    C.baskets()
    H.window_boxes = C.window_boxes
    return C
