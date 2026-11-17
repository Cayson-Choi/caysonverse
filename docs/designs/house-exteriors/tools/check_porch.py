"""A8 porch kit (X2) checks, plain Python (no bpy): builds the ten houses (house_kit body + porch_kit) and proves

  C1 contract  every rectangle the kit builds to = layout.json's houseExteriors (the colliders, lift zones, stairs, flush
               decks, seats and slots the game uses, from houseExterior.ts), to 0.01 m;
  C2 inside    every solid that stands on the ground is inside its collider (or the house's solid box): nothing a body can
               walk into is left without a collider;
  C3 walk      the walkable surfaces (porch / deck slab, treads, flush decks) are exactly their lift zones and heights;
  C4 overhead  everything over walkable ground (beams, roofs, canopies, lamps) is >= 2.1 m above it;
  C5 wall      wall-mounted fittings over walkable ground stand <= 0.15 m proud of the house's solid box;
  C6 no clip   no two solids of different parts overlap (> 2 mm on every axis), and none cuts into the body, the plinth
               or the body kit's parts near it (sills, mouldings, belt course, down pipes, splash blocks, vents);
  C7 door      the front door's two leaves, swung 0..95 degrees (they stop on the reveal), with their bar pulls and the
               lock, keep >= 5 cm from every solid (owner 2026-11-17: "자동문이 주위의 물체와 겹치잖아 제발 좀 꼼꼼하게 확인해");
  C8 budget    shell <= 2,750 (Colmar, 2026-11-17), detail <= 6,000 and <= 6 materials, the shells' materials unchanged,
               total <= 87.5k;
  C9 texels    every textured porch face below 3.5 m >= 512 px/m, above >= 256 px/m (contract 6).

  python docs/designs/house-exteriors/tools/check_porch.py [--layout art/village/layout.json] [--out <report.json>]

Exit 1 on any failure. The report (per house: counts, nearest door clearance, every collider's solids' bounds) is read by
server/src/tools/houseBodyGlb.test.ts.
"""
import argparse
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import house_kit as K  # noqa: E402
import porch_kit as PK  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
EPS = 0.005          # containment tolerance (m)
CLIP = 0.002         # overlap that counts as a clip (m)
DOOR_CLEAR = 0.05
BODY_REACH = 2.1     # head room over walkable ground
WALL_PROUD = 0.15


def world_to_local(h, x, z):
    cx, cz = h["centre"]["x"], h["centre"]["z"]
    dx, dz = x - cx, z - cz
    s = h["doorSide"]
    if s == "s":
        return dx, dz
    if s == "n":
        return -dx, -dz
    if s == "e":
        return -dz, dx
    return dz, -dx


def rect_local(h, b):
    """A world box (minX..) as a local rectangle (x0, x1, z0, z1)."""
    a = world_to_local(h, b["minX"], b["minZ"])
    c = world_to_local(h, b["maxX"], b["maxZ"])
    return (min(a[0], c[0]), max(a[0], c[0]), min(a[1], c[1]), max(a[1], c[1]))


def near(a, b, tol=0.01):
    return all(abs(p - q) <= tol + 1e-9 for p, q in zip(a, b))


def inside(box, r, tol=EPS):
    x0, x1, _, _, z0, z1 = box
    return x0 >= r[0] - tol and x1 <= r[1] + tol and z0 >= r[2] - tol and z1 <= r[3] + tol


def inside_union(b, r, solid, tol=EPS):
    """b's ground rectangle lies in the collider r, or partly over the house's solid box (wall-mounted parts over the
    plinth ledge): every point of a 9 x 9 grid over it is in one of them."""
    if inside(b, r, tol):
        return True
    for i in range(9):
        for j in range(9):
            x = b[0] + (b[1] - b[0]) * i / 8
            z = b[4] + (b[5] - b[4]) * j / 8
            if not ((r[0] - tol <= x <= r[1] + tol and r[2] - tol <= z <= r[3] + tol) or
                    (solid[0] - tol <= x <= solid[1] + tol and solid[2] - tol <= z <= solid[3] + tol)):
                return False
    return True


def overlap(a, b, tol=CLIP):
    return all(min(a[2 * i + 1], b[2 * i + 1]) - max(a[2 * i], b[2 * i]) > tol for i in range(3))


