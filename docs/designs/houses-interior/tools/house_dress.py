"""Layered pass (2026-11-17, coordinator review of the cottage sheets: "big empty walls ... no focal point"): dress every floor of a house
after its script has placed the furniture, from what is actually there.

  1. a focal point per floor where the floor has none yet: a painted fireplace with a mirror and mantel things on floor 1 (on the free wall
     nearest the sofa, away from the kitchen), a built-in bookcase wall on floor 2 (the longest free wall). A candidate is kept only when
     the click-to-walk aisles and every backed seat's stand spot stay exactly as reachable as before (House.aisles / front_audit).
  2. art on every free stretch of wall at eye level (1.15 - 2.35 m): gallery walls on long stretches, an arched mirror between two
     sconces on medium ones, a single framed print on short ones.

Free wall = no opening casing, curtain, cabinet, tall piece, partition or stair within reach of the band (from the meshes themselves)."""
import math

import houses_contract as HCT
import kit_core as K
import kit_layer as KL
import kit_real as KR

W_, D_ = 10.6, 7.8
STEP = 0.05
BAND = (1.12, 2.4)
KITCHEN = ("kitchen", "counter", "sink", "fridge", "range", "island", "upper", "hood", "cook", "pantry", "kit_", "bath", "vanity")


def _walls():
    # name: (length, (lx, lz) -> (s, d), s -> (lx, lz, yaw))
    return {
        "front": (W_, lambda x, z: (x, z), lambda s: (s, 0.0, 0.0)),
        "back": (W_, lambda x, z: (W_ - x, D_ - z), lambda s: (W_ - s, D_, math.pi)),
        "left": (D_, lambda x, z: (D_ - z, x), lambda s: (0.0, D_ - s, math.pi / 2)),
        "right": (D_, lambda x, z: (z, W_ - x), lambda s: (W_, s, -math.pi / 2)),
    }


def _verts(H, floor):
    """[(name, is_shell, verts, polys)] room-local verts (x, z, y) and polygon index lists"""
    ox, oz = HCT.origin(H.n, floor)
    out = []
    for ob in H.lm[floor]:
        nm = ob.name.split("_", 2)[2]
        if nm.startswith("view"):
            continue
        shell = nm.startswith("shell")
        vs = [(v.co.x - ox, oz + v.co.y, v.co.z) for v in ob.data.vertices]
        ps = [tuple(p.vertices) for p in ob.data.polygons]
        out.append((nm, shell, vs, ps))
    return out


def _occupancy(H, floor, objs):
    """per wall: a list of bins (STEP m) that are taken in the eye-level band (from the polygons near the wall)"""
    occ = {}
    hx0, hx1, hz0, hz1 = H.hole()
    for wname, (ln, to_sd, _) in _walls().items():
        nb = int(ln / STEP) + 1
        b = [False] * nb
        cover = [False] * nb             # where the wall face itself runs through the band (an opening has none)
        for (nm, shell, vs, ps) in objs:
            sd = [to_sd(x, z) for (x, z, y) in vs]
            if shell:
                for p in ps:
                    ds = [sd[i][1] for i in p]
                    ys = [vs[i][2] for i in p]
                    if max(abs(d) for d in ds) < 0.004 and min(ys) <= BAND[0] + 0.2 and max(ys) >= BAND[1] - 0.2:
                        ss = [sd[i][0] for i in p]
                        for i in range(max(0, int(min(ss) / STEP) + 1), min(nb, int(max(ss) / STEP))):
                            cover[i] = True
            for p in ps:
                ys = [vs[i][2] for i in p]
                if max(ys) < BAND[0] - 0.05 or min(ys) > BAND[1] + 0.05:
                    continue
                ds = [sd[i][1] for i in p]
                if shell:
                    if max(ds) <= 0.004 or min(ds) > 0.4:
                        continue
                elif min(ds) > 0.55:
                    continue
                ss = [sd[i][0] for i in p]
                for i in range(max(0, int(min(ss) / STEP)), min(nb, int(max(ss) / STEP) + 1)):
                    b[i] = True
        for i in range(nb):
            if not cover[i]:
                b[i] = True
        # the stair / stairwell near this wall
        cs = [to_sd(x, z) for x in (hx0, hx1) for z in (hz0, hz1)]
        if min(c[1] for c in cs) < 1.1:
            a0, a1 = min(c[0] for c in cs), max(c[0] for c in cs)
            for i in range(max(0, int(a0 / STEP) - 4), min(nb, int(a1 / STEP) + 5)):
                b[i] = True
        for i in range(nb):
            if i * STEP < 0.3 or i * STEP > ln - 0.3:
                b[i] = True
        g = list(b)
        for i in range(nb):
            if b[i]:
                for j in range(max(0, i - 2), min(nb, i + 3)):
                    g[j] = True
        occ[wname] = g
    return occ


