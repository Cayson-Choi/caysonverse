"""Helpers for the per-house placement scripts (h01.py ... h10.py): they call kit pieces at ROOM-LOCAL positions (the contract's
coordinates: x 0..10.6 left -> right as seen coming in, z 0..7.8 entry wall -> back wall, local yaw 0 = into the room) and this
module feeds the colliders and seats the pieces register to houses_contract.HouseBuild, the contract's only way to register them,
and parents the visible meshes under floor__h<N>_<F>.

    import house_common as HC
    H = HC.House(1)
    H.piece(1, "sofa", SE.sofa_fabric, 5.2, 2.7, 0, 0.0, w=2.4)        # floor, name, kit function, local x, z, y, local yaw, kit args
    H.stairs()                       # the contract's stair plan for this house (both floors, rails, colliders, well steps)
    H.finish()                       # walls, stair colliders, check(), emit() -> col__ / seat__ / stair__ / door__ / spawn__ / ceil__
    H.save("art/village/work/house_1_authoring.blend")

Frames: K.Frame(x, z, y, yaw, ref=(originX, originZ)) is room-local; its points are world (game) points via the contract's
mirror (world x = originX + lx, z = originZ - lz, world yaw = pi - local yaw). Meshes are never mirrored.
"""
import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(HERE))))
for _d in (os.environ.get("CV_HOUSE_CONTRACT_DIR"), os.path.join(REPO, "docs", "designs", "houses-interior"), os.path.dirname(HERE)):
    if _d and os.path.exists(os.path.join(_d, "houses_contract.py")):
        sys.path.insert(0, _d)
        break
import houses_contract as HCT  # noqa: E402
import kit_core as K  # noqa: E402

STAIR_KIT = {"A": dict(yaw=-math.pi / 2, wall_side="right", open_low=4, landing=0.0),
             "B": dict(yaw=math.pi / 2, wall_side="left", open_low=4, landing=0.0),
             "C": dict(yaw=0.0, wall_side="right", open_low=0, landing=1.3),
             "D": dict(yaw=0.0, wall_side="left", open_low=0, landing=1.3)}