def overlap_xz(a, r, tol=CLIP):
    return min(a[1], r[1]) - max(a[0], r[0]) > tol and min(a[5], r[3]) - max(a[4], r[2]) > tol


# ------------------------------------------------------------------------------------- the body kit's parts --

def body_boxes():
    """The body (walls, plinth) and the X1 parts a porch fitting could meet, as local AABBs (x0, x1, y0, y1, z0, z1)."""
    out = [
        ("walls", (-K.HB, K.HB, K.FL, K.WT, K.ZB, K.ZF)),
        ("plinth", (-K.HB - K.PLINTH_OUT, K.HB + K.PLINTH_OUT, -0.05, K.FL, K.ZB - K.PLINTH_OUT, K.ZF + K.PLINTH_OUT)),
        ("belt", (-K.HB - 0.05, K.HB + 0.05, K.FL + K.STOREY - 0.09, K.FL + K.STOREY + 0.08, K.ZB - 0.05, K.ZF + 0.05)),
    ]
    walls = K.wall_frames()
    return out, walls


def wall_box(W, u0, u1, y0, y1, d0, d1):
    pts = [W.P(u, 0, d) for u in (u0, u1) for d in (d0, d1)]
    xs, zs = [p[0] for p in pts], [p[2] for p in pts]
    return (min(xs), max(xs), y0, y1, min(zs), max(zs))


def x1_parts(windows):
    """Sills, head mouldings and the door's head moulding from the window table (house_kit.window / door), down pipes,
    the back splash blocks."""
    out = []
    walls = K.wall_frames()
    for o in windows:
        W = walls[o["wall"]]
        u0, u1, v0, v1 = K.opening_rect(o)
        if o["kind"] == "window":
            out.append(("sill", wall_box(W, u0 - 0.10, u1 + 0.10, v0 - 0.072, v0, -0.10, 0.0)))
        out.append(("head", wall_box(W, u0 - 0.14, u1 + 0.14, v1, v1 + 0.16, -0.05, 0.0)))
    hp = 0.0375 + 0.006
    for s in (-1, 1):
        zw = K.ZC + s * K.HD
        zp = zw + s * 0.13
        for px in (-(K.HB - 0.32), K.HB - 0.32):
            y_bot = 0.27 if (s > 0 and K.FRONT_PIPES_INTO_BEDS) else 0.09
            out.append(("downpipe", (px - hp, px + hp, y_bot, 7.3, min(zp - hp, zw), max(zp + hp, zw))))
            if not (s > 0 and K.FRONT_PIPES_INTO_BEDS):
                sz0, sz1 = zp, zp + s * 0.6
                out.append(("splash", (px - 0.25, px + 0.25, -0.02, 0.05, min(sz0, sz1), max(sz0, sz1))))
    return out


# --------------------------------------------------------------------------------------------- door swing --

def door_shapes(theta):
    """The two leaves at opening angle theta (rad) as convex XZ polygons (leaf, pull, lock), with their y range."""
    d = PK.DOOR
    zh = K.ZF - d["d"] + d["t"]            # hinge line: the leaf's outside face
    shapes = []
    for side in (-1, 1):                   # -1: the left leaf (hinge at x -0.83), +1: the right
        hx = side * d["hinge"]
        # closed, the leaf runs from the hinge toward the middle: direction (-side, 0); it swings out (+z)
        dirv = (-side * math.cos(theta), math.sin(theta))
        nrm = (side * math.sin(theta), math.cos(theta))          # the outside face's normal
        P = lambda s, o: (hx + dirv[0] * s + nrm[0] * o, zh + dirv[1] * s + nrm[1] * o)
        L = d["leaf"]
        shapes.append(("leaf", [P(0, -2 * d["t"]), P(L, -2 * d["t"]), P(L, 0), P(0, 0)]))
        sp = d["hinge"] - 0.17                                    # the bar pull's distance from the hinge
        shapes.append(("pull", [P(sp - 0.014, 0), P(sp + 0.014, 0), P(sp + 0.014, 0.10), P(sp - 0.014, 0.10)]))
        if side > 0:
            sl = d["hinge"] - 0.60 + 0.11                         # the lock body and its lever (x 0.6 - 0.11 .. 0.6 + 0.05)
            shapes.append(("lock", [P(d["hinge"] - 0.65, 0), P(sl + 0.11, 0), P(sl + 0.11, 0.06), P(d["hinge"] - 0.65, 0.06)]))
    return shapes


