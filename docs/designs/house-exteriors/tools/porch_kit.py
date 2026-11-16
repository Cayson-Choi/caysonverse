"""A8 porch and site-fittings kit (X2): the ten houses' porches, steps, flower beds, posts, porch benches, LPG cages,
vegetable gardens, flush decks and owner-slot fittings as polygons, in plain Python (no bpy), on top of the body kit
(house_kit.py, X1). The build (build_house_body.py) and the checks (check_porch.py) import it.

Frame: house_kit's (contract 1): origin at the footprint's centre, local x = the right hand of someone walking in through
the door, local z = out of the door, y up from the lawn.

Every rectangle here is the contract's (houseExterior.ts PORCH_SPECS, PORCH_BENCH, HOUSE_GARDEN, HOUSE_LPG,
HOUSE_FLUSH_DECKS, HOUSE_SLOTS; contract 3-4), to the centimetre: check_porch.py reads layout.json's houseExteriors
(the colliders and lift zones the game uses) and checks every solid against them, the door leaves' swing against every
solid, and the solids against each other and the body (owner 2026-11-17: "자동문이 주위의 물체와 겹치잖아 제발 좀 꼼꼼하게
확인해" - nothing may clip).

LOD split (contract 5): the always-drawn shell gets the porch's big masses (slab, treads, deck under-plane, posts and the
porch roof's shingles, beams, ceiling and pediment) so a far house still stands on its porch; the near detail adds what is
read from 1-3 m (tile joints, nosings, anti-slip grooves, deck boards with gaps and screws, rails, post shoes, braces,
fascias, canopies, beds, plants, bench, LPG, garden, mailbox, nameplate, lamps). Shell faces never coincide with detail
faces (the detail is proud by >= 1 cm or the shell face is inset), so nothing z-fights when the detail comes and goes.

Materials: shell uses only X1's shell sets (LM_stone, LM_wood, LM_roof, LM_render); detail uses X1's detail five
(LM_metal, LM_stone, LM_wood, M_lamp, M_screen) + M_leaf_flora (the village's T_flora atlas: 4 rows of 256 px,
petunia / marigold / salvia / reeds; X3 binds village.glb's M_leaf_flora texture) = 6 draws. No new texture sets: the
house sets are at their 3 MB budget (contract 6), so porch surfaces reuse granite (steps, tiles, kerbs), oak (deck,
posts, bench), cedar (ceilings, garden beds), painted metal (shoes, rails' fixings, LPG, mailbox) and PVC (name plates),
tinted per part.
"""
import math
import random

import house_kit as K
from house_kit import UP, Poly, add, box, face, lin, mul, norm, sc, sub

# ------------------------------------------------------------------------------------------ contract numbers --
# houseExterior.ts (check_porch.py proves these against layout.json's houseExteriors to 0.01 m)

ZF = K.ZF                      # 3.125 body front (door plane)
PF = 3.205                     # plinth front = HOUSE_SOLID_LOCAL.z1: the porch slab starts here
HZ = 5.375                     # footprint front edge
FL = K.FL                      # 0.30 porch / deck top
RISE, TREAD, NSTEP = 0.10, 0.34, 2
KERB = 0.10                    # PORCH_FRONT_KERB
POST_HALF = 0.12               # collider half; the posts are smaller
HW = 5.6                       # footprint half width
SPECS = {
    "gable": dict(hs=2.6, hst=1.6, posts=(-2.3, 2.3), pz=5.155),
    "canopy": dict(hs=1.6, hst=1.6, posts=(), pz=0.0),
    "deck": dict(hs=3.4, hst=1.2, posts=(-3.28, -1.575, 1.575, 3.28), pz=5.155),
}
KIND = {"house_1": "gable", "house_2": "deck", "house_3": "canopy", "house_4": "canopy", "house_5": "gable",
        "house_6": "gable", "house_7": "gable", "house_8": "canopy", "house_9": "deck", "house_10": "deck"}
BENCH = dict(x0=-3.4, x1=-2.2, z0=3.205, z1=3.705, top=0.75, front=3.455 + 0.22)
GARDEN = (-3.0, 3.0, -8.375, -5.775)
GARDEN_SHIFT = {"house_10": -0.6}
NO_GARDEN = ("house_9",)
LPG = (3.5, 4.9, -6.005, -5.355)
LPG_MIRROR = ("house_10",)
FLUSH = {"house_3": (5.6, 7.6, -2.005, 3.125), "house_9": (-3.0, 3.0, -7.375, -5.355)}
SLOTS = {"nameplate": (1.45, 3.145, 1.90, 0.42, 0.16), "mailbox": (-1.55, 3.325, 1.45, 0.20, 0.06),
         "sign": (4.2, 4.775, 0.925, 0.90, 0.55)}
# the front door (house_kit.door): leaves hinged on the inner jamb faces x +-0.83, 0.14 m inside the wall, 0.826 wide
DOOR = dict(hinge=0.83, leaf=0.826, d=0.14, t=0.028, y0=FL + 0.015, y1=FL + 2.9 - 0.074, max_deg=95.0)
# a canopy of glass on steel arms instead of the design's box canopy on house 8 (X2 decision: the brief's glass /
# polycarbonate canopy, on the most modern of the three canopy houses)
GLASS_CANOPY = ("house_8",)

GRANITE = (1.0, 1.0, 1.0, 1.0)
JOINT = mul(GRANITE, 0.42)
STEEL_DARK = lin("#2F3236")
GALV = lin("#B7BBBF")


def fl_rng(seed):
    return random.Random(seed)