def _spans(bins):
    out, i, n = [], 0, len(bins)
    while i < n:
        if not bins[i]:
            j = i
            while j < n and not bins[j]:
                j += 1
            out.append((i * STEP, (j - 1) * STEP))
            i = j
        else:
            i += 1
    return [(a, b) for (a, b) in out if b - a >= 0.7]


def _strip_free(H, floor, wname, s0, s1, depth):
    """no collider (and not the stair footprint) in the floor strip [s0, s1] x [0, depth] of a wall"""
    ln, to_sd, _ = _walls()[wname]
    boxes = [c for c in H.hb.cols if c[0] == floor and c[6] >= 0.03 and not c[1].startswith("wall")]
    hx0, hx1, hz0, hz1 = H.hole()
    boxes = boxes + [(floor, "stairwell", hx0, hx1, hz0, hz1, 1.0)]
    for c in boxes:
        cs = [to_sd(x, z) for x in (c[2], c[3]) for z in (c[4], c[5])]
        a0, a1 = min(p[0] for p in cs), max(p[0] for p in cs)
        d0 = min(p[1] for p in cs)
        if a1 > s0 - 0.05 and a0 < s1 + 0.05 and d0 < depth + 0.05:
            return False
    return True


def _near_kitchen(objs, to_sd, s0, s1):
    for (nm, shell, vs, ps) in objs:
        if shell or not nm.startswith(KITCHEN) and not any(k in nm for k in ("kitchen", "counter", "sink", "fridge", "range_", "hood")):
            continue
        for (x, z, y) in vs[::7]:
            s, d = to_sd(x, z)
            if d < 1.6 and s0 - 1.2 < s < s1 + 1.2:
                return True
    return False


def _centre(objs, key):
    pts = [(sum(v[0] for v in vs) / len(vs), sum(v[1] for v in vs) / len(vs)) for (nm, shell, vs, ps) in objs if key in nm and vs]
    return pts


def _reach_ok(H, floor, box):
    """the aisles / front stand spots stay as they are with this extra collider"""
    import io
    import contextlib
    with contextlib.redirect_stdout(io.StringIO()):
        a0, f0, c0 = set(H.aisles()), set(H.front_audit()), set(H.hb.check())
        H.hb.cols.append(box)
        try:
            a1, f1, c1 = set(H.aisles()), set(H.front_audit()), set(H.hb.check())
        finally:
            H.hb.cols.pop()
    return a1 <= a0 and f1 <= f0 and not {c for c in c1 - c0 if "focal_try" not in c and "endtable_try" not in c} and         not any(("focal_try" in c or "endtable_try" in c) for c in c1)


def _remove(H, floor, nm):
    import bpy
    full = f"h{H.n}_{floor}_{nm}"
    for ob in list(H.lm[floor]):
        if ob.name == full:
            H.lm[floor].remove(ob)
            bpy.data.objects.remove(ob)
    lab = nm.lower().replace("-", "_")
    H.hb.cols[:] = [c for c in H.hb.cols if not (c[0] == floor and (c[1] == lab or c[1].startswith(lab + "_")))]
    for ob in list(bpy.data.objects):
        if ob.type == "EMPTY" and f"_{full}_" in ob.name and ob.name.startswith(K.LIGHT_PREFIX):
            bpy.data.objects.remove(ob)