def poly_rect_dist(poly, r):
    """Distance between a convex polygon and an axis rectangle (x0, x1, z0, z1) in the plane; 0 if they overlap."""
    rp = [(r[0], r[2]), (r[1], r[2]), (r[1], r[3]), (r[0], r[3])]
    if convex_overlap(poly, rp):
        return 0.0
    best = 1e9
    for a in poly:
        best = min(best, pt_seg_rect(a, r))
    for p in rp:
        for i in range(len(poly)):
            best = min(best, pt_seg(p, poly[i], poly[(i + 1) % len(poly)]))
    return best


def pt_seg_rect(p, r):
    dx = max(r[0] - p[0], 0.0, p[0] - r[1])
    dz = max(r[2] - p[1], 0.0, p[1] - r[3])
    return math.hypot(dx, dz)


def pt_seg(p, a, b):
    ax, az = b[0] - a[0], b[1] - a[1]
    t = ((p[0] - a[0]) * ax + (p[1] - a[1]) * az) / max(ax * ax + az * az, 1e-12)
    t = max(0.0, min(1.0, t))
    return math.hypot(p[0] - a[0] - ax * t, p[1] - a[1] - az * t)


def convex_overlap(A, B):
    for P in (A, B):
        for i in range(len(P)):
            a, b = P[i], P[(i + 1) % len(P)]
            n = (b[1] - a[1], a[0] - b[0])
            pa = [n[0] * q[0] + n[1] * q[1] for q in A]
            pb = [n[0] * q[0] + n[1] * q[1] for q in B]
            if max(pa) < min(pb) or max(pb) < min(pa):
                return False
    return True


# -------------------------------------------------------------------------------------------- texel density --

def texel_density(p):
    """Albedo px per metre of a textured polygon (the sets' maps are 1024 wide; bands keep that scale)."""
    pts, uv = p.pts, p.uv
    aw = au = 0.0
    for i in range(1, len(pts) - 1):
        e1, e2 = K.sub(pts[i], pts[0]), K.sub(pts[i + 1], pts[0])
        c = K.cross(e1, e2)
        aw += 0.5 * math.sqrt(K.dot(c, c))
        f1 = (uv[i][0] - uv[0][0], uv[i][1] - uv[0][1])
        f2 = (uv[i + 1][0] - uv[0][0], uv[i + 1][1] - uv[0][1])
        au += 0.5 * abs(f1[0] * f2[1] - f1[1] * f2[0])
    if aw < 1e-6 or au < 1e-12:
        return None
    return math.sqrt(au / aw) * 1024


# --------------------------------------------------------------------------------------------------- main --