class Porch:
    """One house's X2 run: adds to H.shell / H.detail and records every solid (local AABBs) for check_porch.py."""

    def __init__(self, H):
        self.H = H
        self.id = H.id
        self.kind = KIND[H.id]
        self.spec = SPECS[self.kind]
        self.rng = random.Random(7000 + int(H.id.split("_")[1]))
        self.sh, self.de = H.shell, H.detail
        # solids: dict(name, group, role, box=(x0,x1,y0,y1,z0,z1), col=collider id or None)
        self.solids = []
        self.shell0 = H.shell.tris()
        self.detail0 = H.detail.tris()
        self.dark_trim = H.spec["fascia"] == "dark"

    # ---------------------------------------------------------------------------------------------- helpers --
    def reg(self, name, group, role, x0, x1, y0, y1, z0, z1, col=None):
        self.solids.append(dict(name=name, group=group, role=role, box=(min(x0, x1), max(x0, x1), min(y0, y1), max(y0, y1),
                                                                     min(z0, z1), max(z0, z1)), col=col))

    def sbox(self, part, name, group, role, x0, x1, y0, y1, z0, z1, sset, tint=(1, 1, 1, 1), skip=(), along=None, col=None,
             scale=1.0, shade=None):
        box(part, x0, x1, y0, y1, z0, z1, sset, tint, skip=skip, along=along, scale=scale, shade=shade)
        if role:
            self.reg(name, group, role, x0, x1, y0, y1, z0, z1, col)

    def reg_seg(self, name, group, role, a, b, h, n=8, col=None):
        """A thin straight part (rod, brace) as n boxes along it, so its bounds follow it."""
        for i in range(n):
            p = [a[k] + (b[k] - a[k]) * i / n for k in range(3)]
            q = [a[k] + (b[k] - a[k]) * (i + 1) / n for k in range(3)]
            self.reg(name, group, role, min(p[0], q[0]) - h, max(p[0], q[0]) + h, min(p[1], q[1]) - h, max(p[1], q[1]) + h,
                     min(p[2], q[2]) - h, max(p[2], q[2]) + h, col)

    def quad(self, part, pts, sset, tint, hint, **kw):
        face(part, pts, sset, tint, hint, **kw)

    def card(self, x, z, y, w, h, yaw, row, tint, veg=False, tilt=0.0):
        """A flower / vegetable card (M_leaf_flora, double sided): T_flora row `row`; veg = only the leafy bottom 30 %."""
        c, s = math.cos(yaw), math.sin(yaw)
        ax, az = x - c * w / 2, z + s * w / 2
        bx, bz = x + c * w / 2, z - s * w / 2
        tx, tz = s * h * tilt, c * h * tilt
        pts = [(ax, y, az), (bx, y, bz), (bx + tx, y + h, bz + tz), (ax + tx, y + h, az + tz)]
        u0 = self.rng.uniform(0.0, 0.7)
        u1 = u0 + 0.3 * w / 0.7
        vb = 1 - (row + 1) * 0.25 + 0.004
        vt = vb + (0.075 if veg else 0.242)
        self.de.polys.append(Poly(pts, "M_leaf_flora", [(u0, vb), (u1, vb), (u1, vt), (u0, vt)], [tint] * 4, "flora"))
        return pts

    def plant(self, x, z, y, w, h, row, tint, col=None, reach=None):
        """One flower / grass card: in the game (veg3d, flowerPlacement.ts) a planting spot. A card of rows 0-2 becomes
        the plants of its row within 0.24 m of its centre (petunias; pansies / marigolds; muscari / violas / tulips), a
        card of row 3 a 3D tuft as tall as the card (vegGeometry.grassTuft, r 0.26 x h / 0.4). Registered by what the
        game grows from it (`reach` round the centre), so the checks keep the grown plants off the kerbs and boards."""
        yaw = self.rng.uniform(0, math.pi)
        self.card(x, z, y, w, h, yaw, row, tint, False, self.rng.uniform(-0.1, 0.1))
        r = reach if reach is not None else (0.24 + 0.10 if row < 3 else 0.26 * h / 0.4 * 1.1)
        # what grows from it: muscari / tulips <= 0.45, petunias <= 0.30, pansies / marigolds <= 0.25 (vegPlants.ts)
        top = y + ((0.45, 0.30, 0.25)[row] if row < 3 else h * 1.1)
        self.reg("plant", "plant", "col", x - r, x + r, y, top, z - r, z + r, col=col)

    def crossed(self, x, z, y, w, h, row, tint, veg=False, col=None):
        """Two crossed cards; registered as one solid (group 'plant': may touch soil and stakes, nothing else)."""
        yaw = self.rng.uniform(0, math.pi)
        tilt = self.rng.uniform(-0.15, 0.15)
        a = self.card(x, z, y, w, h, yaw, row, tint, veg, tilt)
        b = self.card(x, z, y, w * 0.9, h * 0.95, yaw + math.pi / 2 + self.rng.uniform(-0.3, 0.3), row, tint, veg, -tilt)
        P = a + b
        self.reg("plant", "plant", "col", min(p[0] for p in P), max(p[0] for p in P), min(p[1] for p in P), max(p[1] for p in P),
                 min(p[2] for p in P), max(p[2] for p in P), col=col)

    # --------------------------------------------------------------------------------------------- the build --
    def run(self, name, fn, *a):
        s0, d0 = self.sh.tris(), self.de.tris()
        fn(*a)
        self.cost[name] = (self.sh.tris() - s0, self.de.tris() - d0)

    def build(self):
        k = self.kind
        self.cost = {}
        if k == "deck":
            self.run("deck", self.deck_porch)
        else:
            self.run("porch", self.stone_porch)
        if k == "gable":
            self.run("roof", self.gable_roof)
        elif k == "canopy":
            if self.id in GLASS_CANOPY:
                self.run("canopy", self.glass_canopy)
            else:
                self.run("canopy", self.box_canopy)
        self.run("beds", self.beds)
        if k != "gable" and not (k == "canopy" and self.id not in GLASS_CANOPY):
            self.run("sconces", self.sconces)
        self.run("nameplate", self.nameplate)
        self.run("mailbox", self.mailbox)
        self.run("lpg", self.lpg)
        if self.id not in NO_GARDEN:
            self.run("garden", self.garden)
        if self.id in FLUSH:
            self.run("flush", self.flush_deck, FLUSH[self.id])
        return self

    # ---------------------------------------------------------------------------------- granite porch + steps --
    def stone_porch(self):
        """Gable / canopy porch: a granite-tiled slab (+0.30) from the plinth to the footprint's front edge, two granite
        block steps (risers 0.10, treads 0.34) with a 2 cm bull-nosed lip and two anti-slip grooves, and (gable) a granite
        kerb band on the slab's front edge beside the steps."""
        sh, de = self.sh, self.de
        hs, hst = self.spec["hs"], self.spec["hst"]
        g = "porch"
        # ---- shell: the slab top and its front faces
        self.quad(sh, [(-hs, FL, PF), (hs, FL, PF), (hs, FL, HZ), (-hs, FL, HZ)], "granite", GRANITE, UP)
        self.reg("slab", g, "walk", -hs, hs, 0.0, FL, PF, HZ)
        if hs > hst:
            for sgn in (-1, 1):
                xa, xb = sorted((sgn * hst, sgn * hs))
                self.quad(sh, [(xa, -0.02, HZ), (xb, -0.02, HZ), (xb, FL, HZ), (xa, FL, HZ)], "granite", mul(GRANITE, 0.92),
                          (0, 0, 1))
        # slab nosing above the first tread, then the treads
        levels = [FL] + [FL - RISE * (k + 1) for k in range(NSTEP)]
        zs = [HZ + TREAD * k for k in range(NSTEP + 1)]
        nose, lip = 0.02, 0.035
        for k in range(NSTEP + 1):
            top = levels[k]
            below = levels[k + 1] if k < NSTEP else -0.02
            z1 = zs[k] if k == 0 else zs[k]
            # front of level k: nosing face, its underside, the recessed riser
            zf = HZ if k == 0 else zs[k]
            if k > 0:
                # tread k-1 (k = 1..NSTEP): top from under the nosing above to its front edge
                zt0 = zs[k - 1] - nose
                self.quad(sh, [(-hst, top, zt0), (hst, top, zt0), (hst, top, zf), (-hst, top, zf)], "granite", GRANITE, UP,
                          uax=(1, 0, 0))
                self.reg("tread_%d" % (k - 1), g, "walk", -hst, hst, below, top, zs[k - 1], zf)
                for sgn in (-1, 1):
                    x = sgn * hst
                    self.quad(sh, [(x, -0.02, zt0), (x, -0.02, zf - nose), (x, top, zf - nose), (x, top, zt0)], "granite",
                              mul(GRANITE, 0.9), (sgn, 0, 0), uax=(0, 0, 1))
                    self.quad(sh, [(x, top - lip, zf - nose), (x, top - lip, zf), (x, top, zf), (x, top, zf - nose)], "granite",
                              mul(GRANITE, 0.9), (sgn, 0, 0), uax=(0, 0, 1))
            self.quad(sh, [(-hst, top - lip, zf), (hst, top - lip, zf), (hst, top, zf), (-hst, top, zf)], "granite",
                      mul(GRANITE, 0.95), (0, 0, 1), uax=(1, 0, 0))
            self.quad(sh, [(-hst, below, zf - nose), (hst, below, zf - nose), (hst, top - lip, zf - nose), (-hst, top - lip, zf - nose)],
                      "granite", mul(GRANITE, 0.8), (0, 0, 1), uax=(1, 0, 0))
        # ---- detail: tile joints on the slab (600 mm porcelain-sized granite tiles), the tread joints and grooves
        y = FL + 0.0015
        jw = 0.0022
        xs = [x for x in [i * 0.6 + 0.3 for i in range(-6, 6)] if -hs + 0.05 < x < hs - 0.05]
        zk = [PF + 0.6 * i for i in range(1, 4) if PF + 0.6 * i < HZ - 0.08]
        kerb_z = HZ - KERB
        for x in xs:
            z_end = kerb_z if abs(x) > hst else HZ - nose - 0.005
            self.quad(de, [(x - jw, y, PF + 0.004), (x + jw, y, PF + 0.004), (x + jw, y, z_end), (x - jw, y, z_end)], "granite", JOINT,
                      UP, uax=(0, 0, 1))
        for z in zk:
            self.quad(de, [(-hs + 0.004, y, z - jw), (hs - 0.004, y, z - jw), (hs - 0.004, y, z + jw), (-hs + 0.004, y, z + jw)],
                      "granite", JOINT, UP, uax=(1, 0, 0))
        # the slab's front row: a long nosing block across the stair opening, grooved
        for k in range(NSTEP + 1):
            top = levels[k]
            zf = HZ if k == 0 else zs[k]
            zt0 = HZ - 0.30 if k == 0 else zs[k - 1] - nose
            yy = top + 0.0015
            if k == 0:
                self.quad(de, [(-hst + 0.004, yy, zt0 - jw), (hst - 0.004, yy, zt0 - jw), (hst - 0.004, yy, zt0 + jw),
                               (-hst + 0.004, yy, zt0 + jw)], "granite", JOINT, UP, uax=(1, 0, 0))
            for gz in (0.035, 0.06):
                self.quad(de, [(-hst + 0.06, yy, zf - gz - 0.004), (hst - 0.06, yy, zf - gz - 0.004), (hst - 0.06, yy, zf - gz + 0.004),
                               (-hst + 0.06, yy, zf - gz + 0.004)], "granite", mul(GRANITE, 0.5), UP, uax=(1, 0, 0))
            if k > 0:
                # each tread is two 1.6 m blocks: the joint across the top and down the riser
                for x in (0.0,):
                    self.quad(de, [(x - jw, yy, zt0 + 0.004), (x + jw, yy, zt0 + 0.004), (x + jw, yy, zf), (x - jw, yy, zf)], "granite",
                              JOINT, UP, uax=(0, 0, 1))
                    self.quad(de, [(x - jw, top - lip, zf + 0.0015), (x + jw, top - lip, zf + 0.0015), (x + jw, top, zf + 0.0015),
                                   (x - jw, top, zf + 0.0015)], "granite", JOINT, (0, 0, 1), uax=UP)
        # gable: the kerb band on the slab's front edge beside the steps (porch_3 / porch_4), granite, 8 cm proud
        if hs > hst:
            for i, sgn in enumerate((-1, 1)):
                xa, xb = sorted((sgn * hst, sgn * hs))
                self.sbox(de, "kerb_%d" % i, "kerb_%d" % i, "col", xa, xb, FL, FL + 0.08, HZ - KERB, HZ, "granite", mul(GRANITE, 0.97),
                          skip=("bot",), along="x", col="porch_%d" % (3 + i))

    # --------------------------------------------------------------------------------------------- deck porch --
    def deck_porch(self):
        """Houses 2, 9, 10: a timber deck (+0.30) of 138 mm boards with 6 mm gaps along the front, butt joints staggered
        over the joists, two stainless deck screws per board per joist; a skirt of fascia boards; two timber steps
        (two boards each, a 2 cm nosing); the front rail (face-mounted on 4 posts, square balusters at 0.12); the bench."""
        sh, de = self.sh, self.de
        hs, hst = self.spec["hs"], self.spec["hst"]
        deck_t = self.deck_tint()
        g = "porch"
        # ---- shell: the under-plane (dark, seen through the gaps), the skirt faces, the steps' bodies
        yb = FL - 0.025
        self.quad(sh, [(-hs, yb, PF), (hs, yb, PF), (hs, yb, HZ - 0.012), (-hs, yb, HZ - 0.012)], "oak", mul(deck_t, 0.32), UP)
        self.reg("deck", g, "walk", -hs, hs, 0.0, FL, PF, HZ)
        for sgn in (-1, 1):
            xa, xb = sorted((sgn * hst, sgn * hs))
            self.quad(sh, [(xa, -0.02, HZ - 0.012), (xb, -0.02, HZ - 0.012), (xb, FL - 0.03, HZ - 0.012), (xa, FL - 0.03, HZ - 0.012)],
                      "oak", mul(deck_t, 0.7), (0, 0, 1))
        levels = [FL - RISE * (k + 1) for k in range(NSTEP)]
        for k in range(NSTEP):
            top = levels[k] - 0.025
            z0, z1 = HZ + TREAD * k - 0.02, HZ + TREAD * (k + 1) - 0.02
            below = levels[k] - RISE if k < NSTEP - 1 else -0.02
            self.quad(sh, [(-hst, top, z0), (hst, top, z0), (hst, top, z1), (-hst, top, z1)], "oak", mul(deck_t, 0.32), UP)
            self.quad(sh, [(-hst, below, z1), (hst, below, z1), (hst, top, z1), (-hst, top, z1)], "oak", mul(deck_t, 0.65), (0, 0, 1))
            for sgn in (-1, 1):
                x = sgn * hst
                self.quad(sh, [(x, -0.02, z0), (x, -0.02, z1), (x, top, z1), (x, top, z0)], "oak", mul(deck_t, 0.6), (sgn, 0, 0),
                          uax=(0, 0, 1))
            self.reg("tread_%d" % k, g, "walk", -hst, hst, below, levels[k], HZ + TREAD * k, HZ + TREAD * (k + 1))
        # the riser under the deck's front edge over the first tread (shell, inset)
        self.quad(sh, [(-hst, levels[0] - 0.03, HZ - 0.03), (hst, levels[0] - 0.03, HZ - 0.03), (hst, FL - 0.03, HZ - 0.03),
                       (-hst, FL - 0.03, HZ - 0.03)], "oak", mul(deck_t, 0.5), (0, 0, 1))
        # ---- detail: the boards
        n = 15
        gap = 0.006
        span = HZ - (PF + 0.004)
        bw = (span - (n - 1) * gap) / n
        joists = [-hs + 0.1 + i * (2 * hs - 0.2) / 11 for i in range(12)]           # 12 joists, ~0.6 m apart
        for i in range(n):
            za = PF + 0.004 + i * (bw + gap)
            zb = za + bw
            tint = mul(deck_t, self.rng.uniform(0.86, 1.08))
            # one butt joint per board, over a joist, staggered
            j = joists[3 + (i * 5) % 6]
            pieces = [(-hs, j - 0.002), (j + 0.002, hs)]
            front = i == n - 1
            for (xa, xb) in pieces:
                face(de, [(xa, FL, za), (xb, FL, za), (xb, FL, zb), (xa, FL, zb)], "oak", tint, UP, uax=(1, 0, 0))
            if front:
                # the front (picture-frame) board's nose and the fascia board under it
                face(de, [(-hs, FL - 0.025, HZ), (hs, FL - 0.025, HZ), (hs, FL, HZ), (-hs, FL, HZ)], "oak", mul(tint, 0.85), (0, 0, 1),
                     uax=(1, 0, 0))
            # screws: two per joist, 25 mm in from each edge
            for jx in joists:
                if abs(jx - j) < 0.01:
                    sxs = (jx - 0.03, jx + 0.03)
                else:
                    sxs = (jx,)
                for sx in sxs:
                    for sz in (za + 0.026, zb - 0.026):
                        if BENCH["x0"] <= sx <= BENCH["x1"] and sz <= BENCH["front"] - 0.03:
                            continue          # under the bench's seat
                        self.screw(sx, FL, sz)
        # the skirt: two horizontal fascia boards beside the steps (proud 1.2 cm of the shell face), the stair riser board
        for sgn in (-1, 1):
            xa, xb = sorted((sgn * hst, sgn * hs))
            for (ya, yb_) in ((0.005, 0.135), (0.141, FL - 0.03)):
                self.sbox(de, "skirt", "porch", "col", xa + 0.002, xb - 0.002, ya, yb_, HZ - 0.012, HZ - 0.002, "oak",
                          mul(deck_t, 0.92), skip=("bot", "back"), along="x", col="porch_%d" % (3 if sgn < 0 else 4))
        # timber steps: two 165 mm boards per tread, nosing 2 cm over a riser board, screws into 3 stringers
        for k in range(NSTEP):
            top = levels[k]
            zt0 = HZ + TREAD * k - 0.02
            zt1 = HZ + TREAD * (k + 1)
            below = levels[k] - RISE if k < NSTEP - 1 else -0.01
            bwt = (zt1 - zt0 - gap) / 2
            for b in range(2):
                za = zt0 + b * (bwt + gap)
                zb = za + bwt
                tint = mul(deck_t, self.rng.uniform(0.88, 1.06))
                face(de, [(-hst, top, za), (hst, top, za), (hst, top, zb), (-hst, top, zb)], "oak", tint, UP, uax=(1, 0, 0))
                if b == 1:
                    face(de, [(-hst, top - 0.025, zt1), (hst, top - 0.025, zt1), (hst, top, zt1), (-hst, top, zt1)], "oak",
                         mul(tint, 0.85), (0, 0, 1), uax=(1, 0, 0))
                for sx in (-hst + 0.06, 0.0, hst - 0.06):
                    for sz in (za + 0.03, zb - 0.03):
                        self.screw(sx, top, sz)
            # the riser board (proud 1 cm of the shell riser)
            face(de, [(-hst, below, zt1 - 0.01), (hst, below, zt1 - 0.01), (hst, top - 0.026, zt1 - 0.01), (-hst, top - 0.026, zt1 - 0.01)],
                 "oak", mul(deck_t, 0.75), (0, 0, 1), uax=(1, 0, 0))
            # the stringers' end boards on the step sides
            for sgn in (-1, 1):
                x = sgn * (hst + 0.012)
                face(de, [(x, -0.01, zt0 + 0.02), (x, -0.01, zt1 - 0.01), (x, top - 0.026, zt1 - 0.01), (x, top - 0.026, zt0 + 0.02)],
                     "oak", mul(deck_t, 0.7), (sgn, 0, 0), uax=(0, 0, 1))
        # riser board under the deck's nose over the first tread
        face(de, [(-hst, levels[0], HZ - 0.022), (hst, levels[0], HZ - 0.022), (hst, FL - 0.026, HZ - 0.022), (-hst, FL - 0.026, HZ - 0.022)],
             "oak", mul(deck_t, 0.75), (0, 0, 1), uax=(1, 0, 0))
        # ---- the front rail: posts 0.14 square on the front edge (in their 0.24 colliders), face-mounted top and bottom rails
        # and 40 mm balusters at 0.12 (in the 0.10 kerb collider), a post cap
        rail_t = mul(deck_t, 1.05)
        pz0, pz1 = HZ - KERB - 0.14, HZ - KERB
        for i, px in enumerate(self.spec["posts"]):
            cid = "porch_%d" % (5 + i)
            self.sbox(de, "post_%d" % i, "rail_%d" % (0 if px < 0 else 1), "col", px - 0.07, px + 0.07, FL, 1.16, pz0, pz1, "oak",
                      rail_t, skip=("bot",), along="y", col=cid)
            self.sbox(de, "postcap_%d" % i, "rail_%d" % (0 if px < 0 else 1), "col", px - 0.09, px + 0.09, 1.16, 1.20, pz0 - 0.02,
                      pz1 - 0.001, "oak", mul(rail_t, 1.08), along="x", col=cid)
            # a galvanised post base (post anchor) on the deck
            self.sbox(de, "postbase_%d" % i, "rail_%d" % (0 if px < 0 else 1), "col", px - 0.08, px + 0.08, FL, FL + 0.006,
                      pz0 - 0.01, pz1 - 0.001, "metal_painted", GALV, skip=("bot",), along="x", col=cid)
        for sgn in (-1, 1):
            xa, xb = (1.25, 3.35) if sgn > 0 else (-3.35, -1.25)
            grp = "rail_%d" % (0 if sgn < 0 else 1)
            cid = "porch_%d" % (3 if sgn < 0 else 4)
            zr0, zr1 = HZ - KERB + 0.004, HZ - 0.006
            self.sbox(de, "toprail", grp, "col", xa, xb, 1.10, 1.145, zr0, zr1, "oak", mul(rail_t, 1.1), along="x", col=cid)
            self.sbox(de, "botrail", grp, "col", xa, xb, FL + 0.06, FL + 0.10, zr0 + 0.015, zr1 - 0.015, "oak", rail_t, along="x",
                      col=cid)
            nb = int((xb - xa - 0.08) / 0.12)
            for b in range(nb + 1):
                bx = xa + 0.04 + b * (xb - xa - 0.08) / nb
                # skip the balusters a post stands behind? no: the rail is in front of the posts, the balusters too
                self.sbox(de, "baluster", grp, "col", bx - 0.019, bx + 0.019, FL + 0.10, 1.10, zr0 + 0.025, zr1 - 0.025, "oak",
                          mul(rail_t, self.rng.uniform(0.93, 1.03)), skip=("top", "bot"), along="y", col=cid)
            # rail screws into the posts' faces (two per post per rail)
            for px in self.spec["posts"]:
                if (px > 0) == (sgn > 0):
                    for yy in (1.122, FL + 0.08):
                        for dx in (-0.035, 0.035):
                            face(de, [(px + dx - 0.005, yy - 0.005, zr1 + 0.0008), (px + dx + 0.005, yy - 0.005, zr1 + 0.0008),
                                      (px + dx + 0.005, yy + 0.005, zr1 + 0.0008), (px + dx - 0.005, yy + 0.005, zr1 + 0.0008)],
                                 "metal_painted", lin("#8C8F92"), (0, 0, 1))
        self.bench(deck_t)

    def deck_tint(self):
        return {"house_2": lin("#B07E5C"), "house_9": lin("#A98C76"), "house_10": lin("#8F6448")}.get(self.id, lin("#B07E5C"))

    def screw(self, x, y, z, s=0.0045):
        face(self.de, [(x - s, y + 0.0008, z - s), (x + s, y + 0.0008, z - s), (x + s, y + 0.0008, z + s), (x - s, y + 0.0008, z + s)],
             "metal_painted", lin("#55524E"), UP, uax=(1, 0, 0))

    # ------------------------------------------------------------------------------------------------ bench --
    def bench(self, deck_t):
        """The porch bench (2, 9, 10; contract PORCH_BENCH): oak, 1.2 m, seat top 0.75 above the lawn (0.45 above the deck),
        three seat slats, two back slats leaning on two back legs, end frames; in its collider (x -3.4..-2.2, z 3.205..3.705)."""
        de = self.de
        b = BENCH
        oak = lin("#C2945F")
        # collider order (contract 3): beds 1-2, kerbs 3-4 (slab wider than the steps), posts, then the bench
        cid = "porch_%d" % (2 + (2 if self.spec["hs"] > self.spec["hst"] else 0) + len(self.spec["posts"]) + 1)
        x0, x1 = b["x0"] + 0.012, b["x1"] - 0.012
        zf = b["front"]                         # 3.675: the seat's front edge (frontEdge 0.22 from the bench's centre)
        zb = b["z0"] + 0.03
        top = b["top"]
        grp = "bench"
        # legs: four 55 mm square legs, the back pair up into the backrest
        for lx in (x0 + 0.03, x1 - 0.03):
            self.sbox(de, "leg", grp, "col", lx - 0.0275, lx + 0.0275, FL, top - 0.035, zf - 0.09, zf - 0.035, "oak", oak, skip=("bot",),
                      along="y", col=cid)
            self.sbox(de, "leg", grp, "col", lx - 0.0275, lx + 0.0275, FL, 1.13, zb, zb + 0.055, "oak", oak, skip=("bot",), along="y",
                      col=cid)
            # side rail under the seat
            self.sbox(de, "rail", grp, "col", lx - 0.022, lx + 0.022, top - 0.11, top - 0.035, zb + 0.055, zf - 0.09, "oak",
                      mul(oak, 0.92), along="z", col=cid)
            # stretcher low down
            self.sbox(de, "stretch", grp, "col", lx - 0.018, lx + 0.018, FL + 0.10, FL + 0.14, zb + 0.055, zf - 0.09, "oak",
                      mul(oak, 0.9), along="z", col=cid)
        # front apron under the seat
        self.sbox(de, "apron", grp, "col", x0 + 0.058, x1 - 0.058, top - 0.10, top - 0.035, zf - 0.08, zf - 0.06, "oak", mul(oak, 0.9),
                  along="x", col=cid)
        # seat slats
        sd = (zf - (zb + 0.055)) / 3
        for i in range(3):
            za = zb + 0.055 + i * sd + 0.004
            zz = za + sd - 0.008
            self.sbox(de, "slat", grp, "col", x0, x1, top - 0.035, top, za, zz, "oak", mul(oak, self.rng.uniform(0.93, 1.06)), along="x",
                      col=cid)
        # back slats (on the back legs' front faces)
        for (ya, yb) in ((0.86, 0.96), (1.00, 1.10)):
            self.sbox(de, "back", grp, "col", x0, x1, ya, yb, zb + 0.055, zb + 0.08, "oak", mul(oak, self.rng.uniform(0.94, 1.04)),
                      along="x", col=cid)

    # ----------------------------------------------------------------------------------------- gable porch roof --
    def gable_roof(self):
        """Houses 1, 5, 6, 7: a timber porch on two 200 mm posts (steel U-shoes on base plates, knee braces), a header
        beam and two side beams on wall ledgers, a cedar ceiling with a downlight, a 25 degree gable roof in the house's
        asphalt shingles (shell) with a stucco pediment, metal fascias, verges, drip edges and a wall flashing (detail)."""
        sh, de = self.sh, self.de
        H = self.H
        timber = lin("#B98A5E")
        posts = self.spec["posts"]
        pz = self.spec["pz"]
        ph = 0.10
        g = "porchframe"
        yb0, yb1 = 3.25, 3.50                  # header beam
        xo = 2.4                               # the frame's outer face
        for i, px in enumerate(posts):
            cid = "porch_%d" % (5 + i)
            # shell: the post's four faces
            box(sh, px - ph, px + ph, FL, yb0, pz - ph, pz + ph, "oak", timber, skip=("top", "bot"), along="y")
            self.reg("post_%d" % i, g, "col", px - ph, px + ph, FL, yb0, pz - ph, pz + ph, col=cid)
            # detail: base plate, U-shoe side plates with bolt heads, a 2 cm stand-off block (the post never sits in water)
            self.sbox(de, "plate", g, "col", px - 0.11, px + 0.11, FL, FL + 0.012, pz - 0.11, pz + 0.11, "metal_painted", STEEL_DARK,
                      skip=("bot",), along="x", col=cid)
            for sx in (-1, 1):
                xa = px + sx * ph
                self.sbox(de, "shoe", g, "col", min(xa, xa + sx * 0.006), max(xa, xa + sx * 0.006), FL + 0.012, FL + 0.17,
                          pz - 0.085, pz + 0.085, "metal_painted", STEEL_DARK, skip=("bot",), along="z", col=cid)
                for (by, bz) in ((FL + 0.06, pz - 0.045), (FL + 0.12, pz + 0.045)):
                    bxx = xa + sx * 0.006
                    self.sbox(de, "bolt", g, "col", min(bxx, bxx + sx * 0.008), max(bxx, bxx + sx * 0.008), by - 0.011, by + 0.011,
                              bz - 0.011, bz + 0.011, "metal_painted", lin("#55585C"), along="z", col=cid)
            # anchor bolts' nuts on the plate
            for (dx, dz) in ((-0.085, -0.085), (0.085, -0.085), (-0.085, 0.085), (0.085, 0.085)):
                self.sbox(de, "nut", g, "col", px + dx - 0.011, px + dx + 0.011, FL + 0.012, FL + 0.026, pz + dz - 0.011,
                          pz + dz + 0.011, "metal_painted", lin("#55585C"), skip=("bot",), along="x", col=cid)
            # a moulded capital band at the post head (shell post continues inside it)
            self.sbox(de, "cap", g, "over", px - ph - 0.012, px + ph + 0.012, yb0 - 0.09, yb0 - 0.04, pz - ph - 0.012, pz + ph + 0.012,
                      "oak", mul(timber, 1.06), along="x")
            # knee braces (100 x 100, 45 degrees) to the header and to the side beam
            sgn = 1 if px > 0 else -1
            self.brace((px - sgn * ph, yb0 - 0.55, pz), (px - sgn * (ph + 0.55), yb0, pz), "x", timber)
            self.brace((px, yb0 - 0.55, pz - ph), (px, yb0 + 0.05, pz - ph - 0.60), "z", timber)
        # header beam (shell: front, back, bottom) across the posts and out to the frame's outer face
        box(sh, -xo, xo, yb0, yb1, pz - ph, pz + ph, "oak", timber, skip=("top",), along="x")
        self.reg("header", g, "over", -xo, xo, yb0, yb1, pz - ph, pz + ph)
        # side beams to the wall (on steel ledger plates), shell
        for sgn in (-1, 1):
            xa, xb = sorted((sgn * (xo - 2 * ph), sgn * xo))
            box(sh, xa, xb, yb0 + 0.05, yb1, ZF, pz - ph, "oak", timber, skip=("top", "front", "back"), along="z")
            self.reg("sidebeam", g, "over", xa, xb, yb0 + 0.05, yb1, ZF, pz - ph)
            self.sbox(de, "ledger", g, "over", xa - 0.01, xb + 0.01, yb0 + 0.02, yb1 + 0.005, ZF, ZF + 0.008, "metal_painted",
                      STEEL_DARK, skip=("back",), along="x")
        # ---- the roof: 25 degrees, eaves at x +-2.6, from the wall's belt-course face (z 3.18) to 0.245 past the header
        pitch = math.radians(25.0)
        tp, cp = math.tan(pitch), math.cos(pitch)
        xe = 2.6
        y_u = lambda x: yb1 + 0.02 + (xo - abs(x)) * tp          # roof underside
        vt = 0.12 / cp
        zr0, zr1 = ZF + 0.055, pz + ph + 0.245
        ye_u, yr_u = y_u(xe), y_u(0.0)
        ye_t, yr_t = ye_u + vt, yr_u + vt
        L = xe / cp
        roof_t = lin(H.spec["roof_tint"])
        info = K.TEX["LM_roof"]
        rows, um = info["rows"], info["u_m"]
        steps = 7
        for s in (-1, 1):
            def P(t, z, lift=0.0):
                x = s * (xe - t * cp)
                y = ye_t + t * math.sin(pitch)
                return (x + s * math.sin(pitch) * lift, y + cp * lift, z)
            nrm = (s * math.sin(pitch), cp, 0.0)
            for k in range(steps):
                t0, t1 = k * L / steps, (k + 1) * L / steps
                r = self.rng.randrange(rows - 2)
                vb, vtt = 1 - (r + 3) / rows, 1 - r / rows
                uo = self.rng.random()
                lip = K.SHINGLE_LIP if k > 0 else K.SHINGLE_LIP * 1.6
                a0, a1 = P(t0, zr0, lip), P(t0, zr1, lip)
                b0, b1 = P(t1, zr0), P(t1, zr1)
                uv = [(zr0 / um + uo, vb), (zr1 / um + uo, vb), (zr1 / um + uo, vtt), (zr0 / um + uo, vtt)]
                face(sh, [a0, a1, b1, b0], "shingle", roof_t, nrm, uvs=uv)
                c0, c1 = P(t0, zr0, 0.0 if k > 0 else -vt), P(t0, zr1, 0.0 if k > 0 else -vt)
                rh = math.sqrt(sum((a0[i] - c0[i]) ** 2 for i in range(3)))
                rv = vb + max(3.0, rh * 520.0) / 1024
                face(sh, [c0, c1, a1, a0], "shingle", mul(roof_t, 0.75), (s * cp, -math.sin(pitch), 0.0),
                     uvs=[(zr0 / um + uo, vb), (zr1 / um + uo, vb), (zr1 / um + uo, rv), (zr0 / um + uo, rv)])
        for s_ in (-1, 1):
            for k in range(steps):
                xa_, xb_ = xe - k * L / steps * cp, xe - (k + 1) * L / steps * cp
                self.reg("roof", g, "over", min(s_ * xa_, s_ * xb_) - (0.03 if k == 0 else 0), max(s_ * xa_, s_ * xb_),
                         y_u(xa_) - (0.07 if k == 0 else 0), y_u(xb_) + vt + 0.05, zr0, zr1 + 0.03)
        # ridge cap (shell, shingle)
        yc = yr_t + K.SHINGLE_LIP
        cap = mul(roof_t, 0.85)
        for s in (-1, 1):
            face(sh, [(0.0, yc + 0.06, zr0), (0.0, yc + 0.06, zr1 + 0.02), (s * 0.17, yc - 0.02, zr1 + 0.02), (s * 0.17, yc - 0.02, zr0)],
                 "shingle", cap, (s * 0.4, 1, 0), uax=(0, 0, 1))
        face(sh, [(-0.17, yc - 0.02, zr1 + 0.02), (0.17, yc - 0.02, zr1 + 0.02), (0.0, yc + 0.06, zr1 + 0.02)], "shingle", mul(cap, 0.8),
             (0, 0, 1), uax=(1, 0, 0))
        # ceiling (shell, cedar boards along x) at the beams' top, wall to header
        cz1 = pz + ph
        face(sh, [(-xo, yb1, ZF), (xo, yb1, ZF), (xo, yb1, cz1), (-xo, yb1, cz1)], "timber_cladding", lin("#E3D2BC"), (0, -1, 0),
             uax=(1, 0, 0))
        # pediment over the header (shell, stucco in the trim colour), and its back seen from under the roof? no: closed
        face(sh, [(-xo, yb1, cz1), (xo, yb1, cz1), (xo, y_u(xo), cz1), (0.0, yr_u, cz1), (-xo, y_u(xo), cz1)], "render", H.trim,
             (0, 0, 1), uax=(1, 0, 0))
        # ---- detail: the rake soffit (front overhang), fascias, verges, drip edges, wall flashing, the downlight
        fas = mul(H.fascia, 0.98)
        for s in (-1, 1):
            # rake soffit from the pediment to the front verge (sloped cedar)
            face(de, [(s * xo, y_u(xo), cz1), (0.0, yr_u, cz1), (0.0, yr_u, zr1), (s * xe, ye_u, zr1), (s * xe, ye_u, cz1)],
                 "timber_cladding", lin("#E3D2BC"), (0, -1, 0), uax=(0, 0, 1))
            # eave soffit strip between the side beam and the eave (sloped)
            face(de, [(s * xo, y_u(xo), ZF + 0.055), (s * xe, ye_u, ZF + 0.055), (s * xe, ye_u, cz1), (s * xo, y_u(xo), cz1)],
                 "timber_cladding", lin("#E3D2BC"), (0, -1, 0), uax=(0, 0, 1))
            # eave fascia (along z) and its drip edge
            face(de, [(s * xe, ye_u - 0.03, zr0), (s * xe, ye_u - 0.03, zr1), (s * xe, ye_t + 0.004, zr1), (s * xe, ye_t + 0.004, zr0)],
                 "metal_painted", fas, (s, 0, 0), uax=(0, 0, 1))
            face(de, [(s * (xe + 0.018), ye_t - 0.05, zr0), (s * (xe + 0.018), ye_t - 0.05, zr1 + 0.02),
                      (s * (xe + 0.018), ye_t + 0.012, zr1 + 0.02), (s * (xe + 0.018), ye_t + 0.012, zr0)], "metal_painted",
                 mul(fas, 0.9), (s, 0, 0), uax=(0, 0, 1))
            face(de, [(s * xe, ye_t + 0.012, zr0), (s * xe, ye_t + 0.012, zr1 + 0.02), (s * (xe + 0.018), ye_t + 0.012, zr1 + 0.02),
                      (s * (xe + 0.018), ye_t + 0.012, zr0)], "metal_painted", mul(fas, 0.95), UP, uax=(0, 0, 1))
            # front verge (the roof slab's sloped front edge) and its drip edge
            face(de, [(s * xe, ye_u - 0.03, zr1), (0.0, yr_u - 0.03, zr1), (0.0, yr_t + 0.03, zr1), (s * xe, ye_t + 0.004, zr1)],
                 "metal_painted", fas, (0, 0, 1), uax=norm((-s * cp, math.sin(pitch), 0)))
            face(de, [(s * (xe + 0.018), ye_t - 0.05, zr1 + 0.02), (0.0, yr_t - 0.025, zr1 + 0.02), (0.0, yr_t + 0.045, zr1 + 0.02),
                      (s * (xe + 0.018), ye_t + 0.012, zr1 + 0.02)], "metal_painted", mul(fas, 0.9), (0, 0, 1),
                 uax=norm((-s * cp, math.sin(pitch), 0)))
            # wall flashing (step flashing / counter flashing) along the roof-wall junction, 9 cm up the wall plane
            face(de, [(s * xe, ye_t, zr0 - 0.002), (0.0, yr_t, zr0 - 0.002), (0.0, yr_t + 0.09, zr0 - 0.002), (s * xe, ye_t + 0.09, zr0 - 0.002)],
                 "metal_painted", mul(fas, 0.92), (0, 0, 1), uax=norm((-s * cp, math.sin(pitch), 0)))
        self.reg("flashing", g, "over", -xe - 0.02, xe + 0.02, ye_t - 0.06, yr_t + 0.13, zr0 - 0.003, zr0)
        # crown moulding where the ceiling meets the wall, and a trim strip under the header's front
        self.sbox(de, "crown", g, "over", -xo + 0.21, xo - 0.21, yb1 - 0.05, yb1, ZF, ZF + 0.03, "oak", mul(timber, 1.1), skip=("back", "top"),
                  along="x")
        # the downlight in the ceiling (trim ring + lens)
        self.downlight(0.0, yb1, (ZF + cz1) / 2)

    def brace(self, a, b, axis, tint):
        """A 100 x 100 knee brace from point a to point b (both on its centre line), in the plane x = const (axis 'z') or
        z = const (axis 'x')."""
        de = self.de
        h = 0.05
        d = norm(sub(b, a))
        side = (1.0, 0.0, 0.0) if axis == "z" else (0.0, 0.0, 1.0)
        up = norm(K.cross(d, side))
        ring = lambda p: [add(add(p, sc(side, sx * h)), sc(up, sy * h)) for (sx, sy) in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        ra, rb = ring(a), ring(b)
        mid = sc(add(a, b), 0.5)
        for k in range(4):
            k2 = (k + 1) % 4
            q = [ra[k], ra[k2], rb[k2], rb[k]]
            c = sc(add(add(q[0], q[1]), add(q[2], q[3])), 0.25)
            face(de, q, "oak", tint if k % 2 else mul(tint, 0.9), sub(c, mid), uax=d)
        self.reg_seg("brace", "porchframe", "over", a, b, h * 1.42, 6)

    def lens(self, x, y, z, r, hint):
        """A lamp's frosted lens: M_window (dark by day, warm at night with the lit windows: X3's night switch), a hexagon
        in the shell (4 triangles), so a far house still shows its porch light at night."""
        pts = [(x + r * math.cos(math.pi / 3 * k), y, z + r * math.sin(math.pi / 3 * k)) for k in range(6)]
        face(self.sh, pts, "M_window", (1, 1, 1, 1), hint, uvs=[(0.5, 0.5)] * 6)

    def downlight(self, x, y, z, r=0.07):
        """A recessed downlight: a white steel trim ring (8 sides) round the lens (M_window, shell)."""
        de = self.de
        n = 8
        ring = lin("#E9E8E4")
        for k in range(n):
            a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
            p0 = (x + r * math.cos(a0), z + r * math.sin(a0))
            p1 = (x + r * math.cos(a1), z + r * math.sin(a1))
            q0 = (x + (r + 0.018) * math.cos(a0), z + (r + 0.018) * math.sin(a0))
            q1 = (x + (r + 0.018) * math.cos(a1), z + (r + 0.018) * math.sin(a1))
            face(de, [(p0[0], y - 0.004, p0[1]), (q0[0], y - 0.004, q0[1]), (q1[0], y - 0.004, q1[1]), (p1[0], y - 0.004, p1[1])],
                 "metal_painted", ring, (0, -1, 0))
        self.lens(x, y - 0.003, z, r * 1.02, (0, -1, 0))
        self.reg("downlight", "light", "over", x - r - 0.02, x + r + 0.02, y - 0.005, y, z - r - 0.02, z + r + 0.02)

    # ------------------------------------------------------------------------------------------------ canopies --
    def box_canopy(self):
        """Houses 3, 4: a steel box canopy 0.18 thick over the door (dark powder-coated fascia, a membrane top falling to a
        spout, cedar soffit with two downlights), on two wall brackets; house 4 also hangs on two steel tie rods."""
        de = self.de
        dark = lin("#33363A")
        x0, x1, z1 = -1.85, 1.85, ZF + 1.6
        y0, y1 = 3.50, 3.68
        g = "canopy"
        # fascia: front and the two ends (detail)
        self.sbox(de, "fascia", g, "over", x0, x1, y0, y1, z1 - 0.04, z1, "metal_painted", dark, skip=("back",), along="x")
        for sx in (x0, x1 - 0.04):
            self.sbox(de, "fascia", g, "over", sx, sx + 0.04, y0, y1, ZF, z1 - 0.04, "metal_painted", dark, skip=("front", "back"), along="z")
        # the top: a membrane sheet 2 cm under the fascia's top edge, falling 1 % to the front-left spout
        face(de, [(x0 + 0.04, y1 - 0.02, ZF), (x1 - 0.04, y1 - 0.02, ZF), (x1 - 0.04, y1 - 0.028, z1 - 0.04), (x0 + 0.04, y1 - 0.028, z1 - 0.04)],
             "metal_painted", mul(dark, 0.8), UP, uax=(1, 0, 0))
        face(de, [(x0 + 0.04, y1, ZF + 0.002), (x1 - 0.04, y1, ZF + 0.002), (x1 - 0.04, y1 + 0.08, ZF + 0.002), (x0 + 0.04, y1 + 0.08, ZF + 0.002)],
             "metal_painted", mul(dark, 0.9), (0, 0, 1), uax=(1, 0, 0))
        # the spout through the front fascia, near the left end
        self.sbox(de, "spout", g, "over", x0 + 0.25, x0 + 0.29, y1 - 0.06, y1 - 0.03, z1, z1 + 0.09, "metal_painted", dark, along="z")
        # soffit: cedar boards along x
        face(de, [(x0 + 0.04, y0, ZF), (x1 - 0.04, y0, ZF), (x1 - 0.04, y0, z1 - 0.04), (x0 + 0.04, y0, z1 - 0.04)], "timber_cladding",
             lin("#D9C3A6"), (0, -1, 0), uax=(1, 0, 0))
        self.reg("canopy", g, "over", x0, x1, y0, y1 + 0.08, ZF, z1 + 0.09)
        for dx in (-0.65, 0.65):
            self.downlight(dx, y0, ZF + 0.85, r=0.055)
        # wall brackets: triangular steel knees under the box near each end
        for bx in (x0 + 0.25, x1 - 0.25):
            self.brace_steel((bx, y0 - 0.55, ZF + 0.03), (bx, y0 - 0.02, ZF + 0.55), dark)
            self.sbox(de, "plate", g, "over", bx - 0.05, bx + 0.05, y0 - 0.62, y0 - 0.38, ZF, ZF + 0.01, "metal_painted", dark, skip=("back",),
                      along="y")
        if self.id == "house_4":
            for bx in (x0 + 0.2, x1 - 0.2):
                K.square_tube(de, [(bx, y1 - 0.01, z1 - 0.12), (bx, 4.62, ZF + 0.03)], 0.011, mul(dark, 1.2))
                self.sbox(de, "clevis", g, "over", bx - 0.02, bx + 0.02, y1 - 0.01, y1 + 0.03, z1 - 0.15, z1 - 0.09, "metal_painted", dark,
                          along="z")
                self.sbox(de, "anchor", g, "over", bx - 0.06, bx + 0.06, 4.55, 4.72, ZF, ZF + 0.012, "metal_painted", dark,
                          skip=("back",), along="y")
                self.reg_seg("tierod", g, "over", (bx, y1 - 0.01, z1 - 0.12), (bx, 4.62, ZF + 0.03), 0.012)

    def brace_steel(self, a, b, tint, h=0.02):
        """A flat steel strut (40 x 12) in the plane x = const."""
        de = self.de
        d = norm(sub(b, a))
        side = (1.0, 0.0, 0.0)
        up = norm(K.cross(d, side))
        ring = lambda p: [add(add(p, sc(side, sx * 0.006)), sc(up, sy * h)) for (sx, sy) in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        ra, rb = ring(a), ring(b)
        mid = sc(add(a, b), 0.5)
        for k in range(4):
            k2 = (k + 1) % 4
            q = [ra[k], ra[k2], rb[k2], rb[k]]
            c = sc(add(add(q[0], q[1]), add(q[2], q[3])), 0.25)
            face(de, q, "metal_painted", tint, sub(c, mid), uax=d)
        self.reg_seg("strut", "canopy", "over", a, b, h, 6)

    def glass_canopy(self):
        """House 8: a 12 mm laminated glass canopy (shell, M_glass) on two black steel cantilever arms with stainless point
        fixings and tie rods to the wall above, falling 1.5 degrees to the front, with a drip profile."""
        sh, de = self.sh, self.de
        black = lin("#26282B")
        steel = lin("#C4C6C8")
        g = "canopy"
        x0, x1 = -1.15, 1.15
        z0, z1 = ZF + 0.02, ZF + 1.32
        yb, yf = 3.62, 3.586                     # glass underside at the wall / at the front
        t = 0.012
        face(sh, [(x0, yb + t, z0), (x1, yb + t, z0), (x1, yf + t, z1), (x0, yf + t, z1)], "M_glass", (1, 1, 1, 1), UP,
             uvs=[(0, 0), (1, 0), (1, 1), (0, 1)])
        face(sh, [(x0, yb, z0), (x1, yb, z0), (x1, yf, z1), (x0, yf, z1)], "M_glass", (1, 1, 1, 1), (0, -1, 0),
             uvs=[(0, 0), (1, 0), (1, 1), (0, 1)])
        self.reg("glass", g, "over", x0, x1, yf, yb + t, z0, z1)
        # the glass's front edge profile (a thin aluminium U-channel with a drip), detail
        self.sbox(de, "edge", g, "over", x0 - 0.004, x1 + 0.004, yf - 0.012, yf + t + 0.006, z1, z1 + 0.012, "metal_painted", steel,
                  along="x")
        # wall channel (the glass sits in a steel U-channel on the wall)
        self.sbox(de, "channel", g, "over", x0 - 0.02, x1 + 0.02, yb - 0.035, yb + t + 0.035, ZF, z0 + 0.012, "metal_painted", black,
                  skip=("back",), along="x")
        for ax in (-0.8, 0.8):
            # the arm: a 100 x 12 flat bar tapering from the wall to the tip (a box here), under the glass with 4 cm fixings
            arm_y1 = lambda z: yb - 0.05 - (z - z0) * (yb - yf) / (z1 - z0)
            pts_top = [(ax - 0.006, arm_y1(z0), ZF), (ax + 0.006, arm_y1(z0), ZF), (ax + 0.006, arm_y1(z1 - 0.12), z1 - 0.12),
                       (ax - 0.006, arm_y1(z1 - 0.12), z1 - 0.12)]
            for sx in (-1, 1):
                xx = ax + sx * 0.006
                face(de, [(xx, arm_y1(ZF) - 0.12, ZF), (xx, arm_y1(z1 - 0.12) - 0.04, z1 - 0.12), (xx, arm_y1(z1 - 0.12), z1 - 0.12),
                          (xx, arm_y1(ZF), ZF)], "metal_painted", black, (sx, 0, 0), uax=(0, 0, 1))
            face(de, pts_top, "metal_painted", black, UP, uax=(0, 0, 1))
            face(de, [(ax - 0.006, arm_y1(ZF) - 0.12, ZF), (ax + 0.006, arm_y1(ZF) - 0.12, ZF), (ax + 0.006, arm_y1(z1 - 0.12) - 0.04, z1 - 0.12),
                      (ax - 0.006, arm_y1(z1 - 0.12) - 0.04, z1 - 0.12)], "metal_painted", mul(black, 0.8), (0, -1, 0), uax=(0, 0, 1))
            face(de, [(ax - 0.006, arm_y1(z1 - 0.12) - 0.04, z1 - 0.12), (ax + 0.006, arm_y1(z1 - 0.12) - 0.04, z1 - 0.12),
                      (ax + 0.006, arm_y1(z1 - 0.12), z1 - 0.12), (ax - 0.006, arm_y1(z1 - 0.12), z1 - 0.12)], "metal_painted", black,
                 (0, 0, 1), uax=UP)
            self.reg("arm", g, "over", ax - 0.006, ax + 0.006, arm_y1(ZF) - 0.12, arm_y1(ZF), ZF, z1 - 0.12)
            # wall plate with four bolts
            self.sbox(de, "plate", g, "over", ax - 0.06, ax + 0.06, arm_y1(ZF) - 0.16, arm_y1(ZF) + 0.04, ZF, ZF + 0.012, "metal_painted",
                      black, skip=("back",), along="y")
            # stainless point fixings (spigots) between arm and glass
            for fz in (z0 + 0.25, z1 - 0.2):
                yy = arm_y1(fz)
                gy = yb - (fz - z0) * (yb - yf) / (z1 - z0)
                self.sbox(de, "spigot", g, "over", ax - 0.022, ax + 0.022, yy, gy - 0.001, fz - 0.022, fz + 0.022, "metal_painted", steel,
                          along="y")
                self.sbox(de, "cap", g, "over", ax - 0.026, ax + 0.026, gy + t + 0.001, gy + t + 0.009, fz - 0.026, fz + 0.026,
                          "metal_painted", steel, skip=("bot",), along="x")
            # the tie rod from the arm's tip up to the wall (above the canopy, under the belt course)
            fz = z1 - 0.2
            gy = yb - (fz - z0) * (yb - yf) / (z1 - z0)
            K.square_tube(de, [(ax, gy + t + 0.009, fz), (ax, 4.06, ZF + 0.03)], 0.009, steel)
            self.reg_seg("tierod", g, "over", (ax, gy + t + 0.009, fz), (ax, 4.06, ZF + 0.03), 0.01)
            self.sbox(de, "anchor", g, "over", ax - 0.045, ax + 0.045, 4.0, 4.12, ZF, ZF + 0.012, "metal_painted", black, skip=("back",),
                      along="y")

    # --------------------------------------------------------------------------------------------- wall lights --
    def sconces(self):
        """Up-down wall lights beside the door (deck houses, house 8): a black or white aluminium cylinder (8 sides) on a
        round plate, glowing lenses top and bottom (M_lamp)."""
        de = self.de
        col = lin("#2B2D30") if self.dark_trim or self.id in GLASS_CANOPY else lin("#ECEBE6")
        for sx in (-1.3, 1.3):
            y0, y1 = 2.42, 2.66
            zc = ZF + 0.075
            r = 0.04
            n = 8
            for k in range(n):
                a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
                p0 = (sx + r * math.cos(a0), zc + r * math.sin(a0))
                p1 = (sx + r * math.cos(a1), zc + r * math.sin(a1))
                nrm = (math.cos((a0 + a1) / 2), 0.0, math.sin((a0 + a1) / 2))
                face(de, [(p0[0], y0, p0[1]), (p1[0], y0, p1[1]), (p1[0], y1, p1[1]), (p0[0], y1, p0[1])], "metal_painted", col, nrm, uax=UP)
            # the lenses: the downward one glows (M_window, shell), the upward one is a dark cap ring
            self.lens(sx, y0 - 0.001, zc, r * 0.82, (0, -1, 0))
            pts = [(sx + r * math.cos(2 * math.pi * k / n), y1, zc + r * math.sin(2 * math.pi * k / n)) for k in range(n)]
            face(de, pts, "metal_painted", mul(col, 0.8), UP, uax=(1, 0, 0))
            # the arm to the wall plate
            self.sbox(de, "arm", "sconce", "wall", sx - 0.015, sx + 0.015, 2.52, 2.56, ZF, zc - r, "metal_painted", col, along="z")
            self.sbox(de, "plate", "sconce", "wall", sx - 0.045, sx + 0.045, 2.49, 2.59, ZF, ZF + 0.012, "metal_painted", col,
                      skip=("back",), along="y")
            self.reg("sconce", "sconce", "wall", sx - r, sx + r, y0, y1, zc - r, zc + r)

    # --------------------------------------------------------------------------------------------- flower beds --
    def beds(self):
        """porch_1 / porch_2: raised granite-kerbed beds from the porch's edge to the footprint's side edge, plinth to front
        edge; kerb blocks 100 mm, 0.45 high (0.15 over the porch), joints every ~0.9 m; soil at 0.29 with bedding plants
        (petunias, marigolds, salvia) and ornamental grass, clear of the front down pipe (into a drain collar) and the yard
        sign's stake (slot__house_N_sign, hidden today)."""
        sh, de = self.sh, self.de
        hs = self.spec["hs"]
        ytop = 0.45
        soil = 0.29
        kt = mul(GRANITE, 0.95)
        soil_t = lin("#76604A")
        for i, sgn in enumerate((-1, 1)):
            cid = "porch_%d" % (1 + i)
            grp = "bed_%d" % i
            xin, xout = sgn * hs, sgn * HW
            xa, xb = min(xin, xout), max(xin, xout)
            # shell: the front face (inset 1 cm behind the detail kerb) — on the deck houses only (shell budget)
            if self.kind == "deck":
                self.quad(sh, [(xa, -0.02, HZ - 0.01), (xb, -0.02, HZ - 0.01), (xb, ytop - 0.01, HZ - 0.01), (xa, ytop - 0.01, HZ - 0.01)],
                          "granite", mul(kt, 0.9), (0, 0, 1))
            # kerbs: front, the porch side, the outer side
            self.sbox(de, "kerb_front", grp, "col", xa, xb, -0.02, ytop, HZ - KERB, HZ, "granite", kt, skip=("bot",), along="x", col=cid)
            xi0, xi1 = (xin, xin + sgn * 0.10)
            self.sbox(de, "kerb_in", grp, "col", min(xi0, xi1), max(xi0, xi1), -0.02 if self.kind == "canopy" else FL - 0.002, ytop, PF,
                      HZ - KERB, "granite", kt, skip=("bot", "back", "front"), along="z", col=cid)
            xo0, xo1 = (xout - sgn * 0.10, xout)
            self.sbox(de, "kerb_out", grp, "col", min(xo0, xo1), max(xo0, xo1), -0.02, ytop, PF, HZ - KERB, "granite", kt,
                      skip=("bot", "back", "front"), along="z", col=cid)
            # kerb joints (dark 4 mm strips on the front and top), every ~0.9 m
            L = xb - xa
            m = max(2, int(round(L / 0.9)))
            for k in range(1, m):
                x = xa + L * k / m
                face(de, [(x - 0.002, -0.0, HZ + 0.0012), (x + 0.002, 0.0, HZ + 0.0012), (x + 0.002, ytop, HZ + 0.0012),
                          (x - 0.002, ytop, HZ + 0.0012)], "granite", JOINT, (0, 0, 1), uax=UP)
                face(de, [(x - 0.002, ytop + 0.0012, HZ - KERB), (x + 0.002, ytop + 0.0012, HZ - KERB), (x + 0.002, ytop + 0.0012, HZ),
                          (x - 0.002, ytop + 0.0012, HZ)], "granite", JOINT, UP, uax=(0, 0, 1))
            for z in (PF + (HZ - KERB - PF) * 0.5,):
                for xx in (min(xi0, xi1), min(xo0, xo1)):
                    face(de, [(xx, ytop + 0.0012, z - 0.002), (xx + 0.10, ytop + 0.0012, z - 0.002), (xx + 0.10, ytop + 0.0012, z + 0.002),
                              (xx, ytop + 0.0012, z + 0.002)], "granite", JOINT, UP, uax=(1, 0, 0))
            # soil (fine-tilled loam with grit: the granite's speckle tinted earth-brown, at a fine scale; the detail mesh has
            # no render set)
            sx0, sx1 = min(xi1, xo0), max(xi1, xo0)
            face(de, [(sx0, soil, PF), (sx1, soil, PF), (sx1, soil, HZ - KERB), (sx0, soil, HZ - KERB)], "granite", soil_t, UP, scale=0.6)
            self.reg("soil", grp, "col", sx0, sx1, 0.0, soil, PF, HZ - KERB, col=cid)
            # the front down pipe (house_kit, x +-5.28, z 3.255) runs into the bed: a cast drain collar on the soil
            px = sgn * (K.HB - 0.32)
            zp = K.ZF + 0.13
            self.sbox(de, "collar", grp, "col", px - 0.06, px + 0.06, soil - 0.01, soil + 0.04, zp - 0.045, zp + 0.06, "metal_painted",
                      lin("#3A3C3F"), skip=("bot",), along="x", col=cid)
            # planting: spots on a 0.40 m grid (the game grows each into the plants of its row within 0.24 m: the bed is
            # planted full, as the village's beds are), the back row tall (muscari, tulips), petunias in the middle,
            # pansies and marigolds in front; clear of the down pipe and the yard sign's stake and board
            m_in = 0.36
            avoid_r = 0.42
            xs_ = []
            nx = max(1, int(round((sx1 - sx0 - 2 * m_in) / 0.40)))
            for c in range(nx + 1):
                xs_.append(sx0 + m_in + c * (sx1 - sx0 - 2 * m_in) / nx)
            z0_, z1_ = PF + m_in + 0.05, HZ - KERB - m_in
            nzr = max(1, int(round((z1_ - z0_) / 0.40)))
            for r in range(nzr + 1):
                z = z0_ + r * (z1_ - z0_) / nzr
                f = r / nzr
                row = 2 if f < 0.34 else (0 if f < 0.67 else 1)
                for x in xs_:
                    xx = x + self.rng.uniform(-0.03, 0.03)
                    zz = z + self.rng.uniform(-0.03, 0.03)
                    if math.hypot(xx - px, zz - zp) < avoid_r:
                        continue
                    if sgn > 0:
                        # under the yard sign's board (0.65 m up) only the low pansies / marigolds, and none on its stake
                        ddx = max(0.0, abs(xx - SLOTS["sign"][0]) - SLOTS["sign"][3] / 2 - 0.02)
                        ddz = max(0.0, abs(zz - SLOTS["sign"][1]) - 0.03)
                        if math.hypot(ddx, ddz) < 0.36:
                            row = 1
                        if math.hypot(xx - SLOTS["sign"][0], zz - SLOTS["sign"][1]) < 0.10:
                            continue
                    h = (0.34 if row == 2 else 0.28 if row == 0 else 0.24) * self.rng.uniform(0.9, 1.1)
                    self.plant(xx, zz, soil - 0.005, 0.40, h, row, mul((1, 1, 1, 1), self.rng.uniform(0.88, 1.0)), col=cid)
            if sgn > 0:
                # the yard sign's stake and board (slot__house_N_sign, hidden today): kept clear for the game to show it
                sxs, szs, sy, sw, shh = SLOTS["sign"]
                self.reg("sign_board", "sign", "col", sxs - sw / 2 - 0.02, sxs + sw / 2 + 0.02, sy - shh / 2, sy + shh / 2, szs - 0.03,
                         szs + 0.03, col=cid)
                self.reg("sign_stake", "sign", "col", sxs - 0.03, sxs + 0.03, soil, sy - shh / 2, szs - 0.03, szs + 0.03, col=cid)

    # --------------------------------------------------------------------------------------------- owner slots --
    def nameplate(self):
        """slot__house_N_nameplate: a honed granite back plate (0.47 x 0.21) with a cream acrylic face (0.42 x 0.16) whose
        front is 4 mm behind the slot's plane (z 3.145): the game (X3, houseSigns.ts) lays "N번 집" on it."""
        de = self.de
        x, z, y, w, h = SLOTS["nameplate"]
        self.sbox(de, "np_back", "nameplate", "wall", x - 0.235, x + 0.235, y - 0.105, y + 0.105, ZF, z - 0.008, "granite",
                  mul(GRANITE, 0.62), skip=("back",), along="x")
        self.sbox(de, "np_face", "nameplate", "wall", x - w / 2, x + w / 2, y - h / 2, y + h / 2, z - 0.008, z - 0.004, "pvc_frame",
                  lin("#F4EEDF"), skip=("back",), along="x")
        # four stainless rosettes at the back plate's corners
        for (dx, dy) in ((-0.218, -0.088), (0.218, -0.088), (-0.218, 0.088), (0.218, 0.088)):
            self.sbox(de, "rosette", "nameplate", "wall", x + dx - 0.008, x + dx + 0.008, y + dy - 0.008, y + dy + 0.008, z - 0.008,
                      z - 0.003, "metal_painted", lin("#C9CBCD"), skip=("back",), along="x")

    def mailbox(self):
        """slot__house_N_mailbox: a wall mailbox (powder-coated steel, 0.32 x 0.46 x 0.20) left of the door: a hinged lid
        overhanging 1 cm, the letter flap, a small lock, and the name strip (cream, 0.20 x 0.06) whose face is 3 mm behind
        the slot's plane (z 3.325), where the game writes the owner's name (empty today)."""
        de = self.de
        x, z, y, w, h = SLOTS["mailbox"]
        body = lin("#3C4045") if self.dark_trim else lin("#E7E5DF")
        g = "mailbox"
        xa, xb = x - 0.16, x + 0.16
        ya, yb = y - 0.27, y + 0.15
        zf = z - 0.006
        self.sbox(de, "body", g, "wall", xa, xb, ya, yb, ZF, zf, "metal_painted", body, skip=("back", "top"), along="x")
        # the lid: sloping 8 degrees to the front, 1 cm over the sides and front
        lt = 0.012
        y_back, y_front = yb + 0.05, yb + 0.022
        face(de, [(xa - 0.01, y_back, ZF), (xb + 0.01, y_back, ZF), (xb + 0.01, y_front, zf + 0.012), (xa - 0.01, y_front, zf + 0.012)],
             "metal_painted", mul(body, 1.05), UP, uax=(1, 0, 0))
        face(de, [(xa - 0.01, y_front - lt, zf + 0.012), (xb + 0.01, y_front - lt, zf + 0.012), (xb + 0.01, y_front, zf + 0.012),
                  (xa - 0.01, y_front, zf + 0.012)], "metal_painted", mul(body, 0.95), (0, 0, 1), uax=(1, 0, 0))
        for sx, xx in ((-1, xa - 0.01), (1, xb + 0.01)):
            face(de, [(xx, y_back - lt, ZF), (xx, y_front - lt, zf + 0.012), (xx, y_front, zf + 0.012), (xx, y_back, ZF)], "metal_painted",
                 mul(body, 0.9), (sx, 0, 0), uax=(0, 0, 1))
        face(de, [(xa - 0.01, y_back - lt, ZF), (xb + 0.01, y_back - lt, ZF), (xb + 0.01, y_front - lt, zf + 0.012),
                  (xa - 0.01, y_front - lt, zf + 0.012)], "metal_painted", mul(body, 0.6), (0, -1, 0), uax=(1, 0, 0))
        # the sides' top edge closing under the lid
        face(de, [(xa, yb, ZF), (xb, yb, ZF), (xb, yb, zf), (xa, yb, zf)], "metal_painted", mul(body, 0.5), UP, uax=(1, 0, 0))
        self.reg("lid", g, "wall", xa - 0.01, xb + 0.01, yb, y_back, ZF, zf + 0.012)
        # the letter flap (a dark slot under a hinged flap) high on the front
        self.sbox(de, "flap", g, "wall", xa + 0.04, xb - 0.04, yb - 0.075, yb - 0.035, zf, zf + 0.006, "metal_painted", mul(body, 0.92),
                  skip=("back",), along="x")
        face(de, [(xa + 0.045, yb - 0.085, zf + 0.0008), (xb - 0.045, yb - 0.085, zf + 0.0008), (xb - 0.045, yb - 0.078, zf + 0.0008),
                  (xa + 0.045, yb - 0.078, zf + 0.0008)], "metal_painted", lin("#141518"), (0, 0, 1), uax=(1, 0, 0))
        # the name strip: a cream plate in a thin raised frame
        self.sbox(de, "nameframe", g, "wall", x - w / 2 - 0.008, x + w / 2 + 0.008, y - h / 2 - 0.008, y + h / 2 + 0.008, zf, zf + 0.002,
                  "metal_painted", mul(body, 0.8), skip=("back",), along="x")
        self.sbox(de, "namestrip", g, "wall", x - w / 2, x + w / 2, y - h / 2, y + h / 2, zf + 0.002, z - 0.003, "pvc_frame",
                  lin("#F3EEE2"), skip=("back",), along="x")
        # the lock (a small round-ish barrel) low on the front, a door seam above it
        self.sbox(de, "lock", g, "wall", x - 0.012, x + 0.012, ya + 0.05, ya + 0.074, zf, zf + 0.012, "metal_painted", lin("#C9CBCD"),
                  skip=("back",), along="x")
        face(de, [(xa + 0.01, ya + 0.12, zf + 0.0008), (xb - 0.01, ya + 0.12, zf + 0.0008), (xb - 0.01, ya + 0.124, zf + 0.0008),
                  (xa + 0.01, ya + 0.124, zf + 0.0008)], "metal_painted", mul(body, 0.55), (0, 0, 1), uax=(1, 0, 0))

    # ----------------------------------------------------------------------------------------------------- LPG --
    def lpg(self):
        """col__house_N_lpg: two 50 kg LPG cylinders (grey, valve guards) on a concrete pad in a galvanised steel cage
        (angle frame, mesh panels = M_screen, a lockable double door, a sloping roof sheet), the regulator and pigtails on
        the wall, the yellow gas pipe up to the gas meter and into the wall; the electric meter box over it; an outdoor tap
        beside the cage. House 10's is mirrored."""
        de = self.de
        mir = -1 if self.id in LPG_MIRROR else 1
        X = lambda x: x * mir
        g = "lpg"
        cid = "lpg"
        zb = K.ZB - K.PLINTH_OUT                      # -5.355 plinth back face
        x0, x1 = 3.62, 4.88
        zo = LPG[2] + 0.02                            # -5.985 cage front
        h = 1.55
        bx = lambda a, b: (min(X(a), X(b)), max(X(a), X(b)))
        # concrete pad (granite set, grey)
        pa, pb = bx(3.52, 4.88)
        self.sbox(de, "pad", g, "col", pa, pb, -0.02, 0.07, LPG[2] + 0.005, zb, "granite", lin("#9C9C98"), skip=("bot", "back"), along="x",
                  col=cid)
        # cage frame: 30 mm galvanised angle posts and rings
        f = 0.03
        for (xx, zz) in ((x0, zo), (x1, zo), (x0, zb - f), (x1, zb - f)):
            xa, xb_ = bx(xx, xx + (f if xx == x0 else -f))
            self.sbox(de, "post", g, "col", xa, xb_, 0.07, h, min(zz, zz + f), max(zz, zz + f), "metal_painted", GALV, skip=("bot",),
                      along="y", col=cid)
        for yy in (0.07, h - f):
            xa, xb_ = bx(x0, x1)
            self.sbox(de, "ring", g, "col", xa, xb_, yy, yy + f, zo, zo + f, "metal_painted", GALV, along="x", col=cid)
            for xx in (x0, x1 - f):
                xa, xb_ = bx(xx, xx + f)
                self.sbox(de, "ring", g, "col", xa, xb_, yy, yy + f, zo + f, zb - f, "metal_painted", GALV, skip=("front", "back"),
                          along="z", col=cid)
        # the double door's meeting stiles and the hasp
        xm = (x0 + x1) / 2
        xa, xb_ = bx(xm - 0.02, xm + 0.02)
        self.sbox(de, "stile", g, "col", xa, xb_, 0.1, h - f, zo - 0.004, zo + 0.02, "metal_painted", GALV, along="y", col=cid)
        xa, xb_ = bx(xm + 0.03, xm + 0.09)
        self.sbox(de, "hasp", g, "col", xa, xb_, 0.82, 0.88, zo - 0.012, zo - 0.004, "metal_painted", lin("#8D9196"), skip=("back",),
                  along="x", col=cid)
        # mesh panels (M_screen: the welded mesh reads as a dark see-through grid)
        for (ya, yb) in ((0.1, h - f),):
            a, b = X(x0 + f), X(x1 - f)
            face(de, [(a, ya, zo + 0.012), (b, ya, zo + 0.012), (b, yb, zo + 0.012), (a, yb, zo + 0.012)], "M_screen", (1, 1, 1, 1), (0, 0, -1))
            for xx in (x0 + 0.012, x1 - 0.012):
                face(de, [(X(xx), ya, zo + f), (X(xx), ya, zb - f), (X(xx), yb, zb - f), (X(xx), yb, zo + f)], "M_screen", (1, 1, 1, 1),
                     (1, 0, 0))
        # the welded mesh's wires: 5 mm bars (front faces only) over the panels, 0.1 m apart upright, 0.25 m across
        wire = mul(GALV, 0.92)
        nv = int(round((x1 - x0 - 2 * f) / 0.1))
        for k in range(1, nv):
            xx = x0 + f + k * (x1 - x0 - 2 * f) / nv
            if abs(xx - xm) < 0.03:
                continue
            face(de, [(X(xx - 0.0025), 0.1, zo + 0.006), (X(xx + 0.0025), 0.1, zo + 0.006), (X(xx + 0.0025), h - f, zo + 0.006),
                      (X(xx - 0.0025), h - f, zo + 0.006)], "metal_painted", wire, (0, 0, -1), uax=UP)
        for yy in [0.1 + k * (h - f - 0.1) / 6 for k in range(1, 6)]:
            face(de, [(X(x0 + f), yy - 0.0025, zo + 0.005), (X(x1 - f), yy - 0.0025, zo + 0.005), (X(x1 - f), yy + 0.0025, zo + 0.005),
                      (X(x0 + f), yy + 0.0025, zo + 0.005)], "metal_painted", wire, (0, 0, -1), uax=(1, 0, 0))
        for (xx, sgn_) in ((x0 + 0.006, -1), (x1 - 0.006, 1)):
            ns = int(round((zb - zo - 2 * f) / 0.1))
            for k in range(1, ns):
                zz = zo + f + k * (zb - zo - 2 * f) / ns
                face(de, [(X(xx), 0.1, zz - 0.0025), (X(xx), 0.1, zz + 0.0025), (X(xx), h - f, zz + 0.0025), (X(xx), h - f, zz - 0.0025)],
                     "metal_painted", wire, (sgn_ * mir, 0, 0), uax=UP)
            for yy in [0.1 + k * (h - f - 0.1) / 6 for k in range(1, 6)]:
                face(de, [(X(xx), yy - 0.0025, zo + f), (X(xx), yy - 0.0025, zb - f), (X(xx), yy + 0.0025, zb - f), (X(xx), yy + 0.0025, zo + f)],
                     "metal_painted", wire, (sgn_ * mir, 0, 0), uax=(0, 0, 1))
        # roof sheet: corrugated look by two folds, falling to the front, 4 cm overhang inside the collider
        ra, rb = bx(x0 - 0.06, x1 + 0.0)
        self.sbox(de, "roof", g, "col", ra, rb, h, h + 0.02, LPG[2] + 0.004, zb, "metal_painted", lin("#A9AEB3"), skip=("back",),
                  along="x", col=cid)
        # cylinders: 10-sided, d 0.37, shoulder, valve guard, valve
        grey = lin("#9EA3A8")
        for cx in (x0 + 0.33, x1 - 0.33):
            self.cylinder(X(cx), (zo + zb) / 2 + 0.02, 0.07, grey, X(1))
        # regulator on the wall between the cylinders, the pigtails from the valves, the yellow gas pipe (all on the wall
        # face above the plinth: wz)
        wz = K.ZB
        yel = lin("#E2B21C")
        rx = xm
        self.sbox(de, "reg", g, "col", min(X(rx - 0.06), X(rx + 0.06)), max(X(rx - 0.06), X(rx + 0.06)), 1.30, 1.42, wz - 0.09, wz,
                  "metal_painted", lin("#3E4248"), skip=("back",), along="x", col=cid)
        cz = (zo + zb) / 2 + 0.02
        for cx in (x0 + 0.33, x1 - 0.33):
            hose = lin("#2A2C2F")
            self.tube_z((X(cx), 1.29, cz), (X(cx), 1.36, wz - 0.05), 0.008, hose)
            self.tube_x((X(cx), 1.36, wz - 0.05), (X(rx), 1.36, wz - 0.05), 0.008, hose)
        # the yellow pipe: from the regulator's top, along, up through the cage roof to the gas meter, into the wall
        gx = 4.62
        pz_ = wz - 0.045
        self.tube_y((X(rx), 1.42, pz_), (X(rx), 1.48, pz_), 0.018, yel)
        self.tube_x((X(rx), 1.48, pz_), (X(gx), 1.48, pz_), 0.018, yel)
        self.tube_y((X(gx), 1.48, pz_), (X(gx), 1.78, pz_), 0.018, yel)
        self.sbox(de, "clip", g, "col", min(X(gx - 0.03), X(gx + 0.03)), max(X(gx - 0.03), X(gx + 0.03)), 1.62, 1.64, wz - 0.07, wz,
                  "metal_painted", lin("#8E9298"), skip=("back",), along="x", col=cid)
        # gas meter (beige case, a dark dial window) on the wall, then the pipe out of its top and into the wall
        ma, mb = bx(gx - 0.12, gx + 0.12)
        self.sbox(de, "gasmeter", g, "col", ma, mb, 1.78, 2.05, wz - 0.14, wz, "metal_painted", lin("#D7D2C4"), skip=("back",), along="x",
                  col=cid)
        face(de, [(X(gx - 0.07), 1.9, wz - 0.1415), (X(gx + 0.07), 1.9, wz - 0.1415), (X(gx + 0.07), 1.98, wz - 0.1415),
                  (X(gx - 0.07), 1.98, wz - 0.1415)], "metal_painted", lin("#1E2124"), (0, 0, -1), uax=(1, 0, 0))
        self.tube_y((X(gx), 2.05, pz_), (X(gx), 2.18, pz_), 0.018, yel)
        self.tube_z((X(gx), 2.18, pz_), (X(gx), 2.18, wz + 0.02), 0.018, yel, role="pierce")
        # electric meter box (grey, a window) left of the gas meter
        ea, eb = bx(3.72, 4.04)
        self.sbox(de, "elec", g, "col", ea, eb, 1.70, 2.12, wz - 0.13, wz, "metal_painted", lin("#B4B6B2"), skip=("back",), along="x",
                  col=cid)
        face(de, [(X(3.80), 1.86, wz - 0.1315), (X(3.96), 1.86, wz - 0.1315), (X(3.96), 2.02, wz - 0.1315), (X(3.80), 2.02, wz - 0.1315)],
             "M_screen", (1, 1, 1, 1), (0, 0, -1))
        # outdoor tap beside the cage (wall plate, spout, a red cross handle), in the LPG collider's strip
        tx = 3.565
        ta, tb = bx(tx - 0.035, tx + 0.035)
        self.sbox(de, "tapplate", g, "col", ta, tb, 0.52, 0.62, wz - 0.01, wz, "metal_painted", lin("#C9CBCD"), skip=("back",), along="y",
                  col=cid)
        self.tube_z((X(tx), 0.57, wz - 0.01), (X(tx), 0.57, zb - 0.012), 0.012, lin("#C9CBCD"))
        self.tube_y((X(tx), 0.57, zb - 0.012), (X(tx), 0.52, zb - 0.012), 0.01, lin("#C9CBCD"))
        ha, hb = bx(tx - 0.03, tx + 0.03)
        self.sbox(de, "taphandle", g, "col", ha, hb, 0.60, 0.612, wz - 0.06, wz - 0.048, "metal_painted", lin("#B21E22"), along="x",
                  col=cid)

    def cylinder(self, cx, cz, y0, tint, mir):
        de = self.de
        r, n = 0.185, 8
        y1 = y0 + 0.98
        ys = (y1 + 0.13)
        for k in range(n):
            a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
            p0 = (cx + r * math.cos(a0), cz + r * math.sin(a0))
            p1 = (cx + r * math.cos(a1), cz + r * math.sin(a1))
            q0 = (cx + 0.07 * math.cos(a0), cz + 0.07 * math.sin(a0))
            q1 = (cx + 0.07 * math.cos(a1), cz + 0.07 * math.sin(a1))
            nrm = (math.cos((a0 + a1) / 2), 0.0, math.sin((a0 + a1) / 2))
            shade = 0.82 + 0.18 * max(0.0, nrm[2] * -1 + 0.3)
            face(de, [(p0[0], y0, p0[1]), (p1[0], y0, p1[1]), (p1[0], y1, p1[1]), (p0[0], y1, p0[1])], "metal_painted", mul(tint, shade), nrm,
                 uax=UP)
            face(de, [(p0[0], y1, p0[1]), (p1[0], y1, p1[1]), (q1[0], ys, q1[1]), (q0[0], ys, q0[1])], "metal_painted", mul(tint, shade * 1.04),
                 (nrm[0], 0.9, nrm[2]), uax=UP)
            # a weld seam band at mid height
            if k % 1 == 0:
                pass
            # the valve guard: an open collar (outer faces)
            g0 = (cx + 0.085 * math.cos(a0), cz + 0.085 * math.sin(a0))
            g1 = (cx + 0.085 * math.cos(a1), cz + 0.085 * math.sin(a1))
            if k not in (1, 5):           # two hand openings
                face(de, [(g0[0], ys, g0[1]), (g1[0], ys, g1[1]), (g1[0], ys + 0.16, g1[1]), (g0[0], ys + 0.16, g0[1])], "metal_painted",
                     mul(tint, shade * 0.95), nrm, uax=UP)
        face(de, [(cx + 0.07 * math.cos(2 * math.pi * k / n), ys, cz + 0.07 * math.sin(2 * math.pi * k / n)) for k in range(n)],
             "metal_painted", mul(tint, 0.9), UP, uax=(1, 0, 0))
        # the foot ring's dark band and the valve (brass) with its red handwheel
        for k in range(n):
            pass
        self.sbox(self.de, "valve", "lpg", "col", cx - 0.02, cx + 0.02, ys, ys + 0.09, cz - 0.02, cz + 0.02, "metal_painted", lin("#B08A3E"),
                  skip=("bot",), along="y", col="lpg")
        self.sbox(self.de, "wheel", "lpg", "col", cx - 0.035, cx + 0.035, ys + 0.09, ys + 0.105, cz - 0.035, cz + 0.035, "metal_painted",
                  lin("#A8221E"), along="x", col="lpg")
        self.reg("cylinder", "lpg", "col", cx - r, cx + r, y0, ys + 0.16, cz - r, cz + r, col="lpg")

    def tube_x(self, a, b, h, tint, role="col"):
        self._tube(a, b, h, tint, (0.0, 0.0, 1.0), role)

    def tube_y(self, a, b, h, tint, role="col"):
        self._tube(a, b, h, tint, (1.0, 0.0, 0.0), role)

    def tube_z(self, a, b, h, tint, role="col"):
        self._tube(a, b, h, tint, (1.0, 0.0, 0.0), role)

    def _tube(self, a, b, h, tint, side, role="col"):
        de = self.de
        d = norm(sub(b, a))
        up = norm(K.cross(d, side))
        side = norm(K.cross(up, d))
        ring = lambda p: [add(add(p, sc(side, sx * h)), sc(up, sy * h)) for (sx, sy) in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        ra, rb = ring(a), ring(b)
        mid = sc(add(a, b), 0.5)
        for k in range(4):
            k2 = (k + 1) % 4
            q = [ra[k], ra[k2], rb[k2], rb[k]]
            c = sc(add(add(q[0], q[1]), add(q[2], q[3])), 0.25)
            face(de, q, "metal_painted", tint if k % 2 else mul(tint, 0.88), sub(c, mid), uax=d)
        xs = [p[0] for p in ra + rb]
        ys = [p[1] for p in ra + rb]
        zs = [p[2] for p in ra + rb]
        self.reg("tube", "lpg", role, min(xs), max(xs), min(ys), max(ys), min(zs), max(zs), col="lpg")

    # -------------------------------------------------------------------------------------------------- garden --
    def garden(self):
        """col__garden_house_N: two raised vegetable beds of new, oiled timber (owner 2026-11-17: everything brand-new) (two 150 mm boards high, corner posts, a cap
        board), tilled soil, rows of lettuce / cabbage leaves (the flora atlas's leafy bottoms), and pepper stakes (고추
        지지대: green-coated steel) with twine; inset in the collider (house 10's LPG cage stands near its corner)."""
        de = self.de
        dx = GARDEN_SHIFT.get(self.id, 0.0)
        gx0, gx1, gz0, gz1 = GARDEN[0] + dx, GARDEN[1] + dx, GARDEN[2], GARDEN[3]
        timber = lin("#B98A5E")  # new oiled timber (was a weathered grey #9C8A76; housesPrep.ts FRESH_COLOURS maps old builds)
        soil_t = lin("#6E5843")
        cid = "garden"
        beds = [(gx0 + 0.12, (gx0 + gx1) / 2 - 0.2), ((gx0 + gx1) / 2 + 0.2, gx1 - 0.12)]
        za, zb = gz0 + 0.12, gz1 - 0.32
        for bi, (xa, xb) in enumerate(beds):
            grp = "garden_%d" % bi
            t = 0.04
            hh = 0.30
            # the boards (two courses, a seam between) on four sides
            for (x0, x1, z0, z1, al, sk) in ((xa, xb, zb - t, zb, "x", ("bot",)), (xa, xb, za, za + t, "x", ("bot",)),
                                              (xa, xa + t, za + t, zb - t, "z", ("bot", "front", "back")),
                                              (xb - t, xb, za + t, zb - t, "z", ("bot", "front", "back"))):
                self.sbox(de, "board", grp, "col", x0, x1, -0.01, hh, z0, z1, "timber_cladding", mul(timber, self.rng.uniform(0.9, 1.05)),
                          skip=sk, along=al, col=cid)
            # seam between the two board courses
            for (zf, hint) in ((zb + 0.0008, (0, 0, 1)), (za - 0.0008, (0, 0, -1))):
                face(de, [(xa, 0.148, zf), (xb, 0.148, zf), (xb, 0.152, zf), (xa, 0.152, zf)], "timber_cladding", mul(timber, 0.4), hint,
                     uax=(1, 0, 0))
            # corner posts
            for (px, pz) in ((xa + 0.02, za + 0.02), (xb - 0.02, za + 0.02), (xa + 0.02, zb - 0.02), (xb - 0.02, zb - 0.02)):
                self.sbox(de, "cpost", grp, "col", px - 0.045, px + 0.045, -0.01, hh + 0.05, pz - 0.045, pz + 0.045, "timber_cladding",
                          mul(timber, 0.85), skip=("bot",), along="y", col=cid)
            # soil
            face(de, [(xa + t, hh - 0.05, za + t), (xb - t, hh - 0.05, za + t), (xb - t, hh - 0.05, zb - t), (xa + t, hh - 0.05, zb - t)],
                 "granite", soil_t, UP, scale=0.6)
            self.reg("soil", grp, "col", xa + t, xb - t, -0.01, hh - 0.05, za + t, zb - t, col=cid)
            # rows along x: green onions and garlic (대파 / 마늘: upright tufts) in one bed; climbing beans on green-coated
            # steel stakes with twine (덩굴콩 지지대) in the other, their young plants as tufts at the stakes' feet
            nrow = 4 if bi == 0 else 3
            margin = 0.24
            for r in range(nrow):
                rz = za + t + margin + r * (zb - za - 2 * t - 2 * margin) / (nrow - 1)
                if bi == 0:
                    h = 0.32
                    rr = 0.26 * h / 0.4 * 1.1
                    n = int((xb - xa - 2 * t - 2 * rr) / 0.26)
                    for c in range(n + 1):
                        x = xa + t + rr + c * (xb - xa - 2 * t - 2 * rr) / n
                        self.plant(x, rz, hh - 0.055, 0.3, h * self.rng.uniform(0.92, 1.08), 3,
                                   mul((0.85, 1.0, 0.8, 1.0), self.rng.uniform(0.9, 1.0)), col=cid, reach=rr)
                else:
                    h = 0.30
                    rr = 0.26 * h / 0.4 * 1.1
                    n = int((xb - xa - 2 * t - 2 * rr) / 0.45)
                    for c in range(n + 1):
                        x = xa + t + rr + c * (xb - xa - 2 * t - 2 * rr) / n
                        self.plant(x, rz, hh - 0.055, 0.3, h, 3, mul((0.8, 1.0, 0.75, 1.0), self.rng.uniform(0.85, 1.0)), col=cid,
                                   reach=rr)
                        sa = x + 0.02
                        self.sbox(de, "stake", grp, "col", sa - 0.006, sa + 0.006, hh - 0.06, 1.25, rz - 0.006, rz + 0.006,
                                  "metal_painted", lin("#3F6B3A"), skip=("bot",), along="y", col=cid)
                    # twine along the row at three heights, tied to the stakes
                    for ty in (0.62, 0.88, 1.14):
                        for (dz, hint) in ((0.0065, (0, 0, 1)), (-0.0065, (0, 0, -1))):
                            face(de, [(xa + t + rr, ty, rz + dz), (xb - t - rr + 0.04, ty, rz + dz), (xb - t - rr + 0.04, ty + 0.004, rz + dz),
                                      (xa + t + rr, ty + 0.004, rz + dz)], "timber_cladding", lin("#D8CBB0"), hint, uax=(1, 0, 0))

    # ---------------------------------------------------------------------------------------------- flush decks --
    def flush_deck(self, r):
        """Lawn-level timber decks (contract HOUSE_FLUSH_DECKS: 4.5 cm, lift 0): house 3's side deck, house 9's back deck.
        Boards parallel to the wall, 6 mm gaps, staggered butt joints, two screws per board per joist (~0.6 m), fascia
        boards on the open edges, a dark under-plane in the shell."""
        sh, de = self.sh, self.de
        x0, x1, z0, z1 = r
        side = self.id == "house_3"
        # keep off the plinth (the rect runs to the body / plinth face)
        if side:
            x0 = K.HB + K.PLINTH_OUT + 0.005
        else:
            z1 = K.ZB - K.PLINTH_OUT - 0.005
        top = 0.045
        tint = lin("#A07A5C") if side else lin("#A98C76")
        face(sh, [(x0, 0.02, z0), (x1, 0.02, z0), (x1, 0.02, z1), (x0, 0.02, z1)], "oak", mul(tint, 0.3), UP)
        self.reg("flushdeck", "flush", "walk", x0, x1, 0.0, top, z0, z1)
        gap = 0.006
        # boards run along the wall: along z for the side deck, along x for the back deck
        along_z = side
        span = (x1 - x0) if along_z else (z1 - z0)
        n = max(2, int(round((span + gap) / 0.146)))
        bw = (span - (n - 1) * gap) / n
        length = (z1 - z0) if along_z else (x1 - x0)
        lo = z0 if along_z else x0
        nj = max(3, int(round(length / 0.85)) + 1)
        joists = [lo + 0.08 + i * (length - 0.16) / (nj - 1) for i in range(nj)]
        for i in range(n):
            a = (x0 if along_z else z0) + i * (bw + gap)
            b = a + bw
            t = mul(tint, self.rng.uniform(0.86, 1.08))
            j = joists[1 + (i * 3) % max(1, nj - 2)]
            for (pa, pb) in ((lo, j - 0.002), (j + 0.002, lo + length)):
                if along_z:
                    pts = [(a, top, pa), (b, top, pa), (b, top, pb), (a, top, pb)]
                    face(de, pts, "oak", t, UP, uax=(0, 0, 1))
                else:
                    pts = [(pa, top, a), (pb, top, a), (pb, top, b), (pa, top, b)]
                    face(de, pts, "oak", t, UP, uax=(1, 0, 0))
            for jv in joists:
                for s in (a + 0.026, b - 0.026):
                    for dj in ((-0.03, 0.03) if abs(jv - j) < 0.01 else (0.0,)):
                        if along_z:
                            self.screw(s, top, jv + dj)
                        else:
                            self.screw(jv + dj, top, s)
        # fascia boards on the open edges (2 cm proud of nothing: they are the deck's edge, full height)
        fz = lambda: None
        edges = []
        if side:
            edges = [((x1, z0), (x1, z1), (1, 0, 0)), ((x0, z0), (x1, z0), (0, 0, -1)), ((x0, z1), (x1, z1), (0, 0, 1))]
        else:
            edges = [((x0, z0), (x1, z0), (0, 0, -1)), ((x0, z0), (x0, z1), (-1, 0, 0)), ((x1, z0), (x1, z1), (1, 0, 0))]
        for (a, b, n_) in edges:
            face(de, [(a[0], -0.01, a[1]), (b[0], -0.01, b[1]), (b[0], top, b[1]), (a[0], top, a[1])], "oak", mul(tint, 0.78), n_,
                 uax=norm((b[0] - a[0], 0, b[1] - a[1])))


def build_porch(H):
    """Add house H's porch and fittings (X2) to its shell and detail; returns the Porch run (solids for check_porch)."""
    return Porch(H).build()