def _tv_to_fireplace(H, floor):
    """no free wall takes a fireplace: the media wall opposite the sofa becomes the hearth (a cottage show-home styles a fireplace,
    not a television) when the floor in front stays as reachable as before"""
    stands = [p for p in getattr(H, "placed", []) if p["floor"] == floor and p["fn"] in ("tv_stand", "tv_cabinet_audio")]
    for st in stands:
        tvs = [p for p in H.placed if p["floor"] == floor and p["fn"] in ("tv_wall", "soundbar", "settop", "turntable") and math.hypot(p["lx"] - st["lx"], p["lz"] - st["lz"]) < 0.6]
        yaw = st["yaw"]
        fx, fz = math.sin(yaw), math.cos(yaw)
        rx, rz = math.cos(yaw), -math.sin(yaw)
        # the stand's back is on the wall: its depth / 2 behind its centre
        d_st = st["kw"].get("d", 0.4)
        wx, wz = st["lx"] - fx * d_st / 2, st["lz"] - fz * d_st / 2
        w = 1.6
        fd, hd = getattr(H, "fire_d", (0.36, 0.34))
        depth = fd + hd
        pts = [(wx + rx * u + fx * v, wz + rz * u + fz * v) for u in (-w / 2 - 0.08, w / 2 + 0.08) for v in (0.0, depth)]
        box = (min(p[0] for p in pts), max(p[0] for p in pts), min(p[1] for p in pts), max(p[1] for p in pts))
        names = [st["name"]] + [t["name"] for t in tvs]
        cnt = {}
        nms = []
        for p in H.placed:                      # the object names (a second piece of a name is name2, name3 ...)
            if p["floor"] != floor:
                continue
            cnt[p["name"]] = cnt.get(p["name"], 0) + 1
            if p is st or p in tvs:
                nms.append(p["name"] if cnt[p["name"]] == 1 else f"{p['name']}{cnt[p['name']]}")
        saved = [c for c in H.hb.cols if c[0] == floor and any(c[1] == n.lower() or c[1].startswith(n.lower() + "_") for n in nms)]
        others = [c for c in H.hb.cols if c not in saved]
        keep = H.hb.cols[:]
        H.hb.cols[:] = others
        pin = [(wx + rx * u + fx * v, wz + rz * u + fz * v) for u in (-w / 2 - 0.08, w / 2 + 0.08) for v in (0.08, depth)]
        bin_ = (min(p[0] for p in pin), max(p[0] for p in pin), min(p[1] for p in pin), max(p[1] for p in pin))
        ok = _box_free(H, floor, bin_, margin=-0.02) and _reach_ok(H, floor, (floor, "focal_try", box[0], box[1], box[2], box[3], 2.5))
        H.hb.cols[:] = keep
        if not ok:
            print(f"DRESS floor {floor}: the media wall at ({st['lx']:.2f},{st['lz']:.2f}) cannot take the fireplace")
            continue
        for n_ in nms:
            _remove(H, floor, n_)
        d = fd
        H.piece(floor, "fireplace", KR.stone_fireplace, wx, wz, 0.0, yaw, w=w, d=d, h=3.7, firebox_w=0.8, firebox_h=0.66, hearth_y=0.12,
                hearth_d=hd, tn=H.pal["trim"])
        H.piece(floor, "mantelprops", KR.mantel_props, wx + fx * (d + 0.02), wz + fz * (d + 0.02), 1.37, yaw, cols=False, w=w - 0.2)
        H.piece(floor, "overmantel", KL.mirror_framed, wx + fx * (d - 0.08), wz + fz * (d - 0.08), 1.62, yaw, cols=False, w=0.8, h=1.05)
        print(f"DRESS floor {floor}: the media wall became the fireplace ({', '.join(nms)} removed)")
        return True
    return False