def check_house(hx, colour, windows, seed):
    fails, notes = [], []
    H = K.build_house(hx["id"], colour, windows, seed)
    s0, d0 = H.shell.tris(), H.detail.tris()
    shell_mats0 = set(H.shell.mats())
    npoly_s, npoly_d = len(H.shell.polys), len(H.detail.polys)
    P = PK.build_porch(H)
    hid = hx["id"]
    kind = PK.KIND[hid]
    sp = PK.SPECS[kind]
    # ---- C1: the contract's rectangles = the kit's
    cols = {c["id"].replace(hid + "_", "").replace("garden_" + hid, "garden"): rect_local(hx, c) for c in hx["colliders"]}
    hs, hst = sp["hs"], sp["hst"]
    want = {"porch_1": (-PK.HW, -hs, PK.PF, PK.HZ), "porch_2": (hs, PK.HW, PK.PF, PK.HZ)}
    k = 3
    if hs > hst:
        want["porch_3"] = (-hs, -hst, PK.HZ - PK.KERB, PK.HZ)
        want["porch_4"] = (hst, hs, PK.HZ - PK.KERB, PK.HZ)
        k = 5
    for px in sp["posts"]:
        want["porch_%d" % k] = (px - PK.POST_HALF, px + PK.POST_HALF, sp["pz"] - PK.POST_HALF, sp["pz"] + PK.POST_HALF)
        k += 1
    if kind == "deck":
        b = PK.BENCH
        want["porch_%d" % k] = (b["x0"], b["x1"], b["z0"], b["z1"])
    lx = PK.LPG if hid not in PK.LPG_MIRROR else (-PK.LPG[1], -PK.LPG[0], PK.LPG[2], PK.LPG[3])
    want["lpg"] = lx
    if hid not in PK.NO_GARDEN:
        dx = PK.GARDEN_SHIFT.get(hid, 0.0)
        want["garden"] = (PK.GARDEN[0] + dx, PK.GARDEN[1] + dx, PK.GARDEN[2], PK.GARDEN[3])
    if set(want) != set(cols):
        fails.append("C1 collider ids %s != layout %s" % (sorted(want), sorted(cols)))
    for cid, r in want.items():
        if cid in cols and not near(r, cols[cid]):
            fails.append("C1 %s kit %s != layout %s" % (cid, r, tuple(round(v, 3) for v in cols[cid])))
    lifts = hx["liftZones"]
    slab = rect_local(hx, lifts[0]["box"])
    if not near(slab, (-hs, hs, K.ZF, PK.HZ)) or abs(lifts[0]["lift"] - PK.FL) > 1e-6:
        fails.append("C1 porch lift zone %s" % (slab,))
    for i, t in enumerate(lifts[1:]):
        r = rect_local(hx, t["box"])
        w = (-hst, hst, PK.HZ + PK.TREAD * i, PK.HZ + PK.TREAD * (i + 1))
        if not near(r, w) or abs(t["lift"] - (PK.FL - PK.RISE * (i + 1))) > 1e-6:
            fails.append("C1 tread %d lift zone %s != %s" % (i, r, w))
    fd = hx.get("flushDeck")
    if (fd is None) != (hid not in PK.FLUSH):
        fails.append("C1 flush deck presence")
    elif fd is not None and not near(rect_local(hx, fd), PK.FLUSH[hid]):
        fails.append("C1 flush deck %s != %s" % (rect_local(hx, fd), PK.FLUSH[hid]))
    seat = hx.get("seat")
    if (seat is not None) != (kind == "deck"):
        fails.append("C1 seat presence")
    elif seat is not None:
        if abs(seat["seatTop"] - PK.BENCH["top"]) > 1e-6:
            fails.append("C1 seat top %s" % seat["seatTop"])
        sx, sz = world_to_local(hx, seat["x"], seat["z"])
        if abs(sx - (PK.BENCH["x0"] + PK.BENCH["x1"]) / 2) > 0.011 or abs(sz + seat["frontEdge"] - PK.BENCH["front"]) > 0.011:
            fails.append("C1 seat %s,%s" % (sx, sz))
    for sl in hx["slots"]:
        lx_, lz_ = world_to_local(hx, sl["x"], sl["z"])
        w = PK.SLOTS[sl["kind"]]
        if abs(lx_ - w[0]) > 0.011 or abs(lz_ - w[1]) > 0.011 or abs(sl["y"] - w[2]) > 1e-6 or abs(sl["width"] - w[3]) > 1e-6:
            fails.append("C1 slot %s (%s, %s, %s)" % (sl["kind"], lx_, lz_, sl["y"]))
    # ---- C2..C5: every solid against the colliders, the walk zones, the wall
    solid = (-K.HB - K.PLINTH_OUT, K.HB + K.PLINTH_OUT, K.ZB - K.PLINTH_OUT, K.ZF + K.PLINTH_OUT)
    walk = [("porch", (-hs, hs, K.ZF, PK.HZ), PK.FL)]
    for i in range(PK.NSTEP):
        walk.append(("tread_%d" % i, (-hst, hst, PK.HZ + PK.TREAD * i, PK.HZ + PK.TREAD * (i + 1)), PK.FL - PK.RISE * (i + 1)))
    if hid in PK.FLUSH:
        walk.append(("flush", PK.FLUSH[hid], 0.045))
    # the open lawn round the house counts as walkable too (y 0): anything standing on it must be in a collider
    bounds = {}
    for s in P.solids:
        b, role, cid = s["box"], s["role"], s["col"]
        tag = "%s/%s" % (s["group"], s["name"])
        if role == "col":
            r = cols.get(cid)
            if r is None:
                fails.append("C2 %s: no collider %s" % (tag, cid))
                continue
            if not inside_union(b, r, solid):
                fails.append("C2 %s %s outside %s %s" % (tag, fmt(b), cid, fmt4(r)))
            bb = bounds.setdefault(cid, list(b))
            for i in range(6):
                bb[i] = min(bb[i], b[i]) if i % 2 == 0 else max(bb[i], b[i])
        elif role == "walk":
            ok = False
            for (wn, wr, wy) in walk:
                if inside(b, (wr[0], wr[1], min(wr[2], solid[3]) if wn == "porch" else wr[2], wr[3]), 0.006) and b[3] <= wy + 0.0005:
                    ok = True
                    if b[3] < wy - 0.0005 and s["name"] not in ("deck",):
                        fails.append("C3 %s top %.3f below its zone %.3f" % (tag, b[3], wy))
            if not ok:
                fails.append("C3 %s %s not on a walk zone" % (tag, fmt(b)))
        elif role == "over":
            for (wn, wr, wy) in walk + [("lawn", (-99, 99, -99, 99), 0.0)]:
                if overlap_xz(b, wr) and b[2] < wy + BODY_REACH and not inside(b, solid, 0.0):
                    # over the lawn / porch: must be high enough unless it is over a collider
                    if not any(inside(b, r) for r in cols.values()):
                        fails.append("C4 %s %s only %.2f over %s" % (tag, fmt(b), b[2] - wy, wn))
                    break
        elif role == "wall":
            proud = max(solid[0] - b[0], b[1] - solid[1], solid[2] - b[4], b[5] - solid[3], 0.0)
            in_col = any(inside(b, r) for r in cols.values())
            if proud > WALL_PROUD and not in_col:
                fails.append("C5 %s %.3f proud of the house" % (tag, proud))
            if b[2] < 0.9 and not in_col:
                fails.append("C5 %s low (%.2f) on walkable ground" % (tag, b[2]))
        elif role == "pierce":
            pass
    # every collider has something in it (the picture shows what blocks)
    for cid in cols:
        if cid not in bounds:
            fails.append("C2 collider %s has nothing in it" % cid)
    # ---- C6: no clips between parts, with the body or the body kit's parts
    allowed = lambda a, b: (
        a["group"] == b["group"]
        or ("plant" in (a["group"], b["group"]) and (a["name"] in ("soil", "stake", "plant") or b["name"] in ("soil", "stake", "plant")))
        # the sign's stake stands among the bed's plants (their reach boxes overlap its column, the plants grow round it)
        or ("plant" in (a["group"], b["group"]) and "sign_stake" in (a["name"], b["name"]))
    )
    S = P.solids
    for i in range(len(S)):
        for j in range(i + 1, len(S)):
            if not allowed(S[i], S[j]) and overlap(S[i]["box"], S[j]["box"]):
                fails.append("C6 %s/%s %s x %s/%s %s" % (S[i]["group"], S[i]["name"], fmt(S[i]["box"]), S[j]["group"], S[j]["name"],
                                                          fmt(S[j]["box"])))
    bb, _ = body_boxes()
    # the Colmar dress (2026-11-17): the body's own fittings as built (shutters, boxes, sills, door surround, arches, signs,
    # baskets, down pipes), and a jettied upper front
    xp = [(sd["name"], sd["box"]) for sd in getattr(H, "solids", [])] or x1_parts(windows)
    C = getattr(H, "colmar", None)
    if C is not None and C.J > 0:
        bb = bb + [("jetty", (-K.HB - 0.03, K.HB + 0.03, K.FL + K.STOREY - 0.40, K.WT, K.ZF, K.ZF + C.J + 0.05))]
    for s in S:
        if s["role"] == "pierce":
            continue
        for (n, b) in bb + xp:
            if n == "downpipe" and s["name"] in ("soil", "collar"):
                continue          # the front pipes run into the beds' soil through the collar (porch_kit.beds)
            if overlap(s["box"], b):
                fails.append("C6 %s/%s %s cuts the body's %s %s" % (s["group"], s["name"], fmt(s["box"]), n, fmt(b)))
    # ---- C7: the door's swing
    d = PK.DOOR
    obst = [("%s/%s" % (s["group"], s["name"]), s["box"]) for s in S] + [("x1 " + n, b) for (n, b) in xp if n != "head"]
    best = (1e9, None, None)
    for deg in range(0, int(d["max_deg"]) + 1):
        th = math.radians(deg)
        for (part, poly) in door_shapes(th):
            for (n, b) in obst:
                if b[3] < d["y0"] or b[2] > d["y1"]:
                    continue
                dist = poly_rect_dist(poly, (b[0], b[1], b[4], b[5]))
                if dist < best[0]:
                    best = (dist, n, "%s at %d deg" % (part, deg))
    if best[0] < DOOR_CLEAR:
        fails.append("C7 door %s within %.3f m of %s" % (best[2], best[0], best[1]))
    # ---- C8: budgets
    st, dt = H.shell.tris(), H.detail.tris()
    if st > 2750:
        fails.append("C8 shell %d > 2750" % st)
    if dt > 6000:
        fails.append("C8 detail %d > 6000" % dt)
    dm = H.detail.mats()
    if len(dm) > 6:
        fails.append("C8 detail materials %s" % dm)
    if not set(H.shell.mats()) <= shell_mats0 | {"LM_roof"}:
        fails.append("C8 shell materials %s (body %s)" % (H.shell.mats(), sorted(shell_mats0)))
    # ---- C9: texel density of the porch's textured faces
    low = []
    for p in H.shell.polys[npoly_s:] + H.detail.polys[npoly_d:]:
        if not p.mat.startswith("LM_"):
            continue
        tpm = texel_density(p)
        if tpm is None:
            continue
        ymax = max(q[1] for q in p.pts)
        need = 512 if ymax <= 3.5 + 1e-6 else 256
        if tpm < need - 1:
            low.append((round(tpm), p.set, round(ymax, 2)))
    if low:
        fails.append("C9 %d faces under density, e.g. %s" % (len(low), low[:3]))
    rep = {
        "kind": kind,
        "shell": {"body": s0, "porch": st - s0, "total": st},
        "detail": {"body": d0, "porch": dt - d0, "total": dt},
        "shellMaterials": H.shell.mats(),
        "detailMaterials": dm,
        "doorClearance": {"metres": round(best[0], 3), "nearest": best[1], "at": best[2]},
        "solids": len(S),
        "cost": {k: {"shell": v[0], "detail": v[1]} for k, v in P.cost.items()},
        "colliders": {cid: {"collider": [round(v, 3) for v in cols[cid]], "solids": [round(v, 3) for v in bounds[cid]]}
                      for cid in sorted(bounds)},
        "fails": fails,
    }
    return rep


