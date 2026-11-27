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

# owner 2026-11-20 ("집안에 이게 뭐냐": a round mirror hung over a window beside its curtain): a hand-placed wall piece must not cover an
# opening (window, door), a curtain beside it, another picture or a tall piece standing at the wall; it slides along its wall to the
# nearest free spot (or is left out when the wall has none).
DECOR_FNS = {"mirror_round": "r2", "mirror_framed": "wh", "frame_art": "wh", "frame_family": "wh", "art_print": "wh", "gallery_wall": "gal",
             "wall_clock": "r2", "calendar_wall": "wh"}
CURTAIN_SIDE = 0.45      # the tied-back panel and the casing beside a window (m beyond its opening)

PULL_OUT = ("chair_dining_wood", "chair_dining_upholstered", "chair_farm", "chair_rattan_dining", "chair_desk")   # owner 2026-11-17

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
        import palettes
        self.pal = palettes.palette(n)          # layered pass: the house's colour scheme (walls, wainscot, trim, textiles)
        self.dress_on = True                    # layered pass: finish() dresses the walls and adds a focal point per floor
        self.focal = {}                         # floor -> "fireplace" | "bookcase" | "dresser" | None (a house script may choose)

    # -- frames ------------------------------------------------------------------------------------------------------
    def frame(self, floor, lx=0.0, lz=0.0, y=0.0, yaw=0.0):
        return K.Frame(lx, lz, y, yaw, ref=HCT.origin(self.n, floor))

    def hole(self):
        f = self.plan["footprint"]
        return (f["minX"], f["maxX"], f["minZ"], f["maxZ"])

    # -- pieces ------------------------------------------------------------------------------------------------------
    def piece(self, floor, name, fn, lx=0.0, lz=0.0, y=0.0, yaw=0.0, cols=True, seats=True, **kw):
        """draw fn(F, **kw) at the room-local (lx, lz, y) turned by the local yaw; registers its colliders / seats with the contract"""
        pb = kw.pop("pull_body", None)
        if getattr(fn, "__name__", "") in DECOR_FNS and not getattr(self, "in_dress", False):
            res = self.keep_decor_clear(floor, name, fn, lx, lz, y, yaw, kw)
            if res is None:
                return None
            lx, lz = res
        if getattr(fn, "__name__", "") in PULL_OUT:
            lx, lz = self.pull_out(floor, name, lx, lz, yaw) if pb is None else self.pull_out(floor, name, lx, lz, yaw, body=pb, force_body=True)
        if not hasattr(self, "placed"):
            self.placed = []
        self.placed.append(dict(floor=floor, name=name, fn=getattr(fn, "__name__", ""), lx=lx, lz=lz, y=y, yaw=yaw, kw=dict(kw)))
        self.count[(floor, name)] = self.count.get((floor, name), 0) + 1
        k = self.count[(floor, name)]
        nm = name if k == 1 else f"{name}{k}"
        K.begin(f"h{self.n}_{floor}_{nm}")
        K.S.furn = K.FURN.get(getattr(fn, "__name__", ""))
        kw = self.textiles(fn, kw, floor)
        try:
            fn(self.frame(floor, lx, lz, y, yaw), **kw)
        finally:
            K.S.remap, K.S.pillow_m, K.S.pillow_tns = {}, None, None
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
        if any(k in getattr(fn, "__name__", "") for k in ("plant", "monstera", "olive", "rubber", "fern", "palm")):
            self.fit_in_room(ob, floor, lx, lz)
        self.lm[floor].append(ob)
        return ob

    def keep_decor_clear(self, floor, name, fn, lx, lz, y, yaw, kw):
        """the (lx, lz) a wall piece may hang at: along its wall, nearest to where it was asked, clear of openings (+ curtains), of other
        wall pieces and of anything standing at the wall that reaches its height. None: no such spot on this wall."""
        W, D = 10.6, 7.8
        kind = DECOR_FNS[fn.__name__]
        if kind == "r2":
            r = kw.get("r", 0.4 if fn.__name__ == "mirror_round" else 0.17)
            half, hgt = r, 2 * r
        elif kind == "gal":
            half, hgt = kw.get("w", 2.0) / 2, 0.9
        else:
            half, hgt = kw.get("w", 0.5) / 2, kw.get("h", 0.65)
        if lz < 0.2 and abs(yaw) < 0.2:
            wall, s0v, L = "front", lx, W
        elif lz > D - 0.2:
            wall, s0v, L = "back", W - lx, W
        elif lx < 0.2:
            wall, s0v, L = "left", D - lz, D
        elif lx > W - 0.2:
            wall, s0v, L = "right", lz, D
        else:
            return lx, lz
        ops = getattr(self, "openings", {}).get(floor, {}).get(wall, [])
        taken = getattr(self, "decor_spans", {}).setdefault((floor, wall), [])
        hole = self.hole() if floor == 1 else None

        def free(s):
            a, b = s - half - 0.06, s + half + 0.06
            if a < 0.3 or b > L - 0.3:
                return False
            for (o0, o1, oy0, oy1) in ops:
                if b > o0 - CURTAIN_SIDE and a < o1 + CURTAIN_SIDE and y + hgt > oy0 - 0.1 and y < oy1 + 0.25:
                    return False
            for (t0, t1, ty0, ty1) in taken:
                if b > t0 and a < t1 and y + hgt > ty0 and y < ty1:
                    return False
            if name.startswith("stair"):        # the stair's own wall pictures hang along the flight: only openings and each other matter
                return True
            for c in self.hb.cols:
                if c[0] != floor or c[6] < y - 0.02 or c[1].startswith("wall"):
                    continue
                pts = [self._to_sd(wall, px, pz) for px in (c[2], c[3]) for pz in (c[4], c[5])]
                if b > min(q[0] for q in pts) - 0.02 and a < max(q[0] for q in pts) + 0.02 and min(q[1] for q in pts) < 0.3:
                    return False
            if hole:
                pts = [self._to_sd(wall, px, pz) for px in (hole[0], hole[1]) for pz in (hole[2], hole[3])]
                if b > min(q[0] for q in pts) and a < max(q[0] for q in pts) and min(q[1] for q in pts) < 0.3 and y < 4.0:
                    return False
            return True

        half0 = half
        # first stay near where it was asked (<= 1 m along the wall, a gallery narrowing to fit), only then slide further
        for (scale, kmax) in (([(1.0, 20), (0.8, 20), (0.62, 20), (0.48, 20)] if kind == "gal" else [(1.0, 20)]) + [(1.0, 200)]):
            half = half0 * scale
            for k in range(0, kmax):
                for sg in ((1,) if k == 0 else (1, -1)):
                    s = s0v + sg * 0.05 * k
                    if free(s):
                        taken.append((s - half - 0.03, s + half + 0.03, y, y + hgt))
                        ds = s - s0v
                        if scale < 1.0:
                            kw["w"] = 2 * half
                            print(f"DECOR {name} floor {floor} ({wall} wall): gallery narrowed to {2 * half:.2f} m to fit between openings")
                        if abs(ds) > 1e-6:
                            print(f"DECOR {name} floor {floor} ({wall} wall): slid {ds:+.2f} m along the wall to clear an opening / piece")
                            rx, rz = {"front": (1, 0), "back": (-1, 0), "left": (0, -1), "right": (0, 1)}[wall]
                            return lx + rx * ds, lz + rz * ds
                        return lx, lz
        print(f"DECOR {name} floor {floor} ({wall} wall): no free spot, left out")
        return None

    @staticmethod
    def _to_sd(wall, x, z):
        """room-local (x, z) -> (s along the wall, distance from it)"""
        W, D = 10.6, 7.8
        return {"front": (x, z), "back": (W - x, D - z), "left": (D - z, x), "right": (z, W - x)}[wall]

    def fit_in_room(self, ob, floor, lx, lz, margin=0.03):
        """a plant's leaves must not pass through a wall (or hang over the stairwell on floor 2): squeeze the foliage toward the pot
        (x / z about the pot centre) just enough. The pot and the collider stay."""
        ox, oz = HCT.origin(self.n, floor)
        cx, cz = ox + lx, oz - lz                       # world (game) centre
        lim = [(0.0, 10.6), (0.0, 7.8)]
        k = 1.0
        leaves = [v for v in ob.data.vertices if v.co.z > 0.42]     # above the pot
        for v in leaves:
            gx, gz = v.co.x, -v.co.y
            vx, vz = gx - ox, oz - gz                   # room-local
            for (val, c, (lo, hi)) in ((vx, lx, lim[0]), (vz, lz, lim[1])):
                if val < lo + margin and c - val > 1e-6:
                    k = min(k, (c - lo - margin) / (c - val))
                if val > hi - margin and val - c > 1e-6:
                    k = min(k, (hi - margin - c) / (val - c))
        if k < 1.0:
            k = max(k, 0.3)
            for v in leaves:
                v.co.x = cx + (v.co.x - cx) * k
                v.co.y = -cz + (v.co.y + cz) * k
            print(f"FIT {ob.name}: foliage squeezed to {k:.2f} to stay inside the walls")

    def textiles(self, fn, kw, floor=1):
        """layered pass: the house palette dresses the soft furnishings — sofas in the sofa colour with patterned cushions in the two
        accents, armchairs in a check, beds with a padded headboard, a quilt and accent cushions, rugs in the rug colours."""
        import inspect
        P = self.pal
        name = getattr(fn, "__name__", "")
        try:
            sig = inspect.signature(fn).parameters
            anykw = any(p.kind == p.VAR_KEYWORD for p in sig.values())
        except (TypeError, ValueError):
            sig, anykw = {}, False

        def put(k, v):
            if k in sig or anykw:
                kw[k] = v
        if name.startswith("sofa") and name not in ("sofa_leather", "sofa_rattan"):
            put("tn", P["sofa"])
            K.S.pillow_m = ["H_floral", "H_check", "H_fabric"]
            K.S.pillow_tns = [P["acc1"], P["acc2"], P["curtain"]]
        elif name.startswith("armchair") and name != "armchair_rattan":
            put("tn", P["chair"])
            K.S.remap = {"H_fabric": "H_check"}
        elif name in ("bed", "bed_queen"):
            put("tn", P["quilt"])
            put("headboard", "padded")
            put("head_tn", P["head"])
            K.S.pillow_m = ["H_floral", "H_check"]
            K.S.pillow_tns = [P["acc1"], P["acc2"]]
        elif name in ("bed_single", "bunk_bed"):
            put("tn", P["quilt"])
            K.S.pillow_tns = [P["acc1"], P["acc2"]]
        elif name == "rug_rect":
            put("tn", P["rug"])
            put("border_tn", P["rug_b"])
        elif name == "rug_round":
            put("tn", P["rug"])
            put("border_tn", P["rug_b"])
        elif name == "part_wall":
            put("tn", P["wall"] if floor == 1 else P["wall2"])
            put("low_tn", P["low"])
            put("trim_tn", P["trim"])
            put("frieze_tn", P["ceil"])
        return kw

    def shell(self, floor, ops=None, floor_kind="oak", wall_tn=None, lights=((2.6, 3.9), (7.9, 3.9)), windows=None, curtains=None, fixtures=(), floor_tn=None):
        """the whole room of a floor (floor, ceiling, walls with openings, baseboards, crown); the stairwell hole is cut as the plan says.
        windows: [(wall, s0, s1, y0, y1, dict(style=...))] drawn into the openings by the kit's window()."""
        SH = self.SH
        hole = self.hole()
        P = self.pal
        if not hasattr(self, "openings"):
            self.openings = {}
        self.openings[floor] = {w: [(o["s0"], o["s1"], o["y0"], o["y1"]) for o in lst] for w, lst in (ops or {}).items()}
        wall_tn = P["wall"] if floor == 1 else P["wall2"]      # layered pass: the palette's walls / wainscot / trim / ceiling / floor
        floor_tn = P["floor"] if floor_kind in ("oak", "oakL") else floor_tn

        def fn(F):
            SH.SILL["left"] = getattr(self, "sill_n", 2)     # layered pass 2: a jug of flowers on a couple of window sills
            fr = SH.room_shell(F, 10.6, 7.8, ops=ops, hole=hole if floor == 1 else None, floor_hole=hole if floor == 2 else None,
                               floor_kind=floor_kind, wall_tn=wall_tn, floor_tn=floor_tn, lights=lights, low_tn=P["low"], trim_tn=P["trim"],
                               ceil_tn=P["ceil"])
            for (w, s0, s1, y0, y1, kw) in (windows or []):
                kw = dict(kw)
                kw.setdefault("tn", P["trim"])
                SH.window(fr[w][0], s0, s1, y0, y1, **kw)
            for (w, s0, s1, y_top, y_bot, kw) in (curtains or []):
                kw = dict(kw)
                kw["tn"], kw["m"] = P["curtain"], P["curtain_m"]
                kw["gap"] = max(0.0, (s1 - s0) / 2 - 0.42)       # open, tied-back panels
                kw["folds"] = 6
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
                   wall_side=kit["wall_side"], i_from=1, top_open=kit["landing"], lite=True)      # owner 2026-11-20: the WHOLE flight in the well (it was steps 10-17 only: a handrail rose out of nothing)
        self.piece(2, "stairwell_guard", SH.stair_guard_2f, foot["x"], foot["z"], 0.0, kit["yaw"], cols=False,
                   wall_side=kit["wall_side"], landing=kit["landing"])

    def well_shaft(self, wall_tn=None):
        """the stairwell seen from floor 2 (HA houses 1-5; HB's own is hb_common.stairs): the hole's four walls plastered down to the
        shaft floor at -4.0 and an oak floor there, a fascia and nosing board round the opening. Without it the floor-1 stair seen through
        the hole hung over the village's grass (owner 2026-11-20: '난간이 왜 이래 이상하잖아')."""
        x0, x1, z0, z1 = self.hole()
        t = self.pal["wall2"]

        def fn(F):
            e = 0.015
            for (a, b, c, d, hint) in ((x0 + e, z0 + e, x0 + e, z1 - e, (1, 0, 0)), (x1 - e, z0 + e, x1 - e, z1 - e, (-1, 0, 0)),
                                       (x0 + e, z0 + e, x1 - e, z0 + e, (0, 1, 0)), (x0 + e, z1 - e, x1 - e, z1 - e, (0, -1, 0))):
                K.gface(F, [(a, b, -0.3), (c, d, -0.3), (c, d, -4.0), (a, b, -4.0)], "H_plaster", (1, 0, 0), 2.5, hint, tn=t)
            K.gface(F, [(x0 + e, z0 + e, -4.0), (x1 - e, z0 + e, -4.0), (x1 - e, z1 - e, -4.0), (x0 + e, z1 - e, -4.0)], "H_floor_oak", (0, 1, 0), 2.4, (0, 0, 1),
                    tn=self.pal["floor"])
        return self.piece(2, "well_shaft", fn, 0, 0, cols=False)

    def finish(self):
        """walls + stair colliders, the contract check, then every contract node (col__, seat__, pads, spawns, ceilings)"""
        self.hb.walls()
        self.hb.stair_colliders()
        if self.dress_on:          # after the walls / stair colliders: the dressing's reach checks see the real obstacles
            import house_dress
            self.in_dress = True          # the dressing finds its own free walls from the meshes
            for f in (1, 2):
                house_dress.dress(self, f)
            self.in_dress = False
        problems = self.hb.check()
        for p in problems:
            print("CONTRACT CHECK:", p)
        problems += self.aisles()
        problems += self.clip_audit()
        problems += self.front_audit()
        self.nodes = self.hb.emit(self.coll)
        return problems

    def pull_out(self, floor, name, lx, lz, yaw, front=0.24, body=0.44, gap=0.0, half=0.24, force_body=False):
        """owner 2026-11-17: a chair at a table or desk is pulled out until a body has room to stand in front of it (front_audit's
        rule): moved straight back from its facing, the least that clears, never into a wall or another piece. Returns (lx, lz)."""
        fx, fz = math.sin(yaw), math.cos(yaw)
        if not force_body:
            body = getattr(self, "pull_body", body)    # a house may ask for more room (the game's get-up spot needs ~0.92 m clear)
        cols = [c for c in self.hb.cols if c[0] == floor and c[6] >= 0.15]
        if floor == 2:
            hx0, hx1, hz0, hz1 = self.hole()
            cols = cols + [(2, "stairwell_hole", hx0, hx1, hz0, hz1, 1.0)]

        def hit(px, pz, r):
            for c in cols:
                dx = max(c[2] - px, 0, px - c[3])
                dz = max(c[4] - pz, 0, pz - c[5])
                if dx * dx + dz * dz < r * r:
                    return True
            return False
        for k in range(0, 76):
            d = 0.02 * k
            cx, cz = lx - fx * d, lz - fz * d
            if cx < half + 0.02 or cx > 10.6 - half - 0.02 or cz < half + 0.02 or cz > 7.8 - half - 0.02:
                break
            if hit(cx, cz, half - 0.02):
                break
            ok = True
            for j in range(0, 6):
                t = front + (gap + body) * j / 5
                px, pz = cx + fx * t, cz + fz * t
                r = body if j == 5 else 0.2
                if (j == 5 and (px < r or px > 10.6 - r or pz < r or pz > 7.8 - r)) or hit(px, pz, r):
                    ok = False
                    break
            if ok:
                if d > 0:
                    print(f"PULL {name} floor {floor}: {d:.2f} m back from its table/desk")
                return cx, cz
        print(f"PULL {name} floor {floor}: no room to pull it out")
        return lx, lz

    def front_audit(self, body=0.42, gap=0.0):
        """owner 2026-11-17 ("실제처럼 의자 앞에 가서 앉고 일어서면 의자 앞에 서고"): every BACKED seat has a clear spot in front of it —
        a body (radius `body`) standing `gap` m past the seat's front edge touches no collider (its own piece aside) and is inside the room,
        and the strip between the front edge and that spot is clear too. Prints FRONT lines; returns them."""
        out = []
        W, D = 10.6, 7.8
        for st in self.hb.seats:
            if st["kind"] != "backed":
                continue
            f = st["floor"]
            a = st["local_yaw"]
            fx, fz = math.sin(a), math.cos(a)
            sx, sz = st["lx"], st["lz"]
            own = [c for c in self.hb.cols if c[0] == f and c[2] - 0.01 <= sx <= c[3] + 0.01 and c[4] - 0.01 <= sz <= c[5] + 0.01]
            stems = {c[1].rsplit("_", 1)[0] for c in own}
            own += [c for c in self.hb.cols if c[0] == f and c not in own and c[1].rsplit("_", 1)[0] in stems and c[1][-1:].isdigit()]
            others = [c for c in self.hb.cols if c[0] == f and c not in own and c[6] >= 0.15]
            if f == 2:
                hx0, hx1, hz0, hz1 = self.hole()
                others.append((2, "stairwell_hole", hx0, hx1, hz0, hz1, 1.0))
            bad = None
            for k in range(0, 6):
                t = st["edge"] + (gap + body) * k / 5
                px, pz = sx + fx * t, sz + fz * t
                r = body if k == 5 else 0.2
                if k == 5 and (px < r or px > W - r or pz < r or pz > D - r):
                    bad = "the wall"
                    break
                for c in others:
                    dx = max(c[2] - px, 0, px - c[3])
                    dz = max(c[4] - pz, 0, pz - c[5])
                    if dx * dx + dz * dz < r * r:
                        bad = c[1]
                        break
                if bad:
                    break
            if bad:
                out.append(f"FRONT floor {f}: {st['id']} ({st['furn']}) at ({sx:.2f},{sz:.2f}): no clear stand spot in front — {bad}")
        for o in out:
            print("CONTRACT CHECK:", o)
        print("FRONT AUDIT", len(out), "issues")
        return out

    def clip_audit(self, tol=0.012):
        """realism pass 2026-11-17 ("자동문이 주위의 물체와 겹치잖아 ... 꼼꼼하게 확인해"): every placed piece's MESH must stay inside its room
        (walls, ceiling) and out of the stair / stairwell, and no two furniture colliders may overlap. Prints CLIP lines; returns them."""
        import itertools
        out = []
        W, D, CEIL = 10.6, 7.8, 3.7
        skip = ("shell", "view", "stairs", "stairwell", "shaft", "entry", "part_", "fill", "pendant", "pend", "lantern", "strings", "hang",
                "kidpend", "parpend", "bedpend", "livepend", "tpend", "fireplace", "well_shaft", "stairart", "stairgal")
        hx0, hx1, hz0, hz1 = self.hole()
        for f in (1, 2):
            ox, oz = HCT.origin(self.n, f)
            for ob in self.lm[f]:
                nm = ob.name.split("_", 2)[2]
                if nm.startswith(skip):
                    continue
                me = ob.data
                if not len(me.vertices):
                    continue
                xs = [v.co.x for v in me.vertices]
                zs = [-v.co.y for v in me.vertices]         # Blender y = -game z (kit_core.V)
                ys = [v.co.z for v in me.vertices]
                lx0, lx1 = min(xs) - ox, max(xs) - ox
                lz0, lz1 = oz - max(zs), oz - min(zs)
                y0, y1 = min(ys), max(ys)
                if lx0 < -tol or lx1 > W + tol or lz0 < -tol or lz1 > D + tol:
                    out.append(f"CLIP floor {f}: {nm} pokes through a wall (x {lx0:.2f}..{lx1:.2f}, z {lz0:.2f}..{lz1:.2f})")
                if y1 > CEIL + tol:
                    out.append(f"CLIP floor {f}: {nm} pokes through the ceiling (top {y1:.2f})")
                # the stair: on floor 2 its hole takes nothing; on floor 1 a piece may stand under the flight only below its soffit
                # (rise 4.0 m over the 5.44 m run, ~0.3 m of stair under the treads' line)
                if lx1 > hx0 + tol and lx0 < hx1 - tol and lz1 > hz0 + tol and lz0 < hz1 - tol:
                    if f == 2:
                        out.append(f"CLIP floor 2: {nm} stands over the stairwell")
                    else:
                        t = self.plan["type"]
                        # the overlap's end nearest the stair foot is where the flight is lowest
                        near = {"A": hx1 - min(lx1, hx1), "B": max(lx0, hx0) - hx0, "C": max(lz0, hz0) - hz0, "D": max(lz0, hz0) - hz0}[t]
                        soffit = 4.0 * near / 5.44 - 0.3
                        if y1 > soffit - tol:
                            out.append(f"CLIP floor 1: {nm} runs into the stair (top {y1:.2f} m, the flight's underside {soffit:.2f} m there)")
            cs = [c for c in self.hb.cols if c[0] == f and not c[1].startswith(("wall", "stair", "part", "middoor"))]
            for a, b in itertools.combinations(cs, 2):
                dx = min(a[3], b[3]) - max(a[2], b[2])
                dz = min(a[5], b[5]) - max(a[4], b[4])
                pair = (a[1] + " " + b[1])
                tucked = ("chair" in pair or "stool" in pair or "bench" in pair) and ("table" in pair or "desk" in pair or "island" in pair)
                hung = any(k in pair for k in ("upper", "hood"))      # wall cabinets / hoods hang over the counters (1.5 m up)
                if dx > 0.03 and dz > 0.03 and not tucked and not hung:
                    out.append(f"CLIP floor {f}: colliders {a[1]} x {b[1]} overlap ({dx:.2f} x {dz:.2f} m)")
            parts = [c for c in self.hb.cols if c[0] == f and c[1].startswith(("part", "middoor"))]
            for a in cs:
                for b in parts:
                    dx = min(a[3], b[3]) - max(a[2], b[2])
                    dz = min(a[5], b[5]) - max(a[4], b[4])
                    if dx > 0.01 and dz > 0.01:
                        out.append(f"CLIP floor {f}: {a[1]} runs into the partition {b[1]}")
        for o in out:
            print("CONTRACT CHECK:", o)
        print("CLIP AUDIT", len(out), "issues")
        return out

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

            def free(x, z, R=R):
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
                    elif s["kind"] == "backed":        # owner 2026-11-17: a backed chair is walked to from the FRONT (front_audit's spot)
                        d = s["edge"] + 0.42
                        targets.append((s["id"] + "/" + s["furn"] + "/front", (s["lx"] + math.sin(a) * d, s["lz"] + math.cos(a) * d), 0.42 + 0.62))
                    else:                              # stools, cushions, bed edges: reachable from any side
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
            # a chair's front spot sits in the 0.84 m it keeps from its table (owner 2026-11-17): the player's own 0.4 m body walks in there
            # (clickPlan grows the colliders by the body); flood that finer reach too, from the same start
            cell_b = [[free(i * step, j * step, 0.40) for j in range(gz)] for i in range(gx)]
            seen_b = set()
            qb = collections.deque([p for p in seen if cell_b[p[0]][p[1]]])
            seen_b.update(qb)
            while qb:
                i, j = qb.popleft()
                for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    a_, b_ = i + di, j + dj
                    if 0 <= a_ < gx and 0 <= b_ < gz and (a_, b_) not in seen_b and cell_b[a_][b_]:
                        seen_b.add((a_, b_))
                        qb.append((a_, b_))
            for (name, (tx, tz), tol) in targets:
                if name.endswith("/front"):
                    k = 3
                    if any((int(round(tx / step)) + di, int(round(tz / step)) + dj) in seen_b for di in range(-k, k + 1) for dj in range(-k, k + 1)):
                        continue
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
