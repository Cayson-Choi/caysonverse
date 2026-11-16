"""Light maps of the lake's facilities (B's lake_structures.glb), baked with the same sun / sky / lamps as the terrain (F follow-up).

  blender -b art/lake/work/lake_authoring.blend    -P art/lake/tools/bake_lake_structures.py -- [--size 2048] [--samples 192]
  blender -b art/lake/work/structures_lmprep.blend -P art/lake/tools/bake_lake_structures.py -- --night [--samples 256]
  blender -b art/lake/work/structures.blend        -P art/lake/tools/export_lake_structures.py -- --glb <out.glb>     (applies the UVs)

Day run: the facilities (the `occluder` meshes the terrain build took from B's structures.blend, named like B's objects) become
single-user meshes (the 30 chairs / stands, 3 benches, 2 picnic tables share one mesh in B's file: each needs its own light), get
one common UV set `UV_LM` (smart project, density weights below, packed into one atlas), are baked (DIFFUSE direct + indirect, the
sun, the sky and the trees' shadows, exactly BK.bake_lightmap's recipe) into art/lake/work/structures_lm.png, and the packed UVs
are written to art/lake/work/structures_lm_uv.npz (object name -> loop UVs). Night run: the same atlas under the moon and the lamps
(the light__* empties B's file carries) into structures_lm_night.png. `post_lake.py` makes the WebP files.
"""
import math
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
LAKE_ROOT = os.path.dirname(HERE)
REPO = os.path.dirname(os.path.dirname(LAKE_ROOT))
os.environ.setdefault("CV_LAYOUT", os.path.join(REPO, "art", "village", "layout.json"))
sys.path.insert(0, os.path.join(REPO, "art", "village", "tools"))
sys.path.insert(0, HERE)
import bake_village as BK  # noqa: E402
import bake_lake as BL  # noqa: E402

WORK = os.path.join(LAKE_ROOT, "work")
arg, flag, log = BK.arg, BK.flag, BK.log

# texel density weights by name prefix (relative; thin parts need >= 3 texels across or they read black)
WEIGHTS = [("chair_", 3.0), ("stand_", 3.0), ("bench_", 3.0), ("picnic_", 2.5), ("lake_lamps", 2.0), ("lake_chair_stack", 2.5),
           ("lake_pier_t", 0.9), ("lake_pier", 0.7), ("lake_walkway", 0.9), ("lake_jwadae", 0.9), ("lake_hut", 1.2), ("lake_office", 1.1),
           ("lake_pavilion", 1.0), ("lake_vending", 1.6), ("lake_rod_rack", 2.0), ("lake_nets", 1.5)]


PAD = int(os.environ.get("LSB_PAD", "1"))          # texels of margin round every patch (the bilinear filter and the bake's edge extension stay inside it)
CLUSTER_CELL = float(os.environ.get("LSB_CELL", "1.0"))  # m: faces of one plane group that touch the same cell of the projection are one patch
SMALL_PROP = 2.5  # m
TINY_FACE = 0.25  # m
PLANE_BIN = float(os.environ.get("LSB_BIN", "0.5"))  # m: faces on the same plane (within this) and the same facing share one patch


def weight(name):
    for k, v in WEIGHTS:
        if name.startswith(k):
            return v
    return 1.0