def fmt(b):
    return "[%.3f..%.3f y %.3f..%.3f z %.3f..%.3f]" % b


def fmt4(r):
    return "[%.3f..%.3f z %.3f..%.3f]" % r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--layout", default=os.path.join(REPO, "art", "village", "layout.json"))
    ap.add_argument("--windows", default=os.path.join(REPO, "shared", "src", "village", "generated", "exterior_windows.json"))
    ap.add_argument("--tex", default=os.path.join(REPO, "client", "public", "models", "village", "houses", "house_textures.json"))
    ap.add_argument("--out", default=os.path.join(REPO, "docs", "designs", "house-exteriors", "x2", "porch_check.json"))
    a = ap.parse_args()
    K.load_tex(a.tex)
    L = json.load(open(a.layout, encoding="utf-8"))
    T = json.load(open(a.windows, encoding="utf-8"))
    colours = {h["id"]: h["colour"] for h in L["sceneryHouses"]}
    hxs = {h["id"]: h for h in L["houseExteriors"]["houses"]}
    report = {"format": "caysonverse-porch-check", "version": 1, "houses": {}}
    total = 0
    bad = 0
    for n in range(1, 11):
        hid = "house_%d" % n
        rep = check_house(hxs[hid], colours[hid], T["houses"][hid], 1000 + n)
        report["houses"][hid] = rep
        total += rep["shell"]["total"] + rep["detail"]["total"]
        bad += len(rep["fails"])
        print("%-8s %-6s shell %4d (+%3d) detail %4d (+%4d) mats %d door %.3f m (%s, %s) %s" % (
            hid, rep["kind"], rep["shell"]["total"], rep["shell"]["porch"], rep["detail"]["total"], rep["detail"]["porch"],
            len(rep["detailMaterials"]), rep["doorClearance"]["metres"], rep["doorClearance"]["nearest"], rep["doorClearance"]["at"],
            "PASS" if not rep["fails"] else "FAIL %d" % len(rep["fails"])))
        for f in rep["fails"][:12]:
            print("   ", f)
    report["totalTriangles"] = total
    if total > 87500:
        bad += 1
        print("total %d > 78000" % total)
    report["pass"] = bad == 0
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(report, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print("total triangles", total, "PASS" if bad == 0 else "FAIL (%d)" % bad)
    sys.exit(0 if bad == 0 else 1)


if __name__ == "__main__":
    main()