def _place_focal(H, floor, objs, occ):
    kinds = H.focal.get(floor, ("fireplace", "dresser") if floor == 1 else ("bookcase", "dresser"))
    if not kinds:
        return None
    if isinstance(kinds, str):
        kinds = (kinds,)
    for kind in kinds:
        r = _place_one(H, floor, objs, occ, kind)
        if r:
            return r
        if kind == "fireplace" and not any(k in nm for (nm, sh, vs, ps) in objs for k in ("fireplace", "stove", "bookwall")):
            if _tv_to_fireplace(H, floor):
                return "tv"
    return None


def _place_one(H, floor, objs, occ, kind):
    have = [nm for (nm, shell, vs, ps) in objs if any(k in nm for k in ("fireplace", "stove", "bookwall", "bookcase_built", "dresser"))]
    if have:
        return None
    walls = _walls()
    sofas = _centre(objs, "sofa") or _centre(objs, "bed") or [(5.3, 3.9)]
    cands = []
    for wname, bins in occ.items():
        ln, to_sd, place = walls[wname]
        for (a, b) in _spans(bins):
            L = b - a
            if kind == "fireplace":
                if L < 1.75:
                    continue
                w = min(1.6, L - 0.15)
                depth = 0.36 + 0.34
            elif kind == "dresser":
                if L < 1.35:
                    continue
                w = min(1.6, L - 0.15)
                depth = 0.5
            else:
                if L < 1.3:
                    continue
                w = min(2.7, L - 0.15)
                depth = 0.41
            if _near_kitchen(objs, to_sd, a, b) and kind == "fireplace":
                continue
            mid = (a + b) / 2
            lx, lz, yaw = place(mid)
            dist = min(math.hypot(lx - sx, lz - sz) for (sx, sz) in sofas)
            score = dist if kind == "fireplace" else -L
            for shift in (0.0, -0.4, 0.4, -0.8, 0.8):
                m2 = mid + shift
                if m2 - w / 2 < a or m2 + w / 2 > b:
                    continue
                cands.append((score + abs(shift) * 0.3, wname, m2, w, depth))
    cands.sort()
    import os
    if os.environ.get("CV_DRESS_DEBUG"):
        for wname, bins in occ.items():
            print("SPANS", floor, wname, [(round(a, 2), round(b, 2)) for (a, b) in _spans(bins)])
        print("CANDS", floor, [(round(c[0], 2), c[1], round(c[2], 2)) for c in cands[:12]])
    for (score, wname, mid, w, depth) in cands[:12]:
        ln, to_sd, place = walls[wname]
        if not _strip_free(H, floor, wname, mid - w / 2 - 0.1, mid + w / 2 + 0.1, depth):
            print(f"DRESS floor {floor}: {kind} on the {wname} wall at {mid:.2f}: furniture in the way")
            continue
        lx, lz, yaw = place(mid)
        fx, fz = math.sin(yaw), math.cos(yaw)       # into the room
        rx, rz = math.cos(yaw), -math.sin(yaw)      # along the wall (local +x)
        pts = [(lx + rx * u + fx * v, lz + rz * u + fz * v) for u in (-w / 2 - 0.08, w / 2 + 0.08) for v in (0.0, depth)]
        box = (floor, "focal_try", min(p[0] for p in pts), max(p[0] for p in pts), min(p[1] for p in pts), max(p[1] for p in pts), 2.5)
        if not _reach_ok(H, floor, box):
            print(f"DRESS floor {floor}: {kind} on the {wname} wall at {mid:.2f} would block a path or a seat — next")
            continue
        if kind == "fireplace":
            d = 0.36
            H.piece(floor, "fireplace", KR.stone_fireplace, lx, lz, 0.0, yaw, w=w, d=d, h=3.7, firebox_w=min(0.8, w * 0.5), firebox_h=0.66,
                    hearth_y=0.12, hearth_d=0.34, tn=H.pal["trim"])
            mx, mz = lx + fx * (d - 0.08), lz + fz * (d - 0.08)
            H.piece(floor, "mantelprops", KR.mantel_props, lx + fx * (d + 0.02), lz + fz * (d + 0.02), 1.37, yaw, cols=False, w=w - 0.2)
            H.piece(floor, "overmantel", KL.mirror_framed, mx, mz, 1.62, yaw, cols=False, w=min(0.8, w * 0.5), h=1.05)
        elif kind == "bookcase":
            H.piece(floor, "bookcase_built", KL.bookcase_built, lx, lz, 0.0, yaw, w=w, h=2.6, d=0.36, tn=H.pal["trim"], seed=H.n * 3 + floor)
        else:
            H.piece(floor, "dresser", KL.dresser_crockery, lx, lz, 0.0, yaw, w=min(1.6, w), tn=H.pal["low"], seed=H.n)
        print(f"DRESS floor {floor}: {kind} on the {wname} wall at s {mid:.2f} (w {w:.2f})")
        return (wname, mid - w / 2 - 0.15, mid + w / 2 + 0.15)
    print(f"DRESS floor {floor}: no wall takes a {kind}")
    return None