class House:
    def __init__(self, n):
        import kit_shell as SH
        self.SH = SH
        self.n = n
        self.hb = HCT.HouseBuild(n)
        self.plan = self.hb.stair_plan()
        for o in list(bpy.data.objects):
            bpy.data.objects.remove(o)
        self.coll = bpy.data.collections.new(f"house_{n}")
        bpy.context.scene.collection.children.link(self.coll)
        self.count = {}
        self.lm = {1: [], 2: []}

    # -- frames ------------------------------------------------------------------------------------------------------
    def frame(self, floor, lx=0.0, lz=0.0, y=0.0, yaw=0.0):
        return K.Frame(lx, lz, y, yaw, ref=HCT.origin(self.n, floor))

    def hole(self):
        f = self.plan["footprint"]
        return (f["minX"], f["maxX"], f["minZ"], f["maxZ"])

    # -- pieces ------------------------------------------------------------------------------------------------------
    def piece(self, floor, name, fn, lx=0.0, lz=0.0, y=0.0, yaw=0.0, cols=True, seats=True, **kw):
        """draw fn(F, **kw) at the room-local (lx, lz, y) turned by the local yaw; registers its colliders / seats with the contract"""
        self.count[(floor, name)] = self.count.get((floor, name), 0) + 1
        k = self.count[(floor, name)]
        nm = name if k == 1 else f"{name}{k}"
        K.begin(f"h{self.n}_{floor}_{nm}")
        K.S.furn = K.FURN.get(getattr(fn, "__name__", ""))
        fn(self.frame(floor, lx, lz, y, yaw), **kw)
        K.S.furn = None
        ob = K.end(None, link=False)
        ob.name = f"h{self.n}_{floor}_{nm}"
        ob["cat"] = "lm"
        ob["floor"] = floor
        self.coll.objects.link(ob)
        ob.parent = self.hb.floor_root(floor)
        import json
        if cols:
            cs = [c for c in json.loads(ob["cols"]) if not c["name"].startswith(("stair", "wall"))]
            for i, c in enumerate(cs):
                label = (nm if len(cs) == 1 else f"{nm}_{i}").lower().replace("-", "_")
                self.hb.col(floor, label, c["lminX"], c["lmaxX"], c["lminZ"], c["lmaxZ"], c["h"])
        if seats:
            for s in json.loads(ob["seats"]):
                self.hb.seat(floor, s["furn"], s["lx"], s["lz"], s["y"], s["local_yaw"], edge=s["frontEdge"], back=s["back"],
                             width=max(s["width"], 0.38), both=bool(s["both"]), exit_turn=s["exitTurn"], lean=s["lean"])
        for i, l in enumerate(json.loads(ob["lights"])):      # bake lights (not exported)
            e = bpy.data.objects.new(f"{K.LIGHT_PREFIX}{l['kind']}_h{self.n}_{floor}_{nm}_{i}", None)
            e.empty_display_type = "SPHERE"
            e.empty_display_size = 0.1
            e.location = K.V(l["x"], l["z"], l["y"])
            e["watts"], e["color"], e["cat"] = l["watts"], l["color"], "light"
            self.coll.objects.link(e)
        self.lm[floor].append(ob)
        return ob

    def shell(self, floor, ops=None, floor_kind="oak", wall_tn=None, lights=((2.6, 3.9), (7.9, 3.9)), windows=None, curtains=None, fixtures=(), floor_tn=None):
        """the whole room of a floor (floor, ceiling, walls with openings, baseboards, crown); the stairwell hole is cut as the plan says.
        windows: [(wall, s0, s1, y0, y1, dict(style=...))] drawn into the openings by the kit's window()."""
        SH = self.SH
        hole = self.hole()

        def fn(F):
            fr = SH.room_shell(F, 10.6, 7.8, ops=ops, hole=hole if floor == 1 else None, floor_hole=hole if floor == 2 else None,
                               floor_kind=floor_kind, wall_tn=wall_tn, floor_tn=floor_tn, lights=lights)
            for (w, s0, s1, y0, y1, kw) in (windows or []):
                SH.window(fr[w][0], s0, s1, y0, y1, **kw)
            for (w, s0, s1, y_top, y_bot, kw) in (curtains or []):
                SH.curtain(fr[w][0], s0, s1, y_top, y_bot, **kw)
            for fx in fixtures:          # fx(frames): doors, bathroom door, jungmun ... in wall frames
                fx(fr)
        return self.piece(floor, "shell", fn)

    def stairs(self, open_low=None):
        """the contract's stair of this house: floor 1 stair (A/B open low steps toward the room, C/D top rail left free at the landing),
        floor 2 well steps (the upper 8) and the guard round the hole."""
        SH = self.SH
        p = self.plan
        kit = STAIR_KIT[p["type"]]
        foot = p["foot"]
        ol = kit["open_low"] if open_low is None else open_low
        self.piece(1, "stairs", SH.stairs, foot["x"], foot["z"], 0.0, kit["yaw"], cols=False, wall_side=kit["wall_side"], open_low=ol,
                   top_open=kit["landing"])
        self.piece(2, "stairwell_steps", SH.stairs, foot["x"], foot["z"], -K.FLOOR_HEIGHT, kit["yaw"], cols=False,
                   wall_side=kit["wall_side"], i_from=10, top_open=kit["landing"])
        self.piece(2, "stairwell_guard", SH.stair_guard_2f, foot["x"], foot["z"], 0.0, kit["yaw"], cols=False,
                   wall_side=kit["wall_side"], landing=kit["landing"])

    def finish(self):
        """walls + stair colliders, the contract check, then every contract node (col__, seat__, pads, spawns, ceilings)"""
        self.hb.walls()
        self.hb.stair_colliders()
        problems = self.hb.check()
        for p in problems:
            print("CONTRACT CHECK:", p)
        problems += self.aisles()
        self.nodes = self.hb.emit(self.coll)
        return problems

    def aisles(self, R=0.62, step=0.1):
        """G (click-to-walk): every walking aisle and every seat approach must be >= 1.3 m clear (a body of radius R = 0.62 fits). Flood
        fill over the room from the arrival spot with the colliders grown by R; every pad, spawn and seat stand-up point must be reached."""
        import collections
        W, D = 10.6, 7.8
        h = self.hb.h["places"]
        out = []

        def loc(spot, f):
            ox, oz = HCT.origin(self.n, f)
            return (spot["x"] - ox, oz - spot["z"])

        for f in (1, 2):
            boxes = [(c[2], c[3], c[4], c[5]) for c in self.hb.cols if c[0] == f and c[6] >= 0.15 and not c[1].startswith("wall")]
            hx0, hx1, hz0, hz1 = self.hole() if f == 2 else (9, 9, 9, 9)

            def free(x, z):
                if x < R or x > W - R or z < R or z > D - R:
                    return False
                for (x0, x1, z0, z1) in boxes:
                    dx = max(x0 - x, 0, x - x1)
                    dz = max(z0 - z, 0, z - z1)
                    if dx * dx + dz * dz < R * R:
                        return False
                return True
            starts = [loc(h["spawnIn"], 1)] if f == 1 else [loc(h["spawnUp"], 2)]
            targets = ([("exitPad", loc(h["exitPad"], 1)), ("upPad", loc(h["upPad"], 1)), ("spawnDown", loc(h["spawnDown"], 1))] if f == 1
                       else [("downPad", loc(h["downPad"], 2)), ("spawnUp", loc(h["spawnUp"], 2))])
            targets = [(n_, p_, 0.5) for (n_, p_) in targets]
            for s in self.hb.seats:
                if s["floor"] == f:
                    a = s["local_yaw"]
                    if s["approach"] == "front" and s["furn"] in ("sofa", "armchair", "beanbag", "floorsofa", "boryo"):
                        d = s["edge"] + 0.75           # sofas / armchairs are entered from the front: the spot in front must be reached
                        targets.append((s["id"] + "/" + s["furn"], (s["lx"] + math.sin(a) * d, s["lz"] + math.cos(a) * d), 0.62))
                    else:                              # chairs, stools, cushions, bed edges: reachable from any side
                        targets.append((s["id"] + "/" + s["furn"], (s["lx"], s["lz"]), 1.15))
            gx, gz = int(W / step) + 1, int(D / step) + 1
            cell = [[free(i * step, j * step) for j in range(gz)] for i in range(gx)]
            seen = set()
            q = collections.deque()
            for (sx, sz) in starts:
                i, j = int(round(sx / step)), int(round(sz / step))
                best = None
                for di in range(-6, 7):
                    for dj in range(-6, 7):
                        a_, b_ = i + di, j + dj
                        if 0 <= a_ < gx and 0 <= b_ < gz and cell[a_][b_] and (best is None or di * di + dj * dj < best[0]):
                            best = (di * di + dj * dj, a_, b_)
                if best:
                    q.append((best[1], best[2]))
                    seen.add((best[1], best[2]))
            while q:
                i, j = q.popleft()
                for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    a_, b_ = i + di, j + dj
                    if 0 <= a_ < gx and 0 <= b_ < gz and (a_, b_) not in seen and cell[a_][b_]:
                        seen.add((a_, b_))
                        q.append((a_, b_))
            if os.environ.get("CV_AISLE_MAP"):
                tg = {(int(round(t[1][0] / step)), int(round(t[1][1] / step))) for t in targets}
                for j in range(gz):
                    print("MAP%d " % f + "".join("T" if (i, j) in tg else ("o" if (i, j) in seen else ("." if cell[i][j] else "#")) for i in range(0, gx, 1)))
            for (name, (tx, tz), tol) in targets:
                k = int(tol / step) + 1
                ok = any(((int(round(tx / step)) + di) * step - tx) ** 2 + ((int(round(tz / step)) + dj) * step - tz) ** 2 <= tol * tol
                         and (int(round(tx / step)) + di, int(round(tz / step)) + dj) in seen for di in range(-k, k + 1) for dj in range(-k, k + 1))
                if not ok:
                    fr_ = [(((i * step - tx) ** 2 + (j * step - tz) ** 2) ** 0.5, i * step, j * step) for i in range(gx) for j in range(gz) if cell[i][j]]
                    nf = min(fr_) if fr_ else None
                    ns_ = min((((i * step - tx) ** 2 + (j * step - tz) ** 2) ** 0.5, i * step, j * step) for (i, j) in seen) if seen else None
                    out.append(f"AISLE floor {f}: {name} at ({tx:.2f},{tz:.2f}) not reachable with a 1.3 m aisle; nearest free {nf}, nearest reached {ns_}")
        for o in out:
            print("CONTRACT CHECK:", o)
        return out

    def save(self, path):
        bpy.ops.wm.save_as_mainfile(filepath=path)
        print("SAVED", path, len(bpy.data.objects), "objects", len(self.hb.seats), "seats", len(self.hb.cols), "colliders")