def patches(o):
    """Planar patches of one object: faces with the same facing and plane (boards of one deck, the panes of one wall) form ONE
    patch that is projected flat (drop the dominant axis), so a deck is a smooth strip of texels, not thousands of one-face
    islands (smart project made 20k of them: their margins ate 99 % of the atlas). Returns [(loop index array, u, v, w, h)]."""
    me = o.data
    nv, nl, npoly = len(me.vertices), len(me.loops), len(me.polygons)
    co = np.empty(nv * 3, np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    lv = np.empty(nl, np.int32)
    me.loops.foreach_get("vertex_index", lv)
    nrm = np.empty(npoly * 3, np.float32)
    me.polygons.foreach_get("normal", nrm)
    nrm = nrm.reshape(-1, 3)
    cen = np.empty(npoly * 3, np.float32)
    me.polygons.foreach_get("center", cen)
    cen = cen.reshape(-1, 3)
    ls = np.empty(npoly, np.int32)
    me.polygons.foreach_get("loop_start", ls)
    lt = np.empty(npoly, np.int32)
    me.polygons.foreach_get("loop_total", lt)
    # a small prop (a chair, a rod stand, a bench: under 2.5 m) is grouped by facing only: its stacked faces share texels (the light
    # over one chair varies little), so it costs a handful of patches instead of one per plank and bar
    small = float((co.max(axis=0) - co.min(axis=0)).max()) < SMALL_PROP
    groups = {}
    for pi in range(npoly):
        n = nrm[pi]
        fv = co[lv[ls[pi]:ls[pi] + lt[pi]]]
        if small:
            key = (tuple(np.round(n * 4).astype(int)), 0)
        elif float((fv.max(axis=0) - fv.min(axis=0)).max()) < TINY_FACE:
            # a tiny face (a lamp's tube facet, a bolt, a rail's cap): grouped with the others of its 1.5 m cell and facing
            key = ("tiny", tuple(np.round(n * 2).astype(int)), tuple(np.floor(cen[pi] / 1.5).astype(int)))
        else:
            key = (tuple(np.round(n * 4).astype(int)), int(math.floor(float(np.dot(n, cen[pi])) / PLANE_BIN)))
        groups.setdefault(key, []).append(pi)
    out = []
    for pis in groups.values():
        n = nrm[pis].mean(axis=0)
        ax = int(np.argmax(np.abs(n)))
        a1, a2 = [k for k in range(3) if k != ax]
        pidx = [np.arange(ls[p], ls[p] + lt[p]) for p in pis]
        fpts = [co[lv[ix]][:, [a1, a2]] for ix in pidx]
        # connected clusters (faces sharing a 0.5 m cell of the projection): one patch each, so its rectangle is mostly faces
        parent = list(range(len(pis)))

        def find(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i
        cell_owner = {}
        for k, pts in enumerate(fpts):
            c0 = np.floor(pts.min(axis=0) / CLUSTER_CELL).astype(int)
            c1 = np.floor(pts.max(axis=0) / CLUSTER_CELL).astype(int)
            for cx in range(c0[0], c1[0] + 1):
                for cy in range(c0[1], c1[1] + 1):
                    o2 = cell_owner.setdefault((cx, cy), k)
                    if o2 != k:
                        parent[find(k)] = find(o2)
        comps = {}
        for k in range(len(pis)):
            comps.setdefault(find(k), []).append(k)
        for ks in comps.values():
            idx = np.concatenate([pidx[k] for k in ks])
            pts = np.concatenate([fpts[k] for k in ks])
            mn = pts.min(axis=0)
            mx = pts.max(axis=0)
            out.append((idx, pts[:, 0] - mn[0], pts[:, 1] - mn[1], float(mx[0] - mn[0]), float(mx[1] - mn[1])))
    return out


def shelf_pack(rects, size):
    """rects: [(w, h)] in texels. Shelf rows, tallest first. Returns [(x, y)] in input order, or None when it does not fit."""
    order = sorted(range(len(rects)), key=lambda i: -rects[i][1])
    pos = [None] * len(rects)
    x = y = rowh = 0
    for i in order:
        w, h = rects[i]
        if x + w > size:
            x, y, rowh = 0, y + rowh, 0
        if y + h > size or w > size:
            return None
        pos[i] = (x, y)
        x += w
        rowh = max(rowh, h)
    return pos


def planar_lightmap_uv(objs, size):
    """UV_LM for every object: planar patches packed into one atlas at the density (texels per metre, times the object's weight)
    that just fits."""
    allp = []   # (object index, patch)
    for oi, o in enumerate(objs):
        for pt in patches(o):
            allp.append((oi, pt))
    log("planar patches", len(allp))

    def tex(w, h, name, base):
        d = base * weight(name)
        return max(3, int(math.ceil(w * d)) + 1), max(3, int(math.ceil(h * d)) + 1)

    def sizes(base):
        out = []
        for oi, (idx, u, v, w, h) in allp:
            tw, th = tex(w, h, objs[oi].name, base)
            out.append((tw + 2 * PAD, th + 2 * PAD))
        return out
    lo, hi = 0.5, 80.0
    best = None
    for _ in range(14):
        mid = (lo * hi) ** 0.5
        pos = shelf_pack(sizes(mid), size)
        if pos is None:
            hi = mid
        else:
            lo, best = mid, (mid, pos)
    base, pos = best
    sz = sizes(base)
    log("texel density base", round(base, 2), "texels/m (x weight)")
    for o in objs:
        me = o.data
        if "UV_LM" not in me.uv_layers:
            me.uv_layers.new(name="UV_LM")
    arrs = {oi: np.zeros((len(objs[oi].data.loops), 2), np.float32) for oi in range(len(objs))}
    for (oi, (idx, u, v, w, h)), (px, py) in zip(allp, pos):
        tw, th = tex(w, h, objs[oi].name, base)
        # the patch spans the texel centres it owns (0.25 texel inside its edge: a tiny face still covers a few centres)
        su = (tw - 0.5) / w if w > 1e-6 else 0.0
        sv = (th - 0.5) / h if h > 1e-6 else 0.0
        arrs[oi][idx, 0] = (px + PAD + 0.25 + (u * su if w > 1e-6 else (tw - 0.5) / 2)) / size
        arrs[oi][idx, 1] = (py + PAD + 0.25 + (v * sv if h > 1e-6 else (th - 0.5) / 2)) / size
    for oi, o in enumerate(objs):
        o.data.uv_layers["UV_LM"].data.foreach_set("uv", arrs[oi].ravel())
        o.data.uv_layers.active = o.data.uv_layers["UV_LM"]
    used = sum(w * h for w, h in sz) / (size * size)
    log("atlas used", round(used * 100, 1), "%")


def facilities():
    return [o for o in bpy.data.objects if o.type == "MESH" and o.get("cat") == "occluder" and o.name != "occluder_greybox" and len(o.data.polygons)]


def main():
    scene = bpy.context.scene
    BK.gpu(scene)
    scene.cycles.transparent_max_bounces = 24
    size = arg("--size", 2048, int)
    samples = arg("--samples", 192, int)
    BK.DENSITY.clear()
    BK.DENSITY.update(dict(WEIGHTS))
    objs = facilities()
    log("facilities", len(objs))
    if flag("--night"):
        BL.setup_night(scene)
        stats = BK.bake_lightmap(scene, objs, size, samples, os.path.join(WORK, "structures_lm_night.png"), emit_on=True, lift=BK.NIGHT["lift"])
        log("night structures light map", stats)
        return
    for o in objs:
        if o.data.users > 1:
            o.data = o.data.copy()
    planar_lightmap_uv(objs, size)
    if flag("--uvonly"):
        return
    out = {}
    for o in objs:
        uv = o.data.uv_layers["UV_LM"].data
        a = np.empty(len(uv) * 2, np.float32)
        uv.foreach_get("uv", a)
        out[o.name] = a.reshape(-1, 2)
    np.savez(os.path.join(WORK, "structures_lm_uv.npz"), **out)
    allv = np.concatenate(list(out.values()))
    log("UV bounds", allv.min(0), allv.max(0))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, "structures_lmprep.blend"), copy=True)
    stats = BK.bake_lightmap(scene, objs, size, samples, os.path.join(WORK, "structures_lm.png"))
    log("structures light map", stats)


main()