def _stair_art(H, floor):
    """framed prints climbing with the flight along its wall (floor 1), a gallery on that wall above the stairwell (floor 2)"""
    hx0, hx1, hz0, hz1 = H.hole()
    walls = _walls()
    best = None
    for wname, (ln, to_sd, place) in walls.items():
        cs = [to_sd(x, z) for x in (hx0, hx1) for z in (hz0, hz1)]
        d0 = min(c[1] for c in cs)
        a0, a1 = min(c[0] for c in cs), max(c[0] for c in cs)
        if d0 < 0.3 and a1 - a0 > 3.0 and (best is None or d0 < best[1]):
            best = (wname, d0, a0, a1)
    if not best:
        return 0
    wname, d0, a0, a1 = best
    ln, to_sd, place = walls[wname]
    foot = H.plan["foot"]
    sf, _ = to_sd(foot["x"], foot["z"])
    up = 1 if abs(sf - a0) < abs(sf - a1) else -1
    run = a1 - a0
    k = 0
    H.in_dress = False        # owner 2026-11-20: the stair's wall pictures keep clear of windows too (a gallery hung over a window)
    try:
        return _stair_art_pieces(H, floor, place, to_sd, a0, a1, up, run)
    finally:
        H.in_dress = True


def _stair_art_pieces(H, floor, place, to_sd, a0, a1, up, run):
    k = 0
    if floor == 1:
        for i, t in enumerate((0.16, 0.34, 0.52)):
            s_ = (a0 if up > 0 else a1) + up * t * run
            rise = K.FLOOR_HEIGHT * t
            lx, lz, yaw = place(s_)
            fx, fz = math.sin(yaw), math.cos(yaw)
            fw, fh = (0.5, 0.62) if i != 1 else (0.62, 0.78)
            y = rise + 1.05
            if y + fh > 3.6:
                continue
            H.piece(floor, "stairart", KL.art_print, lx + fx * 0.004, lz + fz * 0.004, y, yaw, cols=False, w=fw, h=fh,
                    kind=("landscape", "still", "botanical")[i], seed=H.n * 11 + i, frame_tn=(0.45, 0.3, 0.18, 1))
            k += 1
    else:
        mid = (a0 + a1) / 2
        lx, lz, yaw = place(mid)
        fx, fz = math.sin(yaw), math.cos(yaw)
        H.piece(floor, "stairgal", KL.gallery_wall, lx + fx * 0.004, lz + fz * 0.004, 1.25, yaw, cols=False, w=min(run - 0.6, 2.8), seed=H.n * 13,
                frame_tn=(0.45, 0.3, 0.18, 1))
        k += 1
    return k


def _box_free(H, floor, box, margin=0.03):
    x0, x1, z0, z1 = box
    if x0 < 0.05 or z0 < 0.05 or x1 > W_ - 0.05 or z1 > D_ - 0.05:
        return False
    hx0, hx1, hz0, hz1 = H.hole()
    for c in [c for c in H.hb.cols if c[0] == floor and not c[1].startswith("wall")] + [(floor, "hole", hx0 - 0.3, hx1 + 0.3, hz0 - 0.3, hz1 + 0.3, 1.0)]:
        if min(x1, c[3]) - max(x0, c[2]) > -margin and min(z1, c[5]) - max(z0, c[4]) > -margin:
            return False
    return True


def _sofa_tables(H, floor):
    """an end table with a linen-shaded lamp at each end of a sofa, where the floor is free and no path or seat loses its room"""
    import kit_decor as DE
    import kit_tables as TA
    k = 0
    if not getattr(H, "endtables", True):
        return
    for p in list(getattr(H, "placed", [])):
        if p["floor"] != floor or p["fn"] not in ("sofa_fabric", "sofa_2seat") or p["name"].startswith(("bench", "pew")):
            continue
        w = p["kw"].get("w", 1.7 if p["fn"] == "sofa_2seat" else 2.4)
        yaw = p["yaw"]
        fx, fz = math.sin(yaw), math.cos(yaw)
        rx, rz = math.cos(yaw), -math.sin(yaw)
        for sgn in (-1, 1):
            cx = p["lx"] + rx * sgn * (w / 2 + 0.3) - fx * 0.18
            cz = p["lz"] + rz * sgn * (w / 2 + 0.3) - fz * 0.18
            box = (cx - 0.23, cx + 0.23, cz - 0.23, cz + 0.23)
            if not _box_free(H, floor, box):
                continue
            if not _reach_ok(H, floor, (floor, "endtable_try", box[0], box[1], box[2], box[3], 0.55)):
                continue
            H.piece(floor, "endtable", TA.bedside, cx, cz, 0.0, yaw, w=0.45, d=0.42, h=0.56)
            H.piece(floor, "endlamp", DE.table_lamp, cx, cz, 0.56, yaw, cols=False)
            k += 1
    if k:
        print(f"DRESS floor {floor}: {k} sofa end tables with lamps")


def dress(H, floor):
    if floor in getattr(H, "no_dress_floors", ()):
        return
    _sofa_tables(H, floor)
    objs = _verts(H, floor)
    occ = _occupancy(H, floor, objs)
    used = _place_focal(H, floor, objs, occ)
    if used == "tv":                  # the meshes changed: measure the walls again
        objs = _verts(H, floor)
        occ = _occupancy(H, floor, objs)
        used = None
    if used:
        wname, a, b = used
        for i in range(max(0, int(a / STEP)), min(len(occ[wname]), int(b / STEP) + 1)):
            occ[wname][i] = True
    walls = _walls()
    k = 0
    tn_frame = (0.45, 0.3, 0.18, 1)
    for wname, bins in occ.items():
        ln, to_sd, place = walls[wname]
        for (a, b) in _spans(bins):
            L = b - a
            mid = (a + b) / 2
            lx, lz, yaw = place(mid)
            fx, fz = math.sin(yaw), math.cos(yaw)
            lx, lz = lx + fx * 0.004, lz + fz * 0.004
            k += 1
            seed = H.n * 17 + floor * 5 + k
            if L >= 1.9:
                H.piece(floor, "gallery", KL.gallery_wall, lx, lz, 1.2, yaw, cols=False, w=min(L - 0.25, 2.9), seed=seed, frame_tn=tn_frame)
            elif L >= 1.25:
                if k % 2 == 0 and L >= 1.45:
                    H.piece(floor, "mirror", KL.mirror_framed, lx, lz, 1.15, yaw, cols=False, w=0.62, h=0.95)
                    rx, rz = math.cos(yaw), -math.sin(yaw)
                    for sgn in (-1, 1):
                        H.piece(floor, "sconce", KR.wall_sconce, lx + rx * sgn * 0.62, lz + rz * sgn * 0.62, 1.62, yaw, cols=False)
                else:
                    H.piece(floor, "gallery", KL.gallery_wall, lx, lz, 1.2, yaw, cols=False, w=L - 0.2, seed=seed, frame_tn=tn_frame)
            else:
                H.piece(floor, "print", KL.art_print, lx, lz, 1.3, yaw, cols=False, w=0.5, h=0.65,
                        kind=("landscape", "botanical", "still", "sea")[k % 4], seed=seed, frame_tn=tn_frame)
    k += _stair_art(H, floor)
    print(f"DRESS floor {floor}: {k} wall pieces")
